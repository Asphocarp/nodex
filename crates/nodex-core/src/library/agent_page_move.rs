use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;

use nodex_core_contracts::agent::{
    AgentConsentRequirement, AgentEffectClass, AgentExecutionAuthorization,
    AgentOperationFootprint, AgentOperationPreparation, AgentOperationPreparationState,
    AgentOwnershipTransformation, AgentPreparedExecution, AgentResourceKind, AgentResourceTarget,
};
use nodex_core_contracts::library::{
    LibraryAgentDocumentHead, LibraryAgentMovePagePreparation, LibraryAgentMovePagesPreparation,
    LibraryAgentMovePagesRequest, LibraryAgentMovePagesResult, LibraryAgentMovedPage,
    LibraryAgentPageDestination, LibraryAgentPageLocation, LibraryBlockTransferDocumentHead,
    LibraryBlockTransferLogicalIntent, LibraryBlockTransferMode, LibraryBlockTransferPlan,
    LibraryBlockTransferSource, LibraryBlockTransferTarget, LibraryBlockTransferWriteFence,
    LibraryPageCopyDestination, LibraryReadValue,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CommittedModuleValue, LIBRARY_CONTRACT_VERSION,
    ModuleApplyRequest, ModuleReadSnapshot, ProjectId, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use serde_json::json;

use crate::database::{
    PageCopyDataSourceDestination, PageCopyPositionAnchor, PageCopyValueDraft,
    PageCopyViewPlacement, finalize_agent_moved_pages_in_data_source_prevalidated,
};
use crate::document::{read_store_epoch, sha256};
use crate::infrastructure::agent_operations::{
    PreparedAgentOperationBinding, PreparedAgentOperationRegistry,
};
use crate::infrastructure::module_receipts::read_module_receipt;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::writer::{StoreReaders, StoreWriter};

use super::LibraryApplyOutcome;
use super::agent_page_write::{
    ResolvedDestination, destination_before_id, destination_footprint_target, read_location_anchor,
    resolve_before_id, resolve_destination,
};
use super::block_transfer::AgentPageMoveTransferAuthority;
use super::content_rehome::{
    PrepareContentRehome, PreparedContentRehome, apply_prevalidated_content_rehome,
    prepare_content_rehome, remove_prevalidated_content_rehome_projections,
};
use super::mutation::{MutationEffects, finish_mutation, insert_library_placement, sqlite_now};

const MODULE_NAME: &str = "library";
const MAX_PAGES: usize = 16;
const MAX_ID_BYTES: usize = 512;

#[derive(Clone, Debug, Serialize)]
struct PreparedMoveStep {
    page_id: String,
    source: LibraryBlockTransferSource,
    source_document_id: Option<String>,
    source_database_id: Option<String>,
    source_project_id: String,
    target_project_id: String,
    same_data_source: bool,
    source_state_hash: String,
    write_fence: LibraryBlockTransferWriteFence,
    rehome: Option<PreparedContentRehome>,
}

struct MovePreflight {
    binding: PreparedAgentOperationBinding,
    destination: LibraryPageCopyDestination,
    destination_document: Option<LibraryAgentDocumentHead>,
    destination_database_id: Option<String>,
    destination_project_id: String,
    steps: Vec<PreparedMoveStep>,
    document_heads: Vec<LibraryAgentDocumentHead>,
    footprint: AgentOperationFootprint,
}

pub(super) struct PrepareMovePagesInput {
    pub(super) operation_id: String,
    pub(super) expected_store_epoch: String,
    pub(super) authorization: AgentExecutionAuthorization,
    pub(super) request: LibraryAgentMovePagesRequest,
}

enum PreparationRead {
    Committed {
        store_epoch: String,
        commit_head: i64,
        footprint: AgentOperationFootprint,
        committed: Box<
            CommittedModuleValue<
                nodex_core_contracts::library::LibraryCommitValue,
                nodex_core_contracts::library::LibraryReceipt,
            >,
        >,
    },
    Prepared {
        store_epoch: String,
        commit_head: i64,
        preflight: Box<MovePreflight>,
    },
}

pub(super) fn prepare_move_pages(
    readers: &StoreReaders,
    registry: &PreparedAgentOperationRegistry,
    context: &BoundModuleContext,
    library_id: &str,
    input: PrepareMovePagesInput,
) -> Result<ModuleReadSnapshot<LibraryReadValue>, StoreError> {
    let PrepareMovePagesInput {
        operation_id,
        expected_store_epoch,
        authorization,
        request,
    } = input;
    validate_id(&operation_id, "operation_id")?;
    let context = context.clone();
    let library_id = library_id.to_owned();
    let preparation = readers.read_default(|connection| {
        let transaction = connection.unchecked_transaction()?;
        let store_epoch = read_store_epoch(&transaction)?;
        if store_epoch != expected_store_epoch {
            return Err(stale_epoch());
        }
        let commit_head = super::navigation::commit_head(&transaction)?;
        let request_hash = request_hash(&context, &store_epoch, &authorization, &request)?;
        if let Some(stored) = read_module_receipt(&transaction, MODULE_NAME, &operation_id)? {
            if stored.request_hash != request_hash {
                return Err(reused());
            }
            let mut committed = serde_json::from_value::<
                CommittedModuleValue<
                    nodex_core_contracts::library::LibraryCommitValue,
                    nodex_core_contracts::library::LibraryReceipt,
                >,
            >(stored.result)
            .map_err(|_| corrupt("Stored Agent Page-move receipt is invalid"))?;
            committed.receipt.mutation.duplicate = true;
            let result = committed
                .value
                .agent_move_pages
                .as_ref()
                .ok_or_else(|| corrupt("Stored Library receipt is not an Agent Page move"))?;
            let footprint = committed_footprint(&library_id, result);
            transaction.commit()?;
            return Ok(PreparationRead::Committed {
                store_epoch,
                commit_head,
                footprint,
                committed: Box::new(committed),
            });
        }
        let preflight = compile_preflight(
            &transaction,
            &context,
            &library_id,
            &operation_id,
            &store_epoch,
            &authorization,
            &request,
            request_hash,
        )?;
        transaction.commit()?;
        Ok(PreparationRead::Prepared {
            store_epoch,
            commit_head,
            preflight: Box::new(preflight),
        })
    })?;

    match preparation {
        PreparationRead::Committed {
            store_epoch,
            commit_head,
            footprint,
            committed,
        } => Ok(ModuleReadSnapshot {
            contract_version: LIBRARY_CONTRACT_VERSION,
            store_epoch: StoreEpoch(store_epoch),
            commit_head,
            value: LibraryReadValue::AgentMovePagesPreparation {
                value: Box::new(LibraryAgentMovePagesPreparation {
                    preparation: AgentOperationPreparation {
                        state: AgentOperationPreparationState::CommittedReplay,
                        consent: AgentConsentRequirement::None,
                        footprint,
                        preview_markdown: None,
                        token: None,
                        expires_at_unix_ms: None,
                    },
                    pages: Vec::new(),
                    document_heads: Vec::new(),
                    destination: None,
                    destination_document: None,
                    destination_database_id: None,
                    destination_project_id: None,
                    committed: Some(committed),
                }),
            },
        }),
        PreparationRead::Prepared {
            store_epoch,
            commit_head,
            preflight,
        } => {
            let issued = registry.issue(preflight.binding)?;
            Ok(ModuleReadSnapshot {
                contract_version: LIBRARY_CONTRACT_VERSION,
                store_epoch: StoreEpoch(store_epoch),
                commit_head,
                value: LibraryReadValue::AgentMovePagesPreparation {
                    value: Box::new(LibraryAgentMovePagesPreparation {
                        preparation: AgentOperationPreparation {
                            state: AgentOperationPreparationState::Prepared,
                            consent: AgentConsentRequirement::None,
                            footprint: preflight.footprint,
                            preview_markdown: None,
                            token: Some(issued.token),
                            expires_at_unix_ms: Some(issued.expires_at_unix_ms),
                        },
                        pages: preflight.steps.iter().map(page_preparation).collect(),
                        document_heads: preflight.document_heads,
                        destination: Some(preflight.destination),
                        destination_document: preflight.destination_document,
                        destination_database_id: preflight.destination_database_id,
                        destination_project_id: Some(preflight.destination_project_id),
                        committed: None,
                    }),
                },
            })
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn execute_move_pages(
    writer: &StoreWriter,
    registry: &PreparedAgentOperationRegistry,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: ModuleApplyRequest<nodex_core_contracts::library::LibraryIntent>,
    authorization: AgentPreparedExecution,
    move_request: LibraryAgentMovePagesRequest,
    assets_root: &Path,
) -> Result<LibraryApplyOutcome, StoreError> {
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let context = context.clone();
    let registry = registry.clone();
    let assets_root = assets_root.to_path_buf();
    let operation_id = request.operation_id;
    let expected_store_epoch = request.store_epoch.0;
    let result = writer.call(move |connection| {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        super::mutation::assert_identity(&transaction, &profile_id, &library_id)?;
        let store_epoch = read_store_epoch(&transaction)?;
        if store_epoch != expected_store_epoch {
            return Err(stale_epoch());
        }
        let request_hash = request_hash(
            &context,
            &store_epoch,
            &authorization.authorization,
            &move_request,
        )?;
        if let Some(stored) = read_module_receipt(&transaction, MODULE_NAME, &operation_id)? {
            if stored.request_hash != request_hash {
                return Err(reused());
            }
            let mut committed = serde_json::from_value::<
                CommittedModuleValue<
                    nodex_core_contracts::library::LibraryCommitValue,
                    nodex_core_contracts::library::LibraryReceipt,
                >,
            >(stored.result)
            .map_err(|_| corrupt("Stored Agent Page-move receipt is invalid"))?;
            if committed.value.agent_move_pages.is_none() {
                return Err(corrupt("Stored Library receipt is not an Agent Page move"));
            }
            committed.receipt.mutation.duplicate = true;
            transaction.commit()?;
            return Ok((
                LibraryApplyOutcome {
                    committed,
                    event: None,
                },
                None,
            ));
        }
        let preflight = compile_preflight(
            &transaction,
            &context,
            &library_id,
            &operation_id,
            &store_epoch,
            &authorization.authorization,
            &move_request,
            request_hash.clone(),
        )?;
        let token = authorization.token.as_deref().ok_or_else(stale_token)?;
        let lease = registry.acquire(token, &preflight.binding)?;
        let mut agent_context = context.clone();
        agent_context.adapter = AdapterKind::Agent;
        let execution = apply_pages(
            &transaction,
            &agent_context,
            &library_id,
            &operation_id,
            &store_epoch,
            &move_request,
            &preflight,
            &authorization.authorization,
            &assets_root,
        )?;
        let outcome = finish_mutation(
            &transaction,
            &agent_context,
            &store_epoch,
            &operation_id,
            &request_hash,
            MutationEffects {
                project_id: preflight.destination_project_id,
                operation_kind: "agent_move_pages",
                change_kind: "library.changed",
                did_mutate: true,
                created_target: None,
                affected_parent_keys: execution.affected_parent_keys,
                affected_block_ids: move_request.page_ids.clone(),
                affected_page_ids: execution.affected_page_ids,
                affected_database_ids: execution.result.affected_database_ids.clone(),
                affected_view_ids: execution.affected_view_ids,
                affected_document_ids: execution.affected_document_ids,
                committed_revisions: execution.committed_revisions,
                page_create: None,
                page_copy: None,
                canvas_mutation: None,
                block_transfer: None,
                page_lifecycle: None,
                block_property_mutation: None,
                agent_page_copy: None,
                agent_create_pages: None,
                agent_move_pages: Some(execution.result),
                change_payload: None,
                committed_at: execution.committed_at,
            },
        )?;
        transaction.commit()?;
        Ok((outcome, Some(lease)))
    })?;
    if let Some(lease) = result.1 {
        lease.consume()?;
    }
    Ok(result.0)
}

struct MoveExecution {
    result: LibraryAgentMovePagesResult,
    affected_parent_keys: Vec<String>,
    affected_page_ids: Vec<String>,
    affected_view_ids: Vec<String>,
    affected_document_ids: Vec<String>,
    committed_revisions: BTreeMap<String, i64>,
    committed_at: String,
}

#[allow(clippy::too_many_arguments)]
fn apply_pages(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    store_epoch: &str,
    request: &LibraryAgentMovePagesRequest,
    preflight: &MovePreflight,
    authorization: &AgentExecutionAuthorization,
    assets_root: &Path,
) -> Result<MoveExecution, StoreError> {
    let now = sqlite_now(connection)?;
    let mut document_commits = Vec::new();
    let mut affected_parent_keys = BTreeSet::new();
    let mut affected_page_ids = request.page_ids.iter().cloned().collect::<BTreeSet<_>>();
    let mut affected_database_ids = BTreeSet::new();
    let mut affected_view_ids = BTreeSet::new();
    let mut affected_document_ids = BTreeSet::new();
    let mut committed_revisions = BTreeMap::new();
    affected_parent_keys.insert(destination_parent_key(library_id, &request.destination));

    for (index, step) in preflight.steps.iter().enumerate() {
        affected_parent_keys.insert(source_parent_key(library_id, &step.source));
        if step.same_data_source {
            continue;
        }
        let transfer_operation_id = format!("{operation_id}:page:{index}");
        let mut transfer_context = context.clone();
        transfer_context.project_id = Some(ProjectId(step.source_project_id.clone()));
        let intent = transfer_intent(
            library_id,
            &step.page_id,
            &step.source,
            &preflight.destination,
            authorization,
        )?;
        let transfer_authority =
            transfer_authority(&preflight.destination, &preflight.destination_project_id)?;
        let plan = super::block_transfer::plan_agent_page_move(
            connection,
            &transfer_context,
            library_id,
            &transfer_operation_id,
            store_epoch,
            &intent,
            &transfer_authority,
        )?;
        let write_fence = match plan {
            LibraryBlockTransferPlan::Prepared { preparation } => preparation.write_fence,
            LibraryBlockTransferPlan::Committed { .. } => {
                return Err(corrupt(
                    "Fresh Agent Page move unexpectedly matched a committed transfer",
                ));
            }
        };
        let transfer_hash = super::block_transfer::semantic_agent_page_move_request_hash(
            &transfer_context,
            store_epoch,
            &intent,
            &transfer_authority,
        )?;
        if let Some(rehome) = &step.rehome {
            remove_prevalidated_content_rehome_projections(connection, rehome)?;
        }
        let outcome = if let Some(rehome) = &step.rehome {
            let mut apply_rehome = |transaction: &Connection,
                                    root_page_ids: &[String],
                                    committed_at: &str| {
                if root_page_ids != std::slice::from_ref(&step.page_id) {
                    return Err(corrupt(
                        "Agent Page-move rehome received divergent ownership roots",
                    ));
                }
                apply_prevalidated_content_rehome(transaction, rehome, committed_at, assets_root)
            };
            super::block_transfer::apply_agent_page_move(
                connection,
                &transfer_context,
                library_id,
                &transfer_operation_id,
                store_epoch,
                &transfer_hash,
                &intent,
                Some(&write_fence),
                assets_root,
                &transfer_authority,
                Some(&mut apply_rehome),
            )?
        } else {
            super::block_transfer::apply_agent_page_move(
                connection,
                &transfer_context,
                library_id,
                &transfer_operation_id,
                store_epoch,
                &transfer_hash,
                &intent,
                Some(&write_fence),
                assets_root,
                &transfer_authority,
                None,
            )?
        };
        if step.rehome.is_some()
            && matches!(
                preflight.destination,
                LibraryPageCopyDestination::Library { .. }
            )
        {
            reposition_rehomed_library_page(
                connection,
                library_id,
                &step.page_id,
                &preflight.destination_project_id,
                &preflight.destination,
                &now,
            )?;
        }
        let transfer = outcome
            .committed
            .value
            .block_transfer
            .ok_or_else(|| corrupt("Agent Page move omitted its transfer result"))?;
        for commit in &transfer.document_commits {
            affected_document_ids.insert(commit.document_id.clone());
        }
        document_commits.extend(transfer.document_commits);
        affected_database_ids.extend(transfer.affected_database_ids);
        affected_page_ids.extend(outcome.committed.receipt.affected_page_ids);
        affected_view_ids.extend(outcome.committed.receipt.affected_view_ids);
        committed_revisions.extend(outcome.committed.receipt.committed_revisions);
    }

    if let LibraryPageCopyDestination::DataSource { .. } = &preflight.destination {
        let destination = data_source_destination(&preflight.destination)?;
        let finalization = finalize_agent_moved_pages_in_data_source_prevalidated(
            connection,
            library_id,
            &preflight.destination_project_id,
            &request.page_ids,
            &destination,
            &now,
        )?;
        affected_database_ids.extend(finalization.affected_database_ids);
        affected_view_ids.extend(finalization.affected_view_ids);
        committed_revisions.extend(finalization.committed_revisions);
    }

    let location = destination_location(library_id, &request.destination);
    let pages = request
        .page_ids
        .iter()
        .map(|page_id| LibraryAgentMovedPage {
            page_id: page_id.clone(),
            location: location.clone(),
        })
        .collect();
    Ok(MoveExecution {
        result: LibraryAgentMovePagesResult {
            pages,
            document_commits,
            affected_database_ids: affected_database_ids.into_iter().collect(),
        },
        affected_parent_keys: affected_parent_keys.into_iter().collect(),
        affected_page_ids: affected_page_ids.into_iter().collect(),
        affected_view_ids: affected_view_ids.into_iter().collect(),
        affected_document_ids: affected_document_ids.into_iter().collect(),
        committed_revisions,
        committed_at: now,
    })
}

#[allow(clippy::too_many_arguments)]
fn compile_preflight(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    store_epoch: &str,
    authorization: &AgentExecutionAuthorization,
    request: &LibraryAgentMovePagesRequest,
    request_hash: String,
) -> Result<MovePreflight, StoreError> {
    validate_request(request)?;
    assert_no_ownership_overlap(connection, &request.page_ids)?;
    let ResolvedDestination {
        destination: resolved_destination,
        authorization_fingerprint: destination_fingerprint,
        document_heads: destination_heads,
        database_id: destination_database_id,
        project_id: destination_project_id,
    } = resolve_destination(
        connection,
        context,
        library_id,
        authorization,
        &request.destination,
    )?;
    let destination = resolve_move_destination(
        connection,
        &request.destination,
        resolved_destination,
        &request.page_ids,
        &destination_project_id,
    )?;
    let destination_document = matches!(
        request.destination,
        LibraryAgentPageDestination::Page { .. }
    )
    .then(|| destination_heads.first().cloned())
    .flatten();
    let mut source_fingerprints = Vec::with_capacity(request.page_ids.len());
    let mut steps = Vec::with_capacity(request.page_ids.len());
    let mut document_heads = destination_heads;
    let actor_project_id = context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| unauthorized("Agent Page movement requires a Project context"))?;
    let call_identity = hash_serializable(&(
        "move_pages",
        &authorization.provenance.authority.thread_id,
        &authorization.provenance.authority.turn_id,
        &authorization.call_id,
        actor_project_id,
    ))?;
    let mut rehome_closure_owners = BTreeMap::<String, String>::new();
    for (index, page_id) in request.page_ids.iter().enumerate() {
        let source_fingerprint = super::agent_authorization::authorize_execution(
            connection,
            context,
            library_id,
            authorization,
            &nodex_core_contracts::agent::AgentAuthorizationTarget::Page {
                page_id: page_id.clone(),
            },
            nodex_core_contracts::agent::AgentProjectResourceAction::Move,
        )?;
        source_fingerprints.push(source_fingerprint);
        let source = read_source(connection, library_id, page_id)?;
        let source_state_hash = source_state_hash(connection, page_id, &destination)?;
        let same_data_source = matches!(
            (&source.source, &destination),
            (
                LibraryBlockTransferSource::DataSource { data_source_id: source_id },
                LibraryPageCopyDestination::DataSource { data_source_id: target_id, .. }
            ) if source_id == target_id
        );
        if same_data_source
            && matches!(
                &destination,
                LibraryPageCopyDestination::DataSource { values, .. } if !values.is_empty()
            )
        {
            return Err(invalid(
                "Moving within one Data Source cannot change independent Property values",
            ));
        }
        let rehome = if source.source_project_id == destination_project_id {
            None
        } else {
            let prepared = prepare_content_rehome(
                connection,
                PrepareContentRehome {
                    operation_id: &format!("{operation_id}:page:{index}:rehome"),
                    call_identity: &call_identity,
                    actor_project_id,
                    source_project_id: &source.source_project_id,
                    target_project_id: &destination_project_id,
                    library_id,
                    store_epoch,
                    root_page_ids: std::slice::from_ref(page_id),
                },
            )?;
            for block_id in &prepared.block_ids {
                if let Some(owner) = rehome_closure_owners.insert(block_id.clone(), page_id.clone())
                    && owner != *page_id
                {
                    return Err(invalid(
                        "Cross-owner Page moves cannot select overlapping ownership closures",
                    ));
                }
            }
            Some(prepared)
        };
        let write_fence = if same_data_source {
            LibraryBlockTransferWriteFence {
                documents: Vec::new(),
                location_revisions: BTreeMap::new(),
                source_memberships: BTreeMap::new(),
            }
        } else {
            let mut transfer_context = context.clone();
            transfer_context.project_id = Some(ProjectId(source.source_project_id.clone()));
            let intent = transfer_intent(
                library_id,
                page_id,
                &source.source,
                &destination,
                authorization,
            )?;
            let transfer_authority = transfer_authority(&destination, &destination_project_id)?;
            let plan = super::block_transfer::plan_agent_page_move(
                connection,
                &transfer_context,
                library_id,
                &format!("{operation_id}:page:{index}"),
                store_epoch,
                &intent,
                &transfer_authority,
            )?;
            match plan {
                LibraryBlockTransferPlan::Prepared { preparation } => preparation.write_fence,
                LibraryBlockTransferPlan::Committed { .. } => {
                    return Err(corrupt(
                        "Uncommitted Agent Page move matched a committed transfer",
                    ));
                }
            }
        };
        merge_document_heads(&mut document_heads, &write_fence.documents)?;
        steps.push(PreparedMoveStep {
            page_id: page_id.clone(),
            source: source.source,
            source_document_id: source.source_document_id,
            source_database_id: source.source_database_id,
            source_project_id: source.source_project_id,
            target_project_id: destination_project_id.clone(),
            same_data_source,
            source_state_hash,
            write_fence,
            rehome,
        });
    }
    document_heads.sort_by(|left, right| left.document_id.cmp(&right.document_id));
    let parent_id = destination_parent_id(library_id, &request.destination);
    let before_id = destination_before_id(&destination);
    let mut targets = request
        .page_ids
        .iter()
        .map(|page_id| AgentResourceTarget {
            kind: AgentResourceKind::Page,
            id: page_id.clone(),
        })
        .collect::<Vec<_>>();
    targets.push(destination_footprint_target(
        library_id,
        &request.destination,
    ));
    let footprint = AgentOperationFootprint {
        effect_class: AgentEffectClass::Write,
        targets,
        created_roots: Vec::new(),
        updated_roots: request.page_ids.clone(),
        deleted_roots: Vec::new(),
        deleted_owner_roots: Vec::new(),
        ownership_transformations: request
            .page_ids
            .iter()
            .map(|page_id| AgentOwnershipTransformation {
                resource_id: page_id.clone(),
                parent_id: Some(parent_id.clone()),
                before_id: before_id.clone(),
            })
            .collect(),
    };
    let authority_revisions_hash = hash_serializable(&(
        source_fingerprints,
        destination_fingerprint,
        store_epoch,
        &destination,
        &destination_project_id,
        &steps,
        &document_heads,
    ))?;
    let footprint_hash = hash_serializable(&footprint)?;
    Ok(MovePreflight {
        binding: PreparedAgentOperationBinding {
            connection_id: context.connection_id.clone(),
            operation_id: operation_id.to_owned(),
            request_hash,
            authority_revisions_hash,
            footprint_hash,
            effect_class: AgentEffectClass::Write,
        },
        destination,
        destination_document,
        destination_database_id,
        destination_project_id,
        steps,
        document_heads,
        footprint,
    })
}

struct SourcePlacement {
    source: LibraryBlockTransferSource,
    source_document_id: Option<String>,
    source_database_id: Option<String>,
    source_project_id: String,
}

fn read_source(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<SourcePlacement, StoreError> {
    let row = connection
        .query_row(
            "SELECT block.project_id, page.parent_kind, page.parent_id, \
               block.containing_document_id, block.containing_database_id, \
               block.lifecycle, page.lifecycle, document.readiness \
             FROM pages page JOIN blocks block ON block.id = page.block_id \
             JOIN documents document ON document.id = page.document_id \
             WHERE page.block_id = ?1 AND page.library_id = ?2 AND block.type = 'page'",
            params![page_id, library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Source Page is unavailable"))?;
    if row.5 != "active" || row.6 != "active" || row.7 != "ready" {
        return Err(not_found("Source Page is unavailable"));
    }
    let (source, source_document_id, source_database_id) = match row.1.as_str() {
        "library" if row.2 == library_id => (
            LibraryBlockTransferSource::Library {
                library_id: library_id.to_owned(),
            },
            None,
            None,
        ),
        "page" => {
            let document_id = row
                .3
                .ok_or_else(|| corrupt("Page-owned source has no containing Document"))?;
            (
                LibraryBlockTransferSource::Page {
                    page_id: row.2.clone(),
                },
                Some(document_id),
                None,
            )
        }
        "data_source" => {
            let database_id = row
                .4
                .ok_or_else(|| corrupt("Data Source Page has no containing Database"))?;
            (
                LibraryBlockTransferSource::DataSource {
                    data_source_id: row.2.clone(),
                },
                None,
                Some(database_id),
            )
        }
        _ => return Err(corrupt("Source Page has inconsistent parent authority")),
    };
    Ok(SourcePlacement {
        source,
        source_document_id,
        source_database_id,
        source_project_id: row.0,
    })
}

fn source_state_hash(
    connection: &Connection,
    page_id: &str,
    destination: &LibraryPageCopyDestination,
) -> Result<String, StoreError> {
    let authority = connection
        .query_row(
            "SELECT block.location_revision, block.metadata_revision, page.parent_revision, \
               membership.id, membership.revision \
             FROM pages page JOIN blocks block ON block.id = page.block_id \
             LEFT JOIN data_source_page_memberships membership \
               ON membership.page_block_id = page.block_id AND membership.removed_at IS NULL \
             WHERE page.block_id = ?1",
            [page_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Source Page is unavailable"))?;
    let data_source_authority = if let LibraryPageCopyDestination::DataSource {
        data_source_id,
        view: Some(view),
        ..
    } = destination
    {
        let position_revision = connection
            .query_row(
                "SELECT revision FROM database_view_page_positions \
                 WHERE view_id = ?1 AND page_block_id = ?2",
                params![view.view_id, page_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let config = connection
            .query_row(
                "SELECT config_json FROM database_views \
                 WHERE id = ?1 AND data_source_id = ?2 AND lifecycle = 'active'",
                params![view.view_id, data_source_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| not_found("Agent Page-move target View is unavailable"))?;
        let config = serde_json::from_str::<serde_json::Value>(&config)
            .map_err(|_| corrupt("Agent Page-move target View config is invalid"))?;
        let group_property_id = config
            .pointer("/group/propertyId")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        let group_value_revision = group_property_id
            .as_deref()
            .map(|property_id| {
                connection
                    .query_row(
                        "SELECT property_value.revision \
                         FROM data_source_page_memberships membership \
                         LEFT JOIN data_source_property_values property_value \
                           ON property_value.data_source_id = membership.data_source_id \
                          AND property_value.membership_id = membership.id \
                          AND property_value.property_id = ?3 \
                         WHERE membership.data_source_id = ?1 \
                           AND membership.page_block_id = ?2 \
                           AND membership.removed_at IS NULL",
                        params![data_source_id, page_id, property_id],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .optional()
                    .map(|value| value.flatten())
            })
            .transpose()?;
        Some((position_revision, group_property_id, group_value_revision))
    } else {
        None
    };
    hash_serializable(&(authority, data_source_authority))
}

fn transfer_intent(
    library_id: &str,
    page_id: &str,
    source: &LibraryBlockTransferSource,
    destination: &LibraryPageCopyDestination,
    authorization: &AgentExecutionAuthorization,
) -> Result<LibraryBlockTransferLogicalIntent, StoreError> {
    let target = match destination {
        LibraryPageCopyDestination::Library { before } => LibraryBlockTransferTarget::Library {
            library_id: library_id.to_owned(),
            before_block_id: before.as_ref().map(|anchor| anchor.block_id.clone()),
        },
        LibraryPageCopyDestination::Page {
            page_id, before, ..
        } => LibraryBlockTransferTarget::Page {
            page_id: page_id.clone(),
            parent_block_id: None,
            before_block_id: before.as_ref().map(|anchor| anchor.block_id.clone()),
        },
        LibraryPageCopyDestination::DataSource {
            data_source_id,
            view,
            ..
        } => {
            let view = view
                .as_ref()
                .ok_or_else(|| corrupt("Agent Page-move target has no resolved View"))?;
            LibraryBlockTransferTarget::DataSource {
                data_source_id: data_source_id.clone(),
                view_id: view.view_id.clone(),
                group_key: view.group_key.clone(),
                before_page_id: view.before.as_ref().map(|anchor| anchor.page_id.clone()),
            }
        }
    };
    Ok(LibraryBlockTransferLogicalIntent {
        actor: agent_actor(authorization),
        mode: LibraryBlockTransferMode::Move,
        root_block_ids: vec![page_id.to_owned()],
        causal_dependencies: Vec::new(),
        source: source.clone(),
        target,
    })
}

fn agent_actor(authorization: &AgentExecutionAuthorization) -> serde_json::Value {
    let authority = &authorization.provenance.authority;
    json!({
        "kind": "nodex_agent",
        "tool": "move_pages",
        "threadId": authority.thread_id,
        "turnId": authority.turn_id,
        "callId": authorization.call_id,
    })
}

fn merge_document_heads(
    heads: &mut Vec<LibraryAgentDocumentHead>,
    additions: &[LibraryBlockTransferDocumentHead],
) -> Result<(), StoreError> {
    for addition in additions {
        if let Some(existing) = heads
            .iter()
            .find(|head| head.document_id == addition.document_id)
        {
            if existing.generation != addition.generation
                || existing.expected_head_seq != addition.expected_head_seq
            {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    format!(
                        "Document {} changed while preparing Agent Page movement",
                        addition.document_id
                    ),
                    true,
                ));
            }
            continue;
        }
        heads.push(LibraryAgentDocumentHead {
            document_id: addition.document_id.clone(),
            generation: addition.generation,
            expected_head_seq: addition.expected_head_seq,
        });
    }
    Ok(())
}

fn data_source_destination(
    destination: &LibraryPageCopyDestination,
) -> Result<PageCopyDataSourceDestination, StoreError> {
    let LibraryPageCopyDestination::DataSource {
        data_source_id,
        expected_data_source_revision,
        values,
        view,
    } = destination
    else {
        return Err(corrupt("Agent Page move lost its Data Source destination"));
    };
    Ok(PageCopyDataSourceDestination {
        data_source_id: data_source_id.clone(),
        expected_data_source_revision: *expected_data_source_revision,
        values: values
            .iter()
            .map(|value| PageCopyValueDraft {
                property_id: value.property_id.clone(),
                value: value.value.clone(),
            })
            .collect(),
        view: view.as_ref().map(|view| PageCopyViewPlacement {
            view_id: view.view_id.clone(),
            expected_view_revision: view.expected_view_revision,
            group_key: view.group_key.clone(),
            before: view.before.as_ref().map(|anchor| PageCopyPositionAnchor {
                page_id: anchor.page_id.clone(),
                expected_position_revision: anchor.expected_position_revision,
            }),
        }),
    })
}

fn transfer_authority(
    _destination: &LibraryPageCopyDestination,
    target_project_id: &str,
) -> Result<AgentPageMoveTransferAuthority, StoreError> {
    Ok(AgentPageMoveTransferAuthority {
        target_project_id: target_project_id.to_owned(),
    })
}

fn reposition_rehomed_library_page(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
    target_project_id: &str,
    destination: &LibraryPageCopyDestination,
    now: &str,
) -> Result<(), StoreError> {
    let LibraryPageCopyDestination::Library { before } = destination else {
        return Err(corrupt("Agent Page move lost its Library destination"));
    };
    connection.execute(
        "DELETE FROM top_level_block_placements WHERE block_id = ?1",
        [page_id],
    )?;
    connection.execute(
        "DELETE FROM library_block_placements WHERE block_id = ?1 AND library_id = ?2",
        params![page_id, library_id],
    )?;
    let before_block_id = before.as_ref().map(|anchor| anchor.block_id.as_str());
    let rank = super::block_transfer::insert_top_level_placement(
        connection,
        target_project_id,
        page_id,
        before_block_id,
        now,
    )?;
    let anchor = before_block_id
        .map(|block_id| {
            super::block_transfer::read_library_anchor(connection, library_id, block_id)
        })
        .transpose()?;
    insert_library_placement(connection, library_id, page_id, anchor.as_ref(), now)?;
    connection.execute(
        "UPDATE page_read_model SET top_level_rank_key = ?1, updated_at = ?2 \
         WHERE page_block_id = ?3 AND project_id = ?4",
        params![rank, now, page_id, target_project_id],
    )?;
    Ok(())
}

fn resolve_move_destination(
    connection: &Connection,
    request: &LibraryAgentPageDestination,
    destination: LibraryPageCopyDestination,
    moved_page_ids: &[String],
    destination_project_id: &str,
) -> Result<LibraryPageCopyDestination, StoreError> {
    let moved = moved_page_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    match (request, destination) {
        (
            LibraryAgentPageDestination::Library { at },
            LibraryPageCopyDestination::Library { .. },
        ) => {
            let ids = connection
                .prepare(
                    "SELECT placement.block_id FROM top_level_block_placements placement \
                     JOIN blocks block ON block.id = placement.block_id \
                     WHERE placement.project_id = ?1 AND block.lifecycle = 'active' \
                     ORDER BY placement.rank_key, placement.block_id",
                )?
                .query_map([destination_project_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .filter(|block_id| !moved.contains(block_id.as_str()))
                .collect::<Vec<_>>();
            let before_id = resolve_before_id(&ids, at.as_ref(), "Library")?;
            let before = before_id
                .map(|block_id| read_location_anchor(connection, &block_id))
                .transpose()?;
            Ok(LibraryPageCopyDestination::Library { before })
        }
        (
            LibraryAgentPageDestination::Page { at, .. },
            LibraryPageCopyDestination::Page {
                page_id,
                expected_document_generation,
                expected_document_head_seq,
                ..
            },
        ) => {
            let document_id = connection.query_row(
                "SELECT document_id FROM pages WHERE block_id = ?1",
                [&page_id],
                |row| row.get::<_, String>(0),
            )?;
            let ids = connection
                .prepare(
                    "SELECT entry.block_id FROM document_block_index entry \
                     JOIN blocks block ON block.id = entry.block_id \
                     WHERE entry.document_id = ?1 AND entry.parent_block_id IS NULL \
                       AND block.lifecycle = 'active' ORDER BY entry.ordinal, entry.block_id",
                )?
                .query_map([document_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .filter(|block_id| !moved.contains(block_id.as_str()))
                .collect::<Vec<_>>();
            let before_id = resolve_before_id(&ids, at.as_ref(), "Destination Page")?;
            let before = before_id
                .map(|block_id| read_location_anchor(connection, &block_id))
                .transpose()?;
            Ok(LibraryPageCopyDestination::Page {
                page_id,
                expected_document_generation,
                expected_document_head_seq,
                before,
            })
        }
        (
            LibraryAgentPageDestination::DataSource { at, .. },
            LibraryPageCopyDestination::DataSource {
                data_source_id,
                expected_data_source_revision,
                values,
                view: Some(mut view),
            },
        ) => {
            let ids = connection
                .prepare(
                    "SELECT membership.page_block_id \
                     FROM data_source_page_memberships membership \
                     JOIN pages page ON page.block_id = membership.page_block_id \
                     LEFT JOIN database_view_page_positions position \
                       ON position.view_id = ?1 \
                      AND position.page_block_id = membership.page_block_id \
                     WHERE membership.data_source_id = ?2 \
                       AND membership.removed_at IS NULL AND page.lifecycle = 'active' \
                       AND position.group_key IS ?3 \
                     ORDER BY CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END, \
                       position.rank_key, membership.page_block_id",
                )?
                .query_map(
                    params![view.view_id, data_source_id, view.group_key],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .filter(|page_id| !moved.contains(page_id.as_str()))
                .collect::<Vec<_>>();
            let before_page_id = resolve_before_id(&ids, at.as_ref(), "Destination View")?;
            view.before = before_page_id
                .map(|page_id| {
                    let expected_position_revision = connection
                        .query_row(
                            "SELECT COALESCE(revision, 0) \
                             FROM database_view_page_positions \
                             WHERE view_id = ?1 AND page_block_id = ?2",
                            params![view.view_id, page_id],
                            |row| row.get::<_, i64>(0),
                        )
                        .optional()?
                        .unwrap_or(0);
                    Ok::<_, StoreError>(
                        nodex_core_contracts::library::LibraryPageCopyPositionAnchor {
                            page_id,
                            expected_position_revision,
                        },
                    )
                })
                .transpose()?;
            Ok(LibraryPageCopyDestination::DataSource {
                data_source_id,
                expected_data_source_revision,
                values,
                view: Some(view),
            })
        }
        (_, destination) => Ok(destination),
    }
}

fn validate_request(request: &LibraryAgentMovePagesRequest) -> Result<(), StoreError> {
    if request.page_ids.is_empty() || request.page_ids.len() > MAX_PAGES {
        return Err(invalid("move_pages requires between 1 and 16 Page IDs"));
    }
    let mut unique = HashSet::new();
    for page_id in &request.page_ids {
        validate_id(page_id, "page_ids")?;
        if !unique.insert(page_id.as_str()) {
            return Err(invalid("move_pages Page IDs must be unique"));
        }
    }
    if let LibraryAgentPageDestination::Page { page_id, .. } = &request.destination
        && unique.contains(page_id.as_str())
    {
        return Err(invalid("A moved Page cannot be its own destination Page"));
    }
    let anchor = match &request.destination {
        LibraryAgentPageDestination::Library { at }
        | LibraryAgentPageDestination::Page { at, .. }
        | LibraryAgentPageDestination::DataSource { at, .. } => at,
    };
    if let Some(
        nodex_core_contracts::library::LibraryAgentSiblingAnchor::Before { block_id }
        | nodex_core_contracts::library::LibraryAgentSiblingAnchor::After { block_id },
    ) = anchor
        && unique.contains(block_id.as_str())
    {
        return Err(invalid(
            "A Page move anchor must be outside the moved Page set",
        ));
    }
    Ok(())
}

fn assert_no_ownership_overlap(
    connection: &Connection,
    page_ids: &[String],
) -> Result<(), StoreError> {
    let selected = page_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    for page_id in page_ids {
        let mut current = page_id.clone();
        let mut visited = HashSet::new();
        let mut reached_root = false;
        for _ in 0..256 {
            if !visited.insert(current.clone()) {
                return Err(corrupt("Page ownership hierarchy contains a cycle"));
            }
            let parent = connection
                .query_row(
                    "SELECT parent_kind, parent_id FROM pages WHERE block_id = ?1",
                    [&current],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
                .ok_or_else(|| not_found("Source Page is unavailable"))?;
            if parent.0 != "page" {
                reached_root = true;
                break;
            }
            if selected.contains(parent.1.as_str()) {
                return Err(invalid(
                    "Page moves cannot select both an ownership ancestor and its descendant",
                ));
            }
            current = parent.1;
        }
        if !reached_root {
            return Err(corrupt(
                "Page ownership hierarchy exceeds its supported depth",
            ));
        }
    }
    Ok(())
}

fn page_preparation(step: &PreparedMoveStep) -> LibraryAgentMovePagePreparation {
    LibraryAgentMovePagePreparation {
        page_id: step.page_id.clone(),
        source: step.source.clone(),
        source_document_id: step.source_document_id.clone(),
        source_database_id: step.source_database_id.clone(),
        source_project_id: step.source_project_id.clone(),
        target_project_id: step.target_project_id.clone(),
    }
}

fn destination_location(
    library_id: &str,
    destination: &LibraryAgentPageDestination,
) -> LibraryAgentPageLocation {
    match destination {
        LibraryAgentPageDestination::Library { .. } => LibraryAgentPageLocation::Library {
            library_id: library_id.to_owned(),
        },
        LibraryAgentPageDestination::Page { page_id, .. } => LibraryAgentPageLocation::Page {
            page_id: page_id.clone(),
        },
        LibraryAgentPageDestination::DataSource { data_source_id, .. } => {
            LibraryAgentPageLocation::DataSource {
                data_source_id: data_source_id.clone(),
            }
        }
    }
}

fn destination_parent_id(library_id: &str, destination: &LibraryAgentPageDestination) -> String {
    match destination {
        LibraryAgentPageDestination::Library { .. } => library_id.to_owned(),
        LibraryAgentPageDestination::Page { page_id, .. } => page_id.clone(),
        LibraryAgentPageDestination::DataSource { data_source_id, .. } => data_source_id.clone(),
    }
}

fn destination_parent_key(library_id: &str, destination: &LibraryAgentPageDestination) -> String {
    match destination {
        LibraryAgentPageDestination::Library { .. } => format!("library:{library_id}"),
        LibraryAgentPageDestination::Page { page_id, .. } => format!("page:{page_id}"),
        LibraryAgentPageDestination::DataSource { data_source_id, .. } => {
            format!("data_source:{data_source_id}")
        }
    }
}

fn source_parent_key(library_id: &str, source: &LibraryBlockTransferSource) -> String {
    match source {
        LibraryBlockTransferSource::Library { .. } => format!("library:{library_id}"),
        LibraryBlockTransferSource::Page { page_id } => format!("page:{page_id}"),
        LibraryBlockTransferSource::Document { document_id } => {
            format!("document:{document_id}")
        }
        LibraryBlockTransferSource::DataSource { data_source_id } => {
            format!("data_source:{data_source_id}")
        }
    }
}

fn committed_footprint(
    library_id: &str,
    result: &LibraryAgentMovePagesResult,
) -> AgentOperationFootprint {
    let location = result.pages.first().map(|page| &page.location);
    let parent_id = location.map(|location| match location {
        LibraryAgentPageLocation::Library { library_id } => library_id.clone(),
        LibraryAgentPageLocation::Page { page_id } => page_id.clone(),
        LibraryAgentPageLocation::DataSource { data_source_id } => data_source_id.clone(),
    });
    let mut targets = result
        .pages
        .iter()
        .map(|page| AgentResourceTarget {
            kind: AgentResourceKind::Page,
            id: page.page_id.clone(),
        })
        .collect::<Vec<_>>();
    if let Some(location) = location {
        targets.push(match location {
            LibraryAgentPageLocation::Library { .. } => AgentResourceTarget {
                kind: AgentResourceKind::Library,
                id: library_id.to_owned(),
            },
            LibraryAgentPageLocation::Page { page_id } => AgentResourceTarget {
                kind: AgentResourceKind::Page,
                id: page_id.clone(),
            },
            LibraryAgentPageLocation::DataSource { data_source_id } => AgentResourceTarget {
                kind: AgentResourceKind::Database,
                id: data_source_id.clone(),
            },
        });
    }
    AgentOperationFootprint {
        effect_class: AgentEffectClass::Write,
        targets,
        created_roots: Vec::new(),
        updated_roots: result
            .pages
            .iter()
            .map(|page| page.page_id.clone())
            .collect(),
        deleted_roots: Vec::new(),
        deleted_owner_roots: Vec::new(),
        ownership_transformations: result
            .pages
            .iter()
            .map(|page| AgentOwnershipTransformation {
                resource_id: page.page_id.clone(),
                parent_id: parent_id.clone(),
                before_id: None,
            })
            .collect(),
    }
}

fn request_hash(
    context: &BoundModuleContext,
    store_epoch: &str,
    authorization: &AgentExecutionAuthorization,
    request: &LibraryAgentMovePagesRequest,
) -> Result<String, StoreError> {
    hash_serializable(&(
        context,
        LIBRARY_CONTRACT_VERSION,
        store_epoch,
        authorization,
        request,
    ))
}

fn hash_serializable(value: &impl Serialize) -> Result<String, StoreError> {
    serde_json::to_vec(value)
        .map(|bytes| sha256(&bytes))
        .map_err(|_| corrupt("Agent Page-move authority cannot be fingerprinted"))
}

fn validate_id(value: &str, field: &str) -> Result<(), StoreError> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(invalid(format!("{field} is invalid")));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn unauthorized(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn not_found(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn stale_epoch() -> StoreError {
    StoreError::new(
        StoreErrorCode::StaleStoreEpoch,
        "Agent Page move targets a stale store epoch",
        true,
    )
}

fn stale_token() -> StoreError {
    StoreError::new(
        StoreErrorCode::RevisionConflict,
        "Agent Page-move preparation token is missing",
        true,
    )
}

fn reused() -> StoreError {
    StoreError::new(
        StoreErrorCode::IdempotencyKeyReused,
        "operation_id is already bound to another Agent Page move",
        false,
    )
}
