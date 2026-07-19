use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use nodex_core_contracts::administration::BackupRecord;
use rusqlite::{Connection, MAIN_DB, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::infrastructure::schema::CORE_SCHEMA_VERSION;
use crate::infrastructure::sqlite::{
    StoreError, StoreErrorCode, open_immutable_reader, validate_store,
};

const BACKUP_MANIFEST_VERSION: u32 = 2;
const BACKUP_DATABASE_FILE_NAME: &str = "nodex.db";
const BACKUP_ASSETS_DIRECTORY_NAME: &str = "assets";
const BACKUP_MANIFEST_FILE_NAME: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    #[serde(default = "manifest_version")]
    version: u32,
    id: String,
    created_at: String,
    trigger: String,
    label: Option<String>,
    #[serde(default)]
    includes_assets: bool,
    #[serde(default)]
    db_bytes: u64,
    #[serde(default)]
    assets_bytes: u64,
    #[serde(default)]
    total_bytes: u64,
    store_schema_version: Option<u32>,
    store_epoch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    core_operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    core_request_hash: Option<String>,
}

pub(super) fn list_backups(profile_home: &Path) -> Result<Vec<BackupRecord>, StoreError> {
    let root = profile_home.join("backups");
    let Some(entries) = read_backup_root(&root)? else {
        return Ok(Vec::new());
    };
    let mut backups = Vec::new();
    for entry in entries {
        let file_type = entry.file_type().map_err(io_error)?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !file_type.is_dir() || name.starts_with('.') || !is_safe_backup_id(&name) {
            continue;
        }
        let directory = entry.path();
        let Ok(manifest) = read_manifest(&directory) else {
            continue;
        };
        if manifest.id != name || validate_manifest(&manifest).is_err() {
            continue;
        }
        backups.push(to_record(&manifest));
    }
    backups.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.backup_id.cmp(&left.backup_id))
    });
    Ok(backups)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn create_backup(
    connection: &Connection,
    profile_home: &Path,
    profile_id: &str,
    operation_id: &str,
    request_hash: &str,
    label: Option<&str>,
    include_assets: bool,
) -> Result<BackupRecord, StoreError> {
    let root = prepare_backup_root(profile_home)?;
    let backup_id = backup_id(profile_id, operation_id);
    let final_directory = root.join(&backup_id);
    let staging_directory = root.join(format!(".{backup_id}.tmp"));

    if final_directory.exists() {
        return adopt_published_backup(&final_directory, operation_id, request_hash, &backup_id);
    }
    recover_staging_backup(
        &root,
        &staging_directory,
        &final_directory,
        operation_id,
        request_hash,
        &backup_id,
    )?;
    if final_directory.exists() {
        return adopt_published_backup(&final_directory, operation_id, request_hash, &backup_id);
    }

    fs::create_dir(&staging_directory).map_err(io_error)?;
    let result = stage_backup(
        connection,
        profile_home,
        &staging_directory,
        &backup_id,
        operation_id,
        request_hash,
        label,
        include_assets,
    );
    let record = match result {
        Ok(record) => record,
        Err(error) => {
            remove_owned_staging_directory(&root, &staging_directory)?;
            return Err(error);
        }
    };
    fs::rename(&staging_directory, &final_directory).map_err(io_error)?;
    sync_directory(&root)?;
    Ok(record)
}

