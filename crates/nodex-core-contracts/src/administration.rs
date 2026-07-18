use serde::{Deserialize, Serialize};

use crate::{ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StoreAdministrationRead {
    Health,
    Backups,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StoreAdministrationSnapshot {
    pub schema_version: u32,
    pub store_epoch: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StoreAdministrationIntent {
    CreateBackup { label: Option<String> },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StoreAdministrationReceipt {
    pub backup_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StoreAdministrationEvent {
    pub backup_id: String,
}

pub struct StoreAdministrationContract;

impl VersionedModuleContract for StoreAdministrationContract {
    type Read = StoreAdministrationRead;
    type Snapshot = StoreAdministrationSnapshot;
    type Intent = StoreAdministrationIntent;
    type Receipt = StoreAdministrationReceipt;
    type Event = StoreAdministrationEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::Administration;
}
