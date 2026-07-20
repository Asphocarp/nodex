import type Database from "better-sqlite3";
import type {
  DatabasePage,
  DatabasePageSummary,
  Estimate,
  Priority,
  RecurrenceConfig,
  ReminderConfig,
} from "../../shared/types";
import { isWorkflowStatus, type WorkflowStatus } from "../../shared/workflow-status";
import { upgradeLegacyWorkflowStatus } from "../../shared/workflow-status-cutover";
import { summarizePageDescription } from "../../shared/page-summary";
import { assertValidPageInput } from "../../shared/page-input-validation";
import {
  canonicalizePortableRichText,
  portableRichTextPlainText,
  type PortableRichText,
} from "../../shared/block-documents/portable-rich-text";

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

export type PageReadStoreErrorCode =
  | "page_document_missing"
  | "page_materialization_stale"
  | "page_database_membership_missing"
  | "page_database_property_missing"
  | "page_intrinsic_property_missing"
  | "page_property_invalid"
  | "page_view_position_invalid";

export class PageReadStoreError extends Error {
  constructor(
    readonly code: PageReadStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PageReadStoreError";
  }
}

interface PageAuthorityRow {
  readonly page_block_id: string;
  readonly project_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
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
  readonly materialized_title_rich_json: string | null;
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
  readonly page_block_id: string;
  readonly property_key: string;
  readonly value_type: string;
  readonly config_json: string;
  readonly value_json: string | null;
  readonly revision: number | null;
}

interface ParsedPropertyValue {
  readonly value: unknown;
  readonly revision: number;
}

interface PageContent {
  readonly title: string;
  readonly richTitle: PortableRichText;
  readonly description: string;
  readonly preview: string;
  readonly length: number;
  readonly hasDescription: boolean;
}

interface AssembledPage {
  readonly page: DatabasePage | null;
  readonly databaseRowError: "page_database_membership_missing" | null;
  readonly row: PageAuthorityRow;
  readonly content: PageContent;
  readonly databaseValues: Readonly<
    Partial<Record<DatabasePropertyKey, unknown>>
  >;
  readonly intrinsicValues: Readonly<Record<IntrinsicPropertyKey, unknown>>;
  readonly propertyRevisions: Readonly<{
    database: Readonly<Partial<Record<DatabasePropertyKey, number>>>;
    intrinsic: Readonly<Record<IntrinsicPropertyKey, number>>;
  }>;
}

const PAGE_AUTHORITY_SELECT = `
  WITH ranked_primary_positions AS (
    SELECT
      view.database_block_id,
      view.data_source_id,
      view.id AS view_id,
      position.page_block_id,
      position.group_key,
      position.rank_key,
      CAST(
        ROW_NUMBER() OVER (
          PARTITION BY view.id, position.group_key
          ORDER BY position.rank_key, position.page_block_id
        ) - 1 AS INTEGER
      ) AS view_order
    FROM database_views view
    INNER JOIN database_containers container
      ON container.default_view_id = view.id
      AND container.block_id = view.database_block_id
    INNER JOIN database_view_page_positions position
      ON position.view_id = view.id
    WHERE view.kind = 'kanban'
      AND view.lifecycle = 'active'
  ), active_source_memberships AS (
    SELECT
      membership.id,
      membership.data_source_id,
      membership.page_block_id,
      source.home_database_block_id AS database_block_id
    FROM data_source_page_memberships membership
    INNER JOIN data_sources source ON source.id = membership.data_source_id
    WHERE membership.removed_at IS NULL
  )
  SELECT
    page.id AS page_block_id,
    page.project_id,
    page.lifecycle,
    page.location_kind,
    page.containing_document_id,
    page.containing_database_id,
    page.location_revision,
    page.metadata_revision,
    page.created_at AS block_created_at,
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
    materialization.title_rich_json AS materialized_title_rich_json,
    materialization.nfm AS materialized_nfm,
    materialization.preview AS materialized_preview,
    materialization.updated_at AS materialization_updated_at,
    membership.id AS membership_id,
    membership.database_block_id,
    position.view_id,
    position.group_key AS view_group_key,
    position.rank_key AS view_rank_key,
    position.view_order
  FROM blocks page
  LEFT JOIN top_level_block_placements placement
    ON placement.block_id = page.id
    AND placement.project_id = page.project_id
  LEFT JOIN block_documents ownership
    ON ownership.block_id = page.id
    AND ownership.project_id = page.project_id
  LEFT JOIN documents document
    ON document.id = ownership.document_id
    AND document.project_id = ownership.project_id
  LEFT JOIN document_materializations materialization
    ON materialization.document_id = document.id
  LEFT JOIN active_source_memberships membership
    ON membership.page_block_id = page.id
    AND page.location_kind = 'database'
    AND page.containing_database_id = membership.database_block_id
  LEFT JOIN ranked_primary_positions position
    ON position.database_block_id = membership.database_block_id
    AND position.data_source_id = membership.data_source_id
    AND position.page_block_id = page.id
  WHERE page.type = 'page'
`;

