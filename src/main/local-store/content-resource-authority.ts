import type Database from "better-sqlite3";

import type { ContentAccessContext } from "../../shared/content-access-context";
import type {
  LibraryResource,
  ProjectResourceAction,
  ProjectResourceAuthorization,
} from "../../shared/resource-authorization";
import { requireBlockStoreEpoch } from "./block-store-metadata";
import { requireLocalProfileLibraryInDatabase } from "./local-profile-library";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";

export type ContentAccessActor =
  | "app_window"
  | "http_loopback"
  | "project_agent";

export type ContentResourceAuthority =
  | Readonly<{
      kind: "local_user_library";
      actor: "app_window" | "http_loopback";
      profileId: string;
      libraryId: string;
      storeEpoch: string;
    }>
  | Readonly<{
      kind: "project";
      actor: ContentAccessActor;
      projectId: string;
      profileId: string;
      libraryId: string;
      storeEpoch: string;
    }>;

export type ContentResourceAuthorization =
  | Readonly<{
      allowed: boolean;
      authorityKind: "local_user_library";
      resource: LibraryResource;
      action: ProjectResourceAction;
      libraryId: string | null;
      reason:
        | "allowed"
        | "resource_not_found"
        | "library_mismatch"
        | "authority_stale"
        | "resource_archived";
    }>
  | Readonly<{
      authorityKind: "project";
      authorization: ProjectResourceAuthorization;
    }>;

interface ProjectAuthorityIdentityRow {
  readonly projectId: string;
  readonly profileId: string;
  readonly libraryId: string;
}

interface ResourceIdentityRow {
  readonly libraryId: string;
  readonly lifecycle: "active" | "archived" | "deleted";
}

const readProjectAuthorityIdentity = (
  database: Database.Database,
  projectId: string,
): ProjectAuthorityIdentityRow | null =>
  (database.prepare(`
    SELECT project.id AS projectId, library.profile_id AS profileId,
      project.library_id AS libraryId
    FROM projects project
    INNER JOIN libraries library ON library.id = project.library_id
    WHERE project.id = ?
  `).get(projectId) as ProjectAuthorityIdentityRow | undefined) ?? null;

const readResourceIdentity = (
  database: Database.Database,
  resource: LibraryResource,
): ResourceIdentityRow | null => {
  if (resource.kind === "page") {
    return (database.prepare(`
      SELECT library_id AS libraryId, lifecycle
      FROM pages WHERE block_id = ?
    `).get(resource.pageId) as ResourceIdentityRow | undefined) ?? null;
  }
  if (resource.kind === "database") {
    return (database.prepare(`
      SELECT library_id AS libraryId, lifecycle
      FROM database_containers WHERE block_id = ?
    `).get(resource.databaseId) as ResourceIdentityRow | undefined) ?? null;
  }
  if (resource.kind === "data_source") {
    return (database.prepare(`
      SELECT library_id AS libraryId, lifecycle
      FROM data_sources WHERE id = ?
    `).get(resource.dataSourceId) as ResourceIdentityRow | undefined) ?? null;
  }
  return (database.prepare(`
    SELECT container.library_id AS libraryId,
      CASE
        WHEN container.lifecycle = 'deleted' OR view.lifecycle = 'deleted'
          THEN 'deleted'
        WHEN container.lifecycle = 'archived' THEN 'archived'
        ELSE 'active'
      END AS lifecycle
    FROM database_views view
    INNER JOIN database_containers container
      ON container.block_id = view.database_block_id
    WHERE view.id = ?
  `).get(resource.viewId) as ResourceIdentityRow | undefined) ?? null;
};

export const resolveContentResourceAuthorityInDatabase = (
  database: Database.Database,
  input: Readonly<{
    context: ContentAccessContext;
    actor: ContentAccessActor;
  }>,
): ContentResourceAuthority => {
  const local = requireLocalProfileLibraryInDatabase(database);
  const storeEpoch = requireBlockStoreEpoch(database);
  if (input.context.kind === "library") {
    if (input.actor === "project_agent") {
      throw new Error("A Project Agent cannot claim local Library authority");
    }
    return {
      kind: "local_user_library",
      actor: input.actor,
      profileId: local.profileId,
      libraryId: local.libraryId,
      storeEpoch,
    };
  }

  const project = readProjectAuthorityIdentity(
    database,
    input.context.projectId,
  );
  if (!project) throw new Error(`Project ${input.context.projectId} not found`);
  if (
    project.profileId !== local.profileId ||
    project.libraryId !== local.libraryId
  ) {
    throw new Error("Project authority does not belong to the local Profile Library");
  }
  return {
    kind: "project",
    actor: input.actor,
    projectId: project.projectId,
    profileId: project.profileId,
    libraryId: project.libraryId,
    storeEpoch,
  };
};

const localUserAuthorityIsCurrent = (
  database: Database.Database,
  authority: Extract<ContentResourceAuthority, { kind: "local_user_library" }>,
): boolean => {
  const local = requireLocalProfileLibraryInDatabase(database);
  return local.profileId === authority.profileId
    && local.libraryId === authority.libraryId
    && requireBlockStoreEpoch(database) === authority.storeEpoch;
};

export const authorizeContentResourceInDatabase = (
  database: Database.Database,
  input: Readonly<{
    authority: ContentResourceAuthority;
    resource: LibraryResource;
    action: ProjectResourceAction;
  }>,
): ContentResourceAuthorization => {
  if (input.authority.kind === "project") {
    const local = requireLocalProfileLibraryInDatabase(database);
    const isCurrent = input.authority.profileId === local.profileId
      && input.authority.libraryId === local.libraryId
      && input.authority.storeEpoch === requireBlockStoreEpoch(database);
    if (!isCurrent) {
      return {
        authorityKind: "project",
        authorization: {
          allowed: false,
          projectId: input.authority.projectId,
          projectLifecycle: null,
          resource: input.resource,
          action: input.action,
          libraryId: null,
          effectiveAccess: null,
          source: null,
          grantId: null,
          reason: "authority_stale",
        },
      };
    }
    return {
      authorityKind: "project",
      authorization: authorizeProjectResourceInDatabase(database, {
        projectId: input.authority.projectId,
        resource: input.resource,
        action: input.action,
      }),
    };
  }

  if (!localUserAuthorityIsCurrent(database, input.authority)) {
    return {
      allowed: false,
      authorityKind: "local_user_library",
      resource: input.resource,
      action: input.action,
      libraryId: null,
      reason: "authority_stale",
    };
  }
  const identity = readResourceIdentity(database, input.resource);
  if (!identity || identity.lifecycle === "deleted") {
    return {
      allowed: false,
      authorityKind: "local_user_library",
      resource: input.resource,
      action: input.action,
      libraryId: identity?.libraryId ?? null,
      reason: "resource_not_found",
    };
  }
  if (identity.libraryId !== input.authority.libraryId) {
    return {
      allowed: false,
      authorityKind: "local_user_library",
      resource: input.resource,
      action: input.action,
      libraryId: identity.libraryId,
      reason: "library_mismatch",
    };
  }
  if (identity.lifecycle === "archived" && input.action !== "read") {
    return {
      allowed: false,
      authorityKind: "local_user_library",
      resource: input.resource,
      action: input.action,
      libraryId: identity.libraryId,
      reason: "resource_archived",
    };
  }
  return {
    allowed: true,
    authorityKind: "local_user_library",
    resource: input.resource,
    action: input.action,
    libraryId: identity.libraryId,
    reason: "allowed",
  };
};
