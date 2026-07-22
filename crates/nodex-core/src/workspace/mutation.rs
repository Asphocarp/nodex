use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use nodex_core_contracts::workspace::{
    ProjectCatalogChangeKind, ProjectLifecycle, ProjectSessionInvalidationScope,
    ProjectWorkspaceCommitValue, ProjectWorkspaceIntent, ProjectWorkspaceReceipt,
};
use nodex_core_contracts::{
    BoundModuleContext, CommittedModuleValue, ModuleApplyRequest, ModuleMutationReceipt,
    ProjectionImpact, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use unicode_segmentation::UnicodeSegmentation;

use crate::database::create_database_authority_records;
use crate::document::{PrimaryCanvasIdentity, create_primary_canvas, read_store_epoch, sha256};
use crate::domain::identity::stable_uuid_v7;
use crate::infrastructure::event_log::{
    NewChangeLogEntry, append_change_log, load_committed_event_by_sequence,
};
use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::projection_impact::expand_database_coordinates;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::writer::StoreWriter;

use super::{
    ProjectWorkspaceApplyOutcome, execution, session_lifecycle, session_mutation, sidebar, thread,
};

const MODULE_NAME: &str = "project_workspace";
const MAX_ID_LENGTH: usize = 512;
const MAX_PROJECT_NAME_CHARS: usize = 256;
const MAX_PROJECT_DESCRIPTION_BYTES: usize = 100_000;
const MAX_PROJECT_ICON_BYTES: usize = 256;
const MAX_SOURCE_ROOTS: usize = 128;
const MAX_SOURCE_ROOT_BYTES: usize = 4_096;
const MAX_PROJECT_ORDER_SIZE: usize = 100_000;
const INITIAL_RANK_KEY: &str = "7fffffffffffffffffffffffffffffff";
const DEFAULT_SESSION_TITLE: &str = "Database View";
const DEFAULT_TAB_TITLE: &str = "DB View";

static EXTENDED_PICTOGRAPHIC: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\p{Extended_Pictographic}")
        .expect("Extended_Pictographic is a supported Unicode property")
});

struct ProjectAggregateIdentities {
    database_id: String,
    data_source_id: String,
    view_id: String,
    session_id: String,
    tab_id: String,
}

struct CreatedProjectAggregate {
    identities: ProjectAggregateIdentities,
    canvas: PrimaryCanvasIdentity,
    committed_at: String,
}

pub(super) struct WorkspaceMutationEffects {
    pub(super) operation_kind: &'static str,
    pub(super) project_catalog_change: Option<ProjectCatalogChangeKind>,
    pub(super) change_project_id: String,
    pub(super) project_ids: Vec<String>,
    pub(super) session_ids: Vec<String>,
    pub(super) thread_ids: Vec<String>,
    pub(super) session_summary_scopes: Vec<ProjectSessionInvalidationScope>,
    pub(super) session_detail_ids: Vec<String>,
    pub(super) block_ids: Vec<String>,
    pub(super) document_ids: Vec<String>,
    pub(super) database_ids: Vec<String>,
    pub(super) committed_at: String,
}

pub(super) fn project_session_scope(project_id: Option<&str>) -> ProjectSessionInvalidationScope {
    project_id.map_or(ProjectSessionInvalidationScope::Projectless, |project_id| {
        ProjectSessionInvalidationScope::Project {
            project_id: project_id.to_owned(),
        }
    })
}

struct ProjectSource {
    root: String,
    root_key: String,
}

pub(super) fn ensure_default_project(
    writer: &StoreWriter,
    profile_id: &str,
    library_id: &str,
    assets_root: &Path,
) -> Result<(), StoreError> {
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let assets_root = assets_root.to_path_buf();
    writer.call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            assert_identity(transaction, &profile_id, &library_id)?;
            let project_count = transaction.query_row(
                "SELECT count(*) FROM projects WHERE library_id = ?1",
                [&library_id],
                |row| row.get::<_, i64>(0),
            )?;
            if project_count > 0 {
                return Ok(());
            }
            create_project_records(
                transaction,
                &library_id,
                "project:default",
                "Nodex",
                "",
                "",
                &[],
                "system:bootstrap-default-project:v1",
                &assets_root,
            )?;
            Ok(())
        })
    })
}

pub(super) fn apply(
    writer: &StoreWriter,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: ModuleApplyRequest<ProjectWorkspaceIntent>,
    assets_root: &Path,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let context = context.clone();
    let assets_root = assets_root.to_path_buf();
    writer.call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            assert_identity(transaction, &profile_id, &library_id)?;
            let store_epoch = read_store_epoch(transaction)?;
            if request.store_epoch.0 != store_epoch {
                return Err(StoreError::new(
                    StoreErrorCode::StaleStoreEpoch,
                    "Project Workspace mutation targets a stale store epoch",
                    true,
                ));
            }
            validate_id("operation_id", &request.operation_id)?;
            let fingerprint = serde_json::to_vec(&(
                &context,
                request.contract_version,
                &request.store_epoch,
                &request.intent,
            ))
            .map_err(|_| internal("Project Workspace mutation cannot be fingerprinted"))?;
            let request_hash = sha256(&fingerprint);
            if let Some(stored) =
                read_module_receipt(transaction, MODULE_NAME, &request.operation_id)?
            {
                if stored.request_hash != request_hash {
                    return Err(StoreError::new(
                        StoreErrorCode::IdempotencyKeyReused,
                        "operation_id is already bound to another Project Workspace intent",
                        false,
                    ));
                }
                let mut committed = serde_json::from_value::<
                    CommittedModuleValue<ProjectWorkspaceCommitValue, ProjectWorkspaceReceipt>,
                >(stored.result)
                .map_err(|_| corrupt("Stored Project Workspace receipt is invalid"))?;
                committed.receipt.mutation.duplicate = true;
                return Ok(ProjectWorkspaceApplyOutcome {
                    committed,
                    event: None,
                });
            }

            match &request.intent {
                ProjectWorkspaceIntent::CreateProject {
                    project_id,
                    name,
                    description,
                    icon,
                    source_roots,
                } => create_project(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    project_id,
                    name,
                    description,
                    icon.as_deref().unwrap_or_default(),
                    source_roots,
                    &assets_root,
                ),
                ProjectWorkspaceIntent::UpdateProject {
                    project_id,
                    expected_binding_revision,
                    name,
                    description,
                    icon,
                    source_roots,
                } => update_project(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    project_id,
                    *expected_binding_revision,
                    name.as_deref(),
                    description.as_deref(),
                    icon.as_deref(),
                    source_roots.as_deref(),
                ),
                ProjectWorkspaceIntent::SetProjectLifecycle {
                    project_id,
                    lifecycle,
                } => set_project_lifecycle(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    project_id,
                    *lifecycle,
                ),
                ProjectWorkspaceIntent::ReorderProjects { project_ids } => reorder_projects(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    project_ids,
                ),
                ProjectWorkspaceIntent::ReorderPinnedProjects { project_ids } => {
                    reorder_pinned_projects(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        project_ids,
                    )
                }
                ProjectWorkspaceIntent::SetProjectPinned { project_id, pinned } => {
                    set_project_pinned(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        project_id,
                        *pinned,
                    )
                }
                ProjectWorkspaceIntent::CreateSession {
                    session_id,
                    project_id,
                    title,
                } => session_lifecycle::create_session(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    session_id,
                    project_id.as_deref(),
                    title,
                ),
                ProjectWorkspaceIntent::DeleteSession { session_id } => {
                    session_lifecycle::delete_session(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        session_id,
                    )
                }
                ProjectWorkspaceIntent::MoveSession {
                    session_id,
                    project_id,
                } => session_lifecycle::move_session(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    session_id,
                    project_id.as_deref(),
                ),
                ProjectWorkspaceIntent::ReorderSessions {
                    project_id,
                    session_ids,
                } => session_lifecycle::reorder_sessions(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    project_id.as_deref(),
                    session_ids,
                    false,
                ),
                ProjectWorkspaceIntent::ReorderPinnedSessions {
                    project_id,
                    session_ids,
                } => session_lifecycle::reorder_sessions(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    project_id.as_deref(),
                    session_ids,
                    true,
                ),
                ProjectWorkspaceIntent::UpsertThread { thread_id, patch } => thread::upsert_thread(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_id,
                    patch,
                ),
                ProjectWorkspaceIntent::UpdateThread { thread_id, patch } => thread::update_thread(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_id,
                    patch,
                ),
                ProjectWorkspaceIntent::DeleteThread { thread_id } => thread::delete_thread(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_id,
                ),
                ProjectWorkspaceIntent::SetThreadArchived {
                    thread_id,
                    archived,
                } => thread::set_thread_archived(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_id,
                    *archived,
                ),
                ProjectWorkspaceIntent::SetThreadPinned {
                    thread_id,
                    pinned,
                    placement,
                } => {
                    thread::set_thread_pinned(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        thread_id,
                        *pinned,
                        placement.as_ref(),
                    )
                }
                ProjectWorkspaceIntent::ReorderPinnedThreads { thread_ids } => {
                    thread::reorder_pinned_threads(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        thread_ids,
                    )
                }
                ProjectWorkspaceIntent::SetProjectThreadOrder {
                    project_id,
                    ordered_thread_ids,
                } => sidebar::set_project_thread_order(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    project_id,
                    Some(ordered_thread_ids),
                ),
                ProjectWorkspaceIntent::ClearProjectThreadOrder { project_id } => {
                    sidebar::set_project_thread_order(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        project_id,
                        None,
                    )
                }
                ProjectWorkspaceIntent::SetProjectlessThreadOrder {
                    thread_ids_in_display_order,
                    visible_thread_ids,
                    next_visible_thread_ids,
                } => sidebar::set_projectless_thread_order(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_ids_in_display_order,
                    visible_thread_ids,
                    next_visible_thread_ids,
                ),
                ProjectWorkspaceIntent::MoveThread {
                    thread_id,
                    source,
                    target,
                    placement,
                    metadata,
                } => sidebar::move_thread(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_id,
                    match source {
                        nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                            project_id,
                        } => Some(project_id.as_str()),
                        nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Projectless => {
                            None
                        }
                    },
                    match target {
                        nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                            project_id,
                        } => Some(project_id.as_str()),
                        nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Projectless => {
                            None
                        }
                    },
                    placement,
                    metadata,
                ),
                ProjectWorkspaceIntent::SetThreadUnread { thread_id, unread } => {
                    thread::set_thread_unread(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        thread_id,
                        *unread,
                    )
                }
                ProjectWorkspaceIntent::ReplaceThreadDynamicToolCatalogs {
                    thread_id,
                    catalogs,
                } => thread::replace_dynamic_tool_catalogs(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_id,
                    catalogs,
                ),
                ProjectWorkspaceIntent::MergeThreadWritableRoots { thread_id, roots } => {
                    execution::mutate_writable_roots(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        thread_id,
                        roots,
                        true,
                    )
                }
                ProjectWorkspaceIntent::ReplaceThreadWritableRoots { thread_id, roots } => {
                    execution::mutate_writable_roots(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        thread_id,
                        roots,
                        false,
                    )
                }
                ProjectWorkspaceIntent::FreezeTurnAuthority {
                    thread_id,
                    turn_id,
                    root_thread_id,
                    actor_project_id,
                    source,
                    inherited_from,
                } => execution::freeze_turn_authority(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    thread_id,
                    turn_id,
                    root_thread_id,
                    actor_project_id,
                    *source,
                    inherited_from.as_ref().map(|coordinate| {
                        (coordinate.thread_id.as_str(), coordinate.turn_id.as_str())
                    }),
                ),
                ProjectWorkspaceIntent::UpsertBackgroundProcess {
                    process,
                    preserve_started_at,
                } => execution::upsert_background_process(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    process,
                    preserve_started_at.unwrap_or(true),
                ),
                ProjectWorkspaceIntent::SetProjectPermissionMode { project_id, mode } => {
                    thread::set_project_permission_mode(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        project_id,
                        *mode,
                    )
                }
                ProjectWorkspaceIntent::MutateSession { session_id, intent } => {
                    session_mutation::mutate_session(
                        transaction,
                        &library_id,
                        &context,
                        &store_epoch,
                        &request.operation_id,
                        &request_hash,
                        session_id,
                        intent,
                    )
                }
            }
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn create_project(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_id: &str,
    name: &str,
    description: &str,
    icon: &str,
    source_roots: &[String],
    assets_root: &Path,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_project_input(project_id, description)?;
    let sources = normalize_source_roots(source_roots)?;
    let name = normalize_project_name(name, &sources)?;
    let icon = normalize_icon(icon)?;
    let created = create_project_records(
        connection,
        library_id,
        project_id,
        &name,
        description,
        &icon,
        &sources,
        operation_id,
        assets_root,
    )?;
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        WorkspaceMutationEffects {
            operation_kind: "create_project",
            project_catalog_change: Some(ProjectCatalogChangeKind::Created),
            change_project_id: project_id.to_owned(),
            project_ids: vec![project_id.to_owned()],
            session_ids: vec![created.identities.session_id.clone()],
            thread_ids: Vec::new(),
            session_summary_scopes: vec![ProjectSessionInvalidationScope::Project {
                project_id: project_id.to_owned(),
            }],
            session_detail_ids: vec![created.identities.session_id],
            block_ids: vec![
                created.identities.database_id.clone(),
                created.canvas.block_id,
            ],
            document_ids: vec![created.canvas.document_id],
            database_ids: vec![created.identities.database_id],
            committed_at: created.committed_at,
        },
    )
}

