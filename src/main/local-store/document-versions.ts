import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import {
  populateBlockDocumentBodyFromBlockTree,
  type BlockTreeNode,
  type BlockTreeValue,
} from "../../shared/block-documents/block-document-codec";
import {
  getOwnedDocumentSchemaRegistrationForSchema,
  getHistoricalBlockDocumentSchemaAdapterForSchema,
  getBlockDocumentSchemaAdapterForSchema,
  inspectHistoricalOwnedBlockDocument,
  inspectRegisteredOwnedBlockDocument,
  type RegisteredOwnedDocumentMaterialization,
} from "../../shared/block-documents/document-schema-adapters";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/page-document";
import {
  canonicalPortableCanvasSceneFingerprint,
  canonicalPortableCanvasSceneSemanticFingerprint,
  canonicalStringifyCanvasScene,
  compilePortableCanvasSceneForwardRestore,
  parsePortableCanvasScene,
} from "../../shared/block-documents/canvas-scene";
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
import { syncCanvasScene } from "./canvas-scene-store";
import {
  canonicalizePortableRichText,
  portableRichTextSemanticSource,
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import { planDocumentRevisionRetention } from "../../shared/block-documents/document-revision-retention";

const MAX_SCOPE_ID_LENGTH = 512;
const DEFAULT_HISTORY_LIMIT = 50;
const VERSION_ID_PREFIX = "document-version:";

const schemasSupportForwardRestore = (
  historical: { readonly schemaKey: string; readonly schemaVersion: number },
  current: { readonly schemaKey: string; readonly schemaVersion: number },
): boolean => {
  if (historical.schemaKey !== current.schemaKey) return false;
  if (historical.schemaVersion === current.schemaVersion) return true;
  return (
    historical.schemaKey === PAGE_DOCUMENT_SCHEMA_KEY &&
    historical.schemaVersion === 1 &&
    current.schemaVersion === PAGE_DOCUMENT_SCHEMA_VERSION
  );
};

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
  readonly revision_kind:
    | "automatic"
    | "manual"
    | "operation"
    | "restore"
    | "safety";
  readonly source_mutation_id: string | null;
  readonly source_change_seq: number | null;
  readonly pinned: 0 | 1;
  readonly checkpoint_format:
    | "yjs_update_v1"
    | "block_tree_snapshot_v2"
    | "canvas_scene_json_v1";
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

interface DocumentHistoryAuthorityRow {
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly sync_engine: "yjs" | "canvas_scene";
  readonly readiness: string;
  readonly owner_block_id: string;
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

export type BlockTreeDocumentMaterialization = Exclude<
  RegisteredOwnedDocumentMaterialization,
  { readonly kind: "canvas_scene" }
>;

export interface BlockTreeSnapshotV2Record {
  readonly version_id: string;
  readonly document_id: string;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly full_update_blob: Buffer;
}

interface BlockTreeSnapshotV2Payload {
  readonly formatVersion: 2;
  readonly kind: BlockTreeDocumentMaterialization["kind"];
  readonly blockTree: readonly BlockTreeNode[];
  readonly richTitle?: PortableRichText;
}

const encodeBlockTreeSnapshotV2 = (
  materialization: BlockTreeDocumentMaterialization,
): Uint8Array => {
  const payload: BlockTreeSnapshotV2Payload = {
    formatVersion: 2,
    kind: materialization.kind,
    blockTree: materialization.blockTree,
    ...(materialization.kind === "page"
      ? { richTitle: materialization.richTitle }
      : {}),
  };
  return Buffer.from(stableStringifyTrustedValue(payload), "utf8");
};

export const decodeBlockTreeSnapshotV2 = (
  row: BlockTreeSnapshotV2Record,
): BlockTreeDocumentMaterialization => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.full_update_blob.toString("utf8")) as unknown;
  } catch (error) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} contains invalid snapshot JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    parsed === null ||
    Array.isArray(parsed) ||
    typeof parsed !== "object"
  ) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} snapshot must be an object`,
    );
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  if (
    record.formatVersion !== 2 ||
    typeof record.kind !== "string" ||
    !Array.isArray(record.blockTree) ||
    stableStringifyTrustedValue(parsed) !== row.full_update_blob.toString("utf8")
  ) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} snapshot is not canonical v2 content`,
    );
  }

  let adapter;
  try {
    adapter = getBlockDocumentSchemaAdapterForSchema({
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
  } catch (error) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} has no snapshot schema adapter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (adapter.kind !== record.kind) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} snapshot kind does not match its schema`,
    );
  }
  const expectedKeys =
    adapter.kind === "page"
      ? ["blockTree", "formatVersion", "kind", "richTitle"]
      : ["blockTree", "formatVersion", "kind"];
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} snapshot contains unexpected fields`,
    );
  }

  const envelope = adapter.create(row.document_id);
  try {
    populateBlockDocumentBodyFromBlockTree(
      envelope.body,
      record.blockTree as readonly BlockTreeNode[],
    );
    if (envelope.kind === "page") {
      if (!Array.isArray(record.richTitle)) {
        throw new TypeError("Page snapshot is missing richTitle");
      }
      replaceYTextWithPortableRichText(
        envelope.title,
        canonicalizePortableRichText(record.richTitle as PortableRichText),
      );
    } else if (record.richTitle !== undefined) {
      throw new TypeError("Body-only snapshot cannot contain richTitle");
    }
    return adapter.inspect(envelope.document).materialization;
  } catch (error) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    envelope.document.destroy();
  }
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

