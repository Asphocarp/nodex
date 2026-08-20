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
use super::schema::{CURRENT_STORE_REVISION, install_current_schema, validate_schema_identity};
use super::sqlite::{
    StoreError, StoreErrorCode, open_immutable_reader, validate_store, with_immediate_transaction,
};
use super::store_validation::{
    validate_codex_thread_timestamp_invariants, validate_current_store,
    validate_database_priority_invariants,
};

const BASELINE_STORE_REVISION: i64 = 130;
const CORE_SCHEMA_OWNER: &str = "rust_core";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorePreparation {
    pub schema_version: i64,
    pub created_fresh: bool,
    pub migrated_from_version: Option<i64>,
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

const MIGRATION_STEPS: &[MigrationStep] = &[MigrationStep {
    from_revision: BASELINE_STORE_REVISION,
    to_revision: CURRENT_STORE_REVISION,
    apply: migrate_v130_to_v131,
}];

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
        install_current_schema(connection)?;
        initialize_fresh_profile(connection, unix_time_millis()?)?;
        validate_current_store(connection)?;
        return Ok(StorePreparation {
            schema_version: CURRENT_STORE_REVISION,
            created_fresh: true,
            migrated_from_version: None,
        });
    }
    if version == CURRENT_STORE_REVISION {
        validate_current_store(connection)?;
        return Ok(StorePreparation {
            schema_version: CURRENT_STORE_REVISION,
            created_fresh: false,
            migrated_from_version: None,
        });
    }
    let Some(step) = MIGRATION_STEPS
        .iter()
        .copied()
        .find(|step| step.from_revision == version)
    else {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            format!(
                "Rust Core accepts the current v{CURRENT_STORE_REVISION} Store or migrates the v{BASELINE_STORE_REVISION} baseline; received v{version}"
            ),
            false,
        ));
    };

    migrate_baseline_store(connection, profile_home, observer, step)
}

fn migrate_baseline_store(
    connection: &mut Connection,
    profile_home: &Path,
    observer: &mut dyn FnMut(StorePreparationEvent),
    step: MigrationStep,
) -> Result<StorePreparation, StoreError> {
    validate_baseline_source(connection)?;
    observer(StorePreparationEvent::MigrationStarted {
        from_version: step.from_revision,
        to_version: step.to_revision,
    });
    let backup_path = create_migration_backup(
        connection,
        profile_home,
        step.from_revision,
        step.to_revision,
    )?;
    validate_restore_documents(connection)?;

    let source = published_format(step.from_revision)?;
    let target = published_format(step.to_revision)?;
    let backup_name = backup_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid_profile("Core migration backup name is not valid UTF-8"))?
        .to_owned();
    let context = MigrationContext {
        source_revision: step.from_revision,
        target_revision: step.to_revision,
        backup_name,
        source_schema_fingerprint: source.schema_fingerprint,
        target_schema_fingerprint: target.schema_fingerprint,
        completed_at_unix_ms: i64::try_from(unix_time_millis()?)
            .map_err(|_| internal("Migration time exceeds SQLite integer range"))?,
    };

    with_schema_rebuild_transaction(connection, |transaction| {
        (step.apply)(transaction, &context)
    })?;
    let mut reported_step = 0;
    report_bounded_progress(
        &mut |completed, total| {
            observer(StorePreparationEvent::MigrationProgress { completed, total });
        },
        1,
        1,
        &mut reported_step,
    );
    validate_current_store(connection)?;
    Ok(StorePreparation {
        schema_version: step.to_revision,
        created_fresh: false,
        migrated_from_version: Some(step.from_revision),
    })
}

fn validate_baseline_source(connection: &Connection) -> Result<(), StoreError> {
    validate_store(connection)?;
    validate_schema_identity(connection, BASELINE_STORE_REVISION)?;
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
        return Err(corrupt("v130 Store has invalid Core metadata"));
    }
    validate_codex_thread_timestamp_invariants(connection)?;
    validate_database_priority_invariants(connection)
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
    connection.pragma_update(None, "user_version", CURRENT_STORE_REVISION)?;
    Ok(())
}

