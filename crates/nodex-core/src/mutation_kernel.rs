//! The first structural MutationKernel vertical slice.
//!
//! The kernel is transport-neutral. A future Core module can bind its request
//! contract to these operations, but it must not reimplement the graph and
//! LocalCommit transaction boundary in a Library or Board adapter.

use rusqlite::{OptionalExtension, Transaction};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

use crate::content_store::{ContentSlot, ContentSnapshot, ContentUpdateRequest, append_update};
use crate::domain::block_record::{
    BlockKind, BlockLifecycle, BlockPlacement, BlockRecord, BlockRecordErrorCode,
    BlockViewPosition, PlacementParent, RecordGraph,
};
use crate::infrastructure::block_record_store::{
    archive_block, update_block_record, update_placement, update_placements_atomically,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::local_commit::{
    AppendedLocalCommit, LocalCommitDraft, LocalCommitEffect, find_by_operation,
};

#[derive(Clone, Debug)]
pub struct ContentMutationRequest {
    pub commit: LocalCommitDraft,
    pub content: ContentUpdateRequest,
}

#[derive(Clone, Debug)]
pub struct BlockMutationRequest {
    pub store_epoch: String,
    pub operation_id: String,
    pub intent_hash: String,
    pub commit_id: String,
    pub canonical_hash: String,
    pub actor_id: String,
    pub session_id: String,
    pub committed_at: String,
    pub audience: serde_json::Value,
    pub operation: BlockMutationOperation,
}

#[derive(Clone, Debug)]
pub enum BlockMutationOperation {
    Create {
        block_id: String,
        kind: BlockKind,
        properties: serde_json::Value,
        content_shard_id: String,
        parent: PlacementParent,
        rank_key: String,
        view_id: Option<String>,
        data_source_id: Option<String>,
        view_group_key: Option<String>,
        view_rank_key: Option<String>,
        materialized_json: Option<serde_json::Value>,
        placement_rebalances: Vec<BlockPlacementRebalance>,
        view_rebalances: Vec<BlockViewPositionRebalance>,
    },
    EnsureDataSource {
        data_source_id: String,
    },
    Move {
        block_id: String,
        target_parent: PlacementParent,
        rank_key: String,
        expected_block_revision: u64,
        expected_placement_revision: u64,
    },
    MoveMany {
        entries: Vec<BlockMoveEntry>,
        placement_rebalances: Vec<BlockPlacementRebalance>,
    },
    UpdateRecord {
        block_id: String,
        properties: serde_json::Value,
        expected_block_revision: u64,
        view_id: Option<String>,
        data_source_id: Option<String>,
        view_group_key: Option<String>,
        view_rank_key: Option<String>,
        expected_view_revision: Option<u64>,
    },
    UpdateMany {
        entries: Vec<BlockRecordUpdateEntry>,
        view_rebalances: Vec<BlockViewPositionRebalance>,
    },
    ArchiveSubtree {
        block_id: String,
        expected_block_revision: u64,
        expected_placement_revision: u64,
    },
    PromoteToPage {
        block_id: String,
        data_source_id: String,
        view_id: Option<String>,
        view_group_key: Option<String>,
        view_rank_key: Option<String>,
        rank_key: String,
        expected_block_revision: u64,
        expected_placement_revision: u64,
    },
    PromoteManyToPage {
        data_source_id: String,
        view_id: Option<String>,
        entries: Vec<BlockPromotionEntry>,
        view_rebalances: Vec<BlockViewPositionRebalance>,
        placement_rebalances: Vec<BlockPlacementRebalance>,
    },
    SetMaterializedContent {
        block_id: String,
        slot: ContentSlot,
        materialized_json: serde_json::Value,
        expected_revision: u64,
    },
    ReconcilePageTree {
        page_id: String,
        expected_page_revision: u64,
        nodes: Vec<BlockTreeNode>,
    },
}

#[derive(Clone, Debug)]
pub struct BlockPromotionEntry {
    pub block_id: String,
    pub view_group_key: Option<String>,
    pub view_rank_key: Option<String>,
    pub rank_key: String,
    pub expected_block_revision: u64,
    pub expected_placement_revision: u64,
}

#[derive(Clone, Debug)]
pub struct BlockRecordUpdateEntry {
    pub block_id: String,
    pub properties: serde_json::Value,
    pub expected_block_revision: u64,
    pub view_id: Option<String>,
    pub data_source_id: Option<String>,
    pub view_group_key: Option<String>,
    pub view_rank_key: Option<String>,
    pub expected_view_revision: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct BlockMoveEntry {
    pub block_id: String,
    pub target_parent: PlacementParent,
    pub rank_key: String,
    pub expected_block_revision: u64,
    pub expected_placement_revision: u64,
}

#[derive(Clone, Debug)]
pub struct BlockPlacementRebalance {
    pub block_id: String,
    pub rank_key: String,
    pub expected_revision: u64,
}

#[derive(Clone, Debug)]
pub struct BlockViewPositionRebalance {
    pub block_id: String,
    pub group_key: Option<String>,
    pub rank_key: String,
    pub expected_revision: u64,
}

#[derive(Clone, Debug)]
pub struct BlockTreeNode {
    pub block_id: String,
    pub kind: BlockKind,
    pub properties: serde_json::Value,
    pub content_shard_id: String,
    pub parent_block_id: Option<String>,
    pub rank_key: String,
    pub expected_block_revision: Option<u64>,
    pub expected_placement_revision: Option<u64>,
    pub expected_content_revision: Option<u64>,
    pub materialized_json: serde_json::Value,
}

pub fn apply_block_mutation(
    transaction: &Transaction<'_>,
    graph: &mut RecordGraph,
    request: BlockMutationRequest,
) -> Result<AppendedLocalCommit, StoreError> {
    validate_operation_identity(&request)?;
    if let Some(existing) =
        find_by_operation(transaction, &request.store_epoch, &request.operation_id)?
    {
        if existing.intent_hash != request.intent_hash {
            return Err(StoreError::new(
                StoreErrorCode::IdempotencyKeyReused,
                "Block operation was retried with a different intent hash",
                false,
            ));
        }
        if existing.commit_id != request.commit_id
            || existing.canonical_hash != request.canonical_hash
        {
            return Err(StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Block operation reused a LocalCommit identity with different canonical data",
                false,
            ));
        }
        return Ok(AppendedLocalCommit {
            envelope: existing,
            duplicate: true,
        });
    }

    let previous = graph.clone();
    let (_block_id, mut effects) = match apply_operation(transaction, graph, &request.operation) {
        Ok(result) => result,
        Err(error) => {
            *graph = previous;
            return Err(error);
        }
    };
    let persisted_effects = match persist_delta(
        transaction,
        &previous,
        graph,
        &request.operation,
        &request.committed_at,
        &request.operation_id,
    ) {
        Ok(effects) => effects,
        Err(error) => {
            *graph = previous;
            return Err(error);
        }
    };
    effects.extend(persisted_effects);
    let result = crate::local_commit::append(
        transaction,
        LocalCommitDraft {
            store_epoch: request.store_epoch,
            commit_id: request.commit_id,
            operation_id: request.operation_id,
            intent_hash: request.intent_hash,
            canonical_hash: request.canonical_hash,
            actor_id: request.actor_id,
            session_id: request.session_id,
            committed_at: request.committed_at,
            effects,
            audience: request.audience,
        },
    );
    if result.is_err() {
        *graph = previous;
    }
    result.map(|committed| {
        if !matches!(
            &request.operation,
            BlockMutationOperation::EnsureDataSource { .. }
        ) {
            debug_assert!(
                committed
                    .envelope
                    .effects
                    .iter()
                    .all(|effect| effect.value.get("blockId").is_some())
            );
        }
        committed
    })
}

pub fn apply_content_mutation(
    transaction: &Transaction<'_>,
    request: ContentMutationRequest,
) -> Result<AppendedLocalCommit, StoreError> {
    if request.commit.store_epoch.trim().is_empty() || request.content.shard_id.trim().is_empty() {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Content mutation LocalCommit identity is invalid",
            false,
        ));
    }
    if let Some(existing) = find_by_operation(
        transaction,
        &request.commit.store_epoch,
        &request.commit.operation_id,
    )? {
        if existing.intent_hash != request.commit.intent_hash {
            return Err(StoreError::new(
                StoreErrorCode::IdempotencyKeyReused,
                "Content operation was retried with a different intent hash",
                false,
            ));
        }
        if existing.commit_id != request.commit.commit_id
            || existing.canonical_hash != request.commit.canonical_hash
        {
            return Err(StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Content operation reused a LocalCommit identity with different canonical data",
                false,
            ));
        }
        return Ok(AppendedLocalCommit {
            envelope: existing,
            duplicate: true,
        });
    }

    let content = append_update(transaction, request.content)?;
    if !content.did_change {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Content mutation produced no change",
            false,
        ));
    }
    let mut commit = request.commit;
    commit.effects = vec![LocalCommitEffect {
        kind: "content".to_owned(),
        value: json!({
            "blockId": content.block_id,
            "slot": content.slot,
            "shardId": content.shard_id,
            "head": content.update_seq,
            "stateHash": content.state_hash,
        }),
    }];
    crate::local_commit::append(transaction, commit)
}

