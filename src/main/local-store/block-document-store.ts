import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import {
  assertValidBlockDocument,
  assertValidCardDocumentRoots,
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  MAX_BLOCK_ID_LENGTH,
  MAX_CARD_DOCUMENT_BLOCKS,
  MAX_CARD_DOCUMENT_BODY_XML_LENGTH,
  MAX_CARD_DOCUMENT_STATE_BYTES,
  MAX_CARD_DOCUMENT_UPDATE_BYTES,
  MAX_CARD_DOCUMENT_XML_PATH_DEPTH,
  MAX_DOCUMENT_TOUCHED_BLOCK_IDS,
  type ApplyDocumentUpdate,
  type BlockId,
  type DocumentHead,
  type DocumentId,
  type DocumentAuthority,
  type DocumentReadiness,
  type DocumentSyncApplyAck,
  type DocumentSyncCommandError,
  type DocumentSyncErrorCode,
  type DocumentSyncRequest,
  type DocumentSyncResponse,
  type ScannedDocumentBlock,
} from "../../shared/block-documents";
import {
  materializeCardDocument,
  type CardDocumentMaterialization,
} from "../../shared/block-documents/block-document-codec";
import {
  DocumentOperationContractError,
  parseDocumentOperationResult,
} from "../../shared/block-documents/document-operations";
import { isLegacyForeignBodyReference } from "../../shared/block-documents/derived-records";
import {
  captureBlockDocumentChangeState,
  deriveBlockDocumentTouchedIds,
} from "./block-document-change-set";
import { replaceDocumentSecondaryProjections } from "./block-document-projections";
import { persistCardDocumentMaterialization } from "./document-materializations";

interface DocumentRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly owner_block_id: string;
  readonly owner_lifecycle: "active" | "archived" | "deleted";
  readonly owner_type: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly schema_key: string;
  readonly schema_version: number;
  readonly state_vector: Buffer;
  readonly state_hash: string;
  readonly readiness: DocumentReadiness;
  readonly authority: DocumentAuthority;
}

interface StoredDocumentUpdateReceiptRow {
  readonly generation: number;
  readonly seq: number;
  readonly client_session_id: string;
  readonly base_head_seq: number;
  readonly client_touched_block_ids_json: string;
  readonly derived_touched_block_ids_json: string;
  readonly derivation_version: number;
  readonly update_hash: string;
  readonly update_byte_length: number;
}

interface DocumentSnapshotRow {
  readonly snapshot_seq: number;
  readonly state_vector: Buffer;
  readonly snapshot_update: Buffer;
  readonly snapshot_hash: string;
  readonly schema_version: number;
}

interface DocumentTailUpdateRow {
  readonly seq: number;
  readonly update_blob: Buffer;
  readonly update_hash: string;
}

type RecoveryArtifactReason = "block_relocated" | "unsafe_stale_update";

interface StoredRecoveryArtifactRow {
  readonly id: string;
  readonly store_epoch: string;
  readonly client_session_id: string;
  readonly base_head_seq: number;
  readonly touched_block_ids_json: string;
  readonly derived_touched_block_ids_json: string | null;
  readonly update_blob: Buffer;
  readonly update_hash: string;
  readonly update_byte_length: number;
  readonly reason: RecoveryArtifactReason;
  readonly relocation_ids_json: string;
}

interface CrossedRelocationRow {
  readonly relocation_id: string;
  readonly source_committed_seq: number;
  readonly pre_state_vector: Buffer | null;
  readonly pre_full_update: Buffer | null;
  readonly pre_full_update_byte_length: number | null;
  readonly pre_state_hash: string | null;
}

interface CrossedRelocationMemberRow {
  readonly relocation_id: string;
  readonly block_id: string;
}

interface CrossedDocumentMutationRow {
  readonly mutation_id: string;
  readonly result_json: string;
}

interface CrossedDocumentMutationBarrier {
  readonly mutationId: string;
  readonly committedSeq: number;
  readonly writeFenceBlockIds: readonly BlockId[];
}

interface StaleStructuralInspection {
  readonly relocationIds: readonly string[];
  readonly derivedTouchedBlockIds: readonly BlockId[] | null;
  readonly rejectionReason: RecoveryArtifactReason | null;
  readonly rejectedRelocationId?: string;
}

interface RecoveryArtifactOutcome {
  readonly kind: "recovery";
  readonly code: "block_relocated" | "recovery_required";
  readonly artifactId: string;
  readonly relocationId?: string;
}

type ApplyBlockDocumentUpdateOutcome =
  | { readonly kind: "ack"; readonly ack: DocumentUpdateAck }
  | RecoveryArtifactOutcome;

export type BlockDocumentStoreErrorCode =
  | "store_not_initialized"
  | "store_epoch_mismatch"
  | "document_not_found"
  | "document_not_ready"
  | "document_authority_mismatch"
  | "document_already_initialized"
  | "document_generation_mismatch"
  | "unsupported_document_schema"
  | "future_base_head"
  | "invalid_document_update"
  | "document_update_missing_dependencies"
  | "update_id_collision"
  | "block_relocated"
  | "recovery_required"
  | "document_state_corrupt";

export interface BlockDocumentStoreErrorDetails {
  readonly relocationId?: string;
  readonly recoveryArtifactId?: string;
}

export class BlockDocumentStoreError extends Error {
  readonly code: BlockDocumentStoreErrorCode;
  readonly relocationId?: string;
  readonly recoveryArtifactId?: string;

  constructor(
    code: BlockDocumentStoreErrorCode,
    message: string,
    details: BlockDocumentStoreErrorDetails = {},
  ) {
    super(message);
    this.name = "BlockDocumentStoreError";
    this.code = code;
    this.relocationId = details.relocationId;
    this.recoveryArtifactId = details.recoveryArtifactId;
  }
}

const toDocumentSyncErrorCode = (error: unknown): DocumentSyncErrorCode => {
  if (!(error instanceof BlockDocumentStoreError)) {
    return "unknown";
  }

  switch (error.code) {
    case "store_not_initialized":
    case "store_epoch_mismatch":
    case "document_not_found":
    case "document_not_ready":
    case "document_generation_mismatch":
    case "unsupported_document_schema":
    case "future_base_head":
    case "invalid_document_update":
    case "document_update_missing_dependencies":
    case "update_id_collision":
    case "block_relocated":
    case "recovery_required":
    case "document_state_corrupt":
      return error.code;
    case "document_authority_mismatch":
      return "document_not_ready";
    case "document_already_initialized":
      return "invalid_document_update";
  }
};

export const toDocumentSyncCommandError = (
  error: unknown,
): DocumentSyncCommandError => {
  const code = toDocumentSyncErrorCode(error);
  const details =
    error instanceof BlockDocumentStoreError
      ? {
          ...(error.relocationId ? { relocationId: error.relocationId } : {}),
          ...(error.recoveryArtifactId
            ? { recoveryArtifactId: error.recoveryArtifactId }
            : {}),
        }
      : {};
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable:
      code === "store_not_initialized" ||
      code === "document_not_ready" ||
      code === "future_base_head" ||
      code === "document_update_missing_dependencies",
    resetRequired:
      code === "store_epoch_mismatch" ||
      code === "document_not_found" ||
      code === "document_generation_mismatch" ||
      code === "unsupported_document_schema" ||
      code === "block_relocated" ||
      code === "recovery_required" ||
      code === "document_state_corrupt",
    ...details,
  };
};

export interface LoadedBlockDocument {
  readonly storeEpoch: string;
  readonly authority: DocumentAuthority;
  readonly head: DocumentHead;
  readonly document: Y.Doc;
}

export interface BlockDocumentRuntimeIdentity {
  readonly storeEpoch: string;
  readonly authority: DocumentAuthority;
  readonly head: DocumentHead;
  readonly stateHash: string;
}

export interface InitializeCardDocumentGenesis {
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly updateId: string;
  readonly clientSessionId: string;
  readonly update: Uint8Array;
}

export type DocumentUpdateAck = DocumentSyncApplyAck;

export interface StrictDocumentUpdateCommitContext {
  readonly projectId: string;
  readonly ownerBlockId: BlockId;
  readonly documentId: DocumentId;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly updateId: string;
  readonly derivedTouchedBlockIds: readonly BlockId[];
  readonly committedAt: string;
}

export interface StrictDocumentUpdateCommitPolicy {
  /** Return the original committed sequence for an exact logical retry. */
  readonly readCommittedSeq: (database: Database.Database) => number | null;
  /** Throw a domain-specific typed conflict unless the current head is valid. */
  readonly assertCurrentHead: (currentHeadSeq: number) => void;
  /** Persist the logical mutation receipt/history inside the Y.Doc transaction. */
  readonly persistCommit: (
    database: Database.Database,
    context: StrictDocumentUpdateCommitContext,
  ) => void;
}

export interface DocumentSyncStep {
  readonly storeEpoch: string;
  readonly head: DocumentHead;
  readonly update: Uint8Array;
}

