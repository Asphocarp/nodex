import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createUuidV7 } from "../../shared/card-id";
import * as Y from "yjs";
import {
  assertValidBlockDocument,
  canonicalizeRelocationIntent,
  canonicalizeRelocationRequest,
  makeRelocationDocumentUpdateId,
  parseRelocateBlocks,
  parseRelocationIntent,
  parseRelocationResult,
  relocateBlockSubtrees,
  BlockSubtreeOperationError,
  RelocationContractError,
  type BlockId,
  type DocumentId,
  type RelocateBlocks,
  type RelocationDocumentCommit,
  type RelocationErrorCode,
  type RelocationIntent,
  type RelocationResult,
  type ScannedDocumentBlock,
} from "../../shared/block-documents";
import {
  createCanonicalEmptyParagraphBlock,
  populateBlockDocumentBodyFromBlockTree,
  type CardDocumentMaterialization,
} from "../../shared/block-documents/block-document-codec";
import {
  BlockDocumentSchemaError,
  getBlockDocumentSchemaAdapter,
  inspectOwnedBlockDocument,
  toPersistedBlockDocumentMaterialization,
  type BlockDocumentSchemaAdapter,
} from "../../shared/block-documents/document-schema-adapters";
import { isLegacyForeignBodyReference } from "../../shared/block-documents/derived-records";
import {
  BlockDocumentStoreError,
  loadPrimaryBlockDocument,
  type LoadedBlockDocument,
} from "./block-document-store";
import { replaceDocumentSecondaryProjections } from "./block-document-projections";
import { persistCardDocumentMaterialization } from "./document-materializations";

export type BlockRelocationFaultPoint =
  | "after_documents_loaded"
  | "after_subtree_relocated"
  | "after_indexes_deleted"
  | "after_registry_moved"
  | "after_source_commit"
  | "after_target_commit"
  | "after_materializations"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface RelocateBlocksAtomicallyOptions {
  readonly faultInjector?: (point: BlockRelocationFaultPoint) => void;
  readonly now?: () => string;
  /** Trusted outer ownership transaction tombstones the source before commit. */
  readonly allowRetiringSourceToBecomeEmpty?: boolean;
}

export class BlockRelocationStoreError extends Error {
  readonly code: RelocationErrorCode;
  readonly relocationId?: string;

  constructor(
    code: RelocationErrorCode,
    message: string,
    options?: ErrorOptions & { readonly relocationId?: string },
  ) {
    super(message, options);
    this.name = "BlockRelocationStoreError";
    this.code = code;
    this.relocationId = options?.relocationId;
  }
}

interface RelocationDocumentRow {
  readonly document_id: string;
  readonly project_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: string;
  readonly authority: string;
  readonly owner_block_id: string;
  readonly owner_type: string;
  readonly owner_lifecycle: string;
  readonly schema_key: string;
  readonly schema_version: number;
}

interface RelocationMemberRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly location_kind: string;
  readonly containing_document_id: string | null;
  readonly location_revision: number;
}

interface StoredRelocationRow {
  readonly id: string;
  readonly project_id: string;
  readonly target_project_id: string;
  readonly store_epoch: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly source_document_id: string;
  readonly source_generation: number;
  readonly source_base_head_seq: number;
  readonly target_kind: string;
  readonly target_document_id: string | null;
  readonly target_generation: number | null;
  readonly target_base_head_seq: number | null;
  readonly target_parent_block_id: string | null;
  readonly target_before_block_id: string | null;
  readonly root_block_ids_json: string;
  readonly expected_location_revisions_json: string;
  readonly source_update_id: string;
  readonly source_committed_seq: number;
  readonly target_update_id: string | null;
  readonly target_committed_seq: number | null;
  readonly result_json: string;
  readonly change_log_seq: number;
  readonly committed_at: string;
}

interface StoredRelocationResult {
  readonly version: 1;
  readonly rootBlockIds: readonly BlockId[];
  readonly movedBlockIds: readonly BlockId[];
  readonly finalLocations: Readonly<
    Record<
      BlockId,
      { readonly kind: "document"; readonly documentId: DocumentId }
    >
  >;
  readonly finalLocationRevisions: Readonly<Record<BlockId, number>>;
  readonly sourceStateVectorBase64: string;
  readonly targetStateVectorBase64: string;
}

interface PreparedDocumentCommit {
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly updateId: string;
  readonly update: Uint8Array;
  readonly updateHash: string;
  readonly stateVector: Uint8Array;
  readonly stateHash: string;
  readonly blocks: readonly ScannedDocumentBlock[];
  readonly materialization: CardDocumentMaterialization;
}

const RELOCATION_CLIENT_SESSION_ID = "sqlite:block-relocation";

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const bytesFromBuffer = (value: Uint8Array): Uint8Array =>
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();

const readCurrentStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row) return row.store_epoch;
  throw new BlockRelocationStoreError(
    "unknown",
    "Block document store metadata is missing",
  );
};

const assertStoreEpoch = (
  database: Database.Database,
  input: Pick<RelocateBlocks, "storeEpoch" | "relocationId">,
): string => {
  const current = readCurrentStoreEpoch(database);
  if (current === input.storeEpoch) return current;
  throw new BlockRelocationStoreError(
    "store_epoch_mismatch",
    `Relocation belongs to store epoch ${input.storeEpoch}; current epoch is ${current}`,
    { relocationId: input.relocationId },
  );
};

const readRelocationDocumentRow = (
  database: Database.Database,
  documentId: DocumentId,
  side: "source" | "target",
  relocationId: string,
): RelocationDocumentRow => {
  const row = database
    .prepare(
      `
    SELECT
      document.id AS document_id,
      document.project_id,
      document.generation,
      document.head_seq,
      document.readiness,
      document.authority,
      ownership.block_id AS owner_block_id,
      owner.type AS owner_type,
      owner.lifecycle AS owner_lifecycle,
      document.schema_key,
      document.schema_version
    FROM documents document
    JOIN block_documents ownership ON ownership.document_id = document.id
    JOIN blocks owner ON owner.id = ownership.block_id
    WHERE document.id = ?
  `,
    )
    .get(documentId) as RelocationDocumentRow | undefined;
  if (row) return row;
  throw new BlockRelocationStoreError(
    side === "source"
      ? "source_document_not_found"
      : "target_document_not_found",
    `${side === "source" ? "Source" : "Target"} Document does not exist: ${documentId}`,
    { relocationId },
  );
};

