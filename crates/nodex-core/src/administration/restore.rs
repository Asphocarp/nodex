use std::fs;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::document::integrity::validate_restore_documents;
use crate::document::{DocumentAuthorityRow, load_canvas_scene, read_document_authority, sha256};
use crate::domain::derived_records::parse_asset_source;
use crate::infrastructure::document_repository::{
    DocumentAuthority, DocumentReadRepository, DocumentReadiness, DocumentSyncEngine,
};
use crate::infrastructure::sqlite::{
    StoreError, StoreErrorCode, open_immutable_reader, open_writer, validate_store,
    with_immediate_transaction,
};
use crate::infrastructure::store::STORE_FILE_NAME;
use crate::infrastructure::store_replacement::{StoreReplacementJournal, validate_live_store};
use crate::infrastructure::store_validation::validate_codex_thread_timestamp_invariants;

use super::backup;
use crate::infrastructure::store_replacement::{
    NewStoreReplacementJournal, StoreReplacementPhase, advance_store_replacement_journal,
    create_store_replacement_journal, install_staged_store_files, rollback_store_replacement,
};

const ASSETS_DIRECTORY_NAME: &str = "assets";
const MAX_CANVAS_ASSET_BYTES: u64 = 10 * 1024 * 1024;

pub(super) struct RestoreInstallation {
    pub journal: StoreReplacementJournal,
    pub installed_epoch: String,
    pub safety_backup_id: Option<String>,
}

pub(super) struct InstallRestoreRequest<'a> {
    pub profile_home: &'a Path,
    pub profile_id: &'a str,
    pub library_id: &'a str,
    pub operation_id: &'a str,
    pub request_hash: &'a str,
    pub requested_store_epoch: &'a str,
    pub backup_id: &'a str,
    pub create_safety_backup: bool,
    pub existing_journal: Option<StoreReplacementJournal>,
    pub replacement_hook: &'a dyn Fn(&str) -> Result<(), StoreError>,
}

pub(super) fn install_restore(
    request: InstallRestoreRequest<'_>,
) -> Result<RestoreInstallation, StoreError> {
    let database_path = request.profile_home.join(STORE_FILE_NAME);
    let source = open_writer(&database_path)?;
    validate_identity(&source, request.profile_id, request.library_id)?;
    let source_store_epoch = read_store_epoch(&source)?;
    if source_store_epoch != request.requested_store_epoch {
        return Err(StoreError::new(
            StoreErrorCode::StaleStoreEpoch,
            "Store restore targets a stale store epoch",
            true,
        ));
    }
    drop(source);

    let (staging_directory_name, rollback_directory_name) =
        replacement_directory_names(request.profile_id, request.operation_id);
    let (mut journal, candidate_store_epoch) = if let Some(journal) = request.existing_journal {
        validate_journal_identity(
            &journal,
            request.operation_id,
            request.request_hash,
            request.backup_id,
        )?;
        if journal.phase != StoreReplacementPhase::Prepared
            || journal.source_store_epoch != source_store_epoch
            || journal.staging_directory_name != staging_directory_name
            || journal.rollback_directory_name != rollback_directory_name
        {
            return Err(corrupt(
                "Prepared Store restore journal does not match the current source",
            ));
        }
        let candidate_store_epoch = validate_staged_candidate(
            request.profile_home,
            &journal.staging_directory_name,
            request.profile_id,
            request.library_id,
        )?;
        (journal, candidate_store_epoch)
    } else {
        let backup = backup::resolve_backup_for_restore(request.profile_home, request.backup_id)?;
        let staged_epoch = backup::stage_restore_candidate(
            request.profile_home,
            &backup,
            &staging_directory_name,
        )?;
        let validated_epoch = validate_staged_candidate(
            request.profile_home,
            &staging_directory_name,
            request.profile_id,
            request.library_id,
        )?;
        if staged_epoch != validated_epoch {
            return Err(corrupt(
                "Restore candidate epoch changed during semantic validation",
            ));
        }
        let journal = create_store_replacement_journal(
            request.profile_home,
            NewStoreReplacementJournal {
                operation_id: request.operation_id,
                request_hash: request.request_hash,
                backup_id: request.backup_id,
                staging_directory_name: &staging_directory_name,
                rollback_directory_name: &rollback_directory_name,
                source_store_epoch: &source_store_epoch,
                updated_at: &now(),
            },
        )?;
        (journal, validated_epoch)
    };

    if request.create_safety_backup && journal.safety_backup_id.is_none() {
        let source = open_writer(&database_path)?;
        let safety = backup::create_safety_backup(
            &source,
            request.profile_home,
            request.profile_id,
            request.operation_id,
            request.request_hash,
            request.backup_id,
        )?;
        drop(source);
        journal = advance_store_replacement_journal(
            request.profile_home,
            &journal,
            StoreReplacementPhase::Prepared,
            &now(),
            Some(&safety.backup_id),
            None,
        )?;
    }

    let installed_epoch = installed_store_epoch(
        &source_store_epoch,
        request.backup_id,
        request.operation_id,
        request.request_hash,
    );
    if installed_epoch == source_store_epoch {
        return Err(corrupt("Restore did not produce a new Store epoch"));
    }

    let mut attempted_hook = false;
    let installation = (|| {
        journal = advance_store_replacement_journal(
            request.profile_home,
            &journal,
            StoreReplacementPhase::RollbackStarted,
            &now(),
            None,
            None,
        )?;
        journal = advance_store_replacement_journal(
            request.profile_home,
            &journal,
            StoreReplacementPhase::InstallStarted,
            &now(),
            None,
            None,
        )?;
        install_staged_store_files(request.profile_home, &journal)?;
        journal = advance_store_replacement_journal(
            request.profile_home,
            &journal,
            StoreReplacementPhase::EpochRotating,
            &now(),
            None,
            None,
        )?;
        rotate_installed_store_epoch(
            request.profile_home,
            &candidate_store_epoch,
            &installed_epoch,
            request.profile_id,
            request.library_id,
        )?;
        attempted_hook = true;
        (request.replacement_hook)(&installed_epoch)?;
        journal = advance_store_replacement_journal(
            request.profile_home,
            &journal,
            StoreReplacementPhase::Committed,
            &now(),
            None,
            Some(&installed_epoch),
        )?;
        Ok(())
    })();
    if let Err(error) = installation {
        if journal.phase != StoreReplacementPhase::Prepared
            && journal.phase != StoreReplacementPhase::Committed
        {
            rollback_store_replacement(request.profile_home, &journal)?;
            if attempted_hook {
                (request.replacement_hook)(&source_store_epoch)?;
            }
        }
        return Err(error);
    }

    Ok(RestoreInstallation {
        safety_backup_id: journal.safety_backup_id.clone(),
        journal,
        installed_epoch,
    })
}

