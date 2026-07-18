import type Database from "better-sqlite3";

import type {
  DocumentAccessAck,
  DocumentAccessRequest,
  LibraryDocumentAccessAck,
  LibraryDocumentAccessRequest,
  DocumentSyncCommandError,
  DocumentSyncCommandResult,
} from "../../shared/block-documents/document-sync";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";
import { requireLocalProfileLibraryInDatabase } from "./local-profile-library";

interface PageDocumentRow {
  readonly pageId: string;
  readonly libraryId: string;
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
    SELECT block_id AS pageId, library_id AS libraryId, lifecycle
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

const libraryFailure = (
  code: DocumentSyncCommandError["code"],
  message: string,
): DocumentSyncCommandResult<LibraryDocumentAccessAck> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: false,
    resetRequired: false,
  },
});

/**
 * Resolves the trusted local human against the Page's Library identity. The
 * private compatibility `documents.project_id` coordinate is deliberately not
 * part of this authorization decision.
 */
export const authorizeLibraryDocumentAccessInDatabase = (
  database: Database.Database,
  request: LibraryDocumentAccessRequest,
): DocumentSyncCommandResult<LibraryDocumentAccessAck> => {
  if (
    !isExactIdentity(request.documentId) ||
    (request.access !== "read" && request.access !== "write")
  ) {
    return libraryFailure("unauthorized", "Document access identity is invalid");
  }

  const page = database.prepare(`
    SELECT block_id AS pageId, library_id AS libraryId, lifecycle
    FROM pages
    WHERE document_id = ?
  `).get(request.documentId) as PageDocumentRow | undefined;
  if (!page || page.lifecycle === "deleted") {
    return libraryFailure(
      "document_not_found",
      "Page Document does not exist in the local Library",
    );
  }

  const local = requireLocalProfileLibraryInDatabase(database);
  if (page.libraryId !== local.libraryId) {
    return libraryFailure(
      "unauthorized",
      "Page Document does not belong to the local Library",
    );
  }
  if (request.access === "write" && page.lifecycle !== "active") {
    return libraryFailure("unauthorized", "Page Document is not writable");
  }
  return { ok: true, value: { ...request, authorized: true } };
};
