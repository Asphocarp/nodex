import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  databaseMutationOperationPaths,
  canonicalizeDatabaseMutationIntent,
  normalizeDatabasePropertyValue,
  parseDatabaseMutationCommandError,
  parseDatabaseMutationReceipt,
  parseDatabaseMutationRequest,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabaseMutationCommandError,
  type DatabaseMutationCommandResult,
  type DatabaseMutationOperation,
  type DatabaseMutationReceipt,
  type DatabaseMutationRequest,
  type DatabasePropertyValueType,
  type DatabaseViewFilterClause,
  type DatabaseViewFilterNode,
  type GeneralDatabaseViewConfig,
} from "../../shared/database-kernel";
import { rebuildCardReadModelProjection } from "./card-read-store";
import {
  DatabaseFractionalRankError,
  planDatabaseFractionalRank,
  type DatabaseRankedItem,
} from "./database-fractional-rank";
import {
  GeneralDatabaseQueryError,
  queryGeneralDatabaseView,
  readCardContentSummary,
  readGeneralDatabaseDescriptor,
  readPrimaryGeneralDatabaseDescriptor,
} from "./database-query";
import {
  DATABASE_QUERY_CONTRACT_VERSION,
  type DatabaseReadCommandResult,
  type DatabaseReadSnapshot,
  type GeneralDatabaseDescriptor,
  type GeneralDatabaseViewQuery,
} from "../../shared/database-query";
import { refreshScheduledCardIndexProjection } from "./scheduled-card-store";

const MUTATION_KIND = "database_operation";
const CHANGE_KIND = "block_mutation";
const PRIMARY_COMPATIBILITY_PROPERTY_KEYS = [
  "status",
  "priority",
  "estimate",
  "tags",
  "due_date",
  "scheduled_start",
  "scheduled_end",
  "assignee",
] as const;

export type DatabaseMutationFaultPoint =
  | "after_authority"
  | "after_projections"
  | "after_change_log"
  | "after_ledger"
  | "before_commit"
  | "after_commit"
  | "bulk_after_validation"
  | "bulk_after_values"
  | "bulk_after_rank_plan"
  | "bulk_after_positions";

export interface ApplyDatabaseMutationOptions {
  readonly faultInjector?: (point: DatabaseMutationFaultPoint) => void;
  readonly now?: () => string;
}

interface StoreEpochRow {
  readonly store_epoch: string;
}

interface StoredMutationRow {
  readonly mutation_id: string;
  readonly project_id: string;
  readonly store_epoch: string;
  readonly mutation_kind: string;
  readonly request_hash: string;
  readonly request_json: string;
  readonly outcome: "committed" | "rejected";
  readonly result_json: string;
  readonly change_log_seq: number | null;
}

interface ActiveDatabaseRow {
  readonly block_id: string;
  readonly project_id: string;
  readonly schema_revision: number;
  readonly metadata_revision: number;
}

interface CardRow {
  readonly id: string;
  readonly type: string;
  readonly lifecycle: string;
  readonly metadata_revision: number;
}

interface PropertyRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly project_id: string;
  readonly key: string;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
  readonly rank_key: string;
  readonly lifecycle: "active" | "deleted";
  readonly schema_revision: number;
}

interface MembershipRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly card_block_id: string;
  readonly project_id: string;
  readonly revision: number;
  readonly created_at: string;
  readonly removed_at: string | null;
}

interface ViewRow {
  readonly id: string;
  readonly database_block_id: string;
  readonly project_id: string;
  readonly config_json: string;
  readonly is_primary: number;
  readonly revision: number;
  readonly rank_key: string;
  readonly lifecycle: "active" | "deleted";
}

interface PositionRow {
  readonly view_id: string;
  readonly block_id: string;
  readonly group_key: string | null;
  readonly rank_key: string;
  readonly revision: number;
}

interface PropertyValueRow {
  readonly membership_id: string;
  readonly property_id: string;
  readonly value_type: DatabasePropertyValueType;
  readonly value_json: string;
  readonly revision: number;
}

interface MutationEvidence {
  readonly canonicalRequest: string;
  readonly requestHash: string;
  readonly actorJson: string;
  readonly requestedTargetBlockIds: readonly string[];
  readonly requestedDatabaseBlockIds: readonly string[];
  readonly fieldIntentsJson: string;
  readonly expectedRevisionsJson: string;
}

interface AuthorityCommit {
  readonly payload: Readonly<Record<string, DatabaseJsonValue>>;
  readonly targetBlockIds: readonly string[];
  readonly databaseBlockIds: readonly string[];
  readonly committedRevisions: Readonly<Record<string, number>>;
  readonly projectionCardIds: readonly string[];
}

class DatabaseMutationRejection extends Error {
  constructor(readonly error: DatabaseMutationCommandError) {
    super(error.message);
    this.name = "DatabaseMutationRejection";
  }
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const makeError = (
  code: DatabaseMutationCommandError["code"],
  message: string,
  request?: Pick<DatabaseMutationRequest, "operationId">,
  details: Pick<
    DatabaseMutationCommandError,
    "expectedRevision" | "actualRevision"
  > = {},
): DatabaseMutationCommandError => ({
  code,
  message,
  retryable: false,
  ...(request ? { operationId: request.operationId } : {}),
  ...(details.expectedRevision === undefined
    ? {}
    : { expectedRevision: details.expectedRevision }),
  ...(details.actualRevision === undefined
    ? {}
    : { actualRevision: details.actualRevision }),
});

const reject = (
  code: DatabaseMutationCommandError["code"],
  message: string,
  request: DatabaseMutationRequest,
  details?: Pick<
    DatabaseMutationCommandError,
    "expectedRevision" | "actualRevision"
  >,
): never => {
  throw new DatabaseMutationRejection(
    makeError(code, message, request, details),
  );
};

const readStoreEpoch = (database: Database.Database): string | null =>
  (
    database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as StoreEpochRow | undefined
  )?.store_epoch ?? null;

const readStoredMutation = (
  database: Database.Database,
  operationId: string,
): StoredMutationRow | null =>
  (database
    .prepare(
      `
      SELECT
        mutation_id, project_id, store_epoch, mutation_kind,
        request_hash, request_json, outcome, result_json, change_log_seq
      FROM block_mutations
      WHERE mutation_id = ?
    `,
    )
    .get(operationId) as StoredMutationRow | undefined) ?? null;

const requestTargetBlockIds = (
  operation: DatabaseMutationOperation,
): readonly string[] => {
  switch (operation.kind) {
    case "create_database":
    case "put_property":
    case "delete_property":
    case "put_view":
    case "delete_view":
      return [operation.databaseBlockId];
    case "transfer_membership":
      return uniqueSorted([
        operation.cardBlockId,
        ...(operation.target ? [operation.target.databaseBlockId] : []),
      ]);
    case "position_card":
      return [operation.cardBlockId];
    case "position_cards":
      return uniqueSorted(operation.cards.map((entry) => entry.cardBlockId));
    case "set_value":
    case "add_remove_value":
      return uniqueSorted([operation.cardBlockId, operation.databaseBlockId]);
    case "set_values":
      return uniqueSorted([
        operation.databaseBlockId,
        ...operation.entries.map((entry) => entry.cardBlockId),
      ]);
  }
};

const requestDatabaseBlockIds = (
  operation: DatabaseMutationOperation,
): readonly string[] => {
  switch (operation.kind) {
    case "create_database":
    case "put_property":
    case "delete_property":
    case "put_view":
    case "delete_view":
    case "set_value":
    case "set_values":
    case "add_remove_value":
      return [operation.databaseBlockId];
    case "transfer_membership":
      return operation.target ? [operation.target.databaseBlockId] : [];
    case "position_card":
      return [];
    case "position_cards":
      return [];
  }
};

const expectedRevisions = (
  operation: DatabaseMutationOperation,
): Readonly<Record<string, number>> => {
  switch (operation.kind) {
    case "put_property":
    case "delete_property":
      return {
        databaseSchema: operation.expectedDatabaseSchemaRevision,
        property: operation.expectedPropertyRevision,
      };
    case "transfer_membership":
      return {
        membership: operation.expectedMembership?.revision ?? 0,
      };
    case "put_view":
    case "delete_view":
      return { view: operation.expectedRevision };
    case "position_card":
      return { position: operation.expectedPositionRevision };
    case "position_cards":
      return Object.fromEntries(
        operation.cards.map((entry, index) => [
          `positions[${index}]`,
          entry.expectedPositionRevision,
        ]),
      );
    case "set_value":
      return { value: operation.expectedValueRevision };
    case "set_values":
      return Object.fromEntries(
        operation.entries.map((entry, index) => [
          `values[${index}]`,
          entry.expectedValueRevision,
        ]),
      );
    case "create_database":
    case "add_remove_value":
      return {};
  }
};

const makeEvidence = (request: DatabaseMutationRequest): MutationEvidence => {
  const canonicalRequest = canonicalizeDatabaseMutationIntent(request);
  return {
    canonicalRequest,
    requestHash: sha256(canonicalRequest),
    actorJson: stableStringifyDatabaseJson(request.actor),
    requestedTargetBlockIds: uniqueSorted(
      request.operations.flatMap(requestTargetBlockIds),
    ),
    requestedDatabaseBlockIds: uniqueSorted(
      request.operations.flatMap(requestDatabaseBlockIds),
    ),
    fieldIntentsJson: stableStringifyDatabaseJson(
      request.operations.flatMap((operation) =>
        databaseMutationOperationPaths(operation).map((path) => ({
          path,
          operation: operation.kind,
        })),
      ),
    ),
    expectedRevisionsJson: stableStringifyDatabaseJson(
      Object.fromEntries(
        request.operations.flatMap((operation, index) =>
          Object.entries(expectedRevisions(operation)).map(([key, value]) => [
            `operations[${index}].${key}`,
            value,
          ]),
        ),
      ),
    ),
  };
};

const loadStoredOutcome = (
  row: StoredMutationRow,
  request: DatabaseMutationRequest,
  evidence: MutationEvidence,
): DatabaseMutationCommandResult => {
  if (
    row.project_id !== request.projectId ||
    row.store_epoch !== request.storeEpoch ||
    row.mutation_kind !== MUTATION_KIND ||
    row.request_hash !== evidence.requestHash ||
    row.request_json !== evidence.canonicalRequest
  ) {
    return {
      ok: false,
      error: makeError(
        "operation_id_collision",
        `Operation ID ${request.operationId} is already bound to another logical intent`,
        request,
      ),
    };
  }
  if (row.outcome === "rejected") {
    return {
      ok: false,
      error: parseDatabaseMutationCommandError(JSON.parse(row.result_json)),
    };
  }
  const receipt = parseDatabaseMutationReceipt(JSON.parse(row.result_json));
  return { ok: true, value: { ...receipt, duplicate: true } };
};

const readActiveDatabase = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  databaseBlockId: string,
): ActiveDatabaseRow => {
  const row = database
    .prepare(
      `
      SELECT
        capability.block_id, capability.project_id,
        capability.schema_revision, block.metadata_revision
      FROM database_capabilities capability
      INNER JOIN blocks block
        ON block.id = capability.block_id
       AND block.project_id = capability.project_id
       AND block.type = 'database'
      WHERE capability.block_id = ? AND capability.project_id = ?
      LIMIT 1
    `,
    )
    .get(databaseBlockId, request.projectId) as
    (ActiveDatabaseRow & { readonly lifecycle?: string }) | undefined;
  if (!row) {
    return reject(
      "database_not_found",
      `Database Block does not exist in Project ${request.projectId}: ${databaseBlockId}`,
      request,
    );
  }
  const lifecycle = database
    .prepare("SELECT lifecycle FROM blocks WHERE id = ? AND project_id = ?")
    .get(databaseBlockId, request.projectId) as
    { readonly lifecycle: string } | undefined;
  if (lifecycle?.lifecycle === "active") return row;
  return reject(
    "database_not_active",
    `Database Block is not active: ${databaseBlockId}`,
    request,
  );
};