pub(super) fn replacement_directory_names(
    profile_id: &str,
    operation_id: &str,
) -> (String, String) {
    let digest = Sha256::digest(format!("store-replacement\0{profile_id}\0{operation_id}"));
    let identity = hex(&digest);
    (
        format!(".restore-{identity}"),
        format!(".rollback-{identity}"),
    )
}

pub(super) fn installed_store_epoch(
    source_store_epoch: &str,
    backup_id: &str,
    operation_id: &str,
    request_hash: &str,
) -> String {
    let digest = Sha256::digest(format!(
        "installed-store-epoch\0{source_store_epoch}\0{backup_id}\0{operation_id}\0{request_hash}"
    ));
    format!("epoch:restore:{}", hex(&digest))
}

pub(super) fn validate_journal_identity(
    journal: &StoreReplacementJournal,
    operation_id: &str,
    request_hash: &str,
    backup_id: &str,
) -> Result<(), StoreError> {
    if journal.operation_id == operation_id
        && journal.request_hash == request_hash
        && journal.backup_id == backup_id
    {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::IdempotencyKeyReused,
        "Store replacement journal belongs to another restore request",
        false,
    ))
}

pub(super) fn validate_staged_candidate(
    profile_home: &Path,
    staging_directory_name: &str,
    profile_id: &str,
    library_id: &str,
) -> Result<String, StoreError> {
    validate_candidate(
        &profile_home
            .join("backups")
            .join(staging_directory_name)
            .join(STORE_FILE_NAME),
        &profile_home
            .join("backups")
            .join(staging_directory_name)
            .join(ASSETS_DIRECTORY_NAME),
        profile_id,
        library_id,
    )
}

