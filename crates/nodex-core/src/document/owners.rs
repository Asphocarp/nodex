use nodex_core_contracts::document::{
    DeletableOwnedSourceKind, DocumentHeadRevision, DocumentInvalidationReason,
    DocumentOwnerCommand, DocumentOwnerEffect, DocumentOwnerRevision, DocumentSpaceAnchor,
};
use nodex_core_contracts::{BoundModuleContext, CommittedCoreModuleEvent};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use yrs::{ReadTxn, Transact};

use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::subtree::BlockSubtreeInsertionTarget;
use crate::infrastructure::document_repository::DocumentSyncEngine;
use crate::infrastructure::event_log::{
    NewChangeLogEntry, append_change_log, load_committed_event_by_sequence,
};
use crate::infrastructure::projection_impact::impact_for_page_document;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::genesis::prepare_yjs_genesis_with_blocks;
use super::history::{prepare_document_revision, record_document_revision_edit};
use super::operations::{
    DocumentBlockOperation, PortableSubtreeDocumentHead, PortableSubtreeTransferKind,
    PortableSubtreeTransferRequest, PreparedDocumentOperationUpdate,
    prepare_document_operation_update, prepare_portable_subtree_transfer_updates,
};
use super::persistence::{
    DocumentAuthorityRow, PersistYjsCommit, PersistYjsGenesis, persist_yjs_commit,
    persist_yjs_genesis, read_document_authority, read_event_head, read_store_epoch, sha256,
};
use super::runtime::reconstruct_yjs_engine;
use super::{
    BlockDocumentSchema, DocumentMaterialization, REUSABLE_TEMPLATE_SCHEMA_KEY,
    REUSABLE_TEMPLATE_SCHEMA_VERSION, SYNCED_BLOCK_SCHEMA_KEY, SYNCED_BLOCK_SCHEMA_VERSION,
    YrsDocumentEngine, decode_block_document, is_primary_canvas_block_id,
    materialize_decoded_document,
};

const SYNCED_OWNER_TYPE: &str = "synced_block_source";
const TEMPLATE_OWNER_TYPE: &str = "reusable_template_source";
const MAX_OWNER_BLOCKS: usize = 100_000;

pub(crate) struct OwnerCommandExecution {
    pub(crate) primary_document_id: String,
    pub(crate) generation: i64,
    pub(crate) head_seq: i64,
    pub(crate) event_sequence: i64,
    pub(crate) effect: DocumentOwnerEffect,
    pub(crate) events: Vec<CommittedCoreModuleEvent>,
    pub(crate) invalidate_document_ids: Vec<String>,
}

pub(crate) fn execute_owner_command(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    command: &DocumentOwnerCommand,
) -> Result<OwnerCommandExecution, StoreError> {
    let project_id = context
        .project_id
        .as_ref()
        .ok_or_else(|| unauthorized("Document owner command requires a bound Project"))?;
    if read_store_epoch(connection)? != store_epoch {
        return Err(StoreError::new(
            StoreErrorCode::StaleStoreEpoch,
            "Document owner command targets a stale store epoch",
            true,
        ));
    }
    match command {
        DocumentOwnerCommand::CreateSyncedSource {
            source_block_id,
            document_id,
            initial_blocks,
            before,
        } => create_yjs_owner(
            connection,
            context,
            store_epoch,
            operation_id,
            &project_id.0,
            NewYjsOwner {
                block_id: source_block_id,
                document_id,
                owner_type: SYNCED_OWNER_TYPE,
                schema: BlockDocumentSchema::SyncedBlockV1,
                schema_key: SYNCED_BLOCK_SCHEMA_KEY,
                schema_version: i64::from(SYNCED_BLOCK_SCHEMA_VERSION),
                display_name: None,
                initial_blocks,
                before: before.as_ref(),
            },
        ),
        DocumentOwnerCommand::CreateTemplate {
            source_block_id,
            document_id,
            display_name,
            initial_blocks,
            before,
        } => create_yjs_owner(
            connection,
            context,
            store_epoch,
            operation_id,
            &project_id.0,
            NewYjsOwner {
                block_id: source_block_id,
                document_id,
                owner_type: TEMPLATE_OWNER_TYPE,
                schema: BlockDocumentSchema::ReusableTemplateV1,
                schema_key: REUSABLE_TEMPLATE_SCHEMA_KEY,
                schema_version: i64::from(REUSABLE_TEMPLATE_SCHEMA_VERSION),
                display_name: Some(display_name),
                initial_blocks,
                before: before.as_ref(),
            },
        ),
        DocumentOwnerCommand::DeleteOwnedSource { owner_kind, owner } => {
            let expected_type = match owner_kind {
                DeletableOwnedSourceKind::SyncedBlock => SYNCED_OWNER_TYPE,
                DeletableOwnedSourceKind::ReusableTemplate => TEMPLATE_OWNER_TYPE,
            };
            delete_owner(
                connection,
                context,
                store_epoch,
                operation_id,
                &project_id.0,
                owner,
                expected_type,
                false,
            )
        }
        DocumentOwnerCommand::PromoteSyncedSource {
            host,
            root_block_id,
            reference_block_id,
            source_block_id,
            source_document_id,
        } => promote_synced_source(
            connection,
            context,
            store_epoch,
            operation_id,
            &project_id.0,
            host,
            root_block_id,
            reference_block_id,
            source_block_id,
            source_document_id,
        ),
        DocumentOwnerCommand::DemoteSyncedSource {
            host,
            source,
            reference_block_id,
            source_block_id,
        } => demote_synced_source(
            connection,
            context,
            store_epoch,
            operation_id,
            &project_id.0,
            host,
            source,
            reference_block_id,
            source_block_id,
        ),
        DocumentOwnerCommand::InstantiateTemplate {
            source_block_id,
            source,
            target,
            parent_block_id,
            before_block_id,
        } => instantiate_template(
            connection,
            context,
            store_epoch,
            operation_id,
            &project_id.0,
            source_block_id,
            source,
            target,
            parent_block_id.as_deref(),
            before_block_id.as_deref(),
        ),
    }
}

struct LoadedYjsHead {
    authority: DocumentAuthorityRow,
    schema: BlockDocumentSchema,
    engine: YrsDocumentEngine,
    materialization: DocumentMaterialization,
}

