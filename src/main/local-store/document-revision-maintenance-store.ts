import type Database from "better-sqlite3";
import type { ApplyDocumentUpdate } from "../../shared/block-documents";
import {
  DOCUMENT_REVISION_MAINTENANCE_VERSION,
  MAX_DOCUMENT_REVISION_MAINTENANCE_DOCUMENTS,
  type MaintainDocumentRevisionHistoryInput,
  type MaintainDocumentRevisionHistoryResult,
} from "../../shared/block-documents/document-revision-maintenance";
import {
  createDocumentVersionCheckpoint,
  DocumentVersionStoreError,
} from "./document-versions";
import {
  deleteDocumentRevisionSession,
  documentRevisionSessionIsIdle,
  documentRevisionSessionNeedsActiveCheckpoint,
  hasDocumentRevisionAtHead,
  hasDocumentUpdateReceipt,
  markDocumentRevisionSessionCheckpoint,
  readDocumentRevisionSession,
  type DocumentRevisionSession,
} from "./document-revision-session-store";

interface DocumentRevisionAuthorityRow {
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: string;
  readonly sync_engine: string;
}

const requireCanonicalTimestamp = (value: string): string => {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed) && new Date(parsed).toISOString() === value) {
    return value;
  }
  throw new TypeError("Document revision maintenance now must be canonical ISO");
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new TypeError("Block store metadata is unavailable");
};

const readAuthority = (
  database: Database.Database,
  documentId: string,
): DocumentRevisionAuthorityRow | null =>
  (database
    .prepare(
      `SELECT project_id, generation, head_seq, readiness, sync_engine
       FROM documents WHERE id = ?`,
    )
    .get(documentId) as DocumentRevisionAuthorityRow | undefined) ?? null;

interface FinalizeSessionResult {
  readonly kind: "finalized" | "already_covered" | "stale";
}

const finalizeSession = (
  database: Database.Database,
  input: {
    readonly storeEpoch: string;
    readonly now: string;
    readonly session: DocumentRevisionSession;
    readonly cause: "active_edit" | "idle_edit" | "shutdown_flush";
    readonly finalize: boolean;
  },
): FinalizeSessionResult => {
  const authority = readAuthority(database, input.session.documentId);
  if (
    !authority ||
    authority.generation !== input.session.generation ||
    authority.readiness !== "ready" ||
    authority.sync_engine !== "yjs"
  ) {
    deleteDocumentRevisionSession(database, input.session.documentId);
    return { kind: "stale" };
  }
  const coordinates = {
    documentId: input.session.documentId,
    generation: authority.generation,
    headSeq: authority.head_seq,
  };
  if (hasDocumentRevisionAtHead(database, coordinates)) {
    markDocumentRevisionSessionCheckpoint(database, {
      ...coordinates,
      checkpointHeadSeq: coordinates.headSeq,
      createdAt: input.now,
      finalize: input.finalize,
    });
    return { kind: "already_covered" };
  }
  const created = createDocumentVersionCheckpoint(
    database,
    {
      version: 1,
      projectId: authority.project_id,
      storeEpoch: input.storeEpoch,
      documentId: input.session.documentId,
      expectedGeneration: authority.generation,
      expectedHeadSeq: authority.head_seq,
      cause: input.cause,
      revisionKind: "automatic",
      actor: {
        kind: "document_revision_maintenance",
        boundary: input.cause,
        clientSessionId: input.session.clientSessionId,
      },
    },
    { now: () => input.now },
  );
  markDocumentRevisionSessionCheckpoint(database, {
    documentId: input.session.documentId,
    generation: authority.generation,
    checkpointHeadSeq: created.checkpoint.baseHeadSeq,
    createdAt: created.checkpoint.createdAt,
    finalize: input.finalize,
  });
  return { kind: "finalized" };
};

