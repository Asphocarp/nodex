use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, MAIN_DB, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, StateVector, Transact, Update};

use crate::document::{
    BlockDocumentSchema, MAX_DOCUMENT_UPDATE_BYTES, create_compatible_document,
    decode_block_document, decode_state_vector_v1, has_pending_dependencies,
    materialize_decoded_document,
};

use super::document_repository::{DocumentHeadRow, DocumentReadRepository};
use super::schema::{
    CORE_SCHEMA_VERSION, TYPESCRIPT_SCHEMA_VERSION, read_schema_inventory, v84_schema_objects_sql,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEngineFingerprint {
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
    pub source_state_hash: String,
    pub yrs_state_vector_sha256: String,
    pub yrs_full_state_sha256: String,
    pub materialization_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorePreparation {
    pub schema_version: i64,
    pub created_fresh: bool,
    pub migrated_from_version: Option<i64>,
    pub migration_backup_path: Option<PathBuf>,
    pub validated_yjs_documents: usize,
}

pub fn prepare_profile_store(
    connection: &mut Connection,
    profile_home: &Path,
) -> Result<StorePreparation, StoreError> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let object_count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if version == 0 && object_count == 0 {
        let now = unix_time_millis()?;
        create_fresh_v85(connection, profile_home, now)?;
        validate_store(connection)?;
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
        validate_v85_metadata(connection)?;
        validate_exact_v85_schema(connection)?;
        validate_store(connection)?;
        let validated_yjs_documents: i64 = connection.query_row(
            "SELECT count(*) FROM document_engine_fingerprints",
            [],
            |row| row.get(0),
        )?;
        return Ok(StorePreparation {
            schema_version: CORE_SCHEMA_VERSION,
            created_fresh: false,
            migrated_from_version: None,
            migration_backup_path: None,
            validated_yjs_documents: usize::try_from(validated_yjs_documents).map_err(|_| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Document fingerprint count is invalid",
                    false,
                )
            })?,
        });
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
    let backup_path = create_migration_backup(connection, profile_home, now, source_version)?;
    let fingerprints = validate_live_yjs_documents(connection)?;
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
    publish_v85(
        connection,
        profile_home,
        Some(source_version),
        Some(backup_name),
        now,
        &fingerprints,
    )?;
    validate_store(connection)?;
    validate_v85_metadata(connection)?;
    Ok(StorePreparation {
        schema_version: CORE_SCHEMA_VERSION,
        created_fresh: false,
        migrated_from_version: Some(source_version),
        migration_backup_path: Some(backup_path),
        validated_yjs_documents: fingerprints.len(),
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

fn validate_live_yjs_documents(
    connection: &Connection,
) -> Result<Vec<DocumentEngineFingerprint>, StoreError> {
    let repository = DocumentReadRepository::new(connection);
    let heads = repository.live_yjs_heads()?;
    heads
        .iter()
        .map(|head| validate_live_yjs_document(&repository, head))
        .collect()
}

pub(crate) fn validate_v85_restore_documents(connection: &Connection) -> Result<usize, StoreError> {
    validate_v85_metadata(connection)?;
    validate_live_yjs_documents(connection).map(|fingerprints| fingerprints.len())
}

fn validate_live_yjs_document(
    repository: &DocumentReadRepository<'_>,
    head: &DocumentHeadRow,
) -> Result<DocumentEngineFingerprint, StoreError> {
    if !is_sha256(&head.state_hash) {
        return Err(corrupt(format!(
            "Document {} has an invalid source state hash",
            head.id
        )));
    }
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
    let actual_vector = document.transact().state_vector();
    if actual_vector != expected_vector {
        return Err(corrupt(format!(
            "Document {} persisted state vector does not match reconstruction",
            head.id
        )));
    }
    let decoded = decode_block_document(&document, schema)
        .map_err(|error| corrupt(format!("Document {} schema validation: {error}", head.id)))?;
    let materialization = materialize_decoded_document(&decoded)
        .map_err(|error| corrupt(format!("Document {} materialization: {error}", head.id)))?;
    assert_persisted_materialization(repository, head, &materialization)?;

    let transaction = document.transact();
    let state_vector_v1 = transaction.state_vector().encode_v1();
    let full_state_v1 = transaction.encode_state_as_update_v1(&StateVector::default());
    drop(transaction);
    if full_state_v1.len() > MAX_DOCUMENT_UPDATE_BYTES {
        return Err(corrupt(format!(
            "Document {} reconstructed state exceeds the Core bound",
            head.id
        )));
    }
    let materialization_json = serde_json::to_vec(&materialization).map_err(|error| {
        StoreError::new(
            StoreErrorCode::Internal,
            format!("Could not serialize Document materialization: {error}"),
            false,
        )
    })?;
    Ok(DocumentEngineFingerprint {
        document_id: head.id.clone(),
        generation: head.generation,
        head_seq: head.head_seq,
        source_state_hash: head.state_hash.clone(),
        yrs_state_vector_sha256: sha256(&state_vector_v1),
        yrs_full_state_sha256: sha256(&full_state_v1),
        materialization_sha256: sha256(&materialization_json),
    })
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
    let matches = persisted.generation == head.generation
        && persisted.projected_seq == head.head_seq
        && persisted.schema_version == i64::from(actual.schema_version)
        && persisted.title == actual.title
        && persisted.rich_title == rich_title
        && persisted.nfm == actual.nfm
        && persisted.plain_text == actual.plain_text
        && persisted.preview == actual.preview
        && persisted.block_tree == block_tree
        && persisted.references == references
        && persisted.asset_refs == asset_refs;
    if matches {
        return Ok(());
    }
    Err(corrupt(format!(
        "Document {} persisted materialization does not match Yrs reconstruction",
        head.id
    )))
}

fn publish_v85(
    connection: &mut Connection,
    profile_home: &Path,
    migrated_from: Option<i64>,
    backup_name: Option<&str>,
    now: u64,
    fingerprints: &[DocumentEngineFingerprint],
) -> Result<(), StoreError> {
    with_immediate_transaction(connection, |transaction| {
        transaction.execute_batch(V85_SCHEMA_SQL)?;
        transaction.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
        ensure_automation_definition_revision(transaction)?;
        ensure_automation_run_revision(transaction)?;
        write_v85_metadata(transaction, migrated_from, backup_name, now, fingerprints)?;
        import_legacy_writable_roots(transaction, profile_home, now)?;
        import_automation_jitter_salt(transaction, profile_home, now)
    })
}

fn create_fresh_v85(
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
        write_v85_metadata(transaction, None, None, now, &[])?;
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
    fingerprints: &[DocumentEngineFingerprint],
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
    let mut insert = transaction.prepare(
        "INSERT INTO document_engine_fingerprints (\
           document_id, generation, head_seq, source_state_hash, yrs_state_vector_sha256, \
           yrs_full_state_sha256, materialization_sha256, validated_at_unix_ms\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for fingerprint in fingerprints {
        insert.execute(params![
            fingerprint.document_id,
            fingerprint.generation,
            fingerprint.head_seq,
            fingerprint.source_state_hash,
            fingerprint.yrs_state_vector_sha256,
            fingerprint.yrs_full_state_sha256,
            fingerprint.materialization_sha256,
            now
        ])?;
    }
    drop(insert);
    transaction.pragma_update(None, "user_version", CORE_SCHEMA_VERSION)?;
    Ok(())
}

fn validate_v85_metadata(connection: &Connection) -> Result<(), StoreError> {
    let metadata = connection
        .query_row(
            "SELECT schema_owner, store_format_version FROM core_store_metadata WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    if metadata == Some((CORE_SCHEMA_OWNER.to_owned(), CORE_SCHEMA_VERSION)) {
        return Ok(());
    }
    Err(corrupt(
        "v85 store does not contain the Rust Core ownership marker",
    ))
}

fn validate_exact_v85_schema(connection: &Connection) -> Result<(), StoreError> {
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(v84_schema_objects_sql())?;
    expected.execute_batch(V85_SCHEMA_SQL)?;
    expected.execute_batch(V85_EXECUTION_SCHEMA_SQL)?;
    ensure_automation_definition_revision(&expected)?;
    ensure_automation_run_revision(&expected)?;

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
        "v85 physical schema does not match the frozen Rust Core schema ({missing} missing, {unexpected} unexpected, {changed} changed objects)"
    )))
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
        materialize_decoded_document,
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

    fn open_error(home: &Path) -> StoreError {
        match SqliteStoreKernel::open(home) {
            Ok(_) => panic!("store open unexpectedly succeeded"),
            Err(error) => error,
        }
    }

    #[test]
    fn fresh_profiles_publish_v85_and_hold_the_store_lock() {
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

        let second = open_error(&home);
        assert_eq!(second.code, StoreErrorCode::AlreadyOwned);
        drop(kernel);
        let reopened = SqliteStoreKernel::open(&home).expect("reopen v85");
        assert!(!reopened.preparation().created_fresh);
    }

    #[test]
    fn typescript_v84_migration_backs_up_validates_and_publishes_fingerprints_once() {
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
                                fingerprint.head_seq, fingerprint.source_state_hash \
                         FROM core_store_metadata metadata \
                         JOIN document_engine_fingerprints fingerprint ON fingerprint.document_id = ?1 \
                         WHERE metadata.id = 1",
                        [DOCUMENT_ID],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, String>(3)?,
                            ))
                        },
                    )
                    .map_err(StoreError::from)
            })
            .expect("migration evidence");
        assert_eq!(evidence.0, CORE_SCHEMA_OWNER);
        assert_eq!(evidence.1, CORE_SCHEMA_VERSION);
        assert_eq!(evidence.2, 1);
        assert!(is_sha256(&evidence.3));
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
        assert_eq!(reopened.preparation().validated_yjs_documents, 1);
        let backups = fs::read_dir(home.join("backups/core-migrations"))
            .expect("backup directory")
            .count();
        assert_eq!(backups, 1);
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
    fn v85_schema_drift_fails_closed_instead_of_repairing() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh v85 store");
        drop(kernel);

        let connection = Connection::open(home.join("nodex.db")).expect("v85 store");
        connection
            .execute("DROP TABLE core_reminder_leases", [])
            .expect("schema damage");
        drop(connection);

        let error = open_error(&home);
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        let connection = Connection::open(home.join("nodex.db")).expect("damaged v85 store");
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
        for version in [83, 86] {
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
