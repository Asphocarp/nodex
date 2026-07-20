use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use nodex_core_contracts::VersionedModuleContract;
use nodex_core_contracts::administration::{StoreAdministrationIntent, StoreAdministrationRead};
use nodex_core_contracts::automation::{AutomationIntent, AutomationRead};
use nodex_core_contracts::database::{DatabaseIntent, DatabaseRead};
use nodex_core_contracts::document::{OwnedDocumentIntent, OwnedDocumentRead};
use nodex_core_contracts::library::{LibraryIntent, LibraryRead};
use nodex_core_contracts::workspace::{ProjectWorkspaceIntent, ProjectWorkspaceRead};
use serde::Serialize;
use serde::de::DeserializeOwned;
use thiserror::Error;

use crate::{
    AutomationApplyRequest, AutomationApplyResponse, AutomationReadRequest, AutomationReadResponse,
    ClientIdentity, ClientKind, DatabaseApplyRequest, DatabaseApplyResponse, DatabaseReadRequest,
    DatabaseReadResponse, HandshakeRequest, HandshakeResponse, HealthResponse, LibraryApplyRequest,
    LibraryApplyResponse, LibraryReadRequest, LibraryReadResponse, OwnedDocumentApplyRequest,
    OwnedDocumentApplyResponse, OwnedDocumentReadRequest, OwnedDocumentReadResponse, PROTOCOL_MAX,
    PROTOCOL_MIN, ProjectWorkspaceApplyRequest, ProjectWorkspaceApplyResponse,
    ProjectWorkspaceReadRequest, ProjectWorkspaceReadResponse, RuntimeDescriptor, ShutdownRequest,
    ShutdownResponse, StoreAdministrationApplyRequest, StoreAdministrationApplyResponse,
    StoreAdministrationReadRequest, StoreAdministrationReadResponse,
};

const PRIVATE_MODE: u32 = 0o600;
const RUNTIME_DIRECTORY_MODE: u32 = 0o700;
const MAX_DESCRIPTOR_BYTES: u64 = 16 * 1024;
const MAX_AUTH_BYTES: u64 = 128;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);

const CONNECTION_HEADER: &str = "x-nodex-connection-id";
const CONNECTION_BINDING_HEADER: &str = "x-nodex-connection-binding";
const PROJECT_HEADER: &str = "x-nodex-project-id";
const DATABASE_SCOPE_HEADER: &str = "x-nodex-database-scope";
const DOCUMENT_SCOPE_HEADER: &str = "x-nodex-document-scope";
const LIBRARY_SCOPE: &str = "library";

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("Core runtime is invalid: {0}")]
    InvalidRuntime(String),
    #[error("Core protocol is incompatible: {0}")]
    ProtocolIncompatible(String),
    #[error("Core returned HTTP {status}: {message}")]
    Http { status: u16, message: String },
    #[error("Core response could not be encoded or decoded: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Core process could not be located: {0}")]
    CoreExecutable(String),
    #[error("Core did not become ready: {0}")]
    Startup(String),
}

#[derive(Clone, Debug)]
pub struct CoreClient {
    socket: PathBuf,
    auth: String,
    connection_id: String,
    connection_binding: String,
    pub descriptor: RuntimeDescriptor,
    pub handshake: HandshakeResponse,
}

impl CoreClient {
    pub fn connect(home: &Path, build_id: &str) -> Result<Self, ClientError> {
        let runtime = RuntimeFiles::read(home)?;
        let connection_id = format!("native-cli:{}", random_hex(16)?);
        let handshake = request_json::<_, HandshakeResponse>(
            &runtime.socket,
            &runtime.auth,
            "/core/v1/handshake",
            &HandshakeRequest {
                protocol_min: PROTOCOL_MIN,
                protocol_max: PROTOCOL_MAX,
                client: ClientIdentity {
                    kind: ClientKind::NativeCli,
                    build_id: build_id.to_owned(),
                },
                connection_id: connection_id.clone(),
                expected_profile_id: Some(runtime.descriptor.profile_id.clone()),
                expected_start_nonce: Some(runtime.descriptor.start_nonce.clone()),
            },
            &[],
        )?;
        validate_handshake(&runtime.descriptor, &handshake)?;
        Ok(Self {
            socket: runtime.socket,
            auth: runtime.auth,
            connection_id,
            connection_binding: handshake.connection_binding.clone(),
            descriptor: runtime.descriptor,
            handshake,
        })
    }

    pub fn health(&self) -> Result<HealthResponse, ClientError> {
        request_without_body(&self.socket, &self.auth, "/core/v1/health", &[])
    }

