use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use nodex_core_contracts::document::{
    DocumentCommitOutcome, OwnedDocumentCommitValue, OwnedDocumentEvent, OwnedDocumentIntent,
    OwnedDocumentRead, OwnedDocumentReadValue, OwnedDocumentReceipt,
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

use super::persistence::{
    DocumentAuthorityRow, PersistYjsCommit, persist_yjs_commit, read_document_authority,
    read_event_head, read_store_epoch, sha256,
};
use super::runtime::DocumentRuntimeCache;
use super::{
    BlockDocumentSchema, DocumentMaterialization, YrsEngineError, decode_block_document,
    materialize_decoded_document,
};

const MODULE_NAME: &str = "owned_document";

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
    pub event: Option<CommittedCoreModuleEvent>,
}

#[derive(Clone)]
pub struct OwnedDocumentModule {
    profile_id: String,
    library_id: String,
    writer: StoreWriter,
    readers: StoreReaders,
    cache: Arc<Mutex<DocumentRuntimeCache>>,
    fail_after_commit: Arc<AtomicBool>,
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
                        store_epoch: StoreEpoch(store_epoch),
                        event_head: read_event_head(connection)?,
                        value: OwnedDocumentReadValue::Descriptor {
                            descriptor: authority_descriptor(&authority),
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
                        Ok(ModuleReadSnapshot {
                            version: CORE_CONTRACT_VERSION,
                            store_epoch: StoreEpoch(read_store_epoch(connection)?),
                            event_head: read_event_head(connection)?,
                            value: OwnedDocumentReadValue::YjsSync {
                                descriptor: authority_descriptor(&authority),
                                update,
                            },
                        })
                    })
                    .map_err(core_error)
            }
            OwnedDocumentRead::SyncCanvas { .. }
            | OwnedDocumentRead::ListVersions { .. }
            | OwnedDocumentRead::GetVersion { .. } => {
                Err(invalid("Owned Document read is not implemented yet"))
            }
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
            _ => Err(invalid("Owned Document intent is not implemented yet")),
        }
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
        let context = context.clone();
        let cache = Arc::clone(&self.cache);
        let fail_after_commit = Arc::clone(&self.fail_after_commit);
        self.writer
            .call(move |connection| {
                let transaction =
                    connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let store_epoch = read_store_epoch(&transaction)?;
                if store_epoch != expected_store_epoch.0 {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Owned Document mutation targets a stale store epoch",
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
                        event: None,
                    });
                }
                let authority = read_document_authority(&transaction, &document_id)?
                    .ok_or_else(|| not_found("Owned Document was not found"))?;
                authorize_yjs(&context, &authority)?;
                if authority.head.generation != generation {
                    return Err(StoreError::new(
                        StoreErrorCode::GenerationConflict,
                        "Owned Document generation does not match",
                        false,
                    ));
                }
                if base_head_seq > authority.head.head_seq {
                    return Err(StoreError::new(
                        StoreErrorCode::HeadConflict,
                        "Yjs update is based on a future Document head",
                        true,
                    ));
                }
                let receipt_conflicts =
                    crate::infrastructure::document_repository::DocumentReadRepository::new(
                        &transaction,
                    )
                    .update_receipt(&document_id, &update_id)?
                    .is_some_and(|receipt| {
                        receipt.generation != generation
                            || receipt.client_session_id != context.connection_id
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
                let candidate = engine.prepare_update_v1(&update).map_err(engine_error)?;
                let materialization = materialize_candidate(&candidate, schema)?;
                let did_change = candidate.did_change();
                let event_head = read_event_head(&transaction)?;
                if !did_change {
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
                        "apply_yjs_update",
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
                        event: None,
                    });
                }
                let candidate_transaction = candidate.document().transact();
                let state_vector = candidate_transaction.state_vector().encode_v1();
                let full_state =
                    candidate_transaction.encode_state_as_update_v1(&yrs::StateVector::default());
                drop(candidate_transaction);
                let persisted = persist_yjs_commit(
                    &transaction,
                    PersistYjsCommit {
                        authority: &authority,
                        base_materialization: &base_materialization,
                        materialization: &materialization,
                        update_id: &update_id,
                        client_session_id: &context.connection_id,
                        base_head_seq,
                        client_touched_block_ids: &touched_block_ids,
                        update: &update,
                        state_vector: &state_vector,
                        full_state: &full_state,
                        store_epoch: &store_epoch,
                        operation_id: &operation_id,
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
                insert_typed_receipt(
                    &transaction,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    "apply_yjs_update",
                    &committed,
                    Some(persisted.event_sequence),
                )?;
                transaction.commit()?;
                if fail_after_commit.swap(false, Ordering::AcqRel) {
                    cache
                        .lock()
                        .map_err(|_| internal("Document cache lock failed"))?
                        .invalidate(&document_id);
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
                let event = CommittedCoreModuleEvent {
                    version: CORE_CONTRACT_VERSION,
                    sequence: persisted.event_sequence,
                    store_epoch: StoreEpoch(store_epoch.clone()),
                    operation_id: Some(operation_id),
                    committed_at: persisted.committed_at,
                    payload: CoreModuleEventPayload::OwnedDocument(
                        OwnedDocumentEvent::DocumentUpdated {
                            document_id,
                            generation,
                            head_seq: persisted.head_seq,
                            update,
                        },
                    ),
                };
                Ok(OwnedDocumentApplyOutcome {
                    committed,
                    event: Some(event),
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

fn authority_descriptor(authority: &DocumentAuthorityRow) -> Value {
    json!({
        "documentId": authority.head.id,
        "projectId": authority.head.project_id,
        "ownerBlockId": authority.owner_block_id,
        "ownerType": authority.owner_type,
        "ownerLifecycle": authority.owner_lifecycle,
        "generation": authority.head.generation,
        "headSeq": authority.head.head_seq,
        "schemaKey": authority.head.schema_key,
        "schemaVersion": authority.head.schema_version,
        "stateVector": authority.head.state_vector,
        "syncEngine": "yjs",
        "readiness": "ready",
        "authority": "ydoc_primary",
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
    Ok(())
}

fn validate_touched_block_ids(ids: &[String]) -> Result<(), CoreError> {
    if ids.len() > 100_000 {
        return Err(invalid("Touched Block ID list exceeds its bound"));
    }
    let mut sorted = ids.to_vec();
    sorted.sort();
    sorted.dedup();
    if sorted.len() != ids.len()
        || ids
            .iter()
            .any(|id| id.is_empty() || id.len() > 512 || id.trim() != id)
    {
        return Err(invalid(
            "Touched Block IDs must be unique canonical identities",
        ));
    }
    Ok(())
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
        DocumentCommitOutcome, OwnedDocumentIntent, OwnedDocumentRead,
    };
    use nodex_core_contracts::{
        AdapterKind, LibraryId, ModuleApplyRequest, ModuleReadRequest, ProfileId, ProjectId,
    };
    use rusqlite::params;
    use tempfile::tempdir;

    use crate::document::{
        BlockDocumentSchema, DocumentBlockOperation, YrsDocumentEngine,
        prepare_document_operation_update,
    };
    use crate::infrastructure::sqlite::{StoreError, with_immediate_transaction};

    use super::*;

    const PROFILE_ID: &str = "profile:test";
    const LIBRARY_ID: &str = "library:test";
    const PROJECT_ID: &str = "project:test";
    const DOCUMENT_ID: &str = "document:test-page";
    const OWNER_BLOCK_ID: &str = "019bf52d-6870-7000-8000-000000000001";
    const STORE_EPOCH: &str = "epoch:test";
    const NOW: &str = "2026-07-18T00:00:00.000Z";

    struct SeededModule {
        _directory: tempfile::TempDir,
        kernel: SqliteStoreKernel,
        module: OwnedDocumentModule,
        full_state: Vec<u8>,
        state_vector: Vec<u8>,
    }

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId(PROFILE_ID.to_owned()),
            library_id: LibraryId(LIBRARY_ID.to_owned()),
            project_id: Some(ProjectId(PROJECT_ID.to_owned())),
            connection_id: "renderer-session:test".to_owned(),
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
        assert!(applied.event.is_some());
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
        assert!(duplicate.event.is_none());
        assert_eq!(
            duplicate.committed.event_sequence,
            applied.committed.event_sequence
        );
        assert!(seeded.module.cache_metrics().expect("cache metrics").hits > 0);
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
        assert!(recovered.event.is_none());
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
}
