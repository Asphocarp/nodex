use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::sync::{Arc, Mutex};

use nodex_core_contracts::administration::{
    BackupTrigger, MaintenanceTask, SchemaOwner, StoreAdministrationIntent,
    StoreAdministrationRead, StoreAdministrationReadValue, StoreIntegrity, StoreReadiness,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, CoreErrorCode, LibraryId,
    ModuleApplyRequest, ModuleReadRequest, ProfileId, StoreEpoch,
};
use tempfile::TempDir;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::store::SqliteStoreKernel;

use super::StoreAdministrationModule;

const PROFILE_ID: &str = "profile:administration-test";
const LIBRARY_ID: &str = "library:administration-test";
const STORE_EPOCH: &str = "epoch:administration-test";

struct Fixture {
    _home: TempDir,
    kernel: SqliteStoreKernel,
    module: StoreAdministrationModule,
}

impl Fixture {
    fn new() -> Self {
        Self::new_with_hook(|_| Ok(()))
    }

    fn new_with_hook(
        hook: impl Fn(&str) -> Result<(), StoreError> + Send + Sync + 'static,
    ) -> Self {
        let home = tempfile::tempdir().expect("Profile home");
        let kernel = SqliteStoreKernel::open(home.path()).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, ?1, '2026-07-19T00:00:00.000Z', \
                           '2026-07-19T00:00:00.000Z')",
                        [STORE_EPOCH],
                    )?;
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) \
                         VALUES (?1, '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z')",
                        [PROFILE_ID],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES (?1, ?2, '2026-07-19T00:00:00.000Z', \
                           '2026-07-19T00:00:00.000Z')",
                        [LIBRARY_ID, PROFILE_ID],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(\
                           id, library_id, database_block_id, lifecycle, binding_revision, \
                           name, description, icon, created, updated\
                         ) VALUES ('project:administration-test', ?1, NULL, 'active', 1, \
                           'Administration', '', '', '2026-07-19T00:00:00.000Z', \
                           '2026-07-19T00:00:00.000Z')",
                        [LIBRARY_ID],
                    )?;
                    Ok(())
                })
            })
            .expect("identity");
        let module = StoreAdministrationModule::new(PROFILE_ID, LIBRARY_ID, &kernel)
            .with_store_replacement_hook(hook);
        Self {
            _home: home,
            kernel,
            module,
        }
    }

    fn home(&self) -> &Path {
        self._home.path()
    }

    fn context(&self) -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId(PROFILE_ID.to_owned()),
            library_id: LibraryId(LIBRARY_ID.to_owned()),
            project_id: None,
            connection_id: "connection:administration-test".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn read(&self, read: StoreAdministrationRead) -> StoreAdministrationReadValue {
        self.module
            .read(
                &self.context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read,
                },
            )
            .expect("Store Administration read")
            .value
    }

    fn create_backup(
        &self,
        operation_id: &str,
        label: Option<&str>,
        include_assets: bool,
    ) -> super::StoreAdministrationApplyOutcome {
        self.create_backup_with_trigger(operation_id, label, include_assets, BackupTrigger::Manual)
    }

    fn create_backup_with_trigger(
        &self,
        operation_id: &str,
        label: Option<&str>,
        include_assets: bool,
        trigger: BackupTrigger,
    ) -> super::StoreAdministrationApplyOutcome {
        self.module
            .apply(
                &self.context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: StoreAdministrationIntent::CreateBackup {
                        label: label.map(str::to_owned),
                        include_assets,
                        trigger,
                    },
                },
            )
            .expect("create backup")
    }

    fn restore_backup(
        &self,
        operation_id: &str,
        backup_id: &str,
        create_safety_backup: bool,
    ) -> super::StoreAdministrationApplyOutcome {
        self.module
            .apply(
                &self.context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: StoreAdministrationIntent::RestoreBackup {
                        backup_id: backup_id.to_owned(),
                        create_safety_backup,
                    },
                },
            )
            .expect("restore backup")
    }

    fn delete_backup(
        &self,
        operation_id: &str,
        backup_id: &str,
    ) -> super::StoreAdministrationApplyOutcome {
        self.module
            .apply(
                &self.context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: StoreAdministrationIntent::DeleteBackup {
                        backup_id: backup_id.to_owned(),
                    },
                },
            )
            .expect("delete backup")
    }

    fn prune_backups(
        &self,
        operation_id: &str,
        retain_count: u32,
    ) -> super::StoreAdministrationApplyOutcome {
        self.module
            .apply(
                &self.context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                    intent: StoreAdministrationIntent::PruneBackups { retain_count },
                },
            )
            .expect("prune backups")
    }

    fn run_maintenance(
        &self,
        operation_id: &str,
        tasks: Vec<MaintenanceTask>,
    ) -> Result<super::StoreAdministrationApplyOutcome, nodex_core_contracts::CoreError> {
        self.run_maintenance_with_policy(operation_id, tasks, None)
    }

    fn run_maintenance_with_policy(
        &self,
        operation_id: &str,
        tasks: Vec<MaintenanceTask>,
        block_retention_count: Option<u64>,
    ) -> Result<super::StoreAdministrationApplyOutcome, nodex_core_contracts::CoreError> {
        self.module.apply(
            &self.context(),
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: operation_id.to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: StoreAdministrationIntent::RunMaintenance {
                    tasks,
                    block_retention_count,
                },
            },
        )
    }
}

