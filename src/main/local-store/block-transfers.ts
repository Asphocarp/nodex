import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import {
  BLOCK_TRANSFER_CONTRACT_VERSION,
  BlockTransferContractError,
  canonicalizeBlockTransferIntent,
  parseBlockTransferRequest,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferReceipt,
  type BlockTransferRequest,
} from "../../shared/block-transfer";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  stableStringifyDatabaseJson,
  type DatabaseMutationRequest,
  type TransferDatabaseMembershipOperation,
} from "../../shared/database-kernel";
import {
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  type DocumentBlockOperation,
  type DocumentOperationResult,
} from "../../shared/block-documents/document-operations";
import type { BlockTreeNode } from "../../shared/block-documents/block-document-codec";
import type {
  BlockLocation,
  RelocationDocumentCommit,
} from "../../shared/block-documents/contracts";
import {
  createCanonicalEmptyParagraphBlock,
  populateBlockDocumentBodyFromBlockTree,
} from "../../shared/block-documents/block-document-codec";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
} from "../../shared/block-documents/card-document";
import {
  BlockTransferCoercionError,
  classifyDatabaseTransferBlock,
  planDatabaseTransferCoercions,
} from "../../shared/block-transfer-coercion";
import {
  allocateBlockOwnershipCopyIdentities,
  planBlockOwnershipClosure,
  type BlockOwnershipClosure,
  type BlockOwnershipCopyIdentityMap,
} from "../../shared/block-ownership-copy-plan";
import { getBlockDocumentSchemaAdapter } from "../../shared/block-documents/document-schema-adapters";
import { planFractionalRank } from "../../shared/fractional-rank";
import { isCardStatus } from "../../shared/card-status";
import { applyDocumentOperationBatch } from "./block-document-operations";
import {
  initializeBlockDocumentGenesis,
  initializeCardDocumentGenesis,
} from "./block-document-store";
import {
  BlockRelocationStoreError,
  relocateBlocksAtomically,
} from "./block-relocations";
import { rebuildCardReadModelProjection } from "./card-read-store";
import {
  transitionCardDatabaseParent,
  type CardOffDatabaseParent,
} from "./database-kernel";
import { refreshScheduledCardIndexProjection } from "./scheduled-card-store";
import { cloneAuthoritativeCardInTransaction } from "./authoritative-card-clone";

export type BlockTransferFaultPoint =
  | "after_source_document"
  | "after_parent_transition"
  | "after_target_document"
  | "after_projections"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface ApplyBlockTransferOptions {
  readonly now?: () => string;
  readonly faultInjector?: (point: BlockTransferFaultPoint) => void;
}

interface BlockRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly location_revision: number;
}

interface StoredMutationRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly result_json: string;
  readonly change_log_seq: number | null;
}

interface StoredDocumentCommit {
  readonly documentId: string;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly updateId: string;
}

interface StoredTransferReceipt {
  readonly version: 1;
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly mode: "move" | "copy";
  readonly sourceRootBlockIds: readonly string[];
  readonly resultRootBlockIds: readonly string[];
  readonly copiedBlockIds: Readonly<Record<string, string>>;
  readonly finalLocations: Readonly<Record<string, BlockLocation>>;
  readonly finalLocationRevisions: Readonly<Record<string, number>>;
  readonly documentCommits: readonly StoredDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly changeLogSeq: number;
  readonly committedAt: string;
}

interface PromotionSource {
  readonly root: BlockTreeNode;
  readonly blockIds: readonly string[];
}

const MUTATION_KIND = "block_transfer";
const CHANGE_KIND = "block_transfer";

class BlockTransferRejection extends Error {
  constructor(readonly commandError: BlockTransferCommandError) {
    super(commandError.message);
    this.name = "BlockTransferRejection";
  }
}

const sha256 = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

const reject = (
  request: Pick<BlockTransferRequest, "operationId">,
  code: BlockTransferCommandError["code"],
  message: string,
  options: Pick<
    BlockTransferCommandError,
    "retryable" | "reloadRequired"
  > = { retryable: false, reloadRequired: false },
): never => {
  throw new BlockTransferRejection({
    code,
    message,
    operationId: request.operationId,
    retryable: options.retryable,
    reloadRequired: options.reloadRequired,
  });
};

const readStoreEpoch = (database: Database.Database): string | null =>
  (
    database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string } | undefined
  )?.store_epoch ?? null;

const readStoredMutation = (
  database: Database.Database,
  operationId: string,
): StoredMutationRow | null =>
  (database
    .prepare(
      `
      SELECT mutation_id, project_id, store_epoch, mutation_kind,
             request_hash, request_json, result_json, change_log_seq
      FROM block_mutations
      WHERE mutation_id = ?
    `,
    )
    .get(operationId) as StoredMutationRow | undefined) ?? null;

const readBlockRows = (
  database: Database.Database,
  request: BlockTransferRequest,
): readonly BlockRow[] => {
  const read = database.prepare(`
    SELECT id, project_id, type, lifecycle, location_kind,
           containing_document_id, containing_database_id, location_revision
    FROM blocks WHERE id = ?
  `);
  return request.rootBlockIds.map((blockId) => {
    const row = read.get(blockId) as BlockRow | undefined;
    if (!row) {
      return reject(
        request,
        "block_not_found",
        `Transferred Block does not exist: ${blockId}`,
      );
    }
    if (row.project_id !== request.projectId) {
      return reject(
        request,
        "source_parent_mismatch",
        `Block ${blockId} belongs to another Project`,
      );
    }
    if (row.lifecycle !== "active") {
      return reject(
        request,
        "block_not_active",
        `Block ${blockId} is not active`,
      );
    }
    if (row.location_revision !== request.expectedLocationRevisions[blockId]) {
      return reject(
        request,
        "location_revision_mismatch",
        `Block ${blockId} location revision is ${row.location_revision}; expected ${request.expectedLocationRevisions[blockId] ?? "missing"}`,
        { retryable: true, reloadRequired: true },
      );
    }
    return row;
  });
};

const assertSourceParent = (
  database: Database.Database,
  request: BlockTransferRequest,
  rows: readonly BlockRow[],
): void => {
  for (const row of rows) {
    const parentMatches = (() => {
      if (request.source.kind === "space") {
        return row.location_kind === "space";
      }
      if (request.source.kind === "document") {
        return (
          row.location_kind === "document" &&
          row.containing_document_id === request.source.documentId
        );
      }
      return (
        row.location_kind === "database" &&
        row.containing_database_id === request.source.databaseBlockId
      );
    })();
    if (!parentMatches) {
      reject(
        request,
        "source_parent_mismatch",
        `Block ${row.id} no longer belongs to the requested source parent`,
        { retryable: true, reloadRequired: true },
      );
    }
  }
  if (request.source.kind !== "database") return;
  const readMembership = database.prepare(`
    SELECT id, revision
    FROM database_memberships
    WHERE card_block_id = ? AND database_block_id = ?
      AND project_id = ? AND removed_at IS NULL
  `);
  for (const row of rows) {
    const expected = request.source.memberships[row.id];
    const actual = readMembership.get(
      row.id,
      request.source.databaseBlockId,
      request.projectId,
    ) as { readonly id: string; readonly revision: number } | undefined;
    if (
      expected &&
      actual?.id === expected.membershipId &&
      actual.revision === expected.revision
    ) {
      continue;
    }
    reject(
      request,
      "membership_revision_mismatch",
      `Database membership changed for Card ${row.id}`,
      { retryable: true, reloadRequired: true },
    );
  }
};

const requireCardRoots = (
  request: BlockTransferRequest,
  rows: readonly BlockRow[],
): void => {
  const unsupported = rows.find((row) => row.type !== "card");
  if (!unsupported) return;
  reject(
    request,
    "unsupported_transfer",
    `Moving ${unsupported.type} from ${request.source.kind} to ${request.target.kind} requires the Database coercion phase`,
  );
};

const deterministicSubOperationId = (
  requestHash: string,
  role: string,
): string => `block-transfer:${requestHash}:${role}`;

