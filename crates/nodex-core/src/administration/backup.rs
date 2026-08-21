use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use nodex_core_contracts::administration::{BackupRecord, BackupTrigger};
use rusqlite::{Connection, MAIN_DB, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::infrastructure::schema::CURRENT_STORE_REVISION;
use crate::infrastructure::sqlite::{
    StoreError, StoreErrorCode, open_immutable_reader, validate_store,
};
use crate::infrastructure::store_validation::{
    validate_codex_thread_timestamp_invariants, validate_database_priority_invariants,
};

const BACKUP_MANIFEST_VERSION: u32 = 3;
const BACKUP_INTEGRITY_EVIDENCE_VERSION: u32 = 1;
const BACKUP_DATABASE_FILE_NAME: &str = "nodex.db";
const BACKUP_ASSETS_DIRECTORY_NAME: &str = "assets";
const BACKUP_MANIFEST_FILE_NAME: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_BACKUP_ENTRIES: usize = 10_000;
const MAX_BACKUP_TREE_ENTRIES: usize = 100_000;
const DIGEST_BUFFER_BYTES: usize = 1024 * 1024;
const ASSET_TREE_DIGEST_DOMAIN: &[u8] = b"nodex-backup-asset-tree-v1\0";

pub(super) struct BackupInventoryItem {
    pub record: BackupRecord,
    pub trigger: String,
}

pub(super) struct ValidatedRestoreBackup {
    directory: PathBuf,
    manifest: BackupManifest,
}

pub(super) struct EvidenceBackedProfileClone {
    directory: PathBuf,
    manifest: BackupManifest,
}

impl EvidenceBackedProfileClone {
    pub(super) fn backup_id(&self) -> &str {
        &self.manifest.id
    }

    pub(super) fn created_at(&self) -> &str {
        &self.manifest.created_at
    }

    pub(super) fn store_schema_version(&self) -> u32 {
        self.manifest
            .store_schema_version
            .expect("evidence-backed backups have a schema version")
    }

    pub(super) fn store_epoch(&self) -> &str {
        self.manifest
            .store_epoch
            .as_deref()
            .expect("evidence-backed backups have a Store epoch")
    }

    pub(super) fn integrity_evidence_version(&self) -> u32 {
        self.manifest
            .integrity_evidence
            .as_ref()
            .expect("evidence-backed Profile clone has integrity evidence")
            .version
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupIntegrityEvidence {
    version: u32,
    database_sha256: String,
    asset_tree_sha256: String,
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    integrity_evidence: Option<BackupIntegrityEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    core_operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    core_request_hash: Option<String>,
}

pub(super) fn list_backups(profile_home: &Path) -> Result<Vec<BackupRecord>, StoreError> {
    Ok(list_backup_inventory(profile_home)?
        .into_iter()
        .map(|item| item.record)
        .collect())
}

pub(super) fn list_backup_inventory(
    profile_home: &Path,
) -> Result<Vec<BackupInventoryItem>, StoreError> {
    let root = profile_home.join("backups");
    let Some(entries) = read_backup_root(&root)? else {
        return Ok(Vec::new());
    };
    if entries.len() > MAX_BACKUP_ENTRIES {
        return Err(corrupt("Backup inventory exceeds its entry bound"));
    }
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
        backups.push(BackupInventoryItem {
            record: to_record(&manifest),
            trigger: manifest.trigger,
        });
    }
    backups.sort_by(|left, right| {
        right
            .record
            .created_at
            .cmp(&left.record.created_at)
            .then_with(|| right.record.backup_id.cmp(&left.record.backup_id))
    });
    Ok(backups)
}

pub(super) fn validate_backup_for_deletion(
    profile_home: &Path,
    backup_id: &str,
) -> Result<(), StoreError> {
    if !is_safe_backup_id(backup_id) {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Backup identity is invalid",
            false,
        ));
    }
    let root = profile_home.join("backups");
    require_directory(&root, "Backup root")?;
    let directory = root.join(backup_id);
    let metadata = match fs::symlink_metadata(&directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(StoreError::new(
                StoreErrorCode::NotFound,
                "Backup was not found",
                false,
            ));
        }
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_profile(
            "Backup deletion target must be a real owned directory",
        ));
    }
    let mut inspected = 0usize;
    inspect_removable_tree(&directory, &mut inspected)
}