#[allow(clippy::too_many_arguments)]
fn stage_backup(
    connection: &Connection,
    profile_home: &Path,
    staging_directory: &Path,
    backup_id: &str,
    operation_id: &str,
    request_hash: &str,
    label: Option<&str>,
    include_assets: bool,
) -> Result<BackupRecord, StoreError> {
    let database_path = staging_directory.join(BACKUP_DATABASE_FILE_NAME);
    connection.backup(MAIN_DB, &database_path, None)?;
    sync_file(&database_path)?;

    let assets_bytes = if include_assets {
        let destination = staging_directory.join(BACKUP_ASSETS_DIRECTORY_NAME);
        copy_assets(
            &profile_home.join(BACKUP_ASSETS_DIRECTORY_NAME),
            &destination,
        )?
    } else {
        0
    };
    let (store_schema_version, store_epoch) = validate_backup_database(&database_path)?;
    let db_bytes = regular_file_length(&database_path)?;
    let created_at =
        connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })?;
    let manifest = BackupManifest {
        version: BACKUP_MANIFEST_VERSION,
        id: backup_id.to_owned(),
        created_at,
        trigger: "manual".to_owned(),
        label: label.map(str::to_owned),
        includes_assets: include_assets,
        db_bytes,
        assets_bytes,
        total_bytes: db_bytes
            .checked_add(assets_bytes)
            .ok_or_else(|| internal("Backup byte length exceeds the supported range"))?,
        store_schema_version: Some(store_schema_version),
        store_epoch: Some(store_epoch),
        core_operation_id: Some(operation_id.to_owned()),
        core_request_hash: Some(request_hash.to_owned()),
    };
    validate_manifest(&manifest)?;
    write_manifest(staging_directory, &manifest)?;
    sync_tree(staging_directory)?;
    Ok(to_record(&manifest))
}

fn adopt_published_backup(
    directory: &Path,
    operation_id: &str,
    request_hash: &str,
    expected_backup_id: &str,
) -> Result<BackupRecord, StoreError> {
    require_directory(directory, "Published backup")?;
    let manifest = read_manifest(directory)?;
    validate_manifest(&manifest)?;
    if manifest.id != expected_backup_id
        || manifest.core_operation_id.as_deref() != Some(operation_id)
        || manifest.core_request_hash.as_deref() != Some(request_hash)
    {
        return Err(StoreError::new(
            StoreErrorCode::IdempotencyKeyReused,
            "Backup identity is already bound to another Store Administration request",
            false,
        ));
    }
    let database_path = directory.join(BACKUP_DATABASE_FILE_NAME);
    let (schema_version, store_epoch) = validate_backup_database(&database_path)?;
    if manifest.store_schema_version != Some(schema_version)
        || manifest.store_epoch.as_deref() != Some(store_epoch.as_str())
        || manifest.db_bytes != regular_file_length(&database_path)?
    {
        return Err(corrupt(
            "Published backup manifest does not match its database",
        ));
    }
    let asset_bytes = if manifest.includes_assets {
        inspect_assets(&directory.join(BACKUP_ASSETS_DIRECTORY_NAME))?
    } else {
        0
    };
    if manifest.assets_bytes != asset_bytes
        || manifest.total_bytes != manifest.db_bytes.saturating_add(asset_bytes)
    {
        return Err(corrupt("Published backup manifest byte counts are invalid"));
    }
    Ok(to_record(&manifest))
}

#[allow(clippy::too_many_arguments)]
fn recover_staging_backup(
    root: &Path,
    staging_directory: &Path,
    final_directory: &Path,
    operation_id: &str,
    request_hash: &str,
    expected_backup_id: &str,
) -> Result<(), StoreError> {
    if !staging_directory.exists() {
        return Ok(());
    }
    require_directory(staging_directory, "Staged backup")?;
    let manifest_path = staging_directory.join(BACKUP_MANIFEST_FILE_NAME);
    if !manifest_path.exists() {
        return remove_owned_staging_directory(root, staging_directory);
    }
    adopt_published_backup(
        staging_directory,
        operation_id,
        request_hash,
        expected_backup_id,
    )?;
    fs::rename(staging_directory, final_directory).map_err(io_error)?;
    sync_directory(root)
}

fn read_backup_root(root: &Path) -> Result<Option<Vec<fs::DirEntry>>, StoreError> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_profile(
            "Backup root must be a real directory owned by the Profile",
        ));
    }
    let entries = fs::read_dir(root)
        .map_err(io_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_error)?;
    Ok(Some(entries))
}

