use std::ffi::OsStr;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, MAIN_DB};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::migration::{StorePreparation, StorePreparationEvent, prepare_legacy_import_candidate};
use super::schema::{CORE_SCHEMA_VERSION, read_schema_inventory, validate_exact_v84_schema};
use super::sqlite::{StoreError, StoreErrorCode, open_reader, open_writer, validate_store};
use super::store::STORE_FILE_NAME;

const LEGACY_DATABASE_FILE_NAME: &str = "kanban.db";
const ASSETS_DIRECTORY_NAME: &str = "assets";
const BACKUP_DIRECTORY_NAME: &str = "backups/core-migrations";
const JOURNAL_FILE_NAME: &str = ".core-legacy-import-journal.json";
const JOURNAL_VERSION: u32 = 1;
const PRIVATE_DIRECTORY_MODE: u32 = 0o700;
const PRIVATE_FILE_MODE: u32 = 0o600;
const MAX_JOURNAL_BYTES: u64 = 64 * 1024;
const MAX_ASSET_ENTRIES: usize = 100_000;
const WAL_SUFFIX: &str = "-wal";
const SHM_SUFFIX: &str = "-shm";
const MIGRATOR_EXECUTABLE_ENV: &str = "NODEX_LEGACY_MIGRATOR_EXECUTABLE";
const MIGRATOR_SCRIPT_ENV: &str = "NODEX_LEGACY_MIGRATOR_SCRIPT";
const MIGRATOR_SHA256_ENV: &str = "NODEX_LEGACY_MIGRATOR_SHA256";
const PACKAGED_RESOURCES_DIRECTORY_NAME: &str = "Resources";
const PACKAGED_BIN_DIRECTORY_NAME: &str = "bin";
const PACKAGED_CONTENTS_DIRECTORY_NAME: &str = "Contents";
const PACKAGED_EXECUTABLE_NAME: &str = "Nodex";
const PACKAGED_MIGRATOR_MANIFEST_NAME: &str = "legacy-profile-migrator.json";
const PACKAGED_MIGRATOR_SCRIPT_NAME: &str = "legacy-profile-migrator.mjs";
const SUPPORTED_SOURCE_VERSIONS: &[i64] = &[26, 57, 68, 82, 83];
const EARLY_V57_SCHEMA_FINGERPRINT: &str =
    "ceb13a0d7504ef463395ba0bc694d3ab02501a1591322baab0ab3cdd2085ad37";
const V26_SCHEMA_FINGERPRINTS: &[&str] =
    &["d88c3edca94968058e9dd6085ad9dc9b549f34b9c79195eb13f82a52511b2373"];
const V57_SCHEMA_FINGERPRINTS: &[&str] = &[
    EARLY_V57_SCHEMA_FINGERPRINT,
    "6d89ee204fee927dbb5b4622bffe37cdff34d0400558c114d4497f27ae802132",
];
const V68_SCHEMA_FINGERPRINTS: &[&str] =
    &["e8e6e103d94f2b51e55ce3c4a423b96dd48b6d3ff047b1180e3a43908a9830f5"];
const V82_SCHEMA_FINGERPRINTS: &[&str] =
    &["38e2a9474a92ec4b33cea2a2236d4870fdc0ae7c260b087f7146bafb491bc7a5"];
const V83_SCHEMA_FINGERPRINTS: &[&str] =
    &["a2447b0024e3034acc5d3a91be8e8e69aa95fa9ab7c6349ed7f52da92a5bad8b"];
