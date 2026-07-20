use std::collections::{BTreeSet, VecDeque};
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::document::{rebuild_rehomed_document_projections, sha256};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const MAX_REHOME_BLOCKS: usize = 10_000;
const MAX_REHOME_DOCUMENTS: usize = 1_024;
const MAX_REHOME_DATABASES: usize = 1_024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(super) struct PreparedContentRehome {
    pub(super) operation_id: String,
    pub(super) call_identity: String,
    pub(super) request_hash: String,
    pub(super) actor_project_id: String,
    pub(super) source_project_id: String,
    pub(super) target_project_id: String,
    pub(super) library_id: String,
    pub(super) store_epoch: String,
    pub(super) root_page_ids: Vec<String>,
    pub(super) page_ids: Vec<String>,
    pub(super) block_ids: Vec<String>,
    pub(super) document_ids: Vec<String>,
    pub(super) database_block_ids: Vec<String>,
    pub(super) database_view_ids: Vec<String>,
    authority_hash: String,
}

pub(super) struct PrepareContentRehome<'a> {
    pub(super) operation_id: &'a str,
    pub(super) call_identity: &'a str,
    pub(super) actor_project_id: &'a str,
    pub(super) source_project_id: &'a str,
    pub(super) target_project_id: &'a str,
    pub(super) library_id: &'a str,
    pub(super) store_epoch: &'a str,
    pub(super) root_page_ids: &'a [String],
}