pub(super) fn finish_mutation(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    effects: WorkspaceMutationEffects,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let payload = json!({
        "module": MODULE_NAME,
        "operationKind": effects.operation_kind,
        "kind": "workspace_changed",
        "projectCatalogChange": effects.project_catalog_change,
        "projectIds": effects.project_ids,
        "sessionIds": effects.session_ids,
        "threadIds": effects.thread_ids,
        "sessionSummaryScopes": effects.session_summary_scopes,
        "sessionDetailIds": effects.session_detail_ids,
    });
    let projection_impact = expand_database_coordinates(
        connection,
        ProjectionImpact::Resources {
            page_ids: Vec::new(),
            database_ids: effects.database_ids.clone(),
            data_source_ids: Vec::new(),
            view_ids: Vec::new(),
            document_heads: Vec::new(),
        },
    )?;
    let payload_json =
        serde_json::to_string(&payload).map_err(|_| internal("Project Workspace event payload"))?;
    let event_sequence = append_change_log(
        connection,
        NewChangeLogEntry {
            project_id: &effects.change_project_id,
            store_epoch,
            kind: "project_workspace.changed",
            operation_id: Some(operation_id),
            block_ids: &effects.block_ids,
            document_ids: &effects.document_ids,
            database_block_ids: &effects.database_ids,
            payload_json: &payload_json,
            projection_impact: &projection_impact,
            committed_at: &effects.committed_at,
        },
    )?;
    let committed = CommittedModuleValue {
        value: ProjectWorkspaceCommitValue {
            affected_project_ids: effects.project_ids.clone(),
            affected_session_ids: effects.session_ids.clone(),
            affected_thread_ids: effects.thread_ids.clone(),
        },
        receipt: ProjectWorkspaceReceipt {
            mutation: ModuleMutationReceipt {
                operation_id: operation_id.to_owned(),
                duplicate: false,
            },
            affected_project_ids: effects.project_ids.clone(),
            affected_session_ids: effects.session_ids.clone(),
        },
        event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
    };
    let result = serde_json::to_value(&committed)
        .map_err(|_| internal("Project Workspace receipt result"))?;
    insert_module_receipt(
        connection,
        NewModuleReceipt {
            module_name: MODULE_NAME,
            operation_id,
            context,
            operation_kind: effects.operation_kind,
            store_epoch,
            request_hash,
            result: &result,
            event_sequence: Some(event_sequence),
            committed_at: &effects.committed_at,
        },
    )?;
    let event = load_committed_event_by_sequence(connection, event_sequence)?;
    Ok(ProjectWorkspaceApplyOutcome {
        committed,
        event: Some(event),
    })
}

#[allow(clippy::too_many_arguments)]
fn update_project(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_id: &str,
    expected_binding_revision: i64,
    name: Option<&str>,
    description: Option<&str>,
    icon: Option<&str>,
    source_roots: Option<&[String]>,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("project_id", project_id)?;
    if expected_binding_revision < 1 {
        return Err(invalid("expected_binding_revision must be positive"));
    }
    let (_, binding_revision) = require_project(connection, library_id, project_id)?;
    if binding_revision != expected_binding_revision {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Project binding revision changed",
            true,
        ));
    }
    let name = name
        .map(|value| normalize_project_name(value, &[]))
        .transpose()?;
    if let Some(value) = description {
        validate_description(value)?;
    }
    let icon = icon.map(normalize_icon).transpose()?;
    let sources = source_roots.map(normalize_source_roots).transpose()?;
    let now = sqlite_now(connection)?;
    let metadata_changed = name.is_some() || description.is_some() || icon.is_some();
    if metadata_changed {
        let changed = connection.execute(
            "UPDATE projects SET \
               name = COALESCE(?1, name), description = COALESCE(?2, description), \
               icon = COALESCE(?3, icon), updated = ?4 \
             WHERE id = ?5 AND library_id = ?6 AND binding_revision = ?7",
            params![
                name.as_deref(),
                description,
                icon.as_deref(),
                now,
                project_id,
                library_id,
                expected_binding_revision,
            ],
        )?;
        if changed != 1 {
            return Err(corrupt("Project disappeared during metadata update"));
        }
    }
    if let Some(sources) = &sources {
        connection.execute(
            "DELETE FROM project_sources WHERE project_id = ?1",
            [project_id],
        )?;
        insert_project_sources(connection, project_id, sources, &now)?;
        if !metadata_changed {
            let changed = connection.execute(
                "UPDATE projects SET updated = ?1 \
                 WHERE id = ?2 AND library_id = ?3 AND binding_revision = ?4",
                params![now, project_id, library_id, expected_binding_revision],
            )?;
            if changed != 1 {
                return Err(corrupt("Project disappeared during source update"));
            }
        }
    }
    finish_project_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "update_project",
        if sources.is_some() {
            ProjectCatalogChangeKind::SourcesUpdated
        } else {
            ProjectCatalogChangeKind::MetadataUpdated
        },
        project_id,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn set_project_lifecycle(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_id: &str,
    lifecycle: ProjectLifecycle,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("project_id", project_id)?;
    let (current_lifecycle, _) = require_project(connection, library_id, project_id)?;
    let next_lifecycle = lifecycle_literal(lifecycle);
    let now = sqlite_now(connection)?;
    if current_lifecycle != next_lifecycle {
        let changed = connection.execute(
            "UPDATE projects SET lifecycle = ?1, binding_revision = binding_revision + 1, \
               updated = ?2 WHERE id = ?3 AND library_id = ?4 AND lifecycle = ?5",
            params![
                next_lifecycle,
                now,
                project_id,
                library_id,
                current_lifecycle
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Project lifecycle changed",
                true,
            ));
        }
        if next_lifecycle == "archived" {
            connection.execute(
                "DELETE FROM pinned_project_order WHERE project_id = ?1",
                [project_id],
            )?;
            connection.execute(
                "DELETE FROM project_order WHERE project_id = ?1",
                [project_id],
            )?;
        } else if current_lifecycle == "archived" {
            connection.execute(
                "INSERT INTO project_order(project_id, \"order\", updated) \
                 SELECT ?1, COALESCE(MAX(ordering.\"order\"), -1) + 1, ?2 \
                 FROM project_order ordering \
                 JOIN projects project ON project.id = ordering.project_id \
                 WHERE project.library_id = ?3",
                params![project_id, now, library_id],
            )?;
        }
    }
    finish_project_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "set_project_lifecycle",
        ProjectCatalogChangeKind::LifecycleUpdated,
        project_id,
        now,
    )
}

