use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::Mutex;
use std::sync::OnceLock;
#[cfg(test)]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, Utc};
#[cfg(test)]
use rusqlite::backup::Backup;
use rusqlite::{Connection, MAIN_DB, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use yrs::updates::decoder::Decode;
#[cfg(test)]
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, StateVector, Transact, Update};

#[cfg(test)]
use crate::database::create_database_authority_records;
use crate::database::{create_page_key_namespace, ensure_database_page_key};
use crate::document::{
    BlockDocumentSchema, CANVAS_SCENE_HASH_VERSION, CanvasHashItemKind, CanvasScene,
    DocumentMaterialization, MAX_DOCUMENT_UPDATE_BYTES, canvas_hash_bucket,
    canvas_semantic_intent_fingerprint, compute_canvas_scene_incremental_metadata,
    create_compatible_document, decode_block_document, decode_state_vector_v1,
    derive_canvas_element, has_pending_dependencies, load_v94_canvas_scene,
    materialize_decoded_document, read_legacy_project_owned_document_authority,
    rebuild_legacy_import_projections,
};
use crate::domain::fractional_rank::evenly_spaced_rank;
use crate::domain::project_appearance::{
    legacy_project_appearance, project_marker_color_literal, project_marker_icon_literal,
};
use nodex_core_contracts::database::{
    DatabaseViewField, DatabaseViewFieldInput, DatabaseViewFilter, DatabaseViewIntrinsicField,
    DatabaseViewPresentation, DatabaseViewPresentationOverrideInput,
};
use nodex_core_contracts::workspace::ProjectMarker;

