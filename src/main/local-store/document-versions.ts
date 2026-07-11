import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { type BlockTreeValue } from "../../shared/block-documents/block-document-codec";
import {
  getBlockDocumentSchemaAdapterForSchema,
  inspectOwnedBlockDocument,
  type OwnedDocumentMaterialization,
} from "../../shared/block-documents/document-schema-adapters";
import { compileBlockTreeReplacementOperations } from "../../shared/block-documents/document-operation-engine";
import {
  DOCUMENT_VERSION_CONTRACT_VERSION,
  MAX_DOCUMENT_VERSION_CAUSE_LENGTH,
  MAX_DOCUMENT_VERSION_HISTORY_LIMIT,
  MAX_DOCUMENT_VERSION_LABEL_LENGTH,
  type BlockChangeHistoryEntry,
  type CreateDocumentVersionCheckpoint,
  type CreatedDocumentVersionCheckpoint,
  type CreatedDocumentVersionSummary,
  type DocumentVersionDetail,
  type DocumentVersionActor,
  type DocumentVersionCheckpoint,
  type DocumentVersionRestorePlan,
  type DocumentVersionSummary,
  type ListBlockChangeHistory,
  type ListDocumentVersions,
  type PrepareDocumentVersionRestore,
  type PreparedDocumentVersionRestore,
} from "../../shared/block-documents/document-history";
import { MAX_BLOCK_ID_LENGTH } from "../../shared/block-documents/contracts";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import {
  BlockDocumentStoreError,
  loadPrimaryBlockDocument,
} from "./block-document-store";

const MAX_SCOPE_ID_LENGTH = 512;
const DEFAULT_HISTORY_LIMIT = 50;
const VERSION_ID_PREFIX = "document-version:";

export type DocumentVersionStoreErrorCode =
  | "invalid_document_version_request"
  | "store_epoch_mismatch"
  | "document_not_found"
  | "document_not_ready"
  | "project_scope_mismatch"
  | "document_generation_conflict"
  | "document_head_conflict"
  | "document_version_not_found"
  | "document_version_collision"
  | "document_version_schema_mismatch"
  | "document_version_corrupt";

export class DocumentVersionStoreError extends Error {
  readonly code: DocumentVersionStoreErrorCode;
  readonly expectedGeneration?: number;
  readonly actualGeneration?: number;
  readonly expectedHeadSeq?: number;
  readonly actualHeadSeq?: number;

  constructor(
    code: DocumentVersionStoreErrorCode,
    message: string,
    details: {
      readonly expectedGeneration?: number;
      readonly actualGeneration?: number;
      readonly expectedHeadSeq?: number;
      readonly actualHeadSeq?: number;
    } = {},
  ) {
    super(message);
    this.name = "DocumentVersionStoreError";
    this.code = code;
    this.expectedGeneration = details.expectedGeneration;
    this.actualGeneration = details.actualGeneration;
    this.expectedHeadSeq = details.expectedHeadSeq;
    this.actualHeadSeq = details.actualHeadSeq;
  }
}

export type DocumentVersionFaultPoint =
  "after_authority_load" | "before_insert" | "after_insert" | "before_commit";

export interface CreateDocumentVersionOptions {
  readonly now?: () => string;
  readonly faultInjector?: (point: DocumentVersionFaultPoint) => void;
}

interface StoredDocumentVersionRow {
  readonly version_id: string;
  readonly document_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly base_head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly cause: string;
  readonly label: string | null;
  readonly actor_json: string;
  readonly full_update_blob: Buffer;
  readonly state_vector: Buffer;
  readonly checkpoint_hash: string;
  readonly byte_length: number;
  readonly created_at: string;
}

interface StoredBlockChangeRow {
  readonly seq: number;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly kind: string;
  readonly operation_id: string | null;
  readonly block_ids_json: string;
  readonly document_ids_json: string;
  readonly database_block_ids_json: string;
  readonly payload_json: string;
  readonly committed_at: string;
  readonly mutation_kind: string | null;
  readonly actor_json: string | null;
  readonly client_session_id: string | null;
  readonly field_intents_json: string | null;
  readonly mutation_outcome: string | null;
}

const hashBytes = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const stableStringifyTrustedValue = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      "Trusted materialization contains a non-JSON value",
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyTrustedValue).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringifyTrustedValue(record[key])}`,
    )
    .join(",")}}`;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
};

const asBytes = (value: Uint8Array): Uint8Array =>
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();

