use std::collections::BTreeMap;

use nodex_core_contracts::library::{
    LibraryCommitValue, LibraryEvent, LibraryEventKind, LibraryIntent, LibraryReceipt,
    LibraryResourceTarget, LibraryWriteParent,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreModuleEventPayload, ModuleApplyRequest, ModuleMutationReceipt, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

use crate::document::{
    BlockDocumentSchema, PAGE_SCHEMA_KEY, PAGE_SCHEMA_VERSION, PersistYjsGenesis,
    persist_yjs_genesis, prepare_page_yjs_genesis, read_document_authority, read_store_epoch,
    sha256,
};
use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::writer::StoreWriter;

use super::LibraryApplyOutcome;

const MODULE_NAME: &str = "library";
const MAX_ID_LENGTH: usize = 512;
const MAX_PAGE_TITLE_LENGTH: usize = 10_000;

pub(super) fn apply(
    writer: &StoreWriter,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: ModuleApplyRequest<LibraryIntent>,
) -> Result<LibraryApplyOutcome, StoreError> {
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let context = context.clone();
    writer.call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            assert_identity(transaction, &profile_id, &library_id)?;
            let store_epoch = read_store_epoch(transaction)?;
            if request.store_epoch.0 != store_epoch {
                return Err(StoreError::new(
                    StoreErrorCode::Conflict,
                    "Library mutation targets a stale store epoch",
                    true,
                ));
            }
            let fingerprint = serde_json::to_vec(&(
                &context,
                request.version,
                &request.store_epoch,
                &request.intent,
            ))
            .map_err(|_| internal("Library mutation cannot be fingerprinted"))?;
            let request_hash = sha256(&fingerprint);
            if let Some(stored) =
                read_module_receipt(transaction, MODULE_NAME, &request.operation_id)?
            {
                if stored.request_hash != request_hash {
                    return Err(StoreError::new(
                        StoreErrorCode::IdempotencyKeyReused,
                        "operation_id is already bound to another Library intent",
                        false,
                    ));
                }
                let mut committed = serde_json::from_value::<
                    CommittedModuleValue<LibraryCommitValue, LibraryReceipt>,
                >(stored.result)
                .map_err(|_| corrupt("Stored Library receipt is invalid"))?;
                committed.receipt.mutation.duplicate = true;
                return Ok(LibraryApplyOutcome {
                    committed,
                    event: None,
                });
            }

            match &request.intent {
                LibraryIntent::CreatePage {
                    page_id,
                    document_id,
                    title,
                    parent,
                } => create_page(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    page_id,
                    document_id,
                    title,
                    parent,
                ),
                _ => Err(invalid(
                    "this durable Library slice currently supports create_page only",
                )),
            }
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn create_page(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    page_id: &str,
    document_id: &str,
    title: &str,
    parent: &LibraryWriteParent,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_id("page_id", page_id)?;
    validate_id("document_id", document_id)?;
    validate_id("operation_id", operation_id)?;
    if title.len() > MAX_PAGE_TITLE_LENGTH {
        return Err(invalid("Page title exceeds its bound"));
    }
    let before = match parent {
        LibraryWriteParent::Library { before } => before.as_ref(),
        LibraryWriteParent::Page { .. } => {
            return Err(invalid(
                "nested Page creation is not available in this Library slice",
            ));
        }
    };
    if connection
        .query_row(
            "SELECT 1 WHERE EXISTS (SELECT 1 FROM blocks WHERE id = ?1) \
             OR EXISTS (SELECT 1 FROM documents WHERE id = ?2)",
            params![page_id, document_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "New Page or Document identity already exists",
            false,
        ));
    }
    let project_id = preferred_project_id(connection, library_id)?;
    let now = sqlite_now(connection)?;
    let root_block_id = deterministic_block_id(operation_id);
    let prepared = prepare_page_yjs_genesis(document_id, title, &root_block_id)?;

    connection.execute(
        "INSERT INTO blocks (\
           id, project_id, type, lifecycle, location_kind, containing_document_id, \
           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, 'page', 'active', 'space', NULL, NULL, 1, 1, ?3, ?3)",
        params![page_id, project_id, now],
    )?;
    let top_level_rank = append_rank(connection, "top_level_block_placements", &project_id)?;
    connection.execute(
        "INSERT INTO top_level_block_placements(\
           block_id, project_id, rank_key, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![page_id, project_id, top_level_rank, now],
    )?;
    connection.execute(
        "INSERT INTO documents(\
           id, project_id, generation, head_seq, schema_key, schema_version, state_vector, \
           state_hash, readiness, authority, genesis_source_revision, created_at, updated_at, \
           sync_engine\
         ) VALUES (?1, ?2, 1, 0, ?3, ?4, X'', '', 'pending_genesis', 'legacy_shadow', \
           NULL, ?5, ?5, 'yjs')",
        params![
            document_id,
            project_id,
            PAGE_SCHEMA_KEY,
            i64::from(PAGE_SCHEMA_VERSION),
            now
        ],
    )?;
    connection.execute(
        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
        params![page_id, document_id, project_id, now],
    )?;
    connection.execute(
        "INSERT INTO pages(\
           block_id, library_id, document_id, parent_kind, parent_id, lifecycle, \
           parent_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 'library', ?2, 'active', 1, 1, ?4, ?4)",
        params![page_id, library_id, document_id, now],
    )?;
    insert_library_placement(connection, library_id, page_id, before, &now)?;
    let authority = read_document_authority(connection, document_id)?
        .ok_or_else(|| corrupt("Created Page has no Document authority"))?;
    if authority.head.schema_key != BlockDocumentSchema::PageV2.schema_key()
        || authority.head.schema_version != i64::from(PAGE_SCHEMA_VERSION)
    {
        return Err(corrupt("Created Page has the wrong Document schema"));
    }
    let genesis_update_id = format!("library-page-genesis:{}", sha256(operation_id.as_bytes()));
    let full_state = prepared.engine.full_state_v1();
    let persisted = persist_yjs_genesis(
        connection,
        PersistYjsGenesis {
            authority: &authority,
            materialization: &prepared.materialization,
            update_id: &genesis_update_id,
            client_session_id: "library-module",
            update: &prepared.update_v1,
            state_vector: &prepared.state_vector_v1,
            full_state: &full_state,
            store_epoch,
            operation_id: &genesis_update_id,
        },
    )?;
    insert_page_read_model(
        connection,
        page_id,
        &project_id,
        document_id,
        &top_level_rank,
        &prepared.materialization,
        persisted.head_seq,
        &now,
    )?;

    let payload = json!({
        "module": MODULE_NAME,
        "operationKind": "create_page",
        "didMutate": true,
        "affectedParentKeys": ["library"],
        "affectedPageIds": [page_id],
        "affectedDatabaseIds": [],
        "affectedViewIds": [],
    });
    connection.execute(
        "INSERT INTO change_log(\
           project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
           database_block_ids_json, payload_json, committed_at\
         ) VALUES (?1, ?2, 'library.changed', ?3, ?4, ?5, '[]', ?6, ?7)",
        params![
            project_id,
            store_epoch,
            operation_id,
            serde_json::to_string(&[page_id]).map_err(|_| internal("Library Block IDs"))?,
            serde_json::to_string(&[document_id]).map_err(|_| internal("Library Document IDs"))?,
            serde_json::to_string(&payload).map_err(|_| internal("Library event payload"))?,
            now,
        ],
    )?;
    let event_sequence = connection.last_insert_rowid();
    let target = LibraryResourceTarget::Page {
        page_id: page_id.to_owned(),
    };
    let receipt = LibraryReceipt {
        mutation: ModuleMutationReceipt {
            operation_id: operation_id.to_owned(),
            duplicate: false,
        },
        operation_kind: "create_page".to_owned(),
        did_mutate: true,
        created_target: Some(target),
        affected_parent_keys: vec!["library".to_owned()],
        affected_page_ids: vec![page_id.to_owned()],
        affected_database_ids: Vec::new(),
        affected_view_ids: Vec::new(),
        committed_revisions: BTreeMap::from([
            (format!("blockLocation:{page_id}"), 1),
            (format!("blockMetadata:{page_id}"), 1),
            (format!("documentHead:{document_id}"), persisted.head_seq),
        ]),
        change_log_seq: event_sequence,
        committed_at: now.clone(),
    };
    let committed = CommittedModuleValue {
        value: LibraryCommitValue {
            affected_resource_ids: vec![page_id.to_owned()],
        },
        receipt,
        event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
    };
    let result = serde_json::to_value(&committed)
        .map_err(|_| internal("Library result could not be encoded"))?;
    insert_module_receipt(
        connection,
        NewModuleReceipt {
            module_name: MODULE_NAME,
            operation_id,
            context,
            operation_kind: "create_page",
            store_epoch,
            request_hash,
            result: &result,
            event_sequence: Some(event_sequence),
            committed_at: &now,
        },
    )?;
    let event = CommittedCoreModuleEvent {
        version: CORE_CONTRACT_VERSION,
        sequence: event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
        operation_id: Some(operation_id.to_owned()),
        committed_at: now,
        payload: CoreModuleEventPayload::Library(LibraryEvent {
            kind: LibraryEventKind::LibraryChanged,
            page_ids: vec![page_id.to_owned()],
            database_ids: Vec::new(),
            parent_keys: vec!["library".to_owned()],
        }),
    };
    Ok(LibraryApplyOutcome {
        committed,
        event: Some(event),
    })
}