pub(super) fn publish_backup_deletions(
    profile_home: &Path,
    operation_id: &str,
    backup_ids: &[String],
) -> Result<(), StoreError> {
    if backup_ids.is_empty() {
        return Ok(());
    }
    let cleanup = stage_backup_deletions(profile_home, operation_id, backup_ids)?;
    let root = profile_home.join("backups");
    let mut inspected = 0usize;
    inspect_removable_tree(&cleanup, &mut inspected)?;
    fs::remove_dir_all(&cleanup).map_err(io_error)?;
    sync_directory(&root)
}

pub(super) fn stage_backup_deletions(
    profile_home: &Path,
    operation_id: &str,
    backup_ids: &[String],
) -> Result<PathBuf, StoreError> {
    if backup_ids.is_empty() {
        return Err(internal("Empty backup cleanup has no staging phase"));
    }
    let root = profile_home.join("backups");
    require_directory(&root, "Backup root")?;
    let cleanup_digest = Sha256::digest(format!("backup-cleanup\0{operation_id}"));
    let cleanup = root.join(format!(".cleanup-{}", hex(&cleanup_digest)));
    match fs::symlink_metadata(&cleanup) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(invalid_profile(
                "Backup cleanup staging path must be a real owned directory",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&cleanup).map_err(io_error)?;
            sync_directory(&root)?;
        }
        Err(error) => return Err(io_error(error)),
    }
    for backup_id in backup_ids {
        if !is_safe_backup_id(backup_id) {
            return Err(corrupt("Durable backup deletion identity is invalid"));
        }
        let directory = root.join(backup_id);
        let staged = cleanup.join(backup_id);
        let metadata = match fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::symlink_metadata(&staged) {
                    Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                        return Err(invalid_profile(
                            "Backup cleanup target must remain a real owned directory",
                        ));
                    }
                    Ok(_) => continue,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(io_error(error)),
                }
            }
            Err(error) => return Err(io_error(error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(invalid_profile(
                "Backup deletion target must remain a real owned directory",
            ));
        }
        let mut inspected = 0usize;
        inspect_removable_tree(&directory, &mut inspected)?;
        if staged.exists() {
            return Err(corrupt(
                "Backup cleanup found duplicate published and staged directories",
            ));
        }
        fs::rename(&directory, &staged).map_err(io_error)?;
        sync_directory(&root)?;
    }
    Ok(cleanup)
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
    trigger: BackupTrigger,
) -> Result<BackupRecord, StoreError> {
    let trigger = match trigger {
        BackupTrigger::Manual => "manual",
        BackupTrigger::Auto => "auto",
        BackupTrigger::PreRestore => "pre-restore",
    };
    stage_backup_with_trigger(
        connection,
        profile_home,
        profile_id,
        operation_id,
        request_hash,
        label,
        include_assets,
        trigger,
    )
}

pub(super) fn create_safety_backup(
    connection: &Connection,
    profile_home: &Path,
    profile_id: &str,
    restore_operation_id: &str,
    request_hash: &str,
    restored_backup_id: &str,
) -> Result<BackupRecord, StoreError> {
    let role_digest = Sha256::digest(format!("pre-restore\0{restore_operation_id}"));
    let operation_id = format!("pre-restore-{}", hex(&role_digest));
    let label = format!("Before restoring {restored_backup_id}");
    let record = stage_backup_with_trigger(
        connection,
        profile_home,
        profile_id,
        &operation_id,
        request_hash,
        Some(&label),
        true,
        "pre-restore",
    )?;
    publish_backup(profile_home, &operation_id, request_hash, &record.backup_id)?;
    Ok(record)
}

