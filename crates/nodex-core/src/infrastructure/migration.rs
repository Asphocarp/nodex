use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::{Mutex, OnceLock};
#[cfg(test)]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(test)]
use rusqlite::backup::Backup;
use rusqlite::{Connection, MAIN_DB, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::document::integrity::validate_restore_documents;

use super::migration_progress::report_bounded_progress;
#[cfg(test)]
use super::schema::install_current_schema;
use super::schema::{
    CURRENT_STORE_REVISION, install_current_schema_in_transaction, validate_schema_identity,
};
use super::sqlite::{
    StoreError, StoreErrorCode, open_immutable_reader, validate_store, with_immediate_transaction,
};
use super::store_validation::{
    validate_core_metadata, validate_current_store, validate_store_semantics,
};
use super::store_validation_receipt::{self, StoreValidationReceipt};

const BASELINE_STORE_REVISION: i64 = 130;
const CORE_SCHEMA_OWNER: &str = "rust_core";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorePreparation {
    pub schema_version: i64,
    pub created_fresh: bool,
    pub migrated_from_version: Option<i64>,
    pub validation: StoreValidationDisposition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoreValidationDisposition {
    Deep,
    TrustedReceipt,
}

#[derive(Clone, Copy)]
pub(crate) enum CurrentStoreValidation<'a> {
    Deep,
    TrustedReceipt(&'a StoreValidationReceipt),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorePreparationEvent {
    MigrationStarted { from_version: i64, to_version: i64 },
    MigrationProgress { completed: u64, total: u64 },
}

#[derive(Clone, Copy)]
struct MigrationStep {
    from_revision: i64,
    to_revision: i64,
    apply: fn(&Connection, &MigrationContext) -> Result<(), StoreError>,
}

struct MigrationContext {
    source_revision: i64,
    target_revision: i64,
    backup_name: String,
    source_schema_fingerprint: &'static str,
    target_schema_fingerprint: &'static str,
    completed_at_unix_ms: i64,
}

const MIGRATION_STEPS: &[MigrationStep] = &[
    MigrationStep {
        from_revision: BASELINE_STORE_REVISION,
        to_revision: 131,
        apply: migrate_v130_to_v131,
    },
    MigrationStep {
        from_revision: 131,
        to_revision: 132,
        apply: migrate_v131_to_v132,
    },
    MigrationStep {
        from_revision: 132,
        to_revision: 133,
        apply: migrate_v132_to_v133,
    },
    MigrationStep {
        from_revision: 133,
        to_revision: 134,
        apply: migrate_v133_to_v134,
    },
];

fn resolve_migration_path(
    from_revision: i64,
    target_revision: i64,
    steps: &[MigrationStep],
) -> Option<Vec<MigrationStep>> {
    if from_revision >= target_revision {
        return None;
    }

    let mut cursor = from_revision;
    let mut path = Vec::new();
    while cursor < target_revision {
        let step = steps
            .iter()
            .copied()
            .find(|step| step.from_revision == cursor)?;
        if step.to_revision <= cursor || step.to_revision > target_revision {
            return None;
        }
        path.push(step);
        cursor = step.to_revision;
        if path.len() > steps.len() {
            return None;
        }
    }
    (cursor == target_revision).then_some(path)
}

pub fn prepare_profile_store(
    connection: &mut Connection,
    profile_home: &Path,
) -> Result<StorePreparation, StoreError> {
    prepare_profile_store_with_validation(
        connection,
        profile_home,
        &mut |_| {},
        CurrentStoreValidation::Deep,
    )
}

pub fn prepare_profile_store_with_observer(
    connection: &mut Connection,
    profile_home: &Path,
    observer: &mut dyn FnMut(StorePreparationEvent),
) -> Result<StorePreparation, StoreError> {
    prepare_profile_store_with_validation(
        connection,
        profile_home,
        observer,
        CurrentStoreValidation::Deep,
    )
}

pub(crate) fn prepare_profile_store_with_validation(
    connection: &mut Connection,
    profile_home: &Path,
    observer: &mut dyn FnMut(StorePreparationEvent),
    current_store_validation: CurrentStoreValidation<'_>,
) -> Result<StorePreparation, StoreError> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let object_count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if version == 0 && object_count == 0 {
        install_fresh_profile(connection, unix_time_millis()?)?;
        validate_current_store(connection)?;
        return Ok(StorePreparation {
            schema_version: CURRENT_STORE_REVISION,
            created_fresh: true,
            migrated_from_version: None,
            validation: StoreValidationDisposition::Deep,
        });
    }
    if version == CURRENT_STORE_REVISION {
        if let CurrentStoreValidation::TrustedReceipt(receipt) = current_store_validation {
            validate_schema_identity(connection, CURRENT_STORE_REVISION)?;
            validate_core_metadata(connection)?;
            if store_validation_receipt::matches(receipt, connection)? {
                return Ok(StorePreparation {
                    schema_version: CURRENT_STORE_REVISION,
                    created_fresh: false,
                    migrated_from_version: None,
                    validation: StoreValidationDisposition::TrustedReceipt,
                });
            }
        }
        validate_current_store(connection)?;
        return Ok(StorePreparation {
            schema_version: CURRENT_STORE_REVISION,
            created_fresh: false,
            migrated_from_version: None,
            validation: StoreValidationDisposition::Deep,
        });
    }
    let Some(steps) = resolve_migration_path(version, CURRENT_STORE_REVISION, MIGRATION_STEPS)
    else {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            format!(
                "Rust Core accepts the current v{CURRENT_STORE_REVISION} Store or migrates the v{BASELINE_STORE_REVISION} baseline; received v{version}"
            ),
            false,
        ));
    };

    migrate_store(connection, profile_home, observer, version, &steps)
}

#[cfg(test)]
fn migrate_baseline_store(
    connection: &mut Connection,
    profile_home: &Path,
    observer: &mut dyn FnMut(StorePreparationEvent),
    step: MigrationStep,
) -> Result<StorePreparation, StoreError> {
    migrate_store(
        connection,
        profile_home,
        observer,
        step.from_revision,
        &[step],
    )
}