// Release migrations before v69 rebuild the Page projection before canonical
// Data Source tables exist. Keep that historical reader isolated here; schema
// v81 runtime always selects PAGE_AUTHORITY_SELECT.
const LEGACY_PAGE_AUTHORITY_SELECT = `
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
      AND view.lifecycle = 'active'
  )
  SELECT
    page.id AS page_block_id,
    page.project_id,
    page.lifecycle,
    page.location_kind,
    page.containing_document_id,
    page.containing_database_id,
    page.location_revision,
    page.metadata_revision,
    page.created_at AS block_created_at,
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
    materialization.title_rich_json AS materialized_title_rich_json,
    materialization.nfm AS materialized_nfm,
    materialization.preview AS materialized_preview,
    materialization.updated_at AS materialization_updated_at,
    membership.id AS membership_id,
    membership.database_block_id,
    position.view_id,
    position.group_key AS view_group_key,
    position.rank_key AS view_rank_key,
    position.view_order
  FROM blocks page
  LEFT JOIN top_level_block_placements placement
    ON placement.block_id = page.id
    AND placement.project_id = page.project_id
  LEFT JOIN block_documents ownership
    ON ownership.block_id = page.id
    AND ownership.project_id = page.project_id
  LEFT JOIN documents document
    ON document.id = ownership.document_id
    AND document.project_id = ownership.project_id
  LEFT JOIN document_materializations materialization
    ON materialization.document_id = document.id
  LEFT JOIN database_memberships membership
    ON membership.page_block_id = page.id
    AND membership.project_id = page.project_id
    AND page.location_kind = 'database'
    AND page.containing_database_id = membership.database_block_id
    AND membership.removed_at IS NULL
  LEFT JOIN ranked_primary_positions position
    ON position.database_block_id = membership.database_block_id
    AND position.block_id = page.id
  WHERE page.type = 'page'
`;

const tableExists = (
  database: Database.Database,
  tableName: string,
): boolean =>
  database.prepare(`
    SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?
  `).get(tableName) !== undefined;

const hasCanonicalDataSourceAuthority = (
  database: Database.Database,
): boolean =>
  Number(database.pragma("user_version", { simple: true })) >= 81 &&
  tableExists(database, "data_source_page_memberships");

const pageAuthoritySelect = (database: Database.Database): string =>
  hasCanonicalDataSourceAuthority(database)
    ? PAGE_AUTHORITY_SELECT
    : LEGACY_PAGE_AUTHORITY_SELECT;

const projectDatabaseAuthoritySubquery = (
  database: Database.Database,
): string =>
  hasCanonicalDataSourceAuthority(database)
    ? `SELECT binding.database_block_id
       FROM project_database_bindings binding
       WHERE binding.project_id = ? AND binding.lifecycle = 'active'
       LIMIT 1`
    : `SELECT capability.block_id
       FROM database_capabilities capability
       WHERE capability.project_id = ? AND capability.is_primary = 1
       LIMIT 1`;

const UNPOSITIONED_PAGE_ORDER = Number.MAX_SAFE_INTEGER;

const DATABASE_PROPERTY_PLACEHOLDERS = DATABASE_PROPERTY_KEYS.map(
  () => "?",
).join(", ");
const INTRINSIC_PROPERTY_PLACEHOLDERS = INTRINSIC_PROPERTY_KEYS.map(
  () => "?",
).join(", ");

