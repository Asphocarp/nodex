use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use nodex_core_protocol::{
    ClientIdentity, ClientKind, HandshakeRequest, HandshakeResponse, PROTOCOL_MAX, PROTOCOL_MIN,
    RuntimeDescriptor, RuntimeGenerationIdentity, ShutdownRequest, ShutdownResponse,
    ShutdownStatus, VersionHandoffRequest,
};

pub(crate) const RUNTIME_DIRECTORY_MODE: u32 = 0o700;
pub(crate) const PRIVATE_FILE_MODE: u32 = 0o600;
const MAX_DESCRIPTOR_BYTES: u64 = 16 * 1024;
const MAX_AUTH_BYTES: u64 = 128;
const MAX_PROBE_RESPONSE_BYTES: usize = 64 * 1024;
const STARTUP_WAIT: Duration = Duration::from_secs(5);
const HANDOFF_EXIT_WAIT: Duration = Duration::from_secs(10);
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ExistingCore {
    LockAcquired,
    Reuse(RuntimeDescriptor),
    HandoffAccepted(RuntimeDescriptor),
}

#[derive(Clone, Debug)]
pub(crate) struct RuntimePaths {
    pub(crate) directory: PathBuf,
    pub(crate) lock: PathBuf,
    pub(crate) socket: PathBuf,
    pub(crate) descriptor: PathBuf,
    pub(crate) auth: PathBuf,
}

impl RuntimePaths {
    pub(crate) fn prepare(home: &Path) -> io::Result<Self> {
        validate_home(home)?;
        let run = home.join("run");
        prepare_owned_directory(&run, None)?;
        let directory = run.join("core");
        prepare_owned_directory(&directory, Some(RUNTIME_DIRECTORY_MODE))?;
        Ok(Self {
            lock: directory.join("core.lock"),
            socket: directory.join("core.sock"),
            descriptor: directory.join("core.json"),
            auth: directory.join("core.auth"),
            directory,
        })
    }

    pub(crate) fn owner_uid(&self) -> io::Result<u32> {
        Ok(checked_metadata(
            &self.directory,
            EntryKind::Directory,
            Some(RUNTIME_DIRECTORY_MODE),
        )?
        .uid())
    }