#[allow(clippy::too_many_arguments)]
fn stage_backup_with_trigger(
    connection: &Connection,
    profile_home: &Path,
    profile_id: &str,
    operation_id: &str,
    request_hash: &str,
    label: Option<&str>,
    include_assets: bool,
    trigger: &str,
) -> Result<BackupRecord, StoreError> {
    let root = prepare_backup_root(profile_home)?;
    let backup_id = backup_id(profile_id, operation_id);
    let final_directory = root.join(&backup_id);
    let staging_directory = root.join(format!(".{backup_id}.tmp"));

    if final_directory.exists() {
        return adopt_published_backup(&final_directory, operation_id, request_hash, &backup_id);
    }
    if let Some(record) = recover_staging_backup(
        &root,
        &staging_directory,
        operation_id,
        request_hash,
        &backup_id,
    )? {
        return Ok(record);
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
        trigger,
    );
    let record = match result {
        Ok(record) => record,
        Err(error) => {
            remove_owned_staging_directory(&root, &staging_directory)?;
            return Err(error);
        }
    };
    Ok(record)
}

pub(super) fn publish_backup(
    profile_home: &Path,
    operation_id: &str,
    request_hash: &str,
    backup_id: &str,
) -> Result<BackupRecord, StoreError> {
    if !is_safe_backup_id(backup_id) {
        return Err(corrupt("Backup publication identity is invalid"));
    }
    let root = prepare_backup_root(profile_home)?;
    let final_directory = root.join(backup_id);
    let staging_directory = root.join(format!(".{backup_id}.tmp"));
    if final_directory.exists() {
        let record =
            adopt_published_backup(&final_directory, operation_id, request_hash, backup_id)?;
        if staging_directory.exists() {
            adopt_published_backup(&staging_directory, operation_id, request_hash, backup_id)?;
            remove_owned_staging_directory(&root, &staging_directory)?;
        }
        return Ok(record);
    }
    let record = adopt_published_backup(&staging_directory, operation_id, request_hash, backup_id)?;
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
    trigger: &str,
) -> Result<BackupRecord, StoreError> {
    let database_path = staging_directory.join(BACKUP_DATABASE_FILE_NAME);
    connection.backup(MAIN_DB, &database_path, None)?;
    sync_file(&database_path)?;

    let assets_directory = staging_directory.join(BACKUP_ASSETS_DIRECTORY_NAME);
    let assets_bytes = if include_assets {
        copy_assets(
            &profile_home.join(BACKUP_ASSETS_DIRECTORY_NAME),
            &assets_directory,
            CopyDurability::Durable,
        )?
    } else {
        0
    };
    let (store_schema_version, store_epoch) = validate_backup_database(&database_path)?;
    let db_bytes = regular_file_length(&database_path)?;
    let database_sha256 = sha256_regular_file(&database_path)?;
    let (digested_asset_bytes, asset_tree_sha256) = if include_assets {
        digest_asset_tree(&assets_directory)?
    } else {
        (0, empty_asset_tree_sha256())
    };
    if digested_asset_bytes != assets_bytes {
        return Err(corrupt(
            "Backup asset tree changed while integrity evidence was created",
        ));
    }
    let created_at =
        connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })?;
    let manifest = BackupManifest {
        version: BACKUP_MANIFEST_VERSION,
        id: backup_id.to_owned(),
        created_at,
        trigger: trigger.to_owned(),
        label: label.map(str::to_owned),
        includes_assets: include_assets,
        db_bytes,
        assets_bytes,
        total_bytes: db_bytes
            .checked_add(assets_bytes)
            .ok_or_else(|| internal("Backup byte length exceeds the supported range"))?,
        store_schema_version: Some(store_schema_version),
        store_epoch: Some(store_epoch),
        integrity_evidence: Some(BackupIntegrityEvidence {
            version: BACKUP_INTEGRITY_EVIDENCE_VERSION,
            database_sha256,
            asset_tree_sha256,
        }),
        core_operation_id: Some(operation_id.to_owned()),
        core_request_hash: Some(request_hash.to_owned()),
    };
    validate_manifest(&manifest)?;
    write_manifest(staging_directory, &manifest)?;
    // The database, manifest, asset files, and nested asset directories were
    // already synced by their writers; persist only the staging entries here.
    sync_directory(staging_directory)?;
    Ok(to_record(&manifest))
}