#[test]
fn reports_rust_readiness_and_publishes_a_valid_exact_retry_backup() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.home().join("assets")).expect("assets root");
    fs::write(fixture.home().join("assets/managed.bin"), b"managed asset").expect("managed asset");

    assert_eq!(
        fixture.read(StoreAdministrationRead::Status),
        StoreAdministrationReadValue::Status {
            readiness: StoreReadiness::Ready,
            schema_version: 84,
            schema_owner: SchemaOwner::Rust,
            integrity: StoreIntegrity::Unknown,
        }
    );

    let first = fixture.create_backup(
        "administration:create-backup:1",
        Some("  before refactor  "),
        true,
    );
    let backup_id = first.committed.value.backup_id.clone().expect("backup ID");
    assert!(!first.committed.receipt.mutation.duplicate);
    assert!(first.event.is_some());
    assert_eq!(
        fs::read(
            fixture
                .home()
                .join("backups")
                .join(&backup_id)
                .join("assets/managed.bin")
        )
        .expect("backed-up asset"),
        b"managed asset"
    );

    let second = fixture.create_backup(
        "administration:create-backup:1",
        Some("before refactor"),
        true,
    );
    assert_eq!(second.committed.value.backup_id, Some(backup_id.clone()));
    assert!(second.committed.receipt.mutation.duplicate);
    assert!(second.event.is_none());

    fs::create_dir(fixture.home().join("backups/not-a-backup")).expect("invalid backup dir");
    let StoreAdministrationReadValue::Backups { items } =
        fixture.read(StoreAdministrationRead::Backups)
    else {
        panic!("backup list")
    };
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].backup_id, backup_id);
    assert_eq!(items[0].version, 2);
    assert_eq!(items[0].trigger, BackupTrigger::Manual);
    assert_eq!(items[0].label.as_deref(), Some("before refactor"));
    assert!(items[0].includes_assets);
    assert!(items[0].db_bytes > 0);
    assert_eq!(items[0].assets_bytes, b"managed asset".len() as u64);
    assert_eq!(items[0].total_bytes, items[0].byte_length);

    assert_eq!(
        fixture.read(StoreAdministrationRead::Status),
        StoreAdministrationReadValue::Status {
            readiness: StoreReadiness::Ready,
            schema_version: 84,
            schema_owner: SchemaOwner::Rust,
            integrity: StoreIntegrity::Ok,
        }
    );
    let receipt_count = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            connection
                .query_row(
                    "SELECT count(*) FROM core_module_receipts \
                     WHERE module_name = 'store_administration'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(Into::into)
        })
        .expect("receipt count");
    assert_eq!(receipt_count, 1);
}