use super::document_repository::{DocumentHeadRow, DocumentReadRepository};
use super::library_content_migration::{
    ensure_v117_library_content_ownership, ensure_v119_library_content_index_cleanup,
    validate_v117_library_content_ownership, validate_v119_library_content_index_cleanup,
};
use super::resource_grant_migration::{
    ensure_v118_canvas_resource_grants, validate_v118_canvas_resource_grants,
};
use super::schema::{
    CORE_SCHEMA_VERSION, SchemaInventory, TYPESCRIPT_SCHEMA_VERSION, install_v84_schema,
    read_schema_inventory, schema_inventory_fingerprint, v84_schema_objects_sql,
    validate_exact_v84_schema,
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
const LEGACY_P4_PRIORITY_ID: &str = "p4-later";
const LEGACY_P4_PRIORITY_NAME: &str = "P4 - Later";
const P3_PRIORITY_ID: &str = "p3-low";
const P3_PRIORITY_NAME: &str = "P3 - Low";

const V120_DOCUMENT_BLOCK_TOMBSTONES_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS document_block_tombstones (
  block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_generation INTEGER NOT NULL CHECK (document_generation >= 1),
  deletion_head_seq INTEGER NOT NULL CHECK (deletion_head_seq >= 1),
  placement_revision INTEGER NOT NULL CHECK (placement_revision >= 2),
  deleted_at TEXT NOT NULL,
  CHECK (length(block_id) BETWEEN 1 AND 512),
  CHECK (length(library_id) BETWEEN 1 AND 512),
  CHECK (length(document_id) BETWEEN 1 AND 512),
  CHECK (length(deleted_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_document_block_tombstones_document
  ON document_block_tombstones(document_id, deletion_head_seq, block_id);

CREATE TRIGGER IF NOT EXISTS document_block_tombstones_validate_insert
BEFORE INSERT ON document_block_tombstones BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM blocks block
    JOIN documents document ON document.id = NEW.document_id
    WHERE block.id = NEW.block_id
      AND block.library_id = NEW.library_id
      AND block.lifecycle = 'deleted'
      AND block.placement_revision = NEW.placement_revision
      AND block.type NOT IN (
        'page', 'database', 'synced_block_source',
        'reusable_template_source', 'canvas'
      )
      AND document.library_id = NEW.library_id
      AND document.generation = NEW.document_generation
      AND NEW.deletion_head_seq = document.head_seq + 1
  ) THEN RAISE(ABORT, 'document Block tombstone authority mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM document_block_index entry WHERE entry.block_id = NEW.block_id
  ) OR EXISTS (
    SELECT 1 FROM library_block_placements placement WHERE placement.block_id = NEW.block_id
  ) THEN RAISE(ABORT, 'placed Block cannot retain a Document tombstone') END;
END;

CREATE TRIGGER IF NOT EXISTS document_block_tombstones_are_immutable
BEFORE UPDATE ON document_block_tombstones BEGIN
  SELECT RAISE(ABORT, 'document Block tombstones are immutable');
END;

CREATE TABLE IF NOT EXISTS local_commit_relocation_obligations (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL,
  block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE RESTRICT,
  source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  PRIMARY KEY (store_epoch, commit_seq, block_id),
  FOREIGN KEY (store_epoch, commit_seq)
    REFERENCES local_commits(store_epoch, commit_seq) ON DELETE CASCADE,
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(block_id) BETWEEN 1 AND 512),
  CHECK (length(source_document_id) BETWEEN 1 AND 512)
) WITHOUT ROWID, STRICT;
"#;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredPriorityOption {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredPriorityConfig {
    options: Vec<StoredPriorityOption>,
}

#[derive(Clone, Debug)]
struct PrioritySourceState {
    current_ids: BTreeSet<String>,
    had_legacy_p4: bool,
}

#[derive(Clone, Debug)]
struct LegacyDatabaseViewRow {
    id: String,
    database_id: String,
    data_source_id: String,
    name: String,
    kind: String,
    config_json: String,
    revision: i64,
    rank_key: String,
    lifecycle: String,
    created_at: String,
}
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

const V112_DATABASE_VIEW_SCHEMA_SQL: &str = r#"
CREATE TABLE database_views_v112 (
  id TEXT PRIMARY KEY,
  database_block_id TEXT NOT NULL,
  data_source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  default_layout TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  rank_key TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (database_block_id)
    REFERENCES database_containers(block_id) ON DELETE CASCADE,
  FOREIGN KEY (data_source_id, database_block_id)
    REFERENCES data_sources(id, home_database_block_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (default_layout IN ('board', 'list')),
  CHECK (lifecycle IN ('active', 'deleted')),
  CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
) WITHOUT ROWID, STRICT;

CREATE TABLE database_view_page_positions_v112 (
  view_id TEXT NOT NULL,
  page_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  group_key TEXT,
  rank_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (view_id, page_block_id),
  FOREIGN KEY (view_id) REFERENCES database_views_v112(id) ON DELETE CASCADE
) WITHOUT ROWID, STRICT;

CREATE TABLE page_read_model_v112 (
  page_block_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  location_kind TEXT NOT NULL,
  containing_document_id TEXT,
  containing_database_id TEXT,
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
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (page_block_id, project_id)
    REFERENCES blocks(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (document_id, project_id)
    REFERENCES documents(id, project_id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (containing_document_id)
    REFERENCES documents(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (containing_database_id)
    REFERENCES database_containers(block_id) ON DELETE RESTRICT,
  FOREIGN KEY (membership_id)
    REFERENCES data_source_page_memberships(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (database_block_id)
    REFERENCES database_containers(block_id) ON DELETE RESTRICT,
  FOREIGN KEY (view_id)
    REFERENCES database_views_v112(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (lifecycle IN ('active', 'archived', 'deleted')),
  CHECK (location_kind IN ('space', 'document', 'database')),
  CHECK (
    (location_kind = 'space'
      AND containing_document_id IS NULL
      AND containing_database_id IS NULL)
    OR (location_kind = 'document'
      AND containing_document_id IS NOT NULL
      AND containing_database_id IS NULL)
    OR (location_kind = 'database'
      AND containing_document_id IS NULL
      AND containing_database_id IS NOT NULL)
  ),
  CHECK (document_authority IN ('legacy_shadow', 'ydoc_primary')),
  CHECK (
    (membership_id IS NULL AND database_block_id IS NULL)
    OR (membership_id IS NOT NULL AND database_block_id IS NOT NULL)
  ),
  CHECK (view_id IS NULL OR membership_id IS NOT NULL),
  CHECK (json_valid(database_values_json) AND json_type(database_values_json) = 'object'),
  CHECK (json_valid(intrinsic_properties_json) AND json_type(intrinsic_properties_json) = 'object'),
  CHECK (json_valid(property_revisions_json) AND json_type(property_revisions_json) = 'object'),
  CHECK (length(created_at) > 0 AND length(updated_at) > 0)
) WITHOUT ROWID, STRICT;
"#;

const V112_DATABASE_VIEW_INDEXES_AND_TRIGGERS_SQL: &str = r#"
CREATE INDEX idx_database_views_database_order
  ON database_views(database_block_id, lifecycle, rank_key, id);
CREATE INDEX idx_database_views_source
  ON database_views(data_source_id, lifecycle, id);
CREATE INDEX idx_database_view_page_positions_order
  ON database_view_page_positions(view_id, group_key, rank_key, page_block_id);
CREATE INDEX idx_page_read_model_project_lifecycle
  ON page_read_model(project_id, lifecycle, page_block_id);
CREATE INDEX idx_page_read_model_view_order
  ON page_read_model(view_id, view_group_key, view_rank_key, page_block_id)
  WHERE view_id IS NOT NULL;
CREATE INDEX idx_page_read_model_document_freshness
  ON page_read_model(document_id, document_generation, document_projected_seq);

CREATE TRIGGER database_containers_default_view_is_owned_insert
BEFORE INSERT ON database_containers
WHEN NEW.default_view_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM database_views view
    WHERE view.id = NEW.default_view_id
      AND view.database_block_id = NEW.block_id
      AND view.lifecycle = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'Database default View must be active and owned by its Container');
END;

CREATE TRIGGER database_containers_default_view_is_owned_update
BEFORE UPDATE OF default_view_id, block_id ON database_containers
WHEN NEW.default_view_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM database_views view
    WHERE view.id = NEW.default_view_id
      AND view.database_block_id = NEW.block_id
      AND view.lifecycle = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'Database default View must be active and owned by its Container');
END;

CREATE TRIGGER database_views_preserve_container_default_update
BEFORE UPDATE OF database_block_id, lifecycle ON database_views
WHEN EXISTS (
  SELECT 1 FROM database_containers container
  WHERE container.default_view_id = OLD.id
    AND (NEW.database_block_id <> container.block_id OR NEW.lifecycle <> 'active')
)
BEGIN
  SELECT RAISE(ABORT, 'A Database default View must remain active and owned');
END;

CREATE TRIGGER database_views_preserve_container_default_delete
BEFORE DELETE ON database_views
WHEN EXISTS (
  SELECT 1 FROM database_containers container
  WHERE container.default_view_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'A Database default View cannot be deleted');
END;

CREATE TRIGGER database_view_page_positions_require_active_membership_insert
BEFORE INSERT ON database_view_page_positions
WHEN NOT EXISTS (
  SELECT 1
  FROM database_views view
  INNER JOIN data_source_page_memberships membership
    ON membership.data_source_id = view.data_source_id
   AND membership.page_block_id = NEW.page_block_id
   AND membership.removed_at IS NULL
  WHERE view.id = NEW.view_id
)
BEGIN
  SELECT RAISE(ABORT, 'Database View position requires active Source membership');
END;

CREATE TRIGGER database_view_page_positions_require_active_membership_update
BEFORE UPDATE OF view_id, page_block_id ON database_view_page_positions
WHEN NOT EXISTS (
  SELECT 1
  FROM database_views view
  INNER JOIN data_source_page_memberships membership
    ON membership.data_source_id = view.data_source_id
   AND membership.page_block_id = NEW.page_block_id
   AND membership.removed_at IS NULL
  WHERE view.id = NEW.view_id
)
BEGIN
  SELECT RAISE(ABORT, 'Database View position requires active Source membership');
END;

CREATE TRIGGER page_read_model_validate_insert
BEFORE INSERT ON page_read_model
WHEN NOT EXISTS (
  SELECT 1 FROM blocks page
  WHERE page.id = NEW.page_block_id
    AND page.project_id = NEW.project_id
    AND page.type = 'page'
) OR (
  NEW.membership_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM data_source_page_memberships membership
    INNER JOIN data_sources source ON source.id = membership.data_source_id
    WHERE membership.id = NEW.membership_id
      AND membership.page_block_id = NEW.page_block_id
      AND membership.removed_at IS NULL
      AND source.home_database_block_id = NEW.database_block_id
  )
) OR (
  NEW.view_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM database_views view
    INNER JOIN data_source_page_memberships membership
      ON membership.id = NEW.membership_id
     AND membership.data_source_id = view.data_source_id
    WHERE view.id = NEW.view_id
      AND view.database_block_id = NEW.database_block_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
END;

CREATE TRIGGER page_read_model_validate_update
BEFORE UPDATE ON page_read_model
WHEN NOT EXISTS (
  SELECT 1 FROM blocks page
  WHERE page.id = NEW.page_block_id
    AND page.project_id = NEW.project_id
    AND page.type = 'page'
) OR (
  NEW.membership_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM data_source_page_memberships membership
    INNER JOIN data_sources source ON source.id = membership.data_source_id
    WHERE membership.id = NEW.membership_id
      AND membership.page_block_id = NEW.page_block_id
      AND membership.removed_at IS NULL
      AND source.home_database_block_id = NEW.database_block_id
  )
) OR (
  NEW.view_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM database_views view
    INNER JOIN data_source_page_memberships membership
      ON membership.id = NEW.membership_id
     AND membership.data_source_id = view.data_source_id
    WHERE view.id = NEW.view_id
      AND view.database_block_id = NEW.database_block_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Page read model source coordinates are invalid or stale');
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

const V100_RELATION_PROPERTIES_SCHEMA_SQL: &str = r#"
CREATE TABLE data_source_properties_v100 (
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  value_type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  rank_key TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active',
  schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (data_source_id, id),
  CHECK (length(id) BETWEEN 1 AND 128),
  CHECK (length(name) BETWEEN 1 AND 256),
  CHECK (value_type IN (
    'text', 'number', 'checkbox', 'select', 'multi_select',
    'date', 'datetime', 'person', 'relation'
  )),
  CHECK (lifecycle IN ('active', 'deleted')),
  CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
) WITHOUT ROWID;

CREATE TABLE data_source_property_values_v100 (
  data_source_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (data_source_id, membership_id, property_id),
  FOREIGN KEY (membership_id, data_source_id)
    REFERENCES data_source_page_memberships(id, data_source_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (data_source_id, property_id)
    REFERENCES data_source_properties_v100(data_source_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (value_type IN (
    'text', 'number', 'checkbox', 'select', 'multi_select',
    'date', 'datetime', 'person', 'relation'
  )),
  CHECK (json_valid(value_json)),
  CHECK (value_type <> 'relation' OR json_type(value_json) = 'null')
) WITHOUT ROWID;

INSERT INTO data_source_properties_v100(
  data_source_id, id, name, value_type, config_json, rank_key, lifecycle,
  schema_revision, created_at, updated_at
)
SELECT
  data_source_id, id, name, value_type, config_json, rank_key, lifecycle,
  schema_revision, created_at, updated_at
FROM data_source_properties;

INSERT INTO data_source_property_values_v100(
  data_source_id, membership_id, property_id, value_type, value_json,
  revision, updated_at
)
SELECT
  data_source_id, membership_id, property_id, value_type, value_json,
  revision, updated_at
FROM data_source_property_values;

DROP TRIGGER data_source_property_values_require_matching_type_insert;
DROP TRIGGER data_source_property_values_require_matching_type_update;
DROP INDEX idx_data_source_properties_order;
DROP INDEX idx_data_source_property_values_property;

ALTER TABLE data_source_property_values RENAME TO data_source_property_values_v99;
ALTER TABLE data_source_properties RENAME TO data_source_properties_v99;
ALTER TABLE data_source_properties_v100 RENAME TO data_source_properties;
ALTER TABLE data_source_property_values_v100 RENAME TO data_source_property_values;

DROP TABLE data_source_property_values_v99;
DROP TABLE data_source_properties_v99;

CREATE INDEX idx_data_source_properties_order
  ON data_source_properties(data_source_id, lifecycle, rank_key, id);

CREATE INDEX idx_data_source_property_values_property
  ON data_source_property_values(data_source_id, property_id, membership_id);

CREATE TRIGGER data_source_property_values_require_matching_type_insert
BEFORE INSERT ON data_source_property_values
WHEN NOT EXISTS (
  SELECT 1 FROM data_source_properties property
  WHERE property.data_source_id = NEW.data_source_id
    AND property.id = NEW.property_id
    AND property.value_type = NEW.value_type
    AND property.lifecycle = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
END;

CREATE TRIGGER data_source_property_values_require_matching_type_update
BEFORE UPDATE OF data_source_id, property_id, value_type
ON data_source_property_values
WHEN NOT EXISTS (
  SELECT 1 FROM data_source_properties property
  WHERE property.data_source_id = NEW.data_source_id
    AND property.id = NEW.property_id
    AND property.value_type = NEW.value_type
    AND property.lifecycle = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
END;

CREATE TABLE data_source_relation_properties (
  data_source_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  target_data_source_id TEXT NOT NULL,
  PRIMARY KEY (data_source_id, property_id),
  FOREIGN KEY (data_source_id, property_id)
    REFERENCES data_source_properties(data_source_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (target_data_source_id)
    REFERENCES data_sources(id)
    ON UPDATE CASCADE ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
) WITHOUT ROWID, STRICT;

CREATE TABLE data_source_relation_edges (
  source_data_source_id TEXT NOT NULL,
  source_membership_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  target_page_block_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    source_data_source_id,
    source_membership_id,
    property_id,
    target_page_block_id
  ),
  FOREIGN KEY (source_data_source_id, property_id)
    REFERENCES data_source_relation_properties(data_source_id, property_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (source_data_source_id, source_membership_id, property_id)
    REFERENCES data_source_property_values(
      data_source_id,
      membership_id,
      property_id
    ) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (target_page_block_id)
    REFERENCES blocks(id)
    ON UPDATE CASCADE ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (length(created_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_data_source_relation_properties_target
  ON data_source_relation_properties(
    target_data_source_id,
    data_source_id,
    property_id
  );

CREATE INDEX idx_data_source_relation_edges_property_target
  ON data_source_relation_edges(
    source_data_source_id,
    property_id,
    target_page_block_id,
    source_membership_id
  );

CREATE INDEX idx_data_source_relation_edges_target
  ON data_source_relation_edges(
    target_page_block_id,
    source_data_source_id,
    property_id,
    source_membership_id
  );

CREATE TRIGGER data_source_relation_properties_validate_insert
BEFORE INSERT ON data_source_relation_properties
WHEN NOT EXISTS (
  SELECT 1
  FROM data_source_properties property
  JOIN data_sources source ON source.id = property.data_source_id
  JOIN data_sources target ON target.id = NEW.target_data_source_id
  WHERE property.data_source_id = NEW.data_source_id
    AND property.id = NEW.property_id
    AND property.value_type = 'relation'
    AND property.config_json = '{}'
    AND property.lifecycle = 'active'
    AND source.lifecycle = 'active'
    AND target.lifecycle = 'active'
    AND source.library_id = target.library_id
)
BEGIN
  SELECT RAISE(ABORT, 'Relation Property must target an active Data Source in the same Library');
END;

CREATE TRIGGER data_source_relation_properties_are_immutable
BEFORE UPDATE ON data_source_relation_properties
BEGIN
  SELECT RAISE(ABORT, 'Relation Property target is immutable');
END;

CREATE TRIGGER data_source_relation_property_type_is_stable
BEFORE UPDATE OF value_type ON data_source_properties
WHEN NEW.value_type <> 'relation'
  AND EXISTS (
    SELECT 1 FROM data_source_relation_properties relation
    WHERE relation.data_source_id = OLD.data_source_id
      AND relation.property_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'Relation Property type is immutable');
END;

CREATE TRIGGER data_source_relation_edges_validate_insert
BEFORE INSERT ON data_source_relation_edges
WHEN NOT EXISTS (
  SELECT 1
  FROM data_source_relation_properties relation
  JOIN data_source_property_values value
    ON value.data_source_id = NEW.source_data_source_id
    AND value.membership_id = NEW.source_membership_id
    AND value.property_id = NEW.property_id
  JOIN blocks target_block ON target_block.id = NEW.target_page_block_id
  JOIN pages target_page ON target_page.block_id = target_block.id
  JOIN data_source_page_memberships target_membership
    ON target_membership.page_block_id = target_block.id
    AND target_membership.data_source_id = relation.target_data_source_id
    AND target_membership.removed_at IS NULL
  WHERE relation.data_source_id = NEW.source_data_source_id
    AND relation.property_id = NEW.property_id
    AND value.value_type = 'relation'
    AND json_type(value.value_json) = 'null'
    AND target_block.type = 'page'
    AND target_block.lifecycle = 'active'
    AND target_page.lifecycle = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'Relation edge requires an active target Page in the configured Data Source');
END;

CREATE TRIGGER data_source_relation_edges_are_immutable
BEFORE UPDATE ON data_source_relation_edges
BEGIN
  SELECT RAISE(ABORT, 'Relation edge identity is immutable');
END;
"#;

const V101_PROJECTLESS_PERMISSION_MODE_SCHEMA_SQL: &str = r#"
CREATE TABLE codex_projectless_permission_mode_selection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (mode IN ('auto', 'guardian-approvals', 'full-access', 'custom')),
  CHECK (length(updated_at) > 0)
) WITHOUT ROWID, STRICT;
"#;

const V102_LOCAL_COMMIT_SCHEMA_SQL: &str = r#"
CREATE TABLE local_commits (
  commit_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  store_epoch TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  projection_impact_json TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  UNIQUE (store_epoch, operation_id),
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(operation_id) BETWEEN 1 AND 512),
  CHECK (length(committed_at) > 0),
  CHECK (json_valid(projection_impact_json) AND json_type(projection_impact_json) = 'object'),
  CHECK (length(canonical_hash) = 64 AND canonical_hash NOT GLOB '*[^0-9a-f]*')
) STRICT;

CREATE TABLE local_commit_effects (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL REFERENCES local_commits(commit_seq) ON DELETE CASCADE,
  effect_order INTEGER NOT NULL CHECK (effect_order >= 0),
  change_log_seq INTEGER NOT NULL REFERENCES change_log(seq) ON DELETE RESTRICT,
  PRIMARY KEY (store_epoch, commit_seq, effect_order),
  UNIQUE (change_log_seq),
  CHECK (length(store_epoch) BETWEEN 1 AND 512)
) WITHOUT ROWID, STRICT;

CREATE TABLE local_commit_documents (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL REFERENCES local_commits(commit_seq) ON DELETE CASCADE,
  -- This is an immutable historical reference. It must remain readable after
  -- the document itself has been deleted or compacted.
  document_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
  update_id TEXT,
  update_hash TEXT,
  PRIMARY KEY (store_epoch, commit_seq, document_id, generation, head_seq),
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(document_id) BETWEEN 1 AND 512),
  CHECK (update_id IS NULL OR length(update_id) BETWEEN 1 AND 512),
  CHECK (update_hash IS NULL OR (length(update_hash) = 64 AND update_hash NOT GLOB '*[^0-9a-f]*'))
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_local_commits_epoch_seq
  ON local_commits(store_epoch, commit_seq);

CREATE INDEX idx_local_commit_effects_change_log
  ON local_commit_effects(change_log_seq);

CREATE INDEX idx_local_commit_documents_document
  ON local_commit_documents(document_id, generation, head_seq);

ALTER TABLE core_module_receipts
  ADD COLUMN local_commit_seq INTEGER REFERENCES local_commits(commit_seq);

CREATE INDEX idx_core_module_receipts_local_commit
  ON core_module_receipts(local_commit_seq);
"#;

const V103_LOCAL_COMMIT_COMPOSITE_IDENTITY_SCHEMA_SQL: &str = r#"
CREATE TABLE local_commits_v103 (
  commit_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  store_epoch TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  projection_impact_json TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  UNIQUE (store_epoch, commit_seq),
  UNIQUE (store_epoch, operation_id),
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(operation_id) BETWEEN 1 AND 512),
  CHECK (length(committed_at) > 0),
  CHECK (json_valid(projection_impact_json) AND json_type(projection_impact_json) = 'object'),
  CHECK (length(canonical_hash) = 64 AND canonical_hash NOT GLOB '*[^0-9a-f]*')
) STRICT;

INSERT INTO local_commits_v103(
  commit_seq, store_epoch, operation_id, committed_at,
  projection_impact_json, canonical_hash
)
SELECT commit_seq, store_epoch, operation_id, committed_at,
       projection_impact_json, canonical_hash
FROM local_commits;

CREATE TABLE local_commit_effects_v103 (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL,
  effect_order INTEGER NOT NULL CHECK (effect_order >= 0),
  change_log_seq INTEGER NOT NULL REFERENCES change_log(seq) ON DELETE RESTRICT,
  PRIMARY KEY (store_epoch, commit_seq, effect_order),
  UNIQUE (change_log_seq),
  FOREIGN KEY (store_epoch, commit_seq)
    REFERENCES local_commits_v103(store_epoch, commit_seq) ON DELETE CASCADE,
  CHECK (length(store_epoch) BETWEEN 1 AND 512)
) WITHOUT ROWID, STRICT;

INSERT INTO local_commit_effects_v103(
  store_epoch, commit_seq, effect_order, change_log_seq
)
SELECT store_epoch, commit_seq, effect_order, change_log_seq
FROM local_commit_effects;

CREATE TABLE local_commit_documents_v103 (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL,
  -- This is an immutable historical reference. It must remain readable after
  -- the document itself has been deleted or compacted.
  document_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
  update_id TEXT,
  update_hash TEXT,
  PRIMARY KEY (store_epoch, commit_seq, document_id, generation, head_seq),
  FOREIGN KEY (store_epoch, commit_seq)
    REFERENCES local_commits_v103(store_epoch, commit_seq) ON DELETE CASCADE,
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(document_id) BETWEEN 1 AND 512),
  CHECK (update_id IS NULL OR length(update_id) BETWEEN 1 AND 512),
  CHECK (update_hash IS NULL OR (length(update_hash) = 64 AND update_hash NOT GLOB '*[^0-9a-f]*'))
) WITHOUT ROWID, STRICT;

CREATE TABLE core_module_receipts_v103 (
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
  local_commit_seq INTEGER,
  committed_at TEXT NOT NULL,
  PRIMARY KEY (module_name, operation_id),
  FOREIGN KEY (store_epoch, local_commit_seq)
    REFERENCES local_commits_v103(store_epoch, commit_seq),
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

INSERT INTO core_module_receipts_v103(
  module_name, operation_id, profile_id, project_id, adapter_kind,
  operation_kind, store_epoch, request_hash, result_json, event_sequence,
  local_commit_seq, committed_at
)
SELECT module_name, operation_id, profile_id, project_id, adapter_kind,
       operation_kind, store_epoch, request_hash, result_json, event_sequence,
       local_commit_seq, committed_at
FROM core_module_receipts;

DROP INDEX IF EXISTS idx_core_module_receipts_local_commit;
DROP INDEX IF EXISTS idx_local_commit_documents_document;
DROP INDEX IF EXISTS idx_local_commit_effects_change_log;
DROP INDEX IF EXISTS idx_local_commits_epoch_seq;
DROP TABLE core_module_receipts;
DROP TABLE local_commit_documents;
DROP TABLE local_commit_effects;
DROP TABLE local_commits;

ALTER TABLE local_commits_v103 RENAME TO local_commits;
ALTER TABLE local_commit_effects_v103 RENAME TO local_commit_effects;
ALTER TABLE local_commit_documents_v103 RENAME TO local_commit_documents;
ALTER TABLE core_module_receipts_v103 RENAME TO core_module_receipts;

CREATE INDEX idx_local_commits_epoch_seq
  ON local_commits(store_epoch, commit_seq);

CREATE INDEX idx_local_commit_effects_change_log
  ON local_commit_effects(change_log_seq);

CREATE INDEX idx_local_commit_documents_document
  ON local_commit_documents(document_id, generation, head_seq);

CREATE INDEX idx_core_module_receipts_local_commit
  ON core_module_receipts(store_epoch, local_commit_seq);
"#;

const V105_LOCAL_COMMIT_MANIFEST_SCHEMA_SQL: &str = r#"
ALTER TABLE local_commits ADD COLUMN intent_hash TEXT NOT NULL
  DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (length(intent_hash) = 64 AND intent_hash NOT GLOB '*[^0-9a-f]*');
ALTER TABLE local_commits ADD COLUMN projection_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(projection_json) AND json_type(projection_json) = 'object');
ALTER TABLE local_commits ADD COLUMN receipt_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(receipt_json) AND json_type(receipt_json) = 'object');
ALTER TABLE local_commits ADD COLUMN audience_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(audience_json) AND json_type(audience_json) = 'object');
ALTER TABLE local_commits ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0
  CHECK (finalized IN (0, 1));

ALTER TABLE local_commit_effects ADD COLUMN module_name TEXT NOT NULL DEFAULT 'library'
  CHECK (module_name IN (
    'library', 'database', 'owned_document', 'project_workspace',
    'automation', 'store_administration'
  ));
ALTER TABLE local_commit_effects ADD COLUMN effect_kind TEXT NOT NULL DEFAULT 'historical';
ALTER TABLE local_commit_effects ADD COLUMN project_id TEXT NOT NULL DEFAULT 'historical';
ALTER TABLE local_commit_effects ADD COLUMN resources_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(resources_json) AND json_type(resources_json) = 'object');
ALTER TABLE local_commit_effects ADD COLUMN payload_hash TEXT NOT NULL
  DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*');
ALTER TABLE local_commit_effects ADD COLUMN projection_impact_json TEXT NOT NULL DEFAULT '{}'
  CHECK (
    json_valid(projection_impact_json)
    AND json_type(projection_impact_json) = 'object'
  );

ALTER TABLE local_commit_documents ADD COLUMN document_order INTEGER NOT NULL DEFAULT 0
  CHECK (document_order >= 0);
ALTER TABLE local_commit_documents ADD COLUMN project_id TEXT NOT NULL DEFAULT 'historical';
ALTER TABLE local_commit_documents ADD COLUMN page_id TEXT;
ALTER TABLE local_commit_documents ADD COLUMN base_head_seq INTEGER NOT NULL DEFAULT 0
  CHECK (base_head_seq >= 0);
ALTER TABLE local_commit_documents ADD COLUMN update_byte_length INTEGER NOT NULL DEFAULT 0
  CHECK (update_byte_length >= 0);

CREATE INDEX idx_local_commit_documents_commit_order
  ON local_commit_documents(store_epoch, commit_seq, document_order);
"#;

const V106_PROJECTION_SCOPE_HEAD_SCHEMA_SQL: &str = r#"
ALTER TABLE local_commits ADD COLUMN manifest_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(manifest_json) AND json_type(manifest_json) = 'object');

CREATE TABLE projection_scope_heads (
  store_epoch TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  scope_schema_version INTEGER NOT NULL CHECK (scope_schema_version >= 1),
  scope_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  covered_commit_seq INTEGER NOT NULL CHECK (covered_commit_seq >= 1),
  effect_hash TEXT NOT NULL,
  PRIMARY KEY (store_epoch, scope_key),
  FOREIGN KEY (store_epoch, covered_commit_seq)
    REFERENCES local_commits(store_epoch, commit_seq) ON DELETE RESTRICT,
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(scope_key) BETWEEN 1 AND 128),
  CHECK (json_valid(scope_json) AND json_type(scope_json) = 'object'),
  CHECK (length(effect_hash) = 64 AND effect_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_projection_scope_heads_commit
  ON projection_scope_heads(store_epoch, covered_commit_seq);
"#;

const V107_BLOCK_PROJECT_CASCADE_INDEXES_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS idx_block_search_units_owner
  ON block_search_units(owner_block_id, project_id);

CREATE INDEX IF NOT EXISTS idx_block_search_units_block
  ON block_search_units(block_id, project_id);

CREATE INDEX IF NOT EXISTS idx_block_asset_refs_block
  ON block_asset_refs(block_id, project_id);

CREATE INDEX IF NOT EXISTS idx_block_asset_refs_owner
  ON block_asset_refs(owner_block_id, project_id);
"#;

const V108_LOCAL_COMMIT_REVOCATIONS_SCHEMA_SQL: &str = r#"
CREATE TABLE local_commit_revocations (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL,
  scope_key TEXT NOT NULL,
  authorization_scope_json TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (
    store_epoch, commit_seq, scope_key, resource_kind, resource_id
  ),
  FOREIGN KEY (store_epoch, commit_seq)
    REFERENCES local_commits(store_epoch, commit_seq) ON DELETE CASCADE,
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(scope_key) BETWEEN 1 AND 1600),
  CHECK (
    json_valid(authorization_scope_json)
    AND json_type(authorization_scope_json) = 'object'
  ),
  CHECK (resource_kind IN ('page', 'document', 'database', 'data_source', 'view', 'canvas')),
  CHECK (length(resource_id) BETWEEN 1 AND 512),
  CHECK (reason IN ('ownership_moved', 'access_revoked', 'archived', 'deleted'))
) WITHOUT ROWID, STRICT;
"#;

const V109_LOCAL_COMMIT_DELIVERY_ATOMS_SCHEMA_SQL: &str = r#"
CREATE TABLE local_commit_delivery_atoms (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL,
  atom_order INTEGER NOT NULL CHECK (atom_order >= 0),
  atom_id TEXT NOT NULL,
  atom_kind TEXT NOT NULL,
  required_resources_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (store_epoch, commit_seq, atom_order),
  UNIQUE (store_epoch, commit_seq, atom_id),
  FOREIGN KEY (store_epoch, commit_seq)
    REFERENCES local_commits(store_epoch, commit_seq) ON DELETE CASCADE,
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(atom_id) = 64 AND atom_id NOT GLOB '*[^0-9a-f]*'),
  CHECK (atom_kind IN (
    'library_navigation_changed',
    'database_changed',
    'owned_document_changed',
    'project_workspace_changed',
    'automation_changed',
    'store_administration_changed'
  )),
  CHECK (
    json_valid(required_resources_json)
    AND json_type(required_resources_json) = 'array'
    AND json_array_length(required_resources_json) > 0
  ),
  CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_local_commit_delivery_atoms_id
  ON local_commit_delivery_atoms(atom_id);
"#;

const V110_LOCAL_COMMIT_LIBRARY_EFFECTS_SCHEMA_SQL: &str = r#"
CREATE TABLE local_commit_library_effects (
  store_epoch TEXT NOT NULL,
  commit_seq INTEGER NOT NULL,
  effect_order INTEGER NOT NULL CHECK (effect_order >= 0),
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  module_name TEXT NOT NULL CHECK (module_name = 'store_administration'),
  effect_kind TEXT NOT NULL CHECK (effect_kind = 'store_administration.changed'),
  operation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (store_epoch, commit_seq, effect_order),
  FOREIGN KEY (store_epoch, commit_seq)
    REFERENCES local_commits(store_epoch, commit_seq) ON DELETE CASCADE,
  CHECK (length(store_epoch) BETWEEN 1 AND 512),
  CHECK (length(library_id) BETWEEN 1 AND 512),
  CHECK (length(operation_id) BETWEEN 1 AND 512),
  CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*')
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_local_commit_library_effects_library
  ON local_commit_library_effects(library_id, commit_seq);
"#;

const V109_PROPERTY_SEMANTICS_SCHEMA_SQL: &str = r#"
CREATE TABLE data_source_properties_v109 (
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  value_type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  rank_key TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'active',
  schema_revision INTEGER NOT NULL DEFAULT 1 CHECK (schema_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (data_source_id, id),
  CHECK (length(id) BETWEEN 1 AND 128),
  CHECK (length(name) BETWEEN 1 AND 256),
  CHECK (value_type IN (
    'text', 'number', 'checkbox', 'select', 'multi_select',
    'date', 'datetime', 'relation'
  )),
  CHECK (lifecycle IN ('active', 'deleted')),
  CHECK (json_valid(config_json) AND json_type(config_json) = 'object')
) WITHOUT ROWID;

CREATE TABLE data_source_property_values_v109 (
  data_source_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (data_source_id, membership_id, property_id),
  FOREIGN KEY (membership_id, data_source_id)
    REFERENCES data_source_page_memberships(id, data_source_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (data_source_id, property_id)
    REFERENCES data_source_properties_v109(data_source_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (value_type IN (
    'text', 'number', 'checkbox', 'select', 'multi_select',
    'date', 'datetime', 'relation'
  )),
  CHECK (json_valid(value_json)),
  CHECK (value_type <> 'relation' OR json_type(value_json) = 'null')
) WITHOUT ROWID;

CREATE TABLE data_source_relation_properties_v109 (
  data_source_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  target_data_source_id TEXT NOT NULL,
  PRIMARY KEY (data_source_id, property_id),
  FOREIGN KEY (data_source_id, property_id)
    REFERENCES data_source_properties_v109(data_source_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (target_data_source_id)
    REFERENCES data_sources(id)
    ON UPDATE CASCADE ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
) WITHOUT ROWID, STRICT;

CREATE TABLE data_source_relation_edges_v109 (
  edge_id TEXT NOT NULL UNIQUE,
  source_data_source_id TEXT NOT NULL,
  source_membership_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  target_page_block_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    source_data_source_id,
    source_membership_id,
    property_id,
    target_page_block_id
  ),
  FOREIGN KEY (source_data_source_id, property_id)
    REFERENCES data_source_relation_properties_v109(data_source_id, property_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (source_data_source_id, source_membership_id, property_id)
    REFERENCES data_source_property_values_v109(
      data_source_id,
      membership_id,
      property_id
    ) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (target_page_block_id)
    REFERENCES blocks(id)
    ON UPDATE CASCADE ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (length(edge_id) = 64 AND edge_id NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(created_at) > 0)
) WITHOUT ROWID, STRICT;

INSERT INTO data_source_properties_v109(
  data_source_id, id, name, value_type, config_json, rank_key, lifecycle,
  schema_revision, created_at, updated_at
)
SELECT
  data_source_id,
  id,
  name,
  CASE value_type WHEN 'person' THEN 'text' ELSE value_type END,
  config_json,
  rank_key,
  lifecycle,
  schema_revision,
  created_at,
  updated_at
FROM data_source_properties;

INSERT INTO data_source_property_values_v109(
  data_source_id, membership_id, property_id, value_type, value_json,
  revision, updated_at
)
SELECT
  data_source_id,
  membership_id,
  property_id,
  CASE value_type WHEN 'person' THEN 'text' ELSE value_type END,
  value_json,
  revision,
  updated_at
FROM data_source_property_values;

INSERT INTO data_source_relation_properties_v109(
  data_source_id, property_id, target_data_source_id
)
SELECT data_source_id, property_id, target_data_source_id
FROM data_source_relation_properties;

INSERT INTO data_source_relation_edges_v109(
  edge_id,
  source_data_source_id,
  source_membership_id,
  property_id,
  target_page_block_id,
  created_at
)
SELECT
  lower(hex(randomblob(32))),
  source_data_source_id,
  source_membership_id,
  property_id,
  target_page_block_id,
  created_at
FROM data_source_relation_edges;

DROP TRIGGER data_source_property_values_require_matching_type_insert;
DROP TRIGGER data_source_property_values_require_matching_type_update;
DROP TRIGGER data_source_relation_properties_validate_insert;
DROP TRIGGER data_source_relation_properties_are_immutable;
DROP TRIGGER data_source_relation_property_type_is_stable;
DROP TRIGGER data_source_relation_edges_validate_insert;
DROP TRIGGER data_source_relation_edges_are_immutable;

DROP INDEX idx_data_source_properties_order;
DROP INDEX idx_data_source_property_values_property;
DROP INDEX idx_data_source_relation_properties_target;
DROP INDEX idx_data_source_relation_edges_property_target;
DROP INDEX idx_data_source_relation_edges_target;

ALTER TABLE data_source_relation_edges RENAME TO data_source_relation_edges_v108;
ALTER TABLE data_source_relation_properties RENAME TO data_source_relation_properties_v108;
ALTER TABLE data_source_property_values RENAME TO data_source_property_values_v108;
ALTER TABLE data_source_properties RENAME TO data_source_properties_v108;

ALTER TABLE data_source_properties_v109 RENAME TO data_source_properties;
ALTER TABLE data_source_property_values_v109 RENAME TO data_source_property_values;
ALTER TABLE data_source_relation_properties_v109 RENAME TO data_source_relation_properties;
ALTER TABLE data_source_relation_edges_v109 RENAME TO data_source_relation_edges;

DROP TABLE data_source_relation_edges_v108;
DROP TABLE data_source_relation_properties_v108;
DROP TABLE data_source_property_values_v108;
DROP TABLE data_source_properties_v108;

CREATE INDEX idx_data_source_properties_order
  ON data_source_properties(data_source_id, lifecycle, rank_key, id);

CREATE INDEX idx_data_source_property_values_property
  ON data_source_property_values(data_source_id, property_id, membership_id);

CREATE INDEX idx_data_source_relation_properties_target
  ON data_source_relation_properties(
    target_data_source_id,
    data_source_id,
    property_id
  );

CREATE INDEX idx_data_source_relation_edges_property_target
  ON data_source_relation_edges(
    source_data_source_id,
    property_id,
    target_page_block_id,
    source_membership_id
  );

CREATE INDEX idx_data_source_relation_edges_target
  ON data_source_relation_edges(
    target_page_block_id,
    source_data_source_id,
    property_id,
    source_membership_id
  );

CREATE TRIGGER data_source_property_values_require_matching_type_insert
BEFORE INSERT ON data_source_property_values
WHEN NOT EXISTS (
  SELECT 1 FROM data_source_properties property
  WHERE property.data_source_id = NEW.data_source_id
    AND property.id = NEW.property_id
    AND property.value_type = NEW.value_type
    AND property.lifecycle = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
END;

CREATE TRIGGER data_source_property_values_require_matching_type_update
BEFORE UPDATE OF data_source_id, property_id, value_type
ON data_source_property_values
WHEN NOT EXISTS (
  SELECT 1 FROM data_source_properties property
  WHERE property.data_source_id = NEW.data_source_id
    AND property.id = NEW.property_id
    AND property.value_type = NEW.value_type
    AND property.lifecycle = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'Data Source Property value must match an active Property type');
END;

CREATE TRIGGER data_source_relation_properties_validate_insert
BEFORE INSERT ON data_source_relation_properties
WHEN NOT EXISTS (
  SELECT 1
  FROM data_source_properties property
  JOIN data_sources source ON source.id = property.data_source_id
  JOIN data_sources target ON target.id = NEW.target_data_source_id
  WHERE property.data_source_id = NEW.data_source_id
    AND property.id = NEW.property_id
    AND property.value_type = 'relation'
    AND property.config_json = '{}'
    AND property.lifecycle = 'active'
    AND source.lifecycle = 'active'
    AND target.lifecycle = 'active'
    AND source.library_id = target.library_id
)
BEGIN
  SELECT RAISE(ABORT, 'Relation Property must target an active Data Source in the same Library');
END;

CREATE TRIGGER data_source_relation_properties_are_immutable
BEFORE UPDATE ON data_source_relation_properties
BEGIN
  SELECT RAISE(ABORT, 'Relation Property target is immutable');
END;

CREATE TRIGGER data_source_relation_property_type_is_stable
BEFORE UPDATE OF value_type ON data_source_properties
WHEN NEW.value_type <> 'relation'
  AND EXISTS (
    SELECT 1 FROM data_source_relation_properties relation
    WHERE relation.data_source_id = OLD.data_source_id
      AND relation.property_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'Relation Property type is immutable');
END;

CREATE TRIGGER data_source_relation_edges_validate_insert
BEFORE INSERT ON data_source_relation_edges
WHEN NOT EXISTS (
  SELECT 1
  FROM data_source_relation_properties relation
  JOIN data_source_property_values value
    ON value.data_source_id = NEW.source_data_source_id
    AND value.membership_id = NEW.source_membership_id
    AND value.property_id = NEW.property_id
  JOIN blocks target_block ON target_block.id = NEW.target_page_block_id
  JOIN pages target_page ON target_page.block_id = target_block.id
  JOIN data_source_page_memberships target_membership
    ON target_membership.page_block_id = target_block.id
    AND target_membership.data_source_id = relation.target_data_source_id
    AND target_membership.removed_at IS NULL
  WHERE relation.data_source_id = NEW.source_data_source_id
    AND relation.property_id = NEW.property_id
    AND value.value_type = 'relation'
    AND json_type(value.value_json) = 'null'
    AND target_block.type = 'page'
    AND target_block.lifecycle = 'active'
    AND target_page.lifecycle = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'Relation edge requires an active target Page in the configured Data Source');
END;

CREATE TRIGGER data_source_relation_edges_are_immutable
BEFORE UPDATE ON data_source_relation_edges
BEGIN
  SELECT RAISE(ABORT, 'Relation edge identity is immutable');
END;
"#;

const V121_PAGE_KEY_SCHEMA_SQL: &str = r#"
CREATE UNIQUE INDEX idx_database_containers_block_library
  ON database_containers(block_id, library_id);

CREATE TABLE page_key_namespaces (
  database_block_id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (database_block_id, library_id),
  FOREIGN KEY (database_block_id, library_id)
    REFERENCES database_containers(block_id, library_id) ON DELETE RESTRICT,
  CHECK (length(created_at) > 0 AND length(updated_at) > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE page_key_prefixes (
  library_id TEXT NOT NULL,
  normalized_prefix TEXT NOT NULL,
  database_block_id TEXT NOT NULL,
  last_number INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  activated_at TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY (library_id, normalized_prefix),
  FOREIGN KEY (database_block_id, library_id)
    REFERENCES page_key_namespaces(database_block_id, library_id) ON DELETE RESTRICT,
  CHECK (length(normalized_prefix) BETWEEN 2 AND 8),
  CHECK (substr(normalized_prefix, 1, 1) BETWEEN 'A' AND 'Z'),
  CHECK (normalized_prefix NOT GLOB '*[^A-Z0-9]*'),
  CHECK (length(activated_at) > 0),
  CHECK (
    (retired_at IS NULL AND last_number IS NULL)
    OR (retired_at IS NOT NULL AND length(retired_at) > 0 AND last_number >= 1)
  )
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX idx_page_key_prefixes_current_database
  ON page_key_prefixes(database_block_id)
  WHERE retired_at IS NULL;

CREATE INDEX idx_page_key_prefixes_database_history
  ON page_key_prefixes(database_block_id, retired_at, normalized_prefix);

CREATE TABLE page_key_assignments (
  database_block_id TEXT NOT NULL
    REFERENCES page_key_namespaces(database_block_id) ON DELETE RESTRICT,
  page_block_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number >= 1),
  assigned_at TEXT NOT NULL CHECK (length(assigned_at) > 0),
  PRIMARY KEY (database_block_id, page_block_id),
  UNIQUE (database_block_id, number)
) WITHOUT ROWID, STRICT;

CREATE INDEX idx_page_key_assignments_page
  ON page_key_assignments(page_block_id, database_block_id);

CREATE TRIGGER page_key_namespaces_identity_immutable
  BEFORE UPDATE OF database_block_id, library_id ON page_key_namespaces
  WHEN NEW.database_block_id <> OLD.database_block_id OR NEW.library_id <> OLD.library_id
  BEGIN
    SELECT RAISE(ABORT, 'Page-key namespace identity is immutable');
  END;

CREATE TRIGGER page_key_namespaces_counter_monotonic
  BEFORE UPDATE OF next_number ON page_key_namespaces
  WHEN NEW.next_number < OLD.next_number
  BEGIN
    SELECT RAISE(ABORT, 'Page-key namespace counter cannot decrease');
  END;

CREATE TRIGGER page_key_prefixes_identity_immutable
  BEFORE UPDATE OF library_id, normalized_prefix, database_block_id ON page_key_prefixes
  WHEN NEW.library_id <> OLD.library_id
    OR NEW.normalized_prefix <> OLD.normalized_prefix
    OR NEW.database_block_id <> OLD.database_block_id
  BEGIN
    SELECT RAISE(ABORT, 'Page-key prefix identity is immutable');
  END;

CREATE TRIGGER page_key_assignments_validate_library
  BEFORE INSERT ON page_key_assignments
  WHEN NOT EXISTS (
    SELECT 1
    FROM page_key_namespaces namespace
    JOIN pages page ON page.block_id = NEW.page_block_id
    JOIN data_source_page_memberships membership
      ON membership.page_block_id = page.block_id
    JOIN data_sources source
      ON source.id = membership.data_source_id
     AND source.home_database_block_id = namespace.database_block_id
     AND source.library_id = namespace.library_id
    WHERE namespace.database_block_id = NEW.database_block_id
      AND namespace.library_id = page.library_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'Page-key assignment requires same-Library Database membership history');
  END;

CREATE TRIGGER page_key_assignments_immutable_update
  BEFORE UPDATE ON page_key_assignments
  BEGIN
    SELECT RAISE(ABORT, 'Page-key assignments are immutable');
  END;

CREATE TRIGGER page_key_assignments_immutable_delete
  BEFORE DELETE ON page_key_assignments
  BEGIN
    SELECT RAISE(ABORT, 'Page-key assignments are immutable');
  END;
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
    MigrationProgress { completed: u64, total: u64 },
}

fn ensure_v120_document_block_tombstones_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS document_block_tombstones ( \
           block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE, \
           library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, \
           document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, \
           document_generation INTEGER NOT NULL CHECK (document_generation >= 1), \
           deletion_head_seq INTEGER NOT NULL CHECK (deletion_head_seq >= 1), \
           placement_revision INTEGER NOT NULL CHECK (placement_revision >= 2), \
           deleted_at TEXT NOT NULL, \
           CHECK (length(block_id) BETWEEN 1 AND 512), \
           CHECK (length(library_id) BETWEEN 1 AND 512), \
           CHECK (length(document_id) BETWEEN 1 AND 512), \
           CHECK (length(deleted_at) > 0) \
         ) WITHOUT ROWID, STRICT; \
         CREATE INDEX IF NOT EXISTS idx_document_block_tombstones_document \
           ON document_block_tombstones(document_id, deletion_head_seq, block_id); \
         CREATE TABLE IF NOT EXISTS local_commit_relocation_obligations ( \
           store_epoch TEXT NOT NULL, \
           commit_seq INTEGER NOT NULL, \
           block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE RESTRICT, \
           source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT, \
           PRIMARY KEY (store_epoch, commit_seq, block_id), \
           FOREIGN KEY (store_epoch, commit_seq) \
             REFERENCES local_commits(store_epoch, commit_seq) ON DELETE CASCADE, \
           CHECK (length(store_epoch) BETWEEN 1 AND 512), \
           CHECK (length(block_id) BETWEEN 1 AND 512), \
           CHECK (length(source_document_id) BETWEEN 1 AND 512) \
         ) WITHOUT ROWID, STRICT",
    )?;
    let has_document_wide_fence: bool = connection.query_row(
        "SELECT EXISTS( \
           SELECT 1 FROM pragma_table_info('document_structural_barriers') \
           WHERE name = 'document_wide_fence' \
         )",
        [],
        |row| row.get(0),
    )?;
    if !has_document_wide_fence {
        connection.execute_batch(
            "ALTER TABLE document_structural_barriers \
               ADD COLUMN document_wide_fence INTEGER NOT NULL DEFAULT 0 \
               CHECK (document_wide_fence IN (0, 1))",
        )?;
    }
    connection.execute_batch(
        "WITH candidates AS ( \
           SELECT block.id AS block_id, block.library_id, block.placement_revision, \
                  block.updated_at AS deleted_at, change.seq, \
                  CAST(json_extract(change.payload_json, '$.documentId') AS TEXT) AS document_id, \
                  CAST(json_extract(change.payload_json, '$.generation') AS INTEGER) AS document_generation, \
                  CAST(json_extract(change.payload_json, '$.headSeq') AS INTEGER) AS deletion_head_seq, \
                  row_number() OVER (PARTITION BY block.id ORDER BY change.seq DESC) AS recency \
           FROM blocks block \
           JOIN change_log change ON change.kind LIKE 'owned_document.%' \
             AND json_type(change.payload_json, '$.documentId') = 'text' \
             AND json_type(change.payload_json, '$.generation') = 'integer' \
             AND json_type(change.payload_json, '$.headSeq') = 'integer' \
           JOIN documents source_document \
             ON source_document.id = CAST(json_extract(change.payload_json, '$.documentId') AS TEXT) \
            AND source_document.library_id = block.library_id \
            AND source_document.generation = CAST(json_extract(change.payload_json, '$.generation') AS INTEGER) \
             AND EXISTS ( \
               SELECT 1 FROM json_each(change.block_ids_json) touched \
               WHERE CAST(touched.value AS TEXT) = block.id \
             ) \
           WHERE block.lifecycle = 'deleted' \
             AND block.placement_revision >= 2 \
             AND block.type NOT IN ( \
               'page', 'database', 'synced_block_source', \
               'reusable_template_source', 'canvas' \
             ) \
             AND NOT EXISTS ( \
               SELECT 1 FROM document_block_index entry \
               WHERE entry.block_id = block.id \
             ) \
             AND NOT EXISTS ( \
               SELECT 1 FROM library_block_placements placement \
               WHERE placement.block_id = block.id \
             ) \
         ) \
         INSERT OR IGNORE INTO document_block_tombstones( \
           block_id, library_id, document_id, document_generation, \
           deletion_head_seq, placement_revision, deleted_at \
         ) \
         SELECT candidate.block_id, candidate.library_id, candidate.document_id, \
                candidate.document_generation, candidate.deletion_head_seq, \
                candidate.placement_revision, candidate.deleted_at \
         FROM candidates candidate \
         JOIN documents document ON document.id = candidate.document_id \
           AND document.library_id = candidate.library_id \
           AND document.generation = candidate.document_generation \
         WHERE candidate.recency = 1",
    )?;
    connection.execute_batch(V120_DOCUMENT_BLOCK_TOMBSTONES_SQL)?;
    validate_v120_document_block_tombstones(connection)
}

fn validate_v120_document_block_tombstones(connection: &Connection) -> Result<(), StoreError> {
    for (object_type, object_name) in [
        ("table", "document_block_tombstones"),
        ("index", "idx_document_block_tombstones_document"),
        ("trigger", "document_block_tombstones_validate_insert"),
        ("trigger", "document_block_tombstones_are_immutable"),
        ("table", "local_commit_relocation_obligations"),
    ] {
        let exists = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = ?1 AND name = ?2)",
            params![object_type, object_name],
            |row| row.get::<_, bool>(0),
        )?;
        if !exists {
            return Err(corrupt(format!(
                "v120 Store is missing {object_type} {object_name}"
            )));
        }
    }
    let has_document_wide_fence: bool = connection.query_row(
        "SELECT EXISTS( \
           SELECT 1 FROM pragma_table_info('document_structural_barriers') \
           WHERE name = 'document_wide_fence' \
         )",
        [],
        |row| row.get(0),
    )?;
    if !has_document_wide_fence {
        return Err(corrupt(
            "v120 Store is missing the Document-wide structural barrier coordinate",
        ));
    }
    let invalid = connection.query_row(
        "SELECT count(*) \
         FROM document_block_tombstones tombstone \
         LEFT JOIN blocks block ON block.id = tombstone.block_id \
         LEFT JOIN documents document ON document.id = tombstone.document_id \
         WHERE block.id IS NULL OR document.id IS NULL \
            OR block.library_id <> tombstone.library_id \
            OR document.library_id <> tombstone.library_id \
            OR block.lifecycle <> 'deleted' \
            OR block.placement_revision <> tombstone.placement_revision \
            OR block.type IN ( \
              'page', 'database', 'synced_block_source', \
              'reusable_template_source', 'canvas' \
            ) \
            OR document.generation <> tombstone.document_generation \
            OR tombstone.deletion_head_seq > document.head_seq \
            OR EXISTS ( \
              SELECT 1 FROM document_block_index entry \
              WHERE entry.block_id = tombstone.block_id \
            ) \
            OR EXISTS ( \
              SELECT 1 FROM library_block_placements placement \
              WHERE placement.block_id = tombstone.block_id \
            )",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if invalid != 0 {
        return Err(corrupt(format!(
            "{invalid} Document Block tombstones disagree with durable authority"
        )));
    }
    let unresolved_relocations: i64 = connection.query_row(
        "SELECT count(*) FROM local_commit_relocation_obligations",
        [],
        |row| row.get(0),
    )?;
    if unresolved_relocations != 0 {
        return Err(corrupt(format!(
            "{unresolved_relocations} LocalCommit relocation obligations survived transaction sealing"
        )));
    }
    Ok(())
}

fn ensure_v124_thread_execution_hosts(connection: &Connection) -> Result<(), StoreError> {
    let column_count: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('codex_threads') \
         WHERE name = 'execution_host_id'",
        [],
        |row| row.get(0),
    )?;
    if column_count == 0 {
        connection.execute_batch(
            "ALTER TABLE codex_threads \
             ADD COLUMN execution_host_id TEXT NOT NULL DEFAULT 'local' \
             CHECK (execution_host_id = trim(execution_host_id) \
                    AND length(execution_host_id) BETWEEN 1 AND 512)",
        )?;
    } else if column_count != 1 {
        return Err(corrupt("Thread execution host column is ambiguous"));
    }
    validate_v124_thread_execution_hosts(connection)
}

fn validate_v124_thread_execution_hosts(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM codex_threads \
         WHERE execution_host_id <> trim(execution_host_id) \
            OR length(execution_host_id) NOT BETWEEN 1 AND 512",
        [],
        |row| row.get(0),
    )?;
    if invalid != 0 {
        return Err(corrupt(
            "v124 Store contains invalid Thread execution host identities",
        ));
    }
    Ok(())
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
        validate_database_view_layout_invariants(connection)?;
        validate_database_view_global_rank_invariants(connection)?;
        validate_database_relation_invariants(connection)?;
        validate_database_priority_invariants(connection)?;
        validate_v117_library_content_ownership(connection)?;
        validate_v118_canvas_resource_grants(connection)?;
        validate_v119_library_content_index_cleanup(connection)?;
        validate_v120_document_block_tombstones(connection)?;
        validate_v124_thread_execution_hosts(connection)?;
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
        validate_database_view_layout_invariants(connection)?;
        validate_database_view_global_rank_invariants(connection)?;
        validate_database_relation_invariants(connection)?;
        validate_database_priority_invariants(connection)?;
        validate_v117_library_content_ownership(connection)?;
        validate_v118_canvas_resource_grants(connection)?;
        validate_v119_library_content_index_cleanup(connection)?;
        validate_v120_document_block_tombstones(connection)?;
        validate_v124_thread_execution_hosts(connection)?;
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
    let backup_path = create_migration_backup(connection, profile_home, source_version)?;
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
        observer,
    )?;
    validate_store(connection)?;
    validate_core_metadata(connection, CORE_SCHEMA_VERSION)?;
    validate_codex_thread_timestamp_invariants(connection)?;
    validate_canonical_text_timestamp_invariants(connection)?;
    validate_database_view_layout_invariants(connection)?;
    validate_database_view_global_rank_invariants(connection)?;
    validate_database_relation_invariants(connection)?;
    validate_database_priority_invariants(connection)?;
    validate_v117_library_content_ownership(connection)?;
    validate_v118_canvas_resource_grants(connection)?;
    validate_v119_library_content_index_cleanup(connection)?;
    validate_v120_document_block_tombstones(connection)?;
    validate_v124_thread_execution_hosts(connection)?;
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
    observer: &mut dyn FnMut(StorePreparationEvent),
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
        observer,
    )?;
    validate_store(connection)?;
    validate_core_metadata(connection, CORE_SCHEMA_VERSION)?;
    validate_exact_current_schema(connection)?;
    validate_codex_thread_timestamp_invariants(connection)?;
    validate_canonical_text_timestamp_invariants(connection)?;
    validate_database_view_layout_invariants(connection)?;
    validate_database_view_global_rank_invariants(connection)?;
    validate_database_relation_invariants(connection)?;
    validate_database_priority_invariants(connection)?;
    validate_v117_library_content_ownership(connection)?;
    validate_v118_canvas_resource_grants(connection)?;
    validate_v119_library_content_index_cleanup(connection)?;
    validate_v120_document_block_tombstones(connection)?;
    validate_v124_thread_execution_hosts(connection)?;
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

/// SQLite table rebuilds cannot preserve composite foreign keys while the
/// parent table is being replaced. Foreign-key enforcement is disabled only
/// for the atomic migration transaction, restored on every exit path, and the
/// complete graph is checked immediately afterward by `validate_store`.
fn with_schema_rebuild_transaction<T>(
    connection: &mut Connection,
    operation: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T, StoreError>,
) -> Result<T, StoreError> {
    let foreign_keys_enabled =
        connection.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, bool>(0))?;
    if foreign_keys_enabled {
        connection.pragma_update(None, "foreign_keys", false)?;
    }
    let result = with_immediate_transaction(connection, operation);
    let restore = if foreign_keys_enabled {
        connection.pragma_update(None, "foreign_keys", true)
    } else {
        Ok(())
    };
    match (result, restore) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(StoreError::from(error)),
        (Err(error), Err(_)) => Err(error),
    }
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
        99 => validate_exact_v99_schema(connection)?,
        100 => validate_exact_v100_schema(connection)?,
        101 => validate_exact_v101_schema(connection)?,
        102 => validate_exact_v102_schema(connection)?,
        103 => validate_exact_v103_schema(connection)?,
        104 => validate_exact_v104_schema(connection)?,
        105 => validate_exact_v105_schema(connection)?,
        106 => validate_exact_v106_schema(connection)?,
        107 => validate_exact_v107_schema(connection)?,
        108 => validate_exact_v108_schema(connection)?,
        109 => validate_exact_v109_schema(connection)?,
        110 | 111 => validate_exact_v110_schema(connection)?,
        112 | 113 => validate_exact_v113_schema(connection)?,
        114 => validate_exact_v114_schema(connection)?,
        115 => validate_exact_v115_schema(connection)?,
        116 => validate_exact_v116_schema(connection)?,
        117 => validate_exact_v117_schema(connection)?,
        118 => validate_exact_v118_schema(connection)?,
        119 => validate_exact_v119_schema(connection)?,
        120 => validate_exact_v120_schema(connection)?,
        121 => validate_exact_v121_schema(connection)?,
        122 => validate_exact_v122_schema(connection)?,
        123 => validate_exact_v123_schema(connection)?,
        _ => return Err(corrupt("Rust Core forward-migration source is unsupported")),
    }

    observer(StorePreparationEvent::MigrationStarted {
        from_version: source_version,
        to_version: CORE_SCHEMA_VERSION,
    });

    let backup_path = create_migration_backup(connection, profile_home, source_version)?;
    let validated_yjs_documents = validate_live_yjs_documents(connection)?;
    let migration_now = unix_time_millis()?;
    with_schema_rebuild_transaction(connection, |transaction| {
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
        if source_version < 100 {
            ensure_v100_relation_properties_schema(transaction)?;
        }
        if source_version < 101 {
            ensure_v101_projectless_permission_mode_schema(transaction)?;
        }
        if source_version < 102 {
            ensure_v102_local_commit_schema(transaction, &mut |_, _| {})?;
        }
        if source_version < 103 {
            ensure_v103_local_commit_composite_identity(transaction)?;
        }
        if source_version < 108 {
            // Current manifest compilation includes scoped revocation evidence.
            // Install its immutable child table before any historical manifest
            // rebuild so every migration stage sees the complete current
            // canonical input rather than special-casing absent evidence.
            ensure_v108_local_commit_revocations_schema(transaction)?;
        }
        if source_version < 109 {
            ensure_v109_local_commit_delivery_atoms_schema(transaction)?;
        }
        if source_version < 110 {
            ensure_v110_visibility_delta_journal_schema(transaction)?;
        }
        if source_version < 106 {
            upgrade_local_commit_artifacts(
                transaction,
                source_version,
                &mut |completed, total| {
                    observer(StorePreparationEvent::MigrationProgress { completed, total });
                },
            )?;
        }
        if source_version < 107 {
            ensure_v107_block_project_cascade_indexes(transaction)?;
        }
        if (106..108).contains(&source_version) {
            crate::infrastructure::local_commit::upgrade_v108_manifest(
                transaction,
                &mut |completed, total| {
                    observer(StorePreparationEvent::MigrationProgress { completed, total });
                },
            )?;
        }
        if source_version < 109 {
            crate::infrastructure::local_commit::upgrade_v109_manifest(
                transaction,
                &mut |completed, total| {
                    observer(StorePreparationEvent::MigrationProgress { completed, total });
                },
            )?;
        }
        if source_version < 110 {
            crate::infrastructure::local_commit::upgrade_v110_manifest(
                transaction,
                &mut |completed, total| {
                    observer(StorePreparationEvent::MigrationProgress { completed, total });
                },
            )?;
        }
        if source_version < 111 {
            ensure_v111_priority_contract(transaction, migration_now)?;
        }
        if source_version < 112 {
            ensure_v112_database_view_contract(transaction, migration_now)?;
        }
        if source_version < 113 {
            ensure_v113_view_global_rank(transaction)?;
        }
        if source_version < 114 {
            ensure_v114_database_list_authority(transaction)?;
        }
        if source_version < 115 {
            ensure_v115_task_parent_relation_authority(transaction, migration_now)?;
        }
        if source_version < 120 {
            ensure_v116_view_personal_state(transaction)?;
            ensure_v117_library_content_ownership(transaction)?;
            ensure_v118_canvas_resource_grants(transaction)?;
            ensure_v119_library_content_index_cleanup(transaction)?;
            ensure_v120_document_block_tombstones_schema(transaction)?;
        }
        if source_version < 121 {
            ensure_v121_page_key_authority(transaction, migration_now)?;
        } else if source_version < 123 {
            let migrated_at = migration_timestamp(migration_now)?;
            migrate_page_key_display_fields(transaction, &migrated_at)?;
            validate_v121_page_key_invariants(transaction)?;
        } else {
            validate_v121_page_key_invariants(transaction)?;
        }
        ensure_v124_thread_execution_hosts(transaction)?;
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
    validate_database_view_layout_invariants(connection)?;
    validate_database_view_global_rank_invariants(connection)?;
    validate_database_relation_invariants(connection)?;
    validate_database_priority_invariants(connection)?;
    validate_v117_library_content_ownership(connection)?;
    validate_v118_canvas_resource_grants(connection)?;
    validate_v119_library_content_index_cleanup(connection)?;
    validate_v120_document_block_tombstones(connection)?;
    validate_v124_thread_execution_hosts(connection)?;
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
    source_version: i64,
) -> Result<PathBuf, StoreError> {
    let directory = prepare_migration_backup_directory(profile_home)?;
    let source_identity = read_migration_source_identity(connection, source_version)?;
    if let Some(source_identity) = source_identity.as_ref()
        && let Some(existing) =
            find_reusable_migration_backup(&directory, source_version, source_identity)?
    {
        return Ok(existing);
    }
    let pending_path = directory.join(format!(
        ".v{source_version}-to-v{CORE_SCHEMA_VERSION}.pending.db"
    ));
    if let Ok(metadata) = fs::symlink_metadata(&pending_path) {
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(StoreError::new(
                StoreErrorCode::InvalidProfile,
                "Core migration pending backup must be a regular file",
                false,
            ));
        }
        fs::remove_file(&pending_path).map_err(io_error)?;
    }
    connection.backup(MAIN_DB, &pending_path, None)?;
    File::open(&pending_path)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;
    validate_migration_backup(&pending_path, source_version)?;
    let digest = file_sha256(&pending_path)?;
    let backup_path = directory.join(format!(
        "v{source_version}-to-v{CORE_SCHEMA_VERSION}-{digest}.db"
    ));
    if let Ok(metadata) = fs::symlink_metadata(&backup_path) {
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err(StoreError::new(
                StoreErrorCode::InvalidProfile,
                "Core migration backup must be a regular file",
                false,
            ));
        }
        validate_migration_backup(&backup_path, source_version)?;
        if file_sha256(&backup_path)? != digest {
            return Err(corrupt(
                "Content-addressed migration backup digest diverges",
            ));
        }
        fs::remove_file(&pending_path).map_err(io_error)?;
    } else {
        fs::rename(&pending_path, &backup_path).map_err(io_error)?;
    }
    File::open(&directory)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;
    Ok(backup_path)
}

fn prepare_migration_backup_directory(profile_home: &Path) -> Result<PathBuf, StoreError> {
    let mut directory = profile_home.to_path_buf();
    for component in ["backups", "core-migrations"] {
        directory.push(component);
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidProfile,
                    "Core migration backup ancestry must contain only real directories",
                    false,
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&directory).map_err(io_error)?;
            }
            Err(error) => return Err(io_error(error)),
        }
    }
    Ok(directory)
}

