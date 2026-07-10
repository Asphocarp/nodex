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
  type DocumentSyncApplyAck,
  type DocumentSyncCommandError,
  type DocumentSyncErrorCode,
  type DocumentSyncRequest,
  type DocumentSyncResponse,
  type ScannedDocumentBlock,
} from "../../shared/block-documents";

type DocumentReadiness = "pending_genesis" | "ready" | "failed";
type DocumentAuthority = "legacy_shadow" | "ydoc_primary";

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

interface StoredDocumentUpdateRow {
  readonly generation: number;
  readonly seq: number;
  readonly client_session_id: string;
  readonly base_head_seq: number;
  readonly touched_block_ids_json: string;
  readonly update_blob: Buffer;
  readonly update_hash: string;
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

export type BlockDocumentStoreErrorCode =
  | "store_not_initialized"
  | "store_epoch_mismatch"
  | "document_not_found"
  | "document_not_ready"
  | "document_already_initialized"
  | "document_generation_mismatch"
  | "unsupported_document_schema"
  | "future_base_head"
  | "invalid_document_update"
  | "document_update_missing_dependencies"
  | "update_id_collision"
  | "document_state_corrupt";

export class BlockDocumentStoreError extends Error {
  readonly code: BlockDocumentStoreErrorCode;

  constructor(code: BlockDocumentStoreErrorCode, message: string) {
    super(message);
    this.name = "BlockDocumentStoreError";
    this.code = code;
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
    case "document_state_corrupt":
      return error.code;
    case "document_already_initialized":
      return "invalid_document_update";
  }
};

export const toDocumentSyncCommandError = (
  error: unknown,
): DocumentSyncCommandError => {
  const code = toDocumentSyncErrorCode(error);
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: code === "store_not_initialized"
      || code === "document_not_ready"
      || code === "future_base_head"
      || code === "document_update_missing_dependencies",
    resetRequired: code === "store_epoch_mismatch"
      || code === "document_not_found"
      || code === "document_generation_mismatch"
      || code === "unsupported_document_schema"
      || code === "document_state_corrupt",
  };
};

export interface LoadedBlockDocument {
  readonly storeEpoch: string;
  readonly authority: DocumentAuthority;
  readonly head: DocumentHead;
  readonly document: Y.Doc;
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

export interface DocumentSyncStep {
  readonly storeEpoch: string;
  readonly head: DocumentHead;
  readonly update: Uint8Array;
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
    | DocumentRow
    | undefined;
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
  | "document_state_corrupt"
  | "invalid_document_update";

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
    throw validationFailure(code, "Card document failed schema validation", error);
  }
};

