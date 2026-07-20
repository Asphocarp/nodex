import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { createUuidV7 } from "../../shared/uuid-v7";
import {
  BLOCK_TRANSFER_CONTRACT_VERSION,
  BlockTransferContractError,
  blockTransferIntentFromRequest,
  canonicalizeBlockTransferIntent,
  canonicalizeBlockTransferLogicalIntent,
  parseBlockTransferIntent,
  parseBlockTransferRequest,
  type BlockTransferCommandError,
  type BlockTransferCommandResult,
  type BlockTransferDocumentHead,
  type BlockTransferIntent,
  type BlockTransferPreparation,
  type BlockTransferReceipt,
  type BlockTransferRequest,
  type BlockTransferTransformationEvidence,
} from "../../shared/block-transfer";
import {
  parseDatabaseViewConfigV2,
  stableStringifyDatabaseJson,
} from "../../shared/database-kernel";
import {
  isBuiltInDataSourcePropertyId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
  type DatabaseViewId,
  type DataSourceId,
  type DataSourcePropertyId,
} from "../../shared/database-identities";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseApplyOperationV2,
  type DatabaseApplyV2,
  type TransferDataSourcePageOperationV2,
} from "../../shared/database-module-v2";
import {
  DOCUMENT_OPERATION_CONTRACT_VERSION,
  type DocumentBlockOperation,
  type DocumentOperationResult,
} from "../../shared/block-documents/document-operations";
import type { DocumentVersionActor } from "../../shared/block-documents/document-history";
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
  planBlockToPageTransformation,
  type BlockToPageTransformation,
} from "../../shared/block-documents/block-to-page-transformation";
import {
  canonicalizePortableRichText,
  portableRichTextSemanticSource,
  replaceYTextWithPortableRichText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";
import { putProjectResourceGrantInDatabase } from "./project-resource-grants";
import {
  assessBlockSemanticContentForPage,
  BlockSemanticContentError,
} from "../../shared/block-documents/block-semantic-content";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
  createPageDocument,
} from "../../shared/block-documents/page-document";
import {
  allocateBlockOwnershipCopyIdentities,
  planBlockOwnershipClosure,
  type BlockOwnershipClosure,
  type BlockOwnershipCopyIdentityMap,
} from "../../shared/block-ownership-copy-plan";
import {
  getRegisteredBlockDocumentSchemaAdapter,
  getOwnedDocumentSchemaRegistration,
} from "../../shared/block-documents/document-schema-adapters";
import { planFractionalRank } from "../../shared/fractional-rank";
import { isWorkflowStatus } from "../../shared/workflow-status";
import { applyDocumentOperationBatch } from "./block-document-operations";
import {
  initializeBlockDocumentGenesis,
  initializePageDocumentGenesis,
} from "./block-document-store";
import { insertDefaultPageIntrinsicProperties } from "./default-page-intrinsic-properties";
import { readCanvasSceneAuthoritySnapshot } from "./canvas-scene-authority-reader";
import { initializeCanvasSceneAuthority } from "./canvas-scene-store";
import {
  BlockRelocationStoreError,
  relocateBlocksAtomically,
} from "./block-relocations";
import { rebuildPageReadModelProjection } from "./page-read-store";
import {
  applyDatabaseModuleV2,
  transitionPageParentForBlockTransferV2,
} from "./database-module-v2-runtime";
import { refreshScheduledPageIndexProjection } from "./scheduled-page-store";
import { createDocumentVersionCheckpoint } from "./document-versions";
import { markDocumentRevisionSessionCheckpoint } from "./document-revision-session-store";
import { cloneAuthoritativePageInTransaction } from "./authoritative-page-clone";
import {
  PageHierarchyError,
  resolvePageHierarchy,
} from "./page-hierarchy";

export type BlockTransferFaultPoint =
  | "after_source_document"
  | "after_page_owner_staged"
  | "after_page_children_reparented"
  | "after_page_genesis"
  | "after_page_body"
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
  readonly persistTopLevelGrant?: boolean;
  /**
   * Trusted Library ownership handoff after relational parent transition and
   * before the target Document materialization observes the Page roots.
   */
  readonly beforeTargetDocument?: (rootPageIds: readonly string[]) => void;
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
  readonly transformationEvidence?: readonly BlockTransferTransformationEvidence[];
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

