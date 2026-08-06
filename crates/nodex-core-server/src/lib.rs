#![forbid(unsafe_code)]

mod connections;
mod document_wire;
mod lifecycle;
mod lifecycle_summary;
mod logging;
mod metrics;
mod runtime_files;
mod transport_bounds;

use std::convert::Infallible;
use std::fs;
use std::io::{self, Write};
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
use nodex_core::block_record_module::{BlockRecordModule, BlockRecordSelection};
use nodex_core::content_store::ContentSlot;
use nodex_core::database::DatabaseModule;
use nodex_core::document::{
    AwarenessPublication, DocumentRealtimeEvent, OwnedDocumentModule, OwnedDocumentRealtimeAdapter,
};
use nodex_core::domain::block_record::PlacementParent;
use nodex_core::infrastructure::event_log::{CoreEventLog, CoreEventReplay};
use nodex_core::infrastructure::metrics::DurationMetricSnapshot;
use nodex_core::infrastructure::migration::StorePreparationEvent;
use nodex_core::infrastructure::sqlite::{
    StoreError, StoreErrorCode, transaction_duration_metrics, with_immediate_transaction,
};
use nodex_core::infrastructure::store::SqliteStoreKernel;
use nodex_core::infrastructure::writer::StoreRuntimePhase;
use nodex_core::library::LibraryModule;
use nodex_core::local_commit::{AppendedLocalCommit, LocalCommitEnvelope};
use nodex_core::mutation_kernel::{
    BlockCopyEntry, BlockMoveEntry, BlockMutationOperation, BlockMutationRequest,
    BlockPagePlacementEntry, BlockPlacementRebalance, BlockPromotionEntry, BlockRecordUpdateEntry,
    BlockTreeNode, BlockViewPositionRebalance,
};
use nodex_core::workspace::ProjectWorkspaceModule;
use nodex_core_contracts::administration::StoreAdministrationIntent;
use nodex_core_contracts::document::{OwnedDocumentIntent, OwnedDocumentRead};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CoreError, CoreErrorCode, CoreErrorRecovery,
    CoreModuleEventPayload, LibraryId, ProfileId, ProjectId, StoreEpoch,
};
use nodex_core_protocol::{
    AutomationApplyRequest, AutomationApplyResponse, AutomationReadRequest, AutomationReadResponse,
    BlockPlacementValue, BlockRecordApplyRequest, BlockRecordApplyResponse,
    BlockRecordCommittedValue, BlockRecordContentValue, BlockRecordCursor, BlockRecordEffect,
    BlockRecordGraph, BlockRecordOperation, BlockRecordPayloadCompleteness,
    BlockRecordPlacementParent, BlockRecordRead, BlockRecordReadRequest, BlockRecordReadResponse,
    BlockRecordReadSnapshot, BlockRecordValue, BlockRecordViewPositionValue, ClientKind,
    CoreHealthMetrics, CoreReadiness, CoreSelectionDisposition, CoreSelectionPolicy,
    CoreSelectionReason, CoreSelectionResult, CoreStartupEvent, CoreStartupEventFrame,
    DatabaseApplyRequest, DatabaseApplyResponse, DatabaseReadRequest, DatabaseReadResponse,
    EventEnvelope, EventReplayRequired, HandshakeRequest, HandshakeResponse, HealthDurationMetric,
    HealthResponse, LauncherKind, LibraryApplyRequest, LibraryApplyResponse, LibraryReadRequest,
    LibraryReadResponse, OwnedDocumentApplyRequest, OwnedDocumentApplyResponse,
    OwnedDocumentReadRequest, OwnedDocumentReadResponse, ProjectWorkspaceApplyRequest,
    ProjectWorkspaceApplyResponse, ProjectWorkspaceReadRequest, ProjectWorkspaceReadResponse,
    ResponseEnvelope, RuntimeDescriptor, RuntimeGenerationIdentity, ShutdownRequest,
    ShutdownResponse, ShutdownStatus, StoreAdministrationApplyRequest,
    StoreAdministrationApplyResponse, StoreAdministrationReadRequest,
    StoreAdministrationReadResponse, TRANSPORT_PROTOCOL_MAX, TRANSPORT_PROTOCOL_MIN,
    canonical_manifest_digest, core_client_requirements, core_compatibility_manifest,
    evaluate_compatibility, replacement_is_forward_safe, store_format,
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
use document_wire::{ApplyFrame, CONTENT_TYPE as DOCUMENT_CONTENT_TYPE, CanvasSyncKind, SyncFrame};
use lifecycle::{DrainReason, LifecycleCoordinator, configured_idle_timeout, monitor_idle};
use lifecycle_summary::LifecycleSummaryWriter;
use metrics::ServerMetrics;
use runtime_files::{
    CandidateRuntime, ExistingCore, PRIVATE_FILE_MODE, RuntimePaths, current_artifact_identity,
    random_hex,
};
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
const INTERNAL_STARTUP_EVENTS_ENV: &str = "NODEX_INTERNAL_STARTUP_EVENTS_VERSION";
const INTERNAL_STARTUP_EVENTS_VERSION: u32 = 1;

fn report_internal_startup_event(event: CoreStartupEvent) {
    if std::env::var(INTERNAL_STARTUP_EVENTS_ENV).as_deref() != Ok("1") {
        return;
    }
    let Ok(line) = serde_json::to_string(&CoreStartupEventFrame {
        startup_event_version: INTERNAL_STARTUP_EVENTS_VERSION,
        event,
    }) else {
        return;
    };
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let _ = writeln!(writer, "{line}");
    let _ = writer.flush();
}

fn duration_millis(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

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
    local_commit_sender: broadcast::Sender<LocalCommitEnvelope>,
    block_record: BlockRecordModule,
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
        "/core/v1/modules/block-record/read" => {
            ("/core/v1/modules/block-record/read", "block_record")
        }
        "/core/v1/modules/block-record/apply" => {
            ("/core/v1/modules/block-record/apply", "block_record")
        }
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
    let prepared_operations = state
        .document
        .prepared_agent_operation_count()
        .and_then(|document| {
            state
                .library
                .prepared_agent_operation_count()
                .map(|library| document.saturating_add(library))
        })
        .ok();
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
    let (
        canvas_sync_initial_snapshots,
        canvas_sync_repair_snapshots,
        canvas_sync_up_to_date,
        canvas_sync_snapshot_bytes,
    ) = state.metrics.canvas_sync();
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
            canvas_sync_initial_snapshots,
            canvas_sync_repair_snapshots,
            canvas_sync_up_to_date,
            canvas_sync_snapshot_bytes,
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
    let generation = RuntimeGenerationIdentity::from(&descriptor);
    let compatibility = evaluate_compatibility(
        &request.requirements,
        &descriptor.manifest,
        &descriptor.actual_store_format,
    );
    if request.expected_generation != generation || compatibility.is_err() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            format!(
                "Core compatibility or generation mismatch: {:?}",
                compatibility.err().unwrap_or_default()
            ),
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
            TRANSPORT_PROTOCOL_MAX,
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
        selected_transport_version: TRANSPORT_PROTOCOL_MAX,
        selected_event_version: request.requirements.event_version,
        selected_module_versions: request.requirements.modules,
        manifest_digest: descriptor.manifest_digest,
        artifact: descriptor.artifact,
        actual_store_format: descriptor.actual_store_format,
        generation,
        library_id: state.library_id.clone(),
        connection_binding,
        store_epoch: descriptor.store_epoch,
        schema_version: state.schema_version,
        event_head,
    }))
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