const requireBoundedString = (
  value: string,
  field: string,
  maximumLength = MAX_SCOPE_ID_LENGTH,
): string => {
  if (
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  ) {
    return value;
  }
  throw new DocumentVersionStoreError(
    "invalid_document_version_request",
    `${field} must be a non-empty bounded string`,
  );
};

const requireSafeInteger = (
  value: number,
  field: string,
  minimum: number,
): number => {
  if (Number.isSafeInteger(value) && value >= minimum) return value;
  throw new DocumentVersionStoreError(
    "invalid_document_version_request",
    `${field} must be a safe integer >= ${minimum}`,
  );
};

const requireCanonicalIsoTimestamp = (value: string, field: string): string => {
  requireBoundedString(value, field, 256);
  if (
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  ) {
    return value;
  }
  throw new DocumentVersionStoreError(
    "invalid_document_version_request",
    `${field} must be a canonical ISO timestamp`,
  );
};

const canonicalPortableValue = (value: unknown): BlockTreeValue => {
  try {
    return JSON.parse(
      stableStringifyBlockPropertyJson(value),
    ) as BlockTreeValue;
  } catch (error) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      `Value is not bounded portable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const canonicalActor = (
  actor: Readonly<Record<string, BlockTreeValue>>,
): { readonly value: DocumentVersionActor; readonly json: string } => {
  const portable = canonicalPortableValue(actor);
  if (
    portable === null ||
    Array.isArray(portable) ||
    typeof portable !== "object"
  ) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      "actor must be a portable JSON object",
    );
  }
  const json = stableStringifyBlockPropertyJson(portable);
  return {
    value: portable as Readonly<Record<string, BlockTreeValue>>,
    json,
  };
};

const parseStoredPortable = (
  serialized: string,
  field: string,
): BlockTreeValue => {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    // Persisted mutation families have different boundary budgets (Document
    // actors permit deeper portable JSON than property mutations). JSON.parse
    // establishes the value domain; canonical traversal rejects no valid
    // ledger merely because another command family has a smaller budget.
    stableStringifyTrustedValue(parsed);
    return parsed as BlockTreeValue;
  } catch (error) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Stored ${field} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const parseStoredObject = (
  serialized: string,
  field: string,
): Readonly<Record<string, BlockTreeValue>> => {
  const value = parseStoredPortable(serialized, field);
  if (value !== null && !Array.isArray(value) && typeof value === "object") {
    return value as Readonly<Record<string, BlockTreeValue>>;
  }
  throw new DocumentVersionStoreError(
    "document_version_corrupt",
    `Stored ${field} must be an object`,
  );
};

const parseStoredArray = (
  serialized: string,
  field: string,
): readonly BlockTreeValue[] => {
  const value = parseStoredPortable(serialized, field);
  if (Array.isArray(value)) return value;
  throw new DocumentVersionStoreError(
    "document_version_corrupt",
    `Stored ${field} must be an array`,
  );
};

const parseStoredStringArray = (
  serialized: string,
  field: string,
): readonly string[] => {
  const value = parseStoredArray(serialized, field);
  if (
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length > 0 &&
        entry.length <= MAX_BLOCK_ID_LENGTH,
    ) &&
    new Set(value).size === value.length
  ) {
    return value as readonly string[];
  }
  throw new DocumentVersionStoreError(
    "document_version_corrupt",
    `Stored ${field} must contain unique bounded identifiers`,
  );
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row) return row.store_epoch;
  throw new DocumentVersionStoreError(
    "document_version_corrupt",
    "Block store metadata is missing",
  );
};

const assertStoreEpoch = (
  database: Database.Database,
  expected: string,
): void => {
  const actual = readStoreEpoch(database);
  if (actual === expected) return;
  throw new DocumentVersionStoreError(
    "store_epoch_mismatch",
    `Request belongs to store epoch ${expected}; current epoch is ${actual}`,
  );
};

const materializationHash = (
  materialization: OwnedDocumentMaterialization,
): string =>
  createHash("sha256")
    .update(
      stableStringifyTrustedValue({
        schemaVersion: materialization.schemaVersion,
        kind: materialization.kind,
        ...(materialization.kind === "card"
          ? { title: materialization.title }
          : {}),
        blockTree: materialization.blockTree,
        nfm: materialization.nfm,
        plainText: materialization.plainText,
        preview: materialization.preview,
        references: materialization.references,
        assetRefs: materialization.assetRefs,
      }),
    )
    .digest("hex");

const countBlocks = (
  blocks: OwnedDocumentMaterialization["blockTree"],
): number =>
  blocks.reduce((count, block) => count + 1 + countBlocks(block.children), 0);

const readVersionRow = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly documentId: string;
    readonly versionId: string;
  },
): StoredDocumentVersionRow => {
  const row = readVersionRowById(database, input.versionId);
  if (
    row?.project_id === input.projectId &&
    row.document_id === input.documentId
  ) {
    return row;
  }
  throw new DocumentVersionStoreError(
    "document_version_not_found",
    `Document version does not exist: ${input.versionId}`,
  );
};

const readVersionRowById = (
  database: Database.Database,
  versionId: string,
): StoredDocumentVersionRow | undefined =>
  database
    .prepare(
      `
      SELECT
        version_id, document_id, project_id, generation, base_head_seq,
        schema_key, schema_version, cause, label, actor_json,
        full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
      FROM document_versions
      WHERE version_id = ?
    `,
    )
    .get(versionId) as StoredDocumentVersionRow | undefined;

const decodeVersionRow = (
  row: StoredDocumentVersionRow,
): DocumentVersionCheckpoint => {
  if (
    row.version_id.length === 0 ||
    row.document_id.length === 0 ||
    row.project_id.length === 0 ||
    !Number.isSafeInteger(row.generation) ||
    row.generation < 1 ||
    !Number.isSafeInteger(row.base_head_seq) ||
    row.base_head_seq < 0 ||
    !Number.isSafeInteger(row.schema_version) ||
    row.schema_version < 1 ||
    !Number.isSafeInteger(row.byte_length) ||
    row.byte_length < 1 ||
    row.full_update_blob.byteLength !== row.byte_length ||
    !/^[a-f0-9]{64}$/u.test(row.checkpoint_hash) ||
    hashBytes(row.full_update_blob) !== row.checkpoint_hash
  ) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} has invalid persisted metadata`,
    );
  }
  const actor = parseStoredObject(row.actor_json, "Document version actor");
  const document = new Y.Doc({ guid: row.document_id });
  try {
    try {
      Y.applyUpdate(document, row.full_update_blob, "document-version-read");
    } catch (error) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Document version ${row.version_id} cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      document.store.pendingStructs !== null ||
      document.store.pendingDs !== null
    ) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Document version ${row.version_id} has unresolved Yjs dependencies`,
      );
    }
    const stateVector = Y.encodeStateVector(document);
    if (!bytesEqual(stateVector, row.state_vector)) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Document version ${row.version_id} state vector does not match`,
      );
    }
    let materialization: OwnedDocumentMaterialization;
    try {
      const adapter = getBlockDocumentSchemaAdapterForSchema({
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      });
      materialization = inspectOwnedBlockDocument(document, {
        ownerType: adapter.ownerType,
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      }).materialization;
    } catch (error) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Document version ${row.version_id} is not a valid Card Document: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (materialization.schemaVersion !== row.schema_version) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Document version ${row.version_id} schema metadata diverges from its content`,
      );
    }
    return {
      versionId: row.version_id,
      documentId: row.document_id,
      projectId: row.project_id,
      generation: row.generation,
      baseHeadSeq: row.base_head_seq,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
      cause: row.cause,
      label: row.label,
      actor,
      checkpointHash: row.checkpoint_hash,
      stateVectorHash: hashBytes(stateVector),
      materializationHash: materializationHash(materialization),
      byteLength: row.byte_length,
      materializationKind: materialization.kind,
      title: materialization.kind === "card" ? materialization.title : null,
      preview: materialization.preview,
      blockCount: countBlocks(materialization.blockTree),
      createdAt: row.created_at,
      fullUpdate: asBytes(row.full_update_blob),
      stateVector: asBytes(stateVector),
      materialization,
    };
  } finally {
    document.destroy();
  }
};

const toSummary = (
  checkpoint: DocumentVersionCheckpoint,
): DocumentVersionSummary => ({
  versionId: checkpoint.versionId,
  documentId: checkpoint.documentId,
  projectId: checkpoint.projectId,
  generation: checkpoint.generation,
  baseHeadSeq: checkpoint.baseHeadSeq,
  schemaKey: checkpoint.schemaKey,
  schemaVersion: checkpoint.schemaVersion,
  cause: checkpoint.cause,
  label: checkpoint.label,
  actor: checkpoint.actor,
  checkpointHash: checkpoint.checkpointHash,
  stateVectorHash: checkpoint.stateVectorHash,
  materializationHash: checkpoint.materializationHash,
  byteLength: checkpoint.byteLength,
  materializationKind: checkpoint.materializationKind,
  title: checkpoint.title,
  preview: checkpoint.preview,
  blockCount: checkpoint.blockCount,
  createdAt: checkpoint.createdAt,
});

const createVersionId = (input: {
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly documentId: string;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly schemaKey: string;
  readonly schemaVersion: number;
  readonly cause: string;
  readonly label: string | null;
  readonly actor: DocumentVersionActor;
  readonly checkpointHash: string;
  readonly stateVectorHash: string;
  readonly materializationHash: string;
}): string => {
  const identityJson = stableStringifyBlockPropertyJson({
    version: DOCUMENT_VERSION_CONTRACT_VERSION,
    ...input,
  });
  return `${VERSION_ID_PREFIX}${createHash("sha256")
    .update(identityJson)
    .digest("hex")}`;
};

const readIdempotentCheckpoint = (
  database: Database.Database,
  input: CreateDocumentVersionCheckpoint,
  request: {
    readonly cause: string;
    readonly label: string | null;
    readonly actor: DocumentVersionActor;
    readonly actorJson: string;
  },
): DocumentVersionCheckpoint | null => {
  const rows = database
    .prepare(
      `
      SELECT
        version_id, document_id, project_id, generation, base_head_seq,
        schema_key, schema_version, cause, label, actor_json,
        full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
      FROM document_versions
      WHERE project_id = ? AND document_id = ?
        AND generation = ? AND base_head_seq = ?
        AND cause = ? AND label IS ? AND actor_json = ?
      ORDER BY version_id
    `,
    )
    .all(
      input.projectId,
      input.documentId,
      input.expectedGeneration,
      input.expectedHeadSeq,
      request.cause,
      request.label,
      request.actorJson,
    ) as readonly StoredDocumentVersionRow[];
  for (const row of rows) {
    const checkpoint = decodeVersionRow(row);
    const expectedVersionId = createVersionId({
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      documentId: input.documentId,
      generation: checkpoint.generation,
      baseHeadSeq: checkpoint.baseHeadSeq,
      schemaKey: checkpoint.schemaKey,
      schemaVersion: checkpoint.schemaVersion,
      cause: request.cause,
      label: request.label,
      actor: request.actor,
      checkpointHash: checkpoint.checkpointHash,
      stateVectorHash: checkpoint.stateVectorHash,
      materializationHash: checkpoint.materializationHash,
    });
    if (expectedVersionId === checkpoint.versionId) return checkpoint;
  }
  return null;
};

const mapLoadError = (error: BlockDocumentStoreError): never => {
  const mapped: DocumentVersionStoreErrorCode =
    error.code === "document_not_found"
      ? "document_not_found"
      : error.code === "document_not_ready" ||
          error.code === "document_authority_mismatch"
        ? "document_not_ready"
        : "document_version_corrupt";
  throw new DocumentVersionStoreError(mapped, error.message);
};

const validateCreateRequest = (
  input: CreateDocumentVersionCheckpoint,
): {
  readonly cause: string;
  readonly label: string | null;
  readonly actor: DocumentVersionActor;
  readonly actorJson: string;
} => {
  if (input.version !== DOCUMENT_VERSION_CONTRACT_VERSION) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      `version must be ${DOCUMENT_VERSION_CONTRACT_VERSION}`,
    );
  }
  requireBoundedString(input.projectId, "projectId");
  requireBoundedString(input.storeEpoch, "storeEpoch");
  requireBoundedString(input.documentId, "documentId");
  requireSafeInteger(input.expectedGeneration, "expectedGeneration", 1);
  requireSafeInteger(input.expectedHeadSeq, "expectedHeadSeq", 0);
  const cause = requireBoundedString(
    input.cause,
    "cause",
    MAX_DOCUMENT_VERSION_CAUSE_LENGTH,
  );
  const label =
    input.label === undefined
      ? null
      : requireBoundedString(
          input.label,
          "label",
          MAX_DOCUMENT_VERSION_LABEL_LENGTH,
        );
  const actor = canonicalActor(input.actor);
  return { cause, label, actor: actor.value, actorJson: actor.json };
};

const assertHead = (
  input: {
    readonly expectedGeneration: number;
    readonly expectedHeadSeq: number;
  },
  actual: { readonly generation: number; readonly headSeq: number },
): void => {
  if (input.expectedGeneration !== actual.generation) {
    throw new DocumentVersionStoreError(
      "document_generation_conflict",
      `Document generation is ${actual.generation}; expected ${input.expectedGeneration}`,
      {
        expectedGeneration: input.expectedGeneration,
        actualGeneration: actual.generation,
      },
    );
  }
  if (input.expectedHeadSeq === actual.headSeq) return;
  throw new DocumentVersionStoreError(
    "document_head_conflict",
    `Document head is ${actual.headSeq}; expected ${input.expectedHeadSeq}`,
    {
      expectedHeadSeq: input.expectedHeadSeq,
      actualHeadSeq: actual.headSeq,
    },
  );
};

const assertStoredVersionMatches = (
  stored: DocumentVersionCheckpoint,
  expected: {
    readonly versionId: string;
    readonly documentId: string;
    readonly projectId: string;
    readonly generation: number;
    readonly baseHeadSeq: number;
    readonly schemaKey: string;
    readonly schemaVersion: number;
    readonly cause: string;
    readonly label: string | null;
    readonly actorJson: string;
    readonly fullUpdate: Uint8Array;
    readonly stateVector: Uint8Array;
    readonly checkpointHash: string;
  },
): void => {
  if (
    stored.versionId === expected.versionId &&
    stored.documentId === expected.documentId &&
    stored.projectId === expected.projectId &&
    stored.generation === expected.generation &&
    stored.baseHeadSeq === expected.baseHeadSeq &&
    stored.schemaKey === expected.schemaKey &&
    stored.schemaVersion === expected.schemaVersion &&
    stored.cause === expected.cause &&
    stored.label === expected.label &&
    stableStringifyBlockPropertyJson(stored.actor) === expected.actorJson &&
    stored.checkpointHash === expected.checkpointHash &&
    bytesEqual(stored.fullUpdate, expected.fullUpdate) &&
    bytesEqual(stored.stateVector, expected.stateVector)
  ) {
    return;
  }
  throw new DocumentVersionStoreError(
    "document_version_collision",
    `Document version identity ${expected.versionId} collides with different immutable content`,
  );
};

export const createDocumentVersionCheckpoint = (
  database: Database.Database,
  input: CreateDocumentVersionCheckpoint,
  options: CreateDocumentVersionOptions = {},
): CreatedDocumentVersionCheckpoint => {
  const request = validateCreateRequest(input);
  const create = database.transaction((): CreatedDocumentVersionCheckpoint => {
    assertStoreEpoch(database, input.storeEpoch);
    const existing = readIdempotentCheckpoint(database, input, request);
    if (existing) return { checkpoint: existing, duplicate: true };
    let loaded;
    try {
      loaded = loadPrimaryBlockDocument(database, input.documentId);
    } catch (error) {
      if (error instanceof BlockDocumentStoreError) return mapLoadError(error);
      throw error;
    }
    try {
      if (loaded.head.ownerBlockId.length === 0) {
        throw new DocumentVersionStoreError(
          "document_version_corrupt",
          `Document ${input.documentId} has no owner Block`,
        );
      }
      if (
        input.projectId !== getDocumentProjectId(database, input.documentId)
      ) {
        throw new DocumentVersionStoreError(
          "project_scope_mismatch",
          `Document ${input.documentId} does not belong to Project ${input.projectId}`,
        );
      }
      assertHead(input, loaded.head);
      options.faultInjector?.("after_authority_load");
      const fullUpdate = Y.encodeStateAsUpdate(loaded.document);
      const stateVector = Y.encodeStateVector(loaded.document);
      if (!bytesEqual(stateVector, loaded.head.stateVector)) {
        throw new DocumentVersionStoreError(
          "document_version_corrupt",
          `Document ${input.documentId} state changed while checkpointing`,
        );
      }
      const ownerType = loaded.ownerType;
      const materialization = inspectOwnedBlockDocument(loaded.document, {
        ownerType,
        schemaKey: loaded.head.schemaKey,
        schemaVersion: loaded.head.schemaVersion,
      }).materialization;
      const checkpointHash = hashBytes(fullUpdate);
      const stateVectorHash = hashBytes(stateVector);
      const semanticHash = materializationHash(materialization);
      const versionId = createVersionId({
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        documentId: input.documentId,
        generation: loaded.head.generation,
        baseHeadSeq: loaded.head.headSeq,
        schemaKey: loaded.head.schemaKey,
        schemaVersion: loaded.head.schemaVersion,
        cause: request.cause,
        label: request.label,
        actor: request.actor,
        checkpointHash,
        stateVectorHash,
        materializationHash: semanticHash,
      });
      const createdAt = (options.now ?? (() => new Date().toISOString()))();
      requireCanonicalIsoTimestamp(createdAt, "createdAt");
      options.faultInjector?.("before_insert");
      const inserted = database
        .prepare(
          `
          INSERT INTO document_versions (
            version_id, document_id, project_id, generation, base_head_seq,
            schema_key, schema_version, cause, label, actor_json,
            full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(version_id) DO NOTHING
        `,
        )
        .run(
          versionId,
          input.documentId,
          input.projectId,
          loaded.head.generation,
          loaded.head.headSeq,
          loaded.head.schemaKey,
          loaded.head.schemaVersion,
          request.cause,
          request.label,
          request.actorJson,
          Buffer.from(fullUpdate),
          Buffer.from(stateVector),
          checkpointHash,
          fullUpdate.byteLength,
          createdAt,
        );
      options.faultInjector?.("after_insert");
      const storedRow = readVersionRowById(database, versionId);
      if (
        !storedRow ||
        storedRow.project_id !== input.projectId ||
        storedRow.document_id !== input.documentId
      ) {
        throw new DocumentVersionStoreError(
          "document_version_collision",
          `Document version identity ${versionId} belongs to another immutable scope`,
        );
      }
      const checkpoint = decodeVersionRow(storedRow);
      assertStoredVersionMatches(checkpoint, {
        versionId,
        documentId: input.documentId,
        projectId: input.projectId,
        generation: loaded.head.generation,
        baseHeadSeq: loaded.head.headSeq,
        schemaKey: loaded.head.schemaKey,
        schemaVersion: loaded.head.schemaVersion,
        cause: request.cause,
        label: request.label,
        actorJson: request.actorJson,
        fullUpdate,
        stateVector,
        checkpointHash,
      });
      options.faultInjector?.("before_commit");
      return { checkpoint, duplicate: inserted.changes === 0 };
    } finally {
      loaded.document.destroy();
    }
  });
  return create.immediate();
};

export const createDocumentVersionSummaryCheckpoint = (
  database: Database.Database,
  input: CreateDocumentVersionCheckpoint,
  options: CreateDocumentVersionOptions = {},
): CreatedDocumentVersionSummary => {
  const created = createDocumentVersionCheckpoint(database, input, options);
  return {
    checkpoint: toSummary(created.checkpoint),
    duplicate: created.duplicate,
  };
};

const getDocumentProjectId = (
  database: Database.Database,
  documentId: string,
): string => {
  const row = database
    .prepare("SELECT project_id FROM documents WHERE id = ?")
    .get(documentId) as { readonly project_id: string } | undefined;
  if (row) return row.project_id;
  throw new DocumentVersionStoreError(
    "document_not_found",
    `Document does not exist: ${documentId}`,
  );
};

export const getDocumentVersionCheckpoint = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly documentId: string;
    readonly versionId: string;
  },
): DocumentVersionCheckpoint => {
  requireBoundedString(input.projectId, "projectId");
  requireBoundedString(input.documentId, "documentId");
  requireBoundedString(input.versionId, "versionId");
  return decodeVersionRow(readVersionRow(database, input));
};

export const previewDocumentVersion = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly documentId: string;
    readonly versionId: string;
  },
): DocumentVersionSummary =>
  toSummary(getDocumentVersionCheckpoint(database, input));

export const getDocumentVersionDetail = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly documentId: string;
    readonly versionId: string;
  },
): DocumentVersionDetail => {
  const checkpoint = getDocumentVersionCheckpoint(database, input);
  return {
    summary: toSummary(checkpoint),
    materialization: checkpoint.materialization,
  };
};

export const listDocumentVersions = (
  database: Database.Database,
  input: ListDocumentVersions,
): readonly DocumentVersionSummary[] => {
  requireBoundedString(input.projectId, "projectId");
  requireBoundedString(input.documentId, "documentId");
  const before = input.before;
  if (before) {
    requireSafeInteger(before.baseHeadSeq, "before.baseHeadSeq", 0);
    requireCanonicalIsoTimestamp(before.createdAt, "before.createdAt");
    requireBoundedString(before.versionId, "before.versionId");
  }
  const limit =
    input.limit === undefined
      ? DEFAULT_HISTORY_LIMIT
      : requireSafeInteger(input.limit, "limit", 1);
  if (limit > MAX_DOCUMENT_VERSION_HISTORY_LIMIT) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      `limit must not exceed ${MAX_DOCUMENT_VERSION_HISTORY_LIMIT}`,
    );
  }
  const rows = database
    .prepare(
      `
      SELECT
        version_id, document_id, project_id, generation, base_head_seq,
        schema_key, schema_version, cause, label, actor_json,
        full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
      FROM document_versions
      WHERE project_id = ? AND document_id = ?
        AND (? IS NULL
          OR base_head_seq < ?
          OR (base_head_seq = ? AND created_at < ?)
          OR (base_head_seq = ? AND created_at = ? AND version_id < ?))
      ORDER BY base_head_seq DESC, created_at DESC, version_id DESC
      LIMIT ?
    `,
    )
    .all(
      input.projectId,
      input.documentId,
      before?.versionId ?? null,
      before?.baseHeadSeq ?? null,
      before?.baseHeadSeq ?? null,
      before?.createdAt ?? null,
      before?.baseHeadSeq ?? null,
      before?.createdAt ?? null,
      before?.versionId ?? null,
      limit,
    ) as readonly StoredDocumentVersionRow[];
  return rows.map((row) => toSummary(decodeVersionRow(row)));
};

const validateRestoreRequest = (
  input: PrepareDocumentVersionRestore,
): DocumentVersionActor => {
  if (input.version !== DOCUMENT_VERSION_CONTRACT_VERSION) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      `version must be ${DOCUMENT_VERSION_CONTRACT_VERSION}`,
    );
  }
  requireBoundedString(input.mutationId, "mutationId");
  requireBoundedString(input.projectId, "projectId");
  requireBoundedString(input.storeEpoch, "storeEpoch");
  requireBoundedString(input.documentId, "documentId");
  requireBoundedString(input.versionId, "versionId");
  requireSafeInteger(input.generation, "generation", 1);
  requireSafeInteger(input.expectedHeadSeq, "expectedHeadSeq", 0);
  if (input.clientSessionId !== undefined) {
    requireBoundedString(input.clientSessionId, "clientSessionId");
  }
  return canonicalActor(input.actor).value;
};

export const prepareDocumentVersionRestore = (
  database: Database.Database,
  input: PrepareDocumentVersionRestore,
): PreparedDocumentVersionRestore => {
  const actor = validateRestoreRequest(input);
  const prepare = database.transaction((): PreparedDocumentVersionRestore => {
    assertStoreEpoch(database, input.storeEpoch);
    if (getDocumentProjectId(database, input.documentId) !== input.projectId) {
      throw new DocumentVersionStoreError(
        "project_scope_mismatch",
        `Document ${input.documentId} does not belong to Project ${input.projectId}`,
      );
    }
    const version = getDocumentVersionCheckpoint(database, input);
    let loaded;
    try {
      loaded = loadPrimaryBlockDocument(database, input.documentId);
    } catch (error) {
      if (error instanceof BlockDocumentStoreError) return mapLoadError(error);
      throw error;
    }
    try {
      assertHead(
        {
          expectedGeneration: input.generation,
          expectedHeadSeq: input.expectedHeadSeq,
        },
        loaded.head,
      );
      if (
        version.schemaKey !== loaded.head.schemaKey ||
        version.schemaVersion !== loaded.head.schemaVersion
      ) {
        throw new DocumentVersionStoreError(
          "document_version_schema_mismatch",
          `Version ${version.versionId} uses ${version.schemaKey}@${version.schemaVersion}; current Document uses ${loaded.head.schemaKey}@${loaded.head.schemaVersion}`,
        );
      }
      const adapter = getBlockDocumentSchemaAdapterForSchema({
        schemaKey: loaded.head.schemaKey,
        schemaVersion: loaded.head.schemaVersion,
      });
      const ownerType = loaded.ownerType;
      if (adapter.ownerType !== ownerType) {
        throw new DocumentVersionStoreError(
          "document_version_schema_mismatch",
          `Document owner ${ownerType} does not match ${loaded.head.schemaKey}@${loaded.head.schemaVersion}`,
        );
      }
      const current = inspectOwnedBlockDocument(loaded.document, {
        ownerType,
        schemaKey: loaded.head.schemaKey,
        schemaVersion: loaded.head.schemaVersion,
      }).materialization;
      if (current.kind !== version.materialization.kind) {
        throw new DocumentVersionStoreError(
          "document_version_schema_mismatch",
          `Version ${version.versionId} materialization kind does not match the current Document`,
        );
      }
      const sourceVersion = toSummary(version);
      if (materializationHash(current) === version.materializationHash) {
        return { kind: "already_current", sourceVersion };
      }
      const operations = [
        ...(current.kind !== "card" ||
        version.materialization.kind !== "card" ||
        current.title === version.materialization.title
          ? []
          : [
              {
                kind: "set_title" as const,
                title: version.materialization.title,
              },
            ]),
        ...compileBlockTreeReplacementOperations(
          current.blockTree,
          version.materialization.blockTree,
        ),
      ];
      const plan: DocumentVersionRestorePlan = {
        version: DOCUMENT_VERSION_CONTRACT_VERSION,
        kind: "document_version_restore",
        mutationId: input.mutationId,
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        documentId: input.documentId,
        generation: input.generation,
        expectedHeadSeq: input.expectedHeadSeq,
        ...(input.clientSessionId
          ? { clientSessionId: input.clientSessionId }
          : {}),
        actor,
        sourceVersion,
        ...(version.materialization.kind === "card"
          ? { targetTitle: version.materialization.title }
          : {}),
        targetBlockTree: version.materialization.blockTree,
        operations,
        requiresWriteFence: true,
      };
      return { kind: "operation_plan", plan };
    } finally {
      loaded.document.destroy();
    }
  });
  return prepare();
};

export const listBlockChangeHistory = (
  database: Database.Database,
  input: ListBlockChangeHistory,
): readonly BlockChangeHistoryEntry[] => {
  requireBoundedString(input.projectId, "projectId");
  if (input.blockId !== undefined) {
    requireBoundedString(input.blockId, "blockId", MAX_BLOCK_ID_LENGTH);
  }
  if (input.documentId !== undefined) {
    requireBoundedString(input.documentId, "documentId");
  }
  const beforeChangeSeq =
    input.beforeChangeSeq === undefined
      ? Number.MAX_SAFE_INTEGER
      : requireSafeInteger(input.beforeChangeSeq, "beforeChangeSeq", 1);
  const limit =
    input.limit === undefined
      ? DEFAULT_HISTORY_LIMIT
      : requireSafeInteger(input.limit, "limit", 1);
  if (limit > MAX_DOCUMENT_VERSION_HISTORY_LIMIT) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      `limit must not exceed ${MAX_DOCUMENT_VERSION_HISTORY_LIMIT}`,
    );
  }
  const rows = database
    .prepare(
      `
      SELECT
        change.seq, change.project_id, change.store_epoch, change.kind,
        change.operation_id, change.block_ids_json, change.document_ids_json,
        change.database_block_ids_json, change.payload_json, change.committed_at,
        mutation.mutation_kind, mutation.actor_json,
        mutation.client_session_id, mutation.field_intents_json,
        mutation.outcome AS mutation_outcome
      FROM change_log change
      LEFT JOIN block_mutations mutation ON mutation.change_log_seq = change.seq
      WHERE change.project_id = ?
        AND change.kind IN ('block_mutation', 'block_relocation')
        AND change.seq < ?
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM json_each(change.block_ids_json) block
          WHERE block.value = ?
        ))
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM json_each(change.document_ids_json) document
          WHERE document.value = ?
        ))
      ORDER BY change.seq DESC
      LIMIT ?
    `,
    )
    .all(
      input.projectId,
      beforeChangeSeq,
      input.blockId ?? null,
      input.blockId ?? null,
      input.documentId ?? null,
      input.documentId ?? null,
      limit,
    ) as readonly StoredBlockChangeRow[];
  return rows.map((row): BlockChangeHistoryEntry => {
    if (row.kind !== "block_mutation" && row.kind !== "block_relocation") {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Change ${row.seq} has an unsupported history kind`,
      );
    }
    if (
      row.kind === "block_mutation" &&
      (row.mutation_kind === null || row.mutation_outcome !== "committed")
    ) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Block mutation change ${row.seq} has no committed immutable ledger`,
      );
    }
    const actor =
      row.actor_json === null
        ? {}
        : parseStoredObject(row.actor_json, `change ${row.seq} actor`);
    return {
      changeSeq: row.seq,
      projectId: row.project_id,
      storeEpoch: row.store_epoch,
      kind: row.kind,
      operationId: row.operation_id,
      mutationKind: row.mutation_kind,
      clientSessionId: row.client_session_id,
      actor,
      blockIds: parseStoredStringArray(
        row.block_ids_json,
        `change ${row.seq} Block IDs`,
      ),
      documentIds: parseStoredStringArray(
        row.document_ids_json,
        `change ${row.seq} Document IDs`,
      ),
      databaseBlockIds: parseStoredStringArray(
        row.database_block_ids_json,
        `change ${row.seq} Database Block IDs`,
      ),
      fieldIntents:
        row.field_intents_json === null
          ? []
          : parseStoredArray(
              row.field_intents_json,
              `change ${row.seq} field intents`,
            ),
      payload: parseStoredObject(row.payload_json, `change ${row.seq} payload`),
      committedAt: row.committed_at,
    };
  });
};
