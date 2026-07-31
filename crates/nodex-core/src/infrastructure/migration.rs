use std::collections::BTreeMap;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, Utc};
use rusqlite::{Connection, MAIN_DB, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use yrs::updates::decoder::Decode;
#[cfg(test)]
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, StateVector, Transact, Update};

use crate::document::{
    BlockDocumentSchema, CANVAS_SCENE_HASH_VERSION, CanvasHashItemKind, CanvasScene,
    DocumentMaterialization, MAX_DOCUMENT_UPDATE_BYTES, canvas_hash_bucket,
    canvas_semantic_intent_fingerprint, compute_canvas_scene_incremental_metadata,
    create_compatible_document, decode_block_document, decode_state_vector_v1,
    derive_canvas_element, has_pending_dependencies, load_v94_canvas_scene,
    materialize_decoded_document, read_document_authority, rebuild_legacy_import_projections,
};
use crate::domain::project_appearance::{
    legacy_project_appearance, project_marker_color_literal, project_marker_icon_literal,
};
use nodex_core_contracts::workspace::ProjectMarker;

use super::document_repository::{DocumentHeadRow, DocumentReadRepository};
use super::schema::{
    CORE_SCHEMA_VERSION, TYPESCRIPT_SCHEMA_VERSION, install_v84_schema, read_schema_inventory,
    schema_inventory_fingerprint, v84_schema_objects_sql, validate_exact_v84_schema,
};
use super::sqlite::{
    StoreError, StoreErrorCode, open_immutable_reader, validate_store, with_immediate_transaction,
};

