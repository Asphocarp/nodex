import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  CARD_LIFECYCLE_CONTRACT_VERSION,
  CardLifecycleContractError,
  parseCardLifecycleMutationCommandResult,
  parseCardLifecycleMutationRequest,
  type CardLifecycleMutationCommandError,
  type CardLifecycleMutationCommandResult,
  type CardLifecycleMutationRequest,
  type CardLifecycleOperation,
  type CreateCardBlockOperation,
  type RestoreCardBlockOperation,
} from "../../shared/card-lifecycle";
import type {
  CardLifecycleMembershipCoordinate,
  CardLifecycleOwnedBlockAuthority,
  CardLifecyclePreflight,
  CardLifecyclePreflightResult,
  CardLifecycleRestoreEvidence,
} from "../../shared/card-lifecycle-runtime";
import {
  BlockDocumentCodecError,
  createCardDocumentGenesis,
  type BlockTreeNode,
} from "../../shared/block-documents/block-document-codec";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/card-document";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import { isCardStatus, type CardStatus } from "../../shared/card-status";
import { isUuidV7 } from "../../shared/card-id";
import {
  normalizeDatabasePropertyValue,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  FractionalRankError,
  planFractionalRank,
  type FractionalRankedItem,
} from "../../shared/fractional-rank";
import {
  BlockDocumentStoreError,
  initializeCardDocumentGenesis,
} from "./block-document-store";
import { rebuildCardReadModelProjection } from "./card-read-store";
import { refreshScheduledCardIndexProjection } from "./scheduled-card-store";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationReceipt,
  persistAuthoritativeOperationRejection,
  prepareAuthoritativeOperation,
  type AuthoritativeOperationEvidence,
} from "./authoritative-operation-receipts";
import {
  queryGeneralDatabaseView,
  readPrimaryGeneralDatabaseDescriptor,
} from "./database-query";
import { readBlockStoreEpoch } from "./block-store-metadata";

const MUTATION_KIND = "card_lifecycle";

const REQUIRED_DATABASE_PROPERTIES = {
  status: "select",
  priority: "select",
  estimate: "select",
  tags: "multi_select",
  due_date: "date",
  scheduled_start: "datetime",
  scheduled_end: "datetime",
  assignee: "person",
} as const satisfies Readonly<Record<string, DatabasePropertyValueType>>;

const INTRINSIC_CARD_PROPERTIES = {
  "agent.blocked": {
    valueType: "boolean",
    read: (input: CreateCardBlockOperation) => input.agentBlocked,
  },
  "agent.status": {
    valueType: "string",
    read: (input: CreateCardBlockOperation) => input.agentStatus,
  },
  "run.target": {
    valueType: "string",
    read: (input: CreateCardBlockOperation) => input.runInTarget,
  },
  "run.localPath": {
    valueType: "string",
    read: (input: CreateCardBlockOperation) => input.runInLocalPath,
  },
  "run.baseBranch": {
    valueType: "string",
    read: (input: CreateCardBlockOperation) => input.runInBaseBranch,
  },
  "run.worktreePath": {
    valueType: "string",
    read: (input: CreateCardBlockOperation) => input.runInWorktreePath,
  },
  "run.environmentPath": {
    valueType: "string",
    read: (input: CreateCardBlockOperation) => input.runInEnvironmentPath,
  },
  "schedule.isAllDay": {
    valueType: "boolean",
    read: (input: CreateCardBlockOperation) => input.isAllDay,
  },
  "schedule.timezone": {
    valueType: "string",
    read: (input: CreateCardBlockOperation) => input.scheduleTimezone,
  },
  "recurrence.config": {
    valueType: "json",
    read: (input: CreateCardBlockOperation) => input.recurrence,
  },
  "reminders.config": {
    valueType: "json",
    read: (input: CreateCardBlockOperation) => input.reminders,
  },
} as const;

export type CardLifecycleMutationFaultPoint =
  | "after_identity"
  | "after_document_genesis"
  | "after_properties"
  | "after_authority"
  | "after_projections"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit";

export interface ApplyCardLifecycleMutationOptions {
  readonly now?: () => string;
  readonly allocateBodyBlockId?: () => string;
  readonly faultInjector?: (point: CardLifecycleMutationFaultPoint) => void;
}

interface BlockRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
  readonly location_revision: number;
  readonly metadata_revision: number;
}

interface OwnedDocumentRow {
  readonly document_id: string;
  readonly generation: number;
  readonly head_seq: number;
  readonly readiness: "pending_genesis" | "ready" | "failed";
  readonly authority: "legacy_shadow" | "ydoc_primary";
  readonly schema_key: string;
  readonly schema_version: number;
}

interface PrimaryDatabaseRow {
  readonly database_block_id: string;
  readonly view_id: string;
  readonly view_config_json: string;
}

interface DatabasePropertyRow {
  readonly id: string;
  readonly key: keyof typeof REQUIRED_DATABASE_PROPERTIES;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
  readonly schema_revision: number;
}

interface MembershipRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly revision: number;
  readonly removed_at: string | null;
}

type RestoreMembership = Exclude<RestoreCardBlockOperation["membership"], null>;
type RestoreWithMembershipOperation = RestoreCardBlockOperation & {
  readonly membership: RestoreMembership;
};

interface DeleteEvidence {
  readonly previousLifecycle: "active" | "archived";
  readonly databaseBlockId: string | null;
  readonly membershipId: string | null;
  readonly viewId: string | null;
  readonly status: CardStatus | null;
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly tombstonedBlocks: readonly IndexedClosureBlock[];
  readonly indexedDocumentIds: readonly string[];
}

interface IndexedClosureBlock {
  readonly id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly metadataRevision: number;
}

interface IndexedBlockClosure {
  readonly blocks: readonly IndexedClosureBlock[];
  readonly documentIds: readonly string[];
}

interface AuthorityCommit {
  readonly cardId: string;
  readonly lifecycle: BlockRow["lifecycle"];
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly documentId: string;
  readonly documentGeneration: number;
  readonly documentHeadSeq: number;
  readonly databaseBlockId: string | null;
  readonly membershipId: string | null;
  readonly viewId: string | null;
  readonly topLevelRankKey: string | null;
  readonly viewRankKey: string | null;
  readonly createdBlockIds: readonly string[];
  readonly targetBlockIds: readonly string[];
  readonly affectedDatabaseBlockIds: readonly string[];
  readonly fieldIntents: readonly Readonly<{
    readonly path: string;
    readonly operation: string;
  }>[];
  readonly expectedRevisions: Readonly<Record<string, number>>;
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly changePayload: Readonly<Record<string, unknown>>;
}

class CardLifecycleRejection extends Error {
  constructor(readonly error: CardLifecycleMutationCommandError) {
    super(error.message);
    this.name = "CardLifecycleRejection";
  }
}

const makeError = (
  code: CardLifecycleMutationCommandError["code"],
  message: string,
  request?: Pick<CardLifecycleMutationRequest, "operationId" | "operation">,
  revisions: Pick<
    CardLifecycleMutationCommandError,
    "expectedRevision" | "actualRevision"
  > = {},
): CardLifecycleMutationCommandError => ({
  code,
  message,
  retryable: false,
  ...(request === undefined ? {} : { operationId: request.operationId }),
  ...(request === undefined ? {} : { cardId: request.operation.cardId }),
  ...(revisions.expectedRevision === undefined
    ? {}
    : { expectedRevision: revisions.expectedRevision }),
  ...(revisions.actualRevision === undefined
    ? {}
    : { actualRevision: revisions.actualRevision }),
});

const reject = (
  code: CardLifecycleMutationCommandError["code"],
  message: string,
  request: CardLifecycleMutationRequest,
  revisions?: Pick<
    CardLifecycleMutationCommandError,
    "expectedRevision" | "actualRevision"
  >,
): never => {
  throw new CardLifecycleRejection(
    makeError(code, message, request, revisions),
  );
};

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const genesisUpdateId = (operationId: string): string =>
  `card-create-genesis:${createHash("sha256").update(operationId).digest("hex")}`;

const flattenBlockIds = (blocks: readonly BlockTreeNode[]): readonly string[] =>
  blocks.flatMap((block) => [block.id, ...flattenBlockIds(block.children)]);

const projectExists = (
  database: Database.Database,
  projectId: string,
): boolean =>
  database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId) !==
  undefined;

const readBlock = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
): BlockRow => {
  const row = database
    .prepare(
      `
      SELECT
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision
      FROM blocks
      WHERE id = ? AND project_id = ?
    `,
    )
    .get(request.operation.cardId, request.projectId) as BlockRow | undefined;
  if (!row) {
    const global = database
      .prepare("SELECT type FROM blocks WHERE id = ?")
      .get(request.operation.cardId);
    return reject(
      global ? "card_not_found" : "card_not_found",
      global
        ? `Card ${request.operation.cardId} belongs to another Project`
        : `Card does not exist: ${request.operation.cardId}`,
      request,
    );
  }
  if (row.type === "card") return row;
  return reject(
    "card_type_mismatch",
    `Block ${row.id} is ${row.type}, not a Card`,
    request,
  );
};

const readOwnedDocument = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
): OwnedDocumentRow => {
  const row = database
    .prepare(
      `
      SELECT
        document.id AS document_id, document.generation, document.head_seq,
        document.readiness, document.authority,
        document.schema_key, document.schema_version
      FROM block_documents ownership
      INNER JOIN documents document
        ON document.id = ownership.document_id
       AND document.project_id = ownership.project_id
      WHERE ownership.block_id = ? AND ownership.project_id = ?
    `,
    )
    .get(request.operation.cardId, request.projectId) as
    OwnedDocumentRow | undefined;
  if (
    row &&
    row.readiness === "ready" &&
    row.authority === "ydoc_primary" &&
    row.schema_key === CARD_DOCUMENT_SCHEMA_KEY &&
    row.schema_version === CARD_DOCUMENT_SCHEMA_VERSION &&
    row.generation >= 1 &&
    row.head_seq >= 1
  ) {
    return row;
  }
  return reject(
    "document_state_corrupt",
    `Card ${request.operation.cardId} does not own a current primary Card Document`,
    request,
  );
};

/**
 * Resolve only Blocks represented by the current exact-head indexes. Historical
 * registry rows intentionally stay outside this closure: removing a Block from
 * a Y.Doc tombstones its identity but does not make that tombstone part of a
 * later Card delete/restore.
 *
 * A current indexed Block may itself own a Document, so the walk follows
 * ownership recursively. The single SQLite writer transaction keeps every
 * checked head and index coordinate stable for the caller.
 */
