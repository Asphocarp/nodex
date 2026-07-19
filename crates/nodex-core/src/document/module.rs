use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use nodex_core_contracts::document::{
    DocumentCommitOutcome, DocumentInvalidationReason, DocumentOwnerCommand,
    OwnedDocumentCommitValue, OwnedDocumentEvent, OwnedDocumentIntent, OwnedDocumentRead,
    OwnedDocumentReadValue, OwnedDocumentReceipt,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreError, CoreErrorCode, CoreErrorRecovery, CoreModuleEventPayload, ModuleApplyRequest,
    ModuleMutationReceipt, ModuleReadRequest, ModuleReadSnapshot, StoreEpoch,
};
use rusqlite::{OptionalExtension, TransactionBehavior};
use serde_json::{Value, json};
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, Transact};

use crate::infrastructure::document_repository::{
    DocumentAuthority, DocumentReadiness, DocumentSyncEngine,
};
use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

use super::canvas::{
    ensure_canvas_scene, load_canvas_scene, persist_canvas_mutation, validate_canvas_authority,
};
use super::canvas_scene::{
    apply_canvas_mutation as apply_canvas_candidate, parse_canvas_mutation, prepare_canvas_restore,
};
use super::compaction::{DocumentCompactionResult, compact_yjs_document};
use super::event_log::{DocumentEventReplay, replay_document_events};
use super::genesis::{prepare_editable_root, prepare_yjs_genesis};
use super::history::{
    NewDocumentCheckpoint, get_document_version, insert_canvas_checkpoint,
    insert_document_checkpoint, list_document_versions, prepare_canvas_revision,
    prepare_document_revision, prepare_version_restore, record_document_revision_edit,
};
use super::owners::execute_owner_command;
use super::persistence::{
    DocumentAuthorityRow, PersistYjsCommit, PersistYjsGenesis, derive_touched_block_ids,
    persist_yjs_commit, persist_yjs_genesis, read_document_authority, read_event_head,
    read_store_epoch, sha256,
};
use super::recovery::{StaleYjsUpdate, persist_recovery_if_barrier_crossed};
use super::runtime::DocumentRuntimeCache;
use super::semantic::{SemanticMutationContext, SemanticMutationError, prepare_semantic_mutation};
use super::{
    BlockDocumentSchema, DocumentMaterialization, YrsEngineError, decode_block_document,
    materialize_decoded_document,
};

const MODULE_NAME: &str = "owned_document";
static DOCUMENT_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

struct DocumentUpdateJob {
    context: BoundModuleContext,
    operation_id: String,
    expected_store_epoch: StoreEpoch,
    document_id: String,
    generation: i64,
    operation_kind: &'static str,
    request_hash: String,
    publication: UpdatePublication,
}

#[derive(Clone, Copy)]
enum UpdatePublication {
    Updated,
    Invalidated(DocumentInvalidationReason),
}

enum PreparedUpdate {
    Apply {
        base_head_seq: i64,
        update_id: String,
        touched_block_ids: Vec<String>,
        update: Vec<u8>,
        write_fence_block_ids: Vec<String>,
        title_write_fence_required: bool,
    },
    NoChange,
    Recovery {
        artifact_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocumentCacheMetrics {
    pub entries: usize,
    pub state_bytes: usize,
    pub hits: u64,
    pub misses: u64,
}

#[derive(Debug, Clone)]
pub struct OwnedDocumentApplyOutcome {
    pub committed: CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
    pub events: Vec<CommittedCoreModuleEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RealtimeDocumentBoundary {
    pub(crate) store_epoch: StoreEpoch,
    pub(crate) generation: i64,
    pub(crate) head_seq: i64,
    pub(crate) event_head: i64,
    pub(crate) engine: DocumentSyncEngine,
}

#[derive(Clone)]
pub struct OwnedDocumentModule {
    profile_id: String,
    library_id: String,
    writer: StoreWriter,
    readers: StoreReaders,
    cache: Arc<Mutex<DocumentRuntimeCache>>,
    fail_after_commit: Arc<AtomicBool>,
    assets_root: PathBuf,
}

impl OwnedDocumentModule {
    pub fn new(
        profile_id: impl Into<String>,
        library_id: impl Into<String>,
        kernel: &SqliteStoreKernel,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            library_id: library_id.into(),
            writer: kernel.writer(),
            readers: kernel.readers(),
            cache: Arc::new(Mutex::new(DocumentRuntimeCache::new())),
            fail_after_commit: Arc::new(AtomicBool::new(false)),
            assets_root: kernel
                .database_path()
                .parent()
                .expect("Profile database has a parent")
                .join("assets"),
        }
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<OwnedDocumentRead>,
    ) -> Result<ModuleReadSnapshot<OwnedDocumentReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid("Unsupported Owned Document contract version"));
        }
        match request.read {
            OwnedDocumentRead::Descriptor { owner_block_id } => self
                .readers
                .read_default(|connection| {
                    let authority = connection
                        .query_row(
                            "SELECT ownership.document_id FROM block_documents ownership \
                             WHERE ownership.block_id = ?1",
                            [&owner_block_id],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()?
                        .ok_or_else(|| not_found("Owned Document descriptor was not found"))?;
                    let authority = read_document_authority(connection, &authority)?
                        .ok_or_else(|| not_found("Owned Document was not found"))?;
                    authorize_project(context, &authority)?;
                    let store_epoch = read_store_epoch(connection)?;
                    Ok(ModuleReadSnapshot {
                        version: CORE_CONTRACT_VERSION,
                        store_epoch: StoreEpoch(store_epoch.clone()),
                        event_head: read_event_head(connection)?,
                        value: OwnedDocumentReadValue::Descriptor {
                            descriptor: authority_descriptor(&authority, &store_epoch),
                        },
                    })
                })
                .map_err(core_error),
            OwnedDocumentRead::SyncYjs {
                document_id,
                state_vector,
            } => {
                let context = context.clone();
                let cache = Arc::clone(&self.cache);
                self.writer
                    .call(move |connection| {
                        let authority = read_document_authority(connection, &document_id)?
                            .ok_or_else(|| not_found("Owned Document was not found"))?;
                        authorize_yjs(&context, &authority)?;
                        let update = cache
                            .lock()
                            .map_err(|_| internal("Document cache lock failed"))?
                            .sync_diff(connection, &authority.head, &state_vector)?;
                        let store_epoch = read_store_epoch(connection)?;
                        Ok(ModuleReadSnapshot {
                            version: CORE_CONTRACT_VERSION,
                            store_epoch: StoreEpoch(store_epoch.clone()),
                            event_head: read_event_head(connection)?,
                            value: OwnedDocumentReadValue::YjsSync {
                                descriptor: authority_descriptor(&authority, &store_epoch),
                                update,
                            },
                        })
                    })
                    .map_err(core_error)
            }
            OwnedDocumentRead::ListVersions {
                document_id,
                before_version_id,
                limit,
            } => self
                .readers
                .read_default(|connection| {
                    let authority = read_document_authority(connection, &document_id)?
                        .ok_or_else(|| not_found("Owned Document was not found"))?;
                    authorize_owned_document(context, &authority)?;
                    let (items, next_version_id) = list_document_versions(
                        connection,
                        &authority,
                        before_version_id.as_deref(),
                        limit,
                    )?;
                    Ok(ModuleReadSnapshot {
                        version: CORE_CONTRACT_VERSION,
                        store_epoch: StoreEpoch(read_store_epoch(connection)?),
                        event_head: read_event_head(connection)?,
                        value: OwnedDocumentReadValue::Versions {
                            items,
                            next_version_id,
                        },
                    })
                })
                .map_err(core_error),
            OwnedDocumentRead::GetVersion {
                document_id,
                version_id,
            } => self
                .readers
                .read_default(|connection| {
                    let authority = read_document_authority(connection, &document_id)?
                        .ok_or_else(|| not_found("Owned Document was not found"))?;
                    authorize_owned_document(context, &authority)?;
                    let version = get_document_version(connection, &authority, &version_id)?
                        .ok_or_else(|| not_found("Document version was not found"))?;
                    Ok(ModuleReadSnapshot {
                        version: CORE_CONTRACT_VERSION,
                        store_epoch: StoreEpoch(read_store_epoch(connection)?),
                        event_head: read_event_head(connection)?,
                        value: OwnedDocumentReadValue::Version {
                            value: json!({
                                "summary": version.summary,
                                "materialization": version.materialization,
                            }),
                        },
                    })
                })
                .map_err(core_error),
            OwnedDocumentRead::SyncCanvas { document_id } => self
                .readers
                .read_default(|connection| {
                    let authority = read_document_authority(connection, &document_id)?
                        .ok_or_else(|| not_found("Owned Document was not found"))?;
                    authorize_canvas(context, &authority)?;
                    let loaded = load_canvas_scene(connection, &authority)?;
                    let store_epoch = read_store_epoch(connection)?;
                    Ok(ModuleReadSnapshot {
                        version: CORE_CONTRACT_VERSION,
                        store_epoch: StoreEpoch(store_epoch.clone()),
                        event_head: read_event_head(connection)?,
                        value: OwnedDocumentReadValue::CanvasSync {
                            descriptor: authority_descriptor(&authority, &store_epoch),
                            scene_json: loaded.scene.canonical_json()?.into_bytes(),
                            scene_hash: loaded.scene_hash,
                        },
                    })
                })
                .map_err(core_error),
        }
    }