const assertNoPendingDependencies = (
  document: Y.Doc,
  code: "document_state_corrupt" | "document_update_missing_dependencies",
): void => {
  if (document.store.pendingStructs === null && document.store.pendingDs === null) {
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
    .prepare(`
      SELECT id
      FROM blocks
      WHERE containing_document_id = ? AND lifecycle = 'active'
    `)
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
  touchedBlockIds: readonly BlockId[],
  now: string,
): void => {
  const currentRows = database
    .prepare(`
      SELECT id, project_id, type, lifecycle, location_kind, containing_document_id
      FROM blocks
      WHERE containing_document_id = ?
    `)
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

  for (const touchedBlockId of touchedBlockIds) {
    if (touchedBlockId === row.owner_block_id) {
      continue;
    }
    const registered = readBlock.get(touchedBlockId) as
      | RegisteredBlockRow
      | undefined;
    if (
      registered?.project_id === row.project_id &&
      registered.location_kind === "document" &&
      registered.containing_document_id === row.document_id
    ) {
      continue;
    }
    throw new BlockDocumentStoreError(
      "invalid_document_update",
      `Touched Block ${touchedBlockId} does not belong to Document ${row.document_id}`,
    );
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

const loadDocumentFromRow = (
  database: Database.Database,
  row: DocumentRow,
): Y.Doc => {
  const document = new Y.Doc({ guid: row.document_id });
  try {
    const snapshot = database
      .prepare(`
        SELECT snapshot_seq, state_vector, snapshot_update, snapshot_hash, schema_version
        FROM document_snapshots
        WHERE document_id = ? AND generation = ? AND snapshot_seq <= ?
        ORDER BY snapshot_seq DESC
        LIMIT 1
      `)
      .get(row.document_id, row.generation, row.head_seq) as
      | DocumentSnapshotRow
      | undefined;
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
      .prepare(`
        SELECT seq, update_blob, update_hash
        FROM document_updates
        WHERE document_id = ? AND generation = ? AND seq > ? AND seq <= ?
        ORDER BY seq ASC
      `)
      .all(row.document_id, row.generation, snapshotSeq, row.head_seq) as
      readonly DocumentTailUpdateRow[];
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
    if (expectedSeq !== row.head_seq + 1) {
      throw new BlockDocumentStoreError(
        "document_state_corrupt",
        `Document ${row.document_id} update tail ends before head ${row.head_seq}`,
      );
    }

    assertNoPendingDependencies(document, "document_state_corrupt");
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

const findStoredUpdate = (
  database: Database.Database,
  documentId: DocumentId,
  updateId: string,
): StoredDocumentUpdateRow | undefined =>
  database
    .prepare(`
      SELECT
        generation, seq, client_session_id, base_head_seq,
        touched_block_ids_json, update_blob, update_hash
      FROM document_updates
      WHERE document_id = ? AND update_id = ?
    `)
    .get(documentId, updateId) as StoredDocumentUpdateRow | undefined;

const assertMatchingIdempotentUpdate = (
  stored: StoredDocumentUpdateRow,
  generation: number,
  update: Uint8Array,
  clientSessionId: string,
  baseHeadSeq: number,
  touchedBlockIdsJson: string,
): void => {
  if (stored.update_hash !== hashBytes(stored.update_blob)) {
    throw new BlockDocumentStoreError(
      "document_state_corrupt",
      "The stored document update checksum does not match its payload",
    );
  }
  if (
    stored.generation === generation &&
    stored.client_session_id === clientSessionId &&
    stored.base_head_seq === baseHeadSeq &&
    stored.touched_block_ids_json === touchedBlockIdsJson &&
    bytesEqual(stored.update_blob, update)
  ) {
    return;
  }

  throw new BlockDocumentStoreError(
    "update_id_collision",
    "The updateId is already committed with different request semantics",
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

export const getBlockDocumentProjectId = (
  database: Database.Database,
  documentId: DocumentId,
): string => {
  requireNonEmpty(documentId, "documentId");
  return readDocumentRow(database, documentId).project_id;
};

export const getBlockDocumentSyncStep = (
  database: Database.Database,
  documentId: DocumentId,
  clientStateVector: Uint8Array,
): DocumentSyncStep => {
  const loaded = loadBlockDocument(database, documentId);
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
  let genesisStateVector: Uint8Array;
  let genesisSnapshot: Uint8Array;
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
  } finally {
    genesisDocument.destroy();
  }

  const touchedBlockIdsJson = "[]";
  const updateHash = hashBytes(input.update);
  const snapshotHash = hashBytes(genesisSnapshot);
  const stateHash = snapshotHash;

  const initialize = database.transaction((): DocumentUpdateAck => {
    const storeEpoch = assertStoreEpoch(database, input.storeEpoch);
    const row = readDocumentRow(database, input.documentId);
    assertGeneration(row, input.generation);
    assertSupportedCardSchema(row);
    assertReadableCardOwner(row);

    const stored = findStoredUpdate(database, input.documentId, input.updateId);
    if (stored) {
      assertMatchingIdempotentUpdate(
        stored,
        input.generation,
        input.update,
        input.clientSessionId,
        0,
        touchedBlockIdsJson,
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
    reconcileDocumentBlocks(
      database,
      row,
      genesisBlocks,
      1,
      [],
      now,
    );
    database.prepare(`
      INSERT INTO document_updates (
        document_id, generation, seq, update_id, client_session_id,
        base_head_seq, touched_block_ids_json, update_blob, update_hash, committed_at
      ) VALUES (?, ?, 1, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      input.documentId,
      input.generation,
      input.updateId,
      input.clientSessionId,
      touchedBlockIdsJson,
      Buffer.from(input.update),
      updateHash,
      now,
    );
    database.prepare(`
      INSERT INTO document_snapshots (
        document_id, generation, snapshot_seq, state_vector,
        snapshot_update, snapshot_hash, schema_version, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      input.documentId,
      input.generation,
      Buffer.from(genesisStateVector),
      Buffer.from(genesisSnapshot),
      snapshotHash,
      row.schema_version,
      now,
    );
    database.prepare(`
      UPDATE documents
      SET head_seq = 1, state_vector = ?, state_hash = ?,
          readiness = 'ready', updated_at = ?
      WHERE id = ? AND generation = ? AND head_seq = 0 AND readiness = 'pending_genesis'
    `).run(
      Buffer.from(genesisStateVector),
      stateHash,
      now,
      input.documentId,
      input.generation,
    );

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

export const applyBlockDocumentUpdate = (
  database: Database.Database,
  input: ApplyDocumentUpdate,
): DocumentUpdateAck => {
  validateIncomingUpdate(input.update);
  requireNonEmpty(input.documentId, "documentId");
  requireNonEmpty(input.updateId, "updateId");
  requireNonEmpty(input.clientSessionId, "clientSessionId");
  const touchedBlockIds = validateTouchedBlockIds(input.touchedBlockIds);
  const touchedBlockIdsJson = JSON.stringify(touchedBlockIds);

  const apply = database.transaction((): DocumentUpdateAck => {
    const storeEpoch = assertStoreEpoch(database, input.storeEpoch);
    const row = readDocumentRow(database, input.documentId);
    assertReady(row);
    assertGeneration(row, input.generation);
    assertSupportedCardSchema(row);
    assertReadableCardOwner(row);
    if (input.baseHeadSeq > row.head_seq) {
      throw new BlockDocumentStoreError(
        "future_base_head",
        `Document ${input.documentId} is at head ${row.head_seq}, received base ${input.baseHeadSeq}`,
      );
    }

    const stored = findStoredUpdate(database, input.documentId, input.updateId);
    if (stored) {
      assertMatchingIdempotentUpdate(
        stored,
        input.generation,
        input.update,
        input.clientSessionId,
        input.baseHeadSeq,
        touchedBlockIdsJson,
      );
      return makeAck(
        row,
        storeEpoch,
        input.updateId,
        stored.seq,
        row.state_vector,
        true,
      );
    }

    assertWritableCardOwner(row);

    const document = loadDocumentFromRow(database, row);
    try {
      let blocks: readonly ScannedDocumentBlock[];
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
      reconcileDocumentBlocks(
        database,
        row,
        blocks,
        nextHeadSeq,
        touchedBlockIds,
        now,
      );
      database.prepare(`
        INSERT INTO document_updates (
          document_id, generation, seq, update_id, client_session_id,
          base_head_seq, touched_block_ids_json, update_blob, update_hash, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.documentId,
        input.generation,
        nextHeadSeq,
        input.updateId,
        input.clientSessionId,
        input.baseHeadSeq,
        touchedBlockIdsJson,
        Buffer.from(input.update),
        hashBytes(input.update),
        now,
      );
      database.prepare(`
        UPDATE documents
        SET head_seq = ?, state_vector = ?, state_hash = ?, updated_at = ?
        WHERE id = ? AND generation = ? AND head_seq = ?
      `).run(
        nextHeadSeq,
        Buffer.from(nextStateVector),
        nextStateHash,
        now,
        input.documentId,
        input.generation,
        row.head_seq,
      );

      return makeAck(
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
      );
    } finally {
      document.destroy();
    }
  });

  return apply.immediate();
};
