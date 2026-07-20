use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::agent::{
    AgentExecutionAuthorization, AgentOperationPreparation, AgentPreparedExecution,
};
use crate::{
    CommittedModuleValue, ModuleMutationReceipt, ModuleName, StoreEpoch, VersionedModuleContract,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentDocumentSemanticMutation {
    pub document_id: String,
    pub generation: i64,
    pub expected_head_seq: i64,
    pub allow_deleting_owned_blocks: bool,
    pub commands: Vec<DocumentSemanticCommand>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocumentSemanticAnchor {
    Start { parent_block_id: Option<String> },
    End { parent_block_id: Option<String> },
    Before { block_id: String },
    After { block_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OwnedDocumentRead {
    Descriptor {
        owner_block_id: String,
    },
    SyncYjs {
        document_id: String,
        state_vector: Vec<u8>,
    },
    SyncCanvas {
        document_id: String,
    },
    ListVersions {
        document_id: String,
        before: Option<DocumentVersionCursor>,
        limit: Option<u32>,
    },
    GetVersion {
        document_id: String,
        version_id: String,
    },
    PrepareAgentSemanticMutation {
        operation_id: String,
        store_epoch: StoreEpoch,
        authorization: Box<AgentExecutionAuthorization>,
        mutation: Box<AgentDocumentSemanticMutation>,
    },
    AgentSemanticSnapshot {
        store_epoch: StoreEpoch,
        authorization: Box<AgentExecutionAuthorization>,
        document_id: String,
        target_block_id: String,
        prepare_title: bool,
        prepare_body: bool,
        block_guards: Vec<AgentDocumentBlockGuard>,
        max_depth: Option<u32>,
        cursor: Option<String>,
        limit: Option<u32>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OwnedDocumentReadValue {
    Descriptor {
        descriptor: Value,
    },
    YjsSync {
        descriptor: Value,
        update: Vec<u8>,
    },
    CanvasSync {
        descriptor: Value,
        scene_json: Vec<u8>,
        scene_hash: String,
    },
    Versions {
        items: Vec<Value>,
        next: Option<DocumentVersionCursor>,
    },
    Version {
        value: Value,
    },
    AgentSemanticMutationPreparation {
        preparation: AgentOperationPreparation,
        #[serde(skip_serializing_if = "Option::is_none")]
        committed:
            Option<Box<CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>>>,
    },
    AgentSemanticSnapshot {
        snapshot: Box<AgentDocumentSemanticSnapshot>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentDocumentBlockGuardKind {
    Update,
    Delete,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentDocumentBlockGuard {
    pub block_id: String,
    pub kind: AgentDocumentBlockGuardKind,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct AgentDocumentSemanticBlock {
    pub block_id: String,
    pub parent_block_id: Option<String>,
    pub sibling_index: u32,
    pub depth: u32,
    pub block_type: String,
    pub props: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct AgentDocumentSemanticSnapshot {
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
    pub owner_block_id: String,
    pub target_block_id: String,
    pub title: String,
    pub rich_title: Value,
    pub nested_markdown: String,
    pub plain_text: String,
    pub blocks: Vec<AgentDocumentSemanticBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_etag: Option<String>,
    pub has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OwnedDocumentIntent {
    PrepareOwner {
        owner_block_id: String,
    },
    ApplyYjsUpdate {
        document_id: String,
        generation: i64,
        base_head_seq: i64,
        update_id: String,
        touched_block_ids: Vec<String>,
        update: Vec<u8>,
    },
    ApplySemanticMutation {
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
        commands: Vec<DocumentSemanticCommand>,
    },
    ApplyOperationBatch {
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
        operations: Vec<DocumentBlockOperation>,
        actor: Value,
        write_fence_prepared: bool,
    },
    ReplaceFromNfm {
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
        nfm: String,
        rich_title: Option<Vec<Value>>,
        actor: Value,
        write_fence_prepared: bool,
    },
    ExecutePreparedAgentSemanticMutation {
        authorization: Box<AgentPreparedExecution>,
        mutation: Box<AgentDocumentSemanticMutation>,
    },
    ApplyCanvasMutation {
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
        mutation: Value,
    },
    CreateCheckpoint {
        document_id: String,
        generation: i64,
        expected_head_seq: i64,
        cause: String,
        label: Option<String>,
        actor: Value,
        revision_kind: Option<DocumentRevisionKind>,
        source_mutation_id: Option<String>,
        source_change_seq: Option<i64>,
    },
    RestoreVersion {
        document_id: String,
        version_id: String,
        generation: i64,
        expected_head_seq: i64,
        actor: Value,
        write_fence_prepared: bool,
    },
    ApplyOwnerCommand {
        command: DocumentOwnerCommand,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentVersionCursor {
    pub base_head_seq: i64,
    pub created_at: String,
    pub version_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentRevisionKind {
    Automatic,
    Manual,
    Operation,
    Restore,
    Safety,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocumentSemanticCommand {
    SetTitle {
        inline_markdown: String,
        expected_etag: String,
    },
    PatchBody {
        old_fragment: String,
        new_fragment: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        expected_matches: Option<u32>,
    },
    InsertBody {
        anchor: DocumentSemanticAnchor,
        nested_markdown: String,
    },
    ReplaceBody {
        nested_markdown: String,
        expected_etag: String,
    },
    InsertBlock {
        anchor: DocumentSemanticAnchor,
        block: DocumentSemanticBlockDraft,
    },
    UpdateBlock {
        block_id: String,
        expected_etag: String,
        patch: DocumentBlockUpdatePatch,
    },
    DeleteBlock {
        block_id: String,
        expected_etag: String,
    },
    MoveBlock {
        block_id: String,
        anchor: DocumentSemanticAnchor,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DocumentSemanticBlockDraft {
    pub local_id: String,
    pub block_type: String,
    pub props: BTreeMap<String, Value>,
    pub content: DocumentOptionalValue,
    #[schema(no_recursion)]
    pub children: Vec<DocumentSemanticBlockDraft>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DocumentOptionalValue {
    Absent,
    Value { value: Value },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DocumentBlockUpdatePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub props: Option<BTreeMap<String, Value>>,
    pub content: DocumentOptionalValue,
    pub unset_content: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocumentBlockOperation {
    SetTitle {
        title: String,
    },
    SetRichTitle {
        rich_title: Vec<Value>,
    },
    InsertBlock {
        block: Value,
        parent_block_id: Option<String>,
        before_block_id: Option<String>,
    },
    UpdateBlock {
        block_id: String,
        patch: DocumentBlockUpdatePatch,
    },
    DeleteBlock {
        block_id: String,
    },
    MoveBlock {
        block_id: String,
        parent_block_id: Option<String>,
        before_block_id: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DocumentOwnerCommand {
    CreateSyncedSource {
        source_block_id: String,
        document_id: String,
        initial_blocks: Vec<Value>,
        before: Option<DocumentSpaceAnchor>,
    },
    PromoteSyncedSource {
        host: DocumentHeadRevision,
        root_block_id: String,
        reference_block_id: String,
        source_block_id: String,
        source_document_id: String,
    },
    DemoteSyncedSource {
        host: DocumentHeadRevision,
        source: DocumentHeadRevision,
        reference_block_id: String,
        source_block_id: String,
    },
    CreateTemplate {
        source_block_id: String,
        document_id: String,
        display_name: String,
        initial_blocks: Vec<Value>,
        before: Option<DocumentSpaceAnchor>,
    },
    InstantiateTemplate {
        source_block_id: String,
        source: DocumentHeadRevision,
        target: DocumentHeadRevision,
        parent_block_id: Option<String>,
        before_block_id: Option<String>,
    },
    DeleteOwnedSource {
        owner_kind: DeletableOwnedSourceKind,
        owner: DocumentOwnerRevision,
    },
    CreateCanvasOwner {
        block_id: String,
        document_id: String,
        display_name: String,
        before: Option<DocumentSpaceAnchor>,
    },
    DeleteCanvasOwner {
        owner: DocumentOwnerRevision,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentHeadRevision {
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentOwnerRevision {
    pub owner_block_id: String,
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
    pub metadata_revision: i64,
    pub location_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentSpaceAnchor {
    pub block_id: String,
    pub expected_location_revision: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeletableOwnedSourceKind {
    SyncedBlock,
    ReusableTemplate,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentOwnerEffect {
    pub created_block_ids: Vec<String>,
    pub preserved_block_ids: Vec<String>,
    pub deleted_block_ids: Vec<String>,
    pub document_heads: Vec<DocumentHeadRevision>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct OwnedDocumentCommitValue {
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
    pub outcome: DocumentCommitOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_effect: Option<DocumentOwnerEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_effect: Option<DocumentCheckpointEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_effect: Option<DocumentMutationEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_etags: Option<DocumentSemanticEtags>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_block_etags: Option<BTreeMap<String, DocumentSemanticBlockEtags>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_local_block_ids: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_deleted_owner_block_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentSemanticEtags {
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentSemanticBlockEtags {
    pub update: String,
    pub delete: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentCheckpointEffect {
    pub checkpoint: Value,
    pub duplicate: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentMutationCoordination {
    MergeFriendly,
    WriteFence,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DocumentMutationEffect {
    pub base_head_seq: i64,
    pub touched_block_ids: Vec<String>,
    pub created_block_ids: Vec<String>,
    pub deleted_block_ids: Vec<String>,
    pub updated_block_ids: Vec<String>,
    pub moved_block_ids: Vec<String>,
    pub write_fence_block_ids: Vec<String>,
    pub title_changed: bool,
    pub coordination: DocumentMutationCoordination,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentCommitOutcome {
    Committed,
    NoChange,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct OwnedDocumentReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OwnedDocumentEvent {
    DocumentUpdated {
        document_id: String,
        generation: i64,
        head_seq: i64,
        update: Vec<u8>,
    },
    CanvasUpdated {
        document_id: String,
        generation: i64,
        base_head_seq: i64,
        head_seq: i64,
        scene_hash: String,
        mutation: Value,
    },
    DocumentInvalidated {
        document_id: String,
        reason: DocumentInvalidationReason,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentInvalidationReason {
    AccessChanged,
    GenerationChanged,
    Restored,
}

pub struct OwnedDocumentContract;

impl VersionedModuleContract for OwnedDocumentContract {
    type Read = OwnedDocumentRead;
    type Snapshot = OwnedDocumentReadValue;
    type Intent = OwnedDocumentIntent;
    type Receipt = OwnedDocumentReceipt;
    type Event = OwnedDocumentEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::OwnedDocument;
}
