use serde::{Deserialize, Serialize};

use crate::{ModuleName, VersionedModuleContract};

pub const LIBRARY_CONTRACT_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryRead {
    Metadata,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LibrarySnapshot {
    pub profile_id: String,
    pub library_id: String,
    pub store_epoch: String,
    pub change_sequence: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryIntent {
    GrantProjectAccess {
        project_id: String,
        resource_id: String,
        access: LibraryAccess,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryAccess {
    Read,
    ReadWrite,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LibraryReceipt {
    pub operation_id: String,
    pub affected_resource_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LibraryEvent {
    pub kind: String,
    pub resource_ids: Vec<String>,
}

pub struct LibraryContract;

impl VersionedModuleContract for LibraryContract {
    type Read = LibraryRead;
    type Snapshot = LibrarySnapshot;
    type Intent = LibraryIntent;
    type Receipt = LibraryReceipt;
    type Event = LibraryEvent;

    const VERSION: u32 = LIBRARY_CONTRACT_VERSION;
    const MODULE: ModuleName = ModuleName::Library;
}
