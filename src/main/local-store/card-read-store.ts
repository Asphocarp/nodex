import type Database from "better-sqlite3";
import type {
  Card,
  CardSummary,
  Estimate,
  Priority,
  RecurrenceConfig,
  ReminderConfig,
} from "../../shared/types";
import { isCardStatus, type CardStatus } from "../../shared/card-status";
import { summarizeCardDescription } from "../../shared/card-summary";
import { assertValidCardInput } from "./card-input-validation";

const DATABASE_PROPERTY_KEYS = [
  "status",
  "priority",
  "estimate",
  "tags",
  "due_date",
  "scheduled_start",
  "scheduled_end",
  "assignee",
] as const;

const INTRINSIC_PROPERTY_KEYS = [
  "agent.blocked",
  "agent.status",
  "run.target",
  "run.localPath",
  "run.baseBranch",
  "run.worktreePath",
  "run.environmentPath",
  "schedule.isAllDay",
  "schedule.timezone",
  "recurrence.config",
  "reminders.config",
] as const;

type DatabasePropertyKey = (typeof DATABASE_PROPERTY_KEYS)[number];
type IntrinsicPropertyKey = (typeof INTRINSIC_PROPERTY_KEYS)[number];

export type CardReadStoreErrorCode =
  | "card_document_missing"
  | "card_materialization_stale"
  | "card_database_membership_missing"
  | "card_database_property_missing"
  | "card_intrinsic_property_missing"
  | "card_property_invalid"
  | "card_view_position_invalid";

export class CardReadStoreError extends Error {
  constructor(
    readonly code: CardReadStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CardReadStoreError";
  }
}

interface CardAuthorityRow {
  readonly card_block_id: string;
  readonly project_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document";
  readonly containing_document_id: string | null;
  readonly location_revision: number;
  readonly metadata_revision: number;
  readonly block_created_at: string;
  readonly top_level_rank_key: string | null;
  readonly document_id: string | null;
  readonly document_generation: number | null;
  readonly document_head_seq: number | null;
  readonly document_schema_version: number | null;
  readonly document_readiness: "pending_genesis" | "ready" | "failed" | null;
  readonly document_authority: "legacy_shadow" | "ydoc_primary" | null;
  readonly materialization_generation: number | null;
  readonly materialization_projected_seq: number | null;
  readonly materialization_schema_version: number | null;
  readonly materialized_title: string | null;
  readonly materialized_nfm: string | null;
  readonly materialized_preview: string | null;
  readonly materialization_updated_at: string | null;
  readonly membership_id: string | null;
  readonly database_block_id: string | null;
  readonly view_id: string | null;
  readonly view_group_key: string | null;
  readonly view_rank_key: string | null;
  readonly view_order: number | null;
}

interface PropertyValueRow {
  readonly card_block_id: string;
  readonly property_key: string;
  readonly value_type: string;
  readonly value_json: string | null;
  readonly revision: number | null;
}

interface ParsedPropertyValue {
  readonly value: unknown;
  readonly revision: number;
}

interface CardContent {
  readonly title: string;
  readonly description: string;
  readonly preview: string;
  readonly length: number;
  readonly hasDescription: boolean;
}

interface AssembledCard {
  readonly card: Card | null;
  readonly compatibilityError:
    "card_database_membership_missing" | "card_view_position_invalid" | null;
  readonly row: CardAuthorityRow;
  readonly content: CardContent;
  readonly databaseValues: Readonly<
    Partial<Record<DatabasePropertyKey, unknown>>
  >;
  readonly intrinsicValues: Readonly<Record<IntrinsicPropertyKey, unknown>>;
  readonly propertyRevisions: Readonly<{
    database: Readonly<Partial<Record<DatabasePropertyKey, number>>>;
    intrinsic: Readonly<Record<IntrinsicPropertyKey, number>>;
  }>;
}