const readCard = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  cardBlockId: string,
): CardRow => {
  const row = database
    .prepare(
      `
      SELECT id, type, lifecycle, metadata_revision
      FROM blocks WHERE id = ? AND project_id = ?
    `,
    )
    .get(cardBlockId, request.projectId) as CardRow | undefined;
  if (!row || row.type !== "card") {
    return reject(
      "card_not_found",
      `Card Block does not exist in Project ${request.projectId}: ${cardBlockId}`,
      request,
    );
  }
  if (row.lifecycle === "active") return row;
  return reject(
    "card_not_active",
    `Card Block is not active: ${cardBlockId}`,
    request,
  );
};

const readProperty = (
  database: Database.Database,
  propertyId: string,
): PropertyRow | null =>
  (database
    .prepare(
      `
      SELECT
        id, database_block_id, project_id, key, value_type, config_json,
        rank_key, lifecycle, schema_revision
      FROM database_properties WHERE id = ?
    `,
    )
    .get(propertyId) as PropertyRow | undefined) ?? null;

const readActiveMembership = (
  database: Database.Database,
  projectId: string,
  cardBlockId: string,
): MembershipRow | null =>
  (database
    .prepare(
      `
      SELECT
        id, database_block_id, card_block_id, project_id,
        revision, created_at, removed_at
      FROM database_memberships
      WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      LIMIT 1
    `,
    )
    .get(cardBlockId, projectId) as MembershipRow | undefined) ?? null;

const readView = (
  database: Database.Database,
  viewId: string,
): ViewRow | null =>
  (database
    .prepare(
      `
      SELECT
        id, database_block_id, project_id, config_json,
        is_primary, revision, rank_key, lifecycle
      FROM database_views WHERE id = ?
    `,
    )
    .get(viewId) as ViewRow | undefined) ?? null;

const readPosition = (
  database: Database.Database,
  viewId: string,
  cardBlockId: string,
): PositionRow | null =>
  (database
    .prepare(
      `
      SELECT view_id, block_id, group_key, rank_key, revision
      FROM database_view_positions WHERE view_id = ? AND block_id = ?
    `,
    )
    .get(viewId, cardBlockId) as PositionRow | undefined) ?? null;

const applyFractionalRankPlan = (input: {
  readonly request: DatabaseMutationRequest;
  readonly items: readonly DatabaseRankedItem[];
  readonly targetId: string;
  readonly beforeId?: string;
  readonly updateExisting: (id: string, rankKey: string) => void;
}): { readonly rankKey: string; readonly rebalanced: number } => {
  try {
    const plan = planDatabaseFractionalRank({
      items: input.items,
      targetId: input.targetId,
      ...(input.beforeId === undefined ? {} : { beforeId: input.beforeId }),
    });
    for (const [id, rankKey] of plan.rebalancedRankKeys) {
      input.updateExisting(id, rankKey);
    }
    return {
      rankKey: plan.rankKey,
      rebalanced: plan.rebalancedRankKeys.size,
    };
  } catch (error) {
    if (!(error instanceof DatabaseFractionalRankError)) throw error;
    if (error.code === "anchor_not_found") {
      return reject("position_anchor_not_found", error.message, input.request);
    }
    return reject("rank_rebalance_limit", error.message, input.request);
  }
};

const normalizePropertyValue = (
  request: DatabaseMutationRequest,
  property: Pick<PropertyRow, "id" | "value_type" | "config_json">,
  value: DatabaseJsonValue,
): DatabaseJsonValue => {
  const invalid = (detail: string): never =>
    reject(
      "property_value_invalid",
      `Property ${property.id} ${detail}`,
      request,
    );
  try {
    const rawConfig = JSON.parse(property.config_json) as unknown;
    const config = parseDatabasePropertyConfig(property.value_type, rawConfig);
    return normalizeDatabasePropertyValue(
      { valueType: property.value_type, config },
      value,
    );
  } catch (error) {
    return invalid((error as Error).message);
  }
};

const viewFilterClauses = (
  filter: DatabaseViewFilterNode,
): readonly DatabaseViewFilterClause[] => {
  if (filter.kind === "clause") return [filter];
  return filter.children.flatMap(viewFilterClauses);
};

const viewPropertyIds = (
  config: GeneralDatabaseViewConfig,
): readonly string[] =>
  uniqueSorted([
    ...viewFilterClauses(config.filter).map((clause) => clause.propertyId),
    ...config.sort.flatMap((sort) =>
      sort.field.kind === "property" ? [sort.field.propertyId] : [],
    ),
    ...(config.group ? [config.group.propertyId] : []),
    ...config.display.propertyIds,
  ]);

const validateViewConfig = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  databaseBlockId: string,
  config: GeneralDatabaseViewConfig,
): void => {
  const propertyIds = viewPropertyIds(config);
  if (propertyIds.length === 0) return;
  const placeholders = propertyIds.map(() => "?").join(", ");
  const properties = database
    .prepare(
      `
      SELECT
        id, database_block_id, project_id, key, value_type, config_json,
        rank_key, lifecycle, schema_revision
      FROM database_properties
      WHERE project_id = ? AND database_block_id = ?
        AND lifecycle = 'active' AND id IN (${placeholders})
    `,
    )
    .all(request.projectId, databaseBlockId, ...propertyIds) as PropertyRow[];
  if (properties.length !== propertyIds.length) {
    reject(
      "property_not_found",
      "Database View config references a property outside its active Database schema",
      request,
    );
  }
  const byId = new Map(properties.map((property) => [property.id, property]));
  for (const clause of viewFilterClauses(config.filter)) {
    const property = byId.get(clause.propertyId);
    if (!property) continue;
    if (
      clause.operator === "contains" &&
      property.value_type !== "text" &&
      property.value_type !== "multi_select"
    ) {
      reject(
        "property_value_invalid",
        `Filter contains is incompatible with ${property.value_type} property ${property.id}`,
        request,
      );
    }
    if (clause.operator === "contains" && clause.value !== undefined) {
      if (typeof clause.value !== "string") {
        reject(
          "property_value_invalid",
          `Filter contains requires a string operand for property ${property.id}`,
          request,
        );
      }
      normalizePropertyValue(
        request,
        property,
        property.value_type === "multi_select" ? [clause.value] : clause.value,
      );
      continue;
    }
    if (clause.value !== undefined) {
      normalizePropertyValue(request, property, clause.value);
    }
  }
};

const propertyIsReferencedByView = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  databaseBlockId: string,
  propertyId: string,
): boolean => {
  const rows = database
    .prepare(
      `
      SELECT config_json FROM database_views
      WHERE project_id = ? AND database_block_id = ? AND lifecycle = 'active'
    `,
    )
    .all(request.projectId, databaseBlockId) as Array<{
    readonly config_json: string;
  }>;
  return rows.some((row) => {
    try {
      return viewPropertyIds(
        parseGeneralDatabaseViewConfig(JSON.parse(row.config_json)),
      ).includes(propertyId);
    } catch {
      reject(
        "property_in_use",
        `Property ${propertyId} cannot be deleted while an active View has an unreadable schema`,
        request,
      );
    }
  });
};

const assertExistingValuesFitProperty = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  property: Pick<PropertyRow, "id" | "value_type" | "config_json">,
): void => {
  const rows = database
    .prepare(
      `
      SELECT value_json FROM database_property_values WHERE property_id = ?
    `,
    )
    .all(property.id) as Array<{ readonly value_json: string }>;
  for (const row of rows) {
    let value: DatabaseJsonValue;
    try {
      value = JSON.parse(row.value_json) as DatabaseJsonValue;
    } catch {
      throw new Error(`Property ${property.id} contains corrupt value JSON`);
    }
    try {
      normalizePropertyValue(request, property, value);
    } catch (error) {
      if (!(error instanceof DatabaseMutationRejection)) throw error;
      reject(
        "property_option_in_use",
        `Property ${property.id} schema would orphan an existing value`,
        request,
      );
    }
  }
};

const advanceBlockMetadata = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  blockIds: readonly string[],
  now: string,
): Readonly<Record<string, number>> => {
  const ids = uniqueSorted(blockIds);
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(", ");
  const update = database
    .prepare(
      `
      UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE project_id = ? AND id IN (${placeholders})
    `,
    )
    .run(now, request.projectId, ...ids);
  if (update.changes !== ids.length) {
    throw new Error("A Database mutation target disappeared during commit");
  }
  const rows = database
    .prepare(
      `SELECT id, metadata_revision FROM blocks
       WHERE project_id = ? AND id IN (${placeholders}) ORDER BY id`,
    )
    .all(request.projectId, ...ids) as Array<{
    readonly id: string;
    readonly metadata_revision: number;
  }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.metadata_revision]));
};

const refreshCardProjections = (
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
  now: string,
): void => {
  const ids = uniqueSorted(cardIds);
  if (ids.length === 0) return;
  refreshScheduledCardIndexProjection(database, projectId, ids, now);
  for (const cardId of ids) {
    const compatibilityCount = database
      .prepare(
        `
        SELECT COUNT(DISTINCT property.key) AS count
        FROM database_memberships membership
        INNER JOIN database_properties property
          ON property.database_block_id = membership.database_block_id
         AND property.project_id = membership.project_id
         AND property.lifecycle = 'active'
        WHERE membership.card_block_id = ?
          AND membership.project_id = ?
          AND membership.removed_at IS NULL
          AND property.key IN (${PRIMARY_COMPATIBILITY_PROPERTY_KEYS.map(() => "?").join(", ")})
      `,
      )
      .get(cardId, projectId, ...PRIMARY_COMPATIBILITY_PROPERTY_KEYS) as {
      readonly count: number;
    };
    if (
      compatibilityCount.count === PRIMARY_COMPATIBILITY_PROPERTY_KEYS.length
    ) {
      rebuildCardReadModelProjection(database, projectId, [cardId]);
      continue;
    }
    database
      .prepare(
        "DELETE FROM card_read_model WHERE card_block_id = ? AND project_id = ?",
      )
      .run(cardId, projectId);
  }
};

