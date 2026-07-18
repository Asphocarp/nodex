use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::domain::derived_records::{BlockDocumentAssetKind, BlockDocumentReference};
use crate::infrastructure::document_repository::{DocumentHeadRow, DocumentReadRepository};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::{DocumentMaterialization, DocumentSearchMarkerKind};

const TYPED_CREATION_BLOCK_TYPES: &[&str] = &[
    "page",
    "database",
    "synced_block_source",
    "reusable_template_source",
    "canvas",
];
const PROJECTION_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DocumentAuthorityRow {
    pub head: DocumentHeadRow,
    pub owner_block_id: String,
    pub owner_type: String,
    pub owner_lifecycle: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PersistedDocumentCommit {
    pub head_seq: i64,
    pub state_vector: Vec<u8>,
    pub state_hash: String,
    pub derived_touched_block_ids: Vec<String>,
    pub event_sequence: i64,
    pub committed_at: String,
}

pub(crate) struct PersistYjsCommit<'a> {
    pub authority: &'a DocumentAuthorityRow,
    pub base_materialization: &'a DocumentMaterialization,
    pub materialization: &'a DocumentMaterialization,
    pub update_id: &'a str,
    pub client_session_id: &'a str,
    pub base_head_seq: i64,
    pub client_touched_block_ids: &'a [String],
    pub update: &'a [u8],
    pub state_vector: &'a [u8],
    pub full_state: &'a [u8],
    pub store_epoch: &'a str,
    pub operation_id: &'a str,
}

