use std::fs;
use std::process::Command;

use serde_json::Value;

#[test]
fn capabilities_succeeds_without_resolving_a_profile_or_starting_core() {
    let temp = tempfile::tempdir().expect("temporary HOME");
    let unavailable_home = temp.path().join("must-not-be-created");
    let output = Command::new(env!("CARGO_BIN_EXE_nodex"))
        .args([
            "--profile",
            "missing-profile",
            "--project",
            "missing-project",
            "--json",
            "capabilities",
        ])
        .current_dir(temp.path())
        .env("HOME", temp.path())
        .env("NODEX_HOME", &unavailable_home)
        .output()
        .expect("run nodex capabilities");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout).expect("JSON envelope");
    assert_eq!(envelope["version"], 1);
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["result"]["schemaVersion"], 1);
    assert_eq!(envelope["result"]["agentApi"]["minimumRevision"], 1);
    assert_eq!(envelope["result"]["agentApi"]["maximumRevision"], 1);
    assert_eq!(
        envelope["result"]["bundle"]["status"],
        Value::String("unavailable".into())
    );
    assert!(
        !unavailable_home.exists(),
        "capabilities must not resolve or create NODEX_HOME"
    );
    assert!(
        fs::read_dir(temp.path())
            .expect("temporary HOME")
            .all(|entry| entry.expect("entry").path() != unavailable_home)
    );
}

#[test]
fn every_leaf_exposes_machine_readable_help_without_core() {
    let output = Command::new(env!("CARGO_BIN_EXE_nodex"))
        .args(["--json", "page", "move", "--help"])
        .output()
        .expect("run machine help");

    assert!(output.status.success());
    let document: Value = serde_json::from_slice(&output.stdout).expect("machine help JSON");
    assert_eq!(document["schemaVersion"], 1);
    assert_eq!(document["command"], "nodex page move");
    assert_eq!(document["capability"], "pageWrite");
    assert_eq!(document["effect"], "write");
    assert_eq!(document["resultSchemaRevision"], 1);
}