interface BlockCopyCompilation {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
  readonly resultRootBlockIds: readonly string[];
  readonly copiedBlockIds: Readonly<Record<string, string>>;
  readonly transformationEvidence?: readonly BlockTransferTransformationEvidence[];
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

const assertMovePreservesPageHierarchy = (
  database: Database.Database,
  transfer: Pick<
    BlockTransferIntent,
    "mode" | "operationId" | "rootBlockIds"
  >,
  rows: readonly BlockRow[],
  target: Readonly<{
    kind: string;
    documentId?: string;
    pageId?: string;
  }>,
): void => {
  if (transfer.mode !== "move" || target.kind !== "document") return;
  const movedPageIds = new Set(
    rows.filter((row) => row.type === "page").map((row) => row.id),
  );
  if (movedPageIds.size === 0 || !target.documentId) return;

  const targetOwner = database.prepare(`
    SELECT block_id AS pageId
    FROM pages
    WHERE document_id = ?
  `).get(target.documentId) as { readonly pageId: string } | undefined;
  if (target.pageId && targetOwner?.pageId !== target.pageId) {
    reject(
      transfer,
      "invalid_target",
      `Document ${target.documentId} is not owned by target Page ${target.pageId}`,
    );
  }
  if (!targetOwner) return;

  let targetHierarchy;
  try {
    targetHierarchy = resolvePageHierarchy(database, targetOwner.pageId);
  } catch (error) {
    if (!(error instanceof PageHierarchyError)) throw error;
    return reject(
      transfer,
      "recovery_required",
      `Target Page ${targetOwner.pageId} has an invalid ownership hierarchy`,
      { retryable: false, reloadRequired: true },
    );
  }
  const movedAncestorId = targetHierarchy.pageIds.find((pageId) =>
    movedPageIds.has(pageId),
  );
  if (!movedAncestorId) return;
  reject(
    transfer,
    "transfer_cycle",
    `Page ${movedAncestorId} cannot be moved into itself or its descendant Page ${targetOwner.pageId}`,
  );
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
    SELECT membership.id, membership.revision, membership.data_source_id
    FROM data_source_page_memberships membership
    INNER JOIN data_sources source
      ON source.id = membership.data_source_id
    WHERE membership.page_block_id = ?
      AND source.home_database_block_id = ?
      AND membership.removed_at IS NULL
  `);
  for (const row of rows) {
    const expected = request.source.memberships[row.id];
    const actual = readMembership.get(
      row.id,
      request.source.databaseBlockId,
    ) as
      | {
          readonly id: string;
          readonly revision: number;
          readonly data_source_id: string;
        }
      | undefined;
    if (
      expected &&
      actual?.id === expected.membershipId &&
      actual.revision === expected.revision &&
      (request.source.dataSourceId === undefined ||
        actual.data_source_id === request.source.dataSourceId)
    ) {
      continue;
    }
    reject(
      request,
      "membership_revision_mismatch",
      `Database membership changed for Page ${row.id}`,
      { retryable: true, reloadRequired: true },
    );
  }
};

const requirePageRoots = (
  request: BlockTransferRequest,
  rows: readonly BlockRow[],
): void => {
  const unsupported = rows.find((row) => row.type !== "page");
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

const planPageTransformation = (
  request: BlockTransferRequest,
  root: BlockTreeNode,
  resultRootId: string,
): BlockToPageTransformation => {
  try {
    return planBlockToPageTransformation({
      root,
      resultRootId,
      wrapperPageId: createUuidV7(),
      allocateEmptyBodyBlockId: createUuidV7,
    });
  } catch (error) {
    if (error instanceof BlockSemanticContentError) {
      return reject(request, "unsupported_transfer", error.message);
    }
    throw error;
  }
};

const transformationEvidence = (input: {
  readonly source: PromotionSource;
  readonly transformation: Exclude<
    BlockToPageTransformation,
    { readonly kind: "already_page" }
  >;
  readonly sourceToResultBlockIds: Readonly<Record<string, string>>;
}): BlockTransferTransformationEvidence => ({
  sourceBlockId: input.source.root.id,
  resultPageId: input.transformation.pageId,
  kind: input.transformation.kind,
  sourceBlockType: input.source.root.type,
  semanticTitleHash: sha256(
    portableRichTextSemanticSource(input.transformation.richTitle),
  ),
  consumedPropertyKeys:
    input.transformation.kind === "promote"
      ? Object.keys(input.transformation.consumedProps).sort()
      : [],
  ...(input.transformation.kind === "wrap"
    ? { wrapperReason: input.transformation.reason }
    : {}),
  bodyRootBlockIds:
    input.transformation.kind === "promote"
      ? input.transformation.bodyRoots.map((block) => block.id)
      : [input.transformation.wrappedRoot.id],
  sourceToResultBlockIds: input.sourceToResultBlockIds,
});

const stagePromotedPageOwnership = (
  database: Database.Database,
  request: BlockTransferRequest,
  input: {
    readonly source: PromotionSource;
    readonly now: string;
  },
): string => {
  const pageId = input.source.root.id;
  const documentId = `document:${pageId}`;
  const identityCollision = database
    .prepare("SELECT 1 AS present FROM documents WHERE id = ?")
    .get(documentId);
  if (identityCollision) {
    return reject(
      request,
      "invalid_target",
      `Promoted Page Document identity already exists: ${documentId}`,
    );
  }
  const promoted = database
    .prepare(
      `UPDATE blocks
       SET type = 'page', metadata_revision = metadata_revision + 1,
           updated_at = ?
       WHERE id = ? AND project_id = ? AND lifecycle = 'active'
         AND type = ? AND location_kind = 'document'
         AND containing_document_id = ?`,
    )
    .run(
      input.now,
      pageId,
      request.projectId,
      input.source.root.type,
      request.source.kind === "document" ? request.source.documentId : null,
    );
  if (promoted.changes !== 1) {
    return reject(
      request,
      "source_parent_mismatch",
      `Block ${pageId} changed before Page promotion`,
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
      PAGE_DOCUMENT_SCHEMA_KEY,
      PAGE_DOCUMENT_SCHEMA_VERSION,
      input.now,
      input.now,
    );
  database
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(pageId, documentId, request.projectId, input.now);
  const pageAuthority = database.prepare(`
    INSERT INTO pages (
      block_id, library_id, document_id, parent_kind, parent_id,
      lifecycle, parent_revision, metadata_revision, created_at, updated_at
    )
    SELECT block.id, project.library_id, ?,
      CASE WHEN parent.block_id IS NULL THEN 'library' ELSE 'page' END,
      COALESCE(parent.block_id, project.library_id),
      block.lifecycle, block.location_revision, block.metadata_revision, ?, ?
    FROM blocks block
    INNER JOIN projects project ON project.id = block.project_id
    LEFT JOIN pages parent ON parent.document_id = block.containing_document_id
    WHERE block.id = ? AND block.project_id = ? AND block.type = 'page'
  `).run(
    documentId,
    input.now,
    input.now,
    pageId,
    request.projectId,
  );
  if (pageAuthority.changes !== 1) {
    throw new Error(`Promoted Page ${pageId} has no canonical parent authority`);
  }
  insertDefaultPageIntrinsicProperties(database, {
    pageId,
    projectId: request.projectId,
    now: input.now,
  });
  return documentId;
};

const initializeStagedPageDocument = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  input: {
    readonly documentId: string;
    readonly richTitle: PortableRichText;
    readonly bodyRoots: readonly BlockTreeNode[];
    readonly role: string;
  },
): RelocationDocumentCommit => {
  const genesis = createPageDocument({
    documentId: input.documentId,
    initialTitle: "",
  });
  try {
    replaceYTextWithPortableRichText(genesis.title, input.richTitle);
    populateBlockDocumentBodyFromBlockTree(genesis.body, input.bodyRoots);
    const ack = initializePageDocumentGenesis(database, {
      documentId: input.documentId,
      storeEpoch: request.storeEpoch,
      generation: 1,
      updateId: deterministicSubOperationId(requestHash, input.role),
      clientSessionId: request.clientSessionId ?? "block-transfer:page-genesis",
      update: Y.encodeStateAsUpdate(genesis.document),
      finalAuthority: "ydoc_primary",
    });
    return readDocumentCommitAt(
      database,
      input.documentId,
      1,
      ack.headSeq,
    );
  } finally {
    genesis.document.destroy();
  }
};

const stageWrapperPageDocument = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  input: {
    readonly pageId: string;
    readonly richTitle: PortableRichText;
    readonly now: string;
  },
): string => {
  const documentId = `document:${input.pageId}`;
  const collision = database
    .prepare(
      `SELECT 'block' AS kind FROM blocks WHERE id = ?
       UNION ALL SELECT 'document' FROM documents WHERE id = ? LIMIT 1`,
    )
    .get(input.pageId, documentId) as { readonly kind: string } | undefined;
  if (collision) {
    return reject(
      request,
      "invalid_target",
      `Wrapper Page identity collides with an existing ${collision.kind}`,
    );
  }
  database
    .prepare(
      `INSERT INTO blocks (
         id, project_id, type, lifecycle, location_kind,
         containing_document_id, containing_database_id,
         location_revision, metadata_revision, created_at, updated_at
       ) VALUES (?, ?, 'page', 'active', 'space', NULL, NULL, 1, 1, ?, ?)`,
    )
    .run(input.pageId, request.projectId, input.now, input.now);
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
      PAGE_DOCUMENT_SCHEMA_KEY,
      PAGE_DOCUMENT_SCHEMA_VERSION,
      input.now,
      input.now,
    );
  database
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.pageId, documentId, request.projectId, input.now);
  const pageAuthority = database.prepare(`
    INSERT INTO pages (
      block_id, library_id, document_id, parent_kind, parent_id,
      lifecycle, parent_revision, metadata_revision, created_at, updated_at
    )
    SELECT ?, project.library_id, ?, 'library', project.library_id,
      'active', 1, 1, ?, ?
    FROM projects project WHERE project.id = ?
  `).run(
    input.pageId,
    documentId,
    input.now,
    input.now,
    request.projectId,
  );
  if (pageAuthority.changes !== 1) {
    throw new Error(`Wrapper Page ${input.pageId} has no Library authority`);
  }
  const genesis = createPageDocument({
    documentId,
    initialTitle: "",
  });
  try {
    replaceYTextWithPortableRichText(genesis.title, input.richTitle);
    initializePageDocumentGenesis(database, {
      documentId,
      storeEpoch: request.storeEpoch,
      generation: 1,
      updateId: deterministicSubOperationId(
        requestHash,
        `wrapper-genesis:${sha256(input.pageId)}`,
      ),
      clientSessionId: request.clientSessionId ?? "block-transfer:wrapper",
      update: Y.encodeStateAsUpdate(genesis.document),
      finalAuthority: "ydoc_primary",
    });
  } finally {
    genesis.document.destroy();
  }
  insertDefaultPageIntrinsicProperties(database, {
    pageId: input.pageId,
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
  const document = database.prepare(`
    SELECT project_id AS projectId FROM documents WHERE id = ?
  `).get(input.documentId) as { readonly projectId: string } | undefined;
  if (!document) {
    return reject(
      request,
      "target_not_found",
      `Document does not exist: ${input.documentId}`,
    );
  }
  const result = applyDocumentOperationBatch(
    database,
    {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      mutationId: deterministicSubOperationId(requestHash, input.role),
      projectId: document.projectId,
      storeEpoch: request.storeEpoch,
      clientSessionId: request.clientSessionId,
      actor: request.actor,
      documentId: input.documentId,
      generation: input.generation,
      expectedHeadSeq: input.expectedHeadSeq,
      operations: input.operations,
    },
    {
      skipAutomaticRevisionCapture: true,
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
      block: createCanonicalEmptyParagraphBlock(createUuidV7()),
    },
  ];
};

const promoteDocumentRootToPageParent = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  rows: readonly BlockRow[],
  now: string,
  inject: (point: BlockTransferFaultPoint) => void,
): {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
  readonly transformationEvidence: readonly BlockTransferTransformationEvidence[];
} => {
  if (
    request.source.kind !== "document" ||
    (request.target.kind !== "database" && request.target.kind !== "space")
  ) {
    return reject(
      request,
      "unsupported_transfer",
      "Block promotion requires a Document source and Page-capable parent",
    );
  }
  const source = readPromotionSource(database, request);
  const transformation = planPageTransformation(
    request,
    source.root,
    source.root.id,
  );
  if (transformation.kind !== "promote") {
    return reject(
      request,
      "unsupported_transfer",
      `${source.root.type} requires wrapper Page compilation`,
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
  inject("after_source_document");
  const documentId = stagePromotedPageOwnership(database, request, {
    source,
    now,
  });
  inject("after_page_owner_staged");
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
      documentId,
      now,
      blockId,
      request.projectId,
      request.source.documentId,
    );
    if (moved.changes !== 1) {
      return reject(
        request,
        "source_parent_mismatch",
        `Descendant Block ${blockId} changed during Page promotion`,
        { retryable: true, reloadRequired: true },
      );
    }
  }
  inject("after_page_children_reparented");
  const genesisCommit = initializeStagedPageDocument(
    database,
    request,
    requestHash,
    {
      documentId,
      richTitle: transformation.richTitle,
      bodyRoots: transformation.bodyRoots,
      role: "promotion-genesis",
    },
  );
  inject("after_page_genesis");
  const affectedDatabaseBlockIds = transitionPageParents(
    database,
    request,
    requestHash,
    rows,
    now,
  );
  inject("after_parent_transition");
  return {
    documentCommits: [sourceCommit, genesisCommit],
    affectedDatabaseBlockIds,
    resultBlockIds: uniqueSorted([
      transformation.pageId,
      ...transformation.bodyRoots.flatMap(flattenBlockTreeIds),
    ]),
    transformationEvidence: [
      transformationEvidence({
        source,
        transformation,
        sourceToResultBlockIds: Object.fromEntries(
          source.blockIds.map((blockId) => [blockId, blockId]),
        ),
      }),
    ],
  };
};

const wrapDocumentRootInPageParent = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
  inject: (point: BlockTransferFaultPoint) => void,
): {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
  readonly resultRootBlockIds: readonly string[];
  readonly transformationEvidence: readonly BlockTransferTransformationEvidence[];
} => {
  if (
    request.source.kind !== "document" ||
    (request.target.kind !== "database" && request.target.kind !== "space")
  ) {
    return reject(
      request,
      "unsupported_transfer",
      "Wrapper coercion requires a Document source and Page-capable parent",
    );
  }
  const source = readPromotionSource(database, request);
  const transformation = planPageTransformation(
    request,
    source.root,
    source.root.id,
  );
  if (transformation.kind !== "wrap") {
    return reject(
      request,
      "unsupported_transfer",
      `${source.root.type} does not require a wrapper Page`,
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
  inject("after_source_document");
  const wrapperDocumentId = stageWrapperPageDocument(
    database,
    request,
    requestHash,
    {
      pageId: transformation.pageId,
      richTitle: transformation.richTitle,
      now,
    },
  );
  inject("after_page_owner_staged");
  inject("after_page_genesis");
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
        `Wrapped Block ${blockId} changed during Page creation`,
        { retryable: true, reloadRequired: true },
      );
    }
  }
  inject("after_page_children_reparented");
  const bodyCommit = runDocumentBatch(database, request, requestHash, {
    role: "wrapper-body",
    documentId: wrapperDocumentId,
    generation: 1,
    expectedHeadSeq: 1,
    operations: [{ kind: "insert_block", block: source.root }],
    stagedReparentedBlockIds: source.blockIds,
  });
  inject("after_page_body");
  const wrapperRow = database
    .prepare(
      `SELECT id, project_id, type, lifecycle, location_kind,
              containing_document_id, containing_database_id,
              location_revision
       FROM blocks WHERE id = ?`,
    )
    .get(transformation.pageId) as BlockRow;
  const affectedDatabaseBlockIds = transitionPageParents(
    database,
    request,
    requestHash,
    [wrapperRow],
    now,
  );
  inject("after_parent_transition");
  return {
    documentCommits: [sourceCommit, bodyCommit],
    affectedDatabaseBlockIds,
    resultBlockIds: [transformation.pageId, ...source.blockIds],
    resultRootBlockIds: [transformation.pageId],
    transformationEvidence: [
      transformationEvidence({
        source,
        transformation,
        sourceToResultBlockIds: Object.fromEntries(
          source.blockIds.map((blockId) => [blockId, blockId]),
        ),
      }),
    ],
  };
};

const moveDocumentRootsToPageParent = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  rows: readonly BlockRow[],
  now: string,
  inject: (point: BlockTransferFaultPoint) => void,
): {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
  readonly resultRootBlockIds: readonly string[];
  readonly transformationEvidence: readonly BlockTransferTransformationEvidence[];
} => {
  if (request.source.kind !== "document") {
    return reject(
      request,
      "unsupported_transfer",
      "Block coercion requires one Document source",
    );
  }
  const sourceDocumentId = request.source.documentId;
  const sourceGeneration = request.source.generation;
  let sourceHeadSeq = request.source.expectedHeadSeq;
  const documentCommits: RelocationDocumentCommit[] = [];
  const affectedDatabases = new Set<string>();
  const resultBlockIds: string[] = [];
  const resultRootBlockIds: string[] = [];
  const evidence: BlockTransferTransformationEvidence[] = [];
  for (const rootBlockId of request.rootBlockIds) {
    const row = rows.find((candidate) => candidate.id === rootBlockId);
    if (!row) {
      return reject(
        request,
        "block_not_found",
        `Transfer root disappeared during compilation: ${rootBlockId}`,
      );
    }
    const singleRequest: BlockTransferRequest = {
      ...request,
      rootBlockIds: [rootBlockId],
      expectedLocationRevisions: {
        [rootBlockId]: request.expectedLocationRevisions[rootBlockId] as number,
      },
      source: {
        ...request.source,
        expectedHeadSeq: sourceHeadSeq,
      },
    };
    const rootRequestHash = sha256(`${requestHash}\0root\0${rootBlockId}`);
    const result = (() => {
      if (row.type === "page") {
        const sourceCommit = runDocumentBatch(
          database,
          singleRequest,
          rootRequestHash,
          {
            role: "source-document",
            documentId: sourceDocumentId,
            generation: sourceGeneration,
            expectedHeadSeq: sourceHeadSeq,
            operations: sourceDeleteOperationsForForest(
              database,
              singleRequest,
              rootRequestHash,
              [rootBlockId],
              [rootBlockId],
            ),
            preserveRemovedOwnerIds: [rootBlockId],
          },
        );
        inject("after_source_document");
        const affectedDatabaseBlockIds = transitionPageParents(
          database,
          singleRequest,
          rootRequestHash,
          [row],
          now,
        );
        inject("after_parent_transition");
        return {
          documentCommits: [sourceCommit],
          affectedDatabaseBlockIds,
          resultBlockIds: [rootBlockId],
          resultRootBlockIds: [rootBlockId],
          transformationEvidence: [],
        };
      }
      let semantic;
      try {
        semantic = assessBlockSemanticContentForPage(
          readPromotionSource(database, singleRequest).root,
        );
      } catch (error) {
        if (error instanceof BlockSemanticContentError) {
          return reject(singleRequest, "unsupported_transfer", error.message);
        }
        throw error;
      }
      if (semantic.kind === "promote") {
        return {
          ...promoteDocumentRootToPageParent(
            database,
            singleRequest,
            rootRequestHash,
            [row],
            now,
            inject,
          ),
          resultRootBlockIds: [rootBlockId],
        };
      }
      return wrapDocumentRootInPageParent(
        database,
        singleRequest,
        rootRequestHash,
        now,
        inject,
      );
    })();
    documentCommits.push(...result.documentCommits);
    result.affectedDatabaseBlockIds.forEach((id) => affectedDatabases.add(id));
    resultBlockIds.push(...result.resultBlockIds);
    resultRootBlockIds.push(...result.resultRootBlockIds);
    evidence.push(...result.transformationEvidence);
    const sourceCommit = result.documentCommits.find(
      (commit) => commit.documentId === sourceDocumentId,
    );
    if (!sourceCommit) {
      throw new Error(`Block coercion omitted source commit for ${rootBlockId}`);
    }
    sourceHeadSeq = sourceCommit.headSeq;
  }
  return {
    documentCommits,
    affectedDatabaseBlockIds: uniqueSorted([...affectedDatabases]),
    resultBlockIds,
    resultRootBlockIds,
    transformationEvidence: evidence,
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
  skippedSourceDocumentId: string | null,
  createdAt: string,
  containingDocumentOverrides: Readonly<Record<string, string>> = {},
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
      state_vector, state_hash, sync_engine, readiness, authority,
      created_at, updated_at
    ) VALUES (?, ?, 1, 0, ?, ?, X'', ?, ?, ?, ?, ?, ?)
  `);
  const insertOwnership = database.prepare(`
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertNestedPage = database.prepare(`
    INSERT INTO pages (
      block_id, library_id, document_id, parent_kind, parent_id,
      lifecycle, parent_revision, metadata_revision, created_at, updated_at
    )
    SELECT ?, project.library_id, ?, 'page', parent.block_id,
      'active', 1, 1, ?, ?
    FROM projects project
    INNER JOIN pages parent ON parent.document_id = ?
    WHERE project.id = ? AND parent.library_id = project.library_id
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
    if (document.documentId === skippedSourceDocumentId) continue;
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
      ? (containingDocumentOverrides[sourceOwner.containing_document_id] ??
        identities.documentIds[sourceOwner.containing_document_id])
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
    const registration = getOwnedDocumentSchemaRegistration({
      ownerType: sourceOwner.type,
      schemaKey: document.schemaKey,
      schemaVersion: document.schemaVersion,
    });
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
      registration.syncEngine === "canvas_scene" ? "0".repeat(64) : "",
      registration.syncEngine,
      registration.syncEngine === "canvas_scene" ? "ready" : "pending_genesis",
      registration.syncEngine === "canvas_scene" ? "ydoc_primary" : "legacy_shadow",
      createdAt,
      createdAt,
    );
    insertOwnership.run(
      targetOwnerId,
      targetDocumentId,
      request.projectId,
      createdAt,
    );
    if (sourceOwner.type === "page") {
      const nestedPage = insertNestedPage.run(
        targetOwnerId,
        targetDocumentId,
        createdAt,
        createdAt,
        targetContainingDocumentId,
        request.projectId,
      );
      if (nestedPage.changes !== 1) {
        throw new Error(
          `Nested Page ${targetOwnerId} has no canonical parent authority`,
        );
      }
    }
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
  skippedSourceDocumentId: string | null,
): readonly RelocationDocumentCommit[] => {
  const commits: RelocationDocumentCommit[] = [];
  for (const sourceDocument of closure.documents) {
    if (sourceDocument.documentId === skippedSourceDocumentId) continue;
    const targetDocumentId = identities.documentIds[sourceDocument.documentId];
    if (!targetDocumentId) {
      throw new Error(
        `Ownership copy plan omitted Document ${sourceDocument.documentId}`,
      );
    }
    const registration = getOwnedDocumentSchemaRegistration({
      ownerType:
        closure.blocks.find(
          (block) => block.blockId === sourceDocument.ownerBlockId,
        )?.blockType ?? "",
      schemaKey: sourceDocument.schemaKey,
      schemaVersion: sourceDocument.schemaVersion,
    });
    if (registration.syncEngine === "canvas_scene") {
      const sourceHead = database
        .prepare(
          `SELECT generation, head_seq, schema_version
           FROM documents WHERE id = ? AND project_id = ?`,
        )
        .get(sourceDocument.documentId, request.projectId) as
        | {
            readonly generation: number;
            readonly head_seq: number;
            readonly schema_version: number;
          }
        | undefined;
      if (!sourceHead) {
        throw new Error(
          `Canvas ownership source disappeared: ${sourceDocument.documentId}`,
        );
      }
      const source = readCanvasSceneAuthoritySnapshot(database, {
        documentId: sourceDocument.documentId,
        generation: sourceHead.generation,
        headSeq: sourceHead.head_seq,
        schemaVersion: sourceHead.schema_version,
      });
      const initialized = initializeCanvasSceneAuthority(database, {
        projectId: request.projectId,
        documentId: targetDocumentId,
        expectedGeneration: 1,
        expectedHeadSeq: 0,
        scene: source.scene,
      });
      commits.push({
        documentId: targetDocumentId,
        generation: initialized.generation,
        baseHeadSeq: 0,
        headSeq: initialized.headSeq,
        updateId: deterministicSubOperationId(
          requestHash,
          `nested-genesis:${sha256(sourceDocument.documentId)}`,
        ),
        update: null,
        stateVector: new Uint8Array(),
      });
      continue;
    }
    const adapter = getRegisteredBlockDocumentSchemaAdapter({
      ownerType: registration.ownerType,
      schemaKey: registration.schemaKey,
      schemaVersion: registration.schemaVersion,
    });
    const materialization = database
      .prepare(
        `SELECT materialization.title_rich_json, materialization.block_tree_json
         FROM document_materializations materialization
         JOIN documents document ON document.id = materialization.document_id
         WHERE materialization.document_id = ?
           AND materialization.generation = document.generation
           AND materialization.projected_seq = document.head_seq`,
      )
      .get(sourceDocument.documentId) as
      | {
          readonly title_rich_json: string;
          readonly block_tree_json: string;
        }
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
      if (envelope.kind === "page") {
        replaceYTextWithPortableRichText(
          envelope.title,
          canonicalizePortableRichText(
            JSON.parse(materialization.title_rich_json),
          ),
        );
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

const readSqliteOwnershipClosure = (
  database: Database.Database,
  projectId: string,
  rootBlockIds: readonly string[],
): BlockOwnershipClosure =>
  planBlockOwnershipClosure(
    {
      readBlock: (blockId) =>
        (database
          .prepare(
            `SELECT id AS blockId, type AS blockType,
                    containing_document_id AS containingDocumentId
             FROM blocks WHERE id = ? AND project_id = ? AND lifecycle = 'active'`,
          )
          .get(blockId, projectId) as
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
          .get(ownerBlockId, projectId) as
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
          .all(documentId, projectId) as readonly {
          readonly blockId: string;
          readonly blockType: string;
          readonly containingDocumentId: string | null;
        }[],
    },
    rootBlockIds,
  );

const directCopiedDocumentOwnerIds = (
  closure: BlockOwnershipClosure,
  identities: BlockOwnershipCopyIdentityMap,
  sourceContainingDocumentId: string,
): readonly string[] =>
  closure.documents.flatMap((document) => {
    const sourceOwner = closure.blocks.find(
      (block) => block.blockId === document.ownerBlockId,
    );
    const targetOwnerId = identities.blockIds[document.ownerBlockId];
    return sourceOwner?.containingDocumentId === sourceContainingDocumentId &&
      targetOwnerId
      ? [targetOwnerId]
      : [];
  });

const copyDocumentBlockToDocument = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
): BlockCopyCompilation => {
  if (request.source.kind !== "document" || request.target.kind !== "document") {
    return reject(
      request,
      "unsupported_transfer",
      "Ordinary Block Copy requires a Document source and target",
    );
  }
  const source = readPromotionSource(database, request);
  const closure = readSqliteOwnershipClosure(
    database,
    request.projectId,
    source.blockIds,
  );
  const identities = allocateBlockOwnershipCopyIdentities(
    request.operationId,
    closure,
  );
  stageNestedOwnershipClosure(
    database,
    request,
    closure,
    identities,
    null,
    now,
    { [request.source.documentId]: request.target.documentId },
  );
  const targetCommit = runDocumentBatch(database, request, requestHash, {
    role: "copy-target-document",
    documentId: request.target.documentId,
    generation: request.target.generation,
    expectedHeadSeq: request.target.expectedHeadSeq,
    operations: [
      {
        kind: "insert_block",
        block: remapCopiedBlockTree([source.root], identities.blockIds)[0] as BlockTreeNode,
        ...(request.target.parentBlockId
          ? { parentBlockId: request.target.parentBlockId }
          : {}),
        ...(request.target.beforeBlockId
          ? { beforeBlockId: request.target.beforeBlockId }
          : {}),
      },
    ],
    stagedOwnerIds: directCopiedDocumentOwnerIds(
      closure,
      identities,
      request.source.documentId,
    ),
  });
  const nestedCommits = initializeNestedOwnershipDocuments(
    database,
    request,
    requestHash,
    closure,
    identities,
    null,
  );
  const copiedRootId = identities.blockIds[source.root.id];
  if (!copiedRootId) {
    throw new Error(`Copy identity plan omitted root Block ${source.root.id}`);
  }
  return {
    documentCommits: [targetCommit, ...nestedCommits],
    affectedDatabaseBlockIds: [],
    resultBlockIds: Object.values(identities.blockIds),
    resultRootBlockIds: [copiedRootId],
    copiedBlockIds: identities.blockIds,
  };
};

const copyDocumentRootsToDocument = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
): BlockCopyCompilation => {
  if (request.source.kind !== "document" || request.target.kind !== "document") {
    return reject(
      request,
      "unsupported_transfer",
      "Ordinary Block Copy requires a Document source and target",
    );
  }
  const sourceDocumentId = request.source.documentId;
  const targetDocumentId = request.target.documentId;
  let sourceHeadSeq = request.source.expectedHeadSeq;
  let targetHeadSeq = request.target.expectedHeadSeq;
  const commits: RelocationDocumentCommit[] = [];
  const resultBlockIds: string[] = [];
  const resultRootBlockIds: string[] = [];
  const copiedBlockIds: Record<string, string> = {};
  const evidence: BlockTransferTransformationEvidence[] = [];
  for (const rootBlockId of request.rootBlockIds) {
    const rootRequestHash = sha256(`${requestHash}\0root\0${rootBlockId}`);
    const singleRequest: BlockTransferRequest = {
      ...request,
      rootBlockIds: [rootBlockId],
      expectedLocationRevisions: {
        [rootBlockId]: request.expectedLocationRevisions[rootBlockId] as number,
      },
      source: { ...request.source, expectedHeadSeq: sourceHeadSeq },
      target: { ...request.target, expectedHeadSeq: targetHeadSeq },
    };
    const result = copyDocumentBlockToDocument(
      database,
      singleRequest,
      rootRequestHash,
      now,
    );
    commits.push(...result.documentCommits);
    resultBlockIds.push(...result.resultBlockIds);
    resultRootBlockIds.push(...result.resultRootBlockIds);
    Object.assign(copiedBlockIds, result.copiedBlockIds);
    evidence.push(...(result.transformationEvidence ?? []));
    const targetCommit = result.documentCommits.find(
      (commit) => commit.documentId === targetDocumentId,
    );
    if (!targetCommit) {
      throw new Error(`Block Copy omitted target commit for ${rootBlockId}`);
    }
    targetHeadSeq = targetCommit.headSeq;
    if (sourceDocumentId === targetDocumentId) {
      sourceHeadSeq = targetHeadSeq;
    }
  }
  return {
    documentCommits: commits,
    affectedDatabaseBlockIds: [],
    resultBlockIds,
    resultRootBlockIds,
    copiedBlockIds,
    transformationEvidence: evidence,
  };
};

const copyDocumentBlockToPageParent = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
  inject: (point: BlockTransferFaultPoint) => void,
): BlockCopyCompilation => {
  if (
    request.source.kind !== "document" ||
    (request.target.kind !== "database" && request.target.kind !== "space")
  ) {
    return reject(
      request,
      "unsupported_transfer",
      "Ordinary Block Copy coercion requires a Document-to-Page-parent transfer",
    );
  }
  const sourceDocumentId = request.source.documentId;
  const source = readPromotionSource(database, request);
  const closure = readSqliteOwnershipClosure(
    database,
    request.projectId,
    source.blockIds,
  );
  const identities = allocateBlockOwnershipCopyIdentities(
    request.operationId,
    closure,
  );
  const copiedSourceRootId = identities.blockIds[source.root.id];
  if (!copiedSourceRootId) {
    throw new Error(`Copy identity plan omitted root Block ${source.root.id}`);
  }
  const copiedRoot = remapCopiedBlockTree(
    [source.root],
    identities.blockIds,
  )[0] as BlockTreeNode;
  const transformation = planPageTransformation(
    request,
    copiedRoot,
    copiedSourceRootId,
  );
  if (transformation.kind === "already_page") {
    return reject(
      request,
      "unsupported_transfer",
      "Page Copy must use the recursive Page ownership compiler",
    );
  }
  const pageId = transformation.pageId;
  const pageDocumentId = stageWrapperPageDocument(
    database,
    request,
    requestHash,
    { pageId, richTitle: transformation.richTitle, now },
  );
  inject("after_page_owner_staged");
  inject("after_page_genesis");
  stageNestedOwnershipClosure(
    database,
    request,
    closure,
    identities,
    null,
    now,
    { [sourceDocumentId]: pageDocumentId },
  );
  inject("after_page_children_reparented");
  const directStagedOwnerIds = directCopiedDocumentOwnerIds(
    closure,
    identities,
    sourceDocumentId,
  );
  const bodyRoots = transformation.kind === "promote"
    ? transformation.bodyRoots
    : [transformation.wrappedRoot];
  const bodyCommit = runDocumentBatch(database, request, requestHash, {
    role:
      transformation.kind === "promote"
        ? "copy-page-body"
        : "copy-wrapper-body",
    documentId: pageDocumentId,
    generation: 1,
    expectedHeadSeq: 1,
    operations: bodyRoots.map((block) => ({
      kind: "insert_block" as const,
      block,
    })),
    stagedOwnerIds: directStagedOwnerIds,
  });
  inject("after_page_body");
  const nestedCommits = initializeNestedOwnershipDocuments(
    database,
    request,
    requestHash,
    closure,
    identities,
    null,
  );
  const pageRow = database
    .prepare(
      `SELECT id, project_id, type, lifecycle, location_kind,
              containing_document_id, containing_database_id,
              location_revision
       FROM blocks WHERE id = ?`,
    )
    .get(pageId) as BlockRow;
  const placementRequest: BlockTransferRequest = {
    ...request,
    rootBlockIds: [pageId],
    expectedLocationRevisions: { [pageId]: 1 },
    source: { kind: "space" },
  };
  const affectedDatabaseBlockIds = transitionPageParents(
    database,
    placementRequest,
    requestHash,
    [pageRow],
    now,
  );
  inject("after_parent_transition");
  return {
    documentCommits: [bodyCommit, ...nestedCommits],
    affectedDatabaseBlockIds,
    resultBlockIds: uniqueSorted([
      pageId,
      ...bodyRoots.flatMap(flattenBlockTreeIds),
      ...Object.values(identities.blockIds),
    ]),
    resultRootBlockIds: [pageId],
    copiedBlockIds: identities.blockIds,
    transformationEvidence: [
      transformationEvidence({
        source,
        transformation,
        sourceToResultBlockIds: identities.blockIds,
      }),
    ],
  };
};

const copyDocumentRootsToPageParent = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
  inject: (point: BlockTransferFaultPoint) => void,
): ReturnType<typeof copyDocumentBlockToPageParent> => {
  const commits: RelocationDocumentCommit[] = [];
  const affectedDatabases = new Set<string>();
  const resultBlockIds: string[] = [];
  const resultRootBlockIds: string[] = [];
  const copiedBlockIds: Record<string, string> = {};
  const evidence: BlockTransferTransformationEvidence[] = [];
  for (const rootBlockId of request.rootBlockIds) {
    const rootRequestHash = sha256(`${requestHash}\0root\0${rootBlockId}`);
    const result = copyDocumentBlockToPageParent(
      database,
      {
        ...request,
        rootBlockIds: [rootBlockId],
        expectedLocationRevisions: {
          [rootBlockId]: request.expectedLocationRevisions[rootBlockId] as number,
        },
      },
      rootRequestHash,
      now,
      inject,
    );
    commits.push(...result.documentCommits);
    result.affectedDatabaseBlockIds.forEach((id) => affectedDatabases.add(id));
    resultBlockIds.push(...result.resultBlockIds);
    resultRootBlockIds.push(...result.resultRootBlockIds);
    Object.assign(copiedBlockIds, result.copiedBlockIds);
    evidence.push(...(result.transformationEvidence ?? []));
  }
  return {
    documentCommits: commits,
    affectedDatabaseBlockIds: uniqueSorted([...affectedDatabases]),
    resultBlockIds,
    resultRootBlockIds,
    copiedBlockIds,
    transformationEvidence: evidence,
  };
};

