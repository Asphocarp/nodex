//! Transport-neutral Core Module for the terminal BlockRecord slice.
//!
//! The Module owns the read window and mutation transaction boundary. HTTP,
//! IPC, and future sync adapters should translate their wire contracts into
//! these types instead of reimplementing graph/content/commit coordination.

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::agent::{
    AgentAuthorizationTarget, AgentExecutionAuthorization, AgentProjectResourceAction,
};
use nodex_core_contracts::database::{DatabaseIntent, DatabaseTransferTarget};

use crate::content_store::{self, ContentWindow};
use crate::domain::block_record::{
    BlockKind, BlockPlacement, BlockRecord, BlockViewPosition, PlacementParent, RecordGraph,
};
use crate::infrastructure::block_record_store;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::store::SqliteStoreKernel;
use crate::infrastructure::writer::{StoreReaders, StoreWriter};
use crate::local_commit::{AppendedLocalCommit, LocalCommitEnvelope};
use crate::mutation_kernel::{
    BlockMutationOperation, BlockMutationRequest, ContentMutationRequest,
    apply_block_mutation_with_database_context, apply_content_mutation,
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

    /// Reads a canonical window and authorizes the owning Page/Data Source in
    /// the same SQLite read transaction. This keeps Agent preparation and
    /// execution on one authority: a Library projection is not sufficient to
    /// authorize a BlockRecord window.
    pub fn read_selection_with_agent_authorization(
        &self,
        context: &BoundModuleContext,
        authorization: &AgentExecutionAuthorization,
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
        let context = context.clone();
        let authorization = authorization.clone();
        self.readers.read_default(move |connection| {
            let transaction = connection.unchecked_transaction()?;
            let graph = block_record_store::read_graph(&transaction, &library_id)?;
            let targets =
                read_authorization_targets(&graph, parent.as_ref(), block_ids.as_deref())?;
            let mut seen_targets = std::collections::BTreeSet::new();
            for target in targets {
                let key = format!("{target:?}");
                if seen_targets.insert(key) {
                    crate::library::agent_authorization::authorize_execution(
                        &transaction,
                        &context,
                        &library_id,
                        &authorization,
                        &target,
                        AgentProjectResourceAction::Read,
                    )?;
                }
            }
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
        self.apply_with_agent_authorization(request, None)
    }

    pub fn apply_with_agent_authorization(
        &self,
        request: BlockMutationRequest,
        agent: Option<(BoundModuleContext, AgentExecutionAuthorization)>,
    ) -> Result<AppendedLocalCommit, StoreError> {
        self.apply_with_context(None, request, agent)
    }

    pub fn apply_with_context(
        &self,
        context: Option<&BoundModuleContext>,
        request: BlockMutationRequest,
        agent: Option<(BoundModuleContext, AgentExecutionAuthorization)>,
    ) -> Result<AppendedLocalCommit, StoreError> {
        if request.store_epoch != self.store_epoch {
            return Err(StoreError::new(
                StoreErrorCode::StaleStoreEpoch,
                "BlockRecord mutation belongs to a different Store epoch",
                false,
            ));
        }
        if agent.as_ref().is_some_and(|(_, authorization)| {
            authorization.provenance.authority.store_epoch != self.store_epoch
        }) {
            return Err(StoreError::new(
                StoreErrorCode::StaleStoreEpoch,
                "Agent BlockRecord authorization belongs to a different Store epoch",
                false,
            ));
        }
        let library_id = self.library_id.clone();
        let context = context.cloned();
        self.writer.call(move |connection| {
            with_immediate_transaction(connection, |transaction| {
                let mut graph = block_record_store::read_graph(transaction, &library_id)?;
                if let Some((context, authorization)) = agent.as_ref() {
                    authorize_agent_operation(
                        transaction,
                        context,
                        &library_id,
                        authorization,
                        &request.operation,
                        &graph,
                    )?;
                }
                let database_context = context
                    .as_ref()
                    .or_else(|| agent.as_ref().map(|(context, _)| context));
                apply_block_mutation_with_database_context(
                    transaction,
                    &mut graph,
                    request,
                    database_context,
                )
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

    pub fn resolve_local_mutation(
        &self,
        operation_id: &str,
        intent_hash: &str,
    ) -> Result<Option<LocalCommitEnvelope>, StoreError> {
        if operation_id.trim().is_empty() || intent_hash.trim().is_empty() {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Local mutation resolution requires an operation and intent hash",
                false,
            ));
        }
        let store_epoch = self.store_epoch.clone();
        let operation_id = operation_id.to_owned();
        let intent_hash = intent_hash.to_owned();
        self.readers.read_default(|connection| {
            let Some(envelope) =
                crate::local_commit::find_by_operation(connection, &store_epoch, &operation_id)?
            else {
                return Ok(None);
            };
            if envelope.intent_hash != intent_hash {
                return Err(StoreError::new(
                    StoreErrorCode::IdempotencyKeyReused,
                    "Local mutation operation has a different intent hash",
                    false,
                ));
            }
            Ok(Some(envelope))
        })
    }

    pub fn local_commit_head(
        &self,
    ) -> Result<Option<crate::local_commit::LocalCommitCursor>, StoreError> {
        self.readers
            .read_default(|connection| crate::local_commit::head(connection, &self.store_epoch))
    }
}

fn read_authorization_targets(
    graph: &RecordGraph,
    parent: Option<&PlacementParent>,
    block_ids: Option<&[String]>,
) -> Result<Vec<AgentAuthorizationTarget>, StoreError> {
    if let Some(PlacementParent::DataSource(data_source_id)) = parent {
        return Ok(vec![AgentAuthorizationTarget::DataSource {
            data_source_id: data_source_id.clone(),
        }]);
    }
    if let Some(PlacementParent::Block(block_id)) = parent {
        return Ok(vec![owner_page_target(graph, block_id)?]);
    }
    if let Some(ids) = block_ids {
        if ids.is_empty() {
            return Err(StoreError::new(
                StoreErrorCode::InvalidInput,
                "Agent BlockRecord read has no target",
                false,
            ));
        }
        return ids.iter().map(|id| owner_page_target(graph, id)).collect();
    }
    Ok(vec![AgentAuthorizationTarget::Library {
        library_id: graph.library_id().to_owned(),
    }])
}

fn owner_page_target(
    graph: &RecordGraph,
    block_id: &str,
) -> Result<AgentAuthorizationTarget, StoreError> {
    let mut current = block_id.to_owned();
    let mut visited = std::collections::BTreeSet::new();
    loop {
        if !visited.insert(current.clone()) {
            return Err(StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Agent BlockRecord read encountered an ownership cycle",
                false,
            ));
        }
        let record = graph.block(&current).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::NotFound,
                "Agent BlockRecord target is unavailable",
                false,
            )
        })?;
        if matches!(record.kind, BlockKind::Page) {
            if !record.lifecycle.is_active() {
                return Err(unauthorized("Agent BlockRecord read target is not active"));
            }
            return Ok(AgentAuthorizationTarget::Page { page_id: current });
        }
        let placement = graph.placement(&current).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                "Agent BlockRecord target has no owning placement",
                false,
            )
        })?;
        match &placement.parent {
            PlacementParent::Block(parent_id) => current = parent_id.clone(),
            PlacementParent::DataSource(data_source_id) => {
                return Ok(AgentAuthorizationTarget::DataSource {
                    data_source_id: data_source_id.clone(),
                });
            }
            PlacementParent::Library => {
                return Ok(AgentAuthorizationTarget::Library {
                    library_id: graph.library_id().to_owned(),
                });
            }
        }
    }
}

