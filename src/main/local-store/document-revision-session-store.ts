import type Database from "better-sqlite3";

export const DOCUMENT_REVISION_IDLE_INTERVAL_MS = 2 * 60_000;
export const DOCUMENT_REVISION_ACTIVE_INTERVAL_MS = 10 * 60_000;

export interface DocumentRevisionSession {
  readonly documentId: string;
  readonly generation: number;
  readonly dirtyHeadSeq: number;
  readonly burstStartedAt: string;
  readonly lastEditAt: string;
  readonly lastCheckpointAt: string | null;
  readonly clientSessionId: string;
}

interface StoredDocumentRevisionSessionRow {
  readonly document_id: string;
  readonly generation: number;
  readonly dirty_head_seq: number;
  readonly burst_started_at: string;
  readonly last_edit_at: string;
  readonly last_checkpoint_at: string | null;
  readonly client_session_id: string;
}

const timestampMs = (value: string): number => {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed) && new Date(parsed).toISOString() === value) {
    return parsed;
  }
  throw new TypeError(`Document revision timestamp is invalid: ${value}`);
};

const decodeSession = (
  row: StoredDocumentRevisionSessionRow,
): DocumentRevisionSession => {
  timestampMs(row.burst_started_at);
  timestampMs(row.last_edit_at);
  if (row.last_checkpoint_at !== null) timestampMs(row.last_checkpoint_at);
  if (
    row.document_id.length === 0 ||
    !Number.isSafeInteger(row.generation) ||
    row.generation < 1 ||
    !Number.isSafeInteger(row.dirty_head_seq) ||
    row.dirty_head_seq < 0 ||
    row.client_session_id.length === 0
  ) {
    throw new TypeError("Stored Document revision session is invalid");
  }
  return {
    documentId: row.document_id,
    generation: row.generation,
    dirtyHeadSeq: row.dirty_head_seq,
    burstStartedAt: row.burst_started_at,
    lastEditAt: row.last_edit_at,
    lastCheckpointAt: row.last_checkpoint_at,
    clientSessionId: row.client_session_id,
  };
};

export const readDocumentRevisionSession = (
  database: Database.Database,
  documentId: string,
): DocumentRevisionSession | null => {
  const row = database
    .prepare(
      `SELECT document_id, generation, dirty_head_seq, burst_started_at,
              last_edit_at, last_checkpoint_at, client_session_id
       FROM document_revision_sessions
       WHERE document_id = ?`,
    )
    .get(documentId) as StoredDocumentRevisionSessionRow | undefined;
  return row ? decodeSession(row) : null;
};

export const recordAcceptedDocumentRevisionEdit = (
  database: Database.Database,
  input: {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
    readonly clientSessionId: string;
    readonly committedAt: string;
  },
): DocumentRevisionSession => {
  const committedAtMs = timestampMs(input.committedAt);
  const existing = readDocumentRevisionSession(database, input.documentId);
  const continuesBurst =
    existing !== null &&
    existing.generation === input.generation &&
    committedAtMs - timestampMs(existing.lastEditAt) <
      DOCUMENT_REVISION_IDLE_INTERVAL_MS;
  const burstStartedAt = continuesBurst
    ? existing.burstStartedAt
    : input.committedAt;
  const lastCheckpointAt = continuesBurst
    ? existing.lastCheckpointAt
    : null;
  database
    .prepare(
      `INSERT INTO document_revision_sessions (
         document_id, generation, dirty_head_seq, burst_started_at,
         last_edit_at, last_checkpoint_at, client_session_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         generation = excluded.generation,
         dirty_head_seq = excluded.dirty_head_seq,
         burst_started_at = excluded.burst_started_at,
         last_edit_at = excluded.last_edit_at,
         last_checkpoint_at = excluded.last_checkpoint_at,
         client_session_id = excluded.client_session_id`,
    )
    .run(
      input.documentId,
      input.generation,
      input.headSeq,
      burstStartedAt,
      input.committedAt,
      lastCheckpointAt,
      input.clientSessionId,
    );
  return {
    documentId: input.documentId,
    generation: input.generation,
    dirtyHeadSeq: input.headSeq,
    burstStartedAt,
    lastEditAt: input.committedAt,
    lastCheckpointAt,
    clientSessionId: input.clientSessionId,
  };
};

export const documentRevisionSessionIsIdle = (
  session: DocumentRevisionSession,
  now: string,
): boolean =>
  timestampMs(now) - timestampMs(session.lastEditAt) >=
  DOCUMENT_REVISION_IDLE_INTERVAL_MS;

export const documentRevisionSessionNeedsActiveCheckpoint = (
  session: DocumentRevisionSession,
  now: string,
): boolean => {
  const boundary = session.lastCheckpointAt ?? session.burstStartedAt;
  return timestampMs(now) - timestampMs(boundary) >=
    DOCUMENT_REVISION_ACTIVE_INTERVAL_MS;
};

export const markDocumentRevisionSessionCheckpoint = (
  database: Database.Database,
  input: {
    readonly documentId: string;
    readonly generation: number;
    readonly checkpointHeadSeq: number;
    readonly createdAt: string;
    readonly finalize: boolean;
  },
): void => {
  timestampMs(input.createdAt);
  const session = readDocumentRevisionSession(database, input.documentId);
  if (
    !session ||
    session.generation !== input.generation ||
    session.dirtyHeadSeq > input.checkpointHeadSeq
  ) {
    return;
  }
  if (input.finalize) {
    database
      .prepare(
        `DELETE FROM document_revision_sessions
         WHERE document_id = ? AND generation = ? AND dirty_head_seq <= ?`,
      )
      .run(input.documentId, input.generation, input.checkpointHeadSeq);
    return;
  }
  database
    .prepare(
      `UPDATE document_revision_sessions
       SET last_checkpoint_at = ?
       WHERE document_id = ? AND generation = ? AND dirty_head_seq <= ?`,
    )
    .run(
      input.createdAt,
      input.documentId,
      input.generation,
      input.checkpointHeadSeq,
    );
};

export const deleteDocumentRevisionSession = (
  database: Database.Database,
  documentId: string,
): void => {
  database
    .prepare("DELETE FROM document_revision_sessions WHERE document_id = ?")
    .run(documentId);
};

export const hasDocumentRevisionAtHead = (
  database: Database.Database,
  input: {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  },
): boolean =>
  database
    .prepare(
      `SELECT 1
       FROM document_versions
       WHERE document_id = ? AND generation = ? AND base_head_seq = ?
       LIMIT 1`,
    )
    .get(input.documentId, input.generation, input.headSeq) !== undefined;

export const hasDocumentUpdateReceipt = (
  database: Database.Database,
  documentId: string,
  updateId: string,
): boolean =>
  database
    .prepare(
      `SELECT 1 FROM document_update_receipts
       WHERE document_id = ? AND update_id = ?`,
    )
    .get(documentId, updateId) !== undefined;