pub(super) fn rotate_installed_store_epoch(
    profile_home: &Path,
    expected_candidate_epoch: &str,
    installed_epoch: &str,
    profile_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    let database_path = profile_home.join(STORE_FILE_NAME);
    let mut connection = open_writer(&database_path)?;
    let current_epoch = read_store_epoch(&connection)?;
    if current_epoch != installed_epoch {
        if current_epoch != expected_candidate_epoch {
            return Err(corrupt(
                "Installed restore candidate epoch changed before rotation",
            ));
        }
        with_immediate_transaction(&mut connection, |transaction| {
            let now = transaction.query_row(
                "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                [],
                |row| row.get::<_, String>(0),
            )?;
            let changed = transaction.execute(
                "UPDATE block_store_metadata SET store_epoch = ?1, updated_at = ?2 \
                 WHERE id = 1 AND store_epoch = ?3",
                params![installed_epoch, now, expected_candidate_epoch],
            )?;
            if changed != 1 {
                return Err(corrupt(
                    "Installed restore candidate epoch changed during rotation",
                ));
            }
            transaction.execute_batch("PRAGMA defer_foreign_keys = ON;")?;
            transaction.execute_batch("DROP TRIGGER change_log_is_immutable")?;
            transaction.execute(
                "UPDATE change_log SET store_epoch = ?1 WHERE store_epoch != ?1",
                [installed_epoch],
            )?;
            transaction.execute_batch(
                "CREATE TRIGGER change_log_is_immutable \
                   BEFORE UPDATE ON change_log \
                   BEGIN \
                     SELECT RAISE(ABORT, 'change log entries are immutable'); \
                   END;",
            )?;
            crate::infrastructure::local_commit::rebase_store_epoch(transaction, installed_epoch)?;
            transaction.execute(
                "UPDATE core_module_receipts \
                 SET store_epoch = ?1, \
                     result_json = json_set(\
                         json_set(result_json, '$.store_epoch', ?1),\
                         '$.local_commit', json('null')\
                     ) \
                 WHERE store_epoch != ?1",
                [installed_epoch],
            )?;
            Ok(())
        })?;
    }
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    drop(connection);
    validate_live_store(profile_home, Some(installed_epoch))?;
    validate_candidate(
        &database_path,
        &profile_home.join(ASSETS_DIRECTORY_NAME),
        profile_id,
        library_id,
    )?;
    Ok(())
}

fn validate_candidate(
    database_path: &Path,
    assets_root: &Path,
    profile_id: &str,
    library_id: &str,
) -> Result<String, StoreError> {
    let connection = open_immutable_reader(database_path)?;
    validate_store(&connection)?;
    validate_codex_thread_timestamp_invariants(&connection)?;
    validate_restore_documents(&connection)?;
    validate_identity(&connection, profile_id, library_id)?;
    validate_document_authorities(&connection)?;
    validate_assets(&connection, assets_root)?;
    read_store_epoch(&connection)
}