async fn block_record_read(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(request): Json<BlockRecordReadRequest>,
) -> Json<BlockRecordReadResponse> {
    let response = (|| {
        require_block_record_contract(request.contract_version)?;
        let _context = module_context(&state, &headers, &bound)?;
        let BlockRecordRead::Window {
            parent,
            block_ids,
            include_content,
            include_descendants,
            include_archived,
            view_id,
        } = &request.read;
        let parent = parent.as_ref().map(block_record_parent).transpose()?;
        let (window, observed_cursor) = state
            .block_record
            .read_selection_with_cursor_and_view_and_descendants_and_lifecycle(
                parent.as_ref(),
                block_ids.as_deref(),
                *include_content,
                view_id.as_deref(),
                *include_descendants,
                *include_archived,
            )
            .map_err(block_record_store_error)?;
        let observed_cursor = observed_cursor
            .map(|cursor| BlockRecordCursor {
                store_epoch: cursor.store_epoch,
                commit_seq: cursor.commit_seq,
            })
            .unwrap_or_else(|| BlockRecordCursor {
                store_epoch: state.block_record.store_epoch().to_owned(),
                commit_seq: 0,
            });
        let snapshot = block_record_snapshot(window, observed_cursor)?;
        Ok::<_, CoreError>(ResponseEnvelope::Ok(snapshot))
    })()
    .unwrap_or_else(|error| ResponseEnvelope::Error(record_core_error(error)));
    Json(BlockRecordReadResponse(response))
}

async fn block_record_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(request): Json<BlockRecordApplyRequest>,
) -> Json<BlockRecordApplyResponse> {
    record_operation("block_record", &request.operation_id);
    let response = (|| {
        require_block_record_contract(request.contract_version)?;
        let _context = module_context(&state, &headers, &bound)?;
        let operation = block_record_operation(&request.operation)?;
        let mutation = BlockMutationRequest {
            store_epoch: request.store_epoch,
            operation_id: request.operation_id,
            intent_hash: request.intent_hash,
            commit_id: request.commit_id,
            canonical_hash: request.canonical_hash,
            actor_id: request.actor_id,
            session_id: request.session_id,
            committed_at: request.committed_at,
            // BlockRecord is currently library-scoped. The audience is a
            // Core-owned result, never a renderer-authored routing hint.
            audience: serde_json::json!({"kind": "library", "projectIds": []}),
            operation,
        };
        let committed = state
            .block_record
            .apply(mutation)
            .map_err(block_record_store_error)?;
        let response_value = block_record_commit(committed.clone());
        if !committed.duplicate {
            let _ = state.local_commit_sender.send(committed.envelope);
        }
        Ok::<_, CoreError>(ResponseEnvelope::Ok(response_value))
    })()
    .unwrap_or_else(|error| ResponseEnvelope::Error(record_core_error(error)));
    Json(BlockRecordApplyResponse(response))
}

fn require_block_record_contract(version: u32) -> Result<(), CoreError> {
    if version == nodex_core_protocol::BLOCK_RECORD_CONTRACT_VERSION {
        return Ok(());
    }
    Err(invalid("BlockRecord contract version is unsupported"))
}

fn block_record_store_error(error: StoreError) -> CoreError {
    let code = match error.code {
        StoreErrorCode::InvalidInput | StoreErrorCode::InvalidProfile => {
            CoreErrorCode::InvalidInput
        }
        StoreErrorCode::NotFound => CoreErrorCode::NotFound,
        StoreErrorCode::RevisionConflict | StoreErrorCode::Conflict => {
            CoreErrorCode::RevisionConflict
        }
        StoreErrorCode::StaleStoreEpoch => CoreErrorCode::StaleStoreEpoch,
        StoreErrorCode::IdempotencyKeyReused => CoreErrorCode::IdempotencyKeyReused,
        StoreErrorCode::UnsupportedSchema => CoreErrorCode::SchemaUnsupported,
        StoreErrorCode::MaintenanceInProgress => CoreErrorCode::MaintenanceInProgress,
        StoreErrorCode::ResourceExhausted
        | StoreErrorCode::WriterQueueFull
        | StoreErrorCode::ReaderPoolTimeout
        | StoreErrorCode::QueryCancelled
        | StoreErrorCode::SqliteBusy => CoreErrorCode::ResourceExhausted,
        StoreErrorCode::StoreCorrupt => CoreErrorCode::StoreCorrupt,
        _ => CoreErrorCode::CoreUnavailable,
    };
    CoreError {
        code,
        message: error.message,
        retryable: error.retryable,
        recovery: CoreErrorRecovery::None,
    }
}

