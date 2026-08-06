//! Transport-neutral Core Module for the terminal BlockRecord slice.
//!
//! The Module owns the read window and mutation transaction boundary. HTTP,
//! IPC, and future sync adapters should translate their wire contracts into
//! these types instead of reimplementing graph/content/commit coordination.

use crate::content_store::{self, ContentWindow};
use crate::domain::block_record::{
    BlockPlacement, BlockRecord, BlockViewPosition, PlacementParent, RecordGraph,
};
use crate::infrastructure::block_record_store;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};
use crate::local_commit::{AppendedLocalCommit, LocalCommitEnvelope};
use crate::mutation_kernel::{
    BlockMutationRequest, ContentMutationRequest, apply_block_mutation, apply_content_mutation,
};

#[derive(Clone, Debug)]
pub struct BlockRecordReadWindow {
    pub graph: RecordGraph,
    pub content: ContentWindow,
}

#[derive(Clone, Debug)]
pub struct BlockRecordSelection {
    pub library_id: String,
    pub blocks: Vec<BlockRecord>,
    pub placements: Vec<BlockPlacement>,
    pub view_positions: Vec<BlockViewPosition>,
    pub content: ContentWindow,
}

#[derive(Clone)]
pub struct BlockRecordModule {
    profile_id: String,
    library_id: String,
    store_epoch: String,
    readers: StoreReaders,
    writer: StoreWriter,
}

