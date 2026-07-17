import type Database from "better-sqlite3";
import type { DocumentId } from "../../shared/nodex-agent-tools";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import type { NodexAgentResourceAccessOverlay } from "../../shared/nodex-agent-resource-access";
import type { ProjectResourceAction } from "../../shared/resource-authorization";
import {
  authorizeNodexAgentResourceInDatabase,
  authorizeProjectResourceInDatabase,
} from "../local-store/project-resource-grants";
import { NodexAgentReadError } from "./read-support";

export interface PageStorageContext {
  readonly pageId: string;
  readonly documentId: DocumentId;
  readonly contentProjectId: string;
  readonly libraryId: string;
  readonly parentKind: "library" | "page" | "data_source";
  readonly parentId: string;
}

export function requirePageStorageContext(
  database: Database.Database,
  projectId: string,
  pageId: string,
  action: ProjectResourceAction = "read",
  authority?: FrozenNodexAgentTurnAuthority,
  resourceAccess?: NodexAgentResourceAccessOverlay,
  callId?: string,
  phase: "prepare" | "execute" = "execute",
): PageStorageContext {
  const authorization = authority
    ? authorizeNodexAgentResourceInDatabase(database, {
        authority,
        resource: { kind: "page", pageId },
        action,
        ...(resourceAccess ? { resourceAccess } : {}),
        ...(callId ? { callId } : {}),
        phase,
      })
    : authorizeProjectResourceInDatabase(database, {
        projectId,
        resource: { kind: "page", pageId },
        action,
      });
  if (!authorization.allowed) {
    throw new NodexAgentReadError(
      authorization.reason === "resource_not_found" ? "not_found" : "authorization_denied",
      `Page ${pageId} ${action} denied: ${authorization.reason}`,
      false,
      "none",
      { resourceId: pageId, domainCode: authorization.reason },
    );
  }
  const row = database.prepare(`
    SELECT page.block_id AS pageId,
      page.document_id AS documentId,
      block.project_id AS contentProjectId,
      page.library_id AS libraryId,
      page.parent_kind AS parentKind,
      page.parent_id AS parentId
    FROM pages page
    INNER JOIN blocks block ON block.id = page.block_id
    WHERE page.block_id = ?
      AND page.lifecycle <> 'deleted'
      AND block.type = 'page'
      AND block.lifecycle <> 'deleted'
    LIMIT 1
  `).get(pageId) as PageStorageContext | undefined;
  if (row) return row;
  throw new NodexAgentReadError(
    "not_found",
    `Page ${pageId} was not found in the Library`,
    false,
    "none",
    { resourceId: pageId, domainCode: "page_not_found" },
  );
}

export function requirePageDocumentId(
  database: Database.Database,
  projectId: string,
  pageId: string,
  action: ProjectResourceAction = "read",
  authority?: FrozenNodexAgentTurnAuthority,
  resourceAccess?: NodexAgentResourceAccessOverlay,
  callId?: string,
  phase: "prepare" | "execute" = "execute",
): DocumentId {
  return requirePageStorageContext(
    database,
    projectId,
    pageId,
    action,
    authority,
    resourceAccess,
    callId,
    phase,
  ).documentId;
}

export function requireDocumentPageId(
  database: Database.Database,
  projectId: string,
  documentId: string,
): string {
  const row = database.prepare(
    `
    SELECT owner.id
    FROM block_documents ownership
    INNER JOIN blocks owner
      ON owner.id = ownership.block_id
     AND owner.project_id = ownership.project_id
    WHERE ownership.document_id = ?
      AND owner.type = 'page'
      AND owner.lifecycle <> 'deleted'
    LIMIT 1
  `).get(documentId) as { readonly id: string } | undefined;
  if (row) {
    requirePageStorageContext(database, projectId, row.id, "read");
    return row.id;
  }
  throw new NodexAgentReadError(
    "unsupported_resource",
    `Document ${documentId} is not owned by a Page`,
    false,
    "none",
    { resourceId: documentId, domainCode: "page_parent_required" },
  );
}

export function readPageLocation(
  database: Database.Database,
  projectId: string,
  pageId: string,
  authority?: FrozenNodexAgentTurnAuthority,
  resourceAccess?: NodexAgentResourceAccessOverlay,
  callId?: string,
) {
  const page = requirePageStorageContext(
    database,
    projectId,
    pageId,
    "read",
    authority,
    resourceAccess,
    callId,
  );
  return pageStorageLocation(page);
}

const pageStorageLocation = (
  page: Pick<PageStorageContext, "parentKind" | "parentId" | "libraryId">,
) => {
  if (page.parentKind === "library") {
    return { kind: "library" as const, libraryId: page.libraryId };
  }
  if (page.parentKind === "page") {
    return { kind: "page" as const, pageId: page.parentId };
  }
  return { kind: "data_source" as const, dataSourceId: page.parentId };
};

/** The caller must already hold mutation authority in the active transaction. */
export function readMutatedPageLocation(
  database: Database.Database,
  pageId: string,
) {
  const page = database.prepare(`
    SELECT library_id AS libraryId, parent_kind AS parentKind,
      parent_id AS parentId
    FROM pages
    WHERE block_id = ? AND lifecycle <> 'deleted'
  `).get(pageId) as Pick<
    PageStorageContext,
    "libraryId" | "parentKind" | "parentId"
  > | undefined;
  if (!page) throw new Error(`Mutated Page ${pageId} has no current location`);
  return pageStorageLocation(page);
}

/** The caller must already hold mutation authority in the active transaction. */
export function readMutatedPageDocumentId(
  database: Database.Database,
  pageId: string,
): DocumentId {
  const row = database.prepare(`
    SELECT ownership.document_id AS documentId
    FROM pages page
    INNER JOIN block_documents ownership ON ownership.block_id = page.block_id
    WHERE page.block_id = ? AND page.lifecycle <> 'deleted'
  `).get(pageId) as { readonly documentId: string } | undefined;
  if (!row) throw new Error(`Mutated Page ${pageId} has no owned Document`);
  return row.documentId as DocumentId;
}
