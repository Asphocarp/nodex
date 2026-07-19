#![forbid(unsafe_code)]

mod connections;
mod document_wire;
mod lifecycle;
mod logging;
mod metrics;
mod runtime_files;
mod transport_bounds;

use std::convert::Infallible;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::body::to_bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Extension, Query, Request, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use fs2::FileExt;
use nodex_core::administration::StoreAdministrationModule;
use nodex_core::automation::AutomationModule;
use nodex_core::database::DatabaseModule;
use nodex_core::document::{
    AwarenessPublication, DocumentRealtimeEvent, OwnedDocumentModule, OwnedDocumentRealtimeAdapter,
};
use nodex_core::infrastructure::event_log::{CoreEventLog, CoreEventReplay};
use nodex_core::infrastructure::metrics::DurationMetricSnapshot;
use nodex_core::infrastructure::sqlite::{
    StoreError, StoreErrorCode, transaction_duration_metrics, with_immediate_transaction,
};
use nodex_core::infrastructure::store::SqliteStoreKernel;
use nodex_core::infrastructure::writer::StoreRuntimePhase;
use nodex_core::library::LibraryModule;
use nodex_core::workspace::ProjectWorkspaceModule;
use nodex_core_contracts::administration::StoreAdministrationIntent;
use nodex_core_contracts::document::{OwnedDocumentIntent, OwnedDocumentRead};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CoreError, CoreErrorCode, CoreErrorRecovery,
    CoreModuleEventPayload, LibraryId, ProfileId, ProjectId, StoreEpoch,
};
use nodex_core_protocol::{
    AutomationApplyRequest, AutomationApplyResponse, AutomationReadRequest, AutomationReadResponse,
    ClientKind, CoreHealthMetrics, CoreReadiness, DatabaseApplyRequest, DatabaseApplyResponse,
    DatabaseReadRequest, DatabaseReadResponse, EventEnvelope, EventReplayRequired,
    HandshakeRequest, HandshakeResponse, HealthDurationMetric, HealthResponse, LibraryApplyRequest,
    LibraryApplyResponse, LibraryReadRequest, LibraryReadResponse, OwnedDocumentApplyRequest,
    OwnedDocumentApplyResponse, OwnedDocumentReadRequest, OwnedDocumentReadResponse, PROTOCOL_MAX,
    PROTOCOL_MIN, ProjectWorkspaceApplyRequest, ProjectWorkspaceApplyResponse,
    ProjectWorkspaceReadRequest, ProjectWorkspaceReadResponse, ResponseEnvelope, RuntimeDescriptor,
    RuntimeGenerationIdentity, ShutdownRequest, ShutdownResponse, ShutdownStatus,
    StoreAdministrationApplyRequest, StoreAdministrationApplyResponse,
    StoreAdministrationReadRequest, StoreAdministrationReadResponse, VersionHandoffRequest,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::UnixListener;
use tokio::sync::broadcast;
use tracing::Instrument;

use connections::{
    BoundConnection, ConnectionActivity, ConnectionRegistry, ConnectionRegistryError,
    ConnectionRegistryErrorKind, EventSubscriptionKey, PeerIdentity,
};
use document_wire::{ApplyFrame, CONTENT_TYPE as DOCUMENT_CONTENT_TYPE};
use lifecycle::{LifecycleCoordinator, configured_idle_timeout, monitor_idle};
use metrics::ServerMetrics;
use runtime_files::{ExistingCore, PRIVATE_FILE_MODE, RuntimePaths, random_hex};
use transport_bounds::{MAX_DOCUMENT_REQUEST_BYTES, MAX_JSON_REQUEST_BYTES};

const EVENT_CHANNEL_CAPACITY: usize = 64;
const PROJECT_HEADER: &str = "x-nodex-project-id";
const CONNECTION_HEADER: &str = "x-nodex-connection-id";
const CONNECTION_BINDING_HEADER: &str = "x-nodex-connection-binding";
const DOCUMENT_HEADER: &str = "x-nodex-document-id";
const CLIENT_SESSION_HEADER: &str = "x-nodex-client-session-id";
const DOCUMENT_SCOPE_HEADER: &str = "x-nodex-document-scope";
const LIBRARY_DOCUMENT_SCOPE: &str = "library";
const DATABASE_SCOPE_HEADER: &str = "x-nodex-database-scope";
const LIBRARY_DATABASE_SCOPE: &str = "library";
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

struct ServerState {
    auth_header: String,
    owner_uid: u32,
    connections: ConnectionRegistry,
    lifecycle: LifecycleCoordinator,
    descriptor: Arc<Mutex<RuntimeDescriptor>>,
    profile_id: String,
    schema_version: u32,
    library_id: String,
    library: LibraryModule,
    database: DatabaseModule,
    workspace: ProjectWorkspaceModule,
    automation: AutomationModule,
    administration: StoreAdministrationModule,
    document: OwnedDocumentModule,
    document_realtime: OwnedDocumentRealtimeAdapter,
    store: SqliteStoreKernel,
    event_log: CoreEventLog,
    event_sender: broadcast::Sender<EventEnvelope>,
    document_sender: broadcast::Sender<DocumentTransportPublication>,
    metrics: ServerMetrics,
    logging: logging::LoggingHandle,
}

fn descriptor_snapshot(state: &ServerState) -> RuntimeDescriptor {
    state
        .descriptor
        .lock()
        .expect("runtime descriptor mutex poisoned")
        .clone()
}

#[derive(Clone)]
struct DocumentTransportPublication {
    event: DocumentRealtimeEvent,
    recipient_connections: Vec<String>,
}

#[derive(Deserialize)]
struct EventQuery {
    #[serde(default)]
    after: i64,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: &self.message,
            }),
        )
            .into_response()
    }
}

async fn authenticate(
    State(state): State<Arc<ServerState>>,
    ConnectInfo(peer): ConnectInfo<PeerIdentity>,
    request: Request,
    next: Next,
) -> Response {
    let supplied = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if peer.uid != state.owner_uid
        || peer.pid.is_none()
        || !constant_time_equal(supplied.as_bytes(), state.auth_header.as_bytes())
    {
        return ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    next.run(request).await
}

async fn trace_request(request: Request, next: Next) -> Response {
    let request_id = format!(
        "core:{}:{}",
        std::process::id(),
        NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
    );
    let method = match request.method().as_str() {
        "GET" => "GET",
        "POST" => "POST",
        _ => "OTHER",
    };
    let (path, module) = route_observability(request.uri().path());
    let span = tracing::info_span!(
        "core_request",
        requestId = %request_id,
        method = %method,
        path = %path,
        module,
        connectionId = tracing::field::Empty,
        adapter = tracing::field::Empty,
        operationId = tracing::field::Empty,
        receiptKey = tracing::field::Empty,
    );
    async move {
        let started_at = Instant::now();
        let response = next.run(request).await;
        let status = response.status().as_u16();
        let duration_ms = u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX);
        if status >= 500 {
            tracing::error!(status, durationMs = duration_ms, "Core request completed");
        } else if status >= 400 {
            tracing::warn!(status, durationMs = duration_ms, "Core request completed");
        } else if duration_ms >= 1_000 {
            tracing::info!(status, durationMs = duration_ms, "Core request completed");
        } else {
            tracing::debug!(status, durationMs = duration_ms, "Core request completed");
        }
        response
    }
    .instrument(span)
    .await
}

fn route_observability(path: &str) -> (&'static str, &'static str) {
    match path {
        "/core/v1/health" => ("/core/v1/health", "health"),
        "/core/v1/handshake" => ("/core/v1/handshake", "lifecycle"),
        "/core/v1/admin/shutdown" => ("/core/v1/admin/shutdown", "lifecycle"),
        "/core/v1/events" => ("/core/v1/events", "lifecycle"),
        "/core/v1/modules/library/read" => ("/core/v1/modules/library/read", "library"),
        "/core/v1/modules/library/apply" => ("/core/v1/modules/library/apply", "library"),
        "/core/v1/modules/database/read" => ("/core/v1/modules/database/read", "database"),
        "/core/v1/modules/database/apply" => ("/core/v1/modules/database/apply", "database"),
        "/core/v1/modules/workspace/read" => {
            ("/core/v1/modules/workspace/read", "project_workspace")
        }
        "/core/v1/modules/workspace/apply" => {
            ("/core/v1/modules/workspace/apply", "project_workspace")
        }
        "/core/v1/modules/automation/read" => ("/core/v1/modules/automation/read", "automation"),
        "/core/v1/modules/automation/apply" => ("/core/v1/modules/automation/apply", "automation"),
        "/core/v1/modules/administration/read" => (
            "/core/v1/modules/administration/read",
            "store_administration",
        ),
        "/core/v1/modules/administration/apply" => (
            "/core/v1/modules/administration/apply",
            "store_administration",
        ),
        "/core/v1/modules/document/read" => ("/core/v1/modules/document/read", "owned_document"),
        "/core/v1/modules/document/apply" => ("/core/v1/modules/document/apply", "owned_document"),
        _ => ("unmatched", "unmatched"),
    }
}

