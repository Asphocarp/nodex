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
                        read => navigation::read(
                            connection,
                            &library_id,
                            &store_epoch,
                            event_head,
                            project_id.as_deref(),
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
        StoreErrorCode::Conflict
        | StoreErrorCode::HeadConflict
        | StoreErrorCode::RevisionConflict => CoreErrorCode::RevisionConflict,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::UnsupportedSchema => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
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
    use nodex_core_contracts::document::OwnedDocumentIntent;
    use nodex_core_contracts::library::{LibraryAccess, LibraryNavigationParent};
    use nodex_core_contracts::{AdapterKind, LibraryId, ProfileId, ProjectId};
    use rusqlite::params;
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
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "UPDATE document_materializations SET title = 'Say hi' \
                         WHERE document_id = ?1",
                        [ROW_DOCUMENT],
                    )?;
                    transaction.execute(
                        "UPDATE page_read_model SET title = 'Say hi' WHERE page_block_id = ?1",
                        [ROW_PAGE],
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
}
mod content;
mod cursor;
mod history;
pub(crate) use history::require_page_read_access;
mod mutation;
mod navigation;
mod page_copy;