const CARD_AUTHORITY_SELECT = `
  WITH ranked_primary_positions AS (
    SELECT
      view.database_block_id,
      view.id AS view_id,
      position.block_id,
      position.group_key,
      position.rank_key,
      CAST(
        ROW_NUMBER() OVER (
          PARTITION BY view.id, position.group_key
          ORDER BY position.rank_key, position.block_id
        ) - 1 AS INTEGER
      ) AS view_order
    FROM database_views view
    INNER JOIN database_view_positions position
      ON position.view_id = view.id
      AND position.project_id = view.project_id
    WHERE view.is_primary = 1 AND view.kind = 'kanban'
  )
  SELECT
    card.id AS card_block_id,
    card.project_id,
    card.lifecycle,
    card.location_kind,
    card.containing_document_id,
    card.location_revision,
    card.metadata_revision,
    card.created_at AS block_created_at,
    placement.rank_key AS top_level_rank_key,
    document.id AS document_id,
    document.generation AS document_generation,
    document.head_seq AS document_head_seq,
    document.schema_version AS document_schema_version,
    document.readiness AS document_readiness,
    document.authority AS document_authority,
    materialization.generation AS materialization_generation,
    materialization.projected_seq AS materialization_projected_seq,
    materialization.schema_version AS materialization_schema_version,
    materialization.title AS materialized_title,
    materialization.nfm AS materialized_nfm,
    materialization.preview AS materialized_preview,
    materialization.updated_at AS materialization_updated_at,
    membership.id AS membership_id,
    membership.database_block_id,
    position.view_id,
    position.group_key AS view_group_key,
    position.rank_key AS view_rank_key,
    position.view_order
  FROM blocks card
  LEFT JOIN top_level_block_placements placement
    ON placement.block_id = card.id
    AND placement.project_id = card.project_id
  LEFT JOIN block_documents ownership
    ON ownership.block_id = card.id
    AND ownership.project_id = card.project_id
  LEFT JOIN documents document
    ON document.id = ownership.document_id
    AND document.project_id = ownership.project_id
  LEFT JOIN document_materializations materialization
    ON materialization.document_id = document.id
  LEFT JOIN database_memberships membership
    ON membership.card_block_id = card.id
    AND membership.project_id = card.project_id
    AND membership.removed_at IS NULL
  LEFT JOIN ranked_primary_positions position
    ON position.database_block_id = membership.database_block_id
    AND position.block_id = card.id
  WHERE card.type = 'card'
`;

const DATABASE_PROPERTY_PLACEHOLDERS = DATABASE_PROPERTY_KEYS.map(
  () => "?",
).join(", ");
const INTRINSIC_PROPERTY_PLACEHOLDERS = INTRINSIC_PROPERTY_KEYS.map(
  () => "?",
).join(", ");

const throwReadError = (
  code: CardReadStoreErrorCode,
  cardId: string,
  detail: string,
): never => {
  throw new CardReadStoreError(code, `Card ${cardId} ${detail}`);
};

const parseJsonValue = (row: PropertyValueRow): ParsedPropertyValue => {
  if (row.value_json === null || row.revision === null) {
    return throwReadError(
      row.property_key.includes(".")
        ? "card_intrinsic_property_missing"
        : "card_database_property_missing",
      row.card_block_id,
      `is missing relational property ${row.property_key}`,
    );
  }

  try {
    return {
      value: JSON.parse(row.value_json) as unknown,
      revision: row.revision,
    };
  } catch (error) {
    throw new CardReadStoreError(
      "card_property_invalid",
      `Card ${row.card_block_id} property ${row.property_key} is not valid JSON`,
      { cause: error },
    );
  }
};