export const prepareDocumentRevisionForUpdate = (
  database: Database.Database,
  input: ApplyDocumentUpdate,
  now = new Date().toISOString(),
): void => {
  requireCanonicalTimestamp(now);
  if (hasDocumentUpdateReceipt(database, input.documentId, input.updateId)) return;
  const authority = readAuthority(database, input.documentId);
  if (
    !authority ||
    authority.generation !== input.generation ||
    authority.readiness !== "ready" ||
    authority.sync_engine !== "yjs"
  ) {
    return;
  }
  let session = readDocumentRevisionSession(database, input.documentId);
  if (session && session.generation !== input.generation) {
    deleteDocumentRevisionSession(database, input.documentId);
    session = null;
  }
  if (session && documentRevisionSessionIsIdle(session, now)) {
    finalizeSession(database, {
      storeEpoch: input.storeEpoch,
      now,
      session,
      cause: "idle_edit",
      finalize: true,
    });
    session = null;
  }
  if (session) return;
  if (
    hasDocumentRevisionAtHead(database, {
      documentId: input.documentId,
      generation: authority.generation,
      headSeq: authority.head_seq,
    })
  ) {
    return;
  }
  createDocumentVersionCheckpoint(
    database,
    {
      version: 1,
      projectId: authority.project_id,
      storeEpoch: input.storeEpoch,
      documentId: input.documentId,
      expectedGeneration: authority.generation,
      expectedHeadSeq: authority.head_seq,
      cause: "before_edit_burst",
      revisionKind: "safety",
      actor: {
        kind: "document_revision_maintenance",
        boundary: "safety",
        clientSessionId: input.clientSessionId,
      },
    },
    { now: () => now },
  );
};

export const checkpointActiveDocumentRevisionIfDue = (
  database: Database.Database,
  input: { readonly documentId: string; readonly storeEpoch: string },
  now = new Date().toISOString(),
): boolean => {
  requireCanonicalTimestamp(now);
  const session = readDocumentRevisionSession(database, input.documentId);
  if (!session || !documentRevisionSessionNeedsActiveCheckpoint(session, now)) {
    return false;
  }
  finalizeSession(database, {
    storeEpoch: input.storeEpoch,
    now,
    session,
    cause: "active_edit",
    finalize: false,
  });
  return true;
};

export const maintainDocumentRevisionHistory = (
  database: Database.Database,
  input: MaintainDocumentRevisionHistoryInput,
): MaintainDocumentRevisionHistoryResult => {
  if (input.version !== DOCUMENT_REVISION_MAINTENANCE_VERSION) {
    throw new TypeError(
      `Document revision maintenance version must be ${DOCUMENT_REVISION_MAINTENANCE_VERSION}`,
    );
  }
  requireCanonicalTimestamp(input.now);
  if (readStoreEpoch(database) !== input.storeEpoch) {
    throw new DocumentVersionStoreError(
      "store_epoch_mismatch",
      "Document revision maintenance belongs to another store epoch",
    );
  }
  const maxDocuments = input.maxDocuments ?? MAX_DOCUMENT_REVISION_MAINTENANCE_DOCUMENTS;
  if (
    !Number.isSafeInteger(maxDocuments) ||
    maxDocuments < 1 ||
    maxDocuments > MAX_DOCUMENT_REVISION_MAINTENANCE_DOCUMENTS
  ) {
    throw new TypeError("Document revision maintenance maxDocuments is invalid");
  }
  const documentIds = database
    .prepare(
      `SELECT document_id
       FROM document_revision_sessions
       ORDER BY last_edit_at, document_id
       LIMIT ?`,
    )
    .all(maxDocuments) as readonly { readonly document_id: string }[];
  const counts = {
    finalized: 0,
    alreadyCovered: 0,
    stale: 0,
    deferred: 0,
    failed: 0,
  };
  for (const { document_id: documentId } of documentIds) {
    const session = readDocumentRevisionSession(database, documentId);
    if (!session) continue;
    if (!input.force && !documentRevisionSessionIsIdle(session, input.now)) {
      counts.deferred += 1;
      continue;
    }
    try {
      const result = finalizeSession(database, {
        storeEpoch: input.storeEpoch,
        now: input.now,
        session,
        cause: input.force ? "shutdown_flush" : "idle_edit",
        finalize: true,
      });
      if (result.kind === "finalized") counts.finalized += 1;
      if (result.kind === "already_covered") counts.alreadyCovered += 1;
      if (result.kind === "stale") counts.stale += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return {
    scannedDocumentCount: documentIds.length,
    finalizedDocumentCount: counts.finalized,
    alreadyCoveredDocumentCount: counts.alreadyCovered,
    staleSessionCount: counts.stale,
    deferredDocumentCount: counts.deferred,
    failedDocumentCount: counts.failed,
  };
};

