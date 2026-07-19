mod backup;

#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, TryLockError};

use nodex_core_contracts::administration::{
    SchemaOwner, StoreAdministrationCommitValue, StoreAdministrationEvent,
    StoreAdministrationEventKind, StoreAdministrationIntent, StoreAdministrationRead,
    StoreAdministrationReadValue, StoreAdministrationReceipt, StoreIntegrity, StoreReadiness,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent,
    CommittedModuleValue, CoreError, CoreErrorCode, CoreErrorRecovery, CoreModuleEventPayload,
    ModuleApplyRequest, ModuleMutationReceipt, ModuleReadRequest, ModuleReadSnapshot, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

const MODULE_NAME: &str = "store_administration";
const MAX_OPERATION_ID_BYTES: usize = 512;
const MAX_LABEL_CHARS: usize = 512;

#[derive(Clone, Debug)]
pub struct StoreAdministrationApplyOutcome {
    pub committed: CommittedModuleValue<StoreAdministrationCommitValue, StoreAdministrationReceipt>,
    pub event: Option<CommittedCoreModuleEvent>,
}

#[derive(Clone, Debug)]
struct ActiveOperation {
    operation_id: String,
    phase: String,
}

#[derive(Clone, Debug)]
struct RuntimeState {
    active: Option<ActiveOperation>,
    integrity: StoreIntegrity,
}

pub struct StoreAdministrationModule {
    profile_id: String,
    library_id: String,
    profile_home: Option<PathBuf>,
    readers: Option<StoreReaders>,
    writer: Option<StoreWriter>,
    operation_lock: Arc<Mutex<()>>,
    runtime: Arc<Mutex<RuntimeState>>,
}

impl StoreAdministrationModule {
    pub fn new(
        profile_id: impl Into<String>,
        library_id: impl Into<String>,
        kernel: &SqliteStoreKernel,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            library_id: library_id.into(),
            profile_home: kernel.database_path().parent().map(PathBuf::from),
            readers: Some(kernel.readers()),
            writer: Some(kernel.writer()),
            operation_lock: Arc::new(Mutex::new(())),
            runtime: Arc::new(Mutex::new(RuntimeState {
                active: None,
                integrity: StoreIntegrity::Unknown,
            })),
        }
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<StoreAdministrationRead>,
    ) -> Result<ModuleReadSnapshot<StoreAdministrationReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid("unsupported Store Administration contract version"));
        }
        let Some(readers) = &self.readers else {
            return Err(unavailable(
                "Store Administration Module has no durable store",
            ));
        };
        let Some(profile_home) = &self.profile_home else {
            return Err(unavailable(
                "Store Administration Module has no managed Profile home",
            ));
        };
        let operation_guard = if matches!(request.read, StoreAdministrationRead::Backups) {
            Some(
                self.operation_lock
                    .lock()
                    .map_err(|_| unavailable("Store Administration operation lock failed"))?,
            )
        } else {
            None
        };
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        let profile_home = profile_home.clone();
        let runtime = Arc::clone(&self.runtime);
        let snapshot = readers
            .read_default(move |connection| {
                let transaction = connection.unchecked_transaction()?;
                assert_identity(&transaction, &profile_id, &library_id)?;
                let (store_epoch, event_head) = transaction.query_row(
                    "SELECT metadata.store_epoch, (SELECT COALESCE(max(seq), 0) FROM change_log) \
                     FROM block_store_metadata metadata WHERE metadata.id = 1",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )?;
                let value = match request.read {
                    StoreAdministrationRead::Status => {
                        let schema_version =
                            transaction
                                .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?;
                        let schema_owner = transaction.query_row(
                            "SELECT schema_owner FROM core_store_metadata WHERE id = 1",
                            [],
                            |row| row.get::<_, String>(0),
                        )?;
                        if schema_owner != "rust_core" {
                            return Err(corrupt("Store schema owner is not Rust Core"));
                        }
                        let state = runtime.lock().map_err(|_| {
                            internal("Store Administration runtime state lock failed")
                        })?;
                        StoreAdministrationReadValue::Status {
                            readiness: if state.active.is_some() {
                                StoreReadiness::Maintenance
                            } else {
                                StoreReadiness::Ready
                            },
                            schema_version,
                            schema_owner: SchemaOwner::Rust,
                            integrity: state.integrity,
                        }
                    }
                    StoreAdministrationRead::Backups => StoreAdministrationReadValue::Backups {
                        items: backup::list_backups(&profile_home)?,
                    },
                    StoreAdministrationRead::MaintenanceStatus => {
                        let state = runtime.lock().map_err(|_| {
                            internal("Store Administration runtime state lock failed")
                        })?;
                        StoreAdministrationReadValue::MaintenanceStatus {
                            active: state.active.is_some(),
                            operation_id: state
                                .active
                                .as_ref()
                                .map(|operation| operation.operation_id.clone()),
                            phase: state
                                .active
                                .as_ref()
                                .map(|operation| operation.phase.clone()),
                        }
                    }
                };
                transaction.commit()?;
                Ok(ModuleReadSnapshot {
                    version: CORE_CONTRACT_VERSION,
                    store_epoch: StoreEpoch(store_epoch),
                    event_head,
                    value,
                })
            })
            .map_err(core_error);
        drop(operation_guard);
        snapshot
    }

    pub fn apply(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<StoreAdministrationIntent>,
    ) -> Result<StoreAdministrationApplyOutcome, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid("unsupported Store Administration contract version"));
        }
        require_private_adapter(context)?;
        validate_operation_id(&request.operation_id)?;
        let normalized_label = match &request.intent {
            StoreAdministrationIntent::CreateBackup { label, .. } => normalize_label(label)?,
            StoreAdministrationIntent::RestoreBackup { .. }
            | StoreAdministrationIntent::DeleteBackup { .. }
            | StoreAdministrationIntent::PruneBackups { .. }
            | StoreAdministrationIntent::RunMaintenance { .. } => {
                return Err(unavailable(
                    "This Store Administration operation is not available in the online-backup slice",
                ));
            }
        };
        let operation_guard = match self.operation_lock.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => return Err(maintenance_in_progress()),
            Err(TryLockError::Poisoned(_)) => {
                return Err(unavailable("Store Administration operation lock failed"));
            }
        };
        self.set_active(&request.operation_id, "online_backup")?;
        let result = self.apply_create_backup(context, request, normalized_label);
        self.clear_active();
        drop(operation_guard);
        result
    }

    fn apply_create_backup(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<StoreAdministrationIntent>,
        normalized_label: Option<String>,
    ) -> Result<StoreAdministrationApplyOutcome, CoreError> {
        let Some(writer) = &self.writer else {
            return Err(unavailable(
                "Store Administration Module has no durable writer",
            ));
        };
        let Some(profile_home) = &self.profile_home else {
            return Err(unavailable(
                "Store Administration Module has no managed Profile home",
            ));
        };
        let StoreAdministrationIntent::CreateBackup { include_assets, .. } = request.intent else {
            unreachable!("apply validates the Store Administration intent")
        };
        let fingerprint = serde_json::to_vec(&(
            &self.profile_id,
            &self.library_id,
            request.version,
            &request.store_epoch,
            &normalized_label,
            include_assets,
        ))
        .map_err(|_| unavailable("Store Administration request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        let context = context.clone();
        let profile_home = profile_home.clone();
        let operation_id = request.operation_id;
        let requested_store_epoch = request.store_epoch;
        let outcome = writer
            .call(move |connection| {
                assert_identity(connection, &profile_id, &library_id)?;
                let store_epoch = read_store_epoch(connection)?;
                if requested_store_epoch.0 != store_epoch {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "Store Administration mutation targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(stored) = read_module_receipt(connection, MODULE_NAME, &operation_id)? {
                    if stored.request_hash != request_hash {
                        return Err(StoreError::new(
                            StoreErrorCode::IdempotencyKeyReused,
                            "operation_id is already bound to another Store Administration intent",
                            false,
                        ));
                    }
                    let mut committed = serde_json::from_value::<
                        CommittedModuleValue<
                            StoreAdministrationCommitValue,
                            StoreAdministrationReceipt,
                        >,
                    >(stored.result)
                    .map_err(|_| corrupt("Stored Store Administration receipt is invalid"))?;
                    committed.receipt.mutation.duplicate = true;
                    return Ok(StoreAdministrationApplyOutcome {
                        committed,
                        event: None,
                    });
                }
                let record = backup::create_backup(
                    connection,
                    &profile_home,
                    &profile_id,
                    &operation_id,
                    &request_hash,
                    normalized_label.as_deref(),
                    include_assets,
                )?;
                finish_backup_creation(
                    connection,
                    &library_id,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    &record.backup_id,
                    &record.created_at,
                )
            })
            .map_err(core_error)?;
        if let Ok(mut state) = self.runtime.lock() {
            state.integrity = StoreIntegrity::Ok;
        }
        Ok(outcome)
    }

    fn validate_context(&self, context: &BoundModuleContext) -> Result<(), CoreError> {
        if context.profile_id.0 == self.profile_id && context.library_id.0 == self.library_id {
            return Ok(());
        }
        Err(CoreError {
            code: CoreErrorCode::Unauthorized,
            message: "bound Adapter identity does not match this Store Administration Module"
                .to_owned(),
            retryable: false,
            recovery: CoreErrorRecovery::None,
        })
    }

    fn set_active(&self, operation_id: &str, phase: &str) -> Result<(), CoreError> {
        let mut state = self
            .runtime
            .lock()
            .map_err(|_| unavailable("Store Administration runtime state lock failed"))?;
        state.active = Some(ActiveOperation {
            operation_id: operation_id.to_owned(),
            phase: phase.to_owned(),
        });
        Ok(())
    }

    fn clear_active(&self) {
        if let Ok(mut state) = self.runtime.lock() {
            state.active = None;
        }
    }
}

impl Default for StoreAdministrationModule {
    fn default() -> Self {
        Self {
            profile_id: "probe-profile".to_owned(),
            library_id: "probe-library".to_owned(),
            profile_home: None,
            readers: None,
            writer: None,
            operation_lock: Arc::new(Mutex::new(())),
            runtime: Arc::new(Mutex::new(RuntimeState {
                active: None,
                integrity: StoreIntegrity::Unknown,
            })),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn finish_backup_creation(
    connection: &mut Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
    backup_id: &str,
    committed_at: &str,
) -> Result<StoreAdministrationApplyOutcome, StoreError> {
    with_immediate_transaction(connection, |transaction| {
        let payload = json!({
            "module": MODULE_NAME,
            "operationKind": "create_backup",
            "kind": "store_administration_changed",
            "backupIds": [backup_id],
            "readinessChanged": false,
        });
        let event_project_id = transaction
            .query_row(
                "SELECT id FROM projects WHERE library_id = ?1 \
                 ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, created, id LIMIT 1",
                [library_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let event_sequence = if let Some(project_id) = event_project_id.as_deref() {
            transaction.execute(
                "INSERT INTO change_log(\
                   project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
                   database_block_ids_json, payload_json, committed_at\
                 ) VALUES (?1, ?2, 'store_administration.changed', ?3, '[]', '[]', '[]', ?4, ?5)",
                params![
                    project_id,
                    store_epoch,
                    operation_id,
                    payload.to_string(),
                    committed_at
                ],
            )?;
            transaction.last_insert_rowid()
        } else {
            transaction.query_row("SELECT COALESCE(max(seq), 0) FROM change_log", [], |row| {
                row.get::<_, i64>(0)
            })?
        };
        let committed = CommittedModuleValue {
            value: StoreAdministrationCommitValue {
                backup_id: Some(backup_id.to_owned()),
                safety_backup_id: None,
                completed_tasks: Vec::new(),
            },
            receipt: StoreAdministrationReceipt {
                mutation: ModuleMutationReceipt {
                    operation_id: operation_id.to_owned(),
                    duplicate: false,
                },
                backup_id: Some(backup_id.to_owned()),
                safety_backup_id: None,
            },
            event_sequence,
            store_epoch: StoreEpoch(store_epoch.to_owned()),
        };
        let result = serde_json::to_value(&committed)
            .map_err(|_| internal("Store Administration receipt could not be encoded"))?;
        insert_module_receipt(
            transaction,
            NewModuleReceipt {
                module_name: MODULE_NAME,
                operation_id,
                context,
                operation_kind: "create_backup",
                store_epoch,
                request_hash,
                result: &result,
                event_sequence: (event_project_id.is_some()).then_some(event_sequence),
                committed_at,
            },
        )?;
        let event = event_project_id.map(|_| CommittedCoreModuleEvent {
            version: CORE_CONTRACT_VERSION,
            sequence: event_sequence,
            store_epoch: StoreEpoch(store_epoch.to_owned()),
            operation_id: Some(operation_id.to_owned()),
            committed_at: committed_at.to_owned(),
            payload: CoreModuleEventPayload::StoreAdministration(StoreAdministrationEvent {
                kind: StoreAdministrationEventKind::StoreAdministrationChanged,
                operation: "create_backup".to_owned(),
                backup_ids: vec![backup_id.to_owned()],
                readiness_changed: false,
            }),
        });
        Ok(StoreAdministrationApplyOutcome { committed, event })
    })
}

fn assert_identity(
    connection: &Connection,
    profile_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    let identity = connection
        .query_row(
            "SELECT 1 FROM libraries WHERE id = ?1 AND profile_id = ?2",
            params![library_id, profile_id],
            |_| Ok(()),
        )
        .optional()?;
    if identity.is_some() {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::Unauthorized,
        "bound Store Administration identity is not present in this Profile store",
        false,
    ))
}

fn read_store_epoch(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Profile store epoch is unavailable"))
}

fn require_private_adapter(context: &BoundModuleContext) -> Result<(), CoreError> {
    if matches!(
        context.adapter,
        AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
    ) {
        return Ok(());
    }
    Err(CoreError {
        code: CoreErrorCode::Unauthorized,
        message: "Store Administration mutations require a private trusted Adapter".to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    })
}

fn normalize_label(label: &Option<String>) -> Result<Option<String>, CoreError> {
    let normalized = label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if normalized.is_some_and(|value| value.chars().count() > MAX_LABEL_CHARS) {
        return Err(invalid("backup label exceeds its character bound"));
    }
    Ok(normalized.map(str::to_owned))
}

fn validate_operation_id(operation_id: &str) -> Result<(), CoreError> {
    if operation_id.is_empty() || operation_id.len() > MAX_OPERATION_ID_BYTES {
        return Err(invalid("operation_id is empty or exceeds its byte bound"));
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
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
        StoreErrorCode::UnsupportedSchema
        | StoreErrorCode::AlreadyOwned
        | StoreErrorCode::InvalidProfile
        | StoreErrorCode::RuntimeIncompatible => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        StoreErrorCode::WriterQueueFull
        | StoreErrorCode::WriterClosed
        | StoreErrorCode::ReaderPoolTimeout
        | StoreErrorCode::QueryCancelled
        | StoreErrorCode::SqliteBusy
        | StoreErrorCode::SqliteFailure
        | StoreErrorCode::Internal => CoreErrorCode::CoreUnavailable,
    };
    CoreError {
        code,
        message: error.message,
        retryable: error.retryable,
        recovery: CoreErrorRecovery::None,
    }
}

fn maintenance_in_progress() -> CoreError {
    CoreError {
        code: CoreErrorCode::MaintenanceInProgress,
        message: "Another Store Administration operation is already active".to_owned(),
        retryable: true,
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

fn unavailable(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::CoreUnavailable,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
