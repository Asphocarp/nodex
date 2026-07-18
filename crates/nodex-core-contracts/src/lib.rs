#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CORE_CONTRACT_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ProfileId(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct LibraryId(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ProjectId(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct StoreEpoch(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    ElectronHost,
    NativeCli,
    Test,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BoundReadContext {
    pub profile_id: ProfileId,
    pub library_id: LibraryId,
    pub project_id: Option<ProjectId>,
    pub adapter: AdapterKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BoundMutationContext {
    pub profile_id: ProfileId,
    pub library_id: LibraryId,
    pub project_id: Option<ProjectId>,
    pub store_epoch: StoreEpoch,
    pub adapter: AdapterKind,
    pub idempotency_key: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreErrorCode {
    InvalidInput,
    Unauthorized,
    NotFound,
    Ambiguous,
    StaleStoreEpoch,
    Conflict,
    IdempotencyKeyReused,
    DocumentUpdateMissingDependencies,
    InvalidDocumentSchema,
    MaintenanceInProgress,
    SchemaUnsupported,
    StoreCorrupt,
    ProtocolIncompatible,
    EventReplayUnavailable,
    CoreUnavailable,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CoreError {
    pub code: CoreErrorCode,
    pub message: String,
    pub retryable: bool,
    pub details: Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MutationReceipt {
    pub operation_id: String,
    pub idempotency_key: String,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Committed<T> {
    pub value: T,
    pub receipt: MutationReceipt,
    pub event_sequence: i64,
    pub store_epoch: StoreEpoch,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleName {
    Library,
    Database,
    Document,
    Workspace,
    Automation,
    Administration,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ModuleEvent {
    pub version: u32,
    pub sequence: i64,
    pub module: ModuleName,
    pub kind: String,
    pub resource_ids: Vec<String>,
    pub payload: Value,
}

pub trait VersionedModuleContract {
    type Read: Serialize;
    type Snapshot: Serialize;
    type Intent: Serialize;
    type Receipt: Serialize;
    type Event: Serialize;

    const VERSION: u32;
    const MODULE: ModuleName;
}

pub mod administration;
pub mod automation;
pub mod database;
pub mod document;
pub mod library;
pub mod workspace;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_public_modules_have_one_stable_name() {
        let modules = [
            ModuleName::Library,
            ModuleName::Database,
            ModuleName::Document,
            ModuleName::Workspace,
            ModuleName::Automation,
            ModuleName::Administration,
        ];

        let json = serde_json::to_value(modules).expect("module names serialize");
        assert_eq!(
            json,
            serde_json::json!([
                "library",
                "database",
                "document",
                "workspace",
                "automation",
                "administration"
            ])
        );
    }
}