const assertDocumentBoundary = (
  row: RelocationDocumentRow,
  input: RelocateBlocks,
  side: "source" | "target",
): void => {
  const target = input.target.kind === "document" ? input.target : undefined;
  const expectedGeneration =
    side === "source" ? input.sourceGeneration : target?.generation;
  const expectedHeadSeq =
    side === "source" ? input.expectedSourceHeadSeq : target?.expectedHeadSeq;
  if (row.project_id !== input.projectId) {
    throw new BlockRelocationStoreError(
      "invalid_relocation_target",
      `${side === "source" ? "Source" : "Target"} Document belongs to another Project`,
      { relocationId: input.relocationId },
    );
  }
  let adapter: BlockDocumentSchemaAdapter;
  try {
    adapter = getBlockDocumentSchemaAdapter({
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
  } catch (error) {
    if (!(error instanceof BlockDocumentSchemaError)) throw error;
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `${side === "source" ? "Source" : "Target"} Document owner/schema is not registered`,
      { cause: error, relocationId: input.relocationId },
    );
  }
  if (
    row.readiness !== "ready" ||
    row.authority !== "ydoc_primary" ||
    row.owner_lifecycle !== "active" ||
    adapter.ownerType !== row.owner_type
  ) {
    throw new BlockRelocationStoreError(
      "document_not_ready",
      `${side === "source" ? "Source" : "Target"} Document is not an active registered Y.Doc-primary Document`,
      { relocationId: input.relocationId },
    );
  }
  if (row.generation !== expectedGeneration) {
    throw new BlockRelocationStoreError(
      "document_generation_mismatch",
      `${side === "source" ? "Source" : "Target"} Document generation is ${row.generation}; expected ${expectedGeneration}`,
      { relocationId: input.relocationId },
    );
  }
  if (row.head_seq === expectedHeadSeq) return;
  throw new BlockRelocationStoreError(
    side === "source" ? "source_head_mismatch" : "target_head_changed",
    `${side === "source" ? "Source" : "Target"} Document head is ${row.head_seq}; expected ${expectedHeadSeq}`,
    { relocationId: input.relocationId },
  );
};

const assertIntentDocumentBoundary = (
  row: RelocationDocumentRow,
  intent: RelocationIntent,
  side: "source" | "target",
): void => {
  const expectedGeneration = side === "source"
    ? intent.sourceGeneration
    : intent.target.generation;
  if (row.project_id !== intent.projectId) {
    throw new BlockRelocationStoreError(
      "invalid_relocation_target",
      `${side === "source" ? "Source" : "Target"} Document belongs to another Project`,
      { relocationId: intent.relocationId },
    );
  }
  try {
    getBlockDocumentSchemaAdapter({
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
  } catch (error) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `${side === "source" ? "Source" : "Target"} Document owner/schema is not registered`,
      { cause: error, relocationId: intent.relocationId },
    );
  }
  if (
    row.readiness !== "ready" ||
    row.authority !== "ydoc_primary" ||
    row.owner_lifecycle !== "active"
  ) {
    throw new BlockRelocationStoreError(
      "document_not_ready",
      `${side === "source" ? "Source" : "Target"} Document is not an active registered Y.Doc-primary Document`,
      { relocationId: intent.relocationId },
    );
  }
  if (row.generation === expectedGeneration) return;
  throw new BlockRelocationStoreError(
    "document_generation_mismatch",
    `${side === "source" ? "Source" : "Target"} Document generation is ${row.generation}; expected ${expectedGeneration}`,
    { relocationId: intent.relocationId },
  );
};

const loadWorkingDocument = (
  database: Database.Database,
  row: RelocationDocumentRow,
  side: "source" | "target",
  relocationId: string,
): Y.Doc => {
  let loaded: LoadedBlockDocument;
  try {
    loaded = loadPrimaryBlockDocument(database, row.document_id);
  } catch (error) {
    if (error instanceof BlockDocumentStoreError) {
      const code: RelocationErrorCode =
        error.code === "document_not_found"
          ? side === "source"
            ? "source_document_not_found"
            : "target_document_not_found"
          : error.code === "document_not_ready" ||
              error.code === "document_authority_mismatch"
            ? "document_not_ready"
            : error.code === "document_generation_mismatch"
              ? "document_generation_mismatch"
              : "document_state_corrupt";
      throw new BlockRelocationStoreError(code, error.message, {
        cause: error,
        relocationId,
      });
    }
    throw error;
  }
  // loadPrimaryBlockDocument already returns a fresh detached reconstruction.
  // Mutate that exact snapshot-plus-tail lineage directly. Re-encoding it into
  // a second equivalent Y.Doc is not a byte-canonical clone in Yjs (notably
  // around garbage-collected delete sets), so hashing the second representation
  // while persisting only its delta can create a false corruption boundary on
  // the next replay.
  return loaded.document;
};

const validateRelocatedDocument = (
  document: Y.Doc,
  row: RelocationDocumentRow,
  relocationId: string,
): {
  readonly blocks: readonly ScannedDocumentBlock[];
  readonly materialization: CardDocumentMaterialization;
  readonly fullState: Uint8Array;
  readonly stateVector: Uint8Array;
} => {
  try {
    const adapter = getBlockDocumentSchemaAdapter({
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
    const inspection = inspectOwnedBlockDocument(document, {
      ownerType: row.owner_type,
      schemaKey: row.schema_key,
      schemaVersion: row.schema_version,
    });
    if (inspection.envelope.body.toString().length > adapter.limits.maxBodyXmlLength) {
      throw new Error(
        `body exceeds ${adapter.limits.maxBodyXmlLength} XML characters`,
      );
    }
    const blocks = inspection.blocks;
    if (blocks.length > adapter.limits.maxBlocks) {
      throw new Error(`body exceeds ${adapter.limits.maxBlocks} Blocks`);
    }
    if (
      blocks.some(
        (block) => block.path.length > adapter.limits.maxXmlPathDepth,
      )
    ) {
      throw new Error(
        `body exceeds XML path depth ${adapter.limits.maxXmlPathDepth}`,
      );
    }
    if (document.store.pendingStructs || document.store.pendingDs) {
      throw new Error("document has unresolved Yjs dependencies");
    }
    const fullState = Y.encodeStateAsUpdate(document);
    if (fullState.byteLength > adapter.limits.maxStateBytes) {
      throw new Error(`state exceeds ${adapter.limits.maxStateBytes} bytes`);
    }
    const materialization = toPersistedBlockDocumentMaterialization(
      inspection.materialization,
    );
    if (materialization.references.some(isLegacyForeignBodyReference)) {
      throw new Error(
        "primary Document contains a legacy foreign-body projection",
      );
    }
    return {
      blocks,
      materialization,
      fullState,
      stateVector: Y.encodeStateVector(document),
    };
  } catch (error) {
    if (error instanceof BlockRelocationStoreError) throw error;
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation produced an invalid registered Document${detail}`,
      { cause: error, relocationId },
    );
  }
};

const mapSubtreeOperationError = (
  error: BlockSubtreeOperationError,
  relocationId: string,
): BlockRelocationStoreError => {
  const code: RelocationErrorCode = (() => {
    switch (error.code) {
      case "empty_root_selection":
      case "invalid_root_identity":
      case "duplicate_root":
      case "overlapping_roots":
        return "invalid_relocation_roots";
      case "source_block_not_found":
        return "block_not_found";
      case "target_parent_not_found":
      case "target_parent_childless":
      case "target_anchor_not_found":
      case "target_anchor_wrong_parent":
      case "target_anchor_in_moved_subtree":
        return "invalid_relocation_target";
      case "ancestor_cycle":
        return "relocation_cycle";
      case "target_identity_conflict":
      case "invalid_document":
      case "stale_capture":
      case "postcondition_failed":
        return "document_state_corrupt";
    }
  })();
  return new BlockRelocationStoreError(code, error.message, {
    cause: error,
    relocationId,
  });
};

const readMemberRows = (
  database: Database.Database,
  blockIds: readonly BlockId[],
  relocationId: string,
): readonly RelocationMemberRow[] => {
  const read = database.prepare(`
    SELECT
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, location_revision
    FROM blocks
    WHERE id = ?
  `);
  return blockIds.map((blockId) => {
    const row = read.get(blockId) as RelocationMemberRow | undefined;
    if (row) return row;
    throw new BlockRelocationStoreError(
      "block_not_found",
      `Relocated Block does not exist in the registry: ${blockId}`,
      { relocationId },
    );
  });
};

const ensureRelocationSourceEditableRoot = (
  sourceDocument: Y.Doc,
  sourceRow: RelocationDocumentRow,
): BlockId | null => {
  const inspection = inspectOwnedBlockDocument(sourceDocument, {
    ownerType: sourceRow.owner_type,
    schemaKey: sourceRow.schema_key,
    schemaVersion: sourceRow.schema_version,
  });
  if (inspection.blocks.length > 0) return null;

  const blockId = createUuidV7();
  populateBlockDocumentBodyFromBlockTree(inspection.envelope.body, [
    createCanonicalEmptyParagraphBlock(blockId),
  ]);
  return blockId;
};

const insertRelocationPlaceholderBlock = (
  database: Database.Database,
  row: RelocationDocumentRow,
  blockId: BlockId,
  now: string,
): void => {
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'paragraph', 'active', 'document', ?, 1, 1, ?, ?)
    `,
    )
    .run(blockId, row.project_id, row.document_id, now, now);
};

const assertMemberRowsMatchSource = (
  rows: readonly RelocationMemberRow[],
  sourceBlocks: readonly ScannedDocumentBlock[],
  input: RelocateBlocks,
): void => {
  const sourceTypes = new Map(
    sourceBlocks.map((block) => [block.id, block.blockType]),
  );
  for (const row of rows) {
    if (
      row.project_id !== input.projectId ||
      row.lifecycle !== "active" ||
      row.location_kind !== "document" ||
      row.containing_document_id !== input.sourceDocumentId ||
      row.type !== sourceTypes.get(row.id)
    ) {
      throw new BlockRelocationStoreError(
        "block_location_mismatch",
        `Block ${row.id} is not an active member of source Document ${input.sourceDocumentId}`,
        { relocationId: input.relocationId },
      );
    }
    if (
      Number.isSafeInteger(row.location_revision) &&
      row.location_revision >= 1
    ) {
      continue;
    }
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Block ${row.id} has an invalid location revision`,
      { relocationId: input.relocationId },
    );
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const rootBlockId of input.rootBlockIds) {
    const actual = byId.get(rootBlockId)?.location_revision;
    const expected = input.expectedLocationRevisions[rootBlockId];
    if (actual === expected) continue;
    throw new BlockRelocationStoreError(
      "block_location_revision_mismatch",
      `Block ${rootBlockId} location revision is ${actual ?? "missing"}; expected ${expected}`,
      { relocationId: input.relocationId },
    );
  }
};

const assertPostMoveRegistryShape = (
  sourceBlocks: readonly ScannedDocumentBlock[],
  targetBlocks: readonly ScannedDocumentBlock[],
  movedIds: readonly BlockId[],
  input: RelocateBlocks,
): void => {
  const moved = new Set(movedIds);
  if (sourceBlocks.some((block) => moved.has(block.id))) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      "A moved Block remained in the source Document",
      { relocationId: input.relocationId },
    );
  }
  const targetMoved = targetBlocks.filter((block) => moved.has(block.id));
  if (
    targetMoved.length === moved.size &&
    targetMoved.every((block) => moved.has(block.id))
  ) {
    return;
  }
  throw new BlockRelocationStoreError(
    "document_state_corrupt",
    "The target Document does not contain the exact relocated subtree",
    { relocationId: input.relocationId },
  );
};

const insertDocumentIndex = (
  database: Database.Database,
  documentId: DocumentId,
  blocks: readonly ScannedDocumentBlock[],
  projectedSeq: number,
): void => {
  const insert = database.prepare(`
    INSERT INTO document_block_index (
      document_id, block_id, parent_block_id, ordinal,
      block_type, text, projected_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  blocks.forEach((block, ordinal) => {
    insert.run(
      documentId,
      block.id,
      block.parentBlockId,
      ordinal,
      block.blockType,
      block.text,
      projectedSeq,
    );
  });
};

const prepareDocumentCommit = (input: {
  readonly document: Y.Doc;
  readonly baselineStateVector: Uint8Array;
  readonly documentId: DocumentId;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly updateId: string;
  readonly relocationId: string;
  readonly row: RelocationDocumentRow;
}): PreparedDocumentCommit => {
  const validated = validateRelocatedDocument(
    input.document,
    input.row,
    input.relocationId,
  );
  const update = Y.encodeStateAsUpdate(
    input.document,
    input.baselineStateVector,
  );
  if (
    update.byteLength < 1 ||
    update.byteLength >
      getBlockDocumentSchemaAdapter({
        ownerType: input.row.owner_type,
        schemaKey: input.row.schema_key,
        schemaVersion: input.row.schema_version,
      }).limits.maxUpdateBytes
  ) {
    throw new BlockRelocationStoreError(
      "invalid_relocation_target",
      `Relocation update for ${input.documentId} exceeds its registered schema limit`,
      { relocationId: input.relocationId },
    );
  }
  return {
    documentId: input.documentId,
    generation: input.generation,
    baseHeadSeq: input.baseHeadSeq,
    headSeq: input.baseHeadSeq + 1,
    updateId: input.updateId,
    update,
    updateHash: sha256(update),
    stateVector: validated.stateVector,
    stateHash: sha256(validated.fullState),
    blocks: validated.blocks,
    materialization: validated.materialization,
  };
};

const persistPreparedDocumentCommit = (
  database: Database.Database,
  commit: PreparedDocumentCommit,
  touchedBlockIdsJson: string,
  now: string,
  relocationId: string,
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
      commit.documentId,
      commit.generation,
      commit.headSeq,
      commit.updateId,
      RELOCATION_CLIENT_SESSION_ID,
      commit.baseHeadSeq,
      touchedBlockIdsJson,
      touchedBlockIdsJson,
      commit.updateHash,
      commit.update.byteLength,
      now,
    );
  database
    .prepare(
      `
    INSERT INTO document_updates (
      document_id, generation, seq, update_id, client_session_id,
      base_head_seq, touched_block_ids_json, update_blob,
      update_hash, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      commit.documentId,
      commit.generation,
      commit.headSeq,
      commit.updateId,
      RELOCATION_CLIENT_SESSION_ID,
      commit.baseHeadSeq,
      touchedBlockIdsJson,
      Buffer.from(commit.update),
      commit.updateHash,
      now,
    );
  const updated = database
    .prepare(
      `
    UPDATE documents
    SET head_seq = ?, state_vector = ?, state_hash = ?, updated_at = ?
    WHERE id = ? AND generation = ? AND head_seq = ?
      AND readiness = 'ready' AND authority = 'ydoc_primary'
  `,
    )
    .run(
      commit.headSeq,
      Buffer.from(commit.stateVector),
      commit.stateHash,
      now,
      commit.documentId,
      commit.generation,
      commit.baseHeadSeq,
    );
  if (updated.changes === 1) return;
  throw new BlockRelocationStoreError(
    "document_state_corrupt",
    `Document ${commit.documentId} head changed inside the relocation fence`,
    { relocationId },
  );
};

const makePublicCommit = (
  commit: PreparedDocumentCommit,
): RelocationDocumentCommit => ({
  documentId: commit.documentId,
  generation: commit.generation,
  baseHeadSeq: commit.baseHeadSeq,
  headSeq: commit.headSeq,
  updateId: commit.updateId,
  update: bytesFromBuffer(commit.update),
  stateVector: bytesFromBuffer(commit.stateVector),
});

const decodeBase64 = (value: unknown, label: string): Uint8Array => {
  if (typeof value !== "string" || value.length < 1) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `${label} is missing from the relocation ledger`,
    );
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength > 0 && decoded.toString("base64") === value) {
    return bytesFromBuffer(decoded);
  }
  throw new BlockRelocationStoreError(
    "document_state_corrupt",
    `${label} is invalid in the relocation ledger`,
  );
};

const parseStoredResult = (
  row: StoredRelocationRow,
): StoredRelocationResult => {
  let value: unknown;
  try {
    value = JSON.parse(row.result_json);
  } catch (error) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} has invalid result JSON`,
      { cause: error, relocationId: row.id },
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} has invalid result metadata`,
      { relocationId: row.id },
    );
  }
  const result = value as Partial<StoredRelocationResult>;
  if (
    result.version === 1 &&
    typeof result.finalLocations === "object" &&
    result.finalLocations !== null &&
    typeof result.finalLocationRevisions === "object" &&
    result.finalLocationRevisions !== null &&
    typeof result.sourceStateVectorBase64 === "string" &&
    typeof result.targetStateVectorBase64 === "string"
  ) {
    return result as StoredRelocationResult;
  }
  throw new BlockRelocationStoreError(
    "document_state_corrupt",
    `Relocation ${row.id} has incomplete result metadata`,
    { relocationId: row.id },
  );
};

interface StoredReceiptRow {
  readonly generation: number;
  readonly seq: number;
  readonly update_id: string;
  readonly client_session_id: string;
  readonly base_head_seq: number;
  readonly client_touched_block_ids_json: string;
  readonly derived_touched_block_ids_json: string;
  readonly derivation_version: number;
  readonly update_hash: string;
  readonly update_byte_length: number;
}

const readStoredCommitUpdate = (
  database: Database.Database,
  input: {
    readonly documentId: string;
    readonly generation: number;
    readonly seq: number;
    readonly updateId: string;
    readonly relocationId: string;
  },
): Uint8Array | null => {
  const receipt = database
    .prepare(
      `
    SELECT
      generation, seq, update_id, client_session_id, base_head_seq,
      client_touched_block_ids_json, derived_touched_block_ids_json,
      derivation_version, update_hash, update_byte_length
    FROM document_update_receipts
    WHERE document_id = ? AND generation = ? AND seq = ? AND update_id = ?
  `,
    )
    .get(input.documentId, input.generation, input.seq, input.updateId) as
    StoredReceiptRow | undefined;
  if (
    !receipt ||
    receipt.generation !== input.generation ||
    receipt.seq !== input.seq ||
    receipt.update_id !== input.updateId ||
    receipt.client_session_id !== RELOCATION_CLIENT_SESSION_ID ||
    receipt.base_head_seq !== input.seq - 1 ||
    receipt.client_touched_block_ids_json !==
      receipt.derived_touched_block_ids_json ||
    receipt.derivation_version !== 1 ||
    receipt.update_byte_length < 1 ||
    !/^[a-f0-9]{64}$/u.test(receipt.update_hash)
  ) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${input.relocationId} has an invalid durable update receipt`,
      { relocationId: input.relocationId },
    );
  }
  const row = database
    .prepare(
      `
    SELECT update_blob
    FROM document_updates
    WHERE document_id = ? AND generation = ? AND seq = ? AND update_id = ?
  `,
    )
    .get(input.documentId, input.generation, input.seq, input.updateId) as
    { readonly update_blob: Buffer } | undefined;
  if (!row) return null;
  const update = bytesFromBuffer(row.update_blob);
  if (
    update.byteLength === receipt.update_byte_length &&
    sha256(update) === receipt.update_hash
  ) {
    return update;
  }
  throw new BlockRelocationStoreError(
    "document_state_corrupt",
    `Relocation ${input.relocationId} update payload does not match its receipt`,
    { relocationId: input.relocationId },
  );
};

const loadDuplicateResult = (
  database: Database.Database,
  row: StoredRelocationRow,
  expectedRequest: RelocateBlocks,
): RelocationResult => {
  if (
    row.target_kind !== "document" ||
    row.target_document_id === null ||
    row.target_generation === null ||
    row.target_base_head_seq === null ||
    row.target_update_id === null ||
    row.target_committed_seq === null
  ) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} is not a complete document relocation`,
      { relocationId: row.id },
    );
  }
  const stored = parseStoredResult(row);
  const sourceStateVector = decodeBase64(
    stored.sourceStateVectorBase64,
    "source state vector",
  );
  const targetStateVector = decodeBase64(
    stored.targetStateVectorBase64,
    "target state vector",
  );
  const candidate: RelocationResult = {
    relocationId: row.id,
    projectId: row.project_id,
    storeEpoch: row.store_epoch,
    duplicate: true,
    rootBlockIds: stored.rootBlockIds,
    movedBlockIds: stored.movedBlockIds,
    finalLocations: stored.finalLocations,
    finalLocationRevisions: stored.finalLocationRevisions,
    sourceCommit: {
      documentId: row.source_document_id,
      generation: row.source_generation,
      baseHeadSeq: row.source_base_head_seq,
      headSeq: row.source_committed_seq,
      updateId: row.source_update_id,
      update: readStoredCommitUpdate(database, {
        documentId: row.source_document_id,
        generation: row.source_generation,
        seq: row.source_committed_seq,
        updateId: row.source_update_id,
        relocationId: row.id,
      }),
      stateVector: sourceStateVector,
    },
    targetCommit: {
      documentId: row.target_document_id,
      generation: row.target_generation,
      baseHeadSeq: row.target_base_head_seq,
      headSeq: row.target_committed_seq,
      updateId: row.target_update_id,
      update: readStoredCommitUpdate(database, {
        documentId: row.target_document_id,
        generation: row.target_generation,
        seq: row.target_committed_seq,
        updateId: row.target_update_id,
        relocationId: row.id,
      }),
      stateVector: targetStateVector,
    },
    changeLogSeq: row.change_log_seq,
    committedAt: row.committed_at,
  };
  try {
    return parseRelocationResult(candidate, expectedRequest);
  } catch (error) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} result failed contract validation`,
      { cause: error, relocationId: row.id },
    );
  }
};