struct PersistedPreparedUpdate {
    loaded: LoadedYjsHead,
    event: CommittedCoreModuleEvent,
}

#[allow(clippy::too_many_arguments)]
fn promote_synced_source(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    project_id: &str,
    host: &DocumentHeadRevision,
    root_block_id: &str,
    reference_block_id: &str,
    source_block_id: &str,
    source_document_id: &str,
) -> Result<OwnerCommandExecution, StoreError> {
    validate_identity(reference_block_id, "Synced Block reference")?;
    if !is_uuid_v7(reference_block_id) {
        return Err(invalid(
            "New Synced Block reference identity must be UUID-v7",
        ));
    }
    let host_loaded = load_exact_yjs_head(connection, project_id, host, None)?;
    let root = find_materialized_block(&host_loaded.materialization.block_tree, root_block_id)
        .cloned()
        .ok_or_else(|| not_found("Promotion root Block was not found"))?;
    let placement =
        find_materialized_placement(&host_loaded.materialization.block_tree, root_block_id)
            .ok_or_else(|| corrupt("Promotion root Block has no stable placement"))?;
    let moved_block_ids = flatten_block_ids(std::slice::from_ref(&root))?;
    stage_owner(
        connection,
        project_id,
        source_block_id,
        SYNCED_OWNER_TYPE,
        source_document_id,
        SYNCED_BLOCK_SCHEMA_KEY,
        i64::from(SYNCED_BLOCK_SCHEMA_VERSION),
        None,
        None,
        false,
    )?;
    let reference = MaterializedBlockNode {
        id: reference_block_id.to_owned(),
        block_type: "syncedBlockRef".to_owned(),
        props: BTreeMap::from([(
            "sourceBlockId".to_owned(),
            Value::String(source_block_id.to_owned()),
        )]),
        content: None,
        children: Vec::new(),
    };
    let host_prepared = prepare_document_operation_update(
        &host_loaded.authority.head.id,
        host_loaded.schema,
        &host_loaded.engine.full_state_v1(),
        &host_loaded.engine.state_vector_v1(),
        &[
            DocumentBlockOperation::DeleteBlock {
                block_id: root_block_id.to_owned(),
            },
            DocumentBlockOperation::InsertBlock {
                block: reference,
                parent_block_id: placement.parent_block_id,
                before_block_id: placement.before_block_id,
            },
        ],
        false,
    )
    .map_err(document_operation_error)?;
    let host_operation_id = format!("{operation_id}:host");
    let host_persisted = persist_prepared_update(
        connection,
        context,
        store_epoch,
        &host_operation_id,
        host_loaded,
        host_prepared,
    )?;
    relocate_document_blocks(
        connection,
        project_id,
        &moved_block_ids,
        &host.document_id,
        source_document_id,
    )?;
    let source_authority = read_document_authority(connection, source_document_id)?
        .ok_or_else(|| corrupt("Staged Synced Block source has no Document authority"))?;
    let source_prepared = prepare_yjs_genesis_with_blocks(
        source_document_id,
        SYNCED_OWNER_TYPE,
        BlockDocumentSchema::SyncedBlockV1,
        &[root],
    )?;
    let source_full_state = source_prepared.engine.full_state_v1();
    let source_operation_id = format!("{operation_id}:source:genesis");
    let source_persisted = persist_yjs_genesis(
        connection,
        PersistYjsGenesis {
            authority: &source_authority,
            materialization: &source_prepared.materialization,
            update_id: &source_operation_id,
            client_session_id: &context.connection_id,
            update: &source_prepared.update_v1,
            state_vector: &source_prepared.state_vector_v1,
            full_state: &source_full_state,
            store_epoch,
            operation_id: &source_operation_id,
            emit_event: true,
        },
    )?;
    let source_event =
        load_committed_event_by_sequence(connection, source_persisted.event_sequence)?;
    let mut events = vec![host_persisted.event, source_event];
    events.sort_by_key(|event| event.sequence);
    Ok(OwnerCommandExecution {
        primary_document_id: host.document_id.clone(),
        generation: host.generation,
        head_seq: host_persisted.loaded.authority.head.head_seq,
        event_sequence: source_persisted.event_sequence,
        effect: DocumentOwnerEffect {
            created_block_ids: vec![reference_block_id.to_owned(), source_block_id.to_owned()],
            preserved_block_ids: moved_block_ids,
            deleted_block_ids: Vec::new(),
            document_heads: vec![
                head_revision(&host_persisted.loaded.authority),
                DocumentHeadRevision {
                    document_id: source_document_id.to_owned(),
                    generation: 1,
                    head_seq: source_persisted.head_seq,
                },
            ],
        },
        events,
        invalidate_document_ids: vec![host.document_id.clone(), source_document_id.to_owned()],
    })
}

