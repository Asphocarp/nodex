use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use nodex_core_contracts::BoundModuleContext;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value, json};

use crate::infrastructure::document_repository::{
    DocumentAuthority, DocumentReadiness, DocumentSyncEngine,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::canvas_scene::{
    AppliedCanvasMutation, CANVAS_OWNER_TYPE, CANVAS_SCHEMA_KEY, CANVAS_SCHEMA_VERSION, CanvasFile,
    CanvasMutation, CanvasScene, canonical_json, materialize_loaded_scene, parse_stored_element,
    parse_stored_file,
};
use super::persistence::{DocumentAuthorityRow, read_event_head, sha256};

const MAX_CANVAS_ASSET_BYTES: u64 = 10 * 1024 * 1024;
const PROJECTION_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LoadedCanvasAuthority {
    pub(crate) scene: CanvasScene,
    pub(crate) scene_hash: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PersistedCanvasMutation {
    pub(crate) head_seq: i64,
    pub(crate) scene_hash: String,
    pub(crate) result: Value,
    pub(crate) event_delta: Option<Value>,
    pub(crate) event_sequence: i64,
    pub(crate) committed_at: String,
}

pub(crate) fn validate_canvas_authority(
    authority: &DocumentAuthorityRow,
) -> Result<(), StoreError> {
    if authority.head.sync_engine != DocumentSyncEngine::CanvasScene
        || authority.head.schema_key != CANVAS_SCHEMA_KEY
        || authority.head.schema_version != CANVAS_SCHEMA_VERSION
        || authority.owner_type != CANVAS_OWNER_TYPE
        || authority.head.readiness != DocumentReadiness::Ready
        || authority.head.authority != DocumentAuthority::YdocPrimary
        || !authority.head.state_vector.is_empty()
    {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Owned Document is not registered Canvas scene authority",
            false,
        ));
    }
    Ok(())
}