    pub fn apply(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<OwnedDocumentIntent>,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid("Unsupported Owned Document contract version"));
        }
        match request.intent {
            OwnedDocumentIntent::PrepareOwner { owner_block_id } => self.prepare_owner(
                context,
                request.operation_id,
                request.store_epoch,
                owner_block_id,
            ),
            OwnedDocumentIntent::ApplyYjsUpdate {
                document_id,
                generation,
                base_head_seq,
                update_id,
                touched_block_ids,
                update,
            } => self.apply_yjs_update(
                context,
                request.operation_id,
                request.store_epoch,
                document_id,
                generation,
                base_head_seq,
                update_id,
                touched_block_ids,
                update,
            ),
            OwnedDocumentIntent::ApplySemanticMutation {
                document_id,
                generation,
                expected_head_seq,
                commands,
            } => self.apply_semantic_mutation(
                context,
                request.operation_id,
                request.store_epoch,
                document_id,
                generation,
                expected_head_seq,
                commands,
            ),
            OwnedDocumentIntent::ApplyCanvasMutation {
                document_id,
                generation,
                expected_head_seq,
                mutation,
            } => self.apply_canvas_scene_mutation(
                context,
                request.operation_id,
                request.store_epoch,
                document_id,
                generation,
                expected_head_seq,
                mutation,
            ),
            OwnedDocumentIntent::CreateCheckpoint {
                document_id,
                generation,
                expected_head_seq,
                cause,
                label,
            } => self.create_checkpoint(
                context,
                request.operation_id,
                request.store_epoch,
                document_id,
                generation,
                expected_head_seq,
                cause,
                label,
            ),
            OwnedDocumentIntent::RestoreVersion {
                document_id,
                version_id,
                generation,
                expected_head_seq,
            } => self.restore_version(
                context,
                request.operation_id,
                request.store_epoch,
                document_id,
                version_id,
                generation,
                expected_head_seq,
            ),
            OwnedDocumentIntent::ApplyOwnerCommand { command } => self.apply_owner_command(
                context,
                request.operation_id,
                request.store_epoch,
                command,
            ),
        }
    }

    pub(crate) fn authorize_realtime_subscription(
        &self,
        context: &BoundModuleContext,
        document_id: &str,
    ) -> Result<RealtimeDocumentBoundary, CoreError> {
        self.validate_context(context)?;
        self.readers
            .read_default(|connection| {
                let authority = read_document_authority(connection, document_id)?
                    .ok_or_else(|| not_found("Owned Document was not found"))?;
                authorize_owned_document(context, &authority)?;
                Ok(RealtimeDocumentBoundary {
                    store_epoch: StoreEpoch(read_store_epoch(connection)?),
                    generation: authority.head.generation,
                    head_seq: authority.head.head_seq,
                    event_head: read_event_head(connection)?,
                    engine: authority.head.sync_engine,
                })
            })
            .map_err(core_error)
    }

    pub(crate) fn replay_document_events(
        &self,
        context: &BoundModuleContext,
        after: i64,
        limit: Option<u32>,
    ) -> Result<DocumentEventReplay, CoreError> {
        self.validate_context(context)?;
        let project_id = context
            .project_id
            .as_ref()
            .ok_or_else(|| unauthorized_core("Document event replay requires a bound Project"))?;
        self.readers
            .read_default(|connection| {
                replay_document_events(connection, &project_id.0, after, limit)
            })
            .map_err(core_error)
    }

    pub fn cache_metrics(&self) -> Result<DocumentCacheMetrics, CoreError> {
        let stats = self
            .cache
            .lock()
            .map_err(|_| core_error(internal("Document cache lock failed")))?
            .stats();
        Ok(DocumentCacheMetrics {
            entries: stats.entries,
            state_bytes: stats.state_bytes,
            hits: stats.hits,
            misses: stats.misses,
        })
    }

    pub fn inject_failure_after_next_commit(&self) {
        self.fail_after_commit.store(true, Ordering::Release);
    }

    pub fn compact(
        &self,
        context: &BoundModuleContext,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
    ) -> Result<DocumentCompactionResult, CoreError> {
        self.validate_context(context)?;
        let context = context.clone();
        let cache = Arc::clone(&self.cache);
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                if read_store_epoch(&transaction)? != expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Document compaction targets a stale store epoch",
                        true,
                    ));
                }
                let authority = read_document_authority(&transaction, &document_id)?
                    .ok_or_else(|| not_found("Owned Document was not found"))?;
                authorize_yjs(&context, &authority)?;
                assert_document_head(&authority, generation, expected_head_seq)?;
                let engine = cache
                    .lock()
                    .map_err(|_| internal("Document cache lock failed"))?
                    .clone_engine(&transaction, &authority.head)?;
                let result = compact_yjs_document(&transaction, &authority, &engine)?;
                transaction.commit()?;
                cache
                    .lock()
                    .map_err(|_| internal("Document cache lock failed"))?
                    .install(&authority.head, engine);
                Ok(result)
            })
            .map_err(core_error)
    }

    fn apply_owner_command(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        command: DocumentOwnerCommand,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let fingerprint = serde_json::to_vec(&(context, expected_store_epoch.clone(), &command))
            .map_err(|_| invalid("Document owner command cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let context = context.clone();
        let cache = Arc::clone(&self.cache);
        let fail_after_commit = Arc::clone(&self.fail_after_commit);
        let assets_root = self.assets_root.clone();
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let store_epoch = read_store_epoch(&transaction)?;
                if store_epoch != expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Document owner command targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(stored) = read_module_receipt(&transaction, MODULE_NAME, &operation_id)?
                {
                    if stored.request_hash != request_hash {
                        return Err(StoreError::new(
                            StoreErrorCode::IdempotencyKeyReused,
                            "operation_id is already bound to another Owned Document intent",
                            false,
                        ));
                    }
                    let mut committed = serde_json::from_value::<
                        CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
                    >(stored.result)
                    .map_err(|_| corrupt_receipt())?;
                    committed.receipt.mutation.duplicate = true;
                    transaction.commit()?;
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let executed = execute_owner_command(
                    &transaction,
                    &context,
                    &store_epoch,
                    &operation_id,
                    &command,
                    &assets_root,
                )?;
                let committed = CommittedModuleValue {
                    value: OwnedDocumentCommitValue {
                        document_id: executed.primary_document_id.clone(),
                        generation: executed.generation,
                        head_seq: executed.head_seq,
                        outcome: DocumentCommitOutcome::Committed,
                        canvas: None,
                        owner_effect: Some(executed.effect),
                    },
                    receipt: OwnedDocumentReceipt {
                        mutation: ModuleMutationReceipt {
                            operation_id: operation_id.clone(),
                            duplicate: false,
                        },
                        document_id: executed.primary_document_id,
                        generation: executed.generation,
                        head_seq: executed.head_seq,
                    },
                    event_sequence: executed.event_sequence,
                    store_epoch: StoreEpoch(store_epoch.clone()),
                };
                insert_typed_receipt(
                    &transaction,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    owner_command_kind(&command),
                    &committed,
                    executed.events.last().map(|event| event.sequence),
                )?;
                transaction.commit()?;
                {
                    let mut cache = cache
                        .lock()
                        .map_err(|_| internal("Document cache lock failed"))?;
                    for document_id in &executed.invalidate_document_ids {
                        cache.invalidate(document_id);
                    }
                }
                if fail_after_commit.swap(false, Ordering::AcqRel) {
                    return Err(StoreError::new(
                        StoreErrorCode::Internal,
                        "Injected failure after durable Document owner command",
                        true,
                    ));
                }
                Ok(OwnedDocumentApplyOutcome {
                    committed,
                    events: executed.events,
                })
            })
            .map_err(core_error)
    }

    fn prepare_owner(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        owner_block_id: String,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let fingerprint =
            serde_json::to_vec(&(context, expected_store_epoch.clone(), &owner_block_id))
                .map_err(|_| invalid("Owned Document preparation cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let context = context.clone();
        let cache = Arc::clone(&self.cache);
        let fail_after_commit = Arc::clone(&self.fail_after_commit);
        let assets_root = self.assets_root.clone();
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let store_epoch = read_store_epoch(&transaction)?;
                if store_epoch != expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Owned Document preparation targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(stored) = read_module_receipt(&transaction, MODULE_NAME, &operation_id)?
                {
                    if stored.request_hash != request_hash {
                        return Err(StoreError::new(
                            StoreErrorCode::IdempotencyKeyReused,
                            "operation_id is already bound to another Owned Document intent",
                            false,
                        ));
                    }
                    let mut committed = serde_json::from_value::<
                        CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
                    >(stored.result)
                    .map_err(|_| corrupt_receipt())?;
                    committed.receipt.mutation.duplicate = true;
                    transaction.commit()?;
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let document_id = transaction
                    .query_row(
                        "SELECT document_id FROM block_documents WHERE block_id = ?1",
                        [&owner_block_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| not_found("Owned Document owner was not found"))?;
                let authority = read_document_authority(&transaction, &document_id)?
                    .ok_or_else(|| not_found("Owned Document was not found"))?;
                authorize_project(&context, &authority)?;
                if authority.owner_block_id != owner_block_id
                    || authority.owner_lifecycle != "active"
                {
                    return Err(StoreError::new(
                        StoreErrorCode::Unauthorized,
                        "Owned Document owner is not active",
                        false,
                    ));
                }
                if authority.head.sync_engine == DocumentSyncEngine::CanvasScene {
                    authorize_canvas(&context, &authority)?;
                    let (_, created) = ensure_canvas_scene(&transaction, &authority, &assets_root)?;
                    let event_head = read_event_head(&transaction)?;
                    let committed = committed_value(
                        &operation_id,
                        &store_epoch,
                        &authority,
                        authority.head.head_seq,
                        if created {
                            DocumentCommitOutcome::Committed
                        } else {
                            DocumentCommitOutcome::NoChange
                        },
                        event_head,
                    );
                    insert_typed_receipt(
                        &transaction,
                        &context,
                        &operation_id,
                        &request_hash,
                        &store_epoch,
                        "prepare_owner",
                        &committed,
                        None,
                    )?;
                    transaction.commit()?;
                    if fail_after_commit.swap(false, Ordering::AcqRel) {
                        return Err(StoreError::new(
                            StoreErrorCode::Internal,
                            "Injected failure after durable Canvas preparation",
                            true,
                        ));
                    }
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let schema = registered_yjs_schema(&authority)?;
                let root_block_id = allocate_document_block_id(&operation_id, 1);
                let (committed, event, next_head, next_engine) =
                    match (authority.head.readiness, authority.head.authority) {
                        (DocumentReadiness::PendingGenesis, DocumentAuthority::LegacyShadow) => {
                            if authority.head.head_seq != 0 {
                                return Err(StoreError::new(
                                    StoreErrorCode::StoreCorrupt,
                                    "Pending Document genesis has a nonzero head",
                                    false,
                                ));
                            }
                            let prepared = prepare_yjs_genesis(
                                &authority.head.id,
                                &authority.owner_type,
                                schema,
                                &root_block_id,
                            )?;
                            let persisted = persist_yjs_genesis(
                                &transaction,
                                PersistYjsGenesis {
                                    authority: &authority,
                                    materialization: &prepared.materialization,
                                    update_id: &operation_id,
                                    client_session_id: &context.connection_id,
                                    update: &prepared.update_v1,
                                    state_vector: &prepared.state_vector_v1,
                                    full_state: &prepared.update_v1,
                                    store_epoch: &store_epoch,
                                    operation_id: &operation_id,
                                    emit_event: true,
                                },
                            )?;
                            let committed = committed_value(
                                &operation_id,
                                &store_epoch,
                                &authority,
                                persisted.head_seq,
                                DocumentCommitOutcome::Committed,
                                persisted.event_sequence,
                            );
                            let event = CommittedCoreModuleEvent {
                                version: CORE_CONTRACT_VERSION,
                                sequence: persisted.event_sequence,
                                store_epoch: StoreEpoch(store_epoch.clone()),
                                operation_id: Some(operation_id.clone()),
                                committed_at: persisted.committed_at.clone(),
                                payload: CoreModuleEventPayload::OwnedDocument(
                                    OwnedDocumentEvent::DocumentUpdated {
                                        document_id: authority.head.id.clone(),
                                        generation: authority.head.generation,
                                        head_seq: persisted.head_seq,
                                        update: prepared.update_v1.clone(),
                                    },
                                ),
                            };
                            let mut next_head = authority.head.clone();
                            next_head.head_seq = persisted.head_seq;
                            next_head.state_vector = persisted.state_vector;
                            next_head.state_hash = persisted.state_hash;
                            next_head.readiness = DocumentReadiness::Ready;
                            next_head.authority = DocumentAuthority::YdocPrimary;
                            (committed, Some(event), next_head, prepared.engine)
                        }
                        (DocumentReadiness::Ready, DocumentAuthority::YdocPrimary) => {
                            authorize_yjs(&context, &authority)?;
                            let mut engine = cache
                                .lock()
                                .map_err(|_| internal("Document cache lock failed"))?
                                .clone_engine(&transaction, &authority.head)?;
                            let base_materialization = materialize_engine(&engine, schema)?;
                            let Some(prepared) = prepare_editable_root(
                                &authority.head.id,
                                schema,
                                &engine,
                                &root_block_id,
                            )?
                            else {
                                let event_head = read_event_head(&transaction)?;
                                let committed = committed_value(
                                    &operation_id,
                                    &store_epoch,
                                    &authority,
                                    authority.head.head_seq,
                                    DocumentCommitOutcome::NoChange,
                                    event_head,
                                );
                                insert_typed_receipt(
                                    &transaction,
                                    &context,
                                    &operation_id,
                                    &request_hash,
                                    &store_epoch,
                                    "prepare_owner",
                                    &committed,
                                    None,
                                )?;
                                transaction.commit()?;
                                cache
                                    .lock()
                                    .map_err(|_| internal("Document cache lock failed"))?
                                    .install(&authority.head, engine);
                                return Ok(OwnedDocumentApplyOutcome {
                                    committed,
                                    events: Vec::new(),
                                });
                            };
                            let candidate = engine
                                .prepare_update_v1(&prepared.update_v1)
                                .map_err(engine_error)?;
                            let materialization = materialize_candidate(&candidate, schema)?;
                            let candidate_transaction = candidate.document().transact();
                            let state_vector = candidate_transaction.state_vector().encode_v1();
                            let full_state = candidate_transaction
                                .encode_state_as_update_v1(&yrs::StateVector::default());
                            drop(candidate_transaction);
                            let persisted = persist_yjs_commit(
                                &transaction,
                                PersistYjsCommit {
                                    authority: &authority,
                                    base_materialization: &base_materialization,
                                    materialization: &materialization,
                                    update_id: &operation_id,
                                    client_session_id: &context.connection_id,
                                    base_head_seq: authority.head.head_seq,
                                    client_touched_block_ids: &[],
                                    update: &prepared.update_v1,
                                    state_vector: &state_vector,
                                    full_state: &full_state,
                                    store_epoch: &store_epoch,
                                    operation_id: &operation_id,
                                    event_kind: "document_updated",
                                    write_fence_block_ids: &prepared.write_fence_block_ids,
                                    title_write_fence_required: prepared.title_write_fence_required,
                                },
                            )?;
                            let committed = committed_value(
                                &operation_id,
                                &store_epoch,
                                &authority,
                                persisted.head_seq,
                                DocumentCommitOutcome::Committed,
                                persisted.event_sequence,
                            );
                            let event = CommittedCoreModuleEvent {
                                version: CORE_CONTRACT_VERSION,
                                sequence: persisted.event_sequence,
                                store_epoch: StoreEpoch(store_epoch.clone()),
                                operation_id: Some(operation_id.clone()),
                                committed_at: persisted.committed_at.clone(),
                                payload: CoreModuleEventPayload::OwnedDocument(
                                    OwnedDocumentEvent::DocumentUpdated {
                                        document_id: authority.head.id.clone(),
                                        generation: authority.head.generation,
                                        head_seq: persisted.head_seq,
                                        update: prepared.update_v1,
                                    },
                                ),
                            };
                            engine.commit_candidate(candidate).map_err(engine_error)?;
                            let mut next_head = authority.head.clone();
                            next_head.head_seq = persisted.head_seq;
                            next_head.state_vector = persisted.state_vector;
                            next_head.state_hash = persisted.state_hash;
                            (committed, Some(event), next_head, engine)
                        }
                        _ => {
                            return Err(StoreError::new(
                                StoreErrorCode::StoreCorrupt,
                                "Owned Document readiness and authority diverge",
                                false,
                            ));
                        }
                    };
                insert_typed_receipt(
                    &transaction,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    "prepare_owner",
                    &committed,
                    event.as_ref().map(|event| event.sequence),
                )?;
                transaction.commit()?;
                if fail_after_commit.swap(false, Ordering::AcqRel) {
                    cache
                        .lock()
                        .map_err(|_| internal("Document cache lock failed"))?
                        .invalidate(&document_id);
                    return Err(StoreError::new(
                        StoreErrorCode::Internal,
                        "Injected failure after durable Document preparation",
                        true,
                    ));
                }
                cache
                    .lock()
                    .map_err(|_| internal("Document cache lock failed"))?
                    .install(&next_head, next_engine);
                Ok(OwnedDocumentApplyOutcome {
                    committed,
                    events: event.into_iter().collect(),
                })
            })
            .map_err(core_error)
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_canvas_scene_mutation(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        generation: i64,
        base_head_seq: i64,
        mutation_value: Value,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let mutation = parse_canvas_mutation(&mutation_value).map_err(core_error)?;
        let fingerprint = serde_json::to_vec(&(
            context,
            expected_store_epoch.clone(),
            &document_id,
            generation,
            base_head_seq,
            &mutation.canonical_value,
        ))
        .map_err(|_| invalid("Canvas mutation cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let context = context.clone();
        let fail_after_commit = Arc::clone(&self.fail_after_commit);
        let assets_root = self.assets_root.clone();
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let store_epoch = read_store_epoch(&transaction)?;
                if store_epoch != expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Canvas mutation targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(stored) = read_module_receipt(&transaction, MODULE_NAME, &operation_id)?
                {
                    if stored.request_hash != request_hash {
                        return Err(StoreError::new(
                            StoreErrorCode::IdempotencyKeyReused,
                            "operation_id is already bound to another Owned Document intent",
                            false,
                        ));
                    }
                    let mut committed = serde_json::from_value::<
                        CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
                    >(stored.result)
                    .map_err(|_| corrupt_receipt())?;
                    committed.receipt.mutation.duplicate = true;
                    if let Some(canvas) = committed.value.canvas.as_mut()
                        && let Some(object) = canvas.as_object_mut()
                    {
                        object.insert("duplicate".to_owned(), Value::Bool(true));
                    }
                    transaction.commit()?;
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let authority = read_document_authority(&transaction, &document_id)?
                    .ok_or_else(|| not_found("Canvas Document was not found"))?;
                authorize_canvas(&context, &authority)?;
                if authority.head.generation != generation {
                    return Err(StoreError::new(
                        StoreErrorCode::GenerationConflict,
                        "Canvas Document generation does not match",
                        false,
                    ));
                }
                let loaded = load_canvas_scene(&transaction, &authority)?;
                let applied = apply_canvas_candidate(&loaded.scene, &mutation)?;
                if applied.changed() {
                    let revision_now = sqlite_now(&transaction)?;
                    prepare_canvas_revision(
                        &transaction,
                        &authority,
                        &loaded.scene,
                        &context,
                        &revision_now,
                    )?;
                }
                let persisted = persist_canvas_mutation(
                    &transaction,
                    &authority,
                    &context,
                    &store_epoch,
                    &operation_id,
                    base_head_seq,
                    &mutation,
                    &applied,
                    &assets_root,
                    "canvas_scene_updated",
                )?;
                if persisted.event_delta.is_some() {
                    record_document_revision_edit(
                        &transaction,
                        &authority.head.id,
                        authority.head.generation,
                        persisted.head_seq,
                        &context.connection_id,
                        &persisted.committed_at,
                    )?;
                }
                let outcome = if persisted.event_delta.is_some() {
                    DocumentCommitOutcome::Committed
                } else {
                    DocumentCommitOutcome::NoChange
                };
                let committed = committed_canvas_value(
                    &operation_id,
                    &store_epoch,
                    &authority,
                    persisted.head_seq,
                    outcome,
                    persisted.event_sequence,
                    persisted.result.clone(),
                );
                insert_typed_receipt(
                    &transaction,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    "apply_canvas_mutation",
                    &committed,
                    persisted
                        .event_delta
                        .as_ref()
                        .map(|_| persisted.event_sequence),
                )?;
                transaction.commit()?;
                if fail_after_commit.swap(false, Ordering::AcqRel) {
                    return Err(StoreError::new(
                        StoreErrorCode::Internal,
                        "Injected failure after durable Canvas commit",
                        true,
                    ));
                }
                let event = persisted
                    .event_delta
                    .map(|mutation| CommittedCoreModuleEvent {
                        version: CORE_CONTRACT_VERSION,
                        sequence: persisted.event_sequence,
                        store_epoch: StoreEpoch(store_epoch),
                        operation_id: Some(operation_id),
                        committed_at: persisted.committed_at,
                        payload: CoreModuleEventPayload::OwnedDocument(
                            OwnedDocumentEvent::CanvasUpdated {
                                document_id,
                                generation,
                                head_seq: persisted.head_seq,
                                scene_hash: persisted.scene_hash,
                                mutation,
                            },
                        ),
                    });
                Ok(OwnedDocumentApplyOutcome {
                    committed,
                    events: event.into_iter().collect(),
                })
            })
            .map_err(core_error)
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_yjs_update(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        generation: i64,
        base_head_seq: i64,
        update_id: String,
        touched_block_ids: Vec<String>,
        update: Vec<u8>,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        if operation_id != update_id {
            return Err(invalid(
                "Yjs update_id must equal the Module operation_id for durable idempotency",
            ));
        }
        validate_touched_block_ids(&touched_block_ids)?;
        let fingerprint = serde_json::to_vec(&(
            context,
            expected_store_epoch.clone(),
            generation,
            base_head_seq,
            &update_id,
            &touched_block_ids,
            sha256(&update),
            update.len(),
        ))
        .map_err(|_| invalid("Owned Document request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let receipt_document_id = document_id.clone();
        let receipt_update_id = update_id.clone();
        let receipt_context = context.clone();
        self.apply_document_update(
            DocumentUpdateJob {
                context: context.clone(),
                operation_id,
                expected_store_epoch,
                document_id,
                generation,
                operation_kind: "apply_yjs_update",
                request_hash,
                publication: UpdatePublication::Updated,
            },
            move |connection, authority, engine, materialization, store_epoch| {
                if base_head_seq > authority.head.head_seq {
                    return Err(StoreError::new(
                        StoreErrorCode::HeadConflict,
                        "Yjs update is based on a future Document head",
                        true,
                    ));
                }
                let receipt_conflicts =
                    crate::infrastructure::document_repository::DocumentReadRepository::new(
                        connection,
                    )
                    .update_receipt(&receipt_document_id, &receipt_update_id)?
                    .is_some_and(|receipt| {
                        receipt.generation != generation
                            || receipt.client_session_id != receipt_context.connection_id
                            || receipt.base_head_seq != base_head_seq
                            || receipt.client_touched_block_ids != touched_block_ids
                            || receipt.update_hash != sha256(&update)
                            || receipt.update_byte_length
                                != i64::try_from(update.len()).unwrap_or(i64::MAX)
                    });
                if receipt_conflicts {
                    return Err(StoreError::new(
                        StoreErrorCode::IdempotencyKeyReused,
                        "update_id is already bound to another Yjs update",
                        false,
                    ));
                }
                let derived_touched_block_ids = if base_head_seq < authority.head.head_seq {
                    let schema = BlockDocumentSchema::from_identity(
                        &authority.head.schema_key,
                        authority.head.schema_version,
                    )
                    .ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::UnsupportedSchema,
                            "Owned Document schema is unsupported",
                            false,
                        )
                    })?;
                    engine
                        .prepare_update_v1(&update)
                        .ok()
                        .and_then(|candidate| materialize_candidate(&candidate, schema).ok())
                        .map(|after| {
                            derive_touched_block_ids(
                                &authority.owner_block_id,
                                materialization,
                                &after,
                            )
                        })
                } else {
                    None
                };
                if let Some(artifact_id) = persist_recovery_if_barrier_crossed(
                    connection,
                    authority,
                    StaleYjsUpdate {
                        store_epoch,
                        context: &receipt_context,
                        generation,
                        base_head_seq,
                        update_id: &receipt_update_id,
                        touched_block_ids: &touched_block_ids,
                        derived_touched_block_ids: derived_touched_block_ids.as_deref(),
                        update: &update,
                    },
                )? {
                    return Ok(PreparedUpdate::Recovery { artifact_id });
                }
                Ok(PreparedUpdate::Apply {
                    base_head_seq,
                    update_id,
                    touched_block_ids,
                    update,
                    write_fence_block_ids: Vec::new(),
                    title_write_fence_required: false,
                })
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_semantic_mutation(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
        commands: Vec<nodex_core_contracts::document::DocumentSemanticCommand>,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let fingerprint = serde_json::to_vec(&(
            context,
            expected_store_epoch.clone(),
            &document_id,
            generation,
            expected_head_seq,
            &commands,
        ))
        .map_err(|_| invalid("Owned Document semantic request cannot be fingerprinted"))?;
        let allocation_seed = operation_id.clone();
        self.apply_document_update(
            DocumentUpdateJob {
                context: context.clone(),
                operation_id: operation_id.clone(),
                expected_store_epoch,
                document_id,
                generation,
                operation_kind: "apply_semantic_mutation",
                request_hash: sha256(&fingerprint),
                publication: UpdatePublication::Updated,
            },
            move |connection, authority, engine, materialization, store_epoch| {
                let requires_structural_barrier =
                    commands.iter().any(|command| {
                        matches!(
                        command,
                        nodex_core_contracts::document::DocumentSemanticCommand::DeleteBlock {
                            ..
                        } | nodex_core_contracts::document::DocumentSemanticCommand::MoveBlock {
                            ..
                        }
                    )
                    });
                if expected_head_seq > authority.head.head_seq
                    || (requires_structural_barrier && expected_head_seq != authority.head.head_seq)
                {
                    return Err(StoreError::new(
                        StoreErrorCode::HeadConflict,
                        "Semantic mutation crossed its required Document head barrier",
                        true,
                    ));
                }
                let schema = BlockDocumentSchema::from_identity(
                    &authority.head.schema_key,
                    authority.head.schema_version,
                )
                .ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::UnsupportedSchema,
                        "Owned Document schema is unsupported",
                        false,
                    )
                })?;
                let full_state = engine.full_state_v1();
                let state_vector = engine.state_vector_v1();
                let mut allocation_index = 0_u64;
                let prepared = prepare_semantic_mutation(
                    connection,
                    SemanticMutationContext {
                        document_id: &authority.head.id,
                        project_id: &authority.head.project_id,
                        store_epoch,
                        schema,
                        full_state_v1: &full_state,
                        state_vector_v1: &state_vector,
                        materialization,
                    },
                    &commands,
                    &mut || {
                        allocation_index += 1;
                        allocate_document_block_id(&allocation_seed, allocation_index)
                    },
                );
                match prepared {
                    Ok(prepared) => Ok(PreparedUpdate::Apply {
                        base_head_seq: authority.head.head_seq,
                        update_id: operation_id,
                        touched_block_ids: prepared.touched_block_ids,
                        update: prepared.update_v1,
                        write_fence_block_ids: prepared.write_fence_block_ids,
                        title_write_fence_required: prepared.title_write_fence_required,
                    }),
                    Err(SemanticMutationError::NoChange) => Ok(PreparedUpdate::NoChange),
                    Err(error) => Err(semantic_error(error)),
                }
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn create_checkpoint(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
        cause: String,
        label: Option<String>,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let fingerprint = serde_json::to_vec(&(
            context,
            expected_store_epoch.clone(),
            &document_id,
            generation,
            expected_head_seq,
            &cause,
            &label,
        ))
        .map_err(|_| invalid("Document checkpoint request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let context = context.clone();
        let cache = Arc::clone(&self.cache);
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let store_epoch = read_store_epoch(&transaction)?;
                if store_epoch != expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Document checkpoint targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(stored) = read_module_receipt(&transaction, MODULE_NAME, &operation_id)?
                {
                    if stored.request_hash != request_hash {
                        return Err(StoreError::new(
                            StoreErrorCode::IdempotencyKeyReused,
                            "operation_id is already bound to another Owned Document intent",
                            false,
                        ));
                    }
                    let mut committed = serde_json::from_value::<
                        CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
                    >(stored.result)
                    .map_err(|_| corrupt_receipt())?;
                    committed.receipt.mutation.duplicate = true;
                    transaction.commit()?;
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let authority = read_document_authority(&transaction, &document_id)?
                    .ok_or_else(|| not_found("Owned Document was not found"))?;
                assert_document_head(&authority, generation, expected_head_seq)?;
                let now = sqlite_now(&transaction)?;
                let checkpoint = NewDocumentCheckpoint {
                    operation_id: &operation_id,
                    cause: &cause,
                    label: label.as_deref(),
                    revision_kind: "manual",
                    source_change_seq: None,
                    context: &context,
                    now: &now,
                };
                let yjs_engine = match authority.head.sync_engine {
                    DocumentSyncEngine::Yjs => {
                        authorize_yjs(&context, &authority)?;
                        let engine = cache
                            .lock()
                            .map_err(|_| internal("Document cache lock failed"))?
                            .clone_engine(&transaction, &authority.head)?;
                        let schema = registered_yjs_schema(&authority)?;
                        let materialization = materialize_engine(&engine, schema)?;
                        insert_document_checkpoint(
                            &transaction,
                            &authority,
                            &materialization,
                            checkpoint,
                        )?;
                        Some(engine)
                    }
                    DocumentSyncEngine::CanvasScene => {
                        authorize_canvas(&context, &authority)?;
                        let loaded = load_canvas_scene(&transaction, &authority)?;
                        insert_canvas_checkpoint(
                            &transaction,
                            &authority,
                            &loaded.scene,
                            checkpoint,
                        )?;
                        None
                    }
                };
                let event_head = read_event_head(&transaction)?;
                let committed = committed_value(
                    &operation_id,
                    &store_epoch,
                    &authority,
                    authority.head.head_seq,
                    DocumentCommitOutcome::Committed,
                    event_head,
                );
                insert_typed_receipt(
                    &transaction,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    "create_checkpoint",
                    &committed,
                    None,
                )?;
                transaction.commit()?;
                if let Some(engine) = yjs_engine {
                    cache
                        .lock()
                        .map_err(|_| internal("Document cache lock failed"))?
                        .install(&authority.head, engine);
                }
                Ok(OwnedDocumentApplyOutcome {
                    committed,
                    events: Vec::new(),
                })
            })
            .map_err(core_error)
    }

    #[allow(clippy::too_many_arguments)]
    fn restore_version(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        version_id: String,
        generation: i64,
        expected_head_seq: i64,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let sync_engine = self
            .readers
            .read_default(|connection| {
                read_document_authority(connection, &document_id)?
                    .map(|authority| authority.head.sync_engine)
                    .ok_or_else(|| not_found("Owned Document was not found"))
            })
            .map_err(core_error)?;
        match sync_engine {
            DocumentSyncEngine::Yjs => self.restore_yjs_version(
                context,
                operation_id,
                expected_store_epoch,
                document_id,
                version_id,
                generation,
                expected_head_seq,
            ),
            DocumentSyncEngine::CanvasScene => self.restore_canvas_version(
                context,
                operation_id,
                expected_store_epoch,
                document_id,
                version_id,
                generation,
                expected_head_seq,
            ),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn restore_yjs_version(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        version_id: String,
        generation: i64,
        expected_head_seq: i64,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let fingerprint = serde_json::to_vec(&(
            context,
            expected_store_epoch.clone(),
            &document_id,
            &version_id,
            generation,
            expected_head_seq,
        ))
        .map_err(|_| invalid("Document restore request cannot be fingerprinted"))?;
        let checkpoint_operation_id = operation_id.clone();
        let checkpoint_context = context.clone();
        self.apply_document_update(
            DocumentUpdateJob {
                context: context.clone(),
                operation_id: operation_id.clone(),
                expected_store_epoch,
                document_id,
                generation,
                operation_kind: "restore_version",
                request_hash: sha256(&fingerprint),
                publication: UpdatePublication::Invalidated(DocumentInvalidationReason::Restored),
            },
            move |connection, authority, engine, materialization, _store_epoch| {
                assert_document_head(authority, generation, expected_head_seq)?;
                let Some(prepared) =
                    prepare_version_restore(connection, authority, engine, &version_id)?
                else {
                    return Ok(PreparedUpdate::NoChange);
                };
                let now = sqlite_now(connection)?;
                let event_head = read_event_head(connection)?;
                let safety_label = format!("Before restoring {version_id}");
                insert_document_checkpoint(
                    connection,
                    authority,
                    materialization,
                    NewDocumentCheckpoint {
                        operation_id: &checkpoint_operation_id,
                        cause: "before_restore",
                        label: Some(&safety_label),
                        revision_kind: "safety",
                        source_change_seq: (event_head > 0).then_some(event_head),
                        context: &checkpoint_context,
                        now: &now,
                    },
                )?;
                Ok(PreparedUpdate::Apply {
                    base_head_seq: authority.head.head_seq,
                    update_id: operation_id,
                    touched_block_ids: Vec::new(),
                    update: prepared.update_v1,
                    write_fence_block_ids: prepared.write_fence_block_ids,
                    title_write_fence_required: prepared.title_write_fence_required,
                })
            },
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn restore_canvas_version(
        &self,
        context: &BoundModuleContext,
        operation_id: String,
        expected_store_epoch: StoreEpoch,
        document_id: String,
        version_id: String,
        generation: i64,
        expected_head_seq: i64,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let fingerprint = serde_json::to_vec(&(
            context,
            expected_store_epoch.clone(),
            &document_id,
            &version_id,
            generation,
            expected_head_seq,
        ))
        .map_err(|_| invalid("Canvas restore request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let context = context.clone();
        let fail_after_commit = Arc::clone(&self.fail_after_commit);
        let assets_root = self.assets_root.clone();
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let store_epoch = read_store_epoch(&transaction)?;
                if store_epoch != expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Canvas restore targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(stored) = read_module_receipt(&transaction, MODULE_NAME, &operation_id)?
                {
                    if stored.request_hash != request_hash {
                        return Err(StoreError::new(
                            StoreErrorCode::IdempotencyKeyReused,
                            "operation_id is already bound to another Owned Document intent",
                            false,
                        ));
                    }
                    let mut committed = serde_json::from_value::<
                        CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
                    >(stored.result)
                    .map_err(|_| corrupt_receipt())?;
                    committed.receipt.mutation.duplicate = true;
                    if let Some(canvas) = committed.value.canvas.as_mut()
                        && let Some(object) = canvas.as_object_mut()
                    {
                        object.insert("duplicate".to_owned(), Value::Bool(true));
                    }
                    transaction.commit()?;
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let authority = read_document_authority(&transaction, &document_id)?
                    .ok_or_else(|| not_found("Canvas Document was not found"))?;
                authorize_canvas(&context, &authority)?;
                assert_document_head(&authority, generation, expected_head_seq)?;
                let loaded = load_canvas_scene(&transaction, &authority)?;
                let version = get_document_version(&transaction, &authority, &version_id)?
                    .ok_or_else(|| not_found("Canvas Document version was not found"))?;
                let target = version.canvas_scene.ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::UnsupportedSchema,
                        "Canvas restore requires a scene-native checkpoint",
                        false,
                    )
                })?;
                let Some(mutation) = prepare_canvas_restore(&loaded.scene, &target, &operation_id)?
                else {
                    let event_head = read_event_head(&transaction)?;
                    let committed = committed_value(
                        &operation_id,
                        &store_epoch,
                        &authority,
                        authority.head.head_seq,
                        DocumentCommitOutcome::NoChange,
                        event_head,
                    );
                    insert_typed_receipt(
                        &transaction,
                        &context,
                        &operation_id,
                        &request_hash,
                        &store_epoch,
                        "restore_version",
                        &committed,
                        None,
                    )?;
                    transaction.commit()?;
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                };
                let now = sqlite_now(&transaction)?;
                let event_head = read_event_head(&transaction)?;
                let safety_label = format!("Before restoring {version_id}");
                insert_canvas_checkpoint(
                    &transaction,
                    &authority,
                    &loaded.scene,
                    NewDocumentCheckpoint {
                        operation_id: &operation_id,
                        cause: "before_restore",
                        label: Some(&safety_label),
                        revision_kind: "safety",
                        source_change_seq: (event_head > 0).then_some(event_head),
                        context: &context,
                        now: &now,
                    },
                )?;
                let applied = apply_canvas_candidate(&loaded.scene, &mutation)?;
                let persisted = persist_canvas_mutation(
                    &transaction,
                    &authority,
                    &context,
                    &store_epoch,
                    &operation_id,
                    authority.head.head_seq,
                    &mutation,
                    &applied,
                    &assets_root,
                    "document_restored",
                )?;
                let mut restored_authority = authority.clone();
                restored_authority.head.head_seq = persisted.head_seq;
                restored_authority.head.state_hash = persisted.scene_hash.clone();
                insert_canvas_checkpoint(
                    &transaction,
                    &restored_authority,
                    &applied.scene,
                    NewDocumentCheckpoint {
                        operation_id: &operation_id,
                        cause: "after_restore",
                        label: Some("Restored Document state"),
                        revision_kind: "restore",
                        source_change_seq: Some(persisted.event_sequence),
                        context: &context,
                        now: &persisted.committed_at,
                    },
                )?;
                transaction.execute(
                    "DELETE FROM document_revision_sessions WHERE document_id = ?1",
                    [&authority.head.id],
                )?;
                let committed = committed_canvas_value(
                    &operation_id,
                    &store_epoch,
                    &authority,
                    persisted.head_seq,
                    DocumentCommitOutcome::Committed,
                    persisted.event_sequence,
                    persisted.result,
                );
                insert_typed_receipt(
                    &transaction,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    "restore_version",
                    &committed,
                    Some(persisted.event_sequence),
                )?;
                transaction.commit()?;
                if fail_after_commit.swap(false, Ordering::AcqRel) {
                    return Err(StoreError::new(
                        StoreErrorCode::Internal,
                        "Injected failure after durable Canvas restore",
                        true,
                    ));
                }
                Ok(OwnedDocumentApplyOutcome {
                    committed,
                    events: vec![CommittedCoreModuleEvent {
                        version: CORE_CONTRACT_VERSION,
                        sequence: persisted.event_sequence,
                        store_epoch: StoreEpoch(store_epoch),
                        operation_id: Some(operation_id),
                        committed_at: persisted.committed_at,
                        payload: CoreModuleEventPayload::OwnedDocument(
                            OwnedDocumentEvent::DocumentInvalidated {
                                document_id,
                                reason: DocumentInvalidationReason::Restored,
                            },
                        ),
                    }],
                })
            })
            .map_err(core_error)
    }

    fn apply_document_update<F>(
        &self,
        job: DocumentUpdateJob,
        prepare: F,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError>
    where
        F: FnOnce(
                &rusqlite::Connection,
                &DocumentAuthorityRow,
                &super::YrsDocumentEngine,
                &DocumentMaterialization,
                &str,
            ) -> Result<PreparedUpdate, StoreError>
            + Send
            + 'static,
    {
        let cache = Arc::clone(&self.cache);
        let fail_after_commit = Arc::clone(&self.fail_after_commit);
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let store_epoch = read_store_epoch(&transaction)?;
                if store_epoch != job.expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Owned Document mutation targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(stored) =
                    read_module_receipt(&transaction, MODULE_NAME, &job.operation_id)?
                {
                    if stored.request_hash != job.request_hash {
                        return Err(StoreError::new(
                            StoreErrorCode::IdempotencyKeyReused,
                            "operation_id is already bound to another Owned Document intent",
                            false,
                        ));
                    }
                    let mut committed = serde_json::from_value::<
                        CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
                    >(stored.result)
                    .map_err(|_| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Stored Owned Document receipt result is invalid",
                            false,
                        )
                    })?;
                    committed.receipt.mutation.duplicate = true;
                    transaction.commit()?;
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let authority = read_document_authority(&transaction, &job.document_id)?
                    .ok_or_else(|| not_found("Owned Document was not found"))?;
                authorize_yjs(&job.context, &authority)?;
                if authority.head.generation != job.generation {
                    return Err(StoreError::new(
                        StoreErrorCode::GenerationConflict,
                        "Owned Document generation does not match",
                        false,
                    ));
                }
                let mut engine = cache
                    .lock()
                    .map_err(|_| internal("Document cache lock failed"))?
                    .clone_engine(&transaction, &authority.head)?;
                let schema = BlockDocumentSchema::from_identity(
                    &authority.head.schema_key,
                    authority.head.schema_version,
                )
                .ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::UnsupportedSchema,
                        "Owned Document schema is unsupported",
                        false,
                    )
                })?;
                let base_materialization = materialize_engine(&engine, schema)?;
                let prepared = prepare(
                    &transaction,
                    &authority,
                    &engine,
                    &base_materialization,
                    &store_epoch,
                )?;
                if let PreparedUpdate::Recovery { artifact_id } = &prepared {
                    let artifact_id = artifact_id.clone();
                    transaction.commit()?;
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        format!(
                            "Stale Yjs update crossed a structural barrier; recovery artifact {artifact_id}"
                        ),
                        false,
                    ));
                }
                let PreparedUpdate::Apply {
                    base_head_seq,
                    update_id,
                    touched_block_ids,
                    update,
                    write_fence_block_ids,
                    title_write_fence_required,
                } = prepared
                else {
                    let event_head = read_event_head(&transaction)?;
                    let committed = committed_value(
                        &job.operation_id,
                        &store_epoch,
                        &authority,
                        authority.head.head_seq,
                        DocumentCommitOutcome::NoChange,
                        event_head,
                    );
                    insert_typed_receipt(
                        &transaction,
                        &job.context,
                        &job.operation_id,
                        &job.request_hash,
                        &store_epoch,
                        job.operation_kind,
                        &committed,
                        None,
                    )?;
                    transaction.commit()?;
                    cache
                        .lock()
                        .map_err(|_| internal("Document cache lock failed"))?
                        .install(&authority.head, engine);
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                };
                validate_touched_block_ids_store(&touched_block_ids)?;
                let candidate = engine.prepare_update_v1(&update).map_err(engine_error)?;
                let materialization = materialize_candidate(&candidate, schema)?;
                let did_change = candidate.did_change();
                let event_head = read_event_head(&transaction)?;
                if !did_change {
                    let committed = committed_value(
                        &job.operation_id,
                        &store_epoch,
                        &authority,
                        authority.head.head_seq,
                        DocumentCommitOutcome::NoChange,
                        event_head,
                    );
                    insert_typed_receipt(
                        &transaction,
                        &job.context,
                        &job.operation_id,
                        &job.request_hash,
                        &store_epoch,
                        job.operation_kind,
                        &committed,
                        None,
                    )?;
                    transaction.commit()?;
                    cache
                        .lock()
                        .map_err(|_| internal("Document cache lock failed"))?
                        .install(&authority.head, engine);
                    return Ok(OwnedDocumentApplyOutcome {
                        committed,
                        events: Vec::new(),
                    });
                }
                let candidate_transaction = candidate.document().transact();
                let state_vector = candidate_transaction.state_vector().encode_v1();
                let full_state =
                    candidate_transaction.encode_state_as_update_v1(&yrs::StateVector::default());
                drop(candidate_transaction);
                let revision_now = sqlite_now(&transaction)?;
                prepare_document_revision(
                    &transaction,
                    &authority,
                    &base_materialization,
                    &job.context,
                    &revision_now,
                )?;
                let persisted = persist_yjs_commit(
                    &transaction,
                    PersistYjsCommit {
                        authority: &authority,
                        base_materialization: &base_materialization,
                        materialization: &materialization,
                        update_id: &update_id,
                        client_session_id: &job.context.connection_id,
                        base_head_seq,
                        client_touched_block_ids: &touched_block_ids,
                        update: &update,
                        state_vector: &state_vector,
                        full_state: &full_state,
                        store_epoch: &store_epoch,
                        operation_id: &job.operation_id,
                        event_kind: match job.publication {
                            UpdatePublication::Updated => "document_updated",
                            UpdatePublication::Invalidated(
                                DocumentInvalidationReason::Restored,
                            ) => "document_restored",
                            UpdatePublication::Invalidated(_) => "document_invalidated",
                        },
                        write_fence_block_ids: &write_fence_block_ids,
                        title_write_fence_required,
                    },
                )?;
                if matches!(
                    job.publication,
                    UpdatePublication::Invalidated(DocumentInvalidationReason::Restored)
                ) {
                    let mut restored_authority = authority.clone();
                    restored_authority.head.head_seq = persisted.head_seq;
                    restored_authority.head.state_vector = persisted.state_vector.clone();
                    restored_authority.head.state_hash = persisted.state_hash.clone();
                    insert_document_checkpoint(
                        &transaction,
                        &restored_authority,
                        &materialization,
                        NewDocumentCheckpoint {
                            operation_id: &job.operation_id,
                            cause: "after_restore",
                            label: Some("Restored Document state"),
                            revision_kind: "restore",
                            source_change_seq: Some(persisted.event_sequence),
                            context: &job.context,
                            now: &persisted.committed_at,
                        },
                    )?;
                    transaction.execute(
                        "DELETE FROM document_revision_sessions WHERE document_id = ?1",
                        [&authority.head.id],
                    )?;
                } else {
                    record_document_revision_edit(
                        &transaction,
                        &authority.head.id,
                        authority.head.generation,
                        persisted.head_seq,
                        &job.context.connection_id,
                        &persisted.committed_at,
                    )?;
                }
                let committed = committed_value(
                    &job.operation_id,
                    &store_epoch,
                    &authority,
                    persisted.head_seq,
                    DocumentCommitOutcome::Committed,
                    persisted.event_sequence,
                );
                insert_typed_receipt(
                    &transaction,
                    &job.context,
                    &job.operation_id,
                    &job.request_hash,
                    &store_epoch,
                    job.operation_kind,
                    &committed,
                    Some(persisted.event_sequence),
                )?;
                transaction.commit()?;
                if fail_after_commit.swap(false, Ordering::AcqRel) {
                    cache
                        .lock()
                        .map_err(|_| internal("Document cache lock failed"))?
                        .invalidate(&job.document_id);
                    return Err(StoreError::new(
                        StoreErrorCode::Internal,
                        "Injected failure after durable Document commit",
                        true,
                    ));
                }
                engine.commit_candidate(candidate).map_err(engine_error)?;
                let mut next_head = authority.head.clone();
                next_head.head_seq = persisted.head_seq;
                next_head.state_vector = persisted.state_vector;
                next_head.state_hash = persisted.state_hash;
                cache
                    .lock()
                    .map_err(|_| internal("Document cache lock failed"))?
                    .install(&next_head, engine);
                let payload = match job.publication {
                    UpdatePublication::Updated => {
                        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentUpdated {
                            document_id: job.document_id.clone(),
                            generation: job.generation,
                            head_seq: persisted.head_seq,
                            update,
                        })
                    }
                    UpdatePublication::Invalidated(reason) => {
                        CoreModuleEventPayload::OwnedDocument(
                            OwnedDocumentEvent::DocumentInvalidated {
                                document_id: job.document_id.clone(),
                                reason,
                            },
                        )
                    }
                };
                let event = CommittedCoreModuleEvent {
                    version: CORE_CONTRACT_VERSION,
                    sequence: persisted.event_sequence,
                    store_epoch: StoreEpoch(store_epoch.clone()),
                    operation_id: Some(job.operation_id),
                    committed_at: persisted.committed_at,
                    payload,
                };
                Ok(OwnedDocumentApplyOutcome {
                    committed,
                    events: vec![event],
                })
            })
            .map_err(core_error)
    }

    fn validate_context(&self, context: &BoundModuleContext) -> Result<(), CoreError> {
        if context.profile_id.0 == self.profile_id && context.library_id.0 == self.library_id {
            return Ok(());
        }
        Err(CoreError {
            code: CoreErrorCode::Unauthorized,
            message: "Owned Document context targets another Profile or Library".to_owned(),
            retryable: false,
            recovery: CoreErrorRecovery::None,
        })
    }
}

fn materialize_engine(
    engine: &super::YrsDocumentEngine,
    schema: BlockDocumentSchema,
) -> Result<DocumentMaterialization, StoreError> {
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|error| invalid_store(format!("Owned Document schema is invalid: {error}")))?;
    materialize_decoded_document(&decoded)
        .map_err(|error| invalid_store(format!("Owned Document is invalid: {error}")))
}

fn materialize_candidate(
    candidate: &super::YrsUpdateCandidate,
    schema: BlockDocumentSchema,
) -> Result<DocumentMaterialization, StoreError> {
    let decoded = decode_block_document(candidate.document(), schema)
        .map_err(|error| invalid_store(format!("Yjs update violates the schema: {error}")))?;
    materialize_decoded_document(&decoded)
        .map_err(|error| invalid_store(format!("Yjs update cannot materialize: {error}")))
}

fn committed_value(
    operation_id: &str,
    store_epoch: &str,
    authority: &DocumentAuthorityRow,
    head_seq: i64,
    outcome: DocumentCommitOutcome,
    event_sequence: i64,
) -> CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt> {
    CommittedModuleValue {
        value: OwnedDocumentCommitValue {
            document_id: authority.head.id.clone(),
            generation: authority.head.generation,
            head_seq,
            outcome,
            canvas: None,
            owner_effect: None,
        },
        receipt: OwnedDocumentReceipt {
            mutation: ModuleMutationReceipt {
                operation_id: operation_id.to_owned(),
                duplicate: false,
            },
            document_id: authority.head.id.clone(),
            generation: authority.head.generation,
            head_seq,
        },
        event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
    }
}

fn owner_command_kind(command: &DocumentOwnerCommand) -> &'static str {
    match command {
        DocumentOwnerCommand::CreateSyncedSource { .. } => "create_synced_source",
        DocumentOwnerCommand::PromoteSyncedSource { .. } => "promote_synced_source",
        DocumentOwnerCommand::DemoteSyncedSource { .. } => "demote_synced_source",
        DocumentOwnerCommand::CreateTemplate { .. } => "create_template",
        DocumentOwnerCommand::InstantiateTemplate { .. } => "instantiate_template",
        DocumentOwnerCommand::DeleteOwnedSource { .. } => "delete_owned_source",
        DocumentOwnerCommand::CreateCanvasOwner { .. } => "create_canvas_owner",
        DocumentOwnerCommand::DeleteCanvasOwner { .. } => "delete_canvas_owner",
    }
}

#[allow(clippy::too_many_arguments)]
fn committed_canvas_value(
    operation_id: &str,
    store_epoch: &str,
    authority: &DocumentAuthorityRow,
    head_seq: i64,
    outcome: DocumentCommitOutcome,
    event_sequence: i64,
    canvas: Value,
) -> CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt> {
    let mut committed = committed_value(
        operation_id,
        store_epoch,
        authority,
        head_seq,
        outcome,
        event_sequence,
    );
    committed.value.canvas = Some(canvas);
    committed
}

#[allow(clippy::too_many_arguments)]
fn insert_typed_receipt(
    connection: &rusqlite::Connection,
    context: &BoundModuleContext,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
    operation_kind: &str,
    committed: &CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
    event_sequence: Option<i64>,
) -> Result<(), StoreError> {
    let result = serde_json::to_value(committed)
        .map_err(|_| internal("Owned Document result could not be encoded"))?;
    insert_module_receipt(
        connection,
        NewModuleReceipt {
            module_name: MODULE_NAME,
            operation_id,
            context,
            operation_kind,
            store_epoch,
            request_hash,
            result: &result,
            event_sequence,
            committed_at: &sqlite_now(connection)?,
        },
    )
}

fn authority_descriptor(authority: &DocumentAuthorityRow, store_epoch: &str) -> Value {
    let readiness = match authority.head.readiness {
        DocumentReadiness::PendingGenesis => "pending_genesis",
        DocumentReadiness::Ready => "ready",
        DocumentReadiness::Failed => "failed",
    };
    let sync = match authority.head.sync_engine {
        DocumentSyncEngine::Yjs => json!({
            "kind": "yjs",
            "stateVector": authority.head.state_vector,
        }),
        DocumentSyncEngine::CanvasScene => json!({ "kind": "canvas_scene" }),
    };
    json!({
        "version": 2,
        "documentId": authority.head.id,
        "projectId": authority.head.project_id,
        "ownerBlockId": authority.owner_block_id,
        "ownerType": authority.owner_type,
        "ownerLifecycle": authority.owner_lifecycle,
        "storeEpoch": store_epoch,
        "generation": authority.head.generation,
        "headSeq": authority.head.head_seq,
        "schemaKey": authority.head.schema_key,
        "schemaVersion": authority.head.schema_version,
        "readiness": readiness,
        "sync": sync,
    })
}

fn authorize_project(
    context: &BoundModuleContext,
    authority: &DocumentAuthorityRow,
) -> Result<(), StoreError> {
    if context.project_id.as_ref().map(|id| id.0.as_str())
        == Some(authority.head.project_id.as_str())
    {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::Unauthorized,
        "Owned Document is outside the bound Project",
        false,
    ))
}