fn adopt_published_backup(
    directory: &Path,
    operation_id: &str,
    request_hash: &str,
    expected_backup_id: &str,
) -> Result<BackupRecord, StoreError> {
    let manifest = validate_published_backup(directory, expected_backup_id)?;
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
    Ok(to_record(&manifest))
}

pub(super) fn resolve_backup_for_restore(
    profile_home: &Path,
    backup_id: &str,
) -> Result<ValidatedRestoreBackup, StoreError> {
    if !is_safe_backup_id(backup_id) {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Restore backup identity is invalid",
            false,
        ));
    }
    let root = profile_home.join("backups");
    require_directory(&root, "Backup root")?;
    let directory = root.join(backup_id);
    if !directory.exists() {
        return Err(StoreError::new(
            StoreErrorCode::NotFound,
            "Restore backup was not found",
            false,
        ));
    }
    let manifest = validate_published_backup(&directory, backup_id)?;
    Ok(ValidatedRestoreBackup {
        directory,
        manifest,
    })
}

pub(super) fn resolve_backup_for_profile_clone(
    profile_home: &Path,
    backup_id: Option<&str>,
) -> Result<EvidenceBackedProfileClone, StoreError> {
    let selected = match backup_id {
        Some(backup_id) => backup_id.to_owned(),
        None => list_backup_inventory(profile_home)?
            .into_iter()
            .find(|item| {
                item.record.includes_assets && item.record.version == BACKUP_MANIFEST_VERSION
            })
            .map(|item| item.record.backup_id)
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::NotFound,
                    "Profile has no current evidence-backed backup to clone; create a new backup",
                    false,
                )
            })?,
    };
    validate_evidence_backed_profile_clone(profile_home, &selected)
}

fn validate_evidence_backed_profile_clone(
    profile_home: &Path,
    backup_id: &str,
) -> Result<EvidenceBackedProfileClone, StoreError> {
    if !is_safe_backup_id(backup_id) {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Profile clone backup identity is invalid",
            false,
        ));
    }
    let root = profile_home.join("backups");
    require_directory(&root, "Backup root")?;
    let directory = root.join(backup_id);
    if !directory.exists() {
        return Err(StoreError::new(
            StoreErrorCode::NotFound,
            "Profile clone backup was not found",
            false,
        ));
    }
    require_directory(&directory, "Published backup")?;
    let manifest = read_manifest(&directory)?;
    validate_manifest(&manifest)?;
    if manifest.id != backup_id {
        return Err(corrupt(
            "Published backup manifest identity does not match its directory",
        ));
    }
    if manifest.version != BACKUP_MANIFEST_VERSION || manifest.integrity_evidence.is_none() {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Profile clone requires a current evidence-backed backup; create a new backup",
            false,
        ));
    }
    let database_path = directory.join(BACKUP_DATABASE_FILE_NAME);
    if manifest.db_bytes != regular_file_length(&database_path)? {
        return Err(corrupt(
            "Published backup manifest does not match its database length",
        ));
    }
    let assets_directory = directory.join(BACKUP_ASSETS_DIRECTORY_NAME);
    let asset_bytes = if manifest.includes_assets {
        inspect_assets(&assets_directory)?
    } else {
        0
    };
    if manifest.assets_bytes != asset_bytes
        || manifest.total_bytes != manifest.db_bytes.saturating_add(asset_bytes)
    {
        return Err(corrupt("Published backup manifest byte counts are invalid"));
    }
    Ok(EvidenceBackedProfileClone {
        directory,
        manifest,
    })
}

