mod read;

use nodex_core_contracts::workspace::{ProjectWorkspaceRead, ProjectWorkspaceReadValue};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CoreError, CoreErrorCode, CoreErrorRecovery,
    ModuleReadRequest, ModuleReadSnapshot, StoreEpoch,
};
use rusqlite::OptionalExtension;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::StoreReaders;

pub struct ProjectWorkspaceModule {
    profile_id: String,
    library_id: String,
    readers: Option<StoreReaders>,
}

impl ProjectWorkspaceModule {
    pub fn new(
        profile_id: impl Into<String>,
        library_id: impl Into<String>,
        kernel: &SqliteStoreKernel,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            library_id: library_id.into(),
            readers: Some(kernel.readers()),
        }
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<ProjectWorkspaceRead>,
    ) -> Result<ModuleReadSnapshot<ProjectWorkspaceReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid("unsupported Project Workspace contract version"));
        }
        let Some(readers) = &self.readers else {
            return Err(unavailable("Project Workspace Module has no durable store"));
        };
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        readers
            .read_default(move |connection| {
                let identity = connection
                    .query_row(
                        "SELECT 1 FROM libraries WHERE id = ?1 AND profile_id = ?2",
                        rusqlite::params![library_id, profile_id],
                        |_| Ok(()),
                    )
                    .optional()?;
                if identity.is_none() {
                    return Err(StoreError::new(
                        StoreErrorCode::Unauthorized,
                        "bound Project Workspace identity is not present in this Profile store",
                        false,
                    ));
                }
                let store_epoch = connection
                    .query_row(
                        "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| corrupt("Profile store epoch is unavailable"))?;
                let event_head = connection.query_row(
                    "SELECT COALESCE(max(seq), 0) FROM change_log",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                Ok(ModuleReadSnapshot {
                    version: CORE_CONTRACT_VERSION,
                    store_epoch: StoreEpoch(store_epoch),
                    event_head,
                    value: read::read(connection, &library_id, request.read)?,
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
            message: "bound Adapter identity does not match this Project Workspace Module"
                .to_owned(),
            retryable: false,
            recovery: CoreErrorRecovery::None,
        })
    }
}

impl Default for ProjectWorkspaceModule {
    fn default() -> Self {
        Self {
            profile_id: "probe-profile".to_owned(),
            library_id: "probe-library".to_owned(),
            readers: None,
        }
    }
}

fn core_error(error: StoreError) -> CoreError {
    let code = match error.code {
        StoreErrorCode::InvalidInput => CoreErrorCode::InvalidInput,
        StoreErrorCode::NotFound => CoreErrorCode::NotFound,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        StoreErrorCode::Unauthorized => CoreErrorCode::Unauthorized,
        StoreErrorCode::Conflict
        | StoreErrorCode::HeadConflict
        | StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::GenerationConflict => CoreErrorCode::GenerationConflict,
        StoreErrorCode::MissingDependencies => CoreErrorCode::DocumentUpdateMissingDependencies,
        StoreErrorCode::UnsupportedSchema
        | StoreErrorCode::AlreadyOwned
        | StoreErrorCode::InvalidProfile
        | StoreErrorCode::RuntimeIncompatible => CoreErrorCode::SchemaUnsupported,
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

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
