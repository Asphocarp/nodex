import type Database from "better-sqlite3";

import {
  BUILT_IN_DATA_SOURCE_PROPERTY_IDS,
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  type BuiltInDataSourcePropertyId,
  type InitialDatabaseIdentities,
} from "../../shared/database-identities";
import {
  parseDatabasePropertyConfig,
  parseDatabaseViewConfigV2,
  stableStringifyDatabaseJson,
  type DatabasePropertyValueType,
} from "../../shared/database-kernel";
import { assertUuidV7 } from "../../shared/uuid-v7";
import { WORKFLOW_STATUS_COLUMNS } from "../../shared/workflow-status";

const PRIMARY_DATABASE_SCHEMA_KEY = "nodex.database";
const FRACTIONAL_RANK_MAX = (1n << 128n) - 1n;

interface InitialPropertyDefinition {
  readonly propertyId: BuiltInDataSourcePropertyId;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, unknown>>;
}

const INITIAL_PROPERTY_DEFINITIONS: readonly InitialPropertyDefinition[] = [
  {
    propertyId: "status",
    name: "Status",
    valueType: "select",
    config: { options: WORKFLOW_STATUS_COLUMNS },
  },
  {
    propertyId: "priority",
    name: "Priority",
    valueType: "select",
    config: {
      options: [
        { id: "p0-critical", name: "P0 - Critical" },
        { id: "p1-high", name: "P1 - High" },
        { id: "p2-medium", name: "P2 - Medium" },
        { id: "p3-low", name: "P3 - Low" },
        { id: "p4-later", name: "P4 - Later" },
      ],
    },
  },
  {
    propertyId: "estimate",
    name: "Estimate",
    valueType: "select",
    config: {
      options: [
        { id: "xs", name: "XS" },
        { id: "s", name: "S" },
        { id: "m", name: "M" },
        { id: "l", name: "L" },
        { id: "xl", name: "XL" },
      ],
    },
  },
  {
    propertyId: "tags",
    name: "Tags",
    valueType: "multi_select",
    config: { options: [] },
  },
  { propertyId: "due_date", name: "Due date", valueType: "date", config: {} },
  {
    propertyId: "scheduled_start",
    name: "Scheduled start",
    valueType: "datetime",
    config: {},
  },
  {
    propertyId: "scheduled_end",
    name: "Scheduled end",
    valueType: "datetime",
    config: {},
  },
  { propertyId: "assignee", name: "Assignee", valueType: "person", config: {} },
];

const rankForOrdinal = (ordinal: number, total: number): string =>
  ((FRACTIONAL_RANK_MAX * BigInt(ordinal + 1)) / BigInt(total + 1))
    .toString(16)
    .padStart(32, "0");

const requireTimestamp = (value: string): string => {
  const timestamp = Date.parse(value);
  if (value === value.trim() && Number.isFinite(timestamp)) return value;
  throw new TypeError("now must be a canonical timestamp");
};

const requireName = (value: string): string => {
  const name = value.trim();
  if (name.length > 0 && name.length <= 256) return name;
  throw new TypeError("Database name must contain between 1 and 256 characters");
};

export interface CreateInitialDatabaseAuthorityInput {
  readonly projectId: string;
  readonly libraryId: string;
  readonly identities: InitialDatabaseIdentities;
  readonly now: string;
  readonly name?: string;
}

/**
 * Create one Project's initial Database authority after schema v82 is active.
 * The caller owns the surrounding Project transaction and preallocates all
 * retry-stable identities before entering it.
 */