    pub fn library_read(
        &self,
        project_id: Option<&str>,
        read: LibraryRead,
    ) -> Result<LibraryReadResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/library/read",
            &LibraryReadRequest(nodex_core_contracts::ModuleReadRequest {
                version: nodex_core_contracts::library::LIBRARY_CONTRACT_VERSION,
                read,
            }),
            ScopeHeaders::project(project_id),
        )
    }

    pub fn library_apply(
        &self,
        project_id: Option<&str>,
        request: nodex_core_contracts::ModuleApplyRequest<LibraryIntent>,
    ) -> Result<LibraryApplyResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/library/apply",
            &LibraryApplyRequest(request),
            ScopeHeaders::project(project_id),
        )
    }

    pub fn database_read(
        &self,
        project_id: Option<&str>,
        read: DatabaseRead,
    ) -> Result<DatabaseReadResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/database/read",
            &DatabaseReadRequest(nodex_core_contracts::ModuleReadRequest {
                version: nodex_core_contracts::database::DATABASE_CONTRACT_VERSION,
                read,
            }),
            ScopeHeaders::database(project_id),
        )
    }

    pub fn database_apply(
        &self,
        project_id: Option<&str>,
        request: nodex_core_contracts::ModuleApplyRequest<Vec<DatabaseIntent>>,
    ) -> Result<DatabaseApplyResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/database/apply",
            &DatabaseApplyRequest(request),
            ScopeHeaders::database(project_id),
        )
    }

    pub fn document_read(
        &self,
        project_id: Option<&str>,
        library_scope: bool,
        read: OwnedDocumentRead,
    ) -> Result<OwnedDocumentReadResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/document/read",
            &OwnedDocumentReadRequest(nodex_core_contracts::ModuleReadRequest {
                version: <nodex_core_contracts::document::OwnedDocumentContract as VersionedModuleContract>::VERSION,
                read,
            }),
            ScopeHeaders::document(project_id, library_scope),
        )
    }

    pub fn document_apply(
        &self,
        project_id: Option<&str>,
        library_scope: bool,
        request: nodex_core_contracts::ModuleApplyRequest<OwnedDocumentIntent>,
    ) -> Result<OwnedDocumentApplyResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/document/apply",
            &OwnedDocumentApplyRequest(request),
            ScopeHeaders::document(project_id, library_scope),
        )
    }

    pub fn workspace_read(
        &self,
        project_id: Option<&str>,
        read: ProjectWorkspaceRead,
    ) -> Result<ProjectWorkspaceReadResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/workspace/read",
            &ProjectWorkspaceReadRequest(nodex_core_contracts::ModuleReadRequest {
                version: <nodex_core_contracts::workspace::ProjectWorkspaceContract as VersionedModuleContract>::VERSION,
                read,
            }),
            ScopeHeaders::project(project_id),
        )
    }

    pub fn workspace_apply(
        &self,
        project_id: Option<&str>,
        request: nodex_core_contracts::ModuleApplyRequest<ProjectWorkspaceIntent>,
    ) -> Result<ProjectWorkspaceApplyResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/workspace/apply",
            &ProjectWorkspaceApplyRequest(request),
            ScopeHeaders::project(project_id),
        )
    }

    pub fn automation_read(
        &self,
        project_id: Option<&str>,
        read: AutomationRead,
    ) -> Result<AutomationReadResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/automation/read",
            &AutomationReadRequest(nodex_core_contracts::ModuleReadRequest {
                version: <nodex_core_contracts::automation::AutomationContract as VersionedModuleContract>::VERSION,
                read,
            }),
            ScopeHeaders::project(project_id),
        )
    }

    pub fn automation_apply(
        &self,
        project_id: Option<&str>,
        request: nodex_core_contracts::ModuleApplyRequest<AutomationIntent>,
    ) -> Result<AutomationApplyResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/automation/apply",
            &AutomationApplyRequest(request),
            ScopeHeaders::project(project_id),
        )
    }

    pub fn administration_read(
        &self,
        read: StoreAdministrationRead,
    ) -> Result<StoreAdministrationReadResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/administration/read",
            &StoreAdministrationReadRequest(nodex_core_contracts::ModuleReadRequest {
                version: <nodex_core_contracts::administration::StoreAdministrationContract as VersionedModuleContract>::VERSION,
                read,
            }),
            ScopeHeaders::default(),
        )
    }

    pub fn administration_apply(
        &self,
        request: nodex_core_contracts::ModuleApplyRequest<StoreAdministrationIntent>,
    ) -> Result<StoreAdministrationApplyResponse, ClientError> {
        self.connected_request(
            "/core/v1/modules/administration/apply",
            &StoreAdministrationApplyRequest(request),
            ScopeHeaders::default(),
        )
    }

    pub fn shutdown(&self) -> Result<ShutdownResponse, ClientError> {
        self.connected_request(
            "/core/v1/admin/shutdown",
            &ShutdownRequest::default(),
            ScopeHeaders::default(),
        )
    }

    fn connected_request<Request: Serialize, Response: DeserializeOwned>(
        &self,
        path: &str,
        request: &Request,
        scope: ScopeHeaders<'_>,
    ) -> Result<Response, ClientError> {
        let mut headers = vec![
            (CONNECTION_HEADER, self.connection_id.as_str()),
            (CONNECTION_BINDING_HEADER, self.connection_binding.as_str()),
        ];
        headers.extend(scope.values);
        request_json(&self.socket, &self.auth, path, request, &headers)
    }
}