#[test]
fn rejects_request_collisions_and_symlinked_assets_without_a_receipt() {
    let fixture = Fixture::new();
    fixture.create_backup(
        "administration:create-backup:collision",
        Some("first"),
        false,
    );
    let collision = fixture
        .module
        .apply(
            &fixture.context(),
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: "administration:create-backup:collision".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: StoreAdministrationIntent::CreateBackup {
                    label: Some("different".to_owned()),
                    include_assets: false,
                    trigger: BackupTrigger::Manual,
                },
            },
        )
        .expect_err("idempotency collision");
    assert_eq!(collision.code, CoreErrorCode::IdempotencyKeyReused);

    let assets = fixture.home().join("assets");
    fs::create_dir(&assets).expect("assets root");
    let outside = fixture.home().join("outside.bin");
    fs::write(&outside, b"outside").expect("outside file");
    symlink(&outside, assets.join("escape.bin")).expect("asset symlink");
    let rejected = fixture
        .module
        .apply(
            &fixture.context(),
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: "administration:create-backup:symlink".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: StoreAdministrationIntent::CreateBackup {
                    label: None,
                    include_assets: true,
                    trigger: BackupTrigger::Manual,
                },
            },
        )
        .expect_err("symlinked assets rejected");
    assert_eq!(rejected.code, CoreErrorCode::SchemaUnsupported);
    let receipt_exists = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM core_module_receipts \
                     WHERE module_name = 'store_administration' AND operation_id = ?1)",
                    ["administration:create-backup:symlink"],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(Into::into)
        })
        .expect("receipt existence");
    assert_eq!(receipt_exists, 0);
}

#[test]
fn adopts_a_published_backup_after_a_pre_receipt_crash_boundary() {
    let fixture = Fixture::new();
    let operation_id = "administration:create-backup:adopt";
    let label = Some("published before receipt".to_owned());
    let fingerprint = serde_json::to_vec(&(
        PROFILE_ID,
        LIBRARY_ID,
        CORE_CONTRACT_VERSION,
        StoreEpoch(STORE_EPOCH.to_owned()),
        &label,
        false,
        BackupTrigger::Manual,
    ))
    .expect("request fingerprint");
    let request_hash = super::sha256(&fingerprint);
    let home = fixture.home().to_path_buf();
    let operation = operation_id.to_owned();
    let published = fixture
        .kernel
        .writer()
        .call(move |connection| {
            super::backup::create_backup(
                connection,
                &home,
                PROFILE_ID,
                &operation,
                &request_hash,
                label.as_deref(),
                false,
                BackupTrigger::Manual,
            )
        })
        .expect("published backup");

    let receipt_count = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            connection
                .query_row(
                    "SELECT count(*) FROM core_module_receipts \
                     WHERE module_name = 'store_administration'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(Into::into)
        })
        .expect("receipt count before adoption");
    assert_eq!(receipt_count, 0);

    let adopted = fixture.create_backup(operation_id, Some("published before receipt"), false);
    assert_eq!(
        adopted.committed.value.backup_id.as_deref(),
        Some(published.backup_id.as_str())
    );
    assert!(!adopted.committed.receipt.mutation.duplicate);
    assert!(adopted.event.is_some());
}