const readDatabasePropertyRows = (
  database: Database.Database,
  cardIds: readonly string[],
): PropertyValueRow[] => {
  if (cardIds.length === 0) return [];
  const cardPlaceholders = cardIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
    SELECT
      membership.card_block_id,
      property.key AS property_key,
      property.value_type,
      value.value_json,
      value.revision
    FROM database_memberships membership
    INNER JOIN database_properties property
      ON property.database_block_id = membership.database_block_id
      AND property.project_id = membership.project_id
      AND property.lifecycle = 'active'
      AND property.key IN (${DATABASE_PROPERTY_PLACEHOLDERS})
    LEFT JOIN database_property_values value
      ON value.membership_id = membership.id
      AND value.property_id = property.id
      AND value.database_block_id = membership.database_block_id
      AND value.project_id = membership.project_id
    WHERE membership.removed_at IS NULL
      AND membership.card_block_id IN (${cardPlaceholders})
  `,
    )
    .all(...DATABASE_PROPERTY_KEYS, ...cardIds) as PropertyValueRow[];
};

const readIntrinsicPropertyRows = (
  database: Database.Database,
  cardIds: readonly string[],
): PropertyValueRow[] => {
  if (cardIds.length === 0) return [];
  const cardPlaceholders = cardIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
    SELECT
      block_id AS card_block_id,
      property_key,
      value_type,
      value_json,
      revision
    FROM block_properties
    WHERE property_key IN (${INTRINSIC_PROPERTY_PLACEHOLDERS})
      AND block_id IN (${cardPlaceholders})
  `,
    )
    .all(...INTRINSIC_PROPERTY_KEYS, ...cardIds) as PropertyValueRow[];
};

const indexProperties = (
  rows: readonly PropertyValueRow[],
): ReadonlyMap<string, ReadonlyMap<string, ParsedPropertyValue>> => {
  const indexed = new Map<string, Map<string, ParsedPropertyValue>>();
  for (const row of rows) {
    const cardProperties = indexed.get(row.card_block_id) ?? new Map();
    cardProperties.set(row.property_key, parseJsonValue(row));
    indexed.set(row.card_block_id, cardProperties);
  }
  return indexed;
};

const requireProperties = <Key extends string>(
  cardId: string,
  indexed: ReadonlyMap<string, ReadonlyMap<string, ParsedPropertyValue>>,
  keys: readonly Key[],
  missingCode: CardReadStoreErrorCode,
): {
  readonly values: Readonly<Record<Key, unknown>>;
  readonly revisions: Readonly<Record<Key, number>>;
} => {
  const cardProperties = indexed.get(cardId);
  const values = {} as Record<Key, unknown>;
  const revisions = {} as Record<Key, number>;

  for (const key of keys) {
    const property = cardProperties?.get(key);
    if (!property) {
      return throwReadError(
        missingCode,
        cardId,
        `is missing relational property ${key}`,
      );
    }
    values[key] = property.value;
    revisions[key] = property.revision;
  }

  return { values, revisions };
};

const requireNullableString = (
  cardId: string,
  key: string,
  value: unknown,
): string | null => {
  if (value === null || typeof value === "string") return value;
  return throwReadError(
    "card_property_invalid",
    cardId,
    `property ${key} must be a string or null`,
  );
};

const requireBoolean = (
  cardId: string,
  key: string,
  value: unknown,
): boolean => {
  if (typeof value === "boolean") return value;
  return throwReadError(
    "card_property_invalid",
    cardId,
    `property ${key} must be a boolean`,
  );
};

const requireStringArray = (
  cardId: string,
  key: string,
  value: unknown,
): string[] => {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return throwReadError(
    "card_property_invalid",
    cardId,
    `property ${key} must be an array of strings`,
  );
};

const requireReminderArray = (
  cardId: string,
  value: unknown,
): ReminderConfig[] => {
  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { readonly offsetMinutes?: unknown }).offsetMinutes ===
          "number",
    )
  ) {
    return value as ReminderConfig[];
  }
  return throwReadError(
    "card_property_invalid",
    cardId,
    "property reminders.config must be an array of reminders",
  );
};

const optionalDate = (
  cardId: string,
  key: string,
  value: unknown,
): Date | undefined => {
  const text = requireNullableString(cardId, key, value);
  if (text === null) return undefined;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return throwReadError(
    "card_property_invalid",
    cardId,
    `property ${key} is not a valid date`,
  );
};