pub fn connect_or_launch(
    home: &Path,
    build_id: &str,
    core_executable: Option<&Path>,
) -> Result<CoreClient, ClientError> {
    ensure_home(home)?;
    match CoreClient::connect(home, build_id) {
        Ok(client) => return Ok(client),
        Err(ClientError::ProtocolIncompatible(message)) => {
            return Err(ClientError::ProtocolIncompatible(message));
        }
        Err(_) => {}
    }

    let executable = match core_executable {
        Some(path) => path.to_owned(),
        None => discover_core_executable()?,
    };
    let mut child = Command::new(&executable)
        .args(["--home", &home.to_string_lossy()])
        .env("NODEX_LOG_CONSOLE", "false")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            ClientError::Startup(format!("could not start {}: {error}", executable.display()))
        })?;
    wait_for_core(home, build_id, &mut child)
}

pub fn discover_core_executable() -> Result<PathBuf, ClientError> {
    if let Some(path) = std::env::var_os("NODEX_CORE_BINARY") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(ClientError::CoreExecutable(format!(
            "NODEX_CORE_BINARY does not name a file: {}",
            path.display()
        )));
    }
    let current = std::env::current_exe()?;
    let sibling = current
        .parent()
        .ok_or_else(|| ClientError::CoreExecutable("CLI executable has no parent".to_owned()))?
        .join("nodex-core");
    if sibling.is_file() {
        return Ok(sibling);
    }
    Err(ClientError::CoreExecutable(format!(
        "expected a packaged nodex-core next to {} or NODEX_CORE_BINARY",
        current.display()
    )))
}

fn wait_for_core(
    home: &Path,
    build_id: &str,
    child: &mut Child,
) -> Result<CoreClient, ClientError> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        let error = match CoreClient::connect(home, build_id) {
            Ok(client) => return Ok(client),
            Err(error) => error,
        };
        if let Some(status) = child.try_wait()? {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            return Err(ClientError::Startup(format!(
                "Core exited with {status}: {}",
                stderr.trim()
            )));
        }
        if Instant::now() >= deadline {
            return Err(ClientError::Startup(format!(
                "readiness timed out: {error}"
            )));
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[derive(Default)]
struct ScopeHeaders<'a> {
    values: Vec<(&'static str, &'a str)>,
}

impl<'a> ScopeHeaders<'a> {
    fn project(project_id: Option<&'a str>) -> Self {
        Self {
            values: project_id
                .map(|project_id| vec![(PROJECT_HEADER, project_id)])
                .unwrap_or_default(),
        }
    }

    fn database(project_id: Option<&'a str>) -> Self {
        match project_id {
            Some(project_id) => Self::project(Some(project_id)),
            None => Self {
                values: vec![(DATABASE_SCOPE_HEADER, LIBRARY_SCOPE)],
            },
        }
    }

    fn document(project_id: Option<&'a str>, library_scope: bool) -> Self {
        if let Some(project_id) = project_id {
            return Self::project(Some(project_id));
        }
        if library_scope {
            return Self {
                values: vec![(DOCUMENT_SCOPE_HEADER, LIBRARY_SCOPE)],
            };
        }
        Self::default()
    }
}

struct RuntimeFiles {
    socket: PathBuf,
    auth: String,
    descriptor: RuntimeDescriptor,
}

