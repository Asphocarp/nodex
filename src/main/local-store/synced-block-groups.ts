import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createUuidV7 } from "../../shared/uuid-v7";
import * as Y from "yjs";
import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "../../shared/block-property-mutations";
import { isUuidV7 } from "../../shared/uuid-v7";
import {
  populateBlockDocumentBodyFromBlockTree,
  populateBlockDocumentBodyFromNfm,
  type BlockTreeNode,
  type BlockTreeValue,
} from "../../shared/block-documents/block-document-codec";
import { compileBlockTreeReplacementOperations } from "../../shared/block-documents/document-operation-engine";
import {
  getOwnedDocumentSchemaRegistration,
  inspectOwnedBlockDocument,
} from "../../shared/block-documents/document-schema-adapters";
import {
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  type DocumentOperationResult,
} from "../../shared/block-documents/document-operations";
import type { RelocationResult } from "../../shared/block-documents/contracts";
import {
  createSyncedBlockDocument,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
  SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
  SYNCED_BLOCK_REFERENCE_TYPE,
  SYNCED_BLOCK_SOURCE_TYPE,
} from "../../shared/block-documents/synced-block-document";
import { getOwnedDocumentDescriptor } from "./block-document-cutover";
import {
  initializeBlockDocumentGenesis,
  getBlockDocumentProjectId,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { planDatabaseFractionalRank } from "./database-fractional-rank";
import {
  prepareRelocationCommand,
  relocateBlocksAtomically,
} from "./block-relocations";

export type SyncedBlockGroupErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "store_epoch_mismatch"
  | "identity_conflict"
  | "block_revision_conflict"
  | "source_not_found"
  | "source_shared"
  | "host_block_not_found"
  | "host_document_conflict"
  | "document_state_corrupt";

export type SyncedBlockMutationActor = Readonly<
  Record<string, BlockPropertyJsonValue>
>;

const MAX_SYNCED_BLOCK_ACTOR_JSON_LENGTH = 64 * 1024;

export class SyncedBlockGroupError extends Error {
  constructor(
    readonly code: SyncedBlockGroupErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SyncedBlockGroupError";
  }
}

interface SyncedBlockSourceBaseInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly sourceBlockId: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly actor: SyncedBlockMutationActor;
  readonly beforeBlockId?: string;
  readonly expectedBeforeLocationRevision?: number;
}

export type CreateSyncedBlockSourceInput = SyncedBlockSourceBaseInput &
  (
    | {
        readonly blockTree: readonly BlockTreeNode[];
        readonly nfm?: never;
      }
    | {
        readonly nfm: string;
        readonly blockTree?: never;
      }
  );

export interface SyncedBlockSourceResult {
  readonly operationId: string;
  readonly duplicate: boolean;
  readonly sourceBlockId: string;
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly storeEpoch: string;
}

export type SyncedBlockGroupFaultPoint =
  "after_source_created" | "after_host_replaced" | "before_commit";

export interface SyncedBlockDocumentWriteFence {
  readonly documentId: string;
  readonly generation: number;
  readonly headSeq: number;
}

export interface SyncedBlockGroupWriteFence {
  readonly leaseId: string;
  readonly documents: readonly SyncedBlockDocumentWriteFence[];
}

const requireIdentity = (value: string, field: string): string => {
  if (value.length > 0 && value === value.trim() && value.length <= 512) {
    return value;
  }
  throw new SyncedBlockGroupError(
    "invalid_request",
    `${field} must be a non-empty bounded identity`,
  );
};

const assertWriteFence = (
  fence: SyncedBlockGroupWriteFence,
  expected: readonly SyncedBlockDocumentWriteFence[],
): string => {
  const leaseId = requireIdentity(fence.leaseId, "writeFence.leaseId");
  if (fence.documents.length !== expected.length) {
    throw new SyncedBlockGroupError(
      "invalid_request",
      "Synced Block write fence does not cover the exact Document set",
    );
  }
  const actualById = new Map<string, SyncedBlockDocumentWriteFence>();
  for (const boundary of fence.documents) {
    const documentId = requireIdentity(
      boundary.documentId,
      "writeFence.documentId",
    );
    if (
      actualById.has(documentId) ||
      !Number.isSafeInteger(boundary.generation) ||
      boundary.generation < 1 ||
      !Number.isSafeInteger(boundary.headSeq) ||
      boundary.headSeq < 0
    ) {
      throw new SyncedBlockGroupError(
        "invalid_request",
        "Synced Block write fence contains an invalid Document boundary",
      );
    }
    actualById.set(documentId, boundary);
  }
  const matches = expected.every((boundary) => {
    const actual = actualById.get(boundary.documentId);
    return (
      actual?.generation === boundary.generation &&
      actual.headSeq === boundary.headSeq
    );
  });
  if (matches) return leaseId;
  throw new SyncedBlockGroupError(
    "invalid_request",
    "Synced Block write fence crossed a generation or head boundary",
  );
};