fn authorize_agent_operation(
    connection: &rusqlite::Connection,
    context: &BoundModuleContext,
    library_id: &str,
    authorization: &AgentExecutionAuthorization,
    operation: &BlockMutationOperation,
    graph: &RecordGraph,
) -> Result<(), StoreError> {
    let mut created_ids = std::collections::BTreeSet::new();
    collect_created_ids(operation, &mut created_ids);
    let mut requirements = Vec::new();
    collect_agent_requirements(operation, graph, &created_ids, &mut requirements)?;
    let mut seen = std::collections::BTreeSet::new();
    for (target, action) in requirements {
        let key = format!("{:?}:{:?}", target, action);
        if !seen.insert(key) {
            continue;
        }
        crate::library::agent_authorization::authorize_execution(
            connection,
            context,
            library_id,
            authorization,
            &target,
            action,
        )?;
    }
    Ok(())
}

fn collect_created_ids(
    operation: &BlockMutationOperation,
    output: &mut std::collections::BTreeSet<String>,
) {
    match operation {
        BlockMutationOperation::Batch { operations } => {
            for operation in operations {
                collect_created_ids(operation, output);
            }
        }
        BlockMutationOperation::Create { block_id, .. } => {
            output.insert(block_id.clone());
        }
        BlockMutationOperation::CopySubtree {
            target_block_id, ..
        } => {
            output.insert(target_block_id.clone());
        }
        _ => {}
    }
}