fn migrate_store(
    connection: &mut Connection,
    profile_home: &Path,
    observer: &mut dyn FnMut(StorePreparationEvent),
    source_revision: i64,
    steps: &[MigrationStep],
) -> Result<StorePreparation, StoreError> {
    let target_revision = steps
        .last()
        .map(|step| step.to_revision)
        .ok_or_else(|| internal("Store migration path is empty"))?;
    validate_migration_source(connection, source_revision)?;
    for step in steps {
        observer(StorePreparationEvent::MigrationStarted {
            from_version: step.from_revision,
            to_version: step.to_revision,
        });
    }
    let backup_path =
        create_migration_backup(connection, profile_home, source_revision, target_revision)?;
    let backup_name = backup_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid_profile("Core migration backup name is not valid UTF-8"))?
        .to_owned();
    let completed_at_unix_ms = i64::try_from(unix_time_millis()?)
        .map_err(|_| internal("Migration time exceeds SQLite integer range"))?;

    with_schema_rebuild_transaction(connection, |transaction| {
        for step in steps {
            let source = published_format(step.from_revision)?;
            let target = published_format(step.to_revision)?;
            let context = MigrationContext {
                source_revision: step.from_revision,
                target_revision: step.to_revision,
                backup_name: backup_name.clone(),
                source_schema_fingerprint: source.schema_fingerprint,
                target_schema_fingerprint: target.schema_fingerprint,
                completed_at_unix_ms,
            };
            (step.apply)(transaction, &context)?;
            validate_schema_identity(transaction, step.to_revision)?;
        }
        validate_current_store(transaction)
    })?;
    let mut reported_step = 0;
    for completed in 1..=steps.len() {
        report_bounded_progress(
            &mut |completed, total| {
                observer(StorePreparationEvent::MigrationProgress { completed, total });
            },
            u64::try_from(completed).map_err(|_| internal("Migration path is too large"))?,
            u64::try_from(steps.len()).map_err(|_| internal("Migration path is too large"))?,
            &mut reported_step,
        );
    }
    Ok(StorePreparation {
        schema_version: target_revision,
        created_fresh: false,
        migrated_from_version: Some(source_revision),
        validation: StoreValidationDisposition::Deep,
    })
}

fn validate_migration_source(
    connection: &Connection,
    source_revision: i64,
) -> Result<(), StoreError> {
    validate_store(connection)?;
    validate_schema_identity(connection, source_revision)?;
    let metadata = connection.query_row(
        "SELECT schema_owner, projection_event_v2_floor, \
                (SELECT COALESCE(MAX(seq), 0) FROM change_log) \
         FROM core_store_metadata WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    if metadata.0 != CORE_SCHEMA_OWNER
        || !metadata
            .1
            .is_some_and(|floor| (1..=metadata.2 + 1).contains(&floor))
    {
        return Err(corrupt(format!(
            "v{source_revision} Store has invalid Core metadata"
        )));
    }
    validate_store_semantics(connection)?;
    validate_restore_documents(connection)?;
    Ok(())
}

fn migrate_v130_to_v131(
    connection: &Connection,
    context: &MigrationContext,
) -> Result<(), StoreError> {
    connection.execute_batch(
        "ALTER TABLE core_store_metadata RENAME TO core_store_metadata_v130; \
         CREATE TABLE core_store_metadata ( \
           id INTEGER PRIMARY KEY CHECK (id = 1), \
           schema_owner TEXT NOT NULL CHECK (schema_owner = 'rust_core'), \
           projection_event_v2_floor INTEGER NOT NULL \
             CHECK (projection_event_v2_floor >= 1) \
         ) STRICT; \
         INSERT INTO core_store_metadata(id, schema_owner, projection_event_v2_floor) \
         SELECT id, schema_owner, projection_event_v2_floor \
         FROM core_store_metadata_v130; \
         DROP TABLE core_store_metadata_v130; \
         DROP TABLE core_legacy_imports; \
         CREATE TABLE core_store_migration_history ( \
           source_revision INTEGER NOT NULL CHECK (source_revision >= 1), \
           target_revision INTEGER NOT NULL CHECK (target_revision > source_revision), \
           source_schema_fingerprint TEXT NOT NULL \
             CHECK ( \
               length(source_schema_fingerprint) = 64 \
               AND source_schema_fingerprint NOT GLOB '*[^0-9a-f]*' \
             ), \
           target_schema_fingerprint TEXT NOT NULL \
             CHECK ( \
               length(target_schema_fingerprint) = 64 \
               AND target_schema_fingerprint NOT GLOB '*[^0-9a-f]*' \
             ), \
           backup_name TEXT NOT NULL \
             CHECK ( \
               length(backup_name) BETWEEN 1 AND 512 \
               AND instr(backup_name, '/') = 0 \
               AND instr(backup_name, '\\') = 0 \
             ), \
           completed_at_unix_ms INTEGER NOT NULL CHECK (completed_at_unix_ms >= 0), \
           PRIMARY KEY (source_revision, target_revision) \
         ) WITHOUT ROWID, STRICT;",
    )?;
    connection.execute(
        "INSERT INTO core_store_migration_history( \
           source_revision, target_revision, source_schema_fingerprint, \
           target_schema_fingerprint, backup_name, completed_at_unix_ms \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            context.source_revision,
            context.target_revision,
            context.source_schema_fingerprint,
            context.target_schema_fingerprint,
            context.backup_name,
            context.completed_at_unix_ms,
        ],
    )?;
    connection.pragma_update(None, "user_version", context.target_revision)?;
    Ok(())
}