pub(crate) fn read_document_authority(
    connection: &Connection,
    document_id: &str,
) -> Result<Option<DocumentAuthorityRow>, StoreError> {
    let Some(head) = DocumentReadRepository::new(connection).document_head(document_id)? else {
        return Ok(None);
    };
    let owner = connection
        .query_row(
            "SELECT ownership.block_id, owner.type, owner.lifecycle \
             FROM block_documents ownership \
             JOIN blocks owner ON owner.id = ownership.block_id \
               AND owner.project_id = ownership.project_id \
             WHERE ownership.document_id = ?1 AND ownership.project_id = ?2",
            params![document_id, head.project_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|_| corrupt("Document owner row has invalid column types"))?;
    let Some((owner_block_id, owner_type, owner_lifecycle)) = owner else {
        return Err(corrupt("Document has no owning Block"));
    };
    if owner_block_id.is_empty()
        || owner_type.is_empty()
        || !matches!(owner_lifecycle.as_str(), "active" | "archived" | "deleted")
    {
        return Err(corrupt("Document owner row is invalid"));
    }
    Ok(Some(DocumentAuthorityRow {
        head,
        owner_block_id,
        owner_type,
        owner_lifecycle,
    }))
}

pub(crate) fn read_store_epoch(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .filter(|epoch| !epoch.is_empty() && epoch.len() <= 512)
        .ok_or_else(|| corrupt("Profile store epoch is not initialized"))
}

pub(crate) fn read_event_head(connection: &Connection) -> Result<i64, StoreError> {
    let head = connection.query_row("SELECT COALESCE(max(seq), 0) FROM change_log", [], |row| {
        row.get::<_, i64>(0)
    })?;
    if head >= 0 {
        return Ok(head);
    }
    Err(corrupt("Change log head is invalid"))
}

pub(crate) fn persist_yjs_commit(
    connection: &Connection,
    input: PersistYjsCommit<'_>,
) -> Result<PersistedDocumentCommit, StoreError> {
    let next_head_seq = input
        .authority
        .head
        .head_seq
        .checked_add(1)
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::Internal,
                "Document head sequence overflowed",
                false,
            )
        })?;
    let now = sqlite_now(connection)?;
    let derived_touched_block_ids = derive_touched_block_ids(
        &input.authority.owner_block_id,
        input.base_materialization,
        input.materialization,
    );
    validate_document_references(
        connection,
        &input.authority.head.project_id,
        input.materialization,
    )?;
    reconcile_document_blocks(
        connection,
        input.authority,
        input.materialization,
        next_head_seq,
        &now,
    )?;
    persist_materialization(
        connection,
        &input.authority.head.id,
        input.authority.head.generation,
        next_head_seq,
        input.materialization,
        &now,
    )?;
    let client_touched_json = serde_json::to_string(input.client_touched_block_ids)
        .map_err(|_| internal("Client touched Block IDs could not be encoded"))?;
    let derived_touched_json = serde_json::to_string(&derived_touched_block_ids)
        .map_err(|_| internal("Derived touched Block IDs could not be encoded"))?;
    let update_hash = sha256(input.update);
    connection.execute(
        "INSERT INTO document_update_receipts (\
           document_id, generation, seq, update_id, client_session_id, base_head_seq, \
           client_touched_block_ids_json, derived_touched_block_ids_json, derivation_version, \
           update_hash, update_byte_length, committed_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11)",
        params![
            input.authority.head.id,
            input.authority.head.generation,
            next_head_seq,
            input.update_id,
            input.client_session_id,
            input.base_head_seq,
            client_touched_json,
            derived_touched_json,
            update_hash,
            i64::try_from(input.update.len()).map_err(|_| internal("Update length overflow"))?,
            now,
        ],
    )?;
    connection.execute(
        "INSERT INTO document_updates (\
           document_id, generation, seq, update_id, client_session_id, base_head_seq, \
           touched_block_ids_json, update_blob, update_hash, committed_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            input.authority.head.id,
            input.authority.head.generation,
            next_head_seq,
            input.update_id,
            input.client_session_id,
            input.base_head_seq,
            derived_touched_json,
            input.update,
            update_hash,
            now,
        ],
    )?;
    let state_hash = sha256(input.full_state);
    let changed = connection.execute(
        "UPDATE documents SET head_seq = ?1, state_vector = ?2, state_hash = ?3, updated_at = ?4 \
         WHERE id = ?5 AND generation = ?6 AND head_seq = ?7 \
           AND readiness = 'ready' AND authority = 'ydoc_primary' AND sync_engine = 'yjs'",
        params![
            next_head_seq,
            input.state_vector,
            state_hash,
            now,
            input.authority.head.id,
            input.authority.head.generation,
            input.authority.head.head_seq,
        ],
    )?;
    if changed != 1 {
        return Err(conflict("Document head advanced before commit"));
    }
    replace_secondary_projections(
        connection,
        input.authority,
        input.materialization,
        next_head_seq,
        &now,
    )?;
    let materialization_bytes =
        serde_json::to_vec(input.materialization).map_err(|_| internal("Materialization hash"))?;
    connection.execute(
        "INSERT INTO document_engine_fingerprints (\
           document_id, generation, head_seq, source_state_hash, yrs_state_vector_sha256, \
           yrs_full_state_sha256, materialization_sha256, validated_at_unix_ms\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, \
                   CAST(strftime('%s', 'now') AS INTEGER) * 1000) \
         ON CONFLICT(document_id, generation, head_seq) DO UPDATE SET \
           source_state_hash = excluded.source_state_hash, \
           yrs_state_vector_sha256 = excluded.yrs_state_vector_sha256, \
           yrs_full_state_sha256 = excluded.yrs_full_state_sha256, \
           materialization_sha256 = excluded.materialization_sha256, \
           validated_at_unix_ms = excluded.validated_at_unix_ms",
        params![
            input.authority.head.id,
            input.authority.head.generation,
            next_head_seq,
            state_hash,
            sha256(input.state_vector),
            state_hash,
            sha256(&materialization_bytes),
        ],
    )?;
    let payload = json!({
        "module": "owned_document",
        "kind": "document_updated",
        "documentId": input.authority.head.id,
        "generation": input.authority.head.generation,
        "headSeq": next_head_seq,
        "updateId": input.update_id,
        "updateHash": update_hash,
        "updateByteLength": input.update.len(),
    });
    connection.execute(
        "INSERT INTO change_log (\
           project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
           database_block_ids_json, payload_json, committed_at\
         ) VALUES (?1, ?2, 'owned_document.document_updated', ?3, ?4, ?5, '[]', ?6, ?7)",
        params![
            input.authority.head.project_id,
            input.store_epoch,
            input.operation_id,
            derived_touched_json,
            serde_json::to_string(&[&input.authority.head.id])
                .map_err(|_| internal("Document event IDs"))?,
            serde_json::to_string(&payload).map_err(|_| internal("Document event payload"))?,
            now,
        ],
    )?;
    let event_sequence = connection.last_insert_rowid();
    Ok(PersistedDocumentCommit {
        head_seq: next_head_seq,
        state_vector: input.state_vector.to_vec(),
        state_hash,
        derived_touched_block_ids,
        event_sequence,
        committed_at: now,
    })
}