fn authorize_yjs(
    context: &BoundModuleContext,
    authority: &DocumentAuthorityRow,
) -> Result<(), StoreError> {
    authorize_project(context, authority)?;
    if authority.owner_lifecycle == "deleted"
        || authority.head.readiness != DocumentReadiness::Ready
        || authority.head.authority != DocumentAuthority::YdocPrimary
        || authority.head.sync_engine != DocumentSyncEngine::Yjs
    {
        return Err(StoreError::new(
            StoreErrorCode::Unauthorized,
            "Owned Document is not readable live Yjs authority",
            false,
        ));
    }
    registered_yjs_schema(authority)?;
    Ok(())
}

fn authorize_canvas(
    context: &BoundModuleContext,
    authority: &DocumentAuthorityRow,
) -> Result<(), StoreError> {
    authorize_project(context, authority)?;
    if authority.owner_lifecycle == "deleted" {
        return Err(StoreError::new(
            StoreErrorCode::Unauthorized,
            "Canvas Document owner is deleted",
            false,
        ));
    }
    validate_canvas_authority(authority)
}

fn authorize_owned_document(
    context: &BoundModuleContext,
    authority: &DocumentAuthorityRow,
) -> Result<(), StoreError> {
    match authority.head.sync_engine {
        DocumentSyncEngine::Yjs => authorize_yjs(context, authority),
        DocumentSyncEngine::CanvasScene => authorize_canvas(context, authority),
    }
}

