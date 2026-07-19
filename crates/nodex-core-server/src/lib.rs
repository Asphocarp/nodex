#![forbid(unsafe_code)]

mod connections;
mod document_wire;
mod runtime_files;
mod transport_bounds;

use std::convert::Infallible;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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
use nodex_core::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use nodex_core::infrastructure::store::SqliteStoreKernel;
use nodex_core::library::LibraryModule;
use nodex_core::workspace::ProjectWorkspaceModule;
use nodex_core_contracts::document::{OwnedDocumentIntent, OwnedDocumentRead};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CoreError, CoreErrorCode, CoreErrorRecovery,
    CoreModuleEventPayload, LibraryId, ProfileId, ProjectId, StoreEpoch,
};
use nodex_core_protocol::{
    AutomationApplyRequest, AutomationApplyResponse, AutomationReadRequest, AutomationReadResponse,
    ClientKind, DatabaseApplyRequest, DatabaseApplyResponse, DatabaseReadRequest,
    DatabaseReadResponse, EventEnvelope, HandshakeRequest, HandshakeResponse, HealthResponse,
    LibraryApplyRequest, LibraryApplyResponse, LibraryReadRequest, LibraryReadResponse,
    OwnedDocumentApplyRequest, OwnedDocumentApplyResponse, OwnedDocumentReadRequest,
    OwnedDocumentReadResponse, PROTOCOL_MAX, PROTOCOL_MIN, ProjectWorkspaceApplyRequest,
    ProjectWorkspaceApplyResponse, ProjectWorkspaceReadRequest, ProjectWorkspaceReadResponse,
    ResponseEnvelope, RuntimeDescriptor, ShutdownResponse, ShutdownStatus,
    StoreAdministrationApplyRequest, StoreAdministrationApplyResponse,
    StoreAdministrationReadRequest, StoreAdministrationReadResponse,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::UnixListener;
use tokio::sync::{Notify, broadcast};

use connections::{BoundConnection, ConnectionRegistry, PeerIdentity};
use document_wire::{ApplyFrame, CONTENT_TYPE as DOCUMENT_CONTENT_TYPE};
use runtime_files::{PRIVATE_FILE_MODE, RuntimePaths, random_hex};
use transport_bounds::{MAX_DOCUMENT_REQUEST_BYTES, MAX_JSON_REQUEST_BYTES};

const EVENT_CHANNEL_CAPACITY: usize = 64;
const PROJECT_HEADER: &str = "x-nodex-project-id";
const CONNECTION_HEADER: &str = "x-nodex-connection-id";
const CONNECTION_BINDING_HEADER: &str = "x-nodex-connection-binding";
const DOCUMENT_HEADER: &str = "x-nodex-document-id";
const CLIENT_SESSION_HEADER: &str = "x-nodex-client-session-id";

struct ServerState {
    auth_header: String,
    owner_uid: u32,
    connections: ConnectionRegistry,
    draining: AtomicBool,
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
    _store: SqliteStoreKernel,
    events: Arc<Mutex<Vec<EventEnvelope>>>,
    event_sender: broadcast::Sender<EventEnvelope>,
    document_sender: broadcast::Sender<DocumentTransportPublication>,
    shutdown: Notify,
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

async fn bind_connection(
    State(state): State<Arc<ServerState>>,
    ConnectInfo(peer): ConnectInfo<PeerIdentity>,
    mut request: Request,
    next: Next,
) -> Response {
    if state.draining.load(Ordering::Acquire) && request.uri().path() != "/core/v1/admin/shutdown" {
        return ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "Core is draining").into_response();
    }
    let connection_id = match required_header(request.headers(), CONNECTION_HEADER, "Connection") {
        Ok(value) => value,
        Err(error) => return api_core_error(error).into_response(),
    };
    let binding = match required_header(
        request.headers(),
        CONNECTION_BINDING_HEADER,
        "Connection binding",
    ) {
        Ok(value) => value,
        Err(error) => return api_core_error(error).into_response(),
    };
    let bound = match state.connections.bind(&connection_id, &binding, &peer) {
        Ok(bound) => bound,
        Err(message) => {
            return ApiError::new(StatusCode::UNAUTHORIZED, message).into_response();
        }
    };
    request.extensions_mut().insert(bound);
    next.run(request).await
}

async fn health(State(state): State<Arc<ServerState>>) -> Json<HealthResponse> {
    let descriptor = descriptor_snapshot(&state);
    Json(HealthResponse {
        status: nodex_core_protocol::CoreReadiness::Ready,
        pid: descriptor.pid,
        start_nonce: descriptor.start_nonce,
    })
}

async fn handshake(
    State(state): State<Arc<ServerState>>,
    ConnectInfo(peer): ConnectInfo<PeerIdentity>,
    Json(request): Json<HandshakeRequest>,
) -> Result<Json<HandshakeResponse>, ApiError> {
    if state.draining.load(Ordering::Acquire) {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Core is draining",
        ));
    }
    let descriptor = descriptor_snapshot(&state);
    let compatible = request.protocol_min >= 1
        && request.protocol_min <= request.protocol_max
        && request.protocol_min <= PROTOCOL_MAX
        && request.protocol_max >= PROTOCOL_MIN
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
            adapter,
            &peer,
            &request.client.build_id,
            PROTOCOL_MAX,
        )
        .map_err(|message| ApiError::new(StatusCode::CONFLICT, message))?;

    Ok(Json(HandshakeResponse {
        protocol_version: PROTOCOL_MAX,
        build_id: descriptor.build_id,
        pid: descriptor.pid,
        start_nonce: descriptor.start_nonce,
        profile_id: descriptor.profile_id,
        library_id: state.library_id.clone(),
        connection_binding,
        store_epoch: descriptor.store_epoch,
        schema_version: state.schema_version,
        event_head: state
            .events
            .lock()
            .expect("event mutex poisoned")
            .last()
            .map_or(0, |event| event.event.sequence),
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
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(LibraryReadResponse(response))
}

async fn library_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(LibraryApplyRequest(request)): Json<LibraryApplyRequest>,
) -> Json<LibraryApplyResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.library.apply(&context, request) {
            Ok(outcome) => {
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(LibraryApplyResponse(response))
}

async fn database_read(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(DatabaseReadRequest(request)): Json<DatabaseReadRequest>,
) -> Json<DatabaseReadResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.database.read(&context, request) {
            Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(DatabaseReadResponse(response))
}

async fn database_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(DatabaseApplyRequest(request)): Json<DatabaseApplyRequest>,
) -> Json<DatabaseApplyResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.database.apply(&context, request) {
            Ok(outcome) => {
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
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
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(ProjectWorkspaceReadResponse(response))
}

async fn workspace_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(ProjectWorkspaceApplyRequest(request)): Json<ProjectWorkspaceApplyRequest>,
) -> Json<ProjectWorkspaceApplyResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.workspace.apply(&context, request) {
            Ok(outcome) => {
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
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
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(AutomationReadResponse(response))
}

async fn automation_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(AutomationApplyRequest(request)): Json<AutomationApplyRequest>,
) -> Json<AutomationApplyResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.automation.apply(&context, request) {
            Ok(outcome) => {
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
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
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(StoreAdministrationReadResponse(response))
}

async fn administration_apply(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
    headers: HeaderMap,
    Json(StoreAdministrationApplyRequest(request)): Json<StoreAdministrationApplyRequest>,
) -> Json<StoreAdministrationApplyResponse> {
    let response = match module_context(&state, &headers, &bound) {
        Ok(context) => match state.administration.apply(&context, request) {
            Ok(outcome) => {
                if let Some(event) = outcome.event {
                    publish_event(&state, event);
                }
                ResponseEnvelope::Ok(outcome.committed)
            }
            Err(error) => ResponseEnvelope::Error(error),
        },
        Err(error) => ResponseEnvelope::Error(error),
    };
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
                Err(error) => ResponseEnvelope::Error(error),
            }
        }
        Err(error) => ResponseEnvelope::Error(error),
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
                    for event in outcome.events {
                        publish_event(&state, event);
                    }
                    ResponseEnvelope::Ok(outcome.committed)
                }
                Err(error) => ResponseEnvelope::Error(error),
            }
        }
        Err(error) => ResponseEnvelope::Error(error),
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
    let (replay, replay_head, resync, initial_awareness, connection_id, disconnect) =
        if let Some(document_id) = requested_document_id.as_ref() {
            let context = document_context(&state, &headers, &bound).map_err(api_core_error)?;
            let client_session_id =
                required_header(&headers, CLIENT_SESSION_HEADER, "Document client session")
                    .map_err(api_core_error)?;
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
                resync,
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
            let events = state.events.lock().expect("event mutex poisoned");
            let replay = events
                .iter()
                .filter(|event| event.event.sequence > query.after)
                .cloned()
                .collect::<Vec<_>>();
            let replay_head = replay
                .last()
                .map_or(query.after, |event| event.event.sequence);
            (replay, replay_head, None, None, None, None)
        };
    let stream = async_stream::stream! {
        let _disconnect = disconnect;
        for envelope in replay {
            yield Ok(sse_event(&envelope));
        }
        if let Some(resync) = resync {
            yield Ok(Event::default()
                .event("document-resync-required")
                .data(serde_json::to_string(&resync).expect("resync event serializes")));
        }
        if let Some(awareness) = initial_awareness {
            yield Ok(sse_document_realtime_event(&awareness));
        }
        loop {
            tokio::select! {
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
                        yield Ok(sse_event(&envelope));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => break,
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
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    };
    Ok(Sse::new(stream))
}

async fn shutdown(
    State(state): State<Arc<ServerState>>,
    Extension(bound): Extension<BoundConnection>,
) -> Result<Json<ShutdownResponse>, ApiError> {
    if !matches!(
        bound.adapter,
        AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
    ) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "connection role cannot control Core lifecycle",
        ));
    }
    state.draining.store(true, Ordering::Release);
    state.shutdown.notify_one();
    Ok(Json(ShutdownResponse {
        status: ShutdownStatus::Draining,
    }))
}