export interface CompactBlockDocumentInput {
  readonly documentId: DocumentId;
  readonly expectedGeneration?: number;
  readonly expectedHeadSeq?: number;
}

export interface CompactBlockDocumentResult {
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly snapshotSeq: number;
  readonly snapshotBytes: number;
  readonly prunedUpdateCount: number;
  readonly retainedReceiptCount: number;
}

const LOAD_DOCUMENT_ROW_SQL = `
  SELECT
    document.id AS document_id,
    document.project_id,
    ownership.block_id AS owner_block_id,
    owner.lifecycle AS owner_lifecycle,
    owner.type AS owner_type,
    document.generation,
    document.head_seq,
    document.schema_key,
    document.schema_version,
    document.state_vector,
    document.state_hash,
    document.readiness,
    document.authority
  FROM documents document
  JOIN block_documents ownership ON ownership.document_id = document.id
  JOIN blocks owner ON owner.id = ownership.block_id
  WHERE document.id = ?
`;

const toUint8Array = (value: Uint8Array): Uint8Array =>
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

const hashBytes = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const requireNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  throw new BlockDocumentStoreError(
    "invalid_document_update",
    `${field} must not be empty`,
  );
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { store_epoch: string } | undefined;
  if (row) {
    return row.store_epoch;
  }

  throw new BlockDocumentStoreError(
    "store_not_initialized",
    "Block document store metadata is missing",
  );
};

const assertStoreEpoch = (
  database: Database.Database,
  expectedStoreEpoch: string,
): string => {
  const storeEpoch = readStoreEpoch(database);
  if (storeEpoch === expectedStoreEpoch) {
    return storeEpoch;
  }

  throw new BlockDocumentStoreError(
    "store_epoch_mismatch",
    `Document update belongs to store epoch ${expectedStoreEpoch}; current epoch is ${storeEpoch}`,
  );
};

const readDocumentRow = (
  database: Database.Database,
  documentId: DocumentId,
): DocumentRow => {
  const row = database.prepare(LOAD_DOCUMENT_ROW_SQL).get(documentId) as
    DocumentRow | undefined;
  if (row) {
    return row;
  }

  throw new BlockDocumentStoreError(
    "document_not_found",
    `Block document does not exist: ${documentId}`,
  );
};

const toDocumentHead = (row: DocumentRow): DocumentHead => ({
  documentId: row.document_id,
  ownerBlockId: row.owner_block_id,
  generation: row.generation,
  headSeq: row.head_seq,
  schemaKey: row.schema_key,
  schemaVersion: row.schema_version,
  stateVector: toUint8Array(row.state_vector),
});

const assertReady = (row: DocumentRow): void => {
  if (row.readiness === "ready") {
    return;
  }

  throw new BlockDocumentStoreError(
    "document_not_ready",
    `Block document ${row.document_id} is ${row.readiness}`,
  );
};

const assertDocumentAuthority = (
  row: DocumentRow,
  authority: DocumentAuthority,
): void => {
  if (row.authority === authority) return;
  throw new BlockDocumentStoreError(
    "document_authority_mismatch",
    `Document ${row.document_id} has ${row.authority} authority; expected ${authority}`,
  );
};

const assertGeneration = (row: DocumentRow, generation: number): void => {
  if (row.generation === generation) {
    return;
  }

  throw new BlockDocumentStoreError(
    "document_generation_mismatch",
    `Document ${row.document_id} generation is ${row.generation}, received ${generation}`,
  );
};

const assertSupportedCardSchema = (row: DocumentRow): void => {
  if (
    row.schema_key === CARD_DOCUMENT_SCHEMA_KEY &&
    row.schema_version === CARD_DOCUMENT_SCHEMA_VERSION
  ) {
    return;
  }

  throw new BlockDocumentStoreError(
    "unsupported_document_schema",
    `Document ${row.document_id} uses unsupported schema ${row.schema_key}@${row.schema_version}`,
  );
};

const assertReadableCardOwner = (row: DocumentRow): void => {
  if (row.owner_type === "card" && row.owner_lifecycle !== "deleted") {
    return;
  }

  throw new BlockDocumentStoreError(
    "document_state_corrupt",
    `Document ${row.document_id} is not owned by a readable Card Block`,
  );
};

const assertCardOwnerForInternalMigration = (row: DocumentRow): void => {
  if (row.owner_type === "card") return;
  throw new BlockDocumentStoreError(
    "document_state_corrupt",
    `Document ${row.document_id} is not owned by a Card Block`,
  );
};

const assertWritableCardOwner = (row: DocumentRow): void => {
  if (row.owner_lifecycle === "active") {
    return;
  }

  throw new BlockDocumentStoreError(
    "invalid_document_update",
    `Document ${row.document_id} owner is ${row.owner_lifecycle}`,
  );
};

const validateTouchedBlockIds = (
  touchedBlockIds: readonly BlockId[],
): readonly BlockId[] => {
  if (touchedBlockIds.length > MAX_DOCUMENT_TOUCHED_BLOCK_IDS) {
    throw new BlockDocumentStoreError(
      "invalid_document_update",
      `touchedBlockIds exceeds ${MAX_DOCUMENT_TOUCHED_BLOCK_IDS} entries`,
    );
  }
  const normalized = touchedBlockIds.map((blockId) =>
    requireNonEmpty(blockId, "touchedBlockIds entry"),
  );
  if (normalized.some((blockId) => blockId.length > MAX_BLOCK_ID_LENGTH)) {
    throw new BlockDocumentStoreError(
      "invalid_document_update",
      `Block IDs must not exceed ${MAX_BLOCK_ID_LENGTH} characters`,
    );
  }
  if (new Set(normalized).size === normalized.length) {
    return normalized;
  }

  throw new BlockDocumentStoreError(
    "invalid_document_update",
    "touchedBlockIds must not contain duplicates",
  );
};

type DocumentValidationErrorCode =
  "document_state_corrupt" | "invalid_document_update";

const validationFailure = (
  code: DocumentValidationErrorCode,
  message: string,
  cause?: unknown,
): BlockDocumentStoreError => {
  const detail = cause instanceof Error ? `: ${cause.message}` : "";
  return new BlockDocumentStoreError(code, `${message}${detail}`);
};

const validateCardDocumentContent = (
  document: Y.Doc,
  code: DocumentValidationErrorCode,
): readonly ScannedDocumentBlock[] => {
  try {
    const envelope = assertValidCardDocumentRoots(document);
    if (envelope.body.toString().length > MAX_CARD_DOCUMENT_BODY_XML_LENGTH) {
      throw validationFailure(
        code,
        `Card document body exceeds ${MAX_CARD_DOCUMENT_BODY_XML_LENGTH} XML characters`,
      );
    }
    const blocks = assertValidBlockDocument(envelope.body);
    if (blocks.length > MAX_CARD_DOCUMENT_BLOCKS) {
      throw validationFailure(
        code,
        `Card document exceeds ${MAX_CARD_DOCUMENT_BLOCKS} Blocks`,
      );
    }
    if (
      blocks.some(
        (block) => block.path.length > MAX_CARD_DOCUMENT_XML_PATH_DEPTH,
      )
    ) {
      throw validationFailure(
        code,
        `Card document exceeds XML path depth ${MAX_CARD_DOCUMENT_XML_PATH_DEPTH}`,
      );
    }
    const state = Y.encodeStateAsUpdate(document);
    if (state.byteLength > MAX_CARD_DOCUMENT_STATE_BYTES) {
      throw validationFailure(
        code,
        `Card document state exceeds ${MAX_CARD_DOCUMENT_STATE_BYTES} bytes`,
      );
    }
    return blocks;
  } catch (error) {
    if (error instanceof BlockDocumentStoreError) {
      throw error;
    }
    throw validationFailure(
      code,
      "Card document failed schema validation",
      error,
    );
  }
};

const assertNoPendingDependencies = (
  document: Y.Doc,
  code: "document_state_corrupt" | "document_update_missing_dependencies",
): void => {
  if (
    document.store.pendingStructs === null &&
    document.store.pendingDs === null
  ) {
    return;
  }

  throw new BlockDocumentStoreError(
    code,
    code === "document_state_corrupt"
      ? "Persisted Document contains unresolved Yjs dependencies"
      : "Document update is missing Yjs dependencies and must be retried",
  );
};