impl RuntimeFiles {
    fn read(home: &Path) -> Result<Self, ClientError> {
        if !home.is_absolute() {
            return Err(ClientError::InvalidRuntime(
                "Nodex home must be absolute".to_owned(),
            ));
        }
        let directory = home.join("run/core");
        validate_entry(&directory, EntryKind::Directory, RUNTIME_DIRECTORY_MODE)?;
        let owner = fs::symlink_metadata(&directory)?.uid();
        let descriptor_path = directory.join("core.json");
        let descriptor_metadata =
            validate_owned_entry(&descriptor_path, owner, EntryKind::File, PRIVATE_MODE)?;
        if descriptor_metadata.len() > MAX_DESCRIPTOR_BYTES {
            return Err(ClientError::InvalidRuntime(
                "runtime descriptor is oversized".to_owned(),
            ));
        }
        let descriptor = serde_json::from_slice::<RuntimeDescriptor>(&fs::read(&descriptor_path)?)
            .map_err(|_| {
                ClientError::InvalidRuntime("runtime descriptor is invalid JSON".to_owned())
            })?;
        let socket = directory.join("core.sock");
        if Path::new(&descriptor.socket_path) != socket {
            return Err(ClientError::InvalidRuntime(
                "runtime descriptor socket does not match its managed path".to_owned(),
            ));
        }
        validate_owned_entry(&socket, owner, EntryKind::Socket, PRIVATE_MODE)?;
        let auth_path = directory.join("core.auth");
        let auth_metadata = validate_owned_entry(&auth_path, owner, EntryKind::File, PRIVATE_MODE)?;
        if auth_metadata.len() > MAX_AUTH_BYTES {
            return Err(ClientError::InvalidRuntime(
                "runtime capability is oversized".to_owned(),
            ));
        }
        let auth = fs::read_to_string(auth_path)?.trim().to_owned();
        if auth.len() != 64 || !auth.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ClientError::InvalidRuntime(
                "runtime capability is invalid".to_owned(),
            ));
        }
        Ok(Self {
            socket,
            auth,
            descriptor,
        })
    }
}

#[derive(Clone, Copy)]
enum EntryKind {
    Directory,
    File,
    Socket,
}

fn validate_entry(path: &Path, kind: EntryKind, mode: u32) -> Result<fs::Metadata, ClientError> {
    let metadata = fs::symlink_metadata(path)?;
    let file_type = metadata.file_type();
    let correct_kind = match kind {
        EntryKind::Directory => file_type.is_dir(),
        EntryKind::File => file_type.is_file(),
        EntryKind::Socket => file_type.is_socket(),
    };
    if !correct_kind || file_type.is_symlink() {
        return Err(ClientError::InvalidRuntime(format!(
            "{} has an unsafe entry type",
            path.display()
        )));
    }
    if metadata.permissions().mode() & 0o777 != mode {
        return Err(ClientError::InvalidRuntime(format!(
            "{} must have mode {mode:o}",
            path.display()
        )));
    }
    if metadata.uid() != rustix::process::geteuid().as_raw() {
        return Err(ClientError::InvalidRuntime(format!(
            "{} is not owned by the current user",
            path.display()
        )));
    }
    Ok(metadata)
}

fn validate_owned_entry(
    path: &Path,
    owner: u32,
    kind: EntryKind,
    mode: u32,
) -> Result<fs::Metadata, ClientError> {
    let metadata = validate_entry(path, kind, mode)?;
    if metadata.uid() != owner {
        return Err(ClientError::InvalidRuntime(format!(
            "{} does not share the runtime owner",
            path.display()
        )));
    }
    Ok(metadata)
}

fn ensure_home(home: &Path) -> Result<(), ClientError> {
    if !home.is_absolute() {
        return Err(ClientError::InvalidRuntime(
            "Nodex home must be absolute".to_owned(),
        ));
    }
    if !home.exists() {
        fs::create_dir_all(home)?;
        fs::set_permissions(home, fs::Permissions::from_mode(RUNTIME_DIRECTORY_MODE))?;
    }
    let metadata = fs::symlink_metadata(home)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata.uid() != rustix::process::geteuid().as_raw()
    {
        return Err(ClientError::InvalidRuntime(
            "Nodex home must be a current-user-owned directory".to_owned(),
        ));
    }
    Ok(())
}

