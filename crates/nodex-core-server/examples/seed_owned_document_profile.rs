use std::path::PathBuf;

use nodex_core::document::{
    BlockDocumentSchema, DocumentBlockOperation, DocumentBlockUpdatePatch, OwnedDocumentModule,
    YrsDocumentEngine, prepare_document_operation_update,
};
use nodex_core::infrastructure::sqlite::with_immediate_transaction;
use nodex_core::infrastructure::store::SqliteStoreKernel;
use nodex_core::library::LibraryModule;
use nodex_core::workspace::ProjectWorkspaceModule;
use nodex_core_contracts::document::{
    OwnedDocumentIntent, OwnedDocumentRead, OwnedDocumentReadValue,
};
use nodex_core_contracts::library::{
    LibraryIntent, LibraryPageLifecycleMutation, LibraryPageWorkflowStatus,
};
use nodex_core_contracts::workspace::{ProjectWorkspaceIntent, ProjectWorkspaceStarterPage};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, LIBRARY_CONTRACT_VERSION, LibraryId, ModuleApplyRequest,
    ModuleReadRequest, OWNED_DOCUMENT_CONTRACT_VERSION, PROJECT_WORKSPACE_CONTRACT_VERSION,
    ProfileId, ProjectId, StoreEpoch,
};
use serde_json::json;