pub(crate) fn load_canvas_scene(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
) -> Result<LoadedCanvasAuthority, StoreError> {
    validate_canvas_authority(authority)?;
    let scene_row = connection
        .query_row(
            "SELECT generation, head_seq, schema_version, app_state_json, scene_hash, updated_at \
             FROM canvas_scenes WHERE document_id = ?1",
            [&authority.head.id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| corrupt("Canvas scene row has invalid column types"))?
        .ok_or_else(|| corrupt("Canvas scene authority is missing"))?;
    if scene_row.0 != authority.head.generation
        || scene_row.1 != authority.head.head_seq
        || scene_row.2 != authority.head.schema_version
    {
        return Err(corrupt(
            "Canvas scene coordinate does not match its Document head",
        ));
    }
    let element_rows = connection
        .prepare(
            "SELECT element_id, version, version_nonce, order_key, is_deleted, \
                    element_json, element_hash \
             FROM canvas_scene_elements WHERE document_id = ?1 ORDER BY order_key, element_id",
        )?
        .query_map([&authority.head.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Canvas element row has invalid column types"))?;
    let mut elements = Vec::with_capacity(element_rows.len());
    for row in element_rows {
        let value = serde_json::from_str::<Value>(&row.5)
            .map_err(|_| corrupt("Canvas element JSON is invalid"))?;
        let element = parse_stored_element(&value, &row.0, row.3.clone())?;
        if element.version != row.1
            || element.version_nonce != row.2
            || i64::from(element.is_deleted) != row.4
            || sha256(canonical_json(&element.value)?.as_bytes()) != row.6
            || element
                .value
                .get("index")
                .and_then(Value::as_str)
                .is_some_and(|index| index != row.3)
        {
            return Err(corrupt("Canvas element evidence diverges from its row"));
        }
        elements.push(element);
    }
    let file_rows = connection
        .prepare(
            "SELECT file_id, mime_type, asset_uri, created_ms, file_json, file_hash \
             FROM canvas_scene_files WHERE document_id = ?1 ORDER BY file_id",
        )?
        .query_map([&authority.head.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Canvas file row has invalid column types"))?;
    let mut files = BTreeMap::new();
    for row in file_rows {
        let value = serde_json::from_str::<Value>(&row.4)
            .map_err(|_| corrupt("Canvas file JSON is invalid"))?;
        let file = parse_stored_file(&value, &row.0)?;
        if file.mime_type != row.1
            || file.source != row.2
            || file.created_ms != row.3
            || sha256(canonical_json(&file.value)?.as_bytes()) != row.5
        {
            return Err(corrupt("Canvas file evidence diverges from its row"));
        }
        files.insert(row.0, file);
    }
    let app_state = serde_json::from_str::<Value>(&scene_row.3)
        .map_err(|_| corrupt("Canvas appState JSON is invalid"))?;
    let scene = materialize_loaded_scene(elements, &app_state, files)?;
    let scene_hash = sha256(scene.fingerprint()?.as_bytes());
    if scene_hash != scene_row.4 || scene_hash != authority.head.state_hash {
        return Err(corrupt(
            "Canvas scene hash diverges from its Document authority",
        ));
    }
    Ok(LoadedCanvasAuthority {
        scene,
        scene_hash,
        updated_at: scene_row.5,
    })
}

pub(crate) fn ensure_canvas_scene(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    assets_root: &Path,
) -> Result<(LoadedCanvasAuthority, bool), StoreError> {
    validate_canvas_authority(authority)?;
    let exists = connection
        .query_row(
            "SELECT 1 FROM canvas_scenes WHERE document_id = ?1",
            [&authority.head.id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        return load_canvas_scene(connection, authority).map(|loaded| (loaded, false));
    }
    let scene = CanvasScene::empty();
    let scene_hash = sha256(scene.fingerprint()?.as_bytes());
    let now = sqlite_now(connection)?;
    let changed = connection.execute(
        "UPDATE documents SET state_hash = ?1, updated_at = ?2 \
         WHERE id = ?3 AND project_id = ?4 AND generation = ?5 AND head_seq = ?6 \
           AND sync_engine = 'canvas_scene' AND readiness = 'ready' \
           AND authority = 'ydoc_primary' AND length(state_vector) = 0",
        params![
            scene_hash,
            now,
            authority.head.id,
            authority.head.project_id,
            authority.head.generation,
            authority.head.head_seq,
        ],
    )?;
    if changed != 1 {
        return Err(conflict(
            "Canvas Document changed before scene initialization",
        ));
    }
    connection.execute(
        "INSERT INTO canvas_scenes (\
           document_id, generation, head_seq, schema_version, app_state_json, scene_hash, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, '{}', ?5, ?6)",
        params![
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq,
            authority.head.schema_version,
            scene_hash,
            now,
        ],
    )?;
    let mut updated = authority.clone();
    updated.head.state_hash = scene_hash.clone();
    replace_canvas_projections(connection, &updated, &scene, &now, assets_root)?;
    Ok((
        LoadedCanvasAuthority {
            scene,
            scene_hash,
            updated_at: now,
        },
        true,
    ))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn persist_canvas_mutation(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    base_head_seq: i64,
    mutation: &CanvasMutation,
    applied: &AppliedCanvasMutation,
    assets_root: &Path,
    durable_event_kind: &str,
) -> Result<PersistedCanvasMutation, StoreError> {
    validate_canvas_authority(authority)?;
    if base_head_seq > authority.head.head_seq {
        return Err(StoreError::new(
            StoreErrorCode::HeadConflict,
            "Canvas mutation is based on a future Document head",
            true,
        ));
    }
    validate_page_references(connection, authority, &applied.scene)?;
    validate_file_additions(assets_root, &mutation.file_additions)?;
    let request = canvas_request_value(
        authority,
        context,
        store_epoch,
        operation_id,
        base_head_seq,
        mutation,
    );
    let request_json = canonical_json(&request)?;
    let request_hash = sha256(request_json.as_bytes());
    if connection
        .query_row(
            "SELECT 1 FROM canvas_scene_mutation_receipts \
             WHERE document_id = ?1 AND mutation_id = ?2",
            params![authority.head.id, operation_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(corrupt(
            "Canvas mutation receipt exists without its Module receipt",
        ));
    }
    let now = sqlite_now(connection)?;
    let changed = applied.changed();
    let head_seq = if changed {
        authority
            .head
            .head_seq
            .checked_add(1)
            .ok_or_else(|| internal("Canvas head sequence overflowed"))?
    } else {
        authority.head.head_seq
    };
    let scene_hash = sha256(applied.scene.fingerprint()?.as_bytes());
    let event_sequence = if changed {
        persist_changed_scene(
            connection,
            authority,
            &applied.scene,
            applied,
            head_seq,
            &scene_hash,
            &now,
            assets_root,
        )?;
        let payload = json!({
            "module": "owned_document",
            "kind": durable_event_kind,
            "documentId": authority.head.id,
            "generation": authority.head.generation,
            "headSeq": head_seq,
            "mutationId": operation_id,
            "sceneHash": scene_hash,
            "changedElementIds": applied.changed_element_ids,
            "appliedAppStateKeys": applied.applied_app_state_keys,
            "skippedAppStateKeys": applied.skipped_app_state_keys,
            "addedFileIds": applied.added_file_ids,
            "removedFileIds": applied.removed_file_ids,
        });
        connection.execute(
            "INSERT INTO change_log (\
               project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
               database_block_ids_json, payload_json, committed_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[]', ?7, ?8)",
            params![
                authority.head.project_id,
                store_epoch,
                format!("owned_document.{durable_event_kind}"),
                operation_id,
                serde_json::to_string(&[&authority.owner_block_id])
                    .map_err(|_| internal("Canvas event Block IDs"))?,
                serde_json::to_string(&[&authority.head.id])
                    .map_err(|_| internal("Canvas event Document IDs"))?,
                canonical_json(&payload)?,
                now,
            ],
        )?;
        connection.last_insert_rowid()
    } else {
        read_event_head(connection)?
    };
    let outcome = if changed { "committed" } else { "no_change" };
    let result = json!({
        "version": 1,
        "mutationId": operation_id,
        "projectId": authority.head.project_id,
        "documentId": authority.head.id,
        "storeEpoch": store_epoch,
        "generation": authority.head.generation,
        "baseHeadSeq": base_head_seq,
        "headSeq": head_seq,
        "duplicate": false,
        "outcome": outcome,
        "sceneHash": scene_hash,
        "changedElementIds": applied.changed_element_ids,
        "appliedAppStateKeys": applied.applied_app_state_keys,
        "skippedAppStateKeys": applied.skipped_app_state_keys,
        "addedFileIds": applied.added_file_ids,
        "removedFileIds": applied.removed_file_ids,
        "committedAt": now,
    });
    let result_json = canonical_json(&result)?;
    connection.execute(
        "INSERT INTO canvas_scene_mutation_receipts (\
           document_id, generation, mutation_id, client_session_id, base_head_seq, \
           committed_head_seq, request_hash, request_byte_length, request_json, result_json, \
           result_hash, outcome, committed_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            authority.head.id,
            authority.head.generation,
            operation_id,
            context.connection_id,
            base_head_seq,
            head_seq,
            request_hash,
            i64::try_from(request_json.len()).map_err(|_| internal("Canvas request length"))?,
            request_json,
            result_json,
            sha256(result_json.as_bytes()),
            outcome,
            now,
        ],
    )?;
    Ok(PersistedCanvasMutation {
        head_seq,
        scene_hash,
        result,
        event_delta: changed.then(|| applied.event_delta.clone()),
        event_sequence,
        committed_at: now,
    })
}

#[allow(clippy::too_many_arguments)]
fn persist_changed_scene(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    scene: &CanvasScene,
    applied: &AppliedCanvasMutation,
    head_seq: i64,
    scene_hash: &str,
    now: &str,
    assets_root: &Path,
) -> Result<(), StoreError> {
    for id in &applied.changed_element_ids {
        let Some(element) = scene.elements.iter().find(|element| &element.id == id) else {
            return Err(internal("Changed Canvas element is missing from candidate"));
        };
        let element_json = canonical_json(&element.value)?;
        connection.execute(
            "INSERT INTO canvas_scene_elements (\
               document_id, element_id, version, version_nonce, order_key, is_deleted, \
               element_json, element_hash, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
             ON CONFLICT(document_id, element_id) DO UPDATE SET \
               version = excluded.version, version_nonce = excluded.version_nonce, \
               order_key = excluded.order_key, is_deleted = excluded.is_deleted, \
               element_json = excluded.element_json, element_hash = excluded.element_hash, \
               updated_at = excluded.updated_at",
            params![
                authority.head.id,
                element.id,
                element.version,
                element.version_nonce,
                element.order_key,
                i64::from(element.is_deleted),
                element_json,
                sha256(element_json.as_bytes()),
                now,
            ],
        )?;
    }
    for id in &applied.removed_file_ids {
        connection.execute(
            "DELETE FROM canvas_scene_files WHERE document_id = ?1 AND file_id = ?2",
            params![authority.head.id, id],
        )?;
    }
    for id in &applied.added_file_ids {
        let file = scene
            .files
            .get(id)
            .ok_or_else(|| internal("Added Canvas file is missing from candidate"))?;
        persist_file(connection, &authority.head.id, file, now)?;
    }
    let updated_document = connection.execute(
        "UPDATE documents SET head_seq = ?1, state_hash = ?2, updated_at = ?3 \
         WHERE id = ?4 AND project_id = ?5 AND generation = ?6 AND head_seq = ?7 \
           AND sync_engine = 'canvas_scene' AND readiness = 'ready' \
           AND authority = 'ydoc_primary' AND length(state_vector) = 0",
        params![
            head_seq,
            scene_hash,
            now,
            authority.head.id,
            authority.head.project_id,
            authority.head.generation,
            authority.head.head_seq,
        ],
    )?;
    let updated_scene = connection.execute(
        "UPDATE canvas_scenes SET head_seq = ?1, app_state_json = ?2, scene_hash = ?3, \
           updated_at = ?4 WHERE document_id = ?5 AND generation = ?6 AND head_seq = ?7",
        params![
            head_seq,
            canonical_json(&Value::Object(scene.app_state.clone()))?,
            scene_hash,
            now,
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq,
        ],
    )?;
    if updated_document != 1 || updated_scene != 1 {
        return Err(conflict("Canvas Document head changed before commit"));
    }
    let mut next_authority = authority.clone();
    next_authority.head.head_seq = head_seq;
    next_authority.head.state_hash = scene_hash.to_owned();
    replace_canvas_projections(connection, &next_authority, scene, now, assets_root)
}

fn persist_file(
    connection: &Connection,
    document_id: &str,
    file: &CanvasFile,
    now: &str,
) -> Result<(), StoreError> {
    let file_json = canonical_json(&file.value)?;
    connection.execute(
        "INSERT INTO canvas_scene_files (\
           document_id, file_id, mime_type, asset_uri, created_ms, file_json, file_hash, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
         ON CONFLICT(document_id, file_id) DO UPDATE SET \
           mime_type = excluded.mime_type, asset_uri = excluded.asset_uri, \
           created_ms = excluded.created_ms, file_json = excluded.file_json, \
           file_hash = excluded.file_hash, updated_at = excluded.updated_at",
        params![
            document_id,
            file.id,
            file.mime_type,
            file.source,
            file.created_ms,
            file_json,
            sha256(file_json.as_bytes()),
            now,
        ],
    )?;
    Ok(())
}

fn replace_canvas_projections(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    scene: &CanvasScene,
    now: &str,
    assets_root: &Path,
) -> Result<(), StoreError> {
    connection.execute(
        "DELETE FROM block_asset_refs WHERE document_id = ?1",
        [&authority.head.id],
    )?;
    connection.execute(
        "DELETE FROM canvas_scene_file_refs WHERE document_id = ?1",
        [&authority.head.id],
    )?;
    connection.execute(
        "DELETE FROM canvas_page_references WHERE document_id = ?1",
        [&authority.head.id],
    )?;
    connection.execute(
        "DELETE FROM block_search_units WHERE document_id = ?1 AND source_revision IS NULL",
        [&authority.head.id],
    )?;
    let unit_key = format!(
        "document:{}",
        sha256(
            serde_json::to_string(&[
                authority.head.id.as_str(),
                authority.owner_block_id.as_str(),
                "document_marker",
                "marker",
            ])
            .map_err(|_| internal("Canvas search unit key"))?
            .as_bytes()
        )
    );
    connection.execute(
        "INSERT INTO block_search_units (\
           unit_key, project_id, block_id, owner_block_id, document_id, \
           document_generation, projected_seq, source_revision, projection_version, \
           source_kind, field_key, text, text_hash, updated_at\
         ) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, NULL, ?7, \
                   'document_marker', 'marker', ?8, ?9, ?10)",
        params![
            unit_key,
            authority.head.project_id,
            authority.owner_block_id,
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq,
            PROJECTION_VERSION,
            scene.plain_text,
            sha256(scene.plain_text.as_bytes()),
            now,
        ],
    )?;
    for reference in &scene.page_references {
        connection.execute(
            "INSERT INTO canvas_page_references (\
               document_id, source_element_id, target_block_id, owner_block_id, project_id, \
               document_generation, projected_seq, title_hint, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                authority.head.id,
                reference.source_element_id,
                reference.target_block_id,
                authority.owner_block_id,
                authority.head.project_id,
                authority.head.generation,
                authority.head.head_seq,
                reference.title_hint,
                now,
            ],
        )?;
    }
    for file in scene.files.values() {
        let evidence = asset_evidence(connection, &authority.head.id, file, assets_root)?;
        connection.execute(
            "INSERT INTO canvas_scene_file_refs (\
               document_id, file_id, owner_block_id, project_id, document_generation, \
               projected_seq, mime_type, asset_uri, managed_file_name, asset_hash, \
               byte_length, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                authority.head.id,
                file.id,
                authority.owner_block_id,
                authority.head.project_id,
                authority.head.generation,
                authority.head.head_seq,
                file.mime_type,
                file.source,
                file.managed_file_name,
                evidence.0,
                evidence.1,
                now,
            ],
        )?;
    }
    Ok(())
}

fn asset_evidence(
    connection: &Connection,
    document_id: &str,
    file: &CanvasFile,
    assets_root: &Path,
) -> Result<(String, i64), StoreError> {
    let previous = connection
        .query_row(
            "SELECT asset_uri, asset_hash, byte_length FROM canvas_scene_file_refs \
             WHERE document_id = ?1 AND file_id = ?2",
            params![document_id, file.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let path = assets_root.join(&file.managed_file_name);
    let metadata =
        fs::symlink_metadata(&path).map_err(|_| invalid("Canvas managed asset is missing"))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_CANVAS_ASSET_BYTES
    {
        return Err(invalid(
            "Canvas managed asset is not a bounded regular file",
        ));
    }
    let length = i64::try_from(metadata.len()).map_err(|_| internal("Canvas asset length"))?;
    if let Some((source, hash, previous_length)) = previous
        && source == file.source
        && previous_length == length
    {
        return Ok((hash, length));
    }
    let bytes = fs::read(path).map_err(|_| invalid("Canvas managed asset could not be read"))?;
    Ok((sha256(&bytes), length))
}

fn validate_file_additions(
    assets_root: &Path,
    files: &BTreeMap<String, CanvasFile>,
) -> Result<(), StoreError> {
    for file in files.values() {
        let path = assets_root.join(&file.managed_file_name);
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| invalid("Canvas file addition references a missing managed asset"))?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_CANVAS_ASSET_BYTES
        {
            return Err(invalid(
                "Canvas file addition must reference a bounded regular managed asset",
            ));
        }
    }
    Ok(())
}

fn validate_page_references(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    scene: &CanvasScene,
) -> Result<(), StoreError> {
    for reference in &scene.page_references {
        let valid = connection
            .query_row(
                "SELECT 1 FROM blocks WHERE id = ?1 AND project_id = ?2 \
                   AND lifecycle <> 'deleted' AND type = 'page'",
                params![reference.target_block_id, authority.head.project_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !valid {
            return Err(invalid(
                "Canvas scene contains a missing, deleted, or cross-Project Page reference",
            ));
        }
    }
    Ok(())
}

fn canvas_request_value(
    authority: &DocumentAuthorityRow,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    base_head_seq: i64,
    mutation: &CanvasMutation,
) -> Value {
    let mut object = mutation
        .canonical_value
        .as_object()
        .cloned()
        .unwrap_or_else(Map::new);
    object.extend(Map::from_iter([
        ("version".to_owned(), json!(1)),
        ("mutationId".to_owned(), json!(operation_id)),
        ("projectId".to_owned(), json!(authority.head.project_id)),
        ("documentId".to_owned(), json!(authority.head.id)),
        ("storeEpoch".to_owned(), json!(store_epoch)),
        ("generation".to_owned(), json!(authority.head.generation)),
        ("baseHeadSeq".to_owned(), json!(base_head_seq)),
        ("clientSessionId".to_owned(), json!(context.connection_id)),
    ]));
    Value::Object(object)
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message.into(), false)
}

fn conflict(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::HeadConflict, message, true)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message.into(), false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