fn migrate_v131_to_v132(
    connection: &Connection,
    context: &MigrationContext,
) -> Result<(), StoreError> {
    connection.execute_batch(
        "CREATE TABLE structural_clipboard_bundles ( \
           bundle_id TEXT PRIMARY KEY, \
           capture_operation_id TEXT NOT NULL UNIQUE \
             REFERENCES block_mutations(mutation_id) ON DELETE CASCADE, \
           library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, \
           store_epoch TEXT NOT NULL, \
           capability_hash TEXT NOT NULL, \
           manifest_hash TEXT NOT NULL, \
           snapshot_json TEXT NOT NULL, \
           created_at TEXT NOT NULL, \
           CHECK (length(bundle_id) BETWEEN 1 AND 512), \
           CHECK (length(store_epoch) BETWEEN 1 AND 512), \
           CHECK (length(capability_hash) = 64 AND capability_hash NOT GLOB '*[^0-9a-f]*'), \
           CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'), \
           CHECK (length(snapshot_json) BETWEEN 2 AND 67108864 \
             AND json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'), \
           CHECK (length(created_at) > 0) \
         ) WITHOUT ROWID, STRICT; \
         CREATE TABLE structural_clipboard_leases ( \
           bundle_id TEXT PRIMARY KEY \
             REFERENCES structural_clipboard_bundles(bundle_id) ON DELETE CASCADE, \
           revision INTEGER NOT NULL CHECK (revision >= 1), \
           state TEXT NOT NULL CHECK (state IN ('active', 'released')), \
           released_at TEXT, \
           updated_at TEXT NOT NULL, \
           CHECK ((state = 'active' AND released_at IS NULL) \
             OR (state = 'released' AND length(released_at) > 0)), \
           CHECK (length(updated_at) > 0) \
         ) WITHOUT ROWID, STRICT; \
         CREATE TABLE structural_cut_claims ( \
           bundle_id TEXT PRIMARY KEY \
             REFERENCES structural_clipboard_bundles(bundle_id) ON DELETE CASCADE, \
           source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE RESTRICT, \
           source_root_ids_json TEXT NOT NULL, \
           delete_recipe_operation_id TEXT NOT NULL UNIQUE \
             REFERENCES structural_history_recipes(recipe_operation_id) ON DELETE RESTRICT, \
           revision INTEGER NOT NULL CHECK (revision >= 1), \
           state TEXT NOT NULL CHECK (state IN ('available', 'consumed', 'revoked')), \
           consumed_by_operation_id TEXT \
             REFERENCES block_mutations(mutation_id) ON DELETE RESTRICT, \
           created_at TEXT NOT NULL, \
           updated_at TEXT NOT NULL, \
           CHECK (json_valid(source_root_ids_json) \
             AND json_type(source_root_ids_json) = 'array' \
             AND json_array_length(source_root_ids_json) BETWEEN 1 AND 10000), \
           CHECK ((state = 'consumed' AND consumed_by_operation_id IS NOT NULL) \
             OR (state <> 'consumed' AND consumed_by_operation_id IS NULL)), \
           CHECK (length(created_at) > 0), \
           CHECK (length(updated_at) > 0) \
         ) WITHOUT ROWID, STRICT; \
         CREATE TABLE structural_history_recipes ( \
           recipe_operation_id TEXT PRIMARY KEY \
             REFERENCES block_mutations(mutation_id) ON DELETE CASCADE, \
           library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, \
           project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, \
           store_epoch TEXT NOT NULL, \
           recipe_hash TEXT NOT NULL, \
           recipe_json TEXT NOT NULL, \
           state TEXT NOT NULL CHECK (state IN ('available', 'consumed', 'superseded')), \
           consumed_at TEXT, \
           superseded_by_recipe_operation_id TEXT \
             REFERENCES structural_history_recipes(recipe_operation_id) ON DELETE RESTRICT, \
           created_at TEXT NOT NULL, \
           CHECK (length(recipe_operation_id) BETWEEN 1 AND 512), \
           CHECK (length(store_epoch) BETWEEN 1 AND 512), \
           CHECK (length(recipe_hash) = 64 AND recipe_hash NOT GLOB '*[^0-9a-f]*'), \
           CHECK (length(recipe_json) BETWEEN 2 AND 67108864 \
             AND json_valid(recipe_json) AND json_type(recipe_json) = 'object'), \
           CHECK ((state = 'available' AND consumed_at IS NULL \
                    AND superseded_by_recipe_operation_id IS NULL) \
             OR (state = 'consumed' AND length(consumed_at) > 0 \
                    AND superseded_by_recipe_operation_id IS NULL) \
             OR (state = 'superseded' AND length(consumed_at) > 0 \
                    AND superseded_by_recipe_operation_id IS NOT NULL)), \
           CHECK (length(created_at) > 0) \
         ) WITHOUT ROWID, STRICT; \
         CREATE TABLE structural_retention_members ( \
           authority_kind TEXT NOT NULL \
             CHECK (authority_kind IN ('clipboard_bundle', 'history_recipe')), \
           authority_id TEXT NOT NULL, \
           library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, \
           member_kind TEXT NOT NULL \
             CHECK (member_kind IN ('block', 'document', 'database', 'asset')), \
           member_id TEXT NOT NULL, \
           PRIMARY KEY (authority_kind, authority_id, member_kind, member_id), \
           CHECK (length(authority_id) BETWEEN 1 AND 512), \
           CHECK (length(member_id) BETWEEN 1 AND 1024) \
         ) WITHOUT ROWID, STRICT; \
         CREATE INDEX idx_structural_retention_members_identity \
           ON structural_retention_members(library_id, member_kind, member_id); \
         CREATE INDEX idx_structural_history_recipes_state \
           ON structural_history_recipes(library_id, state, created_at); \
         CREATE TRIGGER structural_clipboard_bundles_are_immutable \
         BEFORE UPDATE ON structural_clipboard_bundles \
         BEGIN \
           SELECT RAISE(ABORT, 'Structural clipboard bundles are immutable'); \
         END; \
         CREATE TRIGGER structural_clipboard_leases_transition_once \
         BEFORE UPDATE ON structural_clipboard_leases \
         WHEN NOT (OLD.state = 'active' AND NEW.state = 'released' \
           AND NEW.revision = OLD.revision + 1 AND NEW.released_at IS NOT NULL \
           AND OLD.bundle_id = NEW.bundle_id) \
         BEGIN \
           SELECT RAISE(ABORT, 'Structural clipboard lease transition is invalid'); \
         END; \
         CREATE TRIGGER structural_cut_claims_transition_once \
         BEFORE UPDATE ON structural_cut_claims \
         WHEN NOT (OLD.state = 'available' AND NEW.state IN ('consumed', 'revoked') \
           AND NEW.revision = OLD.revision + 1 AND OLD.bundle_id = NEW.bundle_id \
           AND OLD.source_document_id = NEW.source_document_id \
           AND OLD.source_root_ids_json = NEW.source_root_ids_json \
           AND OLD.delete_recipe_operation_id = NEW.delete_recipe_operation_id \
           AND OLD.created_at = NEW.created_at) \
         BEGIN \
           SELECT RAISE(ABORT, 'Structural cut claim transition is invalid'); \
         END; \
         CREATE TRIGGER structural_history_recipes_transition_once \
         BEFORE UPDATE ON structural_history_recipes \
         WHEN NOT (OLD.state = 'available' AND NEW.state IN ('consumed', 'superseded') \
           AND NEW.consumed_at IS NOT NULL \
           AND OLD.recipe_operation_id = NEW.recipe_operation_id \
           AND OLD.library_id = NEW.library_id AND OLD.project_id = NEW.project_id \
           AND OLD.store_epoch = NEW.store_epoch \
           AND OLD.recipe_hash = NEW.recipe_hash AND OLD.recipe_json = NEW.recipe_json \
           AND OLD.created_at = NEW.created_at) \
         BEGIN \
           SELECT RAISE(ABORT, 'Structural history recipe transition is invalid'); \
         END; \
         CREATE TRIGGER structural_retention_members_are_immutable \
         BEFORE UPDATE ON structural_retention_members \
         BEGIN \
           SELECT RAISE(ABORT, 'Structural retention members are immutable'); \
         END;",
    )?;
    connection.execute(
        "INSERT INTO core_store_migration_history( \
           source_revision, target_revision, source_schema_fingerprint, \
           target_schema_fingerprint, backup_name, completed_at_unix_ms \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            context.source_revision,
            context.target_revision,
            context.source_schema_fingerprint,
            context.target_schema_fingerprint,
            context.backup_name,
            context.completed_at_unix_ms,
        ],
    )?;
    connection.pragma_update(None, "user_version", context.target_revision)?;
    Ok(())
}

