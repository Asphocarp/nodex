import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  createDetachedPageDocumentFromBlockTree,
  materializePageDocument,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/page-document";
import type {
  BlockId,
  DocumentId,
} from "../../shared/block-documents/contracts";
import { assertUuidV7, createUuidV7 } from "../../shared/uuid-v7";
import type { WorkflowStatus } from "../../shared/workflow-status";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import { databaseGroupKeyForValue } from "../../shared/database-kernel";
import {
  initializePageDocumentGenesis,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { rebuildPageReadModelProjection } from "./page-read-store";
import { refreshScheduledPageIndexProjection } from "./scheduled-page-store";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationReceipt,
  prepareAuthoritativeOperation,
} from "./authoritative-operation-receipts";

export type AuthoritativePageCloneFaultPoint =
  | "after_identity"
  | "after_relational_properties"
  | "after_document_genesis"
  | "after_authority_cutover"
  | "after_projections"
  | "before_commit"
  | "after_commit";

export interface AuthoritativePageClonePropertyOverrides {
  readonly database?: Readonly<Record<string, unknown>>;
  readonly intrinsic?: Readonly<Record<string, unknown>>;
}

export interface CloneAuthoritativePageInput {
  readonly projectId: string;
  readonly sourcePageId: BlockId;
  readonly newPageId: BlockId;
  readonly lifecycle: "active" | "archived";
  readonly status: WorkflowStatus;
  /** Required only when the source participates in its primary View. */
  readonly primaryViewRankKey?: string;
  readonly propertyOverrides?: AuthoritativePageClonePropertyOverrides;
  readonly operationId: string;
  readonly clientSessionId?: string;
  readonly actor?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
}

export interface AuthoritativePageCloneResult {
  readonly projectId: string;
  readonly sourcePageId: BlockId;
  readonly pageId: BlockId;
  readonly operationId: string;
  readonly duplicate: boolean;
  readonly documentId: DocumentId;
  readonly databaseBlockId: BlockId;
  readonly membershipId: string;
  readonly blockIdMap: Readonly<Record<BlockId, BlockId>>;
  readonly documentHeadSeq: number;
  readonly changeLogSeq: number;
  readonly createdAt: string;
}

export interface CloneAuthoritativePageOptions {
  readonly allocateBlockId?: () => BlockId;
  /**
   * Trusted outer ownership-copy seam. Called after the root Page/Document
   * identities exist but before root genesis validates document-bearing shell
   * IDs. Implementations may stage the recursively owned rows/Documents in the
   * same SQLite transaction; they must not commit or publish independently.
   */
  readonly stageNestedOwnership?: (input: {
    readonly sourceDocumentId: DocumentId;
    readonly targetDocumentId: DocumentId;
    readonly rootDocumentBlockIdMap: Readonly<Record<BlockId, BlockId>>;
    readonly createdAt: string;
  }) => void;
  readonly faultInjector?: (point: AuthoritativePageCloneFaultPoint) => void;
}

interface SourcePageRow {
  readonly block_id: string;
  readonly project_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
  readonly data_source_id: string;
  readonly database_block_id: string;
  readonly membership_id: string;
}

interface SourceDatabaseValueRow {
  readonly property_id: string;
  readonly property_key: string;
  readonly value_type: string;
  readonly value_json: string;
}

interface SourceIntrinsicValueRow {
  readonly property_key: string;
  readonly value_type: string;
  readonly value_json: string;
}

interface SourceViewPositionRow {
  readonly view_id: string;
  readonly group_key: string | null;
  readonly rank_key: string;
  readonly is_primary: number;
}

export class AuthoritativePageCloneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthoritativePageCloneError";
  }
}