const AGENT_RECEIPT_SCHEMA_HASHES: &[&str] = &[
    "499f4a395c4df215265cf9420cbccb4737796c02346b325be08c2f957141d743",
    "9f3d9c66142a7bc42c0060ab146255db768461e45a057d7d78451cff3d7b7814",
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LegacyImportPhase {
    Prepared,
    RollbackStarted,
    Installed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyImportJournal {
    version: u32,
    source_version: i64,
    source_database_file_name: String,
    backup_directory_name: String,
    staging_directory_name: String,
    rollback_directory_name: String,
    phase: LegacyImportPhase,
    had_assets: bool,
    had_wal: bool,
    had_shm: bool,
}

#[derive(Debug)]
struct LegacySource {
    database_path: PathBuf,
    database_file_name: &'static str,
    version: i64,
    inventory: LegacyInventory,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LegacyInventory {
    Frozen,
    EarlyV57,
}

#[derive(Debug)]
struct LegacyMigratorCommand {
    executable: PathBuf,
    script: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMigratorManifest {
    schema_version: u32,
    bundle: LegacyMigratorManifestBundle,
}

#[derive(Debug, Deserialize)]
struct LegacyMigratorManifestBundle {
    path: String,
    sha256: String,
}

pub(crate) fn migrate_legacy_profile_if_needed_with_observer(
    profile_home: &Path,
    observer: &mut dyn FnMut(StorePreparationEvent),
) -> Result<Option<StorePreparation>, StoreError> {
    recover_interrupted_legacy_import(profile_home)?;
    let Some(source) = detect_legacy_source(profile_home)? else {
        return Ok(None);
    };
    let migrator = LegacyMigratorCommand::from_environment()?;
    observer(StorePreparationEvent::MigrationStarted {
        from_version: source.version,
        to_version: CORE_SCHEMA_VERSION,
    });
    migrate_legacy_source(profile_home, source, &migrator).map(Some)
}

fn migrate_legacy_source(
    profile_home: &Path,
    source: LegacySource,
    migrator: &LegacyMigratorCommand,
) -> Result<StorePreparation, StoreError> {
    let migration_id = migration_id()?;
    let backup_directory_name = format!(
        "v{}-to-v{CORE_SCHEMA_VERSION}-{}-{migration_id}",
        source.version,
        unix_time_millis()?
    );
    let staging_directory_name = format!(".legacy-stage-{migration_id}");
    let rollback_directory_name = format!(".legacy-rollback-{migration_id}");
    let had_assets = real_directory_exists(&profile_home.join(ASSETS_DIRECTORY_NAME))?;
    let had_wal = regular_file_exists(&append_suffix(&source.database_path, WAL_SUFFIX))?;
    let had_shm = regular_file_exists(&append_suffix(&source.database_path, SHM_SUFFIX))?;
    let backup_root = prepare_backup_root(profile_home)?;
    let backup_directory = create_owned_directory(&backup_root, &backup_directory_name)?;
    let backup_database = backup_directory.join(STORE_FILE_NAME);
    if let Err(error) =
        snapshot_legacy_store(profile_home, &source, &backup_directory, &backup_database)
    {
        remove_owned_directory(&backup_root, &backup_directory_name)?;
        return Err(error);
    }
    let staging_directory = create_owned_directory(&backup_root, &staging_directory_name)?;
    let rollback_directory = backup_root.join(&rollback_directory_name);
    let staging_database = staging_directory.join(STORE_FILE_NAME);
    let candidate_result = (|| {
        copy_file(&backup_database, &staging_database)?;
        copy_regular_tree_if_present(
            &backup_directory.join(ASSETS_DIRECTORY_NAME),
            &staging_directory.join(ASSETS_DIRECTORY_NAME),
        )?;
        ensure_assets_directory(&staging_directory.join(ASSETS_DIRECTORY_NAME))?;
        sync_tree(&staging_directory)?;

        normalize_legacy_staging_store(&staging_database, source.inventory)?;
        migrator.run(&staging_directory)?;
        let mut candidate = open_writer(&staging_database)?;
        validate_store(&candidate)?;
        validate_exact_v84_schema(&candidate)?;
        let preparation = prepare_legacy_import_candidate(
            &mut candidate,
            profile_home,
            source.version,
            &backup_database,
        )?;
        candidate.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        drop(candidate);
        remove_regular_file_if_present(&append_suffix(&staging_database, WAL_SUFFIX))?;
        remove_regular_file_if_present(&append_suffix(&staging_database, SHM_SUFFIX))?;
        sync_tree(&staging_directory)?;
        Ok::<_, StoreError>(preparation)
    })();
    let preparation = match candidate_result {
        Ok(preparation) => preparation,
        Err(error) => {
            remove_owned_directory(&backup_root, &staging_directory_name)?;
            return Err(error);
        }
    };

    let mut journal = LegacyImportJournal {
        version: JOURNAL_VERSION,
        source_version: source.version,
        source_database_file_name: source.database_file_name.to_owned(),
        backup_directory_name,
        staging_directory_name,
        rollback_directory_name,
        phase: LegacyImportPhase::Prepared,
        had_assets,
        had_wal,
        had_shm,
    };
    if let Err(error) = write_journal(profile_home, &journal) {
        remove_owned_directory(&backup_root, &journal.staging_directory_name)?;
        return Err(error);
    }
    journal.phase = LegacyImportPhase::RollbackStarted;
    write_journal(profile_home, &journal)?;
    create_owned_directory(&backup_root, &journal.rollback_directory_name)?;
    move_if_present(
        &source.database_path,
        &rollback_directory.join(source.database_file_name),
    )?;
    move_if_present(
        &append_suffix(&source.database_path, WAL_SUFFIX),
        &rollback_directory.join(format!("{}{WAL_SUFFIX}", source.database_file_name)),
    )?;
    move_if_present(
        &append_suffix(&source.database_path, SHM_SUFFIX),
        &rollback_directory.join(format!("{}{SHM_SUFFIX}", source.database_file_name)),
    )?;
    move_if_present(
        &profile_home.join(ASSETS_DIRECTORY_NAME),
        &rollback_directory.join(ASSETS_DIRECTORY_NAME),
    )?;
    move_required(&staging_database, &profile_home.join(STORE_FILE_NAME))?;
    move_required(
        &staging_directory.join(ASSETS_DIRECTORY_NAME),
        &profile_home.join(ASSETS_DIRECTORY_NAME),
    )?;
    sync_directory(profile_home)?;
    journal.phase = LegacyImportPhase::Installed;
    write_journal(profile_home, &journal)?;

    let mut installed = open_writer(&profile_home.join(STORE_FILE_NAME))?;
    let installed_preparation =
        super::migration::prepare_profile_store(&mut installed, profile_home)?;
    drop(installed);
    if installed_preparation.schema_version != CORE_SCHEMA_VERSION {
        return Err(corrupt(
            "Legacy import did not install the current Core schema",
        ));
    }
    remove_owned_directory(&backup_root, &journal.rollback_directory_name)?;
    remove_owned_directory(&backup_root, &journal.staging_directory_name)?;
    remove_journal(profile_home)?;
    Ok(preparation)
}

fn detect_legacy_source(profile_home: &Path) -> Result<Option<LegacySource>, StoreError> {
    let current = profile_home.join(STORE_FILE_NAME);
    let legacy = profile_home.join(LEGACY_DATABASE_FILE_NAME);
    let current_exists = regular_file_exists(&current)?;
    let legacy_exists = regular_file_exists(&legacy)?;
    if current_exists && legacy_exists {
        return Err(invalid_profile(
            "Profile contains both nodex.db and the retired kanban.db",
        ));
    }
    let (database_path, database_file_name) = if current_exists {
        (current, STORE_FILE_NAME)
    } else if legacy_exists {
        (legacy, LEGACY_DATABASE_FILE_NAME)
    } else {
        return Ok(None);
    };
    let connection = open_reader(&database_path)?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if !SUPPORTED_SOURCE_VERSIONS.contains(&version) {
        return Ok(None);
    }
    validate_store(&connection)?;
    let inventory = validate_legacy_shape(&connection, version)?;
    Ok(Some(LegacySource {
        database_path,
        database_file_name,
        version,
        inventory,
    }))
}

fn validate_legacy_shape(
    connection: &Connection,
    version: i64,
) -> Result<LegacyInventory, StoreError> {
    let expected = match version {
        26 => V26_SCHEMA_FINGERPRINTS,
        57 => V57_SCHEMA_FINGERPRINTS,
        68 => V68_SCHEMA_FINGERPRINTS,
        82 => V82_SCHEMA_FINGERPRINTS,
        83 => V83_SCHEMA_FINGERPRINTS,
        _ => {
            return Err(StoreError::new(
                StoreErrorCode::UnsupportedSchema,
                format!("Nodex schema v{version} is not a supported legacy import source"),
                false,
            ));
        }
    };
    let actual = legacy_schema_fingerprint(connection)?;
    if version == 57 && actual == EARLY_V57_SCHEMA_FINGERPRINT {
        return Ok(LegacyInventory::EarlyV57);
    }
    if expected.contains(&actual.as_str()) {
        return Ok(LegacyInventory::Frozen);
    }
    Err(StoreError::new(
        StoreErrorCode::UnsupportedSchema,
        format!("Nodex schema v{version} does not match a supported frozen legacy inventory"),
        false,
    ))
}

fn normalize_legacy_staging_store(
    database_path: &Path,
    inventory: LegacyInventory,
) -> Result<(), StoreError> {
    if inventory != LegacyInventory::EarlyV57 {
        return Ok(());
    }
    let connection = open_writer(database_path)?;
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;

        CREATE TEMP TABLE early_v57_automations AS
        SELECT
          automation_id,
          kind,
          status,
          target_thread_id,
          name,
          prompt,
          rrule,
          model,
          reasoning_effort,
          cwds_json,
          execution_environment,
          local_environment_config_path,
          next_run_at,
          last_run_at,
          created_at,
          updated_at
        FROM codex_scheduled_automations;
        DROP TABLE codex_scheduled_automations;
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
        INSERT INTO codex_scheduled_automations (
          automation_id,
          kind,
          status,
          target_thread_id,
          name,
          prompt,
          rrule,
          model,
          reasoning_effort,
          cwds_json,
          execution_environment,
          local_environment_config_path,
          next_run_at,
          last_run_at,
          created_at,
          updated_at
        )
        SELECT
          automation_id,
          kind,
          status,
          target_thread_id,
          name,
          prompt,
          rrule,
          model,
          reasoning_effort,
          cwds_json,
          execution_environment,
          local_environment_config_path,
          next_run_at,
          last_run_at,
          created_at,
          updated_at
        FROM early_v57_automations;
        CREATE INDEX idx_codex_scheduled_automations_target
	      ON codex_scheduled_automations(target_thread_id, kind, status, created_at, automation_id);

        CREATE TEMP TABLE early_v57_threads AS
        SELECT
          thread_id,
          project_id,
          parent_thread_id,
          thread_name,
          thread_source,
          agent_nickname,
          agent_role,
          thread_preview,
          model_provider,
          cwd,
          managed_worktree_path,
          projectless_output_directory,
          projectless_workspace_browser_root,
          status_type,
          status_active_flags_json,
          archived,
          created_at,
          updated_at,
          linked_at
        FROM codex_threads;
        DROP TABLE codex_threads;
        CREATE TABLE codex_threads (
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
        INSERT INTO codex_threads (
          thread_id,
          project_id,
          parent_thread_id,
          thread_name,
          thread_source,
          agent_nickname,
          agent_role,
          thread_preview,
          model_provider,
          cwd,
          managed_worktree_path,
          projectless_output_directory,
          projectless_workspace_browser_root,
          status_type,
          status_active_flags_json,
          archived,
          created_at,
          updated_at,
          linked_at
        )
        SELECT
          thread_id,
          project_id,
          parent_thread_id,
          thread_name,
          thread_source,
          agent_nickname,
          agent_role,
          thread_preview,
          model_provider,
          cwd,
          managed_worktree_path,
          projectless_output_directory,
          projectless_workspace_browser_root,
          status_type,
          status_active_flags_json,
          archived,
          created_at,
          updated_at,
          linked_at
        FROM early_v57_threads;
        CREATE INDEX idx_codex_threads_project_updated
      ON codex_threads(project_id, updated_at DESC);

        COMMIT;
        PRAGMA foreign_keys = ON;
        "#,
    )?;
    validate_store(&connection)?;
    Ok(())
}

fn legacy_schema_fingerprint(connection: &Connection) -> Result<String, StoreError> {
    let inventory = read_schema_inventory(connection)?;
    let mut digest = Sha256::new();
    for (key, sql) in inventory {
        let canonical_sql = if key.name == "nodex_agent_call_receipts" {
            let sql_hash = format!("{:x}", Sha256::digest(sql.as_bytes()));
            if !AGENT_RECEIPT_SCHEMA_HASHES.contains(&sql_hash.as_str()) {
                return Err(StoreError::new(
                    StoreErrorCode::UnsupportedSchema,
                    "Legacy Agent receipt schema does not match a published variant",
                    false,
                ));
            }
            "KNOWN_VARIANT"
        } else {
            sql.as_str()
        };
        for value in [
            key.object_type.as_str(),
            key.name.as_str(),
            key.table_name.as_str(),
            canonical_sql,
        ] {
            digest.update(value.as_bytes());
            digest.update([0]);
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}

impl LegacyMigratorCommand {
    fn from_environment() -> Result<Self, StoreError> {
        let configured_executable =
            std::env::var_os(MIGRATOR_EXECUTABLE_ENV).filter(|value| !value.is_empty());
        let configured_script =
            std::env::var_os(MIGRATOR_SCRIPT_ENV).filter(|value| !value.is_empty());
        let configured_hash = std::env::var(MIGRATOR_SHA256_ENV)
            .ok()
            .filter(|value| !value.is_empty());
        if configured_executable.is_none()
            && configured_script.is_none()
            && configured_hash.is_none()
        {
            return Self::from_packaged_core_executable(
                &std::env::current_exe().map_err(io_error)?,
            );
        }
        let (Some(configured_executable), Some(configured_script), Some(expected_hash)) =
            (configured_executable, configured_script, configured_hash)
        else {
            return Err(missing_migrator(
                "Legacy migrator overrides must be configured together",
            ));
        };
        let executable = required_absolute_regular_path(
            &PathBuf::from(configured_executable),
            "Legacy Profile migration executable",
        )?;
        let script = required_absolute_regular_path(
            &PathBuf::from(configured_script),
            "Legacy Profile migration script",
        )?;
        if !is_sha256(&expected_hash) {
            return Err(missing_migrator("Legacy migrator SHA-256 is unavailable"));
        }
        let actual_hash = sha256_file(&script)?;
        if actual_hash != expected_hash {
            return Err(missing_migrator(
                "Legacy migrator bundle does not match its manifest",
            ));
        }
        Ok(Self { executable, script })
    }

    fn from_packaged_core_executable(core_executable: &Path) -> Result<Self, StoreError> {
        let bin_directory = core_executable
            .parent()
            .filter(|path| path.file_name() == Some(OsStr::new(PACKAGED_BIN_DIRECTORY_NAME)));
        let resources_directory = bin_directory
            .and_then(Path::parent)
            .filter(|path| path.file_name() == Some(OsStr::new(PACKAGED_RESOURCES_DIRECTORY_NAME)));
        let contents_directory = resources_directory
            .and_then(Path::parent)
            .filter(|path| path.file_name() == Some(OsStr::new(PACKAGED_CONTENTS_DIRECTORY_NAME)));
        let application = contents_directory
            .and_then(Path::parent)
            .filter(|path| path.extension() == Some(OsStr::new("app")));
        let (Some(resources_directory), Some(contents_directory), Some(_application)) =
            (resources_directory, contents_directory, application)
        else {
            return Err(missing_migrator(
                "Legacy Profile migration runtime is unavailable",
            ));
        };

        let executable = required_absolute_regular_path(
            &contents_directory
                .join("MacOS")
                .join(PACKAGED_EXECUTABLE_NAME),
            "Packaged legacy migration executable",
        )?;
        let script = required_absolute_regular_path(
            &resources_directory.join(PACKAGED_MIGRATOR_SCRIPT_NAME),
            "Packaged legacy migration script",
        )?;
        let manifest_path = required_absolute_regular_path(
            &resources_directory.join(PACKAGED_MIGRATOR_MANIFEST_NAME),
            "Packaged legacy migration manifest",
        )?;
        let manifest = fs::read(&manifest_path)
            .map_err(io_error)
            .and_then(|bytes| {
                serde_json::from_slice::<LegacyMigratorManifest>(&bytes)
                    .map_err(|_| missing_migrator("Packaged legacy migrator manifest is invalid"))
            })?;
        if manifest.schema_version != 1
            || manifest.bundle.path != "resources/legacy-profile-migrator.mjs"
            || !is_sha256(&manifest.bundle.sha256)
        {
            return Err(missing_migrator(
                "Packaged legacy migrator manifest is invalid",
            ));
        }
        let actual_hash = sha256_file(&script)?;
        if actual_hash != manifest.bundle.sha256 {
            return Err(missing_migrator(
                "Legacy migrator bundle does not match its manifest",
            ));
        }
        Ok(Self { executable, script })
    }

    fn run(&self, staging_home: &Path) -> Result<(), StoreError> {
        let status = Command::new(&self.executable)
            .arg(&self.script)
            .arg("--home")
            .arg(staging_home)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .status()
            .map_err(io_error)?;
        if status.success() {
            return Ok(());
        }
        Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            format!("Legacy Profile migrator exited with {status}"),
            false,
        ))
    }
}

fn required_absolute_regular_path(path: &Path, label: &str) -> Result<PathBuf, StoreError> {
    if !path.is_absolute() {
        return Err(missing_migrator(
            "Legacy Profile migration runtime path must be absolute",
        ));
    }
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(missing_migrator(&format!("{label} must be a regular file")));
    }
    Ok(path.to_owned())
}

fn snapshot_legacy_store(
    profile_home: &Path,
    source: &LegacySource,
    backup_directory: &Path,
    backup_database: &Path,
) -> Result<(), StoreError> {
    let connection = open_reader(&source.database_path)?;
    connection.backup(MAIN_DB, backup_database, None)?;
    drop(connection);
    File::open(backup_database)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)?;
    let backup = open_writer(backup_database)?;
    let version: i64 = backup.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    validate_store(&backup)?;
    if version != source.version {
        return Err(corrupt(
            "Legacy migration backup has the wrong schema version",
        ));
    }
    drop(backup);
    copy_regular_tree_if_present(
        &profile_home.join(ASSETS_DIRECTORY_NAME),
        &backup_directory.join(ASSETS_DIRECTORY_NAME),
    )?;
    ensure_assets_directory(&backup_directory.join(ASSETS_DIRECTORY_NAME))?;
    sync_tree(backup_directory)
}

fn recover_interrupted_legacy_import(profile_home: &Path) -> Result<(), StoreError> {
    let Some(journal) = read_journal(profile_home)? else {
        return Ok(());
    };
    let backup_root = prepare_backup_root(profile_home)?;
    validate_owned_name(&journal.backup_directory_name, "v")?;
    validate_owned_name(&journal.staging_directory_name, ".legacy-stage-")?;
    validate_owned_name(&journal.rollback_directory_name, ".legacy-rollback-")?;
    if journal.phase != LegacyImportPhase::Prepared {
        restore_rollback(profile_home, &backup_root, &journal)?;
    }
    remove_owned_directory(&backup_root, &journal.rollback_directory_name)?;
    remove_owned_directory(&backup_root, &journal.staging_directory_name)?;
    remove_journal(profile_home)
}

fn restore_rollback(
    profile_home: &Path,
    backup_root: &Path,
    journal: &LegacyImportJournal,
) -> Result<(), StoreError> {
    let rollback = backup_root.join(&journal.rollback_directory_name);
    let staging = backup_root.join(&journal.staging_directory_name);
    let source_database = profile_home.join(&journal.source_database_file_name);
    let rollback_database = rollback.join(&journal.source_database_file_name);
    if rollback_database.exists() {
        if journal.source_database_file_name == STORE_FILE_NAME {
            move_candidate_out_of_live(profile_home, &staging)?;
        }
        if source_database.exists() {
            return Err(corrupt(
                "Legacy import recovery found duplicate source databases",
            ));
        }
        move_required(&rollback_database, &source_database)?;
    }
    if journal.source_database_file_name == LEGACY_DATABASE_FILE_NAME {
        move_candidate_out_of_live(profile_home, &staging)?;
    }
    restore_companion(
        &rollback.join(format!("{}{WAL_SUFFIX}", journal.source_database_file_name)),
        &append_suffix(&source_database, WAL_SUFFIX),
        journal.had_wal,
    )?;
    restore_companion(
        &rollback.join(format!("{}{SHM_SUFFIX}", journal.source_database_file_name)),
        &append_suffix(&source_database, SHM_SUFFIX),
        journal.had_shm,
    )?;
    let live_assets = profile_home.join(ASSETS_DIRECTORY_NAME);
    let rollback_assets = rollback.join(ASSETS_DIRECTORY_NAME);
    if rollback_assets.exists() {
        if live_assets.exists() {
            let staged_assets = staging.join(ASSETS_DIRECTORY_NAME);
            if staged_assets.exists() {
                validate_regular_tree(&live_assets)?;
                fs::remove_dir_all(&live_assets).map_err(io_error)?;
            } else {
                move_required(&live_assets, &staged_assets)?;
            }
        }
        move_required(&rollback_assets, &live_assets)?;
    } else if !journal.had_assets && live_assets.exists() {
        validate_regular_tree(&live_assets)?;
        fs::remove_dir_all(&live_assets).map_err(io_error)?;
    }
    sync_directory(profile_home)
}

fn move_candidate_out_of_live(profile_home: &Path, staging: &Path) -> Result<(), StoreError> {
    let live = profile_home.join(STORE_FILE_NAME);
    if !live.exists() {
        return Ok(());
    }
    let connection = open_writer(&live)?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    drop(connection);
    if version != CORE_SCHEMA_VERSION {
        return Err(corrupt(
            "Legacy import recovery found an unexpected live database",
        ));
    }
    let staged = staging.join(STORE_FILE_NAME);
    if staged.exists() {
        remove_regular_file_if_present(&live)?;
        return Ok(());
    }
    move_required(&live, &staged)
}

fn read_journal(profile_home: &Path) -> Result<Option<LegacyImportJournal>, StoreError> {
    let path = profile_home.join(JOURNAL_FILE_NAME);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_JOURNAL_BYTES
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(invalid_profile(
            "Legacy import journal must be a bounded private regular file",
        ));
    }
    let journal = serde_json::from_slice::<LegacyImportJournal>(&fs::read(path).map_err(io_error)?)
        .map_err(|_| corrupt("Legacy import journal JSON is invalid"))?;
    if journal.version != JOURNAL_VERSION
        || !SUPPORTED_SOURCE_VERSIONS.contains(&journal.source_version)
        || !matches!(
            journal.source_database_file_name.as_str(),
            STORE_FILE_NAME | LEGACY_DATABASE_FILE_NAME
        )
    {
        return Err(corrupt("Legacy import journal fields are invalid"));
    }
    Ok(Some(journal))
}

fn write_journal(profile_home: &Path, journal: &LegacyImportJournal) -> Result<(), StoreError> {
    let mut bytes = serde_json::to_vec_pretty(journal)
        .map_err(|_| internal("Legacy import journal could not be encoded"))?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(internal("Legacy import journal exceeds its size bound"));
    }
    let path = profile_home.join(JOURNAL_FILE_NAME);
    let temporary = profile_home.join(format!(".{JOURNAL_FILE_NAME}.tmp"));
    remove_regular_file_if_present(&temporary)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(PRIVATE_FILE_MODE)
        .open(&temporary)
        .map_err(io_error)?;
    file.write_all(&bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    drop(file);
    fs::rename(&temporary, &path).map_err(io_error)?;
    sync_directory(profile_home)
}

fn remove_journal(profile_home: &Path) -> Result<(), StoreError> {
    remove_regular_file_if_present(&profile_home.join(JOURNAL_FILE_NAME))?;
    sync_directory(profile_home)
}

fn prepare_backup_root(profile_home: &Path) -> Result<PathBuf, StoreError> {
    let mut root = profile_home.to_path_buf();
    for component in BACKUP_DIRECTORY_NAME.split('/') {
        root.push(component);
        match fs::symlink_metadata(&root) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(invalid_profile(
                    "Legacy migration backup ancestry must contain only real directories",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&root).map_err(io_error)?;
                sync_directory(
                    root.parent()
                        .ok_or_else(|| internal("Legacy migration backup root has no parent"))?,
                )?;
            }
            Err(error) => return Err(io_error(error)),
        }
        fs::set_permissions(&root, fs::Permissions::from_mode(PRIVATE_DIRECTORY_MODE))
            .map_err(io_error)?;
    }
    Ok(root)
}