const resolveCardContent = (row: CardAuthorityRow): CardContent => {
  if (!row.document_id || !row.document_authority) {
    return throwReadError(
      "card_document_missing",
      row.card_block_id,
      "has no owned Document",
    );
  }

  if (row.document_authority !== "ydoc_primary") {
    return throwReadError(
      "card_document_missing",
      row.card_block_id,
      `has unsupported Document authority ${row.document_authority}`,
    );
  }

  const isCurrentMaterialization =
    row.document_readiness === "ready" &&
    row.document_generation !== null &&
    row.document_head_seq !== null &&
    row.document_schema_version !== null &&
    row.materialization_generation === row.document_generation &&
    row.materialization_projected_seq === row.document_head_seq &&
    row.materialization_schema_version === row.document_schema_version &&
    typeof row.materialized_title === "string" &&
    typeof row.materialized_nfm === "string" &&
    typeof row.materialized_preview === "string";
  if (!isCurrentMaterialization) {
    return throwReadError(
      "card_materialization_stale",
      row.card_block_id,
      "does not have a materialization for its current Y.Doc head",
    );
  }

  return {
    title: row.materialized_title as string,
    description: row.materialized_nfm as string,
    preview: row.materialized_preview as string,
    length: (row.materialized_nfm as string).length,
    hasDescription: (row.materialized_nfm as string).trim().length > 0,
  };
};