fn persist_delta(
    transaction: &Transaction<'_>,
    previous: &RecordGraph,
    next: &RecordGraph,
    operation: &BlockMutationOperation,
    committed_at: &str,
    operation_id: &str,
) -> Result<Vec<LocalCommitEffect>, StoreError> {
    let block_id = match operation {
        BlockMutationOperation::Create { block_id, .. }
        | BlockMutationOperation::Move { block_id, .. }
        | BlockMutationOperation::PromoteToPage { block_id, .. } => block_id,
        BlockMutationOperation::MoveMany { entries, .. } => entries
            .first()
            .map(|entry| entry.block_id.as_str())
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Batch move must contain at least one entry",
                    false,
                )
            })?,
        BlockMutationOperation::UpdateRecord { block_id, .. }
        | BlockMutationOperation::ArchiveSubtree { block_id, .. } => block_id,
        BlockMutationOperation::UpdateMany { entries, .. } => entries
            .first()
            .map(|entry| entry.block_id.as_str())
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Batch record update must contain at least one entry",
                    false,
                )
            })?,
        BlockMutationOperation::PromoteManyToPage { entries, .. } => entries
            .first()
            .map(|entry| entry.block_id.as_str())
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Batch promotion must contain at least one entry",
                    false,
                )
            })?,
        BlockMutationOperation::SetMaterializedContent { block_id, .. } => block_id,
        BlockMutationOperation::ReconcilePageTree { page_id, .. } => page_id,
        BlockMutationOperation::EnsureDataSource { data_source_id } => {
            crate::infrastructure::block_record_store::ensure_data_source(
                transaction,
                data_source_id,
                previous.library_id(),
            )?;
            return Ok(Vec::new());
        }
    };
    if let BlockMutationOperation::Create {
        view_id,
        data_source_id,
        view_group_key,
        view_rank_key,
        materialized_json,
        placement_rebalances,
        view_rebalances,
        ..
    } = operation
    {
        let record = next.block(block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Created BlockRecord is missing from the prepared graph",
                false,
            )
        })?;
        let placement = next.placement(block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Created Block placement is missing from the prepared graph",
                false,
            )
        })?;
        if let PlacementParent::DataSource(data_source_id) = &placement.parent {
            crate::infrastructure::block_record_store::ensure_data_source(
                transaction,
                data_source_id,
                &record.library_id,
            )?;
        }
        crate::content_store::ensure_shard(
            transaction,
            &record.content_shard_id,
            &record.library_id,
            committed_at,
        )?;
        let slot = if matches!(&record.kind, BlockKind::Page) {
            ContentSlot::Title
        } else {
            ContentSlot::Inline
        };
        let snapshot = match materialized_json {
            Some(value) => crate::content_store::materialized_snapshot(
                &record.id,
                slot,
                &record.library_id,
                &record.content_shard_id,
                value,
            )?,
            None => crate::content_store::empty_snapshot(
                &record.id,
                slot,
                &record.library_id,
                &record.content_shard_id,
            )?,
        };
        let placement_changes = placement_rebalances
            .iter()
            .map(|rebalance| {
                let previous_placement =
                    previous.placement(&rebalance.block_id).ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Create placement rebalance source is missing",
                            false,
                        )
                    })?;
                let next_placement = next.placement(&rebalance.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Create placement rebalance target is missing",
                        false,
                    )
                })?;
                Ok((previous_placement.clone(), next_placement.clone()))
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        update_placements_atomically(transaction, &placement_changes)?;
        if let Some(view_id) = view_id {
            let data_source_id = data_source_id.as_deref().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Create View position is missing its Data Source",
                    false,
                )
            })?;
            for (index, rebalance) in view_rebalances.iter().enumerate() {
                let next_revision =
                    rebalance.expected_revision.checked_add(1).ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Create View position revision overflow",
                            false,
                        )
                    })?;
                let changed = transaction.execute(
                    "UPDATE block_record_view_positions
                     SET rank_key = ?1, revision = ?2
                     WHERE view_id = ?3 AND data_source_id = ?4 AND block_id = ?5
                       AND library_id = ?6 AND revision = ?7",
                    rusqlite::params![
                        format!(
                            "__nodex_create_pending__{:08}__{}",
                            index, rebalance.block_id
                        ),
                        i64::try_from(next_revision).map_err(|_| {
                            StoreError::new(
                                StoreErrorCode::StoreCorrupt,
                                "Create View position revision exceeds SQLite range",
                                false,
                            )
                        })?,
                        view_id,
                        data_source_id,
                        rebalance.block_id,
                        record.library_id,
                        i64::try_from(rebalance.expected_revision).map_err(|_| {
                            StoreError::new(
                                StoreErrorCode::StoreCorrupt,
                                "Create View position expected revision exceeds SQLite range",
                                false,
                            )
                        })?,
                    ],
                )?;
                if changed != 1 {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        "Create View position changed while staging its rebalance",
                        true,
                    ));
                }
                let changed = transaction.execute(
                    "UPDATE block_record_view_positions
                     SET group_key = ?1, rank_key = ?2
                     WHERE view_id = ?3 AND data_source_id = ?4 AND block_id = ?5
                       AND library_id = ?6 AND revision = ?7",
                    rusqlite::params![
                        rebalance.group_key.as_deref().unwrap_or(""),
                        rebalance.rank_key,
                        view_id,
                        data_source_id,
                        rebalance.block_id,
                        record.library_id,
                        i64::try_from(next_revision).map_err(|_| {
                            StoreError::new(
                                StoreErrorCode::StoreCorrupt,
                                "Create View position revision exceeds SQLite range",
                                false,
                            )
                        })?,
                    ],
                )?;
                if changed != 1 {
                    return Err(StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Create View position disappeared while publishing its rebalance",
                        false,
                    ));
                }
            }
        }
        crate::infrastructure::block_record_store::insert_block(transaction, record, placement)?;
        crate::content_store::write_snapshot(transaction, &snapshot)?;
        let effects = vec![content_effect(&snapshot)];
        if let Some(view_id) = view_id {
            let data_source_id = data_source_id.as_deref().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Create View position is missing its Data Source",
                    false,
                )
            })?;
            let view_rank_key = view_rank_key.as_deref().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Create View position is missing its rank",
                    false,
                )
            })?;
            crate::infrastructure::block_record_store::upsert_view_position(
                transaction,
                &BlockViewPosition {
                    view_id: view_id.clone(),
                    data_source_id: data_source_id.to_owned(),
                    block_id: record.id.clone(),
                    group_key: view_group_key.clone(),
                    rank_key: view_rank_key.to_owned(),
                    revision: 0,
                },
                &record.library_id,
            )?;
        }
        return Ok(effects);
    }
    if let BlockMutationOperation::UpdateRecord {
        block_id,
        view_id,
        data_source_id,
        view_group_key,
        view_rank_key,
        expected_view_revision,
        ..
    } = operation
    {
        let previous_record = previous.block(block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Updated BlockRecord is missing from the previous graph",
                false,
            )
        })?;
        let next_record = next.block(block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Updated BlockRecord is missing from the prepared graph",
                false,
            )
        })?;
        if previous_record != next_record {
            update_block_record(transaction, previous_record, next_record)?;
        }
        if let Some(view_id) = view_id {
            let data_source_id = data_source_id.as_deref().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Updated View position is missing its Data Source",
                    false,
                )
            })?;
            let view_rank_key = view_rank_key.as_deref().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Updated View position is missing its rank",
                    false,
                )
            })?;
            let revision = validate_view_position_update(
                transaction,
                view_id,
                data_source_id,
                block_id,
                expected_view_revision.as_ref().copied(),
            )?;
            crate::infrastructure::block_record_store::upsert_view_position(
                transaction,
                &BlockViewPosition {
                    view_id: view_id.clone(),
                    data_source_id: data_source_id.to_owned(),
                    block_id: block_id.clone(),
                    group_key: view_group_key.clone(),
                    rank_key: view_rank_key.to_owned(),
                    revision,
                },
                &next_record.library_id,
            )?;
        }
        return Ok(Vec::new());
    }
    if let BlockMutationOperation::UpdateMany {
        entries,
        view_rebalances,
    } = operation
    {
        return persist_batch_record_update(transaction, previous, next, entries, view_rebalances);
    }
    if let BlockMutationOperation::ArchiveSubtree { block_id, .. } = operation {
        let ids = previous.descendant_ids(block_id).map_err(map_graph_error)?;
        for id in ids.iter().rev() {
            let record = previous.block(id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Archived BlockRecord is missing from the previous graph",
                    false,
                )
            })?;
            archive_block(transaction, record)?;
        }
        return Ok(Vec::new());
    }
    if let BlockMutationOperation::SetMaterializedContent {
        block_id,
        slot,
        materialized_json,
        expected_revision,
    } = operation
    {
        let _ = next.block(block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::NotFound,
                "Content BlockRecord is missing",
                false,
            )
        })?;
        let snapshot = crate::content_store::replace_materialized_snapshot(
            transaction,
            block_id,
            slot.clone(),
            *expected_revision,
            materialized_json,
            &format!(
                "{operation_id}:content:{block_id}:{}",
                content_slot_name(slot)
            ),
            committed_at,
        )?;
        return Ok(vec![content_effect(&snapshot)]);
    }
    if let BlockMutationOperation::PromoteManyToPage {
        data_source_id,
        view_id,
        entries,
        view_rebalances,
        placement_rebalances,
    } = operation
    {
        return persist_batch_promotion(
            transaction,
            previous,
            next,
            data_source_id,
            view_id.as_deref(),
            entries,
            view_rebalances,
            placement_rebalances,
            committed_at,
        );
    }
    if let BlockMutationOperation::MoveMany {
        entries,
        placement_rebalances,
    } = operation
    {
        let mut changes = Vec::with_capacity(entries.len() + placement_rebalances.len());
        for entry in entries {
            let previous_placement = previous.placement(&entry.block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Batch move source placement is missing",
                    false,
                )
            })?;
            let next_placement = next.placement(&entry.block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Batch move target placement is missing",
                    false,
                )
            })?;
            if previous_placement != next_placement {
                changes.push((previous_placement.clone(), next_placement.clone()));
            }
        }
        for entry in placement_rebalances {
            let previous_placement = previous.placement(&entry.block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Placement rebalance source is missing",
                    false,
                )
            })?;
            let next_placement = next.placement(&entry.block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Placement rebalance target is missing",
                    false,
                )
            })?;
            if previous_placement != next_placement {
                changes.push((previous_placement.clone(), next_placement.clone()));
            }
        }
        return update_placements_atomically(transaction, &changes).map(|_| Vec::new());
    }
    if let BlockMutationOperation::ReconcilePageTree { page_id, nodes, .. } = operation {
        return persist_reconcile_page_tree(
            transaction,
            previous,
            next,
            page_id,
            nodes,
            committed_at,
            operation_id,
        )
        .map(|_| Vec::new());
    }
    let previous_placement = previous.placement(block_id).ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::StoreCorrupt,
            "Block mutation delta has no previous placement",
            false,
        )
    })?;
    let next_placement = next.placement(block_id).ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::StoreCorrupt,
            "Block mutation delta has no next placement",
            false,
        )
    })?;
    let mut persisted_effects = Vec::new();
    if matches!(operation, BlockMutationOperation::PromoteToPage { .. }) {
        let previous_record = previous.block(block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Promotion delta has no previous BlockRecord",
                false,
            )
        })?;
        let next_record = next.block(block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Promotion delta has no next BlockRecord",
                false,
            )
        })?;
        if let BlockMutationOperation::PromoteToPage { data_source_id, .. } = operation {
            crate::infrastructure::block_record_store::ensure_data_source(
                transaction,
                data_source_id,
                &next_record.library_id,
            )?;
        }
        update_block_record(transaction, previous_record, next_record)?;
        crate::content_store::ensure_shard(
            transaction,
            &next_record.content_shard_id,
            &next_record.library_id,
            committed_at,
        )?;
        let snapshot = crate::content_store::ensure_title_from_inline(transaction, block_id)?;
        persisted_effects.push(content_effect(&snapshot));
    }
    update_placement(transaction, previous_placement, next_placement)?;
    if let BlockMutationOperation::PromoteToPage {
        view_id: Some(view_id),
        view_group_key,
        view_rank_key: Some(view_rank_key),
        data_source_id,
        ..
    } = operation
    {
        let library_id = next
            .block(block_id)
            .map(|record| record.library_id.as_str())
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Promoted BlockRecord library is missing",
                    false,
                )
            })?;
        crate::infrastructure::block_record_store::upsert_view_position(
            transaction,
            &BlockViewPosition {
                view_id: view_id.clone(),
                data_source_id: data_source_id.clone(),
                block_id: block_id.to_owned(),
                group_key: view_group_key.clone(),
                rank_key: view_rank_key.clone(),
                revision: 0,
            },
            library_id,
        )?;
    }
    Ok(persisted_effects)
}

fn persist_batch_record_update(
    transaction: &Transaction<'_>,
    previous: &RecordGraph,
    next: &RecordGraph,
    entries: &[BlockRecordUpdateEntry],
    view_rebalances: &[BlockViewPositionRebalance],
) -> Result<Vec<LocalCommitEffect>, StoreError> {
    let mut view_entries = Vec::new();
    for entry in entries {
        let previous_record = previous.block(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch updated BlockRecord is missing from the previous graph",
                false,
            )
        })?;
        let next_record = next.block(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch updated BlockRecord is missing from the prepared graph",
                false,
            )
        })?;
        if previous_record != next_record {
            update_block_record(transaction, previous_record, next_record)?;
        }
        if entry.view_id.is_some() {
            view_entries.push(entry);
        }
    }

    let Some(first_view_entry) = view_entries.first() else {
        if !view_rebalances.is_empty() {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Batch View rebalances require View entries",
                false,
            ));
        }
        return Ok(Vec::new());
    };
    let view_id = first_view_entry
        .view_id
        .as_deref()
        .expect("validated View id");
    let library_id = next.library_id();

    // Vacate every position participating in the batch before installing the
    // final ranks. This makes a reorder atomic even when a final rank is
    // currently occupied by another entry in the same commit.
    let mut staged = BTreeSet::new();
    for entry in &view_entries {
        staged.insert(entry.block_id.as_str());
    }
    for rebalance in view_rebalances {
        staged.insert(rebalance.block_id.as_str());
    }
    for block_id in staged {
        let current_rank: Option<String> = transaction
            .query_row(
                "SELECT rank_key FROM block_record_view_positions
                 WHERE view_id = ?1 AND block_id = ?2 AND library_id = ?3",
                rusqlite::params![view_id, block_id, library_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(current_rank) = current_rank {
            transaction.execute(
                "UPDATE block_record_view_positions
                 SET rank_key = ?1
                 WHERE view_id = ?2 AND block_id = ?3 AND library_id = ?4",
                rusqlite::params![
                    format!("{}~update~{}", current_rank, block_id),
                    view_id,
                    block_id,
                    library_id,
                ],
            )?;
        }
    }
    for rebalance in view_rebalances {
        let revision = rebalance.expected_revision.checked_add(1).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "View position revision overflow",
                false,
            )
        })?;
        let changed = transaction.execute(
            "UPDATE block_record_view_positions
             SET group_key = ?1, rank_key = ?2, revision = ?3
             WHERE view_id = ?4 AND block_id = ?5 AND library_id = ?6",
            rusqlite::params![
                rebalance.group_key.as_deref().unwrap_or(""),
                rebalance.rank_key,
                i64::try_from(revision).map_err(|_| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "View position revision exceeds SQLite range",
                        false,
                    )
                })?,
                view_id,
                rebalance.block_id,
                library_id,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch View rebalance disappeared while persisting",
                false,
            ));
        }
    }
    for entry in view_entries {
        let record = next.block(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch View record is missing",
                false,
            )
        })?;
        let view_id = entry.view_id.as_deref().expect("validated View id");
        let data_source_id = entry
            .data_source_id
            .as_deref()
            .expect("validated Data Source id");
        let rank_key = entry.view_rank_key.as_deref().expect("validated View rank");
        let revision = entry.expected_view_revision.map_or(0, |value| {
            value.checked_add(1).expect("validated View revision")
        });
        crate::infrastructure::block_record_store::upsert_view_position(
            transaction,
            &BlockViewPosition {
                view_id: view_id.to_owned(),
                data_source_id: data_source_id.to_owned(),
                block_id: entry.block_id.clone(),
                group_key: entry.view_group_key.clone(),
                rank_key: rank_key.to_owned(),
                revision,
            },
            &record.library_id,
        )?;
    }
    Ok(Vec::new())
}

fn persist_batch_promotion(
    transaction: &Transaction<'_>,
    previous: &RecordGraph,
    next: &RecordGraph,
    data_source_id: &str,
    view_id: Option<&str>,
    entries: &[BlockPromotionEntry],
    view_rebalances: &[BlockViewPositionRebalance],
    placement_rebalances: &[BlockPlacementRebalance],
    committed_at: &str,
) -> Result<Vec<LocalCommitEffect>, StoreError> {
    if entries.is_empty() {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Batch promotion must contain at least one entry",
            false,
        ));
    }
    crate::infrastructure::block_record_store::ensure_data_source(
        transaction,
        data_source_id,
        next.library_id(),
    )?;
    let mut block_ids = std::collections::BTreeSet::new();
    let mut persisted_effects = Vec::with_capacity(entries.len());
    let mut placement_changes = Vec::with_capacity(entries.len() + placement_rebalances.len());
    for entry in entries {
        if !block_ids.insert(entry.block_id.as_str()) {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Batch promotion contains a duplicate Block id",
                false,
            ));
        }
        let previous_record = previous.block(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch promotion source record is missing",
                false,
            )
        })?;
        let next_record = next.block(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch promotion target record is missing",
                false,
            )
        })?;
        let previous_placement = previous.placement(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch promotion source placement is missing",
                false,
            )
        })?;
        let next_placement = next.placement(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch promotion target placement is missing",
                false,
            )
        })?;
        update_block_record(transaction, previous_record, next_record)?;
        crate::content_store::ensure_shard(
            transaction,
            &next_record.content_shard_id,
            &next_record.library_id,
            committed_at,
        )?;
        let snapshot =
            crate::content_store::ensure_title_from_inline(transaction, &entry.block_id)?;
        persisted_effects.push(content_effect(&snapshot));
        placement_changes.push((previous_placement.clone(), next_placement.clone()));
    }
    for rebalance in placement_rebalances {
        if !block_ids.insert(rebalance.block_id.as_str()) {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Placement rebalance repeats a promoted Block id",
                false,
            ));
        }
        let previous_placement = previous.placement(&rebalance.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Placement rebalance source is missing",
                false,
            )
        })?;
        let next_placement = next.placement(&rebalance.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Placement rebalance target is missing",
                false,
            )
        })?;
        placement_changes.push((previous_placement.clone(), next_placement.clone()));
    }
    update_placements_atomically(transaction, &placement_changes)?;

    let Some(view_id) = view_id else {
        if entries.iter().any(|entry| entry.view_rank_key.is_some()) || !view_rebalances.is_empty()
        {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Batch promotion View data requires a View id",
                false,
            ));
        }
        return Ok(persisted_effects);
    };
    if entries.iter().any(|entry| entry.view_rank_key.is_none()) {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Batch promotion View data is incomplete",
            false,
        ));
    }
    let library_id = next.library_id();

    // Move every old position out of the way first. This makes a rebalance
    // atomic even when a final rank is currently occupied by another sibling.
    for rebalance in view_rebalances {
        let (stored_data_source, stored_group, stored_rank, stored_revision) = transaction
            .query_row(
                "SELECT data_source_id, group_key, rank_key, revision
                 FROM block_record_view_positions
                 WHERE view_id = ?1 AND block_id = ?2 AND library_id = ?3",
                rusqlite::params![view_id, rebalance.block_id, library_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    "View rebalance position is missing",
                    true,
                )
            })?;
        let stored_group = (!stored_group.is_empty()).then_some(stored_group);
        if stored_data_source != data_source_id
            || stored_group.as_deref() != rebalance.group_key.as_deref()
            || u64::try_from(stored_revision).unwrap_or(u64::MAX) != rebalance.expected_revision
        {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                "View rebalance precondition does not match the canonical position",
                true,
            ));
        }
        transaction.execute(
            "UPDATE block_record_view_positions
             SET rank_key = ?1
             WHERE view_id = ?2 AND block_id = ?3 AND library_id = ?4",
            rusqlite::params![
                format!("{}~rebalance~{}", stored_rank, rebalance.block_id),
                view_id,
                rebalance.block_id,
                library_id,
            ],
        )?;
    }
    for rebalance in view_rebalances {
        let revision = rebalance.expected_revision.checked_add(1).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "View position revision overflow",
                false,
            )
        })?;
        transaction.execute(
            "UPDATE block_record_view_positions
             SET group_key = ?1, rank_key = ?2, revision = ?3
             WHERE view_id = ?4 AND block_id = ?5 AND library_id = ?6",
            rusqlite::params![
                rebalance.group_key.as_deref().unwrap_or(""),
                rebalance.rank_key,
                i64::try_from(revision).map_err(|_| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "View position revision exceeds SQLite range",
                        false,
                    )
                })?,
                view_id,
                rebalance.block_id,
                library_id,
            ],
        )?;
    }
    for entry in entries {
        let record = next.block(&entry.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Batch promotion View record is missing",
                false,
            )
        })?;
        crate::infrastructure::block_record_store::upsert_view_position(
            transaction,
            &BlockViewPosition {
                view_id: view_id.to_owned(),
                data_source_id: data_source_id.to_owned(),
                block_id: entry.block_id.clone(),
                group_key: entry.view_group_key.clone(),
                rank_key: entry
                    .view_rank_key
                    .clone()
                    .expect("validated batch View rank"),
                revision: 0,
            },
            &record.library_id,
        )?;
    }
    Ok(persisted_effects)
}

