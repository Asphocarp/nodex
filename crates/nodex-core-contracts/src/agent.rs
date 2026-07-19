use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::workspace::ProjectWorkspaceTurnAuthority;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentTurnProvenance {
    pub profile_id: String,
    pub authority: ProjectWorkspaceTurnAuthority,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentEffectClass {
    Write,
    Destructive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentConsentRequirement {
    None,
    Resource,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentResourceKind {
    Library,
    Page,
    Database,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentResourceTarget {
    pub kind: AgentResourceKind,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentOwnershipTransformation {
    pub resource_id: String,
    pub parent_id: Option<String>,
    pub before_id: Option<String>,
}

/// Stable, user-visible mutation scope. Incidental ranks and internal Document
/// heads deliberately remain outside this value.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentOperationFootprint {
    pub effect_class: AgentEffectClass,
    pub targets: Vec<AgentResourceTarget>,
    pub updated_roots: Vec<String>,
    pub deleted_roots: Vec<String>,
    pub ownership_transformations: Vec<AgentOwnershipTransformation>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentOperationPreparationState {
    Prepared,
    CommittedReplay,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentOperationPreparation {
    pub state: AgentOperationPreparationState,
    pub consent: AgentConsentRequirement,
    pub footprint: AgentOperationFootprint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_unix_ms: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct AgentPreparedExecution {
    pub provenance: AgentTurnProvenance,
    /// Exact receipt replay may omit a token. A new mutation cannot.
    pub token: Option<String>,
}