const stableStringify = (value: unknown): string => {
  if (value === undefined) {
    throw new SyncedBlockGroupError(
      "invalid_request",
      "Canonical mutation intent cannot contain undefined values",
    );
  }
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
    throw new SyncedBlockGroupError(
      "invalid_request",
      "Canonical mutation intent contains a non-serializable value",
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

interface StoredSyncedMutationRow {
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly outcome: string;
  readonly result_json: string;
  readonly change_log_seq: number | null;
  readonly target_block_ids_json: string;
  readonly affected_document_ids_json: string;
  readonly committed_revisions_json: string;
  readonly document_heads_json: string;
  readonly actor_json: string;
  readonly client_session_id: string | null;
}

interface SyncedMutationEvidence {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId: string;
  readonly mutationKind: string;
  readonly requestJson: string;
  readonly requestHash: string;
  readonly requestedTargetBlockIdsJson: string;
  readonly requestedDocumentIdsJson: string;
  readonly fieldIntentsJson: string;
  readonly actorJson: string;
}

const canonicalizeActor = (actor: SyncedBlockMutationActor): string => {
  if (typeof actor !== "object" || actor === null || Array.isArray(actor)) {
    throw new SyncedBlockGroupError(
      "invalid_request",
      "Synced Block mutation actor must be a JSON object",
    );
  }
  let canonical: string;
  try {
    canonical = stableStringifyBlockPropertyJson(actor);
  } catch (error) {
    throw new SyncedBlockGroupError(
      "invalid_request",
      `Synced Block mutation actor must contain bounded JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (canonical.length <= MAX_SYNCED_BLOCK_ACTOR_JSON_LENGTH) return canonical;
  throw new SyncedBlockGroupError(
    "invalid_request",
    "Synced Block mutation actor exceeds the JSON size limit",
  );
};

const sortedUniqueJson = (values: readonly string[]): string =>
  JSON.stringify(
    [
      ...new Set(values.map((value) => requireIdentity(value, "identity"))),
    ].sort(),
  );

const parseStoredSyncedRejection = (
  resultJson: string,
  operationId: string,
): SyncedBlockGroupError => {
  let value: unknown;
  try {
    value = JSON.parse(resultJson);
  } catch {
    throw new SyncedBlockGroupError(
      "document_state_corrupt",
      `Synced Block operation ${operationId} has invalid rejection JSON`,
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("code" in value) ||
    !("message" in value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    ![
      "invalid_request",
      "project_not_found",
      "store_epoch_mismatch",
      "identity_conflict",
      "block_revision_conflict",
      "source_not_found",
      "source_shared",
      "host_block_not_found",
      "host_document_conflict",
      "document_state_corrupt",
    ].includes(value.code)
  ) {
    throw new SyncedBlockGroupError(
      "document_state_corrupt",
      `Synced Block operation ${operationId} has invalid rejection evidence`,
    );
  }
  return new SyncedBlockGroupError(
    value.code as SyncedBlockGroupErrorCode,
    value.message,
  );
};

const readStoredSyncedMutation = (
  database: Database.Database,
  operationId: string,
): StoredSyncedMutationRow | undefined =>
  database
    .prepare(
      `
      SELECT project_id, store_epoch, mutation_kind, request_hash,
        request_json, outcome, result_json, change_log_seq,
        target_block_ids_json, affected_document_ids_json,
        committed_revisions_json, document_heads_json, actor_json,
        client_session_id
      FROM block_mutations
      WHERE mutation_id = ?
    `,
    )
    .get(operationId) as StoredSyncedMutationRow | undefined;

const loadStoredSyncedMutation = <T extends object>(
  database: Database.Database,
  stored: StoredSyncedMutationRow,
  evidence: SyncedMutationEvidence,
): T & { readonly duplicate: boolean } => {
  if (
    stored.project_id !== evidence.projectId ||
    stored.store_epoch !== evidence.storeEpoch ||
    stored.mutation_kind !== evidence.mutationKind ||
    stored.request_hash !== evidence.requestHash ||
    stored.request_json !== evidence.requestJson
  ) {
    throw new SyncedBlockGroupError(
      "identity_conflict",
      `Operation identity ${evidence.operationId} is already bound to different semantics`,
    );
  }
  let storedActorJson: string;
  try {
    storedActorJson = canonicalizeActor(
      JSON.parse(stored.actor_json) as SyncedBlockMutationActor,
    );
  } catch (error) {
    if (error instanceof SyncedBlockGroupError) {
      throw new SyncedBlockGroupError(
        "document_state_corrupt",
        `Synced Block operation ${evidence.operationId} has invalid actor evidence`,
        { cause: error },
      );
    }
    throw error;
  }
  if (
    storedActorJson !== stored.actor_json ||
    stored.client_session_id === null ||
    stored.client_session_id.length === 0 ||
    stored.client_session_id !== stored.client_session_id.trim()
  ) {
    throw new SyncedBlockGroupError(
      "document_state_corrupt",
      `Synced Block operation ${evidence.operationId} lost its first-attempt audit identity`,
    );
  }
  if (stored.outcome === "rejected") {
    if (
      stored.change_log_seq !== null ||
      stored.target_block_ids_json !== evidence.requestedTargetBlockIdsJson ||
      stored.affected_document_ids_json !== evidence.requestedDocumentIdsJson ||
      stored.committed_revisions_json !== "{}" ||
      stored.document_heads_json !== "{}"
    ) {
      throw new SyncedBlockGroupError(
        "document_state_corrupt",
        `Rejected Synced Block operation ${evidence.operationId} has committed-state evidence`,
      );
    }
    throw parseStoredSyncedRejection(stored.result_json, evidence.operationId);
  }
  if (stored.outcome !== "committed" || stored.change_log_seq === null) {
    throw new SyncedBlockGroupError(
      "document_state_corrupt",
      `Synced Block operation ${evidence.operationId} has invalid receipt evidence`,
    );
  }
  const value = JSON.parse(stored.result_json) as T;
  const change = database
    .prepare(
      `
      SELECT project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, payload_json
      FROM change_log
      WHERE seq = ?
    `,
    )
    .get(stored.change_log_seq) as
    | {
        readonly project_id: string;
        readonly store_epoch: string;
        readonly kind: string;
        readonly operation_id: string | null;
        readonly block_ids_json: string;
        readonly document_ids_json: string;
        readonly payload_json: string;
      }
    | undefined;
  const expectedPayload = stableStringify({
    mutationKind: evidence.mutationKind,
    requestHash: evidence.requestHash,
    result: value,
  });
  if (
    !change ||
    change.project_id !== evidence.projectId ||
    change.store_epoch !== evidence.storeEpoch ||
    change.kind !== "block_mutation" ||
    change.operation_id !== evidence.operationId ||
    change.block_ids_json !== stored.target_block_ids_json ||
    change.document_ids_json !== stored.affected_document_ids_json ||
    change.payload_json !== expectedPayload ||
    stored.committed_revisions_json !== stored.document_heads_json
  ) {
    throw new SyncedBlockGroupError(
      "document_state_corrupt",
      `Synced Block operation ${evidence.operationId} change evidence diverges from its receipt`,
    );
  }
  return { ...value, duplicate: true };
};

const executeIdempotentSyncedMutation = <T extends object>(
  database: Database.Database,
  input: {
    readonly operationId: string;
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly clientSessionId: string;
    readonly actor: SyncedBlockMutationActor;
    readonly mutationKind: string;
    readonly canonicalIntent: Readonly<Record<string, unknown>>;
    readonly requestedTargetBlockIds: readonly string[];
    readonly requestedDocumentIds: readonly string[];
    readonly fieldIntents: readonly Readonly<{
      readonly path: string;
      readonly operation: string;
    }>[];
  },
  operation: () => {
    readonly value: T;
    readonly targetBlockIds: readonly string[];
    readonly documentHeads: Readonly<
      Record<string, { readonly generation: number; readonly headSeq: number }>
    >;
  },
): T & { readonly duplicate: boolean } => {
  const operationId = requireIdentity(input.operationId, "operationId");
  const projectId = requireIdentity(input.projectId, "projectId");
  requireIdentity(input.storeEpoch, "storeEpoch");
  const clientSessionId = requireIdentity(
    input.clientSessionId,
    "clientSessionId",
  );
  const storeEpoch = requireIdentity(input.storeEpoch, "storeEpoch");
  const currentStoreEpoch = readStoreEpoch(database);
  if (storeEpoch !== currentStoreEpoch) {
    throw new SyncedBlockGroupError(
      "store_epoch_mismatch",
      `Operation belongs to store epoch ${storeEpoch}; current epoch is ${currentStoreEpoch}`,
    );
  }
  requireProject(database, projectId);
  const requestJson = stableStringify(input.canonicalIntent);
  const requestHash = sha256(requestJson);
  const evidence: SyncedMutationEvidence = {
    operationId,
    projectId,
    storeEpoch,
    clientSessionId,
    mutationKind: input.mutationKind,
    requestJson,
    requestHash,
    requestedTargetBlockIdsJson: sortedUniqueJson(
      input.requestedTargetBlockIds,
    ),
    requestedDocumentIdsJson: sortedUniqueJson(input.requestedDocumentIds),
    fieldIntentsJson: stableStringify(input.fieldIntents),
    actorJson: canonicalizeActor(input.actor),
  };
  const existing = readStoredSyncedMutation(database, operationId);
  if (existing)
    return loadStoredSyncedMutation<T>(database, existing, evidence);

  try {
    return database
      .transaction(() => {
        const raced = readStoredSyncedMutation(database, operationId);
        if (raced) {
          return loadStoredSyncedMutation<T>(database, raced, evidence);
        }
        const committed = operation();
        const targetBlockIds = [...new Set(committed.targetBlockIds)].sort();
        const documentIds = Object.keys(committed.documentHeads).sort();
        const now = new Date().toISOString();
        const durableValue = { ...committed.value, duplicate: false };
        const payloadJson = stableStringify({
          mutationKind: input.mutationKind,
          requestHash,
          result: durableValue,
        });
        const change = database
          .prepare(
            `
            INSERT INTO change_log (
              project_id, store_epoch, kind, operation_id, block_ids_json,
              document_ids_json, database_block_ids_json, payload_json, committed_at
            ) VALUES (?, ?, 'block_mutation', ?, ?, ?, '[]', ?, ?)
          `,
          )
          .run(
            projectId,
            storeEpoch,
            operationId,
            JSON.stringify(targetBlockIds),
            JSON.stringify(documentIds),
            payloadJson,
            now,
          );
        const changeLogSeq = Number(change.lastInsertRowid);
        const documentHeadsJson = stableStringify(committed.documentHeads);
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, '{}', 'committed',
              ?, ?, ?, ?, ?)
          `,
          )
          .run(
            operationId,
            projectId,
            storeEpoch,
            input.mutationKind,
            evidence.actorJson,
            clientSessionId,
            requestHash,
            requestJson,
            JSON.stringify(targetBlockIds),
            JSON.stringify(documentIds),
            evidence.fieldIntentsJson,
            stableStringify(durableValue),
            documentHeadsJson,
            documentHeadsJson,
            changeLogSeq,
            now,
          );
        return durableValue;
      })
      .immediate();
  } catch (error) {
    if (!(error instanceof SyncedBlockGroupError)) throw error;
    if (
      error.code === "project_not_found" ||
      error.code === "store_epoch_mismatch"
    ) {
      throw error;
    }
    database
      .transaction(() => {
        const raced = readStoredSyncedMutation(database, operationId);
        if (raced) {
          loadStoredSyncedMutation<T>(database, raced, evidence);
          return;
        }
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, '{}', 'rejected',
              ?, '{}', '{}', NULL, ?)
          `,
          )
          .run(
            operationId,
            projectId,
            storeEpoch,
            input.mutationKind,
            evidence.actorJson,
            clientSessionId,
            requestHash,
            requestJson,
            evidence.requestedTargetBlockIdsJson,
            evidence.requestedDocumentIdsJson,
            evidence.fieldIntentsJson,
            stableStringify({ code: error.code, message: error.message }),
            new Date().toISOString(),
          );
      })
      .immediate();
    throw error;
  }
};

const requireProject = (
  database: Database.Database,
  projectId: string,
): void => {
  const row = database
    .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
    .get(projectId) as { readonly present: number } | undefined;
  if (row) return;
  throw new SyncedBlockGroupError(
    "project_not_found",
    `Project does not exist: ${projectId}`,
  );
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row) return row.store_epoch;
  throw new SyncedBlockGroupError(
    "document_state_corrupt",
    "Block store metadata is missing",
  );
};

const assertIdentityAvailable = (
  database: Database.Database,
  table: "blocks" | "documents",
  id: string,
): void => {
  const existing = database
    .prepare(`SELECT 1 AS present FROM ${table} WHERE id = ?`)
    .get(id) as { readonly present: number } | undefined;
  if (!existing) return;
  throw new SyncedBlockGroupError(
    "identity_conflict",
    `${table === "blocks" ? "Block" : "Document"} identity already exists: ${id}`,
  );
};

const allocateTopLevelRank = (
  database: Database.Database,
  projectId: string,
  targetBlockId: string,
  beforeBlockId?: string,
): string => {
  const items = database
    .prepare(
      `
      SELECT placement.block_id AS id, placement.rank_key AS rankKey
      FROM top_level_block_placements placement
      INNER JOIN blocks block ON block.id = placement.block_id
      WHERE placement.project_id = ? AND block.lifecycle <> 'deleted'
      ORDER BY placement.rank_key, placement.block_id
    `,
    )
    .all(projectId) as readonly {
    readonly id: string;
    readonly rankKey: string;
  }[];
  const plan = planDatabaseFractionalRank({
    items,
    targetId: targetBlockId,
    ...(beforeBlockId ? { beforeId: beforeBlockId } : {}),
  });
  const update = database.prepare(`
    UPDATE top_level_block_placements
    SET rank_key = ?, updated_at = ?
    WHERE block_id = ? AND project_id = ?
  `);
  const now = new Date().toISOString();
  for (const [blockId, rankKey] of plan.rebalancedRankKeys) {
    update.run(rankKey, now, blockId, projectId);
  }
  return plan.rankKey;
};

const assertTopLevelAnchorRevision = (
  database: Database.Database,
  projectId: string,
  beforeBlockId: string | undefined,
  expectedLocationRevision: number | undefined,
): void => {
  if (beforeBlockId === undefined && expectedLocationRevision === undefined) {
    return;
  }
  if (beforeBlockId === undefined || expectedLocationRevision === undefined) {
    throw new SyncedBlockGroupError(
      "invalid_request",
      "Top-level placement anchor identity and revision must be supplied together",
    );
  }
  if (
    !Number.isSafeInteger(expectedLocationRevision) ||
    expectedLocationRevision < 1
  ) {
    throw new SyncedBlockGroupError(
      "invalid_request",
      "Top-level placement anchor revision must be a safe integer >= 1",
    );
  }
  const row = database
    .prepare(
      `
      SELECT block.location_revision
      FROM blocks block
      INNER JOIN top_level_block_placements placement
        ON placement.block_id = block.id
        AND placement.project_id = block.project_id
      WHERE block.id = ? AND block.project_id = ?
        AND block.lifecycle <> 'deleted'
        AND block.location_kind = 'space'
    `,
    )
    .get(beforeBlockId, projectId) as
    | { readonly location_revision: number }
    | undefined;
  if (row?.location_revision === expectedLocationRevision) return;
  throw new SyncedBlockGroupError(
    "block_revision_conflict",
    `Top-level placement anchor ${beforeBlockId} changed or is unavailable`,
  );
};

const buildSyncedDocument = (input: CreateSyncedBlockSourceInput): Y.Doc => {
  const envelope = createSyncedBlockDocument({
    documentId: input.documentId,
    initializeBody: false,
  });
  try {
    if (input.blockTree) {
      populateBlockDocumentBodyFromBlockTree(envelope.body, input.blockTree);
    } else {
      populateBlockDocumentBodyFromNfm(envelope.body, input.nfm, () =>
        createUuidV7(),
      );
    }
    inspectOwnedBlockDocument(envelope.document, {
      ownerType: SYNCED_BLOCK_SOURCE_TYPE,
      schemaKey: SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
      schemaVersion: SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
    });
    return envelope.document;
  } catch (error) {
    envelope.document.destroy();
    throw error;
  }
};

const stageSyncedBlockSourceIdentity = (
  database: Database.Database,
  input: CreateSyncedBlockSourceInput,
): {
  readonly projectId: string;
  readonly sourceBlockId: string;
  readonly documentId: string;
} => {
  const projectId = requireIdentity(input.projectId, "projectId");
  const sourceBlockId = requireIdentity(input.sourceBlockId, "sourceBlockId");
  if (!isUuidV7(sourceBlockId)) {
    throw new SyncedBlockGroupError(
      "invalid_request",
      "New Synced Block source id must be a canonical lowercase UUID-v7",
    );
  }
  const documentId = requireIdentity(input.documentId, "documentId");
  requireIdentity(input.operationId, "operationId");
  requireIdentity(input.clientSessionId, "clientSessionId");
  requireProject(database, projectId);
  assertTopLevelAnchorRevision(
    database,
    projectId,
    input.beforeBlockId,
    input.expectedBeforeLocationRevision,
  );
  assertIdentityAvailable(database, "blocks", sourceBlockId);
  assertIdentityAvailable(database, "documents", documentId);
  const now = new Date().toISOString();
  database
    .prepare(
      `
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, location_revision, metadata_revision,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'active', 'space', NULL, 1, 1, ?, ?)
      `,
    )
    .run(sourceBlockId, projectId, SYNCED_BLOCK_SOURCE_TYPE, now, now);
  database
    .prepare(
      `
        INSERT INTO top_level_block_placements (
          block_id, project_id, rank_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run(
      sourceBlockId,
      projectId,
      allocateTopLevelRank(
        database,
        projectId,
        sourceBlockId,
        input.beforeBlockId,
      ),
      now,
      now,
    );
  database
    .prepare(
      `
        INSERT INTO documents (
          id, project_id, generation, head_seq, schema_key, schema_version,
          state_vector, state_hash, readiness, authority,
          genesis_source_revision, created_at, updated_at
        ) VALUES (?, ?, 1, 0, ?, ?, X'', '', 'pending_genesis',
          'legacy_shadow', NULL, ?, ?)
      `,
    )
    .run(
      documentId,
      projectId,
      SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY,
      SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION,
      now,
      now,
    );
  database
    .prepare(
      `
        INSERT INTO block_documents (block_id, document_id, project_id, created_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(sourceBlockId, documentId, projectId, now);
  return { projectId, sourceBlockId, documentId };
};

const initializeStagedSyncedBlockSource = (
  database: Database.Database,
  input: CreateSyncedBlockSourceInput,
): SyncedBlockSourceResult => {
  const document = buildSyncedDocument(input);
  try {
    const ack = initializeBlockDocumentGenesis(database, {
      documentId: input.documentId,
      storeEpoch: input.storeEpoch,
      generation: 1,
      updateId: `${input.operationId}:genesis`,
      clientSessionId: input.clientSessionId,
      update: Y.encodeStateAsUpdate(document),
      finalAuthority: "ydoc_primary",
    });
    return {
      operationId: input.operationId,
      duplicate: false,
      sourceBlockId: input.sourceBlockId,
      documentId: input.documentId,
      generation: ack.generation,
      headSeq: ack.headSeq,
      storeEpoch: ack.storeEpoch,
    };
  } finally {
    document.destroy();
  }
};

const createSyncedBlockSourceInTransaction = (
  database: Database.Database,
  input: CreateSyncedBlockSourceInput,
): SyncedBlockSourceResult => {
  stageSyncedBlockSourceIdentity(database, input);
  return initializeStagedSyncedBlockSource(database, input);
};

export const createSyncedBlockSource = (
  database: Database.Database,
  input: CreateSyncedBlockSourceInput,
): SyncedBlockSourceResult =>
  executeIdempotentSyncedMutation(
    database,
    {
      operationId: input.operationId,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      clientSessionId: input.clientSessionId,
      actor: input.actor,
      mutationKind: "create_synced_block_source",
      canonicalIntent: {
        version: 1,
        kind: "create_synced_block_source",
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        sourceBlockId: input.sourceBlockId,
        documentId: input.documentId,
        beforeBlockId: input.beforeBlockId ?? null,
        expectedBeforeLocationRevision:
          input.expectedBeforeLocationRevision ?? null,
        ...(input.blockTree
          ? { blockTree: input.blockTree }
          : { nfm: input.nfm }),
      },
      requestedTargetBlockIds: [input.sourceBlockId],
      requestedDocumentIds: [input.documentId],
      fieldIntents: [{ path: "block.documentOwnership", operation: "create" }],
    },
    () => {
      const value = createSyncedBlockSourceInTransaction(database, input);
      return {
        value,
        targetBlockIds: [
          input.sourceBlockId,
          ...readDocumentBlockIds(database, input.documentId),
        ],
        documentHeads: {
          [input.documentId]: {
            generation: value.generation,
            headSeq: value.headSeq,
          },
        },
      };
    },
  );

const clonePortable = <T extends BlockTreeValue>(value: T): T =>
  structuredClone(value);

const remapBlockTree = (
  blocks: readonly BlockTreeNode[],
): readonly BlockTreeNode[] => {
  const visit = (block: BlockTreeNode): BlockTreeNode => {
    const id = createUuidV7();
    return {
      id: requireIdentity(id, "allocated blockId"),
      type: block.type,
      props: clonePortable(block.props),
      ...(block.content === undefined
        ? {}
        : { content: clonePortable(block.content) }),
      children: block.children.map(visit),
    };
  };
  return blocks.map(visit);
};

const flattenBlockIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);

const readDocumentBlockIds = (
  database: Database.Database,
  documentId: string,
): readonly string[] =>
  (
    database
      .prepare(
        `SELECT block_id FROM document_block_index WHERE document_id = ? ORDER BY ordinal`,
      )
      .all(documentId) as readonly { readonly block_id: string }[]
  ).map((row) => row.block_id);

const loadSyncedSourceMaterialization = (
  database: Database.Database,
  projectId: string,
  sourceBlockId: string,
): {
  readonly documentId: string;
  readonly blockTree: readonly BlockTreeNode[];
  readonly generation: number;
  readonly headSeq: number;
} => {
  let descriptor;
  try {
    descriptor = getOwnedDocumentDescriptor(
      database,
      projectId,
      sourceBlockId,
    );
  } catch (error) {
    throw new SyncedBlockGroupError(
      "source_not_found",
      `Synced Block source does not exist: ${sourceBlockId}`,
      { cause: error },
    );
  }
  if (
    descriptor.ownerType !== SYNCED_BLOCK_SOURCE_TYPE ||
    descriptor.schemaKey !== SYNCED_BLOCK_DOCUMENT_SCHEMA_KEY ||
    descriptor.schemaVersion !== SYNCED_BLOCK_DOCUMENT_SCHEMA_VERSION ||
    descriptor.readiness !== "ready" ||
    descriptor.sync.kind !== "yjs" ||
    descriptor.ownerLifecycle === "deleted"
  ) {
    throw new SyncedBlockGroupError(
      "source_not_found",
      `Block ${sourceBlockId} is not a readable Synced Block source`,
    );
  }
  const loaded = loadPrimaryBlockDocument(database, descriptor.documentId);
  try {
    const inspection = inspectOwnedBlockDocument(loaded.document, {
      ownerType: loaded.ownerType,
      schemaKey: loaded.head.schemaKey,
      schemaVersion: loaded.head.schemaVersion,
    });
    if (inspection.materialization.kind !== "synced_block") {
      throw new SyncedBlockGroupError(
        "document_state_corrupt",
        `Synced Block source ${sourceBlockId} materialized as another schema`,
      );
    }
    return {
      documentId: descriptor.documentId,
      blockTree: inspection.materialization.blockTree,
      generation: descriptor.generation,
      headSeq: descriptor.headSeq,
    };
  } finally {
    loaded.document.destroy();
  }
};

export interface CopySyncedBlockSourceInput {
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly sourceBlockId: string;
  readonly sourceDocumentId: string;
  readonly newSourceBlockId: string;
  readonly newDocumentId: string;
  readonly operationId: string;
  readonly clientSessionId: string;
  readonly actor: SyncedBlockMutationActor;
  readonly expectedSourceGeneration: number;
  readonly expectedSourceHeadSeq: number;
  readonly beforeBlockId?: string;
}

export const copySyncedBlockSource = (
  database: Database.Database,
  input: CopySyncedBlockSourceInput,
): SyncedBlockSourceResult =>
  executeIdempotentSyncedMutation(
    database,
    {
      operationId: input.operationId,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      clientSessionId: input.clientSessionId,
      actor: input.actor,
      mutationKind: "copy_synced_block_source",
      canonicalIntent: {
        version: 1,
        kind: "copy_synced_block_source",
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        sourceBlockId: input.sourceBlockId,
        sourceDocumentId: input.sourceDocumentId,
        expectedSourceGeneration: input.expectedSourceGeneration,
        expectedSourceHeadSeq: input.expectedSourceHeadSeq,
        newSourceBlockId: input.newSourceBlockId,
        newDocumentId: input.newDocumentId,
        beforeBlockId: input.beforeBlockId ?? null,
      },
      requestedTargetBlockIds: [input.newSourceBlockId],
      requestedDocumentIds: [input.newDocumentId],
      fieldIntents: [{ path: "block.documentOwnership", operation: "copy" }],
    },
    () => {
      const source = loadSyncedSourceMaterialization(
        database,
        input.projectId,
        input.sourceBlockId,
      );
      if (source.documentId !== input.sourceDocumentId) {
        throw new SyncedBlockGroupError(
          "host_document_conflict",
          `Synced Block source ${input.sourceBlockId} no longer owns ${input.sourceDocumentId}`,
        );
      }
      if (
        source.generation !== input.expectedSourceGeneration ||
        source.headSeq !== input.expectedSourceHeadSeq
      ) {
        throw new SyncedBlockGroupError(
          "host_document_conflict",
          `Source Document changed before copy`,
        );
      }
      const value = createSyncedBlockSourceInTransaction(database, {
        operationId: input.operationId,
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        sourceBlockId: input.newSourceBlockId,
        documentId: input.newDocumentId,
        clientSessionId: input.clientSessionId,
        actor: input.actor,
        beforeBlockId: input.beforeBlockId,
        blockTree: remapBlockTree(source.blockTree),
      });
      return {
        value,
        targetBlockIds: [
          input.newSourceBlockId,
          ...readDocumentBlockIds(database, input.newDocumentId),
        ],
        documentHeads: {
          [input.newDocumentId]: {
            generation: value.generation,
            headSeq: value.headSeq,
          },
        },
      };
    },
  );

export const createSyncedBlockReferenceNode = (
  blockId: string,
  sourceBlockId: string,
): BlockTreeNode => ({
  id: requireIdentity(blockId, "blockId"),
  type: SYNCED_BLOCK_REFERENCE_TYPE,
  props: { sourceBlockId: requireIdentity(sourceBlockId, "sourceBlockId") },
  children: [],
});

const findSubtree = (
  blocks: readonly BlockTreeNode[],
  blockId: string,
): BlockTreeNode | null => {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findSubtree(block.children, blockId);
    if (nested) return nested;
  }
  return null;
};

const findBlockPlacement = (
  blocks: readonly BlockTreeNode[],
  blockId: string,
  parentBlockId: string | null = null,
): {
  readonly parentBlockId: string | null;
  readonly beforeBlockId: string | null;
} | null => {
  for (const [index, block] of blocks.entries()) {
    if (block.id === blockId) {
      return {
        parentBlockId,
        beforeBlockId: blocks[index + 1]?.id ?? null,
      };
    }
    const nested = findBlockPlacement(block.children, blockId, block.id);
    if (nested) return nested;
  }
  return null;
};

const replaceSubtree = (
  blocks: readonly BlockTreeNode[],
  blockId: string,
  replacement: readonly BlockTreeNode[],
): readonly BlockTreeNode[] =>
  blocks.flatMap((block) => {
    if (block.id === blockId) return replacement;
    const children = replaceSubtree(block.children, blockId, replacement);
    return [{ ...block, children }];
  });

const applyHostReplacement = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly storeEpoch: string;
    readonly documentId: string;
    readonly generation: number;
    readonly expectedHeadSeq: number;
    readonly mutationId: string;
    readonly clientSessionId: string;
    readonly actor: SyncedBlockMutationActor;
    readonly writeFenceLeaseId: string;
    readonly current: readonly BlockTreeNode[];
    readonly target: readonly BlockTreeNode[];
    readonly allowPendingSyncedReferenceTargetIds?: readonly string[];
    readonly allowTransientEmptyBlockTree?: boolean;
  },
): DocumentOperationResult => {
  const operations = compileBlockTreeReplacementOperations(
    input.current,
    input.target,
  );
  const result = applyDocumentOperationBatch(
    database,
    {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      mutationId: input.mutationId,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      clientSessionId: input.clientSessionId,
      actor: input.actor,
      documentId: input.documentId,
      generation: input.generation,
      expectedHeadSeq: input.expectedHeadSeq,
      operations,
    },
    {
      writeFence: {
        leaseId: input.writeFenceLeaseId,
        documentId: input.documentId,
        generation: input.generation,
        headSeq: input.expectedHeadSeq,
      },
      ...(input.allowPendingSyncedReferenceTargetIds
        ? {
            allowPendingSyncedReferenceTargetIds:
              input.allowPendingSyncedReferenceTargetIds,
          }
        : {}),
      ...(input.allowTransientEmptyBlockTree
        ? { allowTransientEmptyBlockTree: true }
        : {}),
    },
  );
  if (result.ok) return result.value;
  throw new SyncedBlockGroupError(
    "host_document_conflict",
    result.error.message,
  );
};

export interface PromoteBlockToSyncedSourceInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly hostDocumentId: string;
  readonly expectedGeneration: number;
  readonly expectedHeadSeq: number;
  readonly rootBlockId: string;
  readonly referenceBlockId: string;
  readonly sourceBlockId: string;
  readonly sourceDocumentId: string;
  readonly clientSessionId: string;
  readonly actor: SyncedBlockMutationActor;
  readonly writeFence: SyncedBlockGroupWriteFence;
  readonly faultInjector?: (point: SyncedBlockGroupFaultPoint) => void;
}

export interface PromoteBlockToSyncedSourceResult {
  readonly operationId: string;
  readonly duplicate: boolean;
  readonly source: SyncedBlockSourceResult;
  readonly hostMutation: DocumentOperationResult;
}

export const promoteBlockToSyncedSource = (
  database: Database.Database,
  input: PromoteBlockToSyncedSourceInput,
): PromoteBlockToSyncedSourceResult =>
  executeIdempotentSyncedMutation(
    database,
    {
      operationId: input.operationId,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      clientSessionId: input.clientSessionId,
      actor: input.actor,
      mutationKind: "promote_synced_block_source",
      canonicalIntent: {
        version: 1,
        kind: "promote_synced_block_source",
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        hostDocumentId: input.hostDocumentId,
        expectedGeneration: input.expectedGeneration,
        rootBlockId: input.rootBlockId,
        referenceBlockId: input.referenceBlockId,
        sourceBlockId: input.sourceBlockId,
        sourceDocumentId: input.sourceDocumentId,
      },
      requestedTargetBlockIds: [
        input.rootBlockId,
        input.referenceBlockId,
        input.sourceBlockId,
      ],
      requestedDocumentIds: [input.hostDocumentId, input.sourceDocumentId],
      fieldIntents: [{ path: "block.documentOwnership", operation: "promote" }],
    },
    () => {
      const writeFenceLeaseId = assertWriteFence(input.writeFence, [
        {
          documentId: input.hostDocumentId,
          generation: input.expectedGeneration,
          headSeq: input.expectedHeadSeq,
        },
      ]);
      const loaded = loadPrimaryBlockDocument(database, input.hostDocumentId);
      try {
        if (
          loaded.storeEpoch !== input.storeEpoch ||
          loaded.head.generation !== input.expectedGeneration ||
          loaded.head.headSeq !== input.expectedHeadSeq
        ) {
          throw new SyncedBlockGroupError(
            "host_document_conflict",
            `Host Document ${input.hostDocumentId} changed before promotion`,
          );
        }
        const inspection = inspectOwnedBlockDocument(loaded.document, {
          ownerType: loaded.ownerType,
          schemaKey: loaded.head.schemaKey,
          schemaVersion: loaded.head.schemaVersion,
        });
        const root = findSubtree(
          inspection.materialization.blockTree,
          input.rootBlockId,
        );
        if (!root) {
          throw new SyncedBlockGroupError(
            "host_block_not_found",
            `Block ${input.rootBlockId} does not exist in ${input.hostDocumentId}`,
          );
        }
        if (
          getBlockDocumentProjectId(database, input.hostDocumentId) !==
          input.projectId
        ) {
          throw new SyncedBlockGroupError(
            "host_document_conflict",
            `Host Document ${input.hostDocumentId} belongs to another Project`,
          );
        }
        const sourceInput: CreateSyncedBlockSourceInput = {
          operationId: input.operationId,
          projectId: input.projectId,
          storeEpoch: input.storeEpoch,
          sourceBlockId: input.sourceBlockId,
          documentId: input.sourceDocumentId,
          clientSessionId: input.clientSessionId,
          actor: input.actor,
          blockTree: [root],
        };
        stageSyncedBlockSourceIdentity(database, sourceInput);
        input.faultInjector?.("after_source_created");
        const target = replaceSubtree(
          inspection.materialization.blockTree,
          input.rootBlockId,
          [
            createSyncedBlockReferenceNode(
              input.referenceBlockId,
              input.sourceBlockId,
            ),
          ],
        );
        const hostMutation = applyHostReplacement(database, {
          projectId: input.projectId,
          storeEpoch: loaded.storeEpoch,
          documentId: input.hostDocumentId,
          generation: loaded.head.generation,
          expectedHeadSeq: loaded.head.headSeq,
          mutationId: `${input.operationId}:host`,
          clientSessionId: input.clientSessionId,
          actor: input.actor,
          writeFenceLeaseId,
          current: inspection.materialization.blockTree,
          target,
          allowPendingSyncedReferenceTargetIds: [input.sourceBlockId],
        });
        input.faultInjector?.("after_host_replaced");
        const movedBlockIds = flattenBlockIds([root]);
        const now = new Date().toISOString();
        const move = database.prepare(`
          UPDATE blocks
          SET lifecycle = 'active', containing_document_id = ?,
              location_revision = location_revision + 1, updated_at = ?
          WHERE id = ? AND project_id = ? AND lifecycle = 'deleted'
            AND location_kind = 'document' AND containing_document_id = ?
        `);
        for (const blockId of movedBlockIds) {
          if (
            move.run(
              input.sourceDocumentId,
              now,
              blockId,
              input.projectId,
              input.hostDocumentId,
            ).changes === 1
          ) {
            continue;
          }
          throw new SyncedBlockGroupError(
            "document_state_corrupt",
            `Promotion could not move Block ${blockId} into the source Document`,
          );
        }
        const source = initializeStagedSyncedBlockSource(database, sourceInput);
        input.faultInjector?.("before_commit");
        const value = {
          operationId: input.operationId,
          duplicate: false,
          source,
          hostMutation,
        };
        return {
          value,
          targetBlockIds: [
            input.sourceBlockId,
            input.referenceBlockId,
            loaded.head.ownerBlockId,
            ...movedBlockIds,
          ],
          documentHeads: {
            [input.hostDocumentId]: {
              generation: hostMutation.generation,
              headSeq: hostMutation.headSeq,
            },
            [input.sourceDocumentId]: {
              generation: source.generation,
              headSeq: source.headSeq,
            },
          },
        };
      } finally {
        loaded.document.destroy();
      }
    },
  );

const countSyncedBlockSourceInstances = (
  database: Database.Database,
  projectId: string,
  sourceBlockId: string,
): number => {
  const rows = database
    .prepare(
      `
      SELECT
        document.id,
        document.schema_key,
        document.schema_version,
        owner.type AS owner_type,
        document.generation,
        document.head_seq,
        materialization.generation AS projected_generation,
        materialization.projected_seq,
        materialization.block_tree_json
      FROM documents document
      INNER JOIN block_documents ownership
        ON ownership.document_id = document.id
        AND ownership.project_id = document.project_id
      INNER JOIN blocks owner
        ON owner.id = ownership.block_id
        AND owner.project_id = ownership.project_id
      LEFT JOIN document_materializations materialization
        ON document.id = materialization.document_id
      WHERE document.project_id = ?
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
    `,
    )
    .all(projectId) as readonly {
    readonly id: string;
    readonly schema_key: string;
    readonly schema_version: number;
    readonly owner_type: string;
    readonly generation: number;
    readonly head_seq: number;
    readonly projected_generation: number | null;
    readonly projected_seq: number | null;
    readonly block_tree_json: string | null;
  }[];
  let count = 0;
  for (const row of rows) {
    let contentModel: "block_tree" | "scene_graph";
    try {
      contentModel = getOwnedDocumentSchemaRegistration({
        ownerType: row.owner_type,
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      }).contentModel;
    } catch (error) {
      throw new SyncedBlockGroupError(
        "document_state_corrupt",
        `Cannot prove Synced Block reference count while Document ${row.id} uses an unregistered schema`,
        { cause: error },
      );
    }
    if (contentModel !== "block_tree") continue;
    if (
      row.projected_generation !== row.generation ||
      row.projected_seq !== row.head_seq ||
      row.block_tree_json === null
    ) {
      throw new SyncedBlockGroupError(
        "document_state_corrupt",
        `Cannot prove Synced Block reference count while Document ${row.id} projection is stale`,
      );
    }
    const blocks = JSON.parse(row.block_tree_json) as readonly BlockTreeNode[];
    const pending = [...blocks];
    while (pending.length > 0) {
      const block = pending.pop();
      if (!block) continue;
      pending.push(...block.children);
      if (
        block.type === SYNCED_BLOCK_REFERENCE_TYPE &&
        block.props.sourceBlockId === sourceBlockId
      ) {
        count += 1;
      }
    }
  }
  return count;
};

/** Typed deletion/GC guard; generic cleanup must never bypass this boundary. */
export const assertSyncedBlockSourceIsUnreferenced = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly sourceBlockId: string;
    readonly sourceDocumentId: string;
  },
): void => {
  const source = loadSyncedSourceMaterialization(
    database,
    input.projectId,
    input.sourceBlockId,
  );
  if (source.documentId !== input.sourceDocumentId) {
    throw new SyncedBlockGroupError(
      "host_document_conflict",
      `Synced Block source ${input.sourceBlockId} no longer owns ${input.sourceDocumentId}`,
    );
  }
  if (
    countSyncedBlockSourceInstances(
      database,
      input.projectId,
      input.sourceBlockId,
    ) === 0
  ) {
    return;
  }
  throw new SyncedBlockGroupError(
    "source_shared",
    `Synced Block source ${input.sourceBlockId} cannot be deleted while references exist`,
  );
};

export interface DemoteSyncedBlockSourceInput {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly hostDocumentId: string;
  readonly expectedGeneration: number;
  readonly expectedHeadSeq: number;
  readonly expectedSourceGeneration: number;
  readonly expectedSourceHeadSeq: number;
  readonly referenceBlockId: string;
  readonly sourceBlockId: string;
  readonly sourceDocumentId: string;
  readonly clientSessionId: string;
  readonly actor: SyncedBlockMutationActor;
  readonly writeFence: SyncedBlockGroupWriteFence;
  readonly faultInjector?: (point: SyncedBlockGroupFaultPoint) => void;
}

export interface DemoteSyncedBlockSourceResult {
  readonly operationId: string;
  readonly duplicate: boolean;
  readonly hostMutation: DocumentOperationResult;
  readonly relocation: RelocationResult | null;
}

export const demoteSyncedBlockSource = (
  database: Database.Database,
  input: DemoteSyncedBlockSourceInput,
): DemoteSyncedBlockSourceResult =>
  executeIdempotentSyncedMutation(
    database,
    {
      operationId: input.operationId,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      clientSessionId: input.clientSessionId,
      actor: input.actor,
      mutationKind: "demote_synced_block_source",
      canonicalIntent: {
        version: 1,
        kind: "demote_synced_block_source",
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        hostDocumentId: input.hostDocumentId,
        expectedGeneration: input.expectedGeneration,
        expectedSourceGeneration: input.expectedSourceGeneration,
        referenceBlockId: input.referenceBlockId,
        sourceBlockId: input.sourceBlockId,
        sourceDocumentId: input.sourceDocumentId,
      },
      requestedTargetBlockIds: [input.referenceBlockId, input.sourceBlockId],
      requestedDocumentIds: [input.hostDocumentId, input.sourceDocumentId],
      fieldIntents: [{ path: "block.documentOwnership", operation: "demote" }],
    },
    () => {
      const writeFenceLeaseId = assertWriteFence(input.writeFence, [
        {
          documentId: input.hostDocumentId,
          generation: input.expectedGeneration,
          headSeq: input.expectedHeadSeq,
        },
        {
          documentId: input.sourceDocumentId,
          generation: input.expectedSourceGeneration,
          headSeq: input.expectedSourceHeadSeq,
        },
      ]);
      if (
        countSyncedBlockSourceInstances(
          database,
          input.projectId,
          input.sourceBlockId,
        ) !== 1
      ) {
        throw new SyncedBlockGroupError(
          "source_shared",
          `Synced Block source ${input.sourceBlockId} can be demoted only from its sole instance`,
        );
      }
      const source = loadSyncedSourceMaterialization(
        database,
        input.projectId,
        input.sourceBlockId,
      );
      if (source.documentId !== input.sourceDocumentId) {
        throw new SyncedBlockGroupError(
          "host_document_conflict",
          `Synced Block source ${input.sourceBlockId} no longer owns ${input.sourceDocumentId}`,
        );
      }
      if (
        source.generation !== input.expectedSourceGeneration ||
        source.headSeq !== input.expectedSourceHeadSeq
      ) {
        throw new SyncedBlockGroupError(
          "host_document_conflict",
          `Source Document ${source.documentId} changed before demotion`,
        );
      }
      const host = loadPrimaryBlockDocument(database, input.hostDocumentId);
      try {
        if (
          getBlockDocumentProjectId(database, input.hostDocumentId) !==
          input.projectId
        ) {
          throw new SyncedBlockGroupError(
            "host_document_conflict",
            `Host Document ${input.hostDocumentId} belongs to another Project`,
          );
        }
        if (
          host.storeEpoch !== input.storeEpoch ||
          host.head.generation !== input.expectedGeneration ||
          host.head.headSeq !== input.expectedHeadSeq
        ) {
          throw new SyncedBlockGroupError(
            "host_document_conflict",
            `Host Document ${input.hostDocumentId} changed before demotion`,
          );
        }
        const inspection = inspectOwnedBlockDocument(host.document, {
          ownerType: host.ownerType,
          schemaKey: host.head.schemaKey,
          schemaVersion: host.head.schemaVersion,
        });
        const reference = findSubtree(
          inspection.materialization.blockTree,
          input.referenceBlockId,
        );
        if (
          reference?.type !== SYNCED_BLOCK_REFERENCE_TYPE ||
          reference.props.sourceBlockId !== input.sourceBlockId
        ) {
          throw new SyncedBlockGroupError(
            "host_block_not_found",
            `Block ${input.referenceBlockId} is not the requested Synced Block instance`,
          );
        }
        const placement = findBlockPlacement(
          inspection.materialization.blockTree,
          input.referenceBlockId,
        );
        if (!placement) {
          throw new SyncedBlockGroupError(
            "host_block_not_found",
            `Block ${input.referenceBlockId} has no stable host placement`,
          );
        }
        const target = replaceSubtree(
          inspection.materialization.blockTree,
          input.referenceBlockId,
          [],
        );
        const hostMutation = applyHostReplacement(database, {
          projectId: input.projectId,
          storeEpoch: host.storeEpoch,
          documentId: input.hostDocumentId,
          generation: host.head.generation,
          expectedHeadSeq: host.head.headSeq,
          mutationId: `${requireIdentity(input.operationId, "operationId")}:host`,
          clientSessionId: input.clientSessionId,
          actor: input.actor,
          writeFenceLeaseId,
          current: inspection.materialization.blockTree,
          target,
          allowTransientEmptyBlockTree: true,
        });
        input.faultInjector?.("after_host_replaced");
        const rootBlockIds = source.blockTree.map((block) => block.id);
        const relocation =
          rootBlockIds.length === 0
            ? null
            : relocateBlocksAtomically(
                database,
                prepareRelocationCommand(database, {
                  relocationId: `${input.operationId}:relocate`,
                  projectId: input.projectId,
                  storeEpoch: input.storeEpoch,
                  rootBlockIds,
                  sourceDocumentId: source.documentId,
                  sourceGeneration: source.generation,
                  target: {
                    kind: "document",
                    documentId: input.hostDocumentId,
                    generation: host.head.generation,
                    ...(placement.parentBlockId
                      ? { parentBlockId: placement.parentBlockId }
                      : {}),
                    ...(placement.beforeBlockId
                      ? { beforeBlockId: placement.beforeBlockId }
                      : {}),
                  },
                }),
                { allowRetiringSourceToBecomeEmpty: true },
              );
        const now = new Date().toISOString();
        database
          .prepare("DELETE FROM top_level_block_placements WHERE block_id = ?")
          .run(input.sourceBlockId);
        database
          .prepare(
            `
            UPDATE blocks
            SET lifecycle = 'deleted', metadata_revision = metadata_revision + 1,
                updated_at = ?
            WHERE id = ? AND project_id = ? AND type = ? AND lifecycle <> 'deleted'
          `,
          )
          .run(
            now,
            input.sourceBlockId,
            input.projectId,
            SYNCED_BLOCK_SOURCE_TYPE,
          );
        input.faultInjector?.("before_commit");
        const value = {
          operationId: input.operationId,
          duplicate: false,
          hostMutation,
          relocation,
        };
        return {
          value,
          targetBlockIds: [
            input.sourceBlockId,
            input.referenceBlockId,
            host.head.ownerBlockId,
            ...flattenBlockIds(source.blockTree),
          ],
          documentHeads: {
            [input.hostDocumentId]: {
              generation:
                relocation?.targetCommit?.generation ?? hostMutation.generation,
              headSeq:
                relocation?.targetCommit?.headSeq ?? hostMutation.headSeq,
            },
            [source.documentId]: {
              generation:
                relocation?.sourceCommit.generation ?? source.generation,
              headSeq: relocation?.sourceCommit.headSeq ?? source.headSeq,
            },
          },
        };
      } finally {
        host.document.destroy();
      }
    },
  );
