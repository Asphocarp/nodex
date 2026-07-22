use std::fs;
use std::path::Path;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use nodex_core::infrastructure::schema::CORE_SCHEMA_VERSION;
use nodex_core_contracts::administration::{StoreAdministrationRead, StoreAdministrationReadValue};
use nodex_core_contracts::library::{
    LibraryAccess, LibraryIntent, LibraryPageFileKind, LibraryPagePrepareKind, LibraryRead,
    LibraryReadValue, LibraryResourceTarget, LibraryWriteParent,
};
use nodex_core_contracts::workspace::ProjectWorkspaceIntent;
use nodex_core_contracts::{ModuleApplyRequest, StoreEpoch, VersionedModuleContract};
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
    let expected_schema_version =
        u32::try_from(CORE_SCHEMA_VERSION).expect("Core schema version fits the wire contract");
    let pid = client.handshake.pid;
    let guard = ProcessGuard(pid);
    assert_eq!(client.descriptor.pid, client.handshake.pid);
    assert_eq!(client.handshake.schema_version, expected_schema_version);

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
    assert_eq!(schema_version, expected_schema_version);

    let source = home.join("source");
    fs::create_dir(&source).expect("Project source");
    let project_id = "019b1000-1000-7000-8000-000000000001";
    let page_id = "019b1000-1000-7000-8000-000000000002";
    let document_id = "019b1000-1000-7000-8000-000000000003";
    let store_epoch = StoreEpoch(client.handshake.store_epoch.clone());
    let created_project = client
        .workspace_apply(
            None,
            ModuleApplyRequest {
                version: <nodex_core_contracts::workspace::ProjectWorkspaceContract as VersionedModuleContract>::VERSION,
                operation_id: "native-client:create-project".to_owned(),
                store_epoch: store_epoch.clone(),
                intent: ProjectWorkspaceIntent::CreateProject {
                    project_id: project_id.to_owned(),
                    name: "Native CLI".to_owned(),
                    description: String::new(),
                    icon: None,
                    source_roots: vec![source.to_string_lossy().into_owned()],
                },
            },
        )
        .expect("create Project through native client");
    assert!(matches!(created_project.0, ResponseEnvelope::Ok(_)));
    let created_page = client
        .library_apply(
            Some(project_id),
            ModuleApplyRequest {
                version: nodex_core_contracts::library::LIBRARY_CONTRACT_VERSION,
                operation_id: "native-client:create-page".to_owned(),
                store_epoch: store_epoch.clone(),
                intent: LibraryIntent::CreatePage {
                    page_id: page_id.to_owned(),
                    document_id: document_id.to_owned(),
                    title: "Native **read**".to_owned(),
                    parent: LibraryWriteParent::Library { before: None },
                },
            },
        )
        .expect("create Page through native client");
    assert!(matches!(created_page.0, ResponseEnvelope::Ok(_)));
    let granted = client
        .library_apply(
            None,
            ModuleApplyRequest {
                version: nodex_core_contracts::library::LIBRARY_CONTRACT_VERSION,
                operation_id: "native-client:grant-page".to_owned(),
                store_epoch,
                intent: LibraryIntent::GrantProjectAccess {
                    project_id: project_id.to_owned(),
                    target: LibraryResourceTarget::Page {
                        page_id: page_id.to_owned(),
                    },
                    access: LibraryAccess::ReadWrite,
                },
            },
        )
        .expect("grant Page through native client");
    assert!(matches!(granted.0, ResponseEnvelope::Ok(_)));
    let page_file = client
        .library_read(
            Some(project_id),
            LibraryRead::PageFile {
                page_id: page_id.to_owned(),
                file_kind: LibraryPageFileKind::MetaYaml,
                prepare: Some(LibraryPagePrepareKind::TitleSet),
            },
        )
        .expect("read Page file through native client");
    let ResponseEnvelope::Ok(snapshot) = page_file.0 else {
        panic!("expected Page file snapshot")
    };
    let LibraryReadValue::PageFile { value } = snapshot.value else {
        panic!("expected Page file value")
    };
    assert!(
        value
            .content
            .contains(r#"title: "Native \\*\\*read\\*\\*""#)
    );
    assert!(value.validators.title_etag.is_some());
    assert!(value.validators.body_etag.is_none());

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