const CORE_SCHEMA_OWNER: &str = "rust_core";
const MIN_SUPPORTED_SCHEMA_VERSION: i64 = TYPESCRIPT_SCHEMA_VERSION;
const LEGACY_WRITABLE_ROOTS_IMPORT_KEY: &str = "codex_thread_writable_roots_v1";
const LEGACY_WRITABLE_ROOTS_FILE_NAME: &str = "codex-thread-writable-roots-v1.json";
const AUTOMATION_JITTER_SALT_FILE: &str = "automations/.run-jitter-salt";
const MAX_LEGACY_WRITABLE_ROOTS_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_AUTOMATION_JITTER_SALT_BYTES: u64 = 512;
const MAX_WRITABLE_ROOTS_PER_THREAD: usize = 128;
const MAX_WRITABLE_ROOT_BYTES: usize = 16_384;
const UUID_V7_UNIX_TIMESTAMP_HEX_DIGITS: usize = 12;
const V97_CANVAS_OWNERS_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS canvas_owners (
  block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(block_id) BETWEEN 1 AND 512),
  CHECK (length(library_id) BETWEEN 1 AND 512),
  CHECK (length(created_at) > 0),
  CHECK (length(updated_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_canvas_owners_library
  ON canvas_owners(library_id, block_id);

CREATE TRIGGER IF NOT EXISTS canvas_owners_validate_insert
BEFORE INSERT ON canvas_owners
WHEN NOT EXISTS (
  SELECT 1
  FROM blocks block
  JOIN projects project ON project.id = block.project_id
  JOIN block_documents ownership ON ownership.block_id = block.id
  JOIN documents document ON document.id = ownership.document_id
  WHERE block.id = NEW.block_id
    AND block.type = 'canvas'
    AND project.library_id = NEW.library_id
    AND document.sync_engine = 'canvas_scene'
)
BEGIN
  SELECT RAISE(ABORT, 'Canvas owner metadata requires a Canvas Document owner');
END;
"#;
const V85_SCHEMA_SQL: &str = r#"
CREATE TABLE core_store_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_owner TEXT NOT NULL CHECK (schema_owner = 'rust_core'),
  store_format_version INTEGER NOT NULL CHECK (store_format_version >= 84),
  migrated_from_version INTEGER,
  migration_backup_name TEXT,
  migrated_at_unix_ms INTEGER NOT NULL CHECK (migrated_at_unix_ms >= 0),
  CHECK (
    (migrated_from_version IS NULL AND migration_backup_name IS NULL)
    OR (migrated_from_version = 84 AND length(migration_backup_name) > 0)
  )
) STRICT;

CREATE TABLE document_engine_fingerprints (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
  source_state_hash TEXT NOT NULL,
  yrs_state_vector_sha256 TEXT NOT NULL,
  yrs_full_state_sha256 TEXT NOT NULL,
  materialization_sha256 TEXT NOT NULL,
  validated_at_unix_ms INTEGER NOT NULL CHECK (validated_at_unix_ms >= 0),
  PRIMARY KEY (document_id, generation, head_seq),
  CHECK (length(source_state_hash) = 64 AND source_state_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(yrs_state_vector_sha256) = 64 AND yrs_state_vector_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(yrs_full_state_sha256) = 64 AND yrs_full_state_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(materialization_sha256) = 64 AND materialization_sha256 NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID, STRICT;

CREATE TABLE core_module_receipts (
  module_name TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  adapter_kind TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  store_epoch TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  event_sequence INTEGER REFERENCES change_log(seq) ON DELETE RESTRICT,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (module_name, operation_id),
  CHECK (module_name IN (
    'library', 'database', 'owned_document', 'project_workspace',
    'automation', 'store_administration'
  )),
  CHECK (length(operation_id) BETWEEN 1 AND 512),
  CHECK (length(profile_id) BETWEEN 1 AND 512),
  CHECK (project_id IS NULL OR length(project_id) BETWEEN 1 AND 512),
  CHECK (adapter_kind IN ('electron_host', 'loopback_http', 'native_cli', 'agent', 'test')),
  CHECK (length(operation_kind) BETWEEN 1 AND 128),
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  CHECK (length(committed_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE document_structural_barriers (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  head_seq INTEGER NOT NULL CHECK (head_seq >= 1),
  operation_id TEXT NOT NULL,
  block_ids_json TEXT NOT NULL,
  title_fence INTEGER NOT NULL CHECK (title_fence IN (0, 1)),
  committed_at TEXT NOT NULL,
  PRIMARY KEY (document_id, generation, head_seq),
  UNIQUE (operation_id),
  CHECK (length(operation_id) BETWEEN 1 AND 512),
  CHECK (json_valid(block_ids_json) AND json_type(block_ids_json) = 'array'),
  CHECK (length(committed_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE TRIGGER document_structural_barriers_validate_insert
BEFORE INSERT ON document_structural_barriers
WHEN NOT EXISTS (
  SELECT 1 FROM documents document
  WHERE document.id = NEW.document_id
    AND document.generation = NEW.generation
    AND document.head_seq = NEW.head_seq
    AND document.readiness = 'ready'
) OR EXISTS (
  SELECT 1 FROM json_each(NEW.block_ids_json) block_id
  WHERE block_id.type <> 'text'
    OR length(block_id.value) NOT BETWEEN 1 AND 512
) OR (
  SELECT count(*) FROM json_each(NEW.block_ids_json)
) <> (
  SELECT count(DISTINCT block_id.value)
  FROM json_each(NEW.block_ids_json) block_id
)
BEGIN
  SELECT RAISE(ABORT, 'Document structural barrier is invalid');
END;

INSERT OR IGNORE INTO nodex_agent_token_keys(id, key_material)
VALUES (1, randomblob(32));
"#;

const V85_EXECUTION_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS core_legacy_imports (
  import_key TEXT PRIMARY KEY,
  imported_at_unix_ms INTEGER NOT NULL CHECK (imported_at_unix_ms >= 0),
  CHECK (length(import_key) BETWEEN 1 AND 128)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS codex_thread_writable_roots (
  thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  root TEXT NOT NULL,
  root_order INTEGER NOT NULL CHECK (root_order >= 0),
  updated_at_unix_ms INTEGER NOT NULL CHECK (updated_at_unix_ms >= 0),
  PRIMARY KEY (thread_id, root),
  UNIQUE (thread_id, root_order),
  CHECK (length(thread_id) BETWEEN 1 AND 512),
  CHECK (length(root) BETWEEN 1 AND 16384)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS core_automation_runtime_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  jitter_salt TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL CHECK (created_at_unix_ms >= 0),
  CHECK (length(jitter_salt) BETWEEN 1 AND 512)
) STRICT;

CREATE TABLE IF NOT EXISTS core_automation_leases (
  lease_id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES codex_scheduled_automations(automation_id)
    ON DELETE CASCADE,
  scheduled_for_ms INTEGER NOT NULL CHECK (scheduled_for_ms >= 0),
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 4294967295),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'failed', 'cancelled')),
  claimed_at_ms INTEGER NOT NULL CHECK (claimed_at_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > claimed_at_ms),
  settled_at_ms INTEGER,
  retry_at_ms INTEGER,
  reason_code TEXT,
  UNIQUE (automation_id, scheduled_for_ms, attempt),
  CHECK (length(lease_id) BETWEEN 1 AND 512),
  CHECK (settled_at_ms IS NULL OR settled_at_ms >= claimed_at_ms),
  CHECK (retry_at_ms IS NULL OR retry_at_ms >= 0),
  CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 128),
  CHECK (
    (status = 'claimed' AND settled_at_ms IS NULL)
    OR (status <> 'claimed' AND settled_at_ms IS NOT NULL)
  )
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_automation_leases_active_occurrence
  ON core_automation_leases(automation_id, scheduled_for_ms)
  WHERE status = 'claimed';

CREATE INDEX IF NOT EXISTS idx_core_automation_leases_inbox
  ON core_automation_leases(status, expires_at_ms, scheduled_for_ms, lease_id);

CREATE TABLE IF NOT EXISTS core_reminder_leases (
  lease_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  receipt_project_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  occurrence_start_ms INTEGER NOT NULL CHECK (occurrence_start_ms >= 0),
  reminder_offset_minutes INTEGER NOT NULL,
  due_at_ms INTEGER NOT NULL CHECK (due_at_ms >= 0),
  title TEXT NOT NULL,
  snooze_id INTEGER REFERENCES reminder_snoozes(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 4294967295),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'failed', 'cancelled')),
  claimed_at_ms INTEGER NOT NULL CHECK (claimed_at_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > claimed_at_ms),
  settled_at_ms INTEGER,
  retry_at_ms INTEGER,
  reason_code TEXT,
  UNIQUE (receipt_project_id, page_id, occurrence_start_ms, reminder_offset_minutes, attempt),
  FOREIGN KEY (page_id, receipt_project_id)
    REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (length(lease_id) BETWEEN 1 AND 512),
  CHECK (length(title) <= 16384),
  CHECK (settled_at_ms IS NULL OR settled_at_ms >= claimed_at_ms),
  CHECK (retry_at_ms IS NULL OR retry_at_ms >= 0),
  CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 128),
  CHECK (
    (status = 'claimed' AND settled_at_ms IS NULL)
    OR (status <> 'claimed' AND settled_at_ms IS NOT NULL)
  )
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_reminder_leases_active_coordinate
  ON core_reminder_leases(
    receipt_project_id, page_id, occurrence_start_ms, reminder_offset_minutes
  ) WHERE status = 'claimed';

CREATE INDEX IF NOT EXISTS idx_core_reminder_leases_inbox
  ON core_reminder_leases(status, expires_at_ms, due_at_ms, lease_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_codex_scheduled_automations_active_heartbeat
  ON codex_scheduled_automations(target_thread_id)
  WHERE kind = 'heartbeat' AND status = 'ACTIVE' AND target_thread_id IS NOT NULL;
"#;

const V87_PROJECT_SESSION_TABS_SCHEMA_SQL: &str = r#"
DROP INDEX IF EXISTS idx_project_session_tabs_session_order;
DROP INDEX IF EXISTS idx_project_session_tabs_project;
DROP INDEX IF EXISTS idx_project_session_tabs_browser_identity;

ALTER TABLE project_session_tabs RENAME TO project_session_tabs_v86;

CREATE TABLE project_session_tabs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  browser_tab_id TEXT,
  panel_id TEXT NOT NULL DEFAULT 'right',
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  config_json TEXT NOT NULL,
  state_key INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  "order" INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind IN ('db_view', 'page_stage', 'terminal', 'browser', 'review', 'files')),
  CHECK (panel_id IN ('right', 'bottom')),
  CHECK (project_id IS NOT NULL OR kind IN ('browser', 'terminal', 'files')),
  CHECK (
    (kind = 'browser' AND browser_tab_id IS NOT NULL AND length(trim(browser_tab_id)) > 0)
    OR (kind <> 'browser' AND browser_tab_id IS NULL)
  )
);

INSERT INTO project_session_tabs(
  id, session_id, project_id, browser_tab_id, panel_id, kind, title, config_json,
  state_key, state_json, "order", created_at, updated_at
)
SELECT
  id, session_id, project_id, browser_tab_id, panel_id, kind, title,
  CASE WHEN kind = 'terminal' THEN json_remove(config_json, '$.projectId') ELSE config_json END,
  state_key, state_json, "order", created_at, updated_at
FROM project_session_tabs_v86;

DROP TABLE project_session_tabs_v86;

CREATE INDEX idx_project_session_tabs_session_order
  ON project_session_tabs(session_id, panel_id, "order", created_at);
CREATE INDEX idx_project_session_tabs_project
  ON project_session_tabs(project_id);
CREATE INDEX idx_project_session_tabs_browser_identity
  ON project_session_tabs(session_id, browser_tab_id);
"#;

const V90_WINDOW_OWNED_SESSION_VIEWS_SCHEMA_SQL: &str = r#"
CREATE TEMP TABLE project_session_initial_database_views (
  session_id TEXT PRIMARY KEY,
  database_view_id TEXT
) WITHOUT ROWID;

INSERT INTO project_session_initial_database_views(session_id, database_view_id)
SELECT
  session.id,
  (
    SELECT json_extract(tab.config_json, '$.databaseViewId')
    FROM project_session_tabs tab
    JOIN database_views view
      ON view.id = json_extract(tab.config_json, '$.databaseViewId')
    JOIN blocks database_block
      ON database_block.id = view.database_block_id
    WHERE tab.session_id = session.id
      AND tab.kind = 'db_view'
      AND tab.project_id = session.project_id
      AND database_block.project_id = session.project_id
      AND json_type(tab.config_json, '$.databaseViewId') = 'text'
      AND length(trim(json_extract(tab.config_json, '$.databaseViewId'))) > 0
    ORDER BY
      CASE tab.panel_id WHEN 'right' THEN 0 ELSE 1 END,
      tab."order",
      tab.created_at,
      tab.id
    LIMIT 1
  )
FROM project_sessions session;

DROP INDEX idx_project_session_tabs_session_order;
DROP INDEX idx_project_session_tabs_project;
DROP INDEX idx_project_session_tabs_browser_identity;
DROP TABLE project_session_tabs;

DROP INDEX idx_project_session_threads_thread;
DROP INDEX idx_project_sessions_project_order;
DROP INDEX idx_project_sessions_project_sidebar;

ALTER TABLE project_session_threads RENAME TO project_session_threads_v89;
ALTER TABLE project_sessions RENAME TO project_sessions_v89;

CREATE TABLE project_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  no_thread_fallback_title TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_order INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  initial_database_view_id TEXT
    REFERENCES database_views(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (pinned IN (0, 1)),
  CHECK (archived IN (0, 1)),
  CHECK (unread IN (0, 1))
);

CREATE TABLE project_session_threads (
  session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL
) WITHOUT ROWID;

INSERT INTO project_sessions(
  id, project_id, no_thread_fallback_title, "order", pinned, pinned_order,
  archived, archived_at, unread, initial_database_view_id, created_at, updated_at
)
SELECT
  legacy.id,
  legacy.project_id,
  legacy.no_thread_fallback_title,
  legacy."order",
  legacy.pinned,
  legacy.pinned_order,
  legacy.archived,
  legacy.archived_at,
  legacy.unread,
  initial.database_view_id,
  legacy.created_at,
  legacy.updated_at
FROM project_sessions_v89 legacy
JOIN project_session_initial_database_views initial ON initial.session_id = legacy.id;

INSERT INTO project_session_threads(session_id, thread_id, linked_at)
SELECT session_id, thread_id, linked_at
FROM project_session_threads_v89;

DROP TABLE project_session_threads_v89;
DROP TABLE project_sessions_v89;
DROP TABLE project_session_initial_database_views;

CREATE INDEX idx_project_sessions_project_order
  ON project_sessions(project_id, "order", created_at);
CREATE INDEX idx_project_sessions_project_sidebar
  ON project_sessions(project_id, archived, pinned, pinned_order, "order");
CREATE UNIQUE INDEX idx_project_session_threads_thread
  ON project_session_threads(thread_id);
"#;

const V91_WORKSPACE_SIDEBAR_LANES_SCHEMA_SQL: &str = r#"
CREATE TABLE workspace_sidebar_lanes (
  scope_key TEXT PRIMARY KEY,
  lane_kind TEXT NOT NULL CHECK (lane_kind IN ('project', 'projectless')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  order_mode TEXT NOT NULL CHECK (order_mode IN ('recency', 'manual')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  CHECK (
    (lane_kind = 'project' AND project_id IS NOT NULL AND scope_key = 'project:' || project_id)
    OR (lane_kind = 'projectless' AND project_id IS NULL AND scope_key = 'projectless')
  )
) WITHOUT ROWID, STRICT;

CREATE TABLE workspace_sidebar_positions (
  scope_key TEXT NOT NULL
    REFERENCES workspace_sidebar_lanes(scope_key) ON UPDATE CASCADE ON DELETE CASCADE,
  thread_id TEXT NOT NULL
    REFERENCES codex_threads(thread_id) ON UPDATE CASCADE ON DELETE CASCADE,
  rank_key INTEGER NOT NULL CHECK (rank_key >= 0),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_key, thread_id),
  UNIQUE (scope_key, rank_key)
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_workspace_sidebar_positions_lane_rank
  ON workspace_sidebar_positions(scope_key, rank_key, thread_id);
CREATE INDEX idx_workspace_sidebar_positions_thread
  ON workspace_sidebar_positions(thread_id, scope_key);

CREATE TABLE workspace_app_server_thread_observations (
  thread_id TEXT PRIMARY KEY
    REFERENCES codex_threads(thread_id) ON UPDATE CASCADE ON DELETE CASCADE,
  last_seen_sweep_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_workspace_app_server_thread_observations_sweep
  ON workspace_app_server_thread_observations(last_seen_sweep_id, thread_id);
"#;

// v93 removes the denormalized per-Session Database View pointer. The Project's
// primary Database default View is authoritative and resolved at read time;
// Sessions keep only the durable `database_starter` marker that drives the
// starter Session's first window materialization.
const V93_DATABASE_STARTER_SESSIONS_SCHEMA_SQL: &str = r#"
DROP INDEX idx_project_sessions_project_order;
DROP INDEX idx_project_sessions_project_sidebar;
DROP INDEX idx_project_session_threads_thread;

ALTER TABLE project_session_threads RENAME TO project_session_threads_v92;
ALTER TABLE project_sessions RENAME TO project_sessions_v92;

CREATE TABLE project_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  no_thread_fallback_title TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_order INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  database_starter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (pinned IN (0, 1)),
  CHECK (archived IN (0, 1)),
  CHECK (unread IN (0, 1)),
  CHECK (database_starter IN (0, 1))
);

CREATE TABLE project_session_threads (
  session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL
) WITHOUT ROWID;

INSERT INTO project_sessions(
  id, project_id, no_thread_fallback_title, "order", pinned, pinned_order,
  archived, archived_at, unread, database_starter, created_at, updated_at
)
SELECT
  legacy.id,
  legacy.project_id,
  legacy.no_thread_fallback_title,
  legacy."order",
  legacy.pinned,
  legacy.pinned_order,
  legacy.archived,
  legacy.archived_at,
  legacy.unread,
  CASE WHEN legacy.initial_database_view_id IS NOT NULL THEN 1 ELSE 0 END,
  legacy.created_at,
  legacy.updated_at
FROM project_sessions_v92 legacy;

INSERT INTO project_session_threads(session_id, thread_id, linked_at)
SELECT session_id, thread_id, linked_at
FROM project_session_threads_v92;

DROP TABLE project_session_threads_v92;
DROP TABLE project_sessions_v92;

CREATE INDEX idx_project_sessions_project_order
  ON project_sessions(project_id, "order", created_at);
CREATE INDEX idx_project_sessions_project_sidebar
  ON project_sessions(project_id, archived, pinned, pinned_order, "order");
CREATE UNIQUE INDEX idx_project_session_threads_thread
  ON project_session_threads(thread_id);
"#;

// v99 retires the UI-only starter Session. A marked Session without a Thread
// only existed to host the Project Database panel and is removed. A marked
// Session that has gained a Thread is user Conversation authority and is kept
// as an ordinary Session. The marker itself is removed from current Stores.
const V99_OWNER_SCOPED_SCENES_SCHEMA_SQL: &str = r#"
DROP INDEX idx_project_sessions_project_order;
DROP INDEX idx_project_sessions_project_sidebar;
DROP INDEX idx_project_session_threads_thread;

ALTER TABLE project_session_threads RENAME TO project_session_threads_v98;
ALTER TABLE project_sessions RENAME TO project_sessions_v98;

CREATE TABLE project_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  no_thread_fallback_title TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_order INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (pinned IN (0, 1)),
  CHECK (archived IN (0, 1)),
  CHECK (unread IN (0, 1))
);

CREATE TABLE project_session_threads (
  session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL
) WITHOUT ROWID;

INSERT INTO project_sessions(
  id, project_id, no_thread_fallback_title, "order", pinned, pinned_order,
  archived, archived_at, unread, created_at, updated_at
)
SELECT
  legacy.id,
  legacy.project_id,
  legacy.no_thread_fallback_title,
  legacy."order",
  legacy.pinned,
  legacy.pinned_order,
  legacy.archived,
  legacy.archived_at,
  legacy.unread,
  legacy.created_at,
  legacy.updated_at
FROM project_sessions_v98 legacy
WHERE legacy.database_starter = 0
   OR EXISTS (
     SELECT 1
     FROM project_session_threads_v98 link
     WHERE link.session_id = legacy.id
   );

INSERT INTO project_session_threads(session_id, thread_id, linked_at)
SELECT link.session_id, link.thread_id, link.linked_at
FROM project_session_threads_v98 link
JOIN project_sessions session ON session.id = link.session_id;

DROP TABLE project_session_threads_v98;
DROP TABLE project_sessions_v98;

CREATE INDEX idx_project_sessions_project_order
  ON project_sessions(project_id, "order", created_at);
CREATE INDEX idx_project_sessions_project_sidebar
  ON project_sessions(project_id, archived, pinned, pinned_order, "order");
CREATE UNIQUE INDEX idx_project_session_threads_thread
  ON project_session_threads(thread_id);
"#;

const V94_PROJECT_APPEARANCE_SCHEMA_SQL: &str = r#"
ALTER TABLE projects ADD COLUMN appearance_color TEXT NOT NULL DEFAULT 'black'
  CHECK (appearance_color IN ('black', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'));

ALTER TABLE projects ADD COLUMN appearance_marker_kind TEXT NOT NULL DEFAULT 'icon'
  CHECK (appearance_marker_kind IN ('icon', 'emoji'));

ALTER TABLE projects ADD COLUMN appearance_marker_value TEXT NOT NULL DEFAULT 'folder'
  CHECK (
    (
      appearance_marker_kind = 'icon'
      AND appearance_marker_value IN (
        'folder', 'currency-dollar', 'book', 'graduation-cap', 'edit', 'writing',
        'function', 'terminal', 'music', 'popcorn', 'customize', 'palette',
        'stethoscope', 'health', 'lotus', 'suitcase', 'bar-chart', 'kettlebell',
        'dumbbell', 'logs', 'scale', 'desk-globe', 'plane', 'globe', 'wrench',
        'paw', 'flask', 'brain', 'heart', 'plant'
      )
    )
    OR (
      appearance_marker_kind = 'emoji'
      AND length(trim(appearance_marker_value)) > 0
      AND length(CAST(appearance_marker_value AS BLOB)) <= 256
    )
  );
"#;

const V95_CANVAS_INCREMENTAL_STAGING_SCHEMA_SQL: &str = r#"
CREATE TABLE canvas_scenes_v95 (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  scene_hash_version INTEGER NOT NULL CHECK (scene_hash_version = 2),
  app_state_json TEXT NOT NULL DEFAULT '{}',
  app_state_hash TEXT NOT NULL,
  scene_hash TEXT NOT NULL,
  element_count INTEGER NOT NULL CHECK (element_count >= 0),
  tombstone_count INTEGER NOT NULL
    CHECK (tombstone_count BETWEEN 0 AND element_count),
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  element_json_bytes INTEGER NOT NULL CHECK (element_json_bytes >= 0),
  file_json_bytes INTEGER NOT NULL CHECK (file_json_bytes >= 0),
  scene_byte_length INTEGER NOT NULL
    CHECK (scene_byte_length BETWEEN 0 AND 16777216),
  updated_at TEXT NOT NULL,
  CHECK (json_valid(app_state_json) AND json_type(app_state_json) = 'object'),
  CHECK (length(app_state_hash) = 64 AND app_state_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(scene_hash) = 64 AND scene_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID;

CREATE TABLE canvas_scene_elements_v95 (
  document_id TEXT NOT NULL
    REFERENCES canvas_scenes_v95(document_id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  version_nonce INTEGER NOT NULL CHECK (version_nonce >= 0),
  order_key TEXT NOT NULL,
  is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0, 1)),
  element_json TEXT NOT NULL,
  element_hash TEXT NOT NULL,
  hash_bucket INTEGER NOT NULL CHECK (hash_bucket BETWEEN 0 AND 1023),
  referenced_file_id TEXT,
  plain_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (document_id, element_id),
  CHECK (length(element_id) BETWEEN 1 AND 512),
  CHECK (length(order_key) BETWEEN 1 AND 256),
  CHECK (json_valid(element_json) AND json_type(element_json) = 'object'),
  CHECK (length(element_hash) = 64 AND element_hash NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    (is_deleted = 0)
    OR (referenced_file_id IS NULL AND plain_text = '')
  ),
  CHECK (referenced_file_id IS NULL OR length(referenced_file_id) BETWEEN 1 AND 512)
) WITHOUT ROWID;

CREATE TABLE canvas_scene_files_v95 (
  document_id TEXT NOT NULL
    REFERENCES canvas_scenes_v95(document_id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  asset_uri TEXT NOT NULL,
  created_ms INTEGER CHECK (created_ms IS NULL OR created_ms >= 0),
  file_json TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  hash_bucket INTEGER NOT NULL CHECK (hash_bucket BETWEEN 0 AND 1023),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (document_id, file_id),
  CHECK (length(file_id) BETWEEN 1 AND 512),
  CHECK (length(mime_type) BETWEEN 1 AND 256),
  CHECK (length(asset_uri) BETWEEN 1 AND 4096),
  CHECK (json_valid(file_json) AND json_type(file_json) = 'object'),
  CHECK (length(file_hash) = 64 AND file_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID;

CREATE TABLE canvas_scene_hash_buckets_v95 (
  document_id TEXT NOT NULL
    REFERENCES canvas_scenes_v95(document_id) ON DELETE CASCADE,
  bucket_index INTEGER NOT NULL CHECK (bucket_index BETWEEN 0 AND 1023),
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  bucket_hash TEXT NOT NULL,
  PRIMARY KEY (document_id, bucket_index),
  CHECK (length(bucket_hash) = 64 AND bucket_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID;

CREATE TABLE canvas_scene_projection_heads_v95 (
  document_id TEXT PRIMARY KEY
    REFERENCES canvas_scenes_v95(document_id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  projected_head_seq INTEGER NOT NULL CHECK (projected_head_seq >= 0),
  projection_version INTEGER NOT NULL CHECK (projection_version = 2),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE canvas_scene_mutation_receipts_v95 (
  document_id TEXT NOT NULL
    REFERENCES canvas_scenes_v95(document_id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  mutation_id TEXT NOT NULL,
  base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
  committed_head_seq INTEGER NOT NULL CHECK (committed_head_seq >= 0),
  intent_hash TEXT NOT NULL,
  intent_byte_length INTEGER NOT NULL CHECK (intent_byte_length > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('committed', 'no_change')),
  committed_at TEXT NOT NULL,
  PRIMARY KEY (document_id, generation, mutation_id),
  UNIQUE (document_id, mutation_id),
  CHECK (length(mutation_id) BETWEEN 1 AND 512),
  CHECK (length(intent_hash) = 64 AND intent_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID;
"#;

const V96_CANVAS_TOMBSTONE_BYTES_SQL: &str = r#"
ALTER TABLE canvas_scenes
  ADD COLUMN tombstone_json_bytes INTEGER NOT NULL DEFAULT 0
  CHECK (
    tombstone_json_bytes >= 0
    AND tombstone_json_bytes <= element_json_bytes
  );

UPDATE canvas_scenes
SET tombstone_json_bytes = COALESCE((
  SELECT SUM(length(CAST(element.element_json AS BLOB)))
  FROM canvas_scene_elements element
  WHERE element.document_id = canvas_scenes.document_id
    AND element.is_deleted = 1
), 0);
"#;

const V98_YJS_INTEGRITY_SQL: &str = r#"
UPDATE documents
SET state_hash = ''
WHERE sync_engine = 'yjs';

DROP TABLE document_engine_fingerprints;

CREATE TRIGGER yjs_documents_require_empty_state_hash_insert
  BEFORE INSERT ON documents
  WHEN NEW.sync_engine = 'yjs' AND NEW.state_hash <> ''
  BEGIN
    SELECT RAISE(ABORT, 'Yjs Document cannot persist a full-state hash');
  END;

CREATE TRIGGER yjs_documents_require_empty_state_hash_update
  BEFORE UPDATE OF state_hash ON documents
  WHEN NEW.sync_engine = 'yjs' AND NEW.state_hash <> ''
  BEGIN
    SELECT RAISE(ABORT, 'Yjs Document cannot persist a full-state hash');
  END;
"#;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorePreparation {
    pub schema_version: i64,
    pub created_fresh: bool,
    pub migrated_from_version: Option<i64>,
    pub migration_backup_path: Option<PathBuf>,
    pub validated_yjs_documents: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorePreparationEvent {
    MigrationStarted { from_version: i64, to_version: i64 },
}

pub fn prepare_profile_store(
    connection: &mut Connection,
    profile_home: &Path,
) -> Result<StorePreparation, StoreError> {
    prepare_profile_store_with_observer(connection, profile_home, &mut |_| {})
}

pub fn prepare_profile_store_with_observer(
    connection: &mut Connection,
    profile_home: &Path,
    observer: &mut dyn FnMut(StorePreparationEvent),
) -> Result<StorePreparation, StoreError> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let object_count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if version == 0 && object_count == 0 {
        let now = unix_time_millis()?;
        create_fresh_store(connection, profile_home, now)?;
        validate_store(connection)?;
        validate_codex_thread_timestamp_invariants(connection)?;
        validate_canonical_text_timestamp_invariants(connection)?;
        validate_database_view_kind_invariants(connection)?;
        return Ok(StorePreparation {
            schema_version: CORE_SCHEMA_VERSION,
            created_fresh: true,
            migrated_from_version: None,
            migration_backup_path: None,
            validated_yjs_documents: 0,
        });
    }
    if !(MIN_SUPPORTED_SCHEMA_VERSION..=CORE_SCHEMA_VERSION).contains(&version) {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            format!(
                "Rust Core supports store versions {MIN_SUPPORTED_SCHEMA_VERSION} through {CORE_SCHEMA_VERSION}; received v{version}"
            ),
            false,
        ));
    }
    if version == CORE_SCHEMA_VERSION {
        validate_core_metadata(connection, CORE_SCHEMA_VERSION)?;
        validate_exact_current_schema(connection)?;
        validate_store(connection)?;
        validate_codex_thread_timestamp_invariants(connection)?;
        validate_canonical_text_timestamp_invariants(connection)?;
        validate_database_view_kind_invariants(connection)?;
        return Ok(StorePreparation {
            schema_version: CORE_SCHEMA_VERSION,
            created_fresh: false,
            migrated_from_version: None,
            migration_backup_path: None,
            validated_yjs_documents: 0,
        });
    }

    if (85..CORE_SCHEMA_VERSION).contains(&version) {
        return upgrade_owned_store(connection, profile_home, version, observer);
    }

    validate_store(connection)?;
    validate_exact_v84_schema(connection)?;
    let now = unix_time_millis()?;
    let source_version = version;
    if has_core_ownership_marker(connection)? {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Only unowned TypeScript v84 stores can cross the Rust Core import boundary",
            false,
        ));
    }
    observer(StorePreparationEvent::MigrationStarted {
        from_version: source_version,
        to_version: CORE_SCHEMA_VERSION,
    });
    let backup_path = create_migration_backup(connection, profile_home, now, source_version)?;
    let validated_yjs_documents = validate_live_yjs_documents(connection)?;
    let backup_name = backup_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::Internal,
                "Migration backup name is not valid UTF-8",
                false,
            )
        })?;
    publish_current_store(
        connection,
        profile_home,
        Some(source_version),
        Some(backup_name),
        now,
    )?;
    validate_store(connection)?;
    validate_core_metadata(connection, CORE_SCHEMA_VERSION)?;
    validate_codex_thread_timestamp_invariants(connection)?;
    validate_canonical_text_timestamp_invariants(connection)?;
    validate_database_view_kind_invariants(connection)?;
    Ok(StorePreparation {
        schema_version: CORE_SCHEMA_VERSION,
        created_fresh: false,
        migrated_from_version: Some(source_version),
        migration_backup_path: Some(backup_path),
        validated_yjs_documents,
    })
}

pub(crate) fn prepare_legacy_import_candidate(
    connection: &mut Connection,
    profile_home: &Path,
    source_version: i64,
    source_backup_path: &Path,
) -> Result<StorePreparation, StoreError> {
    validate_store(connection)?;
    validate_exact_v84_schema(connection)?;
    if has_core_ownership_marker(connection)? {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Legacy import candidate is already owned by Rust Core",
            false,
        ));
    }
    let backup_name = source_backup_path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::Internal,
                "Legacy migration backup name is not valid UTF-8",
                false,
            )
        })?;
    with_immediate_transaction(connection, |transaction| {
        rebuild_legacy_import_document_projections(transaction)
    })?;
    let validated_yjs_documents = validate_live_yjs_documents(connection)?;
    let now = unix_time_millis()?;
    publish_current_store(
        connection,
        profile_home,
        Some(TYPESCRIPT_SCHEMA_VERSION),
        Some(backup_name),
        now,
    )?;
    validate_store(connection)?;
    validate_core_metadata(connection, CORE_SCHEMA_VERSION)?;
    validate_exact_current_schema(connection)?;
    validate_codex_thread_timestamp_invariants(connection)?;
    validate_canonical_text_timestamp_invariants(connection)?;
    validate_database_view_kind_invariants(connection)?;
    Ok(StorePreparation {
        schema_version: CORE_SCHEMA_VERSION,
        created_fresh: false,
        migrated_from_version: Some(source_version),
        migration_backup_path: Some(source_backup_path.to_path_buf()),
        validated_yjs_documents,
    })
}

fn rebuild_legacy_import_document_projections(connection: &Connection) -> Result<(), StoreError> {
    let repository = DocumentReadRepository::new(connection);
    let heads = repository.live_yjs_heads()?;
    for head in heads {
        let reconstructed = reconstruct_live_yjs_document(&repository, &head)?;
        rebuild_legacy_import_projections(connection, &head.id, &reconstructed.materialization)?;
    }
    Ok(())
}

fn upgrade_owned_store(
    connection: &mut Connection,
    profile_home: &Path,
    source_version: i64,
    observer: &mut dyn FnMut(StorePreparationEvent),
) -> Result<StorePreparation, StoreError> {
    validate_store(connection)?;
    validate_core_metadata(connection, source_version)?;
    match source_version {
        85 => validate_exact_v85_schema(connection)?,
        86 => validate_exact_v86_schema(connection)?,
        87 => validate_exact_v87_schema(connection)?,
        88 => validate_exact_v88_schema(connection)?,
        89 => validate_exact_v89_schema(connection)?,
        90 => validate_exact_v90_schema(connection)?,
        91 => validate_exact_v91_schema(connection)?,
        92 => validate_exact_v92_schema(connection)?,
        93 => validate_exact_v93_schema(connection)?,
        94 => validate_exact_v94_schema(connection)?,
        95 => validate_exact_v95_schema(connection)?,
        96 => validate_exact_v96_schema(connection)?,
        97 => validate_exact_v97_schema(connection)?,
        98 => validate_exact_v98_schema(connection)?,
        _ => return Err(corrupt("Rust Core forward-migration source is unsupported")),
    }

    observer(StorePreparationEvent::MigrationStarted {
        from_version: source_version,
        to_version: CORE_SCHEMA_VERSION,
    });

    let now = unix_time_millis()?;
    let backup_path = create_migration_backup(connection, profile_home, now, source_version)?;
    let validated_yjs_documents = validate_live_yjs_documents(connection)?;
    with_immediate_transaction(connection, |transaction| {
        if source_version < 86 {
            ensure_v86_execution_profile_schema(transaction)?;
        }
        if source_version < 87 {
            ensure_v87_project_session_tabs_schema(transaction)?;
        }
        if source_version < 88 {
            ensure_v88_projection_impact_schema(transaction)?;
        }
        if source_version < 89 {
            repair_v89_codex_thread_timestamps(transaction)?;
        }
        if source_version < 90 {
            ensure_v90_window_owned_session_views_schema(transaction)?;
        }
        if source_version < 91 {
            ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
        }
        if source_version < 92 {
            ensure_v92_canonical_text_timestamps(transaction)?;
        }
        if source_version < 93 {
            ensure_v93_database_starter_sessions_schema(transaction)?;
        }
        if source_version < 94 {
            ensure_v94_project_appearance_schema(transaction)?;
        }
        if source_version < 95 {
            ensure_v95_canvas_incremental_schema(transaction)?;
        }
        if source_version < 96 {
            ensure_v96_canvas_tombstone_bytes_schema(transaction)?;
        }
        if source_version < 97 {
            ensure_v97_canvas_owners_schema(transaction)?;
        }
        if source_version < 98 {
            ensure_v98_yjs_integrity_schema(transaction)?;
        }
        if source_version < 99 {
            ensure_v99_owner_scoped_scenes_schema(transaction)?;
        }
        let updated = transaction.execute(
            "UPDATE core_store_metadata SET store_format_version = ?1 \
             WHERE id = 1 AND schema_owner = ?2 AND store_format_version = ?3",
            params![CORE_SCHEMA_VERSION, CORE_SCHEMA_OWNER, source_version],
        )?;
        if updated != 1 {
            return Err(corrupt(
                "Rust Core ownership marker changed during forward migration",
            ));
        }
        transaction.pragma_update(None, "user_version", CORE_SCHEMA_VERSION)?;
        Ok(())
    })?;

    validate_store(connection)?;
    validate_core_metadata(connection, CORE_SCHEMA_VERSION)?;
    validate_exact_current_schema(connection)?;
    validate_codex_thread_timestamp_invariants(connection)?;
    validate_canonical_text_timestamp_invariants(connection)?;
    validate_database_view_kind_invariants(connection)?;
    Ok(StorePreparation {
        schema_version: CORE_SCHEMA_VERSION,
        created_fresh: false,
        migrated_from_version: Some(source_version),
        migration_backup_path: Some(backup_path),
        validated_yjs_documents,
    })
}

fn create_migration_backup(
    connection: &Connection,
    profile_home: &Path,
    now: u64,
    source_version: i64,
) -> Result<PathBuf, StoreError> {
    let directory = profile_home.join("backups/core-migrations");
    fs::create_dir_all(&directory).map_err(io_error)?;
    if fs::symlink_metadata(&directory)
        .map_err(io_error)?
        .file_type()
        .is_symlink()
    {
        return Err(StoreError::new(
            StoreErrorCode::InvalidProfile,
            "Core migration backup directory must not be a symlink",
            false,
        ));
    }
    let backup_path = directory.join(format!(
        "v{source_version}-to-v{CORE_SCHEMA_VERSION}-{now}.db"
    ));
    if backup_path.exists() {
        return Err(StoreError::new(
            StoreErrorCode::Internal,
            "Core migration backup path already exists",
            false,
        ));
    }
    connection.backup(MAIN_DB, &backup_path, None)?;
    File::open(&backup_path)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;
    File::open(&directory)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;

    let backup = open_immutable_reader(&backup_path)?;
    let version: i64 = backup.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version != source_version {
        return Err(StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("Migration backup has unexpected schema v{version}"),
            false,
        ));
    }
    validate_store(&backup)?;
    Ok(backup_path)
}

fn validate_live_yjs_documents(connection: &Connection) -> Result<usize, StoreError> {
    let repository = DocumentReadRepository::new(connection);
    let heads = repository.live_yjs_heads()?;
    for head in &heads {
        validate_live_yjs_document(&repository, head)?;
    }
    Ok(heads.len())
}

pub(crate) fn validate_v85_restore_documents(connection: &Connection) -> Result<usize, StoreError> {
    validate_core_metadata(connection, CORE_SCHEMA_VERSION)?;
    validate_live_yjs_documents(connection)
}

fn validate_live_yjs_document(
    repository: &DocumentReadRepository<'_>,
    head: &DocumentHeadRow,
) -> Result<(), StoreError> {
    let reconstructed = reconstruct_live_yjs_document(repository, head)?;
    assert_persisted_materialization(repository, head, &reconstructed.materialization)
}

struct ReconstructedLiveYjsDocument {
    materialization: DocumentMaterialization,
}

fn reconstruct_live_yjs_document(
    repository: &DocumentReadRepository<'_>,
    head: &DocumentHeadRow,
) -> Result<ReconstructedLiveYjsDocument, StoreError> {
    let schema = registered_schema(&head.schema_key, head.schema_version)?;
    let snapshot = repository.latest_snapshot(&head.id, head.generation, head.head_seq)?;
    let document = create_compatible_document(&head.id);
    let snapshot_seq = if let Some(snapshot) = snapshot {
        verify_update_hash(
            &snapshot.snapshot_update,
            &snapshot.snapshot_hash,
            &head.id,
            "snapshot",
        )?;
        apply_update(&document, &snapshot.snapshot_update, &head.id, "snapshot")?;
        let expected = decode_state_vector_v1(&snapshot.state_vector)
            .map_err(|error| corrupt(format!("Document {} snapshot vector: {error}", head.id)))?;
        if document.transact().state_vector() != expected {
            return Err(corrupt(format!(
                "Document {} snapshot state vector does not match its update",
                head.id
            )));
        }
        snapshot.snapshot_seq
    } else {
        0
    };

    let updates =
        repository.updates_between(&head.id, head.generation, snapshot_seq, head.head_seq)?;
    let mut expected_seq = snapshot_seq + 1;
    for update in updates {
        if update.seq != expected_seq {
            return Err(corrupt(format!(
                "Document {} update tail is not contiguous at sequence {expected_seq}",
                head.id
            )));
        }
        verify_update_hash(&update.update_blob, &update.update_hash, &head.id, "update")?;
        apply_update(&document, &update.update_blob, &head.id, "update")?;
        expected_seq += 1;
    }
    if expected_seq - 1 != head.head_seq {
        return Err(corrupt(format!(
            "Document {} reconstruction ended at sequence {}, expected {}",
            head.id,
            expected_seq - 1,
            head.head_seq
        )));
    }
    let expected_vector = decode_state_vector_v1(&head.state_vector)
        .map_err(|error| corrupt(format!("Document {} state vector: {error}", head.id)))?;
    let transaction = document.transact();
    let actual_vector = transaction.state_vector();
    if actual_vector != expected_vector {
        return Err(corrupt(format!(
            "Document {} persisted state vector does not match reconstruction",
            head.id
        )));
    }
    let full_state_v1 = transaction.encode_state_as_update_v1(&StateVector::default());
    drop(transaction);
    if full_state_v1.len() > MAX_DOCUMENT_UPDATE_BYTES {
        return Err(corrupt(format!(
            "Document {} reconstructed state exceeds the Core bound",
            head.id
        )));
    }
    let decoded = decode_block_document(&document, schema)
        .map_err(|error| corrupt(format!("Document {} schema validation: {error}", head.id)))?;
    let materialization = materialize_decoded_document(&decoded)
        .map_err(|error| corrupt(format!("Document {} materialization: {error}", head.id)))?;
    Ok(ReconstructedLiveYjsDocument { materialization })
}

fn assert_persisted_materialization(
    repository: &DocumentReadRepository<'_>,
    head: &DocumentHeadRow,
    actual: &crate::document::DocumentMaterialization,
) -> Result<(), StoreError> {
    let persisted = repository
        .materialization(&head.id)?
        .ok_or_else(|| corrupt(format!("Document {} has no materialization", head.id)))?;
    let rich_title = serde_json::to_value(&actual.rich_title).map_err(internal_json)?;
    let block_tree = serde_json::to_value(&actual.block_tree).map_err(internal_json)?;
    let references = serde_json::to_value(&actual.references).map_err(internal_json)?;
    let asset_refs = serde_json::to_value(&actual.asset_refs).map_err(internal_json)?;
    let mismatched_fields = [
        (persisted.generation != head.generation, "generation"),
        (persisted.projected_seq != head.head_seq, "projected_seq"),
        (
            persisted.schema_version != i64::from(actual.schema_version),
            "schema_version",
        ),
        (persisted.title != actual.title, "title"),
        (persisted.rich_title != rich_title, "rich_title"),
        (persisted.nfm != actual.nfm, "nfm"),
        (persisted.plain_text != actual.plain_text, "plain_text"),
        (persisted.preview != actual.preview, "preview"),
        (persisted.block_tree != block_tree, "block_tree"),
        (persisted.references != references, "references"),
        (persisted.asset_refs != asset_refs, "asset_refs"),
    ]
    .into_iter()
    .filter_map(|(mismatched, field)| mismatched.then_some(field))
    .collect::<Vec<_>>();
    if mismatched_fields.is_empty() {
        return Ok(());
    }
    Err(corrupt(format!(
        "Document {} persisted materialization does not match Yrs reconstruction (fields: {})",
        head.id,
        mismatched_fields.join(", ")
    )))
}

fn publish_current_store(
    connection: &mut Connection,
    profile_home: &Path,
    migrated_from: Option<i64>,
    backup_name: Option<&str>,
    now: u64,
) -> Result<(), StoreError> {
    with_immediate_transaction(connection, |transaction| {
        transaction.execute_batch(V85_SCHEMA_SQL)?;
        transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
        ensure_automation_definition_revision(transaction)?;
        ensure_automation_run_revision(transaction)?;
        ensure_v86_execution_profile_schema(transaction)?;
        ensure_v87_project_session_tabs_schema(transaction)?;
        write_v85_metadata(transaction, migrated_from, backup_name, now)?;
        ensure_v88_projection_impact_schema(transaction)?;
        repair_v89_codex_thread_timestamps(transaction)?;
        ensure_v90_window_owned_session_views_schema(transaction)?;
        ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
        ensure_v92_canonical_text_timestamps(transaction)?;
        ensure_v93_database_starter_sessions_schema(transaction)?;
        ensure_v94_project_appearance_schema(transaction)?;
        ensure_v95_canvas_incremental_schema(transaction)?;
        ensure_v96_canvas_tombstone_bytes_schema(transaction)?;
        ensure_v97_canvas_owners_schema(transaction)?;
        ensure_v98_yjs_integrity_schema(transaction)?;
        ensure_v99_owner_scoped_scenes_schema(transaction)?;
        import_legacy_writable_roots(transaction, profile_home, now)?;
        import_automation_jitter_salt(transaction, profile_home, now)
    })
}

fn create_fresh_store(
    connection: &mut Connection,
    profile_home: &Path,
    now: u64,
) -> Result<(), StoreError> {
    with_immediate_transaction(connection, |transaction| {
        transaction.execute_batch(v84_schema_objects_sql())?;
        transaction.execute_batch(V85_SCHEMA_SQL)?;
        transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
        ensure_automation_definition_revision(transaction)?;
        ensure_automation_run_revision(transaction)?;
        ensure_v86_execution_profile_schema(transaction)?;
        ensure_v87_project_session_tabs_schema(transaction)?;
        write_v85_metadata(transaction, None, None, now)?;
        ensure_v88_projection_impact_schema(transaction)?;
        repair_v89_codex_thread_timestamps(transaction)?;
        ensure_v90_window_owned_session_views_schema(transaction)?;
        ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
        ensure_v92_canonical_text_timestamps(transaction)?;
        ensure_v93_database_starter_sessions_schema(transaction)?;
        ensure_v94_project_appearance_schema(transaction)?;
        ensure_v95_canvas_incremental_schema(transaction)?;
        ensure_v96_canvas_tombstone_bytes_schema(transaction)?;
        ensure_v97_canvas_owners_schema(transaction)?;
        ensure_v98_yjs_integrity_schema(transaction)?;
        ensure_v99_owner_scoped_scenes_schema(transaction)?;
        import_legacy_writable_roots(transaction, profile_home, now)?;
        import_automation_jitter_salt(transaction, profile_home, now)
    })
}

fn has_core_ownership_marker(connection: &Connection) -> Result<bool, StoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM sqlite_schema \
             WHERE type = 'table' AND name = 'core_store_metadata'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn ensure_v86_execution_profile_schema(connection: &Connection) -> Result<(), StoreError> {
    for column in ["model_id", "harness_id", "reasoning_effort", "service_tier"] {
        ensure_optional_text_column(connection, "codex_threads", column)?;
    }
    ensure_v86_automation_execution_profile_schema(connection)
}

fn ensure_v87_project_session_tabs_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V87_PROJECT_SESSION_TABS_SCHEMA_SQL)?;
    Ok(())
}

fn ensure_v88_projection_impact_schema(connection: &Connection) -> Result<(), StoreError> {
    let impact_column_count: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('change_log') \
         WHERE name = 'projection_impact_json'",
        [],
        |row| row.get(0),
    )?;
    if impact_column_count == 0 {
        connection
            .execute_batch("ALTER TABLE change_log ADD COLUMN projection_impact_json TEXT;")?;
    } else if impact_column_count != 1 {
        return Err(corrupt("Projection impact ledger column is ambiguous"));
    }

    let floor_column_count: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('core_store_metadata') \
         WHERE name = 'projection_event_v2_floor'",
        [],
        |row| row.get(0),
    )?;
    if floor_column_count == 0 {
        connection.execute_batch(
            "ALTER TABLE core_store_metadata \
             ADD COLUMN projection_event_v2_floor INTEGER;",
        )?;
        connection.execute(
            "UPDATE core_store_metadata SET projection_event_v2_floor = \
               (SELECT COALESCE(MAX(seq), 0) + 1 FROM change_log) \
             WHERE id = 1 AND projection_event_v2_floor IS NULL",
            [],
        )?;
    } else if floor_column_count != 1 {
        return Err(corrupt("Projection event replay-floor column is ambiguous"));
    }
    connection.execute(
        "UPDATE core_store_metadata SET projection_event_v2_floor = \
           (SELECT COALESCE(MAX(seq), 0) + 1 FROM change_log) \
         WHERE id = 1 AND projection_event_v2_floor IS NULL",
        [],
    )?;

    connection.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS validate_change_log_projection_impact_insert \
           BEFORE INSERT ON change_log \
           WHEN NEW.projection_impact_json IS NULL \
             OR NOT json_valid(NEW.projection_impact_json) \
             OR json_type(NEW.projection_impact_json) != 'object' \
           BEGIN \
             SELECT RAISE(ABORT, 'change_log projection impact is required'); \
           END; \
         CREATE TRIGGER IF NOT EXISTS prevent_change_log_projection_impact_update \
           BEFORE UPDATE OF projection_impact_json ON change_log \
           BEGIN \
             SELECT RAISE(ABORT, 'change_log projection impact is immutable'); \
           END;",
    )?;
    Ok(())
}