const readCurrentIndexedBlockClosure = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  root: BlockRow,
): IndexedBlockClosure => {
  const blocks = new Map<string, IndexedClosureBlock>([
    [
      root.id,
      {
        id: root.id,
        lifecycle: root.lifecycle,
        metadataRevision: root.metadata_revision,
      },
    ],
  ]);
  const documentIds = new Set<string>();
  const pendingOwnerIds = [root.id];

  while (pendingOwnerIds.length > 0) {
    const ownerBlockId = pendingOwnerIds.shift();
    if (!ownerBlockId) continue;
    const document = database
      .prepare(
        `
        SELECT
          document.id, document.generation, document.head_seq,
          document.readiness, document.authority, document.sync_engine,
          materialization.generation AS materialization_generation,
          materialization.projected_seq AS materialization_projected_seq
        FROM block_documents ownership
        INNER JOIN documents document
          ON document.id = ownership.document_id
         AND document.project_id = ownership.project_id
        LEFT JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE ownership.block_id = ? AND ownership.project_id = ?
      `,
      )
      .get(ownerBlockId, request.projectId) as
      | {
          readonly id: string;
          readonly generation: number;
          readonly head_seq: number;
          readonly readiness: string;
          readonly authority: string;
          readonly sync_engine: "yjs" | "canvas_scene";
          readonly materialization_generation: number | null;
          readonly materialization_projected_seq: number | null;
        }
      | undefined;
    if (!document) continue;
    if (documentIds.has(document.id)) {
      return reject(
        "document_state_corrupt",
        `Document ${document.id} is reachable more than once from Card ${root.id}`,
        request,
      );
    }
    if (
      document.readiness !== "ready" ||
      document.authority !== "ydoc_primary" ||
      document.sync_engine !== "yjs" ||
      document.generation < 1 ||
      document.head_seq < 1 ||
      document.materialization_generation !== document.generation ||
      document.materialization_projected_seq !== document.head_seq
    ) {
      return reject(
        "document_state_corrupt",
        `Owned Document ${document.id} lacks an exact-head block-tree materialization`,
        request,
      );
    }
    documentIds.add(document.id);

    const indexedBlocks = database
      .prepare(
        `
        SELECT
          entry.block_id, entry.projected_seq,
          block.lifecycle, block.metadata_revision,
          block.location_kind, block.containing_document_id
        FROM document_block_index entry
        INNER JOIN blocks block
          ON block.id = entry.block_id
         AND block.project_id = ?
        WHERE entry.document_id = ?
        ORDER BY entry.block_id
      `,
      )
      .all(request.projectId, document.id) as readonly {
      readonly block_id: string;
      readonly projected_seq: number;
      readonly lifecycle: "active" | "archived" | "deleted";
      readonly metadata_revision: number;
      readonly location_kind: "space" | "document";
      readonly containing_document_id: string | null;
    }[];
    for (const indexed of indexedBlocks) {
      if (
        indexed.projected_seq !== document.head_seq ||
        indexed.location_kind !== "document" ||
        indexed.containing_document_id !== document.id ||
        blocks.has(indexed.block_id)
      ) {
        return reject(
          "document_state_corrupt",
          `Document ${document.id} has a stale or ambiguous current Block index`,
          request,
        );
      }
      blocks.set(indexed.block_id, {
        id: indexed.block_id,
        lifecycle: indexed.lifecycle,
        metadataRevision: indexed.metadata_revision,
      });
      pendingOwnerIds.push(indexed.block_id);
    }
  }

  return {
    blocks: [...blocks.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    documentIds: [...documentIds].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
};

const readPrimaryDatabase = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
): PrimaryDatabaseRow => {
  const rows = database
    .prepare(
      `
      SELECT
        capability.block_id AS database_block_id,
        view.id AS view_id,
        view.config_json AS view_config_json
      FROM database_capabilities capability
      INNER JOIN blocks database_block
        ON database_block.id = capability.block_id
       AND database_block.project_id = capability.project_id
       AND database_block.type = 'database'
       AND database_block.lifecycle = 'active'
      INNER JOIN database_views view
        ON view.database_block_id = capability.block_id
       AND view.project_id = capability.project_id
       AND view.is_primary = 1
       AND view.kind = 'kanban'
       AND view.lifecycle = 'active'
      WHERE capability.project_id = ? AND capability.is_primary = 1
      ORDER BY capability.block_id, view.id
    `,
    )
    .all(request.projectId) as PrimaryDatabaseRow[];
  if (rows.length === 1 && rows[0]) return rows[0];
  return reject(
    "primary_database_not_found",
    rows.length === 0
      ? `Project ${request.projectId} has no active primary Database/Kanban View`
      : `Project ${request.projectId} has ambiguous primary Database state`,
    request,
  );
};

const readRequiredDatabaseProperties = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  databaseBlockId: string,
  viewConfigJson: string,
): ReadonlyMap<
  keyof typeof REQUIRED_DATABASE_PROPERTIES,
  DatabasePropertyRow