fn persist_reconcile_page_tree(
    transaction: &Transaction<'_>,
    previous: &RecordGraph,
    next: &RecordGraph,
    page_id: &str,
    nodes: &[BlockTreeNode],
    committed_at: &str,
    operation_id: &str,
) -> Result<(), StoreError> {
    let previous_descendants = previous.descendant_ids(page_id).map_err(map_graph_error)?;
    let next_ids = nodes
        .iter()
        .map(|node| node.block_id.as_str())
        .collect::<BTreeSet<_>>();

    // Content shards are created before BlockRecord rows so every subsequent
    // content snapshot sees a validated shard/library identity.
    for node in nodes {
        if previous.block(&node.block_id).is_none() {
            crate::content_store::ensure_shard(
                transaction,
                &node.content_shard_id,
                next.library_id(),
                committed_at,
            )?;
        }
    }

    // Release omitted live placements before applying new sibling ranks. An
    // archived subtree keeps its content/history rows, but its ownership edge
    // is no longer part of the live forest and must not occupy a rank.
    for previous_id in &previous_descendants {
        if *previous_id == page_id || next_ids.contains(previous_id.as_str()) {
            continue;
        }
        let record = previous.block(previous_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Archived Page tree record is missing",
                false,
            )
        })?;
        archive_block(transaction, record)?;
    }

    // Insert new records first. Placements are installed after all existing
    // placement changes have been staged, so an editor reorder can swap ranks
    // with a new sibling without tripping SQLite's UNIQUE constraint.
    for node in nodes {
        if previous.block(&node.block_id).is_some() {
            continue;
        }
        let record = next.block(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "New Page tree record is missing",
                false,
            )
        })?;
        crate::infrastructure::block_record_store::insert_record(transaction, record)?;
    }
    let mut placement_changes = Vec::new();
    for node in nodes {
        let Some(previous_record) = previous.block(&node.block_id) else {
            continue;
        };
        let next_record = next.block(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Page tree record disappeared",
                false,
            )
        })?;
        if previous_record != next_record {
            update_block_record(transaction, previous_record, next_record)?;
        }
        let previous_placement = previous.placement(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Page tree source placement is missing",
                false,
            )
        })?;
        let next_placement = next.placement(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Page tree target placement is missing",
                false,
            )
        })?;
        if previous_placement != next_placement {
            placement_changes.push((previous_placement.clone(), next_placement.clone()));
        }
        if previous_record.kind != next_record.kind {
            if matches!(next_record.kind, BlockKind::Page) {
                crate::content_store::ensure_title_from_inline(transaction, &node.block_id)?;
            } else {
                crate::content_store::ensure_inline_from_title(transaction, &node.block_id)?;
            }
        }
    }
    update_placements_atomically(transaction, &placement_changes)?;
    for node in nodes {
        if previous.placement(&node.block_id).is_some() {
            continue;
        }
        let placement = next.placement(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "New Page tree placement is missing",
                false,
            )
        })?;
        crate::infrastructure::block_record_store::insert_placement(transaction, placement)?;
    }

    let node_ids = nodes
        .iter()
        .map(|node| node.block_id.as_str())
        .collect::<Vec<_>>();
    let content =
        crate::content_store::read_window(transaction, next.library_id(), Some(&node_ids))?;
    let content_by_key = content
        .records
        .into_iter()
        .map(|record| {
            (
                (
                    record.block_id.clone(),
                    content_slot_name(&record.slot).to_owned(),
                ),
                record,
            )
        })
        .collect::<BTreeMap<_, _>>();
    for node in nodes {
        let record = next.block(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Page tree content record is missing",
                false,
            )
        })?;
        let slot = content_slot_for_kind(&record.kind);
        let slot_name = content_slot_name(&slot).to_owned();
        let current = content_by_key.get(&(node.block_id.clone(), slot_name.clone()));
        if previous.block(&node.block_id).is_none() {
            if current.is_some() {
                return Err(StoreError::new(
                    StoreErrorCode::Conflict,
                    "New Page tree Block identity already has content",
                    false,
                ));
            }
            let snapshot = crate::content_store::materialized_snapshot(
                &node.block_id,
                slot,
                &record.library_id,
                &record.content_shard_id,
                &node.materialized_json,
            )?;
            crate::content_store::write_snapshot(transaction, &snapshot)?;
            continue;
        }
        let current = current.ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::NotFound,
                format!(
                    "Page tree content slot {}:{} is missing",
                    node.block_id, slot_name
                ),
                false,
            )
        })?;
        if current.materialized_json.as_ref() == Some(&node.materialized_json) {
            continue;
        }
        crate::content_store::replace_materialized_snapshot(
            transaction,
            &node.block_id,
            slot,
            current.revision,
            &node.materialized_json,
            &format!("{operation_id}:content:{}:{}", node.block_id, slot_name),
            committed_at,
        )?;
    }

    Ok(())
}