fn collect_agent_requirements(
    operation: &BlockMutationOperation,
    graph: &RecordGraph,
    created_ids: &std::collections::BTreeSet<String>,
    output: &mut Vec<(AgentAuthorizationTarget, AgentProjectResourceAction)>,
) -> Result<(), StoreError> {
    match operation {
        BlockMutationOperation::Batch { operations } => {
            for operation in operations {
                collect_agent_requirements(operation, graph, created_ids, output)?;
            }
        }
        BlockMutationOperation::Create { parent, .. } => {
            output.push((
                parent_target(graph, parent)?,
                AgentProjectResourceAction::CreateChild,
            ));
        }
        BlockMutationOperation::Move {
            block_id,
            target_parent,
            ..
        } => {
            push_existing_root_requirement(block_id, graph, created_ids, output)?;
            output.push((
                parent_target(graph, target_parent)?,
                AgentProjectResourceAction::CreateChild,
            ));
        }
        BlockMutationOperation::MoveMany { entries, .. } => {
            for entry in entries {
                push_existing_root_requirement(&entry.block_id, graph, created_ids, output)?;
                output.push((
                    parent_target(graph, &entry.target_parent)?,
                    AgentProjectResourceAction::CreateChild,
                ));
            }
        }
        BlockMutationOperation::CopySubtree {
            source_block_id,
            target_parent,
            ..
        } => {
            if !created_ids.contains(source_block_id) {
                output.push((
                    page_target(graph, source_block_id)?,
                    AgentProjectResourceAction::Read,
                ));
            }
            output.push((
                parent_target(graph, target_parent)?,
                AgentProjectResourceAction::CreateChild,
            ));
        }
        BlockMutationOperation::UpdateRecord { block_id, .. }
        | BlockMutationOperation::ArchiveSubtree { block_id, .. }
        | BlockMutationOperation::SetMaterializedContent { block_id, .. } => {
            push_existing_write_requirement(block_id, graph, created_ids, output)?;
        }
        BlockMutationOperation::SetDataSourceValues { block_id, .. } => {
            // A property batch may follow PromoteManyToPage for an ordinary
            // Block in the same transaction. The preceding structural
            // operation already authorizes the source Move and Data Source
            // CreateChild; the pre-batch graph still quite correctly reports
            // this root as a non-Page, so do not ask page_target to authorize
            // a state that only exists after the earlier child operation.
            if !created_ids.contains(block_id)
                && graph
                    .block(block_id)
                    .is_some_and(|record| matches!(record.kind, BlockKind::Page))
            {
                push_existing_write_requirement(block_id, graph, created_ids, output)?;
            }
        }
        BlockMutationOperation::UpdateMany { entries, .. } => {
            for entry in entries {
                push_existing_write_requirement(&entry.block_id, graph, created_ids, output)?;
            }
        }
        BlockMutationOperation::RestoreSubtree {
            block_id,
            target_parent,
            ..
        } => {
            push_existing_write_requirement(block_id, graph, created_ids, output)?;
            output.push((
                parent_target(graph, target_parent)?,
                AgentProjectResourceAction::CreateChild,
            ));
        }
        BlockMutationOperation::PromoteToPage {
            block_id,
            data_source_id,
            ..
        } => {
            push_existing_root_requirement(block_id, graph, created_ids, output)?;
            output.push((
                AgentAuthorizationTarget::DataSource {
                    data_source_id: data_source_id.clone(),
                },
                AgentProjectResourceAction::CreateChild,
            ));
        }
        BlockMutationOperation::PromoteManyToPage {
            data_source_id,
            entries,
            ..
        } => {
            for entry in entries {
                push_existing_root_requirement(&entry.block_id, graph, created_ids, output)?;
            }
            output.push((
                AgentAuthorizationTarget::DataSource {
                    data_source_id: data_source_id.clone(),
                },
                AgentProjectResourceAction::CreateChild,
            ));
        }
        BlockMutationOperation::PlaceManyInDataSource {
            data_source_id,
            entries,
            ..
        } => {
            for entry in entries {
                push_existing_root_requirement(&entry.block_id, graph, created_ids, output)?;
            }
            output.push((
                AgentAuthorizationTarget::DataSource {
                    data_source_id: data_source_id.clone(),
                },
                AgentProjectResourceAction::CreateChild,
            ));
        }
        BlockMutationOperation::EnsureDataSource { data_source_id } => {
            output.push((
                AgentAuthorizationTarget::DataSource {
                    data_source_id: data_source_id.clone(),
                },
                AgentProjectResourceAction::ManageSchema,
            ));
        }
        BlockMutationOperation::ApplyDatabase { intents } => {
            for intent in intents {
                match intent {
                    DatabaseIntent::PutProperty { data_source_id, .. }
                    | DatabaseIntent::DeleteProperty { data_source_id, .. }
                    | DatabaseIntent::PutOption { data_source_id, .. }
                    | DatabaseIntent::DeleteOption { data_source_id, .. } => output.push((
                        AgentAuthorizationTarget::DataSource {
                            data_source_id: data_source_id.clone(),
                        },
                        AgentProjectResourceAction::ManageSchema,
                    )),
                    DatabaseIntent::EditPropertyValues { edits } => {
                        for edit in edits {
                            output.push((
                                AgentAuthorizationTarget::DataSource {
                                    data_source_id: edit.address.data_source_id.clone(),
                                },
                                AgentProjectResourceAction::Write,
                            ));
                        }
                    }
                    DatabaseIntent::PutView { database_id, .. }
                    | DatabaseIntent::DeleteView { database_id, .. } => output.push((
                        AgentAuthorizationTarget::Database {
                            database_id: database_id.clone(),
                        },
                        AgentProjectResourceAction::ManageViews,
                    )),
                    DatabaseIntent::PositionPage { view_id, .. }
                    | DatabaseIntent::PositionPages { view_id, .. } => output.push((
                        AgentAuthorizationTarget::View {
                            view_id: view_id.clone(),
                        },
                        AgentProjectResourceAction::Write,
                    )),
                    DatabaseIntent::TransferPage {
                        page_id, target, ..
                    } => {
                        push_existing_root_requirement(page_id, graph, created_ids, output)?;
                        match target {
                            DatabaseTransferTarget::Library { library_id } => output.push((
                                AgentAuthorizationTarget::Library {
                                    library_id: library_id.clone(),
                                },
                                AgentProjectResourceAction::CreateChild,
                            )),
                            DatabaseTransferTarget::Page { page_id } => output.push((
                                AgentAuthorizationTarget::Page {
                                    page_id: page_id.clone(),
                                },
                                AgentProjectResourceAction::CreateChild,
                            )),
                            DatabaseTransferTarget::DataSource { data_source_id } => output.push((
                                AgentAuthorizationTarget::DataSource {
                                    data_source_id: data_source_id.clone(),
                                },
                                AgentProjectResourceAction::Write,
                            )),
                        }
                    }
                }
            }
        }
        BlockMutationOperation::PersistAgentProjectResourceGrants { .. } => {}
        BlockMutationOperation::ReconcilePageTree { page_id, .. } => {
            if !created_ids.contains(page_id) {
                push_existing_write_requirement(page_id, graph, created_ids, output)?;
            }
        }
    }
    Ok(())
}

