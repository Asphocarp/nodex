//! The first structural MutationKernel vertical slice.
//!
//! The kernel is transport-neutral. A future Core module can bind its request
//! contract to these operations, but it must not reimplement the graph and
//! LocalCommit transaction boundary in a Library or Board adapter.

use rusqlite::Transaction;
use serde_json::json;

use crate::content_store::{ContentUpdateRequest, append_update};
use crate::domain::block_record::{BlockKind, BlockRecordErrorCode, PlacementParent, RecordGraph};
use crate::infrastructure::block_record_store::{update_block_record, update_placement};
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
    Move {
        block_id: String,
        target_parent: PlacementParent,
        rank_key: String,
        expected_block_revision: u64,
        expected_placement_revision: u64,
    },
    PromoteToPage {
        block_id: String,
        data_source_id: String,
        rank_key: String,
        expected_block_revision: u64,
        expected_placement_revision: u64,
    },
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
    let (block_id, effect) = match apply_operation(graph, &request.operation) {
        Ok(result) => result,
        Err(error) => {
            *graph = previous;
            return Err(error);
        }
    };
    persist_delta(transaction, &previous, graph, &request.operation)?;
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
            effects: vec![effect],
            audience: request.audience,
        },
    );
    if result.is_err() {
        *graph = previous;
    }
    result.map(|committed| {
        debug_assert_eq!(committed.envelope.effects[0].value["blockId"], block_id);
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
) -> Result<(), StoreError> {
    let block_id = match operation {
        BlockMutationOperation::Move { block_id, .. }
        | BlockMutationOperation::PromoteToPage { block_id, .. } => block_id,
    };
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
        update_block_record(transaction, previous_record, next_record)?;
    }
    update_placement(transaction, previous_placement, next_placement)
}

fn apply_operation(
    graph: &mut RecordGraph,
    operation: &BlockMutationOperation,
) -> Result<(String, LocalCommitEffect), StoreError> {
    match operation {
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
            Ok((
                block_id.clone(),
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
            ))
        }
        BlockMutationOperation::PromoteToPage {
            block_id,
            data_source_id,
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
            Ok((
                block_id.clone(),
                LocalCommitEffect {
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
                    }),
                },
            ))
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
    use yrs::{ReadTxn, StateVector, Text, Transact, WriteTxn};

    use super::*;
    use crate::content_store::{self, ContentSlot, ContentSnapshot, ContentUpdateRequest};
    use crate::document::create_compatible_document;
    use crate::domain::block_record::{BlockLifecycle, BlockRecord};
    use crate::infrastructure::block_record_store::install_schema as install_graph_schema;
    use crate::local_commit::{LocalCommitDraft, install_schema as install_commit_schema};

    fn hash(value: &str) -> String {
        format!("{:x}", Sha256::digest(value.as_bytes()))
    }

    fn graph() -> RecordGraph {
        let mut graph = RecordGraph::new("library:test").expect("graph");
        graph
            .insert(
                BlockRecord {
                    id: "page-a".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({"title": "Page A"}),
                    content_shard_id: "shard:page-a".to_owned(),
                    revision: 0,
                },
                crate::domain::block_record::BlockPlacement {
                    block_id: "page-a".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "a".to_owned(),
                    revision: 0,
                },
            )
            .expect("page");
        graph
            .insert(
                BlockRecord {
                    id: "title-a".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Heading,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({"level": 1}),
                    content_shard_id: "shard:title-a".to_owned(),
                    revision: 0,
                },
                crate::domain::block_record::BlockPlacement {
                    block_id: "title-a".to_owned(),
                    parent: PlacementParent::Block("page-a".to_owned()),
                    rank_key: "a".to_owned(),
                    revision: 0,
                },
            )
            .expect("title");
        for index in 0..100 {
            let id = format!("child-{index:03}");
            graph
                .insert(
                    BlockRecord {
                        id: id.clone(),
                        library_id: "library:test".to_owned(),
                        kind: BlockKind::Paragraph,
                        lifecycle: BlockLifecycle::Active,
                        properties: json!({"index": index}),
                        content_shard_id: format!("shard:{id}"),
                        revision: 0,
                    },
                    crate::domain::block_record::BlockPlacement {
                        block_id: id,
                        parent: PlacementParent::Block("title-a".to_owned()),
                        rank_key: format!("{index:03}"),
                        revision: 0,
                    },
                )
                .expect("child");
        }
        graph
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
        install_commit_schema(&connection).expect("commit schema");
        let mut graph = graph();
        let descendant_ids = graph.descendant_ids("title-a").expect("descendants");
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
        let transaction = connection.transaction().expect("transaction");
        let result = apply_block_mutation(
            &transaction,
            &mut graph,
            request(
                "promote:title-a",
                BlockMutationOperation::PromoteToPage {
                    block_id: "title-a".to_owned(),
                    data_source_id: "board:test".to_owned(),
                    rank_key: "a".to_owned(),
                    expected_block_revision: 0,
                    expected_placement_revision: 0,
                },
            ),
        )
        .expect("promotion");
        transaction.commit().expect("commit");

        assert!(!result.duplicate);
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
        assert_eq!(record_count, 102);
        assert_eq!(placement_count, 102);
        assert_eq!(commit_count, 1);
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
    }

    #[test]
    fn failed_graph_validation_rolls_back_canonical_rows_and_commit() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_graph_schema(&connection).expect("graph schema");
        install_commit_schema(&connection).expect("commit schema");
        let mut graph = graph();
        let transaction = connection.transaction().expect("transaction");
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