const readDocumentHistoryAuthority = (
  database: Database.Database,
  documentId: string,
): DocumentHistoryAuthorityRow => {
  const row = database.prepare(
    `SELECT document.project_id, document.generation, document.head_seq,
      document.schema_key, document.schema_version, document.sync_engine,
      document.readiness, ownership.block_id AS owner_block_id
     FROM documents document
     INNER JOIN block_documents ownership
       ON ownership.document_id = document.id
       AND ownership.project_id = document.project_id
     WHERE document.id = ?`,
  ).get(documentId) as DocumentHistoryAuthorityRow | undefined;
  if (row) return row;
  throw new DocumentVersionStoreError(
    "document_not_found",
    `Document does not exist: ${documentId}`,
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
  materialization: RegisteredOwnedDocumentMaterialization,
): string => {
  const canonical =
    materialization.kind === "canvas_scene"
      ? canonicalPortableCanvasSceneFingerprint(materialization)
      : stableStringifyTrustedValue({
          schemaVersion: materialization.schemaVersion,
          kind: materialization.kind,
          ...(materialization.kind === "page"
            ? { richTitle: materialization.richTitle }
            : {}),
          blockTree: materialization.blockTree,
          nfm: materialization.nfm,
          plainText: materialization.plainText,
          preview: materialization.preview,
          references: materialization.references,
          assetRefs: materialization.assetRefs,
        });
  return createHash("sha256").update(canonical).digest("hex");
};

const countBlocks = (
  blocks: Exclude<
    RegisteredOwnedDocumentMaterialization,
    { readonly kind: "canvas_scene" }
  >["blockTree"],
): number =>
  blocks.reduce((count, block) => count + 1 + countBlocks(block.children), 0);

export const pruneDocumentRevisionHistory = (
  database: Database.Database,
  documentId: string,
  now: string,
): number => {
  const candidates = database
    .prepare(
      `SELECT version_id, created_at, pinned
       FROM document_versions
       WHERE document_id = ?`,
    )
    .all(documentId) as readonly {
    readonly version_id: string;
    readonly created_at: string;
    readonly pinned: number;
  }[];
  const plan = planDocumentRevisionRetention(
    candidates.map((candidate) => ({
      versionId: candidate.version_id,
      createdAt: candidate.created_at,
      pinned: candidate.pinned === 1,
    })),
    now,
  );
  const remove = database.prepare(
    `DELETE FROM document_versions
     WHERE version_id = ? AND document_id = ? AND pinned = 0`,
  );
  let deleted = 0;
  for (const versionId of plan.deletedVersionIds) {
    deleted += remove.run(versionId, documentId).changes;
  }
  return deleted;
};

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
        schema_key, schema_version, cause, label, actor_json, revision_kind,
        source_mutation_id, source_change_seq, pinned, checkpoint_format,
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
    hashBytes(row.full_update_blob) !== row.checkpoint_hash ||
    ![
      "automatic",
      "manual",
      "operation",
      "restore",
      "safety",
    ].includes(row.revision_kind) ||
    (row.source_mutation_id !== null &&
      (row.source_mutation_id.length < 1 || row.source_mutation_id.length > 512)) ||
    (row.source_change_seq !== null &&
      (!Number.isSafeInteger(row.source_change_seq) || row.source_change_seq < 1)) ||
    (row.pinned !== 0 && row.pinned !== 1)
  ) {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} has invalid persisted metadata`,
    );
  }
  const actor = parseStoredObject(row.actor_json, "Document version actor");
  const revisionMetadata = {
    revisionKind: row.revision_kind,
    sourceMutationId: row.source_mutation_id,
    sourceChangeSeq: row.source_change_seq,
    pinned: row.pinned === 1,
  } as const;
  if (row.checkpoint_format === "canvas_scene_json_v1") {
    if (row.state_vector.byteLength !== 0) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Canvas Document version ${row.version_id} contains Yjs causal state`,
      );
    }
    let materialization: RegisteredOwnedDocumentMaterialization;
    try {
      const adapter = getOwnedDocumentSchemaRegistrationForSchema({
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      });
      if (adapter.contentModel !== "scene_graph") {
        throw new TypeError("scene checkpoint uses a non-scene schema");
      }
      materialization = parsePortableCanvasScene(
        JSON.parse(row.full_update_blob.toString("utf8")) as unknown,
      );
    } catch (error) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Canvas Document version ${row.version_id} cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
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
      ...revisionMetadata,
      checkpointHash: row.checkpoint_hash,
      checkpointMetadata: { format: "canvas_scene_json_v1" },
      materializationHash: materializationHash(materialization),
      byteLength: row.byte_length,
      materializationKind: materialization.kind,
      title: null,
      preview: materialization.preview,
      blockCount: materialization.elements.length,
      createdAt: row.created_at,
      sceneJson: asBytes(row.full_update_blob),
      materialization,
    };
  }
  if (row.checkpoint_format === "block_tree_snapshot_v2") {
    if (row.state_vector.byteLength !== 0) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `BlockTree Document version ${row.version_id} contains Yjs causal state`,
      );
    }
    const materialization = decodeBlockTreeSnapshotV2(row);
    if (materialization.schemaVersion !== row.schema_version) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Document version ${row.version_id} schema metadata diverges from its snapshot`,
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
      ...revisionMetadata,
      checkpointHash: row.checkpoint_hash,
      checkpointMetadata: { format: "block_tree_snapshot_v2" },
      materializationHash: materializationHash(materialization),
      byteLength: row.byte_length,
      materializationKind: materialization.kind,
      title: materialization.kind === "page" ? materialization.title : null,
      preview: materialization.preview,
      blockCount: countBlocks(materialization.blockTree),
      createdAt: row.created_at,
      snapshotJson: asBytes(row.full_update_blob),
      materialization,
    };
  }
  if (row.checkpoint_format !== "yjs_update_v1") {
    throw new DocumentVersionStoreError(
      "document_version_corrupt",
      `Document version ${row.version_id} uses an unknown checkpoint format`,
    );
  }
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
    let materialization: RegisteredOwnedDocumentMaterialization;
    try {
      const adapter = getHistoricalBlockDocumentSchemaAdapterForSchema({
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      });
      materialization = inspectHistoricalOwnedBlockDocument(document, {
        ownerType: adapter.ownerType,
        schemaKey: row.schema_key,
        schemaVersion: row.schema_version,
      }).materialization;
    } catch (error) {
      throw new DocumentVersionStoreError(
        "document_version_corrupt",
        `Document version ${row.version_id} is not a valid registered Document: ${error instanceof Error ? error.message : String(error)}`,
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
      ...revisionMetadata,
      checkpointHash: row.checkpoint_hash,
      checkpointMetadata: {
        format: "yjs_update_v1",
        stateVectorHash: hashBytes(stateVector),
      },
      materializationHash: materializationHash(materialization),
      byteLength: row.byte_length,
      materializationKind: materialization.kind,
      title: materialization.kind === "page" ? materialization.title : null,
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
  revisionKind: checkpoint.revisionKind,
  sourceMutationId: checkpoint.sourceMutationId,
  sourceChangeSeq: checkpoint.sourceChangeSeq,
  pinned: checkpoint.pinned,
  checkpointHash: checkpoint.checkpointHash,
  checkpointMetadata: checkpoint.checkpointMetadata,
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
  readonly revisionKind: DocumentVersionCheckpoint["revisionKind"];
  readonly sourceMutationId: string | null;
  readonly sourceChangeSeq: number | null;
  readonly pinned: boolean;
  readonly checkpointHash: string;
  readonly checkpointMetadata: DocumentVersionCheckpoint["checkpointMetadata"];
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
    readonly revisionKind: DocumentVersionCheckpoint["revisionKind"];
    readonly sourceMutationId: string | null;
    readonly sourceChangeSeq: number | null;
    readonly pinned: boolean;
  },
): DocumentVersionCheckpoint | null => {
  const rows = database
    .prepare(
      `
      SELECT
        version_id, document_id, project_id, generation, base_head_seq,
        schema_key, schema_version, cause, label, actor_json, revision_kind,
        source_mutation_id, source_change_seq, pinned, checkpoint_format,
        full_update_blob, state_vector, checkpoint_hash, byte_length, created_at
      FROM document_versions
      WHERE project_id = ? AND document_id = ?
        AND generation = ? AND base_head_seq = ?
        AND cause = ? AND label IS ? AND actor_json = ?
        AND revision_kind = ? AND source_mutation_id IS ?
        AND source_change_seq IS ? AND pinned = ?
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
      request.revisionKind,
      request.sourceMutationId,
      request.sourceChangeSeq,
      request.pinned ? 1 : 0,
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
      revisionKind: request.revisionKind,
      sourceMutationId: request.sourceMutationId,
      sourceChangeSeq: request.sourceChangeSeq,
      pinned: request.pinned,
      checkpointHash: checkpoint.checkpointHash,
      checkpointMetadata: checkpoint.checkpointMetadata,
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
  readonly revisionKind: DocumentVersionCheckpoint["revisionKind"];
  readonly sourceMutationId: string | null;
  readonly sourceChangeSeq: number | null;
  readonly pinned: boolean;
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
  const revisionKind = input.revisionKind ?? "manual";
  if (
    ![
      "automatic",
      "manual",
      "operation",
      "restore",
      "safety",
    ].includes(revisionKind)
  ) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      "revisionKind is not supported",
    );
  }
  const sourceMutationId = input.sourceMutationId === undefined
    ? null
    : requireBoundedString(input.sourceMutationId, "sourceMutationId");
  const sourceChangeSeq = input.sourceChangeSeq === undefined
    ? null
    : requireSafeInteger(input.sourceChangeSeq, "sourceChangeSeq", 1);
  if (sourceChangeSeq !== null && sourceMutationId === null) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      "sourceChangeSeq requires sourceMutationId",
    );
  }
  if (
    (revisionKind === "operation" || revisionKind === "restore") &&
    sourceMutationId === null
  ) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      `${revisionKind} revisions require sourceMutationId`,
    );
  }
  if (
    revisionKind !== "operation" &&
    revisionKind !== "restore" &&
    (sourceMutationId !== null || sourceChangeSeq !== null)
  ) {
    throw new DocumentVersionStoreError(
      "invalid_document_version_request",
      `${revisionKind} revisions cannot link mutation evidence`,
    );
  }
  return {
    cause,
    label,
    actor: actor.value,
    actorJson: actor.json,
    revisionKind,
    sourceMutationId,
    sourceChangeSeq,
    pinned: revisionKind === "manual" || revisionKind === "restore",
  };
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
    readonly revisionKind: DocumentVersionCheckpoint["revisionKind"];
    readonly sourceMutationId: string | null;
    readonly sourceChangeSeq: number | null;
    readonly pinned: boolean;
    readonly checkpointFormat: StoredDocumentVersionRow["checkpoint_format"];
    readonly checkpointBytes: Uint8Array;
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
    stored.revisionKind === expected.revisionKind &&
    stored.sourceMutationId === expected.sourceMutationId &&
    stored.sourceChangeSeq === expected.sourceChangeSeq &&
    stored.pinned === expected.pinned &&
    stored.checkpointHash === expected.checkpointHash &&
    stored.checkpointMetadata.format === expected.checkpointFormat &&
    bytesEqual(
      "fullUpdate" in stored
        ? stored.fullUpdate
        : "snapshotJson" in stored
          ? stored.snapshotJson
          : stored.sceneJson,
      expected.checkpointBytes,
    ) &&
    (!("stateVector" in stored)
      ? expected.stateVector.byteLength === 0
      : bytesEqual(stored.stateVector, expected.stateVector))
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
    const authority = readDocumentHistoryAuthority(database, input.documentId);
    if (authority.project_id !== input.projectId) {
      throw new DocumentVersionStoreError(
        "project_scope_mismatch",
        `Document ${input.documentId} does not belong to Project ${input.projectId}`,
      );
    }
    if (authority.readiness !== "ready" || authority.owner_block_id.length === 0) {
      throw new DocumentVersionStoreError(
        "document_not_ready",
        `Document ${input.documentId} is not ready for checkpointing`,
      );
    }
    assertHead(input, {
      generation: authority.generation,
      headSeq: authority.head_seq,
    });
    options.faultInjector?.("after_authority_load");

    let checkpointFormat: StoredDocumentVersionRow["checkpoint_format"];
    let checkpointBytes: Uint8Array;
    let stateVector: Uint8Array;
    let materialization: RegisteredOwnedDocumentMaterialization;
    if (authority.sync_engine === "canvas_scene") {
      const synced = syncCanvasScene(database, {
        version: 1,
        projectId: input.projectId,
        documentId: input.documentId,
        clientSessionId: "document-history:checkpoint",
        knownStoreEpoch: input.storeEpoch,
        knownGeneration: input.expectedGeneration,
        knownHeadSeq: input.expectedHeadSeq,
      });
      if (!synced.ok) {
        throw new DocumentVersionStoreError(
          synced.error.code === "document_not_found"
            ? "document_not_found"
            : synced.error.code === "document_not_ready"
              ? "document_not_ready"
              : "document_version_corrupt",
          synced.error.message,
        );
      }
      checkpointFormat = "canvas_scene_json_v1";
      checkpointBytes = Buffer.from(
        canonicalStringifyCanvasScene(synced.value.scene),
        "utf8",
      );
      stateVector = new Uint8Array();
      materialization = synced.value.scene;
    } else {
      let loaded;
      try {
        loaded = loadPrimaryBlockDocument(database, input.documentId);
      } catch (error) {
        if (error instanceof BlockDocumentStoreError) return mapLoadError(error);
        throw error;
      }
      try {
        const currentStateVector = Y.encodeStateVector(loaded.document);
        if (!bytesEqual(currentStateVector, loaded.head.stateVector)) {
          throw new DocumentVersionStoreError(
            "document_version_corrupt",
            `Document ${input.documentId} state changed while checkpointing`,
          );
        }
        materialization = inspectRegisteredOwnedBlockDocument(
          loaded.document,
          {
            ownerType: loaded.ownerType,
            schemaKey: loaded.head.schemaKey,
            schemaVersion: loaded.head.schemaVersion,
          },
        ).materialization;
        checkpointFormat = "block_tree_snapshot_v2";
        checkpointBytes = encodeBlockTreeSnapshotV2(materialization);
        stateVector = new Uint8Array();
      } finally {
        loaded.document.destroy();
      }
    }
    const checkpointHash = hashBytes(checkpointBytes);
    const checkpointMetadata =
      checkpointFormat === "block_tree_snapshot_v2"
        ? { format: "block_tree_snapshot_v2" as const }
        : { format: "canvas_scene_json_v1" as const };
    const semanticHash = materializationHash(materialization);
    const versionId = createVersionId({
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      documentId: input.documentId,
      generation: authority.generation,
      baseHeadSeq: authority.head_seq,
      schemaKey: authority.schema_key,
      schemaVersion: authority.schema_version,
      cause: request.cause,
      label: request.label,
      actor: request.actor,
      revisionKind: request.revisionKind,
      sourceMutationId: request.sourceMutationId,
      sourceChangeSeq: request.sourceChangeSeq,
      pinned: request.pinned,
      checkpointHash,
      checkpointMetadata,
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
            revision_kind, source_mutation_id, source_change_seq, pinned,
            checkpoint_format, full_update_blob, state_vector, checkpoint_hash,
            byte_length, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(version_id) DO NOTHING
        `,
      )
      .run(
        versionId,
        input.documentId,
        input.projectId,
        authority.generation,
        authority.head_seq,
        authority.schema_key,
        authority.schema_version,
        request.cause,
        request.label,
        request.actorJson,
        request.revisionKind,
        request.sourceMutationId,
        request.sourceChangeSeq,
        request.pinned ? 1 : 0,
        checkpointFormat,
        Buffer.from(checkpointBytes),
        Buffer.from(stateVector),
        checkpointHash,
        checkpointBytes.byteLength,
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
      generation: authority.generation,
      baseHeadSeq: authority.head_seq,
      schemaKey: authority.schema_key,
      schemaVersion: authority.schema_version,
      cause: request.cause,
      label: request.label,
      actorJson: request.actorJson,
      revisionKind: request.revisionKind,
      sourceMutationId: request.sourceMutationId,
      sourceChangeSeq: request.sourceChangeSeq,
      pinned: request.pinned,
      checkpointFormat,
      checkpointBytes,
      stateVector,
      checkpointHash,
    });
    pruneDocumentRevisionHistory(database, input.documentId, createdAt);
    options.faultInjector?.("before_commit");
    return { checkpoint, duplicate: inserted.changes === 0 };
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
        schema_key, schema_version, cause, label, actor_json, revision_kind,
        source_mutation_id, source_change_seq, pinned, checkpoint_format,
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
    const authority = readDocumentHistoryAuthority(database, input.documentId);
    assertHead(
      {
        expectedGeneration: input.generation,
        expectedHeadSeq: input.expectedHeadSeq,
      },
      { generation: authority.generation, headSeq: authority.head_seq },
    );
    if (!schemasSupportForwardRestore(version, {
      schemaKey: authority.schema_key,
      schemaVersion: authority.schema_version,
    })) {
      throw new DocumentVersionStoreError(
        "document_version_schema_mismatch",
        `Version ${version.versionId} does not match the current Document schema`,
      );
    }
    const sourceVersion = toSummary(version);
    const planBase = {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      kind: "document_version_restore" as const,
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
      requiresWriteFence: true as const,
    } as const;
    if (authority.sync_engine === "canvas_scene") {
      if (
        version.checkpointMetadata.format !== "canvas_scene_json_v1" ||
        version.materialization.kind !== "canvas_scene"
      ) {
        throw new DocumentVersionStoreError(
          "document_version_schema_mismatch",
          "Canvas restore requires a scene-native checkpoint",
        );
      }
      const synced = syncCanvasScene(database, {
        version: 1,
        projectId: input.projectId,
        documentId: input.documentId,
        clientSessionId: input.clientSessionId ?? "document-history:restore",
        knownStoreEpoch: input.storeEpoch,
        knownGeneration: input.generation,
        knownHeadSeq: input.expectedHeadSeq,
      });
      if (!synced.ok) {
        throw new DocumentVersionStoreError(
          "document_version_corrupt",
          synced.error.message,
        );
      }
      if (
        canonicalPortableCanvasSceneSemanticFingerprint(synced.value.scene) ===
        canonicalPortableCanvasSceneSemanticFingerprint(version.materialization)
      ) {
        return { kind: "already_current", sourceVersion };
      }
      return {
        kind: "operation_plan",
        plan: {
          ...planBase,
          contentModel: "scene_graph",
          forwardRestore: compilePortableCanvasSceneForwardRestore({
            current: synced.value.scene,
            target: version.materialization,
            restoreIdentity: input.mutationId,
          }),
        },
      };
    }
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
      if (!schemasSupportForwardRestore(version, loaded.head)) {
        throw new DocumentVersionStoreError(
          "document_version_schema_mismatch",
          `Version ${version.versionId} uses ${version.schemaKey}@${version.schemaVersion}; current Document uses ${loaded.head.schemaKey}@${loaded.head.schemaVersion}`,
        );
      }
      const registeredAdapter =
        getBlockDocumentSchemaAdapterForSchema({
          schemaKey: loaded.head.schemaKey,
          schemaVersion: loaded.head.schemaVersion,
        });
      const ownerType = loaded.ownerType;
      if (registeredAdapter.ownerType !== ownerType) {
        throw new DocumentVersionStoreError(
          "document_version_schema_mismatch",
          `Document owner ${ownerType} does not match ${loaded.head.schemaKey}@${loaded.head.schemaVersion}`,
        );
      }
      const current = inspectRegisteredOwnedBlockDocument(loaded.document, {
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
      if (materializationHash(current) === version.materializationHash) {
        return { kind: "already_current", sourceVersion };
      }
      const adapter = getBlockDocumentSchemaAdapterForSchema({
        schemaKey: loaded.head.schemaKey,
        schemaVersion: loaded.head.schemaVersion,
      });
      if (adapter.ownerType !== ownerType) {
        throw new DocumentVersionStoreError(
          "document_version_schema_mismatch",
          `Document owner ${ownerType} does not match ${loaded.head.schemaKey}@${loaded.head.schemaVersion}`,
        );
      }
      const operations = [
        ...(current.kind !== "page" ||
        version.materialization.kind !== "page" ||
        portableRichTextSemanticSource(current.richTitle) ===
          portableRichTextSemanticSource(version.materialization.richTitle)
          ? []
          : [
              {
                kind: "set_rich_title" as const,
                richTitle: version.materialization.richTitle,
              },
            ]),
        ...compileBlockTreeReplacementOperations(
          current.blockTree,
          version.materialization.blockTree,
        ),
      ];
      const plan: DocumentVersionRestorePlan = {
        ...planBase,
        contentModel: "block_tree",
        ...(version.materialization.kind === "page"
          ? {
              targetTitle: version.materialization.title,
              targetRichTitle: version.materialization.richTitle,
            }
          : {}),
        targetBlockTree: version.materialization.blockTree,
        operations,
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
