use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::library::{
    LibraryPageCopyDestination, LibraryPageCopyResult, LibraryResourceTarget, LibraryWriteParent,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::database::{
    PageCopyDataSourceDestination, PageCopyPositionAnchor, PageCopyValueDraft,
    PageCopyViewPlacement, place_copied_page_in_data_source, resolve_page_copy_data_source_project,
};
use crate::document::{
    BlockDocumentSchema, DocumentMaterialization, PersistYjsGenesis, clone_canvas_genesis,
    decode_block_document, persist_yjs_genesis, prepare_yjs_clone_genesis, read_document_authority,
    reconstruct_yjs_engine, sha256,
};
use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::block_tree::TextDelta;
use crate::domain::identity::stable_uuid_v7;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::LibraryApplyOutcome;
use super::mutation::{
    MutationEffects, append_rank, finish_mutation, insert_library_placement,
    insert_page_read_model, persist_parent_insert, resolve_write_parent, sqlite_now,
};

const MAX_COPY_BLOCKS: usize = 10_000;
const MAX_COPY_DOCUMENTS: usize = 1_024;
const YJS_OWNER_TYPES: &[&str] = &["page", "synced_block_source", "reusable_template_source"];
const TYPED_BLOCK_TYPES: &[&str] = &[
    "page",
    "database",
    "synced_block_source",
    "reusable_template_source",
    "canvas",
];

struct CopyDocument {
    source_owner_id: String,
    source_document_id: String,
    target_owner_id: String,
    target_document_id: String,
    owner_type: String,
    source_containing_document_id: Option<String>,
    schema_key: String,
    schema_version: i64,
    body: CopyDocumentBody,
}

enum CopyDocumentBody {
    Yjs {
        schema: BlockDocumentSchema,
        title: Option<Vec<TextDelta>>,
        materialization: Box<DocumentMaterialization>,
    },
    Canvas,
}

struct CopyPlan {
    source_project_id: String,
    source_root_document_id: String,
    block_ids: BTreeMap<String, String>,
    document_ids: BTreeMap<String, String>,
    documents: Vec<CopyDocument>,
}

struct ExplicitRootIdentity<'a> {
    page_id: &'a str,
    document_id: &'a str,
}

pub(crate) struct OccurrencePageCloneInput<'a> {
    pub(crate) operation_id: &'a str,
    pub(crate) source_page_id: &'a str,
    pub(crate) new_page_id: &'a str,
    pub(crate) lifecycle: &'a str,
    pub(crate) status: &'a str,
    pub(crate) scheduled_start: &'a str,
    pub(crate) scheduled_end: &'a str,
    pub(crate) is_all_day: bool,
    pub(crate) recurrence_json: &'a str,
    pub(crate) reminders_json: &'a str,
    pub(crate) schedule_timezone: Option<&'a str>,
    pub(crate) primary_rank_key: Option<&'a str>,
    pub(crate) now: &'a str,
}

pub(crate) struct OccurrencePageCloneResult {
    pub(crate) page_id: String,
    pub(crate) database_id: String,
    pub(crate) affected_document_ids: Vec<String>,
}

fn write_parent(
    destination: &LibraryPageCopyDestination,
) -> Result<LibraryWriteParent, StoreError> {
    match destination {
        LibraryPageCopyDestination::Library { before } => Ok(LibraryWriteParent::Library {
            before: before.clone(),
        }),
        LibraryPageCopyDestination::Page {
            page_id,
            expected_document_generation,
            expected_document_head_seq,
            before,
        } => Ok(LibraryWriteParent::Page {
            page_id: page_id.clone(),
            expected_document_generation: *expected_document_generation,
            expected_document_head_seq: *expected_document_head_seq,
            before: before.clone(),
        }),
        LibraryPageCopyDestination::DataSource { .. } => {
            Ok(LibraryWriteParent::Library { before: None })
        }
    }
}