#[test]
fn restores_database_assets_epoch_and_exact_retry_with_a_safety_backup() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.home().join("assets")).expect("assets root");
    fs::write(fixture.home().join("assets/managed.bin"), b"backup asset").expect("backup asset");
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute_batch(
                "CREATE TABLE administration_restore_probe(\
                   id INTEGER PRIMARY KEY CHECK (id = 1), marker TEXT NOT NULL\
                 ) STRICT; \
                 INSERT INTO administration_restore_probe(id, marker) VALUES (1, 'backup');",
            )?;
            Ok(())
        })
        .expect("restore probe");
    let target = fixture.create_backup(
        "administration:create-backup:restore-target",
        Some("restore target"),
        true,
    );
    let backup_id = target.committed.value.backup_id.expect("target backup");
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute(
                "UPDATE administration_restore_probe SET marker = 'current' WHERE id = 1",
                [],
            )?;
            Ok(())
        })
        .expect("current marker");
    fs::write(fixture.home().join("assets/managed.bin"), b"current asset").expect("current asset");

    let restored = fixture.restore_backup("administration:restore-backup:1", &backup_id, true);
    let installed_epoch = restored.committed.store_epoch.0.clone();
    let safety_backup_id = restored
        .committed
        .value
        .safety_backup_id
        .clone()
        .expect("safety backup");
    assert_ne!(installed_epoch, STORE_EPOCH);
    assert_eq!(
        restored.committed.value.backup_id.as_deref(),
        Some(backup_id.as_str())
    );
    assert_eq!(
        restored.committed.receipt.safety_backup_id.as_deref(),
        Some(safety_backup_id.as_str())
    );
    assert!(restored.event.is_some());
    let (marker, live_epoch) = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            Ok((
                connection.query_row(
                    "SELECT marker FROM administration_restore_probe WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )?,
                connection.query_row(
                    "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )?,
            ))
        })
        .expect("restored authority");
    assert_eq!(marker, "backup");
    assert_eq!(live_epoch, installed_epoch);
    assert_eq!(
        fs::read(fixture.home().join("assets/managed.bin")).expect("restored asset"),
        b"backup asset"
    );
    assert!(
        fixture
            .home()
            .join("backups")
            .join(&safety_backup_id)
            .exists()
    );
    assert!(
        !fixture
            .home()
            .join(".core-store-restore-journal.json")
            .exists()
    );

    let retry = fixture.restore_backup("administration:restore-backup:1", &backup_id, true);
    assert!(retry.committed.receipt.mutation.duplicate);
    assert_eq!(retry.committed.store_epoch.0, installed_epoch);
    assert!(retry.event.is_none());

    let stale = fixture
        .module
        .apply(
            &fixture.context(),
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: "administration:create-backup:stale-after-restore".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: StoreAdministrationIntent::CreateBackup {
                    label: None,
                    include_assets: false,
                    trigger: BackupTrigger::Manual,
                },
            },
        )
        .expect_err("old epoch must be stale");
    assert_eq!(stale.code, CoreErrorCode::StaleStoreEpoch);
}

#[test]
fn replacement_hook_failure_rolls_back_the_complete_source_store() {
    let observed_epochs = Arc::new(Mutex::new(Vec::new()));
    let hook_epochs = Arc::clone(&observed_epochs);
    let fixture = Fixture::new_with_hook(move |store_epoch| {
        hook_epochs
            .lock()
            .expect("hook epochs")
            .push(store_epoch.to_owned());
        if store_epoch == STORE_EPOCH {
            return Ok(());
        }
        Err(StoreError::new(
            StoreErrorCode::Internal,
            "injected replacement hook failure",
            false,
        ))
    });
    fs::create_dir(fixture.home().join("assets")).expect("assets root");
    fs::write(fixture.home().join("assets/managed.bin"), b"backup asset").expect("backup asset");
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute_batch(
                "CREATE TABLE administration_restore_probe(\
                   id INTEGER PRIMARY KEY CHECK (id = 1), marker TEXT NOT NULL\
                 ) STRICT; \
                 INSERT INTO administration_restore_probe(id, marker) VALUES (1, 'backup');",
            )?;
            Ok(())
        })
        .expect("restore probe");
    let target = fixture.create_backup("administration:create-backup:hook-failure", None, true);
    let backup_id = target.committed.value.backup_id.expect("target backup");
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute(
                "UPDATE administration_restore_probe SET marker = 'current' WHERE id = 1",
                [],
            )?;
            Ok(())
        })
        .expect("current marker");
    fs::write(fixture.home().join("assets/managed.bin"), b"current asset").expect("current asset");

    let error = fixture
        .module
        .apply(
            &fixture.context(),
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: "administration:restore-backup:hook-failure".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: StoreAdministrationIntent::RestoreBackup {
                    backup_id,
                    create_safety_backup: false,
                },
            },
        )
        .expect_err("hook failure must reject restore");
    assert_eq!(error.code, CoreErrorCode::CoreUnavailable);
    let (marker, store_epoch) = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            Ok((
                connection.query_row(
                    "SELECT marker FROM administration_restore_probe WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )?,
                connection.query_row(
                    "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )?,
            ))
        })
        .expect("rolled back source");
    assert_eq!(marker, "current");
    assert_eq!(store_epoch, STORE_EPOCH);
    assert_eq!(
        fs::read(fixture.home().join("assets/managed.bin")).expect("source asset"),
        b"current asset"
    );
    let epochs = observed_epochs.lock().expect("observed epochs");
    assert_eq!(epochs.len(), 2);
    assert_ne!(epochs[0], STORE_EPOCH);
    assert_eq!(epochs[1], STORE_EPOCH);
}

