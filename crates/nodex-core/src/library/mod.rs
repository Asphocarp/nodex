use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use nodex_core_contracts::library::{
    LibraryCommitValue, LibraryEvent, LibraryEventKind, LibraryIntent, LibraryRead,
    LibraryReadValue, LibraryReceipt, LibraryResourceTarget,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreError, CoreErrorCode, CoreErrorRecovery, CoreModuleEventPayload, ModuleApplyRequest,
    ModuleMutationReceipt, ModuleReadRequest, ModuleReadSnapshot, StoreEpoch,
};

#[derive(Clone, Debug)]
pub struct LibraryApplyOutcome {
    pub committed: CommittedModuleValue<LibraryCommitValue, LibraryReceipt>,
    pub event: Option<CommittedCoreModuleEvent>,
}

#[derive(Clone)]
struct AppliedOperation {
    fingerprint: Vec<u8>,
    committed: CommittedModuleValue<LibraryCommitValue, LibraryReceipt>,
}

#[derive(Default)]
struct LibraryState {
    event_head: i64,
    operations: HashMap<String, AppliedOperation>,
    grants: BTreeMap<(String, String), String>,
}

pub struct LibraryModule {
    profile_id: String,
    library_id: String,
    store_epoch: StoreEpoch,
    state: Mutex<LibraryState>,
}

impl LibraryModule {
    pub fn tracer(profile_id: String, library_id: String, store_epoch: StoreEpoch) -> Self {
        Self {
            profile_id,
            library_id,
            store_epoch,
            state: Mutex::new(LibraryState::default()),
        }
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<LibraryRead>,
    ) -> Result<ModuleReadSnapshot<LibraryReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid_input("unsupported Library contract version"));
        }

        let state = self.state.lock().expect("Library tracer mutex poisoned");
        let value = match request.read {
            LibraryRead::Metadata => LibraryReadValue::Metadata {
                profile_id: self.profile_id.clone(),
                library_id: self.library_id.clone(),
                change_log_seq: state.event_head,
            },
            _ => {
                return Err(invalid_input(
                    "the Milestone 1 tracer supports metadata reads only",
                ));
            }
        };

        Ok(ModuleReadSnapshot {
            version: CORE_CONTRACT_VERSION,
            store_epoch: self.store_epoch.clone(),
            event_head: state.event_head,
            value,
        })
    }

    pub fn apply(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<LibraryIntent>,
    ) -> Result<LibraryApplyOutcome, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid_input("unsupported Library contract version"));
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
            context,
            request.version,
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

        state.event_head += 1;
        let event_sequence = state.event_head;
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
            change_log_seq: event_sequence,
            committed_at: committed_at.clone(),
        };
        let committed = CommittedModuleValue {
            value: LibraryCommitValue {
                affected_resource_ids: vec![resource_id],
            },
            receipt,
            event_sequence,
            store_epoch: self.store_epoch.clone(),
        };
        let event = CommittedCoreModuleEvent {
            version: CORE_CONTRACT_VERSION,
            sequence: event_sequence,
            store_epoch: self.store_epoch.clone(),
            operation_id: Some(request.operation_id.clone()),
            committed_at,
            payload: CoreModuleEventPayload::Library(LibraryEvent {
                kind: LibraryEventKind::LibraryChanged,
                page_ids: affected_page_ids,
                database_ids: affected_database_ids,
                parent_keys: Vec::new(),
            }),
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

fn resource_id(target: &LibraryResourceTarget) -> String {
    match target {
        LibraryResourceTarget::Page { page_id } => page_id.clone(),
        LibraryResourceTarget::Database { database_id } => database_id.clone(),
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
    use nodex_core_contracts::library::LibraryAccess;
    use nodex_core_contracts::{AdapterKind, LibraryId, ProfileId};

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

    fn request(operation_id: &str, page_id: &str) -> ModuleApplyRequest<LibraryIntent> {
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
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

    #[test]
    fn tracer_mints_receipt_and_event_once_for_an_exact_retry() {
        let module = LibraryModule::tracer(
            "profile-1".to_owned(),
            "library-1".to_owned(),
            StoreEpoch("epoch-1".to_owned()),
        );

        let first = module.apply(&context(), request("operation-1", "page-1"));
        let replay = module.apply(&context(), request("operation-1", "page-1"));

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
}
