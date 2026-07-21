#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const CORE_CONTRACT_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(transparent)]
pub struct ProfileId(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(transparent)]
pub struct LibraryId(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(transparent)]
pub struct ProjectId(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(transparent)]
pub struct StoreEpoch(pub String);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    ElectronHost,
    LoopbackHttp,
    NativeCli,
    Agent,
    Test,
}

/// Trusted connection identity assembled by the Adapter. This type is not part
/// of the caller-authored protocol schema.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct BoundModuleContext {
    pub profile_id: ProfileId,
    pub library_id: LibraryId,
    pub project_id: Option<ProjectId>,
    pub connection_id: String,
    pub adapter: AdapterKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CoreErrorCode {
    InvalidInput,
    Unauthorized,
    NotFound,
    Ambiguous,
    StaleStoreEpoch,
    RevisionConflict,
    GenerationConflict,
    HeadConflict,
    PatchNotFound,
    PatchAmbiguous,
    PatchOverlap,
    IdempotencyKeyReused,
    ProtectedOwnerDeletion,
    DocumentUpdateMissingDependencies,
    InvalidDocumentSchema,
    MaterializationStale,
    MaintenanceInProgress,
    SchemaUnsupported,
    StoreCorrupt,
    ProtocolIncompatible,
    EventReplayUnavailable,
    ResourceExhausted,
    CoreUnavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CoreErrorRecovery {
    None,
    CurrentStoreEpoch {
        store_epoch: StoreEpoch,
    },
    CurrentRevision {
        revision: i64,
    },
    CurrentDocumentHead {
        generation: i64,
        head_seq: i64,
    },
    SupportedSchema {
        minimum: u32,
        maximum: u32,
        actual: u32,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct CoreError {
    pub code: CoreErrorCode,
    pub message: String,
    pub retryable: bool,
    pub recovery: CoreErrorRecovery,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ModuleReadRequest<T> {
    pub version: u32,
    pub read: T,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ModuleApplyRequest<T> {
    pub version: u32,
    pub operation_id: String,
    pub store_epoch: StoreEpoch,
    pub intent: T,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ModuleReadSnapshot<T> {
    pub version: u32,
    pub store_epoch: StoreEpoch,
    pub event_head: i64,
    pub value: T,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ModuleMutationReceipt {
    pub operation_id: String,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct CommittedModuleValue<T, R> {
    pub value: T,
    pub receipt: R,
    pub event_sequence: i64,
    pub store_epoch: StoreEpoch,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModuleName {
    Library,
    Database,
    OwnedDocument,
    ProjectWorkspace,
    Automation,
    StoreAdministration,
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
pub mod agent;
pub mod automation;
pub mod database;
pub mod document;
pub mod events;
pub mod library;
pub mod workspace;

pub use events::{CommittedCoreModuleEvent, CoreModuleEventPayload};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_module_names_match_the_adapter_budget() {
        let modules = [
            ModuleName::Library,
            ModuleName::Database,
            ModuleName::OwnedDocument,
            ModuleName::ProjectWorkspace,
            ModuleName::Automation,
            ModuleName::StoreAdministration,
        ];

        let json = serde_json::to_value(modules).expect("module names serialize");
        assert_eq!(
            json,
            serde_json::json!([
                "library",
                "database",
                "owned_document",
                "project_workspace",
                "automation",
                "store_administration"
            ])
        );
    }

    #[test]
    fn caller_requests_cannot_supply_bound_identity() {
        let request = ModuleReadRequest {
            version: CORE_CONTRACT_VERSION,
            read: library::LibraryRead::Metadata,
        };
        let json = serde_json::to_value(request).expect("request serializes");

        assert_eq!(json["version"], CORE_CONTRACT_VERSION);
        assert!(json.get("profile_id").is_none());
        assert!(json.get("library_id").is_none());
        assert!(json.get("adapter").is_none());
    }
}