fn router(state: Arc<ServerState>) -> Router {
    let infrastructure_routes = Router::new()
        .route("/core/v1/health", get(health))
        .route("/core/v1/handshake", post(handshake));
    let connected_routes = Router::new()
        .route("/core/v1/events", get(events))
        .route("/core/v1/admin/shutdown", post(shutdown))
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
    Json(OwnedDocumentReadResponse(ResponseEnvelope::Error(error))).into_response()
}

fn json_document_apply_error(error: CoreError) -> Response {
    Json(OwnedDocumentApplyResponse(ResponseEnvelope::Error(error))).into_response()
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
    Ok(BoundModuleContext {
        profile_id: ProfileId(state.profile_id.clone()),
        library_id: LibraryId(state.library_id.clone()),
        project_id: Some(ProjectId(required_header(
            headers,
            PROJECT_HEADER,
            "Project",
        )?)),
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
        _ => StatusCode::CONFLICT,
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

fn publish_event(state: &ServerState, event: nodex_core_contracts::CommittedCoreModuleEvent) {
    let envelope = EventEnvelope {
        protocol_version: PROTOCOL_MAX,
        event,
    };
    state
        .events
        .lock()
        .expect("event mutex poisoned")
        .push(envelope.clone());
    let _ = state.event_sender.send(envelope);
}

fn sse_event(envelope: &EventEnvelope) -> Event {
    Event::default()
        .event("module")
        .id(envelope.event.sequence.to_string())
        .data(serde_json::to_string(envelope).expect("event envelope serializes"))
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
    let paths = RuntimePaths::prepare(&home)?;
    let owner_uid = paths.owner_uid()?;
    let lock = paths.open_lock()?;
    if lock.try_lock_exclusive().is_err() {
        let descriptor = paths.wait_for_running_core()?;
        println!("{}", serde_json::to_string(&descriptor)?);
        return Ok(());
    }

    paths.remove_stale_socket()?;

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

    let descriptor = Arc::new(Mutex::new(descriptor));
    let events = Arc::new(Mutex::new(Vec::new()));
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
    let replacement_events = Arc::clone(&events);
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
                let mut events = replacement_events.lock().map_err(|_| {
                    StoreError::new(
                        StoreErrorCode::Internal,
                        "Core event replay lock failed during Store replacement",
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
                events.clear();
                *descriptor = next;
                Ok(())
            });
    let state = Arc::new(ServerState {
        auth_header: format!("Bearer {auth}"),
        owner_uid,
        connections: ConnectionRegistry::new(),
        draining: AtomicBool::new(false),
        profile_id: identity.profile_id,
        library_id: identity.library_id,
        library,
        database,
        workspace,
        automation,
        administration,
        document_realtime,
        document,
        _store: store,
        schema_version,
        descriptor,
        events,
        event_sender,
        document_sender,
        shutdown: Notify::new(),
    });
    let shutdown_state = Arc::clone(&state);
    let result = axum::serve(
        listener,
        router(Arc::clone(&state)).into_make_service_with_connect_info::<PeerIdentity>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_state.shutdown.notified().await;
    })
    .await;
    paths.cleanup(&start_nonce);
    drop(lock);
    result.map_err(Into::into)
}

fn store_replacement_hook_error(error: CoreError) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, error.message, error.retryable)
}