const throwReadError = (
  code: PageReadStoreErrorCode,
  pageId: string,
  detail: string,
): never => {
  throw new PageReadStoreError(code, `Page ${pageId} ${detail}`);
};

const resolveCompatibilityTagNames = (
  row: PropertyValueRow,
  value: unknown,
): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return throwReadError(
      "page_property_invalid",
      row.page_block_id,
      "property tags must be an array of registered option identities",
    );
  }
  let config: unknown;
  try {
    config = JSON.parse(row.config_json) as unknown;
  } catch (error) {
    throw new PageReadStoreError(
      "page_property_invalid",
      `Page ${row.page_block_id} tags Property has invalid configuration JSON`,
      { cause: error },
    );
  }
  const options =
    typeof config === "object" && config !== null && !Array.isArray(config)
      ? (config as Readonly<Record<string, unknown>>).options
      : undefined;
  if (!Array.isArray(options)) {
    return throwReadError(
      "page_property_invalid",
      row.page_block_id,
      "tags Property has no option registry",
    );
  }
  const namesById = new Map<string, string>();
  for (const candidate of options) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return throwReadError(
        "page_property_invalid",
        row.page_block_id,
        "tags Property contains an invalid option",
      );
    }
    const option = candidate as Readonly<Record<string, unknown>>;
    if (typeof option.id !== "string" || typeof option.name !== "string") {
      return throwReadError(
        "page_property_invalid",
        row.page_block_id,
        "tags Property contains an invalid option",
      );
    }
    namesById.set(option.id, option.name);
  }
  return (value as readonly string[]).map((optionId) => {
    const name = namesById.get(optionId);
    if (name !== undefined) return name;
    // v80 can contain literal labels from the historical Page creation path.
    // Schema v81 closes that write path before this fallback is removed.
    return optionId;
  }).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
};

