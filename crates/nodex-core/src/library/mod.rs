use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use nodex_core_contracts::library::{
    LibraryCommitValue, LibraryEvent, LibraryEventKind, LibraryIntent, LibraryRead,
    LibraryReadValue, LibraryReceipt, LibraryResourceTarget,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_EVENT_VERSION, CommittedCoreModuleEvent, CoreError, CoreErrorCode,
    CoreErrorRecovery, CoreModuleEventPayload, LIBRARY_CONTRACT_VERSION, ModuleApplyRequest,
    ModuleMutationReceipt, ModuleReadRequest, ModuleReadSnapshot, ProjectionImpact, StoreEpoch,
};
use rusqlite::OptionalExtension;

use crate::infrastructure::agent_operations::PreparedAgentOperationRegistry;
use crate::infrastructure::module_receipts::DurableModuleContext;
use crate::infrastructure::projection_impact::impact_for_payload;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

mod page_projection;
mod projection_authorization;
mod read_authorization;
mod resource_access;
mod search_snapshot;

fn require_trusted_library_authority(context: &BoundModuleContext) -> Result<(), StoreError> {
    if context.project_id.is_none()
        && matches!(
            context.adapter,
            nodex_core_contracts::AdapterKind::ElectronHost
                | nodex_core_contracts::AdapterKind::NativeCli
                | nodex_core_contracts::AdapterKind::Test
        )
    {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::Unauthorized,
        "Project access can only be managed from trusted Library authority",
        false,
    ))
}

#[derive(Clone, Debug)]
pub struct LibraryApplyOutcome {
    pub committed: crate::ModuleWriterResult<LibraryCommitValue, LibraryReceipt>,
    pub event: Option<CommittedCoreModuleEvent>,
}

#[derive(Clone)]
pub struct LibrarySearchSnapshotLeaseRegistry {
    store: Arc<Mutex<search_snapshot::SearchSnapshotStore>>,
}

impl LibrarySearchSnapshotLeaseRegistry {
    fn new(store: search_snapshot::SearchSnapshotStore) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
        }
    }

    pub fn invalidate_all(&self) -> Result<(), StoreError> {
        self.store
            .lock()
            .map_err(|_| {
                StoreError::new(
                    StoreErrorCode::Internal,
                    "Search snapshot storage lock is unavailable",
                    false,
                )
            })?
            .invalidate_all()
    }

    #[cfg(test)]
    fn invalidate_prepared(&self) {
        self.store
            .lock()
            .expect("Search snapshot storage lock")
            .invalidate_prepared();
    }
}

#[derive(Clone)]
struct AppliedOperation {
    fingerprint: Vec<u8>,
    committed: crate::ModuleWriterResult<LibraryCommitValue, LibraryReceipt>,
}

#[derive(Default)]
struct LibraryState {
    commit_head: i64,
    operations: HashMap<String, AppliedOperation>,
    grants: BTreeMap<(String, String), String>,
}

pub struct LibraryModule {
    profile_id: String,
    library_id: String,
    store_epoch: StoreEpoch,
    state: Mutex<LibraryState>,
    readers: Option<StoreReaders>,
    writer: Option<StoreWriter>,
    assets_root: Option<PathBuf>,
    search_snapshots: Option<LibrarySearchSnapshotLeaseRegistry>,
    prepared_agent_operations: PreparedAgentOperationRegistry,
    document_runtime_cache: Option<Arc<Mutex<crate::document::DocumentRuntimeCache>>>,
}

impl LibraryModule {
    pub fn tracer(profile_id: String, library_id: String, store_epoch: StoreEpoch) -> Self {
        Self {
            profile_id,
            library_id,
            store_epoch,
            state: Mutex::new(LibraryState::default()),
            readers: None,
            writer: None,
            assets_root: None,
            search_snapshots: None,
            prepared_agent_operations: PreparedAgentOperationRegistry::new(),
            document_runtime_cache: None,
        }
    }

    pub fn new(
        profile_id: impl Into<String>,
        library_id: impl Into<String>,
        kernel: &SqliteStoreKernel,
    ) -> Self {
        let profile_home = kernel
            .database_path()
            .parent()
            .expect("Profile database has a parent");
        let mut search_snapshots = search_snapshot::SearchSnapshotStore::new(profile_home);
        if let Err(error) = search_snapshots.cleanup_startup() {
            tracing::warn!(
                subsystem = "library_search_snapshot",
                error = %error,
                "Search snapshot startup cleanup will be retried on acquisition"
            );
        }
        Self {
            profile_id: profile_id.into(),
            library_id: library_id.into(),
            store_epoch: StoreEpoch(String::new()),
            state: Mutex::new(LibraryState::default()),
            readers: Some(kernel.readers()),
            writer: Some(kernel.writer()),
            assets_root: Some(profile_home.join("assets")),
            search_snapshots: Some(LibrarySearchSnapshotLeaseRegistry::new(search_snapshots)),
            prepared_agent_operations: PreparedAgentOperationRegistry::new(),
            document_runtime_cache: Some(kernel.document_runtime_cache()),
        }
    }

    pub fn block_transfer_metrics(&self) -> BlockTransferMetrics {
        block_transfer::metric_snapshot()
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<LibraryRead>,
    ) -> Result<ModuleReadSnapshot<LibraryReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.contract_version != LIBRARY_CONTRACT_VERSION {
            return Err(invalid_input("unsupported Library contract version"));
        }

        if let LibraryRead::AcquireSearchSnapshot {
            scope,
            strict_materialization,
        } = &request.read
        {
            let readers = self.readers.as_ref().ok_or_else(|| {
                invalid_input("the Library tracer cannot create search snapshots")
            })?;
            let library_id = self.library_id.clone();
            let context = context.clone();
            let scope = scope.clone();
            let strict_materialization = *strict_materialization;
            let (current_store_epoch, current_commit_seq) = readers
                .read_default(|connection| {
                    let transaction = connection.unchecked_transaction()?;
                    let store_epoch = crate::document::read_store_epoch(&transaction)?;
                    let commit_seq = navigation::commit_head(&transaction)?;
                    transaction.commit()?;
                    Ok((store_epoch, commit_seq))
                })
                .map_err(core_error)?;
            let current_cache_key = search_snapshot::cache_key(
                &context,
                &current_store_epoch,
                current_commit_seq,
                scope.clone(),
                strict_materialization,
            )
            .map_err(core_error)?;
            if let Some(value) = self
                .search_snapshots
                .as_ref()
                .expect("persistent Library has search snapshot storage")
                .store
                .lock()
                .map_err(|_| invalid_input("Search snapshot storage lock is unavailable"))?
                .acquire_cached(&current_cache_key)
                .map_err(core_error)?
            {
                return Ok(ModuleReadSnapshot {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    store_epoch: StoreEpoch(current_store_epoch),
                    commit_head: current_commit_seq,
                    authorization: None,
                    value: LibraryReadValue::SearchSnapshotLease {
                        value: Box::new(value),
                    },
                });
            }
            let prepare_context = context.clone();
            let prepare_scope = scope.clone();
            let (store_epoch, commit_seq, prepared) = readers
                .read_default(move |connection| {
                    let transaction = connection.unchecked_transaction()?;
                    let store_epoch = crate::document::read_store_epoch(&transaction)?;
                    let commit_seq = navigation::commit_head(&transaction)?;
                    let prepared = search_snapshot::prepare(
                        &transaction,
                        &library_id,
                        &store_epoch,
                        commit_seq,
                        &prepare_context,
                        prepare_scope,
                        strict_materialization,
                    )?;
                    transaction.commit()?;
                    Ok((store_epoch, commit_seq, prepared))
                })
                .map_err(core_error)?;
            let cache_key = search_snapshot::cache_key(
                &context,
                &store_epoch,
                commit_seq,
                scope,
                strict_materialization,
            )
            .map_err(core_error)?;
            let value = self
                .search_snapshots
                .as_ref()
                .expect("persistent Library has search snapshot storage")
                .store
                .lock()
                .map_err(|_| invalid_input("Search snapshot storage lock is unavailable"))?
                .acquire(prepared, cache_key)
                .map_err(core_error)?;
            return Ok(ModuleReadSnapshot {
                contract_version: LIBRARY_CONTRACT_VERSION,
                store_epoch: StoreEpoch(store_epoch),
                commit_head: commit_seq,
                authorization: None,
                value: LibraryReadValue::SearchSnapshotLease {
                    value: Box::new(value),
                },
            });
        }

        if let LibraryRead::ReleaseSearchSnapshot { lease_id } = &request.read {
            let readers = self.readers.as_ref().ok_or_else(|| {
                invalid_input("the Library tracer cannot release search snapshots")
            })?;
            let (store_epoch, commit_seq) = readers
                .read_default(|connection| {
                    let transaction = connection.unchecked_transaction()?;
                    let store_epoch = crate::document::read_store_epoch(&transaction)?;
                    let commit_seq = navigation::commit_head(&transaction)?;
                    transaction.commit()?;
                    Ok((store_epoch, commit_seq))
                })
                .map_err(core_error)?;
            let value = self
                .search_snapshots
                .as_ref()
                .expect("persistent Library has search snapshot storage")
                .store
                .lock()
                .map_err(|_| invalid_input("Search snapshot storage lock is unavailable"))?
                .release(lease_id)
                .map_err(core_error)?;
            return Ok(ModuleReadSnapshot {
                contract_version: LIBRARY_CONTRACT_VERSION,
                store_epoch: StoreEpoch(store_epoch),
                commit_head: commit_seq,
                authorization: None,
                value: LibraryReadValue::SearchSnapshotRelease { value },
            });
        }

        if let LibraryRead::PrepareAgentPageCopy {
            operation_id,
            store_epoch,
            authorization,
            request: copy_request,
        } = &request.read
        {
            let readers = self
                .readers
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot prepare Agent writes"))?;
            return agent_page_write::prepare_page_copy(
                readers,
                &self.prepared_agent_operations,
                context,
                &self.library_id,
                agent_page_write::PreparePageCopyInput {
                    operation_id: operation_id.clone(),
                    expected_store_epoch: store_epoch.clone(),
                    authorization: (**authorization).clone(),
                    request: (**copy_request).clone(),
                },
            )
            .map_err(core_error);
        }

        if let LibraryRead::PrepareAgentCreatePages {
            operation_id,
            store_epoch,
            authorization,
            request: create_request,
        } = &request.read
        {
            let readers = self
                .readers
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot prepare Agent writes"))?;
            let cache = self
                .document_runtime_cache
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer has no Document runtime cache"))?;
            return agent_page_create::prepare_create_pages(
                readers,
                cache,
                &self.prepared_agent_operations,
                context,
                &self.library_id,
                agent_page_create::PrepareCreatePagesInput {
                    operation_id: operation_id.clone(),
                    expected_store_epoch: store_epoch.clone(),
                    authorization: (**authorization).clone(),
                    request: (**create_request).clone(),
                },
            )
            .map_err(core_error);
        }

        if let LibraryRead::PrepareAgentMovePages {
            operation_id,
            store_epoch,
            authorization,
            request: move_request,
        } = &request.read
        {
            let readers = self
                .readers
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot prepare Agent writes"))?;
            let cache = self
                .document_runtime_cache
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer has no Document runtime cache"))?;
            return agent_page_move::prepare_move_pages(
                readers,
                cache,
                &self.prepared_agent_operations,
                context,
                &self.library_id,
                agent_page_move::PrepareMovePagesInput {
                    operation_id: operation_id.clone(),
                    expected_store_epoch: store_epoch.clone(),
                    authorization: (**authorization).clone(),
                    request: (**move_request).clone(),
                },
            )
            .map_err(core_error);
        }

        if let Some(readers) = &self.readers {
            let profile_id = self.profile_id.clone();
            let library_id = self.library_id.clone();
            let context = context.clone();
            return readers
                .read_default(move |connection| {
                    let transaction = connection.unchecked_transaction()?;
                    let store_epoch = transaction
                        .query_row(
                            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                            [],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()?
                        .ok_or_else(|| {
                            StoreError::new(
                                StoreErrorCode::StoreCorrupt,
                                "Block store epoch is unavailable",
                                false,
                            )
                        })?;
                    let commit_seq = navigation::commit_head(&transaction)?;
                    let read = request.read;
                    let stamp_read = read.clone();
                    let value = match read {
                        LibraryRead::Metadata => LibraryReadValue::Metadata {
                            profile_id,
                            library_id,
                            commit_seq,
                        },
                        LibraryRead::ResourceProjectAccess { target } => {
                            LibraryReadValue::ResourceProjectAccess {
                                value: Box::new(resource_access::read(
                                    &transaction,
                                    &library_id,
                                    &context,
                                    target,
                                )?),
                            }
                        }
                        LibraryRead::FilterProjectionImpactForProject { project_id, impact } => {
                            LibraryReadValue::ProjectionImpact {
                                impact: projection_authorization::filter_for_project(
                                    &transaction,
                                    &library_id,
                                    &context,
                                    &project_id,
                                    impact,
                                )?,
                            }
                        }
                        LibraryRead::PageLifecyclePreflight { page_id } => {
                            LibraryReadValue::PageLifecyclePreflight {
                                value: Box::new(page_lifecycle::read_preflight(
                                    &transaction,
                                    &library_id,
                                    &context,
                                    &page_id,
                                )?),
                            }
                        }
                        LibraryRead::PlanAgentResourceAccess {
                            provenance,
                            call_id,
                            intents,
                            task_access,
                        } => LibraryReadValue::AgentResourceAccessPlan {
                            value: Box::new(agent_authorization::plan(
                                &transaction,
                                &context,
                                &library_id,
                                &provenance,
                                &call_id,
                                &intents,
                                task_access.as_deref(),
                            )?),
                        },
                        read => navigation::read(
                            &transaction,
                            &library_id,
                            &store_epoch,
                            commit_seq,
                            &context,
                            read,
                        )?,
                    };
                    let authorization = read_authorization::issue(
                        &transaction,
                        &context,
                        &store_epoch,
                        commit_seq,
                        &stamp_read,
                        &value,
                    )?;
                    transaction.commit()?;
                    Ok(ModuleReadSnapshot {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        store_epoch: StoreEpoch(store_epoch),
                        commit_head: commit_seq,
                        authorization,
                        value,
                    })
                })
                .map_err(core_error);
        }

        let state = self.state.lock().expect("Library tracer mutex poisoned");
        let value = match request.read {
            LibraryRead::Metadata => LibraryReadValue::Metadata {
                profile_id: self.profile_id.clone(),
                library_id: self.library_id.clone(),
                commit_seq: state.commit_head,
            },
            _ => {
                return Err(invalid_input(
                    "the Milestone 1 tracer supports metadata reads only",
                ));
            }
        };

        Ok(ModuleReadSnapshot {
            contract_version: LIBRARY_CONTRACT_VERSION,
            store_epoch: self.store_epoch.clone(),
            commit_head: state.commit_head,
            authorization: None,
            value,
        })
    }