fn reconcile_document_blocks(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    materialization: &DocumentMaterialization,
    projected_seq: i64,
    now: &str,
) -> Result<(), StoreError> {
    let existing = connection
        .prepare(
            "SELECT id, project_id, type, lifecycle, location_kind, containing_document_id \
             FROM blocks WHERE containing_document_id = ?1 ORDER BY id",
        )?
        .query_map([&authority.head.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Document Block registry has invalid column types"))?;
    let existing_ids = existing
        .iter()
        .map(|row| row.0.clone())
        .collect::<HashSet<_>>();
    let active_ids = materialization
        .search_units
        .iter()
        .map(|unit| unit.block_id.clone())
        .collect::<HashSet<_>>();
    for unit in &materialization.search_units {
        let registered = connection
            .query_row(
                "SELECT project_id, type, lifecycle, location_kind, containing_document_id \
                 FROM blocks WHERE id = ?1",
                [&unit.block_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| corrupt("Registered Block row has invalid column types"))?;
        match registered {
            None => {
                if !is_uuid_v7(&unit.block_id)
                    || TYPED_CREATION_BLOCK_TYPES.contains(&unit.block_type.as_str())
                {
                    return Err(invalid(format!(
                        "Block {} requires a typed creation operation",
                        unit.block_id
                    )));
                }
                connection.execute(
                    "INSERT INTO blocks (\
                       id, project_id, type, lifecycle, location_kind, containing_document_id, \
                       location_revision, metadata_revision, created_at, updated_at\
                     ) VALUES (?1, ?2, ?3, 'active', 'document', ?4, 1, 1, ?5, ?5)",
                    params![
                        unit.block_id,
                        authority.head.project_id,
                        unit.block_type,
                        authority.head.id,
                        now,
                    ],
                )?;
            }
            Some((project_id, block_type, lifecycle, location_kind, containing_document_id)) => {
                if project_id != authority.head.project_id
                    || location_kind != "document"
                    || containing_document_id.as_deref() != Some(authority.head.id.as_str())
                {
                    return Err(invalid(format!(
                        "Block {} belongs to another authority",
                        unit.block_id
                    )));
                }
                if block_type != unit.block_type
                    && (TYPED_CREATION_BLOCK_TYPES.contains(&block_type.as_str())
                        || TYPED_CREATION_BLOCK_TYPES.contains(&unit.block_type.as_str()))
                {
                    return Err(invalid(format!(
                        "Block {} requires a typed reclassification",
                        unit.block_id
                    )));
                }
                if lifecycle != "active" || block_type != unit.block_type {
                    connection.execute(
                        "UPDATE blocks SET type = ?1, lifecycle = 'active', \
                           metadata_revision = metadata_revision + 1, updated_at = ?2 WHERE id = ?3",
                        params![unit.block_type, now, unit.block_id],
                    )?;
                }
            }
        }
    }
    for block_id in existing_ids.difference(&active_ids) {
        connection.execute(
            "UPDATE blocks SET lifecycle = 'deleted', metadata_revision = metadata_revision + 1, \
               updated_at = ?1 WHERE id = ?2 AND lifecycle <> 'deleted'",
            params![now, block_id],
        )?;
    }
    connection.execute(
        "DELETE FROM document_block_index WHERE document_id = ?1",
        [&authority.head.id],
    )?;
    for unit in &materialization.search_units {
        connection.execute(
            "INSERT INTO document_block_index (\
               document_id, block_id, parent_block_id, ordinal, block_type, text, projected_seq\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                authority.head.id,
                unit.block_id,
                unit.parent_block_id,
                i64::try_from(unit.ordinal).map_err(|_| internal("Block ordinal overflow"))?,
                unit.block_type,
                unit.text,
                projected_seq,
            ],
        )?;
    }
    Ok(())
}

fn persist_materialization(
    connection: &Connection,
    document_id: &str,
    generation: i64,
    projected_seq: i64,
    materialization: &DocumentMaterialization,
    now: &str,
) -> Result<(), StoreError> {
    let rich_title_json = serde_json::to_string(&materialization.rich_title)
        .map_err(|_| internal("Rich title JSON"))?;
    connection.execute(
        "INSERT INTO document_materializations (\
           document_id, generation, projected_seq, schema_version, title, title_rich_json, \
           title_rich_hash, nfm, plain_text, preview, block_tree_json, references_json, \
           asset_refs_json, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) \
         ON CONFLICT(document_id) DO UPDATE SET \
           generation = excluded.generation, projected_seq = excluded.projected_seq, \
           schema_version = excluded.schema_version, title = excluded.title, \
           title_rich_json = excluded.title_rich_json, title_rich_hash = excluded.title_rich_hash, \
           nfm = excluded.nfm, plain_text = excluded.plain_text, preview = excluded.preview, \
           block_tree_json = excluded.block_tree_json, references_json = excluded.references_json, \
           asset_refs_json = excluded.asset_refs_json, updated_at = excluded.updated_at",
        params![
            document_id,
            generation,
            projected_seq,
            materialization.schema_version,
            materialization.title,
            rich_title_json,
            sha256(rich_title_json.as_bytes()),
            materialization.nfm,
            materialization.plain_text,
            materialization.preview,
            serde_json::to_string(&materialization.block_tree)
                .map_err(|_| internal("Block tree JSON"))?,
            serde_json::to_string(&materialization.references)
                .map_err(|_| internal("Reference JSON"))?,
            serde_json::to_string(&materialization.asset_refs)
                .map_err(|_| internal("Asset reference JSON"))?,
            now,
        ],
    )?;
    Ok(())
}

fn replace_secondary_projections(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    materialization: &DocumentMaterialization,
    projected_seq: i64,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "DELETE FROM block_asset_refs WHERE document_id = ?1",
        [&authority.head.id],
    )?;
    connection.execute(
        "DELETE FROM block_search_units WHERE document_id = ?1 AND source_revision IS NULL",
        [&authority.head.id],
    )?;
    let marker_kind = match materialization.search_marker_kind {
        DocumentSearchMarkerKind::DocumentTitle => "document_title",
        DocumentSearchMarkerKind::DocumentMarker => "document_marker",
    };
    let marker_field = if marker_kind == "document_title" {
        "title"
    } else {
        "marker"
    };
    insert_search_unit(
        connection,
        authority,
        SearchUnitProjection {
            block_id: &authority.owner_block_id,
            projected_seq,
            source_kind: marker_kind,
            field_key: marker_field,
            text: &materialization.title,
            now,
        },
    )?;
    for unit in &materialization.search_units {
        insert_search_unit(
            connection,
            authority,
            SearchUnitProjection {
                block_id: &unit.block_id,
                projected_seq,
                source_kind: "document_block",
                field_key: "text",
                text: &unit.text,
                now,
            },
        )?;
    }
    let mut next_ordinal = HashMap::<(&str, &'static str), i64>::new();
    for asset in &materialization.asset_refs {
        let role = match asset.kind {
            BlockDocumentAssetKind::Image => "image",
            BlockDocumentAssetKind::Attachment => "attachment",
        };
        let ordinal = next_ordinal
            .entry((asset.source_block_id.as_str(), role))
            .or_insert(0);
        connection.execute(
            "INSERT INTO block_asset_refs (\
               document_id, block_id, owner_block_id, project_id, document_generation, \
               projected_seq, projection_version, role, ordinal, asset_uri, asset_hash, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11)",
            params![
                authority.head.id,
                asset.source_block_id,
                authority.owner_block_id,
                authority.head.project_id,
                authority.head.generation,
                projected_seq,
                PROJECTION_VERSION,
                role,
                *ordinal,
                asset.source,
                now,
            ],
        )?;
        *ordinal += 1;
    }
    Ok(())
}

struct SearchUnitProjection<'a> {
    block_id: &'a str,
    projected_seq: i64,
    source_kind: &'a str,
    field_key: &'a str,
    text: &'a str,
    now: &'a str,
}

fn insert_search_unit(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    unit: SearchUnitProjection<'_>,
) -> Result<(), StoreError> {
    let unit_key = format!(
        "document:{}",
        sha256(
            serde_json::to_string(&[
                authority.head.id.as_str(),
                unit.block_id,
                unit.source_kind,
                unit.field_key,
            ])
            .map_err(|_| internal("Search unit key"))?
            .as_bytes()
        )
    );
    connection.execute(
        "INSERT INTO block_search_units (\
           unit_key, project_id, block_id, owner_block_id, document_id, document_generation, \
           projected_seq, source_revision, projection_version, source_kind, field_key, text, \
           text_hash, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            unit_key,
            authority.head.project_id,
            unit.block_id,
            authority.owner_block_id,
            authority.head.id,
            authority.head.generation,
            unit.projected_seq,
            PROJECTION_VERSION,
            unit.source_kind,
            unit.field_key,
            unit.text,
            sha256(unit.text.as_bytes()),
            unit.now,
        ],
    )?;
    Ok(())
}

