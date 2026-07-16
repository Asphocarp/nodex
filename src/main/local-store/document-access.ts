import type Database from "better-sqlite3";

import type {
  DocumentAccessAck,
  DocumentAccessRequest,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
} from "../../shared/block-documents/document-sync";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";

interface PageDocumentRow {
  readonly pageId: string;
  readonly lifecycle: "active" | "archived" | "deleted";
}

const failure = (
  code: DocumentSyncCommandError["code"],
  message: string,
): DocumentSyncCommandResult<DocumentAccessAck> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: false,
    resetRequired: false,
  },
});

const isExactIdentity = (value: string): boolean =>
  value.length > 0 && value === value.trim() && value.length <= 512;

/**
 * Resolves a Project-bound editor request without changing durable Document
 * identity. Page Documents follow Library resource grants; every other owned
 * Document retains its exact physical Project boundary.
 */
export const authorizeDocumentAccessInDatabase = (
  database: Database.Database,
  request: DocumentAccessRequest,
): DocumentSyncCommandResult<DocumentAccessAck> => {
  if (
    !isExactIdentity(request.projectId) ||
    !isExactIdentity(request.documentId) ||
    (request.access !== "read" && request.access !== "write")
  ) {
    return failure("unauthorized", "Document access identity is invalid");
  }

  const page = database.prepare(`
    SELECT block_id AS pageId, lifecycle
    FROM pages
    WHERE document_id = ?
  `).get(request.documentId) as PageDocumentRow | undefined;

  if (page) {
    const authorization = authorizeProjectResourceInDatabase(database, {
      projectId: request.projectId,
      resource: { kind: "page", pageId: page.pageId },
      action: request.access,
    });
    if (!authorization.allowed) {
      return failure(
        "unauthorized",
        "Page Document is not available in the requesting Project",
      );
    }
    if (request.access === "write" && page.lifecycle !== "active") {
      return failure("unauthorized", "Page Document is not writable");
    }
    return { ok: true, value: { ...request, authorized: true } };
  }

  const document = database.prepare(`
    SELECT project_id AS projectId FROM documents WHERE id = ?
  `).get(request.documentId) as { readonly projectId: string } | undefined;
  if (!document || document.projectId !== request.projectId) {
    return failure(
      "document_not_found",
      "Document does not exist in the requesting Project",
    );
  }
  return { ok: true, value: { ...request, authorized: true } };
};