fn registered_yjs_schema(
    authority: &DocumentAuthorityRow,
) -> Result<BlockDocumentSchema, StoreError> {
    let schema = BlockDocumentSchema::from_identity(
        &authority.head.schema_key,
        authority.head.schema_version,
    )
    .ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Owned Document schema is unsupported",
            false,
        )
    })?;
    if super::materialization::schema_metadata(schema).owner_type == authority.owner_type {
        return Ok(schema);
    }
    Err(StoreError::new(
        StoreErrorCode::UnsupportedSchema,
        "Owned Document owner type does not match its registered schema",
        false,
    ))
}

fn validate_touched_block_ids(ids: &[String]) -> Result<(), CoreError> {
    validate_touched_block_ids_store(ids).map_err(core_error)
}

fn validate_touched_block_ids_store(ids: &[String]) -> Result<(), StoreError> {
    if ids.len() > 100_000 {
        return Err(invalid_store(
            "Touched Block ID list exceeds its bound".to_owned(),
        ));
    }
    let mut sorted = ids.to_vec();
    sorted.sort();
    sorted.dedup();
    if sorted.len() == ids.len()
        && ids
            .iter()
            .all(|id| !id.is_empty() && id.len() <= 512 && id.trim() == id)
    {
        return Ok(());
    }
    Err(invalid_store(
        "Touched Block IDs must be unique canonical identities".to_owned(),
    ))
}

fn semantic_error(error: SemanticMutationError) -> StoreError {
    match error {
        SemanticMutationError::Invalid(message) => invalid_store(message),
        SemanticMutationError::RevisionConflict => StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Semantic ETag no longer matches current Document state",
            true,
        ),
        SemanticMutationError::NoChange => {
            invalid_store("Semantic mutation makes no change".to_owned())
        }
        SemanticMutationError::EtagAuthority(message) => StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("Semantic ETag authority is unavailable: {message}"),
            false,
        ),
        SemanticMutationError::Operation(error) => {
            let code = match error.code() {
                super::DocumentOperationErrorCode::StaleStateVector => StoreErrorCode::HeadConflict,
                _ => StoreErrorCode::InvalidInput,
            };
            StoreError::new(code, error.to_string(), false)
        }
    }
}

fn assert_document_head(
    authority: &DocumentAuthorityRow,
    generation: i64,
    expected_head_seq: i64,
) -> Result<(), StoreError> {
    if authority.head.generation != generation {
        return Err(StoreError::new(
            StoreErrorCode::GenerationConflict,
            "Owned Document generation does not match",
            false,
        ));
    }
    if authority.head.head_seq == expected_head_seq {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::HeadConflict,
        "Owned Document head does not match the required history barrier",
        true,
    ))
}

fn corrupt_receipt() -> StoreError {
    StoreError::new(
        StoreErrorCode::StoreCorrupt,
        "Stored Owned Document receipt result is invalid",
        false,
    )
}

fn allocate_document_block_id(seed: &str, index: u64) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let timestamp = now.min(0xffff_ffff_ffff) as u64;
    let sequence = DOCUMENT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let entropy = sha256(format!("{seed}:{index}:{sequence}:{now}").as_bytes());
    let timestamp = format!("{timestamp:012x}");
    format!(
        "{}-{}-7{}-8{}-{}",
        &timestamp[..8],
        &timestamp[8..],
        &entropy[..3],
        &entropy[3..6],
        &entropy[6..18],
    )
}

fn engine_error(error: YrsEngineError) -> StoreError {
    let (code, retryable) = match error {
        YrsEngineError::MissingDependencies => (StoreErrorCode::MissingDependencies, true),
        _ => (StoreErrorCode::InvalidInput, false),
    };
    StoreError::new(code, format!("Yjs update failed: {error}"), retryable)
}

fn core_error(error: StoreError) -> CoreError {
    let code = match error.code {
        StoreErrorCode::InvalidInput => CoreErrorCode::InvalidInput,
        StoreErrorCode::Unauthorized => CoreErrorCode::Unauthorized,
        StoreErrorCode::NotFound => CoreErrorCode::NotFound,
        StoreErrorCode::Conflict => CoreErrorCode::StaleStoreEpoch,
        StoreErrorCode::GenerationConflict => CoreErrorCode::GenerationConflict,
        StoreErrorCode::HeadConflict => CoreErrorCode::HeadConflict,
        StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::MissingDependencies => CoreErrorCode::DocumentUpdateMissingDependencies,
        StoreErrorCode::UnsupportedSchema => CoreErrorCode::InvalidDocumentSchema,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        _ => CoreErrorCode::CoreUnavailable,
    };
    CoreError {
        code,
        message: error.message,
        retryable: error.retryable,
        recovery: CoreErrorRecovery::None,
    }
}

