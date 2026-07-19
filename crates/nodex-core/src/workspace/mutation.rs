use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use nodex_core_contracts::workspace::{
    ProjectLifecycle, ProjectWorkspaceCommitValue, ProjectWorkspaceEvent,
    ProjectWorkspaceEventKind, ProjectWorkspaceIntent, ProjectWorkspaceReceipt,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreModuleEventPayload, ModuleApplyRequest, ModuleMutationReceipt, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use unicode_segmentation::UnicodeSegmentation;

use crate::database::create_database_authority_records;
use crate::document::{PrimaryCanvasIdentity, create_primary_canvas, read_store_epoch, sha256};
use crate::domain::identity::stable_uuid_v7;
use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::writer::StoreWriter;

use super::ProjectWorkspaceApplyOutcome;

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

struct WorkspaceMutationEffects {
    operation_kind: &'static str,
    change_project_id: String,
    project_ids: Vec<String>,
    session_ids: Vec<String>,
    thread_ids: Vec<String>,
    block_ids: Vec<String>,
    document_ids: Vec<String>,
    database_ids: Vec<String>,
    committed_at: String,
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
                    StoreErrorCode::Conflict,
                    "Project Workspace mutation targets a stale store epoch",
                    true,
                ));
            }
            validate_id("operation_id", &request.operation_id)?;
            let fingerprint = serde_json::to_vec(&(
                &context,
                request.version,
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
                ProjectWorkspaceIntent::MutateSession { .. } => Err(invalid(
                    "Project Session intent has not been migrated to native Core",
                )),
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
            change_project_id: project_id.to_owned(),
            project_ids: vec![project_id.to_owned()],
            session_ids: vec![created.identities.session_id],
            thread_ids: Vec::new(),
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

fn finish_mutation(
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
        "projectIds": effects.project_ids,
        "sessionIds": effects.session_ids,
        "threadIds": effects.thread_ids,
    });
    connection.execute(
        "INSERT INTO change_log(\
           project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
           database_block_ids_json, payload_json, committed_at\
        ) VALUES (?1, ?2, 'project_workspace.changed', ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            effects.change_project_id,
            store_epoch,
            operation_id,
            serde_json::to_string(&effects.block_ids)
                .map_err(|_| internal("Project Workspace affected Blocks"))?,
            serde_json::to_string(&effects.document_ids)
                .map_err(|_| internal("Project Workspace affected Documents"))?,
            serde_json::to_string(&effects.database_ids)
                .map_err(|_| internal("Project Workspace affected Databases"))?,
            serde_json::to_string(&payload)
                .map_err(|_| internal("Project Workspace event payload"))?,
            effects.committed_at,
        ],
    )?;
    let event_sequence = connection.last_insert_rowid();
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
    Ok(ProjectWorkspaceApplyOutcome {
        committed,
        event: Some(CommittedCoreModuleEvent {
            version: CORE_CONTRACT_VERSION,
            sequence: event_sequence,
            store_epoch: StoreEpoch(store_epoch.to_owned()),
            operation_id: Some(operation_id.to_owned()),
            committed_at: effects.committed_at,
            payload: CoreModuleEventPayload::ProjectWorkspace(ProjectWorkspaceEvent {
                kind: ProjectWorkspaceEventKind::WorkspaceChanged,
                project_ids: effects.project_ids,
                session_ids: effects.session_ids,
                thread_ids: effects.thread_ids,
            }),
        }),
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
            change_project_id,
            project_ids: project_ids.to_vec(),
            session_ids: Vec::new(),
            thread_ids: Vec::new(),
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
        project_id,
        now,
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
            change_project_id: project_id.to_owned(),
            project_ids: vec![project_id.to_owned()],
            session_ids: Vec::new(),
            thread_ids: Vec::new(),
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

fn workspace_event_anchor(connection: &Connection, library_id: &str) -> Result<String, StoreError> {
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

    use nodex_core_contracts::workspace::{ProjectLifecycle, ProjectWorkspaceIntent};
    use nodex_core_contracts::{
        AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, CoreErrorCode, LibraryId,
        ModuleApplyRequest, ProfileId, ProjectId, StoreEpoch,
    };
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
            version: CORE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent,
        }
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
        assert!(outcome.event.is_some());

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
