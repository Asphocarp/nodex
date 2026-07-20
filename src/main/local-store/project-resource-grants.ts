import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import type { ProjectResourceGrant } from "../../shared/library";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import {
  canonicalizeNodexAgentResourceGrantSpecs,
  type NodexAgentAuthorizationTarget,
  type NodexAgentResourceAccessOverlay,
  type NodexAgentResourceAccessPlan,
  type NodexAgentResourceConsentRequirement,
  type NodexAgentResourceGrantRoot,
  type NodexAgentResourceGrantSpec,
  type NodexAgentResourceIntent,
  type PersistNodexAgentProjectResourceGrantsInput,
} from "../../shared/nodex-agent-resource-access";
import type {
  LibraryResource,
  ProjectResourceAction,
  ProjectResourceAuthorization,
  ProjectResourceAuthorizationSource,
  PutProjectResourceGrantInput,
  RevokeProjectResourceGrantInput,
} from "../../shared/resource-authorization";
import { getDb } from "./database";
import { readBlockStoreEpoch } from "./block-store-metadata";
import {
  PageHierarchyError,
  resolvePageHierarchy,
  type PageHierarchy,
} from "./page-hierarchy";

interface ProjectAuthorityRow {
  readonly id: string;
  readonly library_id: string;
  readonly database_block_id: string;
  readonly lifecycle: "active" | "inactive" | "archived";
}

interface ResourceCoordinates {
  readonly libraryId: string;
  readonly owningDatabaseIds: readonly string[];
  readonly pageAncestorIds: readonly string[];
  readonly preferredGrantRoot: Exclude<
    NodexAgentResourceGrantRoot,
    { readonly kind: "library" }
  >;
}

interface GrantMatch {
  readonly id: string;
  readonly root_kind: "page" | "database";
  readonly root_id: string;
  readonly access: "read" | "read_write";
}