fn find_reusable_migration_backup(
    directory: &Path,
    source_version: i64,
    source_identity: &MigrationSourceIdentity,
) -> Result<Option<PathBuf>, StoreError> {
    let prefix = format!("v{source_version}-to-v{CORE_SCHEMA_VERSION}-");
    let mut candidates = Vec::new();
    for entry in fs::read_dir(directory).map_err(io_error)? {
        let path = entry.map_err(io_error)?.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".db"))
        {
            candidates.push(path);
        }
    }
    candidates.sort();
    for candidate in candidates {
        let metadata = fs::symlink_metadata(&candidate).map_err(io_error)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(StoreError::new(
                StoreErrorCode::InvalidProfile,
                "Core migration backup candidate must be a regular file",
                false,
            ));
        }
        if validate_migration_backup(&candidate, source_version).is_err() {
            continue;
        }
        let backup = open_immutable_reader(&candidate)?;
        if read_migration_source_identity(&backup, source_version)?.as_ref()
            == Some(source_identity)
        {
            return Ok(Some(candidate));
        }
    }
    Ok(None)
}

#[derive(Debug, PartialEq, Eq)]
struct MigrationSourceIdentity {
    store_epoch: String,
    commit_count: i64,
    commit_head: i64,
    commit_head_hash: Option<String>,
    change_log_count: i64,
    change_log_head: i64,
    effect_count: i64,
    document_effect_count: i64,
    document_receipt_count: i64,
    module_receipt_count: i64,
}

fn read_migration_source_identity(
    connection: &Connection,
    source_version: i64,
) -> Result<Option<MigrationSourceIdentity>, StoreError> {
    if source_version < 102 {
        return Ok(None);
    }
    let Some(store_epoch) = connection
        .query_row(
            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    else {
        return Ok(None);
    };
    let (commit_count, commit_head) = connection.query_row(
        "SELECT count(*), COALESCE(max(commit_seq), 0) FROM local_commits",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let commit_head_hash = if commit_head == 0 {
        None
    } else {
        connection
            .query_row(
                "SELECT canonical_hash FROM local_commits WHERE commit_seq = ?1",
                [commit_head],
                |row| row.get::<_, String>(0),
            )
            .optional()?
    };
    let (change_log_count, change_log_head) = connection.query_row(
        "SELECT count(*), COALESCE(max(seq), 0) FROM change_log",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let effect_count =
        connection.query_row("SELECT count(*) FROM local_commit_effects", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if change_log_count != effect_count {
        return Ok(None);
    }
    let document_effect_count =
        connection.query_row("SELECT count(*) FROM local_commit_documents", [], |row| {
            row.get::<_, i64>(0)
        })?;
    let document_receipt_count =
        connection.query_row("SELECT count(*) FROM document_update_receipts", [], |row| {
            row.get::<_, i64>(0)
        })?;
    let module_receipt_count =
        connection.query_row("SELECT count(*) FROM core_module_receipts", [], |row| {
            row.get::<_, i64>(0)
        })?;
    Ok(Some(MigrationSourceIdentity {
        store_epoch,
        commit_count,
        commit_head,
        commit_head_hash,
        change_log_count,
        change_log_head,
        effect_count,
        document_effect_count,
        document_receipt_count,
        module_receipt_count,
    }))
}

fn validate_migration_backup(path: &Path, source_version: i64) -> Result<(), StoreError> {
    let backup = open_immutable_reader(path)?;
    let version: i64 = backup.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version != source_version {
        return Err(StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("Migration backup has unexpected schema v{version}"),
            false,
        ));
    }
    validate_store(&backup)
}

fn file_sha256(path: &Path) -> Result<String, StoreError> {
    let mut file = File::open(path).map_err(io_error)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            return Ok(format!("{:x}", digest.finalize()));
        }
        digest.update(&buffer[..read]);
    }
}

fn validate_live_yjs_documents(connection: &Connection) -> Result<usize, StoreError> {
    let repository = DocumentReadRepository::new(connection);
    let heads = if table_has_column(connection, "documents", "library_id")? {
        repository.live_yjs_heads()?
    } else {
        repository.legacy_project_owned_live_yjs_heads()?
    };
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
    observer: &mut dyn FnMut(StorePreparationEvent),
) -> Result<(), StoreError> {
    with_schema_rebuild_transaction(connection, |transaction| {
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
        ensure_v100_relation_properties_schema(transaction)?;
        ensure_v101_projectless_permission_mode_schema(transaction)?;
        ensure_v102_local_commit_schema(transaction, &mut |_, _| {})?;
        ensure_v103_local_commit_composite_identity(transaction)?;
        ensure_v107_block_project_cascade_indexes(transaction)?;
        ensure_v108_local_commit_revocations_schema(transaction)?;
        ensure_v109_local_commit_delivery_atoms_schema(transaction)?;
        ensure_v110_visibility_delta_journal_schema(transaction)?;
        upgrade_local_commit_artifacts(
            transaction,
            TYPESCRIPT_SCHEMA_VERSION,
            &mut |completed, total| {
                observer(StorePreparationEvent::MigrationProgress { completed, total });
            },
        )?;
        crate::infrastructure::local_commit::upgrade_v109_manifest(transaction, &mut |_, _| {})?;
        crate::infrastructure::local_commit::upgrade_v110_manifest(transaction, &mut |_, _| {})?;
        ensure_v111_priority_contract(transaction, now)?;
        ensure_v112_database_view_contract(transaction, now)?;
        ensure_v113_view_global_rank(transaction)?;
        ensure_v114_database_list_authority(transaction)?;
        ensure_v115_task_parent_relation_authority(transaction, now)?;
        ensure_v116_view_personal_state(transaction)?;
        ensure_v117_library_content_ownership(transaction)?;
        ensure_v118_canvas_resource_grants(transaction)?;
        ensure_v119_library_content_index_cleanup(transaction)?;
        ensure_v120_document_block_tombstones_schema(transaction)?;
        ensure_v121_page_key_authority(transaction, now)?;
        ensure_v124_thread_execution_hosts(transaction)?;
        import_legacy_writable_roots(transaction, profile_home, now)?;
        import_automation_jitter_salt(transaction, profile_home, now)
    })
}

fn create_fresh_store(
    connection: &mut Connection,
    profile_home: &Path,
    now: u64,
) -> Result<(), StoreError> {
    with_schema_rebuild_transaction(connection, |transaction| {
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
        ensure_v100_relation_properties_schema(transaction)?;
        ensure_v101_projectless_permission_mode_schema(transaction)?;
        ensure_v102_local_commit_schema(transaction, &mut |_, _| {})?;
        ensure_v103_local_commit_composite_identity(transaction)?;
        ensure_v107_block_project_cascade_indexes(transaction)?;
        ensure_v108_local_commit_revocations_schema(transaction)?;
        ensure_v109_local_commit_delivery_atoms_schema(transaction)?;
        ensure_v110_visibility_delta_journal_schema(transaction)?;
        upgrade_local_commit_artifacts(transaction, TYPESCRIPT_SCHEMA_VERSION, &mut |_, _| {})?;
        crate::infrastructure::local_commit::upgrade_v109_manifest(transaction, &mut |_, _| {})?;
        crate::infrastructure::local_commit::upgrade_v110_manifest(transaction, &mut |_, _| {})?;
        ensure_v111_priority_contract(transaction, now)?;
        ensure_v112_database_view_contract(transaction, now)?;
        ensure_v113_view_global_rank(transaction)?;
        ensure_v114_database_list_authority(transaction)?;
        ensure_v115_task_parent_relation_authority(transaction, now)?;
        ensure_v116_view_personal_state(transaction)?;
        ensure_v117_library_content_ownership(transaction)?;
        ensure_v118_canvas_resource_grants(transaction)?;
        ensure_v119_library_content_index_cleanup(transaction)?;
        ensure_v120_document_block_tombstones_schema(transaction)?;
        ensure_v121_page_key_authority(transaction, now)?;
        ensure_v124_thread_execution_hosts(transaction)?;
        import_legacy_writable_roots(transaction, profile_home, now)?;
        import_automation_jitter_salt(transaction, profile_home, now)
    })
}

#[cfg(test)]
static TEST_CURRENT_STORE_TEMPLATE: OnceLock<Mutex<Connection>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn prepare_test_current_store(
    connection: &mut Connection,
    profile_home: &Path,
) -> Result<(), StoreError> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let object_count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if version != 0 || object_count != 0 {
        return Ok(());
    }

    let template = test_current_store_template()?;
    let template = template
        .lock()
        .map_err(|_| corrupt("Test Store template lock is poisoned"))?;
    let backup = Backup::new(&template, connection)?;
    backup.run_to_completion(1_024, Duration::ZERO, None)?;
    drop(backup);

    let now = unix_time_millis()?;
    with_immediate_transaction(connection, |transaction| {
        transaction.execute(
            "INSERT INTO nodex_agent_token_keys(id, key_material) VALUES (1, randomblob(32))",
            [],
        )?;
        write_v85_metadata(transaction, None, None, now)?;
        transaction.execute(
            "UPDATE core_store_metadata SET projection_event_v2_floor = 1 WHERE id = 1",
            [],
        )?;
        import_legacy_writable_roots(transaction, profile_home, now)?;
        import_automation_jitter_salt(transaction, profile_home, now)
    })?;
    crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(connection)
}

#[cfg(test)]
fn test_current_store_template() -> Result<&'static Mutex<Connection>, StoreError> {
    if let Some(template) = TEST_CURRENT_STORE_TEMPLATE.get() {
        return Ok(template);
    }

    let mut connection = Connection::open_in_memory()?;
    connection.pragma_update(None, "foreign_keys", true)?;
    create_fresh_store(
        &mut connection,
        Path::new("/__nodex_missing_test_profile__"),
        0,
    )?;
    with_immediate_transaction(&mut connection, |transaction| {
        transaction.execute("DELETE FROM core_store_metadata", [])?;
        transaction.execute("DELETE FROM nodex_agent_token_keys", [])?;
        transaction.execute("DELETE FROM core_automation_runtime_metadata", [])?;
        transaction.execute("DELETE FROM core_legacy_imports", [])?;
        Ok(())
    })?;

    let _ = TEST_CURRENT_STORE_TEMPLATE.set(Mutex::new(connection));
    TEST_CURRENT_STORE_TEMPLATE
        .get()
        .ok_or_else(|| corrupt("Test Store template was not initialized"))
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

fn ensure_v100_relation_properties_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.pragma_update(None, "defer_foreign_keys", true)?;
    connection.execute_batch(V100_RELATION_PROPERTIES_SCHEMA_SQL)?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v100 Relation Property migration produced a foreign-key violation",
        ));
    }
    validate_database_relation_invariants(connection)
}

fn ensure_v101_projectless_permission_mode_schema(
    connection: &Connection,
) -> Result<(), StoreError> {
    connection.execute_batch(V101_PROJECTLESS_PERMISSION_MODE_SCHEMA_SQL)?;
    Ok(())
}

fn ensure_v102_local_commit_schema(
    connection: &Connection,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), StoreError> {
    let local_commits_exists: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'local_commits'",
        [],
        |row| row.get(0),
    )?;
    if local_commits_exists == 0 {
        connection.execute_batch(V102_LOCAL_COMMIT_SCHEMA_SQL)?;
    } else {
        let local_commit_receipt_column: i64 = connection.query_row(
            "SELECT count(*) FROM pragma_table_info('core_module_receipts')
             WHERE name = 'local_commit_seq'",
            [],
            |row| row.get(0),
        )?;
        if local_commit_receipt_column == 0 {
            connection.execute_batch(
                "ALTER TABLE core_module_receipts
                   ADD COLUMN local_commit_seq INTEGER REFERENCES local_commits(commit_seq);
                 CREATE INDEX IF NOT EXISTS idx_core_module_receipts_local_commit
                   ON core_module_receipts(local_commit_seq);",
            )?;
        }
    }
    crate::infrastructure::local_commit::backfill(connection, progress)?;
    connection.execute(
        "UPDATE core_module_receipts
         SET local_commit_seq = (
           SELECT effect.commit_seq
           FROM local_commit_effects effect
           WHERE effect.change_log_seq = core_module_receipts.event_sequence
         )
         WHERE local_commit_seq IS NULL AND event_sequence IS NOT NULL",
        [],
    )?;
    Ok(())
}

fn ensure_v103_local_commit_composite_identity(connection: &Connection) -> Result<(), StoreError> {
    let composite_foreign_key_count: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_foreign_key_list('local_commit_effects')
         WHERE \"from\" = 'store_epoch' AND \"to\" = 'store_epoch'",
        [],
        |row| row.get(0),
    )?;
    if composite_foreign_key_count > 0 {
        return Ok(());
    }
    connection.execute_batch(V103_LOCAL_COMMIT_COMPOSITE_IDENTITY_SCHEMA_SQL)?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v103 LocalCommit composite identity migration produced a foreign-key violation",
        ));
    }
    Ok(())
}

fn ensure_v105_local_commit_manifest_schema(connection: &Connection) -> Result<(), StoreError> {
    let has_intent_hash: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('local_commits') WHERE name = 'intent_hash'",
        [],
        |row| row.get(0),
    )?;
    if has_intent_hash == 0 {
        connection.execute_batch(V105_LOCAL_COMMIT_MANIFEST_SCHEMA_SQL)?;
    }
    Ok(())
}

fn ensure_v106_projection_scope_heads_schema(connection: &Connection) -> Result<(), StoreError> {
    let exists: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema
         WHERE type = 'table' AND name = 'projection_scope_heads'",
        [],
        |row| row.get(0),
    )?;
    if exists == 0 {
        connection.execute_batch(V106_PROJECTION_SCOPE_HEAD_SCHEMA_SQL)?;
    }
    Ok(())
}

fn upgrade_local_commit_artifacts(
    connection: &Connection,
    source_version: i64,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), StoreError> {
    if source_version >= 106 {
        return Ok(());
    }
    ensure_v105_local_commit_manifest_schema(connection)?;
    ensure_v106_projection_scope_heads_schema(connection)?;
    if source_version < 105 {
        return crate::infrastructure::local_commit::upgrade_v105_manifest(connection, progress);
    }
    crate::infrastructure::local_commit::upgrade_v106_manifest(connection, progress)
}

fn ensure_v107_block_project_cascade_indexes(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(V107_BLOCK_PROJECT_CASCADE_INDEXES_SQL)?;
    Ok(())
}

fn ensure_v108_local_commit_revocations_schema(connection: &Connection) -> Result<(), StoreError> {
    let exists: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema
         WHERE type = 'table' AND name = 'local_commit_revocations'",
        [],
        |row| row.get(0),
    )?;
    if exists == 0 {
        connection.execute_batch(V108_LOCAL_COMMIT_REVOCATIONS_SCHEMA_SQL)?;
    }
    Ok(())
}

fn ensure_v109_local_commit_delivery_atoms_schema(
    connection: &Connection,
) -> Result<(), StoreError> {
    let exists: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema
         WHERE type = 'table' AND name = 'local_commit_delivery_atoms'",
        [],
        |row| row.get(0),
    )?;
    if exists == 0 {
        connection.execute_batch(V109_LOCAL_COMMIT_DELIVERY_ATOMS_SCHEMA_SQL)?;
    }
    ensure_v109_property_semantics_schema(connection)?;
    Ok(())
}

fn ensure_v110_visibility_delta_journal_schema(connection: &Connection) -> Result<(), StoreError> {
    let library_effects_exist: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema
         WHERE type = 'table' AND name = 'local_commit_library_effects'",
        [],
        |row| row.get(0),
    )?;
    if library_effects_exist == 0 {
        connection.execute_batch(V110_LOCAL_COMMIT_LIBRARY_EFFECTS_SCHEMA_SQL)?;
    }
    if !crate::infrastructure::visibility_delta_journal::is_installed(connection)? {
        crate::infrastructure::visibility_delta_journal::install_schema(connection)?;
    }
    Ok(())
}

fn ensure_v109_property_semantics_schema(connection: &Connection) -> Result<(), StoreError> {
    let relation_table_exists: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema
         WHERE type = 'table' AND name = 'data_source_relation_edges'",
        [],
        |row| row.get(0),
    )?;
    if relation_table_exists == 0 {
        return Ok(());
    }
    let edge_id_exists: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info('data_source_relation_edges')
         WHERE name = 'edge_id'",
        [],
        |row| row.get(0),
    )?;
    if edge_id_exists != 0 {
        return Ok(());
    }
    connection.pragma_update(None, "defer_foreign_keys", true)?;
    connection.execute_batch(V109_PROPERTY_SEMANTICS_SCHEMA_SQL)?;
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

fn validate_database_view_layout_version(
    connection: &Connection,
    schema_version: i64,
) -> Result<(), StoreError> {
    let unsupported: i64 = connection.query_row(
        &format!(
            "SELECT count(*) FROM database_views \
         WHERE default_layout NOT IN ('board', 'list') \
            OR json_extract(config_json, '$.schemaKey') <> 'nodex.database-view' \
            OR json_extract(config_json, '$.schemaVersion') <> {schema_version} \
            OR COALESCE(json_extract(config_json, '$.presentation.groupDirection'), '') \
                 NOT IN ('asc', 'desc') \
            OR COALESCE(json_type(config_json, '$.presentation.hierarchy'), '') <> 'object' \
            OR (COALESCE(json_type(config_json, '$.presentation.hierarchy.showSubPages'), '') \
                  NOT IN ('true', 'false')) \
            OR (COALESCE(json_type(config_json, '$.presentation.hierarchy.nestedSubPages'), '') \
                  NOT IN ('true', 'false')) \
            OR (json_extract(config_json, '$.presentation.hierarchy.showSubPages') = 0 \
               AND json_extract(config_json, '$.presentation.hierarchy.nestedSubPages') = 1)"
        ),
        [],
        |row| row.get(0),
    )?;
    if unsupported == 0 {
        return Ok(());
    }
    Err(corrupt(
        "Database View authority contains a retired layout or config schema",
    ))
}

fn validate_database_view_layout_v3_invariants(connection: &Connection) -> Result<(), StoreError> {
    let unsupported: i64 = connection.query_row(
        "SELECT count(*) FROM database_views \
         WHERE default_layout NOT IN ('board', 'list') \
            OR json_extract(config_json, '$.schemaKey') <> 'nodex.database-view' \
            OR json_extract(config_json, '$.schemaVersion') <> 3",
        [],
        |row| row.get(0),
    )?;
    if unsupported == 0 {
        return Ok(());
    }
    Err(corrupt(
        "Database View authority contains a retired layout or v3 config schema",
    ))
}

fn validate_database_view_layout_invariants(connection: &Connection) -> Result<(), StoreError> {
    validate_database_view_layout_version(connection, 4)
}

fn database_view_config_v3(raw: &str, view_id: &str) -> Result<String, StoreError> {
    let config = serde_json::from_str::<Value>(raw).map_err(|error| {
        corrupt(format!(
            "Database View {view_id} config is invalid: {error}"
        ))
    })?;
    if config.get("schemaKey").and_then(Value::as_str) != Some("nodex.database-view") {
        return Err(corrupt(format!(
            "Database View {view_id} config schema key is unsupported"
        )));
    }
    if config.get("schemaVersion").and_then(Value::as_i64) == Some(3) {
        return serde_json::to_string(&config)
            .map_err(|_| internal("Database View v3 config could not be serialized"));
    }
    if config.get("schemaVersion").and_then(Value::as_i64) != Some(2) {
        return Err(corrupt(format!(
            "Database View {view_id} config schema version is unsupported"
        )));
    }
    let filter = config
        .get("filter")
        .cloned()
        .ok_or_else(|| corrupt(format!("Database View {view_id} filter is missing")))?;
    let sort = config
        .get("sort")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| corrupt(format!("Database View {view_id} sort is invalid")))?;
    let group = config
        .get("group")
        .cloned()
        .ok_or_else(|| corrupt(format!("Database View {view_id} group is missing")))?;
    let property_ids = config
        .pointer("/display/propertyIds")
        .and_then(Value::as_array)
        .ok_or_else(|| corrupt(format!("Database View {view_id} display is invalid")))?;
    if !property_ids.iter().all(Value::is_string) {
        return Err(corrupt(format!(
            "Database View {view_id} display Property IDs are invalid"
        )));
    }
    let fields = property_ids
        .iter()
        .filter_map(Value::as_str)
        .map(|property_id| json!({ "kind": "property", "propertyId": property_id }))
        .collect::<Vec<_>>();
    serde_json::to_string(&json!({
        "schemaKey": "nodex.database-view",
        "schemaVersion": 3,
        "filter": filter,
        "presentation": {
            "sort": sort,
            "group": group,
            "subgroup": null,
            "completion": { "range": "all", "orderByRecency": false },
            "layouts": {
                "board": { "fields": fields, "showEmptyGroups": false },
                "list": { "fields": fields, "showEmptyGroups": false }
            }
        }
    }))
    .map_err(|_| internal("Migrated Database View config could not be serialized"))
}

