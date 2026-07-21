#![forbid(unsafe_code)]

use nodex_core_contracts::{
    CommittedCoreModuleEvent, CommittedModuleValue, CoreError, ModuleApplyRequest,
    ModuleReadRequest, ModuleReadSnapshot,
    administration::{
        StoreAdministrationCommitValue, StoreAdministrationIntent, StoreAdministrationRead,
        StoreAdministrationReadValue, StoreAdministrationReceipt,
    },
    automation::{
        AutomationCommitValue, AutomationIntent, AutomationRead, AutomationReadValue,
        AutomationReceipt,
    },
    database::{
        DatabaseCommitValue, DatabaseIntent, DatabaseRead, DatabaseReadValue, DatabaseReceipt,
    },
    document::{
        OwnedDocumentCommitValue, OwnedDocumentIntent, OwnedDocumentRead, OwnedDocumentReadValue,
        OwnedDocumentReceipt,
    },
    library::{LibraryCommitValue, LibraryIntent, LibraryRead, LibraryReadValue, LibraryReceipt},
    workspace::{
        ProjectWorkspaceCommitValue, ProjectWorkspaceIntent, ProjectWorkspaceRead,
        ProjectWorkspaceReadValue, ProjectWorkspaceReceipt,
    },
};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

pub const PROTOCOL_MIN: u32 = 1;
pub const PROTOCOL_MAX: u32 = 1;
/// Maximum decoded UTF-8 size of one JSON string on the Document transport.
///
/// This is also the public Page body input bound: JSON escaping may make the
/// encoded request substantially larger than the decoded string.
pub const MAX_DOCUMENT_JSON_STRING_BYTES: usize = 8 * 1024 * 1024;
/// Maximum encoded JSON body accepted by a Document HTTP endpoint.
pub const MAX_DOCUMENT_JSON_REQUEST_BYTES: usize = 64 * 1024 * 1024;