fn uuid_v7_timestamp_seconds_ms(thread_id: &str) -> Option<i64> {
    let bytes = thread_id.as_bytes();
    if bytes.len() != 36
        || bytes[8] != b'-'
        || bytes[13] != b'-'
        || bytes[18] != b'-'
        || bytes[23] != b'-'
        || bytes[14] != b'7'
        || !matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
    {
        return None;
    }
    if bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| !matches!(index, 8 | 13 | 18 | 23) && !byte.is_ascii_hexdigit())
    {
        return None;
    }

    let timestamp_hex = thread_id
        .chars()
        .filter(|character| *character != '-')
        .take(UUID_V7_UNIX_TIMESTAMP_HEX_DIGITS)
        .collect::<String>();
    let timestamp = i64::from_str_radix(&timestamp_hex, 16).ok()?;
    Some(timestamp - timestamp.rem_euclid(1_000))
}

fn repaired_codex_thread_created_at(thread_id: &str, created_at: i64, updated_at: i64) -> i64 {
    uuid_v7_timestamp_seconds_ms(thread_id)
        .unwrap_or(created_at)
        .min(updated_at)
}

fn repair_v89_codex_thread_timestamps(connection: &Connection) -> Result<(), StoreError> {
    let rows = connection
        .prepare("SELECT thread_id, created_at, updated_at FROM codex_threads ORDER BY thread_id")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut update = connection.prepare(
        "UPDATE codex_threads SET created_at = ?1 WHERE thread_id = ?2 AND created_at = ?3",
    )?;
    for (thread_id, created_at, updated_at) in rows {
        let repaired_created_at =
            repaired_codex_thread_created_at(&thread_id, created_at, updated_at);
        if repaired_created_at == created_at {
            continue;
        }
        let updated = update.execute(params![repaired_created_at, thread_id, created_at])?;
        if updated != 1 {
            return Err(corrupt(
                "Codex Thread timestamp changed during v89 migration",
            ));
        }
    }
    Ok(())
}

fn ensure_v90_window_owned_session_views_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V90_WINDOW_OWNED_SESSION_VIEWS_SCHEMA_SQL)?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v90 Project Session migration produced a foreign-key violation",
        ));
    }
    Ok(())
}

fn ensure_v91_workspace_sidebar_lanes_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V91_WORKSPACE_SIDEBAR_LANES_SCHEMA_SQL)?;
    migrate_legacy_workspace_sidebar_orders(connection)?;
    normalize_workspace_thread_previews(connection)?;
    connection.execute_batch(
        "DROP TABLE codex_project_thread_orders;
         DROP TABLE codex_sidebar_chat_order;",
    )?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v91 Workspace sidebar migration produced a foreign-key violation",
        ));
    }
    Ok(())
}

fn ensure_v93_database_starter_sessions_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V93_DATABASE_STARTER_SESSIONS_SCHEMA_SQL)?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v93 Project Session migration produced a foreign-key violation",
        ));
    }
    Ok(())
}

fn ensure_v94_project_appearance_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V94_PROJECT_APPEARANCE_SCHEMA_SQL)?;
    let legacy_icons = connection
        .prepare("SELECT id, icon FROM projects ORDER BY id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut update = connection.prepare(
        "UPDATE projects SET appearance_color = ?1, appearance_marker_kind = ?2, \
           appearance_marker_value = ?3 WHERE id = ?4",
    )?;
    for (project_id, icon) in legacy_icons {
        let appearance = legacy_project_appearance(&icon);
        let color = project_marker_color_literal(appearance.color);
        let (marker_kind, marker_value) = match appearance.marker {
            ProjectMarker::Icon { icon } => ("icon", project_marker_icon_literal(icon).to_owned()),
            ProjectMarker::Emoji { emoji } => ("emoji", emoji),
        };
        let changed = update.execute(params![color, marker_kind, marker_value, project_id])?;
        if changed != 1 {
            return Err(corrupt(
                "Project changed during the v94 appearance migration",
            ));
        }
    }
    drop(update);
    connection.execute_batch("ALTER TABLE projects DROP COLUMN icon;")?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v94 Project appearance migration produced a foreign-key violation",
        ));
    }
    Ok(())
}

fn ensure_v99_owner_scoped_scenes_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V99_OWNER_SCOPED_SCENES_SCHEMA_SQL)?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v99 Project Session migration produced a foreign-key violation",
        ));
    }
    Ok(())
}

fn ensure_v95_canvas_incremental_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V95_CANVAS_INCREMENTAL_STAGING_SCHEMA_SQL)?;
    let document_ids = connection
        .prepare("SELECT document_id FROM canvas_scenes ORDER BY document_id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for document_id in &document_ids {
        migrate_v95_canvas_scene(connection, document_id)?;
    }
    migrate_v95_canvas_receipts(connection)?;
    connection.execute(
        "UPDATE documents SET state_hash = (\
           SELECT scene.scene_hash FROM canvas_scenes_v95 scene \
           WHERE scene.document_id = documents.id\
         ) WHERE sync_engine = 'canvas_scene'",
        [],
    )?;
    connection.execute_batch(
        "PRAGMA defer_foreign_keys = ON;
         DROP INDEX idx_canvas_scene_elements_order;
         DROP INDEX idx_canvas_scene_mutation_receipts_head;
         DROP TRIGGER canvas_scene_mutation_receipts_immutable_update;
         DROP TRIGGER canvas_scene_mutation_receipts_validate_result_hash_insert;
         DROP TRIGGER canvas_scenes_require_scene_engine;

         ALTER TABLE canvas_scenes RENAME TO canvas_scenes_v94;
         ALTER TABLE canvas_scene_elements RENAME TO canvas_scene_elements_v94;
         ALTER TABLE canvas_scene_files RENAME TO canvas_scene_files_v94;
         ALTER TABLE canvas_scene_mutation_receipts RENAME TO canvas_scene_mutation_receipts_v94;

         ALTER TABLE canvas_scenes_v95 RENAME TO canvas_scenes;
         ALTER TABLE canvas_scene_elements_v95 RENAME TO canvas_scene_elements;
         ALTER TABLE canvas_scene_files_v95 RENAME TO canvas_scene_files;
         ALTER TABLE canvas_scene_hash_buckets_v95 RENAME TO canvas_scene_hash_buckets;
         ALTER TABLE canvas_scene_projection_heads_v95 RENAME TO canvas_scene_projection_heads;
         ALTER TABLE canvas_scene_mutation_receipts_v95 RENAME TO canvas_scene_mutation_receipts;

         DROP TABLE canvas_scene_mutation_receipts_v94;
         DROP TABLE canvas_scene_elements_v94;
         DROP TABLE canvas_scene_files_v94;
         DROP TABLE canvas_scenes_v94;

         CREATE INDEX idx_canvas_scene_elements_order
           ON canvas_scene_elements(document_id, order_key, element_id);
         CREATE INDEX idx_canvas_scene_elements_bucket
           ON canvas_scene_elements(document_id, hash_bucket, element_id);
         CREATE INDEX idx_canvas_scene_elements_file_reference
           ON canvas_scene_elements(document_id, referenced_file_id)
           WHERE referenced_file_id IS NOT NULL AND is_deleted = 0;
         CREATE INDEX idx_canvas_scene_files_bucket
           ON canvas_scene_files(document_id, hash_bucket, file_id);
         CREATE INDEX idx_canvas_scene_mutation_receipts_head
           ON canvas_scene_mutation_receipts(document_id, generation, committed_head_seq);

         CREATE TRIGGER canvas_scene_mutation_receipts_immutable_update
           BEFORE UPDATE ON canvas_scene_mutation_receipts
           BEGIN
             SELECT RAISE(ABORT, 'Canvas scene mutation receipts are immutable');
           END;
         CREATE TRIGGER canvas_scene_mutation_receipts_immutable_delete
           BEFORE DELETE ON canvas_scene_mutation_receipts
           BEGIN
             SELECT RAISE(ABORT, 'Canvas scene mutation receipts are immutable');
           END;
         CREATE TRIGGER canvas_scenes_require_scene_engine
           BEFORE INSERT ON canvas_scenes
           WHEN COALESCE((
             SELECT sync_engine FROM documents WHERE id = NEW.document_id
           ), '') <> 'canvas_scene'
           BEGIN
             SELECT RAISE(ABORT, 'Canvas scene authority requires canvas_scene sync engine');
           END;",
    )?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v95 Canvas incremental migration produced a foreign-key violation",
        ));
    }
    Ok(())
}