fn create_owned_directory(root: &Path, name: &str) -> Result<PathBuf, StoreError> {
    validate_owned_name(
        name,
        if name.starts_with('.') {
            ".legacy-"
        } else {
            "v"
        },
    )?;
    let path = root.join(name);
    if path.exists() {
        return Err(corrupt("Legacy migration directory already exists"));
    }
    fs::create_dir(&path).map_err(io_error)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(PRIVATE_DIRECTORY_MODE))
        .map_err(io_error)?;
    sync_directory(root)?;
    Ok(path)
}

fn validate_owned_name(name: &str, prefix: &str) -> Result<(), StoreError> {
    if !name.starts_with(prefix)
        || name.len() <= prefix.len()
        || name.len() > 180
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'))
    {
        return Err(corrupt("Legacy migration directory name is unsafe"));
    }
    Ok(())
}

fn remove_owned_directory(root: &Path, name: &str) -> Result<(), StoreError> {
    validate_owned_name(
        name,
        if name.starts_with('.') {
            ".legacy-"
        } else {
            "v"
        },
    )?;
    let path = root.join(name);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_profile(
            "Legacy migration cleanup target must be a real directory",
        ));
    }
    fs::remove_dir_all(&path).map_err(io_error)?;
    sync_directory(root)
}

fn copy_regular_tree_if_present(source: &Path, destination: &Path) -> Result<(), StoreError> {
    match fs::symlink_metadata(source) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(
            invalid_profile("Legacy Profile assets must be a real directory"),
        ),
        Ok(_) => copy_regular_tree(source, destination),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn copy_regular_tree(source: &Path, destination: &Path) -> Result<(), StoreError> {
    validate_regular_tree(source)?;
    fs::create_dir(destination).map_err(io_error)?;
    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((source_directory, destination_directory)) = pending.pop() {
        for entry in fs::read_dir(source_directory).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
            let destination_path = destination_directory.join(entry.file_name());
            if metadata.is_dir() {
                fs::create_dir(&destination_path).map_err(io_error)?;
                pending.push((entry.path(), destination_path));
            } else {
                copy_file(&entry.path(), &destination_path)?;
            }
        }
    }
    Ok(())
}