const createDatabase = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "create_database" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  const blockCollision = database
    .prepare("SELECT 1 AS present FROM blocks WHERE id = ?")
    .get(operation.databaseBlockId);
  if (blockCollision) {
    reject(
      "block_identity_collision",
      `Block identity is already reserved: ${operation.databaseBlockId}`,
      request,
    );
  }
  const viewCollision = readView(database, operation.initialView.viewId);
  if (viewCollision) {
    reject(
      "view_identity_collision",
      `Database View identity is already reserved: ${operation.initialView.viewId}`,
      request,
    );
  }
  if (operation.isPrimary) {
    const primary = database
      .prepare(
        "SELECT block_id FROM database_capabilities WHERE project_id = ? AND is_primary = 1",
      )
      .get(request.projectId) as { readonly block_id: string } | undefined;
    if (primary) {
      reject(
        "database_schema_conflict",
        `Project ${request.projectId} already has primary Database ${primary.block_id}`,
        request,
      );
    }
  }
  validateViewConfig(
    database,
    request,
    operation.databaseBlockId,
    operation.initialView.config,
  );

  const placementItems = database
    .prepare(
      `
      SELECT placement.block_id AS id, placement.rank_key AS rankKey
      FROM top_level_block_placements placement
      INNER JOIN blocks block
        ON block.id = placement.block_id
       AND block.project_id = placement.project_id
       AND block.lifecycle <> 'deleted'
      WHERE placement.project_id = ?
      ORDER BY placement.rank_key, placement.block_id
    `,
    )
    .all(request.projectId) as DatabaseRankedItem[];
  const placementRank = applyFractionalRankPlan({
    request,
    items: placementItems,
    targetId: operation.databaseBlockId,
    ...(operation.beforeBlockId === undefined
      ? {}
      : { beforeId: operation.beforeBlockId }),
    updateExisting: (id, rankKey) => {
      database
        .prepare(
          `UPDATE top_level_block_placements SET rank_key = ? WHERE block_id = ? AND project_id = ?`,
        )
        .run(rankKey, id, request.projectId);
    },
  });
  const viewRank = applyFractionalRankPlan({
    request,
    items: [],
    targetId: operation.initialView.viewId,
    updateExisting: () => undefined,
  });

  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'database', 'active', 'space', NULL, 1, 1, ?, ?)
    `,
    )
    .run(operation.databaseBlockId, request.projectId, now, now);
  database
    .prepare(
      `
      INSERT INTO top_level_block_placements (
        block_id, project_id, rank_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      operation.databaseBlockId,
      request.projectId,
      placementRank.rankKey,
      now,
      now,
    );
  database
    .prepare(
      `
      INSERT INTO database_capabilities (
        block_id, project_id, is_primary, schema_key, name,
        schema_revision, created_at, updated_at
      ) VALUES (?, ?, ?, 'nodex.database', ?, 1, ?, ?)
    `,
    )
    .run(
      operation.databaseBlockId,
      request.projectId,
      operation.isPrimary ? 1 : 0,
      operation.name,
      now,
      now,
    );
  database
    .prepare(
      `
      INSERT INTO database_views (
        id, database_block_id, project_id, name, kind, config_json,
        is_primary, revision, rank_key, lifecycle, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 'active', ?, ?)
    `,
    )
    .run(
      operation.initialView.viewId,
      operation.databaseBlockId,
      request.projectId,
      operation.initialView.name,
      operation.initialView.viewKind,
      stableStringifyDatabaseJson(operation.initialView.config),
      viewRank.rankKey,
      now,
      now,
    );

  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      databaseSchemaRevision: 1,
      databaseMetadataRevision: 1,
      placementRankKey: placementRank.rankKey,
      initialViewId: operation.initialView.viewId,
      initialViewRevision: 1,
      initialViewRankKey: viewRank.rankKey,
      rebalancedPlacements: placementRank.rebalanced,
    },
    targetBlockIds: [operation.databaseBlockId],
    databaseBlockIds: [operation.databaseBlockId],
    committedRevisions: {
      databaseSchema: 1,
      databaseMetadata: 1,
      initialView: 1,
    },
    projectionCardIds: [],
  };
};

const putProperty = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "put_property" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  const owner = readActiveDatabase(
    database,
    request,
    operation.databaseBlockId,
  );
  if (owner.schema_revision !== operation.expectedDatabaseSchemaRevision) {
    reject(
      "database_schema_conflict",
      `Database schema revision changed for ${operation.databaseBlockId}`,
      request,
      {
        expectedRevision: operation.expectedDatabaseSchemaRevision,
        actualRevision: owner.schema_revision,
      },
    );
  }
  const existing = readProperty(database, operation.propertyId);
  if (operation.expectedPropertyRevision === 0) {
    if (existing) {
      reject(
        "property_conflict",
        `Property identity is already reserved: ${operation.propertyId}`,
        request,
        { expectedRevision: 0, actualRevision: existing.schema_revision },
      );
    }
  } else if (
    !existing ||
    existing.database_block_id !== operation.databaseBlockId ||
    existing.project_id !== request.projectId ||
    existing.lifecycle !== "active"
  ) {
    reject(
      "property_not_found",
      `Active property does not belong to Database ${operation.databaseBlockId}: ${operation.propertyId}`,
      request,
    );
  } else if (existing.schema_revision !== operation.expectedPropertyRevision) {
    reject(
      "property_conflict",
      `Property revision changed for ${operation.propertyId}`,
      request,
      {
        expectedRevision: operation.expectedPropertyRevision,
        actualRevision: existing.schema_revision,
      },
    );
  }
  const keyOwner = database
    .prepare(
      `
      SELECT id FROM database_properties
      WHERE database_block_id = ? AND project_id = ?
        AND key = ? AND lifecycle = 'active' AND id <> ?
      LIMIT 1
    `,
    )
    .get(
      operation.databaseBlockId,
      request.projectId,
      operation.key,
      operation.propertyId,
    ) as { readonly id: string } | undefined;
  if (keyOwner) {
    reject(
      "property_key_collision",
      `Property key ${operation.key} is already owned by ${keyOwner.id}`,
      request,
    );
  }
  const valueCount = existing
    ? (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM database_property_values WHERE property_id = ?",
          )
          .get(existing.id) as { readonly count: number }
      ).count
    : 0;
  if (
    existing &&
    existing.value_type !== operation.valueType &&
    valueCount > 0
  ) {
    reject(
      "property_type_change_with_values",
      `Property ${operation.propertyId} cannot change type while values exist`,
      request,
    );
  }
  const candidate: PropertyRow = {
    id: operation.propertyId,
    database_block_id: operation.databaseBlockId,
    project_id: request.projectId,
    key: operation.key,
    value_type: operation.valueType,
    config_json: stableStringifyDatabaseJson(operation.config),
    rank_key: existing?.rank_key ?? "",
    lifecycle: "active",
    schema_revision: existing?.schema_revision ?? 0,
  };
  if (existing && valueCount > 0) {
    assertExistingValuesFitProperty(database, request, candidate);
  }

  const rankedItems = database
    .prepare(
      `
      SELECT id, rank_key AS rankKey FROM database_properties
      WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
      ORDER BY rank_key, id
    `,
    )
    .all(operation.databaseBlockId, request.projectId) as DatabaseRankedItem[];
  const rank = applyFractionalRankPlan({
    request,
    items: rankedItems,
    targetId: operation.propertyId,
    ...(operation.beforePropertyId === undefined
      ? {}
      : { beforeId: operation.beforePropertyId }),
    updateExisting: (id, rankKey) => {
      database
        .prepare("UPDATE database_properties SET rank_key = ? WHERE id = ?")
        .run(rankKey, id);
    },
  });
  const propertyRevision = (existing?.schema_revision ?? 0) + 1;
  if (!existing) {
    database
      .prepare(
        `
        INSERT INTO database_properties (
          id, database_block_id, project_id, key, name, value_type,
          config_json, rank_key, lifecycle, schema_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
      `,
      )
      .run(
        operation.propertyId,
        operation.databaseBlockId,
        request.projectId,
        operation.key,
        operation.name,
        operation.valueType,
        candidate.config_json,
        rank.rankKey,
        now,
        now,
      );
  } else {
    database
      .prepare(
        `
        UPDATE database_properties
        SET key = ?, name = ?, value_type = ?, config_json = ?,
            rank_key = ?, schema_revision = schema_revision + 1, updated_at = ?
        WHERE id = ? AND database_block_id = ? AND project_id = ?
          AND lifecycle = 'active'
      `,
      )
      .run(
        operation.key,
        operation.name,
        operation.valueType,
        candidate.config_json,
        rank.rankKey,
        now,
        operation.propertyId,
        operation.databaseBlockId,
        request.projectId,
      );
  }
  const capabilityUpdate = database
    .prepare(
      `
      UPDATE database_capabilities
      SET schema_revision = schema_revision + 1, updated_at = ?
      WHERE block_id = ? AND project_id = ? AND schema_revision = ?
    `,
    )
    .run(
      now,
      operation.databaseBlockId,
      request.projectId,
      operation.expectedDatabaseSchemaRevision,
    );
  if (capabilityUpdate.changes !== 1) {
    throw new Error("Database schema revision changed during property commit");
  }
  const metadata = advanceBlockMetadata(
    database,
    request,
    [operation.databaseBlockId],
    now,
  );
  const schemaRevision = operation.expectedDatabaseSchemaRevision + 1;
  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      databaseSchemaRevision: schemaRevision,
      propertyId: operation.propertyId,
      propertyRevision,
      propertyRankKey: rank.rankKey,
      rebalancedProperties: rank.rebalanced,
    },
    targetBlockIds: [operation.databaseBlockId],
    databaseBlockIds: [operation.databaseBlockId],
    committedRevisions: {
      databaseSchema: schemaRevision,
      databaseMetadata: metadata[operation.databaseBlockId] ?? 0,
      property: propertyRevision,
    },
    projectionCardIds: [],
  };
};

