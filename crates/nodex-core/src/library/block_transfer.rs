use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use nodex_core_contracts::library::{
    LibraryBlockLocation, LibraryBlockTransferDocumentCommit, LibraryBlockTransferDocumentHead,
    LibraryBlockTransferLogicalIntent, LibraryBlockTransferMembership, LibraryBlockTransferMode,
    LibraryBlockTransferPlan, LibraryBlockTransferPreparation, LibraryBlockTransferResult,
    LibraryBlockTransferSource, LibraryBlockTransferTarget, LibraryBlockTransferWriteFence,
    LibraryCommitValue, LibraryPageCopyDestination, LibraryPageCopyPositionAnchor,
    LibraryPageCopyValue, LibraryPageCopyViewPlacement, LibraryPlacementAnchor, LibraryReceipt,
};
use nodex_core_contracts::{BoundModuleContext, CommittedModuleValue};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::database::{
    ExistingPageTransferTarget, PageCopyDataSourceDestination, StagedPagePlacementRevisions,
    place_staged_page_in_data_source, resolve_page_copy_data_source_source,
    resolve_page_transfer_data_source_destination, resolve_page_transfer_data_source_source,
    transfer_existing_page_for_block_transfer,
};
use crate::document::{
    BlockDocumentSchema, DocumentAuthorityRow, DocumentBlockOperation, DocumentMaterialization,
    NewDocumentCheckpoint, PersistYjsCommit, PersistYjsGenesis, PortableSubtreeDocumentHead,
    PortableSubtreeTransferKind, PortableSubtreeTransferRequest, PreparedDocumentOperationUpdate,
    YrsDocumentEngine, decode_block_document, insert_document_checkpoint,
    materialize_decoded_document, persist_yjs_commit, persist_yjs_genesis,
    prepare_document_operation_update, prepare_portable_subtree_transfer_updates,
    prepare_yjs_clone_genesis, read_document_authority, reconstruct_yjs_engine, sha256,
};
use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::block_to_page::{
    BlockToPageTransformation, PageWrapperReason, plan_block_to_page_transformation,
};
use crate::domain::identity::stable_uuid_v7;
use crate::domain::subtree::BlockSubtreeInsertionTarget;
use crate::infrastructure::module_receipts::read_module_receipt;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::LibraryApplyOutcome;
use super::mutation::{
    MutationEffects, append_rank, ensure_default_page_intrinsic_properties, finish_mutation,
    insert_library_placement, insert_page_read_model, refresh_page_intrinsic_projection,
    require_project_in_library, sqlite_now,
};
use super::page_copy::{
    PageCopyParentDocumentMode, execute_page_copy, page_copy_closure_document_heads,
};

const MODULE_NAME: &str = "library";
const MAX_ID_LENGTH: usize = 512;
const MAX_TRANSFER_ROOTS: usize = 10_000;
const MAX_ACTOR_BYTES: usize = 64 * 1024;
const TRANSFER_CLIENT_SESSION_ID: &str = "rust:block-transfer";

struct PreparedTransfer {
    source_authority: DocumentAuthorityRow,
    target_authority: DocumentAuthorityRow,
    source_engine: YrsDocumentEngine,
    target_engine: YrsDocumentEngine,
    source_materialization: DocumentMaterialization,
    target_materialization: DocumentMaterialization,
    prepared: crate::document::PreparedPortableSubtreeTransfer,
    expected_location_revisions: BTreeMap<String, i64>,
}

struct PersistedTransferCommit {
    public: LibraryBlockTransferDocumentCommit,
    materialization: DocumentMaterialization,
}

struct PreparedPageParentTransfer {
    source_authority: DocumentAuthorityRow,
    source_engine: YrsDocumentEngine,
    source_materialization: DocumentMaterialization,
    source_update: Option<PreparedDocumentOperationUpdate>,
    roots: Vec<PreparedPageParentRoot>,
    expected_location_revisions: BTreeMap<String, i64>,
    copied_block_ids: BTreeMap<String, String>,
    target_project_id: String,
    target: PreparedPageParentTarget,
}

enum PreparedPageParentTarget {
    Library {
        before_block_id: Option<String>,
    },
    DataSource {
        database_id: String,
        destination: PageCopyDataSourceDestination,
    },
}

struct PreparedPageParentRoot {
    source_root_id: String,
    source_block_ids: Vec<String>,
    page_id: String,
    document_id: String,
    transformation: BlockToPageTransformation,
    source_to_result_block_ids: BTreeMap<String, String>,
}

struct PreparedPageOwnershipTransfer {
    roots: Vec<PreparedPageOwnershipRoot>,
    source: PreparedPageOwnershipSource,
    target: PreparedPageOwnershipTarget,
    source_document: Option<PreparedPageOwnershipDocument>,
    target_document: Option<PreparedPageOwnershipDocument>,
    copy_document_heads: Vec<LibraryBlockTransferDocumentHead>,
    copy_destination: Option<LibraryPageCopyDestination>,
}

struct PreparedPageOwnershipRoot {
    page_id: String,
    project_id: String,
    location_revision: i64,
    parent_revision: i64,
    source_membership: Option<LibraryBlockTransferMembership>,
    shell: MaterializedBlockNode,
    owned_document_id: String,
    owned_document_generation: i64,
    owned_document_head_seq: i64,
}

struct PreparedPageOwnershipDocument {
    authority: DocumentAuthorityRow,
    engine: YrsDocumentEngine,
    base_materialization: DocumentMaterialization,
    update: PreparedDocumentOperationUpdate,
}

struct PageOwnershipDocumentBase {
    authority: DocumentAuthorityRow,
    engine: YrsDocumentEngine,
    base_materialization: DocumentMaterialization,
    schema: BlockDocumentSchema,
    page_id: String,
}

enum PreparedPageOwnershipSource {
    Library,
    DataSource {
        database_id: String,
        data_source_id: String,
    },
    Document {
        document_id: String,
        page_id: String,
    },
}

enum PreparedPageOwnershipTarget {
    Library {
        before_block_id: Option<String>,
    },
    DataSource {
        database_id: String,
        destination: PageCopyDataSourceDestination,
    },
    Document {
        document_id: String,
        page_id: String,
        parent_block_id: Option<String>,
        before_block_id: Option<String>,
    },
}

#[derive(Clone, Copy)]
enum TransferDocumentAccess {
    Read,
    Write,
}

type FinalBlockLocations = (
    BTreeMap<String, LibraryBlockLocation>,
    BTreeMap<String, i64>,
);

pub(super) fn semantic_request_hash(
    context: &BoundModuleContext,
    store_epoch: &str,
    intent: &LibraryBlockTransferLogicalIntent,
) -> Result<String, StoreError> {
    let fingerprint = serde_json::to_vec(&(
        &context.profile_id,
        &context.library_id,
        &context.project_id,
        store_epoch,
        intent,
    ))
    .map_err(|_| internal("Block transfer intent cannot be fingerprinted"))?;
    Ok(sha256(&fingerprint))
}

pub(super) fn plan(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    store_epoch: &str,
    intent: &LibraryBlockTransferLogicalIntent,
) -> Result<LibraryBlockTransferPlan, StoreError> {
    validate_id(operation_id, "operation_id")?;
    validate_intent(library_id, intent)?;
    let current_epoch = crate::document::read_store_epoch(connection)?;
    if current_epoch != store_epoch {
        return Err(StoreError::new(
            StoreErrorCode::StaleStoreEpoch,
            "Block transfer targets a stale store epoch",
            true,
        ));
    }
    let request_hash = semantic_request_hash(context, store_epoch, intent)?;
    if let Some(stored) = read_module_receipt(connection, MODULE_NAME, operation_id)? {
        if stored.request_hash != request_hash {
            return Err(StoreError::new(
                StoreErrorCode::IdempotencyKeyReused,
                "operation_id is already bound to another Block transfer",
                false,
            ));
        }
        let committed = serde_json::from_value::<
            CommittedModuleValue<LibraryCommitValue, LibraryReceipt>,
        >(stored.result)
        .map_err(|_| corrupt("Stored Block transfer receipt is invalid"))?;
        let result = committed
            .value
            .block_transfer
            .ok_or_else(|| corrupt("Stored Library receipt is not a Block transfer"))?;
        return Ok(LibraryBlockTransferPlan::Committed {
            result,
            change_log_seq: committed.receipt.change_log_seq,
            committed_at: committed.receipt.committed_at,
        });
    }
    if uses_page_ownership_parent_compiler(connection, intent)? {
        let prepared =
            prepare_page_ownership_transfer(connection, context, library_id, operation_id, intent)?;
        return Ok(LibraryBlockTransferPlan::Prepared {
            preparation: page_ownership_preparation(&prepared),
        });
    }
    if matches!(
        intent.target,
        LibraryBlockTransferTarget::Library { .. } | LibraryBlockTransferTarget::DataSource { .. }
    ) {
        let prepared =
            prepare_page_parent_transfer(connection, context, library_id, operation_id, intent)?;
        return Ok(LibraryBlockTransferPlan::Prepared {
            preparation: page_parent_preparation(&prepared),
        });
    }
    let prepared = prepare_transfer(connection, context, library_id, operation_id, intent)?;
    Ok(LibraryBlockTransferPlan::Prepared {
        preparation: preparation(&prepared),
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn apply(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    store_epoch: &str,
    request_hash: &str,
    intent: &LibraryBlockTransferLogicalIntent,
    write_fence: Option<&LibraryBlockTransferWriteFence>,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_intent(library_id, intent)?;
    if uses_page_ownership_parent_compiler(connection, intent)? {
        return apply_page_ownership_transfer(
            connection,
            context,
            library_id,
            operation_id,
            store_epoch,
            request_hash,
            intent,
            write_fence,
            assets_root,
        );
    }
    if matches!(
        intent.target,
        LibraryBlockTransferTarget::Library { .. } | LibraryBlockTransferTarget::DataSource { .. }
    ) {
        return apply_page_parent_transfer(
            connection,
            context,
            library_id,
            operation_id,
            store_epoch,
            request_hash,
            intent,
            write_fence,
        );
    }
    let mut prepared = prepare_transfer(connection, context, library_id, operation_id, intent)?;
    let expected_preparation = preparation(&prepared);
    if write_fence != Some(&expected_preparation.write_fence) {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Block transfer requires a trusted exact-closure write fence",
            true,
        ));
    }

    let source_pre_state_vector = prepared.source_engine.state_vector_v1();
    let source_pre_full_state = prepared.source_engine.full_state_v1();
    let source_pre_state_hash = sha256(&source_pre_full_state);
    let inserted_ids = prepared.prepared.inserted_forest.block_ids.clone();
    if intent.mode == LibraryBlockTransferMode::Copy {
        assert_fresh_copy_identities(connection, &inserted_ids)?;
    }

    let moves_between_documents = intent.mode == LibraryBlockTransferMode::Move
        && prepared.source_authority.head.id != prepared.target_authority.head.id;
    if moves_between_documents {
        relocate_registry_blocks(connection, &prepared, &prepared.target_authority.head.id)?;
    }

    let source_update = prepared.prepared.source.take();
    let target_update = prepared.prepared.target.clone();
    let mut document_commits = Vec::new();
    if let Some(source_update) = source_update {
        let update_id = format!("relocation:{request_hash}:source");
        let commit = persist_prepared_update(
            connection,
            &prepared.source_authority,
            &prepared.source_materialization,
            &mut prepared.source_engine,
            source_update,
            &update_id,
            store_epoch,
        )?;
        document_commits.push(commit);
    }
    let target_update_id = if moves_between_documents {
        format!("relocation:{request_hash}:target")
    } else {
        format!("block-transfer:{request_hash}:target")
    };
    let target_commit = persist_prepared_update(
        connection,
        &prepared.target_authority,
        &prepared.target_materialization,
        &mut prepared.target_engine,
        target_update,
        &target_update_id,
        store_epoch,
    )?;
    document_commits.push(target_commit);

    let result_block_ids = prepared.prepared.inserted_forest.block_ids.clone();
    let result_root_block_ids = prepared.prepared.inserted_forest.root_block_ids.clone();
    let copied_block_ids = if intent.mode == LibraryBlockTransferMode::Copy {
        prepared
            .prepared
            .source_forest
            .block_ids
            .iter()
            .cloned()
            .zip(result_block_ids.iter().cloned())
            .collect()
    } else {
        BTreeMap::new()
    };
    let (final_locations, final_location_revisions) =
        read_final_locations(connection, &result_block_ids)?;
    let public_commits = document_commits
        .iter()
        .map(|commit| commit.public.clone())
        .collect::<Vec<_>>();
    let result = LibraryBlockTransferResult {
        mode: intent.mode,
        source_root_block_ids: intent.root_block_ids.clone(),
        result_root_block_ids,
        copied_block_ids,
        transformation_evidence: Vec::new(),
        final_locations,
        final_location_revisions: final_location_revisions.clone(),
        document_commits: public_commits,
        affected_database_ids: Vec::new(),
    };
    let now = sqlite_now(connection)?;
    let affected_page_ids = affected_page_ids(&prepared);
    let is_same_storage_relocation = moves_between_documents
        && prepared.source_authority.head.project_id == prepared.target_authority.head.project_id;
    let change_kind = if is_same_storage_relocation {
        "block_relocation"
    } else {
        "block_mutation"
    };
    let committed_revisions = final_location_revisions
        .iter()
        .map(|(block_id, revision)| (format!("blockLocation:{block_id}"), *revision))
        .chain(document_commits.iter().map(|commit| {
            (
                format!("documentHead:{}", commit.public.document_id),
                commit.public.head_seq,
            )
        }))
        .collect();
    let outcome = finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: prepared.target_authority.head.project_id.clone(),
            operation_kind: "transfer_blocks",
            change_kind,
            did_mutate: true,
            created_target: None,
            affected_parent_keys: Vec::new(),
            affected_block_ids: result_block_ids.clone(),
            affected_page_ids,
            affected_database_ids: Vec::new(),
            affected_view_ids: Vec::new(),
            affected_document_ids: expected_preparation
                .write_fence
                .documents
                .iter()
                .map(|head| head.document_id.clone())
                .collect(),
            committed_revisions,
            page_copy: None,
            block_transfer: Some(result.clone()),
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            change_payload: None,
            committed_at: now.clone(),
        },
    )?;

    if is_same_storage_relocation {
        persist_relocation_ledger(
            connection,
            operation_id,
            &prepared.source_authority.head.project_id,
            store_epoch,
            request_hash,
            intent,
            &prepared,
            &result,
            &final_location_revisions,
            &source_pre_state_vector,
            &source_pre_full_state,
            &source_pre_state_hash,
            outcome.committed.event_sequence,
            &now,
        )?;
    } else {
        persist_mutation_ledger(
            connection,
            operation_id,
            &prepared.target_authority.head.project_id,
            store_epoch,
            request_hash,
            intent,
            &result,
            outcome.committed.event_sequence,
            &now,
        )?;
    }
    persist_operation_checkpoints(
        connection,
        context,
        operation_id,
        &intent.actor,
        &document_commits,
        outcome.committed.event_sequence,
        &now,
    )?;
    Ok(outcome)
}

