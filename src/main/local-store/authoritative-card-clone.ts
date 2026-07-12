import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  createDetachedCardDocumentFromBlockTree,
  materializeCardDocument,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/card-document";
import type {
  BlockId,
  DocumentId,
} from "../../shared/block-documents/contracts";
import { assertUuidV7, createUuidV7 } from "../../shared/card-id";
import type { CardStatus } from "../../shared/card-status";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import {
  initializeCardDocumentGenesis,
  loadPrimaryBlockDocument,
} from "./block-document-store";
import { rebuildCardReadModelProjection } from "./card-read-store";
import { refreshScheduledCardIndexProjection } from "./scheduled-card-store";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationReceipt,
  prepareAuthoritativeOperation,
} from "./authoritative-operation-receipts";

export type AuthoritativeCardCloneFaultPoint =
  | "after_identity"
  | "after_relational_properties"
  | "after_document_genesis"
  | "after_authority_cutover"
  | "after_projections"
  | "before_commit"
  | "after_commit";

export interface AuthoritativeCardClonePropertyOverrides {
  readonly database?: Readonly<Record<string, unknown>>;
  readonly intrinsic?: Readonly<Record<string, unknown>>;
}

export interface CloneAuthoritativeCardInput {
  readonly projectId: string;
  readonly sourceCardId: BlockId;
  readonly newCardId: BlockId;
  readonly lifecycle: "active" | "archived";
  readonly status: CardStatus;
  readonly primaryViewRankKey: string;
  readonly propertyOverrides?: AuthoritativeCardClonePropertyOverrides;
  readonly operationId: string;
  readonly clientSessionId?: string;
  readonly actor?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
}