fn validate_identity(
    connection: &Connection,
    profile_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    let valid = connection
        .query_row(
            "SELECT 1 FROM libraries WHERE id = ?1 AND profile_id = ?2",
            params![library_id, profile_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if valid {
        return Ok(());
    }
    Err(corrupt(
        "Restore candidate does not contain the bound Profile and Library identity",
    ))
}

fn validate_document_authorities(connection: &Connection) -> Result<(), StoreError> {
    let heads = DocumentReadRepository::new(connection).document_heads()?;
    for head in heads {
        if head.authority != DocumentAuthority::YdocPrimary
            || head.readiness != DocumentReadiness::Ready
        {
            return Err(corrupt(format!(
                "Restore candidate Document {} is not ready primary authority",
                head.id
            )));
        }
        let authority = read_document_authority(connection, &head.id)?
            .ok_or_else(|| corrupt("Restore candidate Document has no owning Block"))?;
        match head.sync_engine {
            DocumentSyncEngine::Yjs => {}
            DocumentSyncEngine::CanvasScene => validate_canvas_projection(connection, &authority)?,
        }
    }
    Ok(())
}

fn validate_canvas_projection(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
) -> Result<(), StoreError> {
    let loaded = load_canvas_scene(connection, authority)?;
    let projected_files = connection
        .prepare(
            "SELECT file_id, mime_type, asset_uri, managed_file_name \
             FROM canvas_scene_file_refs WHERE document_id = ?1 AND library_id = ?2 \
               AND document_generation = ?3 ORDER BY file_id",
        )?
        .query_map(
            params![
                authority.head.id,
                authority.head.library_id,
                authority.head.generation
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
    if projected_files.len() != loaded.scene.files.len() {
        return Err(corrupt("Restore candidate Canvas file projection is stale"));
    }
    for (file_id, mime_type, asset_uri, managed_file_name) in projected_files {
        let Some(file) = loaded.scene.files.get(&file_id) else {
            return Err(corrupt("Restore candidate Canvas file projection is stale"));
        };
        if file.mime_type != mime_type
            || file.source != asset_uri
            || file.managed_file_name != managed_file_name
        {
            return Err(corrupt("Restore candidate Canvas file projection is stale"));
        }
    }

    let projected_references = connection
        .prepare(
            "SELECT source_element_id, target_block_id FROM canvas_page_references \
             WHERE document_id = ?1 AND library_id = ?2 AND document_generation = ?3 \
             ORDER BY source_element_id",
        )?
        .query_map(
            params![
                authority.head.id,
                authority.head.library_id,
                authority.head.generation
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut expected_references = loaded
        .scene
        .page_references
        .iter()
        .map(|reference| {
            (
                reference.source_element_id.clone(),
                reference.target_block_id.clone(),
            )
        })
        .collect::<Vec<_>>();
    expected_references.sort();
    if projected_references != expected_references {
        return Err(corrupt(
            "Restore candidate Canvas Page reference projection is stale",
        ));
    }

    let marker = connection
        .query_row(
            "SELECT text, text_hash FROM block_search_units \
             WHERE document_id = ?1 AND owner_block_id = ?2 AND block_id = ?2 \
               AND document_generation = ?3 \
               AND source_kind = 'document_marker' AND field_key = 'marker'",
            params![
                authority.head.id,
                authority.owner_block_id,
                authority.head.generation
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if marker
        != Some((
            loaded.scene.plain_text.clone(),
            sha256(loaded.scene.plain_text.as_bytes()),
        ))
    {
        return Err(corrupt(
            "Restore candidate Canvas search projection is stale",
        ));
    }
    Ok(())
}

fn validate_assets(connection: &Connection, assets_root: &Path) -> Result<(), StoreError> {
    let metadata = fs::symlink_metadata(assets_root).map_err(io_error)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(corrupt(
            "Restore candidate managed assets root is not a real directory",
        ));
    }
    for entry in fs::read_dir(assets_root).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            return Err(corrupt("Restore candidate managed asset name is not UTF-8"));
        };
        let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
        if !safe_asset_file_name(&file_name)
            || metadata.file_type().is_symlink()
            || !metadata.is_file()
        {
            return Err(corrupt(
                "Restore candidate managed assets must be flat safe regular files",
            ));
        }
    }

    let block_assets = connection
        .prepare(
            "SELECT DISTINCT asset.asset_uri, asset.asset_hash FROM block_asset_refs asset \
             JOIN documents document ON document.id = asset.document_id \
               AND document.library_id = asset.library_id \
             WHERE asset.document_generation = document.generation \
               AND asset.projected_seq = document.head_seq \
               AND asset.asset_uri LIKE 'nodex://assets/%' ORDER BY asset.asset_uri",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (asset_uri, expected_hash) in block_assets {
        let file_name = parse_asset_source(&asset_uri)
            .ok_or_else(|| corrupt("Restore candidate contains an invalid managed asset URI"))?;
        let bytes = read_asset(assets_root, &file_name, None)?;
        if expected_hash.is_some_and(|expected| sha256(&bytes) != expected) {
            return Err(corrupt(
                "Restore candidate managed asset hash evidence does not match",
            ));
        }
    }

    let canvas_assets = connection
        .prepare(
            "SELECT asset_uri, managed_file_name, asset_hash, byte_length \
             FROM canvas_scene_file_refs asset JOIN documents document \
               ON document.id = asset.document_id AND document.library_id = asset.library_id \
             WHERE asset.document_generation = document.generation \
             ORDER BY asset_uri, document_id, file_id",
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
    for (asset_uri, managed_file_name, expected_hash, expected_length) in canvas_assets {
        let parsed = parse_asset_source(&asset_uri).ok_or_else(|| {
            corrupt("Restore candidate contains an invalid Canvas managed asset URI")
        })?;
        if parsed != managed_file_name || expected_length < 0 {
            return Err(corrupt(
                "Restore candidate Canvas asset projection is invalid",
            ));
        }
        let bytes = read_asset(
            assets_root,
            &managed_file_name,
            Some(MAX_CANVAS_ASSET_BYTES),
        )?;
        if i64::try_from(bytes.len()).ok() != Some(expected_length)
            || sha256(&bytes) != expected_hash
        {
            return Err(corrupt(
                "Restore candidate Canvas asset evidence does not match its file",
            ));
        }
    }
    Ok(())
}

fn read_asset(
    assets_root: &Path,
    file_name: &str,
    maximum_bytes: Option<u64>,
) -> Result<Vec<u8>, StoreError> {
    if !safe_asset_file_name(file_name) {
        return Err(corrupt("Restore candidate managed asset name is unsafe"));
    }
    let path = assets_root.join(file_name);
    let metadata = fs::symlink_metadata(&path).map_err(|_| {
        corrupt(format!(
            "Restore candidate is missing managed asset {file_name}"
        ))
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || maximum_bytes.is_some_and(|maximum| metadata.len() > maximum)
    {
        return Err(corrupt(format!(
            "Restore candidate managed asset {file_name} is invalid"
        )));
    }
    fs::read(path).map_err(io_error)
}

fn safe_asset_file_name(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.len() <= 512
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn read_store_epoch(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .filter(|epoch| !epoch.is_empty() && epoch.len() <= 512)
        .ok_or_else(|| corrupt("Restore candidate Store epoch is unavailable"))
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn io_error(error: std::io::Error) -> StoreError {
    StoreError::new(
        StoreErrorCode::Internal,
        format!("Store restore filesystem operation failed: {error}"),
        false,
    )
}
