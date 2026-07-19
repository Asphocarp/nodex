use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

use nodex_core_contracts::administration::{
    SchemaOwner, StoreAdministrationIntent, StoreAdministrationRead, StoreAdministrationReadValue,
    StoreIntegrity, StoreReadiness,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, CoreErrorCode, LibraryId,
    ModuleApplyRequest, ModuleReadRequest, ProfileId, StoreEpoch,
};
use tempfile::TempDir;

use crate::infrastructure::sqlite::with_immediate_transaction;
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
        let module = StoreAdministrationModule::new(PROFILE_ID, LIBRARY_ID, &kernel);
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
                    },
                },
            )
            .expect("create backup")
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
            schema_version: 83,
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
    assert_eq!(items[0].label.as_deref(), Some("before refactor"));
    assert!(items[0].byte_length > b"managed asset".len() as u64);

    assert_eq!(
        fixture.read(StoreAdministrationRead::Status),
        StoreAdministrationReadValue::Status {
            readiness: StoreReadiness::Ready,
            schema_version: 83,
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