fn prepare_backup_root(profile_home: &Path) -> Result<PathBuf, StoreError> {
    let root = profile_home.join("backups");
    if read_backup_root(&root)?.is_none() {
        fs::create_dir(&root).map_err(io_error)?;
        sync_directory(profile_home)?;
    }
    require_directory(&root, "Backup root")?;
    Ok(root)
}

fn copy_assets(source: &Path, destination: &Path) -> Result<u64, StoreError> {
    let metadata = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(destination).map_err(io_error)?;
            sync_directory(destination)?;
            return Ok(0);
        }
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_profile(
            "Managed assets root must be a real directory",
        ));
    }
    fs::create_dir(destination).map_err(io_error)?;
    copy_directory(source, destination)
}

fn copy_directory(source: &Path, destination: &Path) -> Result<u64, StoreError> {
    let mut entries = fs::read_dir(source)
        .map_err(io_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_error)?;
    entries.sort_by_key(fs::DirEntry::file_name);
    let mut total = 0u64;
    for entry in entries {
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err(invalid_profile(
                "Managed assets must not contain symbolic links",
            ));
        }
        if metadata.is_dir() {
            fs::create_dir(&destination_path).map_err(io_error)?;
            total = total
                .checked_add(copy_directory(&source_path, &destination_path)?)
                .ok_or_else(|| internal("Managed asset byte length exceeds its bound"))?;
            sync_directory(&destination_path)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(invalid_profile(
                "Managed assets may contain only regular files and directories",
            ));
        }
        fs::copy(&source_path, &destination_path).map_err(io_error)?;
        sync_file(&destination_path)?;
        total = total
            .checked_add(metadata.len())
            .ok_or_else(|| internal("Managed asset byte length exceeds its bound"))?;
    }
    Ok(total)
}

fn inspect_assets(root: &Path) -> Result<u64, StoreError> {
    require_directory(root, "Backup assets")?;
    inspect_directory(root)
}

fn inspect_directory(root: &Path) -> Result<u64, StoreError> {
    let mut total = 0u64;
    for entry in fs::read_dir(root).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err(corrupt("Backup assets contain a symbolic link"));
        }
        let length = if metadata.is_dir() {
            inspect_directory(&entry.path())?
        } else if metadata.is_file() {
            metadata.len()
        } else {
            return Err(corrupt("Backup assets contain a non-file filesystem entry"));
        };
        total = total
            .checked_add(length)
            .ok_or_else(|| corrupt("Backup asset byte length exceeds its bound"))?;
    }
    Ok(total)
}

fn validate_backup_database(path: &Path) -> Result<(u32, String), StoreError> {
    let connection = open_immutable_reader(path)?;
    validate_store(&connection)?;
    let schema_version =
        connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
    if schema_version != u32::try_from(CORE_SCHEMA_VERSION).expect("schema version fits u32") {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            format!("Backup uses unsupported store schema v{schema_version}"),
            false,
        ));
    }
    let metadata = connection
        .query_row(
            "SELECT metadata.schema_owner, block.store_epoch \
             FROM core_store_metadata metadata \
             JOIN block_store_metadata block ON block.id = metadata.id \
             WHERE metadata.id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((owner, store_epoch)) = metadata else {
        return Err(corrupt("Backup is missing Rust Core store metadata"));
    };
    if owner != "rust_core" || store_epoch.is_empty() {
        return Err(corrupt("Backup Rust Core metadata is invalid"));
    }
    Ok((schema_version, store_epoch))
}

fn write_manifest(directory: &Path, manifest: &BackupManifest) -> Result<(), StoreError> {
    let mut bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|_| internal("Backup manifest could not be encoded"))?;
    bytes.push(b'\n');
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_MANIFEST_BYTES {
        return Err(internal("Backup manifest exceeds its size bound"));
    }
    let path = directory.join(BACKUP_MANIFEST_FILE_NAME);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_error)?;
    file.write_all(&bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)
}

