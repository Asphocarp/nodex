import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import type { ProjectResourceGrant } from "../../shared/library";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
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

export const authorizeNodexAgentResourceInDatabase = (
  database: Database.Database,
  input: Readonly<{
    authority: FrozenNodexAgentTurnAuthority;
    resource: LibraryResource;
    action: ProjectResourceAction;
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
  if (authority.scope === "project") {
    return authorizeProjectResourceInDatabase(database, {
      projectId: authority.actorProjectId,
      resource: input.resource,
      action: input.action,
    });
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
  }>,
): void => {
  if (!input.authority) return;
  const authorization = authorizeNodexAgentResourceInDatabase(database, {
    authority: input.authority,
    resource: input.resource,
    action: input.action,
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
  const idColumn = rootKind === "page" ? "block_id" : "block_id";
  const row = database.prepare(`
    SELECT library_id FROM ${table} WHERE ${idColumn} = ?
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