fn prepare_transfer(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    intent: &LibraryBlockTransferLogicalIntent,
) -> Result<PreparedTransfer, StoreError> {
    let project_id = bound_project_id(context)?;
    let source_page_id = match &intent.source {
        LibraryBlockTransferSource::Page { page_id } => Some(page_id.as_str()),
        _ => None,
    };
    let target_page_id = match &intent.target {
        LibraryBlockTransferTarget::Page { page_id, .. } => Some(page_id.as_str()),
        _ => None,
    };
    let source_document_id = resolve_source_document(connection, library_id, &intent.source)?;
    let (target_document_id, insertion) =
        resolve_target_document(connection, library_id, &intent.target)?;
    if intent.mode == LibraryBlockTransferMode::Move && source_document_id == target_document_id {
        return Err(invalid(
            "Move within one Document uses a stable-ID Document operation",
        ));
    }
    let source_authority = require_transfer_authority(
        connection,
        library_id,
        project_id,
        &source_document_id,
        source_page_id,
        match intent.mode {
            LibraryBlockTransferMode::Move => TransferDocumentAccess::Write,
            LibraryBlockTransferMode::Copy => TransferDocumentAccess::Read,
        },
    )?;
    let target_authority = require_transfer_authority(
        connection,
        library_id,
        project_id,
        &target_document_id,
        target_page_id,
        TransferDocumentAccess::Write,
    )?;
    let source_schema = require_schema(&source_authority)?;
    let target_schema = require_schema(&target_authority)?;
    let source_engine = reconstruct_yjs_engine(connection, &source_authority.head)?;
    let target_engine = reconstruct_yjs_engine(connection, &target_authority.head)?;
    let source_decoded = decode_block_document(source_engine.document(), source_schema)
        .map_err(|error| corrupt(error.to_string()))?;
    let source_materialization = materialize_decoded_document(&source_decoded)
        .map_err(|error| corrupt(error.to_string()))?;
    let target_decoded = decode_block_document(target_engine.document(), target_schema)
        .map_err(|error| corrupt(error.to_string()))?;
    let target_materialization = materialize_decoded_document(&target_decoded)
        .map_err(|error| corrupt(error.to_string()))?;
    let expected_location_revisions = validate_source_roots(
        connection,
        &source_authority.head.project_id,
        &source_document_id,
        &intent.root_block_ids,
    )?;
    let request = PortableSubtreeTransferRequest {
        kind: match intent.mode {
            LibraryBlockTransferMode::Move => PortableSubtreeTransferKind::Move,
            LibraryBlockTransferMode::Copy => PortableSubtreeTransferKind::Copy,
        },
        source: PortableSubtreeDocumentHead {
            document_id: source_document_id,
            schema: source_schema,
            full_state_v1: source_engine.full_state_v1(),
            expected_state_vector_v1: source_engine.state_vector_v1(),
        },
        target: PortableSubtreeDocumentHead {
            document_id: target_document_id,
            schema: target_schema,
            full_state_v1: target_engine.full_state_v1(),
            expected_state_vector_v1: target_engine.state_vector_v1(),
        },
        root_block_ids: intent.root_block_ids.clone(),
        insertion,
    };
    let mut allocate = |source_id: &str| stable_uuid_v7(operation_id, "block_transfer", source_id);
    let prepared = prepare_portable_subtree_transfer_updates(&request, &mut allocate)
        .map_err(|error| invalid(error.to_string()))?;
    for block_id in &prepared.source_forest.block_ids {
        if is_typed_resource(connection, block_id)? {
            return Err(invalid(
                "This native slice transfers ordinary Blocks only; Page ownership uses Library or Database semantics",
            ));
        }
    }
    Ok(PreparedTransfer {
        source_authority,
        target_authority,
        source_engine,
        target_engine,
        source_materialization,
        target_materialization,
        prepared,
        expected_location_revisions,
    })
}