const parseJsonValue = (row: PropertyValueRow): ParsedPropertyValue => {
  if (row.value_json === null || row.revision === null) {
    return throwReadError(
      row.property_key.includes(".")
        ? "page_intrinsic_property_missing"
        : "page_database_property_missing",
      row.page_block_id,
      `is missing relational property ${row.property_key}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value_json) as unknown;
  } catch (error) {
    throw new PageReadStoreError(
      "page_property_invalid",
      `Page ${row.page_block_id} property ${row.property_key} is not valid JSON`,
      { cause: error },
    );
  }
  return {
    value:
      row.property_key === "tags"
        ? resolveCompatibilityTagNames(row, parsed)
        : parsed,
    revision: row.revision,
  };
};

const readDatabasePropertyRows = (
  database: Database.Database,
  pageIds: readonly string[],
): PropertyValueRow[] => {
  if (pageIds.length === 0) return [];
  const pagePlaceholders = pageIds.map(() => "?").join(", ");
  if (!hasCanonicalDataSourceAuthority(database)) {
    return database
      .prepare(
        `
      SELECT
        membership.page_block_id,
        property.key AS property_key,
        property.value_type,
        property.config_json,
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
        AND membership.page_block_id IN (${pagePlaceholders})
    `,
      )
      .all(...DATABASE_PROPERTY_KEYS, ...pageIds) as PropertyValueRow[];
  }
  return database
    .prepare(
      `
    SELECT
      membership.page_block_id,
      property.id AS property_key,
      property.value_type,
      property.config_json,
      value.value_json,
      value.revision
    FROM data_source_page_memberships membership
    INNER JOIN data_source_properties property
      ON property.data_source_id = membership.data_source_id
      AND property.lifecycle = 'active'
      AND property.id IN (${DATABASE_PROPERTY_PLACEHOLDERS})
    LEFT JOIN data_source_property_values value
      ON value.membership_id = membership.id
      AND value.property_id = property.id
      AND value.data_source_id = membership.data_source_id
    WHERE membership.removed_at IS NULL
      AND membership.page_block_id IN (${pagePlaceholders})
  `,
    )
    .all(...DATABASE_PROPERTY_KEYS, ...pageIds) as PropertyValueRow[];
};

const readIntrinsicPropertyRows = (
  database: Database.Database,
  pageIds: readonly string[],
): PropertyValueRow[] => {
  if (pageIds.length === 0) return [];
  const pagePlaceholders = pageIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
    SELECT
      block_id AS page_block_id,
      property_key,
      value_type,
      '{}' AS config_json,
      value_json,
      revision
    FROM block_properties
    WHERE property_key IN (${INTRINSIC_PROPERTY_PLACEHOLDERS})
      AND block_id IN (${pagePlaceholders})
  `,
    )
    .all(...INTRINSIC_PROPERTY_KEYS, ...pageIds) as PropertyValueRow[];
};

const indexProperties = (
  rows: readonly PropertyValueRow[],
): ReadonlyMap<string, ReadonlyMap<string, ParsedPropertyValue>> => {
  const indexed = new Map<string, Map<string, ParsedPropertyValue>>();
  for (const row of rows) {
    const pageProperties = indexed.get(row.page_block_id) ?? new Map();
    pageProperties.set(row.property_key, parseJsonValue(row));
    indexed.set(row.page_block_id, pageProperties);
  }
  return indexed;
};

const requireProperties = <Key extends string>(
  pageId: string,
  indexed: ReadonlyMap<string, ReadonlyMap<string, ParsedPropertyValue>>,
  keys: readonly Key[],
  missingCode: PageReadStoreErrorCode,
): {
  readonly values: Readonly<Record<Key, unknown>>;
  readonly revisions: Readonly<Record<Key, number>>;
} => {
  const pageProperties = indexed.get(pageId);
  const values = {} as Record<Key, unknown>;
  const revisions = {} as Record<Key, number>;

  for (const key of keys) {
    const property = pageProperties?.get(key);
    if (!property) {
      return throwReadError(
        missingCode,
        pageId,
        `is missing relational property ${key}`,
      );
    }
    values[key] = property.value;
    revisions[key] = property.revision;
  }

  return { values, revisions };
};

const requireNullableString = (
  pageId: string,
  key: string,
  value: unknown,
): string | null => {
  if (value === null || typeof value === "string") return value;
  return throwReadError(
    "page_property_invalid",
    pageId,
    `property ${key} must be a string or null`,
  );
};

const requireBoolean = (
  pageId: string,
  key: string,
  value: unknown,
): boolean => {
  if (typeof value === "boolean") return value;
  return throwReadError(
    "page_property_invalid",
    pageId,
    `property ${key} must be a boolean`,
  );
};

const requireStringArray = (
  pageId: string,
  key: string,
  value: unknown,
): string[] => {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return throwReadError(
    "page_property_invalid",
    pageId,
    `property ${key} must be an array of strings`,
  );
};

const requireReminderArray = (
  pageId: string,
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
    "page_property_invalid",
    pageId,
    "property reminders.config must be an array of reminders",
  );
};

const optionalDate = (
  pageId: string,
  key: string,
  value: unknown,
): Date | undefined => {
  const text = requireNullableString(pageId, key, value);
  if (text === null) return undefined;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return throwReadError(
    "page_property_invalid",
    pageId,
    `property ${key} is not a valid date`,
  );
};