const validateRegisteredBlocks = (
  database: Database.Database,
  row: DocumentRow,
  blocks: readonly ScannedDocumentBlock[],
  code: "document_state_corrupt" | "invalid_document_update",
): void => {
  const documentBlockIds = new Set(blocks.map((block) => block.id));
  const activeRegistryRows = database
    .prepare(
      `
      SELECT id
      FROM blocks
      WHERE containing_document_id = ? AND lifecycle = 'active'
    `,
    )
    .all(row.document_id) as readonly { readonly id: string }[];
  const unexpectedRegistryBlock = activeRegistryRows.find(
    (registered) => !documentBlockIds.has(registered.id),
  );
  if (unexpectedRegistryBlock) {
    throw new BlockDocumentStoreError(
      code,
      `Active registry Block ${unexpectedRegistryBlock.id} is absent from Document ${row.document_id}`,
    );
  }
  if (activeRegistryRows.length !== blocks.length) {
    throw new BlockDocumentStoreError(
      code,
      `Document ${row.document_id} Block registry cardinality does not match its body`,
    );
  }

  const readBlock = database.prepare(`
    SELECT project_id, type, lifecycle, location_kind, containing_document_id
    FROM blocks
    WHERE id = ?
  `);
  for (const block of blocks) {
    const registered = readBlock.get(block.id) as
      | {
          project_id: string;
          type: string;
          lifecycle: string;
          location_kind: string;
          containing_document_id: string | null;
        }
      | undefined;
    if (
      registered?.project_id === row.project_id &&
      registered.type === block.blockType &&
      registered.lifecycle === "active" &&
      registered.location_kind === "document" &&
      registered.containing_document_id === row.document_id
    ) {
      continue;
    }

    throw new BlockDocumentStoreError(
      code,
      `Block ${block.id} is not registered in Document ${row.document_id}`,
    );
  }
};

interface RegisteredBlockRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly location_kind: string;
  readonly containing_document_id: string | null;
}

const TYPED_CREATION_BLOCK_TYPES = new Set(["card", "database"]);