    pub(crate) fn open_lock(&self) -> io::Result<File> {
        match OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .mode(PRIVATE_FILE_MODE)
            .open(&self.lock)
        {
            Ok(lock) => {
                fs::set_permissions(&self.lock, fs::Permissions::from_mode(PRIVATE_FILE_MODE))?;
                Ok(lock)
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                checked_owned_entry(
                    &self.lock,
                    self.owner_uid()?,
                    EntryKind::File,
                    Some(PRIVATE_FILE_MODE),
                )?;
                OpenOptions::new().read(true).write(true).open(&self.lock)
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) fn remove_stale_socket(&self) -> io::Result<()> {
        let Ok(_) = fs::symlink_metadata(&self.socket) else {
            return Ok(());
        };
        checked_owned_entry(
            &self.socket,
            self.owner_uid()?,
            EntryKind::Socket,
            Some(PRIVATE_FILE_MODE),
        )?;
        fs::remove_file(&self.socket)
    }

    pub(crate) fn atomic_write_private(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        if fs::symlink_metadata(path).is_ok() {
            checked_owned_entry(
                path,
                self.owner_uid()?,
                EntryKind::File,
                Some(PRIVATE_FILE_MODE),
            )?;
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid runtime file"))?;
        let temporary = path.with_file_name(format!(
            ".{file_name}.{}.{}.tmp",
            std::process::id(),
            random_hex(8)?
        ));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(PRIVATE_FILE_MODE)
            .open(&temporary)?;
        let write_result = (|| {
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, path)?;
            File::open(&self.directory)?.sync_all()
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result
    }

    pub(crate) fn read_descriptor(&self) -> io::Result<RuntimeDescriptor> {
        let metadata = checked_owned_entry(
            &self.descriptor,
            self.owner_uid()?,
            EntryKind::File,
            Some(PRIVATE_FILE_MODE),
        )?;
        if metadata.len() > MAX_DESCRIPTOR_BYTES {
            return Err(invalid_data("Core runtime descriptor is oversized"));
        }
        let descriptor = serde_json::from_slice::<RuntimeDescriptor>(&fs::read(&self.descriptor)?)
            .map_err(|_| invalid_data("Core runtime descriptor is invalid"))?;
        validate_descriptor(&descriptor, &self.socket)?;
        Ok(descriptor)
    }

    fn read_auth(&self) -> io::Result<String> {
        let metadata = checked_owned_entry(
            &self.auth,
            self.owner_uid()?,
            EntryKind::File,
            Some(PRIVATE_FILE_MODE),
        )?;
        if metadata.len() > MAX_AUTH_BYTES {
            return Err(invalid_data("Core auth capability is oversized"));
        }
        let auth = fs::read_to_string(&self.auth)?;
        let auth = auth.trim();
        if auth.len() != 64 || !auth.bytes().all(is_lower_hex) {
            return Err(invalid_data("Core auth capability is invalid"));
        }
        Ok(auth.to_owned())
    }

    pub(crate) fn wait_for_running_core(&self, lock: &File) -> io::Result<ExistingCore> {
        let deadline = Instant::now() + STARTUP_WAIT;
        loop {
            match fs2::FileExt::try_lock_exclusive(lock) {
                Ok(()) => return Ok(ExistingCore::LockAcquired),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => return Err(error),
            }
            let error = match self
                .read_descriptor()
                .and_then(|descriptor| self.probe_or_handoff_running_core(descriptor))
            {
                Ok(existing) => return Ok(existing),
                Err(error) => error,
            };
            if matches!(
                error.kind(),
                io::ErrorKind::WouldBlock
                    | io::ErrorKind::Unsupported
                    | io::ErrorKind::PermissionDenied
                    | io::ErrorKind::InvalidData
            ) {
                return Err(error);
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("another Core holds the lock but did not prove readiness: {error}"),
                ));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn probe_or_handoff_running_core(
        &self,
        descriptor: RuntimeDescriptor,
    ) -> io::Result<ExistingCore> {
        if descriptor.protocol_min > PROTOCOL_MAX || descriptor.protocol_max < PROTOCOL_MIN {
            return self.request_version_handoff(descriptor);
        }
        checked_owned_entry(
            &self.socket,
            self.owner_uid()?,
            EntryKind::Socket,
            Some(PRIVATE_FILE_MODE),
        )?;
        let auth = self.read_auth()?;
        let connection_id = format!("startup-probe:{}", random_hex(16)?);
        let request = HandshakeRequest {
            protocol_min: PROTOCOL_MIN,
            protocol_max: PROTOCOL_MAX,
            client: ClientIdentity {
                kind: ClientKind::Test,
                build_id: env!("CARGO_PKG_VERSION").to_owned(),
            },
            connection_id,
            expected_profile_id: Some(descriptor.profile_id.clone()),
            expected_start_nonce: Some(descriptor.start_nonce.clone()),
        };
        let response = request_json::<_, HandshakeResponse>(
            &self.socket,
            &auth,
            "/core/v1/handshake",
            &request,
        )?;
        if response.protocol_version < PROTOCOL_MIN
            || response.protocol_version > PROTOCOL_MAX
            || response.pid != descriptor.pid
            || response.start_nonce != descriptor.start_nonce
            || response.profile_id != descriptor.profile_id
            || response.store_epoch != descriptor.store_epoch
            || response.schema_version == 0
        {
            return Err(invalid_data(
                "running Core handshake does not match its runtime descriptor",
            ));
        }
        Ok(ExistingCore::Reuse(descriptor))
    }

    fn request_version_handoff(&self, descriptor: RuntimeDescriptor) -> io::Result<ExistingCore> {
        checked_owned_entry(
            &self.socket,
            self.owner_uid()?,
            EntryKind::Socket,
            Some(PRIVATE_FILE_MODE),
        )?;
        let auth = self.read_auth()?;
        let expected = RuntimeGenerationIdentity::from(&descriptor);
        let response = request_json::<_, ShutdownResponse>(
            &self.socket,
            &auth,
            "/core/v1/admin/shutdown",
            &ShutdownRequest {
                version_handoff: Some(VersionHandoffRequest {
                    protocol_min: PROTOCOL_MIN,
                    protocol_max: PROTOCOL_MAX,
                    build_id: env!("CARGO_PKG_VERSION").to_owned(),
                    expected: expected.clone(),
                }),
            },
        )?;
        if response.runtime.as_ref() != Some(&expected) {
            return Err(invalid_data(
                "running Core handoff response does not match its runtime descriptor",
            ));
        }
        match response.status {
            ShutdownStatus::Draining => Ok(ExistingCore::HandoffAccepted(descriptor)),
            ShutdownStatus::Busy => {
                let retry_after_ms = response.retry_after_ms.unwrap_or(250).clamp(10, 60_000);
                Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    format!(
                        "running Core is busy and cannot hand off this Profile; retry after {retry_after_ms} ms"
                    ),
                ))
            }
        }
    }

    pub(crate) fn wait_for_handoff_completion(
        &self,
        lock: &File,
        incumbent: &RuntimeDescriptor,
    ) -> io::Result<ExistingCore> {
        let deadline = Instant::now() + HANDOFF_EXIT_WAIT;
        loop {
            match fs2::FileExt::try_lock_exclusive(lock) {
                Ok(()) => return Ok(ExistingCore::LockAcquired),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                Err(error) => return Err(error),
            }
            match self.read_descriptor() {
                Ok(descriptor) if descriptor.start_nonce != incumbent.start_nonce => {
                    if descriptor.protocol_min > PROTOCOL_MAX
                        || descriptor.protocol_max < PROTOCOL_MIN
                    {
                        return Err(io::Error::new(
                            io::ErrorKind::Unsupported,
                            "replacement Core published an incompatible protocol range",
                        ));
                    }
                    return self.probe_or_handoff_running_core(descriptor);
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!(
                        "Core {} accepted version handoff but did not release the Profile lock",
                        incumbent.pid
                    ),
                ));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    pub(crate) fn cleanup(&self, start_nonce: &str) {
        let Ok(descriptor) = self.read_descriptor() else {
            return;
        };
        if descriptor.start_nonce != start_nonce {
            return;
        }
        let Ok(owner_uid) = self.owner_uid() else {
            return;
        };
        let entries = [
            (&self.socket, EntryKind::Socket),
            (&self.auth, EntryKind::File),
            (&self.descriptor, EntryKind::File),
        ];
        if entries.iter().any(|(path, kind)| {
            checked_owned_entry(path, owner_uid, *kind, Some(PRIVATE_FILE_MODE)).is_err()
        }) {
            return;
        }
        for (path, _) in entries {
            let _ = fs::remove_file(path);
        }
    }
}

#[derive(Clone, Copy)]
enum EntryKind {
    Directory,
    File,
    Socket,
}

fn validate_home(home: &Path) -> io::Result<()> {
    if !home.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Core home must be absolute",
        ));
    }
    let metadata = checked_metadata(home, EntryKind::Directory, None)?;
    if metadata.uid() != rustix::process::geteuid().as_raw() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Core home is not owned by the current user",
        ));
    }
    Ok(())
}