fn invalid(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::InvalidInput,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn unauthorized_core(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::Unauthorized,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn invalid_store(message: String) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

fn sqlite_now(connection: &rusqlite::Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use nodex_core_contracts::document::{
        DeletableOwnedSourceKind, DocumentCommitOutcome, DocumentHeadRevision,
        DocumentOwnerCommand, DocumentOwnerRevision, DocumentSemanticCommand, OwnedDocumentIntent,
        OwnedDocumentRead,
    };
    use nodex_core_contracts::{
        AdapterKind, LibraryId, ModuleApplyRequest, ModuleReadRequest, ProfileId, ProjectId,
    };
    use rusqlite::params;
    use tempfile::tempdir;

    use crate::document::{
        BlockDocumentSchema, DocumentAwareness, DocumentBlockOperation, DocumentRealtimeEvent,
        OwnedDocumentRealtimeAdapter, YrsDocumentEngine, prepare_document_operation_update,
    };
    use crate::infrastructure::sqlite::{StoreError, with_immediate_transaction};

    use super::*;

    const PROFILE_ID: &str = "profile:test";
    const LIBRARY_ID: &str = "library:test";
    const PROJECT_ID: &str = "project:test";
    const DOCUMENT_ID: &str = "document:test-page";
    const OWNER_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000001";
    const TARGET_PAGE_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000002";
    const STORE_EPOCH: &str = "epoch:test";
    const NOW: &str = "2026-07-18T00:00:00.000Z";
    const CREATED_SOURCE_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000010";
    const CREATED_SOURCE_DOCUMENT_ID: &str = "019bf52d-6870-7000-8000-000000000011";
    const CREATED_CONTENT_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000012";
    const CREATED_REFERENCE_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000013";
    const CREATED_TEMPLATE_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000014";
    const CREATED_TEMPLATE_DOCUMENT_ID: &str = "019bf52d-6870-7000-8000-000000000015";
    const CREATED_TEMPLATE_CONTENT_ID: &str = "019bf52d-6870-7000-8000-000000000016";
    const CREATED_CANVAS_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000017";
    const CREATED_CANVAS_DOCUMENT_ID: &str = "019bf52d-6870-7000-8000-000000000018";

    struct SeededModule {
        _directory: tempfile::TempDir,
        kernel: SqliteStoreKernel,
        module: OwnedDocumentModule,
        full_state: Vec<u8>,
        state_vector: Vec<u8>,
    }

    fn context() -> BoundModuleContext {
        context_for("renderer-session:test")
    }

    fn context_for(connection_id: &str) -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId(PROFILE_ID.to_owned()),
            library_id: LibraryId(LIBRARY_ID.to_owned()),
            project_id: Some(ProjectId(PROJECT_ID.to_owned())),
            connection_id: connection_id.to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn seeded_module() -> SeededModule {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh v83");
        let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/yjs-yrs/empty-page.bin");
        let full_state = fs::read(fixture).expect("empty Page fixture");
        let engine =
            YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &full_state).expect("Page engine");
        let state_vector = engine.state_vector_v1();
        let materialization =
            materialize_engine(&engine, BlockDocumentSchema::PageV2).expect("Page materialization");
        let state_hash = sha256(&engine.full_state_v1());
        let snapshot_hash = sha256(&full_state);
        let materialization_hash =
            sha256(&serde_json::to_vec(&materialization).expect("materialization JSON"));
        kernel
            .writer()
            .call({
                let full_state = full_state.clone();
                let state_vector = state_vector.clone();
                move |connection| {
                    with_immediate_transaction(connection, |transaction| {
                        transaction.execute(
                            "INSERT INTO projects(id, library_id, name, created, updated) \
                             VALUES (?1, ?2, 'Document test', ?3, ?3)",
                            params![PROJECT_ID, LIBRARY_ID, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                             VALUES (1, ?1, ?2, ?2)",
                            params![STORE_EPOCH, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO blocks(\
                               id, project_id, type, lifecycle, location_kind, containing_document_id, \
                               containing_database_id, location_revision, metadata_revision, created_at, updated_at\
                             ) VALUES (?1, ?2, 'page', 'active', 'space', NULL, NULL, 1, 1, ?3, ?3)",
                            params![OWNER_BLOCK_ID, PROJECT_ID, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO documents(\
                               id, project_id, generation, head_seq, schema_key, schema_version, \
                               state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine\
                             ) VALUES (?1, ?2, 1, 1, 'nodex.page', 2, ?3, ?4, \
                               'ready', 'ydoc_primary', ?5, ?5, 'yjs')",
                            params![DOCUMENT_ID, PROJECT_ID, state_vector, state_hash, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                             VALUES (?1, ?2, ?3, ?4)",
                            params![OWNER_BLOCK_ID, DOCUMENT_ID, PROJECT_ID, NOW],
                        )?;
                        for unit in &materialization.search_units {
                            transaction.execute(
                                "INSERT INTO blocks(\
                                   id, project_id, type, lifecycle, location_kind, containing_document_id, \
                                   containing_database_id, location_revision, metadata_revision, created_at, updated_at\
                                 ) VALUES (?1, ?2, ?3, 'active', 'document', ?4, NULL, 1, 1, ?5, ?5)",
                                params![unit.block_id, PROJECT_ID, unit.block_type, DOCUMENT_ID, NOW],
                            )?;
                            transaction.execute(
                                "INSERT INTO document_block_index(\
                                   document_id, block_id, parent_block_id, ordinal, block_type, text, projected_seq\
                                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                                params![
                                    DOCUMENT_ID,
                                    unit.block_id,
                                    unit.parent_block_id,
                                    unit.ordinal as i64,
                                    unit.block_type,
                                    unit.text,
                                ],
                            )?;
                        }
                        transaction.execute(
                            "INSERT INTO document_updates(\
                               document_id, generation, seq, update_id, client_session_id, base_head_seq, \
                               touched_block_ids_json, update_blob, update_hash, committed_at\
                             ) VALUES (?1, 1, 1, 'genesis:test', 'seed:test', 0, '[]', ?2, ?3, ?4)",
                            params![DOCUMENT_ID, full_state, snapshot_hash, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO document_update_receipts(\
                               document_id, generation, seq, update_id, client_session_id, base_head_seq, \
                               client_touched_block_ids_json, derived_touched_block_ids_json, \
                               derivation_version, update_hash, update_byte_length, committed_at\
                             ) VALUES (?1, 1, 1, 'genesis:test', 'seed:test', 0, '[]', '[]', 1, ?2, ?3, ?4)",
                            params![DOCUMENT_ID, snapshot_hash, full_state.len() as i64, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO document_snapshots(\
                               document_id, generation, snapshot_seq, state_vector, snapshot_update, \
                               snapshot_hash, schema_version, created_at\
                             ) VALUES (?1, 1, 1, ?2, ?3, ?4, 2, ?5)",
                            params![DOCUMENT_ID, state_vector, full_state, snapshot_hash, NOW],
                        )?;
                        let rich_title = serde_json::to_string(&materialization.rich_title)
                            .map_err(|_| internal("seed rich title"))?;
                        transaction.execute(
                            "INSERT INTO document_materializations(\
                               document_id, generation, projected_seq, schema_version, title, title_rich_json, \
                               title_rich_hash, nfm, plain_text, preview, block_tree_json, references_json, \
                               asset_refs_json, updated_at\
                             ) VALUES (?1, 1, 1, 2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                            params![
                                DOCUMENT_ID,
                                materialization.title,
                                rich_title,
                                sha256(rich_title.as_bytes()),
                                materialization.nfm,
                                materialization.plain_text,
                                materialization.preview,
                                serde_json::to_string(&materialization.block_tree)
                                    .map_err(|_| internal("seed blocks"))?,
                                serde_json::to_string(&materialization.references)
                                    .map_err(|_| internal("seed references"))?,
                                serde_json::to_string(&materialization.asset_refs)
                                    .map_err(|_| internal("seed assets"))?,
                                NOW,
                            ],
                        )?;
                        transaction.execute(
                            "INSERT INTO document_engine_fingerprints(\
                               document_id, generation, head_seq, source_state_hash, yrs_state_vector_sha256, \
                               yrs_full_state_sha256, materialization_sha256, validated_at_unix_ms\
                             ) VALUES (?1, 1, 1, ?2, ?3, ?2, ?4, 0)",
                            params![DOCUMENT_ID, state_hash, sha256(&state_vector), materialization_hash],
                        )?;
                        Ok(())
                    })
                }
            })
            .expect("seed ready Page");
        let module = OwnedDocumentModule::new(PROFILE_ID, LIBRARY_ID, &kernel);
        SeededModule {
            _directory: directory,
            kernel,
            module,
            full_state,
            state_vector,
        }
    }

    fn title_update(full_state: &[u8], state_vector: &[u8], title: &str) -> Vec<u8> {
        prepare_document_operation_update(
            DOCUMENT_ID,
            BlockDocumentSchema::PageV2,
            full_state,
            state_vector,
            &[DocumentBlockOperation::SetTitle {
                title: title.to_owned(),
            }],
            false,
        )
        .expect("title update")
        .update_v1
    }

    fn apply_request(
        update_id: &str,
        base_head_seq: i64,
        update: Vec<u8>,
    ) -> ModuleApplyRequest<OwnedDocumentIntent> {
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: update_id.to_owned(),
            store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
            intent: OwnedDocumentIntent::ApplyYjsUpdate {
                document_id: DOCUMENT_ID.to_owned(),
                generation: 1,
                base_head_seq,
                update_id: update_id.to_owned(),
                touched_block_ids: vec![OWNER_BLOCK_ID.to_owned()],
                update,
            },
        }
    }

    fn pending_module(owner_type: &str, schema_key: &str, schema_version: i64) -> SeededModule {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh v83");
        let owner_type = owner_type.to_owned();
        let schema_key = schema_key.to_owned();
        kernel
            .writer()
            .call(move |connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES (?1, ?2, 'Pending Document test', ?3, ?3)",
                        params![PROJECT_ID, LIBRARY_ID, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, ?1, ?2, ?2)",
                        params![STORE_EPOCH, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO blocks(\
                           id, project_id, type, lifecycle, location_kind, containing_document_id, \
                           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
                         ) VALUES (?1, ?2, ?3, 'active', 'space', NULL, NULL, 1, 1, ?4, ?4)",
                        params![OWNER_BLOCK_ID, PROJECT_ID, owner_type, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO documents(\
                           id, project_id, generation, head_seq, schema_key, schema_version, \
                           state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine\
                         ) VALUES (?1, ?2, 1, 0, ?3, ?4, X'', '', \
                           'pending_genesis', 'legacy_shadow', ?5, ?5, 'yjs')",
                        params![DOCUMENT_ID, PROJECT_ID, schema_key, schema_version, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                         VALUES (?1, ?2, ?3, ?4)",
                        params![OWNER_BLOCK_ID, DOCUMENT_ID, PROJECT_ID, NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed pending Document");
        let module = OwnedDocumentModule::new(PROFILE_ID, LIBRARY_ID, &kernel);
        SeededModule {
            _directory: directory,
            kernel,
            module,
            full_state: Vec::new(),
            state_vector: Vec::new(),
        }
    }

    fn empty_project_module() -> SeededModule {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        fs::create_dir(home.join("assets")).expect("assets root");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh v83");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES (?1, ?2, 'Owner command test', ?3, ?3)",
                        params![PROJECT_ID, LIBRARY_ID, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, ?1, ?2, ?2)",
                        params![STORE_EPOCH, NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed empty Project");
        let module = OwnedDocumentModule::new(PROFILE_ID, LIBRARY_ID, &kernel);
        SeededModule {
            _directory: directory,
            kernel,
            module,
            full_state: Vec::new(),
            state_vector: Vec::new(),
        }
    }

    fn owner_request(
        operation_id: &str,
        command: DocumentOwnerCommand,
    ) -> ModuleApplyRequest<OwnedDocumentIntent> {
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
            intent: OwnedDocumentIntent::ApplyOwnerCommand { command },
        }
    }

    fn paragraph(block_id: &str, text: &str) -> Value {
        json!({
            "id": block_id,
            "type": "paragraph",
            "props": {},
            "content": if text.is_empty() {
                Value::Array(Vec::new())
            } else {
                json!([{ "type": "text", "text": text, "styles": {} }])
            },
            "children": [],
        })
    }

    fn canvas_module() -> SeededModule {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        fs::create_dir(home.join("assets")).expect("assets root");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh v83");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES (?1, ?2, 'Canvas test', ?3, ?3)",
                        params![PROJECT_ID, LIBRARY_ID, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, ?1, ?2, ?2)",
                        params![STORE_EPOCH, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO blocks(\
                           id, project_id, type, lifecycle, location_kind, containing_document_id, \
                           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
                         ) VALUES (?1, ?2, 'canvas', 'active', 'space', NULL, NULL, 1, 1, ?3, ?3)",
                        params![OWNER_BLOCK_ID, PROJECT_ID, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO blocks(\
                           id, project_id, type, lifecycle, location_kind, containing_document_id, \
                           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
                         ) VALUES (?1, ?2, 'page', 'active', 'space', NULL, NULL, 1, 1, ?3, ?3)",
                        params![TARGET_PAGE_BLOCK_ID, PROJECT_ID, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO documents(\
                           id, project_id, generation, head_seq, schema_key, schema_version, \
                           state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine\
                         ) VALUES (?1, ?2, 1, 0, 'nodex.canvas', 1, X'', ?3, \
                           'ready', 'ydoc_primary', ?4, ?4, 'canvas_scene')",
                        params![DOCUMENT_ID, PROJECT_ID, "0".repeat(64), NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                         VALUES (?1, ?2, ?3, ?4)",
                        params![OWNER_BLOCK_ID, DOCUMENT_ID, PROJECT_ID, NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed Canvas");
        let module = OwnedDocumentModule::new(PROFILE_ID, LIBRARY_ID, &kernel);
        SeededModule {
            _directory: directory,
            kernel,
            module,
            full_state: Vec::new(),
            state_vector: Vec::new(),
        }
    }

    fn canvas_mutation_request(
        operation_id: &str,
        base_head_seq: i64,
        version: i64,
        text: &str,
    ) -> ModuleApplyRequest<OwnedDocumentIntent> {
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
            intent: OwnedDocumentIntent::ApplyCanvasMutation {
                document_id: DOCUMENT_ID.to_owned(),
                generation: 1,
                expected_head_seq: base_head_seq,
                mutation: json!({
                    "elementCandidates": [{
                        "id": "element:page-ref",
                        "type": "rectangle",
                        "version": version,
                        "versionNonce": 7,
                        "index": "a0",
                        "isDeleted": false,
                        "text": text,
                        "customData": {
                            "type": "nodex-card",
                            "cardId": TARGET_PAGE_BLOCK_ID,
                            "titleHint": "Target"
                        }
                    }],
                    "appStateIntents": {
                        "gridSize": {
                            "expected": { "kind": "absent" },
                            "value": { "kind": "value", "value": 20 }
                        }
                    },
                    "fileAdditions": {}
                }),
            },
        }
    }

    #[test]
    fn canvas_prepare_sync_merge_and_exact_retry_share_scene_authority() {
        let seeded = canvas_module();
        let prepared = seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "canvas:prepare".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::PrepareOwner {
                        owner_block_id: OWNER_BLOCK_ID.to_owned(),
                    },
                },
            )
            .expect("prepare Canvas");
        assert_eq!(prepared.committed.value.head_seq, 0);
        assert_eq!(
            prepared.committed.value.outcome,
            DocumentCommitOutcome::Committed
        );
        assert!(prepared.events.is_empty());

        let initial = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::SyncCanvas {
                        document_id: DOCUMENT_ID.to_owned(),
                    },
                },
            )
            .expect("initial Canvas sync");
        let OwnedDocumentReadValue::CanvasSync {
            scene_json,
            scene_hash,
            ..
        } = initial.value
        else {
            panic!("expected Canvas sync")
        };
        let initial_scene: Value = serde_json::from_slice(&scene_json).expect("scene JSON");
        assert_eq!(initial_scene["elements"], json!([]));
        assert_eq!(scene_hash.len(), 64);

        let request = canvas_mutation_request("canvas:edit:1", 0, 1, "Native Canvas");
        let applied = seeded
            .module
            .apply(&context(), request.clone())
            .expect("Canvas edit");
        assert_eq!(applied.committed.value.head_seq, 1);
        assert_eq!(
            applied.committed.value.outcome,
            DocumentCommitOutcome::Committed
        );
        assert!(applied.committed.value.canvas.is_some());
        assert!(matches!(
            applied.events.first().map(|event| &event.payload),
            Some(CoreModuleEventPayload::OwnedDocument(
                OwnedDocumentEvent::CanvasUpdated { .. }
            ))
        ));
        let replayed = seeded
            .module
            .replay_document_events(&context(), 0, None)
            .expect("Canvas event replay");
        let DocumentEventReplay::Events { events, .. } = replayed else {
            panic!("Canvas mutation receipt should replay exactly")
        };
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].payload, applied.events[0].payload);
        seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "canvas:checkpoint".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::CreateCheckpoint {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        cause: "manual".to_owned(),
                        label: Some("Canvas checkpoint".to_owned()),
                    },
                },
            )
            .expect("Canvas checkpoint");
        let versions = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::ListVersions {
                        document_id: DOCUMENT_ID.to_owned(),
                        before_version_id: None,
                        limit: None,
                    },
                },
            )
            .expect("Canvas versions");
        let OwnedDocumentReadValue::Versions { items, .. } = versions.value else {
            panic!("expected Canvas versions")
        };
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["materializationKind"], "canvas_scene");
        let canvas_version_id = items[0]["versionId"]
            .as_str()
            .expect("Canvas version ID")
            .to_owned();

        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT document.head_seq, document.state_hash, scene.head_seq, scene.scene_hash, \
                            json_extract(element.element_json, '$.customData.type'), \
                            (SELECT count(*) FROM canvas_page_references WHERE document_id = ?1), \
                            (SELECT count(*) FROM canvas_scene_mutation_receipts WHERE document_id = ?1), \
                            (SELECT count(*) FROM change_log WHERE operation_id = 'canvas:edit:1') \
                     FROM documents document JOIN canvas_scenes scene ON scene.document_id = document.id \
                     JOIN canvas_scene_elements element ON element.document_id = document.id \
                     WHERE document.id = ?1",
                    [DOCUMENT_ID],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, i64>(7)?,
                        ))
                    },
                )?;
                assert_eq!(evidence.0, 1);
                assert_eq!(evidence.1, evidence.3);
                assert_eq!(evidence.2, 1);
                assert_eq!(evidence.4, "nodex-card-reference");
                assert_eq!((evidence.5, evidence.6, evidence.7), (1, 1, 1));
                Ok::<_, StoreError>(())
            })
            .expect("Canvas durable evidence");

        let duplicate = seeded
            .module
            .apply(&context(), request)
            .expect("Canvas exact retry");
        assert!(duplicate.committed.receipt.mutation.duplicate);
        assert_eq!(
            duplicate.committed.value.canvas.as_ref().unwrap()["duplicate"],
            true
        );
        assert!(duplicate.events.is_empty());

        let stale_merge = seeded
            .module
            .apply(
                &context(),
                canvas_mutation_request("canvas:edit:2", 0, 2, "Merged Canvas"),
            )
            .expect("stale element-clock merge");
        assert_eq!(stale_merge.committed.value.head_seq, 2);
        assert_eq!(
            stale_merge.committed.value.canvas.as_ref().unwrap()["skippedAppStateKeys"],
            json!(["gridSize"])
        );

        seeded.module.inject_failure_after_next_commit();
        let interrupted = seeded
            .module
            .apply(
                &context(),
                canvas_mutation_request("canvas:edit:3", 2, 3, "Recovered Canvas"),
            )
            .expect_err("failure after Canvas commit");
        assert_eq!(interrupted.code, CoreErrorCode::CoreUnavailable);
        let recovered = seeded
            .module
            .apply(
                &context(),
                canvas_mutation_request("canvas:edit:3", 2, 3, "Recovered Canvas"),
            )
            .expect("recover Canvas receipt");
        assert_eq!(recovered.committed.value.head_seq, 3);
        assert!(recovered.committed.receipt.mutation.duplicate);
        assert!(recovered.events.is_empty());

        fs::write(
            seeded._directory.path().join("assets/canvas-image.png"),
            b"managed-canvas-asset",
        )
        .expect("managed Canvas asset");
        let image = seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "canvas:image:add".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::ApplyCanvasMutation {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 3,
                        mutation: json!({
                            "elementCandidates": [{
                                "id": "element:image",
                                "type": "image",
                                "version": 1,
                                "versionNonce": 0,
                                "isDeleted": false,
                                "fileId": "file:image"
                            }],
                            "appStateIntents": {},
                            "fileAdditions": {
                                "file:image": {
                                    "id": "file:image",
                                    "mimeType": "image/png",
                                    "source": "nodex://assets/canvas-image.png",
                                    "created": 1
                                }
                            }
                        }),
                    },
                },
            )
            .expect("add Canvas image");
        assert_eq!(image.committed.value.head_seq, 4);
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT (SELECT count(*) FROM canvas_scene_files WHERE document_id = ?1), \
                            (SELECT count(*) FROM canvas_scene_file_refs WHERE document_id = ?1), \
                            (SELECT asset_hash FROM canvas_scene_file_refs WHERE document_id = ?1), \
                            (SELECT byte_length FROM canvas_scene_file_refs WHERE document_id = ?1)",
                    [DOCUMENT_ID],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )?;
                assert_eq!((evidence.0, evidence.1), (1, 1));
                assert_eq!(evidence.2, sha256(b"managed-canvas-asset"));
                assert_eq!(evidence.3, 20);
                Ok::<_, StoreError>(())
            })
            .expect("Canvas asset evidence");

        let removed = seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "canvas:image:remove".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::ApplyCanvasMutation {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 4,
                        mutation: json!({
                            "elementCandidates": [{
                                "id": "element:image",
                                "type": "image",
                                "version": 2,
                                "versionNonce": 0,
                                "isDeleted": true,
                                "fileId": "file:image"
                            }],
                            "appStateIntents": {},
                            "fileAdditions": {}
                        }),
                    },
                },
            )
            .expect("remove Canvas image");
        assert_eq!(removed.committed.value.head_seq, 5);
        assert_eq!(
            removed.committed.value.canvas.as_ref().unwrap()["removedFileIds"],
            json!(["file:image"])
        );
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let count: i64 = connection.query_row(
                    "SELECT (SELECT count(*) FROM canvas_scene_files WHERE document_id = ?1) + \
                            (SELECT count(*) FROM canvas_scene_file_refs WHERE document_id = ?1)",
                    [DOCUMENT_ID],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 0);
                Ok::<_, StoreError>(())
            })
            .expect("Canvas asset removed");

        let restored = seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "canvas:restore".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::RestoreVersion {
                        document_id: DOCUMENT_ID.to_owned(),
                        version_id: canvas_version_id.clone(),
                        generation: 1,
                        expected_head_seq: 5,
                    },
                },
            )
            .expect("restore Canvas version");
        assert_eq!(restored.committed.value.head_seq, 6);
        assert!(matches!(
            restored.events.first().map(|event| &event.payload),
            Some(CoreModuleEventPayload::OwnedDocument(
                OwnedDocumentEvent::DocumentInvalidated {
                    reason: DocumentInvalidationReason::Restored,
                    ..
                }
            ))
        ));
        let restored_scene = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::SyncCanvas {
                        document_id: DOCUMENT_ID.to_owned(),
                    },
                },
            )
            .expect("restored Canvas sync");
        let OwnedDocumentReadValue::CanvasSync { scene_json, .. } = restored_scene.value else {
            panic!("expected restored Canvas")
        };
        let restored_scene: Value = serde_json::from_slice(&scene_json).expect("restored scene");
        assert_eq!(restored_scene["elements"][0]["text"], "Native Canvas");
        let version = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::GetVersion {
                        document_id: DOCUMENT_ID.to_owned(),
                        version_id: canvas_version_id,
                    },
                },
            )
            .expect("Canvas version detail");
        let OwnedDocumentReadValue::Version { value } = version.value else {
            panic!("expected Canvas version detail")
        };
        assert_eq!(value["materialization"]["kind"], "canvas_scene");
    }

    #[test]
    fn owner_commands_create_retry_delete_and_replay_without_losing_history() {
        let seeded = empty_project_module();
        let create = owner_request(
            "owner:create-synced",
            DocumentOwnerCommand::CreateSyncedSource {
                source_block_id: CREATED_SOURCE_BLOCK_ID.to_owned(),
                document_id: CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                initial_blocks: vec![paragraph(CREATED_CONTENT_BLOCK_ID, "Shared body")],
                before: None,
            },
        );
        let created = seeded
            .module
            .apply(&context(), create.clone())
            .expect("create Synced Block source");
        assert_eq!(created.committed.value.head_seq, 1);
        assert_eq!(created.events.len(), 1);
        assert_eq!(
            created
                .committed
                .value
                .owner_effect
                .as_ref()
                .expect("owner effect")
                .created_block_ids,
            vec![
                CREATED_SOURCE_BLOCK_ID.to_owned(),
                CREATED_CONTENT_BLOCK_ID.to_owned(),
            ]
        );

        let duplicate = seeded
            .module
            .apply(&context(), create)
            .expect("exact owner retry");
        assert!(duplicate.committed.receipt.mutation.duplicate);
        assert!(duplicate.events.is_empty());

        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT document.readiness, document.authority, document.head_seq, \
                            owner.lifecycle, child.lifecycle, child.containing_document_id, \
                            (SELECT count(*) FROM document_snapshots WHERE document_id = ?1), \
                            (SELECT count(*) FROM document_updates WHERE document_id = ?1), \
                            (SELECT count(*) FROM core_module_receipts \
                              WHERE module_name = 'owned_document' AND operation_id = ?2) \
                     FROM documents document \
                     JOIN block_documents ownership ON ownership.document_id = document.id \
                     JOIN blocks owner ON owner.id = ownership.block_id \
                     JOIN blocks child ON child.id = ?3 \
                     WHERE document.id = ?1",
                    params![
                        CREATED_SOURCE_DOCUMENT_ID,
                        "owner:create-synced",
                        CREATED_CONTENT_BLOCK_ID,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, i64>(7)?,
                            row.get::<_, i64>(8)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        "ready".to_owned(),
                        "ydoc_primary".to_owned(),
                        1,
                        "active".to_owned(),
                        "active".to_owned(),
                        CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                        1,
                        1,
                        1,
                    )
                );
                Ok::<_, StoreError>(())
            })
            .expect("created owner evidence");

        let delete = owner_request(
            "owner:delete-synced",
            DocumentOwnerCommand::DeleteOwnedSource {
                owner_kind: DeletableOwnedSourceKind::SyncedBlock,
                owner: DocumentOwnerRevision {
                    owner_block_id: CREATED_SOURCE_BLOCK_ID.to_owned(),
                    document_id: CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                    generation: 1,
                    head_seq: 1,
                    metadata_revision: 1,
                    location_revision: 1,
                },
            },
        );
        let deleted = seeded
            .module
            .apply(&context(), delete.clone())
            .expect("delete unreferenced source");
        assert_eq!(deleted.events.len(), 1);
        assert!(matches!(
            &deleted.events[0].payload,
            CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentInvalidated {
                reason: DocumentInvalidationReason::AccessChanged,
                ..
            })
        ));
        let delete_retry = seeded
            .module
            .apply(&context(), delete)
            .expect("exact delete retry");
        assert!(delete_retry.committed.receipt.mutation.duplicate);
        assert!(delete_retry.events.is_empty());

        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT owner.lifecycle, child.lifecycle, document.head_seq, \
                            (SELECT count(*) FROM document_snapshots WHERE document_id = ?1), \
                            (SELECT count(*) FROM document_updates WHERE document_id = ?1), \
                            (SELECT count(*) FROM document_materializations WHERE document_id = ?1) \
                     FROM documents document \
                     JOIN block_documents ownership ON ownership.document_id = document.id \
                     JOIN blocks owner ON owner.id = ownership.block_id \
                     JOIN blocks child ON child.id = ?2 \
                     WHERE document.id = ?1",
                    params![CREATED_SOURCE_DOCUMENT_ID, CREATED_CONTENT_BLOCK_ID],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    ("deleted".to_owned(), "deleted".to_owned(), 1, 1, 1, 1)
                );
                Ok::<_, StoreError>(())
            })
            .expect("retained source evidence");

        let replay = seeded
            .module
            .replay_document_events(&context(), 0, None)
            .expect("owner event replay");
        let DocumentEventReplay::Events { events, .. } = replay else {
            panic!("expected retained owner events")
        };
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[1].payload,
            CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentInvalidated {
                reason: DocumentInvalidationReason::AccessChanged,
                ..
            })
        ));
    }

    #[test]
    fn owner_command_failure_rolls_back_staged_identity_and_receipt() {
        let seeded = empty_project_module();
        let error = seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:invalid-create",
                    DocumentOwnerCommand::CreateSyncedSource {
                        source_block_id: CREATED_SOURCE_BLOCK_ID.to_owned(),
                        document_id: CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                        initial_blocks: vec![json!({
                            "id": CREATED_CONTENT_BLOCK_ID,
                            "type": "page",
                            "props": {},
                            "children": [],
                        })],
                        before: None,
                    },
                ),
            )
            .expect_err("typed Page cannot enter a Synced Block genesis");
        assert_eq!(error.code, CoreErrorCode::InvalidInput);
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT (SELECT count(*) FROM blocks WHERE id IN (?1, ?2)), \
                            (SELECT count(*) FROM documents WHERE id = ?3), \
                            (SELECT count(*) FROM core_module_receipts WHERE operation_id = ?4)",
                    params![
                        CREATED_SOURCE_BLOCK_ID,
                        CREATED_CONTENT_BLOCK_ID,
                        CREATED_SOURCE_DOCUMENT_ID,
                        "owner:invalid-create",
                    ],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(evidence, (0, 0, 0));
                Ok::<_, StoreError>(())
            })
            .expect("rollback evidence");
    }

    #[test]
    fn owner_command_retry_recovers_commit_lost_before_publication() {
        let seeded = empty_project_module();
        let request = owner_request(
            "owner:create-postcommit",
            DocumentOwnerCommand::CreateSyncedSource {
                source_block_id: CREATED_SOURCE_BLOCK_ID.to_owned(),
                document_id: CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                initial_blocks: vec![paragraph(CREATED_CONTENT_BLOCK_ID, "Recovered")],
                before: None,
            },
        );
        seeded.module.inject_failure_after_next_commit();
        let failure = seeded
            .module
            .apply(&context(), request.clone())
            .expect_err("injected post-commit failure");
        assert_eq!(failure.code, CoreErrorCode::CoreUnavailable);

        let recovered = seeded
            .module
            .apply(&context(), request)
            .expect("recover durable owner receipt");
        assert!(recovered.committed.receipt.mutation.duplicate);
        assert!(recovered.events.is_empty());
        assert_eq!(recovered.committed.value.head_seq, 1);
    }

    #[test]
    fn template_instantiation_copies_fresh_ids_into_an_exact_target_head() {
        let seeded = seeded_module();
        let created = seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:create-template",
                    DocumentOwnerCommand::CreateTemplate {
                        source_block_id: CREATED_TEMPLATE_BLOCK_ID.to_owned(),
                        document_id: CREATED_TEMPLATE_DOCUMENT_ID.to_owned(),
                        display_name: "Meeting note".to_owned(),
                        initial_blocks: vec![paragraph(
                            CREATED_TEMPLATE_CONTENT_ID,
                            "Template body",
                        )],
                        before: None,
                    },
                ),
            )
            .expect("create Reusable Template");
        assert_eq!(created.committed.value.head_seq, 1);
        let instantiated = seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:instantiate-template",
                    DocumentOwnerCommand::InstantiateTemplate {
                        source_block_id: CREATED_TEMPLATE_BLOCK_ID.to_owned(),
                        source: DocumentHeadRevision {
                            document_id: CREATED_TEMPLATE_DOCUMENT_ID.to_owned(),
                            generation: 1,
                            head_seq: 1,
                        },
                        target: DocumentHeadRevision {
                            document_id: DOCUMENT_ID.to_owned(),
                            generation: 1,
                            head_seq: 1,
                        },
                        parent_block_id: None,
                        before_block_id: None,
                    },
                ),
            )
            .expect("instantiate Reusable Template");
        let effect = instantiated
            .committed
            .value
            .owner_effect
            .as_ref()
            .expect("template effect");
        assert_eq!(effect.created_block_ids.len(), 1);
        assert_ne!(effect.created_block_ids[0], CREATED_TEMPLATE_CONTENT_ID);
        assert_eq!(instantiated.committed.value.head_seq, 2);
        assert_eq!(instantiated.events.len(), 1);

        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let copied_document = connection.query_row(
                    "SELECT containing_document_id FROM blocks WHERE id = ?1",
                    [&effect.created_block_ids[0]],
                    |row| row.get::<_, String>(0),
                )?;
                let source_document = connection.query_row(
                    "SELECT containing_document_id FROM blocks WHERE id = ?1",
                    [CREATED_TEMPLATE_CONTENT_ID],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(copied_document, DOCUMENT_ID);
                assert_eq!(source_document, CREATED_TEMPLATE_DOCUMENT_ID);
                Ok::<_, StoreError>(())
            })
            .expect("template copy identities");
    }

    #[test]
    fn synced_promotion_and_demotion_preserve_content_identity_atomically() {
        let seeded = seeded_module();
        let root_block_id = seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let tree = connection.query_row(
                    "SELECT block_tree_json FROM document_materializations WHERE document_id = ?1",
                    [DOCUMENT_ID],
                    |row| row.get::<_, String>(0),
                )?;
                let tree = serde_json::from_str::<Value>(&tree)
                    .map_err(|_| internal("test Block tree"))?;
                tree.as_array()
                    .and_then(|blocks| blocks.first())
                    .and_then(|block| block.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .ok_or_else(|| internal("test root Block"))
            })
            .expect("host root Block");
        let promoted = seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:promote-synced",
                    DocumentOwnerCommand::PromoteSyncedSource {
                        host: DocumentHeadRevision {
                            document_id: DOCUMENT_ID.to_owned(),
                            generation: 1,
                            head_seq: 1,
                        },
                        root_block_id: root_block_id.clone(),
                        reference_block_id: CREATED_REFERENCE_BLOCK_ID.to_owned(),
                        source_block_id: CREATED_SOURCE_BLOCK_ID.to_owned(),
                        source_document_id: CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                    },
                ),
            )
            .expect("promote Page root to Synced Block source");
        assert_eq!(promoted.committed.value.head_seq, 2);
        assert_eq!(promoted.events.len(), 2);
        seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:delete-referenced-synced",
                    DocumentOwnerCommand::DeleteOwnedSource {
                        owner_kind: DeletableOwnedSourceKind::SyncedBlock,
                        owner: DocumentOwnerRevision {
                            owner_block_id: CREATED_SOURCE_BLOCK_ID.to_owned(),
                            document_id: CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                            generation: 1,
                            head_seq: 1,
                            metadata_revision: 1,
                            location_revision: 1,
                        },
                    },
                ),
            )
            .expect_err("referenced Synced Block source cannot be deleted");
        let demoted = seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:demote-synced",
                    DocumentOwnerCommand::DemoteSyncedSource {
                        host: DocumentHeadRevision {
                            document_id: DOCUMENT_ID.to_owned(),
                            generation: 1,
                            head_seq: 2,
                        },
                        source: DocumentHeadRevision {
                            document_id: CREATED_SOURCE_DOCUMENT_ID.to_owned(),
                            generation: 1,
                            head_seq: 1,
                        },
                        reference_block_id: CREATED_REFERENCE_BLOCK_ID.to_owned(),
                        source_block_id: CREATED_SOURCE_BLOCK_ID.to_owned(),
                    },
                ),
            )
            .expect("demote sole Synced Block instance");
        assert_eq!(demoted.committed.value.head_seq, 4);
        assert_eq!(demoted.events.len(), 4);
        let effect = demoted
            .committed
            .value
            .owner_effect
            .as_ref()
            .expect("demotion effect");
        assert!(effect.preserved_block_ids.contains(&root_block_id));

        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT root.lifecycle, root.containing_document_id, source.lifecycle, \
                            reference.lifecycle, host.head_seq, source_document.head_seq, \
                            (SELECT count(*) FROM document_snapshots \
                              WHERE document_id = source_document.id) \
                     FROM blocks root \
                     JOIN blocks source ON source.id = ?2 \
                     JOIN blocks reference ON reference.id = ?3 \
                     JOIN documents host ON host.id = ?4 \
                     JOIN documents source_document ON source_document.id = ?5 \
                     WHERE root.id = ?1",
                    params![
                        root_block_id,
                        CREATED_SOURCE_BLOCK_ID,
                        CREATED_REFERENCE_BLOCK_ID,
                        DOCUMENT_ID,
                        CREATED_SOURCE_DOCUMENT_ID,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        "active".to_owned(),
                        DOCUMENT_ID.to_owned(),
                        "deleted".to_owned(),
                        "deleted".to_owned(),
                        4,
                        2,
                        1,
                    )
                );
                Ok::<_, StoreError>(())
            })
            .expect("demotion identity evidence");
    }

    #[test]
    fn canvas_owner_create_and_delete_support_zero_head_invalidation_replay() {
        let seeded = empty_project_module();
        let created = seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:create-canvas",
                    DocumentOwnerCommand::CreateCanvasOwner {
                        block_id: CREATED_CANVAS_BLOCK_ID.to_owned(),
                        document_id: CREATED_CANVAS_DOCUMENT_ID.to_owned(),
                        display_name: "Sketch".to_owned(),
                        before: None,
                    },
                ),
            )
            .expect("create non-primary Canvas");
        assert_eq!(created.committed.value.head_seq, 0);
        assert!(created.events.is_empty());
        let deleted = seeded
            .module
            .apply(
                &context(),
                owner_request(
                    "owner:delete-canvas",
                    DocumentOwnerCommand::DeleteCanvasOwner {
                        owner: DocumentOwnerRevision {
                            owner_block_id: CREATED_CANVAS_BLOCK_ID.to_owned(),
                            document_id: CREATED_CANVAS_DOCUMENT_ID.to_owned(),
                            generation: 1,
                            head_seq: 0,
                            metadata_revision: 1,
                            location_revision: 1,
                        },
                    },
                ),
            )
            .expect("delete non-primary Canvas");
        assert_eq!(deleted.events.len(), 1);
        let replay = seeded
            .module
            .replay_document_events(&context(), 0, None)
            .expect("Canvas invalidation replay");
        let DocumentEventReplay::Events { events, .. } = replay else {
            panic!("expected Canvas invalidation event")
        };
        assert_eq!(events, deleted.events);
    }

    #[test]
    fn prepare_owner_commits_registered_genesis_once() {
        for (owner_type, schema_key, schema_version) in [
            ("page", "nodex.page", 2),
            ("synced_block_source", "nodex.synced-block", 1),
            ("reusable_template_source", "nodex.reusable-template", 1),
        ] {
            let seeded = pending_module(owner_type, schema_key, schema_version);
            let request = ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: format!("prepare:{owner_type}"),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: OwnedDocumentIntent::PrepareOwner {
                    owner_block_id: OWNER_BLOCK_ID.to_owned(),
                },
            };
            let prepared = seeded
                .module
                .apply(&context(), request.clone())
                .expect("prepare pending owner");
            assert_eq!(prepared.committed.value.head_seq, 1);
            assert_eq!(
                prepared.committed.value.outcome,
                DocumentCommitOutcome::Committed
            );
            assert!(!prepared.events.is_empty());

            seeded
                .kernel
                .readers()
                .read_default(|connection| {
                    let evidence = connection.query_row(
                        "SELECT document.readiness, document.authority, document.head_seq, \
                                materialization.projected_seq, \
                                json_array_length(materialization.block_tree_json), \
                                (SELECT count(*) FROM document_updates WHERE document_id = ?1), \
                                (SELECT count(*) FROM document_snapshots WHERE document_id = ?1), \
                                (SELECT count(*) FROM document_update_receipts WHERE document_id = ?1), \
                                (SELECT count(*) FROM change_log WHERE operation_id = ?2) \
                         FROM documents document JOIN document_materializations materialization \
                           ON materialization.document_id = document.id WHERE document.id = ?1",
                        params![DOCUMENT_ID, format!("prepare:{owner_type}")],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, i64>(3)?,
                                row.get::<_, i64>(4)?,
                                row.get::<_, i64>(5)?,
                                row.get::<_, i64>(6)?,
                                row.get::<_, i64>(7)?,
                                row.get::<_, i64>(8)?,
                            ))
                        },
                    )?;
                    assert_eq!(
                        evidence,
                        (
                            "ready".to_owned(),
                            "ydoc_primary".to_owned(),
                            1,
                            1,
                            1,
                            1,
                            1,
                            1,
                            1,
                        )
                    );
                    Ok::<_, StoreError>(())
                })
                .expect("genesis evidence");

            let duplicate = seeded
                .module
                .apply(&context(), request)
                .expect("exact prepare retry");
            assert!(duplicate.committed.receipt.mutation.duplicate);
            assert!(duplicate.events.is_empty());

            let no_change = seeded
                .module
                .apply(
                    &context(),
                    ModuleApplyRequest {
                        version: CORE_CONTRACT_VERSION,
                        operation_id: format!("prepare-again:{owner_type}"),
                        store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                        intent: OwnedDocumentIntent::PrepareOwner {
                            owner_block_id: OWNER_BLOCK_ID.to_owned(),
                        },
                    },
                )
                .expect("already editable owner");
            assert_eq!(
                no_change.committed.value.outcome,
                DocumentCommitOutcome::NoChange
            );
            assert!(no_change.events.is_empty());
        }
    }

    #[test]
    fn sync_apply_and_exact_retry_share_one_durable_authority() {
        let seeded = seeded_module();
        let sync = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::SyncYjs {
                        document_id: DOCUMENT_ID.to_owned(),
                        state_vector: Vec::new(),
                    },
                },
            )
            .expect("Yjs sync");
        let OwnedDocumentReadValue::YjsSync { update, .. } = sync.value else {
            panic!("expected Yjs sync")
        };
        let synced = YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &update)
            .expect("sync update is Yjs-compatible");
        assert!(synced.state_vector_equals_v1(&seeded.state_vector).unwrap());

        let update = title_update(&seeded.full_state, &seeded.state_vector, "Native Rust edit");
        let request = apply_request("update:native-title", 1, update.clone());
        let applied = seeded
            .module
            .apply(&context(), request.clone())
            .expect("Yjs apply");
        assert_eq!(applied.committed.value.head_seq, 2);
        assert_eq!(
            applied.committed.value.outcome,
            DocumentCommitOutcome::Committed
        );
        assert!(!applied.events.is_empty());
        assert!(!applied.committed.receipt.mutation.duplicate);

        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT document.head_seq, materialization.title, \
                            (SELECT count(*) FROM document_update_receipts WHERE update_id = ?1), \
                            (SELECT count(*) FROM core_module_receipts WHERE operation_id = ?1), \
                            (SELECT count(*) FROM change_log WHERE operation_id = ?1) \
                     FROM documents document \
                     JOIN document_materializations materialization ON materialization.document_id = document.id \
                     WHERE document.id = ?2",
                    params!["update:native-title", DOCUMENT_ID],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?;
                assert_eq!(evidence, (2, "Native Rust edit".to_owned(), 1, 1, 1));
                let fts: i64 = connection.query_row(
                    "SELECT count(*) FROM block_search_units_fts \
                     WHERE block_search_units_fts MATCH 'Native'",
                    [],
                    |row| row.get(0),
                )?;
                assert!(fts > 0);
                Ok::<_, StoreError>(())
            })
            .expect("durable evidence");

        let duplicate = seeded
            .module
            .apply(&context(), request)
            .expect("exact retry");
        assert!(duplicate.committed.receipt.mutation.duplicate);
        assert!(duplicate.events.is_empty());
        assert_eq!(
            duplicate.committed.event_sequence,
            applied.committed.event_sequence
        );
        assert!(seeded.module.cache_metrics().expect("cache metrics").hits > 0);
    }

    #[test]
    fn realtime_requires_subscription_replays_durable_events_and_clears_awareness() {
        let seeded = seeded_module();
        let adapter = OwnedDocumentRealtimeAdapter::new(seeded.module.clone());
        let first_context = context_for("renderer:first");
        let second_context = context_for("renderer:second");
        let request = apply_request(
            "update:realtime",
            1,
            title_update(
                &seeded.full_state,
                &seeded.state_vector,
                "Realtime authority",
            ),
        );

        let unauthorized = adapter
            .apply(&first_context, "client:first", request.clone())
            .expect_err("subscribe-before-sync is mandatory");
        assert_eq!(unauthorized.code, CoreErrorCode::Unauthorized);
        let unauthorized_sync = adapter
            .sync_yjs(
                &first_context,
                "client:first",
                DOCUMENT_ID.to_owned(),
                Vec::new(),
            )
            .expect_err("sync also requires a subscription");
        assert_eq!(unauthorized_sync.code, CoreErrorCode::Unauthorized);

        let first = adapter
            .subscribe(
                &first_context,
                DOCUMENT_ID.to_owned(),
                "client:first".to_owned(),
            )
            .expect("first subscription");
        let second = adapter
            .subscribe(
                &second_context,
                DOCUMENT_ID.to_owned(),
                "client:second".to_owned(),
            )
            .expect("second subscription");
        assert_eq!(first.head_seq, 1);
        assert_eq!(second.head_seq, 1);
        assert!(first.awareness_update.is_some());
        let synced = adapter
            .sync_yjs(
                &first_context,
                "client:first",
                DOCUMENT_ID.to_owned(),
                Vec::new(),
            )
            .expect("subscribed sync");
        assert!(matches!(
            synced.value,
            OwnedDocumentReadValue::YjsSync { .. }
        ));

        let applied = adapter
            .apply(&first_context, "client:first", request)
            .expect("subscribed mutation");
        assert_eq!(applied.committed.value.head_seq, 2);
        let replay = adapter
            .replay("renderer:second", "client:second", 0, None)
            .expect("durable replay");
        assert_eq!(replay.events.len(), 1);
        let DocumentRealtimeEvent::Committed(replayed) = &replay.events[0] else {
            panic!("expected committed event")
        };
        assert_eq!(replayed.sequence, applied.committed.event_sequence);
        assert_eq!(replayed.payload, applied.events[0].payload);

        let mut remote_awareness = DocumentAwareness::new("awareness:remote");
        remote_awareness
            .set_local_state(&json!({ "user": "first" }))
            .expect("local awareness");
        let awareness_client_id = remote_awareness.client_id();
        let awareness_update = remote_awareness.local_update_v1().expect("join update");
        let publication = adapter
            .publish_awareness(
                "renderer:first",
                "client:first",
                &StoreEpoch(STORE_EPOCH.to_owned()),
                1,
                &awareness_update,
            )
            .expect("publish awareness")
            .expect("awareness changed");
        assert_eq!(publication.recipient_connections, ["renderer:second"]);

        let mut observer = DocumentAwareness::new("awareness:observer");
        observer
            .apply_update_v1(&awareness_update)
            .expect("observe join");
        assert!(observer.state(awareness_client_id).is_some());
        let disconnected = adapter
            .disconnect("renderer:first")
            .expect("disconnect clears presence");
        assert_eq!(disconnected.len(), 1);
        let DocumentRealtimeEvent::Awareness { update, .. } = &disconnected[0].event else {
            panic!("expected Awareness leave")
        };
        observer.apply_update_v1(update).expect("observe leave");
        assert!(observer.state(awareness_client_id).is_none());

        seeded
            .module
            .compact(
                &second_context,
                StoreEpoch(STORE_EPOCH.to_owned()),
                DOCUMENT_ID.to_owned(),
                1,
                2,
            )
            .expect("compact event update tail");
        let compacted = adapter
            .replay("renderer:second", "client:second", 0, None)
            .expect("compacted replay returns resync");
        assert!(matches!(
            compacted.events.as_slice(),
            [DocumentRealtimeEvent::ResyncRequired {
                document_id,
                head_seq: 2,
                ..
            }] if document_id == DOCUMENT_ID
        ));
    }

    #[test]
    fn realtime_replays_a_commit_lost_before_publication() {
        let seeded = seeded_module();
        let adapter = OwnedDocumentRealtimeAdapter::new(seeded.module.clone());
        let first_context = context_for("renderer:faulted");
        adapter
            .subscribe(
                &first_context,
                DOCUMENT_ID.to_owned(),
                "client:faulted".to_owned(),
            )
            .expect("subscription");
        let request = apply_request(
            "update:lost-publication",
            1,
            title_update(
                &seeded.full_state,
                &seeded.state_vector,
                "Durable before publication",
            ),
        );
        seeded.module.inject_failure_after_next_commit();
        adapter
            .apply(&first_context, "client:faulted", request.clone())
            .expect_err("injected post-commit publication failure");

        let retry = adapter
            .apply(&first_context, "client:faulted", request)
            .expect("exact retry recovers receipt");
        assert!(retry.committed.receipt.mutation.duplicate);
        let replay = adapter
            .replay("renderer:faulted", "client:faulted", 0, None)
            .expect("reconnect replay");
        assert!(matches!(
            replay.events.as_slice(),
            [DocumentRealtimeEvent::Committed(event)]
                if event.sequence == retry.committed.event_sequence
        ));
    }

    #[test]
    fn retry_recovers_a_commit_that_failed_before_cache_swap_and_publication() {
        let seeded = seeded_module();
        let first_update = title_update(
            &seeded.full_state,
            &seeded.state_vector,
            "First native edit",
        );
        let mut engine =
            YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &seeded.full_state).unwrap();
        let first_candidate = engine.prepare_update_v1(&first_update).unwrap();
        engine.commit_candidate(first_candidate).unwrap();
        let second_update = title_update(
            &engine.full_state_v1(),
            &engine.state_vector_v1(),
            "Committed before publication",
        );
        seeded
            .module
            .apply(&context(), apply_request("update:first", 1, first_update))
            .expect("first update");

        let request = apply_request("update:fault", 2, second_update);
        seeded.module.inject_failure_after_next_commit();
        let failure = seeded
            .module
            .apply(&context(), request.clone())
            .expect_err("fault occurs after commit");
        assert_eq!(failure.code, CoreErrorCode::CoreUnavailable);

        let recovered = seeded
            .module
            .apply(&context(), request)
            .expect("receipt recovers committed result");
        assert!(recovered.committed.receipt.mutation.duplicate);
        assert_eq!(recovered.committed.value.head_seq, 3);
        assert!(recovered.events.is_empty());
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let head: i64 = connection.query_row(
                    "SELECT head_seq FROM documents WHERE id = ?1",
                    [DOCUMENT_ID],
                    |row| row.get(0),
                )?;
                let title: String = connection.query_row(
                    "SELECT title FROM document_materializations WHERE document_id = ?1",
                    [DOCUMENT_ID],
                    |row| row.get(0),
                )?;
                assert_eq!(head, 3);
                assert_eq!(title, "Committed before publication");
                Ok::<_, StoreError>(())
            })
            .expect("committed authority survives missed publication");
    }

    #[test]
    fn checkpoints_list_get_and_restore_immutable_document_history() {
        let seeded = seeded_module();
        let checkpoint_request = ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: "checkpoint:initial".to_owned(),
            store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
            intent: OwnedDocumentIntent::CreateCheckpoint {
                document_id: DOCUMENT_ID.to_owned(),
                generation: 1,
                expected_head_seq: 1,
                cause: "manual".to_owned(),
                label: Some("Initial Page".to_owned()),
            },
        };
        let checkpoint = seeded
            .module
            .apply(&context(), checkpoint_request.clone())
            .expect("checkpoint");
        assert_eq!(checkpoint.committed.value.head_seq, 1);
        assert!(checkpoint.events.is_empty());
        assert!(
            seeded
                .module
                .apply(&context(), checkpoint_request)
                .unwrap()
                .committed
                .receipt
                .mutation
                .duplicate
        );
        let versions = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::ListVersions {
                        document_id: DOCUMENT_ID.to_owned(),
                        before_version_id: None,
                        limit: Some(50),
                    },
                },
            )
            .expect("history list");
        let OwnedDocumentReadValue::Versions {
            items,
            next_version_id,
        } = versions.value
        else {
            panic!("expected history list")
        };
        assert_eq!(items.len(), 1);
        assert!(next_version_id.is_none());
        let version_id = items[0]["versionId"].as_str().unwrap().to_owned();
        let version = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::GetVersion {
                        document_id: DOCUMENT_ID.to_owned(),
                        version_id: version_id.clone(),
                    },
                },
            )
            .expect("history detail");
        let OwnedDocumentReadValue::Version { value } = version.value else {
            panic!("expected history detail")
        };
        assert_eq!(
            value["summary"]["checkpointMetadata"]["format"],
            "block_tree_snapshot_v2"
        );

        let update = title_update(
            &seeded.full_state,
            &seeded.state_vector,
            "Changed after checkpoint",
        );
        seeded
            .module
            .apply(
                &context(),
                apply_request("update:after-checkpoint", 1, update),
            )
            .unwrap();
        let restore_request = ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: "restore:initial".to_owned(),
            store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
            intent: OwnedDocumentIntent::RestoreVersion {
                document_id: DOCUMENT_ID.to_owned(),
                version_id,
                generation: 1,
                expected_head_seq: 2,
            },
        };
        let restored = seeded
            .module
            .apply(&context(), restore_request.clone())
            .expect("restore checkpoint");
        assert_eq!(restored.committed.value.head_seq, 3);
        assert!(matches!(
            restored.events[0].payload,
            CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentInvalidated {
                reason: DocumentInvalidationReason::Restored,
                ..
            })
        ));
        assert!(
            seeded
                .module
                .apply(&context(), restore_request)
                .unwrap()
                .committed
                .receipt
                .mutation
                .duplicate
        );
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let title: String = connection.query_row(
                    "SELECT title FROM document_materializations WHERE document_id = ?1",
                    [DOCUMENT_ID],
                    |row| row.get(0),
                )?;
                let versions: i64 = connection.query_row(
                    "SELECT count(*) FROM document_versions WHERE document_id = ?1",
                    [DOCUMENT_ID],
                    |row| row.get(0),
                )?;
                let restored_events: i64 = connection.query_row(
                    "SELECT count(*) FROM change_log \
                     WHERE operation_id = 'restore:initial' \
                       AND kind = 'owned_document.document_restored'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(title, "");
                assert_eq!(versions, 3);
                assert_eq!(restored_events, 1);
                Ok::<_, StoreError>(())
            })
            .unwrap();
    }

    #[test]
    fn compaction_reconstructs_from_one_verified_snapshot_and_keeps_receipts() {
        let seeded = seeded_module();
        let update = title_update(
            &seeded.full_state,
            &seeded.state_vector,
            "Compacted authority",
        );
        let request = apply_request("update:before-compaction", 1, update);
        seeded.module.apply(&context(), request.clone()).unwrap();
        let compacted = seeded
            .module
            .compact(
                &context(),
                StoreEpoch(STORE_EPOCH.to_owned()),
                DOCUMENT_ID.to_owned(),
                1,
                2,
            )
            .expect("compact current head");
        assert_eq!(compacted.snapshot_seq, 2);
        assert_eq!(compacted.pruned_update_count, 2);
        assert_eq!(compacted.retained_receipt_count, 2);
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence: (i64, i64, i64) = connection.query_row(
                    "SELECT \
                       (SELECT count(*) FROM document_updates WHERE document_id = ?1), \
                       (SELECT count(*) FROM document_snapshots WHERE document_id = ?1), \
                       (SELECT count(*) FROM document_update_receipts WHERE document_id = ?1)",
                    [DOCUMENT_ID],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
                assert_eq!(evidence, (0, 1, 2));
                Ok::<_, StoreError>(())
            })
            .unwrap();

        let cold_module = OwnedDocumentModule::new(PROFILE_ID, LIBRARY_ID, &seeded.kernel);
        let synced = cold_module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::SyncYjs {
                        document_id: DOCUMENT_ID.to_owned(),
                        state_vector: Vec::new(),
                    },
                },
            )
            .expect("cold snapshot reconstruction");
        let OwnedDocumentReadValue::YjsSync { update, .. } = synced.value else {
            panic!("expected Yjs sync")
        };
        let engine = YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &update).unwrap();
        assert_eq!(
            materialize_engine(&engine, BlockDocumentSchema::PageV2)
                .unwrap()
                .title,
            "Compacted authority"
        );
        assert!(
            cold_module
                .apply(&context(), request)
                .unwrap()
                .committed
                .receipt
                .mutation
                .duplicate
        );
        let repeated = cold_module
            .compact(
                &context(),
                StoreEpoch(STORE_EPOCH.to_owned()),
                DOCUMENT_ID.to_owned(),
                1,
                2,
            )
            .expect("repeat compaction");
        assert_eq!(repeated.pruned_update_count, 0);
        assert_eq!(repeated.retained_receipt_count, 2);
    }

    #[test]
    fn checkpoint_creation_bounds_unpinned_revision_retention() {
        let seeded = seeded_module();
        seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "checkpoint:retention-base".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::CreateCheckpoint {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        cause: "manual".to_owned(),
                        label: None,
                    },
                },
            )
            .unwrap();
        seeded
            .kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute_batch(
                        "WITH RECURSIVE sequence(value) AS (\
                           SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 501\
                         ) \
                         INSERT INTO document_versions(\
                           version_id, document_id, project_id, generation, base_head_seq, \
                           schema_key, schema_version, cause, label, actor_json, revision_kind, \
                           source_mutation_id, source_change_seq, pinned, checkpoint_format, \
                           full_update_blob, state_vector, checkpoint_hash, byte_length, created_at\
                         ) \
                         SELECT printf('retention:auto:%03d', sequence.value), version.document_id, \
                           version.project_id, version.generation, version.base_head_seq, \
                           version.schema_key, version.schema_version, 'automatic', NULL, '{}', \
                           'automatic', NULL, NULL, 0, version.checkpoint_format, \
                           version.full_update_blob, version.state_vector, version.checkpoint_hash, \
                           version.byte_length, version.created_at \
                         FROM sequence \
                         JOIN document_versions version \
                           ON version.version_id LIKE 'document-version:%' \
                         LIMIT 501;",
                    )?;
                    Ok(())
                })
            })
            .unwrap();
        seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "checkpoint:retention-prune".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::CreateCheckpoint {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        cause: "manual".to_owned(),
                        label: Some("Retention boundary".to_owned()),
                    },
                },
            )
            .unwrap();
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let counts: (i64, i64) = connection.query_row(
                    "SELECT \
                       sum(CASE WHEN pinned = 0 THEN 1 ELSE 0 END), \
                       sum(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) \
                     FROM document_versions WHERE document_id = ?1",
                    [DOCUMENT_ID],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(counts, (500, 2));
                Ok::<_, StoreError>(())
            })
            .unwrap();
    }

    #[test]
    fn revision_sessions_checkpoint_edit_burst_boundaries() {
        let seeded = seeded_module();
        let first_update = title_update(&seeded.full_state, &seeded.state_vector, "Burst one");
        let mut engine =
            YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &seeded.full_state).unwrap();
        let first_candidate = engine.prepare_update_v1(&first_update).unwrap();
        engine.commit_candidate(first_candidate).unwrap();
        seeded
            .module
            .apply(
                &context(),
                apply_request("update:burst-one", 1, first_update),
            )
            .unwrap();
        let second_update = title_update(
            &engine.full_state_v1(),
            &engine.state_vector_v1(),
            "Burst two",
        );
        let second_candidate = engine.prepare_update_v1(&second_update).unwrap();
        engine.commit_candidate(second_candidate).unwrap();
        seeded
            .module
            .apply(
                &context(),
                apply_request("update:burst-two", 2, second_update),
            )
            .unwrap();
        seeded
            .kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    let evidence: (i64, i64) = transaction.query_row(
                        "SELECT \
                           (SELECT count(*) FROM document_versions WHERE document_id = ?1), \
                           (SELECT dirty_head_seq FROM document_revision_sessions \
                            WHERE document_id = ?1)",
                        [DOCUMENT_ID],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )?;
                    assert_eq!(evidence, (1, 3));
                    transaction.execute(
                        "UPDATE document_revision_sessions \
                         SET last_edit_at = '2020-01-01T00:00:00.000Z' \
                         WHERE document_id = ?1",
                        [DOCUMENT_ID],
                    )?;
                    Ok(())
                })
            })
            .unwrap();
        let third_update = title_update(
            &engine.full_state_v1(),
            &engine.state_vector_v1(),
            "Burst after idle",
        );
        seeded
            .module
            .apply(
                &context(),
                apply_request("update:after-idle", 3, third_update),
            )
            .unwrap();
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence: (i64, i64, i64) = connection.query_row(
                    "SELECT \
                       (SELECT count(*) FROM document_versions \
                        WHERE document_id = ?1 AND cause = 'before_edit_burst'), \
                       (SELECT count(*) FROM document_versions \
                        WHERE document_id = ?1 AND cause = 'idle_edit'), \
                       (SELECT dirty_head_seq FROM document_revision_sessions \
                        WHERE document_id = ?1)",
                    [DOCUMENT_ID],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
                assert_eq!(evidence, (1, 1, 4));
                Ok::<_, StoreError>(())
            })
            .unwrap();
    }

    #[test]
    fn stale_yjs_updates_crossing_structural_barriers_become_recovery_artifacts() {
        let seeded = seeded_module();
        let materialization = materialize_engine(
            &YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &seeded.full_state).unwrap(),
            BlockDocumentSchema::PageV2,
        )
        .unwrap();
        let title_etag = seeded
            .kernel
            .readers()
            .read_default(|connection| {
                Ok::<_, StoreError>(
                    super::super::semantic::mint_etag(
                        connection,
                        "title",
                        PROJECT_ID,
                        STORE_EPOCH,
                        &[DOCUMENT_ID],
                        json!({ "richTitle": materialization.rich_title }),
                    )
                    .unwrap(),
                )
            })
            .unwrap();
        let stale_update = title_update(
            &seeded.full_state,
            &seeded.state_vector,
            "Unsafe stale renderer title",
        );
        seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "semantic:title-barrier".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::ApplySemanticMutation {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        commands: vec![DocumentSemanticCommand::SetTitle {
                            inline_markdown: "Authoritative semantic title".to_owned(),
                            expected_etag: title_etag,
                        }],
                    },
                },
            )
            .unwrap();
        let request = apply_request("update:stale-across-barrier", 1, stale_update);
        let recovery = seeded
            .module
            .apply(&context(), request.clone())
            .expect_err("stale structural update requires recovery");
        assert_eq!(recovery.code, CoreErrorCode::RevisionConflict);
        assert!(recovery.message.contains("document-recovery:"));
        let repeated = seeded
            .module
            .apply(&context(), request.clone())
            .expect_err("recovery decision is durable");
        assert_eq!(repeated.message, recovery.message);
        let mut changed_request = request;
        let OwnedDocumentIntent::ApplyYjsUpdate { update, .. } = &mut changed_request.intent else {
            unreachable!()
        };
        update.push(0);
        let collision = seeded
            .module
            .apply(&context(), changed_request)
            .expect_err("recovery update identity is immutable");
        assert_eq!(collision.code, CoreErrorCode::IdempotencyKeyReused);
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let evidence: (i64, i64, i64, String) = connection.query_row(
                    "SELECT \
                       (SELECT head_seq FROM documents WHERE id = ?1), \
                       (SELECT count(*) FROM document_structural_barriers WHERE document_id = ?1), \
                       (SELECT count(*) FROM document_update_receipts \
                        WHERE update_id = 'update:stale-across-barrier'), \
                       (SELECT status FROM document_recovery_artifacts \
                        WHERE update_id = 'update:stale-across-barrier')",
                    [DOCUMENT_ID],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )?;
                assert_eq!(evidence, (2, 1, 0, "pending".to_owned()));
                Ok::<_, StoreError>(())
            })
            .unwrap();
    }

    #[test]
    fn semantic_title_and_body_guards_commit_atomically() {
        let seeded = seeded_module();
        let materialization = materialize_engine(
            &YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &seeded.full_state).unwrap(),
            BlockDocumentSchema::PageV2,
        )
        .unwrap();
        let (title_etag, body_etag) = seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let title = super::super::semantic::mint_etag(
                    connection,
                    "title",
                    PROJECT_ID,
                    STORE_EPOCH,
                    &[DOCUMENT_ID],
                    json!({ "richTitle": materialization.rich_title }),
                )
                .expect("title ETag");
                let body = super::super::semantic::mint_etag(
                    connection,
                    "document_body",
                    PROJECT_ID,
                    STORE_EPOCH,
                    &[DOCUMENT_ID],
                    json!({ "nfm": materialization.nfm }),
                )
                .expect("body ETag");
                Ok::<_, StoreError>((title, body))
            })
            .unwrap();
        let request = ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: "semantic:title-and-body".to_owned(),
            store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
            intent: OwnedDocumentIntent::ApplySemanticMutation {
                document_id: DOCUMENT_ID.to_owned(),
                generation: 1,
                expected_head_seq: 1,
                commands: vec![
                    DocumentSemanticCommand::SetTitle {
                        inline_markdown: "**Semantic** title".to_owned(),
                        expected_etag: title_etag.clone(),
                    },
                    DocumentSemanticCommand::ReplaceBody {
                        nested_markdown: "Semantic body".to_owned(),
                        expected_etag: body_etag,
                    },
                ],
            },
        };
        let committed = seeded
            .module
            .apply(&context(), request.clone())
            .expect("semantic mutation");
        assert_eq!(committed.committed.value.head_seq, 2);
        assert!(!committed.events.is_empty());
        seeded
            .kernel
            .readers()
            .read_default(|connection| {
                let (title, nfm, rich_title): (String, String, String) = connection.query_row(
                    "SELECT title, nfm, title_rich_json FROM document_materializations \
                     WHERE document_id = ?1",
                    [DOCUMENT_ID],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
                assert_eq!(title, "Semantic title");
                assert_eq!(nfm, "Semantic body");
                assert_eq!(
                    serde_json::from_str::<Value>(&rich_title).unwrap()[0]["styles"]["bold"],
                    true
                );
                Ok::<_, StoreError>(())
            })
            .unwrap();

        let duplicate = seeded.module.apply(&context(), request).unwrap();
        assert!(duplicate.committed.receipt.mutation.duplicate);
        assert!(duplicate.events.is_empty());
        let stale = seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "semantic:stale-title".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::ApplySemanticMutation {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 2,
                        commands: vec![DocumentSemanticCommand::SetTitle {
                            inline_markdown: "Stale overwrite".to_owned(),
                            expected_etag: title_etag,
                        }],
                    },
                },
            )
            .expect_err("stale narrow guard");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);

        let sync = seeded
            .module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: OwnedDocumentRead::SyncYjs {
                        document_id: DOCUMENT_ID.to_owned(),
                        state_vector: Vec::new(),
                    },
                },
            )
            .unwrap();
        let OwnedDocumentReadValue::YjsSync { update, .. } = sync.value else {
            panic!("expected Yjs sync")
        };
        let current = YrsDocumentEngine::from_full_state_v1(DOCUMENT_ID, &update).unwrap();
        let renderer_update = title_update(
            &current.full_state_v1(),
            &current.state_vector_v1(),
            "Concurrent renderer title",
        );
        seeded
            .module
            .apply(
                &context(),
                apply_request("update:concurrent-title", 2, renderer_update),
            )
            .unwrap();
        let merged = seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "semantic:exact-patch-after-renderer".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::ApplySemanticMutation {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 2,
                        commands: vec![DocumentSemanticCommand::PatchBody {
                            old_fragment: "Semantic body".to_owned(),
                            new_fragment: "Merged body".to_owned(),
                        }],
                    },
                },
            )
            .expect("exact patch rebases over unrelated renderer edit");
        assert_eq!(merged.committed.value.head_seq, 4);

        let structural = seeded
            .module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "semantic:stale-structural".to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: OwnedDocumentIntent::ApplySemanticMutation {
                        document_id: DOCUMENT_ID.to_owned(),
                        generation: 1,
                        expected_head_seq: 2,
                        commands: vec![DocumentSemanticCommand::DeleteBlock {
                            block_id: "019bf52d-6870-7000-8000-000000000099".to_owned(),
                        }],
                    },
                },
            )
            .expect_err("structural edits retain the exact-head barrier");
        assert_eq!(structural.code, CoreErrorCode::HeadConflict);
    }
}