fn block_record_operation(
    operation: &BlockRecordOperation,
) -> Result<BlockMutationOperation, CoreError> {
    match operation {
        BlockRecordOperation::Create {
            block_id,
            block_kind,
            properties,
            content_shard_id,
            parent,
            rank_key,
            view_id,
            data_source_id,
            view_group_key,
            view_rank_key,
            materialized_json,
            placement_rebalances,
            view_rebalances,
        } => Ok(BlockMutationOperation::Create {
            block_id: block_id.clone(),
            kind: serde_json::from_value(serde_json::Value::String(block_kind.clone()))
                .map_err(|_| invalid("BlockRecord kind is invalid"))?,
            properties: properties.clone(),
            content_shard_id: content_shard_id.clone(),
            parent: block_record_parent(parent)?,
            rank_key: rank_key.clone(),
            view_id: view_id.clone(),
            data_source_id: data_source_id.clone(),
            view_group_key: view_group_key.clone(),
            view_rank_key: view_rank_key.clone(),
            materialized_json: materialized_json.clone(),
            placement_rebalances: placement_rebalances
                .iter()
                .map(|rebalance| BlockPlacementRebalance {
                    block_id: rebalance.block_id.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
            view_rebalances: view_rebalances
                .iter()
                .map(|rebalance| BlockViewPositionRebalance {
                    block_id: rebalance.block_id.clone(),
                    group_key: rebalance.group_key.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
        }),
        BlockRecordOperation::EnsureDataSource { data_source_id } => {
            Ok(BlockMutationOperation::EnsureDataSource {
                data_source_id: data_source_id.clone(),
            })
        }
        BlockRecordOperation::Move {
            block_id,
            target_parent,
            rank_key,
            expected_block_revision,
            expected_placement_revision,
        } => Ok(BlockMutationOperation::Move {
            block_id: block_id.clone(),
            target_parent: block_record_parent(target_parent)?,
            rank_key: rank_key.clone(),
            expected_block_revision: *expected_block_revision,
            expected_placement_revision: *expected_placement_revision,
        }),
        BlockRecordOperation::MoveMany {
            entries,
            placement_rebalances,
        } => Ok(BlockMutationOperation::MoveMany {
            entries: entries
                .iter()
                .map(|entry| {
                    Ok(BlockMoveEntry {
                        block_id: entry.block_id.clone(),
                        target_parent: block_record_parent(&entry.target_parent)?,
                        rank_key: entry.rank_key.clone(),
                        expected_block_revision: entry.expected_block_revision,
                        expected_placement_revision: entry.expected_placement_revision,
                    })
                })
                .collect::<Result<Vec<_>, CoreError>>()?,
            placement_rebalances: placement_rebalances
                .iter()
                .map(|rebalance| BlockPlacementRebalance {
                    block_id: rebalance.block_id.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
        }),
        BlockRecordOperation::CopySubtree {
            source_block_id,
            target_block_id,
            target_parent,
            rank_key,
            expected_block_revision,
            expected_placement_revision,
            entries,
            view_id,
            data_source_id,
            view_group_key,
            view_rank_key,
            placement_rebalances,
            view_rebalances,
        } => Ok(BlockMutationOperation::CopySubtree {
            source_block_id: source_block_id.clone(),
            target_block_id: target_block_id.clone(),
            target_parent: block_record_parent(target_parent)?,
            rank_key: rank_key.clone(),
            expected_block_revision: *expected_block_revision,
            expected_placement_revision: *expected_placement_revision,
            entries: entries
                .iter()
                .map(|entry| BlockCopyEntry {
                    source_block_id: entry.source_block_id.clone(),
                    target_block_id: entry.target_block_id.clone(),
                    expected_block_revision: entry.expected_block_revision,
                    expected_placement_revision: entry.expected_placement_revision,
                })
                .collect(),
            view_id: view_id.clone(),
            data_source_id: data_source_id.clone(),
            view_group_key: view_group_key.clone(),
            view_rank_key: view_rank_key.clone(),
            placement_rebalances: placement_rebalances
                .iter()
                .map(|rebalance| BlockPlacementRebalance {
                    block_id: rebalance.block_id.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
            view_rebalances: view_rebalances
                .iter()
                .map(|rebalance| BlockViewPositionRebalance {
                    block_id: rebalance.block_id.clone(),
                    group_key: rebalance.group_key.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
        }),
        BlockRecordOperation::UpdateRecord {
            block_id,
            properties,
            expected_block_revision,
            view_id,
            data_source_id,
            view_group_key,
            view_rank_key,
            expected_view_revision,
        } => Ok(BlockMutationOperation::UpdateRecord {
            block_id: block_id.clone(),
            properties: properties.clone(),
            expected_block_revision: *expected_block_revision,
            view_id: view_id.clone(),
            data_source_id: data_source_id.clone(),
            view_group_key: view_group_key.clone(),
            view_rank_key: view_rank_key.clone(),
            expected_view_revision: *expected_view_revision,
        }),
        BlockRecordOperation::UpdateMany {
            entries,
            view_rebalances,
        } => Ok(BlockMutationOperation::UpdateMany {
            entries: entries
                .iter()
                .map(|entry| BlockRecordUpdateEntry {
                    block_id: entry.block_id.clone(),
                    properties: entry.properties.clone(),
                    expected_block_revision: entry.expected_block_revision,
                    view_id: entry.view_id.clone(),
                    data_source_id: entry.data_source_id.clone(),
                    view_group_key: entry.view_group_key.clone(),
                    view_rank_key: entry.view_rank_key.clone(),
                    expected_view_revision: entry.expected_view_revision,
                })
                .collect(),
            view_rebalances: view_rebalances
                .iter()
                .map(|rebalance| BlockViewPositionRebalance {
                    block_id: rebalance.block_id.clone(),
                    group_key: rebalance.group_key.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
        }),
        BlockRecordOperation::ArchiveSubtree {
            block_id,
            expected_block_revision,
            expected_placement_revision,
        } => Ok(BlockMutationOperation::ArchiveSubtree {
            block_id: block_id.clone(),
            expected_block_revision: *expected_block_revision,
            expected_placement_revision: *expected_placement_revision,
        }),
        BlockRecordOperation::RestoreSubtree {
            block_id,
            target_parent,
            rank_key,
            expected_block_revision,
            expected_placement_revision,
            placement_rebalances,
        } => Ok(BlockMutationOperation::RestoreSubtree {
            block_id: block_id.clone(),
            target_parent: block_record_parent(target_parent)?,
            rank_key: rank_key.clone(),
            expected_block_revision: *expected_block_revision,
            expected_placement_revision: *expected_placement_revision,
            placement_rebalances: placement_rebalances
                .iter()
                .map(|rebalance| BlockPlacementRebalance {
                    block_id: rebalance.block_id.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
        }),
        BlockRecordOperation::PromoteToPage {
            block_id,
            data_source_id,
            view_id,
            view_group_key,
            view_rank_key,
            rank_key,
            expected_block_revision,
            expected_placement_revision,
        } => Ok(BlockMutationOperation::PromoteToPage {
            block_id: block_id.clone(),
            data_source_id: data_source_id.clone(),
            view_id: view_id.clone(),
            view_group_key: view_group_key.clone(),
            view_rank_key: view_rank_key.clone(),
            rank_key: rank_key.clone(),
            expected_block_revision: *expected_block_revision,
            expected_placement_revision: *expected_placement_revision,
        }),
        BlockRecordOperation::PromoteManyToPage {
            data_source_id,
            view_id,
            entries,
            view_rebalances,
            placement_rebalances,
        } => Ok(BlockMutationOperation::PromoteManyToPage {
            data_source_id: data_source_id.clone(),
            view_id: view_id.clone(),
            entries: entries
                .iter()
                .map(|entry| BlockPromotionEntry {
                    block_id: entry.block_id.clone(),
                    view_group_key: entry.view_group_key.clone(),
                    view_rank_key: entry.view_rank_key.clone(),
                    rank_key: entry.rank_key.clone(),
                    expected_block_revision: entry.expected_block_revision,
                    expected_placement_revision: entry.expected_placement_revision,
                })
                .collect(),
            view_rebalances: view_rebalances
                .iter()
                .map(|rebalance| BlockViewPositionRebalance {
                    block_id: rebalance.block_id.clone(),
                    group_key: rebalance.group_key.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
            placement_rebalances: placement_rebalances
                .iter()
                .map(|rebalance| BlockPlacementRebalance {
                    block_id: rebalance.block_id.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
        }),
        BlockRecordOperation::PlaceManyInDataSource {
            data_source_id,
            view_id,
            entries,
            view_rebalances,
            placement_rebalances,
        } => Ok(BlockMutationOperation::PlaceManyInDataSource {
            data_source_id: data_source_id.clone(),
            view_id: view_id.clone(),
            entries: entries
                .iter()
                .map(|entry| BlockPagePlacementEntry {
                    block_id: entry.block_id.clone(),
                    view_group_key: entry.view_group_key.clone(),
                    view_rank_key: entry.view_rank_key.clone(),
                    rank_key: entry.rank_key.clone(),
                    expected_block_revision: entry.expected_block_revision,
                    expected_placement_revision: entry.expected_placement_revision,
                })
                .collect(),
            view_rebalances: view_rebalances
                .iter()
                .map(|rebalance| BlockViewPositionRebalance {
                    block_id: rebalance.block_id.clone(),
                    group_key: rebalance.group_key.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
            placement_rebalances: placement_rebalances
                .iter()
                .map(|rebalance| BlockPlacementRebalance {
                    block_id: rebalance.block_id.clone(),
                    rank_key: rebalance.rank_key.clone(),
                    expected_revision: rebalance.expected_revision,
                })
                .collect(),
        }),
        BlockRecordOperation::SetMaterializedContent {
            block_id,
            slot,
            materialized_json,
            expected_revision,
        } => Ok(BlockMutationOperation::SetMaterializedContent {
            block_id: block_id.clone(),
            slot: match slot.as_str() {
                "title" => ContentSlot::Title,
                "inline" => ContentSlot::Inline,
                "body" => ContentSlot::Body,
                "properties" => ContentSlot::Properties,
                _ => return Err(invalid("BlockRecord content slot is invalid")),
            },
            materialized_json: materialized_json.clone(),
            expected_revision: *expected_revision,
        }),
        BlockRecordOperation::ReconcilePageTree {
            page_id,
            expected_page_revision,
            nodes,
        } => Ok(BlockMutationOperation::ReconcilePageTree {
            page_id: page_id.clone(),
            expected_page_revision: *expected_page_revision,
            nodes: nodes
                .iter()
                .map(|node| {
                    Ok(BlockTreeNode {
                        block_id: node.block_id.clone(),
                        kind: serde_json::from_value(serde_json::Value::String(
                            node.block_kind.clone(),
                        ))
                        .map_err(|_| invalid("Page tree Block kind is invalid"))?,
                        properties: node.properties.clone(),
                        content_shard_id: node.content_shard_id.clone(),
                        parent_block_id: node.parent_block_id.clone(),
                        rank_key: node.rank_key.clone(),
                        expected_block_revision: node.expected_block_revision,
                        expected_placement_revision: node.expected_placement_revision,
                        expected_content_revision: node.expected_content_revision,
                        materialized_json: node.materialized_json.clone(),
                    })
                })
                .collect::<Result<Vec<_>, CoreError>>()?,
        }),
    }
}

fn block_record_parent(parent: &BlockRecordPlacementParent) -> Result<PlacementParent, CoreError> {
    match parent {
        BlockRecordPlacementParent::Library => Ok(PlacementParent::Library),
        BlockRecordPlacementParent::Block(id) => {
            if id.trim().is_empty() {
                return Err(invalid("BlockRecord parent id is empty"));
            }
            Ok(PlacementParent::Block(id.clone()))
        }
        BlockRecordPlacementParent::DataSource(id) => {
            if id.trim().is_empty() {
                return Err(invalid("BlockRecord Data Source id is empty"));
            }
            Ok(PlacementParent::DataSource(id.clone()))
        }
    }
}

fn block_record_snapshot(
    window: BlockRecordSelection,
    observed_cursor: BlockRecordCursor,
) -> Result<BlockRecordReadSnapshot, CoreError> {
    let blocks = window
        .blocks
        .iter()
        .map(block_record_value)
        .collect::<Result<Vec<_>, _>>()?;
    let placements = window
        .placements
        .iter()
        .map(block_placement_value)
        .collect::<Result<Vec<_>, _>>()?;
    let view_positions = window
        .view_positions
        .iter()
        .map(|position| BlockRecordViewPositionValue {
            view_id: position.view_id.clone(),
            data_source_id: position.data_source_id.clone(),
            block_id: position.block_id.clone(),
            group_key: position.group_key.clone(),
            rank_key: position.rank_key.clone(),
            revision: position.revision,
        })
        .collect();
    let content = window
        .content
        .records
        .iter()
        .map(|record| {
            Ok(BlockRecordContentValue {
                block_id: record.block_id.clone(),
                slot: serde_json::to_value(&record.slot)
                    .map_err(|_| invalid("BlockRecord content slot could not be encoded"))?,
                library_id: record.library_id.clone(),
                shard_id: record.shard_id.clone(),
                revision: record.revision,
                state_vector_v1: record.state_vector_v1.clone(),
                full_state_v1: record.full_state_v1.clone(),
                state_hash: record.state_hash.clone(),
                materialized_json: record.materialized_json.clone(),
            })
        })
        .collect::<Result<Vec<_>, CoreError>>()?;
    Ok(BlockRecordReadSnapshot {
        library_id: window.library_id.clone(),
        graph: BlockRecordGraph {
            library_id: window.library_id,
            blocks,
            placements,
        },
        view_positions,
        content,
        observed_cursor,
    })
}

fn block_record_value(
    block: &nodex_core::domain::block_record::BlockRecord,
) -> Result<BlockRecordValue, CoreError> {
    Ok(BlockRecordValue {
        id: block.id.clone(),
        library_id: block.library_id.clone(),
        // The protocol field is a plain string. `serde_json::to_string`
        // would add JSON quotes (`"page"`) and make every renderer
        // projection miss the canonical Page kind.
        kind: serde_json::to_value(&block.kind)
            .map_err(|_| invalid("BlockRecord kind could not be encoded"))?
            .as_str()
            .ok_or_else(|| invalid("BlockRecord kind is not a string"))?
            .to_owned(),
        lifecycle: serde_json::to_value(&block.lifecycle)
            .map_err(|_| invalid("BlockRecord lifecycle could not be encoded"))?,
        properties: block.properties.clone(),
        content_shard_id: block.content_shard_id.clone(),
        revision: block.revision,
    })
}

fn block_placement_value(
    placement: &nodex_core::domain::block_record::BlockPlacement,
) -> Result<BlockPlacementValue, CoreError> {
    Ok(BlockPlacementValue {
        block_id: placement.block_id.clone(),
        parent: block_record_parent_value(&placement.parent),
        rank_key: placement.rank_key.clone(),
        revision: placement.revision,
    })
}

fn block_record_parent_value(parent: &PlacementParent) -> BlockRecordPlacementParent {
    match parent {
        PlacementParent::Library => BlockRecordPlacementParent::Library,
        PlacementParent::Block(id) => BlockRecordPlacementParent::Block(id.clone()),
        PlacementParent::DataSource(id) => BlockRecordPlacementParent::DataSource(id.clone()),
    }
}

fn block_record_commit(commit: AppendedLocalCommit) -> BlockRecordCommittedValue {
    block_record_commit_from_envelope(commit.envelope, commit.duplicate)
}

fn block_record_commit_from_envelope(
    envelope: LocalCommitEnvelope,
    duplicate: bool,
) -> BlockRecordCommittedValue {
    let LocalCommitEnvelope {
        cursor,
        commit_id,
        operation_id,
        intent_hash,
        canonical_hash,
        actor_id,
        session_id,
        committed_at,
        effects,
        audience,
    } = envelope;
    BlockRecordCommittedValue {
        cursor: BlockRecordCursor {
            store_epoch: cursor.store_epoch,
            commit_seq: cursor.commit_seq,
        },
        commit_id,
        operation_id,
        intent_hash,
        canonical_hash,
        actor_id,
        session_id,
        committed_at,
        effects: effects
            .into_iter()
            .map(|effect| BlockRecordEffect {
                kind: effect.kind,
                value: effect.value,
            })
            .collect(),
        audience,
        payload_completeness: BlockRecordPayloadCompleteness::Rich,
        duplicate,
    }
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
        match document_wire::decode_sync(bytes)? {
            SyncFrame::Yjs(metadata, state_vector) => {
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
                document_wire::parse_yjs_sync(snapshot)
                    .and_then(|sync| document_wire::encode_sync(&sync))
            }
            SyncFrame::Canvas(metadata) => {
                require_wire_version(metadata.version)?;
                require_same_identity(
                    &header_session,
                    &metadata.client_session_id,
                    "client session",
                )?;
                let snapshot = state.document_realtime.sync_canvas(
                    &context,
                    &metadata.client_session_id,
                    document_id,
                )?;
                let sync = document_wire::parse_canvas_sync(snapshot)?;
                if let Some(known_store_epoch) = metadata.known_store_epoch.as_deref()
                    && known_store_epoch != sync.store_epoch
                {
                    return Err(stale_document_store_epoch(&sync.store_epoch));
                }
                if let Some(known_generation) = metadata.known_generation
                    && known_generation != sync.generation
                {
                    return Err(stale_document_generation(sync.generation, sync.head_seq));
                }
                let kind = match (
                    metadata.known_head_seq,
                    metadata.known_scene_hash.as_deref(),
                ) {
                    (Some(known_head_seq), Some(known_scene_hash))
                        if known_head_seq == sync.head_seq
                            && known_scene_hash == sync.scene_hash =>
                    {
                        CanvasSyncKind::UpToDate
                    }
                    (Some(known_head_seq), Some(_)) if known_head_seq == sync.head_seq => {
                        return Err(canvas_scene_corrupt(
                            "Canvas scene hash disagrees at the same Document head",
                        ));
                    }
                    _ => CanvasSyncKind::Snapshot,
                };
                let frame =
                    document_wire::encode_canvas_sync(&sync, &metadata.sync_request_id, kind)?;
                state.metrics.record_canvas_sync(
                    metadata.known_head_seq.is_none(),
                    match kind {
                        CanvasSyncKind::Snapshot => Some(sync.scene_json.len()),
                        CanvasSyncKind::UpToDate => None,
                    },
                );
                Ok(frame)
            }
        }
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
                        contract_version:
                            nodex_core_contracts::document::OWNED_DOCUMENT_CONTRACT_VERSION,
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
        let subscription_guard = DocumentSubscriptionGuard {
            adapter: state.document_realtime.clone(),
            connection_id: context.connection_id.clone(),
            client_session_id: client_session_id.clone(),
            sender: state.document_sender.clone(),
        };
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
                    transport_version: TRANSPORT_PROTOCOL_MAX,
                    event: *event,
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
            Some(subscription_guard),
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
                        transport_version: TRANSPORT_PROTOCOL_MAX,
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
    if let ShutdownRequest::Replacement(request) = request {
        return replacement_handoff(&state, *request);
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
    if state.lifecycle.begin_drain(DrainReason::ExplicitShutdown) {
        tracing::info!(reason = "explicit", "Core drain began");
    }
    Ok(Json(ShutdownResponse {
        status: ShutdownStatus::Draining,
        runtime: None,
        retry_after_ms: None,
    }))
}

fn replacement_handoff(
    state: &Arc<ServerState>,
    request: nodex_core_protocol::CoreReplacementRequest,
) -> Result<Json<ShutdownResponse>, ApiError> {
    let descriptor = descriptor_snapshot(state);
    let runtime = Some(RuntimeGenerationIdentity::from(&descriptor));
    let manifest_digest = canonical_manifest_digest(&request.candidate_manifest);
    let forward_safe = replacement_is_forward_safe(
        &descriptor.manifest,
        &request.candidate_manifest,
        &descriptor.actual_store_format,
    );
    let contract_changed = request.candidate_manifest != descriptor.manifest;
    let artifact_changed = request.candidate_artifact.sha256 != descriptor.artifact.sha256;
    let policy_requires_replacement = contract_changed
        || (matches!(
            request.policy,
            nodex_core_protocol::CoreSelectionPolicy::PreferCurrentArtifact
        ) && artifact_changed);
    if request.expected != RuntimeGenerationIdentity::from(&descriptor)
        || manifest_digest.as_ref() != Ok(&request.candidate_manifest_digest)
        || forward_safe.is_err()
        || !policy_requires_replacement
    {
        tracing::warn!(
            reason = "replacement",
            status = "rejected_downgrade",
            "Core replacement rejected"
        );
        return Ok(Json(ShutdownResponse {
            status: ShutdownStatus::Incompatible,
            runtime,
            retry_after_ms: None,
        }));
    }
    if state.lifecycle.is_draining() {
        tracing::debug!(
            reason = "replacement",
            status = "already_draining",
            "Core handoff evaluated"
        );
        return Ok(Json(ShutdownResponse {
            status: ShutdownStatus::Draining,
            runtime,
            retry_after_ms: None,
        }));
    }
    if state
        .lifecycle
        .try_begin_idle_drain_if(DrainReason::Replacement, || {
            descriptor_snapshot(state) == descriptor && server_is_idle(state)
        })
    {
        tracing::info!(
            reason = "replacement",
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
        reason = "replacement",
        status = "busy",
        "Core handoff evaluated"
    );
    Ok(Json(ShutdownResponse {
        status: ShutdownStatus::Busy,
        runtime,
        retry_after_ms: Some(250),
    }))
}

async fn local_commits(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    if query.after < 0 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "LocalCommit cursor must be non-negative",
        ));
    }
    let _context = module_context(&state, &headers, &bound).map_err(api_core_error)?;
    let mut receiver = state.local_commit_sender.subscribe();
    let cursor = nodex_core::local_commit::LocalCommitCursor {
        store_epoch: state.block_record.store_epoch().to_owned(),
        commit_seq: query.after,
    };
    let initial = state
        .block_record
        .read_local_commits_after(&cursor, 10_000)
        .map_err(|error| api_core_error(block_record_store_error(error)))?;
    let stream = async_stream::stream! {
        let mut last_seq = query.after;
        for envelope in initial {
            last_seq = last_seq.max(envelope.cursor.commit_seq);
            let wire = block_record_commit_from_envelope(envelope, false);
            yield Ok(sse_local_commit(&wire));
        }
        loop {
            match receiver.recv().await {
                Ok(envelope) => {
                    if envelope.cursor.store_epoch != cursor.store_epoch
                        || envelope.cursor.commit_seq <= last_seq
                    {
                        continue;
                    }
                    last_seq = envelope.cursor.commit_seq;
                    let wire = block_record_commit_from_envelope(envelope, false);
                    yield Ok(sse_local_commit(&wire));
                }
                Err(broadcast::error::RecvError::Lagged(_))
                | Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Ok(Sse::new(stream))
}

fn router(state: Arc<ServerState>) -> Router {
    let infrastructure_routes = Router::new()
        .route("/core/v1/health", get(health))
        .route("/core/v1/handshake", post(handshake))
        .route("/core/v1/admin/shutdown", post(shutdown));
    let connected_routes = Router::new()
        .route("/core/v1/events", get(events))
        .route("/core/v1/local-commits", get(local_commits))
        .route("/core/v1/modules/library/read", post(library_read))
        .route("/core/v1/modules/library/apply", post(library_apply))
        .route(
            "/core/v1/modules/block-record/read",
            post(block_record_read),
        )
        .route(
            "/core/v1/modules/block-record/apply",
            post(block_record_apply),
        )
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
    if version == 2 {
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

fn stale_document_store_epoch(current_store_epoch: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::StaleStoreEpoch,
        message: "Canvas sync belongs to a different store epoch".to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::CurrentStoreEpoch {
            store_epoch: StoreEpoch(current_store_epoch.to_owned()),
        },
    }
}

fn stale_document_generation(generation: i64, head_seq: i64) -> CoreError {
    CoreError {
        code: CoreErrorCode::GenerationConflict,
        message: "Canvas sync belongs to a different Document generation".to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::CurrentDocumentHead {
            generation,
            head_seq,
        },
    }
}

fn canvas_scene_corrupt(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::StoreCorrupt,
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
        CoreErrorCode::PatchNotFound => "patch_not_found",
        CoreErrorCode::PatchAmbiguous => "patch_ambiguous",
        CoreErrorCode::PatchOverlap => "patch_overlap",
        CoreErrorCode::IdempotencyKeyReused => "idempotency_key_reused",
        CoreErrorCode::ProtectedOwnerDeletion => "protected_owner_deletion",
        CoreErrorCode::DocumentUpdateMissingDependencies => "document_update_missing_dependencies",
        CoreErrorCode::InvalidDocumentSchema => "invalid_document_schema",
        CoreErrorCode::MaterializationStale => "materialization_stale",
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

struct DocumentSubscriptionGuard {
    adapter: OwnedDocumentRealtimeAdapter,
    connection_id: String,
    client_session_id: String,
    sender: broadcast::Sender<DocumentTransportPublication>,
}

impl Drop for DocumentSubscriptionGuard {
    fn drop(&mut self) {
        let Ok(publication) = self
            .adapter
            .unsubscribe(&self.connection_id, &self.client_session_id)
        else {
            return;
        };
        if let Some(publication) = publication {
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
            | nodex_core_contracts::document::OwnedDocumentEvent::CanvasGenerationChanged {
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
                | nodex_core_contracts::document::OwnedDocumentEvent::CanvasGenerationChanged {
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
        transport_version: TRANSPORT_PROTOCOL_MAX,
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
            nodex_core_contracts::document::OwnedDocumentEvent::CanvasGenerationChanged {
                document_id,
                generation,
                head_seq,
                ..
            } => (
                "owned_document",
                "canvas_generation_changed",
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

fn sse_local_commit(envelope: &BlockRecordCommittedValue) -> Event {
    Event::default()
        .event("local-commit")
        .id(envelope.cursor.commit_seq.to_string())
        .data(serde_json::to_string(envelope).expect("LocalCommit envelope serializes"))
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
    run_with_selection(
        home,
        CoreSelectionPolicy::Compatible,
        LauncherKind::NativeCli,
    )
    .await
}

pub async fn run_with_selection(
    home: PathBuf,
    selection_policy: CoreSelectionPolicy,
    launcher: LauncherKind,
) -> Result<(), Box<dyn std::error::Error>> {
    let idle_timeout = configured_idle_timeout()?;
    let manifest = core_compatibility_manifest();
    let manifest_digest = canonical_manifest_digest(&manifest)
        .map_err(|mismatch| io::Error::other(format!("invalid Core manifest: {mismatch:?}")))?;
    let artifact_started_at = Instant::now();
    let artifact = current_artifact_identity()?;
    report_internal_startup_event(CoreStartupEvent::CandidateChecked {
        artifact_hash_ms: duration_millis(artifact_started_at.elapsed()),
    });
    let candidate = CandidateRuntime {
        manifest: manifest.clone(),
        manifest_digest: manifest_digest.clone(),
        artifact: artifact.clone(),
        requirements: core_client_requirements(),
        policy: selection_policy,
        launcher,
    };
    let paths = RuntimePaths::prepare(&home)?;
    let owner_uid = paths.owner_uid()?;
    let lock = paths.open_lock()?;
    let mut selection_reason = CoreSelectionReason::StartedNoIncumbent;
    match lock.try_lock_exclusive() {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            match paths.wait_for_running_core(&lock, &candidate)? {
                ExistingCore::LockAcquired => {}
                ExistingCore::Reuse(descriptor, reason) => {
                    println!(
                        "{}",
                        serde_json::to_string(&CoreSelectionResult {
                            selection_version: 1,
                            disposition: CoreSelectionDisposition::Reused,
                            reason,
                            descriptor: *descriptor,
                        })?
                    );
                    return Ok(());
                }
                ExistingCore::HandoffAccepted(descriptor, reason) => {
                    selection_reason = reason;
                    match paths.wait_for_handoff_completion(&lock, &descriptor, &candidate)? {
                        ExistingCore::LockAcquired => {}
                        ExistingCore::Reuse(descriptor, reason) => {
                            println!(
                                "{}",
                                serde_json::to_string(&CoreSelectionResult {
                                    selection_version: 1,
                                    disposition: CoreSelectionDisposition::Reused,
                                    reason,
                                    descriptor: *descriptor,
                                })?
                            );
                            return Ok(());
                        }
                        ExistingCore::HandoffAccepted(_, _) => {
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
        transportMin = TRANSPORT_PROTOCOL_MIN,
        transportMax = TRANSPORT_PROTOCOL_MAX,
        "Core startup began"
    );

    let auth = random_hex(32)?;
    let start_nonce = random_hex(16)?;
    let proposed_profile_id = profile_id(&home);
    let store_started_at = Instant::now();
    let store = SqliteStoreKernel::open_with_observer(&home, |event| match event {
        StorePreparationEvent::MigrationStarted {
            from_version,
            to_version,
        } => report_internal_startup_event(CoreStartupEvent::MigrationStarted {
            from_version,
            to_version,
        }),
    })?;
    report_internal_startup_event(CoreStartupEvent::StoreReady {
        created_fresh: store.preparation().created_fresh,
        migrated_from_version: store.preparation().migrated_from_version,
        store_open_ms: duration_millis(store_started_at.elapsed()),
    });
    let schema_version = u32::try_from(store.preparation().schema_version)?;
    let actual_store_format = store_format(schema_version).ok_or_else(|| {
        io::Error::other(format!(
            "Core Store format v{schema_version} is not declared"
        ))
    })?;
    if actual_store_format != manifest.store.current {
        return Err(io::Error::other("Core opened a non-current Store format").into());
    }
    let store_epoch = ensure_store_epoch(&store, random_hex(16)?)?;
    let identity = ensure_local_identity(&store, proposed_profile_id)?;
    let block_record = BlockRecordModule::new(
        &identity.profile_id,
        &identity.library_id,
        &store_epoch,
        &store,
    );
    let workspace = ProjectWorkspaceModule::new(&identity.profile_id, &identity.library_id, &store)
        .map_err(|error| io::Error::other(error.message))?;
    paths.atomic_write_private(&paths.auth, format!("{auth}\n").as_bytes())?;
    let listener = UnixListener::bind(&paths.socket)?;
    fs::set_permissions(&paths.socket, fs::Permissions::from_mode(PRIVATE_FILE_MODE))?;
    let descriptor = RuntimeDescriptor {
        manifest,
        manifest_digest,
        artifact,
        actual_store_format,
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
    let lifecycle_summary = LifecycleSummaryWriter::start(paths.clone(), &descriptor);
    println!(
        "{}",
        serde_json::to_string(&CoreSelectionResult {
            selection_version: 1,
            disposition: CoreSelectionDisposition::Started,
            reason: selection_reason,
            descriptor: descriptor.clone(),
        })?
    );
    tracing::info!(
        subsystem = "lifecycle",
        readinessGeneration = descriptor.readiness_generation,
        "Core is ready"
    );

    let descriptor = Arc::new(Mutex::new(descriptor));
    let event_log = CoreEventLog::new(store.readers());
    let (event_sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let (document_sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let (local_commit_sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let library = LibraryModule::new(&identity.profile_id, &identity.library_id, &store);
    let replacement_library_operations = library.prepared_agent_operation_registry();
    let replacement_search_snapshots = library.search_snapshot_lease_registry();
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
    let replacement_lifecycle_summary = lifecycle_summary.clone();
    let administration =
        StoreAdministrationModule::new(&identity.profile_id, &identity.library_id, &store)
            .with_store_replacement_hook(move |store_epoch| {
                replacement_library_operations.invalidate_all()?;
                if let Some(search_snapshots) = &replacement_search_snapshots {
                    search_snapshots.invalidate_all()?;
                }
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
                replacement_lifecycle_summary.replace_generation(&next);
                *descriptor = next;
                Ok(())
            });
    let drain_lifecycle_summary = lifecycle_summary.clone();
    let lifecycle = LifecycleCoordinator::with_drain_observer(move |reason| {
        drain_lifecycle_summary.mark_draining(reason);
    });
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
        local_commit_sender,
        block_record,
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
    // Keep the runtime ownership fence held until the Store has released its
    // independent writer lock. A replacement Core may start as soon as
    // `core.lock` is released, so dropping these in the opposite order creates
    // a window where it owns the runtime but cannot open the Profile Store.
    drop(state);
    lifecycle_summary.mark_stopped(result.is_ok());
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
    let Ok(prepared_operations) =
        state
            .document
            .prepared_agent_operation_count()
            .and_then(|document| {
                state
                    .library
                    .prepared_agent_operation_count()
                    .map(|library| document.saturating_add(library))
            })
    else {
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
            if lifecycle.begin_drain(DrainReason::OperatingSystemSignal) {
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