const deleteProperty = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "delete_property" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  const owner = readActiveDatabase(
    database,
    request,
    operation.databaseBlockId,
  );
  if (owner.schema_revision !== operation.expectedDatabaseSchemaRevision) {
    reject(
      "database_schema_conflict",
      `Database schema revision changed for ${operation.databaseBlockId}`,
      request,
      {
        expectedRevision: operation.expectedDatabaseSchemaRevision,
        actualRevision: owner.schema_revision,
      },
    );
  }
  const property = readProperty(database, operation.propertyId);
  if (
    !property ||
    property.database_block_id !== operation.databaseBlockId ||
    property.project_id !== request.projectId ||
    property.lifecycle !== "active"
  ) {
    return reject(
      "property_not_found",
      `Active property not found: ${operation.propertyId}`,
      request,
    );
  }
  if (property.schema_revision !== operation.expectedPropertyRevision) {
    reject(
      "property_conflict",
      `Property revision changed for ${operation.propertyId}`,
      request,
      {
        expectedRevision: operation.expectedPropertyRevision,
        actualRevision: property.schema_revision,
      },
    );
  }
  if (
    propertyIsReferencedByView(
      database,
      request,
      operation.databaseBlockId,
      operation.propertyId,
    )
  ) {
    reject(
      "property_in_use",
      `Property ${operation.propertyId} is referenced by an active Database View`,
      request,
    );
  }
  database
    .prepare(
      `
      UPDATE database_properties
      SET lifecycle = 'deleted', schema_revision = schema_revision + 1, updated_at = ?
      WHERE id = ? AND database_block_id = ? AND project_id = ?
        AND lifecycle = 'active' AND schema_revision = ?
    `,
    )
    .run(
      now,
      operation.propertyId,
      operation.databaseBlockId,
      request.projectId,
      operation.expectedPropertyRevision,
    );
  database
    .prepare(
      `
      UPDATE database_capabilities
      SET schema_revision = schema_revision + 1, updated_at = ?
      WHERE block_id = ? AND project_id = ? AND schema_revision = ?
    `,
    )
    .run(
      now,
      operation.databaseBlockId,
      request.projectId,
      operation.expectedDatabaseSchemaRevision,
    );
  const metadata = advanceBlockMetadata(
    database,
    request,
    [operation.databaseBlockId],
    now,
  );
  const schemaRevision = operation.expectedDatabaseSchemaRevision + 1;
  const propertyRevision = operation.expectedPropertyRevision + 1;
  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      databaseSchemaRevision: schemaRevision,
      propertyId: operation.propertyId,
      propertyRevision,
      lifecycle: "deleted",
    },
    targetBlockIds: [operation.databaseBlockId],
    databaseBlockIds: [operation.databaseBlockId],
    committedRevisions: {
      databaseSchema: schemaRevision,
      databaseMetadata: metadata[operation.databaseBlockId] ?? 0,
      property: propertyRevision,
    },
    projectionCardIds: [],
  };
};

const allocateViewPositionRank = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  input: {
    readonly viewId: string;
    readonly cardBlockId: string;
    readonly groupKey: string | null;
    readonly beforeCardBlockId?: string;
  },
): { readonly rankKey: string; readonly rebalanced: number } => {
  if (input.beforeCardBlockId !== undefined) {
    const anchor = readPosition(
      database,
      input.viewId,
      input.beforeCardBlockId,
    );
    if (!anchor) {
      return reject(
        "position_anchor_not_found",
        `View position anchor does not exist: ${input.beforeCardBlockId}`,
        request,
      );
    }
    if (anchor.group_key !== input.groupKey) {
      reject(
        "position_anchor_group_mismatch",
        `View position anchor ${input.beforeCardBlockId} belongs to another group`,
        request,
      );
    }
  }
  const items = database
    .prepare(
      `
      SELECT block_id AS id, rank_key AS rankKey
      FROM database_view_positions
      WHERE view_id = ? AND group_key IS ?
      ORDER BY rank_key, block_id
    `,
    )
    .all(input.viewId, input.groupKey) as DatabaseRankedItem[];
  return applyFractionalRankPlan({
    request,
    items,
    targetId: input.cardBlockId,
    ...(input.beforeCardBlockId === undefined
      ? {}
      : { beforeId: input.beforeCardBlockId }),
    updateExisting: (id, rankKey) => {
      database
        .prepare(
          `UPDATE database_view_positions SET rank_key = ? WHERE view_id = ? AND block_id = ?`,
        )
        .run(rankKey, input.viewId, id);
    },
  });
};

const groupedValueKey = (
  value: DatabaseJsonValue | undefined,
): string | null => {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return null;
  }
  if (typeof value === "string") return value;
  return stableStringifyDatabaseJson(value);
};

const validatePositionGroup = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  view: ViewRow,
  membershipId: string | null,
  requestedGroupKey: string | null,
): void => {
  let config: GeneralDatabaseViewConfig;
  try {
    config = parseGeneralDatabaseViewConfig(JSON.parse(view.config_json));
  } catch {
    // Legacy Views own their explicit group keys. New strict Views derive the
    // group from the configured property and are checked below.
    return;
  }
  if (config.group === null) return;
  let value: DatabaseJsonValue | undefined;
  if (membershipId !== null) {
    const row = database
      .prepare(
        `
        SELECT value_json FROM database_property_values
        WHERE membership_id = ? AND property_id = ?
      `,
      )
      .get(membershipId, config.group.propertyId) as
      { readonly value_json: string } | undefined;
    if (row) value = JSON.parse(row.value_json) as DatabaseJsonValue;
  }
  const actualGroupKey = groupedValueKey(value);
  if (actualGroupKey === requestedGroupKey) return;
  reject(
    "position_group_mismatch",
    `View ${view.id} derives group ${String(actualGroupKey)} from property ${config.group.propertyId}; the requested group was ${String(requestedGroupKey)}`,
    request,
  );
};

const transferMembership = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "transfer_membership" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  readCard(database, request, operation.cardBlockId);
  const current = readActiveMembership(
    database,
    request.projectId,
    operation.cardBlockId,
  );
  const expected = operation.expectedMembership;
  if (
    (current === null) !== (expected === null) ||
    (current &&
      expected &&
      (current.id !== expected.membershipId ||
        current.revision !== expected.revision))
  ) {
    reject(
      "membership_conflict",
      `Active membership changed for Card ${operation.cardBlockId}`,
      request,
      {
        expectedRevision: expected?.revision ?? 0,
        actualRevision: current?.revision ?? 0,
      },
    );
  }
  if (current?.database_block_id === operation.target?.databaseBlockId) {
    reject(
      "membership_unchanged",
      `Card ${operation.cardBlockId} already belongs to Database ${current?.database_block_id ?? "unknown"}; use a View position operation to reorder it`,
      request,
    );
  }
  if (!current && !operation.target) {
    reject(
      "membership_unchanged",
      `Card ${operation.cardBlockId} already has zero Database memberships`,
      request,
    );
  }

  let targetView: ViewRow | null = null;
  if (operation.target) {
    readActiveDatabase(database, request, operation.target.databaseBlockId);
    const identityCollision = database
      .prepare("SELECT 1 AS present FROM database_memberships WHERE id = ?")
      .get(operation.target.membershipId);
    if (identityCollision) {
      reject(
        "membership_identity_collision",
        `Membership identity is already reserved: ${operation.target.membershipId}`,
        request,
      );
    }
    targetView = readView(database, operation.target.viewId);
    if (
      !targetView ||
      targetView.project_id !== request.projectId ||
      targetView.database_block_id !== operation.target.databaseBlockId ||
      targetView.lifecycle !== "active"
    ) {
      return reject(
        "view_not_found",
        `Target View is not active in Database ${operation.target.databaseBlockId}: ${operation.target.viewId}`,
        request,
      );
    }
    validatePositionGroup(
      database,
      request,
      targetView,
      null,
      operation.target.groupKey,
    );
  }

  let targetRank: {
    readonly rankKey: string;
    readonly rebalanced: number;
  } | null = null;
  if (operation.target) {
    targetRank = allocateViewPositionRank(database, request, {
      viewId: operation.target.viewId,
      cardBlockId: operation.cardBlockId,
      groupKey: operation.target.groupKey,
      ...(operation.target.beforeCardBlockId === undefined
        ? {}
        : { beforeCardBlockId: operation.target.beforeCardBlockId }),
    });
  }

  const affectedDatabases: string[] = [];
  if (current) {
    affectedDatabases.push(current.database_block_id);
    database
      .prepare(
        `
        DELETE FROM database_view_positions
        WHERE block_id = ? AND project_id = ? AND view_id IN (
          SELECT id FROM database_views
          WHERE database_block_id = ? AND project_id = ?
        )
      `,
      )
      .run(
        operation.cardBlockId,
        request.projectId,
        current.database_block_id,
        request.projectId,
      );
    const removed = database
      .prepare(
        `
        UPDATE database_memberships
        SET removed_at = ?, revision = revision + 1
        WHERE id = ? AND project_id = ? AND removed_at IS NULL AND revision = ?
      `,
      )
      .run(now, current.id, request.projectId, current.revision);
    if (removed.changes !== 1) {
      throw new Error("Membership changed during atomic transfer");
    }
  }
  if (operation.target && targetRank && targetView) {
    affectedDatabases.push(operation.target.databaseBlockId);
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
        operation.target.membershipId,
        operation.target.databaseBlockId,
        operation.cardBlockId,
        request.projectId,
        now,
      );
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
        operation.target.viewId,
        operation.cardBlockId,
        request.projectId,
        operation.target.groupKey,
        targetRank.rankKey,
        now,
        now,
      );
  }
  const metadata = advanceBlockMetadata(
    database,
    request,
    [operation.cardBlockId],
    now,
  );
  return {
    payload: {
      cardBlockId: operation.cardBlockId,
      previousMembershipId: current?.id ?? null,
      previousMembershipRevision: current ? current.revision + 1 : null,
      membershipId: operation.target?.membershipId ?? null,
      membershipRevision: operation.target ? 1 : null,
      databaseBlockId: operation.target?.databaseBlockId ?? null,
      viewId: operation.target?.viewId ?? null,
      positionRankKey: targetRank?.rankKey ?? null,
      positionRevision: operation.target ? 1 : null,
      rebalancedPositions: targetRank?.rebalanced ?? 0,
      cardMetadataRevision: metadata[operation.cardBlockId] ?? 0,
    },
    targetBlockIds: uniqueSorted([operation.cardBlockId, ...affectedDatabases]),
    databaseBlockIds: uniqueSorted(affectedDatabases),
    committedRevisions: {
      cardMetadata: metadata[operation.cardBlockId] ?? 0,
      membership: operation.target ? 1 : current ? current.revision + 1 : 0,
      position: operation.target ? 1 : 0,
    },
    projectionCardIds: [operation.cardBlockId],
  };
};

