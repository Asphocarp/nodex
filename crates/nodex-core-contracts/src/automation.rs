use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutomationDefinitionKind {
    Cron,
    Heartbeat,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutomationDefinitionStatus {
    Active,
    Paused,
    Deleted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutomationExecutionEnvironment {
    Local,
    Worktree,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutomationReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationDefinitionInput {
    pub kind: AutomationDefinitionKind,
    pub target_thread_id: Option<String>,
    pub name: String,
    pub prompt: Option<String>,
    pub rrule: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<AutomationReasoningEffort>,
    pub cwds: Option<Vec<String>>,
    pub execution_environment: Option<AutomationExecutionEnvironment>,
    pub local_environment_config_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationDefinition {
    pub automation_id: String,
    pub definition_revision: i64,
    pub kind: AutomationDefinitionKind,
    pub status: AutomationDefinitionStatus,
    pub target_thread_id: Option<String>,
    pub name: String,
    pub prompt: String,
    pub rrule: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<AutomationReasoningEffort>,
    pub cwds: Vec<String>,
    pub execution_environment: AutomationExecutionEnvironment,
    pub local_environment_config_path: Option<String>,
    pub next_run_at_ms: Option<i64>,
    pub last_run_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutomationLeaseStatus {
    Claimed,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationLease {
    pub lease_id: String,
    pub automation_id: String,
    pub scheduled_for_ms: i64,
    pub attempt: u32,
    pub status: AutomationLeaseStatus,
    pub claimed_at_ms: i64,
    pub expires_at_ms: i64,
    pub settled_at_ms: Option<i64>,
    pub retry_at_ms: Option<i64>,
    pub reason_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationRead {
    Definitions {
        include_deleted: Option<bool>,
    },
    Definition {
        automation_id: String,
    },
    Leases {
        automation_id: Option<String>,
        include_settled: Option<bool>,
        limit: Option<u32>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationReadValue {
    Definitions {
        items: Vec<AutomationDefinition>,
    },
    Definition {
        item: Option<Box<AutomationDefinition>>,
    },
    Leases {
        items: Vec<AutomationLease>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AutomationIntent {
    CreateDefinition {
        automation_id: String,
        definition: AutomationDefinitionInput,
    },
    UpdateDefinition {
        automation_id: String,
        expected_revision: i64,
        status: AutomationDefinitionStatus,
        definition: AutomationDefinitionInput,
    },
    DeleteDefinition {
        automation_id: String,
        expected_revision: i64,
    },
    ClaimDue {
        limit: u32,
        lease_duration_ms: u64,
    },
    CompleteLease {
        lease_id: String,
    },
    FailLease {
        lease_id: String,
        retry_delay_ms: Option<u64>,
        reason_code: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationCommitValue {
    pub affected_automation_ids: Vec<String>,
    pub definitions: Vec<AutomationDefinition>,
    pub claimed_leases: Vec<AutomationLease>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub affected_automation_ids: Vec<String>,
    pub affected_lease_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AutomationEvent {
    pub kind: AutomationEventKind,
    pub automation_ids: Vec<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_clock_fields_are_not_caller_authored() {
        let claim = serde_json::to_value(AutomationIntent::ClaimDue {
            limit: 3,
            lease_duration_ms: 60_000,
        })
        .expect("claim serializes");
        assert_eq!(claim["kind"], "claim_due");
        assert!(claim.get("due_before").is_none());

        let complete = serde_json::to_value(AutomationIntent::CompleteLease {
            lease_id: "lease-1".to_owned(),
        })
        .expect("completion serializes");
        assert!(complete.get("completed_at").is_none());
    }

    #[test]
    fn definition_status_preserves_the_product_wire_values() {
        assert_eq!(
            serde_json::to_value(AutomationDefinitionStatus::Active).expect("status"),
            "ACTIVE"
        );
    }
}