fn assert_identity(
    connection: &Connection,
    profile_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    let valid = connection
        .query_row(
            "SELECT 1 FROM libraries WHERE id = ?1 AND profile_id = ?2",
            params![library_id, profile_id],
            |_| Ok(()),
        )
        .optional()?;
    if valid.is_some() {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::Unauthorized,
        "bound Library identity is not present in this Profile store",
        false,
    ))
}

fn preferred_project_id(connection: &Connection, library_id: &str) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT id FROM projects WHERE library_id = ?1 \
             ORDER BY CASE lifecycle WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END, \
               created, id LIMIT 1",
            [library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Library has no compatibility Project owner"))
}

fn append_rank(connection: &Connection, table: &str, scope_id: &str) -> Result<String, StoreError> {
    let sql = match table {
        "top_level_block_placements" => {
            "SELECT rank_key FROM top_level_block_placements WHERE project_id = ?1 \
             ORDER BY rank_key DESC, block_id DESC LIMIT 1"
        }
        "library_block_placements" => {
            "SELECT rank_key FROM library_block_placements WHERE library_id = ?1 \
             ORDER BY rank_key DESC, block_id DESC LIMIT 1"
        }
        _ => return Err(internal("Unsupported placement table")),
    };
    let previous = connection
        .query_row(sql, [scope_id], |row| row.get::<_, String>(0))
        .optional()?;
    Ok(previous.map_or_else(|| "a".to_owned(), |rank| format!("{rank}~")))
}