const cardDisplayHint = (
  database: Database.Database,
  cardId: string,
): string =>
  (
    database
      .prepare(
        `
        SELECT materialization.title
        FROM block_documents ownership
        JOIN document_materializations materialization
          ON materialization.document_id = ownership.document_id
        WHERE ownership.block_id = ?
      `,
      )
      .get(cardId) as { readonly title: string } | undefined
  )?.title ?? "Untitled";

const flattenBlockTreeIds = (root: BlockTreeNode): readonly string[] => [
  root.id,
  ...root.children.flatMap(flattenBlockTreeIds),
];

const findBlockTreeRoot = (
  blocks: readonly BlockTreeNode[],
  blockId: string,
): BlockTreeNode | null => {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const nested = findBlockTreeRoot(block.children, blockId);
    if (nested) return nested;
  }
  return null;
};

const readPromotionSource = (
  database: Database.Database,
  request: BlockTransferRequest,
): PromotionSource => {
  if (request.source.kind !== "document" || request.rootBlockIds.length !== 1) {
    return reject(
      request,
      "unsupported_transfer",
      "Database coercion currently requires one Document root per atomic transfer",
    );
  }
  const row = database
    .prepare(
      `SELECT materialization.block_tree_json
       FROM document_materializations materialization
       JOIN documents document ON document.id = materialization.document_id
       WHERE materialization.document_id = ?
         AND materialization.generation = ?
         AND materialization.projected_seq = ?`,
    )
    .get(
      request.source.documentId,
      request.source.generation,
      request.source.expectedHeadSeq,
    ) as { readonly block_tree_json: string } | undefined;
  if (!row) {
    return reject(
      request,
      "source_head_mismatch",
      "Source Document materialization does not match the requested head",
      { retryable: true, reloadRequired: true },
    );
  }
  const tree = JSON.parse(row.block_tree_json) as readonly BlockTreeNode[];
  const rootId = request.rootBlockIds[0];
  const root = rootId ? findBlockTreeRoot(tree, rootId) : null;
  if (!root) {
    return reject(
      request,
      "block_not_found",
      `Source Document does not contain root ${rootId ?? "missing"}`,
    );
  }
  return { root, blockIds: flattenBlockTreeIds(root) };
};