#[allow(clippy::too_many_arguments)]
fn demote_synced_source(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    project_id: &str,
    host: &DocumentHeadRevision,
    source: &DocumentHeadRevision,
    reference_block_id: &str,
    source_block_id: &str,
) -> Result<OwnerCommandExecution, StoreError> {
    if count_synced_references(connection, project_id, source_block_id)? != 1 {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Synced Block source can be demoted only from its sole instance",
            false,
        ));
    }
    let host_loaded = load_exact_yjs_head(connection, project_id, host, None)?;
    let source_loaded = load_exact_yjs_head(
        connection,
        project_id,
        source,
        Some((source_block_id, SYNCED_OWNER_TYPE)),
    )?;
    let reference =
        find_materialized_block(&host_loaded.materialization.block_tree, reference_block_id)
            .ok_or_else(|| not_found("Synced Block reference was not found"))?;
    if reference.block_type != "syncedBlockRef"
        || reference.props.get("sourceBlockId").and_then(Value::as_str) != Some(source_block_id)
    {
        return Err(not_found(
            "Requested Block is not an instance of the Synced Block source",
        ));
    }
    let placement =
        find_materialized_placement(&host_loaded.materialization.block_tree, reference_block_id)
            .ok_or_else(|| corrupt("Synced Block reference has no stable placement"))?;
    let root_block_ids = source_loaded
        .materialization
        .block_tree
        .iter()
        .map(|block| block.id.clone())
        .collect::<Vec<_>>();
    if root_block_ids.is_empty() {
        return Err(corrupt("Synced Block source has no root Blocks"));
    }
    let host_delete = prepare_document_operation_update(
        &host_loaded.authority.head.id,
        host_loaded.schema,
        &host_loaded.engine.full_state_v1(),
        &host_loaded.engine.state_vector_v1(),
        &[DocumentBlockOperation::DeleteBlock {
            block_id: reference_block_id.to_owned(),
        }],
        true,
    )
    .map_err(document_operation_error)?;
    let host_intermediate_engine = apply_prepared_update(&host_loaded.engine, &host_delete)?;
    let transfer = prepare_portable_subtree_transfer_updates(
        &PortableSubtreeTransferRequest {
            kind: PortableSubtreeTransferKind::Move,
            source: portable_head(&source_loaded),
            target: PortableSubtreeDocumentHead {
                document_id: host.document_id.clone(),
                schema: host_loaded.schema,
                full_state_v1: host_intermediate_engine.full_state_v1(),
                expected_state_vector_v1: host_intermediate_engine.state_vector_v1(),
            },
            root_block_ids: root_block_ids.clone(),
            insertion: BlockSubtreeInsertionTarget {
                parent_block_id: placement.parent_block_id,
                before_block_id: placement.before_block_id,
            },
        },
        &mut |_| unreachable!("Move preserves every Block identity"),
    )
    .map_err(document_operation_error)?;
    let source_delete = transfer
        .source
        .ok_or_else(|| corrupt("Cross-Document move omitted its source update"))?;
    let host_delete_operation_id = format!("{operation_id}:host:delete-reference");
    let host_after_delete = persist_prepared_update(
        connection,
        context,
        store_epoch,
        &host_delete_operation_id,
        host_loaded,
        host_delete,
    )?;
    let source_operation_id = format!("{operation_id}:source:retire");
    let source_after_delete = persist_prepared_update(
        connection,
        context,
        store_epoch,
        &source_operation_id,
        source_loaded,
        source_delete,
    )?;
    let moved_block_ids = transfer.inserted_forest.block_ids.clone();
    relocate_document_blocks(
        connection,
        project_id,
        &moved_block_ids,
        &source.document_id,
        &host.document_id,
    )?;
    let host_insert_operation_id = format!("{operation_id}:host:insert-source");
    let host_final = persist_prepared_update(
        connection,
        context,
        store_epoch,
        &host_insert_operation_id,
        host_after_delete.loaded,
        transfer.target,
    )?;
    let now = sqlite_now(connection)?;
    connection.execute(
        "DELETE FROM top_level_block_placements WHERE block_id = ?1",
        [source_block_id],
    )?;
    let retired = connection.execute(
        "UPDATE blocks SET lifecycle = 'deleted', location_revision = location_revision + 1, \
           metadata_revision = metadata_revision + 1, updated_at = ?1 \
         WHERE id = ?2 AND project_id = ?3 AND type = ?4 AND lifecycle = 'active'",
        params![now, source_block_id, project_id, SYNCED_OWNER_TYPE],
    )?;
    if retired != 1 {
        return Err(corrupt("Synced Block source retirement lost its owner"));
    }
    let source_head = head_revision(&source_after_delete.loaded.authority);
    let invalidation_operation_id = format!("{operation_id}:source:invalidate");
    let invalidation = persist_invalidation(
        connection,
        project_id,
        store_epoch,
        &invalidation_operation_id,
        &source_head,
        DocumentInvalidationReason::AccessChanged,
        &now,
    )?;
    let mut events = vec![
        host_after_delete.event,
        source_after_delete.event,
        host_final.event,
        invalidation,
    ];
    events.sort_by_key(|event| event.sequence);
    Ok(OwnerCommandExecution {
        primary_document_id: host.document_id.clone(),
        generation: host.generation,
        head_seq: host_final.loaded.authority.head.head_seq,
        event_sequence: events
            .last()
            .map_or_else(|| read_event_head(connection), |event| Ok(event.sequence))?,
        effect: DocumentOwnerEffect {
            created_block_ids: Vec::new(),
            preserved_block_ids: moved_block_ids,
            deleted_block_ids: vec![reference_block_id.to_owned(), source_block_id.to_owned()],
            document_heads: vec![head_revision(&host_final.loaded.authority), source_head],
        },
        events,
        invalidate_document_ids: vec![host.document_id.clone(), source.document_id.clone()],
    })
}

#[allow(clippy::too_many_arguments)]
fn instantiate_template(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    project_id: &str,
    source_block_id: &str,
    source: &DocumentHeadRevision,
    target: &DocumentHeadRevision,
    parent_block_id: Option<&str>,
    before_block_id: Option<&str>,
) -> Result<OwnerCommandExecution, StoreError> {
    if source.document_id == target.document_id {
        return Err(invalid(
            "A Reusable Template cannot instantiate into itself",
        ));
    }
    let source_loaded = load_exact_yjs_head(
        connection,
        project_id,
        source,
        Some((source_block_id, TEMPLATE_OWNER_TYPE)),
    )?;
    let target_loaded = load_exact_yjs_head(connection, project_id, target, None)?;
    let root_block_ids = source_loaded
        .materialization
        .block_tree
        .iter()
        .map(|block| block.id.clone())
        .collect::<Vec<_>>();
    if root_block_ids.is_empty() {
        return Err(corrupt("Reusable Template source has no root Blocks"));
    }
    let mut allocate = |source_id: &str| stable_uuid_v7(operation_id, source_id);
    let transfer = prepare_portable_subtree_transfer_updates(
        &PortableSubtreeTransferRequest {
            kind: PortableSubtreeTransferKind::Copy,
            source: portable_head(&source_loaded),
            target: portable_head(&target_loaded),
            root_block_ids,
            insertion: BlockSubtreeInsertionTarget {
                parent_block_id: parent_block_id.map(str::to_owned),
                before_block_id: before_block_id.map(str::to_owned),
            },
        },
        &mut allocate,
    )
    .map_err(document_operation_error)?;
    let target_operation_id = format!("{operation_id}:target");
    let target_persisted = persist_prepared_update(
        connection,
        context,
        store_epoch,
        &target_operation_id,
        target_loaded,
        transfer.target,
    )?;
    Ok(OwnerCommandExecution {
        primary_document_id: target.document_id.clone(),
        generation: target.generation,
        head_seq: target_persisted.loaded.authority.head.head_seq,
        event_sequence: target_persisted.event.sequence,
        effect: DocumentOwnerEffect {
            created_block_ids: transfer.inserted_forest.block_ids,
            preserved_block_ids: vec![source_block_id.to_owned()],
            deleted_block_ids: Vec::new(),
            document_heads: vec![
                head_revision(&source_loaded.authority),
                head_revision(&target_persisted.loaded.authority),
            ],
        },
        events: vec![target_persisted.event],
        invalidate_document_ids: vec![target.document_id.clone()],
    })
}

