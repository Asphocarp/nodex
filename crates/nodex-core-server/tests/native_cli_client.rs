use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use nodex_core_contracts::administration::{StoreAdministrationRead, StoreAdministrationReadValue};
use nodex_core_protocol::ResponseEnvelope;
use nodex_core_protocol::client::{CoreClient, connect_or_launch};
use tempfile::tempdir;

struct ProcessGuard(u32);

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        let _ = Command::new("kill")
            .args(["-TERM", &self.0.to_string()])
            .status();
    }
}

#[test]
fn native_client_cold_starts_reuses_and_reads_the_authenticated_core() {
    let directory = tempdir().expect("Core home");
    let home = directory.path().canonicalize().expect("absolute home");
    let executable = Path::new(env!("CARGO_BIN_EXE_nodex-core"));

    let client = connect_or_launch(&home, "native-client-test", Some(executable))
        .expect("cold native client launch");
    let pid = client.handshake.pid;
    let guard = ProcessGuard(pid);
    assert_eq!(client.descriptor.pid, client.handshake.pid);
    assert_eq!(client.handshake.schema_version, 84);

    let second = CoreClient::connect(&home, "native-client-test").expect("reuse running Core");
    assert_eq!(second.handshake.pid, client.handshake.pid);
    assert_eq!(second.handshake.start_nonce, client.handshake.start_nonce);

    let health = client.health().expect("health");
    assert_eq!(health.pid, client.handshake.pid);
    let response = client
        .administration_read(StoreAdministrationRead::Status)
        .expect("administration status");
    let ResponseEnvelope::Ok(snapshot) = response.0 else {
        panic!("expected administration status")
    };
    let StoreAdministrationReadValue::Status { schema_version, .. } = snapshot.value else {
        panic!("expected Store status value")
    };
    assert_eq!(schema_version, 84);

    drop(second);
    drop(client);
    drop(guard);
    wait_for_runtime_cleanup(&home);
}

fn wait_for_runtime_cleanup(home: &Path) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if !home.join("run/core/core.json").exists() {
            return;
        }
        assert!(Instant::now() < deadline, "Core runtime did not clean up");
        thread::sleep(Duration::from_millis(20));
    }
}
