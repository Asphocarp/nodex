#![forbid(unsafe_code)]

use std::convert::Infallible;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use fs2::FileExt;
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::header::{AUTHORIZATION, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use nodex_core_protocol::{
    HandshakeRequest, HandshakeResponse, PROTOCOL_MAX, PROTOCOL_MIN, RuntimeDescriptor,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::net::UnixListener;
use tokio::sync::Notify;

const RUNTIME_DIRECTORY_MODE: u32 = 0o700;
const PRIVATE_FILE_MODE: u32 = 0o600;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const STARTUP_WAIT: Duration = Duration::from_secs(5);

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
    shutdown: Notify,
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

fn json_response<T: Serialize>(status: StatusCode, value: &T) -> Response<Full<Bytes>> {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{\"error\":\"encoding\"}".to_vec());
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .header("connection", "close")
        .body(Full::new(Bytes::from(body)))
        .expect("static response builder")
}

fn error_response(status: StatusCode, message: &str) -> Response<Full<Bytes>> {
    json_response(status, &serde_json::json!({ "error": message }))
}

async fn handle_request(
    request: Request<Incoming>,
    state: Arc<ServerState>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let authorized = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(state.auth_header.as_str());
    if !authorized {
        return Ok(error_response(StatusCode::UNAUTHORIZED, "unauthorized"));
    }

    let response = match (request.method(), request.uri().path()) {
        (&Method::GET, "/core/v1/health") => json_response(
            StatusCode::OK,
            &serde_json::json!({
                "status": "ready",
                "pid": state.descriptor.pid,
                "start_nonce": state.descriptor.start_nonce,
            }),
        ),
        (&Method::POST, "/core/v1/handshake") => {
            let body = match Limited::new(request.into_body(), MAX_REQUEST_BYTES)
                .collect()
                .await
            {
                Ok(body) => body.to_bytes(),
                Err(_) => {
                    return Ok(error_response(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "request body too large",
                    ));
                }
            };
            match serde_json::from_slice::<HandshakeRequest>(&body) {
                Ok(handshake)
                    if handshake.protocol_min <= PROTOCOL_MAX
                        && handshake.protocol_max >= PROTOCOL_MIN
                        && handshake
                            .expected_profile_id
                            .as_ref()
                            .is_none_or(|id| id == &state.descriptor.profile_id)
                        && handshake
                            .expected_start_nonce
                            .as_ref()
                            .is_none_or(|nonce| nonce == &state.descriptor.start_nonce) =>
                {
                    json_response(
                        StatusCode::OK,
                        &HandshakeResponse {
                            protocol_version: PROTOCOL_MAX,
                            build_id: state.descriptor.build_id.clone(),
                            pid: state.descriptor.pid,
                            start_nonce: state.descriptor.start_nonce.clone(),
                            profile_id: state.descriptor.profile_id.clone(),
                            library_id: "probe-library".to_owned(),
                            store_epoch: state.descriptor.store_epoch.clone(),
                            schema_version: 0,
                            event_head: 0,
                        },
                    )
                }
                Ok(_) => error_response(StatusCode::CONFLICT, "protocol or identity mismatch"),
                Err(_) => error_response(StatusCode::BAD_REQUEST, "invalid handshake"),
            }
        }
        (&Method::POST, "/core/v1/admin/shutdown") => {
            state.shutdown.notify_one();
            json_response(StatusCode::OK, &serde_json::json!({ "status": "draining" }))
        }
        _ => error_response(StatusCode::NOT_FOUND, "not found"),
    };
    Ok(response)
}

async fn serve(
    listener: UnixListener,
    state: Arc<ServerState>,
) -> Result<(), Box<dyn std::error::Error>> {
    loop {
        tokio::select! {
            _ = state.shutdown.notified() => return Ok(()),
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    let service = service_fn(move |request| {
                        handle_request(request, Arc::clone(&state))
                    });
                    let mut builder = http1::Builder::new();
                    builder.keep_alive(false).max_buf_size(MAX_REQUEST_BYTES);
                    let _ = builder
                        .serve_connection(TokioIo::new(stream), service)
                        .await;
                });
            }
        }
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

async fn run(home: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
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
        store_epoch,
        readiness_generation: 1,
    };
    atomic_write(
        &paths.descriptor,
        format!("{}\n", serde_json::to_string(&descriptor)?).as_bytes(),
    )?;
    println!("{}", serde_json::to_string(&descriptor)?);

    let state = Arc::new(ServerState {
        auth_header: format!("Bearer {auth}"),
        descriptor,
        shutdown: Notify::new(),
    });
    let result = serve(listener, Arc::clone(&state)).await;
    cleanup(&paths, &start_nonce);
    drop(lock);
    result
}

fn parse_home() -> Result<PathBuf, String> {
    let args: Vec<String> = env::args().collect();
    match args.as_slice() {
        [_, flag, home] if flag == "--home" => Ok(PathBuf::from(home)),
        _ => Err("usage: nodex-core --home <absolute-home>".to_owned()),
    }
}

#[tokio::main]
async fn main() {
    let home = match parse_home() {
        Ok(home) => home,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    if let Err(error) = run(home).await {
        eprintln!("nodex-core startup failed: {error}");
        std::process::exit(1);
    }
}