fn uses_page_ownership_parent_compiler(
    connection: &Connection,
    intent: &LibraryBlockTransferLogicalIntent,
) -> Result<bool, StoreError> {
    if matches!(
        intent.source,
        LibraryBlockTransferSource::Library { .. } | LibraryBlockTransferSource::DataSource { .. }
    ) {
        return Ok(true);
    }
    for block_id in &intent.root_block_ids {
        let block_type = connection
            .query_row("SELECT type FROM blocks WHERE id = ?1", [block_id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?;
        if block_type.as_deref() == Some("page") {
            return Ok(true);
        }
    }
    Ok(false)
}

fn load_page_ownership_document(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    document_id: &str,
    access: TransferDocumentAccess,
) -> Result<PageOwnershipDocumentBase, StoreError> {
    let authority = require_transfer_authority(
        connection,
        library_id,
        bound_project_id(context)?,
        document_id,
        None,
        access,
    )?;
    if authority.owner_type != "page" || !authority.head.is_live_yjs_authority() {
        return Err(invalid(
            "Page ownership transfer requires a live Page Document parent",
        ));
    }
    let schema = BlockDocumentSchema::from_identity(
        &authority.head.schema_key,
        authority.head.schema_version,
    )
    .filter(|schema| schema.has_title())
    .ok_or_else(|| corrupt("Page parent has an unsupported Document schema"))?;
    let engine = reconstruct_yjs_engine(connection, &authority.head)?;
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|error| corrupt(format!("Page parent schema is invalid: {error}")))?;
    let base_materialization = materialize_decoded_document(&decoded)
        .map_err(|error| corrupt(format!("Page parent cannot materialize: {error}")))?;
    Ok(PageOwnershipDocumentBase {
        page_id: authority.owner_block_id.clone(),
        authority,
        engine,
        base_materialization,
        schema,
    })
}

fn prepare_page_ownership_document_update(
    base: PageOwnershipDocumentBase,
    operations: &[DocumentBlockOperation],
) -> Result<PreparedPageOwnershipDocument, StoreError> {
    let full_state = base.engine.full_state_v1();
    let update = prepare_document_operation_update(
        &base.authority.head.id,
        base.schema,
        &full_state,
        &base.authority.head.state_vector,
        operations,
        false,
    )
    .map_err(|error| invalid(format!("Page parent update is invalid: {error}")))?;
    Ok(PreparedPageOwnershipDocument {
        authority: base.authority,
        engine: base.engine,
        base_materialization: base.base_materialization,
        update,
    })
}

fn embedded_page_shell(page_id: &str) -> MaterializedBlockNode {
    MaterializedBlockNode {
        id: page_id.to_owned(),
        block_type: "page".to_owned(),
        props: BTreeMap::new(),
        content: None,
        children: Vec::new(),
    }
}

fn prepare_page_ownership_transfer(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    intent: &LibraryBlockTransferLogicalIntent,
) -> Result<PreparedPageOwnershipTransfer, StoreError> {
    let requesting_project_id = bound_project_id(context)?;
    require_project_in_library(connection, requesting_project_id, library_id)?;
    let mut source_document_base = None;
    let source = match &intent.source {
        LibraryBlockTransferSource::Library {
            library_id: source_library_id,
        } => {
            if source_library_id != library_id {
                return Err(unauthorized(
                    "Block transfer source belongs to another Library",
                ));
            }
            PreparedPageOwnershipSource::Library
        }
        LibraryBlockTransferSource::DataSource { data_source_id } => {
            let resolved = if intent.mode == LibraryBlockTransferMode::Copy {
                resolve_page_copy_data_source_source(connection, library_id, data_source_id)?
            } else {
                resolve_page_transfer_data_source_source(
                    connection,
                    library_id,
                    requesting_project_id,
                    data_source_id,
                )?
            };
            if intent.mode == LibraryBlockTransferMode::Move
                && resolved.project_id != requesting_project_id
            {
                return Err(unauthorized(
                    "Block transfer source Data Source belongs to another Project",
                ));
            }
            PreparedPageOwnershipSource::DataSource {
                database_id: resolved.database_id,
                data_source_id: resolved.data_source_id,
            }
        }
        LibraryBlockTransferSource::Page { page_id } => {
            let document_id = resolve_page_document(connection, library_id, page_id)?;
            let base = load_page_ownership_document(
                connection,
                context,
                library_id,
                &document_id,
                if intent.mode == LibraryBlockTransferMode::Copy {
                    TransferDocumentAccess::Read
                } else {
                    TransferDocumentAccess::Write
                },
            )?;
            if base.page_id != *page_id {
                return Err(corrupt("Source Page Document owner is inconsistent"));
            }
            source_document_base = Some(base);
            PreparedPageOwnershipSource::Document {
                document_id,
                page_id: page_id.clone(),
            }
        }
        LibraryBlockTransferSource::Document { document_id } => {
            let base = load_page_ownership_document(
                connection,
                context,
                library_id,
                document_id,
                if intent.mode == LibraryBlockTransferMode::Copy {
                    TransferDocumentAccess::Read
                } else {
                    TransferDocumentAccess::Write
                },
            )?;
            let page_id = base.page_id.clone();
            source_document_base = Some(base);
            PreparedPageOwnershipSource::Document {
                document_id: document_id.clone(),
                page_id,
            }
        }
    };
    let mut target_document_base = None;
    let target = match &intent.target {
        LibraryBlockTransferTarget::Library {
            library_id: target_library_id,
            before_block_id,
        } => {
            if target_library_id != library_id {
                return Err(unauthorized(
                    "Block transfer target belongs to another Library",
                ));
            }
            if before_block_id
                .as_ref()
                .is_some_and(|anchor| intent.root_block_ids.contains(anchor))
            {
                return Err(invalid("A moved Page cannot be its own placement anchor"));
            }
            if let Some(anchor) = before_block_id {
                read_library_anchor(connection, library_id, anchor)?;
            }
            PreparedPageOwnershipTarget::Library {
                before_block_id: before_block_id.clone(),
            }
        }
        LibraryBlockTransferTarget::DataSource {
            data_source_id,
            view_id,
            group_key,
            before_page_id,
        } => {
            if before_page_id
                .as_ref()
                .is_some_and(|anchor| intent.root_block_ids.contains(anchor))
            {
                return Err(invalid("A moved Page cannot be its own placement anchor"));
            }
            let resolved = resolve_page_transfer_data_source_destination(
                connection,
                library_id,
                requesting_project_id,
                data_source_id,
                view_id,
                group_key.as_deref(),
                before_page_id.as_deref(),
            )?;
            if resolved.project_id != requesting_project_id {
                return Err(unauthorized(
                    "Existing Page transfer cannot cross Project ownership",
                ));
            }
            PreparedPageOwnershipTarget::DataSource {
                database_id: resolved.database_id,
                destination: resolved.destination,
            }
        }
        LibraryBlockTransferTarget::Page {
            page_id,
            parent_block_id,
            before_block_id,
        } => {
            let document_id = resolve_page_document(connection, library_id, page_id)?;
            let base = load_page_ownership_document(
                connection,
                context,
                library_id,
                &document_id,
                TransferDocumentAccess::Write,
            )?;
            if base.page_id != *page_id {
                return Err(corrupt("Target Page Document owner is inconsistent"));
            }
            target_document_base = Some(base);
            PreparedPageOwnershipTarget::Document {
                document_id,
                page_id: page_id.clone(),
                parent_block_id: parent_block_id.clone(),
                before_block_id: before_block_id.clone(),
            }
        }
        LibraryBlockTransferTarget::Document {
            document_id,
            parent_block_id,
            before_block_id,
        } => {
            let base = load_page_ownership_document(
                connection,
                context,
                library_id,
                document_id,
                TransferDocumentAccess::Write,
            )?;
            let page_id = base.page_id.clone();
            target_document_base = Some(base);
            PreparedPageOwnershipTarget::Document {
                document_id: document_id.clone(),
                page_id,
                parent_block_id: parent_block_id.clone(),
                before_block_id: before_block_id.clone(),
            }
        }
    };
    if intent.mode == LibraryBlockTransferMode::Move
        && (matches!(
            (&source, &target),
            (
                PreparedPageOwnershipSource::Library,
                PreparedPageOwnershipTarget::Library { .. }
            )
        ) || matches!(
            (&source, &target),
            (
                PreparedPageOwnershipSource::DataSource { data_source_id: source, .. },
                PreparedPageOwnershipTarget::DataSource { destination, .. }
            ) if source == &destination.data_source_id
        ) || matches!(
            (&source, &target),
            (
                PreparedPageOwnershipSource::Document { document_id: source, .. },
                PreparedPageOwnershipTarget::Document { document_id: target, .. }
            ) if source == target
        ))
    {
        return Err(invalid("Page already belongs to the requested parent"));
    }
    if intent.mode == LibraryBlockTransferMode::Move
        && let PreparedPageOwnershipTarget::Document {
            page_id: target_page_id,
            ..
        } = &target
    {
        for root_page_id in &intent.root_block_ids {
            let cycle = connection
                .query_row(
                    "WITH RECURSIVE descendants(page_id) AS ( \
                       SELECT ?1 UNION ALL \
                       SELECT page.block_id FROM pages page JOIN descendants parent \
                         ON page.parent_kind = 'page' AND page.parent_id = parent.page_id \
                       WHERE page.lifecycle = 'active' \
                     ) SELECT 1 FROM descendants WHERE page_id = ?2 LIMIT 1",
                    params![root_page_id, target_page_id],
                    |_| Ok(()),
                )
                .optional()?;
            if cycle.is_some() {
                return Err(invalid("A Page cannot move below its ownership subtree"));
            }
        }
    }

    let mut roots = Vec::with_capacity(intent.root_block_ids.len());
    for page_id in &intent.root_block_ids {
        let row = connection
            .query_row(
                "SELECT block.project_id, block.type, block.lifecycle, block.location_kind, \
                   block.containing_document_id, block.containing_database_id, \
                   block.location_revision, page.parent_kind, page.parent_id, \
                   page.parent_revision, page.lifecycle \
                 FROM blocks block LEFT JOIN pages page ON page.block_id = block.id \
                 WHERE block.id = ?1",
                [page_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<i64>>(9)?,
                        row.get::<_, Option<String>>(10)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| not_found(format!("Transferred Page does not exist: {page_id}")))?;
        let (
            project_id,
            block_type,
            block_lifecycle,
            location_kind,
            containing_document_id,
            containing_database_id,
            location_revision,
            parent_kind,
            parent_id,
            parent_revision,
            page_lifecycle,
        ) = row;
        if intent.mode == LibraryBlockTransferMode::Copy {
            super::require_page_read_access(
                connection,
                library_id,
                requesting_project_id,
                page_id,
            )?;
        } else if project_id != requesting_project_id {
            return Err(unauthorized("Transferred Page belongs to another Project"));
        }
        if block_type != "page"
            || block_lifecycle != "active"
            || page_lifecycle.as_deref() != Some("active")
        {
            return Err(invalid(
                "Page ownership transfer requires active Page roots",
            ));
        }
        let parent_revision =
            parent_revision.ok_or_else(|| corrupt("Page ownership root has no parent revision"))?;
        if parent_revision != location_revision {
            return Err(corrupt("Page parent and location revisions diverged"));
        }
        let source_membership = match &source {
            PreparedPageOwnershipSource::Library => {
                if location_kind != "space"
                    || containing_document_id.is_some()
                    || containing_database_id.is_some()
                    || parent_kind.as_deref() != Some("library")
                    || parent_id.as_deref() != Some(library_id)
                {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        format!("Page {page_id} no longer belongs to the source Library"),
                        true,
                    ));
                }
                None
            }
            PreparedPageOwnershipSource::DataSource {
                database_id,
                data_source_id,
            } => {
                if location_kind != "database"
                    || containing_document_id.is_some()
                    || containing_database_id.as_deref() != Some(database_id)
                    || parent_kind.as_deref() != Some("data_source")
                    || parent_id.as_deref() != Some(data_source_id)
                {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        format!("Page {page_id} no longer belongs to the source Data Source"),
                        true,
                    ));
                }
                let membership = connection
                    .query_row(
                        "SELECT id, revision FROM data_source_page_memberships \
                         WHERE page_block_id = ?1 AND data_source_id = ?2 \
                           AND removed_at IS NULL",
                        params![page_id, data_source_id],
                        |row| {
                            Ok(LibraryBlockTransferMembership {
                                membership_id: row.get(0)?,
                                revision: row.get(1)?,
                            })
                        },
                    )
                    .optional()?
                    .ok_or_else(|| corrupt("Data Source Page has no active membership"))?;
                Some(membership)
            }
            PreparedPageOwnershipSource::Document {
                document_id,
                page_id: source_page_id,
            } => {
                if location_kind != "document"
                    || containing_document_id.as_deref() != Some(document_id)
                    || containing_database_id.is_some()
                    || parent_kind.as_deref() != Some("page")
                    || parent_id.as_deref() != Some(source_page_id)
                {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        format!("Page {page_id} no longer belongs to the source Document"),
                        true,
                    ));
                }
                None
            }
        };
        let shell = source_document_base
            .as_ref()
            .and_then(|document| {
                find_materialized_block(&document.base_materialization.block_tree, page_id)
            })
            .unwrap_or_else(|| embedded_page_shell(page_id));
        if shell.block_type != "page" || !shell.children.is_empty() {
            return Err(corrupt("Embedded Page shell is not canonical"));
        }
        let (owned_document_id, owned_document_generation, owned_document_head_seq, readiness) =
            connection.query_row(
                "SELECT document.id, document.generation, document.head_seq, document.readiness \
                     FROM pages page JOIN documents document ON document.id = page.document_id \
                     WHERE page.block_id = ?1 AND page.library_id = ?2",
                params![page_id, library_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )?;
        if readiness != "ready" {
            return Err(invalid("Page copy source Document is not ready"));
        }
        roots.push(PreparedPageOwnershipRoot {
            page_id: page_id.clone(),
            project_id,
            location_revision,
            parent_revision,
            source_membership,
            shell,
            owned_document_id,
            owned_document_generation,
            owned_document_head_seq,
        });
    }
    let mut copy_document_heads = Vec::new();
    let mut copy_destination = None;
    let (source_document, target_document) = if intent.mode == LibraryBlockTransferMode::Move {
        let source_document = source_document_base
            .map(|base| {
                let operations = roots
                    .iter()
                    .map(|root| DocumentBlockOperation::DeleteBlock {
                        block_id: root.page_id.clone(),
                    })
                    .collect::<Vec<_>>();
                prepare_page_ownership_document_update(base, &operations)
            })
            .transpose()?;
        let target_document = target_document_base
            .map(|base| {
                let PreparedPageOwnershipTarget::Document {
                    parent_block_id,
                    before_block_id,
                    ..
                } = &target
                else {
                    return Err(corrupt("Target Document preparation lost its target"));
                };
                let operations = roots
                    .iter()
                    .map(|root| DocumentBlockOperation::InsertBlock {
                        block: root.shell.clone(),
                        parent_block_id: parent_block_id.clone(),
                        before_block_id: before_block_id.clone(),
                    })
                    .collect::<Vec<_>>();
                prepare_page_ownership_document_update(base, &operations)
            })
            .transpose()?;
        (source_document, target_document)
    } else {
        if let Some(document) = &source_document_base {
            copy_document_heads.push(LibraryBlockTransferDocumentHead {
                document_id: document.authority.head.id.clone(),
                generation: document.authority.head.generation,
                expected_head_seq: document.authority.head.head_seq,
            });
        }
        if let Some(document) = &target_document_base {
            copy_document_heads.push(LibraryBlockTransferDocumentHead {
                document_id: document.authority.head.id.clone(),
                generation: document.authority.head.generation,
                expected_head_seq: document.authority.head.head_seq,
            });
        }
        for root in &roots {
            copy_document_heads.extend(page_copy_closure_document_heads(
                connection,
                operation_id,
                &root.project_id,
                &root.page_id,
                &root.owned_document_id,
            )?);
        }
        copy_document_heads.sort_by(|left, right| left.document_id.cmp(&right.document_id));
        copy_document_heads.dedup_by(|left, right| left.document_id == right.document_id);
        copy_destination = Some(match &target {
            PreparedPageOwnershipTarget::Library { before_block_id } => {
                LibraryPageCopyDestination::Library {
                    before: before_block_id
                        .as_deref()
                        .map(|block_id| read_library_anchor(connection, library_id, block_id))
                        .transpose()?,
                }
            }
            PreparedPageOwnershipTarget::DataSource { destination, .. } => {
                LibraryPageCopyDestination::DataSource {
                    data_source_id: destination.data_source_id.clone(),
                    expected_data_source_revision: destination.expected_data_source_revision,
                    values: destination
                        .values
                        .iter()
                        .map(|value| LibraryPageCopyValue {
                            property_id: value.property_id.clone(),
                            value: value.value.clone(),
                        })
                        .collect(),
                    view: destination
                        .view
                        .as_ref()
                        .map(|view| LibraryPageCopyViewPlacement {
                            view_id: view.view_id.clone(),
                            expected_view_revision: view.expected_view_revision,
                            group_key: view.group_key.clone(),
                            before: view.before.as_ref().map(|anchor| {
                                LibraryPageCopyPositionAnchor {
                                    page_id: anchor.page_id.clone(),
                                    expected_position_revision: anchor.expected_position_revision,
                                }
                            }),
                        }),
                }
            }
            PreparedPageOwnershipTarget::Document { page_id, .. } => {
                let document = target_document_base
                    .as_ref()
                    .ok_or_else(|| corrupt("Page copy target Document disappeared"))?;
                LibraryPageCopyDestination::Page {
                    page_id: page_id.clone(),
                    expected_document_generation: document.authority.head.generation,
                    expected_document_head_seq: document.authority.head.head_seq,
                    before: None,
                }
            }
        });
        let target_document = target_document_base
            .map(|base| {
                let PreparedPageOwnershipTarget::Document {
                    parent_block_id,
                    before_block_id,
                    ..
                } = &target
                else {
                    return Err(corrupt("Page copy target Document disappeared"));
                };
                let operations = roots
                    .iter()
                    .map(|root| DocumentBlockOperation::InsertBlock {
                        block: embedded_page_shell(&stable_uuid_v7(
                            operation_id,
                            "block",
                            &root.page_id,
                        )),
                        parent_block_id: parent_block_id.clone(),
                        before_block_id: before_block_id.clone(),
                    })
                    .collect::<Vec<_>>();
                prepare_page_ownership_document_update(base, &operations)
            })
            .transpose()?;
        (None, target_document)
    };
    Ok(PreparedPageOwnershipTransfer {
        roots,
        source,
        target,
        source_document,
        target_document,
        copy_document_heads,
        copy_destination,
    })
}