fn ensure_v96_canvas_tombstone_bytes_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V96_CANVAS_TOMBSTONE_BYTES_SQL)?;
    Ok(())
}

fn ensure_v97_canvas_owners_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V97_CANVAS_OWNERS_SQL)?;
    connection.execute(
        "UPDATE database_views SET kind = 'list' WHERE kind = 'canvas'",
        [],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO canvas_owners(block_id, library_id, created_at, updated_at) \
         SELECT block.id, project.library_id, block.created_at, block.updated_at \
         FROM blocks block JOIN projects project ON project.id = block.project_id \
         JOIN block_documents ownership ON ownership.block_id = block.id \
         JOIN documents document ON document.id = ownership.document_id \
         WHERE block.type = 'canvas' AND document.sync_engine = 'canvas_scene'",
        [],
    )?;
    Ok(())
}

fn ensure_v98_yjs_integrity_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V98_YJS_INTEGRITY_SQL)?;
    Ok(())
}

fn validate_database_view_kind_invariants(connection: &Connection) -> Result<(), StoreError> {
    let unsupported: i64 = connection.query_row(
        "SELECT count(*) FROM database_views \
         WHERE kind NOT IN ('kanban', 'list', 'calendar')",
        [],
        |row| row.get(0),
    )?;
    if unsupported == 0 {
        return Ok(());
    }
    Err(corrupt(
        "Database View authority contains a retired presentation kind",
    ))
}

fn migrate_v95_canvas_scene(connection: &Connection, document_id: &str) -> Result<(), StoreError> {
    let authority = read_document_authority(connection, document_id)?
        .ok_or_else(|| corrupt("v94 Canvas scene is missing its Document authority"))?;
    let loaded = load_v94_canvas_scene(connection, &authority)?;
    validate_v94_canvas_projections(connection, &authority, &loaded.scene)?;
    let metadata = compute_canvas_scene_incremental_metadata(&loaded.scene)?;
    connection.execute(
        "INSERT INTO canvas_scenes_v95 (\
           document_id, generation, head_seq, schema_version, scene_hash_version, \
           app_state_json, app_state_hash, scene_hash, element_count, tombstone_count, \
           file_count, element_json_bytes, file_json_bytes, scene_byte_length, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            document_id,
            authority.head.generation,
            authority.head.head_seq,
            authority.head.schema_version,
            CANVAS_SCENE_HASH_VERSION,
            metadata.app_state_json,
            metadata.app_state_hash,
            metadata.scene_hash,
            metadata.counters.element_count,
            metadata.counters.tombstone_count,
            metadata.counters.file_count,
            metadata.counters.element_json_bytes,
            metadata.counters.file_json_bytes,
            metadata.counters.scene_byte_length,
            loaded.updated_at,
        ],
    )?;
    for element in &loaded.scene.elements {
        let element_json = serde_json::to_string(&element.value)
            .map_err(|_| corrupt("v94 Canvas element JSON cannot be canonicalized"))?;
        let derived = derive_canvas_element(element)?;
        connection.execute(
            "INSERT INTO canvas_scene_elements_v95 (\
               document_id, element_id, version, version_nonce, order_key, is_deleted, \
               element_json, element_hash, hash_bucket, referenced_file_id, plain_text, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                document_id,
                element.id,
                element.version,
                element.version_nonce,
                element.order_key,
                i64::from(element.is_deleted),
                element_json,
                sha256(element_json.as_bytes()),
                i64::from(canvas_hash_bucket(CanvasHashItemKind::Element, &element.id)),
                derived.referenced_file_id,
                derived.plain_text,
                loaded.updated_at,
            ],
        )?;
    }
    for (file_id, file) in &loaded.scene.files {
        let file_json = serde_json::to_string(&file.value)
            .map_err(|_| corrupt("v94 Canvas file JSON cannot be canonicalized"))?;
        connection.execute(
            "INSERT INTO canvas_scene_files_v95 (\
               document_id, file_id, mime_type, asset_uri, created_ms, file_json, file_hash, \
               hash_bucket, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                document_id,
                file_id,
                file.mime_type,
                file.source,
                file.created_ms,
                file_json,
                sha256(file_json.as_bytes()),
                i64::from(canvas_hash_bucket(CanvasHashItemKind::File, file_id)),
                loaded.updated_at,
            ],
        )?;
    }
    for (bucket_index, bucket) in &metadata.hash_buckets {
        connection.execute(
            "INSERT INTO canvas_scene_hash_buckets_v95 (\
               document_id, bucket_index, item_count, bucket_hash\
             ) VALUES (?1, ?2, ?3, ?4)",
            params![
                document_id,
                i64::from(*bucket_index),
                bucket.item_count,
                bucket.bucket_hash
            ],
        )?;
    }
    connection.execute(
        "INSERT INTO canvas_scene_projection_heads_v95 (\
           document_id, generation, projected_head_seq, projection_version, updated_at\
         ) VALUES (?1, ?2, ?3, 2, ?4)",
        params![
            document_id,
            authority.head.generation,
            authority.head.head_seq,
            loaded.updated_at
        ],
    )?;
    Ok(())
}

fn migrate_v95_canvas_receipts(connection: &Connection) -> Result<(), StoreError> {
    type LegacyCanvasReceipt = (
        String,
        i64,
        String,
        i64,
        i64,
        String,
        i64,
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        String,
    );
    let legacy_count: i64 = connection.query_row(
        "SELECT count(*) FROM canvas_scene_mutation_receipts",
        [],
        |row| row.get(0),
    )?;
    let rows = connection
        .prepare(
            "SELECT canvas.document_id, canvas.generation, canvas.mutation_id, \
                    canvas.base_head_seq, canvas.committed_head_seq, canvas.request_hash, \
                    canvas.request_byte_length, canvas.request_json, canvas.result_json, \
                    canvas.result_hash, canvas.outcome, canvas.committed_at, \
                    common.profile_id, common.project_id, common.store_epoch, \
                    common.request_hash, common.result_json, common.operation_kind \
             FROM canvas_scene_mutation_receipts canvas \
             JOIN core_module_receipts common \
               ON common.module_name = 'owned_document' \
              AND common.operation_id = canvas.mutation_id \
             ORDER BY canvas.document_id, canvas.generation, canvas.mutation_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
                row.get(10)?,
                row.get(11)?,
                row.get(12)?,
                row.get(13)?,
                row.get(14)?,
                row.get(15)?,
                row.get(16)?,
                row.get(17)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<LegacyCanvasReceipt>>>()?;
    if i64::try_from(rows.len()).ok() != Some(legacy_count) {
        return Err(corrupt(
            "v94 Canvas receipt is missing its trusted Module receipt",
        ));
    }
    for row in rows {
        if !is_sha256(&row.5)
            || row.5 != sha256(row.7.as_bytes())
            || i64::try_from(row.7.len()).ok() != Some(row.6)
            || !is_sha256(&row.9)
            || row.9 != sha256(row.8.as_bytes())
            || !is_sha256(&row.15)
        {
            return Err(corrupt("v94 Canvas receipt hash evidence is invalid"));
        }
        let request = serde_json::from_str::<serde_json::Value>(&row.7)
            .map_err(|_| corrupt("v94 Canvas receipt request JSON is invalid"))?;
        let request = request
            .as_object()
            .ok_or_else(|| corrupt("v94 Canvas receipt request must be an object"))?;
        let mutation = serde_json::json!({
            "elementCandidates": request.get("elementCandidates")
                .ok_or_else(|| corrupt("v94 Canvas receipt is missing elementCandidates"))?,
            "appStateIntents": request.get("appStateIntents")
                .ok_or_else(|| corrupt("v94 Canvas receipt is missing appStateIntents"))?,
            "fileAdditions": request.get("fileAdditions")
                .ok_or_else(|| corrupt("v94 Canvas receipt is missing fileAdditions"))?,
        });
        let request_project_id = request.get("projectId").and_then(serde_json::Value::as_str);
        if request_project_id != row.13.as_deref()
            || request
                .get("documentId")
                .and_then(serde_json::Value::as_str)
                != Some(row.0.as_str())
            || request
                .get("storeEpoch")
                .and_then(serde_json::Value::as_str)
                != Some(row.14.as_str())
            || request
                .get("generation")
                .and_then(serde_json::Value::as_i64)
                != Some(row.1)
            || request
                .get("baseHeadSeq")
                .and_then(serde_json::Value::as_i64)
                != Some(row.3)
        {
            return Err(corrupt(
                "v94 Canvas receipt coordinates diverge from its Module receipt",
            ));
        }
        let common_result = serde_json::from_str::<serde_json::Value>(&row.16)
            .map_err(|_| corrupt("v94 Canvas Module result JSON is invalid"))?;
        let canvas_result = serde_json::from_str::<serde_json::Value>(&row.8)
            .map_err(|_| corrupt("v94 Canvas private result JSON is invalid"))?;
        if common_result.pointer("/value/canvas") != Some(&canvas_result) {
            return Err(corrupt(
                "v94 Canvas private result diverges from its Module receipt",
            ));
        }
        let library_id = connection
            .query_row(
                "SELECT id FROM libraries WHERE profile_id = ?1",
                [&row.12],
                |library| library.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| corrupt("v94 Canvas receipt profile has no Library"))?;
        let intent_hash = if row.17 == "apply_canvas_mutation" {
            sha256(&canvas_semantic_intent_fingerprint(
                &row.12,
                &library_id,
                row.13.as_deref(),
                &row.14,
                &row.0,
                row.1,
                row.3,
                &row.2,
                &mutation,
            )?)
        } else {
            row.15.clone()
        };
        let intent_json = serde_json::to_string(&mutation)
            .map_err(|_| corrupt("v94 Canvas intent cannot be canonicalized"))?;
        connection.execute(
            "INSERT INTO canvas_scene_mutation_receipts_v95 (\
               document_id, generation, mutation_id, base_head_seq, committed_head_seq, \
               intent_hash, intent_byte_length, outcome, committed_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                row.0,
                row.1,
                row.2,
                row.3,
                row.4,
                intent_hash,
                i64::try_from(intent_json.len())
                    .map_err(|_| corrupt("v94 Canvas intent length overflowed"))?,
                row.10,
                row.11,
            ],
        )?;
        if row.17 == "apply_canvas_mutation" {
            let changed = connection.execute(
                "UPDATE core_module_receipts SET request_hash = ?1 \
                 WHERE module_name = 'owned_document' AND operation_id = ?2 \
                   AND request_hash = ?3",
                params![intent_hash, row.2, row.15],
            )?;
            if changed != 1 {
                return Err(corrupt(
                    "v94 Canvas Module receipt changed during semantic migration",
                ));
            }
        }
    }
    Ok(())
}