fn apply_operation(
    transaction: &Transaction<'_>,
    graph: &mut RecordGraph,
    operation: &BlockMutationOperation,
) -> Result<(String, Vec<LocalCommitEffect>), StoreError> {
    match operation {
        BlockMutationOperation::Create {
            block_id,
            kind,
            properties,
            content_shard_id,
            parent,
            rank_key,
            view_id,
            data_source_id,
            view_group_key,
            view_rank_key,
            materialized_json: _,
            placement_rebalances,
            view_rebalances,
        } => {
            if view_id.is_none()
                && (data_source_id.is_some()
                    || view_group_key.is_some()
                    || view_rank_key.is_some()
                    || !view_rebalances.is_empty())
            {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Create View fields require a View id",
                    false,
                ));
            }
            if view_id.is_some() && (data_source_id.is_none() || view_rank_key.is_none()) {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Create View requires a Data Source and rank",
                    false,
                ));
            }
            let mut placement_ids = BTreeSet::new();
            let mut placement_changes = Vec::with_capacity(placement_rebalances.len());
            for rebalance in placement_rebalances {
                if rebalance.block_id == *block_id || !placement_ids.insert(&rebalance.block_id) {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Create placement rebalances contain a duplicate or created Block id",
                        false,
                    ));
                }
                if rebalance.rank_key.trim().is_empty() {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Create placement rebalance rank is empty",
                        false,
                    ));
                }
                let placement = graph.placement(&rebalance.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::NotFound,
                        "Create placement rebalance Block is missing",
                        false,
                    )
                })?;
                if placement.revision != rebalance.expected_revision {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        "Create placement rebalance is stale",
                        true,
                    ));
                }
                placement_changes.push(crate::domain::block_record::PlacementChange {
                    block_id: rebalance.block_id.clone(),
                    parent: placement.parent.clone(),
                    rank_key: rebalance.rank_key.clone(),
                });
            }
            let placement_deltas = if placement_changes.is_empty() {
                Vec::new()
            } else {
                graph
                    .apply_placement_changes(&placement_changes)
                    .map_err(map_graph_error)?
            };
            let record = BlockRecord {
                id: block_id.clone(),
                library_id: graph.library_id().to_owned(),
                kind: kind.clone(),
                lifecycle: BlockLifecycle::Active,
                properties: properties.clone(),
                content_shard_id: content_shard_id.clone(),
                revision: 0,
            };
            let placement = BlockPlacement {
                block_id: block_id.clone(),
                parent: parent.clone(),
                rank_key: rank_key.clone(),
                revision: 0,
            };
            let mut view_rebalance_revisions = Vec::with_capacity(view_rebalances.len());
            if let Some(view_id) = view_id {
                let data_source_id = data_source_id.as_deref().expect("validated Data Source");
                let _view_rank_key = view_rank_key.as_deref().expect("validated View rank");
                if placement.parent != PlacementParent::DataSource(data_source_id.to_owned())
                    || !matches!(&record.kind, BlockKind::Page)
                {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Create View position requires a Page in its Data Source",
                        false,
                    ));
                }
                let mut view_ids = BTreeSet::new();
                for rebalance in view_rebalances {
                    if rebalance.block_id == *block_id || !view_ids.insert(&rebalance.block_id) {
                        return Err(StoreError::new(
                            StoreErrorCode::InvalidInput,
                            "Create View rebalances contain a duplicate or created Block id",
                            false,
                        ));
                    }
                    if rebalance.rank_key.trim().is_empty() {
                        return Err(StoreError::new(
                            StoreErrorCode::InvalidInput,
                            "Create View rebalance rank is empty",
                            false,
                        ));
                    }
                    let (stored_data_source, stored_group, stored_revision): (String, String, i64) =
                        transaction
                            .query_row(
                                "SELECT data_source_id, group_key, revision
                                 FROM block_record_view_positions
                                 WHERE view_id = ?1 AND block_id = ?2 AND library_id = ?3",
                                rusqlite::params![view_id, rebalance.block_id, graph.library_id()],
                                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                            )
                            .optional()?
                            .ok_or_else(|| {
                                StoreError::new(
                                    StoreErrorCode::NotFound,
                                    "Create View rebalance position is missing",
                                    false,
                                )
                            })?;
                    let stored_group = (!stored_group.is_empty()).then_some(stored_group);
                    let stored_revision = u64::try_from(stored_revision).map_err(|_| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Create View rebalance revision is invalid",
                            false,
                        )
                    })?;
                    if stored_data_source != data_source_id
                        || stored_group.as_deref() != rebalance.group_key.as_deref()
                        || stored_revision != rebalance.expected_revision
                    {
                        return Err(StoreError::new(
                            StoreErrorCode::RevisionConflict,
                            "Create View rebalance precondition is stale",
                            true,
                        ));
                    }
                    view_rebalance_revisions.push(
                        rebalance.expected_revision.checked_add(1).ok_or_else(|| {
                            StoreError::new(
                                StoreErrorCode::StoreCorrupt,
                                "Create View rebalance revision overflow",
                                false,
                            )
                        })?,
                    );
                }
            }
            graph
                .insert(record.clone(), placement.clone())
                .map_err(map_graph_error)?;
            let mut effects =
                Vec::with_capacity(placement_deltas.len() * 2 + view_rebalances.len() + 3);
            for (previous, next) in placement_deltas {
                let record = graph.block(&next.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Create placement rebalance record disappeared",
                        false,
                    )
                })?;
                effects.push(record_effect(record));
                effects.push(LocalCommitEffect {
                    kind: "placement".to_owned(),
                    value: json!({
                        "blockId": next.block_id,
                        "from": previous.parent,
                        "to": next.parent,
                        "rankKey": next.rank_key,
                        "revision": next.revision,
                    }),
                });
            }
            effects.extend([
                record_effect(&record),
                LocalCommitEffect {
                    kind: "placement".to_owned(),
                    value: json!({
                        "blockId": placement.block_id,
                        "from": null,
                        "to": placement.parent,
                        "rankKey": placement.rank_key,
                        "revision": placement.revision,
                    }),
                },
            ]);
            if let Some(view_id) = view_id {
                let data_source_id = data_source_id.as_deref().expect("validated Data Source");
                for (rebalance, revision) in view_rebalances.iter().zip(view_rebalance_revisions) {
                    effects.push(LocalCommitEffect {
                        kind: "view_position".to_owned(),
                        value: json!({
                            "viewId": view_id,
                            "dataSourceId": data_source_id,
                            "blockId": rebalance.block_id,
                            "groupKey": rebalance.group_key,
                            "rankKey": rebalance.rank_key,
                            "revision": revision,
                        }),
                    });
                }
            }
            if let Some(view_id) = view_id {
                let data_source_id = data_source_id.as_deref().ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Create View position is missing its Data Source",
                        false,
                    )
                })?;
                let view_rank_key = view_rank_key.as_deref().ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Create View position is missing its rank",
                        false,
                    )
                })?;
                if placement.parent != PlacementParent::DataSource(data_source_id.to_owned())
                    || !matches!(&record.kind, BlockKind::Page)
                {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Create View position requires a Page in its Data Source",
                        false,
                    ));
                }
                effects.push(LocalCommitEffect {
                    kind: "view_position".to_owned(),
                    value: json!({
                        "viewId": view_id,
                        "dataSourceId": data_source_id,
                        "blockId": block_id,
                        "groupKey": view_group_key,
                        "rankKey": view_rank_key,
                        "revision": 0,
                    }),
                });
            }
            Ok((block_id.clone(), effects))
        }
        BlockMutationOperation::EnsureDataSource { data_source_id } => {
            if data_source_id.trim().is_empty() {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "BlockRecord Data Source identity is invalid",
                    false,
                ));
            }
            Ok((
                data_source_id.clone(),
                vec![LocalCommitEffect {
                    kind: "data_source".to_owned(),
                    value: json!({ "dataSourceId": data_source_id }),
                }],
            ))
        }
        BlockMutationOperation::Move {
            block_id,
            target_parent,
            rank_key,
            expected_block_revision,
            expected_placement_revision,
        } => {
            validate_revisions(
                graph,
                block_id,
                *expected_block_revision,
                *expected_placement_revision,
            )?;
            let previous = graph.placement(block_id).cloned().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::NotFound,
                    "Block placement is missing",
                    false,
                )
            })?;
            graph
                .move_block(block_id, target_parent.clone(), rank_key.clone())
                .map_err(map_graph_error)?;
            let next = graph.placement(block_id).cloned().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Moved Block placement disappeared",
                    false,
                )
            })?;
            let next_record = graph.block(block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Moved BlockRecord disappeared",
                    false,
                )
            })?;
            Ok((
                block_id.clone(),
                vec![
                    record_effect(next_record),
                    LocalCommitEffect {
                        kind: "placement".to_owned(),
                        value: json!({
                            "blockId": block_id,
                            "from": previous.parent,
                            "to": next.parent,
                            "rankKey": next.rank_key,
                            "revision": next.revision,
                        }),
                    },
                ],
            ))
        }
        BlockMutationOperation::MoveMany {
            entries,
            placement_rebalances,
        } => {
            if entries.is_empty() {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Batch move must contain at least one entry",
                    false,
                ));
            }
            let mut seen = BTreeSet::new();
            let mut changes = Vec::with_capacity(entries.len() + placement_rebalances.len());
            for entry in entries {
                if !seen.insert(entry.block_id.clone()) {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch move contains a duplicate Block id",
                        false,
                    ));
                }
                validate_revisions(
                    graph,
                    &entry.block_id,
                    entry.expected_block_revision,
                    entry.expected_placement_revision,
                )?;
                changes.push(crate::domain::block_record::PlacementChange {
                    block_id: entry.block_id.clone(),
                    parent: entry.target_parent.clone(),
                    rank_key: entry.rank_key.clone(),
                });
            }
            for rebalance in placement_rebalances {
                if !seen.insert(rebalance.block_id.clone()) {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch move rebalance repeats a Block id",
                        false,
                    ));
                }
                let placement = graph.placement(&rebalance.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::NotFound,
                        "Placement rebalance Block is missing",
                        false,
                    )
                })?;
                if placement.revision != rebalance.expected_revision {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        "Placement rebalance precondition is stale",
                        true,
                    ));
                }
                changes.push(crate::domain::block_record::PlacementChange {
                    block_id: rebalance.block_id.clone(),
                    parent: placement.parent.clone(),
                    rank_key: rebalance.rank_key.clone(),
                });
            }
            let before = graph.clone();
            graph
                .apply_placement_changes(&changes)
                .map_err(map_graph_error)?;
            let mut effects = Vec::with_capacity(changes.len() * 2);
            for change in changes {
                let previous = before.placement(&change.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Batch move previous placement disappeared",
                        false,
                    )
                })?;
                let next = graph.placement(&change.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Batch move next placement disappeared",
                        false,
                    )
                })?;
                let record = graph.block(&change.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Batch move BlockRecord disappeared",
                        false,
                    )
                })?;
                effects.push(record_effect(record));
                effects.push(LocalCommitEffect {
                    kind: "placement".to_owned(),
                    value: json!({
                        "blockId": change.block_id,
                        "from": previous.parent,
                        "to": next.parent,
                        "rankKey": next.rank_key,
                        "revision": next.revision,
                    }),
                });
            }
            Ok((
                entries
                    .first()
                    .map(|entry| entry.block_id.clone())
                    .expect("validated non-empty batch"),
                effects,
            ))
        }
        BlockMutationOperation::UpdateRecord {
            block_id,
            properties,
            expected_block_revision,
            view_id,
            data_source_id,
            view_group_key,
            view_rank_key,
            expected_view_revision,
        } => {
            let current = graph.block(block_id).cloned().ok_or_else(|| {
                StoreError::new(StoreErrorCode::NotFound, "BlockRecord is missing", false)
            })?;
            if current.revision != *expected_block_revision {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    "BlockRecord update precondition is stale",
                    true,
                ));
            }
            if view_id.is_none()
                && (data_source_id.is_some()
                    || view_rank_key.is_some()
                    || expected_view_revision.is_some())
            {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "View update fields require a View id",
                    false,
                ));
            }
            if view_id.is_some() && (data_source_id.is_none() || view_rank_key.is_none()) {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "View update requires a Data Source and rank",
                    false,
                ));
            }
            let record_changed = current.properties != properties.clone();
            if !record_changed && view_id.is_none() {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "BlockRecord update contains no change",
                    false,
                ));
            }
            if record_changed {
                graph
                    .update_block(block_id, current.kind.clone(), properties.clone())
                    .map_err(map_graph_error)?;
            }
            let next_record = graph.block(block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Updated BlockRecord disappeared",
                    false,
                )
            })?;
            let mut effects = if record_changed {
                vec![record_effect(next_record)]
            } else {
                Vec::new()
            };
            if let Some(view_id) = view_id {
                let data_source_id = data_source_id.as_deref().expect("validated Data Source");
                let view_rank_key = view_rank_key.as_deref().expect("validated View rank");
                let revision = validate_view_position_update(
                    transaction,
                    view_id,
                    data_source_id,
                    block_id,
                    *expected_view_revision,
                )?;
                effects.push(LocalCommitEffect {
                    kind: "view_position".to_owned(),
                    value: json!({
                        "viewId": view_id,
                        "dataSourceId": data_source_id,
                        "blockId": block_id,
                        "groupKey": view_group_key,
                        "rankKey": view_rank_key,
                        "revision": revision,
                    }),
                });
            }
            Ok((block_id.clone(), effects))
        }
        BlockMutationOperation::UpdateMany {
            entries,
            view_rebalances,
        } => {
            if entries.is_empty() {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Batch record update must contain at least one entry",
                    false,
                ));
            }
            let mut seen = BTreeSet::new();
            let mut shared_view: Option<(String, String)> = None;
            let mut effects = Vec::with_capacity(entries.len() * 2 + view_rebalances.len());
            for entry in entries {
                if !seen.insert(entry.block_id.clone()) {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch record update contains a duplicate Block id",
                        false,
                    ));
                }
                let current = graph.block(&entry.block_id).cloned().ok_or_else(|| {
                    StoreError::new(StoreErrorCode::NotFound, "BlockRecord is missing", false)
                })?;
                if current.revision != entry.expected_block_revision {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        "Batch BlockRecord update precondition is stale",
                        true,
                    ));
                }
                let has_other_view_field = entry.data_source_id.is_some()
                    || entry.view_group_key.is_some()
                    || entry.view_rank_key.is_some()
                    || entry.expected_view_revision.is_some();
                if entry.view_id.is_none() && has_other_view_field {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch View update fields require a View id",
                        false,
                    ));
                }
                if entry.view_id.is_some()
                    && (entry.data_source_id.is_none() || entry.view_rank_key.is_none())
                {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch View update requires a Data Source and rank",
                        false,
                    ));
                }
                let record_changed = current.properties != entry.properties;
                if !record_changed && entry.view_id.is_none() {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch BlockRecord update contains no change",
                        false,
                    ));
                }
                if record_changed {
                    graph
                        .update_block(
                            &entry.block_id,
                            current.kind.clone(),
                            entry.properties.clone(),
                        )
                        .map_err(map_graph_error)?;
                    let next = graph.block(&entry.block_id).ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Batch updated BlockRecord disappeared",
                            false,
                        )
                    })?;
                    effects.push(record_effect(next));
                }
                if let Some(view_id) = entry.view_id.as_deref() {
                    let data_source_id = entry
                        .data_source_id
                        .as_deref()
                        .expect("validated Data Source");
                    let view_rank_key =
                        entry.view_rank_key.as_deref().expect("validated View rank");
                    if view_rank_key.trim().is_empty() {
                        return Err(StoreError::new(
                            StoreErrorCode::InvalidInput,
                            "Batch View rank is invalid",
                            false,
                        ));
                    }
                    let view_identity = (view_id.to_owned(), data_source_id.to_owned());
                    if let Some(shared) = &shared_view {
                        if shared != &view_identity {
                            return Err(StoreError::new(
                                StoreErrorCode::InvalidInput,
                                "Batch View update must target one View and Data Source",
                                false,
                            ));
                        }
                    } else {
                        shared_view = Some(view_identity);
                    }
                    let revision = validate_view_position_update(
                        transaction,
                        view_id,
                        data_source_id,
                        &entry.block_id,
                        entry.expected_view_revision,
                    )?;
                    effects.push(LocalCommitEffect {
                        kind: "view_position".to_owned(),
                        value: json!({
                            "viewId": view_id,
                            "dataSourceId": data_source_id,
                            "blockId": entry.block_id,
                            "groupKey": entry.view_group_key,
                            "rankKey": view_rank_key,
                            "revision": revision,
                        }),
                    });
                }
            }
            if !view_rebalances.is_empty() {
                let Some((view_id, data_source_id)) = shared_view.as_ref() else {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch View rebalances require View entries",
                        false,
                    ));
                };
                for rebalance in view_rebalances {
                    if !seen.insert(rebalance.block_id.clone()) {
                        return Err(StoreError::new(
                            StoreErrorCode::InvalidInput,
                            "Batch View rebalance repeats a Block id",
                            false,
                        ));
                    }
                    if rebalance.rank_key.trim().is_empty() {
                        return Err(StoreError::new(
                            StoreErrorCode::InvalidInput,
                            "Batch View rebalance rank is invalid",
                            false,
                        ));
                    }
                    let revision = validate_view_position_update(
                        transaction,
                        view_id,
                        data_source_id,
                        &rebalance.block_id,
                        Some(rebalance.expected_revision),
                    )?;
                    effects.push(LocalCommitEffect {
                        kind: "view_position".to_owned(),
                        value: json!({
                            "viewId": view_id,
                            "dataSourceId": data_source_id,
                            "blockId": rebalance.block_id,
                            "groupKey": rebalance.group_key,
                            "rankKey": rebalance.rank_key,
                            "revision": revision,
                        }),
                    });
                }
            }
            Ok((
                entries
                    .first()
                    .map(|entry| entry.block_id.clone())
                    .expect("validated non-empty batch"),
                effects,
            ))
        }
        BlockMutationOperation::ArchiveSubtree {
            block_id,
            expected_block_revision,
            expected_placement_revision,
        } => {
            validate_revisions(
                graph,
                block_id,
                *expected_block_revision,
                *expected_placement_revision,
            )?;
            let removed = graph.remove_subtree(block_id).map_err(map_graph_error)?;
            let mut effects = Vec::with_capacity(removed.len() * 2);
            for record in removed {
                let archived_revision = record.revision.checked_add(1).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Archived BlockRecord revision overflow",
                        false,
                    )
                })?;
                effects.push(LocalCommitEffect {
                    kind: "record".to_owned(),
                    value: json!({
                        "blockId": record.id,
                        "libraryId": record.library_id,
                        "kind": record.kind,
                        "lifecycle": "archived",
                        "properties": record.properties,
                        "contentShardId": record.content_shard_id,
                        "revision": archived_revision,
                    }),
                });
                effects.push(LocalCommitEffect {
                    kind: "remove".to_owned(),
                    value: json!({
                        "blockId": record.id,
                        "lifecycle": "archived",
                        "revision": archived_revision,
                    }),
                });
            }
            Ok((block_id.clone(), effects))
        }
        BlockMutationOperation::PromoteToPage {
            block_id,
            data_source_id,
            view_id,
            view_group_key,
            view_rank_key,
            rank_key,
            expected_block_revision,
            expected_placement_revision,
        } => {
            validate_revisions(
                graph,
                block_id,
                *expected_block_revision,
                *expected_placement_revision,
            )?;
            let previous_kind = graph
                .block(block_id)
                .map(|record| record.kind.clone())
                .ok_or_else(|| {
                    StoreError::new(StoreErrorCode::NotFound, "BlockRecord is missing", false)
                })?;
            let previous = graph.placement(block_id).cloned().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::NotFound,
                    "Block placement is missing",
                    false,
                )
            })?;
            graph
                .promote_to_page(block_id, data_source_id.clone(), rank_key.clone())
                .map_err(map_graph_error)?;
            let next_record = graph.block(block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Promoted BlockRecord disappeared",
                    false,
                )
            })?;
            let next = graph.placement(block_id).cloned().ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Promoted placement disappeared",
                    false,
                )
            })?;
            let mut effects = vec![LocalCommitEffect {
                kind: "promotion".to_owned(),
                value: json!({
                    "blockId": block_id,
                    "fromKind": previous_kind,
                    "toKind": BlockKind::Page,
                    "from": previous.parent,
                    "to": next.parent,
                    "rankKey": next.rank_key,
                    "blockRevision": next_record.revision,
                    "placementRevision": next.revision,
                    "libraryId": next_record.library_id,
                    "properties": next_record.properties,
                    "contentShardId": next_record.content_shard_id,
                }),
            }];
            if let Some(view_id) = view_id {
                let view_rank_key = view_rank_key.as_ref().ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Promote View position is missing its rank key",
                        false,
                    )
                })?;
                effects.push(LocalCommitEffect {
                    kind: "view_position".to_owned(),
                    value: json!({
                        "viewId": view_id,
                        "dataSourceId": data_source_id,
                        "blockId": block_id,
                        "groupKey": view_group_key,
                        "rankKey": view_rank_key,
                        "revision": 0,
                    }),
                });
            }
            Ok((block_id.clone(), effects))
        }
        BlockMutationOperation::PromoteManyToPage {
            data_source_id,
            view_id,
            entries,
            view_rebalances,
            placement_rebalances,
        } => {
            if data_source_id.trim().is_empty() || entries.is_empty() {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Batch promotion identity or entries are invalid",
                    false,
                ));
            }
            if view_id.is_none()
                && (entries.iter().any(|entry| entry.view_rank_key.is_some())
                    || !view_rebalances.is_empty())
            {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Batch promotion View data requires a View id",
                    false,
                ));
            }
            let mut block_ids = std::collections::BTreeSet::new();
            let before_rebalances = graph.clone();
            let mut placement_changes = Vec::with_capacity(placement_rebalances.len());
            for rebalance in placement_rebalances {
                if !block_ids.insert(rebalance.block_id.as_str()) {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch promotion placement rebalance repeats a Block id",
                        false,
                    ));
                }
                let placement = graph.placement(&rebalance.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::NotFound,
                        "Batch promotion placement rebalance Block is missing",
                        false,
                    )
                })?;
                if placement.revision != rebalance.expected_revision {
                    return Err(StoreError::new(
                        StoreErrorCode::RevisionConflict,
                        "Batch promotion placement rebalance is stale",
                        true,
                    ));
                }
                placement_changes.push(crate::domain::block_record::PlacementChange {
                    block_id: rebalance.block_id.clone(),
                    parent: placement.parent.clone(),
                    rank_key: rebalance.rank_key.clone(),
                });
            }
            if !placement_changes.is_empty() {
                graph
                    .apply_placement_changes(&placement_changes)
                    .map_err(map_graph_error)?;
            }
            let mut effects = Vec::with_capacity(
                entries.len() * 2 + view_rebalances.len() + placement_rebalances.len() * 2,
            );
            for change in placement_changes {
                let previous = before_rebalances
                    .placement(&change.block_id)
                    .ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Batch promotion placement rebalance source disappeared",
                            false,
                        )
                    })?;
                let next = graph.placement(&change.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Batch promotion placement rebalance target disappeared",
                        false,
                    )
                })?;
                let record = graph.block(&change.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Batch promotion placement rebalance record disappeared",
                        false,
                    )
                })?;
                effects.push(record_effect(record));
                effects.push(LocalCommitEffect {
                    kind: "placement".to_owned(),
                    value: json!({
                        "blockId": change.block_id,
                        "from": previous.parent,
                        "to": next.parent,
                        "rankKey": next.rank_key,
                        "revision": next.revision,
                    }),
                });
            }
            for entry in entries {
                if !block_ids.insert(entry.block_id.as_str()) {
                    return Err(StoreError::new(
                        StoreErrorCode::InvalidInput,
                        "Batch promotion contains a duplicate Block id",
                        false,
                    ));
                }
                validate_revisions(
                    graph,
                    &entry.block_id,
                    entry.expected_block_revision,
                    entry.expected_placement_revision,
                )?;
                let previous_kind = graph
                    .block(&entry.block_id)
                    .map(|record| record.kind.clone())
                    .ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::NotFound,
                            "Batch promotion BlockRecord is missing",
                            false,
                        )
                    })?;
                let previous = graph.placement(&entry.block_id).cloned().ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::NotFound,
                        "Batch promotion placement is missing",
                        false,
                    )
                })?;
                graph
                    .promote_to_page(
                        &entry.block_id,
                        data_source_id.clone(),
                        entry.rank_key.clone(),
                    )
                    .map_err(map_graph_error)?;
                let next_record = graph.block(&entry.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Batch promoted BlockRecord disappeared",
                        false,
                    )
                })?;
                let next = graph.placement(&entry.block_id).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Batch promoted placement disappeared",
                        false,
                    )
                })?;
                effects.push(LocalCommitEffect {
                    kind: "promotion".to_owned(),
                    value: json!({
                        "blockId": entry.block_id,
                        "fromKind": previous_kind,
                        "toKind": BlockKind::Page,
                        "from": previous.parent,
                        "to": next.parent,
                        "rankKey": next.rank_key,
                        "blockRevision": next_record.revision,
                        "placementRevision": next.revision,
                        "libraryId": next_record.library_id,
                        "properties": next_record.properties,
                        "contentShardId": next_record.content_shard_id,
                    }),
                });
                if let Some(view_id) = view_id {
                    let view_rank_key = entry.view_rank_key.as_ref().ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::InvalidInput,
                            "Batch promotion View position is missing its rank key",
                            false,
                        )
                    })?;
                    effects.push(LocalCommitEffect {
                        kind: "view_position".to_owned(),
                        value: json!({
                            "viewId": view_id,
                            "dataSourceId": data_source_id,
                            "blockId": entry.block_id,
                            "groupKey": entry.view_group_key,
                            "rankKey": view_rank_key,
                            "revision": 0,
                        }),
                    });
                }
            }
            if let Some(view_id) = view_id {
                for rebalance in view_rebalances {
                    if rebalance.rank_key.trim().is_empty() {
                        return Err(StoreError::new(
                            StoreErrorCode::InvalidInput,
                            "Batch promotion View rebalance rank is empty",
                            false,
                        ));
                    }
                    let revision = rebalance.expected_revision.checked_add(1).ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Batch promotion View revision overflow",
                            false,
                        )
                    })?;
                    effects.push(LocalCommitEffect {
                        kind: "view_position".to_owned(),
                        value: json!({
                            "viewId": view_id,
                            "dataSourceId": data_source_id,
                            "blockId": rebalance.block_id,
                            "groupKey": rebalance.group_key,
                            "rankKey": rebalance.rank_key,
                            "revision": revision,
                        }),
                    });
                }
            }
            Ok((
                entries
                    .first()
                    .map(|entry| entry.block_id.clone())
                    .expect("validated non-empty batch"),
                effects,
            ))
        }
        BlockMutationOperation::SetMaterializedContent {
            block_id,
            slot,
            materialized_json,
            expected_revision,
        } => {
            let record = graph.block(block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::NotFound,
                    "Content BlockRecord is missing",
                    false,
                )
            })?;
            let revision = expected_revision.checked_add(1).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Content revision overflow",
                    false,
                )
            })?;
            let _ = (record, revision, materialized_json, slot);
            Ok((block_id.clone(), Vec::new()))
        }
        BlockMutationOperation::ReconcilePageTree {
            page_id,
            expected_page_revision,
            nodes,
        } => apply_reconcile_page_tree(transaction, graph, page_id, *expected_page_revision, nodes),
    }
}