fn prepare_owned_directory(path: &Path, expected_mode: Option<u32>) -> io::Result<()> {
    let creation_mode = expected_mode.unwrap_or(RUNTIME_DIRECTORY_MODE);
    let mut builder = fs::DirBuilder::new();
    builder.mode(creation_mode);
    match builder.create(path) {
        Ok(()) => fs::set_permissions(path, fs::Permissions::from_mode(creation_mode))?,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    checked_owned_entry(
        path,
        rustix::process::geteuid().as_raw(),
        EntryKind::Directory,
        expected_mode,
    )?;
    Ok(())
}

fn checked_metadata(path: &Path, kind: EntryKind, mode: Option<u32>) -> io::Result<fs::Metadata> {
    let metadata = fs::symlink_metadata(path)?;
    let valid_kind = match kind {
        EntryKind::Directory => metadata.is_dir(),
        EntryKind::File => metadata.is_file(),
        EntryKind::Socket => metadata.file_type().is_socket(),
    };
    if metadata.file_type().is_symlink() || !valid_kind {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} has an invalid filesystem type", path.display()),
        ));
    }
    if let Some(expected) = mode {
        let actual = metadata.permissions().mode() & 0o777;
        if actual != expected {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "{} has mode {actual:o}; expected {expected:o}",
                    path.display()
                ),
            ));
        }
    }
    Ok(metadata)
}

fn checked_owned_entry(
    path: &Path,
    owner_uid: u32,
    kind: EntryKind,
    mode: Option<u32>,
) -> io::Result<fs::Metadata> {
    let metadata = checked_metadata(path, kind, mode)?;
    if metadata.uid() != owner_uid || owner_uid != rustix::process::geteuid().as_raw() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{} is not owned by the current user", path.display()),
        ));
    }
    Ok(metadata)
}

fn validate_descriptor(descriptor: &RuntimeDescriptor, expected_socket: &Path) -> io::Result<()> {
    let valid = descriptor.protocol_min >= 1
        && descriptor.protocol_min <= descriptor.protocol_max
        && !descriptor.build_id.is_empty()
        && descriptor.build_id.len() <= 128
        && descriptor.pid > 0
        && descriptor.start_nonce.len() == 32
        && descriptor.start_nonce.bytes().all(is_lower_hex)
        && Path::new(&descriptor.socket_path) == expected_socket
        && !descriptor.profile_id.is_empty()
        && descriptor.profile_id.len() <= 512
        && !descriptor.store_epoch.is_empty()
        && descriptor.store_epoch.len() <= 512
        && descriptor.readiness_generation >= 1;
    if !valid {
        return Err(invalid_data("Core runtime descriptor fields are invalid"));
    }
    Ok(())
}