const putView = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "put_view" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  readActiveDatabase(database, request, operation.databaseBlockId);
  validateViewConfig(
    database,
    request,
    operation.databaseBlockId,
    operation.config,
  );
  const existing = readView(database, operation.viewId);
  if (operation.expectedRevision === 0) {
    if (existing) {
      reject(
        "view_identity_collision",
        `Database View identity is already reserved: ${operation.viewId}`,
        request,
      );
    }
  } else if (
    !existing ||
    existing.project_id !== request.projectId ||
    existing.database_block_id !== operation.databaseBlockId ||
    existing.lifecycle !== "active"
  ) {
    return reject(
      "view_not_found",
      `Active Database View not found: ${operation.viewId}`,
      request,
    );
  } else if (existing.revision !== operation.expectedRevision) {
    reject(
      "view_conflict",
      `Database View revision changed for ${operation.viewId}`,
      request,
      {
        expectedRevision: operation.expectedRevision,
        actualRevision: existing.revision,
      },
    );
  }
  const currentPrimary = database
    .prepare(
      `
      SELECT id, revision FROM database_views
      WHERE database_block_id = ? AND project_id = ?
        AND lifecycle = 'active' AND is_primary = 1 AND id <> ?
      LIMIT 1
    `,
    )
    .get(operation.databaseBlockId, request.projectId, operation.viewId) as
    { readonly id: string; readonly revision: number } | undefined;
  if (!operation.isPrimary && existing?.is_primary === 1 && !currentPrimary) {
    reject(
      "primary_view_required",
      `Database ${operation.databaseBlockId} must retain one primary View`,
      request,
    );
  }

  const items = database
    .prepare(
      `
      SELECT id, rank_key AS rankKey FROM database_views
      WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
      ORDER BY rank_key, id
    `,
    )
    .all(operation.databaseBlockId, request.projectId) as DatabaseRankedItem[];
  const rank = applyFractionalRankPlan({
    request,
    items,
    targetId: operation.viewId,
    ...(operation.beforeViewId === undefined
      ? {}
      : { beforeId: operation.beforeViewId }),
    updateExisting: (id, rankKey) => {
      database
        .prepare("UPDATE database_views SET rank_key = ? WHERE id = ?")
        .run(rankKey, id);
    },
  });
  if (operation.isPrimary && currentPrimary) {
    database
      .prepare(
        `
        UPDATE database_views
        SET is_primary = 0, revision = revision + 1, updated_at = ?
        WHERE id = ? AND project_id = ? AND lifecycle = 'active'
      `,
      )
      .run(now, currentPrimary.id, request.projectId);
  }
  const revision = (existing?.revision ?? 0) + 1;
  if (!existing) {
    database
      .prepare(
        `
        INSERT INTO database_views (
          id, database_block_id, project_id, name, kind, config_json,
          is_primary, revision, rank_key, lifecycle, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'active', ?, ?)
      `,
      )
      .run(
        operation.viewId,
        operation.databaseBlockId,
        request.projectId,
        operation.name,
        operation.viewKind,
        stableStringifyDatabaseJson(operation.config),
        operation.isPrimary ? 1 : 0,
        rank.rankKey,
        now,
        now,
      );
  } else {
    database
      .prepare(
        `
        UPDATE database_views
        SET name = ?, kind = ?, config_json = ?, is_primary = ?,
            rank_key = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND database_block_id = ? AND project_id = ?
          AND lifecycle = 'active' AND revision = ?
      `,
      )
      .run(
        operation.name,
        operation.viewKind,
        stableStringifyDatabaseJson(operation.config),
        operation.isPrimary ? 1 : 0,
        rank.rankKey,
        now,
        operation.viewId,
        operation.databaseBlockId,
        request.projectId,
        operation.expectedRevision,
      );
  }
  const metadata = advanceBlockMetadata(
    database,
    request,
    [operation.databaseBlockId],
    now,
  );
  const demotedViewRevision =
    operation.isPrimary && currentPrimary ? currentPrimary.revision + 1 : null;
  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      viewId: operation.viewId,
      viewRevision: revision,
      viewRankKey: rank.rankKey,
      isPrimary: operation.isPrimary,
      demotedViewId: operation.isPrimary ? (currentPrimary?.id ?? null) : null,
      demotedViewRevision: operation.isPrimary ? demotedViewRevision : null,
      rebalancedViews: rank.rebalanced,
      databaseMetadataRevision: metadata[operation.databaseBlockId] ?? 0,
    },
    targetBlockIds: [operation.databaseBlockId],
    databaseBlockIds: [operation.databaseBlockId],
    committedRevisions: {
      view: revision,
      ...(demotedViewRevision === null
        ? {}
        : { demotedView: demotedViewRevision }),
      databaseMetadata: metadata[operation.databaseBlockId] ?? 0,
    },
    projectionCardIds: [],
  };
};

const deleteView = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "delete_view" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  readActiveDatabase(database, request, operation.databaseBlockId);
  const view = readView(database, operation.viewId);
  if (
    !view ||
    view.project_id !== request.projectId ||
    view.database_block_id !== operation.databaseBlockId ||
    view.lifecycle !== "active"
  ) {
    return reject(
      "view_not_found",
      `Active Database View not found: ${operation.viewId}`,
      request,
    );
  }
  if (view.revision !== operation.expectedRevision) {
    reject(
      "view_conflict",
      `Database View revision changed for ${operation.viewId}`,
      request,
      {
        expectedRevision: operation.expectedRevision,
        actualRevision: view.revision,
      },
    );
  }
  if (view.is_primary === 1) {
    reject(
      "primary_view_required",
      `Promote another primary View before deleting ${operation.viewId}`,
      request,
    );
  }
  const activeCount = database
    .prepare(
      `
      SELECT COUNT(*) AS count FROM database_views
      WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
    `,
    )
    .get(operation.databaseBlockId, request.projectId) as {
    readonly count: number;
  };
  if (activeCount.count <= 1) {
    reject(
      "primary_view_required",
      `Database ${operation.databaseBlockId} must retain at least one durable View`,
      request,
    );
  }
  database
    .prepare(
      `
      UPDATE database_views
      SET lifecycle = 'deleted', is_primary = 0,
          revision = revision + 1, updated_at = ?
      WHERE id = ? AND database_block_id = ? AND project_id = ?
        AND lifecycle = 'active' AND revision = ?
    `,
    )
    .run(
      now,
      operation.viewId,
      operation.databaseBlockId,
      request.projectId,
      operation.expectedRevision,
    );
  const metadata = advanceBlockMetadata(
    database,
    request,
    [operation.databaseBlockId],
    now,
  );
  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      viewId: operation.viewId,
      viewRevision: operation.expectedRevision + 1,
      lifecycle: "deleted",
      databaseMetadataRevision: metadata[operation.databaseBlockId] ?? 0,
    },
    targetBlockIds: [operation.databaseBlockId],
    databaseBlockIds: [operation.databaseBlockId],
    committedRevisions: {
      view: operation.expectedRevision + 1,
      databaseMetadata: metadata[operation.databaseBlockId] ?? 0,
    },
    projectionCardIds: [],
  };
};

const positionCard = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "position_card" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  readCard(database, request, operation.cardBlockId);
  const view = readView(database, operation.viewId);
  if (
    !view ||
    view.project_id !== request.projectId ||
    view.lifecycle !== "active"
  ) {
    return reject(
      "view_not_found",
      `Active Database View not found: ${operation.viewId}`,
      request,
    );
  }
  readActiveDatabase(database, request, view.database_block_id);
  const membership = readActiveMembership(
    database,
    request.projectId,
    operation.cardBlockId,
  );
  if (!membership || membership.database_block_id !== view.database_block_id) {
    return reject(
      "membership_conflict",
      `Card ${operation.cardBlockId} is not a member of View ${operation.viewId}'s Database`,
      request,
    );
  }
  validatePositionGroup(
    database,
    request,
    view,
    membership.id,
    operation.groupKey,
  );
  const current = readPosition(
    database,
    operation.viewId,
    operation.cardBlockId,
  );
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== operation.expectedPositionRevision) {
    reject(
      "position_conflict",
      `View position revision changed for Card ${operation.cardBlockId}`,
      request,
      {
        expectedRevision: operation.expectedPositionRevision,
        actualRevision: currentRevision,
      },
    );
  }
  const rank = allocateViewPositionRank(database, request, {
    viewId: operation.viewId,
    cardBlockId: operation.cardBlockId,
    groupKey: operation.groupKey,
    ...(operation.beforeCardBlockId === undefined
      ? {}
      : { beforeCardBlockId: operation.beforeCardBlockId }),
  });
  const revision = currentRevision + 1;
  if (!current) {
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
        operation.viewId,
        operation.cardBlockId,
        request.projectId,
        operation.groupKey,
        rank.rankKey,
        now,
        now,
      );
  } else {
    database
      .prepare(
        `
        UPDATE database_view_positions
        SET group_key = ?, rank_key = ?, revision = revision + 1, updated_at = ?
        WHERE view_id = ? AND block_id = ? AND project_id = ? AND revision = ?
      `,
      )
      .run(
        operation.groupKey,
        rank.rankKey,
        now,
        operation.viewId,
        operation.cardBlockId,
        request.projectId,
        operation.expectedPositionRevision,
      );
  }
  return {
    payload: {
      viewId: operation.viewId,
      databaseBlockId: view.database_block_id,
      cardBlockId: operation.cardBlockId,
      groupKey: operation.groupKey,
      positionRankKey: rank.rankKey,
      positionRevision: revision,
      rebalancedPositions: rank.rebalanced,
    },
    targetBlockIds: uniqueSorted([
      operation.cardBlockId,
      view.database_block_id,
    ]),
    databaseBlockIds: [view.database_block_id],
    committedRevisions: { position: revision },
    projectionCardIds: [],
  };
};

const compareRankedItems = (
  left: DatabaseRankedItem,
  right: DatabaseRankedItem,
): number =>
  left.rankKey === right.rankKey
    ? compareStrings(left.id, right.id)
    : compareStrings(left.rankKey, right.rankKey);