const MAX_RECONCILE_PAGE_NODES: usize = 100_000;

fn content_slot_for_kind(kind: &BlockKind) -> ContentSlot {
    if matches!(kind, BlockKind::Page) {
        ContentSlot::Title
    } else {
        ContentSlot::Inline
    }
}

fn content_slot_name(slot: &ContentSlot) -> &'static str {
    match slot {
        ContentSlot::Title => "title",
        ContentSlot::Inline => "inline",
        ContentSlot::Body => "body",
        ContentSlot::Properties => "properties",
    }
}

fn apply_reconcile_page_tree(
    transaction: &Transaction<'_>,
    graph: &mut RecordGraph,
    page_id: &str,
    expected_page_revision: u64,
    nodes: &[BlockTreeNode],
) -> Result<(String, Vec<LocalCommitEffect>), StoreError> {
    if page_id.trim().is_empty() || nodes.len() > MAX_RECONCILE_PAGE_NODES {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Page tree identity or node count is invalid",
            false,
        ));
    }
    let page = graph.block(page_id).ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::NotFound,
            "Reconciled Page is missing",
            false,
        )
    })?;
    if !matches!(page.kind, BlockKind::Page) {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "ReconcilePageTree requires a Page root",
            false,
        ));
    }
    if page.revision != expected_page_revision {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Page tree root revision is stale",
            true,
        ));
    }

    let before = graph.clone();
    let current_descendants = graph.descendant_ids(page_id).map_err(map_graph_error)?;
    let current_descendant_ids = current_descendants.iter().cloned().collect::<BTreeSet<_>>();
    let mut node_ids = BTreeSet::new();
    for node in nodes {
        if node.block_id.trim().is_empty()
            || node.block_id == page_id
            || node.content_shard_id.trim().is_empty()
            || node.rank_key.trim().is_empty()
            || !node_ids.insert(node.block_id.clone())
        {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Page tree contains an invalid or duplicate Block id",
                false,
            ));
        }
        if let Some(parent_id) = &node.parent_block_id {
            if parent_id.trim().is_empty() || parent_id == &node.block_id {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Page tree parent identity is invalid",
                    false,
                ));
            }
        }
        let is_existing = graph.block(&node.block_id).is_some();
        if is_existing != current_descendant_ids.contains(&node.block_id) {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "Page tree may only reconcile descendants of its root or new Block identities",
                false,
            ));
        }
        if !is_existing {
            let historical_lifecycle = transaction
                .query_row(
                    "SELECT lifecycle FROM block_records WHERE id = ?1",
                    [&node.block_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if historical_lifecycle.is_some() {
                return Err(StoreError::new(
                    StoreErrorCode::Conflict,
                    format!(
                        "Block identity {} already exists in lifecycle history and cannot be reused",
                        node.block_id
                    ),
                    false,
                ));
            }
        }
        match (
            node.expected_block_revision,
            node.expected_placement_revision,
            node.expected_content_revision,
        ) {
            (Some(_), Some(_), Some(_)) if is_existing => {}
            (None, None, None) if !is_existing => {}
            _ => {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "Page tree preconditions must be complete for existing or new Blocks",
                    false,
                ));
            }
        }
    }
    for node in nodes {
        if let Some(parent_id) = &node.parent_block_id {
            if parent_id != page_id && !node_ids.contains(parent_id) {
                return Err(StoreError::new(
                    StoreErrorCode::NotFound,
                    "Page tree refers to a parent outside the submitted tree",
                    false,
                ));
            }
        }
    }

    let content_ids = current_descendants
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let content_window =
        crate::content_store::read_window(transaction, graph.library_id(), Some(&content_ids))?;
    let content_by_key = content_window
        .records
        .into_iter()
        .map(|record| {
            (
                (
                    record.block_id.clone(),
                    content_slot_name(&record.slot).to_owned(),
                ),
                record,
            )
        })
        .collect::<BTreeMap<_, _>>();

    // Remove omitted roots first. This releases their old sibling ranks and
    // makes the remaining graph safe to validate while new nodes are added.
    let removed_ids = current_descendants
        .iter()
        .filter(|id| *id != page_id && !node_ids.contains(*id))
        .cloned()
        .collect::<BTreeSet<_>>();
    let removed_roots = removed_ids
        .iter()
        .filter(|id| {
            graph
                .placement(id)
                .is_some_and(|placement| !matches!(&placement.parent, PlacementParent::Block(parent) if removed_ids.contains(parent)))
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut removed_records = Vec::new();
    for root in removed_roots {
        removed_records.extend(graph.remove_subtree(&root).map_err(map_graph_error)?);
    }

    // Apply existing updates and inserts in parent-before-child order. The
    // loop is intentionally independent of renderer preorder so Core remains
    // the validator even for agent/import callers.
    let mut pending = nodes.iter().collect::<Vec<_>>();
    let mut processed = BTreeSet::new();
    while !pending.is_empty() {
        let mut next_pending = Vec::new();
        let mut progressed = false;
        for node in pending {
            let parent_id = node.parent_block_id.as_deref().unwrap_or(page_id);
            if parent_id != page_id && !processed.contains(parent_id) {
                next_pending.push(node);
                continue;
            }
            let target_parent = PlacementParent::Block(parent_id.to_owned());
            if let Some(current) = graph.block(&node.block_id).cloned() {
                validate_revisions(
                    graph,
                    &node.block_id,
                    node.expected_block_revision
                        .expect("validated existing revision"),
                    node.expected_placement_revision
                        .expect("validated existing placement revision"),
                )?;
                if current.content_shard_id != node.content_shard_id {
                    return Err(StoreError::new(
                        StoreErrorCode::Conflict,
                        "A Block content shard identity cannot change",
                        false,
                    ));
                }
                if current.kind != node.kind || current.properties != node.properties {
                    graph
                        .update_block(&node.block_id, node.kind.clone(), node.properties.clone())
                        .map_err(map_graph_error)?;
                }
                let placement = graph.placement(&node.block_id).cloned().ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Page tree placement disappeared",
                        false,
                    )
                })?;
                if placement.parent != target_parent || placement.rank_key != node.rank_key {
                    graph
                        .move_block(&node.block_id, target_parent, node.rank_key.clone())
                        .map_err(map_graph_error)?;
                }
            } else {
                let record = BlockRecord {
                    id: node.block_id.clone(),
                    library_id: graph.library_id().to_owned(),
                    kind: node.kind.clone(),
                    lifecycle: BlockLifecycle::Active,
                    properties: node.properties.clone(),
                    content_shard_id: node.content_shard_id.clone(),
                    revision: 0,
                };
                let placement = BlockPlacement {
                    block_id: node.block_id.clone(),
                    parent: target_parent,
                    rank_key: node.rank_key.clone(),
                    revision: 0,
                };
                graph.insert(record, placement).map_err(map_graph_error)?;
            }
            processed.insert(node.block_id.clone());
            progressed = true;
        }
        if !progressed {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Page tree contains a parent cycle or an unreachable parent",
                false,
            ));
        }
        pending = next_pending;
    }

    let mut effects = Vec::new();
    for node in nodes {
        let next_record = graph.block(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Reconciled Block disappeared",
                false,
            )
        })?;
        let previous_record = before.block(&node.block_id);
        if previous_record.is_none()
            || previous_record.is_some_and(|previous| {
                previous.kind != next_record.kind
                    || previous.properties != next_record.properties
                    || previous.revision != next_record.revision
            })
        {
            effects.push(record_effect(next_record));
        }

        let next_placement = graph.placement(&node.block_id).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Reconciled Block placement disappeared",
                false,
            )
        })?;
        let previous_placement = before.placement(&node.block_id);
        if previous_placement.is_none()
            || previous_placement.is_some_and(|previous| previous != next_placement)
        {
            effects.push(LocalCommitEffect {
                kind: "placement".to_owned(),
                value: json!({
                    "blockId": node.block_id,
                    "from": previous_placement.map(|placement| placement.parent.clone()),
                    "to": next_placement.parent,
                    "rankKey": next_placement.rank_key,
                    "revision": next_placement.revision,
                }),
            });
        }

        let target_slot = content_slot_for_kind(&node.kind);
        let target_slot_name = content_slot_name(&target_slot).to_owned();
        let direct = content_by_key.get(&(node.block_id.clone(), target_slot_name.clone()));
        let fallback_slot_name = if target_slot == ContentSlot::Title {
            "inline"
        } else {
            "title"
        };
        let current_content = direct.or_else(|| {
            content_by_key.get(&(node.block_id.clone(), fallback_slot_name.to_owned()))
        });
        let content_head = if let Some(_previous) = previous_record {
            let current_content = current_content.ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::NotFound,
                    format!("Block {} content slot is missing", node.block_id),
                    false,
                )
            })?;
            if node.expected_content_revision != Some(current_content.revision) {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    format!("Block {} content revision is stale", node.block_id),
                    true,
                ));
            }
            let slot_was_missing = direct.is_none();
            let changed = slot_was_missing
                || current_content.materialized_json.as_ref() != Some(&node.materialized_json);
            if !changed {
                continue;
            }
            if slot_was_missing
                && current_content.materialized_json.as_ref() == Some(&node.materialized_json)
            {
                current_content.revision
            } else {
                current_content.revision.checked_add(1).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Page tree content revision overflow",
                        false,
                    )
                })?
            }
        } else {
            if node.expected_content_revision.is_some() {
                return Err(StoreError::new(
                    StoreErrorCode::InvalidInput,
                    "New Page tree Blocks cannot carry a content precondition",
                    false,
                ));
            }
            0
        };
        effects.push(LocalCommitEffect {
            kind: "content".to_owned(),
            value: json!({
                "blockId": node.block_id,
                "slot": target_slot_name,
                "shardId": next_record.content_shard_id,
                "head": content_head,
                "stateHash": null,
                "materializedJson": node.materialized_json,
            }),
        });
    }
    for removed in removed_records {
        effects.push(LocalCommitEffect {
            kind: "remove".to_owned(),
            value: json!({
                "blockId": removed.id,
                "lifecycle": "archived",
                "revision": removed.revision.checked_add(1).ok_or_else(|| {
                    StoreError::new(
                        StoreErrorCode::StoreCorrupt,
                        "Archived BlockRecord revision overflow",
                        false,
                    )
                })?,
            }),
        });
    }
    if effects.is_empty() {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Page tree already matches the canonical state",
            false,
        ));
    }
    Ok((page_id.to_owned(), effects))
}