async fn bind_connection(
    State(state): State<Arc<ServerState>>,
    ConnectInfo(peer): ConnectInfo<PeerIdentity>,
    mut request: Request,
    next: Next,
) -> Response {
    if state.lifecycle.is_draining() {
        return ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "Core is draining").into_response();
    }
    let bound = match bind_authenticated_connection(&state, request.headers(), &peer) {
        Ok(bound) => bound,
        Err(error) => return error.into_response(),
    };
    if !state.lifecycle.record_activity() {
        return ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "Core is draining").into_response();
    }
    let connection_id = log_identity(&bound.id);
    tracing::Span::current().record("connectionId", connection_id.as_str());
    tracing::Span::current().record("adapter", adapter_name(&bound.adapter));
    request.extensions_mut().insert(bound);
    next.run(request).await
}

fn adapter_name(adapter: &AdapterKind) -> &'static str {
    match adapter {
        AdapterKind::ElectronHost => "electron_host",
        AdapterKind::LoopbackHttp => "loopback_http",
        AdapterKind::NativeCli => "native_cli",
        AdapterKind::Agent => "agent",
        AdapterKind::Test => "test",
    }
}

fn bind_authenticated_connection(
    state: &ServerState,
    headers: &HeaderMap,
    peer: &PeerIdentity,
) -> Result<BoundConnection, ApiError> {
    let connection_id =
        required_header(headers, CONNECTION_HEADER, "Connection").map_err(api_core_error)?;
    let binding = required_header(headers, CONNECTION_BINDING_HEADER, "Connection binding")
        .map_err(api_core_error)?;
    state
        .connections
        .bind(&connection_id, &binding, peer)
        .map_err(connection_registry_error)
}

async fn health(State(state): State<Arc<ServerState>>) -> Json<HealthResponse> {
    let descriptor = descriptor_snapshot(&state);
    let (status, metrics) = health_metrics(&state);
    Json(HealthResponse {
        status,
        pid: descriptor.pid,
        start_nonce: descriptor.start_nonce,
        metrics,
    })
}

fn health_metrics(state: &ServerState) -> (CoreReadiness, CoreHealthMetrics) {
    let store_activity = state.store.activity();
    let mut status = match store_activity.phase {
        StoreRuntimePhase::Running => CoreReadiness::Ready,
        StoreRuntimePhase::Maintenance => CoreReadiness::Maintenance,
        StoreRuntimePhase::Closed => CoreReadiness::Failed,
    };
    if state.lifecycle.is_draining() {
        status = CoreReadiness::Draining;
    }
    let connections = state.connections.activity().ok();
    let realtime = state.document_realtime.activity().ok();
    let cache = state.document.cache_metrics().ok();
    let prepared_operations = state.document.prepared_agent_operation_count().ok();
    let event_head = state.event_log.head().ok();
    let wal_size_bytes = wal_size_bytes(state.store.database_path()).ok();
    if connections.is_none()
        || realtime.is_none()
        || cache.is_none()
        || prepared_operations.is_none()
        || event_head.is_none()
        || wal_size_bytes.is_none()
    {
        status = CoreReadiness::Failed;
    }
    let connections = connections.unwrap_or(ConnectionActivity {
        clients: 0,
        event_subscriptions: 0,
    });
    let realtime = realtime.unwrap_or_default();
    let cache = cache.unwrap_or_default();
    let cache_total = cache.hits.saturating_add(cache.misses);
    let cache_hit_rate_ppm = if cache_total == 0 {
        0
    } else {
        u32::try_from((u128::from(cache.hits) * 1_000_000_u128) / u128::from(cache_total))
            .unwrap_or(1_000_000)
    };
    let (event_replay_lag, event_replay_lag_max) = state.metrics.event_replay_lag();
    let store_metrics = state.store.metrics();
    (
        status,
        CoreHealthMetrics {
            writer_queue_depth: usize_to_u64(store_activity.queued_writes),
            active_writer_commands: usize_to_u64(store_activity.active_writes),
            active_read_commands: usize_to_u64(store_activity.active_reads),
            command_latency: health_duration(store_metrics.command_latency),
            transaction_duration: health_duration(transaction_duration_metrics()),
            document_cache_entries: usize_to_u64(cache.entries),
            document_cache_state_bytes: usize_to_u64(cache.state_bytes),
            document_cache_hits: cache.hits,
            document_cache_misses: cache.misses,
            document_cache_hit_rate_ppm: cache_hit_rate_ppm,
            document_reconstruction_duration: health_duration(
                state.document.reconstruction_metrics(),
            ),
            event_head: event_head.unwrap_or_default(),
            event_replay_lag,
            event_replay_lag_max,
            wal_size_bytes: wal_size_bytes.unwrap_or_default(),
            backup_duration: health_duration(state.metrics.backup_duration()),
            active_clients: usize_to_u64(connections.clients),
            active_event_subscriptions: usize_to_u64(connections.event_subscriptions),
            active_document_subscriptions: usize_to_u64(realtime.subscriptions),
            active_awareness_clients: usize_to_u64(realtime.awareness_clients),
            active_prepared_agent_operations: usize_to_u64(prepared_operations.unwrap_or_default()),
            dropped_log_records: state.logging.dropped_records(),
        },
    )
}

fn health_duration(metric: DurationMetricSnapshot) -> HealthDurationMetric {
    HealthDurationMetric {
        count: metric.count,
        total_micros: metric.total_micros,
        last_micros: metric.last_micros,
        max_micros: metric.max_micros,
    }
}

fn wal_size_bytes(database_path: &Path) -> io::Result<u64> {
    let mut wal_path = database_path.as_os_str().to_os_string();
    wal_path.push("-wal");
    match fs::metadata(PathBuf::from(wal_path)) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error),
    }
}

fn usize_to_u64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

async fn handshake(
    State(state): State<Arc<ServerState>>,
    ConnectInfo(peer): ConnectInfo<PeerIdentity>,
    Json(request): Json<HandshakeRequest>,
) -> Result<Json<HandshakeResponse>, ApiError> {
    if state.lifecycle.is_draining() {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Core is draining",
        ));
    }
    let descriptor = descriptor_snapshot(&state);
    let protocol_version = negotiate_protocol(request.protocol_min, request.protocol_max);
    let compatible = protocol_version.is_some()
        && request
            .expected_profile_id
            .as_ref()
            .is_none_or(|id| id == &descriptor.profile_id)
        && request
            .expected_start_nonce
            .as_ref()
            .is_none_or(|nonce| nonce == &descriptor.start_nonce);
    if !compatible {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "protocol or identity mismatch",
        ));
    }
    if !valid_binding(&request.connection_id)
        || request.client.build_id.is_empty()
        || request.client.build_id.len() > 128
        || request.client.build_id.trim() != request.client.build_id
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "client or connection identity is invalid",
        ));
    }
    let adapter = match request.client.kind {
        ClientKind::ElectronHost => AdapterKind::ElectronHost,
        ClientKind::NativeCli => AdapterKind::NativeCli,
        ClientKind::Test => AdapterKind::Test,
    };
    let connection_binding = connection_binding(
        &state,
        &request.connection_id,
        &adapter,
        &peer,
        &request.client.build_id,
    );
    state
        .connections
        .register(
            &request.connection_id,
            connection_binding.clone(),
            adapter.clone(),
            &peer,
            &request.client.build_id,
            protocol_version.expect("compatible protocol was selected"),
        )
        .map_err(connection_registry_error)?;
    let connection_id = log_identity(&request.connection_id);
    tracing::Span::current().record("connectionId", connection_id.as_str());
    tracing::Span::current().record("adapter", adapter_name(&adapter));
    if !state.lifecycle.record_activity() {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Core is draining",
        ));
    }

    let event_head = state.event_log.head().map_err(|error| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("Core event head is unavailable: {}", error.message),
        )
    })?;
    Ok(Json(HandshakeResponse {
        protocol_version: protocol_version.expect("compatible protocol was selected"),
        build_id: descriptor.build_id,
        pid: descriptor.pid,
        start_nonce: descriptor.start_nonce,
        profile_id: descriptor.profile_id,
        library_id: state.library_id.clone(),
        connection_binding,
        store_epoch: descriptor.store_epoch,
        schema_version: state.schema_version,
        event_head,
    }))
}

fn negotiate_protocol(client_min: u32, client_max: u32) -> Option<u32> {
    if client_min == 0 || client_min > client_max {
        return None;
    }
    let selected = PROTOCOL_MAX.min(client_max);
    (selected >= PROTOCOL_MIN && selected >= client_min).then_some(selected)
}