fn validate_regular_tree(root: &Path) -> Result<(), StoreError> {
    let mut pending = vec![root.to_path_buf()];
    let mut count = 0usize;
    while let Some(directory) = pending.pop() {
        let metadata = fs::symlink_metadata(&directory).map_err(io_error)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(invalid_profile(
                "Legacy Profile assets may contain only real directories",
            ));
        }
        for entry in fs::read_dir(directory).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            count = count
                .checked_add(1)
                .ok_or_else(|| invalid_profile("Legacy Profile asset count exceeds its bound"))?;
            if count > MAX_ASSET_ENTRIES {
                return Err(invalid_profile(
                    "Legacy Profile asset count exceeds its bound",
                ));
            }
            let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
            if metadata.file_type().is_symlink() {
                return Err(invalid_profile(
                    "Legacy Profile assets must not contain symbolic links",
                ));
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if !metadata.is_file() {
                return Err(invalid_profile(
                    "Legacy Profile assets may contain only regular files",
                ));
            }
        }
    }
    Ok(())
}

fn ensure_assets_directory(path: &Path) -> Result<(), StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(
            invalid_profile("Legacy migration assets target must be a real directory"),
        ),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(io_error)
        }
        Err(error) => Err(io_error(error)),
    }
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), StoreError> {
    let metadata = fs::symlink_metadata(source).map_err(io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || destination.exists() {
        return Err(invalid_profile(
            "Legacy migration file copy source or destination is unsafe",
        ));
    }
    fs::copy(source, destination).map_err(io_error)?;
    File::open(destination)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)
}