const readStoredRelocation = (
  database: Database.Database,
  relocationId: string,
): StoredRelocationRow | undefined =>
  database
    .prepare(
      `
    SELECT
      id, project_id, target_project_id, store_epoch, request_hash,
      request_json, source_document_id, source_generation,
      source_base_head_seq, target_kind, target_document_id,
      target_generation, target_base_head_seq, target_parent_block_id,
      target_before_block_id, root_block_ids_json,
      expected_location_revisions_json, source_update_id,
      source_committed_seq, target_update_id, target_committed_seq,
      result_json, change_log_seq
      , committed_at
    FROM block_relocations
    WHERE id = ?
  `,
    )
    .get(relocationId) as StoredRelocationRow | undefined;

const parseStoredRelocationIntent = (
  row: StoredRelocationRow,
): RelocationIntent => {
  if (
    row.target_kind !== "document" ||
    row.target_document_id === null ||
    row.target_generation === null
  ) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} has no Document target intent`,
      { relocationId: row.id },
    );
  }
  try {
    return parseRelocationIntent({
      relocationId: row.id,
      projectId: row.project_id,
      storeEpoch: row.store_epoch,
      rootBlockIds: JSON.parse(row.root_block_ids_json),
      sourceDocumentId: row.source_document_id,
      sourceGeneration: row.source_generation,
      target: {
        kind: "document",
        documentId: row.target_document_id,
        generation: row.target_generation,
        ...(row.target_parent_block_id === null
          ? {}
          : { parentBlockId: row.target_parent_block_id }),
        ...(row.target_before_block_id === null
          ? {}
          : { beforeBlockId: row.target_before_block_id }),
      },
    });
  } catch (error) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} has an invalid durable intent`,
      { cause: error, relocationId: row.id },
    );
  }
};

