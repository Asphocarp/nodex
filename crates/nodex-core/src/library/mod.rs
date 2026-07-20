use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use nodex_core_contracts::library::{
    LibraryCommitValue, LibraryEvent, LibraryEventKind, LibraryIntent, LibraryRead,
    LibraryReadValue, LibraryReceipt, LibraryResourceTarget,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreError, CoreErrorCode, CoreErrorRecovery, CoreModuleEventPayload, ModuleApplyRequest,
    ModuleMutationReceipt, ModuleReadRequest, ModuleReadSnapshot, StoreEpoch,
};
use rusqlite::OptionalExtension;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

#[derive(Clone, Debug)]
pub struct LibraryApplyOutcome {
    pub committed: CommittedModuleValue<LibraryCommitValue, LibraryReceipt>,
    pub event: Option<CommittedCoreModuleEvent>,
}

#[derive(Clone)]
struct AppliedOperation {
    fingerprint: Vec<u8>,
    committed: CommittedModuleValue<LibraryCommitValue, LibraryReceipt>,
}

#[derive(Default)]
struct LibraryState {
    event_head: i64,
    operations: HashMap<String, AppliedOperation>,
    grants: BTreeMap<(String, String), String>,
}

pub struct LibraryModule {
    profile_id: String,
    library_id: String,
    store_epoch: StoreEpoch,
    state: Mutex<LibraryState>,
    readers: Option<StoreReaders>,
    writer: Option<StoreWriter>,
    assets_root: Option<PathBuf>,
}

impl LibraryModule {
    pub fn tracer(profile_id: String, library_id: String, store_epoch: StoreEpoch) -> Self {
        Self {
            profile_id,
            library_id,
            store_epoch,
            state: Mutex::new(LibraryState::default()),
            readers: None,
            writer: None,
            assets_root: None,
        }
    }

    pub fn new(
        profile_id: impl Into<String>,
        library_id: impl Into<String>,
        kernel: &SqliteStoreKernel,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            library_id: library_id.into(),
            store_epoch: StoreEpoch(String::new()),
            state: Mutex::new(LibraryState::default()),
            readers: Some(kernel.readers()),
            writer: Some(kernel.writer()),
            assets_root: Some(
                kernel
                    .database_path()
                    .parent()
                    .expect("Profile database has a parent")
                    .join("assets"),
            ),
        }
    }

    pub fn read(
        &self,
        context: &BoundModuleContext,
        request: ModuleReadRequest<LibraryRead>,
    ) -> Result<ModuleReadSnapshot<LibraryReadValue>, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid_input("unsupported Library contract version"));
        }

        if let Some(readers) = &self.readers {
            let profile_id = self.profile_id.clone();
            let library_id = self.library_id.clone();
            let project_id = context
                .project_id
                .as_ref()
                .map(|project_id| project_id.0.clone());
            let adapter = context.adapter.clone();
            let context = context.clone();
            return readers
                .read_default(move |connection| {
                    let store_epoch = connection
                        .query_row(
                            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                            [],
                            |row| row.get::<_, String>(0),
                        )
                        .optional()?
                        .ok_or_else(|| {
                            StoreError::new(
                                StoreErrorCode::StoreCorrupt,
                                "Block store epoch is unavailable",
                                false,
                            )
                        })?;
                    let event_head = navigation::event_head(connection)?;
                    let value = match request.read {
                        LibraryRead::Metadata => LibraryReadValue::Metadata {
                            profile_id,
                            library_id,
                            change_log_seq: event_head,
                        },
                        LibraryRead::PlanBlockTransfer {
                            operation_id,
                            store_epoch,
                            intent,
                        } => LibraryReadValue::BlockTransferPlan {
                            value: Box::new(block_transfer::plan(
                                connection,
                                &context,
                                &library_id,
                                &operation_id,
                                &store_epoch,
                                &intent,
                            )?),
                        },
                        read => navigation::read(
                            connection,
                            &library_id,
                            &store_epoch,
                            event_head,
                            project_id.as_deref(),
                            &adapter,
                            read,
                        )?,
                    };
                    Ok(ModuleReadSnapshot {
                        version: CORE_CONTRACT_VERSION,
                        store_epoch: StoreEpoch(store_epoch),
                        event_head,
                        value,
                    })
                })
                .map_err(core_error);
        }

        let state = self.state.lock().expect("Library tracer mutex poisoned");
        let value = match request.read {
            LibraryRead::Metadata => LibraryReadValue::Metadata {
                profile_id: self.profile_id.clone(),
                library_id: self.library_id.clone(),
                change_log_seq: state.event_head,
            },
            _ => {
                return Err(invalid_input(
                    "the Milestone 1 tracer supports metadata reads only",
                ));
            }
        };

        Ok(ModuleReadSnapshot {
            version: CORE_CONTRACT_VERSION,
            store_epoch: self.store_epoch.clone(),
            event_head: state.event_head,
            value,
        })
    }

    pub fn apply(
        &self,
        context: &BoundModuleContext,
        request: ModuleApplyRequest<LibraryIntent>,
    ) -> Result<LibraryApplyOutcome, CoreError> {
        self.validate_context(context)?;
        if request.version != CORE_CONTRACT_VERSION {
            return Err(invalid_input("unsupported Library contract version"));
        }
        if let Some(writer) = &self.writer {
            return mutation::apply(
                writer,
                &self.profile_id,
                &self.library_id,
                context,
                request,
                self.assets_root
                    .as_ref()
                    .expect("persistent Library has an assets root"),
            )
            .map_err(core_error);
        }
        if request.store_epoch != self.store_epoch {
            return Err(CoreError {
                code: CoreErrorCode::StaleStoreEpoch,
                message: "Library mutation targets a stale store generation".to_owned(),
                retryable: true,
                recovery: CoreErrorRecovery::CurrentStoreEpoch {
                    store_epoch: self.store_epoch.clone(),
                },
            });
        }

        let (project_id, target, access) = match &request.intent {
            LibraryIntent::GrantProjectAccess {
                project_id,
                target,
                access,
            } => (
                project_id.clone(),
                target.clone(),
                match access {
                    nodex_core_contracts::library::LibraryAccess::Read => "read".to_owned(),
                    nodex_core_contracts::library::LibraryAccess::ReadWrite => {
                        "read_write".to_owned()
                    }
                },
            ),
            _ => {
                return Err(invalid_input(
                    "the Milestone 1 tracer supports grant_project_access only",
                ));
            }
        };
        let fingerprint = serde_json::to_vec(&(
            context,
            request.version,
            &request.store_epoch,
            &request.intent,
        ))
        .map_err(|_| invalid_input("Library mutation cannot be fingerprinted"))?;
        let mut state = self.state.lock().expect("Library tracer mutex poisoned");

        if let Some(applied) = state.operations.get(&request.operation_id) {
            if applied.fingerprint != fingerprint {
                return Err(CoreError {
                    code: CoreErrorCode::IdempotencyKeyReused,
                    message: "operation_id was already used for a different Library intent"
                        .to_owned(),
                    retryable: false,
                    recovery: CoreErrorRecovery::None,
                });
            }
            let mut committed = applied.committed.clone();
            committed.receipt.mutation.duplicate = true;
            return Ok(LibraryApplyOutcome {
                committed,
                event: None,
            });
        }

        state.event_head += 1;
        let event_sequence = state.event_head;
        let resource_id = resource_id(&target);
        let previous_access = state
            .grants
            .insert((project_id, resource_id.clone()), access.clone());
        let did_mutate = previous_access.as_ref() != Some(&access);
        let (affected_page_ids, affected_database_ids) = match &target {
            LibraryResourceTarget::Page { page_id } => (vec![page_id.clone()], Vec::new()),
            LibraryResourceTarget::Database { database_id } => {
                (Vec::new(), vec![database_id.clone()])
            }
        };
        let committed_at = unix_timestamp_millis();
        let receipt = LibraryReceipt {
            mutation: ModuleMutationReceipt {
                operation_id: request.operation_id.clone(),
                duplicate: false,
            },
            operation_kind: "grant_project_access".to_owned(),
            did_mutate,
            created_target: None,
            affected_parent_keys: Vec::new(),
            affected_page_ids: affected_page_ids.clone(),
            affected_database_ids: affected_database_ids.clone(),
            affected_view_ids: Vec::new(),
            committed_revisions: BTreeMap::new(),
            change_log_seq: event_sequence,
            committed_at: committed_at.clone(),
        };
        let committed = CommittedModuleValue {
            value: LibraryCommitValue {
                affected_resource_ids: vec![resource_id],
                page_copy: None,
                block_transfer: None,
            },
            receipt,
            event_sequence,
            store_epoch: self.store_epoch.clone(),
        };
        let event = CommittedCoreModuleEvent {
            version: CORE_CONTRACT_VERSION,
            sequence: event_sequence,
            store_epoch: self.store_epoch.clone(),
            operation_id: Some(request.operation_id.clone()),
            committed_at,
            payload: CoreModuleEventPayload::Library(LibraryEvent {
                kind: LibraryEventKind::LibraryChanged,
                page_ids: affected_page_ids,
                database_ids: affected_database_ids,
                parent_keys: Vec::new(),
            }),
        };
        state.operations.insert(
            request.operation_id,
            AppliedOperation {
                fingerprint,
                committed: committed.clone(),
            },
        );

        Ok(LibraryApplyOutcome {
            committed,
            event: Some(event),
        })
    }

    fn validate_context(&self, context: &BoundModuleContext) -> Result<(), CoreError> {
        if context.profile_id.0 == self.profile_id && context.library_id.0 == self.library_id {
            return Ok(());
        }
        Err(CoreError {
            code: CoreErrorCode::Unauthorized,
            message: "bound Adapter identity does not match this Library".to_owned(),
            retryable: false,
            recovery: CoreErrorRecovery::None,
        })
    }
}