fn load_exact_yjs_head(
    connection: &Connection,
    project_id: &str,
    expected: &DocumentHeadRevision,
    expected_owner: Option<(&str, &str)>,
) -> Result<LoadedYjsHead, StoreError> {
    let authority = read_document_authority(connection, &expected.document_id)?
        .ok_or_else(|| not_found("Owned Document was not found"))?;
    if authority.head.project_id != project_id || authority.owner_lifecycle != "active" {
        return Err(not_found("Owned Document is unavailable"));
    }
    if authority.head.generation != expected.generation
        || authority.head.head_seq != expected.head_seq
    {
        return Err(StoreError::new(
            StoreErrorCode::HeadConflict,
            "Owned Document changed before its multi-Document command acquired the writer lease",
            false,
        ));
    }
    if authority.head.sync_engine != DocumentSyncEngine::Yjs
        || !authority.head.is_live_yjs_authority()
    {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Multi-Document Block commands require ready Yjs authority",
            false,
        ));
    }
    if let Some((owner_block_id, owner_type)) = expected_owner
        && (authority.owner_block_id != owner_block_id || authority.owner_type != owner_type)
    {
        return Err(not_found("Owned Document source identity changed"));
    }
    let schema = BlockDocumentSchema::from_identity(
        &authority.head.schema_key,
        authority.head.schema_version,
    )
    .ok_or_else(|| corrupt("Owned Document schema is unsupported"))?;
    let engine = reconstruct_yjs_engine(connection, &authority.head)?;
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|error| corrupt(&format!("Owned Document schema is invalid: {error}")))?;
    let materialization = materialize_decoded_document(&decoded)
        .map_err(|error| corrupt(&format!("Owned Document cannot materialize: {error}")))?;
    Ok(LoadedYjsHead {
        authority,
        schema,
        engine,
        materialization,
    })
}

fn portable_head(loaded: &LoadedYjsHead) -> PortableSubtreeDocumentHead {
    PortableSubtreeDocumentHead {
        document_id: loaded.authority.head.id.clone(),
        schema: loaded.schema,
        full_state_v1: loaded.engine.full_state_v1(),
        expected_state_vector_v1: loaded.engine.state_vector_v1(),
    }
}

fn apply_prepared_update(
    engine: &YrsDocumentEngine,
    prepared: &PreparedDocumentOperationUpdate,
) -> Result<YrsDocumentEngine, StoreError> {
    let candidate = engine
        .prepare_update_v1(&prepared.update_v1)
        .map_err(|error| invalid(format!("Prepared Document update is invalid: {error}")))?;
    let transaction = candidate.document().transact();
    let full_state = transaction.encode_state_as_update_v1(&yrs::StateVector::default());
    drop(transaction);
    YrsDocumentEngine::from_full_state_v1(candidate.document().guid().as_ref(), &full_state)
        .map_err(|error| {
            corrupt(&format!(
                "Prepared Document update could not reload: {error}"
            ))
        })
}

fn persist_prepared_update(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    loaded: LoadedYjsHead,
    prepared: PreparedDocumentOperationUpdate,
) -> Result<PersistedPreparedUpdate, StoreError> {
    let next_engine = apply_prepared_update(&loaded.engine, &prepared)?;
    if next_engine.state_vector_v1() != prepared.state_vector_v1 {
        return Err(corrupt(
            "Prepared Document update state vector changed before persistence",
        ));
    }
    let full_state = next_engine.full_state_v1();
    let now = sqlite_now(connection)?;
    prepare_document_revision(
        connection,
        &loaded.authority,
        &loaded.materialization,
        context,
        &now,
    )?;
    let persisted = persist_yjs_commit(
        connection,
        PersistYjsCommit {
            authority: &loaded.authority,
            base_materialization: &loaded.materialization,
            materialization: &prepared.materialization,
            update_id: operation_id,
            client_session_id: &context.connection_id,
            base_head_seq: loaded.authority.head.head_seq,
            client_touched_block_ids: &[],
            update: &prepared.update_v1,
            state_vector: &prepared.state_vector_v1,
            full_state: &full_state,
            store_epoch,
            operation_id,
            event_kind: "document_updated",
            write_fence_block_ids: &prepared.write_fence_block_ids,
            title_write_fence_required: prepared.title_write_fence_required,
        },
    )?;
    record_document_revision_edit(
        connection,
        &loaded.authority.head.id,
        loaded.authority.head.generation,
        persisted.head_seq,
        &context.connection_id,
        &persisted.committed_at,
    )?;
    let event = load_committed_event_by_sequence(connection, persisted.event_sequence)?;
    let mut authority = loaded.authority;
    authority.head.head_seq = persisted.head_seq;
    authority.head.state_vector = persisted.state_vector;
    authority.head.state_hash = persisted.state_hash;
    authority.head.updated_at = persisted.committed_at;
    Ok(PersistedPreparedUpdate {
        loaded: LoadedYjsHead {
            authority,
            schema: loaded.schema,
            engine: next_engine,
            materialization: prepared.materialization,
        },
        event,
    })
}

fn relocate_document_blocks(
    connection: &Connection,
    project_id: &str,
    block_ids: &[String],
    source_document_id: &str,
    target_document_id: &str,
) -> Result<(), StoreError> {
    let now = sqlite_now(connection)?;
    for block_id in block_ids {
        let moved = connection.execute(
            "UPDATE blocks SET lifecycle = 'active', containing_document_id = ?1, \
               location_revision = location_revision + 1, updated_at = ?2 \
             WHERE id = ?3 AND project_id = ?4 AND lifecycle = 'deleted' \
               AND location_kind = 'document' AND containing_document_id = ?5",
            params![
                target_document_id,
                now,
                block_id,
                project_id,
                source_document_id,
            ],
        )?;
        if moved != 1 {
            return Err(corrupt(
                "Multi-Document command could not relocate a preserved Block identity",
            ));
        }
    }
    Ok(())
}