const parseCloneResult = (value: unknown): AuthoritativePageCloneResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuthoritativePageCloneError(
      "Stored Page clone result is invalid",
    );
  }
  const result = value as Partial<AuthoritativePageCloneResult>;
  if (
    typeof result.projectId !== "string" ||
    typeof result.sourcePageId !== "string" ||
    typeof result.pageId !== "string" ||
    typeof result.operationId !== "string" ||
    typeof result.documentId !== "string" ||
    typeof result.databaseBlockId !== "string" ||
    typeof result.membershipId !== "string" ||
    typeof result.documentHeadSeq !== "number" ||
    typeof result.changeLogSeq !== "number" ||
    typeof result.createdAt !== "string" ||
    typeof result.blockIdMap !== "object" ||
    result.blockIdMap === null ||
    !Object.entries(result.blockIdMap).every(
      ([sourceId, targetId]) =>
        sourceId.length > 0 &&
        typeof targetId === "string" &&
        targetId.length > 0,
    ) ||
    result.duplicate !== false
  ) {
    throw new AuthoritativePageCloneError(
      "Stored Page clone result is corrupt",
    );
  }
  return result as AuthoritativePageCloneResult;
};

const requireIdentity = (value: string, field: string): string => {
  if (typeof value === "string" && value.length > 0 && value === value.trim()) {
    return value;
  }
  throw new AuthoritativePageCloneError(
    `${field} must be a canonical identity`,
  );
};

const requireTimestamp = (value: string): string => {
  if (value === value.trim() && !Number.isNaN(new Date(value).getTime())) {
    return value;
  }
  throw new AuthoritativePageCloneError("createdAt must be a valid timestamp");
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new AuthoritativePageCloneError("Block store epoch is missing");
};

const readSource = (
  database: Database.Database,
  projectId: string,
  sourcePageId: BlockId,
): SourcePageRow => {
  const row = database
    .prepare(
      `
      SELECT
        card.id AS block_id,
        card.project_id,
        card.lifecycle,
        document.id AS document_id,
        document.generation,
        document.head_seq,
        document.readiness,
        document.authority,
        membership.data_source_id,
        source.home_database_block_id AS database_block_id,
        membership.id AS membership_id
      FROM blocks card
      INNER JOIN block_documents ownership
        ON ownership.block_id = card.id
        AND ownership.project_id = card.project_id
      INNER JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      INNER JOIN data_source_page_memberships membership
        ON membership.page_block_id = card.id
        AND membership.removed_at IS NULL
      INNER JOIN data_sources source
        ON source.id = membership.data_source_id
        AND source.home_database_block_id = card.containing_database_id
      WHERE card.id = ? AND card.project_id = ? AND card.type = 'page'
    `,
    )
    .get(sourcePageId, projectId) as SourcePageRow | undefined;
  if (!row) {
    throw new AuthoritativePageCloneError(
      `Page ${sourcePageId} has no active Database membership or owned Document`,
    );
  }
  if (
    row.lifecycle === "deleted" ||
    row.readiness !== "ready" ||
    row.authority !== "ydoc_primary"
  ) {
    throw new AuthoritativePageCloneError(
      `Page ${sourcePageId} is not a readable Y.Doc-primary Page`,
    );
  }
  return row;
};

const assertIdentityAvailable = (
  database: Database.Database,
  pageId: BlockId,
): void => {
  const documentId = `document:${pageId}`;
  const collision = database
    .prepare(
      `
      SELECT 'block' AS kind FROM blocks WHERE id = ?
      UNION ALL
      SELECT 'document' AS kind FROM documents WHERE id = ?
      LIMIT 1
    `,
    )
    .get(pageId, documentId) as { readonly kind: string } | undefined;
  if (!collision) return;
  throw new AuthoritativePageCloneError(
    `Page identity ${pageId} collides with an existing ${collision.kind}`,
  );
};

const readDatabaseValues = (
  database: Database.Database,
  source: SourcePageRow,
): readonly SourceDatabaseValueRow[] =>
  database
    .prepare(
      `
      SELECT
        value.property_id,
        property.id AS property_key,
        value.value_type,
        value.value_json
      FROM data_source_property_values value
      INNER JOIN data_source_properties property
        ON property.id = value.property_id
        AND property.data_source_id = value.data_source_id
        AND property.lifecycle = 'active'
      WHERE value.membership_id = ?
        AND value.data_source_id = ?
      ORDER BY property.rank_key, property.id
    `,
    )
    .all(
      source.membership_id,
      source.data_source_id,
    ) as readonly SourceDatabaseValueRow[];