fn migrate_v132_to_v133(
    connection: &Connection,
    context: &MigrationContext,
) -> Result<(), StoreError> {
    connection.execute_batch(
        "CREATE TABLE project_session_pages ( \
           session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE, \
           page_id TEXT NOT NULL REFERENCES pages(block_id) ON DELETE CASCADE, \
           linked_at TEXT NOT NULL, \
           PRIMARY KEY (session_id, page_id), \
           CHECK (length(session_id) BETWEEN 1 AND 512), \
           CHECK (length(page_id) BETWEEN 1 AND 512), \
           CHECK (length(linked_at) > 0) \
         ) WITHOUT ROWID, STRICT; \
         CREATE INDEX idx_project_session_pages_page \
           ON project_session_pages(page_id, session_id);",
    )?;
    connection.execute(
        "INSERT INTO core_store_migration_history( \
           source_revision, target_revision, source_schema_fingerprint, \
           target_schema_fingerprint, backup_name, completed_at_unix_ms \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            context.source_revision,
            context.target_revision,
            context.source_schema_fingerprint,
            context.target_schema_fingerprint,
            context.backup_name,
            context.completed_at_unix_ms,
        ],
    )?;
    connection.pragma_update(None, "user_version", context.target_revision)?;
    Ok(())
}

fn migrate_v133_to_v134(
    connection: &Connection,
    context: &MigrationContext,
) -> Result<(), StoreError> {
    connection.execute_batch(
        "CREATE TABLE codex_queued_follow_up_ledgers ( \
           thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE, \
           revision INTEGER NOT NULL CHECK (revision >= 0), \
           ledger_hash TEXT NOT NULL CHECK (length(ledger_hash) = 64), \
           updated_at TEXT NOT NULL CHECK (length(updated_at) > 0) \
         ) WITHOUT ROWID, STRICT; \
         CREATE TABLE codex_queued_follow_up_payload_manifests ( \
           payload_sha256 TEXT PRIMARY KEY CHECK (length(payload_sha256) = 64), \
           schema_version INTEGER NOT NULL CHECK (schema_version = 1), \
           asset_uri TEXT NOT NULL UNIQUE CHECK ( \
             asset_uri LIKE 'nodex://assets/queued-follow-up-v1-%.json' \
           ), \
           byte_length INTEGER NOT NULL CHECK (byte_length >= 2) \
         ) WITHOUT ROWID, STRICT; \
         CREATE TABLE codex_queued_follow_up_payload_asset_refs ( \
           payload_sha256 TEXT NOT NULL REFERENCES codex_queued_follow_up_payload_manifests(payload_sha256) ON DELETE CASCADE, \
           ordinal INTEGER NOT NULL CHECK (ordinal >= 0), \
           asset_uri TEXT NOT NULL CHECK (asset_uri LIKE 'nodex://assets/%'), \
           sha256 TEXT NOT NULL CHECK (length(sha256) = 64), \
           byte_length INTEGER NOT NULL CHECK (byte_length >= 0), \
           PRIMARY KEY (payload_sha256, ordinal), \
           UNIQUE (payload_sha256, asset_uri) \
         ) WITHOUT ROWID, STRICT; \
         CREATE TABLE codex_queued_follow_up_entries ( \
           thread_id TEXT NOT NULL REFERENCES codex_queued_follow_up_ledgers(thread_id) ON DELETE CASCADE, \
           follow_up_id TEXT NOT NULL, \
           position INTEGER NOT NULL CHECK (position >= 0), \
           client_user_message_id TEXT NOT NULL, \
           created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0), \
           pause_kind TEXT CHECK (pause_kind IN ('interrupted', 'failed')), \
           pause_reason TEXT, \
           payload_sha256 TEXT NOT NULL REFERENCES codex_queued_follow_up_payload_manifests(payload_sha256), \
           PRIMARY KEY (thread_id, follow_up_id), \
           UNIQUE (thread_id, position), \
           UNIQUE (thread_id, client_user_message_id), \
           CHECK (length(trim(follow_up_id)) BETWEEN 1 AND 512), \
           CHECK (length(trim(client_user_message_id)) BETWEEN 1 AND 512), \
           CHECK ( \
             (pause_kind IS NULL AND pause_reason IS NULL) \
             OR (pause_kind IS NOT NULL AND length(trim(pause_reason)) BETWEEN 1 AND 4096) \
           ) \
         ) WITHOUT ROWID, STRICT; \
         CREATE INDEX idx_codex_queued_follow_up_entries_payload \
           ON codex_queued_follow_up_entries(payload_sha256); \
         CREATE TABLE codex_queued_follow_up_manifest_gc ( \
           asset_uri TEXT PRIMARY KEY CHECK ( \
             asset_uri LIKE 'nodex://assets/queued-follow-up-v1-%.json' \
           ), \
           sha256 TEXT NOT NULL CHECK (length(sha256) = 64), \
           enqueued_at TEXT NOT NULL CHECK (length(enqueued_at) > 0), \
           attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), \
           last_attempt_at TEXT CHECK (last_attempt_at IS NULL OR length(last_attempt_at) > 0), \
           last_error TEXT CHECK (last_error IS NULL OR length(last_error) BETWEEN 1 AND 4096) \
         ) WITHOUT ROWID, STRICT;",
    )?;
    connection.execute(
        "INSERT INTO core_store_migration_history( \
           source_revision, target_revision, source_schema_fingerprint, \
           target_schema_fingerprint, backup_name, completed_at_unix_ms \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            context.source_revision,
            context.target_revision,
            context.source_schema_fingerprint,
            context.target_schema_fingerprint,
            context.backup_name,
            context.completed_at_unix_ms,
        ],
    )?;
    connection.pragma_update(None, "user_version", context.target_revision)?;
    Ok(())
}

fn install_fresh_profile(connection: &mut Connection, now: u64) -> Result<(), StoreError> {
    install_fresh_profile_with(connection, |transaction| {
        initialize_fresh_profile(transaction, now)
    })
}

fn install_fresh_profile_with<T>(
    connection: &mut Connection,
    initialize: impl FnOnce(&Connection) -> Result<T, StoreError>,
) -> Result<T, StoreError> {
    with_immediate_transaction(connection, |transaction| {
        install_current_schema_in_transaction(transaction)?;
        initialize(transaction)
    })
}

