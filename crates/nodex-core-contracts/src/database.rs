use serde::{Deserialize, Serialize};

use crate::{ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseRead {
    Catalog,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseSnapshot {
    pub database_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseIntent {
    Rename { database_id: String, name: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseReceipt {
    pub affected_database_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DatabaseEvent {
    pub affected_database_ids: Vec<String>,
}

pub struct DatabaseContract;

impl VersionedModuleContract for DatabaseContract {
    type Read = DatabaseRead;
    type Snapshot = DatabaseSnapshot;
    type Intent = DatabaseIntent;
    type Receipt = DatabaseReceipt;
    type Event = DatabaseEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::Database;
}
