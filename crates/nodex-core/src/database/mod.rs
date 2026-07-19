mod genesis;
mod mutation;
pub(crate) mod read;

pub(crate) use genesis::create_database_authority_records;
pub(crate) use mutation::{
    PageCopyDataSourceDestination, PageCopyPositionAnchor, PageCopyValueDraft,
    PageCopyViewPlacement, place_copied_page_in_data_source,
    refresh_transferred_page_projection as refresh_copied_page_projection,
    resolve_page_copy_data_source_project,
};

use nodex_core_contracts::database::{
    DatabaseCommitValue, DatabaseIntent, DatabaseRead, DatabaseReadValue, DatabaseReceipt,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreError, CoreErrorCode, CoreErrorRecovery, ModuleApplyRequest, ModuleReadRequest,
    ModuleReadSnapshot,
};
use rusqlite::OptionalExtension;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

#[derive(Clone, Debug)]
pub struct DatabaseApplyOutcome {
    pub committed: CommittedModuleValue<DatabaseCommitValue, DatabaseReceipt>,
    pub event: Option<CommittedCoreModuleEvent>,
}

pub struct DatabaseModule {
    profile_id: String,
    library_id: String,
    readers: Option<StoreReaders>,
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

    pub fn apply(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<Vec<DatabaseIntent>>,
    ) -> Result<DatabaseApplyOutcome, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid("unsupported Database contract version"));
        }
        let Some(writer) = &self.writer else {
            return Err(unavailable("Database Module has no durable store"));
        };
        mutation::apply(writer, &self.profile_id, &self.library_id, context, request)
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
        StoreErrorCode::MaintenanceInProgress => CoreErrorCode::MaintenanceInProgress,
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
    use nodex_core_contracts::database::{
        DatabaseIntent, DatabaseReadMode, DatabaseTarget, DatabaseTransferTarget,
    };
    use nodex_core_contracts::library::{LibraryIntent, LibraryWriteParent};
    use nodex_core_contracts::{
        AdapterKind, LibraryId, ModuleApplyRequest, ProfileId, ProjectId, StoreEpoch,
    };
    use rusqlite::params;
    use serde_json::{Value, json};
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

        let request = ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: "operation:database-schema-values".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: vec![
                DatabaseIntent::PutProperty {
                    data_source_id: SOURCE_ID.to_owned(),
                    property_id: "risk".to_owned(),
                    expected_data_source_revision: 1,
                    expected_property_revision: 0,
                    name: "Risk".to_owned(),
                    value_type: "select".to_owned(),
                    before_property_id: Some("tags".to_owned()),
                },
                DatabaseIntent::PutOption {
                    data_source_id: SOURCE_ID.to_owned(),
                    property_id: "risk".to_owned(),
                    option_id: "high".to_owned(),
                    name: "High".to_owned(),
                    color: Some("red".to_owned()),
                    expected_property_revision: 1,
                },
                DatabaseIntent::SetValue {
                    page_id: "page:database-row".to_owned(),
                    data_source_id: SOURCE_ID.to_owned(),
                    property_id: "risk".to_owned(),
                    expected_value_revision: 0,
                    value: json!("high"),
                },
            ],
        };
        let applied = module
            .apply(&context(), request.clone())
            .expect("commit schema and value batch");
        assert_eq!(applied.committed.value.operation_count, 3);
        assert!(!applied.committed.receipt.mutation.duplicate);
        assert_eq!(
            applied.committed.receipt.affected_database_ids,
            [DATABASE_ID]
        );
        assert_eq!(
            applied.committed.receipt.affected_page_ids,
            ["page:database-row"]
        );
        assert!(applied.event.is_some());

        let replayed = module
            .apply(&context(), request.clone())
            .expect("replay exact Database batch");
        assert!(replayed.committed.receipt.mutation.duplicate);
        assert_eq!(
            replayed.committed.event_sequence,
            applied.committed.event_sequence
        );
        assert!(replayed.event.is_none());

        let mut divergent = request;
        divergent.intent.push(DatabaseIntent::SetValue {
            page_id: "page:database-row".to_owned(),
            data_source_id: SOURCE_ID.to_owned(),
            property_id: "risk".to_owned(),
            expected_value_revision: 1,
            value: Value::Null,
        });
        let collision = module
            .apply(&context(), divergent)
            .expect_err("reject divergent Database retry");
        assert_eq!(collision.code, CoreErrorCode::IdempotencyKeyReused);

        let rollback = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-rollback".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![
                        DatabaseIntent::PutProperty {
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "score".to_owned(),
                            expected_data_source_revision: 3,
                            expected_property_revision: 0,
                            name: "Score".to_owned(),
                            value_type: "number".to_owned(),
                            before_property_id: None,
                        },
                        DatabaseIntent::SetValue {
                            page_id: "page:database-row".to_owned(),
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "status".to_owned(),
                            expected_value_revision: 99,
                            value: json!("build"),
                        },
                    ],
                },
            )
            .expect_err("roll back an invalid Database batch");
        assert_eq!(rollback.code, CoreErrorCode::RevisionConflict);

        let value = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::Query,
                        filter: None,
                        sort: None,
                    },
                },
            )
            .expect("read committed Database value");
        let DatabaseReadValue::DataSourceQuery { value } = value.value else {
            panic!("Data Source query snapshot");
        };
        assert_eq!(value["dataSource"]["schemaRevision"], 3);
        assert_eq!(value["properties"].as_array().map(Vec::len), Some(9));
        assert_eq!(value["rows"][0]["values"]["risk"]["value"], "high");
        assert!(value["properties"].as_array().is_some_and(|properties| {
            properties
                .iter()
                .all(|value| value["propertyId"] != "score")
        }));

        const SECOND_VIEW_ID: &str = "018f1000-0000-7000-8000-000000000004";
        let ungrouped_config = json!({
            "schemaKey": "nodex.database-view",
            "schemaVersion": 2,
            "filter": { "kind": "group", "operator": "and", "children": [] },
            "sort": [{
                "field": { "kind": "manual" },
                "direction": "asc",
                "nulls": "last"
            }],
            "group": null,
            "display": {
                "propertyIds": ["status", "risk"],
                "showTitle": true
            }
        });
        let view_and_position = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-view-position".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![
                        DatabaseIntent::PutView {
                            database_id: DATABASE_ID.to_owned(),
                            data_source_id: SOURCE_ID.to_owned(),
                            view_id: SECOND_VIEW_ID.to_owned(),
                            expected_revision: 0,
                            name: "Risk list".to_owned(),
                            view_kind: "list".to_owned(),
                            config: ungrouped_config.clone(),
                            is_default: true,
                            before_view_id: Some(VIEW_ID.to_owned()),
                        },
                        DatabaseIntent::PositionPage {
                            view_id: SECOND_VIEW_ID.to_owned(),
                            page_id: "page:database-row".to_owned(),
                            expected_position_revision: 0,
                            group_key: None,
                            before_page_id: None,
                        },
                    ],
                },
            )
            .expect("create default View and position its row atomically");
        assert_eq!(view_and_position.committed.value.operation_count, 2);
        assert_eq!(
            view_and_position.committed.receipt.affected_view_ids,
            [SECOND_VIEW_ID]
        );

        let grouped_config = json!({
            "schemaKey": "nodex.database-view",
            "schemaVersion": 2,
            "filter": { "kind": "group", "operator": "and", "children": [] },
            "sort": [{
                "field": { "kind": "manual" },
                "direction": "asc",
                "nulls": "last"
            }],
            "group": { "propertyId": "risk" },
            "display": {
                "propertyIds": ["status", "risk"],
                "showTitle": true
            }
        });
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-view-regroup".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![
                        DatabaseIntent::PutView {
                            database_id: DATABASE_ID.to_owned(),
                            data_source_id: SOURCE_ID.to_owned(),
                            view_id: SECOND_VIEW_ID.to_owned(),
                            expected_revision: 1,
                            name: "Risk board".to_owned(),
                            view_kind: "kanban".to_owned(),
                            config: grouped_config,
                            is_default: true,
                            before_view_id: None,
                        },
                        DatabaseIntent::PositionPage {
                            view_id: SECOND_VIEW_ID.to_owned(),
                            page_id: "page:database-row".to_owned(),
                            expected_position_revision: 0,
                            group_key: Some("high".to_owned()),
                            before_page_id: None,
                        },
                    ],
                },
            )
            .expect("clear stale positions and position against the new group");
        let grouped = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: SECOND_VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::Query,
                        filter: None,
                        sort: None,
                    },
                },
            )
            .expect("query regrouped View");
        let DatabaseReadValue::Query { value: grouped } = grouped.value else {
            panic!("View query snapshot");
        };
        assert_eq!(grouped["view"]["isDefault"], true);
        assert_eq!(grouped["view"]["revision"], 2);
        assert_eq!(grouped["rows"][0]["position"]["groupKey"], "high");
        assert_eq!(grouped["rows"][0]["position"]["revision"], 1);

        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-delete-old-view".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::DeleteView {
                        database_id: DATABASE_ID.to_owned(),
                        view_id: VIEW_ID.to_owned(),
                        expected_revision: 1,
                    }],
                },
            )
            .expect("delete a non-default View");
        let old_view = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::View,
                        filter: None,
                        sort: None,
                    },
                },
            )
            .expect("read deleted View descriptor");
        let DatabaseReadValue::View { value: old_view } = old_view.value else {
            panic!("View descriptor snapshot");
        };
        assert_eq!(old_view["lifecycle"], "deleted");
        assert_eq!(old_view["revision"], 2);

        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-row-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::TransferPage {
                        page_id: "page:database-row".to_owned(),
                        expected_parent_revision: 1,
                        expected_active_membership_revision: 1,
                        target: DatabaseTransferTarget::Library {
                            library_id: "library-1".to_owned(),
                        },
                    }],
                },
            )
            .expect("transfer a Database row back to the Library");
        let empty_source = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::Query,
                        filter: None,
                        sort: None,
                    },
                },
            )
            .expect("read source after row transfer");
        let DatabaseReadValue::DataSourceQuery {
            value: empty_source,
        } = empty_source.value
        else {
            panic!("Data Source query snapshot");
        };
        assert_eq!(empty_source["rows"].as_array().map(Vec::len), Some(0));

        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-row-return".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::TransferPage {
                        page_id: "page:database-row".to_owned(),
                        expected_parent_revision: 2,
                        expected_active_membership_revision: 0,
                        target: DatabaseTransferTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                    }],
                },
            )
            .expect("restore the historical Data Source membership");
        let returned = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::Query,
                        filter: None,
                        sort: None,
                    },
                },
            )
            .expect("read restored Database row");
        let DatabaseReadValue::DataSourceQuery { value: returned } = returned.value else {
            panic!("Data Source query snapshot");
        };
        assert_eq!(returned["rows"][0]["membership"]["revision"], 3);
        assert_eq!(returned["rows"][0]["values"]["risk"]["value"], "high");
        let page_parent_rejection = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "operation:database-page-parent-rejected".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::TransferPage {
                        page_id: "page:database-row".to_owned(),
                        expected_parent_revision: 3,
                        expected_active_membership_revision: 3,
                        target: DatabaseTransferTarget::Page {
                            page_id: "page:database-row".to_owned(),
                        },
                    }],
                },
            )
            .expect_err("Page-parent transfers require Document authority");
        assert_eq!(page_parent_rejection.code, CoreErrorCode::InvalidInput);

        let database_events = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT count(*) FROM change_log WHERE kind = 'database.changed'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("count Database events");
        assert_eq!(database_events, 6);
    }
}
