#![forbid(unsafe_code)]

use std::convert::Infallible;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{DefaultBodyLimit, Query, Request, State};
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::middleware::{self, Next};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use fs2::FileExt;
use nodex_core::library::LibraryModule;
use nodex_core_contracts::{AdapterKind, BoundModuleContext, LibraryId, ProfileId, StoreEpoch};
use nodex_core_protocol::{
    EventEnvelope, HandshakeRequest, HandshakeResponse, HealthResponse, LibraryApplyRequest,
    LibraryApplyResponse, LibraryReadRequest, LibraryReadResponse, PROTOCOL_MAX, PROTOCOL_MIN,
    ResponseEnvelope, RuntimeDescriptor, ShutdownResponse, ShutdownStatus,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::UnixListener;
use tokio::sync::{Notify, broadcast};

const RUNTIME_DIRECTORY_MODE: u32 = 0o700;
const PRIVATE_FILE_MODE: u32 = 0o600;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const STARTUP_WAIT: Duration = Duration::from_secs(5);
const EVENT_CHANNEL_CAPACITY: usize = 64;

struct RuntimePaths {
    directory: PathBuf,
    lock: PathBuf,
    socket: PathBuf,
    descriptor: PathBuf,
    auth: PathBuf,
}

impl RuntimePaths {
    fn new(home: &Path) -> Self {
        let directory = home.join("run/core");
        Self {
            lock: directory.join("core.lock"),
            socket: directory.join("core.sock"),
            descriptor: directory.join("core.json"),
            auth: directory.join("core.auth"),
            directory,
        }
    }
}

struct ServerState {
    auth_header: String,
    descriptor: RuntimeDescriptor,
    library: LibraryModule,
    events: Mutex<Vec<EventEnvelope>>,
    event_sender: broadcast::Sender<EventEnvelope>,
    shutdown: Notify,
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
    request: Request,
    next: Next,
) -> Response {
    let authorized = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(state.auth_header.as_str());
    if !authorized {
        return ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    next.run(request).await
}

async fn health(State(state): State<Arc<ServerState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: nodex_core_protocol::CoreReadiness::Ready,
        pid: state.descriptor.pid,
        start_nonce: state.descriptor.start_nonce.clone(),
    })
}