> => {
  const keys = Object.keys(REQUIRED_DATABASE_PROPERTIES) as Array<
    keyof typeof REQUIRED_DATABASE_PROPERTIES
  >;
  const placeholders = keys.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT id, key, value_type, config_json, schema_revision
      FROM database_properties
      WHERE database_block_id = ? AND project_id = ?
        AND lifecycle = 'active' AND key IN (${placeholders})
      ORDER BY key, id
    `,
    )
    .all(databaseBlockId, request.projectId, ...keys) as Array<
    Omit<DatabasePropertyRow, "config"> & { readonly config_json: string }
  >;
  const properties = new Map<
    keyof typeof REQUIRED_DATABASE_PROPERTIES,
    DatabasePropertyRow
  >();
  for (const row of rows) {
    const expectedType = REQUIRED_DATABASE_PROPERTIES[row.key];
    if (row.value_type !== expectedType || properties.has(row.key)) {
      return reject(
        "database_schema_invalid",
        `Primary Database property ${row.key} has an ambiguous or invalid type`,
        request,
      );
    }
    let config: Readonly<Record<string, DatabaseJsonValue>>;
    try {
      config = parseDatabasePropertyConfig(
        row.value_type,
        JSON.parse(row.config_json),
      );
    } catch (error) {
      return reject(
        "database_schema_invalid",
        `Primary Database property ${row.key} has invalid config: ${error instanceof Error ? error.message : String(error)}`,
        request,
      );
    }
    properties.set(row.key, { ...row, config });
  }
  const missing = keys.filter((key) => !properties.has(key));
  if (missing.length > 0) {
    return reject(
      "database_schema_invalid",
      `Primary Database is missing required Card properties: ${missing.join(", ")}`,
      request,
    );
  }
  let viewConfig;
  try {
    viewConfig = parseGeneralDatabaseViewConfig(JSON.parse(viewConfigJson));
  } catch (error) {
    return reject(
      "database_schema_invalid",
      `Primary Kanban View config is invalid: ${error instanceof Error ? error.message : String(error)}`,
      request,
    );
  }
  if (viewConfig.group?.propertyId !== properties.get("status")?.id) {
    return reject(
      "database_schema_invalid",
      "Primary Kanban View must group by the current status property identity",
      request,
    );
  }
  return properties;
};

const registerCreateTagOptions = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: CreateCardBlockOperation;
  },
  property: DatabasePropertyRow,
  now: string,
): {
  readonly property: DatabasePropertyRow;
  readonly createdOptionIds: readonly string[];
} => {
  const rawOptions = property.config.options;
  if (!Array.isArray(rawOptions)) {
    return reject(
      "database_schema_invalid",
      `Primary Database tags property ${property.id} has no option registry`,
      request,
    );
  }
  const options = rawOptions.map((rawOption) => {
    if (
      typeof rawOption !== "object" ||
      rawOption === null ||
      Array.isArray(rawOption) ||
      typeof rawOption.id !== "string" ||
      typeof rawOption.name !== "string"
    ) {
      return reject(
        "database_schema_invalid",
        `Primary Database tags property ${property.id} has an invalid option`,
        request,
      );
    }
    return rawOption;
  });
  const existingIds = new Set(options.map((option) => option.id as string));
  const createdOptionIds = [...new Set(request.operation.tags)]
    .filter((tag) => !existingIds.has(tag))
    .sort((left, right) => left.localeCompare(right));
  if (createdOptionIds.length === 0) {
    return { property, createdOptionIds };
  }
  if (options.length + createdOptionIds.length > 10_000) {
    return reject(
      "database_schema_invalid",
      `Primary Database tags property ${property.id} exceeds the option registry limit`,
      request,
    );
  }
  const nextOptions = [
    ...options,
    ...createdOptionIds.map((tag) => ({ id: tag, name: tag })),
  ].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  );
  const config = parseDatabasePropertyConfig(property.value_type, {
    ...property.config,
    options: nextOptions,
  });
  const configJson = stableStringifyBlockPropertyJson(config);
  const updated = database
    .prepare(
      `
      UPDATE database_properties
      SET config_json = ?, schema_revision = schema_revision + 1, updated_at = ?
      WHERE id = ? AND project_id = ? AND lifecycle = 'active'
        AND schema_revision = ?
    `,
    )
    .run(
      configJson,
      now,
      property.id,
      request.projectId,
      property.schema_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(
      `Primary Database tags property ${property.id} changed during Card creation`,
    );
  }
  return {
    property: {
      ...property,
      config,
      config_json: configJson,
      schema_revision: property.schema_revision + 1,
    },
    createdOptionIds,
  };
};

const readPlacementItems = (
  database: Database.Database,
  projectId: string,
): readonly FractionalRankedItem[] =>
  database
    .prepare(
      `
      SELECT placement.block_id AS id, placement.rank_key AS rankKey
      FROM top_level_block_placements placement
      INNER JOIN blocks block
        ON block.id = placement.block_id
       AND block.project_id = placement.project_id
       AND block.location_kind = 'space'
       AND block.lifecycle <> 'deleted'
      WHERE placement.project_id = ?
      ORDER BY placement.rank_key, placement.block_id
    `,
    )
    .all(projectId) as FractionalRankedItem[];

const applyRankPlan = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  input: {
    readonly items: readonly FractionalRankedItem[];
    readonly targetId: string;
    readonly beforeId?: string;
    readonly updateExisting: (id: string, rankKey: string) => void;
  },
): { readonly rankKey: string; readonly rebalanced: number } => {
  let plan;
  try {
    plan = planFractionalRank({
      items: input.items,
      targetId: input.targetId,
      ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
    });
  } catch (error) {
    if (
      error instanceof FractionalRankError &&
      error.code === "anchor_not_found"
    ) {
      return reject("position_anchor_not_found", error.message, request);
    }
    throw error;
  }
  for (const [id, rankKey] of plan.rebalancedRankKeys) {
    input.updateExisting(id, rankKey);
  }
  return {
    rankKey: plan.rankKey,
    rebalanced: plan.rebalancedRankKeys.size,
  };
};

const allocateTopLevelRank = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  beforeBlockId?: string,
): { readonly rankKey: string; readonly rebalanced: number } =>
  applyRankPlan(database, request, {
    items: readPlacementItems(database, request.projectId),
    targetId: request.operation.cardId,
    ...(beforeBlockId === undefined ? {} : { beforeId: beforeBlockId }),
    updateExisting: (blockId, rankKey) => {
      database
        .prepare(
          `
          UPDATE top_level_block_placements
          SET rank_key = ?, updated_at = updated_at
          WHERE block_id = ? AND project_id = ?
        `,
        )
        .run(rankKey, blockId, request.projectId);
    },
  });

const allocateViewRank = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  input: {
    readonly viewId: string;
    readonly status: string;
    readonly beforeViewCardId?: string;
  },
): { readonly rankKey: string; readonly rebalanced: number } => {
  if (input.beforeViewCardId !== undefined) {
    const anchor = database
      .prepare(
        `
        SELECT group_key
        FROM database_view_positions
        WHERE view_id = ? AND block_id = ? AND project_id = ?
      `,
      )
      .get(input.viewId, input.beforeViewCardId, request.projectId) as
      { readonly group_key: string | null } | undefined;
    if (!anchor) {
      return reject(
        "position_anchor_not_found",
        `Primary View anchor does not exist: ${input.beforeViewCardId}`,
        request,
      );
    }
    if (anchor.group_key !== input.status) {
      return reject(
        "position_anchor_group_mismatch",
        `Primary View anchor ${input.beforeViewCardId} belongs to another status group`,
        request,
      );
    }
  }
  const items = database
    .prepare(
      `
      SELECT block_id AS id, rank_key AS rankKey
      FROM database_view_positions
      WHERE view_id = ? AND project_id = ? AND group_key = ?
      ORDER BY rank_key, block_id
    `,
    )
    .all(
      input.viewId,
      request.projectId,
      input.status,
    ) as FractionalRankedItem[];
  return applyRankPlan(database, request, {
    items,
    targetId: request.operation.cardId,
    ...(input.beforeViewCardId === undefined
      ? {}
      : { beforeId: input.beforeViewCardId }),
    updateExisting: (cardId, rankKey) => {
      database
        .prepare(
          `
          UPDATE database_view_positions
          SET rank_key = ?
          WHERE view_id = ? AND block_id = ? AND project_id = ?
        `,
        )
        .run(rankKey, input.viewId, cardId, request.projectId);
    },
  });
};

const databasePropertyValue = (
  input: CreateCardBlockOperation,
  key: keyof typeof REQUIRED_DATABASE_PROPERTIES,
): unknown => {
  switch (key) {
    case "status":
      return input.status;
    case "priority":
      return input.priority;
    case "estimate":
      return input.estimate;
    case "tags":
      return input.tags;
    case "due_date":
      return input.dueDate;
    case "scheduled_start":
      return input.scheduledStart;
    case "scheduled_end":
      return input.scheduledEnd;
    case "assignee":
      return input.assignee;
  }
};

const assertIdentityAvailable = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: CreateCardBlockOperation;
  },
  membershipId: string,
): void => {
  const documentId = `document:${request.operation.cardId}`;
  const collision = database
    .prepare(
      `
      SELECT 'block' AS kind FROM blocks WHERE id = ?
      UNION ALL SELECT 'document' FROM documents WHERE id = ?
      UNION ALL SELECT 'membership' FROM database_memberships WHERE id = ?
      LIMIT 1
    `,
    )
    .get(request.operation.cardId, documentId, membershipId) as
    { readonly kind: string } | undefined;
  if (!collision) return;
  reject(
    "card_identity_collision",
    `Card identity ${request.operation.cardId} collides with an existing ${collision.kind}`,
    request,
  );
};

const createCard = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: CreateCardBlockOperation;
  },
  now: string,
  options: ApplyCardLifecycleMutationOptions,
): AuthorityCommit => {
  if (!isUuidV7(request.operation.cardId)) {
    reject(
      "invalid_card_lifecycle_request",
      "New Card Block id must be a canonical lowercase UUID-v7",
      request,
    );
  }
  const membershipId = randomUUID();
  assertIdentityAvailable(database, request, membershipId);
  const primary = readPrimaryDatabase(database, request);
  const properties = new Map(
    readRequiredDatabaseProperties(
    database,
    request,
    primary.database_block_id,
    primary.view_config_json,
    ),
  );
  const tagsProperty = properties.get("tags");
  if (!tagsProperty) {
    return reject(
      "database_schema_invalid",
      "Primary Database is missing its tags property",
      request,
    );
  }
  const registeredTags = registerCreateTagOptions(
    database,
    request,
    tagsProperty,
    now,
  );
  properties.set("tags", registeredTags.property);
  const viewRank = allocateViewRank(database, request, {
    viewId: primary.view_id,
    status: request.operation.status,
    beforeViewCardId: request.operation.beforeViewCardId,
  });
  const cardId = request.operation.cardId;
  const documentId = `document:${cardId}`;
  const genesis = createCardDocumentGenesis({
    documentId,
    title: request.operation.title,
    nfm: request.operation.nfm,
    ...(options.allocateBodyBlockId === undefined
      ? {}
      : { allocateBlockId: options.allocateBodyBlockId }),
  });
  try {
    database
      .prepare(
        `
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, containing_database_id,
          location_revision, metadata_revision,
          created_at, updated_at
        ) VALUES (?, ?, 'card', 'active', 'database', NULL, ?, 1, 1, ?, ?)
      `,
      )
      .run(cardId, request.projectId, primary.database_block_id, now, now);
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
        request.projectId,
        CARD_DOCUMENT_SCHEMA_KEY,
        CARD_DOCUMENT_SCHEMA_VERSION,
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
      .run(cardId, documentId, request.projectId, now);
    options.faultInjector?.("after_identity");

    const genesisAck = initializeCardDocumentGenesis(database, {
      documentId,
      storeEpoch: request.storeEpoch,
      generation: 1,
      updateId: genesisUpdateId(request.operationId),
      clientSessionId: request.clientSessionId ?? "authoritative-card-create",
      update: genesis.update,
      finalAuthority: "ydoc_primary",
    });
    options.faultInjector?.("after_document_genesis");

    database
      .prepare(
        `
        INSERT INTO database_memberships (
          id, database_block_id, card_block_id, project_id,
          revision, created_at, removed_at
        ) VALUES (?, ?, ?, ?, 1, ?, NULL)
      `,
      )
      .run(
        membershipId,
        primary.database_block_id,
        cardId,
        request.projectId,
        now,
      );
    const insertDatabaseValue = database.prepare(
      `
      INSERT INTO database_property_values (
        membership_id, property_id, database_block_id, project_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `,
    );
    for (const [key, property] of properties) {
      let value: DatabaseJsonValue;
      try {
        value = normalizeDatabasePropertyValue(
          {
            valueType: property.value_type,
            config: property.config,
          },
          databasePropertyValue(request.operation, key),
        );
      } catch (error) {
        return reject(
          "database_property_value_invalid",
          `Card value for primary Database property ${key} violates the current schema: ${error instanceof Error ? error.message : String(error)}`,
          request,
        );
      }
      insertDatabaseValue.run(
        membershipId,
        property.id,
        primary.database_block_id,
        request.projectId,
        property.value_type,
        stableStringifyBlockPropertyJson(value),
        now,
      );
    }
    const insertIntrinsic = database.prepare(
      `
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type,
        value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `,
    );
    for (const [key, definition] of Object.entries(INTRINSIC_CARD_PROPERTIES)) {
      insertIntrinsic.run(
        cardId,
        request.projectId,
        key,
        definition.valueType,
        stableStringifyBlockPropertyJson(definition.read(request.operation)),
        now,
      );
    }
    database
      .prepare(
        `
        INSERT INTO database_view_positions (
          view_id, block_id, project_id, group_key, rank_key,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `,
      )
      .run(
        primary.view_id,
        cardId,
        request.projectId,
        request.operation.status,
        viewRank.rankKey,
        now,
        now,
      );
    options.faultInjector?.("after_properties");

    const createdBlockIds = flattenBlockIds(genesis.materialization.blockTree);
    return {
      cardId,
      lifecycle: "active",
      metadataRevision: 1,
      locationRevision: 1,
      documentId,
      documentGeneration: 1,
      documentHeadSeq: genesisAck.headSeq,
      databaseBlockId: primary.database_block_id,
      membershipId,
      viewId: primary.view_id,
      topLevelRankKey: null,
      viewRankKey: viewRank.rankKey,
      createdBlockIds,
      targetBlockIds: uniqueSorted([
        cardId,
        primary.database_block_id,
        ...createdBlockIds,
      ]),
      affectedDatabaseBlockIds: [primary.database_block_id],
      fieldIntents: [
        { path: `blocks.${cardId}`, operation: "create" },
        { path: `documents.${documentId}`, operation: "genesis" },
        { path: `memberships.${membershipId}`, operation: "create" },
        ...registeredTags.createdOptionIds.map((optionId) => ({
          path: `databases.${primary.database_block_id}.properties.${tagsProperty.id}.options.${optionId}`,
          operation: "add",
        })),
      ],
      expectedRevisions: {
        blockMetadata: 0,
        blockLocation: 0,
        membership: 0,
      },
      committedRevisions: {
        blockMetadata: 1,
        blockLocation: 1,
        membership: 1,
        viewPosition: 1,
      },
      changePayload: {
        operation: "create_card",
        cardId,
        documentId,
        databaseBlockId: primary.database_block_id,
        membershipId,
        viewId: primary.view_id,
        status: request.operation.status,
        createdBlockIds,
        topLevelRankKey: null,
        viewRankKey: viewRank.rankKey,
        rebalancedTopLevelPlacements: [],
        rebalancedViewPositions: viewRank.rebalanced,
        createdTagOptionIds: registeredTags.createdOptionIds,
      },
    };
  } finally {
    genesis.document.destroy();
  }
};

const requireRevision = (
  request: CardLifecycleMutationRequest,
  expected: number,
  actual: number,
  kind: "metadata" | "location",
): void => {
  if (expected === actual) return;
  reject(
    kind === "metadata"
      ? "metadata_revision_conflict"
      : "location_revision_conflict",
    `Card ${request.operation.cardId} ${kind} revision changed`,
    request,
    { expectedRevision: expected, actualRevision: actual },
  );
};

const lifecycleTransition = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation:
      | Extract<CardLifecycleOperation, { readonly kind: "archive_card" }>
      | Extract<CardLifecycleOperation, { readonly kind: "unarchive_card" }>;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  const expectedLifecycle =
    request.operation.kind === "archive_card" ? "active" : "archived";
  const targetLifecycle =
    request.operation.kind === "archive_card" ? "archived" : "active";
  if (block.lifecycle !== expectedLifecycle) {
    return reject(
      "card_lifecycle_conflict",
      `Card ${block.id} is ${block.lifecycle}; ${request.operation.kind} requires ${expectedLifecycle}`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedMetadataRevision,
    block.metadata_revision,
    "metadata",
  );
  const document = readOwnedDocument(database, request);
  const membership = readActiveMembership(database, request);
  const nextMetadataRevision = block.metadata_revision + 1;
  const updated = database
    .prepare(
      `
      UPDATE blocks
      SET lifecycle = ?, metadata_revision = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND lifecycle = ?
        AND metadata_revision = ?
    `,
    )
    .run(
      targetLifecycle,
      nextMetadataRevision,
      now,
      block.id,
      request.projectId,
      expectedLifecycle,
      block.metadata_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(`Card ${block.id} changed during lifecycle transition`);
  }
  return makeExistingCommit(database, request, {
    block: {
      ...block,
      lifecycle: targetLifecycle,
      metadata_revision: nextMetadataRevision,
    },
    document,
    membership,
    operation: request.operation.kind,
    expectedRevisions: { blockMetadata: block.metadata_revision },
    committedRevisions: { blockMetadata: nextMetadataRevision },
  });
};

const readActiveMembership = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
): MembershipRow | null =>
  (database
    .prepare(
      `
      SELECT id, database_block_id, revision, removed_at
      FROM database_memberships
      WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      LIMIT 1
    `,
    )
    .get(request.operation.cardId, request.projectId) as
    MembershipRow | undefined) ?? null;

const readPrimaryViewForMembership = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  membership: MembershipRow | null,
): { readonly viewId: string | null; readonly rankKey: string | null } => {
  if (!membership) return { viewId: null, rankKey: null };
  const row = database
    .prepare(
      `
      SELECT view.id AS view_id, position.rank_key
      FROM database_views view
      LEFT JOIN database_view_positions position
        ON position.view_id = view.id
       AND position.block_id = ?
       AND position.project_id = view.project_id
      WHERE view.database_block_id = ? AND view.project_id = ?
        AND view.is_primary = 1 AND view.lifecycle = 'active'
      LIMIT 1
    `,
    )
    .get(
      request.operation.cardId,
      membership.database_block_id,
      request.projectId,
    ) as
    { readonly view_id: string; readonly rank_key: string | null } | undefined;
  return {
    viewId: row?.view_id ?? null,
    rankKey: row?.rank_key ?? null,
  };
};

const readMembershipStatus = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  membership: MembershipRow | null,
): CardStatus | null => {
  if (!membership) return null;
  const row = database
    .prepare(
      `
      SELECT value.value_json
      FROM database_property_values value
      INNER JOIN database_properties property
        ON property.id = value.property_id
       AND property.database_block_id = value.database_block_id
       AND property.project_id = value.project_id
       AND property.key = 'status'
       AND property.value_type = 'select'
       AND property.lifecycle = 'active'
      WHERE value.membership_id = ? AND value.database_block_id = ?
        AND value.project_id = ?
    `,
    )
    .get(membership.id, membership.database_block_id, request.projectId) as
    { readonly value_json: string } | undefined;
  let parsed: unknown;
  try {
    parsed = row ? JSON.parse(row.value_json) : undefined;
  } catch {
    parsed = undefined;
  }
  if (isCardStatus(parsed)) return parsed;
  return reject(
    "database_schema_invalid",
    `Membership ${membership.id} has no valid status property`,
    request,
  );
};

const readPlacementRank = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
): string | null =>
  (
    database
      .prepare(
        `
        SELECT rank_key
        FROM top_level_block_placements
        WHERE block_id = ? AND project_id = ?
      `,
      )
      .get(request.operation.cardId, request.projectId) as
      { readonly rank_key: string } | undefined
  )?.rank_key ?? null;

const makeExistingCommit = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  input: {
    readonly block: BlockRow;
    readonly document: OwnedDocumentRow;
    readonly membership: MembershipRow | null;
    readonly operation: CardLifecycleOperation["kind"];
    readonly expectedRevisions: Readonly<Record<string, number>>;
    readonly committedRevisions: Readonly<Record<string, number>>;
    readonly topLevelRankKey?: string | null;
    readonly viewId?: string | null;
    readonly viewRankKey?: string | null;
    readonly changePayload?: Readonly<Record<string, unknown>>;
  },
): AuthorityCommit => {
  const primaryView = readPrimaryViewForMembership(
    database,
    request,
    input.membership,
  );
  const topLevelRankKey =
    input.topLevelRankKey === undefined
      ? readPlacementRank(database, request)
      : input.topLevelRankKey;
  const viewId = input.viewId === undefined ? primaryView.viewId : input.viewId;
  const viewRankKey =
    input.viewRankKey === undefined ? primaryView.rankKey : input.viewRankKey;
  return {
    cardId: input.block.id,
    lifecycle: input.block.lifecycle,
    metadataRevision: input.block.metadata_revision,
    locationRevision: input.block.location_revision,
    documentId: input.document.document_id,
    documentGeneration: input.document.generation,
    documentHeadSeq: input.document.head_seq,
    databaseBlockId: input.membership?.database_block_id ?? null,
    membershipId: input.membership?.id ?? null,
    viewId,
    topLevelRankKey,
    viewRankKey,
    createdBlockIds: [],
    targetBlockIds: uniqueSorted([
      input.block.id,
      ...(input.membership ? [input.membership.database_block_id] : []),
    ]),
    affectedDatabaseBlockIds: input.membership
      ? [input.membership.database_block_id]
      : [],
    fieldIntents: [
      {
        path: `blocks.${input.block.id}`,
        operation: input.operation,
      },
    ],
    expectedRevisions: input.expectedRevisions,
    committedRevisions: input.committedRevisions,
    changePayload: {
      operation: input.operation,
      cardId: input.block.id,
      lifecycle: input.block.lifecycle,
      metadataRevision: input.block.metadata_revision,
      locationRevision: input.block.location_revision,
      topLevelRankKey,
      viewRankKey,
      ...(input.changePayload ?? {}),
    },
  };
};

interface IndexedLifecycleTransition {
  readonly id: string;
  readonly expectedMetadataRevision: number;
  readonly committedMetadataRevision: number;
}

const indexedBlockMetadataRevisionKey = (blockId: string): string =>
  `indexedBlockMetadata:${blockId}`;

const withIndexedLifecycleEvidence = (
  commit: AuthorityCommit,
  input: {
    readonly indexedBlockIds: readonly string[];
    readonly indexedDocumentIds: readonly string[];
    readonly transitions: readonly IndexedLifecycleTransition[];
    readonly operation: "delete" | "restore";
    readonly payloadKey: "tombstonedBlockIds" | "restoredBlockIds";
  },
): AuthorityCommit => ({
  ...commit,
  targetBlockIds: uniqueSorted([
    ...commit.targetBlockIds,
    ...input.indexedBlockIds,
  ]),
  fieldIntents: [
    ...commit.fieldIntents,
    ...input.transitions.map((transition) => ({
      path: `blocks.${transition.id}.lifecycle`,
      operation: input.operation,
    })),
  ],
  expectedRevisions: {
    ...commit.expectedRevisions,
    ...Object.fromEntries(
      input.transitions.map((transition) => [
        indexedBlockMetadataRevisionKey(transition.id),
        transition.expectedMetadataRevision,
      ]),
    ),
  },
  committedRevisions: {
    ...commit.committedRevisions,
    ...Object.fromEntries(
      input.transitions.map((transition) => [
        indexedBlockMetadataRevisionKey(transition.id),
        transition.committedMetadataRevision,
      ]),
    ),
  },
  changePayload: {
    ...commit.changePayload,
    indexedDocumentIds: input.indexedDocumentIds,
    [input.payloadKey]: input.indexedBlockIds,
  },
});

const deleteCard = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: Extract<
      CardLifecycleOperation,
      { readonly kind: "delete_card" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  if (block.lifecycle === "deleted") {
    return reject(
      "card_lifecycle_conflict",
      `Card ${block.id} is already deleted`,
      request,
    );
  }
  if (block.location_kind === "document") {
    return reject(
      "card_location_invalid",
      `Nested Card ${block.id} must be removed through Block transfer`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedMetadataRevision,
    block.metadata_revision,
    "metadata",
  );
  requireRevision(
    request,
    request.operation.expectedLocationRevision,
    block.location_revision,
    "location",
  );
  const document = readOwnedDocument(database, request);
  const indexedClosure = readCurrentIndexedBlockClosure(
    database,
    request,
    block,
  );
  const indexedContentBlocks = indexedClosure.blocks.filter(
    (candidate) => candidate.id !== block.id,
  );
  const nonActiveContentBlock = indexedContentBlocks.find(
    (candidate) => candidate.lifecycle !== "active",
  );
  if (nonActiveContentBlock) {
    return reject(
      "document_state_corrupt",
      `Current indexed Block ${nonActiveContentBlock.id} is ${nonActiveContentBlock.lifecycle}, not active`,
      request,
    );
  }
  const membership = readActiveMembership(database, request);
  if (
    (block.location_kind === "database" &&
      membership?.database_block_id !== block.containing_database_id) ||
    (block.location_kind === "space" && membership !== null)
  ) {
    return reject(
      "database_schema_invalid",
      `Card ${block.id} parent and active membership disagree`,
      request,
    );
  }
  const primaryView = readPrimaryViewForMembership(
    database,
    request,
    membership,
  );
  const previousStatus = readMembershipStatus(database, request, membership);
  const topLevelRankKey =
    block.location_kind === "space"
      ? readPlacementRank(database, request)
      : null;
  if (block.location_kind === "space" && !topLevelRankKey) {
    return reject(
      "database_schema_invalid",
      `Space Card ${block.id} is missing its top-level placement`,
      request,
    );
  }
  if (membership && (!primaryView.viewId || !primaryView.rankKey)) {
    return reject(
      "database_schema_invalid",
      `Card ${block.id} has membership without a complete primary View position`,
      request,
    );
  }
  database
    .prepare(
      "DELETE FROM database_view_positions WHERE block_id = ? AND project_id = ?",
    )
    .run(block.id, request.projectId);
  if (membership) {
    const removedMembership = database
      .prepare(
        `
        UPDATE database_memberships
        SET removed_at = ?, revision = revision + 1
        WHERE id = ? AND project_id = ? AND removed_at IS NULL AND revision = ?
      `,
      )
      .run(now, membership.id, request.projectId, membership.revision);
    if (removedMembership.changes !== 1) {
      throw new Error(
        `Membership ${membership.id} changed during Card deletion`,
      );
    }
  }
  database
    .prepare(
      "DELETE FROM top_level_block_placements WHERE block_id = ? AND project_id = ?",
    )
    .run(block.id, request.projectId);
  const metadataRevision = block.metadata_revision + 1;
  const locationRevision = block.location_revision + 1;
  const updated = database
    .prepare(
      `
      UPDATE blocks
      SET lifecycle = 'deleted', metadata_revision = ?, location_revision = ?,
          updated_at = ?
      WHERE id = ? AND project_id = ? AND lifecycle = ?
        AND metadata_revision = ? AND location_revision = ?
    `,
    )
    .run(
      metadataRevision,
      locationRevision,
      now,
      block.id,
      request.projectId,
      block.lifecycle,
      block.metadata_revision,
      block.location_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(`Card ${block.id} changed during deletion`);
  }
  const tombstoneContentBlock = database.prepare(
    `
    UPDATE blocks
    SET lifecycle = 'deleted', metadata_revision = metadata_revision + 1,
        updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = 'active'
      AND metadata_revision = ?
  `,
  );
  const contentTransitions = indexedContentBlocks.map((contentBlock) => {
    const tombstoned = tombstoneContentBlock.run(
      now,
      contentBlock.id,
      request.projectId,
      contentBlock.metadataRevision,
    );
    if (tombstoned.changes !== 1) {
      throw new Error(
        `Indexed Block ${contentBlock.id} changed during Card deletion`,
      );
    }
    return {
      id: contentBlock.id,
      expectedMetadataRevision: contentBlock.metadataRevision,
      committedMetadataRevision: contentBlock.metadataRevision + 1,
    };
  });
  const commit = makeExistingCommit(database, request, {
    block: {
      ...block,
      lifecycle: "deleted",
      metadata_revision: metadataRevision,
      location_revision: locationRevision,
    },
    document,
    membership:
      membership === null
        ? null
        : {
            ...membership,
            revision: membership.revision + 1,
            removed_at: now,
          },
    operation: "delete_card",
    expectedRevisions: {
      blockMetadata: block.metadata_revision,
      blockLocation: block.location_revision,
      ...(membership === null ? {} : { membership: membership.revision }),
    },
    committedRevisions: {
      blockMetadata: metadataRevision,
      blockLocation: locationRevision,
      ...(membership === null ? {} : { membership: membership.revision + 1 }),
    },
    topLevelRankKey: null,
    viewId: primaryView.viewId,
    viewRankKey: null,
    changePayload: {
      previousLifecycle: block.lifecycle,
      removedMembershipId: membership?.id ?? null,
      removedDatabaseBlockId: membership?.database_block_id ?? null,
      removedViewId: primaryView.viewId,
      previousStatus,
      previousTopLevelRankKey: topLevelRankKey,
      previousViewRankKey: primaryView.rankKey,
    },
  });
  return withIndexedLifecycleEvidence(commit, {
    indexedBlockIds: indexedClosure.blocks.map((candidate) => candidate.id),
    indexedDocumentIds: indexedClosure.documentIds,
    transitions: contentTransitions,
    operation: "delete",
    payloadKey: "tombstonedBlockIds",
  });
};

const parseStringArray = (value: string): readonly string[] | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string") &&
      new Set(parsed).size === parsed.length
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const readCanonicalStringArray = (value: unknown): readonly string[] | null => {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    return null;
  }
  const sorted = uniqueSorted(value);
  if (
    sorted.length !== value.length ||
    sorted.some((entry, index) => entry !== value[index])
  ) {
    return null;
  }
  return value;
};

const sameStringArray = (
  left: readonly string[] | null,
  right: readonly string[],
): boolean =>
  left?.length === right.length &&
  left.every((entry, index) => entry === right[index]);

const parseRevisionRecord = (
  value: string,
): Readonly<Record<string, number>> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const entries = Object.entries(parsed);
    if (
      entries.every(
        ([key, revision]) =>
          key.length > 0 &&
          typeof revision === "number" &&
          Number.isSafeInteger(revision) &&
          revision >= 0,
      )
    ) {
      return Object.fromEntries(entries) as Readonly<Record<string, number>>;
    }
  } catch {
    return null;
  }
  return null;
};

const readDeleteEvidence = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: RestoreCardBlockOperation;
  },
  block: BlockRow,
  document: OwnedDocumentRow,
): DeleteEvidence => {
  const row = database
    .prepare(
      `
      SELECT
        mutation.project_id, mutation.store_epoch, mutation.mutation_kind,
        mutation.request_hash, mutation.target_block_ids_json,
        mutation.affected_document_ids_json,
        mutation.affected_database_block_ids_json,
        mutation.expected_revisions_json, mutation.committed_revisions_json,
        mutation.outcome, mutation.result_json, mutation.change_log_seq,
        change.project_id AS change_project_id,
        change.store_epoch AS change_store_epoch,
        change.kind AS change_kind,
        change.operation_id AS change_operation_id,
        change.block_ids_json AS change_block_ids_json,
        change.document_ids_json AS change_document_ids_json,
        change.database_block_ids_json AS change_database_block_ids_json,
        change.payload_json AS change_payload_json
      FROM block_mutations mutation
      INNER JOIN change_log change ON change.seq = mutation.change_log_seq
      WHERE mutation.mutation_id = ?
    `,
    )
    .get(request.operation.deleteOperationId) as
    | {
        readonly project_id: string;
        readonly store_epoch: string;
        readonly mutation_kind: string;
        readonly request_hash: string;
        readonly target_block_ids_json: string;
        readonly affected_document_ids_json: string;
        readonly affected_database_block_ids_json: string;
        readonly expected_revisions_json: string;
        readonly committed_revisions_json: string;
        readonly outcome: string;
        readonly result_json: string;
        readonly change_log_seq: number;
        readonly change_project_id: string;
        readonly change_store_epoch: string;
        readonly change_kind: string;
        readonly change_operation_id: string | null;
        readonly change_block_ids_json: string;
        readonly change_document_ids_json: string;
        readonly change_database_block_ids_json: string;
        readonly change_payload_json: string;
      }
    | undefined;
  if (!row) {
    return reject(
      "delete_evidence_invalid",
      `Committed delete evidence does not exist: ${request.operation.deleteOperationId}`,
      request,
    );
  }
  if (
    row.project_id !== request.projectId ||
    row.mutation_kind !== MUTATION_KIND ||
    row.outcome !== "committed" ||
    row.change_project_id !== row.project_id ||
    row.change_store_epoch !== row.store_epoch ||
    row.change_kind !== "block_mutation" ||
    row.change_operation_id !== request.operation.deleteOperationId ||
    row.change_block_ids_json !== row.target_block_ids_json ||
    row.change_document_ids_json !== row.affected_document_ids_json ||
    row.change_database_block_ids_json !== row.affected_database_block_ids_json
  ) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} has divergent ledger identity`,
      request,
    );
  }
  let storedResult: CardLifecycleMutationCommandResult;
  let payload: Readonly<Record<string, unknown>>;
  try {
    storedResult = parseCardLifecycleMutationCommandResult(
      JSON.parse(row.result_json),
    );
    const parsedPayload = JSON.parse(row.change_payload_json) as unknown;
    if (
      typeof parsedPayload !== "object" ||
      parsedPayload === null ||
      Array.isArray(parsedPayload)
    ) {
      throw new TypeError("change payload is not an object");
    }
    payload = parsedPayload as Readonly<Record<string, unknown>>;
  } catch (error) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} is corrupt: ${error instanceof Error ? error.message : String(error)}`,
      request,
    );
  }
  const targetBlockIds = parseStringArray(row.target_block_ids_json);
  const documentIds = parseStringArray(row.affected_document_ids_json);
  const databaseBlockIds = parseStringArray(
    row.affected_database_block_ids_json,
  );
  const expectedRevisions = parseRevisionRecord(row.expected_revisions_json);
  const committedRevisions = parseRevisionRecord(
    row.committed_revisions_json,
  );
  const tombstonedBlockIds = readCanonicalStringArray(
    payload.tombstonedBlockIds,
  );
  const indexedDocumentIds = readCanonicalStringArray(
    payload.indexedDocumentIds,
  );
  if (!storedResult.ok) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} is not a committed receipt`,
      request,
    );
  }
  const receipt = storedResult.value;
  const previousLifecycle = payload.previousLifecycle;
  const removedMembershipId = payload.removedMembershipId;
  const removedDatabaseBlockId = payload.removedDatabaseBlockId;
  const removedViewId = payload.removedViewId;
  const previousStatus = payload.previousStatus;
  const currentClosure = readCurrentIndexedBlockClosure(
    database,
    request,
    block,
  );
  const currentBlockIds = currentClosure.blocks.map((candidate) => candidate.id);
  const currentContentBlocks = currentClosure.blocks.filter(
    (candidate) => candidate.id !== block.id,
  );
  const indexedRevisionKeys = currentContentBlocks.map((candidate) =>
    indexedBlockMetadataRevisionKey(candidate.id),
  );
  const storedExpectedIndexedKeys = Object.keys(expectedRevisions ?? {})
    .filter((key) => key.startsWith("indexedBlockMetadata:"))
    .sort((left, right) => left.localeCompare(right));
  const storedCommittedIndexedKeys = Object.keys(committedRevisions ?? {})
    .filter((key) => key.startsWith("indexedBlockMetadata:"))
    .sort((left, right) => left.localeCompare(right));
  const expectedTargetBlockIds = uniqueSorted([
    ...currentBlockIds,
    ...(typeof removedDatabaseBlockId === "string"
      ? [removedDatabaseBlockId]
      : []),
  ]);
  const contentTombstonesMatch = currentContentBlocks.every((candidate) => {
    const key = indexedBlockMetadataRevisionKey(candidate.id);
    const expected = expectedRevisions?.[key];
    const committed = committedRevisions?.[key];
    return (
      candidate.lifecycle === "deleted" &&
      typeof expected === "number" &&
      committed === expected + 1 &&
      candidate.metadataRevision === committed
    );
  });
  const evidenceMatches =
    sameStringArray(targetBlockIds, expectedTargetBlockIds) &&
    sameStringArray(tombstonedBlockIds, currentBlockIds) &&
    sameStringArray(indexedDocumentIds, currentClosure.documentIds) &&
    sameStringArray(storedExpectedIndexedKeys, indexedRevisionKeys) &&
    sameStringArray(storedCommittedIndexedKeys, indexedRevisionKeys) &&
    contentTombstonesMatch &&
    documentIds?.length === 1 &&
    documentIds[0] === document.document_id &&
    databaseBlockIds !== null &&
    expectedRevisions !== null &&
    committedRevisions !== null &&
    expectedRevisions.blockMetadata === receipt.metadataRevision - 1 &&
    committedRevisions.blockMetadata === receipt.metadataRevision &&
    expectedRevisions.blockLocation === receipt.locationRevision - 1 &&
    committedRevisions.blockLocation === receipt.locationRevision &&
    payload.mutationKind === MUTATION_KIND &&
    payload.requestHash === row.request_hash &&
    payload.operation === "delete_card" &&
    payload.cardId === block.id &&
    (previousLifecycle === "active" || previousLifecycle === "archived") &&
    (removedMembershipId === null || typeof removedMembershipId === "string") &&
    (removedDatabaseBlockId === null ||
      typeof removedDatabaseBlockId === "string") &&
    (removedViewId === null || typeof removedViewId === "string") &&
    (previousStatus === null || isCardStatus(previousStatus)) &&
    receipt.operationId === request.operation.deleteOperationId &&
    receipt.operationKind === "delete_card" &&
    receipt.projectId === request.projectId &&
    receipt.cardId === block.id &&
    receipt.lifecycle === "deleted" &&
    receipt.metadataRevision === block.metadata_revision &&
    receipt.locationRevision === block.location_revision &&
    receipt.documentId === document.document_id &&
    receipt.documentGeneration === document.generation &&
    receipt.documentHeadSeq === document.head_seq &&
    receipt.membershipId === removedMembershipId &&
    receipt.databaseBlockId === removedDatabaseBlockId &&
    receipt.viewId === removedViewId &&
    receipt.topLevelRankKey === null &&
    receipt.viewRankKey === null &&
    receipt.changeLogSeq === row.change_log_seq &&
    ((removedMembershipId === null &&
      removedDatabaseBlockId === null &&
      removedViewId === null &&
      previousStatus === null &&
      databaseBlockIds.length === 0) ||
      (typeof removedMembershipId === "string" &&
        typeof removedDatabaseBlockId === "string" &&
        typeof removedViewId === "string" &&
        isCardStatus(previousStatus) &&
        databaseBlockIds.length === 1 &&
        databaseBlockIds[0] === removedDatabaseBlockId));
  if (!evidenceMatches) {
    return reject(
      "delete_evidence_invalid",
      `Delete evidence ${request.operation.deleteOperationId} does not name the current Card tombstone`,
      request,
    );
  }
  return {
    previousLifecycle,
    databaseBlockId: removedDatabaseBlockId,
    membershipId: removedMembershipId,
    viewId: removedViewId,
    status: previousStatus as CardStatus | null,
    metadataRevision: receipt.metadataRevision,
    locationRevision: receipt.locationRevision,
    tombstonedBlocks: currentClosure.blocks,
    indexedDocumentIds: currentClosure.documentIds,
  };
};

