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
    request_with_headers(socket, auth, method, path, body, &[])
}

fn request_with_headers(
    socket: &str,
    auth: &str,
    method: &str,
    path: &str,
    body: &str,
    headers: &[(&str, &str)],
) -> String {
    request_bytes_with_headers(socket, auth, method, path, body.as_bytes(), headers)
}

fn request_bytes_with_headers(
    socket: &str,
    auth: &str,
    method: &str,
    path: &str,
    body: &[u8],
    headers: &[(&str, &str)],
) -> String {
    let mut stream = UnixStream::connect(socket).expect("connect to Core socket");
    let headers = headers
        .iter()
        .map(|(name, value)| format!("{name}: {value}\r\n"))
        .collect::<String>();
    let write_result = write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {auth}\r\nContent-Type: application/json\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len(),
    );
    if write_result.is_ok() {
        let _ = stream.write_all(body).inspect_err(|error| {
            assert_eq!(
                error.kind(),
                std::io::ErrorKind::BrokenPipe,
                "write request body: {error}"
            );
        });
    }
    if let Err(error) = write_result {
        assert_eq!(
            error.kind(),
            std::io::ErrorKind::BrokenPipe,
            "write request: {error}"
        );
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    response
}

fn open_sse(
    socket: &str,
    auth: &str,
    path: &str,
    headers: &[(&str, &str)],
) -> BufReader<UnixStream> {
    let mut stream = UnixStream::connect(socket).expect("connect SSE to Core socket");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("bound SSE read timeout");
    let headers = headers
        .iter()
        .map(|(name, value)| format!("{name}: {value}\r\n"))
        .collect::<String>();
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {auth}\r\n{headers}Connection: close\r\n\r\n",
    )
    .expect("write SSE request");
    let mut reader = BufReader::new(stream);
    let mut response_head = String::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("read SSE response head");
        assert!(!line.is_empty(), "SSE response ended before its headers");
        response_head.push_str(&line);
        if line == "\r\n" {
            break;
        }
    }
    assert!(
        response_head.starts_with("HTTP/1.1 200"),
        "unexpected SSE response: {response_head:?}"
    );
    reader
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
        connection_id: "connection:lifecycle".to_owned(),
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
    let handshake_json = response_json(&response);
    let connection_binding = handshake_json["connection_binding"]
        .as_str()
        .expect("connection binding")
        .to_owned();

    let downgrade = serde_json::to_string(&HandshakeRequest {
        protocol_min: 0,
        protocol_max: 0,
        client: ClientIdentity {
            kind: ClientKind::Test,
            build_id: "lifecycle-test".to_owned(),
        },
        connection_id: "connection:downgrade".to_owned(),
        expected_profile_id: Some(expected.profile_id.clone()),
        expected_start_nonce: Some(expected.start_nonce.clone()),
    })
    .expect("downgrade JSON");
    let downgrade = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/handshake",
        &downgrade,
    );
    assert!(downgrade.starts_with("HTTP/1.1 409"));

    let rebound = serde_json::to_string(&HandshakeRequest {
        protocol_min: PROTOCOL_MIN,
        protocol_max: PROTOCOL_MAX,
        client: ClientIdentity {
            kind: ClientKind::NativeCli,
            build_id: "different-client".to_owned(),
        },
        connection_id: "connection:lifecycle".to_owned(),
        expected_profile_id: Some(expected.profile_id.clone()),
        expected_start_nonce: Some(expected.start_nonce.clone()),
    })
    .expect("rebind JSON");
    let rebound = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/handshake",
        &rebound,
    );
    assert!(rebound.starts_with("HTTP/1.1 409"));

    let connection_headers = [
        ("x-nodex-connection-id", "connection:lifecycle"),
        ("x-nodex-connection-binding", connection_binding.as_str()),
    ];
    let read = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/read",
        r#"{"version":1,"read":{"kind":"metadata"}}"#,
        &connection_headers,
    );
    assert!(read.starts_with("HTTP/1.1 200"));
    let read_json = response_json(&read);
    assert_eq!(read_json["status"], "ok");
    assert_eq!(read_json["payload"]["event_head"], 0);
    let library_id = read_json["payload"]["value"]["library_id"]
        .as_str()
        .expect("Library identity")
        .to_owned();
    assert!(library_id.starts_with("library-"));

    let apply_body = serde_json::json!({
        "version": 1,
        "operation_id": "lifecycle-operation-1",
        "store_epoch": expected.store_epoch,
        "intent": {
            "kind": "create_page",
            "page_id": "page:lifecycle",
            "document_id": "document:lifecycle",
            "title": "Core lifecycle",
            "parent": { "kind": "library", "before": null }
        }
    })
    .to_string();
    let module_headers = [
        ("x-nodex-project-id", "project:default"),
        ("x-nodex-connection-id", "connection:lifecycle"),
        ("x-nodex-connection-binding", connection_binding.as_str()),
    ];
    let apply = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/apply",
        &apply_body,
        &module_headers,
    );
    assert!(apply.starts_with("HTTP/1.1 200"));
    let apply_json = response_json(&apply);
    assert_eq!(apply_json["status"], "ok");
    let page_event_sequence = apply_json["payload"]["event_sequence"]
        .as_i64()
        .expect("Page event sequence");
    assert!(page_event_sequence >= 1);
    assert_eq!(apply_json["payload"]["receipt"]["duplicate"], false);

    let replay = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/apply",
        &apply_body,
        &module_headers,
    );
    assert_eq!(
        response_json(&replay)["payload"]["receipt"]["duplicate"],
        true
    );
    assert_eq!(
        response_json(&replay)["payload"]["event_sequence"],
        page_event_sequence
    );

    const DATABASE_ID: &str = "018f2000-0000-7000-8000-000000000001";
    const SOURCE_ID: &str = "018f2000-0000-7000-8000-000000000002";
    const VIEW_ID: &str = "018f2000-0000-7000-8000-000000000003";
    let create_database = serde_json::json!({
        "version": 1,
        "operation_id": "lifecycle-database-create",
        "store_epoch": expected.store_epoch,
        "intent": {
            "kind": "create_database",
            "database_id": DATABASE_ID,
            "data_source_id": SOURCE_ID,
            "view_id": VIEW_ID,
            "name": "Lifecycle work",
            "parent": { "kind": "library", "before": null }
        }
    })
    .to_string();
    let created_database = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/apply",
        &create_database,
        &module_headers,
    );
    assert_eq!(response_json(&created_database)["status"], "ok");

    let grant_database = serde_json::json!({
        "version": 1,
        "operation_id": "lifecycle-database-grant",
        "store_epoch": expected.store_epoch,
        "intent": {
            "kind": "grant_project_access",
            "project_id": "project:default",
            "target": { "kind": "database", "database_id": DATABASE_ID },
            "access": "read_write"
        }
    })
    .to_string();
    let granted_database = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/library/apply",
        &grant_database,
        &module_headers,
    );
    assert_eq!(response_json(&granted_database)["status"], "ok");

    let database_read = serde_json::json!({
        "version": 1,
        "read": {
            "target": { "kind": "data_source", "data_source_id": SOURCE_ID },
            "mode": "data_source",
            "filter": null,
            "sort": null
        }
    })
    .to_string();
    let database_read = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/database/read",
        &database_read,
        &module_headers,
    );
    let database_read = response_json(&database_read);
    assert_eq!(database_read["status"], "ok");
    assert_eq!(
        database_read["payload"]["value"]["value"]["properties"]
            .as_array()
            .map(Vec::len),
        Some(8)
    );

    let database_apply_body = serde_json::json!({
        "version": 1,
        "operation_id": "lifecycle-database-property",
        "store_epoch": expected.store_epoch,
        "intent": [{
            "kind": "put_property",
            "data_source_id": SOURCE_ID,
            "property_id": "risk",
            "expected_data_source_revision": 1,
            "expected_property_revision": 0,
            "name": "Risk",
            "value_type": "select",
            "before_property_id": null
        }]
    })
    .to_string();
    let database_apply = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/modules/database/apply",
        &database_apply_body,
        &module_headers,
    );
    let database_apply = response_json(&database_apply);
    assert_eq!(database_apply["status"], "error");
    assert_eq!(database_apply["payload"]["code"], "unauthorized");

    let oversized = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/handshake",
        &"x".repeat(2 * 1024 * 1024 + 1),
    );
    assert!(oversized.starts_with("HTTP/1.1 413"));

    let invalid_utf8 = request_bytes_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/handshake",
        &[b'{', b'"', b'x', b'"', b':', b'"', 0xff, b'"', b'}'],
        &[],
    );
    assert!(invalid_utf8.starts_with("HTTP/1.1 400"));

    let deep_json = format!("{}0{}", "[".repeat(34), "]".repeat(34));
    let deep_json = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/handshake",
        &deep_json,
    );
    assert!(deep_json.starts_with("HTTP/1.1 400"));

    let unbound_shutdown = request(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/admin/shutdown",
        "{}",
    );
    assert!(unbound_shutdown.starts_with("HTTP/1.1 401"));

    let mut event_stream = open_sse(
        &expected.socket_path,
        &auth,
        "/core/v1/events?after=0",
        &connection_headers,
    );

    let shutdown = request_with_headers(
        &expected.socket_path,
        &auth,
        "POST",
        "/core/v1/admin/shutdown",
        "{}",
        &connection_headers,
    );
    assert!(shutdown.starts_with("HTTP/1.1 200"));
    let mut remaining_events = Vec::new();
    event_stream
        .read_to_end(&mut remaining_events)
        .expect("graceful drain closes the SSE stream");

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

#[test]
fn core_idle_exits_after_startup_clients_are_gone() {
    let directory = tempdir().expect("disposable Core home");
    let home = directory.path().canonicalize().expect("absolute home");
    let executable = env!("CARGO_BIN_EXE_nodex-core");
    let spawn = || {
        Command::new(executable)
            .args(["--home", home.to_str().expect("UTF-8 home")])
            .env("NODEX_CORE_IDLE_TIMEOUT_MS", "500")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn Core")
    };
    let mut core = spawn();
    let descriptor = read_ready_descriptor(&mut core);
    let mut contender = spawn();
    let reused = read_ready_descriptor(&mut contender);
    assert_eq!(reused.pid, descriptor.pid);
    assert_eq!(reused.start_nonce, descriptor.start_nonce);
    assert!(contender.wait().expect("wait for startup client").success());

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = core.try_wait().expect("poll idle Core") {
            assert!(status.success());
            break;
        }
        assert!(Instant::now() < deadline, "idle Core did not exit");
        std::thread::sleep(Duration::from_millis(20));
    }
    let runtime = home.join("run/core");
    assert!(!runtime.join("core.sock").exists());
    assert!(!runtime.join("core.json").exists());
    assert!(!runtime.join("core.auth").exists());
}