const readIntrinsicValues = (
  database: Database.Database,
  source: SourcePageRow,
): readonly SourceIntrinsicValueRow[] =>
  database
    .prepare(
      `
      SELECT property_key, value_type, value_json
      FROM block_properties
      WHERE block_id = ? AND project_id = ?
      ORDER BY property_key
    `,
    )
    .all(
      source.block_id,
      source.project_id,
    ) as readonly SourceIntrinsicValueRow[];

const readViewPositions = (
  database: Database.Database,
  source: SourcePageRow,
): readonly SourceViewPositionRow[] =>
  database
    .prepare(
      `
      SELECT position.view_id, position.group_key, position.rank_key,
        CASE WHEN container.default_view_id = view.id THEN 1 ELSE 0 END AS is_primary
      FROM database_view_page_positions position
      INNER JOIN database_views view
        ON view.id = position.view_id
      INNER JOIN database_containers container
        ON container.block_id = view.database_block_id
      WHERE position.page_block_id = ?
        AND view.database_block_id = ?
        AND view.data_source_id = ?
        AND view.lifecycle = 'active'
      ORDER BY is_primary DESC, position.view_id
    `,
    )
    .all(
      source.block_id,
      source.database_block_id,
      source.data_source_id,
    ) as readonly SourceViewPositionRow[];

const remapBlockTree = (
  database: Database.Database,
  blockTree: readonly BlockTreeNode[],
  allocateBlockId: () => BlockId,
): {
  readonly blockTree: readonly BlockTreeNode[];
  readonly idMap: Readonly<Record<BlockId, BlockId>>;
} => {
  const allocated = new Set<BlockId>();
  const idMap = new Map<BlockId, BlockId>();
  const allocate = (sourceId: BlockId): BlockId => {
    const existing = idMap.get(sourceId);
    if (existing) return existing;
    const nextId = requireIdentity(allocateBlockId(), "allocated Block ID");
    const persisted = database
      .prepare("SELECT 1 FROM blocks WHERE id = ?")
      .get(nextId);
    if (allocated.has(nextId) || persisted) {
      throw new AuthoritativePageCloneError(
        `Allocated Block identity is not fresh: ${nextId}`,
      );
    }
    allocated.add(nextId);
    idMap.set(sourceId, nextId);
    return nextId;
  };
  const visit = (nodes: readonly BlockTreeNode[]): readonly BlockTreeNode[] =>
    nodes.map((node) => ({
      ...node,
      id: allocate(node.id),
      // Only the owning node identity is copied. Props/content deliberately
      // stay byte-for-byte semantic equivalents, so reference targetBlockId
      // values continue to point at the original target.
      children: visit(node.children),
    }));
  return {
    blockTree: visit(blockTree),
    idMap: Object.fromEntries(idMap),
  };
};

const requireOverrideKeys = (
  overrides: Readonly<Record<string, unknown>> | undefined,
  availableKeys: ReadonlySet<string>,
  scope: string,
): void => {
  for (const key of Object.keys(overrides ?? {})) {
    if (availableKeys.has(key)) continue;
    throw new AuthoritativePageCloneError(
      `${scope} property override does not exist on the source Page: ${key}`,
    );
  }
};

