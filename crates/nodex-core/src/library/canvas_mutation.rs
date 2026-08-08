use std::collections::BTreeMap;
use std::path::Path;

use nodex_core_contracts::library::{
    LibraryCanvasDestination, LibraryCanvasMutationResult, LibraryCommitValue, LibraryDocumentHead,
    LibraryPageInsertion, LibraryReceipt, LibraryResourceTarget, LibraryWriteParent,
};
use nodex_core_contracts::{BoundModuleContext, ModuleName};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::document::{
    CANVAS_OWNER_TYPE, CANVAS_SCHEMA_KEY, CANVAS_SCHEMA_VERSION, DocumentBlockOperation,
    clone_canvas_genesis, ensure_canvas_scene, is_primary_canvas_block_id, read_document_authority,
};
use crate::domain::block_materialization::MaterializedBlockNode;
use crate::infrastructure::durable_mutation::{
    self, DurableMutationScope, OperationIdentity, SealedOutcome,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::LibraryApplyOutcome;
use super::mutation::{
    MutationEffects, ResolvedWriteParent, append_rank, embedded_resource_block,
    insert_library_placement, library_commit_result,
    persist_parent_operations_detailed_with_local_commit, require_project_in_library,
    resolve_library_mutation_authority, resolve_write_parent_for_context, seal_mutation,
    sqlite_now,
};

struct ResolvedCanvasDestination {
    parent: ResolvedWriteParent,
    insertion: Option<LibraryPageInsertion>,
    library_before: Option<nodex_core_contracts::library::LibraryPlacementAnchor>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn create(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    canvas_id: &str,
    document_id: &str,
    display_name: &str,
    destination: &LibraryCanvasDestination,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    create_internal(
        connection,
        context,
        store_epoch,
        library_id,
        operation_id,
        request_hash,
        canvas_id,
        document_id,
        display_name,
        destination,
        None,
        assets_root,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn duplicate(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    source_canvas_id: &str,
    canvas_id: &str,
    document_id: &str,
    display_name: Option<&str>,
    expected_document_generation: i64,
    expected_document_head_seq: i64,
    destination: &LibraryCanvasDestination,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    let source = read_canvas_authority(connection, library_id, source_canvas_id)?;
    require_canvas_access(connection, context, library_id, &source, false)?;
    if source.document_generation != expected_document_generation
        || source.document_head_seq != expected_document_head_seq
    {
        return Err(conflict("Source Canvas content changed"));
    }
    let name = display_name
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{} copy", source.display_name));
    create_internal(
        connection,
        context,
        store_epoch,
        library_id,
        operation_id,
        request_hash,
        canvas_id,
        document_id,
        &name,
        destination,
        Some(&source),
        assets_root,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_internal(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    canvas_id: &str,
    document_id: &str,
    display_name: &str,
    destination: &LibraryCanvasDestination,
    source: Option<&CanvasAuthority>,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_uuid_v7("canvas_id", canvas_id)?;
    validate_uuid_v7("document_id", document_id)?;
    let display_name = validate_display_name(display_name)?;
    let resolved = resolve_destination(connection, context, library_id, destination)?;
    let project_id = resolved.parent.project_id.clone();
    let containing_document_id = resolved
        .parent
        .document
        .as_ref()
        .map(|document| document.authority.head.id.clone());
    let now = sqlite_now(connection)?;
    let commit_result = durable_mutation::run(
        connection,
        OperationIdentity {
            module: ModuleName::Library,
            module_name: "library",
            operation_id,
            intent_hash: request_hash,
            store_epoch,
            committed_at: &now,
            context,
        },
        |scope| {
            connection.execute(
                "INSERT INTO blocks(\
           id, project_id, type, lifecycle, location_kind, containing_document_id, \
           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, 'canvas', 'active', ?3, ?4, NULL, 1, 1, ?5, ?5)",
                params![
                    canvas_id,
                    project_id,
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
                "INSERT INTO block_properties(\
           block_id, project_id, property_key, value_type, value_json, revision, updated_at\
         ) VALUES (?1, ?2, 'document.display_name', 'string', ?3, 1, ?4)",
                params![
                    canvas_id,
                    project_id,
                    serde_json::to_string(display_name)
                        .map_err(|_| internal("Canvas display name JSON"))?,
                    now,
                ],
            )?;
            connection.execute(
                "INSERT INTO documents(\
           id, project_id, generation, head_seq, schema_key, schema_version, state_vector, \
           state_hash, readiness, authority, created_at, updated_at, sync_engine\
         ) VALUES (?1, ?2, 1, 0, ?3, ?4, X'', ?5, 'ready', 'ydoc_primary', ?6, ?6, \
           'canvas_scene')",
                params![
                    document_id,
                    project_id,
                    CANVAS_SCHEMA_KEY,
                    CANVAS_SCHEMA_VERSION,
                    "0".repeat(64),
                    now,
                ],
            )?;
            connection.execute(
                "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
                params![canvas_id, document_id, project_id, now],
            )?;
            connection.execute(
                "INSERT INTO canvas_owners(block_id, library_id, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?3)",
                params![canvas_id, library_id, now],
            )?;

            if resolved.parent.document.is_none() {
                let rank = append_rank(connection, "top_level_block_placements", &project_id)?;
                connection.execute(
                    "INSERT INTO top_level_block_placements(\
               block_id, project_id, rank_key, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![canvas_id, project_id, rank, now],
                )?;
                insert_library_placement(
                    connection,
                    library_id,
                    canvas_id,
                    resolved.library_before.as_ref(),
                    &now,
                )?;
            }

            let authority = read_document_authority(connection, document_id)?
                .ok_or_else(|| corrupt("Created Canvas has no Document authority"))?;
            let document_head_seq = if let Some(source) = source {
                let source_authority = read_document_authority(connection, &source.document_id)?
                    .ok_or_else(|| corrupt("Source Canvas lost its Document authority"))?;
                clone_canvas_genesis(connection, &source_authority, &authority, assets_root)?
            } else {
                let (_, created) = ensure_canvas_scene(connection, &authority, assets_root)?;
                if !created {
                    return Err(corrupt("Created Canvas reused scene authority"));
                }
                0
            };

            let parent_commit = resolved
                .parent
                .document
                .as_ref()
                .map(|parent| {
                    let operations = insertion_operations(
                        &resolved.parent,
                        resolved.insertion.as_ref(),
                        PlacementAction::Insert(embedded_resource_block(
                            canvas_id,
                            CANVAS_OWNER_TYPE,
                        )),
                    )?;
                    persist_parent_operations_detailed_with_local_commit(
                        connection,
                        store_epoch,
                        operation_id,
                        "canvas-insert",
                        parent,
                        &operations,
                        scope.evidence(),
                    )
                })
                .transpose()?;
            let document_commits = parent_commit.clone().into_iter().collect::<Vec<_>>();
            let operation_kind = if source.is_some() {
                "duplicate_canvas"
            } else {
                "create_canvas"
            };
            seal_canvas_mutation(
                scope,
                context,
                library_id,
                operation_id,
                operation_kind,
                canvas_id,
                document_id,
                source.map(|source| source.canvas_id.clone()),
                1,
                1,
                &resolved,
                document_head_seq,
                document_commits,
                now.clone(),
            )
        },
    )?;
    library_commit_result(connection, commit_result)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn rename(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    canvas_id: &str,
    display_name: &str,
    expected_metadata_revision: i64,
) -> Result<LibraryApplyOutcome, StoreError> {
    let canvas = read_canvas_authority(connection, library_id, canvas_id)?;
    require_canvas_access(connection, context, library_id, &canvas, true)?;
    if canvas.lifecycle != "active" {
        return Err(not_found("Canvas is unavailable"));
    }
    if canvas.metadata_revision != expected_metadata_revision {
        return Err(conflict("Canvas metadata changed"));
    }
    let display_name = validate_display_name(display_name)?;
    let now = sqlite_now(connection)?;
    let commit_result = durable_mutation::run(
        connection,
        OperationIdentity {
            module: ModuleName::Library,
            module_name: "library",
            operation_id,
            intent_hash: request_hash,
            store_epoch,
            committed_at: &now,
            context,
        },
        |scope| {
            let changed = connection.execute(
                "UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?1 \
         WHERE id = ?2 AND type = 'canvas' AND lifecycle = 'active' \
           AND metadata_revision = ?3",
                params![now, canvas_id, expected_metadata_revision],
            )?;
            if changed != 1 {
                return Err(conflict("Canvas metadata changed"));
            }
            connection.execute(
                "INSERT INTO block_properties(\
           block_id, project_id, property_key, value_type, value_json, revision, updated_at\
         ) VALUES (?1, ?2, 'document.display_name', 'string', ?3, 1, ?4) \
         ON CONFLICT(block_id, property_key) DO UPDATE SET \
           value_type = 'string', value_json = excluded.value_json, \
           revision = block_properties.revision + 1, updated_at = excluded.updated_at",
                params![
                    canvas_id,
                    canvas.project_id,
                    serde_json::to_string(display_name)
                        .map_err(|_| internal("Canvas display name JSON"))?,
                    now,
                ],
            )?;
            connection.execute(
                "UPDATE canvas_owners SET updated_at = ?1 WHERE block_id = ?2 AND library_id = ?3",
                params![now, canvas_id, library_id],
            )?;
            seal_canvas_mutation(
                scope,
                context,
                library_id,
                operation_id,
                "rename_canvas",
                canvas_id,
                &canvas.document_id,
                None,
                canvas.location_revision,
                expected_metadata_revision + 1,
                &resolved_current_location(connection, library_id, &canvas)?,
                canvas.document_head_seq,
                Vec::new(),
                now.clone(),
            )
        },
    )?;
    library_commit_result(connection, commit_result)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn move_canvas(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    canvas_id: &str,
    expected_location_revision: i64,
    destination: &LibraryCanvasDestination,
) -> Result<LibraryApplyOutcome, StoreError> {
    let canvas = read_canvas_authority(connection, library_id, canvas_id)?;
    require_canvas_access(connection, context, library_id, &canvas, true)?;
    if canvas.lifecycle != "active" {
        return Err(not_found("Canvas is unavailable"));
    }
    if canvas.location_revision != expected_location_revision {
        return Err(conflict("Canvas location changed"));
    }
    let resolved = resolve_destination(connection, context, library_id, destination)?;
    if resolved.parent.document.is_some() && resolved.parent.project_id != canvas.project_id {
        return Err(invalid(
            "Cross-Project Canvas rehome is not available in this mutation",
        ));
    }
    let source_document = canvas
        .containing_document_id
        .as_deref()
        .map(|document_id| super::mutation::load_parent_document(connection, document_id))
        .transpose()?;
    let target_document_id = resolved
        .parent
        .document
        .as_ref()
        .map(|document| document.authority.head.id.clone());
    let same_document = canvas.containing_document_id.is_some()
        && canvas.containing_document_id == target_document_id;
    let now = sqlite_now(connection)?;
    let commit_result = durable_mutation::run(
        connection,
        OperationIdentity {
            module: ModuleName::Library,
            module_name: "library",
            operation_id,
            intent_hash: request_hash,
            store_epoch,
            committed_at: &now,
            context,
        },
        |scope| {
            scope.observe_authorization_before(super::authorization_loss::capture(
                connection,
                library_id,
                super::authorization_loss::AuthorizationRoots::canvas(canvas_id.to_owned()),
                None,
            )?);
            connection.execute(
                "DELETE FROM top_level_block_placements WHERE block_id = ?1",
                [canvas_id],
            )?;
            connection.execute(
                "DELETE FROM library_block_placements WHERE block_id = ?1 AND library_id = ?2",
                params![canvas_id, library_id],
            )?;
            let changed = connection.execute(
                "UPDATE blocks SET location_kind = ?1, containing_document_id = ?2, \
           containing_database_id = NULL, location_revision = location_revision + 1, \
           updated_at = ?3 WHERE id = ?4 AND type = 'canvas' AND lifecycle = 'active' \
           AND location_revision = ?5",
                params![
                    if target_document_id.is_some() {
                        "document"
                    } else {
                        "space"
                    },
                    target_document_id,
                    now,
                    canvas_id,
                    expected_location_revision,
                ],
            )?;
            if changed != 1 {
                return Err(conflict("Canvas location changed"));
            }
            if resolved.parent.document.is_none() {
                let rank =
                    append_rank(connection, "top_level_block_placements", &canvas.project_id)?;
                connection.execute(
                    "INSERT INTO top_level_block_placements(\
               block_id, project_id, rank_key, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![canvas_id, canvas.project_id, rank, now],
                )?;
                insert_library_placement(
                    connection,
                    library_id,
                    canvas_id,
                    resolved.library_before.as_ref(),
                    &now,
                )?;
            }

            let mut document_commits = Vec::new();
            if same_document {
                let parent = resolved
                    .parent
                    .document
                    .as_ref()
                    .ok_or_else(|| corrupt("Same-Document Canvas move lost its target"))?;
                let operations = insertion_operations(
                    &resolved.parent,
                    resolved.insertion.as_ref(),
                    PlacementAction::Move(canvas_id),
                )?;
                document_commits.push(persist_parent_operations_detailed_with_local_commit(
                    connection,
                    store_epoch,
                    operation_id,
                    "canvas-move",
                    parent,
                    &operations,
                    scope.evidence(),
                )?);
            } else {
                if let Some(source) = source_document.as_ref() {
                    document_commits.push(persist_parent_operations_detailed_with_local_commit(
                        connection,
                        store_epoch,
                        operation_id,
                        "canvas-source",
                        source,
                        &[DocumentBlockOperation::DeleteBlock {
                            block_id: canvas_id.to_owned(),
                        }],
                        scope.evidence(),
                    )?);
                }
                if let Some(target) = resolved.parent.document.as_ref() {
                    let operations = insertion_operations(
                        &resolved.parent,
                        resolved.insertion.as_ref(),
                        PlacementAction::Insert(embedded_resource_block(
                            canvas_id,
                            CANVAS_OWNER_TYPE,
                        )),
                    )?;
                    document_commits.push(persist_parent_operations_detailed_with_local_commit(
                        connection,
                        store_epoch,
                        operation_id,
                        "canvas-target",
                        target,
                        &operations,
                        scope.evidence(),
                    )?);
                }
            }
            connection.execute(
                "UPDATE canvas_owners SET updated_at = ?1 WHERE block_id = ?2 AND library_id = ?3",
                params![now, canvas_id, library_id],
            )?;
            seal_canvas_mutation(
                scope,
                context,
                library_id,
                operation_id,
                "move_canvas",
                canvas_id,
                &canvas.document_id,
                None,
                expected_location_revision + 1,
                canvas.metadata_revision,
                &resolved,
                canvas.document_head_seq,
                document_commits,
                now.clone(),
            )
        },
    )?;
    library_commit_result(connection, commit_result)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn delete(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    canvas_id: &str,
    expected_location_revision: i64,
    expected_metadata_revision: i64,
    containing_document_head: Option<&LibraryDocumentHead>,
) -> Result<LibraryApplyOutcome, StoreError> {
    let canvas = read_canvas_authority(connection, library_id, canvas_id)?;
    require_canvas_access(connection, context, library_id, &canvas, true)?;
    if canvas.is_primary {
        return Err(StoreError::new(
            StoreErrorCode::ProtectedOwnerDeletion,
            "A Project's primary Canvas cannot be deleted",
            false,
        ));
    }
    if canvas.lifecycle != "active" {
        return Err(not_found("Canvas is unavailable"));
    }
    if canvas.location_revision != expected_location_revision
        || canvas.metadata_revision != expected_metadata_revision
    {
        return Err(conflict("Canvas changed before deletion"));
    }
    let source_document = canvas
        .containing_document_id
        .as_deref()
        .map(|document_id| super::mutation::load_parent_document(connection, document_id))
        .transpose()?;
    match (&source_document, containing_document_head) {
        (Some(source), Some(expected)) => {
            if source.authority.head.id != expected.document_id
                || source.authority.head.generation != expected.generation
                || source.authority.head.head_seq != expected.head_seq
            {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    "Canvas host Document changed",
                    true,
                ));
            }
        }
        (Some(_), None) => {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Nested Canvas deletion requires the host Page Document head",
                false,
            ));
        }
        (None, Some(_)) => {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "A root Canvas cannot carry a host Document head",
                false,
            ));
        }
        (None, None) => {}
    }
    let now = sqlite_now(connection)?;
    let commit_result = durable_mutation::run(
        connection,
        OperationIdentity {
            module: ModuleName::Library,
            module_name: "library",
            operation_id,
            intent_hash: request_hash,
            store_epoch,
            committed_at: &now,
            context,
        },
        |scope| {
            scope.observe_authorization_before(super::authorization_loss::capture(
                connection,
                library_id,
                super::authorization_loss::AuthorizationRoots::canvas(canvas_id.to_owned()),
                None,
            )?);
            let changed = connection.execute(
                "UPDATE blocks SET lifecycle = 'deleted', \
           location_revision = location_revision + 1, \
           metadata_revision = metadata_revision + 1, updated_at = ?1 \
         WHERE id = ?2 AND type = 'canvas' AND lifecycle = 'active' \
           AND location_revision = ?3 AND metadata_revision = ?4",
                params![
                    now,
                    canvas_id,
                    expected_location_revision,
                    expected_metadata_revision,
                ],
            )?;
            if changed != 1 {
                return Err(conflict("Canvas changed before deletion"));
            }
            connection.execute(
                "DELETE FROM top_level_block_placements WHERE block_id = ?1",
                [canvas_id],
            )?;
            connection.execute(
                "DELETE FROM library_block_placements WHERE block_id = ?1 AND library_id = ?2",
                params![canvas_id, library_id],
            )?;
            connection.execute(
                "UPDATE canvas_owners SET updated_at = ?1 WHERE block_id = ?2 AND library_id = ?3",
                params![now, canvas_id, library_id],
            )?;
            let parent_commit = source_document
                .as_ref()
                .map(|source| {
                    persist_parent_operations_detailed_with_local_commit(
                        connection,
                        store_epoch,
                        operation_id,
                        "canvas-delete",
                        source,
                        &[DocumentBlockOperation::DeleteBlock {
                            block_id: canvas_id.to_owned(),
                        }],
                        scope.evidence(),
                    )
                })
                .transpose()?;
            let resolved = resolved_current_location(connection, library_id, &canvas)?;
            seal_canvas_mutation(
                scope,
                context,
                library_id,
                operation_id,
                "delete_canvas",
                canvas_id,
                &canvas.document_id,
                None,
                expected_location_revision + 1,
                expected_metadata_revision + 1,
                &resolved,
                canvas.document_head_seq,
                parent_commit.into_iter().collect(),
                now.clone(),
            )
        },
    )?;
    library_commit_result(connection, commit_result)
}

#[derive(Clone)]
struct CanvasAuthority {
    canvas_id: String,
    project_id: String,
    lifecycle: String,
    containing_document_id: Option<String>,
    location_revision: i64,
    metadata_revision: i64,
    document_id: String,
    document_generation: i64,
    document_head_seq: i64,
    display_name: String,
    is_primary: bool,
}

fn read_canvas_authority(
    connection: &Connection,
    library_id: &str,
    canvas_id: &str,
) -> Result<CanvasAuthority, StoreError> {
    connection
        .query_row(
            "SELECT block.project_id, block.lifecycle, \
                    block.containing_document_id, block.location_revision, \
                    block.metadata_revision, document.id, document.generation, \
                    document.head_seq, property.value_json \
             FROM blocks block \
             JOIN canvas_owners canvas ON canvas.block_id = block.id \
             JOIN block_documents ownership ON ownership.block_id = block.id \
             JOIN documents document ON document.id = ownership.document_id \
             LEFT JOIN block_properties property ON property.block_id = block.id \
               AND property.property_key = 'document.display_name' \
             WHERE block.id = ?1 AND block.type = 'canvas' \
               AND canvas.library_id = ?2 AND document.sync_engine = 'canvas_scene'",
            params![canvas_id, library_id],
            |row| {
                let value_json = row.get::<_, Option<String>>(8)?;
                let display_name = value_json
                    .as_deref()
                    .and_then(|value| serde_json::from_str::<String>(value).ok())
                    .unwrap_or_else(|| "Canvas".to_owned());
                let project_id = row.get::<_, String>(0)?;
                Ok(CanvasAuthority {
                    canvas_id: canvas_id.to_owned(),
                    is_primary: is_primary_canvas_block_id(canvas_id, &project_id),
                    project_id,
                    lifecycle: row.get(1)?,
                    containing_document_id: row.get(2)?,
                    location_revision: row.get(3)?,
                    metadata_revision: row.get(4)?,
                    document_id: row.get(5)?,
                    document_generation: row.get(6)?,
                    document_head_seq: row.get(7)?,
                    display_name,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Canvas is unavailable"))
}

fn require_canvas_access(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    canvas: &CanvasAuthority,
    write: bool,
) -> Result<(), StoreError> {
    let authority = resolve_library_mutation_authority(connection, context, library_id)?;
    let Some(requesting_project_id) = authority.requesting_project_id.as_deref() else {
        return Ok(());
    };
    if requesting_project_id == canvas.project_id {
        return require_project_in_library(connection, requesting_project_id, library_id);
    }
    let Some(document_id) = canvas.containing_document_id.as_deref() else {
        return Err(unauthorized("Canvas belongs to another Project"));
    };
    let page_id = connection
        .query_row(
            "SELECT page.block_id FROM pages page \
             WHERE page.document_id = ?1 AND page.library_id = ?2 AND page.lifecycle = 'active'",
            params![document_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Canvas host Document has no active Page owner"))?;
    if write {
        return super::require_page_write_access(
            connection,
            library_id,
            requesting_project_id,
            &page_id,
        );
    }
    super::require_page_read_access(connection, library_id, requesting_project_id, &page_id)
}

fn resolve_destination(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    destination: &LibraryCanvasDestination,
) -> Result<ResolvedCanvasDestination, StoreError> {
    match destination {
        LibraryCanvasDestination::Library { before } => {
            let parent = resolve_write_parent_for_context(
                connection,
                context,
                library_id,
                &LibraryWriteParent::Library {
                    before: before.clone(),
                },
            )?;
            Ok(ResolvedCanvasDestination {
                parent,
                insertion: None,
                library_before: before.clone(),
            })
        }
        LibraryCanvasDestination::Page {
            page_id,
            expected_document_generation,
            expected_document_head_seq,
            insertion,
        } => {
            let parent = resolve_write_parent_for_context(
                connection,
                context,
                library_id,
                &LibraryWriteParent::Page {
                    page_id: page_id.clone(),
                    expected_document_generation: *expected_document_generation,
                    expected_document_head_seq: *expected_document_head_seq,
                    before: None,
                },
            )?;
            validate_insertion(&parent, insertion)?;
            Ok(ResolvedCanvasDestination {
                parent,
                insertion: Some(insertion.clone()),
                library_before: None,
            })
        }
    }
}

enum PlacementAction<'a> {
    Insert(MaterializedBlockNode),
    Move(&'a str),
}

fn insertion_operations(
    parent: &ResolvedWriteParent,
    insertion: Option<&LibraryPageInsertion>,
    action: PlacementAction<'_>,
) -> Result<Vec<DocumentBlockOperation>, StoreError> {
    let insertion =
        insertion.ok_or_else(|| invalid("Page Canvas placement requires an insertion"))?;
    let (parent_block_id, before_block_id, replaced_block_id) = match insertion {
        LibraryPageInsertion::Append { parent_block_id } => (parent_block_id.clone(), None, None),
        LibraryPageInsertion::Before {
            parent_block_id,
            anchor_block_id,
        } => (parent_block_id.clone(), Some(anchor_block_id.clone()), None),
        LibraryPageInsertion::ReplaceEmptyParagraph { block_id } => {
            let unit = find_unit(parent, block_id)?;
            (
                unit.parent_block_id.clone(),
                Some(block_id.clone()),
                Some(block_id.clone()),
            )
        }
    };
    let mut operations = vec![match action {
        PlacementAction::Insert(block) => DocumentBlockOperation::InsertBlock {
            block,
            parent_block_id,
            before_block_id,
        },
        PlacementAction::Move(block_id) => DocumentBlockOperation::MoveBlock {
            block_id: block_id.to_owned(),
            parent_block_id,
            before_block_id,
        },
    }];
    if let Some(block_id) = replaced_block_id {
        operations.push(DocumentBlockOperation::DeleteBlock { block_id });
    }
    Ok(operations)
}

fn validate_insertion(
    parent: &ResolvedWriteParent,
    insertion: &LibraryPageInsertion,
) -> Result<(), StoreError> {
    match insertion {
        LibraryPageInsertion::Append { parent_block_id } => {
            if let Some(parent_block_id) = parent_block_id {
                find_unit(parent, parent_block_id)?;
            }
        }
        LibraryPageInsertion::Before {
            parent_block_id,
            anchor_block_id,
        } => {
            let anchor = find_unit(parent, anchor_block_id)?;
            if anchor.parent_block_id != *parent_block_id {
                return Err(invalid(
                    "Canvas insertion anchor is not a child of the requested parent",
                ));
            }
        }
        LibraryPageInsertion::ReplaceEmptyParagraph { block_id } => {
            let unit = find_unit(parent, block_id)?;
            let document = parent
                .document
                .as_ref()
                .ok_or_else(|| corrupt("Canvas Page placement has no Document"))?;
            let block = find_block(&document.base_materialization.block_tree, block_id)
                .ok_or_else(|| corrupt("Canvas replacement Block is not materialized"))?;
            let empty_content = matches!(
                block.content.as_ref(),
                Some(Value::Array(items)) if items.is_empty()
            );
            if unit.block_type != "paragraph"
                || !unit.text.is_empty()
                || !block.children.is_empty()
                || !empty_content
            {
                return Err(invalid(
                    "Canvas replacement target must be an empty childless paragraph",
                ));
            }
        }
    }
    Ok(())
}

fn find_unit<'a>(
    parent: &'a ResolvedWriteParent,
    block_id: &str,
) -> Result<&'a crate::document::DocumentBlockSearchUnit, StoreError> {
    parent
        .document
        .as_ref()
        .and_then(|document| {
            document
                .base_materialization
                .search_units
                .iter()
                .find(|unit| unit.block_id == block_id)
        })
        .ok_or_else(|| invalid("Canvas placement Block is unavailable in the target Page"))
}

fn find_block<'a>(
    blocks: &'a [MaterializedBlockNode],
    block_id: &str,
) -> Option<&'a MaterializedBlockNode> {
    blocks.iter().find_map(|block| {
        if block.id == block_id {
            return Some(block);
        }
        find_block(&block.children, block_id)
    })
}

fn resolved_current_location(
    connection: &Connection,
    library_id: &str,
    canvas: &CanvasAuthority,
) -> Result<ResolvedCanvasDestination, StoreError> {
    let page_id = canvas
        .containing_document_id
        .as_deref()
        .map(|document_id| {
            connection
                .query_row(
                    "SELECT block_id FROM pages \
                     WHERE document_id = ?1 AND library_id = ?2",
                    params![document_id, library_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| corrupt("Canvas host Document has no Page owner"))
        })
        .transpose()?;
    Ok(ResolvedCanvasDestination {
        parent: ResolvedWriteParent {
            parent_key: page_id
                .as_ref()
                .map_or_else(|| "library".to_owned(), |id| format!("page:{id}")),
            page_id,
            project_id: canvas.project_id.clone(),
            document: None,
            before_block_id: None,
        },
        insertion: None,
        library_before: None,
    })
}

#[allow(clippy::too_many_arguments)]
fn seal_canvas_mutation(
    scope: &DurableMutationScope<'_>,
    context: &BoundModuleContext,
    _library_id: &str,
    operation_id: &str,
    operation_kind: &'static str,
    canvas_id: &str,
    document_id: &str,
    source_canvas_id: Option<String>,
    location_revision: i64,
    metadata_revision: i64,
    resolved: &ResolvedCanvasDestination,
    document_head_seq: i64,
    document_commits: Vec<nodex_core_contracts::library::LibraryBlockTransferDocumentCommit>,
    now: String,
) -> Result<SealedOutcome<crate::ModuleWriterResult<LibraryCommitValue, LibraryReceipt>>, StoreError>
{
    let affected_document_ids = std::iter::once(document_id.to_owned())
        .chain(
            document_commits
                .iter()
                .map(|commit| commit.document_id.clone()),
        )
        .collect::<Vec<_>>();
    let canvas_mutation = LibraryCanvasMutationResult {
        operation_kind: operation_kind.to_owned(),
        canvas_id: canvas_id.to_owned(),
        document_id: document_id.to_owned(),
        source_canvas_id,
        location_revision,
        metadata_revision,
        document_commits,
    };
    seal_mutation(
        scope,
        context,
        operation_id,
        MutationEffects {
            project_id: resolved.parent.project_id.clone(),
            operation_kind,
            change_kind: "library.changed",
            did_mutate: true,
            created_target: matches!(operation_kind, "create_canvas" | "duplicate_canvas").then(
                || LibraryResourceTarget::Canvas {
                    canvas_id: canvas_id.to_owned(),
                },
            ),
            affected_parent_keys: vec![resolved.parent.parent_key.clone()],
            affected_block_ids: vec![canvas_id.to_owned()],
            affected_page_ids: resolved.parent.page_id.clone().into_iter().collect(),
            affected_database_ids: Vec::new(),
            affected_view_ids: Vec::new(),
            affected_document_ids,
            committed_revisions: BTreeMap::from([
                (format!("blockLocation:{canvas_id}"), location_revision),
                (format!("blockMetadata:{canvas_id}"), metadata_revision),
                (format!("documentHead:{document_id}"), document_head_seq),
            ]),
            page_create: None,
            page_copy: None,
            canvas_mutation: Some(canvas_mutation),
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

fn validate_display_name(value: &str) -> Result<&str, StoreError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 256 {
        return Err(invalid(
            "Canvas name must contain between 1 and 256 characters",
        ));
    }
    Ok(trimmed)
}

fn validate_uuid_v7(name: &str, value: &str) -> Result<(), StoreError> {
    let bytes = value.as_bytes();
    let valid = bytes.len() == 36
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
            .all(|(index, value)| matches!(index, 8 | 13 | 18 | 23) || value.is_ascii_hexdigit());
    if valid {
        return Ok(());
    }
    Err(invalid(&format!("{name} must be UUID-v7")))
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn conflict(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::RevisionConflict, message, true)
}

fn unauthorized(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