fn table_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, StoreError> {
    let count = connection.query_row(
        "SELECT count(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table_name, column_name],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count == 1)
}

fn ensure_v112_database_view_contract(connection: &Connection, now: u64) -> Result<(), StoreError> {
    if !table_has_column(connection, "data_source_page_memberships", "completed_at")? {
        connection.execute(
            "ALTER TABLE data_source_page_memberships ADD COLUMN completed_at TEXT",
            [],
        )?;
    }
    if table_has_column(connection, "database_views", "default_layout")? {
        return validate_database_view_layout_v3_invariants(connection);
    }
    if !table_has_column(connection, "database_views", "kind")? {
        return Err(corrupt(
            "Database View authority has neither kind nor default_layout",
        ));
    }

    let migration_timestamp = migration_timestamp(now)?;
    let views = connection
        .prepare(
            "SELECT id, database_block_id, data_source_id, name, kind, config_json, \
                    revision, rank_key, lifecycle, created_at \
             FROM database_views ORDER BY id",
        )?
        .query_map([], |row| {
            Ok(LegacyDatabaseViewRow {
                id: row.get(0)?,
                database_id: row.get(1)?,
                data_source_id: row.get(2)?,
                name: row.get(3)?,
                kind: row.get(4)?,
                config_json: row.get(5)?,
                revision: row.get(6)?,
                rank_key: row.get(7)?,
                lifecycle: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    connection.pragma_update(None, "defer_foreign_keys", true)?;
    connection.execute_batch(V112_DATABASE_VIEW_SCHEMA_SQL)?;
    for view in views {
        let default_layout = match view.kind.as_str() {
            "kanban" => "board",
            "list" | "calendar" | "canvas" => "list",
            _ => {
                return Err(corrupt(format!(
                    "Database View {} uses unsupported kind {}",
                    view.id, view.kind
                )));
            }
        };
        let config_json = database_view_config_v3(&view.config_json, &view.id)?;
        connection.execute(
            "INSERT INTO database_views_v112( \
               id, database_block_id, data_source_id, name, default_layout, config_json, \
               revision, rank_key, lifecycle, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                view.id,
                view.database_id,
                view.data_source_id,
                view.name,
                default_layout,
                config_json,
                view.revision + 1,
                view.rank_key,
                view.lifecycle,
                view.created_at,
                migration_timestamp,
            ],
        )?;
    }
    connection.execute_batch(
        "INSERT INTO database_view_page_positions_v112( \
           view_id, page_block_id, group_key, rank_key, revision, created_at, updated_at \
         ) SELECT view_id, page_block_id, group_key, rank_key, revision, created_at, updated_at \
           FROM database_view_page_positions; \
         INSERT INTO page_read_model_v112( \
           page_block_id, project_id, lifecycle, location_kind, containing_document_id, \
           containing_database_id, top_level_rank_key, location_revision, metadata_revision, \
           document_id, document_generation, document_projected_seq, document_schema_version, \
           document_authority, membership_id, database_block_id, view_id, view_group_key, \
           view_rank_key, title, description_preview, description_length, has_description, \
           database_values_json, intrinsic_properties_json, property_revisions_json, \
           projection_version, created_at, updated_at \
         ) SELECT \
           page_block_id, project_id, lifecycle, location_kind, containing_document_id, \
           containing_database_id, top_level_rank_key, location_revision, metadata_revision, \
           document_id, document_generation, document_projected_seq, document_schema_version, \
           document_authority, membership_id, database_block_id, view_id, view_group_key, \
           view_rank_key, title, description_preview, description_length, has_description, \
           database_values_json, intrinsic_properties_json, property_revisions_json, \
           projection_version, created_at, updated_at \
           FROM page_read_model; \
         DROP TRIGGER database_containers_default_view_is_owned_insert; \
         DROP TRIGGER database_containers_default_view_is_owned_update; \
         DROP TABLE page_read_model; \
         DROP TABLE database_view_page_positions; \
         DROP TABLE database_views; \
         ALTER TABLE database_views_v112 RENAME TO database_views; \
         ALTER TABLE database_view_page_positions_v112 RENAME TO database_view_page_positions; \
         ALTER TABLE page_read_model_v112 RENAME TO page_read_model;",
    )?;
    connection.execute_batch(V112_DATABASE_VIEW_INDEXES_AND_TRIGGERS_SQL)?;
    crate::infrastructure::visibility_delta_journal::refresh_authority_relation_triggers(
        connection,
        &["database_views", "data_source_page_memberships"],
    )?;
    connection.execute(
        "UPDATE data_source_page_memberships AS membership \
         SET completed_at = ?1 \
         WHERE membership.removed_at IS NULL \
           AND membership.completed_at IS NULL \
           AND EXISTS ( \
             SELECT 1 FROM data_source_property_values value \
             WHERE value.membership_id = membership.id \
               AND value.data_source_id = membership.data_source_id \
               AND value.property_id = 'status' \
               AND value.value_type = 'select' \
               AND json_extract(value.value_json, '$') = 'ship' \
           )",
        [migration_timestamp],
    )?;
    let foreign_key_violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(corrupt(
            "v112 Database View migration produced a foreign-key violation",
        ));
    }
    validate_database_view_layout_v3_invariants(connection)
}

fn ensure_v113_view_global_rank(connection: &Connection) -> Result<(), StoreError> {
    if !table_has_column(connection, "database_view_page_positions", "group_key")? {
        return validate_database_view_global_rank_invariants(connection);
    }
    let ordered_positions = connection
        .prepare(
            "SELECT view_id, page_block_id \
             FROM database_view_page_positions \
             ORDER BY view_id, CASE WHEN group_key IS NULL THEN 1 ELSE 0 END, \
               group_key, rank_key, page_block_id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut positions_by_view = BTreeMap::<String, Vec<String>>::new();
    for (view_id, page_id) in ordered_positions {
        positions_by_view.entry(view_id).or_default().push(page_id);
    }
    let mut update_rank = connection.prepare(
        "UPDATE database_view_page_positions SET rank_key = ?1 \
         WHERE view_id = ?2 AND page_block_id = ?3",
    )?;
    for (view_id, page_ids) in positions_by_view {
        let total = page_ids.len();
        for (index, page_id) in page_ids.into_iter().enumerate() {
            update_rank.execute(params![evenly_spaced_rank(index, total), view_id, page_id])?;
        }
    }
    drop(update_rank);
    connection.execute_batch(
        "DROP INDEX idx_database_view_page_positions_order; \
         ALTER TABLE database_view_page_positions DROP COLUMN group_key; \
         CREATE INDEX idx_database_view_page_positions_order \
           ON database_view_page_positions(view_id, rank_key, page_block_id);",
    )?;
    validate_database_view_global_rank_invariants(connection)
}

fn ensure_v114_database_list_authority(connection: &Connection) -> Result<(), StoreError> {
    let views = connection
        .prepare("SELECT id, config_json FROM database_views ORDER BY id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut update =
        connection.prepare("UPDATE database_views SET config_json = ?1 WHERE id = ?2")?;
    for (view_id, raw) in views {
        let mut config = serde_json::from_str::<Value>(&raw).map_err(|error| {
            corrupt(format!(
                "Database View {view_id} config is invalid: {error}"
            ))
        })?;
        let version = config.get("schemaVersion").and_then(Value::as_i64);
        if !matches!(version, Some(3 | 4)) {
            return Err(corrupt(format!(
                "Database View {view_id} cannot migrate to presentation v4"
            )));
        }
        let object = config
            .as_object_mut()
            .ok_or_else(|| corrupt(format!("Database View {view_id} config is invalid")))?;
        let mut changed = false;
        if version == Some(3) {
            object.insert("schemaVersion".to_owned(), json!(4));
            changed = true;
        }
        let presentation = object
            .get_mut("presentation")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| corrupt(format!("Database View {view_id} presentation is invalid")))?;
        if !presentation.contains_key("hierarchy") {
            presentation.insert(
                "hierarchy".to_owned(),
                json!({ "showSubPages": true, "nestedSubPages": false }),
            );
            changed = true;
        }
        if !presentation.contains_key("groupDirection") {
            presentation.insert("groupDirection".to_owned(), json!("asc"));
            changed = true;
        }
        if !changed {
            continue;
        }
        let serialized = serde_json::to_string(&config)
            .map_err(|_| internal("Database View v4 config could not be serialized"))?;
        update.execute(params![serialized, view_id])?;
    }
    drop(update);
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS database_task_hierarchy_edges (
          data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
          child_page_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
          parent_page_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
          sibling_rank TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (child_page_id <> parent_page_id),
          CHECK (length(sibling_rank) BETWEEN 1 AND 512)
        ) WITHOUT ROWID, STRICT;

        CREATE INDEX IF NOT EXISTS idx_database_task_hierarchy_parent_order
          ON database_task_hierarchy_edges(
            data_source_id, parent_page_id, sibling_rank, child_page_id
          );

        CREATE TABLE IF NOT EXISTS database_view_personal_preferences (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          view_id TEXT NOT NULL REFERENCES database_views(id) ON DELETE CASCADE,
          presentation_override_json TEXT NOT NULL,
          collapsed_group_keys_json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (profile_id, view_id),
          CHECK (
            json_valid(presentation_override_json)
            AND json_type(presentation_override_json) = 'object'
          ),
          CHECK (
            json_valid(collapsed_group_keys_json)
            AND json_type(collapsed_group_keys_json) = 'array'
          )
        ) WITHOUT ROWID, STRICT;

        CREATE TRIGGER IF NOT EXISTS database_task_hierarchy_require_memberships_insert
        BEFORE INSERT ON database_task_hierarchy_edges
        WHEN NOT EXISTS (
          SELECT 1 FROM data_source_page_memberships membership
          WHERE membership.data_source_id = NEW.data_source_id
            AND membership.page_block_id = NEW.child_page_id
            AND membership.removed_at IS NULL
        ) OR NOT EXISTS (
          SELECT 1 FROM data_source_page_memberships membership
          WHERE membership.data_source_id = NEW.data_source_id
            AND membership.page_block_id = NEW.parent_page_id
            AND membership.removed_at IS NULL
        )
        BEGIN
          SELECT RAISE(ABORT, 'Task hierarchy requires same-source active memberships');
        END;

        CREATE TRIGGER IF NOT EXISTS database_task_hierarchy_require_memberships_update
        BEFORE UPDATE OF data_source_id, child_page_id, parent_page_id
        ON database_task_hierarchy_edges
        WHEN NOT EXISTS (
          SELECT 1 FROM data_source_page_memberships membership
          WHERE membership.data_source_id = NEW.data_source_id
            AND membership.page_block_id = NEW.child_page_id
            AND membership.removed_at IS NULL
        ) OR NOT EXISTS (
          SELECT 1 FROM data_source_page_memberships membership
          WHERE membership.data_source_id = NEW.data_source_id
            AND membership.page_block_id = NEW.parent_page_id
            AND membership.removed_at IS NULL
        )
        BEGIN
          SELECT RAISE(ABORT, 'Task hierarchy requires same-source active memberships');
        END;

        CREATE TRIGGER IF NOT EXISTS database_task_hierarchy_remove_inactive_membership
        AFTER UPDATE OF removed_at ON data_source_page_memberships
        WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL
        BEGIN
          DELETE FROM database_task_hierarchy_edges
          WHERE data_source_id = NEW.data_source_id
            AND (
              child_page_id = NEW.page_block_id
              OR parent_page_id = NEW.page_block_id
            );
        END;
        "#,
    )?;
    validate_database_view_layout_invariants(connection)
}

fn ensure_v115_task_parent_relation_authority(
    connection: &Connection,
    now: u64,
) -> Result<(), StoreError> {
    let updated_at = migration_timestamp(now)?;
    if !table_has_column(connection, "data_source_relation_properties", "cardinality")? {
        connection.execute_batch(
            "ALTER TABLE data_source_relation_properties \
               ADD COLUMN cardinality TEXT NOT NULL DEFAULT 'many' \
               CHECK (cardinality IN ('one', 'many'));",
        )?;
    }
    if !table_has_column(connection, "data_source_relation_edges", "sibling_rank")? {
        connection.execute_batch(
            "ALTER TABLE data_source_relation_edges \
               ADD COLUMN sibling_rank TEXT \
               CHECK (sibling_rank IS NULL OR length(sibling_rank) BETWEEN 1 AND 512);",
        )?;
    }

    let data_source_ids = connection
        .prepare("SELECT id FROM data_sources WHERE lifecycle = 'active' ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for data_source_id in data_source_ids {
        let existing = connection
            .query_row(
                "SELECT value_type, config_json, lifecycle FROM data_source_properties \
                 WHERE data_source_id = ?1 AND id = 'task_parent'",
                [&data_source_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        match existing {
            Some((value_type, config_json, lifecycle))
                if value_type == "relation" && config_json == "{}" && lifecycle == "active" => {}
            Some(_) => {
                return Err(corrupt(format!(
                    "Data Source {data_source_id} has a conflicting task_parent Property"
                )));
            }
            None => {
                connection.execute(
                    "INSERT INTO data_source_properties(\
                       data_source_id, id, name, value_type, config_json, rank_key, lifecycle, \
                       schema_revision, created_at, updated_at\
                     ) VALUES (?1, 'task_parent', 'Parent', 'relation', '{}', \
                               '00000000000000000000000000000000', 'active', 1, ?2, ?2)",
                    params![data_source_id, updated_at],
                )?;
            }
        }

        let relation = connection
            .query_row(
                "SELECT target_data_source_id, cardinality \
                 FROM data_source_relation_properties \
                 WHERE data_source_id = ?1 AND property_id = 'task_parent'",
                [&data_source_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        match relation {
            Some((target_data_source_id, cardinality))
                if target_data_source_id == data_source_id && cardinality == "one" => {}
            Some(_) => {
                return Err(corrupt(format!(
                    "Data Source {data_source_id} has a conflicting task_parent Relation definition"
                )));
            }
            None => {
                connection.execute(
                    "INSERT INTO data_source_relation_properties(\
                       data_source_id, property_id, target_data_source_id, cardinality\
                     ) VALUES (?1, 'task_parent', ?1, 'one')",
                    [&data_source_id],
                )?;
            }
        }

        let property_ids = connection
            .prepare(
                "SELECT id FROM data_source_properties \
                 WHERE data_source_id = ?1 AND lifecycle = 'active' \
                 ORDER BY id = 'task_parent', rank_key, id",
            )?
            .query_map([&data_source_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let total = property_ids.len();
        let mut update_rank = connection.prepare(
            "UPDATE data_source_properties SET rank_key = ?1 \
             WHERE data_source_id = ?2 AND id = ?3",
        )?;
        for (index, property_id) in property_ids.into_iter().enumerate() {
            update_rank.execute(params![
                evenly_spaced_rank(index, total),
                data_source_id,
                property_id
            ])?;
        }
        let source_changed = connection.execute(
            "UPDATE data_sources SET schema_revision = schema_revision + 1, updated_at = ?1 \
             WHERE id = ?2 AND lifecycle = 'active'",
            params![updated_at, data_source_id],
        )?;
        if source_changed != 1 {
            return Err(corrupt(format!(
                "Data Source {data_source_id} disappeared during Parent migration"
            )));
        }
    }

    connection.execute(
        "INSERT INTO data_source_property_values(\
           data_source_id, membership_id, property_id, value_type, value_json, revision, updated_at\
         ) \
         SELECT membership.data_source_id, membership.id, 'task_parent', 'relation', 'null', \
                COALESCE(hierarchy.revision, 1), COALESCE(hierarchy.updated_at, ?1) \
         FROM data_source_page_memberships membership \
         JOIN data_source_properties property \
           ON property.data_source_id = membership.data_source_id \
          AND property.id = 'task_parent' AND property.lifecycle = 'active' \
         LEFT JOIN database_task_hierarchy_edges hierarchy \
           ON hierarchy.data_source_id = membership.data_source_id \
          AND hierarchy.child_page_id = membership.page_block_id \
         WHERE membership.removed_at IS NULL \
           AND NOT EXISTS (\
             SELECT 1 FROM data_source_property_values value \
             WHERE value.data_source_id = membership.data_source_id \
               AND value.membership_id = membership.id \
               AND value.property_id = 'task_parent'\
           )",
        [&updated_at],
    )?;
    connection.execute(
        "INSERT INTO data_source_relation_edges(\
           edge_id, source_data_source_id, source_membership_id, property_id, \
           target_page_block_id, created_at, sibling_rank\
         ) \
         SELECT lower(hex(randomblob(32))), hierarchy.data_source_id, membership.id, \
                'task_parent', hierarchy.parent_page_id, hierarchy.created_at, \
                hierarchy.sibling_rank \
         FROM database_task_hierarchy_edges hierarchy \
         JOIN data_source_page_memberships membership \
           ON membership.data_source_id = hierarchy.data_source_id \
          AND membership.page_block_id = hierarchy.child_page_id \
          AND membership.removed_at IS NULL \
         ORDER BY hierarchy.data_source_id, hierarchy.parent_page_id, \
                  hierarchy.sibling_rank, hierarchy.child_page_id",
        [],
    )?;

    connection.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS database_task_hierarchy_remove_inactive_membership;
        DROP TRIGGER IF EXISTS database_task_hierarchy_require_memberships_insert;
        DROP TRIGGER IF EXISTS database_task_hierarchy_require_memberships_update;
        DROP INDEX IF EXISTS idx_database_task_hierarchy_parent_order;
        DROP TABLE database_task_hierarchy_edges;

        DROP TRIGGER data_source_relation_edges_are_immutable;
        CREATE TRIGGER data_source_relation_edges_are_immutable
        BEFORE UPDATE OF edge_id, source_data_source_id, source_membership_id,
                         property_id, target_page_block_id, created_at
        ON data_source_relation_edges
        BEGIN
          SELECT RAISE(ABORT, 'Relation edge identity is immutable');
        END;

        CREATE UNIQUE INDEX idx_data_source_task_parent_single_target
          ON data_source_relation_edges(
            source_data_source_id, source_membership_id, property_id
          ) WHERE property_id = 'task_parent';

        CREATE INDEX idx_data_source_task_parent_children_order
          ON data_source_relation_edges(
            source_data_source_id, property_id, target_page_block_id,
            sibling_rank, source_membership_id
          ) WHERE property_id = 'task_parent';

        CREATE TRIGGER data_source_relation_edge_rank_validate_insert
        BEFORE INSERT ON data_source_relation_edges
        WHEN (
          NEW.property_id = 'task_parent'
          AND (
            NEW.sibling_rank IS NULL
            OR length(NEW.sibling_rank) <> 32
            OR NEW.sibling_rank GLOB '*[^0-9a-f]*'
            OR NEW.target_page_block_id = (
              SELECT membership.page_block_id
              FROM data_source_page_memberships membership
              WHERE membership.data_source_id = NEW.source_data_source_id
                AND membership.id = NEW.source_membership_id
            )
          )
        ) OR (NEW.property_id <> 'task_parent' AND NEW.sibling_rank IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'Relation edge rank does not match Property semantics');
        END;

        CREATE TRIGGER data_source_relation_edge_rank_validate_update
        BEFORE UPDATE OF sibling_rank ON data_source_relation_edges
        WHEN (
          NEW.property_id = 'task_parent'
          AND (
            NEW.sibling_rank IS NULL
            OR length(NEW.sibling_rank) <> 32
            OR NEW.sibling_rank GLOB '*[^0-9a-f]*'
          )
        ) OR (NEW.property_id <> 'task_parent' AND NEW.sibling_rank IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'Relation edge rank does not match Property semantics');
        END;

        CREATE TRIGGER data_source_relation_edge_cardinality_validate_insert
        BEFORE INSERT ON data_source_relation_edges
        WHEN EXISTS (
          SELECT 1 FROM data_source_relation_properties relation
          WHERE relation.data_source_id = NEW.source_data_source_id
            AND relation.property_id = NEW.property_id
            AND relation.cardinality = 'one'
        ) AND EXISTS (
          SELECT 1 FROM data_source_relation_edges existing
          WHERE existing.source_data_source_id = NEW.source_data_source_id
            AND existing.source_membership_id = NEW.source_membership_id
            AND existing.property_id = NEW.property_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'Cardinality-one Relation accepts at most one target');
        END;

        CREATE TRIGGER data_source_task_parent_relation_is_standard
        BEFORE INSERT ON data_source_relation_properties
        WHEN NEW.property_id = 'task_parent'
          AND (
            NEW.target_data_source_id <> NEW.data_source_id
            OR NEW.cardinality <> 'one'
          )
        BEGIN
          SELECT RAISE(ABORT, 'Task Parent must be a cardinality-one self Relation');
        END;

        CREATE TRIGGER data_source_task_parent_property_is_standard
        BEFORE UPDATE OF data_source_id, id, value_type, config_json, lifecycle
        ON data_source_properties
        WHEN OLD.id = 'task_parent'
          AND (
            NEW.data_source_id <> OLD.data_source_id
            OR NEW.id <> OLD.id
            OR NEW.value_type <> 'relation'
            OR NEW.config_json <> '{}'
            OR NEW.lifecycle <> 'active'
          )
        BEGIN
          SELECT RAISE(ABORT, 'Task Parent is a required standard Relation Property');
        END;

        CREATE TRIGGER data_source_task_parent_property_validate_insert
        BEFORE INSERT ON data_source_properties
        WHEN NEW.id = 'task_parent'
          AND (
            NEW.value_type <> 'relation'
            OR NEW.config_json <> '{}'
            OR NEW.lifecycle <> 'active'
          )
        BEGIN
          SELECT RAISE(ABORT, 'Task Parent is a required standard Relation Property');
        END;

        CREATE TRIGGER data_source_task_parent_property_prevent_delete
        BEFORE DELETE ON data_source_properties
        WHEN OLD.id = 'task_parent'
          AND EXISTS (
            SELECT 1 FROM data_sources source
            WHERE source.id = OLD.data_source_id AND source.lifecycle = 'active'
          )
        BEGIN
          SELECT RAISE(ABORT, 'Task Parent is a required standard Relation Property');
        END;

        CREATE TRIGGER data_source_task_parent_relation_prevent_delete
        BEFORE DELETE ON data_source_relation_properties
        WHEN OLD.property_id = 'task_parent'
          AND EXISTS (
            SELECT 1 FROM data_sources source
            WHERE source.id = OLD.data_source_id AND source.lifecycle = 'active'
          )
        BEGIN
          SELECT RAISE(ABORT, 'Task Parent Relation definition is required');
        END;

        CREATE TRIGGER data_source_task_parent_remove_inactive_membership
        AFTER UPDATE OF removed_at ON data_source_page_memberships
        WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL
        BEGIN
          UPDATE data_source_property_values
          SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE data_source_id = NEW.data_source_id
            AND property_id = 'task_parent'
            AND EXISTS (
            SELECT 1 FROM data_source_relation_edges edge
            WHERE edge.source_data_source_id = NEW.data_source_id
              AND edge.property_id = 'task_parent'
              AND edge.source_data_source_id = data_source_property_values.data_source_id
              AND edge.source_membership_id = data_source_property_values.membership_id
              AND edge.property_id = data_source_property_values.property_id
              AND (
                edge.source_membership_id = NEW.id
                OR edge.target_page_block_id = NEW.page_block_id
              )
          );
          DELETE FROM data_source_relation_edges
          WHERE source_data_source_id = NEW.data_source_id
            AND property_id = 'task_parent'
            AND (
              source_membership_id = NEW.id
              OR target_page_block_id = NEW.page_block_id
            );
        END;
        "#,
    )?;
    validate_database_relation_invariants(connection)
}

fn ensure_v116_view_personal_state(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS database_view_personal_presentations (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          view_id TEXT NOT NULL REFERENCES database_views(id) ON DELETE CASCADE,
          presentation_override_json TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (profile_id, view_id),
          CHECK (
            json_valid(presentation_override_json)
            AND json_type(presentation_override_json) = 'object'
          )
        ) WITHOUT ROWID, STRICT;

        CREATE TABLE IF NOT EXISTS database_view_collapsed_occurrences (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          view_id TEXT NOT NULL REFERENCES database_views(id) ON DELETE CASCADE,
          target_kind TEXT NOT NULL,
          occurrence_key TEXT NOT NULL,
          collapsed_at TEXT NOT NULL,
          PRIMARY KEY (profile_id, view_id, target_kind, occurrence_key),
          CHECK (target_kind IN ('group', 'page')),
          CHECK (length(occurrence_key) BETWEEN 1 AND 1024),
          CHECK (
            (target_kind = 'group' AND substr(occurrence_key, 1, 6) = 'GROUP_')
            OR (target_kind = 'page' AND substr(occurrence_key, 1, 5) = 'ITEM_')
          )
        ) WITHOUT ROWID, STRICT;

        CREATE INDEX IF NOT EXISTS idx_database_view_collapsed_occurrences_age
          ON database_view_collapsed_occurrences(
            profile_id, view_id, collapsed_at, target_kind, occurrence_key
          );
        "#,
    )?;

    let legacy_exists = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema \
         WHERE type = 'table' AND name = 'database_view_personal_preferences')",
        [],
        |row| row.get::<_, bool>(0),
    )?;
    if !legacy_exists {
        return Ok(());
    }

    let rows = connection
        .prepare(
            "SELECT profile_id, view_id, presentation_override_json, \
                    collapsed_group_keys_json, created_at, updated_at \
             FROM database_view_personal_preferences ORDER BY profile_id, view_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (profile_id, view_id, presentation_json, collapsed_json, created_at, updated_at) in rows {
        let presentation = serde_json::from_str::<Value>(&presentation_json)
            .map_err(|_| corrupt("Legacy View personal presentation is invalid"))?;
        let presentation = presentation
            .as_object()
            .ok_or_else(|| corrupt("Legacy View personal presentation is not an object"))?;
        if !presentation.is_empty() {
            connection.execute(
                "INSERT INTO database_view_personal_presentations(\
                   profile_id, view_id, presentation_override_json, revision, \
                   created_at, updated_at\
                 ) VALUES (?1, ?2, ?3, 1, ?4, ?5)",
                params![
                    profile_id,
                    view_id,
                    presentation_json,
                    created_at,
                    updated_at
                ],
            )?;
        }

        let collapsed = serde_json::from_str::<Value>(&collapsed_json)
            .map_err(|_| corrupt("Legacy View collapsed occurrences are invalid"))?;
        let collapsed = collapsed
            .as_array()
            .ok_or_else(|| corrupt("Legacy View collapsed occurrences are not an array"))?;
        let mut targets = BTreeSet::new();
        for candidate in collapsed {
            let Some(candidate) = candidate.as_str() else {
                continue;
            };
            let target = if candidate.starts_with("GROUP_") {
                Some(("group", candidate))
            } else if let Some(occurrence_key) = candidate.strip_prefix("PARENT_") {
                occurrence_key
                    .starts_with("ITEM_")
                    .then_some(("page", occurrence_key))
            } else {
                candidate
                    .starts_with("ITEM_")
                    .then_some(("page", candidate))
            };
            let Some((kind, occurrence_key)) = target else {
                continue;
            };
            if occurrence_key.is_empty() || occurrence_key.len() > 1_024 {
                continue;
            }
            targets.insert((kind.to_owned(), occurrence_key.to_owned()));
        }
        for (target_kind, occurrence_key) in targets.into_iter().take(2_000) {
            connection.execute(
                "INSERT INTO database_view_collapsed_occurrences(\
                   profile_id, view_id, target_kind, occurrence_key, collapsed_at\
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![profile_id, view_id, target_kind, occurrence_key, updated_at],
            )?;
        }
    }
    connection.execute_batch("DROP TABLE database_view_personal_preferences;")?;
    Ok(())
}

fn ensure_v121_page_key_authority(connection: &Connection, now: u64) -> Result<(), StoreError> {
    connection.execute_batch(V121_PAGE_KEY_SCHEMA_SQL)?;
    let assigned_at = migration_timestamp(now)?;
    migrate_page_key_display_fields(connection, &assigned_at)?;
    backfill_v121_page_keys(connection, &assigned_at)?;
    validate_v121_page_key_invariants(connection)
}

fn migrate_page_key_display_fields(
    connection: &Connection,
    migrated_at: &str,
) -> Result<(), StoreError> {
    let durable_views = connection
        .prepare(
            "SELECT view.id, view.config_json FROM database_views view \
             WHERE EXISTS ( \
               SELECT 1 FROM project_database_bindings binding \
               WHERE binding.database_block_id = view.database_block_id \
             ) ORDER BY view.id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (view_id, config_json) in durable_views {
        let mut raw = serde_json::from_str::<Value>(&config_json)
            .map_err(|_| corrupt("Page-key display migration found an invalid Database View"))?;
        let removed_page_id =
            remove_v121_legacy_page_id_fields(&mut raw, &["presentation", "layouts"]);
        let mut stored = serde_json::from_value::<V121StoredViewDefinition>(raw)
            .map_err(|_| corrupt("Page-key display migration found an invalid Database View"))?;
        stored.validate()?;
        let board_changed =
            canonicalize_board_fields(&mut stored.presentation.layouts.board.fields, |field| {
                matches!(
                    field,
                    DatabaseViewField::Intrinsic {
                        field: DatabaseViewIntrinsicField::PageKey
                    }
                )
            });
        let list_changed =
            canonicalize_list_page_key_fields(&mut stored.presentation.layouts.list.fields);
        if !removed_page_id && !board_changed && !list_changed {
            continue;
        }
        let encoded = serde_json::to_string(&stored)
            .map_err(|_| corrupt("Page-key display migration could not encode a Database View"))?;
        connection.execute(
            "UPDATE database_views SET config_json = ?1, revision = revision + 1, \
               updated_at = ?2 WHERE id = ?3",
            params![encoded, migrated_at, view_id],
        )?;
    }

    let personal_presentations = connection
        .prepare(
            "SELECT personal.profile_id, personal.view_id, personal.presentation_override_json \
             FROM database_view_personal_presentations personal \
             JOIN database_views view ON view.id = personal.view_id \
             WHERE EXISTS ( \
               SELECT 1 FROM project_database_bindings binding \
               WHERE binding.database_block_id = view.database_block_id \
             ) ORDER BY personal.profile_id, personal.view_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (profile_id, view_id, override_json) in personal_presentations {
        let mut raw = serde_json::from_str::<Value>(&override_json)
            .map_err(|_| corrupt("Page-key display migration found an invalid personal View"))?;
        let removed_page_id = remove_v121_legacy_page_id_fields(&mut raw, &["layouts"]);
        let mut presentation = serde_json::from_value::<DatabaseViewPresentationOverrideInput>(raw)
            .map_err(|_| corrupt("Page-key display migration found an invalid personal View"))?;
        let canonicalized = normalize_personal_page_key_fields(&mut presentation);
        if !removed_page_id && !canonicalized {
            continue;
        }
        let encoded = serde_json::to_string(&presentation)
            .map_err(|_| corrupt("Page-key display migration could not encode a personal View"))?;
        connection.execute(
            "UPDATE database_view_personal_presentations \
             SET presentation_override_json = ?1, revision = revision + 1, updated_at = ?2 \
             WHERE profile_id = ?3 AND view_id = ?4",
            params![encoded, migrated_at, profile_id, view_id],
        )?;
    }
    Ok(())
}

fn remove_v121_legacy_page_id_fields(value: &mut Value, path: &[&str]) -> bool {
    // Older Stores could persist UUID presentation state that the current
    // contract intentionally makes unrepresentable. Strip only that retired
    // discriminant before decoding the rest through the typed contract.
    let mut cursor = value;
    for segment in path {
        let Some(next) = cursor.get_mut(*segment) else {
            return false;
        };
        cursor = next;
    }
    let Some(layouts) = cursor.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for layout_name in ["board", "list"] {
        let Some(fields) = layouts
            .get_mut(layout_name)
            .and_then(Value::as_object_mut)
            .and_then(|layout| layout.get_mut("fields"))
            .and_then(Value::as_array_mut)
        else {
            continue;
        };
        let original_len = fields.len();
        fields.retain(|field| {
            field.get("kind").and_then(Value::as_str) != Some("intrinsic")
                || field.get("field").and_then(Value::as_str) != Some("page_id")
        });
        changed |= fields.len() != original_len;
    }
    changed
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct V121StoredViewDefinition {
    schema_key: String,
    schema_version: u32,
    filter: DatabaseViewFilter,
    presentation: DatabaseViewPresentation,
}

impl V121StoredViewDefinition {
    fn validate(&self) -> Result<(), StoreError> {
        if self.schema_key != "nodex.database-view" || self.schema_version != 4 {
            return Err(corrupt(
                "Page-key display migration found a View outside the v4 presentation boundary",
            ));
        }
        Ok(())
    }
}

fn canonicalize_list_page_key_fields(fields: &mut Vec<DatabaseViewField>) -> bool {
    canonicalize_page_key_first(
        fields,
        DatabaseViewField::Intrinsic {
            field: DatabaseViewIntrinsicField::PageKey,
        },
        |field| {
            matches!(
                field,
                DatabaseViewField::Intrinsic {
                    field: DatabaseViewIntrinsicField::PageKey
                }
            )
        },
    )
}

fn normalize_personal_page_key_fields(
    presentation: &mut DatabaseViewPresentationOverrideInput,
) -> bool {
    let Some(layouts) = presentation.layouts.as_mut() else {
        return false;
    };
    let mut changed = false;
    if let Some(fields) = layouts
        .board
        .as_mut()
        .and_then(|layout| layout.fields.as_mut())
    {
        changed |= canonicalize_board_fields(fields, |field| {
            matches!(
                field,
                DatabaseViewFieldInput::Intrinsic {
                    field: DatabaseViewIntrinsicField::PageKey
                }
            )
        });
    }
    if let Some(fields) = layouts
        .list
        .as_mut()
        .and_then(|layout| layout.fields.as_mut())
    {
        changed |= canonicalize_page_key_first(
            fields,
            DatabaseViewFieldInput::Intrinsic {
                field: DatabaseViewIntrinsicField::PageKey,
            },
            |field| {
                matches!(
                    field,
                    DatabaseViewFieldInput::Intrinsic {
                        field: DatabaseViewIntrinsicField::PageKey
                    }
                )
            },
        );
    }
    changed
}

fn canonicalize_board_fields<T: Clone + Eq>(
    fields: &mut Vec<T>,
    is_page_key: impl Fn(&T) -> bool,
) -> bool {
    let mut canonical = Vec::with_capacity(fields.len());
    for field in fields.iter() {
        if is_page_key(field) || canonical.contains(field) {
            continue;
        }
        canonical.push(field.clone());
    }
    if *fields == canonical {
        return false;
    }
    *fields = canonical;
    true
}

fn canonicalize_page_key_first<T: Clone + Eq>(
    fields: &mut Vec<T>,
    page_key: T,
    is_page_key: impl Fn(&T) -> bool,
) -> bool {
    let mut canonical = Vec::with_capacity(fields.len() + 1);
    canonical.push(page_key);
    for field in fields.iter() {
        if is_page_key(field) || canonical.contains(field) {
            continue;
        }
        canonical.push(field.clone());
    }
    if *fields == canonical {
        return false;
    }
    *fields = canonical;
    true
}

fn backfill_v121_page_keys(connection: &Connection, now: &str) -> Result<(), StoreError> {
    let bindings = connection
        .prepare(
            "SELECT binding.library_id, binding.database_block_id, container.library_id, \
               project.library_id, project.name, project.created, project.id \
             FROM project_database_bindings binding \
             JOIN projects project ON project.id = binding.project_id \
             JOIN database_containers container \
               ON container.block_id = binding.database_block_id \
             ORDER BY binding.library_id, project.created, project.id, \
               binding.database_block_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut migrated_databases = BTreeSet::new();
    for (
        binding_library_id,
        database_block_id,
        database_library_id,
        project_library_id,
        project_name,
    ) in bindings
    {
        if database_library_id != binding_library_id
            || project_library_id.as_deref() != Some(binding_library_id.as_str())
        {
            return Err(corrupt(format!(
                "Project binding for Database {database_block_id} crosses Library ownership"
            )));
        }
        if !migrated_databases.insert(database_block_id.clone()) {
            continue;
        }
        create_page_key_namespace(
            connection,
            &binding_library_id,
            &database_block_id,
            None,
            &project_name,
            now,
        )?;
        let page_ids = connection
            .prepare(
                "SELECT membership.page_block_id, MIN(membership.created_at), page.created_at \
                 FROM data_sources source \
                 JOIN data_source_page_memberships membership \
                   ON membership.data_source_id = source.id \
                 JOIN pages page ON page.block_id = membership.page_block_id \
                 WHERE source.home_database_block_id = ?1 \
                   AND source.library_id = ?2 AND page.library_id = ?2 \
                 GROUP BY membership.page_block_id, page.created_at \
                 ORDER BY MIN(membership.created_at), page.created_at, \
                   membership.page_block_id",
            )?
            .query_map(params![database_block_id, binding_library_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for page_id in page_ids {
            if ensure_database_page_key(
                connection,
                &binding_library_id,
                &database_block_id,
                &page_id,
                now,
            )?
            .is_none()
            {
                return Err(corrupt(format!(
                    "v121 Page-key namespace disappeared while backfilling Database {database_block_id}"
                )));
            }
        }
    }
    Ok(())
}

fn validate_v121_page_key_invariants(connection: &Connection) -> Result<(), StoreError> {
    let bound_without_namespace = connection
        .query_row(
            "SELECT binding.database_block_id \
             FROM project_database_bindings binding \
             LEFT JOIN page_key_namespaces namespace \
               ON namespace.database_block_id = binding.database_block_id \
              AND namespace.library_id = binding.library_id \
             WHERE namespace.database_block_id IS NULL LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(database_id) = bound_without_namespace {
        return Err(corrupt(format!(
            "Project-bound Database {database_id} has no Page-key namespace"
        )));
    }
    let missing_current_prefix = connection
        .query_row(
            "SELECT namespace.database_block_id \
             FROM page_key_namespaces namespace \
             LEFT JOIN page_key_prefixes prefix \
               ON prefix.database_block_id = namespace.database_block_id \
              AND prefix.library_id = namespace.library_id \
              AND prefix.retired_at IS NULL \
             GROUP BY namespace.database_block_id \
             HAVING count(prefix.normalized_prefix) <> 1 LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(database_id) = missing_current_prefix {
        return Err(corrupt(format!(
            "Page-key namespace {database_id} does not have exactly one current prefix"
        )));
    }
    let invalid_counter = connection
        .query_row(
            "SELECT namespace.database_block_id \
             FROM page_key_namespaces namespace \
             LEFT JOIN page_key_assignments assignment \
               ON assignment.database_block_id = namespace.database_block_id \
             GROUP BY namespace.database_block_id, namespace.next_number \
             HAVING namespace.next_number <= COALESCE(MAX(assignment.number), 0) LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(database_id) = invalid_counter {
        return Err(corrupt(format!(
            "Page-key namespace {database_id} counter does not exceed its assignments"
        )));
    }
    let invalid_retired_range = connection
        .query_row(
            "SELECT prefix.normalized_prefix \
             FROM page_key_prefixes prefix \
             JOIN page_key_namespaces namespace \
               ON namespace.database_block_id = prefix.database_block_id \
              AND namespace.library_id = prefix.library_id \
             WHERE prefix.retired_at IS NOT NULL \
               AND prefix.last_number >= namespace.next_number LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(prefix) = invalid_retired_range {
        return Err(corrupt(format!(
            "Retired Page-key prefix {prefix} exceeds its namespace counter"
        )));
    }
    let invalid_assignment_authority = connection
        .query_row(
            "SELECT assignment.page_block_id \
             FROM page_key_assignments assignment \
             JOIN page_key_namespaces namespace \
               ON namespace.database_block_id = assignment.database_block_id \
             LEFT JOIN pages page ON page.block_id = assignment.page_block_id \
             LEFT JOIN retired_block_identities retired \
               ON retired.block_id = assignment.page_block_id \
              AND retired.block_type = 'page' \
             WHERE (page.block_id IS NOT NULL AND page.library_id <> namespace.library_id) \
                OR (page.block_id IS NULL AND ( \
                  retired.block_id IS NULL OR retired.library_id <> namespace.library_id \
                )) LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(page_id) = invalid_assignment_authority {
        return Err(corrupt(format!(
            "Page-key assignment for Page {page_id} has no same-Library live or retired authority"
        )));
    }
    Ok(())
}

fn validate_database_view_global_rank_invariants(
    connection: &Connection,
) -> Result<(), StoreError> {
    if table_has_column(connection, "database_view_page_positions", "group_key")? {
        return Err(corrupt(
            "Database View manual positions still contain group authority",
        ));
    }
    let index_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_schema \
             WHERE type = 'index' AND name = 'idx_database_view_page_positions_order'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if !index_sql.is_some_and(|sql| {
        sql.contains("view_id, rank_key, page_block_id") && !sql.contains("group_key")
    }) {
        return Err(corrupt(
            "Database View manual position index is not View-global",
        ));
    }
    Ok(())
}

fn validate_database_relation_invariants(connection: &Connection) -> Result<(), StoreError> {
    let relation_table_count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema \
         WHERE type = 'table' AND name IN (\
           'data_source_relation_properties', 'data_source_relation_edges'\
         )",
        [],
        |row| row.get(0),
    )?;
    if relation_table_count == 0 {
        return Ok(());
    }
    if relation_table_count != 2 {
        return Err(corrupt("Relation Property authority tables are incomplete"));
    }
    if !table_has_column(connection, "data_source_relation_properties", "cardinality")?
        || !table_has_column(connection, "data_source_relation_edges", "sibling_rank")?
    {
        return validate_legacy_database_relation_invariants(connection);
    }

    let invalid_definitions: i64 = connection.query_row(
        "SELECT count(*) \
         FROM data_source_relation_properties relation \
         LEFT JOIN data_source_properties property \
           ON property.data_source_id = relation.data_source_id \
           AND property.id = relation.property_id \
         LEFT JOIN data_sources source ON source.id = relation.data_source_id \
         LEFT JOIN data_sources target ON target.id = relation.target_data_source_id \
         WHERE property.value_type IS NOT 'relation' \
           OR property.config_json <> '{}' \
           OR relation.cardinality NOT IN ('one', 'many') \
           OR source.library_id IS NULL \
           OR target.library_id IS NULL \
           OR source.library_id <> target.library_id",
        [],
        |row| row.get(0),
    )?;
    let missing_definitions: i64 = connection.query_row(
        "SELECT count(*) FROM data_source_properties property \
         WHERE property.value_type = 'relation' \
           AND NOT EXISTS (\
             SELECT 1 FROM data_source_relation_properties relation \
             WHERE relation.data_source_id = property.data_source_id \
               AND relation.property_id = property.id\
           )",
        [],
        |row| row.get(0),
    )?;
    let invalid_headers: i64 = connection.query_row(
        "SELECT count(*) FROM data_source_property_values value \
         WHERE value.value_type = 'relation' \
           AND json_type(value.value_json) IS NOT 'null'",
        [],
        |row| row.get(0),
    )?;
    let invalid_edges: i64 = connection.query_row(
        "SELECT count(*) \
         FROM data_source_relation_edges edge \
         JOIN data_source_relation_properties relation \
           ON relation.data_source_id = edge.source_data_source_id \
           AND relation.property_id = edge.property_id \
         LEFT JOIN data_source_property_values value \
           ON value.data_source_id = edge.source_data_source_id \
           AND value.membership_id = edge.source_membership_id \
           AND value.property_id = edge.property_id \
         LEFT JOIN blocks target_block ON target_block.id = edge.target_page_block_id \
         LEFT JOIN pages target_page ON target_page.block_id = edge.target_page_block_id \
         WHERE value.value_type IS NOT 'relation' \
           OR json_type(value.value_json) IS NOT 'null' \
           OR target_block.type IS NOT 'page' \
           OR target_page.block_id IS NULL \
           OR NOT EXISTS (\
             SELECT 1 FROM data_source_page_memberships target_membership \
             WHERE target_membership.page_block_id = edge.target_page_block_id \
               AND target_membership.data_source_id = relation.target_data_source_id\
           )",
        [],
        |row| row.get(0),
    )?;
    let cardinality_violations: i64 = connection.query_row(
        "SELECT count(*) FROM (\
           SELECT edge.source_data_source_id, edge.source_membership_id, edge.property_id \
           FROM data_source_relation_edges edge \
           JOIN data_source_relation_properties relation \
             ON relation.data_source_id = edge.source_data_source_id \
            AND relation.property_id = edge.property_id \
           WHERE relation.cardinality = 'one' \
           GROUP BY edge.source_data_source_id, edge.source_membership_id, edge.property_id \
           HAVING count(*) > 1\
         )",
        [],
        |row| row.get(0),
    )?;
    let invalid_task_parent_definitions: i64 = connection.query_row(
        "SELECT count(*) FROM data_sources source \
         LEFT JOIN data_source_properties property \
           ON property.data_source_id = source.id AND property.id = 'task_parent' \
         LEFT JOIN data_source_relation_properties relation \
           ON relation.data_source_id = source.id AND relation.property_id = 'task_parent' \
         WHERE source.lifecycle = 'active' \
           AND (\
             property.value_type IS NOT 'relation' \
             OR property.config_json <> '{}' \
             OR property.lifecycle IS NOT 'active' \
             OR relation.target_data_source_id IS NOT source.id \
             OR relation.cardinality IS NOT 'one'\
           )",
        [],
        |row| row.get(0),
    )?;
    let missing_task_parent_headers: i64 = connection.query_row(
        "SELECT count(*) FROM data_source_page_memberships membership \
         JOIN data_sources source \
           ON source.id = membership.data_source_id AND source.lifecycle = 'active' \
         LEFT JOIN data_source_property_values value \
           ON value.data_source_id = membership.data_source_id \
          AND value.membership_id = membership.id \
          AND value.property_id = 'task_parent' \
         WHERE membership.removed_at IS NULL \
           AND (\
             value.value_type IS NOT 'relation' \
             OR json_type(value.value_json) IS NOT 'null' \
             OR value.revision IS NULL OR value.revision < 1\
           )",
        [],
        |row| row.get(0),
    )?;
    let invalid_task_parent_edges: i64 = connection.query_row(
        "SELECT count(*) FROM data_source_relation_edges edge \
         JOIN data_source_page_memberships child \
           ON child.data_source_id = edge.source_data_source_id \
          AND child.id = edge.source_membership_id \
         WHERE edge.property_id = 'task_parent' \
           AND (\
             child.removed_at IS NOT NULL \
             OR child.page_block_id = edge.target_page_block_id \
             OR edge.sibling_rank IS NULL \
             OR length(edge.sibling_rank) <> 32 \
             OR edge.sibling_rank GLOB '*[^0-9a-f]*' \
             OR NOT EXISTS (\
               SELECT 1 FROM data_source_page_memberships parent \
               WHERE parent.data_source_id = edge.source_data_source_id \
                 AND parent.page_block_id = edge.target_page_block_id \
                 AND parent.removed_at IS NULL\
             )\
           )",
        [],
        |row| row.get(0),
    )?;
    let ranked_non_task_edges: i64 = connection.query_row(
        "SELECT count(*) FROM data_source_relation_edges \
         WHERE property_id <> 'task_parent' AND sibling_rank IS NOT NULL",
        [],
        |row| row.get(0),
    )?;
    let invalid = invalid_definitions
        .checked_add(missing_definitions)
        .and_then(|count| count.checked_add(invalid_headers))
        .and_then(|count| count.checked_add(invalid_edges))
        .and_then(|count| count.checked_add(cardinality_violations))
        .and_then(|count| count.checked_add(invalid_task_parent_definitions))
        .and_then(|count| count.checked_add(missing_task_parent_headers))
        .and_then(|count| count.checked_add(invalid_task_parent_edges))
        .and_then(|count| count.checked_add(ranked_non_task_edges))
        .ok_or_else(|| corrupt("Relation Property invariant count overflowed"))?;
    if invalid != 0 {
        return Err(corrupt(format!(
            "Relation Property authority contains {invalid} inconsistent records"
        )));
    }

    let parents = connection
        .prepare(
            "SELECT child.page_block_id, edge.target_page_block_id \
             FROM data_source_relation_edges edge \
             JOIN data_source_page_memberships child \
               ON child.data_source_id = edge.source_data_source_id \
              AND child.id = edge.source_membership_id \
             WHERE edge.property_id = 'task_parent' \
             ORDER BY child.page_block_id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    for page_id in parents.keys() {
        let mut cursor = Some(page_id.as_str());
        let mut visited = BTreeSet::new();
        let mut depth = 0usize;
        while let Some(current) = cursor {
            if !visited.insert(current) {
                return Err(corrupt("Task Parent Relation contains a cycle"));
            }
            cursor = parents.get(current).map(String::as_str);
            if cursor.is_none() {
                continue;
            }
            depth += 1;
            if depth > 10 {
                return Err(corrupt("Task Parent Relation exceeds depth 10"));
            }
        }
    }
    Ok(())
}

fn validate_legacy_database_relation_invariants(connection: &Connection) -> Result<(), StoreError> {
    let invalid_definitions: i64 = connection.query_row(
        "SELECT count(*) \
         FROM data_source_relation_properties relation \
         LEFT JOIN data_source_properties property \
           ON property.data_source_id = relation.data_source_id \
           AND property.id = relation.property_id \
         LEFT JOIN data_sources source ON source.id = relation.data_source_id \
         LEFT JOIN data_sources target ON target.id = relation.target_data_source_id \
         WHERE property.value_type IS NOT 'relation' \
           OR property.config_json <> '{}' \
           OR source.library_id IS NULL \
           OR target.library_id IS NULL \
           OR source.library_id <> target.library_id",
        [],
        |row| row.get(0),
    )?;
    let missing_definitions: i64 = connection.query_row(
        "SELECT count(*) FROM data_source_properties property \
         WHERE property.value_type = 'relation' \
           AND NOT EXISTS (\
             SELECT 1 FROM data_source_relation_properties relation \
             WHERE relation.data_source_id = property.data_source_id \
               AND relation.property_id = property.id\
           )",
        [],
        |row| row.get(0),
    )?;
    let invalid_headers: i64 = connection.query_row(
        "SELECT count(*) FROM data_source_property_values value \
         WHERE value.value_type = 'relation' \
           AND json_type(value.value_json) IS NOT 'null'",
        [],
        |row| row.get(0),
    )?;
    let invalid_edges: i64 = connection.query_row(
        "SELECT count(*) \
         FROM data_source_relation_edges edge \
         JOIN data_source_relation_properties relation \
           ON relation.data_source_id = edge.source_data_source_id \
           AND relation.property_id = edge.property_id \
         LEFT JOIN data_source_property_values value \
           ON value.data_source_id = edge.source_data_source_id \
           AND value.membership_id = edge.source_membership_id \
           AND value.property_id = edge.property_id \
         LEFT JOIN blocks target_block ON target_block.id = edge.target_page_block_id \
         LEFT JOIN pages target_page ON target_page.block_id = edge.target_page_block_id \
         WHERE value.value_type IS NOT 'relation' \
           OR json_type(value.value_json) IS NOT 'null' \
           OR target_block.type IS NOT 'page' \
           OR target_page.block_id IS NULL \
           OR NOT EXISTS (\
             SELECT 1 FROM data_source_page_memberships target_membership \
             WHERE target_membership.page_block_id = edge.target_page_block_id \
               AND target_membership.data_source_id = relation.target_data_source_id\
           )",
        [],
        |row| row.get(0),
    )?;
    let invalid = invalid_definitions
        .checked_add(missing_definitions)
        .and_then(|count| count.checked_add(invalid_headers))
        .and_then(|count| count.checked_add(invalid_edges))
        .ok_or_else(|| corrupt("Relation Property invariant count overflowed"))?;
    if invalid == 0 {
        return Ok(());
    }
    Err(corrupt(format!(
        "Relation Property authority contains {invalid} inconsistent records"
    )))
}

fn migration_timestamp(now: u64) -> Result<String, StoreError> {
    let millis =
        i64::try_from(now).map_err(|_| internal("Migration time exceeds the timestamp range"))?;
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| internal("Migration time is invalid"))
}

fn parse_priority_config(
    data_source_id: &str,
    raw: &str,
    allow_legacy_p4: bool,
) -> Result<(StoredPriorityConfig, PrioritySourceState), StoreError> {
    let config = serde_json::from_str::<StoredPriorityConfig>(raw).map_err(|error| {
        corrupt(format!(
            "Priority registry for Data Source {data_source_id} is invalid: {error}"
        ))
    })?;
    let mut ids = BTreeSet::new();
    let mut had_legacy_p4 = false;
    for option in &config.options {
        if option.id.is_empty() || option.name.trim().is_empty() {
            return Err(corrupt(format!(
                "Priority registry for Data Source {data_source_id} has an empty option identity or name"
            )));
        }
        if !ids.insert(option.id.clone()) {
            return Err(corrupt(format!(
                "Priority registry for Data Source {data_source_id} repeats option {}",
                option.id
            )));
        }
        if crate::database::property_semantics::is_priority_option_id(&option.id) {
            continue;
        }
        if allow_legacy_p4 && option.id == LEGACY_P4_PRIORITY_ID {
            had_legacy_p4 = true;
            continue;
        }
        return Err(corrupt(format!(
            "Priority registry for Data Source {data_source_id} contains unknown option {}",
            option.id
        )));
    }
    let current_ids = ids
        .into_iter()
        .filter(|id| crate::database::property_semantics::is_priority_option_id(id))
        .collect();
    Ok((
        config,
        PrioritySourceState {
            current_ids,
            had_legacy_p4,
        },
    ))
}

fn migrate_v110_priority_config(
    data_source_id: &str,
    raw: &str,
) -> Result<(Option<String>, PrioritySourceState), StoreError> {
    let (config, input) = parse_priority_config(data_source_id, raw, true)?;
    if !input.had_legacy_p4 {
        return Ok((None, input));
    }

    let has_p3 = config
        .options
        .iter()
        .any(|option| option.id == P3_PRIORITY_ID);
    let mut options = Vec::with_capacity(config.options.len());
    for mut option in config.options {
        if option.id != LEGACY_P4_PRIORITY_ID {
            options.push(option);
            continue;
        }
        if has_p3 {
            continue;
        }
        option.id = P3_PRIORITY_ID.to_owned();
        if option.name == LEGACY_P4_PRIORITY_NAME {
            option.name = P3_PRIORITY_NAME.to_owned();
        }
        options.push(option);
    }
    let migrated = StoredPriorityConfig { options };
    let serialized = serde_json::to_string(&migrated)
        .map_err(|_| internal("Migrated Priority registry could not be serialized"))?;
    let (_, mut output) = parse_priority_config(data_source_id, &serialized, false)?;
    output.had_legacy_p4 = true;
    Ok((Some(serialized), output))
}

fn ensure_v111_priority_contract(connection: &Connection, now: u64) -> Result<(), StoreError> {
    let updated_at = migration_timestamp(now)?;
    let properties = connection
        .prepare(
            "SELECT data_source_id, value_type, config_json \
             FROM data_source_properties WHERE id = 'priority' ORDER BY data_source_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut sources = BTreeMap::new();
    for (data_source_id, value_type, config_json) in properties {
        if value_type != "select" {
            return Err(corrupt(format!(
                "Priority Property for Data Source {data_source_id} is not a select"
            )));
        }
        let (migrated, state) = migrate_v110_priority_config(&data_source_id, &config_json)?;
        if let Some(migrated) = migrated {
            let property_changed = connection.execute(
                "UPDATE data_source_properties SET config_json = ?1, \
                   schema_revision = schema_revision + 1, updated_at = ?2 \
                 WHERE data_source_id = ?3 AND id = 'priority' AND config_json = ?4",
                params![migrated, updated_at, data_source_id, config_json],
            )?;
            if property_changed != 1 {
                return Err(corrupt(format!(
                    "Priority registry for Data Source {data_source_id} changed during migration"
                )));
            }
            let source_changed = connection.execute(
                "UPDATE data_sources SET schema_revision = schema_revision + 1, updated_at = ?1 \
                 WHERE id = ?2",
                params![updated_at, data_source_id],
            )?;
            if source_changed != 1 {
                return Err(corrupt(format!(
                    "Data Source {data_source_id} disappeared during Priority migration"
                )));
            }
        }
        sources.insert(data_source_id, state);
    }

    let mut metadata_pages = migrate_v110_priority_values(connection, &sources, &updated_at)?;
    migrate_v110_priority_views(connection, &updated_at, &mut metadata_pages)?;
    validate_database_priority_invariants(connection)
}

fn migrate_v110_priority_values(
    connection: &Connection,
    sources: &BTreeMap<String, PrioritySourceState>,
    updated_at: &str,
) -> Result<BTreeSet<String>, StoreError> {
    let values = connection
        .prepare(
            "SELECT value.data_source_id, value.membership_id, value.value_json, \
                    value.revision, membership.page_block_id, membership.removed_at \
             FROM data_source_property_values value \
             JOIN data_source_page_memberships membership \
               ON membership.id = value.membership_id \
               AND membership.data_source_id = value.data_source_id \
             WHERE value.property_id = 'priority' \
             ORDER BY value.data_source_id, value.membership_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut metadata_pages = BTreeSet::new();
    for (data_source_id, membership_id, raw, revision, page_id, removed_at) in values {
        let state = sources.get(&data_source_id).ok_or_else(|| {
            corrupt(format!(
                "Priority value for Data Source {data_source_id} has no Priority registry"
            ))
        })?;
        let value = serde_json::from_str::<Value>(&raw).map_err(|error| {
            corrupt(format!(
                "Priority value {data_source_id}/{membership_id} is invalid JSON: {error}"
            ))
        })?;
        if value.is_null() {
            continue;
        }
        let option_id = value.as_str().ok_or_else(|| {
            corrupt(format!(
                "Priority value {data_source_id}/{membership_id} is not a string or null"
            ))
        })?;
        if option_id == LEGACY_P4_PRIORITY_ID {
            if !state.had_legacy_p4 || !state.current_ids.contains(P3_PRIORITY_ID) {
                return Err(corrupt(format!(
                    "Priority value {data_source_id}/{membership_id} has no valid P4 to P3 registry mapping"
                )));
            }
            let next_revision = revision
                .checked_add(1)
                .ok_or_else(|| corrupt("Priority value revision overflowed"))?;
            let changed = connection.execute(
                "UPDATE data_source_property_values SET value_json = ?1, revision = ?2, \
                   updated_at = ?3 WHERE data_source_id = ?4 AND membership_id = ?5 \
                   AND property_id = 'priority' AND revision = ?6",
                params![
                    serde_json::to_string(P3_PRIORITY_ID)
                        .map_err(|_| internal("P3 Priority value could not be serialized"))?,
                    next_revision,
                    updated_at,
                    data_source_id,
                    membership_id,
                    revision,
                ],
            )?;
            if changed != 1 {
                return Err(corrupt(format!(
                    "Priority value {data_source_id}/{membership_id} changed during migration"
                )));
            }
            if removed_at.is_none() {
                migrate_v110_priority_page_projection(
                    connection,
                    &membership_id,
                    &page_id,
                    next_revision,
                    updated_at,
                )?;
                metadata_pages.insert(page_id);
            }
            continue;
        }
        if !crate::database::property_semantics::is_priority_option_id(option_id)
            || !state.current_ids.contains(option_id)
        {
            return Err(corrupt(format!(
                "Priority value {data_source_id}/{membership_id} references unknown option {option_id}"
            )));
        }
    }
    Ok(metadata_pages)
}

fn migrate_v110_priority_page_projection(
    connection: &Connection,
    membership_id: &str,
    page_id: &str,
    value_revision: i64,
    updated_at: &str,
) -> Result<(), StoreError> {
    let metadata_revision = bump_v111_page_metadata(connection, page_id, updated_at)?;
    let projection = connection
        .query_row(
            "SELECT database_values_json, property_revisions_json \
             FROM page_read_model WHERE page_block_id = ?1 AND membership_id = ?2",
            params![page_id, membership_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((values_json, revisions_json)) = projection else {
        return Ok(());
    };
    let mut values = serde_json::from_str::<Map<String, Value>>(&values_json)
        .map_err(|_| corrupt(format!("Page {page_id} Database values are invalid")))?;
    let mut revisions = serde_json::from_str::<Map<String, Value>>(&revisions_json)
        .map_err(|_| corrupt(format!("Page {page_id} Property revisions are invalid")))?;
    values.insert(
        crate::database::property_semantics::PRIORITY_PROPERTY_ID.to_owned(),
        Value::String(P3_PRIORITY_ID.to_owned()),
    );
    let database = revisions
        .entry("database".to_owned())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| corrupt(format!("Page {page_id} Database revisions are invalid")))?;
    database.insert("priority".to_owned(), Value::from(value_revision));
    let changed = connection.execute(
        "UPDATE page_read_model SET metadata_revision = ?1, database_values_json = ?2, \
           property_revisions_json = ?3, projection_version = projection_version + 1, \
           updated_at = ?4 WHERE page_block_id = ?5 AND membership_id = ?6",
        params![
            metadata_revision,
            serde_json::to_string(&values)
                .map_err(|_| internal("Migrated Page Database values could not be serialized"))?,
            serde_json::to_string(&revisions)
                .map_err(|_| internal("Migrated Page revisions could not be serialized"))?,
            updated_at,
            page_id,
            membership_id,
        ],
    )?;
    if changed == 1 {
        return Ok(());
    }
    Err(corrupt(format!(
        "Page {page_id} projection changed during Priority migration"
    )))
}

fn bump_v111_page_metadata(
    connection: &Connection,
    page_id: &str,
    updated_at: &str,
) -> Result<i64, StoreError> {
    let revision = connection
        .query_row(
            "UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?1 \
             WHERE id = ?2 AND type = 'page' RETURNING metadata_revision",
            params![updated_at, page_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| {
            corrupt(format!(
                "Page {page_id} disappeared during Priority migration"
            ))
        })?;
    let changed = connection.execute(
        "UPDATE pages SET metadata_revision = ?1, updated_at = ?2 WHERE block_id = ?3",
        params![revision, updated_at, page_id],
    )?;
    if changed == 1 {
        return Ok(revision);
    }
    Err(corrupt(format!(
        "Page {page_id} metadata authority disappeared during Priority migration"
    )))
}

fn migrate_priority_filter(value: &mut Value, allow_legacy_p4: bool) -> Result<bool, StoreError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| corrupt("Database View filter node is not an object"))?;
    match object.get("kind").and_then(Value::as_str) {
        Some("group") => {
            let children = object
                .get_mut("children")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| corrupt("Database View filter group children are invalid"))?;
            let mut changed = false;
            for child in children {
                changed |= migrate_priority_filter(child, allow_legacy_p4)?;
            }
            Ok(changed)
        }
        Some("clause") => {
            if object.get("propertyId").and_then(Value::as_str) != Some("priority") {
                return Ok(false);
            }
            match object.get("operator").and_then(Value::as_str) {
                Some("is_empty" | "is_not_empty") => Ok(false),
                Some("equals" | "not_equals") => {
                    let option_id = object
                        .get("value")
                        .and_then(Value::as_str)
                        .ok_or_else(|| corrupt("Priority filter requires a string option value"))?;
                    if crate::database::property_semantics::is_priority_option_id(option_id) {
                        return Ok(false);
                    }
                    if allow_legacy_p4 && option_id == LEGACY_P4_PRIORITY_ID {
                        object.insert("value".to_owned(), Value::String(P3_PRIORITY_ID.to_owned()));
                        return Ok(true);
                    }
                    Err(corrupt(format!(
                        "Priority filter references unknown option {option_id}"
                    )))
                }
                _ => Err(corrupt("Priority filter uses an unsupported operator")),
            }
        }
        _ => Err(corrupt("Database View filter kind is invalid")),
    }
}

fn migrate_v110_priority_views(
    connection: &Connection,
    updated_at: &str,
    metadata_pages: &mut BTreeSet<String>,
) -> Result<(), StoreError> {
    let views = connection
        .prepare(
            "SELECT id, database_block_id, config_json, revision \
             FROM database_views ORDER BY id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (view_id, database_id, config_json, revision) in views {
        let mut config = serde_json::from_str::<Value>(&config_json)
            .map_err(|_| corrupt(format!("Database View {view_id} config is invalid")))?;
        let groups_by_priority =
            config.pointer("/group/propertyId").and_then(Value::as_str) == Some("priority");
        let filter_changed = config
            .get_mut("filter")
            .map(|filter| migrate_priority_filter(filter, true))
            .transpose()?
            .unwrap_or(false);
        if filter_changed {
            let changed = connection.execute(
                "UPDATE database_views SET config_json = ?1, revision = revision + 1, \
                   updated_at = ?2 WHERE id = ?3 AND revision = ?4",
                params![
                    serde_json::to_string(&config)
                        .map_err(|_| internal("Migrated Database View could not be serialized"))?,
                    updated_at,
                    view_id,
                    revision,
                ],
            )?;
            if changed != 1 {
                return Err(corrupt(format!(
                    "Database View {view_id} changed during Priority migration"
                )));
            }
            let container_changed = connection.execute(
                "UPDATE database_containers SET metadata_revision = metadata_revision + 1, \
                   updated_at = ?1 WHERE block_id = ?2",
                params![updated_at, database_id],
            )?;
            if container_changed != 1 {
                return Err(corrupt(format!(
                    "Database Container {database_id} disappeared during Priority migration"
                )));
            }
        }
        if groups_by_priority {
            migrate_v110_priority_positions(connection, &view_id, updated_at, metadata_pages)?;
            migrate_v110_priority_group_projection(connection, &view_id, updated_at)?;
        }
    }
    Ok(())
}

fn migrate_v110_priority_positions(
    connection: &Connection,
    view_id: &str,
    updated_at: &str,
    metadata_pages: &mut BTreeSet<String>,
) -> Result<(), StoreError> {
    let positions = connection
        .prepare(
            "SELECT page_block_id, group_key, revision \
             FROM database_view_page_positions WHERE view_id = ?1 ORDER BY page_block_id",
        )?
        .query_map([view_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (page_id, group_key, revision) in positions {
        let Some(group_key) = group_key else {
            continue;
        };
        if crate::database::property_semantics::is_priority_option_id(&group_key) {
            continue;
        }
        if group_key != LEGACY_P4_PRIORITY_ID {
            return Err(corrupt(format!(
                "Priority-grouped View {view_id} has unknown group key {group_key}"
            )));
        }
        let changed = connection.execute(
            "UPDATE database_view_page_positions SET group_key = ?1, revision = revision + 1, \
               updated_at = ?2 WHERE view_id = ?3 AND page_block_id = ?4 AND revision = ?5",
            params![P3_PRIORITY_ID, updated_at, view_id, page_id, revision],
        )?;
        if changed != 1 {
            return Err(corrupt(format!(
                "Priority position {view_id}/{page_id} changed during migration"
            )));
        }
        connection.execute(
            "UPDATE page_read_model SET view_group_key = ?1, \
               projection_version = projection_version + 1, updated_at = ?2 \
             WHERE page_block_id = ?3 AND view_id = ?4",
            params![P3_PRIORITY_ID, updated_at, page_id, view_id],
        )?;
        if metadata_pages.insert(page_id.clone()) {
            let metadata_revision = bump_v111_page_metadata(connection, &page_id, updated_at)?;
            connection.execute(
                "UPDATE page_read_model SET metadata_revision = ?1, \
                   projection_version = projection_version + 1, updated_at = ?2 \
                 WHERE page_block_id = ?3",
                params![metadata_revision, updated_at, page_id],
            )?;
        }
    }
    Ok(())
}

fn migrate_v110_priority_group_projection(
    connection: &Connection,
    view_id: &str,
    updated_at: &str,
) -> Result<(), StoreError> {
    let projections = connection
        .prepare(
            "SELECT page_block_id, view_group_key FROM page_read_model \
             WHERE view_id = ?1 AND view_group_key IS NOT NULL ORDER BY page_block_id",
        )?
        .query_map([view_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (page_id, group_key) in projections {
        if crate::database::property_semantics::is_priority_option_id(&group_key) {
            continue;
        }
        if group_key != LEGACY_P4_PRIORITY_ID {
            return Err(corrupt(format!(
                "Priority-grouped View {view_id} projects unknown group key {group_key}"
            )));
        }
        connection.execute(
            "UPDATE page_read_model SET view_group_key = ?1, \
               projection_version = projection_version + 1, updated_at = ?2 \
             WHERE page_block_id = ?3 AND view_id = ?4",
            params![P3_PRIORITY_ID, updated_at, page_id, view_id],
        )?;
    }
    Ok(())
}

pub(crate) fn validate_database_priority_invariants(
    connection: &Connection,
) -> Result<(), StoreError> {
    let properties = connection
        .prepare(
            "SELECT data_source_id, value_type, config_json \
             FROM data_source_properties WHERE id = 'priority' ORDER BY data_source_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut sources = BTreeMap::new();
    for (data_source_id, value_type, config_json) in properties {
        if value_type != "select" {
            return Err(corrupt(format!(
                "Priority Property for Data Source {data_source_id} is not a select"
            )));
        }
        let (_, state) = parse_priority_config(&data_source_id, &config_json, false)?;
        sources.insert(data_source_id, state);
    }

    let values = connection
        .prepare(
            "SELECT data_source_id, membership_id, value_json \
             FROM data_source_property_values WHERE property_id = 'priority' \
             ORDER BY data_source_id, membership_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (data_source_id, membership_id, raw) in values {
        let state = sources.get(&data_source_id).ok_or_else(|| {
            corrupt(format!(
                "Priority value {data_source_id}/{membership_id} has no registry"
            ))
        })?;
        let value = serde_json::from_str::<Value>(&raw).map_err(|_| {
            corrupt(format!(
                "Priority value {data_source_id}/{membership_id} is invalid"
            ))
        })?;
        if value.is_null() {
            continue;
        }
        let option_id = value.as_str().ok_or_else(|| {
            corrupt(format!(
                "Priority value {data_source_id}/{membership_id} is not a string or null"
            ))
        })?;
        if !crate::database::property_semantics::is_priority_option_id(option_id)
            || !state.current_ids.contains(option_id)
        {
            return Err(corrupt(format!(
                "Priority value {data_source_id}/{membership_id} is noncanonical"
            )));
        }
    }

    let projections = connection
        .prepare("SELECT page_block_id, database_values_json FROM page_read_model ORDER BY page_block_id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (page_id, raw) in projections {
        let values = serde_json::from_str::<Map<String, Value>>(&raw)
            .map_err(|_| corrupt(format!("Page {page_id} Database values are invalid")))?;
        let Some(value) = values.get("priority") else {
            continue;
        };
        if value.is_null()
            || value
                .as_str()
                .is_some_and(crate::database::property_semantics::is_priority_option_id)
        {
            continue;
        }
        return Err(corrupt(format!(
            "Page {page_id} Priority projection is noncanonical"
        )));
    }

    let views = connection
        .prepare("SELECT id, config_json FROM database_views ORDER BY id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (view_id, raw) in views {
        let mut config = serde_json::from_str::<Value>(&raw)
            .map_err(|_| corrupt(format!("Database View {view_id} config is invalid")))?;
        let groups_by_priority =
            config.pointer("/group/propertyId").and_then(Value::as_str) == Some("priority");
        let changed = config
            .get_mut("filter")
            .map(|filter| migrate_priority_filter(filter, false))
            .transpose()?
            .unwrap_or(false);
        if changed {
            return Err(corrupt(format!(
                "Database View {view_id} Priority filter is noncanonical"
            )));
        }
        if !groups_by_priority {
            continue;
        }
        let invalid_group: Option<String> = connection
            .query_row(
                "SELECT group_key FROM database_view_page_positions \
                 WHERE view_id = ?1 AND group_key IS NOT NULL \
                   AND group_key NOT IN ('p0-critical', 'p1-high', 'p2-medium', 'p3-low') \
                 ORDER BY page_block_id LIMIT 1",
                [view_id.as_str()],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(group_key) = invalid_group {
            return Err(corrupt(format!(
                "Priority-grouped View {view_id} has noncanonical group key {group_key}"
            )));
        }
        let invalid_projection: Option<String> = connection
            .query_row(
                "SELECT view_group_key FROM page_read_model \
                 WHERE view_id = ?1 AND view_group_key IS NOT NULL \
                   AND view_group_key NOT IN \
                     ('p0-critical', 'p1-high', 'p2-medium', 'p3-low') \
                 ORDER BY page_block_id LIMIT 1",
                [view_id.as_str()],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(group_key) = invalid_projection {
            return Err(corrupt(format!(
                "Priority-grouped View {view_id} projects noncanonical group key {group_key}"
            )));
        }
    }
    Ok(())
}

fn migrate_v95_canvas_scene(connection: &Connection, document_id: &str) -> Result<(), StoreError> {
    let authority = read_legacy_project_owned_document_authority(connection, document_id)?
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
                authority.head.library_id,
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
                authority.head.library_id,
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
                authority.head.library_id,
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
         DELETE FROM core_automation_leases;
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
    let (floor, commit_head) = connection.query_row(
        "SELECT metadata.projection_event_v2_floor, \
                (SELECT COALESCE(MAX(seq), 0) FROM change_log) \
         FROM core_store_metadata metadata WHERE metadata.id = 1",
        [],
        |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if floor.is_some_and(|floor| floor >= 1 && floor <= commit_head + 1) {
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

fn validate_exact_v99_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 99)
}

fn validate_exact_v100_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 100)
}

fn validate_exact_v101_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 101)
}

fn validate_exact_v102_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 102)
}

fn validate_exact_v103_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 103)
}

fn validate_exact_v104_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 104)
}

fn validate_exact_v105_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 105)
}

fn validate_exact_v106_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 106)
}

fn validate_exact_v107_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 107)
}

