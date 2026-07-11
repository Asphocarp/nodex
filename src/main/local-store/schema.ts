import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { getDatabasePath } from "./config";
import { migrateLegacyDatabaseFileName } from "./database-file-migration";
import type { DatabaseMigrationProgress } from "../../shared/app-startup";
import { CARD_STATUS_COLUMNS } from "../../shared/card-status";
import {
  makeProjectSessionPanelLayout,
  normalizeProjectSessionPanelLayout,
  pruneEmptyProjectSessionPanelLeaves,
} from "../../shared/project-session-panel-layout";
import type { PanelId, ProjectSessionPanelLayout } from "../../shared/types";
import type { BlockTreeNode } from "../../shared/block-documents/block-document-codec";
import { deriveBlockDocumentRecordsFromNfm } from "../../shared/block-documents/derived-records";
import {
  parseGeneralDatabaseViewConfig,
  type DatabaseViewFilterNode,
} from "../../shared/database-kernel";
import {
  INITIAL_DATABASE_VIEW_SESSION_TITLE,
  insertDatabaseViewTab,
  insertInitialDatabaseViewSession,
  makeInitialDatabaseViewPanelStateJson,
} from "./project-session-defaults";

export const COLUMNS = CARD_STATUS_COLUMNS;

export const CURRENT_SCHEMA_VERSION = 67;
const MIGRATION_TARGETS = [
  31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
  51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67,
] as const;
const PROJECT_SESSION_TAB_KIND_CHECK_VALUES =
  "'db_view', 'card_stage', 'terminal', 'browser', 'review', 'files'";
const PROJECT_SESSION_TAB_KIND_CHECK_VALUES_V34 =
  "'db_view', 'card_stage', 'terminal', 'browser', 'review', 'files_placeholder'";
const PROJECT_SESSION_TAB_KIND_CHECK_VALUES_V33 =
  "'db_view', 'card_stage', 'terminal', 'browser', 'review', 'files_placeholder', 'side_chat_placeholder'";
const PROJECT_SESSION_PANEL_ID_CHECK_VALUES = "'right', 'bottom'";
const LEGACY_BROWSER_TAB_KIND = "browser_placeholder";
const DEFAULT_NO_THREAD_FALLBACK_TITLE = "New thread";

const RESETTABLE_TABLES = [
  "block_search_units_fts",
  "block_search_units",
  "block_asset_refs",
  "card_read_model",
  "document_versions",
  "block_mutations",
  "block_relocation_members",
  "block_relocation_source_states",
  "document_recovery_artifacts",
  "block_relocations",
  "change_log",
  "foreign_reference_migrations",
  "legacy_card_shadow_jobs",
  "legacy_card_shadow_heads",
  "database_view_positions",
  "database_views",
  "database_property_values",
  "database_memberships",
  "database_properties",
  "database_capabilities",
  "scheduled_card_index",
  "document_block_index",
  "document_materializations",
  "document_snapshots",
  "document_updates",
  "document_update_receipts",
  "block_documents",
  "top_level_block_placements",
  "block_properties",
  "blocks",
  "documents",
  "block_store_metadata",
  "card_search_units_fts",
  "card_search_units",
  "thread_search_units_fts",
  "thread_search_thread_state",
  "thread_search_units",
  "project_session_threads",
  "project_session_tabs",
  "project_sessions",
  "canvas",
  "reminder_snoozes",
  "reminder_receipts",
  "recurrence_exceptions",
  "card_history_snapshots",
  "history",
  "codex_thread_card_links",
  "codex_background_processes",
  "codex_automation_runs",
  "codex_scheduled_automations",
  "codex_pinned_threads",
  "codex_threads",
  "codex_card_threads",
  "description_revisions",
  "description_blocks",
  "cards",
  "pinned_project_order",
  "project_order",
  "project_sources",
  "projects",
  // Kept here so a versionless local file can still be reset safely.
  "recurrence_occurrence_log",
];

const PRIMARY_DATABASE_SCHEMA_KEY = "nodex.database";
const CARD_DOCUMENT_SCHEMA_KEY = "nodex.card";
const FRACTIONAL_DATABASE_RANK_MAX = (1n << 128n) - 1n;

function databaseFractionalRankForOrdinal(
  ordinal: number,
  total: number,
): string {
  const value =
    (FRACTIONAL_DATABASE_RANK_MAX * BigInt(ordinal + 1)) / BigInt(total + 1);
  return value.toString(16).padStart(32, "0");
}

type DatabasePropertyValueType =
  "select" | "multi_select" | "date" | "datetime" | "person";

interface PrimaryDatabasePropertyDefinition {
  readonly key: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, unknown>>;
  readonly rankKey: string;
}

const PRIMARY_DATABASE_PROPERTY_DEFINITIONS: readonly PrimaryDatabasePropertyDefinition[] =
  [
    {
      key: "status",
      name: "Status",
      valueType: "select",
      config: { options: CARD_STATUS_COLUMNS },
      rankKey: databaseFractionalRankForOrdinal(0, 8),
    },
    {
      key: "priority",
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
      rankKey: databaseFractionalRankForOrdinal(1, 8),
    },
    {
      key: "estimate",
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
      rankKey: databaseFractionalRankForOrdinal(2, 8),
    },
    {
      key: "tags",
      name: "Tags",
      valueType: "multi_select",
      config: { options: [] },
      rankKey: databaseFractionalRankForOrdinal(3, 8),
    },
    {
      key: "due_date",
      name: "Due date",
      valueType: "date",
      config: {},
      rankKey: databaseFractionalRankForOrdinal(4, 8),
    },
    {
      key: "scheduled_start",
      name: "Scheduled start",
      valueType: "datetime",
      config: {},
      rankKey: databaseFractionalRankForOrdinal(5, 8),
    },
    {
      key: "scheduled_end",
      name: "Scheduled end",
      valueType: "datetime",
      config: {},
      rankKey: databaseFractionalRankForOrdinal(6, 8),
    },
    {
      key: "assignee",
      name: "Assignee",
      valueType: "person",
      config: {},
      rankKey: databaseFractionalRankForOrdinal(7, 8),
    },
  ] as const;

const LEGACY_INTRINSIC_PROPERTY_COUNT = 11;

function primaryDatabasePropertyId(projectId: string, key: string): string {
  return `${primaryDatabaseBlockId(projectId)}:property:${key}`;
}

function makePrimaryDatabaseViewConfig(projectId: string): string {
  return JSON.stringify({
    schemaKey: "nodex.database-view",
    schemaVersion: 1,
    filter: { kind: "group", operator: "and", children: [] },
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
    group: { propertyId: primaryDatabasePropertyId(projectId, "status") },
    display: {
      propertyIds: [
        primaryDatabasePropertyId(projectId, "status"),
        primaryDatabasePropertyId(projectId, "priority"),
        primaryDatabasePropertyId(projectId, "estimate"),
        primaryDatabasePropertyId(projectId, "tags"),
      ],
      showTitle: true,
    },
  });
}

function makeLegacyCardMetadataProjectionSql(
  rowAlias: "NEW",
  timestampSql: string,
): string {
  const row = rowAlias;
  const revision = `MAX(1, ${row}.revision)`;
  return `
    INSERT INTO block_properties (
      block_id, project_id, property_key, value_type, value_json,
      revision, updated_at
    ) VALUES
      (${row}.id, ${row}.project_id, 'agent.blocked', 'boolean',
        CASE WHEN ${row}.agent_blocked = 1 THEN 'true' ELSE 'false' END,
        ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'agent.status', 'string',
        json_quote(${row}.agent_status), ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'run.target', 'string',
        json_quote(CASE ${row}.run_in_target
          WHEN 'new_worktree' THEN 'newWorktree'
          WHEN 'cloud' THEN 'cloud'
          ELSE 'localProject'
        END), ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'run.localPath', 'string',
        json_quote(${row}.run_in_local_path), ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'run.baseBranch', 'string',
        json_quote(${row}.run_in_base_branch), ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'run.worktreePath', 'string',
        json_quote(${row}.run_in_worktree_path), ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'run.environmentPath', 'string',
        json_quote(${row}.run_in_environment_path), ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'schedule.isAllDay', 'boolean',
        CASE WHEN ${row}.is_all_day = 1 THEN 'true' ELSE 'false' END,
        ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'schedule.timezone', 'string',
        json_quote(${row}.schedule_timezone), ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'recurrence.config', 'json',
        CASE WHEN ${row}.recurrence_json IS NULL
          THEN 'null'
          ELSE json(${row}.recurrence_json)
        END, ${revision}, ${timestampSql}),
      (${row}.id, ${row}.project_id, 'reminders.config', 'json',
        json(${row}.reminders_json), ${revision}, ${timestampSql})
    ON CONFLICT(block_id, property_key) DO UPDATE SET
      project_id = excluded.project_id,
      value_type = excluded.value_type,
      value_json = excluded.value_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at;

    INSERT INTO database_property_values (
      membership_id, property_id, database_block_id, project_id,
      value_type, value_json, revision, updated_at
    )
    SELECT
      membership.id,
      property.id,
      property.database_block_id,
      ${row}.project_id,
      property.value_type,
      CASE property.key
        WHEN 'status' THEN json_quote(${row}.status)
        WHEN 'priority' THEN json_quote(${row}.priority)
        WHEN 'estimate' THEN json_quote(${row}.estimate)
        WHEN 'tags' THEN json(${row}.tags)
        WHEN 'due_date' THEN json_quote(${row}.due_date)
        WHEN 'scheduled_start' THEN json_quote(${row}.scheduled_start)
        WHEN 'scheduled_end' THEN json_quote(${row}.scheduled_end)
        WHEN 'assignee' THEN json_quote(${row}.assignee)
      END,
      ${revision},
      ${timestampSql}
    FROM database_memberships membership
    INNER JOIN database_properties property
      ON property.database_block_id = membership.database_block_id
      AND property.lifecycle = 'active'
    WHERE membership.card_block_id = ${row}.id
      AND membership.removed_at IS NULL
      AND property.key IN (
        'status', 'priority', 'estimate', 'tags', 'due_date',
        'scheduled_start', 'scheduled_end', 'assignee'
      )
    ON CONFLICT(membership_id, property_id) DO UPDATE SET
      database_block_id = excluded.database_block_id,
      project_id = excluded.project_id,
      value_type = excluded.value_type,
      value_json = excluded.value_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at;

    INSERT INTO scheduled_card_index (
      card_block_id, project_id, lifecycle, scheduled_start, scheduled_end,
      is_all_day, recurrence_json, reminders_json, schedule_timezone,
      source_metadata_revision, updated_at
    ) VALUES (
      ${row}.id,
      ${row}.project_id,
      CASE WHEN ${row}.archived = 1 THEN 'archived' ELSE 'active' END,
      ${row}.scheduled_start,
      ${row}.scheduled_end,
      ${row}.is_all_day,
      CASE WHEN ${row}.recurrence_json IS NULL
        THEN 'null'
        ELSE json(${row}.recurrence_json)
      END,
      json(${row}.reminders_json),
      ${row}.schedule_timezone,
      ${revision},
      ${timestampSql}
    )
    ON CONFLICT(card_block_id) DO UPDATE SET
      project_id = excluded.project_id,
      lifecycle = excluded.lifecycle,
      scheduled_start = excluded.scheduled_start,
      scheduled_end = excluded.scheduled_end,
      is_all_day = excluded.is_all_day,
      recurrence_json = excluded.recurrence_json,
      reminders_json = excluded.reminders_json,
      schedule_timezone = excluded.schedule_timezone,
      source_metadata_revision = excluded.source_metadata_revision,
      updated_at = excluded.updated_at;
  `;
}

function primaryDatabaseBlockId(projectId: string): string {
  return `database:${projectId}:primary`;
}

function primaryDatabaseViewId(projectId: string): string {
  return `database-view:${projectId}:primary-kanban`;
}

function cardDocumentId(cardId: string): string {
  return `document:${cardId}`;
}

function legacyRankKey(order: number): string {
  const normalizedOrder = Number.isSafeInteger(order) && order >= 0 ? order : 0;
  return normalizedOrder.toString().padStart(20, "0");
}

function createDocumentUpdateReceiptSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_update_receipts (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      seq INTEGER NOT NULL CHECK (seq >= 1),
      update_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      client_touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      derived_touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      derivation_version INTEGER NOT NULL DEFAULT 1 CHECK (derivation_version IN (0, 1)),
      update_hash TEXT NOT NULL,
      update_byte_length INTEGER NOT NULL CHECK (update_byte_length > 0),
      committed_at TEXT NOT NULL,
      PRIMARY KEY (document_id, generation, seq),
      UNIQUE (document_id, update_id)
    ) WITHOUT ROWID;
  `);
}

function createForeignReferenceMigrationSchema(db: Database.Database): void {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_block_documents_owner_document_project
      ON block_documents(block_id, document_id, project_id);

    CREATE TABLE IF NOT EXISTS foreign_reference_migrations (
      source_block_id TEXT PRIMARY KEY,
      host_document_id TEXT NOT NULL,
      host_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      legacy_kind TEXT NOT NULL,
      legacy_target_block_id TEXT,
      occurrence INTEGER NOT NULL DEFAULT 1 CHECK (occurrence >= 1),
      source_fingerprint TEXT NOT NULL,
      target_block_id TEXT,
      database_view_id TEXT,
      recovered_card_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (host_block_id, host_document_id, project_id)
        REFERENCES block_documents(block_id, document_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (database_view_id)
        REFERENCES database_views(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (recovered_card_id)
        REFERENCES blocks(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      CHECK (legacy_kind IN ('card_ref', 'card_toggle', 'database_query')),
      CHECK (status IN ('pending', 'applying', 'applied', 'failed')),
      CHECK (length(source_block_id) > 0),
      CHECK (length(host_document_id) > 0),
      CHECK (length(host_block_id) > 0),
      CHECK (length(project_id) > 0),
      CHECK (length(created_at) > 0),
      CHECK (length(updated_at) > 0),
      CHECK (legacy_target_block_id IS NULL OR length(legacy_target_block_id) > 0),
      CHECK (length(source_fingerprint) = 64),
      CHECK (target_block_id IS NULL OR length(target_block_id) > 0),
      CHECK (database_view_id IS NULL OR length(database_view_id) > 0),
      CHECK (
        (legacy_kind IN ('card_ref', 'card_toggle')
          AND database_view_id IS NULL)
        OR (legacy_kind = 'database_query'
          AND legacy_target_block_id IS NULL
          AND target_block_id IS NULL
          AND recovered_card_id IS NULL)
      ),
      CHECK (recovered_card_id IS NULL OR recovered_card_id = target_block_id),
      CHECK (
        status <> 'applied'
        OR (legacy_kind IN ('card_ref', 'card_toggle')
          AND target_block_id IS NOT NULL)
        OR (legacy_kind = 'database_query'
          AND database_view_id IS NOT NULL)
      ),
      CHECK (
        (status = 'pending' AND attempt_count >= 0)
        OR (status <> 'pending' AND attempt_count >= 1)
      ),
      CHECK (
        (status = 'failed' AND last_error IS NOT NULL AND length(last_error) > 0)
        OR (status <> 'failed' AND last_error IS NULL)
      )
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_foreign_reference_migrations_work
      ON foreign_reference_migrations(status, project_id, updated_at, source_block_id);
    CREATE INDEX IF NOT EXISTS idx_foreign_reference_migrations_host
      ON foreign_reference_migrations(host_document_id, status, source_block_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_foreign_reference_migrations_recovered_card
      ON foreign_reference_migrations(recovered_card_id)
      WHERE recovered_card_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS foreign_reference_migrations_validate_insert
      BEFORE INSERT ON foreign_reference_migrations
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks source
        WHERE source.id = NEW.source_block_id
          AND source.project_id = NEW.project_id
          AND source.location_kind = 'document'
          AND source.containing_document_id = NEW.host_document_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM blocks host
        WHERE host.id = NEW.host_block_id
          AND host.project_id = NEW.project_id
          AND host.type = 'card'
      ) OR (
        NEW.recovered_card_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks recovered
          WHERE recovered.id = NEW.recovered_card_id
            AND recovered.type = 'card'
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'foreign reference migration scope is invalid');
      END;

    CREATE TRIGGER IF NOT EXISTS foreign_reference_migrations_validate_update
      BEFORE UPDATE OF source_block_id, host_document_id, host_block_id, project_id,
        legacy_target_block_id, source_fingerprint, target_block_id, recovered_card_id
      ON foreign_reference_migrations
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks source
        WHERE source.id = NEW.source_block_id
          AND source.project_id = NEW.project_id
          AND source.location_kind = 'document'
          AND source.containing_document_id = NEW.host_document_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM blocks host
        WHERE host.id = NEW.host_block_id
          AND host.project_id = NEW.project_id
          AND host.type = 'card'
      ) OR (
        NEW.recovered_card_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks recovered
          WHERE recovered.id = NEW.recovered_card_id
            AND recovered.type = 'card'
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'foreign reference migration scope is invalid');
      END;
  `);
}

function createAtomicBlockRelocationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS change_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      store_epoch TEXT NOT NULL,
      kind TEXT NOT NULL,
      operation_id TEXT,
      block_ids_json TEXT NOT NULL DEFAULT '[]',
      document_ids_json TEXT NOT NULL DEFAULT '[]',
      database_block_ids_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT NOT NULL DEFAULT '{}',
      committed_at TEXT NOT NULL,
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (length(kind) BETWEEN 1 AND 128),
      CHECK (operation_id IS NULL OR length(operation_id) BETWEEN 1 AND 512),
      CHECK (json_valid(block_ids_json) AND json_type(block_ids_json) = 'array'),
      CHECK (json_valid(document_ids_json) AND json_type(document_ids_json) = 'array'),
      CHECK (
        json_valid(database_block_ids_json)
        AND json_type(database_block_ids_json) = 'array'
      ),
      CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
      CHECK (length(committed_at) > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_change_log_project_seq
      ON change_log(project_id, seq);
    CREATE INDEX IF NOT EXISTS idx_change_log_kind_seq
      ON change_log(kind, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_change_log_operation
      ON change_log(project_id, kind, operation_id)
      WHERE operation_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS block_relocations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      store_epoch TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
      source_base_head_seq INTEGER NOT NULL CHECK (source_base_head_seq >= 0),
      target_kind TEXT NOT NULL,
      target_document_id TEXT,
      target_generation INTEGER,
      target_base_head_seq INTEGER,
      target_parent_block_id TEXT,
      target_before_block_id TEXT,
      root_block_ids_json TEXT NOT NULL,
      expected_location_revisions_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'committed',
      source_update_id TEXT NOT NULL,
      source_committed_seq INTEGER NOT NULL CHECK (source_committed_seq >= 1),
      target_update_id TEXT,
      target_committed_seq INTEGER,
      final_location_revisions_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      change_log_seq INTEGER NOT NULL UNIQUE
        REFERENCES change_log(seq) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      committed_at TEXT NOT NULL,
      UNIQUE (id, project_id),
      UNIQUE (
        id, source_document_id, project_id, source_generation,
        source_base_head_seq
      ),
      FOREIGN KEY (source_document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE RESTRICT,
      FOREIGN KEY (target_document_id, target_project_id)
        REFERENCES documents(id, project_id) ON DELETE RESTRICT,
      FOREIGN KEY (target_parent_block_id, target_project_id)
        REFERENCES blocks(id, project_id) ON DELETE RESTRICT,
      FOREIGN KEY (target_before_block_id, target_project_id)
        REFERENCES blocks(id, project_id) ON DELETE RESTRICT,
      FOREIGN KEY (source_document_id, source_generation, source_committed_seq)
        REFERENCES document_update_receipts(document_id, generation, seq)
        ON DELETE RESTRICT,
      FOREIGN KEY (target_document_id, target_generation, target_committed_seq)
        REFERENCES document_update_receipts(document_id, generation, seq)
        ON DELETE RESTRICT,
      CHECK (length(id) BETWEEN 1 AND 512),
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (
        length(request_hash) = 64
        AND request_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
      CHECK (
        json_valid(root_block_ids_json)
        AND json_type(root_block_ids_json) = 'array'
        AND json_array_length(root_block_ids_json) > 0
      ),
      CHECK (
        json_valid(expected_location_revisions_json)
        AND json_type(expected_location_revisions_json) = 'object'
      ),
      CHECK (
        json_valid(final_location_revisions_json)
        AND json_type(final_location_revisions_json) = 'object'
      ),
      CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
      CHECK (status = 'committed'),
      CHECK (target_kind IN ('document', 'space')),
      CHECK (
        (target_kind = 'document'
          AND target_project_id = project_id
          AND target_document_id IS NOT NULL
          AND target_document_id <> source_document_id
          AND target_generation IS NOT NULL
          AND target_generation >= 1
          AND target_base_head_seq IS NOT NULL
          AND target_base_head_seq >= 0
          AND target_update_id IS NOT NULL
          AND target_committed_seq = target_base_head_seq + 1)
        OR (target_kind = 'space'
          AND target_document_id IS NULL
          AND target_generation IS NULL
          AND target_base_head_seq IS NULL
          AND target_parent_block_id IS NULL
          AND target_update_id IS NULL
          AND target_committed_seq IS NULL)
      ),
      CHECK (source_committed_seq = source_base_head_seq + 1),
      CHECK (source_update_id = 'relocation:' || request_hash || ':source'),
      CHECK (
        target_update_id IS NULL
        OR target_update_id = 'relocation:' || request_hash || ':target'
      ),
      CHECK (length(committed_at) > 0)
    );

    CREATE INDEX IF NOT EXISTS idx_block_relocations_project_committed
      ON block_relocations(project_id, committed_at, id);
    CREATE INDEX IF NOT EXISTS idx_block_relocations_source
      ON block_relocations(
        source_document_id, source_generation, source_base_head_seq, id
      );
    CREATE INDEX IF NOT EXISTS idx_block_relocations_target
      ON block_relocations(target_document_id, target_generation, id)
      WHERE target_document_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS block_relocation_members (
      relocation_id TEXT NOT NULL,
      block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE RESTRICT,
      tree_ordinal INTEGER NOT NULL CHECK (tree_ordinal >= 0),
      is_root INTEGER NOT NULL CHECK (is_root IN (0, 1)),
      source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      final_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
      source_location_revision INTEGER NOT NULL CHECK (source_location_revision >= 1),
      final_location_revision INTEGER NOT NULL CHECK (final_location_revision >= 2),
      PRIMARY KEY (relocation_id, block_id),
      UNIQUE (relocation_id, tree_ordinal),
      FOREIGN KEY (relocation_id, source_project_id)
        REFERENCES block_relocations(id, project_id) ON DELETE CASCADE,
      CHECK (final_location_revision = source_location_revision + 1)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_block_relocation_members_block
      ON block_relocation_members(block_id, relocation_id);
    CREATE INDEX IF NOT EXISTS idx_block_relocation_members_roots
      ON block_relocation_members(relocation_id, tree_ordinal)
      WHERE is_root = 1;

    CREATE TABLE IF NOT EXISTS block_relocation_source_states (
      relocation_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
      pre_state_vector BLOB NOT NULL,
      pre_full_update BLOB NOT NULL,
      pre_full_update_byte_length INTEGER NOT NULL
        CHECK (pre_full_update_byte_length > 0),
      pre_state_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      FOREIGN KEY (
        relocation_id, document_id, project_id, generation, head_seq
      ) REFERENCES block_relocations(
        id, source_document_id, project_id, source_generation,
        source_base_head_seq
      ) ON DELETE CASCADE,
      CHECK (length(pre_state_vector) > 0),
      CHECK (length(pre_full_update) = pre_full_update_byte_length),
      CHECK (
        length(pre_state_hash) = 64
        AND pre_state_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (length(captured_at) > 0)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_block_relocation_source_states_document
      ON block_relocation_source_states(document_id, generation, head_seq);

    CREATE TABLE IF NOT EXISTS document_recovery_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      store_epoch TEXT NOT NULL,
      document_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      update_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      derived_touched_block_ids_json TEXT,
      update_blob BLOB NOT NULL,
      update_hash TEXT NOT NULL,
      update_byte_length INTEGER NOT NULL CHECK (update_byte_length > 0),
      reason TEXT NOT NULL,
      relocation_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE (document_id, generation, update_id),
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE RESTRICT,
      CHECK (length(id) BETWEEN 1 AND 512),
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (length(update_id) BETWEEN 1 AND 512),
      CHECK (length(client_session_id) BETWEEN 1 AND 512),
      CHECK (
        json_valid(touched_block_ids_json)
        AND json_type(touched_block_ids_json) = 'array'
      ),
      CHECK (
        derived_touched_block_ids_json IS NULL
        OR (json_valid(derived_touched_block_ids_json)
          AND json_type(derived_touched_block_ids_json) = 'array')
      ),
      CHECK (
        json_valid(relocation_ids_json)
        AND json_type(relocation_ids_json) = 'array'
      ),
      CHECK (length(update_blob) = update_byte_length),
      CHECK (
        length(update_hash) = 64
        AND update_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (reason IN ('block_relocated', 'unsafe_stale_update')),
      CHECK (status IN ('pending', 'resolved', 'discarded')),
      CHECK (length(created_at) > 0),
      CHECK (length(expires_at) > 0 AND expires_at > created_at),
      CHECK (
        (status = 'pending' AND resolved_at IS NULL)
        OR (status IN ('resolved', 'discarded') AND resolved_at IS NOT NULL)
      )
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_document_recovery_artifacts_document
      ON document_recovery_artifacts(
        document_id, generation, status, created_at, id
      );
    CREATE INDEX IF NOT EXISTS idx_document_recovery_artifacts_expiry
      ON document_recovery_artifacts(status, expires_at, id);

    CREATE TRIGGER IF NOT EXISTS block_relocations_validate_insert
      BEFORE INSERT ON block_relocations
      WHEN EXISTS (
        SELECT 1
        FROM json_each(NEW.root_block_ids_json) root
        WHERE root.type <> 'text'
          OR length(root.value) < 1
          OR length(root.value) > 512
      ) OR (
        SELECT COUNT(*) FROM json_each(NEW.root_block_ids_json)
      ) <> (
        SELECT COUNT(DISTINCT root.value)
        FROM json_each(NEW.root_block_ids_json) root
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.expected_location_revisions_json) revision
        WHERE revision.type <> 'integer' OR revision.value < 1
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.root_block_ids_json) root
        WHERE NOT EXISTS (
          SELECT 1
          FROM json_each(NEW.expected_location_revisions_json) revision
          WHERE revision.key = root.value
        )
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.expected_location_revisions_json) revision
        WHERE NOT EXISTS (
          SELECT 1
          FROM json_each(NEW.root_block_ids_json) root
          WHERE root.value = revision.key
        )
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.final_location_revisions_json) revision
        WHERE revision.type <> 'integer' OR revision.value < 2
      ) OR NOT EXISTS (
        SELECT 1
        FROM change_log change
        WHERE change.seq = NEW.change_log_seq
          AND change.project_id = NEW.project_id
          AND change.store_epoch = NEW.store_epoch
          AND change.kind = 'block_relocation'
          AND change.operation_id = NEW.id
      ) OR NOT EXISTS (
        SELECT 1
        FROM document_update_receipts receipt
        WHERE receipt.document_id = NEW.source_document_id
          AND receipt.generation = NEW.source_generation
          AND receipt.seq = NEW.source_committed_seq
          AND receipt.update_id = NEW.source_update_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM documents document
        WHERE document.id = NEW.source_document_id
          AND document.project_id = NEW.project_id
          AND document.generation = NEW.source_generation
          AND document.head_seq = NEW.source_committed_seq
          AND document.readiness = 'ready'
      ) OR (
        NEW.target_kind = 'document'
        AND NOT EXISTS (
          SELECT 1
          FROM document_update_receipts receipt
          WHERE receipt.document_id = NEW.target_document_id
            AND receipt.generation = NEW.target_generation
            AND receipt.seq = NEW.target_committed_seq
            AND receipt.update_id = NEW.target_update_id
        )
      ) OR (
        NEW.target_kind = 'document'
        AND NOT EXISTS (
          SELECT 1
          FROM documents document
          WHERE document.id = NEW.target_document_id
            AND document.project_id = NEW.target_project_id
            AND document.generation = NEW.target_generation
            AND document.head_seq = NEW.target_committed_seq
            AND document.readiness = 'ready'
        )
      ) OR (
        NEW.target_parent_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks parent
          WHERE parent.id = NEW.target_parent_block_id
            AND parent.project_id = NEW.target_project_id
            AND parent.location_kind = 'document'
            AND parent.containing_document_id = NEW.target_document_id
        )
      ) OR (
        NEW.target_before_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks anchor
          WHERE anchor.id = NEW.target_before_block_id
            AND anchor.project_id = NEW.target_project_id
            AND (
              (NEW.target_kind = 'document'
                AND anchor.location_kind = 'document'
                AND anchor.containing_document_id = NEW.target_document_id)
              OR (NEW.target_kind = 'space'
                AND anchor.location_kind = 'space')
            )
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'block relocation ledger is invalid');
      END;

    CREATE TRIGGER IF NOT EXISTS block_relocations_are_immutable
      BEFORE UPDATE ON block_relocations
      BEGIN
        SELECT RAISE(ABORT, 'committed block relocations are immutable');
      END;

    CREATE TRIGGER IF NOT EXISTS block_relocation_members_validate_insert
      BEFORE INSERT ON block_relocation_members
      WHEN NOT EXISTS (
        SELECT 1
        FROM block_relocations relocation
        WHERE relocation.id = NEW.relocation_id
          AND relocation.project_id = NEW.source_project_id
          AND relocation.target_project_id = NEW.final_project_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM blocks block
        WHERE block.id = NEW.block_id
          AND block.project_id = NEW.final_project_id
          AND block.location_revision = NEW.final_location_revision
      ) OR NEW.is_root <> EXISTS (
        SELECT 1
        FROM block_relocations relocation,
          json_each(relocation.root_block_ids_json) root
        WHERE relocation.id = NEW.relocation_id
          AND root.value = NEW.block_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM block_relocations relocation,
          json_each(relocation.final_location_revisions_json) revision
        WHERE relocation.id = NEW.relocation_id
          AND revision.key = NEW.block_id
          AND revision.value = NEW.final_location_revision
      ) OR (
        NEW.is_root = 1
        AND NOT EXISTS (
          SELECT 1
          FROM block_relocations relocation,
            json_each(relocation.expected_location_revisions_json) revision
          WHERE relocation.id = NEW.relocation_id
            AND revision.key = NEW.block_id
            AND revision.value = NEW.source_location_revision
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'block relocation member is invalid');
      END;

    CREATE TRIGGER IF NOT EXISTS block_relocation_members_are_immutable
      BEFORE UPDATE ON block_relocation_members
      BEGIN
        SELECT RAISE(ABORT, 'committed block relocation members are immutable');
      END;

    CREATE TRIGGER IF NOT EXISTS block_relocation_source_states_are_immutable
      BEFORE UPDATE ON block_relocation_source_states
      BEGIN
        SELECT RAISE(ABORT, 'committed block relocation source states are immutable');
      END;

    CREATE TRIGGER IF NOT EXISTS document_recovery_artifacts_validate_insert
      BEFORE INSERT ON document_recovery_artifacts
      WHEN EXISTS (
        SELECT 1
        FROM json_each(NEW.touched_block_ids_json) touched
        WHERE touched.type <> 'text'
          OR length(touched.value) < 1
          OR length(touched.value) > 512
      ) OR (
        SELECT COUNT(*) FROM json_each(NEW.touched_block_ids_json)
      ) <> (
        SELECT COUNT(DISTINCT touched.value)
        FROM json_each(NEW.touched_block_ids_json) touched
      ) OR EXISTS (
        SELECT 1
        FROM json_each(COALESCE(NEW.derived_touched_block_ids_json, '[]')) touched
        WHERE touched.type <> 'text'
          OR length(touched.value) < 1
          OR length(touched.value) > 512
      ) OR (
        SELECT COUNT(*)
        FROM json_each(COALESCE(NEW.derived_touched_block_ids_json, '[]'))
      ) <> (
        SELECT COUNT(DISTINCT touched.value)
        FROM json_each(COALESCE(NEW.derived_touched_block_ids_json, '[]')) touched
      ) OR EXISTS (
        SELECT 1
        FROM json_each(NEW.relocation_ids_json) relocation_id
        WHERE relocation_id.type <> 'text'
          OR length(relocation_id.value) < 1
          OR length(relocation_id.value) > 512
          OR NOT EXISTS (
          SELECT 1
          FROM block_relocations relocation
          WHERE relocation.id = relocation_id.value
            AND relocation.project_id = NEW.project_id
        )
      ) OR (
        SELECT COUNT(*) FROM json_each(NEW.relocation_ids_json)
      ) <> (
        SELECT COUNT(DISTINCT relocation_id.value)
        FROM json_each(NEW.relocation_ids_json) relocation_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'document recovery artifact is invalid');
      END;

    CREATE TRIGGER IF NOT EXISTS document_recovery_artifacts_validate_update
      BEFORE UPDATE ON document_recovery_artifacts
      WHEN NEW.id <> OLD.id
        OR NEW.project_id <> OLD.project_id
        OR NEW.store_epoch <> OLD.store_epoch
        OR NEW.document_id <> OLD.document_id
        OR NEW.generation <> OLD.generation
        OR NEW.update_id <> OLD.update_id
        OR NEW.client_session_id <> OLD.client_session_id
        OR NEW.base_head_seq <> OLD.base_head_seq
        OR NEW.touched_block_ids_json <> OLD.touched_block_ids_json
        OR COALESCE(NEW.derived_touched_block_ids_json, '') <>
          COALESCE(OLD.derived_touched_block_ids_json, '')
        OR NEW.update_blob <> OLD.update_blob
        OR NEW.update_hash <> OLD.update_hash
        OR NEW.update_byte_length <> OLD.update_byte_length
        OR NEW.reason <> OLD.reason
        OR NEW.relocation_ids_json <> OLD.relocation_ids_json
        OR NEW.created_at <> OLD.created_at
        OR NEW.expires_at <> OLD.expires_at
        OR OLD.status <> 'pending'
        OR NEW.status = 'pending'
      BEGIN
        SELECT RAISE(ABORT, 'document recovery artifact payload is immutable');
      END;

    CREATE TRIGGER IF NOT EXISTS change_log_is_immutable
      BEFORE UPDATE ON change_log
      BEGIN
        SELECT RAISE(ABORT, 'change log entries are immutable');
      END;
  `);
}

function createBlockFoundationSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS block_store_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_epoch TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      location_kind TEXT NOT NULL,
      containing_document_id TEXT,
      location_revision INTEGER NOT NULL DEFAULT 1 CHECK (location_revision >= 1),
      metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, project_id),
      FOREIGN KEY (containing_document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE RESTRICT,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (
        (location_kind = 'space' AND containing_document_id IS NULL)
        OR (location_kind = 'document' AND containing_document_id IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_project_lifecycle_type
      ON blocks(project_id, lifecycle, type);
    CREATE INDEX IF NOT EXISTS idx_blocks_containing_document
      ON blocks(containing_document_id, lifecycle);

    CREATE TABLE IF NOT EXISTS block_properties (
      block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      property_key TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (block_id, property_key),
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (length(property_key) BETWEEN 1 AND 128),
      CHECK (value_type IN ('null', 'boolean', 'number', 'string', 'json')),
      CHECK (
        CASE
          WHEN json_valid(value_json) = 0 THEN 0
          WHEN json_type(value_json) = 'null' THEN value_type IN ('null', 'string', 'json')
          WHEN value_type = 'boolean' THEN json_type(value_json) IN ('true', 'false')
          WHEN value_type = 'number' THEN json_type(value_json) IN ('integer', 'real')
          WHEN value_type = 'string' THEN json_type(value_json) = 'text'
          WHEN value_type = 'json' THEN json_type(value_json) IN ('array', 'object')
          ELSE 0
        END
      )
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_block_properties_project_key
      ON block_properties(project_id, property_key, block_id);

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
      head_seq INTEGER NOT NULL DEFAULT 0 CHECK (head_seq >= 0),
      schema_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      state_vector BLOB NOT NULL DEFAULT X'',
      state_hash TEXT NOT NULL DEFAULT '',
      readiness TEXT NOT NULL DEFAULT 'pending_genesis',
      authority TEXT NOT NULL DEFAULT 'legacy_shadow',
      genesis_source_revision INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, project_id),
      CHECK (readiness IN ('pending_genesis', 'ready', 'failed')),
      CHECK (authority IN ('legacy_shadow', 'ydoc_primary')),
      CHECK (authority <> 'ydoc_primary' OR readiness = 'ready')
    );

    CREATE INDEX IF NOT EXISTS idx_documents_project_readiness
      ON documents(project_id, readiness, authority);

    CREATE TABLE IF NOT EXISTS top_level_block_placements (
      block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rank_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON DELETE CASCADE
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_top_level_block_placements_order
      ON top_level_block_placements(project_id, rank_key, block_id);

    CREATE TRIGGER IF NOT EXISTS top_level_block_placements_require_space
      BEFORE INSERT ON top_level_block_placements
      WHEN (SELECT location_kind FROM blocks WHERE id = NEW.block_id) <> 'space'
      BEGIN
        SELECT RAISE(ABORT, 'top-level placement requires a space block');
      END;

    CREATE TRIGGER IF NOT EXISTS top_level_block_placements_updates_require_space
      BEFORE UPDATE OF block_id, project_id ON top_level_block_placements
      WHEN (SELECT location_kind FROM blocks WHERE id = NEW.block_id) <> 'space'
      BEGIN
        SELECT RAISE(ABORT, 'top-level placement requires a space block');
      END;

    CREATE TRIGGER IF NOT EXISTS blocks_document_location_has_no_top_level_placement
      BEFORE UPDATE OF location_kind, containing_document_id ON blocks
      WHEN NEW.location_kind = 'document'
        AND EXISTS (
          SELECT 1 FROM top_level_block_placements placement
          WHERE placement.block_id = NEW.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'document block location cannot retain a top-level placement');
      END;

    CREATE TABLE IF NOT EXISTS block_documents (
      block_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON DELETE RESTRICT,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE RESTRICT
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS document_updates (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      seq INTEGER NOT NULL CHECK (seq >= 1),
      update_id TEXT NOT NULL,
      client_session_id TEXT NOT NULL,
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      touched_block_ids_json TEXT NOT NULL DEFAULT '[]',
      update_blob BLOB NOT NULL,
      update_hash TEXT NOT NULL,
      committed_at TEXT NOT NULL,
      PRIMARY KEY (document_id, generation, seq),
      UNIQUE (document_id, update_id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_document_updates_tail
      ON document_updates(document_id, generation, seq);

    CREATE TABLE IF NOT EXISTS document_snapshots (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      snapshot_seq INTEGER NOT NULL CHECK (snapshot_seq >= 0),
      state_vector BLOB NOT NULL,
      snapshot_update BLOB NOT NULL,
      snapshot_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      created_at TEXT NOT NULL,
      PRIMARY KEY (document_id, generation, snapshot_seq)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS document_materializations (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
      title TEXT NOT NULL DEFAULT '',
      nfm TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      preview TEXT NOT NULL,
      block_tree_json TEXT NOT NULL,
      references_json TEXT NOT NULL DEFAULT '[]',
      asset_refs_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      CHECK (json_valid(block_tree_json) AND json_type(block_tree_json) = 'array'),
      CHECK (json_valid(references_json) AND json_type(references_json) = 'array'),
      CHECK (json_valid(asset_refs_json) AND json_type(asset_refs_json) = 'array')
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS document_block_index (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL UNIQUE REFERENCES blocks(id) ON DELETE CASCADE,
      parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      block_type TEXT NOT NULL,
      text TEXT NOT NULL,
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      PRIMARY KEY (document_id, block_id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_document_block_index_parent_order
      ON document_block_index(document_id, parent_block_id, ordinal, block_id);

    CREATE TRIGGER IF NOT EXISTS document_block_index_requires_matching_location
      BEFORE INSERT ON document_block_index
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        WHERE block.id = NEW.block_id
          AND block.location_kind = 'document'
          AND block.containing_document_id = NEW.document_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'indexed block must belong to the indexed document');
      END;

    CREATE TRIGGER IF NOT EXISTS document_block_index_updates_require_matching_location
      BEFORE UPDATE OF document_id, block_id ON document_block_index
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks block
        WHERE block.id = NEW.block_id
          AND block.location_kind = 'document'
          AND block.containing_document_id = NEW.document_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'indexed block must belong to the indexed document');
      END;

    CREATE TRIGGER IF NOT EXISTS document_block_index_parent_requires_matching_location
      BEFORE INSERT ON document_block_index
      WHEN NEW.parent_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks parent
          WHERE parent.id = NEW.parent_block_id
            AND parent.location_kind = 'document'
            AND parent.containing_document_id = NEW.document_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'indexed parent must belong to the indexed document');
      END;

    CREATE TRIGGER IF NOT EXISTS document_block_index_parent_updates_require_matching_location
      BEFORE UPDATE OF document_id, parent_block_id ON document_block_index
      WHEN NEW.parent_block_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM blocks parent
          WHERE parent.id = NEW.parent_block_id
            AND parent.location_kind = 'document'
            AND parent.containing_document_id = NEW.document_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'indexed parent must belong to the indexed document');
      END;

    CREATE TABLE IF NOT EXISTS scheduled_card_index (
      card_block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      scheduled_start TEXT,
      scheduled_end TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
      recurrence_json TEXT NOT NULL DEFAULT 'null',
      reminders_json TEXT NOT NULL DEFAULT '[]',
      schedule_timezone TEXT,
      source_metadata_revision INTEGER NOT NULL CHECK (source_metadata_revision >= 1),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (card_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start),
      CHECK (is_all_day = 0 OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL)),
      CHECK (
        json_valid(recurrence_json)
        AND json_type(recurrence_json) IN ('null', 'object')
      ),
      CHECK (
        json_valid(reminders_json)
        AND json_type(reminders_json) = 'array'
      )
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_scheduled_card_index_due
      ON scheduled_card_index(project_id, scheduled_start, card_block_id)
      WHERE lifecycle = 'active' AND scheduled_start IS NOT NULL;

    CREATE TABLE IF NOT EXISTS database_capabilities (
      block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
      schema_key TEXT NOT NULL DEFAULT '${PRIMARY_DATABASE_SCHEMA_KEY}',
      name TEXT NOT NULL DEFAULT 'Cards',
      schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (block_id, project_id),
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON DELETE CASCADE
    ) WITHOUT ROWID;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_database_capabilities_primary_project
      ON database_capabilities(project_id)
      WHERE is_primary = 1;

    CREATE TRIGGER IF NOT EXISTS database_capabilities_require_database_block
      BEFORE INSERT ON database_capabilities
      WHEN (SELECT type FROM blocks WHERE id = NEW.block_id) <> 'database'
      BEGIN
        SELECT RAISE(ABORT, 'database capability requires a database block');
      END;

    CREATE TRIGGER IF NOT EXISTS database_capabilities_updates_require_database_block
      BEFORE UPDATE OF block_id, project_id ON database_capabilities
      WHEN (SELECT type FROM blocks WHERE id = NEW.block_id) <> 'database'
      BEGIN
        SELECT RAISE(ABORT, 'database capability requires a database block');
      END;

    CREATE TABLE IF NOT EXISTS database_properties (
      id TEXT PRIMARY KEY,
      database_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      value_type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      rank_key TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, database_block_id, project_id),
      FOREIGN KEY (database_block_id, project_id)
        REFERENCES database_capabilities(block_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (length(key) BETWEEN 1 AND 128),
      CHECK (length(name) BETWEEN 1 AND 256),
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (lifecycle IN ('active', 'deleted')),
      CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
    ) WITHOUT ROWID;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_database_properties_active_key
      ON database_properties(database_block_id, key)
      WHERE lifecycle = 'active';
    CREATE INDEX IF NOT EXISTS idx_database_properties_order
      ON database_properties(database_block_id, lifecycle, rank_key, id);

    CREATE TABLE IF NOT EXISTS database_memberships (
      id TEXT PRIMARY KEY,
      database_block_id TEXT NOT NULL,
      card_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      removed_at TEXT,
      FOREIGN KEY (database_block_id, project_id)
        REFERENCES database_capabilities(block_id, project_id) ON DELETE CASCADE,
      FOREIGN KEY (card_block_id, project_id)
        REFERENCES blocks(id, project_id) ON DELETE CASCADE
    ) WITHOUT ROWID;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_database_memberships_active_card
      ON database_memberships(card_block_id)
      WHERE removed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_database_memberships_database_active
      ON database_memberships(database_block_id, removed_at, card_block_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_database_memberships_identity_scope
      ON database_memberships(id, database_block_id, project_id);

    CREATE TRIGGER IF NOT EXISTS database_memberships_require_card_block
      BEFORE INSERT ON database_memberships
      WHEN NEW.removed_at IS NULL
        AND (SELECT type FROM blocks WHERE id = NEW.card_block_id) <> 'card'
      BEGIN
        SELECT RAISE(ABORT, 'active database membership requires a card block');
      END;

    CREATE TRIGGER IF NOT EXISTS database_memberships_updates_require_card_block
      BEFORE UPDATE OF card_block_id, removed_at ON database_memberships
      WHEN NEW.removed_at IS NULL
        AND (SELECT type FROM blocks WHERE id = NEW.card_block_id) <> 'card'
      BEGIN
        SELECT RAISE(ABORT, 'active database membership requires a card block');
      END;

    CREATE TABLE IF NOT EXISTS database_property_values (
      membership_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      database_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (membership_id, property_id),
      FOREIGN KEY (membership_id, database_block_id, project_id)
        REFERENCES database_memberships(id, database_block_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (property_id, database_block_id, project_id)
        REFERENCES database_properties(id, database_block_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (
        CASE
          WHEN json_valid(value_json) = 0 THEN 0
          WHEN json_type(value_json) = 'null' THEN 1
          WHEN value_type = 'multi_select' THEN json_type(value_json) = 'array'
          WHEN value_type = 'number' THEN json_type(value_json) IN ('integer', 'real')
          WHEN value_type = 'checkbox' THEN json_type(value_json) IN ('true', 'false')
          ELSE json_type(value_json) = 'text'
        END
      )
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_database_property_values_property
      ON database_property_values(property_id, membership_id);

    CREATE TRIGGER IF NOT EXISTS database_property_values_require_matching_type
      BEFORE INSERT ON database_property_values
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_properties property
        WHERE property.id = NEW.property_id
          AND property.database_block_id = NEW.database_block_id
          AND property.project_id = NEW.project_id
          AND property.lifecycle = 'active'
          AND property.value_type = NEW.value_type
      )
      BEGIN
        SELECT RAISE(ABORT, 'database property value type does not match its definition');
      END;

    CREATE TRIGGER IF NOT EXISTS database_property_values_updates_require_matching_type
      BEFORE UPDATE OF property_id, database_block_id, project_id, value_type
      ON database_property_values
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_properties property
        WHERE property.id = NEW.property_id
          AND property.database_block_id = NEW.database_block_id
          AND property.project_id = NEW.project_id
          AND property.lifecycle = 'active'
          AND property.value_type = NEW.value_type
      )
      BEGIN
        SELECT RAISE(ABORT, 'database property value type does not match its definition');
      END;

    CREATE TRIGGER IF NOT EXISTS blocks_type_updates_preserve_capabilities
      BEFORE UPDATE OF type ON blocks
      WHEN (
        NEW.type <> 'database'
        AND EXISTS (
          SELECT 1 FROM database_capabilities capability
          WHERE capability.block_id = OLD.id
        )
      ) OR (
        NEW.type <> 'card'
        AND EXISTS (
          SELECT 1 FROM database_memberships membership
          WHERE membership.card_block_id = OLD.id
            AND membership.removed_at IS NULL
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'block type cannot invalidate active capabilities');
      END;

    CREATE TRIGGER IF NOT EXISTS blocks_type_updates_preserve_document_ownership
      BEFORE UPDATE OF type ON blocks
      WHEN NEW.type <> OLD.type
        AND EXISTS (
          SELECT 1 FROM block_documents ownership
          WHERE ownership.block_id = OLD.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'document owner type changes require a typed ownership operation');
      END;

    CREATE TABLE IF NOT EXISTS database_views (
      id TEXT PRIMARY KEY,
      database_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      rank_key TEXT NOT NULL DEFAULT '00000000',
      lifecycle TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, project_id),
      FOREIGN KEY (database_block_id, project_id)
        REFERENCES database_capabilities(block_id, project_id) ON DELETE CASCADE,
      CHECK (kind IN ('kanban', 'list', 'calendar', 'canvas')),
      CHECK (lifecycle IN ('active', 'deleted')),
      CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
    ) WITHOUT ROWID;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_database_views_primary
      ON database_views(database_block_id)
      WHERE is_primary = 1 AND lifecycle = 'active';

    CREATE TABLE IF NOT EXISTS database_view_positions (
      view_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      group_key TEXT,
      rank_key TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (view_id, block_id),
      FOREIGN KEY (view_id, project_id)
        REFERENCES database_views(id, project_id) ON DELETE CASCADE,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON DELETE CASCADE
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_database_view_positions_order
      ON database_view_positions(view_id, group_key, rank_key, block_id);

    CREATE TRIGGER IF NOT EXISTS database_view_positions_require_active_membership
      BEFORE INSERT ON database_view_positions
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_views view
        INNER JOIN database_memberships membership
          ON membership.database_block_id = view.database_block_id
          AND membership.card_block_id = NEW.block_id
          AND membership.removed_at IS NULL
        WHERE view.id = NEW.view_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'database view position requires an active membership');
      END;

    CREATE TRIGGER IF NOT EXISTS database_view_positions_updates_require_active_membership
      BEFORE UPDATE OF view_id, block_id ON database_view_positions
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_views view
        INNER JOIN database_memberships membership
          ON membership.database_block_id = view.database_block_id
          AND membership.card_block_id = NEW.block_id
          AND membership.removed_at IS NULL
        WHERE view.id = NEW.view_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'database view position requires an active membership');
      END;

    CREATE TRIGGER IF NOT EXISTS cards_block_foundation_reject_identity_collision
      BEFORE INSERT ON cards
      WHEN EXISTS (
        SELECT 1
        FROM blocks block
        WHERE block.id = NEW.id
          AND NOT (
            block.type = 'card'
            AND block.lifecycle = 'deleted'
            AND block.project_id = NEW.project_id
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'card id collides with an existing Block identity');
      END;

    CREATE TRIGGER IF NOT EXISTS cards_block_foundation_after_insert
      AFTER INSERT ON cards
      BEGIN
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind, containing_document_id,
          location_revision, metadata_revision, created_at, updated_at
        ) VALUES (
          NEW.id,
          NEW.project_id,
          'card',
          CASE WHEN NEW.archived = 1 THEN 'archived' ELSE 'active' END,
          'space',
          NULL,
          1,
          MAX(1, NEW.revision),
          NEW.created,
          NEW.created
        )
        ON CONFLICT(id) DO UPDATE SET
          type = 'card',
          lifecycle = excluded.lifecycle,
          location_kind = 'space',
          containing_document_id = NULL,
          location_revision = blocks.location_revision + 1,
          metadata_revision = MAX(blocks.metadata_revision + 1, excluded.metadata_revision),
          updated_at = excluded.updated_at;

        INSERT INTO top_level_block_placements (
          block_id, project_id, rank_key, created_at, updated_at
        ) VALUES (
          NEW.id,
          NEW.project_id,
          '100000000000:' || NEW.status || ':' ||
            printf('%020d', CASE WHEN NEW."order" >= 0 THEN NEW."order" ELSE 0 END),
          NEW.created,
          NEW.created
        )
        ON CONFLICT(block_id) DO UPDATE SET
          project_id = excluded.project_id,
          rank_key = excluded.rank_key,
          updated_at = excluded.updated_at;

        INSERT INTO documents (
          id, project_id, generation, head_seq, schema_key, schema_version,
          state_vector, state_hash, readiness, authority,
          genesis_source_revision, created_at, updated_at
        ) VALUES (
          'document:' || NEW.id,
          NEW.project_id,
          1,
          0,
          '${CARD_DOCUMENT_SCHEMA_KEY}',
          1,
          X'',
          '',
          'pending_genesis',
          'legacy_shadow',
          MAX(1, NEW.revision),
          NEW.created,
          NEW.created
        )
        ON CONFLICT(id) DO NOTHING;

        INSERT INTO block_documents (block_id, document_id, project_id, created_at)
        VALUES (NEW.id, 'document:' || NEW.id, NEW.project_id, NEW.created)
        ON CONFLICT(block_id) DO NOTHING;

        INSERT INTO database_memberships (
          id, database_block_id, card_block_id, project_id, created_at, removed_at
        ) VALUES (
          'membership:' || NEW.id,
          'database:' || NEW.project_id || ':primary',
          NEW.id,
          NEW.project_id,
          NEW.created,
          NULL
        )
        ON CONFLICT(id) DO UPDATE SET
          database_block_id = excluded.database_block_id,
          project_id = excluded.project_id,
          removed_at = NULL;

        INSERT INTO database_view_positions (
          view_id, block_id, project_id, group_key, rank_key, created_at, updated_at
        ) VALUES (
          'database-view:' || NEW.project_id || ':primary-kanban',
          NEW.id,
          NEW.project_id,
          NEW.status,
          printf('%020d', CASE WHEN NEW."order" >= 0 THEN NEW."order" ELSE 0 END),
          NEW.created,
          NEW.created
        )
        ON CONFLICT(view_id, block_id) DO UPDATE SET
          project_id = excluded.project_id,
          group_key = excluded.group_key,
          rank_key = excluded.rank_key,
          updated_at = excluded.updated_at;

        ${makeLegacyCardMetadataProjectionSql("NEW", "NEW.created")}
      END;

    CREATE TRIGGER IF NOT EXISTS cards_block_foundation_after_local_update
      AFTER UPDATE OF
        status, archived, "order", priority, estimate, tags, due_date,
        scheduled_start, scheduled_end, is_all_day, assignee,
        agent_blocked, agent_status, run_in_target, run_in_local_path,
        run_in_base_branch, run_in_worktree_path, run_in_environment_path,
        recurrence_json, reminders_json, schedule_timezone, revision
      ON cards
      WHEN NEW.project_id = OLD.project_id
      BEGIN
        UPDATE blocks
        SET lifecycle = CASE WHEN NEW.archived = 1 THEN 'archived' ELSE 'active' END,
            metadata_revision = MAX(metadata_revision, MAX(1, NEW.revision)),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id AND type = 'card';

        UPDATE top_level_block_placements
        SET rank_key = '100000000000:' || NEW.status || ':' ||
              printf('%020d', CASE WHEN NEW."order" >= 0 THEN NEW."order" ELSE 0 END),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE block_id = NEW.id;

        UPDATE database_view_positions
        SET group_key = NEW.status,
            rank_key = printf(
              '%020d',
              CASE WHEN NEW."order" >= 0 THEN NEW."order" ELSE 0 END
            ),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE block_id = NEW.id
          AND view_id = 'database-view:' || NEW.project_id || ':primary-kanban';

        UPDATE documents
        SET genesis_source_revision = MAX(1, NEW.revision),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = 'document:' || NEW.id
          AND readiness = 'pending_genesis';

        ${makeLegacyCardMetadataProjectionSql(
          "NEW",
          "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        )}
      END;

    CREATE TRIGGER IF NOT EXISTS cards_block_foundation_cross_project_requires_pending
      BEFORE UPDATE OF project_id ON cards
      WHEN NEW.project_id <> OLD.project_id
        AND (
          EXISTS (
            SELECT 1 FROM documents document
            WHERE document.id = 'document:' || OLD.id
              AND document.readiness <> 'pending_genesis'
          )
          OR EXISTS (
            SELECT 1 FROM blocks child
            WHERE child.containing_document_id = 'document:' || OLD.id
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'ready Card Documents require a typed cross-Project move');
      END;

    CREATE TRIGGER IF NOT EXISTS cards_block_foundation_after_cross_project_update
      AFTER UPDATE OF project_id ON cards
      WHEN NEW.project_id <> OLD.project_id
      BEGIN
        DELETE FROM database_view_positions WHERE block_id = NEW.id;
        DELETE FROM database_memberships WHERE card_block_id = NEW.id;
        DELETE FROM top_level_block_placements WHERE block_id = NEW.id;
        DELETE FROM block_documents WHERE block_id = NEW.id;

        UPDATE blocks
        SET project_id = NEW.project_id,
            lifecycle = CASE WHEN NEW.archived = 1 THEN 'archived' ELSE 'active' END,
            location_kind = 'space',
            containing_document_id = NULL,
            location_revision = location_revision + 1,
            metadata_revision = MAX(metadata_revision + 1, MAX(1, NEW.revision)),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = NEW.id;

        UPDATE documents
        SET project_id = NEW.project_id,
            genesis_source_revision = MAX(1, NEW.revision),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = 'document:' || NEW.id;

        INSERT INTO block_documents (block_id, document_id, project_id, created_at)
        VALUES (
          NEW.id,
          'document:' || NEW.id,
          NEW.project_id,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );

        INSERT INTO top_level_block_placements (
          block_id, project_id, rank_key, created_at, updated_at
        ) VALUES (
          NEW.id,
          NEW.project_id,
          '100000000000:' || NEW.status || ':' ||
            printf('%020d', CASE WHEN NEW."order" >= 0 THEN NEW."order" ELSE 0 END),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );

        INSERT INTO database_memberships (
          id, database_block_id, card_block_id, project_id, created_at, removed_at
        ) VALUES (
          'membership:' || NEW.id,
          'database:' || NEW.project_id || ':primary',
          NEW.id,
          NEW.project_id,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          NULL
        )
        ON CONFLICT(id) DO UPDATE SET
          database_block_id = excluded.database_block_id,
          project_id = excluded.project_id,
          removed_at = NULL;

        INSERT INTO database_view_positions (
          view_id, block_id, project_id, group_key, rank_key, created_at, updated_at
        ) VALUES (
          'database-view:' || NEW.project_id || ':primary-kanban',
          NEW.id,
          NEW.project_id,
          NEW.status,
          printf('%020d', CASE WHEN NEW."order" >= 0 THEN NEW."order" ELSE 0 END),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );

        ${makeLegacyCardMetadataProjectionSql(
          "NEW",
          "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        )}
      END;

    CREATE TRIGGER IF NOT EXISTS cards_block_foundation_after_delete
      AFTER DELETE ON cards
      BEGIN
        DELETE FROM database_view_positions WHERE block_id = OLD.id;
        UPDATE database_memberships
        SET removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE card_block_id = OLD.id AND removed_at IS NULL;
        DELETE FROM top_level_block_placements WHERE block_id = OLD.id;
        UPDATE blocks
        SET lifecycle = 'deleted',
            location_revision = location_revision + 1,
            metadata_revision = metadata_revision + 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = OLD.id;

        UPDATE scheduled_card_index
        SET lifecycle = 'deleted',
            source_metadata_revision = MAX(source_metadata_revision, MAX(1, OLD.revision)),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE card_block_id = OLD.id;
      END;
  `);
  createDocumentUpdateReceiptSchema(db);
}

/**
 * Durable BF-07 read-model and operation foundations.
 *
 * These tables deliberately have no triggers back into `cards`, Documents, or
 * property records. They either retain immutable history/idempotency evidence
 * or store rebuildable projections with explicit source coordinates. A stale
 * projection may remain after its source advances, but a writer cannot publish
 * a projection from a future generation, sequence, or metadata revision.
 */
function createBlockSecondaryAuthorityFoundationSchema(
  db: Database.Database,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_versions (
      version_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 1),
      base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
      schema_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
      cause TEXT NOT NULL,
      label TEXT,
      actor_json TEXT NOT NULL DEFAULT '{}',
      full_update_blob BLOB NOT NULL,
      state_vector BLOB NOT NULL,
      checkpoint_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON DELETE CASCADE,
      CHECK (length(version_id) BETWEEN 1 AND 512),
      CHECK (length(schema_key) BETWEEN 1 AND 128),
      CHECK (length(cause) BETWEEN 1 AND 128),
      CHECK (label IS NULL OR length(label) <= 512),
      CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
      CHECK (byte_length = length(full_update_blob)),
      CHECK (
        length(checkpoint_hash) = 64
        AND checkpoint_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (length(created_at) > 0)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_document_versions_document_head
      ON document_versions(document_id, generation, base_head_seq DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_document_versions_project_created
      ON document_versions(project_id, created_at DESC, version_id);

    CREATE TRIGGER IF NOT EXISTS document_versions_validate_insert
      BEFORE INSERT ON document_versions
      WHEN NOT EXISTS (
        SELECT 1
        FROM documents document
        WHERE document.id = NEW.document_id
          AND document.project_id = NEW.project_id
          AND document.readiness = 'ready'
          AND document.generation = NEW.generation
          AND document.head_seq >= NEW.base_head_seq
          AND document.schema_key = NEW.schema_key
          AND document.schema_version = NEW.schema_version
      )
      BEGIN
        SELECT RAISE(ABORT, 'document version source is not a current ready Document');
      END;

    CREATE TRIGGER IF NOT EXISTS document_versions_are_immutable
      BEFORE UPDATE ON document_versions
      BEGIN
        SELECT RAISE(ABORT, 'document versions are immutable');
      END;

    CREATE TABLE IF NOT EXISTS block_mutations (
      mutation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      store_epoch TEXT NOT NULL,
      mutation_kind TEXT NOT NULL,
      actor_json TEXT NOT NULL DEFAULT '{}',
      client_session_id TEXT,
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      target_block_ids_json TEXT NOT NULL DEFAULT '[]',
      affected_document_ids_json TEXT NOT NULL DEFAULT '[]',
      affected_database_block_ids_json TEXT NOT NULL DEFAULT '[]',
      field_intents_json TEXT NOT NULL DEFAULT '[]',
      expected_revisions_json TEXT NOT NULL DEFAULT '{}',
      outcome TEXT NOT NULL,
      result_json TEXT NOT NULL,
      committed_revisions_json TEXT NOT NULL DEFAULT '{}',
      document_heads_json TEXT NOT NULL DEFAULT '{}',
      change_log_seq INTEGER UNIQUE
        REFERENCES change_log(seq) ON DELETE RESTRICT,
      recorded_at TEXT NOT NULL,
      CHECK (length(mutation_id) BETWEEN 1 AND 512),
      CHECK (length(store_epoch) BETWEEN 1 AND 512),
      CHECK (length(mutation_kind) BETWEEN 1 AND 128),
      CHECK (client_session_id IS NULL OR length(client_session_id) BETWEEN 1 AND 512),
      CHECK (
        length(request_hash) = 64
        AND request_hash NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
      CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
      CHECK (
        json_valid(target_block_ids_json)
        AND json_type(target_block_ids_json) = 'array'
      ),
      CHECK (
        json_valid(affected_document_ids_json)
        AND json_type(affected_document_ids_json) = 'array'
      ),
      CHECK (
        json_valid(affected_database_block_ids_json)
        AND json_type(affected_database_block_ids_json) = 'array'
      ),
      CHECK (
        json_valid(field_intents_json)
        AND json_type(field_intents_json) = 'array'
      ),
      CHECK (
        json_valid(expected_revisions_json)
        AND json_type(expected_revisions_json) = 'object'
      ),
      CHECK (outcome IN ('committed', 'rejected')),
      CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
      CHECK (
        json_valid(committed_revisions_json)
        AND json_type(committed_revisions_json) = 'object'
      ),
      CHECK (
        json_valid(document_heads_json)
        AND json_type(document_heads_json) = 'object'
      ),
      CHECK (
        (outcome = 'committed' AND change_log_seq IS NOT NULL)
        OR (outcome = 'rejected' AND change_log_seq IS NULL)
      ),
      CHECK (length(recorded_at) > 0)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_block_mutations_project_recorded
      ON block_mutations(project_id, recorded_at DESC, mutation_id);
    CREATE INDEX IF NOT EXISTS idx_block_mutations_session_recorded
      ON block_mutations(project_id, client_session_id, recorded_at DESC)
      WHERE client_session_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS block_mutations_validate_insert
      BEFORE INSERT ON block_mutations
      WHEN NEW.store_epoch <> COALESCE((
          SELECT store_epoch FROM block_store_metadata WHERE id = 1
        ), '')
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.target_block_ids_json) target
          WHERE target.type <> 'text' OR length(target.value) = 0
        )
        OR (
          SELECT COUNT(*) FROM json_each(NEW.target_block_ids_json)
        ) <> (
          SELECT COUNT(DISTINCT target.value)
          FROM json_each(NEW.target_block_ids_json) target
        )
        OR EXISTS (
          SELECT 1
          FROM json_each(NEW.field_intents_json) intent
          WHERE intent.type <> 'object'
            OR json_type(intent.value, '$.path') <> 'text'
            OR length(json_extract(intent.value, '$.path')) = 0
            OR json_type(intent.value, '$.operation') <> 'text'
            OR length(json_extract(intent.value, '$.operation')) = 0
        )
        OR (
          NEW.outcome = 'committed'
          AND (
            EXISTS (
              SELECT 1
              FROM json_each(NEW.target_block_ids_json) target
              WHERE NOT EXISTS (
                SELECT 1
                FROM blocks block
                WHERE block.id = target.value
                  AND block.project_id = NEW.project_id
              )
            )
            OR NOT EXISTS (
              SELECT 1
              FROM change_log change
              WHERE change.seq = NEW.change_log_seq
                AND change.project_id = NEW.project_id
                AND change.store_epoch = NEW.store_epoch
                AND change.operation_id = NEW.mutation_id
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'block mutation scope, intent, or result cursor is invalid');
      END;

    CREATE TRIGGER IF NOT EXISTS block_mutations_reject_id_collision
      BEFORE INSERT ON block_mutations
      WHEN EXISTS (
        SELECT 1
        FROM block_mutations existing
        WHERE existing.mutation_id = NEW.mutation_id
          AND (
            existing.project_id <> NEW.project_id
            OR existing.store_epoch <> NEW.store_epoch
            OR existing.mutation_kind <> NEW.mutation_kind
            OR existing.actor_json <> NEW.actor_json
            OR COALESCE(existing.client_session_id, '') <>
              COALESCE(NEW.client_session_id, '')
            OR existing.request_hash <> NEW.request_hash
            OR existing.request_json <> NEW.request_json
            OR existing.target_block_ids_json <> NEW.target_block_ids_json
            OR existing.affected_document_ids_json <>
              NEW.affected_document_ids_json
            OR existing.affected_database_block_ids_json <>
              NEW.affected_database_block_ids_json
            OR existing.field_intents_json <> NEW.field_intents_json
            OR existing.expected_revisions_json <>
              NEW.expected_revisions_json
            OR existing.outcome <> NEW.outcome
            OR existing.result_json <> NEW.result_json
            OR existing.committed_revisions_json <>
              NEW.committed_revisions_json
            OR existing.document_heads_json <> NEW.document_heads_json
            OR COALESCE(existing.change_log_seq, -1) <>
              COALESCE(NEW.change_log_seq, -1)
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'block mutation id collides with another request or result');
      END;

    CREATE TRIGGER IF NOT EXISTS block_mutations_are_immutable
      BEFORE UPDATE ON block_mutations
      BEGIN
        SELECT RAISE(ABORT, 'block mutations are immutable');
      END;

    CREATE TABLE IF NOT EXISTS block_search_units (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      block_id TEXT NOT NULL,
      owner_block_id TEXT NOT NULL,
      document_id TEXT,
      document_generation INTEGER,
      projected_seq INTEGER,
      source_revision INTEGER,
      projection_version INTEGER NOT NULL DEFAULT 1
        CHECK (projection_version >= 1),
      source_kind TEXT NOT NULL,
      field_key TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      UNIQUE (block_id, source_kind, field_key),
      CHECK (length(unit_key) BETWEEN 1 AND 1024),
      CHECK (length(source_kind) BETWEEN 1 AND 128),
      CHECK (length(field_key) BETWEEN 1 AND 256),
      CHECK (length(text_hash) = 64 AND text_hash NOT GLOB '*[^0-9a-f]*'),
      CHECK (length(updated_at) > 0),
      CHECK (
        (document_id IS NOT NULL
          AND document_generation >= 1
          AND projected_seq >= 0
          AND source_revision IS NULL)
        OR (document_id IS NULL
          AND document_generation IS NULL
          AND projected_seq IS NULL
          AND source_revision >= 1
          AND owner_block_id = block_id)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_block_search_units_project_source
      ON block_search_units(project_id, source_kind, block_id);
    CREATE INDEX IF NOT EXISTS idx_block_search_units_document_freshness
      ON block_search_units(document_id, document_generation, projected_seq)
      WHERE document_id IS NOT NULL;

    CREATE VIRTUAL TABLE IF NOT EXISTS block_search_units_fts USING fts5(
      text,
      content='block_search_units',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 2 tokenchars '-_/@.:#'",
      prefix='2 3 4'
    );

    CREATE TRIGGER IF NOT EXISTS block_search_units_ai
      AFTER INSERT ON block_search_units
      BEGIN
        INSERT INTO block_search_units_fts(rowid, text)
        VALUES (NEW.rowid, NEW.text);
      END;

    CREATE TRIGGER IF NOT EXISTS block_search_units_ad
      AFTER DELETE ON block_search_units
      BEGIN
        INSERT INTO block_search_units_fts(block_search_units_fts, rowid, text)
        VALUES ('delete', OLD.rowid, OLD.text);
      END;

    CREATE TRIGGER IF NOT EXISTS block_search_units_au
      AFTER UPDATE ON block_search_units
      BEGIN
        INSERT INTO block_search_units_fts(block_search_units_fts, rowid, text)
        VALUES ('delete', OLD.rowid, OLD.text);
        INSERT INTO block_search_units_fts(rowid, text)
        VALUES (NEW.rowid, NEW.text);
      END;

    CREATE TRIGGER IF NOT EXISTS block_search_units_validate_insert
      BEFORE INSERT ON block_search_units
      WHEN (
          NEW.document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM documents document
            INNER JOIN block_documents ownership
              ON ownership.document_id = document.id
              AND ownership.project_id = document.project_id
            INNER JOIN blocks source
              ON source.id = NEW.block_id
              AND source.project_id = NEW.project_id
            WHERE document.id = NEW.document_id
              AND document.project_id = NEW.project_id
              AND document.generation = NEW.document_generation
              AND document.head_seq >= NEW.projected_seq
              AND ownership.block_id = NEW.owner_block_id
              AND (
                source.id = ownership.block_id
                OR (
                  source.location_kind = 'document'
                  AND source.containing_document_id = document.id
                )
              )
          )
        ) OR (
          NEW.document_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM blocks source
            WHERE source.id = NEW.block_id
              AND source.project_id = NEW.project_id
              AND source.metadata_revision >= NEW.source_revision
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Block search projection source is invalid or from the future');
      END;

    CREATE TRIGGER IF NOT EXISTS block_search_units_validate_update
      BEFORE UPDATE ON block_search_units
      WHEN (
          NEW.document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM documents document
            INNER JOIN block_documents ownership
              ON ownership.document_id = document.id
              AND ownership.project_id = document.project_id
            INNER JOIN blocks source
              ON source.id = NEW.block_id
              AND source.project_id = NEW.project_id
            WHERE document.id = NEW.document_id
              AND document.project_id = NEW.project_id
              AND document.generation = NEW.document_generation
              AND document.head_seq >= NEW.projected_seq
              AND ownership.block_id = NEW.owner_block_id
              AND (
                source.id = ownership.block_id
                OR (
                  source.location_kind = 'document'
                  AND source.containing_document_id = document.id
                )
              )
          )
        ) OR (
          NEW.document_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM blocks source
            WHERE source.id = NEW.block_id
              AND source.project_id = NEW.project_id
              AND source.metadata_revision >= NEW.source_revision
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Block search projection source is invalid or from the future');
      END;

    CREATE TABLE IF NOT EXISTS block_asset_refs (
      document_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      owner_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
      projected_seq INTEGER NOT NULL CHECK (projected_seq >= 0),
      projection_version INTEGER NOT NULL DEFAULT 1
        CHECK (projection_version >= 1),
      role TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      asset_uri TEXT NOT NULL,
      asset_hash TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (document_id, block_id, role, ordinal),
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (owner_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (length(role) BETWEEN 1 AND 128),
      CHECK (length(asset_uri) BETWEEN 1 AND 4096),
      CHECK (
        asset_hash IS NULL OR (
          length(asset_hash) = 64
          AND asset_hash NOT GLOB '*[^0-9a-f]*'
        )
      ),
      CHECK (length(updated_at) > 0)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_block_asset_refs_project_uri
      ON block_asset_refs(project_id, asset_uri, block_id);
    CREATE INDEX IF NOT EXISTS idx_block_asset_refs_document_freshness
      ON block_asset_refs(document_id, document_generation, projected_seq);

    CREATE TRIGGER IF NOT EXISTS block_asset_refs_validate_insert
      BEFORE INSERT ON block_asset_refs
      WHEN NOT EXISTS (
        SELECT 1
        FROM documents document
        INNER JOIN block_documents ownership
          ON ownership.document_id = document.id
          AND ownership.project_id = document.project_id
        INNER JOIN document_block_index block_index
          ON block_index.document_id = document.id
          AND block_index.block_id = NEW.block_id
        WHERE document.id = NEW.document_id
          AND document.project_id = NEW.project_id
          AND document.generation = NEW.document_generation
          AND document.head_seq >= NEW.projected_seq
          AND ownership.block_id = NEW.owner_block_id
          AND block_index.projected_seq = NEW.projected_seq
      )
      BEGIN
        SELECT RAISE(ABORT, 'Block asset projection source is invalid or from the future');
      END;

    CREATE TRIGGER IF NOT EXISTS block_asset_refs_validate_update
      BEFORE UPDATE ON block_asset_refs
      WHEN NOT EXISTS (
        SELECT 1
        FROM documents document
        INNER JOIN block_documents ownership
          ON ownership.document_id = document.id
          AND ownership.project_id = document.project_id
        INNER JOIN document_block_index block_index
          ON block_index.document_id = document.id
          AND block_index.block_id = NEW.block_id
        WHERE document.id = NEW.document_id
          AND document.project_id = NEW.project_id
          AND document.generation = NEW.document_generation
          AND document.head_seq >= NEW.projected_seq
          AND ownership.block_id = NEW.owner_block_id
          AND block_index.projected_seq = NEW.projected_seq
      )
      BEGIN
        SELECT RAISE(ABORT, 'Block asset projection source is invalid or from the future');
      END;

    CREATE TABLE IF NOT EXISTS card_read_model (
      card_block_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      location_kind TEXT NOT NULL,
      containing_document_id TEXT,
      top_level_rank_key TEXT,
      location_revision INTEGER NOT NULL CHECK (location_revision >= 1),
      metadata_revision INTEGER NOT NULL CHECK (metadata_revision >= 1),
      document_id TEXT NOT NULL UNIQUE,
      document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
      document_projected_seq INTEGER NOT NULL CHECK (document_projected_seq >= 0),
      document_schema_version INTEGER NOT NULL CHECK (document_schema_version >= 1),
      document_authority TEXT NOT NULL,
      membership_id TEXT,
      database_block_id TEXT,
      view_id TEXT,
      view_group_key TEXT,
      view_rank_key TEXT,
      title TEXT NOT NULL,
      description_preview TEXT NOT NULL,
      description_length INTEGER NOT NULL CHECK (description_length >= 0),
      has_description INTEGER NOT NULL CHECK (has_description IN (0, 1)),
      database_values_json TEXT NOT NULL DEFAULT '{}',
      intrinsic_properties_json TEXT NOT NULL DEFAULT '{}',
      property_revisions_json TEXT NOT NULL DEFAULT '{}',
      projection_version INTEGER NOT NULL DEFAULT 1
        CHECK (projection_version >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (card_block_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (containing_document_id, project_id)
        REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (membership_id, database_block_id, project_id)
        REFERENCES database_memberships(id, database_block_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (view_id, project_id)
        REFERENCES database_views(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (lifecycle IN ('active', 'archived', 'deleted')),
      CHECK (location_kind IN ('space', 'document')),
      CHECK (
        (location_kind = 'space' AND containing_document_id IS NULL)
        OR (location_kind = 'document' AND containing_document_id IS NOT NULL)
      ),
      CHECK (document_authority IN ('legacy_shadow', 'ydoc_primary')),
      CHECK (
        (membership_id IS NULL AND database_block_id IS NULL)
        OR (membership_id IS NOT NULL AND database_block_id IS NOT NULL)
      ),
      CHECK (view_id IS NULL OR membership_id IS NOT NULL),
      CHECK (
        json_valid(database_values_json)
        AND json_type(database_values_json) = 'object'
      ),
      CHECK (
        json_valid(intrinsic_properties_json)
        AND json_type(intrinsic_properties_json) = 'object'
      ),
      CHECK (
        json_valid(property_revisions_json)
        AND json_type(property_revisions_json) = 'object'
      ),
      CHECK (length(created_at) > 0 AND length(updated_at) > 0)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_card_read_model_project_lifecycle
      ON card_read_model(project_id, lifecycle, card_block_id);
    CREATE INDEX IF NOT EXISTS idx_card_read_model_view_order
      ON card_read_model(view_id, view_group_key, view_rank_key, card_block_id)
      WHERE view_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_card_read_model_document_freshness
      ON card_read_model(document_id, document_generation, document_projected_seq);

    CREATE TRIGGER IF NOT EXISTS card_read_model_validate_insert
      BEFORE INSERT ON card_read_model
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks card
        INNER JOIN block_documents ownership
          ON ownership.block_id = card.id
          AND ownership.project_id = card.project_id
        INNER JOIN documents document
          ON document.id = ownership.document_id
          AND document.project_id = ownership.project_id
        INNER JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE card.id = NEW.card_block_id
          AND card.project_id = NEW.project_id
          AND card.type = 'card'
          AND card.lifecycle = NEW.lifecycle
          AND card.location_kind = NEW.location_kind
          AND card.containing_document_id IS NEW.containing_document_id
          AND card.location_revision = NEW.location_revision
          AND card.metadata_revision = NEW.metadata_revision
          AND ownership.document_id = NEW.document_id
          AND document.readiness = 'ready'
          AND document.authority = NEW.document_authority
          AND document.generation = NEW.document_generation
          AND document.schema_version = NEW.document_schema_version
          AND document.head_seq >= NEW.document_projected_seq
          AND materialization.generation = NEW.document_generation
          AND materialization.projected_seq = NEW.document_projected_seq
          AND materialization.title = NEW.title
          AND materialization.preview = NEW.description_preview
          AND NEW.description_length = length(materialization.nfm)
          AND NEW.has_description = CASE
            WHEN length(trim(materialization.nfm)) > 0 THEN 1
            ELSE 0
          END
      ) OR (
        NEW.membership_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_memberships membership
          WHERE membership.id = NEW.membership_id
            AND membership.database_block_id = NEW.database_block_id
            AND membership.card_block_id = NEW.card_block_id
            AND membership.project_id = NEW.project_id
            AND membership.removed_at IS NULL
        )
      ) OR (
        NEW.view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_views view
          WHERE view.id = NEW.view_id
            AND view.project_id = NEW.project_id
            AND view.database_block_id = NEW.database_block_id
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Card read model source coordinates are invalid or stale');
      END;

    CREATE TRIGGER IF NOT EXISTS card_read_model_validate_update
      BEFORE UPDATE ON card_read_model
      WHEN NOT EXISTS (
        SELECT 1
        FROM blocks card
        INNER JOIN block_documents ownership
          ON ownership.block_id = card.id
          AND ownership.project_id = card.project_id
        INNER JOIN documents document
          ON document.id = ownership.document_id
          AND document.project_id = ownership.project_id
        INNER JOIN document_materializations materialization
          ON materialization.document_id = document.id
        WHERE card.id = NEW.card_block_id
          AND card.project_id = NEW.project_id
          AND card.type = 'card'
          AND card.lifecycle = NEW.lifecycle
          AND card.location_kind = NEW.location_kind
          AND card.containing_document_id IS NEW.containing_document_id
          AND card.location_revision = NEW.location_revision
          AND card.metadata_revision = NEW.metadata_revision
          AND ownership.document_id = NEW.document_id
          AND document.readiness = 'ready'
          AND document.authority = NEW.document_authority
          AND document.generation = NEW.document_generation
          AND document.schema_version = NEW.document_schema_version
          AND document.head_seq >= NEW.document_projected_seq
          AND materialization.generation = NEW.document_generation
          AND materialization.projected_seq = NEW.document_projected_seq
          AND materialization.title = NEW.title
          AND materialization.preview = NEW.description_preview
          AND NEW.description_length = length(materialization.nfm)
          AND NEW.has_description = CASE
            WHEN length(trim(materialization.nfm)) > 0 THEN 1
            ELSE 0
          END
      ) OR (
        NEW.membership_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_memberships membership
          WHERE membership.id = NEW.membership_id
            AND membership.database_block_id = NEW.database_block_id
            AND membership.card_block_id = NEW.card_block_id
            AND membership.project_id = NEW.project_id
            AND membership.removed_at IS NULL
        )
      ) OR (
        NEW.view_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM database_views view
          WHERE view.id = NEW.view_id
            AND view.project_id = NEW.project_id
            AND view.database_block_id = NEW.database_block_id
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Card read model source coordinates are invalid or stale');
      END;
  `);
}

const LEGACY_CARD_CONTENT_UPDATE_COLUMNS_SQL = [
  "project_id",
  "title",
  "description",
].join(", ");

const LEGACY_CARD_PRIMARY_REJECTED_UPDATE_COLUMNS_SQL = "title, description";

interface LegacyCardShadowTriggerInput {
  readonly name: string;
  readonly eventSql: string;
  readonly rowAlias: "NEW" | "OLD";
  readonly operation: "insert" | "update" | "delete";
  readonly previousProjectIdSql: string;
  readonly whenSql: string;
}

function makeLegacyCardShadowEnqueueTriggerSql(
  input: LegacyCardShadowTriggerInput,
): string {
  const row = input.rowAlias;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  return `
    CREATE TRIGGER IF NOT EXISTS ${input.name}
      AFTER ${input.eventSql} ON cards
      WHEN ${input.whenSql}
      BEGIN
        INSERT INTO legacy_card_shadow_heads (
          card_id, project_id, last_event_seq, last_source_revision,
          last_operation, updated_at
        ) VALUES (
          ${row}.id,
          ${row}.project_id,
          1,
          ${row}.revision,
          '${input.operation}',
          ${now}
        )
        ON CONFLICT(card_id) DO UPDATE SET
          project_id = excluded.project_id,
          last_event_seq = legacy_card_shadow_heads.last_event_seq + 1,
          last_source_revision = excluded.last_source_revision,
          last_operation = excluded.last_operation,
          updated_at = excluded.updated_at;

        INSERT INTO legacy_card_shadow_jobs (
          id, card_id, source_event_seq, project_id, previous_project_id,
          document_id, expected_document_generation, expected_document_head_seq,
          expected_document_readiness, expected_document_authority,
          source_revision, operation, status, attempt_count,
          enqueued_at, updated_at
        )
        SELECT
          'legacy-shadow:' || head.card_id || ':' || printf('%020d', head.last_event_seq),
          head.card_id,
          head.last_event_seq,
          ${row}.project_id,
          ${input.previousProjectIdSql},
          'document:' || head.card_id,
          COALESCE((
            SELECT document.generation
            FROM documents document
            WHERE document.id = 'document:' || head.card_id
          ), 1),
          COALESCE((
            SELECT document.head_seq
            FROM documents document
            WHERE document.id = 'document:' || head.card_id
          ), 0),
          COALESCE((
            SELECT document.readiness
            FROM documents document
            WHERE document.id = 'document:' || head.card_id
          ), 'pending_genesis'),
          COALESCE((
            SELECT document.authority
            FROM documents document
            WHERE document.id = 'document:' || head.card_id
          ), 'legacy_shadow'),
          ${row}.revision,
          '${input.operation}',
          'pending',
          0,
          ${now},
          ${now}
        FROM legacy_card_shadow_heads head
        WHERE head.card_id = ${row}.id
        ON CONFLICT(id) DO NOTHING;
      END;
  `;
}

function createLegacyCardShadowOutboxSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS legacy_card_shadow_heads (
      card_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      last_event_seq INTEGER NOT NULL CHECK (last_event_seq >= 1),
      last_source_revision INTEGER NOT NULL CHECK (last_source_revision >= 1),
      last_operation TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (last_operation IN ('insert', 'update', 'delete'))
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_legacy_card_shadow_heads_project
      ON legacy_card_shadow_heads(project_id, card_id);

    CREATE TABLE IF NOT EXISTS legacy_card_shadow_jobs (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      source_event_seq INTEGER NOT NULL CHECK (source_event_seq >= 1),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      previous_project_id TEXT,
      document_id TEXT NOT NULL,
      expected_document_generation INTEGER NOT NULL
        CHECK (expected_document_generation >= 1),
      expected_document_head_seq INTEGER NOT NULL
        CHECK (expected_document_head_seq >= 0),
      expected_document_readiness TEXT NOT NULL,
      expected_document_authority TEXT NOT NULL,
      source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
      operation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      claim_token TEXT,
      claimed_at TEXT,
      claim_expires_at TEXT,
      applied_document_head_seq INTEGER CHECK (applied_document_head_seq >= 0),
      last_error TEXT,
      enqueued_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (card_id, source_event_seq),
      CHECK (operation IN ('insert', 'update', 'delete')),
      CHECK (expected_document_readiness IN ('pending_genesis', 'ready', 'failed')),
      CHECK (expected_document_authority = 'legacy_shadow'),
      CHECK (document_id = 'document:' || card_id),
      CHECK (id = 'legacy-shadow:' || card_id || ':' || printf('%020d', source_event_seq)),
      CHECK (operation = 'update' OR previous_project_id IS NULL),
      CHECK (
        (status = 'pending'
          AND claim_token IS NULL
          AND claimed_at IS NULL
          AND claim_expires_at IS NULL
          AND completed_at IS NULL)
        OR (status = 'processing'
          AND claim_token IS NOT NULL
          AND claimed_at IS NOT NULL
          AND claim_expires_at IS NOT NULL
          AND completed_at IS NULL)
        OR (status IN ('applied', 'superseded', 'failed')
          AND claim_token IS NULL
          AND claimed_at IS NULL
          AND claim_expires_at IS NULL
          AND completed_at IS NOT NULL)
      ),
      CHECK (
        (status = 'failed' AND last_error IS NOT NULL)
        OR (status <> 'failed' AND last_error IS NULL)
      ),
      CHECK (status = 'applied' OR applied_document_head_seq IS NULL)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_legacy_card_shadow_jobs_pending
      ON legacy_card_shadow_jobs(status, project_id, enqueued_at, card_id, source_event_seq);
    CREATE INDEX IF NOT EXISTS idx_legacy_card_shadow_jobs_card_ledger
      ON legacy_card_shadow_jobs(card_id, source_event_seq);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_card_shadow_jobs_processing_card
      ON legacy_card_shadow_jobs(card_id)
      WHERE status = 'processing';

    CREATE TRIGGER IF NOT EXISTS legacy_card_shadow_jobs_reject_id_collision
      BEFORE INSERT ON legacy_card_shadow_jobs
      WHEN EXISTS (
        SELECT 1
        FROM legacy_card_shadow_jobs existing
        WHERE existing.id = NEW.id
          AND (
            existing.card_id <> NEW.card_id
            OR existing.source_event_seq <> NEW.source_event_seq
            OR existing.project_id <> NEW.project_id
            OR COALESCE(existing.previous_project_id, '') <>
              COALESCE(NEW.previous_project_id, '')
            OR existing.document_id <> NEW.document_id
            OR existing.expected_document_generation <>
              NEW.expected_document_generation
            OR existing.expected_document_head_seq <>
              NEW.expected_document_head_seq
            OR existing.expected_document_readiness <>
              NEW.expected_document_readiness
            OR existing.expected_document_authority <>
              NEW.expected_document_authority
            OR existing.source_revision <> NEW.source_revision
            OR existing.operation <> NEW.operation
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'legacy Card shadow job id collision');
      END;

    CREATE TRIGGER IF NOT EXISTS cards_legacy_shadow_reject_primary_insert
      BEFORE INSERT ON cards
      WHEN EXISTS (
        SELECT 1
        FROM documents document
        WHERE document.id = 'document:' || NEW.id
          AND document.authority <> 'legacy_shadow'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Y.Doc-primary Cards reject legacy writes');
      END;

    CREATE TRIGGER IF NOT EXISTS cards_legacy_shadow_reject_primary_update
      BEFORE UPDATE OF ${LEGACY_CARD_PRIMARY_REJECTED_UPDATE_COLUMNS_SQL} ON cards
      WHEN EXISTS (
        SELECT 1
        FROM documents document
        WHERE document.id = 'document:' || OLD.id
          AND document.authority <> 'legacy_shadow'
      )
      BEGIN
        SELECT RAISE(ABORT, 'Y.Doc-primary Cards reject legacy writes');
      END;

    ${makeLegacyCardShadowEnqueueTriggerSql({
      name: "cards_legacy_shadow_outbox_after_insert",
      eventSql: "INSERT",
      rowAlias: "NEW",
      operation: "insert",
      previousProjectIdSql: "NULL",
      // Any successful legacy Card insert is either a new identity or an
      // explicit legacy-shadow restore. The BEFORE guard rejects a primary
      // Document first, so this enqueue is self-sufficient even when SQLite
      // runs it before the foundation AFTER INSERT trigger creates Document.
      whenSql: "true",
    })}

    ${makeLegacyCardShadowEnqueueTriggerSql({
      name: "cards_legacy_shadow_outbox_after_update",
      eventSql: `UPDATE OF ${LEGACY_CARD_CONTENT_UPDATE_COLUMNS_SQL}`,
      rowAlias: "NEW",
      operation: "update",
      previousProjectIdSql:
        "CASE WHEN NEW.project_id <> OLD.project_id THEN OLD.project_id ELSE NULL END",
      whenSql: `EXISTS (
        SELECT 1 FROM documents document
        WHERE document.id = 'document:' || OLD.id
          AND document.authority = 'legacy_shadow'
      )`,
    })}

    ${makeLegacyCardShadowEnqueueTriggerSql({
      name: "cards_legacy_shadow_outbox_after_delete",
      eventSql: "DELETE",
      rowAlias: "OLD",
      operation: "delete",
      previousProjectIdSql: "NULL",
      whenSql: `EXISTS (
        SELECT 1 FROM documents document
        WHERE document.id = 'document:' || OLD.id
          AND document.authority = 'legacy_shadow'
      )`,
    })}
  `);
}

export interface EnsureDatabaseOptions {
  onMigrationProgress?: (progress: DatabaseMigrationProgress) => void;
}

export function getSchemaMigrationTargets(
  currentVersion: number,
): number[] | null {
  if (currentVersion === CURRENT_SCHEMA_VERSION) return [];

  if (currentVersion === 26 || currentVersion === 30)
    return [...MIGRATION_TARGETS];
  if (currentVersion === 36)
    return MIGRATION_TARGETS.slice(MIGRATION_TARGETS.indexOf(37));

  const index = MIGRATION_TARGETS.indexOf(
    currentVersion as (typeof MIGRATION_TARGETS)[number],
  );
  if (index >= 0) return MIGRATION_TARGETS.slice(index + 1);
  return null;
}

function getUserVersion(db: Database.Database): number {
  const row = db.prepare("PRAGMA user_version").get() as
    { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function setUserVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

interface CardBehaviorRecordTableNames {
  readonly recurrenceExceptions: string;
  readonly reminderReceipts: string;
  readonly reminderSnoozes: string;
}

const CARD_BEHAVIOR_RECORD_TABLES: CardBehaviorRecordTableNames = {
  recurrenceExceptions: "recurrence_exceptions",
  reminderReceipts: "reminder_receipts",
  reminderSnoozes: "reminder_snoozes",
};

const V66_CARD_BEHAVIOR_RECORD_TABLES: CardBehaviorRecordTableNames = {
  recurrenceExceptions: "recurrence_exceptions_v66",
  reminderReceipts: "reminder_receipts_v66",
  reminderSnoozes: "reminder_snoozes_v66",
};

const CARD_BEHAVIOR_OWNER_TRIGGER_DEFINITIONS = [
  {
    tableName: "recurrence_exceptions",
    blockIdColumn: "card_id",
    label: "recurrence exception",
  },
  {
    tableName: "reminder_receipts",
    blockIdColumn: "card_id",
    label: "reminder receipt",
  },
  {
    tableName: "reminder_snoozes",
    blockIdColumn: "card_id",
    label: "reminder snooze",
  },
  {
    tableName: "scheduled_card_index",
    blockIdColumn: "card_block_id",
    label: "scheduled Card index",
  },
] as const;

function createCardBehaviorRecordTables(
  db: Database.Database,
  tables: CardBehaviorRecordTableNames,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tables.recurrenceExceptions} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      occurrence_start TEXT NOT NULL,
      exception_type TEXT NOT NULL,
      override_start TEXT,
      override_end TEXT,
      override_reminders_json TEXT,
      created TEXT NOT NULL,
      FOREIGN KEY (card_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (exception_type IN ('skip', 'override_time'))
    );

    CREATE TABLE IF NOT EXISTS ${tables.reminderReceipts} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      occurrence_start TEXT NOT NULL,
      reminder_offset_minutes INTEGER NOT NULL,
      delivered_at TEXT NOT NULL,
      FOREIGN KEY (card_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ${tables.reminderSnoozes} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      occurrence_start TEXT NOT NULL,
      due_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT,
      FOREIGN KEY (card_id, project_id)
        REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE
    );
  `);
}

function createCardBehaviorRecordIndexesAndTriggers(
  db: Database.Database,
): void {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recurrence_exceptions_unique
      ON recurrence_exceptions(project_id, card_id, occurrence_start);
    CREATE INDEX IF NOT EXISTS idx_recurrence_exceptions_lookup
      ON recurrence_exceptions(project_id, card_id, occurrence_start);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_receipts_unique
      ON reminder_receipts(
        project_id, card_id, occurrence_start, reminder_offset_minutes
      );
    CREATE INDEX IF NOT EXISTS idx_reminder_receipts_lookup
      ON reminder_receipts(project_id, delivered_at DESC);

    CREATE INDEX IF NOT EXISTS idx_reminder_snoozes_lookup
      ON reminder_snoozes(project_id, due_at, consumed_at);
  `);

  for (const definition of CARD_BEHAVIOR_OWNER_TRIGGER_DEFINITIONS) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${definition.tableName}_require_card_block_insert
        BEFORE INSERT ON ${definition.tableName}
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW.${definition.blockIdColumn}
            AND block.project_id = NEW.project_id
            AND block.type = 'card'
        )
        BEGIN
          SELECT RAISE(ABORT, '${definition.label} owner must be a Card Block in the same Project');
        END;

      CREATE TRIGGER IF NOT EXISTS ${definition.tableName}_require_card_block_update
        BEFORE UPDATE OF ${definition.blockIdColumn}, project_id
        ON ${definition.tableName}
        WHEN NOT EXISTS (
          SELECT 1
          FROM blocks block
          WHERE block.id = NEW.${definition.blockIdColumn}
            AND block.project_id = NEW.project_id
            AND block.type = 'card'
        )
        BEGIN
          SELECT RAISE(ABORT, '${definition.label} owner must be a Card Block in the same Project');
        END;
    `);
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS card_behavior_records_guard_block_retype
      BEFORE UPDATE OF type ON blocks
      WHEN NEW.type <> 'card'
        AND (
          EXISTS (
            SELECT 1 FROM recurrence_exceptions behavior
            WHERE behavior.card_id = OLD.id
              AND behavior.project_id = OLD.project_id
          )
          OR EXISTS (
            SELECT 1 FROM reminder_receipts behavior
            WHERE behavior.card_id = OLD.id
              AND behavior.project_id = OLD.project_id
          )
          OR EXISTS (
            SELECT 1 FROM reminder_snoozes behavior
            WHERE behavior.card_id = OLD.id
              AND behavior.project_id = OLD.project_id
          )
          OR EXISTS (
            SELECT 1 FROM scheduled_card_index behavior
            WHERE behavior.card_block_id = OLD.id
              AND behavior.project_id = OLD.project_id
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'a Block with Card behavior dependencies must remain type card');
      END;
  `);
}

function dropCardBehaviorRecordTriggers(db: Database.Database): void {
  for (const definition of CARD_BEHAVIOR_OWNER_TRIGGER_DEFINITIONS) {
    db.exec(`
      DROP TRIGGER IF EXISTS ${definition.tableName}_require_card_block_insert;
      DROP TRIGGER IF EXISTS ${definition.tableName}_require_card_block_update;
    `);
  }
  db.exec("DROP TRIGGER IF EXISTS card_behavior_records_guard_block_retype");
}

function assertCardBehaviorRecordOwners(
  db: Database.Database,
  tables: CardBehaviorRecordTableNames,
): void {
  for (const [label, tableName] of [
    ["recurrence exception", tables.recurrenceExceptions],
    ["reminder receipt", tables.reminderReceipts],
    ["reminder snooze", tables.reminderSnoozes],
  ] as const) {
    const invalid = db
      .prepare(
        `
        SELECT behavior.card_id, behavior.project_id
        FROM ${tableName} behavior
        LEFT JOIN blocks block
          ON block.id = behavior.card_id
         AND block.project_id = behavior.project_id
        WHERE block.id IS NULL OR block.type <> 'card'
        LIMIT 1
      `,
      )
      .get() as
      { readonly card_id: string; readonly project_id: string } | undefined;
    if (!invalid) continue;
    throw new Error(
      `Cannot migrate ${label} for ${invalid.card_id}: owner is not a Card Block in Project ${invalid.project_id}`,
    );
  }

  const invalidSchedule = db
    .prepare(
      `
      SELECT schedule.card_block_id, schedule.project_id
      FROM scheduled_card_index schedule
      LEFT JOIN blocks block
        ON block.id = schedule.card_block_id
       AND block.project_id = schedule.project_id
      WHERE block.id IS NULL OR block.type <> 'card'
      LIMIT 1
    `,
    )
    .get() as
    { readonly card_block_id: string; readonly project_id: string } | undefined;
  if (!invalidSchedule) return;
  throw new Error(
    `Cannot migrate scheduled Card index for ${invalidSchedule.card_block_id}: owner is not a Card Block in Project ${invalidSchedule.project_id}`,
  );
}

function assertCardBehaviorForeignKeys(db: Database.Database): void {
  for (const tableName of [
    "recurrence_exceptions",
    "reminder_receipts",
    "reminder_snoozes",
    "scheduled_card_index",
  ]) {
    const violations = db
      .prepare(`PRAGMA foreign_key_check(${tableName})`)
      .all();
    if (violations.length === 0) continue;
    throw new Error(
      `Card behavior migration left foreign-key violations in ${tableName}`,
    );
  }
}

function createCardBehaviorRecordSchema(db: Database.Database): void {
  createCardBehaviorRecordTables(db, CARD_BEHAVIOR_RECORD_TABLES);
  createCardBehaviorRecordIndexesAndTriggers(db);
}

function createLatestSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_sources (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      root TEXT NOT NULL,
      root_key TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      PRIMARY KEY (project_id, root_key)
    );

    CREATE INDEX IF NOT EXISTS idx_project_sources_project_order
      ON project_sources(project_id, "order", created);

    CREATE TABLE IF NOT EXISTS project_order (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pinned_project_order (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      description_preview TEXT NOT NULL DEFAULT '',
      description_length INTEGER NOT NULL DEFAULT 0,
      has_description INTEGER NOT NULL DEFAULT 0,
      description_read_model_revision INTEGER NOT NULL DEFAULT 0,
      description_revision_id INTEGER,
      priority TEXT,
      estimate TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      due_date TEXT,
      assignee TEXT,
      agent_blocked INTEGER NOT NULL DEFAULT 0,
      agent_status TEXT,
      run_in_target TEXT NOT NULL DEFAULT 'local_project',
      run_in_local_path TEXT,
      run_in_base_branch TEXT,
      run_in_worktree_path TEXT,
      run_in_environment_path TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      scheduled_start TEXT,
      scheduled_end TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      recurrence_json TEXT,
      reminders_json TEXT NOT NULL DEFAULT '[]',
      schedule_timezone TEXT,
      created TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done')),
      CHECK (priority IS NULL OR priority IN ('p0-critical', 'p1-high', 'p2-medium', 'p3-low', 'p4-later')),
      CHECK (estimate IS NULL OR estimate IN ('xs', 's', 'm', 'l', 'xl'))
    );

    CREATE INDEX IF NOT EXISTS idx_cards_project_archived_status ON cards(project_id, archived, status);
    CREATE INDEX IF NOT EXISTS idx_cards_project_archived_status_order ON cards(project_id, archived, status, "order");
    CREATE INDEX IF NOT EXISTS idx_cards_schedule ON cards(project_id, scheduled_start, scheduled_end);

    CREATE TABLE IF NOT EXISTS card_search_units (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      card_revision INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      UNIQUE(card_id),
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done'))
    );

    CREATE INDEX IF NOT EXISTS idx_card_search_units_project
      ON card_search_units(project_id);
    CREATE INDEX IF NOT EXISTS idx_card_search_units_card
      ON card_search_units(card_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS card_search_units_fts USING fts5(
      text,
      content='card_search_units',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 2 tokenchars '-_/@.:#'",
      prefix='2 3 4'
    );

    CREATE TRIGGER IF NOT EXISTS card_search_units_ai
      AFTER INSERT ON card_search_units
      BEGIN
        INSERT INTO card_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

    CREATE TRIGGER IF NOT EXISTS card_search_units_ad
      AFTER DELETE ON card_search_units
      BEGIN
        INSERT INTO card_search_units_fts(card_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
      END;

    CREATE TRIGGER IF NOT EXISTS card_search_units_au
      AFTER UPDATE ON card_search_units
      BEGIN
        INSERT INTO card_search_units_fts(card_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
        INSERT INTO card_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

    CREATE TABLE IF NOT EXISTS description_blocks (
      hash TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS description_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      parent_revision_id INTEGER,
      kind TEXT NOT NULL,
      block_hashes_json TEXT,
      ops_json TEXT,
      created_at TEXT NOT NULL,
      CHECK (kind IN ('snapshot', 'delta'))
    );

    CREATE INDEX IF NOT EXISTS idx_description_revisions_card_created
      ON description_revisions(card_id, created_at, id);

    CREATE TABLE IF NOT EXISTS codex_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      thread_name TEXT,
      thread_source TEXT,
      agent_nickname TEXT,
      agent_role TEXT,
      thread_preview TEXT NOT NULL DEFAULT '',
      model_provider TEXT NOT NULL DEFAULT '',
      cwd TEXT,
      managed_worktree_path TEXT,
      projectless_output_directory TEXT,
      projectless_workspace_browser_root TEXT,
      status_type TEXT NOT NULL DEFAULT 'notLoaded',
      status_active_flags_json TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_threads_project_updated
      ON codex_threads(project_id, updated_at DESC);

	    CREATE TABLE IF NOT EXISTS codex_scheduled_automations (
	      automation_id TEXT PRIMARY KEY,
	      kind TEXT NOT NULL,
	      status TEXT NOT NULL,
	      target_thread_id TEXT,
	      name TEXT NOT NULL,
	      prompt TEXT NOT NULL DEFAULT '',
	      rrule TEXT,
	      model TEXT,
	      reasoning_effort TEXT,
	      cwds_json TEXT NOT NULL DEFAULT '[]',
	      execution_environment TEXT NOT NULL DEFAULT 'worktree',
	      local_environment_config_path TEXT,
	      next_run_at INTEGER,
	      last_run_at INTEGER,
	      created_at INTEGER NOT NULL,
	      updated_at INTEGER NOT NULL,
	      CHECK (kind IN ('cron', 'heartbeat')),
	      CHECK (status IN ('ACTIVE', 'PAUSED', 'DELETED')),
	      CHECK (execution_environment IN ('local', 'worktree')),
	      CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))
	    ) WITHOUT ROWID;

	    CREATE INDEX IF NOT EXISTS idx_codex_scheduled_automations_target
	      ON codex_scheduled_automations(target_thread_id, kind, status, created_at, automation_id);

	    CREATE TABLE IF NOT EXISTS codex_automation_runs (
	      thread_id TEXT PRIMARY KEY,
	      automation_id TEXT NOT NULL,
	      status TEXT NOT NULL,
	      read_at INTEGER,
	      thread_title TEXT,
	      source_cwd TEXT,
	      inbox_title TEXT,
	      inbox_summary TEXT,
	      archived_user_message TEXT,
	      archived_assistant_message TEXT,
	      archived_reason TEXT,
	      created_at INTEGER NOT NULL,
	      updated_at INTEGER NOT NULL,
	      CHECK (status IN ('IN_PROGRESS', 'PENDING_REVIEW', 'ACCEPTED', 'ARCHIVED'))
	    ) WITHOUT ROWID;

	    CREATE INDEX IF NOT EXISTS idx_codex_automation_runs_automation_status_created
	      ON codex_automation_runs(automation_id, status, created_at DESC);
	    CREATE INDEX IF NOT EXISTS idx_codex_automation_runs_unread
	      ON codex_automation_runs(read_at, status, updated_at);

	    CREATE TABLE IF NOT EXISTS codex_background_processes (
      process_record_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      thread_title TEXT,
      item_id TEXT NOT NULL,
      turn_id TEXT,
      command TEXT NOT NULL,
      cwd TEXT,
      app_server_process_id TEXT,
      os_pid INTEGER,
      terminal_session_id TEXT,
      source TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      CHECK (source IN ('app-server', 'terminal-action'))
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_background_processes_thread_updated
      ON codex_background_processes(thread_id, updated_at_ms DESC, process_record_id);

    CREATE TABLE IF NOT EXISTS project_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      no_thread_fallback_title TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      pinned_order INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      unread INTEGER NOT NULL DEFAULT 0,
      left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
      panel_state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (pinned IN (0, 1)),
      CHECK (archived IN (0, 1)),
      CHECK (unread IN (0, 1)),
      CHECK (left_pane_collapsed IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_project_sessions_project_order
      ON project_sessions(project_id, "order", created_at);
    CREATE INDEX IF NOT EXISTS idx_project_sessions_project_sidebar
      ON project_sessions(project_id, archived, pinned, pinned_order, "order");

    CREATE TABLE IF NOT EXISTS project_session_tabs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      panel_id TEXT NOT NULL DEFAULT 'right',
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL,
      state_key INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL DEFAULT '{}',
      "order" INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kind IN (${PROJECT_SESSION_TAB_KIND_CHECK_VALUES})),
      CHECK (panel_id IN (${PROJECT_SESSION_PANEL_ID_CHECK_VALUES}))
    );

    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_session_order
      ON project_session_tabs(session_id, panel_id, "order", created_at);
    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_project
      ON project_session_tabs(project_id);

    CREATE TABLE IF NOT EXISTS project_session_threads (
      session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_project_session_threads_thread
      ON project_session_threads(thread_id);

    CREATE TABLE IF NOT EXISTS codex_pinned_threads (
      thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      pinned_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_pinned_threads_order
      ON codex_pinned_threads(pinned_order, created_at);

    CREATE TABLE IF NOT EXISTS thread_search_units (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES project_sessions(id) ON DELETE SET NULL,
      turn_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      source_updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      CHECK (role IN ('user', 'assistant'))
    );

    CREATE INDEX IF NOT EXISTS idx_thread_search_units_thread
      ON thread_search_units(thread_id);
    CREATE INDEX IF NOT EXISTS idx_thread_search_units_project
      ON thread_search_units(project_id);
    CREATE INDEX IF NOT EXISTS idx_thread_search_units_session
      ON thread_search_units(session_id);

    CREATE TABLE IF NOT EXISTS thread_search_thread_state (
      thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      source_updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      index_version INTEGER NOT NULL DEFAULT 1,
      unit_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      failed_at INTEGER,
      retry_after INTEGER,
      CHECK (status IN ('ready', 'stale', 'failed'))
    ) WITHOUT ROWID;

    CREATE VIRTUAL TABLE IF NOT EXISTS thread_search_units_fts USING fts5(
      text,
      content='thread_search_units',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 2 tokenchars '-_/@.:#'",
      prefix='2 3 4'
    );

    CREATE TRIGGER IF NOT EXISTS thread_search_units_ai
      AFTER INSERT ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

    CREATE TRIGGER IF NOT EXISTS thread_search_units_ad
      AFTER DELETE ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(thread_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
      END;

    CREATE TRIGGER IF NOT EXISTS thread_search_units_au
      AFTER UPDATE ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(thread_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
        INSERT INTO thread_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      card_id TEXT NOT NULL,
      status TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL,
      previous_values TEXT,
      new_values TEXT,
      from_status TEXT,
      to_status TEXT,
      from_archived INTEGER,
      to_archived INTEGER,
      from_order INTEGER,
      to_order INTEGER,
      card_snapshot TEXT,
      previous_description_revision_id INTEGER,
      new_description_revision_id INTEGER,
      snapshot_description_revision_id INTEGER,
      session_id TEXT,
      group_id TEXT,
      is_undone INTEGER NOT NULL DEFAULT 0,
      undo_of INTEGER,
      CHECK (operation IN ('create', 'update', 'delete', 'move')),
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done')),
      CHECK (from_status IS NULL OR from_status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done')),
      CHECK (to_status IS NULL OR to_status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done'))
    );

    CREATE INDEX IF NOT EXISTS idx_history_project ON history(project_id);
    CREATE INDEX IF NOT EXISTS idx_history_card ON history(card_id);
    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id);
    CREATE INDEX IF NOT EXISTS idx_history_group ON history(project_id, group_id);
    CREATE INDEX IF NOT EXISTS idx_history_group_global ON history(group_id);

    CREATE TABLE IF NOT EXISTS card_history_snapshots (
      history_id INTEGER PRIMARY KEY REFERENCES history(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      status TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      card_snapshot TEXT NOT NULL,
      description_revision_id INTEGER,
      created_at TEXT NOT NULL,
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done'))
    );

    CREATE INDEX IF NOT EXISTS idx_card_history_snapshots_project_card_history
      ON card_history_snapshots(project_id, card_id, history_id);

    CREATE TABLE IF NOT EXISTS canvas (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      elements TEXT NOT NULL DEFAULT '[]',
      app_state TEXT NOT NULL DEFAULT '{}',
      files TEXT NOT NULL DEFAULT '{}',
      updated TEXT NOT NULL
    );
  `);
  createBlockFoundationSchema(db);
  createCardBehaviorRecordSchema(db);
  createLegacyCardShadowOutboxSchema(db);
  createForeignReferenceMigrationSchema(db);
  createAtomicBlockRelocationSchema(db);
  createBlockSecondaryAuthorityFoundationSchema(db);
}

function ensureBlockStoreMetadata(db: Database.Database, now: string): void {
  db.prepare(
    `
    INSERT INTO block_store_metadata (id, store_epoch, created_at, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `,
  ).run(randomUUID(), now, now);
}

function ensurePrimaryDatabaseProperties(
  db: Database.Database,
  projectId: string,
  now: string,
): void {
  const databaseBlockId = primaryDatabaseBlockId(projectId);
  const insert = db.prepare(`
    INSERT INTO database_properties (
      id, database_block_id, project_id, key, name, value_type,
      config_json, rank_key, lifecycle, schema_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  for (const definition of PRIMARY_DATABASE_PROPERTY_DEFINITIONS) {
    insert.run(
      primaryDatabasePropertyId(projectId, definition.key),
      databaseBlockId,
      projectId,
      definition.key,
      definition.name,
      definition.valueType,
      JSON.stringify(definition.config),
      definition.rankKey,
      now,
      now,
    );
  }
}

export function ensureBlockFoundationForProject(
  db: Database.Database,
  projectId: string,
  now: string,
): void {
  ensureBlockStoreMetadata(db, now);

  const databaseBlockId = primaryDatabaseBlockId(projectId);
  const viewId = primaryDatabaseViewId(projectId);

  db.prepare(
    `
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'database', 'active', 'space', NULL, 1, 1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `,
  ).run(databaseBlockId, projectId, now, now);

  db.prepare(
    `
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(block_id) DO NOTHING
  `,
  ).run(
    databaseBlockId,
    projectId,
    databaseFractionalRankForOrdinal(0, 1),
    now,
    now,
  );

  db.prepare(
    `
    INSERT INTO database_capabilities (
      block_id, project_id, is_primary, schema_key, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(block_id) DO NOTHING
  `,
  ).run(databaseBlockId, projectId, PRIMARY_DATABASE_SCHEMA_KEY, now, now);

  ensurePrimaryDatabaseProperties(db, projectId, now);

  db.prepare(
    `
    INSERT INTO database_views (
      id, database_block_id, project_id, name, kind, config_json,
      is_primary, revision, rank_key, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, 'Kanban', 'kanban', ?, 1, 1, ?, 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `,
  ).run(
    viewId,
    databaseBlockId,
    projectId,
    makePrimaryDatabaseViewConfig(projectId),
    databaseFractionalRankForOrdinal(0, 1),
    now,
    now,
  );
}

export function deleteBlockFoundationForProject(
  db: Database.Database,
  projectId: string,
): void {
  // Delete Cards while their Project still exists so the legacy outbox can
  // record each delete without violating its Project foreign key. The rows are
  // then removed below with the rest of the Project-scoped migration ledger.
  db.prepare("DELETE FROM cards WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM legacy_card_shadow_jobs WHERE project_id = ?").run(
    projectId,
  );
  db.prepare("DELETE FROM legacy_card_shadow_heads WHERE project_id = ?").run(
    projectId,
  );
  db.prepare("DELETE FROM block_documents WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM blocks WHERE project_id = ?").run(projectId);
  db.prepare("DELETE FROM documents WHERE project_id = ?").run(projectId);
}

interface LegacyCardFoundationRow {
  id: string;
  project_id: string;
  archived: number;
  status: string;
  revision: number;
  order: number;
  created: string;
}

function seedLegacyCardBlockFoundation(db: Database.Database): void {
  const projectRows = db
    .prepare("SELECT id, created FROM projects")
    .all() as Array<{
    id: string;
    created: string;
  }>;
  for (const project of projectRows) {
    ensureBlockFoundationForProject(db, project.id, project.created);
  }

  const cards = db
    .prepare(
      `
    SELECT id, project_id, archived, status, revision, "order", created
    FROM cards
  `,
    )
    .all() as LegacyCardFoundationRow[];

  const insertBlock = db.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind, containing_document_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'card', ?, 'space', NULL, 1, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertPlacement = db.prepare(`
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(block_id) DO NOTHING
  `);
  const insertDocument = db.prepare(`
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, readiness, authority, genesis_source_revision, created_at, updated_at
    ) VALUES (?, ?, 1, 0, ?, 1, X'', 'pending_genesis', 'legacy_shadow', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertOwnership = db.prepare(`
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(block_id) DO NOTHING
  `);
  const insertMembership = db.prepare(`
    INSERT INTO database_memberships (
      id, database_block_id, card_block_id, project_id, created_at, removed_at
    ) VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertViewPosition = db.prepare(`
    INSERT INTO database_view_positions (
      view_id, block_id, project_id, group_key, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(view_id, block_id) DO NOTHING
  `);

  for (const card of cards) {
    const documentId = cardDocumentId(card.id);
    const databaseBlockId = primaryDatabaseBlockId(card.project_id);
    const viewId = primaryDatabaseViewId(card.project_id);
    const lifecycle = card.archived === 1 ? "archived" : "active";
    const rankKey = legacyRankKey(card.order);

    insertBlock.run(
      card.id,
      card.project_id,
      lifecycle,
      Math.max(1, card.revision),
      card.created,
      card.created,
    );
    insertPlacement.run(
      card.id,
      card.project_id,
      `100000000000:${card.status}:${rankKey}`,
      card.created,
      card.created,
    );
    insertDocument.run(
      documentId,
      card.project_id,
      CARD_DOCUMENT_SCHEMA_KEY,
      Math.max(1, card.revision),
      card.created,
      card.created,
    );
    insertOwnership.run(card.id, documentId, card.project_id, card.created);
    insertMembership.run(
      `membership:${card.id}`,
      databaseBlockId,
      card.id,
      card.project_id,
      card.created,
    );
    insertViewPosition.run(
      viewId,
      card.id,
      card.project_id,
      card.status,
      rankKey,
      card.created,
      card.created,
    );
  }

  const parityFailure = db
    .prepare(
      `
    SELECT card.id
    FROM cards card
    LEFT JOIN blocks block
      ON block.id = card.id
      AND block.project_id = card.project_id
      AND block.type = 'card'
    LEFT JOIN block_documents ownership ON ownership.block_id = card.id
    LEFT JOIN documents document
      ON document.id = ownership.document_id
      AND document.project_id = card.project_id
    LEFT JOIN database_memberships membership
      ON membership.card_block_id = card.id
      AND membership.removed_at IS NULL
    LEFT JOIN database_view_positions position
      ON position.block_id = card.id
      AND position.view_id = 'database-view:' || card.project_id || ':primary-kanban'
    WHERE block.id IS NULL
      OR ownership.document_id <> 'document:' || card.id
      OR document.readiness <> 'pending_genesis'
      OR document.authority <> 'legacy_shadow'
      OR membership.database_block_id <> 'database:' || card.project_id || ':primary'
      OR position.block_id IS NULL
    LIMIT 1
  `,
    )
    .get() as { id: string } | undefined;
  if (parityFailure) {
    throw new Error(
      `Block foundation parity failed for Card ${parityFailure.id}`,
    );
  }
}

function makeLegacyOverviewSessionId(projectId: string): string {
  return `overview:${projectId}`;
}

function makeLegacyOverviewDbTabId(projectId: string): string {
  return `overview:${projectId}:db`;
}

function makePanelLayout(tabIds: string[], activeTabId: string | null) {
  return makeProjectSessionPanelLayout(tabIds, activeTabId);
}

function makePanelStateJson(input: {
  rightTabIds: string[];
  bottomTabIds: string[];
  overview: boolean;
}): string {
  return JSON.stringify({
    right: {
      collapsed: false,
      layout: makePanelLayout(input.rightTabIds, input.rightTabIds[0] ?? null),
      size: {
        widthPx: 600,
        fullWidth: input.overview,
      },
    },
    bottom: {
      collapsed: input.bottomTabIds.length === 0,
      layout: makePanelLayout(
        input.bottomTabIds,
        input.bottomTabIds[0] ?? null,
      ),
      size: {
        heightPx: 280,
      },
    },
  });
}

function tableHasColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
): boolean {
  return (
    db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name: string;
    }>
  ).some((column) => column.name === columnName);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(
    db
      .prepare(
        `
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `,
      )
      .get(tableName),
  );
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function ensureProjectSessionsNoThreadFallbackTitle(
  db: Database.Database,
): void {
  if (!tableExists(db, "project_sessions")) return;
  if (tableHasColumn(db, "project_sessions", "no_thread_fallback_title"))
    return;

  const defaultTitle = sqlStringLiteral(DEFAULT_NO_THREAD_FALLBACK_TITLE);
  db.exec(`
    ALTER TABLE project_sessions
      ADD COLUMN no_thread_fallback_title TEXT NOT NULL DEFAULT ${defaultTitle};
  `);

  if (tableHasColumn(db, "project_sessions", "title")) {
    db.exec(`
      UPDATE project_sessions
      SET no_thread_fallback_title = COALESCE(NULLIF(TRIM(title), ''), ${defaultTitle});
    `);
  }
}

function projectSessionNoThreadFallbackSelectExpression(
  db: Database.Database,
): string {
  const fallbackTitle = sqlStringLiteral(DEFAULT_NO_THREAD_FALLBACK_TITLE);
  const candidates = [
    tableHasColumn(db, "project_sessions", "no_thread_fallback_title")
      ? "NULLIF(TRIM(no_thread_fallback_title), '')"
      : null,
    tableHasColumn(db, "project_sessions", "title")
      ? "NULLIF(TRIM(title), '')"
      : null,
  ].filter((candidate): candidate is string => candidate !== null);

  return candidates.length === 0
    ? fallbackTitle
    : `COALESCE(${candidates.join(", ")}, ${fallbackTitle})`;
}

interface LegacyCardThreadOwnershipRow {
  threadId: string;
  projectId: string | null;
  cardId: string | null;
  linkedAt: string | null;
  threadName: string | null;
  threadPreview: string | null;
  cardTitle: string | null;
}

function firstPreviewLine(value: string | null): string {
  return (
    value
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function resolveMigratedThreadSessionTitle(
  row: LegacyCardThreadOwnershipRow,
): string {
  return (
    row.threadName?.trim() ||
    firstPreviewLine(row.threadPreview) ||
    row.cardTitle?.trim() ||
    "Imported chat"
  );
}

function readLegacyCardThreadOwnershipRows(
  db: Database.Database,
): LegacyCardThreadOwnershipRow[] {
  const rows: LegacyCardThreadOwnershipRow[] = [];

  if (
    tableExists(db, "codex_thread_card_links") &&
    tableHasColumn(db, "codex_thread_card_links", "thread_id") &&
    tableHasColumn(db, "codex_thread_card_links", "card_id")
  ) {
    rows.push(
      ...(db
        .prepare(
          `
      SELECT
        l.thread_id AS threadId,
        COALESCE(l.project_id, t.project_id, c.project_id) AS projectId,
        l.card_id AS cardId,
        COALESCE(l.linked_at, t.linked_at) AS linkedAt,
        t.thread_name AS threadName,
        t.thread_preview AS threadPreview,
        c.title AS cardTitle
      FROM codex_thread_card_links l
      LEFT JOIN codex_threads t ON t.thread_id = l.thread_id
      LEFT JOIN cards c ON c.id = l.card_id
    `,
        )
        .all() as LegacyCardThreadOwnershipRow[]),
    );
  }

  if (
    tableExists(db, "codex_threads") &&
    tableHasColumn(db, "codex_threads", "card_id")
  ) {
    rows.push(
      ...(db
        .prepare(
          `
      SELECT
        t.thread_id AS threadId,
        COALESCE(t.project_id, c.project_id) AS projectId,
        t.card_id AS cardId,
        t.linked_at AS linkedAt,
        t.thread_name AS threadName,
        t.thread_preview AS threadPreview,
        c.title AS cardTitle
      FROM codex_threads t
      LEFT JOIN cards c ON c.id = t.card_id
      WHERE t.card_id IS NOT NULL
    `,
        )
        .all() as LegacyCardThreadOwnershipRow[]),
    );
  }

  if (tableExists(db, "codex_card_threads")) {
    rows.push(
      ...(db
        .prepare(
          `
      SELECT
        t.thread_id AS threadId,
        COALESCE(t.project_id, c.project_id) AS projectId,
        t.card_id AS cardId,
        t.linked_at AS linkedAt,
        t.thread_name AS threadName,
        t.thread_preview AS threadPreview,
        c.title AS cardTitle
      FROM codex_card_threads t
      LEFT JOIN cards c ON c.id = t.card_id
    `,
        )
        .all() as LegacyCardThreadOwnershipRow[]),
    );
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.threadId || seen.has(row.threadId)) return false;
    seen.add(row.threadId);
    return true;
  });
}

function migrateLegacyCardThreadOwnershipToSessions(
  db: Database.Database,
): void {
  const rows = readLegacyCardThreadOwnershipRows(db);
  if (rows.length === 0) return;

  ensureProjectSessionsNoThreadFallbackTitle(db);

  const projectExists = db.prepare("SELECT 1 FROM projects WHERE id = ?");
  const threadExists = db.prepare(
    "SELECT 1 FROM codex_threads WHERE thread_id = ?",
  );
  const existingThreadSession = db.prepare(
    "SELECT session_id FROM project_session_threads WHERE thread_id = ?",
  );
  const maxOrder = db.prepare(
    'SELECT MAX("order") AS maxOrder FROM project_sessions WHERE project_id = ?',
  );
  const hasNoThreadFallbackTitle = tableHasColumn(
    db,
    "project_sessions",
    "no_thread_fallback_title",
  );
  const hasLegacyTitle = tableHasColumn(db, "project_sessions", "title");
  const hasOverview = tableHasColumn(db, "project_sessions", "is_overview");
  const sessionColumns = [
    "id",
    "project_id",
    ...(hasNoThreadFallbackTitle ? ["no_thread_fallback_title"] : []),
    ...(hasLegacyTitle ? ["title"] : []),
    ...(hasOverview ? ["is_overview"] : []),
    '"order"',
    "pinned",
    "pinned_order",
    "archived",
    "archived_at",
    "unread",
    "left_pane_collapsed",
    "panel_state_json",
    "created_at",
    "updated_at",
  ];
  const sessionValuePlaceholders = [
    "?",
    "?",
    ...(hasNoThreadFallbackTitle ? ["?"] : []),
    ...(hasLegacyTitle ? ["?"] : []),
    ...(hasOverview ? ["0"] : []),
    "?",
    "0",
    "NULL",
    "0",
    "NULL",
    "0",
    "0",
    "?",
    "?",
    "?",
  ];
  const insertSession = db.prepare(`
    INSERT INTO project_sessions (${sessionColumns.join(", ")})
    VALUES (${sessionValuePlaceholders.join(", ")})
  `);
  const insertLink = db.prepare(`
    INSERT OR IGNORE INTO project_session_threads (session_id, thread_id, linked_at)
    VALUES (?, ?, ?)
  `);

  const migrate = db.transaction(() => {
    const nextOrderByProject = new Map<string, number>();
    for (const row of rows) {
      const projectId = row.projectId?.trim();
      if (!projectId) continue;
      if (!projectExists.get(projectId)) continue;
      if (!threadExists.get(row.threadId)) continue;
      if (existingThreadSession.get(row.threadId)) continue;

      const sessionId = randomUUID();
      const now = new Date().toISOString();
      const linkedAt = row.linkedAt || now;
      const order =
        nextOrderByProject.get(projectId) ??
        ((maxOrder.get(projectId) as { maxOrder: number | null } | undefined)
          ?.maxOrder ?? -1) + 1;
      nextOrderByProject.set(projectId, order + 1);
      const sessionTitle = resolveMigratedThreadSessionTitle(row);
      const sessionArgs = [
        sessionId,
        projectId,
        ...(hasNoThreadFallbackTitle ? [sessionTitle] : []),
        ...(hasLegacyTitle ? [sessionTitle] : []),
        order,
        makePanelStateJson({
          rightTabIds: [],
          bottomTabIds: [],
          overview: false,
        }),
        now,
        now,
      ];
      insertSession.run(...sessionArgs);
      insertLink.run(sessionId, row.threadId, linkedAt);
    }
  });
  migrate();
}

function rebuildCodexThreadsWithoutCardId(db: Database.Database): void {
  if (
    !tableExists(db, "codex_threads") ||
    !tableHasColumn(db, "codex_threads", "card_id")
  ) {
    if (tableExists(db, "codex_thread_card_links")) {
      db.exec("DROP TABLE IF EXISTS codex_thread_card_links");
    }
    return;
  }

  db.exec(`
    DROP TABLE IF EXISTS codex_thread_card_links;
    DROP TABLE IF EXISTS codex_threads_next;

    CREATE TABLE codex_threads_next (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      thread_name TEXT,
      thread_source TEXT,
      agent_nickname TEXT,
      agent_role TEXT,
      thread_preview TEXT NOT NULL DEFAULT '',
      model_provider TEXT NOT NULL DEFAULT '',
      cwd TEXT,
      status_type TEXT NOT NULL DEFAULT 'notLoaded',
      status_active_flags_json TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    INSERT INTO codex_threads_next (
      thread_id, project_id, parent_thread_id, thread_name, thread_source, agent_nickname, agent_role, thread_preview,
      model_provider, cwd, status_type, status_active_flags_json, archived,
      created_at, updated_at, linked_at
    )
    SELECT
      thread_id, project_id, parent_thread_id, thread_name, NULL, NULL, NULL, thread_preview,
      model_provider, cwd, status_type, status_active_flags_json, archived,
      created_at, updated_at, linked_at
    FROM codex_threads;

    DROP TABLE codex_threads;
    ALTER TABLE codex_threads_next RENAME TO codex_threads;

    CREATE INDEX IF NOT EXISTS idx_codex_threads_project_updated
      ON codex_threads(project_id, updated_at DESC);
  `);
}

function migrateMainSchema26To31(db: Database.Database): void {
  createLatestSchema(db);

  if (tableExists(db, "codex_card_threads")) {
    if (!tableHasColumn(db, "codex_card_threads", "parent_thread_id")) {
      db.exec(
        "ALTER TABLE codex_card_threads ADD COLUMN parent_thread_id TEXT",
      );
    }

    db.exec(`
      INSERT OR IGNORE INTO codex_threads (
        thread_id, project_id, parent_thread_id, thread_name, thread_preview,
        model_provider, cwd, status_type, status_active_flags_json, archived,
        created_at, updated_at, linked_at
      )
      SELECT
        thread_id, project_id, parent_thread_id, thread_name, thread_preview,
        model_provider, cwd, status_type, status_active_flags_json, archived,
        created_at, updated_at, linked_at
      FROM codex_card_threads;
    `);
    migrateLegacyCardThreadOwnershipToSessions(db);
    db.exec("DROP TABLE codex_card_threads");
  }

  setUserVersion(db, 31);
}

function migrateSchema30To31(db: Database.Database): void {
  if (!tableHasColumn(db, "project_sessions", "right_pane_collapsed")) {
    setUserVersion(db, 31);
    return;
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS project_sessions_next;

      CREATE TABLE project_sessions_next (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        is_overview INTEGER NOT NULL DEFAULT 0,
        "order" INTEGER NOT NULL,
        left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
        panel_state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (is_overview IN (0, 1)),
        CHECK (left_pane_collapsed IN (0, 1))
      );

      INSERT INTO project_sessions_next (
        id, project_id, title, is_overview, "order", left_pane_collapsed,
        panel_state_json, created_at, updated_at
      )
      SELECT
        id, project_id, title, is_overview, "order", left_pane_collapsed,
        panel_state_json, created_at, updated_at
      FROM project_sessions;

      DROP TABLE project_sessions;
      ALTER TABLE project_sessions_next RENAME TO project_sessions;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_sessions_overview
        ON project_sessions(project_id)
        WHERE is_overview = 1;
      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_order
        ON project_sessions(project_id, "order", created_at);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 31);
}

function migrateToSchema31(
  db: Database.Database,
  currentVersion: number,
): void {
  if (currentVersion === 26) {
    migrateMainSchema26To31(db);
    return;
  }

  if (currentVersion === 30) {
    migrateSchema30To31(db);
    return;
  }

  throw new Error(
    `Unsupported Nodex database migration target 31 from ${currentVersion}`,
  );
}

function migrateSchema31To32(db: Database.Database): void {
  if (!tableHasColumn(db, "project_sessions", "pinned")) {
    db.exec(
      "ALTER TABLE project_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))",
    );
  }
  if (!tableHasColumn(db, "project_sessions", "pinned_order")) {
    db.exec("ALTER TABLE project_sessions ADD COLUMN pinned_order INTEGER");
  }
  if (!tableHasColumn(db, "project_sessions", "archived")) {
    db.exec(
      "ALTER TABLE project_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))",
    );
  }
  if (!tableHasColumn(db, "project_sessions", "archived_at")) {
    db.exec("ALTER TABLE project_sessions ADD COLUMN archived_at TEXT");
  }
  if (!tableHasColumn(db, "project_sessions", "unread")) {
    db.exec(
      "ALTER TABLE project_sessions ADD COLUMN unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0, 1))",
    );
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_sessions_project_sidebar
      ON project_sessions(project_id, archived, pinned, pinned_order, "order");
  `);

  setUserVersion(db, 32);
}

interface ProjectSessionTabMigrationRow {
  id: string;
  session_id: string;
  project_id: string;
  panel_id: string;
  kind: string;
  title: string;
  config_json: string;
  state_key: number;
  state_json: string;
  order: number;
  created_at: string;
  updated_at: string;
}

interface ProjectSessionPanelMigrationRow {
  id: string;
  is_overview: number;
  panel_state_json: string;
}

function normalizeBrowserTabConfigJson(
  projectId: string,
  configJson: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    parsed = {};
  }

  const config =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};

  const normalized: Record<string, unknown> = {
    projectId,
  };

  if (typeof config.url === "string" && config.url.trim()) {
    normalized.url = config.url;
  }
  if (typeof config.title === "string" && config.title.trim()) {
    normalized.title = config.title;
  }
  if (typeof config.faviconUrl === "string" && config.faviconUrl.trim()) {
    normalized.faviconUrl = config.faviconUrl;
  }
  if (typeof config.deviceToolbarVisible === "boolean") {
    normalized.deviceToolbarVisible = config.deviceToolbarVisible;
  }

  return JSON.stringify(normalized);
}

function migrateSchema32To33(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS project_session_tabs_next;

      CREATE TABLE project_session_tabs_next (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        panel_id TEXT NOT NULL DEFAULT 'right',
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        config_json TEXT NOT NULL,
        state_key INTEGER NOT NULL DEFAULT 0,
        state_json TEXT NOT NULL DEFAULT '{}',
        "order" INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (kind IN (${PROJECT_SESSION_TAB_KIND_CHECK_VALUES_V33})),
        CHECK (panel_id IN (${PROJECT_SESSION_PANEL_ID_CHECK_VALUES}))
      );
    `);

    const rows = db
      .prepare(
        `
      SELECT
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json,
        "order", created_at, updated_at
      FROM project_session_tabs
      ORDER BY session_id ASC, panel_id ASC, "order" ASC, created_at ASC
    `,
      )
      .all() as ProjectSessionTabMigrationRow[];

    const insert = db.prepare(`
      INSERT INTO project_session_tabs_next (
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json,
        "order", created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      const kind = row.kind === LEGACY_BROWSER_TAB_KIND ? "browser" : row.kind;
      const configJson =
        row.kind === LEGACY_BROWSER_TAB_KIND
          ? normalizeBrowserTabConfigJson(row.project_id, row.config_json)
          : row.config_json;

      insert.run(
        row.id,
        row.session_id,
        row.project_id,
        row.panel_id,
        kind,
        row.title,
        configJson,
        row.state_key,
        row.state_json,
        row.order,
        row.created_at,
        row.updated_at,
      );
    }

    db.exec(`
      DROP TABLE project_session_tabs;
      ALTER TABLE project_session_tabs_next RENAME TO project_session_tabs;

      CREATE INDEX IF NOT EXISTS idx_project_session_tabs_session_order
        ON project_session_tabs(session_id, panel_id, "order", created_at);
      CREATE INDEX IF NOT EXISTS idx_project_session_tabs_project
        ON project_session_tabs(project_id);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 33);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getSurvivingPanelTabIds(
  survivingIdsBySessionPanel: Map<string, Map<PanelId, string[]>>,
  sessionId: string,
  panelId: PanelId,
): string[] {
  return survivingIdsBySessionPanel.get(sessionId)?.get(panelId) ?? [];
}

function normalizePanelStateAfterRemovedTabs(
  value: unknown,
  tabIds: readonly string[],
  fallbackSize: Record<string, unknown>,
): Record<string, unknown> {
  const panel = isJsonRecord(value) ? value : {};
  const rawCollapsed =
    typeof panel.collapsed === "boolean"
      ? panel.collapsed
      : tabIds.length === 0;
  const layout = pruneEmptyProjectSessionPanelLeaves(
    normalizeProjectSessionPanelLayout(
      isJsonRecord(panel.layout)
        ? (panel.layout as unknown as ProjectSessionPanelLayout)
        : null,
      tabIds,
    ),
  );

  return {
    collapsed: tabIds.length === 0 ? true : rawCollapsed,
    layout,
    size: isJsonRecord(panel.size) ? panel.size : fallbackSize,
  };
}

function pruneRemovedSideChatTabsFromPanelStateJson(
  panelStateJson: string,
  sessionId: string,
  overview: boolean,
  survivingIdsBySessionPanel: Map<string, Map<PanelId, string[]>>,
): string {
  const panels = parseJsonRecord(panelStateJson);
  const rightTabIds = getSurvivingPanelTabIds(
    survivingIdsBySessionPanel,
    sessionId,
    "right",
  );
  const bottomTabIds = getSurvivingPanelTabIds(
    survivingIdsBySessionPanel,
    sessionId,
    "bottom",
  );

  return JSON.stringify({
    right: normalizePanelStateAfterRemovedTabs(panels.right, rightTabIds, {
      widthPx: 600,
      fullWidth: overview,
    }),
    bottom: normalizePanelStateAfterRemovedTabs(panels.bottom, bottomTabIds, {
      heightPx: 280,
    }),
  });
}

function migrateSchema33To34(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS project_session_tabs_next;

      CREATE TABLE project_session_tabs_next (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        panel_id TEXT NOT NULL DEFAULT 'right',
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        config_json TEXT NOT NULL,
        state_key INTEGER NOT NULL DEFAULT 0,
        state_json TEXT NOT NULL DEFAULT '{}',
        "order" INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (kind IN (${PROJECT_SESSION_TAB_KIND_CHECK_VALUES_V34})),
        CHECK (panel_id IN (${PROJECT_SESSION_PANEL_ID_CHECK_VALUES}))
      );
    `);

    const rows = db
      .prepare(
        `
      SELECT
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json,
        "order", created_at, updated_at
      FROM project_session_tabs
      ORDER BY session_id ASC, panel_id ASC, "order" ASC, created_at ASC
    `,
      )
      .all() as ProjectSessionTabMigrationRow[];

    const removedSessionIds = new Set<string>();
    const survivingIdsBySessionPanel = new Map<
      string,
      Map<PanelId, string[]>
    >();
    const insert = db.prepare(`
      INSERT INTO project_session_tabs_next (
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json,
        "order", created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      if (row.kind === "side_chat_placeholder") {
        removedSessionIds.add(row.session_id);
        continue;
      }

      insert.run(
        row.id,
        row.session_id,
        row.project_id,
        row.panel_id,
        row.kind,
        row.title,
        row.config_json,
        row.state_key,
        row.state_json,
        row.order,
        row.created_at,
        row.updated_at,
      );

      if (row.panel_id === "right" || row.panel_id === "bottom") {
        const byPanel =
          survivingIdsBySessionPanel.get(row.session_id) ??
          new Map<PanelId, string[]>();
        const tabIds = byPanel.get(row.panel_id) ?? [];
        tabIds.push(row.id);
        byPanel.set(row.panel_id, tabIds);
        survivingIdsBySessionPanel.set(row.session_id, byPanel);
      }
    }

    db.exec(`
      DROP TABLE project_session_tabs;
      ALTER TABLE project_session_tabs_next RENAME TO project_session_tabs;

      CREATE INDEX IF NOT EXISTS idx_project_session_tabs_session_order
        ON project_session_tabs(session_id, panel_id, "order", created_at);
      CREATE INDEX IF NOT EXISTS idx_project_session_tabs_project
        ON project_session_tabs(project_id);
    `);

    if (removedSessionIds.size > 0) {
      const sessionRows = db
        .prepare(
          `
        SELECT id, is_overview, panel_state_json
        FROM project_sessions
      `,
        )
        .all() as ProjectSessionPanelMigrationRow[];
      const updateSession = db.prepare(`
        UPDATE project_sessions
        SET panel_state_json = ?
        WHERE id = ?
      `);

      for (const session of sessionRows) {
        if (!removedSessionIds.has(session.id)) continue;
        updateSession.run(
          pruneRemovedSideChatTabsFromPanelStateJson(
            session.panel_state_json,
            session.id,
            session.is_overview === 1,
            survivingIdsBySessionPanel,
          ),
          session.id,
        );
      }
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 34);
}

function normalizeFilesTabConfigJson(
  projectId: string,
  configJson: string,
): string {
  const config = parseJsonRecord(configJson);
  return JSON.stringify({
    projectId,
    hostId: "local",
    workspaceRoot:
      typeof config.workspaceRoot === "string" ? config.workspaceRoot : "",
    ...(typeof config.path === "string" && config.path.trim()
      ? { path: config.path }
      : {}),
  });
}

function migrateSchema34To35(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS project_session_tabs_next;

      CREATE TABLE project_session_tabs_next (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        panel_id TEXT NOT NULL DEFAULT 'right',
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        config_json TEXT NOT NULL,
        state_key INTEGER NOT NULL DEFAULT 0,
        state_json TEXT NOT NULL DEFAULT '{}',
        "order" INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (kind IN (${PROJECT_SESSION_TAB_KIND_CHECK_VALUES})),
        CHECK (panel_id IN (${PROJECT_SESSION_PANEL_ID_CHECK_VALUES}))
      );
    `);

    const rows = db
      .prepare(
        `
      SELECT
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json,
        "order", created_at, updated_at
      FROM project_session_tabs
      ORDER BY session_id ASC, panel_id ASC, "order" ASC, created_at ASC
    `,
      )
      .all() as ProjectSessionTabMigrationRow[];

    const insert = db.prepare(`
      INSERT INTO project_session_tabs_next (
        id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json,
        "order", created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      const legacyFiles = row.kind === "files_placeholder";
      insert.run(
        row.id,
        row.session_id,
        row.project_id,
        row.panel_id,
        legacyFiles ? "files" : row.kind,
        row.title,
        legacyFiles
          ? normalizeFilesTabConfigJson(row.project_id, row.config_json)
          : row.config_json,
        row.state_key,
        row.state_json,
        row.order,
        row.created_at,
        row.updated_at,
      );
    }

    db.exec(`
      DROP TABLE project_session_tabs;
      ALTER TABLE project_session_tabs_next RENAME TO project_session_tabs;

      CREATE INDEX IF NOT EXISTS idx_project_session_tabs_session_order
        ON project_session_tabs(session_id, panel_id, "order", created_at);
      CREATE INDEX IF NOT EXISTS idx_project_session_tabs_project
        ON project_session_tabs(project_id);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 35);
}

interface ProjectIdMigrationRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  workspace_path: string | null;
  created: string;
}

function normalizeMigratedSourceRoot(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

function migratedSourceKey(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function rewriteProjectIdsInJson(
  value: unknown,
  idMap: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteProjectIdsInJson(item, idMap));
  }
  if (typeof value !== "object" || value === null) return value;

  const next: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (key === "projectId" && typeof childValue === "string") {
      next[key] = idMap.get(childValue) ?? childValue;
      continue;
    }
    next[key] = rewriteProjectIdsInJson(childValue, idMap);
  }
  return next;
}

function rewriteProjectIdsInConfigJson(
  configJson: string,
  idMap: Map<string, string>,
): string {
  try {
    return JSON.stringify(
      rewriteProjectIdsInJson(JSON.parse(configJson) as unknown, idMap),
    );
  } catch {
    return configJson;
  }
}

function migrateSchema35To37(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    const projects = db
      .prepare(
        `
      SELECT id, name, description, icon, workspace_path, created
      FROM projects
      ORDER BY created ASC
    `,
      )
      .all() as ProjectIdMigrationRow[];
    const idMap = new Map(
      projects.map((project) => [project.id, randomUUID()]),
    );

    db.exec(`
      DROP TABLE IF EXISTS projects_next;
      DROP TABLE IF EXISTS project_id_aliases;
      DROP TABLE IF EXISTS project_sources;
      DROP TABLE IF EXISTS project_order;

      CREATE TABLE projects_next (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT NOT NULL DEFAULT '',
        created TEXT NOT NULL,
        updated TEXT NOT NULL
      );

      CREATE TABLE project_sources (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        root TEXT NOT NULL,
        root_key TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        PRIMARY KEY (project_id, root_key)
      );

      CREATE TABLE project_order (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        "order" INTEGER NOT NULL,
        updated TEXT NOT NULL
      );
    `);

    const insertProject = db.prepare(`
      INSERT INTO projects_next (id, name, description, icon, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertSource = db.prepare(`
      INSERT INTO project_sources (project_id, root, root_key, "order", created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertOrder = db.prepare(`
      INSERT INTO project_order (project_id, "order", updated)
      VALUES (?, ?, ?)
    `);

    projects.forEach((project, index) => {
      const nextId = idMap.get(project.id);
      if (!nextId) return;
      insertProject.run(
        nextId,
        project.name,
        project.description,
        project.icon,
        project.created,
        project.created,
      );
      insertOrder.run(nextId, index, project.created);

      const sourceRoot = normalizeMigratedSourceRoot(project.workspace_path);
      if (sourceRoot) {
        insertSource.run(
          nextId,
          sourceRoot,
          migratedSourceKey(sourceRoot),
          0,
          project.created,
          project.created,
        );
      }
    });

    const projectIdTables = [
      "cards",
      "history",
      "canvas",
      "recurrence_exceptions",
      "reminder_receipts",
      "reminder_snoozes",
      "codex_threads",
      "codex_thread_card_links",
      "project_sessions",
      "project_session_tabs",
      "project_session_threads",
    ].filter((tableName) => tableHasColumn(db, tableName, "project_id"));
    for (const [oldId, nextId] of idMap) {
      for (const tableName of projectIdTables) {
        db.prepare(
          `UPDATE ${tableName} SET project_id = ? WHERE project_id = ?`,
        ).run(nextId, oldId);
      }
      const oldOverviewSessionId = makeLegacyOverviewSessionId(oldId);
      const nextOverviewSessionId = makeLegacyOverviewSessionId(nextId);
      const oldOverviewTabId = makeLegacyOverviewDbTabId(oldId);
      const nextOverviewTabId = makeLegacyOverviewDbTabId(nextId);
      db.prepare(
        "UPDATE project_session_tabs SET session_id = ? WHERE session_id = ?",
      ).run(nextOverviewSessionId, oldOverviewSessionId);
      db.prepare(
        "UPDATE project_session_threads SET session_id = ? WHERE session_id = ?",
      ).run(nextOverviewSessionId, oldOverviewSessionId);
      db.prepare("UPDATE project_session_tabs SET id = ? WHERE id = ?").run(
        nextOverviewTabId,
        oldOverviewTabId,
      );
      db.prepare(
        "UPDATE project_sessions SET id = ?, panel_state_json = replace(panel_state_json, ?, ?) WHERE id = ?",
      ).run(
        nextOverviewSessionId,
        oldOverviewTabId,
        nextOverviewTabId,
        oldOverviewSessionId,
      );
    }

    const tabRows = db
      .prepare("SELECT id, config_json FROM project_session_tabs")
      .all() as Array<{
      id: string;
      config_json: string;
    }>;
    const updateTabConfig = db.prepare(
      "UPDATE project_session_tabs SET config_json = ?, updated_at = ? WHERE id = ?",
    );
    const now = new Date().toISOString();
    for (const tab of tabRows) {
      updateTabConfig.run(
        rewriteProjectIdsInConfigJson(tab.config_json, idMap),
        now,
        tab.id,
      );
    }

    db.exec(`
      DROP TABLE projects;
      ALTER TABLE projects_next RENAME TO projects;

      CREATE INDEX IF NOT EXISTS idx_project_sources_project_order
        ON project_sources(project_id, "order", created);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 37);
}

function migrateSchema36To37(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec("DROP TABLE IF EXISTS project_id_aliases");
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 37);
}

function migrateSchema37To38(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pinned_project_order (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      updated TEXT NOT NULL
    );
  `);

  setUserVersion(db, 38);
}

function migrateSchema38To39(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_history_snapshots (
      history_id INTEGER PRIMARY KEY REFERENCES history(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      status TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      card_snapshot TEXT NOT NULL,
      description_revision_id INTEGER,
      created_at TEXT NOT NULL,
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done'))
    );

    CREATE INDEX IF NOT EXISTS idx_card_history_snapshots_project_card_history
      ON card_history_snapshots(project_id, card_id, history_id);
  `);

  setUserVersion(db, 39);
}

function migrateSchema39To40(db: Database.Database): void {
  const rows = db
    .prepare(
      `
    SELECT id, config_json
    FROM project_session_tabs
    WHERE kind = 'card_stage'
  `,
    )
    .all() as Array<{ id: string; config_json: string }>;

  const findCardProject = db.prepare(
    "SELECT project_id FROM cards WHERE id = ?",
  );
  const updateTabConfig = db.prepare(
    "UPDATE project_session_tabs SET config_json = ?, updated_at = ? WHERE id = ?",
  );
  const now = new Date().toISOString();

  const repair = db.transaction(() => {
    for (const row of rows) {
      const config = parseJsonRecord(row.config_json);
      const cardId =
        typeof config.cardId === "string" ? config.cardId.trim() : "";
      if (!cardId) continue;

      const card = findCardProject.get(cardId) as
        { project_id: string } | undefined;
      if (!card) continue;
      if (config.projectId === card.project_id) continue;

      updateTabConfig.run(
        JSON.stringify({ ...config, projectId: card.project_id }),
        now,
        row.id,
      );
    }
  });
  repair();

  setUserVersion(db, 40);
}

function migrateSchema40To41(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    ensureProjectSessionsNoThreadFallbackTitle(db);
    migrateLegacyCardThreadOwnershipToSessions(db);
    rebuildCodexThreadsWithoutCardId(db);
    db.exec("DROP TABLE IF EXISTS codex_card_threads");
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 41);
}

function migrateSchema41To42(db: Database.Database): void {
  const hasTitleColumn = tableHasColumn(db, "project_sessions", "title");
  if (!hasTitleColumn) {
    ensureProjectSessionsNoThreadFallbackTitle(db);
    setUserVersion(db, 42);
    return;
  }

  const fallbackTitleExpression =
    projectSessionNoThreadFallbackSelectExpression(db);

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS project_sessions_next;

      CREATE TABLE project_sessions_next (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        no_thread_fallback_title TEXT NOT NULL,
        is_overview INTEGER NOT NULL DEFAULT 0,
        "order" INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_order INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        unread INTEGER NOT NULL DEFAULT 0,
        left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
        panel_state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (is_overview IN (0, 1)),
        CHECK (pinned IN (0, 1)),
        CHECK (archived IN (0, 1)),
        CHECK (unread IN (0, 1)),
        CHECK (left_pane_collapsed IN (0, 1))
      );

      INSERT INTO project_sessions_next (
        id, project_id, no_thread_fallback_title, is_overview, "order",
        pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      )
      SELECT
        id, project_id, ${fallbackTitleExpression}, is_overview, "order",
        pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      FROM project_sessions;

      DROP TABLE project_sessions;
      ALTER TABLE project_sessions_next RENAME TO project_sessions;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_sessions_overview
        ON project_sessions(project_id)
        WHERE is_overview = 1;
      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_order
        ON project_sessions(project_id, "order", created_at);
      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_sidebar
        ON project_sessions(project_id, archived, pinned, pinned_order, "order");
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 42);
}

function migrateSchema42To43(db: Database.Database): void {
  ensureProjectSessionsNoThreadFallbackTitle(db);

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS project_sessions_next;

      CREATE TABLE project_sessions_next (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        no_thread_fallback_title TEXT NOT NULL,
        is_overview INTEGER NOT NULL DEFAULT 0,
        "order" INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_order INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        unread INTEGER NOT NULL DEFAULT 0,
        left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
        panel_state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (is_overview IN (0, 1)),
        CHECK (pinned IN (0, 1)),
        CHECK (archived IN (0, 1)),
        CHECK (unread IN (0, 1)),
        CHECK (left_pane_collapsed IN (0, 1)),
        CHECK (is_overview = 0 OR project_id IS NOT NULL)
      );

      INSERT INTO project_sessions_next (
        id, project_id, no_thread_fallback_title, is_overview, "order",
        pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      )
      SELECT
        id, project_id, no_thread_fallback_title, is_overview, "order",
        pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      FROM project_sessions;

      DROP TABLE project_sessions;
      ALTER TABLE project_sessions_next RENAME TO project_sessions;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_sessions_overview
        ON project_sessions(project_id)
        WHERE is_overview = 1;
      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_order
        ON project_sessions(project_id, "order", created_at);
      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_sidebar
        ON project_sessions(project_id, archived, pinned, pinned_order, "order");

      CREATE TABLE IF NOT EXISTS codex_pinned_threads (
        thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
        pinned_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_codex_pinned_threads_order
        ON codex_pinned_threads(pinned_order, created_at);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 43);
}

interface ProjectSessionOrderRow {
  id: string;
  pinned: number;
  pinned_order: number | null;
  order: number;
  created_at: string;
}

interface LegacyOverviewSessionRow {
  id: string;
  project_id: string;
}

function normalizeProjectSessionOrders(
  db: Database.Database,
  projectId: string,
  databaseViewSessionId: string,
  now: string,
): void {
  const rows = db
    .prepare(
      `
    SELECT id, pinned, pinned_order, "order", created_at
    FROM project_sessions
    WHERE project_id = ?
    ORDER BY
      CASE WHEN id = ? THEN 0 ELSE 1 END ASC,
      CASE WHEN pinned = 1 THEN 0 ELSE 1 END ASC,
      CASE WHEN pinned = 1 THEN COALESCE(pinned_order, 9223372036854775807) ELSE "order" END ASC,
      created_at ASC
  `,
    )
    .all(projectId, databaseViewSessionId) as ProjectSessionOrderRow[];

  const updateOrder = db.prepare(
    'UPDATE project_sessions SET "order" = ?, updated_at = ? WHERE id = ?',
  );
  rows.forEach((row, index) => updateOrder.run(index, now, row.id));

  const pinnedRows = rows.filter((row) => row.pinned === 1);
  const updatePinnedOrder = db.prepare(
    "UPDATE project_sessions SET pinned_order = ?, updated_at = ? WHERE id = ?",
  );
  pinnedRows.forEach((row, index) => updatePinnedOrder.run(index, now, row.id));
}

function convertLegacyOverviewToDatabaseViewSession(
  db: Database.Database,
  overview: LegacyOverviewSessionRow,
  now: string,
): string {
  const sessionId = randomUUID();
  const tabId = randomUUID();

  db.prepare("DELETE FROM project_session_tabs WHERE session_id = ?").run(
    overview.id,
  );
  db.prepare("DELETE FROM project_session_threads WHERE session_id = ?").run(
    overview.id,
  );
  db.prepare(
    `
    UPDATE project_sessions
    SET id = ?,
        no_thread_fallback_title = ?,
        "order" = 0,
        pinned = 1,
        pinned_order = 0,
        archived = 0,
        archived_at = NULL,
        unread = 0,
        left_pane_collapsed = 1,
        panel_state_json = ?,
        updated_at = ?
    WHERE id = ?
  `,
  ).run(
    sessionId,
    INITIAL_DATABASE_VIEW_SESSION_TITLE,
    makeInitialDatabaseViewPanelStateJson(tabId),
    now,
    overview.id,
  );
  insertDatabaseViewTab(db, {
    sessionId,
    projectId: overview.project_id,
    tabId,
    now,
  });

  return sessionId;
}

function migrateSchema43To44(db: Database.Database): void {
  ensureProjectSessionsNoThreadFallbackTitle(db);

  db.pragma("foreign_keys = OFF");
  try {
    const now = new Date().toISOString();
    const projects = db
      .prepare("SELECT id FROM projects ORDER BY created ASC")
      .all() as Array<{ id: string }>;
    const overviewRows = tableHasColumn(db, "project_sessions", "is_overview")
      ? (db
          .prepare(
            `
        SELECT id, project_id
        FROM project_sessions
        WHERE is_overview = 1 AND project_id IS NOT NULL
        ORDER BY project_id ASC, created_at ASC
      `,
          )
          .all() as LegacyOverviewSessionRow[])
      : [];
    const overviewRowsByProject = new Map<string, LegacyOverviewSessionRow[]>();
    for (const row of overviewRows) {
      const rows = overviewRowsByProject.get(row.project_id) ?? [];
      rows.push(row);
      overviewRowsByProject.set(row.project_id, rows);
    }

    for (const project of projects) {
      const [primaryOverview, ...duplicateOverviews] =
        overviewRowsByProject.get(project.id) ?? [];
      for (const duplicate of duplicateOverviews) {
        db.prepare("DELETE FROM project_session_tabs WHERE session_id = ?").run(
          duplicate.id,
        );
        db.prepare(
          "DELETE FROM project_session_threads WHERE session_id = ?",
        ).run(duplicate.id);
        db.prepare("DELETE FROM project_sessions WHERE id = ?").run(
          duplicate.id,
        );
      }

      const databaseViewSessionId = primaryOverview
        ? convertLegacyOverviewToDatabaseViewSession(db, primaryOverview, now)
        : insertInitialDatabaseViewSession(db, project.id, now).sessionId;
      normalizeProjectSessionOrders(db, project.id, databaseViewSessionId, now);
    }

    db.exec(`
      DROP TABLE IF EXISTS project_sessions_next;

      CREATE TABLE project_sessions_next (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        no_thread_fallback_title TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_order INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        unread INTEGER NOT NULL DEFAULT 0,
        left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
        panel_state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (pinned IN (0, 1)),
        CHECK (archived IN (0, 1)),
        CHECK (unread IN (0, 1)),
        CHECK (left_pane_collapsed IN (0, 1))
      );

      INSERT INTO project_sessions_next (
        id, project_id, no_thread_fallback_title, "order",
        pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      )
      SELECT
        id, project_id, no_thread_fallback_title, "order",
        pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
        panel_state_json, created_at, updated_at
      FROM project_sessions;

      DROP TABLE project_sessions;
      ALTER TABLE project_sessions_next RENAME TO project_sessions;

      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_order
        ON project_sessions(project_id, "order", created_at);
      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_sidebar
        ON project_sessions(project_id, archived, pinned, pinned_order, "order");
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 44);
}

function migrateSchema44To45(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_search_units (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES project_sessions(id) ON DELETE SET NULL,
      turn_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      source_updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      CHECK (role IN ('user', 'assistant'))
    );

    CREATE INDEX IF NOT EXISTS idx_thread_search_units_thread
      ON thread_search_units(thread_id);
    CREATE INDEX IF NOT EXISTS idx_thread_search_units_project
      ON thread_search_units(project_id);
    CREATE INDEX IF NOT EXISTS idx_thread_search_units_session
      ON thread_search_units(session_id);

    CREATE TABLE IF NOT EXISTS thread_search_thread_state (
      thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      source_updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      index_version INTEGER NOT NULL DEFAULT 1,
      unit_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      failed_at INTEGER,
      retry_after INTEGER,
      CHECK (status IN ('ready', 'stale', 'failed'))
    ) WITHOUT ROWID;

    CREATE VIRTUAL TABLE IF NOT EXISTS thread_search_units_fts USING fts5(
      text,
      content='thread_search_units',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 2 tokenchars '-_/@.:#'",
      prefix='2 3 4'
    );

    CREATE TRIGGER IF NOT EXISTS thread_search_units_ai
      AFTER INSERT ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

    CREATE TRIGGER IF NOT EXISTS thread_search_units_ad
      AFTER DELETE ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(thread_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
      END;

    CREATE TRIGGER IF NOT EXISTS thread_search_units_au
      AFTER UPDATE ON thread_search_units
      BEGIN
        INSERT INTO thread_search_units_fts(thread_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
        INSERT INTO thread_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;
  `);

  setUserVersion(db, 45);
}

function migrateSchema45To46(db: Database.Database): void {
  if (!tableHasColumn(db, "thread_search_thread_state", "index_version")) {
    db.exec(
      "ALTER TABLE thread_search_thread_state ADD COLUMN index_version INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (!tableHasColumn(db, "thread_search_thread_state", "last_error")) {
    db.exec(
      "ALTER TABLE thread_search_thread_state ADD COLUMN last_error TEXT",
    );
  }
  if (!tableHasColumn(db, "thread_search_thread_state", "failed_at")) {
    db.exec(
      "ALTER TABLE thread_search_thread_state ADD COLUMN failed_at INTEGER",
    );
  }
  if (!tableHasColumn(db, "thread_search_thread_state", "retry_after")) {
    db.exec(
      "ALTER TABLE thread_search_thread_state ADD COLUMN retry_after INTEGER",
    );
  }

  setUserVersion(db, 46);
}

function migrateSchema46To47(db: Database.Database): void {
  ensureProjectSessionsNoThreadFallbackTitle(db);
  setUserVersion(db, 47);
}

function migrateSchema47To48(db: Database.Database): void {
  if (!tableHasColumn(db, "cards", "description_preview")) {
    db.exec(
      "ALTER TABLE cards ADD COLUMN description_preview TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!tableHasColumn(db, "cards", "description_length")) {
    db.exec(
      "ALTER TABLE cards ADD COLUMN description_length INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!tableHasColumn(db, "cards", "has_description")) {
    db.exec(
      "ALTER TABLE cards ADD COLUMN has_description INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!tableHasColumn(db, "cards", "description_read_model_revision")) {
    db.exec(
      "ALTER TABLE cards ADD COLUMN description_read_model_revision INTEGER NOT NULL DEFAULT 0",
    );
  }

  db.exec(`
    UPDATE cards
    SET
      description_length = length(description),
      has_description = CASE WHEN length(trim(description)) > 0 THEN 1 ELSE 0 END,
      description_read_model_revision = 0
    WHERE description_read_model_revision = 0;

    CREATE TABLE IF NOT EXISTS card_search_units (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      card_revision INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      UNIQUE(card_id),
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done'))
    );

    CREATE INDEX IF NOT EXISTS idx_card_search_units_project
      ON card_search_units(project_id);
    CREATE INDEX IF NOT EXISTS idx_card_search_units_card
      ON card_search_units(card_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS card_search_units_fts USING fts5(
      text,
      content='card_search_units',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 2 tokenchars '-_/@.:#'",
      prefix='2 3 4'
    );

    CREATE TRIGGER IF NOT EXISTS card_search_units_ai
      AFTER INSERT ON card_search_units
      BEGIN
        INSERT INTO card_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;

    CREATE TRIGGER IF NOT EXISTS card_search_units_ad
      AFTER DELETE ON card_search_units
      BEGIN
        INSERT INTO card_search_units_fts(card_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
      END;

    CREATE TRIGGER IF NOT EXISTS card_search_units_au
      AFTER UPDATE ON card_search_units
      BEGIN
        INSERT INTO card_search_units_fts(card_search_units_fts, rowid, text)
        VALUES ('delete', old.rowid, old.text);
        INSERT INTO card_search_units_fts(rowid, text)
        VALUES (new.rowid, new.text);
      END;
  `);

  setUserVersion(db, 48);
}

function migrateSchema48To49(db: Database.Database): void {
  if (
    tableExists(db, "codex_threads") &&
    !tableHasColumn(db, "codex_threads", "thread_source")
  ) {
    db.exec("ALTER TABLE codex_threads ADD COLUMN thread_source TEXT");
  }

  setUserVersion(db, 49);
}

function migrateSchema49To50(db: Database.Database): void {
  if (
    tableExists(db, "codex_threads") &&
    !tableHasColumn(db, "codex_threads", "agent_nickname")
  ) {
    db.exec("ALTER TABLE codex_threads ADD COLUMN agent_nickname TEXT");
  }
  if (
    tableExists(db, "codex_threads") &&
    !tableHasColumn(db, "codex_threads", "agent_role")
  ) {
    db.exec("ALTER TABLE codex_threads ADD COLUMN agent_role TEXT");
  }

  setUserVersion(db, 50);
}

function migrateSchema50To51(db: Database.Database): void {
  if (
    tableExists(db, "codex_threads") &&
    !tableHasColumn(db, "codex_threads", "projectless_output_directory")
  ) {
    db.exec(
      "ALTER TABLE codex_threads ADD COLUMN projectless_output_directory TEXT",
    );
  }

  setUserVersion(db, 51);
}

function migrateSchema51To52(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS codex_scheduled_automations (
      automation_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      target_thread_id TEXT,
      name TEXT NOT NULL,
      rrule TEXT,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (kind IN ('cron', 'heartbeat')),
      CHECK (status IN ('ACTIVE', 'PAUSED', 'DELETED'))
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_scheduled_automations_target
      ON codex_scheduled_automations(target_thread_id, kind, status, created_at, automation_id);
  `);

  setUserVersion(db, 52);
}

function migrateSchema52To53(db: Database.Database): void {
  if (
    tableExists(db, "codex_threads") &&
    !tableHasColumn(db, "codex_threads", "managed_worktree_path")
  ) {
    db.exec("ALTER TABLE codex_threads ADD COLUMN managed_worktree_path TEXT");
  }

  setUserVersion(db, 53);
}

function migrateSchema53To54(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS codex_background_processes (
      process_record_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      thread_title TEXT,
      item_id TEXT NOT NULL,
      turn_id TEXT,
      command TEXT NOT NULL,
      cwd TEXT,
      app_server_process_id TEXT,
      os_pid INTEGER,
      terminal_session_id TEXT,
      source TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      CHECK (source IN ('app-server', 'terminal-action'))
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_background_processes_thread_updated
      ON codex_background_processes(thread_id, updated_at_ms DESC, process_record_id);
  `);

  setUserVersion(db, 54);
}

function migrateSchema54To55(db: Database.Database): void {
  if (!tableExists(db, "codex_scheduled_automations")) {
    db.exec(`
      CREATE TABLE codex_scheduled_automations (
        automation_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        target_thread_id TEXT,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        rrule TEXT,
        model TEXT,
        reasoning_effort TEXT,
        cwds_json TEXT NOT NULL DEFAULT '[]',
        execution_environment TEXT NOT NULL DEFAULT 'worktree',
        local_environment_config_path TEXT,
        next_run_at INTEGER,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (kind IN ('cron', 'heartbeat')),
        CHECK (status IN ('ACTIVE', 'PAUSED', 'DELETED')),
        CHECK (execution_environment IN ('local', 'worktree')),
        CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_codex_scheduled_automations_target
        ON codex_scheduled_automations(target_thread_id, kind, status, created_at, automation_id);
    `);
    setUserVersion(db, 55);
    return;
  }

  if (!tableHasColumn(db, "codex_scheduled_automations", "prompt")) {
    db.exec(
      "ALTER TABLE codex_scheduled_automations ADD COLUMN prompt TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!tableHasColumn(db, "codex_scheduled_automations", "model")) {
    db.exec("ALTER TABLE codex_scheduled_automations ADD COLUMN model TEXT");
  }
  if (!tableHasColumn(db, "codex_scheduled_automations", "reasoning_effort")) {
    db.exec(
      "ALTER TABLE codex_scheduled_automations ADD COLUMN reasoning_effort TEXT",
    );
  }
  if (!tableHasColumn(db, "codex_scheduled_automations", "cwds_json")) {
    db.exec(
      "ALTER TABLE codex_scheduled_automations ADD COLUMN cwds_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  if (
    !tableHasColumn(db, "codex_scheduled_automations", "execution_environment")
  ) {
    db.exec(
      "ALTER TABLE codex_scheduled_automations ADD COLUMN execution_environment TEXT NOT NULL DEFAULT 'worktree'",
    );
  }
  if (
    !tableHasColumn(
      db,
      "codex_scheduled_automations",
      "local_environment_config_path",
    )
  ) {
    db.exec(
      "ALTER TABLE codex_scheduled_automations ADD COLUMN local_environment_config_path TEXT",
    );
  }
  if (!tableHasColumn(db, "codex_scheduled_automations", "last_run_at")) {
    db.exec(
      "ALTER TABLE codex_scheduled_automations ADD COLUMN last_run_at INTEGER",
    );
  }

  setUserVersion(db, 55);
}

function migrateSchema55To56(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS codex_automation_runs (
      thread_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      read_at INTEGER,
      thread_title TEXT,
      source_cwd TEXT,
      inbox_title TEXT,
      inbox_summary TEXT,
      archived_user_message TEXT,
      archived_assistant_message TEXT,
      archived_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (status IN ('IN_PROGRESS', 'PENDING_REVIEW', 'ACCEPTED', 'ARCHIVED'))
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_automation_runs_automation_status_created
      ON codex_automation_runs(automation_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_codex_automation_runs_unread
      ON codex_automation_runs(read_at, status, updated_at);
  `);

  setUserVersion(db, 56);
}

function migrateSchema56To57(db: Database.Database): void {
  if (
    tableExists(db, "codex_threads") &&
    !tableHasColumn(db, "codex_threads", "projectless_workspace_browser_root")
  ) {
    db.exec(
      "ALTER TABLE codex_threads ADD COLUMN projectless_workspace_browser_root TEXT",
    );
  }

  setUserVersion(db, 57);
}

function migrateSchema57To58(db: Database.Database): void {
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_history_group_global ON history(group_id)",
  );
  setUserVersion(db, 58);
}

function createSchemaMigrationSafetyBackup(
  db: Database.Database,
  fromVersion: number,
  toVersion: number,
): void {
  const quickCheck = db.pragma("quick_check") as Array<{ quick_check: string }>;
  if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== "ok") {
    throw new Error(
      `Cannot migrate schema v${fromVersion}: SQLite quick_check failed`,
    );
  }
  const foreignKeyProblems = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeyProblems.length > 0) {
    throw new Error(
      `Cannot migrate schema v${fromVersion}: ${foreignKeyProblems.length} foreign-key violation(s)`,
    );
  }

  const createdAt = new Date().toISOString();
  const backupId = `schema-v${fromVersion}-to-v${toVersion}-${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const backupsRoot = path.join(
    path.dirname(getDatabasePath()),
    "migration-backups",
  );
  const finalDirectory = path.join(backupsRoot, backupId);
  const temporaryDirectory = `${finalDirectory}.tmp`;
  const databasePath = path.join(temporaryDirectory, "nodex.db");
  const sourceAssetsPath = path.join(path.dirname(getDatabasePath()), "assets");
  const backupAssetsPath = path.join(temporaryDirectory, "assets");

  fs.mkdirSync(temporaryDirectory, { recursive: true });
  try {
    db.prepare("VACUUM INTO ?").run(databasePath);
    const verificationDatabase = new Database(databasePath, { readonly: true });
    try {
      const backupVersion = getUserVersion(verificationDatabase);
      if (backupVersion !== fromVersion) {
        throw new Error(
          `Safety backup reports schema v${backupVersion}; expected v${fromVersion}`,
        );
      }
      const backupQuickCheck = verificationDatabase.pragma(
        "quick_check",
      ) as Array<{
        quick_check: string;
      }>;
      if (
        backupQuickCheck.length !== 1 ||
        backupQuickCheck[0]?.quick_check !== "ok"
      ) {
        throw new Error("Safety backup quick_check failed");
      }
    } finally {
      verificationDatabase.close();
    }
    if (fs.existsSync(sourceAssetsPath)) {
      fs.cpSync(sourceAssetsPath, backupAssetsPath, { recursive: true });
    }
    const manifest = {
      version: 1,
      id: backupId,
      createdAt,
      sourceSchemaVersion: fromVersion,
      targetSchemaVersion: toVersion,
      databaseFile: "nodex.db",
      includesAssets: fs.existsSync(backupAssetsPath),
    };
    fs.writeFileSync(
      path.join(temporaryDirectory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    fs.renameSync(temporaryDirectory, finalDirectory);
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw new Error(
      `Could not create schema v${fromVersion} safety backup: ${(error as Error).message}`,
    );
  }
}

function migrateSchema58To59(db: Database.Database): void {
  const migrate = db.transaction(() => {
    createBlockFoundationSchema(db);
    seedLegacyCardBlockFoundation(db);
    setUserVersion(db, 59);
  });
  migrate();
}

function seedLegacyCardShadowOutbox(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO legacy_card_shadow_heads (
      card_id, project_id, last_event_seq, last_source_revision,
      last_operation, updated_at
    )
    SELECT card.id, card.project_id, 1, card.revision, 'insert', ?
    FROM cards card
    WHERE true
    ON CONFLICT(card_id) DO NOTHING
  `,
  ).run(now);

  db.prepare(
    `
    INSERT INTO legacy_card_shadow_jobs (
      id, card_id, source_event_seq, project_id, previous_project_id,
      document_id, expected_document_generation, expected_document_head_seq,
      expected_document_readiness, expected_document_authority,
      source_revision, operation, status, attempt_count,
      enqueued_at, updated_at
    )
    SELECT
      'legacy-shadow:' || card.id || ':' || printf('%020d', head.last_event_seq),
      card.id,
      head.last_event_seq,
      card.project_id,
      NULL,
      document.id,
      document.generation,
      document.head_seq,
      document.readiness,
      document.authority,
      card.revision,
      'insert',
      'pending',
      0,
      ?,
      ?
    FROM cards card
    INNER JOIN legacy_card_shadow_heads head ON head.card_id = card.id
    INNER JOIN block_documents ownership ON ownership.block_id = card.id
    INNER JOIN documents document ON document.id = ownership.document_id
    WHERE true
    ON CONFLICT(id) DO NOTHING
  `,
  ).run(now, now);

  const parityFailure = db
    .prepare(
      `
    SELECT card.id
    FROM cards card
    LEFT JOIN legacy_card_shadow_heads head ON head.card_id = card.id
    LEFT JOIN legacy_card_shadow_jobs job
      ON job.card_id = card.id
      AND job.source_event_seq = head.last_event_seq
    WHERE head.card_id IS NULL
      OR head.project_id <> card.project_id
      OR head.last_source_revision <> card.revision
      OR job.id IS NULL
      OR job.source_revision <> card.revision
      OR job.project_id <> card.project_id
    LIMIT 1
  `,
    )
    .get() as { id: string } | undefined;
  if (parityFailure) {
    throw new Error(
      `Legacy Card shadow outbox parity failed for Card ${parityFailure.id}`,
    );
  }
}

function migrateSchema59To60(db: Database.Database): void {
  const migrate = db.transaction(() => {
    createLegacyCardShadowOutboxSchema(db);
    seedLegacyCardShadowOutbox(db);
    setUserVersion(db, 60);
  });
  migrate();
}

function migrateSchema60To61(db: Database.Database): void {
  const migrate = db.transaction(() => {
    createDocumentUpdateReceiptSchema(db);
    db.prepare(
      `
      INSERT INTO document_update_receipts (
        document_id, generation, seq, update_id, client_session_id,
        base_head_seq, client_touched_block_ids_json,
        derived_touched_block_ids_json, derivation_version,
        update_hash, update_byte_length, committed_at
      )
      SELECT
        update_row.document_id,
        update_row.generation,
        update_row.seq,
        update_row.update_id,
        update_row.client_session_id,
        update_row.base_head_seq,
        update_row.touched_block_ids_json,
        '[]',
        0,
        update_row.update_hash,
        length(update_row.update_blob),
        update_row.committed_at
      FROM document_updates update_row
      WHERE true
      ON CONFLICT(document_id, update_id) DO NOTHING
    `,
    ).run();

    const missingReceipt = db
      .prepare(
        `
      SELECT update_row.document_id, update_row.update_id
      FROM document_updates update_row
      LEFT JOIN document_update_receipts receipt
        ON receipt.document_id = update_row.document_id
        AND receipt.update_id = update_row.update_id
      WHERE receipt.document_id IS NULL
        OR receipt.generation <> update_row.generation
        OR receipt.seq <> update_row.seq
        OR receipt.client_session_id <> update_row.client_session_id
        OR receipt.base_head_seq <> update_row.base_head_seq
        OR receipt.update_hash <> update_row.update_hash
        OR receipt.update_byte_length <> length(update_row.update_blob)
      LIMIT 1
    `,
      )
      .get() as { document_id: string; update_id: string } | undefined;
    if (missingReceipt) {
      throw new Error(
        `Document update receipt migration diverged for ${missingReceipt.document_id}/${missingReceipt.update_id}`,
      );
    }
    setUserVersion(db, 61);
  });
  migrate();
}

function seedLegacyCardMetadataProjection(db: Database.Database): void {
  const now = new Date().toISOString();
  const revisionSql = "MAX(1, card.revision)";
  db.exec(`
    INSERT INTO block_properties (
      block_id, project_id, property_key, value_type, value_json,
      revision, updated_at
    )
    SELECT card.id, card.project_id, 'agent.blocked', 'boolean',
      CASE WHEN card.agent_blocked = 1 THEN 'true' ELSE 'false' END,
      ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'agent.status', 'string',
      json_quote(card.agent_status), ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'run.target', 'string',
      json_quote(CASE card.run_in_target
        WHEN 'new_worktree' THEN 'newWorktree'
        WHEN 'cloud' THEN 'cloud'
        ELSE 'localProject'
      END), ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'run.localPath', 'string',
      json_quote(card.run_in_local_path), ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'run.baseBranch', 'string',
      json_quote(card.run_in_base_branch), ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'run.worktreePath', 'string',
      json_quote(card.run_in_worktree_path), ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'run.environmentPath', 'string',
      json_quote(card.run_in_environment_path), ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'schedule.isAllDay', 'boolean',
      CASE WHEN card.is_all_day = 1 THEN 'true' ELSE 'false' END,
      ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'schedule.timezone', 'string',
      json_quote(card.schedule_timezone), ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'recurrence.config', 'json',
      CASE WHEN card.recurrence_json IS NULL
        THEN 'null'
        ELSE json(card.recurrence_json)
      END, ${revisionSql}, '${now}'
    FROM cards card
    UNION ALL
    SELECT card.id, card.project_id, 'reminders.config', 'json',
      json(card.reminders_json), ${revisionSql}, '${now}'
    FROM cards card
    WHERE true
    ON CONFLICT(block_id, property_key) DO UPDATE SET
      project_id = excluded.project_id,
      value_type = excluded.value_type,
      value_json = excluded.value_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at;

    INSERT INTO database_property_values (
      membership_id, property_id, database_block_id, project_id,
      value_type, value_json, revision, updated_at
    )
    SELECT
      membership.id,
      property.id,
      property.database_block_id,
      card.project_id,
      property.value_type,
      CASE property.key
        WHEN 'status' THEN json_quote(card.status)
        WHEN 'priority' THEN json_quote(card.priority)
        WHEN 'estimate' THEN json_quote(card.estimate)
        WHEN 'tags' THEN json(card.tags)
        WHEN 'due_date' THEN json_quote(card.due_date)
        WHEN 'scheduled_start' THEN json_quote(card.scheduled_start)
        WHEN 'scheduled_end' THEN json_quote(card.scheduled_end)
        WHEN 'assignee' THEN json_quote(card.assignee)
      END,
      MAX(1, card.revision),
      '${now}'
    FROM cards card
    INNER JOIN database_memberships membership
      ON membership.card_block_id = card.id
      AND membership.removed_at IS NULL
    INNER JOIN database_properties property
      ON property.database_block_id = membership.database_block_id
      AND property.lifecycle = 'active'
    WHERE property.key IN (
      'status', 'priority', 'estimate', 'tags', 'due_date',
      'scheduled_start', 'scheduled_end', 'assignee'
    )
    ON CONFLICT(membership_id, property_id) DO UPDATE SET
      database_block_id = excluded.database_block_id,
      project_id = excluded.project_id,
      value_type = excluded.value_type,
      value_json = excluded.value_json,
      revision = excluded.revision,
      updated_at = excluded.updated_at;

    INSERT INTO scheduled_card_index (
      card_block_id, project_id, lifecycle, scheduled_start, scheduled_end,
      is_all_day, recurrence_json, reminders_json, schedule_timezone,
      source_metadata_revision, updated_at
    )
    SELECT
      card.id,
      card.project_id,
      CASE WHEN card.archived = 1 THEN 'archived' ELSE 'active' END,
      card.scheduled_start,
      card.scheduled_end,
      card.is_all_day,
      CASE WHEN card.recurrence_json IS NULL
        THEN 'null'
        ELSE json(card.recurrence_json)
      END,
      json(card.reminders_json),
      card.schedule_timezone,
      MAX(1, card.revision),
      '${now}'
    FROM cards card
    WHERE true
    ON CONFLICT(card_block_id) DO UPDATE SET
      project_id = excluded.project_id,
      lifecycle = excluded.lifecycle,
      scheduled_start = excluded.scheduled_start,
      scheduled_end = excluded.scheduled_end,
      is_all_day = excluded.is_all_day,
      recurrence_json = excluded.recurrence_json,
      reminders_json = excluded.reminders_json,
      schedule_timezone = excluded.schedule_timezone,
      source_metadata_revision = excluded.source_metadata_revision,
      updated_at = excluded.updated_at;
  `);
}

function assertLegacyCardMetadataProjectionParity(db: Database.Database): void {
  const missingDefinition = db
    .prepare(
      `
    SELECT project.id
    FROM projects project
    WHERE (
      SELECT COUNT(*)
      FROM database_properties property
      WHERE property.database_block_id = 'database:' || project.id || ':primary'
        AND property.lifecycle = 'active'
    ) <> ?
    LIMIT 1
  `,
    )
    .get(PRIMARY_DATABASE_PROPERTY_DEFINITIONS.length) as
    { id: string } | undefined;
  if (missingDefinition) {
    throw new Error(
      `Primary Database property parity failed for Project ${missingDefinition.id}`,
    );
  }

  const parityFailure = db
    .prepare(
      `
    SELECT card.id
    FROM cards card
    INNER JOIN blocks block ON block.id = card.id
    LEFT JOIN database_memberships membership
      ON membership.card_block_id = card.id
      AND membership.removed_at IS NULL
    LEFT JOIN scheduled_card_index schedule ON schedule.card_block_id = card.id
    WHERE (
      SELECT COUNT(*)
      FROM database_memberships active_membership
      WHERE active_membership.card_block_id = card.id
        AND active_membership.removed_at IS NULL
    ) <> 1
      OR (
        SELECT COUNT(*)
        FROM database_property_values value
        WHERE value.membership_id = membership.id
      ) <> ?
      OR (
        SELECT COUNT(*)
        FROM block_properties property
        WHERE property.block_id = card.id
      ) <> ?
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'status'
      ), '__missing__') <> json_quote(card.status)
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'priority'
      ), '__missing__') <> json_quote(card.priority)
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'estimate'
      ), '__missing__') <> json_quote(card.estimate)
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'tags'
      ), '__missing__') <> json(card.tags)
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'due_date'
      ), '__missing__') <> json_quote(card.due_date)
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'scheduled_start'
      ), '__missing__') <> json_quote(card.scheduled_start)
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'scheduled_end'
      ), '__missing__') <> json_quote(card.scheduled_end)
      OR COALESCE((
        SELECT value.value_json
        FROM database_property_values value
        INNER JOIN database_properties property ON property.id = value.property_id
        WHERE value.membership_id = membership.id AND property.key = 'assignee'
      ), '__missing__') <> json_quote(card.assignee)
      OR schedule.card_block_id IS NULL
      OR schedule.project_id <> card.project_id
      OR schedule.lifecycle <> CASE WHEN card.archived = 1 THEN 'archived' ELSE 'active' END
      OR schedule.scheduled_start IS NOT card.scheduled_start
      OR schedule.scheduled_end IS NOT card.scheduled_end
      OR schedule.is_all_day <> card.is_all_day
      OR schedule.recurrence_json <> CASE WHEN card.recurrence_json IS NULL
        THEN 'null'
        ELSE json(card.recurrence_json)
      END
      OR schedule.reminders_json <> json(card.reminders_json)
      OR schedule.schedule_timezone IS NOT card.schedule_timezone
      OR block.project_id <> card.project_id
    LIMIT 1
  `,
    )
    .get(
      PRIMARY_DATABASE_PROPERTY_DEFINITIONS.length,
      LEGACY_INTRINSIC_PROPERTY_COUNT,
    ) as { id: string } | undefined;
  if (parityFailure) {
    throw new Error(
      `Legacy Card metadata projection parity failed for Card ${parityFailure.id}`,
    );
  }

  const duplicateIdentity = db
    .prepare(
      `
    SELECT card.id
    FROM cards card
    INNER JOIN blocks block ON block.id = card.id
    GROUP BY card.id
    HAVING COUNT(block.id) <> 1
    LIMIT 1
  `,
    )
    .get() as { id: string } | undefined;
  if (duplicateIdentity) {
    throw new Error(
      `Card ${duplicateIdentity.id} has duplicate Block identity`,
    );
  }
}

function addDocumentMaterializationProjectionColumns(
  db: Database.Database,
): void {
  if (!tableHasColumn(db, "document_materializations", "schema_version")) {
    db.exec(`
      ALTER TABLE document_materializations
      ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1
        CHECK (schema_version >= 1)
    `);
  }
  if (!tableHasColumn(db, "document_materializations", "title")) {
    db.exec(`
      ALTER TABLE document_materializations
      ADD COLUMN title TEXT NOT NULL DEFAULT ''
    `);
  }
  if (!tableHasColumn(db, "document_materializations", "references_json")) {
    db.exec(`
      ALTER TABLE document_materializations
      ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(references_json) AND json_type(references_json) = 'array')
    `);
  }
  if (!tableHasColumn(db, "document_materializations", "asset_refs_json")) {
    db.exec(`
      ALTER TABLE document_materializations
      ADD COLUMN asset_refs_json TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(asset_refs_json) AND json_type(asset_refs_json) = 'array')
    `);
  }
}

function backfillExistingDocumentMaterializations(db: Database.Database): void {
  const materializations = db
    .prepare(
      `
    SELECT
      materialization.document_id,
      document.schema_version,
      COALESCE(card.title, materialization.title) AS title,
      materialization.nfm,
      materialization.block_tree_json
    FROM document_materializations materialization
    INNER JOIN documents document ON document.id = materialization.document_id
    INNER JOIN block_documents ownership
      ON ownership.document_id = materialization.document_id
    INNER JOIN blocks owner
      ON owner.id = ownership.block_id
      AND owner.type = 'card'
    LEFT JOIN cards card ON card.id = ownership.block_id
    ORDER BY materialization.document_id
  `,
    )
    .all() as Array<{
    document_id: string;
    schema_version: number;
    title: string;
    nfm: string;
    block_tree_json: string;
  }>;

  const update = db.prepare(`
    UPDATE document_materializations
    SET schema_version = ?,
        title = ?,
        references_json = ?,
        asset_refs_json = ?
    WHERE document_id = ?
  `);

  for (const row of materializations) {
    const parsed = JSON.parse(row.block_tree_json) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(
        `Document ${row.document_id} materialization has an invalid Block tree`,
      );
    }
    const { references, assetRefs } = deriveBlockDocumentRecordsFromNfm(
      parsed as readonly BlockTreeNode[],
      row.nfm,
    );
    update.run(
      row.schema_version,
      row.title,
      JSON.stringify(references),
      JSON.stringify(assetRefs),
      row.document_id,
    );
  }
}

function recreateV62CardProjectionTriggers(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS cards_block_foundation_after_insert;
    DROP TRIGGER IF EXISTS cards_block_foundation_after_local_update;
    DROP TRIGGER IF EXISTS cards_block_foundation_cross_project_requires_pending;
    DROP TRIGGER IF EXISTS cards_block_foundation_after_cross_project_update;
    DROP TRIGGER IF EXISTS cards_block_foundation_after_delete;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_insert;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_update;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_outbox_after_delete;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_insert;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_update;
    DROP TRIGGER IF EXISTS cards_legacy_shadow_reject_primary_delete;
  `);
  createBlockFoundationSchema(db);
  createLegacyCardShadowOutboxSchema(db);
}

function migrateSchema61To62(db: Database.Database): void {
  const migrate = db.transaction(() => {
    addDocumentMaterializationProjectionColumns(db);
    recreateV62CardProjectionTriggers(db);

    const projects = db
      .prepare("SELECT id, created FROM projects")
      .all() as Array<{
      id: string;
      created: string;
    }>;
    for (const project of projects) {
      ensurePrimaryDatabaseProperties(db, project.id, project.created);
    }

    seedLegacyCardMetadataProjection(db);
    backfillExistingDocumentMaterializations(db);
    assertLegacyCardMetadataProjectionParity(db);
    setUserVersion(db, 62);
  });
  migrate();
}

function migrateSchema62To63(db: Database.Database): void {
  const migrate = db.transaction(() => {
    createForeignReferenceMigrationSchema(db);
    backfillExistingDocumentMaterializations(db);
    setUserVersion(db, 63);
  });
  migrate();
}

function migrateSchema63To64(db: Database.Database): void {
  const migrate = db.transaction(() => {
    createAtomicBlockRelocationSchema(db);
    setUserVersion(db, 64);
  });
  migrate();
}

function migrateSchema64To65(db: Database.Database): void {
  const migrate = db.transaction(() => {
    createBlockSecondaryAuthorityFoundationSchema(db);
    setUserVersion(db, 65);
  });
  migrate();
}

function migrateSchema65To66(db: Database.Database): void {
  const migrate = db.transaction(() => {
    dropCardBehaviorRecordTriggers(db);
    db.exec(`
      DROP TABLE IF EXISTS ${V66_CARD_BEHAVIOR_RECORD_TABLES.recurrenceExceptions};
      DROP TABLE IF EXISTS ${V66_CARD_BEHAVIOR_RECORD_TABLES.reminderReceipts};
      DROP TABLE IF EXISTS ${V66_CARD_BEHAVIOR_RECORD_TABLES.reminderSnoozes};
    `);
    createCardBehaviorRecordTables(db, V66_CARD_BEHAVIOR_RECORD_TABLES);
    db.exec(`
      INSERT INTO ${V66_CARD_BEHAVIOR_RECORD_TABLES.recurrenceExceptions} (
        id, project_id, card_id, occurrence_start, exception_type,
        override_start, override_end, override_reminders_json, created
      )
      SELECT
        id, project_id, card_id, occurrence_start, exception_type,
        override_start, override_end, override_reminders_json, created
      FROM recurrence_exceptions;

      INSERT INTO ${V66_CARD_BEHAVIOR_RECORD_TABLES.reminderReceipts} (
        id, project_id, card_id, occurrence_start,
        reminder_offset_minutes, delivered_at
      )
      SELECT
        id, project_id, card_id, occurrence_start,
        reminder_offset_minutes, delivered_at
      FROM reminder_receipts;

      INSERT INTO ${V66_CARD_BEHAVIOR_RECORD_TABLES.reminderSnoozes} (
        id, project_id, card_id, occurrence_start,
        due_at, created_at, consumed_at
      )
      SELECT
        id, project_id, card_id, occurrence_start,
        due_at, created_at, consumed_at
      FROM reminder_snoozes;
    `);
    assertCardBehaviorRecordOwners(db, V66_CARD_BEHAVIOR_RECORD_TABLES);

    db.exec(`
      DROP TABLE recurrence_exceptions;
      DROP TABLE reminder_receipts;
      DROP TABLE reminder_snoozes;

      ALTER TABLE ${V66_CARD_BEHAVIOR_RECORD_TABLES.recurrenceExceptions}
        RENAME TO recurrence_exceptions;
      ALTER TABLE ${V66_CARD_BEHAVIOR_RECORD_TABLES.reminderReceipts}
        RENAME TO reminder_receipts;
      ALTER TABLE ${V66_CARD_BEHAVIOR_RECORD_TABLES.reminderSnoozes}
        RENAME TO reminder_snoozes;
    `);
    createCardBehaviorRecordSchema(db);
    assertCardBehaviorRecordOwners(db, CARD_BEHAVIOR_RECORD_TABLES);
    assertCardBehaviorForeignKeys(db);
    setUserVersion(db, 66);
  });
  migrate.immediate();
}

function rebuildV67DatabasePropertyTables(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS database_property_values_require_matching_type;
    DROP TRIGGER IF EXISTS database_property_values_updates_require_matching_type;
    DROP INDEX IF EXISTS idx_database_property_values_property;
    DROP INDEX IF EXISTS idx_database_properties_active_key;
    DROP INDEX IF EXISTS idx_database_properties_order;

    ALTER TABLE database_property_values RENAME TO database_property_values_v66;
    ALTER TABLE database_properties RENAME TO database_properties_v66;

    CREATE TABLE database_properties (
      id TEXT PRIMARY KEY,
      database_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      value_type TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      rank_key TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active',
      schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (id, database_block_id, project_id),
      FOREIGN KEY (database_block_id, project_id)
        REFERENCES database_capabilities(block_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (length(key) BETWEEN 1 AND 128),
      CHECK (length(name) BETWEEN 1 AND 256),
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (lifecycle IN ('active', 'deleted')),
      CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
    ) WITHOUT ROWID;

    CREATE UNIQUE INDEX idx_database_properties_active_key
      ON database_properties(database_block_id, key)
      WHERE lifecycle = 'active';
    CREATE INDEX idx_database_properties_order
      ON database_properties(database_block_id, lifecycle, rank_key, id);

    INSERT INTO database_properties (
      id, database_block_id, project_id, key, name, value_type,
      config_json, rank_key, lifecycle, schema_revision, created_at, updated_at
    )
    SELECT
      id, database_block_id, project_id, key, name, value_type,
      config_json, rank_key, lifecycle, schema_revision, created_at, updated_at
    FROM database_properties_v66;

    CREATE TABLE database_property_values (
      membership_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      database_block_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (membership_id, property_id),
      FOREIGN KEY (membership_id, database_block_id, project_id)
        REFERENCES database_memberships(id, database_block_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (property_id, database_block_id, project_id)
        REFERENCES database_properties(id, database_block_id, project_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
      CHECK (value_type IN (
        'text', 'number', 'checkbox', 'select', 'multi_select',
        'date', 'datetime', 'person'
      )),
      CHECK (
        CASE
          WHEN json_valid(value_json) = 0 THEN 0
          WHEN json_type(value_json) = 'null' THEN 1
          WHEN value_type = 'multi_select' THEN json_type(value_json) = 'array'
          WHEN value_type = 'number' THEN json_type(value_json) IN ('integer', 'real')
          WHEN value_type = 'checkbox' THEN json_type(value_json) IN ('true', 'false')
          ELSE json_type(value_json) = 'text'
        END
      )
    ) WITHOUT ROWID;

    CREATE INDEX idx_database_property_values_property
      ON database_property_values(property_id, membership_id);

    INSERT INTO database_property_values (
      membership_id, property_id, database_block_id, project_id,
      value_type, value_json, revision, updated_at
    )
    SELECT
      membership_id, property_id, database_block_id, project_id,
      value_type, value_json, revision, updated_at
    FROM database_property_values_v66;

    DROP TABLE database_property_values_v66;
    DROP TABLE database_properties_v66;

    CREATE TRIGGER database_property_values_require_matching_type
      BEFORE INSERT ON database_property_values
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_properties property
        WHERE property.id = NEW.property_id
          AND property.database_block_id = NEW.database_block_id
          AND property.project_id = NEW.project_id
          AND property.lifecycle = 'active'
          AND property.value_type = NEW.value_type
      )
      BEGIN
        SELECT RAISE(ABORT, 'database property value type does not match its definition');
      END;

    CREATE TRIGGER database_property_values_updates_require_matching_type
      BEFORE UPDATE OF property_id, database_block_id, project_id, value_type
      ON database_property_values
      WHEN NOT EXISTS (
        SELECT 1
        FROM database_properties property
        WHERE property.id = NEW.property_id
          AND property.database_block_id = NEW.database_block_id
          AND property.project_id = NEW.project_id
          AND property.lifecycle = 'active'
          AND property.value_type = NEW.value_type
      )
      BEGIN
        SELECT RAISE(ABORT, 'database property value type does not match its definition');
      END;
  `);
}

interface V67DatabasePropertyOption {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
}

const parseV67DatabasePropertyOptions = (
  configJson: string,
  propertyId: string,
): readonly V67DatabasePropertyOption[] => {
  let value: unknown;
  try {
    value = JSON.parse(configJson) as unknown;
  } catch {
    throw new Error(`Database property ${propertyId} has invalid config JSON`);
  }
  if (!isJsonRecord(value)) {
    throw new Error(`Database property ${propertyId} config must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "options")) {
    throw new Error(
      `Database property ${propertyId} has unsupported schema version 1 config`,
    );
  }
  if (value.options === undefined) return [];
  if (!Array.isArray(value.options) || value.options.length > 10_000) {
    throw new Error(
      `Database property ${propertyId} has an invalid option registry`,
    );
  }
  const seen = new Set<string>();
  return value.options.map((rawOption, index) => {
    if (!isJsonRecord(rawOption)) {
      throw new Error(
        `Database property ${propertyId} option ${index} must be an object`,
      );
    }
    const optionKeys = Object.keys(rawOption);
    if (
      optionKeys.some(
        (key) => key !== "id" && key !== "name" && key !== "color",
      ) ||
      typeof rawOption.id !== "string" ||
      rawOption.id.length === 0 ||
      rawOption.id !== rawOption.id.trim() ||
      typeof rawOption.name !== "string" ||
      rawOption.name.length === 0 ||
      rawOption.name !== rawOption.name.trim() ||
      (rawOption.color !== undefined && typeof rawOption.color !== "string")
    ) {
      throw new Error(
        `Database property ${propertyId} option ${index} is invalid`,
      );
    }
    if (seen.has(rawOption.id)) {
      throw new Error(
        `Database property ${propertyId} repeats option ID ${rawOption.id}`,
      );
    }
    seen.add(rawOption.id);
    return {
      id: rawOption.id,
      name: rawOption.name,
      ...(rawOption.color === undefined ? {} : { color: rawOption.color }),
    };
  });
};

const v67DatabasePropertyUsedOptionIds = (
  db: Database.Database,
  property: {
    readonly id: string;
    readonly value_type: "select" | "multi_select";
  },
): readonly string[] => {
  const values = db
    .prepare(
      `
      SELECT value_json
      FROM database_property_values
      WHERE property_id = ?
      ORDER BY membership_id
    `,
    )
    .all(property.id) as Array<{ readonly value_json: string }>;
  const ids = new Set<string>();
  for (const row of values) {
    let value: unknown;
    try {
      value = JSON.parse(row.value_json) as unknown;
    } catch {
      throw new Error(
        `Database property ${property.id} has invalid persisted value JSON`,
      );
    }
    if (value === null) continue;
    if (property.value_type === "select") {
      if (typeof value !== "string") {
        throw new Error(
          `Database property ${property.id} has a non-string select value`,
        );
      }
      ids.add(value);
      continue;
    }
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === "string")
    ) {
      throw new Error(
        `Database property ${property.id} has an invalid multi-select value`,
      );
    }
    for (const id of value) ids.add(id);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
};

function materializeV67DatabasePropertyConfigs(db: Database.Database): void {
  const properties = db
    .prepare(
      `
      SELECT id, database_block_id, project_id, key, value_type, config_json
      FROM database_properties
      WHERE lifecycle = 'active' AND value_type IN ('select', 'multi_select')
      ORDER BY project_id, database_block_id, rank_key, id
    `,
    )
    .all() as Array<{
    readonly id: string;
    readonly database_block_id: string;
    readonly project_id: string;
    readonly key: string;
    readonly value_type: "select" | "multi_select";
    readonly config_json: string;
  }>;
  const update = db.prepare(
    "UPDATE database_properties SET config_json = ? WHERE id = ?",
  );
  for (const property of properties) {
    const isPrimaryProperty =
      property.database_block_id ===
      primaryDatabaseBlockId(property.project_id);
    const seededDefinition = isPrimaryProperty
      ? PRIMARY_DATABASE_PROPERTY_DEFINITIONS.find(
          (definition) => definition.key === property.key,
        )
      : undefined;
    const fixedSeededOptions =
      seededDefinition &&
      (property.key === "status" ||
        property.key === "priority" ||
        property.key === "estimate")
        ? parseV67DatabasePropertyOptions(
            JSON.stringify(seededDefinition.config),
            property.id,
          )
        : null;
    const existingOptions =
      fixedSeededOptions ??
      parseV67DatabasePropertyOptions(property.config_json, property.id);
    const optionsById = new Map(
      existingOptions.map((option) => [option.id, option] as const),
    );
    const usedOptionIds = v67DatabasePropertyUsedOptionIds(db, property);
    for (const optionId of usedOptionIds) {
      if (optionsById.has(optionId)) continue;
      if (fixedSeededOptions) {
        throw new Error(
          `Seeded Database property ${property.id} has orphan value ${optionId}`,
        );
      }
      optionsById.set(optionId, { id: optionId, name: optionId });
    }
    if (optionsById.size > 10_000) {
      throw new Error(
        `Database property ${property.id} exceeds the option registry limit`,
      );
    }
    const options =
      fixedSeededOptions ??
      [...optionsById.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
    update.run(JSON.stringify({ options }), property.id);
  }
}

function normalizeV67DatabaseRanks(db: Database.Database): void {
  const groupBy = <T>(
    values: readonly T[],
    keyOf: (value: T) => string,
  ): Map<string, T[]> => {
    const groups = new Map<string, T[]>();
    for (const value of values) {
      const key = keyOf(value);
      const group = groups.get(key);
      if (group) {
        group.push(value);
      } else {
        groups.set(key, [value]);
      }
    }
    return groups;
  };

  const placements = db
    .prepare(
      `
      SELECT block_id AS id, project_id
      FROM top_level_block_placements
      ORDER BY project_id, rank_key, block_id
    `,
    )
    .all() as Array<{ readonly id: string; readonly project_id: string }>;
  const placementsByProject = groupBy(
    placements,
    (placement) => placement.project_id,
  );
  const updatePlacement = db.prepare(
    "UPDATE top_level_block_placements SET rank_key = ? WHERE block_id = ?",
  );
  for (const projectPlacements of placementsByProject.values()) {
    projectPlacements.forEach((placement, index) => {
      updatePlacement.run(
        databaseFractionalRankForOrdinal(index, projectPlacements.length),
        placement.id,
      );
    });
  }

  const properties = db
    .prepare(
      `
      SELECT id, database_block_id
      FROM database_properties
      ORDER BY database_block_id, lifecycle, rank_key, id
    `,
    )
    .all() as Array<{
    readonly id: string;
    readonly database_block_id: string;
  }>;
  const propertiesByDatabase = groupBy(
    properties,
    (property) => property.database_block_id,
  );
  const updateProperty = db.prepare(
    "UPDATE database_properties SET rank_key = ? WHERE id = ?",
  );
  for (const databaseProperties of propertiesByDatabase.values()) {
    databaseProperties.forEach((property, index) => {
      updateProperty.run(
        databaseFractionalRankForOrdinal(index, databaseProperties.length),
        property.id,
      );
    });
  }

  const views = db
    .prepare(
      `
      SELECT id, database_block_id
      FROM database_views
      ORDER BY database_block_id, is_primary DESC, created_at, id
    `,
    )
    .all() as Array<{
    readonly id: string;
    readonly database_block_id: string;
  }>;
  const viewsByDatabase = groupBy(views, (view) => view.database_block_id);
  const updateView = db.prepare(
    "UPDATE database_views SET rank_key = ? WHERE id = ?",
  );
  for (const databaseViews of viewsByDatabase.values()) {
    databaseViews.forEach((view, index) => {
      updateView.run(
        databaseFractionalRankForOrdinal(index, databaseViews.length),
        view.id,
      );
    });
  }

  const positions = db
    .prepare(
      `
      SELECT view_id, block_id, group_key
      FROM database_view_positions
      ORDER BY view_id, group_key, rank_key, block_id
    `,
    )
    .all() as Array<{
    readonly view_id: string;
    readonly block_id: string;
    readonly group_key: string | null;
  }>;
  const positionsByGroup = groupBy(positions, (position) =>
    JSON.stringify([position.view_id, position.group_key]),
  );
  const updatePosition = db.prepare(
    `UPDATE database_view_positions SET rank_key = ? WHERE view_id = ? AND block_id = ?`,
  );
  for (const groupPositions of positionsByGroup.values()) {
    groupPositions.forEach((position, index) => {
      updatePosition.run(
        databaseFractionalRankForOrdinal(index, groupPositions.length),
        position.view_id,
        position.block_id,
      );
    });
  }
}

function materializeV67DatabaseViewConfigs(db: Database.Database): void {
  const views = db
    .prepare(
      `
      SELECT
        view.id,
        view.project_id,
        view.database_block_id,
        view.is_primary,
        capability.is_primary AS database_is_primary
      FROM database_views view
      INNER JOIN database_capabilities capability
        ON capability.block_id = view.database_block_id
       AND capability.project_id = view.project_id
      WHERE view.lifecycle = 'active'
      ORDER BY view.project_id, view.id
    `,
    )
    .all() as Array<{
    readonly id: string;
    readonly project_id: string;
    readonly database_block_id: string;
    readonly is_primary: number;
    readonly database_is_primary: number;
  }>;
  const update = db.prepare(
    "UPDATE database_views SET config_json = ? WHERE id = ?",
  );
  for (const view of views) {
    const isSeededPrimary =
      view.database_is_primary === 1 &&
      view.is_primary === 1 &&
      view.database_block_id === primaryDatabaseBlockId(view.project_id) &&
      view.id === primaryDatabaseViewId(view.project_id);
    if (!isSeededPrimary) continue;
    update.run(makePrimaryDatabaseViewConfig(view.project_id), view.id);
  }
}

const v67ViewFilterPropertyIds = (
  filter: DatabaseViewFilterNode,
): readonly string[] => {
  if (filter.kind === "clause") return [filter.propertyId];
  return filter.children.flatMap(v67ViewFilterPropertyIds);
};

function assertV67GeneralDatabaseIntegrity(db: Database.Database): void {
  const invalidCapability = db
    .prepare(
      `
      SELECT capability.block_id
      FROM database_capabilities capability
      LEFT JOIN blocks block
        ON block.id = capability.block_id
       AND block.project_id = capability.project_id
      WHERE block.id IS NULL OR block.type <> 'database'
      LIMIT 1
    `,
    )
    .get() as { readonly block_id: string } | undefined;
  if (invalidCapability) {
    throw new Error(
      `Database capability ${invalidCapability.block_id} has no Database Block owner`,
    );
  }

  const activeDatabaseWithoutView = db
    .prepare(
      `
      SELECT capability.block_id
      FROM database_capabilities capability
      INNER JOIN blocks block
        ON block.id = capability.block_id
       AND block.project_id = capability.project_id
       AND block.lifecycle = 'active'
      WHERE NOT EXISTS (
        SELECT 1
        FROM database_views view
        WHERE view.database_block_id = capability.block_id
          AND view.project_id = capability.project_id
          AND view.lifecycle = 'active'
      )
      LIMIT 1
    `,
    )
    .get() as { readonly block_id: string } | undefined;
  if (activeDatabaseWithoutView) {
    throw new Error(
      `Active Database ${activeDatabaseWithoutView.block_id} has no durable View`,
    );
  }

  const activeViews = db
    .prepare(
      `
      SELECT
        view.id,
        view.project_id,
        view.database_block_id,
        view.config_json,
        view.is_primary,
        capability.is_primary AS database_is_primary
      FROM database_views view
      INNER JOIN database_capabilities capability
        ON capability.block_id = view.database_block_id
       AND capability.project_id = view.project_id
      WHERE view.lifecycle = 'active'
    `,
    )
    .all() as Array<{
    readonly id: string;
    readonly project_id: string;
    readonly database_block_id: string;
    readonly config_json: string;
    readonly is_primary: number;
    readonly database_is_primary: number;
  }>;
  for (const view of activeViews) {
    let rawConfig: unknown;
    try {
      rawConfig = JSON.parse(view.config_json) as unknown;
    } catch {
      throw new Error(`Database View ${view.id} has invalid config JSON`);
    }
    const schemaKey =
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      !Array.isArray(rawConfig) &&
      "schemaKey" in rawConfig
        ? rawConfig.schemaKey
        : undefined;
    const schemaVersion =
      typeof rawConfig === "object" &&
      rawConfig !== null &&
      !Array.isArray(rawConfig) &&
      "schemaVersion" in rawConfig
        ? rawConfig.schemaVersion
        : undefined;
    if (
      schemaKey === "nodex.database-view/legacy-inline" &&
      schemaVersion === 1
    ) {
      continue;
    }
    if (schemaKey !== "nodex.database-view" || schemaVersion !== 1) {
      throw new Error(
        `Database View ${view.id} uses an unsupported durable config schema`,
      );
    }
    const isSeededPrimary =
      view.database_is_primary === 1 &&
      view.is_primary === 1 &&
      view.database_block_id === primaryDatabaseBlockId(view.project_id) &&
      view.id === primaryDatabaseViewId(view.project_id);
    if (
      view.database_is_primary === 1 &&
      view.is_primary === 1 &&
      !isSeededPrimary
    ) {
      throw new Error(
        `Primary Database View ${view.id} does not use its seeded stable identity`,
      );
    }
    const config = parseGeneralDatabaseViewConfig(rawConfig);
    const propertyIds = new Set([
      ...v67ViewFilterPropertyIds(config.filter),
      ...config.sort.flatMap((sort) =>
        sort.field.kind === "property" ? [sort.field.propertyId] : [],
      ),
      ...(config.group ? [config.group.propertyId] : []),
      ...config.display.propertyIds,
    ]);
    for (const propertyId of propertyIds) {
      const matches = db
        .prepare(
          `
          SELECT 1 FROM database_properties
          WHERE id = ? AND database_block_id = ? AND lifecycle = 'active'
        `,
        )
        .get(propertyId, view.database_block_id);
      if (matches) continue;
      throw new Error(
        `Database View ${view.id} references property ${propertyId} outside its active schema`,
      );
    }
  }

  const foreignKeyViolations = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      "Database schema v67 migration left foreign-key violations",
    );
  }
  const integrity = db.pragma("integrity_check") as Array<{
    readonly integrity_check: string;
  }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new Error("Database schema v67 migration failed integrity_check");
  }
  const staleSchemaReference = db
    .prepare(
      `
      SELECT name
      FROM sqlite_schema
      WHERE lower(sql) LIKE '%database_properties_v66%'
         OR lower(sql) LIKE '%database_property_values_v66%'
      LIMIT 1
    `,
    )
    .get() as { readonly name: string } | undefined;
  if (!staleSchemaReference) return;
  throw new Error(
    `Database schema v67 retained a temporary-table reference in ${staleSchemaReference.name}`,
  );
}

function migrateSchema66To67(db: Database.Database): void {
  const migrate = db.transaction(() => {
    if (!tableHasColumn(db, "database_capabilities", "name")) {
      db.exec(
        "ALTER TABLE database_capabilities ADD COLUMN name TEXT NOT NULL DEFAULT 'Cards'",
      );
    }
    if (!tableHasColumn(db, "database_capabilities", "schema_revision")) {
      db.exec(
        "ALTER TABLE database_capabilities ADD COLUMN schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1)",
      );
    }
    if (!tableHasColumn(db, "database_memberships", "revision")) {
      db.exec(
        "ALTER TABLE database_memberships ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)",
      );
    }
    if (!tableHasColumn(db, "database_views", "revision")) {
      db.exec(
        "ALTER TABLE database_views ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)",
      );
    }
    if (!tableHasColumn(db, "database_views", "rank_key")) {
      db.exec(
        "ALTER TABLE database_views ADD COLUMN rank_key TEXT NOT NULL DEFAULT '00000000'",
      );
    }
    if (!tableHasColumn(db, "database_views", "lifecycle")) {
      db.exec(
        "ALTER TABLE database_views ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'deleted'))",
      );
    }
    if (!tableHasColumn(db, "database_view_positions", "revision")) {
      db.exec(
        "ALTER TABLE database_view_positions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)",
      );
    }

    rebuildV67DatabasePropertyTables(db);
    materializeV67DatabasePropertyConfigs(db);
    // SQLite rewrites trigger SQL when a referenced table is renamed. Rebuild
    // the temporary Card migration seam so no trigger retains the v66 backup
    // names after the authoritative property tables are swapped.
    recreateV62CardProjectionTriggers(db);
    db.exec(`
      DROP INDEX IF EXISTS idx_database_views_primary;
      CREATE UNIQUE INDEX idx_database_views_primary
        ON database_views(database_block_id)
        WHERE is_primary = 1 AND lifecycle = 'active';
    `);
    normalizeV67DatabaseRanks(db);
    materializeV67DatabaseViewConfigs(db);
    assertV67GeneralDatabaseIntegrity(db);
    setUserVersion(db, 67);
  });
  migrate.immediate();
}

function runMigrations(
  db: Database.Database,
  currentVersion: number,
  targets: number[],
  options: EnsureDatabaseOptions,
): void {
  let fromVersion = currentVersion;
  for (const target of targets) {
    options.onMigrationProgress?.({
      type: "InProgress",
      value: targets.indexOf(target) / targets.length,
    });
    if (target === 31) {
      migrateToSchema31(db, fromVersion);
      fromVersion = 31;
      continue;
    }
    if (target === 32) {
      if (fromVersion !== 31) {
        throw new Error(
          `Unsupported Nodex database migration target 32 from ${fromVersion}`,
        );
      }
      migrateSchema31To32(db);
      fromVersion = 32;
      continue;
    }
    if (target === 33) {
      if (fromVersion !== 32) {
        throw new Error(
          `Unsupported Nodex database migration target 33 from ${fromVersion}`,
        );
      }
      migrateSchema32To33(db);
      fromVersion = 33;
      continue;
    }
    if (target === 34) {
      if (fromVersion !== 33) {
        throw new Error(
          `Unsupported Nodex database migration target 34 from ${fromVersion}`,
        );
      }
      migrateSchema33To34(db);
      fromVersion = 34;
      continue;
    }
    if (target === 35) {
      if (fromVersion !== 34) {
        throw new Error(
          `Unsupported Nodex database migration target 35 from ${fromVersion}`,
        );
      }
      migrateSchema34To35(db);
      fromVersion = 35;
      continue;
    }
    if (target === 37) {
      if (fromVersion !== 35) {
        if (fromVersion !== 36) {
          throw new Error(
            `Unsupported Nodex database migration target 37 from ${fromVersion}`,
          );
        }
        migrateSchema36To37(db);
        fromVersion = 37;
        continue;
      }
      migrateSchema35To37(db);
      fromVersion = 37;
      continue;
    }
    if (target === 38) {
      if (fromVersion !== 37) {
        throw new Error(
          `Unsupported Nodex database migration target 38 from ${fromVersion}`,
        );
      }
      migrateSchema37To38(db);
      fromVersion = 38;
      continue;
    }
    if (target === 39) {
      if (fromVersion !== 38) {
        throw new Error(
          `Unsupported Nodex database migration target 39 from ${fromVersion}`,
        );
      }
      migrateSchema38To39(db);
      fromVersion = 39;
      continue;
    }
    if (target === 40) {
      if (fromVersion !== 39) {
        throw new Error(
          `Unsupported Nodex database migration target 40 from ${fromVersion}`,
        );
      }
      migrateSchema39To40(db);
      fromVersion = 40;
      continue;
    }
    if (target === 41) {
      if (fromVersion !== 40) {
        throw new Error(
          `Unsupported Nodex database migration target 41 from ${fromVersion}`,
        );
      }
      migrateSchema40To41(db);
      fromVersion = 41;
      continue;
    }
    if (target === 42) {
      if (fromVersion !== 41) {
        throw new Error(
          `Unsupported Nodex database migration target 42 from ${fromVersion}`,
        );
      }
      migrateSchema41To42(db);
      fromVersion = 42;
      continue;
    }
    if (target === 43) {
      if (fromVersion !== 42) {
        throw new Error(
          `Unsupported Nodex database migration target 43 from ${fromVersion}`,
        );
      }
      migrateSchema42To43(db);
      fromVersion = 43;
      continue;
    }
    if (target === 44) {
      if (fromVersion !== 43) {
        throw new Error(
          `Unsupported Nodex database migration target 44 from ${fromVersion}`,
        );
      }
      migrateSchema43To44(db);
      fromVersion = 44;
      continue;
    }
    if (target === 45) {
      if (fromVersion !== 44) {
        throw new Error(
          `Unsupported Nodex database migration target 45 from ${fromVersion}`,
        );
      }
      migrateSchema44To45(db);
      fromVersion = 45;
      continue;
    }
    if (target === 46) {
      if (fromVersion !== 45) {
        throw new Error(
          `Unsupported Nodex database migration target 46 from ${fromVersion}`,
        );
      }
      migrateSchema45To46(db);
      fromVersion = 46;
      continue;
    }
    if (target === 47) {
      if (fromVersion !== 46) {
        throw new Error(
          `Unsupported Nodex database migration target 47 from ${fromVersion}`,
        );
      }
      migrateSchema46To47(db);
      fromVersion = 47;
      continue;
    }
    if (target === 48) {
      if (fromVersion !== 47) {
        throw new Error(
          `Unsupported Nodex database migration target 48 from ${fromVersion}`,
        );
      }
      migrateSchema47To48(db);
      fromVersion = 48;
      continue;
    }
    if (target === 49) {
      if (fromVersion !== 48) {
        throw new Error(
          `Unsupported Nodex database migration target 49 from ${fromVersion}`,
        );
      }
      migrateSchema48To49(db);
      fromVersion = 49;
      continue;
    }
    if (target === 50) {
      if (fromVersion !== 49) {
        throw new Error(
          `Unsupported Nodex database migration target 50 from ${fromVersion}`,
        );
      }
      migrateSchema49To50(db);
      fromVersion = 50;
      continue;
    }
    if (target === 51) {
      if (fromVersion !== 50) {
        throw new Error(
          `Unsupported Nodex database migration target 51 from ${fromVersion}`,
        );
      }
      migrateSchema50To51(db);
      fromVersion = 51;
      continue;
    }
    if (target === 52) {
      if (fromVersion !== 51) {
        throw new Error(
          `Unsupported Nodex database migration target 52 from ${fromVersion}`,
        );
      }
      migrateSchema51To52(db);
      fromVersion = 52;
      continue;
    }
    if (target === 53) {
      if (fromVersion !== 52) {
        throw new Error(
          `Unsupported Nodex database migration target 53 from ${fromVersion}`,
        );
      }
      migrateSchema52To53(db);
      fromVersion = 53;
      continue;
    }
    if (target === 54) {
      if (fromVersion !== 53) {
        throw new Error(
          `Unsupported Nodex database migration target 54 from ${fromVersion}`,
        );
      }
      migrateSchema53To54(db);
      fromVersion = 54;
      continue;
    }
    if (target === 55) {
      if (fromVersion !== 54) {
        throw new Error(
          `Unsupported Nodex database migration target 55 from ${fromVersion}`,
        );
      }
      migrateSchema54To55(db);
      fromVersion = 55;
      continue;
    }
    if (target === 56) {
      if (fromVersion !== 55) {
        throw new Error(
          `Unsupported Nodex database migration target 56 from ${fromVersion}`,
        );
      }
      migrateSchema55To56(db);
      fromVersion = 56;
      continue;
    }
    if (target === 57) {
      if (fromVersion !== 56) {
        throw new Error(
          `Unsupported Nodex database migration target 57 from ${fromVersion}`,
        );
      }
      migrateSchema56To57(db);
      fromVersion = 57;
      continue;
    }
    if (target === 58) {
      if (fromVersion !== 57) {
        throw new Error(
          `Unsupported Nodex database migration target 58 from ${fromVersion}`,
        );
      }
      migrateSchema57To58(db);
      fromVersion = 58;
      continue;
    }
    if (target === 59) {
      if (fromVersion !== 58) {
        throw new Error(
          `Unsupported Nodex database migration target 59 from ${fromVersion}`,
        );
      }
      createSchemaMigrationSafetyBackup(db, 58, 59);
      migrateSchema58To59(db);
      fromVersion = 59;
      continue;
    }
    if (target === 60) {
      if (fromVersion !== 59) {
        throw new Error(
          `Unsupported Nodex database migration target 60 from ${fromVersion}`,
        );
      }
      migrateSchema59To60(db);
      fromVersion = 60;
      continue;
    }
    if (target === 61) {
      if (fromVersion !== 60) {
        throw new Error(
          `Unsupported Nodex database migration target 61 from ${fromVersion}`,
        );
      }
      migrateSchema60To61(db);
      fromVersion = 61;
      continue;
    }
    if (target === 62) {
      if (fromVersion !== 61) {
        throw new Error(
          `Unsupported Nodex database migration target 62 from ${fromVersion}`,
        );
      }
      migrateSchema61To62(db);
      fromVersion = 62;
      continue;
    }
    if (target === 63) {
      if (fromVersion !== 62) {
        throw new Error(
          `Unsupported Nodex database migration target 63 from ${fromVersion}`,
        );
      }
      migrateSchema62To63(db);
      fromVersion = 63;
      continue;
    }
    if (target === 64) {
      if (fromVersion !== 63) {
        throw new Error(
          `Unsupported Nodex database migration target 64 from ${fromVersion}`,
        );
      }
      migrateSchema63To64(db);
      fromVersion = 64;
      continue;
    }
    if (target === 65) {
      if (fromVersion !== 64) {
        throw new Error(
          `Unsupported Nodex database migration target 65 from ${fromVersion}`,
        );
      }
      migrateSchema64To65(db);
      fromVersion = 65;
      continue;
    }
    if (target === 66) {
      if (fromVersion !== 65) {
        throw new Error(
          `Unsupported Nodex database migration target 66 from ${fromVersion}`,
        );
      }
      migrateSchema65To66(db);
      fromVersion = 66;
      continue;
    }
    if (target === 67) {
      if (fromVersion !== 66) {
        throw new Error(
          `Unsupported Nodex database migration target 67 from ${fromVersion}`,
        );
      }
      migrateSchema66To67(db);
      fromVersion = 67;
      continue;
    }
    throw new Error(`Unsupported Nodex database migration target ${target}`);
  }
  options.onMigrationProgress?.({ type: "Done" });
}

function resetDatabaseToLatestSchema(db: Database.Database): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const tableName of RESETTABLE_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    }
    db.pragma("auto_vacuum = INCREMENTAL");
    createLatestSchema(db);
    setUserVersion(db, CURRENT_SCHEMA_VERSION);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function seedDefaultProjectIfMissing(db: Database.Database): void {
  const projectCount = db
    .prepare("SELECT COUNT(*) as count FROM projects")
    .get() as {
    count: number;
  };
  if (projectCount.count > 0) return;

  const now = new Date().toISOString();
  const projectId = randomUUID();
  db.prepare(
    "INSERT INTO projects (id, name, description, icon, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(projectId, "Default", "", "", now, now);
  db.prepare(
    'INSERT INTO project_order (project_id, "order", updated) VALUES (?, ?, ?)',
  ).run(projectId, 0, now);
  insertInitialDatabaseViewSession(db, projectId, now, {
    shiftExisting: false,
  });
  ensureBlockFoundationForProject(db, projectId, now);
}

export function ensureDatabase(options: EnsureDatabaseOptions = {}): void {
  const dbPath = getDatabasePath();
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  migrateLegacyDatabaseFileName(dir);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const currentVersion = getUserVersion(db);
    if (currentVersion === 0) {
      resetDatabaseToLatestSchema(db);
    } else {
      const targets = getSchemaMigrationTargets(currentVersion);
      if (targets === null) {
        throw new Error(
          `Unsupported Nodex database schema version ${currentVersion}. Expected ${CURRENT_SCHEMA_VERSION}. Delete or recreate the local database if you want a fresh start.`,
        );
      }
      runMigrations(db, currentVersion, targets, options);
    }

    db.exec("DROP TABLE IF EXISTS codex_thread_snapshots");
    seedDefaultProjectIfMissing(db);
    const projects = db
      .prepare("SELECT id, created FROM projects")
      .all() as Array<{
      id: string;
      created: string;
    }>;
    for (const project of projects) {
      ensureBlockFoundationForProject(db, project.id, project.created);
    }
  } finally {
    db.close();
  }
}
