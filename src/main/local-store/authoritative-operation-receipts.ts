import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";

const CHANGE_LOG_KIND = "block_mutation";

export type AuthoritativeOperationReceiptErrorCode =
  "operation_id_collision" | "operation_receipt_corrupt";

export class AuthoritativeOperationReceiptError extends Error {
  constructor(
    readonly code: AuthoritativeOperationReceiptErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthoritativeOperationReceiptError";
  }
}

interface StoredReceiptRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly actor_json: string;
  readonly client_session_id: string | null;
  readonly request_hash: string;
  readonly request_json: string;
  readonly target_block_ids_json: string;
  readonly affected_document_ids_json: string;
  readonly affected_database_block_ids_json: string;
  readonly field_intents_json: string;
  readonly expected_revisions_json: string;
  readonly outcome: "committed" | "rejected";
  readonly result_json: string;
  readonly committed_revisions_json: string;
  readonly document_heads_json: string;
  readonly change_log_seq: number | null;
  readonly recorded_at: string;
}

interface StoredChangeRow {
  readonly project_id: string;
  readonly store_epoch: string;
  readonly kind: string;
  readonly operation_id: string | null;
  readonly block_ids_json: string;
  readonly document_ids_json: string;
  readonly database_block_ids_json: string;
  readonly payload_json: string;
  readonly committed_at: string;
}

export interface AuthoritativeOperationIdentity {
  readonly operationId: string;
  readonly projectId: string;
  readonly mutationKind: string;
  /** Only semantic intent belongs here; actor/session must stay outside. */
  readonly logicalRequest: Readonly<Record<string, unknown>>;
  readonly actor: Readonly<Record<string, unknown>>;
  readonly clientSessionId?: string;
}

export interface AuthoritativeOperationEvidence {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly mutationKind: string;
  readonly canonicalRequest: string;
  readonly requestHash: string;
  readonly actorJson: string;
  readonly clientSessionId: string | null;
}

export type PreparedAuthoritativeOperation<Result> =
  | {
      readonly kind: "new";
      readonly evidence: AuthoritativeOperationEvidence;
    }
  | {
      readonly kind: "replay";
      readonly evidence: AuthoritativeOperationEvidence;
      readonly result: Result;
      readonly firstActor: Readonly<Record<string, unknown>>;
      readonly firstClientSessionId: string | null;
      readonly outcome: "committed" | "rejected";
      readonly changeLogSeq: number | null;
    };

export interface PersistAuthoritativeOperationReceipt<Result> {
  readonly evidence: AuthoritativeOperationEvidence;
  readonly targetBlockIds: readonly string[];
  readonly affectedDocumentIds?: readonly string[];
  readonly affectedDatabaseBlockIds?: readonly string[];
  readonly fieldIntents?: readonly Readonly<{
    readonly path: string;
    readonly operation: string;
  }>[];
  readonly expectedRevisions?: Readonly<Record<string, number>>;
  readonly committedRevisions?: Readonly<Record<string, number>>;
  readonly documentHeads?: Readonly<Record<string, unknown>>;
  readonly changePayload?: Readonly<Record<string, unknown>>;
  readonly committedAt: string;
  readonly makeResult: (changeLogSeq: number) => Result;
}

export interface PersistAuthoritativeOperationRejection<Result> {
  readonly evidence: AuthoritativeOperationEvidence;
  readonly targetBlockIds: readonly string[];
  readonly fieldIntents?: readonly Readonly<{
    readonly path: string;
    readonly operation: string;
  }>[];
  readonly rejectedAt: string;
  readonly result: Result;
}

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const requireIdentity = (value: string, field: string): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim()
  ) {
    return value;
  }
  throw new AuthoritativeOperationReceiptError(
    "operation_receipt_corrupt",
    `${field} must be a canonical bounded identity`,
  );
};

const stableObject = (
  value: Readonly<Record<string, unknown>>,
  field: string,
): string => {
  try {
    return stableStringifyBlockPropertyJson(value);
  } catch (error) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `${field} must be bounded portable JSON`,
      { cause: error },
    );
  }
};

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [
    ...new Set(values.map((value) => requireIdentity(value, "affected ID"))),
  ].sort();

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new AuthoritativeOperationReceiptError(
    "operation_receipt_corrupt",
    "Block store epoch is missing",
  );
};