const planBulkPositionRanks = (
  request: DatabaseMutationRequest,
  input: {
    readonly items: readonly DatabaseRankedItem[];
    readonly cardBlockIds: readonly string[];
    readonly beforeCardBlockId?: string;
  },
): {
  readonly selectedRankKeys: ReadonlyMap<string, string>;
  readonly rebalancedRemainingRankKeys: ReadonlyMap<string, string>;
} => {
  const selected = new Set(input.cardBlockIds);
  const originalRemaining = new Map(
    input.items
      .filter((item) => !selected.has(item.id))
      .map((item) => [item.id, item.rankKey] as const),
  );
  let virtualItems = [...originalRemaining].map(([id, rankKey]) => ({
    id,
    rankKey,
  }));
  const selectedRankKeys = new Map<string, string>();
  const effectiveRanks = new Map(originalRemaining);

  try {
    for (const cardBlockId of input.cardBlockIds) {
      const plan = planDatabaseFractionalRank({
        items: virtualItems,
        targetId: cardBlockId,
        ...(input.beforeCardBlockId === undefined
          ? {}
          : { beforeId: input.beforeCardBlockId }),
      });
      for (const [id, rankKey] of plan.rebalancedRankKeys) {
        effectiveRanks.set(id, rankKey);
        if (selected.has(id)) selectedRankKeys.set(id, rankKey);
      }
      effectiveRanks.set(cardBlockId, plan.rankKey);
      selectedRankKeys.set(cardBlockId, plan.rankKey);
      virtualItems = [...effectiveRanks]
        .map(([id, rankKey]) => ({ id, rankKey }))
        .sort(compareRankedItems);
    }
  } catch (error) {
    if (!(error instanceof DatabaseFractionalRankError)) throw error;
    if (error.code === "anchor_not_found") {
      return reject("position_anchor_not_found", error.message, request);
    }
    return reject("rank_rebalance_limit", error.message, request);
  }

  const rebalancedRemainingRankKeys = new Map<string, string>();
  for (const [id, originalRankKey] of originalRemaining) {
    const effectiveRankKey = effectiveRanks.get(id);
    if (!effectiveRankKey || effectiveRankKey === originalRankKey) continue;
    rebalancedRemainingRankKeys.set(id, effectiveRankKey);
  }
  return { selectedRankKeys, rebalancedRemainingRankKeys };
};

const positionCards = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "position_cards" }
    >;
  },
  now: string,
  inject: (point: DatabaseMutationFaultPoint) => void,
): AuthorityCommit => {
  const operation = request.operation;
  const view = readView(database, operation.viewId);
  if (
    !view ||
    view.project_id !== request.projectId ||
    view.lifecycle !== "active"
  ) {
    return reject(
      "view_not_found",
      `Active Database View not found: ${operation.viewId}`,
      request,
    );
  }
  readActiveDatabase(database, request, view.database_block_id);
  const selected = new Set(operation.cards.map((entry) => entry.cardBlockId));
  if (
    operation.beforeCardBlockId !== undefined &&
    selected.has(operation.beforeCardBlockId)
  ) {
    return reject(
      "position_anchor_not_found",
      "Bulk position anchor must be external to the moved Card set",
      request,
    );
  }

  const validated = operation.cards.map((entry) => {
    readCard(database, request, entry.cardBlockId);
    const membership = readActiveMembership(
      database,
      request.projectId,
      entry.cardBlockId,
    );
    if (!membership || membership.database_block_id !== view.database_block_id) {
      return reject(
        "membership_conflict",
        `Card ${entry.cardBlockId} is not a member of View ${operation.viewId}'s Database`,
        request,
      );
    }
    validatePositionGroup(
      database,
      request,
      view,
      membership.id,
      operation.groupKey,
    );
    const current = readPosition(
      database,
      operation.viewId,
      entry.cardBlockId,
    );
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== entry.expectedPositionRevision) {
      return reject(
        "position_conflict",
        `View position revision changed for Card ${entry.cardBlockId}`,
        request,
        {
          expectedRevision: entry.expectedPositionRevision,
          actualRevision: currentRevision,
        },
      );
    }
    return { entry, current };
  });

  if (operation.beforeCardBlockId !== undefined) {
    const anchor = readPosition(
      database,
      operation.viewId,
      operation.beforeCardBlockId,
    );
    if (!anchor) {
      return reject(
        "position_anchor_not_found",
        `View position anchor does not exist: ${operation.beforeCardBlockId}`,
        request,
      );
    }
    if (anchor.group_key !== operation.groupKey) {
      return reject(
        "position_anchor_group_mismatch",
        `View position anchor ${operation.beforeCardBlockId} belongs to another group`,
        request,
      );
    }
  }
  inject("bulk_after_validation");

  const items = database
    .prepare(
      `
      SELECT block_id AS id, rank_key AS rankKey
      FROM database_view_positions
      WHERE view_id = ? AND group_key IS ?
      ORDER BY rank_key, block_id
    `,
    )
    .all(operation.viewId, operation.groupKey) as DatabaseRankedItem[];
  const rankPlan = planBulkPositionRanks(request, {
    items,
    cardBlockIds: operation.cards.map((entry) => entry.cardBlockId),
    ...(operation.beforeCardBlockId === undefined
      ? {}
      : { beforeCardBlockId: operation.beforeCardBlockId }),
  });
  inject("bulk_after_rank_plan");

  for (const [cardBlockId, rankKey] of rankPlan.rebalancedRemainingRankKeys) {
    database
      .prepare(
        `UPDATE database_view_positions
         SET rank_key = ?, updated_at = ?
         WHERE view_id = ? AND block_id = ? AND project_id = ?`,
      )
      .run(rankKey, now, operation.viewId, cardBlockId, request.projectId);
  }

  const positions = validated.map(({ entry, current }) => {
    const rankKey = rankPlan.selectedRankKeys.get(entry.cardBlockId);
    if (!rankKey) {
      throw new Error(`Bulk rank plan omitted Card ${entry.cardBlockId}`);
    }
    const revision = entry.expectedPositionRevision + 1;
    if (!current) {
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
          operation.viewId,
          entry.cardBlockId,
          request.projectId,
          operation.groupKey,
          rankKey,
          now,
          now,
        );
    } else {
      const updated = database
        .prepare(
          `
          UPDATE database_view_positions
          SET group_key = ?, rank_key = ?, revision = revision + 1,
              updated_at = ?
          WHERE view_id = ? AND block_id = ? AND project_id = ?
            AND revision = ?
        `,
        )
        .run(
          operation.groupKey,
          rankKey,
          now,
          operation.viewId,
          entry.cardBlockId,
          request.projectId,
          entry.expectedPositionRevision,
        );
      if (updated.changes !== 1) {
        throw new Error(
          `Bulk View position changed during commit for ${entry.cardBlockId}`,
        );
      }
    }
    return {
      cardBlockId: entry.cardBlockId,
      positionRankKey: rankKey,
      positionRevision: revision,
    };
  });
  inject("bulk_after_positions");

  return {
    payload: {
      viewId: operation.viewId,
      databaseBlockId: view.database_block_id,
      groupKey: operation.groupKey,
      positions,
      rebalancedPositions: rankPlan.rebalancedRemainingRankKeys.size,
    },
    targetBlockIds: uniqueSorted([
      view.database_block_id,
      ...operation.cards.map((entry) => entry.cardBlockId),
    ]),
    databaseBlockIds: [view.database_block_id],
    committedRevisions: Object.fromEntries(
      positions.map((position, index) => [
        `positions[${index}]`,
        position.positionRevision,
      ]),
    ),
    projectionCardIds: [],
  };
};

const requireValueAuthority = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  input: {
    readonly cardBlockId: string;
    readonly databaseBlockId: string;
    readonly propertyId: string;
  },
): {
  readonly membership: MembershipRow;
  readonly property: PropertyRow;
  readonly current: PropertyValueRow | null;
} => {
  readCard(database, request, input.cardBlockId);
  readActiveDatabase(database, request, input.databaseBlockId);
  const membership = readActiveMembership(
    database,
    request.projectId,
    input.cardBlockId,
  );
  if (!membership || membership.database_block_id !== input.databaseBlockId) {
    return reject(
      "membership_conflict",
      `Card ${input.cardBlockId} does not belong to Database ${input.databaseBlockId}`,
      request,
    );
  }
  const property = readProperty(database, input.propertyId);
  if (
    !property ||
    property.project_id !== request.projectId ||
    property.database_block_id !== input.databaseBlockId ||
    property.lifecycle !== "active"
  ) {
    return reject(
      "property_not_found",
      `Active property does not belong to Database ${input.databaseBlockId}: ${input.propertyId}`,
      request,
    );
  }
  const current =
    (database
      .prepare(
        `
        SELECT membership_id, property_id, value_type, value_json, revision
        FROM database_property_values
        WHERE membership_id = ? AND property_id = ?
      `,
      )
      .get(membership.id, property.id) as PropertyValueRow | undefined) ?? null;
  return { membership, property, current };
};

const reconcileGroupedViewPositions = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  input: {
    readonly membership: MembershipRow;
    readonly propertyId: string;
    readonly value: DatabaseJsonValue;
    readonly now: string;
    readonly deferredViewIds: ReadonlySet<string>;
  },
): Readonly<Record<string, number>> => {
  const views = database
    .prepare(
      `
      SELECT
        id, database_block_id, project_id, config_json,
        is_primary, revision, rank_key, lifecycle
      FROM database_views
      WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
      ORDER BY id
    `,
    )
    .all(input.membership.database_block_id, request.projectId) as ViewRow[];
  const revisions: Record<string, number> = {};
  for (const view of views) {
    if (input.deferredViewIds.has(view.id)) continue;
    let rawConfig: unknown;
    try {
      rawConfig = JSON.parse(view.config_json) as unknown;
    } catch {
      throw new Error(`Database View ${view.id} contains corrupt config JSON`);
    }
    const schemaKey =
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      !Array.isArray(rawConfig) &&
      "schemaKey" in rawConfig
        ? rawConfig.schemaKey
        : undefined;
    if (schemaKey !== "nodex.database-view") continue;
    let config: GeneralDatabaseViewConfig;
    try {
      config = parseGeneralDatabaseViewConfig(rawConfig);
    } catch (error) {
      return reject(
        "view_conflict",
        `Active Database View ${view.id} has an invalid grouped schema: ${(error as Error).message}`,
        request,
      );
    }
    if (config.group?.propertyId !== input.propertyId) continue;
    const position = readPosition(
      database,
      view.id,
      input.membership.card_block_id,
    );
    if (!position) continue;
    const groupKey = groupedValueKey(input.value);
    if (position.group_key === groupKey) continue;
    const rank = allocateViewPositionRank(database, request, {
      viewId: view.id,
      cardBlockId: input.membership.card_block_id,
      groupKey,
    });
    const update = database
      .prepare(
        `
        UPDATE database_view_positions
        SET group_key = ?, rank_key = ?, revision = revision + 1, updated_at = ?
        WHERE view_id = ? AND block_id = ? AND revision = ?
      `,
      )
      .run(
        groupKey,
        rank.rankKey,
        input.now,
        view.id,
        input.membership.card_block_id,
        position.revision,
      );
    if (update.changes !== 1) {
      throw new Error(
        `Grouped View position changed while updating ${view.id}`,
      );
    }
    revisions[view.id] = position.revision + 1;
  }
  return revisions;
};