    pub fn apply(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<LibraryIntent>,
    ) -> Result<LibraryApplyOutcome, CoreError> {
        self.validate_context(context)?;
        if request.contract_version != LIBRARY_CONTRACT_VERSION {
            return Err(invalid_input("unsupported Library contract version"));
        }
        if let LibraryIntent::ExecutePreparedAgentPageCopy {
            authorization,
            request: copy_request,
        } = request.intent.clone()
        {
            let writer = self
                .writer
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot execute Agent writes"))?;
            return agent_page_write::execute_page_copy(
                writer,
                &self.prepared_agent_operations,
                &self.profile_id,
                &self.library_id,
                context,
                request,
                *authorization,
                *copy_request,
                self.assets_root
                    .as_ref()
                    .expect("persistent Library has an assets root"),
            )
            .map_err(core_error);
        }
        if let LibraryIntent::ExecutePreparedAgentCreatePages {
            authorization,
            request: create_request,
        } = request.intent.clone()
        {
            let writer = self
                .writer
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot execute Agent writes"))?;
            let readers = self
                .readers
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot prepare Agent writes"))?;
            let cache = self
                .document_runtime_cache
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer has no Document runtime cache"))?;
            return agent_page_create::execute_create_pages(
                writer,
                readers,
                cache,
                &self.prepared_agent_operations,
                &self.profile_id,
                &self.library_id,
                context,
                request,
                *authorization,
                *create_request,
            )
            .map_err(core_error);
        }
        if let LibraryIntent::ExecutePreparedAgentMovePages {
            authorization,
            request: move_request,
        } = request.intent.clone()
        {
            let writer = self
                .writer
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot execute Agent writes"))?;
            let readers = self
                .readers
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer cannot prepare Agent writes"))?;
            let cache = self
                .document_runtime_cache
                .as_ref()
                .ok_or_else(|| invalid_input("the Library tracer has no Document runtime cache"))?;
            return agent_page_move::execute_move_pages(
                writer,
                readers,
                cache,
                &self.prepared_agent_operations,
                &self.profile_id,
                &self.library_id,
                context,
                request,
                *authorization,
                *move_request,
                self.assets_root
                    .as_ref()
                    .expect("persistent Library has an assets root"),
            )
            .map_err(core_error);
        }
        if let Some(writer) = &self.writer {
            let prepared_transfer =
                if let LibraryIntent::TransferBlocks { intent } = &request.intent {
                    let readers = self.readers.as_ref().ok_or_else(|| {
                        invalid_input("the Library tracer cannot prepare Block transfers")
                    })?;
                    let cache = self.document_runtime_cache.as_ref().ok_or_else(|| {
                        invalid_input("the Library tracer has no Document runtime cache")
                    })?;
                    let context = context.clone();
                    let library_id = self.library_id.clone();
                    let operation_id = request.operation_id.clone();
                    let store_epoch = request.store_epoch.0.clone();
                    let intent = intent.clone();
                    let cache = Arc::clone(cache);
                    readers
                        .read_default(move |connection| {
                            let transaction = connection.unchecked_transaction()?;
                            if !block_transfer::requires_preparation(
                                &transaction,
                                &context,
                                &operation_id,
                                &store_epoch,
                                &intent,
                            )? {
                                transaction.commit()?;
                                return Ok(None);
                            }
                            let prepared = block_transfer::prepare_for_apply(
                                &transaction,
                                Some(&cache),
                                &context,
                                &library_id,
                                &operation_id,
                                &store_epoch,
                                &intent,
                            )?;
                            transaction.commit()?;
                            Ok(Some(prepared))
                        })
                        .map_err(core_error)?
                } else {
                    None
                };
            return mutation::apply(
                writer,
                &self.profile_id,
                &self.library_id,
                context,
                request,
                self.assets_root
                    .as_ref()
                    .expect("persistent Library has an assets root"),
                prepared_transfer,
            )
            .map_err(core_error);
        }
        if request.store_epoch != self.store_epoch {
            return Err(CoreError {
                code: CoreErrorCode::StaleStoreEpoch,
                message: "Library mutation targets a stale store generation".to_owned(),
                retryable: true,
                recovery: CoreErrorRecovery::CurrentStoreEpoch {
                    store_epoch: self.store_epoch.clone(),
                },
            });
        }

        let (project_id, target, access) = match &request.intent {
            LibraryIntent::GrantProjectAccess {
                project_id,
                target,
                access,
            } => (
                project_id.clone(),
                target.clone(),
                match access {
                    nodex_core_contracts::library::LibraryAccess::Read => "read".to_owned(),
                    nodex_core_contracts::library::LibraryAccess::ReadWrite => {
                        "read_write".to_owned()
                    }
                },
            ),
            _ => {
                return Err(invalid_input(
                    "the Milestone 1 tracer supports grant_project_access only",
                ));
            }
        };
        let fingerprint = serde_json::to_vec(&(
            DurableModuleContext::from(context),
            request.contract_version,
            &request.store_epoch,
            &request.intent,
        ))
        .map_err(|_| invalid_input("Library mutation cannot be fingerprinted"))?;
        let mut state = self.state.lock().expect("Library tracer mutex poisoned");

        if let Some(applied) = state.operations.get(&request.operation_id) {
            if applied.fingerprint != fingerprint {
                return Err(CoreError {
                    code: CoreErrorCode::IdempotencyKeyReused,
                    message: "operation_id was already used for a different Library intent"
                        .to_owned(),
                    retryable: false,
                    recovery: CoreErrorRecovery::None,
                });
            }
            let mut committed = applied.committed.clone();
            committed.receipt.mutation.duplicate = true;
            return Ok(LibraryApplyOutcome {
                committed,
                event: None,
            });
        }

        state.commit_head += 1;
        let event_sequence = state.commit_head;
        let resource_id = resource_id(&target);
        let previous_access = state
            .grants
            .insert((project_id, resource_id.clone()), access.clone());
        let did_mutate = previous_access.as_ref() != Some(&access);
        let (affected_page_ids, affected_database_ids) = match &target {
            LibraryResourceTarget::Page { page_id } => (vec![page_id.clone()], Vec::new()),
            LibraryResourceTarget::Database { database_id } => {
                (Vec::new(), vec![database_id.clone()])
            }
            LibraryResourceTarget::Canvas { .. } => (Vec::new(), Vec::new()),
        };
        let committed_at = unix_timestamp_millis();
        let receipt = LibraryReceipt {
            mutation: ModuleMutationReceipt {
                operation_id: request.operation_id.clone(),
                duplicate: false,
            },
            operation_kind: "grant_project_access".to_owned(),
            did_mutate,
            created_target: None,
            affected_parent_keys: Vec::new(),
            affected_page_ids: affected_page_ids.clone(),
            affected_database_ids: affected_database_ids.clone(),
            affected_view_ids: Vec::new(),
            committed_revisions: BTreeMap::new(),
            commit_seq: event_sequence,
            committed_at: committed_at.clone(),
        };
        let commit_seq = event_sequence;
        let committed = crate::ModuleWriterResult {
            value: LibraryCommitValue {
                affected_resource_ids: vec![resource_id],
                page_create: None,
                page_copy: None,
                canvas_mutation: None,
                block_transfer: None,
                page_lifecycle: None,
                block_property_mutation: None,
                agent_page_copy: None,
                agent_create_pages: None,
                agent_move_pages: None,
            },
            receipt,
            commit_seq,
            event_sequence,
            store_epoch: self.store_epoch.clone(),
        };
        let event_payload = CoreModuleEventPayload::Library(LibraryEvent {
            kind: LibraryEventKind::LibraryChanged,
            page_ids: affected_page_ids,
            database_ids: affected_database_ids,
            view_ids: Vec::new(),
            parent_keys: Vec::new(),
        });
        let projection_impact = match target {
            LibraryResourceTarget::Page { .. } => {
                impact_for_payload(&event_payload).map_err(core_error)?
            }
            // The in-memory adapter has no Database/Data Source/View catalog from
            // which to enumerate the complete projection closure. Broad invalidation
            // is the only truthful impact for this test authority.
            LibraryResourceTarget::Database { .. } => ProjectionImpact::All,
            LibraryResourceTarget::Canvas { .. } => ProjectionImpact::All,
        };
        let event = CommittedCoreModuleEvent {
            event_version: CORE_EVENT_VERSION,
            sequence: event_sequence,
            store_epoch: self.store_epoch.clone(),
            operation_id: Some(request.operation_id.clone()),
            committed_at,
            projection_impact,
            payload: event_payload,
        };
        state.operations.insert(
            request.operation_id,
            AppliedOperation {
                fingerprint,
                committed: committed.clone(),
            },
        );

        Ok(LibraryApplyOutcome {
            committed,
            event: Some(event),
        })
    }

    pub fn invalidate_prepared_agent_operations(&self) -> Result<(), CoreError> {
        self.prepared_agent_operations
            .invalidate_all()
            .map_err(core_error)
    }

    pub fn prepared_agent_operation_count(&self) -> Result<usize, CoreError> {
        self.prepared_agent_operations
            .active_count()
            .map_err(core_error)
    }

    pub fn prepared_agent_operation_registry(&self) -> PreparedAgentOperationRegistry {
        self.prepared_agent_operations.clone()
    }

    pub fn search_snapshot_lease_registry(&self) -> Option<LibrarySearchSnapshotLeaseRegistry> {
        self.search_snapshots.clone()
    }

    fn validate_context(&self, context: &BoundModuleContext) -> Result<(), CoreError> {
        if context.profile_id.0 == self.profile_id && context.library_id.0 == self.library_id {
            return Ok(());
        }
        Err(CoreError {
            code: CoreErrorCode::Unauthorized,
            message: "bound Adapter identity does not match this Library".to_owned(),
            retryable: false,
            recovery: CoreErrorRecovery::None,
        })
    }
}

impl Default for LibraryModule {
    fn default() -> Self {
        Self::tracer(
            "probe-profile".to_owned(),
            "probe-library".to_owned(),
            StoreEpoch("probe-epoch".to_owned()),
        )
    }
}

