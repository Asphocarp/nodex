use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::document::DocumentRuntimeCache;

use super::event_log::validate_local_commit_index;
use super::legacy_migration::migrate_legacy_profile_if_needed_with_observer;
use super::migration::{
    StorePreparation, StorePreparationEvent, prepare_profile_store_with_observer,
};
#[cfg(test)]
use super::schema::CURRENT_STORE_REVISION;
use super::sqlite::{StoreError, StoreErrorCode, open_writer, optimize_query_planner_on_open};
use super::store_lock::ProfileStoreLock;
use super::store_replacement::recover_interrupted_store_replacement;
use super::writer::{
    DEFAULT_READ_CONNECTIONS, DEFAULT_WRITER_QUEUE_CAPACITY, StoreMaintenance, StoreReaders,
    StoreRuntime, StoreRuntimeActivity, StoreRuntimeMetrics, StoreWriter,
};

pub const STORE_FILE_NAME: &str = "nodex.db";

pub struct SqliteStoreKernel {
    preparation: StorePreparation,
    runtime: StoreRuntime,
    _lock: ProfileStoreLock,
    database_path: PathBuf,
    document_runtime_cache: Arc<Mutex<DocumentRuntimeCache>>,
}

impl SqliteStoreKernel {
    pub fn open(profile_home: &Path) -> Result<Self, StoreError> {
        Self::open_with_observer(profile_home, |_| {})
    }

    #[cfg(test)]
    pub fn open_test(profile_home: &Path) -> Result<Self, StoreError> {
        let lock = ProfileStoreLock::acquire(profile_home)?;
        let database_path = profile_home.join(STORE_FILE_NAME);
        let mut connection = open_writer(&database_path)?;
        super::migration::prepare_test_current_store(&mut connection, profile_home)?;
        optimize_query_planner_on_open(&connection)?;
        drop(connection);
        Self::start_runtime(
            database_path,
            StorePreparation {
                schema_version: CURRENT_STORE_REVISION,
                created_fresh: false,
                migrated_from_version: None,
                migration_backup_path: None,
                validated_yjs_documents: 0,
            },
            lock,
        )
    }

    pub fn open_with_observer(
        profile_home: &Path,
        mut observer: impl FnMut(StorePreparationEvent),
    ) -> Result<Self, StoreError> {
        let lock = ProfileStoreLock::acquire(profile_home)?;
        recover_interrupted_store_replacement(profile_home)?;
        let legacy_preparation =
            migrate_legacy_profile_if_needed_with_observer(profile_home, &mut observer)?;
        let database_path = profile_home.join(STORE_FILE_NAME);
        if fs::symlink_metadata(&database_path)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(StoreError::new(
                StoreErrorCode::InvalidProfile,
                "Profile database must not be a symlink",
                false,
            ));
        }
        let mut migration_connection = open_writer(&database_path)?;
        let preparation = match legacy_preparation {
            Some(preparation) => preparation,
            None => prepare_profile_store_with_observer(
                &mut migration_connection,
                profile_home,
                &mut observer,
            )?,
        };
        validate_local_commit_index(&migration_connection)?;
        optimize_query_planner_on_open(&migration_connection)?;
        drop(migration_connection);

        Self::start_runtime(database_path, preparation, lock)
    }

    fn start_runtime(
        database_path: PathBuf,
        preparation: StorePreparation,
        lock: ProfileStoreLock,
    ) -> Result<Self, StoreError> {
        let runtime = StoreRuntime::start(
            &database_path,
            DEFAULT_WRITER_QUEUE_CAPACITY,
            DEFAULT_READ_CONNECTIONS,
        )?;
        Ok(Self {
            preparation,
            runtime,
            _lock: lock,
            database_path,
            document_runtime_cache: Arc::new(Mutex::new(DocumentRuntimeCache::new())),
        })
    }

    pub fn preparation(&self) -> &StorePreparation {
        &self.preparation
    }

    pub fn writer(&self) -> StoreWriter {
        self.runtime.writer()
    }

    pub fn readers(&self) -> StoreReaders {
        self.runtime.readers()
    }

    pub fn maintenance(&self) -> StoreMaintenance {
        self.runtime.maintenance()
    }

    pub fn activity(&self) -> StoreRuntimeActivity {
        self.runtime.activity()
    }

    pub fn metrics(&self) -> StoreRuntimeMetrics {
        self.runtime.metrics()
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub(crate) fn document_runtime_cache(&self) -> Arc<Mutex<DocumentRuntimeCache>> {
        Arc::clone(&self.document_runtime_cache)
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn test_store_template_remints_profile_secrets() {
        let first_home = tempdir().expect("first Profile");
        let second_home = tempdir().expect("second Profile");
        let first = SqliteStoreKernel::open_test(first_home.path()).expect("first test Store");
        let second = SqliteStoreKernel::open_test(second_home.path()).expect("second test Store");

        let first_secrets = read_profile_secrets(&first);
        let second_secrets = read_profile_secrets(&second);

        assert_ne!(first_secrets.0, second_secrets.0);
        assert_ne!(first_secrets.1, second_secrets.1);
    }

    fn read_profile_secrets(kernel: &SqliteStoreKernel) -> (Vec<u8>, String) {
        kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT token.key_material, runtime.jitter_salt \
                         FROM nodex_agent_token_keys token \
                         CROSS JOIN core_automation_runtime_metadata runtime \
                         WHERE token.id = 1 AND runtime.id = 1",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .map_err(StoreError::from)
            })
            .expect("profile secrets")
    }
}
