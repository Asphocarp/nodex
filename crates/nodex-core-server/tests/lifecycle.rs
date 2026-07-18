use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use nodex_core_protocol::{
    ClientIdentity, ClientKind, HandshakeRequest, PROTOCOL_MAX, PROTOCOL_MIN, RuntimeDescriptor,
};
use tempfile::tempdir;

fn read_ready_descriptor(child: &mut Child) -> RuntimeDescriptor {
    let stdout = child.stdout.take().expect("captured stdout");
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader.read_line(&mut line).expect("ready line");
    serde_json::from_str(line.trim()).expect("runtime descriptor JSON")
}

fn request(socket: &str, auth: &str, method: &str, path: &str, body: &str) -> String {
    let mut stream = UnixStream::connect(socket).expect("connect to Core socket");
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {auth}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    )
    .expect("write request");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    response
}

fn response_json(response: &str) -> serde_json::Value {
    let (_, body) = response.split_once("\r\n\r\n").expect("HTTP response body");
    serde_json::from_str(body).expect("JSON response")
}

#[test]
fn concurrent_launchers_reuse_one_authenticated_profile_core() {
    let directory = tempdir().expect("disposable Core home");
    let home = directory.path().canonicalize().expect("absolute home");
    let executable = env!("CARGO_BIN_EXE_nodex-core");
    let mut children: Vec<Child> = (0..8)
        .map(|_| {
            Command::new(executable)
                .args(["--home", home.to_str().expect("UTF-8 home")])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn Core contender")
        })
        .collect();

    let descriptors: Vec<RuntimeDescriptor> =
        children.iter_mut().map(read_ready_descriptor).collect();
    let expected = descriptors.first().expect("one descriptor");
    assert!(descriptors.iter().all(|descriptor| {
        descriptor.pid == expected.pid && descriptor.start_nonce == expected.start_nonce
    }));

    let runtime = home.join("run/core");
    for name in ["core.lock", "core.sock", "core.json", "core.auth"] {
        let mode = fs::symlink_metadata(runtime.join(name))
            .expect("runtime entry")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "{name}");
    }
    assert_eq!(
        fs::metadata(&runtime)
            .expect("runtime directory")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );

    let auth = fs::read_to_string(runtime.join("core.auth"))
        .expect("auth capability")
        .trim()
        .to_owned();
    let unauthorized = request(&expected.socket_path, "wrong", "GET", "/core/v1/health", "");
    assert!(
        unauthorized.starts_with("HTTP/1.1 401"),
        "unexpected unauthorized response: {unauthorized:?}"
    );
    let health = request(&expected.socket_path, &auth, "GET", "/core/v1/health", "");
    assert!(health.starts_with("HTTP/1.1 200"));
    assert!(health.contains(&format!("\"pid\":{}", expected.pid)));

    let handshake = serde_json::to_string(&HandshakeRequest {
        protocol_min: PROTOCOL_MIN,
        protocol_max: PROTOCOL_MAX,
        client: ClientIdentity {
            kind: ClientKind::Test,
            build_id: "lifecycle-test".to_owned(),
        },
        expected_profile_id: Some(expected.profile_id.clone()),
        expected_start_nonce: Some(expected.start_nonce.clone()),
    })
    .expect("handshake JSON");
    let response = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/handshake",
        &handshake,
    );
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains(&expected.start_nonce));

    let read = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/read",
        r#"{"version":1,"read":{"kind":"metadata"}}"#,
    );
    assert!(read.starts_with("HTTP/1.1 200"));
    let read_json = response_json(&read);
    assert_eq!(read_json["status"], "ok");
    assert_eq!(read_json["payload"]["event_head"], 0);
    assert_eq!(read_json["payload"]["value"]["library_id"], "probe-library");

    let apply_body = serde_json::json!({
        "version": 1,
        "operation_id": "lifecycle-operation-1",
        "store_epoch": expected.store_epoch,
        "intent": {
            "kind": "grant_project_access",
            "project_id": "project-1",
            "target": { "kind": "page", "page_id": "page-1" },
            "access": "read"
        }
    })
    .to_string();
    let apply = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/apply",
        &apply_body,
    );
    assert!(apply.starts_with("HTTP/1.1 200"));
    let apply_json = response_json(&apply);
    assert_eq!(apply_json["status"], "ok");
    assert_eq!(apply_json["payload"]["event_sequence"], 1);
    assert_eq!(apply_json["payload"]["receipt"]["duplicate"], false);

    let replay = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/apply",
        &apply_body,
    );
    assert_eq!(
        response_json(&replay)["payload"]["receipt"]["duplicate"],
        true
    );

    let oversized = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/handshake",
        &"x".repeat(64 * 1024 + 1),
    );
    assert!(oversized.starts_with("HTTP/1.1 413"));

    let shutdown = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/admin/shutdown",
        "{}",
    );
    assert!(shutdown.starts_with("HTTP/1.1 200"));

    let deadline = Instant::now() + Duration::from_secs(5);
    for child in &mut children {
        loop {
            if child.try_wait().expect("poll Core process").is_some() {
                break;
            }
            assert!(Instant::now() < deadline, "Core process did not exit");
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    assert!(!runtime.join("core.sock").exists());
    assert!(!runtime.join("core.json").exists());
    assert!(!runtime.join("core.auth").exists());
}