fn page_ownership_preparation(
    prepared: &PreparedPageOwnershipTransfer,
) -> LibraryBlockTransferPreparation {
    let mut documents = prepared
        .source_document
        .iter()
        .chain(prepared.target_document.iter())
        .map(|document| LibraryBlockTransferDocumentHead {
            document_id: document.authority.head.id.clone(),
            generation: document.authority.head.generation,
            expected_head_seq: document.authority.head.head_seq,
        })
        .collect::<Vec<_>>();
    documents.extend(prepared.copy_document_heads.clone());
    documents.sort_by(|left, right| left.document_id.cmp(&right.document_id));
    documents.dedup_by(|left, right| left.document_id == right.document_id);
    let location_revisions = prepared
        .roots
        .iter()
        .map(|root| (root.page_id.clone(), root.location_revision))
        .collect();
    let source_memberships = prepared
        .roots
        .iter()
        .filter_map(|root| {
            root.source_membership
                .clone()
                .map(|membership| (root.page_id.clone(), membership))
        })
        .collect();
    LibraryBlockTransferPreparation {
        write_fence: LibraryBlockTransferWriteFence {
            documents,
            location_revisions,
            source_memberships,
        },
        source_document_id: match &prepared.source {
            PreparedPageOwnershipSource::Document { document_id, .. } => Some(document_id.clone()),
            PreparedPageOwnershipSource::Library
            | PreparedPageOwnershipSource::DataSource { .. } => None,
        },
        source_database_id: match &prepared.source {
            PreparedPageOwnershipSource::Library => None,
            PreparedPageOwnershipSource::DataSource { database_id, .. } => {
                Some(database_id.clone())
            }
            PreparedPageOwnershipSource::Document { .. } => None,
        },
        target_document_id: match &prepared.target {
            PreparedPageOwnershipTarget::Document { document_id, .. } => Some(document_id.clone()),
            PreparedPageOwnershipTarget::Library { .. }
            | PreparedPageOwnershipTarget::DataSource { .. } => None,
        },
        target_database_id: match &prepared.target {
            PreparedPageOwnershipTarget::Library { .. } => None,
            PreparedPageOwnershipTarget::DataSource { database_id, .. } => {
                Some(database_id.clone())
            }
            PreparedPageOwnershipTarget::Document { .. } => None,
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_page_ownership_transfer(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    store_epoch: &str,
    request_hash: &str,
    intent: &LibraryBlockTransferLogicalIntent,
    write_fence: Option<&LibraryBlockTransferWriteFence>,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    let mut prepared =
        prepare_page_ownership_transfer(connection, context, library_id, operation_id, intent)?;
    let expected_preparation = page_ownership_preparation(&prepared);
    if write_fence != Some(&expected_preparation.write_fence) {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Block transfer requires a trusted exact-closure write fence",
            true,
        ));
    }
    if intent.mode == LibraryBlockTransferMode::Copy {
        return apply_page_ownership_copy(
            connection,
            context,
            library_id,
            operation_id,
            store_epoch,
            request_hash,
            intent,
            prepared,
            assets_root,
        );
    }
    let requesting_project_id = bound_project_id(context)?;
    let now = sqlite_now(connection)?;
    let mut affected_database_ids = BTreeSet::new();
    let mut affected_view_ids = BTreeSet::new();
    let mut committed_revisions = BTreeMap::new();
    for root in &prepared.roots {
        let expected_membership_revision = root
            .source_membership
            .as_ref()
            .map_or(0, |membership| membership.revision);
        let placement = match &prepared.target {
            PreparedPageOwnershipTarget::Library { .. } => {
                transfer_existing_page_for_block_transfer(
                    connection,
                    library_id,
                    requesting_project_id,
                    &root.page_id,
                    root.parent_revision,
                    expected_membership_revision,
                    ExistingPageTransferTarget::Library,
                    &now,
                )?
            }
            PreparedPageOwnershipTarget::DataSource { destination, .. } => {
                transfer_existing_page_for_block_transfer(
                    connection,
                    library_id,
                    requesting_project_id,
                    &root.page_id,
                    root.parent_revision,
                    expected_membership_revision,
                    ExistingPageTransferTarget::DataSource(destination),
                    &now,
                )?
            }
            PreparedPageOwnershipTarget::Document { page_id, .. } => {
                transfer_existing_page_for_block_transfer(
                    connection,
                    library_id,
                    requesting_project_id,
                    &root.page_id,
                    root.parent_revision,
                    expected_membership_revision,
                    ExistingPageTransferTarget::Page { page_id },
                    &now,
                )?
            }
        };
        if let PreparedPageOwnershipTarget::Library { before_block_id } = &prepared.target {
            connection.execute(
                "DELETE FROM top_level_block_placements WHERE block_id = ?1",
                [&root.page_id],
            )?;
            connection.execute(
                "DELETE FROM library_block_placements WHERE block_id = ?1 AND library_id = ?2",
                params![root.page_id, library_id],
            )?;
            let rank = insert_top_level_placement(
                connection,
                &root.project_id,
                &root.page_id,
                before_block_id.as_deref(),
                &now,
            )?;
            let anchor = before_block_id
                .as_deref()
                .map(|block_id| read_library_anchor(connection, library_id, block_id))
                .transpose()?;
            insert_library_placement(connection, library_id, &root.page_id, anchor.as_ref(), &now)?;
            connection.execute(
                "UPDATE page_read_model SET top_level_rank_key = ?1, updated_at = ?2 \
                 WHERE page_block_id = ?3",
                params![rank, now, root.page_id],
            )?;
        }
        affected_database_ids.extend(placement.affected_database_ids);
        affected_view_ids.extend(placement.affected_view_ids);
        committed_revisions.extend(placement.committed_revisions);
        committed_revisions.insert(
            format!("blockLocation:{}", root.page_id),
            placement.location_revision,
        );
        committed_revisions.insert(
            format!("blockMetadata:{}", root.page_id),
            placement.metadata_revision,
        );
        committed_revisions.insert(
            format!("pageParent:{}", root.page_id),
            placement.parent_revision,
        );
        if let (Some(database_id), Some(data_source_id), Some(membership_id)) = (
            placement.database_id,
            placement.data_source_id,
            placement.membership_id,
        ) {
            affected_database_ids.insert(database_id);
            committed_revisions
                .entry(format!("membership:{data_source_id}:{membership_id}"))
                .or_insert(1);
        }
    }
    let mut document_commits = Vec::new();
    if let Some(mut document) = prepared.source_document.take() {
        let update_id = format!(
            "block-transfer-page-parent-source:{}",
            sha256(request_hash.as_bytes())
        );
        let update = document.update;
        document_commits.push(persist_prepared_update(
            connection,
            &document.authority,
            &document.base_materialization,
            &mut document.engine,
            update,
            &update_id,
            store_epoch,
        )?);
    }
    if let Some(mut document) = prepared.target_document.take() {
        let update_id = format!(
            "block-transfer-page-parent-target:{}",
            sha256(request_hash.as_bytes())
        );
        let update = document.update;
        document_commits.push(persist_prepared_update(
            connection,
            &document.authority,
            &document.base_materialization,
            &mut document.engine,
            update,
            &update_id,
            store_epoch,
        )?);
    }
    let result_block_ids = prepared
        .roots
        .iter()
        .map(|root| root.page_id.clone())
        .collect::<Vec<_>>();
    let (final_locations, final_location_revisions) =
        read_final_locations(connection, &result_block_ids)?;
    let affected_database_ids = affected_database_ids.into_iter().collect::<Vec<_>>();
    let affected_view_ids = affected_view_ids.into_iter().collect::<Vec<_>>();
    let result = LibraryBlockTransferResult {
        mode: LibraryBlockTransferMode::Move,
        source_root_block_ids: intent.root_block_ids.clone(),
        result_root_block_ids: result_block_ids.clone(),
        copied_block_ids: BTreeMap::new(),
        transformation_evidence: Vec::new(),
        final_locations,
        final_location_revisions: final_location_revisions.clone(),
        document_commits: document_commits
            .iter()
            .map(|commit| commit.public.clone())
            .collect(),
        affected_database_ids: affected_database_ids.clone(),
    };
    committed_revisions.extend(
        final_location_revisions
            .iter()
            .map(|(block_id, revision)| (format!("blockLocation:{block_id}"), *revision)),
    );
    committed_revisions.extend(document_commits.iter().map(|commit| {
        (
            format!("documentHead:{}", commit.public.document_id),
            commit.public.head_seq,
        )
    }));
    let mut affected_parent_keys = match &prepared.source {
        PreparedPageOwnershipSource::Library => vec![format!("library:{library_id}")],
        PreparedPageOwnershipSource::DataSource { data_source_id, .. } => {
            vec![format!("data_source:{data_source_id}")]
        }
        PreparedPageOwnershipSource::Document { page_id, .. } => {
            vec![format!("page:{page_id}")]
        }
    };
    affected_parent_keys.push(match &prepared.target {
        PreparedPageOwnershipTarget::Library { .. } => format!("library:{library_id}"),
        PreparedPageOwnershipTarget::DataSource { destination, .. } => {
            format!("data_source:{}", destination.data_source_id)
        }
        PreparedPageOwnershipTarget::Document { page_id, .. } => format!("page:{page_id}"),
    });
    affected_parent_keys.sort();
    affected_parent_keys.dedup();
    let mut affected_page_ids = prepared
        .roots
        .iter()
        .map(|root| root.page_id.clone())
        .collect::<Vec<_>>();
    if let PreparedPageOwnershipSource::Document { page_id, .. } = &prepared.source {
        affected_page_ids.push(page_id.clone());
    }
    if let PreparedPageOwnershipTarget::Document { page_id, .. } = &prepared.target {
        affected_page_ids.push(page_id.clone());
    }
    affected_page_ids.sort();
    affected_page_ids.dedup();
    let affected_document_ids = document_commits
        .iter()
        .map(|commit| commit.public.document_id.clone())
        .collect::<Vec<_>>();
    let outcome = finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: requesting_project_id.to_owned(),
            operation_kind: "transfer_blocks",
            change_kind: "block_mutation",
            did_mutate: true,
            created_target: None,
            affected_parent_keys,
            affected_block_ids: result_block_ids.clone(),
            affected_page_ids,
            affected_database_ids,
            affected_view_ids,
            affected_document_ids,
            committed_revisions,
            page_copy: None,
            block_transfer: Some(result.clone()),
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            change_payload: None,
            committed_at: now.clone(),
        },
    )?;
    persist_mutation_ledger(
        connection,
        operation_id,
        requesting_project_id,
        store_epoch,
        request_hash,
        intent,
        &result,
        outcome.committed.event_sequence,
        &now,
    )?;
    persist_operation_checkpoints(
        connection,
        context,
        operation_id,
        &intent.actor,
        &document_commits,
        outcome.committed.event_sequence,
        &now,
    )?;
    Ok(outcome)
}

#[allow(clippy::too_many_arguments)]
fn apply_page_ownership_copy(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    store_epoch: &str,
    request_hash: &str,
    intent: &LibraryBlockTransferLogicalIntent,
    mut prepared: PreparedPageOwnershipTransfer,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    let destination = prepared
        .copy_destination
        .as_ref()
        .ok_or_else(|| corrupt("Page copy preparation omitted its destination"))?;
    let mut copied_block_ids = BTreeMap::new();
    let mut result_root_block_ids = Vec::with_capacity(prepared.roots.len());
    let mut affected_page_ids = BTreeSet::new();
    let mut affected_database_ids = BTreeSet::new();
    let mut affected_view_ids = BTreeSet::new();
    let mut affected_document_ids = BTreeSet::new();
    let mut committed_revisions = BTreeMap::new();
    let mut document_commits = Vec::new();
    let mut checkpoint_commits = Vec::new();
    let mut target_project_id = None;
    let mut affected_parent_keys = BTreeSet::new();
    let parent_document_mode = if prepared.target_document.is_some() {
        PageCopyParentDocumentMode::Defer
    } else {
        PageCopyParentDocumentMode::Commit
    };
    for root in &prepared.roots {
        let execution = execute_page_copy(
            connection,
            context,
            store_epoch,
            library_id,
            operation_id,
            &root.page_id,
            root.location_revision,
            root.parent_revision,
            root.source_membership
                .as_ref()
                .map_or(0, |membership| membership.revision),
            root.owned_document_generation,
            root.owned_document_head_seq,
            destination,
            parent_document_mode,
            false,
            assets_root,
        )?;
        if target_project_id
            .as_ref()
            .is_some_and(|project_id| project_id != &execution.project_id)
        {
            return Err(corrupt(
                "Page copy roots resolved to different target Projects",
            ));
        }
        target_project_id = Some(execution.project_id.clone());
        affected_parent_keys.insert(execution.parent_key);
        affected_page_ids.extend(execution.affected_page_ids);
        affected_database_ids.extend(execution.affected_database_ids);
        affected_view_ids.extend(execution.affected_view_ids);
        affected_document_ids.extend(execution.affected_document_ids);
        committed_revisions.extend(execution.committed_revisions);
        document_commits.extend(execution.document_commits);
        result_root_block_ids.push(execution.result.page_id.clone());
        copied_block_ids.extend(execution.result.block_ids);
    }
    if let Some(mut document) = prepared.target_document.take() {
        let update_id = format!(
            "block-transfer-page-copy-target:{}",
            sha256(request_hash.as_bytes())
        );
        let update = document.update;
        let commit = persist_prepared_update(
            connection,
            &document.authority,
            &document.base_materialization,
            &mut document.engine,
            update,
            &update_id,
            store_epoch,
        )?;
        committed_revisions.insert(
            format!("documentHead:{}", commit.public.document_id),
            commit.public.head_seq,
        );
        affected_document_ids.insert(commit.public.document_id.clone());
        document_commits.push(commit.public.clone());
        checkpoint_commits.push(commit);
    }
    let (final_locations, final_location_revisions) =
        read_final_locations(connection, &result_root_block_ids)?;
    committed_revisions.extend(
        final_location_revisions
            .iter()
            .map(|(block_id, revision)| (format!("blockLocation:{block_id}"), *revision)),
    );
    let affected_database_ids = affected_database_ids.into_iter().collect::<Vec<_>>();
    let result = LibraryBlockTransferResult {
        mode: LibraryBlockTransferMode::Copy,
        source_root_block_ids: intent.root_block_ids.clone(),
        result_root_block_ids: result_root_block_ids.clone(),
        copied_block_ids: copied_block_ids.clone(),
        transformation_evidence: Vec::new(),
        final_locations,
        final_location_revisions: final_location_revisions.clone(),
        document_commits: document_commits.clone(),
        affected_database_ids: affected_database_ids.clone(),
    };
    let target_project_id = target_project_id
        .ok_or_else(|| corrupt("Page copy produced no target Project authority"))?;
    let now = sqlite_now(connection)?;
    let affected_block_ids = copied_block_ids.values().cloned().collect::<Vec<_>>();
    let outcome = finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: target_project_id.clone(),
            operation_kind: "transfer_blocks",
            change_kind: "block_mutation",
            did_mutate: true,
            created_target: None,
            affected_parent_keys: affected_parent_keys.into_iter().collect(),
            affected_block_ids,
            affected_page_ids: affected_page_ids.into_iter().collect(),
            affected_database_ids,
            affected_view_ids: affected_view_ids.into_iter().collect(),
            affected_document_ids: affected_document_ids.into_iter().collect(),
            committed_revisions,
            page_copy: None,
            block_transfer: Some(result.clone()),
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            change_payload: None,
            committed_at: now.clone(),
        },
    )?;
    persist_mutation_ledger(
        connection,
        operation_id,
        &target_project_id,
        store_epoch,
        request_hash,
        intent,
        &result,
        outcome.committed.event_sequence,
        &now,
    )?;
    persist_operation_checkpoints(
        connection,
        context,
        operation_id,
        &intent.actor,
        &checkpoint_commits,
        outcome.committed.event_sequence,
        &now,
    )?;
    Ok(outcome)
}

