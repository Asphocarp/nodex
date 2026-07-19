use std::path::PathBuf;

use nodex_core::document::{
    BlockDocumentSchema, DocumentBlockOperation, DocumentBlockUpdatePatch, OwnedDocumentModule,
    YrsDocumentEngine, prepare_document_operation_update,
};
use nodex_core::infrastructure::sqlite::with_immediate_transaction;
use nodex_core::infrastructure::store::SqliteStoreKernel;
use nodex_core_contracts::document::{
    OwnedDocumentIntent, OwnedDocumentRead, OwnedDocumentReadValue,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, LibraryId, ModuleApplyRequest,
    ModuleReadRequest, ProfileId, ProjectId, StoreEpoch,
};
use serde_json::json;

const PROFILE_ID: &str = "profile:core-renderer-test";
const LIBRARY_ID: &str = "probe-library";
const PROJECT_ID: &str = "project:core-renderer-test";
const OWNER_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000101";
const DOCUMENT_ID: &str = "019bf52d-6870-7000-8000-000000000102";
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
                "INSERT INTO projects(id, library_id, name, created, updated) \
                 VALUES (?1, ?2, 'Core renderer test', \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [PROJECT_ID, LIBRARY_ID],
            )?;
            transaction.execute(
                "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                 VALUES (1, ?1, \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [STORE_EPOCH],
            )?;
            transaction.execute(
                "INSERT INTO blocks(\
                   id, project_id, type, lifecycle, location_kind, containing_document_id, \
                   containing_database_id, location_revision, metadata_revision, created_at, updated_at\
                 ) VALUES (?1, ?2, 'page', 'active', 'space', NULL, NULL, 1, 1, \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [OWNER_BLOCK_ID, PROJECT_ID],
            )?;
            transaction.execute(
                "INSERT INTO documents(\
                   id, project_id, generation, head_seq, schema_key, schema_version, \
                   state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine\
                 ) VALUES (?1, ?2, 1, 0, 'nodex.page', 2, X'', '', \
                   'pending_genesis', 'legacy_shadow', \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'yjs')",
                [DOCUMENT_ID, PROJECT_ID],
            )?;
            transaction.execute(
                "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                 VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [OWNER_BLOCK_ID, DOCUMENT_ID, PROJECT_ID],
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
    let module = OwnedDocumentModule::new(PROFILE_ID, LIBRARY_ID, &kernel);
    module
        .apply(
            &context,
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: "seed:prepare-page".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: OwnedDocumentIntent::PrepareOwner {
                    owner_block_id: OWNER_BLOCK_ID.to_owned(),
                },
            },
        )
        .map_err(|error| std::io::Error::other(error.message))?;
    let sync = module
        .read(
            &context,
            ModuleReadRequest {
                version: CORE_CONTRACT_VERSION,
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
    module
        .apply(
            &context,
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
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