const readStoredReceipt = (
  database: Database.Database,
  operationId: string,
): StoredReceiptRow | null =>
  (database
    .prepare(
      `
      SELECT
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      FROM block_mutations
      WHERE mutation_id = ?
    `,
    )
    .get(operationId) as StoredReceiptRow | undefined) ?? null;

const parseObject = (
  serialized: string,
  field: string,
): Readonly<Record<string, unknown>> => {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      stableObject(value as Readonly<Record<string, unknown>>, field);
      return value as Readonly<Record<string, unknown>>;
    }
  } catch (error) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Stored ${field} is invalid`,
      { cause: error },
    );
  }
  throw new AuthoritativeOperationReceiptError(
    "operation_receipt_corrupt",
    `Stored ${field} is not an object`,
  );
};

const assertStoredChange = (
  database: Database.Database,
  stored: StoredReceiptRow,
): void => {
  if (stored.outcome === "rejected") {
    const change = database
      .prepare(
        `
        SELECT 1
        FROM change_log
        WHERE project_id = ? AND store_epoch = ? AND operation_id = ?
        LIMIT 1
      `,
      )
      .get(stored.project_id, stored.store_epoch, stored.mutation_id);
    if (stored.change_log_seq === null && !change) return;
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Rejected operation ${stored.mutation_id} unexpectedly has an authority change`,
    );
  }
  if (stored.change_log_seq === null) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Operation ${stored.mutation_id} has no committed change cursor`,
    );
  }
  const change = database
    .prepare(
      `
      SELECT
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      FROM change_log
      WHERE seq = ?
    `,
    )
    .get(stored.change_log_seq) as StoredChangeRow | undefined;
  if (
    !change ||
    change.project_id !== stored.project_id ||
    change.store_epoch !== stored.store_epoch ||
    change.kind !== CHANGE_LOG_KIND ||
    change.operation_id !== stored.mutation_id ||
    change.block_ids_json !== stored.target_block_ids_json ||
    change.document_ids_json !== stored.affected_document_ids_json ||
    change.database_block_ids_json !==
      stored.affected_database_block_ids_json ||
    change.committed_at !== stored.recorded_at
  ) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Operation ${stored.mutation_id} change cursor diverges from its receipt`,
    );
  }
  const payload = parseObject(
    change.payload_json,
    `operation ${stored.mutation_id} payload`,
  );
  if (
    payload.mutationKind !== stored.mutation_kind ||
    payload.requestHash !== stored.request_hash
  ) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Operation ${stored.mutation_id} change payload diverges from its receipt`,
    );
  }
};

export const prepareAuthoritativeOperation = <Result>(
  database: Database.Database,
  identity: AuthoritativeOperationIdentity,
  parseResult: (value: unknown) => Result,
): PreparedAuthoritativeOperation<Result> => {
  const operationId = requireIdentity(identity.operationId, "operationId");
  const projectId = requireIdentity(identity.projectId, "projectId");
  const mutationKind = requireIdentity(identity.mutationKind, "mutationKind");
  const storeEpoch = readStoreEpoch(database);
  const canonicalRequest = stableObject(
    identity.logicalRequest,
    "logicalRequest",
  );
  const evidence: AuthoritativeOperationEvidence = {
    operationId,
    projectId,
    storeEpoch,
    mutationKind,
    canonicalRequest,
    requestHash: sha256(canonicalRequest),
    actorJson: stableObject(identity.actor, "actor"),
    clientSessionId:
      identity.clientSessionId === undefined
        ? null
        : requireIdentity(identity.clientSessionId, "clientSessionId"),
  };
  const stored = readStoredReceipt(database, operationId);
  if (!stored) return { kind: "new", evidence };
  if (
    stored.project_id !== projectId ||
    stored.store_epoch !== storeEpoch ||
    stored.mutation_kind !== mutationKind ||
    stored.request_hash !== evidence.requestHash ||
    stored.request_json !== canonicalRequest
  ) {
    throw new AuthoritativeOperationReceiptError(
      "operation_id_collision",
      `Operation ID ${operationId} is already bound to another logical request`,
    );
  }
  assertStoredChange(database, stored);
  let result: Result;
  try {
    result = parseResult(JSON.parse(stored.result_json) as unknown);
  } catch (error) {
    if (error instanceof AuthoritativeOperationReceiptError) throw error;
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Operation ${operationId} has an invalid stored result`,
      { cause: error },
    );
  }
  return {
    kind: "replay",
    evidence,
    result,
    firstActor: parseObject(
      stored.actor_json,
      `operation ${operationId} actor`,
    ),
    firstClientSessionId: stored.client_session_id,
    outcome: stored.outcome,
    changeLogSeq: stored.change_log_seq,
  };
};