fn invalid_input(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::InvalidInput,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn core_error(error: StoreError) -> CoreError {
    let code = match error.code {
        StoreErrorCode::InvalidInput => CoreErrorCode::InvalidInput,
        StoreErrorCode::NotFound => CoreErrorCode::NotFound,
        StoreErrorCode::PatchNotFound => CoreErrorCode::PatchNotFound,
        StoreErrorCode::PatchAmbiguous => CoreErrorCode::PatchAmbiguous,
        StoreErrorCode::PatchOverlap => CoreErrorCode::PatchOverlap,
        StoreErrorCode::StaleStoreEpoch => CoreErrorCode::StaleStoreEpoch,
        StoreErrorCode::Conflict
        | StoreErrorCode::HeadConflict
        | StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::ProtectedOwnerDeletion => CoreErrorCode::ProtectedOwnerDeletion,
        StoreErrorCode::UnsupportedSchema => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        StoreErrorCode::MaintenanceInProgress => CoreErrorCode::MaintenanceInProgress,
        StoreErrorCode::ResourceExhausted => CoreErrorCode::ResourceExhausted,
        StoreErrorCode::Unauthorized => CoreErrorCode::Unauthorized,
        StoreErrorCode::WriterQueueFull
        | StoreErrorCode::WriterClosed
        | StoreErrorCode::ReaderPoolTimeout
        | StoreErrorCode::QueryCancelled
        | StoreErrorCode::SqliteBusy
        | StoreErrorCode::SqliteFailure
        | StoreErrorCode::Internal => CoreErrorCode::CoreUnavailable,
        StoreErrorCode::GenerationConflict => CoreErrorCode::GenerationConflict,
        StoreErrorCode::MissingDependencies => CoreErrorCode::DocumentUpdateMissingDependencies,
        StoreErrorCode::MaterializationStale => CoreErrorCode::MaterializationStale,
        StoreErrorCode::AlreadyOwned
        | StoreErrorCode::InvalidProfile
        | StoreErrorCode::RuntimeIncompatible => CoreErrorCode::SchemaUnsupported,
    };
    CoreError {
        code,
        message: error.message,
        retryable: error.retryable,
        recovery: CoreErrorRecovery::None,
    }
}

fn resource_id(target: &LibraryResourceTarget) -> String {
    match target {
        LibraryResourceTarget::Page { page_id } => page_id.clone(),
        LibraryResourceTarget::Database { database_id } => database_id.clone(),
        LibraryResourceTarget::Canvas { canvas_id } => canvas_id.clone(),
    }
}

fn unix_timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::agent::{
        AgentAuthorizationTarget, AgentExecutionAuthorization, AgentProjectResourceAccess,
        AgentProjectResourceAction, AgentResourceAccessPlan, AgentResourceGrantRoot,
        AgentResourceGrantSpec, AgentResourceIntent, AgentTurnProvenance,
    };
    use nodex_core_contracts::database::{
        DatabaseIntent, DatabasePagePropertyAddress, DatabasePropertyValueEdit,
        DatabasePropertyValueInput, DatabasePropertyValueMutation,
    };
    use nodex_core_contracts::document::{
        DocumentBlockOperation as ContractDocumentBlockOperation, DocumentBlockUpdatePatch,
        DocumentOptionalValue, OwnedDocumentIntent,
    };
    use nodex_core_contracts::library::{
        LibraryAccess, LibraryAgentSearchResult, LibraryAgentSearchScope, LibraryAgentSearchTarget,
        LibraryBlockLocation, LibraryBlockPropertyFieldMutation, LibraryBlockPropertyMutation,
        LibraryBlockPropertyMutationErrorCode, LibraryBlockPropertyMutationOutcome,
        LibraryBlockTransferLogicalIntent, LibraryBlockTransferMode, LibraryBlockTransferSource,
        LibraryBlockTransferTarget, LibraryDocumentHead, LibraryNavigationParent,
        LibraryPageFileKind, LibraryPageLifecycleMutation, LibraryPageLifecycleState,
        LibraryPageLifecycleTagOption, LibraryPagePrepareKind, LibraryPageWorkflowStatus,
        LibraryPageWriteDestination, LibraryProjectAccessChange, LibraryWriteParent,
    };
    use nodex_core_contracts::workspace::{
        PROJECT_WORKSPACE_CONTRACT_VERSION, ProjectWorkspaceIntent, ProjectWorkspaceThreadPatch,
        ProjectWorkspaceTurnAuthority, ProjectWorkspaceTurnAuthorityScope,
        ProjectWorkspaceTurnAuthoritySource,
    };
    use nodex_core_contracts::{
        AdapterKind, DATABASE_CONTRACT_VERSION, DeliveryAtomKind, LibraryId, LocalProjectionPatch,
        LocalProjectionScope, OWNED_DOCUMENT_CONTRACT_VERSION, ProfileId, ProjectId,
        RevokedResourceKind,
    };
    use rusqlite::params;
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use crate::database::DatabaseModule;
    use crate::document::OwnedDocumentModule;
    use crate::infrastructure::local_commit;
    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::infrastructure::store::SqliteStoreKernel;
    use crate::workspace::ProjectWorkspaceModule;

    use super::*;

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: None,
            connection_id: "connection-1".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn prepare_page_move_etag(
        module: &LibraryModule,
        context: &BoundModuleContext,
        page_id: &str,
    ) -> String {
        let prepared = module
            .read(
                context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: page_id.to_owned(),
                        file_kind: LibraryPageFileKind::MetaYaml,
                        prepare: Some(LibraryPagePrepareKind::PageMove { view_id: None }),
                    },
                },
            )
            .expect("prepare Page move");
        let LibraryReadValue::PageFile { value } = prepared.value else {
            panic!("Page move preparation")
        };
        value
            .validators
            .move_etag
            .expect("Page move preparation ETag")
    }

    fn request(operation_id: &str, page_id: &str) -> ModuleApplyRequest<LibraryIntent> {
        ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::GrantProjectAccess {
                project_id: "project-1".to_owned(),
                target: LibraryResourceTarget::Page {
                    page_id: page_id.to_owned(),
                },
                access: LibraryAccess::Read,
            },
        }
    }

    fn transfer_request(
        operation_id: &str,
        intent: LibraryBlockTransferLogicalIntent,
    ) -> ModuleApplyRequest<LibraryIntent> {
        ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::TransferBlocks { intent },
        }
    }

    #[test]
    fn tracer_replays_an_exact_retry_after_reconnecting() {
        let module = LibraryModule::tracer(
            "profile-1".to_owned(),
            "library-1".to_owned(),
            StoreEpoch("epoch-1".to_owned()),
        );

        let first = module.apply(&context(), request("operation-1", "page-1"));
        let mut reconnected = context();
        reconnected.connection_id = "connection-2".to_owned();
        let replay = module.apply(&reconnected, request("operation-1", "page-1"));

        let first = first.expect("first apply succeeds");
        let replay = replay.expect("exact retry succeeds");
        assert!(first.event.is_some());
        assert!(replay.event.is_none());
        assert!(!first.committed.receipt.mutation.duplicate);
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            first.committed.event_sequence,
            replay.committed.event_sequence
        );
    }

    #[test]
    fn tracer_rejects_same_operation_id_with_different_intent() {
        let module = LibraryModule::tracer(
            "profile-1".to_owned(),
            "library-1".to_owned(),
            StoreEpoch("epoch-1".to_owned()),
        );
        module
            .apply(&context(), request("operation-1", "page-1"))
            .expect("first apply succeeds");

        let error = module
            .apply(&context(), request("operation-1", "page-2"))
            .expect_err("different retry fails");

        assert_eq!(error.code, CoreErrorCode::IdempotencyKeyReused);
    }

    #[test]
    fn plans_and_persists_agent_project_resource_consent_from_exact_turn_authority() {
        const NOW: &str = "2026-07-20T09:20:00.000Z";
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
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
            .expect("seed authority identity");
        let context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project:default".to_owned())),
            connection_id: "connection:agent-resource".to_owned(),
            adapter: AdapterKind::Test,
        };
        let workspace = ProjectWorkspaceModule::new("profile-1", "library-1", &kernel)
            .expect("Workspace module");
        workspace.seed_rootless_default_project_for_test();
        workspace
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    operation_id: "agent-thread".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: ProjectWorkspaceIntent::UpsertThread {
                        thread_id: "thread:agent".to_owned(),
                        patch: Box::new(ProjectWorkspaceThreadPatch {
                            project_id: Some(Some("project:default".to_owned())),
                            thread_name: Some(Some("Agent".to_owned())),
                            created_at: Some(100),
                            updated_at: Some(100),
                            linked_at: Some(NOW.to_owned()),
                            ..ProjectWorkspaceThreadPatch::default()
                        }),
                    },
                },
            )
            .expect("persist Agent Thread");
        workspace
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    operation_id: "agent-turn-authority".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: ProjectWorkspaceIntent::FreezeTurnAuthority {
                        thread_id: "thread:agent".to_owned(),
                        turn_id: "turn:agent".to_owned(),
                        root_thread_id: "thread:agent".to_owned(),
                        actor_project_id: "project:default".to_owned(),
                        source: ProjectWorkspaceTurnAuthoritySource::ProjectTurn,
                        inherited_from: None,
                    },
                },
            )
            .expect("freeze Agent Turn authority");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        module
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "agent-target-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:agent-target".to_owned(),
                        document_id: "document:agent-target".to_owned(),
                        title: "Agent target".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create ungranted target Page");
        let provenance = AgentTurnProvenance {
            profile_id: "profile-1".to_owned(),
            authority: ProjectWorkspaceTurnAuthority {
                thread_id: "thread:agent".to_owned(),
                turn_id: "turn:agent".to_owned(),
                root_thread_id: "thread:agent".to_owned(),
                actor_project_id: "project:default".to_owned(),
                library_id: "library-1".to_owned(),
                store_epoch: "epoch-1".to_owned(),
                scope: ProjectWorkspaceTurnAuthorityScope::Project,
                source: ProjectWorkspaceTurnAuthoritySource::ProjectTurn,
            },
        };
        let plan_request = ModuleReadRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            read: LibraryRead::PlanAgentResourceAccess {
                provenance: Box::new(provenance.clone()),
                call_id: "call:agent".to_owned(),
                intents: vec![AgentResourceIntent {
                    target: AgentAuthorizationTarget::Page {
                        page_id: "page:agent-target".to_owned(),
                    },
                    action: AgentProjectResourceAction::Write,
                }],
                task_access: None,
            },
        };
        let LibraryReadValue::AgentResourceAccessPlan { value } = module
            .read(&context, plan_request.clone())
            .expect("plan Project resource consent")
            .value
        else {
            panic!("Agent resource plan");
        };
        let AgentResourceAccessPlan::ConsentRequired { requirements, .. } = *value else {
            panic!("missing resource requires consent");
        };
        assert_eq!(requirements.len(), 1);
        assert_eq!(
            requirements[0].grant,
            AgentResourceGrantSpec {
                root: AgentResourceGrantRoot::Page {
                    page_id: "page:agent-target".to_owned(),
                },
                access: AgentProjectResourceAccess::ReadWrite,
                library_actions: Vec::new(),
            }
        );

        let grant_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "agent-persist-grant".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::PersistAgentProjectResourceGrants {
                provenance: Box::new(provenance.clone()),
                grants: requirements
                    .into_iter()
                    .map(|requirement| requirement.grant)
                    .collect(),
            },
        };
        let committed = module
            .apply(&context, grant_request.clone())
            .expect("persist Project grant");
        let replay = module
            .apply(&context, grant_request)
            .expect("replay Project grant persistence");
        assert_eq!(
            committed.committed.receipt.operation_kind,
            "persist_agent_project_resource_grants"
        );
        assert!(replay.committed.receipt.mutation.duplicate);

        let LibraryReadValue::AgentResourceAccessPlan { value } = module
            .read(&context, plan_request)
            .expect("replan persisted Project grant")
            .value
        else {
            panic!("Agent resource plan");
        };
        assert!(matches!(*value, AgentResourceAccessPlan::Authorized { .. }));

        module
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "agent-target-child".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:agent-target-child".to_owned(),
                        document_id: "document:agent-target-child".to_owned(),
                        title: "Target child".to_owned(),
                        parent: LibraryWriteParent::Page {
                            page_id: "page:agent-target".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 1,
                            before: None,
                        },
                    },
                },
            )
            .expect("create recursively granted child Page");
        module
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "agent-foreign-target".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:foreign-target".to_owned(),
                        document_id: "document:foreign-target".to_owned(),
                        title: "Foreign target".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create ungranted search decoy");
        let authorization = AgentExecutionAuthorization {
            provenance: provenance.clone(),
            call_id: "call:search-first".to_owned(),
            resource_access: None,
        };
        let search = |authorization: AgentExecutionAuthorization, cursor: Option<String>| {
            module.read(
                &context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AgentSearch {
                        authorization: Box::new(authorization),
                        query: "target".to_owned(),
                        target: LibraryAgentSearchTarget::Pages,
                        scope: LibraryAgentSearchScope::Library,
                        block_types: None,
                        include_archived: false,
                        cursor,
                        limit: Some(1),
                    },
                },
            )
        };
        let first = search(authorization.clone(), None).expect("first Agent search page");
        let LibraryReadValue::AgentSearch {
            items: first_items,
            next_cursor: Some(search_cursor),
            has_more: true,
        } = first.value
        else {
            panic!("first Agent search page");
        };
        assert_eq!(first_items.len(), 1);
        assert!(matches!(
            &first_items[0],
            LibraryAgentSearchResult::Page { id, .. }
                if id == "page:agent-target"
        ));

        let second = search(
            AgentExecutionAuthorization {
                call_id: "call:search-next".to_owned(),
                ..authorization.clone()
            },
            Some(search_cursor.clone()),
        )
        .expect("continue Agent search with a new tool call");
        let LibraryReadValue::AgentSearch {
            items: second_items,
            next_cursor: None,
            has_more: false,
        } = second.value
        else {
            panic!("second Agent search page");
        };
        assert!(matches!(
            &second_items[0],
            LibraryAgentSearchResult::Page { id, .. }
                if id == "page:agent-target-child"
        ));

        let fuzzy = module
            .read(
                &context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AgentSearch {
                        authorization: Box::new(authorization.clone()),
                        query: "targat".to_owned(),
                        target: LibraryAgentSearchTarget::Pages,
                        scope: LibraryAgentSearchScope::Page {
                            page_id: "page:agent-target".to_owned(),
                        },
                        block_types: None,
                        include_archived: false,
                        cursor: None,
                        limit: Some(10),
                    },
                },
            )
            .expect("fuzzy Agent Page search");
        let LibraryReadValue::AgentSearch { items, .. } = fuzzy.value else {
            panic!("fuzzy Agent Page search");
        };
        assert!(matches!(
            &items[..],
            [LibraryAgentSearchResult::Page { id, matches, .. }]
                if id == "page:agent-target"
                    && matches.iter().any(|evidence| matches!(
                        evidence,
                        nodex_core_contracts::library::LibraryAgentPageSearchMatch::Title {
                            quality: nodex_core_contracts::library::LibraryAgentSearchMatchQuality::Fuzzy,
                            ..
                        }
                    ))
        ));

        let blocks = module
            .read(
                &context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AgentSearch {
                        authorization: Box::new(authorization.clone()),
                        query: "target".to_owned(),
                        target: LibraryAgentSearchTarget::Blocks,
                        scope: LibraryAgentSearchScope::Library,
                        block_types: None,
                        include_archived: false,
                        cursor: None,
                        limit: Some(10),
                    },
                },
            )
            .expect("Agent Block search");
        let LibraryReadValue::AgentSearch { items, .. } = blocks.value else {
            panic!("Agent Block search");
        };
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|item| matches!(
            item,
            LibraryAgentSearchResult::Block { owner_page_id, .. }
                if owner_page_id != "page:foreign-target"
        )));

        module
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "agent-search-stale-event".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:search-event".to_owned(),
                        document_id: "document:search-event".to_owned(),
                        title: "Search event".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("advance Library event head");
        let continued = search(authorization, Some(search_cursor))
            .expect("Agent search cursor survives concurrent Library writes");
        let LibraryReadValue::AgentSearch {
            items: continued_items,
            ..
        } = continued.value
        else {
            panic!("continued Agent search page");
        };
        assert!(matches!(
            &continued_items[0],
            LibraryAgentSearchResult::Page { id, .. }
                if id == "page:agent-target-child"
        ));
    }

    #[test]
    fn persistent_page_lifecycle_transitions_and_library_move_are_atomic_and_replayable() {
        const NOW: &str = "2026-07-20T06:40:00.000Z";
        const PAGE_A: &str = "page:lifecycle-a";
        const PAGE_B: &str = "page:lifecycle-b";
        let persistent_context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:page-lifecycle".to_owned(),
            adapter: AdapterKind::Test,
        };
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project-1', 'library-1', 'Lifecycle', ?1, ?1)",
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
            .expect("seed Library");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        for (page_id, document_id) in [
            (PAGE_A, "document:lifecycle-a"),
            (PAGE_B, "document:lifecycle-b"),
        ] {
            module
                .apply(
                    &persistent_context,
                    ModuleApplyRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        operation_id: format!("create:{page_id}"),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: page_id.to_owned(),
                            document_id: document_id.to_owned(),
                            title: page_id.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create Page");
        }

        let archive_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "lifecycle:archive-a".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::ApplyPageLifecycle {
                mutation: Box::new(LibraryPageLifecycleMutation::ArchivePage {
                    page_id: PAGE_A.to_owned(),
                    expected_metadata_revision: 1,
                }),
            },
        };
        let archived = module
            .apply(&persistent_context, archive_request.clone())
            .expect("archive Page");
        let archive_receipt = archived
            .committed
            .value
            .page_lifecycle
            .as_ref()
            .expect("Page lifecycle receipt");
        assert_eq!(
            archive_receipt.lifecycle,
            LibraryPageLifecycleState::Archived
        );
        assert_eq!(archive_receipt.metadata_revision, 2);
        assert!(archived.event.is_some());
        let replay = module
            .apply(&persistent_context, archive_request)
            .expect("replay archive");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert!(replay.event.is_none());

        let unarchived = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "lifecycle:unarchive-a".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::UnarchivePage {
                            page_id: PAGE_A.to_owned(),
                            expected_metadata_revision: 2,
                        }),
                    },
                },
            )
            .expect("unarchive Page");
        assert_eq!(
            unarchived
                .committed
                .value
                .page_lifecycle
                .expect("Page lifecycle receipt")
                .metadata_revision,
            3
        );

        let moved = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "lifecycle:move-b".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::MovePageInLibrary {
                            page_id: PAGE_B.to_owned(),
                            expected_parent_revision: 1,
                            before_block_id: Some(PAGE_A.to_owned()),
                        }),
                    },
                },
            )
            .expect("move Page in Library");
        assert_eq!(
            moved
                .committed
                .value
                .page_lifecycle
                .expect("Page lifecycle receipt")
                .parent_revision,
            2
        );
        kernel
            .writer()
            .call(|connection| {
                let revisions = connection.query_row(
                    "SELECT block.location_revision, page.parent_revision, \
                       projection.location_revision FROM blocks block \
                     JOIN pages page ON page.block_id = block.id \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = ?1",
                    [PAGE_B],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(revisions, (2, 2, 2));
                let order = connection
                    .prepare(
                        "SELECT block_id FROM library_block_placements \
                         WHERE library_id = 'library-1' ORDER BY rank_key, block_id",
                    )?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(order, vec![PAGE_B.to_owned(), PAGE_A.to_owned()]);
                Ok(())
            })
            .expect("Page lifecycle projections remain synchronized");

        let delete_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "lifecycle:delete-a".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::ApplyPageLifecycle {
                mutation: Box::new(LibraryPageLifecycleMutation::DeletePage {
                    page_id: PAGE_A.to_owned(),
                    expected_metadata_revision: 3,
                    expected_parent_revision: 1,
                    parent_document_head: None,
                }),
            },
        };
        let deleted = module
            .apply(&persistent_context, delete_request.clone())
            .expect("delete Page");
        let delete_receipt = deleted
            .committed
            .value
            .page_lifecycle
            .expect("Page delete receipt");
        assert_eq!(delete_receipt.lifecycle, LibraryPageLifecycleState::Deleted);
        assert_eq!(delete_receipt.metadata_revision, 4);
        assert_eq!(delete_receipt.parent_revision, 2);
        assert!(
            delete_receipt
                .delete_evidence
                .as_ref()
                .is_some_and(|evidence| !evidence.tombstoned_blocks.is_empty())
        );
        let restored = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "lifecycle:restore-a".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::RestorePage {
                            page_id: PAGE_A.to_owned(),
                            delete_operation_id: "lifecycle:delete-a".to_owned(),
                            expected_metadata_revision: 4,
                            expected_parent_revision: 2,
                            parent_document_head: None,
                            membership: None,
                            before_block_id: Some(PAGE_B.to_owned()),
                        }),
                    },
                },
            )
            .expect("restore Page");
        let restore_receipt = restored
            .committed
            .value
            .page_lifecycle
            .expect("Page restore receipt");
        assert_eq!(restore_receipt.lifecycle, LibraryPageLifecycleState::Active);
        assert_eq!(restore_receipt.metadata_revision, 5);
        assert_eq!(restore_receipt.parent_revision, 3);
        assert!(restore_receipt.library_rank_key.is_some());
        let replayed_delete = module
            .apply(&persistent_context, delete_request)
            .expect("delete receipt replays after restore");
        assert!(replayed_delete.committed.receipt.mutation.duplicate);
        assert_eq!(
            replayed_delete
                .committed
                .value
                .page_lifecycle
                .expect("replayed delete receipt")
                .lifecycle,
            LibraryPageLifecycleState::Deleted
        );
        kernel
            .writer()
            .call(|connection| {
                let non_active = connection.query_row(
                    "SELECT count(*) FROM document_block_index index_row \
                     JOIN blocks block ON block.id = index_row.block_id \
                     WHERE index_row.document_id = 'document:lifecycle-a' \
                       AND block.lifecycle <> 'active'",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(non_active, 0);
                Ok(())
            })
            .expect("restore revives the indexed Page closure");

        let stale = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "lifecycle:stale".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::ArchivePage {
                            page_id: PAGE_B.to_owned(),
                            expected_metadata_revision: 99,
                        }),
                    },
                },
            )
            .expect_err("stale lifecycle write");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);
    }

    #[test]
    fn persistent_page_lifecycle_create_commits_document_database_and_projection_authority_once() {
        const NOW: &str = "2026-07-20T08:10:00.000Z";
        const DATABASE: &str = "019b1000-0000-7000-8000-000000000001";
        const SOURCE: &str = "019b1000-0000-7000-8000-000000000002";
        const VIEW: &str = "019b1000-0000-7000-8000-000000000003";
        const PAGE: &str = "019b1000-0000-7000-8000-000000000004";
        let persistent_context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:page-lifecycle-create".to_owned(),
            adapter: AdapterKind::Test,
        };
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project-1', 'library-1', 'Lifecycle create', ?1, ?1)",
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
            .expect("seed Library");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "create:default-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: DATABASE.to_owned(),
                        data_source_id: SOURCE.to_owned(),
                        view_id: VIEW.to_owned(),
                        name: "Tasks".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create default Database");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                    [DATABASE],
                )?;
                connection.execute(
                    "UPDATE data_source_properties SET lifecycle = 'deleted' \
                     WHERE data_source_id = ?1 AND id IN ('due_date', 'assignee')",
                    [SOURCE],
                )?;
                Ok(())
            })
            .expect("bind default Database");
        let create_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "lifecycle:create-page".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::ApplyPageLifecycle {
                mutation: Box::new(LibraryPageLifecycleMutation::CreatePage {
                    page_id: PAGE.to_owned(),
                    title: "Native lifecycle".to_owned(),
                    rich_title: None,
                    nfm: "Native body".to_owned(),
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
                    data_source_id: SOURCE.to_owned(),
                    tag_option_ids: vec!["tag:native".to_owned()],
                    new_tag_options: vec![LibraryPageLifecycleTagOption {
                        option_id: "tag:native".to_owned(),
                        name: "Native".to_owned(),
                    }],
                    expected_tags_property_revision: 1,
                }),
            },
        };
        let created = module
            .apply(&persistent_context, create_request.clone())
            .expect("create Data Source Page");
        let receipt = created
            .committed
            .value
            .page_lifecycle
            .as_ref()
            .expect("Page create receipt");
        assert_eq!(receipt.page_id, PAGE);
        assert_eq!(receipt.database_id.as_deref(), Some(DATABASE));
        assert_eq!(receipt.data_source_id.as_deref(), Some(SOURCE));
        assert_eq!(receipt.view_id.as_deref(), Some(VIEW));
        assert!(!receipt.created_block_ids.is_empty());
        assert_eq!(receipt.created_tag_option_ids, vec!["tag:native"]);
        let replay = module
            .apply(&persistent_context, create_request)
            .expect("replay Page create");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert!(replay.event.is_none());
        let LibraryReadValue::PageContent { value } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageContent {
                        page_id: PAGE.to_owned(),
                    },
                },
            )
            .expect("read created Page content")
            .value
        else {
            panic!("Page content");
        };
        assert_eq!(value.title, "Native lifecycle");
        assert_eq!(value.body_nfm, "Native body");
        let LibraryReadValue::PageFile { value: body_file } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: PAGE.to_owned(),
                        file_kind: LibraryPageFileKind::BodyNestedMarkdown,
                        prepare: None,
                    },
                },
            )
            .expect("read canonical Page body file")
            .value
        else {
            panic!("Page body file");
        };
        assert_eq!(body_file.content, "Native body\n");
        assert!(body_file.metadata.is_none());
        assert_eq!(body_file.validators.title_etag, None);
        assert_eq!(body_file.validators.body_etag, None);
        assert_eq!(body_file.validators.page_etag, None);

        let LibraryReadValue::PageFile { value: meta_file } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: PAGE.to_owned(),
                        file_kind: LibraryPageFileKind::MetaYaml,
                        prepare: Some(LibraryPagePrepareKind::TitleSet),
                    },
                },
            )
            .expect("read canonical Page metadata file")
            .value
        else {
            panic!("Page metadata file");
        };
        let metadata = meta_file.metadata.expect("typed Page metadata");
        assert_eq!(metadata.title_markdown, "Native lifecycle");
        assert!(metadata.schedule.is_none());
        assert!(metadata.properties.iter().any(|property| {
            property.property_id == "status"
                && matches!(
                    &property.value,
                    nodex_core_contracts::library::ProjectedPropertyValueV1::Identity(value)
                        if value.id == "triage" && value.name == "Triage"
                )
        }));
        assert!(
            !metadata.properties.iter().any(|property| {
                matches!(property.property_id.as_str(), "due_date" | "assignee")
            })
        );
        assert!(meta_file.content.starts_with(&format!(
            "id: \"{PAGE}\"\ntitle: \"Native lifecycle\"\nproperties:\n"
        )));
        assert!(meta_file.content.ends_with("schedule: null\n"));
        assert!(meta_file.validators.title_etag.is_some());
        assert_eq!(meta_file.validators.body_etag, None);
        assert_eq!(meta_file.validators.page_etag, None);

        let invalid_prepare = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: PAGE.to_owned(),
                        file_kind: LibraryPageFileKind::BodyNestedMarkdown,
                        prepare: Some(LibraryPagePrepareKind::TitleSet),
                    },
                },
            )
            .expect_err("title validator must not accompany a body read");
        assert_eq!(invalid_prepare.code, CoreErrorCode::InvalidInput);
        let LibraryReadValue::PageLifecyclePreflight { value } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLifecyclePreflight {
                        page_id: PAGE.to_owned(),
                    },
                },
            )
            .expect("created Page preflight")
            .value
        else {
            panic!("Page lifecycle preflight");
        };
        let page = value.page.expect("created Page authority");
        assert_eq!(page.metadata_revision, 1);
        assert_eq!(
            page.membership.expect("created membership").status,
            LibraryPageWorkflowStatus::Triage
        );
    }

    #[test]
    fn persistent_navigation_separates_roots_rows_paths_and_continues_cursors() {
        const ROOT_PAGE: &str = "page:root";
        const ROW_PAGE: &str = "page:row";
        const ROOT_DOCUMENT: &str = "document:root";
        const ROW_DOCUMENT: &str = "document:row";
        const DATABASE: &str = "database:root";
        const PRIMARY_CANVAS: &str = "canvas:primary:project-1";
        const CANVAS_DOCUMENT: &str = "document:canvas:primary:project-1";
        const SOURCE: &str = "source:root";
        const VIEW: &str = "view:root";
        const DELETED_VIEW: &str = "view:deleted";
        const NOW: &str = "2026-07-18T23:59:00.000Z";
        let persistent_context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:persistent-library".to_owned(),
            adapter: AdapterKind::Test,
        };

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES (?1, ?2, ?2)",
                        params!["profile-1", NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?3)",
                        params!["library-1", "profile-1", NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES (?1, ?2, 'Library reads', ?3, ?3)",
                        params!["project-1", "library-1", NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES (?1, ?2, 'Reference reads', ?3, ?3)",
                        params!["project-2", "library-1", NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, 'epoch-1', ?1, ?1)",
                        [NOW],
                    )?;
                    for (block_id, block_type, location) in [
                        (ROOT_PAGE, "page", "space"),
                        (DATABASE, "database", "space"),
                        (PRIMARY_CANVAS, "canvas", "space"),
                    ] {
                        transaction.execute(
                            "INSERT INTO blocks( \
                               id, project_id, type, lifecycle, location_kind, \
                               containing_document_id, containing_database_id, \
                               location_revision, metadata_revision, created_at, updated_at \
                             ) VALUES (?1, 'project-1', ?2, 'active', ?3, NULL, NULL, 1, 1, ?4, ?4)",
                            params![block_id, block_type, location, NOW],
                        )?;
                    }
                    transaction.execute(
                        "INSERT INTO database_containers( \
                           block_id, library_id, name, lifecycle, default_view_id, \
                           created_at, updated_at \
                         ) VALUES (?1, 'library-1', 'Cards', 'active', NULL, ?2, ?2)",
                        params![DATABASE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO blocks( \
                           id, project_id, type, lifecycle, location_kind, \
                           containing_document_id, containing_database_id, \
                           location_revision, metadata_revision, created_at, updated_at \
                         ) VALUES (?1, 'project-1', 'page', 'active', 'database', \
                           NULL, ?2, 1, 1, ?3, ?3)",
                        params![ROW_PAGE, DATABASE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_sources( \
                           id, library_id, home_database_block_id, name, schema_key, \
                           rank_key, created_at, updated_at \
                         ) VALUES (?1, 'library-1', ?2, 'Cards', 'nodex.database', 'a', ?3, ?3)",
                        params![SOURCE, DATABASE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_properties( \
                           data_source_id, id, name, value_type, config_json, rank_key, \
                           lifecycle, schema_revision, created_at, updated_at \
                         ) VALUES (?1, 'status', 'Status', 'select', \
                           '{\"options\":[{\"id\":\"triage\",\"name\":\"Triage\"}]}', \
                           'a', 'active', 1, ?2, ?2)",
                        params![SOURCE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_properties( \
                           data_source_id, id, name, value_type, config_json, rank_key, \
                           lifecycle, schema_revision, created_at, updated_at \
                         ) VALUES (?1, 'tags', 'Tags', 'multi_select', \
                           '{\"options\":[]}', 'b', 'active', 1, ?2, ?2)",
                        params![SOURCE, NOW],
                    )?;
                    transaction.execute(
                        r#"INSERT INTO database_views(
                           id, database_block_id, data_source_id, name, kind, config_json,
                           rank_key, created_at, updated_at
                         ) VALUES (?1, ?2, ?3, 'All', 'list',
                           '{"filter":{"kind":"group","operator":"and","children":[]},
                             "sort":[],"group":null,
                             "display":{"propertyIds":[],"showTitle":true}}',
                           'a', ?4, ?4)"#,
                        params![VIEW, DATABASE, SOURCE, NOW],
                    )?;
                    transaction.execute(
                        r#"INSERT INTO database_views(
                           id, database_block_id, data_source_id, name, kind, config_json,
                           rank_key, lifecycle, created_at, updated_at
                         ) VALUES (?1, ?2, ?3, 'Deleted', 'list',
                           '{"filter":{"kind":"group","operator":"and","children":[]},
                             "sort":[],"group":null,
                             "display":{"propertyIds":[],"showTitle":true}}',
                           'b', 'deleted', ?4, ?4)"#,
                        params![DELETED_VIEW, DATABASE, SOURCE, NOW],
                    )?;
                    transaction.execute(
                        "UPDATE database_containers SET default_view_id = ?1 WHERE block_id = ?2",
                        params![VIEW, DATABASE],
                    )?;
                    for (page_id, document_id, parent_kind, parent_id) in [
                        (ROOT_PAGE, ROOT_DOCUMENT, "library", "library-1"),
                        (ROW_PAGE, ROW_DOCUMENT, "data_source", SOURCE),
                    ] {
                        transaction.execute(
                            "INSERT INTO documents( \
                               id, project_id, generation, head_seq, schema_key, schema_version, \
                               state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine \
                             ) VALUES (?1, 'project-1', 1, 0, 'nodex.page', 2, X'', '', \
                               'pending_genesis', 'legacy_shadow', ?2, ?2, 'yjs')",
                            params![document_id, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                             VALUES (?1, ?2, 'project-1', ?3)",
                            params![page_id, document_id, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO pages( \
                               block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
                               created_at, updated_at \
                             ) VALUES (?1, 'library-1', ?2, ?3, ?4, 'active', ?5, ?5)",
                            params![page_id, document_id, parent_kind, parent_id, NOW],
                        )?;
                    }
                    transaction.execute(
                        "INSERT INTO documents( \
                           id, project_id, generation, head_seq, schema_key, schema_version, \
                           state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine \
                         ) VALUES (?1, 'project-1', 1, 0, 'nodex.canvas', 1, X'', \
                           '0000000000000000000000000000000000000000000000000000000000000000', \
                           'ready', 'ydoc_primary', ?2, ?2, 'canvas_scene')",
                        params![CANVAS_DOCUMENT, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                         VALUES (?1, ?2, 'project-1', ?3)",
                        params![PRIMARY_CANVAS, CANVAS_DOCUMENT, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO canvas_owners(block_id, library_id, created_at, updated_at) \
                         VALUES (?1, 'library-1', ?2, ?2)",
                        params![PRIMARY_CANVAS, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_properties( \
                           block_id, project_id, property_key, value_type, value_json, revision, updated_at \
                         ) VALUES (?1, 'project-1', 'document.display_name', 'string', \
                           '\"Canvas\"', 1, ?2)",
                        params![PRIMARY_CANVAS, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_page_memberships( \
                           id, data_source_id, page_block_id, revision, created_at, removed_at \
                         ) VALUES ('membership:row', ?1, ?2, 1, ?3, NULL)",
                        params![SOURCE, ROW_PAGE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_property_values( \
                           data_source_id, membership_id, property_id, value_type, value_json, \
                           revision, updated_at \
                         ) VALUES (?1, 'membership:row', 'status', 'select', '\"triage\"', 1, ?2)",
                        params![SOURCE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO page_read_model( \
                           page_block_id, project_id, lifecycle, location_kind, \
                           containing_document_id, containing_database_id, top_level_rank_key, \
                           location_revision, metadata_revision, document_id, document_generation, \
                           document_projected_seq, document_schema_version, document_authority, \
                           membership_id, database_block_id, view_id, view_group_key, view_rank_key, \
                           title, description_preview, description_length, has_description, \
                           database_values_json, intrinsic_properties_json, property_revisions_json, \
                           projection_version, created_at, updated_at \
                         ) VALUES (?1, 'project-1', 'active', 'space', NULL, NULL, 'a', 1, 1, \
                           ?2, 1, 0, 2, 'legacy_shadow', NULL, NULL, NULL, NULL, NULL, '', '', 0, 0, \
                           '{}', '{}', '{}', 1, ?3, ?3)",
                        params![ROOT_PAGE, ROOT_DOCUMENT, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO page_read_model( \
                           page_block_id, project_id, lifecycle, location_kind, \
                           containing_document_id, containing_database_id, top_level_rank_key, \
                           location_revision, metadata_revision, document_id, document_generation, \
                           document_projected_seq, document_schema_version, document_authority, \
                           membership_id, database_block_id, view_id, view_group_key, view_rank_key, \
                           title, description_preview, description_length, has_description, \
                           database_values_json, intrinsic_properties_json, property_revisions_json, \
                           projection_version, created_at, updated_at \
                         ) VALUES (?1, 'project-1', 'active', 'database', NULL, ?2, NULL, 1, 1, \
                           ?3, 1, 0, 2, 'legacy_shadow', 'membership:row', ?2, NULL, NULL, NULL, '', '', 0, 0, \
                           '{\"status\":\"triage\"}', '{}', \
                           '{\"database\":{\"status\":1},\"intrinsic\":{}}', 1, ?4, ?4)",
                        params![ROW_PAGE, DATABASE, ROW_DOCUMENT, NOW],
                    )?;
                    transaction.execute(
                        "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                        [DATABASE],
                    )?;
                    transaction.execute(
                        "INSERT INTO library_block_placements( \
                           block_id, library_id, rank_key, created_at, updated_at \
                         ) VALUES (?1, 'library-1', 'a', ?3, ?3), \
                                  (?2, 'library-1', 'b', ?3, ?3), \
                                  (?4, 'library-1', 'c', ?3, ?3)",
                        params![ROOT_PAGE, DATABASE, NOW, PRIMARY_CANVAS],
                    )?;
                    Ok(())
                })
            })
            .expect("seed Library");

        let document = OwnedDocumentModule::new("profile-1", "library-1", &kernel);
        for (operation_id, owner_block_id) in
            [("prepare:root", ROOT_PAGE), ("prepare:row", ROW_PAGE)]
        {
            document
                .apply(
                    &persistent_context,
                    ModuleApplyRequest {
                        contract_version: OWNED_DOCUMENT_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: OwnedDocumentIntent::PrepareOwner {
                            owner_block_id: owner_block_id.to_owned(),
                        },
                    },
                )
                .expect("prepare Page");
        }
        kernel
            .writer()
            .call(move |connection| {
                with_immediate_transaction(connection, |transaction| {
                    let title_hash = Sha256::digest(b"Say hi")
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>();
                    transaction.execute(
                        "INSERT OR IGNORE INTO page_read_model( \
                           page_block_id, project_id, lifecycle, location_kind, \
                           containing_document_id, containing_database_id, top_level_rank_key, \
                           location_revision, metadata_revision, document_id, document_generation, \
                           document_projected_seq, document_schema_version, document_authority, \
                           membership_id, database_block_id, view_id, view_group_key, view_rank_key, \
                           title, description_preview, description_length, has_description, \
                           database_values_json, intrinsic_properties_json, property_revisions_json, \
                           projection_version, created_at, updated_at \
                         ) VALUES (?1, 'project-1', 'active', 'database', NULL, ?2, NULL, 1, 1, \
                           ?3, 1, 1, 2, 'ydoc_primary', 'membership:row', ?2, NULL, NULL, NULL, \
                           'Say hi', '', 0, 0, '{\"status\":\"triage\"}', '{}', \
                           '{\"database\":{\"status\":1},\"intrinsic\":{}}', 1, ?4, ?4)",
                        params![ROW_PAGE, DATABASE, ROW_DOCUMENT, NOW],
                    )?;
                    transaction.execute(
                        "UPDATE document_materializations SET title = 'Say hi' \
                         WHERE document_id = ?1",
                        [ROW_DOCUMENT],
                    )?;
                    transaction.execute(
                        "UPDATE page_read_model SET title = 'Say hi' WHERE page_block_id = ?1",
                        [ROW_PAGE],
                    )?;
                    transaction.execute(
                        "UPDATE block_search_units SET text = 'Say hi', text_hash = ?1, \
                           updated_at = ?2 WHERE document_id = ?3 \
                           AND source_kind = 'document_title'",
                        params![title_hash, NOW, ROW_DOCUMENT],
                    )?;
                    Ok(())
                })
            })
            .expect("name row Page");

        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        let read = |read| {
            module
                .read(
                    &persistent_context,
                    ModuleReadRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        read,
                    },
                )
                .expect("Library read")
                .value
        };
        let LibraryReadValue::PageContent { value } = read(LibraryRead::PageContent {
            page_id: ROOT_PAGE.to_owned(),
        }) else {
            panic!("Page content");
        };
        assert_eq!(value.document_head_seq, 1);
        assert_eq!(value.body_nfm, "");
        assert!(value.references.is_empty());
        assert!(value.asset_refs.is_empty());
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE document_materializations SET projected_seq = 0 \
                     WHERE document_id = ?1",
                    [ROOT_DOCUMENT],
                )?;
                Ok(())
            })
            .expect("make Page materialization stale");
        let error = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageContent {
                        page_id: ROOT_PAGE.to_owned(),
                    },
                },
            )
            .expect_err("stale Page content projection");
        assert_eq!(error.code, CoreErrorCode::RevisionConflict);
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE document_materializations SET projected_seq = 1 \
                     WHERE document_id = ?1",
                    [ROOT_DOCUMENT],
                )?;
                Ok(())
            })
            .expect("restore Page materialization");
        let LibraryReadValue::Children { items, .. } = read(LibraryRead::Children {
            parent: LibraryNavigationParent::Library,
            cursor: None,
            limit: None,
            force_include_target: None,
        }) else {
            panic!("root children");
        };
        assert_eq!(items.len(), 3);
        assert!(!items.iter().any(|node| matches!(
            node,
            nodex_core_contracts::library::LibraryNavigationNode::Page { page_id, .. }
                if page_id == ROW_PAGE
        )));
        let LibraryReadValue::StandaloneRoots {
            items,
            total,
            has_more,
            ..
        } = read(LibraryRead::StandaloneRoots {
            cursor: None,
            limit: None,
            force_include_target: Some(LibraryResourceTarget::Database {
                database_id: DATABASE.to_owned(),
            }),
        })
        else {
            panic!("standalone roots");
        };
        assert_eq!(total, 1);
        assert!(!has_more);
        assert!(matches!(
            items.as_slice(),
            [nodex_core_contracts::library::LibraryNavigationNode::Page { page_id, .. }]
                if page_id == ROOT_PAGE
        ));
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET lifecycle = 'archived' WHERE id = 'project-1'",
                    [],
                )?;
                Ok(())
            })
            .expect("archive Project");
        let LibraryReadValue::StandaloneRoots { items, total, .. } =
            read(LibraryRead::StandaloneRoots {
                cursor: None,
                limit: None,
                force_include_target: None,
            })
        else {
            panic!("archived Project standalone roots");
        };
        assert_eq!(total, 3);
        assert!(items.iter().any(|node| matches!(
            node,
            nodex_core_contracts::library::LibraryNavigationNode::Database { database_id, .. }
                if database_id == DATABASE
        )));
        assert!(items.iter().any(|node| matches!(
            node,
            nodex_core_contracts::library::LibraryNavigationNode::Canvas { canvas_id, .. }
                if canvas_id == PRIMARY_CANVAS
        )));
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET lifecycle = 'active' WHERE id = 'project-1'",
                    [],
                )?;
                Ok(())
            })
            .expect("restore Project");
        let LibraryReadValue::Catalog { items, .. } = read(LibraryRead::Catalog {
            query: Some("say hi".to_owned()),
            kinds: None,
            lifecycle: None,
            cursor: None,
            limit: None,
        }) else {
            panic!("catalog");
        };
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].location_label, "Cards");
        let root_context = context();
        let LibraryReadValue::ProjectPageSearch { items } = module
            .read(
                &root_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::ProjectPageSearch {
                        project_ids: vec!["missing-project".to_owned(), "project-1".to_owned()],
                        query: "say hi".to_owned(),
                        limit: Some(10),
                    },
                },
            )
            .expect("trusted root Project Page search")
            .value
        else {
            panic!("Project Page search");
        };
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].project_id, "project-1");
        assert_eq!(items[0].page_id, ROW_PAGE);
        assert_eq!(items[0].title, "Say hi");
        assert_eq!(items[0].status, LibraryPageWorkflowStatus::Triage);
        assert_eq!(items[0].score, 1_000_000);
        let project_search_error = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::ProjectPageSearch {
                        project_ids: vec!["project-1".to_owned()],
                        query: "say hi".to_owned(),
                        limit: None,
                    },
                },
            )
            .expect_err("Project-bound clients cannot claim multi-Project search");
        assert_eq!(project_search_error.code, CoreErrorCode::Unauthorized);
        let mut untrusted_root_context = context();
        untrusted_root_context.adapter = AdapterKind::Agent;
        let untrusted_target_error = module
            .read(
                &untrusted_root_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageTarget {
                        page_id: ROOT_PAGE.to_owned(),
                    },
                },
            )
            .expect_err("Agent clients cannot claim trusted Page target authority");
        assert_eq!(untrusted_target_error.code, CoreErrorCode::Unauthorized);
        let untrusted_path_error = module
            .read(
                &untrusted_root_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageOwnershipPath {
                        page_id: ROOT_PAGE.to_owned(),
                    },
                },
            )
            .expect_err("Agent clients cannot claim trusted Page path authority");
        assert_eq!(untrusted_path_error.code, CoreErrorCode::Unauthorized);
        let untrusted_search_error = module
            .read(
                &untrusted_root_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::ProjectPageSearch {
                        project_ids: vec!["project-1".to_owned()],
                        query: "say hi".to_owned(),
                        limit: None,
                    },
                },
            )
            .expect_err("Agent clients cannot claim trusted Project Page search");
        assert_eq!(untrusted_search_error.code, CoreErrorCode::Unauthorized);
        let untrusted_content_error = module
            .read(
                &untrusted_root_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageContent {
                        page_id: ROOT_PAGE.to_owned(),
                    },
                },
            )
            .expect_err("Agent root clients cannot bypass Page authorization");
        assert_eq!(untrusted_content_error.code, CoreErrorCode::Unauthorized);
        let LibraryReadValue::Path { nodes, .. } = read(LibraryRead::Path {
            target: nodex_core_contracts::library::LibraryRouteTarget::Page {
                page_id: ROW_PAGE.to_owned(),
            },
        }) else {
            panic!("path");
        };
        assert!(matches!(
            nodes.as_slice(),
            [nodex_core_contracts::library::LibraryNavigationNode::Database { database_id, .. }]
                if database_id == DATABASE
        ));
        let LibraryReadValue::PageLocation { value } = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLocation {
                        page_id: ROW_PAGE.to_owned(),
                    },
                },
            )
            .expect("trusted root Page location")
            .value
        else {
            panic!("Page location");
        };
        assert_eq!(value.expect("active Page location").project_id, "project-1");
        let LibraryReadValue::ViewLocation { value } = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::ViewLocation {
                        view_id: VIEW.to_owned(),
                    },
                },
            )
            .expect("trusted root View location")
            .value
        else {
            panic!("View location");
        };
        assert_eq!(
            value.expect("active View location"),
            nodex_core_contracts::library::LibraryViewLocation {
                view_id: VIEW.to_owned(),
                data_source_id: SOURCE.to_owned(),
                database_id: DATABASE.to_owned(),
                project_id: "project-1".to_owned(),
            }
        );
        let LibraryReadValue::ViewLocation { value } = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::ViewLocation {
                        view_id: DELETED_VIEW.to_owned(),
                    },
                },
            )
            .expect("trusted root deleted View location")
            .value
        else {
            panic!("deleted View location");
        };
        assert_eq!(value, None);
        let LibraryReadValue::PageLifecyclePreflight { value } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLifecyclePreflight {
                        page_id: ROW_PAGE.to_owned(),
                    },
                },
            )
            .expect("native Page lifecycle preflight")
            .value
        else {
            panic!("Page lifecycle preflight");
        };
        assert_eq!(value.version, 2);
        assert_eq!(value.tags_property["propertyId"], "tags");
        let page = value.page.expect("Page lifecycle authority");
        assert_eq!(page.page_id, ROW_PAGE);
        assert_eq!(page.metadata_revision, 1);
        assert_eq!(page.parent_revision, 1);
        assert_eq!(page.document.generation, 1);
        assert_eq!(page.document.head_seq, 1);
        let membership = page.membership.expect("Data Source membership");
        assert_eq!(membership.membership_id, "membership:row");
        assert_eq!(membership.status, LibraryPageWorkflowStatus::Triage);
        assert_eq!(membership.view_id, VIEW);
        assert!(membership.position.is_none());
        let deleted = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "lifecycle:delete-row".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::DeletePage {
                            page_id: ROW_PAGE.to_owned(),
                            expected_metadata_revision: 1,
                            expected_parent_revision: 1,
                            parent_document_head: None,
                        }),
                    },
                },
            )
            .expect("delete Data Source Page");
        assert_eq!(
            deleted
                .committed
                .value
                .page_lifecycle
                .expect("delete receipt")
                .membership_id
                .as_deref(),
            Some("membership:row")
        );
        let LibraryReadValue::PageLifecyclePreflight { value } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLifecyclePreflight {
                        page_id: ROW_PAGE.to_owned(),
                    },
                },
            )
            .expect("deleted Page lifecycle preflight")
            .value
        else {
            panic!("deleted Page lifecycle preflight");
        };
        let deleted_page = value.page.expect("deleted Page authority");
        assert_eq!(deleted_page.lifecycle, "deleted");
        assert!(deleted_page.membership.is_none());
        let restore_evidence = deleted_page.restore_evidence.expect("restore evidence");
        assert_eq!(restore_evidence.delete_operation_id, "lifecycle:delete-row");
        let restore_membership = restore_evidence.membership.expect("restore membership");
        assert_eq!(restore_membership.membership_id, "membership:row");
        module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "lifecycle:restore-row".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::RestorePage {
                            page_id: ROW_PAGE.to_owned(),
                            delete_operation_id: restore_evidence.delete_operation_id,
                            expected_metadata_revision: 2,
                            expected_parent_revision: 2,
                            parent_document_head: None,
                            membership: Some(
                                nodex_core_contracts::library::LibraryPageLifecycleMutationMembership {
                                    membership_id: restore_membership.membership_id,
                                    database_id: restore_membership.database_id,
                                    data_source_id: restore_membership.data_source_id,
                                    status: restore_membership.status,
                                    position: restore_membership.view_id.map(|view_id| {
                                        nodex_core_contracts::library::LibraryPageLifecycleRestorePosition {
                                            view_id,
                                            before_view_page_id: None,
                                        }
                                    }),
                                },
                            ),
                            before_block_id: None,
                        }),
                    },
                },
            )
            .expect("restore Data Source Page");
        let LibraryReadValue::PageLifecyclePreflight { value } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLifecyclePreflight {
                        page_id: ROW_PAGE.to_owned(),
                    },
                },
            )
            .expect("restored Page lifecycle preflight")
            .value
        else {
            panic!("restored Page lifecycle preflight");
        };
        let restored_page = value.page.expect("restored Page authority");
        assert_eq!(restored_page.lifecycle, "active");
        assert_eq!(restored_page.metadata_revision, 3);
        assert_eq!(restored_page.parent_revision, 3);
        assert_eq!(
            restored_page
                .membership
                .expect("restored membership")
                .membership_revision,
            3
        );
        assert!(restored_page.restore_evidence.is_none());
        let location_error = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLocation {
                        page_id: ROW_PAGE.to_owned(),
                    },
                },
            )
            .expect_err("Project clients cannot perform global Page lookup");
        assert_eq!(location_error.code, CoreErrorCode::Unauthorized);
        let view_location_error = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::ViewLocation {
                        view_id: VIEW.to_owned(),
                    },
                },
            )
            .expect_err("Project clients cannot perform global View lookup");
        assert_eq!(view_location_error.code, CoreErrorCode::Unauthorized);

        const INTERMEDIATE_PAGE: &str = "page:intermediate";
        const INTERMEDIATE_DOCUMENT: &str = "document:intermediate";
        const NESTED_PAGE: &str = "page:nested";
        const NESTED_DOCUMENT: &str = "document:nested";
        module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "create:intermediate-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: INTERMEDIATE_PAGE.to_owned(),
                        document_id: INTERMEDIATE_DOCUMENT.to_owned(),
                        title: "Intermediate reference".to_owned(),
                        parent: LibraryWriteParent::Page {
                            page_id: ROOT_PAGE.to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 1,
                            before: None,
                        },
                    },
                },
            )
            .expect("create intermediate reference Page");
        module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "create:nested-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: NESTED_PAGE.to_owned(),
                        document_id: NESTED_DOCUMENT.to_owned(),
                        title: "Nested reference".to_owned(),
                        parent: LibraryWriteParent::Page {
                            page_id: INTERMEDIATE_PAGE.to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 1,
                            before: None,
                        },
                    },
                },
            )
            .expect("create nested reference Page");
        let root_context = context();
        let LibraryReadValue::PageTarget { value } = module
            .read(
                &root_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageTarget {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("trusted root Page target")
            .value
        else {
            panic!("Page target");
        };
        assert!(matches!(
            value.as_deref(),
            Some(nodex_core_contracts::library::LibraryPageTarget::Available {
                target_page_id,
                ..
            }) if target_page_id == NESTED_PAGE
        ));
        let LibraryReadValue::PageOwnershipPath { value } = module
            .read(
                &root_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageOwnershipPath {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("trusted root Page ownership path")
            .value
        else {
            panic!("Page ownership path");
        };
        let Some(nodex_core_contracts::library::LibraryPageOwnershipPath::Available {
            ancestors,
            ..
        }) = value.as_deref()
        else {
            panic!("available Page ownership path");
        };
        assert_eq!(ancestors.len(), 2);
        assert_eq!(ancestors[0].page_id, ROOT_PAGE);
        assert_eq!(ancestors[1].page_id, INTERMEDIATE_PAGE);
        let project_two_context = BoundModuleContext {
            project_id: Some(ProjectId("project-2".to_owned())),
            connection_id: "connection:reference-project".to_owned(),
            ..persistent_context.clone()
        };
        let LibraryReadValue::PageTarget { value } = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageTarget {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("unauthorized target resolves without disclosure")
            .value
        else {
            panic!("Page target");
        };
        assert!(matches!(
            value.as_deref(),
            Some(nodex_core_contracts::library::LibraryPageTarget::Missing { target_page_id })
                if target_page_id == NESTED_PAGE
        ));
        let detail_error = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageDetail {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect_err("Project Page detail enforces recursive grants");
        assert_eq!(detail_error.code, CoreErrorCode::NotFound);
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "grant:nested-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-2".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: NESTED_PAGE.to_owned(),
                        },
                        access: LibraryAccess::Read,
                    },
                },
            )
            .expect("grant nested Page");
        let authorized_target = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageTarget {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("authorized Page target");
        let stamp = authorized_target
            .authorization
            .as_ref()
            .expect("Core-issued Page target authorization stamp");
        assert_eq!(stamp.covered_commit_seq, authorized_target.commit_head);
        assert_eq!(stamp.store_epoch, authorized_target.store_epoch);
        assert_eq!(
            stamp.delivery_address,
            nodex_core_contracts::events::DeliveryAddress::Project {
                library_id: "library-1".to_owned(),
                project_id: "project-2".to_owned(),
            }
        );
        assert_eq!(
            stamp.authorization_dependencies,
            vec![nodex_core_contracts::events::ResourceKey::Page {
                page_id: NESTED_PAGE.to_owned(),
            }]
        );
        assert_eq!(stamp.stamp_hash.len(), 64);
        let LibraryReadValue::PageTarget { value } = authorized_target.value else {
            panic!("Page target");
        };
        assert!(matches!(
            value.as_deref(),
            Some(nodex_core_contracts::library::LibraryPageTarget::Available {
                target_page_id,
                ..
            }) if target_page_id == NESTED_PAGE
        ));
        let LibraryReadValue::PageOwnershipPath { value } = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageOwnershipPath {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("direct grant ownership path")
            .value
        else {
            panic!("Page ownership path");
        };
        let Some(nodex_core_contracts::library::LibraryPageOwnershipPath::Available {
            ancestors,
            ..
        }) = value.as_deref()
        else {
            panic!("available Page ownership path");
        };
        assert!(ancestors.is_empty());
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "grant:root-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-2".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: ROOT_PAGE.to_owned(),
                        },
                        access: LibraryAccess::Read,
                    },
                },
            )
            .expect("grant root Page");
        let overlapping_stamp = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageDetail {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("overlapping grants authorize nested Page detail")
            .authorization
            .expect("overlapping-grant Page detail stamp");
        assert_eq!(overlapping_stamp.authorization_dependencies.len(), 3);
        for page_id in [NESTED_PAGE, INTERMEDIATE_PAGE, ROOT_PAGE] {
            assert!(overlapping_stamp.authorization_dependencies.contains(
                &nodex_core_contracts::events::ResourceKey::Page {
                    page_id: page_id.to_owned(),
                },
            ));
        }
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "revoke:nested-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::SetProjectAccess {
                        target: LibraryResourceTarget::Page {
                            page_id: NESTED_PAGE.to_owned(),
                        },
                        changes: vec![LibraryProjectAccessChange {
                            project_id: "project-2".to_owned(),
                            access: None,
                            expected_revision: Some(1),
                        }],
                    },
                },
            )
            .expect("revoke nested direct grant");
        let ancestor_authorized_detail = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageDetail {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("ancestor grant authorizes nested Page detail");
        let ancestor_stamp = ancestor_authorized_detail
            .authorization
            .expect("ancestor-authorized Page detail stamp");
        let LibraryReadValue::PageOwnershipPath { value } = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageOwnershipPath {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("visible ownership path")
            .value
        else {
            panic!("Page ownership path");
        };
        let Some(nodex_core_contracts::library::LibraryPageOwnershipPath::Available {
            ancestors,
            ..
        }) = value.as_deref()
        else {
            panic!("available Page ownership path");
        };
        assert_eq!(ancestors.len(), 2);
        assert_eq!(ancestors[0].page_id, ROOT_PAGE);
        assert_eq!(ancestors[1].page_id, INTERMEDIATE_PAGE);
        let granted_intermediate = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "grant:intermediate-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-2".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: INTERMEDIATE_PAGE.to_owned(),
                        },
                        access: LibraryAccess::Read,
                    },
                },
            )
            .expect("grant overlapping intermediate Page access");
        let overlapping_path_grant_roots = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .prepare(
                        "SELECT roots_json FROM local_commit_visibility_deltas \
                         WHERE commit_seq = ?1 AND delta_kind = 'grant' \
                         ORDER BY scope_key, delta_hash",
                    )?
                    .query_map([granted_intermediate.committed.receipt.commit_seq], |row| {
                        row.get::<_, String>(0)
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(StoreError::from)
            })
            .expect("read overlapping-path grant visibility roots");
        assert!(overlapping_path_grant_roots.iter().any(|encoded| {
            serde_json::from_str::<Vec<nodex_core_contracts::events::ResourceKey>>(encoded)
                .expect("visibility roots")
                .iter()
                .any(|root| {
                    root == &nodex_core_contracts::events::ResourceKey::Page {
                        page_id: INTERMEDIATE_PAGE.to_owned(),
                    } && ancestor_stamp.authorization_dependencies.contains(root)
                })
        }));
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "revoke:intermediate-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::SetProjectAccess {
                        target: LibraryResourceTarget::Page {
                            page_id: INTERMEDIATE_PAGE.to_owned(),
                        },
                        changes: vec![LibraryProjectAccessChange {
                            project_id: "project-2".to_owned(),
                            access: None,
                            expected_revision: Some(1),
                        }],
                    },
                },
            )
            .expect("remove overlapping intermediate Page access");
        let moved_intermediate = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move:intermediate-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MovePage {
                        page_id: INTERMEDIATE_PAGE.to_owned(),
                        destination: LibraryPageWriteDestination::Library { at: None },
                        expected_etag: prepare_page_move_etag(
                            &module,
                            &persistent_context,
                            INTERMEDIATE_PAGE,
                        ),
                    },
                },
            )
            .expect("move intermediate Page outside the granted ownership path");
        let moved_intermediate_manifest = kernel
            .readers()
            .read_default(|connection| {
                local_commit::read_manifest(
                    connection,
                    moved_intermediate.committed.receipt.commit_seq,
                )
            })
            .expect("read intermediate-move Manifest");
        assert!(
            moved_intermediate_manifest
                .revocations
                .iter()
                .any(|revocation| {
                    revocation.resource_kind == RevokedResourceKind::Page
                        && revocation.resource_id == INTERMEDIATE_PAGE
                })
        );
        assert!(
            moved_intermediate_manifest
                .revocations
                .iter()
                .any(|revocation| {
                    revocation.resource_kind == RevokedResourceKind::Page
                        && ancestor_stamp.authorization_dependencies.contains(
                            &nodex_core_contracts::events::ResourceKey::Page {
                                page_id: revocation.resource_id.clone(),
                            },
                        )
                })
        );
        let moved_intermediate_delta_roots = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .prepare(
                        "SELECT roots_json FROM local_commit_visibility_deltas \
                         WHERE commit_seq = ?1 AND delta_kind = 'revoke' \
                         ORDER BY scope_key, delta_hash",
                    )?
                    .query_map([moved_intermediate.committed.receipt.commit_seq], |row| {
                        row.get::<_, String>(0)
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(StoreError::from)
            })
            .expect("read intermediate-move visibility roots");
        assert!(moved_intermediate_delta_roots.iter().any(|encoded| {
            serde_json::from_str::<Vec<nodex_core_contracts::events::ResourceKey>>(encoded)
                .expect("visibility roots")
                .contains(&nodex_core_contracts::events::ResourceKey::Project {
                    project_id: "project-2".to_owned(),
                })
        }));
        let revoked_ancestor = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "revoke:root-reference-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::SetProjectAccess {
                        target: LibraryResourceTarget::Page {
                            page_id: ROOT_PAGE.to_owned(),
                        },
                        changes: vec![LibraryProjectAccessChange {
                            project_id: "project-2".to_owned(),
                            access: None,
                            expected_revision: Some(1),
                        }],
                    },
                },
            )
            .expect("revoke ancestor grant");
        let ancestor_manifest = kernel
            .readers()
            .read_default(|connection| {
                local_commit::read_manifest(
                    connection,
                    revoked_ancestor.committed.receipt.commit_seq,
                )
            })
            .expect("read ancestor-revoke Manifest");
        assert!(ancestor_manifest.revocations.iter().any(|revocation| {
            revocation.resource_kind == RevokedResourceKind::Page
                && revocation.resource_id == ROOT_PAGE
        }));
        assert!(ancestor_manifest.revocations.iter().any(|revocation| {
            revocation.resource_kind == RevokedResourceKind::Page
                && ancestor_stamp.authorization_dependencies.contains(
                    &nodex_core_contracts::events::ResourceKey::Page {
                        page_id: revocation.resource_id.clone(),
                    },
                )
        }));
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "grant:reference-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-2".to_owned(),
                        target: LibraryResourceTarget::Database {
                            database_id: DATABASE.to_owned(),
                        },
                        access: LibraryAccess::Read,
                    },
                },
            )
            .expect("grant reference Database");
        let membership_stamp = module
            .read(
                &project_two_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageDetail {
                        page_id: ROW_PAGE.to_owned(),
                    },
                },
            )
            .expect("Database grant authorizes member Page detail")
            .authorization
            .expect("Database-authorized Page detail stamp");
        assert!(membership_stamp.authorization_dependencies.contains(
            &nodex_core_contracts::events::ResourceKey::Page {
                page_id: ROW_PAGE.to_owned(),
            },
        ));
        assert!(membership_stamp.authorization_dependencies.contains(
            &nodex_core_contracts::events::ResourceKey::Database {
                database_id: DATABASE.to_owned(),
            },
        ));
        let revoked_database = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "revoke:reference-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::SetProjectAccess {
                        target: LibraryResourceTarget::Database {
                            database_id: DATABASE.to_owned(),
                        },
                        changes: vec![LibraryProjectAccessChange {
                            project_id: "project-2".to_owned(),
                            access: None,
                            expected_revision: Some(1),
                        }],
                    },
                },
            )
            .expect("revoke reference Database");
        let database_manifest = kernel
            .readers()
            .read_default(|connection| {
                local_commit::read_manifest(
                    connection,
                    revoked_database.committed.receipt.commit_seq,
                )
            })
            .expect("read Database-revoke Manifest");
        assert!(database_manifest.revocations.iter().any(|revocation| {
            revocation.resource_kind == RevokedResourceKind::Database
                && membership_stamp.authorization_dependencies.contains(
                    &nodex_core_contracts::events::ResourceKey::Database {
                        database_id: revocation.resource_id.clone(),
                    },
                )
        }));
        let missing_project_context = BoundModuleContext {
            project_id: Some(ProjectId("project:missing".to_owned())),
            connection_id: "connection:missing-project".to_owned(),
            ..persistent_context.clone()
        };
        let LibraryReadValue::PageTarget { value } = module
            .read(
                &missing_project_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageTarget {
                        page_id: NESTED_PAGE.to_owned(),
                    },
                },
            )
            .expect("missing Project scope")
            .value
        else {
            panic!("Page target");
        };
        assert!(value.is_none());

        let LibraryReadValue::Children { next_cursor, .. } = read(LibraryRead::Children {
            parent: LibraryNavigationParent::Library,
            cursor: None,
            limit: Some(2),
            force_include_target: None,
        }) else {
            panic!("paged roots");
        };
        let cursor = next_cursor.expect("cursor");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO change_log( \
                       project_id, store_epoch, kind, block_ids_json, document_ids_json, \
                       database_block_ids_json, payload_json, projection_impact_json, committed_at \
                     ) VALUES ('project-1', 'epoch-1', 'library_changed', '[]', '[]', '[]', '{}', \
                       '{\"kind\":\"none\"}', ?1)",
                    [NOW],
                )?;
                Ok(())
            })
            .expect("advance Library sequence");
        let LibraryReadValue::Children {
            items,
            next_cursor,
            has_more,
            ..
        } = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::Children {
                        parent: LibraryNavigationParent::Library,
                        cursor: Some(cursor),
                        limit: Some(2),
                        force_include_target: None,
                    },
                },
            )
            .expect("continuation survives unrelated writes")
            .value
        else {
            panic!("paged roots continuation");
        };
        assert_eq!(items.len(), 2);
        assert_eq!(next_cursor, None);
        assert!(!has_more);
    }

    #[test]
    fn native_block_transfer_moves_copies_and_replays_document_subtrees() {
        const NOW: &str = "2026-07-19T23:30:00.000Z";
        const SOURCE_PAGE: &str = "018f0000-0000-7000-8000-000000000101";
        const TARGET_PAGE: &str = "018f0000-0000-7000-8000-000000000102";
        const SOURCE_DOCUMENT: &str = "document:transfer-source";
        const TARGET_DOCUMENT: &str = "document:transfer-target";
        let persistent_context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:block-transfer".to_owned(),
            adapter: AdapterKind::Test,
        };
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project-1', 'library-1', 'Transfer', ?1, ?1)",
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
            .expect("seed authority");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        for (operation_id, page_id, document_id, title) in [
            (
                "create-transfer-source",
                SOURCE_PAGE,
                SOURCE_DOCUMENT,
                "Source",
            ),
            (
                "create-transfer-target",
                TARGET_PAGE,
                TARGET_DOCUMENT,
                "Target",
            ),
        ] {
            module
                .apply(
                    &persistent_context,
                    ModuleApplyRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: page_id.to_owned(),
                            document_id: document_id.to_owned(),
                            title: title.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create transfer Page");
        }
        let source_root = kernel
            .readers()
            .read_default(|connection| {
                connection.query_row(
                    "SELECT block_id FROM document_block_index WHERE document_id = ?1 ORDER BY ordinal LIMIT 1",
                    [SOURCE_DOCUMENT],
                    |row| row.get::<_, String>(0),
                ).map_err(Into::into)
            })
            .expect("source root");
        let move_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![source_root.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: SOURCE_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: TARGET_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let moved = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-transfer-root".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_intent.clone(),
                    },
                },
            )
            .expect("move subtree");
        let moved_result = moved
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("transfer result");
        assert_eq!(moved_result.document_commits.len(), 2);
        assert_eq!(moved_result.final_location_revisions[&source_root], 2);
        assert_eq!(
            moved.committed.receipt.affected_page_ids,
            vec![SOURCE_PAGE.to_owned(), TARGET_PAGE.to_owned()]
        );
        let transfer_document_event_kinds = kernel
            .readers()
            .read_default(|connection| {
                let mut statement = connection.prepare(
                    "SELECT kind FROM change_log \
                     WHERE kind LIKE 'owned_document.%' \
                       AND json_extract(payload_json, '$.localCommitId') = ?1 \
                     ORDER BY seq",
                )?;
                statement
                    .query_map(["move-transfer-root"], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(Into::into)
            })
            .expect("transfer Document events");
        assert_eq!(
            transfer_document_event_kinds,
            vec![
                "owned_document.document_updated".to_owned(),
                "owned_document.document_updated".to_owned(),
            ]
        );
        let mut reconnected = persistent_context.clone();
        reconnected.connection_id = "connection:reconnected".to_owned();
        let prepare_count = module.block_transfer_metrics().page_parent_prepare.count;
        let replay = module
            .apply(
                &reconnected,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-transfer-root".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_intent,
                    },
                },
            )
            .expect("apply-path replay");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            module.block_transfer_metrics().page_parent_prepare.count,
            prepare_count,
            "an idempotent apply replay must not repeat heavy Yrs preparation"
        );

        let copy_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![source_root.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Document {
                document_id: TARGET_DOCUMENT.to_owned(),
            },
            target: LibraryBlockTransferTarget::Document {
                document_id: SOURCE_DOCUMENT.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let copied = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "copy-transfer-root".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: copy_intent,
                    },
                },
            )
            .expect("copy subtree");
        let copied_result = copied.committed.value.block_transfer.expect("copy result");
        let copied_root = copied_result.copied_block_ids[&source_root].clone();
        assert_ne!(copied_root, source_root);
        assert_eq!(copied_result.document_commits.len(), 1);
        assert!(kernel
            .readers()
            .read_default(move |connection| {
                connection
                    .query_row(
                        "SELECT 1 FROM document_block_index WHERE document_id = ?1 AND block_id = ?2",
                        params![SOURCE_DOCUMENT, copied_root],
                        |_| Ok(()),
                    )
                    .optional()
                    .map(|row| row.is_some())
                    .map_err(Into::into)
            })
            .expect("copied root projection"));
    }

    #[test]
    fn granted_pages_authorize_cross_storage_block_transfers_and_rehome_registry_rows() {
        const NOW: &str = "2026-07-20T00:10:00.000Z";
        const LOCAL_SOURCE_PAGE: &str = "018f0000-0000-7000-8000-000000000201";
        const FOREIGN_SOURCE_PAGE: &str = "018f0000-0000-7000-8000-000000000202";
        const FOREIGN_TARGET_PAGE: &str = "018f0000-0000-7000-8000-000000000203";
        const LOCAL_SOURCE_DOCUMENT: &str = "document:transfer-local-source";
        const FOREIGN_SOURCE_DOCUMENT: &str = "document:transfer-foreign-source";
        const FOREIGN_TARGET_DOCUMENT: &str = "document:transfer-foreign-target";
        let context_for = |project_id: &str| BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId(project_id.to_owned())),
            connection_id: format!("connection:{project_id}:block-transfer"),
            adapter: AdapterKind::Test,
        };
        let local_context = context_for("project-1");
        let foreign_context = context_for("project-2");
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    for (project_id, name) in
                        [("project-1", "Requester"), ("project-2", "Storage")]
                    {
                        transaction.execute(
                            "INSERT INTO projects(id, library_id, name, created, updated) \
                             VALUES (?1, 'library-1', ?2, ?3, ?3)",
                            params![project_id, name, NOW],
                        )?;
                    }
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, 'epoch-1', ?1, ?1)",
                        [NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed authority");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        for (context, operation_id, page_id, document_id, title) in [
            (
                &local_context,
                "create-local-transfer-source",
                LOCAL_SOURCE_PAGE,
                LOCAL_SOURCE_DOCUMENT,
                "Local source",
            ),
            (
                &foreign_context,
                "create-foreign-transfer-source",
                FOREIGN_SOURCE_PAGE,
                FOREIGN_SOURCE_DOCUMENT,
                "Foreign source",
            ),
            (
                &foreign_context,
                "create-foreign-transfer-target",
                FOREIGN_TARGET_PAGE,
                FOREIGN_TARGET_DOCUMENT,
                "Foreign target",
            ),
        ] {
            module
                .apply(
                    context,
                    ModuleApplyRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: page_id.to_owned(),
                            document_id: document_id.to_owned(),
                            title: title.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create transfer Page");
        }
        let roots = kernel
            .readers()
            .read_default(|connection| {
                let read_root = |document_id: &str| {
                    connection.query_row(
                        "SELECT block_id FROM document_block_index \
                         WHERE document_id = ?1 ORDER BY ordinal LIMIT 1",
                        [document_id],
                        |row| row.get::<_, String>(0),
                    )
                };
                Ok((
                    read_root(LOCAL_SOURCE_DOCUMENT)?,
                    read_root(FOREIGN_SOURCE_DOCUMENT)?,
                ))
            })
            .expect("source roots");
        let copy_from_foreign = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![roots.1.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: FOREIGN_SOURCE_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Document {
                document_id: LOCAL_SOURCE_DOCUMENT.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let denied = module
            .apply(
                &local_context,
                transfer_request("copy-without-source-grant", copy_from_foreign.clone()),
            )
            .expect_err("foreign source requires a grant");
        assert_eq!(denied.code, CoreErrorCode::NotFound);
        let copy_foreign_page = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![FOREIGN_SOURCE_PAGE.to_owned()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: None,
            },
        };
        let denied = module
            .apply(
                &local_context,
                transfer_request("copy-page-without-source-grant", copy_foreign_page.clone()),
            )
            .expect_err("foreign Page copy requires a read grant");
        assert_eq!(denied.code, CoreErrorCode::NotFound);

        let grant = |operation_id: &str, page_id: &str, access: LibraryAccess| {
            module.apply(
                &foreign_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: page_id.to_owned(),
                        },
                        access,
                    },
                },
            )
        };
        grant(
            "grant-foreign-source-read",
            FOREIGN_SOURCE_PAGE,
            LibraryAccess::Read,
        )
        .expect("grant source read access");
        grant(
            "grant-foreign-target-write",
            FOREIGN_TARGET_PAGE,
            LibraryAccess::ReadWrite,
        )
        .expect("grant target write access");

        let copied_page = module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "copy-granted-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: copy_foreign_page,
                    },
                },
            )
            .expect("copy granted Page into the requesting Project");
        let copied_page_id = copied_page
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Page copy result")
            .copied_block_ids[FOREIGN_SOURCE_PAGE]
            .clone();

        let copied = module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "copy-from-granted-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: copy_from_foreign,
                    },
                },
            )
            .expect("copy from granted source");
        let copied_root = copied
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("copy")
            .copied_block_ids[&roots.1]
            .clone();

        let move_foreign = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![roots.1.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Document {
                document_id: FOREIGN_SOURCE_DOCUMENT.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: FOREIGN_TARGET_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let denied = module
            .apply(
                &local_context,
                transfer_request("move-with-read-source-grant", move_foreign.clone()),
            )
            .expect_err("Move requires source write access");
        assert_eq!(denied.code, CoreErrorCode::NotFound);
        grant(
            "grant-foreign-source-write",
            FOREIGN_SOURCE_PAGE,
            LibraryAccess::ReadWrite,
        )
        .expect("upgrade source write access");
        module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-between-granted-pages".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_foreign,
                    },
                },
            )
            .expect("move between granted Pages");

        let move_across_storage = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![roots.0.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: LOCAL_SOURCE_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Document {
                document_id: FOREIGN_TARGET_DOCUMENT.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-into-granted-storage".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_across_storage,
                    },
                },
            )
            .expect("move into granted storage");

        kernel
            .readers()
            .read_default(|connection| {
                let copied_project = connection.query_row(
                    "SELECT project_id FROM blocks WHERE id = ?1",
                    [&copied_root],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(copied_project, "project-1");
                let copied_page_project = connection.query_row(
                    "SELECT project_id FROM blocks WHERE id = ?1",
                    [&copied_page_id],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(copied_page_project, "project-1");
                let moved = connection.query_row(
                    "SELECT project_id, containing_document_id, lifecycle \
                     FROM blocks WHERE id = ?1",
                    [&roots.0],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                assert_eq!(
                    moved,
                    (
                        "project-2".to_owned(),
                        FOREIGN_TARGET_DOCUMENT.to_owned(),
                        "active".to_owned(),
                    )
                );
                let same_storage_ledger = connection.query_row(
                    "SELECT project_id, target_project_id FROM block_relocations WHERE id = ?1",
                    ["move-between-granted-pages"],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?;
                assert_eq!(
                    same_storage_ledger,
                    ("project-2".to_owned(), "project-2".to_owned())
                );
                let cross_storage_ledger = connection.query_row(
                    "SELECT project_id FROM block_mutations WHERE mutation_id = ?1",
                    ["move-into-granted-storage"],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(cross_storage_ledger, "project-2");
                let relocation_count = connection.query_row(
                    "SELECT count(*) FROM block_relocations WHERE id = ?1",
                    ["move-into-granted-storage"],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(relocation_count, 0);
                Ok(())
            })
            .expect("cross-storage transfer evidence");
    }

    #[test]
    fn library_target_promotes_and_wraps_document_roots_atomically() {
        const NOW: &str = "2026-07-20T00:45:00.000Z";
        const PROMOTE_PAGE: &str = "018f0000-0000-7000-8000-000000000301";
        const WRAP_PAGE: &str = "018f0000-0000-7000-8000-000000000302";
        const ANCHOR_PAGE: &str = "018f0000-0000-7000-8000-000000000303";
        const PROMOTE_DOCUMENT: &str = "document:promotion-source";
        const WRAP_DOCUMENT: &str = "document:wrapper-source";
        const ANCHOR_DOCUMENT: &str = "document:promotion-anchor";
        const PROMOTE_SIBLING: &str = "018f0000-0000-7000-8000-000000000311";
        const WRAP_SIBLING: &str = "018f0000-0000-7000-8000-000000000312";
        const WRAP_NESTED_ANCHOR: &str = "018f0000-0000-7000-8000-000000000313";
        const DATABASE: &str = "018f0000-0000-7000-8000-000000000321";
        const DATA_SOURCE: &str = "018f0000-0000-7000-8000-000000000322";
        const VIEW: &str = "018f0000-0000-7000-8000-000000000323";
        let context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:page-transformation".to_owned(),
            adapter: AdapterKind::Test,
        };
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project-1', 'library-1', 'Transform', ?1, ?1)",
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
            .expect("seed authority");
        let library = LibraryModule::new("profile-1", "library-1", &kernel);
        for (operation_id, page_id, document_id, title) in [
            (
                "create-promote-source",
                PROMOTE_PAGE,
                PROMOTE_DOCUMENT,
                "Promote",
            ),
            ("create-wrap-source", WRAP_PAGE, WRAP_DOCUMENT, "Wrap"),
            (
                "create-transform-anchor",
                ANCHOR_PAGE,
                ANCHOR_DOCUMENT,
                "Anchor",
            ),
        ] {
            library
                .apply(
                    &context,
                    ModuleApplyRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: page_id.to_owned(),
                            document_id: document_id.to_owned(),
                            title: title.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create Page");
        }
        library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "create-transform-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: DATABASE.to_owned(),
                        data_source_id: DATA_SOURCE.to_owned(),
                        view_id: VIEW.to_owned(),
                        name: "Transform target".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create Data Source target");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                    [DATABASE],
                )?;
                connection.execute(
                    "INSERT INTO projects(id, library_id, name, created, updated)
                     VALUES ('project-shared', 'library-1', 'Shared reader', ?1, ?1)",
                    [NOW],
                )?;
                connection.execute(
                    "INSERT INTO project_resource_grants(
                       id, project_id, library_id, root_kind, root_id, access,
                       recursive, revision, lifecycle, created_at, updated_at
                     ) VALUES (
                       'grant-shared-database', 'project-shared', 'library-1',
                       'database', ?1, 'read', 1, 1, 'active', ?2, ?2
                     )",
                    params![DATABASE, NOW],
                )?;
                Ok(())
            })
            .expect("bind primary Database and shared audience");
        let roots = kernel
            .readers()
            .read_default(|connection| {
                let root = |document_id: &str| {
                    connection.query_row(
                        "SELECT block_id FROM document_block_index \
                         WHERE document_id = ?1 ORDER BY ordinal LIMIT 1",
                        [document_id],
                        |row| row.get::<_, String>(0),
                    )
                };
                Ok((root(PROMOTE_DOCUMENT)?, root(WRAP_DOCUMENT)?))
            })
            .expect("source roots");
        let documents = OwnedDocumentModule::new("profile-1", "library-1", &kernel);
        let paragraph = |id: &str| {
            serde_json::json!({
                "id": id,
                "type": "paragraph",
                "props": {
                    "backgroundColor": "default",
                    "textColor": "default",
                    "textAlignment": "left"
                },
                "content": [],
                "children": []
            })
        };
        documents
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: OWNED_DOCUMENT_CONTRACT_VERSION,
                    operation_id: "shape-promote-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: OwnedDocumentIntent::ApplyOperationBatch {
                        document_id: PROMOTE_DOCUMENT.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        operations: vec![
                            ContractDocumentBlockOperation::UpdateBlock {
                                block_id: roots.0.clone(),
                                patch: DocumentBlockUpdatePatch {
                                    block_type: None,
                                    props: None,
                                    content: DocumentOptionalValue::Value {
                                        value: serde_json::json!([{
                                            "type": "text",
                                            "text": "Promoted title",
                                            "styles": { "bold": true }
                                        }]),
                                    },
                                    unset_content: false,
                                },
                            },
                            ContractDocumentBlockOperation::InsertBlock {
                                block: paragraph(PROMOTE_SIBLING),
                                parent_block_id: None,
                                before_block_id: None,
                            },
                        ],
                        actor: serde_json::json!({ "kind": "test" }),
                    },
                },
            )
            .expect("shape promotion source");
        documents
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: OWNED_DOCUMENT_CONTRACT_VERSION,
                    operation_id: "shape-wrapper-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: OwnedDocumentIntent::ApplyOperationBatch {
                        document_id: WRAP_DOCUMENT.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        operations: vec![
                            ContractDocumentBlockOperation::UpdateBlock {
                                block_id: roots.1.clone(),
                                patch: DocumentBlockUpdatePatch {
                                    block_type: Some("checkListItem".to_owned()),
                                    props: Some(BTreeMap::from([(
                                        "checked".to_owned(),
                                        serde_json::json!(true),
                                    )])),
                                    content: DocumentOptionalValue::Value {
                                        value: serde_json::json!([{
                                            "type": "text",
                                            "text": "Wrapped task",
                                            "styles": {}
                                        }]),
                                    },
                                    unset_content: false,
                                },
                            },
                            ContractDocumentBlockOperation::InsertBlock {
                                block: paragraph(WRAP_SIBLING),
                                parent_block_id: None,
                                before_block_id: None,
                            },
                            ContractDocumentBlockOperation::InsertBlock {
                                block: paragraph(WRAP_NESTED_ANCHOR),
                                parent_block_id: Some(roots.1.clone()),
                                before_block_id: None,
                            },
                        ],
                        actor: serde_json::json!({ "kind": "test" }),
                    },
                },
            )
            .expect("shape wrapper source");

        let promote_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![roots.0.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Document {
                document_id: PROMOTE_DOCUMENT.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let promoted = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "promote-root-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: promote_intent.clone(),
                    },
                },
            )
            .expect("promote root");
        let promoted_result = promoted
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("promotion result");
        assert_eq!(promoted_result.result_root_block_ids, vec![roots.0.clone()]);
        assert_eq!(promoted_result.document_commits.len(), 2);
        let promotion_commit = kernel
            .readers()
            .read_default(|connection| {
                local_commit::read_manifest(connection, promoted.committed.commit_seq)
            })
            .expect("promotion CommitManifest");
        assert_eq!(promotion_commit.physical_evidence.effect_count, 3);
        assert!(
            !promotion_commit.delivery_atoms.is_empty()
                && promotion_commit
                    .delivery_atoms
                    .iter()
                    .all(|atom| { atom.kind == DeliveryAtomKind::LibraryNavigationChanged })
        );
        assert_eq!(
            promotion_commit.identity.commit_seq,
            promoted.committed.commit_seq,
        );
        assert_eq!(
            promoted_result.transformation_evidence[0]["kind"],
            "promote"
        );
        let replayed = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "promote-root-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: promote_intent,
                    },
                },
            )
            .expect("replay promotion");
        assert!(replayed.committed.receipt.mutation.duplicate);
        assert_eq!(replayed.committed.commit_seq, promoted.committed.commit_seq);

        let wrap_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![roots.1.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: WRAP_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let wrapped = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "copy-wrapper-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: wrap_intent,
                    },
                },
            )
            .expect("copy wrapper");
        let wrapped_result = wrapped
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("wrapper result");
        let wrapper_page_id = &wrapped_result.result_root_block_ids[0];
        let copied_task_id = &wrapped_result.copied_block_ids[&roots.1];
        assert_ne!(wrapper_page_id, copied_task_id);
        assert_eq!(wrapped_result.transformation_evidence[0]["kind"], "wrap");
        assert_eq!(
            wrapped_result.transformation_evidence[0]["wrapperReason"],
            "type_requires_wrapper"
        );

        let data_source_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![roots.1.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: WRAP_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
                view_id: VIEW.to_owned(),
                group_key: Some("ship".to_owned()),
                before_page_id: None,
            },
        };
        let data_source_transfer = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "copy-wrapper-to-data-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: data_source_intent,
                    },
                },
            )
            .expect("copy wrapper to Data Source");
        let data_source_result = data_source_transfer
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Data Source transfer result");
        let data_source_page_id = data_source_result.result_root_block_ids[0].clone();
        assert_eq!(
            data_source_result.affected_database_ids,
            vec![DATABASE.to_owned()]
        );
        assert_eq!(
            data_source_result.transformation_evidence[0]["kind"],
            "wrap"
        );
        assert_eq!(
            data_source_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::DataSource {
                database_id: DATABASE.to_owned(),
                data_source_id: DATA_SOURCE.to_owned(),
            }
        );
        assert_eq!(
            data_source_result.final_location_revisions[&data_source_page_id],
            2
        );

        kernel
            .readers()
            .read_default(|connection| {
                let promoted_row = connection.query_row(
                    "SELECT block.type, block.location_kind, block.location_revision, \
                            block.metadata_revision, page.parent_kind, page.parent_id, \
                            materialization.title \
                     FROM blocks block JOIN pages page ON page.block_id = block.id \
                     JOIN document_materializations materialization ON materialization.document_id = page.document_id \
                     WHERE block.id = ?1",
                    [&roots.0],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                        ))
                    },
                )?;
                assert_eq!(
                    promoted_row,
                    (
                        "page".to_owned(),
                        "space".to_owned(),
                        2,
                        2,
                        "library".to_owned(),
                        "library-1".to_owned(),
                        "Promoted title".to_owned(),
                    )
                );
                let ordered = connection
                    .prepare(
                        "SELECT block_id FROM library_block_placements \
                         WHERE library_id = 'library-1' ORDER BY rank_key, block_id",
                    )?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let anchor_index = ordered.iter().position(|id| id == ANCHOR_PAGE).unwrap();
                assert_eq!(ordered[anchor_index - 1], *wrapper_page_id);
                assert_eq!(ordered[anchor_index - 2], roots.0);
                let copied_body = connection.query_row(
                    "SELECT materialization.block_tree_json FROM pages page \
                     JOIN document_materializations materialization ON materialization.document_id = page.document_id \
                     WHERE page.block_id = ?1",
                    [wrapper_page_id],
                    |row| row.get::<_, String>(0),
                )?;
                let copied_body: serde_json::Value =
                    serde_json::from_str(&copied_body).expect("body JSON");
                assert_eq!(copied_body[0]["id"], copied_task_id.as_str());
                assert_eq!(copied_body[0]["type"], "checkListItem");
                let source_task_present = connection.query_row(
                    "SELECT count(*) FROM document_block_index \
                     WHERE document_id = ?1 AND block_id = ?2",
                    params![WRAP_DOCUMENT, roots.1],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(source_task_present, 1);
                let data_source_evidence = connection.query_row(
                    "SELECT block.project_id, block.location_kind, block.containing_database_id, \
                            page.parent_kind, page.parent_id, membership.revision, \
                            status.value_json, status.revision, position.group_key, \
                            position.revision, projection.database_block_id, \
                            projection.view_id, \
                            (SELECT count(*) FROM library_block_placements WHERE block_id = block.id), \
                            (SELECT count(*) FROM top_level_block_placements WHERE block_id = block.id) \
                     FROM blocks block JOIN pages page ON page.block_id = block.id \
                     JOIN data_source_page_memberships membership \
                       ON membership.page_block_id = block.id AND membership.removed_at IS NULL \
                     JOIN data_source_property_values status \
                       ON status.membership_id = membership.id AND status.property_id = 'status' \
                     JOIN database_view_page_positions position \
                       ON position.page_block_id = block.id AND position.view_id = ?2 \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = ?1",
                    params![data_source_page_id, VIEW],
                    |row| {
                        Ok((
                            (
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, String>(4)?,
                                row.get::<_, i64>(5)?,
                                row.get::<_, String>(6)?,
                            ),
                            (
                                row.get::<_, i64>(7)?,
                                row.get::<_, String>(8)?,
                                row.get::<_, i64>(9)?,
                                row.get::<_, String>(10)?,
                                row.get::<_, String>(11)?,
                                row.get::<_, i64>(12)?,
                                row.get::<_, i64>(13)?,
                            ),
                        ))
                    },
                )?;
                assert_eq!(
                    data_source_evidence,
                    (
                        (
                            "project-1".to_owned(),
                            "database".to_owned(),
                            DATABASE.to_owned(),
                            "data_source".to_owned(),
                            DATA_SOURCE.to_owned(),
                            1,
                            "\"ship\"".to_owned(),
                        ),
                        (
                            2,
                            "ship".to_owned(),
                            1,
                            DATABASE.to_owned(),
                            VIEW.to_owned(),
                            0,
                            0,
                        ),
                    )
                );

                Ok(())
            })
            .expect("transformation evidence");

        let return_to_library = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let returned = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "return-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: return_to_library,
                    },
                },
            )
            .expect("return Data Source Page to Library");
        let returned_result = returned
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("return result");
        assert_eq!(returned_result.document_commits, vec![]);
        assert!(matches!(
            &returned_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::Library {
                library_id,
                project_id,
                rank_key,
            } if library_id == "library-1" && project_id == "project-1" && !rank_key.is_empty()
        ));
        assert_eq!(
            returned_result.final_location_revisions[&data_source_page_id],
            3
        );

        let return_to_data_source = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
                view_id: VIEW.to_owned(),
                group_key: Some("ship".to_owned()),
                before_page_id: None,
            },
        };
        let returned = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "return-page-to-data-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: return_to_data_source,
                    },
                },
            )
            .expect("return Library Page to Data Source");
        let returned_result = returned
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Data Source return result");
        assert_eq!(
            returned_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::DataSource {
                database_id: DATABASE.to_owned(),
                data_source_id: DATA_SOURCE.to_owned(),
            }
        );
        assert_eq!(
            returned_result.final_location_revisions[&data_source_page_id],
            4
        );
        kernel
            .readers()
            .read_default(|connection| {
                let membership = connection.query_row(
                    "SELECT revision, removed_at FROM data_source_page_memberships \
                     WHERE page_block_id = ?1 AND data_source_id = ?2",
                    params![data_source_page_id, DATA_SOURCE],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
                )?;
                assert_eq!(membership, (3, None));
                Ok(())
            })
            .expect("reactivated membership evidence");

        let move_into_page = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: ANCHOR_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let nested = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-data-source-page-into-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_into_page,
                    },
                },
            )
            .expect("move Data Source Page into Page");
        let nested_result = nested
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("nested Page result");
        assert_eq!(nested_result.document_commits.len(), 1);
        assert_eq!(
            nested_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::Document {
                document_id: ANCHOR_DOCUMENT.to_owned(),
            }
        );
        assert_eq!(
            nested_result.final_location_revisions[&data_source_page_id],
            5
        );

        let LibraryReadValue::PageLifecyclePreflight { value: nested_page } = library
            .read(
                &context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLifecyclePreflight {
                        page_id: data_source_page_id.clone(),
                    },
                },
            )
            .expect("read nested Page lifecycle authority")
            .value
        else {
            panic!("nested Page lifecycle preflight");
        };
        let nested_page = nested_page.page.expect("nested Page authority");
        let LibraryReadValue::PageLifecyclePreflight { value: host_page } = library
            .read(
                &context,
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageLifecyclePreflight {
                        page_id: ANCHOR_PAGE.to_owned(),
                    },
                },
            )
            .expect("read host Page lifecycle authority")
            .value
        else {
            panic!("host Page lifecycle preflight");
        };
        let host_page = host_page.page.expect("host Page authority");
        let nested_delete = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "delete-nested-page-lifecycle".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::DeletePage {
                            page_id: data_source_page_id.clone(),
                            expected_metadata_revision: nested_page.metadata_revision,
                            expected_parent_revision: nested_page.parent_revision,
                            parent_document_head: Some(LibraryDocumentHead {
                                document_id: ANCHOR_DOCUMENT.to_owned(),
                                generation: host_page.document.generation,
                                head_seq: host_page.document.head_seq,
                            }),
                        }),
                    },
                },
            )
            .expect("delete nested Page through typed lifecycle");
        assert_eq!(
            nested_delete
                .committed
                .value
                .page_lifecycle
                .as_ref()
                .expect("nested Page delete receipt")
                .lifecycle,
            LibraryPageLifecycleState::Deleted
        );
        let host_head_after_delete = *nested_delete
            .committed
            .receipt
            .committed_revisions
            .get(&format!("documentHead:{ANCHOR_DOCUMENT}"))
            .expect("nested Page delete host head revision");
        kernel
            .readers()
            .read_default(|connection| {
                let shell_count = connection.query_row(
                    "SELECT count(*) FROM document_block_index \
                     WHERE document_id = ?1 AND block_id = ?2",
                    params![ANCHOR_DOCUMENT, data_source_page_id],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(shell_count, 0);
                let lifecycle = connection.query_row(
                    "SELECT block.lifecycle, page.lifecycle, projection.lifecycle \
                     FROM blocks block JOIN pages page ON page.block_id = block.id \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = ?1",
                    [&data_source_page_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                assert_eq!(
                    lifecycle,
                    (
                        "deleted".to_owned(),
                        "deleted".to_owned(),
                        "deleted".to_owned()
                    )
                );
                Ok(())
            })
            .expect("nested Page lifecycle projections are deleted together");

        let nested_restore = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "restore-nested-page-lifecycle".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::RestorePage {
                            page_id: data_source_page_id.clone(),
                            delete_operation_id: "delete-nested-page-lifecycle".to_owned(),
                            expected_metadata_revision: nested_delete
                                .committed
                                .value
                                .page_lifecycle
                                .as_ref()
                                .expect("nested Page delete receipt")
                                .metadata_revision,
                            expected_parent_revision: nested_delete
                                .committed
                                .value
                                .page_lifecycle
                                .as_ref()
                                .expect("nested Page delete receipt")
                                .parent_revision,
                            membership: None,
                            before_block_id: None,
                            parent_document_head: Some(LibraryDocumentHead {
                                document_id: ANCHOR_DOCUMENT.to_owned(),
                                generation: host_page.document.generation,
                                head_seq: host_head_after_delete,
                            }),
                        }),
                    },
                },
            )
            .expect("restore nested Page through typed lifecycle");
        assert_eq!(
            nested_restore
                .committed
                .value
                .page_lifecycle
                .as_ref()
                .expect("nested Page restore receipt")
                .lifecycle,
            LibraryPageLifecycleState::Active
        );
        kernel
            .readers()
            .read_default(|connection| {
                let shell_count = connection.query_row(
                    "SELECT count(*) FROM document_block_index \
                     WHERE document_id = ?1 AND block_id = ?2",
                    params![ANCHOR_DOCUMENT, data_source_page_id],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(shell_count, 1);
                let lifecycle = connection.query_row(
                    "SELECT block.lifecycle, page.lifecycle, projection.lifecycle \
                     FROM blocks block JOIN pages page ON page.block_id = block.id \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = ?1",
                    [&data_source_page_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                assert_eq!(
                    lifecycle,
                    (
                        "active".to_owned(),
                        "active".to_owned(),
                        "active".to_owned()
                    )
                );
                Ok(())
            })
            .expect("nested Page lifecycle projections are restored together");

        let move_nested_to_library = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: ANCHOR_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let returned = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-nested-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_nested_to_library,
                    },
                },
            )
            .expect("move nested Page to Library");
        let returned_result = returned
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("nested Page Library result");
        assert_eq!(returned_result.document_commits.len(), 1);
        assert!(matches!(
            &returned_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::Library { .. }
        ));
        assert_eq!(
            returned_result.final_location_revisions[&data_source_page_id],
            8
        );
        kernel
            .readers()
            .read_default(|connection| {
                let nested_shell_count = connection.query_row(
                    "SELECT count(*) FROM document_block_index \
                     WHERE document_id = ?1 AND block_id = ?2",
                    params![ANCHOR_DOCUMENT, data_source_page_id],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(nested_shell_count, 0);
                Ok(())
            })
            .expect("nested Page shell deletion evidence");

        let move_library_page_into_document = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: WRAP_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let nested = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-library-page-into-document".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_library_page_into_document,
                    },
                },
            )
            .expect("move Library Page into Document");
        assert_eq!(
            nested
                .committed
                .value
                .block_transfer
                .as_ref()
                .expect("Library Page nesting result")
                .document_commits
                .len(),
            1
        );

        let move_between_pages = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: WRAP_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: ANCHOR_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let moved = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-page-between-documents".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_between_pages,
                    },
                },
            )
            .expect("move Page between Documents");
        let moved_result = moved
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Page-to-Page result");
        assert_eq!(moved_result.document_commits.len(), 2);
        assert_eq!(
            moved_result.final_location_revisions[&data_source_page_id],
            10
        );

        let cycle_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![ANCHOR_PAGE.to_owned()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: data_source_page_id.clone(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let cycle = library
            .apply(
                &context,
                transfer_request("reject-page-ownership-cycle", cycle_intent),
            )
            .expect_err("Page ownership cycle must fail");
        assert_eq!(cycle.code, CoreErrorCode::InvalidInput);

        let recursive_copy = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![ANCHOR_PAGE.to_owned()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: None,
            },
        };
        let copied = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "copy-recursive-page-ownership".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: recursive_copy,
                    },
                },
            )
            .expect("copy recursive Page ownership");
        let copied_result = copied
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("recursive Page copy result");
        assert!(copied_result.document_commits.len() >= 2);
        let copied_anchor = copied_result.copied_block_ids[ANCHOR_PAGE].clone();
        let copied_child = copied_result.copied_block_ids[&data_source_page_id].clone();
        assert_eq!(
            copied_result.result_root_block_ids,
            vec![copied_anchor.clone()]
        );
        assert!(matches!(
            &copied_result.final_locations[&copied_anchor],
            LibraryBlockLocation::Library { .. }
        ));
        kernel
            .readers()
            .read_default(|connection| {
                let copied_parent = connection.query_row(
                    "SELECT parent_kind, parent_id FROM pages WHERE block_id = ?1",
                    [&copied_child],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?;
                assert_eq!(copied_parent, ("page".to_owned(), copied_anchor));
                Ok(())
            })
            .expect("recursive Page copy ownership evidence");

        let nested_multi_copy = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![ANCHOR_PAGE.to_owned(), roots.0.clone()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: WRAP_PAGE.to_owned(),
                parent_block_id: Some(roots.1.clone()),
                before_block_id: Some(WRAP_NESTED_ANCHOR.to_owned()),
            },
        };
        let target_head = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT head_seq FROM documents WHERE id = ?1",
                        [WRAP_DOCUMENT],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("target Document head before copy");
        let copied = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "copy-multiple-pages-into-nested-target".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: nested_multi_copy,
                    },
                },
            )
            .expect("copy multiple Pages into nested target");
        let copied_result = copied
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("nested multi-root Page copy result");
        let copied_anchor = copied_result.copied_block_ids[ANCHOR_PAGE].clone();
        let copied_promoted = copied_result.copied_block_ids[&roots.0].clone();
        assert_eq!(
            copied_result.result_root_block_ids,
            vec![copied_anchor.clone(), copied_promoted.clone()]
        );
        assert_eq!(
            copied_result
                .document_commits
                .iter()
                .filter(|commit| commit.document_id == WRAP_DOCUMENT)
                .count(),
            1
        );
        assert!(copied_result.document_commits.iter().any(|commit| {
            commit.document_id == WRAP_DOCUMENT
                && commit.base_head_seq == target_head
                && commit.head_seq == target_head + 1
        }));
        kernel
            .readers()
            .read_default(|connection| {
                for page_id in [&copied_anchor, &copied_promoted] {
                    let page_parent = connection.query_row(
                        "SELECT parent_kind, parent_id FROM pages WHERE block_id = ?1",
                        [page_id],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )?;
                    assert_eq!(page_parent, ("page".to_owned(), WRAP_PAGE.to_owned()));
                    let document_parent = connection.query_row(
                        "SELECT parent_block_id FROM document_block_index \
                         WHERE document_id = ?1 AND block_id = ?2",
                        params![WRAP_DOCUMENT, page_id],
                        |row| row.get::<_, String>(0),
                    )?;
                    assert_eq!(document_parent, roots.1);
                }
                let nested_order = connection
                    .prepare(
                        "SELECT block_id FROM document_block_index \
                         WHERE document_id = ?1 AND parent_block_id = ?2 ORDER BY ordinal",
                    )?
                    .query_map(params![WRAP_DOCUMENT, roots.1], |row| {
                        row.get::<_, String>(0)
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert_eq!(
                    nested_order,
                    vec![
                        copied_anchor.clone(),
                        copied_promoted.clone(),
                        WRAP_NESTED_ANCHOR.to_owned()
                    ]
                );
                Ok(())
            })
            .expect("nested multi-root Page copy evidence");

        let move_to_data_source_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![WRAP_NESTED_ANCHOR.to_owned()],
            causal_dependencies: Vec::new(),
            source: LibraryBlockTransferSource::Page {
                page_id: WRAP_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
                view_id: VIEW.to_owned(),
                group_key: Some("ship".to_owned()),
                before_page_id: None,
            },
        };
        let moved = library
            .apply(
                &context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "move-wrapper-to-data-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_to_data_source_intent,
                    },
                },
            )
            .expect("move wrapper to Data Source");
        let moved_result = moved
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("moved Data Source result");
        let moved_commit = kernel
            .readers()
            .read_default(|connection| {
                local_commit::read_manifest(connection, moved.committed.commit_seq)
            })
            .expect("moved Data Source CommitManifest");
        assert_eq!(moved_result.document_commits.len(), 2);
        assert_eq!(moved_commit.physical_evidence.effect_count, 3);
        assert!(
            !moved_commit.delivery_atoms.is_empty()
                && moved_commit
                    .delivery_atoms
                    .iter()
                    .all(|atom| { atom.kind == DeliveryAtomKind::LibraryNavigationChanged })
        );
        let promoted_page_id = moved_result
            .result_root_block_ids
            .first()
            .expect("promoted Page id");
        let view_effect = moved_commit
            .projection_effects
            .iter()
            .find(|effect| {
                matches!(
                    &effect.scope.scope,
                    LocalProjectionScope::DatabaseView { project_id, view_id, .. }
                        if project_id == "project-1" && view_id == VIEW
                )
            })
            .expect("exact Database View projection effect");
        assert!(view_effect.requires_read_at_least);
        assert!(matches!(
            &view_effect.patch,
            Some(LocalProjectionPatch::DatabaseRowUpsert { row, .. })
                if &row.page_id == promoted_page_id
        ));
        let shared_effect = moved_commit
            .projection_effects
            .iter()
            .find(|effect| {
                matches!(
                    &effect.scope.scope,
                    LocalProjectionScope::DatabaseView { project_id, view_id, .. }
                        if project_id == "project-shared" && view_id == VIEW
                )
            })
            .expect("shared Project projection gain effect");
        assert!(matches!(
            &shared_effect.patch,
            Some(LocalProjectionPatch::DatabaseRowUpsert { row, .. })
                if &row.page_id == promoted_page_id
        ));
    }

    #[test]
    fn page_property_batch_commits_intrinsic_fields_and_replays_rejections() {
        const NOW: &str = "2026-07-20T12:00:00.000Z";
        const DATABASE: &str = "019c1000-0000-7000-8000-000000000001";
        const SOURCE: &str = "019c1000-0000-7000-8000-000000000002";
        const VIEW: &str = "019c1000-0000-7000-8000-000000000003";
        const PAGE: &str = "019c1000-0000-7000-8000-000000000004";
        let persistent_context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:page-property".to_owned(),
            adapter: AdapterKind::Test,
        };
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open_test(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project-1', 'library-1', 'Properties', ?1, ?1)",
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
            .expect("seed Library");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "property:create-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: DATABASE.to_owned(),
                        data_source_id: SOURCE.to_owned(),
                        view_id: VIEW.to_owned(),
                        name: "Tasks".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create Database");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                    [DATABASE],
                )?;
                Ok(())
            })
            .expect("bind Database");
        module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "property:create-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageLifecycle {
                        mutation: Box::new(LibraryPageLifecycleMutation::CreatePage {
                            page_id: PAGE.to_owned(),
                            title: "Property Page".to_owned(),
                            rich_title: None,
                            nfm: String::new(),
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
                            data_source_id: SOURCE.to_owned(),
                            tag_option_ids: vec!["o_AAAAAAAA".to_owned()],
                            new_tag_options: vec![LibraryPageLifecycleTagOption {
                                option_id: "o_AAAAAAAA".to_owned(),
                                name: "Native".to_owned(),
                            }],
                            expected_tags_property_revision: 1,
                        }),
                    },
                },
            )
            .expect("create Page");
        let request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "property:mixed".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::ApplyBlockPropertyMutation {
                mutation: Box::new(LibraryBlockPropertyMutation {
                    actor: serde_json::json!({ "kind": "test" }),
                    client_session_id: Some("session:property".to_owned()),
                    fields: vec![
                        LibraryBlockPropertyFieldMutation::IntrinsicSet {
                            block_id: PAGE.to_owned(),
                            property_key: "run.target".to_owned(),
                            expected_revision: 1,
                            value: serde_json::json!("cloud"),
                        },
                        LibraryBlockPropertyFieldMutation::IntrinsicSet {
                            block_id: PAGE.to_owned(),
                            property_key: "run.localPath".to_owned(),
                            expected_revision: 1,
                            value: serde_json::json!("/tmp/nodex"),
                        },
                    ],
                }),
            },
        };
        let committed = module
            .apply(&persistent_context, request.clone())
            .expect("commit mixed Properties");
        let receipt = committed
            .committed
            .value
            .block_property_mutation
            .as_ref()
            .expect("Property receipt");
        let LibraryBlockPropertyMutationOutcome::Committed {
            fields,
            block_metadata_revisions,
        } = &receipt.outcome
        else {
            panic!("Property mutation committed")
        };
        assert_eq!(fields.len(), 2);
        assert_eq!(block_metadata_revisions.get(PAGE), Some(&2));
        assert!(committed.event.is_some());
        assert_eq!(committed.committed.receipt.operation_kind, "property_batch");
        let replay = module
            .apply(&persistent_context, request)
            .expect("replay mixed Properties");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert!(replay.event.is_none());

        let rejected_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "property:conflict".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::ApplyBlockPropertyMutation {
                mutation: Box::new(LibraryBlockPropertyMutation {
                    actor: serde_json::json!({ "kind": "test" }),
                    client_session_id: None,
                    fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                        block_id: PAGE.to_owned(),
                        property_key: "run.target".to_owned(),
                        expected_revision: 1,
                        value: serde_json::json!("newWorktree"),
                    }],
                }),
            },
        };
        let rejected = module
            .apply(&persistent_context, rejected_request.clone())
            .expect("conflict has a durable rejected outcome");
        assert_eq!(
            rejected.committed.receipt.commit_seq,
            rejected.committed.commit_seq
        );
        let rejected_receipt = rejected
            .committed
            .value
            .block_property_mutation
            .as_ref()
            .expect("rejection receipt");
        assert!(matches!(
            &rejected_receipt.outcome,
            LibraryBlockPropertyMutationOutcome::Rejected { error }
                if error.code == LibraryBlockPropertyMutationErrorCode::PropertyConflict
                    && error.expected_revision == Some(1)
                    && error.actual_revision == Some(2)
        ));
        assert!(rejected.event.is_none());

        let unrelated = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "property:after-conflict".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyBlockPropertyMutation {
                        mutation: Box::new(LibraryBlockPropertyMutation {
                            actor: serde_json::json!({ "kind": "test" }),
                            client_session_id: None,
                            fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                                block_id: PAGE.to_owned(),
                                property_key: "run.target".to_owned(),
                                expected_revision: 2,
                                value: serde_json::json!("localProject"),
                            }],
                        }),
                    },
                },
            )
            .expect("commit unrelated Property after rejection");
        assert!(unrelated.committed.commit_seq > rejected.committed.commit_seq);
        let rejected_replay = module
            .apply(&persistent_context, rejected_request)
            .expect("replay conflict after unrelated commit");
        assert_eq!(
            rejected_replay.committed.commit_seq,
            rejected.committed.commit_seq
        );
        assert_eq!(
            rejected_replay.committed.store_epoch,
            rejected.committed.store_epoch
        );
        assert!(rejected_replay.committed.receipt.mutation.duplicate);
        assert!(rejected_replay.event.is_none());

        let invalid_actor_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "property:invalid-actor".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::ApplyBlockPropertyMutation {
                mutation: Box::new(LibraryBlockPropertyMutation {
                    actor: serde_json::json!("spoofed"),
                    client_session_id: None,
                    fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                        block_id: PAGE.to_owned(),
                        property_key: "run.target".to_owned(),
                        expected_revision: 3,
                        value: serde_json::json!("localProject"),
                    }],
                }),
            },
        };
        let invalid_actor = module
            .apply(&persistent_context, invalid_actor_request.clone())
            .expect("invalid actor has a durable rejected outcome");
        assert!(matches!(
            invalid_actor
                .committed
                .value
                .block_property_mutation
                .as_ref()
                .map(|receipt| &receipt.outcome),
            Some(LibraryBlockPropertyMutationOutcome::Rejected { error })
                if error.code
                    == LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest
        ));
        assert!(invalid_actor.event.is_none());
        let invalid_actor_replay = module
            .apply(&persistent_context, invalid_actor_request)
            .expect("invalid actor rejection replays");
        assert!(invalid_actor_replay.committed.receipt.mutation.duplicate);

        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT block.metadata_revision, intrinsic.value_json, intrinsic.revision, \
                       local_path.value_json, local_path.revision, \
                       (SELECT count(*) FROM change_log WHERE operation_id = 'property:mixed'), \
                       (SELECT count(*) FROM change_log WHERE operation_id = 'property:conflict'), \
                       (SELECT outcome FROM block_mutations WHERE mutation_id = 'property:conflict') \
                     FROM blocks block \
                     JOIN block_properties intrinsic ON intrinsic.block_id = block.id \
                       AND intrinsic.property_key = 'run.target' \
                     JOIN block_properties local_path ON local_path.block_id = block.id \
                       AND local_path.property_key = 'run.localPath' \
                     WHERE block.id = ?1",
                    [PAGE],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, String>(7)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        3,
                        "\"localProject\"".to_owned(),
                        3,
                        "\"/tmp/nodex\"".to_owned(),
                        2,
                        1,
                        0,
                        "rejected".to_owned(),
                    )
                );
                let property_ledger_cursors = connection.query_row(
                    "SELECT change_log_seq, json_extract(result_json, '$.commitSeq') \
                     FROM block_mutations WHERE mutation_id = 'property:mixed'",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )?;
                assert_eq!(
                    property_ledger_cursors,
                    (
                        committed.committed.event_sequence,
                        committed.committed.receipt.commit_seq,
                    )
                );
                let invalid_actor_ledger = connection.query_row(
                    "SELECT outcome, actor_json FROM block_mutations \
                     WHERE mutation_id = 'property:invalid-actor'",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?;
                assert_eq!(
                    invalid_actor_ledger,
                    ("rejected".to_owned(), "{}".to_owned())
                );
                Ok(())
            })
            .expect("Property authority evidence");

        let metadata_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "property:metadata-orchestration".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::ApplyPageMetadataProperties {
                database_intents: vec![DatabaseIntent::EditPropertyValues {
                    edits: [
                        ("scheduled_start", "2026-07-21T01:00:00.000Z"),
                        ("scheduled_end", "2026-07-21T02:00:00.000Z"),
                    ]
                    .into_iter()
                    .map(|(property_id, value)| DatabasePropertyValueMutation {
                        address: DatabasePagePropertyAddress {
                            page_id: PAGE.to_owned(),
                            data_source_id: SOURCE.to_owned(),
                            property_id: property_id.to_owned(),
                        },
                        edit: DatabasePropertyValueEdit::Replace {
                            expected_value_revision: 1,
                            value: DatabasePropertyValueInput::Datetime {
                                value: value.to_owned(),
                            },
                        },
                    })
                    .collect(),
                }],
                intrinsic_mutation: Box::new(LibraryBlockPropertyMutation {
                    actor: serde_json::json!({ "kind": "test" }),
                    client_session_id: None,
                    fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                        block_id: PAGE.to_owned(),
                        property_key: "schedule.isAllDay".to_owned(),
                        expected_revision: 1,
                        value: serde_json::json!(true),
                    }],
                }),
            },
        };
        let metadata = module
            .apply(&persistent_context, metadata_request.clone())
            .expect("commit atomic Page metadata Properties");
        assert!(metadata.event.is_some());
        let replay = module
            .apply(&persistent_context, metadata_request)
            .expect("replay atomic Page metadata Properties");
        assert!(replay.committed.receipt.mutation.duplicate);

        let arbitrary_database_intent = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "property:metadata-arbitrary-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageMetadataProperties {
                        database_intents: vec![DatabaseIntent::DeleteView {
                            database_id: DATABASE.to_owned(),
                            view_id: VIEW.to_owned(),
                            expected_revision: 1,
                        }],
                        intrinsic_mutation: Box::new(LibraryBlockPropertyMutation {
                            actor: serde_json::json!({ "kind": "test" }),
                            client_session_id: None,
                            fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                                block_id: PAGE.to_owned(),
                                property_key: "schedule.isAllDay".to_owned(),
                                expected_revision: 2,
                                value: serde_json::json!(false),
                            }],
                        }),
                    },
                },
            )
            .expect_err("Page metadata orchestration rejects schema and View intents");
        assert_eq!(arbitrary_database_intent.code, CoreErrorCode::InvalidInput);

        let collision_database_intents = vec![DatabaseIntent::EditPropertyValues {
            edits: vec![DatabasePropertyValueMutation {
                address: DatabasePagePropertyAddress {
                    page_id: PAGE.to_owned(),
                    data_source_id: SOURCE.to_owned(),
                    property_id: "scheduled_end".to_owned(),
                },
                edit: DatabasePropertyValueEdit::Replace {
                    expected_value_revision: 2,
                    value: DatabasePropertyValueInput::Datetime {
                        value: "2026-07-21T04:00:00.000Z".to_owned(),
                    },
                },
            }],
        }];
        DatabaseModule::new("profile-1", "library-1", &kernel)
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "property:metadata-cross-module-collision".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: collision_database_intents.clone(),
                },
            )
            .expect("persist an independent Database receipt");
        let cross_module_collision = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "property:metadata-cross-module-collision".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageMetadataProperties {
                        database_intents: collision_database_intents,
                        intrinsic_mutation: Box::new(LibraryBlockPropertyMutation {
                            actor: serde_json::json!({ "kind": "test" }),
                            client_session_id: None,
                            fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                                block_id: PAGE.to_owned(),
                                property_key: "schedule.isAllDay".to_owned(),
                                expected_revision: 2,
                                value: serde_json::json!(false),
                            }],
                        }),
                    },
                },
            )
            .expect_err("Library cannot claim an independent Database receipt");
        assert_eq!(
            cross_module_collision.code,
            CoreErrorCode::IdempotencyKeyReused
        );

        let rejected_metadata = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "property:metadata-rollback".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyPageMetadataProperties {
                        database_intents: vec![DatabaseIntent::EditPropertyValues {
                            edits: vec![DatabasePropertyValueMutation {
                                address: DatabasePagePropertyAddress {
                                    page_id: PAGE.to_owned(),
                                    data_source_id: SOURCE.to_owned(),
                                    property_id: "scheduled_start".to_owned(),
                                },
                                edit: DatabasePropertyValueEdit::Replace {
                                    expected_value_revision: 2,
                                    value: DatabasePropertyValueInput::Datetime {
                                        value: "2026-07-21T01:30:00.000Z".to_owned(),
                                    },
                                },
                            }],
                        }],
                        intrinsic_mutation: Box::new(LibraryBlockPropertyMutation {
                            actor: serde_json::json!({ "kind": "test" }),
                            client_session_id: None,
                            fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                                block_id: PAGE.to_owned(),
                                property_key: "schedule.timezone".to_owned(),
                                expected_revision: 1,
                                value: serde_json::json!(42),
                            }],
                        }),
                    },
                },
            )
            .expect_err("invalid intrinsic metadata rolls back Database edits");
        assert_eq!(rejected_metadata.code, CoreErrorCode::InvalidInput);
        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT start.value_json, start.revision, all_day.value_json, all_day.revision, \
                       (SELECT count(*) FROM core_module_receipts \
                         WHERE operation_id = 'property:metadata-rollback') \
                     FROM data_source_page_memberships membership \
                     JOIN data_source_property_values start ON start.membership_id = membership.id \
                       AND start.data_source_id = membership.data_source_id \
                       AND start.property_id = 'scheduled_start' \
                     JOIN block_properties all_day ON all_day.block_id = membership.page_block_id \
                       AND all_day.property_key = 'schedule.isAllDay' \
                     WHERE membership.page_block_id = ?1 AND membership.removed_at IS NULL",
                    [PAGE],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        "\"2026-07-21T01:00:00.000Z\"".to_owned(),
                        2,
                        "true".to_owned(),
                        2,
                        0,
                    )
                );
                Ok(())
            })
            .expect("atomic Page metadata evidence");

        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET lifecycle = 'archived' WHERE id = 'project-1'",
                    [],
                )?;
                Ok(())
            })
            .expect("archive compatibility storage Project");
        let mut library_context = persistent_context.clone();
        library_context.project_id = None;
        let property_write = module
            .apply(
                &library_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "property:library-authority".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ApplyBlockPropertyMutation {
                        mutation: Box::new(LibraryBlockPropertyMutation {
                            actor: serde_json::json!({ "kind": "test" }),
                            client_session_id: None,
                            fields: vec![LibraryBlockPropertyFieldMutation::IntrinsicSet {
                                block_id: PAGE.to_owned(),
                                property_key: "run.target".to_owned(),
                                expected_revision: 3,
                                value: serde_json::json!("cloud"),
                            }],
                        }),
                    },
                },
            )
            .expect("Library authority writes Properties without an active Project");
        assert!(matches!(
            property_write
                .committed
                .value
                .block_property_mutation
                .as_ref()
                .map(|receipt| &receipt.outcome),
            Some(LibraryBlockPropertyMutationOutcome::Committed { .. })
        ));
    }
}
pub(crate) mod agent_authorization;
mod agent_page_create;
mod agent_page_move;
mod agent_page_write;
mod agent_search;
mod block_transfer;
pub use block_transfer::BlockTransferMetrics;
mod authorization;
mod canvas_mutation;
mod content;
mod content_rehome;
pub(crate) mod cursor;
mod history;
pub(crate) use authorization::page_grant_ownership_proof;
pub(crate) use history::{
    page_read_authorization_roots, require_page_read_access, require_page_write_access,
};
pub(crate) use page_copy::{OccurrencePageCloneInput, clone_page_for_occurrence};
mod mutation;
mod navigation;
mod page_copy;
pub(crate) mod page_genesis;
mod page_lifecycle;
mod page_lifecycle_mutation;
mod page_property_mutation;
mod page_write_semantic;