pub(super) fn prepare_content_rehome(
    connection: &Connection,
    input: PrepareContentRehome<'_>,
) -> Result<PreparedContentRehome, StoreError> {
    if input.root_page_ids.is_empty() {
        return Err(invalid("Library content rehome requires a Page root"));
    }
    if input.call_identity.len() != 64 {
        return Err(invalid("Library content rehome call identity is invalid"));
    }
    let mut root_page_ids = input.root_page_ids.to_vec();
    root_page_ids.sort();
    root_page_ids.dedup();
    if root_page_ids.len() != input.root_page_ids.len() {
        return Err(invalid("Library content rehome Page roots must be unique"));
    }
    validate_projects(connection, &input)?;

    let mut block_ids = BTreeSet::new();
    let mut document_ids = BTreeSet::new();
    let mut database_block_ids = BTreeSet::new();
    let mut pending = VecDeque::from(root_page_ids.clone());
    let mut visited_owners = BTreeSet::new();
    let mut scanned_databases = BTreeSet::new();
    while let Some(owner_id) = pending.pop_front() {
        if !visited_owners.insert(owner_id.clone()) {
            continue;
        }
        if visited_owners.len() > MAX_REHOME_DOCUMENTS {
            return Err(invalid("Library content rehome exceeds its Document bound"));
        }
        let owner = read_block(connection, input.source_project_id, &owner_id)?
            .ok_or_else(|| not_found(format!("Ownership root does not exist: {owner_id}")))?;
        insert_block(&mut block_ids, &mut database_block_ids, &owner)?;
        scan_new_databases(
            connection,
            input.source_project_id,
            &database_block_ids,
            &mut scanned_databases,
            &mut pending,
        )?;

        let document_id = connection
            .query_row(
                "SELECT document_id FROM block_documents \
                 WHERE block_id = ?1 AND project_id = ?2",
                params![owner_id, input.source_project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(document_id) = document_id else {
            continue;
        };
        if !document_ids.insert(document_id.clone()) {
            return Err(corrupt("Document ownership closure contains a cycle"));
        }
        let indexed = connection
            .prepare(
                "SELECT block.id, block.type, block.lifecycle, block.containing_document_id, \
                        block.location_revision, block.metadata_revision \
                 FROM document_block_index entry JOIN blocks block ON block.id = entry.block_id \
                 WHERE entry.document_id = ?1 AND block.project_id = ?2 \
                 ORDER BY entry.ordinal, entry.block_id",
            )?
            .query_map(params![document_id, input.source_project_id], block_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let physical = connection
            .prepare(
                "SELECT id FROM blocks WHERE containing_document_id = ?1 AND project_id = ?2 \
                   AND lifecycle <> 'deleted' ORDER BY id",
            )?
            .query_map(params![document_id, input.source_project_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut indexed_ids = indexed
            .iter()
            .map(|block| block.id.clone())
            .collect::<Vec<_>>();
        indexed_ids.sort();
        indexed_ids.dedup();
        if indexed_ids != physical {
            return Err(corrupt(format!(
                "Document {document_id} has an unknown Block projection"
            )));
        }
        for block in indexed {
            insert_block(&mut block_ids, &mut database_block_ids, &block)?;
            let owns_document = connection
                .query_row(
                    "SELECT 1 FROM block_documents WHERE block_id = ?1 AND project_id = ?2",
                    params![block.id, input.source_project_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if owns_document {
                pending.push_back(block.id);
            }
        }
        scan_new_databases(
            connection,
            input.source_project_id,
            &database_block_ids,
            &mut scanned_databases,
            &mut pending,
        )?;
        if block_ids.len() > MAX_REHOME_BLOCKS {
            return Err(invalid("Library content rehome exceeds its Block bound"));
        }
        if database_block_ids.len() > MAX_REHOME_DATABASES {
            return Err(invalid("Library content rehome exceeds its Database bound"));
        }
    }
    if document_ids.is_empty() || block_ids.len() < root_page_ids.len() {
        return Err(corrupt("Page ownership closure is incomplete"));
    }
    validate_page_coordinates(
        connection,
        input.library_id,
        input.source_project_id,
        &block_ids,
    )?;

    let mut database_view_ids = Vec::new();
    for database_id in &database_block_ids {
        database_view_ids.extend(
            connection
                .prepare("SELECT id FROM database_views WHERE database_block_id = ?1 ORDER BY id")?
                .query_map([database_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        );
    }
    let block_ids = block_ids.into_iter().collect::<Vec<_>>();
    let document_ids = document_ids.into_iter().collect::<Vec<_>>();
    let database_block_ids = database_block_ids.into_iter().collect::<Vec<_>>();
    let page_ids = read_page_ids(connection, &block_ids)?;
    let authority_hash = authority_hash(
        connection,
        input.source_project_id,
        &block_ids,
        &document_ids,
    )?;
    let request_hash = hash_serializable(&(
        input.operation_id,
        input.call_identity,
        input.actor_project_id,
        input.source_project_id,
        input.target_project_id,
        input.library_id,
        input.store_epoch,
        &root_page_ids,
        &page_ids,
        &block_ids,
        &document_ids,
        &database_block_ids,
        &database_view_ids,
        &authority_hash,
    ))?;
    Ok(PreparedContentRehome {
        operation_id: input.operation_id.to_owned(),
        call_identity: input.call_identity.to_owned(),
        request_hash,
        actor_project_id: input.actor_project_id.to_owned(),
        source_project_id: input.source_project_id.to_owned(),
        target_project_id: input.target_project_id.to_owned(),
        library_id: input.library_id.to_owned(),
        store_epoch: input.store_epoch.to_owned(),
        root_page_ids,
        page_ids,
        block_ids,
        document_ids,
        database_block_ids,
        database_view_ids,
        authority_hash,
    })
}

pub(super) fn remove_prevalidated_content_rehome_projections(
    connection: &Connection,
    prepared: &PreparedContentRehome,
) -> Result<(), StoreError> {
    for page_id in &prepared.page_ids {
        connection.execute(
            "DELETE FROM page_read_model WHERE page_block_id = ?1",
            [page_id],
        )?;
        connection.execute(
            "DELETE FROM scheduled_page_index WHERE page_block_id = ?1",
            [page_id],
        )?;
    }
    Ok(())
}

pub(super) fn apply_prevalidated_content_rehome(
    connection: &Connection,
    prepared: &PreparedContentRehome,
    now: &str,
    assets_root: &Path,
) -> Result<(), StoreError> {
    if prepared.source_project_id == prepared.target_project_id {
        return Ok(());
    }
    connection.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    for document_id in &prepared.document_ids {
        connection.execute(
            "DELETE FROM block_asset_refs WHERE document_id = ?1",
            [document_id],
        )?;
        connection.execute(
            "DELETE FROM block_search_units WHERE document_id = ?1 AND source_revision IS NULL",
            [document_id],
        )?;
        connection.execute(
            "DELETE FROM canvas_scene_file_refs WHERE document_id = ?1",
            [document_id],
        )?;
        connection.execute(
            "DELETE FROM canvas_page_references WHERE document_id = ?1",
            [document_id],
        )?;
    }
    for document_id in &prepared.document_ids {
        require_single_update(
            connection.execute(
                "UPDATE documents SET project_id = ?1 WHERE id = ?2 AND project_id = ?3",
                params![
                    prepared.target_project_id,
                    document_id,
                    prepared.source_project_id
                ],
            )?,
            "Document ownership changed after Page-move prepare",
        )?;
    }
    for block_id in &prepared.block_ids {
        require_single_update(
            connection.execute(
                "UPDATE blocks SET project_id = ?1 WHERE id = ?2 AND project_id = ?3",
                params![
                    prepared.target_project_id,
                    block_id,
                    prepared.source_project_id
                ],
            )?,
            "Block ownership changed after Page-move prepare",
        )?;
    }
    for document_id in &prepared.document_ids {
        require_single_update(
            connection.execute(
                "UPDATE block_documents SET project_id = ?1 \
                 WHERE document_id = ?2 AND project_id = ?3",
                params![
                    prepared.target_project_id,
                    document_id,
                    prepared.source_project_id
                ],
            )?,
            "Document owner changed after Page-move prepare",
        )?;
    }
    for root_page_id in &prepared.root_page_ids {
        connection.execute(
            "UPDATE top_level_block_placements SET project_id = ?1 \
             WHERE block_id = ?2 AND project_id = ?3",
            params![
                prepared.target_project_id,
                root_page_id,
                prepared.source_project_id
            ],
        )?;
    }
    for page_id in &prepared.page_ids {
        seed_page_read_model(connection, page_id, now)?;
        let membership = connection
            .query_row(
                "SELECT id, data_source_id FROM data_source_page_memberships \
                 WHERE page_block_id = ?1 AND removed_at IS NULL",
                [page_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        crate::database::refresh_copied_page_projection(
            connection,
            page_id,
            membership.as_ref().map(|membership| membership.0.as_str()),
            membership.as_ref().map(|membership| membership.1.as_str()),
            now,
        )?;
        super::mutation::refresh_page_intrinsic_projection(
            connection,
            page_id,
            &prepared.target_project_id,
            now,
        )?;
    }
    for document_id in &prepared.document_ids {
        rebuild_rehomed_document_projections(connection, document_id, now, assets_root)?;
    }
    for page_id in &prepared.page_ids {
        crate::automation::refresh_scheduled_index(connection, page_id, now)?;
    }
    if count_wrong_project(
        connection,
        "blocks",
        "id",
        &prepared.block_ids,
        &prepared.target_project_id,
    )? != 0
        || count_wrong_project(
            connection,
            "documents",
            "id",
            &prepared.document_ids,
            &prepared.target_project_id,
        )? != 0
    {
        return Err(corrupt("Library content rehome left split ownership"));
    }
    assert_foreign_keys(connection)?;
    connection.execute(
        "INSERT INTO library_content_relocations( \
           operation_id, call_identity, actor_project_id, source_project_id, target_project_id, \
           library_id, store_epoch, request_hash, root_page_ids_json, block_ids_json, \
           document_ids_json, status, committed_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'committed', ?12)",
        params![
            prepared.operation_id,
            prepared.call_identity,
            prepared.actor_project_id,
            prepared.source_project_id,
            prepared.target_project_id,
            prepared.library_id,
            prepared.store_epoch,
            prepared.request_hash,
            encode_ids(&prepared.root_page_ids, "Rehome Page IDs")?,
            encode_ids(&prepared.block_ids, "Rehome Block IDs")?,
            encode_ids(&prepared.document_ids, "Rehome Document IDs")?,
            now,
        ],
    )?;
    for block_id in &prepared.block_ids {
        insert_member(connection, prepared, "block", block_id)?;
    }
    for document_id in &prepared.document_ids {
        insert_member(connection, prepared, "document", document_id)?;
    }
    assert_foreign_keys(connection)
}

#[derive(Clone, Serialize)]
struct BlockRow {
    id: String,
    block_type: String,
    lifecycle: String,
    containing_document_id: Option<String>,
    location_revision: i64,
    metadata_revision: i64,
}

fn block_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BlockRow> {
    Ok(BlockRow {
        id: row.get(0)?,
        block_type: row.get(1)?,
        lifecycle: row.get(2)?,
        containing_document_id: row.get(3)?,
        location_revision: row.get(4)?,
        metadata_revision: row.get(5)?,
    })
}

fn read_block(
    connection: &Connection,
    project_id: &str,
    block_id: &str,
) -> Result<Option<BlockRow>, StoreError> {
    connection
        .query_row(
            "SELECT id, type, lifecycle, containing_document_id, \
                    location_revision, metadata_revision \
             FROM blocks WHERE id = ?1 AND project_id = ?2 AND lifecycle <> 'deleted'",
            params![block_id, project_id],
            block_row,
        )
        .optional()
        .map_err(StoreError::from)
}

fn insert_block(
    block_ids: &mut BTreeSet<String>,
    database_block_ids: &mut BTreeSet<String>,
    block: &BlockRow,
) -> Result<(), StoreError> {
    if block.lifecycle == "deleted" {
        return Err(corrupt("Deleted Block entered a live ownership closure"));
    }
    block_ids.insert(block.id.clone());
    if block.block_type == "database" {
        database_block_ids.insert(block.id.clone());
    }
    Ok(())
}

fn scan_new_databases(
    connection: &Connection,
    source_project_id: &str,
    database_block_ids: &BTreeSet<String>,
    scanned_databases: &mut BTreeSet<String>,
    pending: &mut VecDeque<String>,
) -> Result<(), StoreError> {
    for database_id in database_block_ids {
        if !scanned_databases.insert(database_id.clone()) {
            continue;
        }
        let is_bound = connection
            .query_row(
                "SELECT 1 FROM project_database_bindings \
                 WHERE database_block_id = ?1 AND lifecycle = 'active' LIMIT 1",
                [database_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if is_bound {
            return Err(invalid("A Project-bound Database cannot be rehomed"));
        }
        pending.extend(
            connection
                .prepare(
                    "SELECT membership.page_block_id \
                     FROM data_source_page_memberships membership \
                     JOIN data_sources source ON source.id = membership.data_source_id \
                     JOIN blocks page ON page.id = membership.page_block_id \
                     WHERE page.project_id = ?1 AND membership.removed_at IS NULL \
                       AND source.home_database_block_id = ?2 ORDER BY membership.page_block_id",
                )?
                .query_map(params![source_project_id, database_id], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        );
    }
    Ok(())
}

fn validate_projects(
    connection: &Connection,
    input: &PrepareContentRehome<'_>,
) -> Result<(), StoreError> {
    let actor = read_project(connection, input.actor_project_id)?;
    let source = read_project(connection, input.source_project_id)?;
    let target = read_project(connection, input.target_project_id)?;
    if actor.0 != input.library_id || source.0 != input.library_id || target.0 != input.library_id {
        return Err(unauthorized(
            "Library content rehome cannot cross Library boundaries",
        ));
    }
    if actor.1 != "active" || source.1 == "archived" || target.1 != "active" {
        return Err(unauthorized(
            "Library content rehome requires an active actor and target Project",
        ));
    }
    Ok(())
}

fn read_project(connection: &Connection, project_id: &str) -> Result<(String, String), StoreError> {
    connection
        .query_row(
            "SELECT library_id, lifecycle FROM projects WHERE id = ?1",
            [project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| not_found(format!("Project does not exist: {project_id}")))
}

fn validate_page_coordinates(
    connection: &Connection,
    library_id: &str,
    source_project_id: &str,
    block_ids: &BTreeSet<String>,
) -> Result<(), StoreError> {
    for block_id in block_ids {
        let page = connection
            .query_row(
                "SELECT page.document_id, page.parent_kind, page.parent_id, page.lifecycle, \
                        block.location_kind, block.containing_document_id, \
                        block.containing_database_id, block.location_revision, page.parent_revision \
                 FROM pages page JOIN blocks block ON block.id = page.block_id \
                 WHERE page.block_id = ?1 AND page.library_id = ?2 AND block.project_id = ?3",
                params![block_id, library_id, source_project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                    ))
                },
            )
            .optional()?;
        let Some(page) = page else {
            continue;
        };
        let owns_document = connection
            .query_row(
                "SELECT 1 FROM block_documents WHERE block_id = ?1 \
                   AND document_id = ?2 AND project_id = ?3",
                params![block_id, page.0, source_project_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        let parent_valid = match page.1.as_str() {
            "library" => {
                page.2 == library_id && page.4 == "space" && page.5.is_none() && page.6.is_none()
            }
            "page" => {
                page.4 == "document"
                    && page.6.is_none()
                    && page.5 == read_page_document(connection, &page.2)?
            }
            "data_source" => {
                page.4 == "database"
                    && page.5.is_none()
                    && page.6 == read_data_source_database(connection, library_id, &page.2)?
                    && has_active_membership(connection, block_id, &page.2)?
            }
            _ => false,
        };
        if page.3 == "deleted" || page.7 != page.8 || !owns_document || !parent_valid {
            return Err(corrupt(format!(
                "Page {block_id} canonical and physical ownership coordinates diverge"
            )));
        }
    }
    Ok(())
}

fn read_page_document(
    connection: &Connection,
    page_id: &str,
) -> Result<Option<String>, StoreError> {
    connection
        .query_row(
            "SELECT document_id FROM pages WHERE block_id = ?1",
            [page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(StoreError::from)
}

fn read_data_source_database(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<Option<String>, StoreError> {
    connection
        .query_row(
            "SELECT home_database_block_id FROM data_sources \
             WHERE id = ?1 AND library_id = ?2 AND lifecycle <> 'deleted'",
            params![data_source_id, library_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(StoreError::from)
}

fn has_active_membership(
    connection: &Connection,
    page_id: &str,
    data_source_id: &str,
) -> Result<bool, StoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM data_source_page_memberships \
             WHERE page_block_id = ?1 AND data_source_id = ?2 AND removed_at IS NULL",
            params![page_id, data_source_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn authority_hash(
    connection: &Connection,
    source_project_id: &str,
    block_ids: &[String],
    document_ids: &[String],
) -> Result<String, StoreError> {
    let blocks = block_ids
        .iter()
        .map(|block_id| {
            connection.query_row(
                "SELECT id, type, lifecycle, location_kind, containing_document_id, \
                        containing_database_id, location_revision, metadata_revision \
                 FROM blocks WHERE id = ?1 AND project_id = ?2",
                params![block_id, source_project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let documents = document_ids
        .iter()
        .map(|document_id| {
            connection.query_row(
                "SELECT id, generation, head_seq, schema_key, schema_version, state_hash, \
                        readiness, authority, sync_engine \
                 FROM documents WHERE id = ?1 AND project_id = ?2",
                params![document_id, source_project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                    ))
                },
            )
        })
        .collect::<rusqlite::Result<Vec<_>>>()?;
    hash_serializable(&(blocks, documents))
}

fn read_page_ids(connection: &Connection, block_ids: &[String]) -> Result<Vec<String>, StoreError> {
    let mut page_ids = Vec::new();
    for block_id in block_ids {
        if connection
            .query_row(
                "SELECT 1 FROM pages WHERE block_id = ?1",
                [block_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            page_ids.push(block_id.clone());
        }
    }
    Ok(page_ids)
}

fn seed_page_read_model(
    connection: &Connection,
    page_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    let inserted = connection.execute(
        "INSERT INTO page_read_model( \
           page_block_id, project_id, lifecycle, location_kind, containing_document_id, \
           containing_database_id, top_level_rank_key, location_revision, metadata_revision, \
           document_id, document_generation, document_projected_seq, document_schema_version, \
           document_authority, membership_id, database_block_id, view_id, view_group_key, \
           view_rank_key, title, description_preview, description_length, has_description, \
           database_values_json, intrinsic_properties_json, property_revisions_json, \
           projection_version, created_at, updated_at) \
         SELECT block.id, block.project_id, page.lifecycle, block.location_kind, \
                block.containing_document_id, block.containing_database_id, placement.rank_key, \
                block.location_revision, block.metadata_revision, document.id, \
                document.generation, document.head_seq, document.schema_version, \
                document.authority, NULL, NULL, NULL, NULL, NULL, '', '', 0, 0, '{}', '{}', '{}', \
                1, block.created_at, ?2 \
         FROM blocks block JOIN pages page ON page.block_id = block.id \
         JOIN documents document ON document.id = page.document_id \
         LEFT JOIN top_level_block_placements placement ON placement.block_id = block.id \
         WHERE block.id = ?1",
        params![page_id, now],
    )?;
    require_single_update(inserted, "Rehomed Page authority disappeared")
}

fn count_wrong_project(
    connection: &Connection,
    table: &str,
    id_column: &str,
    ids: &[String],
    target_project_id: &str,
) -> Result<i64, StoreError> {
    let mut count = 0;
    for id in ids {
        count += connection.query_row(
            &format!("SELECT count(*) FROM {table} WHERE {id_column} = ?1 AND project_id <> ?2"),
            params![id, target_project_id],
            |row| row.get::<_, i64>(0),
        )?;
    }
    Ok(count)
}

fn insert_member(
    connection: &Connection,
    prepared: &PreparedContentRehome,
    kind: &str,
    resource_id: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO library_content_relocation_members( \
           operation_id, resource_kind, resource_id, source_project_id, final_project_id) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            prepared.operation_id,
            kind,
            resource_id,
            prepared.source_project_id,
            prepared.target_project_id,
        ],
    )?;
    Ok(())
}

fn assert_foreign_keys(connection: &Connection) -> Result<(), StoreError> {
    let count = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_map([], |_| Ok(()))?
        .count();
    if count != 0 {
        return Err(corrupt(format!(
            "Library content rehome produced {count} foreign-key violation(s)"
        )));
    }
    Ok(())
}

fn require_single_update(count: usize, message: &str) -> Result<(), StoreError> {
    if count == 1 {
        return Ok(());
    }
    Err(conflict(message))
}

fn encode_ids(ids: &[String], label: &str) -> Result<String, StoreError> {
    serde_json::to_string(ids).map_err(|_| corrupt(format!("{label} cannot be encoded")))
}

fn hash_serializable(value: &impl Serialize) -> Result<String, StoreError> {
    serde_json::to_vec(value)
        .map(|bytes| sha256(&bytes))
        .map_err(|_| corrupt("Library content rehome authority cannot be fingerprinted"))
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn unauthorized(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn not_found(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn conflict(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::RevisionConflict, message, true)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