interface GrantRow {
  readonly id: string;
  readonly project_id: string;
  readonly library_id: string;
  readonly root_kind: "page" | "database";
  readonly root_id: string;
  readonly access: "read" | "read_write";
  readonly recursive: number;
  readonly revision: number;
  readonly lifecycle: "active" | "revoked";
  readonly created_at: string;
  readonly updated_at: string;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const normalizeIdentity = (value: string, label: string): string => {
  const normalized = value.trim();
  if (normalized && normalized.length <= 512) return normalized;
  throw new TypeError(`${label} must be a non-empty bounded identity`);
};

const rowToGrant = (row: GrantRow): ProjectResourceGrant => ({
  id: row.id,
  projectId: row.project_id,
  libraryId: row.library_id,
  rootKind: row.root_kind,
  rootId: row.root_id,
  access: row.access,
  recursive: true,
  revision: row.revision,
  lifecycle: row.lifecycle,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readProjectAuthority = (
  database: Database.Database,
  projectId: string,
): ProjectAuthorityRow | null =>
  (database.prepare(`
    SELECT id, library_id, database_block_id, lifecycle
    FROM projects WHERE id = ?
  `).get(projectId) as ProjectAuthorityRow | undefined) ?? null;

const readDatabasePageAncestors = (
  database: Database.Database,
  databaseId: string,
): readonly string[] => {
  const hostPage = database.prepare(`
    SELECT owner.block_id AS pageId
    FROM blocks database_block
    INNER JOIN block_documents ownership
      ON ownership.document_id = database_block.containing_document_id
    INNER JOIN pages owner ON owner.block_id = ownership.block_id
    WHERE database_block.id = ?
      AND database_block.location_kind = 'document'
  `).get(databaseId) as { readonly pageId: string } | undefined;
  return hostPage
    ? resolvePageHierarchy(database, hostPage.pageId).pageIds
    : [];
};

const readResourceCoordinates = (
  database: Database.Database,
  resource: LibraryResource,
): ResourceCoordinates | null => {
  if (resource.kind === "page") {
    const page = database.prepare(`
      SELECT library_id AS libraryId FROM pages WHERE block_id = ?
    `).get(resource.pageId) as { readonly libraryId: string } | undefined;
    if (!page) return null;
    const hierarchy = resolvePageHierarchy(database, resource.pageId);
    return {
      libraryId: hierarchy.libraryId,
      owningDatabaseIds:
        hierarchy.terminal.kind === "data_source"
          ? [hierarchy.terminal.databaseId]
          : [],
      pageAncestorIds: hierarchy.pageIds,
      preferredGrantRoot: { kind: "page", pageId: resource.pageId },
    };
  }

  if (resource.kind === "database") {
    const container = database.prepare(`
      SELECT library_id AS libraryId
      FROM database_containers WHERE block_id = ?
    `).get(resource.databaseId) as { readonly libraryId: string } | undefined;
    if (!container) return null;
    return {
      libraryId: container.libraryId,
      owningDatabaseIds: [resource.databaseId],
      pageAncestorIds: readDatabasePageAncestors(database, resource.databaseId),
      preferredGrantRoot: {
        kind: "database",
        databaseId: resource.databaseId,
      },
    };
  }

  if (resource.kind === "data_source") {
    const source = database.prepare(`
      SELECT library_id AS libraryId,
        home_database_block_id AS databaseId
      FROM data_sources WHERE id = ?
    `).get(resource.dataSourceId) as
      | { readonly libraryId: string; readonly databaseId: string }
      | undefined;
    if (!source) return null;
    return {
      libraryId: source.libraryId,
      owningDatabaseIds: [source.databaseId],
      pageAncestorIds: readDatabasePageAncestors(database, source.databaseId),
      preferredGrantRoot: {
        kind: "database",
        databaseId: source.databaseId,
      },
    };
  }

  const view = database.prepare(`
    SELECT
      container.library_id AS libraryId,
      view.database_block_id AS hostDatabaseId,
      source.home_database_block_id AS sourceDatabaseId
    FROM database_views view
    INNER JOIN database_containers container
      ON container.block_id = view.database_block_id
    INNER JOIN data_sources source ON source.id = view.data_source_id
    WHERE view.id = ?
  `).get(resource.viewId) as
    | {
        readonly libraryId: string;
        readonly hostDatabaseId: string;
        readonly sourceDatabaseId: string;
      }
    | undefined;
  if (!view) return null;
  return {
    libraryId: view.libraryId,
    owningDatabaseIds: uniqueSorted([
      view.hostDatabaseId,
      view.sourceDatabaseId,
    ]),
    pageAncestorIds: readDatabasePageAncestors(
      database,
      view.hostDatabaseId,
    ),
    preferredGrantRoot: {
      kind: "database",
      databaseId: view.hostDatabaseId,
    },
  };
};

const readGrantMatch = (
  database: Database.Database,
  projectId: string,
  coordinates: ResourceCoordinates,
): GrantMatch | null => {
  const databaseIds = new Set(coordinates.owningDatabaseIds);
  const pageIds = new Set(coordinates.pageAncestorIds);
  const rows = database.prepare(`
    SELECT id, root_kind, root_id, access
    FROM project_resource_grants
    WHERE project_id = ? AND lifecycle = 'active'
    ORDER BY CASE access WHEN 'read_write' THEN 0 ELSE 1 END,
      CASE root_kind WHEN 'page' THEN 0 ELSE 1 END,
      created_at ASC, id ASC
  `).all(projectId) as readonly GrantMatch[];
  const row = rows.find((candidate) =>
    candidate.root_kind === "page"
      ? pageIds.has(candidate.root_id)
      : databaseIds.has(candidate.root_id),
  );
  return row ?? null;
};

/**
 * Return the contiguous target-to-root Page prefix readable by one Project.
 * The caller supplies a hierarchy resolved in the same read transaction, so
 * visibility is computed with one grant scan instead of re-walking every
 * ancestor hierarchy.
 */
export const readAuthorizedPageHierarchyPrefixInDatabase = (
  database: Database.Database,
  input: Readonly<{
    projectId: string;
    hierarchy: PageHierarchy;
  }>,
): readonly string[] => {
  const project = readProjectAuthority(database, input.projectId);
  if (!project || project.library_id !== input.hierarchy.libraryId) return [];

  const grants = database.prepare(`
    SELECT id, root_kind, root_id, access
    FROM project_resource_grants
    WHERE project_id = ? AND lifecycle = 'active'
  `).all(input.projectId) as readonly GrantMatch[];
  const owningDatabaseId = input.hierarchy.terminal.kind === "data_source"
    ? input.hierarchy.terminal.databaseId
    : null;
  const hasWholeHierarchyAccess = owningDatabaseId !== null && (
    owningDatabaseId === project.database_block_id
    || grants.some((grant) =>
      grant.root_kind === "database" && grant.root_id === owningDatabaseId)
  );
  if (hasWholeHierarchyAccess) return input.hierarchy.pageIds;

  const pageIndexById = new Map(
    input.hierarchy.pageIds.map((pageId, index) => [pageId, index]),
  );
  const furthestVisibleIndex = grants.reduce((furthest, grant) => {
    if (grant.root_kind !== "page") return furthest;
    return Math.max(furthest, pageIndexById.get(grant.root_id) ?? -1);
  }, -1);
  return input.hierarchy.pageIds.slice(0, furthestVisibleIndex + 1);
};

const deny = (
  projectId: string,
  resource: LibraryResource,
  action: ProjectResourceAction,
  reason: ProjectResourceAuthorization["reason"],
  project: ProjectAuthorityRow | null = null,
  libraryId: string | null = null,
): ProjectResourceAuthorization => ({
  allowed: false,
  projectId,
  projectLifecycle: project?.lifecycle ?? null,
  resource,
  action,
  libraryId,
  effectiveAccess: null,
  source: null,
  grantId: null,
  reason,
});

const DATABASE_MANAGEMENT_ACTIONS = new Set<ProjectResourceAction>([
  "manage_schema",
  "manage_views",
  "manage_database",
]);

export const authorizeProjectResourceInDatabase = (
  database: Database.Database,
  input: Readonly<{
    projectId: string;
    resource: LibraryResource;
    action: ProjectResourceAction;
  }>,
): ProjectResourceAuthorization => {
  const projectId = normalizeIdentity(input.projectId, "projectId");
  const project = readProjectAuthority(database, projectId);
  if (!project) {
    return deny(projectId, input.resource, input.action, "project_not_found");
  }

  let coordinates: ResourceCoordinates | null;
  try {
    coordinates = readResourceCoordinates(database, input.resource);
  } catch (error) {
    if (!(error instanceof PageHierarchyError)) throw error;
    return deny(
      projectId,
      input.resource,
      input.action,
      "resource_hierarchy_corrupt",
      project,
    );
  }
  if (!coordinates) {
    return deny(
      projectId,
      input.resource,
      input.action,
      "resource_not_found",
      project,
    );
  }
  if (coordinates.libraryId !== project.library_id) {
    return deny(
      projectId,
      input.resource,
      input.action,
      "library_mismatch",
      project,
      coordinates.libraryId,
    );
  }

  const implicit = coordinates.owningDatabaseIds.includes(
    project.database_block_id,
  );
  const grant = implicit
    ? null
    : readGrantMatch(database, projectId, coordinates);
  if (!implicit && !grant) {
    return deny(
      projectId,
      input.resource,
      input.action,
      "grant_missing",
      project,
      coordinates.libraryId,
    );
  }

  const source: ProjectResourceAuthorizationSource = implicit
    ? "implicit_database_binding"
    : grant?.root_kind === "page"
      ? "explicit_page_grant"
      : "explicit_database_grant";
  const effectiveAccess = implicit ? "read_write" : (grant?.access ?? "read");
  const base = {
    projectId,
    projectLifecycle: project.lifecycle,
    resource: input.resource,
    action: input.action,
    libraryId: coordinates.libraryId,
    effectiveAccess,
    source,
    grantId: grant?.id ?? null,
  } as const;

  if (input.action === "read") {
    return { ...base, allowed: true, reason: "allowed" };
  }
  if (project.lifecycle !== "active") {
    return { ...base, allowed: false, reason: "project_read_only" };
  }
  if (DATABASE_MANAGEMENT_ACTIONS.has(input.action) && !implicit) {
    return {
      ...base,
      allowed: false,
      reason: "structural_capability_required",
    };
  }
  if (effectiveAccess !== "read_write") {
    return { ...base, allowed: false, reason: "grant_read_only" };
  }
  return { ...base, allowed: true, reason: "allowed" };
};

export const authorizeProjectResource = (input: Readonly<{
  projectId: string;
  resource: LibraryResource;
  action: ProjectResourceAction;
}>): ProjectResourceAuthorization =>
  authorizeProjectResourceInDatabase(getDb(), input);

const grantRootKey = (root: NodexAgentResourceGrantRoot): string => {
  if (root.kind === "page") return `page:${root.pageId}`;
  if (root.kind === "database") return `database:${root.databaseId}`;
  return `library:${root.libraryId}`;
};

const overlayIdentityMatches = (
  authority: FrozenNodexAgentTurnAuthority,
  overlay: NodexAgentResourceAccessOverlay,
  callId: string | undefined,
  phase: "prepare" | "execute",
): boolean => {
  if (
    overlay.actorProjectId !== authority.actorProjectId
    || overlay.libraryId !== authority.libraryId
    || overlay.storeEpoch !== authority.storeEpoch
    || overlay.rootThreadId !== authority.rootThreadId
  ) return false;
  if (overlay.kind === "inspection" && phase !== "prepare") return false;
  if (overlay.scope === "task") return overlay.kind === "consent";
  return overlay.threadId === authority.threadId
    && overlay.turnId === authority.turnId
    && overlay.callId === callId;
};

const grantAccessCoversAction = (
  access: NodexAgentResourceGrantSpec["access"],
  action: ProjectResourceAction,
): boolean => action === "read" || access === "read_write";

const grantCoversCoordinates = (
  grant: NodexAgentResourceGrantSpec,
  coordinates: ResourceCoordinates,
  action: ProjectResourceAction,
): boolean => {
  if (!grantAccessCoversAction(grant.access, action)) return false;
  if (grant.root.kind === "page") {
    return coordinates.pageAncestorIds.includes(grant.root.pageId);
  }
  if (grant.root.kind === "database") {
    return coordinates.owningDatabaseIds.includes(grant.root.databaseId);
  }
  return false;
};

const overlayCoversResource = (
  authority: FrozenNodexAgentTurnAuthority,
  overlay: NodexAgentResourceAccessOverlay | undefined,
  coordinates: ResourceCoordinates,
  action: ProjectResourceAction,
  callId: string | undefined,
  phase: "prepare" | "execute",
): NodexAgentResourceGrantSpec | null => {
  if (!overlay || !overlayIdentityMatches(authority, overlay, callId, phase)) {
    return null;
  }
  return overlay.grants.find((grant) =>
    grantCoversCoordinates(grant, coordinates, action)
  ) ?? null;
};

const overlayCoversLibraryTarget = (
  authority: FrozenNodexAgentTurnAuthority,
  overlay: NodexAgentResourceAccessOverlay | undefined,
  target: Extract<NodexAgentAuthorizationTarget, { readonly kind: "library" }>,
  action: ProjectResourceAction,
  callId: string,
): boolean => {
  if (!overlay || !overlayIdentityMatches(authority, overlay, callId, "execute")) {
    return false;
  }
  return overlay.grants.some((grant) =>
    grant.root.kind === "library"
    && grant.root.libraryId === target.libraryId
    && grantAccessCoversAction(grant.access, action)
    && grant.libraryActions?.includes("create_child") === true
    && action === "create_child"
  );
};

const CONSENT_ELIGIBLE_REASONS = new Set<
  ProjectResourceAuthorization["reason"]
>(["grant_missing", "grant_read_only"]);

const isNodexAgentResourceActive = (
  database: Database.Database,
  resource: LibraryResource,
): boolean => {
  if (resource.kind === "page") {
    return Boolean(database.prepare(`
      SELECT 1
      FROM pages page
      INNER JOIN blocks block ON block.id = page.block_id
      WHERE page.block_id = ?
        AND page.lifecycle <> 'deleted'
        AND block.lifecycle <> 'deleted'
    `).get(resource.pageId));
  }
  if (resource.kind === "database") {
    return Boolean(database.prepare(`
      SELECT 1
      FROM database_containers container
      INNER JOIN blocks block ON block.id = container.block_id
      WHERE container.block_id = ?
        AND container.lifecycle <> 'deleted'
        AND block.lifecycle <> 'deleted'
    `).get(resource.databaseId));
  }
  if (resource.kind === "data_source") {
    return Boolean(database.prepare(`
      SELECT 1 FROM data_sources
      WHERE id = ? AND lifecycle = 'active'
    `).get(resource.dataSourceId));
  }
  return Boolean(database.prepare(`
    SELECT 1
    FROM database_views view
    INNER JOIN database_containers container
      ON container.block_id = view.database_block_id
    INNER JOIN data_sources source ON source.id = view.data_source_id
    WHERE view.id = ?
      AND view.lifecycle = 'active'
      AND container.lifecycle <> 'deleted'
      AND source.lifecycle = 'active'
  `).get(resource.viewId));
};

export const authorizeNodexAgentResourceInDatabase = (
  database: Database.Database,
  input: Readonly<{
    authority: FrozenNodexAgentTurnAuthority;
    resource: LibraryResource;
    action: ProjectResourceAction;
    resourceAccess?: NodexAgentResourceAccessOverlay;
    callId?: string;
    phase?: "prepare" | "execute";
  }>,
): ProjectResourceAuthorization => {
  const { authority } = input;
  const project = readProjectAuthority(database, authority.actorProjectId);
  if (!project) {
    return deny(
      authority.actorProjectId,
      input.resource,
      input.action,
      "project_not_found",
    );
  }
  if (
    project.library_id !== authority.libraryId
    || readBlockStoreEpoch(database) !== authority.storeEpoch
  ) {
    return deny(
      authority.actorProjectId,
      input.resource,
      input.action,
      "authority_stale",
      project,
      authority.libraryId,
    );
  }
  if (!isNodexAgentResourceActive(database, input.resource)) {
    return deny(
      authority.actorProjectId,
      input.resource,
      input.action,
      "resource_not_found",
      project,
    );
  }
  if (authority.scope === "project") {
    const authorization = authorizeProjectResourceInDatabase(database, {
      projectId: authority.actorProjectId,
      resource: input.resource,
      action: input.action,
    });
    if (authorization.allowed || !CONSENT_ELIGIBLE_REASONS.has(
      authorization.reason,
    )) return authorization;
    let coordinates: ResourceCoordinates | null;
    try {
      coordinates = readResourceCoordinates(database, input.resource);
    } catch (error) {
      if (!(error instanceof PageHierarchyError)) throw error;
      return authorization;
    }
    if (!coordinates) return authorization;
    const grant = overlayCoversResource(
      authority,
      input.resourceAccess,
      coordinates,
      input.action,
      input.callId,
      input.phase ?? "execute",
    );
    if (!grant) return authorization;
    return {
      ...authorization,
      allowed: true,
      effectiveAccess: grant.access,
      source: "thread_resource_consent",
      grantId: null,
      reason: "allowed",
    };
  }
  if (project.lifecycle !== "active") {
    return deny(
      authority.actorProjectId,
      input.resource,
      input.action,
      "project_read_only",
      project,
    );
  }

  let coordinates: ResourceCoordinates | null;
  try {
    coordinates = readResourceCoordinates(database, input.resource);
  } catch (error) {
    if (!(error instanceof PageHierarchyError)) throw error;
    return deny(
      authority.actorProjectId,
      input.resource,
      input.action,
      "resource_hierarchy_corrupt",
      project,
    );
  }
  if (!coordinates) {
    return deny(
      authority.actorProjectId,
      input.resource,
      input.action,
      "resource_not_found",
      project,
    );
  }
  if (coordinates.libraryId !== authority.libraryId) {
    return deny(
      authority.actorProjectId,
      input.resource,
      input.action,
      "library_mismatch",
      project,
      coordinates.libraryId,
    );
  }

  const base = {
    projectId: authority.actorProjectId,
    projectLifecycle: project.lifecycle,
    resource: input.resource,
    action: input.action,
    libraryId: coordinates.libraryId,
    effectiveAccess: "read_write",
    source: "thread_full_access",
    grantId: null,
  } as const;
  return { ...base, allowed: true, reason: "allowed" };
};

const resolvePageOrBlockTarget = (
  database: Database.Database,
  target: Extract<
    NodexAgentAuthorizationTarget,
    { readonly kind: "page_or_block" }
  >,
): LibraryResource | null => {
  const row = database.prepare(`
    SELECT page.block_id AS pageId
    FROM pages page
    INNER JOIN blocks page_block ON page_block.id = page.block_id
    WHERE page.block_id = ?
      AND page.lifecycle <> 'deleted'
      AND page_block.lifecycle <> 'deleted'
    UNION ALL
    SELECT ownership.block_id AS pageId
    FROM blocks block
    INNER JOIN block_documents ownership
      ON ownership.document_id = block.containing_document_id
    INNER JOIN pages page ON page.block_id = ownership.block_id
    INNER JOIN blocks page_block ON page_block.id = page.block_id
    WHERE block.id = ?
      AND block.location_kind = 'document'
      AND block.lifecycle <> 'deleted'
      AND page.lifecycle <> 'deleted'
      AND page_block.lifecycle <> 'deleted'
    LIMIT 1
  `).get(target.id, target.id) as { readonly pageId: string } | undefined;
  return row ? { kind: "page", pageId: row.pageId } : null;
};

const requirementAccess = (
  action: ProjectResourceAction,
): NodexAgentResourceGrantSpec["access"] =>
  action === "read" ? "read" : "read_write";

const canonicalizeConsentRequirements = (
  requirements: readonly NodexAgentResourceConsentRequirement[],
): readonly NodexAgentResourceConsentRequirement[] => {
  const byRoot = new Map<string, NodexAgentResourceConsentRequirement>();
  for (const requirement of requirements) {
    const key = grantRootKey(requirement.grant.root);
    const current = byRoot.get(key);
    if (!current || (
      current.grant.access === "read"
      && requirement.grant.access === "read_write"
    )) {
      byRoot.set(key, requirement);
    }
  }
  return [...byRoot.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, requirement]) => requirement);
};

const inspectionOverlay = (
  authority: FrozenNodexAgentTurnAuthority,
  callId: string,
  grants: readonly NodexAgentResourceGrantSpec[],
): NodexAgentResourceAccessOverlay => ({
  kind: "inspection",
  scope: "call",
  threadId: authority.threadId,
  turnId: authority.turnId,
  callId,
  rootThreadId: authority.rootThreadId,
  actorProjectId: authority.actorProjectId,
  libraryId: authority.libraryId,
  storeEpoch: authority.storeEpoch,
  grants: canonicalizeNodexAgentResourceGrantSpecs(grants),
});

export const planNodexAgentResourceAccessInDatabase = (
  database: Database.Database,
  input: Readonly<{
    authority: FrozenNodexAgentTurnAuthority;
    callId: string;
    intents: readonly NodexAgentResourceIntent[];
    taskAccess?: NodexAgentResourceAccessOverlay;
  }>,
): NodexAgentResourceAccessPlan => {
  const requirements: NodexAgentResourceConsentRequirement[] = [];
  let usesTaskAccess = false;
  for (const intent of input.intents) {
    if (intent.target.kind === "library") {
      const project = readProjectAuthority(database, input.authority.actorProjectId);
      const reason = !project
        ? "project_not_found" as const
        : project.library_id !== input.authority.libraryId
          || readBlockStoreEpoch(database) !== input.authority.storeEpoch
          ? "authority_stale" as const
          : intent.target.libraryId !== input.authority.libraryId
            ? "library_mismatch" as const
            : project.lifecycle !== "active"
              ? "project_read_only" as const
              : null;
      if (reason) return { kind: "denied", intent, reason };
      if (input.authority.scope === "library") continue;
      if (intent.action !== "create_child") {
        return {
          kind: "denied",
          intent,
          reason: "structural_capability_required",
        };
      }
      if (overlayCoversLibraryTarget(
        input.authority,
        input.taskAccess,
        intent.target,
        intent.action,
        input.callId,
      )) {
        usesTaskAccess = true;
        continue;
      }
      requirements.push({
        intent,
        grant: {
          root: intent.target,
          access: "read_write",
          libraryActions: ["create_child"],
        },
        reason: "library_consent_required",
        persistable: false,
      });
      continue;
    }

    const resource = intent.target.kind === "page_or_block"
      ? resolvePageOrBlockTarget(database, intent.target)
      : intent.target;
    if (!resource) {
      return { kind: "denied", intent, reason: "resource_not_found" };
    }
    const direct = authorizeNodexAgentResourceInDatabase(database, {
      authority: input.authority,
      resource,
      action: intent.action,
    });
    if (direct.allowed) continue;
    if (input.taskAccess) {
      const covered = authorizeNodexAgentResourceInDatabase(database, {
        authority: input.authority,
        resource,
        action: intent.action,
        resourceAccess: input.taskAccess,
        callId: input.callId,
        phase: "execute",
      });
      if (covered.allowed) {
        usesTaskAccess = true;
        continue;
      }
    }
    if (!CONSENT_ELIGIBLE_REASONS.has(direct.reason)) {
      return { kind: "denied", intent, reason: direct.reason };
    }
    const coordinates = readResourceCoordinates(database, resource);
    if (!coordinates) {
      return { kind: "denied", intent, reason: "resource_not_found" };
    }
    requirements.push({
      intent: { ...intent, target: resource },
      grant: {
        root: coordinates.preferredGrantRoot,
        access: requirementAccess(intent.action),
      },
      reason: direct.reason as "grant_missing" | "grant_read_only",
      persistable: true,
    });
  }

  const canonicalRequirements = canonicalizeConsentRequirements(requirements);
  if (canonicalRequirements.length === 0) {
    return {
      kind: "authorized",
      ...(usesTaskAccess && input.taskAccess
        ? { resourceAccess: input.taskAccess }
        : {}),
    };
  }
  const grants = [
    ...(input.taskAccess?.grants ?? []),
    ...canonicalRequirements.map((requirement) => requirement.grant),
  ];
  return {
    kind: "consent_required",
    requirements: canonicalRequirements,
    inspectionAccess: inspectionOverlay(input.authority, input.callId, grants),
  };
};

export const assertNodexAgentResourceIntentsAuthorizedInDatabase = (
  database: Database.Database,
  input: Readonly<{
    authority: FrozenNodexAgentTurnAuthority;
    callId: string;
    intents: readonly NodexAgentResourceIntent[];
    resourceAccess?: NodexAgentResourceAccessOverlay;
  }>,
): void => {
  const plan = planNodexAgentResourceAccessInDatabase(database, {
    authority: input.authority,
    callId: input.callId,
    intents: input.intents,
    ...(input.resourceAccess ? { taskAccess: input.resourceAccess } : {}),
  });
  if (plan.kind === "authorized") return;
  const reason = plan.kind === "denied"
    ? plan.reason
    : plan.requirements[0]?.reason ?? "grant_missing";
  throw new Error(`Nodex Agent authority denied: ${reason}`);
};

export const assertCurrentNodexAgentTurnAuthorityInDatabase = (
  database: Database.Database,
  authority: FrozenNodexAgentTurnAuthority | undefined,
): void => {
  if (!authority) return;
  const project = readProjectAuthority(database, authority.actorProjectId);
  if (!project) throw new Error("Nodex Agent actor Project no longer exists");
  if (
    project.library_id !== authority.libraryId
    || readBlockStoreEpoch(database) !== authority.storeEpoch
  ) {
    throw new Error("Nodex Agent Turn authority is stale");
  }
  if (project.lifecycle !== "active") {
    throw new Error("Nodex Agent actor Project is no longer active");
  }
};

export const assertNodexAgentResourceAuthorizationInDatabase = (
  database: Database.Database,
  input: Readonly<{
    authority: FrozenNodexAgentTurnAuthority | undefined;
    resource: LibraryResource;
    action: ProjectResourceAction;
    resourceAccess?: NodexAgentResourceAccessOverlay;
    callId?: string;
  }>,
): void => {
  if (!input.authority) return;
  const authorization = authorizeNodexAgentResourceInDatabase(database, {
    authority: input.authority,
    resource: input.resource,
    action: input.action,
    ...(input.resourceAccess ? { resourceAccess: input.resourceAccess } : {}),
    ...(input.callId ? { callId: input.callId } : {}),
    phase: "execute",
  });
  if (authorization.allowed) return;
  throw new Error(`Nodex Agent authority denied: ${authorization.reason}`);
};

const requireProjectLibrary = (
  database: Database.Database,
  projectId: string,
): Readonly<{ libraryId: string; project: ProjectAuthorityRow }> => {
  const project = readProjectAuthority(database, projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return {
    libraryId: project.library_id,
    project,
  };
};

const requireGrantRoot = (
  database: Database.Database,
  libraryId: string,
  input: PutProjectResourceGrantInput["root"],
): Readonly<{ rootKind: "page" | "database"; rootId: string }> => {
  const rootKind = input.kind;
  const rootId = normalizeIdentity(
    input.kind === "page" ? input.pageId : input.databaseId,
    `${input.kind}Id`,
  );
  const table = rootKind === "page" ? "pages" : "database_containers";
  const row = database.prepare(`
    SELECT library_id FROM ${table}
    WHERE block_id = ? AND lifecycle <> 'deleted'
  `).get(rootId) as { readonly library_id: string } | undefined;
  if (!row) throw new Error(`${rootKind} not found: ${rootId}`);
  if (row.library_id !== libraryId) {
    throw new Error(`${rootKind} ${rootId} belongs to another Library`);
  }
  return { rootKind, rootId };
};

export const putProjectResourceGrantInDatabase = (
  database: Database.Database,
  input: PutProjectResourceGrantInput,
  now = new Date().toISOString(),
): ProjectResourceGrant => {
  const projectId = normalizeIdentity(input.projectId, "projectId");
  const { libraryId } = requireProjectLibrary(database, projectId);
  const root = requireGrantRoot(database, libraryId, input.root);
  if (input.access !== "read" && input.access !== "read_write") {
    throw new TypeError("Project resource grant access is invalid");
  }

  const grantId = randomUUID();
  database.prepare(`
    INSERT INTO project_resource_grants (
      id, project_id, library_id, root_kind, root_id, access, recursive,
      revision, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'active', ?, ?)
    ON CONFLICT(project_id, root_kind, root_id) DO UPDATE SET
      access = excluded.access,
      lifecycle = 'active',
      revision = project_resource_grants.revision + 1,
      updated_at = excluded.updated_at
  `).run(
    grantId,
    projectId,
    libraryId,
    root.rootKind,
    root.rootId,
    input.access,
    now,
    now,
  );
  const row = database.prepare(`
    SELECT * FROM project_resource_grants
    WHERE project_id = ? AND root_kind = ? AND root_id = ?
  `).get(projectId, root.rootKind, root.rootId) as GrantRow | undefined;
  if (!row) throw new Error("Project resource grant was not persisted");
  return rowToGrant(row);
};

export const putProjectResourceGrant = (
  input: PutProjectResourceGrantInput,
): ProjectResourceGrant => putProjectResourceGrantInDatabase(getDb(), input);

export const persistNodexAgentProjectResourceGrantsInDatabase = (
  database: Database.Database,
  input: PersistNodexAgentProjectResourceGrantsInput,
  now = new Date().toISOString(),
): readonly ProjectResourceGrant[] => database.transaction(() => {
  assertCurrentNodexAgentTurnAuthorityInDatabase(database, input.authority);
  if (input.authority.scope !== "project") {
    throw new Error("Full-access authority cannot persist Project resource grants");
  }
  const grants = canonicalizeNodexAgentResourceGrantSpecs(input.grants);
  if (grants.some((grant) => grant.root.kind === "library")) {
    throw new Error("Library consent cannot be persisted as a Project resource grant");
  }
  return grants.map((grant) => {
    if (grant.root.kind === "library") {
      throw new Error("Library consent cannot be persisted as a Project resource grant");
    }
    return putProjectResourceGrantInDatabase(database, {
      projectId: input.authority.actorProjectId,
      root: grant.root,
      access: grant.access,
    }, now);
  });
}).immediate();

export const revokeProjectResourceGrantInDatabase = (
  database: Database.Database,
  input: RevokeProjectResourceGrantInput,
  now = new Date().toISOString(),
): ProjectResourceGrant | null => {
  const projectId = normalizeIdentity(input.projectId, "projectId");
  const grantId = normalizeIdentity(input.grantId, "grantId");
  const result = database.prepare(`
    UPDATE project_resource_grants
    SET lifecycle = 'revoked', revision = revision + 1, updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = 'active'
  `).run(now, grantId, projectId);
  if (result.changes === 0) return null;
  const row = database.prepare(`
    SELECT * FROM project_resource_grants WHERE id = ?
  `).get(grantId) as GrantRow | undefined;
  return row ? rowToGrant(row) : null;
};

export const revokeProjectResourceGrant = (
  input: RevokeProjectResourceGrantInput,
): ProjectResourceGrant | null =>
  revokeProjectResourceGrantInDatabase(getDb(), input);

export const listProjectResourceGrantsInDatabase = (
  database: Database.Database,
  projectId: string,
): readonly ProjectResourceGrant[] => {
  const normalizedProjectId = normalizeIdentity(projectId, "projectId");
  return (database.prepare(`
    SELECT * FROM project_resource_grants
    WHERE project_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(normalizedProjectId) as readonly GrantRow[]).map(rowToGrant);
};

export const listProjectResourceGrants = (
  projectId: string,
): readonly ProjectResourceGrant[] =>
  listProjectResourceGrantsInDatabase(getDb(), projectId);