#[test]
fn adopts_a_committed_restore_after_the_pre_receipt_crash_boundary() {
    let fixture = Fixture::new();
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute_batch(
                "CREATE TABLE administration_restore_adoption(\
                   id INTEGER PRIMARY KEY CHECK (id = 1), marker TEXT NOT NULL\
                 ) STRICT; \
                 INSERT INTO administration_restore_adoption(id, marker) VALUES (1, 'backup');",
            )?;
            Ok(())
        })
        .expect("restore adoption probe");
    let target =
        fixture.create_backup("administration:create-backup:restore-adoption", None, false);
    let backup_id = target.committed.value.backup_id.expect("target backup");
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute(
                "UPDATE administration_restore_adoption SET marker = 'current' WHERE id = 1",
                [],
            )?;
            Ok(())
        })
        .expect("current marker");

    let operation_id = "administration:restore-backup:adopt-committed";
    let create_safety_backup = false;
    let fingerprint = serde_json::to_vec(&(
        PROFILE_ID,
        LIBRARY_ID,
        CORE_CONTRACT_VERSION,
        "restore_backup",
        &backup_id,
        create_safety_backup,
    ))
    .expect("restore request fingerprint");
    let request_hash = super::sha256(&fingerprint);
    let home = fixture.home().to_path_buf();
    let backup_id_for_install = backup_id.clone();
    let installation = fixture
        .kernel
        .maintenance()
        .run(move |_| {
            super::restore::install_restore(super::restore::InstallRestoreRequest {
                profile_home: &home,
                profile_id: PROFILE_ID,
                library_id: LIBRARY_ID,
                operation_id,
                request_hash: &request_hash,
                requested_store_epoch: STORE_EPOCH,
                backup_id: &backup_id_for_install,
                create_safety_backup,
                existing_journal: None,
                replacement_hook: &|_| Ok(()),
            })
        })
        .expect("committed file replacement");
    assert_ne!(installation.installed_epoch, STORE_EPOCH);
    assert!(
        fixture
            .home()
            .join(".core-store-restore-journal.json")
            .exists()
    );
    let receipt_count = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            connection
                .query_row(
                    "SELECT count(*) FROM core_module_receipts \
                     WHERE module_name = 'store_administration' AND operation_id = ?1",
                    [operation_id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(Into::into)
        })
        .expect("receipt count before restore adoption");
    assert_eq!(receipt_count, 0);

    let adopted = fixture.restore_backup(operation_id, &backup_id, create_safety_backup);
    assert!(!adopted.committed.receipt.mutation.duplicate);
    assert_eq!(
        adopted.committed.store_epoch.0,
        installation.installed_epoch
    );
    assert!(adopted.event.is_some());
    assert!(
        !fixture
            .home()
            .join(".core-store-restore-journal.json")
            .exists()
    );
    let marker = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            connection
                .query_row(
                    "SELECT marker FROM administration_restore_adoption WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .map_err(Into::into)
        })
        .expect("adopted restore marker");
    assert_eq!(marker, "backup");
}