const assertStoredIntentMatches = (
  row: StoredRelocationRow,
  intent: RelocationIntent,
): void => {
  const storedIntent = parseStoredRelocationIntent(row);
  if (
    row.target_project_id === intent.projectId &&
    canonicalizeRelocationIntent(storedIntent) ===
      canonicalizeRelocationIntent(intent)
  ) {
    return;
  }
  throw new BlockRelocationStoreError(
    "relocation_id_collision",
    `Relocation ID ${intent.relocationId} is already committed with a different logical intent`,
    { relocationId: intent.relocationId },
  );
};

const makeStoredRelocationCommand = (
  row: StoredRelocationRow,
): RelocateBlocks => {
  const intent = parseStoredRelocationIntent(row);
  if (row.target_base_head_seq === null) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} has no target head boundary`,
      { relocationId: row.id },
    );
  }
  try {
    return parseRelocateBlocks({
      ...intent,
      expectedSourceHeadSeq: row.source_base_head_seq,
      expectedLocationRevisions: JSON.parse(
        row.expected_location_revisions_json,
      ),
      target: {
        ...intent.target,
        expectedHeadSeq: row.target_base_head_seq,
      },
    });
  } catch (error) {
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Relocation ${row.id} has invalid durable commit boundaries`,
      { cause: error, relocationId: row.id },
    );
  }
};