const reconcileDocumentBlocks = (
  database: Database.Database,
  row: DocumentRow,
  blocks: readonly ScannedDocumentBlock[],
  projectedSeq: number,
  now: string,
): void => {
  const currentRows = database
    .prepare(
      `
      SELECT id, project_id, type, lifecycle, location_kind, containing_document_id
      FROM blocks
      WHERE containing_document_id = ?
    `,
    )
    .all(row.document_id) as readonly RegisteredBlockRow[];
  const currentById = new Map(currentRows.map((block) => [block.id, block]));
  const readBlock = database.prepare(`
    SELECT id, project_id, type, lifecycle, location_kind, containing_document_id
    FROM blocks
    WHERE id = ?
  `);
  const insertBlock = database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', 'document', ?, 1, 1, ?, ?)
  `);
  const restoreOrRetypeBlock = database.prepare(`
    UPDATE blocks
    SET type = ?, lifecycle = 'active', metadata_revision = metadata_revision + 1,
        updated_at = ?
    WHERE id = ?
  `);
  const tombstoneBlock = database.prepare(`
    UPDATE blocks
    SET lifecycle = 'deleted', metadata_revision = metadata_revision + 1,
        updated_at = ?
    WHERE id = ? AND lifecycle <> 'deleted'
  `);
  const activeIds = new Set<BlockId>();

  for (const block of blocks) {
    activeIds.add(block.id);
    const registered = (currentById.get(block.id) ??
      readBlock.get(block.id)) as RegisteredBlockRow | undefined;
    if (!registered) {
      if (TYPED_CREATION_BLOCK_TYPES.has(block.blockType)) {
        throw new BlockDocumentStoreError(
          "invalid_document_update",
          `${block.blockType} Block ${block.id} requires a typed creation operation`,
        );
      }
      insertBlock.run(
        block.id,
        row.project_id,
        block.blockType,
        row.document_id,
        now,
        now,
      );
      continue;
    }
    if (
      registered.project_id !== row.project_id ||
      registered.location_kind !== "document" ||
      registered.containing_document_id !== row.document_id
    ) {
      throw new BlockDocumentStoreError(
        "invalid_document_update",
        `Block ${block.id} already belongs to another location`,
      );
    }
    if (
      registered.type !== block.blockType &&
      (TYPED_CREATION_BLOCK_TYPES.has(registered.type) ||
        TYPED_CREATION_BLOCK_TYPES.has(block.blockType))
    ) {
      throw new BlockDocumentStoreError(
        "invalid_document_update",
        `Block ${block.id} requires a typed operation to change ${registered.type} into ${block.blockType}`,
      );
    }
    if (
      registered.lifecycle !== "active" ||
      registered.type !== block.blockType
    ) {
      restoreOrRetypeBlock.run(block.blockType, now, block.id);
    }
  }

  for (const registered of currentRows) {
    if (!activeIds.has(registered.id)) {
      tombstoneBlock.run(now, registered.id);
    }
  }

  database
    .prepare("DELETE FROM document_block_index WHERE document_id = ?")
    .run(row.document_id);
  const insertIndex = database.prepare(`
    INSERT INTO document_block_index (
      document_id, block_id, parent_block_id, ordinal, block_type, text, projected_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  blocks.forEach((block, ordinal) => {
    insertIndex.run(
      row.document_id,
      block.id,
      block.parentBlockId,
      ordinal,
      block.blockType,
      block.text,
      projectedSeq,
    );
  });
};

const applyStoredUpdate = (
  document: Y.Doc,
  update: Uint8Array,
  documentId: string,
): void => {
  try {
    Y.applyUpdate(document, update, "sqlite-document-store");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Could not apply persisted state for ${documentId}: ${detail}`,
    );
  }
};

const loadDocumentAtSeq = (
  database: Database.Database,
  row: DocumentRow,
  headSeq: number,
): Y.Doc => {
  if (!Number.isSafeInteger(headSeq) || headSeq < 0 || headSeq > row.head_seq) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Document ${row.document_id} cannot load invalid historical head ${headSeq}`,
    );
  }
  const document = new Y.Doc({ guid: row.document_id });
  try {
    const snapshot = database
      .prepare(
        `
        SELECT snapshot_seq, state_vector, snapshot_update, snapshot_hash, schema_version
        FROM document_snapshots
        WHERE document_id = ? AND generation = ? AND snapshot_seq <= ?
        ORDER BY snapshot_seq DESC
        LIMIT 1
      `,
      )
      .get(row.document_id, row.generation, headSeq) as
      DocumentSnapshotRow | undefined;
    const snapshotSeq = snapshot?.snapshot_seq ?? 0;
    if (snapshot) {
      if (snapshot.schema_version !== row.schema_version) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Document ${row.document_id} snapshot schema does not match its head`,
        );
      }
      if (hashBytes(snapshot.snapshot_update) !== snapshot.snapshot_hash) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Document ${row.document_id} snapshot checksum does not match`,
        );
      }
      applyStoredUpdate(document, snapshot.snapshot_update, row.document_id);
      assertNoPendingDependencies(document, "document_state_corrupt");
      if (!bytesEqual(Y.encodeStateVector(document), snapshot.state_vector)) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Document ${row.document_id} snapshot state vector does not match`,
        );
      }
    }

    const updates = database
      .prepare(
        `
        SELECT seq, update_blob, update_hash
        FROM document_updates
        WHERE document_id = ? AND generation = ? AND seq > ? AND seq <= ?
        ORDER BY seq ASC
      `,
      )
      .all(
        row.document_id,
        row.generation,
        snapshotSeq,
        headSeq,
      ) as readonly DocumentTailUpdateRow[];
    let expectedSeq = snapshotSeq + 1;
    updates.forEach((update) => {
      if (update.seq === expectedSeq) {
        if (hashBytes(update.update_blob) !== update.update_hash) {
          throw new BlockDocumentStoreError(
            "document_state_corrupt",
            `Document ${row.document_id} update ${update.seq} checksum does not match`,
          );
        }
        applyStoredUpdate(document, update.update_blob, row.document_id);
        expectedSeq += 1;
        return;
      }

      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Document ${row.document_id} update tail is missing sequence ${expectedSeq}`,
      );
    });
    if (expectedSeq !== headSeq + 1) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Document ${row.document_id} update tail ends before historical head ${headSeq}`,
      );
    }

    assertNoPendingDependencies(document, "document_state_corrupt");
    validateCardDocumentContent(document, "document_state_corrupt");
    return document;
  } catch (error) {
    document.destroy();
    throw error;
  }
};

const loadDocumentFromRow = (
  database: Database.Database,
  row: DocumentRow,
): Y.Doc => {
  const document = loadDocumentAtSeq(database, row, row.head_seq);
  try {
    const blocks = validateCardDocumentContent(
      document,
      "document_state_corrupt",
    );
    validateRegisteredBlocks(database, row, blocks, "document_state_corrupt");
    const actualStateVector = Y.encodeStateVector(document);
    if (!bytesEqual(actualStateVector, row.state_vector)) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Persisted state vector does not match document head for ${row.document_id}`,
      );
    }
    if (hashBytes(Y.encodeStateAsUpdate(document)) !== row.state_hash) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Persisted state checksum does not match document head for ${row.document_id}`,
      );
    }
    return document;
  } catch (error) {
    document.destroy();
    throw error;
  }
};

const validateIncomingUpdate = (update: Uint8Array): void => {
  if (update.byteLength === 0) {
    throw new BlockDocumentStoreError(
      "invalid_document_update",
      "Yjs update must not be empty",
    );
  }

  if (update.byteLength <= MAX_CARD_DOCUMENT_UPDATE_BYTES) {
    return;
  }

  throw new BlockDocumentStoreError(
    "invalid_document_update",
    `Yjs update exceeds ${MAX_CARD_DOCUMENT_UPDATE_BYTES} bytes`,
  );
};

const findStoredUpdateReceipt = (
  database: Database.Database,
  documentId: DocumentId,
  updateId: string,
): StoredDocumentUpdateReceiptRow | undefined =>
  database
    .prepare(
      `
      SELECT
        generation, seq, client_session_id, base_head_seq,
        client_touched_block_ids_json, derived_touched_block_ids_json,
        derivation_version, update_hash, update_byte_length
      FROM document_update_receipts
      WHERE document_id = ? AND update_id = ?
    `,
    )
    .get(documentId, updateId) as StoredDocumentUpdateReceiptRow | undefined;

const assertMatchingIdempotentUpdate = (
  stored: StoredDocumentUpdateReceiptRow,
  generation: number,
  update: Uint8Array,
  clientSessionId: string,
  baseHeadSeq: number,
  clientTouchedBlockIdsJson: string,
): void => {
  if (
    stored.seq < 1 ||
    stored.derivation_version < 0 ||
    stored.derivation_version > 1 ||
    stored.update_byte_length < 1 ||
    !/^[a-f0-9]{64}$/u.test(stored.update_hash)
  ) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      "The stored document update receipt is invalid",
    );
  }
  const incomingHash = hashBytes(update);
  if (
    stored.generation === generation &&
    stored.client_session_id === clientSessionId &&
    stored.base_head_seq === baseHeadSeq &&
    stored.client_touched_block_ids_json === clientTouchedBlockIdsJson &&
    stored.update_hash === incomingHash &&
    stored.update_byte_length === update.byteLength
  ) {
    return;
  }

  throw new BlockDocumentStoreError(
    "update_id_collision",
    "The updateId is already committed with different request semantics",
  );
};

const insertDocumentUpdateReceipt = (
  database: Database.Database,
  input: {
    readonly documentId: DocumentId;
    readonly generation: number;
    readonly seq: number;
    readonly updateId: string;
    readonly clientSessionId: string;
    readonly baseHeadSeq: number;
    readonly clientTouchedBlockIdsJson: string;
    readonly derivedTouchedBlockIdsJson: string;
    readonly updateHash: string;
    readonly updateByteLength: number;
    readonly committedAt: string;
  },
): void => {
  database
    .prepare(
      `
    INSERT INTO document_update_receipts (
      document_id, generation, seq, update_id, client_session_id,
      base_head_seq, client_touched_block_ids_json,
      derived_touched_block_ids_json, derivation_version,
      update_hash, update_byte_length, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `,
    )
    .run(
      input.documentId,
      input.generation,
      input.seq,
      input.updateId,
      input.clientSessionId,
      input.baseHeadSeq,
      input.clientTouchedBlockIdsJson,
      input.derivedTouchedBlockIdsJson,
      input.updateHash,
      input.updateByteLength,
      input.committedAt,
    );
};

const makeAck = (
  row: DocumentRow,
  storeEpoch: string,
  updateId: string,
  committedSeq: number,
  stateVector: Uint8Array,
  duplicate: boolean,
): DocumentUpdateAck => ({
  documentId: row.document_id,
  storeEpoch,
  generation: row.generation,
  updateId,
  committedSeq,
  headSeq: row.head_seq,
  stateVector: toUint8Array(stateVector),
  duplicate,
});

const RECOVERY_ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const RESERVED_RELOCATION_UPDATE_ID_PREFIX = "relocation:";

const parseStringArray = (
  serialized: string,
  field: string,
): readonly string[] => {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length <= MAX_DOCUMENT_TOUCHED_BLOCK_IDS &&
      parsed.every(
        (value) =>
          typeof value === "string" &&
          value.length > 0 &&
          value.length <= MAX_BLOCK_ID_LENGTH,
      ) &&
      new Set(parsed).size === parsed.length
    ) {
      return parsed;
    }
  } catch {
    // Fall through to one typed persisted-state failure.
  }
  throw new BlockDocumentStoreError(
    "document_state_corrupt",
    `Stored ${field} is invalid`,
  );
};

const readStoredRecoveryArtifact = (
  database: Database.Database,
  input: ApplyDocumentUpdate,
): StoredRecoveryArtifactRow | undefined =>
  database
    .prepare(
      `
    SELECT
      id, store_epoch, client_session_id, base_head_seq,
      touched_block_ids_json, derived_touched_block_ids_json,
      update_blob, update_hash, update_byte_length, reason,
      relocation_ids_json
    FROM document_recovery_artifacts
    WHERE document_id = ? AND generation = ? AND update_id = ?
  `,
    )
    .get(input.documentId, input.generation, input.updateId) as
    StoredRecoveryArtifactRow | undefined;

const recoveryOutcomeFromStoredArtifact = (
  stored: StoredRecoveryArtifactRow,
  input: ApplyDocumentUpdate,
  clientTouchedBlockIdsJson: string,
): RecoveryArtifactOutcome => {
  if (
    stored.update_blob.byteLength !== stored.update_byte_length ||
    hashBytes(stored.update_blob) !== stored.update_hash
  ) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      `Recovery artifact ${stored.id} checksum does not match`,
    );
  }
  const updateHash = hashBytes(input.update);
  if (
    stored.store_epoch !== input.storeEpoch ||
    stored.client_session_id !== input.clientSessionId ||
    stored.base_head_seq !== input.baseHeadSeq ||
    stored.touched_block_ids_json !== clientTouchedBlockIdsJson ||
    stored.update_hash !== updateHash ||
    stored.update_byte_length !== input.update.byteLength ||
    !bytesEqual(stored.update_blob, input.update)
  ) {
    throw new BlockDocumentStoreError(
      "update_id_collision",
      "The updateId already belongs to a different recovery artifact request",
    );
  }

  const relocationIds = parseStringArray(
    stored.relocation_ids_json,
    "recovery artifact relocation IDs",
  );
  if (stored.derived_touched_block_ids_json !== null) {
    parseStringArray(
      stored.derived_touched_block_ids_json,
      "recovery artifact derived touched Block IDs",
    );
  }
  return {
    kind: "recovery",
    code:
      stored.reason === "block_relocated"
        ? "block_relocated"
        : "recovery_required",
    artifactId: stored.id,
    ...(relocationIds[0] ? { relocationId: relocationIds[0] } : {}),
  };
};

const readCrossedRelocations = (
  database: Database.Database,
  row: DocumentRow,
  baseHeadSeq: number,
  storeEpoch: string,
): readonly CrossedRelocationRow[] =>
  database
    .prepare(
      `
    SELECT
      relocation.id AS relocation_id,
      relocation.source_committed_seq,
      source_state.pre_state_vector,
      source_state.pre_full_update,
      source_state.pre_full_update_byte_length,
      source_state.pre_state_hash
    FROM block_relocations relocation
    LEFT JOIN block_relocation_source_states source_state
      ON source_state.relocation_id = relocation.id
    WHERE relocation.source_document_id = ?
      AND relocation.project_id = ?
      AND relocation.store_epoch = ?
      AND relocation.source_generation = ?
      AND relocation.source_committed_seq > ?
      AND relocation.source_committed_seq <= ?
    ORDER BY relocation.source_committed_seq ASC, relocation.id ASC
  `,
    )
    .all(
      row.document_id,
      row.project_id,
      storeEpoch,
      row.generation,
      baseHeadSeq,
      row.head_seq,
    ) as readonly CrossedRelocationRow[];

const readCrossedRelocationMembers = (
  database: Database.Database,
  row: DocumentRow,
  baseHeadSeq: number,
  storeEpoch: string,
): readonly CrossedRelocationMemberRow[] =>
  database
    .prepare(
      `
    SELECT member.relocation_id, member.block_id
    FROM block_relocations relocation
    INNER JOIN block_relocation_members member
      ON member.relocation_id = relocation.id
    WHERE relocation.source_document_id = ?
      AND relocation.project_id = ?
      AND relocation.store_epoch = ?
      AND relocation.source_generation = ?
      AND relocation.source_committed_seq > ?
      AND relocation.source_committed_seq <= ?
    ORDER BY relocation.source_committed_seq ASC,
      relocation.id ASC, member.tree_ordinal ASC
  `,
    )
    .all(
      row.document_id,
      row.project_id,
      storeEpoch,
      row.generation,
      baseHeadSeq,
      row.head_seq,
    ) as readonly CrossedRelocationMemberRow[];

const readCrossedDocumentMutationBarriers = (
  database: Database.Database,
  row: DocumentRow,
  baseHeadSeq: number,
  storeEpoch: string,
): readonly CrossedDocumentMutationBarrier[] => {
  const stored = database
    .prepare(
      `
      SELECT mutation_id, result_json
      FROM block_mutations
      WHERE outcome = 'committed'
        AND project_id = ?
        AND store_epoch = ?
        AND mutation_kind IN (
          'document_operation_batch',
          'replace_document_from_nfm'
        )
        AND json_extract(result_json, '$.documentId') = ?
        AND json_extract(result_json, '$.generation') = ?
        AND json_extract(result_json, '$.headSeq') > ?
        AND json_extract(result_json, '$.headSeq') <= ?
        AND json_extract(result_json, '$.coordination') = 'write_fence'
      ORDER BY json_extract(result_json, '$.headSeq') ASC, mutation_id ASC
    `,
    )
    .all(
      row.project_id,
      storeEpoch,
      row.document_id,
      row.generation,
      baseHeadSeq,
      row.head_seq,
    ) as readonly CrossedDocumentMutationRow[];

  return stored.map((entry) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.result_json);
    } catch {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Document mutation ${entry.mutation_id} has invalid barrier evidence`,
      );
    }
    try {
      const result = parseDocumentOperationResult(parsed);
      if (
        result.mutationId !== entry.mutation_id ||
        result.projectId !== row.project_id ||
        result.storeEpoch !== storeEpoch ||
        result.documentId !== row.document_id ||
        result.generation !== row.generation ||
        result.headSeq <= baseHeadSeq ||
        result.headSeq > row.head_seq ||
        result.coordination !== "write_fence"
      ) {
        throw new DocumentOperationContractError(
          "Document mutation barrier diverges from its ledger identity",
        );
      }
      return {
        mutationId: result.mutationId,
        committedSeq: result.headSeq,
        writeFenceBlockIds: result.writeFenceBlockIds,
      };
    } catch (error) {
      if (!(error instanceof DocumentOperationContractError)) throw error;
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Document mutation ${entry.mutation_id} has invalid barrier evidence`,
      );
    }
  });
};

const inspectStaleUpdateAcrossStructuralBarriers = (
  database: Database.Database,
  row: DocumentRow,
  input: ApplyDocumentUpdate,
  clientTouchedBlockIds: readonly BlockId[],
): StaleStructuralInspection | null => {
  const currentStoreEpoch = readStoreEpoch(database);
  if (currentStoreEpoch !== input.storeEpoch) {
    throw new BlockDocumentStoreError(
      "store_epoch_mismatch",
      "Document update store epoch changed during structural barrier inspection",
    );
  }
  const crossed = readCrossedRelocations(
    database,
    row,
    input.baseHeadSeq,
    currentStoreEpoch,
  );
  const mutationBarriers = readCrossedDocumentMutationBarriers(
    database,
    row,
    input.baseHeadSeq,
    currentStoreEpoch,
  );
  if (crossed.length === 0 && mutationBarriers.length === 0) return null;
  const relocationIds = crossed.map((relocation) => relocation.relocation_id);
  const members = readCrossedRelocationMembers(
    database,
    row,
    input.baseHeadSeq,
    currentStoreEpoch,
  );
  const movedBlockIds = new Set(members.map((member) => member.block_id));
  const mutationFenceBlockIds = new Set(
    mutationBarriers.flatMap((barrier) => barrier.writeFenceBlockIds),
  );
  const declaredMovedBlockId = clientTouchedBlockIds.find((blockId) =>
    movedBlockIds.has(blockId),
  );
  if (declaredMovedBlockId) {
    const relocationId = members.find(
      (member) => member.block_id === declaredMovedBlockId,
    )?.relocation_id;
    return {
      relocationIds,
      derivedTouchedBlockIds: null,
      rejectionReason: "block_relocated",
      ...(relocationId ? { rejectedRelocationId: relocationId } : {}),
    };
  }
  if (
    clientTouchedBlockIds.some((blockId) => mutationFenceBlockIds.has(blockId))
  ) {
    return {
      relocationIds,
      derivedTouchedBlockIds: null,
      rejectionReason: "unsafe_stale_update",
    };
  }

  const earliestRelocation = crossed[0];
  const earliestMutation = mutationBarriers[0];
  let preBarrierDocument: Y.Doc;
  if (
    earliestRelocation &&
    (!earliestMutation ||
      earliestRelocation.source_committed_seq <= earliestMutation.committedSeq)
  ) {
    if (
      earliestRelocation.pre_state_vector === null ||
      earliestRelocation.pre_full_update === null ||
      earliestRelocation.pre_full_update_byte_length === null ||
      earliestRelocation.pre_state_hash === null
    ) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Relocation ${earliestRelocation.relocation_id} has no recoverable source state`,
      );
    }
    if (
      earliestRelocation.pre_full_update.byteLength !==
        earliestRelocation.pre_full_update_byte_length ||
      hashBytes(earliestRelocation.pre_full_update) !==
        earliestRelocation.pre_state_hash
    ) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Relocation ${earliestRelocation.relocation_id} source state checksum does not match`,
      );
    }
    preBarrierDocument = new Y.Doc({ guid: row.document_id });
    try {
      applyStoredUpdate(
        preBarrierDocument,
        earliestRelocation.pre_full_update,
        row.document_id,
      );
      assertNoPendingDependencies(preBarrierDocument, "document_state_corrupt");
      validateCardDocumentContent(preBarrierDocument, "document_state_corrupt");
      if (
        !bytesEqual(
          Y.encodeStateVector(preBarrierDocument),
          earliestRelocation.pre_state_vector,
        )
      ) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Relocation ${earliestRelocation.relocation_id} source state vector does not match`,
        );
      }
    } catch (error) {
      preBarrierDocument.destroy();
      throw error;
    }
  } else if (earliestMutation) {
    try {
      preBarrierDocument = loadDocumentAtSeq(
        database,
        row,
        earliestMutation.committedSeq - 1,
      );
    } catch {
      // Historical tails may have been compacted. A recovery artifact is safer
      // than applying an update whose pre-barrier effect cannot be proven.
      return {
        relocationIds,
        derivedTouchedBlockIds: null,
        rejectionReason: "unsafe_stale_update",
      };
    }
  } else {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      "Structural barrier inspection has no earliest durable barrier",
    );
  }

  try {
    const before = captureBlockDocumentChangeState(preBarrierDocument);
    let derivedTouchedBlockIds: readonly BlockId[] | null = null;
    try {
      Y.applyUpdate(
        preBarrierDocument,
        input.update,
        "stale-structural-barrier-recovery-probe",
      );
      assertNoPendingDependencies(
        preBarrierDocument,
        "document_update_missing_dependencies",
      );
      validateCardDocumentContent(
        preBarrierDocument,
        "invalid_document_update",
      );
      derivedTouchedBlockIds = deriveBlockDocumentTouchedIds({
        ownerBlockId: row.owner_block_id,
        before,
        after: captureBlockDocumentChangeState(preBarrierDocument),
      });
    } catch {
      return {
        relocationIds,
        derivedTouchedBlockIds: null,
        rejectionReason: "unsafe_stale_update",
      };
    }

    if (derivedTouchedBlockIds.length === 0) {
      return {
        relocationIds,
        derivedTouchedBlockIds,
        rejectionReason: "unsafe_stale_update",
      };
    }
    const derivedMovedBlockId = derivedTouchedBlockIds.find((blockId) =>
      movedBlockIds.has(blockId),
    );
    if (derivedMovedBlockId) {
      const relocationId = members.find(
        (member) => member.block_id === derivedMovedBlockId,
      )?.relocation_id;
      return {
        relocationIds,
        derivedTouchedBlockIds,
        rejectionReason: "block_relocated",
        ...(relocationId ? { rejectedRelocationId: relocationId } : {}),
      };
    }
    if (
      derivedTouchedBlockIds.some((blockId) =>
        mutationFenceBlockIds.has(blockId),
      )
    ) {
      return {
        relocationIds,
        derivedTouchedBlockIds,
        rejectionReason: "unsafe_stale_update",
      };
    }
    return {
      relocationIds,
      derivedTouchedBlockIds,
      rejectionReason: null,
    };
  } finally {
    preBarrierDocument.destroy();
  }
};