fn initialize_fresh_profile(connection: &mut Connection, now: u64) -> Result<(), StoreError> {
    let now = i64::try_from(now)
        .map_err(|_| internal("Profile initialization time exceeds SQLite integer range"))?;
    with_immediate_transaction(connection, |transaction| {
        transaction.execute(
            "INSERT INTO core_store_metadata( \
               id, schema_owner, projection_event_v2_floor \
             ) VALUES (1, ?1, 1)",
            [CORE_SCHEMA_OWNER],
        )?;
        transaction.execute(
            "INSERT INTO nodex_agent_token_keys(id, key_material) VALUES (1, randomblob(32))",
            [],
        )?;
        transaction.execute(
            "INSERT INTO core_automation_runtime_metadata( \
               id, jitter_salt, created_at_unix_ms \
             ) VALUES (1, lower(hex(randomblob(16))), ?1)",
            [now],
        )?;
        Ok(())
    })
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
    initialize_fresh_profile(connection, unix_time_millis()?)?;
    crate::infrastructure::visibility_delta_journal::install_test_maintenance_context(connection)
}

#[cfg(test)]
fn test_current_store_template() -> Result<&'static Mutex<Connection>, StoreError> {
    if let Some(template) = TEST_CURRENT_STORE_TEMPLATE.get() {
        return Ok(template);
    }
    let connection = Connection::open_in_memory()?;
    connection.pragma_update(None, "foreign_keys", true)?;
    install_current_schema(&connection)?;
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

    use tempfile::tempdir;

    use super::super::sqlite::open_writer;
    use super::*;

    fn install_baseline_fixture(home: &Path) {
        fs::write(
            home.join("nodex.db"),
            include_bytes!("../../tests/fixtures/store-v130.db"),
        )
        .expect("frozen v130 Store");
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
                StorePreparationEvent::MigrationProgress {
                    completed: 1,
                    total: 1,
                },
            ]
        );
        let history = connection
            .query_row(
                "SELECT source_revision, target_revision, source_schema_fingerprint, \
                        target_schema_fingerprint, backup_name, completed_at_unix_ms \
                 FROM core_store_migration_history",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .expect("migration history");
        assert_eq!((history.0, history.1), (130, 131));
        assert_eq!(
            history.2,
            published_format(130)
                .expect("v130 format")
                .schema_fingerprint
        );
        assert_eq!(
            history.3,
            published_format(131)
                .expect("v131 format")
                .schema_fingerprint
        );
        assert!(history.4.starts_with("v130-to-v131-"));
        assert!(history.4.ends_with(".db"));
        assert!(history.5 > 0);
        let backup_path = directory
            .path()
            .join("backups/core-migrations")
            .join(&history.4);
        let backup_metadata = fs::symlink_metadata(&backup_path).expect("migration backup");
        assert!(backup_metadata.is_file());
        assert!(!backup_metadata.file_type().is_symlink());
        assert_eq!(profile_secrets(&connection), baseline_secrets);
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .expect("version"),
            131
        );
        validate_schema_identity(&connection, 131).expect("converged schema");
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
            1
        );
        assert_eq!(
            fs::read_dir(directory.path().join("backups/core-migrations"))
                .expect("backups")
                .count(),
            1
        );
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
        fs::create_dir(backup_directory.join(".v130-to-v131.pending.db"))
            .expect("non-file pending candidate");
        let mut connection = open_writer(&non_file.path().join("nodex.db")).expect("writer");
        let error = prepare_profile_store(&mut connection, non_file.path())
            .expect_err("non-file pending backup must fail");
        assert_eq!(error.code, StoreErrorCode::InvalidProfile);
    }

    #[test]
    fn migration_registry_is_contiguous_and_forward_only() {
        assert_eq!(MIGRATION_STEPS.len(), 1);
        for step in MIGRATION_STEPS {
            assert!(step.from_revision < step.to_revision);
        }
        assert_eq!(MIGRATION_STEPS[0].from_revision, BASELINE_STORE_REVISION);
        assert_eq!(MIGRATION_STEPS[0].to_revision, CURRENT_STORE_REVISION);
    }
}