fn prepare_page_parent_transfer(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    intent: &LibraryBlockTransferLogicalIntent,
) -> Result<PreparedPageParentTransfer, StoreError> {
    let project_id = bound_project_id(context)?;
    require_project_in_library(connection, project_id, library_id)?;
    let (target_project_id, target) = match &intent.target {
        LibraryBlockTransferTarget::Library {
            library_id: target_library_id,
            before_block_id,
        } => {
            if target_library_id != library_id {
                return Err(unauthorized(
                    "Block transfer target belongs to another Library",
                ));
            }
            (
                project_id.to_owned(),
                PreparedPageParentTarget::Library {
                    before_block_id: before_block_id.clone(),
                },
            )
        }
        LibraryBlockTransferTarget::DataSource {
            data_source_id,
            view_id,
            group_key,
            before_page_id,
        } => {
            let resolved = resolve_page_transfer_data_source_destination(
                connection,
                library_id,
                project_id,
                data_source_id,
                view_id,
                group_key.as_deref(),
                before_page_id.as_deref(),
            )?;
            (
                resolved.project_id,
                PreparedPageParentTarget::DataSource {
                    database_id: resolved.database_id,
                    destination: resolved.destination,
                },
            )
        }
        _ => {
            return Err(invalid(
                "Page-parent transfer requires a Library or Data Source target",
            ));
        }
    };
    let source_page_id = match &intent.source {
        LibraryBlockTransferSource::Page { page_id } => Some(page_id.as_str()),
        _ => None,
    };
    let source_document_id = resolve_source_document(connection, library_id, &intent.source)?;
    let source_authority = require_transfer_authority(
        connection,
        library_id,
        project_id,
        &source_document_id,
        source_page_id,
        match intent.mode {
            LibraryBlockTransferMode::Move => TransferDocumentAccess::Write,
            LibraryBlockTransferMode::Copy => TransferDocumentAccess::Read,
        },
    )?;
    let source_schema = require_schema(&source_authority)?;
    let source_engine = reconstruct_yjs_engine(connection, &source_authority.head)?;
    let source_decoded = decode_block_document(source_engine.document(), source_schema)
        .map_err(|error| corrupt(error.to_string()))?;
    let source_materialization = materialize_decoded_document(&source_decoded)
        .map_err(|error| corrupt(error.to_string()))?;
    let source_forest = crate::domain::subtree::capture_block_subtree_forest(
        &source_decoded.block_tree,
        &intent.root_block_ids,
    )
    .map_err(|error| invalid(error.to_string()))?;
    for block_id in &source_forest.block_ids {
        if is_typed_resource(connection, block_id)? {
            return Err(invalid(
                "Page ownership roots use the recursive Page transfer compiler",
            ));
        }
    }
    let expected_location_revisions = validate_source_roots(
        connection,
        &source_authority.head.project_id,
        &source_document_id,
        &intent.root_block_ids,
    )?;
    let mut copied_block_ids = BTreeMap::new();
    let mut roots = Vec::with_capacity(source_forest.roots.len());
    let mut new_block_ids = Vec::new();
    for source_root in &source_forest.roots {
        let materialized = find_materialized_block(
            &source_materialization.block_tree,
            &source_root.root_block_id,
        )
        .ok_or_else(|| corrupt("Selected Block is absent from its materialization"))?;
        let source_to_result_block_ids = source_root
            .block_ids
            .iter()
            .map(|source_id| {
                let result_id = if intent.mode == LibraryBlockTransferMode::Copy {
                    stable_uuid_v7(operation_id, "block_transfer", source_id)
                } else {
                    source_id.clone()
                };
                (source_id.clone(), result_id)
            })
            .collect::<BTreeMap<_, _>>();
        if intent.mode == LibraryBlockTransferMode::Copy {
            copied_block_ids.extend(source_to_result_block_ids.clone());
        }
        let result_root = remap_materialized_block(&materialized, &source_to_result_block_ids)?;
        let result_root_id = source_to_result_block_ids
            .get(&source_root.root_block_id)
            .ok_or_else(|| corrupt("Page transformation omitted its result root"))?;
        let wrapper_page_id = stable_uuid_v7(
            operation_id,
            "block_transfer_wrapper",
            &source_root.root_block_id,
        );
        let empty_body_block_id = stable_uuid_v7(
            operation_id,
            "block_transfer_page_body",
            &source_root.root_block_id,
        );
        let transformation = plan_block_to_page_transformation(
            &result_root,
            result_root_id,
            &wrapper_page_id,
            &empty_body_block_id,
        )
        .map_err(|error| invalid(error.to_string()))?;
        let page_id = match &transformation {
            BlockToPageTransformation::Promote { page_id, .. }
            | BlockToPageTransformation::Wrap { page_id, .. }
            | BlockToPageTransformation::AlreadyPage { page_id } => page_id.clone(),
        };
        if matches!(
            transformation,
            BlockToPageTransformation::AlreadyPage { .. }
        ) {
            return Err(invalid(
                "Page ownership roots use the recursive Page transfer compiler",
            ));
        }
        let document_id = format!("document:{page_id}");
        require_fresh_page_authority(
            connection,
            &page_id,
            &document_id,
            &source_root.root_block_id,
        )?;
        new_block_ids.extend(
            transformation_result_blocks(&transformation)
                .into_iter()
                .filter(|block_id| {
                    intent.mode == LibraryBlockTransferMode::Copy
                        || block_id != &source_root.root_block_id
                            && !source_root.block_ids.contains(block_id)
                }),
        );
        roots.push(PreparedPageParentRoot {
            source_root_id: source_root.root_block_id.clone(),
            source_block_ids: source_root.block_ids.clone(),
            page_id,
            document_id,
            transformation,
            source_to_result_block_ids,
        });
    }
    new_block_ids.sort();
    new_block_ids.dedup();
    assert_fresh_copy_identities(connection, &new_block_ids)?;
    let source_update = if intent.mode == LibraryBlockTransferMode::Move {
        Some(
            prepare_document_operation_update(
                &source_authority.head.id,
                source_schema,
                &source_engine.full_state_v1(),
                &source_authority.head.state_vector,
                &intent
                    .root_block_ids
                    .iter()
                    .map(|block_id| DocumentBlockOperation::DeleteBlock {
                        block_id: block_id.clone(),
                    })
                    .collect::<Vec<_>>(),
                false,
            )
            .map_err(|error| invalid(error.to_string()))?,
        )
    } else {
        None
    };
    Ok(PreparedPageParentTransfer {
        source_authority,
        source_engine,
        source_materialization,
        source_update,
        roots,
        expected_location_revisions,
        copied_block_ids,
        target_project_id,
        target,
    })
}

fn page_parent_preparation(
    prepared: &PreparedPageParentTransfer,
) -> LibraryBlockTransferPreparation {
    LibraryBlockTransferPreparation {
        write_fence: LibraryBlockTransferWriteFence {
            documents: vec![LibraryBlockTransferDocumentHead {
                document_id: prepared.source_authority.head.id.clone(),
                generation: prepared.source_authority.head.generation,
                expected_head_seq: prepared.source_authority.head.head_seq,
            }],
            location_revisions: prepared.expected_location_revisions.clone(),
            source_memberships: BTreeMap::new(),
        },
        source_document_id: Some(prepared.source_authority.head.id.clone()),
        source_database_id: None,
        target_document_id: None,
        target_database_id: match &prepared.target {
            PreparedPageParentTarget::Library { .. } => None,
            PreparedPageParentTarget::DataSource { database_id, .. } => Some(database_id.clone()),
        },
    }
}

fn find_materialized_block(
    blocks: &[MaterializedBlockNode],
    block_id: &str,
) -> Option<MaterializedBlockNode> {
    blocks.iter().find_map(|block| {
        if block.id == block_id {
            return Some(block.clone());
        }
        find_materialized_block(&block.children, block_id)
    })
}

fn remap_materialized_block(
    block: &MaterializedBlockNode,
    identities: &BTreeMap<String, String>,
) -> Result<MaterializedBlockNode, StoreError> {
    Ok(MaterializedBlockNode {
        id: identities
            .get(&block.id)
            .cloned()
            .ok_or_else(|| corrupt("Block transformation identity map is incomplete"))?,
        block_type: block.block_type.clone(),
        props: block.props.clone(),
        content: block.content.clone(),
        children: block
            .children
            .iter()
            .map(|child| remap_materialized_block(child, identities))
            .collect::<Result<_, _>>()?,
    })
}

fn transformation_result_blocks(transformation: &BlockToPageTransformation) -> Vec<String> {
    let mut result = Vec::new();
    match transformation {
        BlockToPageTransformation::Promote {
            page_id,
            body_roots,
            ..
        } => {
            result.push(page_id.clone());
            collect_materialized_block_ids(body_roots, &mut result);
        }
        BlockToPageTransformation::Wrap {
            page_id,
            wrapped_root,
            ..
        } => {
            result.push(page_id.clone());
            collect_materialized_block_ids(std::slice::from_ref(wrapped_root), &mut result);
        }
        BlockToPageTransformation::AlreadyPage { page_id } => result.push(page_id.clone()),
    }
    result
}

fn collect_materialized_block_ids(blocks: &[MaterializedBlockNode], output: &mut Vec<String>) {
    for block in blocks {
        output.push(block.id.clone());
        collect_materialized_block_ids(&block.children, output);
    }
}