fn insert_library_placement(
    connection: &Connection,
    library_id: &str,
    block_id: &str,
    before: Option<&nodex_core_contracts::library::LibraryPlacementAnchor>,
    now: &str,
) -> Result<String, StoreError> {
    if let Some(anchor) = before {
        let actual = connection
            .query_row(
                "SELECT block.location_revision FROM library_block_placements placement \
                 JOIN blocks block ON block.id = placement.block_id \
                 WHERE placement.library_id = ?1 AND placement.block_id = ?2 \
                   AND block.lifecycle = 'active'",
                params![library_id, anchor.block_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(actual) = actual else {
            return Err(invalid(
                "Placement anchor is unavailable in the target Library",
            ));
        };
        if actual != anchor.expected_location_revision {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Placement anchor changed",
                true,
            ));
        }
        let ids = connection
            .prepare(
                "SELECT block_id FROM library_block_placements WHERE library_id = ?1 \
                 ORDER BY rank_key, block_id",
            )?
            .query_map([library_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let position = ids
            .iter()
            .position(|id| id == &anchor.block_id)
            .ok_or_else(|| corrupt("Validated placement anchor disappeared"))?;
        let mut ordered = ids;
        ordered.insert(position, block_id.to_owned());
        for (index, id) in ordered.iter().enumerate() {
            let rank = format!("{:020}", index + 1);
            if id == block_id {
                connection.execute(
                    "INSERT INTO library_block_placements(\
                       block_id, library_id, rank_key, revision, created_at, updated_at\
                     ) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
                    params![id, library_id, rank, now],
                )?;
                continue;
            }
            connection.execute(
                "UPDATE library_block_placements SET rank_key = ?1, revision = revision + 1, \
                   updated_at = ?2 WHERE block_id = ?3 AND library_id = ?4 AND rank_key <> ?1",
                params![rank, now, id, library_id],
            )?;
        }
        return Ok(format!("{:020}", position + 1));
    }
    let rank = append_rank(connection, "library_block_placements", library_id)?;
    connection.execute(
        "INSERT INTO library_block_placements(\
           block_id, library_id, rank_key, revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        params![block_id, library_id, rank, now],
    )?;
    Ok(rank)
}

#[allow(clippy::too_many_arguments)]
fn insert_page_read_model(
    connection: &Connection,
    page_id: &str,
    project_id: &str,
    document_id: &str,
    top_level_rank: &str,
    materialization: &crate::document::DocumentMaterialization,
    head_seq: i64,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO page_read_model(\
           page_block_id, project_id, lifecycle, location_kind, containing_document_id, \
           containing_database_id, top_level_rank_key, location_revision, metadata_revision, \
           document_id, document_generation, document_projected_seq, document_schema_version, \
           document_authority, membership_id, database_block_id, view_id, view_group_key, \
           view_rank_key, title, description_preview, description_length, has_description, \
           database_values_json, intrinsic_properties_json, property_revisions_json, \
           projection_version, created_at, updated_at\
         ) VALUES (?1, ?2, 'active', 'space', NULL, NULL, ?3, 1, 1, ?4, 1, ?5, ?6, \
           'ydoc_primary', NULL, NULL, NULL, NULL, NULL, ?7, ?8, ?9, ?10, '{}', '{}', '{}', \
           1, ?11, ?11)",
        params![
            page_id,
            project_id,
            top_level_rank,
            document_id,
            head_seq,
            i64::from(PAGE_SCHEMA_VERSION),
            materialization.title,
            materialization.preview,
            i64::try_from(materialization.nfm.len())
                .map_err(|_| internal("Page description length overflow"))?,
            i64::from(!materialization.nfm.trim().is_empty()),
            now,
        ],
    )?;
    Ok(())
}

fn validate_id(name: &str, value: &str) -> Result<(), StoreError> {
    if !value.trim().is_empty() && value.len() <= MAX_ID_LENGTH {
        return Ok(());
    }
    Err(invalid(&format!(
        "{name} must contain 1 to {MAX_ID_LENGTH} bytes"
    )))
}

fn deterministic_block_id(seed: &str) -> String {
    let entropy = sha256(format!("library-page-root:{seed}").as_bytes());
    format!(
        "{}-{}-7{}-8{}-{}",
        &entropy[..8],
        &entropy[8..12],
        &entropy[12..15],
        &entropy[15..18],
        &entropy[18..30]
    )
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::library::{LibraryNavigationParent, LibraryRead, LibraryReadValue};
    use nodex_core_contracts::{AdapterKind, LibraryId, ModuleReadRequest, ProfileId, ProjectId};
    use tempfile::tempdir;

    use crate::infrastructure::store::SqliteStoreKernel;
    use crate::library::LibraryModule;

    use super::*;

    const NOW: &str = "2026-07-18T23:59:00.000Z";

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:library-write".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn create_request(operation_id: &str, title: &str) -> ModuleApplyRequest<LibraryIntent> {
        ModuleApplyRequest {
            version: CORE_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::CreatePage {
                page_id: "page:created".to_owned(),
                document_id: "document:created".to_owned(),
                title: title.to_owned(),
                parent: LibraryWriteParent::Library { before: None },
            },
        }
    }

    #[test]
    fn creates_page_genesis_and_all_projections_once() {
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
                         VALUES ('project-1', 'library-1', 'Library writes', ?1, ?1)",
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
            .expect("seed Library identity");
        let module = LibraryModule::new("profile-1", "library-1", &kernel);

        let first = module
            .apply(
                &context(),
                create_request("operation:create-page", "Durable Page"),
            )
            .expect("create Page");
        let replay = module
            .apply(
                &context(),
                create_request("operation:create-page", "Durable Page"),
            )
            .expect("exact retry");
        let collision = module
            .apply(
                &context(),
                create_request("operation:create-page", "Different title"),
            )
            .expect_err("divergent retry");

        assert!(first.event.is_some());
        assert!(!first.committed.receipt.mutation.duplicate);
        assert!(replay.event.is_none());
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            first.committed.event_sequence,
            replay.committed.event_sequence
        );
        assert_eq!(
            collision.code,
            nodex_core_contracts::CoreErrorCode::IdempotencyKeyReused
        );

        let children = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: LibraryRead::Children {
                        parent: LibraryNavigationParent::Library,
                        cursor: None,
                        limit: None,
                        force_include_target: None,
                    },
                },
            )
            .expect("read Library roots");
        let LibraryReadValue::Children { items, total, .. } = children.value else {
            panic!("children snapshot");
        };
        assert_eq!(total, 1);
        assert!(matches!(
            &items[0],
            nodex_core_contracts::library::LibraryNavigationNode::Page {
                page_id,
                title,
                document_head_seq: 1,
                ..
            } if page_id == "page:created" && title == "Durable Page"
        ));

        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT document.head_seq, document.readiness, document.authority, \
                       materialization.title, projection.title, \
                       (SELECT count(*) FROM document_updates WHERE document_id = document.id), \
                       (SELECT count(*) FROM core_module_receipts \
                         WHERE module_name = 'library' AND operation_id = 'operation:create-page'), \
                       (SELECT count(*) FROM change_log \
                         WHERE operation_id = 'operation:create-page' AND kind = 'library.changed') \
                     FROM documents document \
                     JOIN document_materializations materialization \
                       ON materialization.document_id = document.id \
                     JOIN page_read_model projection ON projection.document_id = document.id \
                     WHERE document.id = 'document:created'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, i64>(7)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        1,
                        "ready".to_owned(),
                        "ydoc_primary".to_owned(),
                        "Durable Page".to_owned(),
                        "Durable Page".to_owned(),
                        1,
                        1,
                        1,
                    )
                );
                Ok(())
            })
            .expect("durable Page evidence");
    }
}
