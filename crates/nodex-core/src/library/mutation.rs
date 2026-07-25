use std::collections::BTreeMap;
use std::path::Path;

#[cfg(test)]
use nodex_core_contracts::LIBRARY_CONTRACT_VERSION;
use nodex_core_contracts::library::{
    LibraryAccess, LibraryBlockPropertyMutationReceipt, LibraryBlockTransferDocumentCommit,
    LibraryBlockTransferResult, LibraryCommitValue, LibraryIntent, LibraryPageCopyResult,
    LibraryPageCreateResult, LibraryPageLifecycleMutationReceipt, LibraryReceipt,
    LibraryResourceTarget, LibraryWriteParent,
};
use nodex_core_contracts::{
    BoundModuleContext, CommittedModuleValue, ModuleApplyRequest, ModuleMutationReceipt,
    ProjectionImpact, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, Transact};

use crate::database::create_database_authority_records;
use crate::document::{
    BlockDocumentSchema, DocumentAuthorityRow, DocumentBlockOperation, DocumentMaterialization,
    PAGE_SCHEMA_KEY, PAGE_SCHEMA_VERSION, PersistYjsCommit, PersistYjsGenesis, YrsDocumentEngine,
    decode_block_document, materialize_decoded_document, mint_document_semantic_etags,
    parse_inline_markdown_title, persist_yjs_commit, persist_yjs_genesis,
    prepare_document_operation_update, prepare_page_yjs_genesis,
    prepare_page_yjs_genesis_with_content, read_document_authority, read_store_epoch,
    reconstruct_yjs_engine, sha256,
};
use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::fractional_rank::{
    FractionalRankErrorCode, RankedItem, plan as plan_fractional_rank,
};
use crate::domain::identity::stable_uuid_v7;
use crate::infrastructure::event_log::{
    NewChangeLogEntry, append_change_log, load_committed_event_by_sequence,
};
use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::projection_impact::expand_database_coordinates;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::writer::StoreWriter;

use super::LibraryApplyOutcome;

const MODULE_NAME: &str = "library";
const MAX_ID_LENGTH: usize = 512;
const MAX_PAGE_TITLE_LENGTH: usize = 10_000;

pub(super) struct MutationEffects {
    pub(super) project_id: String,
    pub(super) operation_kind: &'static str,
    pub(super) change_kind: &'static str,
    pub(super) did_mutate: bool,
    pub(super) created_target: Option<LibraryResourceTarget>,
    pub(super) affected_parent_keys: Vec<String>,
    pub(super) affected_block_ids: Vec<String>,
    pub(super) affected_page_ids: Vec<String>,
    pub(super) affected_database_ids: Vec<String>,
    pub(super) affected_view_ids: Vec<String>,
    pub(super) affected_document_ids: Vec<String>,
    pub(super) committed_revisions: BTreeMap<String, i64>,
    pub(super) page_create: Option<LibraryPageCreateResult>,
    pub(super) page_copy: Option<LibraryPageCopyResult>,
    pub(super) block_transfer: Option<LibraryBlockTransferResult>,
    pub(super) page_lifecycle: Option<LibraryPageLifecycleMutationReceipt>,
    pub(super) block_property_mutation: Option<LibraryBlockPropertyMutationReceipt>,
    pub(super) agent_page_copy: Option<nodex_core_contracts::library::LibraryAgentPageCopyResult>,
    pub(super) agent_create_pages:
        Option<nodex_core_contracts::library::LibraryAgentCreatePagesResult>,
    pub(super) agent_move_pages: Option<nodex_core_contracts::library::LibraryAgentMovePagesResult>,
    pub(super) change_payload: Option<serde_json::Value>,
    pub(super) committed_at: String,
}

pub(super) struct ResolvedWriteParent {
    pub(super) parent_key: String,
    pub(super) page_id: Option<String>,
    pub(super) project_id: String,
    pub(super) document: Option<ResolvedParentDocument>,
    pub(super) before_block_id: Option<String>,
}

pub(super) struct ResolvedParentDocument {
    pub(super) authority: DocumentAuthorityRow,
    pub(super) engine: YrsDocumentEngine,
    pub(super) base_materialization: DocumentMaterialization,
    pub(super) schema: BlockDocumentSchema,
}

struct ResourceAuthority {
    id: String,
    project_id: String,
    resource_kind: &'static str,
    lifecycle: String,
    location_kind: String,
    containing_document_id: Option<String>,
    location_revision: i64,
    block_metadata_revision: i64,
    resource_metadata_revision: i64,
}

