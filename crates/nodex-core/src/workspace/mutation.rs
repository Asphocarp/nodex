use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use nodex_core_contracts::workspace::{
    ProjectWorkspaceCommitValue, ProjectWorkspaceEvent, ProjectWorkspaceEventKind,
    ProjectWorkspaceIntent, ProjectWorkspaceReceipt,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreModuleEventPayload, ModuleApplyRequest, ModuleMutationReceipt, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

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
const INITIAL_RANK_KEY: &str = "7fffffffffffffffffffffffffffffff";
const DEFAULT_SESSION_TITLE: &str = "Database View";
const DEFAULT_TAB_TITLE: &str = "DB View";

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
                _ => Err(invalid(
                    "Project Workspace intent has not been migrated to native Core",
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
    validate_project_input(project_id, description, icon)?;
    let sources = normalize_source_roots(source_roots)?;
    let name = normalize_project_name(name, &sources)?;
    let icon = icon.trim();
    let created = create_project_records(
        connection,
        library_id,
        project_id,
        &name,
        description,
        icon,
        &sources,
        operation_id,
        assets_root,
    )?;
    let project_ids = vec![project_id.to_owned()];
    let session_ids = vec![created.identities.session_id.clone()];
    let thread_ids = Vec::new();
    let payload = json!({
        "kind": "workspace_changed",
        "projectIds": project_ids,
        "sessionIds": session_ids,
        "threadIds": thread_ids,
    });
    connection.execute(
        "INSERT INTO change_log(\
           project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
           database_block_ids_json, payload_json, committed_at\
         ) VALUES (?1, ?2, 'project_workspace.changed', ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            project_id,
            store_epoch,
            operation_id,
            serde_json::to_string(&vec![
                created.identities.database_id.clone(),
                created.canvas.block_id.clone()
            ])
            .map_err(|_| internal("Project Workspace affected Blocks"))?,
            serde_json::to_string(&vec![created.canvas.document_id.clone()])
                .map_err(|_| internal("Project Workspace affected Documents"))?,
            serde_json::to_string(&vec![created.identities.database_id.clone()])
                .map_err(|_| internal("Project Workspace affected Databases"))?,
            serde_json::to_string(&payload)
                .map_err(|_| internal("Project Workspace event payload"))?,
            created.committed_at,
        ],
    )?;
    let event_sequence = connection.last_insert_rowid();
    let committed = CommittedModuleValue {
        value: ProjectWorkspaceCommitValue {
            affected_project_ids: project_ids.clone(),
            affected_session_ids: session_ids.clone(),
            affected_thread_ids: thread_ids.clone(),
        },
        receipt: ProjectWorkspaceReceipt {
            mutation: ModuleMutationReceipt {
                operation_id: operation_id.to_owned(),
                duplicate: false,
            },
            affected_project_ids: project_ids.clone(),
            affected_session_ids: session_ids.clone(),
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
            operation_kind: "create_project",
            store_epoch,
            request_hash,
            result: &result,
            event_sequence: Some(event_sequence),
            committed_at: &created.committed_at,
        },
    )?;
    Ok(ProjectWorkspaceApplyOutcome {
        committed,
        event: Some(CommittedCoreModuleEvent {
            version: CORE_CONTRACT_VERSION,
            sequence: event_sequence,
            store_epoch: StoreEpoch(store_epoch.to_owned()),
            operation_id: Some(operation_id.to_owned()),
            committed_at: created.committed_at,
            payload: CoreModuleEventPayload::ProjectWorkspace(ProjectWorkspaceEvent {
                kind: ProjectWorkspaceEventKind::WorkspaceChanged,
                project_ids,
                session_ids,
                thread_ids,
            }),
        }),
    })
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
                now
            ],
        )?;
    }
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

fn validate_project_input(
    project_id: &str,
    description: &str,
    icon: &str,
) -> Result<(), StoreError> {
    validate_id("project_id", project_id)?;
    if description.len() > MAX_PROJECT_DESCRIPTION_BYTES {
        return Err(invalid("Project description exceeds its bound"));
    }
    if icon.trim().len() > MAX_PROJECT_ICON_BYTES || icon.chars().any(char::is_control) {
        return Err(invalid("Project icon is invalid"));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use std::fs;

    use nodex_core_contracts::workspace::ProjectWorkspaceIntent;
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
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: ProjectWorkspaceIntent::CreateProject {
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