fn push_existing_root_requirement(
    block_id: &str,
    graph: &RecordGraph,
    created_ids: &std::collections::BTreeSet<String>,
    output: &mut Vec<(AgentAuthorizationTarget, AgentProjectResourceAction)>,
) -> Result<(), StoreError> {
    if created_ids.contains(block_id) {
        return Ok(());
    }
    output.push((
        page_target(graph, block_id)?,
        AgentProjectResourceAction::Move,
    ));
    Ok(())
}

fn push_existing_write_requirement(
    block_id: &str,
    graph: &RecordGraph,
    created_ids: &std::collections::BTreeSet<String>,
    output: &mut Vec<(AgentAuthorizationTarget, AgentProjectResourceAction)>,
) -> Result<(), StoreError> {
    if created_ids.contains(block_id) {
        return Ok(());
    }
    output.push((
        page_target(graph, block_id)?,
        AgentProjectResourceAction::Write,
    ));
    Ok(())
}

fn page_target(
    graph: &RecordGraph,
    block_id: &str,
) -> Result<AgentAuthorizationTarget, StoreError> {
    let Some(record) = graph.block(block_id) else {
        return Err(StoreError::new(
            StoreErrorCode::NotFound,
            "Agent BlockRecord target is unavailable",
            false,
        ));
    };
    if !matches!(record.kind, BlockKind::Page) || !record.lifecycle.is_active() {
        return Err(unauthorized(
            "Agent BlockRecord structural mutation requires a Page root",
        ));
    }
    Ok(AgentAuthorizationTarget::Page {
        page_id: block_id.to_owned(),
    })
}