pub(super) fn apply(
    writer: &StoreWriter,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: ModuleApplyRequest<LibraryIntent>,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let context = context.clone();
    let assets_root = assets_root.to_path_buf();
    writer.call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            assert_identity(transaction, &profile_id, &library_id)?;
            let store_epoch = read_store_epoch(transaction)?;
            if request.store_epoch.0 != store_epoch {
                return Err(StoreError::new(
                    StoreErrorCode::StaleStoreEpoch,
                    "Library mutation targets a stale store epoch",
                    true,
                ));
            }
            let request_hash = match &request.intent {
                LibraryIntent::TransferBlocks { intent, .. } => {
                    super::block_transfer::semantic_request_hash(&context, &store_epoch, intent)?
                }
                LibraryIntent::ApplyBlockPropertyMutation { .. } => {
                    let fingerprint = serde_json::to_vec(&(
                        &context.profile_id,
                        &context.library_id,
                        &context.project_id,
                        request.contract_version,
                        &request.store_epoch,
                        &request.intent,
                    ))
                    .map_err(|_| internal("Library Property mutation cannot be fingerprinted"))?;
                    sha256(&fingerprint)
                }
                LibraryIntent::PersistAgentProjectResourceGrants { provenance, grants } => {
                    let grants = super::agent_authorization::canonicalize_grants(grants)?;
                    let fingerprint = serde_json::to_vec(&(
                        "nodex.agent.project-resource-grants.v1",
                        &context.profile_id,
                        &context.library_id,
                        &context.project_id,
                        request.contract_version,
                        &request.store_epoch,
                        provenance,
                        grants,
                    ))
                    .map_err(|_| internal("Agent Project grants cannot be fingerprinted"))?;
                    sha256(&fingerprint)
                }
                _ => {
                    let fingerprint = serde_json::to_vec(&(
                        &context.profile_id,
                        &context.library_id,
                        &context.project_id,
                        &context.adapter,
                        request.contract_version,
                        &request.store_epoch,
                        &request.intent,
                    ))
                    .map_err(|_| internal("Library mutation cannot be fingerprinted"))?;
                    sha256(&fingerprint)
                }
            };
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
                    PageGenesisInput::PlainTitle(title),
                    parent,
                ),
                LibraryIntent::CreatePageFromNfm {
                    title_markdown,
                    nfm,
                    destination,
                } => {
                    let page_id = stable_uuid_v7(
                        &request.operation_id,
                        "page",
                        &format!("{library_id}:semantic"),
                    );
                    let document_id = stable_uuid_v7(
                        &request.operation_id,
                        "page_document",
                        &format!("{library_id}:semantic"),
                    );
                    super::page_write_semantic::create_page(
                        transaction,
                        &context,
                        &store_epoch,
                        &library_id,
                        &request.operation_id,
                        &request_hash,
                        &page_id,
                        &document_id,
                        title_markdown,
                        nfm,
                        destination,
                    )
                }
                LibraryIntent::CreateDatabase {
                    database_id,
                    data_source_id,
                    view_id,
                    name,
                    parent,
                } => create_database(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    database_id,
                    data_source_id,
                    view_id,
                    name,
                    parent,
                ),
                LibraryIntent::CopyPage {
                    source_page_id,
                    expected_location_revision,
                    expected_parent_revision,
                    expected_active_membership_revision,
                    expected_document_generation,
                    expected_document_head_seq,
                    destination,
                } => super::page_copy::copy_page(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    source_page_id,
                    *expected_location_revision,
                    *expected_parent_revision,
                    *expected_active_membership_revision,
                    *expected_document_generation,
                    *expected_document_head_seq,
                    destination,
                    &assets_root,
                ),
                LibraryIntent::DuplicatePage {
                    source_page_id,
                    destination,
                } => super::page_write_semantic::duplicate_page(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    source_page_id,
                    destination,
                    &assets_root,
                ),
                LibraryIntent::MovePage {
                    page_id,
                    destination,
                } => super::page_write_semantic::move_page(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    page_id,
                    destination,
                    &assets_root,
                ),
                LibraryIntent::DeletePage {
                    page_id,
                    expected_etag,
                } => super::page_lifecycle_mutation::delete_with_etag(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    page_id,
                    expected_etag,
                ),
                LibraryIntent::ArchiveResource {
                    target,
                    expected_metadata_revision,
                } => change_resource_lifecycle(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    target,
                    *expected_metadata_revision,
                    false,
                ),
                LibraryIntent::RestoreResource {
                    target,
                    expected_metadata_revision,
                } => change_resource_lifecycle(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    target,
                    *expected_metadata_revision,
                    true,
                ),
                LibraryIntent::ApplyPageLifecycle { mutation } => {
                    super::page_lifecycle_mutation::apply(
                        transaction,
                        &context,
                        &store_epoch,
                        &library_id,
                        &request.operation_id,
                        &request_hash,
                        mutation,
                    )
                }
                LibraryIntent::ApplyBlockPropertyMutation { mutation } => {
                    super::page_property_mutation::apply(
                        transaction,
                        &context,
                        &store_epoch,
                        &library_id,
                        &request.operation_id,
                        &request_hash,
                        mutation,
                    )
                }
                LibraryIntent::GrantProjectAccess {
                    project_id,
                    target,
                    access,
                } => grant_project_access(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    project_id,
                    target,
                    *access,
                ),
                LibraryIntent::PersistAgentProjectResourceGrants { provenance, grants } => {
                    super::agent_authorization::persist_project_grants(
                        transaction,
                        &context,
                        &store_epoch,
                        &library_id,
                        &request.operation_id,
                        &request_hash,
                        provenance,
                        grants,
                    )
                }
                LibraryIntent::MoveBlock {
                    target,
                    expected_location_revision,
                    parent,
                } => move_block(
                    transaction,
                    &context,
                    &store_epoch,
                    &library_id,
                    &request.operation_id,
                    &request_hash,
                    target,
                    *expected_location_revision,
                    parent,
                ),
                LibraryIntent::TransferBlocks {
                    intent,
                    write_fence,
                } => super::block_transfer::apply(
                    transaction,
                    &context,
                    &library_id,
                    &request.operation_id,
                    &store_epoch,
                    &request_hash,
                    intent,
                    write_fence.as_ref(),
                    &assets_root,
                ),
                LibraryIntent::ExecutePreparedAgentPageCopy { .. } => Err(invalid(
                    "Prepared Agent Page copy is assembled by the Library Module",
                )),
                LibraryIntent::ExecutePreparedAgentCreatePages { .. } => Err(invalid(
                    "Prepared Agent Page creation is assembled by the Library Module",
                )),
                LibraryIntent::ExecutePreparedAgentMovePages { .. } => Err(invalid(
                    "Prepared Agent Page movement is assembled by the Library Module",
                )),
            }
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn move_block(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    target: &LibraryResourceTarget,
    expected_location_revision: i64,
    parent: &LibraryWriteParent,
) -> Result<LibraryApplyOutcome, StoreError> {
    let authority = read_resource_authority(connection, library_id, target)?;
    if authority.lifecycle != "active" {
        return Err(StoreError::new(
            StoreErrorCode::NotFound,
            "Only an active Library resource can move",
            false,
        ));
    }
    if authority.location_revision != expected_location_revision {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Library resource moved since this action began",
            true,
        ));
    }
    if authority.location_kind == "database" {
        return Err(invalid(
            "A Data Source row Page must move through the Database Module",
        ));
    }
    let resolved_parent =
        resolve_write_parent(connection, library_id, bound_project_id(context)?, parent)?;
    if authority.resource_kind == "page"
        && let Some(target_page_id) = &resolved_parent.page_id
    {
        let cycle = connection
            .query_row(
                "WITH RECURSIVE ancestors(page_id) AS (\
                   SELECT ?1 \
                   UNION ALL \
                   SELECT page.parent_id FROM pages page JOIN ancestors current \
                     ON page.block_id = current.page_id \
                   WHERE page.parent_kind = 'page'\
                 ) SELECT 1 FROM ancestors WHERE page_id = ?2 LIMIT 1",
                params![target_page_id, authority.id],
                |_| Ok(()),
            )
            .optional()?;
        if cycle.is_some() {
            return Err(invalid("A Page cannot move below itself"));
        }
    }
    let target_project_id = resolved_parent.document.as_ref().map_or_else(
        || authority.project_id.clone(),
        |_| resolved_parent.project_id.clone(),
    );
    if target_project_id != authority.project_id {
        return Err(invalid(
            "Cross-Project Library resource rehome is not available in this slice",
        ));
    }
    let source_parent_key = resource_parent_key(connection, &authority)?;
    let source_document_id = authority.containing_document_id.clone();
    let source_document = source_document_id
        .as_deref()
        .map(|document_id| load_parent_document(connection, document_id))
        .transpose()?;
    let source_parent_page_id = source_document
        .as_ref()
        .map(|source| source.authority.owner_block_id.clone());
    let target_document_id = resolved_parent
        .document
        .as_ref()
        .map(|target| target.authority.head.id.clone());
    let same_document = source_document_id.is_some() && source_document_id == target_document_id;
    let moved_block = source_document
        .as_ref()
        .and_then(|source| {
            find_materialized_block(&source.base_materialization.block_tree, &authority.id)
        })
        .unwrap_or_else(|| embedded_resource_block(&authority.id, authority.resource_kind));
    let now = sqlite_now(connection)?;

    if authority.location_kind == "space" && target_document_id.is_some() {
        connection.execute(
            "DELETE FROM top_level_block_placements WHERE block_id = ?1",
            [&authority.id],
        )?;
        connection.execute(
            "DELETE FROM library_block_placements WHERE block_id = ?1 AND library_id = ?2",
            params![authority.id, library_id],
        )?;
    }

    let changed = connection.execute(
        "UPDATE blocks SET location_kind = ?1, containing_document_id = ?2, \
           containing_database_id = NULL, location_revision = location_revision + 1, \
           updated_at = ?3 WHERE id = ?4 AND location_revision = ?5",
        params![
            if target_document_id.is_some() {
                "document"
            } else {
                "space"
            },
            target_document_id,
            now,
            authority.id,
            expected_location_revision
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Library resource changed during move",
            true,
        ));
    }

    if target_document_id.is_none() {
        connection.execute(
            "DELETE FROM library_block_placements WHERE block_id = ?1 AND library_id = ?2",
            params![authority.id, library_id],
        )?;
        if authority.location_kind != "space" {
            let rank = append_rank(
                connection,
                "top_level_block_placements",
                &authority.project_id,
            )?;
            connection.execute(
                "INSERT INTO top_level_block_placements(\
                   block_id, project_id, rank_key, created_at, updated_at\
                 ) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![authority.id, authority.project_id, rank, now],
            )?;
        }
        insert_library_placement(
            connection,
            library_id,
            &authority.id,
            match parent {
                LibraryWriteParent::Library { before } => before.as_ref(),
                LibraryWriteParent::Page { .. } => None,
            },
            &now,
        )?;
    }

    let mut committed_document_heads = BTreeMap::new();
    if same_document {
        let target_document = resolved_parent
            .document
            .as_ref()
            .ok_or_else(|| corrupt("Same-Document move lost its target"))?;
        let head_seq = persist_parent_operations(
            connection,
            store_epoch,
            operation_id,
            "move",
            target_document,
            &[DocumentBlockOperation::MoveBlock {
                block_id: authority.id.clone(),
                parent_block_id: None,
                before_block_id: resolved_parent.before_block_id.clone(),
            }],
        )?;
        committed_document_heads.insert(target_document.authority.head.id.clone(), head_seq);
    } else {
        if let Some(source) = &source_document {
            let head_seq = persist_parent_operations(
                connection,
                store_epoch,
                operation_id,
                "source",
                source,
                &[DocumentBlockOperation::DeleteBlock {
                    block_id: authority.id.clone(),
                }],
            )?;
            committed_document_heads.insert(source.authority.head.id.clone(), head_seq);
        }
        if let Some(target_document) = &resolved_parent.document {
            let head_seq = persist_parent_operations(
                connection,
                store_epoch,
                operation_id,
                "target",
                target_document,
                &[DocumentBlockOperation::InsertBlock {
                    block: moved_block,
                    parent_block_id: None,
                    before_block_id: resolved_parent.before_block_id.clone(),
                }],
            )?;
            committed_document_heads.insert(target_document.authority.head.id.clone(), head_seq);
        }
    }

    if authority.resource_kind == "page" {
        let parent_kind = if resolved_parent.page_id.is_some() {
            "page"
        } else {
            "library"
        };
        let parent_id = resolved_parent.page_id.as_deref().unwrap_or(library_id);
        let changed = connection.execute(
            "UPDATE pages SET parent_kind = ?1, parent_id = ?2, parent_revision = ?3, \
               updated_at = ?4 WHERE block_id = ?5 AND library_id = ?6",
            params![
                parent_kind,
                parent_id,
                expected_location_revision + 1,
                now,
                authority.id,
                library_id
            ],
        )?;
        if changed != 1 {
            return Err(corrupt("Moved Page lost its canonical coordinates"));
        }
        let top_level_rank = if target_document_id.is_none() {
            connection
                .query_row(
                    "SELECT rank_key FROM top_level_block_placements WHERE block_id = ?1",
                    [&authority.id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
        } else {
            None
        };
        connection.execute(
            "UPDATE page_read_model SET location_kind = ?1, containing_document_id = ?2, \
               containing_database_id = NULL, top_level_rank_key = ?3, location_revision = ?4, \
               updated_at = ?5 WHERE page_block_id = ?6",
            params![
                if target_document_id.is_some() {
                    "document"
                } else {
                    "space"
                },
                target_document_id,
                top_level_rank,
                expected_location_revision + 1,
                now,
                authority.id
            ],
        )?;
    }

    let mut affected_page_ids = vec![];
    if authority.resource_kind == "page" {
        affected_page_ids.push(authority.id.clone());
    }
    affected_page_ids.extend(source_parent_page_id);
    affected_page_ids.extend(resolved_parent.page_id.clone());
    normalize_ids(&mut affected_page_ids);
    let mut affected_parent_keys = vec![source_parent_key, resolved_parent.parent_key];
    normalize_ids(&mut affected_parent_keys);
    let mut affected_document_ids = committed_document_heads.keys().cloned().collect::<Vec<_>>();
    normalize_ids(&mut affected_document_ids);
    let committed_revisions = BTreeMap::from_iter(
        [(
            format!("blockLocation:{}", authority.id),
            expected_location_revision + 1,
        )]
        .into_iter()
        .chain(
            committed_document_heads
                .into_iter()
                .map(|(document_id, head_seq)| (format!("documentHead:{document_id}"), head_seq)),
        ),
    );
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: authority.project_id,
            operation_kind: "move_block",
            change_kind: "library.changed",
            did_mutate: true,
            created_target: None,
            affected_parent_keys,
            affected_block_ids: Vec::new(),
            affected_page_ids,
            affected_database_ids: (authority.resource_kind == "database")
                .then(|| authority.id.clone())
                .into_iter()
                .collect(),
            affected_view_ids: Vec::new(),
            affected_document_ids,
            committed_revisions,
            page_create: None,
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
            change_payload: None,
            committed_at: now,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn change_resource_lifecycle(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    target: &LibraryResourceTarget,
    expected_metadata_revision: i64,
    restore: bool,
) -> Result<LibraryApplyOutcome, StoreError> {
    let authority = read_resource_authority(connection, library_id, target)?;
    let (from, to, operation_kind) = if restore {
        ("archived", "active", "restore_resource")
    } else {
        ("active", "archived", "archive_resource")
    };
    if authority.lifecycle != from
        || authority.resource_metadata_revision != expected_metadata_revision
    {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Library resource lifecycle or metadata changed",
            true,
        ));
    }
    if authority.location_kind == "database" {
        return Err(invalid(
            "A Data Source row Page must change lifecycle through the Database Module",
        ));
    }
    if authority.resource_kind == "database" && !restore {
        let protected = connection
            .query_row(
                "SELECT 1 WHERE EXISTS (\
                   SELECT 1 FROM project_database_bindings \
                   WHERE database_block_id = ?1 AND lifecycle = 'active'\
                 ) OR EXISTS (\
                   SELECT 1 FROM projects \
                   WHERE database_block_id = ?1 AND lifecycle = 'active'\
                 )",
                [&authority.id],
                |_| Ok(()),
            )
            .optional()?;
        if protected.is_some() {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "An active primary Database cannot be archived",
                false,
            ));
        }
    }
    if authority.resource_kind == "page" && restore {
        let parent = connection.query_row(
            "SELECT parent_kind, parent_id FROM pages WHERE block_id = ?1",
            [&authority.id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        if parent.0 == "page" {
            let active = connection
                .query_row(
                    "SELECT 1 FROM pages WHERE block_id = ?1 AND library_id = ?2 \
                     AND lifecycle = 'active'",
                    params![parent.1, library_id],
                    |_| Ok(()),
                )
                .optional()?;
            if active.is_none() {
                return Err(invalid(
                    "Restore the parent Page before restoring this Page",
                ));
            }
        }
    }
    let now = sqlite_now(connection)?;
    let changed = connection.execute(
        "UPDATE blocks SET lifecycle = ?1, metadata_revision = metadata_revision + 1, \
           updated_at = ?2 WHERE id = ?3 AND lifecycle = ?4 AND metadata_revision = ?5",
        params![
            to,
            now,
            authority.id,
            from,
            authority.block_metadata_revision
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Library resource changed during lifecycle transition",
            true,
        ));
    }
    if authority.resource_kind == "page" {
        let changed = connection.execute(
            "UPDATE pages SET lifecycle = ?1, metadata_revision = ?2, updated_at = ?3 \
             WHERE block_id = ?4 AND library_id = ?5",
            params![
                to,
                authority.block_metadata_revision + 1,
                now,
                authority.id,
                library_id
            ],
        )?;
        if changed != 1 {
            return Err(corrupt("Page lifecycle authority disappeared"));
        }
        connection.execute(
            "UPDATE page_read_model SET lifecycle = ?1, metadata_revision = ?2, updated_at = ?3 \
             WHERE page_block_id = ?4",
            params![to, authority.block_metadata_revision + 1, now, authority.id],
        )?;
    } else {
        let changed = connection.execute(
            "UPDATE database_containers SET lifecycle = ?1, \
               metadata_revision = metadata_revision + 1, updated_at = ?2 \
             WHERE block_id = ?3 AND lifecycle = ?4 AND metadata_revision = ?5",
            params![
                to,
                now,
                authority.id,
                from,
                authority.resource_metadata_revision
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Database changed during lifecycle transition",
                true,
            ));
        }
    }
    let parent_key = resource_parent_key(connection, &authority)?;
    let affected_document_ids = if authority.resource_kind == "page" {
        vec![connection.query_row(
            "SELECT document_id FROM pages WHERE block_id = ?1",
            [&authority.id],
            |row| row.get::<_, String>(0),
        )?]
    } else {
        Vec::new()
    };
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: authority.project_id,
            operation_kind,
            change_kind: "library.changed",
            did_mutate: true,
            created_target: None,
            affected_parent_keys: vec![parent_key],
            affected_block_ids: Vec::new(),
            affected_page_ids: (authority.resource_kind == "page")
                .then(|| authority.id.clone())
                .into_iter()
                .collect(),
            affected_database_ids: (authority.resource_kind == "database")
                .then(|| authority.id.clone())
                .into_iter()
                .collect(),
            affected_view_ids: Vec::new(),
            affected_document_ids,
            committed_revisions: BTreeMap::from_iter(
                [(
                    format!("blockMetadata:{}", authority.id),
                    authority.block_metadata_revision + 1,
                )]
                .into_iter()
                .chain((authority.resource_kind == "database").then(|| {
                    (
                        format!("databaseMetadata:{}", authority.id),
                        authority.resource_metadata_revision + 1,
                    )
                })),
            ),
            page_create: None,
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
            change_payload: None,
            committed_at: now,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn grant_project_access(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    project_id: &str,
    target: &LibraryResourceTarget,
    access: LibraryAccess,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_id("project_id", project_id)?;
    let project = connection
        .query_row(
            "SELECT lifecycle, database_block_id FROM projects \
             WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    let Some((project_lifecycle, primary_database_id)) = project else {
        return Err(StoreError::new(
            StoreErrorCode::NotFound,
            "Project is unavailable in this Library",
            false,
        ));
    };
    if project_lifecycle != "active" {
        return Err(StoreError::new(
            StoreErrorCode::Unauthorized,
            "Project must be active before it can receive access",
            false,
        ));
    }
    let authority = read_resource_authority(connection, library_id, target)?;
    let access = match access {
        LibraryAccess::Read => "read",
        LibraryAccess::ReadWrite => "read_write",
    };
    let primary_access = authority.resource_kind == "database"
        && primary_database_id.as_deref() == Some(authority.id.as_str());
    let existing = connection
        .query_row(
            "SELECT id, access, lifecycle, revision FROM project_resource_grants \
             WHERE project_id = ?1 AND root_kind = ?2 AND root_id = ?3",
            params![project_id, authority.resource_kind, authority.id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    let now = sqlite_now(connection)?;
    let (did_mutate, revision) = if primary_access {
        (false, None)
    } else if let Some((grant_id, current_access, lifecycle, revision)) = existing {
        if current_access == access && lifecycle == "active" {
            (false, Some(revision))
        } else {
            let changed = connection.execute(
                "UPDATE project_resource_grants SET access = ?1, lifecycle = 'active', \
                   revision = revision + 1, updated_at = ?2 WHERE id = ?3 AND revision = ?4",
                params![access, now, grant_id, revision],
            )?;
            if changed != 1 {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    "Project grant changed during update",
                    true,
                ));
            }
            (true, Some(revision + 1))
        }
    } else {
        let grant_id = format!(
            "grant:{}",
            sha256(
                serde_json::to_string(&[
                    project_id,
                    authority.resource_kind,
                    authority.id.as_str()
                ])
                .map_err(|_| internal("Project grant identity"))?
                .as_bytes()
            )
        );
        connection.execute(
            "INSERT INTO project_resource_grants(\
               id, project_id, library_id, root_kind, root_id, access, recursive, revision, \
               lifecycle, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, 'active', ?7, ?7)",
            params![
                grant_id,
                project_id,
                library_id,
                authority.resource_kind,
                authority.id,
                access,
                now
            ],
        )?;
        (true, Some(1))
    };
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id: project_id.to_owned(),
            operation_kind: "grant_project_access",
            change_kind: "library.changed",
            did_mutate,
            created_target: None,
            affected_parent_keys: Vec::new(),
            affected_block_ids: Vec::new(),
            affected_page_ids: (authority.resource_kind == "page")
                .then(|| authority.id.clone())
                .into_iter()
                .collect(),
            affected_database_ids: (authority.resource_kind == "database")
                .then(|| authority.id.clone())
                .into_iter()
                .collect(),
            affected_view_ids: Vec::new(),
            affected_document_ids: Vec::new(),
            committed_revisions: revision
                .map(|revision| (format!("projectGrant:{project_id}"), revision))
                .into_iter()
                .collect(),
            page_create: None,
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
            change_payload: None,
            committed_at: now,
        },
    )
}

