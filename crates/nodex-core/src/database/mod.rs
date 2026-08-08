pub(crate) mod authorization;
mod genesis;
mod mutation;
mod projection_delta;
pub(crate) mod property_semantics;
pub(crate) mod read;
mod relation;
mod window;

pub(crate) const MAX_PROPERTY_OPTIONS: usize = 100;
pub(crate) const MAX_DATA_SOURCE_PROPERTIES: usize = 200;
pub(crate) const MAX_DATABASE_VIEWS: usize = 200;

pub(crate) use genesis::create_database_authority_records;
pub(crate) use mutation::apply_as_collaborator as apply_intents_as_collaborator;
pub(crate) use mutation::{
    ExistingPageTransferTarget, PageCopyDataSourceDestination, PageCopyPositionAnchor,
    PageCopyValueDraft, PageCopyViewPlacement, StagedPagePlacementRevisions, active_property,
    finalize_agent_moved_pages_in_data_source_prevalidated, normalize_value,
    place_copied_page_in_data_source, place_copied_page_in_data_source_prevalidated,
    place_staged_page_in_data_source, place_staged_page_in_data_source_prevalidated,
    refresh_transferred_page_projection as refresh_copied_page_projection,
    resolve_page_copy_data_source_project, resolve_page_copy_data_source_project_prevalidated,
    resolve_page_copy_data_source_source, resolve_page_transfer_data_source_destination,
    resolve_page_transfer_data_source_destination_prevalidated,
    resolve_page_transfer_data_source_source, transfer_existing_page_for_agent_move_prevalidated,
    transfer_existing_page_for_block_transfer,
};
pub(crate) use projection_delta::record_local_projection_delta;
pub(crate) use window::{default_page_move_view_id, mint_page_move_etag};

use nodex_core_contracts::database::{
    DatabaseCommitValue, DatabaseIntent, DatabaseRead, DatabaseReadValue, DatabaseReceipt,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CommittedCoreModuleEvent, CoreError, CoreErrorCode,
    CoreErrorRecovery, DATABASE_CONTRACT_VERSION, ModuleApplyRequest, ModuleReadRequest,
    ModuleReadSnapshot,
};
use rusqlite::OptionalExtension;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

#[derive(Clone, Debug)]
pub struct DatabaseApplyOutcome {
    pub committed: crate::ModuleWriterResult<DatabaseCommitValue, DatabaseReceipt>,
    pub event: Option<CommittedCoreModuleEvent>,
}