fn parent_target(
    graph: &RecordGraph,
    parent: &PlacementParent,
) -> Result<AgentAuthorizationTarget, StoreError> {
    match parent {
        PlacementParent::Library => Ok(AgentAuthorizationTarget::Library {
            library_id: graph.library_id().to_owned(),
        }),
        PlacementParent::Block(block_id) => page_target(graph, block_id),
        PlacementParent::DataSource(data_source_id) => Ok(AgentAuthorizationTarget::DataSource {
            data_source_id: data_source_id.clone(),
        }),
    }
}

fn unauthorized(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
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
        assert_eq!(replay, vec![committed.envelope.clone()]);

        let resolved = module
            .resolve_local_mutation("operation:move", &hash("intent"))
            .expect("resolve local mutation")
            .expect("committed operation");
        assert_eq!(resolved, committed.envelope);
        let conflict = module
            .resolve_local_mutation("operation:move", &hash("different-intent"))
            .expect_err("intent mismatch");
        assert_eq!(conflict.code, StoreErrorCode::IdempotencyKeyReused);
    }

    #[test]
    fn agent_structural_requirements_cover_both_source_and_target() {
        let graph = RecordGraph::from_parts(
            "library:test",
            [
                BlockRecord {
                    id: "page:source".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:source".to_owned(),
                    revision: 1,
                },
                BlockRecord {
                    id: "page:target".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:target".to_owned(),
                    revision: 2,
                },
            ],
            [
                BlockPlacement {
                    block_id: "page:source".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "a".to_owned(),
                    revision: 1,
                },
                BlockPlacement {
                    block_id: "page:target".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "b".to_owned(),
                    revision: 1,
                },
            ],
        )
        .expect("valid Page graph");
        let operation = BlockMutationOperation::Move {
            block_id: "page:source".to_owned(),
            target_parent: PlacementParent::Block("page:target".to_owned()),
            rank_key: "a".to_owned(),
            expected_block_revision: 1,
            expected_placement_revision: 1,
        };
        let mut requirements = Vec::new();
        collect_agent_requirements(
            &operation,
            &graph,
            &std::collections::BTreeSet::new(),
            &mut requirements,
        )
        .expect("Agent requirements");
        assert!(requirements.contains(&(
            AgentAuthorizationTarget::Page {
                page_id: "page:source".to_owned(),
            },
            AgentProjectResourceAction::Move,
        )));
        assert!(requirements.contains(&(
            AgentAuthorizationTarget::Page {
                page_id: "page:target".to_owned(),
            },
            AgentProjectResourceAction::CreateChild,
        )));
    }

    #[test]
    fn agent_structural_requirements_reject_non_page_roots() {
        let graph = RecordGraph::from_parts(
            "library:test",
            [
                BlockRecord {
                    id: "block:source".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Paragraph,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:source".to_owned(),
                    revision: 1,
                },
                BlockRecord {
                    id: "page:target".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:target".to_owned(),
                    revision: 2,
                },
            ],
            [
                BlockPlacement {
                    block_id: "block:source".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "a".to_owned(),
                    revision: 1,
                },
                BlockPlacement {
                    block_id: "page:target".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "b".to_owned(),
                    revision: 1,
                },
            ],
        )
        .expect("valid graph");
        let operation = BlockMutationOperation::Move {
            block_id: "block:source".to_owned(),
            target_parent: PlacementParent::Block("page:target".to_owned()),
            rank_key: "a".to_owned(),
            expected_block_revision: 1,
            expected_placement_revision: 1,
        };
        let error = collect_agent_requirements(
            &operation,
            &graph,
            &std::collections::BTreeSet::new(),
            &mut Vec::new(),
        )
        .expect_err("ordinary Block cannot use Page Agent structural auth");
        assert_eq!(error.code, StoreErrorCode::Unauthorized);
    }

    #[test]
    fn canonical_agent_window_collects_every_distinct_owner_target() {
        let graph = RecordGraph::from_parts(
            "library:test",
            [
                BlockRecord {
                    id: "page:one".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:one".to_owned(),
                    revision: 1,
                },
                BlockRecord {
                    id: "block:one-child".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Paragraph,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:one".to_owned(),
                    revision: 1,
                },
                BlockRecord {
                    id: "page:two".to_owned(),
                    library_id: "library:test".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:two".to_owned(),
                    revision: 1,
                },
            ],
            [
                BlockPlacement {
                    block_id: "page:one".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "a".to_owned(),
                    revision: 1,
                },
                BlockPlacement {
                    block_id: "block:one-child".to_owned(),
                    parent: PlacementParent::Block("page:one".to_owned()),
                    rank_key: "a".to_owned(),
                    revision: 1,
                },
                BlockPlacement {
                    block_id: "page:two".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "b".to_owned(),
                    revision: 1,
                },
            ],
        )
        .expect("valid graph");

        let targets = read_authorization_targets(
            &graph,
            None,
            Some(&["block:one-child".to_owned(), "page:two".to_owned()]),
        )
        .expect("owner targets");
        assert_eq!(
            targets,
            vec![
                AgentAuthorizationTarget::Page {
                    page_id: "page:one".to_owned(),
                },
                AgentAuthorizationTarget::Page {
                    page_id: "page:two".to_owned(),
                },
            ]
        );
    }
}
