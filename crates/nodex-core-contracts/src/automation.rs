use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationRead {
    Definitions {
        include_deleted: Option<bool>,
    },
    Definition {
        automation_id: String,
    },
    RunsInbox {
        limit: Option<u32>,
    },
    Occurrences {
        project_id: String,
        window_start: String,
        window_end: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationReadValue {
    Definitions { items: Vec<Value> },
    Definition { item: Value },
    RunsInbox { leases: Vec<AutomationLease> },
    Occurrences { occurrence_ids: Vec<String> },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationLease {
    pub lease_id: String,
    pub automation_id: String,
    pub attempt: u32,
    pub expires_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationIntent {
    CreateDefinition {
        definition: Value,
    },
    UpdateDefinition {
        definition: Value,
    },
    DeleteDefinition {
        automation_id: String,
    },
    ClaimDue {
        due_before: String,
        limit: u32,
        lease_duration_ms: u64,
    },
    CompleteLease {
        lease_id: String,
        completed_at: String,
    },
    FailLease {
        lease_id: String,
        failed_at: String,
        retry_at: Option<String>,
        reason_code: String,
    },
    CompleteOccurrence {
        request: Value,
    },
    UpdateOccurrence {
        request: Value,
    },
    ConsumeReminder {
        reminder_id: String,
        consumed_at: String,
    },
    SnoozeReminder {
        reminder_id: String,
        wake_at: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationCommitValue {
    pub affected_automation_ids: Vec<String>,
    pub affected_occurrence_ids: Vec<String>,
    pub claimed_leases: Vec<AutomationLease>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub affected_automation_ids: Vec<String>,
    pub affected_occurrence_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationEvent {
    pub kind: AutomationEventKind,
    pub automation_ids: Vec<String>,
    pub occurrence_ids: Vec<String>,
    pub lease_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutomationEventKind {
    AutomationChanged,
}

pub struct AutomationContract;

impl VersionedModuleContract for AutomationContract {
    type Read = AutomationRead;
    type Snapshot = AutomationReadValue;
    type Intent = AutomationIntent;
    type Receipt = AutomationReceipt;
    type Event = AutomationEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::Automation;
}
