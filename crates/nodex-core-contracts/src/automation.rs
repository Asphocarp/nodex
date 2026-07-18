use serde::{Deserialize, Serialize};

use crate::{ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationRead {
    Due { before: String, limit: u32 },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AutomationSnapshot {
    pub automation_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationIntent {
    CompleteLease { lease_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AutomationReceipt {
    pub lease_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AutomationEvent {
    pub lease_id: String,
}

pub struct AutomationContract;

impl VersionedModuleContract for AutomationContract {
    type Read = AutomationRead;
    type Snapshot = AutomationSnapshot;
    type Intent = AutomationIntent;
    type Receipt = AutomationReceipt;
    type Event = AutomationEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::Automation;
}