#[test]
fn rejects_a_corrupt_restore_candidate_without_touching_the_live_store() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.home().join("assets")).expect("assets root");
    fs::write(fixture.home().join("assets/managed.bin"), b"backup asset").expect("backup asset");
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute_batch(
                "CREATE TABLE administration_restore_corruption(\
                   id INTEGER PRIMARY KEY CHECK (id = 1), marker TEXT NOT NULL\
                 ) STRICT; \
                 INSERT INTO administration_restore_corruption(id, marker) VALUES (1, 'backup');",
            )?;
            Ok(())
        })
        .expect("restore corruption probe");
    let target = fixture.create_backup("administration:create-backup:corrupt-restore", None, true);
    let backup_id = target.committed.value.backup_id.expect("target backup");
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute(
                "UPDATE administration_restore_corruption SET marker = 'current' WHERE id = 1",
                [],
            )?;
            Ok(())
        })
        .expect("current marker");
    fs::write(fixture.home().join("assets/managed.bin"), b"current asset").expect("current asset");
    fs::write(
        fixture
            .home()
            .join("backups")
            .join(&backup_id)
            .join("nodex.db"),
        b"not a SQLite database",
    )
    .expect("corrupt backup database");

    let error = fixture
        .module
        .apply(
            &fixture.context(),
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: "administration:restore-backup:corrupt".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: StoreAdministrationIntent::RestoreBackup {
                    backup_id,
                    create_safety_backup: false,
                },
            },
        )
        .expect_err("corrupt candidate must be rejected");
    assert_eq!(error.code, CoreErrorCode::StoreCorrupt);
    let (marker, store_epoch) = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            Ok((
                connection.query_row(
                    "SELECT marker FROM administration_restore_corruption WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )?,
                connection.query_row(
                    "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )?,
            ))
        })
        .expect("unchanged live store");
    assert_eq!(marker, "current");
    assert_eq!(store_epoch, STORE_EPOCH);
    assert_eq!(
        fs::read(fixture.home().join("assets/managed.bin")).expect("live asset"),
        b"current asset"
    );
    assert!(
        !fixture
            .home()
            .join(".core-store-restore-journal.json")
            .exists()
    );
}

#[test]
fn deletes_one_backup_with_exact_replay_and_rejects_later_restore() {
    let fixture = Fixture::new();
    let target = fixture.create_backup("administration:create-backup:delete", None, false);
    let backup_id = target.committed.value.backup_id.expect("target backup");

    let deleted = fixture.delete_backup("administration:delete-backup:1", &backup_id);
    assert_eq!(
        deleted.committed.value.backup_id.as_deref(),
        Some(backup_id.as_str())
    );
    assert!(!deleted.committed.receipt.mutation.duplicate);
    assert_eq!(
        deleted
            .event
            .as_ref()
            .and_then(|event| match &event.payload {
                nodex_core_contracts::CoreModuleEventPayload::StoreAdministration(event) => {
                    Some(event.backup_ids.as_slice())
                }
                _ => None,
            }),
        Some([backup_id.clone()].as_slice())
    );
    assert!(!fixture.home().join("backups").join(&backup_id).exists());
    let StoreAdministrationReadValue::Backups { items } =
        fixture.read(StoreAdministrationRead::Backups)
    else {
        panic!("backup list")
    };
    assert!(items.is_empty());

    let retry = fixture.delete_backup("administration:delete-backup:1", &backup_id);
    assert!(retry.committed.receipt.mutation.duplicate);
    assert!(retry.event.is_none());
    let restore = fixture
        .module
        .apply(
            &fixture.context(),
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: "administration:restore-deleted-backup".to_owned(),
                store_epoch: StoreEpoch(STORE_EPOCH.to_owned()),
                intent: StoreAdministrationIntent::RestoreBackup {
                    backup_id,
                    create_safety_backup: false,
                },
            },
        )
        .expect_err("logically deleted backup cannot be restored");
    assert_eq!(restore.code, CoreErrorCode::NotFound);
}

