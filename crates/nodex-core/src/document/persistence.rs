use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::domain::derived_records::{BlockDocumentAssetKind, BlockDocumentReference};
use crate::infrastructure::document_repository::{DocumentHeadRow, DocumentReadRepository};
use crate::infrastructure::event_log::{NewChangeLogEntry, append_change_log};
use crate::infrastructure::projection_impact::{
    PageProjectionCoordinates, PageProjectionDatabaseCoordinates, impact_for_page_document,
};
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
    pub page_library_id: Option<String>,
    pub page_lifecycle: Option<String>,
    pub page_database: Option<PageProjectionDatabaseCoordinates>,
}

impl DocumentAuthorityRow {
    pub(crate) fn page_impact(&self) -> Option<PageProjectionCoordinates> {
        self.page_library_id.as_ref()?;
        Some(PageProjectionCoordinates {
            page_id: self.owner_block_id.clone(),
            database: self.page_database.clone(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PersistedDocumentCommit {
    pub head_seq: i64,
    pub state_vector: Vec<u8>,
    pub derived_touched_block_ids: Vec<String>,
    /// Public event head after persistence. This is the emitted event's sequence
    /// when the owning aggregate publishes one.
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
    pub store_epoch: &'a str,
    pub operation_id: &'a str,
    pub local_commit_id: Option<&'a str>,
    pub event_kind: &'a str,
    pub write_fence_block_ids: &'a [String],
    pub title_write_fence_required: bool,
}

pub(crate) struct PersistYjsGenesis<'a> {
    pub authority: &'a DocumentAuthorityRow,
    pub materialization: &'a DocumentMaterialization,
    pub update_id: &'a str,
    pub client_session_id: &'a str,
    pub update: &'a [u8],
    pub state_vector: &'a [u8],
    pub full_state: &'a [u8],
    pub store_epoch: &'a str,
    pub operation_id: &'a str,
    /// Internal collaborator genesis keeps its durable Document artifacts but
    /// lets the owning aggregate publish the single public event.
    pub emit_event: bool,
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
            "SELECT ownership.block_id, owner.type, owner.lifecycle, \
                    page.library_id, page.lifecycle, page.parent_kind, page.parent_id, \
                    source.home_database_block_id \
             FROM block_documents ownership \
             JOIN blocks owner ON owner.id = ownership.block_id \
               AND owner.project_id = ownership.project_id \
             LEFT JOIN pages page ON page.block_id = owner.id \
               AND page.document_id = ownership.document_id \
             LEFT JOIN data_sources source ON page.parent_kind = 'data_source' \
               AND source.id = page.parent_id AND source.library_id = page.library_id \
             WHERE ownership.document_id = ?1 AND ownership.project_id = ?2",
            params![document_id, head.project_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|_| corrupt("Document owner row has invalid column types"))?;
    let Some((
        owner_block_id,
        owner_type,
        owner_lifecycle,
        page_library_id,
        page_lifecycle,
        page_parent_kind,
        page_parent_id,
        page_database_id,
    )) = owner
    else {
        return Err(corrupt("Document has no owning Block"));
    };
    if owner_block_id.is_empty()
        || owner_type.is_empty()
        || !matches!(owner_lifecycle.as_str(), "active" | "archived" | "deleted")
    {
        return Err(corrupt("Document owner row is invalid"));
    }
    if owner_type == "page" {
        if page_library_id.as_deref().is_some_and(str::is_empty)
            || page_library_id.is_some() != page_lifecycle.is_some()
            || page_lifecycle
                .as_deref()
                .is_some_and(|lifecycle| lifecycle != owner_lifecycle)
        {
            return Err(corrupt("Page Document authority row is invalid"));
        }
        if page_library_id.is_some()
            && (!matches!(
                page_parent_kind.as_deref(),
                Some("library" | "page" | "data_source")
            ) || page_parent_id.as_deref().is_none_or(str::is_empty))
        {
            return Err(corrupt("Page Document parent authority is invalid"));
        }
    } else if page_library_id.is_some() || page_lifecycle.is_some() {
        return Err(corrupt("Non-Page Document has Page authority"));
    }
    let page_database = match page_parent_kind.as_deref() {
        Some("data_source") => {
            let database_id = page_database_id
                .filter(|database_id| !database_id.is_empty())
                .ok_or_else(|| corrupt("Page Data Source has no home Database"))?;
            let data_source_id = page_parent_id
                .filter(|data_source_id| !data_source_id.is_empty())
                .ok_or_else(|| corrupt("Page Data Source identity is invalid"))?;
            let view_ids = connection
                .prepare(
                    "SELECT id FROM database_views \
                     WHERE data_source_id = ?1 AND database_block_id = ?2 \
                       AND lifecycle = 'active' ORDER BY id",
                )?
                .query_map(params![data_source_id, database_id], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|_| corrupt("Page Data Source View identities are invalid"))?;
            Some(PageProjectionDatabaseCoordinates {
                database_id,
                data_source_id,
                view_ids,
            })
        }
        Some("library" | "page") | None => {
            if page_database_id.is_some() {
                return Err(corrupt("Non-Database Page has Database authority"));
            }
            None
        }
        Some(_) => return Err(corrupt("Page parent kind is invalid")),
    };
    Ok(Some(DocumentAuthorityRow {
        head,
        owner_block_id,
        owner_type,
        owner_lifecycle,
        page_library_id,
        page_lifecycle,
        page_database,
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
        false,
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
    let changed = connection.execute(
        "UPDATE documents SET head_seq = ?1, state_vector = ?2, state_hash = '', updated_at = ?3 \
         WHERE id = ?4 AND generation = ?5 AND head_seq = ?6 \
           AND readiness = 'ready' AND authority = 'ydoc_primary' AND sync_engine = 'yjs'",
        params![
            next_head_seq,
            input.state_vector,
            now,
            input.authority.head.id,
            input.authority.head.generation,
            input.authority.head.head_seq,
        ],
    )?;
    if changed != 1 {
        return Err(conflict("Document head advanced before commit"));
    }
    if !input.write_fence_block_ids.is_empty() || input.title_write_fence_required {
        let mut block_ids = input.write_fence_block_ids.to_vec();
        block_ids.sort();
        block_ids.dedup();
        connection.execute(
            "INSERT INTO document_structural_barriers (\
               document_id, generation, head_seq, operation_id, block_ids_json, \
               title_fence, committed_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                input.authority.head.id,
                input.authority.head.generation,
                next_head_seq,
                input.operation_id,
                serde_json::to_string(&block_ids)
                    .map_err(|_| internal("Structural barrier Block IDs"))?,
                i64::from(input.title_write_fence_required),
                now,
            ],
        )?;
    }
    replace_secondary_projections(
        connection,
        input.authority,
        input.materialization,
        next_head_seq,
        &now,
        true,
    )?;
    let payload = json!({
        "module": "owned_document",
        "kind": input.event_kind,
        "documentId": input.authority.head.id,
        "generation": input.authority.head.generation,
        "headSeq": next_head_seq,
        "updateId": input.update_id,
        "updateHash": update_hash,
        "updateByteLength": input.update.len(),
        "localCommitId": input.local_commit_id,
    });
    let page_impact = input.authority.page_impact();
    let projection_impact = impact_for_page_document(
        page_impact.as_ref(),
        Some((
            &input.authority.head.id,
            input.authority.head.generation,
            next_head_seq,
        )),
    )?;
    let database_ids = page_impact
        .as_ref()
        .and_then(|impact| impact.database.as_ref())
        .map(|database| vec![database.database_id.clone()])
        .unwrap_or_default();
    let document_ids = vec![input.authority.head.id.clone()];
    let payload_json =
        serde_json::to_string(&payload).map_err(|_| internal("Document event payload"))?;
    let kind = format!("owned_document.{}", input.event_kind);
    let event_sequence = append_change_log(
        connection,
        NewChangeLogEntry {
            project_id: &input.authority.head.project_id,
            store_epoch: input.store_epoch,
            kind: &kind,
            operation_id: Some(input.operation_id),
            block_ids: &derived_touched_block_ids,
            document_ids: &document_ids,
            database_block_ids: &database_ids,
            payload_json: &payload_json,
            projection_impact: &projection_impact,
            committed_at: &now,
        },
    )?;
    Ok(PersistedDocumentCommit {
        head_seq: next_head_seq,
        state_vector: input.state_vector.to_vec(),
        derived_touched_block_ids,
        event_sequence,
        committed_at: now,
    })
}

pub(crate) fn persist_yjs_genesis(
    connection: &Connection,
    input: PersistYjsGenesis<'_>,
) -> Result<PersistedDocumentCommit, StoreError> {
    if input.authority.head.generation < 1
        || input.authority.head.head_seq != 0
        || input.authority.head.readiness
            != crate::infrastructure::document_repository::DocumentReadiness::PendingGenesis
        || input.authority.head.authority
            != crate::infrastructure::document_repository::DocumentAuthority::LegacyShadow
        || input.authority.head.sync_engine
            != crate::infrastructure::document_repository::DocumentSyncEngine::Yjs
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Owned Document is not a pending Yjs genesis authority",
            false,
        ));
    }
    let now = sqlite_now(connection)?;
    validate_document_references(
        connection,
        &input.authority.head.project_id,
        input.materialization,
        false,
    )?;
    reconcile_document_blocks(connection, input.authority, input.materialization, 1, &now)?;
    persist_materialization(
        connection,
        &input.authority.head.id,
        input.authority.head.generation,
        1,
        input.materialization,
        &now,
    )?;
    let derived_touched_block_ids = std::iter::once(input.authority.owner_block_id.clone())
        .chain(
            input
                .materialization
                .search_units
                .iter()
                .map(|unit| unit.block_id.clone()),
        )
        .collect::<Vec<_>>();
    let derived_touched_json = serde_json::to_string(&derived_touched_block_ids)
        .map_err(|_| internal("Genesis touched Block IDs"))?;
    let update_hash = sha256(input.update);
    connection.execute(
        "INSERT INTO document_update_receipts (\
           document_id, generation, seq, update_id, client_session_id, base_head_seq, \
           client_touched_block_ids_json, derived_touched_block_ids_json, derivation_version, \
           update_hash, update_byte_length, committed_at\
         ) VALUES (?1, ?2, 1, ?3, ?4, 0, '[]', ?5, 1, ?6, ?7, ?8)",
        params![
            input.authority.head.id,
            input.authority.head.generation,
            input.update_id,
            input.client_session_id,
            derived_touched_json,
            update_hash,
            i64::try_from(input.update.len()).map_err(|_| internal("Genesis update length"))?,
            now,
        ],
    )?;
    connection.execute(
        "INSERT INTO document_updates (\
           document_id, generation, seq, update_id, client_session_id, base_head_seq, \
           touched_block_ids_json, update_blob, update_hash, committed_at\
         ) VALUES (?1, ?2, 1, ?3, ?4, 0, ?5, ?6, ?7, ?8)",
        params![
            input.authority.head.id,
            input.authority.head.generation,
            input.update_id,
            input.client_session_id,
            derived_touched_json,
            input.update,
            update_hash,
            now,
        ],
    )?;
    let snapshot_hash = sha256(input.full_state);
    connection.execute(
        "INSERT INTO document_snapshots (\
           document_id, generation, snapshot_seq, state_vector, snapshot_update, \
           snapshot_hash, schema_version, created_at\
         ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.authority.head.id,
            input.authority.head.generation,
            input.state_vector,
            input.full_state,
            snapshot_hash,
            input.authority.head.schema_version,
            now,
        ],
    )?;
    let changed = connection.execute(
        "UPDATE documents SET head_seq = 1, state_vector = ?1, state_hash = '', \
           readiness = 'ready', authority = 'ydoc_primary', updated_at = ?2 \
         WHERE id = ?3 AND generation = ?4 AND head_seq = 0 \
           AND readiness = 'pending_genesis' AND authority = 'legacy_shadow' \
           AND sync_engine = 'yjs'",
        params![
            input.state_vector,
            now,
            input.authority.head.id,
            input.authority.head.generation,
        ],
    )?;
    if changed != 1 {
        return Err(conflict("Document genesis authority changed before commit"));
    }
    replace_secondary_projections(
        connection,
        input.authority,
        input.materialization,
        1,
        &now,
        input.emit_event,
    )?;
    let event_sequence = if input.emit_event {
        let payload = json!({
            "module": "owned_document",
            "kind": "document_initialized",
            "documentId": input.authority.head.id,
            "generation": input.authority.head.generation,
            "headSeq": 1,
            "updateId": input.update_id,
            "updateHash": update_hash,
            "updateByteLength": input.update.len(),
        });
        let page_impact = input.authority.page_impact();
        let projection_impact = impact_for_page_document(
            page_impact.as_ref(),
            Some((&input.authority.head.id, input.authority.head.generation, 1)),
        )?;
        let database_ids = page_impact
            .as_ref()
            .and_then(|impact| impact.database.as_ref())
            .map(|database| vec![database.database_id.clone()])
            .unwrap_or_default();
        let document_ids = vec![input.authority.head.id.clone()];
        let payload_json =
            serde_json::to_string(&payload).map_err(|_| internal("Genesis event payload"))?;
        append_change_log(
            connection,
            NewChangeLogEntry {
                project_id: &input.authority.head.project_id,
                store_epoch: input.store_epoch,
                kind: "owned_document.document_initialized",
                operation_id: Some(input.operation_id),
                block_ids: &derived_touched_block_ids,
                document_ids: &document_ids,
                database_block_ids: &database_ids,
                payload_json: &payload_json,
                projection_impact: &projection_impact,
                committed_at: &now,
            },
        )?
    } else {
        connection.query_row("SELECT COALESCE(MAX(seq), 0) FROM change_log", [], |row| {
            row.get(0)
        })?
    };
    Ok(PersistedDocumentCommit {
        head_seq: 1,
        state_vector: input.state_vector.to_vec(),
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
                let typed_resource = TYPED_CREATION_BLOCK_TYPES.contains(&block_type.as_str());
                if (lifecycle != "active" && !typed_resource) || block_type != unit.block_type {
                    connection.execute(
                        "UPDATE blocks SET type = ?1, \
                           lifecycle = CASE WHEN ?2 THEN lifecycle ELSE 'active' END, \
                           metadata_revision = metadata_revision + 1, updated_at = ?3 WHERE id = ?4",
                        params![unit.block_type, typed_resource, now, unit.block_id],
                    )?;
                }
            }
        }
    }
    for (block_id, _, block_type, lifecycle, _, _) in &existing {
        if active_ids.contains(block_id) {
            continue;
        }
        if TYPED_CREATION_BLOCK_TYPES.contains(&block_type.as_str()) && lifecycle != "deleted" {
            return Err(invalid(format!(
                "Block {block_id} requires a typed lifecycle operation"
            )));
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

pub(super) fn replace_secondary_projections(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    materialization: &DocumentMaterialization,
    projected_seq: i64,
    now: &str,
    page_projection_required: bool,
) -> Result<(), StoreError> {
    if authority.owner_type == "page" {
        let updated = connection.execute(
            "UPDATE page_read_model SET document_generation = ?1, document_projected_seq = ?2, \
               document_schema_version = ?3, document_authority = 'ydoc_primary', title = ?4, \
               description_preview = ?5, description_length = ?6, has_description = ?7, \
               updated_at = ?8 WHERE page_block_id = ?9 AND document_id = ?10",
            params![
                authority.head.generation,
                projected_seq,
                authority.head.schema_version,
                materialization.title,
                materialization.preview,
                i64::try_from(materialization.nfm.len())
                    .map_err(|_| internal("Page description length overflow"))?,
                i64::from(!materialization.nfm.trim().is_empty()),
                now,
                authority.owner_block_id,
                authority.head.id,
            ],
        )?;
        if page_projection_required && updated != 1 {
            return Err(corrupt(
                "Page Document projection does not match its authority",
            ));
        }
    }
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

/// Rebuild only the derived rows for a validated legacy Yjs authority.
///
/// Startup migration calls this against an isolated candidate store. It never
/// rewrites the Yjs snapshot/update stream or advances the Document head.
pub(crate) fn rebuild_legacy_import_projections(
    connection: &Connection,
    document_id: &str,
    materialization: &DocumentMaterialization,
) -> Result<(), StoreError> {
    let authority = read_document_authority(connection, document_id)?
        .ok_or_else(|| corrupt("Legacy import Document has no authority"))?;
    let now = sqlite_now(connection)?;
    validate_document_references(
        connection,
        &authority.head.project_id,
        materialization,
        true,
    )?;
    reconcile_document_blocks(
        connection,
        &authority,
        materialization,
        authority.head.head_seq,
        &now,
    )?;
    persist_materialization(
        connection,
        document_id,
        authority.head.generation,
        authority.head.head_seq,
        materialization,
        &now,
    )?;
    replace_secondary_projections(
        connection,
        &authority,
        materialization,
        authority.head.head_seq,
        &now,
        true,
    )
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
    allow_legacy_diagnostics: bool,
) -> Result<(), StoreError> {
    for reference in &materialization.references {
        let valid = match reference {
            BlockDocumentReference::Block {
                target_block_id, ..
            } => block_reference_is_readable(
                connection,
                project_id,
                target_block_id,
                allow_legacy_diagnostics,
            )?,
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
        if valid {
            continue;
        }
        let reference_description = match reference {
            BlockDocumentReference::Block {
                source_block_id,
                target_block_id,
                ..
            } => format!(
                "unreadable Block reference from `{source_block_id}` to `{target_block_id}`"
            ),
            BlockDocumentReference::DatabaseView {
                source_block_id,
                database_view_id,
                ..
            } => format!(
                "unreadable Database View reference from `{source_block_id}` to `{database_view_id}`"
            ),
            BlockDocumentReference::Thread {
                source_block_id,
                target_thread_id,
            } => format!(
                "unreadable Thread reference from `{source_block_id}` to `{target_thread_id}`"
            ),
            BlockDocumentReference::LegacyCardProjection {
                source_block_id,
                target_block_id,
                ..
            } => format!(
                "legacy Card projection reference from `{source_block_id}` to `{target_block_id}`"
            ),
            BlockDocumentReference::LegacyDatabaseQuery {
                source_block_id,
                project_hint,
            } => format!(
                "legacy Database query reference from `{source_block_id}` for Project `{project_hint}`"
            ),
        };
        return Err(invalid(format!(
            "Document contains an {reference_description}"
        )));
    }
    Ok(())
}

fn block_reference_is_readable(
    connection: &Connection,
    project_id: &str,
    target_block_id: &str,
    allow_legacy_diagnostics: bool,
) -> Result<bool, StoreError> {
    let target = connection
        .query_row(
            "SELECT project_id, type, lifecycle FROM blocks WHERE id = ?1",
            [target_block_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((target_project_id, target_type, target_lifecycle)) = target else {
        return Ok(false);
    };
    if target_lifecycle == "deleted" {
        return Ok(allow_legacy_diagnostics
            && target_project_id == project_id
            && target_type == "unresolved_card_reference");
    }
    if target_type == "unresolved_card_reference" {
        return Ok(false);
    }
    if target_project_id == project_id {
        return Ok(true);
    }
    if target_type != "page" {
        return Ok(false);
    }
    let library_id = connection
        .query_row(
            "SELECT library_id FROM projects WHERE id = ?1",
            [project_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(library_id) = library_id else {
        return Ok(false);
    };
    match crate::library::require_page_read_access(
        connection,
        &library_id,
        project_id,
        target_block_id,
    ) {
        Ok(()) => Ok(true),
        Err(error)
            if matches!(
                error.code,
                StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

pub(crate) fn derive_touched_block_ids(
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
    StoreError::new(StoreErrorCode::HeadConflict, message, true)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