#[derive(Clone)]
struct MaterializedPlacement {
    parent_block_id: Option<String>,
    before_block_id: Option<String>,
}

fn find_materialized_placement(
    blocks: &[MaterializedBlockNode],
    target: &str,
) -> Option<MaterializedPlacement> {
    fn visit(
        blocks: &[MaterializedBlockNode],
        parent_block_id: Option<&str>,
        target: &str,
    ) -> Option<MaterializedPlacement> {
        for (index, block) in blocks.iter().enumerate() {
            if block.id == target {
                return Some(MaterializedPlacement {
                    parent_block_id: parent_block_id.map(str::to_owned),
                    before_block_id: blocks.get(index + 1).map(|next| next.id.clone()),
                });
            }
            if let Some(placement) = visit(&block.children, Some(&block.id), target) {
                return Some(placement);
            }
        }
        None
    }
    visit(blocks, None, target)
}

fn find_materialized_block<'a>(
    blocks: &'a [MaterializedBlockNode],
    target: &str,
) -> Option<&'a MaterializedBlockNode> {
    for block in blocks {
        if block.id == target {
            return Some(block);
        }
        if let Some(found) = find_materialized_block(&block.children, target) {
            return Some(found);
        }
    }
    None
}

fn count_synced_references(
    connection: &Connection,
    project_id: &str,
    source_block_id: &str,
) -> Result<usize, StoreError> {
    fn count(blocks: &[MaterializedBlockNode], source_block_id: &str) -> usize {
        blocks
            .iter()
            .map(|block| {
                usize::from(
                    block.block_type == "syncedBlockRef"
                        && block.props.get("sourceBlockId").and_then(Value::as_str)
                            == Some(source_block_id),
                ) + count(&block.children, source_block_id)
            })
            .sum()
    }
    let rows = connection
        .prepare(
            "SELECT materialization.block_tree_json \
             FROM document_materializations materialization \
             JOIN documents document ON document.id = materialization.document_id \
             JOIN block_documents ownership ON ownership.document_id = document.id \
             JOIN blocks owner ON owner.id = ownership.block_id \
             WHERE document.project_id = ?1 AND owner.lifecycle = 'active' \
             ORDER BY document.id",
        )?
        .query_map([project_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut total = 0usize;
    for row in rows {
        let blocks = serde_json::from_str::<Vec<MaterializedBlockNode>>(&row)
            .map_err(|_| corrupt("Document Block projection is invalid"))?;
        total = total
            .checked_add(count(&blocks, source_block_id))
            .ok_or_else(|| corrupt("Synced Block reference count overflowed"))?;
        if total > MAX_OWNER_BLOCKS {
            return Err(corrupt("Synced Block reference count exceeds its bound"));
        }
    }
    Ok(total)
}

fn head_revision(authority: &DocumentAuthorityRow) -> DocumentHeadRevision {
    DocumentHeadRevision {
        document_id: authority.head.id.clone(),
        generation: authority.head.generation,
        head_seq: authority.head.head_seq,
    }
}

fn stable_uuid_v7(operation_id: &str, source_block_id: &str) -> String {
    let digest = sha256(format!("{operation_id}:{source_block_id}").as_bytes());
    format!(
        "{}-{}-7{}-8{}-{}",
        &digest[..8],
        &digest[8..12],
        &digest[12..15],
        &digest[15..18],
        &digest[18..30],
    )
}

fn document_operation_error(error: super::DocumentOperationError) -> StoreError {
    invalid(format!(
        "Multi-Document Block operation is invalid: {error}"
    ))
}

struct NewYjsOwner<'a> {
    block_id: &'a str,
    document_id: &'a str,
    owner_type: &'static str,
    schema: BlockDocumentSchema,
    schema_key: &'static str,
    schema_version: i64,
    display_name: Option<&'a str>,
    initial_blocks: &'a [Value],
    before: Option<&'a DocumentSpaceAnchor>,
}

fn create_yjs_owner(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    project_id: &str,
    input: NewYjsOwner<'_>,
) -> Result<OwnerCommandExecution, StoreError> {
    let blocks = parse_initial_blocks(input.initial_blocks)?;
    let block_ids = flatten_block_ids(&blocks)?;
    if block_ids.iter().any(|id| id == input.block_id) {
        return Err(invalid(
            "Document owner identity cannot be reused by its initial content",
        ));
    }
    stage_owner(
        connection,
        project_id,
        input.block_id,
        input.owner_type,
        input.document_id,
        input.schema_key,
        input.schema_version,
        input.display_name,
        input.before,
        false,
    )?;
    let authority = read_document_authority(connection, input.document_id)?
        .ok_or_else(|| corrupt("Staged Yjs owner has no Document authority"))?;
    let prepared = prepare_yjs_genesis_with_blocks(
        input.document_id,
        input.owner_type,
        input.schema,
        &blocks,
    )?;
    let full_state = prepared.engine.full_state_v1();
    let update_id = format!("{operation_id}:genesis");
    let persisted = persist_yjs_genesis(
        connection,
        PersistYjsGenesis {
            authority: &authority,
            materialization: &prepared.materialization,
            update_id: &update_id,
            client_session_id: &context.connection_id,
            update: &prepared.update_v1,
            state_vector: &prepared.state_vector_v1,
            full_state: &full_state,
            store_epoch,
            operation_id: &update_id,
            emit_event: true,
        },
    )?;
    let event = load_committed_event_by_sequence(connection, persisted.event_sequence)?;
    let mut created_block_ids = vec![input.block_id.to_owned()];
    created_block_ids.extend(block_ids);
    created_block_ids.sort();
    created_block_ids.dedup();
    Ok(OwnerCommandExecution {
        primary_document_id: input.document_id.to_owned(),
        generation: 1,
        head_seq: persisted.head_seq,
        event_sequence: persisted.event_sequence,
        effect: DocumentOwnerEffect {
            created_block_ids,
            preserved_block_ids: Vec::new(),
            deleted_block_ids: Vec::new(),
            document_heads: vec![DocumentHeadRevision {
                document_id: input.document_id.to_owned(),
                generation: 1,
                head_seq: persisted.head_seq,
            }],
        },
        events: vec![event],
        invalidate_document_ids: vec![input.document_id.to_owned()],
    })
}

#[allow(clippy::too_many_arguments)]
fn delete_owner(
    connection: &Connection,
    _context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    project_id: &str,
    owner: &DocumentOwnerRevision,
    expected_owner_type: &str,
    canvas: bool,
) -> Result<OwnerCommandExecution, StoreError> {
    validate_owner_revision(connection, project_id, owner, expected_owner_type, canvas)?;
    let closure = collect_owned_closure(connection, project_id, &owner.owner_block_id)?;
    if !closure
        .document_heads
        .iter()
        .any(|head| head.document_id == owner.document_id)
    {
        return Err(corrupt("Owned source closure is missing its root Document"));
    }
    assert_unreferenced(connection, &closure)?;
    let now = sqlite_now(connection)?;
    for block_id in &closure.block_ids {
        connection.execute(
            "DELETE FROM top_level_block_placements WHERE block_id = ?1",
            [block_id],
        )?;
        connection.execute(
            "UPDATE blocks SET lifecycle = 'deleted', \
               location_revision = location_revision + CASE WHEN id = ?1 THEN 1 ELSE 0 END, \
               metadata_revision = metadata_revision + 1, updated_at = ?2 \
             WHERE id = ?1 AND project_id = ?3 AND lifecycle <> 'deleted'",
            params![block_id, now, project_id],
        )?;
    }
    let mut events = Vec::new();
    let mut event_sequence = read_event_head(connection)?;
    for (index, head) in closure.document_heads.iter().enumerate() {
        let event_operation_id = format!("{operation_id}:invalidate:{index}");
        let event = persist_invalidation(
            connection,
            project_id,
            store_epoch,
            &event_operation_id,
            head,
            DocumentInvalidationReason::AccessChanged,
            &now,
        )?;
        event_sequence = event.sequence;
        events.push(event);
    }
    Ok(OwnerCommandExecution {
        primary_document_id: owner.document_id.clone(),
        generation: owner.generation,
        head_seq: owner.head_seq,
        event_sequence,
        effect: DocumentOwnerEffect {
            created_block_ids: Vec::new(),
            preserved_block_ids: Vec::new(),
            deleted_block_ids: closure.block_ids.clone(),
            document_heads: closure.document_heads.clone(),
        },
        events,
        invalidate_document_ids: closure
            .document_heads
            .iter()
            .map(|head| head.document_id.clone())
            .collect(),
    })
}

#[allow(clippy::too_many_arguments)]
fn stage_owner(
    connection: &Connection,
    project_id: &str,
    block_id: &str,
    owner_type: &str,
    document_id: &str,
    schema_key: &str,
    schema_version: i64,
    display_name: Option<&str>,
    before: Option<&DocumentSpaceAnchor>,
    canvas: bool,
) -> Result<(), StoreError> {
    validate_identity(block_id, "Document owner Block")?;
    validate_identity(document_id, "Owned Document")?;
    if !is_uuid_v7(block_id) {
        return Err(invalid(
            "New document-bearing Block identity must be UUID-v7",
        ));
    }
    if display_name.is_some_and(|name| name.trim().is_empty() || name.len() > 512) {
        return Err(invalid("Document display name is invalid"));
    }
    let project_exists = connection
        .query_row("SELECT 1 FROM projects WHERE id = ?1", [project_id], |_| {
            Ok(())
        })
        .optional()?
        .is_some();
    if !project_exists {
        return Err(StoreError::new(
            StoreErrorCode::NotFound,
            "Bound Project does not exist",
            false,
        ));
    }
    for (table, identity) in [("blocks", block_id), ("documents", document_id)] {
        let sql = format!("SELECT 1 FROM {table} WHERE id = ?1");
        if connection
            .query_row(&sql, [identity], |_| Ok(()))
            .optional()?
            .is_some()
        {
            return Err(StoreError::new(
                StoreErrorCode::AlreadyOwned,
                format!("Identity already exists in {table}: {identity}"),
                false,
            ));
        }
    }
    validate_space_anchor(connection, project_id, before)?;
    let now = sqlite_now(connection)?;
    connection.execute(
        "INSERT INTO blocks (\
           id, project_id, type, lifecycle, location_kind, containing_document_id, \
           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 'active', 'space', NULL, NULL, 1, 1, ?4, ?4)",
        params![block_id, project_id, owner_type, now],
    )?;
    if let Some(display_name) = display_name {
        connection.execute(
            "INSERT INTO block_properties (\
               block_id, project_id, property_key, value_type, value_json, revision, updated_at\
             ) VALUES (?1, ?2, 'document.display_name', 'string', ?3, 1, ?4)",
            params![
                block_id,
                project_id,
                serde_json::to_string(display_name)
                    .map_err(|_| internal("Document display name JSON"))?,
                now,
            ],
        )?;
    }
    let rank = allocate_space_rank(
        connection,
        project_id,
        block_id,
        before.map(|value| value.block_id.as_str()),
    )?;
    connection.execute(
        "INSERT INTO top_level_block_placements (block_id, project_id, rank_key, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![block_id, project_id, rank, now],
    )?;
    connection.execute(
        "INSERT INTO documents (\
           id, project_id, generation, head_seq, schema_key, schema_version, state_vector, \
           state_hash, readiness, authority, created_at, updated_at, sync_engine\
         ) VALUES (?1, ?2, 1, 0, ?3, ?4, X'', ?5, ?6, ?7, ?8, ?8, ?9)",
        params![
            document_id,
            project_id,
            schema_key,
            schema_version,
            if canvas {
                "0".repeat(64)
            } else {
                String::new()
            },
            if canvas { "ready" } else { "pending_genesis" },
            if canvas {
                "ydoc_primary"
            } else {
                "legacy_shadow"
            },
            now,
            if canvas { "canvas_scene" } else { "yjs" },
        ],
    )?;
    connection.execute(
        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
        params![block_id, document_id, project_id, now],
    )?;
    Ok(())
}

fn validate_owner_revision(
    connection: &Connection,
    project_id: &str,
    owner: &DocumentOwnerRevision,
    expected_owner_type: &str,
    canvas: bool,
) -> Result<(), StoreError> {
    let row = connection
        .query_row(
            "SELECT block.type, block.lifecycle, block.location_kind, \
                    block.containing_document_id, block.location_revision, block.metadata_revision, \
                    document.id, document.generation, document.head_seq, document.readiness \
             FROM blocks block JOIN block_documents ownership ON ownership.block_id = block.id \
             JOIN documents document ON document.id = ownership.document_id \
             WHERE block.id = ?1 AND block.project_id = ?2",
            params![owner.owner_block_id, project_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()
        .map_err(|_| corrupt("Owned source boundary has invalid column types"))?
        .ok_or_else(|| not_found("Owned source was not found"))?;
    if row.0 != expected_owner_type || row.1 == "deleted" || row.2 != "space" || row.3.is_some() {
        return Err(not_found("Owned source is unavailable for deletion"));
    }
    if row.4 != owner.location_revision || row.5 != owner.metadata_revision {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Owned source Block revision changed before deletion",
            false,
        ));
    }
    if row.6 != owner.document_id
        || row.7 != owner.generation
        || row.8 != owner.head_seq
        || row.9 != "ready"
        || (!canvas && owner.head_seq < 1)
    {
        return Err(StoreError::new(
            StoreErrorCode::HeadConflict,
            "Owned source Document changed before deletion",
            false,
        ));
    }
    if canvas && is_primary_canvas_block_id(&owner.owner_block_id, project_id) {
        return Err(StoreError::new(
            StoreErrorCode::AlreadyOwned,
            "A Project's primary Canvas cannot be deleted",
            false,
        ));
    }
    Ok(())
}

#[derive(Default)]
struct OwnedClosure {
    block_ids: Vec<String>,
    document_heads: Vec<DocumentHeadRevision>,
}

fn collect_owned_closure(
    connection: &Connection,
    project_id: &str,
    root_block_id: &str,
) -> Result<OwnedClosure, StoreError> {
    let mut block_ids = BTreeSet::from([root_block_id.to_owned()]);
    let mut document_heads = BTreeMap::new();
    let mut pending = VecDeque::from([root_block_id.to_owned()]);
    while let Some(owner_block_id) = pending.pop_front() {
        let document = connection
            .query_row(
                "SELECT document.id, document.generation, document.head_seq, document.readiness, \
                        document.authority, owner.lifecycle \
                 FROM block_documents ownership JOIN documents document \
                   ON document.id = ownership.document_id AND document.project_id = ownership.project_id \
                 JOIN blocks owner ON owner.id = ownership.block_id \
                 WHERE ownership.block_id = ?1 AND ownership.project_id = ?2",
                params![owner_block_id, project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| corrupt("Owned closure Document row is invalid"))?;
        let Some((document_id, generation, head_seq, readiness, authority, lifecycle)) = document
        else {
            continue;
        };
        if readiness != "ready" || authority != "ydoc_primary" || lifecycle == "deleted" {
            return Err(corrupt("Owned closure contains unavailable authority"));
        }
        if document_heads
            .insert(
                document_id.clone(),
                DocumentHeadRevision {
                    document_id: document_id.clone(),
                    generation,
                    head_seq,
                },
            )
            .is_some()
        {
            continue;
        }
        let children = connection
            .prepare(
                "SELECT id FROM blocks WHERE project_id = ?1 AND containing_document_id = ?2 \
                 ORDER BY id",
            )?
            .query_map(params![project_id, document_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for child in children {
            if block_ids.insert(child.clone()) {
                if block_ids.len() > MAX_OWNER_BLOCKS {
                    return Err(invalid("Owned source closure exceeds its Block bound"));
                }
                pending.push_back(child);
            }
        }
    }
    Ok(OwnedClosure {
        block_ids: block_ids.into_iter().collect(),
        document_heads: document_heads.into_values().collect(),
    })
}

fn assert_unreferenced(connection: &Connection, closure: &OwnedClosure) -> Result<(), StoreError> {
    let targets = closure.block_ids.iter().collect::<BTreeSet<_>>();
    let owned_documents = closure
        .document_heads
        .iter()
        .map(|head| head.document_id.as_str())
        .collect::<BTreeSet<_>>();
    let materials = connection
        .prepare(
            "SELECT document_id, references_json FROM document_materializations ORDER BY document_id",
        )?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (document_id, references_json) in materials {
        if owned_documents.contains(document_id.as_str()) {
            continue;
        }
        let references = serde_json::from_str::<Value>(&references_json)
            .map_err(|_| corrupt("Document reference projection is invalid"))?;
        if value_references_target(&references, &targets) {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "Owned source is still referenced by another Document",
                false,
            ));
        }
    }
    let canvas_reference = connection
        .prepare(
            "SELECT document_id, target_block_id FROM canvas_page_references ORDER BY document_id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .any(|(document_id, target)| {
            !owned_documents.contains(document_id.as_str()) && targets.contains(&target)
        });
    if canvas_reference {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Owned source is still referenced by another Canvas",
            false,
        ));
    }
    Ok(())
}