fn require_fresh_page_authority(
    connection: &Connection,
    page_id: &str,
    document_id: &str,
    source_root_id: &str,
) -> Result<(), StoreError> {
    let page_collision = connection
        .query_row("SELECT type FROM blocks WHERE id = ?1", [page_id], |row| {
            row.get::<_, String>(0)
        })
        .optional()?;
    if page_collision.is_some() && page_id != source_root_id {
        return Err(invalid("Wrapper Page identity already exists"));
    }
    if connection
        .query_row(
            "SELECT 1 FROM documents WHERE id = ?1",
            [document_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(invalid(
            "Page transformation Document identity already exists",
        ));
    }
    Ok(())
}

fn preparation(prepared: &PreparedTransfer) -> LibraryBlockTransferPreparation {
    let mut documents = vec![
        LibraryBlockTransferDocumentHead {
            document_id: prepared.source_authority.head.id.clone(),
            generation: prepared.source_authority.head.generation,
            expected_head_seq: prepared.source_authority.head.head_seq,
        },
        LibraryBlockTransferDocumentHead {
            document_id: prepared.target_authority.head.id.clone(),
            generation: prepared.target_authority.head.generation,
            expected_head_seq: prepared.target_authority.head.head_seq,
        },
    ];
    documents.sort_by(|left, right| left.document_id.cmp(&right.document_id));
    documents.dedup_by(|left, right| left.document_id == right.document_id);
    LibraryBlockTransferPreparation {
        write_fence: LibraryBlockTransferWriteFence {
            documents,
            location_revisions: prepared.expected_location_revisions.clone(),
            source_memberships: BTreeMap::new(),
        },
        source_document_id: Some(prepared.source_authority.head.id.clone()),
        source_database_id: None,
        target_document_id: Some(prepared.target_authority.head.id.clone()),
        target_database_id: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_page_parent_transfer(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    store_epoch: &str,
    request_hash: &str,
    intent: &LibraryBlockTransferLogicalIntent,
    write_fence: Option<&LibraryBlockTransferWriteFence>,
) -> Result<LibraryApplyOutcome, StoreError> {
    let mut prepared =
        prepare_page_parent_transfer(connection, context, library_id, operation_id, intent)?;
    let expected_preparation = page_parent_preparation(&prepared);
    if write_fence != Some(&expected_preparation.write_fence) {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Block transfer requires a trusted exact-closure write fence",
            true,
        ));
    }
    let now = sqlite_now(connection)?;
    if intent.mode == LibraryBlockTransferMode::Move
        && prepared.source_authority.head.project_id != prepared.target_project_id
    {
        connection.execute(
            "DELETE FROM block_asset_refs WHERE document_id = ?1",
            [&prepared.source_authority.head.id],
        )?;
        connection.execute(
            "DELETE FROM block_search_units WHERE document_id = ?1 AND source_revision IS NULL",
            [&prepared.source_authority.head.id],
        )?;
    }

    let before_block_id = match &prepared.target {
        PreparedPageParentTarget::Library { before_block_id } => before_block_id.as_deref(),
        PreparedPageParentTarget::DataSource { .. } => None,
    };
    let mut staged = Vec::with_capacity(prepared.roots.len());
    for root in &prepared.roots {
        let stage = stage_page_parent_root(
            connection,
            library_id,
            &prepared,
            root,
            before_block_id,
            &now,
        )?;
        staged.push(stage);
    }

    let mut document_commits = Vec::new();
    if let Some(source_update) = prepared.source_update.take() {
        let update_id = format!("block-transfer:{request_hash}:source");
        document_commits.push(persist_prepared_update(
            connection,
            &prepared.source_authority,
            &prepared.source_materialization,
            &mut prepared.source_engine,
            source_update,
            &update_id,
            store_epoch,
        )?);
    }
    let mut data_source_placements = Vec::new();
    for stage in staged {
        let page_id = stage.page_id.clone();
        let staged_revisions = StagedPagePlacementRevisions {
            location_revision: stage.location_revision,
            metadata_revision: stage.metadata_revision,
            parent_revision: stage.parent_revision,
        };
        document_commits.push(persist_page_parent_genesis(
            connection,
            store_epoch,
            request_hash,
            stage,
            &now,
        )?);
        if let PreparedPageParentTarget::DataSource { destination, .. } = &prepared.target {
            let placement = place_staged_page_in_data_source(
                connection,
                library_id,
                bound_project_id(context)?,
                None,
                &page_id,
                destination,
                staged_revisions,
                &now,
            )?;
            data_source_placements.push((page_id, placement));
        }
    }

    let result_root_block_ids = prepared
        .roots
        .iter()
        .map(|root| root.page_id.clone())
        .collect::<Vec<_>>();
    let result_block_ids = prepared
        .roots
        .iter()
        .flat_map(|root| transformation_result_blocks(&root.transformation))
        .collect::<Vec<_>>();
    let (final_locations, final_location_revisions) =
        read_final_locations(connection, &result_block_ids)?;
    let mut affected_database_ids = data_source_placements
        .iter()
        .map(|(_, placement)| placement.database_id.clone())
        .collect::<Vec<_>>();
    affected_database_ids.sort();
    affected_database_ids.dedup();
    let mut affected_view_ids = data_source_placements
        .iter()
        .flat_map(|(_, placement)| placement.affected_view_ids.clone())
        .collect::<Vec<_>>();
    affected_view_ids.sort();
    affected_view_ids.dedup();
    let result = LibraryBlockTransferResult {
        mode: intent.mode,
        source_root_block_ids: intent.root_block_ids.clone(),
        result_root_block_ids,
        copied_block_ids: prepared.copied_block_ids.clone(),
        transformation_evidence: prepared
            .roots
            .iter()
            .map(transformation_evidence)
            .collect::<Result<_, _>>()?,
        final_locations,
        final_location_revisions: final_location_revisions.clone(),
        document_commits: document_commits
            .iter()
            .map(|commit| commit.public.clone())
            .collect(),
        affected_database_ids: affected_database_ids.clone(),
    };
    let mut committed_revisions = final_location_revisions
        .iter()
        .map(|(block_id, revision)| (format!("blockLocation:{block_id}"), *revision))
        .collect::<BTreeMap<_, _>>();
    for commit in &document_commits {
        committed_revisions.insert(
            format!("documentHead:{}", commit.public.document_id),
            commit.public.head_seq,
        );
    }
    for (page_id, placement) in &data_source_placements {
        committed_revisions.insert(
            format!("blockMetadata:{page_id}"),
            placement.metadata_revision,
        );
        committed_revisions.insert(format!("pageParent:{page_id}"), placement.parent_revision);
        committed_revisions.insert(
            format!(
                "membership:{}:{}",
                placement.data_source_id, placement.membership_id
            ),
            1,
        );
        for (property_id, revision) in &placement.value_revisions {
            committed_revisions.insert(
                format!(
                    "propertyValue:{}:{}:{}",
                    placement.data_source_id, page_id, property_id
                ),
                *revision,
            );
        }
        if let (PreparedPageParentTarget::DataSource { destination, .. }, Some(revision)) =
            (&prepared.target, placement.position_revision)
            && let Some(view) = &destination.view
        {
            committed_revisions
                .insert(format!("viewPosition:{}:{page_id}", view.view_id), revision);
        }
    }
    let affected_parent_keys = match &prepared.target {
        PreparedPageParentTarget::Library { .. } => vec![format!("library:{library_id}")],
        PreparedPageParentTarget::DataSource { destination, .. } => {
            vec![format!("data_source:{}", destination.data_source_id)]
        }
    };
    let outcome = finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: prepared.target_project_id.clone(),
            operation_kind: "transfer_blocks",
            change_kind: "block_mutation",
            did_mutate: true,
            created_target: None,
            affected_parent_keys,
            affected_block_ids: result_block_ids,
            affected_page_ids: prepared
                .roots
                .iter()
                .map(|root| root.page_id.clone())
                .collect(),
            affected_database_ids,
            affected_view_ids,
            affected_document_ids: document_commits
                .iter()
                .map(|commit| commit.public.document_id.clone())
                .collect(),
            committed_revisions,
            page_copy: None,
            block_transfer: Some(result.clone()),
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            change_payload: None,
            committed_at: now.clone(),
        },
    )?;
    persist_mutation_ledger(
        connection,
        operation_id,
        &prepared.target_project_id,
        store_epoch,
        request_hash,
        intent,
        &result,
        outcome.committed.event_sequence,
        &now,
    )?;
    persist_operation_checkpoints(
        connection,
        context,
        operation_id,
        &intent.actor,
        &document_commits,
        outcome.committed.event_sequence,
        &now,
    )?;
    Ok(outcome)
}

struct StagedPageParentGenesis {
    page_id: String,
    document_id: String,
    top_level_rank: String,
    location_revision: i64,
    metadata_revision: i64,
    parent_revision: i64,
    prepared: crate::document::PreparedYjsGenesis,
}

fn stage_page_parent_root(
    connection: &Connection,
    library_id: &str,
    prepared: &PreparedPageParentTransfer,
    root: &PreparedPageParentRoot,
    before_block_id: Option<&str>,
    now: &str,
) -> Result<StagedPageParentGenesis, StoreError> {
    let (rich_title, body_roots, promotes_existing_root) = match &root.transformation {
        BlockToPageTransformation::Promote {
            rich_title,
            body_roots,
            ..
        } => (
            rich_title,
            body_roots.as_slice(),
            root.page_id == root.source_root_id,
        ),
        BlockToPageTransformation::Wrap {
            rich_title,
            wrapped_root,
            ..
        } => (rich_title, std::slice::from_ref(wrapped_root), false),
        BlockToPageTransformation::AlreadyPage { .. } => {
            return Err(invalid("Page root requires the Page ownership compiler"));
        }
    };
    let source_project_id = &prepared.source_authority.head.project_id;
    if promotes_existing_root && prepared.source_update.is_some() {
        let changed = connection.execute(
            "UPDATE blocks SET project_id = ?1, type = 'page', location_kind = 'space', \
               containing_document_id = NULL, containing_database_id = NULL, \
               location_revision = location_revision + 1, metadata_revision = metadata_revision + 1, \
               updated_at = ?2 WHERE id = ?3 AND project_id = ?4 AND lifecycle = 'active' \
               AND location_kind = 'document' AND containing_document_id = ?5",
            params![
                prepared.target_project_id,
                now,
                root.page_id,
                source_project_id,
                prepared.source_authority.head.id,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                format!("Block {} changed before Page promotion", root.page_id),
                true,
            ));
        }
    } else {
        connection.execute(
            "INSERT INTO blocks( \
               id, project_id, type, lifecycle, location_kind, containing_document_id, \
               containing_database_id, location_revision, metadata_revision, created_at, updated_at \
             ) VALUES (?1, ?2, 'page', 'active', 'space', NULL, NULL, 1, 1, ?3, ?3)",
            params![root.page_id, prepared.target_project_id, now],
        )?;
    }
    connection.execute(
        "INSERT INTO documents( \
           id, project_id, generation, head_seq, schema_key, schema_version, state_vector, \
           state_hash, readiness, authority, genesis_source_revision, created_at, updated_at, sync_engine \
         ) VALUES (?1, ?2, 1, 0, 'nodex.page', 2, X'', '', 'pending_genesis', \
           'legacy_shadow', NULL, ?3, ?3, 'yjs')",
        params![root.document_id, prepared.target_project_id, now],
    )?;
    if prepared.source_update.is_some() {
        let body_ids = body_roots
            .iter()
            .flat_map(|block| {
                let mut ids = Vec::new();
                collect_materialized_block_ids(std::slice::from_ref(block), &mut ids);
                ids
            })
            .filter(|block_id| root.source_block_ids.contains(block_id))
            .collect::<Vec<_>>();
        for block_id in body_ids {
            let changed = connection.execute(
                "UPDATE blocks SET project_id = ?1, containing_document_id = ?2, \
                   location_revision = location_revision + 1, updated_at = ?3 \
                 WHERE id = ?4 AND project_id = ?5 AND lifecycle = 'active' \
                   AND location_kind = 'document' AND containing_document_id = ?6",
                params![
                    prepared.target_project_id,
                    root.document_id,
                    now,
                    block_id,
                    source_project_id,
                    prepared.source_authority.head.id,
                ],
            )?;
            if changed != 1 {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    format!("Block {block_id} changed before Page transformation"),
                    true,
                ));
            }
        }
    }
    connection.execute(
        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
        params![
            root.page_id,
            root.document_id,
            prepared.target_project_id,
            now
        ],
    )?;
    let revisions = connection.query_row(
        "SELECT location_revision, metadata_revision FROM blocks WHERE id = ?1",
        [&root.page_id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    connection.execute(
        "INSERT INTO pages( \
           block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
           parent_revision, metadata_revision, created_at, updated_at \
         ) VALUES (?1, ?2, ?3, 'library', ?2, 'active', ?4, ?5, ?6, ?6)",
        params![
            root.page_id,
            library_id,
            root.document_id,
            revisions.0,
            revisions.1,
            now,
        ],
    )?;
    let top_level_rank = insert_top_level_placement(
        connection,
        &prepared.target_project_id,
        &root.page_id,
        before_block_id,
        now,
    )?;
    let anchor = before_block_id
        .map(|block_id| read_library_anchor(connection, library_id, block_id))
        .transpose()?;
    insert_library_placement(connection, library_id, &root.page_id, anchor.as_ref(), now)?;
    let title_delta = crate::domain::rich_text::rich_text_to_delta(rich_title)
        .map_err(|error| invalid(error.to_string()))?;
    let prepared_genesis = prepare_yjs_clone_genesis(
        &root.document_id,
        "page",
        BlockDocumentSchema::PageV2,
        Some(&title_delta),
        body_roots,
    )?;
    Ok(StagedPageParentGenesis {
        page_id: root.page_id.clone(),
        document_id: root.document_id.clone(),
        top_level_rank,
        location_revision: revisions.0,
        metadata_revision: revisions.1,
        parent_revision: revisions.0,
        prepared: prepared_genesis,
    })
}