const resolvePageContent = (row: PageAuthorityRow): PageContent => {
  if (!row.document_id || !row.document_authority) {
    return throwReadError(
      "page_document_missing",
      row.page_block_id,
      "has no owned Document",
    );
  }

  if (row.document_authority !== "ydoc_primary") {
    return throwReadError(
      "page_document_missing",
      row.page_block_id,
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
    typeof row.materialized_title_rich_json === "string" &&
    typeof row.materialized_nfm === "string" &&
    typeof row.materialized_preview === "string";
  if (!isCurrentMaterialization) {
    return throwReadError(
      "page_materialization_stale",
      row.page_block_id,
      "does not have a materialization for its current Y.Doc head",
    );
  }

  let richTitle: PortableRichText;
  try {
    richTitle = canonicalizePortableRichText(
      JSON.parse(row.materialized_title_rich_json as string),
    );
  } catch (error) {
    return throwReadError(
      "page_materialization_stale",
      row.page_block_id,
      `has an invalid rich title projection: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (portableRichTextPlainText(richTitle) !== row.materialized_title) {
    return throwReadError(
      "page_materialization_stale",
      row.page_block_id,
      "has divergent rich and plain title projections",
    );
  }

  return {
    title: row.materialized_title as string,
    richTitle,
    description: row.materialized_nfm as string,
    preview: row.materialized_preview as string,
    length: (row.materialized_nfm as string).length,
    hasDescription: (row.materialized_nfm as string).trim().length > 0,
  };
};

const assemblePage = (
  row: PageAuthorityRow,
  databaseProperties: ReadonlyMap<
    string,
    ReadonlyMap<string, ParsedPropertyValue>
  >,
  intrinsicProperties: ReadonlyMap<
    string,
    ReadonlyMap<string, ParsedPropertyValue>
  >,
  allowLegacyWorkflowStatus: boolean,
): AssembledPage => {
  const intrinsic = requireProperties(
    row.page_block_id,
    intrinsicProperties,
    INTRINSIC_PROPERTY_KEYS,
    "page_intrinsic_property_missing",
  );
  const content = resolvePageContent(row);
  if (!row.membership_id || !row.database_block_id) {
    return {
      row,
      content,
      page: null,
      databaseRowError: "page_database_membership_missing",
      databaseValues: {},
      intrinsicValues: intrinsic.values,
      propertyRevisions: {
        database: {},
        intrinsic: intrinsic.revisions,
      },
    };
  }

  const database = requireProperties(
    row.page_block_id,
    databaseProperties,
    DATABASE_PROPERTY_KEYS,
    "page_database_property_missing",
  );
  const storedStatusValue = database.values.status;
  const statusValue = isWorkflowStatus(storedStatusValue)
    ? storedStatusValue
    : allowLegacyWorkflowStatus
      ? upgradeLegacyWorkflowStatus(storedStatusValue)
      : null;
  if (statusValue === null) {
    return throwReadError(
      "page_property_invalid",
      row.page_block_id,
      "property status is not a Page status",
    );
  }
  const hasViewPosition = row.view_id !== null;
  const hasCompleteViewPosition =
    hasViewPosition &&
    row.view_group_key !== null &&
    row.view_rank_key !== null &&
    row.view_order !== null;
  if (hasViewPosition && !hasCompleteViewPosition) {
    return throwReadError(
      "page_view_position_invalid",
      row.page_block_id,
      "has an incomplete primary View position",
    );
  }
  const comparableViewGroupKey = allowLegacyWorkflowStatus
    ? upgradeLegacyWorkflowStatus(row.view_group_key) ?? row.view_group_key
    : row.view_group_key;
  if (hasCompleteViewPosition && comparableViewGroupKey !== statusValue) {
    return throwReadError(
      "page_view_position_invalid",
      row.page_block_id,
      "has a view group that disagrees with its status property",
    );
  }

  const priority = requireNullableString(
    row.page_block_id,
    "priority",
    database.values.priority,
  );
  const estimate = requireNullableString(
    row.page_block_id,
    "estimate",
    database.values.estimate,
  );
  const assignee = requireNullableString(
    row.page_block_id,
    "assignee",
    database.values.assignee,
  );
  const runTarget = requireNullableString(
    row.page_block_id,
    "run.target",
    intrinsic.values["run.target"],
  );
  if (
    runTarget !== "localProject" &&
    runTarget !== "newWorktree" &&
    runTarget !== "cloud"
  ) {
    return throwReadError(
      "page_property_invalid",
      row.page_block_id,
      "property run.target is invalid",
    );
  }

  const recurrenceValue = intrinsic.values["recurrence.config"];
  if (
    recurrenceValue !== null &&
    (typeof recurrenceValue !== "object" || Array.isArray(recurrenceValue))
  ) {
    return throwReadError(
      "page_property_invalid",
      row.page_block_id,
      "property recurrence.config must be an object or null",
    );
  }

  const page: DatabasePage = {
    id: row.page_block_id,
    status: statusValue,
    archived: row.lifecycle === "archived",
    title: content.title,
    richTitle: content.richTitle,
    description: content.description,
    priority: priority === null ? undefined : (priority as Priority),
    estimate: estimate === null ? undefined : (estimate as Estimate),
    tags: requireStringArray(row.page_block_id, "tags", database.values.tags),
    dueDate: optionalDate(
      row.page_block_id,
      "due_date",
      database.values.due_date,
    ),
    scheduledStart: optionalDate(
      row.page_block_id,
      "scheduled_start",
      database.values.scheduled_start,
    ),
    scheduledEnd: optionalDate(
      row.page_block_id,
      "scheduled_end",
      database.values.scheduled_end,
    ),
    isAllDay: requireBoolean(
      row.page_block_id,
      "schedule.isAllDay",
      intrinsic.values["schedule.isAllDay"],
    ),
    recurrence:
      recurrenceValue === null
        ? undefined
        : (recurrenceValue as RecurrenceConfig),
    reminders: requireReminderArray(
      row.page_block_id,
      intrinsic.values["reminders.config"],
    ),
    scheduleTimezone:
      requireNullableString(
        row.page_block_id,
        "schedule.timezone",
        intrinsic.values["schedule.timezone"],
      ) ?? undefined,
    assignee: assignee ?? undefined,
    runInTarget: runTarget,
    runInLocalPath:
      requireNullableString(
        row.page_block_id,
        "run.localPath",
        intrinsic.values["run.localPath"],
      ) ?? undefined,
    runInBaseBranch:
      requireNullableString(
        row.page_block_id,
        "run.baseBranch",
        intrinsic.values["run.baseBranch"],
      ) ?? undefined,
    runInWorktreePath:
      requireNullableString(
        row.page_block_id,
        "run.worktreePath",
        intrinsic.values["run.worktreePath"],
      ) ?? undefined,
    runInEnvironmentPath:
      requireNullableString(
        row.page_block_id,
        "run.environmentPath",
        intrinsic.values["run.environmentPath"],
      ) ?? undefined,
    revision: row.metadata_revision,
    created: new Date(row.block_created_at),
    order: row.view_order ?? UNPOSITIONED_PAGE_ORDER,
  };
  try {
    assertValidPageInput(
      {
        priority: page.priority,
        estimate: page.estimate,
        tags: page.tags,
        dueDate: page.dueDate,
        scheduledStart: page.scheduledStart,
        scheduledEnd: page.scheduledEnd,
        isAllDay: page.isAllDay,
        recurrence: page.recurrence,
        reminders: page.reminders,
        scheduleTimezone: page.scheduleTimezone,
        assignee: page.assignee,
        runInTarget: page.runInTarget,
        runInLocalPath: page.runInLocalPath,
        runInBaseBranch: page.runInBaseBranch,
        runInWorktreePath: page.runInWorktreePath,
        runInEnvironmentPath: page.runInEnvironmentPath,
      },
      "update",
    );
  } catch (error) {
    throw new PageReadStoreError(
      "page_property_invalid",
      `Page ${row.page_block_id} has invalid relational metadata`,
      { cause: error },
    );
  }

  return {
    row,
    content,
    databaseRowError: null,
    databaseValues: database.values,
    intrinsicValues: intrinsic.values,
    propertyRevisions: {
      database: database.revisions,
      intrinsic: intrinsic.revisions,
    },
    page,
  };
};

const requireDatabaseRowPage = (assembled: AssembledPage): DatabasePage => {
  if (assembled.page) return assembled.page;
  return throwReadError(
    "page_database_membership_missing",
    assembled.row.page_block_id,
    "is not an active Database row",
  );
};

const requireDatabaseRowSummary = (assembled: AssembledPage): DatabasePageSummary => {
  const page = requireDatabaseRowPage(assembled);
  const { description: ignoredDescription, ...summary } = page;
  void ignoredDescription;
  return {
    ...summary,
    ...summarizePageDescription(page.description),
  };
};

const canRefreshProjection = (assembled: AssembledPage): boolean => {
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
  assembled: AssembledPage,
): void => {
  const { row, content } = assembled;
  if (!canRefreshProjection(assembled)) {
    database
      .prepare(
        `
      DELETE FROM page_read_model WHERE page_block_id = ?
    `,
      )
      .run(row.page_block_id);
    return;
  }

  const updatedAt = new Date().toISOString();
  database
    .prepare(
      `
    INSERT INTO page_read_model (
      page_block_id, project_id, lifecycle, location_kind,
      containing_document_id, containing_database_id, top_level_rank_key,
      location_revision, metadata_revision,
      document_id, document_generation, document_projected_seq,
      document_schema_version, document_authority,
      membership_id, database_block_id, view_id, view_group_key, view_rank_key,
      title, description_preview, description_length, has_description,
      database_values_json, intrinsic_properties_json, property_revisions_json,
      projection_version, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, 1, ?, ?
    )
    ON CONFLICT(page_block_id) DO UPDATE SET
      project_id = excluded.project_id,
      lifecycle = excluded.lifecycle,
      location_kind = excluded.location_kind,
      containing_document_id = excluded.containing_document_id,
      containing_database_id = excluded.containing_database_id,
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
      row.page_block_id,
      row.project_id,
      row.lifecycle,
      row.location_kind,
      row.containing_document_id,
      row.containing_database_id,
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
  rows: readonly PageAuthorityRow[],
): AssembledPage[] => {
  const pageIds = rows.map((row) => row.page_block_id);
  const databaseProperties = indexProperties(
    readDatabasePropertyRows(database, pageIds),
  );
  const intrinsicProperties = indexProperties(
    readIntrinsicPropertyRows(database, pageIds),
  );
  const allowLegacyWorkflowStatus = Number(
    database.pragma("user_version", { simple: true }),
  ) < 82;

  return rows.map((row) =>
    assemblePage(
      row,
      databaseProperties,
      intrinsicProperties,
      allowLegacyWorkflowStatus,
    ),
  );
};

const readRowsByIds = (
  database: Database.Database,
  projectId: string,
  pageIds: readonly string[],
): PageAuthorityRow[] => {
  if (pageIds.length === 0) return [];
  const placeholders = pageIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
    ${pageAuthoritySelect(database)}
      AND page.project_id = ?
      AND page.lifecycle <> 'deleted'
      AND page.id IN (${placeholders})
  `,
    )
    .all(projectId, ...pageIds) as PageAuthorityRow[];
};

const readRowsByGlobalIds = (
  database: Database.Database,
  pageIds: readonly string[],
): PageAuthorityRow[] => {
  if (pageIds.length === 0) return [];
  const placeholders = pageIds.map(() => "?").join(", ");
  return database
    .prepare(
      `
    ${pageAuthoritySelect(database)}
      AND page.lifecycle <> 'deleted'
      AND page.id IN (${placeholders})
  `,
    )
    .all(...pageIds) as PageAuthorityRow[];
};

export function readDatabasePageById(
  database: Database.Database,
  projectId: string,
  pageId: string,
): DatabasePage | null {
  return database.transaction(() => {
    const row = readRowsByIds(database, projectId, [pageId])[0];
    if (!row) return null;
    const assembled = assembleRows(database, [row])[0];
    return assembled ? requireDatabaseRowPage(assembled) : null;
  })();
}

export function readDatabasePagesByIds(
  database: Database.Database,
  projectId: string,
  pageIds: readonly string[],
): DatabasePage[] {
  return database.transaction(() => {
    const uniquePageIds = Array.from(new Set(pageIds));
    const rows = readRowsByIds(database, projectId, uniquePageIds).filter(
      (row) => row.lifecycle === "active",
    );
    const pagesById = new Map(
      assembleRows(database, rows).map((assembled) => {
        const page = requireDatabaseRowPage(assembled);
        return [page.id, page] as const;
      }),
    );
    return uniquePageIds.flatMap((pageId) => {
      const page = pagesById.get(pageId);
      return page ? [page] : [];
    });
  })();
}

export function readProjectDatabasePages(
  database: Database.Database,
  projectId: string,
): DatabasePage[] {
  return database.transaction(() => {
    const rows = database
      .prepare(
        `
      ${pageAuthoritySelect(database)}
        AND page.project_id = ?
        AND page.lifecycle = 'active'
        AND membership.database_block_id = (
          ${projectDatabaseAuthoritySubquery(database)}
        )
    `,
      )
      .all(projectId, projectId) as PageAuthorityRow[];
    return assembleRows(
      database,
      rows.filter((row) => row.membership_id !== null),
    )
      .map(requireDatabaseRowPage)
      .sort((left, right) => {
        if (left.status !== right.status)
          return left.status.localeCompare(right.status);
        if (left.order !== right.order) return left.order - right.order;
        return left.id.localeCompare(right.id);
      });
  })();
}

export function readDatabasePageColumn(
  database: Database.Database,
  projectId: string,
  status: WorkflowStatus,
): DatabasePage[] {
  return readProjectDatabasePages(database, projectId)
    .filter((page) => page.status === status)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
}

export interface DatabasePageDocumentSummary {
  readonly projectId: string;
  readonly pageId: string;
  readonly status: WorkflowStatus;
  readonly summary: DatabasePageSummary;
}

export function readDatabasePageSummaryById(
  database: Database.Database,
  pageId: string,
): DatabasePageSummary | null {
  return database.transaction(() => {
    const row = readRowsByGlobalIds(database, [pageId])[0];
    if (!row) return null;
    const assembled = assembleRows(database, [row])[0];
    return assembled ? requireDatabaseRowSummary(assembled) : null;
  })();
}

export function readDatabasePageSummariesByIds(
  database: Database.Database,
  pageIds: readonly string[],
): DatabasePageSummary[] {
  return database.transaction(() => {
    const uniquePageIds = Array.from(new Set(pageIds));
    const summariesById = new Map(
      assembleRows(database, readRowsByGlobalIds(database, uniquePageIds)).map(
        (assembled) => {
          const summary = requireDatabaseRowSummary(assembled);
          return [summary.id, summary] as const;
        },
      ),
    );
    return pageIds.flatMap((pageId) => {
      const summary = summariesById.get(pageId);
      return summary ? [summary] : [];
    });
  })();
}

export function readProjectDatabasePageSummaries(
  database: Database.Database,
  projectId: string,
): DatabasePageSummary[] {
  return database.transaction(() => {
    const rows = database
      .prepare(
        `
      ${pageAuthoritySelect(database)}
        AND page.project_id = ?
        AND page.lifecycle = 'active'
        AND membership.database_block_id = (
          ${projectDatabaseAuthoritySubquery(database)}
        )
    `,
      )
      .all(projectId, projectId) as PageAuthorityRow[];
    return assembleRows(
      database,
      rows.filter((row) => row.membership_id !== null),
    )
      .map(requireDatabaseRowSummary)
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status.localeCompare(right.status);
        }
        if (left.order !== right.order) return left.order - right.order;
        return left.id.localeCompare(right.id);
      });
  })();
}

export function readDatabasePageSummaryColumn(
  database: Database.Database,
  projectId: string,
  status: WorkflowStatus,
): DatabasePageSummary[] {
  return readProjectDatabasePageSummaries(database, projectId)
    .filter((page) => page.status === status)
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );
}

export function readDatabasePageSummaryByDocumentId(
  database: Database.Database,
  documentId: string,
): DatabasePageDocumentSummary | null {
  return database.transaction(() => {
    const row = database
      .prepare(
        `
      ${pageAuthoritySelect(database)}
        AND document.id = ?
        AND document.readiness = 'ready'
        AND document.authority = 'ydoc_primary'
      LIMIT 1
    `,
      )
      .get(documentId) as PageAuthorityRow | undefined;
    if (!row) return null;
    const assembled = assembleRows(database, [row])[0];
    if (!assembled) return null;
    const summary = requireDatabaseRowSummary(assembled);
    return {
      projectId: row.project_id,
      pageId: summary.id,
      status: summary.status,
      summary,
    };
  })();
}

/**
 * Rebuild the disposable DatabasePage summary projection from current authorities.
 *
 * This function intentionally is not called by public reads. The unified
 * SQLite mutation writer owns when it is invoked and the surrounding
 * transaction, which keeps read APIs side-effect-free and prevents this cache
 * from becoming an accidental authority.
 */
export function rebuildPageReadModelProjection(
  database: Database.Database,
  projectId: string,
  pageIds: readonly string[],
): void {
  const uniquePageIds = Array.from(new Set(pageIds));
  const rows = readRowsByIds(database, projectId, uniquePageIds);
  const assembledById = new Map(
    assembleRows(database, rows).map(
      (assembled) => [assembled.row.page_block_id, assembled] as const,
    ),
  );

  for (const pageId of uniquePageIds) {
    const assembled = assembledById.get(pageId);
    if (assembled) {
      refreshDisposableProjection(database, assembled);
      continue;
    }
    database
      .prepare(
        `
      DELETE FROM page_read_model WHERE page_block_id = ? AND project_id = ?
    `,
      )
      .run(pageId, projectId);
  }
}