fn validate_exact_v108_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 108)
}

fn validate_exact_v109_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 109)
}

fn validate_exact_v110_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 110)
}

fn validate_exact_v113_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 113)
}

fn validate_exact_v114_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 114)
}

fn validate_exact_v115_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 115)
}

fn validate_exact_v116_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 116)
}

fn validate_exact_v117_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 117)
}

fn validate_exact_v118_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 118)
}

fn validate_exact_v119_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 119)
}

fn validate_exact_v120_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 120)
}

fn validate_exact_v121_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 121)?;
    validate_v121_page_key_invariants(connection)
}

fn validate_exact_v122_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 122)?;
    validate_v121_page_key_invariants(connection)
}

fn validate_exact_v123_schema(connection: &Connection) -> Result<(), StoreError> {
    validate_exact_core_schema(connection, true, true, true, true, true, true, true, 123)?;
    validate_v121_page_key_invariants(connection)
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
    )?;
    validate_v121_page_key_invariants(connection)?;
    validate_v124_thread_execution_hosts(connection)
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
    let actual_inventory = read_schema_inventory(connection)?;
    if schema_version == CORE_SCHEMA_VERSION {
        return compare_schema_inventories(
            current_schema_inventory()?,
            &actual_inventory,
            schema_version,
        );
    }
    let expected_inventory = build_expected_core_schema_inventory(
        include_execution_profiles,
        include_portable_tabs,
        include_projection_impact,
        include_window_owned_session_views,
        include_workspace_sidebar_lanes,
        include_database_starter_sessions,
        include_project_appearance,
        schema_version,
    )?;
    compare_schema_inventories(&expected_inventory, &actual_inventory, schema_version)
}

static CURRENT_SCHEMA_INVENTORY: OnceLock<SchemaInventory> = OnceLock::new();

fn current_schema_inventory() -> Result<&'static SchemaInventory, StoreError> {
    if let Some(inventory) = CURRENT_SCHEMA_INVENTORY.get() {
        return Ok(inventory);
    }
    let inventory = build_expected_core_schema_inventory(
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        CORE_SCHEMA_VERSION,
    )?;
    let _ = CURRENT_SCHEMA_INVENTORY.set(inventory);
    CURRENT_SCHEMA_INVENTORY
        .get()
        .ok_or_else(|| corrupt("Current Store schema inventory was not initialized"))
}

#[allow(clippy::too_many_arguments)]
fn build_expected_core_schema_inventory(
    include_execution_profiles: bool,
    include_portable_tabs: bool,
    include_projection_impact: bool,
    include_window_owned_session_views: bool,
    include_workspace_sidebar_lanes: bool,
    include_database_starter_sessions: bool,
    include_project_appearance: bool,
    schema_version: i64,
) -> Result<SchemaInventory, StoreError> {
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
    if schema_version >= 100 {
        ensure_v100_relation_properties_schema(&expected)?;
    }
    if schema_version >= 101 {
        ensure_v101_projectless_permission_mode_schema(&expected)?;
    }
    if schema_version >= 102 {
        ensure_v102_local_commit_schema(&expected, &mut |_, _| {})?;
    }
    if schema_version >= 103 {
        ensure_v103_local_commit_composite_identity(&expected)?;
    }
    if schema_version >= 105 {
        ensure_v105_local_commit_manifest_schema(&expected)?;
    }
    if schema_version >= 106 {
        ensure_v106_projection_scope_heads_schema(&expected)?;
    }
    if schema_version >= 107 {
        ensure_v107_block_project_cascade_indexes(&expected)?;
    }
    if schema_version >= 108 {
        ensure_v108_local_commit_revocations_schema(&expected)?;
    }
    if schema_version >= 109 {
        ensure_v109_local_commit_delivery_atoms_schema(&expected)?;
    }
    if schema_version >= 110 {
        ensure_v110_visibility_delta_journal_schema(&expected)?;
    }
    if schema_version >= 112 {
        ensure_v112_database_view_contract(&expected, 0)?;
        ensure_v113_view_global_rank(&expected)?;
    }
    if schema_version >= 114 {
        ensure_v114_database_list_authority(&expected)?;
    }
    if schema_version >= 115 {
        ensure_v115_task_parent_relation_authority(&expected, 0)?;
    }
    if schema_version >= 116 {
        ensure_v116_view_personal_state(&expected)?;
    }
    if schema_version >= 117 {
        expected.pragma_update(None, "foreign_keys", false)?;
        ensure_v117_library_content_ownership(&expected)?;
        expected.pragma_update(None, "foreign_keys", true)?;
    }
    if schema_version >= 118 {
        ensure_v118_canvas_resource_grants(&expected)?;
    }
    if schema_version >= 119 {
        ensure_v119_library_content_index_cleanup(&expected)?;
    }
    if schema_version >= 120 {
        ensure_v120_document_block_tombstones_schema(&expected)?;
    }
    if schema_version >= 121 {
        ensure_v121_page_key_authority(&expected, 0)?;
    }
    if schema_version >= 124 {
        ensure_v124_thread_execution_hosts(&expected)?;
    }

    read_schema_inventory(&expected)
}