const moveRegistryMembers = (
  database: Database.Database,
  rows: readonly RelocationMemberRow[],
  input: RelocateBlocks,
  targetDocumentId: DocumentId,
  now: string,
): void => {
  const move = database.prepare(`
    UPDATE blocks
    SET containing_document_id = ?, location_revision = location_revision + 1,
        updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = 'active'
      AND location_kind = 'document' AND containing_document_id = ?
      AND location_revision = ?
  `);
  for (const row of rows) {
    const result = move.run(
      targetDocumentId,
      now,
      row.id,
      input.projectId,
      input.sourceDocumentId,
      row.location_revision,
    );
    if (result.changes === 1) continue;
    throw new BlockRelocationStoreError(
      "block_location_mismatch",
      `Block ${row.id} moved while committing relocation`,
      { relocationId: input.relocationId },
    );
  }
};

const persistChangeLog = (
  database: Database.Database,
  input: RelocateBlocks,
  requestHash: string,
  movedBlockIds: readonly BlockId[],
  sourceCommit: PreparedDocumentCommit,
  targetCommit: PreparedDocumentCommit,
  now: string,
): number => {
  const target = input.target;
  if (target.kind !== "document") {
    throw new BlockRelocationStoreError(
      "invalid_relocation_target",
      "Only document relocation can be written by this path",
      { relocationId: input.relocationId },
    );
  }
  const result = database
    .prepare(
      `
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id, block_ids_json,
      document_ids_json, database_block_ids_json, payload_json, committed_at
    ) VALUES (?, ?, 'block_relocation', ?, ?, ?, '[]', ?, ?)
  `,
    )
    .run(
      input.projectId,
      input.storeEpoch,
      input.relocationId,
      JSON.stringify(movedBlockIds),
      JSON.stringify([input.sourceDocumentId, target.documentId]),
      JSON.stringify({
        requestHash,
        rootBlockIds: input.rootBlockIds,
        sourceHeadSeq: sourceCommit.headSeq,
        targetHeadSeq: targetCommit.headSeq,
        targetParentBlockId: target.parentBlockId ?? null,
        targetBeforeBlockId: target.beforeBlockId ?? null,
      }),
      now,
    );
  const seq = Number(result.lastInsertRowid);
  if (Number.isSafeInteger(seq) && seq >= 1) return seq;
  throw new BlockRelocationStoreError(
    "document_state_corrupt",
    "SQLite returned an invalid relocation change sequence",
    { relocationId: input.relocationId },
  );
};