pub(crate) fn is_trusted_library_database_context(context: &BoundModuleContext) -> bool {
    context.project_id.is_none()
        && matches!(
            context.adapter,
            AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
        )
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
        if request.contract_version != DATABASE_CONTRACT_VERSION {
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
                let transaction = connection.unchecked_transaction()?;
                let identity = transaction
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
                let store_epoch = transaction
                    .query_row(
                        "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| corrupt("Profile store epoch is unavailable"))?;
                let commit_seq = crate::infrastructure::local_commit::head(&transaction)?;
                let value = read::read_at_commit_head(
                    &transaction,
                    &library_id,
                    commit_seq,
                    &context,
                    request.read,
                )?;
                transaction.commit()?;
                Ok(ModuleReadSnapshot {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    store_epoch: nodex_core_contracts::StoreEpoch(store_epoch),
                    commit_head: commit_seq,
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
        if request.contract_version != DATABASE_CONTRACT_VERSION {
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
        StoreErrorCode::PatchNotFound => CoreErrorCode::PatchNotFound,
        StoreErrorCode::PatchAmbiguous => CoreErrorCode::PatchAmbiguous,
        StoreErrorCode::PatchOverlap => CoreErrorCode::PatchOverlap,
        StoreErrorCode::StaleStoreEpoch => CoreErrorCode::StaleStoreEpoch,
        StoreErrorCode::Conflict
        | StoreErrorCode::HeadConflict
        | StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::ProtectedOwnerDeletion => CoreErrorCode::ProtectedOwnerDeletion,
        StoreErrorCode::UnsupportedSchema => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        StoreErrorCode::MaintenanceInProgress => CoreErrorCode::MaintenanceInProgress,
        StoreErrorCode::ResourceExhausted => CoreErrorCode::ResourceExhausted,
        StoreErrorCode::Unauthorized => CoreErrorCode::Unauthorized,
        StoreErrorCode::GenerationConflict => CoreErrorCode::GenerationConflict,
        StoreErrorCode::MissingDependencies => CoreErrorCode::DocumentUpdateMissingDependencies,
        StoreErrorCode::MaterializationStale => CoreErrorCode::MaterializationStale,
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
    use base64::prelude::{BASE64_URL_SAFE_NO_PAD, Engine as _};
    use std::collections::BTreeMap;

    use nodex_core_contracts::agent::{AgentExecutionAuthorization, AgentTurnProvenance};
    use nodex_core_contracts::collection::CollectionWindowRequest;
    use nodex_core_contracts::database::{
        DatabaseAgentQuery, DatabaseGroupScope, DatabaseIntent, DatabasePagePropertyAddress,
        DatabasePropertySchema, DatabasePropertySetDelta, DatabasePropertyValueEdit,
        DatabasePropertyValueInput, DatabasePropertyValueMutation, DatabaseReadMode,
        DatabaseTarget, DatabaseTransferTarget,
    };
    use nodex_core_contracts::library::{
        LIBRARY_CONTRACT_VERSION, LibraryIntent, LibraryWriteParent,
    };
    use nodex_core_contracts::workspace::{
        PROJECT_WORKSPACE_CONTRACT_VERSION, ProjectWorkspaceIntent, ProjectWorkspaceThreadPatch,
        ProjectWorkspaceTurnAuthority, ProjectWorkspaceTurnAuthorityScope,
        ProjectWorkspaceTurnAuthoritySource,
    };
    use nodex_core_contracts::{
        AdapterKind, CoreModuleEventPayload, LibraryId, ModuleApplyRequest, ProfileId, ProjectId,
        ProjectionImpact, StoreEpoch,
    };
    use rusqlite::params;
    use serde_json::json;
    use tempfile::tempdir;

    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::library::LibraryModule;
    use crate::workspace::ProjectWorkspaceModule;

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

    fn library_context(adapter: AdapterKind) -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: None,
            connection_id: "connection:database-library".to_owned(),
            adapter,
        }
    }

    #[test]
    fn creates_option_and_selects_it_atomically() {
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
                         VALUES ('project-1', 'library-1', 'Atomic options', ?1, ?1)",
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
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:atomic-option-database".to_owned(),
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
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:atomic-option-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:atomic-option".to_owned(),
                        document_id: "document:atomic-option".to_owned(),
                        title: "Atomic option".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create Page");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                    [DATABASE_ID],
                )?;
                Ok(())
            })
            .expect("bind Project Database");

        let module = DatabaseModule::new("profile-1", "library-1", &kernel);
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:atomic-option-membership".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::TransferPage {
                        page_id: "page:atomic-option".to_owned(),
                        expected_parent_revision: 1,
                        expected_active_membership_revision: 0,
                        target: DatabaseTransferTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                    }],
                },
            )
            .expect("add Page to Data Source");

        let applied = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:create-and-select-option".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![
                        DatabaseIntent::PutOption {
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "tags".to_owned(),
                            option_id: "o_atomic1".to_owned(),
                            name: "Atomic".to_owned(),
                            color: Some("blue".to_owned()),
                            expected_property_revision: 1,
                        },
                        DatabaseIntent::EditPropertyValues {
                            edits: vec![DatabasePropertyValueMutation {
                                address: DatabasePagePropertyAddress {
                                    page_id: "page:atomic-option".to_owned(),
                                    data_source_id: SOURCE_ID.to_owned(),
                                    property_id: "tags".to_owned(),
                                },
                                edit: DatabasePropertyValueEdit::PatchSet {
                                    delta: DatabasePropertySetDelta::MultiSelect {
                                        add_option_ids: vec!["o_atomic1".to_owned()],
                                        remove_option_ids: Vec::new(),
                                    },
                                },
                            }],
                        },
                    ],
                },
            )
            .expect("create and select option in one transaction");
        assert_eq!(applied.committed.value.operation_count, 2);

        let replayed = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:create-and-select-option".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![
                        DatabaseIntent::PutOption {
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "tags".to_owned(),
                            option_id: "o_atomic1".to_owned(),
                            name: "Atomic".to_owned(),
                            color: Some("blue".to_owned()),
                            expected_property_revision: 1,
                        },
                        DatabaseIntent::EditPropertyValues {
                            edits: vec![DatabasePropertyValueMutation {
                                address: DatabasePagePropertyAddress {
                                    page_id: "page:atomic-option".to_owned(),
                                    data_source_id: SOURCE_ID.to_owned(),
                                    property_id: "tags".to_owned(),
                                },
                                edit: DatabasePropertyValueEdit::PatchSet {
                                    delta: DatabasePropertySetDelta::MultiSelect {
                                        add_option_ids: vec!["o_atomic1".to_owned()],
                                        remove_option_ids: Vec::new(),
                                    },
                                },
                            }],
                        },
                    ],
                },
            )
            .expect("replay the atomic operation receipt");
        assert_eq!(replayed.committed.value.operation_count, 2);

        let noncanonical_tag = module.apply(
            &context(),
            ModuleApplyRequest {
                contract_version: DATABASE_CONTRACT_VERSION,
                operation_id: "operation:reject-noncanonical-tag".to_owned(),
                store_epoch: StoreEpoch("epoch-1".to_owned()),
                intent: vec![DatabaseIntent::PutOption {
                    data_source_id: SOURCE_ID.to_owned(),
                    property_id: "tags".to_owned(),
                    option_id: "o_noncanonical".to_owned(),
                    name: "Cafe\u{301}".to_owned(),
                    color: None,
                    expected_property_revision: 2,
                }],
            },
        );
        assert!(
            noncanonical_tag.is_err(),
            "Tags option names must already be Unicode NFC"
        );

        let failed = module.apply(
            &context(),
            ModuleApplyRequest {
                contract_version: DATABASE_CONTRACT_VERSION,
                operation_id: "operation:create-and-select-option-fails".to_owned(),
                store_epoch: StoreEpoch("epoch-1".to_owned()),
                intent: vec![
                    DatabaseIntent::PutOption {
                        data_source_id: SOURCE_ID.to_owned(),
                        property_id: "tags".to_owned(),
                        option_id: "o_atomic2".to_owned(),
                        name: "Must roll back".to_owned(),
                        color: None,
                        expected_property_revision: 2,
                    },
                    DatabaseIntent::EditPropertyValues {
                        edits: vec![DatabasePropertyValueMutation {
                            address: DatabasePagePropertyAddress {
                                page_id: "page:missing".to_owned(),
                                data_source_id: SOURCE_ID.to_owned(),
                                property_id: "tags".to_owned(),
                            },
                            edit: DatabasePropertyValueEdit::PatchSet {
                                delta: DatabasePropertySetDelta::MultiSelect {
                                    add_option_ids: vec!["o_atomic2".to_owned()],
                                    remove_option_ids: Vec::new(),
                                },
                            },
                        }],
                    },
                ],
            },
        );
        assert!(
            failed.is_err(),
            "an invalid selection must fail the whole apply"
        );

        kernel
            .readers()
            .read_default(|connection| {
                let config = connection.query_row(
                    "SELECT config_json FROM data_source_properties \
                     WHERE data_source_id = ?1 AND id = 'tags'",
                    [SOURCE_ID],
                    |row| row.get::<_, String>(0),
                )?;
                let value = connection.query_row(
                    "SELECT value.value_json FROM data_source_property_values value \
                     JOIN data_source_page_memberships membership ON membership.id = value.membership_id \
                     WHERE value.data_source_id = ?1 AND value.property_id = 'tags' \
                       AND membership.page_block_id = 'page:atomic-option'",
                    [SOURCE_ID],
                    |row| row.get::<_, String>(0),
                )?;
                assert!(config.contains("o_atomic1"));
                assert!(!config.contains("o_atomic2"));
                assert_eq!(value, "[\"o_atomic1\"]");
                Ok(())
            })
            .expect("option registry and value commit together");
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
                    contract_version: LIBRARY_CONTRACT_VERSION,
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
                    contract_version: LIBRARY_CONTRACT_VERSION,
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
        library
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:database-row-page-2".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:database-row-2".to_owned(),
                        document_id: "document:database-row-2".to_owned(),
                        title: "Review release".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create second Page");
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
                    transaction.execute(
                        "DELETE FROM library_block_placements \
                         WHERE block_id = 'page:database-row-2'",
                        [],
                    )?;
                    transaction.execute(
                        "DELETE FROM top_level_block_placements \
                         WHERE block_id = 'page:database-row-2'",
                        [],
                    )?;
                    transaction.execute(
                        "UPDATE blocks SET location_kind = 'database', \
                           containing_document_id = NULL, containing_database_id = ?1 \
                         WHERE id = 'page:database-row-2'",
                        [DATABASE_ID],
                    )?;
                    transaction.execute(
                        "UPDATE pages SET parent_kind = 'data_source', parent_id = ?1 \
                         WHERE block_id = 'page:database-row-2'",
                        [SOURCE_ID],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_page_memberships(\
                           id, data_source_id, page_block_id, revision, created_at, removed_at\
                         ) VALUES ('membership:row-2', ?1, 'page:database-row-2', 1, ?2, NULL)",
                        params![SOURCE_ID, NOW],
                    )?;
                    transaction.execute(
                        "UPDATE page_read_model SET location_kind = 'database', \
                           containing_document_id = NULL, containing_database_id = ?1, \
                           top_level_rank_key = NULL, membership_id = 'membership:row-2', \
                           database_block_id = ?1, view_id = NULL, view_group_key = NULL, \
                           view_rank_key = NULL, database_values_json = '{}' \
                         WHERE page_block_id = 'page:database-row-2'",
                        [DATABASE_ID],
                    )?;
                    Ok(())
                })
            })
            .expect("place Database row");
        let workspace = ProjectWorkspaceModule::new("profile-1", "library-1", &kernel)
            .expect("Workspace module");
        workspace
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    operation_id: "operation:database-agent-thread".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: ProjectWorkspaceIntent::UpsertThread {
                        thread_id: "thread:database-agent".to_owned(),
                        patch: Box::new(ProjectWorkspaceThreadPatch {
                            project_id: Some(Some("project-1".to_owned())),
                            thread_name: Some(Some("Database Agent".to_owned())),
                            created_at: Some(1),
                            updated_at: Some(1),
                            linked_at: Some(NOW.to_owned()),
                            ..ProjectWorkspaceThreadPatch::default()
                        }),
                    },
                },
            )
            .expect("persist Database Agent Thread");
        workspace
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: PROJECT_WORKSPACE_CONTRACT_VERSION,
                    operation_id: "operation:database-agent-turn".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: ProjectWorkspaceIntent::FreezeTurnAuthority {
                        thread_id: "thread:database-agent".to_owned(),
                        turn_id: "turn:database-agent".to_owned(),
                        root_thread_id: "thread:database-agent".to_owned(),
                        actor_project_id: "project-1".to_owned(),
                        source: ProjectWorkspaceTurnAuthoritySource::ProjectTurn,
                        inherited_from: None,
                    },
                },
            )
            .expect("freeze Database Agent Turn");
        let agent_authorization = AgentExecutionAuthorization {
            provenance: AgentTurnProvenance {
                profile_id: "profile-1".to_owned(),
                authority: ProjectWorkspaceTurnAuthority {
                    thread_id: "thread:database-agent".to_owned(),
                    turn_id: "turn:database-agent".to_owned(),
                    root_thread_id: "thread:database-agent".to_owned(),
                    actor_project_id: "project-1".to_owned(),
                    library_id: "library-1".to_owned(),
                    store_epoch: "epoch-1".to_owned(),
                    scope: ProjectWorkspaceTurnAuthorityScope::Project,
                    source: ProjectWorkspaceTurnAuthoritySource::ProjectTurn,
                },
            },
            call_id: "call:database-agent".to_owned(),
            resource_access: None,
        };
        let module = DatabaseModule::new("profile-1", "library-1", &kernel);

        const BODY_SENTINEL: &str = "BODY-MUST-NOT-APPEAR-IN-DATABASE-WINDOW";
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE document_materializations SET nfm = ?1 \
                     WHERE document_id = 'document:database-row'",
                    [BODY_SENTINEL],
                )?;
                Ok(())
            })
            .expect("seed a Page body sentinel");
        let first_window = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::ProjectDefault,
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(CollectionWindowRequest {
                            after: None,
                            first: Some(1),
                        }),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read the first bounded Database View window");
        let DatabaseReadValue::ViewWindow {
            value: first_window,
        } = first_window.value
        else {
            panic!("Database View window snapshot");
        };
        assert_eq!(first_window.rows.items.len(), 1);
        assert_eq!(first_window.rows.items[0].page_id, "page:database-row");
        let next_cursor = first_window
            .rows
            .next_cursor
            .clone()
            .expect("first window has a continuation");
        let encoded_window =
            serde_json::to_vec(&first_window).expect("encode Database View window");
        assert!(encoded_window.len() < 1024 * 1024);
        assert!(
            !String::from_utf8(encoded_window)
                .expect("window JSON is UTF-8")
                .contains(BODY_SENTINEL)
        );

        let next_window = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::ProjectDefault,
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(CollectionWindowRequest {
                            after: Some(next_cursor),
                            first: Some(1),
                        }),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("continue the Database View window");
        let DatabaseReadValue::ViewWindow { value: next_window } = next_window.value else {
            panic!("next Database View window snapshot");
        };
        assert_eq!(
            next_window
                .rows
                .items
                .iter()
                .map(|row| row.page_id.as_str())
                .collect::<Vec<_>>(),
            ["page:database-row-2"]
        );
        assert!(next_window.rows.next_cursor.is_none());

        let rows_by_id = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::ProjectDefault,
                        mode: DatabaseReadMode::RowsById,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: Some(vec!["page:database-row-2".to_owned()]),
                        group_scope: None,
                    },
                },
            )
            .expect("read one Database row by identity");
        let DatabaseReadValue::RowsById { value: rows_by_id } = rows_by_id.value else {
            panic!("Database rows-by-ID snapshot");
        };
        assert_eq!(rows_by_id.rows.len(), 1);
        assert_eq!(rows_by_id.rows[0].page_id, "page:database-row-2");

        let row_detail = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::Page {
                            page_id: "page:database-row".to_owned(),
                        },
                        mode: DatabaseReadMode::RowDetail,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read one Database row detail");
        let DatabaseReadValue::RowDetail { value: row_detail } = row_detail.value else {
            panic!("Database row detail snapshot");
        };
        assert_eq!(row_detail.summary.page_id, "page:database-row");
        assert_eq!(row_detail.body_nfm, BODY_SENTINEL);

        let agent_query = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::AgentDataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                            query: Box::new(DatabaseAgentQuery {
                                authorization: agent_authorization.clone(),
                                cursor: None,
                                limit: Some(1),
                            }),
                        },
                        mode: DatabaseReadMode::AgentQuery,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("query primary Data Source with exact Agent Turn authority");
        let DatabaseReadValue::AgentQuery { value } = agent_query.value else {
            panic!("Agent Database query snapshot");
        };
        assert_eq!(value.rows.items[0].page_id, "page:database-row");
        assert!(value.rows.next_cursor.is_some());
        let next_cursor = value
            .rows
            .next_cursor
            .expect("Agent query has a next cursor");
        let cursor_before_change = next_cursor.clone();
        let mut continuation_authorization = agent_authorization.clone();
        continuation_authorization.call_id = "call:database-agent-next".to_owned();
        let next_agent_query = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::AgentDataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                            query: Box::new(DatabaseAgentQuery {
                                authorization: continuation_authorization,
                                cursor: Some(next_cursor),
                                limit: Some(1),
                            }),
                        },
                        mode: DatabaseReadMode::AgentQuery,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("continue exact Agent Database query");
        let DatabaseReadValue::AgentQuery { value } = next_agent_query.value else {
            panic!("next Agent Database query snapshot");
        };
        assert_eq!(value.rows.items[0].page_id, "page:database-row-2");
        assert!(value.rows.next_cursor.is_none());
        let transfer = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:database-agent-page-2-cleanup".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::TransferPage {
                        page_id: "page:database-row-2".to_owned(),
                        expected_parent_revision: 1,
                        expected_active_membership_revision: 1,
                        target: DatabaseTransferTarget::Library {
                            library_id: "library-1".to_owned(),
                        },
                    }],
                },
            )
            .expect("remove second Agent query row from the shared fixture");
        assert!(matches!(
            transfer.event.expect("transfer event").projection_impact,
            ProjectionImpact::All
        ));
        let continued_after_change = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::AgentDataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                            query: Box::new(DatabaseAgentQuery {
                                authorization: agent_authorization,
                                cursor: Some(cursor_before_change),
                                limit: Some(1),
                            }),
                        },
                        mode: DatabaseReadMode::AgentQuery,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("Agent Database cursor survives a concurrent commit");
        let DatabaseReadValue::AgentQuery { value } = continued_after_change.value else {
            panic!("continued Agent Database query snapshot");
        };
        assert!(value.rows.items.is_empty());
        assert!(value.rows.next_cursor.is_none());

        let catalog = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::ProjectDefault,
                        mode: DatabaseReadMode::CatalogWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read catalog");
        let DatabaseReadValue::CatalogWindow { databases } = catalog.value else {
            panic!("catalog snapshot");
        };
        assert_eq!(databases.items.len(), 1);
        assert_eq!(databases.items[0]["database"]["databaseId"], DATABASE_ID);
        let data_sources = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::Database {
                            database_id: DATABASE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::DataSourceWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read Data Source descriptor window");
        let DatabaseReadValue::DataSourceWindow { data_sources } = data_sources.value else {
            panic!("Data Source descriptor window");
        };
        assert_eq!(data_sources.items[0]["dataSourceId"], SOURCE_ID);
        let views = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::Database {
                            database_id: DATABASE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewDescriptorWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read View descriptor window");
        let DatabaseReadValue::ViewDescriptorWindow { views } = views.value else {
            panic!("View descriptor window");
        };
        assert_eq!(views.items[0]["isDefault"], true);

        let page_row = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::Page {
                            page_id: "page:database-row".to_owned(),
                        },
                        mode: DatabaseReadMode::RowDetail,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read exact Database Page row");
        let DatabaseReadValue::RowDetail { value: page_row } = page_row.value else {
            panic!("Database Page row snapshot");
        };
        assert_eq!(page_row.summary.page_id, "page:database-row");
        assert_eq!(page_row.summary.position_order, Some(0));
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "UPDATE blocks SET lifecycle = 'archived' \
                         WHERE id = 'page:database-row'",
                        [],
                    )?;
                    transaction.execute(
                        "UPDATE pages SET lifecycle = 'archived' \
                         WHERE block_id = 'page:database-row'",
                        [],
                    )?;
                    transaction.execute(
                        "UPDATE page_read_model SET lifecycle = 'archived' \
                         WHERE page_block_id = 'page:database-row'",
                        [],
                    )?;
                    Ok(())
                })
            })
            .expect("archive Database Page fixture");
        let archived_row = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::Page {
                            page_id: "page:database-row".to_owned(),
                        },
                        mode: DatabaseReadMode::RowDetail,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read archived Database Page row");
        let DatabaseReadValue::RowDetail {
            value: archived_row,
        } = archived_row.value
        else {
            panic!("archived Database Page row snapshot");
        };
        assert_eq!(archived_row.summary.lifecycle, "archived");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "UPDATE blocks SET lifecycle = 'active' \
                         WHERE id = 'page:database-row'",
                        [],
                    )?;
                    transaction.execute(
                        "UPDATE pages SET lifecycle = 'active' \
                         WHERE block_id = 'page:database-row'",
                        [],
                    )?;
                    transaction.execute(
                        "UPDATE page_read_model SET lifecycle = 'active' \
                         WHERE page_block_id = 'page:database-row'",
                        [],
                    )?;
                    Ok(())
                })
            })
            .expect("restore Database Page fixture");

        let request = ModuleApplyRequest {
            contract_version: DATABASE_CONTRACT_VERSION,
            operation_id: "operation:database-schema-values".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: vec![
                DatabaseIntent::PutProperty {
                    data_source_id: SOURCE_ID.to_owned(),
                    property_id: "risk".to_owned(),
                    expected_data_source_revision: 1,
                    expected_property_revision: 0,
                    name: "Risk".to_owned(),
                    schema: DatabasePropertySchema::Select,
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
                DatabaseIntent::EditPropertyValues {
                    edits: vec![DatabasePropertyValueMutation {
                        address: DatabasePagePropertyAddress {
                            page_id: "page:database-row".to_owned(),
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "risk".to_owned(),
                        },
                        edit: DatabasePropertyValueEdit::Replace {
                            expected_value_revision: 0,
                            value: DatabasePropertyValueInput::Select {
                                option_id: "high".to_owned(),
                            },
                        },
                    }],
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
        assert_eq!(
            applied.committed.receipt.operation_kinds,
            ["put_property", "put_option", "edit_property_values"]
        );
        assert_eq!(
            applied.committed.receipt.committed_revisions,
            BTreeMap::from([
                (format!("source:{SOURCE_ID}"), 3),
                (format!("property:{SOURCE_ID}:risk"), 2),
                (format!("value:{SOURCE_ID}:membership:row:risk"), 1),
                ("page:page:database-row:metadata".to_owned(), 2),
            ])
        );
        assert_eq!(
            applied.committed.receipt.commit_seq,
            applied.committed.commit_seq
        );
        let event = applied.event.as_ref().expect("committed Database event");
        assert_eq!(applied.committed.receipt.committed_at, event.committed_at);
        kernel
            .writer()
            .call(|connection| {
                let revisions = connection.query_row(
                    "SELECT block.metadata_revision, page.metadata_revision, \
                       projection.metadata_revision FROM blocks block \
                     JOIN pages page ON page.block_id = block.id \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = 'page:database-row'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(revisions, (2, 2, 2));
                Ok(())
            })
            .expect("Page metadata projections stay synchronized after value writes");

        let replayed = module
            .apply(&context(), request.clone())
            .expect("replay exact Database batch");
        assert!(replayed.committed.receipt.mutation.duplicate);
        assert_eq!(
            replayed.committed.event_sequence,
            applied.committed.event_sequence
        );
        assert_eq!(
            replayed.committed.receipt.committed_revisions,
            applied.committed.receipt.committed_revisions
        );
        assert_eq!(
            replayed.committed.receipt.committed_at,
            applied.committed.receipt.committed_at
        );
        assert!(replayed.event.is_none());

        let mut divergent = request;
        divergent.intent.push(DatabaseIntent::EditPropertyValues {
            edits: vec![DatabasePropertyValueMutation {
                address: DatabasePagePropertyAddress {
                    page_id: "page:database-row".to_owned(),
                    data_source_id: SOURCE_ID.to_owned(),
                    property_id: "risk".to_owned(),
                },
                edit: DatabasePropertyValueEdit::Replace {
                    expected_value_revision: 1,
                    value: DatabasePropertyValueInput::Empty,
                },
            }],
        });
        let collision = module
            .apply(&context(), divergent)
            .expect_err("reject divergent Database retry");
        assert_eq!(collision.code, CoreErrorCode::IdempotencyKeyReused);

        let rollback = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:database-rollback".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![
                        DatabaseIntent::PutProperty {
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "score".to_owned(),
                            expected_data_source_revision: 3,
                            expected_property_revision: 0,
                            name: "Score".to_owned(),
                            schema: DatabasePropertySchema::Number,
                            before_property_id: None,
                        },
                        DatabaseIntent::EditPropertyValues {
                            edits: vec![DatabasePropertyValueMutation {
                                address: DatabasePagePropertyAddress {
                                    page_id: "page:database-row".to_owned(),
                                    data_source_id: SOURCE_ID.to_owned(),
                                    property_id: "status".to_owned(),
                                },
                                edit: DatabasePropertyValueEdit::Replace {
                                    expected_value_revision: 99,
                                    value: DatabasePropertyValueInput::Select {
                                        option_id: "build".to_owned(),
                                    },
                                },
                            }],
                        },
                    ],
                },
            )
            .expect_err("roll back an invalid Database batch");
        assert_eq!(rollback.code, CoreErrorCode::RevisionConflict);

        let source = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::DataSource,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read committed Data Source schema");
        let DatabaseReadValue::DataSource { value: source } = source.value else {
            panic!("Data Source descriptor snapshot");
        };
        assert_eq!(source["dataSource"]["schemaRevision"], 3);
        let properties = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::PropertyWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read committed Property window");
        let DatabaseReadValue::PropertyWindow { properties } = properties.value else {
            panic!("Property window");
        };
        assert_eq!(properties.items.len(), 9);
        assert!(
            properties
                .items
                .iter()
                .all(|value| value.property_id != "score")
        );
        let status = properties
            .items
            .iter()
            .find(|value| value.property_id == "status")
            .expect("status Property");
        assert_eq!(status.schema, DatabasePropertySchema::Select);
        assert!(status.option_count > 0);
        assert!(status.capabilities.sortable);
        let options = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::Property {
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "status".to_owned(),
                        },
                        mode: DatabaseReadMode::OptionWindow,
                        filter: None,
                        sort: None,
                        window: Some(CollectionWindowRequest {
                            after: None,
                            first: Some(1),
                        }),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read first Property option window");
        let DatabaseReadValue::OptionWindow { options } = options.value else {
            panic!("Property option window");
        };
        assert_eq!(options.items.len(), 1);
        assert_eq!(options.items[0]["id"], "triage");
        let second_option = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::Property {
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "status".to_owned(),
                        },
                        mode: DatabaseReadMode::OptionWindow,
                        filter: None,
                        sort: None,
                        window: Some(CollectionWindowRequest {
                            after: options.next_cursor,
                            first: Some(1),
                        }),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read next Property option in config order");
        let DatabaseReadValue::OptionWindow {
            options: second_option,
        } = second_option.value
        else {
            panic!("second Property option window");
        };
        assert_eq!(second_option.items[0]["id"], "plan");
        let row_window = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read committed Database row window");
        let DatabaseReadValue::ViewWindow { value: row_window } = row_window.value else {
            panic!("Database row window snapshot");
        };
        assert_eq!(row_window.rows.items[0].page_id, "page:database-row");

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
                    contract_version: DATABASE_CONTRACT_VERSION,
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
                    contract_version: DATABASE_CONTRACT_VERSION,
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
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: SECOND_VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("query regrouped View");
        let DatabaseReadValue::ViewWindow { value: grouped } = grouped.value else {
            panic!("View query snapshot");
        };
        assert_eq!(
            grouped.rows.items[0].effective_group_key.as_deref(),
            Some("high")
        );
        assert_eq!(grouped.rows.items[0].position_revision, Some(1));
        kernel
            .writer()
            .call(|connection| {
                let revisions = connection.query_row(
                    "SELECT block.metadata_revision, page.metadata_revision, \
                       projection.metadata_revision FROM blocks block \
                     JOIN pages page ON page.block_id = block.id \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = 'page:database-row'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(revisions.0, revisions.1);
                assert_eq!(revisions.0, revisions.2);
                Ok(())
            })
            .expect("Page metadata projections stay synchronized after positioning");

        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
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
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::View,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
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
                    contract_version: DATABASE_CONTRACT_VERSION,
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
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: SECOND_VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read source after row transfer");
        let DatabaseReadValue::ViewWindow {
            value: empty_source,
        } = empty_source.value
        else {
            panic!("Data Source query snapshot");
        };
        assert!(empty_source.rows.items.is_empty());

        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
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
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: SECOND_VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read restored Database row");
        let DatabaseReadValue::ViewWindow { value: returned } = returned.value else {
            panic!("Data Source query snapshot");
        };
        assert_eq!(returned.rows.items[0].membership_revision, 3);
        let page_parent_rejection = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
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

        let library_source = module
            .read(
                &library_context(AdapterKind::Test),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::DataSource,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("trusted Library scope reads a concrete Data Source");
        let DatabaseReadValue::DataSource {
            value: library_source,
        } = library_source.value
        else {
            panic!("Library Data Source descriptor");
        };
        assert_eq!(library_source["dataSource"]["dataSourceId"], SOURCE_ID);
        let untrusted_library_read = module
            .read(
                &library_context(AdapterKind::Agent),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::DataSource,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect_err("untrusted Adapter cannot claim Library Database scope");
        assert_eq!(untrusted_library_read.code, CoreErrorCode::Unauthorized);

        let library_write = module
            .apply(
                &library_context(AdapterKind::Test),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:library-database-property".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::PutProperty {
                        data_source_id: SOURCE_ID.to_owned(),
                        property_id: "library-note".to_owned(),
                        expected_data_source_revision: 3,
                        expected_property_revision: 0,
                        name: "Library note".to_owned(),
                        schema: DatabasePropertySchema::Text,
                        before_property_id: None,
                    }],
                },
            )
            .expect("trusted Library scope mutates a concrete Data Source");
        assert_eq!(
            library_write.committed.receipt.committed_revisions,
            BTreeMap::from([
                (format!("source:{SOURCE_ID}"), 4),
                (format!("property:{SOURCE_ID}:library-note"), 1),
            ])
        );
        let library_event = library_write.event.expect("Library Database event");
        let CoreModuleEventPayload::Database(library_event) = library_event.payload else {
            panic!("Database event payload");
        };
        assert_eq!(library_event.project_id, None);

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
        assert_eq!(database_events, 8);
    }

    struct GroupRowSpec {
        page_id: &'static str,
        title: &'static str,
        value_json: Option<&'static str>,
        position: Option<(&'static str, &'static str)>,
    }

    fn seed_grouped_fixture(kernel: &SqliteStoreKernel, rows: Vec<GroupRowSpec>) -> DatabaseModule {
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
                         VALUES ('project-1', 'library-1', 'Grouped windows', ?1, ?1)",
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
        let library = LibraryModule::new("profile-1", "library-1", kernel);
        library
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:grouped-fixture-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: DATABASE_ID.to_owned(),
                        data_source_id: SOURCE_ID.to_owned(),
                        view_id: VIEW_ID.to_owned(),
                        name: "Grouped work".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create Database");
        for row in &rows {
            library
                .apply(
                    &context(),
                    ModuleApplyRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        operation_id: format!("operation:grouped-fixture-{}", row.page_id),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: row.page_id.to_owned(),
                            document_id: format!("document:{}", row.page_id),
                            title: row.title.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create Page");
        }
        kernel
            .writer()
            .call(move |connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                        [DATABASE_ID],
                    )?;
                    for row in &rows {
                        let membership_id = format!("membership:{}", row.page_id);
                        transaction.execute(
                            "DELETE FROM library_block_placements WHERE block_id = ?1",
                            [row.page_id],
                        )?;
                        transaction.execute(
                            "DELETE FROM top_level_block_placements WHERE block_id = ?1",
                            [row.page_id],
                        )?;
                        transaction.execute(
                            "UPDATE blocks SET location_kind = 'database', \
                               containing_document_id = NULL, containing_database_id = ?1 \
                             WHERE id = ?2",
                            params![DATABASE_ID, row.page_id],
                        )?;
                        transaction.execute(
                            "UPDATE pages SET parent_kind = 'data_source', parent_id = ?1 \
                             WHERE block_id = ?2",
                            params![SOURCE_ID, row.page_id],
                        )?;
                        transaction.execute(
                            "INSERT INTO data_source_page_memberships(\
                               id, data_source_id, page_block_id, revision, created_at, removed_at\
                             ) VALUES (?1, ?2, ?3, 1, ?4, NULL)",
                            params![membership_id, SOURCE_ID, row.page_id, NOW],
                        )?;
                        if let Some(value_json) = row.value_json {
                            transaction.execute(
                                "INSERT INTO data_source_property_values(\
                                   data_source_id, membership_id, property_id, value_type, \
                                   value_json, revision, updated_at\
                                 ) VALUES (?1, ?2, 'status', 'select', ?3, 1, ?4)",
                                params![SOURCE_ID, membership_id, value_json, NOW],
                            )?;
                        }
                        if let Some((group_key, rank_key)) = row.position {
                            transaction.execute(
                                "INSERT INTO database_view_page_positions(\
                                   view_id, page_block_id, group_key, rank_key, revision, \
                                   created_at, updated_at\
                                 ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
                                params![VIEW_ID, row.page_id, group_key, rank_key, NOW],
                            )?;
                        }
                        let values_json = row
                            .value_json
                            .map(|value| format!("{{\"status\":{value}}}"))
                            .unwrap_or_else(|| "{}".to_owned());
                        transaction.execute(
                            "UPDATE page_read_model SET location_kind = 'database', \
                               containing_document_id = NULL, containing_database_id = ?1, \
                               top_level_rank_key = NULL, membership_id = ?2, \
                               database_block_id = ?1, database_values_json = ?3 \
                             WHERE page_block_id = ?4",
                            params![DATABASE_ID, membership_id, values_json, row.page_id],
                        )?;
                    }
                    Ok(())
                })
            })
            .expect("place Database rows");
        DatabaseModule::new("profile-1", "library-1", kernel)
    }

    #[test]
    fn schedule_index_follows_direct_property_edits_and_schema_deletion() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        let module = seed_grouped_fixture(
            &kernel,
            vec![GroupRowSpec {
                page_id: "page:schedule-row",
                title: "Scheduled row",
                value_json: Some("\"triage\""),
                position: Some(("triage", "a")),
            }],
        );
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO scheduled_page_index( \
                       page_block_id, project_id, lifecycle, scheduled_start, scheduled_end, \
                       is_all_day, recurrence_json, reminders_json, schedule_timezone, \
                       source_metadata_revision, updated_at \
                     ) VALUES ('page:schedule-row', 'project-1', 'active', NULL, NULL, 0, \
                       'null', '[]', NULL, 1, ?1)",
                    [NOW],
                )?;
                Ok(())
            })
            .expect("seed schedule index");

        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:set-schedule-pair".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::EditPropertyValues {
                        edits: vec![
                            DatabasePropertyValueMutation {
                                address: DatabasePagePropertyAddress {
                                    page_id: "page:schedule-row".to_owned(),
                                    data_source_id: SOURCE_ID.to_owned(),
                                    property_id: "scheduled_start".to_owned(),
                                },
                                edit: DatabasePropertyValueEdit::Replace {
                                    expected_value_revision: 0,
                                    value: DatabasePropertyValueInput::Datetime {
                                        value: "2026-08-04T09:00:00.000Z".to_owned(),
                                    },
                                },
                            },
                            DatabasePropertyValueMutation {
                                address: DatabasePagePropertyAddress {
                                    page_id: "page:schedule-row".to_owned(),
                                    data_source_id: SOURCE_ID.to_owned(),
                                    property_id: "scheduled_end".to_owned(),
                                },
                                edit: DatabasePropertyValueEdit::Replace {
                                    expected_value_revision: 0,
                                    value: DatabasePropertyValueInput::Datetime {
                                        value: "2026-08-04T10:00:00.000Z".to_owned(),
                                    },
                                },
                            },
                        ],
                    }],
                },
            )
            .expect("write schedule pair through Database Property authority");

        let indexed = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT scheduled_start, scheduled_end FROM scheduled_page_index \
                         WHERE page_block_id = 'page:schedule-row'",
                        [],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .map_err(StoreError::from)
            })
            .expect("read updated schedule index");
        assert_eq!(
            indexed,
            (
                "2026-08-04T09:00:00.000Z".to_owned(),
                "2026-08-04T10:00:00.000Z".to_owned(),
            )
        );

        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:delete-schedule-start".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::DeleteProperty {
                        data_source_id: SOURCE_ID.to_owned(),
                        property_id: "scheduled_start".to_owned(),
                        expected_data_source_revision: 1,
                        expected_property_revision: 1,
                    }],
                },
            )
            .expect("delete one schedule Property");

        let indexed_start = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT scheduled_start FROM scheduled_page_index \
                         WHERE page_block_id = 'page:schedule-row'",
                        [],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("read degraded schedule index");
        assert_eq!(indexed_start, None);
    }

    #[test]
    fn relation_property_persists_edges_and_reads_preview_and_full_window() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        let module = seed_grouped_fixture(
            &kernel,
            vec![
                GroupRowSpec {
                    page_id: "page:relation-row",
                    title: "Define Relation",
                    value_json: Some("\"backlog\""),
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:target-a",
                    title: "Target A",
                    value_json: None,
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:target-b",
                    title: "Target B",
                    value_json: None,
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:target-c",
                    title: "Target C",
                    value_json: None,
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:target-d",
                    title: "Target D",
                    value_json: None,
                    position: None,
                },
            ],
        );
        let source_revision = kernel
            .writer()
            .call(|connection| {
                connection
                    .query_row(
                        "SELECT schema_revision FROM data_sources WHERE id = ?1",
                        [SOURCE_ID],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("source revision");
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:put-relation".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::PutProperty {
                        data_source_id: SOURCE_ID.to_owned(),
                        property_id: "blocked_by".to_owned(),
                        expected_data_source_revision: source_revision,
                        expected_property_revision: 0,
                        name: "Blocked by".to_owned(),
                        schema: DatabasePropertySchema::Relation {
                            target_data_source_id: SOURCE_ID.to_owned(),
                        },
                        before_property_id: None,
                    }],
                },
            )
            .expect("create Relation Property");
        let write = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:set-relation".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::EditPropertyValues {
                        edits: vec![DatabasePropertyValueMutation {
                            address: DatabasePagePropertyAddress {
                                page_id: "page:relation-row".to_owned(),
                                data_source_id: SOURCE_ID.to_owned(),
                                property_id: "blocked_by".to_owned(),
                            },
                            edit: DatabasePropertyValueEdit::Replace {
                                expected_value_revision: 0,
                                value: DatabasePropertyValueInput::Relation {
                                    page_ids: [
                                        "page:relation-row",
                                        "page:target-a",
                                        "page:target-b",
                                        "page:target-c",
                                        "page:target-d",
                                    ]
                                    .into_iter()
                                    .map(str::to_owned)
                                    .collect(),
                                },
                            },
                        }],
                    }],
                },
            )
            .expect("write Relation edge");
        assert_eq!(
            write
                .committed
                .receipt
                .committed_revisions
                .values()
                .filter(|revision| **revision == 1)
                .count(),
            1
        );
        kernel
            .writer()
            .call(|connection| {
                let authority = connection.query_row(
                    "SELECT value.value_json, value.revision, count(edge.target_page_block_id) \
                     FROM data_source_property_values value \
                     LEFT JOIN data_source_relation_edges edge \
                       ON edge.source_data_source_id = value.data_source_id \
                       AND edge.source_membership_id = value.membership_id \
                       AND edge.property_id = value.property_id \
                     WHERE value.data_source_id = ?1 AND value.property_id = 'blocked_by'",
                    [SOURCE_ID],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )?;
                assert_eq!(authority, ("null".to_owned(), 1, 5));
                Ok(())
            })
            .expect("inspect normalized Relation authority");
        let no_op = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:patch-relation-no-op".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::EditPropertyValues {
                        edits: vec![DatabasePropertyValueMutation {
                            address: DatabasePagePropertyAddress {
                                page_id: "page:relation-row".to_owned(),
                                data_source_id: SOURCE_ID.to_owned(),
                                property_id: "blocked_by".to_owned(),
                            },
                            edit: DatabasePropertyValueEdit::PatchSet {
                                delta: nodex_core_contracts::database::DatabasePropertySetDelta::Relation {
                                    add_page_ids: vec!["page:relation-row".to_owned()],
                                    remove_page_ids: Vec::new(),
                                },
                            },
                        }],
                    }],
                },
            )
            .expect("Relation patch no-op");
        assert!(no_op.committed.receipt.committed_revisions.is_empty());
        let revision_after_no_op = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT revision FROM data_source_property_values \
                         WHERE data_source_id = ?1 AND property_id = 'blocked_by'",
                        [SOURCE_ID],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("Relation revision after no-op");
        assert_eq!(revision_after_no_op, 1);
        let guessed_remove = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:patch-relation-guessed-remove".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::EditPropertyValues {
                        edits: vec![DatabasePropertyValueMutation {
                            address: DatabasePagePropertyAddress {
                                page_id: "page:relation-row".to_owned(),
                                data_source_id: SOURCE_ID.to_owned(),
                                property_id: "blocked_by".to_owned(),
                            },
                            edit: DatabasePropertyValueEdit::PatchSet {
                                delta: nodex_core_contracts::database::DatabasePropertySetDelta::Relation {
                                    add_page_ids: Vec::new(),
                                    remove_page_ids: vec!["page:already-absent".to_owned()],
                                },
                            },
                        }],
                    }],
                },
            )
            .expect_err("Relation removal cannot probe an unknown Page identity");
        assert_eq!(
            guessed_remove.code,
            CoreErrorCode::NotFound,
            "{guessed_remove:?}"
        );
        let stale_replace = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:replace-relation-stale".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::EditPropertyValues {
                        edits: vec![DatabasePropertyValueMutation {
                            address: DatabasePagePropertyAddress {
                                page_id: "page:relation-row".to_owned(),
                                data_source_id: SOURCE_ID.to_owned(),
                                property_id: "blocked_by".to_owned(),
                            },
                            edit: DatabasePropertyValueEdit::Replace {
                                expected_value_revision: 0,
                                value: DatabasePropertyValueInput::Relation {
                                    page_ids: Vec::new(),
                                },
                            },
                        }],
                    }],
                },
            )
            .expect_err("stale Relation replacement");
        assert_eq!(stale_replace.code, CoreErrorCode::RevisionConflict);
        let (view_revision, mut view_config) = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT revision, config_json FROM database_views WHERE id = ?1",
                        [VIEW_ID],
                        |row| {
                            Ok((
                                row.get::<_, i64>(0)?,
                                serde_json::from_str::<serde_json::Value>(
                                    &row.get::<_, String>(1)?,
                                )
                                .map_err(|error| {
                                    rusqlite::Error::FromSqlConversionFailure(
                                        1,
                                        rusqlite::types::Type::Text,
                                        Box::new(error),
                                    )
                                })?,
                            ))
                        },
                    )
                    .map_err(StoreError::from)
            })
            .expect("read Relation filter View");
        view_config["filter"] = json!({
            "kind": "clause",
            "propertyId": "blocked_by",
            "operator": "contains",
            "value": "page:relation-row"
        });
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    operation_id: "operation:filter-relation".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: vec![DatabaseIntent::PutView {
                        database_id: DATABASE_ID.to_owned(),
                        data_source_id: SOURCE_ID.to_owned(),
                        view_id: VIEW_ID.to_owned(),
                        expected_revision: view_revision,
                        name: "Workflow".to_owned(),
                        view_kind: "kanban".to_owned(),
                        config: view_config,
                        is_default: true,
                        before_view_id: None,
                    }],
                },
            )
            .expect("save authorized Relation membership filter");
        let filtered = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("query Relation membership filter");
        let DatabaseReadValue::ViewWindow { value: filtered } = filtered.value else {
            panic!("Relation filtered View");
        };
        assert_eq!(filtered.rows.items.len(), 1);
        let preview = &filtered.rows.items[0].database_values["blocked_by"]["value"];
        assert_eq!(preview["total_count"], 5);
        assert_eq!(preview["targets"].as_array().map(Vec::len), Some(3));
        assert_eq!(preview["restricted_count"], 0);
        assert_eq!(preview["has_more"], true);
        let snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::PageProperty {
                            page_id: "page:relation-row".to_owned(),
                            data_source_id: SOURCE_ID.to_owned(),
                            property_id: "blocked_by".to_owned(),
                        },
                        mode: DatabaseReadMode::RelationTargetWindow,
                        filter: None,
                        sort: None,
                        window: Some(CollectionWindowRequest {
                            after: None,
                            first: Some(1),
                        }),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("read Relation window");
        let DatabaseReadValue::RelationTargetWindow { value } = snapshot.value else {
            panic!("Relation window");
        };
        assert_eq!(value.value_revision, 1);
        assert_eq!(value.total_count, 5);
        assert!(matches!(
            value.targets.items.as_slice(),
            [nodex_core_contracts::database::DatabaseRelationTargetItem::Visible {
                page_id,
                ..
            }] if page_id == "page:relation-row"
        ));
        let cursor = value.targets.next_cursor.expect("Relation continuation");
        let encoded_payload = cursor.split('.').nth(1).expect("cursor payload");
        let payload = String::from_utf8(
            BASE64_URL_SAFE_NO_PAD
                .decode(encoded_payload)
                .expect("base64 cursor payload"),
        )
        .expect("JSON cursor payload");
        assert!(payload.contains("relation_target"));
        for page_id in [
            "page:relation-row",
            "page:target-a",
            "page:target-b",
            "page:target-c",
            "page:target-d",
        ] {
            assert!(!payload.contains(page_id));
        }
        let candidates = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::DataSource {
                            data_source_id: SOURCE_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::RelationCandidateWindow,
                        filter: Some(json!({ "query": "define" })),
                        sort: None,
                        window: Some(CollectionWindowRequest {
                            after: None,
                            first: Some(10),
                        }),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("search Relation candidates");
        let DatabaseReadValue::RelationCandidateWindow { candidates } = candidates.value else {
            panic!("Relation candidate window");
        };
        assert_eq!(candidates.items.len(), 1);
        assert_eq!(candidates.items[0].page_id, "page:relation-row");
    }

    fn read_view_window(
        module: &DatabaseModule,
        first: u32,
        after: Option<String>,
        group_scope: Option<DatabaseGroupScope>,
    ) -> Result<nodex_core_contracts::database::DatabaseViewWindow, CoreError> {
        let snapshot = module.read(
            &context(),
            ModuleReadRequest {
                contract_version: DATABASE_CONTRACT_VERSION,
                read: DatabaseRead {
                    target: DatabaseTarget::View {
                        view_id: VIEW_ID.to_owned(),
                    },
                    mode: DatabaseReadMode::ViewWindow,
                    filter: None,
                    sort: None,
                    window: Some(CollectionWindowRequest {
                        after,
                        first: Some(first),
                    }),
                    page_ids: None,
                    group_scope,
                },
            },
        )?;
        let DatabaseReadValue::ViewWindow { value } = snapshot.value else {
            panic!("view window read");
        };
        Ok(value)
    }

    fn read_view_context(
        module: &DatabaseModule,
        view_id: &str,
        first: u32,
        after: Option<String>,
        group_scope: Option<DatabaseGroupScope>,
    ) -> Result<nodex_core_contracts::database::DatabaseViewContext, CoreError> {
        let snapshot = module.read(
            &context(),
            ModuleReadRequest {
                contract_version: DATABASE_CONTRACT_VERSION,
                read: DatabaseRead {
                    target: DatabaseTarget::View {
                        view_id: view_id.to_owned(),
                    },
                    mode: DatabaseReadMode::ViewContext,
                    filter: None,
                    sort: None,
                    window: Some(CollectionWindowRequest {
                        after,
                        first: Some(first),
                    }),
                    page_ids: None,
                    group_scope,
                },
            },
        )?;
        let DatabaseReadValue::ViewContext { value } = snapshot.value else {
            panic!("view context read");
        };
        assert_eq!(
            value.rows.authority.projection_revision,
            snapshot.commit_head
        );
        assert_eq!(value.projection.covered_commit_seq, snapshot.commit_head);
        assert_eq!(value.projection.scope.schema_version, 1);
        assert_eq!(
            value.projection.scope.scope,
            nodex_core_contracts::LocalProjectionScope::DatabaseView {
                project_id: "project-1".to_owned(),
                database_id: DATABASE_ID.to_owned(),
                data_source_id: SOURCE_ID.to_owned(),
                view_id: view_id.to_owned(),
            }
        );
        Ok(*value)
    }

    #[test]
    fn view_authority_uses_the_local_commit_head_after_a_physical_sequence_gap() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        let module = seed_grouped_fixture(
            &kernel,
            vec![GroupRowSpec {
                page_id: "page:sequence-gap-row",
                title: "Sequence gap row",
                value_json: Some("\"triage\""),
                position: Some(("triage", "a")),
            }],
        );

        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE sqlite_sequence SET seq = seq + 100 WHERE name = 'change_log'",
                    [],
                )?;
                Ok(())
            })
            .expect("advance the private physical sequence");
        LibraryModule::new("profile-1", "library-1", &kernel)
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:sequence-gap-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:sequence-gap".to_owned(),
                        document_id: "document:sequence-gap".to_owned(),
                        title: "Physical sequence gap".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("append a valid commit after the physical sequence gap");

        let (physical_head, semantic_head) = kernel
            .writer()
            .call(|connection| {
                Ok((
                    connection.query_row(
                        "SELECT COALESCE(MAX(seq), 0) FROM change_log",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    crate::infrastructure::local_commit::head(connection)?,
                ))
            })
            .expect("read diverged heads");
        assert!(physical_head > semantic_head);

        for mode in [
            DatabaseReadMode::ViewWindow,
            DatabaseReadMode::ViewGroups,
            DatabaseReadMode::ViewContext,
        ] {
            let snapshot = module
                .read(
                    &context(),
                    ModuleReadRequest {
                        contract_version: DATABASE_CONTRACT_VERSION,
                        read: DatabaseRead {
                            target: DatabaseTarget::View {
                                view_id: VIEW_ID.to_owned(),
                            },
                            mode,
                            filter: None,
                            sort: None,
                            window: Some(CollectionWindowRequest {
                                after: None,
                                first: Some(10),
                            }),
                            page_ids: None,
                            group_scope: None,
                        },
                    },
                )
                .expect("read View authority");
            assert_eq!(snapshot.commit_head, semantic_head);
            match snapshot.value {
                DatabaseReadValue::ViewWindow { value } => {
                    assert_eq!(value.projection.covered_commit_seq, semantic_head);
                    assert_eq!(value.rows.authority.projection_revision, semantic_head);
                }
                DatabaseReadValue::ViewGroups { value } => {
                    assert_eq!(value.projection.covered_commit_seq, semantic_head);
                }
                DatabaseReadValue::ViewContext { value } => {
                    assert_eq!(value.projection.covered_commit_seq, semantic_head);
                    assert_eq!(value.groups.projection.covered_commit_seq, semantic_head);
                    assert_eq!(value.rows.authority.projection_revision, semantic_head);
                }
                _ => panic!("unexpected View read value"),
            }
        }
    }

    #[test]
    fn view_context_composes_descriptors_groups_rows_and_signed_move_authority() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        let module = seed_grouped_fixture(
            &kernel,
            vec![
                GroupRowSpec {
                    page_id: "page:row-a",
                    title: "First",
                    value_json: Some("\"triage\""),
                    position: Some(("triage", "a")),
                },
                GroupRowSpec {
                    page_id: "page:row-b",
                    title: "Second",
                    value_json: Some("\"done\""),
                    position: Some(("done", "b")),
                },
            ],
        );

        let first = read_view_context(&module, VIEW_ID, 1, None, None).expect("first context");
        assert_eq!(first.database["databaseId"], DATABASE_ID);
        assert_eq!(first.data_source["dataSourceId"], SOURCE_ID);
        assert_eq!(first.view["viewId"], VIEW_ID);
        assert_eq!(first.view["config"]["group"]["propertyId"], "status");
        assert!(
            first
                .properties
                .iter()
                .any(|property| property.property_id == "status")
        );
        assert_eq!(first.groups.total_rows, 2);
        assert_eq!(first.rows.items.len(), 1);
        assert!(first.rows.items[0].move_etag.starts_with("nxe1."));
        let first_etag = first.rows.items[0].move_etag.clone();
        let cursor = first
            .rows
            .next_cursor
            .clone()
            .expect("context continuation");

        let second = read_view_context(&module, VIEW_ID, 1, Some(cursor.clone()), None)
            .expect("next context");
        assert_eq!(second.rows.items.len(), 1);
        assert_ne!(
            first.rows.items[0].summary.page_id,
            second.rows.items[0].summary.page_id
        );
        assert!(second.rows.next_cursor.is_none());

        const OTHER_VIEW_ID: &str = "018f1000-0000-7000-8000-00000000000c";
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO database_views(\
                       id, database_block_id, data_source_id, name, kind, config_json, revision, \
                       rank_key, lifecycle, created_at, updated_at\
                     ) SELECT ?1, database_block_id, data_source_id, 'Other board', kind, \
                       config_json, revision, 'z', lifecycle, created_at, updated_at \
                     FROM database_views WHERE id = ?2",
                    params![OTHER_VIEW_ID, VIEW_ID],
                )?;
                Ok(())
            })
            .expect("seed another View");
        let cross_view = read_view_context(&module, OTHER_VIEW_ID, 1, Some(cursor.clone()), None)
            .expect_err("cursor cannot cross Views");
        assert_eq!(cross_view.code, CoreErrorCode::InvalidInput);

        let mut tampered = cursor.into_bytes();
        let last = tampered.last_mut().expect("non-empty cursor");
        *last = if *last == b'a' { b'b' } else { b'a' };
        let tampered = String::from_utf8(tampered).expect("ASCII cursor");
        let rejection = read_view_context(&module, VIEW_ID, 1, Some(tampered), None)
            .expect_err("tampered cursor");
        assert_eq!(rejection.code, CoreErrorCode::InvalidInput);

        let triage = read_view_context(
            &module,
            VIEW_ID,
            200,
            None,
            Some(DatabaseGroupScope::Key {
                key: "triage".to_owned(),
            }),
        )
        .expect("group-scoped context");
        assert_eq!(triage.groups.total_rows, 2);
        assert_eq!(triage.rows.items.len(), 1);
        assert_eq!(
            triage.rows.items[0].summary.effective_group_key.as_deref(),
            Some("triage")
        );

        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE database_view_page_positions \
                     SET rank_key = 'z', revision = revision + 1, updated_at = ?1 \
                     WHERE view_id = ?2 AND page_block_id = 'page:row-a'",
                    params![NOW, VIEW_ID],
                )?;
                Ok(())
            })
            .expect("change the row position authority");
        let moved = read_view_context(
            &module,
            VIEW_ID,
            200,
            None,
            Some(DatabaseGroupScope::Key {
                key: "triage".to_owned(),
            }),
        )
        .expect("context after position change");
        assert_ne!(moved.rows.items[0].move_etag, first_etag);

        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO projects(id, library_id, name, created, updated) \
                     VALUES ('project-2', 'library-1', 'Unauthorized', ?1, ?1)",
                    [NOW],
                )?;
                Ok(())
            })
            .expect("seed an unrelated Project");
        let mut unauthorized_context = context();
        unauthorized_context.project_id = Some(ProjectId("project-2".to_owned()));
        let unauthorized = module
            .read(
                &unauthorized_context,
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewContext,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect_err("another Project cannot read View context");
        assert_eq!(unauthorized.code, CoreErrorCode::Unauthorized);
    }

    #[test]
    fn group_scoped_windows_partition_the_view_and_agree_with_group_totals() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        let module = seed_grouped_fixture(
            &kernel,
            vec![
                GroupRowSpec {
                    page_id: "page:row-a",
                    title: "Positioned triage",
                    value_json: Some("\"triage\""),
                    position: Some(("triage", "a")),
                },
                GroupRowSpec {
                    page_id: "page:row-b",
                    title: "Valued but unpositioned",
                    value_json: Some("\"done\""),
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:row-c",
                    title: "Empty string value",
                    value_json: Some("\"\""),
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:row-d",
                    title: "Positioned without value",
                    value_json: None,
                    position: Some(("triage", "b")),
                },
                GroupRowSpec {
                    page_id: "page:row-e",
                    title: "Null value",
                    value_json: Some("null"),
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:row-f",
                    title: "No value row",
                    value_json: None,
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:row-g",
                    title: "List value",
                    value_json: Some("[\"x\"]"),
                    position: None,
                },
                GroupRowSpec {
                    page_id: "page:row-h",
                    title: "Empty list value",
                    value_json: Some("[]"),
                    position: None,
                },
            ],
        );

        let flat = read_view_window(&module, 200, None, None).expect("flat window");
        assert_eq!(flat.rows.items.len(), 8);
        let flat_ids = flat
            .rows
            .items
            .iter()
            .map(|row| row.page_id.clone())
            .collect::<std::collections::BTreeSet<_>>();

        let groups_snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewGroups,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("view groups read");
        let DatabaseReadValue::ViewGroups { value: groups } = groups_snapshot.value else {
            panic!("view groups value");
        };
        assert!(groups.grouped);
        assert!(!groups.truncated);
        assert_eq!(groups.total_rows, 8);
        assert_eq!(
            groups
                .groups
                .iter()
                .map(|group| (group.group_key.clone(), group.total_rows))
                .collect::<Vec<_>>(),
            vec![
                (Some("[\"x\"]".to_owned()), 1),
                (Some("done".to_owned()), 1),
                (Some("triage".to_owned()), 2),
                (None, 4),
            ],
        );

        // Every row lands in exactly one scope, and scoped traversal covers the
        // flat window without duplicates.
        let mut scoped_ids = std::collections::BTreeSet::new();
        let mut scopes = groups
            .groups
            .iter()
            .filter_map(|group| group.group_key.clone())
            .map(|key| DatabaseGroupScope::Key { key })
            .collect::<Vec<_>>();
        scopes.push(DatabaseGroupScope::Unassigned);
        for scope in &scopes {
            let mut cursor = None;
            loop {
                let window = read_view_window(&module, 1, cursor.take(), Some(scope.clone()))
                    .expect("scoped window");
                for row in &window.rows.items {
                    assert!(
                        scoped_ids.insert(row.page_id.clone()),
                        "row {} appeared in two scopes",
                        row.page_id
                    );
                }
                match window.rows.next_cursor {
                    Some(next) => cursor = Some(next),
                    None => break,
                }
            }
        }
        assert_eq!(scoped_ids, flat_ids);

        // Scoped ordering: positioned rows first by rank, then unpositioned.
        let triage = read_view_window(
            &module,
            200,
            None,
            Some(DatabaseGroupScope::Key {
                key: "triage".to_owned(),
            }),
        )
        .expect("triage window");
        assert_eq!(
            triage
                .rows
                .items
                .iter()
                .map(|row| row.page_id.as_str())
                .collect::<Vec<_>>(),
            vec!["page:row-a", "page:row-d"],
        );
        assert!(
            triage
                .rows
                .items
                .iter()
                .all(|row| row.effective_group_key.as_deref() == Some("triage"))
        );

        // A cursor minted for one scope is a different query for another scope.
        let triage_first = read_view_window(
            &module,
            1,
            None,
            Some(DatabaseGroupScope::Key {
                key: "triage".to_owned(),
            }),
        )
        .expect("triage first window");
        let triage_cursor = triage_first.rows.next_cursor.expect("triage continuation");
        let cross_scope = read_view_window(
            &module,
            1,
            Some(triage_cursor),
            Some(DatabaseGroupScope::Key {
                key: "done".to_owned(),
            }),
        )
        .expect_err("cross-scope cursor must be rejected");
        assert_eq!(cross_scope.code, CoreErrorCode::InvalidInput);

        // Group scope is only meaningful for view_window reads.
        let wrong_mode = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewGroups,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: Some(DatabaseGroupScope::Unassigned),
                    },
                },
            )
            .expect_err("group scope outside view_window must be rejected");
        assert_eq!(wrong_mode.code, CoreErrorCode::InvalidInput);
    }

    #[test]
    fn ungrouped_views_reject_group_scopes_and_report_flat_totals() {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        let module = seed_grouped_fixture(
            &kernel,
            vec![GroupRowSpec {
                page_id: "page:row-a",
                title: "Only row",
                value_json: Some("\"triage\""),
                position: Some(("triage", "a")),
            }],
        );
        const FLAT_VIEW_ID: &str = "018f1000-0000-7000-8000-00000000000f";
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO database_views(\
                       id, database_block_id, data_source_id, name, kind, config_json, revision, \
                       rank_key, lifecycle, created_at, updated_at\
                     ) SELECT ?1, database_block_id, data_source_id, 'Flat', 'list', \
                       json_set(config_json, '$.group', json('null')), 1, 'z', 'active', \
                       created_at, updated_at \
                     FROM database_views WHERE id = ?2",
                    params![FLAT_VIEW_ID, VIEW_ID],
                )?;
                Ok(())
            })
            .expect("create ungrouped View");

        let scoped = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: FLAT_VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewWindow,
                        filter: None,
                        sort: None,
                        window: Some(Default::default()),
                        page_ids: None,
                        group_scope: Some(DatabaseGroupScope::Unassigned),
                    },
                },
            )
            .expect_err("ungrouped View must reject group scopes");
        assert_eq!(scoped.code, CoreErrorCode::InvalidInput);

        let groups_snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: DATABASE_CONTRACT_VERSION,
                    read: DatabaseRead {
                        target: DatabaseTarget::View {
                            view_id: FLAT_VIEW_ID.to_owned(),
                        },
                        mode: DatabaseReadMode::ViewGroups,
                        filter: None,
                        sort: None,
                        window: None,
                        page_ids: None,
                        group_scope: None,
                    },
                },
            )
            .expect("ungrouped view groups read");
        let DatabaseReadValue::ViewGroups { value: groups } = groups_snapshot.value else {
            panic!("ungrouped view groups value");
        };
        assert!(!groups.grouped);
        assert_eq!(groups.total_rows, 1);
        assert!(groups.groups.is_empty());
    }
}
