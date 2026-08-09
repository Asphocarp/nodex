mod backup;
mod operation_journal;
mod restore;

#[cfg(test)]
mod tests;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, TryLockError};

use nodex_core_contracts::administration::{
    BackupRecord, MaintenanceTask, SchemaOwner, StoreAdministrationCommitValue,
    StoreAdministrationEvent, StoreAdministrationEventKind, StoreAdministrationIntent,
    StoreAdministrationRead, StoreAdministrationReadValue, StoreAdministrationReceipt,
    StoreIntegrity, StoreReadiness,
};
use nodex_core_contracts::collection::{
    CollectionWindow, CollectionWindowAuthority, CollectionWindowRequest,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CommittedCoreModuleEvent, CoreError, CoreErrorCode,
    CoreErrorRecovery, ModuleApplyRequest, ModuleMutationReceipt, ModuleName, ModuleReadRequest,
    ModuleReadSnapshot, STORE_ADMINISTRATION_CONTRACT_VERSION, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::infrastructure::collection_window::{WindowCandidate, assemble, normalize_request};
use crate::infrastructure::cursor::{
    self, CollectionCursorSubject, CursorDirection, KeysetCoordinate, KeysetValue,
};
use crate::infrastructure::durable_mutation::{
    self, CommitResult, OperationIdentity, ReceiptMetadata, ReplayIdentity,
};
use crate::infrastructure::local_commit;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::store_replacement::{
    StoreReplacementPhase, cleanup_store_replacement, read_store_replacement_journal,
};
use crate::infrastructure::writer::{StoreMaintenance, StoreReaders, StoreWriter};

const MODULE_NAME: &str = "store_administration";
const MAX_OPERATION_ID_BYTES: usize = 512;
const MAX_LABEL_CHARS: usize = 512;
const MAX_BACKUPS: usize = 200;
const DEFAULT_BLOCK_RETENTION_COUNT: usize = 10_000;

type StoreReplacementHook = Arc<dyn Fn(&str) -> Result<(), StoreError> + Send + Sync>;

#[derive(Clone, Debug)]
pub struct StoreAdministrationApplyOutcome {
    pub committed:
        crate::ModuleWriterResult<StoreAdministrationCommitValue, StoreAdministrationReceipt>,
    pub event: Option<CommittedCoreModuleEvent>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DurableAdministrationOutcome {
    committed:
        crate::ModuleWriterResult<StoreAdministrationCommitValue, StoreAdministrationReceipt>,
    #[serde(default)]
    deleted_backup_ids: Vec<String>,
}

#[derive(Clone, Debug)]
struct ActiveOperation {
    operation_id: String,
    phase: String,
}

fn backup_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    items: Vec<BackupRecord>,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<BackupRecord>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint = cursor::query_fingerprint(&"store_administration_backups_v1")?;
    let subject = CollectionCursorSubject {
        kind: "store_administration_backups",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let after = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward || coordinate.values.len() != 1 {
                return Err(invalid_store("Backup cursor is incompatible"));
            }
            let [KeysetValue::Text { value: created_at }] = coordinate.values.as_slice() else {
                return Err(invalid_store("Backup cursor coordinate is invalid"));
            };
            Ok((created_at.clone(), coordinate.stable_id))
        })
        .transpose()?;
    let candidates = items
        .into_iter()
        .filter(|item| {
            after.as_ref().is_none_or(|(created_at, backup_id)| {
                item.created_at < *created_at
                    || (item.created_at == *created_at && item.backup_id < *backup_id)
            })
        })
        .take(normalized.first + 1)
        .map(|item| WindowCandidate {
            coordinate: KeysetCoordinate {
                values: vec![KeysetValue::Text {
                    value: item.created_at.clone(),
                }],
                stable_id: item.backup_id.clone(),
            },
            item,
        });
    assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: commit_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )
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
    maintenance: Option<StoreMaintenance>,
    store_replacement_hook: StoreReplacementHook,
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
            maintenance: Some(kernel.maintenance()),
            store_replacement_hook: Arc::new(|_| Ok(())),
            operation_lock: Arc::new(Mutex::new(())),
            runtime: Arc::new(Mutex::new(RuntimeState {
                active: None,
                integrity: StoreIntegrity::Unknown,
            })),
        }
    }

    pub fn with_store_replacement_hook(
        mut self,
        hook: impl Fn(&str) -> Result<(), StoreError> + Send + Sync + 'static,
    ) -> Self {
        self.store_replacement_hook = Arc::new(hook);
        self
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<StoreAdministrationRead>,
    ) -> Result<ModuleReadSnapshot<StoreAdministrationReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.contract_version != STORE_ADMINISTRATION_CONTRACT_VERSION {
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
        let operation_guard = if matches!(request.read, StoreAdministrationRead::Backups { .. }) {
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
                let store_epoch = transaction.query_row(
                    "SELECT metadata.store_epoch \
                     FROM block_store_metadata metadata WHERE metadata.id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                let commit_seq = crate::infrastructure::local_commit::head(&transaction)?;
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
                    StoreAdministrationRead::Backups { window } => {
                        let deleted = logically_deleted_backup_ids(&transaction)?;
                        let mut items = backup::list_backups(&profile_home)?;
                        items.retain(|item| !deleted.contains(&item.backup_id));
                        StoreAdministrationReadValue::Backups {
                            backups: backup_window(
                                &transaction,
                                &library_id,
                                commit_seq,
                                items,
                                &window,
                            )?,
                        }
                    }
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
                    contract_version: STORE_ADMINISTRATION_CONTRACT_VERSION,
                    store_epoch: StoreEpoch(store_epoch),
                    commit_head: commit_seq,
                    authorization: None,
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
        if request.contract_version != STORE_ADMINISTRATION_CONTRACT_VERSION {
            return Err(invalid("unsupported Store Administration contract version"));
        }
        require_private_adapter(context)?;
        validate_operation_id(&request.operation_id)?;
        let intent = request.intent.clone();
        let (phase, normalized_label, maintenance_tasks) = match &intent {
            StoreAdministrationIntent::CreateBackup { label, .. } => {
                ("online_backup", normalize_label(label)?, None)
            }
            StoreAdministrationIntent::RestoreBackup { .. } => ("restore", None, None),
            StoreAdministrationIntent::DeleteBackup { .. } => ("delete_backup", None, None),
            StoreAdministrationIntent::PruneBackups { .. } => ("prune_backups", None, None),
            StoreAdministrationIntent::RunMaintenance { tasks, .. } => (
                "maintenance",
                None,
                Some(normalize_maintenance_tasks(tasks)?),
            ),
        };
        let operation_guard = match self.operation_lock.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => return Err(maintenance_in_progress()),
            Err(TryLockError::Poisoned(_)) => {
                return Err(unavailable("Store Administration operation lock failed"));
            }
        };
        self.set_active(&request.operation_id, phase)?;
        let result = match intent {
            StoreAdministrationIntent::CreateBackup { .. } => {
                self.apply_create_backup(context, request, normalized_label)
            }
            StoreAdministrationIntent::RestoreBackup { .. } => {
                self.apply_restore_backup(context, request)
            }
            StoreAdministrationIntent::DeleteBackup { .. } => {
                self.apply_delete_backup(context, request)
            }
            StoreAdministrationIntent::PruneBackups { .. } => {
                self.apply_prune_backups(context, request)
            }
            StoreAdministrationIntent::RunMaintenance { .. } => self.apply_maintenance(
                context,
                request,
                maintenance_tasks.expect("maintenance tasks were normalized"),
            ),
        };
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
        let StoreAdministrationIntent::CreateBackup {
            include_assets,
            trigger,
            ..
        } = request.intent
        else {
            unreachable!("apply validates the Store Administration intent")
        };
        let fingerprint = serde_json::to_vec(&(
            &self.profile_id,
            &self.library_id,
            request.contract_version,
            &request.store_epoch,
            &normalized_label,
            include_assets,
            trigger,
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
                        StoreErrorCode::StaleStoreEpoch,
                        "Store Administration mutation targets a stale store epoch",
                        true,
                    ));
                }
                if let Some(outcome) = replay_outcome(connection, &operation_id, &request_hash)? {
                    let backup_id = outcome
                        .committed
                        .value
                        .backup_id
                        .as_deref()
                        .ok_or_else(|| corrupt("Backup creation receipt has no Backup identity"))?;
                    operation_journal::publish_backup(
                        &profile_home,
                        &operation_id,
                        &request_hash,
                        backup_id,
                    )?;
                    return Ok(outcome);
                }
                let backup_count = backup::list_backups(&profile_home)?.len();
                if backup_count >= MAX_BACKUPS {
                    return Err(StoreError::new(
                        StoreErrorCode::ResourceExhausted,
                        "Backup collection exceeds its fixed bound; delete an older Backup first",
                        false,
                    ));
                }
                let record = operation_journal::stage_backup(
                    connection,
                    &profile_home,
                    &profile_id,
                    &operation_id,
                    &request_hash,
                    normalized_label.as_deref(),
                    include_assets,
                    trigger,
                )?;
                let outcome = finish_backup_creation(
                    connection,
                    &library_id,
                    &context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    &record,
                )?;
                operation_journal::publish_backup(
                    &profile_home,
                    &operation_id,
                    &request_hash,
                    &record.backup_id,
                )?;
                Ok(outcome)
            })
            .map_err(core_error)?;
        if let Ok(mut state) = self.runtime.lock() {
            state.integrity = StoreIntegrity::Ok;
        }
        Ok(outcome)
    }

    fn apply_delete_backup(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<StoreAdministrationIntent>,
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
        let StoreAdministrationIntent::DeleteBackup { backup_id } = request.intent else {
            unreachable!("apply validates the Store Administration intent")
        };
        let fingerprint = serde_json::to_vec(&(
            &self.profile_id,
            &self.library_id,
            request.contract_version,
            &request.store_epoch,
            "delete_backup",
            &backup_id,
        ))
        .map_err(|_| unavailable("Backup deletion request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        let finish_context = context.clone();
        let operation_id = request.operation_id;
        let cleanup_operation_id = operation_id.clone();
        let requested_store_epoch = request.store_epoch.0;
        let profile_home_for_write = profile_home.clone();
        let backup_id_for_write = backup_id.clone();
        let (outcome, deleted_backup_ids) = writer
            .call(move |connection| {
                assert_identity(connection, &profile_id, &library_id)?;
                let store_epoch = read_store_epoch(connection)?;
                if requested_store_epoch != store_epoch {
                    return Err(stale_store_epoch());
                }
                if let Some(replayed) =
                    replay_cleanup_outcome(connection, &operation_id, &request_hash)?
                {
                    return Ok(replayed);
                }
                let deleted = logically_deleted_backup_ids(connection)?;
                if deleted.contains(&backup_id_for_write) {
                    return Err(StoreError::new(
                        StoreErrorCode::NotFound,
                        "Backup was not found",
                        false,
                    ));
                }
                let exists = backup::list_backup_inventory(&profile_home_for_write)?
                    .into_iter()
                    .any(|item| item.record.backup_id == backup_id_for_write);
                if !exists {
                    return Err(StoreError::new(
                        StoreErrorCode::NotFound,
                        "Backup was not found",
                        false,
                    ));
                }
                backup::validate_backup_for_deletion(
                    &profile_home_for_write,
                    &backup_id_for_write,
                )?;
                let committed_at = sqlite_now(connection)?;
                let deleted_backup_ids = vec![backup_id_for_write.clone()];
                let outcome = finish_cleanup_operation(
                    connection,
                    &library_id,
                    &finish_context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    "delete_backup",
                    Some(&backup_id_for_write),
                    &deleted_backup_ids,
                    &committed_at,
                )?;
                Ok((outcome, deleted_backup_ids))
            })
            .map_err(core_error)?;
        operation_journal::publish_backup_cleanup(
            profile_home,
            &cleanup_operation_id,
            &deleted_backup_ids,
        )
        .map_err(core_error)?;
        Ok(outcome)
    }

    fn apply_prune_backups(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<StoreAdministrationIntent>,
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
        let StoreAdministrationIntent::PruneBackups { retain_count } = request.intent else {
            unreachable!("apply validates the Store Administration intent")
        };
        let fingerprint = serde_json::to_vec(&(
            &self.profile_id,
            &self.library_id,
            request.contract_version,
            &request.store_epoch,
            "prune_backups",
            retain_count,
        ))
        .map_err(|_| unavailable("Backup pruning request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        let finish_context = context.clone();
        let operation_id = request.operation_id;
        let cleanup_operation_id = operation_id.clone();
        let requested_store_epoch = request.store_epoch.0;
        let profile_home_for_write = profile_home.clone();
        let (outcome, deleted_backup_ids) = writer
            .call(move |connection| {
                assert_identity(connection, &profile_id, &library_id)?;
                let store_epoch = read_store_epoch(connection)?;
                if requested_store_epoch != store_epoch {
                    return Err(stale_store_epoch());
                }
                if let Some(replayed) =
                    replay_cleanup_outcome(connection, &operation_id, &request_hash)?
                {
                    return Ok(replayed);
                }
                let logically_deleted = logically_deleted_backup_ids(connection)?;
                let retain_count = usize::try_from(retain_count)
                    .map_err(|_| invalid_store("Backup retention count is invalid"))?;
                let deleted_backup_ids = backup::list_backup_inventory(&profile_home_for_write)?
                    .into_iter()
                    .filter(|item| {
                        item.trigger == "auto"
                            && !logically_deleted.contains(&item.record.backup_id)
                    })
                    .skip(retain_count)
                    .map(|item| item.record.backup_id)
                    .collect::<Vec<_>>();
                for backup_id in &deleted_backup_ids {
                    backup::validate_backup_for_deletion(&profile_home_for_write, backup_id)?;
                }
                let committed_at = sqlite_now(connection)?;
                let outcome = finish_cleanup_operation(
                    connection,
                    &library_id,
                    &finish_context,
                    &operation_id,
                    &request_hash,
                    &store_epoch,
                    "prune_backups",
                    None,
                    &deleted_backup_ids,
                    &committed_at,
                )?;
                Ok((outcome, deleted_backup_ids))
            })
            .map_err(core_error)?;
        operation_journal::publish_backup_cleanup(
            profile_home,
            &cleanup_operation_id,
            &deleted_backup_ids,
        )
        .map_err(core_error)?;
        Ok(outcome)
    }

    fn apply_maintenance(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<StoreAdministrationIntent>,
        tasks: Vec<MaintenanceTask>,
    ) -> Result<StoreAdministrationApplyOutcome, CoreError> {
        let Some(writer) = &self.writer else {
            return Err(unavailable(
                "Store Administration Module has no durable writer",
            ));
        };
        let StoreAdministrationIntent::RunMaintenance {
            block_retention_count,
            ..
        } = &request.intent
        else {
            unreachable!("apply validates the Store Administration intent")
        };
        if block_retention_count.is_some() && !tasks.contains(&MaintenanceTask::BlockRetention) {
            return Err(invalid(
                "block retention policy requires the block_retention task",
            ));
        }
        let fingerprint = serde_json::to_vec(&(
            &self.profile_id,
            &self.library_id,
            request.contract_version,
            &request.store_epoch,
            "run_maintenance",
            &tasks,
            block_retention_count,
        ))
        .map_err(|_| unavailable("Store maintenance request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        let finish_context = context.clone();
        let operation_id = request.operation_id;
        let requested_store_epoch = request.store_epoch.0;
        let tasks_for_write = tasks.clone();
        let block_retention_count = block_retention_count
            .as_ref()
            .map(|count| {
                usize::try_from(*count)
                    .map_err(|_| invalid("block retention count exceeds platform bounds"))
            })
            .transpose()?;
        let verifies_integrity = tasks.iter().any(|task| {
            matches!(
                task,
                MaintenanceTask::IntegrityCheck | MaintenanceTask::ForeignKeyCheck
            )
        });
        let result = writer.call(move |connection| {
            assert_identity(connection, &profile_id, &library_id)?;
            let store_epoch = read_store_epoch(connection)?;
            if requested_store_epoch != store_epoch {
                return Err(stale_store_epoch());
            }
            if let Some(outcome) = replay_outcome(connection, &operation_id, &request_hash)? {
                return Ok(outcome);
            }
            for task in &tasks_for_write {
                run_maintenance_task(connection, &finish_context, *task, block_retention_count)?;
            }
            let committed_at = sqlite_now(connection)?;
            finish_maintenance(
                connection,
                &library_id,
                &finish_context,
                &operation_id,
                &request_hash,
                &store_epoch,
                &tasks_for_write,
                &committed_at,
            )
        });
        match result {
            Ok(outcome) => {
                if verifies_integrity && let Ok(mut state) = self.runtime.lock() {
                    state.integrity = StoreIntegrity::Ok;
                }
                Ok(outcome)
            }
            Err(error) => {
                if verifies_integrity && let Ok(mut state) = self.runtime.lock() {
                    state.integrity = StoreIntegrity::Failed;
                }
                Err(core_error(error))
            }
        }
    }

    fn apply_restore_backup(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<StoreAdministrationIntent>,
    ) -> Result<StoreAdministrationApplyOutcome, CoreError> {
        let Some(writer) = &self.writer else {
            return Err(unavailable(
                "Store Administration Module has no durable writer",
            ));
        };
        let Some(maintenance) = &self.maintenance else {
            return Err(unavailable(
                "Store Administration Module has no maintenance runtime",
            ));
        };
        let Some(profile_home) = &self.profile_home else {
            return Err(unavailable(
                "Store Administration Module has no managed Profile home",
            ));
        };
        let StoreAdministrationIntent::RestoreBackup {
            backup_id,
            create_safety_backup,
        } = request.intent
        else {
            unreachable!("apply validates the Store Administration intent")
        };
        let fingerprint = serde_json::to_vec(&(
            &self.profile_id,
            &self.library_id,
            request.contract_version,
            "restore_backup",
            &backup_id,
            create_safety_backup,
        ))
        .map_err(|_| unavailable("Store restore request cannot be fingerprinted"))?;
        let request_hash = sha256(&fingerprint);
        let operation_id = request.operation_id;
        let existing_journal = read_store_replacement_journal(profile_home).map_err(core_error)?;
        if let Some(journal) = &existing_journal {
            restore::validate_journal_identity(journal, &operation_id, &request_hash, &backup_id)
                .map_err(core_error)?;
        }
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        let preflight_operation_id = operation_id.clone();
        let preflight_request_hash = request_hash.clone();
        let preflight_backup_id = backup_id.clone();
        if let Some(outcome) = writer
            .call(move |connection| {
                assert_identity(connection, &profile_id, &library_id)?;
                if let Some(outcome) =
                    replay_outcome(connection, &preflight_operation_id, &preflight_request_hash)?
                {
                    return Ok(Some(outcome));
                }
                if logically_deleted_backup_ids(connection)?.contains(&preflight_backup_id) {
                    return Err(StoreError::new(
                        StoreErrorCode::NotFound,
                        "Restore backup was not found",
                        false,
                    ));
                }
                Ok(None)
            })
            .map_err(core_error)?
        {
            if let Some(journal) = &existing_journal {
                if journal.phase != StoreReplacementPhase::Committed {
                    return Err(core_error(corrupt(
                        "Store restore receipt exists before its replacement committed",
                    )));
                }
                cleanup_store_replacement(profile_home, journal).map_err(core_error)?;
            }
            return Ok(outcome);
        }

        let installation = if let Some(journal) = existing_journal
            .as_ref()
            .filter(|journal| journal.phase == StoreReplacementPhase::Committed)
        {
            restore::RestoreInstallation {
                installed_epoch: journal
                    .installed_store_epoch
                    .clone()
                    .ok_or_else(|| corrupt("Committed Store restore has no installed epoch"))
                    .map_err(core_error)?,
                safety_backup_id: journal.safety_backup_id.clone(),
                journal: journal.clone(),
            }
        } else {
            let profile_home = profile_home.clone();
            let profile_id = self.profile_id.clone();
            let library_id = self.library_id.clone();
            let operation_id = operation_id.clone();
            let request_hash = request_hash.clone();
            let requested_store_epoch = request.store_epoch.0;
            let backup_id = backup_id.clone();
            let replacement_hook = Arc::clone(&self.store_replacement_hook);
            maintenance
                .run(move |_| {
                    operation_journal::install_restore(restore::InstallRestoreRequest {
                        profile_home: &profile_home,
                        profile_id: &profile_id,
                        library_id: &library_id,
                        operation_id: &operation_id,
                        request_hash: &request_hash,
                        requested_store_epoch: &requested_store_epoch,
                        backup_id: &backup_id,
                        create_safety_backup,
                        existing_journal,
                        replacement_hook: replacement_hook.as_ref(),
                    })
                })
                .map_err(core_error)?
        };

        let finish_profile_id = self.profile_id.clone();
        let finish_library_id = self.library_id.clone();
        let finish_context = context.clone();
        let finish_operation_id = operation_id.clone();
        let finish_request_hash = request_hash.clone();
        let finish_backup_id = backup_id.clone();
        let finish_store_epoch = installation.installed_epoch.clone();
        let finish_safety_backup_id = installation.safety_backup_id.clone();
        let outcome = writer
            .call(move |connection| {
                assert_identity(connection, &finish_profile_id, &finish_library_id)?;
                if let Some(outcome) =
                    replay_outcome(connection, &finish_operation_id, &finish_request_hash)?
                {
                    return Ok(outcome);
                }
                if read_store_epoch(connection)? != finish_store_epoch {
                    return Err(corrupt(
                        "Committed Store restore epoch changed before receipt finalization",
                    ));
                }
                let committed_at = connection.query_row(
                    "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                    [],
                    |row| row.get::<_, String>(0),
                )?;
                finish_restore(
                    connection,
                    &finish_library_id,
                    &finish_context,
                    &finish_operation_id,
                    &finish_request_hash,
                    &finish_store_epoch,
                    &finish_backup_id,
                    finish_safety_backup_id.as_deref(),
                    &committed_at,
                )
            })
            .map_err(core_error)?;
        cleanup_store_replacement(profile_home, &installation.journal).map_err(core_error)?;
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
            maintenance: None,
            store_replacement_hook: Arc::new(|_| Ok(())),
            operation_lock: Arc::new(Mutex::new(())),
            runtime: Arc::new(Mutex::new(RuntimeState {
                active: None,
                integrity: StoreIntegrity::Unknown,
            })),
        }
    }
}

fn replay_outcome(
    connection: &Connection,
    operation_id: &str,
    request_hash: &str,
) -> Result<Option<StoreAdministrationApplyOutcome>, StoreError> {
    let Some(mut durable) = replay_durable_outcome(
        connection,
        operation_id,
        request_hash,
        read_store_epoch(connection)?.as_str(),
    )?
    else {
        return Ok(None);
    };
    durable.committed.receipt.mutation.duplicate = true;
    Ok(Some(StoreAdministrationApplyOutcome {
        committed: durable.committed,
        event: None,
    }))
}

fn replay_cleanup_outcome(
    connection: &Connection,
    operation_id: &str,
    request_hash: &str,
) -> Result<Option<(StoreAdministrationApplyOutcome, Vec<String>)>, StoreError> {
    let Some(mut durable) = replay_durable_outcome(
        connection,
        operation_id,
        request_hash,
        read_store_epoch(connection)?.as_str(),
    )?
    else {
        return Ok(None);
    };
    validate_deleted_backup_ids(&durable.deleted_backup_ids)?;
    durable.committed.receipt.mutation.duplicate = true;
    Ok(Some((
        StoreAdministrationApplyOutcome {
            committed: durable.committed,
            event: None,
        },
        durable.deleted_backup_ids,
    )))
}

fn replay_durable_outcome(
    connection: &Connection,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
) -> Result<Option<DurableAdministrationOutcome>, StoreError> {
    let replayed = durable_mutation::replay_existing(
        connection,
        ReplayIdentity {
            module: ModuleName::StoreAdministration,
            module_name: MODULE_NAME,
            operation_id,
            intent_hash: request_hash,
            store_epoch,
        },
    )?;
    match replayed {
        Some(CommitResult::IdempotentReplay { outcome, .. }) => Ok(Some(outcome)),
        Some(CommitResult::Committed { .. } | CommitResult::NoOp { .. }) => Err(corrupt(
            "Stored Store Administration replay returned a fresh disposition",
        )),
        None => Ok(None),
    }
}

fn logically_deleted_backup_ids(connection: &Connection) -> Result<BTreeSet<String>, StoreError> {
    let result_json = connection
        .prepare(
            "SELECT result_json FROM core_module_receipts \
             WHERE module_name = ?1 AND operation_kind IN ('delete_backup', 'prune_backups') \
             ORDER BY committed_at, operation_id LIMIT 10001",
        )?
        .query_map([MODULE_NAME], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if result_json.len() > 10_000 {
        return Err(corrupt(
            "Durable backup deletion ledger exceeds its row bound",
        ));
    }
    let mut deleted = BTreeSet::new();
    for raw in result_json {
        let durable = serde_json::from_str::<DurableAdministrationOutcome>(&raw)
            .map_err(|_| corrupt("Durable backup deletion receipt JSON is invalid"))?;
        validate_deleted_backup_ids(&durable.deleted_backup_ids)?;
        for backup_id in durable.deleted_backup_ids {
            deleted.insert(backup_id);
        }
    }
    Ok(deleted)
}

fn validate_deleted_backup_ids(values: &[String]) -> Result<(), StoreError> {
    if values.len() > 10_000 {
        return Err(corrupt(
            "Durable backup deletion receipt exceeds its identity bound",
        ));
    }
    if values
        .iter()
        .any(|backup_id| !backup::is_safe_backup_id(backup_id))
    {
        return Err(corrupt("Durable backup deletion identity is invalid"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn finish_administration_mutation(
    connection: &mut Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
    operation_kind: &str,
    committed_at: &str,
    value: StoreAdministrationCommitValue,
    deleted_backup_ids: Vec<String>,
    event_payload: StoreAdministrationEvent,
    changed: bool,
) -> Result<StoreAdministrationApplyOutcome, StoreError> {
    validate_deleted_backup_ids(&deleted_backup_ids)?;
    with_immediate_transaction(connection, |transaction| {
        let result = durable_mutation::run(
            transaction,
            OperationIdentity {
                module: ModuleName::StoreAdministration,
                module_name: MODULE_NAME,
                operation_id,
                intent_hash: request_hash,
                store_epoch,
                committed_at,
                context,
            },
            |scope| {
                if changed {
                    local_commit::record_administration_effect(
                        transaction,
                        scope.evidence(),
                        library_id,
                        &event_payload,
                    )?;
                }
                let commit_seq = if changed {
                    scope.commit_seq()
                } else {
                    local_commit::head(transaction)?
                };
                let committed = crate::ModuleWriterResult {
                    value: value.clone(),
                    receipt: StoreAdministrationReceipt {
                        mutation: ModuleMutationReceipt {
                            operation_id: operation_id.to_owned(),
                            duplicate: false,
                        },
                        backup_id: value.backup_id.clone(),
                        safety_backup_id: value.safety_backup_id.clone(),
                    },
                    commit_seq,
                    event_sequence: 0,
                    store_epoch: StoreEpoch(store_epoch.to_owned()),
                };
                let durable = DurableAdministrationOutcome {
                    committed,
                    deleted_backup_ids: deleted_backup_ids.clone(),
                };
                let receipt = ReceiptMetadata {
                    operation_kind,
                    event_sequence: None,
                    committed_at,
                };
                Ok(if changed {
                    scope.seal(durable, receipt)
                } else {
                    scope.no_op(durable, receipt)
                })
            },
        )?;
        result.verify_manifest_identity(|durable| {
            (
                durable.committed.commit_seq,
                durable.committed.store_epoch.0.clone(),
            )
        })?;
        let (mut durable, replayed) = match result {
            CommitResult::Committed { outcome, .. } | CommitResult::NoOp { outcome } => {
                (outcome, false)
            }
            CommitResult::IdempotentReplay { outcome, .. } => (outcome, true),
        };
        if replayed {
            durable.committed.receipt.mutation.duplicate = true;
        }
        Ok(StoreAdministrationApplyOutcome {
            committed: durable.committed,
            event: None,
        })
    })
}

fn finish_backup_creation(
    connection: &mut Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
    backup: &BackupRecord,
) -> Result<StoreAdministrationApplyOutcome, StoreError> {
    finish_administration_mutation(
        connection,
        library_id,
        context,
        operation_id,
        request_hash,
        store_epoch,
        "create_backup",
        &backup.created_at,
        StoreAdministrationCommitValue {
            backup_id: Some(backup.backup_id.clone()),
            safety_backup_id: None,
            completed_tasks: Vec::new(),
        },
        Vec::new(),
        StoreAdministrationEvent {
            kind: StoreAdministrationEventKind::StoreAdministrationChanged,
            operation: "create_backup".to_owned(),
            backup_ids: vec![backup.backup_id.clone()],
            readiness_changed: false,
        },
        true,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_cleanup_operation(
    connection: &mut Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
    operation_kind: &str,
    backup_id: Option<&str>,
    deleted_backup_ids: &[String],
    committed_at: &str,
) -> Result<StoreAdministrationApplyOutcome, StoreError> {
    finish_administration_mutation(
        connection,
        library_id,
        context,
        operation_id,
        request_hash,
        store_epoch,
        operation_kind,
        committed_at,
        StoreAdministrationCommitValue {
            backup_id: backup_id.map(str::to_owned),
            safety_backup_id: None,
            completed_tasks: Vec::new(),
        },
        deleted_backup_ids.to_vec(),
        StoreAdministrationEvent {
            kind: StoreAdministrationEventKind::StoreAdministrationChanged,
            operation: operation_kind.to_owned(),
            backup_ids: deleted_backup_ids.to_vec(),
            readiness_changed: false,
        },
        !deleted_backup_ids.is_empty(),
    )
}

fn run_maintenance_task(
    connection: &mut Connection,
    context: &BoundModuleContext,
    task: MaintenanceTask,
    block_retention_count: Option<usize>,
) -> Result<(), StoreError> {
    match task {
        MaintenanceTask::IntegrityCheck => {
            let integrity = connection
                .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))?;
            if integrity != "ok" {
                return Err(corrupt(format!(
                    "SQLite integrity_check failed: {integrity}"
                )));
            }
        }
        MaintenanceTask::ForeignKeyCheck => {
            let violations = connection.query_row(
                "SELECT count(*) FROM pragma_foreign_key_check",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            if violations != 0 {
                return Err(corrupt(format!(
                    "SQLite foreign_key_check found {violations} violations"
                )));
            }
        }
        MaintenanceTask::DocumentRevisionFinalize => {
            crate::document::finalize_idle_document_revisions(connection, context)?;
        }
        MaintenanceTask::DocumentCompaction => {
            crate::document::compact_eligible_documents(connection)?;
        }
        MaintenanceTask::HistoryRetention => {
            crate::document::prune_document_history_pass(connection)?;
        }
        MaintenanceTask::BlockRetention => {
            crate::document::run_block_retention_pass(
                connection,
                block_retention_count.unwrap_or(DEFAULT_BLOCK_RETENTION_COUNT),
            )?;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn finish_maintenance(
    connection: &mut Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
    completed_tasks: &[MaintenanceTask],
    committed_at: &str,
) -> Result<StoreAdministrationApplyOutcome, StoreError> {
    finish_administration_mutation(
        connection,
        library_id,
        context,
        operation_id,
        request_hash,
        store_epoch,
        "run_maintenance",
        committed_at,
        StoreAdministrationCommitValue {
            backup_id: None,
            safety_backup_id: None,
            completed_tasks: completed_tasks.to_vec(),
        },
        Vec::new(),
        StoreAdministrationEvent {
            kind: StoreAdministrationEventKind::StoreAdministrationChanged,
            operation: "run_maintenance".to_owned(),
            backup_ids: Vec::new(),
            readiness_changed: true,
        },
        !completed_tasks.is_empty(),
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_restore(
    connection: &mut Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    request_hash: &str,
    store_epoch: &str,
    backup_id: &str,
    safety_backup_id: Option<&str>,
    committed_at: &str,
) -> Result<StoreAdministrationApplyOutcome, StoreError> {
    let mut backup_ids = vec![backup_id.to_owned()];
    if let Some(safety_backup_id) = safety_backup_id {
        backup_ids.push(safety_backup_id.to_owned());
    }
    finish_administration_mutation(
        connection,
        library_id,
        context,
        operation_id,
        request_hash,
        store_epoch,
        "restore_backup",
        committed_at,
        StoreAdministrationCommitValue {
            backup_id: Some(backup_id.to_owned()),
            safety_backup_id: safety_backup_id.map(str::to_owned),
            completed_tasks: Vec::new(),
        },
        Vec::new(),
        StoreAdministrationEvent {
            kind: StoreAdministrationEventKind::StoreAdministrationChanged,
            operation: "restore_backup".to_owned(),
            backup_ids,
            readiness_changed: true,
        },
        true,
    )
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

fn normalize_maintenance_tasks(
    tasks: &[MaintenanceTask],
) -> Result<Vec<MaintenanceTask>, CoreError> {
    const ORDER: [MaintenanceTask; 6] = [
        MaintenanceTask::IntegrityCheck,
        MaintenanceTask::ForeignKeyCheck,
        MaintenanceTask::DocumentRevisionFinalize,
        MaintenanceTask::DocumentCompaction,
        MaintenanceTask::HistoryRetention,
        MaintenanceTask::BlockRetention,
    ];
    if tasks.is_empty() || tasks.len() > ORDER.len() {
        return Err(invalid(
            "maintenance tasks must contain one to six unique tasks",
        ));
    }
    let mut normalized = Vec::new();
    for task in ORDER {
        let count = tasks.iter().filter(|candidate| **candidate == task).count();
        if count > 1 {
            return Err(invalid("maintenance tasks must not contain duplicates"));
        }
        if count == 1 {
            normalized.push(task);
        }
    }
    Ok(normalized)
}

fn validate_operation_id(operation_id: &str) -> Result<(), CoreError> {
    if operation_id.is_empty() || operation_id.len() > MAX_OPERATION_ID_BYTES {
        return Err(invalid("operation_id is empty or exceeds its byte bound"));
    }
    Ok(())
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(Into::into)
}

fn stale_store_epoch() -> StoreError {
    StoreError::new(
        StoreErrorCode::StaleStoreEpoch,
        "Store Administration mutation targets a stale store epoch",
        true,
    )
}

fn invalid_store(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
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
        StoreErrorCode::PatchNotFound => CoreErrorCode::PatchNotFound,
        StoreErrorCode::PatchAmbiguous => CoreErrorCode::PatchAmbiguous,
        StoreErrorCode::PatchOverlap => CoreErrorCode::PatchOverlap,
        StoreErrorCode::StaleStoreEpoch => CoreErrorCode::StaleStoreEpoch,
        StoreErrorCode::Conflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::GenerationConflict => CoreErrorCode::GenerationConflict,
        StoreErrorCode::HeadConflict => CoreErrorCode::HeadConflict,
        StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::ProtectedOwnerDeletion => CoreErrorCode::ProtectedOwnerDeletion,
        StoreErrorCode::MissingDependencies => CoreErrorCode::DocumentUpdateMissingDependencies,
        StoreErrorCode::MaterializationStale => CoreErrorCode::MaterializationStale,
        StoreErrorCode::UnsupportedSchema
        | StoreErrorCode::AlreadyOwned
        | StoreErrorCode::InvalidProfile
        | StoreErrorCode::RuntimeIncompatible => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        StoreErrorCode::MaintenanceInProgress => CoreErrorCode::MaintenanceInProgress,
        StoreErrorCode::ResourceExhausted => CoreErrorCode::ResourceExhausted,
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