const persistRelocationLedger = (
  database: Database.Database,
  input: RelocateBlocks,
  canonicalRequest: string,
  requestHash: string,
  memberRows: readonly RelocationMemberRow[],
  rootBlockIds: readonly BlockId[],
  movedBlockIds: readonly BlockId[],
  finalLocationRevisions: Readonly<Record<BlockId, number>>,
  sourceCommit: PreparedDocumentCommit,
  targetCommit: PreparedDocumentCommit,
  sourcePreStateVector: Uint8Array,
  sourcePreFullUpdate: Uint8Array,
  sourcePreStateHash: string,
  changeLogSeq: number,
  now: string,
): void => {
  const target = input.target;
  if (target.kind !== "document") {
    throw new BlockRelocationStoreError(
      "invalid_relocation_target",
      "Only document relocation can be written by this path",
      { relocationId: input.relocationId },
    );
  }
  const finalLocations = Object.fromEntries(
    movedBlockIds.map((blockId) => [
      blockId,
      { kind: "document" as const, documentId: target.documentId },
    ]),
  );
  const storedResult: StoredRelocationResult = {
    version: 1,
    rootBlockIds,
    movedBlockIds,
    finalLocations,
    finalLocationRevisions,
    sourceStateVectorBase64: Buffer.from(sourceCommit.stateVector).toString(
      "base64",
    ),
    targetStateVectorBase64: Buffer.from(targetCommit.stateVector).toString(
      "base64",
    ),
  };
  database
    .prepare(
      `
    INSERT INTO block_relocations (
      id, project_id, target_project_id, store_epoch,
      request_hash, request_json,
      source_document_id, source_generation, source_base_head_seq,
      target_kind, target_document_id, target_generation,
      target_base_head_seq, target_parent_block_id, target_before_block_id,
      root_block_ids_json, expected_location_revisions_json, status,
      source_update_id, source_committed_seq,
      target_update_id, target_committed_seq,
      final_location_revisions_json, result_json,
      change_log_seq, committed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, 'document', ?, ?, ?, ?, ?, ?, ?,
      'committed', ?, ?, ?, ?, ?, ?, ?, ?
    )
  `,
    )
    .run(
      input.relocationId,
      input.projectId,
      input.projectId,
      input.storeEpoch,
      requestHash,
      canonicalRequest,
      input.sourceDocumentId,
      input.sourceGeneration,
      input.expectedSourceHeadSeq,
      target.documentId,
      target.generation,
      target.expectedHeadSeq,
      target.parentBlockId ?? null,
      target.beforeBlockId ?? null,
      JSON.stringify(rootBlockIds),
      JSON.stringify(input.expectedLocationRevisions),
      sourceCommit.updateId,
      sourceCommit.headSeq,
      targetCommit.updateId,
      targetCommit.headSeq,
      JSON.stringify(finalLocationRevisions),
      JSON.stringify(storedResult),
      changeLogSeq,
      now,
    );

  const byId = new Map(memberRows.map((row) => [row.id, row]));
  const rootIds = new Set(rootBlockIds);
  const insertMember = database.prepare(`
    INSERT INTO block_relocation_members (
      relocation_id, block_id, tree_ordinal, is_root,
      source_project_id, final_project_id,
      source_location_revision, final_location_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  movedBlockIds.forEach((blockId, treeOrdinal) => {
    const sourceRevision = byId.get(blockId)?.location_revision;
    const finalRevision = finalLocationRevisions[blockId];
    if (sourceRevision === undefined || finalRevision === undefined) {
      throw new BlockRelocationStoreError(
        "document_state_corrupt",
        `Relocation member ${blockId} has no revision record`,
        { relocationId: input.relocationId },
      );
    }
    insertMember.run(
      input.relocationId,
      blockId,
      treeOrdinal,
      rootIds.has(blockId) ? 1 : 0,
      input.projectId,
      input.projectId,
      sourceRevision,
      finalRevision,
    );
  });
  database
    .prepare(
      `
    INSERT INTO block_relocation_source_states (
      relocation_id, document_id, project_id, generation, head_seq,
      pre_state_vector, pre_full_update, pre_full_update_byte_length,
      pre_state_hash, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      input.relocationId,
      input.sourceDocumentId,
      input.projectId,
      input.sourceGeneration,
      input.expectedSourceHeadSeq,
      Buffer.from(sourcePreStateVector),
      Buffer.from(sourcePreFullUpdate),
      sourcePreFullUpdate.byteLength,
      sourcePreStateHash,
      now,
    );
};

const parseInput = (value: RelocateBlocks): RelocateBlocks => {
  try {
    return parseRelocateBlocks(value);
  } catch (error) {
    if (error instanceof RelocationContractError) {
      throw new BlockRelocationStoreError(
        "invalid_relocation_request",
        error.message,
        { cause: error },
      );
    }
    throw error;
  }
};

const parseIntentInput = (value: RelocationIntent): RelocationIntent => {
  try {
    return parseRelocationIntent(value);
  } catch (error) {
    if (error instanceof RelocationContractError) {
      throw new BlockRelocationStoreError(
        "invalid_relocation_request",
        error.message,
        { cause: error },
      );
    }
    throw error;
  }
};

const readPreparedRootRevisions = (
  database: Database.Database,
  rootBlockIds: readonly BlockId[],
  sourceBlocks: readonly ScannedDocumentBlock[],
  intent: RelocationIntent,
): Readonly<Record<BlockId, number>> => {
  const rows = readMemberRows(database, rootBlockIds, intent.relocationId);
  const sourceTypes = new Map(
    sourceBlocks.map((block) => [block.id, block.blockType]),
  );
  for (const row of rows) {
    if (
      row.project_id !== intent.projectId ||
      row.lifecycle !== "active" ||
      row.location_kind !== "document" ||
      row.containing_document_id !== intent.sourceDocumentId ||
      row.type !== sourceTypes.get(row.id)
    ) {
      throw new BlockRelocationStoreError(
        "block_location_mismatch",
        `Root Block ${row.id} is not an active member of source Document ${intent.sourceDocumentId}`,
        { relocationId: intent.relocationId },
      );
    }
    if (
      Number.isSafeInteger(row.location_revision) &&
      row.location_revision >= 1
    ) {
      continue;
    }
    throw new BlockRelocationStoreError(
      "document_state_corrupt",
      `Root Block ${row.id} has an invalid location revision`,
      { relocationId: intent.relocationId },
    );
  }
  return Object.fromEntries(
    rows.map((row) => [row.id, row.location_revision]),
  );
};

/**
 * Resolve a logical intent against the latest writer-fenced Document heads.
 * Lease coordinators call this only after every participant has flushed.
 */
export const prepareRelocationCommand = (
  database: Database.Database,
  rawIntent: RelocationIntent,
): RelocateBlocks => {
  const intent = parseIntentInput(rawIntent);
  const prepare = database.transaction((): RelocateBlocks => {
    assertStoreEpoch(database, intent);
    const existing = readStoredRelocation(database, intent.relocationId);
    if (existing) {
      assertStoredIntentMatches(existing, intent);
      throw new BlockRelocationStoreError(
        "relocation_id_collision",
        `Relocation ${intent.relocationId} is already committed; read its durable result instead`,
        { relocationId: intent.relocationId },
      );
    }

    const sourceRow = readRelocationDocumentRow(
      database,
      intent.sourceDocumentId,
      "source",
      intent.relocationId,
    );
    const targetRow = readRelocationDocumentRow(
      database,
      intent.target.documentId,
      "target",
      intent.relocationId,
    );
    assertIntentDocumentBoundary(sourceRow, intent, "source");
    assertIntentDocumentBoundary(targetRow, intent, "target");
    const sourceDocument = loadWorkingDocument(
      database,
      sourceRow,
      "source",
      intent.relocationId,
    );
    const targetDocument = loadWorkingDocument(
      database,
      targetRow,
      "target",
      intent.relocationId,
    );
    try {
      const sourceBlocks = assertValidBlockDocument(
        inspectOwnedBlockDocument(sourceDocument, {
          ownerType: sourceRow.owner_type,
          schemaKey: sourceRow.schema_key,
          schemaVersion: sourceRow.schema_version,
        }).envelope.body,
      );
      let operation;
      try {
        operation = relocateBlockSubtrees({
          sourceDocument,
          targetDocument,
          sourceBody: inspectOwnedBlockDocument(sourceDocument, {
            ownerType: sourceRow.owner_type,
            schemaKey: sourceRow.schema_key,
            schemaVersion: sourceRow.schema_version,
          }).envelope.body,
          targetBody: inspectOwnedBlockDocument(targetDocument, {
            ownerType: targetRow.owner_type,
            schemaKey: targetRow.schema_key,
            schemaVersion: targetRow.schema_version,
          }).envelope.body,
          rootBlockIds: intent.rootBlockIds,
          target: {
            ...(intent.target.parentBlockId === undefined
              ? {}
              : { parentBlockId: intent.target.parentBlockId }),
            ...(intent.target.beforeBlockId === undefined
              ? {}
              : { beforeBlockId: intent.target.beforeBlockId }),
          },
          transactionOrigin: `relocation-prepare:${intent.relocationId}`,
        });
      } catch (error) {
        if (error instanceof BlockSubtreeOperationError) {
          throw mapSubtreeOperationError(error, intent.relocationId);
        }
        throw error;
      }
      const expectedLocationRevisions = readPreparedRootRevisions(
        database,
        operation.forest.rootBlockIds,
        sourceBlocks,
        intent,
      );
      return parseRelocateBlocks({
        ...intent,
        rootBlockIds: operation.forest.rootBlockIds,
        expectedSourceHeadSeq: sourceRow.head_seq,
        expectedLocationRevisions,
        target: {
          ...intent.target,
          expectedHeadSeq: targetRow.head_seq,
        },
      });
    } finally {
      sourceDocument.destroy();
      targetDocument.destroy();
    }
  });
  return prepare.immediate();
};

/** Read a committed logical intent without reconstructing state from live heads. */
export const readCommittedRelocation = (
  database: Database.Database,
  rawIntent: RelocationIntent,
): RelocationResult | null => {
  const intent = parseIntentInput(rawIntent);
  const read = database.transaction((): RelocationResult | null => {
    assertStoreEpoch(database, intent);
    const stored = readStoredRelocation(database, intent.relocationId);
    if (!stored) return null;
    assertStoredIntentMatches(stored, intent);
    return loadDuplicateResult(
      database,
      stored,
      makeStoredRelocationCommand(stored),
    );
  });
  return read.immediate();
};

/**
 * Relocate a stable Block subtree between two Card Y.Docs.
 * The caller must run this function on the process-wide SQLite writer FIFO.
 * Both Yjs updates, registry locations, projections, and the durable operation
 * ledger commit in one IMMEDIATE transaction; nothing is published here.
 */
export const relocateBlocksAtomically = (
  database: Database.Database,
  rawInput: RelocateBlocks,
  options: RelocateBlocksAtomicallyOptions = {},
): RelocationResult => {
  const input = parseInput(rawInput);
  if (input.target.kind !== "document") {
    throw new BlockRelocationStoreError(
      "invalid_relocation_target",
      "This writer slice supports same-Project Document-to-Document relocation only",
      { relocationId: input.relocationId },
    );
  }
  const target = input.target;
  const canonicalRequest = canonicalizeRelocationRequest(input);
  const requestHash = sha256(canonicalRequest);
  const sourceUpdateId = makeRelocationDocumentUpdateId(requestHash, "source");
  const targetUpdateId = makeRelocationDocumentUpdateId(requestHash, "target");
  const inject = (point: BlockRelocationFaultPoint): void => {
    options.faultInjector?.(point);
  };

  const relocate = database.transaction((): RelocationResult => {
    assertStoreEpoch(database, input);
    const existing = readStoredRelocation(database, input.relocationId);
    if (existing) {
      if (
        existing.request_hash === requestHash &&
        existing.request_json === canonicalRequest &&
        existing.project_id === input.projectId &&
        existing.store_epoch === input.storeEpoch
      ) {
        return loadDuplicateResult(database, existing, input);
      }
      throw new BlockRelocationStoreError(
        "relocation_id_collision",
        `Relocation ID ${input.relocationId} is already committed with different semantics`,
        { relocationId: input.relocationId },
      );
    }

    const sourceRow = readRelocationDocumentRow(
      database,
      input.sourceDocumentId,
      "source",
      input.relocationId,
    );
    const targetRow = readRelocationDocumentRow(
      database,
      target.documentId,
      "target",
      input.relocationId,
    );
    assertDocumentBoundary(sourceRow, input, "source");
    assertDocumentBoundary(targetRow, input, "target");

    const sourceDocument = loadWorkingDocument(
      database,
      sourceRow,
      "source",
      input.relocationId,
    );
    const targetDocument = loadWorkingDocument(
      database,
      targetRow,
      "target",
      input.relocationId,
    );
    try {
      inject("after_documents_loaded");
      const sourcePreStateVector = Y.encodeStateVector(sourceDocument);
      const sourcePreFullUpdate = Y.encodeStateAsUpdate(sourceDocument);
      const sourcePreStateHash = sha256(sourcePreFullUpdate);
      const targetPreStateVector = Y.encodeStateVector(targetDocument);
      const sourceBlocksBefore = assertValidBlockDocument(
        inspectOwnedBlockDocument(sourceDocument, {
          ownerType: sourceRow.owner_type,
          schemaKey: sourceRow.schema_key,
          schemaVersion: sourceRow.schema_version,
        }).envelope.body,
      );
      let operation;
      try {
        operation = relocateBlockSubtrees({
          sourceDocument,
          targetDocument,
          sourceBody: inspectOwnedBlockDocument(sourceDocument, {
            ownerType: sourceRow.owner_type,
            schemaKey: sourceRow.schema_key,
            schemaVersion: sourceRow.schema_version,
          }).envelope.body,
          targetBody: inspectOwnedBlockDocument(targetDocument, {
            ownerType: targetRow.owner_type,
            schemaKey: targetRow.schema_key,
            schemaVersion: targetRow.schema_version,
          }).envelope.body,
          rootBlockIds: input.rootBlockIds,
          target: {
            ...(target.parentBlockId === undefined
              ? {}
              : { parentBlockId: target.parentBlockId }),
            ...(target.beforeBlockId === undefined
              ? {}
              : { beforeBlockId: target.beforeBlockId }),
          },
          transactionOrigin: `relocation:${input.relocationId}`,
        });
      } catch (error) {
        if (error instanceof BlockSubtreeOperationError) {
          throw mapSubtreeOperationError(error, input.relocationId);
        }
        throw error;
      }
      inject("after_subtree_relocated");
      const sourcePlaceholderBlockId = options.allowRetiringSourceToBecomeEmpty
        ? null
        : ensureRelocationSourceEditableRoot(
            sourceDocument,
            sourceRow,
          );

      const memberRows = readMemberRows(
        database,
        operation.forest.blockIds,
        input.relocationId,
      );
      assertMemberRowsMatchSource(memberRows, sourceBlocksBefore, input);
      const sourceCommit = prepareDocumentCommit({
        document: sourceDocument,
        baselineStateVector: sourcePreStateVector,
        documentId: input.sourceDocumentId,
        generation: input.sourceGeneration,
        baseHeadSeq: input.expectedSourceHeadSeq,
        updateId: sourceUpdateId,
        relocationId: input.relocationId,
        row: sourceRow,
      });
      const targetCommit = prepareDocumentCommit({
        document: targetDocument,
        baselineStateVector: targetPreStateVector,
        documentId: target.documentId,
        generation: target.generation,
        baseHeadSeq: target.expectedHeadSeq,
        updateId: targetUpdateId,
        relocationId: input.relocationId,
        row: targetRow,
      });
      assertPostMoveRegistryShape(
        sourceCommit.blocks,
        targetCommit.blocks,
        operation.forest.blockIds,
        input,
      );

      const now = options.now?.() ?? new Date().toISOString();
      database
        .prepare("DELETE FROM document_block_index WHERE document_id IN (?, ?)")
        .run(input.sourceDocumentId, target.documentId);
      inject("after_indexes_deleted");
      moveRegistryMembers(database, memberRows, input, target.documentId, now);
      if (sourcePlaceholderBlockId) {
        insertRelocationPlaceholderBlock(
          database,
          sourceRow,
          sourcePlaceholderBlockId,
          now,
        );
      }
      inject("after_registry_moved");

      insertDocumentIndex(
        database,
        input.sourceDocumentId,
        sourceCommit.blocks,
        sourceCommit.headSeq,
      );
      insertDocumentIndex(
        database,
        target.documentId,
        targetCommit.blocks,
        targetCommit.headSeq,
      );
      const sourceTouchedBlockIds = [
        ...operation.forest.blockIds,
        ...(sourcePlaceholderBlockId ? [sourcePlaceholderBlockId] : []),
      ];
      const sourceTouchedBlockIdsJson = JSON.stringify(sourceTouchedBlockIds);
      const targetTouchedBlockIdsJson = JSON.stringify(
        operation.forest.blockIds,
      );
      persistPreparedDocumentCommit(
        database,
        sourceCommit,
        sourceTouchedBlockIdsJson,
        now,
        input.relocationId,
      );
      inject("after_source_commit");
      persistPreparedDocumentCommit(
        database,
        targetCommit,
        targetTouchedBlockIdsJson,
        now,
        input.relocationId,
      );
      inject("after_target_commit");
      persistCardDocumentMaterialization(database, {
        documentId: sourceCommit.documentId,
        generation: sourceCommit.generation,
        projectedSeq: sourceCommit.headSeq,
        materialization: sourceCommit.materialization,
        updatedAt: now,
      });
      persistCardDocumentMaterialization(database, {
        documentId: targetCommit.documentId,
        generation: targetCommit.generation,
        projectedSeq: targetCommit.headSeq,
        materialization: targetCommit.materialization,
        updatedAt: now,
      });
      replaceDocumentSecondaryProjections(database, {
        documentId: sourceCommit.documentId,
        expectedGeneration: sourceCommit.generation,
        expectedProjectedSeq: sourceCommit.headSeq,
      });
      replaceDocumentSecondaryProjections(database, {
        documentId: targetCommit.documentId,
        expectedGeneration: targetCommit.generation,
        expectedProjectedSeq: targetCommit.headSeq,
      });
      inject("after_materializations");

      const finalLocationRevisions = Object.fromEntries(
        memberRows.map((row) => [row.id, row.location_revision + 1]),
      );
      const finalLocations = Object.fromEntries(
        operation.forest.blockIds.map((blockId) => [
          blockId,
          {
            kind: "document" as const,
            documentId: target.documentId,
          },
        ]),
      );
      const changeLogSeq = persistChangeLog(
        database,
        input,
        requestHash,
        sourceTouchedBlockIds,
        sourceCommit,
        targetCommit,
        now,
      );
      inject("after_change_log");
      persistRelocationLedger(
        database,
        input,
        canonicalRequest,
        requestHash,
        memberRows,
        operation.forest.rootBlockIds,
        operation.forest.blockIds,
        finalLocationRevisions,
        sourceCommit,
        targetCommit,
        sourcePreStateVector,
        sourcePreFullUpdate,
        sourcePreStateHash,
        changeLogSeq,
        now,
      );
      inject("after_ledger");
      inject("before_commit");

      return {
        relocationId: input.relocationId,
        projectId: input.projectId,
        storeEpoch: input.storeEpoch,
        duplicate: false,
        rootBlockIds: operation.forest.rootBlockIds,
        movedBlockIds: operation.forest.blockIds,
        finalLocations,
        finalLocationRevisions,
        sourceCommit: makePublicCommit(sourceCommit),
        targetCommit: makePublicCommit(targetCommit),
        changeLogSeq,
        committedAt: now,
      };
    } finally {
      sourceDocument.destroy();
      targetDocument.destroy();
    }
  });

  const result = relocate.immediate();
  inject("after_commit");
  return result;
};