async fn handshake(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<HandshakeRequest>,
) -> Result<Json<HandshakeResponse>, ApiError> {
    let compatible = request.protocol_min <= PROTOCOL_MAX
        && request.protocol_max >= PROTOCOL_MIN
        && request
            .expected_profile_id
            .as_ref()
            .is_none_or(|id| id == &state.descriptor.profile_id)
        && request
            .expected_start_nonce
            .as_ref()
            .is_none_or(|nonce| nonce == &state.descriptor.start_nonce);
    if !compatible {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "protocol or identity mismatch",
        ));
    }

    Ok(Json(HandshakeResponse {
        protocol_version: PROTOCOL_MAX,
        build_id: state.descriptor.build_id.clone(),
        pid: state.descriptor.pid,
        start_nonce: state.descriptor.start_nonce.clone(),
        profile_id: state.descriptor.profile_id.clone(),
        library_id: "probe-library".to_owned(),
        store_epoch: state.descriptor.store_epoch.clone(),
        schema_version: 0,
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
    Json(LibraryReadRequest(request)): Json<LibraryReadRequest>,
) -> Json<LibraryReadResponse> {
    let response = match state.library.read(&bound_context(&state), request) {
        Ok(snapshot) => ResponseEnvelope::Ok(snapshot),
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(LibraryReadResponse(response))
}

async fn library_apply(
    State(state): State<Arc<ServerState>>,
    Json(LibraryApplyRequest(request)): Json<LibraryApplyRequest>,
) -> Json<LibraryApplyResponse> {
    let response = match state.library.apply(&bound_context(&state), request) {
        Ok(outcome) => {
            if let Some(event) = outcome.event {
                publish_event(&state, event);
            }
            ResponseEnvelope::Ok(outcome.committed)
        }
        Err(error) => ResponseEnvelope::Error(error),
    };
    Json(LibraryApplyResponse(response))
}

async fn events(
    State(state): State<Arc<ServerState>>,
    Query(query): Query<EventQuery>,
) -> Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>> {
    let (replay, mut receiver) = {
        let events = state.events.lock().expect("event mutex poisoned");
        let replay = events
            .iter()
            .filter(|event| event.event.sequence > query.after)
            .cloned()
            .collect::<Vec<_>>();
        (replay, state.event_sender.subscribe())
    };
    let stream = async_stream::stream! {
        for envelope in replay {
            yield Ok(sse_event(&envelope));
        }
        loop {
            match receiver.recv().await {
                Ok(envelope) => yield Ok(sse_event(&envelope)),
                Err(broadcast::error::RecvError::Lagged(_)) => break,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Sse::new(stream)
}

async fn shutdown(State(state): State<Arc<ServerState>>) -> Json<ShutdownResponse> {
    state.shutdown.notify_one();
    Json(ShutdownResponse {
        status: ShutdownStatus::Draining,
    })
}

async fn unavailable_module() -> impl IntoResponse {
    ApiError::new(
        StatusCode::NOT_IMPLEMENTED,
        "Module implementation is not available in the Milestone 1 tracer",
    )
}

fn router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/core/v1/health", get(health))
        .route("/core/v1/handshake", post(handshake))
        .route("/core/v1/events", get(events))
        .route("/core/v1/admin/shutdown", post(shutdown))
        .route("/core/v1/modules/library/read", post(library_read))
        .route("/core/v1/modules/library/apply", post(library_apply))
        .route("/core/v1/modules/database/read", post(unavailable_module))
        .route("/core/v1/modules/database/apply", post(unavailable_module))
        .route("/core/v1/modules/document/read", post(unavailable_module))
        .route("/core/v1/modules/document/apply", post(unavailable_module))
        .route("/core/v1/modules/workspace/read", post(unavailable_module))
        .route("/core/v1/modules/workspace/apply", post(unavailable_module))
        .route("/core/v1/modules/automation/read", post(unavailable_module))
        .route(
            "/core/v1/modules/automation/apply",
            post(unavailable_module),
        )
        .route(
            "/core/v1/modules/administration/read",
            post(unavailable_module),
        )
        .route(
            "/core/v1/modules/administration/apply",
            post(unavailable_module),
        )
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            authenticate,
        ))
        .with_state(state)
}

fn bound_context(state: &ServerState) -> BoundModuleContext {
    BoundModuleContext {
        profile_id: ProfileId(state.descriptor.profile_id.clone()),
        library_id: LibraryId("probe-library".to_owned()),
        project_id: None,
        connection_id: state.descriptor.start_nonce.clone(),
        adapter: AdapterKind::Test,
    }
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

fn validate_home(home: &Path) -> io::Result<()> {
    if !home.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Core home must be absolute",
        ));
    }
    if let Ok(metadata) = fs::symlink_metadata(home)
        && metadata.file_type().is_symlink()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Core home must not be a symlink",
        ));
    }
    Ok(())
}

fn prepare_runtime_directory(paths: &RuntimePaths) -> io::Result<()> {
    fs::create_dir_all(&paths.directory)?;
    let metadata = fs::symlink_metadata(&paths.directory)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Core runtime path must be a real directory",
        ));
    }
    fs::set_permissions(
        &paths.directory,
        fs::Permissions::from_mode(RUNTIME_DIRECTORY_MODE),
    )?;
    Ok(())
}

fn open_lock(paths: &RuntimePaths) -> io::Result<File> {
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&paths.lock)?;
    fs::set_permissions(&paths.lock, fs::Permissions::from_mode(PRIVATE_FILE_MODE))?;
    Ok(lock)
}