fn validate_v94_canvas_projections(
    connection: &Connection,
    authority: &crate::document::DocumentAuthorityRow,
    scene: &CanvasScene,
) -> Result<(), StoreError> {
    let mut expected_references = scene
        .page_references
        .iter()
        .map(|reference| {
            (
                reference.source_element_id.clone(),
                reference.target_block_id.clone(),
                reference.title_hint.clone(),
            )
        })
        .collect::<Vec<_>>();
    expected_references.sort();
    let actual_references = connection
        .prepare(
            "SELECT source_element_id, target_block_id, title_hint \
             FROM canvas_page_references \
             WHERE document_id = ?1 AND owner_block_id = ?2 AND project_id = ?3 \
               AND document_generation = ?4 AND projected_seq = ?5 \
             ORDER BY source_element_id",
        )?
        .query_map(
            params![
                authority.head.id,
                authority.owner_block_id,
                authority.head.project_id,
                authority.head.generation,
                authority.head.head_seq
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if actual_references != expected_references {
        return Err(corrupt(
            "v94 Canvas Page-reference projection diverges from authority",
        ));
    }
    let expected_files = scene
        .files
        .values()
        .map(|file| {
            (
                file.id.clone(),
                file.mime_type.clone(),
                file.source.clone(),
                file.managed_file_name.clone(),
            )
        })
        .collect::<Vec<_>>();
    let actual_files = connection
        .prepare(
            "SELECT file_id, mime_type, asset_uri, managed_file_name \
             FROM canvas_scene_file_refs \
             WHERE document_id = ?1 AND owner_block_id = ?2 AND project_id = ?3 \
               AND document_generation = ?4 AND projected_seq = ?5 \
             ORDER BY file_id",
        )?
        .query_map(
            params![
                authority.head.id,
                authority.owner_block_id,
                authority.head.project_id,
                authority.head.generation,
                authority.head.head_seq
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if actual_files != expected_files {
        return Err(corrupt(
            "v94 Canvas managed-file projection diverges from authority",
        ));
    }
    let search_marker = connection
        .query_row(
            "SELECT text FROM block_search_units \
             WHERE document_id = ?1 AND owner_block_id = ?2 AND project_id = ?3 \
               AND document_generation = ?4 AND projected_seq = ?5 \
               AND source_revision IS NULL AND source_kind = 'document_marker'",
            params![
                authority.head.id,
                authority.owner_block_id,
                authority.head.project_id,
                authority.head.generation,
                authority.head.head_seq
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if search_marker.as_deref() != Some(scene.plain_text.as_str()) {
        return Err(corrupt(
            "v94 Canvas search projection diverges from authority",
        ));
    }
    Ok(())
}

fn canonical_utc_timestamp(value: &str) -> Result<String, StoreError> {
    if let Ok(timestamp) = DateTime::parse_from_rfc3339(value) {
        return Ok(timestamp
            .with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Millis, true));
    }
    for format in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(timestamp) = NaiveDateTime::parse_from_str(value, format) {
            return Ok(timestamp
                .and_utc()
                .to_rfc3339_opts(SecondsFormat::Millis, true));
        }
    }
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        && let Some(timestamp) = date.and_hms_opt(0, 0, 0)
    {
        return Ok(timestamp
            .and_utc()
            .to_rfc3339_opts(SecondsFormat::Millis, true));
    }
    Err(corrupt("Store contains a non-parseable protocol timestamp"))
}

fn canonical_text_timestamp_columns(
    connection: &Connection,
) -> Result<Vec<(String, String)>, StoreError> {
    connection
        .prepare(
            "SELECT schema.name, column.name
             FROM sqlite_schema AS schema
             JOIN pragma_table_info(schema.name) AS column
             WHERE schema.type = 'table'
               AND schema.name NOT LIKE 'sqlite_%'
               AND lower(column.type) = 'text'
               AND column.name GLOB '*_at'
             ORDER BY schema.name, column.cid",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

fn quote_sql_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn ensure_v92_canonical_text_timestamps(connection: &Connection) -> Result<(), StoreError> {
    let mut columns_by_table = BTreeMap::<String, Vec<String>>::new();
    for (table, column) in canonical_text_timestamp_columns(connection)? {
        columns_by_table.entry(table).or_default().push(column);
    }
    for (table, columns) in columns_by_table {
        let table_identifier = quote_sql_identifier(&table);
        let triggers = connection
            .prepare(
                "SELECT name, sql FROM sqlite_schema
                 WHERE type = 'trigger' AND tbl_name = ?1 AND sql IS NOT NULL
                 ORDER BY name",
            )?
            .query_map([&table], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (name, _) in &triggers {
            connection.execute_batch(&format!("DROP TRIGGER {}", quote_sql_identifier(name)))?;
        }
        for column in columns {
            let column_identifier = quote_sql_identifier(&column);
            let select = format!(
                "SELECT DISTINCT {column_identifier} FROM {table_identifier}
                 WHERE {column_identifier} IS NOT NULL ORDER BY {column_identifier}"
            );
            let values = connection
                .prepare(&select)?
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let update = format!(
                "UPDATE {table_identifier} SET {column_identifier} = ?1
                 WHERE {column_identifier} = ?2"
            );
            for value in values {
                let canonical = canonical_utc_timestamp(&value).map_err(|_| {
                    corrupt(format!(
                        "Store contains a non-parseable protocol timestamp in {table}.{column}"
                    ))
                })?;
                if canonical == value {
                    continue;
                }
                connection.execute(&update, params![canonical, value])?;
            }
        }
        for (_, sql) in triggers {
            connection.execute_batch(&sql)?;
        }
    }
    validate_canonical_text_timestamp_invariants(connection)
}

fn validate_canonical_text_timestamp_invariants(connection: &Connection) -> Result<(), StoreError> {
    for (table, column) in canonical_text_timestamp_columns(connection)? {
        let table_identifier = quote_sql_identifier(&table);
        let column_identifier = quote_sql_identifier(&column);
        let query = format!(
            "SELECT {column_identifier} FROM {table_identifier}
             WHERE {column_identifier} IS NOT NULL ORDER BY {column_identifier}"
        );
        let values = connection
            .prepare(&query)?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for value in values {
            if canonical_utc_timestamp(&value).is_ok_and(|canonical| canonical == value) {
                continue;
            }
            return Err(corrupt(format!(
                "Store protocol timestamp invariant failed for {table}.{column}"
            )));
        }
    }
    Ok(())
}

fn migrate_legacy_workspace_sidebar_orders(connection: &Connection) -> Result<(), StoreError> {
    let project_orders = connection
        .prepare(
            "SELECT project_id, ordered_thread_ids_json, updated_at
             FROM codex_project_thread_orders ORDER BY project_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (project_id, raw_order, updated_at) in project_orders {
        let scope_key = format!("project:{project_id}");
        let order = decode_legacy_sidebar_order(&raw_order)?;
        write_migrated_sidebar_lane(
            connection,
            &scope_key,
            "project",
            Some(&project_id),
            &order,
            &updated_at,
        )?;
    }

    let projectless_order = connection
        .query_row(
            "SELECT ordered_thread_ids_json, updated_at
             FROM codex_sidebar_chat_order WHERE singleton = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((raw_order, updated_at)) = projectless_order {
        let order = decode_legacy_sidebar_order(&raw_order)?;
        write_migrated_sidebar_lane(
            connection,
            "projectless",
            "projectless",
            None,
            &order,
            &updated_at,
        )?;
    }
    Ok(())
}

fn decode_legacy_sidebar_order(raw: &str) -> Result<Vec<String>, StoreError> {
    let values = serde_json::from_str::<Vec<String>>(raw)
        .map_err(|_| corrupt("Legacy Workspace sidebar order is invalid"))?;
    let mut seen = std::collections::HashSet::new();
    if values.len() > 100_000
        || values.iter().any(|value| {
            value.is_empty()
                || value.trim() != value
                || value.len() > 512
                || !seen.insert(value.as_str())
        })
    {
        return Err(corrupt("Legacy Workspace sidebar order is invalid"));
    }
    Ok(values)
}

fn write_migrated_sidebar_lane(
    connection: &Connection,
    scope_key: &str,
    lane_kind: &str,
    project_id: Option<&str>,
    order: &[String],
    updated_at: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO workspace_sidebar_lanes(
           scope_key, lane_kind, project_id, order_mode, revision, updated_at
         ) VALUES (?1, ?2, ?3, 'manual', 1, ?4)",
        params![scope_key, lane_kind, project_id, updated_at],
    )?;
    let mut validate = connection.prepare(
        "SELECT count(*)
         FROM codex_threads thread
         LEFT JOIN codex_pinned_threads pinned ON pinned.thread_id = thread.thread_id
         WHERE thread.thread_id = ?1
           AND ((?2 IS NULL AND thread.project_id IS NULL) OR thread.project_id = ?2)
           AND pinned.thread_id IS NULL",
    )?;
    let mut insert = connection.prepare(
        "INSERT INTO workspace_sidebar_positions(
           scope_key, thread_id, rank_key, revision, updated_at
         ) VALUES (?1, ?2, ?3, 1, ?4)",
    )?;
    for (index, thread_id) in order.iter().enumerate() {
        let matches_lane =
            validate.query_row(params![thread_id, project_id], |row| row.get::<_, i64>(0))?;
        if matches_lane != 1 {
            return Err(corrupt(
                "Legacy Workspace sidebar order contains a Thread outside its lane",
            ));
        }
        let rank = i64::try_from(index + 1)
            .ok()
            .and_then(|value| value.checked_mul(1_000_000))
            .ok_or_else(|| corrupt("Legacy Workspace sidebar order rank overflowed"))?;
        insert.execute(params![scope_key, thread_id, rank, updated_at])?;
    }
    Ok(())
}

fn normalize_workspace_thread_previews(connection: &Connection) -> Result<(), StoreError> {
    let previews = connection
        .prepare("SELECT thread_id, thread_preview FROM codex_threads ORDER BY thread_id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut update =
        connection.prepare("UPDATE codex_threads SET thread_preview = ?1 WHERE thread_id = ?2")?;
    for (thread_id, preview) in previews {
        let normalized = bounded_workspace_preview(&preview);
        if normalized == preview {
            continue;
        }
        update.execute(params![normalized, thread_id])?;
    }
    Ok(())
}

fn bounded_workspace_preview(value: &str) -> String {
    let mut utf16 = 0;
    let mut bytes = 0;
    value
        .chars()
        .take_while(|character| {
            let next_utf16 = utf16 + character.len_utf16();
            let next_bytes = bytes + character.len_utf8();
            if next_utf16 > 240 || next_bytes > 1_024 {
                return false;
            }
            utf16 = next_utf16;
            bytes = next_bytes;
            true
        })
        .collect()
}

/// Validates the durable Thread clock at startup and store-copy boundaries.
pub(crate) fn validate_codex_thread_timestamp_invariants(
    connection: &Connection,
) -> Result<(), StoreError> {
    let invalid_thread_id = connection
        .query_row(
            "SELECT thread_id FROM codex_threads WHERE updated_at < created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if invalid_thread_id.is_none() {
        return Ok(());
    }
    Err(corrupt(
        "Codex Thread update time precedes creation in the current Store",
    ))
}

fn ensure_optional_text_column(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<(), StoreError> {
    let count: i64 = connection.query_row(
        &format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
        [column],
        |row| row.get(0),
    )?;
    if count == 1 {
        return Ok(());
    }
    if count != 0 {
        return Err(corrupt(format!("{table}.{column} schema is ambiguous")));
    }
    connection.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} TEXT"), [])?;
    Ok(())
}

fn ensure_v86_automation_execution_profile_schema(
    connection: &Connection,
) -> Result<(), StoreError> {
    let expected_columns = ["model_provider", "harness_id", "service_tier"];
    let present = expected_columns
        .iter()
        .map(|column| {
            connection.query_row(
                "SELECT count(*) FROM pragma_table_info('codex_scheduled_automations') \
                 WHERE name = ?1",
                [column],
                |row| row.get::<_, i64>(0),
            )
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if present.iter().all(|count| *count == 1) {
        return Ok(());
    }
    if present.iter().any(|count| *count != 0) {
        return Err(corrupt(
            "Scheduled Automation execution profile schema is ambiguous",
        ));
    }

    connection.execute_batch(
        "CREATE TEMP TABLE v86_automation_leases AS
           SELECT * FROM core_automation_leases;
         DROP INDEX IF EXISTS idx_codex_scheduled_automations_active_heartbeat;
         CREATE TABLE codex_scheduled_automations_v86 (
           automation_id TEXT PRIMARY KEY,
           kind TEXT NOT NULL,
           status TEXT NOT NULL,
           target_thread_id TEXT,
           name TEXT NOT NULL,
           prompt TEXT NOT NULL DEFAULT '',
           rrule TEXT,
           model TEXT,
           model_provider TEXT,
           harness_id TEXT,
           reasoning_effort TEXT,
           service_tier TEXT,
           cwds_json TEXT NOT NULL DEFAULT '[]',
           execution_environment TEXT NOT NULL DEFAULT 'worktree',
           local_environment_config_path TEXT,
           next_run_at INTEGER,
           last_run_at INTEGER,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           definition_revision INTEGER NOT NULL DEFAULT 1 CHECK (definition_revision >= 1),
           CHECK (kind IN ('cron', 'heartbeat')),
           CHECK (status IN ('ACTIVE', 'PAUSED', 'DELETED')),
           CHECK (execution_environment IN ('local', 'worktree')),
           CHECK (model_provider IS NULL OR length(trim(model_provider)) BETWEEN 1 AND 512),
           CHECK (model IS NULL OR length(trim(model)) BETWEEN 1 AND 512),
           CHECK (harness_id IS NULL OR length(trim(harness_id)) BETWEEN 1 AND 512),
           CHECK (reasoning_effort IS NULL OR length(trim(reasoning_effort)) BETWEEN 1 AND 64),
           CHECK (service_tier IS NULL OR length(trim(service_tier)) BETWEEN 1 AND 64)
         ) WITHOUT ROWID;
         INSERT INTO codex_scheduled_automations_v86 (
           automation_id, kind, status, target_thread_id, name, prompt, rrule, model,
           model_provider, harness_id, reasoning_effort, service_tier, cwds_json,
           execution_environment, local_environment_config_path, next_run_at, last_run_at,
           created_at, updated_at, definition_revision
         ) SELECT
           automation_id, kind, status, target_thread_id, name, prompt, rrule, model,
           NULL, NULL, reasoning_effort, NULL, cwds_json, execution_environment,
           local_environment_config_path, next_run_at, last_run_at, created_at, updated_at,
           definition_revision
         FROM codex_scheduled_automations;
         DROP TABLE codex_scheduled_automations;
         ALTER TABLE codex_scheduled_automations_v86 RENAME TO codex_scheduled_automations;
         INSERT INTO core_automation_leases
           SELECT * FROM v86_automation_leases;
         DROP TABLE v86_automation_leases;
         CREATE UNIQUE INDEX idx_codex_scheduled_automations_active_heartbeat
           ON codex_scheduled_automations(target_thread_id)
           WHERE kind = 'heartbeat' AND status = 'ACTIVE' AND target_thread_id IS NOT NULL;",
    )?;
    Ok(())
}

fn ensure_automation_definition_revision(connection: &Connection) -> Result<(), StoreError> {
    let revision_column: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('codex_scheduled_automations') \
         WHERE name = 'definition_revision'",
        [],
        |row| row.get(0),
    )?;
    if revision_column == 1 {
        return Ok(());
    }
    if revision_column != 0 {
        return Err(corrupt(
            "Scheduled Automation definition revision schema is ambiguous",
        ));
    }
    connection.execute(
        "ALTER TABLE codex_scheduled_automations \
         ADD COLUMN definition_revision INTEGER NOT NULL DEFAULT 1 \
         CHECK (definition_revision >= 1)",
        [],
    )?;
    Ok(())
}

fn ensure_automation_run_revision(connection: &Connection) -> Result<(), StoreError> {
    let revision_column: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('codex_automation_runs') \
         WHERE name = 'run_revision'",
        [],
        |row| row.get(0),
    )?;
    if revision_column == 1 {
        return Ok(());
    }
    if revision_column != 0 {
        return Err(corrupt("Automation run revision schema is ambiguous"));
    }
    connection.execute(
        "ALTER TABLE codex_automation_runs \
         ADD COLUMN run_revision INTEGER NOT NULL DEFAULT 1 \
         CHECK (run_revision >= 1)",
        [],
    )?;
    Ok(())
}

fn import_automation_jitter_salt(
    connection: &Connection,
    profile_home: &Path,
    now: u64,
) -> Result<(), StoreError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM core_automation_runtime_metadata WHERE id = 1",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        return Ok(());
    }

    let salt = read_legacy_automation_jitter_salt(profile_home);
    let now = i64::try_from(now).map_err(|_| {
        StoreError::new(
            StoreErrorCode::Internal,
            "Automation jitter salt import time exceeds SQLite integer range",
            false,
        )
    })?;
    if let Some(salt) = salt {
        connection.execute(
            "INSERT INTO core_automation_runtime_metadata(id, jitter_salt, created_at_unix_ms) \
             VALUES (1, ?1, ?2)",
            params![salt, now],
        )?;
        return Ok(());
    }
    connection.execute(
        "INSERT INTO core_automation_runtime_metadata(id, jitter_salt, created_at_unix_ms) \
         VALUES (1, lower(hex(randomblob(16))), ?1)",
        [now],
    )?;
    Ok(())
}

fn read_legacy_automation_jitter_salt(profile_home: &Path) -> Option<String> {
    let path = profile_home.join(AUTOMATION_JITTER_SALT_FILE);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_AUTOMATION_JITTER_SALT_BYTES
    {
        return None;
    }
    let salt = fs::read_to_string(path).ok()?;
    let salt = salt.trim();
    if salt.is_empty() || salt.len() > MAX_AUTOMATION_JITTER_SALT_BYTES as usize {
        return None;
    }
    Some(salt.to_owned())
}

fn import_legacy_writable_roots(
    connection: &Connection,
    profile_home: &Path,
    now: u64,
) -> Result<(), StoreError> {
    let imported = connection
        .query_row(
            "SELECT 1 FROM core_legacy_imports WHERE import_key = ?1",
            [LEGACY_WRITABLE_ROOTS_IMPORT_KEY],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if imported {
        return Ok(());
    }

    let state = read_legacy_writable_roots(profile_home);
    for (thread_id, roots) in state {
        if !valid_identifier(&thread_id) {
            continue;
        }
        let thread_exists = connection
            .query_row(
                "SELECT 1 FROM codex_threads WHERE thread_id = ?1",
                [&thread_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !thread_exists {
            continue;
        }
        for (order, root) in normalize_writable_roots(roots).into_iter().enumerate() {
            connection.execute(
                "INSERT INTO codex_thread_writable_roots(\
                   thread_id, root, root_order, updated_at_unix_ms\
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    thread_id,
                    root,
                    i64::try_from(order).expect("writable root bound fits i64"),
                    i64::try_from(now).map_err(|_| StoreError::new(
                        StoreErrorCode::Internal,
                        "Writable root import time exceeds SQLite integer range",
                        false,
                    ))?,
                ],
            )?;
        }
    }
    connection.execute(
        "INSERT INTO core_legacy_imports(import_key, imported_at_unix_ms) VALUES (?1, ?2)",
        params![
            LEGACY_WRITABLE_ROOTS_IMPORT_KEY,
            i64::try_from(now).map_err(|_| StoreError::new(
                StoreErrorCode::Internal,
                "Legacy import time exceeds SQLite integer range",
                false,
            ))?,
        ],
    )?;
    Ok(())
}

fn read_legacy_writable_roots(profile_home: &Path) -> Vec<(String, Vec<String>)> {
    let path = profile_home.join(LEGACY_WRITABLE_ROOTS_FILE_NAME);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return Vec::new();
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_LEGACY_WRITABLE_ROOTS_FILE_BYTES
    {
        return Vec::new();
    }
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    let Ok(serde_json::Value::Object(state)) = serde_json::from_slice(&bytes) else {
        return Vec::new();
    };
    state
        .into_iter()
        .filter_map(|(thread_id, roots)| {
            let serde_json::Value::Array(roots) = roots else {
                return None;
            };
            Some((
                thread_id,
                roots
                    .into_iter()
                    .filter_map(|root| root.as_str().map(str::to_owned))
                    .collect(),
            ))
        })
        .collect()
}

fn normalize_writable_roots(roots: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for root in roots {
        if normalized.len() == MAX_WRITABLE_ROOTS_PER_THREAD {
            break;
        }
        if !is_absolute_workspace_root(&root)
            || root.len() > MAX_WRITABLE_ROOT_BYTES
            || normalized.contains(&root)
        {
            continue;
        }
        normalized.push(root);
    }
    normalized
}

fn valid_identifier(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 512
}

fn is_absolute_workspace_root(root: &str) -> bool {
    let bytes = root.as_bytes();
    if root.starts_with('/') && !root.starts_with("//") {
        return true;
    }
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
    {
        return true;
    }
    if let Some(network_root) = root.strip_prefix("\\\\") {
        return network_root_has_server_and_share(network_root, '\\');
    }
    root.strip_prefix("//")
        .is_some_and(|network_root| network_root_has_server_and_share(network_root, '/'))
}

fn network_root_has_server_and_share(root: &str, separator: char) -> bool {
    let mut parts = root.split(separator);
    parts.next().is_some_and(|part| !part.is_empty())
        && parts.next().is_some_and(|part| !part.is_empty())
}

fn write_v85_metadata(
    transaction: &rusqlite::Transaction<'_>,
    migrated_from: Option<i64>,
    backup_name: Option<&str>,
    now: u64,
) -> Result<(), StoreError> {
    let now = i64::try_from(now).map_err(|_| {
        StoreError::new(
            StoreErrorCode::Internal,
            "Migration time exceeds SQLite integer range",
            false,
        )
    })?;
    transaction.execute(
        "INSERT INTO core_store_metadata (\
           id, schema_owner, store_format_version, migrated_from_version, \
           migration_backup_name, migrated_at_unix_ms\
         ) VALUES (1, ?1, ?2, ?3, ?4, ?5)",
        params![
            CORE_SCHEMA_OWNER,
            CORE_SCHEMA_VERSION,
            migrated_from,
            backup_name,
            now
        ],
    )?;
    transaction.pragma_update(None, "user_version", CORE_SCHEMA_VERSION)?;
    Ok(())
}

fn validate_core_metadata(
    connection: &Connection,
    expected_version: i64,
) -> Result<(), StoreError> {
    let metadata = connection
        .query_row(
            "SELECT schema_owner, store_format_version FROM core_store_metadata WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    if metadata != Some((CORE_SCHEMA_OWNER.to_owned(), expected_version)) {
        return Err(corrupt(format!(
            "v{expected_version} store does not contain the Rust Core ownership marker"
        )));
    }
    if expected_version < 88 {
        return Ok(());
    }
    let (floor, event_head) = connection.query_row(
        "SELECT metadata.projection_event_v2_floor, \
                (SELECT COALESCE(MAX(seq), 0) FROM change_log) \
         FROM core_store_metadata metadata WHERE metadata.id = 1",
        [],
        |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if floor.is_some_and(|floor| floor >= 1 && floor <= event_head + 1) {
        return Ok(());
    }
    Err(corrupt("Projection event replay floor is invalid"))
}

fn validate_exact_v85_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(
        connection, false, false, false, false, false, false, false, 85,
    )
}

fn validate_exact_v86_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(
        connection, true, false, false, false, false, false, false, 86,
    )
}

fn validate_exact_v87_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(
        connection, true, true, false, false, false, false, false, 87,
    )
}

fn validate_exact_v88_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, false, false, false, false, 88)
}

fn validate_exact_v89_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, false, false, false, false, 89)
}

fn validate_exact_v90_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, false, false, false, 90)
}

fn validate_exact_v91_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, false, false, 91)
}

fn validate_exact_v92_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, false, false, 92)
}

fn validate_exact_v93_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, false, 93)
}

fn validate_exact_v94_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 94)
}

fn validate_exact_v95_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 95)
}

fn validate_exact_v96_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 96)
}

fn validate_exact_v97_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 97)
}

fn validate_exact_v98_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 98)
}

fn validate_exact_current_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(
        connection,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        CORE_SCHEMA_VERSION,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_exact_core_schema(
    connection: &Connection,
    include_execution_profiles: bool,
    include_portable_tabs: bool,
    include_projection_impact: bool,
    include_window_owned_session_views: bool,
    include_workspace_sidebar_lanes: bool,
    include_database_starter_sessions: bool,
    include_project_appearance: bool,
    schema_version: i64,
) -> Result<(), StoreError> {
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(v84_schema_objects_sql())?;
    expected.execute_batch(V85_SCHEMA_SQL)?;
    expected.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
    ensure_automation_definition_revision(&expected)?;
    ensure_automation_run_revision(&expected)?;
    if include_execution_profiles {
        ensure_v86_execution_profile_schema(&expected)?;
    }
    if include_portable_tabs {
        ensure_v87_project_session_tabs_schema(&expected)?;
    }
    if include_projection_impact {
        ensure_v88_projection_impact_schema(&expected)?;
    }
    if include_window_owned_session_views {
        ensure_v90_window_owned_session_views_schema(&expected)?;
    }
    if include_workspace_sidebar_lanes {
        ensure_v91_workspace_sidebar_lanes_schema(&expected)?;
    }
    if include_database_starter_sessions {
        ensure_v93_database_starter_sessions_schema(&expected)?;
    }
    if include_project_appearance {
        ensure_v94_project_appearance_schema(&expected)?;
    }
    if schema_version >= 95 {
        ensure_v95_canvas_incremental_schema(&expected)?;
    }
    if schema_version >= 96 {
        ensure_v96_canvas_tombstone_bytes_schema(&expected)?;
    }
    if schema_version >= 97 {
        ensure_v97_canvas_owners_schema(&expected)?;
    }
    if schema_version >= 98 {
        ensure_v98_yjs_integrity_schema(&expected)?;
    }
    if schema_version >= 99 {
        ensure_v99_owner_scoped_scenes_schema(&expected)?;
    }

    let expected_inventory = read_schema_inventory(&expected)?;
    let actual_inventory = read_schema_inventory(connection)?;
    if actual_inventory == expected_inventory {
        return Ok(());
    }

    let missing = expected_inventory
        .keys()
        .filter(|key| !actual_inventory.contains_key(*key))
        .count();
    let unexpected = actual_inventory
        .keys()
        .filter(|key| !expected_inventory.contains_key(*key))
        .count();
    let changed = expected_inventory
        .iter()
        .filter(|(key, sql)| {
            actual_inventory
                .get(*key)
                .is_some_and(|actual_sql| actual_sql != *sql)
        })
        .count();
    Err(corrupt(format!(
        "v{schema_version} physical schema does not match the frozen Rust Core schema ({missing} missing, {unexpected} unexpected, {changed} changed objects)"
    )))
}

pub fn expected_store_schema_fingerprint(version: i64) -> Result<String, StoreError> {
    let expected = Connection::open_in_memory()?;
    if version == TYPESCRIPT_SCHEMA_VERSION {
        install_v84_schema(&expected)?;
        return read_schema_inventory(&expected)
            .map(|inventory| schema_inventory_fingerprint(&inventory));
    }
    if !(85..=CORE_SCHEMA_VERSION).contains(&version) {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            format!("No exact Rust Core schema inventory is published for v{version}"),
            false,
        ));
    }
    expected.execute_batch(v84_schema_objects_sql())?;
    expected.execute_batch(V85_SCHEMA_SQL)?;
    expected.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
    ensure_automation_definition_revision(&expected)?;
    ensure_automation_run_revision(&expected)?;
    if version >= 86 {
        ensure_v86_execution_profile_schema(&expected)?;
    }
    if version >= 87 {
        ensure_v87_project_session_tabs_schema(&expected)?;
    }
    if version >= 88 {
        ensure_v88_projection_impact_schema(&expected)?;
    }
    if version >= 90 {
        ensure_v90_window_owned_session_views_schema(&expected)?;
    }
    if version >= 91 {
        ensure_v91_workspace_sidebar_lanes_schema(&expected)?;
    }
    if version >= 93 {
        ensure_v93_database_starter_sessions_schema(&expected)?;
    }
    if version >= 94 {
        ensure_v94_project_appearance_schema(&expected)?;
    }
    if version >= 95 {
        ensure_v95_canvas_incremental_schema(&expected)?;
    }
    if version >= 96 {
        ensure_v96_canvas_tombstone_bytes_schema(&expected)?;
    }
    if version >= 97 {
        ensure_v97_canvas_owners_schema(&expected)?;
    }
    if version >= 98 {
        ensure_v98_yjs_integrity_schema(&expected)?;
    }
    if version >= 99 {
        ensure_v99_owner_scoped_scenes_schema(&expected)?;
    }
    read_schema_inventory(&expected).map(|inventory| schema_inventory_fingerprint(&inventory))
}