fn request_json<Request: serde::Serialize, Response: serde::de::DeserializeOwned>(
    socket: &Path,
    auth: &str,
    path: &str,
    body: &Request,
) -> io::Result<Response> {
    let body = serde_json::to_vec(body).map_err(io::Error::other)?;
    let mut stream = UnixStream::connect(socket)?;
    stream.set_read_timeout(Some(PROBE_TIMEOUT))?;
    stream.set_write_timeout(Some(PROBE_TIMEOUT))?;
    write!(
        stream,
        "POST {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {auth}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)?;
    let mut response = Vec::new();
    stream
        .take(u64::try_from(MAX_PROBE_RESPONSE_BYTES + 1).expect("bounded response length"))
        .read_to_end(&mut response)?;
    if response.len() > MAX_PROBE_RESPONSE_BYTES {
        return Err(invalid_data("Core startup probe response is oversized"));
    }
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| invalid_data("Core startup probe response is malformed"))?;
    let headers = std::str::from_utf8(&response[..split])
        .map_err(|_| invalid_data("Core startup probe headers are invalid"))?;
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| invalid_data("Core startup probe status is invalid"))?;
    if status != 200 {
        let kind = match status {
            401 | 403 => io::ErrorKind::PermissionDenied,
            404 | 405 => io::ErrorKind::Unsupported,
            409 => io::ErrorKind::InvalidData,
            _ => io::ErrorKind::ConnectionRefused,
        };
        return Err(io::Error::new(
            kind,
            format!("Core startup probe was rejected with HTTP {status}"),
        ));
    }
    serde_json::from_slice(&response[split + 4..])
        .map_err(|_| invalid_data("Core startup probe response is invalid"))
}

pub(crate) fn random_hex(bytes: usize) -> io::Result<String> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value)
        .map_err(|error| io::Error::other(format!("getrandom failed: {error:?}")))?;
    Ok(hex::encode(value))
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn runtime_directory_refuses_symlinked_parents_and_entries() {
        let directory = tempdir().expect("temporary Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let outside = tempdir().expect("outside directory");
        symlink(outside.path(), home.join("run")).expect("symlinked run directory");

        let error = RuntimePaths::prepare(&home).expect_err("symlink must be rejected");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn stale_socket_cleanup_refuses_non_socket_and_symlink_targets() {
        let directory = tempdir().expect("temporary Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let paths = RuntimePaths::prepare(&home).expect("runtime paths");
        fs::write(&paths.socket, b"not a socket").expect("regular stale entry");
        fs::set_permissions(&paths.socket, fs::Permissions::from_mode(PRIVATE_FILE_MODE))
            .expect("private mode");
        assert!(paths.remove_stale_socket().is_err());
        fs::remove_file(&paths.socket).expect("remove regular entry");
        symlink(&paths.auth, &paths.socket).expect("symlink stale entry");
        assert!(paths.remove_stale_socket().is_err());
        assert!(fs::symlink_metadata(&paths.socket).is_ok());
    }

    #[test]
    fn descriptor_validation_rejects_pid_reuse_without_an_authenticated_server() {
        let directory = tempdir().expect("temporary Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let paths = RuntimePaths::prepare(&home).expect("runtime paths");
        let descriptor = RuntimeDescriptor {
            protocol_min: PROTOCOL_MIN,
            protocol_max: PROTOCOL_MAX,
            build_id: "test".to_owned(),
            pid: std::process::id(),
            start_nonce: "a".repeat(32),
            socket_path: paths.socket.to_string_lossy().into_owned(),
            profile_id: "profile:test".to_owned(),
            store_epoch: "epoch:test".to_owned(),
            readiness_generation: 1,
        };
        paths
            .atomic_write_private(
                &paths.descriptor,
                serde_json::to_string(&descriptor)
                    .expect("descriptor JSON")
                    .as_bytes(),
            )
            .expect("descriptor file");
        paths
            .atomic_write_private(&paths.auth, format!("{}\n", "b".repeat(64)).as_bytes())
            .expect("auth file");

        let error = paths
            .probe_or_handoff_running_core(descriptor)
            .expect_err("PID alone cannot prove a running Core");
        assert!(matches!(
            error.kind(),
            io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
        ));
    }
}