fn value_references_target(value: &Value, targets: &BTreeSet<&String>) -> bool {
    match value {
        Value::Object(object) => {
            object
                .get("targetBlockId")
                .and_then(Value::as_str)
                .is_some_and(|target| targets.iter().any(|candidate| candidate.as_str() == target))
                || object
                    .values()
                    .any(|value| value_references_target(value, targets))
        }
        Value::Array(values) => values
            .iter()
            .any(|value| value_references_target(value, targets)),
        _ => false,
    }
}

fn persist_invalidation(
    connection: &Connection,
    project_id: &str,
    store_epoch: &str,
    operation_id: &str,
    head: &DocumentHeadRevision,
    reason: DocumentInvalidationReason,
    now: &str,
) -> Result<CommittedCoreModuleEvent, StoreError> {
    let reason_name = match reason {
        DocumentInvalidationReason::AccessChanged => "access_changed",
        DocumentInvalidationReason::GenerationChanged => "generation_changed",
        DocumentInvalidationReason::Restored => "restored",
    };
    let page_impact = read_document_authority(connection, &head.document_id)?
        .and_then(|authority| authority.page_impact());
    let database_ids = page_impact
        .as_ref()
        .and_then(|impact| impact.database.as_ref())
        .map(|database| vec![database.database_id.clone()])
        .unwrap_or_default();
    let payload = json!({
        "module": "owned_document",
        "kind": "document_invalidated",
        "documentId": head.document_id,
        "generation": head.generation,
        "headSeq": head.head_seq,
        "reason": reason_name,
    });
    let projection_impact = impact_for_page_document(page_impact.as_ref(), None)?;
    let document_ids = vec![head.document_id.clone()];
    let payload_json =
        serde_json::to_string(&payload).map_err(|_| internal("Invalidation event payload"))?;
    let sequence = append_change_log(
        connection,
        NewChangeLogEntry {
            project_id,
            store_epoch,
            kind: "owned_document.document_invalidated",
            operation_id: Some(operation_id),
            block_ids: &[],
            document_ids: &document_ids,
            database_block_ids: &database_ids,
            payload_json: &payload_json,
            projection_impact: &projection_impact,
            committed_at: now,
        },
    )?;
    load_committed_event_by_sequence(connection, sequence)
}