#[cfg(unix)]
pub mod client;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct RuntimeDescriptor {
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub build_id: String,
    pub pid: u32,
    pub start_nonce: String,
    pub socket_path: String,
    pub profile_id: String,
    pub store_epoch: String,
    pub readiness_generation: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind {
    ElectronHost,
    NativeCli,
    Test,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ClientIdentity {
    pub kind: ClientKind,
    pub build_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct HandshakeRequest {
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub client: ClientIdentity,
    pub connection_id: String,
    pub expected_profile_id: Option<String>,
    pub expected_start_nonce: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct HandshakeResponse {
    pub protocol_version: u32,
    pub build_id: String,
    pub pid: u32,
    pub start_nonce: String,
    pub profile_id: String,
    pub library_id: String,
    pub connection_binding: String,
    pub store_epoch: String,
    pub schema_version: u32,
    pub event_head: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: CoreReadiness,
    pub pid: u32,
    pub start_nonce: String,
    pub metrics: CoreHealthMetrics,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct HealthDurationMetric {
    pub count: u64,
    pub total_micros: u64,
    pub last_micros: u64,
    pub max_micros: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct CoreHealthMetrics {
    pub writer_queue_depth: u64,
    pub active_writer_commands: u64,
    pub active_read_commands: u64,
    pub command_latency: HealthDurationMetric,
    pub transaction_duration: HealthDurationMetric,
    pub document_cache_entries: u64,
    pub document_cache_state_bytes: u64,
    pub document_cache_hits: u64,
    pub document_cache_misses: u64,
    pub document_cache_hit_rate_ppm: u32,
    pub document_reconstruction_duration: HealthDurationMetric,
    pub event_head: i64,
    pub event_replay_lag: u64,
    pub event_replay_lag_max: u64,
    pub wal_size_bytes: u64,
    pub backup_duration: HealthDurationMetric,
    pub active_clients: u64,
    pub active_event_subscriptions: u64,
    pub active_document_subscriptions: u64,
    pub active_awareness_clients: u64,
    pub active_prepared_agent_operations: u64,
    #[serde(default)]
    pub dropped_log_records: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CoreReadiness {
    Starting,
    Ready,
    Maintenance,
    Draining,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct RuntimeGenerationIdentity {
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub build_id: String,
    pub pid: u32,
    pub start_nonce: String,
    pub profile_id: String,
    pub store_epoch: String,
    pub readiness_generation: u64,
}

impl From<&RuntimeDescriptor> for RuntimeGenerationIdentity {
    fn from(descriptor: &RuntimeDescriptor) -> Self {
        Self {
            protocol_min: descriptor.protocol_min,
            protocol_max: descriptor.protocol_max,
            build_id: descriptor.build_id.clone(),
            pid: descriptor.pid,
            start_nonce: descriptor.start_nonce.clone(),
            profile_id: descriptor.profile_id.clone(),
            store_epoch: descriptor.store_epoch.clone(),
            readiness_generation: descriptor.readiness_generation,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct VersionHandoffRequest {
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub build_id: String,
    pub expected: RuntimeGenerationIdentity,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ShutdownRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_handoff: Option<VersionHandoffRequest>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ShutdownResponse {
    pub status: ShutdownStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<RuntimeGenerationIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ShutdownStatus {
    Draining,
    Busy,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "status", content = "payload", rename_all = "snake_case")]
pub enum ResponseEnvelope<T> {
    Ok(T),
    Error(CoreError),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct EventEnvelope {
    pub protocol_version: u32,
    pub event: CommittedCoreModuleEvent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct EventReplayRequired {
    pub requested_after: i64,
    pub oldest_available: i64,
    pub event_head: i64,
}

macro_rules! define_module_transport {
    (
        $read_request:ident,
        $read_response:ident,
        $apply_request:ident,
        $apply_response:ident,
        $read:ty,
        $read_value:ty,
        $intent:ty,
        $commit_value:ty,
        $receipt:ty
    ) => {
        #[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
        #[serde(transparent)]
        pub struct $read_request(pub ModuleReadRequest<$read>);

        #[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
        #[serde(transparent)]
        pub struct $read_response(pub ResponseEnvelope<ModuleReadSnapshot<$read_value>>);

        #[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
        #[serde(transparent)]
        pub struct $apply_request(pub ModuleApplyRequest<$intent>);

        #[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
        #[serde(transparent)]
        pub struct $apply_response(
            pub ResponseEnvelope<CommittedModuleValue<$commit_value, $receipt>>,
        );
    };
}

define_module_transport!(
    LibraryReadRequest,
    LibraryReadResponse,
    LibraryApplyRequest,
    LibraryApplyResponse,
    LibraryRead,
    LibraryReadValue,
    LibraryIntent,
    LibraryCommitValue,
    LibraryReceipt
);
define_module_transport!(
    DatabaseReadRequest,
    DatabaseReadResponse,
    DatabaseApplyRequest,
    DatabaseApplyResponse,
    DatabaseRead,
    DatabaseReadValue,
    Vec<DatabaseIntent>,
    DatabaseCommitValue,
    DatabaseReceipt
);
define_module_transport!(
    OwnedDocumentReadRequest,
    OwnedDocumentReadResponse,
    OwnedDocumentApplyRequest,
    OwnedDocumentApplyResponse,
    OwnedDocumentRead,
    OwnedDocumentReadValue,
    OwnedDocumentIntent,
    OwnedDocumentCommitValue,
    OwnedDocumentReceipt
);
define_module_transport!(
    ProjectWorkspaceReadRequest,
    ProjectWorkspaceReadResponse,
    ProjectWorkspaceApplyRequest,
    ProjectWorkspaceApplyResponse,
    ProjectWorkspaceRead,
    ProjectWorkspaceReadValue,
    ProjectWorkspaceIntent,
    ProjectWorkspaceCommitValue,
    ProjectWorkspaceReceipt
);
define_module_transport!(
    AutomationReadRequest,
    AutomationReadResponse,
    AutomationApplyRequest,
    AutomationApplyResponse,
    AutomationRead,
    AutomationReadValue,
    AutomationIntent,
    AutomationCommitValue,
    AutomationReceipt
);
define_module_transport!(
    StoreAdministrationReadRequest,
    StoreAdministrationReadResponse,
    StoreAdministrationApplyRequest,
    StoreAdministrationApplyResponse,
    StoreAdministrationRead,
    StoreAdministrationReadValue,
    StoreAdministrationIntent,
    StoreAdministrationCommitValue,
    StoreAdministrationReceipt
);

#[allow(dead_code)]
mod api {
    use super::*;

    #[utoipa::path(
        get,
        path = "/core/v1/health",
        responses((status = 200, body = HealthResponse))
    )]
    pub(super) fn health() {}

    #[utoipa::path(
        post,
        path = "/core/v1/handshake",
        request_body = HandshakeRequest,
        responses((status = 200, body = HandshakeResponse))
    )]
    pub(super) fn handshake() {}

    #[utoipa::path(
        get,
        path = "/core/v1/events",
        params(("after" = Option<i64>, Query, description = "Last committed event sequence observed")),
        responses((status = 200, description = "Server-sent committed Module events", body = EventEnvelope, content_type = "text/event-stream"))
    )]
    pub(super) fn events() {}

    #[utoipa::path(
        post,
        path = "/core/v1/admin/shutdown",
        request_body = ShutdownRequest,
        responses((status = 200, body = ShutdownResponse))
    )]
    pub(super) fn shutdown() {}

    macro_rules! module_paths {
        ($read_fn:ident, $apply_fn:ident, $path:literal, $read:ty, $read_response:ty, $apply:ty, $apply_response:ty) => {
            #[utoipa::path(
                                        post,
                                        path = concat!($path, "/read"),
                                        request_body = $read,
                                        responses((status = 200, body = $read_response))
                                    )]
            pub(super) fn $read_fn() {}

            #[utoipa::path(
                                        post,
                                        path = concat!($path, "/apply"),
                                        request_body = $apply,
                                        responses((status = 200, body = $apply_response))
                                    )]
            pub(super) fn $apply_fn() {}
        };
    }

    module_paths!(
        library_read,
        library_apply,
        "/core/v1/modules/library",
        LibraryReadRequest,
        LibraryReadResponse,
        LibraryApplyRequest,
        LibraryApplyResponse
    );
    module_paths!(
        database_read,
        database_apply,
        "/core/v1/modules/database",
        DatabaseReadRequest,
        DatabaseReadResponse,
        DatabaseApplyRequest,
        DatabaseApplyResponse
    );
    module_paths!(
        document_read,
        document_apply,
        "/core/v1/modules/document",
        OwnedDocumentReadRequest,
        OwnedDocumentReadResponse,
        OwnedDocumentApplyRequest,
        OwnedDocumentApplyResponse
    );
    module_paths!(
        workspace_read,
        workspace_apply,
        "/core/v1/modules/workspace",
        ProjectWorkspaceReadRequest,
        ProjectWorkspaceReadResponse,
        ProjectWorkspaceApplyRequest,
        ProjectWorkspaceApplyResponse
    );
    module_paths!(
        automation_read,
        automation_apply,
        "/core/v1/modules/automation",
        AutomationReadRequest,
        AutomationReadResponse,
        AutomationApplyRequest,
        AutomationApplyResponse
    );
    module_paths!(
        administration_read,
        administration_apply,
        "/core/v1/modules/administration",
        StoreAdministrationReadRequest,
        StoreAdministrationReadResponse,
        StoreAdministrationApplyRequest,
        StoreAdministrationApplyResponse
    );
}

#[derive(OpenApi)]
#[openapi(
    info(title = "Nodex Core private protocol", version = "1.0.0"),
    paths(
        api::health,
        api::handshake,
        api::events,
        api::shutdown,
        api::library_read,
        api::library_apply,
        api::database_read,
        api::database_apply,
        api::document_read,
        api::document_apply,
        api::workspace_read,
        api::workspace_apply,
        api::automation_read,
        api::automation_apply,
        api::administration_read,
        api::administration_apply,
    ),
    components(schemas(
        RuntimeDescriptor,
        HandshakeRequest,
        HandshakeResponse,
        HealthResponse,
        CoreHealthMetrics,
        HealthDurationMetric,
        ShutdownRequest,
        ShutdownResponse,
        VersionHandoffRequest,
        RuntimeGenerationIdentity,
        EventEnvelope,
        EventReplayRequired,
        LibraryReadRequest,
        LibraryReadResponse,
        LibraryApplyRequest,
        LibraryApplyResponse,
        DatabaseReadRequest,
        DatabaseReadResponse,
        DatabaseApplyRequest,
        DatabaseApplyResponse,
        OwnedDocumentReadRequest,
        OwnedDocumentReadResponse,
        OwnedDocumentApplyRequest,
        OwnedDocumentApplyResponse,
        ProjectWorkspaceReadRequest,
        ProjectWorkspaceReadResponse,
        ProjectWorkspaceApplyRequest,
        ProjectWorkspaceApplyResponse,
        AutomationReadRequest,
        AutomationReadResponse,
        AutomationApplyRequest,
        AutomationApplyResponse,
        StoreAdministrationReadRequest,
        StoreAdministrationReadResponse,
        StoreAdministrationApplyRequest,
        StoreAdministrationApplyResponse,
    ))
)]
pub struct CoreProtocolApi;

pub fn openapi() -> utoipa::openapi::OpenApi {
    CoreProtocolApi::openapi()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn openapi_surface_is_limited_to_infrastructure_and_module_pairs() {
        let actual = openapi()
            .paths
            .paths
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>();
        let expected = [
            "/core/v1/admin/shutdown",
            "/core/v1/events",
            "/core/v1/handshake",
            "/core/v1/health",
            "/core/v1/modules/administration/apply",
            "/core/v1/modules/administration/read",
            "/core/v1/modules/automation/apply",
            "/core/v1/modules/automation/read",
            "/core/v1/modules/database/apply",
            "/core/v1/modules/database/read",
            "/core/v1/modules/document/apply",
            "/core/v1/modules/document/read",
            "/core/v1/modules/library/apply",
            "/core/v1/modules/library/read",
            "/core/v1/modules/workspace/apply",
            "/core/v1/modules/workspace/read",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();

        assert_eq!(actual, expected);
    }

    #[test]
    fn openapi_is_version_3_1() {
        let json = serde_json::to_value(openapi()).expect("OpenAPI serializes");
        assert_eq!(json["openapi"], "3.1.0");
    }
}
