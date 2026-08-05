use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    StoreEpoch, administration::StoreAdministrationEvent, automation::AutomationEvent,
    database::DatabaseEvent, document::OwnedDocumentEvent, library::LibraryEvent,
    workspace::ProjectWorkspaceEvent,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "module", content = "event", rename_all = "snake_case")]
pub enum CoreModuleEventPayload {
    Library(LibraryEvent),
    Database(DatabaseEvent),
    OwnedDocument(OwnedDocumentEvent),
    ProjectWorkspace(ProjectWorkspaceEvent),
    Automation(AutomationEvent),
    StoreAdministration(StoreAdministrationEvent),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct PageDocumentHeadImpact {
    pub page_id: String,
    pub document_id: String,
    pub generation: i64,
    pub head_seq: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectionImpact {
    None,
    All,
    Resources {
        page_ids: Vec<String>,
        database_ids: Vec<String>,
        data_source_ids: Vec<String>,
        view_ids: Vec<String>,
        document_heads: Vec<PageDocumentHeadImpact>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct CommittedCoreModuleEvent {
    pub event_version: u32,
    pub sequence: i64,
    pub store_epoch: StoreEpoch,
    pub operation_id: Option<String>,
    pub committed_at: String,
    pub projection_impact: ProjectionImpact,
    pub payload: CoreModuleEventPayload,
}

/// The durable identity of one semantic local mutation. A single mutation may
/// touch several Yrs documents and materialized SQL projections, so its
/// physical change-log effects must not be exposed as separate public cursors.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LocalCommitCursor {
    pub store_epoch: StoreEpoch,
    pub commit_seq: i64,
}

/// Canonical local-first publication envelope.
///
/// `effects` contains the committed physical details needed by document and
/// module consumers. `payload` is the primary transport view and may be
/// selected for the consumer's scope; it is not a second authority.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct LocalCommitEnvelope {
    pub event_version: u32,
    pub commit_seq: i64,
    pub store_epoch: StoreEpoch,
    pub operation_id: Option<String>,
    pub committed_at: String,
    pub projection_impact: ProjectionImpact,
    pub payload: CoreModuleEventPayload,
    pub effects: Vec<CommittedCoreModuleEvent>,
    pub canonical_hash: String,
}
