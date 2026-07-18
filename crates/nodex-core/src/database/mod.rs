mod read;

use nodex_core_contracts::database::{DatabaseRead, DatabaseReadValue};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CoreError, CoreErrorCode, CoreErrorRecovery,
    ModuleReadRequest, ModuleReadSnapshot,
};
use rusqlite::OptionalExtension;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

pub struct DatabaseModule {
    profile_id: String,
    library_id: String,
    readers: Option<StoreReaders>,
    #[allow(dead_code)]
    writer: Option<StoreWriter>,
}

impl DatabaseModule {
    pub fn new(
        profile_id: impl Into<String>,
        library_id: impl Into<String>,
        kernel: &SqliteStoreKernel,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            library_id: library_id.into(),
            readers: Some(kernel.readers()),
            writer: Some(kernel.writer()),
        }
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<DatabaseRead>,
    ) -> Result<ModuleReadSnapshot<DatabaseReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid("unsupported Database contract version"));
        }
        let Some(readers) = &self.readers else {
            return Err(unavailable("Database Module has no durable store"));
        };
        let profile_id = self.profile_id.clone();
        let library_id = self.library_id.clone();
        let context = context.clone();
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
                        "bound Database identity is not present in this Profile store",
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
                let value = read::read(connection, &library_id, &context, request.read)?;
                Ok(ModuleReadSnapshot {
                    version: CORE_CONTRACT_VERSION,
                    store_epoch: nodex_core_contracts::StoreEpoch(store_epoch),
                    event_head,
                    value,
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
            message: "bound Adapter identity does not match this Database Module".to_owned(),
            retryable: false,
            recovery: CoreErrorRecovery::None,
        })
    }
}

impl Default for DatabaseModule {
    fn default() -> Self {
        Self {
            profile_id: "probe-profile".to_owned(),
            library_id: "probe-library".to_owned(),
            readers: None,
            writer: None,
        }
    }
}