const insertDefaultIntrinsicCardProperties = (
  database: Database.Database,
  input: {
    readonly cardId: string;
    readonly projectId: string;
    readonly now: string;
  },
): void => {
  const values = [
    ["agent.blocked", "boolean", false],
    ["agent.status", "string", null],
    ["run.target", "string", "localProject"],
    ["run.localPath", "string", null],
    ["run.baseBranch", "string", null],
    ["run.worktreePath", "string", null],
    ["run.environmentPath", "string", null],
    ["schedule.isAllDay", "boolean", false],
    ["schedule.timezone", "string", null],
    ["recurrence.config", "json", null],
    ["reminders.config", "json", []],
  ] as const;
  const insert = database.prepare(`
    INSERT INTO block_properties (
      block_id, project_id, property_key, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  for (const [key, valueType, value] of values) {
    insert.run(
      input.cardId,
      input.projectId,
      key,
      valueType,
      JSON.stringify(value),
      input.now,
    );
  }
};

const stagePromotedCardDocument = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  input: {
    readonly source: PromotionSource;
    readonly title: string;
    readonly bodyRootId: string;
    readonly now: string;
  },
): { readonly documentId: string; readonly body: BlockTreeNode } => {
  const cardId = input.source.root.id;
  const documentId = `document:${cardId}`;
  const identityCollision = database
    .prepare("SELECT 1 AS present FROM documents WHERE id = ?")
    .get(documentId);
  if (identityCollision) {
    return reject(
      request,
      "invalid_target",
      `Promoted Card Document identity already exists: ${documentId}`,
    );
  }
  const promoted = database
    .prepare(
      `UPDATE blocks
       SET type = 'card', metadata_revision = metadata_revision + 1,
           updated_at = ?
       WHERE id = ? AND project_id = ? AND lifecycle = 'active'
         AND type = ? AND location_kind = 'document'
         AND containing_document_id = ?`,
    )
    .run(
      input.now,
      cardId,
      request.projectId,
      input.source.root.type,
      request.source.kind === "document" ? request.source.documentId : null,
    );
  if (promoted.changes !== 1) {
    return reject(
      request,
      "source_parent_mismatch",
      `Block ${cardId} changed before Card promotion`,
      { retryable: true, reloadRequired: true },
    );
  }
  database
    .prepare(
      `INSERT INTO documents (
         id, project_id, generation, head_seq, schema_key, schema_version,
         state_vector, state_hash, readiness, authority,
         created_at, updated_at
       ) VALUES (?, ?, 1, 0, ?, ?, X'', '',
                 'pending_genesis', 'legacy_shadow', ?, ?)`,
    )
    .run(
      documentId,
      request.projectId,
      CARD_DOCUMENT_SCHEMA_KEY,
      CARD_DOCUMENT_SCHEMA_VERSION,
      input.now,
      input.now,
    );
  database
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(cardId, documentId, request.projectId, input.now);
  const genesis = createCardDocument({
    documentId,
    initialTitle: input.title,
  });
  try {
    initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch: request.storeEpoch,
      generation: 1,
      updateId: deterministicSubOperationId(requestHash, "promotion-genesis"),
      clientSessionId: request.clientSessionId ?? "block-transfer:promotion",
      update: Y.encodeStateAsUpdate(genesis.document),
      finalAuthority: "ydoc_primary",
    });
  } finally {
    genesis.document.destroy();
  }
  insertDefaultIntrinsicCardProperties(database, {
    cardId,
    projectId: request.projectId,
    now: input.now,
  });
  return {
    documentId,
    body: { ...input.source.root, id: input.bodyRootId },
  };
};

const stageWrapperCardDocument = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  input: {
    readonly cardId: string;
    readonly title: string;
    readonly now: string;
  },
): string => {
  const documentId = `document:${input.cardId}`;
  const collision = database
    .prepare(
      `SELECT 'block' AS kind FROM blocks WHERE id = ?
       UNION ALL SELECT 'document' FROM documents WHERE id = ? LIMIT 1`,
    )
    .get(input.cardId, documentId) as { readonly kind: string } | undefined;
  if (collision) {
    return reject(
      request,
      "invalid_target",
      `Wrapper Card identity collides with an existing ${collision.kind}`,
    );
  }
  database
    .prepare(
      `INSERT INTO blocks (
         id, project_id, type, lifecycle, location_kind,
         containing_document_id, containing_database_id,
         location_revision, metadata_revision, created_at, updated_at
       ) VALUES (?, ?, 'card', 'active', 'space', NULL, NULL, 1, 1, ?, ?)`,
    )
    .run(input.cardId, request.projectId, input.now, input.now);
  database
    .prepare(
      `INSERT INTO documents (
         id, project_id, generation, head_seq, schema_key, schema_version,
         state_vector, state_hash, readiness, authority,
         created_at, updated_at
       ) VALUES (?, ?, 1, 0, ?, ?, X'', '',
                 'pending_genesis', 'legacy_shadow', ?, ?)`,
    )
    .run(
      documentId,
      request.projectId,
      CARD_DOCUMENT_SCHEMA_KEY,
      CARD_DOCUMENT_SCHEMA_VERSION,
      input.now,
      input.now,
    );
  database
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.cardId, documentId, request.projectId, input.now);
  const genesis = createCardDocument({
    documentId,
    initialTitle: input.title,
  });
  try {
    initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch: request.storeEpoch,
      generation: 1,
      updateId: deterministicSubOperationId(
        requestHash,
        `wrapper-genesis:${sha256(input.cardId)}`,
      ),
      clientSessionId: request.clientSessionId ?? "block-transfer:wrapper",
      update: Y.encodeStateAsUpdate(genesis.document),
      finalAuthority: "ydoc_primary",
    });
  } finally {
    genesis.document.destroy();
  }
  insertDefaultIntrinsicCardProperties(database, {
    cardId: input.cardId,
    projectId: request.projectId,
    now: input.now,
  });
  return documentId;
};

const readDocumentCommit = (
  database: Database.Database,
  result: DocumentOperationResult,
): RelocationDocumentCommit => {
  const row = database
    .prepare(
      `
      SELECT committed_update.update_id, committed_update.update_blob,
             document.state_vector
      FROM document_updates committed_update
      JOIN documents document ON document.id = committed_update.document_id
      WHERE committed_update.document_id = ?
        AND committed_update.generation = ? AND committed_update.seq = ?
    `,
    )
    .get(result.documentId, result.generation, result.headSeq) as
    | {
        readonly update_id: string;
        readonly update_blob: Uint8Array;
        readonly state_vector: Uint8Array;
      }
    | undefined;
  if (!row) {
    throw new Error(
      `Document ${result.documentId} committed without update evidence`,
    );
  }
  return {
    documentId: result.documentId,
    generation: result.generation,
    baseHeadSeq: result.baseHeadSeq,
    headSeq: result.headSeq,
    updateId: row.update_id,
    update: new Uint8Array(row.update_blob),
    stateVector: new Uint8Array(row.state_vector),
  };
};

const readDocumentCommitAt = (
  database: Database.Database,
  documentId: string,
  generation: number,
  headSeq: number,
): RelocationDocumentCommit => {
  const row = database
    .prepare(
      `SELECT committed_update.update_id, committed_update.base_head_seq,
              committed_update.update_blob, document.state_vector
       FROM document_updates committed_update
       JOIN documents document ON document.id = committed_update.document_id
       WHERE committed_update.document_id = ?
         AND committed_update.generation = ? AND committed_update.seq = ?`,
    )
    .get(documentId, generation, headSeq) as {
    readonly update_id: string;
    readonly base_head_seq: number;
    readonly update_blob: Uint8Array;
    readonly state_vector: Uint8Array;
  } | undefined;
  if (!row) throw new Error(`Document ${documentId} has no commit at ${headSeq}`);
  return {
    documentId,
    generation,
    baseHeadSeq: row.base_head_seq,
    headSeq,
    updateId: row.update_id,
    update: new Uint8Array(row.update_blob),
    stateVector: new Uint8Array(row.state_vector),
  };
};

const runDocumentBatch = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  input: {
    readonly role: string;
    readonly documentId: string;
    readonly generation: number;
    readonly expectedHeadSeq: number;
    readonly operations: readonly DocumentBlockOperation[];
    readonly stagedOwnerIds?: readonly string[];
    readonly stagedReparentedBlockIds?: readonly string[];
    readonly preserveRemovedOwnerIds?: readonly string[];
  },
): RelocationDocumentCommit => {
  const result = applyDocumentOperationBatch(
    database,
    {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      mutationId: deterministicSubOperationId(requestHash, input.role),
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      clientSessionId: request.clientSessionId,
      actor: request.actor,
      documentId: input.documentId,
      generation: input.generation,
      expectedHeadSeq: input.expectedHeadSeq,
      operations: input.operations,
    },
    {
      ...(input.stagedOwnerIds
        ? { allowStagedDocumentBearingBlockIds: input.stagedOwnerIds }
        : {}),
      ...(input.stagedReparentedBlockIds
        ? { allowStagedReparentedBlockIds: input.stagedReparentedBlockIds }
        : {}),
      ...(input.preserveRemovedOwnerIds
        ? { preserveRemovedBlockIds: input.preserveRemovedOwnerIds }
        : {}),
      writeFence: {
        leaseId: deterministicSubOperationId(requestHash, `${input.role}:lease`),
        documentId: input.documentId,
        generation: input.generation,
        headSeq: input.expectedHeadSeq,
      },
    },
  );
  if (result.ok) return readDocumentCommit(database, result.value);
  const code =
    result.error.code === "document_head_conflict"
      ? input.role === "source-document"
        ? "source_head_mismatch"
        : "target_head_mismatch"
      : result.error.code === "ancestor_cycle"
        ? "transfer_cycle"
        : result.error.code === "document_not_found"
          ? "target_not_found"
          : "invalid_target";
  return reject(request, code, result.error.message, {
    retryable: result.error.retryable,
    reloadRequired:
      result.error.code === "document_head_conflict" ||
      result.error.code === "document_generation_conflict",
  });
};

const sourceDeleteOperations = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
): readonly DocumentBlockOperation[] => {
  if (request.source.kind !== "document") return [];
  return sourceDeleteOperationsForForest(
    database,
    request,
    requestHash,
    request.rootBlockIds,
    request.rootBlockIds,
  );
};

const sourceDeleteOperationsForForest = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  rootBlockIds: readonly string[],
  movedBlockIds: readonly string[],
): readonly DocumentBlockOperation[] => {
  if (request.source.kind !== "document") return [];
  const count = database
    .prepare(
      "SELECT COUNT(*) AS count FROM document_block_index WHERE document_id = ?",
    )
    .get(request.source.documentId) as { readonly count: number };
  const deletes: DocumentBlockOperation[] = rootBlockIds.map(
    (blockId) => ({ kind: "delete_block", blockId }),
  );
  if (count.count !== movedBlockIds.length) return deletes;
  return [
    ...deletes,
    {
      kind: "insert_block",
      block: createCanonicalEmptyParagraphBlock(
        `block:transfer-empty:${sha256(`${requestHash}\0source`)}`,
      ),
    },
  ];
};

const promoteDocumentRootToDatabaseCard = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  rows: readonly BlockRow[],
  now: string,
): {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
} => {
  if (request.source.kind !== "document" || request.target.kind !== "database") {
    return reject(
      request,
      "unsupported_transfer",
      "Block promotion requires a Document source and Database target",
    );
  }
  const source = readPromotionSource(database, request);
  let plan;
  try {
    plan = planDatabaseTransferCoercions({
      roots: [
        {
          blockId: source.root.id,
          blockType: source.root.type,
          text: database
            .prepare(
              "SELECT text FROM document_block_index WHERE document_id = ? AND block_id = ?",
            )
            .pluck()
            .get(request.source.documentId, source.root.id) as string,
        },
      ],
      allocateWrapperCardId: (sourceBlockId) =>
        `card:transfer:${sha256(`${requestHash}\0wrapper\0${sourceBlockId}`)}`,
    })[0];
  } catch (error) {
    if (error instanceof BlockTransferCoercionError) {
      return reject(request, "unsupported_transfer", error.message);
    }
    throw error;
  }
  if (!plan || plan.kind !== "promote_in_place") {
    return reject(
      request,
      "unsupported_transfer",
      `${source.root.type} requires wrapper Card compilation`,
    );
  }
  const sourceCommit = runDocumentBatch(database, request, requestHash, {
    role: "source-document",
    documentId: request.source.documentId,
    generation: request.source.generation,
    expectedHeadSeq: request.source.expectedHeadSeq,
    operations: sourceDeleteOperationsForForest(
      database,
      request,
      requestHash,
      [source.root.id],
      source.blockIds,
    ),
    preserveRemovedOwnerIds: source.blockIds,
  });
  const bodyRootId = `block:promoted-body:${sha256(
    `${requestHash}\0${source.root.id}`,
  )}`;
  const staged = stagePromotedCardDocument(database, request, requestHash, {
    source,
    title: plan.title,
    bodyRootId,
    now,
  });
  const descendants = source.blockIds.filter(
    (blockId) => blockId !== source.root.id,
  );
  const moveDescendant = database.prepare(`
    UPDATE blocks
    SET containing_document_id = ?, location_revision = location_revision + 1,
        updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = 'active'
      AND location_kind = 'document' AND containing_document_id = ?
  `);
  for (const blockId of descendants) {
    const moved = moveDescendant.run(
      staged.documentId,
      now,
      blockId,
      request.projectId,
      request.source.documentId,
    );
    if (moved.changes !== 1) {
      return reject(
        request,
        "source_parent_mismatch",
        `Descendant Block ${blockId} changed during Card promotion`,
        { retryable: true, reloadRequired: true },
      );
    }
  }
  const bodyCommit = runDocumentBatch(database, request, requestHash, {
    role: "promotion-body",
    documentId: staged.documentId,
    generation: 1,
    expectedHeadSeq: 1,
    operations: [{ kind: "insert_block", block: staged.body }],
    stagedReparentedBlockIds: descendants,
  });
  const affectedDatabaseBlockIds = transitionCardParents(
    database,
    request,
    requestHash,
    rows,
    now,
  );
  return {
    documentCommits: [sourceCommit, bodyCommit],
    affectedDatabaseBlockIds,
    resultBlockIds: [source.root.id, bodyRootId, ...descendants],
  };
};

const wrapDocumentRootInDatabaseCard = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
): {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
  readonly resultRootBlockIds: readonly string[];
} => {
  if (request.source.kind !== "document" || request.target.kind !== "database") {
    return reject(
      request,
      "unsupported_transfer",
      "Wrapper coercion requires a Document source and Database target",
    );
  }
  const source = readPromotionSource(database, request);
  let plan;
  try {
    const text = database
      .prepare(
        "SELECT text FROM document_block_index WHERE document_id = ? AND block_id = ?",
      )
      .pluck()
      .get(request.source.documentId, source.root.id) as string;
    plan = planDatabaseTransferCoercions({
      roots: [
        {
          blockId: source.root.id,
          blockType: source.root.type,
          text,
        },
      ],
      allocateWrapperCardId: (sourceBlockId) =>
        `card:transfer:${sha256(`${requestHash}\0wrapper\0${sourceBlockId}`)}`,
    })[0];
  } catch (error) {
    if (error instanceof BlockTransferCoercionError) {
      return reject(request, "unsupported_transfer", error.message);
    }
    throw error;
  }
  if (!plan || plan.kind !== "wrap_in_card") {
    return reject(
      request,
      "unsupported_transfer",
      `${source.root.type} does not require a wrapper Card`,
    );
  }
  const sourceCommit = runDocumentBatch(database, request, requestHash, {
    role: "source-document",
    documentId: request.source.documentId,
    generation: request.source.generation,
    expectedHeadSeq: request.source.expectedHeadSeq,
    operations: sourceDeleteOperationsForForest(
      database,
      request,
      requestHash,
      [source.root.id],
      source.blockIds,
    ),
    preserveRemovedOwnerIds: source.blockIds,
  });
  const wrapperDocumentId = stageWrapperCardDocument(
    database,
    request,
    requestHash,
    { cardId: plan.cardBlockId, title: plan.title, now },
  );
  const moveSourceBlock = database.prepare(`
    UPDATE blocks
    SET containing_document_id = ?, location_revision = location_revision + 1,
        updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = 'active'
      AND location_kind = 'document' AND containing_document_id = ?
  `);
  for (const blockId of source.blockIds) {
    const moved = moveSourceBlock.run(
      wrapperDocumentId,
      now,
      blockId,
      request.projectId,
      request.source.documentId,
    );
    if (moved.changes !== 1) {
      return reject(
        request,
        "source_parent_mismatch",
        `Wrapped Block ${blockId} changed during Card creation`,
        { retryable: true, reloadRequired: true },
      );
    }
  }
  const bodyCommit = runDocumentBatch(database, request, requestHash, {
    role: "wrapper-body",
    documentId: wrapperDocumentId,
    generation: 1,
    expectedHeadSeq: 1,
    operations: [{ kind: "insert_block", block: source.root }],
    stagedReparentedBlockIds: source.blockIds,
  });
  const wrapperRow = database
    .prepare(
      `SELECT id, project_id, type, lifecycle, location_kind,
              containing_document_id, containing_database_id,
              location_revision
       FROM blocks WHERE id = ?`,
    )
    .get(plan.cardBlockId) as BlockRow;
  const affectedDatabaseBlockIds = transitionCardParents(
    database,
    request,
    requestHash,
    [wrapperRow],
    now,
  );
  return {
    documentCommits: [sourceCommit, bodyCommit],
    affectedDatabaseBlockIds,
    resultBlockIds: [plan.cardBlockId, ...source.blockIds],
    resultRootBlockIds: [plan.cardBlockId],
  };
};

const remapCopiedBlockTree = (
  blocks: readonly BlockTreeNode[],
  blockIds: Readonly<Record<string, string>>,
): readonly BlockTreeNode[] =>
  blocks.map((block) => {
    const targetId = blockIds[block.id];
    if (!targetId) {
      throw new Error(`Ownership copy plan omitted Block ${block.id}`);
    }
    return {
      ...block,
      id: targetId,
      // Props/content are semantic copies. Reference target IDs deliberately
      // remain unchanged because they are not ownership edges.
      children: remapCopiedBlockTree(block.children, blockIds),
    };
  });

const stageNestedOwnershipClosure = (
  database: Database.Database,
  request: BlockTransferRequest,
  closure: BlockOwnershipClosure,
  identities: BlockOwnershipCopyIdentityMap,
  rootDocumentId: string,
  createdAt: string,
): void => {
  const readOwner = database.prepare(`
    SELECT type, lifecycle, containing_document_id
    FROM blocks WHERE id = ? AND project_id = ?
  `);
  const insertOwner = database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', 'document', ?, NULL, 1, 1, ?, ?)
  `);
  const insertDocument = database.prepare(`
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, state_hash, readiness, authority, created_at, updated_at
    ) VALUES (?, ?, 1, 0, ?, ?, X'', '',
              'pending_genesis', 'legacy_shadow', ?, ?)
  `);
  const insertOwnership = database.prepare(`
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const copyProperty = database.prepare(`
    INSERT INTO block_properties (
      block_id, project_id, property_key, value_type,
      value_json, revision, updated_at
    )
    SELECT ?, project_id, property_key, value_type,
           value_json, 1, ?
    FROM block_properties
    WHERE block_id = ? AND project_id = ?
  `);
  for (const document of closure.documents) {
    if (document.documentId === rootDocumentId) continue;
    const sourceOwner = readOwner.get(
      document.ownerBlockId,
      request.projectId,
    ) as
      | {
          readonly type: string;
          readonly lifecycle: string;
          readonly containing_document_id: string | null;
        }
      | undefined;
    const targetOwnerId = identities.blockIds[document.ownerBlockId];
    const targetDocumentId = identities.documentIds[document.documentId];
    const targetContainingDocumentId = sourceOwner?.containing_document_id
      ? identities.documentIds[sourceOwner.containing_document_id]
      : undefined;
    if (
      !sourceOwner ||
      sourceOwner.lifecycle !== "active" ||
      !targetOwnerId ||
      !targetDocumentId ||
      !targetContainingDocumentId
    ) {
      return reject(
        request,
        "recovery_required",
        `Nested owner ${document.ownerBlockId} has incomplete copy coordinates`,
      );
    }
    const collision = database
      .prepare(
        `SELECT 'block' AS kind FROM blocks WHERE id = ?
         UNION ALL SELECT 'document' FROM documents WHERE id = ? LIMIT 1`,
      )
      .get(targetOwnerId, targetDocumentId);
    if (collision) {
      return reject(
        request,
        "invalid_target",
        `Nested ownership copy identity already exists for ${document.ownerBlockId}`,
      );
    }
    insertOwner.run(
      targetOwnerId,
      request.projectId,
      sourceOwner.type,
      targetContainingDocumentId,
      createdAt,
      createdAt,
    );
    insertDocument.run(
      targetDocumentId,
      request.projectId,
      document.schemaKey,
      document.schemaVersion,
      createdAt,
      createdAt,
    );
    insertOwnership.run(
      targetOwnerId,
      targetDocumentId,
      request.projectId,
      createdAt,
    );
    copyProperty.run(
      targetOwnerId,
      createdAt,
      document.ownerBlockId,
      request.projectId,
    );
  }
};

const initializeNestedOwnershipDocuments = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  closure: BlockOwnershipClosure,
  identities: BlockOwnershipCopyIdentityMap,
  rootDocumentId: string,
): readonly RelocationDocumentCommit[] => {
  const commits: RelocationDocumentCommit[] = [];
  for (const sourceDocument of closure.documents) {
    if (sourceDocument.documentId === rootDocumentId) continue;
    const targetDocumentId = identities.documentIds[sourceDocument.documentId];
    if (!targetDocumentId) {
      throw new Error(
        `Ownership copy plan omitted Document ${sourceDocument.documentId}`,
      );
    }
    const adapter = getBlockDocumentSchemaAdapter({
      ownerType:
        closure.blocks.find(
          (block) => block.blockId === sourceDocument.ownerBlockId,
        )?.blockType ?? "",
      schemaKey: sourceDocument.schemaKey,
      schemaVersion: sourceDocument.schemaVersion,
    });
    if (adapter.contentModel !== "block_tree") {
      return reject(
        request,
        "unsupported_transfer",
        `Scene Document ${sourceDocument.documentId} needs its registered Copy adapter`,
      );
    }
    const materialization = database
      .prepare(
        `SELECT materialization.title, materialization.block_tree_json
         FROM document_materializations materialization
         JOIN documents document ON document.id = materialization.document_id
         WHERE materialization.document_id = ?
           AND materialization.generation = document.generation
           AND materialization.projected_seq = document.head_seq`,
      )
      .get(sourceDocument.documentId) as
      | { readonly title: string; readonly block_tree_json: string }
      | undefined;
    if (!materialization) {
      return reject(
        request,
        "recovery_required",
        `Owned Document ${sourceDocument.documentId} lacks a current materialization`,
      );
    }
    const envelope = adapter.create(targetDocumentId);
    try {
      populateBlockDocumentBodyFromBlockTree(
        envelope.body,
        remapCopiedBlockTree(
          JSON.parse(materialization.block_tree_json) as readonly BlockTreeNode[],
          identities.blockIds,
        ),
      );
      if (envelope.kind === "card") {
        envelope.title.insert(0, materialization.title);
      }
      const updateId = deterministicSubOperationId(
        requestHash,
        `nested-genesis:${sha256(sourceDocument.documentId)}`,
      );
      const ack = initializeBlockDocumentGenesis(database, {
        documentId: targetDocumentId,
        storeEpoch: request.storeEpoch,
        generation: 1,
        updateId,
        clientSessionId:
          request.clientSessionId ?? "block-transfer:recursive-copy",
        update: Y.encodeStateAsUpdate(envelope.document),
        finalAuthority: "ydoc_primary",
      });
      commits.push(
        readDocumentCommitAt(
          database,
          targetDocumentId,
          1,
          ack.headSeq,
        ),
      );
    } finally {
      envelope.document.destroy();
    }
  }
  return commits;
};

const copyDatabaseCard = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
): {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
  readonly resultRootBlockIds: readonly string[];
  readonly copiedBlockIds: Readonly<Record<string, string>>;
} => {
  if (
    request.source.kind !== "database" ||
    request.rootBlockIds.length !== 1
  ) {
    return reject(
      request,
      "unsupported_transfer",
      "Recursive Copy compilation currently requires one Database Card root",
    );
  }
  const sourceCardId = request.rootBlockIds[0];
  if (!sourceCardId) {
    return reject(request, "block_not_found", "Copy root is missing");
  }
  const closure = planBlockOwnershipClosure(
    {
      readBlock: (blockId) =>
        (database
          .prepare(
            `SELECT id AS blockId, type AS blockType,
                    containing_document_id AS containingDocumentId
             FROM blocks WHERE id = ? AND project_id = ? AND lifecycle = 'active'`,
          )
          .get(blockId, request.projectId) as
          | {
              readonly blockId: string;
              readonly blockType: string;
              readonly containingDocumentId: string | null;
            }
          | undefined) ?? null,
      readOwnedDocument: (ownerBlockId) =>
        (database
          .prepare(
            `SELECT document.id AS documentId,
                    ownership.block_id AS ownerBlockId,
                    document.schema_key AS schemaKey,
                    document.schema_version AS schemaVersion
             FROM block_documents ownership
             JOIN documents document ON document.id = ownership.document_id
             WHERE ownership.block_id = ? AND ownership.project_id = ?
               AND document.readiness = 'ready'
               AND document.authority = 'ydoc_primary'`,
          )
          .get(ownerBlockId, request.projectId) as
          | {
              readonly documentId: string;
              readonly ownerBlockId: string;
              readonly schemaKey: string;
              readonly schemaVersion: number;
            }
          | undefined) ?? null,
      readDocumentBlocks: (documentId) =>
        database
          .prepare(
            `SELECT block.id AS blockId, block.type AS blockType,
                    block.containing_document_id AS containingDocumentId
             FROM document_block_index block_index
             JOIN blocks block ON block.id = block_index.block_id
             WHERE block_index.document_id = ? AND block.project_id = ?
             ORDER BY block_index.ordinal, block.id`,
          )
          .all(documentId, request.projectId) as readonly {
          readonly blockId: string;
          readonly blockType: string;
          readonly containingDocumentId: string | null;
        }[],
    },
    [sourceCardId],
  );
  const allocatedIdentities = allocateBlockOwnershipCopyIdentities(
    request.operationId,
    closure,
  );
  const newCardId = allocatedIdentities.blockIds[sourceCardId];
  if (!newCardId) throw new Error("Copy identity plan omitted its root Card");
  const rootOwnedDocument = closure.documents.find(
    (document) => document.ownerBlockId === sourceCardId,
  );
  if (!rootOwnedDocument) {
    return reject(
      request,
      "recovery_required",
      `Card ${sourceCardId} has no owned Document in its closure`,
    );
  }
  const identities: BlockOwnershipCopyIdentityMap = {
    blockIds: allocatedIdentities.blockIds,
    documentIds: {
      ...allocatedIdentities.documentIds,
      [rootOwnedDocument.documentId]: `document:${newCardId}`,
    },
  };
  const source = database
    .prepare(
      `SELECT membership.database_block_id, membership.id AS membership_id,
              position.rank_key,
              status_value.value_json AS status_json
       FROM database_memberships membership
       JOIN database_views view
         ON view.database_block_id = membership.database_block_id
        AND view.project_id = membership.project_id
        AND view.is_primary = 1
       JOIN database_view_positions position
         ON position.view_id = view.id
        AND position.block_id = membership.card_block_id
       JOIN database_properties status_property
         ON status_property.database_block_id = membership.database_block_id
        AND status_property.project_id = membership.project_id
        AND status_property.key = 'status'
        AND status_property.lifecycle = 'active'
       JOIN database_property_values status_value
         ON status_value.membership_id = membership.id
        AND status_value.property_id = status_property.id
       WHERE membership.card_block_id = ? AND membership.project_id = ?
         AND membership.removed_at IS NULL`,
    )
    .get(sourceCardId, request.projectId) as {
    readonly database_block_id: string;
    readonly membership_id: string;
    readonly rank_key: string;
    readonly status_json: string;
  } | undefined;
  if (!source) {
    return reject(
      request,
      "source_parent_mismatch",
      `Card ${sourceCardId} has no complete source Database placement`,
    );
  }
  const sourceStatus = JSON.parse(source.status_json) as unknown;
  if (!isCardStatus(sourceStatus)) {
    return reject(
      request,
      "recovery_required",
      `Card ${sourceCardId} has an invalid source status`,
    );
  }
  const allocatedContentIds = (
    database
      .prepare(
        `SELECT block_id FROM document_block_index
         WHERE document_id = ? ORDER BY ordinal, block_id`,
      )
      .pluck()
      .all(rootOwnedDocument.documentId) as string[]
  )
    .map((blockId) => identities.blockIds[blockId])
    .filter((blockId): blockId is string => typeof blockId === "string");
  let allocationIndex = 0;
  const cloned = cloneAuthoritativeCardInTransaction(
    database,
    {
      projectId: request.projectId,
      sourceCardId,
      newCardId,
      lifecycle: "active",
      status: sourceStatus,
      primaryViewRankKey: source.rank_key,
      operationId: deterministicSubOperationId(requestHash, "clone-card"),
      clientSessionId: request.clientSessionId,
      actor: request.actor,
      createdAt: now,
    },
    {
      allocateBlockId: () => {
        const blockId = allocatedContentIds[allocationIndex];
        allocationIndex += 1;
        if (blockId) return blockId;
        throw new Error("Copy identity plan exhausted Block IDs");
      },
      stageNestedOwnership: ({ createdAt }) =>
        stageNestedOwnershipClosure(
          database,
          request,
          closure,
          identities,
          rootOwnedDocument.documentId,
          createdAt,
        ),
    },
  );
  const nestedDocumentCommits = initializeNestedOwnershipDocuments(
    database,
    request,
    requestHash,
    closure,
    identities,
    rootOwnedDocument.documentId,
  );
  const cloneRow = database
    .prepare(
      `SELECT id, project_id, type, lifecycle, location_kind,
              containing_document_id, containing_database_id,
              location_revision
       FROM blocks WHERE id = ?`,
    )
    .get(newCardId) as BlockRow;
  let affectedDatabaseBlockIds: readonly string[] = [
    source.database_block_id,
  ];
  const sameDatabaseTarget =
    request.target.kind === "database" &&
    request.target.databaseBlockId === source.database_block_id;
  const copyPlacementRequest: BlockTransferRequest = {
    ...request,
    rootBlockIds: [newCardId],
    expectedLocationRevisions: { [newCardId]: 1 },
    source: {
      kind: "database",
      databaseBlockId: source.database_block_id,
      memberships: {
        [newCardId]: { membershipId: cloned.membershipId, revision: 1 },
      },
    },
  };
  if (!sameDatabaseTarget) {
    affectedDatabaseBlockIds = uniqueSorted([
      ...affectedDatabaseBlockIds,
      ...transitionCardParents(
        database,
        copyPlacementRequest,
        requestHash,
        [cloneRow],
        now,
      ),
    ]);
  }
  const documentCommits: RelocationDocumentCommit[] = [
    readDocumentCommitAt(database, cloned.documentId, 1, cloned.documentHeadSeq),
    ...nestedDocumentCommits,
  ];
  if (request.target.kind === "document") {
    documentCommits.push(
      runDocumentBatch(database, copyPlacementRequest, requestHash, {
        role: "copy-target-document",
        documentId: request.target.documentId,
        generation: request.target.generation,
        expectedHeadSeq: request.target.expectedHeadSeq,
        operations: [
          {
            kind: "insert_block",
            block: {
              id: newCardId,
              type: "card",
              props: {
                displayHint: cardDisplayHint(database, newCardId),
              },
              children: [],
            },
            ...(request.target.parentBlockId
              ? { parentBlockId: request.target.parentBlockId }
              : {}),
            ...(request.target.beforeBlockId
              ? { beforeBlockId: request.target.beforeBlockId }
              : {}),
          },
        ],
        stagedOwnerIds: [newCardId],
      }),
    );
  }
  return {
    documentCommits,
    affectedDatabaseBlockIds,
    resultBlockIds: Object.values(identities.blockIds),
    resultRootBlockIds: [newCardId],
    copiedBlockIds: identities.blockIds,
  };
};

const allocateSpacePlacement = (
  database: Database.Database,
  request: BlockTransferRequest,
  blockId: string,
  beforeBlockId: string | undefined,
  now: string,
): void => {
  const items = database
    .prepare(
      `
      SELECT placement.block_id AS id, placement.rank_key AS rankKey
      FROM top_level_block_placements placement
      JOIN blocks block ON block.id = placement.block_id
      WHERE placement.project_id = ? AND block.lifecycle <> 'deleted'
      ORDER BY placement.rank_key, placement.block_id
    `,
    )
    .all(request.projectId) as readonly {
    readonly id: string;
    readonly rankKey: string;
  }[];
  const plan = (() => {
    try {
      return planFractionalRank({
        items,
        targetId: blockId,
        ...(beforeBlockId ? { beforeId: beforeBlockId } : {}),
      });
    } catch (error) {
      return reject(
        request,
        "invalid_target",
        error instanceof Error ? error.message : String(error),
      );
    }
  })();
  for (const [id, rankKey] of plan.rebalancedRankKeys) {
    database
      .prepare(
        `UPDATE top_level_block_placements
         SET rank_key = ?, updated_at = ?
         WHERE block_id = ? AND project_id = ?`,
      )
      .run(rankKey, now, id, request.projectId);
  }
  database
    .prepare(
      `INSERT INTO top_level_block_placements
       (block_id, project_id, rank_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(blockId, request.projectId, plan.rankKey, now, now);
};

const updateCardParentWithoutDatabase = (
  database: Database.Database,
  request: BlockTransferRequest,
  row: BlockRow,
  now: string,
): void => {
  database
    .prepare(
      "DELETE FROM top_level_block_placements WHERE block_id = ? AND project_id = ?",
    )
    .run(row.id, request.projectId);
  const target = request.target;
  if (target.kind === "database") {
    throw new Error("Database target must use the membership transition");
  }
  const updated = database
    .prepare(
      `
      UPDATE blocks
      SET location_kind = ?, containing_document_id = ?,
          containing_database_id = NULL,
          location_revision = location_revision + 1,
          metadata_revision = metadata_revision + 1,
          updated_at = ?
      WHERE id = ? AND project_id = ? AND type = 'card'
        AND lifecycle = 'active' AND location_revision = ?
    `,
    )
    .run(
      target.kind,
      target.kind === "document" ? target.documentId : null,
      now,
      row.id,
      request.projectId,
      row.location_revision,
    );
  if (updated.changes !== 1) {
    reject(
      request,
      "location_revision_mismatch",
      `Card ${row.id} moved while committing its parent transition`,
      { retryable: true, reloadRequired: true },
    );
  }
  if (target.kind === "space") {
    allocateSpacePlacement(
      database,
      request,
      row.id,
      target.beforeBlockId,
      now,
    );
  }
};

const databaseTransitionRequest = (
  request: BlockTransferRequest,
  requestHash: string,
  row: BlockRow,
): DatabaseMutationRequest & {
  readonly operation: TransferDatabaseMembershipOperation;
} => {
  const sourceMembership =
    request.source.kind === "database"
      ? request.source.memberships[row.id]
      : undefined;
  const target = request.target.kind === "database" ? request.target : null;
  const operation: TransferDatabaseMembershipOperation = {
    kind: "transfer_membership",
    cardBlockId: row.id,
    expectedMembership: sourceMembership
      ? {
          membershipId: sourceMembership.membershipId,
          revision: sourceMembership.revision,
        }
      : null,
    target: target
      ? {
          databaseBlockId: target.databaseBlockId,
          membershipId: `membership:transfer:${sha256(`${requestHash}\0${row.id}\0${target.databaseBlockId}`)}`,
          viewId: target.viewId,
          groupKey: target.groupKey,
          ...(target.beforeCardBlockId
            ? { beforeCardBlockId: target.beforeCardBlockId }
            : {}),
        }
      : null,
  };
  return {
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    operationId: deterministicSubOperationId(
      requestHash,
      `database-parent:${sha256(row.id)}`,
    ),
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    clientSessionId: request.clientSessionId,
    actor: request.actor,
    operations: [operation],
    operation,
  };
};

const transitionCardParents = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  rows: readonly BlockRow[],
  now: string,
): readonly string[] => {
  const affectedDatabases = new Set<string>();
  for (const row of rows) {
    const touchesDatabase =
      request.source.kind === "database" || request.target.kind === "database";
    if (touchesDatabase) {
      const offDatabaseParent: CardOffDatabaseParent =
        request.target.kind === "document"
          ? { kind: "document", documentId: request.target.documentId }
          : { kind: "space" };
      const result = transitionCardDatabaseParent(
        database,
        databaseTransitionRequest(request, requestHash, row),
        now,
        offDatabaseParent,
      );
      result.affectedDatabaseBlockIds.forEach((id) =>
        affectedDatabases.add(id),
      );
      continue;
    }
    updateCardParentWithoutDatabase(database, request, row, now);
  }
  return uniqueSorted([...affectedDatabases]);
};

const readFinalLocations = (
  database: Database.Database,
  blockIds: readonly string[],
): {
  readonly locations: Readonly<Record<string, BlockLocation>>;
  readonly revisions: Readonly<Record<string, number>>;
} => {
  const read = database.prepare(`
    SELECT block.project_id, block.location_kind, block.containing_document_id,
           block.containing_database_id, block.location_revision,
           placement.rank_key
    FROM blocks block
    LEFT JOIN top_level_block_placements placement ON placement.block_id = block.id
    WHERE block.id = ?
  `);
  const entries = blockIds.map((blockId) => {
    const row = read.get(blockId) as
      | {
          readonly location_kind: "space" | "document" | "database";
          readonly project_id: string;
          readonly containing_document_id: string | null;
          readonly containing_database_id: string | null;
          readonly location_revision: number;
          readonly rank_key: string | null;
        }
      | undefined;
    if (!row) throw new Error(`Committed transfer lost Block ${blockId}`);
    const location: BlockLocation = (() => {
      if (row.location_kind === "document" && row.containing_document_id) {
        return { kind: "document", documentId: row.containing_document_id };
      }
      if (row.location_kind === "database" && row.containing_database_id) {
        return { kind: "database", databaseBlockId: row.containing_database_id };
      }
      if (row.location_kind === "space" && row.rank_key) {
        return {
          kind: "space",
          projectId: row.project_id,
          rankKey: row.rank_key,
        };
      }
      throw new Error(`Committed transfer left Block ${blockId} parentless`);
    })();
    return [blockId, { location, revision: row.location_revision }] as const;
  });
  return {
    locations: Object.fromEntries(
      entries.map(([id, value]) => [id, value.location]),
    ),
    revisions: Object.fromEntries(
      entries.map(([id, value]) => [id, value.revision]),
    ),
  };
};

const persistChangeLog = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  blockIds: readonly string[],
  documentCommits: readonly RelocationDocumentCommit[],
  affectedDatabaseBlockIds: readonly string[],
  now: string,
): number => {
  const inserted = database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      request.projectId,
      request.storeEpoch,
      CHANGE_KIND,
      request.operationId,
      JSON.stringify(blockIds),
      JSON.stringify(documentCommits.map((commit) => commit.documentId)),
      JSON.stringify(affectedDatabaseBlockIds),
      stableStringifyDatabaseJson({
        version: BLOCK_TRANSFER_CONTRACT_VERSION,
        requestHash,
        mode: request.mode,
        source: request.source,
        target: request.target,
      }),
      now,
    );
  const sequence = Number(inserted.lastInsertRowid);
  if (Number.isSafeInteger(sequence) && sequence >= 1) return sequence;
  throw new Error("SQLite returned an invalid BlockTransfer change sequence");
};