pub(super) fn copy_backup_to_profile(
    backup: &EvidenceBackedProfileClone,
    profile_home: &Path,
) -> Result<(), StoreError> {
    require_directory(profile_home, "Profile clone staging root")?;
    let database = profile_home.join(BACKUP_DATABASE_FILE_NAME);
    let database_bytes = clone_or_copy_file(
        &backup.directory.join(BACKUP_DATABASE_FILE_NAME),
        &database,
        CopyDurability::Rebuildable,
    )?;

    let assets = profile_home.join(BACKUP_ASSETS_DIRECTORY_NAME);
    let asset_bytes = if backup.manifest.includes_assets {
        copy_assets(
            &backup.directory.join(BACKUP_ASSETS_DIRECTORY_NAME),
            &assets,
            CopyDurability::Rebuildable,
        )?
    } else {
        fs::create_dir(&assets).map_err(io_error)?;
        0
    };
    let evidence = backup
        .manifest
        .integrity_evidence
        .as_ref()
        .expect("evidence-backed Profile clone has integrity evidence");
    let database_sha256 = sha256_regular_file(&database)?;
    let (digested_asset_bytes, asset_tree_sha256) = digest_asset_tree(&assets)?;
    if backup.manifest.db_bytes != database_bytes
        || backup.manifest.assets_bytes != asset_bytes
        || asset_bytes != digested_asset_bytes
        || evidence.database_sha256 != database_sha256
        || evidence.asset_tree_sha256 != asset_tree_sha256
    {
        return Err(corrupt(
            "Profile clone staging files diverge from published integrity evidence",
        ));
    }
    Ok(())
}

pub(super) fn stage_restore_candidate(
    profile_home: &Path,
    backup: &ValidatedRestoreBackup,
    staging_directory_name: &str,
) -> Result<String, StoreError> {
    validate_restore_staging_name(staging_directory_name)?;
    let root = profile_home.join("backups");
    require_directory(&root, "Backup root")?;
    let staging = root.join(staging_directory_name);
    remove_owned_restore_staging(&root, &staging)?;
    fs::create_dir(&staging).map_err(io_error)?;
    let result = (|| {
        let database = staging.join(BACKUP_DATABASE_FILE_NAME);
        clone_or_copy_file(
            &backup.directory.join(BACKUP_DATABASE_FILE_NAME),
            &database,
            CopyDurability::Durable,
        )?;
        let assets = staging.join(BACKUP_ASSETS_DIRECTORY_NAME);
        if backup.manifest.includes_assets {
            copy_assets(
                &backup.directory.join(BACKUP_ASSETS_DIRECTORY_NAME),
                &assets,
                CopyDurability::Durable,
            )?;
        } else {
            fs::create_dir(&assets).map_err(io_error)?;
            sync_directory(&assets)?;
        }
        let (schema_version, store_epoch) = validate_backup_database(&database)?;
        if backup.manifest.store_schema_version != Some(schema_version)
            || backup.manifest.store_epoch.as_deref() != Some(store_epoch.as_str())
        {
            return Err(corrupt(
                "Restore staging Store diverges from its backup manifest",
            ));
        }
        sync_tree(&staging)?;
        Ok(store_epoch)
    })();
    match result {
        Ok(store_epoch) => {
            sync_directory(&root)?;
            Ok(store_epoch)
        }
        Err(error) => {
            remove_owned_restore_staging(&root, &staging)?;
            Err(error)
        }
    }
}