const persistIdentity = (
  database: Database.Database,
  input: CloneAuthoritativePageInput,
  documentId: DocumentId,
  databaseBlockId: BlockId,
  dataSourceId: string,
  createdAt: string,
): void => {
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'page', ?, 'space', NULL, NULL, 1, 1, ?, ?)
    `,
    )
    .run(
      input.newPageId,
      input.projectId,
      input.lifecycle,
      createdAt,
      createdAt,
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
      input.projectId,
      PAGE_DOCUMENT_SCHEMA_KEY,
      PAGE_DOCUMENT_SCHEMA_VERSION,
      createdAt,
      createdAt,
    );
  database
    .prepare(
      `
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `,
    )
    .run(input.newPageId, documentId, input.projectId, createdAt);
  const parent = database.prepare(`
    INSERT INTO pages (
      block_id, library_id, document_id, parent_kind, parent_id,
      lifecycle, parent_revision, metadata_revision, created_at, updated_at
    )
    SELECT ?, project.library_id, ?, 'data_source', ?, ?, 1, 1, ?, ?
    FROM projects project WHERE project.id = ?
  `).run(
    input.newPageId,
    documentId,
    dataSourceId,
    input.lifecycle,
    createdAt,
    createdAt,
    input.projectId,
  );
  if (parent.changes !== 1) {
    throw new AuthoritativePageCloneError(
      `Cloned Page ${input.newPageId} could not bind to Data Source ${dataSourceId}`,
    );
  }
  const location = database.prepare(`
    UPDATE blocks
    SET location_kind = 'database', containing_document_id = NULL,
      containing_database_id = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND type = 'page'
  `).run(databaseBlockId, createdAt, input.newPageId, input.projectId);
  if (location.changes !== 1) {
    throw new AuthoritativePageCloneError(
      `Cloned Page ${input.newPageId} could not enter Database ${databaseBlockId}`,
    );
  }
};

const persistRelationalProperties = (
  database: Database.Database,
  source: SourcePageRow,
  input: CloneAuthoritativePageInput,
  databaseValues: readonly SourceDatabaseValueRow[],
  intrinsicValues: readonly SourceIntrinsicValueRow[],
  viewPositions: readonly SourceViewPositionRow[],
  createdAt: string,
): string => {
  const membershipId = randomUUID();
  const databaseOverrides = input.propertyOverrides?.database;
  const intrinsicOverrides = input.propertyOverrides?.intrinsic;
  requireOverrideKeys(
    databaseOverrides,
    new Set(databaseValues.map((row) => row.property_key)),
    "Database",
  );
  if (
    databaseOverrides?.status !== undefined &&
    databaseOverrides.status !== input.status
  ) {
    throw new AuthoritativePageCloneError(
      "Database status override must match the primary View group",
    );
  }
  requireOverrideKeys(
    intrinsicOverrides,
    new Set(intrinsicValues.map((row) => row.property_key)),
    "intrinsic",
  );

  database
    .prepare(
      `
      INSERT INTO data_source_page_memberships (
        id, data_source_id, page_block_id, revision, created_at, removed_at
      ) VALUES (?, ?, ?, 1, ?, NULL)
    `,
    )
    .run(
      membershipId,
      source.data_source_id,
      input.newPageId,
      createdAt,
    );

  const insertDatabaseValue = database.prepare(
    `
    INSERT INTO data_source_property_values (
      data_source_id, membership_id, property_id,
      value_type, value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `,
  );
  for (const row of databaseValues) {
    const override =
      row.property_key === "status"
        ? input.status
        : databaseOverrides?.[row.property_key];
    insertDatabaseValue.run(
      source.data_source_id,
      membershipId,
      row.property_id,
      row.value_type,
      override === undefined
        ? row.value_json
        : stableStringifyBlockPropertyJson(override),
      createdAt,
    );
  }

  const insertIntrinsicValue = database.prepare(
    `
    INSERT INTO block_properties (
      block_id, project_id, property_key, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `,
  );
  for (const row of intrinsicValues) {
    const override = intrinsicOverrides?.[row.property_key];
    insertIntrinsicValue.run(
      input.newPageId,
      input.projectId,
      row.property_key,
      row.value_type,
      override === undefined
        ? row.value_json
        : stableStringifyBlockPropertyJson(override),
      createdAt,
    );
  }

  const primaryPosition = viewPositions.find(
    (position) => position.is_primary === 1,
  );
  if (primaryPosition && !input.primaryViewRankKey) {
    throw new AuthoritativePageCloneError(
      `Page ${source.block_id} clone requires a primary View rank`,
    );
  }
  const insertPosition = database.prepare(
    `
    INSERT INTO database_view_page_positions (
      view_id, page_block_id, group_key, rank_key, revision,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
  `,
  );
  for (const position of viewPositions) {
    insertPosition.run(
      position.view_id,
      input.newPageId,
      position.is_primary === 1
        ? databaseGroupKeyForValue(input.status)
        : position.group_key,
      position.is_primary === 1
        ? input.primaryViewRankKey
        : position.rank_key,
      createdAt,
      createdAt,
    );
  }
  return membershipId;
};

/**
 * Clone a Y.Doc-primary Page while an outer SQLite writer transaction is held.
 *
 * The source `cards` compatibility row is never read and the clone never gets
 * one. Callers that need additional source mutations (recurrence split/advance)
 * can compose them around this primitive and retain a single atomic commit.
 */
export const cloneAuthoritativePageInTransaction = (
  database: Database.Database,
  rawInput: CloneAuthoritativePageInput,
  options: CloneAuthoritativePageOptions = {},
): AuthoritativePageCloneResult => {
  if (!database.inTransaction) {
    throw new AuthoritativePageCloneError(
      "cloneAuthoritativePageInTransaction requires an active writer transaction",
    );
  }
  const input: CloneAuthoritativePageInput = {
    ...rawInput,
    projectId: requireIdentity(rawInput.projectId, "projectId"),
    sourcePageId: requireIdentity(rawInput.sourcePageId, "sourcePageId"),
    newPageId: requireIdentity(rawInput.newPageId, "newPageId"),
    ...(rawInput.primaryViewRankKey === undefined
      ? {}
      : {
          primaryViewRankKey: requireIdentity(
            rawInput.primaryViewRankKey,
            "primaryViewRankKey",
          ),
        }),
  };
  assertUuidV7(input.newPageId, "new Page Block id");
  if (input.newPageId === input.sourcePageId) {
    throw new AuthoritativePageCloneError(
      "A Page clone requires a fresh Page ID",
    );
  }
  const operationId = requireIdentity(input.operationId, "operationId");
  const prepared = prepareAuthoritativeOperation(
    database,
    {
      operationId,
      projectId: input.projectId,
      mutationKind: "page_clone",
      logicalRequest: {
        version: 1,
        operation: "clone_card",
        projectId: input.projectId,
        sourcePageId: input.sourcePageId,
        newPageId: input.newPageId,
        lifecycle: input.lifecycle,
        status: input.status,
        ...(input.primaryViewRankKey
          ? { primaryViewRankKey: input.primaryViewRankKey }
          : {}),
        ...(input.propertyOverrides
          ? { propertyOverrides: input.propertyOverrides }
          : {}),
      },
      actor: input.actor ?? { kind: "page-clone" },
      clientSessionId: input.clientSessionId,
    },
    parseCloneResult,
  );
  if (prepared.kind === "replay") {
    if (
      prepared.result.operationId !== operationId ||
      prepared.result.projectId !== input.projectId ||
      prepared.result.sourcePageId !== input.sourcePageId ||
      prepared.result.pageId !== input.newPageId ||
      prepared.outcome !== "committed" ||
      prepared.result.changeLogSeq !== prepared.changeLogSeq
    ) {
      throw new AuthoritativeOperationReceiptError(
        "operation_receipt_corrupt",
        `Page clone ${operationId} stored a divergent result identity`,
      );
    }
    return { ...prepared.result, duplicate: true };
  }
  assertIdentityAvailable(database, input.newPageId);
  const source = readSource(database, input.projectId, input.sourcePageId);
  const createdAt = requireTimestamp(
    input.createdAt ?? new Date().toISOString(),
  );
  const documentId = `document:${input.newPageId}`;
  const databaseValues = readDatabaseValues(database, source);
  const intrinsicValues = readIntrinsicValues(database, source);
  const viewPositions = readViewPositions(database, source);
  const inject = options.faultInjector ?? (() => {});

  const loaded = loadPrimaryBlockDocument(database, source.document_id);
  let detached: ReturnType<
    typeof createDetachedPageDocumentFromBlockTree
  > | null = null;
  try {
    if (
      loaded.head.generation !== source.generation ||
      loaded.head.headSeq !== source.head_seq
    ) {
      throw new AuthoritativePageCloneError(
        `Page ${source.block_id} changed while its clone was prepared`,
      );
    }
    const materialization = materializePageDocument(loaded.document);
    const remapped = remapBlockTree(
      database,
      materialization.blockTree,
      options.allocateBlockId ?? createUuidV7,
    );
    detached = createDetachedPageDocumentFromBlockTree({
      documentId,
      richTitle: materialization.richTitle,
      blockTree: remapped.blockTree,
    });

    persistIdentity(
      database,
      input,
      documentId,
      source.database_block_id,
      source.data_source_id,
      createdAt,
    );
    options.stageNestedOwnership?.({
      sourceDocumentId: source.document_id,
      targetDocumentId: documentId,
      rootDocumentBlockIdMap: remapped.idMap,
      createdAt,
    });
    inject("after_identity");
    const membershipId = persistRelationalProperties(
      database,
      source,
      input,
      databaseValues,
      intrinsicValues,
      viewPositions,
      createdAt,
    );
    inject("after_relational_properties");

    const storeEpoch = readStoreEpoch(database);
    const genesis = initializePageDocumentGenesis(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: `page-clone-genesis:${operationId}`,
      clientSessionId: input.clientSessionId ?? "authoritative-page-clone",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
    inject("after_document_genesis");
    inject("after_authority_cutover");

    refreshScheduledPageIndexProjection(
      database,
      input.projectId,
      [input.newPageId],
      createdAt,
    );
    rebuildPageReadModelProjection(database, input.projectId, [
      input.newPageId,
    ]);
    inject("after_projections");

    const committed = persistAuthoritativeOperationReceipt(database, {
      evidence: prepared.evidence,
      targetBlockIds: [
        input.sourcePageId,
        input.newPageId,
        ...Object.values(remapped.idMap),
      ],
      affectedDocumentIds: [source.document_id, documentId],
      affectedDatabaseBlockIds: [source.database_block_id],
      fieldIntents: [
        { path: `blocks.${input.newPageId}`, operation: "clone" },
        { path: `documents.${documentId}`, operation: "genesis" },
        { path: `memberships.${membershipId}`, operation: "clone" },
      ],
      documentHeads: {
        [source.document_id]: {
          generation: source.generation,
          headSeq: source.head_seq,
        },
        [documentId]: { generation: 1, headSeq: genesis.headSeq },
      },
      changePayload: {
        sourcePageId: input.sourcePageId,
        pageId: input.newPageId,
        lifecycle: input.lifecycle,
        blockIdMap: remapped.idMap,
      },
      committedAt: createdAt,
      makeResult: (changeLogSeq): AuthoritativePageCloneResult => ({
        projectId: input.projectId,
        sourcePageId: input.sourcePageId,
        pageId: input.newPageId,
        operationId,
        duplicate: false,
        documentId,
        databaseBlockId: source.database_block_id,
        membershipId,
        blockIdMap: remapped.idMap,
        documentHeadSeq: genesis.headSeq,
        changeLogSeq,
        createdAt,
      }),
    });
    inject("before_commit");
    return committed.result;
  } finally {
    detached?.document.destroy();
    loaded.document.destroy();
  }
};

/** Atomically clone one authoritative Page with no compatibility Page write. */
export const cloneAuthoritativePage = (
  database: Database.Database,
  input: CloneAuthoritativePageInput,
  options: CloneAuthoritativePageOptions = {},
): AuthoritativePageCloneResult => {
  const clone = database.transaction(() =>
    cloneAuthoritativePageInTransaction(database, input, options),
  );
  const result = clone.immediate();
  options.faultInjector?.("after_commit");
  return result;
};