const storedCommit = (
  commit: RelocationDocumentCommit,
): StoredDocumentCommit => ({
  documentId: commit.documentId,
  generation: commit.generation,
  baseHeadSeq: commit.baseHeadSeq,
  headSeq: commit.headSeq,
  updateId: commit.updateId,
});

const persistLedger = (
  database: Database.Database,
  request: BlockTransferRequest,
  canonicalRequest: string,
  requestHash: string,
  blockIds: readonly string[],
  documentCommits: readonly RelocationDocumentCommit[],
  affectedDatabaseBlockIds: readonly string[],
  receipt: BlockTransferReceipt,
): void => {
  const storedReceipt: StoredTransferReceipt = {
    ...receipt,
    documentCommits: documentCommits.map(storedCommit),
  };
  database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?, ?, ?, ?, ?)
    `,
    )
    .run(
      request.operationId,
      request.projectId,
      request.storeEpoch,
      MUTATION_KIND,
      stableStringifyDatabaseJson(request.actor),
      request.clientSessionId ?? null,
      requestHash,
      canonicalRequest,
      JSON.stringify(blockIds),
      JSON.stringify(uniqueSorted(documentCommits.map((commit) => commit.documentId))),
      JSON.stringify(affectedDatabaseBlockIds),
      stableStringifyDatabaseJson([
        { path: "location", operation: request.mode },
      ]),
      stableStringifyDatabaseJson(request.expectedLocationRevisions),
      stableStringifyDatabaseJson(storedReceipt),
      stableStringifyDatabaseJson(receipt.finalLocationRevisions),
      stableStringifyDatabaseJson(
        Object.fromEntries(
          documentCommits.map((commit) => [
            commit.documentId,
            { generation: commit.generation, headSeq: commit.headSeq },
          ]),
        ),
      ),
      receipt.changeLogSeq,
      receipt.committedAt,
    );
};

const materializeStoredCommit = (
  database: Database.Database,
  commit: StoredDocumentCommit,
): RelocationDocumentCommit => {
  const row = database
    .prepare(
      `
      SELECT document.state_vector,
             committed_update.update_blob
      FROM documents document
      LEFT JOIN document_updates committed_update
        ON committed_update.document_id = document.id
       AND committed_update.generation = ?
       AND committed_update.seq = ?
       AND committed_update.update_id = ?
      WHERE document.id = ? AND document.generation = ?
    `,
    )
    .get(
      commit.generation,
      commit.headSeq,
      commit.updateId,
      commit.documentId,
      commit.generation,
    ) as
    | {
        readonly update_blob: Uint8Array | null;
        readonly state_vector: Uint8Array;
      }
    | undefined;
  if (!row) {
    throw new Error(
      `Stored BlockTransfer Document no longer exists: ${commit.documentId}`,
    );
  }
  return {
    ...commit,
    update: row.update_blob ? new Uint8Array(row.update_blob) : null,
    stateVector: new Uint8Array(row.state_vector),
  };
};

const loadDuplicate = (
  database: Database.Database,
  stored: StoredMutationRow,
  request: BlockTransferRequest,
  canonicalRequest: string,
  requestHash: string,
): BlockTransferReceipt => {
  if (
    stored.project_id !== request.projectId ||
    stored.store_epoch !== request.storeEpoch ||
    stored.mutation_kind !== MUTATION_KIND ||
    stored.request_hash !== requestHash ||
    stored.request_json !== canonicalRequest
  ) {
    reject(
      request,
      "operation_id_collision",
      `Operation ID ${request.operationId} is already used by another mutation`,
    );
  }
  const receipt = JSON.parse(stored.result_json) as StoredTransferReceipt;
  if (
    receipt.version !== BLOCK_TRANSFER_CONTRACT_VERSION ||
    receipt.operationId !== request.operationId ||
    receipt.changeLogSeq !== stored.change_log_seq
  ) {
    throw new Error(`Stored BlockTransfer ${request.operationId} is corrupt`);
  }
  return {
    ...receipt,
    duplicate: true,
    documentCommits: receipt.documentCommits.map((commit) =>
      materializeStoredCommit(database, commit),
    ),
  };
};

const mapUnexpectedDomainError = (
  request: BlockTransferRequest,
  error: unknown,
): never => {
  if (error instanceof BlockTransferRejection) throw error;
  if (error instanceof BlockRelocationStoreError) {
    const code =
      error.code === "source_head_mismatch"
        ? "source_head_mismatch"
        : error.code === "target_head_changed"
          ? "target_head_mismatch"
          : error.code === "block_location_revision_mismatch"
            ? "location_revision_mismatch"
            : error.code === "relocation_cycle"
              ? "transfer_cycle"
              : error.code === "block_not_found"
                ? "block_not_found"
                : "invalid_target";
    reject(request, code, error.message, {
      retryable:
        error.code === "source_head_mismatch" ||
        error.code === "target_head_changed",
      reloadRequired:
        error.code === "source_head_mismatch" ||
        error.code === "target_head_changed",
    });
  }
  const databaseError = error as {
    readonly commandError?: {
      readonly code?: string;
      readonly message?: string;
    };
  };
  if (databaseError.commandError?.message) {
    reject(
      request,
      databaseError.commandError.code === "membership_conflict"
        ? "membership_revision_mismatch"
        : "invalid_target",
      databaseError.commandError.message,
      { retryable: true, reloadRequired: true },
    );
  }
  throw error;
};

/**
 * Apply one same-Project parent transfer on the process-wide SQLite writer.
 * Nested document/database authority kernels use SAVEPOINTs; the outer
 * IMMEDIATE transaction owns their updates, placements, projections and the
 * one public TransferBlocks receipt.
 */
export const applyBlockTransfer = (
  database: Database.Database,
  rawRequest: BlockTransferRequest,
  options: ApplyBlockTransferOptions = {},
): BlockTransferCommandResult => {
  let request: BlockTransferRequest;
  try {
    request = parseBlockTransferRequest(rawRequest);
  } catch (error) {
    if (!(error instanceof BlockTransferContractError)) throw error;
    return {
      ok: false,
      error: {
        code: "invalid_transfer_request",
        message: error.message,
        retryable: false,
        reloadRequired: false,
      },
    };
  }
  const canonicalRequest = canonicalizeBlockTransferIntent(request);
  const requestHash = sha256(canonicalRequest);
  const inject = (point: BlockTransferFaultPoint): void => {
    options.faultInjector?.(point);
  };
  if (readStoreEpoch(database) !== request.storeEpoch) {
    return {
      ok: false,
      error: {
        code: "store_epoch_mismatch",
        message: `Transfer belongs to store epoch ${request.storeEpoch}`,
        retryable: false,
        reloadRequired: true,
        operationId: request.operationId,
      },
    };
  }
  const existing = readStoredMutation(database, request.operationId);
  if (existing) {
    try {
      return {
        ok: true,
        value: loadDuplicate(
          database,
          existing,
          request,
          canonicalRequest,
          requestHash,
        ),
      };
    } catch (error) {
      if (error instanceof BlockTransferRejection) {
        return { ok: false, error: error.commandError };
      }
      throw error;
    }
  }
  const transaction = database.transaction((): BlockTransferReceipt => {
    const project = database
      .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
      .get(request.projectId);
    if (!project) {
      reject(
        request,
        "project_not_found",
        `Project does not exist: ${request.projectId}`,
      );
    }
    const rows = readBlockRows(database, request);
    assertSourceParent(database, request, rows);
    const now = options.now?.() ?? new Date().toISOString();
    let documentCommits: readonly RelocationDocumentCommit[] = [];
    let affectedDatabaseBlockIds: readonly string[] = [];
    let resultBlockIds: readonly string[] = request.rootBlockIds;
    let resultRootBlockIds: readonly string[] = request.rootBlockIds;
    let copiedBlockIds: Readonly<Record<string, string>> = {};

    try {
      if (request.mode === "copy") {
        const copy = copyDatabaseCard(
          database,
          request,
          requestHash,
          now,
        );
        documentCommits = copy.documentCommits;
        affectedDatabaseBlockIds = copy.affectedDatabaseBlockIds;
        resultBlockIds = copy.resultBlockIds;
        resultRootBlockIds = copy.resultRootBlockIds;
        copiedBlockIds = copy.copiedBlockIds;
      } else if (
        request.source.kind === "document" &&
        request.target.kind === "document"
      ) {
        const relocation = relocateBlocksAtomically(database, {
          relocationId: deterministicSubOperationId(requestHash, "relocation"),
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          rootBlockIds: request.rootBlockIds,
          sourceDocumentId: request.source.documentId,
          sourceGeneration: request.source.generation,
          expectedSourceHeadSeq: request.source.expectedHeadSeq,
          expectedLocationRevisions: request.expectedLocationRevisions,
          target: {
            kind: "document",
            documentId: request.target.documentId,
            generation: request.target.generation,
            expectedHeadSeq: request.target.expectedHeadSeq,
            ...(request.target.parentBlockId
              ? { parentBlockId: request.target.parentBlockId }
              : {}),
            ...(request.target.beforeBlockId
              ? { beforeBlockId: request.target.beforeBlockId }
              : {}),
          },
        });
        documentCommits = [
          relocation.sourceCommit,
          ...(relocation.targetCommit ? [relocation.targetCommit] : []),
        ];
        resultBlockIds = relocation.movedBlockIds;
      } else if (
        request.source.kind === "document" &&
        request.target.kind === "database" &&
        rows.some((row) => row.type !== "card")
      ) {
        const policy = classifyDatabaseTransferBlock(rows[0]?.type ?? "");
        if (policy === "promote_in_place") {
          const promotion = promoteDocumentRootToDatabaseCard(
            database,
            request,
            requestHash,
            rows,
            now,
          );
          documentCommits = promotion.documentCommits;
          affectedDatabaseBlockIds = promotion.affectedDatabaseBlockIds;
          resultBlockIds = promotion.resultBlockIds;
        } else {
          const wrapper = wrapDocumentRootInDatabaseCard(
            database,
            request,
            requestHash,
            now,
          );
          documentCommits = wrapper.documentCommits;
          affectedDatabaseBlockIds = wrapper.affectedDatabaseBlockIds;
          resultBlockIds = wrapper.resultBlockIds;
          resultRootBlockIds = wrapper.resultRootBlockIds;
        }
      } else {
        requireCardRoots(request, rows);
        if (request.source.kind === "document") {
          documentCommits = [
            runDocumentBatch(database, request, requestHash, {
              role: "source-document",
              documentId: request.source.documentId,
              generation: request.source.generation,
              expectedHeadSeq: request.source.expectedHeadSeq,
              operations: sourceDeleteOperations(
                database,
                request,
                requestHash,
              ),
              preserveRemovedOwnerIds: request.rootBlockIds,
            }),
          ];
          inject("after_source_document");
        }
        affectedDatabaseBlockIds = transitionCardParents(
          database,
          request,
          requestHash,
          rows,
          now,
        );
        inject("after_parent_transition");
        if (request.target.kind === "document") {
          const target = request.target;
          const targetCommit = runDocumentBatch(
            database,
            request,
            requestHash,
            {
              role: "target-document",
              documentId: target.documentId,
              generation: target.generation,
              expectedHeadSeq: target.expectedHeadSeq,
              operations: request.rootBlockIds.map((blockId) => ({
                kind: "insert_block",
                block: {
                  id: blockId,
                  type: "card",
                  props: { displayHint: cardDisplayHint(database, blockId) },
                  children: [],
                },
                ...(target.parentBlockId
                  ? { parentBlockId: target.parentBlockId }
                  : {}),
                ...(target.beforeBlockId
                  ? { beforeBlockId: target.beforeBlockId }
                  : {}),
              })),
              stagedOwnerIds: request.rootBlockIds,
            },
          );
          documentCommits = [...documentCommits, targetCommit];
          inject("after_target_document");
        }
      }
    } catch (error) {
      mapUnexpectedDomainError(request, error);
    }

    const readMovedType = database.prepare(
      "SELECT type FROM blocks WHERE id = ? AND project_id = ?",
    );
    const movedCardIds = resultBlockIds.filter(
      (blockId) =>
        (
          readMovedType.get(blockId, request.projectId) as
            | { readonly type: string }
            | undefined
        )?.type === "card",
    );
    rebuildCardReadModelProjection(database, request.projectId, movedCardIds);
    refreshScheduledCardIndexProjection(
      database,
      request.projectId,
      movedCardIds,
      now,
    );
    inject("after_projections");
    const final = readFinalLocations(database, resultBlockIds);
    const changeLogSeq = persistChangeLog(
      database,
      request,
      requestHash,
      resultBlockIds,
      documentCommits,
      affectedDatabaseBlockIds,
      now,
    );
    inject("after_change_log");
    const receipt: BlockTransferReceipt = {
      version: BLOCK_TRANSFER_CONTRACT_VERSION,
      operationId: request.operationId,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      mode: request.mode,
      duplicate: false,
      sourceRootBlockIds: request.rootBlockIds,
      resultRootBlockIds,
      copiedBlockIds,
      finalLocations: final.locations,
      finalLocationRevisions: final.revisions,
      documentCommits,
      affectedDatabaseBlockIds,
      changeLogSeq,
      committedAt: now,
    };
    persistLedger(
      database,
      request,
      canonicalRequest,
      requestHash,
      resultBlockIds,
      documentCommits,
      affectedDatabaseBlockIds,
      receipt,
    );
    inject("after_ledger");
    inject("before_commit");
    return receipt;
  });

  try {
    const value = transaction.immediate();
    inject("after_commit");
    return { ok: true, value };
  } catch (error) {
    if (error instanceof BlockTransferRejection) {
      return { ok: false, error: error.commandError };
    }
    throw error;
  }
};