async fn library_read(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(LibraryReadRequest(request)): Json<LibraryReadRequest>,
) -> Json<LibraryReadResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.library.read(&context, request) {
            Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(LibraryReadResponse(response))
}

async fn library_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(LibraryApplyRequest(request)): Json<LibraryApplyRequest>,
) -> Json<LibraryApplyResponse> {
    record_operation("library", &request.operation_id);
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.library.apply(&context, request) {
            Ok(outcome) => {
                record_commit(
                    outcome.committed.event_sequence,
                    outcome.committed.receipt.mutation.duplicate,
                );
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(LibraryApplyResponse(response))
}

async fn database_read(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(DatabaseReadRequest(request)): Json<DatabaseReadRequest>,
) -> Json<DatabaseReadResponse> {
    let response = match database_context(&state, &headers, &bound) {
        Ok(context) => match state.database.read(&context, request) {
            Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(DatabaseReadResponse(response))
}

async fn database_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(DatabaseApplyRequest(request)): Json<DatabaseApplyRequest>,
) -> Json<DatabaseApplyResponse> {
    record_operation("database", &request.operation_id);
    let response = match database_context(&state, &headers, &bound) {
        Ok(context) => match state.database.apply(&context, request) {
            Ok(outcome) => {
                record_commit(
                    outcome.committed.event_sequence,
                    outcome.committed.receipt.mutation.duplicate,
                );
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(DatabaseApplyResponse(response))
}

async fn workspace_read(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(ProjectWorkspaceReadRequest(request)): Json<ProjectWorkspaceReadRequest>,
) -> Json<ProjectWorkspaceReadResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.workspace.read(&context, request) {
            Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(ProjectWorkspaceReadResponse(response))
}

async fn workspace_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(ProjectWorkspaceApplyRequest(request)): Json<ProjectWorkspaceApplyRequest>,
) -> Json<ProjectWorkspaceApplyResponse> {
    record_operation("project_workspace", &request.operation_id);
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.workspace.apply(&context, request) {
            Ok(outcome) => {
                record_commit(
                    outcome.committed.event_sequence,
                    outcome.committed.receipt.mutation.duplicate,
                );
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(ProjectWorkspaceApplyResponse(response))
}

async fn automation_read(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(AutomationReadRequest(request)): Json<AutomationReadRequest>,
) -> Json<AutomationReadResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.automation.read(&context, request) {
            Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(AutomationReadResponse(response))
}

async fn automation_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(AutomationApplyRequest(request)): Json<AutomationApplyRequest>,
) -> Json<AutomationApplyResponse> {
    record_operation("automation", &request.operation_id);
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.automation.apply(&context, request) {
            Ok(outcome) => {
                record_commit(
                    outcome.committed.event_sequence,
                    outcome.committed.receipt.mutation.duplicate,
                );
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(AutomationApplyResponse(response))
}

async fn administration_read(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(StoreAdministrationReadRequest(request)): Json<StoreAdministrationReadRequest>,
) -> Json<StoreAdministrationReadResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.administration.read(&context, request) {
            Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(StoreAdministrationReadResponse(response))
}

async fn administration_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(StoreAdministrationApplyRequest(request)): Json<StoreAdministrationApplyRequest>,
) -> Json<StoreAdministrationApplyResponse> {
    record_operation("store_administration", &request.operation_id);
    let backup_started_at = matches!(
        &request.intent,
        StoreAdministrationIntent::CreateBackup { .. }
    )
    .then(std::time::Instant::now);
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.administration.apply(&context, request) {
            Ok(outcome) => {
                record_commit(
                    outcome.committed.event_sequence,
                    outcome.committed.receipt.mutation.duplicate,
                );
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(record_core_error(error)),
        },
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    if let Some(started_at) = backup_started_at {
        state.metrics.record_backup_duration(started_at.elapsed());
    }
    Json(StoreAdministrationApplyResponse(response))
}

async fn document_read(State(state): State<Arc<ServerState>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let headers = parts.headers;
    let bound = parts
        .extensions
        .get::<BoundConnection>()
        .cloned()
        .expect("connection middleware binds Document requests");
    let bytes = match to_bytes(body, MAX_DOCUMENT_REQUEST_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => return json_document_read_error(invalid("Document read body exceeds its bound")),
    };
    if is_document_binary(&headers) {
        return binary_document_read(&state, &headers, &bound, &bytes);
    }
    let OwnedDocumentReadRequest(request) = match serde_json::from_slice(&bytes) {
        Ok(request) => request,
        Err(_) => return json_document_read_error(invalid("Document read request is invalid")),
    };
    if let OwnedDocumentRead::PrepareAgentSemanticMutation { operation_id, .. } = &request.read {
        record_operation("owned_document", operation_id);
    }
    let response = match document_context(&state, &headers, &bound) {
        Ok(context) => {
            let result = match &request.read {
                OwnedDocumentRead::SyncYjs { .. } => {
                    required_header(&headers, CLIENT_SESSION_HEADER, "Document client session")
                        .and_then(|client_session_id| {
                            let OwnedDocumentRead::SyncYjs {
                                document_id,
                                state_vector,
                            } = request.read
                            else {
                                unreachable!();
                            };
                            state.document_realtime.sync_yjs(
                                &context,
                                &client_session_id,
                                document_id,
                                state_vector,
                            )
                        })
                }
                OwnedDocumentRead::SyncCanvas { document_id } => {
                    required_header(&headers, CLIENT_SESSION_HEADER, "Document client session")
                        .and_then(|client_session_id| {
                            state.document_realtime.sync_canvas(
                                &context,
                                &client_session_id,
                                document_id.clone(),
                            )
                        })
                }
                _ => state.document.read(&context, request),
            };
            match result {
                Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
                Err(error) => ResponseEnvelope::Error(record_core_error(error)),
            }
        }
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(OwnedDocumentReadResponse(response)).into_response()
}

async fn document_apply(State(state): State<Arc<ServerState>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let headers = parts.headers;
    let bound = parts
        .extensions
        .get::<BoundConnection>()
        .cloned()
        .expect("connection middleware binds Document requests");
    let bytes = match to_bytes(body, MAX_DOCUMENT_REQUEST_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return json_document_apply_error(invalid("Document apply body exceeds its bound"));
        }
    };
    if is_document_binary(&headers) {
        return binary_document_apply(&state, &headers, &bound, &bytes);
    }
    let OwnedDocumentApplyRequest(request) = match serde_json::from_slice(&bytes) {
        Ok(request) => request,
        Err(_) => return json_document_apply_error(invalid("Document apply request is invalid")),
    };
    record_operation("owned_document", &request.operation_id);
    let response = match document_context(&state, &headers, &bound) {
        Ok(context) => {
            let realtime_bound = matches!(
                &request.intent,
                OwnedDocumentIntent::ApplyYjsUpdate { .. }
                    | OwnedDocumentIntent::ApplyCanvasMutation { .. }
            );
            let result = if realtime_bound {
                required_header(&headers, CLIENT_SESSION_HEADER, "Document client session")
                    .and_then(|client_session_id| {
                        state
                            .document_realtime
                            .apply(&context, &client_session_id, request)
                    })
            } else {
                state.document.apply(&context, request)
            };
            match result {
                Ok(outcome) => {
                    record_commit(
                        outcome.committed.event_sequence,
                        outcome.committed.receipt.mutation.duplicate,
                    );
                    for event in outcome.events {
                        publish_event(&state, event);
                    }
                    ResponseEnvelope::Ok(outcome.committed)
                }
                Err(error) => ResponseEnvelope::Error(record_core_error(error)),
            }
        }
        Err(error) => ResponseEnvelope::Error(record_core_error(error)),
    };
    Json(OwnedDocumentApplyResponse(response)).into_response()
}

fn binary_document_read(
    state: &ServerState,
    headers: &HeaderMap,
    bound: &BoundConnection,
    bytes: &[u8],
) -> Response {
    let result = (|| {
        if bytes.len() > document_wire::MAX_SYNC_FRAME_BYTES {
            return Err(invalid("Document sync frame exceeds its bound"));
        }
        let context = document_context(state, headers, bound)?;
        let document_id = required_header(headers, DOCUMENT_HEADER, "Document")?;
        let header_session =
            required_header(headers, CLIENT_SESSION_HEADER, "Document client session")?;
        let (metadata, state_vector) = document_wire::decode_sync(bytes)?;
        require_wire_version(metadata.version)?;
        require_same_identity(
            &header_session,
            &metadata.client_session_id,
            "client session",
        )?;
        let snapshot = state.document_realtime.sync_yjs(
            &context,
            &metadata.client_session_id,
            document_id,
            state_vector,
        )?;
        document_wire::parse_yjs_sync(snapshot).and_then(|sync| document_wire::encode_sync(&sync))
    })();
    match result {
        Ok(frame) => binary_response(frame),
        Err(error) => json_document_read_error(error),
    }
}

fn binary_document_apply(
    state: &ServerState,
    headers: &HeaderMap,
    bound: &BoundConnection,
    bytes: &[u8],
) -> Response {
    let result = (|| {
        let context = document_context(state, headers, bound)?;
        let document_id = required_header(headers, DOCUMENT_HEADER, "Document")?;
        let header_session =
            required_header(headers, CLIENT_SESSION_HEADER, "Document client session")?;
        match document_wire::decode_apply(bytes)? {
            ApplyFrame::Update(metadata, update) => {
                if bytes.len() > document_wire::MAX_APPLY_FRAME_BYTES {
                    return Err(invalid("Document update frame exceeds its bound"));
                }
                require_wire_version(metadata.version)?;
                require_same_identity(
                    &header_session,
                    &metadata.client_session_id,
                    "client session",
                )?;
                require_same_identity(
                    &descriptor_snapshot(state).store_epoch,
                    &metadata.store_epoch,
                    "store epoch",
                )?;
                let update_id = metadata.update_id.clone();
                record_operation("owned_document", &update_id);
                let outcome = state.document_realtime.apply(
                    &context,
                    &metadata.client_session_id,
                    nodex_core_contracts::ModuleApplyRequest {
                        version: PROTOCOL_MAX,
                        operation_id: metadata.update_id.clone(),
                        store_epoch: StoreEpoch(metadata.store_epoch),
                        intent: OwnedDocumentIntent::ApplyYjsUpdate {
                            document_id: document_id.clone(),
                            generation: metadata.generation,
                            base_head_seq: metadata.base_head_seq,
                            update_id: metadata.update_id,
                            touched_block_ids: metadata.touched_block_ids,
                            update,
                        },
                    },
                )?;
                record_commit(
                    outcome.committed.event_sequence,
                    outcome.committed.receipt.mutation.duplicate,
                );
                for event in outcome.events.iter().cloned() {
                    publish_event(state, event);
                }
                let snapshot = state.document_realtime.sync_yjs(
                    &context,
                    &metadata.client_session_id,
                    document_id,
                    Vec::new(),
                )?;
                let sync = document_wire::parse_yjs_sync(snapshot)?;
                document_wire::encode_apply_ack(&outcome.committed, &update_id, &sync)
            }
            ApplyFrame::Awareness(metadata, update) => {
                if bytes.len() > document_wire::MAX_AWARENESS_FRAME_BYTES {
                    return Err(invalid("Document Awareness frame exceeds its bound"));
                }
                require_wire_version(metadata.version)?;
                require_same_identity(
                    &header_session,
                    &metadata.client_session_id,
                    "client session",
                )?;
                require_same_identity(
                    &descriptor_snapshot(state).store_epoch,
                    &metadata.store_epoch,
                    "store epoch",
                )?;
                if let Some(publication) = state.document_realtime.publish_awareness(
                    &context.connection_id,
                    &metadata.client_session_id,
                    &StoreEpoch(metadata.store_epoch),
                    metadata.generation,
                    &update,
                )? {
                    publish_document_transport(state, publication);
                }
                Ok(serde_json::to_vec(&serde_json::json!({ "accepted": true }))
                    .map_err(|_| invalid("Awareness acknowledgement cannot be encoded"))?)
            }
        }
    })();
    match result {
        Ok(frame)
            if matches!(
                document_wire::decode_apply(bytes),
                Ok(ApplyFrame::Awareness(..))
            ) =>
        {
            ([(CONTENT_TYPE, "application/json")], frame).into_response()
        }
        Ok(frame) => binary_response(frame),
        Err(error) => json_document_apply_error(error),
    }
}

async fn events(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let mut receiver = state.event_sender.subscribe();
    let mut document_receiver = state.document_sender.subscribe();
    let requested_document_id =
        optional_header(&headers, DOCUMENT_HEADER, "Document").map_err(api_core_error)?;
    let requested_client_session_id = requested_document_id
        .as_ref()
        .map(|_| required_header(&headers, CLIENT_SESSION_HEADER, "Document client session"))
        .transpose()
        .map_err(api_core_error)?;
    let subscription_key = requested_client_session_id
        .as_ref()
        .map_or(EventSubscriptionKey::Global, |client_session_id| {
            EventSubscriptionKey::Document(client_session_id.clone())
        });
    let event_subscription = state
        .connections
        .acquire_event_subscription(&bound.id, subscription_key)
        .map_err(connection_registry_error)?;
    let (
        replay,
        replay_head,
        core_resync,
        document_resync,
        document_boundary,
        initial_awareness,
        connection_id,
        disconnect,
    ) = if let Some(document_id) = requested_document_id.as_ref() {
        let context = document_context(&state, &headers, &bound).map_err(api_core_error)?;
        let client_session_id = requested_client_session_id
            .as_ref()
            .expect("Document subscription validated a client session")
            .clone();
        let subscription = state
            .document_realtime
            .subscribe(&context, document_id.clone(), client_session_id.clone())
            .map_err(api_core_error)?;
        let replay = state
            .document_realtime
            .replay(
                &context.connection_id,
                &client_session_id,
                query.after,
                None,
            )
            .map_err(api_core_error)?;
        let document_boundary = serde_json::json!({
            "document_id": subscription.document_id,
            "store_epoch": subscription.store_epoch,
            "generation": subscription.generation,
            "head_seq": subscription.head_seq,
            "event_head": replay.event_head,
        });
        let mut committed = Vec::new();
        let mut resync = None;
        for event in replay.events {
            match event {
                DocumentRealtimeEvent::Committed(event) => committed.push(EventEnvelope {
                    protocol_version: PROTOCOL_MAX,
                    event,
                }),
                DocumentRealtimeEvent::ResyncRequired {
                    document_id,
                    store_epoch,
                    generation,
                    head_seq,
                    event_head,
                } => {
                    resync = Some(serde_json::json!({
                        "document_id": document_id,
                        "store_epoch": store_epoch,
                        "generation": generation,
                        "head_seq": head_seq,
                        "event_head": event_head,
                    }));
                }
                DocumentRealtimeEvent::Awareness { .. } => {}
            }
        }
        (
            committed,
            replay.event_head,
            None,
            resync,
            Some(document_boundary),
            subscription
                .awareness_update
                .map(|update| DocumentRealtimeEvent::Awareness {
                    document_id: subscription.document_id,
                    store_epoch: subscription.store_epoch,
                    generation: subscription.generation,
                    client_session_id: "core:awareness-snapshot".to_owned(),
                    update,
                }),
            Some(context.connection_id.clone()),
            Some(DisconnectGuard {
                adapter: state.document_realtime.clone(),
                connection_id: context.connection_id,
                sender: state.document_sender.clone(),
            }),
        )
    } else {
        match state.event_log.replay(query.after, None).map_err(|error| {
            ApiError::new(
                StatusCode::CONFLICT,
                format!("Core event replay is unavailable: {}", error.message),
            )
        })? {
            CoreEventReplay::Events { events, event_head } => (
                events
                    .into_iter()
                    .map(|event| EventEnvelope {
                        protocol_version: PROTOCOL_MAX,
                        event,
                    })
                    .collect(),
                event_head,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            CoreEventReplay::ResyncRequired {
                requested_after,
                oldest_available,
                event_head,
            } => (
                Vec::new(),
                event_head,
                Some(EventReplayRequired {
                    requested_after,
                    oldest_available,
                    event_head,
                }),
                None,
                None,
                None,
                None,
                None,
            ),
        }
    };
    state
        .metrics
        .record_event_replay_lag(replay_head, query.after);
    let replay_count = u64::try_from(replay.len()).unwrap_or(u64::MAX);
    if core_resync.is_some() || document_resync.is_some() {
        tracing::warn!(
            requestedAfter = query.after,
            eventHead = replay_head,
            replayCount = replay_count,
            "Core event subscription requires resynchronization"
        );
    } else {
        tracing::debug!(
            requestedAfter = query.after,
            eventHead = replay_head,
            replayCount = replay_count,
            "Core event subscription opened"
        );
    }
    let event_log = state.event_log.clone();
    let mut stream_shutdown = state.lifecycle.subscribe_stream_shutdown();
    let stream = async_stream::stream! {
        let _event_subscription = event_subscription;
        let _disconnect = disconnect;
        let mut last_delivered = query.after;
        for envelope in replay {
            last_delivered = envelope.event.sequence;
            yield Ok(sse_event(&envelope));
        }
        if let Some(resync) = core_resync {
            yield Ok(sse_core_resync(&resync));
            return;
        }
        if let Some(resync) = document_resync {
            yield Ok(Event::default()
                .event("document-resync-required")
                .data(serde_json::to_string(&resync).expect("resync event serializes")));
        }
        if let Some(awareness) = initial_awareness {
            yield Ok(sse_document_realtime_event(&awareness));
        }
        loop {
            tokio::select! {
                () = LifecycleCoordinator::wait_for_stream_shutdown(&mut stream_shutdown) => {
                    break;
                }
                received = receiver.recv() => match received {
                    Ok(envelope) => {
                        if envelope.event.sequence <= replay_head {
                            continue;
                        }
                        if let Some(document_id) = requested_document_id.as_deref()
                            && event_document_id(&envelope) != Some(document_id)
                        {
                            continue;
                        }
                        last_delivered = envelope.event.sequence;
                        yield Ok(sse_event(&envelope));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if let Some(boundary) = document_boundary.as_ref() {
                            yield Ok(Event::default()
                                .event("document-resync-required")
                                .data(serde_json::to_string(boundary).expect("resync event serializes")));
                        } else {
                            let event_head = event_log.head().unwrap_or(last_delivered);
                            yield Ok(sse_core_resync(&EventReplayRequired {
                                requested_after: last_delivered,
                                oldest_available: last_delivered.saturating_add(1),
                                event_head,
                            }));
                        }
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                },
                received = document_receiver.recv() => match received {
                    Ok(publication) => {
                        let Some(connection_id) = connection_id.as_deref() else {
                            continue;
                        };
                        if !publication.recipient_connections.iter().any(|recipient| recipient == connection_id) {
                            continue;
                        }
                        if let Some(document_id) = requested_document_id.as_deref()
                            && realtime_event_document_id(&publication.event) != document_id
                        {
                            continue;
                        }
                        yield Ok(sse_document_realtime_event(&publication.event));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if let Some(boundary) = document_boundary.as_ref() {
                            yield Ok(Event::default()
                                .event("document-resync-required")
                                .data(serde_json::to_string(boundary).expect("resync event serializes")));
                        }
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    };
    Ok(Sse::new(stream))
}

async fn shutdown(
    State(state): State<Arc<ServerState>>,
    ConnectInfo(peer): ConnectInfo<PeerIdentity>,
    headers: HeaderMap,
    Json(request): Json<ShutdownRequest>,
) -> Result<Json<ShutdownResponse>, ApiError> {
    if let Some(handoff) = request.version_handoff {
        return version_handoff(&state, handoff);
    }
    let bound = bind_authenticated_connection(&state, &headers, &peer)?;
    if !matches!(
        bound.adapter,
        AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
    ) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "connection role cannot control Core lifecycle",
        ));
    }
    let connection_id = log_identity(&bound.id);
    tracing::Span::current().record("connectionId", connection_id.as_str());
    tracing::Span::current().record("adapter", adapter_name(&bound.adapter));
    if state.lifecycle.begin_drain() {
        tracing::info!(reason = "explicit", "Core drain began");
    }
    Ok(Json(ShutdownResponse {
        status: ShutdownStatus::Draining,
        runtime: None,
        retry_after_ms: None,
    }))
}

fn version_handoff(
    state: &Arc<ServerState>,
    request: VersionHandoffRequest,
) -> Result<Json<ShutdownResponse>, ApiError> {
    let descriptor = descriptor_snapshot(state);
    if !valid_version_handoff(&request, &descriptor) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "version handoff identity or protocol range is invalid",
        ));
    }
    let runtime = Some(RuntimeGenerationIdentity::from(&descriptor));
    if state.lifecycle.is_draining() {
        tracing::debug!(
            reason = "version_handoff",
            status = "already_draining",
            "Core handoff evaluated"
        );
        return Ok(Json(ShutdownResponse {
            status: ShutdownStatus::Draining,
            runtime,
            retry_after_ms: None,
        }));
    }
    if state.lifecycle.try_begin_idle_drain_if(|| {
        descriptor_snapshot(state) == descriptor && server_is_idle(state)
    }) {
        tracing::info!(
            reason = "version_handoff",
            status = "accepted",
            "Core drain began"
        );
        return Ok(Json(ShutdownResponse {
            status: ShutdownStatus::Draining,
            runtime,
            retry_after_ms: None,
        }));
    }
    tracing::debug!(
        reason = "version_handoff",
        status = "busy",
        "Core handoff evaluated"
    );
    Ok(Json(ShutdownResponse {
        status: ShutdownStatus::Busy,
        runtime,
        retry_after_ms: Some(250),
    }))
}

fn valid_version_handoff(request: &VersionHandoffRequest, descriptor: &RuntimeDescriptor) -> bool {
    request.protocol_min >= 1
        && request.protocol_min <= request.protocol_max
        && negotiate_protocol(request.protocol_min, request.protocol_max).is_none()
        && !request.build_id.is_empty()
        && request.build_id.len() <= 128
        && request.build_id.trim() == request.build_id
        && request.expected == RuntimeGenerationIdentity::from(descriptor)
}

fn router(state: Arc<ServerState>) -> Router {
    let infrastructure_routes = Router::new()
        .route("/core/v1/health", get(health))
        .route("/core/v1/handshake", post(handshake))
        .route("/core/v1/admin/shutdown", post(shutdown));
    let connected_routes = Router::new()
        .route("/core/v1/events", get(events))
        .route("/core/v1/modules/library/read", post(library_read))
        .route("/core/v1/modules/library/apply", post(library_apply))
        .route("/core/v1/modules/database/read", post(database_read))
        .route("/core/v1/modules/database/apply", post(database_apply))
        .route("/core/v1/modules/workspace/read", post(workspace_read))
        .route("/core/v1/modules/workspace/apply", post(workspace_apply))
        .route("/core/v1/modules/automation/read", post(automation_read))
        .route("/core/v1/modules/automation/apply", post(automation_apply))
        .route(
            "/core/v1/modules/administration/read",
            post(administration_read),
        )
        .route(
            "/core/v1/modules/administration/apply",
            post(administration_apply),
        )
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            bind_connection,
        ))
        .layer(DefaultBodyLimit::max(MAX_JSON_REQUEST_BYTES));
    let document_routes = Router::new()
        .route("/core/v1/modules/document/read", post(document_read))
        .route("/core/v1/modules/document/apply", post(document_apply))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            bind_connection,
        ))
        .layer(DefaultBodyLimit::max(MAX_DOCUMENT_REQUEST_BYTES));
    infrastructure_routes
        .merge(connected_routes)
        .merge(document_routes)
        .layer(middleware::from_fn(transport_bounds::enforce))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            authenticate,
        ))
        .layer(middleware::from_fn(trace_request))
        .with_state(state)
}

fn module_context(
    state: &ServerState,
    headers: &HeaderMap,
    bound: &BoundConnection,
) -> Result<BoundModuleContext, CoreError> {
    Ok(BoundModuleContext {
        profile_id: ProfileId(state.profile_id.clone()),
        library_id: LibraryId(state.library_id.clone()),
        project_id: optional_header(headers, PROJECT_HEADER, "Project")?.map(ProjectId),
        connection_id: bound.id.clone(),
        adapter: bound.adapter.clone(),
    })
}

fn database_context(
    state: &ServerState,
    headers: &HeaderMap,
    bound: &BoundConnection,
) -> Result<BoundModuleContext, CoreError> {
    let project_id = optional_header(headers, PROJECT_HEADER, "Project")?;
    let database_scope = optional_header(headers, DATABASE_SCOPE_HEADER, "Database scope")?;
    let project_id = match (project_id, database_scope.as_deref()) {
        (Some(project_id), None) => Some(ProjectId(project_id)),
        (None, Some(LIBRARY_DATABASE_SCOPE))
            if matches!(
                bound.adapter,
                AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
            ) =>
        {
            None
        }
        (None, Some(LIBRARY_DATABASE_SCOPE)) => {
            return Err(unauthorized(
                "Library Database scope requires a trusted local Adapter",
            ));
        }
        (Some(_), Some(_)) => {
            return Err(unauthorized(
                "Database access cannot bind both Project and Library scope",
            ));
        }
        (None, Some(_)) => return Err(unauthorized("Database scope is unsupported")),
        (None, None) => return Err(unauthorized("Database scope binding is required")),
    };
    Ok(BoundModuleContext {
        profile_id: ProfileId(state.profile_id.clone()),
        library_id: LibraryId(state.library_id.clone()),
        project_id,
        connection_id: bound.id.clone(),
        adapter: bound.adapter.clone(),
    })
}

fn is_document_binary(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        == Some(DOCUMENT_CONTENT_TYPE)
}

fn binary_response(frame: Vec<u8>) -> Response {
    ([(CONTENT_TYPE, DOCUMENT_CONTENT_TYPE)], frame).into_response()
}

fn json_document_read_error(error: CoreError) -> Response {
    Json(OwnedDocumentReadResponse(ResponseEnvelope::Error(
        record_core_error(error),
    )))
    .into_response()
}

fn json_document_apply_error(error: CoreError) -> Response {
    Json(OwnedDocumentApplyResponse(ResponseEnvelope::Error(
        record_core_error(error),
    )))
    .into_response()
}

fn require_wire_version(version: u32) -> Result<(), CoreError> {
    if version == PROTOCOL_MAX {
        return Ok(());
    }
    Err(invalid("Document binary frame version is unsupported"))
}

fn require_same_identity(expected: &str, actual: &str, label: &str) -> Result<(), CoreError> {
    if expected == actual {
        return Ok(());
    }
    Err(CoreError {
        code: CoreErrorCode::Unauthorized,
        message: format!("Document binary {label} does not match its bound header"),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    })
}

fn invalid(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::InvalidInput,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn unauthorized(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::Unauthorized,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn record_core_error(error: CoreError) -> CoreError {
    let code = match &error.code {
        CoreErrorCode::InvalidInput => "invalid_input",
        CoreErrorCode::Unauthorized => "unauthorized",
        CoreErrorCode::NotFound => "not_found",
        CoreErrorCode::Ambiguous => "ambiguous",
        CoreErrorCode::StaleStoreEpoch => "stale_store_epoch",
        CoreErrorCode::RevisionConflict => "revision_conflict",
        CoreErrorCode::GenerationConflict => "generation_conflict",
        CoreErrorCode::HeadConflict => "head_conflict",
        CoreErrorCode::IdempotencyKeyReused => "idempotency_key_reused",
        CoreErrorCode::DocumentUpdateMissingDependencies => "document_update_missing_dependencies",
        CoreErrorCode::InvalidDocumentSchema => "invalid_document_schema",
        CoreErrorCode::MaintenanceInProgress => "maintenance_in_progress",
        CoreErrorCode::SchemaUnsupported => "schema_unsupported",
        CoreErrorCode::StoreCorrupt => "store_corrupt",
        CoreErrorCode::ProtocolIncompatible => "protocol_incompatible",
        CoreErrorCode::EventReplayUnavailable => "event_replay_unavailable",
        CoreErrorCode::ResourceExhausted => "resource_exhausted",
        CoreErrorCode::CoreUnavailable => "core_unavailable",
    };
    match &error.code {
        CoreErrorCode::StoreCorrupt | CoreErrorCode::CoreUnavailable => {
            tracing::error!(
                errorCode = code,
                retryable = error.retryable,
                "Core operation failed"
            );
        }
        CoreErrorCode::MaintenanceInProgress
        | CoreErrorCode::EventReplayUnavailable
        | CoreErrorCode::ResourceExhausted => {
            tracing::warn!(
                errorCode = code,
                retryable = error.retryable,
                "Core operation failed"
            );
        }
        _ => {
            tracing::debug!(
                errorCode = code,
                retryable = error.retryable,
                "Core operation failed"
            );
        }
    }
    error
}

struct DisconnectGuard {
    adapter: OwnedDocumentRealtimeAdapter,
    connection_id: String,
    sender: broadcast::Sender<DocumentTransportPublication>,
}

impl Drop for DisconnectGuard {
    fn drop(&mut self) {
        let Ok(publications) = self.adapter.disconnect(&self.connection_id) else {
            return;
        };
        for publication in publications {
            let _ = self.sender.send(DocumentTransportPublication {
                event: publication.event,
                recipient_connections: publication.recipient_connections,
            });
        }
    }
}

fn document_context(
    state: &ServerState,
    headers: &HeaderMap,
    bound: &BoundConnection,
) -> Result<BoundModuleContext, CoreError> {
    let project_id = optional_header(headers, PROJECT_HEADER, "Project")?;
    let document_scope = optional_header(headers, DOCUMENT_SCOPE_HEADER, "Document scope")?;
    let project_id = match (project_id, document_scope.as_deref()) {
        (Some(project_id), None) => Some(ProjectId(project_id)),
        (None, Some(LIBRARY_DOCUMENT_SCOPE))
            if matches!(
                bound.adapter,
                AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
            ) =>
        {
            None
        }
        (None, Some(LIBRARY_DOCUMENT_SCOPE)) => {
            return Err(unauthorized(
                "Library Document scope requires a trusted local Adapter",
            ));
        }
        (Some(_), Some(_)) => {
            return Err(unauthorized(
                "Document access cannot bind both Project and Library scope",
            ));
        }
        (None, Some(_)) => return Err(unauthorized("Document scope is unsupported")),
        (None, None) => return Err(unauthorized("Document scope binding is required")),
    };
    Ok(BoundModuleContext {
        profile_id: ProfileId(state.profile_id.clone()),
        library_id: LibraryId(state.library_id.clone()),
        project_id,
        connection_id: bound.id.clone(),
        adapter: bound.adapter.clone(),
    })
}

fn connection_binding(
    state: &ServerState,
    connection_id: &str,
    adapter: &AdapterKind,
    peer: &PeerIdentity,
    build_id: &str,
) -> String {
    let adapter = match adapter {
        AdapterKind::ElectronHost => "electron_host",
        AdapterKind::NativeCli => "native_cli",
        AdapterKind::Test => "test",
        AdapterKind::LoopbackHttp => "loopback_http",
        AdapterKind::Agent => "agent",
    };
    let mut digest = Sha256::new();
    digest.update(state.auth_header.as_bytes());
    digest.update(b"\0connection-binding-v2\0");
    digest.update(descriptor_snapshot(state).start_nonce.as_bytes());
    digest.update(b"\0");
    digest.update(connection_id.as_bytes());
    digest.update(b"\0");
    digest.update(adapter.as_bytes());
    digest.update(b"\0");
    digest.update(peer.uid.to_be_bytes());
    digest.update(peer.gid.to_be_bytes());
    digest.update(peer.pid.unwrap_or_default().to_be_bytes());
    digest.update(b"\0");
    digest.update(build_id.as_bytes());
    hex::encode(digest.finalize())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn required_header(
    headers: &HeaderMap,
    name: &'static str,
    label: &str,
) -> Result<String, CoreError> {
    optional_header(headers, name, label)?.ok_or_else(|| CoreError {
        code: CoreErrorCode::Unauthorized,
        message: format!("{label} binding is required"),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    })
}

fn optional_header(
    headers: &HeaderMap,
    name: &'static str,
    label: &str,
) -> Result<Option<String>, CoreError> {
    let Some(value) = headers.get(name) else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| CoreError {
        code: CoreErrorCode::Unauthorized,
        message: format!("{label} binding is not valid UTF-8"),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    })?;
    if value.is_empty() || value.len() > 512 || value.trim() != value {
        return Err(CoreError {
            code: CoreErrorCode::Unauthorized,
            message: format!("{label} binding is invalid"),
            retryable: false,
            recovery: CoreErrorRecovery::None,
        });
    }
    Ok(Some(value.to_owned()))
}

fn valid_binding(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && value.trim() == value
}

fn api_core_error(error: CoreError) -> ApiError {
    let status = match error.code {
        CoreErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
        CoreErrorCode::NotFound => StatusCode::NOT_FOUND,
        CoreErrorCode::InvalidInput => StatusCode::BAD_REQUEST,
        CoreErrorCode::ResourceExhausted => StatusCode::TOO_MANY_REQUESTS,
        _ => StatusCode::CONFLICT,
    };
    ApiError::new(status, error.message)
}

fn connection_registry_error(error: ConnectionRegistryError) -> ApiError {
    let status = match error.kind {
        ConnectionRegistryErrorKind::Unauthorized => StatusCode::UNAUTHORIZED,
        ConnectionRegistryErrorKind::Conflict => StatusCode::CONFLICT,
        ConnectionRegistryErrorKind::ResourceExhausted => StatusCode::TOO_MANY_REQUESTS,
        ConnectionRegistryErrorKind::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    };
    ApiError::new(status, error.message)
}

fn event_document_id(envelope: &EventEnvelope) -> Option<&str> {
    match &envelope.event.payload {
        CoreModuleEventPayload::OwnedDocument(event) => match event {
            nodex_core_contracts::document::OwnedDocumentEvent::DocumentUpdated {
                document_id,
                ..
            }
            | nodex_core_contracts::document::OwnedDocumentEvent::CanvasUpdated {
                document_id,
                ..
            }
            | nodex_core_contracts::document::OwnedDocumentEvent::DocumentInvalidated {
                document_id,
                ..
            } => Some(document_id),
        },
        _ => None,
    }
}

fn realtime_event_document_id(event: &DocumentRealtimeEvent) -> &str {
    match event {
        DocumentRealtimeEvent::Committed(event) => match &event.payload {
            CoreModuleEventPayload::OwnedDocument(event) => match event {
                nodex_core_contracts::document::OwnedDocumentEvent::DocumentUpdated {
                    document_id,
                    ..
                }
                | nodex_core_contracts::document::OwnedDocumentEvent::CanvasUpdated {
                    document_id,
                    ..
                }
                | nodex_core_contracts::document::OwnedDocumentEvent::DocumentInvalidated {
                    document_id,
                    ..
                } => document_id,
            },
            _ => "",
        },
        DocumentRealtimeEvent::Awareness { document_id, .. }
        | DocumentRealtimeEvent::ResyncRequired { document_id, .. } => document_id,
    }
}

fn publish_document_transport(state: &ServerState, publication: AwarenessPublication) {
    let _ = state.document_sender.send(DocumentTransportPublication {
        event: publication.event,
        recipient_connections: publication.recipient_connections,
    });
}

fn record_operation(module: &str, operation_id: &str) {
    let operation_id = log_identity(operation_id);
    let receipt_key = format!("{module}:{operation_id}");
    let span = tracing::Span::current();
    span.record("operationId", operation_id.as_str());
    span.record("receiptKey", receipt_key.as_str());
}

fn log_identity(identity: &str) -> String {
    let digest = Sha256::digest(identity.as_bytes());
    format!("sha256:{}", &hex::encode(digest)[..32])
}

fn record_commit(event_sequence: i64, duplicate: bool) {
    tracing::debug!(
        eventSequence = event_sequence,
        duplicate,
        "Core mutation receipt resolved"
    );
}

fn publish_event(state: &ServerState, event: nodex_core_contracts::CommittedCoreModuleEvent) {
    let (module, event_kind, resource_id, resource_count, generation, head_sequence) =
        event_log_metadata(&event.payload);
    let operation_id = event.operation_id.as_deref().map(log_identity);
    let resource_id = resource_id.map(log_identity);
    tracing::debug!(
        module,
        eventKind = event_kind,
        eventSequence = event.sequence,
        operationId = operation_id.as_deref().unwrap_or("none"),
        resourceIdHash = resource_id.as_deref().unwrap_or("none"),
        resourceCount = resource_count,
        generation = generation.unwrap_or_default(),
        headSequence = head_sequence.unwrap_or_default(),
        "Core event published"
    );
    let envelope = EventEnvelope {
        protocol_version: PROTOCOL_MAX,
        event,
    };
    let _ = state.event_sender.send(envelope);
}

fn event_log_metadata(
    payload: &CoreModuleEventPayload,
) -> (
    &'static str,
    &'static str,
    Option<&str>,
    u64,
    Option<i64>,
    Option<i64>,
) {
    match payload {
        CoreModuleEventPayload::Library(event) => (
            "library",
            "library_changed",
            event
                .page_ids
                .first()
                .or_else(|| event.database_ids.first())
                .or_else(|| event.parent_keys.first())
                .map(String::as_str),
            collection_count(&[
                event.page_ids.len(),
                event.database_ids.len(),
                event.parent_keys.len(),
            ]),
            None,
            None,
        ),
        CoreModuleEventPayload::Database(event) => (
            "database",
            "database_changed",
            event
                .database_ids
                .first()
                .or_else(|| event.data_source_ids.first())
                .or_else(|| event.page_ids.first())
                .or_else(|| event.view_ids.first())
                .map(String::as_str),
            collection_count(&[
                event.database_ids.len(),
                event.data_source_ids.len(),
                event.page_ids.len(),
                event.view_ids.len(),
            ]),
            None,
            None,
        ),
        CoreModuleEventPayload::OwnedDocument(event) => match event {
            nodex_core_contracts::document::OwnedDocumentEvent::DocumentUpdated {
                document_id,
                generation,
                head_seq,
                ..
            } => (
                "owned_document",
                "document_updated",
                Some(document_id),
                1,
                Some(*generation),
                Some(*head_seq),
            ),
            nodex_core_contracts::document::OwnedDocumentEvent::CanvasUpdated {
                document_id,
                generation,
                head_seq,
                ..
            } => (
                "owned_document",
                "canvas_updated",
                Some(document_id),
                1,
                Some(*generation),
                Some(*head_seq),
            ),
            nodex_core_contracts::document::OwnedDocumentEvent::DocumentInvalidated {
                document_id,
                ..
            } => (
                "owned_document",
                "document_invalidated",
                Some(document_id),
                1,
                None,
                None,
            ),
        },
        CoreModuleEventPayload::ProjectWorkspace(event) => (
            "project_workspace",
            "workspace_changed",
            event
                .project_ids
                .first()
                .or_else(|| event.session_ids.first())
                .or_else(|| event.thread_ids.first())
                .map(String::as_str),
            collection_count(&[
                event.project_ids.len(),
                event.session_ids.len(),
                event.thread_ids.len(),
            ]),
            None,
            None,
        ),
        CoreModuleEventPayload::Automation(event) => (
            "automation",
            "automation_changed",
            event
                .automation_ids
                .first()
                .or_else(|| event.lease_ids.first())
                .or_else(|| event.run_ids.first())
                .or_else(|| event.reminder_lease_ids.first())
                .or_else(|| event.page_ids.first())
                .or_else(|| event.document_ids.first())
                .or_else(|| event.database_ids.first())
                .map(String::as_str),
            collection_count(&[
                event.automation_ids.len(),
                event.lease_ids.len(),
                event.run_ids.len(),
                event.reminder_lease_ids.len(),
                event.snooze_ids.len(),
                event.page_ids.len(),
                event.document_ids.len(),
                event.database_ids.len(),
            ]),
            None,
            None,
        ),
        CoreModuleEventPayload::StoreAdministration(event) => (
            "store_administration",
            "store_administration_changed",
            event.backup_ids.first().map(String::as_str),
            collection_count(&[event.backup_ids.len()]),
            None,
            None,
        ),
    }
}

fn collection_count(lengths: &[usize]) -> u64 {
    let count = lengths.iter().copied().fold(0_usize, usize::saturating_add);
    u64::try_from(count).unwrap_or(u64::MAX)
}

fn sse_event(envelope: &EventEnvelope) -> Event {
    Event::default()
        .event("module")
        .id(envelope.event.sequence.to_string())
        .data(serde_json::to_string(envelope).expect("event envelope serializes"))
}

fn sse_core_resync(resync: &EventReplayRequired) -> Event {
    Event::default()
        .event("core-resync-required")
        .data(serde_json::to_string(resync).expect("Core resync event serializes"))
}

fn sse_document_realtime_event(event: &DocumentRealtimeEvent) -> Event {
    Event::default()
        .event("document-realtime")
        .data(document_wire::encode_realtime_event(event).expect("Document event serializes"))
}

fn profile_id(home: &Path) -> String {
    let digest = Sha256::digest(home.as_os_str().as_encoded_bytes());
    format!("profile-{}", hex::encode(&digest[..16]))
}

fn ensure_store_epoch(
    store: &SqliteStoreKernel,
    proposed_epoch: String,
) -> Result<String, nodex_core::infrastructure::sqlite::StoreError> {
    store.writer().call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            transaction.execute(
                "INSERT OR IGNORE INTO block_store_metadata(\
                   id, store_epoch, created_at, updated_at\
                 ) VALUES (1, ?1, \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [&proposed_epoch],
            )?;
            transaction
                .query_row(
                    "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .map_err(Into::into)
        })
    })
}

struct LocalIdentity {
    profile_id: String,
    library_id: String,
}

fn ensure_local_identity(
    store: &SqliteStoreKernel,
    proposed_profile_id: String,
) -> Result<LocalIdentity, nodex_core::infrastructure::sqlite::StoreError> {
    store.writer().call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            let (profile_count, library_count) = transaction.query_row(
                "SELECT (SELECT COUNT(*) FROM profiles), \
                        (SELECT COUNT(*) FROM libraries)",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )?;
            if profile_count != library_count || profile_count > 1 {
                return Err(nodex_core::infrastructure::sqlite::StoreError::new(
                    nodex_core::infrastructure::sqlite::StoreErrorCode::StoreCorrupt,
                    "A Profile store must contain exactly one Profile/Library identity pair",
                    false,
                ));
            }
            if profile_count == 1 {
                let (profile_id, library_id) = transaction.query_row(
                    "SELECT profile.id, library.id FROM profiles profile \
                     JOIN libraries library ON library.profile_id = profile.id",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )?;
                return Ok(LocalIdentity {
                    profile_id,
                    library_id,
                });
            }
            let library_id = proposed_profile_id.replacen("profile-", "library-", 1);
            transaction.execute(
                "INSERT INTO profiles(id, created_at, updated_at) VALUES (?1, \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [&proposed_profile_id],
            )?;
            transaction.execute(
                "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                 VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                [&library_id, &proposed_profile_id],
            )?;
            Ok(LocalIdentity {
                profile_id: proposed_profile_id,
                library_id,
            })
        })
    })
}