const PROFILE_ID: &str = "profile:core-renderer-test";
const LIBRARY_ID: &str = "probe-library";
const PROJECT_ID: &str = "project:core-renderer-test";
const OWNER_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000101";
const DOCUMENT_ID: &str = "document:019bf52d-6870-7000-8000-000000000101";
const STORE_EPOCH: &str = "epoch:core-renderer-test";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: seed_owned_document_profile <absolute-profile-home>")?;
    let kernel = SqliteStoreKernel::open(&home)?;
    kernel.writer().call(|connection| {
        with_immediate_transaction(connection, |transaction| {
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at) VALUES (?1, \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [PROFILE_ID],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at) VALUES (?1, ?2, \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [LIBRARY_ID, PROFILE_ID],
            )?;
            transaction.execute(
                "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                 VALUES (1, ?1, \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [STORE_EPOCH],
            )?;
            Ok(())
        })
    })?;

    let context = BoundModuleContext {
        profile_id: ProfileId(PROFILE_ID.to_owned()),
        library_id: LibraryId(LIBRARY_ID.to_owned()),
        project_id: Some(ProjectId(PROJECT_ID.to_owned())),
        connection_id: "seed:renderer".to_owned(),
        adapter: AdapterKind::Test,
    };
    let workspace = ProjectWorkspaceModule::new(PROFILE_ID, LIBRARY_ID, &kernel)
        .map_err(|error| std::io::Error::other(error.message))?;
    workspace
        .apply(
            &context,
            ModuleApplyRequest {
                contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                operation_id: "seed:project".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: ProjectWorkspaceIntent::CreateInitialProject {
                    project_id: PROJECT_ID.to_owned(),
                    name: "Core renderer test".to_owned(),
                    description: String::new(),
                    appearance: None,
                    source_roots: vec![home.join("source").to_string_lossy().into_owned()],
                    starter_page: ProjectWorkspaceStarterPage {
                        page_id: "page:core-renderer-getting-started".to_owned(),
                        document_id: "document:core-renderer-getting-started".to_owned(),
                        title_markdown: "Welcome to Nodex".to_owned(),
                        nfm: "Welcome to Nodex.".to_owned(),
                    },
                },
            },
        )
        .map_err(|error| std::io::Error::other(error.message))?;

    let data_source_id = kernel.readers().read_default(|connection| {
        connection
            .query_row(
                "SELECT data_sources.id
             FROM projects
             JOIN data_sources
               ON data_sources.home_database_block_id = projects.database_block_id
             WHERE projects.id = ?1",
                [PROJECT_ID],
                |row| row.get::<_, String>(0),
            )
            .map_err(Into::into)
    })?;
    LibraryModule::new(PROFILE_ID, LIBRARY_ID, &kernel)
        .apply(
            &context,
            ModuleApplyRequest {
                contract_version: LIBRARY_CONTRACT_VERSION,
                operation_id: "seed:page".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: LibraryIntent::ApplyPageLifecycle {
                    mutation: Box::new(LibraryPageLifecycleMutation::CreatePage {
                        page_id: OWNER_BLOCK_ID.to_owned(),
                        title: String::new(),
                        rich_title: None,
                        nfm: "Seed body".to_owned(),
                        status: LibraryPageWorkflowStatus::Triage,
                        priority: None,
                        estimate: None,
                        due_date: None,
                        scheduled_start: None,
                        scheduled_end: None,
                        is_all_day: false,
                        recurrence: None,
                        reminders: Vec::new(),
                        schedule_timezone: None,
                        assignee: None,
                        run_in_target: "localProject".to_owned(),
                        run_in_local_path: None,
                        run_in_base_branch: None,
                        run_in_worktree_path: None,
                        run_in_environment_path: None,
                        before_block_id: None,
                        before_view_page_id: None,
                        data_source_id,
                        tag_option_ids: Vec::new(),
                        new_tag_options: Vec::new(),
                        expected_tags_property_revision: 1,
                    }),
                },
            },
        )
        .map_err(|error| std::io::Error::other(error.message))?;
    let root_block_id = kernel.readers().read_default(|connection| {
        let block_tree = connection.query_row(
            "SELECT block_tree_json FROM document_materializations WHERE document_id = ?1",
            [DOCUMENT_ID],
            |row| row.get::<_, String>(0),
        )?;
        let block_tree = serde_json::from_str::<serde_json::Value>(&block_tree).map_err(|_| {
            nodex_core::infrastructure::sqlite::StoreError::new(
                nodex_core::infrastructure::sqlite::StoreErrorCode::StoreCorrupt,
                "seed Page Block tree is invalid",
                false,
            )
        })?;
        block_tree
            .as_array()
            .and_then(|blocks| blocks.first())
            .and_then(|block| block.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| {
                nodex_core::infrastructure::sqlite::StoreError::new(
                    nodex_core::infrastructure::sqlite::StoreErrorCode::StoreCorrupt,
                    "seed Page has no editable root",
                    false,
                )
            })
    })?;
    let document_module = OwnedDocumentModule::new(PROFILE_ID, LIBRARY_ID, &kernel);
    let sync = document_module
        .read(
            &context,
            ModuleReadRequest {
                contract_version: OWNED_DOCUMENT_CONTRACT_VERSION,
                read: OwnedDocumentRead::SyncYjs {
                    document_id: DOCUMENT_ID.to_owned(),
                    state_vector: Vec::new(),
                },
            },
        )
        .map_err(|error| std::io::Error::other(error.message))?;
    let OwnedDocumentReadValue::YjsSync { update, .. } = sync.value else {
        return Err("seed Page did not return Yjs state".into());
    };
    let engine = YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &update)?;
    let prepared = prepare_document_operation_update(
        DOCUMENT_ID,
        BlockDocumentSchema::PageV2,
        &engine.full_state_v1(),
        &engine.state_vector_v1(),
        &[DocumentBlockOperation::UpdateBlock {
            block_id: root_block_id.clone(),
            patch: DocumentBlockUpdatePatch {
                block_type: None,
                props: None,
                content: Some(json!([{
                    "type": "text",
                    "text": "Base body",
                    "styles": {},
                }])),
                unset_content: false,
            },
        }],
        false,
    )
    .map_err(|error| std::io::Error::other(error.to_string()))?;
    document_module
        .apply(
            &context,
            ModuleApplyRequest {
                contract_version: OWNED_DOCUMENT_CONTRACT_VERSION,
                operation_id: "seed:body".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: OwnedDocumentIntent::ApplyYjsUpdate {
                    document_id: DOCUMENT_ID.to_owned(),
                    generation: 1,
                    base_head_seq: 1,
                    update_id: "seed:body".to_owned(),
                    touched_block_ids: vec![root_block_id.clone()],
                    update: prepared.update_v1,
                },
            },
        )
        .map_err(|error| std::io::Error::other(error.message))?;
    println!(
        "{}",
        json!({
            "projectId": PROJECT_ID,
            "ownerBlockId": OWNER_BLOCK_ID,
            "documentId": DOCUMENT_ID,
            "rootBlockId": root_block_id,
            "storeEpoch": STORE_EPOCH,
        })
    );
    Ok(())
}