const persistRecoveryArtifact = (
  database: Database.Database,
  row: DocumentRow,
  input: ApplyDocumentUpdate,
  clientTouchedBlockIdsJson: string,
  inspection: StaleStructuralInspection,
  reason: RecoveryArtifactReason,
): RecoveryArtifactOutcome => {
  const updateHash = hashBytes(input.update);
  const artifactId = `document-recovery:${createHash("sha256")
    .update(input.documentId)
    .update("\0")
    .update(String(input.generation))
    .update("\0")
    .update(input.updateId)
    .digest("hex")}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.parse(createdAt) + RECOVERY_ARTIFACT_RETENTION_MS,
  ).toISOString();
  const derivedTouchedBlockIdsJson =
    inspection.derivedTouchedBlockIds === null
      ? null
      : JSON.stringify(inspection.derivedTouchedBlockIds);
  database
    .prepare(
      `
    INSERT INTO document_recovery_artifacts (
      id, project_id, store_epoch, document_id, generation, update_id,
      client_session_id, base_head_seq, touched_block_ids_json,
      derived_touched_block_ids_json, update_blob, update_hash,
      update_byte_length, reason, relocation_ids_json, status,
      created_at, expires_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
  `,
    )
    .run(
      artifactId,
      row.project_id,
      input.storeEpoch,
      input.documentId,
      input.generation,
      input.updateId,
      input.clientSessionId,
      input.baseHeadSeq,
      clientTouchedBlockIdsJson,
      derivedTouchedBlockIdsJson,
      Buffer.from(input.update),
      updateHash,
      input.update.byteLength,
      reason,
      JSON.stringify(inspection.relocationIds),
      createdAt,
      expiresAt,
    );
  return {
    kind: "recovery",
    code:
      reason === "block_relocated" ? "block_relocated" : "recovery_required",
    artifactId,
    ...(inspection.rejectedRelocationId
      ? { relocationId: inspection.rejectedRelocationId }
      : inspection.relocationIds[0]
        ? { relocationId: inspection.relocationIds[0] }
        : {}),
  };
};

const throwRecoveryOutcome = (outcome: RecoveryArtifactOutcome): never => {
  const message =
    outcome.code === "block_relocated"
      ? "The update touches content that has moved to another Document"
      : "The stale update could not be applied safely and requires explicit recovery";
  throw new BlockDocumentStoreError(outcome.code, message, {
    relocationId: outcome.relocationId,
    recoveryArtifactId: outcome.artifactId,
  });
};

export const loadBlockDocument = (
  database: Database.Database,
  documentId: DocumentId,
): LoadedBlockDocument => {
  const load = database.transaction((): LoadedBlockDocument => {
    const storeEpoch = readStoreEpoch(database);
    const row = readDocumentRow(database, documentId);
    assertReady(row);
    assertSupportedCardSchema(row);
    assertReadableCardOwner(row);

    return {
      storeEpoch,
      authority: row.authority,
      head: toDocumentHead(row),
      document: loadDocumentFromRow(database, row),
    };
  });
  return load();
};

const loadBlockDocumentWithAuthority = (
  database: Database.Database,
  documentId: DocumentId,
  authority: DocumentAuthority,
): LoadedBlockDocument => {
  const loaded = loadBlockDocument(database, documentId);
  if (loaded.authority === authority) return loaded;
  loaded.document.destroy();
  throw new BlockDocumentStoreError(
    "document_authority_mismatch",
    `Document ${documentId} has ${loaded.authority} authority; expected ${authority}`,
  );
};

export const loadPrimaryBlockDocument = (
  database: Database.Database,
  documentId: DocumentId,
): LoadedBlockDocument =>
  loadBlockDocumentWithAuthority(database, documentId, "ydoc_primary");

export const loadLegacyShadowBlockDocument = (
  database: Database.Database,
  documentId: DocumentId,
): LoadedBlockDocument =>
  loadBlockDocumentWithAuthority(database, documentId, "legacy_shadow");

/** Internal BF-05 migration read; deleted hosts remain restorable tombstones. */
export const loadLegacyShadowBlockDocumentForMigration = (
  database: Database.Database,
  documentId: DocumentId,
): LoadedBlockDocument => {
  const load = database.transaction((): LoadedBlockDocument => {
    const storeEpoch = readStoreEpoch(database);
    const row = readDocumentRow(database, documentId);
    assertReady(row);
    assertSupportedCardSchema(row);
    assertCardOwnerForInternalMigration(row);
    assertDocumentAuthority(row, "legacy_shadow");
    return {
      storeEpoch,
      authority: row.authority,
      head: toDocumentHead(row),
      document: loadDocumentFromRow(database, row),
    };
  });
  return load();
};

export const getBlockDocumentProjectId = (
  database: Database.Database,
  documentId: DocumentId,
): string => {
  requireNonEmpty(documentId, "documentId");
  return readDocumentRow(database, documentId).project_id;
};

export const getBlockDocumentRuntimeIdentity = (
  database: Database.Database,
  documentId: DocumentId,
): BlockDocumentRuntimeIdentity => {
  requireNonEmpty(documentId, "documentId");
  const read = database.transaction((): BlockDocumentRuntimeIdentity => {
    const storeEpoch = readStoreEpoch(database);
    const row = readDocumentRow(database, documentId);
    assertReady(row);
    assertDocumentAuthority(row, "ydoc_primary");
    assertSupportedCardSchema(row);
    assertReadableCardOwner(row);
    return {
      storeEpoch,
      authority: row.authority,
      head: toDocumentHead(row),
      stateHash: row.state_hash,
    };
  });
  return read();
};

export const getBlockDocumentSyncStep = (
  database: Database.Database,
  documentId: DocumentId,
  clientStateVector: Uint8Array,
): DocumentSyncStep => {
  const loaded = loadPrimaryBlockDocument(database, documentId);
  try {
    let update: Uint8Array;
    try {
      update = Y.encodeStateAsUpdate(loaded.document, clientStateVector);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BlockDocumentStoreError(
        "invalid_document_update",
        `Client state vector is invalid: ${detail}`,
      );
    }
    return {
      storeEpoch: loaded.storeEpoch,
      head: loaded.head,
      update,
    };
  } finally {
    loaded.document.destroy();
  }
};

export const syncBlockDocument = (
  database: Database.Database,
  input: DocumentSyncRequest,
): DocumentSyncResponse => {
  requireNonEmpty(input.documentId, "documentId");
  requireNonEmpty(input.clientSessionId, "clientSessionId");
  if (input.stateVector.byteLength > MAX_CARD_DOCUMENT_STATE_BYTES) {
    throw new BlockDocumentStoreError(
      "invalid_document_update",
      `Client state vector exceeds ${MAX_CARD_DOCUMENT_STATE_BYTES} bytes`,
    );
  }
  const step = getBlockDocumentSyncStep(
    database,
    input.documentId,
    input.stateVector,
  );
  return {
    documentId: step.head.documentId,
    storeEpoch: step.storeEpoch,
    generation: step.head.generation,
    headSeq: step.head.headSeq,
    stateVector: step.head.stateVector,
    update: step.update,
  };
};

export const initializeCardDocumentGenesis = (
  database: Database.Database,
  input: InitializeCardDocumentGenesis,
): DocumentUpdateAck => {
  validateIncomingUpdate(input.update);
  requireNonEmpty(input.documentId, "documentId");
  requireNonEmpty(input.updateId, "updateId");
  requireNonEmpty(input.clientSessionId, "clientSessionId");

  const genesisDocument = new Y.Doc({ guid: input.documentId });
  let genesisBlocks: readonly ScannedDocumentBlock[];
  let genesisTitle: string;
  let genesisStateVector: Uint8Array;
  let genesisSnapshot: Uint8Array;
  let genesisMaterialization: CardDocumentMaterialization;
  try {
    try {
      Y.applyUpdate(genesisDocument, input.update, "document-genesis");
      assertNoPendingDependencies(
        genesisDocument,
        "document_update_missing_dependencies",
      );
      genesisBlocks = validateCardDocumentContent(
        genesisDocument,
        "invalid_document_update",
      );
      genesisTitle =
        assertValidCardDocumentRoots(genesisDocument).title.toString();
    } catch (error) {
      if (error instanceof BlockDocumentStoreError) {
        throw error;
      }
      throw validationFailure(
        "invalid_document_update",
        "Card document genesis could not be applied",
        error,
      );
    }
    genesisStateVector = Y.encodeStateVector(genesisDocument);
    genesisSnapshot = Y.encodeStateAsUpdate(genesisDocument);
    genesisMaterialization = materializeCardDocument(genesisDocument);
  } finally {
    genesisDocument.destroy();
  }

  const clientTouchedBlockIdsJson = "[]";
  const updateHash = hashBytes(input.update);
  const snapshotHash = hashBytes(genesisSnapshot);
  const stateHash = snapshotHash;

  const initialize = database.transaction((): DocumentUpdateAck => {
    const storeEpoch = assertStoreEpoch(database, input.storeEpoch);
    const row = readDocumentRow(database, input.documentId);
    assertGeneration(row, input.generation);
    assertSupportedCardSchema(row);
    assertReadableCardOwner(row);
    assertDocumentAuthority(row, "legacy_shadow");

    const stored = findStoredUpdateReceipt(
      database,
      input.documentId,
      input.updateId,
    );
    if (stored) {
      assertMatchingIdempotentUpdate(
        stored,
        input.generation,
        input.update,
        input.clientSessionId,
        0,
        clientTouchedBlockIdsJson,
      );
      const currentRow = readDocumentRow(database, input.documentId);
      return makeAck(
        currentRow,
        storeEpoch,
        input.updateId,
        stored.seq,
        currentRow.state_vector,
        true,
      );
    }

    if (row.readiness !== "pending_genesis" || row.head_seq !== 0) {
      throw new BlockDocumentStoreError(
        "document_already_initialized",
        `Document ${input.documentId} already has durable content`,
      );
    }

    const now = new Date().toISOString();
    const derivedTouchedBlockIdsJson = JSON.stringify(
      [
        ...(genesisTitle.length > 0 ? [row.owner_block_id] : []),
        ...genesisBlocks.map((block) => block.id),
      ].sort((left, right) => left.localeCompare(right)),
    );
    reconcileDocumentBlocks(database, row, genesisBlocks, 1, now);
    persistCardDocumentMaterialization(database, {
      documentId: input.documentId,
      generation: input.generation,
      projectedSeq: 1,
      materialization: genesisMaterialization,
      updatedAt: now,
    });
    insertDocumentUpdateReceipt(database, {
      documentId: input.documentId,
      generation: input.generation,
      seq: 1,
      updateId: input.updateId,
      clientSessionId: input.clientSessionId,
      baseHeadSeq: 0,
      clientTouchedBlockIdsJson,
      derivedTouchedBlockIdsJson,
      updateHash,
      updateByteLength: input.update.byteLength,
      committedAt: now,
    });
    database
      .prepare(
        `
      INSERT INTO document_updates (
        document_id, generation, seq, update_id, client_session_id,
        base_head_seq, touched_block_ids_json, update_blob, update_hash, committed_at
      ) VALUES (?, ?, 1, ?, ?, 0, ?, ?, ?, ?)
    `,
      )
      .run(
        input.documentId,
        input.generation,
        input.updateId,
        input.clientSessionId,
        derivedTouchedBlockIdsJson,
        Buffer.from(input.update),
        updateHash,
        now,
      );
    database
      .prepare(
        `
      INSERT INTO document_snapshots (
        document_id, generation, snapshot_seq, state_vector,
        snapshot_update, snapshot_hash, schema_version, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.documentId,
        input.generation,
        Buffer.from(genesisStateVector),
        Buffer.from(genesisSnapshot),
        snapshotHash,
        row.schema_version,
        now,
      );
    database
      .prepare(
        `
      UPDATE documents
      SET head_seq = 1, state_vector = ?, state_hash = ?,
          readiness = 'ready', updated_at = ?
      WHERE id = ? AND generation = ? AND head_seq = 0 AND readiness = 'pending_genesis'
    `,
      )
      .run(
        Buffer.from(genesisStateVector),
        stateHash,
        now,
        input.documentId,
        input.generation,
      );
    replaceDocumentSecondaryProjections(database, {
      documentId: input.documentId,
      expectedGeneration: input.generation,
      expectedProjectedSeq: 1,
    });

    return makeAck(
      {
        ...row,
        head_seq: 1,
        state_vector: Buffer.from(genesisStateVector),
        state_hash: stateHash,
        readiness: "ready",
      },
      storeEpoch,
      input.updateId,
      1,
      genesisStateVector,
      false,
    );
  });

  return initialize.immediate();
};