fn parse_initial_blocks(values: &[Value]) -> Result<Vec<MaterializedBlockNode>, StoreError> {
    if values.is_empty() || values.len() > MAX_OWNER_BLOCKS {
        return Err(invalid(
            "Initial document-bearing content must contain a bounded Block forest",
        ));
    }
    values
        .iter()
        .cloned()
        .map(|value| {
            serde_json::from_value(value)
                .map_err(|_| invalid("Initial document-bearing Block is invalid"))
        })
        .collect()
}

fn flatten_block_ids(blocks: &[MaterializedBlockNode]) -> Result<Vec<String>, StoreError> {
    fn visit(block: &MaterializedBlockNode, ids: &mut BTreeSet<String>) -> Result<(), StoreError> {
        validate_identity(&block.id, "Initial Block")?;
        if !ids.insert(block.id.clone()) {
            return Err(invalid("Initial document-bearing Block IDs must be unique"));
        }
        if ids.len() > MAX_OWNER_BLOCKS {
            return Err(invalid(
                "Initial document-bearing Block forest exceeds its bound",
            ));
        }
        for child in &block.children {
            visit(child, ids)?;
        }
        Ok(())
    }
    let mut ids = BTreeSet::new();
    for block in blocks {
        visit(block, &mut ids)?;
    }
    Ok(ids.into_iter().collect())
}