const explicitPositionViewIdsForCard = (
  request: DatabaseMutationRequest,
  cardBlockId: string,
): ReadonlySet<string> =>
  // Keep the selected View on its caller-observed revision until the explicit
  // position_card operation applies the requested logical anchor. Other Views
  // grouped by this property still reconcile as a declared derived revision in
  // the set-value operation result; no primary Database/View is special-cased.
  new Set(
    request.operations.flatMap((operation) =>
      operation.kind === "position_card" &&
      operation.cardBlockId === cardBlockId
        ? [operation.viewId]
        : operation.kind === "position_cards" &&
            operation.cards.some((entry) => entry.cardBlockId === cardBlockId)
          ? [operation.viewId]
        : [],
    ),
  );

const setValue = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "set_value" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  const authority = requireValueAuthority(database, request, operation);
  if (authority.property.value_type === "multi_select") {
    reject(
      "property_value_invalid",
      `multi_select property ${operation.propertyId} requires add_remove_value intent`,
      request,
    );
  }
  const currentRevision = authority.current?.revision ?? 0;
  if (currentRevision !== operation.expectedValueRevision) {
    reject(
      "property_value_conflict",
      `Property value revision changed for ${operation.propertyId}`,
      request,
      {
        expectedRevision: operation.expectedValueRevision,
        actualRevision: currentRevision,
      },
    );
  }
  const value = normalizePropertyValue(
    request,
    authority.property,
    operation.value,
  );
  const valueJson = stableStringifyDatabaseJson(value);
  const revision = currentRevision + 1;
  database
    .prepare(
      `
      INSERT INTO database_property_values (
        membership_id, property_id, database_block_id, project_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(membership_id, property_id) DO UPDATE SET
        value_type = excluded.value_type,
        value_json = excluded.value_json,
        revision = database_property_values.revision + 1,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      authority.membership.id,
      authority.property.id,
      operation.databaseBlockId,
      request.projectId,
      authority.property.value_type,
      valueJson,
      now,
    );
  const groupedPositionRevisions = reconcileGroupedViewPositions(
    database,
    request,
    {
      membership: authority.membership,
      propertyId: operation.propertyId,
      value,
      now,
      deferredViewIds: explicitPositionViewIdsForCard(
        request,
        operation.cardBlockId,
      ),
    },
  );
  const metadata = advanceBlockMetadata(
    database,
    request,
    [operation.cardBlockId],
    now,
  );
  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      cardBlockId: operation.cardBlockId,
      membershipId: authority.membership.id,
      propertyId: operation.propertyId,
      value,
      valueRevision: revision,
      groupedPositionRevisions,
      cardMetadataRevision: metadata[operation.cardBlockId] ?? 0,
    },
    targetBlockIds: uniqueSorted([
      operation.cardBlockId,
      operation.databaseBlockId,
    ]),
    databaseBlockIds: [operation.databaseBlockId],
    committedRevisions: {
      value: revision,
      ...Object.fromEntries(
        Object.entries(groupedPositionRevisions).map(
          ([viewId, positionRevision]) => [
            `position:${viewId}`,
            positionRevision,
          ],
        ),
      ),
      cardMetadata: metadata[operation.cardBlockId] ?? 0,
    },
    projectionCardIds: [operation.cardBlockId],
  };
};

const setValues = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "set_values" }
    >;
  },
  now: string,
  inject: (point: DatabaseMutationFaultPoint) => void,
): AuthorityCommit => {
  const operation = request.operation;
  const scalarOperations = operation.entries.map((entry) => ({
    kind: "set_value" as const,
    cardBlockId: entry.cardBlockId,
    databaseBlockId: operation.databaseBlockId,
    propertyId: entry.propertyId,
    expectedValueRevision: entry.expectedValueRevision,
    value: entry.value,
  }));

  for (const scalarOperation of scalarOperations) {
    const authority = requireValueAuthority(database, request, scalarOperation);
    if (authority.property.value_type === "multi_select") {
      return reject(
        "property_value_invalid",
        `multi_select property ${scalarOperation.propertyId} requires add_remove_value intent`,
        request,
      );
    }
    const currentRevision = authority.current?.revision ?? 0;
    if (currentRevision !== scalarOperation.expectedValueRevision) {
      return reject(
        "property_value_conflict",
        `Property value revision changed for ${scalarOperation.propertyId} on Card ${scalarOperation.cardBlockId}`,
        request,
        {
          expectedRevision: scalarOperation.expectedValueRevision,
          actualRevision: currentRevision,
        },
      );
    }
    normalizePropertyValue(request, authority.property, scalarOperation.value);
  }
  inject("bulk_after_validation");

  const commits = scalarOperations.map((scalarOperation) =>
    setValue(
      database,
      { ...request, operation: scalarOperation },
      now,
    ),
  );
  inject("bulk_after_values");
  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      values: commits.map((commit, index) => ({
        index,
        payload: commit.payload,
      })),
    },
    targetBlockIds: uniqueSorted(
      commits.flatMap((commit) => commit.targetBlockIds),
    ),
    databaseBlockIds: uniqueSorted(
      commits.flatMap((commit) => commit.databaseBlockIds),
    ),
    committedRevisions: Object.fromEntries(
      commits.flatMap((commit, index) =>
        Object.entries(commit.committedRevisions).map(([key, value]) => [
          `values[${index}].${key}`,
          value,
        ]),
      ),
    ),
    projectionCardIds: uniqueSorted(
      commits.flatMap((commit) => commit.projectionCardIds),
    ),
  };
};

const addRemoveValue = (
  database: Database.Database,
  request: DatabaseMutationRequest & {
    readonly operation: Extract<
      DatabaseMutationOperation,
      { readonly kind: "add_remove_value" }
    >;
  },
  now: string,
): AuthorityCommit => {
  const operation = request.operation;
  const authority = requireValueAuthority(database, request, operation);
  if (authority.property.value_type !== "multi_select") {
    reject(
      "property_value_invalid",
      `add_remove_value requires a multi_select property: ${operation.propertyId}`,
      request,
    );
  }
  let current: readonly string[] = [];
  if (authority.current) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(authority.current.value_json) as unknown;
    } catch {
      throw new Error(
        `Property ${operation.propertyId} contains corrupt value JSON`,
      );
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((entry) => typeof entry === "string")
    ) {
      throw new Error(
        `Property ${operation.propertyId} contains a non-set value`,
      );
    }
    current = parsed;
  }
  const removed = new Set(operation.remove);
  const next = new Set(current.filter((entry) => !removed.has(entry)));
  for (const entry of operation.add) next.add(entry);
  const value = normalizePropertyValue(
    request,
    authority.property,
    [...next].sort(compareStrings),
  );
  const revision = (authority.current?.revision ?? 0) + 1;
  database
    .prepare(
      `
      INSERT INTO database_property_values (
        membership_id, property_id, database_block_id, project_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, 'multi_select', ?, 1, ?)
      ON CONFLICT(membership_id, property_id) DO UPDATE SET
        value_json = excluded.value_json,
        revision = database_property_values.revision + 1,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      authority.membership.id,
      authority.property.id,
      operation.databaseBlockId,
      request.projectId,
      stableStringifyDatabaseJson(value),
      now,
    );
  const groupedPositionRevisions = reconcileGroupedViewPositions(
    database,
    request,
    {
      membership: authority.membership,
      propertyId: operation.propertyId,
      value,
      now,
      deferredViewIds: explicitPositionViewIdsForCard(
        request,
        operation.cardBlockId,
      ),
    },
  );
  const metadata = advanceBlockMetadata(
    database,
    request,
    [operation.cardBlockId],
    now,
  );
  return {
    payload: {
      databaseBlockId: operation.databaseBlockId,
      cardBlockId: operation.cardBlockId,
      membershipId: authority.membership.id,
      propertyId: operation.propertyId,
      value,
      valueRevision: revision,
      groupedPositionRevisions,
      cardMetadataRevision: metadata[operation.cardBlockId] ?? 0,
    },
    targetBlockIds: uniqueSorted([
      operation.cardBlockId,
      operation.databaseBlockId,
    ]),
    databaseBlockIds: [operation.databaseBlockId],
    committedRevisions: {
      value: revision,
      ...Object.fromEntries(
        Object.entries(groupedPositionRevisions).map(
          ([viewId, positionRevision]) => [
            `position:${viewId}`,
            positionRevision,
          ],
        ),
      ),
      cardMetadata: metadata[operation.cardBlockId] ?? 0,
    },
    projectionCardIds: [operation.cardBlockId],
  };
};

type DatabaseOperationRequest = DatabaseMutationRequest & {
  readonly operation: DatabaseMutationOperation;
};

const executeOperationAuthority = (
  database: Database.Database,
  request: DatabaseOperationRequest,
  now: string,
  inject: (point: DatabaseMutationFaultPoint) => void,
): AuthorityCommit => {
  switch (request.operation.kind) {
    case "create_database":
      return createDatabase(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "create_database" }
          >;
        },
        now,
      );
    case "put_property":
      return putProperty(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "put_property" }
          >;
        },
        now,
      );
    case "delete_property":
      return deleteProperty(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "delete_property" }
          >;
        },
        now,
      );
    case "transfer_membership":
      return transferMembership(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "transfer_membership" }
          >;
        },
        now,
      );
    case "put_view":
      return putView(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "put_view" }
          >;
        },
        now,
      );
    case "delete_view":
      return deleteView(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "delete_view" }
          >;
        },
        now,
      );
    case "position_card":
      return positionCard(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "position_card" }
          >;
        },
        now,
      );
    case "position_cards":
      return positionCards(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "position_cards" }
          >;
        },
        now,
        inject,
      );
    case "set_value":
      return setValue(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "set_value" }
          >;
        },
        now,
      );
    case "set_values":
      return setValues(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "set_values" }
          >;
        },
        now,
        inject,
      );
    case "add_remove_value":
      return addRemoveValue(
        database,
        request as DatabaseMutationRequest & {
          readonly operation: Extract<
            DatabaseMutationOperation,
            { readonly kind: "add_remove_value" }
          >;
        },
        now,
      );
  }
};

const executeBatchAuthority = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  now: string,
  inject: (point: DatabaseMutationFaultPoint) => void,
): AuthorityCommit => {
  const commits = request.operations.map((operation) =>
    executeOperationAuthority(
      database,
      { ...request, operation },
      now,
      inject,
    ),
  );
  return {
    payload: {
      operationResults: commits.map((commit, index) => ({
        index,
        kind: request.operations[index]?.kind ?? "unknown",
        payload: commit.payload,
      })),
    },
    targetBlockIds: uniqueSorted(
      commits.flatMap((commit) => commit.targetBlockIds),
    ),
    databaseBlockIds: uniqueSorted(
      commits.flatMap((commit) => commit.databaseBlockIds),
    ),
    committedRevisions: Object.fromEntries(
      commits.flatMap((commit, index) =>
        Object.entries(commit.committedRevisions).map(([key, value]) => [
          `operations[${index}].${key}`,
          value,
        ]),
      ),
    ),
    projectionCardIds: uniqueSorted(
      commits.flatMap((commit) => commit.projectionCardIds),
    ),
  };
};