const applyBlockDocumentUpdateForAuthority = (
  database: Database.Database,
  input: ApplyDocumentUpdate,
  authority: DocumentAuthority,
  allowInactiveOwner: boolean,
  allowReservedUpdateId: boolean,
  strictCommitPolicy?: StrictDocumentUpdateCommitPolicy,
): DocumentUpdateAck => {
  validateIncomingUpdate(input.update);
  requireNonEmpty(input.documentId, "documentId");
  requireNonEmpty(input.updateId, "updateId");
  requireNonEmpty(input.clientSessionId, "clientSessionId");
  if (
    !allowReservedUpdateId &&
    input.updateId.startsWith(RESERVED_RELOCATION_UPDATE_ID_PREFIX)
  ) {
    throw new BlockDocumentStoreError(
      "invalid_document_update",
      `updateId namespace ${RESERVED_RELOCATION_UPDATE_ID_PREFIX} is reserved for system relocations`,
    );
  }
  const clientTouchedBlockIds = validateTouchedBlockIds(input.touchedBlockIds);
  const clientTouchedBlockIdsJson = JSON.stringify(clientTouchedBlockIds);

  const apply = database.transaction((): ApplyBlockDocumentUpdateOutcome => {
    const storeEpoch = assertStoreEpoch(database, input.storeEpoch);
    const row = readDocumentRow(database, input.documentId);
    assertReady(row);
    assertGeneration(row, input.generation);
    assertSupportedCardSchema(row);
    if (allowInactiveOwner) {
      assertCardOwnerForInternalMigration(row);
    } else {
      assertReadableCardOwner(row);
    }
    assertDocumentAuthority(row, authority);
    const committedSeq = strictCommitPolicy?.readCommittedSeq(database) ?? null;
    if (committedSeq !== null) {
      if (
        !Number.isSafeInteger(committedSeq) ||
        committedSeq < 1 ||
        committedSeq > row.head_seq
      ) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          "The strict Document mutation receipt has an invalid committed sequence",
        );
      }
      return {
        kind: "ack",
        ack: makeAck(
          row,
          storeEpoch,
          input.updateId,
          committedSeq,
          row.state_vector,
          true,
        ),
      };
    }
    strictCommitPolicy?.assertCurrentHead(row.head_seq);
    if (input.baseHeadSeq > row.head_seq) {
      throw new BlockDocumentStoreError(
        "future_base_head",
        `Document ${input.documentId} is at head ${row.head_seq}, received base ${input.baseHeadSeq}`,
      );
    }

    const stored = findStoredUpdateReceipt(
      database,
      input.documentId,
      input.updateId,
    );
    if (stored) {
      assertMatchingIdempotentUpdate(
        stored,
        input.generation,
        input.update,
        input.clientSessionId,
        input.baseHeadSeq,
        clientTouchedBlockIdsJson,
      );
      return {
        kind: "ack",
        ack: makeAck(
          row,
          storeEpoch,
          input.updateId,
          stored.seq,
          row.state_vector,
          true,
        ),
      };
    }

    const storedRecoveryArtifact = readStoredRecoveryArtifact(database, input);
    if (storedRecoveryArtifact) {
      return recoveryOutcomeFromStoredArtifact(
        storedRecoveryArtifact,
        input,
        clientTouchedBlockIdsJson,
      );
    }

    if (!allowInactiveOwner) {
      assertWritableCardOwner(row);
    }

    const staleStructuralInspection =
      inspectStaleUpdateAcrossStructuralBarriers(
        database,
        row,
        input,
        clientTouchedBlockIds,
      );
    if (staleStructuralInspection?.rejectionReason) {
      return persistRecoveryArtifact(
        database,
        row,
        input,
        clientTouchedBlockIdsJson,
        staleStructuralInspection,
        staleStructuralInspection.rejectionReason,
      );
    }

    const document = loadDocumentFromRow(database, row);
    try {
      const beforeChangeState = captureBlockDocumentChangeState(document);
      let blocks: readonly ScannedDocumentBlock[];
      let derivedTouchedBlockIds: readonly BlockId[];
      let materialization: CardDocumentMaterialization;
      try {
        Y.applyUpdate(document, input.update, "remote-document-update");
        assertNoPendingDependencies(
          document,
          "document_update_missing_dependencies",
        );
        blocks = validateCardDocumentContent(
          document,
          "invalid_document_update",
        );
        derivedTouchedBlockIds = deriveBlockDocumentTouchedIds({
          ownerBlockId: row.owner_block_id,
          before: beforeChangeState,
          after: captureBlockDocumentChangeState(document),
        });
        if (staleStructuralInspection) {
          const currentTouchedBlockIds = new Set(derivedTouchedBlockIds);
          const structurallyVisible =
            staleStructuralInspection.derivedTouchedBlockIds !== null &&
            staleStructuralInspection.derivedTouchedBlockIds.every((blockId) =>
              currentTouchedBlockIds.has(blockId),
            );
          if (!structurallyVisible) {
            return persistRecoveryArtifact(
              database,
              row,
              input,
              clientTouchedBlockIdsJson,
              staleStructuralInspection,
              "unsafe_stale_update",
            );
          }
        }
        materialization = materializeCardDocument(document);
        if (
          authority === "ydoc_primary" &&
          materialization.references.some(isLegacyForeignBodyReference)
        ) {
          throw new BlockDocumentStoreError(
            "invalid_document_update",
            "Primary Card Documents cannot contain legacy foreign-body projections",
          );
        }
      } catch (error) {
        if (error instanceof BlockDocumentStoreError) {
          throw error;
        }
        throw validationFailure(
          "invalid_document_update",
          "Document update failed validation",
          error,
        );
      }

      const nextHeadSeq = row.head_seq + 1;
      const nextStateVector = Y.encodeStateVector(document);
      const nextStateHash = hashBytes(Y.encodeStateAsUpdate(document));
      if (
        bytesEqual(nextStateVector, row.state_vector) &&
        nextStateHash === row.state_hash
      ) {
        throw new BlockDocumentStoreError(
          "invalid_document_update",
          "Document update does not add any new causal or delete state",
        );
      }
      const now = new Date().toISOString();
      const derivedTouchedBlockIdsJson = JSON.stringify(derivedTouchedBlockIds);
      reconcileDocumentBlocks(database, row, blocks, nextHeadSeq, now);
      persistCardDocumentMaterialization(database, {
        documentId: input.documentId,
        generation: input.generation,
        projectedSeq: nextHeadSeq,
        materialization,
        updatedAt: now,
      });
      const updateHash = hashBytes(input.update);
      insertDocumentUpdateReceipt(database, {
        documentId: input.documentId,
        generation: input.generation,
        seq: nextHeadSeq,
        updateId: input.updateId,
        clientSessionId: input.clientSessionId,
        baseHeadSeq: input.baseHeadSeq,
        clientTouchedBlockIdsJson,
        derivedTouchedBlockIdsJson,
        updateHash,
        updateByteLength: input.update.byteLength,
        committedAt: now,
      });
      database
        .prepare(
          `
        INSERT INTO document_updates (
          document_id, generation, seq, update_id, client_session_id,
          base_head_seq, touched_block_ids_json, update_blob, update_hash, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          input.documentId,
          input.generation,
          nextHeadSeq,
          input.updateId,
          input.clientSessionId,
          input.baseHeadSeq,
          derivedTouchedBlockIdsJson,
          Buffer.from(input.update),
          updateHash,
          now,
        );
      database
        .prepare(
          `
        UPDATE documents
        SET head_seq = ?, state_vector = ?, state_hash = ?, updated_at = ?
        WHERE id = ? AND generation = ? AND head_seq = ?
      `,
        )
        .run(
          nextHeadSeq,
          Buffer.from(nextStateVector),
          nextStateHash,
          now,
          input.documentId,
          input.generation,
          row.head_seq,
        );
      replaceDocumentSecondaryProjections(database, {
        documentId: input.documentId,
        expectedGeneration: input.generation,
        expectedProjectedSeq: nextHeadSeq,
      });
      strictCommitPolicy?.persistCommit(database, {
        projectId: row.project_id,
        ownerBlockId: row.owner_block_id,
        documentId: input.documentId,
        storeEpoch,
        generation: input.generation,
        baseHeadSeq: input.baseHeadSeq,
        headSeq: nextHeadSeq,
        updateId: input.updateId,
        derivedTouchedBlockIds,
        committedAt: now,
      });

      return {
        kind: "ack",
        ack: makeAck(
          {
            ...row,
            head_seq: nextHeadSeq,
            state_vector: Buffer.from(nextStateVector),
            state_hash: nextStateHash,
          },
          storeEpoch,
          input.updateId,
          nextHeadSeq,
          nextStateVector,
          false,
        ),
      };
    } finally {
      document.destroy();
    }
  });

  const outcome = apply.immediate();
  if (outcome.kind === "ack") return outcome.ack;
  return throwRecoveryOutcome(outcome);
};

/** Renderer/provider writes are legal only after the one-way Card cutover. */
export const applyBlockDocumentUpdate = (
  database: Database.Database,
  input: ApplyDocumentUpdate,
): DocumentUpdateAck =>
  applyBlockDocumentUpdateForAuthority(
    database,
    input,
    "ydoc_primary",
    false,
    false,
  );

/**
 * Internal writer seam for CAS-bound Agent/CLI operations. The policy shares
 * the exact SQLite transaction with the Y.Doc update and projection writes.
 */
export const applyStrictBlockDocumentUpdate = (
  database: Database.Database,
  input: ApplyDocumentUpdate,
  policy: StrictDocumentUpdateCommitPolicy,
): DocumentUpdateAck =>
  applyBlockDocumentUpdateForAuthority(
    database,
    input,
    "ydoc_primary",
    false,
    false,
    policy,
  );

/** Internal one-way migration adapter; never expose through IPC or HTTP. */
export const applyLegacyShadowDocumentUpdate = (
  database: Database.Database,
  input: ApplyDocumentUpdate,
): DocumentUpdateAck =>
  applyBlockDocumentUpdateForAuthority(
    database,
    input,
    "legacy_shadow",
    true,
    true,
  );

export const compactBlockDocument = (
  database: Database.Database,
  input: CompactBlockDocumentInput,
): CompactBlockDocumentResult => {
  requireNonEmpty(input.documentId, "documentId");

  const compact = database.transaction((): CompactBlockDocumentResult => {
    const row = readDocumentRow(database, input.documentId);
    assertReady(row);
    assertSupportedCardSchema(row);
    assertReadableCardOwner(row);
    if (
      input.expectedGeneration !== undefined &&
      input.expectedGeneration !== row.generation
    ) {
      throw new BlockDocumentStoreError(
        "document_generation_mismatch",
        `Document ${row.document_id} generation is ${row.generation}, expected ${input.expectedGeneration}`,
      );
    }
    if (
      input.expectedHeadSeq !== undefined &&
      input.expectedHeadSeq !== row.head_seq
    ) {
      throw new BlockDocumentStoreError(
        "invalid_document_update",
        `Document ${row.document_id} head is ${row.head_seq}, expected ${input.expectedHeadSeq}`,
      );
    }

    const document = loadDocumentFromRow(database, row);
    try {
      const snapshotUpdate = Y.encodeStateAsUpdate(document);
      const stateVector = Y.encodeStateVector(document);
      const snapshotHash = hashBytes(snapshotUpdate);
      if (
        !bytesEqual(stateVector, row.state_vector) ||
        snapshotHash !== row.state_hash
      ) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Document ${row.document_id} changed while preparing compaction`,
        );
      }

      const now = new Date().toISOString();
      database
        .prepare(
          `
        INSERT INTO document_snapshots (
          document_id, generation, snapshot_seq, state_vector,
          snapshot_update, snapshot_hash, schema_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id, generation, snapshot_seq) DO NOTHING
      `,
        )
        .run(
          row.document_id,
          row.generation,
          row.head_seq,
          Buffer.from(stateVector),
          Buffer.from(snapshotUpdate),
          snapshotHash,
          row.schema_version,
          now,
        );

      const storedSnapshot = database
        .prepare(
          `
        SELECT snapshot_seq, state_vector, snapshot_update, snapshot_hash, schema_version
        FROM document_snapshots
        WHERE document_id = ? AND generation = ? AND snapshot_seq = ?
      `,
        )
        .get(row.document_id, row.generation, row.head_seq) as
        DocumentSnapshotRow | undefined;
      if (
        !storedSnapshot ||
        storedSnapshot.schema_version !== row.schema_version ||
        storedSnapshot.snapshot_hash !== snapshotHash ||
        !bytesEqual(storedSnapshot.state_vector, stateVector) ||
        !bytesEqual(storedSnapshot.snapshot_update, snapshotUpdate)
      ) {
        throw new BlockDocumentStoreError(
          "document_state_corrupt",
          `Document ${row.document_id} compaction snapshot does not match its head`,
        );
      }

      const verificationDocument = new Y.Doc({ guid: row.document_id });
      try {
        applyStoredUpdate(
          verificationDocument,
          storedSnapshot.snapshot_update,
          row.document_id,
        );
        assertNoPendingDependencies(
          verificationDocument,
          "document_state_corrupt",
        );
        const blocks = validateCardDocumentContent(
          verificationDocument,
          "document_state_corrupt",
        );
        validateRegisteredBlocks(
          database,
          row,
          blocks,
          "document_state_corrupt",
        );
        if (
          !bytesEqual(
            Y.encodeStateVector(verificationDocument),
            row.state_vector,
          ) ||
          hashBytes(Y.encodeStateAsUpdate(verificationDocument)) !==
            row.state_hash
        ) {
          throw new BlockDocumentStoreError(
            "document_state_corrupt",
            `Document ${row.document_id} compaction snapshot failed round-trip verification`,
          );
        }
      } finally {
        verificationDocument.destroy();
      }

      const pruned = database
        .prepare(
          `
        DELETE FROM document_updates
        WHERE document_id = ? AND generation = ? AND seq <= ?
      `,
        )
        .run(row.document_id, row.generation, row.head_seq);
      database
        .prepare(
          `
        DELETE FROM document_snapshots
        WHERE document_id = ? AND generation = ? AND snapshot_seq < ?
      `,
        )
        .run(row.document_id, row.generation, row.head_seq);

      const reloaded = loadDocumentFromRow(database, row);
      reloaded.destroy();
      const receiptCount = database
        .prepare(
          `
        SELECT COUNT(*) AS count
        FROM document_update_receipts
        WHERE document_id = ? AND generation = ? AND seq <= ?
      `,
        )
        .get(row.document_id, row.generation, row.head_seq) as {
        count: number;
      };
      return {
        documentId: row.document_id,
        generation: row.generation,
        snapshotSeq: row.head_seq,
        snapshotBytes: snapshotUpdate.byteLength,
        prunedUpdateCount: pruned.changes,
        retainedReceiptCount: receiptCount.count,
      };
    } finally {
      document.destroy();
    }
  });

  return compact.immediate();
};