fn validate_space_anchor(
    connection: &Connection,
    project_id: &str,
    before: Option<&DocumentSpaceAnchor>,
) -> Result<(), StoreError> {
    let Some(before) = before else {
        return Ok(());
    };
    validate_identity(&before.block_id, "Space placement anchor")?;
    let revision = connection
        .query_row(
            "SELECT block.location_revision FROM blocks block \
             JOIN top_level_block_placements placement ON placement.block_id = block.id \
             WHERE block.id = ?1 AND block.project_id = ?2 AND block.lifecycle <> 'deleted' \
               AND block.location_kind = 'space'",
            params![before.block_id, project_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if revision == Some(before.expected_location_revision) && before.expected_location_revision >= 1
    {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::RevisionConflict,
        "Space placement anchor changed or is unavailable",
        false,
    ))
}

fn allocate_space_rank(
    connection: &Connection,
    project_id: &str,
    target_id: &str,
    before_id: Option<&str>,
) -> Result<String, StoreError> {
    let mut items = connection
        .prepare(
            "SELECT block_id, rank_key FROM top_level_block_placements \
             WHERE project_id = ?1 ORDER BY rank_key, block_id",
        )?
        .query_map([project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    items.retain(|(id, _)| id != target_id);
    let anchor = before_id
        .map(|before| {
            items
                .iter()
                .position(|(id, _)| id == before)
                .ok_or_else(|| invalid("Space placement anchor does not exist"))
        })
        .transpose()?
        .unwrap_or(items.len());
    if items.len() > MAX_OWNER_BLOCKS {
        return Err(invalid("Space placement rank exceeds its rebalance bound"));
    }
    let canonical = items.iter().enumerate().all(|(index, (_, rank))| {
        parse_rank(rank).is_some() && (index == 0 || items[index - 1].1.as_str() < rank.as_str())
    });
    if !canonical {
        rebalance_ranks(connection, project_id, &mut items)?;
    }
    if let Some(rank) = rank_between(
        anchor
            .checked_sub(1)
            .and_then(|index| items.get(index))
            .and_then(|(_, rank)| parse_rank(rank)),
        items.get(anchor).and_then(|(_, rank)| parse_rank(rank)),
    ) {
        return Ok(format!("{rank:032x}"));
    }
    rebalance_ranks(connection, project_id, &mut items)?;
    rank_between(
        anchor
            .checked_sub(1)
            .and_then(|index| items.get(index))
            .and_then(|(_, rank)| parse_rank(rank)),
        items.get(anchor).and_then(|(_, rank)| parse_rank(rank)),
    )
    .map(|rank| format!("{rank:032x}"))
    .ok_or_else(|| internal("Fractional rank space remained exhausted"))
}

fn rebalance_ranks(
    connection: &Connection,
    project_id: &str,
    items: &mut [(String, String)],
) -> Result<(), StoreError> {
    let divisor = u128::try_from(items.len() + 1)
        .map_err(|_| internal("Fractional rank divisor overflowed"))?;
    for (index, (id, rank)) in items.iter_mut().enumerate() {
        let numerator =
            u128::try_from(index + 1).map_err(|_| internal("Fractional rank index overflowed"))?;
        *rank = format!("{:032x}", u128::MAX / divisor * numerator);
        connection.execute(
            "UPDATE top_level_block_placements SET rank_key = ?1 \
             WHERE block_id = ?2 AND project_id = ?3",
            params![&*rank, &*id, project_id],
        )?;
    }
    Ok(())
}

fn rank_between(left: Option<u128>, right: Option<u128>) -> Option<u128> {
    let left = left.unwrap_or(0);
    let right = right.unwrap_or(u128::MAX);
    let gap = right.checked_sub(left)?;
    (gap > 1).then_some(left + gap / 2)
}

fn parse_rank(value: &str) -> Option<u128> {
    (value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
    .then(|| u128::from_str_radix(value, 16).ok())
    .flatten()
}

fn is_uuid_v7(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.len() == 36
        && [8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        && bytes[14] == b'7'
        && bytes.iter().enumerate().all(|(index, byte)| {
            [8, 13, 18, 23].contains(&index)
                || byte.is_ascii_digit()
                || (b'a'..=b'f').contains(byte)
        })
}

fn validate_identity(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.len() <= 512 && value.trim() == value {
        return Ok(());
    }
    Err(invalid(format!("{label} identity is invalid")))
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn unauthorized(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
