use std::fs;

use nodex_core_contracts::workspace::{
    ProjectSessionIntent, ProjectWorkspaceIntent, ProjectWorkspaceRead, ProjectWorkspaceReadValue,
    ProjectWorkspaceThreadPatch,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, LibraryId, ModuleApplyRequest, ModuleReadRequest,
    PROJECT_WORKSPACE_CONTRACT_VERSION, ProfileId, ProjectId, StoreEpoch,
};
use tempfile::{TempDir, tempdir};

use crate::infrastructure::sqlite::with_immediate_transaction;
use crate::infrastructure::store::SqliteStoreKernel;

use super::ProjectWorkspaceModule;

pub(super) const NOW: &str = "2026-07-19T06:00:00.000Z";

pub(super) struct TestWorkspace {
    pub _directory: TempDir,
    pub kernel: SqliteStoreKernel,
    pub module: ProjectWorkspaceModule,
}

pub(super) fn context() -> BoundModuleContext {
    BoundModuleContext {
        profile_id: ProfileId("profile-1".to_owned()),
        library_id: LibraryId("library-1".to_owned()),
        project_id: Some(ProjectId("project:default".to_owned())),
        connection_id: "connection:workspace-sidebar-search".to_owned(),
        adapter: AdapterKind::Test,
    }
}

pub(super) fn seeded_workspace() -> TestWorkspace {
    let directory = tempdir().expect("Profile");
    let home = directory.path().canonicalize().expect("absolute Profile");
    fs::create_dir(home.join("assets")).expect("assets root");
    let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
    kernel
        .writer()
        .call(|connection| {
            with_immediate_transaction(connection, |transaction| {
                transaction.execute(
                    "INSERT INTO profiles(id, created_at, updated_at)
                     VALUES ('profile-1', ?1, ?1)",
                    [NOW],
                )?;
                transaction.execute(
                    "INSERT INTO libraries(id, profile_id, created_at, updated_at)
                     VALUES ('library-1', 'profile-1', ?1, ?1)",
                    [NOW],
                )?;
                transaction.execute(
                    "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at)
                     VALUES (1, 'epoch-1', ?1, ?1)",
                    [NOW],
                )?;
                Ok(())
            })
        })
        .expect("seed Workspace identity");
    let module =
        ProjectWorkspaceModule::new("profile-1", "library-1", &kernel).expect("Workspace module");
    TestWorkspace {
        _directory: directory,
        kernel,
        module,
    }
}

pub(super) fn request(
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

pub(super) fn apply(
    module: &ProjectWorkspaceModule,
    operation_id: &str,
    intent: ProjectWorkspaceIntent,
) {
    module
        .apply(&context(), request(operation_id, intent))
        .expect("Workspace mutation");
}

pub(super) fn read(
    module: &ProjectWorkspaceModule,
    read: ProjectWorkspaceRead,
) -> ProjectWorkspaceReadValue {
    module
        .read(
            &context(),
            ModuleReadRequest {
                contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                read,
            },
        )
        .expect("Workspace read")
        .value
}

pub(super) fn create_project(
    module: &ProjectWorkspaceModule,
    operation_id: &str,
    project_id: &str,
) {
    apply(
        module,
        operation_id,
        ProjectWorkspaceIntent::CreateProject {
            project_id: project_id.to_owned(),
            name: project_id.to_owned(),
            description: String::new(),
            appearance: None,
            source_roots: vec![format!("/workspace/{project_id}")],
        },
    );
}

pub(super) fn create_session_thread(
    module: &ProjectWorkspaceModule,
    prefix: &str,
    session_id: &str,
    thread_id: &str,
    project_id: Option<&str>,
    updated_at: i64,
) {
    apply(
        module,
        &format!("{prefix}-session"),
        ProjectWorkspaceIntent::CreateSession {
            session_id: session_id.to_owned(),
            project_id: project_id.map(str::to_owned),
            title: thread_id.to_owned(),
        },
    );
    apply(
        module,
        &format!("{prefix}-thread"),
        ProjectWorkspaceIntent::UpsertThread {
            thread_id: thread_id.to_owned(),
            patch: Box::new(ProjectWorkspaceThreadPatch {
                project_id: Some(project_id.map(str::to_owned)),
                thread_name: Some(Some(thread_id.to_owned())),
                thread_preview: Some(format!("{thread_id} preview")),
                model_provider: Some("openai".to_owned()),
                created_at: Some(updated_at),
                updated_at: Some(updated_at),
                linked_at: Some(NOW.to_owned()),
                ..ProjectWorkspaceThreadPatch::default()
            }),
        },
    );
    apply(
        module,
        &format!("{prefix}-link"),
        ProjectWorkspaceIntent::MutateSession {
            session_id: session_id.to_owned(),
            intent: ProjectSessionIntent::LinkThread {
                thread_id: thread_id.to_owned(),
                expected_project_id: project_id.map(str::to_owned),
                thread_patch: None,
            },
        },
    );
}