fn data_source_destination(
    destination: &LibraryPageCopyDestination,
) -> Option<PageCopyDataSourceDestination> {
    let LibraryPageCopyDestination::DataSource {
        data_source_id,
        expected_data_source_revision,
        values,
        view,
    } = destination
    else {
        return None;
    };
    Some(PageCopyDataSourceDestination {
        data_source_id: data_source_id.clone(),
        expected_data_source_revision: *expected_data_source_revision,
        values: values
            .iter()
            .map(|value| PageCopyValueDraft {
                property_id: value.property_id.clone(),
                value: value.value.clone(),
            })
            .collect(),
        view: view.as_ref().map(|view| PageCopyViewPlacement {
            view_id: view.view_id.clone(),
            expected_view_revision: view.expected_view_revision,
            group_key: view.group_key.clone(),
            before: view.before.as_ref().map(|anchor| PageCopyPositionAnchor {
                page_id: anchor.page_id.clone(),
                expected_position_revision: anchor.expected_position_revision,
            }),
        }),
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn copy_page(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    source_page_id: &str,
    expected_location_revision: i64,
    expected_parent_revision: i64,
    expected_active_membership_revision: i64,
    expected_document_generation: i64,
    expected_document_head_seq: i64,
    destination: &LibraryPageCopyDestination,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    let requesting_project_id = context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| unauthorized("Page copy requires a bound Project"))?;
    super::history::require_page_read_access(
        connection,
        library_id,
        requesting_project_id,
        source_page_id,
    )?;
    let source = connection
        .query_row(
            "SELECT block.project_id, block.lifecycle, block.location_revision, \
               page.parent_revision, COALESCE(( \
                 SELECT membership.revision FROM data_source_page_memberships membership \
                 WHERE membership.page_block_id = page.block_id \
                   AND membership.removed_at IS NULL), 0), page.document_id, \
               document.generation, document.head_seq, document.readiness \
             FROM pages page JOIN blocks block ON block.id = page.block_id AND block.type = 'page' \
             JOIN documents document ON document.id = page.document_id \
             WHERE page.block_id = ?1 AND page.library_id = ?2",
            params![source_page_id, library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Source Page is unavailable"))?;
    if source.1 != "active" || source.8 != "ready" {
        return Err(not_found("Source Page is unavailable"));
    }
    if source.2 != expected_location_revision {
        return Err(revision_conflict("Source Page location changed"));
    }
    if source.3 != expected_parent_revision || source.4 != expected_active_membership_revision {
        return Err(revision_conflict("Source Page parent changed"));
    }
    if source.6 != expected_document_generation || source.7 != expected_document_head_seq {
        return Err(head_conflict("Source Page content changed"));
    }

    let parent = write_parent(destination)?;
    let data_source_destination = data_source_destination(destination);
    let mut resolved_parent =
        resolve_write_parent(connection, library_id, requesting_project_id, &parent)?;
    if let Some(destination) = &data_source_destination {
        resolved_parent.project_id = resolve_page_copy_data_source_project(
            connection,
            library_id,
            requesting_project_id,
            &destination.data_source_id,
            destination.expected_data_source_revision,
        )?;
        resolved_parent.parent_key = format!("data_source:{}", destination.data_source_id);
    }
    let plan = build_copy_plan(
        connection,
        operation_id,
        &source.0,
        source_page_id,
        &source.5,
        None,
    )?;
    let target_page_id = plan
        .block_ids
        .get(source_page_id)
        .cloned()
        .ok_or_else(|| corrupt("Page copy omitted its root identity"))?;
    let target_document_id = plan
        .document_ids
        .get(&plan.source_root_document_id)
        .cloned()
        .ok_or_else(|| corrupt("Page copy omitted its root Document identity"))?;
    assert_fresh_identities(connection, &plan)?;
    let now = sqlite_now(connection)?;
    stage_copy_authority(
        connection,
        library_id,
        &resolved_parent,
        source_page_id,
        &target_page_id,
        &plan,
        &parent,
        &now,
    )?;

    let document_heads = persist_copy_documents(
        connection,
        &plan,
        source_page_id,
        &resolved_parent,
        store_epoch,
        operation_id,
        &now,
        assets_root,
    )?;

    let data_source_placement = data_source_destination
        .as_ref()
        .map(|destination| {
            place_copied_page_in_data_source(
                connection,
                library_id,
                requesting_project_id,
                source_page_id,
                &target_page_id,
                destination,
                &now,
            )
        })
        .transpose()?;
    if data_source_placement.is_none() {
        advance_copied_root_revisions(connection, &target_page_id, &now)?;
    }
    let parent_head_seq = resolved_parent
        .document
        .as_ref()
        .map(|parent_document| {
            persist_parent_insert(
                connection,
                store_epoch,
                operation_id,
                parent_document,
                embedded_page(&target_page_id),
                resolved_parent.before_block_id.clone(),
            )
        })
        .transpose()?;
    let copied_page_ids = plan
        .documents
        .iter()
        .filter(|document| document.owner_type == "page")
        .map(|document| document.target_owner_id.clone())
        .collect::<Vec<_>>();
    let mut affected_page_ids = copied_page_ids
        .iter()
        .cloned()
        .chain(resolved_parent.page_id.clone())
        .collect::<Vec<_>>();
    affected_page_ids.sort();
    affected_page_ids.dedup();
    let mut affected_document_ids = document_heads.keys().cloned().collect::<Vec<_>>();
    if let Some(parent_document) = resolved_parent.document.as_ref() {
        affected_document_ids.push(parent_document.authority.head.id.clone());
    }
    affected_document_ids.sort();
    affected_document_ids.dedup();
    let mut committed_revisions = BTreeMap::new();
    for page_id in &copied_page_ids {
        let revision = if page_id == &target_page_id { 2 } else { 1 };
        committed_revisions.insert(format!("blockLocation:{page_id}"), revision);
        committed_revisions.insert(format!("blockMetadata:{page_id}"), revision);
        committed_revisions.insert(format!("pageParent:{page_id}"), revision);
    }
    for (document_id, head_seq) in &document_heads {
        committed_revisions.insert(format!("documentHead:{document_id}"), *head_seq);
    }
    if let (Some(head_seq), Some(parent_document)) =
        (parent_head_seq, resolved_parent.document.as_ref())
    {
        committed_revisions.insert(
            format!("documentHead:{}", parent_document.authority.head.id),
            head_seq,
        );
    }
    if let Some(placement) = &data_source_placement {
        committed_revisions.insert(
            format!("blockLocation:{}", target_page_id),
            placement.location_revision,
        );
        committed_revisions.insert(
            format!("blockMetadata:{}", target_page_id),
            placement.metadata_revision,
        );
        committed_revisions.insert(
            format!("pageParent:{}", target_page_id),
            placement.parent_revision,
        );
        committed_revisions.insert(
            format!("membership:{}:{}", placement.data_source_id, target_page_id),
            1,
        );
        committed_revisions.insert(
            format!("dataSourceSchema:{}", placement.data_source_id),
            data_source_destination
                .as_ref()
                .expect("placement has destination")
                .expected_data_source_revision,
        );
        for (property_id, revision) in &placement.value_revisions {
            committed_revisions.insert(
                format!(
                    "propertyValue:{}:{}:{}",
                    placement.data_source_id, target_page_id, property_id
                ),
                *revision,
            );
        }
        if let (Some(view), Some(revision)) = (
            data_source_destination
                .as_ref()
                .and_then(|destination| destination.view.as_ref()),
            placement.position_revision,
        ) {
            committed_revisions.insert(
                format!("viewPosition:{}:{}", view.view_id, target_page_id),
                revision,
            );
        }
    }
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: resolved_parent.project_id,
            operation_kind: "copy_page",
            did_mutate: true,
            created_target: Some(LibraryResourceTarget::Page {
                page_id: target_page_id.clone(),
            }),
            affected_parent_keys: vec![resolved_parent.parent_key],
            affected_page_ids,
            affected_database_ids: data_source_placement
                .as_ref()
                .map(|placement| vec![placement.database_id.clone()])
                .unwrap_or_default(),
            affected_view_ids: data_source_placement
                .as_ref()
                .map(|placement| placement.affected_view_ids.clone())
                .unwrap_or_default(),
            affected_document_ids,
            committed_revisions,
            page_copy: Some(LibraryPageCopyResult {
                source_page_id: source_page_id.to_owned(),
                page_id: target_page_id,
                document_id: target_document_id,
                block_ids: plan.block_ids,
                document_ids: plan.document_ids,
            }),
            committed_at: now,
        },
    )
}

pub(crate) fn clone_page_for_occurrence(
    connection: &Connection,
    library_id: &str,
    store_epoch: &str,
    assets_root: &Path,
    input: OccurrencePageCloneInput<'_>,
) -> Result<OccurrencePageCloneResult, StoreError> {
    if !matches!(input.lifecycle, "active" | "archived") {
        return Err(invalid("Occurrence clone lifecycle is invalid"));
    }
    let source = connection
        .query_row(
            "SELECT block.project_id, block.lifecycle, page.document_id, document.generation, \
               document.head_seq, document.readiness, document.authority, membership.id, \
               membership.data_source_id, source.home_database_block_id \
             FROM pages page JOIN blocks block ON block.id = page.block_id AND block.type = 'page' \
             JOIN documents document ON document.id = page.document_id \
               AND document.project_id = block.project_id \
             JOIN data_source_page_memberships membership ON membership.page_block_id = page.block_id \
               AND membership.removed_at IS NULL \
             JOIN data_sources source ON source.id = membership.data_source_id \
               AND source.home_database_block_id = block.containing_database_id \
             WHERE page.block_id = ?1 AND page.library_id = ?2",
            params![input.source_page_id, library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Occurrence source Page is unavailable"))?;
    if source.1 == "deleted" || source.5 != "ready" || source.6 != "ydoc_primary" {
        return Err(not_found("Occurrence source Page is unavailable"));
    }
    let target_document_id = format!("document:{}", input.new_page_id);
    let plan = build_copy_plan(
        connection,
        input.operation_id,
        &source.0,
        input.source_page_id,
        &source.2,
        Some(ExplicitRootIdentity {
            page_id: input.new_page_id,
            document_id: &target_document_id,
        }),
    )?;
    assert_fresh_identities(connection, &plan)?;
    let resolved_parent = super::mutation::ResolvedWriteParent {
        parent_key: format!("library:{library_id}"),
        page_id: None,
        project_id: source.0.clone(),
        document: None,
        before_block_id: None,
    };
    stage_copy_authority(
        connection,
        library_id,
        &resolved_parent,
        input.source_page_id,
        input.new_page_id,
        &plan,
        &LibraryWriteParent::Library { before: None },
        input.now,
    )?;
    let document_heads = persist_copy_documents(
        connection,
        &plan,
        input.source_page_id,
        &resolved_parent,
        store_epoch,
        input.operation_id,
        input.now,
        assets_root,
    )?;

    connection.execute(
        "DELETE FROM top_level_block_placements WHERE block_id = ?1",
        [input.new_page_id],
    )?;
    connection.execute(
        "DELETE FROM library_block_placements WHERE block_id = ?1",
        [input.new_page_id],
    )?;
    let block_changed = connection.execute(
        "UPDATE blocks SET lifecycle = ?1, location_kind = 'database', \
           containing_document_id = NULL, containing_database_id = ?2, updated_at = ?3 \
         WHERE id = ?4 AND project_id = ?5 AND type = 'page'",
        params![
            input.lifecycle,
            source.9,
            input.now,
            input.new_page_id,
            source.0,
        ],
    )?;
    let page_changed = connection.execute(
        "UPDATE pages SET parent_kind = 'data_source', parent_id = ?1, lifecycle = ?2, \
           updated_at = ?3 WHERE block_id = ?4 AND library_id = ?5",
        params![
            source.8,
            input.lifecycle,
            input.now,
            input.new_page_id,
            library_id,
        ],
    )?;
    if block_changed != 1 || page_changed != 1 {
        return Err(corrupt("Occurrence clone root placement disappeared"));
    }
    let membership_id = format!(
        "membership:{}",
        sha256(format!("{}\0{}", source.8, input.new_page_id).as_bytes())
    );
    connection.execute(
        "INSERT INTO data_source_page_memberships( \
           id, data_source_id, page_block_id, revision, created_at, removed_at \
         ) VALUES (?1, ?2, ?3, 1, ?4, NULL)",
        params![membership_id, source.8, input.new_page_id, input.now],
    )?;

    let database_values = connection
        .prepare(
            "SELECT value.property_id, value.value_type, value.value_json \
             FROM data_source_property_values value \
             JOIN data_source_properties property ON property.data_source_id = value.data_source_id \
               AND property.id = value.property_id AND property.lifecycle = 'active' \
             WHERE value.data_source_id = ?1 AND value.membership_id = ?2 ORDER BY value.property_id",
        )?
        .query_map(params![source.8, source.7], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut required = BTreeSet::new();
    for (property_id, value_type, value_json) in database_values {
        let next_value = match property_id.as_str() {
            "status" => {
                required.insert("status");
                serde_json::to_string(input.status)
                    .map_err(|_| internal("Occurrence status JSON"))?
            }
            "scheduled_start" => {
                required.insert("scheduled_start");
                serde_json::to_string(input.scheduled_start)
                    .map_err(|_| internal("Occurrence start JSON"))?
            }
            "scheduled_end" => {
                required.insert("scheduled_end");
                serde_json::to_string(input.scheduled_end)
                    .map_err(|_| internal("Occurrence end JSON"))?
            }
            _ => value_json,
        };
        connection.execute(
            "INSERT INTO data_source_property_values( \
               data_source_id, membership_id, property_id, value_type, value_json, revision, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![
                source.8,
                membership_id,
                property_id,
                value_type,
                next_value,
                input.now,
            ],
        )?;
    }
    if required.len() != 3 {
        return Err(corrupt(
            "Occurrence source Page is missing required schedule properties",
        ));
    }
    let recurrence = serde_json::from_str::<serde_json::Value>(input.recurrence_json)
        .map_err(|_| corrupt("Occurrence clone recurrence JSON is invalid"))?;
    let reminders = serde_json::from_str::<serde_json::Value>(input.reminders_json)
        .map_err(|_| corrupt("Occurrence clone reminder JSON is invalid"))?;
    let intrinsic_overrides = [
        (
            "schedule.isAllDay",
            serde_json::Value::Bool(input.is_all_day),
        ),
        ("recurrence.config", recurrence),
        ("reminders.config", reminders),
        (
            "schedule.timezone",
            input
                .schedule_timezone
                .map_or(serde_json::Value::Null, |value| {
                    serde_json::Value::String(value.to_owned())
                }),
        ),
    ];
    for (property_key, value) in intrinsic_overrides {
        let changed = connection.execute(
            "UPDATE block_properties SET value_json = ?1, updated_at = ?2 \
             WHERE block_id = ?3 AND project_id = ?4 AND property_key = ?5",
            params![
                serde_json::to_string(&value).map_err(|_| internal("Occurrence intrinsic JSON"))?,
                input.now,
                input.new_page_id,
                source.0,
                property_key,
            ],
        )?;
        if changed != 1 {
            return Err(corrupt(
                "Occurrence source Page is missing a required intrinsic property",
            ));
        }
    }

    let positions = connection
        .prepare(
            "SELECT position.view_id, position.group_key, position.rank_key, \
               CASE WHEN container.default_view_id = view.id THEN 1 ELSE 0 END \
             FROM database_view_page_positions position \
             JOIN database_views view ON view.id = position.view_id AND view.lifecycle = 'active' \
             JOIN database_containers container ON container.block_id = view.database_block_id \
             WHERE position.page_block_id = ?1 AND view.database_block_id = ?2 \
               AND view.data_source_id = ?3 ORDER BY position.view_id",
        )?
        .query_map(params![input.source_page_id, source.9, source.8], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (view_id, group_key, rank_key, primary) in positions {
        let rank_key = if primary == 1 {
            input
                .primary_rank_key
                .ok_or_else(|| invalid("Occurrence clone requires a primary View rank"))?
        } else {
            rank_key.as_str()
        };
        connection.execute(
            "INSERT INTO database_view_page_positions( \
               view_id, page_block_id, group_key, rank_key, revision, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            params![
                view_id,
                input.new_page_id,
                if primary == 1 {
                    Some(input.status)
                } else {
                    group_key.as_deref()
                },
                rank_key,
                input.now,
            ],
        )?;
    }
    reset_page_intrinsic_projection(connection, input.new_page_id, &source.0, input.now)?;
    crate::database::refresh_copied_page_projection(
        connection,
        input.new_page_id,
        Some(&membership_id),
        Some(&source.8),
        input.now,
    )?;

    Ok(OccurrencePageCloneResult {
        page_id: input.new_page_id.to_owned(),
        database_id: source.9,
        affected_document_ids: document_heads.into_keys().collect(),
    })
}

#[allow(clippy::too_many_arguments)]
fn persist_copy_documents(
    connection: &Connection,
    plan: &CopyPlan,
    source_page_id: &str,
    resolved_parent: &super::mutation::ResolvedWriteParent,
    store_epoch: &str,
    operation_id: &str,
    now: &str,
    assets_root: &Path,
) -> Result<BTreeMap<String, i64>, StoreError> {
    let mut document_heads = BTreeMap::new();
    for document in &plan.documents {
        let target_authority =
            read_document_authority(connection, &document.target_document_id)?
                .ok_or_else(|| corrupt("Staged Page copy has no Document authority"))?;
        let CopyDocumentBody::Yjs {
            schema,
            title,
            materialization,
        } = &document.body
        else {
            let source_authority =
                read_document_authority(connection, &document.source_document_id)?
                    .ok_or_else(|| corrupt("Canvas copy source authority disappeared"))?;
            let head_seq = clone_canvas_genesis(
                connection,
                &source_authority,
                &target_authority,
                assets_root,
            )?;
            document_heads.insert(document.target_document_id.clone(), head_seq);
            continue;
        };
        let remapped_blocks = remap_blocks(&materialization.block_tree, &plan.block_ids)?;
        let prepared = prepare_yjs_clone_genesis(
            &document.target_document_id,
            &document.owner_type,
            *schema,
            title.as_deref(),
            &remapped_blocks,
        )?;
        let full_state = prepared.engine.full_state_v1();
        let update_id = format!(
            "library-page-copy:{}:{}",
            sha256(operation_id.as_bytes()),
            sha256(document.source_document_id.as_bytes())
        );
        let persisted = persist_yjs_genesis(
            connection,
            PersistYjsGenesis {
                authority: &target_authority,
                materialization: &prepared.materialization,
                update_id: &update_id,
                client_session_id: "library-module",
                update: &prepared.update_v1,
                state_vector: &prepared.state_vector_v1,
                full_state: &full_state,
                store_epoch,
                operation_id: &update_id,
                emit_event: false,
            },
        )?;
        document_heads.insert(document.target_document_id.clone(), persisted.head_seq);
        if document.owner_type != "page" {
            continue;
        }
        let root = document.source_owner_id == source_page_id;
        let containing_document_id = if root {
            resolved_parent
                .document
                .as_ref()
                .map(|parent| parent.authority.head.id.as_str())
        } else {
            document
                .source_containing_document_id
                .as_ref()
                .and_then(|source| plan.document_ids.get(source))
                .map(String::as_str)
        };
        let top_level_rank = if root && resolved_parent.document.is_none() {
            connection
                .query_row(
                    "SELECT rank_key FROM top_level_block_placements WHERE block_id = ?1",
                    [&document.target_owner_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
        } else {
            None
        };
        insert_page_read_model(
            connection,
            &document.target_owner_id,
            &resolved_parent.project_id,
            &document.target_document_id,
            if containing_document_id.is_some() {
                "document"
            } else {
                "space"
            },
            containing_document_id,
            top_level_rank.as_deref(),
            &prepared.materialization,
            persisted.head_seq,
            now,
        )?;
        reset_page_intrinsic_projection(
            connection,
            &document.target_owner_id,
            &resolved_parent.project_id,
            now,
        )?;
    }
    Ok(document_heads)
}

fn build_copy_plan(
    connection: &Connection,
    operation_id: &str,
    source_project_id: &str,
    source_page_id: &str,
    source_root_document_id: &str,
    explicit_root: Option<ExplicitRootIdentity<'_>>,
) -> Result<CopyPlan, StoreError> {
    let mut pending = VecDeque::from([source_page_id.to_owned()]);
    let mut documents = Vec::new();
    let mut source_blocks =
        BTreeMap::from([(source_page_id.to_owned(), ("page".to_owned(), None))]);
    let mut visited_owners = BTreeSet::new();
    while let Some(source_owner_id) = pending.pop_front() {
        if !visited_owners.insert(source_owner_id.clone()) {
            continue;
        }
        if visited_owners.len() > MAX_COPY_DOCUMENTS {
            return Err(invalid("Page copy exceeds its Document bound"));
        }
        let authority =
            read_document_authority_by_owner(connection, source_project_id, &source_owner_id)?
                .ok_or_else(|| corrupt("Page ownership closure has a missing Document"))?;
        let source_containing_document_id = source_blocks
            .get(&source_owner_id)
            .and_then(|(_, containing)| containing.clone());
        if authority.owner_type == "canvas"
            && authority.head.sync_engine
                == crate::infrastructure::document_repository::DocumentSyncEngine::CanvasScene
        {
            documents.push((
                source_owner_id,
                authority.head.id,
                authority.owner_type,
                source_containing_document_id,
                authority.head.schema_key,
                authority.head.schema_version,
                CopyDocumentBody::Canvas,
            ));
            continue;
        }
        if !YJS_OWNER_TYPES.contains(&authority.owner_type.as_str())
            || !authority.head.is_live_yjs_authority()
        {
            return Err(StoreError::new(
                StoreErrorCode::UnsupportedSchema,
                "Page copy currently requires Yjs Page/Synced/Template ownership",
                false,
            ));
        }
        let schema = BlockDocumentSchema::from_identity(
            &authority.head.schema_key,
            authority.head.schema_version,
        )
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::UnsupportedSchema,
                "Page copy encountered an unsupported Document schema",
                false,
            )
        })?;
        let engine = reconstruct_yjs_engine(connection, &authority.head)?;
        let decoded = decode_block_document(engine.document(), schema)
            .map_err(|error| corrupt(format!("Page copy Document schema is invalid: {error}")))?;
        let materialization = crate::document::materialize_decoded_document(&decoded)
            .map_err(|error| corrupt(format!("Page copy Document cannot materialize: {error}")))?;
        for block in flatten_blocks(&materialization.block_tree) {
            if source_blocks.len() >= MAX_COPY_BLOCKS && !source_blocks.contains_key(&block.id) {
                return Err(invalid("Page copy exceeds its Block bound"));
            }
            let row = connection
                .query_row(
                    "SELECT type, lifecycle, containing_document_id FROM blocks \
                     WHERE id = ?1 AND project_id = ?2",
                    params![block.id, source_project_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| corrupt("Page copy projection references a missing Block"))?;
            if row.1 != "active" || row.2.as_deref() != Some(authority.head.id.as_str()) {
                return Err(corrupt("Page copy Block escaped its owning Document"));
            }
            source_blocks.insert(block.id.clone(), (row.0.clone(), row.2));
            let owns_document = connection
                .query_row(
                    "SELECT 1 FROM block_documents WHERE block_id = ?1 AND project_id = ?2",
                    params![block.id, source_project_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if owns_document {
                pending.push_back(block.id.clone());
            } else if TYPED_BLOCK_TYPES.contains(&row.0.as_str()) {
                return Err(StoreError::new(
                    StoreErrorCode::UnsupportedSchema,
                    format!(
                        "Page copy cannot clone embedded typed Block {} ({})",
                        block.id, row.0
                    ),
                    false,
                ));
            }
        }
        documents.push((
            source_owner_id,
            authority.head.id,
            authority.owner_type,
            source_containing_document_id,
            authority.head.schema_key,
            authority.head.schema_version,
            CopyDocumentBody::Yjs {
                schema,
                title: decoded.title,
                materialization: Box::new(materialization),
            },
        ));
    }
    if documents
        .first()
        .is_none_or(|document| document.1 != source_root_document_id)
    {
        return Err(corrupt("Page copy root Document changed during planning"));
    }
    let block_ids = source_blocks
        .keys()
        .map(|source_id| {
            (
                source_id.clone(),
                if source_id == source_page_id {
                    explicit_root.as_ref().map_or_else(
                        || stable_uuid_v7(operation_id, "block", source_id),
                        |identity| identity.page_id.to_owned(),
                    )
                } else {
                    stable_uuid_v7(operation_id, "block", source_id)
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let document_ids = documents
        .iter()
        .map(|document| {
            (
                document.1.clone(),
                if document.1 == source_root_document_id {
                    explicit_root.as_ref().map_or_else(
                        || stable_uuid_v7(operation_id, "document", &document.1),
                        |identity| identity.document_id.to_owned(),
                    )
                } else {
                    stable_uuid_v7(operation_id, "document", &document.1)
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let documents = documents
        .into_iter()
        .map(
            |(
                source_owner_id,
                source_document_id,
                owner_type,
                source_containing_document_id,
                schema_key,
                schema_version,
                body,
            )| {
                Ok(CopyDocument {
                    target_owner_id: block_ids
                        .get(&source_owner_id)
                        .cloned()
                        .ok_or_else(|| corrupt("Page copy owner identity is missing"))?,
                    target_document_id: document_ids
                        .get(&source_document_id)
                        .cloned()
                        .ok_or_else(|| corrupt("Page copy Document identity is missing"))?,
                    source_owner_id,
                    source_document_id,
                    owner_type,
                    source_containing_document_id,
                    schema_key,
                    schema_version,
                    body,
                })
            },
        )
        .collect::<Result<Vec<_>, StoreError>>()?;
    Ok(CopyPlan {
        source_project_id: source_project_id.to_owned(),
        source_root_document_id: source_root_document_id.to_owned(),
        block_ids,
        document_ids,
        documents,
    })
}

#[allow(clippy::too_many_arguments)]
fn stage_copy_authority(
    connection: &Connection,
    library_id: &str,
    parent: &super::mutation::ResolvedWriteParent,
    source_page_id: &str,
    target_page_id: &str,
    plan: &CopyPlan,
    requested_parent: &LibraryWriteParent,
    now: &str,
) -> Result<(), StoreError> {
    for document in &plan.documents {
        connection.execute(
            "INSERT INTO documents( \
               id, project_id, generation, head_seq, schema_key, schema_version, state_vector, \
               state_hash, readiness, authority, created_at, updated_at, sync_engine \
             ) VALUES (?1, ?2, 1, 0, ?3, ?4, X'', ?5, ?6, ?7, ?8, ?8, ?9)",
            params![
                document.target_document_id,
                parent.project_id,
                document.schema_key,
                document.schema_version,
                if matches!(&document.body, CopyDocumentBody::Canvas) {
                    "0".repeat(64)
                } else {
                    String::new()
                },
                if matches!(&document.body, CopyDocumentBody::Canvas) {
                    "ready"
                } else {
                    "pending_genesis"
                },
                if matches!(&document.body, CopyDocumentBody::Canvas) {
                    "ydoc_primary"
                } else {
                    "legacy_shadow"
                },
                now,
                if matches!(&document.body, CopyDocumentBody::Canvas) {
                    "canvas_scene"
                } else {
                    "yjs"
                },
            ],
        )?;
    }
    for document in &plan.documents {
        let root = document.source_owner_id == source_page_id;
        let containing_document_id = if root {
            parent
                .document
                .as_ref()
                .map(|parent_document| parent_document.authority.head.id.clone())
        } else {
            document
                .source_containing_document_id
                .as_ref()
                .and_then(|source| plan.document_ids.get(source))
                .cloned()
        };
        if !root && containing_document_id.is_none() {
            return Err(corrupt("Nested Page copy owner has no target container"));
        }
        connection.execute(
            "INSERT INTO blocks( \
               id, project_id, type, lifecycle, location_kind, containing_document_id, \
               containing_database_id, location_revision, metadata_revision, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, 'active', ?4, ?5, NULL, 1, 1, ?6, ?6)",
            params![
                document.target_owner_id,
                parent.project_id,
                document.owner_type,
                if containing_document_id.is_some() {
                    "document"
                } else {
                    "space"
                },
                containing_document_id,
                now,
            ],
        )?;
        connection.execute(
            "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
             VALUES (?1, ?2, ?3, ?4)",
            params![
                document.target_owner_id,
                document.target_document_id,
                parent.project_id,
                now,
            ],
        )?;
        connection.execute(
            "INSERT INTO block_properties( \
               block_id, project_id, property_key, value_type, value_json, revision, updated_at \
             ) SELECT ?1, ?2, property_key, value_type, value_json, 1, ?3 \
               FROM block_properties WHERE block_id = ?4 AND project_id = ?5",
            params![
                document.target_owner_id,
                parent.project_id,
                now,
                document.source_owner_id,
                plan.source_project_id,
            ],
        )?;
    }
    if parent.document.is_none() {
        let rank = append_rank(connection, "top_level_block_placements", &parent.project_id)?;
        connection.execute(
            "INSERT INTO top_level_block_placements( \
               block_id, project_id, rank_key, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![target_page_id, parent.project_id, rank, now],
        )?;
        insert_library_placement(
            connection,
            library_id,
            target_page_id,
            match requested_parent {
                LibraryWriteParent::Library { before } => before.as_ref(),
                LibraryWriteParent::Page { .. } => None,
            },
            now,
        )?;
    }
    for document in &plan.documents {
        if document.owner_type != "page" {
            continue;
        }
        let root = document.source_owner_id == source_page_id;
        let parent_page_id = if root {
            parent.page_id.clone()
        } else {
            let containing_source = document
                .source_containing_document_id
                .as_ref()
                .ok_or_else(|| corrupt("Nested Page copy has no containing Document"))?;
            plan.documents
                .iter()
                .find(|candidate| candidate.source_document_id == *containing_source)
                .filter(|candidate| candidate.owner_type == "page")
                .map(|candidate| candidate.target_owner_id.clone())
        };
        if !root && parent_page_id.is_none() {
            return Err(corrupt("Nested Page copy is not owned by a Page Document"));
        }
        connection.execute(
            "INSERT INTO pages( \
               block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
               parent_revision, metadata_revision, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', 1, 1, ?6, ?6)",
            params![
                document.target_owner_id,
                library_id,
                document.target_document_id,
                if parent_page_id.is_some() {
                    "page"
                } else {
                    "library"
                },
                parent_page_id.as_deref().unwrap_or(library_id),
                now,
            ],
        )?;
    }
    Ok(())
}

fn reset_page_intrinsic_projection(
    connection: &Connection,
    page_id: &str,
    project_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    let rows = connection
        .prepare(
            "SELECT property_key, value_json FROM block_properties \
             WHERE block_id = ?1 AND project_id = ?2 ORDER BY property_key",
        )?
        .query_map(params![page_id, project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut values = serde_json::Map::new();
    let mut intrinsic_revisions = serde_json::Map::new();
    for (key, value_json) in rows {
        let value = serde_json::from_str(&value_json)
            .map_err(|_| corrupt("Copied Page intrinsic Property JSON is invalid"))?;
        values.insert(key.clone(), value);
        intrinsic_revisions.insert(key, serde_json::Value::from(1));
    }
    let revisions = serde_json::json!({ "intrinsic": intrinsic_revisions, "database": {} });
    connection.execute(
        "UPDATE page_read_model SET intrinsic_properties_json = ?1, \
           property_revisions_json = ?2, updated_at = ?3 WHERE page_block_id = ?4",
        params![
            serde_json::to_string(&values).map_err(|_| internal("Copied intrinsic values"))?,
            serde_json::to_string(&revisions)
                .map_err(|_| internal("Copied intrinsic revisions"))?,
            now,
            page_id,
        ],
    )?;
    Ok(())
}

fn advance_copied_root_revisions(
    connection: &Connection,
    page_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    let block_updated = connection.execute(
        "UPDATE blocks SET location_revision = 2, metadata_revision = 2, updated_at = ?1 \
         WHERE id = ?2 AND type = 'page' \
           AND location_revision = 1 AND metadata_revision = 1",
        params![now, page_id],
    )?;
    let page_updated = connection.execute(
        "UPDATE pages SET parent_revision = 2, metadata_revision = 2, updated_at = ?1 \
         WHERE block_id = ?2 AND parent_revision = 1 AND metadata_revision = 1",
        params![now, page_id],
    )?;
    let projection_updated = connection.execute(
        "UPDATE page_read_model SET location_revision = 2, metadata_revision = 2, \
           updated_at = ?1 WHERE page_block_id = ?2 \
           AND location_revision = 1 AND metadata_revision = 1",
        params![now, page_id],
    )?;
    if block_updated == 1 && page_updated == 1 && projection_updated == 1 {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::RevisionConflict,
        "Copied Page revision authority changed before placement committed",
        true,
    ))
}

fn read_document_authority_by_owner(
    connection: &Connection,
    project_id: &str,
    owner_block_id: &str,
) -> Result<Option<crate::document::DocumentAuthorityRow>, StoreError> {
    let document_id = connection
        .query_row(
            "SELECT document_id FROM block_documents WHERE block_id = ?1 AND project_id = ?2",
            params![owner_block_id, project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    document_id
        .map(|document_id| read_document_authority(connection, &document_id))
        .transpose()
        .map(Option::flatten)
}

fn assert_fresh_identities(connection: &Connection, plan: &CopyPlan) -> Result<(), StoreError> {
    let mut allocated = BTreeSet::new();
    for identity in plan.block_ids.values().chain(plan.document_ids.values()) {
        if !allocated.insert(identity) {
            return Err(corrupt("Page copy allocated a duplicate identity"));
        }
    }
    for identity in plan.block_ids.values() {
        if connection
            .query_row("SELECT 1 FROM blocks WHERE id = ?1", [identity], |_| Ok(()))
            .optional()?
            .is_some()
        {
            return Err(StoreError::new(
                StoreErrorCode::AlreadyOwned,
                "Page copy Block identity already exists",
                false,
            ));
        }
    }
    for identity in plan.document_ids.values() {
        if connection
            .query_row("SELECT 1 FROM documents WHERE id = ?1", [identity], |_| {
                Ok(())
            })
            .optional()?
            .is_some()
        {
            return Err(StoreError::new(
                StoreErrorCode::AlreadyOwned,
                "Page copy Document identity already exists",
                false,
            ));
        }
    }
    Ok(())
}

fn remap_blocks(
    blocks: &[MaterializedBlockNode],
    block_ids: &BTreeMap<String, String>,
) -> Result<Vec<MaterializedBlockNode>, StoreError> {
    blocks
        .iter()
        .map(|block| {
            Ok(MaterializedBlockNode {
                id: block_ids
                    .get(&block.id)
                    .cloned()
                    .ok_or_else(|| corrupt("Page copy omitted a content Block identity"))?,
                block_type: block.block_type.clone(),
                props: block.props.clone(),
                content: block.content.clone(),
                children: remap_blocks(&block.children, block_ids)?,
            })
        })
        .collect()
}

fn flatten_blocks(blocks: &[MaterializedBlockNode]) -> Vec<&MaterializedBlockNode> {
    fn visit<'a>(blocks: &'a [MaterializedBlockNode], result: &mut Vec<&'a MaterializedBlockNode>) {
        for block in blocks {
            result.push(block);
            visit(&block.children, result);
        }
    }
    let mut result = Vec::new();
    visit(blocks, &mut result);
    result
}

fn embedded_page(page_id: &str) -> MaterializedBlockNode {
    MaterializedBlockNode {
        id: page_id.to_owned(),
        block_type: "page".to_owned(),
        props: BTreeMap::new(),
        content: None,
        children: Vec::new(),
    }
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

fn revision_conflict(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::RevisionConflict, message, true)
}

fn head_conflict(message: impl Into<String>) -> StoreError {
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
    use nodex_core_contracts::document::{DocumentOwnerCommand, OwnedDocumentIntent};
    use nodex_core_contracts::library::{
        LibraryAccess, LibraryIntent, LibraryNavigationNode, LibraryNavigationParent,
        LibraryPageCopyDestination, LibraryPageCopyValue, LibraryPageCopyViewPlacement,
        LibraryRead, LibraryReadValue, LibraryResourceTarget, LibraryWriteParent,
    };
    use nodex_core_contracts::{
        AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, CoreErrorCode, LibraryId,
        ModuleApplyRequest, ModuleReadRequest, ProfileId, ProjectId, StoreEpoch,
    };
    use tempfile::{TempDir, tempdir};

    use crate::document::OwnedDocumentModule;
    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::infrastructure::store::SqliteStoreKernel;
    use crate::library::LibraryModule;

    use super::*;

    const NOW: &str = "2026-07-19T02:20:00.000Z";

    fn context() -> BoundModuleContext {
        context_for("project-1")
    }

    fn context_for(project_id: &str) -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId(project_id.to_owned())),
            connection_id: format!("connection:page-copy:{project_id}"),
            adapter: AdapterKind::Test,
        }
    }

    fn seeded_kernel() -> (TempDir, SqliteStoreKernel) {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        std::fs::create_dir(home.join("assets")).expect("assets root");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) \
                         VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project-1', 'library-1', 'Page copy', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, 'epoch-1', ?1, ?1)",
                        [NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed Library identity");
        (directory, kernel)
    }

    fn create_page(
        module: &LibraryModule,
        operation_id: &str,
        page_id: &str,
        document_id: &str,
        title: &str,
        parent: LibraryWriteParent,
    ) {
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: page_id.to_owned(),
                        document_id: document_id.to_owned(),
                        title: title.to_owned(),
                        parent,
                    },
                },
            )
            .expect("create Page");
    }

    fn copy_request(
        operation_id: &str,
        expected_document_head_seq: i64,
        destination: LibraryPageCopyDestination,
    ) -> ModuleApplyRequest<LibraryIntent> {
        copy_request_for(
            operation_id,
            "page:source",
            1,
            1,
            0,
            expected_document_head_seq,
            destination,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn copy_request_for(
        operation_id: &str,
        source_page_id: &str,
        expected_location_revision: i64,
        expected_parent_revision: i64,
        expected_active_membership_revision: i64,
        expected_document_head_seq: i64,
        destination: LibraryPageCopyDestination,
    ) -> ModuleApplyRequest<LibraryIntent> {
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::CopyPage {
                source_page_id: source_page_id.to_owned(),
                expected_location_revision,
                expected_parent_revision,
                expected_active_membership_revision,
                expected_document_generation: 1,
                expected_document_head_seq,
                destination,
            },
        }
    }

    fn create_database(module: &LibraryModule) {
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:create-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: "018f0000-0000-7000-8000-000000000101".to_owned(),
                        data_source_id: "018f0000-0000-7000-8000-000000000102".to_owned(),
                        view_id: "018f0000-0000-7000-8000-000000000103".to_owned(),
                        name: "Copy target".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create target Database");
    }

    #[test]
    fn recursively_copies_page_authority_to_library_or_page_once() {
        let (_directory, kernel) = seeded_kernel();
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        create_page(
            &module,
            "operation:create-source",
            "page:source",
            "document:source",
            "Source Page",
            LibraryWriteParent::Library { before: None },
        );
        create_page(
            &module,
            "operation:create-child",
            "page:child",
            "document:child",
            "Child Page",
            LibraryWriteParent::Page {
                page_id: "page:source".to_owned(),
                expected_document_generation: 1,
                expected_document_head_seq: 1,
                before: None,
            },
        );
        create_page(
            &module,
            "operation:create-target",
            "page:target",
            "document:target",
            "Target Page",
            LibraryWriteParent::Library { before: None },
        );

        let library_request = copy_request(
            "operation:copy-to-library",
            2,
            LibraryPageCopyDestination::Library { before: None },
        );
        let library_copy = module
            .apply(&context(), library_request.clone())
            .expect("copy Page to Library");
        let library_replay = module
            .apply(&context(), library_request)
            .expect("replay Page copy");
        let result = library_copy
            .committed
            .value
            .page_copy
            .as_ref()
            .expect("copy result");
        let copied_root_id = result.page_id.clone();
        let copied_child_id = result.block_ids["page:child"].clone();
        let copied_root_document_id = result.document_id.clone();
        let copied_child_document_id = result.document_ids["document:child"].clone();
        assert!(library_copy.event.is_some());
        assert!(library_replay.event.is_none());
        assert!(library_replay.committed.receipt.mutation.duplicate);
        assert_eq!(result.block_ids.len(), 4);
        assert_eq!(result.document_ids.len(), 2);

        let page_request = copy_request(
            "operation:copy-to-page",
            2,
            LibraryPageCopyDestination::Page {
                page_id: "page:target".to_owned(),
                expected_document_generation: 1,
                expected_document_head_seq: 1,
                before: None,
            },
        );
        let page_copy = module
            .apply(&context(), page_request.clone())
            .expect("copy Page into Page");
        let page_replay = module
            .apply(&context(), page_request)
            .expect("replay nested Page copy");
        let nested_result = page_copy
            .committed
            .value
            .page_copy
            .as_ref()
            .expect("nested copy result");
        assert_eq!(
            page_copy.committed.receipt.committed_revisions["documentHead:document:target"],
            2
        );
        assert!(page_copy.event.is_some());
        assert!(page_replay.event.is_none());
        assert!(page_replay.committed.receipt.mutation.duplicate);

        let stale = module
            .apply(
                &context(),
                copy_request(
                    "operation:copy-stale-source",
                    1,
                    LibraryPageCopyDestination::Library { before: None },
                ),
            )
            .expect_err("reject stale Page copy");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);

        let roots = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::Children {
                        parent: LibraryNavigationParent::Library,
                        cursor: None,
                        limit: None,
                        force_include_target: None,
                    },
                },
            )
            .expect("read Library roots");
        let LibraryReadValue::Children { items, .. } = roots.value else {
            panic!("Library children");
        };
        assert!(items.iter().any(|item| matches!(
            item,
            LibraryNavigationNode::Page { page_id, title, .. }
                if page_id == &copied_root_id && title == "Source Page"
        )));
        assert!(!items.iter().any(|item| matches!(
            item,
            LibraryNavigationNode::Page { page_id, .. } if page_id == &copied_child_id
        )));

        kernel
            .readers()
            .read_default(|connection| {
                let copied = connection.query_row(
                    "SELECT root_document.head_seq, child_document.head_seq, \
                       child_page.parent_kind, child_page.parent_id, child_block.containing_document_id, \
                       (SELECT count(*) FROM document_block_index \
                         WHERE document_id = ?1 AND block_id = ?2), \
                       (SELECT count(*) FROM change_log \
                         WHERE operation_id = 'operation:copy-to-library'), \
                       (SELECT count(*) FROM core_module_receipts \
                         WHERE module_name = 'library' \
                           AND operation_id = 'operation:copy-to-library'), \
                       (SELECT count(*) FROM core_module_receipts \
                         WHERE module_name = 'library' \
                           AND operation_id = 'operation:copy-stale-source') \
                     FROM documents root_document \
                     JOIN documents child_document ON child_document.id = ?3 \
                     JOIN pages child_page ON child_page.block_id = ?2 \
                     JOIN blocks child_block ON child_block.id = child_page.block_id \
                     WHERE root_document.id = ?1",
                    params![
                        copied_root_document_id,
                        copied_child_id,
                        copied_child_document_id,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, i64>(7)?,
                            row.get::<_, i64>(8)?,
                        ))
                    },
                )?;
                assert_eq!(
                    copied,
                    (
                        1,
                        1,
                        "page".to_owned(),
                        copied_root_id.clone(),
                        copied_root_document_id.clone(),
                        1,
                        1,
                        1,
                        0,
                    )
                );
                let nested_parent = connection.query_row(
                    "SELECT page.parent_kind, page.parent_id, block.containing_document_id, \
                       target_document.head_seq \
                     FROM pages page JOIN blocks block ON block.id = page.block_id \
                     JOIN documents target_document ON target_document.id = 'document:target' \
                     WHERE page.block_id = ?1",
                    [&nested_result.page_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )?;
                assert_eq!(
                    nested_parent,
                    (
                        "page".to_owned(),
                        "page:target".to_owned(),
                        "document:target".to_owned(),
                        2,
                    )
                );
                Ok(())
            })
            .expect("durable recursive copy evidence");
    }

    #[test]
    fn copies_page_into_data_source_with_values_and_view_position_atomically() {
        let (_directory, kernel) = seeded_kernel();
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        create_page(
            &module,
            "operation:create-source",
            "page:source",
            "document:source",
            "Source row",
            LibraryWriteParent::Library { before: None },
        );
        create_database(&module);
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET database_block_id = \
                     '018f0000-0000-7000-8000-000000000101' WHERE id = 'project-1'",
                    [],
                )?;
                Ok(())
            })
            .expect("bind target Database");
        let request = copy_request(
            "operation:copy-to-data-source",
            1,
            LibraryPageCopyDestination::DataSource {
                data_source_id: "018f0000-0000-7000-8000-000000000102".to_owned(),
                expected_data_source_revision: 1,
                values: vec![LibraryPageCopyValue {
                    property_id: "status".to_owned(),
                    value: serde_json::json!("ship"),
                }],
                view: Some(LibraryPageCopyViewPlacement {
                    view_id: "018f0000-0000-7000-8000-000000000103".to_owned(),
                    expected_view_revision: 1,
                    group_key: Some("ship".to_owned()),
                    before: None,
                }),
            },
        );
        let copied = module
            .apply(&context(), request.clone())
            .expect("copy Page to Data Source");
        let replay = module
            .apply(&context(), request)
            .expect("replay Data Source Page copy");
        let result = copied
            .committed
            .value
            .page_copy
            .as_ref()
            .expect("copy result");
        assert!(copied.event.is_some());
        assert!(replay.event.is_none());
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            copied.committed.receipt.affected_database_ids,
            vec!["018f0000-0000-7000-8000-000000000101".to_owned()]
        );
        assert_eq!(
            copied.committed.receipt.affected_view_ids,
            vec!["018f0000-0000-7000-8000-000000000103".to_owned()]
        );
        assert_eq!(
            copied.committed.receipt.committed_revisions[&format!(
                "propertyValue:018f0000-0000-7000-8000-000000000102:{}:status",
                result.page_id
            )],
            2
        );

        let stale = module
            .apply(
                &context(),
                copy_request(
                    "operation:copy-to-stale-data-source",
                    1,
                    LibraryPageCopyDestination::DataSource {
                        data_source_id: "018f0000-0000-7000-8000-000000000102".to_owned(),
                        expected_data_source_revision: 0,
                        values: Vec::new(),
                        view: None,
                    },
                ),
            )
            .expect_err("reject stale Data Source copy");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);

        let copied_again = module
            .apply(
                &context(),
                copy_request_for(
                    "operation:copy-data-source-row",
                    &result.page_id,
                    2,
                    2,
                    1,
                    1,
                    LibraryPageCopyDestination::DataSource {
                        data_source_id: "018f0000-0000-7000-8000-000000000102".to_owned(),
                        expected_data_source_revision: 1,
                        values: Vec::new(),
                        view: None,
                    },
                ),
            )
            .expect("copy Data Source row into same source");
        let copied_again_id = copied_again
            .committed
            .value
            .page_copy
            .as_ref()
            .expect("second copy result")
            .page_id
            .clone();

        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT block.project_id, block.location_kind, \
                       block.containing_database_id, block.location_revision, \
                       block.metadata_revision, page.parent_kind, page.parent_id, \
                       page.parent_revision, membership.revision, value.value_json, \
                       value.revision, position.group_key, position.revision, \
                       projection.membership_id, projection.database_block_id, \
                       projection.view_id, projection.view_group_key, \
                       json_extract(projection.database_values_json, '$.status'), \
                       (SELECT count(*) FROM library_block_placements WHERE block_id = block.id), \
                       (SELECT count(*) FROM core_module_receipts \
                         WHERE module_name = 'library' \
                           AND operation_id = 'operation:copy-to-stale-data-source') \
                     FROM blocks block JOIN pages page ON page.block_id = block.id \
                     JOIN data_source_page_memberships membership \
                       ON membership.page_block_id = block.id AND membership.removed_at IS NULL \
                     JOIN data_source_property_values value ON value.membership_id = membership.id \
                       AND value.data_source_id = membership.data_source_id \
                       AND value.property_id = 'status' \
                     JOIN database_view_page_positions position ON position.page_block_id = block.id \
                       AND position.view_id = '018f0000-0000-7000-8000-000000000103' \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = ?1",
                    [&result.page_id],
                    |row| {
                        Ok((
                            (
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, i64>(3)?,
                                row.get::<_, i64>(4)?,
                                row.get::<_, String>(5)?,
                                row.get::<_, String>(6)?,
                                row.get::<_, i64>(7)?,
                                row.get::<_, i64>(8)?,
                                row.get::<_, String>(9)?,
                            ),
                            (
                                row.get::<_, i64>(10)?,
                                row.get::<_, String>(11)?,
                                row.get::<_, i64>(12)?,
                                row.get::<_, String>(13)?,
                                row.get::<_, String>(14)?,
                                row.get::<_, String>(15)?,
                                row.get::<_, String>(16)?,
                                row.get::<_, String>(17)?,
                                row.get::<_, i64>(18)?,
                                row.get::<_, i64>(19)?,
                            ),
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        (
                            "project-1".to_owned(),
                            "database".to_owned(),
                            "018f0000-0000-7000-8000-000000000101".to_owned(),
                            2,
                            4,
                            "data_source".to_owned(),
                            "018f0000-0000-7000-8000-000000000102".to_owned(),
                            2,
                            1,
                            "\"ship\"".to_owned(),
                        ),
                        (
                            2,
                            "ship".to_owned(),
                            1,
                            format!(
                                "membership:{}",
                                sha256(
                                    format!(
                                        "018f0000-0000-7000-8000-000000000102\0{}",
                                        result.page_id
                                    )
                                    .as_bytes()
                                )
                            ),
                            "018f0000-0000-7000-8000-000000000101".to_owned(),
                            "018f0000-0000-7000-8000-000000000103".to_owned(),
                            "ship".to_owned(),
                            "ship".to_owned(),
                            0,
                            0,
                        ),
                    )
                );
                let copied_value = connection.query_row(
                    "SELECT value.value_json, value.revision, membership.revision, \
                       block.location_revision, page.parent_revision \
                     FROM data_source_page_memberships membership \
                     JOIN data_source_property_values value ON value.membership_id = membership.id \
                       AND value.data_source_id = membership.data_source_id \
                       AND value.property_id = 'status' \
                     JOIN blocks block ON block.id = membership.page_block_id \
                     JOIN pages page ON page.block_id = block.id \
                     WHERE membership.page_block_id = ?1 AND membership.removed_at IS NULL",
                    [&copied_again_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?;
                assert_eq!(copied_value, ("\"ship\"".to_owned(), 1, 1, 2, 2));
                Ok(())
            })
            .expect("durable Data Source copy evidence");
    }

    #[test]
    fn rehomes_complete_copy_into_granted_data_source_storage_project() {
        let (_directory, kernel) = seeded_kernel();
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        create_page(
            &module,
            "operation:create-source",
            "page:source",
            "document:source",
            "Cross Project source",
            LibraryWriteParent::Library { before: None },
        );
        create_page(
            &module,
            "operation:create-child",
            "page:child",
            "document:child",
            "Cross Project child",
            LibraryWriteParent::Page {
                page_id: "page:source".to_owned(),
                expected_document_generation: 1,
                expected_document_head_seq: 1,
                before: None,
            },
        );
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO projects(id, library_id, name, created, updated) \
                     VALUES ('project-2', 'library-1', 'Target storage', ?1, ?1)",
                    [NOW],
                )?;
                Ok(())
            })
            .expect("seed target Project");
        module
            .apply(
                &context_for("project-2"),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:create-project-2-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: "018f0000-0000-7000-8000-000000000301".to_owned(),
                        data_source_id: "018f0000-0000-7000-8000-000000000302".to_owned(),
                        view_id: "018f0000-0000-7000-8000-000000000303".to_owned(),
                        name: "Granted target".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create target Project Database");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET database_block_id = \
                     '018f0000-0000-7000-8000-000000000301' WHERE id = 'project-2'",
                    [],
                )?;
                Ok(())
            })
            .expect("bind target Project Database");
        module
            .apply(
                &context_for("project-2"),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:grant-project-1-target".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Database {
                            database_id: "018f0000-0000-7000-8000-000000000301".to_owned(),
                        },
                        access: LibraryAccess::ReadWrite,
                    },
                },
            )
            .expect("grant target Database write access");

        let copied = module
            .apply(
                &context(),
                copy_request(
                    "operation:copy-across-projects",
                    2,
                    LibraryPageCopyDestination::DataSource {
                        data_source_id: "018f0000-0000-7000-8000-000000000302".to_owned(),
                        expected_data_source_revision: 1,
                        values: Vec::new(),
                        view: None,
                    },
                ),
            )
            .expect("copy into granted Data Source");
        let result = copied
            .committed
            .value
            .page_copy
            .as_ref()
            .expect("copy result");
        let copied_child_id = result.block_ids["page:child"].clone();
        let copied_child_document_id = result.document_ids["document:child"].clone();

        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT root.project_id, root.location_kind, root.containing_database_id, \
                       root_page.parent_kind, root_page.parent_id, root_document.project_id, \
                       child.project_id, child.containing_document_id, child_page.parent_id, \
                       child_document.project_id, source.project_id, \
                       (SELECT count(*) FROM project_resource_grants) \
                     FROM blocks root JOIN pages root_page ON root_page.block_id = root.id \
                     JOIN documents root_document ON root_document.id = ?2 \
                     JOIN blocks child ON child.id = ?3 \
                     JOIN pages child_page ON child_page.block_id = child.id \
                     JOIN documents child_document ON child_document.id = ?4 \
                     JOIN blocks source ON source.id = 'page:source' \
                     WHERE root.id = ?1",
                    params![
                        result.page_id,
                        result.document_id,
                        copied_child_id,
                        copied_child_document_id,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, String>(9)?,
                            row.get::<_, String>(10)?,
                            row.get::<_, i64>(11)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        "project-2".to_owned(),
                        "database".to_owned(),
                        "018f0000-0000-7000-8000-000000000301".to_owned(),
                        "data_source".to_owned(),
                        "018f0000-0000-7000-8000-000000000302".to_owned(),
                        "project-2".to_owned(),
                        "project-2".to_owned(),
                        result.document_id.clone(),
                        result.page_id.clone(),
                        "project-2".to_owned(),
                        "project-1".to_owned(),
                        1,
                    )
                );
                Ok(())
            })
            .expect("cross-Project copy evidence");
    }

    #[test]
    fn page_destination_requires_write_grant_and_rehomes_into_target_project() {
        let (_directory, kernel) = seeded_kernel();
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        create_page(
            &module,
            "operation:create-source",
            "page:source",
            "document:source",
            "Source",
            LibraryWriteParent::Library { before: None },
        );
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO projects(id, library_id, name, created, updated) \
                     VALUES ('project-2', 'library-1', 'Page target', ?1, ?1)",
                    [NOW],
                )?;
                Ok(())
            })
            .expect("seed target Project");
        module
            .apply(
                &context_for("project-2"),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:create-target-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:target".to_owned(),
                        document_id: "document:target".to_owned(),
                        title: "Target".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create target Project Page");
        let grant = |operation_id: &str, access| {
            module.apply(
                &context_for("project-2"),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: "page:target".to_owned(),
                        },
                        access,
                    },
                },
            )
        };
        grant("operation:grant-target-read", LibraryAccess::Read).expect("grant Page read access");
        let denied = module
            .apply(
                &context(),
                copy_request(
                    "operation:copy-with-read-grant",
                    1,
                    LibraryPageCopyDestination::Page {
                        page_id: "page:target".to_owned(),
                        expected_document_generation: 1,
                        expected_document_head_seq: 1,
                        before: None,
                    },
                ),
            )
            .expect_err("read grant cannot write target Page");
        assert_eq!(denied.code, CoreErrorCode::NotFound);
        grant("operation:grant-target-write", LibraryAccess::ReadWrite)
            .expect("upgrade Page write access");
        let copied = module
            .apply(
                &context(),
                copy_request(
                    "operation:copy-with-write-grant",
                    1,
                    LibraryPageCopyDestination::Page {
                        page_id: "page:target".to_owned(),
                        expected_document_generation: 1,
                        expected_document_head_seq: 1,
                        before: None,
                    },
                ),
            )
            .expect("write grant copies into target Page");
        let result = copied
            .committed
            .value
            .page_copy
            .as_ref()
            .expect("copy result");
        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT copied.project_id, copied.containing_document_id, \
                       document.project_id, target.head_seq, \
                       (SELECT count(*) FROM core_module_receipts \
                         WHERE module_name = 'library' \
                           AND operation_id = 'operation:copy-with-read-grant') \
                     FROM blocks copied JOIN documents document ON document.id = ?2 \
                     JOIN documents target ON target.id = 'document:target' \
                     WHERE copied.id = ?1",
                    params![result.page_id, result.document_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        "project-2".to_owned(),
                        "document:target".to_owned(),
                        "project-2".to_owned(),
                        2,
                        0,
                    )
                );
                Ok(())
            })
            .expect("Page grant copy evidence");
    }

    #[test]
    fn clones_canvas_genesis_without_a_second_public_event() {
        let (_directory, kernel) = seeded_kernel();
        let documents = OwnedDocumentModule::new("profile-1", "library-1", &kernel);
        documents
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:create-canvas".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: OwnedDocumentIntent::ApplyOwnerCommand {
                        command: DocumentOwnerCommand::CreateCanvasOwner {
                            block_id: "018f0000-0000-7000-8000-000000000201".to_owned(),
                            document_id: "document:canvas-source".to_owned(),
                            display_name: "Sketch".to_owned(),
                            before: None,
                        },
                    },
                },
            )
            .expect("create Canvas owner");
        documents
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:edit-canvas".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: OwnedDocumentIntent::ApplyCanvasMutation {
                        document_id: "document:canvas-source".to_owned(),
                        generation: 1,
                        expected_head_seq: 0,
                        mutation: serde_json::json!({
                            "elementCandidates": [{
                                "id": "element:note",
                                "type": "rectangle",
                                "version": 1,
                                "versionNonce": 7,
                                "index": "a0",
                                "isDeleted": false,
                                "text": "Native Canvas"
                            }],
                            "appStateIntents": {
                                "gridSize": {
                                    "expected": { "kind": "absent" },
                                    "value": { "kind": "value", "value": 20 }
                                }
                            },
                            "fileAdditions": {}
                        }),
                    },
                },
            )
            .expect("edit source Canvas");

        let target_canvas_id = "018f0000-0000-7000-8000-000000000202".to_owned();
        let target_canvas_document_id = "document:canvas-target".to_owned();
        let assets_root = kernel
            .database_path()
            .parent()
            .expect("Profile database parent")
            .join("assets");
        let before_event_count = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row("SELECT count(*) FROM change_log", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(StoreError::from)
            })
            .expect("count events before Canvas clone");
        let event_count = kernel
            .writer()
            .call({
                let target_canvas_id = target_canvas_id.clone();
                let target_canvas_document_id = target_canvas_document_id.clone();
                move |connection| {
                    with_immediate_transaction(connection, |transaction| {
                        transaction.execute(
                            "INSERT INTO blocks( \
                               id, project_id, type, lifecycle, location_kind, \
                               location_revision, metadata_revision, created_at, updated_at \
                             ) VALUES (?1, 'project-1', 'canvas', 'active', 'space', 1, 1, ?2, ?2)",
                            params![target_canvas_id, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO documents( \
                               id, project_id, generation, head_seq, schema_key, schema_version, \
                               state_vector, state_hash, readiness, authority, created_at, updated_at, \
                               sync_engine \
                             ) VALUES (?1, 'project-1', 1, 0, 'nodex.canvas', 1, X'', ?2, \
                               'ready', 'ydoc_primary', ?3, ?3, 'canvas_scene')",
                            params![target_canvas_document_id, "0".repeat(64), NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                             VALUES (?1, ?2, 'project-1', ?3)",
                            params![target_canvas_id, target_canvas_document_id, NOW],
                        )?;
                        let source = read_document_authority(
                            transaction,
                            "document:canvas-source",
                        )?
                        .expect("source Canvas authority");
                        let target = read_document_authority(
                            transaction,
                            &target_canvas_document_id,
                        )?
                        .expect("target Canvas authority");
                        assert_eq!(
                            clone_canvas_genesis(
                                transaction,
                                &source,
                                &target,
                                &assets_root,
                            )?,
                            1
                        );
                        transaction
                            .query_row("SELECT count(*) FROM change_log", [], |row| {
                                row.get::<_, i64>(0)
                            })
                            .map_err(StoreError::from)
                    })
                }
            })
            .expect("clone Canvas genesis");
        assert_eq!(event_count, before_event_count);

        kernel
            .readers()
            .read_default(|connection| {
                let source = connection.query_row(
                    "SELECT document.head_seq, scene.app_state_json, scene.scene_hash, \
                       element.element_json \
                     FROM documents document JOIN canvas_scenes scene \
                       ON scene.document_id = document.id \
                     JOIN canvas_scene_elements element ON element.document_id = document.id \
                     WHERE document.id = 'document:canvas-source'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )?;
                let target = connection.query_row(
                    "SELECT document.head_seq, scene.app_state_json, scene.scene_hash, \
                       element.element_json, block.type, block.location_kind, \
                       (SELECT count(*) FROM change_log) \
                     FROM documents document JOIN canvas_scenes scene \
                       ON scene.document_id = document.id \
                     JOIN canvas_scene_elements element ON element.document_id = document.id \
                     JOIN block_documents ownership ON ownership.document_id = document.id \
                     JOIN blocks block ON block.id = ownership.block_id \
                     WHERE document.id = ?1 AND block.id = ?2",
                    params![target_canvas_document_id, target_canvas_id],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                )?;
                assert_eq!(target.0, source.0);
                assert_eq!(target.1, source.1);
                assert_eq!(target.2, source.2);
                assert_eq!(target.3, source.3);
                assert_eq!(target.4, "canvas");
                assert_eq!(target.5, "space");
                assert_eq!(target.6, before_event_count);
                Ok(())
            })
            .expect("durable Canvas clone evidence");
    }
}