fn reorder_projects(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_ids: &[String],
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    if project_ids.len() > MAX_PROJECT_ORDER_SIZE {
        return Err(invalid("Project order exceeds its bound"));
    }
    for project_id in project_ids {
        validate_id("project_id", project_id)?;
    }
    let requested = project_ids.iter().cloned().collect::<BTreeSet<_>>();
    if requested.len() != project_ids.len() {
        return Err(invalid("Project order contains duplicate identities"));
    }
    let current = connection
        .prepare(
            "SELECT project.id FROM projects project \
             LEFT JOIN project_order ordering ON ordering.project_id = project.id \
             WHERE project.library_id = ?1 AND project.lifecycle <> 'archived' \
             ORDER BY COALESCE(ordering.\"order\", 9223372036854775807), \
               project.created, project.id",
        )?
        .query_map([library_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if requested != current.iter().cloned().collect::<BTreeSet<_>>() {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Project order must contain exactly the current sidebar Projects",
            true,
        ));
    }
    let now = sqlite_now(connection)?;
    for (order, project_id) in project_ids.iter().enumerate() {
        connection.execute(
            "INSERT INTO project_order(project_id, \"order\", updated) VALUES (?1, ?2, ?3) \
             ON CONFLICT(project_id) DO UPDATE SET \
               \"order\" = excluded.\"order\", updated = excluded.updated",
            params![
                project_id,
                i64::try_from(order).map_err(|_| internal("Project order"))?,
                now
            ],
        )?;
    }
    let change_project_id = project_ids
        .first()
        .cloned()
        .map_or_else(|| workspace_event_anchor(connection, library_id), Ok)?;
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        WorkspaceMutationEffects {
            operation_kind: "reorder_projects",
            project_catalog_change: Some(ProjectCatalogChangeKind::Reordered),
            change_project_id,
            project_ids: project_ids.to_vec(),
            session_ids: Vec::new(),
            thread_ids: Vec::new(),
            session_summary_scopes: Vec::new(),
            session_detail_ids: Vec::new(),
            block_ids: Vec::new(),
            document_ids: Vec::new(),
            database_ids: Vec::new(),
            committed_at: now,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn set_project_pinned(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_id: &str,
    pinned: bool,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("project_id", project_id)?;
    require_project(connection, library_id, project_id)?;
    let now = sqlite_now(connection)?;
    if pinned {
        connection.execute(
            "INSERT INTO pinned_project_order(project_id, \"order\", updated) \
             SELECT ?1, COALESCE(MAX(pinned.\"order\"), -1) + 1, ?2 \
             FROM projects project \
             LEFT JOIN pinned_project_order pinned ON pinned.project_id = project.id \
             WHERE project.library_id = ?3 \
             ON CONFLICT(project_id) DO NOTHING",
            params![project_id, now, library_id],
        )?;
    } else {
        connection.execute(
            "DELETE FROM pinned_project_order WHERE project_id = ?1",
            [project_id],
        )?;
    }
    finish_project_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "set_project_pinned",
        ProjectCatalogChangeKind::PinUpdated,
        project_id,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn reorder_pinned_projects(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_ids: &[String],
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    if project_ids.len() > MAX_PROJECT_ORDER_SIZE {
        return Err(invalid("Pinned Project order exceeds its bound"));
    }
    for project_id in project_ids {
        validate_id("project_id", project_id)?;
    }
    let requested = project_ids.iter().cloned().collect::<BTreeSet<_>>();
    if requested.len() != project_ids.len() {
        return Err(invalid(
            "Pinned Project order contains duplicate identities",
        ));
    }
    let current = connection
        .prepare(
            "SELECT project.id FROM pinned_project_order pinned \
             JOIN projects project ON project.id = pinned.project_id \
             WHERE project.library_id = ?1 AND project.lifecycle <> 'archived' \
             ORDER BY pinned.\"order\", project.created, project.id",
        )?
        .query_map([library_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if requested != current.iter().cloned().collect::<BTreeSet<_>>() {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Pinned Project order must contain exactly the current pinned Projects",
            true,
        ));
    }
    let now = sqlite_now(connection)?;
    for (order, project_id) in project_ids.iter().enumerate() {
        let changed = connection.execute(
            "UPDATE pinned_project_order SET \"order\" = ?1, updated = ?2 \
             WHERE project_id = ?3",
            params![
                i64::try_from(order).map_err(|_| internal("Pinned Project order"))?,
                now,
                project_id,
            ],
        )?;
        if changed != 1 {
            return Err(corrupt("Pinned Project order changed during mutation"));
        }
    }
    let change_project_id = project_ids
        .first()
        .cloned()
        .map_or_else(|| workspace_event_anchor(connection, library_id), Ok)?;
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        WorkspaceMutationEffects {
            operation_kind: "reorder_pinned_projects",
            project_catalog_change: Some(ProjectCatalogChangeKind::PinUpdated),
            change_project_id,
            project_ids: project_ids.to_vec(),
            session_ids: Vec::new(),
            thread_ids: Vec::new(),
            session_summary_scopes: Vec::new(),
            session_detail_ids: Vec::new(),
            block_ids: Vec::new(),
            document_ids: Vec::new(),
            database_ids: Vec::new(),
            committed_at: now,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_project_mutation(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    operation_kind: &'static str,
    project_catalog_change: ProjectCatalogChangeKind,
    project_id: &str,
    committed_at: String,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        WorkspaceMutationEffects {
            operation_kind,
            project_catalog_change: Some(project_catalog_change),
            change_project_id: project_id.to_owned(),
            project_ids: vec![project_id.to_owned()],
            session_ids: Vec::new(),
            thread_ids: Vec::new(),
            session_summary_scopes: Vec::new(),
            session_detail_ids: Vec::new(),
            block_ids: Vec::new(),
            document_ids: Vec::new(),
            database_ids: Vec::new(),
            committed_at,
        },
    )
}

fn require_project(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
) -> Result<(String, i64), StoreError> {
    connection
        .query_row(
            "SELECT lifecycle, binding_revision FROM projects \
             WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| not_found("Project is unavailable in this Library"))
}

pub(super) fn workspace_event_anchor(
    connection: &Connection,
    library_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT id FROM projects WHERE library_id = ?1 ORDER BY created, id LIMIT 1",
            [library_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Project Workspace has no event anchor Project"))
}

fn lifecycle_literal(lifecycle: ProjectLifecycle) -> &'static str {
    match lifecycle {
        ProjectLifecycle::Active => "active",
        ProjectLifecycle::Inactive => "inactive",
        ProjectLifecycle::Archived => "archived",
    }
}

#[allow(clippy::too_many_arguments)]
fn create_project_records(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    name: &str,
    description: &str,
    icon: &str,
    sources: &[ProjectSource],
    identity_namespace: &str,
    assets_root: &Path,
) -> Result<CreatedProjectAggregate, StoreError> {
    let identities = aggregate_identities(identity_namespace, project_id);
    let canvas_block_id = format!("canvas:primary:{project_id}");
    let canvas_document_id = format!("document:canvas:primary:{project_id}");
    let collision = connection
        .query_row(
            "SELECT 1 WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?1) \
             OR EXISTS (SELECT 1 FROM blocks WHERE id IN (?2, ?3)) \
             OR EXISTS (SELECT 1 FROM documents WHERE id = ?4) \
             OR EXISTS (SELECT 1 FROM data_sources WHERE id = ?5) \
             OR EXISTS (SELECT 1 FROM database_views WHERE id = ?6) \
             OR EXISTS (SELECT 1 FROM project_sessions WHERE id = ?7) \
             OR EXISTS (SELECT 1 FROM project_session_tabs WHERE id = ?8)",
            params![
                project_id,
                identities.database_id,
                canvas_block_id,
                canvas_document_id,
                identities.data_source_id,
                identities.view_id,
                identities.session_id,
                identities.tab_id,
            ],
            |_| Ok(()),
        )
        .optional()?;
    if collision.is_some() {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Project aggregate identity already exists",
            false,
        ));
    }
    let now = sqlite_now(connection)?;
    connection.execute("UPDATE project_order SET \"order\" = \"order\" + 1", [])?;
    connection.execute(
        "INSERT INTO projects(\
           id, library_id, database_block_id, lifecycle, binding_revision, name, description, \
           icon, created, updated\
         ) VALUES (?1, ?2, ?3, 'active', 1, ?4, ?5, ?6, ?7, ?7)",
        params![
            project_id,
            library_id,
            identities.database_id,
            name,
            description,
            icon,
            now
        ],
    )?;
    connection.execute(
        "INSERT INTO project_order(project_id, \"order\", updated) VALUES (?1, 0, ?2)",
        params![project_id, now],
    )?;
    insert_project_sources(connection, project_id, sources, &now)?;
    connection.execute(
        "INSERT INTO blocks(\
           id, project_id, type, lifecycle, location_kind, containing_document_id, \
           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, 'database', 'active', 'space', NULL, NULL, 1, 1, ?3, ?3)",
        params![identities.database_id, project_id, now],
    )?;
    connection.execute(
        "INSERT INTO top_level_block_placements(\
           block_id, project_id, rank_key, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![identities.database_id, project_id, INITIAL_RANK_KEY, now],
    )?;
    connection.execute(
        "INSERT INTO library_block_placements(\
           block_id, library_id, rank_key, revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        params![identities.database_id, library_id, INITIAL_RANK_KEY, now],
    )?;
    create_database_authority_records(
        connection,
        library_id,
        &identities.database_id,
        &identities.data_source_id,
        &identities.view_id,
        "Cards",
        &now,
    )?;
    connection.execute(
        "INSERT INTO project_database_bindings(\
           project_id, library_id, database_block_id, lifecycle, revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 'active', 1, ?4, ?4)",
        params![project_id, library_id, identities.database_id, now],
    )?;
    insert_initial_session(connection, project_id, &identities, &now)?;
    let canvas = create_primary_canvas(connection, project_id, &now, assets_root)?;
    Ok(CreatedProjectAggregate {
        identities,
        canvas,
        committed_at: now,
    })
}

fn insert_project_sources(
    connection: &Connection,
    project_id: &str,
    sources: &[ProjectSource],
    now: &str,
) -> Result<(), StoreError> {
    for (order, source) in sources.iter().enumerate() {
        connection.execute(
            "INSERT INTO project_sources(\
               project_id, root, root_key, \"order\", created, updated\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                project_id,
                source.root,
                source.root_key,
                i64::try_from(order).map_err(|_| internal("Project source order"))?,
                now,
            ],
        )?;
    }
    Ok(())
}

fn insert_initial_session(
    connection: &Connection,
    project_id: &str,
    identities: &ProjectAggregateIdentities,
    now: &str,
) -> Result<(), StoreError> {
    let panels = initial_panels(&identities.tab_id);
    connection.execute(
        "INSERT INTO project_sessions(\
           id, project_id, no_thread_fallback_title, \"order\", pinned, pinned_order, archived, \
           archived_at, unread, left_pane_collapsed, panel_state_json, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 0, 1, 0, 0, NULL, 0, 1, ?4, ?5, ?5)",
        params![
            identities.session_id,
            project_id,
            DEFAULT_SESSION_TITLE,
            serde_json::to_string(&panels).map_err(|_| internal("Initial Session panels"))?,
            now
        ],
    )?;
    connection.execute(
        "INSERT INTO project_session_tabs(\
           id, session_id, project_id, panel_id, kind, title, config_json, state_key, \
           state_json, \"order\", created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 'right', 'db_view', ?4, ?5, 0, '{}', 0, ?6, ?6)",
        params![
            identities.tab_id,
            identities.session_id,
            project_id,
            DEFAULT_TAB_TITLE,
            serde_json::to_string(&json!({
                "projectId": project_id,
                "databaseViewId": identities.view_id,
                "view": "kanban",
            }))
            .map_err(|_| internal("Initial Session tab config"))?,
            now
        ],
    )?;
    Ok(())
}

fn initial_panels(tab_id: &str) -> serde_json::Value {
    json!({
        "right": {
            "collapsed": false,
            "layout": panel_layout(&[tab_id], Some(tab_id)),
            "size": { "widthPx": 600, "fullWidth": true }
        },
        "bottom": {
            "collapsed": true,
            "layout": panel_layout(&[], None),
            "size": { "heightPx": 280 }
        }
    })
}

fn panel_layout(tab_ids: &[&str], active_tab_id: Option<&str>) -> serde_json::Value {
    json!({
        "version": 2,
        "root": {
            "type": "leaf",
            "id": "main",
            "tabIds": tab_ids,
            "activeTabId": active_tab_id,
            "mruTabIds": tab_ids,
        },
        "activeLeafId": "main",
        "mruLeafIds": ["main"],
        "maximizedLeafId": null,
    })
}

fn aggregate_identities(namespace: &str, project_id: &str) -> ProjectAggregateIdentities {
    ProjectAggregateIdentities {
        database_id: stable_uuid_v7(namespace, "database", project_id),
        data_source_id: stable_uuid_v7(namespace, "data_source", project_id),
        view_id: stable_uuid_v7(namespace, "view", project_id),
        session_id: stable_uuid_v7(namespace, "session", project_id),
        tab_id: stable_uuid_v7(namespace, "tab", project_id),
    }
}

fn validate_project_input(project_id: &str, description: &str) -> Result<(), StoreError> {
    validate_id("project_id", project_id)?;
    validate_description(description)
}

fn validate_description(description: &str) -> Result<(), StoreError> {
    if description.len() > MAX_PROJECT_DESCRIPTION_BYTES {
        return Err(invalid("Project description exceeds its bound"));
    }
    Ok(())
}

fn normalize_icon(icon: &str) -> Result<String, StoreError> {
    let icon = icon.trim();
    if icon.len() > MAX_PROJECT_ICON_BYTES || icon.chars().any(char::is_control) {
        return Err(invalid("Project icon is invalid"));
    }
    Ok(icon
        .graphemes(true)
        .find(|grapheme| EXTENDED_PICTOGRAPHIC.is_match(grapheme))
        .unwrap_or_default()
        .to_owned())
}

fn normalize_project_name(name: &str, sources: &[ProjectSource]) -> Result<String, StoreError> {
    let explicit = name.trim();
    let value = if !explicit.is_empty() {
        explicit.to_owned()
    } else {
        sources
            .first()
            .and_then(|source| Path::new(&source.root).file_name())
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("New project")
            .to_owned()
    };
    if value.chars().count() > MAX_PROJECT_NAME_CHARS || value.chars().any(char::is_control) {
        return Err(invalid("Project name is invalid"));
    }
    Ok(value)
}

fn normalize_source_roots(values: &[String]) -> Result<Vec<ProjectSource>, StoreError> {
    if values.len() > MAX_SOURCE_ROOTS {
        return Err(invalid("Project source roots exceed their bound"));
    }
    let mut seen = BTreeSet::new();
    let mut sources = Vec::new();
    for value in values {
        let root = value.trim();
        if root.is_empty() {
            continue;
        }
        if root.len() > MAX_SOURCE_ROOT_BYTES
            || root.chars().any(char::is_control)
            || !PathBuf::from(root).is_absolute()
        {
            return Err(invalid(
                "Project source root must be a bounded absolute path",
            ));
        }
        let root_key = root.to_owned();
        if !seen.insert(root_key.clone()) {
            continue;
        }
        sources.push(ProjectSource {
            root: root.to_owned(),
            root_key,
        });
    }
    Ok(sources)
}

fn assert_identity(
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
        .optional()?;
    if valid.is_some() {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::Unauthorized,
        "bound Project Workspace identity is not present in this Profile store",
        false,
    ))
}

fn validate_id(name: &str, value: &str) -> Result<(), StoreError> {
    if !value.is_empty()
        && value == value.trim()
        && value.len() <= MAX_ID_LENGTH
        && !value.chars().any(char::is_control)
    {
        return Ok(());
    }
    Err(invalid(&format!(
        "{name} must be a canonical identity of at most {MAX_ID_LENGTH} bytes"
    )))
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(Into::into)
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use nodex_core_contracts::workspace::{
        CodexThreadActiveFlag, CodexThreadStatusType, ProjectCatalogChangeKind, ProjectLifecycle,
        ProjectSessionDatabaseView, ProjectSessionIntent, ProjectSessionInvalidationScope,
        ProjectSessionPanelId, ProjectSessionPanelSizePatch, ProjectSessionPanelStatePatch,
        ProjectSessionTabContent, ProjectWorkspaceIntent, ProjectWorkspaceRead,
        ProjectWorkspaceReadValue, ProjectWorkspaceThreadPatch, ProjectWorkspaceThreadStatus,
    };
    use nodex_core_contracts::{
        AdapterKind, BoundModuleContext, CoreErrorCode, CoreModuleEventPayload, LibraryId,
        ModuleApplyRequest, ModuleReadRequest, PROJECT_WORKSPACE_CONTRACT_VERSION, ProfileId,
        ProjectId, ProjectionImpact, StoreEpoch,
    };
    use serde_json::json;
    use tempfile::{TempDir, tempdir};

    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::infrastructure::store::SqliteStoreKernel;
    use crate::workspace::ProjectWorkspaceModule;

    const NOW: &str = "2026-07-19T04:00:00.000Z";

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project:default".to_owned())),
            connection_id: "connection:workspace-mutation".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn seeded_module() -> (TempDir, SqliteStoreKernel, ProjectWorkspaceModule) {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        fs::create_dir(home.join("assets")).expect("assets root");
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
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, 'epoch-1', ?1, ?1)",
                        [NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed Workspace identity");
        let module = ProjectWorkspaceModule::new("profile-1", "library-1", &kernel)
            .expect("Workspace module");
        (directory, kernel, module)
    }

    fn create_request(
        operation_id: &str,
        project_id: &str,
    ) -> ModuleApplyRequest<ProjectWorkspaceIntent> {
        request(
            operation_id,
            ProjectWorkspaceIntent::CreateProject {
                project_id: project_id.to_owned(),
                name: "  Native project  ".to_owned(),
                description: "Workspace aggregate".to_owned(),
                icon: Some("🚀".to_owned()),
                source_roots: vec![
                    "/workspace/native".to_owned(),
                    "/workspace/native".to_owned(),
                    "/workspace/secondary".to_owned(),
                ],
            },
        )
    }

    fn request(
        operation_id: &str,
        intent: ProjectWorkspaceIntent,
    ) -> ModuleApplyRequest<ProjectWorkspaceIntent> {
        ModuleApplyRequest {
            contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent,
        }
    }

    fn session_request(
        operation_id: &str,
        session_id: &str,
        intent: ProjectSessionIntent,
    ) -> ModuleApplyRequest<ProjectWorkspaceIntent> {
        request(
            operation_id,
            ProjectWorkspaceIntent::MutateSession {
                session_id: session_id.to_owned(),
                intent,
            },
        )
    }

    #[test]
    fn bootstraps_and_creates_complete_project_aggregates_with_exact_replay() {
        let (_directory, kernel, module) = seeded_module();
        let bootstrap = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT project.database_block_id, binding.database_block_id, \
                            (SELECT count(*) FROM project_sessions \
                             WHERE project_id = 'project:default'), \
                            (SELECT count(*) FROM canvas_scenes scene \
                             JOIN documents document ON document.id = scene.document_id \
                             WHERE document.project_id = 'project:default') \
                     FROM projects project JOIN project_database_bindings binding \
                       ON binding.project_id = project.id \
                     WHERE project.id = 'project:default'",
                        [],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, i64>(3)?,
                            ))
                        },
                    )
                    .map_err(Into::into)
            })
            .expect("read bootstrap aggregate");
        assert_eq!(bootstrap.0, bootstrap.1);
        assert_eq!(bootstrap.2, 1);
        assert_eq!(bootstrap.3, 1);

        let request = create_request("workspace-create-1", "project-native");
        let outcome = module
            .apply(&context(), request.clone())
            .expect("create Project aggregate");
        assert_eq!(
            outcome.committed.value.affected_project_ids,
            vec!["project-native"]
        );
        assert_eq!(outcome.committed.value.affected_session_ids.len(), 1);
        assert!(outcome.committed.value.affected_thread_ids.is_empty());
        assert!(!outcome.committed.receipt.mutation.duplicate);
        let Some(event) = outcome.event.as_ref() else {
            panic!("Project creation must publish a Workspace event");
        };
        let CoreModuleEventPayload::ProjectWorkspace(event) = &event.payload else {
            panic!("Project creation must publish a Project Workspace event");
        };
        assert_eq!(
            event.project_catalog_change,
            Some(ProjectCatalogChangeKind::Created)
        );
        let ProjectionImpact::Resources {
            database_ids,
            data_source_ids,
            view_ids,
            ..
        } = &outcome
            .event
            .as_ref()
            .expect("Workspace event")
            .projection_impact
        else {
            panic!("Project creation must invalidate its Database projection");
        };
        assert_eq!(database_ids.len(), 1);
        assert_eq!(data_source_ids.len(), 1);
        assert_eq!(view_ids.len(), 1);

        let replay = module.apply(&context(), request).expect("exact replay");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            replay.committed.event_sequence,
            outcome.committed.event_sequence
        );
        assert!(replay.event.is_none());

        let stored = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT project.name, project.description, project.icon, \
                            project.database_block_id, binding.database_block_id, \
                            (SELECT count(*) FROM project_sources \
                             WHERE project_id = project.id), \
                            (SELECT count(*) FROM data_source_properties property \
                             JOIN data_sources source ON source.id = property.data_source_id \
                             WHERE source.home_database_block_id = project.database_block_id), \
                            (SELECT count(*) FROM project_sessions session \
                             JOIN project_session_tabs tab ON tab.session_id = session.id \
                             WHERE session.project_id = project.id \
                               AND tab.kind = 'db_view'), \
                            (SELECT count(*) FROM canvas_scenes scene \
                             JOIN documents document ON document.id = scene.document_id \
                             WHERE document.project_id = project.id), \
                            (SELECT count(*) FROM change_log \
                             WHERE kind = 'project_workspace.changed' \
                               AND operation_id = 'workspace-create-1'), \
                            (SELECT count(*) FROM core_module_receipts \
                             WHERE module_name = 'project_workspace' \
                               AND operation_id = 'workspace-create-1') \
                     FROM projects project JOIN project_database_bindings binding \
                       ON binding.project_id = project.id \
                     WHERE project.id = 'project-native'",
                        [],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, String>(4)?,
                                row.get::<_, i64>(5)?,
                                row.get::<_, i64>(6)?,
                                row.get::<_, i64>(7)?,
                                row.get::<_, i64>(8)?,
                                row.get::<_, i64>(9)?,
                                row.get::<_, i64>(10)?,
                            ))
                        },
                    )
                    .map_err(Into::into)
            })
            .expect("read created aggregate");
        assert_eq!(stored.0, "Native project");
        assert_eq!(stored.1, "Workspace aggregate");
        assert_eq!(stored.2, "🚀");
        assert_eq!(stored.3, stored.4);
        assert_eq!(stored.5, 2);
        assert_eq!(stored.6, 8);
        assert_eq!(stored.7, 1);
        assert_eq!(stored.8, 1);
        assert_eq!(stored.9, 1);
        assert_eq!(stored.10, 1);

        let divergent = module
            .apply(
                &context(),
                create_request("workspace-create-1", "project-divergent"),
            )
            .expect_err("reject divergent replay");
        assert_eq!(divergent.code, CoreErrorCode::IdempotencyKeyReused);
    }

    #[test]
    fn updates_lifecycle_order_and_pinning_with_revision_guards_and_exact_replay() {
        let (_directory, kernel, module) = seeded_module();
        module
            .apply(
                &context(),
                create_request("workspace-create-native", "project-native"),
            )
            .expect("create native Project");
        module
            .apply(
                &context(),
                create_request("workspace-create-secondary", "project-secondary"),
            )
            .expect("create secondary Project");

        let update = request(
            "workspace-update-native",
            ProjectWorkspaceIntent::UpdateProject {
                project_id: "project-native".to_owned(),
                expected_binding_revision: 1,
                name: Some("  Renamed Project  ".to_owned()),
                description: Some("Updated metadata".to_owned()),
                icon: Some("  Build 🧭 workspace  ".to_owned()),
                source_roots: Some(vec![
                    "/workspace/updated".to_owned(),
                    "/workspace/updated".to_owned(),
                ]),
            },
        );
        let updated = module
            .apply(&context(), update.clone())
            .expect("update Project");
        assert_eq!(
            updated.committed.value.affected_project_ids,
            ["project-native"]
        );
        let replay = module
            .apply(&context(), update)
            .expect("replay Project update");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            replay.committed.event_sequence,
            updated.committed.event_sequence
        );

        let stale = module
            .apply(
                &context(),
                request(
                    "workspace-update-stale",
                    ProjectWorkspaceIntent::UpdateProject {
                        project_id: "project-native".to_owned(),
                        expected_binding_revision: 2,
                        name: Some("Stale".to_owned()),
                        description: None,
                        icon: None,
                        source_roots: None,
                    },
                ),
            )
            .expect_err("reject stale Project binding revision");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);

        module
            .apply(
                &context(),
                request(
                    "workspace-pin-native",
                    ProjectWorkspaceIntent::SetProjectPinned {
                        project_id: "project-native".to_owned(),
                        pinned: true,
                    },
                ),
            )
            .expect("pin Project");
        module
            .apply(
                &context(),
                request(
                    "workspace-pin-secondary",
                    ProjectWorkspaceIntent::SetProjectPinned {
                        project_id: "project-secondary".to_owned(),
                        pinned: true,
                    },
                ),
            )
            .expect("pin secondary Project");
        module
            .apply(
                &context(),
                request(
                    "workspace-reorder-pinned",
                    ProjectWorkspaceIntent::ReorderPinnedProjects {
                        project_ids: vec![
                            "project-secondary".to_owned(),
                            "project-native".to_owned(),
                        ],
                    },
                ),
            )
            .expect("reorder pinned Projects");
        let pinned_projects = kernel
            .writer()
            .call(|connection| {
                Ok(connection
                    .prepare("SELECT project_id FROM pinned_project_order ORDER BY \"order\"")?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?)
            })
            .expect("read pinned Project order");
        assert_eq!(pinned_projects, ["project-secondary", "project-native"]);
        module
            .apply(
                &context(),
                request(
                    "workspace-reorder",
                    ProjectWorkspaceIntent::ReorderProjects {
                        project_ids: vec![
                            "project-native".to_owned(),
                            "project:default".to_owned(),
                            "project-secondary".to_owned(),
                        ],
                    },
                ),
            )
            .expect("reorder Projects");
        module
            .apply(
                &context(),
                request(
                    "workspace-inactivate-native",
                    ProjectWorkspaceIntent::SetProjectLifecycle {
                        project_id: "project-native".to_owned(),
                        lifecycle: ProjectLifecycle::Inactive,
                    },
                ),
            )
            .expect("inactivate Project");
        module
            .apply(
                &context(),
                request(
                    "workspace-archive-native",
                    ProjectWorkspaceIntent::SetProjectLifecycle {
                        project_id: "project-native".to_owned(),
                        lifecycle: ProjectLifecycle::Archived,
                    },
                ),
            )
            .expect("archive Project");

        let stored = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT project.name, project.description, project.icon, \
                            project.lifecycle, project.binding_revision, \
                            binding.lifecycle, binding.revision, \
                            (SELECT group_concat(root, '|') FROM project_sources \
                             WHERE project_id = project.id ORDER BY \"order\"), \
                            (SELECT count(*) FROM project_order \
                             WHERE project_id = project.id), \
                            (SELECT count(*) FROM pinned_project_order \
                             WHERE project_id = project.id), \
                            (SELECT count(*) FROM core_module_receipts \
                             WHERE operation_id = 'workspace-update-stale'), \
                            (SELECT count(*) FROM change_log \
                             WHERE operation_id = 'workspace-update-stale') \
                     FROM projects project JOIN project_database_bindings binding \
                       ON binding.project_id = project.id \
                     WHERE project.id = 'project-native'",
                        [],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, i64>(4)?,
                                row.get::<_, String>(5)?,
                                row.get::<_, i64>(6)?,
                                row.get::<_, String>(7)?,
                                row.get::<_, i64>(8)?,
                                row.get::<_, i64>(9)?,
                                row.get::<_, i64>(10)?,
                                row.get::<_, i64>(11)?,
                            ))
                        },
                    )
                    .map_err(Into::into)
            })
            .expect("read mutated Project");
        assert_eq!(stored.0, "Renamed Project");
        assert_eq!(stored.1, "Updated metadata");
        assert_eq!(stored.2, "🧭");
        assert_eq!(stored.3, "archived");
        assert_eq!(stored.4, 3);
        assert_eq!(stored.5, "archived");
        assert_eq!(stored.6, 3);
        assert_eq!(stored.7, "/workspace/updated");
        assert_eq!((stored.8, stored.9), (0, 0));
        assert_eq!((stored.10, stored.11), (0, 0));

        module
            .apply(
                &context(),
                request(
                    "workspace-restore-native",
                    ProjectWorkspaceIntent::SetProjectLifecycle {
                        project_id: "project-native".to_owned(),
                        lifecycle: ProjectLifecycle::Active,
                    },
                ),
            )
            .expect("restore Project");
        let restored = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT project.lifecycle, project.binding_revision, ordering.\"order\" \
                         FROM projects project JOIN project_order ordering \
                           ON ordering.project_id = project.id \
                         WHERE project.id = 'project-native'",
                        [],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, i64>(2)?,
                            ))
                        },
                    )
                    .map_err(Into::into)
            })
            .expect("read restored Project");
        assert_eq!(restored, ("active".to_owned(), 4, 3));
    }

    #[test]
    fn mutates_session_state_and_existing_thread_links_with_exact_replay() {
        let (_directory, kernel, module) = seeded_module();
        let created = module
            .apply(
                &context(),
                create_request("workspace-create-session-owner", "project-native"),
            )
            .expect("create Session owner Project");
        let session_id = created.committed.value.affected_session_ids[0].clone();
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO codex_threads(\
                       thread_id, project_id, thread_name, thread_preview, model_provider, \
                       status_type, status_active_flags_json, archived, created_at, updated_at, \
                       linked_at\
                     ) VALUES (\
                       'thread-native', 'project-native', '', 'Preview', 'openai', 'idle', '[]', \
                       0, 1, 2, ?1\
                     )",
                    [NOW],
                )?;
                connection.execute(
                    "INSERT INTO codex_unread_threads(thread_id) VALUES ('thread-native')",
                    [],
                )?;
                Ok(())
            })
            .expect("seed existing Codex Thread");

        let rename = session_request(
            "workspace-session-rename-fallback",
            &session_id,
            ProjectSessionIntent::Rename {
                title: "  Fallback   title  ".to_owned(),
            },
        );
        let renamed = module
            .apply(&context(), rename.clone())
            .expect("rename unlinked Session");
        assert_eq!(
            renamed.committed.value.affected_session_ids.as_slice(),
            std::slice::from_ref(&session_id)
        );
        let Some(event) = renamed.event.as_ref() else {
            panic!("Session rename must publish a Workspace event");
        };
        let CoreModuleEventPayload::ProjectWorkspace(event) = &event.payload else {
            panic!("Session rename must publish a Project Workspace event");
        };
        assert_eq!(event.project_catalog_change, None);
        assert_eq!(
            event.session_summary_scopes,
            vec![ProjectSessionInvalidationScope::Project {
                project_id: "project-native".to_owned(),
            }]
        );
        assert_eq!(event.session_detail_ids, vec![session_id.clone()]);
        let replay = module
            .apply(&context(), rename)
            .expect("replay Session rename");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            replay.committed.event_sequence,
            renamed.committed.event_sequence
        );

        let mismatched = module
            .apply(
                &context(),
                session_request(
                    "workspace-session-link-mismatch",
                    &session_id,
                    ProjectSessionIntent::LinkThread {
                        thread_id: "thread-native".to_owned(),
                        expected_project_id: Some("project:default".to_owned()),
                        thread_patch: None,
                    },
                ),
            )
            .expect_err("reject mismatched Thread Project");
        assert_eq!(mismatched.code, CoreErrorCode::RevisionConflict);

        let linked = module
            .apply(
                &context(),
                session_request(
                    "workspace-session-link",
                    &session_id,
                    ProjectSessionIntent::LinkThread {
                        thread_id: "thread-native".to_owned(),
                        expected_project_id: Some("project-native".to_owned()),
                        thread_patch: Some(Box::new(ProjectWorkspaceThreadPatch {
                            project_id: Some(Some("project-native".to_owned())),
                            thread_preview: Some("Updated preview".to_owned()),
                            model_provider: Some("openai".to_owned()),
                            status: Some(ProjectWorkspaceThreadStatus {
                                status_type: CodexThreadStatusType::Active,
                                active_flags: vec![CodexThreadActiveFlag::WaitingOnApproval],
                            }),
                            updated_at: Some(3),
                            ..ProjectWorkspaceThreadPatch::default()
                        })),
                    },
                ),
            )
            .expect("link existing Codex Thread");
        assert_eq!(
            linked.committed.value.affected_thread_ids,
            ["thread-native"]
        );
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-rename-thread",
                    &session_id,
                    ProjectSessionIntent::Rename {
                        title: "  Thread   title  ".to_owned(),
                    },
                ),
            )
            .expect("rename linked Codex Thread");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-unpin",
                    &session_id,
                    ProjectSessionIntent::SetPinned { pinned: false },
                ),
            )
            .expect("unpin Session");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-read",
                    &session_id,
                    ProjectSessionIntent::SetUnread { unread: false },
                ),
            )
            .expect("mark Session read");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-unlink",
                    &session_id,
                    ProjectSessionIntent::UnlinkThread {
                        thread_id: "thread-native".to_owned(),
                    },
                ),
            )
            .expect("unlink Codex Thread");

        let stored = kernel
            .writer()
            .call(move |connection| {
                connection
                    .query_row(
                        "SELECT session.no_thread_fallback_title, session.pinned, \
                            session.pinned_order, session.unread, thread.thread_name, \
                            thread.thread_preview, thread.status_type, \
                            (SELECT count(*) FROM project_session_threads \
                             WHERE session_id = session.id), \
                            (SELECT count(*) FROM core_module_receipts \
                             WHERE operation_id = 'workspace-session-link-mismatch'), \
                            (SELECT count(*) FROM change_log \
                             WHERE operation_id = 'workspace-session-link-mismatch') \
                         FROM project_sessions session CROSS JOIN codex_threads thread \
                         WHERE session.id = ?1 AND thread.thread_id = 'thread-native'",
                        [&session_id],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, Option<i64>>(2)?,
                                row.get::<_, i64>(3)?,
                                row.get::<_, String>(4)?,
                                row.get::<_, String>(5)?,
                                row.get::<_, String>(6)?,
                                row.get::<_, i64>(7)?,
                                row.get::<_, i64>(8)?,
                                row.get::<_, i64>(9)?,
                            ))
                        },
                    )
                    .map_err(Into::into)
            })
            .expect("read mutated Session");
        assert_eq!(stored.0, "Fallback title");
        assert_eq!((stored.1, stored.2, stored.3), (0, None, 0));
        assert_eq!(stored.4, "Thread title");
        assert_eq!(
            (stored.5.as_str(), stored.6.as_str()),
            ("Updated preview", "active")
        );
        assert_eq!((stored.7, stored.8, stored.9), (0, 0, 0));
    }

    #[test]
    fn owns_session_lifecycle_order_move_and_delete_with_exact_replay() {
        let (_directory, kernel, module) = seeded_module();
        let project = module
            .apply(
                &context(),
                create_request("workspace-session-lifecycle-project", "project-native"),
            )
            .expect("create Session lifecycle Project");
        let initial_session_id = project.committed.value.affected_session_ids[0].clone();

        let create_a = request(
            "workspace-session-create-a",
            ProjectWorkspaceIntent::CreateSession {
                session_id: "session-a".to_owned(),
                project_id: Some("project-native".to_owned()),
                title: "  Lifecycle A  ".to_owned(),
            },
        );
        let created_a = module
            .apply(&context(), create_a.clone())
            .expect("create first explicit Session");
        let replayed_a = module
            .apply(&context(), create_a)
            .expect("replay explicit Session creation");
        assert!(replayed_a.committed.receipt.mutation.duplicate);
        assert_eq!(
            replayed_a.committed.event_sequence,
            created_a.committed.event_sequence
        );
        assert!(replayed_a.event.is_none());
        module
            .apply(
                &context(),
                request(
                    "workspace-session-create-b",
                    ProjectWorkspaceIntent::CreateSession {
                        session_id: "session-b".to_owned(),
                        project_id: Some("project-native".to_owned()),
                        title: "Lifecycle B".to_owned(),
                    },
                ),
            )
            .expect("create second explicit Session");
        for session_id in ["session-a", "session-b"] {
            module
                .apply(
                    &context(),
                    session_request(
                        &format!("workspace-session-pin-{session_id}"),
                        session_id,
                        ProjectSessionIntent::SetPinned { pinned: true },
                    ),
                )
                .expect("pin explicit Session");
        }
        module
            .apply(
                &context(),
                request(
                    "workspace-session-reorder",
                    ProjectWorkspaceIntent::ReorderSessions {
                        project_id: Some("project-native".to_owned()),
                        session_ids: vec!["session-b".to_owned(), "session-a".to_owned()],
                    },
                ),
            )
            .expect("reorder active Sessions");
        module
            .apply(
                &context(),
                request(
                    "workspace-session-reorder-pinned",
                    ProjectWorkspaceIntent::ReorderPinnedSessions {
                        project_id: Some("project-native".to_owned()),
                        session_ids: vec![initial_session_id.clone(), "session-b".to_owned()],
                    },
                ),
            )
            .expect("reorder pinned Sessions");

        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-archive-b",
                    "session-b",
                    ProjectSessionIntent::SetArchived { archived: true },
                ),
            )
            .expect("archive Session");
        let archived = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Session {
                        session_id: "session-b".to_owned(),
                    },
                },
            )
            .expect("read archived Session");
        let ProjectWorkspaceReadValue::Session { session, .. } = archived.value else {
            panic!("archived Session snapshot");
        };
        assert!(session.archived);
        assert!(session.archived_at.is_some());
        assert!(!session.pinned);
        assert_eq!(session.pinned_order, None);
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-restore-b",
                    "session-b",
                    ProjectSessionIntent::SetArchived { archived: false },
                ),
            )
            .expect("restore Session");

        module
            .apply(
                &context(),
                request(
                    "workspace-session-create-projectless",
                    ProjectWorkspaceIntent::CreateSession {
                        session_id: "session-projectless".to_owned(),
                        project_id: None,
                        title: "Projectless browser".to_owned(),
                    },
                ),
            )
            .expect("create projectless Session");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO codex_threads(\
                       thread_id, project_id, thread_name, thread_preview, model_provider, \
                       status_type, status_active_flags_json, archived, created_at, updated_at, \
                       linked_at\
                     ) VALUES (\
                       'thread-projectless', NULL, '', 'Projectless preview', 'openai', \
                       'idle', '[]', 0, 1, 2, ?1\
                     )",
                    [NOW],
                )?;
                Ok(())
            })
            .expect("seed projectless Codex Thread");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-link-projectless",
                    "session-projectless",
                    ProjectSessionIntent::LinkThread {
                        thread_id: "thread-projectless".to_owned(),
                        expected_project_id: None,
                        thread_patch: None,
                    },
                ),
            )
            .expect("link projectless Codex Thread");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-create-projectless-browser",
                    "session-projectless",
                    ProjectSessionIntent::CreateTab {
                        tab_id: "projectless-browser".to_owned(),
                        panel_id: ProjectSessionPanelId::Right,
                        target_leaf_id: None,
                        title: "Projectless browser".to_owned(),
                        content: ProjectSessionTabContent::Browser {
                            browser_tab_id: Some("projectless-browser-identity".to_owned()),
                            url: Some("https://example.test/projectless".to_owned()),
                            title: None,
                            favicon_url: None,
                            device_toolbar_visible: None,
                        },
                    },
                ),
            )
            .expect("create projectless browser tab");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-create-projectless-terminal",
                    "session-projectless",
                    ProjectSessionIntent::CreateTab {
                        tab_id: "projectless-terminal".to_owned(),
                        panel_id: ProjectSessionPanelId::Bottom,
                        target_leaf_id: None,
                        title: "Projectless terminal".to_owned(),
                        content: ProjectSessionTabContent::Terminal {
                            terminal_session_id: "projectless-terminal-owner".to_owned(),
                        },
                    },
                ),
            )
            .expect("create projectless terminal tab");
        let moved = module
            .apply(
                &context(),
                request(
                    "workspace-session-move-projectless",
                    ProjectWorkspaceIntent::MoveSession {
                        session_id: "session-projectless".to_owned(),
                        project_id: Some("project-native".to_owned()),
                    },
                ),
            )
            .expect("move browser-only Session into Project");
        assert_eq!(
            moved.committed.value.affected_thread_ids,
            ["thread-projectless"]
        );
        let CoreModuleEventPayload::ProjectWorkspace(moved_event) =
            &moved.event.as_ref().expect("Session move event").payload
        else {
            panic!("Session move must publish a Project Workspace event");
        };
        assert_eq!(
            moved_event.session_summary_scopes,
            vec![
                ProjectSessionInvalidationScope::Projectless,
                ProjectSessionInvalidationScope::Project {
                    project_id: "project-native".to_owned(),
                },
            ]
        );
        assert_eq!(moved_event.session_detail_ids, vec!["session-projectless"]);
        let moved_back = module
            .apply(
                &context(),
                request(
                    "workspace-session-move-projectless-back",
                    ProjectWorkspaceIntent::MoveSession {
                        session_id: "session-projectless".to_owned(),
                        project_id: None,
                    },
                ),
            )
            .expect("move Browser and Terminal Session back to projectless");
        assert_eq!(
            moved_back.committed.value.affected_thread_ids,
            ["thread-projectless"]
        );
        let projectless_snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Session {
                        session_id: "session-projectless".to_owned(),
                    },
                },
            )
            .expect("read rehomed projectless Session");
        let ProjectWorkspaceReadValue::Session { tabs, .. } = projectless_snapshot.value else {
            panic!("rehomed projectless Session snapshot");
        };
        assert!(tabs.iter().all(|tab| tab.project_id.is_none()));
        let browser = tabs
            .iter()
            .find(|tab| tab.id == "projectless-browser")
            .expect("rehomed projectless Browser tab");
        assert!(matches!(
            browser.content,
            ProjectSessionTabContent::Browser { .. }
        ));
        let terminal = tabs
            .iter()
            .find(|tab| tab.id == "projectless-terminal")
            .expect("rehomed projectless Terminal tab");
        assert_eq!(
            terminal.content,
            ProjectSessionTabContent::Terminal {
                terminal_session_id: "projectless-terminal-owner".to_owned(),
            }
        );

        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-create-terminal-a",
                    "session-a",
                    ProjectSessionIntent::CreateTab {
                        tab_id: "session-a-terminal".to_owned(),
                        panel_id: ProjectSessionPanelId::Right,
                        target_leaf_id: None,
                        title: "Terminal".to_owned(),
                        content: ProjectSessionTabContent::Terminal {
                            terminal_session_id: "session-a-terminal-owner".to_owned(),
                        },
                    },
                ),
            )
            .expect("create portable Terminal tab");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-create-review-a",
                    "session-a",
                    ProjectSessionIntent::CreateTab {
                        tab_id: "session-a-review".to_owned(),
                        panel_id: ProjectSessionPanelId::Right,
                        target_leaf_id: None,
                        title: "Review".to_owned(),
                        content: ProjectSessionTabContent::Review,
                    },
                ),
            )
            .expect("create Project-scoped Review tab");
        let invalid_move = module
            .apply(
                &context(),
                request(
                    "workspace-session-invalid-move",
                    ProjectWorkspaceIntent::MoveSession {
                        session_id: "session-a".to_owned(),
                        project_id: Some("project:default".to_owned()),
                    },
                ),
            )
            .expect_err("reject moving a Session with a Project-scoped tab");
        assert_eq!(invalid_move.code, CoreErrorCode::InvalidInput);

        let deleted = module
            .apply(
                &context(),
                request(
                    "workspace-session-delete-projectless",
                    ProjectWorkspaceIntent::DeleteSession {
                        session_id: "session-projectless".to_owned(),
                    },
                ),
            )
            .expect("delete moved Session");
        assert_eq!(
            deleted.committed.value.affected_thread_ids,
            ["thread-projectless"]
        );

        let stored = kernel
            .writer()
            .call(move |connection| {
                let session_rows = connection
                    .prepare(
                        "SELECT id, \"order\", pinned, pinned_order, archived, archived_at, \
                           no_thread_fallback_title, left_pane_collapsed \
                         FROM project_sessions WHERE project_id = 'project-native' \
                         ORDER BY id",
                    )?
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, Option<i64>>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, i64>(7)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let lifecycle_counts = connection.query_row(
                    "SELECT \
                       (SELECT count(*) FROM project_sessions \
                        WHERE id = 'session-projectless'), \
                       (SELECT count(*) FROM project_session_tabs \
                        WHERE id = 'projectless-browser'), \
                       (SELECT count(*) FROM project_session_tabs \
                        WHERE id = 'projectless-terminal'), \
                       (SELECT count(*) FROM project_session_threads \
                        WHERE thread_id = 'thread-projectless'), \
                       (SELECT count(*) FROM core_module_receipts \
                        WHERE operation_id = 'workspace-session-invalid-move'), \
                       (SELECT count(*) FROM change_log \
                        WHERE operation_id = 'workspace-session-invalid-move'), \
                       (SELECT project_id FROM codex_threads \
                        WHERE thread_id = 'thread-projectless')",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, Option<String>>(6)?,
                        ))
                    },
                )?;
                Ok((session_rows, lifecycle_counts))
            })
            .expect("read Session lifecycle effects");
        let session_a = stored
            .0
            .iter()
            .find(|row| row.0 == "session-a")
            .expect("first explicit Session");
        assert_eq!((session_a.1, session_a.2, session_a.3), (2, 1, Some(2)));
        assert_eq!(session_a.6, "Lifecycle A");
        assert_eq!(session_a.7, 0);
        let session_b = stored
            .0
            .iter()
            .find(|row| row.0 == "session-b")
            .expect("second explicit Session");
        assert_eq!((session_b.1, session_b.2, session_b.3), (1, 0, None));
        assert_eq!(session_b.4, 0);
        assert_eq!(session_b.5, None);
        assert_eq!(stored.1, (0, 0, 0, 0, 0, 0, None));
        let initial = stored
            .0
            .iter()
            .find(|row| row.0 == initial_session_id)
            .expect("initial Project Session");
        assert_eq!((initial.1, initial.2, initial.3), (3, 1, Some(0)));
    }

    #[test]
    fn owns_projectless_terminal_and_exact_file_tab_boundaries() {
        let (_directory, _kernel, module) = seeded_module();
        module
            .apply(
                &context(),
                request(
                    "workspace-create-projectless-tab-owner",
                    ProjectWorkspaceIntent::CreateSession {
                        session_id: "session:projectless-tabs".to_owned(),
                        project_id: None,
                        title: "Projectless tools".to_owned(),
                    },
                ),
            )
            .expect("create projectless Session");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-create-projectless-terminal",
                    "session:projectless-tabs",
                    ProjectSessionIntent::CreateTab {
                        tab_id: "tab:projectless-terminal".to_owned(),
                        panel_id: ProjectSessionPanelId::Bottom,
                        target_leaf_id: None,
                        title: "Terminal".to_owned(),
                        content: ProjectSessionTabContent::Terminal {
                            terminal_session_id: "terminal:projectless".to_owned(),
                        },
                    },
                ),
            )
            .expect("create projectless Terminal tab");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-create-projectless-file",
                    "session:projectless-tabs",
                    ProjectSessionIntent::CreateTab {
                        tab_id: "tab:projectless-file".to_owned(),
                        panel_id: ProjectSessionPanelId::Right,
                        target_leaf_id: None,
                        title: "notes.md".to_owned(),
                        content: ProjectSessionTabContent::Files {
                            workspace_root: Some("/workspace".to_owned()),
                            cwd: Some("/workspace/nodex".to_owned()),
                            path: Some("/workspace/nodex/notes.md".to_owned()),
                        },
                    },
                ),
            )
            .expect("create projectless exact-file tab");

        for (operation_id, tab_id, content) in [
            (
                "workspace-reject-projectless-files-tree",
                "tab:projectless-files-tree",
                ProjectSessionTabContent::Files {
                    workspace_root: Some("/workspace".to_owned()),
                    cwd: Some("/workspace/nodex".to_owned()),
                    path: None,
                },
            ),
            (
                "workspace-reject-projectless-db",
                "tab:projectless-db",
                ProjectSessionTabContent::DbView {
                    database_view_id: None,
                    view: ProjectSessionDatabaseView::Kanban,
                },
            ),
            (
                "workspace-reject-projectless-page",
                "tab:projectless-page",
                ProjectSessionTabContent::PageStage {
                    project_id: "project:default".to_owned(),
                    page_id: "page:default".to_owned(),
                    title_snapshot: None,
                },
            ),
            (
                "workspace-reject-projectless-review",
                "tab:projectless-review",
                ProjectSessionTabContent::Review,
            ),
        ] {
            let error = module
                .apply(
                    &context(),
                    session_request(
                        operation_id,
                        "session:projectless-tabs",
                        ProjectSessionIntent::CreateTab {
                            tab_id: tab_id.to_owned(),
                            panel_id: ProjectSessionPanelId::Right,
                            target_leaf_id: None,
                            title: "Unavailable".to_owned(),
                            content,
                        },
                    ),
                )
                .expect_err("reject Project-scoped projectless tab");
            assert_eq!(error.code, CoreErrorCode::InvalidInput);
        }

        let snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Session {
                        session_id: "session:projectless-tabs".to_owned(),
                    },
                },
            )
            .expect("read projectless tabs");
        let ProjectWorkspaceReadValue::Session { tabs, .. } = snapshot.value else {
            panic!("projectless Session snapshot");
        };
        assert_eq!(tabs.len(), 2);
        assert!(tabs.iter().all(|tab| tab.project_id.is_none()));
        let terminal = tabs
            .iter()
            .find(|tab| tab.id == "tab:projectless-terminal")
            .expect("projectless Terminal tab");
        assert_eq!(
            terminal.content,
            ProjectSessionTabContent::Terminal {
                terminal_session_id: "terminal:projectless".to_owned(),
            }
        );
        let file = tabs
            .iter()
            .find(|tab| tab.id == "tab:projectless-file")
            .expect("projectless file tab");
        assert_eq!(
            file.content,
            ProjectSessionTabContent::Files {
                workspace_root: Some("/workspace".to_owned()),
                cwd: Some("/workspace/nodex".to_owned()),
                path: Some("/workspace/nodex/notes.md".to_owned()),
            }
        );
    }

    #[test]
    fn owns_split_panel_layouts_and_complete_tab_lifecycle_atomically() {
        let (_directory, kernel, module) = seeded_module();
        let created = module
            .apply(
                &context(),
                create_request("workspace-create-tab-owner", "project-native"),
            )
            .expect("create tab owner Project");
        let session_id = created.committed.value.affected_session_ids[0].clone();
        let (database_tab_id, database_view_id) = kernel
            .writer()
            .call({
                let session_id = session_id.clone();
                move |connection| {
                    connection
                        .query_row(
                            "SELECT id, json_extract(config_json, '$.databaseViewId') \
                             FROM project_session_tabs WHERE session_id = ?1",
                            [&session_id],
                            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                        )
                        .map_err(Into::into)
                }
            })
            .expect("read default tab");

        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-split-layout",
                    &session_id,
                    ProjectSessionIntent::ReplacePanelLayout {
                        panel_id: ProjectSessionPanelId::Right,
                        layout: json!({
                            "version": 2,
                            "root": {
                                "type": "split",
                                "id": "right-branch",
                                "direction": "horizontal",
                                "ratio": 0.05,
                                "first": {
                                    "type": "leaf",
                                    "id": "main",
                                    "tabIds": [database_tab_id],
                                    "activeTabId": database_tab_id,
                                    "mruTabIds": [database_tab_id]
                                },
                                "second": {
                                    "type": "leaf",
                                    "id": "target-leaf",
                                    "tabIds": [],
                                    "activeTabId": null,
                                    "mruTabIds": []
                                }
                            },
                            "activeLeafId": "target-leaf",
                            "mruLeafIds": ["target-leaf", "main"],
                            "maximizedLeafId": null
                        }),
                    },
                ),
            )
            .expect("replace split layout");

        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-create-terminal",
                    &session_id,
                    ProjectSessionIntent::CreateTab {
                        tab_id: "terminal-tab".to_owned(),
                        panel_id: ProjectSessionPanelId::Right,
                        target_leaf_id: Some("target-leaf".to_owned()),
                        title: "  Terminal  ".to_owned(),
                        content: ProjectSessionTabContent::Terminal {
                            terminal_session_id: "terminal-session-1".to_owned(),
                        },
                    },
                ),
            )
            .expect("create terminal tab");
        let browser_request = session_request(
            "workspace-session-create-browser",
            &session_id,
            ProjectSessionIntent::CreateTab {
                tab_id: "browser-tab".to_owned(),
                panel_id: ProjectSessionPanelId::Right,
                target_leaf_id: Some("target-leaf".to_owned()),
                title: "Browser".to_owned(),
                content: ProjectSessionTabContent::Browser {
                    browser_tab_id: Some("browser-identity-1".to_owned()),
                    url: Some("https://example.test".to_owned()),
                    title: None,
                    favicon_url: None,
                    device_toolbar_visible: Some(true),
                },
            },
        );
        let browser = module
            .apply(&context(), browser_request.clone())
            .expect("create browser tab");
        let replay = module
            .apply(&context(), browser_request)
            .expect("replay browser tab creation");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            replay.committed.event_sequence,
            browser.committed.event_sequence
        );

        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-focus-database",
                    &session_id,
                    ProjectSessionIntent::CreateTab {
                        tab_id: "duplicate-db-tab".to_owned(),
                        panel_id: ProjectSessionPanelId::Bottom,
                        target_leaf_id: None,
                        title: "Duplicate DB".to_owned(),
                        content: ProjectSessionTabContent::DbView {
                            database_view_id: Some(database_view_id),
                            view: ProjectSessionDatabaseView::Kanban,
                        },
                    },
                ),
            )
            .expect("focus equivalent Database View tab");

        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-move-terminal",
                    &session_id,
                    ProjectSessionIntent::MoveTab {
                        tab_id: "terminal-tab".to_owned(),
                        panel_id: ProjectSessionPanelId::Bottom,
                        target_leaf_id: None,
                        before_tab_id: None,
                        source_layout: None,
                        target_layout: None,
                    },
                ),
            )
            .expect("move terminal tab to bottom panel");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-delete-browser",
                    &session_id,
                    ProjectSessionIntent::DeleteTab {
                        tab_id: "browser-tab".to_owned(),
                        layout: None,
                    },
                ),
            )
            .expect("delete browser tab");

        let snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Session {
                        session_id: session_id.clone(),
                    },
                },
            )
            .expect("read mutated Session");
        let ProjectWorkspaceReadValue::Session { panels, tabs, .. } = snapshot.value else {
            panic!("Session snapshot");
        };
        assert_eq!(tabs.len(), 2);
        assert_eq!(
            tabs.iter().map(|tab| tab.id.as_str()).collect::<Vec<_>>(),
            vec![database_tab_id.as_str(), "terminal-tab"]
        );
        assert_eq!(tabs[0].panel_id, ProjectSessionPanelId::Right);
        assert_eq!(tabs[0].order, 0);
        assert_eq!(tabs[1].panel_id, ProjectSessionPanelId::Bottom);
        assert_eq!(tabs[1].order, 0);
        assert_eq!(tabs[1].title, "Terminal");
        assert_eq!(panels["right"]["layout"]["root"]["type"], "leaf");
        assert_eq!(
            panels["right"]["layout"]["root"]["tabIds"],
            json!([database_tab_id])
        );
        assert_eq!(
            panels["bottom"]["layout"]["root"]["tabIds"],
            json!(["terminal-tab"])
        );
        assert_eq!(panels["bottom"]["collapsed"], false);

        let invalid = module
            .apply(
                &context(),
                session_request(
                    "workspace-session-invalid-tab",
                    &session_id,
                    ProjectSessionIntent::CreateTab {
                        tab_id: "invalid-tab".to_owned(),
                        panel_id: ProjectSessionPanelId::Right,
                        target_leaf_id: None,
                        title: "Invalid".to_owned(),
                        content: ProjectSessionTabContent::Terminal {
                            terminal_session_id: String::new(),
                        },
                    },
                ),
            )
            .expect_err("reject Terminal config without a Session identity");
        assert_eq!(invalid.code, CoreErrorCode::InvalidInput);
        let rollback_counts = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT \
                           (SELECT count(*) FROM project_session_tabs WHERE id = 'invalid-tab'), \
                           (SELECT count(*) FROM core_module_receipts \
                            WHERE operation_id = 'workspace-session-invalid-tab'), \
                           (SELECT count(*) FROM change_log \
                            WHERE operation_id = 'workspace-session-invalid-tab')",
                        [],
                        |row| {
                            Ok((
                                row.get::<_, i64>(0)?,
                                row.get::<_, i64>(1)?,
                                row.get::<_, i64>(2)?,
                            ))
                        },
                    )
                    .map_err(Into::into)
            })
            .expect("read invalid tab rollback");
        assert_eq!(rollback_counts, (0, 0, 0));

        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-patch-view-state",
                    &session_id,
                    ProjectSessionIntent::PatchViewState {
                        fallback_title: Some("Updated fallback".to_owned()),
                        left_pane_collapsed: Some(true),
                        right_panel: Some(ProjectSessionPanelStatePatch {
                            collapsed: Some(false),
                            layout: None,
                            size: Some(ProjectSessionPanelSizePatch {
                                width_px: Some(720.0),
                                height_px: None,
                                full_width: Some(true),
                            }),
                        }),
                        bottom_panel: Some(ProjectSessionPanelStatePatch {
                            collapsed: Some(false),
                            layout: None,
                            size: Some(ProjectSessionPanelSizePatch {
                                width_px: None,
                                height_px: Some(360.0),
                                full_width: None,
                            }),
                        }),
                    },
                ),
            )
            .expect("patch Session view state");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-update-terminal",
                    &session_id,
                    ProjectSessionIntent::UpdateTab {
                        tab_id: "terminal-tab".to_owned(),
                        title: Some("  Updated shell  ".to_owned()),
                        content: Some(ProjectSessionTabContent::Terminal {
                            terminal_session_id: "terminal-session-2".to_owned(),
                        }),
                        state_key: Some(4),
                        state: Some(json!({ "cwd": "/workspace/native" })),
                    },
                ),
            )
            .expect("update terminal tab metadata");
        let replace_state = session_request(
            "workspace-session-replace-terminal-state",
            &session_id,
            ProjectSessionIntent::ReplaceTabState {
                tab_id: "terminal-tab".to_owned(),
                state_key: 2,
                state: json!({ "cwd": "/workspace/native" }),
            },
        );
        let replaced = module
            .apply(&context(), replace_state.clone())
            .expect("replace terminal tab state");
        let replayed = module
            .apply(&context(), replace_state)
            .expect("replay terminal tab state replacement");
        assert!(replayed.committed.receipt.mutation.duplicate);
        assert_eq!(
            replayed.committed.event_sequence,
            replaced.committed.event_sequence
        );
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-create-cross-project-page-tab",
                    &session_id,
                    ProjectSessionIntent::CreateTab {
                        tab_id: "cross-project-page".to_owned(),
                        panel_id: ProjectSessionPanelId::Right,
                        target_leaf_id: None,
                        title: "Cross-project Page".to_owned(),
                        content: ProjectSessionTabContent::PageStage {
                            project_id: "project:default".to_owned(),
                            page_id: "page:cross-project".to_owned(),
                            title_snapshot: Some("Initial".to_owned()),
                        },
                    },
                ),
            )
            .expect("create cross-Project Page tab");
        module
            .apply(
                &context(),
                session_request(
                    "workspace-session-update-cross-project-page-tab",
                    &session_id,
                    ProjectSessionIntent::UpdateTab {
                        tab_id: "cross-project-page".to_owned(),
                        title: None,
                        content: Some(ProjectSessionTabContent::PageStage {
                            project_id: "project:default".to_owned(),
                            page_id: "page:cross-project".to_owned(),
                            title_snapshot: Some("Updated".to_owned()),
                        }),
                        state_key: None,
                        state: None,
                    },
                ),
            )
            .expect("update cross-Project Page tab");

        let invalid_patch = module
            .apply(
                &context(),
                session_request(
                    "workspace-session-invalid-panel-size",
                    &session_id,
                    ProjectSessionIntent::PatchViewState {
                        fallback_title: None,
                        left_pane_collapsed: None,
                        right_panel: Some(ProjectSessionPanelStatePatch {
                            collapsed: None,
                            layout: None,
                            size: Some(ProjectSessionPanelSizePatch {
                                width_px: Some(-1.0),
                                height_px: None,
                                full_width: None,
                            }),
                        }),
                        bottom_panel: None,
                    },
                ),
            )
            .expect_err("reject invalid panel size");
        assert_eq!(invalid_patch.code, CoreErrorCode::InvalidInput);
        let invalid_config = module
            .apply(
                &context(),
                session_request(
                    "workspace-session-invalid-tab-update",
                    &session_id,
                    ProjectSessionIntent::UpdateTab {
                        tab_id: "terminal-tab".to_owned(),
                        title: None,
                        content: Some(ProjectSessionTabContent::Terminal {
                            terminal_session_id: String::new(),
                        }),
                        state_key: None,
                        state: None,
                    },
                ),
            )
            .expect_err("reject Terminal update without a Session identity");
        assert_eq!(invalid_config.code, CoreErrorCode::InvalidInput);

        let final_snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Session {
                        session_id: session_id.clone(),
                    },
                },
            )
            .expect("read updated Session view and tabs");
        let ProjectWorkspaceReadValue::Session {
            session,
            panels,
            tabs,
        } = final_snapshot.value
        else {
            panic!("updated Session snapshot");
        };
        assert_eq!(session.no_thread_fallback_title, "Updated fallback");
        assert!(session.left_pane_collapsed);
        assert_eq!(panels["right"]["collapsed"], false);
        assert_eq!(panels["right"]["size"]["widthPx"], 720.0);
        assert_eq!(panels["right"]["size"]["fullWidth"], true);
        assert_eq!(panels["bottom"]["collapsed"], false);
        assert_eq!(panels["bottom"]["size"]["heightPx"], 360.0);
        let terminal = tabs
            .iter()
            .find(|tab| tab.id == "terminal-tab")
            .expect("updated terminal tab");
        assert_eq!(terminal.title, "Updated shell");
        assert_eq!(
            terminal.content,
            ProjectSessionTabContent::Terminal {
                terminal_session_id: "terminal-session-2".to_owned(),
            }
        );
        assert_eq!(terminal.state_key, 2);
        assert_eq!(terminal.state, json!({ "cwd": "/workspace/native" }));
        let page = tabs
            .iter()
            .find(|tab| tab.id == "cross-project-page")
            .expect("cross-Project Page tab");
        assert_eq!(page.project_id.as_deref(), Some("project-native"));
        assert_eq!(
            page.content,
            ProjectSessionTabContent::PageStage {
                project_id: "project:default".to_owned(),
                page_id: "page:cross-project".to_owned(),
                title_snapshot: Some("Updated".to_owned()),
            }
        );
        let failed_writes = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT \
                           (SELECT count(*) FROM core_module_receipts WHERE operation_id IN (\
                             'workspace-session-invalid-panel-size', \
                             'workspace-session-invalid-tab-update')), \
                           (SELECT count(*) FROM change_log WHERE operation_id IN (\
                             'workspace-session-invalid-panel-size', \
                             'workspace-session-invalid-tab-update'))",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                    )
                    .map_err(Into::into)
            })
            .expect("read failed view/tab mutation rollback");
        assert_eq!(failed_writes, (0, 0));
    }

    #[test]
    fn rolls_back_the_complete_project_when_a_nested_session_write_fails() {
        let (_directory, kernel, module) = seeded_module();
        kernel
            .writer()
            .call(|connection| {
                connection.execute_batch(
                    "CREATE TEMP TRIGGER fail_workspace_tab \
                     BEFORE INSERT ON project_session_tabs BEGIN \
                       SELECT RAISE(ABORT, 'injected Project Session failure'); \
                     END;",
                )?;
                Ok(())
            })
            .expect("install fault trigger");
        let error = module
            .apply(
                &context(),
                create_request("workspace-create-rollback", "project-rollback"),
            )
            .expect_err("nested failure must reject aggregate");
        assert_eq!(error.code, CoreErrorCode::CoreUnavailable);
        let counts = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT \
                       (SELECT count(*) FROM projects WHERE id = 'project-rollback'), \
                       (SELECT count(*) FROM blocks WHERE project_id = 'project-rollback'), \
                       (SELECT count(*) FROM project_sessions \
                        WHERE project_id = 'project-rollback'), \
                       (SELECT count(*) FROM core_module_receipts \
                        WHERE operation_id = 'workspace-create-rollback'), \
                       (SELECT count(*) FROM change_log \
                        WHERE operation_id = 'workspace-create-rollback')",
                        [],
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
                    .map_err(Into::into)
            })
            .expect("read rollback state");
        assert_eq!(counts, (0, 0, 0, 0, 0));
    }
}