const assembleCard = (
  row: CardAuthorityRow,
  databaseProperties: ReadonlyMap<
    string,
    ReadonlyMap<string, ParsedPropertyValue>
  >,
  intrinsicProperties: ReadonlyMap<
    string,
    ReadonlyMap<string, ParsedPropertyValue>
  >,
): AssembledCard => {
  const intrinsic = requireProperties(
    row.card_block_id,
    intrinsicProperties,
    INTRINSIC_PROPERTY_KEYS,
    "card_intrinsic_property_missing",
  );
  const content = resolveCardContent(row);
  if (!row.membership_id || !row.database_block_id) {
    return {
      row,
      content,
      card: null,
      compatibilityError: "card_database_membership_missing",
      databaseValues: {},
      intrinsicValues: intrinsic.values,
      propertyRevisions: {
        database: {},
        intrinsic: intrinsic.revisions,
      },
    };
  }

  const database = requireProperties(
    row.card_block_id,
    databaseProperties,
    DATABASE_PROPERTY_KEYS,
    "card_database_property_missing",
  );
  const statusValue = database.values.status;
  if (!isCardStatus(statusValue)) {
    return throwReadError(
      "card_property_invalid",
      row.card_block_id,
      "property status is not a Card status",
    );
  }
  const hasCompleteViewPosition =
    row.view_id !== null &&
    row.view_group_key !== null &&
    row.view_rank_key !== null &&
    row.view_order !== null;
  if (hasCompleteViewPosition && row.view_group_key !== statusValue) {
    return throwReadError(
      "card_view_position_invalid",
      row.card_block_id,
      "has a view group that disagrees with its status property",
    );
  }

  if (!hasCompleteViewPosition) {
    return {
      row,
      content,
      card: null,
      compatibilityError: "card_view_position_invalid",
      databaseValues: database.values,
      intrinsicValues: intrinsic.values,
      propertyRevisions: {
        database: database.revisions,
        intrinsic: intrinsic.revisions,
      },
    };
  }

  const priority = requireNullableString(
    row.card_block_id,
    "priority",
    database.values.priority,
  );
  const estimate = requireNullableString(
    row.card_block_id,
    "estimate",
    database.values.estimate,
  );
  const assignee = requireNullableString(
    row.card_block_id,
    "assignee",
    database.values.assignee,
  );
  const agentStatus = requireNullableString(
    row.card_block_id,
    "agent.status",
    intrinsic.values["agent.status"],
  );
  const runTarget = requireNullableString(
    row.card_block_id,
    "run.target",
    intrinsic.values["run.target"],
  );
  if (
    runTarget !== "localProject" &&
    runTarget !== "newWorktree" &&
    runTarget !== "cloud"
  ) {
    return throwReadError(
      "card_property_invalid",
      row.card_block_id,
      "property run.target is invalid",
    );
  }

  const recurrenceValue = intrinsic.values["recurrence.config"];
  if (
    recurrenceValue !== null &&
    (typeof recurrenceValue !== "object" || Array.isArray(recurrenceValue))
  ) {
    return throwReadError(
      "card_property_invalid",
      row.card_block_id,
      "property recurrence.config must be an object or null",
    );
  }

  const card: Card = {
    id: row.card_block_id,
    status: statusValue,
    archived: row.lifecycle === "archived",
    title: content.title,
    description: content.description,
    priority: priority === null ? undefined : (priority as Priority),
    estimate: estimate === null ? undefined : (estimate as Estimate),
    tags: requireStringArray(row.card_block_id, "tags", database.values.tags),
    dueDate: optionalDate(
      row.card_block_id,
      "due_date",
      database.values.due_date,
    ),
    scheduledStart: optionalDate(
      row.card_block_id,
      "scheduled_start",
      database.values.scheduled_start,
    ),
    scheduledEnd: optionalDate(
      row.card_block_id,
      "scheduled_end",
      database.values.scheduled_end,
    ),
    isAllDay: requireBoolean(
      row.card_block_id,
      "schedule.isAllDay",
      intrinsic.values["schedule.isAllDay"],
    ),
    recurrence:
      recurrenceValue === null
        ? undefined
        : (recurrenceValue as RecurrenceConfig),
    reminders: requireReminderArray(
      row.card_block_id,
      intrinsic.values["reminders.config"],
    ),
    scheduleTimezone:
      requireNullableString(
        row.card_block_id,
        "schedule.timezone",
        intrinsic.values["schedule.timezone"],
      ) ?? undefined,
    assignee: assignee ?? undefined,
    agentBlocked: requireBoolean(
      row.card_block_id,
      "agent.blocked",
      intrinsic.values["agent.blocked"],
    ),
    agentStatus: agentStatus ?? undefined,
    runInTarget: runTarget,
    runInLocalPath:
      requireNullableString(
        row.card_block_id,
        "run.localPath",
        intrinsic.values["run.localPath"],
      ) ?? undefined,
    runInBaseBranch:
      requireNullableString(
        row.card_block_id,
        "run.baseBranch",
        intrinsic.values["run.baseBranch"],
      ) ?? undefined,
    runInWorktreePath:
      requireNullableString(
        row.card_block_id,
        "run.worktreePath",
        intrinsic.values["run.worktreePath"],
      ) ?? undefined,
    runInEnvironmentPath:
      requireNullableString(
        row.card_block_id,
        "run.environmentPath",
        intrinsic.values["run.environmentPath"],
      ) ?? undefined,
    revision: row.metadata_revision,
    created: new Date(row.block_created_at),
    order: row.view_order as number,
  };
  try {
    assertValidCardInput(
      {
        priority: card.priority,
        estimate: card.estimate,
        tags: card.tags,
        dueDate: card.dueDate,
        scheduledStart: card.scheduledStart,
        scheduledEnd: card.scheduledEnd,
        isAllDay: card.isAllDay,
        recurrence: card.recurrence,
        reminders: card.reminders,
        scheduleTimezone: card.scheduleTimezone,
        assignee: card.assignee,
        agentBlocked: card.agentBlocked,
        agentStatus: card.agentStatus,
        runInTarget: card.runInTarget,
        runInLocalPath: card.runInLocalPath,
        runInBaseBranch: card.runInBaseBranch,
        runInWorktreePath: card.runInWorktreePath,
        runInEnvironmentPath: card.runInEnvironmentPath,
      },
      "update",
    );
  } catch (error) {
    throw new CardReadStoreError(
      "card_property_invalid",
      `Card ${row.card_block_id} has invalid relational metadata`,
      { cause: error },
    );
  }

  return {
    row,
    content,
    compatibilityError: null,
    databaseValues: database.values,
    intrinsicValues: intrinsic.values,
    propertyRevisions: {
      database: database.revisions,
      intrinsic: intrinsic.revisions,
    },
    card,
  };
};