fn read_resource_authority(
    connection: &Connection,
    library_id: &str,
    target: &LibraryResourceTarget,
) -> Result<ResourceAuthority, StoreError> {
    let (id, resource_kind) = match target {
        LibraryResourceTarget::Page { page_id } => (page_id, "page"),
        LibraryResourceTarget::Database { database_id } => (database_id, "database"),
    };
    let row = connection
        .query_row(
            "SELECT block.project_id, block.lifecycle, block.location_kind, \
               block.containing_document_id, block.location_revision, block.metadata_revision, \
               CASE WHEN block.type = 'page' THEN page.metadata_revision \
                    ELSE container.metadata_revision END \
             FROM blocks block \
             LEFT JOIN pages page ON page.block_id = block.id \
             LEFT JOIN database_containers container ON container.block_id = block.id \
             WHERE block.id = ?1 AND block.type = ?2 \
               AND COALESCE(page.library_id, container.library_id) = ?3",
            params![id, resource_kind, library_id],
            |row| {
                Ok(ResourceAuthority {
                    id: id.clone(),
                    project_id: row.get(0)?,
                    resource_kind,
                    lifecycle: row.get(1)?,
                    location_kind: row.get(2)?,
                    containing_document_id: row.get(3)?,
                    location_revision: row.get(4)?,
                    block_metadata_revision: row.get(5)?,
                    resource_metadata_revision: row.get(6)?,
                })
            },
        )
        .optional()?;
    row.ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::NotFound,
            "Library resource is unavailable",
            false,
        )
    })
}

fn resource_parent_key(
    connection: &Connection,
    authority: &ResourceAuthority,
) -> Result<String, StoreError> {
    if authority.location_kind == "space" {
        return Ok("library".to_owned());
    }
    if authority.location_kind != "document" {
        return Err(invalid("Library resource is not Library/Page placed"));
    }
    let document_id = authority
        .containing_document_id
        .as_deref()
        .ok_or_else(|| corrupt("Document-placed resource has no Document"))?;
    connection
        .query_row(
            "SELECT page.block_id FROM block_documents ownership \
             JOIN pages page ON page.block_id = ownership.block_id \
             WHERE ownership.document_id = ?1",
            [document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|page_id| format!("page:{page_id}"))
        .ok_or_else(|| corrupt("Containing Document has no Page owner"))
}

pub(super) fn resolve_write_parent(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    parent: &LibraryWriteParent,
) -> Result<ResolvedWriteParent, StoreError> {
    resolve_write_parent_with_access(connection, library_id, requesting_project_id, parent, true)
}

pub(super) fn resolve_write_parent_prevalidated(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    parent: &LibraryWriteParent,
) -> Result<ResolvedWriteParent, StoreError> {
    resolve_write_parent_with_access(connection, library_id, requesting_project_id, parent, false)
}

fn resolve_write_parent_with_access(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    parent: &LibraryWriteParent,
    require_access: bool,
) -> Result<ResolvedWriteParent, StoreError> {
    let LibraryWriteParent::Page {
        page_id,
        expected_document_generation,
        expected_document_head_seq,
        before,
    } = parent
    else {
        let LibraryWriteParent::Library { before } = parent else {
            unreachable!("closed LibraryWriteParent")
        };
        if let Some(anchor) = before {
            validate_library_anchor(connection, library_id, anchor)?;
        }
        require_project_in_library(connection, requesting_project_id, library_id)?;
        return Ok(ResolvedWriteParent {
            parent_key: "library".to_owned(),
            page_id: None,
            project_id: requesting_project_id.to_owned(),
            document: None,
            before_block_id: before.as_ref().map(|anchor| anchor.block_id.clone()),
        });
    };
    let parent_row = connection
        .query_row(
            "SELECT page.document_id, block.project_id, page.lifecycle \
             FROM pages page JOIN blocks block ON block.id = page.block_id \
             WHERE page.block_id = ?1 AND page.library_id = ?2",
            params![page_id, library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((document_id, project_id, lifecycle)) = parent_row else {
        return Err(StoreError::new(
            StoreErrorCode::NotFound,
            "Target Page is not in this Library",
            false,
        ));
    };
    if lifecycle != "active" {
        return Err(invalid("Target Page is unavailable"));
    }
    if require_access {
        super::history::require_page_write_access(
            connection,
            library_id,
            requesting_project_id,
            page_id,
        )?;
    }
    let authority = read_document_authority(connection, &document_id)?
        .ok_or_else(|| corrupt("Target Page has no Document authority"))?;
    if authority.owner_block_id != *page_id
        || authority.owner_type != "page"
        || !authority.head.is_live_yjs_authority()
    {
        return Err(corrupt("Target Page Document authority is invalid"));
    }
    if authority.head.generation != *expected_document_generation
        || authority.head.head_seq != *expected_document_head_seq
    {
        return Err(StoreError::new(
            StoreErrorCode::HeadConflict,
            "Target Page content changed",
            true,
        ));
    }
    let schema = BlockDocumentSchema::from_identity(
        &authority.head.schema_key,
        authority.head.schema_version,
    )
    .filter(|schema| schema.has_title())
    .ok_or_else(|| corrupt("Target Page has an unsupported Document schema"))?;
    let engine = reconstruct_yjs_engine(connection, &authority.head)?;
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|error| corrupt(&format!("Target Page schema is invalid: {error}")))?;
    let base_materialization = materialize_decoded_document(&decoded)
        .map_err(|error| corrupt(&format!("Target Page cannot materialize: {error}")))?;
    let before_block_id = if let Some(anchor) = before {
        let actual = connection
            .query_row(
                "SELECT block.location_revision FROM document_block_index indexed_block \
                 JOIN blocks block ON block.id = indexed_block.block_id \
                 WHERE indexed_block.document_id = ?1 AND indexed_block.block_id = ?2 \
                   AND indexed_block.parent_block_id IS NULL AND block.lifecycle = 'active'",
                params![document_id, anchor.block_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(actual) = actual else {
            return Err(invalid(
                "Placement anchor is unavailable in the target Page",
            ));
        };
        if actual != anchor.expected_location_revision {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Placement anchor changed",
                true,
            ));
        }
        Some(anchor.block_id.clone())
    } else {
        None
    };
    Ok(ResolvedWriteParent {
        parent_key: format!("page:{page_id}"),
        page_id: Some(page_id.clone()),
        project_id,
        document: Some(ResolvedParentDocument {
            authority,
            engine,
            base_materialization,
            schema,
        }),
        before_block_id,
    })
}

fn load_parent_document(
    connection: &Connection,
    document_id: &str,
) -> Result<ResolvedParentDocument, StoreError> {
    let authority = read_document_authority(connection, document_id)?
        .ok_or_else(|| corrupt("Source Page has no Document authority"))?;
    if authority.owner_type != "page" || !authority.head.is_live_yjs_authority() {
        return Err(corrupt("Source Page Document authority is invalid"));
    }
    let schema = BlockDocumentSchema::from_identity(
        &authority.head.schema_key,
        authority.head.schema_version,
    )
    .filter(|schema| schema.has_title())
    .ok_or_else(|| corrupt("Source Page has an unsupported Document schema"))?;
    let engine = reconstruct_yjs_engine(connection, &authority.head)?;
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|error| corrupt(&format!("Source Page schema is invalid: {error}")))?;
    let base_materialization = materialize_decoded_document(&decoded)
        .map_err(|error| corrupt(&format!("Source Page cannot materialize: {error}")))?;
    Ok(ResolvedParentDocument {
        authority,
        engine,
        base_materialization,
        schema,
    })
}

fn find_materialized_block(
    blocks: &[MaterializedBlockNode],
    block_id: &str,
) -> Option<MaterializedBlockNode> {
    blocks.iter().find_map(|block| {
        if block.id == block_id {
            return Some(block.clone());
        }
        find_materialized_block(&block.children, block_id)
    })
}

fn normalize_ids(ids: &mut Vec<String>) {
    ids.sort();
    ids.dedup();
}

pub(super) fn persist_parent_insert(
    connection: &Connection,
    store_epoch: &str,
    operation_id: &str,
    parent: &ResolvedParentDocument,
    block: MaterializedBlockNode,
    before_block_id: Option<String>,
) -> Result<LibraryBlockTransferDocumentCommit, StoreError> {
    persist_parent_operations_detailed(
        connection,
        store_epoch,
        operation_id,
        "insert",
        parent,
        &[DocumentBlockOperation::InsertBlock {
            block,
            parent_block_id: None,
            before_block_id,
        }],
    )
}

fn persist_parent_operations(
    connection: &Connection,
    store_epoch: &str,
    operation_id: &str,
    phase: &str,
    parent: &ResolvedParentDocument,
    operations: &[DocumentBlockOperation],
) -> Result<i64, StoreError> {
    persist_parent_operations_detailed(
        connection,
        store_epoch,
        operation_id,
        phase,
        parent,
        operations,
    )
    .map(|commit| commit.head_seq)
}

fn persist_parent_operations_detailed(
    connection: &Connection,
    store_epoch: &str,
    operation_id: &str,
    phase: &str,
    parent: &ResolvedParentDocument,
    operations: &[DocumentBlockOperation],
) -> Result<LibraryBlockTransferDocumentCommit, StoreError> {
    let full_state = parent.engine.full_state_v1();
    let prepared = prepare_document_operation_update(
        &parent.authority.head.id,
        parent.schema,
        &full_state,
        &parent.authority.head.state_vector,
        operations,
        false,
    )
    .map_err(|error| invalid(&format!("Parent Page update is invalid: {error}")))?;
    let candidate = parent
        .engine
        .prepare_update_v1(&prepared.update_v1)
        .map_err(|error| invalid(&format!("Parent Page update cannot apply: {error}")))?;
    let transaction = candidate.document().transact();
    let state_vector = transaction.state_vector().encode_v1();
    let next_full_state = transaction.encode_state_as_update_v1(&yrs::StateVector::default());
    drop(transaction);
    if state_vector != prepared.state_vector_v1 {
        return Err(corrupt("Prepared parent state vector is inconsistent"));
    }
    let update_id = format!(
        "library-document-{phase}:{}",
        sha256(operation_id.as_bytes())
    );
    let persisted = persist_yjs_commit(
        connection,
        PersistYjsCommit {
            authority: &parent.authority,
            base_materialization: &parent.base_materialization,
            materialization: &prepared.materialization,
            update_id: &update_id,
            client_session_id: "library-module",
            base_head_seq: parent.authority.head.head_seq,
            client_touched_block_ids: &[],
            update: &prepared.update_v1,
            state_vector: &state_vector,
            full_state: &next_full_state,
            store_epoch,
            operation_id: &update_id,
            event_kind: "document_updated",
            write_fence_block_ids: &prepared.write_fence_block_ids,
            title_write_fence_required: prepared.title_write_fence_required,
        },
    )?;
    Ok(LibraryBlockTransferDocumentCommit {
        document_id: parent.authority.head.id.clone(),
        generation: parent.authority.head.generation,
        base_head_seq: parent.authority.head.head_seq,
        head_seq: persisted.head_seq,
        update_id,
        update: prepared.update_v1,
        state_vector: persisted.state_vector,
    })
}

#[allow(clippy::too_many_arguments)]
fn create_database(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    database_id: &str,
    data_source_id: &str,
    view_id: &str,
    name: &str,
    parent: &LibraryWriteParent,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_uuid_v7("database_id", database_id)?;
    validate_uuid_v7("data_source_id", data_source_id)?;
    validate_uuid_v7("view_id", view_id)?;
    validate_id("operation_id", operation_id)?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 256 {
        return Err(invalid(
            "Database name must contain between 1 and 256 characters",
        ));
    }
    let resolved_parent =
        resolve_write_parent(connection, library_id, bound_project_id(context)?, parent)?;
    if connection
        .query_row(
            "SELECT 1 WHERE EXISTS (SELECT 1 FROM blocks WHERE id = ?1) \
             OR EXISTS (SELECT 1 FROM data_sources WHERE id = ?2) \
             OR EXISTS (SELECT 1 FROM database_views WHERE id = ?3)",
            params![database_id, data_source_id, view_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "New Database, Data Source, or View identity already exists",
            false,
        ));
    }
    let project_id = resolved_parent.project_id.clone();
    let now = sqlite_now(connection)?;
    connection.execute(
        "INSERT INTO blocks(\
           id, project_id, type, lifecycle, location_kind, containing_document_id, \
           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, 'database', 'active', ?3, ?4, NULL, 1, 1, ?5, ?5)",
        params![
            database_id,
            project_id,
            if resolved_parent.document.is_some() {
                "document"
            } else {
                "space"
            },
            resolved_parent
                .document
                .as_ref()
                .map(|parent| parent.authority.head.id.as_str()),
            now
        ],
    )?;
    if resolved_parent.document.is_none() {
        let top_level_rank = append_rank(connection, "top_level_block_placements", &project_id)?;
        connection.execute(
            "INSERT INTO top_level_block_placements(\
               block_id, project_id, rank_key, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![database_id, project_id, top_level_rank, now],
        )?;
        insert_library_placement(
            connection,
            library_id,
            database_id,
            match parent {
                LibraryWriteParent::Library { before } => before.as_ref(),
                LibraryWriteParent::Page { .. } => None,
            },
            &now,
        )?;
    }
    create_database_authority_records(
        connection,
        library_id,
        database_id,
        data_source_id,
        view_id,
        name,
        &now,
    )?;
    let parent_head_seq = resolved_parent
        .document
        .as_ref()
        .map(|parent| {
            persist_parent_insert(
                connection,
                store_epoch,
                operation_id,
                parent,
                embedded_resource_block(database_id, "database"),
                resolved_parent.before_block_id.clone(),
            )
        })
        .transpose()?;
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id,
            operation_kind: "create_database",
            change_kind: "library.changed",
            did_mutate: true,
            created_target: Some(LibraryResourceTarget::Database {
                database_id: database_id.to_owned(),
            }),
            affected_parent_keys: vec![resolved_parent.parent_key.clone()],
            affected_block_ids: Vec::new(),
            affected_page_ids: resolved_parent.page_id.clone().into_iter().collect(),
            affected_database_ids: vec![database_id.to_owned()],
            affected_view_ids: vec![view_id.to_owned()],
            affected_document_ids: resolved_parent
                .document
                .as_ref()
                .map(|parent| parent.authority.head.id.clone())
                .into_iter()
                .collect(),
            committed_revisions: BTreeMap::from_iter(
                [
                    (format!("blockLocation:{database_id}"), 1),
                    (format!("blockMetadata:{database_id}"), 1),
                    (format!("databaseMetadata:{database_id}"), 1),
                    (format!("dataSourceSchema:{data_source_id}"), 1),
                    (format!("view:{view_id}"), 1),
                ]
                .into_iter()
                .chain(parent_head_seq.zip(resolved_parent.document.as_ref()).map(
                    |(commit, parent)| {
                        (
                            format!("documentHead:{}", parent.authority.head.id),
                            commit.head_seq,
                        )
                    },
                )),
            ),
            page_create: None,
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
            change_payload: None,
            committed_at: now,
        },
    )
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
    genesis: PageGenesisInput<'_>,
    parent: &LibraryWriteParent,
) -> Result<LibraryApplyOutcome, StoreError> {
    validate_id("page_id", page_id)?;
    validate_id("document_id", document_id)?;
    validate_id("operation_id", operation_id)?;
    if genesis.title().len() > MAX_PAGE_TITLE_LENGTH {
        return Err(invalid("Page title exceeds its bound"));
    }
    let resolved_parent =
        resolve_write_parent(connection, library_id, bound_project_id(context)?, parent)?;
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
    let project_id = resolved_parent.project_id.clone();
    let now = sqlite_now(connection)?;
    let prepared = match genesis {
        PageGenesisInput::PlainTitle(title) => {
            let root_block_id = deterministic_block_id(operation_id);
            prepare_page_yjs_genesis(document_id, title, &root_block_id)?
        }
        PageGenesisInput::NestedMarkdown {
            title_markdown,
            nfm,
        } => {
            let rich_title = parse_inline_markdown_title(title_markdown)
                .map_err(|error| invalid(&error.to_string()))?;
            let mut ordinal = 0_u64;
            prepare_page_yjs_genesis_with_content(document_id, &rich_title, nfm, &mut || {
                let block_id =
                    stable_uuid_v7(operation_id, "page_body_block", &ordinal.to_string());
                ordinal += 1;
                block_id
            })?
        }
    };

    connection.execute(
        "INSERT INTO blocks (\
           id, project_id, type, lifecycle, location_kind, containing_document_id, \
           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, 'page', 'active', ?3, ?4, NULL, 1, 1, ?5, ?5)",
        params![
            page_id,
            project_id,
            if resolved_parent.document.is_some() {
                "document"
            } else {
                "space"
            },
            resolved_parent
                .document
                .as_ref()
                .map(|parent| parent.authority.head.id.as_str()),
            now
        ],
    )?;
    let top_level_rank = if resolved_parent.document.is_none() {
        let rank = append_rank(connection, "top_level_block_placements", &project_id)?;
        connection.execute(
            "INSERT INTO top_level_block_placements(\
               block_id, project_id, rank_key, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![page_id, project_id, rank, now],
        )?;
        Some(rank)
    } else {
        None
    };
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
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', 1, 1, ?6, ?6)",
        params![
            page_id,
            library_id,
            document_id,
            if resolved_parent.page_id.is_some() {
                "page"
            } else {
                "library"
            },
            resolved_parent.page_id.as_deref().unwrap_or(library_id),
            now
        ],
    )?;
    if resolved_parent.document.is_none() {
        insert_library_placement(
            connection,
            library_id,
            page_id,
            match parent {
                LibraryWriteParent::Library { before } => before.as_ref(),
                LibraryWriteParent::Page { .. } => None,
            },
            &now,
        )?;
    }
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
            emit_event: false,
        },
    )?;
    insert_page_read_model(
        connection,
        page_id,
        &project_id,
        document_id,
        if resolved_parent.document.is_some() {
            "document"
        } else {
            "space"
        },
        resolved_parent
            .document
            .as_ref()
            .map(|parent| parent.authority.head.id.as_str()),
        top_level_rank.as_deref(),
        &prepared.materialization,
        persisted.head_seq,
        &now,
    )?;
    ensure_default_page_intrinsic_properties(connection, page_id, &project_id, &now)?;
    refresh_page_intrinsic_projection(connection, page_id, &project_id, &now)?;

    let parent_head_seq = resolved_parent
        .document
        .as_ref()
        .map(|parent| {
            persist_parent_insert(
                connection,
                store_epoch,
                operation_id,
                parent,
                embedded_resource_block(page_id, "page"),
                resolved_parent.before_block_id.clone(),
            )
        })
        .transpose()?;
    let (title_etag, body_etag) = mint_document_semantic_etags(
        connection,
        &project_id,
        store_epoch,
        document_id,
        &prepared.materialization,
    )
    .map_err(|error| internal(&error.to_string()))?;
    let page_create = LibraryPageCreateResult {
        page_id: page_id.to_owned(),
        document_id: document_id.to_owned(),
        document_generation: 1,
        document_head_seq: persisted.head_seq,
        block_ids: materialized_block_ids(&prepared.materialization.block_tree),
        title_etag,
        body_etag,
    };

    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            project_id,
            operation_kind: "create_page",
            change_kind: "library.changed",
            did_mutate: true,
            created_target: Some(LibraryResourceTarget::Page {
                page_id: page_id.to_owned(),
            }),
            affected_parent_keys: vec![resolved_parent.parent_key.clone()],
            affected_block_ids: Vec::new(),
            affected_page_ids: std::iter::once(page_id.to_owned())
                .chain(resolved_parent.page_id.clone())
                .collect(),
            affected_database_ids: Vec::new(),
            affected_view_ids: Vec::new(),
            affected_document_ids: std::iter::once(document_id.to_owned())
                .chain(
                    resolved_parent
                        .document
                        .as_ref()
                        .map(|parent| parent.authority.head.id.clone()),
                )
                .collect(),
            committed_revisions: BTreeMap::from_iter(
                [
                    (format!("blockLocation:{page_id}"), 1),
                    (format!("blockMetadata:{page_id}"), 1),
                    (format!("documentHead:{document_id}"), persisted.head_seq),
                ]
                .into_iter()
                .chain(parent_head_seq.zip(resolved_parent.document.as_ref()).map(
                    |(commit, parent)| {
                        (
                            format!("documentHead:{}", parent.authority.head.id),
                            commit.head_seq,
                        )
                    },
                )),
            ),
            page_create: Some(page_create),
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: None,
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
            change_payload: None,
            committed_at: now,
        },
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn create_page_from_nfm(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    request_hash: &str,
    page_id: &str,
    document_id: &str,
    title_markdown: &str,
    nfm: &str,
    parent: &LibraryWriteParent,
) -> Result<LibraryApplyOutcome, StoreError> {
    create_page(
        connection,
        context,
        store_epoch,
        library_id,
        operation_id,
        request_hash,
        page_id,
        document_id,
        PageGenesisInput::NestedMarkdown {
            title_markdown,
            nfm,
        },
        parent,
    )
}