const copyNonDatabasePage = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
  beforeTargetDocument?: (rootPageIds: readonly string[]) => void,
): {
  readonly documentCommits: readonly RelocationDocumentCommit[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly resultBlockIds: readonly string[];
  readonly resultRootBlockIds: readonly string[];
  readonly copiedBlockIds: Readonly<Record<string, string>>;
} => {
  if (request.source.kind === "database" || request.rootBlockIds.length !== 1) {
    return reject(
      request,
      "unsupported_transfer",
      "Non-Database Page Copy requires one Library or Page root",
    );
  }
  const sourcePageId = request.rootBlockIds[0];
  if (!sourcePageId) {
    return reject(request, "block_not_found", "Copy root is missing");
  }
  const closure = readSqliteOwnershipClosure(database, request.projectId, [
    sourcePageId,
  ]);
  const rootDocument = closure.documents.find(
    (document) => document.ownerBlockId === sourcePageId,
  );
  if (!rootDocument) {
    return reject(
      request,
      "recovery_required",
      `Page ${sourcePageId} has no owned Document`,
    );
  }
  const allocated = allocateBlockOwnershipCopyIdentities(
    request.operationId,
    closure,
  );
  const newPageId = allocated.blockIds[sourcePageId];
  if (!newPageId) throw new Error("Copy identity plan omitted Page root");
  const identities: BlockOwnershipCopyIdentityMap = {
    blockIds: allocated.blockIds,
    documentIds: {
      ...allocated.documentIds,
      [rootDocument.documentId]: `document:${newPageId}`,
    },
  };
  const sourceMaterialization = database
    .prepare(
      `SELECT title, title_rich_json, block_tree_json
       FROM document_materializations
       WHERE document_id = ?`,
    )
    .get(rootDocument.documentId) as
    | {
        readonly title: string;
        readonly title_rich_json: string;
        readonly block_tree_json: string;
      }
    | undefined;
  if (!sourceMaterialization) {
    return reject(
      request,
      "recovery_required",
      `Page ${sourcePageId} lacks a current materialization`,
    );
  }
  const targetDocumentId = stageWrapperPageDocument(
    database,
    request,
    requestHash,
    {
      pageId: newPageId,
      richTitle: canonicalizePortableRichText(
        JSON.parse(sourceMaterialization.title_rich_json),
      ),
      now,
    },
  );
  database
    .prepare("DELETE FROM block_properties WHERE block_id = ?")
    .run(newPageId);
  database
    .prepare(
      `INSERT INTO block_properties (
         block_id, project_id, property_key, value_type,
         value_json, revision, updated_at
       )
       SELECT ?, project_id, property_key, value_type,
              value_json, 1, ?
       FROM block_properties
       WHERE block_id = ? AND project_id = ?`,
    )
    .run(newPageId, now, sourcePageId, request.projectId);
  stageNestedOwnershipClosure(
    database,
    request,
    closure,
    identities,
    rootDocument.documentId,
    now,
  );
  const sourceRootTree = JSON.parse(
    sourceMaterialization.block_tree_json,
  ) as readonly BlockTreeNode[];
  const directStagedOwnerIds = closure.documents.flatMap((document) => {
    if (document.documentId === rootDocument.documentId) return [];
    const sourceOwner = closure.blocks.find(
      (block) => block.blockId === document.ownerBlockId,
    );
    const targetOwnerId = identities.blockIds[document.ownerBlockId];
    return sourceOwner?.containingDocumentId === rootDocument.documentId &&
      targetOwnerId
      ? [targetOwnerId]
      : [];
  });
  const rootCommit = runDocumentBatch(database, request, requestHash, {
    role: "copy-page-body",
    documentId: targetDocumentId,
    generation: 1,
    expectedHeadSeq: 1,
    operations: remapCopiedBlockTree(
      sourceRootTree,
      identities.blockIds,
    ).map((block) => ({ kind: "insert_block" as const, block })),
    stagedOwnerIds: directStagedOwnerIds,
  });
  const nestedCommits = initializeNestedOwnershipDocuments(
    database,
    request,
    requestHash,
    closure,
    identities,
    rootDocument.documentId,
  );
  const cloneRow = database
    .prepare(
      `SELECT id, project_id, type, lifecycle, location_kind,
              containing_document_id, containing_database_id,
              location_revision
       FROM blocks WHERE id = ?`,
    )
    .get(newPageId) as BlockRow;
  const placementRequest: BlockTransferRequest = {
    ...request,
    rootBlockIds: [newPageId],
    expectedLocationRevisions: { [newPageId]: 1 },
    source: { kind: "space" },
  };
  const affectedDatabaseBlockIds = transitionPageParents(
    database,
    placementRequest,
    requestHash,
    [cloneRow],
    now,
  );
  const documentCommits: RelocationDocumentCommit[] = [
    rootCommit,
    ...nestedCommits,
  ];
  if (request.target.kind === "document") {
    beforeTargetDocument?.([newPageId]);
    documentCommits.push(
      runDocumentBatch(database, placementRequest, requestHash, {
        role: "copy-page-target-document",
        documentId: request.target.documentId,
        generation: request.target.generation,
        expectedHeadSeq: request.target.expectedHeadSeq,
        operations: [
          {
            kind: "insert_block",
            block: {
              id: newPageId,
              type: "page",
              props: {},
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
        stagedOwnerIds: [newPageId],
      }),
    );
  }
  return {
    documentCommits,
    affectedDatabaseBlockIds,
    resultBlockIds: Object.values(identities.blockIds),
    resultRootBlockIds: [newPageId],
    copiedBlockIds: identities.blockIds,
  };
};

interface DatabaseTransferTargetAuthority {
  readonly databaseBlockId: string;
  readonly dataSourceId: DataSourceId;
  readonly viewId: DatabaseViewId;
  readonly groupPropertyId: DataSourcePropertyId | null;
}

const resolveDatabaseTransferTarget = (
  database: Database.Database,
  request: BlockTransferRequest & {
    readonly target: Extract<
      BlockTransferRequest["target"],
      { readonly kind: "database" }
    >;
  },
): DatabaseTransferTargetAuthority => {
  const view = database
    .prepare(
      `SELECT view.config_json, view.data_source_id,
              source.home_database_block_id
       FROM database_views view
       INNER JOIN data_sources source ON source.id = view.data_source_id
       WHERE view.id = ? AND view.database_block_id = ?
         AND view.lifecycle = 'active' AND source.lifecycle = 'active'`,
    )
    .get(
      request.target.viewId,
      request.target.databaseBlockId,
    ) as
      | {
          readonly config_json: string;
          readonly data_source_id: string;
          readonly home_database_block_id: string;
        }
      | undefined;
  if (
    !view ||
    view.home_database_block_id !== request.target.databaseBlockId ||
    (request.target.dataSourceId !== undefined &&
      request.target.dataSourceId !== view.data_source_id)
  ) {
    return reject(
      request,
      "target_not_found",
      `Target Database View is not active for the requested Data Source: ${request.target.viewId}`,
    );
  }
  let config;
  try {
    config = parseDatabaseViewConfigV2(JSON.parse(view.config_json));
  } catch {
    return reject(
      request,
      "recovery_required",
      `Target Database View config is invalid: ${request.target.viewId}`,
      { retryable: false, reloadRequired: true },
    );
  }
  return {
    databaseBlockId: request.target.databaseBlockId,
    dataSourceId: parseDataSourceId(view.data_source_id),
    viewId: parseDatabaseViewId(request.target.viewId),
    groupPropertyId: config.group
      ? parseDataSourcePropertyId(config.group.propertyId)
      : null,
  };
};

const applyDatabaseTransferOperations = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  role: string,
  operations: readonly DatabaseApplyOperationV2[],
): readonly string[] => {
  const result = applyDatabaseModuleV2(database, {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    operationId: deterministicSubOperationId(
      requestHash,
      role,
    ),
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    actor: request.actor,
    operations,
  });
  if (result.ok) return result.value.affectedDatabaseIds;
  return reject(request, "invalid_target", result.error.message, {
    retryable: result.error.retryable,
    reloadRequired: result.error.code.endsWith("conflict"),
  });
};

const compileDatabaseTargetPlacement = (
  database: Database.Database,
  request: BlockTransferRequest & {
    readonly target: Extract<
      BlockTransferRequest["target"],
      { readonly kind: "database" }
    >;
  },
  authority: DatabaseTransferTargetAuthority,
  pageId: string,
  afterParentTransfer: boolean,
): readonly DatabaseApplyOperationV2[] => {
  const operations: DatabaseApplyOperationV2[] = [];
  let groupedValueChanged = false;
  if (authority.groupPropertyId) {
    const property = database.prepare(`
      SELECT 1 AS present FROM data_source_properties
      WHERE data_source_id = ? AND id = ? AND lifecycle = 'active'
    `).get(authority.dataSourceId, authority.groupPropertyId);
    if (!property) {
      return reject(
        request,
        "invalid_target",
        `Target View grouping property is unavailable: ${authority.groupPropertyId}`,
      );
    }
    const stored = database.prepare(`
      SELECT value.revision, value.value_json
      FROM data_source_page_memberships membership
      LEFT JOIN data_source_property_values value
        ON value.data_source_id = membership.data_source_id
        AND value.membership_id = membership.id
        AND value.property_id = ?
      WHERE membership.data_source_id = ? AND membership.page_block_id = ?
    `).get(
      authority.groupPropertyId,
      authority.dataSourceId,
      pageId,
    ) as
      | { readonly revision: number | null; readonly value_json: string | null }
      | undefined;
    groupedValueChanged =
      stored?.value_json === null ||
      stored?.value_json === undefined ||
      stored.value_json !== stableStringifyDatabaseJson(request.target.groupKey);
    if (afterParentTransfer || groupedValueChanged) {
      operations.push({
        kind: "set_value",
        pageId,
        dataSourceId: authority.dataSourceId,
        propertyId: authority.groupPropertyId,
        expectedValueRevision:
          stored?.revision ??
          (afterParentTransfer &&
          isBuiltInDataSourcePropertyId(authority.groupPropertyId)
            ? 1
            : 0),
        value: request.target.groupKey,
      });
    }
  }
  const currentPosition = afterParentTransfer
    ? undefined
    : (database.prepare(`
        SELECT revision FROM database_view_page_positions
        WHERE view_id = ? AND page_block_id = ?
      `).get(authority.viewId, pageId) as
        | { readonly revision: number }
        | undefined);
  operations.push({
    kind: "position_page",
    viewId: authority.viewId,
    pageId,
    expectedPositionRevision:
      (currentPosition?.revision ?? 0) +
      (currentPosition && groupedValueChanged ? 1 : 0),
    groupKey: request.target.groupKey,
    ...(request.target.beforePageId
      ? { beforePageId: request.target.beforePageId }
      : {}),
  });
  return operations;
};

const positionCopiedPageInSameSource = (
  database: Database.Database,
  request: BlockTransferRequest & {
    readonly target: Extract<
      BlockTransferRequest["target"],
      { readonly kind: "database" }
    >;
  },
  requestHash: string,
  pageId: string,
  authority: DatabaseTransferTargetAuthority,
): void => {
  applyDatabaseTransferOperations(
    database,
    request,
    requestHash,
    "same-source-copy-position",
    compileDatabaseTargetPlacement(
      database,
      request,
      authority,
      pageId,
      false,
    ),
  );
};

const copyDatabasePage = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
  beforeTargetDocument?: (rootPageIds: readonly string[]) => void,
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
      "Recursive Copy compilation currently requires one Database Page root",
    );
  }
  const sourcePageId = request.rootBlockIds[0];
  if (!sourcePageId) {
    return reject(request, "block_not_found", "Copy root is missing");
  }
  const closure = readSqliteOwnershipClosure(database, request.projectId, [
    sourcePageId,
  ]);
  const allocatedIdentities = allocateBlockOwnershipCopyIdentities(
    request.operationId,
    closure,
  );
  const newPageId = allocatedIdentities.blockIds[sourcePageId];
  if (!newPageId) throw new Error("Copy identity plan omitted its root Page");
  const rootOwnedDocument = closure.documents.find(
    (document) => document.ownerBlockId === sourcePageId,
  );
  if (!rootOwnedDocument) {
    return reject(
      request,
      "recovery_required",
      `Page ${sourcePageId} has no owned Document in its closure`,
    );
  }
  const identities: BlockOwnershipCopyIdentityMap = {
    blockIds: allocatedIdentities.blockIds,
    documentIds: {
      ...allocatedIdentities.documentIds,
      [rootOwnedDocument.documentId]: `document:${newPageId}`,
    },
  };
  const source = database
    .prepare(
      `SELECT source.home_database_block_id AS database_block_id,
              membership.data_source_id, membership.id AS membership_id,
              position.rank_key,
              status_value.value_json AS status_json
       FROM data_source_page_memberships membership
       JOIN data_sources source ON source.id = membership.data_source_id
       JOIN database_containers container
         ON container.block_id = source.home_database_block_id
       JOIN database_views view
         ON view.id = container.default_view_id
        AND view.data_source_id = membership.data_source_id
        AND view.lifecycle = 'active'
       LEFT JOIN database_view_page_positions position
         ON position.view_id = view.id
        AND position.page_block_id = membership.page_block_id
       JOIN data_source_properties status_property
         ON status_property.data_source_id = membership.data_source_id
        AND status_property.id = 'status'
        AND status_property.lifecycle = 'active'
       JOIN data_source_property_values status_value
         ON status_value.data_source_id = membership.data_source_id
        AND status_value.membership_id = membership.id
        AND status_value.property_id = status_property.id
       WHERE membership.page_block_id = ? AND membership.removed_at IS NULL`,
    )
    .get(sourcePageId) as {
    readonly database_block_id: string;
    readonly data_source_id: string;
    readonly membership_id: string;
    readonly rank_key: string | null;
    readonly status_json: string;
  } | undefined;
  if (!source) {
    return reject(
      request,
      "source_parent_mismatch",
      `Page ${sourcePageId} has no active source Database membership and status`,
    );
  }
  const sourceStatus = JSON.parse(source.status_json) as unknown;
  if (!isWorkflowStatus(sourceStatus)) {
    return reject(
      request,
      "recovery_required",
      `Page ${sourcePageId} has an invalid source status`,
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
  const cloned = cloneAuthoritativePageInTransaction(
    database,
    {
      projectId: request.projectId,
      sourcePageId,
      newPageId,
      lifecycle: "active",
      status: sourceStatus,
      ...(source.rank_key ? { primaryViewRankKey: source.rank_key } : {}),
      operationId: deterministicSubOperationId(requestHash, "clone-page"),
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
    .get(newPageId) as BlockRow;
  let affectedDatabaseBlockIds: readonly string[] = [
    source.database_block_id,
  ];
  const targetAuthority =
    request.target.kind === "database"
      ? resolveDatabaseTransferTarget(
          database,
          request as BlockTransferRequest & {
            readonly target: Extract<
              BlockTransferRequest["target"],
              { readonly kind: "database" }
            >;
          },
        )
      : null;
  const sameSourceTarget =
    targetAuthority?.dataSourceId === source.data_source_id;
  const copyPlacementRequest: BlockTransferRequest = {
    ...request,
    rootBlockIds: [newPageId],
    expectedLocationRevisions: { [newPageId]: 1 },
    source: {
      kind: "database",
      databaseBlockId: source.database_block_id,
      dataSourceId: source.data_source_id,
      memberships: {
        [newPageId]: { membershipId: cloned.membershipId, revision: 1 },
      },
    },
  };
  if (!sameSourceTarget) {
    affectedDatabaseBlockIds = uniqueSorted([
      ...affectedDatabaseBlockIds,
      ...transitionPageParents(
        database,
        copyPlacementRequest,
        requestHash,
        [cloneRow],
        now,
      ),
    ]);
  } else if (request.target.kind === "database" && targetAuthority) {
    positionCopiedPageInSameSource(
      database,
      request as BlockTransferRequest & {
        readonly target: Extract<
          BlockTransferRequest["target"],
          { readonly kind: "database" }
        >;
      },
      requestHash,
      newPageId,
      targetAuthority,
    );
  }
  const documentCommits: RelocationDocumentCommit[] = [
    readDocumentCommitAt(database, cloned.documentId, 1, cloned.documentHeadSeq),
    ...nestedDocumentCommits,
  ];
  if (request.target.kind === "document") {
    beforeTargetDocument?.([newPageId]);
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
              id: newPageId,
              type: "page",
              props: {},
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
        stagedOwnerIds: [newPageId],
      }),
    );
  }
  return {
    documentCommits,
    affectedDatabaseBlockIds,
    resultBlockIds: Object.values(identities.blockIds),
    resultRootBlockIds: [newPageId],
    copiedBlockIds: identities.blockIds,
  };
};

const copyPageRoots = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  now: string,
  beforeTargetDocument?: (rootPageIds: readonly string[]) => void,
): BlockCopyCompilation => {
  let sourceHeadSeq =
    request.source.kind === "document"
      ? request.source.expectedHeadSeq
      : undefined;
  let targetHeadSeq =
    request.target.kind === "document"
      ? request.target.expectedHeadSeq
      : undefined;
  const commits: RelocationDocumentCommit[] = [];
  const affectedDatabases = new Set<string>();
  const resultBlockIds: string[] = [];
  const resultRootBlockIds: string[] = [];
  const copiedBlockIds: Record<string, string> = {};
  for (const rootBlockId of request.rootBlockIds) {
    const rootRequestHash = sha256(`${requestHash}\0root\0${rootBlockId}`);
    const source =
      request.source.kind === "database"
        ? {
            ...request.source,
            memberships: {
              [rootBlockId]: request.source.memberships[rootBlockId] as {
                readonly membershipId: string;
                readonly revision: number;
              },
            },
          }
        : request.source.kind === "document"
          ? { ...request.source, expectedHeadSeq: sourceHeadSeq as number }
          : request.source;
    const target =
      request.target.kind === "document"
        ? { ...request.target, expectedHeadSeq: targetHeadSeq as number }
        : request.target;
    const singleRequest: BlockTransferRequest = {
      ...request,
      rootBlockIds: [rootBlockId],
      expectedLocationRevisions: {
        [rootBlockId]: request.expectedLocationRevisions[rootBlockId] as number,
      },
      source,
      target,
    };
    const result =
      source.kind === "database"
        ? copyDatabasePage(
            database,
            singleRequest,
            rootRequestHash,
            now,
            beforeTargetDocument,
          )
        : copyNonDatabasePage(
            database,
            singleRequest,
            rootRequestHash,
            now,
            beforeTargetDocument,
          );
    commits.push(...result.documentCommits);
    result.affectedDatabaseBlockIds.forEach((id) => affectedDatabases.add(id));
    resultBlockIds.push(...result.resultBlockIds);
    resultRootBlockIds.push(...result.resultRootBlockIds);
    Object.assign(copiedBlockIds, result.copiedBlockIds);
    if (request.target.kind !== "document") continue;
    const targetDocumentId = request.target.documentId;
    const targetCommit = result.documentCommits.find(
      (commit) => commit.documentId === targetDocumentId,
    );
    if (!targetCommit) {
      throw new Error(`Page Copy omitted target commit for ${rootBlockId}`);
    }
    targetHeadSeq = targetCommit.headSeq;
    if (
      request.source.kind === "document" &&
      request.source.documentId === targetDocumentId
    ) {
      sourceHeadSeq = targetHeadSeq;
    }
  }
  return {
    documentCommits: commits,
    affectedDatabaseBlockIds: uniqueSorted([...affectedDatabases]),
    resultBlockIds,
    resultRootBlockIds,
    copiedBlockIds,
  };
};