fn record_effect(record: &BlockRecord) -> LocalCommitEffect {
    LocalCommitEffect {
        kind: "record".to_owned(),
        value: json!({
            "blockId": record.id,
            "libraryId": record.library_id,
            "kind": record.kind,
            "lifecycle": record.lifecycle,
            "properties": record.properties,
            "contentShardId": record.content_shard_id,
            "revision": record.revision,
        }),
    }
}

fn content_effect(snapshot: &ContentSnapshot) -> LocalCommitEffect {
    let value = json!({
        "blockId": snapshot.block_id,
        "slot": content_slot_name(&snapshot.slot),
        "shardId": snapshot.shard_id,
        "head": snapshot.revision,
        "stateHash": snapshot.state_hash,
        // An empty Yrs state has no stored materialization row, but its
        // deterministic read projection is still an empty rich-text value.
        "materializedJson": snapshot
            .materialized_json
            .clone()
            .unwrap_or_else(|| json!([])),
    });
    LocalCommitEffect {
        kind: "content".to_owned(),
        value,
    }
}

fn validate_view_position_update(
    transaction: &Transaction<'_>,
    view_id: &str,
    data_source_id: &str,
    block_id: &str,
    expected_revision: Option<u64>,
) -> Result<u64, StoreError> {
    if view_id.trim().is_empty() || data_source_id.trim().is_empty() || block_id.trim().is_empty() {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "View position update identity is invalid",
            false,
        ));
    }
    let existing: Option<(String, i64)> = transaction
        .query_row(
            "SELECT data_source_id, revision
             FROM block_record_view_positions
             WHERE view_id = ?1 AND block_id = ?2",
            rusqlite::params![view_id, block_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match existing {
        Some((stored_data_source_id, stored_revision)) => {
            if stored_data_source_id != data_source_id {
                return Err(StoreError::new(
                    StoreErrorCode::Conflict,
                    "View position belongs to another Data Source",
                    false,
                ));
            }
            let stored_revision = u64::try_from(stored_revision).map_err(|_| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "View position revision is invalid",
                    false,
                )
            })?;
            if expected_revision != Some(stored_revision) {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    "View position update precondition is stale",
                    true,
                ));
            }
            stored_revision.checked_add(1).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "View position revision overflow",
                    false,
                )
            })
        }
        None => {
            if expected_revision.is_some_and(|revision| revision != 0) {
                return Err(StoreError::new(
                    StoreErrorCode::RevisionConflict,
                    "New View position has a non-zero precondition",
                    true,
                ));
            }
            Ok(0)
        }
    }
}

fn validate_revisions(
    graph: &RecordGraph,
    block_id: &str,
    expected_block_revision: u64,
    expected_placement_revision: u64,
) -> Result<(), StoreError> {
    let record = graph.block(block_id).ok_or_else(|| {
        StoreError::new(StoreErrorCode::NotFound, "BlockRecord is missing", false)
    })?;
    let placement = graph.placement(block_id).ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::NotFound,
            "Block placement is missing",
            false,
        )
    })?;
    if record.revision != expected_block_revision
        || placement.revision != expected_placement_revision
    {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Block mutation precondition does not match the canonical graph",
            true,
        ));
    }
    Ok(())
}

fn map_graph_error(error: crate::domain::block_record::BlockRecordError) -> StoreError {
    let code = match error.code {
        BlockRecordErrorCode::MissingParent => StoreErrorCode::NotFound,
        BlockRecordErrorCode::Cycle
        | BlockRecordErrorCode::InvalidParentKind
        | BlockRecordErrorCode::InvalidPlacementRank
        | BlockRecordErrorCode::NoChange
        | BlockRecordErrorCode::NotPromotable => StoreErrorCode::InvalidInput,
        BlockRecordErrorCode::RetiredBlock => StoreErrorCode::Conflict,
        _ => StoreErrorCode::StoreCorrupt,
    };
    StoreError::new(code, error.to_string(), false)
}