fn persist_page_parent_genesis(
    connection: &Connection,
    store_epoch: &str,
    request_hash: &str,
    stage: StagedPageParentGenesis,
    now: &str,
) -> Result<PersistedTransferCommit, StoreError> {
    let authority = read_document_authority(connection, &stage.document_id)?
        .ok_or_else(|| corrupt("Staged Page has no Document authority"))?;
    let update_id = format!(
        "block-transfer-page-genesis:{}",
        sha256(format!("{request_hash}\0{}", stage.page_id).as_bytes())
    );
    let full_state = stage.prepared.engine.full_state_v1();
    let persisted = persist_yjs_genesis(
        connection,
        PersistYjsGenesis {
            authority: &authority,
            materialization: &stage.prepared.materialization,
            update_id: &update_id,
            client_session_id: TRANSFER_CLIENT_SESSION_ID,
            update: &stage.prepared.update_v1,
            state_vector: &stage.prepared.state_vector_v1,
            full_state: &full_state,
            store_epoch,
            operation_id: &update_id,
            emit_event: false,
        },
    )?;
    insert_page_read_model(
        connection,
        &stage.page_id,
        &authority.head.project_id,
        &stage.document_id,
        "space",
        None,
        Some(&stage.top_level_rank),
        &stage.prepared.materialization,
        persisted.head_seq,
        now,
    )?;
    ensure_default_page_intrinsic_properties(
        connection,
        &stage.page_id,
        &authority.head.project_id,
        now,
    )?;
    refresh_page_intrinsic_projection(connection, &stage.page_id, &authority.head.project_id, now)?;
    let revisions = connection.query_row(
        "SELECT location_revision, metadata_revision FROM blocks WHERE id = ?1",
        [&stage.page_id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    connection.execute(
        "UPDATE page_read_model SET location_revision = ?1, metadata_revision = ?2 \
         WHERE page_block_id = ?3",
        params![revisions.0, revisions.1, stage.page_id],
    )?;
    Ok(PersistedTransferCommit {
        public: LibraryBlockTransferDocumentCommit {
            document_id: stage.document_id,
            generation: 1,
            base_head_seq: 0,
            head_seq: persisted.head_seq,
            update_id,
            update: stage.prepared.update_v1,
            state_vector: persisted.state_vector,
        },
        materialization: stage.prepared.materialization,
    })
}

fn insert_top_level_placement(
    connection: &Connection,
    project_id: &str,
    block_id: &str,
    before_block_id: Option<&str>,
    now: &str,
) -> Result<String, StoreError> {
    let Some(before_block_id) = before_block_id else {
        let rank = append_rank(connection, "top_level_block_placements", project_id)?;
        connection.execute(
            "INSERT INTO top_level_block_placements( \
               block_id, project_id, rank_key, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![block_id, project_id, rank, now],
        )?;
        return Ok(rank);
    };
    let ids = connection
        .prepare(
            "SELECT placement.block_id FROM top_level_block_placements placement \
             JOIN blocks block ON block.id = placement.block_id \
             WHERE placement.project_id = ?1 AND block.lifecycle = 'active' \
             ORDER BY placement.rank_key, placement.block_id",
        )?
        .query_map([project_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let position = ids
        .iter()
        .position(|id| id == before_block_id)
        .ok_or_else(|| invalid("Library placement anchor is unavailable"))?;
    let mut ordered = ids;
    ordered.insert(position, block_id.to_owned());
    for (index, id) in ordered.iter().enumerate() {
        let rank = format!("{:020}", index + 1);
        if id == block_id {
            connection.execute(
                "INSERT INTO top_level_block_placements( \
                   block_id, project_id, rank_key, created_at, updated_at \
                 ) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, project_id, rank, now],
            )?;
        } else {
            connection.execute(
                "UPDATE top_level_block_placements SET rank_key = ?1, updated_at = ?2 \
                 WHERE block_id = ?3 AND project_id = ?4 AND rank_key <> ?1",
                params![rank, now, id, project_id],
            )?;
        }
    }
    Ok(format!("{:020}", position + 1))
}

fn read_library_anchor(
    connection: &Connection,
    library_id: &str,
    block_id: &str,
) -> Result<LibraryPlacementAnchor, StoreError> {
    let revision = connection
        .query_row(
            "SELECT block.location_revision FROM library_block_placements placement \
             JOIN blocks block ON block.id = placement.block_id \
             WHERE placement.library_id = ?1 AND placement.block_id = ?2 \
               AND block.lifecycle = 'active'",
            params![library_id, block_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| invalid("Library placement anchor is unavailable"))?;
    Ok(LibraryPlacementAnchor {
        block_id: block_id.to_owned(),
        expected_location_revision: revision,
    })
}

fn transformation_evidence(root: &PreparedPageParentRoot) -> Result<Value, StoreError> {
    let (kind, rich_title, body_root_ids, consumed_props, wrapper_reason) =
        match &root.transformation {
            BlockToPageTransformation::Promote {
                rich_title,
                body_roots,
                consumed_props,
                ..
            } => (
                "promote",
                rich_title,
                body_roots.iter().map(|block| block.id.clone()).collect(),
                consumed_props.keys().cloned().collect::<Vec<_>>(),
                None,
            ),
            BlockToPageTransformation::Wrap {
                rich_title,
                wrapped_root,
                reason,
                ..
            } => (
                "wrap",
                rich_title,
                vec![wrapped_root.id.clone()],
                Vec::new(),
                Some(match reason {
                    PageWrapperReason::TypeRequiresWrapper => "type_requires_wrapper",
                    PageWrapperReason::UnsupportedPrimaryContent => "unsupported_primary_content",
                    PageWrapperReason::UnmappedTypeState => "unmapped_type_state",
                }),
            ),
            BlockToPageTransformation::AlreadyPage { .. } => {
                return Err(corrupt("Committed Page transformation was not compiled"));
            }
        };
    let semantic_title =
        serde_json::to_vec(rich_title).map_err(|_| internal("Page transformation title JSON"))?;
    let mut evidence = serde_json::json!({
        "sourceBlockId": root.source_root_id,
        "resultPageId": root.page_id,
        "kind": kind,
        "sourceBlockType": match &root.transformation {
            BlockToPageTransformation::Promote { consumed_type, .. } => consumed_type,
            BlockToPageTransformation::Wrap { wrapped_root, .. } => &wrapped_root.block_type,
            BlockToPageTransformation::AlreadyPage { .. } => "page",
        },
        "semanticTitleHash": sha256(&semantic_title),
        "consumedPropertyKeys": consumed_props,
        "bodyRootBlockIds": body_root_ids,
        "sourceToResultBlockIds": root.source_to_result_block_ids,
    });
    if let Some(wrapper_reason) = wrapper_reason {
        evidence["wrapperReason"] = Value::String(wrapper_reason.to_owned());
    }
    Ok(evidence)
}

fn affected_page_ids(prepared: &PreparedTransfer) -> Vec<String> {
    let mut page_ids = [&prepared.source_authority, &prepared.target_authority]
        .into_iter()
        .filter(|authority| authority.owner_type == "page")
        .map(|authority| authority.owner_block_id.clone())
        .collect::<Vec<_>>();
    page_ids.sort();
    page_ids.dedup();
    page_ids
}

fn persist_prepared_update(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    base_materialization: &DocumentMaterialization,
    engine: &mut YrsDocumentEngine,
    update: PreparedDocumentOperationUpdate,
    update_id: &str,
    store_epoch: &str,
) -> Result<PersistedTransferCommit, StoreError> {
    let candidate = engine
        .prepare_update_v1(&update.update_v1)
        .map_err(|error| invalid(error.to_string()))?;
    let committed = engine
        .commit_candidate(candidate)
        .map_err(|error| invalid(error.to_string()))?;
    if !committed.did_change {
        return Err(invalid("Block transfer produced no Document change"));
    }
    let persisted = persist_yjs_commit(
        connection,
        PersistYjsCommit {
            authority,
            base_materialization,
            materialization: &update.materialization,
            update_id,
            client_session_id: TRANSFER_CLIENT_SESSION_ID,
            base_head_seq: authority.head.head_seq,
            client_touched_block_ids: &update.write_fence_block_ids,
            update: &update.update_v1,
            state_vector: &engine.state_vector_v1(),
            full_state: &engine.full_state_v1(),
            store_epoch,
            operation_id: update_id,
            event_kind: "document_updated",
            write_fence_block_ids: &update.write_fence_block_ids,
            title_write_fence_required: false,
        },
    )?;
    Ok(PersistedTransferCommit {
        public: LibraryBlockTransferDocumentCommit {
            document_id: authority.head.id.clone(),
            generation: authority.head.generation,
            base_head_seq: authority.head.head_seq,
            head_seq: persisted.head_seq,
            update_id: update_id.to_owned(),
            update: update.update_v1,
            state_vector: persisted.state_vector,
        },
        materialization: update.materialization,
    })
}

fn relocate_registry_blocks(
    connection: &Connection,
    prepared: &PreparedTransfer,
    target_document_id: &str,
) -> Result<(), StoreError> {
    if prepared.source_authority.head.project_id != prepared.target_authority.head.project_id {
        // These projections share one Project coordinate for both the content Block and
        // its owning Page. Remove the source copy before the registry rehome; the two
        // authoritative Document commits rebuild both sides in this transaction.
        connection.execute(
            "DELETE FROM block_asset_refs WHERE document_id = ?1",
            [&prepared.source_authority.head.id],
        )?;
        connection.execute(
            "DELETE FROM block_search_units WHERE document_id = ?1 AND source_revision IS NULL",
            [&prepared.source_authority.head.id],
        )?;
    }
    let now = sqlite_now(connection)?;
    for block_id in &prepared.prepared.source_forest.block_ids {
        let changed = connection.execute(
            "UPDATE blocks SET project_id = ?1, containing_document_id = ?2, \
               location_revision = location_revision + 1, updated_at = ?3 \
             WHERE id = ?4 AND project_id = ?5 AND location_kind = 'document' \
               AND containing_document_id = ?6 AND lifecycle = 'active'",
            params![
                prepared.target_authority.head.project_id,
                target_document_id,
                now,
                block_id,
                prepared.source_authority.head.project_id,
                prepared.source_authority.head.id
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                format!("Block {block_id} moved while the transfer was being prepared"),
                true,
            ));
        }
    }
    Ok(())
}

fn validate_source_roots(
    connection: &Connection,
    project_id: &str,
    source_document_id: &str,
    root_block_ids: &[String],
) -> Result<BTreeMap<String, i64>, StoreError> {
    let mut revisions = BTreeMap::new();
    for block_id in root_block_ids {
        let row = connection
            .query_row(
                "SELECT block.location_revision, block.lifecycle, block.location_kind, \
                        block.containing_document_id \
                 FROM blocks block JOIN document_block_index index_row ON index_row.block_id = block.id \
                   AND index_row.document_id = ?1 \
                 WHERE block.id = ?2 AND block.project_id = ?3",
                params![source_document_id, block_id, project_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| not_found(format!("Source Block does not exist: {block_id}")))?;
        if row.1 != "active" || row.2 != "document" || row.3.as_deref() != Some(source_document_id)
        {
            return Err(invalid(format!(
                "Source Block {block_id} is outside the source Document authority"
            )));
        }
        revisions.insert(block_id.clone(), row.0);
    }
    Ok(revisions)
}

fn resolve_source_document(
    connection: &Connection,
    library_id: &str,
    source: &LibraryBlockTransferSource,
) -> Result<String, StoreError> {
    match source {
        LibraryBlockTransferSource::Document { document_id } => Ok(document_id.clone()),
        LibraryBlockTransferSource::Page { page_id } => {
            resolve_page_document(connection, library_id, page_id)
        }
        LibraryBlockTransferSource::Library { .. }
        | LibraryBlockTransferSource::DataSource { .. } => Err(invalid(
            "Ordinary Block transfer currently requires a Document or Page source",
        )),
    }
}

fn resolve_target_document(
    connection: &Connection,
    library_id: &str,
    target: &LibraryBlockTransferTarget,
) -> Result<(String, BlockSubtreeInsertionTarget), StoreError> {
    match target {
        LibraryBlockTransferTarget::Document {
            document_id,
            parent_block_id,
            before_block_id,
        } => Ok((
            document_id.clone(),
            BlockSubtreeInsertionTarget {
                parent_block_id: parent_block_id.clone(),
                before_block_id: before_block_id.clone(),
            },
        )),
        LibraryBlockTransferTarget::Page {
            page_id,
            parent_block_id,
            before_block_id,
        } => Ok((
            resolve_page_document(connection, library_id, page_id)?,
            BlockSubtreeInsertionTarget {
                parent_block_id: parent_block_id.clone(),
                before_block_id: before_block_id.clone(),
            },
        )),
        LibraryBlockTransferTarget::Library { .. }
        | LibraryBlockTransferTarget::DataSource { .. } => Err(invalid(
            "Ordinary Block transfer currently requires a Document or Page target",
        )),
    }
}

fn resolve_page_document(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT document_id FROM pages WHERE block_id = ?1 AND library_id = ?2 \
             AND lifecycle = 'active'",
            params![page_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found(format!("Page does not exist: {page_id}")))
}

fn require_transfer_authority(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    document_id: &str,
    declared_page_id: Option<&str>,
    access: TransferDocumentAccess,
) -> Result<DocumentAuthorityRow, StoreError> {
    let authority = read_document_authority(connection, document_id)?
        .ok_or_else(|| not_found(format!("Document does not exist: {document_id}")))?;
    if authority.owner_lifecycle != "active" || !authority.head.is_live_yjs_authority() {
        return Err(invalid("Document is not writable live Yjs authority"));
    }
    require_schema(&authority)?;
    if let Some(page_id) = declared_page_id
        && (authority.owner_type != "page" || authority.owner_block_id != page_id)
    {
        return Err(corrupt("Page alias does not own its resolved Document"));
    }
    if authority.head.project_id == project_id {
        return Ok(authority);
    }
    if authority.owner_type != "page"
        || authority.page_library_id.as_deref() != Some(library_id)
        || authority.page_lifecycle.as_deref() != Some("active")
    {
        return Err(not_found("Document is not available to the bound Project"));
    }
    match access {
        TransferDocumentAccess::Read => super::require_page_read_access(
            connection,
            library_id,
            project_id,
            &authority.owner_block_id,
        )?,
        TransferDocumentAccess::Write => super::require_page_write_access(
            connection,
            library_id,
            project_id,
            &authority.owner_block_id,
        )?,
    }
    Ok(authority)
}

fn require_schema(authority: &DocumentAuthorityRow) -> Result<BlockDocumentSchema, StoreError> {
    BlockDocumentSchema::from_identity(&authority.head.schema_key, authority.head.schema_version)
        .ok_or_else(|| invalid("Document schema is not a registered Block tree"))
}

fn validate_intent(
    library_id: &str,
    intent: &LibraryBlockTransferLogicalIntent,
) -> Result<(), StoreError> {
    let actor_bytes = serde_json::to_vec(&intent.actor)
        .map_err(|_| invalid("Block transfer actor must be portable JSON"))?;
    if !intent.actor.is_object() || actor_bytes.len() > MAX_ACTOR_BYTES {
        return Err(invalid("Block transfer actor must be a bounded object"));
    }
    if intent.root_block_ids.is_empty() || intent.root_block_ids.len() > MAX_TRANSFER_ROOTS {
        return Err(invalid(
            "Block transfer root selection is outside its bound",
        ));
    }
    let mut unique = BTreeSet::new();
    for block_id in &intent.root_block_ids {
        validate_id(block_id, "root_block_id")?;
        if !unique.insert(block_id) {
            return Err(invalid(
                "Block transfer root selection contains a duplicate",
            ));
        }
    }
    match &intent.source {
        LibraryBlockTransferSource::Library {
            library_id: source_library_id,
        } if source_library_id != library_id => {
            return Err(unauthorized(
                "Block transfer source belongs to another Library",
            ));
        }
        _ => {}
    }
    match &intent.target {
        LibraryBlockTransferTarget::Library {
            library_id: target_library_id,
            ..
        } if target_library_id != library_id => {
            return Err(unauthorized(
                "Block transfer target belongs to another Library",
            ));
        }
        _ => {}
    }
    Ok(())
}

fn is_typed_resource(connection: &Connection, block_id: &str) -> Result<bool, StoreError> {
    let block_type =
        connection.query_row("SELECT type FROM blocks WHERE id = ?1", [block_id], |row| {
            row.get::<_, String>(0)
        })?;
    Ok(matches!(
        block_type.as_str(),
        "page" | "database" | "synced_block_source" | "reusable_template_source" | "canvas"
    ))
}

fn assert_fresh_copy_identities(
    connection: &Connection,
    block_ids: &[String],
) -> Result<(), StoreError> {
    for block_id in block_ids {
        let exists = connection
            .query_row(
                "SELECT 1 FROM blocks WHERE id = ?1 \
                 UNION ALL SELECT 1 FROM retired_block_identities WHERE block_id = ?1 LIMIT 1",
                [block_id],
                |_| Ok(()),
            )
            .optional()?;
        if exists.is_some() {
            return Err(StoreError::new(
                StoreErrorCode::IdempotencyKeyReused,
                format!("Copied Block identity is not fresh: {block_id}"),
                false,
            ));
        }
    }
    Ok(())
}

fn read_final_locations(
    connection: &Connection,
    block_ids: &[String],
) -> Result<FinalBlockLocations, StoreError> {
    let mut locations = BTreeMap::new();
    let mut revisions = BTreeMap::new();
    for block_id in block_ids {
        let row = connection
            .query_row(
                "SELECT location_kind, containing_document_id, containing_database_id, \
                        location_revision, project.library_id, block.project_id, \
                        EXISTS(SELECT 1 FROM library_block_placements placement \
                          WHERE placement.block_id = block.id AND placement.library_id = project.library_id), \
                        top_level.rank_key, membership.data_source_id \
                 FROM blocks block JOIN projects project ON project.id = block.project_id \
                 LEFT JOIN top_level_block_placements top_level ON top_level.block_id = block.id \
                 LEFT JOIN data_source_page_memberships membership \
                   ON membership.page_block_id = block.id AND membership.removed_at IS NULL \
                 WHERE block.id = ?1",
                [block_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, bool>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| corrupt(format!("Committed Block disappeared: {block_id}")))?;
        let location = match (row.0.as_str(), row.1, row.2, row.6, row.7, row.8) {
            ("document", Some(document_id), None, false, None, None) => {
                LibraryBlockLocation::Document { document_id }
            }
            ("space", None, None, true, Some(rank_key), None) => LibraryBlockLocation::Library {
                library_id: row.4,
                project_id: row.5,
                rank_key,
            },
            ("database", None, Some(database_id), false, None, Some(data_source_id)) => {
                LibraryBlockLocation::DataSource {
                    database_id,
                    data_source_id,
                }
            }
            _ => {
                return Err(corrupt(format!(
                    "Committed Block has invalid location: {block_id}"
                )));
            }
        };
        locations.insert(block_id.clone(), location);
        revisions.insert(block_id.clone(), row.3);
    }
    Ok((locations, revisions))
}

#[allow(clippy::too_many_arguments)]
fn persist_relocation_ledger(
    connection: &Connection,
    operation_id: &str,
    project_id: &str,
    store_epoch: &str,
    request_hash: &str,
    intent: &LibraryBlockTransferLogicalIntent,
    prepared: &PreparedTransfer,
    result: &LibraryBlockTransferResult,
    final_location_revisions: &BTreeMap<String, i64>,
    source_pre_state_vector: &[u8],
    source_pre_full_state: &[u8],
    source_pre_state_hash: &str,
    change_log_seq: i64,
    now: &str,
) -> Result<(), StoreError> {
    let source_commit = result
        .document_commits
        .iter()
        .find(|commit| commit.document_id == prepared.source_authority.head.id)
        .ok_or_else(|| corrupt("Relocation omitted its source commit"))?;
    let target_commit = result
        .document_commits
        .iter()
        .find(|commit| commit.document_id == prepared.target_authority.head.id)
        .ok_or_else(|| corrupt("Relocation omitted its target commit"))?;
    let insertion = match &intent.target {
        LibraryBlockTransferTarget::Page {
            parent_block_id,
            before_block_id,
            ..
        }
        | LibraryBlockTransferTarget::Document {
            parent_block_id,
            before_block_id,
            ..
        } => (parent_block_id.as_deref(), before_block_id.as_deref()),
        _ => (None, None),
    };
    let request_json =
        serde_json::to_string(intent).map_err(|_| internal("Relocation request JSON"))?;
    let roots_json = serde_json::to_string(&intent.root_block_ids)
        .map_err(|_| internal("Relocation roots JSON"))?;
    let expected_revisions_json = serde_json::to_string(&prepared.expected_location_revisions)
        .map_err(|_| internal("Relocation expected revisions JSON"))?;
    let final_revisions_json = serde_json::to_string(final_location_revisions)
        .map_err(|_| internal("Relocation final revisions JSON"))?;
    let result_json =
        serde_json::to_string(result).map_err(|_| internal("Relocation result JSON"))?;
    connection.execute(
        "INSERT INTO block_relocations(\
           id, project_id, target_project_id, store_epoch, request_hash, request_json, \
           source_document_id, source_generation, source_base_head_seq, target_kind, \
           target_document_id, target_generation, target_base_head_seq, target_parent_block_id, \
           target_before_block_id, root_block_ids_json, expected_location_revisions_json, status, \
           source_update_id, source_committed_seq, target_update_id, target_committed_seq, \
           final_location_revisions_json, result_json, change_log_seq, committed_at\
         ) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'document', ?9, ?10, ?11, \
                   ?12, ?13, ?14, ?15, 'committed', ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        params![
            operation_id,
            project_id,
            store_epoch,
            request_hash,
            request_json,
            prepared.source_authority.head.id,
            prepared.source_authority.head.generation,
            prepared.source_authority.head.head_seq,
            prepared.target_authority.head.id,
            prepared.target_authority.head.generation,
            prepared.target_authority.head.head_seq,
            insertion.0,
            insertion.1,
            roots_json,
            expected_revisions_json,
            source_commit.update_id,
            source_commit.head_seq,
            target_commit.update_id,
            target_commit.head_seq,
            final_revisions_json,
            result_json,
            change_log_seq,
            now,
        ],
    )?;
    let roots = intent.root_block_ids.iter().collect::<BTreeSet<_>>();
    for (ordinal, block_id) in prepared.prepared.source_forest.block_ids.iter().enumerate() {
        let source_revision = final_location_revisions
            .get(block_id)
            .copied()
            .ok_or_else(|| corrupt("Relocation member has no final revision"))?
            - 1;
        connection.execute(
            "INSERT INTO block_relocation_members(\
               relocation_id, block_id, tree_ordinal, is_root, source_project_id, \
               final_project_id, source_location_revision, final_location_revision\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
            params![
                operation_id,
                block_id,
                i64::try_from(ordinal).map_err(|_| internal("Relocation ordinal overflow"))?,
                i64::from(roots.contains(block_id)),
                project_id,
                source_revision,
                source_revision + 1,
            ],
        )?;
    }
    connection.execute(
        "INSERT INTO block_relocation_source_states(\
           relocation_id, document_id, project_id, generation, head_seq, pre_state_vector, \
           pre_full_update, pre_full_update_byte_length, pre_state_hash, captured_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            operation_id,
            prepared.source_authority.head.id,
            project_id,
            prepared.source_authority.head.generation,
            prepared.source_authority.head.head_seq,
            source_pre_state_vector,
            source_pre_full_state,
            i64::try_from(source_pre_full_state.len())
                .map_err(|_| internal("Relocation source state length overflow"))?,
            source_pre_state_hash,
            now,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn persist_mutation_ledger(
    connection: &Connection,
    operation_id: &str,
    project_id: &str,
    store_epoch: &str,
    request_hash: &str,
    intent: &LibraryBlockTransferLogicalIntent,
    result: &LibraryBlockTransferResult,
    change_log_seq: i64,
    now: &str,
) -> Result<(), StoreError> {
    let document_heads = result
        .document_commits
        .iter()
        .map(|commit| (commit.document_id.clone(), commit.head_seq))
        .collect::<BTreeMap<_, _>>();
    connection.execute(
        "INSERT INTO block_mutations(\
           mutation_id, project_id, store_epoch, mutation_kind, actor_json, client_session_id, \
           request_hash, request_json, target_block_ids_json, affected_document_ids_json, \
           affected_database_block_ids_json, field_intents_json, expected_revisions_json, outcome, \
           result_json, committed_revisions_json, document_heads_json, change_log_seq, recorded_at\
         ) VALUES (?1, ?2, ?3, 'block_transfer', ?4, NULL, ?5, ?6, ?7, ?8, '[]', '[]', \
                   '{}', 'committed', ?9, '{}', ?10, ?11, ?12)",
        params![
            operation_id,
            project_id,
            store_epoch,
            serde_json::to_string(&intent.actor).map_err(|_| internal("Transfer actor JSON"))?,
            request_hash,
            serde_json::to_string(intent).map_err(|_| internal("Transfer request JSON"))?,
            serde_json::to_string(&result.result_root_block_ids)
                .map_err(|_| internal("Transfer target IDs JSON"))?,
            serde_json::to_string(
                &result
                    .document_commits
                    .iter()
                    .map(|commit| commit.document_id.clone())
                    .collect::<Vec<_>>(),
            )
            .map_err(|_| internal("Transfer Document IDs JSON"))?,
            serde_json::to_string(result).map_err(|_| internal("Transfer result JSON"))?,
            serde_json::to_string(&document_heads)
                .map_err(|_| internal("Transfer Document heads JSON"))?,
            change_log_seq,
            now,
        ],
    )?;
    Ok(())
}

fn persist_operation_checkpoints(
    connection: &Connection,
    context: &BoundModuleContext,
    operation_id: &str,
    actor: &Value,
    commits: &[PersistedTransferCommit],
    change_log_seq: i64,
    now: &str,
) -> Result<(), StoreError> {
    for commit in commits {
        let authority = read_document_authority(connection, &commit.public.document_id)?
            .ok_or_else(|| corrupt("Committed transfer Document disappeared"))?;
        insert_document_checkpoint(
            connection,
            &authority,
            &commit.materialization,
            NewDocumentCheckpoint {
                operation_id,
                cause: "block-transfer",
                label: None,
                revision_kind: "operation",
                source_mutation_id: Some(operation_id),
                source_change_seq: Some(change_log_seq),
                actor: Some(actor),
                context,
                now,
            },
        )?;
    }
    Ok(())
}

fn bound_project_id(context: &BoundModuleContext) -> Result<&str, StoreError> {
    context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| unauthorized("Block transfer requires a bound Project"))
}

fn validate_id(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.trim() == value && value.len() <= MAX_ID_LENGTH {
        return Ok(());
    }
    Err(invalid(format!("{label} is invalid")))
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

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn semantic_identity_ignores_connection_and_adapter_attempt() {
        let intent = LibraryBlockTransferLogicalIntent {
            actor: json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec!["block-1".to_owned()],
            source: LibraryBlockTransferSource::Document {
                document_id: "document-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Document {
                document_id: "document-2".to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let mut first = BoundModuleContext {
            profile_id: nodex_core_contracts::ProfileId("profile-1".to_owned()),
            library_id: nodex_core_contracts::LibraryId("library-1".to_owned()),
            project_id: Some(nodex_core_contracts::ProjectId("project-1".to_owned())),
            adapter: nodex_core_contracts::AdapterKind::ElectronHost,
            connection_id: "connection-1".to_owned(),
        };
        let expected = semantic_request_hash(&first, "epoch-1", &intent).unwrap();
        first.adapter = nodex_core_contracts::AdapterKind::Test;
        first.connection_id = "connection-2".to_owned();
        assert_eq!(
            semantic_request_hash(&first, "epoch-1", &intent).unwrap(),
            expected
        );
    }
}