const copyDocumentSelection = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  rows: readonly BlockRow[],
  now: string,
  inject: (point: BlockTransferFaultPoint) => void,
): BlockCopyCompilation => {
  if (request.source.kind !== "document") {
    return reject(
      request,
      "unsupported_transfer",
      "Document selection Copy requires a Document source",
    );
  }
  const sourceDocumentId = request.source.documentId;
  const targetDocumentId =
    request.target.kind === "document" ? request.target.documentId : null;
  let sourceHeadSeq = request.source.expectedHeadSeq;
  let targetHeadSeq =
    request.target.kind === "document"
      ? request.target.expectedHeadSeq
      : undefined;
  const commits: RelocationDocumentCommit[] = [];
  const affectedDatabases = new Set<string>();
  const resultBlockIds: string[] = [];
  const resultRootBlockIds: string[] = [];
  const copiedBlockIds: Record<string, string> = {};
  const evidence: BlockTransferTransformationEvidence[] = [];
  for (const rootBlockId of request.rootBlockIds) {
    const row = rows.find((candidate) => candidate.id === rootBlockId);
    if (!row) {
      return reject(
        request,
        "block_not_found",
        `Copy root disappeared during compilation: ${rootBlockId}`,
      );
    }
    const rootRequestHash = sha256(`${requestHash}\0root\0${rootBlockId}`);
    const singleRequest: BlockTransferRequest = {
      ...request,
      rootBlockIds: [rootBlockId],
      expectedLocationRevisions: {
        [rootBlockId]: request.expectedLocationRevisions[rootBlockId] as number,
      },
      source: { ...request.source, expectedHeadSeq: sourceHeadSeq },
      target:
        request.target.kind === "document"
          ? { ...request.target, expectedHeadSeq: targetHeadSeq as number }
          : request.target,
    };
    const result =
      row.type === "page"
        ? copyPageRoots(database, singleRequest, rootRequestHash, now)
        : request.target.kind === "document"
          ? copyDocumentRootsToDocument(
              database,
              singleRequest,
              rootRequestHash,
              now,
            )
          : copyDocumentRootsToPageParent(
              database,
              singleRequest,
              rootRequestHash,
              now,
              inject,
            );
    commits.push(...result.documentCommits);
    result.affectedDatabaseBlockIds.forEach((id) => affectedDatabases.add(id));
    resultBlockIds.push(...result.resultBlockIds);
    resultRootBlockIds.push(...result.resultRootBlockIds);
    Object.assign(copiedBlockIds, result.copiedBlockIds);
    evidence.push(...(result.transformationEvidence ?? []));
    if (!targetDocumentId) continue;
    const targetCommit = result.documentCommits.find(
      (commit) => commit.documentId === targetDocumentId,
    );
    if (!targetCommit) {
      throw new Error(`Selection Copy omitted target commit for ${rootBlockId}`);
    }
    targetHeadSeq = targetCommit.headSeq;
    if (sourceDocumentId === targetDocumentId) {
      sourceHeadSeq = targetHeadSeq;
    }
  }
  return {
    documentCommits: commits,
    affectedDatabaseBlockIds: uniqueSorted([...affectedDatabases]),
    resultBlockIds,
    resultRootBlockIds,
    copiedBlockIds,
    transformationEvidence: evidence,
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

const readProjectLibraryForTransfer = (
  database: Database.Database,
  request: BlockTransferRequest,
): string => {
  const project = database.prepare(`
    SELECT library_id FROM projects WHERE id = ?
  `).get(request.projectId) as { readonly library_id: string } | undefined;
  if (project) return project.library_id;
  return reject(
    request,
    "project_not_found",
    `Project does not exist: ${request.projectId}`,
  );
};

const readDocumentOwnerPageId = (
  database: Database.Database,
  documentId: string,
): string | null =>
  (
    database.prepare(`
      SELECT page.block_id
      FROM pages page
      WHERE page.document_id = ? AND page.lifecycle <> 'deleted'
    `).get(documentId) as { readonly block_id: string } | undefined
  )?.block_id ?? null;

const applyCanonicalPageParentTransition = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  row: BlockRow,
  now: string,
): readonly string[] => {
  const sourceMembership =
    request.source.kind === "database"
      ? request.source.memberships[row.id]
      : undefined;
  const targetAuthority =
    request.target.kind === "database"
      ? resolveDatabaseTransferTarget(
          database,
          request as BlockTransferRequest & {
            readonly target: Extract<
              BlockTransferRequest["target"],
              { readonly kind: "database" }
            >;
          },
        )
      : null;
  const targetDocumentOwnerId =
    request.target.kind === "document"
      ? readDocumentOwnerPageId(database, request.target.documentId)
      : null;
  const libraryId = readProjectLibraryForTransfer(database, request);
  const transfer: TransferDataSourcePageOperationV2 = {
    kind: "transfer_page",
    pageId: row.id,
    expectedParentRevision: row.location_revision,
    expectedActiveMembershipRevision: sourceMembership?.revision ?? 0,
    target: targetAuthority
      ? { kind: "data_source", dataSourceId: targetAuthority.dataSourceId }
      : targetDocumentOwnerId
        ? { kind: "page", pageId: targetDocumentOwnerId }
        : { kind: "library", libraryId },
  };
  const placementOperations: DatabaseApplyOperationV2[] = [];
  if (request.target.kind === "database" && targetAuthority) {
    placementOperations.push(
      ...compileDatabaseTargetPlacement(
        database,
        request as BlockTransferRequest & {
          readonly target: Extract<
            BlockTransferRequest["target"],
            { readonly kind: "database" }
          >;
        },
        targetAuthority,
        row.id,
        true,
      ),
    );
  }
  const currentParent = database.prepare(`
    SELECT parent_kind FROM pages WHERE block_id = ?
  `).get(row.id) as { readonly parent_kind: string } | undefined;
  if (!currentParent) {
    return reject(
      request,
      "recovery_required",
      `Page ${row.id} has no canonical parent authority`,
      { retryable: false, reloadRequired: true },
    );
  }
  const compatibilityProjection = database.prepare(`
    SELECT 1 AS present FROM page_read_model WHERE page_block_id = ?
  `).get(row.id);
  if (!compatibilityProjection) {
    rebuildPageReadModelProjection(database, request.projectId, [row.id]);
    refreshScheduledPageIndexProjection(
      database,
      request.projectId,
      [row.id],
      now,
    );
  }
  const moduleRequest: DatabaseApplyV2 = {
    version: DATABASE_MODULE_V2_CONTRACT_VERSION,
    operationId: deterministicSubOperationId(
      requestHash,
      `database-parent:${sha256(row.id)}`,
    ),
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    actor: request.actor,
    operations: [transfer],
  };
  const result = transitionPageParentForBlockTransferV2(
    database,
    moduleRequest,
    transfer,
    now,
  );
  if (!result.ok) {
    return reject(request, "invalid_target", result.error.message, {
      retryable: result.error.retryable,
      reloadRequired: result.error.code.endsWith("conflict"),
    });
  }
  let affectedDatabaseBlockIds: readonly string[] =
    result.value.affectedDatabaseIds;
  if (placementOperations.length > 0) {
    affectedDatabaseBlockIds = uniqueSorted([
      ...affectedDatabaseBlockIds,
      ...applyDatabaseTransferOperations(
        database,
        request,
        requestHash,
        `database-position:${sha256(row.id)}`,
        placementOperations,
      ),
    ]);
  }

  if (request.target.kind === "space" && request.target.beforeBlockId) {
    database.prepare(`
      DELETE FROM top_level_block_placements WHERE block_id = ?
    `).run(row.id);
    allocateSpacePlacement(
      database,
      request,
      row.id,
      request.target.beforeBlockId,
      now,
    );
  }
  if (request.target.kind !== "document" || targetDocumentOwnerId) {
    return affectedDatabaseBlockIds;
  }
  database.prepare(`
    DELETE FROM top_level_block_placements WHERE block_id = ?
  `).run(row.id);
  const adapted = database.prepare(`
    UPDATE blocks
    SET location_kind = 'document', containing_document_id = ?,
      containing_database_id = NULL, updated_at = ?
    WHERE id = ? AND project_id = ? AND type = 'page'
      AND location_revision = ?
  `).run(
    request.target.documentId,
    now,
    row.id,
    request.projectId,
    row.location_revision + 1,
  );
  if (adapted.changes === 1) return affectedDatabaseBlockIds;
  return reject(
    request,
    "location_revision_mismatch",
    `Page ${row.id} moved while adapting its Document parent`,
    { retryable: true, reloadRequired: true },
  );
};

const transitionPageParents = (
  database: Database.Database,
  request: BlockTransferRequest,
  requestHash: string,
  rows: readonly BlockRow[],
  now: string,
): readonly string[] => {
  const affectedDatabases = new Set<string>();
  for (const row of rows) {
    const databaseBlockIds = applyCanonicalPageParentTransition(
      database,
      request,
      requestHash,
      row,
      now,
    );
    databaseBlockIds.forEach((id) =>
      affectedDatabases.add(id),
    );
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
  transformationEvidence: readonly BlockTransferTransformationEvidence[],
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
        transformationEvidence,
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

const captureTransferDocumentRevisions = (
  database: Database.Database,
  request: BlockTransferRequest,
  documentCommits: readonly RelocationDocumentCommit[],
  changeLogSeq: number,
): void => {
  const finalCommits = new Map<string, RelocationDocumentCommit>();
  for (const commit of documentCommits) {
    const current = finalCommits.get(commit.documentId);
    if (!current || current.headSeq < commit.headSeq) {
      finalCommits.set(commit.documentId, commit);
    }
  }
  const readAuthority = database.prepare(
    `SELECT document.project_id, document.generation, document.head_seq, document.readiness,
       owner.lifecycle AS owner_lifecycle
     FROM documents document
     INNER JOIN block_documents ownership
       ON ownership.document_id = document.id
       AND ownership.project_id = document.project_id
     INNER JOIN blocks owner
       ON owner.id = ownership.block_id
       AND owner.project_id = ownership.project_id
     WHERE document.id = ?`,
  );
  for (const commit of finalCommits.values()) {
    const authority = readAuthority.get(commit.documentId) as
      | {
          readonly project_id: string;
          readonly generation: number;
          readonly head_seq: number;
          readonly readiness: string;
          readonly owner_lifecycle: string;
        }
      | undefined;
    if (
      !authority ||
      authority.readiness !== "ready" ||
      authority.owner_lifecycle !== "active"
    ) {
      continue;
    }
    if (
      authority.generation !== commit.generation ||
      authority.head_seq !== commit.headSeq
    ) {
      throw new Error(
        `Block transfer ${request.operationId} cannot snapshot divergent Document ${commit.documentId}`,
      );
    }
    const revision = createDocumentVersionCheckpoint(database, {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      projectId: authority.project_id,
      storeEpoch: request.storeEpoch,
      documentId: commit.documentId,
      expectedGeneration: commit.generation,
      expectedHeadSeq: commit.headSeq,
      cause: MUTATION_KIND,
      revisionKind: "operation",
      sourceMutationId: request.operationId,
      sourceChangeSeq: changeLogSeq,
      actor: request.actor as DocumentVersionActor,
    });
    markDocumentRevisionSessionCheckpoint(database, {
      documentId: commit.documentId,
      generation: commit.generation,
      checkpointHeadSeq: revision.checkpoint.baseHeadSeq,
      createdAt: revision.checkpoint.createdAt,
      finalize: true,
    });
  }
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
    transformationEvidence: receipt.transformationEvidence ?? [],
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

const preparationFailure = <Value>(
  intent: Pick<BlockTransferIntent, "operationId">,
  code: BlockTransferCommandError["code"],
  message: string,
  options: Pick<
    BlockTransferCommandError,
    "retryable" | "reloadRequired"
  > = { retryable: false, reloadRequired: false },
): BlockTransferCommandResult<Value> => ({
  ok: false,
  error: {
    code,
    message,
    operationId: intent.operationId,
    retryable: options.retryable,
    reloadRequired: options.reloadRequired,
  },
});

type PreparedTransferSource =
  | { readonly kind: "space"; readonly libraryId: string }
  | {
      readonly kind: "document";
      readonly documentId: string;
      readonly pageId?: string;
    }
  | {
      readonly kind: "database";
      readonly databaseBlockId: string;
      readonly dataSourceId: string;
    };

type PreparedTransferTarget =
  | {
      readonly kind: "space";
      readonly libraryId: string;
      readonly beforeBlockId?: string;
    }
  | {
      readonly kind: "document";
      readonly documentId: string;
      readonly pageId?: string;
      readonly parentBlockId?: string;
      readonly beforeBlockId?: string;
    }
  | {
      readonly kind: "database";
      readonly databaseBlockId: string;
      readonly dataSourceId: string;
      readonly viewId: string;
      readonly groupKey: string | null;
      readonly beforePageId?: string;
    };

const readProjectLibraryId = (
  database: Database.Database,
  intent: BlockTransferIntent,
): string => {
  const project = database.prepare(`
    SELECT library_id AS libraryId FROM projects WHERE id = ?
  `).get(intent.projectId) as { readonly libraryId: string } | undefined;
  if (project) return project.libraryId;
  return reject(
    intent,
    "project_not_found",
    `Project does not exist: ${intent.projectId}`,
  );
};

const requireIntentLibrary = (
  intent: BlockTransferIntent,
  projectLibraryId: string,
  libraryId: string,
): void => {
  if (libraryId === projectLibraryId) return;
  reject(
    intent,
    "source_parent_mismatch",
    `Transfer resource belongs to another Library: ${libraryId}`,
  );
};

const resolvePageDocumentParent = (
  database: Database.Database,
  intent: BlockTransferIntent,
  projectLibraryId: string,
  pageId: string,
  role: "source" | "target",
): {
  readonly kind: "document";
  readonly documentId: string;
  readonly pageId: string;
} => {
  const page = database.prepare(`
    SELECT library_id AS libraryId, document_id AS documentId, lifecycle
    FROM pages WHERE block_id = ?
  `).get(pageId) as
    | {
        readonly libraryId: string;
        readonly documentId: string;
        readonly lifecycle: "active" | "archived" | "deleted";
      }
    | undefined;
  if (!page || page.lifecycle === "deleted") {
    return reject(
      intent,
      role === "target" ? "target_not_found" : "block_not_found",
      `${role === "target" ? "Target" : "Source"} Page does not exist: ${pageId}`,
    );
  }
  requireIntentLibrary(intent, projectLibraryId, page.libraryId);
  return { kind: "document", documentId: page.documentId, pageId };
};

const resolveDataSourceParent = (
  database: Database.Database,
  intent: BlockTransferIntent,
  projectLibraryId: string,
  dataSourceId: string,
  role: "source" | "target",
): {
  readonly kind: "database";
  readonly databaseBlockId: string;
  readonly dataSourceId: string;
} => {
  const source = database.prepare(`
    SELECT library_id AS libraryId,
      home_database_block_id AS databaseBlockId, lifecycle
    FROM data_sources WHERE id = ?
  `).get(dataSourceId) as
    | {
        readonly libraryId: string;
        readonly databaseBlockId: string;
        readonly lifecycle: "active" | "archived" | "deleted";
      }
    | undefined;
  if (!source || source.lifecycle !== "active") {
    return reject(
      intent,
      role === "target" ? "target_not_found" : "block_not_found",
      `${role === "target" ? "Target" : "Source"} Data Source does not exist: ${dataSourceId}`,
    );
  }
  requireIntentLibrary(intent, projectLibraryId, source.libraryId);
  return {
    kind: "database",
    databaseBlockId: source.databaseBlockId,
    dataSourceId,
  };
};

const resolvePreparationSource = (
  database: Database.Database,
  intent: BlockTransferIntent,
  projectLibraryId: string,
): PreparedTransferSource => {
  if (intent.source.kind === "library") {
    requireIntentLibrary(intent, projectLibraryId, intent.source.libraryId);
    return { kind: "space", libraryId: intent.source.libraryId };
  }
  if (intent.source.kind === "page") {
    return resolvePageDocumentParent(
      database,
      intent,
      projectLibraryId,
      intent.source.pageId,
      "source",
    );
  }
  if (intent.source.kind === "document") {
    return { kind: "document", documentId: intent.source.documentId };
  }
  return resolveDataSourceParent(
    database,
    intent,
    projectLibraryId,
    intent.source.dataSourceId,
    "source",
  );
};

const resolvePreparationTarget = (
  database: Database.Database,
  intent: BlockTransferIntent,
  projectLibraryId: string,
): PreparedTransferTarget => {
  if (intent.target.kind === "library") {
    requireIntentLibrary(intent, projectLibraryId, intent.target.libraryId);
    return {
      kind: "space",
      libraryId: intent.target.libraryId,
      ...(intent.target.beforeBlockId
        ? { beforeBlockId: intent.target.beforeBlockId }
        : {}),
    };
  }
  if (intent.target.kind === "page") {
    return {
      ...resolvePageDocumentParent(
        database,
        intent,
        projectLibraryId,
        intent.target.pageId,
        "target",
      ),
      ...(intent.target.parentBlockId
        ? { parentBlockId: intent.target.parentBlockId }
        : {}),
      ...(intent.target.beforeBlockId
        ? { beforeBlockId: intent.target.beforeBlockId }
        : {}),
    };
  }
  if (intent.target.kind === "document") {
    return { ...intent.target };
  }
  const source = resolveDataSourceParent(
    database,
    intent,
    projectLibraryId,
    intent.target.dataSourceId,
    "target",
  );
  const view = database.prepare(`
    SELECT 1 AS present FROM database_views
    WHERE id = ? AND data_source_id = ? AND database_block_id = ?
      AND lifecycle = 'active'
  `).get(
    intent.target.viewId,
    intent.target.dataSourceId,
    source.databaseBlockId,
  );
  if (!view) {
    return reject(
      intent,
      "invalid_target",
      `View ${intent.target.viewId} does not target Data Source ${intent.target.dataSourceId}`,
    );
  }
  return {
    ...source,
    viewId: intent.target.viewId,
    groupKey: intent.target.groupKey,
    ...(intent.target.beforePageId
      ? { beforePageId: intent.target.beforePageId }
      : {}),
  };
};

const readDocumentHeadForTransfer = (
  database: Database.Database,
  intent: BlockTransferIntent,
  documentId: string,
  role: "source" | "target" | "owned",
): BlockTransferDocumentHead => {
  const row = database
    .prepare(
      `SELECT generation, head_seq, project_id, readiness, authority
       FROM documents WHERE id = ?`,
    )
    .get(documentId) as
    | {
        readonly generation: number;
        readonly head_seq: number;
        readonly project_id: string;
        readonly readiness: string;
        readonly authority: string;
      }
    | undefined;
  if (!row) {
    return reject(
      intent,
      role === "target" ? "target_not_found" : "block_not_found",
      `${role === "target" ? "Target" : "Source"} Document does not exist in this Project: ${documentId}`,
    );
  }
  if (row.project_id !== intent.projectId) {
    const libraries = database.prepare(`
      SELECT source.library_id AS sourceLibraryId,
        target.library_id AS targetLibraryId
      FROM projects source
      INNER JOIN projects target ON target.id = ?
      WHERE source.id = ?
    `).get(row.project_id, intent.projectId) as
      | {
          readonly sourceLibraryId: string;
          readonly targetLibraryId: string;
        }
      | undefined;
    if (
      role !== "target" ||
      libraries?.sourceLibraryId !== libraries?.targetLibraryId
    ) {
      return reject(
        intent,
        role === "target" ? "target_not_found" : "block_not_found",
        `${role === "target" ? "Target" : "Source"} Document does not exist in this Project: ${documentId}`,
      );
    }
  }
  if (row.readiness !== "ready" || row.authority !== "ydoc_primary") {
    reject(
      intent,
      "recovery_required",
      `Document ${documentId} is not ready Y.Doc authority`,
      { retryable: false, reloadRequired: true },
    );
  }
  return {
    documentId,
    generation: row.generation,
    expectedHeadSeq: row.head_seq,
  };
};

const readPreparationBlockRows = (
  database: Database.Database,
  intent: BlockTransferIntent,
  source: PreparedTransferSource,
): readonly BlockRow[] => {
  const read = database.prepare(`
    SELECT id, project_id, type, lifecycle, location_kind,
           containing_document_id, containing_database_id, location_revision
    FROM blocks WHERE id = ?
  `);
  return intent.rootBlockIds.map((blockId) => {
    const row = read.get(blockId) as BlockRow | undefined;
    if (!row) {
      return reject(
        intent,
        "block_not_found",
        `Transferred Block does not exist: ${blockId}`,
      );
    }
    if (row.project_id !== intent.projectId) {
      reject(intent, "source_parent_mismatch", `Block ${blockId} belongs to another Project`);
    }
    if (row.lifecycle !== "active") {
      reject(intent, "block_not_active", `Block ${blockId} is not active`);
    }
    const matches =
      source.kind === "space"
        ? row.location_kind === "space"
        : source.kind === "document"
          ? row.location_kind === "document" &&
            row.containing_document_id === source.documentId
          : row.location_kind === "database" &&
            row.containing_database_id === source.databaseBlockId;
    if (!matches) {
      reject(
        intent,
        "source_parent_mismatch",
        `Block ${blockId} no longer belongs to the requested source parent`,
        { retryable: true, reloadRequired: true },
      );
    }
    return row;
  });
};

const readOwnedDocumentHeads = (
  database: Database.Database,
  intent: BlockTransferIntent,
): readonly BlockTransferDocumentHead[] => {
  if (intent.mode !== "copy") return [];
  const read = database.prepare(`
    WITH RECURSIVE closure(block_id) AS (
      VALUES (?)
      UNION
      SELECT child.id
      FROM closure current
      INNER JOIN block_documents ownership
        ON ownership.block_id = current.block_id
      INNER JOIN blocks child
        ON child.containing_document_id = ownership.document_id
    )
    SELECT document.id
    FROM closure
    INNER JOIN block_documents ownership
      ON ownership.block_id = closure.block_id
    INNER JOIN documents document
      ON document.id = ownership.document_id
    ORDER BY document.id
  `);
  const documentIds = new Set<string>();
  for (const rootBlockId of intent.rootBlockIds) {
    const rows = read.all(rootBlockId) as readonly { readonly id: string }[];
    rows.forEach((row) => documentIds.add(row.id));
  }
  return [...documentIds]
    .sort((left, right) => left.localeCompare(right))
    .map((documentId) =>
      readDocumentHeadForTransfer(database, intent, documentId, "owned"),
    );
};

const uniqueDocumentHeads = (
  heads: readonly BlockTransferDocumentHead[],
): readonly BlockTransferDocumentHead[] => {
  const byId = new Map<string, BlockTransferDocumentHead>();
  for (const head of heads) {
    const existing = byId.get(head.documentId);
    if (
      existing &&
      (existing.generation !== head.generation ||
        existing.expectedHeadSeq !== head.expectedHeadSeq)
    ) {
      throw new Error(`Conflicting prepared head for Document ${head.documentId}`);
    }
    byId.set(head.documentId, head);
  }
  return [...byId.values()].sort((left, right) =>
    left.documentId.localeCompare(right.documentId),
  );
};

/** Compile a public logical parent intent into exact current SQLite authority. */
export const prepareBlockTransfer = (
  database: Database.Database,
  rawIntent: BlockTransferIntent,
): BlockTransferCommandResult<BlockTransferPreparation> => {
  let intent: BlockTransferIntent;
  try {
    intent = parseBlockTransferIntent(rawIntent);
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
  try {
    if (readStoreEpoch(database) !== intent.storeEpoch) {
      return preparationFailure(
        intent,
        "store_epoch_mismatch",
        `Transfer belongs to store epoch ${intent.storeEpoch}`,
        { retryable: false, reloadRequired: true },
      );
    }
    const projectLibraryId = readProjectLibraryId(database, intent);
    const preparedSource = resolvePreparationSource(
      database,
      intent,
      projectLibraryId,
    );
    const preparedTarget = resolvePreparationTarget(
      database,
      intent,
      projectLibraryId,
    );
    const rows = readPreparationBlockRows(database, intent, preparedSource);
    assertMovePreservesPageHierarchy(
      database,
      intent,
      rows,
      preparedTarget,
    );
    const expectedLocationRevisions = Object.fromEntries(
      rows.map((row) => [row.id, row.location_revision]),
    );
    const source = (() => {
      if (preparedSource.kind === "space") return { ...preparedSource };
      if (preparedSource.kind === "document") {
        const head = readDocumentHeadForTransfer(
          database,
          intent,
          preparedSource.documentId,
          "source",
        );
        return {
          kind: "document" as const,
          documentId: head.documentId,
          ...(preparedSource.pageId
            ? { pageId: preparedSource.pageId }
            : {}),
          generation: head.generation,
          expectedHeadSeq: head.expectedHeadSeq,
        };
      }
      const readMembership = database.prepare(`
        SELECT id, revision
        FROM data_source_page_memberships
        WHERE page_block_id = ? AND data_source_id = ?
          AND removed_at IS NULL
      `);
      return {
        kind: "database" as const,
        databaseBlockId: preparedSource.databaseBlockId,
        dataSourceId: preparedSource.dataSourceId,
        memberships: Object.fromEntries(
          rows.map((row) => {
            const membership = readMembership.get(
              row.id,
              preparedSource.dataSourceId,
            ) as { readonly id: string; readonly revision: number } | undefined;
            if (!membership) {
              return reject(
                intent,
                "source_parent_mismatch",
                `Page ${row.id} has no active source Database membership`,
                { retryable: true, reloadRequired: true },
              );
            }
            return [
              row.id,
              { membershipId: membership.id, revision: membership.revision },
            ];
          }),
        ),
      };
    })();
    const target = (() => {
      if (preparedTarget.kind === "space") return { ...preparedTarget };
      if (preparedTarget.kind === "database") return { ...preparedTarget };
      const head = readDocumentHeadForTransfer(
        database,
        intent,
        preparedTarget.documentId,
        "target",
      );
      return {
        ...preparedTarget,
        generation: head.generation,
        expectedHeadSeq: head.expectedHeadSeq,
      };
    })();
    const request = parseBlockTransferRequest({
      ...intent,
      version: BLOCK_TRANSFER_CONTRACT_VERSION,
      expectedLocationRevisions,
      source,
      target,
    });
    const leaseDocuments = uniqueDocumentHeads([
      ...(source.kind === "document"
        ? [
            {
              documentId: source.documentId,
              generation: source.generation,
              expectedHeadSeq: source.expectedHeadSeq,
            },
          ]
        : []),
      ...(target.kind === "document"
        ? [
            {
              documentId: target.documentId,
              generation: target.generation,
              expectedHeadSeq: target.expectedHeadSeq,
            },
          ]
        : []),
      ...readOwnedDocumentHeads(database, intent),
    ]);
    return { ok: true, value: { request, leaseDocuments } };
  } catch (error) {
    if (error instanceof BlockTransferRejection) {
      return { ok: false, error: error.commandError };
    }
    throw error;
  }
};

/** Resolve a response-loss retry without re-reading a source that already moved. */
export const readCommittedBlockTransfer = (
  database: Database.Database,
  rawIntent: BlockTransferIntent,
): BlockTransferCommandResult<BlockTransferReceipt | null> => {
  let intent: BlockTransferIntent;
  try {
    intent = parseBlockTransferIntent(rawIntent);
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
  if (readStoreEpoch(database) !== intent.storeEpoch) {
    return preparationFailure(
      intent,
      "store_epoch_mismatch",
      `Transfer belongs to store epoch ${intent.storeEpoch}`,
      { retryable: false, reloadRequired: true },
    );
  }
  const stored = readStoredMutation(database, intent.operationId);
  if (!stored) return { ok: true, value: null };
  if (
    stored.project_id !== intent.projectId ||
    stored.store_epoch !== intent.storeEpoch ||
    stored.mutation_kind !== MUTATION_KIND
  ) {
    return preparationFailure(
      intent,
      "operation_id_collision",
      `Operation ID ${intent.operationId} is already used by another mutation`,
    );
  }
  try {
    const storedRequest = parseBlockTransferRequest(
      JSON.parse(stored.request_json) as unknown,
    );
    if (
      canonicalizeBlockTransferLogicalIntent(
        blockTransferIntentFromRequest(storedRequest),
      ) !== canonicalizeBlockTransferLogicalIntent(intent)
    ) {
      return preparationFailure(
        intent,
        "operation_id_collision",
        `Operation ID ${intent.operationId} is already used by another Block transfer`,
      );
    }
    return {
      ok: true,
      value: loadDuplicate(
        database,
        stored,
        storedRequest,
        stored.request_json,
        stored.request_hash,
      ),
    };
  } catch (error) {
    if (error instanceof BlockTransferRejection) {
      return { ok: false, error: error.commandError };
    }
    throw error;
  }
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
    assertMovePreservesPageHierarchy(database, request, rows, request.target);
    const now = options.now?.() ?? new Date().toISOString();
    let documentCommits: readonly RelocationDocumentCommit[] = [];
    let affectedDatabaseBlockIds: readonly string[] = [];
    let resultBlockIds: readonly string[] = request.rootBlockIds;
    let resultRootBlockIds: readonly string[] = request.rootBlockIds;
    let copiedBlockIds: Readonly<Record<string, string>> = {};
    let transferTransformationEvidence: readonly BlockTransferTransformationEvidence[] = [];

    try {
      if (request.mode === "copy") {
        if (request.source.kind !== "document") {
          requirePageRoots(request, rows);
        }
        const copy =
          request.source.kind === "document"
            ? copyDocumentSelection(
                database,
                request,
                requestHash,
                rows,
                now,
                inject,
              )
            : copyPageRoots(
                database,
                request,
                requestHash,
                now,
                options.beforeTargetDocument,
              );
        documentCommits = copy.documentCommits;
        affectedDatabaseBlockIds = copy.affectedDatabaseBlockIds;
        resultBlockIds = copy.resultBlockIds;
        resultRootBlockIds = copy.resultRootBlockIds;
        copiedBlockIds = copy.copiedBlockIds;
        transferTransformationEvidence = copy.transformationEvidence ?? [];
      } else if (
        request.source.kind === "document" &&
        request.target.kind === "document" &&
        rows.some((row) => row.type !== "page")
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
        (request.target.kind === "database" ||
          request.target.kind === "space") &&
        rows.some((row) => row.type !== "page")
      ) {
        const coerced = moveDocumentRootsToPageParent(
          database,
          request,
          requestHash,
          rows,
          now,
          inject,
        );
        documentCommits = coerced.documentCommits;
        affectedDatabaseBlockIds = coerced.affectedDatabaseBlockIds;
        resultBlockIds = coerced.resultBlockIds;
        resultRootBlockIds = coerced.resultRootBlockIds;
        transferTransformationEvidence = coerced.transformationEvidence;
      } else {
        requirePageRoots(request, rows);
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
        affectedDatabaseBlockIds = transitionPageParents(
          database,
          request,
          requestHash,
          rows,
          now,
        );
        inject("after_parent_transition");
        if (request.target.kind === "document") {
          options.beforeTargetDocument?.(request.rootBlockIds);
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
                  type: "page",
                  props: {},
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
    const movedPageIds = resultBlockIds.filter(
      (blockId) =>
        (
          readMovedType.get(blockId, request.projectId) as
            | { readonly type: string }
            | undefined
        )?.type === "page",
    );
    if (
      request.target.kind === "space"
      && options.persistTopLevelGrant !== false
    ) {
      for (const pageId of resultRootBlockIds.filter((blockId) => movedPageIds.includes(blockId))) {
        putProjectResourceGrantInDatabase(database, {
          projectId: request.projectId,
          root: { kind: "page", pageId },
          access: "read_write",
        }, now);
      }
    }
    rebuildPageReadModelProjection(database, request.projectId, movedPageIds);
    refreshScheduledPageIndexProjection(
      database,
      request.projectId,
      movedPageIds,
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
      transferTransformationEvidence,
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
      transformationEvidence: transferTransformationEvidence,
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
    captureTransferDocumentRevisions(
      database,
      request,
      documentCommits,
      changeLogSeq,
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