fn validate_operation_identity(request: &BlockMutationRequest) -> Result<(), StoreError> {
    for (label, value) in [
        ("store_epoch", request.store_epoch.as_str()),
        ("operation_id", request.operation_id.as_str()),
        ("intent_hash", request.intent_hash.as_str()),
        ("commit_id", request.commit_id.as_str()),
        ("canonical_hash", request.canonical_hash.as_str()),
        ("actor_id", request.actor_id.as_str()),
        ("session_id", request.session_id.as_str()),
        ("committed_at", request.committed_at.as_str()),
    ] {
        if value.trim().is_empty() || value.trim() != value {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                format!("Block mutation {label} is invalid"),
                false,
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::time::Instant;

    use yrs::{ReadTxn, StateVector, Text, Transact, WriteTxn};

    use super::*;
    use crate::content_store::{self, ContentSlot, ContentSnapshot, ContentUpdateRequest};
    use crate::document::create_compatible_document;
    use crate::domain::block_record::{BlockLifecycle, BlockRecord};
    use crate::infrastructure::block_record_store::install_schema as install_graph_schema;
    use crate::infrastructure::block_record_store::install_view_position_schema;
    use crate::local_commit::{LocalCommitDraft, install_schema as install_commit_schema};

    fn hash(value: &str) -> String {
        format!("{:x}", Sha256::digest(value.as_bytes()))
    }

    /// A representative editor/Board pressure fixture:
    ///
    /// ```text
    /// page-a
    /// ├── 100 placeholder blocks
    /// ├── title-a
    /// │   └── 100 child blocks
    /// └── 100 placeholder blocks
    /// board:test
    /// └── 100 existing Page records
    /// ```
    ///
    /// The promotion below must still update exactly one record and one
    /// placement. The subtree and the Board's existing pages are identity
    /// stable observations, not implementation details.
    fn graph() -> RecordGraph {
        let mut blocks = Vec::with_capacity(402);
        let mut placements = Vec::with_capacity(402);
        let mut add = |id: String,
                       kind: BlockKind,
                       parent: PlacementParent,
                       rank_key: String,
                       properties: serde_json::Value| {
            blocks.push(BlockRecord {
                content_shard_id: format!("shard:{id}"),
                id: id.clone(),
                library_id: "library:test".to_owned(),
                kind,
                lifecycle: BlockLifecycle::Active,
                properties,
                revision: 0,
            });
            placements.push(crate::domain::block_record::BlockPlacement {
                block_id: id,
                parent,
                rank_key,
                revision: 0,
            });
        };

        add(
            "page-a".to_owned(),
            BlockKind::Page,
            PlacementParent::Library,
            "a".to_owned(),
            json!({"title": "Page A"}),
        );
        for index in 0..100 {
            let id = format!("before-{index:03}");
            add(
                id,
                BlockKind::Paragraph,
                PlacementParent::Block("page-a".to_owned()),
                format!("{index:03}"),
                json!({"placeholder": true, "index": index}),
            );
        }
        add(
            "title-a".to_owned(),
            BlockKind::Heading,
            PlacementParent::Block("page-a".to_owned()),
            "100".to_owned(),
            json!({"title": "title-A"}),
        );
        for index in 0..100 {
            let id = format!("child-{index:03}");
            add(
                id,
                BlockKind::Paragraph,
                PlacementParent::Block("title-a".to_owned()),
                format!("{index:03}"),
                json!({"placeholder": true, "index": index}),
            );
        }
        for index in 0..100 {
            let id = format!("after-{index:03}");
            add(
                id,
                BlockKind::Paragraph,
                PlacementParent::Block("page-a".to_owned()),
                format!("{:03}", index + 201),
                json!({"placeholder": true, "index": index + 100}),
            );
        }
        for index in 0..100 {
            let id = format!("board-page-{index:03}");
            add(
                id,
                BlockKind::Page,
                PlacementParent::DataSource("board:test".to_owned()),
                format!("{index:03}"),
                json!({"title": format!("Existing board page {index}")}),
            );
        }

        RecordGraph::from_parts("library:test", blocks, placements).expect("pressure graph")
    }

    fn request(operation_id: &str, operation: BlockMutationOperation) -> BlockMutationRequest {
        BlockMutationRequest {
            store_epoch: "epoch:test".to_owned(),
            operation_id: operation_id.to_owned(),
            intent_hash: hash(operation_id),
            commit_id: format!("commit:{operation_id}"),
            canonical_hash: hash("canonical"),
            actor_id: "actor:test".to_owned(),
            session_id: "session:test".to_owned(),
            committed_at: "2026-08-06T00:00:00Z".to_owned(),
            audience: json!({"kind": "library", "projectIds": []}),
            operation,
        }
    }

    fn content_update() -> (ContentSnapshot, ContentUpdateRequest) {
        let engine = crate::document::YrsDocumentEngine::from_full_state_v1("content:block-a", &[])
            .expect("empty content");
        let full_state_v1 = engine.full_state_v1();
        let mut snapshot = ContentSnapshot {
            block_id: "block:a".to_owned(),
            slot: ContentSlot::Inline,
            library_id: "library:test".to_owned(),
            shard_id: "shard:a".to_owned(),
            revision: 0,
            state_vector_v1: engine.state_vector_v1(),
            full_state_v1,
            state_hash: String::new(),
            materialized_json: None,
        };
        snapshot.state_hash = format!("{:x}", Sha256::digest(snapshot.full_state_v1.as_slice()));
        let document = create_compatible_document("content:block-a:inline");
        let mut transaction = document.transact_mut();
        let text = transaction.get_or_insert_text("content");
        text.insert(&mut transaction, 0, "hello");
        drop(transaction);
        let update_v1 = document
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let update = ContentUpdateRequest {
            shard_id: "shard:a".to_owned(),
            block_id: "block:a".to_owned(),
            slot: ContentSlot::Inline,
            update_id: "content-update:a".to_owned(),
            update_v1,
            expected_state_vector_v1: snapshot.state_vector_v1.clone(),
            committed_at: "2026-08-06T00:00:00Z".to_owned(),
        };
        (snapshot, update)
    }

    #[test]
    fn high_pressure_promotion_changes_only_root_semantics_in_one_commit() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_view_position_schema(&connection).expect("view position schema");
        install_commit_schema(&connection).expect("commit schema");
        content_store::install_schema(&connection).expect("content schema");
        let mut graph = graph();
        let descendant_ids = graph.descendant_ids("title-a").expect("descendants");
        let board_page_ids = (0..100)
            .map(|index| format!("board-page-{index:03}"))
            .collect::<Vec<_>>();
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::ensure_data_source(
                &transaction,
                "board:test",
                "library:test",
            )
            .expect("data source");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("seed graph");
            transaction.commit().expect("seed commit");
        }
        connection
            .execute_batch(
                "CREATE TABLE mutation_audit(action TEXT NOT NULL, table_name TEXT NOT NULL, row_id TEXT NOT NULL);
                 CREATE TRIGGER mutation_audit_record_update AFTER UPDATE ON block_records BEGIN
                   INSERT INTO mutation_audit VALUES ('update', 'block_records', NEW.id);
                 END;
                 CREATE TRIGGER mutation_audit_placement_update AFTER UPDATE ON block_placements BEGIN
                   INSERT INTO mutation_audit VALUES ('update', 'block_placements', NEW.block_id);
                 END;
                 CREATE TRIGGER mutation_audit_record_delete AFTER DELETE ON block_records BEGIN
                   INSERT INTO mutation_audit VALUES ('delete', 'block_records', OLD.id);
                 END;
                 CREATE TRIGGER mutation_audit_placement_delete AFTER DELETE ON block_placements BEGIN
                   INSERT INTO mutation_audit VALUES ('delete', 'block_placements', OLD.block_id);
                 END;
                 CREATE TRIGGER mutation_audit_record_insert AFTER INSERT ON block_records BEGIN
                   INSERT INTO mutation_audit VALUES ('insert', 'block_records', NEW.id);
                 END;
                 CREATE TRIGGER mutation_audit_placement_insert AFTER INSERT ON block_placements BEGIN
                   INSERT INTO mutation_audit VALUES ('insert', 'block_placements', NEW.block_id);
                 END;",
            )
            .expect("audit triggers");
        let started_at = Instant::now();
        let transaction = connection.transaction().expect("transaction");
        let result = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "promote:title-a",
                BlockMutationOperation::PromoteToPage {
                    block_id: "title-a".to_owned(),
                    data_source_id: "board:test".to_owned(),
                    view_id: Some("view:board".to_owned()),
                    view_group_key: Some("in_progress".to_owned()),
                    view_rank_key: Some("m".to_owned()),
                    rank_key: "a".to_owned(),
                    expected_block_revision: 0,
                    expected_placement_revision: 0,
                },
            ),
        )
        .expect("promotion");
        transaction.commit().expect("commit");
        eprintln!(
            "BlockRecord high-fanout promotion: records=402, subtree=101, board_pages=100, elapsed_us={}",
            started_at.elapsed().as_micros()
        );

        assert!(!result.duplicate);
        assert_eq!(result.envelope.effects.len(), 3);
        assert_eq!(result.envelope.effects[1].kind, "view_position");
        assert_eq!(result.envelope.effects[2].kind, "content");
        assert_eq!(graph.block("title-a").expect("title").kind, BlockKind::Page);
        assert_eq!(
            graph.descendant_ids("title-a").expect("descendants"),
            descendant_ids
        );
        assert_eq!(
            graph.placement("title-a").expect("placement").parent,
            PlacementParent::DataSource("board:test".to_owned())
        );
        let (record_count, placement_count, commit_count): (i64, i64, i64) = connection
            .query_row(
                "SELECT (SELECT count(*) FROM block_records), \
                        (SELECT count(*) FROM block_placements), \
                        (SELECT count(*) FROM local_commits)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("counts");
        assert_eq!(record_count, 402);
        assert_eq!(placement_count, 402);
        assert_eq!(commit_count, 1);
        let view_position: (String, String, String) = connection
            .query_row(
                "SELECT view_id, group_key, rank_key
                 FROM block_record_view_positions
                 WHERE block_id = 'title-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("view position");
        assert_eq!(
            view_position,
            (
                "view:board".to_owned(),
                "in_progress".to_owned(),
                "m".to_owned()
            )
        );
        let audit: (i64, i64, i64) = connection
            .query_row(
                "SELECT
                   (SELECT count(*) FROM mutation_audit WHERE action = 'update' AND table_name = 'block_records'),
                   (SELECT count(*) FROM mutation_audit WHERE action = 'update' AND table_name = 'block_placements'),
                   (SELECT count(*) FROM mutation_audit WHERE action <> 'update')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("audit counts");
        assert_eq!(audit, (1, 1, 0));
        for board_page_id in board_page_ids {
            assert_eq!(
                graph.block(&board_page_id).expect("board page").kind,
                BlockKind::Page
            );
            assert_eq!(
                graph
                    .placement(&board_page_id)
                    .expect("board placement")
                    .parent,
                PlacementParent::DataSource("board:test".to_owned())
            );
        }
    }

    #[test]
    fn create_rebalances_placement_and_view_before_inserting_the_new_page() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_view_position_schema(&connection).expect("view schema");
        install_commit_schema(&connection).expect("commit schema");
        content_store::install_schema(&connection).expect("content schema");
        let mut graph = graph();
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::ensure_data_source(
                &transaction,
                "board:test",
                "library:test",
            )
            .expect("data source");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("graph");
            for (block_id, rank_key) in [("board-page-000", "000"), ("board-page-001", "001")] {
                crate::infrastructure::block_record_store::upsert_view_position(
                    &transaction,
                    &BlockViewPosition {
                        view_id: "view:board".to_owned(),
                        data_source_id: "board:test".to_owned(),
                        block_id: block_id.to_owned(),
                        group_key: Some("triage".to_owned()),
                        rank_key: rank_key.to_owned(),
                        revision: 0,
                    },
                    "library:test",
                )
                .expect("view position");
            }
            transaction.commit().expect("seed commit");
        }

        let transaction = connection.transaction().expect("create transaction");
        let committed = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "create:board-page-new",
                BlockMutationOperation::Create {
                    block_id: "board-page-new".to_owned(),
                    kind: BlockKind::Page,
                    properties: json!({"title": "Inserted"}),
                    content_shard_id: "shard:board-page-new".to_owned(),
                    parent: PlacementParent::DataSource("board:test".to_owned()),
                    rank_key: "000b".to_owned(),
                    view_id: Some("view:board".to_owned()),
                    data_source_id: Some("board:test".to_owned()),
                    view_group_key: Some("triage".to_owned()),
                    view_rank_key: Some("000b".to_owned()),
                    materialized_json: Some(json!([{"type": "text", "text": "Inserted"}])),
                    placement_rebalances: vec![
                        BlockPlacementRebalance {
                            block_id: "board-page-000".to_owned(),
                            rank_key: "000a".to_owned(),
                            expected_revision: 0,
                        },
                        BlockPlacementRebalance {
                            block_id: "board-page-001".to_owned(),
                            rank_key: "000c".to_owned(),
                            expected_revision: 0,
                        },
                    ],
                    view_rebalances: vec![
                        BlockViewPositionRebalance {
                            block_id: "board-page-000".to_owned(),
                            group_key: Some("triage".to_owned()),
                            rank_key: "000a".to_owned(),
                            expected_revision: 0,
                        },
                        BlockViewPositionRebalance {
                            block_id: "board-page-001".to_owned(),
                            group_key: Some("triage".to_owned()),
                            rank_key: "000c".to_owned(),
                            expected_revision: 0,
                        },
                    ],
                },
            ),
        )
        .expect("create");
        transaction.commit().expect("create commit");

        assert_eq!(committed.envelope.cursor.commit_seq, 1);
        assert_eq!(
            graph
                .placement("board-page-000")
                .expect("first placement")
                .rank_key,
            "000a"
        );
        assert_eq!(
            graph
                .placement("board-page-new")
                .expect("new placement")
                .rank_key,
            "000b"
        );
        assert_eq!(
            graph
                .placement("board-page-001")
                .expect("second placement")
                .rank_key,
            "000c"
        );
        let view_ranks: Vec<(String, String, i64)> = connection
            .prepare(
                "SELECT block_id, rank_key, revision
                 FROM block_record_view_positions
                 WHERE view_id = 'view:board' AND group_key = 'triage'
                 ORDER BY rank_key",
            )
            .expect("view query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("view rows")
            .collect::<rusqlite::Result<_>>()
            .expect("view collection");
        assert_eq!(
            view_ranks,
            vec![
                ("board-page-000".to_owned(), "000a".to_owned(), 1),
                ("board-page-new".to_owned(), "000b".to_owned(), 0),
                ("board-page-001".to_owned(), "000c".to_owned(), 1),
            ]
        );
    }

    #[test]
    fn update_record_commits_metadata_and_view_position_as_one_local_commit() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_view_position_schema(&connection).expect("view schema");
        install_commit_schema(&connection).expect("commit schema");
        let mut graph = graph();
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::ensure_data_source(
                &transaction,
                "board:test",
                "library:test",
            )
            .expect("data source");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("graph");
            crate::infrastructure::block_record_store::upsert_view_position(
                &transaction,
                &BlockViewPosition {
                    view_id: "view:board".to_owned(),
                    data_source_id: "board:test".to_owned(),
                    block_id: "board-page-000".to_owned(),
                    group_key: Some("triage".to_owned()),
                    rank_key: "000".to_owned(),
                    revision: 0,
                },
                "library:test",
            )
            .expect("view position");
            transaction.commit().expect("seed commit");
        }

        let transaction = connection.transaction().expect("update transaction");
        let committed = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "update:board-page-000",
                BlockMutationOperation::UpdateRecord {
                    block_id: "board-page-000".to_owned(),
                    properties: json!({"title": "Updated", "status": "ship"}),
                    expected_block_revision: 0,
                    view_id: Some("view:board".to_owned()),
                    data_source_id: Some("board:test".to_owned()),
                    view_group_key: Some("ship".to_owned()),
                    view_rank_key: Some("m".to_owned()),
                    expected_view_revision: Some(0),
                },
            ),
        )
        .expect("update");
        transaction.commit().expect("update commit");

        assert_eq!(committed.envelope.cursor.commit_seq, 1);
        assert_eq!(
            committed
                .envelope
                .effects
                .iter()
                .map(|effect| effect.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["record", "view_position"]
        );
        assert_eq!(graph.block("board-page-000").expect("record").revision, 1);
        assert_eq!(
            graph.block("board-page-000").expect("record").properties,
            json!({"title": "Updated", "status": "ship"})
        );
        let position: (String, String, String, i64) = connection
            .query_row(
                "SELECT data_source_id, group_key, rank_key, revision
                 FROM block_record_view_positions WHERE block_id = 'board-page-000'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("position");
        assert_eq!(
            position,
            (
                "board:test".to_owned(),
                "ship".to_owned(),
                "m".to_owned(),
                1
            )
        );
        let commit_count: i64 = connection
            .query_row("SELECT count(*) FROM local_commits", [], |row| row.get(0))
            .expect("commit count");
        assert_eq!(commit_count, 1);
    }

    #[test]
    fn update_many_moves_board_pages_atomically_and_emits_one_commit() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_view_position_schema(&connection).expect("view schema");
        install_commit_schema(&connection).expect("commit schema");
        let mut graph = graph();
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::ensure_data_source(
                &transaction,
                "board:test",
                "library:test",
            )
            .expect("data source");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("graph");
            for (block_id, rank_key) in [("board-page-000", "000"), ("board-page-001", "001")] {
                crate::infrastructure::block_record_store::upsert_view_position(
                    &transaction,
                    &BlockViewPosition {
                        view_id: "view:board".to_owned(),
                        data_source_id: "board:test".to_owned(),
                        block_id: block_id.to_owned(),
                        group_key: Some("triage".to_owned()),
                        rank_key: rank_key.to_owned(),
                        revision: 0,
                    },
                    "library:test",
                )
                .expect("view position");
            }
            transaction.commit().expect("seed commit");
        }

        let transaction = connection.transaction().expect("update transaction");
        let committed = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "update-many:board-pages",
                BlockMutationOperation::UpdateMany {
                    entries: vec![
                        BlockRecordUpdateEntry {
                            block_id: "board-page-000".to_owned(),
                            properties: json!({"title": "A", "status": "ship"}),
                            expected_block_revision: 0,
                            view_id: Some("view:board".to_owned()),
                            data_source_id: Some("board:test".to_owned()),
                            view_group_key: Some("ship".to_owned()),
                            view_rank_key: Some("a".to_owned()),
                            expected_view_revision: Some(0),
                        },
                        BlockRecordUpdateEntry {
                            block_id: "board-page-001".to_owned(),
                            properties: json!({"title": "B", "status": "ship"}),
                            expected_block_revision: 0,
                            view_id: Some("view:board".to_owned()),
                            data_source_id: Some("board:test".to_owned()),
                            view_group_key: Some("ship".to_owned()),
                            view_rank_key: Some("b".to_owned()),
                            expected_view_revision: Some(0),
                        },
                    ],
                    view_rebalances: Vec::new(),
                },
            ),
        )
        .expect("update many");
        transaction.commit().expect("update commit");

        assert_eq!(committed.envelope.cursor.commit_seq, 1);
        assert_eq!(committed.envelope.effects.len(), 4);
        let positions: Vec<(String, String, String)> = connection
            .prepare(
                "SELECT block_id, group_key, rank_key FROM block_record_view_positions
                 WHERE view_id = 'view:board' ORDER BY block_id",
            )
            .expect("positions query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("positions")
            .collect::<rusqlite::Result<_>>()
            .expect("positions rows");
        assert_eq!(
            positions,
            vec![
                (
                    "board-page-000".to_owned(),
                    "ship".to_owned(),
                    "a".to_owned()
                ),
                (
                    "board-page-001".to_owned(),
                    "ship".to_owned(),
                    "b".to_owned()
                ),
            ]
        );
        let commit_count: i64 = connection
            .query_row("SELECT count(*) FROM local_commits", [], |row| row.get(0))
            .expect("commit count");
        assert_eq!(commit_count, 1);
    }

    #[test]
    fn archive_subtree_retains_records_but_removes_live_ownership_in_one_commit() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_view_position_schema(&connection).expect("view schema");
        install_commit_schema(&connection).expect("commit schema");
        let mut graph = graph();
        let subtree = graph.descendant_ids("title-a").expect("subtree");
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::ensure_data_source(
                &transaction,
                "board:test",
                "library:test",
            )
            .expect("data source");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("graph");
            transaction.commit().expect("seed commit");
        }
        let transaction = connection.transaction().expect("archive transaction");
        let committed = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "archive:title-a",
                BlockMutationOperation::ArchiveSubtree {
                    block_id: "title-a".to_owned(),
                    expected_block_revision: 0,
                    expected_placement_revision: 0,
                },
            ),
        )
        .expect("archive");
        transaction.commit().expect("archive commit");

        assert_eq!(committed.envelope.cursor.commit_seq, 1);
        assert_eq!(committed.envelope.effects.len(), subtree.len() * 2);
        assert!(
            subtree
                .iter()
                .all(|block_id| graph.block(block_id).is_none())
        );
        let (archived, live_placements): (i64, i64) = connection
            .query_row(
                "SELECT
                   (SELECT count(*) FROM block_records WHERE lifecycle = 'archived'),
                   (SELECT count(*) FROM block_placements)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("archive counts");
        assert_eq!(archived, subtree.len() as i64);
        assert_eq!(live_placements, 301);
    }

    #[test]
    fn move_many_swaps_sibling_ranks_without_intermediate_unique_conflicts() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_commit_schema(&connection).expect("commit schema");
        let mut graph = graph();
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::ensure_data_source(
                &transaction,
                "board:test",
                "library:test",
            )
            .expect("data source");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("seed graph");
            transaction.commit().expect("seed commit");
        }

        let transaction = connection.transaction().expect("move transaction");
        let committed = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "move-many:swap",
                BlockMutationOperation::MoveMany {
                    entries: vec![
                        BlockMoveEntry {
                            block_id: "before-000".to_owned(),
                            target_parent: PlacementParent::Block("page-a".to_owned()),
                            rank_key: "001".to_owned(),
                            expected_block_revision: 0,
                            expected_placement_revision: 0,
                        },
                        BlockMoveEntry {
                            block_id: "before-001".to_owned(),
                            target_parent: PlacementParent::Block("page-a".to_owned()),
                            rank_key: "000".to_owned(),
                            expected_block_revision: 0,
                            expected_placement_revision: 0,
                        },
                    ],
                    placement_rebalances: Vec::new(),
                },
            ),
        )
        .expect("move many");
        transaction.commit().expect("move commit");

        assert_eq!(committed.envelope.effects.len(), 4);
        assert_eq!(
            graph.placement("before-000").expect("first").rank_key,
            "001"
        );
        assert_eq!(
            graph.placement("before-001").expect("second").rank_key,
            "000"
        );
        let stored: Vec<(String, String)> = connection
            .prepare(
                "SELECT block_id, rank_key FROM block_placements
                 WHERE block_id IN ('before-000', 'before-001') ORDER BY block_id",
            )
            .expect("placements query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("placements")
            .collect::<rusqlite::Result<_>>()
            .expect("stored placements");
        assert_eq!(
            stored,
            vec![
                ("before-000".to_owned(), "001".to_owned()),
                ("before-001".to_owned(), "000".to_owned()),
            ]
        );
    }

    #[test]
    fn reconcile_page_tree_commits_content_structure_and_archive_together() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_commit_schema(&connection).expect("commit schema");
        content_store::install_schema(&connection).expect("content schema");
        let blocks = vec![
            BlockRecord {
                id: "page:test".to_owned(),
                library_id: "library:test".to_owned(),
                kind: BlockKind::Page,
                lifecycle: BlockLifecycle::Active,
                properties: json!({}),
                content_shard_id: "shard:page".to_owned(),
                revision: 0,
            },
            BlockRecord {
                id: "child:a".to_owned(),
                library_id: "library:test".to_owned(),
                kind: BlockKind::Paragraph,
                lifecycle: BlockLifecycle::Active,
                properties: json!({"old": true}),
                content_shard_id: "shard:a".to_owned(),
                revision: 0,
            },
            BlockRecord {
                id: "child:b".to_owned(),
                library_id: "library:test".to_owned(),
                kind: BlockKind::Paragraph,
                lifecycle: BlockLifecycle::Active,
                properties: json!({}),
                content_shard_id: "shard:b".to_owned(),
                revision: 0,
            },
        ];
        let placements = vec![
            crate::domain::block_record::BlockPlacement {
                block_id: "page:test".to_owned(),
                parent: PlacementParent::Library,
                rank_key: "a".to_owned(),
                revision: 0,
            },
            crate::domain::block_record::BlockPlacement {
                block_id: "child:a".to_owned(),
                parent: PlacementParent::Block("page:test".to_owned()),
                rank_key: "a".to_owned(),
                revision: 0,
            },
            crate::domain::block_record::BlockPlacement {
                block_id: "child:b".to_owned(),
                parent: PlacementParent::Block("page:test".to_owned()),
                rank_key: "b".to_owned(),
                revision: 0,
            },
        ];
        let mut graph =
            RecordGraph::from_parts("library:test", blocks, placements).expect("page graph");
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("graph");
            for (shard_id, block_id, slot) in [
                ("shard:page", "page:test", ContentSlot::Title),
                ("shard:a", "child:a", ContentSlot::Inline),
                ("shard:b", "child:b", ContentSlot::Inline),
            ] {
                content_store::ensure_shard(
                    &transaction,
                    shard_id,
                    "library:test",
                    "2026-08-06T00:00:00Z",
                )
                .expect("shard");
                let snapshot = content_store::materialized_snapshot(
                    block_id,
                    slot,
                    "library:test",
                    shard_id,
                    &json!([]),
                )
                .expect("content snapshot");
                content_store::write_snapshot(&transaction, &snapshot).expect("content");
            }
            transaction.commit().expect("seed commit");
        }

        let transaction = connection.transaction().expect("reconcile transaction");
        let committed = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "reconcile:page-test",
                BlockMutationOperation::ReconcilePageTree {
                    page_id: "page:test".to_owned(),
                    expected_page_revision: 0,
                    nodes: vec![
                        BlockTreeNode {
                            block_id: "child:b".to_owned(),
                            kind: BlockKind::Paragraph,
                            properties: json!({"edited": true}),
                            content_shard_id: "shard:b".to_owned(),
                            parent_block_id: None,
                            rank_key: "a".to_owned(),
                            expected_block_revision: Some(0),
                            expected_placement_revision: Some(0),
                            expected_content_revision: Some(0),
                            materialized_json: json!([{"type": "text", "text": "edited"}]),
                        },
                        BlockTreeNode {
                            block_id: "child:c".to_owned(),
                            kind: BlockKind::Paragraph,
                            properties: json!({}),
                            content_shard_id: "shard:c".to_owned(),
                            parent_block_id: None,
                            rank_key: "b".to_owned(),
                            expected_block_revision: None,
                            expected_placement_revision: None,
                            expected_content_revision: None,
                            materialized_json: json!([]),
                        },
                    ],
                },
            ),
        )
        .expect("reconcile");
        transaction.commit().expect("reconcile commit");

        assert!(
            committed
                .envelope
                .effects
                .iter()
                .any(|effect| effect.kind == "remove")
        );
        assert_eq!(graph.block("child:a"), None);
        assert_eq!(graph.block("child:b").expect("edited").revision, 1);
        assert!(graph.block("child:c").is_some());
        let rows: Vec<(String, String, i64)> = connection
            .prepare(
                "SELECT id, lifecycle, revision FROM block_records
                 WHERE id IN ('child:a', 'child:b', 'child:c') ORDER BY id",
            )
            .expect("record query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("records")
            .collect::<rusqlite::Result<_>>()
            .expect("record rows");
        assert_eq!(
            rows,
            vec![
                ("child:a".to_owned(), "archived".to_owned(), 1),
                ("child:b".to_owned(), "active".to_owned(), 1),
                ("child:c".to_owned(), "active".to_owned(), 0),
            ]
        );
        let placement_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM block_placements WHERE block_id IN ('child:a', 'child:b', 'child:c')",
                [],
                |row| row.get(0),
            )
            .expect("placement count");
        assert_eq!(placement_count, 2);
        let materialized: String = connection
            .query_row(
                "SELECT materialized_json FROM block_content_materializations
                 WHERE block_id = 'child:b' AND slot = 'inline'",
                [],
                |row| row.get(0),
            )
            .expect("materialized content");
        assert!(materialized.contains("edited"));
        let content_history: (i64, i64) = connection
            .query_row(
                "SELECT
                   (SELECT count(*) FROM content_updates WHERE block_id = 'child:b' AND slot = 'inline'),
                   (SELECT head_seq FROM content_shards WHERE shard_id = 'shard:b')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("content history");
        assert_eq!(content_history, (1, 1));
    }

    #[test]
    fn archive_releases_live_rank_but_retains_record_identity() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        let graph = graph();
        {
            let transaction = connection.transaction().expect("seed transaction");
            crate::infrastructure::block_record_store::ensure_data_source(
                &transaction,
                "board:test",
                "library:test",
            )
            .expect("data source");
            crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
                .expect("seed graph");
            let previous = graph.block("before-000").expect("record");
            archive_block(&transaction, previous).expect("archive");
            let replacement = BlockRecord {
                id: "replacement".to_owned(),
                library_id: "library:test".to_owned(),
                kind: BlockKind::Paragraph,
                lifecycle: BlockLifecycle::Active,
                properties: json!({}),
                content_shard_id: "shard:replacement".to_owned(),
                revision: 0,
            };
            let placement = crate::domain::block_record::BlockPlacement {
                block_id: replacement.id.clone(),
                parent: PlacementParent::Block("page-a".to_owned()),
                rank_key: "000".to_owned(),
                revision: 0,
            };
            crate::infrastructure::block_record_store::insert_record(&transaction, &replacement)
                .expect("replacement record");
            crate::infrastructure::block_record_store::insert_placement(&transaction, &placement)
                .expect("replacement placement");
            transaction.commit().expect("archive commit");
        }
        let lifecycle: String = connection
            .query_row(
                "SELECT lifecycle FROM block_records WHERE id = 'before-000'",
                [],
                |row| row.get(0),
            )
            .expect("archived record");
        assert_eq!(lifecycle, "archived");
        let placement_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM block_placements WHERE block_id = 'before-000'",
                [],
                |row| row.get(0),
            )
            .expect("archived placement");
        assert_eq!(placement_count, 0);
    }

    #[test]
    fn failed_graph_validation_rolls_back_canonical_rows_and_commit() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_commit_schema(&connection).expect("commit schema");
        let mut graph = graph();
        let transaction = connection.transaction().expect("transaction");
        crate::infrastructure::block_record_store::ensure_data_source(
            &transaction,
            "board:test",
            "library:test",
        )
        .expect("data source");
        crate::infrastructure::block_record_store::write_graph(&transaction, &graph)
            .expect("seed graph");
        let error = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "move:cycle",
                BlockMutationOperation::Move {
                    block_id: "title-a".to_owned(),
                    target_parent: PlacementParent::Block("child-000".to_owned()),
                    rank_key: "a".to_owned(),
                    expected_block_revision: 0,
                    expected_placement_revision: 0,
                },
            ),
        )
        .expect_err("cycle");
        transaction.rollback().expect("rollback");
        assert_eq!(error.code, StoreErrorCode::InvalidInput);
        assert_eq!(
            graph.placement("title-a").expect("placement").parent,
            PlacementParent::Block("page-a".to_owned())
        );
        let (record_count, commit_count): (i64, i64) = connection
            .query_row(
                "SELECT (SELECT count(*) FROM block_records), \
                        (SELECT count(*) FROM local_commits)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("counts");
        assert_eq!((record_count, commit_count), (0, 0));
    }

    #[test]
    fn create_initializes_a_content_slot_before_the_first_editor_update() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_commit_schema(&connection).expect("commit schema");
        content_store::install_schema(&connection).expect("content schema");
        let mut graph = RecordGraph::new("library:test").expect("graph");
        let transaction = connection.transaction().expect("transaction");
        let created = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "create:block-a",
                BlockMutationOperation::Create {
                    block_id: "block:a".to_owned(),
                    kind: BlockKind::Paragraph,
                    properties: json!({"text": "hello"}),
                    content_shard_id: "shard:a".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "a".to_owned(),
                    view_id: None,
                    data_source_id: None,
                    view_group_key: None,
                    view_rank_key: None,
                    materialized_json: None,
                    placement_rebalances: Vec::new(),
                    view_rebalances: Vec::new(),
                },
            ),
        )
        .expect("create");
        transaction.commit().expect("create commit");
        assert_eq!(created.envelope.effects[0].kind, "record");

        let counts: (i64, i64, i64) = connection
            .query_row(
                "SELECT (SELECT count(*) FROM content_shards),
                        (SELECT count(*) FROM block_contents),
                        (SELECT count(*) FROM local_commits)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("content counts");
        assert_eq!(counts, (1, 1, 1));

        let (_, mut update) = content_update();
        update.block_id = "block:a".to_owned();
        update.shard_id = "shard:a".to_owned();
        update.update_id = "content-update:block-a".to_owned();
        let content_commit = {
            let transaction = connection.transaction().expect("content transaction");
            let committed = apply_content_mutation(
                &transaction,
                ContentMutationRequest {
                    commit: LocalCommitDraft {
                        store_epoch: "epoch:test".to_owned(),
                        commit_id: "commit:content-block-a".to_owned(),
                        operation_id: "operation:content-block-a".to_owned(),
                        intent_hash: hash("content-intent-block-a"),
                        canonical_hash: hash("content-canonical-block-a"),
                        actor_id: "actor:test".to_owned(),
                        session_id: "session:test".to_owned(),
                        committed_at: "2026-08-06T00:00:01Z".to_owned(),
                        effects: Vec::new(),
                        audience: json!({"kind": "library", "projectIds": []}),
                    },
                    content: update,
                },
            )
            .expect("first content update");
            transaction.commit().expect("content commit");
            committed
        };
        assert_eq!(content_commit.envelope.effects[0].kind, "content");
        let update_count: i64 = connection
            .query_row("SELECT count(*) FROM content_updates", [], |row| row.get(0))
            .expect("content update count");
        assert_eq!(update_count, 1);
    }

    #[test]
    fn materialized_content_edit_appends_the_same_crdt_history_as_a_rich_update() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_commit_schema(&connection).expect("commit schema");
        content_store::install_schema(&connection).expect("content schema");
        let mut graph = RecordGraph::new("library:test").expect("graph");
        {
            let transaction = connection.transaction().expect("create transaction");
            apply_block_mutation(
                &transaction,
                &mut graph,
                request(
                    "create:materialized",
                    BlockMutationOperation::Create {
                        block_id: "block:materialized".to_owned(),
                        kind: BlockKind::Paragraph,
                        properties: json!({}),
                        content_shard_id: "shard:materialized".to_owned(),
                        parent: PlacementParent::Library,
                        rank_key: "a".to_owned(),
                        view_id: None,
                        data_source_id: None,
                        view_group_key: None,
                        view_rank_key: None,
                        materialized_json: None,
                        placement_rebalances: Vec::new(),
                        view_rebalances: Vec::new(),
                    },
                ),
            )
            .expect("create");
            transaction.commit().expect("create commit");
        }
        let transaction = connection.transaction().expect("content transaction");
        apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "set-materialized:block",
                BlockMutationOperation::SetMaterializedContent {
                    block_id: "block:materialized".to_owned(),
                    slot: ContentSlot::Inline,
                    materialized_json: json!([{"type": "text", "text": "offline"}]),
                    expected_revision: 0,
                },
            ),
        )
        .expect("materialized content");
        transaction.commit().expect("content commit");

        let history: (i64, i64, i64, String) = connection
            .query_row(
                "SELECT
                   (SELECT count(*) FROM content_updates),
                   (SELECT head_seq FROM content_shards WHERE shard_id = 'shard:materialized'),
                   (SELECT revision FROM block_contents WHERE block_id = 'block:materialized' AND slot = 'inline'),
                   (SELECT materialized_json FROM block_content_materializations
                    WHERE block_id = 'block:materialized' AND slot = 'inline')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("materialized history");
        assert_eq!(history.0, 1);
        assert_eq!(history.1, 1);
        assert_eq!(history.2, 1);
        assert!(history.3.contains("offline"));
    }

    #[test]
    fn content_update_and_local_commit_are_one_transaction() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_commit_schema(&connection).expect("commit schema");
        content_store::install_schema(&connection).expect("content schema");
        let (snapshot, content) = content_update();
        {
            let transaction = connection.transaction().expect("seed transaction");
            content_store::create_shard(&transaction, "shard:a", "library:test", "t0")
                .expect("shard");
            transaction
                .execute(
                    "INSERT INTO block_records
                     (id, library_id, kind_json, lifecycle, properties_json, content_shard_id, revision)
                     VALUES ('block:a', 'library:test', '\"paragraph\"', 'active', '{}', 'shard:a', 0)",
                    [],
                )
                .expect("BlockRecord");
            content_store::write_snapshot(&transaction, &snapshot).expect("snapshot");
            transaction.commit().expect("seed commit");
        }

        let mutation = ContentMutationRequest {
            commit: LocalCommitDraft {
                store_epoch: "epoch:test".to_owned(),
                commit_id: "commit:content-a".to_owned(),
                operation_id: "operation:content-a".to_owned(),
                intent_hash: hash("content-intent"),
                canonical_hash: hash("content-canonical"),
                actor_id: "actor:test".to_owned(),
                session_id: "session:test".to_owned(),
                committed_at: "2026-08-06T00:00:00Z".to_owned(),
                effects: Vec::new(),
                audience: json!({"kind": "library", "projectIds": []}),
            },
            content: content.clone(),
        };
        let transaction = connection.transaction().expect("transaction");
        let committed = apply_content_mutation(&transaction, mutation.clone()).expect("content");
        transaction.commit().expect("commit");
        assert_eq!(committed.envelope.effects[0].kind, "content");

        let counts: (i64, i64) = connection
            .query_row(
                "SELECT (SELECT count(*) FROM content_updates),
                        (SELECT count(*) FROM local_commits)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("counts");
        assert_eq!(counts, (1, 1));

        let transaction = connection.transaction().expect("duplicate transaction");
        let duplicate = apply_content_mutation(&transaction, mutation).expect("duplicate");
        transaction.commit().expect("duplicate commit");
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.envelope, committed.envelope);
    }
}