fn core_error(error: StoreError) -> CoreError {
    let code = match error.code {
        StoreErrorCode::InvalidInput => CoreErrorCode::InvalidInput,
        StoreErrorCode::NotFound => CoreErrorCode::NotFound,
        StoreErrorCode::Conflict
        | StoreErrorCode::HeadConflict
        | StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::UnsupportedSchema => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        StoreErrorCode::Unauthorized => CoreErrorCode::Unauthorized,
        StoreErrorCode::GenerationConflict => CoreErrorCode::GenerationConflict,
        StoreErrorCode::MissingDependencies => CoreErrorCode::DocumentUpdateMissingDependencies,
        StoreErrorCode::WriterQueueFull
        | StoreErrorCode::WriterClosed
        | StoreErrorCode::ReaderPoolTimeout
        | StoreErrorCode::QueryCancelled
        | StoreErrorCode::SqliteBusy
        | StoreErrorCode::SqliteFailure
        | StoreErrorCode::Internal => CoreErrorCode::CoreUnavailable,
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

#[cfg(test)]
mod tests {
    use nodex_core_contracts::database::{DatabaseReadMode, DatabaseTarget};
    use nodex_core_contracts::library::{LibraryIntent, LibraryWriteParent};
    use nodex_core_contracts::{
        AdapterKind, LibraryId, ModuleApplyRequest, ProfileId, ProjectId, StoreEpoch,
    };
    use rusqlite::params;
    use serde_json::json;
    use tempfile::tempdir;

    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::library::LibraryModule;

    use super::*;

    const DATABASE_ID: &str = "018f1000-0000-7000-8000-000000000001";
    const SOURCE_ID: &str = "018f1000-0000-7000-8000-000000000002";
    const VIEW_ID: &str = "018f1000-0000-7000-8000-000000000003";
    const NOW: &str = "2026-07-19T00:15:00.000Z";

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:database-read".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    #[test]
    fn reads_catalog_descriptors_views_and_filtered_rows_from_one_authority() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
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
                         VALUES ('project-1', 'library-1', 'Database reads', ?1, ?1)",
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
            .expect("seed identity");
        let library = LibraryModule::new("profile-1", "library-1", &kernel);
        library
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-read-fixture".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: DATABASE_ID.to_owned(),
                        data_source_id: SOURCE_ID.to_owned(),
                        view_id: VIEW_ID.to_owned(),
                        name: "Product work".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create Database");
        library
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-row-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:database-row".to_owned(),
                        document_id: "document:database-row".to_owned(),
                        title: "Fix sign-in".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create Page");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                        [DATABASE_ID],
                    )?;
                    transaction.execute(
                        "DELETE FROM library_block_placements WHERE block_id = 'page:database-row'",
                        [],
                    )?;
                    transaction.execute(
                        "DELETE FROM top_level_block_placements WHERE block_id = 'page:database-row'",
                        [],
                    )?;
                    transaction.execute(
                        "UPDATE blocks SET location_kind = 'database', containing_document_id = NULL, \
                           containing_database_id = ?1 WHERE id = 'page:database-row'",
                        [DATABASE_ID],
                    )?;
                    transaction.execute(
                        "UPDATE pages SET parent_kind = 'data_source', parent_id = ?1 \
                         WHERE block_id = 'page:database-row'",
                        [SOURCE_ID],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_page_memberships(\
                           id, data_source_id, page_block_id, revision, created_at, removed_at\
                         ) VALUES ('membership:row', ?1, 'page:database-row', 1, ?2, NULL)",
                        params![SOURCE_ID, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_property_values(\
                           data_source_id, membership_id, property_id, value_type, value_json, \
                           revision, updated_at\
                         ) VALUES (?1, 'membership:row', 'status', 'select', '\"triage\"', 1, ?2)",
                        params![SOURCE_ID, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO database_view_page_positions(\
                           view_id, page_block_id, group_key, rank_key, revision, created_at, updated_at\
                         ) VALUES (?1, 'page:database-row', 'triage', 'a', 1, ?2, ?2)",
                        params![VIEW_ID, NOW],
                    )?;
                    transaction.execute(
                        "UPDATE page_read_model SET location_kind = 'database', \
                           containing_document_id = NULL, containing_database_id = ?1, \
                           top_level_rank_key = NULL, membership_id = 'membership:row', \
                           database_block_id = ?1, view_id = ?2, view_group_key = 'triage', \
                           view_rank_key = 'a', database_values_json = '{\"status\":\"triage\"}' \
                         WHERE page_block_id = 'page:database-row'",
                        params![DATABASE_ID, VIEW_ID],
                    )?;
                    Ok(())
                })
            })
            .expect("place Database row");
        let module = DatabaseModule::new("profile-1", "library-1", &kernel);

        let catalog = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::ProjectDefault,
                        mode: DatabaseReadMode::Catalog,
                        filter: None,
                        sort: None,
                    },
                },
            )
            .expect("read catalog");
        let DatabaseReadValue::Catalog { databases } = catalog.value else {
            panic!("catalog snapshot");
        };
        assert_eq!(databases.len(), 1);
        assert_eq!(databases[0]["dataSources"][0]["dataSourceId"], SOURCE_ID);
        assert_eq!(databases[0]["views"][0]["isDefault"], true);

        let query = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::Query,
                        filter: Some(json!({
                            "kind": "clause",
                            "propertyId": "status",
                            "operator": "equals",
                            "value": "triage"
                        })),
                        sort: Some(vec![json!({
                            "field": { "kind": "title" },
                            "direction": "asc",
                            "nulls": "last"
                        })]),
                    },
                },
            )
            .expect("query Data Source");
        let DatabaseReadValue::DataSourceQuery { value } = query.value else {
            panic!("Data Source query snapshot");
        };
        assert_eq!(value["properties"].as_array().map(Vec::len), Some(8));
        assert_eq!(value["rows"][0]["page"]["title"], "Fix sign-in");
        assert_eq!(value["rows"][0]["values"]["status"]["value"], "triage");
    }
}