const requireCompatibilityCard = (assembled: AssembledCard): Card => {
  if (assembled.card) return assembled.card;
  if (assembled.compatibilityError === "card_view_position_invalid") {
    return throwReadError(
      "card_view_position_invalid",
      assembled.row.card_block_id,
      "has no position in its Database primary Kanban view",
    );
  }
  return throwReadError(
    "card_database_membership_missing",
    assembled.row.card_block_id,
    "has no active Database membership for the legacy Card adapter",
  );
};

const requireCompatibilitySummary = (assembled: AssembledCard): CardSummary => {
  const card = requireCompatibilityCard(assembled);
  const { description: ignoredDescription, ...summary } = card;
  void ignoredDescription;
  return {
    ...summary,
    ...summarizeCardDescription(card.description),
  };
};

const canRefreshProjection = (assembled: AssembledCard): boolean => {
  const { row, content } = assembled;
  if (
    row.document_readiness !== "ready" ||
    row.document_generation === null ||
    row.document_head_seq === null ||
    row.document_schema_version === null ||
    row.materialization_generation !== row.document_generation ||
    row.materialization_projected_seq !== row.document_head_seq ||
    row.materialization_schema_version !== row.document_schema_version
  ) {
    return false;
  }
  return (
    row.materialized_title === content.title &&
    row.materialized_nfm === content.description &&
    row.materialized_preview === content.preview
  );
};

const refreshDisposableProjection = (
  database: Database.Database,
  assembled: AssembledCard,
): void => {
  const { row, content } = assembled;
  if (!canRefreshProjection(assembled)) {
    database
      .prepare(
        `
      DELETE FROM card_read_model WHERE card_block_id = ?
    `,
      )
      .run(row.card_block_id);
    return;
  }

  const updatedAt = new Date().toISOString();
  database
    .prepare(
      `
    INSERT INTO card_read_model (
      card_block_id, project_id, lifecycle, location_kind,
      containing_document_id, top_level_rank_key,
      location_revision, metadata_revision,
      document_id, document_generation, document_projected_seq,
      document_schema_version, document_authority,
      membership_id, database_block_id, view_id, view_group_key, view_rank_key,
      title, description_preview, description_length, has_description,
      database_values_json, intrinsic_properties_json, property_revisions_json,
      projection_version, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, 1, ?, ?
    )
    ON CONFLICT(card_block_id) DO UPDATE SET
      project_id = excluded.project_id,
      lifecycle = excluded.lifecycle,
      location_kind = excluded.location_kind,
      containing_document_id = excluded.containing_document_id,
      top_level_rank_key = excluded.top_level_rank_key,
      location_revision = excluded.location_revision,
      metadata_revision = excluded.metadata_revision,
      document_id = excluded.document_id,
      document_generation = excluded.document_generation,
      document_projected_seq = excluded.document_projected_seq,
      document_schema_version = excluded.document_schema_version,
      document_authority = excluded.document_authority,
      membership_id = excluded.membership_id,
      database_block_id = excluded.database_block_id,
      view_id = excluded.view_id,
      view_group_key = excluded.view_group_key,
      view_rank_key = excluded.view_rank_key,
      title = excluded.title,
      description_preview = excluded.description_preview,
      description_length = excluded.description_length,
      has_description = excluded.has_description,
      database_values_json = excluded.database_values_json,
      intrinsic_properties_json = excluded.intrinsic_properties_json,
      property_revisions_json = excluded.property_revisions_json,
      projection_version = excluded.projection_version,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `,
    )
    .run(
      row.card_block_id,
      row.project_id,
      row.lifecycle,
      row.location_kind,
      row.containing_document_id,
      row.top_level_rank_key,
      row.location_revision,
      row.metadata_revision,
      row.document_id,
      row.document_generation,
      row.document_head_seq,
      row.document_schema_version,
      row.document_authority,
      row.membership_id,
      row.database_block_id,
      row.view_id,
      row.view_group_key,
      row.view_rank_key,
      content.title,
      content.preview,
      content.length,
      content.hasDescription ? 1 : 0,
      JSON.stringify(assembled.databaseValues),
      JSON.stringify(assembled.intrinsicValues),
      JSON.stringify(assembled.propertyRevisions),
      row.block_created_at,
      updatedAt,
    );
};