const readRemovedMembership = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: RestoreWithMembershipOperation;
  },
): MembershipRow => {
  const row = database
    .prepare(
      `
      SELECT id, database_block_id, revision, removed_at
      FROM database_memberships
      WHERE id = ? AND database_block_id = ? AND card_block_id = ?
        AND project_id = ? AND removed_at IS NOT NULL
    `,
    )
    .get(
      request.operation.membership.membershipId,
      request.operation.membership.databaseBlockId,
      request.operation.cardId,
      request.projectId,
    ) as MembershipRow | undefined;
  if (row) return row;
  return reject(
    "membership_not_found",
    `Removed membership ${request.operation.membership.membershipId} is not restorable for Card ${request.operation.cardId}`,
    request,
  );
};

const assertRestoreView = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: RestoreWithMembershipOperation;
  },
): ReadonlyMap<
  keyof typeof REQUIRED_DATABASE_PROPERTIES,
  DatabasePropertyRow
> => {
  const row = database
    .prepare(
      `
      SELECT view.config_json
      FROM database_views view
      INNER JOIN database_capabilities capability
        ON capability.block_id = view.database_block_id
       AND capability.project_id = view.project_id
      INNER JOIN blocks database_block
        ON database_block.id = capability.block_id
       AND database_block.project_id = capability.project_id
       AND database_block.type = 'database'
       AND database_block.lifecycle = 'active'
      WHERE view.id = ? AND view.database_block_id = ? AND view.project_id = ?
        AND view.lifecycle = 'active' AND view.is_primary = 1
        AND view.kind = 'kanban'
    `,
    )
    .get(
      request.operation.membership.viewId,
      request.operation.membership.databaseBlockId,
      request.projectId,
    ) as { readonly config_json: string } | undefined;
  if (!row) {
    return reject(
      "view_not_found",
      `Restore View ${request.operation.membership.viewId} is not an active primary Kanban View`,
      request,
    );
  }
  return readRequiredDatabaseProperties(
    database,
    request,
    request.operation.membership.databaseBlockId,
    row.config_json,
  );
};