fn apply_update(
    document: &yrs::Doc,
    bytes: &[u8],
    document_id: &str,
    label: &str,
) -> Result<(), StoreError> {
    if bytes.len() > MAX_DOCUMENT_UPDATE_BYTES {
        return Err(corrupt(format!(
            "Document {document_id} {label} exceeds the update bound"
        )));
    }
    let update = Update::decode_v1(bytes)
        .map_err(|error| corrupt(format!("Document {document_id} {label}: {error}")))?;
    let mut transaction = document.transact_mut();
    transaction
        .apply_update(update)
        .map_err(|error| corrupt(format!("Document {document_id} {label}: {error}")))?;
    if has_pending_dependencies(&transaction) {
        return Err(corrupt(format!(
            "Document {document_id} {label} has unresolved causal dependencies"
        )));
    }
    Ok(())
}

fn verify_update_hash(
    update: &[u8],
    expected: &str,
    document_id: &str,
    label: &str,
) -> Result<(), StoreError> {
    if sha256(update) == expected {
        return Ok(());
    }
    Err(corrupt(format!(
        "Document {document_id} {label} hash does not match its bytes"
    )))
}

fn registered_schema(key: &str, version: i64) -> Result<BlockDocumentSchema, StoreError> {
    BlockDocumentSchema::from_identity(key, version)
        .ok_or_else(|| corrupt(format!("Document uses unregistered schema {key}@{version}")))
}

fn unix_time_millis() -> Result<u64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            StoreError::new(
                StoreErrorCode::Internal,
                format!("System clock is before the Unix epoch: {error}"),
                false,
            )
        })?;
    u64::try_from(duration.as_millis()).map_err(|_| {
        StoreError::new(
            StoreErrorCode::Internal,
            "System time exceeds the migration timestamp range",
            false,
        )
    })
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn io_error(error: std::io::Error) -> StoreError {
    StoreError::new(
        StoreErrorCode::Internal,
        format!("Store migration filesystem operation failed: {error}"),
        false,
    )
}