fn random_hex(bytes: usize) -> io::Result<String> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value)
        .map_err(|error| io::Error::other(format!("getrandom failed: {error:?}")))?;
    Ok(hex::encode(value))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid runtime file"))?;
    let temporary = path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true).mode(PRIVATE_FILE_MODE);
    let mut file = options.open(&temporary)?;
    io::Write::write_all(&mut file, bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path)?;
    Ok(())
}

fn profile_id(home: &Path) -> String {
    let digest = Sha256::digest(home.as_os_str().as_encoded_bytes());
    format!("profile-{}", hex::encode(&digest[..16]))
}

fn read_descriptor(path: &Path) -> io::Result<RuntimeDescriptor> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || metadata.permissions().mode() & 0o777 != PRIVATE_FILE_MODE
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Core descriptor permissions are invalid",
        ));
    }
    serde_json::from_slice(&fs::read(path)?).map_err(io::Error::other)
}

fn wait_for_descriptor(path: &Path) -> io::Result<RuntimeDescriptor> {
    let deadline = Instant::now() + STARTUP_WAIT;
    loop {
        if let Ok(descriptor) = read_descriptor(path) {
            return Ok(descriptor);
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "another Core holds the lock but did not become ready",
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn cleanup(paths: &RuntimePaths, start_nonce: &str) {
    if read_descriptor(&paths.descriptor)
        .is_ok_and(|descriptor| descriptor.start_nonce == start_nonce)
    {
        for path in [&paths.descriptor, &paths.auth, &paths.socket] {
            let _ = fs::remove_file(path);
        }
    }
}

pub async fn run(home: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    validate_home(&home)?;
    let paths = RuntimePaths::new(&home);
    prepare_runtime_directory(&paths)?;
    let lock = open_lock(&paths)?;
    if lock.try_lock_exclusive().is_err() {
        let descriptor = wait_for_descriptor(&paths.descriptor)?;
        println!("{}", serde_json::to_string(&descriptor)?);
        return Ok(());
    }

    if paths.socket.exists() {
        let metadata = fs::symlink_metadata(&paths.socket)?;
        if metadata.file_type().is_symlink() {
            return Err("refusing to remove a symlinked stale Core socket".into());
        }
        fs::remove_file(&paths.socket)?;
    }

    let auth = random_hex(32)?;
    let start_nonce = random_hex(16)?;
    let store_epoch = random_hex(16)?;
    atomic_write(&paths.auth, format!("{auth}\n").as_bytes())?;
    let listener = UnixListener::bind(&paths.socket)?;
    fs::set_permissions(&paths.socket, fs::Permissions::from_mode(PRIVATE_FILE_MODE))?;
    let descriptor = RuntimeDescriptor {
        protocol_min: PROTOCOL_MIN,
        protocol_max: PROTOCOL_MAX,
        build_id: env!("CARGO_PKG_VERSION").to_owned(),
        pid: std::process::id(),
        start_nonce: start_nonce.clone(),
        socket_path: paths.socket.to_string_lossy().into_owned(),
        profile_id: profile_id(&home),
        store_epoch: store_epoch.clone(),
        readiness_generation: 1,
    };
    atomic_write(
        &paths.descriptor,
        format!("{}\n", serde_json::to_string(&descriptor)?).as_bytes(),
    )?;
    println!("{}", serde_json::to_string(&descriptor)?);

    let (event_sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let state = Arc::new(ServerState {
        auth_header: format!("Bearer {auth}"),
        library: LibraryModule::tracer(
            descriptor.profile_id.clone(),
            "probe-library".to_owned(),
            StoreEpoch(store_epoch),
        ),
        descriptor,
        events: Mutex::new(Vec::new()),
        event_sender,
        shutdown: Notify::new(),
    });
    let shutdown_state = Arc::clone(&state);
    let result = axum::serve(listener, router(Arc::clone(&state)))
        .with_graceful_shutdown(async move {
            shutdown_state.shutdown.notified().await;
        })
        .await;
    cleanup(&paths, &start_nonce);
    drop(lock);
    result.map_err(Into::into)
}
