use std::fs;
use std::path::{Path, PathBuf};

use super::migration::{StorePreparation, prepare_profile_store};
use super::sqlite::{StoreError, StoreErrorCode, open_writer};
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
}

impl SqliteStoreKernel {
    pub fn open(profile_home: &Path) -> Result<Self, StoreError> {
        let lock = ProfileStoreLock::acquire(profile_home)?;
        recover_interrupted_store_replacement(profile_home)?;
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
        let preparation = prepare_profile_store(&mut migration_connection, profile_home)?;
        drop(migration_connection);

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
}