fn move_if_present(source: &Path, destination: &Path) -> Result<(), StoreError> {
    match fs::symlink_metadata(source) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(invalid_profile(
            "Legacy migration move source must not be a symbolic link",
        )),
        Ok(_) => move_required(source, destination),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn move_required(source: &Path, destination: &Path) -> Result<(), StoreError> {
    if destination.exists() {
        return Err(corrupt("Legacy migration move destination already exists"));
    }
    let metadata = fs::symlink_metadata(source).map_err(io_error)?;
    if metadata.file_type().is_symlink() {
        return Err(invalid_profile(
            "Legacy migration move source must not be a symbolic link",
        ));
    }
    fs::rename(source, destination).map_err(io_error)?;
    if let Some(parent) = destination.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn restore_companion(source: &Path, destination: &Path, expected: bool) -> Result<(), StoreError> {
    if expected {
        if regular_file_exists(source)? {
            remove_regular_file_if_present(destination)?;
            return move_required(source, destination);
        }
        if regular_file_exists(destination)? {
            return Ok(());
        }
        return Err(corrupt(
            "Legacy migration recovery could not find an expected SQLite companion file",
        ));
    }
    if regular_file_exists(source)? {
        return Err(corrupt(
            "Legacy migration rollback contains an unexpected companion file",
        ));
    }
    remove_regular_file_if_present(destination)
}

fn regular_file_exists(path: &Path) -> Result<bool, StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(
            invalid_profile("Legacy migration database path must be a regular file"),
        ),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(error)),
    }
}

fn real_directory_exists(path: &Path) -> Result<bool, StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(
            invalid_profile("Legacy migration assets path must be a real directory"),
        ),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(error)),
    }
}

fn remove_regular_file_if_present(path: &Path) -> Result<(), StoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(
            invalid_profile("Legacy migration cleanup target must be a regular file"),
        ),
        Ok(_) => fs::remove_file(path).map_err(io_error),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error(error)),
    }
}