fn validate_published_backup(
    directory: &Path,
    expected_backup_id: &str,
) -> Result<BackupManifest, StoreError> {
    require_directory(directory, "Published backup")?;
    let manifest = read_manifest(directory)?;
    validate_manifest(&manifest)?;
    if manifest.id != expected_backup_id {
        return Err(corrupt(
            "Published backup manifest identity does not match its directory",
        ));
    }
    let database_path = directory.join(BACKUP_DATABASE_FILE_NAME);
    let (schema_version, store_epoch) = if manifest.integrity_evidence.is_some() {
        (
            manifest
                .store_schema_version
                .expect("evidence-backed backup has a schema version"),
            manifest
                .store_epoch
                .clone()
                .expect("evidence-backed backup has a Store epoch"),
        )
    } else {
        validate_backup_database(&database_path)?
    };
    if manifest.store_schema_version != Some(schema_version)
        || manifest.store_epoch.as_deref() != Some(store_epoch.as_str())
        || manifest.db_bytes != regular_file_length(&database_path)?
    {
        return Err(corrupt(
            "Published backup manifest does not match its database",
        ));
    }
    let assets_directory = directory.join(BACKUP_ASSETS_DIRECTORY_NAME);
    let asset_bytes = if manifest.includes_assets {
        inspect_assets(&assets_directory)?
    } else {
        0
    };
    if manifest.assets_bytes != asset_bytes
        || manifest.total_bytes != manifest.db_bytes.saturating_add(asset_bytes)
    {
        return Err(corrupt("Published backup manifest byte counts are invalid"));
    }
    if let Some(evidence) = &manifest.integrity_evidence {
        let database_sha256 = sha256_regular_file(&database_path)?;
        let (digested_asset_bytes, asset_tree_sha256) = if manifest.includes_assets {
            digest_asset_tree(&assets_directory)?
        } else {
            (0, empty_asset_tree_sha256())
        };
        if digested_asset_bytes != manifest.assets_bytes
            || database_sha256 != evidence.database_sha256
            || asset_tree_sha256 != evidence.asset_tree_sha256
        {
            return Err(corrupt(
                "Published backup diverges from its integrity evidence",
            ));
        }
    }
    Ok(manifest)
}

#[allow(clippy::too_many_arguments)]
fn recover_staging_backup(
    root: &Path,
    staging_directory: &Path,
    operation_id: &str,
    request_hash: &str,
    expected_backup_id: &str,
) -> Result<Option<BackupRecord>, StoreError> {
    if !staging_directory.exists() {
        return Ok(None);
    }
    require_directory(staging_directory, "Staged backup")?;
    let manifest_path = staging_directory.join(BACKUP_MANIFEST_FILE_NAME);
    if !manifest_path.exists() {
        remove_owned_staging_directory(root, staging_directory)?;
        return Ok(None);
    }
    let record = adopt_published_backup(
        staging_directory,
        operation_id,
        request_hash,
        expected_backup_id,
    )?;
    Ok(Some(record))
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

#[derive(Clone, Copy)]
enum CopyDurability {
    Durable,
    Rebuildable,
}

fn clone_or_copy_file(
    source: &Path,
    destination: &Path,
    durability: CopyDurability,
) -> Result<u64, StoreError> {
    // With the pinned Rust toolchain, std::fs::copy tries fclonefileat first on
    // macOS and falls back to fcopyfile when CoW is unavailable or cross-volume.
    let bytes = fs::copy(source, destination).map_err(io_error)?;
    if matches!(durability, CopyDurability::Durable) {
        sync_file(destination)?;
    }
    Ok(bytes)
}

fn copy_assets(
    source: &Path,
    destination: &Path,
    durability: CopyDurability,
) -> Result<u64, StoreError> {
    let metadata = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(destination).map_err(io_error)?;
            if matches!(durability, CopyDurability::Durable) {
                sync_directory(destination)?;
            }
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
    let bytes = copy_directory(source, destination, durability)?;
    if matches!(durability, CopyDurability::Durable) {
        sync_directory(destination)?;
    }
    Ok(bytes)
}

fn copy_directory(
    source: &Path,
    destination: &Path,
    durability: CopyDurability,
) -> Result<u64, StoreError> {
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
                .checked_add(copy_directory(&source_path, &destination_path, durability)?)
                .ok_or_else(|| internal("Managed asset byte length exceeds its bound"))?;
            if matches!(durability, CopyDurability::Durable) {
                sync_directory(&destination_path)?;
            }
            continue;
        }
        if !metadata.is_file() {
            return Err(invalid_profile(
                "Managed assets may contain only regular files and directories",
            ));
        }
        clone_or_copy_file(&source_path, &destination_path, durability)?;
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

fn sha256_regular_file(path: &Path) -> Result<String, StoreError> {
    let metadata = fs::symlink_metadata(path).map_err(io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(corrupt("Backup integrity evidence requires a regular file"));
    }
    let mut file = File::open(path).map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; DIGEST_BUFFER_BYTES];
    let mut bytes_read = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        bytes_read = bytes_read
            .checked_add(u64::try_from(count).map_err(|_| internal("Digest read is too large"))?)
            .ok_or_else(|| internal("Digest byte length exceeds its bound"))?;
        hasher.update(&buffer[..count]);
    }
    if bytes_read != metadata.len() {
        return Err(corrupt(
            "Backup file changed while integrity evidence was computed",
        ));
    }
    Ok(hex(&hasher.finalize()))
}

