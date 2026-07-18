use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StoreAdministrationRead {
    Status,
    Backups,
    MaintenanceStatus,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StoreAdministrationReadValue {
    Status {
        readiness: StoreReadiness,
        schema_version: u32,
        schema_owner: SchemaOwner,
        integrity: StoreIntegrity,
    },
    Backups {
        items: Vec<BackupRecord>,
    },
    MaintenanceStatus {
        active: bool,
        operation_id: Option<String>,
        phase: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StoreReadiness {
    Starting,
    Ready,
    Maintenance,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SchemaOwner {
    TypeScript,
    Rust,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StoreIntegrity {
    Unknown,
    Ok,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct BackupRecord {
    pub backup_id: String,
    pub label: Option<String>,
    pub created_at: String,
    pub byte_length: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StoreAdministrationIntent {
    CreateBackup {
        label: Option<String>,
        include_assets: bool,
    },
    RestoreBackup {
        backup_id: String,
        create_safety_backup: bool,
    },
    DeleteBackup {
        backup_id: String,
    },
    PruneBackups {
        retain_count: u32,
    },
    RunMaintenance {
        tasks: Vec<MaintenanceTask>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MaintenanceTask {
    IntegrityCheck,
    ForeignKeyCheck,
    DocumentCompaction,
    HistoryRetention,
    BlockRetention,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct StoreAdministrationCommitValue {
    pub backup_id: Option<String>,
    pub safety_backup_id: Option<String>,
    pub completed_tasks: Vec<MaintenanceTask>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct StoreAdministrationReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub backup_id: Option<String>,
    pub safety_backup_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct StoreAdministrationEvent {
    pub kind: StoreAdministrationEventKind,
    pub operation: String,
    pub backup_ids: Vec<String>,
    pub readiness_changed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StoreAdministrationEventKind {
    StoreAdministrationChanged,
}

pub struct StoreAdministrationContract;

impl VersionedModuleContract for StoreAdministrationContract {
    type Read = StoreAdministrationRead;
    type Snapshot = StoreAdministrationReadValue;
    type Intent = StoreAdministrationIntent;
    type Receipt = StoreAdministrationReceipt;
    type Event = StoreAdministrationEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::StoreAdministration;
}