export const persistAuthoritativeOperationReceipt = <Result>(
  database: Database.Database,
  input: PersistAuthoritativeOperationReceipt<Result>,
): { readonly result: Result; readonly changeLogSeq: number } => {
  if (!database.inTransaction) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      "Authoritative operation receipt requires an active writer transaction",
    );
  }
  const targetBlockIds = uniqueSorted(input.targetBlockIds);
  const affectedDocumentIds = uniqueSorted(input.affectedDocumentIds ?? []);
  const affectedDatabaseBlockIds = uniqueSorted(
    input.affectedDatabaseBlockIds ?? [],
  );
  const targetBlockIdsJson = JSON.stringify(targetBlockIds);
  const affectedDocumentIdsJson = JSON.stringify(affectedDocumentIds);
  const affectedDatabaseBlockIdsJson = JSON.stringify(affectedDatabaseBlockIds);
  const fieldIntentsJson = stableStringifyBlockPropertyJson(
    input.fieldIntents ?? [],
  );
  const expectedRevisionsJson = stableStringifyBlockPropertyJson(
    input.expectedRevisions ?? {},
  );
  const committedRevisionsJson = stableStringifyBlockPropertyJson(
    input.committedRevisions ?? {},
  );
  const documentHeadsJson = stableStringifyBlockPropertyJson(
    input.documentHeads ?? {},
  );
  const payloadJson = stableObject(
    {
      ...(input.changePayload ?? {}),
      mutationKind: input.evidence.mutationKind,
      requestHash: input.evidence.requestHash,
    },
    "changePayload",
  );
  const change = database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      input.evidence.projectId,
      input.evidence.storeEpoch,
      CHANGE_LOG_KIND,
      input.evidence.operationId,
      targetBlockIdsJson,
      affectedDocumentIdsJson,
      affectedDatabaseBlockIdsJson,
      payloadJson,
      input.committedAt,
    );
  const changeLogSeq = Number(change.lastInsertRowid);
  if (!Number.isSafeInteger(changeLogSeq) || changeLogSeq < 1) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      "SQLite returned an invalid authoritative operation change cursor",
    );
  }
  const result = input.makeResult(changeLogSeq);
  const resultJson = stableStringifyBlockPropertyJson(result);
  parseObject(resultJson, "operation result");
  database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?, ?, ?, ?, ?)
    `,
    )
    .run(
      input.evidence.operationId,
      input.evidence.projectId,
      input.evidence.storeEpoch,
      input.evidence.mutationKind,
      input.evidence.actorJson,
      input.evidence.clientSessionId,
      input.evidence.requestHash,
      input.evidence.canonicalRequest,
      targetBlockIdsJson,
      affectedDocumentIdsJson,
      affectedDatabaseBlockIdsJson,
      fieldIntentsJson,
      expectedRevisionsJson,
      resultJson,
      committedRevisionsJson,
      documentHeadsJson,
      changeLogSeq,
      input.committedAt,
    );
  return { result, changeLogSeq };
};

export const persistAuthoritativeOperationRejection = <Result>(
  database: Database.Database,
  input: PersistAuthoritativeOperationRejection<Result>,
): Result => {
  if (!database.inTransaction) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      "Authoritative operation rejection requires an active writer transaction",
    );
  }
  const targetBlockIdsJson = JSON.stringify(uniqueSorted(input.targetBlockIds));
  const fieldIntentsJson = stableStringifyBlockPropertyJson(
    input.fieldIntents ?? [],
  );
  const resultJson = stableStringifyBlockPropertyJson(input.result);
  parseObject(resultJson, "operation rejection result");
  database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, '{}',
        'rejected', ?, '{}', '{}', NULL, ?)
    `,
    )
    .run(
      input.evidence.operationId,
      input.evidence.projectId,
      input.evidence.storeEpoch,
      input.evidence.mutationKind,
      input.evidence.actorJson,
      input.evidence.clientSessionId,
      input.evidence.requestHash,
      input.evidence.canonicalRequest,
      targetBlockIdsJson,
      fieldIntentsJson,
      resultJson,
      input.rejectedAt,
    );
  return input.result;
};
