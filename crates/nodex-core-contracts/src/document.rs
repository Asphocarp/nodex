use serde::{Deserialize, Serialize};

use crate::{ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OwnedDocumentRead {
    Sync {
        document_id: String,
        state_vector: Vec<u8>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct OwnedDocumentSnapshot {
    pub document_id: String,
    pub generation: i64,
    pub head_sequence: i64,
    pub update: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OwnedDocumentIntent {
    ApplyUpdate {
        document_id: String,
        generation: i64,
        update_id: String,
        update: Vec<u8>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct OwnedDocumentReceipt {
    pub document_id: String,
    pub generation: i64,
    pub head_sequence: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct OwnedDocumentEvent {
    pub document_id: String,
    pub generation: i64,
    pub head_sequence: i64,
}

pub struct OwnedDocumentContract;

impl VersionedModuleContract for OwnedDocumentContract {
    type Read = OwnedDocumentRead;
    type Snapshot = OwnedDocumentSnapshot;
    type Intent = OwnedDocumentIntent;
    type Receipt = OwnedDocumentReceipt;
    type Event = OwnedDocumentEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::Document;
}