const assertCompleteMembershipValues = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: RestoreWithMembershipOperation;
  },
  properties: ReadonlyMap<
    keyof typeof REQUIRED_DATABASE_PROPERTIES,
    DatabasePropertyRow
  >,
): void => {
  const rows = database
    .prepare(
      `
      SELECT property_id, value_type
      FROM database_property_values
      WHERE membership_id = ? AND database_block_id = ? AND project_id = ?
    `,
    )
    .all(
      request.operation.membership.membershipId,
      request.operation.membership.databaseBlockId,
      request.projectId,
    ) as Array<{ readonly property_id: string; readonly value_type: string }>;
  const values = new Map(rows.map((row) => [row.property_id, row.value_type]));
  const missing = [...properties.values()].filter(
    (property) => values.get(property.id) !== property.value_type,
  );
  if (missing.length === 0) return;
  reject(
    "database_schema_invalid",
    `Removed membership ${request.operation.membership.membershipId} lacks complete Card property values`,
    request,
  );
};

const restoreCard = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: RestoreCardBlockOperation;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  if (block.lifecycle !== "deleted") {
    return reject(
      "card_lifecycle_conflict",
      `Card ${block.id} is ${block.lifecycle}; restore requires deleted`,
      request,
    );
  }
  if (block.location_kind === "document") {
    return reject(
      "card_location_invalid",
      `Deleted nested Card ${block.id} must be restored through Block transfer`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedMetadataRevision,
    block.metadata_revision,
    "metadata",
  );
  requireRevision(
    request,
    request.operation.expectedLocationRevision,
    block.location_revision,
    "location",
  );
  const document = readOwnedDocument(database, request);
  const deleteEvidence = readDeleteEvidence(database, request, block, document);
  if (readActiveMembership(database, request)) {
    return reject(
      "card_lifecycle_conflict",
      `Deleted Card ${block.id} unexpectedly has an active membership`,
      request,
    );
  }
  const restoreMembership =
    request.operation.membership === null
      ? null
      : (request as CardLifecycleMutationRequest & {
          readonly operation: RestoreWithMembershipOperation;
        });
  const requestedMembership = restoreMembership?.operation.membership ?? null;
  const restoresDatabaseParent = requestedMembership !== null;
  if (
    (restoresDatabaseParent && block.location_kind !== "database") ||
    (!restoresDatabaseParent && block.location_kind !== "space")
  ) {
    return reject(
      "delete_evidence_invalid",
      `Restore parent does not match deleted Card ${block.id} location`,
      request,
    );
  }
  const topLevelRank = restoresDatabaseParent
    ? null
    : allocateTopLevelRank(
        database,
        request,
        request.operation.beforeBlockId,
      );
  const evidenceMembershipMatches =
    (deleteEvidence.membershipId === null && requestedMembership === null) ||
    (requestedMembership !== null &&
      requestedMembership.membershipId === deleteEvidence.membershipId &&
      requestedMembership.databaseBlockId === deleteEvidence.databaseBlockId &&
      requestedMembership.viewId === deleteEvidence.viewId &&
      requestedMembership.status === deleteEvidence.status);
  if (!evidenceMembershipMatches) {
    return reject(
      "delete_evidence_invalid",
      `Restore membership does not match delete ${request.operation.deleteOperationId}`,
      request,
    );
  }
  const membership = restoreMembership
    ? readRemovedMembership(database, restoreMembership)
    : null;
  const properties = restoreMembership
    ? assertRestoreView(database, restoreMembership)
    : null;
  if (restoreMembership && properties) {
    assertCompleteMembershipValues(database, restoreMembership, properties);
    const persistedStatus = readMembershipStatus(
      database,
      restoreMembership,
      membership,
    );
    const statusProperty = properties.get("status");
    if (!statusProperty) {
      throw new Error("Validated Card Database lost its status property");
    }
    let normalizedStatus: DatabaseJsonValue;
    try {
      normalizedStatus = normalizeDatabasePropertyValue(
        {
          valueType: statusProperty.value_type,
          config: statusProperty.config,
        },
        persistedStatus,
      );
    } catch (error) {
      return reject(
        "database_schema_invalid",
        `Removed membership status violates the current Database schema: ${error instanceof Error ? error.message : String(error)}`,
        request,
      );
    }
    if (persistedStatus !== restoreMembership.operation.membership.status) {
      return reject(
        "delete_evidence_invalid",
        `Removed membership ${restoreMembership.operation.membership.membershipId} changed status after delete`,
        request,
      );
    }
    if (normalizedStatus !== persistedStatus) {
      return reject(
        "database_schema_invalid",
        "Removed membership status normalized to a different value",
        request,
      );
    }
  }
  const viewRank = restoreMembership
    ? allocateViewRank(database, request, {
        viewId: restoreMembership.operation.membership.viewId,
        status: restoreMembership.operation.membership.status,
        beforeViewCardId:
          restoreMembership.operation.membership.beforeViewCardId,
      })
    : null;
  const metadataRevision = block.metadata_revision + 1;
  const locationRevision = block.location_revision + 1;
  const updatedBlock = database
    .prepare(
      `
      UPDATE blocks
      SET lifecycle = ?, metadata_revision = ?, location_revision = ?,
          updated_at = ?
      WHERE id = ? AND project_id = ? AND lifecycle = 'deleted'
        AND metadata_revision = ? AND location_revision = ?
    `,
    )
    .run(
      deleteEvidence.previousLifecycle,
      metadataRevision,
      locationRevision,
      now,
      block.id,
      request.projectId,
      block.metadata_revision,
      block.location_revision,
    );
  if (updatedBlock.changes !== 1) {
    throw new Error(`Card ${block.id} changed during restore`);
  }
  const restoreContentBlock = database.prepare(
    `
    UPDATE blocks
    SET lifecycle = 'active', metadata_revision = metadata_revision + 1,
        updated_at = ?
    WHERE id = ? AND project_id = ? AND lifecycle = 'deleted'
      AND metadata_revision = ?
  `,
  );
  const contentTransitions = deleteEvidence.tombstonedBlocks
    .filter((candidate) => candidate.id !== block.id)
    .map((contentBlock) => {
      const restored = restoreContentBlock.run(
        now,
        contentBlock.id,
        request.projectId,
        contentBlock.metadataRevision,
      );
      if (restored.changes !== 1) {
        throw new Error(
          `Indexed Block ${contentBlock.id} changed during Card restore`,
        );
      }
      return {
        id: contentBlock.id,
        expectedMetadataRevision: contentBlock.metadataRevision,
        committedMetadataRevision: contentBlock.metadataRevision + 1,
      };
    });
  if (topLevelRank) {
    database
      .prepare(
        `
      INSERT INTO top_level_block_placements (
        block_id, project_id, rank_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(block.id, request.projectId, topLevelRank.rankKey, now, now);
  }
  const membershipRevision = membership ? membership.revision + 1 : null;
  if (restoreMembership && membership && properties && viewRank) {
    const restoredMembership = database
      .prepare(
        `
        UPDATE database_memberships
        SET removed_at = NULL, revision = ?
        WHERE id = ? AND project_id = ? AND removed_at IS NOT NULL
          AND revision = ?
      `,
      )
      .run(
        membershipRevision,
        membership.id,
        request.projectId,
        membership.revision,
      );
    if (restoredMembership.changes !== 1) {
      throw new Error(
        `Membership ${membership.id} changed during Card restore`,
      );
    }
    database
      .prepare(
        `
        INSERT INTO database_view_positions (
          view_id, block_id, project_id, group_key, rank_key,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `,
      )
      .run(
        restoreMembership.operation.membership.viewId,
        block.id,
        request.projectId,
        restoreMembership.operation.membership.status,
        viewRank.rankKey,
        now,
        now,
      );
  }
  const commit = makeExistingCommit(database, request, {
    block: {
      ...block,
      lifecycle: deleteEvidence.previousLifecycle,
      metadata_revision: metadataRevision,
      location_revision: locationRevision,
    },
    document,
    membership:
      membership === null || membershipRevision === null
        ? null
        : { ...membership, revision: membershipRevision, removed_at: null },
    operation: "restore_card",
    expectedRevisions: {
      blockMetadata: block.metadata_revision,
      blockLocation: block.location_revision,
      ...(membership === null ? {} : { membership: membership.revision }),
    },
    committedRevisions: {
      blockMetadata: metadataRevision,
      blockLocation: locationRevision,
      ...(membershipRevision === null
        ? {}
        : { membership: membershipRevision, viewPosition: 1 }),
    },
    topLevelRankKey: topLevelRank?.rankKey ?? null,
    viewId: restoreMembership?.operation.membership.viewId ?? null,
    viewRankKey: viewRank?.rankKey ?? null,
    changePayload: {
      restoredMembershipId: membership?.id ?? null,
      deleteOperationId: request.operation.deleteOperationId,
      restoredLifecycle: deleteEvidence.previousLifecycle,
      status: restoreMembership?.operation.membership.status ?? null,
      rebalancedTopLevelPlacements: topLevelRank?.rebalanced ?? [],
      rebalancedViewPositions: viewRank?.rebalanced ?? 0,
    },
  });
  return withIndexedLifecycleEvidence(commit, {
    indexedBlockIds: deleteEvidence.tombstonedBlocks.map(
      (candidate) => candidate.id,
    ),
    indexedDocumentIds: deleteEvidence.indexedDocumentIds,
    transitions: contentTransitions,
    operation: "restore",
    payloadKey: "restoredBlockIds",
  });
};

const moveCardInSpace = (
  database: Database.Database,
  request: CardLifecycleMutationRequest & {
    readonly operation: Extract<
      CardLifecycleOperation,
      { readonly kind: "move_card_in_space" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const block = readBlock(database, request);
  if (
    block.lifecycle === "deleted" ||
    block.location_kind !== "space" ||
    block.containing_document_id !== null ||
    readPlacementRank(database, request) === null
  ) {
    return reject(
      "card_location_invalid",
      `Card ${block.id} is not a placed non-deleted Space Block`,
      request,
    );
  }
  requireRevision(
    request,
    request.operation.expectedLocationRevision,
    block.location_revision,
    "location",
  );
  const document = readOwnedDocument(database, request);
  const membership = readActiveMembership(database, request);
  const rank = allocateTopLevelRank(
    database,
    request,
    request.operation.beforeBlockId,
  );
  const locationRevision = block.location_revision + 1;
  database
    .prepare(
      `
      UPDATE top_level_block_placements
      SET rank_key = ?, updated_at = ?
      WHERE block_id = ? AND project_id = ?
    `,
    )
    .run(rank.rankKey, now, block.id, request.projectId);
  const updated = database
    .prepare(
      `
      UPDATE blocks
      SET location_revision = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND location_revision = ?
    `,
    )
    .run(
      locationRevision,
      now,
      block.id,
      request.projectId,
      block.location_revision,
    );
  if (updated.changes !== 1) {
    throw new Error(`Card ${block.id} changed during top-level move`);
  }
  return makeExistingCommit(database, request, {
    block: { ...block, location_revision: locationRevision },
    document,
    membership,
    operation: "move_card_in_space",
    expectedRevisions: { blockLocation: block.location_revision },
    committedRevisions: { blockLocation: locationRevision },
    topLevelRankKey: rank.rankKey,
    changePayload: { rebalancedTopLevelPlacements: rank.rebalanced },
  });
};

const executeAuthority = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  now: string,
  options: ApplyCardLifecycleMutationOptions,
): AuthorityCommit => {
  switch (request.operation.kind) {
    case "create_card":
      return createCard(
        database,
        request as CardLifecycleMutationRequest & {
          readonly operation: CreateCardBlockOperation;
        },
        now,
        options,
      );
    case "archive_card":
    case "unarchive_card":
      return lifecycleTransition(
        database,
        request as CardLifecycleMutationRequest & {
          readonly operation: Extract<
            CardLifecycleOperation,
            { readonly kind: "archive_card" | "unarchive_card" }
          >;
        },
        now,
      );
    case "delete_card":
      return deleteCard(
        database,
        request as CardLifecycleMutationRequest & {
          readonly operation: Extract<
            CardLifecycleOperation,
            { readonly kind: "delete_card" }
          >;
        },
        now,
      );
    case "restore_card":
      return restoreCard(
        database,
        request as CardLifecycleMutationRequest & {
          readonly operation: RestoreCardBlockOperation;
        },
        now,
      );
    case "move_card_in_space":
      return moveCardInSpace(
        database,
        request as CardLifecycleMutationRequest & {
          readonly operation: Extract<
            CardLifecycleOperation,
            { readonly kind: "move_card_in_space" }
          >;
        },
        now,
      );
  }
};

const logicalRequest = (
  request: CardLifecycleMutationRequest,
): Readonly<Record<string, unknown>> => ({
  version: CARD_LIFECYCLE_CONTRACT_VERSION,
  projectId: request.projectId,
  operation: request.operation,
});

const prepareOperation = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
) =>
  prepareAuthoritativeOperation(
    database,
    {
      operationId: request.operationId,
      projectId: request.projectId,
      mutationKind: MUTATION_KIND,
      logicalRequest: logicalRequest(request),
      actor: request.actor,
      clientSessionId: request.clientSessionId,
    },
    parseCardLifecycleMutationCommandResult,
  );

const validateReplay = (
  request: CardLifecycleMutationRequest,
  prepared: ReturnType<typeof prepareOperation>,
): CardLifecycleMutationCommandResult | null => {
  if (prepared.kind !== "replay") return null;
  if (!prepared.result.ok) {
    if (prepared.outcome === "rejected") return prepared.result;
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Card lifecycle operation ${request.operationId} stored a rejected committed result`,
    );
  }
  const receipt = prepared.result.value;
  if (
    prepared.outcome !== "committed" ||
    receipt.operationId !== request.operationId ||
    receipt.projectId !== request.projectId ||
    receipt.storeEpoch !== request.storeEpoch ||
    receipt.operationKind !== request.operation.kind ||
    receipt.cardId !== request.operation.cardId ||
    receipt.changeLogSeq !== prepared.changeLogSeq
  ) {
    throw new AuthoritativeOperationReceiptError(
      "operation_receipt_corrupt",
      `Card lifecycle operation ${request.operationId} stored a divergent receipt`,
    );
  }
  return { ok: true, value: { ...receipt, duplicate: true } };
};

const persistRejection = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  evidence: AuthoritativeOperationEvidence,
  error: CardLifecycleMutationCommandError,
  now: string,
): CardLifecycleMutationCommandResult => {
  const result: CardLifecycleMutationCommandResult = { ok: false, error };
  const targetExists = database
    .prepare("SELECT 1 FROM blocks WHERE id = ? AND project_id = ?")
    .get(request.operation.cardId, request.projectId);
  return persistAuthoritativeOperationRejection(database, {
    evidence,
    targetBlockIds: targetExists ? [request.operation.cardId] : [],
    fieldIntents: [
      {
        path: `blocks.${request.operation.cardId}.lifecycle`,
        operation: request.operation.kind,
      },
    ],
    rejectedAt: now,
    result,
  });
};