impl BlockRecordModule {
    pub fn new(
        profile_id: impl Into<String>,
        library_id: impl Into<String>,
        store_epoch: impl Into<String>,
        kernel: &SqliteStoreKernel,
    ) -> Self {
        Self {
            profile_id: profile_id.into(),
            library_id: library_id.into(),
            store_epoch: store_epoch.into(),
            readers: kernel.readers(),
            writer: kernel.writer(),
        }
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub fn library_id(&self) -> &str {
        &self.library_id
    }

    pub fn store_epoch(&self) -> &str {
        &self.store_epoch
    }

    /// Installs the terminal slice as one explicit bootstrap operation.
    ///
    /// Production schema bootstrap will call this from the terminal store
    /// replacement path. It is intentionally not hidden in this constructor:
    /// opening a Module must never mutate schema behind the caller's back.
    pub fn install_schema(&self) -> Result<(), StoreError> {
        self.writer.call(|connection| {
            with_immediate_transaction(connection, |transaction| {
                block_record_store::install_schema(transaction)?;
                block_record_store::install_view_position_schema(transaction)?;
                crate::local_commit::install_schema(transaction)?;
                content_store::install_schema(transaction)?;
                content_store::install_materialization_schema(transaction)
            })
        })
    }

    pub fn read_window(&self) -> Result<BlockRecordReadWindow, StoreError> {
        let library_id = self.library_id.clone();
        self.readers.read_default(move |connection| {
            let graph = block_record_store::read_graph(connection, &library_id)?;
            let block_ids = graph
                .blocks()
                .map(|block| block.id.as_str())
                .collect::<Vec<_>>();
            let content = content_store::read_window(connection, &library_id, Some(&block_ids))?;
            Ok(BlockRecordReadWindow { graph, content })
        })
    }

    pub fn read_selection(
        &self,
        parent: Option<&PlacementParent>,
        block_ids: Option<&[String]>,
        include_content: bool,
    ) -> Result<BlockRecordSelection, StoreError> {
        self.read_selection_with_cursor(parent, block_ids, include_content)
            .map(|(selection, _)| selection)
    }

    /// Reads the graph window and its LocalCommit head from one SQLite read
    /// transaction. A cursor is only useful as a floor if the rows it
    /// describes were observed in the same snapshot; two independent reader
    /// statements could otherwise label stale graph data with a newer cursor.
    pub fn read_selection_with_cursor(
        &self,
        parent: Option<&PlacementParent>,
        block_ids: Option<&[String]>,
        include_content: bool,
    ) -> Result<
        (
            BlockRecordSelection,
            Option<crate::local_commit::LocalCommitCursor>,
        ),
        StoreError,
    > {
        self.read_selection_with_cursor_and_view(parent, block_ids, include_content, None)
    }

    pub fn read_selection_with_cursor_and_view(
        &self,
        parent: Option<&PlacementParent>,
        block_ids: Option<&[String]>,
        include_content: bool,
        view_id: Option<&str>,
    ) -> Result<
        (
            BlockRecordSelection,
            Option<crate::local_commit::LocalCommitCursor>,
        ),
        StoreError,
    > {
        self.read_selection_with_cursor_and_view_and_descendants(
            parent,
            block_ids,
            include_content,
            view_id,
            false,
        )
    }

    pub fn read_selection_with_cursor_and_view_and_descendants(
        &self,
        parent: Option<&PlacementParent>,
        block_ids: Option<&[String]>,
        include_content: bool,
        view_id: Option<&str>,
        include_descendants: bool,
    ) -> Result<
        (
            BlockRecordSelection,
            Option<crate::local_commit::LocalCommitCursor>,
        ),
        StoreError,
    > {
        self.read_selection_with_cursor_and_view_and_descendants_and_lifecycle(
            parent,
            block_ids,
            include_content,
            view_id,
            include_descendants,
            false,
        )
    }

    pub fn read_selection_with_cursor_and_view_and_descendants_and_lifecycle(
        &self,
        parent: Option<&PlacementParent>,
        block_ids: Option<&[String]>,
        include_content: bool,
        view_id: Option<&str>,
        include_descendants: bool,
        include_archived: bool,
    ) -> Result<
        (
            BlockRecordSelection,
            Option<crate::local_commit::LocalCommitCursor>,
        ),
        StoreError,
    > {
        let library_id = self.library_id.clone();
        let parent = parent.cloned();
        let block_ids = block_ids.map(ToOwned::to_owned);
        let view_id = view_id.map(ToOwned::to_owned);
        let store_epoch = self.store_epoch.clone();
        self.readers.read_default(move |connection| {
            let transaction = connection.unchecked_transaction()?;
            let (blocks, placements) =
                block_record_store::read_selection_with_descendants_and_lifecycle(
                    &transaction,
                    &library_id,
                    parent.as_ref(),
                    block_ids.as_deref(),
                    include_descendants,
                    include_archived,
                )?;
            let content = if include_content {
                let ids = blocks
                    .iter()
                    .map(|block| block.id.as_str())
                    .collect::<Vec<_>>();
                content_store::read_window(&transaction, &library_id, Some(&ids))?
            } else {
                ContentWindow {
                    library_id: library_id.clone(),
                    records: Vec::new(),
                }
            };
            let view_positions = match (view_id.as_deref(), parent.as_ref()) {
                (Some(view_id), Some(PlacementParent::DataSource(data_source_id))) => {
                    block_record_store::read_view_positions(
                        &transaction,
                        &library_id,
                        view_id,
                        data_source_id,
                        Some(
                            &blocks
                                .iter()
                                .map(|block| block.id.clone())
                                .collect::<Vec<_>>(),
                        ),
                    )?
                }
                _ => Vec::new(),
            };
            let selection = BlockRecordSelection {
                library_id,
                blocks,
                placements,
                view_positions,
                content,
            };
            let cursor = crate::local_commit::head(&transaction, &store_epoch)?;
            transaction.commit()?;
            Ok((selection, cursor))
        })
    }

    pub fn apply(&self, request: BlockMutationRequest) -> Result<AppendedLocalCommit, StoreError> {
        if request.store_epoch != self.store_epoch {
            return Err(StoreError::new(
                StoreErrorCode::StaleStoreEpoch,
                "BlockRecord mutation belongs to a different Store epoch",
                false,
            ));
        }
        let library_id = self.library_id.clone();
        self.writer.call(move |connection| {
            with_immediate_transaction(connection, |transaction| {
                let mut graph = block_record_store::read_graph(transaction, &library_id)?;
                apply_block_mutation(transaction, &mut graph, request)
            })
        })
    }

    pub fn apply_content(
        &self,
        request: ContentMutationRequest,
    ) -> Result<AppendedLocalCommit, StoreError> {
        if request.commit.store_epoch != self.store_epoch {
            return Err(StoreError::new(
                StoreErrorCode::StaleStoreEpoch,
                "Content mutation belongs to a different Store epoch",
                false,
            ));
        }
        self.writer.call(move |connection| {
            with_immediate_transaction(connection, |transaction| {
                apply_content_mutation(transaction, request)
            })
        })
    }

    pub fn read_local_commits_after(
        &self,
        cursor: &crate::local_commit::LocalCommitCursor,
        limit: i64,
    ) -> Result<Vec<LocalCommitEnvelope>, StoreError> {
        self.readers
            .read_default(|connection| crate::local_commit::read_after(connection, cursor, limit))
    }

    pub fn local_commit_head(
        &self,
    ) -> Result<Option<crate::local_commit::LocalCommitCursor>, StoreError> {
        self.readers
            .read_default(|connection| crate::local_commit::head(connection, &self.store_epoch))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::*;
    use crate::domain::block_record::{
        BlockKind, BlockLifecycle, BlockPlacement, BlockRecord, PlacementParent,
    };
    use crate::infrastructure::block_record_store;
    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::local_commit::LocalCommitCursor;
    use crate::mutation_kernel::BlockMutationOperation;

    fn hash(value: &str) -> String {
        format!("{:x}", Sha256::digest(value.as_bytes()))
    }

    fn request(
        expected_block_revision: u64,
        expected_placement_revision: u64,
    ) -> BlockMutationRequest {
        BlockMutationRequest {
            store_epoch: "epoch:test".to_owned(),
            operation_id: "operation:move".to_owned(),
            intent_hash: hash("intent"),
            commit_id: "commit:move".to_owned(),
            canonical_hash: hash("canonical"),
            actor_id: "actor:test".to_owned(),
            session_id: "session:test".to_owned(),
            committed_at: "2026-08-06T00:00:00Z".to_owned(),
            audience: json!({"kind": "library", "projectIds": []}),
            operation: BlockMutationOperation::Move {
                block_id: "block:a".to_owned(),
                target_parent: PlacementParent::Block("block:target".to_owned()),
                rank_key: "b".to_owned(),
                expected_block_revision,
                expected_placement_revision,
            },
        }
    }

    #[test]
    fn module_read_and_apply_share_the_same_graph_commit_boundary() {
        let directory = tempdir().expect("profile");
        let kernel = SqliteStoreKernel::open(directory.path()).expect("kernel");
        let module = BlockRecordModule::new("profile:test", "library:test", "epoch:test", &kernel);
        module.install_schema().expect("terminal schema");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    let mut graph = RecordGraph::new("library:test").expect("graph");
                    graph
                        .insert(
                            BlockRecord {
                                id: "block:target".to_owned(),
                                library_id: "library:test".to_owned(),
                                kind: BlockKind::Page,
                                lifecycle: BlockLifecycle::Active,
                                properties: json!({}),
                                content_shard_id: "shard:a".to_owned(),
                                revision: 0,
                            },
                            BlockPlacement {
                                block_id: "block:target".to_owned(),
                                parent: PlacementParent::Library,
                                rank_key: "a".to_owned(),
                                revision: 0,
                            },
                        )
                        .expect("target");
                    graph
                        .insert(
                            BlockRecord {
                                id: "block:a".to_owned(),
                                library_id: "library:test".to_owned(),
                                kind: BlockKind::Paragraph,
                                lifecycle: BlockLifecycle::Active,
                                properties: json!({}),
                                content_shard_id: "shard:a".to_owned(),
                                revision: 0,
                            },
                            BlockPlacement {
                                block_id: "block:a".to_owned(),
                                parent: PlacementParent::Library,
                                rank_key: "b".to_owned(),
                                revision: 0,
                            },
                        )
                        .expect("block");
                    block_record_store::write_graph(transaction, &graph)
                })
            })
            .expect("seed graph");

        let before = module.read_window().expect("read before");
        assert_eq!(before.graph.blocks().count(), 2);
        let committed = module.apply(request(0, 0)).expect("move");
        assert_eq!(committed.envelope.cursor.commit_seq, 1);
        assert_eq!(
            committed
                .envelope
                .effects
                .iter()
                .map(|effect| effect.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["record", "placement"]
        );

        let after = module.read_window().expect("read after");
        assert_eq!(
            after.graph.placement("block:a").expect("placement").parent,
            PlacementParent::Block("block:target".to_owned())
        );
        let replay = module
            .read_local_commits_after(
                &LocalCommitCursor {
                    store_epoch: "epoch:test".to_owned(),
                    commit_seq: 0,
                },
                10,
            )
            .expect("replay");
        assert_eq!(replay, vec![committed.envelope]);
    }
}
