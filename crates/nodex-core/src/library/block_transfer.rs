use std::collections::{BTreeMap, BTreeSet};

use nodex_core_contracts::library::{
    LibraryBlockLocation, LibraryBlockTransferDocumentCommit, LibraryBlockTransferDocumentHead,
    LibraryBlockTransferLogicalIntent, LibraryBlockTransferMode, LibraryBlockTransferPlan,
    LibraryBlockTransferPreparation, LibraryBlockTransferResult, LibraryBlockTransferSource,
    LibraryBlockTransferTarget, LibraryCommitValue, LibraryReceipt,
};
use nodex_core_contracts::{BoundModuleContext, CommittedModuleValue};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::document::{
    BlockDocumentSchema, DocumentAuthorityRow, DocumentMaterialization, NewDocumentCheckpoint,
    PersistYjsCommit, PortableSubtreeDocumentHead, PortableSubtreeTransferKind,
    PortableSubtreeTransferRequest, PreparedDocumentOperationUpdate, YrsDocumentEngine,
    decode_block_document, insert_document_checkpoint, materialize_decoded_document,
    persist_yjs_commit, prepare_portable_subtree_transfer_updates, read_document_authority,
    reconstruct_yjs_engine, sha256,
};
use crate::domain::identity::stable_uuid_v7;
use crate::domain::subtree::BlockSubtreeInsertionTarget;
use crate::infrastructure::module_receipts::read_module_receipt;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::LibraryApplyOutcome;
use super::mutation::{MutationEffects, finish_mutation, sqlite_now};

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
    write_fence: Option<&[LibraryBlockTransferDocumentHead]>,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_intent(library_id, intent)?;
    let mut prepared = prepare_transfer(connection, context, library_id, operation_id, intent)?;
    let expected_preparation = preparation(&prepared);
    if write_fence != Some(expected_preparation.lease_documents.as_slice()) {
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
                .lease_documents
                .iter()
                .map(|head| head.document_id.clone())
                .collect(),
            committed_revisions,
            page_copy: None,
            block_transfer: Some(result.clone()),
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
        lease_documents: documents,
        expected_location_revisions: prepared.expected_location_revisions.clone(),
        source_document_id: prepared.source_authority.head.id.clone(),
        target_document_id: prepared.target_authority.head.id.clone(),
    }
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
                        location_revision FROM blocks WHERE id = ?1",
                [block_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| corrupt(format!("Committed Block disappeared: {block_id}")))?;
        let location = match (row.0.as_str(), row.1, row.2) {
            ("document", Some(document_id), None) => LibraryBlockLocation::Document { document_id },
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