const assembleRows = (
  database: Database.Database,
  rows: readonly CardAuthorityRow[],
): AssembledCard[] => {
  const cardIds = rows.map((row) => row.card_block_id);
  const databaseProperties = indexProperties(
    readDatabasePropertyRows(database, cardIds),
  );
  const intrinsicProperties = indexProperties(
    readIntrinsicPropertyRows(database, cardIds),
  );

  return rows.map((row) =>
    assembleCard(row, databaseProperties, intrinsicProperties),
  );
};

const readRowsByIds = (
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
): CardAuthorityRow[] => {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
    ${CARD_AUTHORITY_SELECT}
      AND card.project_id = ?
      AND card.lifecycle <> 'deleted'
      AND card.id IN (${placeholders})
  `,
    )
    .all(projectId, ...cardIds) as CardAuthorityRow[];
};

const readRowsByGlobalIds = (
  database: Database.Database,
  cardIds: readonly string[],
): CardAuthorityRow[] => {
  if (cardIds.length === 0) return [];
  const placeholders = cardIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
    ${CARD_AUTHORITY_SELECT}
      AND card.lifecycle <> 'deleted'
      AND card.id IN (${placeholders})
  `,
    )
    .all(...cardIds) as CardAuthorityRow[];
};

export function readAuthoritativeCardById(
  database: Database.Database,
  projectId: string,
  cardId: string,
): Card | null {
  return database.transaction(() => {
    const row = readRowsByIds(database, projectId, [cardId])[0];
    if (!row) return null;
    const assembled = assembleRows(database, [row])[0];
    return assembled ? requireCompatibilityCard(assembled) : null;
  })();
}

export function readAuthoritativeCardsByIds(
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
): Card[] {
  return database.transaction(() => {
    const uniqueCardIds = Array.from(new Set(cardIds));
    const rows = readRowsByIds(database, projectId, uniqueCardIds).filter(
      (row) => row.lifecycle === "active",
    );
    const cardsById = new Map(
      assembleRows(database, rows).map((assembled) => {
        const card = requireCompatibilityCard(assembled);
        return [card.id, card] as const;
      }),
    );
    return uniqueCardIds.flatMap((cardId) => {
      const card = cardsById.get(cardId);
      return card ? [card] : [];
    });
  })();
}

export function readAuthoritativeProjectCards(
  database: Database.Database,
  projectId: string,
): Card[] {
  return database.transaction(() => {
    const rows = database
      .prepare(
        `
      ${CARD_AUTHORITY_SELECT}
        AND card.project_id = ?
        AND card.lifecycle = 'active'
    `,
      )
      .all(projectId) as CardAuthorityRow[];
    return assembleRows(
      database,
      rows.filter((row) => row.membership_id !== null),
    )
      .map(requireCompatibilityCard)
      .sort((left, right) => {
        if (left.status !== right.status)
          return left.status.localeCompare(right.status);
        if (left.order !== right.order) return left.order - right.order;
        return left.id.localeCompare(right.id);
      });
  })();
}

export function readAuthoritativeCardColumn(
  database: Database.Database,
  projectId: string,
  status: CardStatus,
): Card[] {
  return readAuthoritativeProjectCards(database, projectId)
    .filter((card) => card.status === status)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
}