export interface AuthoritativeCardCloneResult {
  readonly projectId: string;
  readonly sourceCardId: BlockId;
  readonly cardId: BlockId;
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

export interface CloneAuthoritativeCardOptions {
  readonly allocateBlockId?: () => BlockId;
  /**
   * Trusted outer ownership-copy seam. Called after the root Card/Document
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
  readonly faultInjector?: (point: AuthoritativeCardCloneFaultPoint) => void;
}

interface SourceCardRow {
  readonly block_id: string;
  readonly project_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
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

export class AuthoritativeCardCloneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthoritativeCardCloneError";
  }
}

const parseCloneResult = (value: unknown): AuthoritativeCardCloneResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuthoritativeCardCloneError(
      "Stored Card clone result is invalid",
    );
  }
  const result = value as Partial<AuthoritativeCardCloneResult>;
  if (
    typeof result.projectId !== "string" ||
    typeof result.sourceCardId !== "string" ||
    typeof result.cardId !== "string" ||
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
    throw new AuthoritativeCardCloneError(
      "Stored Card clone result is corrupt",
    );
  }
  return result as AuthoritativeCardCloneResult;
};

const requireIdentity = (value: string, field: string): string => {
  if (typeof value === "string" && value.length > 0 && value === value.trim()) {
    return value;
  }
  throw new AuthoritativeCardCloneError(
    `${field} must be a canonical identity`,
  );
};

const requireTimestamp = (value: string): string => {
  if (value === value.trim() && !Number.isNaN(new Date(value).getTime())) {
    return value;
  }
  throw new AuthoritativeCardCloneError("createdAt must be a valid timestamp");
};

const readStoreEpoch = (database: Database.Database): string => {
  const row = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string } | undefined;
  if (row?.store_epoch) return row.store_epoch;
  throw new AuthoritativeCardCloneError("Block store epoch is missing");
};

const readSource = (
  database: Database.Database,
  projectId: string,
  sourceCardId: BlockId,
): SourceCardRow => {
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
        membership.database_block_id,
        membership.id AS membership_id
      FROM blocks card
      INNER JOIN block_documents ownership
        ON ownership.block_id = card.id
        AND ownership.project_id = card.project_id
      INNER JOIN documents document
        ON document.id = ownership.document_id
        AND document.project_id = ownership.project_id
      INNER JOIN database_memberships membership
        ON membership.card_block_id = card.id
        AND membership.project_id = card.project_id
        AND membership.removed_at IS NULL
      WHERE card.id = ? AND card.project_id = ? AND card.type = 'card'
    `,
    )
    .get(sourceCardId, projectId) as SourceCardRow | undefined;
  if (!row) {
    throw new AuthoritativeCardCloneError(
      `Card ${sourceCardId} has no active Database membership or owned Document`,
    );
  }
  if (
    row.lifecycle === "deleted" ||
    row.readiness !== "ready" ||
    row.authority !== "ydoc_primary"
  ) {
    throw new AuthoritativeCardCloneError(
      `Card ${sourceCardId} is not a readable Y.Doc-primary Card`,
    );
  }
  return row;
};

const assertIdentityAvailable = (
  database: Database.Database,
  cardId: BlockId,
): void => {
  const documentId = `document:${cardId}`;
  const collision = database
    .prepare(
      `
      SELECT 'block' AS kind FROM blocks WHERE id = ?
      UNION ALL
      SELECT 'document' AS kind FROM documents WHERE id = ?
      LIMIT 1
    `,
    )
    .get(cardId, documentId) as { readonly kind: string } | undefined;
  if (!collision) return;
  throw new AuthoritativeCardCloneError(
    `Card identity ${cardId} collides with an existing ${collision.kind}`,
  );
};

const readDatabaseValues = (
  database: Database.Database,
  source: SourceCardRow,
): readonly SourceDatabaseValueRow[] =>
  database
    .prepare(
      `
      SELECT
        value.property_id,
        property.key AS property_key,
        value.value_type,
        value.value_json
      FROM database_property_values value
      INNER JOIN database_properties property
        ON property.id = value.property_id
        AND property.database_block_id = value.database_block_id
        AND property.project_id = value.project_id
        AND property.lifecycle = 'active'
      WHERE value.membership_id = ?
        AND value.database_block_id = ?
        AND value.project_id = ?
      ORDER BY property.rank_key, property.id
    `,
    )
    .all(
      source.membership_id,
      source.database_block_id,
      source.project_id,
    ) as readonly SourceDatabaseValueRow[];

const readIntrinsicValues = (
  database: Database.Database,
  source: SourceCardRow,
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
  source: SourceCardRow,
): readonly SourceViewPositionRow[] =>
  database
    .prepare(
      `
      SELECT position.view_id, position.group_key, position.rank_key, view.is_primary
      FROM database_view_positions position
      INNER JOIN database_views view
        ON view.id = position.view_id
        AND view.project_id = position.project_id
      WHERE position.block_id = ?
        AND position.project_id = ?
        AND view.database_block_id = ?
      ORDER BY view.is_primary DESC, position.view_id
    `,
    )
    .all(
      source.block_id,
      source.project_id,
      source.database_block_id,
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
      throw new AuthoritativeCardCloneError(
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
    throw new AuthoritativeCardCloneError(
      `${scope} property override does not exist on the source Card: ${key}`,
    );
  }
};

const persistIdentity = (
  database: Database.Database,
  input: CloneAuthoritativeCardInput,
  documentId: DocumentId,
  databaseBlockId: BlockId,
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
      ) VALUES (?, ?, 'card', ?, 'database', NULL, ?, 1, 1, ?, ?)
    `,
    )
    .run(
      input.newCardId,
      input.projectId,
      input.lifecycle,
      databaseBlockId,
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
      CARD_DOCUMENT_SCHEMA_KEY,
      CARD_DOCUMENT_SCHEMA_VERSION,
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
    .run(input.newCardId, documentId, input.projectId, createdAt);
};

const persistRelationalProperties = (
  database: Database.Database,
  source: SourceCardRow,
  input: CloneAuthoritativeCardInput,
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
    throw new AuthoritativeCardCloneError(
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
      INSERT INTO database_memberships (
        id, database_block_id, card_block_id, project_id, created_at, removed_at
      ) VALUES (?, ?, ?, ?, ?, NULL)
    `,
    )
    .run(
      membershipId,
      source.database_block_id,
      input.newCardId,
      input.projectId,
      createdAt,
    );

  const insertDatabaseValue = database.prepare(
    `
    INSERT INTO database_property_values (
      membership_id, property_id, database_block_id, project_id,
      value_type, value_json, revision, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `,
  );
  for (const row of databaseValues) {
    const override =
      row.property_key === "status"
        ? input.status
        : databaseOverrides?.[row.property_key];
    insertDatabaseValue.run(
      membershipId,
      row.property_id,
      source.database_block_id,
      input.projectId,
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
      input.newCardId,
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
  if (!primaryPosition) {
    throw new AuthoritativeCardCloneError(
      `Card ${source.block_id} has no primary Database View position`,
    );
  }
  const insertPosition = database.prepare(
    `
    INSERT INTO database_view_positions (
      view_id, block_id, project_id, group_key, rank_key,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  );
  for (const position of viewPositions) {
    insertPosition.run(
      position.view_id,
      input.newCardId,
      input.projectId,
      position.is_primary === 1 ? input.status : position.group_key,
      position.is_primary === 1 ? input.primaryViewRankKey : position.rank_key,
      createdAt,
      createdAt,
    );
  }
  return membershipId;
};

/**
 * Clone a Y.Doc-primary Card while an outer SQLite writer transaction is held.
 *
 * The source `cards` compatibility row is never read and the clone never gets
 * one. Callers that need additional source mutations (recurrence split/advance)
 * can compose them around this primitive and retain a single atomic commit.
 */
export const cloneAuthoritativeCardInTransaction = (
  database: Database.Database,
  rawInput: CloneAuthoritativeCardInput,
  options: CloneAuthoritativeCardOptions = {},
): AuthoritativeCardCloneResult => {
  if (!database.inTransaction) {
    throw new AuthoritativeCardCloneError(
      "cloneAuthoritativeCardInTransaction requires an active writer transaction",
    );
  }
  const input: CloneAuthoritativeCardInput = {
    ...rawInput,
    projectId: requireIdentity(rawInput.projectId, "projectId"),
    sourceCardId: requireIdentity(rawInput.sourceCardId, "sourceCardId"),
    newCardId: requireIdentity(rawInput.newCardId, "newCardId"),
    primaryViewRankKey: requireIdentity(
      rawInput.primaryViewRankKey,
      "primaryViewRankKey",
    ),
  };
  assertUuidV7(input.newCardId, "new Card Block id");
  if (input.newCardId === input.sourceCardId) {
    throw new AuthoritativeCardCloneError(
      "A Card clone requires a fresh Card ID",
    );
  }
  const operationId = requireIdentity(input.operationId, "operationId");
  const prepared = prepareAuthoritativeOperation(
    database,
    {
      operationId,
      projectId: input.projectId,
      mutationKind: "card_clone",
      logicalRequest: {
        version: 1,
        operation: "clone_card",
        projectId: input.projectId,
        sourceCardId: input.sourceCardId,
        newCardId: input.newCardId,
        lifecycle: input.lifecycle,
        status: input.status,
        primaryViewRankKey: input.primaryViewRankKey,
        ...(input.propertyOverrides
          ? { propertyOverrides: input.propertyOverrides }
          : {}),
      },
      actor: input.actor ?? { kind: "card-clone" },
      clientSessionId: input.clientSessionId,
    },
    parseCloneResult,
  );
  if (prepared.kind === "replay") {
    if (
      prepared.result.operationId !== operationId ||
      prepared.result.projectId !== input.projectId ||
      prepared.result.sourceCardId !== input.sourceCardId ||
      prepared.result.cardId !== input.newCardId ||
      prepared.outcome !== "committed" ||
      prepared.result.changeLogSeq !== prepared.changeLogSeq
    ) {
      throw new AuthoritativeOperationReceiptError(
        "operation_receipt_corrupt",
        `Card clone ${operationId} stored a divergent result identity`,
      );
    }
    return { ...prepared.result, duplicate: true };
  }
  assertIdentityAvailable(database, input.newCardId);
  const source = readSource(database, input.projectId, input.sourceCardId);
  const createdAt = requireTimestamp(
    input.createdAt ?? new Date().toISOString(),
  );
  const documentId = `document:${input.newCardId}`;
  const databaseValues = readDatabaseValues(database, source);
  const intrinsicValues = readIntrinsicValues(database, source);
  const viewPositions = readViewPositions(database, source);
  const inject = options.faultInjector ?? (() => {});

  const loaded = loadPrimaryBlockDocument(database, source.document_id);
  let detached: ReturnType<
    typeof createDetachedCardDocumentFromBlockTree
  > | null = null;
  try {
    if (
      loaded.head.generation !== source.generation ||
      loaded.head.headSeq !== source.head_seq
    ) {
      throw new AuthoritativeCardCloneError(
        `Card ${source.block_id} changed while its clone was prepared`,
      );
    }
    const materialization = materializeCardDocument(loaded.document);
    const remapped = remapBlockTree(
      database,
      materialization.blockTree,
      options.allocateBlockId ?? createUuidV7,
    );
    detached = createDetachedCardDocumentFromBlockTree({
      documentId,
      title: materialization.title,
      blockTree: remapped.blockTree,
    });

    persistIdentity(
      database,
      input,
      documentId,
      source.database_block_id,
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
    const genesis = initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch,
      generation: 1,
      updateId: `card-clone-genesis:${operationId}`,
      clientSessionId: input.clientSessionId ?? "authoritative-card-clone",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
    inject("after_document_genesis");
    inject("after_authority_cutover");

    refreshScheduledCardIndexProjection(
      database,
      input.projectId,
      [input.newCardId],
      createdAt,
    );
    rebuildCardReadModelProjection(database, input.projectId, [
      input.newCardId,
    ]);
    inject("after_projections");

    const committed = persistAuthoritativeOperationReceipt(database, {
      evidence: prepared.evidence,
      targetBlockIds: [
        input.sourceCardId,
        input.newCardId,
        ...Object.values(remapped.idMap),
      ],
      affectedDocumentIds: [source.document_id, documentId],
      affectedDatabaseBlockIds: [source.database_block_id],
      fieldIntents: [
        { path: `blocks.${input.newCardId}`, operation: "clone" },
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
        sourceCardId: input.sourceCardId,
        cardId: input.newCardId,
        lifecycle: input.lifecycle,
        blockIdMap: remapped.idMap,
      },
      committedAt: createdAt,
      makeResult: (changeLogSeq): AuthoritativeCardCloneResult => ({
        projectId: input.projectId,
        sourceCardId: input.sourceCardId,
        cardId: input.newCardId,
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

/** Atomically clone one authoritative Card with no compatibility Card write. */
export const cloneAuthoritativeCard = (
  database: Database.Database,
  input: CloneAuthoritativeCardInput,
  options: CloneAuthoritativeCardOptions = {},
): AuthoritativeCardCloneResult => {
  const clone = database.transaction(() =>
    cloneAuthoritativeCardInTransaction(database, input, options),
  );
  const result = clone.immediate();
  options.faultInjector?.("after_commit");
  return result;
};
