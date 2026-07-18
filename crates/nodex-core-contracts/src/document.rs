use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

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
        before_version_id: Option<String>,
        limit: Option<u32>,
    },
    GetVersion {
        document_id: String,
        version_id: String,
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
        next_version_id: Option<String>,
    },
    Version {
        value: Value,
    },
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
    },
    RestoreVersion {
        document_id: String,
        version_id: String,
        generation: i64,
        expected_head_seq: i64,
    },
    ApplyOwnerCommand {
        owner_block_id: String,
        command: DocumentOwnerCommand,
    },
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
    },
    ReplaceBody {
        nested_markdown: String,
        expected_etag: String,
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
    CreateSecondaryDocument { document_id: String, schema: String },
    ArchiveDocument { document_id: String },
    RestoreDocument { document_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct OwnedDocumentCommitValue {
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
    pub outcome: DocumentCommitOutcome,
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
