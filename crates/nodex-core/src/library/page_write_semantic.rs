use std::path::Path;

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::library::{
    LibraryAgentSiblingAnchor, LibraryBlockTransferLogicalIntent, LibraryBlockTransferMode,
    LibraryBlockTransferPlan, LibraryBlockTransferSource, LibraryBlockTransferTarget,
    LibraryPageCopyDestination, LibraryPageCopyPositionAnchor, LibraryPageCopyValue,
    LibraryPageCopyViewPlacement, LibraryPageWriteDestination, LibraryResourceTarget,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

use crate::database::{
    resolve_page_copy_data_source_project, resolve_page_transfer_data_source_destination,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::LibraryApplyOutcome;
use super::mutation::{MutationEffects, finish_mutation, sqlite_now};

const MAX_ID_BYTES: usize = 512;

#[allow(clippy::too_many_arguments)]
pub(super) fn create_page(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    page_id: &str,
    document_id: &str,
    title_markdown: &str,
    nfm: &str,
    destination: &LibraryPageWriteDestination,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_id(page_id, "page_id")?;
    validate_id(document_id, "document_id")?;
    validate_id(operation_id, "operation_id")?;
    let resolved = resolve_destination(connection, context, library_id, destination, None)?;
    if !matches!(resolved, LibraryPageCopyDestination::DataSource { .. }) {
        let parent = super::page_copy::write_parent(&resolved)?;
        return super::mutation::create_page_from_nfm(
            connection,
            context,
            store_epoch,
            library_id,
            operation_id,
            request_hash,
            page_id,
            document_id,
            title_markdown,
            nfm,
            &parent,
        );
    }
    create_page_in_data_source(
        connection,
        context,
        store_epoch,
        library_id,
        operation_id,
        request_hash,
        page_id,
        document_id,
        title_markdown,
        nfm,
        &resolved,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_page_in_data_source(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    page_id: &str,
    document_id: &str,
    title_markdown: &str,
    nfm: &str,
    destination: &LibraryPageCopyDestination,
) -> Result<LibraryApplyOutcome, StoreError> {
    let requesting_project_id = bound_project_id(context)?;
    let destination = super::page_copy::data_source_destination(destination)
        .ok_or_else(|| corrupt("Created Page lost its Data Source destination"))?;
    let project_id = resolve_page_copy_data_source_project(
        connection,
        library_id,
        requesting_project_id,
        &destination.data_source_id,
        destination.expected_data_source_revision,
    )?;
    let now = sqlite_now(connection)?;
    let created = super::page_genesis::create_page_in_data_source(
        connection,
        super::page_genesis::PageGenesisInput {
            library_id,
            project_id: &project_id,
            actor_project_id: requesting_project_id,
            placement_access_project_id: Some(requesting_project_id),
            operation_id,
            store_epoch,
            page_id,
            document_id,
            title_markdown,
            nfm,
            destination: &destination,
            now: &now,
        },
    )?;
    let affected_block_ids = created.page_create.block_ids.clone();
    let affected_document_id = created.page_create.document_id.clone();

    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: created.project_id,
            operation_kind: "create_page",
            change_kind: "library.changed",
            did_mutate: true,
            created_target: Some(LibraryResourceTarget::Page {
                page_id: page_id.to_owned(),
            }),
            affected_parent_keys: vec![format!("data_source:{}", created.data_source_id)],
            affected_block_ids,
            affected_page_ids: vec![page_id.to_owned()],
            affected_database_ids: vec![created.database_id],
            affected_view_ids: created.affected_view_ids,
            affected_document_ids: vec![affected_document_id],
            committed_revisions: created.committed_revisions,
            page_create: Some(created.page_create),
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
            change_payload: None,
            committed_at: now,
        },
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn duplicate_page(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    source_page_id: &str,
    destination: &LibraryPageWriteDestination,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_id(source_page_id, "source_page_id")?;
    let project_id = bound_project_id(context)?;
    super::require_page_read_access(connection, library_id, project_id, source_page_id)?;
    let source = connection
        .query_row(
            "SELECT block.location_revision, page.parent_revision, COALESCE(membership.revision, 0), \
               document.generation, document.head_seq \
             FROM pages page JOIN blocks block ON block.id = page.block_id AND block.type = 'page' \
             JOIN documents document ON document.id = page.document_id \
             LEFT JOIN data_source_page_memberships membership \
               ON membership.page_block_id = page.block_id AND membership.removed_at IS NULL \
             WHERE page.block_id = ?1 AND page.library_id = ?2 \
               AND page.lifecycle = 'active' AND block.lifecycle = 'active' \
               AND document.readiness = 'ready'",
            params![source_page_id, library_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Source Page is unavailable"))?;
    let destination = resolve_destination(connection, context, library_id, destination, None)?;
    super::page_copy::copy_page(
        connection,
        context,
        store_epoch,
        library_id,
        operation_id,
        request_hash,
        source_page_id,
        source.0,
        source.1,
        source.2,
        source.3,
        source.4,
        &destination,
        assets_root,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn move_page(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    page_id: &str,
    destination: &LibraryPageWriteDestination,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_id(page_id, "page_id")?;
    let source = read_source(connection, library_id, page_id)?;
    let destination =
        resolve_destination(connection, context, library_id, destination, Some(page_id))?;
    let target = transfer_target(library_id, &destination)?;
    let intent = LibraryBlockTransferLogicalIntent {
        actor: json!({ "kind": "native_cli", "command": "page_move" }),
        mode: LibraryBlockTransferMode::Move,
        root_block_ids: vec![page_id.to_owned()],
        source,
        target,
    };
    let plan = super::block_transfer::plan(
        connection,
        context,
        library_id,
        operation_id,
        store_epoch,
        &intent,
    )?;
    let LibraryBlockTransferPlan::Prepared { preparation } = plan else {
        return Err(corrupt(
            "Fresh semantic Page move matched a committed transfer",
        ));
    };
    super::block_transfer::apply(
        connection,
        context,
        library_id,
        operation_id,
        store_epoch,
        request_hash,
        &intent,
        Some(&preparation.write_fence),
        assets_root,
    )
}

fn read_source(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<LibraryBlockTransferSource, StoreError> {
    let (parent_kind, parent_id, lifecycle) = connection
        .query_row(
            "SELECT page.parent_kind, page.parent_id, page.lifecycle \
             FROM pages page JOIN blocks block ON block.id = page.block_id AND block.type = 'page' \
             WHERE page.block_id = ?1 AND page.library_id = ?2 \
               AND block.lifecycle = 'active'",
            params![page_id, library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Source Page is unavailable"))?;
    if lifecycle != "active" {
        return Err(not_found("Source Page is unavailable"));
    }
    match parent_kind.as_str() {
        "library" if parent_id == library_id => Ok(LibraryBlockTransferSource::Library {
            library_id: library_id.to_owned(),
        }),
        "page" => Ok(LibraryBlockTransferSource::Page { page_id: parent_id }),
        "data_source" => Ok(LibraryBlockTransferSource::DataSource {
            data_source_id: parent_id,
        }),
        _ => Err(corrupt("Source Page has inconsistent parent authority")),
    }
}

fn resolve_destination(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    request: &LibraryPageWriteDestination,
    moving_page_id: Option<&str>,
) -> Result<LibraryPageCopyDestination, StoreError> {
    let project_id = bound_project_id(context)?;
    match request {
        LibraryPageWriteDestination::Library { at } => {
            super::mutation::require_project_in_library(connection, project_id, library_id)?;
            let ids = connection
                .prepare(
                    "SELECT placement.block_id FROM top_level_block_placements placement \
                     JOIN blocks block ON block.id = placement.block_id \
                     WHERE placement.project_id = ?1 AND block.lifecycle = 'active' \
                     ORDER BY placement.rank_key, placement.block_id",
                )?
                .query_map([project_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let before =
                resolve_before_anchor(connection, ids, at.as_ref(), moving_page_id, "Library")?;
            Ok(LibraryPageCopyDestination::Library { before })
        }
        LibraryPageWriteDestination::Page { page_id, at } => {
            validate_id(page_id, "destination.page_id")?;
            super::require_page_write_access(connection, library_id, project_id, page_id)?;
            let (document_id, generation, head_seq) = connection
                .query_row(
                    "SELECT page.document_id, document.generation, document.head_seq \
                     FROM pages page JOIN blocks block ON block.id = page.block_id \
                     JOIN documents document ON document.id = page.document_id \
                     WHERE page.block_id = ?1 AND page.library_id = ?2 \
                       AND page.lifecycle = 'active' AND block.lifecycle = 'active' \
                       AND document.readiness = 'ready'",
                    params![page_id, library_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| not_found("Destination Page is unavailable"))?;
            let ids = connection
                .prepare(
                    "SELECT entry.block_id FROM document_block_index entry \
                     JOIN blocks block ON block.id = entry.block_id \
                     WHERE entry.document_id = ?1 AND entry.parent_block_id IS NULL \
                       AND block.lifecycle = 'active' ORDER BY entry.ordinal, entry.block_id",
                )?
                .query_map([&document_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let before = resolve_before_anchor(
                connection,
                ids,
                at.as_ref(),
                moving_page_id,
                "Destination Page",
            )?;
            Ok(LibraryPageCopyDestination::Page {
                page_id: page_id.clone(),
                expected_document_generation: generation,
                expected_document_head_seq: head_seq,
                before,
            })
        }
        LibraryPageWriteDestination::DataSource { data_source_id, at } => {
            validate_id(data_source_id, "destination.data_source_id")?;
            let (view_id, view_config) = connection
                .query_row(
                    "SELECT view.id, view.config_json FROM data_sources source \
                     JOIN database_containers container \
                       ON container.block_id = source.home_database_block_id \
                     JOIN database_views view ON view.id = container.default_view_id \
                     WHERE source.id = ?1 AND source.library_id = ?2 \
                       AND source.lifecycle = 'active' AND container.lifecycle = 'active' \
                       AND view.lifecycle = 'active'",
                    params![data_source_id, library_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
                .ok_or_else(|| not_found("Destination Data Source has no default View"))?;
            let view_config = serde_json::from_str::<serde_json::Value>(&view_config)
                .map_err(|_| corrupt("Destination View config is invalid"))?;
            let group_property_id = view_config
                .pointer("/group/propertyId")
                .and_then(serde_json::Value::as_str);
            let existing_group_key = moving_page_id
                .map(|page_id| {
                    connection
                        .query_row(
                            "SELECT position.group_key \
                             FROM data_source_page_memberships membership \
                             LEFT JOIN database_view_page_positions position \
                               ON position.view_id = ?1 \
                              AND position.page_block_id = membership.page_block_id \
                             WHERE membership.data_source_id = ?2 \
                               AND membership.page_block_id = ?3 \
                               AND membership.removed_at IS NULL",
                            params![view_id, data_source_id, page_id],
                            |row| row.get::<_, Option<String>>(0),
                        )
                        .optional()
                })
                .transpose()?
                .flatten()
                .flatten();
            let group_key = existing_group_key
                .or_else(|| (group_property_id == Some("status")).then(|| "triage".to_owned()));
            let ids = connection
                .prepare(
                    "SELECT membership.page_block_id \
                     FROM data_source_page_memberships membership \
                     JOIN pages page ON page.block_id = membership.page_block_id \
                     LEFT JOIN database_view_page_positions position \
                       ON position.view_id = ?1 AND position.page_block_id = membership.page_block_id \
                     WHERE membership.data_source_id = ?2 AND membership.removed_at IS NULL \
                       AND page.lifecycle = 'active' AND position.group_key IS ?3 \
                     ORDER BY CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END, \
                       position.rank_key, membership.page_block_id",
                )?
                .query_map(params![view_id, data_source_id, group_key.as_deref()], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let before_page_id =
                resolve_before_id(ids, at.as_ref(), moving_page_id, "Destination View")?;
            let resolved = resolve_page_transfer_data_source_destination(
                connection,
                library_id,
                project_id,
                data_source_id,
                &view_id,
                group_key.as_deref(),
                before_page_id.as_deref(),
            )?;
            let destination = resolved.destination;
            Ok(LibraryPageCopyDestination::DataSource {
                data_source_id: destination.data_source_id,
                expected_data_source_revision: destination.expected_data_source_revision,
                values: destination
                    .values
                    .into_iter()
                    .map(|value| LibraryPageCopyValue {
                        property_id: value.property_id,
                        value: value.value,
                    })
                    .collect(),
                view: destination.view.map(|view| LibraryPageCopyViewPlacement {
                    view_id: view.view_id,
                    expected_view_revision: view.expected_view_revision,
                    group_key: view.group_key,
                    before: view.before.map(|before| LibraryPageCopyPositionAnchor {
                        page_id: before.page_id,
                        expected_position_revision: before.expected_position_revision,
                    }),
                }),
            })
        }
    }
}

fn resolve_before_anchor(
    connection: &Connection,
    ids: Vec<String>,
    anchor: Option<&LibraryAgentSiblingAnchor>,
    moving_page_id: Option<&str>,
    label: &str,
) -> Result<Option<nodex_core_contracts::library::LibraryPlacementAnchor>, StoreError> {
    let before_id = resolve_before_id(ids, anchor, moving_page_id, label)?;
    before_id
        .map(|block_id| super::agent_page_write::read_location_anchor(connection, &block_id))
        .transpose()
}

fn resolve_before_id(
    ids: Vec<String>,
    anchor: Option<&LibraryAgentSiblingAnchor>,
    moving_page_id: Option<&str>,
    label: &str,
) -> Result<Option<String>, StoreError> {
    if let (Some(moving), Some(LibraryAgentSiblingAnchor::Before { block_id }))
    | (Some(moving), Some(LibraryAgentSiblingAnchor::After { block_id })) =
        (moving_page_id, anchor)
        && moving == block_id
    {
        return Err(invalid("A moved Page cannot be its own placement anchor"));
    }
    let ids = ids
        .into_iter()
        .filter(|id| Some(id.as_str()) != moving_page_id)
        .collect::<Vec<_>>();
    super::agent_page_write::resolve_before_id(&ids, anchor, label)
}

fn transfer_target(
    library_id: &str,
    destination: &LibraryPageCopyDestination,
) -> Result<LibraryBlockTransferTarget, StoreError> {
    match destination {
        LibraryPageCopyDestination::Library { before } => Ok(LibraryBlockTransferTarget::Library {
            library_id: library_id.to_owned(),
            before_block_id: before.as_ref().map(|anchor| anchor.block_id.clone()),
        }),
        LibraryPageCopyDestination::Page {
            page_id, before, ..
        } => Ok(LibraryBlockTransferTarget::Page {
            page_id: page_id.clone(),
            parent_block_id: None,
            before_block_id: before.as_ref().map(|anchor| anchor.block_id.clone()),
        }),
        LibraryPageCopyDestination::DataSource {
            data_source_id,
            view,
            ..
        } => {
            let view = view
                .as_ref()
                .ok_or_else(|| corrupt("Semantic Page destination has no resolved View"))?;
            Ok(LibraryBlockTransferTarget::DataSource {
                data_source_id: data_source_id.clone(),
                view_id: view.view_id.clone(),
                group_key: view.group_key.clone(),
                before_page_id: view.before.as_ref().map(|anchor| anchor.page_id.clone()),
            })
        }
    }
}

fn bound_project_id(context: &BoundModuleContext) -> Result<&str, StoreError> {
    context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| unauthorized("Semantic Page mutation requires a bound Project"))
}

fn validate_id(value: &str, field: &str) -> Result<(), StoreError> {
    if value.is_empty() || value.len() > MAX_ID_BYTES || value.trim() != value {
        return Err(invalid(format!(
            "{field} must be one bounded stable identity"
        )));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn unauthorized(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