fn initialize_fresh_profile(connection: &Connection, now: u64) -> Result<(), StoreError> {
    let now = i64::try_from(now)
        .map_err(|_| internal("Profile initialization time exceeds SQLite integer range"))?;
    connection.execute(
        "INSERT INTO core_store_metadata( \
               id, schema_owner, projection_event_v2_floor \
             ) VALUES (1, ?1, 1)",
        [CORE_SCHEMA_OWNER],
    )?;
    connection.execute(
        "INSERT INTO nodex_agent_token_keys(id, key_material) VALUES (1, randomblob(32))",
        [],
    )?;
    connection.execute(
        "INSERT INTO core_automation_runtime_metadata( \
               id, jitter_salt, created_at_unix_ms \
             ) VALUES (1, lower(hex(randomblob(16))), ?1)",
        [now],
    )?;
    Ok(())
}

fn create_migration_backup(
    connection: &Connection,
    profile_home: &Path,
    source_revision: i64,
    target_revision: i64,
) -> Result<PathBuf, StoreError> {
    let directory = prepare_migration_backup_directory(profile_home)?;
    let pending_path = directory.join(format!(
        ".v{source_revision}-to-v{target_revision}.pending.db"
    ));
    if let Ok(metadata) = fs::symlink_metadata(&pending_path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(invalid_profile(
                "Core migration pending backup must be a regular file",
            ));
        }
        fs::remove_file(&pending_path).map_err(io_error)?;
    }
    connection.backup(MAIN_DB, &pending_path, None)?;
    File::open(&pending_path)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;
    validate_migration_backup(&pending_path, source_revision)?;
    let digest = file_sha256(&pending_path)?;
    let backup_path = directory.join(format!(
        "v{source_revision}-to-v{target_revision}-{digest}.db"
    ));
    if let Ok(metadata) = fs::symlink_metadata(&backup_path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(invalid_profile(
                "Core migration backup must be a regular file",
            ));
        }
        validate_migration_backup(&backup_path, source_revision)?;
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
                return Err(invalid_profile(
                    "Core migration backup ancestry must contain only real directories",
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

fn validate_migration_backup(path: &Path, source_revision: i64) -> Result<(), StoreError> {
    let backup = open_immutable_reader(path)?;
    let version: i64 = backup.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version != source_revision {
        return Err(corrupt(format!(
            "Migration backup has unexpected schema v{version}"
        )));
    }
    validate_store(&backup)?;
    validate_schema_identity(&backup, source_revision)
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

fn with_schema_rebuild_transaction<T>(
    connection: &mut Connection,
    operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
) -> Result<T, StoreError> {
    let foreign_keys_enabled: bool =
        connection.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, bool>(0))?;
    if foreign_keys_enabled {
        connection.pragma_update(None, "foreign_keys", false)?;
    }
    let result = with_immediate_transaction(connection, |transaction| operation(transaction));
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

pub fn expected_store_schema_fingerprint(revision: i64) -> Result<String, StoreError> {
    published_format(revision).map(|format| format.schema_fingerprint.to_owned())
}

fn published_format(revision: i64) -> Result<nodex_store_format::PublishedStoreFormat, StoreError> {
    let revision = u32::try_from(revision).map_err(|_| unsupported_revision(revision))?;
    nodex_store_format::published_store_format(revision)
        .ok_or_else(|| unsupported_revision(i64::from(revision)))
}

fn unsupported_revision(revision: i64) -> StoreError {
    StoreError::new(
        StoreErrorCode::UnsupportedSchema,
        format!("No published Store identity exists for v{revision}"),
        false,
    )
}

fn unix_time_millis() -> Result<u64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| internal(format!("System clock is before the Unix epoch: {error}")))?;
    u64::try_from(duration.as_millis())
        .map_err(|_| internal("System time exceeds the migration timestamp range"))
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn invalid_profile(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidProfile, message, false)
}

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

fn io_error(error: std::io::Error) -> StoreError {
    internal(format!(
        "Store migration filesystem operation failed: {error}"
    ))
}

#[cfg(test)]
static TEST_CURRENT_STORE_TEMPLATE: OnceLock<Mutex<Connection>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn prepare_test_current_store(
    connection: &mut Connection,
    _profile_home: &Path,
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
    with_immediate_transaction(connection, |transaction| {
        initialize_fresh_profile(transaction, unix_time_millis()?)
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
    install_current_schema(&mut connection)?;
    let _ = TEST_CURRENT_STORE_TEMPLATE.set(Mutex::new(connection));
    TEST_CURRENT_STORE_TEMPLATE
        .get()
        .ok_or_else(|| corrupt("Test Store template was not initialized"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    use rusqlite::OptionalExtension;
    use tempfile::tempdir;

    use super::super::sqlite::open_writer;
    use super::*;

    fn no_op_migration(
        _connection: &Connection,
        _context: &MigrationContext,
    ) -> Result<(), StoreError> {
        Ok(())
    }

    #[test]
    fn migration_path_orders_every_revision_until_current() {
        let steps = [
            MigrationStep {
                from_revision: 130,
                to_revision: 131,
                apply: no_op_migration,
            },
            MigrationStep {
                from_revision: 131,
                to_revision: 132,
                apply: no_op_migration,
            },
        ];

        let path = resolve_migration_path(130, 132, &steps).expect("contiguous migration path");

        assert_eq!(
            path.iter()
                .map(|step| (step.from_revision, step.to_revision))
                .collect::<Vec<_>>(),
            vec![(130, 131), (131, 132)]
        );
        assert!(resolve_migration_path(129, 132, &steps).is_none());
        assert!(resolve_migration_path(131, 133, &steps).is_none());
    }

    #[test]
    fn migration_schema_converges_exactly_with_fresh_schema() {
        let directory = tempdir().expect("Profile");
        install_baseline_fixture(directory.path());
        let mut migrated = open_writer(&directory.path().join("nodex.db")).expect("writer");
        with_schema_rebuild_transaction(&mut migrated, |transaction| {
            for step in MIGRATION_STEPS {
                let source = published_format(step.from_revision)?;
                let target = published_format(step.to_revision)?;
                (step.apply)(
                    transaction,
                    &MigrationContext {
                        source_revision: step.from_revision,
                        target_revision: step.to_revision,
                        backup_name: "schema-convergence.db".to_owned(),
                        source_schema_fingerprint: source.schema_fingerprint,
                        target_schema_fingerprint: target.schema_fingerprint,
                        completed_at_unix_ms: 1,
                    },
                )?;
            }
            Ok(())
        })
        .expect("apply migration DDL");

        let mut fresh = Connection::open_in_memory().expect("fresh Store");
        install_current_schema(&mut fresh).expect("install current schema");
        let migrated_inventory =
            super::super::schema::read_schema_inventory(&migrated).expect("migrated inventory");
        let fresh_inventory =
            super::super::schema::read_schema_inventory(&fresh).expect("fresh inventory");
        let differences = fresh_inventory
            .iter()
            .filter_map(|(key, fresh_sql)| {
                let migrated_sql = migrated_inventory.get(key);
                (migrated_sql != Some(fresh_sql)).then(|| {
                    format!(
                        "{} {}\nfresh: {}\nmigrated: {}",
                        key.object_type,
                        key.name,
                        fresh_sql,
                        migrated_sql.map_or("<missing>", String::as_str)
                    )
                })
            })
            .collect::<Vec<_>>();
        assert!(
            differences.is_empty() && migrated_inventory.len() == fresh_inventory.len(),
            "{}",
            differences.join("\n\n")
        );
    }

    fn install_baseline_fixture(home: &Path) {
        fs::write(
            home.join("nodex.db"),
            include_bytes!("../../tests/fixtures/store-v130.db"),
        )
        .expect("frozen v130 Store");
    }

    fn install_v131_fixture(home: &Path) {
        install_baseline_fixture(home);
        let mut connection = open_writer(&home.join("nodex.db")).expect("v130 writer");
        with_schema_rebuild_transaction(&mut connection, |transaction| {
            migrate_v130_to_v131(
                transaction,
                &MigrationContext {
                    source_revision: 130,
                    target_revision: 131,
                    backup_name: "published-v131-fixture.db".to_owned(),
                    source_schema_fingerprint: published_format(130)
                        .expect("v130 format")
                        .schema_fingerprint,
                    target_schema_fingerprint: published_format(131)
                        .expect("v131 format")
                        .schema_fingerprint,
                    completed_at_unix_ms: 1,
                },
            )?;
            validate_schema_identity(transaction, 131)
        })
        .expect("published v131 fixture");
    }

    fn install_v132_fixture(home: &Path) {
        fs::write(
            home.join("nodex.db"),
            include_bytes!("../../tests/fixtures/store-v132.db"),
        )
        .expect("frozen v132 Store");
    }

    fn install_v133_fixture(home: &Path) {
        fs::write(
            home.join("nodex.db"),
            include_bytes!("../../tests/fixtures/store-v133.db"),
        )
        .expect("frozen v133 Store");
    }

    fn profile_secrets(connection: &Connection) -> (Vec<u8>, String) {
        let token = connection
            .query_row(
                "SELECT key_material FROM nodex_agent_token_keys WHERE id = 1",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .expect("Agent token key");
        let jitter = connection
            .query_row(
                "SELECT jitter_salt FROM core_automation_runtime_metadata WHERE id = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .expect("automation jitter salt");
        (token, jitter)
    }

    #[test]
    fn fresh_store_installs_current_schema_without_history() {
        let directory = tempdir().expect("Profile");
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        let preparation = prepare_profile_store(&mut connection, directory.path()).expect("fresh");
        assert_eq!(
            preparation,
            StorePreparation {
                schema_version: CURRENT_STORE_REVISION,
                created_fresh: true,
                migrated_from_version: None,
                validation: StoreValidationDisposition::Deep,
            }
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM core_store_migration_history",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .expect("history"),
            0
        );
        let first_secrets = profile_secrets(&connection);
        assert_eq!(first_secrets.0.len(), 32);
        assert!(!first_secrets.1.is_empty());

        let second_directory = tempdir().expect("second Profile");
        let mut second = open_writer(&second_directory.path().join("nodex.db")).expect("writer");
        prepare_profile_store(&mut second, second_directory.path()).expect("second fresh Store");
        let second_secrets = profile_secrets(&second);
        assert_ne!(first_secrets.0, second_secrets.0);
        assert_ne!(first_secrets.1, second_secrets.1);
        validate_current_store(&connection).expect("current Store");
    }

    #[test]
    fn fresh_store_creation_rolls_back_schema_when_profile_initialization_fails() {
        let directory = tempdir().expect("Profile");
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        let error = install_fresh_profile_with(&mut connection, |transaction| {
            initialize_fresh_profile(transaction, 1)?;
            Err::<(), _>(corrupt("injected Profile initialization failure"))
        })
        .expect_err("fresh creation failure");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("version"),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("schema objects"),
            0
        );

        prepare_profile_store(&mut connection, directory.path())
            .expect("fresh creation remains retryable");
        validate_current_store(&connection).expect("retried current Store");
    }

    #[test]
    fn baseline_store_migrates_once_and_converges_with_fresh_schema() {
        let directory = tempdir().expect("Profile");
        install_baseline_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        let baseline_secrets = profile_secrets(&connection);
        let mut events = Vec::new();
        let preparation =
            prepare_profile_store_with_observer(&mut connection, directory.path(), &mut |event| {
                events.push(event)
            })
            .expect("migrate baseline");
        assert_eq!(preparation.migrated_from_version, Some(130));
        assert_eq!(
            events,
            vec![
                StorePreparationEvent::MigrationStarted {
                    from_version: 130,
                    to_version: 131,
                },
                StorePreparationEvent::MigrationStarted {
                    from_version: 131,
                    to_version: 132,
                },
                StorePreparationEvent::MigrationStarted {
                    from_version: 132,
                    to_version: 133,
                },
                StorePreparationEvent::MigrationStarted {
                    from_version: 133,
                    to_version: 134,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 1,
                    total: 4,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 2,
                    total: 4,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 3,
                    total: 4,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 4,
                    total: 4,
                },
            ]
        );
        let history = connection
            .prepare(
                "SELECT source_revision, target_revision, source_schema_fingerprint, \
                        target_schema_fingerprint, backup_name, completed_at_unix_ms \
                 FROM core_store_migration_history ORDER BY source_revision",
            )
            .expect("history query")
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .expect("migration history")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("migration history rows");
        assert_eq!(history.len(), 4);
        assert_eq!((history[0].0, history[0].1), (130, 131));
        assert_eq!((history[1].0, history[1].1), (131, 132));
        assert_eq!((history[2].0, history[2].1), (132, 133));
        assert_eq!((history[3].0, history[3].1), (133, 134));
        assert_eq!(
            history[0].2,
            published_format(130)
                .expect("v130 format")
                .schema_fingerprint
        );
        assert_eq!(
            history[0].3,
            published_format(131)
                .expect("v131 format")
                .schema_fingerprint
        );
        assert_eq!(
            history[1].2,
            published_format(131)
                .expect("v131 format")
                .schema_fingerprint
        );
        assert_eq!(
            history[1].3,
            published_format(132)
                .expect("v132 format")
                .schema_fingerprint
        );
        assert_eq!(
            history[2].2,
            published_format(132)
                .expect("v132 format")
                .schema_fingerprint
        );
        assert_eq!(
            history[2].3,
            published_format(133)
                .expect("v133 format")
                .schema_fingerprint
        );
        assert_eq!(
            history[3].2,
            published_format(133)
                .expect("v133 format")
                .schema_fingerprint
        );
        assert_eq!(
            history[3].3,
            published_format(134)
                .expect("v134 format")
                .schema_fingerprint
        );
        assert!(history.iter().all(|row| row.4 == history[0].4));
        assert!(history[0].4.starts_with("v130-to-v134-"));
        assert!(history[0].4.ends_with(".db"));
        assert!(history.iter().all(|row| row.5 > 0));
        let backup_path = directory
            .path()
            .join("backups/core-migrations")
            .join(&history[0].4);
        let backup_metadata = fs::symlink_metadata(&backup_path).expect("migration backup");
        assert!(backup_metadata.is_file());
        assert!(!backup_metadata.file_type().is_symlink());
        assert_eq!(profile_secrets(&connection), baseline_secrets);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("version"),
            CURRENT_STORE_REVISION
        );
        validate_schema_identity(&connection, CURRENT_STORE_REVISION).expect("converged schema");
        drop(connection);

        let mut reopened = open_writer(&directory.path().join("nodex.db")).expect("reopen");
        let reopened_preparation =
            prepare_profile_store(&mut reopened, directory.path()).expect("current reopen");
        assert_eq!(reopened_preparation.migrated_from_version, None);
        assert_eq!(
            reopened
                .query_row(
                    "SELECT count(*) FROM core_store_migration_history",
                    [],
                    |row| { row.get::<_, i64>(0) }
                )
                .expect("stable history"),
            4
        );
        assert_eq!(
            fs::read_dir(directory.path().join("backups/core-migrations"))
                .expect("backups")
                .count(),
            1
        );
    }

    #[test]
    fn published_v131_store_migrates_directly_to_current() {
        let directory = tempdir().expect("Profile");
        install_v131_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        let mut events = Vec::new();

        let preparation =
            prepare_profile_store_with_observer(&mut connection, directory.path(), &mut |event| {
                events.push(event)
            })
            .expect("migrate v131");

        assert_eq!(preparation.migrated_from_version, Some(131));
        assert_eq!(preparation.schema_version, 134);
        assert_eq!(
            events,
            vec![
                StorePreparationEvent::MigrationStarted {
                    from_version: 131,
                    to_version: 132,
                },
                StorePreparationEvent::MigrationStarted {
                    from_version: 132,
                    to_version: 133,
                },
                StorePreparationEvent::MigrationStarted {
                    from_version: 133,
                    to_version: 134,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 1,
                    total: 3,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 2,
                    total: 3,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 3,
                    total: 3,
                },
            ]
        );
        validate_current_store(&connection).expect("current Store");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM core_store_migration_history",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("migration history"),
            4
        );
    }

    #[test]
    fn frozen_v132_store_migrates_directly_to_current_once() {
        let directory = tempdir().expect("Profile");
        install_v132_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        validate_schema_identity(&connection, 132).expect("exact frozen v132 Store");
        let mut events = Vec::new();

        let preparation =
            prepare_profile_store_with_observer(&mut connection, directory.path(), &mut |event| {
                events.push(event)
            })
            .expect("migrate v132");

        assert_eq!(preparation.migrated_from_version, Some(132));
        assert_eq!(preparation.schema_version, 134);
        assert_eq!(
            events,
            vec![
                StorePreparationEvent::MigrationStarted {
                    from_version: 132,
                    to_version: 133,
                },
                StorePreparationEvent::MigrationStarted {
                    from_version: 133,
                    to_version: 134,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 1,
                    total: 2,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 2,
                    total: 2,
                },
            ]
        );
        validate_current_store(&connection).expect("current Store");
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM core_store_migration_history",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .expect("migration history"),
            2
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM project_session_pages", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .expect("Page–Session relation table"),
            0
        );
        drop(connection);

        let mut reopened = open_writer(&directory.path().join("nodex.db")).expect("reopen");
        let reopened_preparation =
            prepare_profile_store(&mut reopened, directory.path()).expect("current reopen");
        assert_eq!(reopened_preparation.migrated_from_version, None);
        assert_eq!(
            fs::read_dir(directory.path().join("backups/core-migrations"))
                .expect("backups")
                .count(),
            1
        );
    }

    #[test]
    fn published_v133_store_migrates_to_queued_follow_up_schema_once() {
        let directory = tempdir().expect("Profile");
        install_v133_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        validate_schema_identity(&connection, 133).expect("exact published v133 Store");
        let mut events = Vec::new();

        let preparation =
            prepare_profile_store_with_observer(&mut connection, directory.path(), &mut |event| {
                events.push(event)
            })
            .expect("migrate v133");

        assert_eq!(preparation.migrated_from_version, Some(133));
        assert_eq!(preparation.schema_version, 134);
        assert_eq!(
            events,
            vec![
                StorePreparationEvent::MigrationStarted {
                    from_version: 133,
                    to_version: 134,
                },
                StorePreparationEvent::MigrationProgress {
                    completed: 1,
                    total: 1,
                },
            ]
        );
        validate_current_store(&connection).expect("current Store");
        for table in [
            "codex_queued_follow_up_ledgers",
            "codex_queued_follow_up_entries",
            "codex_queued_follow_up_payload_manifests",
            "codex_queued_follow_up_payload_asset_refs",
            "codex_queued_follow_up_manifest_gc",
        ] {
            let exists = connection
                .query_row(
                    "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
                    [table],
                    |_| Ok(()),
                )
                .optional()
                .expect("schema query")
                .is_some();
            assert!(exists, "missing {table}");
        }
    }

    #[test]
    fn unsupported_or_drifted_source_fails_before_backup() {
        let unsupported = tempdir().expect("unsupported Profile");
        install_baseline_fixture(unsupported.path());
        let mut connection = open_writer(&unsupported.path().join("nodex.db")).expect("writer");
        connection
            .pragma_update(None, "user_version", 129)
            .expect("unsupported revision");
        let error = prepare_profile_store(&mut connection, unsupported.path())
            .expect_err("v129 must be rejected");
        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        assert!(!unsupported.path().join("backups").exists());

        let drifted = tempdir().expect("drifted Profile");
        install_baseline_fixture(drifted.path());
        let mut connection = open_writer(&drifted.path().join("nodex.db")).expect("writer");
        connection
            .execute("CREATE TABLE unexpected_drift(id INTEGER PRIMARY KEY)", [])
            .expect("drift schema");
        let error = prepare_profile_store(&mut connection, drifted.path())
            .expect_err("drifted v130 must be rejected");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert!(!drifted.path().join("backups").exists());

        let future = tempdir().expect("future Profile");
        install_baseline_fixture(future.path());
        let mut connection = open_writer(&future.path().join("nodex.db")).expect("writer");
        connection
            .pragma_update(None, "user_version", CURRENT_STORE_REVISION + 1)
            .expect("future revision");
        let error = prepare_profile_store(&mut connection, future.path())
            .expect_err("future Store must be rejected");
        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        assert!(!future.path().join("backups").exists());

        let nonempty_v0 = tempdir().expect("nonempty v0 Profile");
        let mut connection = open_writer(&nonempty_v0.path().join("nodex.db")).expect("writer");
        connection
            .execute("CREATE TABLE unexpected_application_object(id INTEGER)", [])
            .expect("application object");
        let error = prepare_profile_store(&mut connection, nonempty_v0.path())
            .expect_err("nonempty v0 Store must be rejected");
        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        assert!(!nonempty_v0.path().join("backups").exists());

        let current_drift = tempdir().expect("current drift Profile");
        let mut connection = open_writer(&current_drift.path().join("nodex.db")).expect("writer");
        prepare_profile_store(&mut connection, current_drift.path()).expect("current Store");
        connection
            .execute("CREATE TABLE unexpected_current_drift(id INTEGER)", [])
            .expect("current drift");
        let error = prepare_profile_store(&mut connection, current_drift.path())
            .expect_err("drifted current Store must be rejected");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
    }

    #[test]
    fn semantically_invalid_baseline_fails_before_backup_or_migration_event() {
        let directory = tempdir().expect("Profile");
        install_baseline_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        connection
            .execute("UPDATE profiles SET created_at = 'not-a-timestamp'", [])
            .expect("corrupt timestamp semantics");
        let mut events = Vec::new();
        let error =
            prepare_profile_store_with_observer(&mut connection, directory.path(), &mut |event| {
                events.push(event)
            })
            .expect_err("invalid baseline semantics");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert!(events.is_empty());
        assert!(!directory.path().join("backups").exists());
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("source version"),
            BASELINE_STORE_REVISION
        );
    }

    #[test]
    fn invalid_baseline_document_fails_before_backup() {
        const NOW: &str = "2026-08-20T00:00:00.000Z";

        let directory = tempdir().expect("Profile");
        install_baseline_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(
            &connection,
        )
        .expect("maintenance context");
        let library_id = connection
            .query_row("SELECT id FROM libraries LIMIT 1", [], |row| {
                row.get::<_, String>(0)
            })
            .expect("baseline Library");
        connection
            .execute(
                "INSERT INTO documents(\
                   id, library_id, generation, head_seq, schema_key, schema_version, state_vector, \
                   state_hash, readiness, authority, created_at, updated_at, sync_engine\
                 ) VALUES ('document:incomplete', ?1, 1, 0, 'nodex.page', 2, X'', '', \
                   'ready', 'ydoc_primary', ?2, ?2, 'yjs')",
                params![library_id, NOW],
            )
            .expect("incomplete Document");

        let error = prepare_profile_store(&mut connection, directory.path())
            .expect_err("Document without materialization");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert!(!directory.path().join("backups").exists());
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("source version"),
            BASELINE_STORE_REVISION
        );
    }

    #[test]
    fn migrated_store_is_validated_before_transaction_commit() {
        let directory = tempdir().expect("Profile");
        install_baseline_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        let error = migrate_baseline_store(
            &mut connection,
            directory.path(),
            &mut |_| {},
            MigrationStep {
                from_revision: BASELINE_STORE_REVISION,
                to_revision: CURRENT_STORE_REVISION,
                apply: |connection, context| {
                    migrate_v130_to_v131(connection, context)?;
                    connection.execute(
                        "UPDATE core_store_metadata SET projection_event_v2_floor = 999",
                        [],
                    )?;
                    Ok(())
                },
            },
        )
        .expect_err("invalid migrated Store");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("rolled-back version"),
            BASELINE_STORE_REVISION
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema \
                     WHERE name = 'core_store_migration_history'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("rolled-back history table"),
            0
        );
        assert_eq!(
            fs::read_dir(directory.path().join("backups/core-migrations"))
                .expect("preserved backup")
                .count(),
            1
        );
    }

    #[test]
    fn failed_migration_rolls_back_after_preserving_backup() {
        let directory = tempdir().expect("Profile");
        install_baseline_fixture(directory.path());
        let mut connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        let error = migrate_baseline_store(
            &mut connection,
            directory.path(),
            &mut |_| {},
            MigrationStep {
                from_revision: BASELINE_STORE_REVISION,
                to_revision: CURRENT_STORE_REVISION,
                apply: |connection, _| {
                    connection.execute("CREATE TABLE should_roll_back(id INTEGER)", [])?;
                    Err(corrupt("injected migration failure"))
                },
            },
        )
        .expect_err("migration failure");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("version"),
            130
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name = 'should_roll_back'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("rolled-back object"),
            0
        );
        assert_eq!(
            fs::read_dir(directory.path().join("backups/core-migrations"))
                .expect("backup")
                .count(),
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn migration_backup_path_rejects_symlinks_and_non_files() {
        let symlinked = tempdir().expect("Profile");
        let outside = tempdir().expect("outside directory");
        install_baseline_fixture(symlinked.path());
        symlink(outside.path(), symlinked.path().join("backups")).expect("symlinked backups");
        let mut connection = open_writer(&symlinked.path().join("nodex.db")).expect("writer");
        let error = prepare_profile_store(&mut connection, symlinked.path())
            .expect_err("symlinked backup ancestry must fail");
        assert_eq!(error.code, StoreErrorCode::InvalidProfile);
        assert_eq!(fs::read_dir(outside.path()).expect("outside").count(), 0);

        let non_file = tempdir().expect("Profile");
        install_baseline_fixture(non_file.path());
        let backup_directory = non_file.path().join("backups/core-migrations");
        fs::create_dir_all(&backup_directory).expect("backup directory");
        fs::create_dir(backup_directory.join(".v130-to-v134.pending.db"))
            .expect("non-file pending candidate");
        let mut connection = open_writer(&non_file.path().join("nodex.db")).expect("writer");
        let error = prepare_profile_store(&mut connection, non_file.path())
            .expect_err("non-file pending backup must fail");
        assert_eq!(error.code, StoreErrorCode::InvalidProfile);
    }

    #[test]
    fn migration_registry_is_contiguous_and_forward_only() {
        assert_eq!(MIGRATION_STEPS.len(), 4);
        for (index, step) in MIGRATION_STEPS.iter().enumerate() {
            assert!(step.from_revision < step.to_revision);
            if let Some(next) = MIGRATION_STEPS.get(index + 1) {
                assert_eq!(step.to_revision, next.from_revision);
            }
        }
        assert_eq!(MIGRATION_STEPS[0].from_revision, BASELINE_STORE_REVISION);
        assert_eq!(
            MIGRATION_STEPS.last().expect("migration tail").to_revision,
            CURRENT_STORE_REVISION
        );
    }
}