#[test]
fn exact_delete_retry_finishes_physical_cleanup_after_receipt_commit() {
    let fixture = Fixture::new();
    let target = fixture.create_backup("administration:create-backup:delete-adoption", None, false);
    let backup_id = target.committed.value.backup_id.expect("target backup");
    let operation_id = "administration:delete-backup:adopt";
    let fingerprint = serde_json::to_vec(&(
        PROFILE_ID,
        LIBRARY_ID,
        CORE_CONTRACT_VERSION,
        StoreEpoch(STORE_EPOCH.to_owned()),
        "delete_backup",
        &backup_id,
    ))
    .expect("delete request fingerprint");
    let request_hash = super::sha256(&fingerprint);
    let context = fixture.context();
    let operation_id_for_write = operation_id.to_owned();
    let backup_id_for_write = backup_id.clone();
    fixture
        .kernel
        .writer()
        .call(move |connection| {
            let committed_at = super::sqlite_now(connection)?;
            super::finish_cleanup_operation(
                connection,
                LIBRARY_ID,
                &context,
                &operation_id_for_write,
                &request_hash,
                STORE_EPOCH,
                "delete_backup",
                Some(&backup_id_for_write),
                std::slice::from_ref(&backup_id_for_write),
                &committed_at,
            )
        })
        .expect("durable delete receipt");
    assert!(fixture.home().join("backups").join(&backup_id).exists());
    let StoreAdministrationReadValue::Backups { items } =
        fixture.read(StoreAdministrationRead::Backups)
    else {
        panic!("backup list")
    };
    assert!(items.is_empty());

    let retry = fixture.delete_backup(operation_id, &backup_id);
    assert!(retry.committed.receipt.mutation.duplicate);
    assert!(!fixture.home().join("backups").join(&backup_id).exists());
}

#[test]
fn prunes_only_automatic_backups_beyond_the_retention_count() {
    let fixture = Fixture::new();
    let mut automatic_ids = Vec::new();
    for index in 0..3 {
        let created = fixture.create_backup_with_trigger(
            &format!("administration:create-backup:auto-{index}"),
            Some(&format!("auto {index}")),
            false,
            BackupTrigger::Auto,
        );
        let backup_id = created.committed.value.backup_id.expect("auto backup");
        automatic_ids.push(backup_id);
    }
    let manual = fixture.create_backup(
        "administration:create-backup:manual-retained",
        Some("manual"),
        false,
    );
    let manual_id = manual.committed.value.backup_id.expect("manual backup");
    let automatic_inventory = super::backup::list_backup_inventory(fixture.home())
        .expect("backup inventory")
        .into_iter()
        .filter(|item| item.trigger == "auto")
        .map(|item| item.record.backup_id)
        .collect::<Vec<_>>();
    let retained_automatic = automatic_inventory[0].clone();
    let expected_removed = automatic_inventory[1..].to_vec();

    let pruned = fixture.prune_backups("administration:prune-backups:1", 1);
    let removed = pruned
        .event
        .as_ref()
        .and_then(|event| match &event.payload {
            nodex_core_contracts::CoreModuleEventPayload::StoreAdministration(event) => {
                Some(event.backup_ids.clone())
            }
            _ => None,
        })
        .expect("prune event");
    assert_eq!(removed, expected_removed);
    assert!(fixture.home().join("backups").join(&manual_id).exists());
    assert!(
        fixture
            .home()
            .join("backups")
            .join(&retained_automatic)
            .exists()
    );
    for backup_id in &expected_removed {
        assert!(!fixture.home().join("backups").join(backup_id).exists());
    }
    let StoreAdministrationReadValue::Backups { items } =
        fixture.read(StoreAdministrationRead::Backups)
    else {
        panic!("backup list")
    };
    assert_eq!(items.len(), 2);
    assert!(items.iter().any(|item| item.backup_id == manual_id));
    assert!(
        items
            .iter()
            .any(|item| item.backup_id == retained_automatic)
    );

    let retry = fixture.prune_backups("administration:prune-backups:1", 1);
    assert!(retry.committed.receipt.mutation.duplicate);
    assert!(retry.event.is_none());
    assert_eq!(automatic_ids.len(), 3);
}