fn empty_asset_tree_sha256() -> String {
    hex(&Sha256::digest(ASSET_TREE_DIGEST_DOMAIN))
}

fn digest_asset_tree(root: &Path) -> Result<(u64, String), StoreError> {
    require_directory(root, "Backup assets")?;
    let mut hasher = Sha256::new();
    hasher.update(ASSET_TREE_DIGEST_DOMAIN);
    let mut inspected = 0_usize;
    let mut buffer = vec![0_u8; DIGEST_BUFFER_BYTES];
    let bytes = digest_asset_directory(root, root, &mut hasher, &mut inspected, &mut buffer)?;
    Ok((bytes, hex(&hasher.finalize())))
}

fn digest_asset_directory(
    root: &Path,
    directory: &Path,
    hasher: &mut Sha256,
    inspected: &mut usize,
    buffer: &mut [u8],
) -> Result<u64, StoreError> {
    let mut entries = fs::read_dir(directory)
        .map_err(io_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(io_error)?;
    entries.sort_by_key(fs::DirEntry::file_name);
    let mut total = 0_u64;
    for entry in entries {
        *inspected = inspected
            .checked_add(1)
            .ok_or_else(|| corrupt("Backup asset tree exceeds its entry bound"))?;
        if *inspected > MAX_BACKUP_TREE_ENTRIES {
            return Err(corrupt("Backup asset tree exceeds its entry bound"));
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err(corrupt("Backup assets contain a symbolic link"));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| internal("Backup asset escaped its digest root"))?;
        let relative_bytes = relative.as_os_str().as_bytes();
        let relative_length = u64::try_from(relative_bytes.len())
            .map_err(|_| internal("Backup asset path exceeds its digest bound"))?;
        if metadata.is_dir() {
            hasher.update(b"d");
            hasher.update(relative_length.to_be_bytes());
            hasher.update(relative_bytes);
            total = total
                .checked_add(digest_asset_directory(
                    root, &path, hasher, inspected, buffer,
                )?)
                .ok_or_else(|| corrupt("Backup asset byte length exceeds its bound"))?;
            continue;
        }
        if !metadata.is_file() {
            return Err(corrupt("Backup assets contain a non-file filesystem entry"));
        }
        hasher.update(b"f");
        hasher.update(relative_length.to_be_bytes());
        hasher.update(relative_bytes);
        hasher.update(metadata.len().to_be_bytes());
        let mut file = File::open(&path).map_err(io_error)?;
        let mut file_bytes = 0_u64;
        loop {
            let count = file.read(buffer).map_err(io_error)?;
            if count == 0 {
                break;
            }
            file_bytes = file_bytes
                .checked_add(
                    u64::try_from(count).map_err(|_| internal("Digest read is too large"))?,
                )
                .ok_or_else(|| corrupt("Backup asset byte length exceeds its bound"))?;
            hasher.update(&buffer[..count]);
        }
        if file_bytes != metadata.len() {
            return Err(corrupt(
                "Backup asset changed while integrity evidence was computed",
            ));
        }
        total = total
            .checked_add(file_bytes)
            .ok_or_else(|| corrupt("Backup asset byte length exceeds its bound"))?;
    }
    Ok(total)
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

fn inspect_removable_tree(root: &Path, inspected: &mut usize) -> Result<(), StoreError> {
    for entry in fs::read_dir(root).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        *inspected = inspected
            .checked_add(1)
            .ok_or_else(|| corrupt("Backup deletion tree exceeds its entry bound"))?;
        if *inspected > MAX_BACKUP_TREE_ENTRIES {
            return Err(corrupt("Backup deletion tree exceeds its entry bound"));
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
        if metadata.file_type().is_symlink() {
            return Err(invalid_profile(
                "Backup deletion tree must not contain symbolic links",
            ));
        }
        if metadata.is_dir() {
            inspect_removable_tree(&entry.path(), inspected)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(invalid_profile(
                "Backup deletion tree contains an unsupported entry",
            ));
        }
    }
    Ok(())
}

fn validate_backup_database(path: &Path) -> Result<(u32, String), StoreError> {
    let result = (|| {
        let connection = open_immutable_reader(path)?;
        validate_store(&connection)?;
        validate_codex_thread_timestamp_invariants(&connection)?;
        validate_database_priority_invariants(&connection)?;
        let schema_version =
            connection.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
        if schema_version != u32::try_from(CURRENT_STORE_REVISION).expect("schema version fits u32")
        {
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
    })();
    result.map_err(|error| match error.code {
        StoreErrorCode::InvalidProfile | StoreErrorCode::SqliteFailure => corrupt(format!(
            "Backup SQLite validation failed: {}",
            error.message
        )),
        _ => error,
    })
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
    let valid_integrity_evidence = match (&manifest.integrity_evidence, manifest.version) {
        (None, 1 | 2) => true,
        (Some(evidence), BACKUP_MANIFEST_VERSION) => {
            evidence.version == BACKUP_INTEGRITY_EVIDENCE_VERSION
                && is_sha256(&evidence.database_sha256)
                && is_sha256(&evidence.asset_tree_sha256)
                && (manifest.includes_assets
                    || evidence.asset_tree_sha256 == empty_asset_tree_sha256())
        }
        _ => false,
    };
    if manifest.version == 0
        || manifest.version > BACKUP_MANIFEST_VERSION
        || !valid_integrity_evidence
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
        || (manifest.version == BACKUP_MANIFEST_VERSION
            && (manifest.store_schema_version.is_none()
                || manifest.store_epoch.as_ref().is_none_or(String::is_empty)))
    {
        return Err(corrupt("Backup manifest fields are invalid"));
    }
    Ok(())
}

fn to_record(manifest: &BackupManifest) -> BackupRecord {
    let trigger = match manifest.trigger.as_str() {
        "auto" => BackupTrigger::Auto,
        "pre-restore" => BackupTrigger::PreRestore,
        _ => BackupTrigger::Manual,
    };
    BackupRecord {
        version: manifest.version,
        backup_id: manifest.id.clone(),
        trigger,
        label: manifest.label.clone(),
        created_at: manifest.created_at.clone(),
        includes_assets: manifest.includes_assets,
        db_bytes: manifest.db_bytes,
        assets_bytes: manifest.assets_bytes,
        total_bytes: manifest.total_bytes,
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

pub(super) fn is_safe_backup_id(value: &str) -> bool {
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

fn validate_restore_staging_name(name: &str) -> Result<(), StoreError> {
    if name.starts_with(".restore-")
        && name.len() > ".restore-".len()
        && name.len() <= 160
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.')
    {
        return Ok(());
    }
    Err(invalid_profile(
        "Restore staging directory identity is invalid",
    ))
}

fn remove_owned_restore_staging(root: &Path, staging: &Path) -> Result<(), StoreError> {
    if staging.parent() != Some(root) {
        return Err(invalid_profile(
            "Restore staging path is outside its owner root",
        ));
    }
    let name = staging
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid_profile("Restore staging identity is invalid"))?;
    validate_restore_staging_name(name)?;
    let metadata = match fs::symlink_metadata(staging) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_profile(
            "Restore staging path is not an owned directory",
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