fn sync_tree(root: &Path) -> Result<(), StoreError> {
    validate_regular_tree(root)?;
    let mut pending = vec![root.to_path_buf()];
    let mut directories = Vec::new();
    while let Some(directory) = pending.pop() {
        directories.push(directory.clone());
        for entry in fs::read_dir(&directory).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
            if metadata.is_dir() {
                pending.push(entry.path());
            } else {
                File::open(entry.path())
                    .map_err(io_error)?
                    .sync_all()
                    .map_err(io_error)?;
            }
        }
    }
    for directory in directories.into_iter().rev() {
        sync_directory(&directory)?;
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), StoreError> {
    File::open(path)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)
}

fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn sha256_file(path: &Path) -> Result<String, StoreError> {
    let bytes = fs::read(path).map_err(io_error)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn migration_id() -> Result<String, StoreError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|_| internal("Legacy migration identity could not be generated"))?;
    Ok(hex::encode(bytes))
}

fn unix_time_millis() -> Result<u64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| internal("System clock predates the Unix epoch"))?;
    u64::try_from(duration.as_millis())
        .map_err(|_| internal("System time exceeds the migration timestamp range"))
}

fn missing_migrator(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::UnsupportedSchema, message, false)
}

fn invalid_profile(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidProfile, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

fn io_error(error: std::io::Error) -> StoreError {
    StoreError::new(
        StoreErrorCode::InvalidProfile,
        format!("Legacy migration filesystem operation failed: {error}"),
        false,
    )
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use tempfile::tempdir;

    use super::*;
    use crate::infrastructure::store::SqliteStoreKernel;

    const LEGACY_FIXTURES: &[(&str, i64)] = &[
        ("v26", 26),
        ("v57-early", 57),
        ("v57", 57),
        ("v68", 68),
        ("v82", 82),
        ("v83", 83),
    ];

    fn named_fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/legacy-profiles")
            .join(format!("{name}.db"))
    }

    fn fixture_path(version: i64) -> PathBuf {
        named_fixture_path(&format!("v{version}"))
    }

    fn migrator_command() -> LegacyMigratorCommand {
        let executable = std::env::var_os("PATH")
            .into_iter()
            .flat_map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
            .map(|directory| directory.join("node"))
            .find(|candidate| candidate.is_file())
            .expect("Node 24 executable on PATH");
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("resources/legacy-profile-migrator.mjs")
            .canonicalize()
            .expect("legacy migrator bundle");
        LegacyMigratorCommand { executable, script }
    }

    fn packaged_migrator_fixture() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let directory = tempdir().expect("packaged app root");
        let contents = directory.path().join("Nodex.app/Contents");
        let resources = contents.join(PACKAGED_RESOURCES_DIRECTORY_NAME);
        let bin = resources.join(PACKAGED_BIN_DIRECTORY_NAME);
        let macos = contents.join("MacOS");
        fs::create_dir_all(&bin).expect("packaged bin");
        fs::create_dir_all(&macos).expect("packaged executable directory");
        let core = bin.join("nodex-core");
        let executable = macos.join(PACKAGED_EXECUTABLE_NAME);
        let script = resources.join(PACKAGED_MIGRATOR_SCRIPT_NAME);
        fs::write(&core, b"core").expect("packaged Core");
        fs::write(&executable, b"electron").expect("packaged Electron");
        fs::write(&script, b"legacy migrator").expect("packaged migrator");
        let digest = sha256_file(&script).expect("packaged migrator digest");
        fs::write(
            resources.join(PACKAGED_MIGRATOR_MANIFEST_NAME),
            format!(
                r#"{{"schemaVersion":1,"bundle":{{"path":"resources/legacy-profile-migrator.mjs","sha256":"{digest}"}}}}"#,
            ),
        )
        .expect("packaged manifest");
        (directory, core, executable, script)
    }

    #[test]
    fn discovers_the_closed_legacy_migrator_from_the_packaged_core() {
        let (_directory, core, executable, script) = packaged_migrator_fixture();

        let command =
            LegacyMigratorCommand::from_packaged_core_executable(&core).expect("packaged migrator");

        assert_eq!(command.executable, executable);
        assert_eq!(command.script, script);
    }

    #[test]
    fn rejects_a_tampered_packaged_legacy_migrator() {
        let (_directory, core, _executable, script) = packaged_migrator_fixture();
        fs::write(script, b"tampered").expect("tampered migrator");

        let error = LegacyMigratorCommand::from_packaged_core_executable(&core)
            .expect_err("tampered migrator must fail");

        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        assert!(error.message.contains("does not match"));
    }

    fn source_file_name(version: i64) -> &'static str {
        if version == 26 {
            LEGACY_DATABASE_FILE_NAME
        } else {
            STORE_FILE_NAME
        }
    }

    fn backup_directories(home: &Path) -> Vec<PathBuf> {
        let root = home.join(BACKUP_DIRECTORY_NAME);
        let mut directories = fs::read_dir(root)
            .expect("backup root")
            .map(|entry| entry.expect("backup entry").path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        directories.sort();
        directories
    }

    #[test]
    fn imports_every_frozen_legacy_inventory_and_reopens_idempotently() {
        let migrator = migrator_command();
        for (fixture_name, version) in LEGACY_FIXTURES {
            let directory = tempdir().expect("profile root");
            let home = directory.path().canonicalize().expect("absolute profile");
            fs::copy(
                named_fixture_path(fixture_name),
                home.join(source_file_name(*version)),
            )
            .expect("legacy fixture");
            fs::create_dir(home.join(ASSETS_DIRECTORY_NAME)).expect("assets");
            fs::write(
                home.join(ASSETS_DIRECTORY_NAME).join("retained.txt"),
                format!("asset-v{version}"),
            )
            .expect("asset fixture");

            let source = detect_legacy_source(&home)
                .expect("classify source")
                .expect("legacy source");
            let preparation = migrate_legacy_source(&home, source, &migrator)
                .unwrap_or_else(|error| panic!("v{version} import failed: {error}"));
            assert_eq!(preparation.schema_version, CORE_SCHEMA_VERSION);
            assert_eq!(preparation.migrated_from_version, Some(*version));
            assert!(!home.join(source_file_name(*version)).exists() || *version != 26);

            let connection = open_writer(&home.join(STORE_FILE_NAME)).expect("current store");
            let published: (i64, String, i64) = connection
                .query_row(
                    "SELECT user_version, schema_owner, store_format_version \
                     FROM pragma_user_version JOIN core_store_metadata ON id = 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("Core metadata");
            assert_eq!(
                published,
                (
                    CORE_SCHEMA_VERSION,
                    "rust_core".to_owned(),
                    CORE_SCHEMA_VERSION
                )
            );
            if *fixture_name == "v57-early" {
                let block_type: String = connection
                    .query_row(
                        "SELECT type FROM blocks WHERE id = ?1",
                        ["019b7e12-5c00-7000-8000-000000005700"],
                        |row| row.get(0),
                    )
                    .expect("migrated early-v57 Page");
                assert_eq!(block_type, "page");
                let database_starter: i64 = connection
                    .query_row(
                        "SELECT database_starter FROM project_sessions WHERE id = ?1",
                        ["019b7e12-5c00-7000-8000-000000005701"],
                        |row| row.get(0),
                    )
                    .expect("migrated early-v57 Session");
                assert_eq!(database_starter, 0);
                let thread: (String, String, String, String, String, String, String) = connection
                    .query_row(
                        "SELECT thread_name, thread_preview, model_provider, cwd, \
                                thread_source, agent_nickname, agent_role \
                         FROM codex_threads WHERE thread_id = ?1",
                        ["019b7e12-5c00-7000-8000-000000005703"],
                        |row| {
                            Ok((
                                row.get(0)?,
                                row.get(1)?,
                                row.get(2)?,
                                row.get(3)?,
                                row.get(4)?,
                                row.get(5)?,
                                row.get(6)?,
                            ))
                        },
                    )
                    .expect("migrated early-v57 Thread");
                assert_eq!(
                    thread,
                    (
                        "Early v57 thread".to_owned(),
                        "Synthetic preview".to_owned(),
                        "openai".to_owned(),
                        "/tmp/nodex-v57-fixture".to_owned(),
                        "appServer".to_owned(),
                        "fixture-agent".to_owned(),
                        "test".to_owned(),
                    )
                );
                let foreign_page_grants: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM project_resource_grants \
                         WHERE project_id = ?1 AND root_kind = 'page' AND root_id = ?2 \
                           AND access = 'read' AND lifecycle = 'active'",
                        [
                            "019b7e12-5c00-7000-8000-000000000057",
                            "019b7e12-5c00-7000-8000-000000005710",
                        ],
                        |row| row.get(0),
                    )
                    .expect("migrated cross-Project Page grant");
                assert_eq!(foreign_page_grants, 1);
                let unresolved_reference: (String, String, String) = connection
                    .query_row(
                        "SELECT project_id, type, lifecycle FROM blocks WHERE id = ?1",
                        ["019b7e12-5c00-7000-8000-000000005711"],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .expect("migrated unresolved Page reference");
                assert_eq!(
                    unresolved_reference,
                    (
                        "019b7e12-5c00-7000-8000-000000000057".to_owned(),
                        "unresolved_card_reference".to_owned(),
                        "deleted".to_owned(),
                    )
                );
            }
            drop(connection);

            let backups = backup_directories(&home);
            assert_eq!(backups.len(), 1, "v{version} backup count");
            assert!(backups[0].join(STORE_FILE_NAME).is_file());
            assert_eq!(
                fs::read_to_string(backups[0].join(ASSETS_DIRECTORY_NAME).join("retained.txt"))
                    .expect("backup asset"),
                format!("asset-v{version}")
            );
            assert!(!home.join(JOURNAL_FILE_NAME).exists());

            let reopened = SqliteStoreKernel::open(&home).expect("reopen current Profile");
            assert_eq!(reopened.preparation().schema_version, CORE_SCHEMA_VERSION);
            drop(reopened);
            assert_eq!(backup_directories(&home), backups);
        }
    }

    #[test]
    fn rejects_the_unpublished_v68_lineage_before_creating_a_backup() {
        let directory = tempdir().expect("profile root");
        let home = directory.path().canonicalize().expect("absolute profile");
        let connection = open_writer(&home.join(STORE_FILE_NAME)).expect("legacy writer");
        connection
            .execute_batch(
                "CREATE TABLE projects(id TEXT PRIMARY KEY); \
                 CREATE TABLE cards(id TEXT PRIMARY KEY); \
                 PRAGMA user_version = 68;",
            )
            .expect("unpublished v68");
        drop(connection);

        let error = detect_legacy_source(&home).expect_err("ambiguous v68 rejected");
        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        assert!(!home.join(BACKUP_DIRECTORY_NAME).exists());
    }

    #[test]
    fn rejects_an_unknown_agent_receipt_variant_before_creating_a_backup() {
        let directory = tempdir().expect("profile root");
        let home = directory.path().canonicalize().expect("absolute profile");
        fs::copy(fixture_path(82), home.join(STORE_FILE_NAME)).expect("legacy fixture");
        let connection = open_writer(&home.join(STORE_FILE_NAME)).expect("legacy writer");
        connection
            .execute_batch(
                "ALTER TABLE nodex_agent_call_receipts ADD COLUMN unexpected_extension TEXT;",
            )
            .expect("receipt schema drift");
        drop(connection);

        let error = detect_legacy_source(&home).expect_err("receipt drift rejected");
        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        assert!(!home.join(BACKUP_DIRECTORY_NAME).exists());
    }

    #[test]
    fn accepts_the_published_rebuilt_agent_receipt_variant() {
        let directory = tempdir().expect("profile root");
        let home = directory.path().canonicalize().expect("absolute profile");
        fs::copy(fixture_path(82), home.join(STORE_FILE_NAME)).expect("legacy fixture");
        let connection = open_writer(&home.join(STORE_FILE_NAME)).expect("legacy writer");
        let table_sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE name = 'nodex_agent_call_receipts'",
                [],
                |row| row.get(0),
            )
            .expect("receipt schema");
        let rebuilt_sql = table_sql.replacen(
            "CHECK (turn_id IS NULL OR length(trim(turn_id)) BETWEEN 1 AND 512),",
            "",
            1,
        );
        assert_ne!(rebuilt_sql, table_sql);
        connection
            .execute_batch("PRAGMA writable_schema = ON")
            .expect("enable test schema rewrite");
        connection
            .execute(
                "UPDATE sqlite_schema SET sql = ?1 WHERE name = 'nodex_agent_call_receipts'",
                [rebuilt_sql],
            )
            .expect("emulate published rebuild");
        connection
            .execute_batch("PRAGMA writable_schema = OFF")
            .expect("disable test schema rewrite");
        drop(connection);

        let source = detect_legacy_source(&home)
            .expect("classify rebuilt variant")
            .expect("published source");
        assert_eq!(source.version, 82);
    }

    #[test]
    fn rejects_a_symlinked_backup_ancestor_without_touching_the_source() {
        let directory = tempdir().expect("profile root");
        let external = tempdir().expect("external backup target");
        let home = directory.path().canonicalize().expect("absolute profile");
        fs::copy(fixture_path(82), home.join(STORE_FILE_NAME)).expect("legacy fixture");
        symlink(external.path(), home.join("backups")).expect("symlinked backup root");
        let source = detect_legacy_source(&home)
            .expect("classify source")
            .expect("legacy source");

        let error = migrate_legacy_source(&home, source, &migrator_command())
            .expect_err("symlinked backup ancestry rejected");

        assert_eq!(error.code, StoreErrorCode::InvalidProfile);
        assert!(home.join(STORE_FILE_NAME).is_file());
        assert_eq!(
            fs::read_dir(external.path())
                .expect("external target")
                .count(),
            0
        );
    }

    #[test]
    fn interrupted_install_restores_the_legacy_database_and_assets() {
        let directory = tempdir().expect("profile root");
        let home = directory.path().canonicalize().expect("absolute profile");
        let backup_root = prepare_backup_root(&home).expect("backup root");
        let staging_name = ".legacy-stage-recovery";
        let rollback_name = ".legacy-rollback-recovery";
        let backup_name = "v82-to-v86-recovery";
        let staging = create_owned_directory(&backup_root, staging_name).expect("staging");
        let rollback = create_owned_directory(&backup_root, rollback_name).expect("rollback");
        create_owned_directory(&backup_root, backup_name).expect("backup");
        fs::copy(fixture_path(82), rollback.join(STORE_FILE_NAME)).expect("rollback database");
        fs::create_dir(rollback.join(ASSETS_DIRECTORY_NAME)).expect("rollback assets");
        fs::write(
            rollback.join(ASSETS_DIRECTORY_NAME).join("source.txt"),
            "source",
        )
        .expect("source asset");

        let candidate_home = tempdir().expect("candidate profile");
        let candidate_path = candidate_home
            .path()
            .canonicalize()
            .expect("candidate home");
        let candidate = SqliteStoreKernel::open(&candidate_path).expect("fresh candidate");
        drop(candidate);
        fs::copy(
            candidate_path.join(STORE_FILE_NAME),
            home.join(STORE_FILE_NAME),
        )
        .expect("installed candidate");
        fs::create_dir(home.join(ASSETS_DIRECTORY_NAME)).expect("candidate assets");
        fs::write(
            home.join(ASSETS_DIRECTORY_NAME).join("candidate.txt"),
            "candidate",
        )
        .expect("candidate asset");
        let journal = LegacyImportJournal {
            version: JOURNAL_VERSION,
            source_version: 82,
            source_database_file_name: STORE_FILE_NAME.to_owned(),
            backup_directory_name: backup_name.to_owned(),
            staging_directory_name: staging_name.to_owned(),
            rollback_directory_name: rollback_name.to_owned(),
            phase: LegacyImportPhase::Installed,
            had_assets: true,
            had_wal: false,
            had_shm: false,
        };
        write_journal(&home, &journal).expect("journal");

        recover_interrupted_legacy_import(&home).expect("startup recovery");
        assert_eq!(
            fs::read(home.join(STORE_FILE_NAME)).expect("preserved database"),
            fs::read(fixture_path(82)).expect("fixture database")
        );
        assert_eq!(
            fs::read_to_string(home.join(ASSETS_DIRECTORY_NAME).join("source.txt"))
                .expect("restored asset"),
            "source"
        );
        assert!(!home.join(JOURNAL_FILE_NAME).exists());
        assert!(!staging.exists());
        assert!(!rollback.exists());
    }

    #[test]
    fn recovery_before_the_first_move_preserves_live_companion_files() {
        let directory = tempdir().expect("profile root");
        let home = directory.path().canonicalize().expect("absolute profile");
        let backup_root = prepare_backup_root(&home).expect("backup root");
        let staging_name = ".legacy-stage-before-move";
        let rollback_name = ".legacy-rollback-before-move";
        let backup_name = "v82-to-v86-before-move";
        create_owned_directory(&backup_root, staging_name).expect("staging");
        create_owned_directory(&backup_root, rollback_name).expect("rollback");
        create_owned_directory(&backup_root, backup_name).expect("backup");
        fs::copy(fixture_path(82), home.join(STORE_FILE_NAME)).expect("legacy database");
        fs::write(
            home.join(format!("{STORE_FILE_NAME}{WAL_SUFFIX}")),
            "source wal",
        )
        .expect("source wal");
        fs::write(
            home.join(format!("{STORE_FILE_NAME}{SHM_SUFFIX}")),
            "source shm",
        )
        .expect("source shm");
        fs::create_dir(home.join(ASSETS_DIRECTORY_NAME)).expect("source assets");
        fs::write(
            home.join(ASSETS_DIRECTORY_NAME).join("source.txt"),
            "source asset",
        )
        .expect("source asset");
        let journal = LegacyImportJournal {
            version: JOURNAL_VERSION,
            source_version: 82,
            source_database_file_name: STORE_FILE_NAME.to_owned(),
            backup_directory_name: backup_name.to_owned(),
            staging_directory_name: staging_name.to_owned(),
            rollback_directory_name: rollback_name.to_owned(),
            phase: LegacyImportPhase::RollbackStarted,
            had_assets: true,
            had_wal: true,
            had_shm: true,
        };
        write_journal(&home, &journal).expect("journal");

        recover_interrupted_legacy_import(&home).expect("startup recovery");

        assert_eq!(
            fs::read(home.join(STORE_FILE_NAME)).expect("preserved database"),
            fs::read(fixture_path(82)).expect("fixture database")
        );
        assert_eq!(
            fs::read_to_string(home.join(format!("{STORE_FILE_NAME}{WAL_SUFFIX}")))
                .expect("preserved wal"),
            "source wal"
        );
        assert_eq!(
            fs::read_to_string(home.join(format!("{STORE_FILE_NAME}{SHM_SUFFIX}")))
                .expect("preserved shm"),
            "source shm"
        );
        assert_eq!(
            fs::read_to_string(home.join(ASSETS_DIRECTORY_NAME).join("source.txt"))
                .expect("preserved asset"),
            "source asset"
        );
        assert!(!home.join(JOURNAL_FILE_NAME).exists());
    }

    #[test]
    fn failed_sidecar_keeps_the_source_and_removes_its_staging_directory() {
        let directory = tempdir().expect("profile root");
        let home = directory.path().canonicalize().expect("absolute profile");
        fs::copy(fixture_path(82), home.join(STORE_FILE_NAME)).expect("legacy fixture");
        let source = detect_legacy_source(&home)
            .expect("classify source")
            .expect("legacy source");
        let migrator = LegacyMigratorCommand {
            executable: PathBuf::from("/usr/bin/false"),
            script: fixture_path(82),
        };

        let error = migrate_legacy_source(&home, source, &migrator)
            .expect_err("failed sidecar must abort import");
        assert_eq!(error.code, StoreErrorCode::UnsupportedSchema);
        let connection = open_writer(&home.join(STORE_FILE_NAME)).expect("source remains");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("source version");
        assert_eq!(version, 82);
        assert!(!home.join(JOURNAL_FILE_NAME).exists());
        let backup_entries = fs::read_dir(home.join(BACKUP_DIRECTORY_NAME))
            .expect("backup root")
            .map(|entry| entry.expect("backup entry").file_name())
            .collect::<Vec<_>>();
        assert_eq!(backup_entries.len(), 1);
        assert!(
            backup_entries[0]
                .to_string_lossy()
                .starts_with(&format!("v82-to-v{CORE_SCHEMA_VERSION}-"))
        );
    }
}