const refreshProjections = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  commit: AuthorityCommit,
  now: string,
): void => {
  refreshScheduledCardIndexProjection(
    database,
    request.projectId,
    [commit.cardId],
    now,
  );
  rebuildCardReadModelProjection(database, request.projectId, [commit.cardId]);
};

const makeReceipt = (
  request: CardLifecycleMutationRequest,
  commit: AuthorityCommit,
  changeLogSeq: number,
  now: string,
): CardLifecycleMutationCommandResult => ({
  ok: true,
  value: {
    version: CARD_LIFECYCLE_CONTRACT_VERSION,
    operationId: request.operationId,
    projectId: request.projectId,
    storeEpoch: request.storeEpoch,
    operationKind: request.operation.kind,
    cardId: commit.cardId,
    duplicate: false,
    metadataRevision: commit.metadataRevision,
    locationRevision: commit.locationRevision,
    lifecycle: commit.lifecycle,
    documentId: commit.documentId,
    documentGeneration: commit.documentGeneration,
    documentHeadSeq: commit.documentHeadSeq,
    databaseBlockId: commit.databaseBlockId,
    membershipId: commit.membershipId,
    viewId: commit.viewId,
    topLevelRankKey: commit.topLevelRankKey,
    viewRankKey: commit.viewRankKey,
    createdBlockIds: commit.createdBlockIds,
    changeLogSeq,
    committedAt: now,
  },
});