#[test]
fn runs_supported_maintenance_in_module_owned_order_with_exact_replay() {
    let fixture = Fixture::new();
    let tasks = vec![
        MaintenanceTask::BlockRetention,
        MaintenanceTask::HistoryRetention,
        MaintenanceTask::DocumentCompaction,
        MaintenanceTask::DocumentRevisionFinalize,
        MaintenanceTask::ForeignKeyCheck,
        MaintenanceTask::IntegrityCheck,
    ];
    let maintained = fixture
        .run_maintenance("administration:maintenance:1", tasks)
        .expect("maintenance pass");
    assert_eq!(
        maintained.committed.value.completed_tasks,
        [
            MaintenanceTask::IntegrityCheck,
            MaintenanceTask::ForeignKeyCheck,
            MaintenanceTask::DocumentRevisionFinalize,
            MaintenanceTask::DocumentCompaction,
            MaintenanceTask::HistoryRetention,
            MaintenanceTask::BlockRetention,
        ]
    );
    assert!(maintained.event.is_some());
    assert_eq!(
        fixture.read(StoreAdministrationRead::Status),
        StoreAdministrationReadValue::Status {
            readiness: StoreReadiness::Ready,
            schema_version: 84,
            schema_owner: SchemaOwner::Rust,
            integrity: StoreIntegrity::Ok,
        }
    );

    let retry = fixture
        .run_maintenance(
            "administration:maintenance:1",
            vec![
                MaintenanceTask::IntegrityCheck,
                MaintenanceTask::ForeignKeyCheck,
                MaintenanceTask::DocumentRevisionFinalize,
                MaintenanceTask::DocumentCompaction,
                MaintenanceTask::HistoryRetention,
                MaintenanceTask::BlockRetention,
            ],
        )
        .expect("exact maintenance retry");
    assert!(retry.committed.receipt.mutation.duplicate);
    assert!(retry.event.is_none());

    let duplicate = fixture
        .run_maintenance(
            "administration:maintenance:duplicate-task",
            vec![
                MaintenanceTask::IntegrityCheck,
                MaintenanceTask::IntegrityCheck,
            ],
        )
        .expect_err("duplicate maintenance task");
    assert_eq!(duplicate.code, CoreErrorCode::InvalidInput);

    let orphaned_policy = fixture
        .run_maintenance_with_policy(
            "administration:maintenance:orphaned-policy",
            vec![MaintenanceTask::IntegrityCheck],
            Some(0),
        )
        .expect_err("Block retention policy without its task");
    assert_eq!(orphaned_policy.code, CoreErrorCode::InvalidInput);

    let policy = fixture
        .run_maintenance_with_policy(
            "administration:maintenance:policy",
            vec![MaintenanceTask::BlockRetention],
            Some(0),
        )
        .expect("configured Block retention");
    assert!(!policy.committed.receipt.mutation.duplicate);
    let policy_collision = fixture
        .run_maintenance_with_policy(
            "administration:maintenance:policy",
            vec![MaintenanceTask::BlockRetention],
            Some(1),
        )
        .expect_err("Block retention policy collision");
    assert_eq!(policy_collision.code, CoreErrorCode::IdempotencyKeyReused);
}

#[test]
fn failed_foreign_key_maintenance_marks_integrity_failed_without_a_receipt() {
    let fixture = Fixture::new();
    fixture
        .kernel
        .writer()
        .call(|connection| {
            connection.execute_batch(
                "PRAGMA foreign_keys = OFF; \
                 INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                 VALUES ('library:orphan', 'profile:missing', \
                   '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z'); \
                 PRAGMA foreign_keys = ON;",
            )?;
            Ok(())
        })
        .expect("foreign key corruption fixture");

    let error = fixture
        .run_maintenance(
            "administration:maintenance:foreign-key-failure",
            vec![MaintenanceTask::ForeignKeyCheck],
        )
        .expect_err("foreign key maintenance failure");
    assert_eq!(error.code, CoreErrorCode::StoreCorrupt);
    assert_eq!(
        fixture.read(StoreAdministrationRead::Status),
        StoreAdministrationReadValue::Status {
            readiness: StoreReadiness::Ready,
            schema_version: 84,
            schema_owner: SchemaOwner::Rust,
            integrity: StoreIntegrity::Failed,
        }
    );
    let receipt_exists = fixture
        .kernel
        .readers()
        .read_default(|connection| {
            connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM core_module_receipts \
                     WHERE module_name = 'store_administration' AND operation_id = ?1)",
                    ["administration:maintenance:foreign-key-failure"],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(Into::into)
        })
        .expect("failed maintenance receipt existence");
    assert_eq!(receipt_exists, 0);
}