fn validate_document_references(
    connection: &Connection,
    project_id: &str,
    materialization: &DocumentMaterialization,
) -> Result<(), StoreError> {
    for reference in &materialization.references {
        let valid = match reference {
            BlockDocumentReference::Block {
                target_block_id, ..
            } => connection
                .query_row(
                    "SELECT 1 FROM blocks WHERE id = ?1 AND project_id = ?2 AND lifecycle <> 'deleted'",
                    params![target_block_id, project_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some(),
            BlockDocumentReference::DatabaseView {
                database_view_id, ..
            } => connection
                .query_row(
                    "SELECT 1 FROM database_views WHERE id = ?1 AND lifecycle <> 'deleted'",
                    [database_view_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some(),
            BlockDocumentReference::Thread {
                target_thread_id, ..
            } => connection
                .query_row(
                    "SELECT 1 FROM codex_threads WHERE thread_id = ?1 \
                     AND (project_id = ?2 OR project_id IS NULL)",
                    params![target_thread_id, project_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some(),
            BlockDocumentReference::LegacyCardProjection { .. }
            | BlockDocumentReference::LegacyDatabaseQuery { .. } => false,
        };
        if !valid {
            return Err(invalid(
                "Document contains an unreadable or legacy reference".to_owned(),
            ));
        }
    }
    Ok(())
}

fn derive_touched_block_ids(
    owner_block_id: &str,
    before: &DocumentMaterialization,
    after: &DocumentMaterialization,
) -> Vec<String> {
    let before_units = before
        .search_units
        .iter()
        .map(|unit| {
            (
                unit.block_id.as_str(),
                (
                    unit.parent_block_id.as_deref(),
                    unit.block_type.as_str(),
                    unit.text.as_str(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let after_units = after
        .search_units
        .iter()
        .map(|unit| {
            (
                unit.block_id.as_str(),
                (
                    unit.parent_block_id.as_deref(),
                    unit.block_type.as_str(),
                    unit.text.as_str(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut touched = before_units
        .keys()
        .chain(after_units.keys())
        .filter(|block_id| before_units.get(**block_id) != after_units.get(**block_id))
        .map(|block_id| (*block_id).to_owned())
        .collect::<HashSet<_>>();
    if before.title != after.title || before.rich_title != after.rich_title {
        touched.insert(owner_block_id.to_owned());
    }
    let mut touched = touched.into_iter().collect::<Vec<_>>();
    touched.sort();
    touched
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn is_uuid_v7(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.get(8) == Some(&b'-')
        && bytes.get(13) == Some(&b'-')
        && bytes.get(14) == Some(&b'7')
        && bytes.get(18) == Some(&b'-')
        && bytes
            .get(19)
            .is_some_and(|value| matches!(value.to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b'))
        && bytes.get(23) == Some(&b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, value)| matches!(index, 8 | 13 | 18 | 23) || value.is_ascii_hexdigit())
}

fn invalid(message: String) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn conflict(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::SqliteBusy, message, true)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
