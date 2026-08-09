//! Deterministic filesystem side-effect lifecycle for Store Administration.
//!
//! SQLite receipts remain the commit authority. Backup staging manifests bind
//! immutable bytes to an operation, while the existing Store replacement
//! journal binds restore installation. This module is the only Administration
//! path that advances staged filesystem work through durable receipt commit,
//! atomic publication, and idempotent cleanup.

use std::path::Path;

use nodex_core_contracts::administration::{BackupRecord, BackupTrigger};
use rusqlite::Connection;

use crate::infrastructure::sqlite::StoreError;

use super::{backup, restore};

#[allow(clippy::too_many_arguments)]
pub(super) fn stage_backup(
    connection: &Connection,
    profile_home: &Path,
    profile_id: &str,
    operation_id: &str,
    request_hash: &str,
    label: Option<&str>,
    include_assets: bool,
    trigger: BackupTrigger,
) -> Result<BackupRecord, StoreError> {
    backup::create_backup(
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

pub(super) fn publish_backup(
    profile_home: &Path,
    operation_id: &str,
    request_hash: &str,
    backup_id: &str,
) -> Result<BackupRecord, StoreError> {
    backup::publish_backup(profile_home, operation_id, request_hash, backup_id)
}

pub(super) fn publish_backup_cleanup(
    profile_home: &Path,
    operation_id: &str,
    backup_ids: &[String],
) -> Result<(), StoreError> {
    backup::publish_backup_deletions(profile_home, operation_id, backup_ids)
}

pub(super) fn install_restore(
    request: restore::InstallRestoreRequest<'_>,
) -> Result<restore::RestoreInstallation, StoreError> {
    restore::install_restore(request)
}