const persistChangeLog = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  evidence: MutationEvidence,
  commit: AuthorityCommit,
  now: string,
): number => {
  const payload = stableStringifyDatabaseJson({
    version: DATABASE_MUTATION_CONTRACT_VERSION,
    mutationKind: MUTATION_KIND,
    operationKinds: request.operations.map((operation) => operation.kind),
    requestHash: evidence.requestHash,
    committedRevisions: commit.committedRevisions,
    payload: commit.payload,
  });
  const inserted = database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)
    `,
    )
    .run(
      request.projectId,
      request.storeEpoch,
      CHANGE_KIND,
      request.operationId,
      stableStringifyDatabaseJson(uniqueSorted(commit.targetBlockIds)),
      stableStringifyDatabaseJson(uniqueSorted(commit.databaseBlockIds)),
      payload,
      now,
    );
  const sequence = Number(inserted.lastInsertRowid);
  if (Number.isSafeInteger(sequence) && sequence >= 1) return sequence;
  throw new Error("SQLite returned an invalid Database change-log sequence");
};

const persistLedger = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  evidence: MutationEvidence,
  input: {
    readonly outcome: "committed" | "rejected";
    readonly resultJson: string;
    readonly targetBlockIds: readonly string[];
    readonly databaseBlockIds: readonly string[];
    readonly committedRevisions: Readonly<Record<string, number>>;
    readonly changeLogSeq: number | null;
    readonly now: string;
  },
): void => {
  database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        client_session_id, request_hash, request_json, target_block_ids_json,
        affected_document_ids_json, affected_database_block_ids_json,
        field_intents_json, expected_revisions_json, outcome, result_json,
        committed_revisions_json, document_heads_json, change_log_seq,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, '{}', ?, ?)
    `,
    )
    .run(
      request.operationId,
      request.projectId,
      request.storeEpoch,
      MUTATION_KIND,
      evidence.actorJson,
      request.clientSessionId ?? null,
      evidence.requestHash,
      evidence.canonicalRequest,
      stableStringifyDatabaseJson(uniqueSorted(input.targetBlockIds)),
      stableStringifyDatabaseJson(uniqueSorted(input.databaseBlockIds)),
      evidence.fieldIntentsJson,
      evidence.expectedRevisionsJson,
      input.outcome,
      input.resultJson,
      stableStringifyDatabaseJson(input.committedRevisions),
      input.changeLogSeq,
      input.now,
    );
};

const persistRejected = (
  database: Database.Database,
  request: DatabaseMutationRequest,
  evidence: MutationEvidence,
  error: DatabaseMutationCommandError,
  now: string,
): DatabaseMutationCommandResult => {
  persistLedger(database, request, evidence, {
    outcome: "rejected",
    resultJson: stableStringifyDatabaseJson(error),
    targetBlockIds: evidence.requestedTargetBlockIds,
    databaseBlockIds: evidence.requestedDatabaseBlockIds,
    committedRevisions: {},
    changeLogSeq: null,
    now,
  });
  return { ok: false, error };
};

const validateStoredChangeLog = (
  database: Database.Database,
  row: StoredMutationRow,
  request: DatabaseMutationRequest,
  evidence: MutationEvidence,
): DatabaseMutationCommandResult | null => {
  if (row.outcome !== "committed") return null;
  if (row.change_log_seq === null) {
    throw new Error(
      `Committed Database operation ${row.mutation_id} has no change cursor`,
    );
  }
  const change = database
    .prepare(
      `
      SELECT project_id, store_epoch, kind, operation_id, payload_json
      FROM change_log WHERE seq = ?
    `,
    )
    .get(row.change_log_seq) as
    | {
        readonly project_id: string;
        readonly store_epoch: string;
        readonly kind: string;
        readonly operation_id: string | null;
        readonly payload_json: string;
      }
    | undefined;
  if (
    !change ||
    change.project_id !== request.projectId ||
    change.store_epoch !== request.storeEpoch ||
    change.kind !== CHANGE_KIND ||
    change.operation_id !== request.operationId
  ) {
    throw new Error(
      `Committed Database operation ${row.mutation_id} has invalid change-log identity`,
    );
  }
  const payload = JSON.parse(change.payload_json) as {
    readonly mutationKind?: unknown;
    readonly operationKinds?: unknown;
    readonly requestHash?: unknown;
  };
  if (
    payload.mutationKind !== MUTATION_KIND ||
    stableStringifyDatabaseJson(payload.operationKinds) !==
      stableStringifyDatabaseJson(
        request.operations.map((operation) => operation.kind),
      ) ||
    payload.requestHash !== evidence.requestHash
  ) {
    throw new Error(
      `Committed Database operation ${row.mutation_id} has invalid change-log request evidence`,
    );
  }
  const receipt = parseDatabaseMutationReceipt(JSON.parse(row.result_json));
  if (receipt.changeLogSeq !== row.change_log_seq) {
    throw new Error(
      `Committed Database operation ${row.mutation_id} receipt cursor diverges from its ledger`,
    );
  }
  return { ok: true, value: { ...receipt, duplicate: true } };
};

/**
 * Apply one stable Database intent on the process-wide SQLite writer. The
 * authority change, any compatibility projection invalidation/rebuild, the
 * canonical Block history cursor, and its immutable receipt commit together.
 */
export const applyDatabaseMutation = (
  database: Database.Database,
  rawRequest: DatabaseMutationRequest,
  options: ApplyDatabaseMutationOptions = {},
): DatabaseMutationCommandResult => {
  const request = parseDatabaseMutationRequest(rawRequest);
  const evidence = makeEvidence(request);
  const inject = (point: DatabaseMutationFaultPoint): void => {
    options.faultInjector?.(point);
  };
  const apply = database.transaction((): DatabaseMutationCommandResult => {
    const currentEpoch = readStoreEpoch(database);
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
    const existing = readStoredMutation(database, request.operationId);
    if (existing) {
      const basic = loadStoredOutcome(existing, request, evidence);
      if (!basic.ok || existing.outcome === "rejected") return basic;
      return (
        validateStoredChangeLog(database, existing, request, evidence) ?? basic
      );
    }
    const project = database
      .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
      .get(request.projectId);
    if (!project) {
      return {
        ok: false,
        error: makeError(
          "project_not_found",
          `Project does not exist: ${request.projectId}`,
          request,
        ),
      };
    }

    const now = options.now?.() ?? new Date().toISOString();
    let commit: AuthorityCommit;
    try {
      commit = database.transaction(() =>
        executeBatchAuthority(database, request, now, inject),
      )();
    } catch (error) {
      if (!(error instanceof DatabaseMutationRejection)) throw error;
      const rejected = persistRejected(
        database,
        request,
        evidence,
        error.error,
        now,
      );
      inject("after_ledger");
      inject("before_commit");
      return rejected;
    }
    inject("after_authority");
    refreshCardProjections(
      database,
      request.projectId,
      commit.projectionCardIds,
      now,
    );
    inject("after_projections");
    const changeLogSeq = persistChangeLog(
      database,
      request,
      evidence,
      commit,
      now,
    );
    inject("after_change_log");
    const receipt: DatabaseMutationReceipt = {
      version: DATABASE_MUTATION_CONTRACT_VERSION,
      operationId: request.operationId,
      projectId: request.projectId,
      storeEpoch: request.storeEpoch,
      operationKinds: request.operations.map((operation) => operation.kind),
      affectedDatabaseBlockIds: uniqueSorted(commit.databaseBlockIds),
      duplicate: false,
      payload: commit.payload,
      changeLogSeq,
      committedAt: now,
    };
    persistLedger(database, request, evidence, {
      outcome: "committed",
      resultJson: stableStringifyDatabaseJson(receipt),
      targetBlockIds: commit.targetBlockIds,
      databaseBlockIds: commit.databaseBlockIds,
      committedRevisions: commit.committedRevisions,
      changeLogSeq,
      now,
    });
    inject("after_ledger");
    inject("before_commit");
    return { ok: true, value: receipt };
  });
  const result = apply.immediate();
  inject("after_commit");
  return result;
};

export const readDatabaseKernelDescriptor = (
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
): GeneralDatabaseDescriptor | null =>
  readGeneralDatabaseDescriptor(projectId, databaseBlockId, database);

export const readDatabaseKernelCardSummary = (
  database: Database.Database,
  projectId: string,
  cardBlockId: string,
) => readCardContentSummary(projectId, cardBlockId, database);

const readDatabaseSnapshot = <T>(
  database: Database.Database,
  projectId: string,
  read: () => T | null,
): DatabaseReadCommandResult<T> => {
  const storeEpoch = readStoreEpoch(database);
  if (!storeEpoch) {
    return {
      ok: false,
      error: {
        code: "store_not_initialized",
        message: "The Block store has no active epoch",
        retryable: false,
      },
    };
  }
  const project = database
    .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
    .get(projectId);
  if (!project) {
    return {
      ok: false,
      error: {
        code: "project_not_found",
        message: `Project does not exist: ${projectId}`,
        retryable: false,
      },
    };
  }
  try {
    const change = database
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log WHERE project_id = ?",
      )
      .get(projectId) as { readonly seq: number };
    const snapshot: DatabaseReadSnapshot<T> = {
      version: DATABASE_QUERY_CONTRACT_VERSION,
      projectId,
      storeEpoch,
      changeLogSeq: change.seq,
      value: read(),
    };
    return { ok: true, value: snapshot };
  } catch (error) {
    if (error instanceof GeneralDatabaseQueryError) {
      return {
        ok: false,
        error: {
          code: "database_state_corrupt",
          message: error.message,
          retryable: false,
        },
      };
    }
    throw error;
  }
};

export const readDatabaseDescriptorSnapshot = (
  database: Database.Database,
  projectId: string,
  databaseBlockId: string,
): DatabaseReadCommandResult<GeneralDatabaseDescriptor> =>
  readDatabaseSnapshot(database, projectId, () =>
    readGeneralDatabaseDescriptor(projectId, databaseBlockId, database),
  );

export const readPrimaryDatabaseDescriptorSnapshot = (
  database: Database.Database,
  projectId: string,
): DatabaseReadCommandResult<GeneralDatabaseDescriptor> =>
  readDatabaseSnapshot(database, projectId, () =>
    readPrimaryGeneralDatabaseDescriptor(projectId, database),
  );

export const queryDatabaseViewSnapshot = (
  database: Database.Database,
  projectId: string,
  viewId: string,
): DatabaseReadCommandResult<GeneralDatabaseViewQuery> =>
  readDatabaseSnapshot(database, projectId, () =>
    queryGeneralDatabaseView(projectId, viewId, database),
  );