fn compare_schema_inventories(
    expected_inventory: &SchemaInventory,
    actual_inventory: &SchemaInventory,
    schema_version: i64,
) -> Result<(), StoreError> {
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
    if version >= 100 {
        ensure_v100_relation_properties_schema(&expected)?;
    }
    if version >= 101 {
        ensure_v101_projectless_permission_mode_schema(&expected)?;
    }
    if version >= 102 {
        ensure_v102_local_commit_schema(&expected, &mut |_, _| {})?;
    }
    if version >= 103 {
        ensure_v103_local_commit_composite_identity(&expected)?;
    }
    if version >= 105 {
        ensure_v105_local_commit_manifest_schema(&expected)?;
    }
    if version >= 106 {
        ensure_v106_projection_scope_heads_schema(&expected)?;
    }
    if version >= 107 {
        ensure_v107_block_project_cascade_indexes(&expected)?;
    }
    if version >= 108 {
        ensure_v108_local_commit_revocations_schema(&expected)?;
    }
    if version >= 109 {
        ensure_v109_local_commit_delivery_atoms_schema(&expected)?;
    }
    if version >= 110 {
        ensure_v110_visibility_delta_journal_schema(&expected)?;
    }
    if version >= 112 {
        ensure_v112_database_view_contract(&expected, 0)?;
        ensure_v113_view_global_rank(&expected)?;
    }
    if version >= 114 {
        ensure_v114_database_list_authority(&expected)?;
    }
    if version >= 115 {
        ensure_v115_task_parent_relation_authority(&expected, 0)?;
    }
    if version >= 116 {
        ensure_v116_view_personal_state(&expected)?;
    }
    if version >= 117 {
        expected.pragma_update(None, "foreign_keys", false)?;
        ensure_v117_library_content_ownership(&expected)?;
        expected.pragma_update(None, "foreign_keys", true)?;
    }
    if version >= 118 {
        ensure_v118_canvas_resource_grants(&expected)?;
    }
    if version >= 119 {
        ensure_v119_library_content_index_cleanup(&expected)?;
    }
    if version >= 120 {
        ensure_v120_document_block_tombstones_schema(&expected)?;
    }
    if version >= 121 {
        ensure_v121_page_key_authority(&expected, 0)?;
    }
    if version >= 124 {
        ensure_v124_thread_execution_hosts(&expected)?;
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

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
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

    fn remove_v124_thread_execution_host_schema(connection: &Connection) -> Result<(), StoreError> {
        connection
            .execute_batch("ALTER TABLE codex_threads DROP COLUMN execution_host_id;")
            .map_err(StoreError::from)
    }

    fn remove_v121_page_key_schema(connection: &Connection) -> Result<(), StoreError> {
        remove_v124_thread_execution_host_schema(connection)?;
        connection
            .execute_batch(
                "DROP TABLE page_key_assignments; \
                 DROP TABLE page_key_prefixes; \
                 DROP TABLE page_key_namespaces; \
                 DROP INDEX idx_database_containers_block_library;",
            )
            .map_err(StoreError::from)
    }

    fn seed_v120_project_database_view(
        connection: &Connection,
        config: Value,
        personal_override: Option<Value>,
    ) -> Result<(), StoreError> {
        let now = "2026-08-13T00:00:00.000Z";
        crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
            connection,
        )?;
        connection.execute(
            "INSERT INTO profiles(id, created_at, updated_at) \
             VALUES ('profile:v120-view', ?1, ?1)",
            [now],
        )?;
        connection.execute(
            "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
             VALUES ('library:v120-view', 'profile:v120-view', ?1, ?1)",
            [now],
        )?;
        connection.execute(
            "INSERT INTO projects(id, library_id, name, created, updated) \
             VALUES ('project:v120-view', 'library:v120-view', 'View migration', ?1, ?1)",
            [now],
        )?;
        connection.execute(
            "INSERT INTO blocks(\
               id, library_id, type, lifecycle, placement_revision, metadata_revision, \
               created_at, updated_at\
             ) VALUES (\
               'database:v120-view', 'library:v120-view', 'database', 'active', 1, 1, ?1, ?1\
             )",
            [now],
        )?;
        create_database_authority_records(
            connection,
            "library:v120-view",
            "database:v120-view",
            "source:v120-view",
            "view:v120-view",
            "View migration DB",
            now,
        )?;
        connection.execute(
            "INSERT INTO project_database_bindings(\
               project_id, library_id, database_block_id, lifecycle, revision, created_at, updated_at\
             ) VALUES (\
               'project:v120-view', 'library:v120-view', 'database:v120-view', 'active', 1, ?1, ?1\
             )",
            [now],
        )?;
        connection.execute(
            "UPDATE projects SET database_block_id = 'database:v120-view' \
             WHERE id = 'project:v120-view'",
            [],
        )?;
        connection.execute(
            "UPDATE database_views SET config_json = ?1, revision = 1 WHERE id = 'view:v120-view'",
            [serde_json::to_string(&config).map_err(internal_json)?],
        )?;
        if let Some(personal_override) = personal_override {
            connection.execute(
                "INSERT INTO database_view_personal_presentations(\
                   profile_id, view_id, presentation_override_json, revision, created_at, updated_at\
                 ) VALUES ('profile:v120-view', 'view:v120-view', ?1, 7, ?2, ?2)",
                params![
                    serde_json::to_string(&personal_override).map_err(internal_json)?,
                    now
                ],
            )?;
        }
        connection.execute("DELETE FROM local_commit_visibility_context", [])?;
        Ok(())
    }

    fn v120_view_definition(board_fields: Value, list_fields: Value) -> Value {
        json!({
            "schemaKey": "nodex.database-view",
            "schemaVersion": 4,
            "filter": { "kind": "group", "operator": "and", "children": [] },
            "presentation": {
                "sort": [],
                "group": null,
                "subgroup": null,
                "groupDirection": "asc",
                "completion": { "range": "all", "orderByRecency": false },
                "hierarchy": { "showSubPages": true, "nestedSubPages": false },
                "layouts": {
                    "board": { "fields": board_fields, "showEmptyGroups": false },
                    "list": { "fields": list_fields, "showEmptyGroups": true }
                }
            }
        })
    }

    #[test]
    fn published_current_store_identity_matches_the_exact_schema() {
        assert_eq!(
            i64::from(nodex_core_protocol::CURRENT_STORE_VERSION),
            CORE_SCHEMA_VERSION,
        );
        assert_eq!(
            nodex_core_protocol::CURRENT_STORE_SCHEMA_FINGERPRINT,
            expected_store_schema_fingerprint(CORE_SCHEMA_VERSION)
                .expect("current Store fingerprint"),
        );
    }

    #[test]
    fn v120_store_adds_page_key_authority_without_replaying_earlier_migrations() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current Store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    remove_v121_page_key_schema(transaction)?;
                    transaction.execute(
                        "UPDATE core_store_metadata SET store_format_version = 120 WHERE id = 1",
                        [],
                    )?;
                    transaction.pragma_update(None, "user_version", 120)?;
                    Ok(())
                })
            })
            .expect("restore exact v120 schema");
        drop(kernel);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v120 Page-key authority");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(120));
        upgraded
            .readers()
            .read_default(|connection| {
                let tables = connection.query_row(
                    "SELECT count(*) FROM sqlite_schema \
                     WHERE type = 'table' AND name IN (\
                       'page_key_namespaces', 'page_key_prefixes', 'page_key_assignments'\
                     )",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(tables, 3);
                validate_exact_current_schema(connection)
            })
            .expect("current schema is exact after the v120 upgrade");
    }

    #[test]
    fn v120_view_fields_migrate_through_typed_durable_and_personal_boundaries() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current Store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    seed_v120_project_database_view(
                        transaction,
                        v120_view_definition(
                            json!([
                                { "kind": "property", "propertyId": "status" },
                                { "kind": "intrinsic", "field": "page_id" },
                                { "kind": "property", "propertyId": "title" },
                                { "kind": "property", "propertyId": "status" },
                                { "kind": "intrinsic", "field": "page_key" }
                            ]),
                            json!([
                                { "kind": "property", "propertyId": "title" },
                                { "kind": "property", "propertyId": "title" }
                            ]),
                        ),
                        Some(json!({
                            "layouts": {
                                "board": {
                                    "fields": [
                                        { "kind": "property", "property_id": "title" },
                                        { "kind": "intrinsic", "field": "page_id" },
                                        { "kind": "property", "property_id": "title" }
                                    ]
                                },
                                "list": {
                                    "fields": [
                                        { "kind": "intrinsic", "field": "page_id" },
                                        { "kind": "intrinsic", "field": "page_key" },
                                        { "kind": "intrinsic", "field": "page_id" },
                                        { "kind": "property", "property_id": "status" }
                                    ],
                                    "show_empty_groups": true
                                }
                            }
                        })),
                    )?;
                    remove_v121_page_key_schema(transaction)?;
                    transaction.execute(
                        "UPDATE core_store_metadata SET store_format_version = 120 WHERE id = 1",
                        [],
                    )?;
                    transaction.pragma_update(None, "user_version", 120)?;
                    Ok(())
                })
            })
            .expect("seed v120 typed View state");
        drop(kernel);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v120 typed View state");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(120));
        upgraded
            .readers()
            .read_default(|connection| {
                let (config_json, durable_revision) = connection.query_row(
                    "SELECT config_json, revision FROM database_views WHERE id = 'view:v120-view'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )?;
                let durable = serde_json::from_str::<V121StoredViewDefinition>(&config_json)
                    .map_err(internal_json)?;
                durable.validate()?;
                assert_eq!(
                    durable.presentation.layouts.board.fields,
                    vec![
                        DatabaseViewField::Property {
                            property_id: "status".to_owned(),
                        },
                        DatabaseViewField::Property {
                            property_id: "title".to_owned(),
                        },
                    ]
                );
                assert_eq!(
                    durable.presentation.layouts.list.fields,
                    vec![
                        DatabaseViewField::Intrinsic {
                            field: DatabaseViewIntrinsicField::PageKey,
                        },
                        DatabaseViewField::Property {
                            property_id: "title".to_owned(),
                        },
                    ]
                );
                assert_eq!(durable_revision, 2);
                assert_eq!(
                    serde_json::to_string(&durable).map_err(internal_json)?,
                    config_json
                );

                let (personal_json, personal_revision) = connection.query_row(
                    "SELECT presentation_override_json, revision \
                     FROM database_view_personal_presentations \
                     WHERE profile_id = 'profile:v120-view' AND view_id = 'view:v120-view'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )?;
                let personal =
                    serde_json::from_str::<DatabaseViewPresentationOverrideInput>(&personal_json)
                        .map_err(internal_json)?;
                let layouts = personal.layouts.as_ref().expect("personal layouts");
                assert_eq!(
                    layouts
                        .board
                        .as_ref()
                        .and_then(|layout| layout.fields.as_ref())
                        .expect("Board fields"),
                    &[DatabaseViewFieldInput::Property {
                        property_id: "title".to_owned(),
                    }]
                );
                assert_eq!(
                    layouts
                        .list
                        .as_ref()
                        .and_then(|layout| layout.fields.as_ref())
                        .expect("List fields"),
                    &vec![
                        DatabaseViewFieldInput::Intrinsic {
                            field: DatabaseViewIntrinsicField::PageKey,
                        },
                        DatabaseViewFieldInput::Property {
                            property_id: "status".to_owned(),
                        },
                    ]
                );
                assert_eq!(personal_revision, 8);
                assert_eq!(
                    serde_json::to_string(&personal).map_err(internal_json)?,
                    personal_json
                );
                Ok(())
            })
            .expect("typed v121 presentation migration");
    }

    #[test]
    fn v121_store_removes_retired_internal_id_presentation() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current Store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    seed_v120_project_database_view(
                        transaction,
                        v120_view_definition(
                            json!([{ "kind": "intrinsic", "field": "page_id" }]),
                            json!([{ "kind": "intrinsic", "field": "page_id" }]),
                        ),
                        Some(json!({
                            "layouts": {
                                "list": {
                                    "fields": [
                                        { "kind": "intrinsic", "field": "page_id" }
                                    ]
                                }
                            }
                        })),
                    )?;
                    create_page_key_namespace(
                        transaction,
                        "library:v120-view",
                        "database:v120-view",
                        None,
                        "View migration",
                        "2026-08-13T00:00:00.000Z",
                    )?;
                    remove_v124_thread_execution_host_schema(transaction)?;
                    transaction.execute(
                        "UPDATE core_store_metadata SET store_format_version = 121 WHERE id = 1",
                        [],
                    )?;
                    transaction.pragma_update(None, "user_version", 121)?;
                    Ok(())
                })
            })
            .expect("seed v121 Internal ID presentation");
        drop(kernel);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v121 presentation");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(121));
        upgraded
            .readers()
            .read_default(|connection| {
                let config_json: String = connection.query_row(
                    "SELECT config_json FROM database_views WHERE id = 'view:v120-view'",
                    [],
                    |row| row.get(0),
                )?;
                let durable = serde_json::from_str::<V121StoredViewDefinition>(&config_json)
                    .map_err(internal_json)?;
                let expected = vec![DatabaseViewField::Intrinsic {
                    field: DatabaseViewIntrinsicField::PageKey,
                }];
                assert!(durable.presentation.layouts.board.fields.is_empty());
                assert_eq!(durable.presentation.layouts.list.fields, expected);

                let personal_json: String = connection.query_row(
                    "SELECT presentation_override_json \
                     FROM database_view_personal_presentations \
                     WHERE profile_id = 'profile:v120-view' AND view_id = 'view:v120-view'",
                    [],
                    |row| row.get(0),
                )?;
                let personal =
                    serde_json::from_str::<DatabaseViewPresentationOverrideInput>(&personal_json)
                        .map_err(internal_json)?;
                assert_eq!(
                    personal
                        .layouts
                        .and_then(|layouts| layouts.list)
                        .and_then(|layout| layout.fields),
                    Some(vec![DatabaseViewFieldInput::Intrinsic {
                        field: DatabaseViewIntrinsicField::PageKey,
                    }]),
                );
                Ok(())
            })
            .expect("retired Internal ID presentation is removed");
    }

    #[test]
    fn v122_store_defaults_board_id_off_and_keeps_list_id_on() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current Store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    seed_v120_project_database_view(
                        transaction,
                        v120_view_definition(
                            json!([
                                { "kind": "intrinsic", "field": "page_key" },
                                { "kind": "property", "propertyId": "status" }
                            ]),
                            json!([
                                { "kind": "property", "propertyId": "title" },
                                { "kind": "intrinsic", "field": "page_key" }
                            ]),
                        ),
                        Some(json!({
                            "layouts": {
                                "board": {
                                    "fields": [
                                        { "kind": "intrinsic", "field": "page_key" },
                                        { "kind": "property", "property_id": "title" }
                                    ]
                                },
                                "list": {
                                    "fields": [
                                        { "kind": "property", "property_id": "status" },
                                        { "kind": "intrinsic", "field": "page_key" }
                                    ]
                                }
                            }
                        })),
                    )?;
                    create_page_key_namespace(
                        transaction,
                        "library:v120-view",
                        "database:v120-view",
                        None,
                        "View migration",
                        "2026-08-13T00:00:00.000Z",
                    )?;
                    remove_v124_thread_execution_host_schema(transaction)?;
                    transaction.execute(
                        "UPDATE core_store_metadata SET store_format_version = 122 WHERE id = 1",
                        [],
                    )?;
                    transaction.pragma_update(None, "user_version", 122)?;
                    Ok(())
                })
            })
            .expect("seed v122 Board ID defaults");
        drop(kernel);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v122 presentation");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(122));
        upgraded
            .readers()
            .read_default(|connection| {
                let config_json: String = connection.query_row(
                    "SELECT config_json FROM database_views WHERE id = 'view:v120-view'",
                    [],
                    |row| row.get(0),
                )?;
                let durable = serde_json::from_str::<V121StoredViewDefinition>(&config_json)
                    .map_err(internal_json)?;
                assert_eq!(
                    durable.presentation.layouts.board.fields,
                    vec![DatabaseViewField::Property {
                        property_id: "status".to_owned(),
                    }],
                );
                assert_eq!(
                    durable.presentation.layouts.list.fields,
                    vec![
                        DatabaseViewField::Intrinsic {
                            field: DatabaseViewIntrinsicField::PageKey,
                        },
                        DatabaseViewField::Property {
                            property_id: "title".to_owned(),
                        },
                    ],
                );

                let personal_json: String = connection.query_row(
                    "SELECT presentation_override_json \
                     FROM database_view_personal_presentations \
                     WHERE profile_id = 'profile:v120-view' AND view_id = 'view:v120-view'",
                    [],
                    |row| row.get(0),
                )?;
                let personal =
                    serde_json::from_str::<DatabaseViewPresentationOverrideInput>(&personal_json)
                        .map_err(internal_json)?;
                let layouts = personal.layouts.expect("personal layouts");
                assert_eq!(
                    layouts.board.and_then(|layout| layout.fields),
                    Some(vec![DatabaseViewFieldInput::Property {
                        property_id: "title".to_owned(),
                    }]),
                );
                assert_eq!(
                    layouts.list.and_then(|layout| layout.fields),
                    Some(vec![
                        DatabaseViewFieldInput::Intrinsic {
                            field: DatabaseViewIntrinsicField::PageKey,
                        },
                        DatabaseViewFieldInput::Property {
                            property_id: "status".to_owned(),
                        },
                    ]),
                );
                Ok(())
            })
            .expect("Board ID default converges independently of List");
    }

    #[test]
    fn v121_view_field_migration_rejects_malformed_typed_payloads() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current Store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    seed_v120_project_database_view(
                        transaction,
                        v120_view_definition(
                            json!([{ "kind": "intrinsic", "field": "unknown_identity" }]),
                            json!([]),
                        ),
                        None,
                    )?;
                    let error =
                        migrate_page_key_display_fields(transaction, "2026-08-14T00:00:00.000Z")
                            .expect_err("malformed intrinsic must not survive migration");
                    assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
                    Ok(())
                })
            })
            .expect("typed migration rejects malformed payload");
    }

    #[test]
    fn v124_migration_defaults_existing_threads_to_the_local_execution_host() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current Store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO codex_threads( \
                           thread_id, thread_preview, model_provider, status_type, \
                           status_active_flags_json, archived, created_at, updated_at, linked_at \
                         ) VALUES ('thread:v123', '', '', 'notLoaded', '[]', 0, 1, 1, \
                           '2026-08-14T00:00:00.000Z')",
                        [],
                    )?;
                    remove_v124_thread_execution_host_schema(transaction)?;
                    transaction.execute_batch(
                        "UPDATE core_store_metadata SET store_format_version = 123 WHERE id = 1; \
                         PRAGMA user_version = 123;",
                    )?;
                    Ok(())
                })
            })
            .expect("seed owned v123 Store");
        drop(kernel);

        let reopened = SqliteStoreKernel::open(&home).expect("migrate v123 Store");
        let host = reopened
            .writer()
            .call(|connection| {
                connection.query_row(
                    "SELECT execution_host_id FROM codex_threads WHERE thread_id = 'thread:v123'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .map_err(Into::into)
            })
            .expect("migrated execution host");
        assert_eq!(host, "local");
        drop(reopened);

        let reopened_again = SqliteStoreKernel::open(&home).expect("reopen current Store");
        assert_eq!(
            reopened_again.preparation().schema_version,
            CORE_SCHEMA_VERSION
        );
        assert!(!reopened_again.preparation().created_fresh);
    }

    #[test]
    fn v120_backfill_ignores_indexed_blocks_deleted_with_their_owner() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh current Store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                        transaction,
                    )?;
                    transaction.execute("DROP TABLE document_block_tombstones", [])?;
                    let now = "2026-08-13T00:00:00.000Z";
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) \
                         VALUES ('profile:v120-backfill', ?1, ?1)",
                        [now],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library:v120-backfill', 'profile:v120-backfill', ?1, ?1)",
                        [now],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project:v120-backfill', 'library:v120-backfill', \
                           'Page lifecycle migration', ?1, ?1)",
                        [now],
                    )?;
                    transaction.execute(
                        "INSERT INTO documents( \
                           id, library_id, generation, head_seq, schema_key, schema_version, \
                           state_vector, state_hash, readiness, authority, sync_engine, \
                           created_at, updated_at \
                         ) VALUES ( \
                           'document:v120-backfill', 'library:v120-backfill', 1, 2, \
                           'nodex.page', 2, X'', '', 'ready', 'ydoc_primary', 'yjs', ?1, ?1 \
                         )",
                        [now],
                    )?;
                    transaction.execute(
                        "INSERT INTO blocks( \
                           id, library_id, type, lifecycle, placement_revision, \
                           metadata_revision, created_at, updated_at \
                         ) VALUES ( \
                           'block:v120-indexed-deleted-child', 'library:v120-backfill', \
                           'paragraph', 'active', 1, 1, ?1, ?1 \
                         )",
                        [now],
                    )?;
                    transaction.execute(
                        "INSERT INTO blocks( \
                           id, library_id, type, lifecycle, placement_revision, \
                           metadata_revision, created_at, updated_at \
                         ) VALUES ( \
                           'block:v120-detached-delete', 'library:v120-backfill', \
                           'paragraph', 'deleted', 2, 2, ?1, ?1 \
                         )",
                        [now],
                    )?;
                    transaction.execute(
                        "INSERT INTO document_block_index( \
                           document_id, block_id, parent_block_id, ordinal, block_type, text, projected_seq \
                         ) VALUES ( \
                           'document:v120-backfill', 'block:v120-indexed-deleted-child', \
                           NULL, 0, 'paragraph', 'Earlier content', 2 \
                         )",
                        [],
                    )?;
                    transaction.execute(
                        "UPDATE blocks SET lifecycle = 'deleted' \
                         WHERE id = 'block:v120-indexed-deleted-child'",
                        [],
                    )?;
                    transaction.execute(
                        "INSERT INTO change_log( \
                           project_id, store_epoch, kind, operation_id, block_ids_json, \
                           document_ids_json, payload_json, projection_impact_json, committed_at \
                         ) VALUES ( \
                           'project:v120-backfill', 'epoch:v120-backfill', \
                           'owned_document.document_updated', 'operation:v120-backfill', \
                           '[\"block:v120-indexed-deleted-child\"]', \
                           '[\"document:v120-backfill\"]', \
                           '{\"module\":\"owned_document\",\"kind\":\"document_updated\",\
                             \"documentId\":\"document:v120-backfill\",\"generation\":1,\"headSeq\":2}', \
                           '{\"kind\":\"none\"}', \
                           ?1 \
                         )",
                        [now],
                    )?;
                    for (operation_id, generation, head_seq) in [
                        ("operation:v120-current-delete", 1, 2),
                        ("operation:v120-stale-generation", 0, 99),
                    ] {
                        transaction.execute(
                            "INSERT INTO change_log( \
                               project_id, store_epoch, kind, operation_id, block_ids_json, \
                               document_ids_json, payload_json, projection_impact_json, committed_at \
                             ) VALUES ( \
                               'project:v120-backfill', 'epoch:v120-backfill', \
                               'owned_document.document_updated', ?1, \
                               '[\"block:v120-detached-delete\"]', \
                               '[\"document:v120-backfill\"]', \
                               json_object( \
                                 'module', 'owned_document', 'kind', 'document_updated', \
                                 'documentId', 'document:v120-backfill', \
                                 'generation', ?2, 'headSeq', ?3 \
                               ), \
                               '{\"kind\":\"none\"}', ?4 \
                             )",
                            params![operation_id, generation, head_seq, now],
                        )?;
                    }

                    ensure_v120_document_block_tombstones_schema(transaction)?;
                    let tombstones: i64 = transaction.query_row(
                        "SELECT count(*) FROM document_block_tombstones \
                         WHERE block_id = 'block:v120-indexed-deleted-child'",
                        [],
                        |row| row.get(0),
                    )?;
                    assert_eq!(tombstones, 0);
                    let restored_authority = transaction.query_row(
                        "SELECT document_id, document_generation, deletion_head_seq, \
                                placement_revision \
                         FROM document_block_tombstones \
                         WHERE block_id = 'block:v120-detached-delete'",
                        [],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, i64>(3)?,
                            ))
                        },
                    )?;
                    assert_eq!(
                        restored_authority,
                        ("document:v120-backfill".to_owned(), 1, 2, 2),
                        "backfill must use the latest event in the current Document generation",
                    );
                    Ok(())
                })
            })
            .expect("backfill keeps Page-owned deleted children restorable as a closure");
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/yjs-yrs")
            .join(name)
    }

    fn seed_owned_v110_store_with_p4_priority(home: &Path) {
        seed_owned_v109_store(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v110 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            ensure_v110_visibility_delta_journal_schema(transaction)?;
            crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                transaction,
            )?;
            let now = "2026-08-11T08:00:00.000Z";
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at) \
                 VALUES ('profile:v110-priority', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                 VALUES ('library:v110-priority', 'profile:v110-priority', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, name, created, updated, library_id) \
                 VALUES ('project:v110-priority', 'Priority Migration', ?1, ?1, \
                         'library:v110-priority')",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO blocks(\
                   id, project_id, type, lifecycle, location_kind, \
                   location_revision, metadata_revision, created_at, updated_at\
                 ) VALUES (\
                   'database:v110-priority', 'project:v110-priority', 'database', \
                   'active', 'space', 1, 3, ?1, ?1\
                 )",
                [now],
            )?;
            crate::database::create_legacy_v2_database_authority_records(
                transaction,
                "library:v110-priority",
                "database:v110-priority",
                "source:v110-priority",
                "view:v110-priority",
                "Priority Migration",
                now,
            )?;
            transaction.execute(
                "INSERT INTO project_database_bindings( \
                   project_id, library_id, database_block_id, lifecycle, revision, \
                   created_at, updated_at \
                 ) VALUES ( \
                   'project:v110-priority', 'library:v110-priority', \
                   'database:v110-priority', 'active', 1, ?1, ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "UPDATE data_source_properties SET config_json = ?1, schema_revision = 5 \
                 WHERE data_source_id = 'source:v110-priority' AND id = 'priority'",
                [serde_json::to_string(&serde_json::json!({
                    "options": [
                        { "id": "p0-critical", "name": "P0 - Critical" },
                        { "id": "p1-high", "name": "P1 - High" },
                        { "id": "p2-medium", "name": "P2 - Medium" },
                        { "id": "p3-low", "name": "Custom Low", "color": "green" },
                        { "id": "p4-later", "name": "P4 - Later", "color": "purple" }
                    ]
                }))
                .map_err(internal_json)?],
            )?;
            transaction.execute(
                "UPDATE data_sources SET schema_revision = 9 \
                 WHERE id = 'source:v110-priority'",
                [],
            )?;
            transaction.execute(
                "UPDATE database_containers SET metadata_revision = 4 \
                 WHERE block_id = 'database:v110-priority'",
                [],
            )?;
            transaction.execute(
                "UPDATE database_views SET revision = 6, config_json = ?1 \
                 WHERE id = 'view:v110-priority'",
                [serde_json::to_string(&serde_json::json!({
                    "schemaKey": "nodex.database-view",
                    "schemaVersion": 2,
                    "filter": {
                        "kind": "clause",
                        "propertyId": "priority",
                        "operator": "equals",
                        "value": "p4-later"
                    },
                    "sort": [{
                        "field": { "kind": "manual" },
                        "direction": "asc",
                        "nulls": "last"
                    }],
                    "group": { "propertyId": "priority" },
                    "display": {
                        "propertyIds": ["status", "priority", "estimate", "tags"],
                        "showTitle": true
                    }
                }))
                .map_err(internal_json)?],
            )?;
            transaction.execute(
                "INSERT INTO documents(\
                   id, project_id, generation, head_seq, schema_key, schema_version, \
                   state_vector, state_hash, readiness, authority, created_at, updated_at, \
                   sync_engine\
                 ) VALUES (\
                   'document:v110-priority', 'project:v110-priority', 1, 0, \
                   'nodex.page', 1, X'', \
                   '0000000000000000000000000000000000000000000000000000000000000000', \
                   'ready', 'ydoc_primary', ?1, ?1, 'canvas_scene'\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO blocks(\
                   id, project_id, type, lifecycle, location_kind, containing_database_id, \
                   location_revision, metadata_revision, created_at, updated_at\
                 ) VALUES (\
                   'page:v110-priority', 'project:v110-priority', 'page', 'active', \
                   'database', 'database:v110-priority', 2, 3, ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                 VALUES (\
                   'page:v110-priority', 'document:v110-priority', \
                   'project:v110-priority', ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO pages(\
                   block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
                   parent_revision, metadata_revision, created_at, updated_at\
                 ) VALUES (\
                   'page:v110-priority', 'library:v110-priority', 'document:v110-priority', \
                   'data_source', 'source:v110-priority', 'active', 2, 3, ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_source_page_memberships(\
                   id, data_source_id, page_block_id, revision, created_at, removed_at\
                 ) VALUES (\
                   'membership:v110-priority', 'source:v110-priority', \
                   'page:v110-priority', 2, ?1, NULL\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_source_property_values(\
                   data_source_id, membership_id, property_id, value_type, value_json, \
                   revision, updated_at\
                 ) VALUES (\
                   'source:v110-priority', 'membership:v110-priority', 'priority', \
                   'select', '\"p4-later\"', 7, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_sources(\
                   id, library_id, home_database_block_id, name, schema_key, schema_revision, \
                   lifecycle, rank_key, created_at, updated_at\
                 ) VALUES (\
                   'source:v110-dormant', 'library:v110-priority', \
                   'database:v110-priority', 'Dormant Priority', 'nodex.database', 4, \
                   'active', 'rank:dormant', ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_source_properties(\
                   data_source_id, id, name, value_type, config_json, rank_key, lifecycle, \
                   schema_revision, created_at, updated_at\
                 ) VALUES (\
                   'source:v110-dormant', 'priority', 'Priority', 'select', ?1, \
                   'rank:priority', 'active', 3, ?2, ?2\
                 )",
                params![
                    serde_json::to_string(&serde_json::json!({
                        "options": [{ "id": "p4-later", "name": "P4 - Later" }]
                    }))
                    .map_err(internal_json)?,
                    now,
                ],
            )?;
            transaction.execute(
                "INSERT INTO data_source_page_memberships(\
                   id, data_source_id, page_block_id, revision, created_at, removed_at\
                 ) VALUES (\
                   'membership:v110-dormant', 'source:v110-dormant', \
                   'page:v110-priority', 5, ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_source_property_values(\
                   data_source_id, membership_id, property_id, value_type, value_json, \
                   revision, updated_at\
                 ) VALUES (\
                   'source:v110-dormant', 'membership:v110-dormant', 'priority', \
                   'select', '\"p4-later\"', 11, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO database_view_page_positions(\
                   view_id, page_block_id, group_key, rank_key, revision, created_at, updated_at\
                 ) VALUES (\
                   'view:v110-priority', 'page:v110-priority', 'p4-later', \
                   'rank:stable', 8, ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO page_read_model(\
                   page_block_id, project_id, lifecycle, location_kind, containing_document_id, \
                   containing_database_id, top_level_rank_key, location_revision, \
                   metadata_revision, document_id, document_generation, document_projected_seq, \
                   document_schema_version, document_authority, membership_id, database_block_id, \
                   view_id, view_group_key, view_rank_key, title, description_preview, \
                   description_length, has_description, database_values_json, \
                   intrinsic_properties_json, property_revisions_json, projection_version, \
                   created_at, updated_at\
                 ) VALUES (\
                   'page:v110-priority', 'project:v110-priority', 'active', 'database', NULL, \
                   'database:v110-priority', NULL, 2, 3, 'document:v110-priority', 1, 0, 1, \
                   'ydoc_primary', 'membership:v110-priority', 'database:v110-priority', \
                   'view:v110-priority', 'p4-later', 'rank:stable', 'Migrated Page', '', 0, 0, \
                   '{\"priority\":\"p4-later\"}', '{}', \
                   '{\"database\":{\"priority\":7}}', 4, ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute("DELETE FROM local_commit_visibility_context", [])?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 110 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 110)?;
            Ok(())
        })
        .expect("seed v110 Priority Store");
        validate_exact_v110_schema(&connection).expect("exact v110 Store");
    }

    fn seed_owned_v111_database_view_store(home: &Path) {
        seed_owned_v110_store_with_p4_priority(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v111 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                transaction,
            )?;
            ensure_v111_priority_contract(transaction, 1_765_000_000_000)?;
            transaction.execute_batch(
                "INSERT INTO database_views( \
                   id, database_block_id, data_source_id, name, kind, config_json, revision, \
                   rank_key, lifecycle, created_at, updated_at \
                 ) SELECT \
                   'view:v111-list', database_block_id, data_source_id, 'List', 'list', \
                   config_json, 3, 'rank:list', 'active', created_at, updated_at \
                 FROM database_views WHERE id = 'view:v110-priority'; \
                 INSERT INTO database_views( \
                   id, database_block_id, data_source_id, name, kind, config_json, revision, \
                   rank_key, lifecycle, created_at, updated_at \
                 ) SELECT \
                   'view:v111-calendar', database_block_id, data_source_id, 'Calendar', 'calendar', \
                   config_json, 4, 'rank:calendar', 'active', created_at, updated_at \
                 FROM database_views WHERE id = 'view:v110-priority';",
            )?;
            transaction.execute(
                "INSERT INTO data_source_property_values( \
                   data_source_id, membership_id, property_id, value_type, value_json, \
                   revision, updated_at \
                 ) VALUES ( \
                   'source:v110-priority', 'membership:v110-priority', 'status', \
                   'select', '\"ship\"', 1, '2026-08-11T09:00:00.000Z' \
                 )",
                [],
            )?;
            transaction.execute("DELETE FROM local_commit_visibility_context", [])?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 111 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 111)?;
            Ok(())
        })
        .expect("seed v111 Database View Store");
        validate_exact_v110_schema(&connection).expect("exact v111 physical Store");
    }

    fn seed_owned_v114_task_hierarchy_store(home: &Path) {
        seed_owned_v111_database_view_store(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v114 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            let migration_now = 1_765_000_000_000;
            crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                transaction,
            )?;
            ensure_v112_database_view_contract(transaction, migration_now)?;
            ensure_v113_view_global_rank(transaction)?;
            ensure_v114_database_list_authority(transaction)?;
            transaction.execute_batch(
                r#"
                INSERT INTO documents(
                  id, project_id, generation, head_seq, schema_key, schema_version,
                  state_vector, state_hash, readiness, authority, created_at, updated_at,
                  sync_engine
                )
                SELECT 'document:v114-child', project_id, generation, head_seq, schema_key,
                       schema_version, state_vector, state_hash, readiness, authority,
                       created_at, updated_at, sync_engine
                FROM documents WHERE id = 'document:v110-priority';

                INSERT INTO blocks(
                  id, project_id, type, lifecycle, location_kind, containing_database_id,
                  location_revision, metadata_revision, created_at, updated_at
                )
                SELECT 'page:v114-child', project_id, 'page', lifecycle, 'database',
                       containing_database_id, location_revision, metadata_revision,
                       created_at, updated_at
                FROM blocks WHERE id = 'page:v110-priority';

                INSERT INTO block_documents(block_id, document_id, project_id, created_at)
                SELECT 'page:v114-child', 'document:v114-child', project_id, created_at
                FROM block_documents WHERE block_id = 'page:v110-priority';

                INSERT INTO pages(
                  block_id, library_id, document_id, parent_kind, parent_id, lifecycle,
                  parent_revision, metadata_revision, created_at, updated_at
                )
                SELECT 'page:v114-child', library_id, 'document:v114-child', parent_kind,
                       parent_id, lifecycle, parent_revision, metadata_revision,
                       created_at, updated_at
                FROM pages WHERE block_id = 'page:v110-priority';

                INSERT INTO data_source_page_memberships(
                  id, data_source_id, page_block_id, revision, created_at, removed_at
                )
                SELECT 'membership:v114-child', data_source_id, 'page:v114-child', revision,
                       created_at, NULL
                FROM data_source_page_memberships WHERE id = 'membership:v110-priority';

                INSERT INTO page_read_model(
                  page_block_id, project_id, lifecycle, location_kind,
                  containing_document_id, containing_database_id, top_level_rank_key,
                  location_revision, metadata_revision, document_id, document_generation,
                  document_projected_seq, document_schema_version, document_authority,
                  membership_id, database_block_id, view_id, view_group_key, view_rank_key,
                  title, description_preview, description_length, has_description,
                  database_values_json, intrinsic_properties_json, property_revisions_json,
                  projection_version, created_at, updated_at
                )
                SELECT 'page:v114-child', project_id, lifecycle, location_kind,
                       containing_document_id, containing_database_id, top_level_rank_key,
                       location_revision, metadata_revision, 'document:v114-child',
                       document_generation, document_projected_seq, document_schema_version,
                       document_authority, 'membership:v114-child', database_block_id,
                       NULL, NULL, NULL, 'Child', description_preview, description_length,
                       has_description, '{}', intrinsic_properties_json, '{}',
                       projection_version, created_at, updated_at
                FROM page_read_model WHERE page_block_id = 'page:v110-priority';

                INSERT INTO database_task_hierarchy_edges(
                  data_source_id, child_page_id, parent_page_id, sibling_rank, revision,
                  created_at, updated_at
                ) VALUES (
                  'source:v110-priority', 'page:v114-child', 'page:v110-priority',
                  '7fffffffffffffffffffffffffffffff', 7,
                  '2026-08-11T10:00:00.000Z', '2026-08-11T11:00:00.000Z'
                );

                INSERT INTO data_source_properties(
                  data_source_id, id, name, value_type, config_json, rank_key, lifecycle,
                  schema_revision, created_at, updated_at
                ) VALUES (
                  'source:v110-priority', 'related', 'Related', 'relation', '{}',
                  'rank:related', 'active', 1,
                  '2026-08-11T10:00:00.000Z', '2026-08-11T10:00:00.000Z'
                );
                INSERT INTO data_source_relation_properties(
                  data_source_id, property_id, target_data_source_id
                ) VALUES ('source:v110-priority', 'related', 'source:v110-priority');
                "#,
            )?;
            transaction.execute("DELETE FROM local_commit_visibility_context", [])?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 114 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 114)?;
            Ok(())
        })
        .expect("seed v114 task hierarchy Store");
        validate_exact_v114_schema(&connection).expect("exact v114 Store");
    }

    fn seed_owned_v115_view_personal_preferences_store(home: &Path) {
        seed_owned_v114_task_hierarchy_store(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v115 writer");
        let collapsed_json = serde_json::to_string(&serde_json::json!([
            "GROUP_\"ship\"",
            "GROUP_\"ship\"",
            "PARENT_ITEM_parent/child",
            "ITEM_direct",
            "PARENT_GROUP_not-a-page",
            "not-an-occurrence",
            42,
            format!("ITEM_{}", "x".repeat(1_025)),
        ]))
        .expect("legacy collapsed occurrences");
        with_immediate_transaction(&mut connection, |transaction| {
            crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                transaction,
            )?;
            ensure_v115_task_parent_relation_authority(transaction, 1_765_000_000_000)?;
            transaction.execute(
                "INSERT INTO database_view_personal_preferences(\
                   profile_id, view_id, presentation_override_json, \
                   collapsed_group_keys_json, revision, created_at, updated_at\
                 ) VALUES (\
                   'profile:v110-priority', 'view:v111-list', \
                   '{\"layout\":\"list\",\"showProperties\":\"always\"}', ?1, 9, \
                   '2026-08-11T10:00:00.000Z', '2026-08-11T11:00:00.000Z'\
                 )",
                [collapsed_json],
            )?;
            transaction.execute("DELETE FROM local_commit_visibility_context", [])?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 115 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 115)?;
            Ok(())
        })
        .expect("seed v115 View personal preferences Store");
        validate_exact_v115_schema(&connection).expect("exact v115 Store");
    }

    fn seed_owned_v116_library_content_cutover_store(home: &Path) {
        seed_owned_v115_view_personal_preferences_store(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v116 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                transaction,
            )?;
            ensure_v116_view_personal_state(transaction)?;
            let now = "2026-08-12T00:00:00.000Z";

            // Existing Library ranks are canonical and intentionally disagree
            // with the retired per-Project order.
            transaction.execute(
                "UPDATE library_block_placements SET rank_key = \
                   '10000000000000000000000000000000' \
                 WHERE library_id = 'library:v110-priority'",
                [],
            )?;
            transaction.execute(
                "UPDATE top_level_block_placements SET rank_key = \
                   'f0000000000000000000000000000000' \
                 WHERE project_id = 'project:v110-priority'",
                [],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, library_id, name, created, updated) \
                 VALUES ('project:v116-secondary', 'library:v110-priority', \
                         'Secondary', '2026-08-12', '2026-08-12')",
                [],
            )?;

            for (page_id, document_id, lifecycle, location_kind, containing_document_id,
                parent_kind, parent_id, location_revision, metadata_revision) in [
                (
                    "page:v116-root",
                    "document:v116-root",
                    "active",
                    "space",
                    None,
                    "library",
                    "library:v110-priority",
                    7_i64,
                    8_i64,
                ),
                (
                    "page:v116-nested",
                    "document:v116-nested",
                    "archived",
                    "document",
                    Some("document:v116-root"),
                    "page",
                    "page:v116-root",
                    4_i64,
                    5_i64,
                ),
                (
                    "page:v116-deleted",
                    "document:v116-deleted",
                    "deleted",
                    "space",
                    None,
                    "library",
                    "library:v110-priority",
                    3_i64,
                    4_i64,
                ),
            ] {
                transaction.execute(
                    "INSERT INTO documents( \
                       id, project_id, generation, head_seq, schema_key, schema_version, \
                       state_vector, state_hash, readiness, authority, created_at, updated_at, \
                       sync_engine \
                     ) VALUES (?1, 'project:v116-secondary', 1, 0, 'nodex.page', 1, X'', \
                       ?2, 'ready', 'ydoc_primary', ?3, ?3, 'canvas_scene')",
                    params![document_id, "0".repeat(64), now],
                )?;
                transaction.execute(
                    "INSERT INTO blocks( \
                       id, project_id, type, lifecycle, location_kind, \
                       containing_document_id, location_revision, metadata_revision, \
                       created_at, updated_at \
                     ) VALUES (?1, 'project:v116-secondary', 'page', ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                    params![
                        page_id,
                        lifecycle,
                        location_kind,
                        containing_document_id,
                        location_revision,
                        metadata_revision,
                        now,
                    ],
                )?;
                transaction.execute(
                    "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                     VALUES (?1, ?2, 'project:v116-secondary', ?3)",
                    params![page_id, document_id, now],
                )?;
                transaction.execute(
                    "INSERT INTO pages( \
                       block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
                       parent_revision, metadata_revision, created_at, updated_at \
                     ) VALUES (?1, 'library:v110-priority', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![
                        page_id,
                        document_id,
                        parent_kind,
                        parent_id,
                        lifecycle,
                        location_revision,
                        metadata_revision,
                        now,
                    ],
                )?;
            }

            transaction.execute(
                "INSERT INTO library_block_placements( \
                   block_id, library_id, rank_key, revision, created_at, updated_at \
                 ) VALUES ( \
                   'page:v116-root', 'library:v110-priority', \
                   '40000000000000000000000000000000', 6, ?1, ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO top_level_block_placements( \
                   block_id, project_id, rank_key, created_at, updated_at \
                 ) VALUES ( \
                   'page:v116-root', 'project:v116-secondary', \
                   '20000000000000000000000000000000', ?1, ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO document_block_index( \
                   document_id, block_id, parent_block_id, ordinal, block_type, text, projected_seq \
                 ) VALUES ( \
                   'document:v116-root', 'page:v116-nested', NULL, 0, 'page', '', 0 \
                 )",
                [],
            )?;

            let empty_canvas = CanvasScene {
                elements: Vec::new(),
                app_state: Map::new(),
                files: BTreeMap::new(),
                page_references: Vec::new(),
                plain_text: String::new(),
                preview: String::new(),
            };
            let canvas_metadata = compute_canvas_scene_incremental_metadata(&empty_canvas)?;
            transaction.execute(
                "INSERT INTO documents( \
                   id, project_id, generation, head_seq, schema_key, schema_version, \
                   state_vector, state_hash, readiness, authority, created_at, updated_at, \
                   sync_engine \
                 ) VALUES ( \
                   'document:v116-canvas', 'project:v116-secondary', 1, 0, 'nodex.canvas', 1, \
                   X'', ?1, 'ready', 'ydoc_primary', ?2, ?2, 'canvas_scene' \
                 )",
                params![canvas_metadata.scene_hash, now],
            )?;
            transaction.execute(
                "INSERT INTO blocks( \
                   id, project_id, type, lifecycle, location_kind, location_revision, \
                   metadata_revision, created_at, updated_at \
                 ) VALUES ( \
                   'canvas:v116-primary', 'project:v116-secondary', 'canvas', 'active', \
                   'space', 2, 3, ?1, ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                 VALUES ('canvas:v116-primary', 'document:v116-canvas', \
                         'project:v116-secondary', ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO canvas_owners(block_id, library_id, created_at, updated_at) \
                 VALUES ('canvas:v116-primary', 'library:v110-priority', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO canvas_scenes( \
                   document_id, generation, head_seq, schema_version, scene_hash_version, \
                   app_state_json, app_state_hash, scene_hash, element_count, tombstone_count, \
                   file_count, element_json_bytes, file_json_bytes, scene_byte_length, updated_at \
                 ) VALUES ( \
                   'document:v116-canvas', 1, 0, 1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 \
                 )",
                params![
                    CANVAS_SCENE_HASH_VERSION,
                    canvas_metadata.app_state_json,
                    canvas_metadata.app_state_hash,
                    canvas_metadata.scene_hash,
                    canvas_metadata.counters.element_count,
                    canvas_metadata.counters.tombstone_count,
                    canvas_metadata.counters.file_count,
                    canvas_metadata.counters.element_json_bytes,
                    canvas_metadata.counters.file_json_bytes,
                    canvas_metadata.counters.scene_byte_length,
                    now,
                ],
            )?;
            transaction.execute(
                "INSERT INTO top_level_block_placements( \
                   block_id, project_id, rank_key, created_at, updated_at \
                 ) VALUES ( \
                   'canvas:v116-primary', 'project:v116-secondary', \
                   '30000000000000000000000000000000', ?1, ?1 \
                 )",
                [now],
            )?;

            transaction.execute(
                "INSERT INTO blocks( \
                   id, project_id, type, lifecycle, location_kind, containing_document_id, \
                   location_revision, metadata_revision, created_at, updated_at \
                 ) VALUES ( \
                   'block:v116-asset', 'project:v116-secondary', 'paragraph', 'active', \
                   'document', 'document:v116-root', 1, 1, ?1, ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO document_block_index( \
                   document_id, block_id, parent_block_id, ordinal, block_type, text, projected_seq \
                 ) VALUES ( \
                   'document:v116-root', 'block:v116-asset', NULL, 1, 'paragraph', 'asset', 0 \
                 )",
                [],
            )?;
            transaction.execute(
                "INSERT INTO block_asset_refs( \
                   document_id, block_id, owner_block_id, project_id, document_generation, \
                   projected_seq, projection_version, role, ordinal, asset_uri, asset_hash, \
                   updated_at \
                 ) VALUES ( \
                   'document:v116-root', 'block:v116-asset', 'page:v116-root', \
                   'project:v116-secondary', 1, 0, 1, 'attachment', 0, \
                   'nodex://assets/v116.txt', NULL, ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO block_search_units( \
                   unit_key, project_id, block_id, owner_block_id, document_id, \
                   document_generation, projected_seq, source_revision, projection_version, \
                   source_kind, field_key, text, text_hash, updated_at \
                 ) VALUES ( \
                   'search:v116-root', 'project:v116-secondary', 'page:v116-root', \
                   'page:v116-root', 'document:v116-root', 1, 0, NULL, 1, \
                   'document_title', 'title', 'Root', ?1, ?2 \
                 )",
                params![sha256(b"Root"), now],
            )?;
            transaction.execute(
                "INSERT INTO scheduled_page_index( \
                   page_block_id, project_id, lifecycle, scheduled_start, scheduled_end, \
                   is_all_day, recurrence_json, reminders_json, source_metadata_revision, \
                   updated_at \
                 ) VALUES ( \
                   'page:v116-root', 'project:v116-secondary', 'active', \
                   '2026-08-14T09:00:00.000Z', NULL, 0, 'null', '[]', 8, ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO recurrence_exceptions( \
                   project_id, page_id, occurrence_start, exception_type, created \
                 ) VALUES ( \
                   'project:v116-secondary', 'page:v116-root', \
                   '2026-08-14T09:00:00.000Z', 'skip', ?1 \
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO project_resource_grants( \
                   id, project_id, library_id, root_kind, root_id, access, recursive, revision, \
                   lifecycle, created_at, updated_at \
                 ) VALUES ( \
                   'grant:v116-existing', 'project:v110-priority', 'library:v110-priority', \
                   'page', 'page:v116-root', 'read', 1, 3, 'active', ?1, ?1 \
                 )",
                [now],
            )?;

            transaction.execute("DELETE FROM local_commit_visibility_context", [])?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 116 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 116)?;
            Ok(())
        })
        .expect("seed representative v116 Library content Store");
        validate_exact_v116_schema(&connection).expect("exact v116 Store");
        validate_store(&connection).expect("valid representative v116 Store");
    }

    fn seed_owned_v99_store_with_property_value(home: &Path) {
        let mut connection = open_writer(&home.join("nodex.db")).expect("v99 writer");
        install_v84_schema(&connection).expect("v84 schema");
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
                 ) VALUES (1, ?1, 99, NULL, NULL, 1)",
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
            ensure_v98_yjs_integrity_schema(transaction)?;
            ensure_v99_owner_scoped_scenes_schema(transaction)?;

            let now = "2026-08-04T00:00:00.000Z";
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at) \
                 VALUES ('profile:v99', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                 VALUES ('library:v99', 'profile:v99', ?1, ?1)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, name, created, updated, library_id) \
                 VALUES ('project:v99', 'Migration', '2026-08-04', '2026-08-04', 'library:v99')",
                [],
            )?;
            transaction.execute(
                "INSERT INTO blocks(\
                   id, project_id, type, lifecycle, location_kind, created_at, updated_at\
                 ) VALUES (\
                   'database:v99', 'project:v99', 'database', 'active', 'space', ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO database_containers(\
                   block_id, library_id, name, lifecycle, created_at, updated_at\
                 ) VALUES (\
                   'database:v99', 'library:v99', 'Migration', 'active', ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_sources(\
                   id, library_id, home_database_block_id, name, schema_key, lifecycle, \
                   rank_key, created_at, updated_at\
                 ) VALUES (\
                   'source:v99', 'library:v99', 'database:v99', 'Migration', \
                   'nodex.database', 'active', 'a', ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_source_properties(\
                   data_source_id, id, name, value_type, config_json, rank_key, lifecycle, \
                   schema_revision, created_at, updated_at\
                 ) VALUES (\
                   'source:v99', 'note', 'Note', 'text', '{}', 'a', 'active', 7, ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO blocks(\
                   id, project_id, type, lifecycle, location_kind, containing_database_id, \
                   created_at, updated_at\
                 ) VALUES (\
                   'page:v99', 'project:v99', 'page', 'active', 'database', 'database:v99', ?1, ?1\
                 )",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_source_page_memberships(\
                   id, data_source_id, page_block_id, revision, created_at, removed_at\
                 ) VALUES ('membership:v99', 'source:v99', 'page:v99', 3, ?1, NULL)",
                [now],
            )?;
            transaction.execute(
                "INSERT INTO data_source_property_values(\
                   data_source_id, membership_id, property_id, value_type, value_json, \
                   revision, updated_at\
                 ) VALUES (\
                   'source:v99', 'membership:v99', 'note', 'text', '\"preserve me\"', 11, ?1\
                 )",
                [now],
            )?;
            transaction.pragma_update(None, "user_version", 99)?;
            Ok(())
        })
        .expect("seed v99 Store");
        validate_exact_v99_schema(&connection).expect("exact v99 Store");
    }

    fn seed_owned_v108_store_with_person_value(home: &Path) {
        seed_owned_v99_store_with_property_value(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v99 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            ensure_v100_relation_properties_schema(transaction)?;
            ensure_v101_projectless_permission_mode_schema(transaction)?;
            ensure_v102_local_commit_schema(transaction, &mut |_, _| {})?;
            ensure_v103_local_commit_composite_identity(transaction)?;
            ensure_v105_local_commit_manifest_schema(transaction)?;
            ensure_v106_projection_scope_heads_schema(transaction)?;
            ensure_v107_block_project_cascade_indexes(transaction)?;
            ensure_v108_local_commit_revocations_schema(transaction)?;
            transaction.execute(
                "UPDATE data_source_properties SET value_type = 'person'
                 WHERE data_source_id = 'source:v99' AND id = 'note'",
                [],
            )?;
            transaction.execute(
                "UPDATE data_source_property_values SET value_type = 'person'
                 WHERE data_source_id = 'source:v99'
                   AND membership_id = 'membership:v99'
                   AND property_id = 'note'",
                [],
            )?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 108 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 108)?;
            Ok(())
        })
        .expect("seed v108 Store");
        validate_exact_v108_schema(&connection).expect("exact v108 Store");
    }

    fn seed_owned_v109_store(home: &Path) {
        seed_owned_v108_store_with_person_value(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v108 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            ensure_v109_local_commit_delivery_atoms_schema(transaction)?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 109 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 109)?;
            Ok(())
        })
        .expect("seed v109 Store");
        validate_exact_v109_schema(&connection).expect("exact v109 Store");
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
                r#"INSERT INTO database_views(
                   id, database_block_id, data_source_id, name, kind, config_json,
                   rank_key, lifecycle, created_at, updated_at
                 ) VALUES (
                   'view:timestamp', 'database:timestamp', 'source:timestamp', 'Canvas', 'canvas',
                   '{"schemaKey":"nodex.database-view","schemaVersion":2,"filter":{"kind":"group","operator":"and","children":[]},"sort":[],"group":null,"display":{"propertyIds":[],"showTitle":true}}',
                   'a', 'active', ?1, ?1
                 )"#,
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
    fn v110_priority_registry_maps_only_p4_to_p3_without_losing_custom_metadata() {
        let default_config = serde_json::json!({
            "options": [{ "id": "p4-later", "name": "P4 - Later", "color": "gray" }]
        });
        let (migrated, state) = migrate_v110_priority_config(
            "source:default",
            &serde_json::to_string(&default_config).expect("default config"),
        )
        .expect("migrate default P4");
        let migrated = serde_json::from_str::<StoredPriorityConfig>(
            migrated.as_deref().expect("default migration output"),
        )
        .expect("default migrated config");
        assert_eq!(
            migrated.options,
            vec![StoredPriorityOption {
                id: P3_PRIORITY_ID.to_owned(),
                name: P3_PRIORITY_NAME.to_owned(),
                color: Some("gray".to_owned()),
            }]
        );
        assert_eq!(
            state.current_ids,
            BTreeSet::from([P3_PRIORITY_ID.to_owned()])
        );

        let custom_config = serde_json::json!({
            "options": [{ "id": "p4-later", "name": "Someday", "color": "teal" }]
        });
        let (migrated, _) = migrate_v110_priority_config(
            "source:custom",
            &serde_json::to_string(&custom_config).expect("custom config"),
        )
        .expect("migrate custom P4");
        let migrated = serde_json::from_str::<StoredPriorityConfig>(
            migrated.as_deref().expect("custom migration output"),
        )
        .expect("custom migrated config");
        assert_eq!(migrated.options[0].name, "Someday");
        assert_eq!(migrated.options[0].color.as_deref(), Some("teal"));

        let current_config = serde_json::json!({
            "options": [{ "id": "p3-low", "name": "Current" }]
        });
        let (migrated, state) = migrate_v110_priority_config(
            "source:current",
            &serde_json::to_string(&current_config).expect("current config"),
        )
        .expect("accept current Priority config");
        assert!(migrated.is_none());
        assert_eq!(
            state.current_ids,
            BTreeSet::from([P3_PRIORITY_ID.to_owned()])
        );
    }

    #[test]
    fn v110_priority_filter_migration_is_recursive_and_property_scoped() {
        let mut filter = serde_json::json!({
            "kind": "group",
            "operator": "and",
            "children": [
                {
                    "kind": "clause",
                    "propertyId": "priority",
                    "operator": "not_equals",
                    "value": "p4-later"
                },
                {
                    "kind": "clause",
                    "propertyId": "note",
                    "operator": "equals",
                    "value": "p4-later"
                }
            ]
        });

        assert!(migrate_priority_filter(&mut filter, true).expect("migrate filter"));
        assert_eq!(
            filter.pointer("/children/0/value").and_then(Value::as_str),
            Some(P3_PRIORITY_ID)
        );
        assert_eq!(
            filter.pointer("/children/1/value").and_then(Value::as_str),
            Some(LEGACY_P4_PRIORITY_ID)
        );
        assert!(!migrate_priority_filter(&mut filter, false).expect("validate filter"));
    }

    #[test]
    fn v110_priority_migration_rejects_unknown_priority_and_preserves_backup() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v110_store_with_p4_priority(&home);
        let connection = open_writer(&home.join("nodex.db")).expect("v110 writer");
        connection
            .execute(
                "UPDATE data_source_property_values SET value_json = '\"p5-unknown\"' \
                 WHERE data_source_id = 'source:v110-priority' \
                   AND membership_id = 'membership:v110-priority' \
                   AND property_id = 'priority'",
                [],
            )
            .expect("seed unknown Priority");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        let connection = open_writer(&home.join("nodex.db")).expect("rolled back writer");
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("rolled back schema version"),
            110
        );
        let config = connection
            .query_row(
                "SELECT config_json FROM data_source_properties \
                 WHERE data_source_id = 'source:v110-priority' AND id = 'priority'",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("rolled back Priority config");
        assert!(config.contains(LEGACY_P4_PRIORITY_ID));
        let rolled_back = connection
            .query_row(
                "SELECT property.schema_revision, source.schema_revision, value.value_json, \
                        value.revision \
                 FROM data_source_properties property \
                 JOIN data_sources source ON source.id = property.data_source_id \
                 JOIN data_source_property_values value \
                   ON value.data_source_id = property.data_source_id \
                   AND value.property_id = property.id \
                 WHERE property.data_source_id = 'source:v110-priority' \
                   AND property.id = 'priority'",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .expect("rolled back Priority revisions");
        assert_eq!(rolled_back, (5, 9, "\"p5-unknown\"".to_owned(), 7));

        let backup_directory = prepare_migration_backup_directory(&home).expect("backup directory");
        let backups = fs::read_dir(backup_directory)
            .expect("migration backups")
            .collect::<Result<Vec<_>, _>>()
            .expect("read migration backups");
        assert_eq!(backups.len(), 1);
        validate_migration_backup(&backups[0].path(), 110).expect("valid v110 backup");
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
    fn v118_upgrade_removes_the_duplicate_block_document_index_once() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let current = SqliteStoreKernel::open(&home).expect("fresh current Store");
        drop(current);

        let connection = open_writer(&home.join("nodex.db")).expect("current writer");
        remove_v121_page_key_schema(&connection).expect("remove v121 Page-key schema");
        connection
            .execute_batch(
                "DROP TRIGGER document_block_tombstones_validate_insert; \
                 DROP TRIGGER document_block_tombstones_are_immutable; \
                 DROP INDEX idx_document_block_tombstones_document; \
                 DROP TABLE document_block_tombstones; \
                 DROP TABLE local_commit_relocation_obligations; \
                 ALTER TABLE document_structural_barriers DROP COLUMN document_wide_fence; \
                 CREATE UNIQUE INDEX idx_block_documents_owner_document_library_v117 \
                   ON block_documents(block_id, document_id, library_id); \
                 UPDATE core_store_metadata SET store_format_version = 118 \
                   WHERE id = 1 AND schema_owner = 'rust_core'; \
                 PRAGMA user_version = 118;",
            )
            .expect("reconstruct exact v118 schema");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v118 Store");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(118));
        let obsolete_indexes = upgraded
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT count(*) FROM sqlite_schema \
                         WHERE type = 'index' \
                           AND name = 'idx_block_documents_owner_document_library_v117'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("read current Block-Document indexes");
        assert_eq!(obsolete_indexes, 0);

        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v118 migration backup");
        let backup = open_immutable_reader(backup_path).expect("v118 backup");
        let backed_up_index = backup
            .query_row(
                "SELECT count(*) FROM sqlite_schema \
                 WHERE type = 'index' \
                   AND name = 'idx_block_documents_owner_document_library_v117'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("read backed-up v118 index");
        assert_eq!(backed_up_index, 1);

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen current Store");
        assert_eq!(reopened.preparation().migrated_from_version, None);
    }

    #[test]
    fn v114_task_hierarchy_migrates_to_the_standard_parent_relation_once() {
        #[derive(Debug, Eq, PartialEq)]
        struct TaskHierarchySnapshot {
            retired_table_count: i64,
            target_data_source_id: String,
            task_parent_cardinality: String,
            root_revision: i64,
            child_revision: i64,
            parent_page_id: String,
            sibling_rank: String,
            generic_relation_cardinality: String,
        }

        fn snapshot(connection: &Connection) -> Result<TaskHierarchySnapshot, StoreError> {
            let retired_table = connection.query_row(
                "SELECT count(*) FROM sqlite_schema \
                 WHERE type = 'table' AND name = 'database_task_hierarchy_edges'",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            let (target_source, cardinality) = connection.query_row(
                "SELECT target_data_source_id, cardinality \
                 FROM data_source_relation_properties \
                 WHERE data_source_id = 'source:v110-priority' \
                   AND property_id = 'task_parent'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?;
            let root_revision = connection.query_row(
                "SELECT value.revision \
                 FROM data_source_property_values value \
                 WHERE value.data_source_id = 'source:v110-priority' \
                   AND value.membership_id = 'membership:v110-priority' \
                   AND value.property_id = 'task_parent'",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            let child_revision = connection.query_row(
                "SELECT value.revision \
                 FROM data_source_property_values value \
                 WHERE value.data_source_id = 'source:v110-priority' \
                   AND value.membership_id = 'membership:v114-child' \
                   AND value.property_id = 'task_parent'",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            let (parent_page_id, sibling_rank) = connection.query_row(
                "SELECT edge.target_page_block_id, edge.sibling_rank \
                 FROM data_source_relation_edges edge \
                 WHERE edge.source_data_source_id = 'source:v110-priority' \
                   AND edge.source_membership_id = 'membership:v114-child' \
                   AND edge.property_id = 'task_parent'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )?;
            let generic_cardinality = connection.query_row(
                "SELECT cardinality FROM data_source_relation_properties \
                 WHERE data_source_id = 'source:v110-priority' \
                   AND property_id = 'related'",
                [],
                |row| row.get::<_, String>(0),
            )?;
            Ok(TaskHierarchySnapshot {
                retired_table_count: retired_table,
                target_data_source_id: target_source,
                task_parent_cardinality: cardinality,
                root_revision,
                child_revision,
                parent_page_id,
                sibling_rank,
                generic_relation_cardinality: generic_cardinality,
            })
        }

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v114_task_hierarchy_store(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v114 task hierarchy");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(114));
        let first = upgraded
            .readers()
            .read_default(snapshot)
            .expect("read migrated Parent Relation");
        assert_eq!(
            first,
            TaskHierarchySnapshot {
                retired_table_count: 0,
                target_data_source_id: "source:v110-priority".to_owned(),
                task_parent_cardinality: "one".to_owned(),
                root_revision: 1,
                child_revision: 7,
                parent_page_id: "page:v110-priority".to_owned(),
                sibling_rank: "7fffffffffffffffffffffffffffffff".to_owned(),
                generic_relation_cardinality: "many".to_owned(),
            }
        );

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen v115 Parent Relation");
        assert_eq!(reopened.preparation().migrated_from_version, None);
        let second = reopened
            .readers()
            .read_default(snapshot)
            .expect("read idempotent Parent Relation");
        assert_eq!(second, first);
    }

    #[test]
    fn v115_view_preferences_split_into_independent_personal_state_once() {
        type Snapshot = (
            i64,
            Option<(Value, i64, String, String)>,
            Vec<(String, String, String)>,
        );

        fn snapshot(connection: &Connection) -> Result<Snapshot, StoreError> {
            let legacy_table = connection.query_row(
                "SELECT count(*) FROM sqlite_schema \
                 WHERE type = 'table' AND name = 'database_view_personal_preferences'",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            let presentation = connection
                .query_row(
                    "SELECT presentation_override_json, revision, created_at, updated_at \
                     FROM database_view_personal_presentations \
                     WHERE profile_id = 'profile:v110-priority' \
                       AND view_id = 'view:v111-list'",
                    [],
                    |row| {
                        let json = row.get::<_, String>(0)?;
                        Ok((
                            serde_json::from_str::<Value>(&json).map_err(|error| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    0,
                                    rusqlite::types::Type::Text,
                                    Box::new(error),
                                )
                            })?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?;
            let collapsed = connection
                .prepare(
                    "SELECT target_kind, occurrence_key, collapsed_at \
                     FROM database_view_collapsed_occurrences \
                     WHERE profile_id = 'profile:v110-priority' \
                       AND view_id = 'view:v111-list' \
                     ORDER BY target_kind, occurrence_key",
                )?
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok((legacy_table, presentation, collapsed))
        }

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v115_view_personal_preferences_store(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v115 personal View state");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(115));
        let first = upgraded
            .readers()
            .read_default(snapshot)
            .expect("read migrated personal View state");
        assert_eq!(first.0, 0);
        assert_eq!(
            first.1,
            Some((
                serde_json::json!({ "layout": "list", "showProperties": "always" }),
                1,
                "2026-08-11T10:00:00.000Z".to_owned(),
                "2026-08-11T11:00:00.000Z".to_owned(),
            ))
        );
        assert_eq!(
            first.2,
            vec![
                (
                    "group".to_owned(),
                    "GROUP_\"ship\"".to_owned(),
                    "2026-08-11T11:00:00.000Z".to_owned(),
                ),
                (
                    "page".to_owned(),
                    "ITEM_direct".to_owned(),
                    "2026-08-11T11:00:00.000Z".to_owned(),
                ),
                (
                    "page".to_owned(),
                    "ITEM_parent/child".to_owned(),
                    "2026-08-11T11:00:00.000Z".to_owned(),
                ),
            ]
        );

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen v116 personal View state");
        assert_eq!(reopened.preparation().migrated_from_version, None);
        let second = reopened
            .readers()
            .read_default(snapshot)
            .expect("read idempotent personal View state");
        assert_eq!(second, first);
    }

    #[test]
    fn v116_library_content_cutover_preserves_content_and_materializes_access_once() {
        fn snapshot(connection: &Connection) -> Result<Vec<(String, String, String)>, StoreError> {
            connection
                .prepare(
                    "SELECT kind, identity, value FROM ( \
                       SELECT 'block' AS kind, id AS identity, \
                              library_id || '|' || type || '|' || lifecycle || '|' || \
                              placement_revision || '|' || metadata_revision AS value \
                       FROM blocks WHERE id LIKE '%:v116-%' \
                       UNION ALL \
                       SELECT 'document', id, library_id || '|' || schema_key \
                       FROM documents WHERE id LIKE '%:v116-%' \
                       UNION ALL \
                       SELECT 'page', block_id, \
                              library_id || '|' || document_id || '|' || parent_kind || '|' || parent_id \
                       FROM pages WHERE block_id LIKE '%:v116-%' \
                       UNION ALL \
                       SELECT 'placement', block_id, library_id || '|' || rank_key || '|' || revision \
                       FROM library_block_placements WHERE block_id LIKE '%:v116-%' \
                       UNION ALL \
                       SELECT 'grant', id, project_id || '|' || root_kind || '|' || root_id || '|' || access \
                       FROM project_resource_grants WHERE id LIKE 'grant:v116-%' OR id LIKE 'grant:v117:%' \
                     ) ORDER BY kind, identity",
                )?
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(StoreError::from)
        }

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v116_library_content_cutover_store(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v116 Library content");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(116));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v116 migration backup");
        validate_migration_backup(backup_path, 116).expect("valid v116 migration backup");

        let first = upgraded
            .readers()
            .read_default(|connection| {
                for (table, retired_columns) in [
                    ("blocks", &["project_id", "location_kind", "containing_document_id", "containing_database_id", "location_revision"][..]),
                    ("documents", &["project_id"][..]),
                    ("pages", &["lifecycle", "parent_revision", "metadata_revision"][..]),
                ] {
                    for column in retired_columns {
                        let count = connection.query_row(
                            "SELECT count(*) FROM pragma_table_info(?1) WHERE name = ?2",
                            params![table, column],
                            |row| row.get::<_, i64>(0),
                        )?;
                        assert_eq!(count, 0, "{table}.{column} must be retired");
                    }
                }
                for retired_table in [
                    "top_level_block_placements",
                    "library_content_relocations",
                    "library_content_relocation_members",
                ] {
                    let count = connection.query_row(
                        "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1",
                        [retired_table],
                        |row| row.get::<_, i64>(0),
                    )?;
                    assert_eq!(count, 0, "{retired_table} must be retired");
                }

                let root_rank = connection.query_row(
                    "SELECT rank_key FROM library_block_placements \
                     WHERE block_id = 'page:v116-root'",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                let canvas_rank = connection.query_row(
                    "SELECT rank_key FROM library_block_placements \
                     WHERE block_id = 'canvas:v116-primary'",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(root_rank, "40000000000000000000000000000000");
                assert!(canvas_rank > root_rank);

                let library_owned = connection.query_row(
                    "SELECT count(*) FROM blocks \
                     WHERE id IN ( \
                       'page:v116-root', 'page:v116-nested', 'page:v116-deleted', \
                       'canvas:v116-primary', 'block:v116-asset' \
                     ) AND library_id = 'library:v110-priority'",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(library_owned, 5);
                let library_documents = connection.query_row(
                    "SELECT count(*) FROM documents WHERE id LIKE 'document:v116-%' \
                     AND library_id = 'library:v110-priority'",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(library_documents, 4);

                let nested_parent = connection.query_row(
                    "SELECT page.parent_kind, page.parent_id, index_row.document_id \
                     FROM pages page \
                     JOIN document_block_index index_row ON index_row.block_id = page.block_id \
                     WHERE page.block_id = 'page:v116-nested'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                assert_eq!(
                    nested_parent,
                    (
                        "page".to_owned(),
                        "page:v116-root".to_owned(),
                        "document:v116-root".to_owned(),
                    )
                );

                let preserved_projections = connection.query_row(
                    "SELECT \
                       EXISTS(SELECT 1 FROM block_asset_refs WHERE block_id = 'block:v116-asset'), \
                       EXISTS(SELECT 1 FROM block_search_units WHERE unit_key = 'search:v116-root'), \
                       EXISTS(SELECT 1 FROM scheduled_page_index WHERE page_block_id = 'page:v116-root'), \
                       EXISTS(SELECT 1 FROM recurrence_exceptions WHERE page_id = 'page:v116-root')",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )?;
                assert_eq!(preserved_projections, (1, 1, 1, 1));

                let grants = connection.query_row(
                    "SELECT \
                       EXISTS(SELECT 1 FROM project_resource_grants \
                              WHERE id = 'grant:v116-existing' AND access = 'read'), \
                       count(*) FILTER (WHERE project_id = 'project:v116-secondary' \
                         AND root_kind = 'page' AND root_id = 'page:v116-root' \
                         AND access = 'read_write' AND recursive = 1 AND lifecycle = 'active'), \
                       count(*) FILTER (WHERE root_kind = 'canvas' \
                         AND root_id = 'canvas:v116-primary' AND access = 'read_write' \
                         AND recursive = 1 AND lifecycle = 'active') \
                     FROM project_resource_grants",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(grants, (1, 1, 2));
                snapshot(connection)
            })
            .expect("read migrated Library content");

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen v117 Library content");
        assert_eq!(reopened.preparation().migrated_from_version, None);
        let second = reopened
            .readers()
            .read_default(snapshot)
            .expect("read idempotent Library content");
        assert_eq!(second, first);
        drop(reopened);

        let mut connection = open_writer(&home.join("nodex.db")).expect("current writer");
        with_immediate_transaction(&mut connection, |transaction| {
            crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                transaction,
            )?;
            transaction.execute(
                "DELETE FROM projects WHERE id = 'project:v116-secondary'",
                [],
            )?;
            transaction.execute("DELETE FROM local_commit_visibility_context", [])?;
            Ok(())
        })
        .expect("delete actor Project");
        let surviving_content = connection
            .query_row(
                "SELECT \
                   (SELECT count(*) FROM blocks WHERE id LIKE '%:v116-%'), \
                   (SELECT count(*) FROM documents WHERE id LIKE 'document:v116-%'), \
                   EXISTS(SELECT 1 FROM block_asset_refs WHERE block_id = 'block:v116-asset'), \
                   EXISTS(SELECT 1 FROM block_search_units WHERE unit_key = 'search:v116-root'), \
                   EXISTS(SELECT 1 FROM scheduled_page_index WHERE page_block_id = 'page:v116-root'), \
                   EXISTS(SELECT 1 FROM recurrence_exceptions WHERE page_id = 'page:v116-root'), \
                   count(*) FILTER (WHERE project_id = 'project:v116-secondary') \
                 FROM project_resource_grants",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                },
            )
            .expect("read content after Project deletion");
        assert_eq!(surviving_content, (5, 4, 1, 1, 1, 1, 0));
        validate_store(&connection).expect("valid Store after actor Project deletion");
    }

    #[test]
    fn failed_v117_library_content_cutover_rolls_back_and_preserves_backup() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v116_library_content_cutover_store(&home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v116 writer");
        with_immediate_transaction(&mut connection, |transaction| {
            crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
                transaction,
            )?;
            transaction.pragma_update(None, "defer_foreign_keys", true)?;
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at) \
                 VALUES ('profile:v116-other', '2026-08-12T00:00:00.000Z', \
                         '2026-08-12T00:00:00.000Z')",
                [],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                 VALUES ('library:v116-other', 'profile:v116-other', \
                         '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z')",
                [],
            )?;
            transaction.execute(
                "INSERT INTO projects(id, library_id, name, created, updated) \
                 VALUES ('project:v116-other', 'library:v116-other', 'Other', \
                         '2026-08-12', '2026-08-12')",
                [],
            )?;
            transaction.execute(
                "UPDATE blocks SET project_id = 'project:v116-other' \
                 WHERE id = 'page:v116-deleted'",
                [],
            )?;
            transaction.execute(
                "UPDATE documents SET project_id = 'project:v116-other' \
                 WHERE id = 'document:v116-deleted'",
                [],
            )?;
            transaction.execute(
                "UPDATE block_documents SET project_id = 'project:v116-other' \
                 WHERE block_id = 'page:v116-deleted'",
                [],
            )?;
            transaction.execute("DELETE FROM local_commit_visibility_context", [])?;
            Ok(())
        })
        .expect("corrupt legacy ownership coordinate");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        let connection = open_writer(&home.join("nodex.db")).expect("rolled back v116 writer");
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("rolled back schema version"),
            116
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('blocks') WHERE name = 'project_id'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("legacy Block owner column"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema \
                     WHERE type = 'table' AND name = 'top_level_block_placements'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("legacy placement table"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT project_id FROM blocks WHERE id = 'page:v116-deleted'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("corrupt source row survives rollback"),
            "project:v116-other"
        );

        let backups = fs::read_dir(prepare_migration_backup_directory(&home).expect("backup dir"))
            .expect("migration backups")
            .collect::<Result<Vec<_>, _>>()
            .expect("read migration backups");
        assert_eq!(backups.len(), 1);
        validate_migration_backup(&backups[0].path(), 116).expect("valid v116 backup");
    }

    #[test]
    fn v111_database_views_migrate_to_the_current_view_contract_once() {
        #[derive(Debug, PartialEq)]
        struct DatabaseViewMigrationSnapshot {
            views: Value,
            completed_at: Option<String>,
            retired_kind_columns: i64,
            retired_position_group_columns: i64,
            stable_rank: String,
            page_key_namespace: (String, i64, i64),
        }

        fn snapshot(connection: &Connection) -> Result<DatabaseViewMigrationSnapshot, StoreError> {
            let views = connection.query_row(
                "SELECT json_group_array(json(view_record)) FROM ( \
                   SELECT json_object( \
                     'id', id, \
                     'layout', default_layout, \
                     'schema', json_extract(config_json, '$.schemaVersion'), \
                     'boardFields', json_array_length( \
                       json_extract(config_json, '$.presentation.layouts.board.fields') \
                     ), \
                     'listFields', json_array_length( \
                       json_extract(config_json, '$.presentation.layouts.list.fields') \
                     ), \
                     'boardPageKeys', (SELECT count(*) FROM json_each( \
                       config_json, '$.presentation.layouts.board.fields' \
                     ) field WHERE json_extract(field.value, '$.kind') = 'intrinsic' \
                       AND json_extract(field.value, '$.field') = 'page_key'), \
                     'listPageKeys', (SELECT count(*) FROM json_each( \
                       config_json, '$.presentation.layouts.list.fields' \
                     ) field WHERE json_extract(field.value, '$.kind') = 'intrinsic' \
                       AND json_extract(field.value, '$.field') = 'page_key'), \
                     'revision', revision \
                   ) AS view_record \
                   FROM database_views ORDER BY id \
                 )",
                [],
                |row| row.get::<_, String>(0),
            )?;
            let completed_at = connection.query_row(
                "SELECT completed_at FROM data_source_page_memberships \
                 WHERE id = 'membership:v110-priority'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )?;
            let retired_kind_columns = connection.query_row(
                "SELECT count(*) FROM pragma_table_info('database_views') WHERE name = 'kind'",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            let retired_position_group_columns = connection.query_row(
                "SELECT count(*) FROM pragma_table_info('database_view_page_positions') \
                 WHERE name = 'group_key'",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            let stable_rank = connection.query_row(
                "SELECT rank_key FROM database_view_page_positions \
                 WHERE view_id = 'view:v110-priority' \
                   AND page_block_id = 'page:v110-priority'",
                [],
                |row| row.get::<_, String>(0),
            )?;
            let page_key_namespace = connection.query_row(
                "SELECT prefix.normalized_prefix, count(assignment.page_block_id), \
                   namespace.next_number \
                 FROM page_key_namespaces namespace \
                 JOIN page_key_prefixes prefix \
                   ON prefix.database_block_id = namespace.database_block_id \
                  AND prefix.library_id = namespace.library_id \
                  AND prefix.retired_at IS NULL \
                 LEFT JOIN page_key_assignments assignment \
                   ON assignment.database_block_id = namespace.database_block_id \
                 WHERE namespace.database_block_id = 'database:v110-priority' \
                 GROUP BY prefix.normalized_prefix, namespace.next_number",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            Ok(DatabaseViewMigrationSnapshot {
                views: serde_json::from_str(&views).map_err(internal_json)?,
                completed_at,
                retired_kind_columns,
                retired_position_group_columns,
                stable_rank,
                page_key_namespace,
            })
        }

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v111_database_view_store(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v111 Database Views");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(111));
        let first = upgraded
            .readers()
            .read_default(snapshot)
            .expect("read migrated Database View contract");
        assert_eq!(
            first.views,
            json!([
                {
                    "id": "view:v110-priority",
                    "layout": "board",
                    "schema": 4,
                    "boardFields": 4,
                    "listFields": 5,
                    "boardPageKeys": 0,
                    "listPageKeys": 1,
                    "revision": 9
                },
                {
                    "id": "view:v111-calendar",
                    "layout": "list",
                    "schema": 4,
                    "boardFields": 4,
                    "listFields": 5,
                    "boardPageKeys": 0,
                    "listPageKeys": 1,
                    "revision": 6
                },
                {
                    "id": "view:v111-list",
                    "layout": "list",
                    "schema": 4,
                    "boardFields": 4,
                    "listFields": 5,
                    "boardPageKeys": 0,
                    "listPageKeys": 1,
                    "revision": 5
                }
            ])
        );
        assert!(
            first
                .completed_at
                .as_deref()
                .is_some_and(|value| value.ends_with('Z'))
        );
        assert_eq!(first.retired_kind_columns, 0);
        assert_eq!(first.retired_position_group_columns, 0);
        assert_eq!(first.stable_rank, "7fffffffffffffffffffffffffffffff");
        assert_eq!(first.page_key_namespace, ("PM".to_owned(), 1, 2));

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen current Database Views");
        assert_eq!(reopened.preparation().migrated_from_version, None);
        let second = reopened
            .readers()
            .read_default(snapshot)
            .expect("read idempotent Database View contract");
        assert_eq!(second, first);
    }

    #[test]
    fn v110_store_migrates_p4_priority_to_p3_atomically() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v110_store_with_p4_priority(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v110 Priority Store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(110));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v110 migration backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        assert_eq!(
            backup
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("backup schema version"),
            110
        );

        let snapshot = upgraded
            .readers()
            .read_default(|connection| {
                let config_json = connection.query_row(
                    "SELECT config_json FROM data_source_properties \
                     WHERE data_source_id = 'source:v110-priority' AND id = 'priority'",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                let config = serde_json::from_str::<StoredPriorityConfig>(&config_json)
                    .map_err(|error| corrupt(format!("test Priority config: {error}")))?;
                assert_eq!(
                    config
                        .options
                        .iter()
                        .find(|option| option.id == P3_PRIORITY_ID)
                        .map(|option| (option.name.as_str(), option.color.as_deref())),
                    Some(("Custom Low", Some("green")))
                );
                assert!(
                    config
                        .options
                        .iter()
                        .all(|option| option.id != LEGACY_P4_PRIORITY_ID)
                );

                let value = connection.query_row(
                    "SELECT value_json, revision FROM data_source_property_values \
                     WHERE data_source_id = 'source:v110-priority' \
                       AND membership_id = 'membership:v110-priority' \
                       AND property_id = 'priority'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )?;
                assert_eq!(value, ("\"p3-low\"".to_owned(), 8));

                let position = connection.query_row(
                    "SELECT rank_key, revision \
                     FROM database_view_page_positions \
                     WHERE view_id = 'view:v110-priority' \
                       AND page_block_id = 'page:v110-priority'",
                    [],
                    |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    },
                )?;
                assert_eq!(position, (evenly_spaced_rank(0, 1), 9));

                let projection = connection.query_row(
                    "SELECT metadata_revision, database_values_json, property_revisions_json, \
                            view_group_key, view_rank_key, projection_version \
                     FROM page_read_model WHERE page_block_id = 'page:v110-priority'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )?;
                assert_eq!(projection.0, 4);
                assert_eq!(
                    serde_json::from_str::<Value>(&projection.1)
                        .map_err(internal_json)?["priority"],
                    Value::String(P3_PRIORITY_ID.to_owned())
                );
                assert_eq!(
                    serde_json::from_str::<Value>(&projection.2)
                        .map_err(internal_json)?["database"]["priority"],
                    Value::from(8)
                );
                assert_eq!(projection.3.as_deref(), Some(P3_PRIORITY_ID));
                assert_eq!(projection.4.as_deref(), Some("rank:stable"));
                assert_eq!(projection.5, 6);

                let revisions = connection.query_row(
                    "SELECT \
                       (SELECT schema_revision FROM data_source_properties \
                        WHERE data_source_id = 'source:v110-priority' AND id = 'priority'), \
                       (SELECT schema_revision FROM data_sources \
                        WHERE id = 'source:v110-priority'), \
                       (SELECT revision FROM database_views \
                        WHERE id = 'view:v110-priority'), \
                       (SELECT metadata_revision FROM database_containers \
                        WHERE block_id = 'database:v110-priority'), \
                       (SELECT metadata_revision FROM blocks \
                        WHERE id = 'page:v110-priority')",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?;
                assert_eq!(revisions, (6, 11, 9, 5, 4));

                let view_config = connection.query_row(
                    "SELECT config_json FROM database_views \
                     WHERE id = 'view:v110-priority'",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(
                    serde_json::from_str::<Value>(&view_config)
                        .map_err(internal_json)?
                        .pointer("/filter/value")
                        .and_then(Value::as_str),
                    Some(P3_PRIORITY_ID)
                );
                validate_database_priority_invariants(connection)?;
                Ok((value, position, projection, revisions, view_config))
            })
            .expect("verify migrated Priority state");

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen v113 Priority Store");
        assert_eq!(reopened.preparation().migrated_from_version, None);
        let reopened_snapshot = reopened
            .readers()
            .read_default(|connection| {
                let value = connection.query_row(
                    "SELECT value_json, revision FROM data_source_property_values \
                     WHERE data_source_id = 'source:v110-priority' \
                       AND membership_id = 'membership:v110-priority' \
                       AND property_id = 'priority'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )?;
                let position = connection.query_row(
                    "SELECT rank_key, revision \
                     FROM database_view_page_positions \
                     WHERE view_id = 'view:v110-priority' \
                       AND page_block_id = 'page:v110-priority'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )?;
                let projection = connection.query_row(
                    "SELECT metadata_revision, database_values_json, property_revisions_json, \
                            view_group_key, view_rank_key, projection_version \
                     FROM page_read_model WHERE page_block_id = 'page:v110-priority'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<String>>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )?;
                let revisions = connection.query_row(
                    "SELECT \
                       (SELECT schema_revision FROM data_source_properties \
                        WHERE data_source_id = 'source:v110-priority' AND id = 'priority'), \
                       (SELECT schema_revision FROM data_sources \
                        WHERE id = 'source:v110-priority'), \
                       (SELECT revision FROM database_views \
                        WHERE id = 'view:v110-priority'), \
                       (SELECT metadata_revision FROM database_containers \
                        WHERE block_id = 'database:v110-priority'), \
                       (SELECT metadata_revision FROM blocks \
                        WHERE id = 'page:v110-priority')",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?;
                let view_config = connection.query_row(
                    "SELECT config_json FROM database_views WHERE id = 'view:v110-priority'",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                Ok((value, position, projection, revisions, view_config))
            })
            .expect("read reopened Priority state");
        assert_eq!(reopened_snapshot, snapshot);
    }

    #[test]
    fn v110_priority_position_only_migration_bumps_page_metadata_once() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v110_store_with_p4_priority(&home);
        let connection = open_writer(&home.join("nodex.db")).expect("v110 writer");
        connection
            .execute(
                "UPDATE data_source_property_values SET value_json = '\"p3-low\"' \
                 WHERE data_source_id = 'source:v110-priority' \
                   AND membership_id = 'membership:v110-priority' \
                   AND property_id = 'priority'",
                [],
            )
            .expect("seed current Priority value");
        connection
            .execute(
                "UPDATE page_read_model SET database_values_json = \
                   '{\"priority\":\"p3-low\"}' \
                 WHERE page_block_id = 'page:v110-priority'",
                [],
            )
            .expect("seed current Priority projection");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade position-only Store");
        upgraded
            .readers()
            .read_default(|connection| {
                let value = connection.query_row(
                    "SELECT value_json, revision FROM data_source_property_values \
                     WHERE data_source_id = 'source:v110-priority' \
                       AND membership_id = 'membership:v110-priority' \
                       AND property_id = 'priority'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )?;
                assert_eq!(value, ("\"p3-low\"".to_owned(), 7));
                let migrated = connection.query_row(
                    "SELECT position.revision, block.metadata_revision, \
                            projection.metadata_revision, \
                            projection.projection_version \
                     FROM database_view_page_positions position \
                     JOIN blocks block ON block.id = position.page_block_id \
                     JOIN page_read_model projection \
                       ON projection.page_block_id = position.page_block_id \
                     WHERE position.view_id = 'view:v110-priority' \
                       AND position.page_block_id = 'page:v110-priority'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )?;
                assert_eq!(migrated, (9, 4, 4, 6));
                Ok(())
            })
            .expect("verify position-only Priority migration");
    }

    #[test]
    fn v110_dormant_priority_migration_updates_only_value_and_schema_revisions() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v110_store_with_p4_priority(&home);
        let connection = open_writer(&home.join("nodex.db")).expect("v110 writer");
        connection
            .execute(
                "UPDATE data_source_property_values SET value_json = '\"p3-low\"' \
                 WHERE data_source_id = 'source:v110-priority' \
                   AND membership_id = 'membership:v110-priority' \
                   AND property_id = 'priority'",
                [],
            )
            .expect("seed current active Priority value");
        connection
            .execute(
                "UPDATE database_view_page_positions SET group_key = 'p3-low' \
                 WHERE view_id = 'view:v110-priority' \
                   AND page_block_id = 'page:v110-priority'",
                [],
            )
            .expect("seed current active Priority position");
        connection
            .execute(
                "UPDATE page_read_model SET database_values_json = \
                   '{\"priority\":\"p3-low\"}', view_group_key = 'p3-low' \
                 WHERE page_block_id = 'page:v110-priority'",
                [],
            )
            .expect("seed current active Priority projection");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade dormant Priority Store");
        upgraded
            .readers()
            .read_default(|connection| {
                let dormant = connection.query_row(
                    "SELECT property.schema_revision, source.schema_revision, value.value_json, \
                            value.revision \
                     FROM data_source_properties property \
                     JOIN data_sources source ON source.id = property.data_source_id \
                     JOIN data_source_property_values value \
                       ON value.data_source_id = property.data_source_id \
                       AND value.property_id = property.id \
                     WHERE property.data_source_id = 'source:v110-dormant' \
                       AND property.id = 'priority'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )?;
                assert_eq!(dormant, (4, 6, "\"p3-low\"".to_owned(), 12));
                let page = connection.query_row(
                    "SELECT block.metadata_revision, projection.metadata_revision, \
                            projection.projection_version \
                     FROM blocks block \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = 'page:v110-priority'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(page, (3, 3, 4));
                Ok(())
            })
            .expect("verify dormant Priority migration");
    }

    #[test]
    fn v110_priority_migration_repairs_stale_group_projection() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v110_store_with_p4_priority(&home);
        let connection = open_writer(&home.join("nodex.db")).expect("v110 writer");
        connection
            .execute(
                "UPDATE database_view_page_positions SET group_key = 'p3-low' \
                 WHERE view_id = 'view:v110-priority' \
                   AND page_block_id = 'page:v110-priority'",
                [],
            )
            .expect("seed canonical position with stale projection");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade stale projection Store");
        upgraded
            .readers()
            .read_default(|connection| {
                let migrated = connection.query_row(
                    "SELECT position.revision, projection.view_group_key, \
                            projection.projection_version \
                     FROM database_view_page_positions position \
                     JOIN page_read_model projection \
                       ON projection.page_block_id = position.page_block_id \
                     WHERE position.view_id = 'view:v110-priority' \
                       AND position.page_block_id = 'page:v110-priority'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(migrated, (8, Some(P3_PRIORITY_ID.to_owned()), 6));
                validate_database_priority_invariants(connection)
            })
            .expect("verify stale Priority projection repair");
    }

    #[test]
    fn v110_priority_value_without_read_model_still_bumps_page_metadata() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v110_store_with_p4_priority(&home);
        let connection = open_writer(&home.join("nodex.db")).expect("v110 writer");
        connection
            .execute(
                "DELETE FROM page_read_model WHERE page_block_id = 'page:v110-priority'",
                [],
            )
            .expect("remove disposable Page projection");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade projectionless Store");
        upgraded
            .readers()
            .read_default(|connection| {
                let migrated = connection.query_row(
                    "SELECT value.value_json, value.revision, block.metadata_revision \
                     FROM data_source_property_values value \
                     JOIN data_source_page_memberships membership \
                       ON membership.id = value.membership_id \
                     JOIN blocks block ON block.id = membership.page_block_id \
                     WHERE value.data_source_id = 'source:v110-priority' \
                       AND value.membership_id = 'membership:v110-priority' \
                       AND value.property_id = 'priority'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(migrated, ("\"p3-low\"".to_owned(), 8, 4));
                Ok(())
            })
            .expect("verify projectionless Priority migration");
    }

    #[test]
    fn v99_upgrade_preserves_property_values_and_publishes_relation_authority() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v99_store_with_property_value(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v99 Core store");
        assert_eq!(upgraded.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(upgraded.preparation().migrated_from_version, Some(99));
        let backup_path = upgraded
            .preparation()
            .migration_backup_path
            .as_ref()
            .expect("v99 migration backup");
        let backup = open_immutable_reader(backup_path).expect("backup opens");
        assert_eq!(
            backup
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("backup schema version"),
            99
        );
        assert_eq!(
            backup
                .query_row(
                    "SELECT value_json, revision FROM data_source_property_values \
                     WHERE data_source_id = 'source:v99' \
                       AND membership_id = 'membership:v99' AND property_id = 'note'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .expect("backup Property value"),
            ("\"preserve me\"".to_owned(), 11)
        );

        upgraded
            .readers()
            .read_default(|connection| {
                let value = connection.query_row(
                    "SELECT property.name, property.value_type, property.schema_revision, \
                            value.value_json, value.revision \
                     FROM data_source_properties property \
                     JOIN data_source_property_values value \
                       ON value.data_source_id = property.data_source_id \
                       AND value.property_id = property.id \
                     WHERE property.data_source_id = 'source:v99' AND property.id = 'note'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?;
                assert_eq!(
                    value,
                    (
                        "Note".to_owned(),
                        "text".to_owned(),
                        7,
                        "\"preserve me\"".to_owned(),
                        11,
                    )
                );
                let relation_objects: i64 = connection.query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name IN (\
                       'data_source_relation_properties', \
                       'data_source_relation_edges', \
                       'idx_data_source_relation_properties_target', \
                       'idx_data_source_relation_edges_property_target', \
                       'idx_data_source_relation_edges_target'\
                     )",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(relation_objects, 5);
                validate_database_relation_invariants(connection)
            })
            .expect("verify v100 Relation authority");

        drop(upgraded);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen exact current Store");
        assert_eq!(reopened.preparation().schema_version, CORE_SCHEMA_VERSION);
        assert_eq!(reopened.preparation().migrated_from_version, None);
    }

    #[test]
    fn v99_upgrade_rebuilds_sealed_projection_descriptors() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v99_store_with_property_value(&home);
        let connection = open_writer(&home.join("nodex.db")).expect("v99 writer");
        connection
            .execute(
                "INSERT INTO change_log(\
                   project_id, store_epoch, kind, operation_id, payload_json, \
                   projection_impact_json, committed_at\
                 ) VALUES (\
                   'project:v99', 'epoch:v99', 'project_workspace.changed', \
                   'v99:projection-impact', \
                   '{\"module\":\"project_workspace\",\"kind\":\"workspace_changed\",\
                     \"projectIds\":[\"project:v99\"],\"sessionIds\":[],\"threadIds\":[],\
                     \"sessionSummaryScopes\":[],\"sessionDetailIds\":[]}', \
                   '{\"kind\":\"resources\",\"page_ids\":[\"page:v99\"],\
                     \"database_ids\":[],\"data_source_ids\":[],\"view_ids\":[],\
                     \"document_heads\":[]}', '2026-08-04T00:00:00.000Z'\
                 )",
                [],
            )
            .expect("seed v99 LocalCommit history");
        drop(connection);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade v99 LocalCommit history");
        upgraded
            .readers()
            .read_default(|connection| {
                let descriptor_count = connection.query_row(
                    "SELECT count(*) FROM local_commit_sealed_projection_effects",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(descriptor_count, 1);
                Ok(())
            })
            .expect("verify rebuilt sealed projection descriptors");
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
                r#"INSERT INTO database_views(
                   id, database_block_id, data_source_id, name, kind, config_json,
                   rank_key, lifecycle, created_at, updated_at
                 ) VALUES (
                   'view:starter', 'database:starter', 'source:starter', 'Kanban', 'kanban',
                   '{"schemaKey":"nodex.database-view","schemaVersion":2,"filter":{"kind":"group","operator":"and","children":[]},"sort":[],"group":null,"display":{"propertyIds":[],"showTitle":true}}',
                   'a', 'active', ?1, ?1
                 )"#,
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
                       ON property.data_source_id = source.id AND property.id = 'title'
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
                let canonical = "2026-02-06T20:37:07.873Z";
                for index in [0, 2, 4, 5] {
                    assert_eq!(timestamps[index], canonical);
                }
                assert!(timestamps[1].ends_with('Z'));
                assert_ne!(timestamps[1], canonical);
                assert!(timestamps[3].ends_with('Z'));
                assert_ne!(timestamps[3], canonical);
                assert_eq!(
                    connection.query_row(
                        "SELECT default_layout FROM database_views
                         WHERE id = 'view:timestamp'",
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
        let CoreEventReplay::Events {
            events,
            commit_head,
        } = CoreEventLog::new(upgraded.readers())
            .replay(0, None)
            .expect("legacy LocalCommit replay")
        else {
            panic!("legacy LocalCommit history should remain replayable");
        };
        assert_eq!(commit_head, 1);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].commit_seq, 1);
    }

    #[test]
    fn v108_store_upgrades_person_values_and_relation_edge_authority() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v108_store_with_person_value(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade exact v108 store");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(108));
        upgraded
            .readers()
            .read_default(|connection| {
                assert_eq!(
                    connection
                        .query_row("PRAGMA user_version", [], |row| { row.get::<_, i64>(0) })?,
                    CORE_SCHEMA_VERSION
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sqlite_schema
                         WHERE type = 'table' AND name = 'local_commit_revocations'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sqlite_schema
                         WHERE type = 'table' AND name = 'local_commit_delivery_atoms'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT value_type FROM data_source_properties
                         WHERE data_source_id = 'source:v99' AND id = 'note'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "text"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT value_type FROM data_source_property_values
                         WHERE data_source_id = 'source:v99'
                           AND membership_id = 'membership:v99'
                           AND property_id = 'note'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "text"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM pragma_table_info('data_source_relation_edges')
                         WHERE name = 'edge_id'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                Ok(())
            })
            .expect("verify v109 Property and delivery authority");
    }

    #[test]
    fn v109_store_upgrades_visibility_journal_and_exact_schema() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v109_store(&home);

        let upgraded = SqliteStoreKernel::open(&home).expect("upgrade exact v109 store");
        assert_eq!(upgraded.preparation().migrated_from_version, Some(109));
        assert!(upgraded.preparation().migration_backup_path.is_some());
        upgraded
            .readers()
            .read_default(|connection| {
                assert_eq!(
                    connection
                        .query_row("PRAGMA user_version", [], |row| { row.get::<_, i64>(0) })?,
                    CORE_SCHEMA_VERSION
                );
                for table in [
                    "local_commit_library_effects",
                    "local_commit_visibility_context",
                    "local_commit_visibility_dirty_facts",
                    "local_commit_visibility_deltas",
                    "local_commit_sealed_projection_effects",
                ] {
                    assert_eq!(
                        connection.query_row(
                            "SELECT count(*) FROM sqlite_schema
                             WHERE type = 'table' AND name = ?1",
                            [table],
                            |row| row.get::<_, i64>(0),
                        )?,
                        1,
                        "missing v110 table {table}"
                    );
                }
                let actual = schema_inventory_fingerprint(&read_schema_inventory(connection)?);
                let expected = expected_store_schema_fingerprint(CORE_SCHEMA_VERSION)?;
                assert_eq!(actual, expected);
                Ok(())
            })
            .expect("verify exact v110 visibility schema");
    }

    #[test]
    #[ignore = "explicit high-cardinality migration gate"]
    fn high_cardinality_v87_ledger_migrates_with_bounded_monotonic_progress() {
        const COMMIT_COUNT: u64 = 10_000;

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v86_store(
            &home,
            r#"{"projectId":"migration-project","terminalSessionId":"terminal:legacy"}"#,
        );
        let mut legacy = open_writer(&home.join("nodex.db")).expect("v86 writer");
        with_immediate_transaction(&mut legacy, |transaction| {
            ensure_v87_project_session_tabs_schema(transaction)?;
            transaction.execute_batch(
                "WITH RECURSIVE sequence(value) AS (
                   SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 10000
                 )
                 INSERT INTO change_log(
                   project_id, store_epoch, kind, operation_id, payload_json, committed_at
                 )
                 SELECT 'migration-project', 'epoch:legacy', 'project_workspace.changed',
                        printf('legacy:event:%05d', value),
                        '{\"module\":\"project_workspace\",\"kind\":\"workspace_changed\",
                          \"projectIds\":[],\"sessionIds\":[],\"threadIds\":[],
                          \"sessionSummaryScopes\":[],\"sessionDetailIds\":[]}',
                        '2026-07-22T00:00:00Z'
                 FROM sequence;",
            )?;
            transaction.execute(
                "UPDATE core_store_metadata SET store_format_version = 87 WHERE id = 1",
                [],
            )?;
            transaction.pragma_update(None, "user_version", 87)?;
            Ok(())
        })
        .expect("seed high-cardinality v87 ledger");
        drop(legacy);

        let mut events = Vec::new();
        let upgraded = SqliteStoreKernel::open_with_observer(&home, |event| events.push(event))
            .expect("upgrade high-cardinality ledger");
        let progress = events
            .iter()
            .filter_map(|event| match event {
                StorePreparationEvent::MigrationProgress { completed, total } => {
                    Some((*completed, *total))
                }
                StorePreparationEvent::MigrationStarted { .. } => None,
            })
            .collect::<Vec<_>>();
        assert!(!progress.is_empty());
        assert!(progress.len() <= 20);
        assert!(progress.windows(2).all(|pair| pair[0].0 < pair[1].0));
        assert_eq!(progress.last(), Some(&(COMMIT_COUNT, COMMIT_COUNT)));

        upgraded
            .readers()
            .read_default(|connection| {
                let migrated: (i64, i64, i64) = connection.query_row(
                    "SELECT count(*), sum(finalized), sum(manifest_json <> '{}')
                     FROM local_commits",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
                assert_eq!(migrated, (10_000, 10_000, 10_000));
                Ok(())
            })
            .expect("verify high-cardinality LocalCommit manifests");
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
        drop(live);
        let retry_error = open_error(&home);
        assert_eq!(retry_error.code, StoreErrorCode::SqliteFailure);
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
    fn migration_reuses_only_an_exact_local_commit_source_snapshot() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("current Core store");
        drop(kernel);
        let connection = open_writer(&home.join("nodex.db")).expect("current writer");
        connection
            .execute(
                "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at)
                 VALUES (1, 'epoch:backup-reuse', '2026-08-08', '2026-08-08')",
                [],
            )
            .expect("Store epoch");
        let backup_directory = prepare_migration_backup_directory(&home).expect("backup directory");
        let existing = backup_directory.join(format!(
            "v{CORE_SCHEMA_VERSION}-to-v{CORE_SCHEMA_VERSION}-existing.db"
        ));
        connection
            .backup(MAIN_DB, &existing, None)
            .expect("existing source backup");
        let pending = backup_directory.join(format!(
            ".v{CORE_SCHEMA_VERSION}-to-v{CORE_SCHEMA_VERSION}.pending.db"
        ));
        fs::create_dir(&pending).expect("sentinel pending path");

        let reused = create_migration_backup(&connection, &home, CORE_SCHEMA_VERSION)
            .expect("exact source backup reuse");

        assert_eq!(reused, existing);
        assert!(pending.is_dir(), "exact reuse copied the source again");

        crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
            &connection,
        )
        .expect("migration fixture maintenance context");
        connection
            .execute_batch(
                "INSERT INTO projects(id, name, created, updated)
                 VALUES ('project:backup-change', 'Changed', '2026-08-08', '2026-08-08');
                 INSERT INTO change_log(
                   project_id, store_epoch, kind, operation_id, payload_json,
                   projection_impact_json, committed_at
                 ) VALUES (
                   'project:backup-change', 'epoch:backup-reuse', 'library.changed',
                   'operation:backup-change', '{}', '{\"kind\":\"none\"}', '2026-08-08'
                 );",
            )
            .expect("advance source without matching LocalCommit evidence");
        let error = create_migration_backup(&connection, &home, CORE_SCHEMA_VERSION)
            .expect_err("changed source cannot reuse an epoch-only backup");
        assert_eq!(error.code, StoreErrorCode::InvalidProfile);
    }

    #[cfg(unix)]
    #[test]
    fn migration_rejects_a_symlinked_backup_ancestor() {
        use std::os::unix::fs::symlink;

        let directory = tempdir().expect("Profile");
        let outside = tempdir().expect("outside backup directory");
        let home = directory.path().canonicalize().expect("absolute Profile");
        seed_owned_v86_store(
            &home,
            r#"{"projectId":"migration-project","terminalSessionId":"terminal:legacy"}"#,
        );
        symlink(outside.path(), home.join("backups")).expect("symlinked backup ancestor");

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::InvalidProfile);
        assert_eq!(
            fs::read_dir(outside.path())
                .expect("outside directory")
                .count(),
            0,
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
                                  WHERE type = 'table' AND name = 'document_engine_fingerprints'), \
                                document.library_id, project.library_id \
                         FROM core_store_metadata metadata \
                         JOIN documents document ON document.id = ?1 \
                         JOIN projects project ON project.id = 'migration-project' \
                         WHERE metadata.id = 1",
                        [DOCUMENT_ID],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, bool>(4)?,
                                row.get::<_, String>(5)?,
                                row.get::<_, String>(6)?,
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
        assert_eq!(evidence.5, evidence.6);
        assert!(!evidence.5.is_empty());
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
    fn current_store_uses_exact_child_key_indexes_for_block_library_cascades() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("current Core store");

        kernel
            .readers()
            .read_default(|connection| {
                for (table, child_key, expected_index) in [
                    (
                        "block_search_units",
                        "block_id",
                        "idx_block_search_units_block",
                    ),
                    (
                        "block_search_units",
                        "owner_block_id",
                        "idx_block_search_units_owner",
                    ),
                    ("block_asset_refs", "block_id", "idx_block_asset_refs_block"),
                    (
                        "block_asset_refs",
                        "owner_block_id",
                        "idx_block_asset_refs_owner",
                    ),
                ] {
                    let sql = format!(
                        "EXPLAIN QUERY PLAN SELECT 1 FROM {table} \
                         WHERE {child_key} = ?1 AND library_id = ?2"
                    );
                    let plan = connection
                        .prepare(&sql)?
                        .query_map(["block:test", "library:test"], |row| {
                            row.get::<_, String>(3)
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?
                        .join("\n");
                    assert!(
                        plan.contains(expected_index),
                        "{table}.{child_key} lost {expected_index}:\n{plan}",
                    );
                }
                Ok(())
            })
            .expect("query plans use exact child-key indexes");
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
