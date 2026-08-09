use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::Value;

use crate::domain::block_materialization::MaterializedBlockNode;
use crate::infrastructure::document_repository::{
    DocumentAuthority, DocumentReadiness, DocumentSyncEngine,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::canvas_scene::{CANVAS_OWNER_TYPE, CANVAS_SCHEMA_KEY, CANVAS_SCHEMA_VERSION};
use super::history::{prune_document_history, read_document_version_retention_evidence};
use super::{
    BlockDocumentSchema, decode_block_document, load_canvas_scene, materialize_decoded_document,
    read_document_authority, reconstruct_yjs_engine, schema_metadata,
};

const MAX_CANDIDATES_PER_PROJECT: usize = 100;
const MAX_RETAINED_DOCUMENT_VERSIONS_TO_INSPECT: usize = 10_000;

const DOCUMENT_BEARING_BLOCK_TYPES: [&str; 4] = [
    "page",
    "synced_block_source",
    "reusable_template_source",
    CANVAS_OWNER_TYPE,
];

const KNOWN_INBOUND_AUTHORITY_TABLES: [&str; 32] = [
    "block_asset_refs",
    "block_documents",
    "block_properties",
    "block_relocation_members",
    "block_relocations",
    "block_search_units",
    "blocks",
    "canvas_page_references",
    "canvas_scene_elements",
    "canvas_scene_file_refs",
    "canvas_scene_files",
    "canvas_scene_mutation_receipts",
    "canvas_scenes",
    "data_source_page_memberships",
    "data_source_relation_edges",
    "data_source_relation_properties",
    "database_view_page_positions",
    "document_block_index",
    "document_materializations",
    "document_recovery_artifacts",
    "document_snapshots",
    "document_update_receipts",
    "document_updates",
    "document_versions",
    "library_block_placements",
    "page_read_model",
    "pages",
    "recurrence_exceptions",
    "reminder_receipts",
    "reminder_snoozes",
    "scheduled_page_index",
    "top_level_block_placements",
];

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct BlockRetentionSummary {
    pub(crate) selected_candidates: usize,
    pub(crate) collected_candidates: usize,
    pub(crate) collected_blocks: usize,
    pub(crate) retained_candidates: usize,
    pub(crate) covered_candidates: usize,
    pub(crate) failed_candidates: usize,
}

#[derive(Debug, Clone)]
struct BlockRow {
    id: String,
    project_id: String,
    block_type: String,
    lifecycle: String,
}

#[derive(Debug)]
struct CandidateClosure {
    root_block_id: String,
    project_id: String,
    block_ids: BTreeSet<String>,
    document_ids: BTreeSet<String>,
    owner_block_ids: BTreeSet<String>,
}

#[derive(Debug)]
struct CandidateAnalysis {
    collectible: bool,
    prunable_recovery_artifact_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct ForeignKeyColumn {
    id: i64,
    referenced_table: String,
    from_column: String,
    to_column: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CandidateOutcome {
    Collected(BTreeSet<String>),
    Retained,
    Covered,
}

pub(crate) fn run_block_retention_pass(
    connection: &mut Connection,
    retain_newest_deleted_blocks: usize,
) -> Result<BlockRetentionSummary, StoreError> {
    let foreign_key_violations =
        connection.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if foreign_key_violations != 0 {
        return Err(corrupt(format!(
            "Block retention found {foreign_key_violations} foreign-key violations"
        )));
    }
    let project_ids = connection
        .prepare("SELECT id FROM projects ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut summary = BlockRetentionSummary::default();
    let mut first_failure = None;
    for project_id in project_ids {
        let candidates =
            read_candidate_roots(connection, &project_id, retain_newest_deleted_blocks)?;
        summary.selected_candidates = summary
            .selected_candidates
            .checked_add(candidates.len())
            .ok_or_else(|| corrupt("Block retention candidate count overflowed"))?;
        let mut retained_roots = BTreeSet::new();
        for root_block_id in candidates {
            match maintain_candidate(
                connection,
                &project_id,
                &root_block_id,
                retain_newest_deleted_blocks,
            ) {
                Ok(CandidateOutcome::Collected(block_ids)) => {
                    summary.collected_candidates += 1;
                    summary.collected_blocks = summary
                        .collected_blocks
                        .checked_add(block_ids.len())
                        .ok_or_else(|| corrupt("Collected Block count overflowed"))?;
                    for block_id in block_ids {
                        if retained_roots.remove(&block_id) {
                            summary.retained_candidates -= 1;
                            summary.covered_candidates += 1;
                        }
                    }
                }
                Ok(CandidateOutcome::Retained) => {
                    summary.retained_candidates += 1;
                    retained_roots.insert(root_block_id);
                }
                Ok(CandidateOutcome::Covered) => summary.covered_candidates += 1,
                Err(error) => {
                    summary.failed_candidates += 1;
                    if first_failure.is_none() {
                        first_failure = Some(error);
                    }
                }
            }
        }
    }
    if let Some(error) = first_failure {
        return Err(error);
    }
    Ok(summary)
}

fn read_candidate_roots(
    connection: &Connection,
    project_id: &str,
    retain_newest_deleted_blocks: usize,
) -> Result<Vec<String>, StoreError> {
    let retain_count = i64::try_from(retain_newest_deleted_blocks)
        .map_err(|_| invalid("Block retention count exceeds SQLite bounds"))?;
    let candidate_count = i64::try_from(MAX_CANDIDATES_PER_PROJECT)
        .map_err(|_| internal("Block retention candidate bound overflowed"))?;
    connection
        .prepare(
            "SELECT id FROM blocks \
             WHERE project_id = ?1 AND lifecycle = 'deleted' \
               AND id NOT IN ( \
                 SELECT id FROM blocks \
                 WHERE project_id = ?1 AND lifecycle = 'deleted' \
                 ORDER BY updated_at DESC, id DESC LIMIT ?2 \
               ) \
             ORDER BY updated_at, id LIMIT ?3",
        )?
        .query_map(params![project_id, retain_count, candidate_count], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

fn maintain_candidate(
    connection: &mut Connection,
    project_id: &str,
    root_block_id: &str,
    retain_newest_deleted_blocks: usize,
) -> Result<CandidateOutcome, StoreError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(root) = read_block(&transaction, root_block_id)? else {
        return Ok(CandidateOutcome::Covered);
    };
    if root.project_id != project_id || root.lifecycle != "deleted" {
        return Ok(CandidateOutcome::Covered);
    }
    let Some(closure) = build_candidate_closure(&transaction, project_id, root_block_id)? else {
        return Ok(CandidateOutcome::Retained);
    };
    if closure_intersects_newest_tombstones(&transaction, &closure, retain_newest_deleted_blocks)? {
        return Ok(CandidateOutcome::Retained);
    }
    let now = sqlite_now(&transaction)?;
    for document_id in &closure.document_ids {
        prune_document_history(&transaction, document_id, &now)?;
    }
    let analysis = analyze_candidate(&transaction, &closure)?;
    if !analysis.collectible {
        return Ok(CandidateOutcome::Retained);
    }
    delete_exact_recovery_artifacts(&transaction, &analysis.prunable_recovery_artifact_ids)?;
    let Some(replanned) = build_candidate_closure(&transaction, project_id, root_block_id)? else {
        return Ok(CandidateOutcome::Retained);
    };
    let post_prune = analyze_candidate(&transaction, &replanned)?;
    if !post_prune.collectible || !post_prune.prunable_recovery_artifact_ids.is_empty() {
        return Ok(CandidateOutcome::Retained);
    }
    let collected = collect_candidate_closure(&transaction, &replanned, &now)?;
    transaction.commit()?;
    Ok(CandidateOutcome::Collected(collected))
}

fn build_candidate_closure(
    connection: &Connection,
    project_id: &str,
    root_block_id: &str,
) -> Result<Option<CandidateClosure>, StoreError> {
    let Some(root) = read_block(connection, root_block_id)? else {
        return Ok(None);
    };
    if root.project_id != project_id || root.lifecycle != "deleted" {
        return Ok(None);
    }
    let mut closure = CandidateClosure {
        root_block_id: root.id.clone(),
        project_id: project_id.to_owned(),
        block_ids: BTreeSet::from([root.id.clone()]),
        document_ids: BTreeSet::new(),
        owner_block_ids: BTreeSet::new(),
    };
    let mut pending = vec![root];
    while let Some(block) = pending.pop() {
        let ownership = connection
            .query_row(
                "SELECT block_id, document_id, project_id FROM block_documents \
                 WHERE block_id = ?1",
                [&block.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((owner_block_id, document_id, ownership_project_id)) = ownership else {
            if DOCUMENT_BEARING_BLOCK_TYPES.contains(&block.block_type.as_str()) {
                return Ok(None);
            }
            continue;
        };
        if owner_block_id != block.id
            || ownership_project_id != project_id
            || closure.document_ids.contains(&document_id)
        {
            return Ok(None);
        }
        let document = connection
            .query_row(
                "SELECT project_id, schema_key, schema_version, readiness, authority, sync_engine \
                 FROM documents WHERE id = ?1",
                [&document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            document_project_id,
            schema_key,
            schema_version,
            readiness,
            authority,
            sync_engine,
        )) = document
        else {
            return Ok(None);
        };
        if document_project_id != project_id
            || readiness != "ready"
            || authority != "ydoc_primary"
            || !registered_owner_schema(
                &block.block_type,
                &schema_key,
                schema_version,
                &sync_engine,
            )
        {
            return Ok(None);
        }
        closure.document_ids.insert(document_id.clone());
        closure.owner_block_ids.insert(block.id.clone());
        let children = connection
            .prepare(
                "SELECT id, project_id, type, lifecycle FROM blocks \
                 WHERE containing_document_id = ?1 AND project_id = ?2 ORDER BY id",
            )?
            .query_map(params![document_id, project_id], decode_block_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for child in children {
            if child.lifecycle != "deleted" {
                return Ok(None);
            }
            if closure.block_ids.insert(child.id.clone()) {
                pending.push(child);
            }
        }
    }
    Ok(Some(closure))
}

fn registered_owner_schema(
    owner_type: &str,
    schema_key: &str,
    schema_version: i64,
    sync_engine: &str,
) -> bool {
    if owner_type == CANVAS_OWNER_TYPE {
        return schema_key == CANVAS_SCHEMA_KEY
            && schema_version == CANVAS_SCHEMA_VERSION
            && sync_engine == "canvas_scene";
    }
    let Some(schema) = BlockDocumentSchema::from_identity(schema_key, schema_version) else {
        return false;
    };
    schema_metadata(schema).owner_type == owner_type && sync_engine == "yjs"
}

fn closure_intersects_newest_tombstones(
    connection: &Connection,
    closure: &CandidateClosure,
    retain_newest_deleted_blocks: usize,
) -> Result<bool, StoreError> {
    if retain_newest_deleted_blocks == 0 {
        return Ok(false);
    }
    let limit = i64::try_from(retain_newest_deleted_blocks)
        .map_err(|_| invalid("Block retention count exceeds SQLite bounds"))?;
    let retained = connection
        .prepare(
            "SELECT id FROM blocks WHERE project_id = ?1 AND lifecycle = 'deleted' \
             ORDER BY updated_at DESC, id DESC LIMIT ?2",
        )?
        .query_map(params![closure.project_id, limit], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(retained
        .iter()
        .any(|block_id| closure.block_ids.contains(block_id)))
}

fn analyze_candidate(
    connection: &Connection,
    closure: &CandidateClosure,
) -> Result<CandidateAnalysis, StoreError> {
    let block_ids_json = identities_json(&closure.block_ids)?;
    let document_ids_json = identities_json(&closure.document_ids)?;
    let database_view_ids = read_database_view_ids(connection, &block_ids_json)?;
    let database_view_ids_json = identities_json(&database_view_ids)?;
    if has_unknown_inbound_reference(connection, closure)?
        || has_current_authority_reference(connection, closure, &database_view_ids)?
        || has_historical_reference(connection, closure, &database_view_ids)?
        || has_cross_project_immutable_reference(connection, closure)?
        || has_relocation_reference(connection, closure)?
        || has_relational_reference(
            connection,
            closure,
            &block_ids_json,
            &document_ids_json,
            &database_view_ids_json,
        )?
        || has_page_behavior_reference(connection, closure, &block_ids_json)?
    {
        return Ok(CandidateAnalysis {
            collectible: false,
            prunable_recovery_artifact_ids: Vec::new(),
        });
    }
    let Some(prunable_recovery_artifact_ids) =
        read_prunable_recovery_artifacts(connection, closure)?
    else {
        return Ok(CandidateAnalysis {
            collectible: false,
            prunable_recovery_artifact_ids: Vec::new(),
        });
    };
    let retained_owned_versions = connection.query_row(
        "SELECT count(*) FROM document_versions \
         WHERE document_id IN (SELECT value FROM json_each(?1))",
        [&document_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(CandidateAnalysis {
        collectible: retained_owned_versions == 0,
        prunable_recovery_artifact_ids,
    })
}

fn has_current_authority_reference(
    connection: &Connection,
    closure: &CandidateClosure,
    database_view_ids: &BTreeSet<String>,
) -> Result<bool, StoreError> {
    let document_ids = connection
        .prepare("SELECT id FROM documents ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for document_id in document_ids {
        if closure.document_ids.contains(&document_id) {
            continue;
        }
        let authority = read_document_authority(connection, &document_id)?
            .ok_or_else(|| corrupt("Document authority has no registered owner"))?;
        if authority.head.readiness != DocumentReadiness::Ready
            || authority.head.authority != DocumentAuthority::YdocPrimary
        {
            return Ok(true);
        }
        match authority.head.sync_engine {
            DocumentSyncEngine::Yjs => {
                let Some(schema) = BlockDocumentSchema::from_identity(
                    &authority.head.schema_key,
                    authority.head.schema_version,
                ) else {
                    return Ok(true);
                };
                if schema_metadata(schema).owner_type != authority.owner_type {
                    return Ok(true);
                }
                let engine = reconstruct_yjs_engine(connection, &authority.head)?;
                let decoded = decode_block_document(engine.document(), schema)
                    .map_err(|_| corrupt("Current Yjs authority cannot be decoded"))?;
                let materialization = materialize_decoded_document(&decoded)
                    .map_err(|_| corrupt("Current Yjs authority cannot be materialized"))?;
                if materialized_blocks_intersect(&materialization.block_tree, &closure.block_ids)
                    || materialization.references.iter().any(|reference| {
                        reference
                            .target_block_id()
                            .is_some_and(|block_id| closure.block_ids.contains(block_id))
                            || reference
                                .database_view_id()
                                .is_some_and(|view_id| database_view_ids.contains(view_id))
                    })
                {
                    return Ok(true);
                }
            }
            DocumentSyncEngine::CanvasScene => {
                let scene = load_canvas_scene(connection, &authority)?.scene;
                if scene
                    .page_references
                    .iter()
                    .any(|reference| closure.block_ids.contains(&reference.target_block_id))
                {
                    return Ok(true);
                }
            }
        }
    }
    let block_ids_json = identities_json(&closure.block_ids)?;
    let external_index = connection.query_row(
        "SELECT count(*) FROM document_block_index \
         WHERE block_id IN (SELECT value FROM json_each(?1)) \
           AND document_id NOT IN (SELECT value FROM json_each(?2))",
        params![block_ids_json, identities_json(&closure.document_ids)?],
        |row| row.get::<_, i64>(0),
    )?;
    if external_index != 0 {
        return Ok(true);
    }
    let external_canvas_reference = connection.query_row(
        "SELECT count(*) FROM canvas_page_references \
         WHERE target_block_id IN (SELECT value FROM json_each(?1)) \
           AND document_id NOT IN (SELECT value FROM json_each(?2))",
        params![block_ids_json, identities_json(&closure.document_ids)?],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(external_canvas_reference != 0)
}

fn has_historical_reference(
    connection: &Connection,
    closure: &CandidateClosure,
    database_view_ids: &BTreeSet<String>,
) -> Result<bool, StoreError> {
    let versions = read_document_version_retention_evidence(
        connection,
        MAX_RETAINED_DOCUMENT_VERSIONS_TO_INSPECT,
    )?;
    Ok(versions.iter().any(|version| {
        (!closure.document_ids.contains(&version.document_id)
            && sets_intersect(&version.block_ids, &closure.block_ids))
            || sets_intersect(&version.referenced_block_ids, &closure.block_ids)
            || sets_intersect(&version.database_view_ids, database_view_ids)
    }))
}

fn has_cross_project_immutable_reference(
    connection: &Connection,
    closure: &CandidateClosure,
) -> Result<bool, StoreError> {
    let mutations = connection
        .prepare(
            "SELECT project_id, target_block_ids_json, affected_document_ids_json, \
                    affected_database_block_ids_json FROM block_mutations ORDER BY mutation_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (project_id, blocks_json, documents_json, databases_json) in mutations {
        if immutable_row_relevant(&blocks_json, &documents_json, &databases_json, closure)?
            && project_id != closure.project_id
        {
            return Ok(true);
        }
    }
    let changes = connection
        .prepare(
            "SELECT project_id, block_ids_json, document_ids_json, database_block_ids_json \
             FROM change_log ORDER BY seq",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (project_id, blocks_json, documents_json, databases_json) in changes {
        if immutable_row_relevant(&blocks_json, &documents_json, &databases_json, closure)?
            && project_id != closure.project_id
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn immutable_row_relevant(
    blocks_json: &str,
    documents_json: &str,
    databases_json: &str,
    closure: &CandidateClosure,
) -> Result<bool, StoreError> {
    let blocks = read_identity_set(blocks_json)?;
    let documents = read_identity_set(documents_json)?;
    let databases = read_identity_set(databases_json)?;
    let external_databases = databases
        .difference(&closure.block_ids)
        .cloned()
        .collect::<BTreeSet<_>>();
    let authority_blocks = blocks
        .difference(&external_databases)
        .cloned()
        .collect::<BTreeSet<_>>();
    Ok(sets_intersect(&authority_blocks, &closure.block_ids)
        || sets_intersect(&documents, &closure.document_ids)
        || sets_intersect(&databases, &closure.block_ids))
}

fn has_relocation_reference(
    connection: &Connection,
    closure: &CandidateClosure,
) -> Result<bool, StoreError> {
    let rows = connection
        .prepare(
            "SELECT relocation.source_document_id, relocation.target_document_id, \
                    relocation.target_parent_block_id, relocation.target_before_block_id, \
                    member.block_id \
             FROM block_relocations relocation \
             LEFT JOIN block_relocation_members member ON member.relocation_id = relocation.id \
             WHERE relocation.project_id = ?1 OR relocation.target_project_id = ?1",
        )?
        .query_map([&closure.project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows.iter().any(|row| {
        closure.document_ids.contains(&row.0)
            || row
                .1
                .as_ref()
                .is_some_and(|id| closure.document_ids.contains(id))
            || row
                .2
                .as_ref()
                .is_some_and(|id| closure.block_ids.contains(id))
            || row
                .3
                .as_ref()
                .is_some_and(|id| closure.block_ids.contains(id))
            || row
                .4
                .as_ref()
                .is_some_and(|id| closure.block_ids.contains(id))
    }))
}

fn has_relational_reference(
    connection: &Connection,
    closure: &CandidateClosure,
    block_ids_json: &str,
    document_ids_json: &str,
    database_view_ids_json: &str,
) -> Result<bool, StoreError> {
    let top_level = connection.query_row(
        "SELECT count(*) FROM top_level_block_placements \
         WHERE project_id = ?1 AND block_id IN (SELECT value FROM json_each(?2))",
        params![closure.project_id, block_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    let active_memberships = connection.query_row(
        "SELECT count(*) FROM data_source_page_memberships membership \
         JOIN blocks page ON page.id = membership.page_block_id AND page.project_id = ?1 \
         WHERE membership.removed_at IS NULL \
           AND membership.page_block_id IN (SELECT value FROM json_each(?2))",
        params![closure.project_id, block_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    let positions = connection.query_row(
        "SELECT count(*) FROM database_view_page_positions position \
         JOIN blocks page ON page.id = position.page_block_id AND page.project_id = ?1 \
         WHERE position.page_block_id IN (SELECT value FROM json_each(?2))",
        params![closure.project_id, block_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    let external_index = connection.query_row(
        "SELECT count(*) FROM document_block_index \
         WHERE block_id IN (SELECT value FROM json_each(?1)) \
           AND document_id NOT IN (SELECT value FROM json_each(?2))",
        params![block_ids_json, document_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    let active_database_dependents = connection.query_row(
        "SELECT \
           (SELECT count(*) FROM project_database_bindings binding \
             WHERE binding.database_block_id IN (SELECT value FROM json_each(?1)) \
               AND binding.lifecycle = 'active') + \
           (SELECT count(*) FROM data_sources source \
             JOIN data_source_properties property ON property.data_source_id = source.id \
               AND property.lifecycle = 'active' \
             WHERE source.home_database_block_id IN (SELECT value FROM json_each(?1)) \
               AND source.lifecycle = 'active') + \
           (SELECT count(*) FROM database_views view \
             WHERE view.database_block_id IN (SELECT value FROM json_each(?1)) \
               AND view.lifecycle = 'active') + \
           (SELECT count(*) FROM data_sources source \
             JOIN data_source_page_memberships membership \
               ON membership.data_source_id = source.id AND membership.removed_at IS NULL \
             WHERE source.home_database_block_id IN (SELECT value FROM json_each(?1)))",
        [block_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    let dangling_view_positions = connection.query_row(
        "SELECT count(*) FROM database_view_page_positions \
         WHERE view_id IN (SELECT value FROM json_each(?1))",
        [database_view_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    let external_relation_edges = connection.query_row(
        "SELECT count(*) FROM data_source_relation_edges edge \
         JOIN data_source_page_memberships source_membership \
           ON source_membership.data_source_id = edge.source_data_source_id \
           AND source_membership.id = edge.source_membership_id \
         WHERE edge.target_page_block_id IN (SELECT value FROM json_each(?1)) \
           AND source_membership.page_block_id NOT IN (SELECT value FROM json_each(?1))",
        [block_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    let external_relation_definitions = connection.query_row(
        "SELECT count(*) FROM data_source_relation_properties relation \
         JOIN data_sources target ON target.id = relation.target_data_source_id \
         JOIN data_sources source ON source.id = relation.data_source_id \
         WHERE target.home_database_block_id IN (SELECT value FROM json_each(?1)) \
           AND source.home_database_block_id NOT IN (SELECT value FROM json_each(?1))",
        [block_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(top_level != 0
        || active_memberships != 0
        || positions != 0
        || external_index != 0
        || active_database_dependents != 0
        || dangling_view_positions != 0
        || external_relation_edges != 0
        || external_relation_definitions != 0)
}

fn has_page_behavior_reference(
    connection: &Connection,
    closure: &CandidateClosure,
    block_ids_json: &str,
) -> Result<bool, StoreError> {
    let count = connection.query_row(
        "SELECT \
           (SELECT count(*) FROM recurrence_exceptions \
             WHERE project_id = ?1 AND page_id IN (SELECT value FROM json_each(?2))) + \
           (SELECT count(*) FROM reminder_receipts \
             WHERE project_id = ?1 AND page_id IN (SELECT value FROM json_each(?2))) + \
           (SELECT count(*) FROM reminder_snoozes \
             WHERE project_id = ?1 AND page_id IN (SELECT value FROM json_each(?2)))",
        params![closure.project_id, block_ids_json],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count != 0)
}

fn read_prunable_recovery_artifacts(
    connection: &Connection,
    closure: &CandidateClosure,
) -> Result<Option<Vec<String>>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT id, project_id, document_id, status, touched_block_ids_json, \
                    derived_touched_block_ids_json \
             FROM document_recovery_artifacts ORDER BY project_id, id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut prunable = Vec::new();
    for (id, project_id, document_id, status, touched_json, derived_json) in rows {
        let touched = read_identity_set(&touched_json)?;
        let derived = derived_json
            .as_deref()
            .map(read_identity_set)
            .transpose()?
            .unwrap_or_default();
        let relevant = closure.document_ids.contains(&document_id)
            || sets_intersect(&touched, &closure.block_ids)
            || sets_intersect(&derived, &closure.block_ids);
        if !relevant {
            continue;
        }
        if project_id != closure.project_id
            || status == "pending"
            || !matches!(status.as_str(), "resolved" | "discarded")
            || !closure.document_ids.contains(&document_id)
            || !touched.is_subset(&closure.block_ids)
            || !derived.is_subset(&closure.block_ids)
        {
            return Ok(None);
        }
        prunable.push(id);
    }
    Ok(Some(prunable))
}

fn delete_exact_recovery_artifacts(
    connection: &Connection,
    artifact_ids: &[String],
) -> Result<(), StoreError> {
    if artifact_ids.is_empty() {
        return Ok(());
    }
    let serialized = serde_json::to_string(artifact_ids)
        .map_err(|_| internal("Recovery artifact identities cannot be encoded"))?;
    let deleted = connection.execute(
        "DELETE FROM document_recovery_artifacts \
         WHERE id IN (SELECT value FROM json_each(?1))",
        [&serialized],
    )?;
    if deleted != artifact_ids.len() {
        return Err(conflict("Recovery evidence changed during Block retention"));
    }
    Ok(())
}

fn collect_candidate_closure(
    connection: &Connection,
    closure: &CandidateClosure,
    retired_at: &str,
) -> Result<BTreeSet<String>, StoreError> {
    for block_id in &closure.block_ids {
        let inserted = connection.execute(
            "INSERT INTO retired_block_identities( \
               block_id, project_id, block_type, retention_root_block_id, retired_at \
             ) \
             SELECT id, project_id, type, ?1, ?2 FROM blocks \
             WHERE id = ?3 AND project_id = ?4 AND lifecycle = 'deleted'",
            params![
                closure.root_block_id,
                retired_at,
                block_id,
                closure.project_id
            ],
        )?;
        if inserted != 1 {
            return Err(conflict("Block closure changed before identity retirement"));
        }
    }
    let block_ids_json = identities_json(&closure.block_ids)?;
    let document_ids_json = identities_json(&closure.document_ids)?;
    connection.execute(
        "DELETE FROM database_view_page_positions \
         WHERE page_block_id IN (SELECT value FROM json_each(?1))",
        [&block_ids_json],
    )?;
    connection.execute(
        "DELETE FROM data_source_page_memberships \
         WHERE page_block_id IN (SELECT value FROM json_each(?1))",
        [&block_ids_json],
    )?;
    connection.execute(
        "DELETE FROM library_block_placements \
         WHERE block_id IN (SELECT value FROM json_each(?1))",
        [&block_ids_json],
    )?;
    connection.execute(
        "DELETE FROM pages WHERE block_id IN (SELECT value FROM json_each(?1))",
        [&block_ids_json],
    )?;
    if !closure.document_ids.is_empty() {
        let deleted_ownerships = connection.execute(
            "DELETE FROM block_documents \
             WHERE project_id = ?1 \
               AND block_id IN (SELECT value FROM json_each(?2)) \
               AND document_id IN (SELECT value FROM json_each(?3))",
            params![closure.project_id, block_ids_json, document_ids_json],
        )?;
        if deleted_ownerships != closure.document_ids.len() {
            return Err(conflict("Block ownership closure changed during retention"));
        }
    }
    let deleted_blocks = connection.execute(
        "DELETE FROM blocks WHERE project_id = ?1 AND lifecycle = 'deleted' \
           AND id IN (SELECT value FROM json_each(?2))",
        params![closure.project_id, block_ids_json],
    )?;
    if deleted_blocks != closure.block_ids.len() {
        return Err(conflict("Block closure changed during retention"));
    }
    if !closure.document_ids.is_empty() {
        let deleted_documents = connection.execute(
            "DELETE FROM documents WHERE project_id = ?1 \
               AND id IN (SELECT value FROM json_each(?2))",
            params![closure.project_id, document_ids_json],
        )?;
        if deleted_documents != closure.document_ids.len() {
            return Err(conflict("Document closure changed during Block retention"));
        }
    }
    Ok(closure.block_ids.clone())
}

fn read_database_view_ids(
    connection: &Connection,
    block_ids_json: &str,
) -> Result<BTreeSet<String>, StoreError> {
    connection
        .prepare(
            "SELECT id FROM database_views \
             WHERE database_block_id IN (SELECT value FROM json_each(?1)) ORDER BY id",
        )?
        .query_map([block_ids_json], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<BTreeSet<_>>>()
        .map_err(StoreError::from)
}

fn has_unknown_inbound_reference(
    connection: &Connection,
    closure: &CandidateClosure,
) -> Result<bool, StoreError> {
    let table_names = connection
        .prepare(
            "SELECT name FROM sqlite_master \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for table_name in table_names {
        if KNOWN_INBOUND_AUTHORITY_TABLES.contains(&table_name.as_str()) {
            continue;
        }
        let pragma = format!("PRAGMA foreign_key_list({})", quote_identifier(&table_name));
        let foreign_keys = connection
            .prepare(&pragma)?
            .query_map([], |row| {
                Ok(ForeignKeyColumn {
                    id: row.get(0)?,
                    referenced_table: row.get(2)?,
                    from_column: row.get(3)?,
                    to_column: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut groups = BTreeMap::<i64, Vec<ForeignKeyColumn>>::new();
        for foreign_key in foreign_keys {
            if matches!(
                foreign_key.referenced_table.as_str(),
                "blocks" | "documents" | "block_documents"
            ) {
                groups.entry(foreign_key.id).or_default().push(foreign_key);
            }
        }
        for foreign_key in groups.values() {
            if unknown_foreign_key_matches(connection, &table_name, foreign_key, closure)? {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn unknown_foreign_key_matches(
    connection: &Connection,
    table_name: &str,
    foreign_key: &[ForeignKeyColumn],
    closure: &CandidateClosure,
) -> Result<bool, StoreError> {
    let Some(referenced_table) = foreign_key
        .first()
        .map(|column| column.referenced_table.as_str())
    else {
        return Ok(false);
    };
    let mut predicates = Vec::new();
    let mut bindings = Vec::new();
    let mut recognized_identity_column = false;
    for column in foreign_key {
        let identities = match (referenced_table, column.to_column.as_str()) {
            ("blocks", "id") => &closure.block_ids,
            ("documents", "id") => &closure.document_ids,
            ("block_documents", "block_id") => &closure.owner_block_ids,
            ("block_documents", "document_id") => &closure.document_ids,
            _ => continue,
        };
        recognized_identity_column = true;
        if identities.is_empty() {
            continue;
        }
        predicates.push(format!(
            "{} IN (SELECT value FROM json_each(?{}))",
            quote_identifier(&column.from_column),
            bindings.len() + 1
        ));
        bindings.push(identities_json(identities)?);
    }
    if predicates.is_empty() {
        return Ok(!recognized_identity_column);
    }
    let sql = format!(
        "SELECT count(*) FROM {} WHERE {}",
        quote_identifier(table_name),
        predicates.join(" OR ")
    );
    let count = connection.query_row(&sql, rusqlite::params_from_iter(bindings.iter()), |row| {
        row.get::<_, i64>(0)
    })?;
    Ok(count != 0)
}

fn read_block(connection: &Connection, block_id: &str) -> Result<Option<BlockRow>, StoreError> {
    connection
        .query_row(
            "SELECT id, project_id, type, lifecycle FROM blocks WHERE id = ?1",
            [block_id],
            decode_block_row,
        )
        .optional()
        .map_err(StoreError::from)
}

fn decode_block_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BlockRow> {
    Ok(BlockRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        block_type: row.get(2)?,
        lifecycle: row.get(3)?,
    })
}

fn materialized_blocks_intersect(
    blocks: &[MaterializedBlockNode],
    candidates: &BTreeSet<String>,
) -> bool {
    blocks.iter().any(|block| {
        candidates.contains(&block.id) || materialized_blocks_intersect(&block.children, candidates)
    })
}

fn read_identity_set(serialized: &str) -> Result<BTreeSet<String>, StoreError> {
    let identities = serde_json::from_str::<Vec<Value>>(serialized)
        .map_err(|_| corrupt("Retention evidence contains invalid JSON"))?;
    identities
        .into_iter()
        .map(|identity| {
            let identity = identity
                .as_str()
                .filter(|value| !value.is_empty() && value.len() <= 512 && value.trim() == *value)
                .ok_or_else(|| corrupt("Retention evidence contains an invalid identity"))?;
            Ok(identity.to_owned())
        })
        .collect()
}

fn identities_json(identities: &BTreeSet<String>) -> Result<String, StoreError> {
    serde_json::to_string(identities)
        .map_err(|_| internal("Retention identities cannot be encoded"))
}

fn sets_intersect(left: &BTreeSet<String>, right: &BTreeSet<String>) -> bool {
    left.iter().any(|identity| right.contains(identity))
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn conflict(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::HeadConflict, message, true)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use crate::document::{
        PersistYjsGenesis, persist_yjs_genesis, prepare_page_yjs_genesis, read_document_authority,
    };
    use crate::infrastructure::store::SqliteStoreKernel;

    use super::*;

    const PROJECT_ID: &str = "project:block-retention";
    const OWNED_CHILD_ID: &str = "019c0000-0000-7000-8000-000000000001";

    struct Fixture {
        _home: TempDir,
        kernel: SqliteStoreKernel,
    }

    impl Fixture {
        fn new() -> Self {
            let home = tempfile::tempdir().expect("Profile home");
            let kernel = SqliteStoreKernel::open_test(home.path()).expect("fresh store");
            kernel
                .writer()
                .call(|connection| {
                    connection.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) \
                         VALUES ('profile:block-retention', ?1, ?1)",
                        ["2026-07-19T00:00:00.000Z"],
                    )?;
                    connection.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library:block-retention', 'profile:block-retention', ?1, ?1)",
                        ["2026-07-19T00:00:00.000Z"],
                    )?;
                    connection.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES (?1, 'library:block-retention', 'Retention', ?2, ?2)",
                        params![PROJECT_ID, "2026-07-19T00:00:00.000Z"],
                    )?;
                    Ok(())
                })
                .expect("retention identity");
            Self {
                _home: home,
                kernel,
            }
        }

        fn insert_deleted_block(&self, block_id: &str) {
            let block_id = block_id.to_owned();
            self.kernel
                .writer()
                .call(move |connection| {
                    connection.execute(
                        "INSERT INTO blocks( \
                           id, project_id, type, lifecycle, location_kind, created_at, updated_at \
                         ) VALUES (?1, ?2, 'paragraph', 'deleted', 'space', ?3, ?3)",
                        params![block_id, PROJECT_ID, "2026-01-01T00:00:00.000Z"],
                    )?;
                    Ok(())
                })
                .expect("deleted Block");
        }

        fn insert_owned_page_closure(&self, child_lifecycle: &str) {
            let child_lifecycle = child_lifecycle.to_owned();
            self.kernel
                .writer()
                .call(move |connection| {
                    connection.execute(
                        "INSERT INTO blocks( \
                           id, project_id, type, lifecycle, location_kind, created_at, updated_at \
                         ) VALUES ( \
                           'block:owned-page', ?1, 'page', 'deleted', 'space', ?2, ?2 \
                         )",
                        params![PROJECT_ID, "2026-01-01T00:00:00.000Z"],
                    )?;
                    connection.execute(
                        "INSERT INTO documents( \
                           id, project_id, schema_key, schema_version, created_at, updated_at \
                         ) VALUES ( \
                           'document:owned-page', ?1, 'nodex.page', 2, ?2, ?2 \
                         )",
                        params![PROJECT_ID, "2026-01-01T00:00:00.000Z"],
                    )?;
                    connection.execute(
                        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                         VALUES ('block:owned-page', 'document:owned-page', ?1, ?2)",
                        params![PROJECT_ID, "2026-01-01T00:00:00.000Z"],
                    )?;
                    let authority = read_document_authority(connection, "document:owned-page")?
                        .expect("pending Page authority");
                    let genesis = prepare_page_yjs_genesis(
                        "document:owned-page",
                        "",
                        OWNED_CHILD_ID,
                    )?;
                    persist_yjs_genesis(
                        connection,
                        PersistYjsGenesis {
                            authority: &authority,
                            materialization: &genesis.materialization,
                            update_id: "genesis:owned-page",
                            client_session_id: "client:retention-test",
                            update: &genesis.update_v1,
                            state_vector: &genesis.state_vector_v1,
                            full_state: &genesis.engine.full_state_v1(),
                            store_epoch: "epoch:test",
                            operation_id: "operation:owned-page-genesis",
                            emit_event: false,
                        },
                    )?;
                    connection.execute(
                        "UPDATE blocks SET lifecycle = ?1, updated_at = ?2 \
                         WHERE id = ?3",
                        params![
                            child_lifecycle,
                            "2026-01-01T00:00:00.000Z",
                            OWNED_CHILD_ID
                        ],
                    )?;
                    Ok(())
                })
                .expect("owned Page closure");
        }
    }

    #[test]
    fn collects_an_unreachable_tombstone_and_preserves_immutable_audit_evidence() {
        let fixture = Fixture::new();
        fixture.insert_deleted_block("block:collectible");
        fixture
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO change_log( \
                       project_id, store_epoch, kind, block_ids_json, projection_impact_json, committed_at \
                     ) VALUES (?1, 'epoch:test', 'block_deleted', '[\"block:collectible\"]', \
                       '{\"kind\":\"none\"}', ?2)",
                    params![PROJECT_ID, "2026-01-01T00:00:00.000Z"],
                )?;
                let summary = run_block_retention_pass(connection, 0)?;
                assert_eq!(
                    summary,
                    BlockRetentionSummary {
                        selected_candidates: 1,
                        collected_candidates: 1,
                        collected_blocks: 1,
                        retained_candidates: 0,
                        covered_candidates: 0,
                        failed_candidates: 0,
                    }
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM blocks WHERE id = 'block:collectible'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT retention_root_block_id FROM retired_block_identities \
                         WHERE block_id = 'block:collectible'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "block:collectible"
                );
                assert_eq!(
                    connection.query_row("SELECT count(*) FROM change_log", [], |row| {
                        row.get::<_, i64>(0)
                    })?,
                    1
                );
                Ok(())
            })
            .expect("collect tombstone");
    }

    #[test]
    fn session_domain_state_does_not_retain_a_window_local_page_target() {
        let fixture = Fixture::new();
        fixture.insert_deleted_block("block:session-target");
        fixture
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO project_sessions( \
                       id, project_id, no_thread_fallback_title, \"order\", \
                       created_at, updated_at \
                     ) VALUES ('session:retention', ?1, 'Retention', 0, ?2, ?2)",
                    params![PROJECT_ID, "2026-01-01T00:00:00.000Z"],
                )?;
                let summary = run_block_retention_pass(connection, 0)?;
                assert_eq!(summary.retained_candidates, 0);
                assert_eq!(summary.collected_blocks, 1);
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM blocks WHERE id = 'block:session-target'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                Ok(())
            })
            .expect("collect window-local target");
    }

    #[test]
    fn an_unknown_inbound_foreign_key_retains_the_candidate() {
        let fixture = Fixture::new();
        fixture.insert_deleted_block("block:unknown-root");
        fixture
            .kernel
            .writer()
            .call(|connection| {
                connection.execute_batch(
                    "CREATE TABLE extension_reference( \
                       id TEXT PRIMARY KEY, \
                       target_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE \
                     ); \
                     INSERT INTO extension_reference(id, target_block_id) \
                     VALUES ('extension:1', 'block:unknown-root');",
                )?;
                let summary = run_block_retention_pass(connection, 0)?;
                assert_eq!(summary.retained_candidates, 1);
                assert_eq!(summary.collected_blocks, 0);
                Ok(())
            })
            .expect("retain unknown reference");
    }

    #[test]
    fn an_external_relation_edge_retains_its_deleted_target_page() {
        let fixture = Fixture::new();
        fixture
            .kernel
            .writer()
            .call(|connection| {
                let old = "2026-01-01T00:00:00.000Z";
                connection.execute(
                    "INSERT INTO blocks(\
                       id, project_id, type, lifecycle, location_kind, created_at, updated_at\
                     ) VALUES ('database:relation-retention', ?1, 'database', 'active', \
                       'space', ?2, ?2)",
                    params![PROJECT_ID, old],
                )?;
                connection.execute(
                    "INSERT INTO database_containers(\
                       block_id, library_id, name, lifecycle, created_at, updated_at\
                     ) VALUES ('database:relation-retention', 'library:block-retention', \
                       'Relations', 'active', ?1, ?1)",
                    [old],
                )?;
                connection.execute(
                    "INSERT INTO data_sources(\
                       id, library_id, home_database_block_id, name, schema_key, lifecycle, \
                       rank_key, created_at, updated_at\
                     ) VALUES ('source:relation-retention', 'library:block-retention', \
                       'database:relation-retention', 'Relations', 'nodex.database', 'active', \
                       'a', ?1, ?1)",
                    [old],
                )?;
                for (page_id, document_id) in [
                    ("page:relation-source", "document:relation-source"),
                    ("page:relation-target", "document:relation-target"),
                ] {
                    connection.execute(
                        "INSERT INTO blocks(\
                           id, project_id, type, lifecycle, location_kind, \
                           containing_database_id, created_at, updated_at\
                         ) VALUES (?1, ?2, 'page', 'active', 'database', \
                           'database:relation-retention', ?3, ?3)",
                        params![page_id, PROJECT_ID, old],
                    )?;
                    connection.execute(
                        "INSERT INTO documents(\
                           id, project_id, schema_key, schema_version, created_at, updated_at\
                         ) VALUES (?1, ?2, 'nodex.page', 2, ?3, ?3)",
                        params![document_id, PROJECT_ID, old],
                    )?;
                    connection.execute(
                        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                         VALUES (?1, ?2, ?3, ?4)",
                        params![page_id, document_id, PROJECT_ID, old],
                    )?;
                    connection.execute(
                        "INSERT INTO pages(\
                           block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
                           created_at, updated_at\
                         ) VALUES (?1, 'library:block-retention', ?2, 'data_source', \
                           'source:relation-retention', 'active', ?3, ?3)",
                        params![page_id, document_id, old],
                    )?;
                }
                connection.execute(
                    "INSERT INTO data_source_page_memberships(\
                       id, data_source_id, page_block_id, revision, created_at, removed_at\
                     ) VALUES \
                       ('membership:relation-source', 'source:relation-retention', \
                         'page:relation-source', 1, ?1, NULL), \
                       ('membership:relation-target', 'source:relation-retention', \
                         'page:relation-target', 1, ?1, NULL)",
                    [old],
                )?;
                connection.execute(
                    "INSERT INTO data_source_properties(\
                       data_source_id, id, name, value_type, config_json, rank_key, lifecycle, \
                       schema_revision, created_at, updated_at\
                     ) VALUES ('source:relation-retention', 'blocked_by', 'Blocked by', \
                       'relation', '{}', 'z', 'active', 1, ?1, ?1)",
                    [old],
                )?;
                connection.execute(
                    "INSERT INTO data_source_relation_properties(\
                       data_source_id, property_id, target_data_source_id\
                     ) VALUES ('source:relation-retention', 'blocked_by', \
                       'source:relation-retention')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO data_source_property_values(\
                       data_source_id, membership_id, property_id, value_type, value_json, \
                       revision, updated_at\
                     ) VALUES ('source:relation-retention', 'membership:relation-source', \
                       'blocked_by', 'relation', 'null', 1, ?1)",
                    [old],
                )?;
                connection.execute(
                    "INSERT INTO data_source_relation_edges(\
                       edge_id, source_data_source_id, source_membership_id, property_id, \
                       target_page_block_id, created_at\
                     ) VALUES (?1, 'source:relation-retention', 'membership:relation-source', \
                       'blocked_by', 'page:relation-target', ?2)",
                    params!["b".repeat(64), old],
                )?;
                connection.execute(
                    "UPDATE data_source_page_memberships SET removed_at = ?1 \
                     WHERE id = 'membership:relation-target'",
                    [old],
                )?;
                connection.execute(
                    "UPDATE pages SET lifecycle = 'deleted', updated_at = ?1 \
                     WHERE block_id = 'page:relation-target'",
                    [old],
                )?;
                connection.execute(
                    "UPDATE blocks SET lifecycle = 'deleted', updated_at = ?1 \
                     WHERE id = 'page:relation-target'",
                    [old],
                )?;

                let summary = run_block_retention_pass(connection, 0)?;
                assert_eq!(summary.retained_candidates, 1);
                assert_eq!(summary.collected_blocks, 0);
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM blocks WHERE id = 'page:relation-target'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                Ok(())
            })
            .expect("retain Relation target");
    }

    #[test]
    fn collects_a_deleted_ownership_closure_and_prunes_resolved_recovery() {
        let fixture = Fixture::new();
        fixture.insert_owned_page_closure("deleted");
        fixture
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO document_recovery_artifacts( \
                       id, project_id, store_epoch, document_id, generation, update_id, \
                       client_session_id, base_head_seq, touched_block_ids_json, \
                       derived_touched_block_ids_json, update_blob, update_hash, \
                       update_byte_length, reason, status, created_at, expires_at, resolved_at \
                     ) VALUES ( \
                       'recovery:resolved', ?1, 'epoch:test', 'document:owned-page', 1, \
                       'update:resolved', 'client:test', 0, ?5, \
                       '[\"block:owned-page\"]', X'01', ?2, 1, 'unsafe_stale_update', \
                       'resolved', ?3, ?4, ?3 \
                     )",
                    params![
                        PROJECT_ID,
                        "0000000000000000000000000000000000000000000000000000000000000000",
                        "2026-01-01T00:00:00.000Z",
                        "2026-02-01T00:00:00.000Z",
                        serde_json::to_string(&[OWNED_CHILD_ID]).expect("touched IDs")
                    ],
                )?;
                let summary = run_block_retention_pass(connection, 0)?;
                assert_eq!(summary.collected_candidates, 1);
                assert_eq!(summary.collected_blocks, 2);
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM blocks \
                         WHERE id = 'block:owned-page' OR id = ?1",
                        [OWNED_CHILD_ID],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM documents WHERE id = 'document:owned-page'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM document_recovery_artifacts \
                         WHERE id = 'recovery:resolved'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                Ok(())
            })
            .expect("collect ownership closure");
    }

    #[test]
    fn a_live_contained_block_retains_the_entire_ownership_closure() {
        let fixture = Fixture::new();
        fixture.insert_owned_page_closure("active");
        fixture
            .kernel
            .writer()
            .call(|connection| {
                let summary = run_block_retention_pass(connection, 0)?;
                assert_eq!(summary.retained_candidates, 1);
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM blocks \
                         WHERE id = 'block:owned-page' OR id = ?1",
                        [OWNED_CHILD_ID],
                        |row| row.get::<_, i64>(0),
                    )?,
                    2
                );
                Ok(())
            })
            .expect("retain live child closure");
    }

    #[test]
    fn a_late_document_delete_failure_rolls_back_the_complete_candidate() {
        let fixture = Fixture::new();
        fixture.insert_owned_page_closure("deleted");
        fixture
            .kernel
            .writer()
            .call(|connection| {
                connection.execute_batch(
                    "CREATE TEMP TRIGGER fail_retention_document_delete \
                     BEFORE DELETE ON documents BEGIN \
                       SELECT RAISE(ABORT, 'injected retention failure'); \
                     END;",
                )?;
                assert!(run_block_retention_pass(connection, 0).is_err());
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM blocks \
                         WHERE id = 'block:owned-page' OR id = ?1",
                        [OWNED_CHILD_ID],
                        |row| row.get::<_, i64>(0),
                    )?,
                    2
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM retired_block_identities \
                         WHERE block_id = 'block:owned-page' OR block_id = ?1",
                        [OWNED_CHILD_ID],
                        |row| row.get::<_, i64>(0),
                    )?,
                    0
                );
                Ok(())
            })
            .expect("candidate rollback");
    }
}