/**
 * Apply one Card-as-Block identity/lifecycle/Space-placement intent.
 *
 * The operation never writes the compatibility `cards` aggregate. Its Block,
 * owned Y.Doc, membership/properties/View position, projections, change cursor,
 * and immutable receipt share one immediate SQLite transaction.
 */
export const applyCardLifecycleMutation = (
  database: Database.Database,
  rawRequest: CardLifecycleMutationRequest,
  options: ApplyCardLifecycleMutationOptions = {},
): CardLifecycleMutationCommandResult => {
  let request: CardLifecycleMutationRequest;
  try {
    request = parseCardLifecycleMutationRequest(rawRequest);
  } catch (error) {
    if (!(error instanceof CardLifecycleContractError)) throw error;
    return {
      ok: false,
      error: makeError(
        "invalid_card_lifecycle_request",
        error.message,
        isLifecycleRequestIdentity(rawRequest) ? rawRequest : undefined,
      ),
    };
  }
  const inject = (point: CardLifecycleMutationFaultPoint): void => {
    options.faultInjector?.(point);
  };
  const apply = database.transaction((): CardLifecycleMutationCommandResult => {
    const currentEpoch = readBlockStoreEpoch(database);
    if (currentEpoch !== request.storeEpoch) {
      return {
        ok: false,
        error: makeError(
          "store_epoch_mismatch",
          `Operation belongs to store epoch ${request.storeEpoch}; current epoch is ${currentEpoch ?? "missing"}`,
          request,
        ),
      };
    }
    if (!projectExists(database, request.projectId)) {
      return {
        ok: false,
        error: makeError(
          "project_not_found",
          `Project does not exist: ${request.projectId}`,
          request,
        ),
      };
    }
    let prepared;
    try {
      prepared = prepareOperation(database, request);
    } catch (error) {
      if (error instanceof AuthoritativeOperationReceiptError) {
        return {
          ok: false,
          error: makeError(error.code, error.message, request),
        };
      }
      throw error;
    }
    const replay = validateReplay(request, prepared);
    if (replay) return replay;
    const now = options.now?.() ?? new Date().toISOString();
    let commit: AuthorityCommit;
    try {
      commit = database.transaction(() =>
        executeAuthority(database, request, now, options),
      )();
    } catch (error) {
      if (
        error instanceof BlockDocumentCodecError ||
        error instanceof BlockDocumentStoreError
      ) {
        return persistRejection(
          database,
          request,
          prepared.evidence,
          makeError("invalid_card_lifecycle_request", error.message, request),
          now,
        );
      }
      if (!(error instanceof CardLifecycleRejection)) throw error;
      const result = persistRejection(
        database,
        request,
        prepared.evidence,
        error.error,
        now,
      );
      inject("after_ledger");
      inject("before_commit");
      return result;
    }
    inject("after_authority");
    refreshProjections(database, request, commit, now);
    inject("after_projections");
    const persisted = persistAuthoritativeOperationReceipt(database, {
      evidence: prepared.evidence,
      targetBlockIds: commit.targetBlockIds,
      affectedDocumentIds: [commit.documentId],
      affectedDatabaseBlockIds: commit.affectedDatabaseBlockIds,
      fieldIntents: commit.fieldIntents,
      expectedRevisions: commit.expectedRevisions,
      committedRevisions: commit.committedRevisions,
      documentHeads: {
        [commit.documentId]: {
          generation: commit.documentGeneration,
          headSeq: commit.documentHeadSeq,
        },
      },
      changePayload: commit.changePayload,
      committedAt: now,
      makeResult: (changeLogSeq) =>
        makeReceipt(request, commit, changeLogSeq, now),
    });
    inject("after_change_log");
    inject("after_ledger");
    inject("before_commit");
    return persisted.result;
  });
  const result = apply.immediate();
  inject("after_commit");
  return result;
};