fn validate_handshake(
    descriptor: &RuntimeDescriptor,
    handshake: &HandshakeResponse,
) -> Result<(), ClientError> {
    if handshake.protocol_version < PROTOCOL_MIN || handshake.protocol_version > PROTOCOL_MAX {
        return Err(ClientError::ProtocolIncompatible(format!(
            "Core selected protocol {} outside {PROTOCOL_MIN}..={PROTOCOL_MAX}",
            handshake.protocol_version
        )));
    }
    if descriptor.protocol_min > PROTOCOL_MAX || descriptor.protocol_max < PROTOCOL_MIN {
        return Err(ClientError::ProtocolIncompatible(format!(
            "Core supports {}..={} while CLI supports {PROTOCOL_MIN}..={PROTOCOL_MAX}",
            descriptor.protocol_min, descriptor.protocol_max
        )));
    }
    if handshake.pid != descriptor.pid
        || handshake.start_nonce != descriptor.start_nonce
        || handshake.profile_id != descriptor.profile_id
        || handshake.store_epoch != descriptor.store_epoch
        || handshake.schema_version == 0
        || handshake.connection_binding.is_empty()
    {
        return Err(ClientError::InvalidRuntime(
            "handshake does not match the authenticated runtime descriptor".to_owned(),
        ));
    }
    Ok(())
}

fn request_json<Request: Serialize, Response: DeserializeOwned>(
    socket: &Path,
    auth: &str,
    path: &str,
    request: &Request,
    headers: &[(&str, &str)],
) -> Result<Response, ClientError> {
    let body = serde_json::to_vec(request)?;
    request_bytes(socket, auth, "POST", path, &body, headers)
}

fn request_without_body<Response: DeserializeOwned>(
    socket: &Path,
    auth: &str,
    path: &str,
    headers: &[(&str, &str)],
) -> Result<Response, ClientError> {
    request_bytes(socket, auth, "GET", path, &[], headers)
}

fn request_bytes<Response: DeserializeOwned>(
    socket: &Path,
    auth: &str,
    method: &str,
    path: &str,
    body: &[u8],
    headers: &[(&str, &str)],
) -> Result<Response, ClientError> {
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(REQUEST_TIMEOUT))?;
    stream.set_write_timeout(Some(REQUEST_TIMEOUT))?;
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {auth}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    )?;
    for (name, value) in headers {
        if !valid_header(name) || !valid_header(value) {
            return Err(ClientError::InvalidRuntime(
                "request header contains invalid bytes".to_owned(),
            ));
        }
        write!(stream, "{name}: {value}\r\n")?;
    }
    stream.write_all(b"\r\n")?;
    stream.write_all(body)?;

    let mut response = Vec::new();
    stream
        .take(u64::try_from(MAX_RESPONSE_BYTES + 1).unwrap_or(u64::MAX))
        .read_to_end(&mut response)?;
    if response.len() > MAX_RESPONSE_BYTES {
        return Err(ClientError::InvalidRuntime(
            "Core response exceeds the transport limit".to_owned(),
        ));
    }
    let Some(separator) = find_bytes(&response, b"\r\n\r\n") else {
        return Err(ClientError::InvalidRuntime(
            "Core response has no HTTP header boundary".to_owned(),
        ));
    };
    let head = std::str::from_utf8(&response[..separator]).map_err(|_| {
        ClientError::InvalidRuntime("Core returned non-UTF-8 HTTP headers".to_owned())
    })?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .ok_or_else(|| ClientError::InvalidRuntime("Core HTTP status is invalid".to_owned()))?;
    let body = &response[separator + 4..];
    if !(200..300).contains(&status) {
        let message = serde_json::from_slice::<serde_json::Value>(body)
            .ok()
            .and_then(|value| value.get("message")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| String::from_utf8_lossy(body).trim().to_owned());
        return Err(ClientError::Http { status, message });
    }
    serde_json::from_slice(body).map_err(ClientError::from)
}

fn valid_header(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4_096
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !matches!(byte, b'\r' | b'\n'))
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn random_hex(bytes: usize) -> Result<String, ClientError> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value)
        .map_err(|error| io::Error::other(format!("randomness unavailable: {error}")))?;
    Ok(hex::encode(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_headers_never_mix_project_and_library_authority() {
        assert_eq!(
            ScopeHeaders::database(Some("project-1")).values,
            [(PROJECT_HEADER, "project-1")]
        );
        assert_eq!(
            ScopeHeaders::database(None).values,
            [(DATABASE_SCOPE_HEADER, LIBRARY_SCOPE)]
        );
        assert_eq!(
            ScopeHeaders::document(None, true).values,
            [(DOCUMENT_SCOPE_HEADER, LIBRARY_SCOPE)]
        );
    }

    #[test]
    fn header_validation_rejects_transport_injection() {
        assert!(valid_header("project-1"));
        assert!(!valid_header("project-1\r\nx-forged: yes"));
        assert!(!valid_header(""));
    }

    #[test]
    fn byte_search_finds_the_http_boundary() {
        assert_eq!(find_bytes(b"head\r\n\r\nbody", b"\r\n\r\n"), Some(4));
        assert_eq!(find_bytes(b"head", b"\r\n\r\n"), None);
    }
}