fn read_manifest(directory: &Path) -> Result<BackupManifest, StoreError> {
    let path = directory.join(BACKUP_MANIFEST_FILE_NAME);
    let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(corrupt("Backup manifest is not a bounded regular file"));
    }
    let bytes = fs::read(path).map_err(io_error)?;
    serde_json::from_slice(&bytes).map_err(|_| corrupt("Backup manifest JSON is invalid"))
}

fn validate_manifest(manifest: &BackupManifest) -> Result<(), StoreError> {
    if manifest.version == 0
        || manifest.version > BACKUP_MANIFEST_VERSION
        || !is_safe_backup_id(&manifest.id)
        || chrono::DateTime::parse_from_rfc3339(&manifest.created_at).is_err()
        || !matches!(manifest.trigger.as_str(), "manual" | "auto" | "pre-restore")
        || manifest
            .label
            .as_ref()
            .is_some_and(|label| label.len() > 4_096)
        || manifest
            .core_operation_id
            .as_ref()
            .is_some_and(|operation_id| operation_id.is_empty() || operation_id.len() > 512)
        || manifest
            .core_request_hash
            .as_ref()
            .is_some_and(|request_hash| !is_sha256(request_hash))
    {
        return Err(corrupt("Backup manifest fields are invalid"));
    }
    Ok(())
}

fn to_record(manifest: &BackupManifest) -> BackupRecord {
    BackupRecord {
        backup_id: manifest.id.clone(),
        label: manifest.label.clone(),
        created_at: manifest.created_at.clone(),
        byte_length: manifest.total_bytes,
    }
}

fn backup_id(profile_id: &str, operation_id: &str) -> String {
    let digest = Sha256::digest(format!(
        "store-administration\0{profile_id}\0{operation_id}"
    ));
    format!("core-{}", hex(&digest))
}

fn manifest_version() -> u32 {
    BACKUP_MANIFEST_VERSION
}

fn is_safe_backup_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn regular_file_length(path: &Path) -> Result<u64, StoreError> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(corrupt("Backup database is not a regular file"));
    }
    Ok(metadata.len())
}

fn require_directory(path: &Path, label: &str) -> Result<(), StoreError> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_profile(format!("{label} must be a real directory")));
    }
    Ok(())
}

fn remove_owned_staging_directory(root: &Path, staging: &Path) -> Result<(), StoreError> {
    if staging.parent() != Some(root)
        || !staging
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(".core-") && name.ends_with(".tmp"))
    {
        return Err(invalid_profile(
            "Backup staging path is outside its owner root",
        ));
    }
    let metadata = match fs::symlink_metadata(staging) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_profile(
            "Backup staging path is not an owned directory",
        ));
    }
    fs::remove_dir_all(staging).map_err(io_error)?;
    sync_directory(root)
}

fn sync_tree(root: &Path) -> Result<(), StoreError> {
    for entry in fs::read_dir(root).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err(invalid_profile(
                "Backup staging tree must not contain symbolic links",
            ));
        }
        if metadata.is_dir() {
            sync_tree(&entry.path())?;
        } else if metadata.is_file() {
            sync_file(&entry.path())?;
        } else {
            return Err(invalid_profile(
                "Backup staging tree contains an unsupported entry",
            ));
        }
    }
    sync_directory(root)
}

fn sync_file(path: &Path) -> Result<(), StoreError> {
    File::open(path)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)
}

fn sync_directory(path: &Path) -> Result<(), StoreError> {
    File::open(path)
        .map_err(io_error)?
        .sync_all()
        .map_err(io_error)
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
    StoreError::new(
        StoreErrorCode::Internal,
        format!("Backup filesystem operation failed: {error}"),
        false,
    )
}