enum PageGenesisInput<'a> {
    PlainTitle(&'a str),
    NestedMarkdown {
        title_markdown: &'a str,
        nfm: &'a str,
    },
}

impl PageGenesisInput<'_> {
    fn title(&self) -> &str {
        match self {
            Self::PlainTitle(title) => title,
            Self::NestedMarkdown { title_markdown, .. } => title_markdown,
        }
    }
}

pub(super) fn finish_mutation(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    effects: MutationEffects,
) -> Result<LibraryApplyOutcome, StoreError> {
    let block_ids = effects
        .affected_block_ids
        .iter()
        .chain(effects.affected_page_ids.iter())
        .chain(&effects.affected_database_ids)
        .cloned()
        .collect::<Vec<_>>();
    let mut payload = effects.change_payload.clone().unwrap_or_else(|| {
        json!({
            "module": MODULE_NAME,
            "operationKind": effects.operation_kind,
            "didMutate": effects.did_mutate,
            "affectedParentKeys": effects.affected_parent_keys,
            "affectedPageIds": effects.affected_page_ids,
            "affectedDatabaseIds": effects.affected_database_ids,
            "affectedViewIds": effects.affected_view_ids,
        })
    });
    let payload_object = payload
        .as_object_mut()
        .ok_or_else(|| internal("Library event payload must be an object"))?;
    payload_object.insert("module".to_owned(), json!(MODULE_NAME));
    payload_object.insert(
        "affectedPageIds".to_owned(),
        json!(effects.affected_page_ids),
    );
    payload_object.insert(
        "affectedDatabaseIds".to_owned(),
        json!(effects.affected_database_ids),
    );
    payload_object.insert(
        "affectedViewIds".to_owned(),
        json!(effects.affected_view_ids),
    );
    payload_object.insert(
        "affectedParentKeys".to_owned(),
        json!(effects.affected_parent_keys),
    );
    let data_source_ids = effects
        .affected_parent_keys
        .iter()
        .filter_map(|key| key.strip_prefix("data_source:"))
        .map(str::to_owned)
        .collect();
    let projection_impact = if changes_project_visibility(effects.operation_kind) {
        ProjectionImpact::All
    } else {
        expand_database_coordinates(
            connection,
            ProjectionImpact::Resources {
                page_ids: effects.affected_page_ids.clone(),
                database_ids: effects.affected_database_ids.clone(),
                data_source_ids,
                view_ids: effects.affected_view_ids.clone(),
                document_heads: Vec::new(),
            },
        )?
    };
    let payload_json =
        serde_json::to_string(&payload).map_err(|_| internal("Library event payload"))?;
    let event_sequence = append_change_log(
        connection,
        NewChangeLogEntry {
            project_id: &effects.project_id,
            store_epoch,
            kind: effects.change_kind,
            operation_id: Some(operation_id),
            block_ids: &block_ids,
            document_ids: &effects.affected_document_ids,
            database_block_ids: &effects.affected_database_ids,
            payload_json: &payload_json,
            projection_impact: &projection_impact,
            committed_at: &effects.committed_at,
        },
    )?;
    let receipt = LibraryReceipt {
        mutation: ModuleMutationReceipt {
            operation_id: operation_id.to_owned(),
            duplicate: false,
        },
        operation_kind: effects.operation_kind.to_owned(),
        did_mutate: effects.did_mutate,
        created_target: effects.created_target,
        affected_parent_keys: effects.affected_parent_keys.clone(),
        affected_page_ids: effects.affected_page_ids.clone(),
        affected_database_ids: effects.affected_database_ids.clone(),
        affected_view_ids: effects.affected_view_ids.clone(),
        committed_revisions: effects.committed_revisions,
        change_log_seq: event_sequence,
        committed_at: effects.committed_at.clone(),
    };
    let committed = CommittedModuleValue {
        value: LibraryCommitValue {
            affected_resource_ids: block_ids,
            page_create: effects.page_create,
            page_copy: effects.page_copy,
            block_transfer: effects.block_transfer,
            page_lifecycle: effects.page_lifecycle,
            block_property_mutation: effects.block_property_mutation,
            agent_page_copy: effects.agent_page_copy,
            agent_create_pages: effects.agent_create_pages,
            agent_move_pages: effects.agent_move_pages,
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
            operation_kind: effects.operation_kind,
            store_epoch,
            request_hash,
            result: &result,
            event_sequence: Some(event_sequence),
            committed_at: &effects.committed_at,
        },
    )?;
    let event = load_committed_event_by_sequence(connection, event_sequence)?;
    Ok(LibraryApplyOutcome {
        committed,
        event: Some(event),
    })
}