const isLifecycleRequestIdentity = (
  value: unknown,
): value is Pick<CardLifecycleMutationRequest, "operationId" | "operation"> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const request = value as {
    readonly operationId?: unknown;
    readonly operation?: unknown;
  };
  if (typeof request.operationId !== "string") return false;
  if (
    typeof request.operation !== "object" ||
    request.operation === null ||
    Array.isArray(request.operation)
  ) {
    return false;
  }
  return (
    typeof (request.operation as { readonly cardId?: unknown }).cardId ===
    "string"
  );
};

const readLifecycleChangeLogSeq = (
  database: Database.Database,
): number => {
  const row = database
    .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log")
    .get() as { readonly seq: number };
  return row.seq;
};

const readMembershipCoordinate = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  membership: MembershipRow | null,
): CardLifecycleMembershipCoordinate | null => {
  if (!membership) return null;
  const row = database
    .prepare(
      `
      SELECT
        view.id AS view_id, view.revision AS view_revision,
        property.id AS status_property_id,
        value.revision AS status_value_revision, value.value_json,
        position.group_key, position.rank_key,
        position.revision AS position_revision
      FROM database_views view
      INNER JOIN database_properties property
        ON property.database_block_id = view.database_block_id
       AND property.project_id = view.project_id
       AND property.key = 'status'
       AND property.lifecycle = 'active'
      INNER JOIN database_property_values value
        ON value.membership_id = ?
       AND value.database_block_id = view.database_block_id
       AND value.project_id = view.project_id
       AND value.property_id = property.id
      INNER JOIN database_view_positions position
        ON position.view_id = view.id
       AND position.project_id = view.project_id
       AND position.block_id = ?
      WHERE view.database_block_id = ? AND view.project_id = ?
        AND view.lifecycle = 'active' AND view.is_primary = 1
      LIMIT 1
    `,
    )
    .get(
      membership.id,
      request.operation.cardId,
      membership.database_block_id,
      request.projectId,
    ) as
    | {
        readonly view_id: string;
        readonly view_revision: number;
        readonly status_property_id: string;
        readonly status_value_revision: number;
        readonly value_json: string;
        readonly group_key: string | null;
        readonly rank_key: string;
        readonly position_revision: number;
      }
    | undefined;
  if (!row) {
    throw new Error(
      `Card ${request.operation.cardId} membership has no exact primary View/status coordinate`,
    );
  }
  const status = JSON.parse(row.value_json) as unknown;
  if (!isCardStatus(status) || row.group_key !== status) {
    throw new Error(
      `Card ${request.operation.cardId} membership status and primary View group diverge`,
    );
  }
  return {
    membershipId: membership.id,
    databaseBlockId: membership.database_block_id,
    membershipRevision: membership.revision,
    viewId: row.view_id,
    viewRevision: row.view_revision,
    statusPropertyId: row.status_property_id,
    statusValueRevision: row.status_value_revision,
    status,
    position: {
      groupKey: row.group_key,
      rankKey: row.rank_key,
      revision: row.position_revision,
    },
  };
};

const readLatestDeleteOperationId = (
  database: Database.Database,
  projectId: string,
  storeEpoch: string,
  cardId: string,
): string | null => {
  const row = database
    .prepare(
      `
      SELECT mutation_id
      FROM block_mutations
      WHERE project_id = ? AND store_epoch = ?
        AND mutation_kind = ? AND outcome = 'committed'
        AND json_extract(request_json, '$.operation.kind') = 'delete_card'
        AND json_extract(request_json, '$.operation.cardId') = ?
      ORDER BY change_log_seq DESC
      LIMIT 1
    `,
    )
    .get(projectId, storeEpoch, MUTATION_KIND, cardId) as
    | { readonly mutation_id: string }
    | undefined;
  return row?.mutation_id ?? null;
};

const readRestoreEvidence = (
  database: Database.Database,
  request: CardLifecycleMutationRequest,
  block: BlockRow,
  document: OwnedDocumentRow,
): CardLifecycleRestoreEvidence | null => {
  if (block.lifecycle !== "deleted") return null;
  const deleteOperationId = readLatestDeleteOperationId(
    database,
    request.projectId,
    request.storeEpoch,
    block.id,
  );
  if (!deleteOperationId) {
    throw new Error(`Deleted Card ${block.id} has no committed delete receipt`);
  }
  const evidenceRequest: CardLifecycleMutationRequest = {
    ...request,
    operationId: "internal:card-lifecycle-preflight",
    operation: {
      kind: "restore_card",
      cardId: block.id,
      deleteOperationId,
      expectedMetadataRevision: block.metadata_revision,
      expectedLocationRevision: block.location_revision,
      membership: null,
    },
  };
  const evidence = readDeleteEvidence(
    database,
    evidenceRequest as CardLifecycleMutationRequest & {
      readonly operation: RestoreCardBlockOperation;
    },
    block,
    document,
  );
  const membership =
    evidence.membershipId &&
    evidence.databaseBlockId &&
    evidence.viewId &&
    evidence.status
      ? {
          membershipId: evidence.membershipId,
          databaseBlockId: evidence.databaseBlockId,
          viewId: evidence.viewId,
          status: evidence.status,
        }
      : null;
  return {
    deleteOperationId,
    previousLifecycle: evidence.previousLifecycle,
    membership,
  };
};

const readOwnedCardAuthority = (
  database: Database.Database,
  projectId: string,
  storeEpoch: string,
  cardId: string,
): {
  readonly reservedBlockType: string | null;
  readonly card: CardLifecycleOwnedBlockAuthority | null;
} => {
  const identity = database
    .prepare(
      "SELECT type, project_id FROM blocks WHERE id = ? LIMIT 1",
    )
    .get(cardId) as
    | { readonly type: string; readonly project_id: string }
    | undefined;
  if (!identity) return { reservedBlockType: null, card: null };
  if (identity.type !== "card" || identity.project_id !== projectId) {
    return { reservedBlockType: identity.type, card: null };
  }
  const request: CardLifecycleMutationRequest = {
    version: CARD_LIFECYCLE_CONTRACT_VERSION,
    operationId: "internal:card-lifecycle-preflight",
    projectId,
    storeEpoch,
    actor: { kind: "internal_preflight" },
    operation: {
      kind: "archive_card",
      cardId,
      expectedMetadataRevision: 1,
    },
  };
  const block = readBlock(database, request);
  const document = readOwnedDocument(database, request);
  const membership = readActiveMembership(database, request);
  const membershipCoordinate = readMembershipCoordinate(
    database,
    request,
    membership,
  );
  const rankKey = readPlacementRank(database, request);
  if (
    (block.location_kind === "document" && !block.containing_document_id) ||
    (block.location_kind === "database" && !block.containing_database_id)
  ) {
    throw new Error(`Card ${cardId} has an invalid ${block.location_kind} location`);
  }
  return {
    reservedBlockType: null,
    card: {
      cardId,
      lifecycle: block.lifecycle,
      location:
        block.location_kind === "space"
          ? { kind: "space", rankKey }
          : block.location_kind === "document"
            ? {
              kind: "document",
              documentId: block.containing_document_id as string,
              }
            : {
                kind: "database",
                databaseBlockId: block.containing_database_id as string,
              },
      metadataRevision: block.metadata_revision,
      locationRevision: block.location_revision,
      document: {
        documentId: document.document_id,
        generation: document.generation,
        headSeq: document.head_seq,
        readiness: document.readiness,
        authority: document.authority,
        schemaKey: document.schema_key,
        schemaVersion: document.schema_version,
      },
      membership: membershipCoordinate,
      restoreEvidence: readRestoreEvidence(
        database,
        request,
        block,
        document,
      ),
    },
  };
};

const lifecycleReadFailure = (
  code:
    | "invalid_database_read_request"
    | "store_not_initialized"
    | "project_not_found"
    | "database_state_corrupt"
    | "unknown",
  message: string,
  retryable = false,
): CardLifecyclePreflightResult => ({
  ok: false,
  error: { code, message, retryable },
});

/** Read every lifecycle precondition from one SQLite transaction. */
export const readCardLifecyclePreflightSnapshot = (
  database: Database.Database,
  projectId: string,
  cardId: string,
): CardLifecyclePreflightResult => {
  if (
    !projectId ||
    projectId !== projectId.trim() ||
    !cardId ||
    cardId !== cardId.trim() ||
    projectId.length > 512 ||
    cardId.length > 512
  ) {
    return lifecycleReadFailure(
      "invalid_database_read_request",
      "Card lifecycle preflight requires canonical Project and Card identities",
    );
  }
  try {
    return database.transaction((): CardLifecyclePreflightResult => {
      const storeEpoch = readBlockStoreEpoch(database);
      if (!storeEpoch) {
        return lifecycleReadFailure(
          "store_not_initialized",
          "Block store metadata is missing",
          true,
        );
      }
      if (!projectExists(database, projectId)) {
        return lifecycleReadFailure(
          "project_not_found",
          `Project does not exist: ${projectId}`,
        );
      }
      const descriptor = readPrimaryGeneralDatabaseDescriptor(
        projectId,
        database,
      );
      const view = descriptor?.views.find(
        (candidate) =>
          candidate.lifecycle === "active" &&
          candidate.isPrimary &&
          candidate.kind === "kanban",
      );
      const query = view
        ? queryGeneralDatabaseView(projectId, view.id, database)
        : null;
      if (!descriptor || !view || !query) {
        return lifecycleReadFailure(
          "database_state_corrupt",
          "Project primary Database/View authority is incomplete",
        );
      }
      const authority = readOwnedCardAuthority(
        database,
        projectId,
        storeEpoch,
        cardId,
      );
      const value: CardLifecyclePreflight = {
        version: 1,
        primaryDatabase: { descriptor, query },
        reservedBlockType: authority.reservedBlockType,
        card: authority.card,
      };
      return {
        ok: true,
        value: {
          version: 1,
          projectId,
          storeEpoch,
          changeLogSeq: readLifecycleChangeLogSeq(database),
          value,
        },
      };
    })();
  } catch (error) {
    return lifecycleReadFailure(
      error instanceof CardLifecycleRejection
        ? "database_state_corrupt"
        : "unknown",
      error instanceof Error ? error.message : String(error),
      !(error instanceof CardLifecycleRejection),
    );
  }
};

export const verifyCardDocumentContinuity = (
  database: Database.Database,
  projectId: string,
  cardId: string,
): Readonly<{
  documentId: string;
  generation: number;
  headSeq: number;
  title: string;
}> | null => {
  const row = database
    .prepare(
      `
      SELECT
        document.id AS document_id,
        document.generation,
        document.head_seq,
        materialization.title
      FROM block_documents ownership
      INNER JOIN documents document
        ON document.id = ownership.document_id
       AND document.project_id = ownership.project_id
      INNER JOIN document_materializations materialization
        ON materialization.document_id = document.id
       AND materialization.generation = document.generation
       AND materialization.projected_seq = document.head_seq
       AND materialization.schema_version = document.schema_version
      WHERE ownership.block_id = ? AND ownership.project_id = ?
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
    `,
    )
    .get(cardId, projectId) as
    | {
        readonly document_id: string;
        readonly generation: number;
        readonly head_seq: number;
        readonly title: string;
      }
    | undefined;
  if (!row) return null;
  return {
    documentId: row.document_id,
    generation: row.generation,
    headSeq: row.head_seq,
    title: row.title,
  };
};