export const createInitialDatabaseAuthorityInDatabase = (
  database: Database.Database,
  input: CreateInitialDatabaseAuthorityInput,
): InitialDatabaseIdentities => {
  if (!database.inTransaction) {
    throw new Error(
      "createInitialDatabaseAuthorityInDatabase requires an active transaction",
    );
  }
  const schemaVersion = database.pragma("user_version", { simple: true }) as number;
  if (schemaVersion !== 82) {
    throw new Error(
      `Initial Database authority requires schema v82, received v${schemaVersion}`,
    );
  }
  const projectId = input.projectId.trim();
  const libraryId = input.libraryId.trim();
  if (!projectId || !libraryId) {
    throw new TypeError("projectId and libraryId must be canonical identities");
  }
  const databaseId = parseDatabaseId(
    assertUuidV7(input.identities.databaseId, "databaseId"),
  );
  const dataSourceId = parseDataSourceId(
    assertUuidV7(input.identities.dataSourceId, "dataSourceId"),
  );
  const viewId = parseDatabaseViewId(
    assertUuidV7(input.identities.viewId, "viewId"),
  );
  const now = requireTimestamp(input.now);
  const name = requireName(input.name ?? "Cards");
  const project = database.prepare(`
    SELECT library_id, database_block_id FROM projects WHERE id = ?
  `).get(projectId) as
    | { readonly library_id: string; readonly database_block_id: string }
    | undefined;
  if (
    !project ||
    project.library_id !== libraryId ||
    project.database_block_id !== databaseId
  ) {
    throw new Error(
      "Project must persist the preallocated Database identity before authority creation",
    );
  }

  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'database', 'active', 'space', NULL, NULL, 1, 1, ?, ?)
  `).run(databaseId, projectId, now, now);
  database.prepare(`
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(databaseId, projectId, rankForOrdinal(0, 1), now, now);
  database.prepare(`
    INSERT INTO database_containers (
      block_id, library_id, name, lifecycle, default_view_id,
      access_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', NULL, 1, 1, ?, ?)
  `).run(databaseId, libraryId, name, now, now);
  database.prepare(`
    INSERT INTO data_sources (
      id, library_id, home_database_block_id, name, schema_key,
      schema_revision, lifecycle, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)
  `).run(
    dataSourceId,
    libraryId,
    databaseId,
    name,
    PRIMARY_DATABASE_SCHEMA_KEY,
    rankForOrdinal(0, 1),
    now,
    now,
  );

  const insertProperty = database.prepare(`
    INSERT INTO data_source_properties (
      data_source_id, id, name, value_type, config_json, rank_key,
      lifecycle, schema_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
  `);
  for (const [index, definition] of INITIAL_PROPERTY_DEFINITIONS.entries()) {
    const config = parseDatabasePropertyConfig(
      definition.valueType,
      definition.config,
    );
    insertProperty.run(
      dataSourceId,
      definition.propertyId,
      definition.name,
      definition.valueType,
      stableStringifyDatabaseJson(config),
      rankForOrdinal(index, INITIAL_PROPERTY_DEFINITIONS.length),
      now,
      now,
    );
  }

  const viewConfig = parseDatabaseViewConfigV2({
    schemaKey: "nodex.database-view",
    schemaVersion: 2,
    filter: { kind: "group", operator: "and", children: [] },
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
    group: { propertyId: "status" },
    display: {
      propertyIds: ["status", "priority", "estimate", "tags"],
      showTitle: true,
    },
  });
  database.prepare(`
    INSERT INTO database_views (
      id, database_block_id, data_source_id, name, kind, config_json,
      revision, rank_key, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, 'Kanban', 'kanban', ?, 1, ?, 'active', ?, ?)
  `).run(
    viewId,
    databaseId,
    dataSourceId,
    stableStringifyDatabaseJson(viewConfig),
    rankForOrdinal(0, 1),
    now,
    now,
  );
  database.prepare(`
    UPDATE database_containers SET default_view_id = ? WHERE block_id = ?
  `).run(viewId, databaseId);
  database.prepare(`
    INSERT INTO project_database_bindings (
      project_id, library_id, database_block_id, lifecycle, revision,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'active', 1, ?, ?)
  `).run(projectId, libraryId, databaseId, now, now);

  const propertyIds = database.prepare(`
    SELECT id FROM data_source_properties
    WHERE data_source_id = ? AND lifecycle = 'active' ORDER BY rank_key, id
  `).all(dataSourceId) as readonly { readonly id: string }[];
  if (
    propertyIds.length !== BUILT_IN_DATA_SOURCE_PROPERTY_IDS.length ||
    propertyIds.some(
      (row, index) => row.id !== BUILT_IN_DATA_SOURCE_PROPERTY_IDS[index],
    )
  ) {
    throw new Error("Initial Data Source Property authority is incomplete");
  }
  return { databaseId, dataSourceId, viewId };
};