export interface AuthoritativeCardDocumentSummary {
  readonly projectId: string;
  readonly cardId: string;
  readonly status: CardStatus;
  readonly summary: CardSummary;
}

export function readAuthoritativeCardSummaryById(
  database: Database.Database,
  cardId: string,
): CardSummary | null {
  return database.transaction(() => {
    const row = readRowsByGlobalIds(database, [cardId])[0];
    if (!row) return null;
    const assembled = assembleRows(database, [row])[0];
    return assembled ? requireCompatibilitySummary(assembled) : null;
  })();
}

export function readAuthoritativeCardSummariesByIds(
  database: Database.Database,
  cardIds: readonly string[],
): CardSummary[] {
  return database.transaction(() => {
    const uniqueCardIds = Array.from(new Set(cardIds));
    const summariesById = new Map(
      assembleRows(database, readRowsByGlobalIds(database, uniqueCardIds)).map(
        (assembled) => {
          const summary = requireCompatibilitySummary(assembled);
          return [summary.id, summary] as const;
        },
      ),
    );
    return cardIds.flatMap((cardId) => {
      const summary = summariesById.get(cardId);
      return summary ? [summary] : [];
    });
  })();
}

export function readAuthoritativeProjectCardSummaries(
  database: Database.Database,
  projectId: string,
): CardSummary[] {
  return database.transaction(() => {
    const rows = database
      .prepare(
        `
      ${CARD_AUTHORITY_SELECT}
        AND card.project_id = ?
        AND card.lifecycle = 'active'
    `,
      )
      .all(projectId) as CardAuthorityRow[];
    return assembleRows(
      database,
      rows.filter((row) => row.membership_id !== null),
    )
      .map(requireCompatibilitySummary)
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status.localeCompare(right.status);
        }
        if (left.order !== right.order) return left.order - right.order;
        return left.id.localeCompare(right.id);
      });
  })();
}

export function readAuthoritativeCardSummaryColumn(
  database: Database.Database,
  projectId: string,
  status: CardStatus,
): CardSummary[] {
  return readAuthoritativeProjectCardSummaries(database, projectId)
    .filter((card) => card.status === status)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
}

export function readAuthoritativeCardSummaryByDocumentId(
  database: Database.Database,
  documentId: string,
): AuthoritativeCardDocumentSummary | null {
  return database.transaction(() => {
    const row = database
      .prepare(
        `
      ${CARD_AUTHORITY_SELECT}
        AND document.id = ?
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
      LIMIT 1
    `,
      )
      .get(documentId) as CardAuthorityRow | undefined;
    if (!row) return null;
    const assembled = assembleRows(database, [row])[0];
    if (!assembled) return null;
    const summary = requireCompatibilitySummary(assembled);
    return {
      projectId: row.project_id,
      cardId: summary.id,
      status: summary.status,
      summary,
    };
  })();
}

/**
 * Rebuild the disposable Card summary projection from current authorities.
 *
 * This function intentionally is not called by public reads. The unified
 * SQLite mutation writer owns when it is invoked and the surrounding
 * transaction, which keeps read APIs side-effect-free and prevents this cache
 * from becoming an accidental authority.
 */
export function rebuildCardReadModelProjection(
  database: Database.Database,
  projectId: string,
  cardIds: readonly string[],
): void {
  const uniqueCardIds = Array.from(new Set(cardIds));
  const rows = readRowsByIds(database, projectId, uniqueCardIds);
  const assembledById = new Map(
    assembleRows(database, rows).map(
      (assembled) => [assembled.row.card_block_id, assembled] as const,
    ),
  );

  for (const cardId of uniqueCardIds) {
    const assembled = assembledById.get(cardId);
    if (assembled) {
      refreshDisposableProjection(database, assembled);
      continue;
    }
    database
      .prepare(
        `
      DELETE FROM card_read_model WHERE card_block_id = ? AND project_id = ?
    `,
      )
      .run(cardId, projectId);
  }
}