fn internal_json(error: serde_json::Error) -> StoreError {
    StoreError::new(
        StoreErrorCode::Internal,
        format!("Could not serialize materialization comparison: {error}"),
        false,
    )
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use rusqlite::params;
    use tempfile::tempdir;
    use yrs::updates::decoder::Decode;

    use crate::document::{
        BlockDocumentSchema, create_compatible_document, decode_block_document,
        materialize_decoded_document, reconstruct_yjs_engine,
    };
    use crate::infrastructure::schema::install_v84_schema;
    use crate::infrastructure::sqlite::{StoreErrorCode, open_writer};
    use crate::infrastructure::store::SqliteStoreKernel;

    use super::*;

    const DOCUMENT_ID: &str = "document:migration-page";

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/yjs-yrs")
            .join(name)
    }

    fn seed_v84_page(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v84 writer");
        install_v84_schema(&connection).expect("v84 schema");
        let full_state = fs::read(fixture("empty-page.bin")).expect("Page fixture");
        let document = create_compatible_document(DOCUMENT_ID);
        document
            .transact_mut()
            .apply_update(Update::decode_v1(&full_state).expect("Page update"))
            .expect("Page state");
        let decoded =
            decode_block_document(&document, BlockDocumentSchema::PageV2).expect("Page document");
        let materialization = materialize_decoded_document(&decoded).expect("materialization");
        let state_vector = document.transact().state_vector().encode_v1();
        let state_hash = sha256(&full_state);
        let update_hash = sha256(&full_state);
        let rich_title = serde_json::to_string(&materialization.rich_title).unwrap();
        let rich_title_hash = sha256(rich_title.as_bytes());
        let block_tree = serde_json::to_string(&materialization.block_tree).unwrap();
        let references = serde_json::to_string(&materialization.references).unwrap();
        let asset_refs = serde_json::to_string(&materialization.asset_refs).unwrap();

        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute(
                "INSERT INTO projects (id, name, created, updated) VALUES \
                 ('migration-project', 'Migration', '2026-07-18', '2026-07-18')",
                [],
            )?;
            transaction.execute(
                "INSERT INTO documents (\
                   id, project_id, generation, head_seq, schema_key, schema_version, state_vector, \
                   state_hash, readiness, authority, created_at, updated_at, sync_engine\
                 ) VALUES (?1, 'migration-project', 1, 1, 'nodex.page', 2, ?2, ?3, \
                   'ready', 'ydoc_primary', '2026-07-18', '2026-07-18', 'yjs')",
                params![DOCUMENT_ID, state_vector, state_hash],
            )?;
            transaction.execute(
                "INSERT INTO document_updates (\
                   document_id, generation, seq, update_id, client_session_id, base_head_seq, \
                   touched_block_ids_json, update_blob, update_hash, committed_at\
                 ) VALUES (?1, 1, 1, 'migration-genesis', 'migration-test', 0, '[]', ?2, ?3, '2026-07-18')",
                params![DOCUMENT_ID, full_state, update_hash],
            )?;
            transaction.execute(
                "INSERT INTO document_materializations (\
                   document_id, generation, projected_seq, schema_version, title, title_rich_json, \
                   title_rich_hash, nfm, plain_text, preview, block_tree_json, references_json, \
                   asset_refs_json, updated_at\
                 ) VALUES (?1, 1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '2026-07-18')",
                params![
                    DOCUMENT_ID,
                    materialization.schema_version,
                    materialization.title,
                    rich_title,
                    rich_title_hash,
                    materialization.nfm,
                    materialization.plain_text,
                    materialization.preview,
                    block_tree,
                    references,
                    asset_refs,
                ],
            )?;
            Ok(())
        })
        .expect("seed v84 Page");
    }

    fn seed_owned_v86_store(home: &Path, terminal_config_json: &str) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v86 writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(\
                   id, schema_owner, store_format_version, migrated_from_version, \
                   migration_backup_name, migrated_at_unix_ms\
                 ) VALUES (1, ?1, 86, NULL, NULL, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, name, created, updated) \
                 VALUES ('migration-project', 'Migration', '2026-07-18', '2026-07-18')",
                [],
            )?;
            transaction.execute(
                "INSERT INTO project_sessions(\
                   id, project_id, no_thread_fallback_title, \"order\", panel_state_json, \
                   created_at, updated_at\
                 ) VALUES (\
                   'migration-session', 'migration-project', 'Migration Session', 0, \
                   '{\"right\":{\"tabIds\":[\"migration-terminal\"]}}', \
                   '2026-07-18T01:00:00Z', '2026-07-18T02:00:00Z'\
                 )",
                [],
            )?;
            transaction.execute(
                "INSERT INTO project_session_tabs(\
                   id, session_id, project_id, browser_tab_id, panel_id, kind, title, \
                   config_json, state_key, state_json, \"order\", created_at, updated_at\
                 ) VALUES (\
                   'migration-terminal', 'migration-session', 'migration-project', NULL, \
                   'bottom', 'terminal', 'Legacy terminal', ?1, 7, '{\"cwd\":\"/legacy\"}', 3, \
                   '2026-07-18T03:00:00Z', '2026-07-18T04:00:00Z'\
                 )",
                [terminal_config_json],
            )?;
            transaction.pragma_update(None, "user_version", 86)?;
            Ok(())
        })
        .expect("seed v86 store");
    }

    fn promote_v84_page_to_owned_v97(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v97 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            ensure_v87_project_session_tabs_schema(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(\
                   id, schema_owner, store_format_version, migrated_from_version, \
                   migration_backup_name, migrated_at_unix_ms\
                 ) VALUES (1, ?1, 97, 84, 'seed-v84.db', 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            ensure_v88_projection_impact_schema(transaction)?;
            repair_v89_codex_thread_timestamps(transaction)?;
            ensure_v90_window_owned_session_views_schema(transaction)?;
            ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
            ensure_v92_canonical_text_timestamps(transaction)?;
            ensure_v93_database_starter_sessions_schema(transaction)?;
            ensure_v94_project_appearance_schema(transaction)?;
            ensure_v95_canvas_incremental_schema(transaction)?;
            ensure_v96_canvas_tombstone_bytes_schema(transaction)?;
            ensure_v97_canvas_owners_schema(transaction)?;
            let (generation, head_seq, source_state_hash, state_vector) = transaction.query_row(
                "SELECT generation, head_seq, state_hash, state_vector \
                 FROM documents WHERE id = ?1",
                [DOCUMENT_ID],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )?;
            transaction.execute(
                "INSERT INTO document_engine_fingerprints(\
                   document_id, generation, head_seq, source_state_hash, \
                   yrs_state_vector_sha256, yrs_full_state_sha256, \
                   materialization_sha256, validated_at_unix_ms\
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)",
                params![
                    DOCUMENT_ID,
                    generation,
                    head_seq,
                    source_state_hash,
                    sha256(&state_vector),
                    "f".repeat(64),
                    "e".repeat(64),
                ],
            )?;
            transaction.pragma_update(None, "user_version", 97)?;
            Ok(())
        })
        .expect("owned v97 Page");
    }

    fn seed_owned_v88_store_with_noncanonical_threads(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v88 writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            ensure_v87_project_session_tabs_schema(transaction)?;
            ensure_v88_projection_impact_schema(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(\
                   id, schema_owner, store_format_version, migrated_from_version, \
                   migration_backup_name, migrated_at_unix_ms, projection_event_v2_floor\
                 ) VALUES (1, ?1, 88, NULL, NULL, 1, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            transaction.execute(
                "INSERT INTO codex_threads(\
                   thread_id, thread_preview, model_provider, status_type, \
                   status_active_flags_json, archived, created_at, updated_at, linked_at\
                 ) VALUES (\
                   '019f2321-8ed9-74d0-a2cc-48856e20cf0c', '', 'openai', 'notLoaded', \
                   '[]', 0, 1783029629000, 1783000989000, '2026-07-02T14:00:29Z'\
                 )",
                [],
            )?;
            transaction.execute(
                "INSERT INTO codex_threads(\
                   thread_id, thread_preview, model_provider, status_type, \
                   status_active_flags_json, archived, created_at, updated_at, linked_at\
                 ) VALUES (\
                   '019f8b12-45fe-7e53-a8ba-bd0c0d5b4e88', '', 'openai', 'notLoaded', \
                   '[]', 0, 1784744661000, 1784744712000, '2026-07-22T09:04:18Z'\
                 )",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 88)?;
            Ok(())
        })
        .expect("seed v88 store");
    }

    fn seed_owned_v90_store_with_legacy_sidebar(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v90 writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            ensure_v87_project_session_tabs_schema(transaction)?;
            ensure_v88_projection_impact_schema(transaction)?;
            ensure_v90_window_owned_session_views_schema(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(
                   id, schema_owner, store_format_version, migrated_from_version,
                   migration_backup_name, migrated_at_unix_ms, projection_event_v2_floor
                 ) VALUES (1, ?1, 90, NULL, NULL, 1, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, name, created, updated)
                 VALUES ('project:legacy', 'Legacy', '2026-07-25', '2026-07-25')",
                [],
            )?;
            let long_preview = "你🙂".repeat(400);
            transaction.execute(
                "INSERT INTO codex_threads(
                   thread_id, project_id, thread_preview, model_provider, status_type,
                   status_active_flags_json, archived, created_at, updated_at, linked_at
                 ) VALUES (
                   'thread:project', 'project:legacy', ?1, 'openai', 'idle',
                   '[]', 0, 1, 2, '2026-07-25T00:00:00Z'
                 )",
                [&long_preview],
            )?;
            transaction.execute(
                "INSERT INTO codex_threads(
                   thread_id, project_id, thread_preview, model_provider, status_type,
                   status_active_flags_json, archived, created_at, updated_at, linked_at
                 ) VALUES (
                   'thread:chat', NULL, ?1, 'openai', 'idle',
                   '[]', 0, 1, 2, '2026-07-25T00:00:00Z'
                 )",
                [&long_preview],
            )?;
            transaction.execute(
                "INSERT INTO codex_project_thread_orders(
                   project_id, ordered_thread_ids_json, updated_at
                 ) VALUES (
                   'project:legacy', '[\"thread:project\"]', '2026-07-25T00:00:00Z'
                 )",
                [],
            )?;
            transaction.execute(
                "INSERT INTO codex_sidebar_chat_order(
                   singleton, ordered_thread_ids_json, updated_at
                 ) VALUES (
                   1, '[\"thread:chat\"]', '2026-07-25T00:00:00Z'
                 )",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 90)?;
            Ok(())
        })
        .expect("seed v90 sidebar store");
    }

    fn seed_owned_v91_store_with_legacy_protocol_timestamps(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v91 writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            ensure_v87_project_session_tabs_schema(transaction)?;
            ensure_v88_projection_impact_schema(transaction)?;
            ensure_v90_window_owned_session_views_schema(transaction)?;
            ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
            let legacy = "2026-02-06T20:37:07.873706+00:00";
            transaction.execute(
                "INSERT INTO core_store_metadata(
                   id, schema_owner, store_format_version, migrated_from_version,
                   migration_backup_name, migrated_at_unix_ms, projection_event_v2_floor
                 ) VALUES (1, ?1, 91, NULL, NULL, 1, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at)
                 VALUES ('profile:timestamp', ?1, ?1)",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at)
                 VALUES ('library:timestamp', 'profile:timestamp', ?1, ?1)",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, name, created, updated, library_id)
                 VALUES (
                   'project:timestamp', 'Timestamp', '2026-02-06', '2026-02-06',
                   'library:timestamp'
                 )",
                [],
            )?;
            transaction.execute(
                "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at)
                 VALUES (1, 'epoch:timestamp', ?1, ?1)",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO blocks(
                   id, project_id, type, lifecycle, location_kind,
                   created_at, updated_at
                 ) VALUES (
                   'database:timestamp', 'project:timestamp', 'database', 'active', 'space',
                   ?1, ?1
                 )",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO database_containers(
                   block_id, library_id, name, lifecycle, created_at, updated_at
                 ) VALUES (
                   'database:timestamp', 'library:timestamp', 'Timestamp DB', 'active', ?1, ?1
                 )",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO data_sources(
                   id, library_id, home_database_block_id, name, schema_key,
                   lifecycle, rank_key, created_at, updated_at
                 ) VALUES (
                   'source:timestamp', 'library:timestamp', 'database:timestamp',
                   'Timestamp Source', 'nodex.database', 'active', 'a', ?1, ?1
                 )",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO data_source_properties(
                   data_source_id, id, name, value_type, config_json, rank_key,
                   lifecycle, created_at, updated_at
                 ) VALUES (
                   'source:timestamp', 'title', 'Title', 'text', '{}', 'a', 'active', ?1, ?1
                 )",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO database_views(
                   id, database_block_id, data_source_id, name, kind, config_json,
                   rank_key, lifecycle, created_at, updated_at
                 ) VALUES (
                   'view:timestamp', 'database:timestamp', 'source:timestamp', 'Canvas', 'canvas',
                   '{}', 'a', 'active', ?1, ?1
                 )",
                [legacy],
            )?;
            transaction.execute(
                "UPDATE database_containers SET default_view_id = 'view:timestamp'
                 WHERE block_id = 'database:timestamp'",
                [],
            )?;
            transaction.execute(
                "INSERT INTO library_block_placements(
                   block_id, library_id, rank_key, created_at, updated_at
                 ) VALUES ('database:timestamp', 'library:timestamp', 'a', ?1, ?1)",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO project_database_bindings(
                   project_id, library_id, database_block_id, lifecycle, created_at, updated_at
                 ) VALUES (
                   'project:timestamp', 'library:timestamp', 'database:timestamp',
                   'active', ?1, ?1
                 )",
                [legacy],
            )?;
            transaction.execute(
                "INSERT INTO top_level_block_placements(
                   block_id, project_id, rank_key, created_at, updated_at
                 ) VALUES ('database:timestamp', 'project:timestamp', 'a', ?1, ?1)",
                [legacy],
            )?;
            transaction.pragma_update(None, "user_version", 91)?;
            Ok(())
        })
        .expect("seed v91 timestamp store");
    }

    fn open_error(home: &Path) -> StoreError {
        match SqliteStoreKernel::open(home) {
            Ok(_) => panic!("store open unexpectedly succeeded"),
            Err(error) => error,
        }
    }

    #[test]
    fn fresh_profiles_publish_current_schema_and_hold_the_store_lock() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh Core store");
        assert_eq!(kernel.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert!(kernel.preparation().created_fresh);
        assert!(kernel.preparation().migration_backup_path.is_none());
        let version = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                    .map_err(StoreError::from)
            })
            .expect("read schema version");
        assert_eq!(version, CORE_SCHEMA_VERSION);
        let agent_path_columns = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT count(*) FROM pragma_table_info('codex_threads') \
                         WHERE name = 'agent_path'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("read Codex Thread agent path schema");
        assert_eq!(agent_path_columns, 1);
        let execution_profile_columns = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT count(*) FROM pragma_table_info('codex_threads') \
                         WHERE name IN ('model_id', 'harness_id', 'reasoning_effort', 'service_tier')",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("read execution profile schema");
        assert_eq!(execution_profile_columns, 4);

        let second = open_error(&home);
        assert_eq!(second.code, StoreErrorCode::AlreadyOwned);
        drop(kernel);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen current store");
        assert!(!reopened.preparation().created_fresh);
    }

    #[test]
    fn v88_upgrade_canonicalizes_codex_thread_creation_and_repairs_inversion() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v88_store_with_noncanonical_threads(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v88 Core store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(88));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v88 migration backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        assert_eq!(
            backup
                .query_row(
                    "SELECT created_at FROM codex_threads WHERE thread_id = \
                     '019f2321-8ed9-74d0-a2cc-48856e20cf0c'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("backup creation time"),
            1_783_029_629_000
        );

        let timestamps = upgraded
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT created_at, updated_at FROM codex_threads WHERE thread_id = \
                         '019f2321-8ed9-74d0-a2cc-48856e20cf0c'",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )
                    .map_err(StoreError::from)
            })
            .expect("repaired Thread timestamps");
        assert_eq!(timestamps, (1_783_000_829_000, 1_783_000_989_000));
        let cold_restart_timestamps = upgraded
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT created_at, updated_at FROM codex_threads WHERE thread_id = \
                         '019f8b12-45fe-7e53-a8ba-bd0c0d5b4e88'",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )
                    .map_err(StoreError::from)
            })
            .expect("canonical cold-restart Thread timestamps");
        assert_eq!(
            cold_restart_timestamps,
            (1_784_744_658_000, 1_784_744_712_000)
        );

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen current v89 store");
        assert_eq!(reopened.preparation().migrated_from_version, None);
    }

    #[test]
    fn current_store_rejects_inverted_codex_thread_timestamps() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh Core store");
        drop(kernel);

        let connection = open_writer(&home.join("nodex.db")).expect("current writer");
        connection
            .execute(
                "INSERT INTO codex_threads(\
                   thread_id, thread_preview, model_provider, status_type, \
                   status_active_flags_json, archived, created_at, updated_at, linked_at\
                 ) VALUES (\
                   'thread-invalid-clock', '', 'openai', 'notLoaded', '[]', 0, \
                   2000, 1000, '2026-07-23T00:00:00Z'\
                 )",
                [],
            )
            .expect("seed invalid Thread clock");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert!(error.message.contains("update time precedes creation"));
    }

    #[test]
    fn v85_execution_profiles_upgrade_with_backup_and_preserve_automation_leases() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let mut connection = open_writer(&home.join("nodex.db")).expect("v85 Core writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(\
                   id, schema_owner, store_format_version, migrated_from_version, \
                   migration_backup_name, migrated_at_unix_ms\
                 ) VALUES (1, ?1, 85, NULL, NULL, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            transaction.execute_batch(
                "INSERT INTO codex_scheduled_automations(\
                   automation_id, kind, status, name, prompt, model, reasoning_effort, \
                   cwds_json, execution_environment, created_at, updated_at, definition_revision\
                 ) VALUES (\
                   'legacy-automation', 'cron', 'ACTIVE', 'Legacy', '', 'claude-opus-4-1', \
                   'high', '[]', 'worktree', 1, 1, 1\
                 );
                 INSERT INTO core_automation_leases(\
                   lease_id, automation_id, scheduled_for_ms, attempt, status, claimed_at_ms, \
                   expires_at_ms\
                 ) VALUES ('legacy-lease', 'legacy-automation', 10, 1, 'claimed', 1, 20);",
            )?;
            transaction.pragma_update(None, "user_version", 85)?;
            Ok(())
        })
        .expect("seed v85 store");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v85 Core store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(85));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v85 migration backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        let backup_version: i64 = backup
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("backup version");
        assert_eq!(backup_version, 85);
        upgraded
            .writer()
            .call(|connection| {
                let profile_columns: i64 = connection.query_row(
                    "SELECT count(*) FROM pragma_table_info('codex_threads') \
                     WHERE name IN ('model_id', 'harness_id', 'reasoning_effort', 'service_tier')",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(profile_columns, 4);
                let legacy = connection.query_row(
                    "SELECT model, model_provider, harness_id, reasoning_effort, service_tier \
                     FROM codex_scheduled_automations WHERE automation_id = 'legacy-automation'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, Option<String>>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                        ))
                    },
                )?;
                assert_eq!(
                    legacy,
                    (
                        Some("claude-opus-4-1".to_owned()),
                        None,
                        None,
                        Some("high".to_owned()),
                        None,
                    )
                );
                let leases: i64 = connection.query_row(
                    "SELECT count(*) FROM core_automation_leases \
                     WHERE lease_id = 'legacy-lease' AND automation_id = 'legacy-automation'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(leases, 1);
                connection.execute(
                    "UPDATE codex_scheduled_automations SET \
                       model_provider = 'anthropic', harness_id = 'fable', \
                       reasoning_effort = 'Thinking', service_tier = 'priority' \
                     WHERE automation_id = 'legacy-automation'",
                    [],
                )?;
                Ok::<_, StoreError>(())
            })
            .expect("verify v86 profile schema");
    }

    #[test]
    fn v86_upgrade_discards_shared_view_state_and_preserves_domain_data() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v86_store(
            &home,
            r#"{"projectId":"migration-project","terminalSessionId":"terminal:legacy"}"#,
        );

        let mut events = Vec::new();
        let upgraded = SqliteStoreKernel::open_with_observer(&home, |event| events.push(event))
            .expect("upgrade v86 Core store");
        assert_eq!(
            events,
            [StorePreparationEvent::MigrationStarted {
                from_version: 86,
                to_version: CORE_SCHEMA_VERSION,
            }]
        );
        assert_eq!(upgraded.preparation().migrated_from_version, Some(86));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v86 migration backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        assert_eq!(
            backup
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("backup version"),
            86
        );

        upgraded
            .writer()
            .call(|connection| {
                let legacy_tab_table: i64 = connection.query_row(
                    "SELECT count(*) FROM sqlite_master \
                     WHERE type = 'table' AND name = 'project_session_tabs'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(legacy_tab_table, 0);
                let session = connection.query_row(
                    "SELECT project_id, no_thread_fallback_title \
                     FROM project_sessions \
                     WHERE id = 'migration-session'",
                    [],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
                )?;
                assert_eq!(
                    session,
                    (
                        Some("migration-project".to_owned()),
                        "Migration Session".to_owned(),
                    )
                );
                Ok::<_, StoreError>(())
            })
            .expect("verify v90 window-owned view migration");
        drop(upgraded);
        let mut reopen_events = Vec::new();
        let reopened =
            SqliteStoreKernel::open_with_observer(&home, |event| reopen_events.push(event))
                .expect("validate current v90 store exactly");
        assert!(reopen_events.is_empty());
        assert_eq!(reopened.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(reopened.preparation().migrated_from_version, None);
        assert!(reopened.preparation().migration_backup_path.is_none());
    }

    fn seed_owned_v92_store_with_starter_sessions(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v92 writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            ensure_v87_project_session_tabs_schema(transaction)?;
            ensure_v88_projection_impact_schema(transaction)?;
            ensure_v90_window_owned_session_views_schema(transaction)?;
            ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(
                   id, schema_owner, store_format_version, migrated_from_version,
                   migration_backup_name, migrated_at_unix_ms, projection_event_v2_floor
                 ) VALUES (1, ?1, 92, NULL, NULL, 1, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            let canonical = "2026-07-25T00:00:00.000Z";
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at)
                 VALUES ('profile:starter', ?1, ?1)",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at)
                 VALUES ('library:starter', 'profile:starter', ?1, ?1)",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, name, created, updated, library_id)
                 VALUES ('project:starter', 'Starter', ?1, ?1, 'library:starter')",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO blocks(
                   id, project_id, type, lifecycle, location_kind, created_at, updated_at
                 ) VALUES (
                   'database:starter', 'project:starter', 'database', 'active', 'space', ?1, ?1
                 )",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO database_containers(
                   block_id, library_id, name, lifecycle, created_at, updated_at
                 ) VALUES (
                   'database:starter', 'library:starter', 'Starter DB', 'active', ?1, ?1
                 )",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO data_sources(
                   id, library_id, home_database_block_id, name, schema_key,
                   lifecycle, rank_key, created_at, updated_at
                 ) VALUES (
                   'source:starter', 'library:starter', 'database:starter',
                   'Starter Source', 'nodex.database', 'active', 'a', ?1, ?1
                 )",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO database_views(
                   id, database_block_id, data_source_id, name, kind, config_json,
                   rank_key, lifecycle, created_at, updated_at
                 ) VALUES (
                   'view:starter', 'database:starter', 'source:starter', 'Kanban', 'kanban',
                   '{}', 'a', 'active', ?1, ?1
                 )",
                [canonical],
            )?;
            transaction.execute(
                "UPDATE database_containers SET default_view_id = 'view:starter'
                 WHERE block_id = 'database:starter'",
                [],
            )?;
            transaction.execute(
                "INSERT INTO project_sessions(
                   id, project_id, no_thread_fallback_title, \"order\", pinned, pinned_order,
                   archived, archived_at, unread, initial_database_view_id,
                   created_at, updated_at
                 ) VALUES
                   ('session:starter', 'project:starter', 'Database View', 0, 1, 0,
                    0, NULL, 0, 'view:starter', ?1, ?1),
                   ('session:chat', 'project:starter', 'Chat', 1, 0, NULL,
                    0, NULL, 0, NULL, ?1, ?1)",
                [canonical],
            )?;
            transaction.pragma_update(None, "user_version", 92)?;
            Ok(())
        })
        .expect("seed v92 starter store");
    }

    fn seed_owned_v93_store_with_legacy_project_icons(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v93 writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            ensure_v87_project_session_tabs_schema(transaction)?;
            ensure_v88_projection_impact_schema(transaction)?;
            ensure_v90_window_owned_session_views_schema(transaction)?;
            ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
            ensure_v93_database_starter_sessions_schema(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(
                   id, schema_owner, store_format_version, migrated_from_version,
                   migration_backup_name, migrated_at_unix_ms, projection_event_v2_floor
                 ) VALUES (1, ?1, 93, NULL, NULL, 1, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            let canonical = "2026-07-26T00:00:00.000Z";
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at)
                 VALUES ('profile:appearance', ?1, ?1)",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at)
                 VALUES ('library:appearance', 'profile:appearance', ?1, ?1)",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, name, description, icon, created, updated, library_id)
                 VALUES
                   ('project:empty', 'Empty', '', '', ?1, ?1, 'library:appearance'),
                   ('project:emoji', 'Emoji', '', 'Launch 🚀 now', ?1, ?1, 'library:appearance'),
                   ('project:malformed', 'Malformed', '', 'plain text', ?1, ?1, 'library:appearance')",
                [canonical],
            )?;
            transaction.pragma_update(None, "user_version", 93)?;
            Ok(())
        })
        .expect("seed v93 Project appearances");
    }

    fn seed_owned_v97_store_with_threaded_and_threadless_starters(home: &Path) {
        seed_owned_v92_store_with_starter_sessions(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v97 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            ensure_v93_database_starter_sessions_schema(transaction)?;
            let canonical = "2026-07-25T00:00:00.000Z";
            transaction.execute(
                "INSERT INTO project_sessions(
                   id, project_id, no_thread_fallback_title, \"order\", pinned, pinned_order,
                   archived, archived_at, unread, database_starter, created_at, updated_at
                 ) VALUES (
                   'session:threaded-starter', 'project:starter', 'Database View', 2, 1, 1,
                   0, NULL, 0, 1, ?1, ?1
                 )",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO codex_threads(
                   thread_id, project_id, thread_preview, model_provider, status_type,
                   status_active_flags_json, archived, created_at, updated_at, linked_at
                 ) VALUES (
                   'thread:starter', 'project:starter', 'Real conversation', 'openai',
                   'notLoaded', '[]', 0, 1, 1, ?1
                 )",
                [canonical],
            )?;
            transaction.execute(
                "INSERT INTO project_session_threads(session_id, thread_id, linked_at)
                 VALUES ('session:threaded-starter', 'thread:starter', ?1)",
                [canonical],
            )?;
            ensure_v94_project_appearance_schema(transaction)?;
            ensure_v95_canvas_incremental_schema(transaction)?;
            ensure_v96_canvas_tombstone_bytes_schema(transaction)?;
            ensure_v97_canvas_owners_schema(transaction)?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 97
                 WHERE id = 1 AND schema_owner = ?1 AND store_format_version = 92",
                [CORE_SCHEMA_OWNER],
            )?;
            transaction.pragma_update(None, "user_version", 97)?;
            Ok(())
        })
        .expect("seed v97 starter store");
    }

    fn promote_owned_v97_starter_store_to_v98(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v98 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            ensure_v98_yjs_integrity_schema(transaction)?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 98
                 WHERE id = 1 AND schema_owner = ?1 AND store_format_version = 97",
                [CORE_SCHEMA_OWNER],
            )?;
            transaction.pragma_update(None, "user_version", 98)?;
            Ok(())
        })
        .expect("promote starter store to v98");
    }

    fn seed_owned_v94_store_with_canvas(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v94 writer");
        install_v84_schema(&connection).expect("v84 schema");
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch(V85_SCHEMA_SQL)?;
            transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
            ensure_automation_definition_revision(transaction)?;
            ensure_automation_run_revision(transaction)?;
            ensure_v86_execution_profile_schema(transaction)?;
            ensure_v87_project_session_tabs_schema(transaction)?;
            ensure_v88_projection_impact_schema(transaction)?;
            ensure_v90_window_owned_session_views_schema(transaction)?;
            ensure_v91_workspace_sidebar_lanes_schema(transaction)?;
            ensure_v93_database_starter_sessions_schema(transaction)?;
            ensure_v94_project_appearance_schema(transaction)?;
            transaction.execute(
                "INSERT INTO core_store_metadata(\
                   id, schema_owner, store_format_version, migrated_from_version, \
                   migration_backup_name, migrated_at_unix_ms, projection_event_v2_floor\
                 ) VALUES (1, ?1, 94, NULL, NULL, 1, 1)",
                [CORE_SCHEMA_OWNER],
            )?;
            let now = "2026-07-29T00:00:00.000Z";
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at) \
                 VALUES ('profile:canvas-v94', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                 VALUES ('library:canvas-v94', 'profile:canvas-v94', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, library_id, name, created, updated) \
                 VALUES ('project:canvas-v94', 'library:canvas-v94', 'Canvas v94', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO blocks(\
                   id, project_id, type, lifecycle, location_kind, containing_document_id, \
                   containing_database_id, location_revision, metadata_revision, created_at, updated_at\
                 ) VALUES (\
                   'block:canvas-v94', 'project:canvas-v94', 'canvas', 'active', 'space', \
                   NULL, NULL, 1, 1, ?1, ?1\
                 )",
                [now],
            )?;
            let legacy_hash = sha256(
                serde_json::to_string(&serde_json::json!({
                    "schemaVersion": 1,
                    "elements": [],
                    "appState": {},
                    "files": {},
                    "pageReferences": [],
                }))
                .map_err(internal_json)?
                .as_bytes(),
            );
            transaction.execute(
                "INSERT INTO documents(\
                   id, project_id, generation, head_seq, schema_key, schema_version, \
                   state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine\
                 ) VALUES (\
                   'document:canvas-v94', 'project:canvas-v94', 1, 0, 'nodex.canvas', 1, \
                   X'', ?1, 'ready', 'ydoc_primary', ?2, ?2, 'canvas_scene'\
                 )",
                params![legacy_hash, now],
            )?;
            transaction.execute(
                "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                 VALUES (\
                   'block:canvas-v94', 'document:canvas-v94', 'project:canvas-v94', ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO canvas_scenes(\
                   document_id, generation, head_seq, schema_version, app_state_json, scene_hash, updated_at\
                 ) VALUES ('document:canvas-v94', 1, 0, 1, '{}', ?1, ?2)",
                params![legacy_hash, now],
            )?;
            transaction.execute(
                "INSERT INTO block_search_units(\
                   unit_key, project_id, block_id, owner_block_id, document_id, \
                   document_generation, projected_seq, source_revision, projection_version, \
                   source_kind, field_key, text, text_hash, updated_at\
                 ) VALUES (\
                   'canvas-v94-marker', 'project:canvas-v94', 'block:canvas-v94', \
                   'block:canvas-v94', 'document:canvas-v94', 1, 0, NULL, 1, \
                   'document_marker', 'marker', '', ?1, ?2\
                 )",
                params![sha256(b""), now],
            )?;
            transaction.pragma_update(None, "user_version", 94)?;
            Ok(())
        })
        .expect("seed v94 Canvas");
    }

    #[test]
    fn v92_upgrade_removes_threadless_database_starter_session() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v92_store_with_starter_sessions(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v92 Core store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(92));
        upgraded
            .writer()
            .call(|connection| {
                let legacy_column: i64 = connection.query_row(
                    "SELECT count(*) FROM pragma_table_info('project_sessions') \
                     WHERE name IN ('initial_database_view_id', 'database_starter')",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(legacy_column, 0);
                let sessions = connection
                    .prepare("SELECT id FROM project_sessions ORDER BY id")?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(sessions, ["session:chat".to_owned()]);
                Ok::<_, StoreError>(())
            })
            .expect("verify v99 starter retirement migration");
        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("validate current store exactly");
        assert_eq!(reopened.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(reopened.preparation().migrated_from_version, None);
    }

    #[test]
    fn v97_upgrade_preserves_threaded_starter_as_an_ordinary_session() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v97_store_with_threaded_and_threadless_starters(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v97 Core store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(97));
        upgraded
            .writer()
            .call(|connection| {
                let sessions = connection
                    .prepare("SELECT id FROM project_sessions ORDER BY id")?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(
                    sessions,
                    [
                        "session:chat".to_owned(),
                        "session:threaded-starter".to_owned(),
                    ]
                );
                let link: String = connection.query_row(
                    "SELECT thread_id FROM project_session_threads
                     WHERE session_id = 'session:threaded-starter'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(link, "thread:starter");
                let marker_columns: i64 = connection.query_row(
                    "SELECT count(*) FROM pragma_table_info('project_sessions')
                     WHERE name = 'database_starter'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(marker_columns, 0);
                Ok::<_, StoreError>(())
            })
            .expect("verify v99 starter retirement");
    }

    #[test]
    fn v98_upgrade_runs_only_the_owner_scoped_scene_migration() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v97_store_with_threaded_and_threadless_starters(&home);
        promote_owned_v97_starter_store_to_v98(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v98 Core store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(98));
        upgraded
            .writer()
            .call(|connection| {
                let marker_columns: i64 = connection.query_row(
                    "SELECT count(*) FROM pragma_table_info('project_sessions')
                     WHERE name = 'database_starter'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(marker_columns, 0);
                let sessions = connection
                    .prepare("SELECT id FROM project_sessions ORDER BY id")?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(
                    sessions,
                    [
                        "session:chat".to_owned(),
                        "session:threaded-starter".to_owned(),
                    ]
                );
                Ok::<_, StoreError>(())
            })
            .expect("verify v98-to-v99 owner-scoped Scene migration");
    }

    #[test]
    fn v93_upgrade_moves_legacy_project_icons_into_valid_owned_appearances() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v93_store_with_legacy_project_icons(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v93 Core store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(93));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v93 migration backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        assert_eq!(
            backup
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("backup version"),
            93
        );
        assert_eq!(
            backup
                .query_row(
                    "SELECT icon FROM projects WHERE id = 'project:emoji'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("legacy backup icon"),
            "Launch 🚀 now"
        );

        upgraded
            .writer()
            .call(|connection| {
                let legacy_column: i64 = connection.query_row(
                    "SELECT count(*) FROM pragma_table_info('projects') WHERE name = 'icon'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(legacy_column, 0);
                let appearances = connection
                    .prepare(
                        "SELECT id, appearance_color, appearance_marker_kind, \
                           appearance_marker_value FROM projects ORDER BY id",
                    )?
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(
                    appearances,
                    [
                        (
                            "project:emoji".to_owned(),
                            "black".to_owned(),
                            "emoji".to_owned(),
                            "🚀".to_owned(),
                        ),
                        (
                            "project:empty".to_owned(),
                            "black".to_owned(),
                            "icon".to_owned(),
                            "folder".to_owned(),
                        ),
                        (
                            "project:malformed".to_owned(),
                            "black".to_owned(),
                            "icon".to_owned(),
                            "folder".to_owned(),
                        ),
                    ]
                );
                Ok::<_, StoreError>(())
            })
            .expect("verify v94 Project appearances");
        drop(upgraded);

        let reopened = SqliteStoreKernel::open(&home).expect("reopen current store");
        assert_eq!(reopened.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(reopened.preparation().migrated_from_version, None);
    }

    #[test]
    fn v94_upgrade_backfills_exact_incremental_canvas_authority() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v94_store_with_canvas(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v94 Canvas store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(94));
        upgraded
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT scene.scene_hash_version, scene.element_count, \
                            scene.tombstone_count, scene.file_count, scene.scene_byte_length, \
                            scene.scene_hash, document.state_hash, projection.generation, \
                            projection.projected_head_seq, projection.projection_version \
                     FROM canvas_scenes scene \
                     JOIN documents document ON document.id = scene.document_id \
                     JOIN canvas_scene_projection_heads projection \
                       ON projection.document_id = scene.document_id \
                     WHERE scene.document_id = 'document:canvas-v94'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, i64>(7)?,
                            row.get::<_, i64>(8)?,
                            row.get::<_, i64>(9)?,
                        ))
                    },
                )?;
                assert_eq!(evidence.0, 2);
                assert_eq!((evidence.1, evidence.2, evidence.3), (0, 0, 0));
                assert!(evidence.4 > 0);
                assert_eq!(evidence.5, evidence.6);
                assert_eq!((evidence.7, evidence.8, evidence.9), (1, 0, 2));
                assert_eq!(
                    connection.query_row(
                        "SELECT tombstone_json_bytes FROM canvas_scenes \
                         WHERE document_id = 'document:canvas-v94'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                assert_eq!(
                    connection.query_row("PRAGMA integrity_check", [], |row| {
                        row.get::<_, String>(0)
                    })?,
                    "ok"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM pragma_foreign_key_check",
                        [],
                        |row| { row.get::<_, i64>(0) }
                    )?,
                    0
                );
                Ok::<_, StoreError>(())
            })
            .expect("verify current Canvas authority");
        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen current Canvas store");
        assert_eq!(reopened.preparation().migrated_from_version, None);
    }

    #[test]
    fn v96_upgrade_adds_exact_canvas_tombstone_bytes() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v94_store_with_canvas(&home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v95 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            ensure_v95_canvas_incremental_schema(transaction)?;
            let updated = transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 95 \
                 WHERE id = 1 AND store_format_version = 94",
                [],
            )?;
            assert_eq!(updated, 1);
            transaction.pragma_update(None, "user_version", 95)?;
            Ok(())
        })
        .expect("publish exact v95 store");
        validate_exact_v95_schema(&connection).expect("validate exact v95 store");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v95 Canvas store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(95));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v95 migration backup");
        assert_eq!(
            open_immutable_reader(backup_path)
                .expect("open v95 backup")
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("read backup version"),
            95
        );
        upgraded
            .readers()
            .read_default(|connection| {
                assert_eq!(
                    connection.query_row(
                        "SELECT tombstone_json_bytes FROM canvas_scenes \
                         WHERE document_id = 'document:canvas-v94'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT library_id FROM canvas_owners \
                         WHERE block_id = 'block:canvas-v94'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "library:canvas-v94"
                );
                Ok::<_, StoreError>(())
            })
            .expect("read upgraded Canvas metadata");
        drop(upgraded);

        let reopened = SqliteStoreKernel::open(&home).expect("reopen v96 Canvas store");
        assert_eq!(reopened.preparation().migrated_from_version, None);
    }

    #[test]
    fn v90_upgrade_materializes_sidebar_ranks_and_unicode_safe_previews_once() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v90_store_with_legacy_sidebar(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v90 Core store");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(90));
        upgraded
            .writer()
            .call(|connection| {
                let lanes = connection
                    .prepare(
                        "SELECT scope_key, order_mode
                         FROM workspace_sidebar_lanes
                         ORDER BY scope_key",
                    )?
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(
                    lanes,
                    [
                        ("project:project:legacy".to_owned(), "manual".to_owned()),
                        ("projectless".to_owned(), "manual".to_owned()),
                    ]
                );
                let positions = connection
                    .prepare(
                        "SELECT scope_key, thread_id, rank_key
                         FROM workspace_sidebar_positions
                         ORDER BY scope_key, rank_key",
                    )?
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(
                    positions,
                    [
                        (
                            "project:project:legacy".to_owned(),
                            "thread:project".to_owned(),
                            1_000_000,
                        ),
                        (
                            "projectless".to_owned(),
                            "thread:chat".to_owned(),
                            1_000_000,
                        ),
                    ]
                );
                let preview = connection.query_row(
                    "SELECT thread_preview FROM codex_threads
                     WHERE thread_id = 'thread:project'",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                assert!(preview.encode_utf16().count() <= 240);
                assert!(preview.len() <= 1_024);
                assert!(preview.ends_with('你') || preview.ends_with('🙂'));
                let legacy_tables = connection.query_row(
                    "SELECT count(*) FROM sqlite_schema
                     WHERE type = 'table'
                       AND name IN (
                         'codex_project_thread_orders',
                         'codex_sidebar_chat_order'
                       )",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(legacy_tables, 0);
                let observation_table = connection.query_row(
                    "SELECT count(*) FROM sqlite_schema
                     WHERE type = 'table'
                       AND name = 'workspace_app_server_thread_observations'",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(observation_table, 1);
                Ok::<_, StoreError>(())
            })
            .expect("verify v91 sidebar migration");
        drop(upgraded);

        let reopened = SqliteStoreKernel::open(&home).expect("reopen migrated v91 store");
        assert_eq!(reopened.preparation().migrated_from_version, None);
        assert!(reopened.preparation().migration_backup_path.is_none());
    }

    #[test]
    fn v91_upgrade_canonicalizes_every_text_timestamp_and_preserves_the_source_backup() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v91_store_with_legacy_protocol_timestamps(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v91 timestamp store");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(91));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v91 migration backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        assert_eq!(
            backup
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("backup version"),
            91
        );
        assert_eq!(
            backup
                .query_row(
                    "SELECT created_at FROM database_containers
                     WHERE block_id = 'database:timestamp'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("legacy backup timestamp"),
            "2026-02-06T20:37:07.873706+00:00"
        );

        upgraded
            .writer()
            .call(|connection| {
                validate_canonical_text_timestamp_invariants(connection)?;
                let timestamps = connection.query_row(
                    "SELECT container.created_at, source.updated_at, property.created_at,
                            view.updated_at, block.created_at, profile.created_at
                     FROM database_containers container
                     JOIN data_sources source
                       ON source.home_database_block_id = container.block_id
                     JOIN data_source_properties property
                       ON property.data_source_id = source.id
                     JOIN database_views view
                       ON view.database_block_id = container.block_id
                     JOIN blocks block ON block.id = container.block_id
                     JOIN libraries library ON library.id = container.library_id
                     JOIN profiles profile ON profile.id = library.profile_id
                     WHERE container.block_id = 'database:timestamp'",
                    [],
                    |row| {
                        Ok([
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                        ])
                    },
                )?;
                assert_eq!(
                    timestamps,
                    ["2026-02-06T20:37:07.873Z"; 6].map(str::to_owned)
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT kind FROM database_views WHERE id = 'view:timestamp'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "list"
                );
                Ok::<_, StoreError>(())
            })
            .expect("verify canonical timestamps");
        drop(upgraded);

        let reopened = SqliteStoreKernel::open(&home).expect("reopen migrated v92 store");
        assert_eq!(reopened.preparation().migrated_from_version, None);
        assert!(reopened.preparation().migration_backup_path.is_none());
    }

    #[test]
    fn current_store_rejects_noncanonical_text_timestamp_drift() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v91_store_with_legacy_protocol_timestamps(&home);
        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v91 timestamp store");
        drop(upgraded);

        let connection = open_writer(&home.join("nodex.db")).expect("v92 writer");
        connection
            .execute(
                "UPDATE database_containers SET created_at = 'not-a-timestamp'
                 WHERE block_id = 'database:timestamp'",
                [],
            )
            .expect("inject timestamp drift");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert!(error.message.contains("database_containers.created_at"));
    }

    #[test]
    fn drifted_v86_store_fails_before_migration_is_announced() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v86_store(
            &home,
            r#"{"projectId":"migration-project","terminalSessionId":"terminal:legacy"}"#,
        );
        let connection = open_writer(&home.join("nodex.db")).expect("v86 writer");
        connection
            .execute("DROP TABLE project_session_tabs", [])
            .expect("drift v86 schema");
        drop(connection);

        let mut events = Vec::new();
        let error = SqliteStoreKernel::open_with_observer(&home, |event| events.push(event))
            .err()
            .expect("drifted v86 rejected");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert!(events.is_empty());
    }

    #[test]
    fn v87_projection_upgrade_sets_a_non_invented_replay_floor() {
        use crate::infrastructure::event_log::{CoreEventLog, CoreEventReplay};

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v86_store(
            &home,
            r#"{"projectId":"migration-project","terminalSessionId":"terminal:legacy"}"#,
        );
        let mut legacy = open_writer(&home.join("nodex.db")).expect("v86 writer");
        with_immediate_transaction(&mut legacy, |transaction| {
            ensure_v87_project_session_tabs_schema(transaction)?;
            transaction.execute(
                "INSERT INTO change_log( \
                   project_id, store_epoch, kind, operation_id, payload_json, committed_at \
                 ) VALUES ( \
                   'migration-project', 'epoch:legacy', 'project_workspace.changed', \
                   'legacy:event', \
                   '{\"module\":\"project_workspace\",\"kind\":\"workspace_changed\",\
                     \"projectIds\":[],\"sessionIds\":[],\"threadIds\":[],\
                     \"sessionSummaryScopes\":[],\"sessionDetailIds\":[]}', \
                   '2026-07-22T00:00:00Z')",
                [],
            )?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 87 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 87)?;
            Ok(())
        })
        .expect("seed v87 ledger");
        drop(legacy);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v87 Core store");
        let floor = upgraded
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT projection_event_v2_floor FROM core_store_metadata WHERE id = 1",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("projection replay floor");
        assert_eq!(floor, 2);
        assert!(matches!(
            CoreEventLog::new(upgraded.readers())
                .replay(0, None)
                .expect("legacy replay boundary"),
            CoreEventReplay::ResyncRequired {
                oldest_available: 2,
                event_head: 1,
                ..
            }
        ));
    }

    #[test]
    fn failed_v87_tab_rebuild_rolls_back_the_live_store_and_keeps_its_backup() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v86_store(&home, "not-json");

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::SqliteFailure);
        let live = open_writer(&home.join("nodex.db")).expect("live v86 store remains readable");
        assert_eq!(
            live.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("live version"),
            86
        );
        assert_eq!(
            live.query_row(
                "SELECT config_json FROM project_session_tabs \
                 WHERE id = 'migration-terminal'",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("legacy terminal config"),
            "not-json"
        );
        let backups = fs::read_dir(home.join("backups/core-migrations"))
            .expect("migration backup directory")
            .map(|entry| entry.expect("backup entry").path())
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        let backup = open_immutable_reader(&backups[0]).expect("migration backup opens");
        assert_eq!(
            backup
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("backup version"),
            86
        );
    }

    #[test]
    fn typescript_v84_migration_backs_up_validates_and_retires_wire_fingerprints() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_v84_page(&home);

        let kernel = SqliteStoreKernel::open(&home).expect("migrated Core store");
        let preparation = kernel.preparation();
        assert_eq!(preparation.migrated_from_version, Some(84));
        assert_eq!(preparation.validated_yjs_documents, 1);
        let backup_path = preparation
            .migration_backup_path
            .as_ref()
            .expect("migration backup");
        assert!(backup_path.is_file());
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        let backup_version: i64 = backup
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("backup version");
        assert_eq!(backup_version, 84);

        let evidence = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT metadata.schema_owner, metadata.store_format_version, \
                                document.head_seq, document.state_hash, \
                                EXISTS(SELECT 1 FROM sqlite_schema \
                                  WHERE type = 'table' AND name = 'document_engine_fingerprints') \
                         FROM core_store_metadata metadata \
                         JOIN documents document ON document.id = ?1 \
                         WHERE metadata.id = 1",
                        [DOCUMENT_ID],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, bool>(4)?,
                            ))
                        },
                    )
                    .map_err(StoreError::from)
            })
            .expect("migration evidence");
        assert_eq!(evidence.0, CORE_SCHEMA_OWNER);
        assert_eq!(evidence.1, CORE_SCHEMA_VERSION);
        assert_eq!(evidence.2, 1);
        assert!(evidence.3.is_empty());
        assert!(!evidence.4);
        let retired_search_objects = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'thread_search%'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("retired search object count");
        assert_eq!(retired_search_objects, 0);
        drop(kernel);

        let reopened = SqliteStoreKernel::open(&home).expect("reopen migrated store");
        assert!(reopened.preparation().migration_backup_path.is_none());
        assert_eq!(reopened.preparation().validated_yjs_documents, 0);
        let backups = fs::read_dir(home.join("backups/core-migrations"))
            .expect("backup directory")
            .count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn v97_migration_accepts_semantic_reconstruction_when_wire_fingerprint_differs() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_v84_page(&home);
        promote_v84_page_to_owned_v97(&home);
        let before = open_writer(&home.join("nodex.db"))
            .expect("v97 reader")
            .query_row(
                "SELECT generation, head_seq, state_vector FROM documents WHERE id = ?1",
                [DOCUMENT_ID],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
            .expect("v97 head");

        let kernel = SqliteStoreKernel::open(&home).expect("v98 migration");
        assert_eq!(kernel.preparation().migrated_from_version, Some(97));
        assert_eq!(kernel.preparation().validated_yjs_documents, 1);
        let backup_path = kernel
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v97 backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        assert_eq!(
            backup
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("backup version"),
            97
        );

        kernel
            .readers()
            .read_default(|connection| {
                let table_exists = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
                     WHERE type = 'table' AND name = 'document_engine_fingerprints')",
                    [],
                    |row| row.get::<_, bool>(0),
                )?;
                assert!(!table_exists);
                let head = DocumentReadRepository::new(connection)
                    .document_head(DOCUMENT_ID)?
                    .expect("migrated head");
                assert_eq!(
                    (head.generation, head.head_seq, &head.state_vector),
                    (before.0, before.1, &before.2)
                );
                assert!(head.state_hash.is_empty());
                reconstruct_yjs_engine(connection, &head)?;
                Ok(())
            })
            .expect("cold v98 reconstruction");
        drop(kernel);

        let reopened = SqliteStoreKernel::open(&home).expect("reopen v98");
        assert!(reopened.preparation().migration_backup_path.is_none());
        assert_eq!(reopened.preparation().validated_yjs_documents, 0);
    }

    #[test]
    fn owned_v84_store_is_not_reinterpreted_as_a_typescript_import() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_v84_page(&home);
        let connection = open_writer(&home.join("nodex.db")).expect("owned v84 writer");
        connection
            .execute_batch(V85_SCHEMA_SQL)
            .expect("ownership tables");
        connection
            .execute(
                "INSERT INTO core_store_metadata(\
                   id, schema_owner, store_format_version, migrated_from_version, \
                   migration_backup_name, migrated_at_unix_ms\
                 ) VALUES (1, ?1, 84, 84, 'v84-owned.db', 1)",
                [CORE_SCHEMA_OWNER],
            )
            .expect("ownership marker");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        assert!(!home.join("backups/core-migrations").exists());
    }

    #[test]
    fn v84_schema_drift_and_retired_thread_search_fail_before_backup() {
        for schema in [
            "CREATE TABLE unexpected_v84_object(id INTEGER PRIMARY KEY) STRICT;",
            "CREATE VIRTUAL TABLE thread_search USING fts5(body);",
        ] {
            let directory = tempdir().expect("Profile");
            let home = directory.path().canonicalize().expect("absolute Profile");
            seed_v84_page(&home);
            let connection = Connection::open(home.join("nodex.db")).expect("v84 store");
            connection.execute_batch(schema).expect("schema drift");
            drop(connection);

            let error = open_error(&home);
            assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
            assert!(!home.join("backups/core-migrations").exists());
            let connection = Connection::open(home.join("nodex.db")).expect("unchanged v84 store");
            let version: i64 = connection
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .expect("schema version");
            assert_eq!(version, TYPESCRIPT_SCHEMA_VERSION);
        }
    }

    #[test]
    fn current_schema_drift_fails_closed_instead_of_repairing() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current store");
        drop(kernel);

        let connection = Connection::open(home.join("nodex.db")).expect("current store");
        connection
            .execute("DROP TABLE core_reminder_leases", [])
            .expect("schema damage");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        let connection = Connection::open(home.join("nodex.db")).expect("damaged current store");
        let missing: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name = 'core_reminder_leases'",
                [],
                |row| row.get(0),
            )
            .expect("missing table count");
        assert_eq!(missing, 0);
    }

    #[test]
    fn writable_root_import_is_atomic_and_one_time() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_v84_page(&home);
        let connection = Connection::open(home.join("nodex.db")).expect("v84 store");
        connection
            .execute(
                "INSERT INTO codex_threads(\
                   thread_id, project_id, created_at, updated_at, linked_at\
                 ) VALUES ('thread-import', 'migration-project', 1, 1, '2026-07-18')",
                [],
            )
            .expect("legacy Thread");
        drop(connection);
        fs::write(
            home.join(LEGACY_WRITABLE_ROOTS_FILE_NAME),
            r#"{
              "thread-import": ["relative", "/workspace/a", "/workspace/a", "/workspace/b"],
              "missing-thread": ["/workspace/orphan"]
            }"#,
        )
        .expect("legacy writable root state");

        let kernel = SqliteStoreKernel::open(&home).expect("migrated store");
        let roots = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .prepare(
                        "SELECT root FROM codex_thread_writable_roots \
                         WHERE thread_id = 'thread-import' ORDER BY root_order",
                    )?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(StoreError::from)
            })
            .expect("imported roots");
        assert_eq!(roots, ["/workspace/a", "/workspace/b"]);
        drop(kernel);

        fs::write(
            home.join(LEGACY_WRITABLE_ROOTS_FILE_NAME),
            r#"{"thread-import":["/workspace/stale"]}"#,
        )
        .expect("stale legacy state");
        let reopened = SqliteStoreKernel::open(&home).expect("reopen migrated store");
        let roots = reopened
            .readers()
            .read_default(|connection| {
                connection
                    .prepare(
                        "SELECT root FROM codex_thread_writable_roots \
                         WHERE thread_id = 'thread-import' ORDER BY root_order",
                    )?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(StoreError::from)
            })
            .expect("one-time roots");
        assert_eq!(roots, ["/workspace/a", "/workspace/b"]);
        drop(reopened);
    }

    #[test]
    fn automation_runtime_schema_imports_jitter_salt_once() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_v84_page(&home);
        let connection = Connection::open(home.join("nodex.db")).expect("v84 store");
        connection
            .execute(
                "INSERT INTO codex_scheduled_automations(\
                   automation_id, kind, status, name, prompt, rrule, cwds_json, \
                   execution_environment, created_at, updated_at\
                 ) VALUES ('legacy-automation', 'cron', 'ACTIVE', 'Legacy', '', \
                   'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', '[\"/workspace\"]', 'worktree', 1, 1)",
                [],
            )
            .expect("legacy Automation mirror");
        connection
            .execute(
                "INSERT INTO codex_automation_runs(\
                   thread_id, automation_id, status, created_at, updated_at\
                 ) VALUES ('thread:legacy-run', 'legacy-automation', 'PENDING_REVIEW', 1, 1)",
                [],
            )
            .expect("legacy Automation run");
        drop(connection);
        fs::create_dir_all(home.join("automations")).expect("Automation directory");
        fs::write(
            home.join(AUTOMATION_JITTER_SALT_FILE),
            "legacy-jitter-salt\n",
        )
        .expect("legacy jitter salt");

        let kernel = SqliteStoreKernel::open(&home).expect("migrate Automation runtime");
        let runtime = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT automation.definition_revision, run.run_revision, metadata.jitter_salt \
                         FROM codex_scheduled_automations automation \
                         JOIN codex_automation_runs run \
                           ON run.automation_id = automation.automation_id \
                         CROSS JOIN core_automation_runtime_metadata metadata \
                         WHERE automation.automation_id = 'legacy-automation' AND metadata.id = 1",
                        [],
                        |row| {
                            Ok((
                                row.get::<_, i64>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, String>(2)?,
                            ))
                        },
                    )
                    .map_err(StoreError::from)
            })
            .expect("Automation runtime state");
        assert_eq!(runtime, (1, 1, "legacy-jitter-salt".to_owned()));
        drop(kernel);

        fs::write(
            home.join(AUTOMATION_JITTER_SALT_FILE),
            "stale-jitter-salt\n",
        )
        .expect("stale jitter salt");
        let reopened = SqliteStoreKernel::open(&home).expect("reopen Automation runtime");
        let runtime = reopened
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT metadata.jitter_salt, EXISTS( \
                           SELECT 1 FROM sqlite_schema \
                           WHERE type = 'table' AND name = 'core_reminder_leases' \
                         ) FROM core_automation_runtime_metadata metadata WHERE metadata.id = 1",
                        [],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
                    )
                    .map_err(StoreError::from)
            })
            .expect("persisted jitter salt");
        assert_eq!(runtime, ("legacy-jitter-salt".to_owned(), true));
        drop(reopened);
    }

    #[test]
    fn failed_document_validation_keeps_the_live_store_at_v84() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_v84_page(&home);
        let connection = Connection::open(home.join("nodex.db")).expect("v84 store");
        connection
            .execute(
                "UPDATE document_materializations SET nfm = 'corrupt projection' WHERE document_id = ?1",
                [DOCUMENT_ID],
            )
            .expect("corrupt projection");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        let connection = Connection::open(home.join("nodex.db")).expect("live v84 store");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("live version");
        assert_eq!(version, 84);
        let core_tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name = 'core_store_metadata'",
                [],
                |row| row.get(0),
            )
            .expect("Core table count");
        assert_eq!(core_tables, 0);
        assert_eq!(
            fs::read_dir(home.join("backups/core-migrations"))
                .expect("backup directory")
                .count(),
            1
        );
    }

    #[test]
    fn unsupported_store_versions_fail_before_publication() {
        for version in [83, CORE_SCHEMA_VERSION + 1] {
            let directory = tempdir().expect("Profile");
            let home = directory.path().canonicalize().expect("absolute Profile");
            let connection = Connection::open(home.join("nodex.db")).expect("store");
            connection
                .pragma_update(None, "user_version", version)
                .expect("set version");
            drop(connection);
            let error = open_error(&home);
            assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
            assert!(!home.join("backups/core-migrations").exists());
        }
    }
}