impl Default for LibraryModule {
    fn default() -> Self {
        Self::tracer(
            "probe-profile".to_owned(),
            "probe-library".to_owned(),
            StoreEpoch("probe-epoch".to_owned()),
        )
    }
}

fn invalid_input(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::InvalidInput,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn core_error(error: StoreError) -> CoreError {
    let code = match error.code {
        StoreErrorCode::InvalidInput => CoreErrorCode::InvalidInput,
        StoreErrorCode::NotFound => CoreErrorCode::NotFound,
        StoreErrorCode::StaleStoreEpoch => CoreErrorCode::StaleStoreEpoch,
        StoreErrorCode::Conflict
        | StoreErrorCode::HeadConflict
        | StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::UnsupportedSchema => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        StoreErrorCode::MaintenanceInProgress => CoreErrorCode::MaintenanceInProgress,
        StoreErrorCode::ResourceExhausted => CoreErrorCode::ResourceExhausted,
        StoreErrorCode::Unauthorized => CoreErrorCode::Unauthorized,
        StoreErrorCode::WriterQueueFull
        | StoreErrorCode::WriterClosed
        | StoreErrorCode::ReaderPoolTimeout
        | StoreErrorCode::QueryCancelled
        | StoreErrorCode::SqliteBusy
        | StoreErrorCode::SqliteFailure
        | StoreErrorCode::Internal => CoreErrorCode::CoreUnavailable,
        StoreErrorCode::GenerationConflict => CoreErrorCode::GenerationConflict,
        StoreErrorCode::MissingDependencies => CoreErrorCode::DocumentUpdateMissingDependencies,
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

fn resource_id(target: &LibraryResourceTarget) -> String {
    match target {
        LibraryResourceTarget::Page { page_id } => page_id.clone(),
        LibraryResourceTarget::Database { database_id } => database_id.clone(),
    }
}

fn unix_timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::document::{
        DocumentBlockOperation as ContractDocumentBlockOperation, DocumentBlockUpdatePatch,
        DocumentOptionalValue, OwnedDocumentIntent,
    };
    use nodex_core_contracts::library::{
        LibraryAccess, LibraryBlockLocation, LibraryBlockTransferLogicalIntent,
        LibraryBlockTransferMode, LibraryBlockTransferPlan, LibraryBlockTransferSource,
        LibraryBlockTransferTarget, LibraryNavigationParent, LibraryPageWorkflowStatus,
        LibraryWriteParent,
    };
    use nodex_core_contracts::{AdapterKind, LibraryId, ProfileId, ProjectId};
    use rusqlite::params;
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use crate::document::OwnedDocumentModule;
    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::infrastructure::store::SqliteStoreKernel;

    use super::*;

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: None,
            connection_id: "connection-1".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn request(operation_id: &str, page_id: &str) -> ModuleApplyRequest<LibraryIntent> {
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::GrantProjectAccess {
                project_id: "project-1".to_owned(),
                target: LibraryResourceTarget::Page {
                    page_id: page_id.to_owned(),
                },
                access: LibraryAccess::Read,
            },
        }
    }

    #[test]
    fn tracer_mints_receipt_and_event_once_for_an_exact_retry() {
        let module = LibraryModule::tracer(
            "profile-1".to_owned(),
            "library-1".to_owned(),
            StoreEpoch("epoch-1".to_owned()),
        );

        let first = module.apply(&context(), request("operation-1", "page-1"));
        let replay = module.apply(&context(), request("operation-1", "page-1"));

        let first = first.expect("first apply succeeds");
        let replay = replay.expect("exact retry succeeds");
        assert!(first.event.is_some());
        assert!(replay.event.is_none());
        assert!(!first.committed.receipt.mutation.duplicate);
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            first.committed.event_sequence,
            replay.committed.event_sequence
        );
    }

    #[test]
    fn tracer_rejects_same_operation_id_with_different_intent() {
        let module = LibraryModule::tracer(
            "profile-1".to_owned(),
            "library-1".to_owned(),
            StoreEpoch("epoch-1".to_owned()),
        );
        module
            .apply(&context(), request("operation-1", "page-1"))
            .expect("first apply succeeds");

        let error = module
            .apply(&context(), request("operation-1", "page-2"))
            .expect_err("different retry fails");

        assert_eq!(error.code, CoreErrorCode::IdempotencyKeyReused);
    }

    #[test]
    fn persistent_navigation_separates_roots_rows_paths_and_stale_cursors() {
        const ROOT_PAGE: &str = "page:root";
        const ROW_PAGE: &str = "page:row";
        const ROOT_DOCUMENT: &str = "document:root";
        const ROW_DOCUMENT: &str = "document:row";
        const DATABASE: &str = "database:root";
        const SOURCE: &str = "source:root";
        const VIEW: &str = "view:root";
        const NOW: &str = "2026-07-18T23:59:00.000Z";
        let persistent_context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:persistent-library".to_owned(),
            adapter: AdapterKind::Test,
        };

        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES (?1, ?2, ?2)",
                        params!["profile-1", NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?3)",
                        params!["library-1", "profile-1", NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES (?1, ?2, 'Library reads', ?3, ?3)",
                        params!["project-1", "library-1", NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, 'epoch-1', ?1, ?1)",
                        [NOW],
                    )?;
                    for (block_id, block_type, location) in [
                        (ROOT_PAGE, "page", "space"),
                        (DATABASE, "database", "space"),
                    ] {
                        transaction.execute(
                            "INSERT INTO blocks( \
                               id, project_id, type, lifecycle, location_kind, \
                               containing_document_id, containing_database_id, \
                               location_revision, metadata_revision, created_at, updated_at \
                             ) VALUES (?1, 'project-1', ?2, 'active', ?3, NULL, NULL, 1, 1, ?4, ?4)",
                            params![block_id, block_type, location, NOW],
                        )?;
                    }
                    transaction.execute(
                        "INSERT INTO database_containers( \
                           block_id, library_id, name, lifecycle, default_view_id, \
                           created_at, updated_at \
                         ) VALUES (?1, 'library-1', 'Cards', 'active', NULL, ?2, ?2)",
                        params![DATABASE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO blocks( \
                           id, project_id, type, lifecycle, location_kind, \
                           containing_document_id, containing_database_id, \
                           location_revision, metadata_revision, created_at, updated_at \
                         ) VALUES (?1, 'project-1', 'page', 'active', 'database', \
                           NULL, ?2, 1, 1, ?3, ?3)",
                        params![ROW_PAGE, DATABASE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_sources( \
                           id, library_id, home_database_block_id, name, schema_key, \
                           rank_key, created_at, updated_at \
                         ) VALUES (?1, 'library-1', ?2, 'Cards', 'nodex.database', 'a', ?3, ?3)",
                        params![SOURCE, DATABASE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_properties( \
                           data_source_id, id, name, value_type, config_json, rank_key, \
                           lifecycle, schema_revision, created_at, updated_at \
                         ) VALUES (?1, 'status', 'Status', 'select', \
                           '{\"options\":[{\"id\":\"triage\",\"name\":\"Triage\"}]}', \
                           'a', 'active', 1, ?2, ?2)",
                        params![SOURCE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO database_views( \
                           id, database_block_id, data_source_id, name, kind, config_json, \
                           rank_key, created_at, updated_at \
                         ) VALUES (?1, ?2, ?3, 'All', 'list', '{}', 'a', ?4, ?4)",
                        params![VIEW, DATABASE, SOURCE, NOW],
                    )?;
                    transaction.execute(
                        "UPDATE database_containers SET default_view_id = ?1 WHERE block_id = ?2",
                        params![VIEW, DATABASE],
                    )?;
                    for (page_id, document_id, parent_kind, parent_id) in [
                        (ROOT_PAGE, ROOT_DOCUMENT, "library", "library-1"),
                        (ROW_PAGE, ROW_DOCUMENT, "data_source", SOURCE),
                    ] {
                        transaction.execute(
                            "INSERT INTO documents( \
                               id, project_id, generation, head_seq, schema_key, schema_version, \
                               state_vector, state_hash, readiness, authority, created_at, updated_at, sync_engine \
                             ) VALUES (?1, 'project-1', 1, 0, 'nodex.page', 2, X'', '', \
                               'pending_genesis', 'legacy_shadow', ?2, ?2, 'yjs')",
                            params![document_id, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
                             VALUES (?1, ?2, 'project-1', ?3)",
                            params![page_id, document_id, NOW],
                        )?;
                        transaction.execute(
                            "INSERT INTO pages( \
                               block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
                               created_at, updated_at \
                             ) VALUES (?1, 'library-1', ?2, ?3, ?4, 'active', ?5, ?5)",
                            params![page_id, document_id, parent_kind, parent_id, NOW],
                        )?;
                    }
                    transaction.execute(
                        "INSERT INTO data_source_page_memberships( \
                           id, data_source_id, page_block_id, revision, created_at, removed_at \
                         ) VALUES ('membership:row', ?1, ?2, 1, ?3, NULL)",
                        params![SOURCE, ROW_PAGE, NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO data_source_property_values( \
                           data_source_id, membership_id, property_id, value_type, value_json, \
                           revision, updated_at \
                         ) VALUES (?1, 'membership:row', 'status', 'select', '\"triage\"', 1, ?2)",
                        params![SOURCE, NOW],
                    )?;
                    transaction.execute(
                        "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                        [DATABASE],
                    )?;
                    transaction.execute(
                        "INSERT INTO library_block_placements( \
                           block_id, library_id, rank_key, created_at, updated_at \
                         ) VALUES (?1, 'library-1', 'a', ?3, ?3), \
                                  (?2, 'library-1', 'b', ?3, ?3)",
                        params![ROOT_PAGE, DATABASE, NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed Library");

        let document = OwnedDocumentModule::new("profile-1", "library-1", &kernel);
        for (operation_id, owner_block_id) in
            [("prepare:root", ROOT_PAGE), ("prepare:row", ROW_PAGE)]
        {
            document
                .apply(
                    &persistent_context,
                    ModuleApplyRequest {
                        version: CORE_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: OwnedDocumentIntent::PrepareOwner {
                            owner_block_id: owner_block_id.to_owned(),
                        },
                    },
                )
                .expect("prepare Page");
        }
        kernel
            .writer()
            .call(move |connection| {
                with_immediate_transaction(connection, |transaction| {
                    let title_hash = Sha256::digest(b"Say hi")
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>();
                    transaction.execute(
                        "UPDATE document_materializations SET title = 'Say hi' \
                         WHERE document_id = ?1",
                        [ROW_DOCUMENT],
                    )?;
                    transaction.execute(
                        "UPDATE page_read_model SET title = 'Say hi' WHERE page_block_id = ?1",
                        [ROW_PAGE],
                    )?;
                    transaction.execute(
                        "UPDATE block_search_units SET text = 'Say hi', text_hash = ?1, \
                           updated_at = ?2 WHERE document_id = ?3 \
                           AND source_kind = 'document_title'",
                        params![title_hash, NOW, ROW_DOCUMENT],
                    )?;
                    Ok(())
                })
            })
            .expect("name row Page");

        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        let read = |read| {
            module
                .read(
                    &persistent_context,
                    ModuleReadRequest {
                        version: CORE_CONTRACT_VERSION,
                        read,
                    },
                )
                .expect("Library read")
                .value
        };
        let LibraryReadValue::PageContent { value } = read(LibraryRead::PageContent {
            page_id: ROOT_PAGE.to_owned(),
        }) else {
            panic!("Page content");
        };
        assert_eq!(value.document_head_seq, 1);
        assert_eq!(value.body_nfm, "");
        assert!(value.references.is_empty());
        assert!(value.asset_refs.is_empty());
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE document_materializations SET projected_seq = 0 \
                     WHERE document_id = ?1",
                    [ROOT_DOCUMENT],
                )?;
                Ok(())
            })
            .expect("make Page materialization stale");
        let error = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PageContent {
                        page_id: ROOT_PAGE.to_owned(),
                    },
                },
            )
            .expect_err("stale Page content projection");
        assert_eq!(error.code, CoreErrorCode::RevisionConflict);
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE document_materializations SET projected_seq = 1 \
                     WHERE document_id = ?1",
                    [ROOT_DOCUMENT],
                )?;
                Ok(())
            })
            .expect("restore Page materialization");
        let LibraryReadValue::Children { items, .. } = read(LibraryRead::Children {
            parent: LibraryNavigationParent::Library,
            cursor: None,
            limit: None,
            force_include_target: None,
        }) else {
            panic!("root children");
        };
        assert_eq!(items.len(), 2);
        assert!(!items.iter().any(|node| matches!(
            node,
            nodex_core_contracts::library::LibraryNavigationNode::Page { page_id, .. }
                if page_id == ROW_PAGE
        )));
        let LibraryReadValue::Catalog { items, .. } = read(LibraryRead::Catalog {
            query: Some("say hi".to_owned()),
            kinds: None,
            lifecycle: None,
            cursor: None,
            limit: None,
        }) else {
            panic!("catalog");
        };
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].location_label, "Cards");
        let root_context = context();
        let LibraryReadValue::ProjectPageSearch { items } = module
            .read(
                &root_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::ProjectPageSearch {
                        project_ids: vec!["missing-project".to_owned(), "project-1".to_owned()],
                        query: "say hi".to_owned(),
                        limit: Some(10),
                    },
                },
            )
            .expect("trusted root Project Page search")
            .value
        else {
            panic!("Project Page search");
        };
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].project_id, "project-1");
        assert_eq!(items[0].page_id, ROW_PAGE);
        assert_eq!(items[0].status, LibraryPageWorkflowStatus::Triage);
        assert_eq!(items[0].score, 1_000_000);
        let project_search_error = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::ProjectPageSearch {
                        project_ids: vec!["project-1".to_owned()],
                        query: "say hi".to_owned(),
                        limit: None,
                    },
                },
            )
            .expect_err("Project-bound clients cannot claim multi-Project search");
        assert_eq!(project_search_error.code, CoreErrorCode::Unauthorized);
        let mut untrusted_root_context = context();
        untrusted_root_context.adapter = AdapterKind::Agent;
        let untrusted_search_error = module
            .read(
                &untrusted_root_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::ProjectPageSearch {
                        project_ids: vec!["project-1".to_owned()],
                        query: "say hi".to_owned(),
                        limit: None,
                    },
                },
            )
            .expect_err("Agent clients cannot claim trusted Project Page search");
        assert_eq!(untrusted_search_error.code, CoreErrorCode::Unauthorized);
        let LibraryReadValue::Path { nodes, .. } = read(LibraryRead::Path {
            target: nodex_core_contracts::library::LibraryRouteTarget::Page {
                page_id: ROW_PAGE.to_owned(),
            },
        }) else {
            panic!("path");
        };
        assert!(matches!(
            nodes.as_slice(),
            [nodex_core_contracts::library::LibraryNavigationNode::Database { database_id, .. }]
                if database_id == DATABASE
        ));

        let LibraryReadValue::Children { next_cursor, .. } = read(LibraryRead::Children {
            parent: LibraryNavigationParent::Library,
            cursor: None,
            limit: Some(1),
            force_include_target: None,
        }) else {
            panic!("paged roots");
        };
        let cursor = next_cursor.expect("cursor");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO change_log( \
                       project_id, store_epoch, kind, block_ids_json, document_ids_json, \
                       database_block_ids_json, payload_json, committed_at \
                     ) VALUES ('project-1', 'epoch-1', 'library_changed', '[]', '[]', '[]', '{}', ?1)",
                    [NOW],
                )?;
                Ok(())
            })
            .expect("advance Library sequence");
        let error = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::Children {
                        parent: LibraryNavigationParent::Library,
                        cursor: Some(cursor),
                        limit: Some(1),
                        force_include_target: None,
                    },
                },
            )
            .expect_err("stale cursor");
        assert_eq!(error.code, CoreErrorCode::RevisionConflict);
    }

    #[test]
    fn native_block_transfer_moves_copies_fences_and_replays_document_subtrees() {
        const NOW: &str = "2026-07-19T23:30:00.000Z";
        const SOURCE_PAGE: &str = "018f0000-0000-7000-8000-000000000101";
        const TARGET_PAGE: &str = "018f0000-0000-7000-8000-000000000102";
        const SOURCE_DOCUMENT: &str = "document:transfer-source";
        const TARGET_DOCUMENT: &str = "document:transfer-target";
        let persistent_context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:block-transfer".to_owned(),
            adapter: AdapterKind::Test,
        };
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
                         VALUES ('project-1', 'library-1', 'Transfer', ?1, ?1)",
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
            .expect("seed authority");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        for (operation_id, page_id, document_id, title) in [
            (
                "create-transfer-source",
                SOURCE_PAGE,
                SOURCE_DOCUMENT,
                "Source",
            ),
            (
                "create-transfer-target",
                TARGET_PAGE,
                TARGET_DOCUMENT,
                "Target",
            ),
        ] {
            module
                .apply(
                    &persistent_context,
                    ModuleApplyRequest {
                        version: CORE_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: page_id.to_owned(),
                            document_id: document_id.to_owned(),
                            title: title.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create transfer Page");
        }
        let source_root = kernel
            .readers()
            .read_default(|connection| {
                connection.query_row(
                    "SELECT block_id FROM document_block_index WHERE document_id = ?1 ORDER BY ordinal LIMIT 1",
                    [SOURCE_DOCUMENT],
                    |row| row.get::<_, String>(0),
                ).map_err(Into::into)
            })
            .expect("source root");
        let move_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![source_root.clone()],
            source: LibraryBlockTransferSource::Page {
                page_id: SOURCE_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: TARGET_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let plan = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-transfer-root".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_intent.clone(),
                    },
                },
            )
            .expect("plan move");
        serde_json::to_value(&plan).expect("Block transfer plan serializes for transport");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("Block transfer plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared transfer");
        };
        assert_eq!(preparation.write_fence.documents.len(), 2);
        let mut stale_write_fence = preparation.write_fence.clone();
        stale_write_fence
            .location_revisions
            .insert(source_root.clone(), 0);
        let stale = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-transfer-root".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_intent.clone(),
                        write_fence: Some(stale_write_fence),
                    },
                },
            )
            .expect_err("stale location fence must be rejected");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);
        let moved = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-transfer-root".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_intent.clone(),
                        write_fence: Some(preparation.write_fence.clone()),
                    },
                },
            )
            .expect("move subtree");
        let moved_result = moved
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("transfer result");
        assert_eq!(moved_result.document_commits.len(), 2);
        assert_eq!(moved_result.final_location_revisions[&source_root], 2);
        assert_eq!(
            moved.committed.receipt.affected_page_ids,
            vec![SOURCE_PAGE.to_owned(), TARGET_PAGE.to_owned()]
        );
        let transfer_document_event_kinds = kernel
            .readers()
            .read_default(|connection| {
                let mut statement = connection.prepare(
                    "SELECT kind FROM change_log \
                     WHERE kind LIKE 'owned_document.%' AND operation_id LIKE 'relocation:%' \
                     ORDER BY seq",
                )?;
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(Into::into)
            })
            .expect("transfer Document events");
        assert_eq!(
            transfer_document_event_kinds,
            vec![
                "owned_document.document_updated".to_owned(),
                "owned_document.document_updated".to_owned(),
            ]
        );
        let mut reconnected = persistent_context.clone();
        reconnected.connection_id = "connection:reconnected".to_owned();
        let replay = module
            .read(
                &reconnected,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-transfer-root".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_intent,
                    },
                },
            )
            .expect("receipt-first replay");
        assert!(matches!(
            replay.value,
            LibraryReadValue::BlockTransferPlan { value }
                if matches!(*value, LibraryBlockTransferPlan::Committed { .. })
        ));

        let copy_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![source_root.clone()],
            source: LibraryBlockTransferSource::Document {
                document_id: TARGET_DOCUMENT.to_owned(),
            },
            target: LibraryBlockTransferTarget::Document {
                document_id: SOURCE_DOCUMENT.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let copy_plan = module
            .read(
                &persistent_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-transfer-root".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: copy_intent.clone(),
                    },
                },
            )
            .expect("plan copy");
        let LibraryReadValue::BlockTransferPlan { value } = copy_plan.value else {
            panic!("copy plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared copy");
        };
        let copied = module
            .apply(
                &persistent_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "copy-transfer-root".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: copy_intent,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("copy subtree");
        let copied_result = copied.committed.value.block_transfer.expect("copy result");
        let copied_root = copied_result.copied_block_ids[&source_root].clone();
        assert_ne!(copied_root, source_root);
        assert_eq!(copied_result.document_commits.len(), 1);
        assert!(kernel
            .readers()
            .read_default(move |connection| {
                connection
                    .query_row(
                        "SELECT 1 FROM document_block_index WHERE document_id = ?1 AND block_id = ?2",
                        params![SOURCE_DOCUMENT, copied_root],
                        |_| Ok(()),
                    )
                    .optional()
                    .map(|row| row.is_some())
                    .map_err(Into::into)
            })
            .expect("copied root projection"));
    }

    #[test]
    fn granted_pages_authorize_cross_storage_block_transfers_and_rehome_registry_rows() {
        const NOW: &str = "2026-07-20T00:10:00.000Z";
        const LOCAL_SOURCE_PAGE: &str = "018f0000-0000-7000-8000-000000000201";
        const FOREIGN_SOURCE_PAGE: &str = "018f0000-0000-7000-8000-000000000202";
        const FOREIGN_TARGET_PAGE: &str = "018f0000-0000-7000-8000-000000000203";
        const LOCAL_SOURCE_DOCUMENT: &str = "document:transfer-local-source";
        const FOREIGN_SOURCE_DOCUMENT: &str = "document:transfer-foreign-source";
        const FOREIGN_TARGET_DOCUMENT: &str = "document:transfer-foreign-target";
        let context_for = |project_id: &str| BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId(project_id.to_owned())),
            connection_id: format!("connection:{project_id}:block-transfer"),
            adapter: AdapterKind::Test,
        };
        let local_context = context_for("project-1");
        let foreign_context = context_for("project-2");
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
                    for (project_id, name) in
                        [("project-1", "Requester"), ("project-2", "Storage")]
                    {
                        transaction.execute(
                            "INSERT INTO projects(id, library_id, name, created, updated) \
                             VALUES (?1, 'library-1', ?2, ?3, ?3)",
                            params![project_id, name, NOW],
                        )?;
                    }
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, 'epoch-1', ?1, ?1)",
                        [NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed authority");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);
        for (context, operation_id, page_id, document_id, title) in [
            (
                &local_context,
                "create-local-transfer-source",
                LOCAL_SOURCE_PAGE,
                LOCAL_SOURCE_DOCUMENT,
                "Local source",
            ),
            (
                &foreign_context,
                "create-foreign-transfer-source",
                FOREIGN_SOURCE_PAGE,
                FOREIGN_SOURCE_DOCUMENT,
                "Foreign source",
            ),
            (
                &foreign_context,
                "create-foreign-transfer-target",
                FOREIGN_TARGET_PAGE,
                FOREIGN_TARGET_DOCUMENT,
                "Foreign target",
            ),
        ] {
            module
                .apply(
                    context,
                    ModuleApplyRequest {
                        version: CORE_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: page_id.to_owned(),
                            document_id: document_id.to_owned(),
                            title: title.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create transfer Page");
        }
        let roots = kernel
            .readers()
            .read_default(|connection| {
                let read_root = |document_id: &str| {
                    connection.query_row(
                        "SELECT block_id FROM document_block_index \
                         WHERE document_id = ?1 ORDER BY ordinal LIMIT 1",
                        [document_id],
                        |row| row.get::<_, String>(0),
                    )
                };
                Ok((
                    read_root(LOCAL_SOURCE_DOCUMENT)?,
                    read_root(FOREIGN_SOURCE_DOCUMENT)?,
                ))
            })
            .expect("source roots");
        let copy_from_foreign = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![roots.1.clone()],
            source: LibraryBlockTransferSource::Page {
                page_id: FOREIGN_SOURCE_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Document {
                document_id: LOCAL_SOURCE_DOCUMENT.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let denied = module
            .read(
                &local_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-without-source-grant".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: copy_from_foreign.clone(),
                    },
                },
            )
            .expect_err("foreign source requires a grant");
        assert_eq!(denied.code, CoreErrorCode::NotFound);
        let copy_foreign_page = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![FOREIGN_SOURCE_PAGE.to_owned()],
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: None,
            },
        };
        let denied = module
            .read(
                &local_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-page-without-source-grant".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: copy_foreign_page.clone(),
                    },
                },
            )
            .expect_err("foreign Page copy requires a read grant");
        assert_eq!(denied.code, CoreErrorCode::NotFound);

        let grant = |operation_id: &str, page_id: &str, access: LibraryAccess| {
            module.apply(
                &foreign_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: operation_id.to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: page_id.to_owned(),
                        },
                        access,
                    },
                },
            )
        };
        grant(
            "grant-foreign-source-read",
            FOREIGN_SOURCE_PAGE,
            LibraryAccess::Read,
        )
        .expect("grant source read access");
        grant(
            "grant-foreign-target-write",
            FOREIGN_TARGET_PAGE,
            LibraryAccess::ReadWrite,
        )
        .expect("grant target write access");

        let page_copy_plan = module
            .read(
                &local_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-granted-page-to-library".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: copy_foreign_page.clone(),
                    },
                },
            )
            .expect("read grant authorizes recursive Page Copy");
        let LibraryReadValue::BlockTransferPlan { value } = page_copy_plan.value else {
            panic!("Page copy plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared Page copy");
        };
        let copied_page = module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "copy-granted-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: copy_foreign_page,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("copy granted Page into the requesting Project");
        let copied_page_id = copied_page
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Page copy result")
            .copied_block_ids[FOREIGN_SOURCE_PAGE]
            .clone();

        let copy_plan = module
            .read(
                &local_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-from-granted-source".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: copy_from_foreign.clone(),
                    },
                },
            )
            .expect("read grant authorizes Copy source");
        let LibraryReadValue::BlockTransferPlan { value } = copy_plan.value else {
            panic!("copy plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared copy");
        };
        let copied = module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "copy-from-granted-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: copy_from_foreign,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("copy from granted source");
        let copied_root = copied
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("copy")
            .copied_block_ids[&roots.1]
            .clone();

        let move_foreign = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![roots.1.clone()],
            source: LibraryBlockTransferSource::Document {
                document_id: FOREIGN_SOURCE_DOCUMENT.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: FOREIGN_TARGET_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let denied = module
            .read(
                &local_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-with-read-source-grant".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_foreign.clone(),
                    },
                },
            )
            .expect_err("Move requires source write access");
        assert_eq!(denied.code, CoreErrorCode::NotFound);
        grant(
            "grant-foreign-source-write",
            FOREIGN_SOURCE_PAGE,
            LibraryAccess::ReadWrite,
        )
        .expect("upgrade source write access");
        let move_plan = module
            .read(
                &local_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-between-granted-pages".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_foreign.clone(),
                    },
                },
            )
            .expect("write grants authorize Move");
        let LibraryReadValue::BlockTransferPlan { value } = move_plan.value else {
            panic!("move plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared move");
        };
        module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-between-granted-pages".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_foreign,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("move between granted Pages");

        let move_across_storage = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![roots.0.clone()],
            source: LibraryBlockTransferSource::Page {
                page_id: LOCAL_SOURCE_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Document {
                document_id: FOREIGN_TARGET_DOCUMENT.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let cross_plan = module
            .read(
                &local_context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-into-granted-storage".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_across_storage.clone(),
                    },
                },
            )
            .expect("plan cross-storage Move");
        let LibraryReadValue::BlockTransferPlan { value } = cross_plan.value else {
            panic!("cross-storage plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared cross-storage move");
        };
        module
            .apply(
                &local_context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-into-granted-storage".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_across_storage,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("move into granted storage");

        kernel
            .readers()
            .read_default(|connection| {
                let copied_project = connection.query_row(
                    "SELECT project_id FROM blocks WHERE id = ?1",
                    [&copied_root],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(copied_project, "project-1");
                let copied_page_project = connection.query_row(
                    "SELECT project_id FROM blocks WHERE id = ?1",
                    [&copied_page_id],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(copied_page_project, "project-1");
                let moved = connection.query_row(
                    "SELECT project_id, containing_document_id, lifecycle \
                     FROM blocks WHERE id = ?1",
                    [&roots.0],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                assert_eq!(
                    moved,
                    (
                        "project-2".to_owned(),
                        FOREIGN_TARGET_DOCUMENT.to_owned(),
                        "active".to_owned(),
                    )
                );
                let same_storage_ledger = connection.query_row(
                    "SELECT project_id, target_project_id FROM block_relocations WHERE id = ?1",
                    ["move-between-granted-pages"],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?;
                assert_eq!(
                    same_storage_ledger,
                    ("project-2".to_owned(), "project-2".to_owned())
                );
                let cross_storage_ledger = connection.query_row(
                    "SELECT project_id FROM block_mutations WHERE mutation_id = ?1",
                    ["move-into-granted-storage"],
                    |row| row.get::<_, String>(0),
                )?;
                assert_eq!(cross_storage_ledger, "project-2");
                let relocation_count = connection.query_row(
                    "SELECT count(*) FROM block_relocations WHERE id = ?1",
                    ["move-into-granted-storage"],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(relocation_count, 0);
                Ok(())
            })
            .expect("cross-storage transfer evidence");
    }

    #[test]
    fn library_target_promotes_and_wraps_document_roots_atomically() {
        const NOW: &str = "2026-07-20T00:45:00.000Z";
        const PROMOTE_PAGE: &str = "018f0000-0000-7000-8000-000000000301";
        const WRAP_PAGE: &str = "018f0000-0000-7000-8000-000000000302";
        const ANCHOR_PAGE: &str = "018f0000-0000-7000-8000-000000000303";
        const PROMOTE_DOCUMENT: &str = "document:promotion-source";
        const WRAP_DOCUMENT: &str = "document:wrapper-source";
        const ANCHOR_DOCUMENT: &str = "document:promotion-anchor";
        const PROMOTE_SIBLING: &str = "018f0000-0000-7000-8000-000000000311";
        const WRAP_SIBLING: &str = "018f0000-0000-7000-8000-000000000312";
        const DATABASE: &str = "018f0000-0000-7000-8000-000000000321";
        const DATA_SOURCE: &str = "018f0000-0000-7000-8000-000000000322";
        const VIEW: &str = "018f0000-0000-7000-8000-000000000323";
        let context = BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:page-transformation".to_owned(),
            adapter: AdapterKind::Test,
        };
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
                         VALUES ('project-1', 'library-1', 'Transform', ?1, ?1)",
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
            .expect("seed authority");
        let library = LibraryModule::new("profile-1", "library-1", &kernel);
        for (operation_id, page_id, document_id, title) in [
            (
                "create-promote-source",
                PROMOTE_PAGE,
                PROMOTE_DOCUMENT,
                "Promote",
            ),
            ("create-wrap-source", WRAP_PAGE, WRAP_DOCUMENT, "Wrap"),
            (
                "create-transform-anchor",
                ANCHOR_PAGE,
                ANCHOR_DOCUMENT,
                "Anchor",
            ),
        ] {
            library
                .apply(
                    &context,
                    ModuleApplyRequest {
                        version: CORE_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent: LibraryIntent::CreatePage {
                            page_id: page_id.to_owned(),
                            document_id: document_id.to_owned(),
                            title: title.to_owned(),
                            parent: LibraryWriteParent::Library { before: None },
                        },
                    },
                )
                .expect("create Page");
        }
        library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "create-transform-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: DATABASE.to_owned(),
                        data_source_id: DATA_SOURCE.to_owned(),
                        view_id: VIEW.to_owned(),
                        name: "Transform target".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create Data Source target");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                    [DATABASE],
                )?;
                Ok(())
            })
            .expect("bind primary Database");
        let roots = kernel
            .readers()
            .read_default(|connection| {
                let root = |document_id: &str| {
                    connection.query_row(
                        "SELECT block_id FROM document_block_index \
                         WHERE document_id = ?1 ORDER BY ordinal LIMIT 1",
                        [document_id],
                        |row| row.get::<_, String>(0),
                    )
                };
                Ok((root(PROMOTE_DOCUMENT)?, root(WRAP_DOCUMENT)?))
            })
            .expect("source roots");
        let documents = OwnedDocumentModule::new("profile-1", "library-1", &kernel);
        let paragraph = |id: &str| {
            serde_json::json!({
                "id": id,
                "type": "paragraph",
                "props": {
                    "backgroundColor": "default",
                    "textColor": "default",
                    "textAlignment": "left"
                },
                "content": [],
                "children": []
            })
        };
        documents
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "shape-promote-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: OwnedDocumentIntent::ApplyOperationBatch {
                        document_id: PROMOTE_DOCUMENT.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        operations: vec![
                            ContractDocumentBlockOperation::UpdateBlock {
                                block_id: roots.0.clone(),
                                patch: DocumentBlockUpdatePatch {
                                    block_type: None,
                                    props: None,
                                    content: DocumentOptionalValue::Value {
                                        value: serde_json::json!([{
                                            "type": "text",
                                            "text": "Promoted title",
                                            "styles": { "bold": true }
                                        }]),
                                    },
                                    unset_content: false,
                                },
                            },
                            ContractDocumentBlockOperation::InsertBlock {
                                block: paragraph(PROMOTE_SIBLING),
                                parent_block_id: None,
                                before_block_id: None,
                            },
                        ],
                        actor: serde_json::json!({ "kind": "test" }),
                        write_fence_prepared: true,
                    },
                },
            )
            .expect("shape promotion source");
        documents
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "shape-wrapper-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: OwnedDocumentIntent::ApplyOperationBatch {
                        document_id: WRAP_DOCUMENT.to_owned(),
                        generation: 1,
                        expected_head_seq: 1,
                        operations: vec![
                            ContractDocumentBlockOperation::UpdateBlock {
                                block_id: roots.1.clone(),
                                patch: DocumentBlockUpdatePatch {
                                    block_type: Some("checkListItem".to_owned()),
                                    props: Some(BTreeMap::from([(
                                        "checked".to_owned(),
                                        serde_json::json!(true),
                                    )])),
                                    content: DocumentOptionalValue::Value {
                                        value: serde_json::json!([{
                                            "type": "text",
                                            "text": "Wrapped task",
                                            "styles": {}
                                        }]),
                                    },
                                    unset_content: false,
                                },
                            },
                            ContractDocumentBlockOperation::InsertBlock {
                                block: paragraph(WRAP_SIBLING),
                                parent_block_id: None,
                                before_block_id: None,
                            },
                        ],
                        actor: serde_json::json!({ "kind": "test" }),
                        write_fence_prepared: true,
                    },
                },
            )
            .expect("shape wrapper source");

        let promote_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![roots.0.clone()],
            source: LibraryBlockTransferSource::Document {
                document_id: PROMOTE_DOCUMENT.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "promote-root-to-library".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: promote_intent.clone(),
                    },
                },
            )
            .expect("plan promotion");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("promotion plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared promotion");
        };
        assert_eq!(preparation.write_fence.documents.len(), 1);
        assert_eq!(preparation.target_document_id, None);
        let promoted = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "promote-root-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: promote_intent,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("promote root");
        let promoted_result = promoted
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("promotion result");
        assert_eq!(promoted_result.result_root_block_ids, vec![roots.0.clone()]);
        assert_eq!(promoted_result.document_commits.len(), 2);
        assert_eq!(
            promoted_result.transformation_evidence[0]["kind"],
            "promote"
        );

        let wrap_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![roots.1.clone()],
            source: LibraryBlockTransferSource::Page {
                page_id: WRAP_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-wrapper-to-library".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: wrap_intent.clone(),
                    },
                },
            )
            .expect("plan wrapper");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("wrapper plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared wrapper");
        };
        let wrapped = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "copy-wrapper-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: wrap_intent,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("copy wrapper");
        let wrapped_result = wrapped
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("wrapper result");
        let wrapper_page_id = &wrapped_result.result_root_block_ids[0];
        let copied_task_id = &wrapped_result.copied_block_ids[&roots.1];
        assert_ne!(wrapper_page_id, copied_task_id);
        assert_eq!(wrapped_result.transformation_evidence[0]["kind"], "wrap");
        assert_eq!(
            wrapped_result.transformation_evidence[0]["wrapperReason"],
            "type_requires_wrapper"
        );

        let data_source_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![roots.1.clone()],
            source: LibraryBlockTransferSource::Page {
                page_id: WRAP_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
                view_id: VIEW.to_owned(),
                group_key: Some("ship".to_owned()),
                before_page_id: None,
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-wrapper-to-data-source".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: data_source_intent.clone(),
                    },
                },
            )
            .expect("plan Data Source wrapper");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("Data Source plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared Data Source wrapper");
        };
        assert_eq!(preparation.write_fence.documents.len(), 1);
        assert_eq!(preparation.target_document_id, None);
        assert_eq!(preparation.target_database_id.as_deref(), Some(DATABASE));
        let data_source_transfer = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "copy-wrapper-to-data-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: data_source_intent,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("copy wrapper to Data Source");
        let data_source_result = data_source_transfer
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Data Source transfer result");
        let data_source_page_id = data_source_result.result_root_block_ids[0].clone();
        assert_eq!(
            data_source_result.affected_database_ids,
            vec![DATABASE.to_owned()]
        );
        assert_eq!(
            data_source_result.transformation_evidence[0]["kind"],
            "wrap"
        );
        assert_eq!(
            data_source_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::DataSource {
                database_id: DATABASE.to_owned(),
                data_source_id: DATA_SOURCE.to_owned(),
            }
        );
        assert_eq!(
            data_source_result.final_location_revisions[&data_source_page_id],
            2
        );

        kernel
            .readers()
            .read_default(|connection| {
                let promoted_row = connection.query_row(
                    "SELECT block.type, block.location_kind, block.location_revision, \
                            block.metadata_revision, page.parent_kind, page.parent_id, \
                            materialization.title \
                     FROM blocks block JOIN pages page ON page.block_id = block.id \
                     JOIN document_materializations materialization ON materialization.document_id = page.document_id \
                     WHERE block.id = ?1",
                    [&roots.0],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                        ))
                    },
                )?;
                assert_eq!(
                    promoted_row,
                    (
                        "page".to_owned(),
                        "space".to_owned(),
                        2,
                        2,
                        "library".to_owned(),
                        "library-1".to_owned(),
                        "Promoted title".to_owned(),
                    )
                );
                let ordered = connection
                    .prepare(
                        "SELECT block_id FROM library_block_placements \
                         WHERE library_id = 'library-1' ORDER BY rank_key, block_id",
                    )?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let anchor_index = ordered.iter().position(|id| id == ANCHOR_PAGE).unwrap();
                assert_eq!(ordered[anchor_index - 1], *wrapper_page_id);
                assert_eq!(ordered[anchor_index - 2], roots.0);
                let copied_body = connection.query_row(
                    "SELECT materialization.block_tree_json FROM pages page \
                     JOIN document_materializations materialization ON materialization.document_id = page.document_id \
                     WHERE page.block_id = ?1",
                    [wrapper_page_id],
                    |row| row.get::<_, String>(0),
                )?;
                let copied_body: serde_json::Value =
                    serde_json::from_str(&copied_body).expect("body JSON");
                assert_eq!(copied_body[0]["id"], copied_task_id.as_str());
                assert_eq!(copied_body[0]["type"], "checkListItem");
                let source_task_present = connection.query_row(
                    "SELECT count(*) FROM document_block_index \
                     WHERE document_id = ?1 AND block_id = ?2",
                    params![WRAP_DOCUMENT, roots.1],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(source_task_present, 1);
                let data_source_evidence = connection.query_row(
                    "SELECT block.project_id, block.location_kind, block.containing_database_id, \
                            page.parent_kind, page.parent_id, membership.revision, \
                            status.value_json, status.revision, position.group_key, \
                            position.revision, projection.database_block_id, \
                            projection.view_id, \
                            (SELECT count(*) FROM library_block_placements WHERE block_id = block.id), \
                            (SELECT count(*) FROM top_level_block_placements WHERE block_id = block.id) \
                     FROM blocks block JOIN pages page ON page.block_id = block.id \
                     JOIN data_source_page_memberships membership \
                       ON membership.page_block_id = block.id AND membership.removed_at IS NULL \
                     JOIN data_source_property_values status \
                       ON status.membership_id = membership.id AND status.property_id = 'status' \
                     JOIN database_view_page_positions position \
                       ON position.page_block_id = block.id AND position.view_id = ?2 \
                     JOIN page_read_model projection ON projection.page_block_id = block.id \
                     WHERE block.id = ?1",
                    params![data_source_page_id, VIEW],
                    |row| {
                        Ok((
                            (
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, String>(4)?,
                                row.get::<_, i64>(5)?,
                                row.get::<_, String>(6)?,
                            ),
                            (
                                row.get::<_, i64>(7)?,
                                row.get::<_, String>(8)?,
                                row.get::<_, i64>(9)?,
                                row.get::<_, String>(10)?,
                                row.get::<_, String>(11)?,
                                row.get::<_, i64>(12)?,
                                row.get::<_, i64>(13)?,
                            ),
                        ))
                    },
                )?;
                assert_eq!(
                    data_source_evidence,
                    (
                        (
                            "project-1".to_owned(),
                            "database".to_owned(),
                            DATABASE.to_owned(),
                            "data_source".to_owned(),
                            DATA_SOURCE.to_owned(),
                            1,
                            "\"ship\"".to_owned(),
                        ),
                        (
                            2,
                            "ship".to_owned(),
                            1,
                            DATABASE.to_owned(),
                            VIEW.to_owned(),
                            0,
                            0,
                        ),
                    )
                );
                Ok(())
            })
            .expect("transformation evidence");

        let return_to_library = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            source: LibraryBlockTransferSource::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "return-page-to-library".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: return_to_library.clone(),
                    },
                },
            )
            .expect("plan Data Source Page return");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("Data Source Page return plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared Data Source Page return");
        };
        assert!(preparation.write_fence.documents.is_empty());
        assert_eq!(preparation.source_database_id.as_deref(), Some(DATABASE));
        assert_eq!(
            preparation.write_fence.source_memberships[&data_source_page_id].revision,
            1
        );
        let mut stale_fence = preparation.write_fence.clone();
        stale_fence
            .source_memberships
            .get_mut(&data_source_page_id)
            .expect("membership fence")
            .revision = 0;
        let stale = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "return-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: return_to_library.clone(),
                        write_fence: Some(stale_fence),
                    },
                },
            )
            .expect_err("stale membership fence must fail");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);
        let returned = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "return-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: return_to_library,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("return Data Source Page to Library");
        let returned_result = returned
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("return result");
        assert_eq!(returned_result.document_commits, vec![]);
        assert!(matches!(
            &returned_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::Library {
                library_id,
                project_id,
                rank_key,
            } if library_id == "library-1" && project_id == "project-1" && !rank_key.is_empty()
        ));
        assert_eq!(
            returned_result.final_location_revisions[&data_source_page_id],
            3
        );

        let return_to_data_source = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
                view_id: VIEW.to_owned(),
                group_key: Some("ship".to_owned()),
                before_page_id: None,
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "return-page-to-data-source".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: return_to_data_source.clone(),
                    },
                },
            )
            .expect("plan Library Page Data Source placement");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("Library Page Data Source plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared Library Page Data Source placement");
        };
        assert!(preparation.write_fence.documents.is_empty());
        assert!(preparation.write_fence.source_memberships.is_empty());
        assert_eq!(preparation.target_database_id.as_deref(), Some(DATABASE));
        let returned = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "return-page-to-data-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: return_to_data_source,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("return Library Page to Data Source");
        let returned_result = returned
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Data Source return result");
        assert_eq!(
            returned_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::DataSource {
                database_id: DATABASE.to_owned(),
                data_source_id: DATA_SOURCE.to_owned(),
            }
        );
        assert_eq!(
            returned_result.final_location_revisions[&data_source_page_id],
            4
        );
        kernel
            .readers()
            .read_default(|connection| {
                let membership = connection.query_row(
                    "SELECT revision, removed_at FROM data_source_page_memberships \
                     WHERE page_block_id = ?1 AND data_source_id = ?2",
                    params![data_source_page_id, DATA_SOURCE],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
                )?;
                assert_eq!(membership, (3, None));
                Ok(())
            })
            .expect("reactivated membership evidence");

        let move_into_page = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            source: LibraryBlockTransferSource::DataSource {
                data_source_id: DATA_SOURCE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: ANCHOR_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-data-source-page-into-page".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_into_page.clone(),
                    },
                },
            )
            .expect("plan Data Source Page nesting");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("Data Source Page nesting plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared Data Source Page nesting");
        };
        assert_eq!(preparation.write_fence.documents.len(), 1);
        assert_eq!(
            preparation.target_document_id.as_deref(),
            Some(ANCHOR_DOCUMENT)
        );
        assert_eq!(
            preparation.write_fence.source_memberships[&data_source_page_id].revision,
            3
        );
        let nested = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-data-source-page-into-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_into_page,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("move Data Source Page into Page");
        let nested_result = nested
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("nested Page result");
        assert_eq!(nested_result.document_commits.len(), 1);
        assert_eq!(
            nested_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::Document {
                document_id: ANCHOR_DOCUMENT.to_owned(),
            }
        );
        assert_eq!(
            nested_result.final_location_revisions[&data_source_page_id],
            5
        );

        let move_nested_to_library = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            source: LibraryBlockTransferSource::Page {
                page_id: ANCHOR_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: Some(ANCHOR_PAGE.to_owned()),
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-nested-page-to-library".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_nested_to_library.clone(),
                    },
                },
            )
            .expect("plan nested Page Library return");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("nested Page Library plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared nested Page Library return");
        };
        assert_eq!(preparation.write_fence.documents.len(), 1);
        assert_eq!(
            preparation.source_document_id.as_deref(),
            Some(ANCHOR_DOCUMENT)
        );
        let returned = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-nested-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_nested_to_library,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("move nested Page to Library");
        let returned_result = returned
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("nested Page Library result");
        assert_eq!(returned_result.document_commits.len(), 1);
        assert!(matches!(
            &returned_result.final_locations[&data_source_page_id],
            LibraryBlockLocation::Library { .. }
        ));
        assert_eq!(
            returned_result.final_location_revisions[&data_source_page_id],
            6
        );
        kernel
            .readers()
            .read_default(|connection| {
                let nested_shell_count = connection.query_row(
                    "SELECT count(*) FROM document_block_index \
                     WHERE document_id = ?1 AND block_id = ?2",
                    params![ANCHOR_DOCUMENT, data_source_page_id],
                    |row| row.get::<_, i64>(0),
                )?;
                assert_eq!(nested_shell_count, 0);
                Ok(())
            })
            .expect("nested Page shell deletion evidence");

        let move_library_page_into_document = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: WRAP_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-library-page-into-document".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_library_page_into_document.clone(),
                    },
                },
            )
            .expect("plan Library Page nesting");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("Library Page nesting plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared Library Page nesting");
        };
        let nested = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-library-page-into-document".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_library_page_into_document,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("move Library Page into Document");
        assert_eq!(
            nested
                .committed
                .value
                .block_transfer
                .as_ref()
                .expect("Library Page nesting result")
                .document_commits
                .len(),
            1
        );

        let move_between_pages = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![data_source_page_id.clone()],
            source: LibraryBlockTransferSource::Page {
                page_id: WRAP_PAGE.to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: ANCHOR_PAGE.to_owned(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "move-page-between-documents".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: move_between_pages.clone(),
                    },
                },
            )
            .expect("plan Page-to-Page move");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("Page-to-Page move plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared Page-to-Page move");
        };
        assert_eq!(preparation.write_fence.documents.len(), 2);
        let moved = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "move-page-between-documents".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: move_between_pages,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("move Page between Documents");
        let moved_result = moved
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("Page-to-Page result");
        assert_eq!(moved_result.document_commits.len(), 2);
        assert_eq!(
            moved_result.final_location_revisions[&data_source_page_id],
            8
        );

        let cycle_intent = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Move,
            root_block_ids: vec![ANCHOR_PAGE.to_owned()],
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Page {
                page_id: data_source_page_id.clone(),
                parent_block_id: None,
                before_block_id: None,
            },
        };
        let cycle = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "reject-page-ownership-cycle".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: cycle_intent,
                    },
                },
            )
            .expect_err("Page ownership cycle must fail");
        assert_eq!(cycle.code, CoreErrorCode::InvalidInput);

        let recursive_copy = LibraryBlockTransferLogicalIntent {
            actor: serde_json::json!({ "kind": "test" }),
            mode: LibraryBlockTransferMode::Copy,
            root_block_ids: vec![ANCHOR_PAGE.to_owned()],
            source: LibraryBlockTransferSource::Library {
                library_id: "library-1".to_owned(),
            },
            target: LibraryBlockTransferTarget::Library {
                library_id: "library-1".to_owned(),
                before_block_id: None,
            },
        };
        let plan = library
            .read(
                &context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::PlanBlockTransfer {
                        operation_id: "copy-recursive-page-ownership".to_owned(),
                        store_epoch: "epoch-1".to_owned(),
                        intent: recursive_copy.clone(),
                    },
                },
            )
            .expect("plan recursive Page copy");
        let LibraryReadValue::BlockTransferPlan { value } = plan.value else {
            panic!("recursive Page copy plan");
        };
        let LibraryBlockTransferPlan::Prepared { preparation } = *value else {
            panic!("prepared recursive Page copy");
        };
        assert!(preparation.write_fence.documents.len() >= 2);
        let copied = library
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "copy-recursive-page-ownership".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::TransferBlocks {
                        intent: recursive_copy,
                        write_fence: Some(preparation.write_fence),
                    },
                },
            )
            .expect("copy recursive Page ownership");
        let copied_result = copied
            .committed
            .value
            .block_transfer
            .as_ref()
            .expect("recursive Page copy result");
        assert!(copied_result.document_commits.len() >= 2);
        let copied_anchor = copied_result.copied_block_ids[ANCHOR_PAGE].clone();
        let copied_child = copied_result.copied_block_ids[&data_source_page_id].clone();
        assert_eq!(
            copied_result.result_root_block_ids,
            vec![copied_anchor.clone()]
        );
        assert!(matches!(
            &copied_result.final_locations[&copied_anchor],
            LibraryBlockLocation::Library { .. }
        ));
        kernel
            .readers()
            .read_default(|connection| {
                let copied_parent = connection.query_row(
                    "SELECT parent_kind, parent_id FROM pages WHERE block_id = ?1",
                    [&copied_child],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?;
                assert_eq!(copied_parent, ("page".to_owned(), copied_anchor));
                Ok(())
            })
            .expect("recursive Page copy ownership evidence");
    }
}
mod block_transfer;
mod content;
mod cursor;
mod history;
pub(crate) use history::require_page_read_access;
pub(crate) use history::require_page_write_access;
pub(crate) use page_copy::{OccurrencePageCloneInput, clone_page_for_occurrence};
mod mutation;
mod navigation;
mod page_copy;