pub async fn run(home: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let idle_timeout = configured_idle_timeout()?;
    let paths = RuntimePaths::prepare(&home)?;
    let owner_uid = paths.owner_uid()?;
    let lock = paths.open_lock()?;
    match lock.try_lock_exclusive() {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            match paths.wait_for_running_core(&lock)? {
                ExistingCore::LockAcquired => {}
                ExistingCore::Reuse(descriptor) => {
                    println!("{}", serde_json::to_string(&descriptor)?);
                    return Ok(());
                }
                ExistingCore::HandoffAccepted(descriptor) => {
                    match paths.wait_for_handoff_completion(&lock, &descriptor)? {
                        ExistingCore::LockAcquired => {}
                        ExistingCore::Reuse(descriptor) => {
                            println!("{}", serde_json::to_string(&descriptor)?);
                            return Ok(());
                        }
                        ExistingCore::HandoffAccepted(_) => {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                "replacement Core published another incompatible generation",
                            )
                            .into());
                        }
                    }
                }
            }
        }
        Err(error) => return Err(error.into()),
    }

    paths.remove_stale_socket()?;
    let (logging_guard, logging_handle) = logging::install(&home);
    tracing::info!(
        subsystem = "lifecycle",
        protocolMin = PROTOCOL_MIN,
        protocolMax = PROTOCOL_MAX,
        "Core startup began"
    );

    let auth = random_hex(32)?;
    let start_nonce = random_hex(16)?;
    let proposed_profile_id = profile_id(&home);
    let store = SqliteStoreKernel::open(&home)?;
    let schema_version = u32::try_from(store.preparation().schema_version)?;
    let store_epoch = ensure_store_epoch(&store, random_hex(16)?)?;
    let identity = ensure_local_identity(&store, proposed_profile_id)?;
    let workspace = ProjectWorkspaceModule::new(&identity.profile_id, &identity.library_id, &store)
        .map_err(|error| io::Error::other(error.message))?;
    paths.atomic_write_private(&paths.auth, format!("{auth}\n").as_bytes())?;
    let listener = UnixListener::bind(&paths.socket)?;
    fs::set_permissions(&paths.socket, fs::Permissions::from_mode(PRIVATE_FILE_MODE))?;
    let descriptor = RuntimeDescriptor {
        protocol_min: PROTOCOL_MIN,
        protocol_max: PROTOCOL_MAX,
        build_id: env!("CARGO_PKG_VERSION").to_owned(),
        pid: std::process::id(),
        start_nonce: start_nonce.clone(),
        socket_path: paths.socket.to_string_lossy().into_owned(),
        profile_id: identity.profile_id.clone(),
        store_epoch: store_epoch.clone(),
        readiness_generation: 1,
    };
    paths.atomic_write_private(
        &paths.descriptor,
        format!("{}\n", serde_json::to_string(&descriptor)?).as_bytes(),
    )?;
    println!("{}", serde_json::to_string(&descriptor)?);
    tracing::info!(
        subsystem = "lifecycle",
        readinessGeneration = descriptor.readiness_generation,
        "Core is ready"
    );

    let descriptor = Arc::new(Mutex::new(descriptor));
    let event_log = CoreEventLog::new(store.readers());
    let (event_sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let (document_sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let library = LibraryModule::new(&identity.profile_id, &identity.library_id, &store);
    let database = DatabaseModule::new(&identity.profile_id, &identity.library_id, &store);
    let automation = AutomationModule::new(&identity.profile_id, &identity.library_id, &store);
    let document = OwnedDocumentModule::new(
        identity.profile_id.clone(),
        identity.library_id.clone(),
        &store,
    );
    let document_realtime = OwnedDocumentRealtimeAdapter::new(document.clone());
    let replacement_document = document.clone();
    let replacement_realtime = document_realtime.clone();
    let replacement_descriptor = Arc::clone(&descriptor);
    let replacement_paths = paths.clone();
    let administration =
        StoreAdministrationModule::new(&identity.profile_id, &identity.library_id, &store)
            .with_store_replacement_hook(move |store_epoch| {
                replacement_document
                    .reset_for_store_replacement()
                    .map_err(store_replacement_hook_error)?;
                replacement_realtime
                    .reset_for_store_replacement()
                    .map_err(store_replacement_hook_error)?;
                let mut descriptor = replacement_descriptor.lock().map_err(|_| {
                    StoreError::new(
                        StoreErrorCode::Internal,
                        "Core runtime descriptor lock failed during Store replacement",
                        false,
                    )
                })?;
                let mut next = descriptor.clone();
                next.store_epoch = store_epoch.to_owned();
                next.readiness_generation =
                    next.readiness_generation.checked_add(1).ok_or_else(|| {
                        StoreError::new(
                            StoreErrorCode::Internal,
                            "Core readiness generation overflowed during Store replacement",
                            false,
                        )
                    })?;
                let bytes = format!(
                    "{}\n",
                    serde_json::to_string(&next).map_err(|error| {
                        StoreError::new(
                            StoreErrorCode::Internal,
                            format!("Core runtime descriptor could not be encoded: {error}"),
                            false,
                        )
                    })?
                );
                replacement_paths
                    .atomic_write_private(&replacement_paths.descriptor, bytes.as_bytes())
                    .map_err(|error| {
                        StoreError::new(
                            StoreErrorCode::Internal,
                            format!("Core runtime descriptor could not be replaced: {error}"),
                            false,
                        )
                    })?;
                *descriptor = next;
                Ok(())
            });
    let lifecycle = LifecycleCoordinator::new();
    let state = Arc::new(ServerState {
        auth_header: format!("Bearer {auth}"),
        owner_uid,
        connections: ConnectionRegistry::new(),
        lifecycle: lifecycle.clone(),
        profile_id: identity.profile_id,
        library_id: identity.library_id,
        library,
        database,
        workspace,
        automation,
        administration,
        document_realtime,
        document,
        store,
        schema_version,
        descriptor,
        event_log,
        event_sender,
        document_sender,
        metrics: ServerMetrics::default(),
        logging: logging_handle,
    });
    let idle_task = idle_timeout.map(|timeout| {
        let idle_state = Arc::clone(&state);
        let idle_lifecycle = lifecycle.clone();
        tokio::spawn(monitor_idle(idle_lifecycle, timeout, move || {
            server_is_idle(&idle_state)
        }))
    });
    let result = axum::serve(
        listener,
        router(Arc::clone(&state)).into_make_service_with_connect_info::<PeerIdentity>(),
    )
    .with_graceful_shutdown(shutdown_signal(lifecycle))
    .await;
    if let Some(idle_task) = idle_task {
        idle_task.abort();
        let _ = idle_task.await;
    }
    match &result {
        Ok(()) => tracing::info!(subsystem = "lifecycle", "Core server stopped"),
        Err(_) => tracing::error!(subsystem = "lifecycle", "Core server stopped with an error"),
    }
    logging_guard.shutdown();
    paths.cleanup(&start_nonce);
    drop(lock);
    result.map_err(Into::into)
}

fn server_is_idle(state: &ServerState) -> bool {
    if state.lifecycle.is_draining() {
        return false;
    }
    let Ok(connections) = state.connections.activity() else {
        return false;
    };
    if connections.clients != 0 || connections.event_subscriptions != 0 {
        return false;
    }
    let Ok(realtime) = state.document_realtime.activity() else {
        return false;
    };
    if realtime.subscriptions != 0 || realtime.awareness_clients != 0 {
        return false;
    }
    let Ok(prepared_operations) = state.document.prepared_agent_operation_count() else {
        return false;
    };
    if prepared_operations != 0 {
        return false;
    }
    let store = state.store.activity();
    if store.phase != StoreRuntimePhase::Running
        || store.active_writes != 0
        || store.active_reads != 0
        || store.queued_writes != 0
    {
        return false;
    }
    let Ok(now_ms) = unix_time_millis() else {
        return false;
    };
    state
        .automation
        .has_due_background_work(now_ms)
        .is_ok_and(|due| !due)
}

async fn shutdown_signal(lifecycle: LifecycleCoordinator) {
    tokio::select! {
        () = lifecycle.wait_for_drain() => {}
        () = operating_system_shutdown_signal() => {
            if lifecycle.begin_drain() {
                tracing::info!(reason = "operating_system_signal", "Core drain began");
            }
        }
    }
}

async fn operating_system_shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        else {
            return;
        };
        signal.recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
}

fn unix_time_millis() -> Result<i64, std::time::SystemTimeError> {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    Ok(i64::try_from(millis).unwrap_or(i64::MAX))
}

fn store_replacement_hook_error(error: CoreError) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, error.message, error.retryable)
}