fn changes_project_visibility(operation_kind: &str) -> bool {
    matches!(
        operation_kind,
        "move_block"
            | "transfer_blocks"
            | "agent_move_pages"
            | "grant_project_access"
            | "persist_agent_project_resource_grants"
    )
}

pub(super) fn assert_identity(
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

fn bound_project_id(context: &BoundModuleContext) -> Result<&str, StoreError> {
    context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| unauthorized("Library mutation requires a bound Project"))
}

pub(super) fn require_project_in_library(
    connection: &Connection,
    project_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![project_id, library_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        return Ok(());
    }
    Err(unauthorized("Bound Project is unavailable in this Library"))
}

pub(super) fn append_rank(
    connection: &Connection,
    table: &str,
    scope_id: &str,
) -> Result<String, StoreError> {
    let (select_sql, update_sql) = match table {
        "top_level_block_placements" => (
            "SELECT block_id, rank_key FROM top_level_block_placements \
                 WHERE project_id = ?1 ORDER BY rank_key, block_id",
            "UPDATE top_level_block_placements SET rank_key = ?1, updated_at = ?2 \
                 WHERE block_id = ?3 AND project_id = ?4 AND rank_key <> ?1",
        ),
        "library_block_placements" => (
            "SELECT block_id, rank_key FROM library_block_placements \
                 WHERE library_id = ?1 ORDER BY rank_key, block_id",
            "UPDATE library_block_placements SET rank_key = ?1, revision = revision + 1, \
                   updated_at = ?2 WHERE block_id = ?3 AND library_id = ?4 AND rank_key <> ?1",
        ),
        _ => return Err(internal("Unsupported placement table")),
    };
    let items = connection
        .prepare(select_sql)?
        .query_map([scope_id], |row| {
            Ok(RankedItem {
                id: row.get(0)?,
                rank_key: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut target_id = "__new_placement__".to_owned();
    while items.iter().any(|item| item.id == target_id) {
        target_id.push('_');
    }
    let plan = plan_fractional_rank(&items, &target_id, None).map_err(placement_rank_error)?;
    let now = sqlite_now(connection)?;
    for (block_id, rank_key) in plan.rebalanced_rank_keys {
        connection.execute(update_sql, params![rank_key, now, block_id, scope_id])?;
    }
    Ok(plan.rank_key)
}

pub(super) fn insert_library_placement(
    connection: &Connection,
    library_id: &str,
    block_id: &str,
    before: Option<&nodex_core_contracts::library::LibraryPlacementAnchor>,
    now: &str,
) -> Result<String, StoreError> {
    if let Some(anchor) = before {
        validate_library_anchor(connection, library_id, anchor)?;
    }
    let items = connection
        .prepare(
            "SELECT block_id, rank_key FROM library_block_placements WHERE library_id = ?1 \
             ORDER BY rank_key, block_id",
        )?
        .query_map([library_id], |row| {
            Ok(RankedItem {
                id: row.get(0)?,
                rank_key: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let plan = plan_fractional_rank(
        &items,
        block_id,
        before.map(|anchor| anchor.block_id.as_str()),
    )
    .map_err(placement_rank_error)?;
    for (sibling_id, rank_key) in &plan.rebalanced_rank_keys {
        connection.execute(
            "UPDATE library_block_placements SET rank_key = ?1, revision = revision + 1, \
               updated_at = ?2 WHERE block_id = ?3 AND library_id = ?4 AND rank_key <> ?1",
            params![rank_key, now, sibling_id, library_id],
        )?;
    }
    connection.execute(
        "INSERT INTO library_block_placements(\
           block_id, library_id, rank_key, revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        params![block_id, library_id, plan.rank_key, now],
    )?;
    Ok(plan.rank_key)
}

fn placement_rank_error(error: crate::domain::fractional_rank::FractionalRankError) -> StoreError {
    match error.code {
        FractionalRankErrorCode::AnchorNotFound => invalid("Placement anchor disappeared"),
        FractionalRankErrorCode::RebalanceLimit => {
            StoreError::new(StoreErrorCode::ResourceExhausted, error.message, false)
        }
    }
}

fn validate_library_anchor(
    connection: &Connection,
    library_id: &str,
    anchor: &nodex_core_contracts::library::LibraryPlacementAnchor,
) -> Result<(), StoreError> {
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
    if actual == anchor.expected_location_revision {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::RevisionConflict,
        "Placement anchor changed",
        true,
    ))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn insert_page_read_model(
    connection: &Connection,
    page_id: &str,
    project_id: &str,
    document_id: &str,
    location_kind: &str,
    containing_document_id: Option<&str>,
    top_level_rank: Option<&str>,
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
         ) VALUES (?1, ?2, 'active', ?3, ?4, NULL, ?5, 1, 1, ?6, 1, ?7, ?8, \
           'ydoc_primary', NULL, NULL, NULL, NULL, NULL, ?9, ?10, ?11, ?12, '{}', '{}', '{}', \
           1, ?13, ?13)",
        params![
            page_id,
            project_id,
            location_kind,
            containing_document_id,
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

pub(super) fn ensure_default_page_intrinsic_properties(
    connection: &Connection,
    page_id: &str,
    project_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    const DEFAULTS: &[(&str, &str, &str)] = &[
        ("run.target", "string", "\"localProject\""),
        ("run.localPath", "string", "null"),
        ("run.baseBranch", "string", "null"),
        ("run.worktreePath", "string", "null"),
        ("run.environmentPath", "string", "null"),
        ("schedule.isAllDay", "boolean", "false"),
        ("schedule.timezone", "string", "null"),
        ("recurrence.config", "json", "null"),
        ("reminders.config", "json", "[]"),
    ];
    for (key, value_type, value_json) in DEFAULTS {
        connection.execute(
            "INSERT OR IGNORE INTO block_properties( \
               block_id, project_id, property_key, value_type, value_json, revision, updated_at \
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![page_id, project_id, key, value_type, value_json, now],
        )?;
    }
    Ok(())
}

pub(super) fn refresh_page_intrinsic_projection(
    connection: &Connection,
    page_id: &str,
    project_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    let rows = connection
        .prepare(
            "SELECT property_key, value_json, revision FROM block_properties \
             WHERE block_id = ?1 AND project_id = ?2 ORDER BY property_key",
        )?
        .query_map(params![page_id, project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut values = serde_json::Map::new();
    let mut intrinsic_revisions = serde_json::Map::new();
    for (key, value_json, revision) in rows {
        let value = serde_json::from_str(&value_json)
            .map_err(|_| corrupt("Page intrinsic Property JSON is invalid"))?;
        values.insert(key.clone(), value);
        intrinsic_revisions.insert(key, serde_json::Value::from(revision));
    }
    let revisions_json = connection
        .query_row(
            "SELECT property_revisions_json FROM page_read_model WHERE page_block_id = ?1",
            [page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Page intrinsic projection has no Page read model"))?;
    let mut revisions = serde_json::from_str::<serde_json::Value>(&revisions_json)
        .map_err(|_| corrupt("Page Property revision projection is invalid"))?;
    let revisions = revisions
        .as_object_mut()
        .ok_or_else(|| corrupt("Page Property revision projection is not an object"))?;
    revisions.insert(
        "intrinsic".to_owned(),
        serde_json::Value::Object(intrinsic_revisions),
    );
    revisions
        .entry("database".to_owned())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let changed = connection.execute(
        "UPDATE page_read_model SET intrinsic_properties_json = ?1, \
           property_revisions_json = ?2, updated_at = ?3 WHERE page_block_id = ?4",
        params![
            serde_json::to_string(&values).map_err(|_| internal("Page intrinsic values"))?,
            serde_json::to_string(&revisions).map_err(|_| internal("Page intrinsic revisions"))?,
            now,
            page_id,
        ],
    )?;
    if changed == 1 {
        return Ok(());
    }
    Err(corrupt("Page intrinsic projection has no Page read model"))
}

fn validate_id(name: &str, value: &str) -> Result<(), StoreError> {
    if !value.trim().is_empty() && value.len() <= MAX_ID_LENGTH {
        return Ok(());
    }
    Err(invalid(&format!(
        "{name} must contain 1 to {MAX_ID_LENGTH} bytes"
    )))
}

fn validate_uuid_v7(name: &str, value: &str) -> Result<(), StoreError> {
    validate_id(name, value)?;
    let bytes = value.as_bytes();
    let valid = bytes.len() == 36
        && bytes.get(8) == Some(&b'-')
        && bytes.get(13) == Some(&b'-')
        && bytes.get(14) == Some(&b'7')
        && bytes.get(18) == Some(&b'-')
        && bytes.get(23) == Some(&b'-')
        && bytes
            .get(19)
            .is_some_and(|byte| matches!(byte.to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b'))
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit());
    if valid {
        return Ok(());
    }
    Err(invalid(&format!("{name} must be a UUIDv7")))
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

fn materialized_block_ids(blocks: &[MaterializedBlockNode]) -> Vec<String> {
    blocks
        .iter()
        .flat_map(|block| {
            std::iter::once(block.id.clone()).chain(materialized_block_ids(&block.children))
        })
        .collect()
}

fn embedded_resource_block(block_id: &str, block_type: &str) -> MaterializedBlockNode {
    MaterializedBlockNode {
        id: block_id.to_owned(),
        block_type: block_type.to_owned(),
        props: BTreeMap::new(),
        content: None,
        children: Vec::new(),
    }
}

pub(super) fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn unauthorized(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    use nodex_core_contracts::document::{DocumentSemanticCommand, OwnedDocumentIntent};
    use nodex_core_contracts::library::{
        LibraryAgentSiblingAnchor, LibraryNavigationParent, LibraryPageFileKind,
        LibraryPagePrepareKind, LibraryPageWriteDestination, LibraryRead, LibraryReadValue,
        LibrarySearchSnapshotScope,
    };
    use nodex_core_contracts::{
        AdapterKind, LibraryId, ModuleReadRequest, OWNED_DOCUMENT_CONTRACT_VERSION, ProfileId,
        ProjectId,
    };
    use tempfile::tempdir;

    use crate::document::OwnedDocumentModule;
    use crate::infrastructure::store::SqliteStoreKernel;
    use crate::library::LibraryModule;

    use super::*;

    const NOW: &str = "2026-07-18T23:59:00.000Z";

    #[test]
    fn project_visibility_changes_require_broad_projection_invalidation() {
        for operation in [
            "move_block",
            "transfer_blocks",
            "agent_move_pages",
            "grant_project_access",
            "persist_agent_project_resource_grants",
        ] {
            assert!(changes_project_visibility(operation), "{operation}");
        }
        assert!(!changes_project_visibility("create_page"));
        assert!(!changes_project_visibility("mutate_block_properties"));
    }

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
            contract_version: LIBRARY_CONTRACT_VERSION,
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

    fn create_database_request(operation_id: &str) -> ModuleApplyRequest<LibraryIntent> {
        ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::CreateDatabase {
                database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                data_source_id: "018f0000-0000-7000-8000-000000000002".to_owned(),
                view_id: "018f0000-0000-7000-8000-000000000003".to_owned(),
                name: "Product work".to_owned(),
                parent: LibraryWriteParent::Library { before: None },
            },
        }
    }

    fn seeded_library() -> (tempfile::TempDir, SqliteStoreKernel, LibraryModule) {
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
        (directory, kernel, module)
    }

    #[test]
    fn creates_page_genesis_and_all_projections_once() {
        let (_directory, kernel, module) = seeded_library();

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
                    contract_version: LIBRARY_CONTRACT_VERSION,
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
                         WHERE operation_id = 'operation:create-page' AND kind = 'library.changed'), \
                       (SELECT count(*) FROM change_log \
                         WHERE kind = 'owned_document.document_initialized' \
                           AND document_ids_json = json_array(document.id)) \
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
                            row.get::<_, i64>(8)?,
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
                        0,
                    )
                );
                let intrinsic = connection.query_row(
                    "SELECT count(*), \
                       max(CASE WHEN property_key = 'run.target' THEN value_json END), \
                       json_extract(projection.intrinsic_properties_json, '$.\"run.target\"') \
                     FROM block_properties property \
                     JOIN page_read_model projection ON projection.page_block_id = property.block_id \
                     WHERE property.block_id = 'page:created'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                assert_eq!(
                    intrinsic,
                    (
                        9,
                        "\"localProject\"".to_owned(),
                        "localProject".to_owned(),
                    )
                );
                Ok(())
            })
            .expect("durable Page evidence");

        let database = module
            .apply(
                &context(),
                create_database_request("operation:create-database"),
            )
            .expect("create Database");
        let database_replay = module
            .apply(
                &context(),
                create_database_request("operation:create-database"),
            )
            .expect("retry Database");
        assert!(database.event.is_some());
        assert!(database_replay.event.is_none());
        assert!(database_replay.committed.receipt.mutation.duplicate);

        let views = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::Children {
                        parent: LibraryNavigationParent::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        cursor: None,
                        limit: None,
                        force_include_target: None,
                    },
                },
            )
            .expect("read Database Views");
        let LibraryReadValue::Children { items, total, .. } = views.value else {
            panic!("View children snapshot");
        };
        assert_eq!(total, 1);
        assert!(matches!(
            &items[0],
            nodex_core_contracts::library::LibraryNavigationNode::View {
                title,
                view_kind,
                is_default: true,
                ..
            } if title == "Kanban" && view_kind == "kanban"
        ));
        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT container.name, container.default_view_id, source.schema_revision, \
                       view.revision, json_extract(view.config_json, '$.schemaVersion'), \
                       (SELECT count(*) FROM data_source_properties property \
                         WHERE property.data_source_id = source.id AND property.lifecycle = 'active'), \
                       (SELECT count(*) FROM core_module_receipts \
                         WHERE module_name = 'library' \
                           AND operation_id = 'operation:create-database'), \
                       (SELECT count(*) FROM change_log \
                         WHERE operation_id = 'operation:create-database' \
                           AND kind = 'library.changed') \
                     FROM database_containers container \
                     JOIN data_sources source ON source.home_database_block_id = container.block_id \
                     JOIN database_views view ON view.database_block_id = container.block_id \
                     WHERE container.block_id = '018f0000-0000-7000-8000-000000000001'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, i64>(7)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        "Product work".to_owned(),
                        "018f0000-0000-7000-8000-000000000003".to_owned(),
                        1,
                        1,
                        2,
                        8,
                        1,
                        1,
                    )
                );
                Ok(())
            })
            .expect("durable Database evidence");

        let nested_page = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:create-nested-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:nested".to_owned(),
                        document_id: "document:nested".to_owned(),
                        title: "Nested Page".to_owned(),
                        parent: LibraryWriteParent::Page {
                            page_id: "page:created".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 1,
                            before: None,
                        },
                    },
                },
            )
            .expect("create nested Page");
        assert_eq!(
            nested_page.committed.receipt.committed_revisions["documentHead:document:created"],
            2
        );
        let nested_database = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:create-nested-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: "018f0000-0000-7000-8000-000000000011".to_owned(),
                        data_source_id: "018f0000-0000-7000-8000-000000000012".to_owned(),
                        view_id: "018f0000-0000-7000-8000-000000000013".to_owned(),
                        name: "Nested work".to_owned(),
                        parent: LibraryWriteParent::Page {
                            page_id: "page:created".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 2,
                            before: None,
                        },
                    },
                },
            )
            .expect("create nested Database");
        assert_eq!(
            nested_database.committed.receipt.committed_revisions["documentHead:document:created"],
            3
        );
        let nested_children = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::Children {
                        parent: LibraryNavigationParent::Page {
                            page_id: "page:created".to_owned(),
                        },
                        cursor: None,
                        limit: None,
                        force_include_target: None,
                    },
                },
            )
            .expect("read nested resources");
        let LibraryReadValue::Children { items, total, .. } = nested_children.value else {
            panic!("nested children snapshot");
        };
        assert_eq!(total, 2);
        assert!(matches!(
            &items[0],
            nodex_core_contracts::library::LibraryNavigationNode::Page { page_id, .. }
                if page_id == "page:nested"
        ));
        assert!(matches!(
            &items[1],
            nodex_core_contracts::library::LibraryNavigationNode::Database { database_id, .. }
                if database_id == "018f0000-0000-7000-8000-000000000011"
        ));
        let stale = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:stale-nested-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:must-rollback".to_owned(),
                        document_id: "document:must-rollback".to_owned(),
                        title: "Must roll back".to_owned(),
                        parent: LibraryWriteParent::Page {
                            page_id: "page:created".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 2,
                            before: None,
                        },
                    },
                },
            )
            .expect_err("stale nested create");
        assert_eq!(
            stale.code,
            nodex_core_contracts::CoreErrorCode::RevisionConflict
        );
        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT parent.head_seq, parent_projection.document_projected_seq, \
                       nested_block.location_kind, nested_block.containing_document_id, \
                       nested_page.parent_kind, nested_page.parent_id, \
                       nested_projection.location_kind, nested_projection.containing_document_id, \
                       database_block.location_kind, database_block.containing_document_id, \
                       (SELECT count(*) FROM document_block_index \
                         WHERE document_id = parent.id AND parent_block_id IS NULL \
                           AND block_id IN ('page:nested', \
                             '018f0000-0000-7000-8000-000000000011')), \
                       (SELECT count(*) FROM blocks WHERE id = 'page:must-rollback') \
                     FROM documents parent \
                     JOIN page_read_model parent_projection \
                       ON parent_projection.document_id = parent.id \
                     JOIN blocks nested_block ON nested_block.id = 'page:nested' \
                     JOIN pages nested_page ON nested_page.block_id = nested_block.id \
                     JOIN page_read_model nested_projection \
                       ON nested_projection.page_block_id = nested_block.id \
                     JOIN blocks database_block \
                       ON database_block.id = '018f0000-0000-7000-8000-000000000011' \
                     WHERE parent.id = 'document:created'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, String>(9)?,
                            row.get::<_, i64>(10)?,
                            row.get::<_, i64>(11)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        3,
                        3,
                        "document".to_owned(),
                        "document:created".to_owned(),
                        "page".to_owned(),
                        "page:created".to_owned(),
                        "document".to_owned(),
                        "document:created".to_owned(),
                        "document".to_owned(),
                        "document:created".to_owned(),
                        2,
                        0,
                    )
                );
                Ok(())
            })
            .expect("nested ownership evidence");

        let archive_page = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:archive-nested-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ArchiveResource {
                        target: LibraryResourceTarget::Page {
                            page_id: "page:nested".to_owned(),
                        },
                        expected_metadata_revision: 1,
                    },
                },
            )
            .expect("archive nested Page");
        assert_eq!(
            archive_page.committed.receipt.committed_revisions["blockMetadata:page:nested"],
            2
        );
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:edit-parent-after-archive".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreateDatabase {
                        database_id: "018f0000-0000-7000-8000-000000000021".to_owned(),
                        data_source_id: "018f0000-0000-7000-8000-000000000022".to_owned(),
                        view_id: "018f0000-0000-7000-8000-000000000023".to_owned(),
                        name: "Archive fence".to_owned(),
                        parent: LibraryWriteParent::Page {
                            page_id: "page:created".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 3,
                            before: None,
                        },
                    },
                },
            )
            .expect("edit parent after child archive");
        let archived_lifecycle = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT lifecycle FROM blocks WHERE id = 'page:nested'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .map_err(StoreError::from)
            })
            .expect("archived lifecycle");
        assert_eq!(archived_lifecycle, "archived");
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:restore-nested-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::RestoreResource {
                        target: LibraryResourceTarget::Page {
                            page_id: "page:nested".to_owned(),
                        },
                        expected_metadata_revision: 2,
                    },
                },
            )
            .expect("restore nested Page");

        for (operation_id, intent) in [
            (
                "operation:archive-database",
                LibraryIntent::ArchiveResource {
                    target: LibraryResourceTarget::Database {
                        database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                    },
                    expected_metadata_revision: 1,
                },
            ),
            (
                "operation:restore-database",
                LibraryIntent::RestoreResource {
                    target: LibraryResourceTarget::Database {
                        database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                    },
                    expected_metadata_revision: 2,
                },
            ),
        ] {
            module
                .apply(
                    &context(),
                    ModuleApplyRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        operation_id: operation_id.to_owned(),
                        store_epoch: StoreEpoch("epoch-1".to_owned()),
                        intent,
                    },
                )
                .expect("Database lifecycle transition");
        }
        let first_grant = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:grant-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: "page:nested".to_owned(),
                        },
                        access: LibraryAccess::Read,
                    },
                },
            )
            .expect("grant Page access");
        let already_granted = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:grant-page-again".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Page {
                            page_id: "page:nested".to_owned(),
                        },
                        access: LibraryAccess::Read,
                    },
                },
            )
            .expect("recognize existing grant");
        assert!(first_grant.committed.receipt.did_mutate);
        assert!(!already_granted.committed.receipt.did_mutate);
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "UPDATE projects SET database_block_id = ?1 WHERE id = 'project-1'",
                        ["018f0000-0000-7000-8000-000000000001"],
                    )?;
                    Ok(())
                })
            })
            .expect("bind primary Database");
        let primary_grant = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:grant-primary".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        access: LibraryAccess::ReadWrite,
                    },
                },
            )
            .expect("primary Database already authorizes Project");
        assert!(!primary_grant.committed.receipt.did_mutate);
        let protected_archive = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:archive-primary".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::ArchiveResource {
                        target: LibraryResourceTarget::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        expected_metadata_revision: 3,
                    },
                },
            )
            .expect_err("primary Database cannot archive");
        assert_eq!(
            protected_archive.code,
            nodex_core_contracts::CoreErrorCode::RevisionConflict
        );

        let move_to_library = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:move-page-to-library".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MoveBlock {
                        target: LibraryResourceTarget::Page {
                            page_id: "page:nested".to_owned(),
                        },
                        expected_location_revision: 1,
                        parent: LibraryWriteParent::Library {
                            before: Some(nodex_core_contracts::library::LibraryPlacementAnchor {
                                block_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                                expected_location_revision: 1,
                            }),
                        },
                    },
                },
            )
            .expect("move nested Page to Library");
        assert_eq!(
            move_to_library.committed.receipt.committed_revisions["documentHead:document:created"],
            5
        );
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:move-page-back".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MoveBlock {
                        target: LibraryResourceTarget::Page {
                            page_id: "page:nested".to_owned(),
                        },
                        expected_location_revision: 2,
                        parent: LibraryWriteParent::Page {
                            page_id: "page:created".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 5,
                            before: None,
                        },
                    },
                },
            )
            .expect("move Page back into parent");
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:reorder-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MoveBlock {
                        target: LibraryResourceTarget::Page {
                            page_id: "page:nested".to_owned(),
                        },
                        expected_location_revision: 3,
                        parent: LibraryWriteParent::Page {
                            page_id: "page:created".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 6,
                            before: Some(nodex_core_contracts::library::LibraryPlacementAnchor {
                                block_id: "018f0000-0000-7000-8000-000000000011".to_owned(),
                                expected_location_revision: 1,
                            }),
                        },
                    },
                },
            )
            .expect("reorder Page within parent");
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:create-other-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePage {
                        page_id: "page:other".to_owned(),
                        document_id: "document:other".to_owned(),
                        title: "Other parent".to_owned(),
                        parent: LibraryWriteParent::Library { before: None },
                    },
                },
            )
            .expect("create other parent Page");
        let cross_document = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:move-database-across-pages".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MoveBlock {
                        target: LibraryResourceTarget::Database {
                            database_id: "018f0000-0000-7000-8000-000000000011".to_owned(),
                        },
                        expected_location_revision: 1,
                        parent: LibraryWriteParent::Page {
                            page_id: "page:other".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 1,
                            before: None,
                        },
                    },
                },
            )
            .expect("move Database across Page Documents");
        assert_eq!(
            cross_document.committed.receipt.committed_revisions["documentHead:document:created"],
            8
        );
        assert_eq!(
            cross_document.committed.receipt.committed_revisions["documentHead:document:other"],
            2
        );
        let hierarchy_cycle = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "operation:reject-page-cycle".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MoveBlock {
                        target: LibraryResourceTarget::Page {
                            page_id: "page:created".to_owned(),
                        },
                        expected_location_revision: 1,
                        parent: LibraryWriteParent::Page {
                            page_id: "page:nested".to_owned(),
                            expected_document_generation: 1,
                            expected_document_head_seq: 1,
                            before: None,
                        },
                    },
                },
            )
            .expect_err("reject Page hierarchy cycle");
        assert_eq!(
            hierarchy_cycle.code,
            nodex_core_contracts::CoreErrorCode::InvalidInput
        );
        kernel
            .readers()
            .read_default(|connection| {
                let evidence = connection.query_row(
                    "SELECT moved_page.location_revision, moved_page.containing_document_id, \
                       page.parent_kind, page.parent_id, projection.location_revision, \
                       projection.containing_document_id, moved_database.location_revision, \
                       moved_database.containing_document_id, \
                       (SELECT ordinal FROM document_block_index \
                         WHERE document_id = 'document:created' AND block_id = 'page:nested'), \
                       (SELECT count(*) FROM document_block_index \
                         WHERE document_id = 'document:created' \
                           AND block_id = '018f0000-0000-7000-8000-000000000011'), \
                       (SELECT count(*) FROM document_block_index \
                         WHERE document_id = 'document:other' \
                           AND block_id = '018f0000-0000-7000-8000-000000000011') \
                     FROM blocks moved_page \
                     JOIN pages page ON page.block_id = moved_page.id \
                     JOIN page_read_model projection ON projection.page_block_id = moved_page.id \
                     JOIN blocks moved_database \
                       ON moved_database.id = '018f0000-0000-7000-8000-000000000011' \
                     WHERE moved_page.id = 'page:nested'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, String>(7)?,
                            row.get::<_, i64>(8)?,
                            row.get::<_, i64>(9)?,
                            row.get::<_, i64>(10)?,
                        ))
                    },
                )?;
                assert_eq!(
                    evidence,
                    (
                        4,
                        "document:created".to_owned(),
                        "page".to_owned(),
                        "page:created".to_owned(),
                        4,
                        "document:created".to_owned(),
                        2,
                        "document:other".to_owned(),
                        1,
                        0,
                        1,
                    )
                );
                Ok(())
            })
            .expect("move ownership evidence");
    }

    #[test]
    fn semantic_page_creation_owns_identity_content_etags_and_replay() {
        let (_directory, _kernel, module) = seeded_library();
        let request = |body: &str| ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "native-cli:create-page".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::CreatePageFromNfm {
                title_markdown: "Native **Page**".to_owned(),
                nfm: body.to_owned(),
                destination: LibraryPageWriteDestination::Library { at: None },
            },
        };
        let first = module
            .apply(&context(), request("## Runtime\n\nCore starts on demand."))
            .expect("semantic Page create");
        let created = first
            .committed
            .value
            .page_create
            .clone()
            .expect("exact Page creation result");
        assert_eq!(created.document_generation, 1);
        assert_eq!(created.document_head_seq, 1);
        assert_eq!(&created.page_id[14..15], "7");
        assert_eq!(&created.document_id[14..15], "7");
        assert_eq!(created.block_ids.len(), 2);
        assert!(created.title_etag.starts_with("nxe1."));
        assert!(created.body_etag.starts_with("nxe1."));

        let mut retry_context = context();
        retry_context.connection_id = "connection:native-cli-create-retry".to_owned();
        let replay = module
            .apply(
                &retry_context,
                request("## Runtime\n\nCore starts on demand."),
            )
            .expect("exact semantic Page replay");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(replay.committed.value.page_create, Some(created.clone()));
        let collision = module
            .apply(&context(), request("Changed body"))
            .expect_err("same key cannot change semantic Page content");
        assert_eq!(
            collision.code,
            nodex_core_contracts::CoreErrorCode::IdempotencyKeyReused
        );

        let body = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: created.page_id.clone(),
                        file_kind: LibraryPageFileKind::BodyNestedMarkdown,
                        prepare: None,
                    },
                },
            )
            .expect("read created Page body");
        let LibraryReadValue::PageFile { value: body } = body.value else {
            panic!("Page body projection")
        };
        assert_eq!(body.content, "## Runtime\nCore starts on demand.\n");
        let metadata = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: created.page_id.clone(),
                        file_kind: LibraryPageFileKind::MetaYaml,
                        prepare: None,
                    },
                },
            )
            .expect("read created Page metadata");
        let LibraryReadValue::PageFile { value: metadata } = metadata.value else {
            panic!("Page metadata projection")
        };
        assert_eq!(
            metadata.metadata.expect("typed metadata").title_markdown,
            "Native **Page**"
        );
        let draft = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageDraftProjection {
                        page_id: created.page_id.clone(),
                    },
                },
            )
            .expect("read atomic Page draft projection");
        let LibraryReadValue::PageDraftProjection { value: draft } = draft.value else {
            panic!("Page draft projection")
        };
        assert_eq!(draft.page_id, created.page_id);
        assert_eq!(draft.document_id, created.document_id);
        assert_eq!(draft.document_head_seq, created.document_head_seq);
        assert_eq!(draft.body_nested_markdown, body.content);
        assert!(draft.meta_yaml.contains("title: \"Native **Page**\""));
        assert_eq!(draft.title_etag, created.title_etag);
        assert_eq!(draft.body_etag, created.body_etag);
    }

    #[test]
    fn semantic_page_creation_places_a_complete_page_in_a_data_source_atomically() {
        let (_directory, kernel, module) = seeded_library();
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO projects(id, library_id, name, created, updated) \
                         VALUES ('project-storage', 'library-1', 'Database storage', ?1, ?1)",
                        [NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("seed destination storage Project");
        let mut storage_context = context();
        storage_context.project_id = Some(ProjectId("project-storage".to_owned()));
        storage_context.connection_id = "connection:database-storage".to_owned();
        module
            .apply(
                &storage_context,
                create_database_request("native-cli:create-database-for-page"),
            )
            .expect("create Data Source destination");
        module
            .apply(
                &storage_context,
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "native-cli:grant-database-for-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        access: LibraryAccess::ReadWrite,
                    },
                },
            )
            .expect("grant Data Source destination");
        let request = |body: &str| ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "native-cli:create-data-source-page".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::CreatePageFromNfm {
                title_markdown: "Database **Page**".to_owned(),
                nfm: body.to_owned(),
                destination: LibraryPageWriteDestination::DataSource {
                    data_source_id: "018f0000-0000-7000-8000-000000000002".to_owned(),
                    at: None,
                },
            },
        };
        let first = module
            .apply(&context(), request("## Work\n\nNative placement."))
            .expect("create Page in Data Source");
        let created = first
            .committed
            .value
            .page_create
            .clone()
            .expect("exact Page creation result");
        assert_eq!(created.document_generation, 1);
        assert_eq!(created.document_head_seq, 1);
        assert_eq!(created.block_ids.len(), 2);
        assert_eq!(
            first.committed.receipt.affected_database_ids,
            vec!["018f0000-0000-7000-8000-000000000001"]
        );
        assert_eq!(
            first.committed.receipt.affected_view_ids,
            vec!["018f0000-0000-7000-8000-000000000003"]
        );
        assert_eq!(
            first.committed.receipt.committed_revisions
                [&format!("blockLocation:{}", created.page_id)],
            2
        );
        assert_eq!(
            first.committed.receipt.committed_revisions[&format!("pageParent:{}", created.page_id)],
            2
        );

        let evidence = kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT block.project_id, block.location_kind, \
                           block.containing_database_id, page.parent_kind, page.parent_id, \
                           membership.revision, projection.location_kind, \
                           projection.containing_database_id, projection.view_group_key, \
                           EXISTS(SELECT 1 FROM top_level_block_placements top \
                             WHERE top.block_id = block.id), \
                           EXISTS(SELECT 1 FROM library_block_placements library \
                             WHERE library.block_id = block.id), document.project_id \
                         FROM blocks block JOIN pages page ON page.block_id = block.id \
                         JOIN documents document ON document.id = page.document_id \
                         JOIN data_source_page_memberships membership \
                           ON membership.page_block_id = block.id AND membership.removed_at IS NULL \
                         JOIN page_read_model projection ON projection.page_block_id = block.id \
                         WHERE block.id = ?1",
                        [&created.page_id],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, String>(4)?,
                                row.get::<_, i64>(5)?,
                                row.get::<_, String>(6)?,
                                row.get::<_, String>(7)?,
                                row.get::<_, Option<String>>(8)?,
                                row.get::<_, i64>(9)?,
                                row.get::<_, i64>(10)?,
                                row.get::<_, String>(11)?,
                            ))
                        },
                    )
                    .map_err(StoreError::from)
            })
            .expect("atomic Data Source placement evidence");
        assert_eq!(
            evidence,
            (
                "project-storage".to_owned(),
                "database".to_owned(),
                "018f0000-0000-7000-8000-000000000001".to_owned(),
                "data_source".to_owned(),
                "018f0000-0000-7000-8000-000000000002".to_owned(),
                1,
                "database".to_owned(),
                "018f0000-0000-7000-8000-000000000001".to_owned(),
                Some("triage".to_owned()),
                0,
                0,
                "project-storage".to_owned(),
            )
        );

        let mut retry_context = context();
        retry_context.connection_id = "connection:native-cli-data-source-retry".to_owned();
        let replay = module
            .apply(&retry_context, request("## Work\n\nNative placement."))
            .expect("exact Data Source Page replay");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert!(replay.event.is_none());
        assert_eq!(replay.committed.value.page_create, Some(created));
        let collision = module
            .apply(&context(), request("Changed body"))
            .expect_err("same key cannot change Data Source Page content");
        assert_eq!(
            collision.code,
            nodex_core_contracts::CoreErrorCode::IdempotencyKeyReused
        );
    }

    #[test]
    fn search_snapshot_leases_are_immutable_scoped_and_idempotently_released() {
        let (directory, kernel, module) = seeded_library();
        let created = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "native-cli:create-search-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::CreatePageFromNfm {
                        title_markdown: "Search **Page**".to_owned(),
                        nfm: "## Runtime\n\nCore starts on demand.".to_owned(),
                        destination: LibraryPageWriteDestination::Library { at: None },
                    },
                },
            )
            .expect("create searchable Page")
            .committed
            .value
            .page_create
            .expect("created Page result");
        let acquired = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AcquireSearchSnapshot {
                        scope: LibrarySearchSnapshotScope::Page {
                            page_id: created.page_id.clone(),
                        },
                        strict_materialization: true,
                    },
                },
            )
            .expect("acquire search snapshot");
        let LibraryReadValue::SearchSnapshotLease { value: lease } = acquired.value else {
            panic!("search snapshot lease")
        };
        assert_eq!(lease.manifest.pages.len(), 1);
        let page = &lease.manifest.pages[0];
        assert_eq!(page.page_id, created.page_id);
        assert!(page.body.logical_path.contains(&created.page_id));
        assert_eq!(
            page.body.sha256,
            crate::document::sha256(b"## Runtime\nCore starts on demand.\n")
        );
        let root = std::path::Path::new(&lease.physical_root);
        for file in [&page.meta, &page.body] {
            let path = root.join(&file.physical_relative_path);
            assert_eq!(
                std::fs::metadata(&path)
                    .expect("snapshot file")
                    .permissions()
                    .mode()
                    & 0o777,
                0o400
            );
        }
        assert_eq!(
            std::fs::metadata(root.join("manifest.json"))
                .expect("manifest commit marker")
                .permissions()
                .mode()
                & 0o777,
            0o400
        );
        let body_cache = directory
            .path()
            .join("search-snapshots/cache/v1/body")
            .join(&page.body.sha256);
        assert!(body_cache.is_file());
        assert_eq!(
            std::fs::metadata(root.join(&page.body.physical_relative_path))
                .expect("leased body metadata")
                .ino(),
            std::fs::metadata(&body_cache)
                .expect("cached body metadata")
                .ino(),
            "unchanged projections must use immutable hard links",
        );

        kernel
            .writer()
            .call({
                let document_id = created.document_id.clone();
                let stale_projected_seq = created.document_head_seq + 1;
                move |connection| {
                    connection.execute(
                        "UPDATE document_materializations SET projected_seq = ?1 WHERE document_id = ?2",
                        rusqlite::params![stale_projected_seq, document_id],
                    )?;
                    Ok(())
                }
            })
            .expect("make materialization stale");
        module
            .search_snapshot_lease_registry()
            .expect("search snapshot registry")
            .invalidate_prepared();
        let stale = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AcquireSearchSnapshot {
                        scope: LibrarySearchSnapshotScope::Page {
                            page_id: created.page_id.clone(),
                        },
                        strict_materialization: true,
                    },
                },
            )
            .expect_err("strict snapshots reject stale materialization");
        assert_eq!(
            stale.code,
            nodex_core_contracts::CoreErrorCode::MaterializationStale
        );
        let partial = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AcquireSearchSnapshot {
                        scope: LibrarySearchSnapshotScope::Page {
                            page_id: created.page_id.clone(),
                        },
                        strict_materialization: false,
                    },
                },
            )
            .expect("non-strict snapshots report and skip stale materialization");
        let LibraryReadValue::SearchSnapshotLease {
            value: partial_lease,
        } = partial.value
        else {
            panic!("partial search snapshot lease")
        };
        assert!(partial_lease.manifest.pages.is_empty());
        assert_eq!(
            partial_lease.manifest.warnings,
            vec![
                nodex_core_contracts::library::LibrarySearchSnapshotWarning::MaterializationStale {
                    page_id: created.page_id.clone(),
                },
            ]
        );
        kernel
            .writer()
            .call({
                let document_id = created.document_id.clone();
                let projected_seq = created.document_head_seq;
                move |connection| {
                    connection.execute(
                        "UPDATE document_materializations SET projected_seq = ?1 WHERE document_id = ?2",
                        rusqlite::params![projected_seq, document_id],
                    )?;
                    Ok(())
                }
            })
            .expect("restore exact materialization");
        module
            .search_snapshot_lease_registry()
            .expect("search snapshot registry")
            .invalidate_prepared();
        let partial_lease_id = partial_lease.lease_id.clone();

        std::fs::set_permissions(&body_cache, std::fs::Permissions::from_mode(0o600))
            .expect("make cache fixture writable");
        std::fs::write(&body_cache, b"corrupt cache fixture").expect("corrupt cache fixture");

        let prepared_title = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: created.page_id.clone(),
                        file_kind: LibraryPageFileKind::MetaYaml,
                        prepare: Some(LibraryPagePrepareKind::TitleSet),
                    },
                },
            )
            .expect("prepare title mutation");
        let LibraryReadValue::PageFile {
            value: prepared_title,
        } = prepared_title.value
        else {
            panic!("prepared title projection")
        };
        OwnedDocumentModule::new("profile-1", "library-1", &kernel)
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: OWNED_DOCUMENT_CONTRACT_VERSION,
                    operation_id: "native-cli:rename-search-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: OwnedDocumentIntent::ApplySemanticMutation {
                        document_id: created.document_id.clone(),
                        generation: created.document_generation,
                        expected_head_seq: created.document_head_seq,
                        commands: vec![DocumentSemanticCommand::SetTitle {
                            inline_markdown: "Renamed Search Page".to_owned(),
                            expected_etag: prepared_title
                                .validators
                                .title_etag
                                .expect("title ETag"),
                        }],
                    },
                },
            )
            .expect("rename searchable Page");
        let reacquired = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AcquireSearchSnapshot {
                        scope: LibrarySearchSnapshotScope::Page {
                            page_id: created.page_id.clone(),
                        },
                        strict_materialization: true,
                    },
                },
            )
            .expect("reacquire after metadata-only change");
        let LibraryReadValue::SearchSnapshotLease {
            value: renamed_lease,
        } = reacquired.value
        else {
            panic!("renamed search snapshot lease")
        };
        let renamed_page = &renamed_lease.manifest.pages[0];
        assert_eq!(renamed_page.body.sha256, page.body.sha256);
        assert_ne!(renamed_page.meta.sha256, page.meta.sha256);
        assert_eq!(
            std::fs::read(&body_cache).expect("rebuilt body cache"),
            b"## Runtime\nCore starts on demand.\n"
        );
        assert_eq!(
            std::fs::metadata(&body_cache)
                .expect("rebuilt body cache metadata")
                .permissions()
                .mode()
                & 0o777,
            0o400
        );
        assert_eq!(
            std::fs::read_dir(directory.path().join("search-snapshots/cache/v1/body"))
                .expect("body cache")
                .count(),
            1
        );
        assert_eq!(
            std::fs::read_dir(directory.path().join("search-snapshots/cache/v1/meta"))
                .expect("metadata cache")
                .count(),
            2
        );

        module
            .apply(
                &context(),
                create_database_request("native-cli:create-search-database"),
            )
            .expect("create searchable Database");
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "native-cli:grant-search-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        access: LibraryAccess::ReadWrite,
                    },
                },
            )
            .expect("grant searchable Database");
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "native-cli:move-search-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MovePage {
                        page_id: created.page_id.clone(),
                        destination: LibraryPageWriteDestination::DataSource {
                            data_source_id: "018f0000-0000-7000-8000-000000000002".to_owned(),
                            at: Some(LibraryAgentSiblingAnchor::End),
                        },
                    },
                },
            )
            .expect("move searchable Page into Data Source");
        let database_snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AcquireSearchSnapshot {
                        scope: LibrarySearchSnapshotScope::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        strict_materialization: true,
                    },
                },
            )
            .expect("acquire Database search snapshot");
        let LibraryReadValue::SearchSnapshotLease {
            value: database_lease,
        } = database_snapshot.value
        else {
            panic!("Database search snapshot lease")
        };
        assert_eq!(database_lease.manifest.pages.len(), 1);
        assert_eq!(
            database_lease.manifest.pages[0].database_id.as_deref(),
            Some("018f0000-0000-7000-8000-000000000001")
        );
        assert_eq!(
            database_lease.manifest.pages[0].data_source_id.as_deref(),
            Some("018f0000-0000-7000-8000-000000000002")
        );
        assert!(
            database_lease.manifest.pages[0]
                .data_source_schema_revision
                .is_some()
        );

        let release = |lease_id: &str| {
            module
                .read(
                    &context(),
                    ModuleReadRequest {
                        contract_version: LIBRARY_CONTRACT_VERSION,
                        read: LibraryRead::ReleaseSearchSnapshot {
                            lease_id: lease_id.to_owned(),
                        },
                    },
                )
                .expect("release search snapshot")
                .value
        };
        let LibraryReadValue::SearchSnapshotRelease { value } = release(&lease.lease_id) else {
            panic!("search snapshot release")
        };
        assert!(value.released);
        assert!(!root.exists());
        let LibraryReadValue::SearchSnapshotRelease { value } = release(&partial_lease_id) else {
            panic!("partial search snapshot release")
        };
        assert!(value.released);
        let LibraryReadValue::SearchSnapshotRelease { value } = release(&renamed_lease.lease_id)
        else {
            panic!("renamed search snapshot release")
        };
        assert!(value.released);
        let LibraryReadValue::SearchSnapshotRelease { value } = release(&database_lease.lease_id)
        else {
            panic!("Database search snapshot release")
        };
        assert!(value.released);
        let reusable_root = directory.path().join("search-snapshots/.reusable");
        assert!(reusable_root.is_dir(), "validated lease tree is reusable");
        let reused_database_snapshot = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::AcquireSearchSnapshot {
                        scope: LibrarySearchSnapshotScope::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        strict_materialization: true,
                    },
                },
            )
            .expect("reuse unchanged Database search snapshot");
        let LibraryReadValue::SearchSnapshotLease {
            value: reused_database_lease,
        } = reused_database_snapshot.value
        else {
            panic!("reused Database search snapshot lease")
        };
        assert_eq!(reused_database_lease.manifest, database_lease.manifest);
        assert!(
            !reusable_root.exists(),
            "reusable tree moves atomically into its new random lease"
        );
        let LibraryReadValue::SearchSnapshotRelease { value } =
            release(&reused_database_lease.lease_id)
        else {
            panic!("reused Database search snapshot release")
        };
        assert!(value.released);
        let LibraryReadValue::SearchSnapshotRelease { value } = release(&lease.lease_id) else {
            panic!("idempotent search snapshot release")
        };
        assert!(!value.released);
        assert!(body_cache.is_file(), "release preserves immutable cache");
    }

    #[test]
    fn semantic_page_duplicate_move_and_guarded_delete_are_atomic_and_replayable() {
        let (_directory, _kernel, module) = seeded_library();
        let mut retry_context = context();
        retry_context.connection_id = "connection:native-cli-retry".to_owned();
        let create = |operation_id: &str, title: &str| ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: operation_id.to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::CreatePageFromNfm {
                title_markdown: title.to_owned(),
                nfm: "## Body\n\nDurable content.".to_owned(),
                destination: LibraryPageWriteDestination::Library { at: None },
            },
        };
        let parent = module
            .apply(&context(), create("native-cli:create-parent", "Parent"))
            .expect("create destination Page")
            .committed
            .value
            .page_create
            .expect("parent result");
        let source = module
            .apply(&context(), create("native-cli:create-source", "Source"))
            .expect("create source Page")
            .committed
            .value
            .page_create
            .expect("source result");
        module
            .apply(
                &context(),
                create_database_request("native-cli:create-destination-database"),
            )
            .expect("create Data Source destination");
        module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "native-cli:grant-destination-database".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::GrantProjectAccess {
                        project_id: "project-1".to_owned(),
                        target: LibraryResourceTarget::Database {
                            database_id: "018f0000-0000-7000-8000-000000000001".to_owned(),
                        },
                        access: LibraryAccess::ReadWrite,
                    },
                },
            )
            .expect("grant destination Database write access");
        let duplicate_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "native-cli:duplicate-page".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::DuplicatePage {
                source_page_id: source.page_id.clone(),
                destination: LibraryPageWriteDestination::Page {
                    page_id: parent.page_id.clone(),
                    at: Some(LibraryAgentSiblingAnchor::End),
                },
            },
        };
        let duplicated = module
            .apply(&context(), duplicate_request.clone())
            .expect("duplicate Page into Page")
            .committed;
        let copied = duplicated
            .value
            .page_copy
            .clone()
            .expect("exact duplicate result");
        assert_eq!(copied.source_page_id, source.page_id);
        assert_eq!(copied.document_generation, 1);
        assert_eq!(copied.document_head_seq, 1);
        assert!(copied.title_etag.starts_with("nxe1."));
        assert!(copied.body_etag.starts_with("nxe1."));
        let duplicate_replay = module
            .apply(&retry_context, duplicate_request)
            .expect("duplicate replay");
        assert!(duplicate_replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            duplicate_replay.committed.value.page_copy,
            Some(copied.clone())
        );

        let before_move = module
            .read(
                &context(),
                ModuleReadRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    read: LibraryRead::PageFile {
                        page_id: copied.page_id.clone(),
                        file_kind: LibraryPageFileKind::MetaYaml,
                        prepare: Some(LibraryPagePrepareKind::PageDelete),
                    },
                },
            )
            .expect("prepare delete before move");
        let LibraryReadValue::PageFile { value: before_move } = before_move.value else {
            panic!("Page file")
        };
        let stale_delete_etag = before_move.validators.page_etag.expect("Page ETag");

        let move_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "native-cli:move-page".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::MovePage {
                page_id: copied.page_id.clone(),
                destination: LibraryPageWriteDestination::Library {
                    at: Some(LibraryAgentSiblingAnchor::Start),
                },
            },
        };
        let moved = module
            .apply(&context(), move_request.clone())
            .expect("move Page to Library")
            .committed;
        let transfer = moved
            .value
            .block_transfer
            .clone()
            .expect("exact transfer result");
        let moved_page_etag = transfer
            .page_etags
            .get(&copied.page_id)
            .cloned()
            .expect("post-move Page ETag");
        assert!(moved_page_etag.starts_with("nxe1."));
        let move_replay = module
            .apply(&retry_context, move_request)
            .expect("move replay across a new connection");
        assert!(move_replay.committed.receipt.mutation.duplicate);
        assert_eq!(move_replay.committed.value.block_transfer, Some(transfer));

        let moved_to_data_source = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "native-cli:move-page-to-data-source".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::MovePage {
                        page_id: copied.page_id.clone(),
                        destination: LibraryPageWriteDestination::DataSource {
                            data_source_id: "018f0000-0000-7000-8000-000000000002".to_owned(),
                            at: Some(LibraryAgentSiblingAnchor::End),
                        },
                    },
                },
            )
            .expect("move Page into the default Data Source View")
            .committed
            .value
            .block_transfer
            .expect("Data Source transfer result");
        let moved_page_etag = moved_to_data_source
            .page_etags
            .get(&copied.page_id)
            .cloned()
            .expect("post-Data-Source Page ETag");
        assert_eq!(
            moved_to_data_source.affected_database_ids,
            vec!["018f0000-0000-7000-8000-000000000001".to_owned()]
        );

        let stale_delete = module
            .apply(
                &context(),
                ModuleApplyRequest {
                    contract_version: LIBRARY_CONTRACT_VERSION,
                    operation_id: "native-cli:delete-stale-page".to_owned(),
                    store_epoch: StoreEpoch("epoch-1".to_owned()),
                    intent: LibraryIntent::DeletePage {
                        page_id: copied.page_id.clone(),
                        expected_etag: stale_delete_etag,
                    },
                },
            )
            .expect_err("stale pre-move Page ETag must fail");
        assert_eq!(
            stale_delete.code,
            nodex_core_contracts::CoreErrorCode::RevisionConflict
        );

        let delete_request = ModuleApplyRequest {
            contract_version: LIBRARY_CONTRACT_VERSION,
            operation_id: "native-cli:delete-page".to_owned(),
            store_epoch: StoreEpoch("epoch-1".to_owned()),
            intent: LibraryIntent::DeletePage {
                page_id: copied.page_id.clone(),
                expected_etag: moved_page_etag,
            },
        };
        let deleted = module
            .apply(&context(), delete_request.clone())
            .expect("guarded Page delete");
        assert_eq!(
            deleted
                .committed
                .value
                .page_lifecycle
                .as_ref()
                .expect("delete receipt")
                .lifecycle,
            nodex_core_contracts::library::LibraryPageLifecycleState::Deleted
        );
        let delete_replay = module
            .apply(&retry_context, delete_request)
            .expect("delete replay after tombstone across a new connection");
        assert!(delete_replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            delete_replay.committed.value.page_lifecycle,
            deleted.committed.value.page_lifecycle
        );
    }
}
