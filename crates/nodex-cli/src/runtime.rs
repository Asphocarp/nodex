use std::collections::BTreeMap;
use std::env;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use nodex_core_contracts::administration::{
    BackupTrigger, MaintenanceTask, StoreAdministrationContract, StoreAdministrationIntent,
    StoreAdministrationRead, StoreAdministrationReadValue,
};
use nodex_core_contracts::workspace::{
    ProjectLifecycle, ProjectWorkspaceProject, ProjectWorkspaceRead, ProjectWorkspaceReadValue,
};
use nodex_core_contracts::{
    CoreError, CoreErrorCode, ModuleApplyRequest, StoreEpoch, VersionedModuleContract,
};
use nodex_core_protocol::client::{ClientError, CoreClient, connect_or_launch};
use nodex_core_protocol::{
    ProjectWorkspaceReadResponse, ResponseEnvelope, StoreAdministrationApplyResponse,
    StoreAdministrationReadResponse,
};
use serde::Serialize;
use serde_json::{Value, json};

use crate::cli::{BackupCommand, Cli, Command};
use crate::error::{CliError, CliErrorCode};

#[derive(Clone, Debug)]
pub enum CommandOutput {
    Json(Value),
    Text(String),
    Bytes(Vec<u8>),
}

impl CommandOutput {
    pub fn write(self, json_output: bool) -> Result<(), CliError> {
        let mut stdout = io::stdout().lock();
        if json_output {
            let result = match self {
                Self::Json(value) => value,
                Self::Text(value) => Value::String(value),
                Self::Bytes(value) => Value::String(String::from_utf8(value).map_err(|_| {
                    CliError::new(
                        CliErrorCode::Internal,
                        "command returned non-UTF-8 bytes for JSON output",
                    )
                })?),
            };
            serde_json::to_writer(
                &mut stdout,
                &json!({ "version": 1, "ok": true, "result": result }),
            )
            .map_err(internal)?;
            stdout.write_all(b"\n").map_err(internal)?;
            return Ok(());
        }

        let bytes = match self {
            Self::Json(value) => serde_json::to_string_pretty(&value)
                .map_err(internal)?
                .into_bytes(),
            Self::Text(value) => value.into_bytes(),
            Self::Bytes(value) => value,
        };
        stdout.write_all(&bytes).map_err(internal)?;
        if !bytes.ends_with(b"\n") {
            stdout.write_all(b"\n").map_err(internal)?;
        }
        Ok(())
    }
}

pub fn execute(cli: Cli) -> Result<CommandOutput, CliError> {
    let cwd = env::current_dir().map_err(core_unavailable)?;
    let home = resolve_home(&cwd)?;
    let client =
        connect_or_launch(&home, env!("CARGO_PKG_VERSION"), None).map_err(map_client_error)?;
    validate_profile_selector(cli.profile.as_deref(), &client)?;

    match cli.command {
        Command::Context => context(&client, cli.project.as_deref(), &cwd),
        Command::Backup(backup) => match backup.command {
            BackupCommand::List => backup_list(&client),
            BackupCommand::Create { label, mutation } => {
                let operation_id = operation_id(mutation.idempotency_key.as_deref(), cli.json)?;
                backup_create(&client, operation_id, label)
            }
        },
        Command::Doctor(arguments) => doctor(
            &client,
            arguments.full,
            arguments.mutation.idempotency_key.as_deref(),
            cli.json,
        ),
        _ => Err(CliError::new(
            CliErrorCode::InvalidInput,
            "this native CLI command is parsed but not implemented yet",
        )),
    }
}

fn context(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
) -> Result<CommandOutput, CliError> {
    let startup = unwrap_workspace(client.workspace_read(None, ProjectWorkspaceRead::Startup))?;
    let ProjectWorkspaceReadValue::Startup { projects, .. } = startup.value else {
        return Err(CliError::new(
            CliErrorCode::Internal,
            "Core returned the wrong workspace snapshot",
        ));
    };
    let resolved = resolve_project(client, projects, explicit_project, cwd)?;
    let health = client.health().map_err(map_client_error)?;
    let scope_id = resolved.project.database_id.clone();
    let value = serde_json::to_value(ContextOutput {
        profile: ContextProfile {
            id: client.handshake.profile_id.clone(),
            library_id: client.handshake.library_id.clone(),
        },
        project: resolved.project,
        matched_by: resolved.matched_by,
        matched_root: resolved.matched_root,
        primary_database_id: scope_id.clone(),
        scope: ContextScope {
            kind: "database",
            id: scope_id,
        },
        core: ContextCore {
            pid: client.handshake.pid,
            build_id: client.handshake.build_id.clone(),
            protocol_version: client.handshake.protocol_version,
            schema_version: client.handshake.schema_version,
            store_epoch: client.handshake.store_epoch.clone(),
            readiness: format!("{:?}", health.status).to_ascii_lowercase(),
        },
        background_registration: "not_configured",
    })
    .map_err(internal)?;
    Ok(CommandOutput::Json(value))
}

fn backup_list(client: &CoreClient) -> Result<CommandOutput, CliError> {
    let snapshot =
        unwrap_administration(client.administration_read(StoreAdministrationRead::Backups))?;
    let StoreAdministrationReadValue::Backups { items } = snapshot.value else {
        return Err(CliError::new(
            CliErrorCode::Internal,
            "Core returned the wrong backup snapshot",
        ));
    };
    Ok(CommandOutput::Json(json!({ "backups": items })))
}

fn backup_create(
    client: &CoreClient,
    operation_id: String,
    label: Option<String>,
) -> Result<CommandOutput, CliError> {
    let committed = unwrap_administration_apply(client.administration_apply(ModuleApplyRequest {
        version: StoreAdministrationContract::VERSION,
        operation_id,
        store_epoch: StoreEpoch(client.handshake.store_epoch.clone()),
        intent: StoreAdministrationIntent::CreateBackup {
            label,
            include_assets: true,
            trigger: BackupTrigger::Manual,
        },
    }))?;
    Ok(CommandOutput::Json(
        serde_json::to_value(committed).map_err(internal)?,
    ))
}

fn doctor(
    client: &CoreClient,
    full: bool,
    idempotency_key: Option<&str>,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    let maintenance = if full {
        let operation_id = operation_id(idempotency_key, json_output)?;
        Some(unwrap_administration_apply(client.administration_apply(
            ModuleApplyRequest {
                version: StoreAdministrationContract::VERSION,
                operation_id,
                store_epoch: StoreEpoch(client.handshake.store_epoch.clone()),
                intent: StoreAdministrationIntent::RunMaintenance {
                    tasks: vec![
                        MaintenanceTask::IntegrityCheck,
                        MaintenanceTask::ForeignKeyCheck,
                    ],
                    block_retention_count: None,
                },
            },
        ))?)
    } else {
        None
    };
    let status =
        unwrap_administration(client.administration_read(StoreAdministrationRead::Status))?;
    let health = client.health().map_err(map_client_error)?;
    Ok(CommandOutput::Json(json!({
        "status": status.value,
        "health": health,
        "maintenance": maintenance,
    })))
}

fn resolve_project(
    client: &CoreClient,
    projects: Vec<ProjectWorkspaceProject>,
    explicit: Option<&str>,
    cwd: &Path,
) -> Result<ResolvedProject, CliError> {
    if let Some(selector) = explicit {
        let matches = projects
            .into_iter()
            .filter(|project| project.id == selector || project.name == selector)
            .collect::<Vec<_>>();
        return match matches.as_slice() {
            [] => Err(CliError::new(
                CliErrorCode::ProjectNotFound,
                format!("no Project matches '{selector}'"),
            )),
            [project] => Ok(ResolvedProject {
                project: project.clone(),
                matched_by: "explicit",
                matched_root: None,
            }),
            _ => Err(CliError::new(
                CliErrorCode::ProjectAmbiguous,
                format!("multiple Projects are named '{selector}'"),
            )),
        };
    }

    let cwd = cwd.canonicalize().map_err(core_unavailable)?;
    let mut candidates = Vec::new();
    for project in projects {
        if project.lifecycle == ProjectLifecycle::Archived {
            continue;
        }
        for source in &project.sources {
            add_path_candidate(&mut candidates, &project, &cwd, &source.root, "source");
        }
        let worktrees = unwrap_workspace(client.workspace_read(
            Some(&project.id),
            ProjectWorkspaceRead::ManagedWorktrees {
                project_id: project.id.clone(),
            },
        ))?;
        let ProjectWorkspaceReadValue::ManagedWorktrees { roots } = worktrees.value else {
            return Err(CliError::new(
                CliErrorCode::Internal,
                "Core returned the wrong managed-worktree snapshot",
            ));
        };
        for root in roots {
            add_path_candidate(&mut candidates, &project, &cwd, &root, "managed_worktree");
        }
    }
    let Some(maximum) = candidates.iter().map(|candidate| candidate.depth).max() else {
        return Err(CliError::new(
            CliErrorCode::ProjectNotFound,
            format!(
                "cwd {} is not inside a Project source or managed worktree",
                cwd.display()
            ),
        ));
    };
    let mut winners = candidates
        .into_iter()
        .filter(|candidate| candidate.depth == maximum)
        .fold(BTreeMap::new(), |mut winners, candidate| {
            winners
                .entry(candidate.project.id.clone())
                .or_insert(candidate);
            winners
        })
        .into_values()
        .collect::<Vec<_>>();
    if winners.len() != 1 {
        winners.sort_by(|left, right| left.project.id.cmp(&right.project.id));
        return Err(CliError::new(
            CliErrorCode::ProjectAmbiguous,
            format!(
                "cwd matches multiple Projects at the same root depth: {}",
                winners
                    .iter()
                    .map(|candidate| candidate.project.id.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        ));
    }
    let winner = winners.pop().expect("one winner");
    Ok(ResolvedProject {
        project: winner.project,
        matched_by: winner.kind,
        matched_root: Some(winner.root),
    })
}

fn add_path_candidate(
    candidates: &mut Vec<ProjectCandidate>,
    project: &ProjectWorkspaceProject,
    cwd: &Path,
    root: &str,
    kind: &'static str,
) {
    let root = Path::new(root);
    if !root.is_absolute() {
        return;
    }
    let Ok(root) = root.canonicalize() else {
        return;
    };
    if !cwd.starts_with(&root) {
        return;
    }
    candidates.push(ProjectCandidate {
        project: project.clone(),
        root: root.to_string_lossy().into_owned(),
        kind,
        depth: root.components().count(),
    });
}

fn validate_profile_selector(selector: Option<&str>, client: &CoreClient) -> Result<(), CliError> {
    let Some(selector) = selector else {
        return Ok(());
    };
    if selector == client.handshake.profile_id {
        return Ok(());
    }
    Err(CliError::new(
        CliErrorCode::ScopeNotFound,
        format!("the selected home does not contain Profile '{selector}'"),
    ))
}

fn resolve_home(cwd: &Path) -> Result<PathBuf, CliError> {
    if let Some(home) = env::var_os("NODEX_HOME").filter(|value| !value.is_empty()) {
        let home = PathBuf::from(home);
        return Ok(if home.is_absolute() {
            home
        } else {
            cwd.join(home)
        });
    }
    let user_home = env::var_os("HOME").ok_or_else(|| {
        CliError::new(
            CliErrorCode::CoreUnavailable,
            "HOME is unavailable and NODEX_HOME is not set",
        )
    })?;
    Ok(PathBuf::from(user_home).join(".nodex"))
}

fn operation_id(explicit: Option<&str>, json_output: bool) -> Result<String, CliError> {
    if let Some(explicit) = explicit {
        if explicit.is_empty() || explicit.len() > 512 {
            return Err(CliError::new(
                CliErrorCode::InvalidInput,
                "idempotency key must contain 1 to 512 bytes",
            ));
        }
        return Ok(explicit.to_owned());
    }
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|error| {
        CliError::new(
            CliErrorCode::Internal,
            format!("could not generate idempotency key: {error}"),
        )
    })?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(internal)?
        .as_millis();
    let key = format!("cli-{timestamp}-{}", hex::encode(random));
    if json_output {
        eprintln!(
            "{}",
            json!({ "version": 1, "diagnostic": "generated_idempotency_key", "value": key })
        );
    } else {
        eprintln!("idempotency key: {key}");
    }
    Ok(key)
}

fn unwrap_workspace(
    result: Result<ProjectWorkspaceReadResponse, ClientError>,
) -> Result<nodex_core_contracts::ModuleReadSnapshot<ProjectWorkspaceReadValue>, CliError> {
    match result.map_err(map_client_error)?.0 {
        ResponseEnvelope::Ok(snapshot) => Ok(snapshot),
        ResponseEnvelope::Error(error) => Err(map_core_error(error)),
    }
}

fn unwrap_administration(
    result: Result<StoreAdministrationReadResponse, ClientError>,
) -> Result<nodex_core_contracts::ModuleReadSnapshot<StoreAdministrationReadValue>, CliError> {
    match result.map_err(map_client_error)?.0 {
        ResponseEnvelope::Ok(snapshot) => Ok(snapshot),
        ResponseEnvelope::Error(error) => Err(map_core_error(error)),
    }
}

fn unwrap_administration_apply(
    result: Result<StoreAdministrationApplyResponse, ClientError>,
) -> Result<
    nodex_core_contracts::CommittedModuleValue<
        nodex_core_contracts::administration::StoreAdministrationCommitValue,
        nodex_core_contracts::administration::StoreAdministrationReceipt,
    >,
    CliError,
> {
    match result.map_err(map_client_error)?.0 {
        ResponseEnvelope::Ok(committed) => Ok(committed),
        ResponseEnvelope::Error(error) => Err(map_core_error(error)),
    }
}

fn map_client_error(error: ClientError) -> CliError {
    match error {
        ClientError::ProtocolIncompatible(message) => {
            CliError::new(CliErrorCode::ProtocolIncompatible, message)
        }
        error => CliError::new(CliErrorCode::CoreUnavailable, error.to_string()),
    }
}

fn map_core_error(error: CoreError) -> CliError {
    let code = match error.code {
        CoreErrorCode::NotFound => CliErrorCode::ScopeNotFound,
        CoreErrorCode::Ambiguous => CliErrorCode::ScopeAmbiguous,
        CoreErrorCode::Unauthorized => CliErrorCode::ScopeUnauthorized,
        CoreErrorCode::ResourceExhausted => CliErrorCode::ScopeBudgetExceeded,
        CoreErrorCode::IdempotencyKeyReused => CliErrorCode::IdempotencyKeyReused,
        CoreErrorCode::ProtectedOwnerDeletion => CliErrorCode::ProtectedOwnerDeletion,
        CoreErrorCode::ProtocolIncompatible => CliErrorCode::ProtocolIncompatible,
        CoreErrorCode::CoreUnavailable => CliErrorCode::CoreUnavailable,
        CoreErrorCode::RevisionConflict
        | CoreErrorCode::GenerationConflict
        | CoreErrorCode::HeadConflict
        | CoreErrorCode::StaleStoreEpoch => CliErrorCode::EtagConflict,
        _ => CliErrorCode::InvalidInput,
    };
    CliError::new(code, error.message)
}

fn core_unavailable(error: impl std::fmt::Display) -> CliError {
    CliError::new(CliErrorCode::CoreUnavailable, error.to_string())
}

fn internal(error: impl std::fmt::Display) -> CliError {
    CliError::new(CliErrorCode::Internal, error.to_string())
}

#[derive(Serialize)]
struct ContextOutput {
    profile: ContextProfile,
    project: ProjectWorkspaceProject,
    matched_by: &'static str,
    matched_root: Option<String>,
    primary_database_id: String,
    scope: ContextScope,
    core: ContextCore,
    background_registration: &'static str,
}

#[derive(Serialize)]
struct ContextProfile {
    id: String,
    library_id: String,
}

#[derive(Serialize)]
struct ContextScope {
    kind: &'static str,
    id: String,
}

#[derive(Serialize)]
struct ContextCore {
    pid: u32,
    build_id: String,
    protocol_version: u32,
    schema_version: u32,
    store_epoch: String,
    readiness: String,
}

struct ResolvedProject {
    project: ProjectWorkspaceProject,
    matched_by: &'static str,
    matched_root: Option<String>,
}

struct ProjectCandidate {
    project: ProjectWorkspaceProject,
    root: String,
    kind: &'static str,
    depth: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use nodex_core_contracts::workspace::ProjectSource;
    use tempfile::tempdir;

    fn project(id: &str, name: &str, root: &Path) -> ProjectWorkspaceProject {
        ProjectWorkspaceProject {
            id: id.to_owned(),
            library_id: "library".to_owned(),
            database_id: format!("database-{id}"),
            lifecycle: ProjectLifecycle::Active,
            binding_revision: 1,
            name: name.to_owned(),
            description: String::new(),
            icon: None,
            sources: vec![ProjectSource {
                root: root.to_string_lossy().into_owned(),
                order: 0,
            }],
            primary_workspace_root: Some(root.to_string_lossy().into_owned()),
            pinned: false,
            pinned_order: None,
            created_at: "2026-07-20T00:00:00Z".to_owned(),
            updated_at: "2026-07-20T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn explicit_project_selection_is_unique_by_id_or_name() {
        let directory = tempdir().expect("root");
        let projects = [
            project("p1", "Docs", directory.path()),
            project("p2", "Docs", directory.path()),
        ];
        assert_eq!(
            projects
                .iter()
                .filter(|project| project.id == "p1" || project.name == "p1")
                .count(),
            1
        );
        assert_eq!(
            projects
                .iter()
                .filter(|project| project.id == "Docs" || project.name == "Docs")
                .count(),
            2
        );
    }

    #[test]
    fn path_candidates_use_component_boundaries_and_longest_depth() {
        let directory = tempdir().expect("root");
        let root = directory.path().join("project");
        let nested = root.join("packages/nested");
        let cwd = nested.join("src");
        std::fs::create_dir_all(&cwd).expect("nested cwd");
        let cwd = cwd.canonicalize().expect("canonical cwd");
        let root_project = project("root", "Root", &root);
        let nested_project = project("nested", "Nested", &nested);
        let mut candidates = Vec::new();
        add_path_candidate(
            &mut candidates,
            &root_project,
            &cwd,
            &root.to_string_lossy(),
            "source",
        );
        add_path_candidate(
            &mut candidates,
            &nested_project,
            &cwd,
            &nested.to_string_lossy(),
            "source",
        );
        candidates.sort_by_key(|candidate| candidate.depth);
        assert_eq!(candidates.last().expect("winner").project.id, "nested");

        let sibling = directory.path().join("project-other");
        std::fs::create_dir_all(&sibling).expect("sibling");
        let before = candidates.len();
        add_path_candidate(
            &mut candidates,
            &root_project,
            &sibling.canonicalize().unwrap(),
            &root.to_string_lossy(),
            "source",
        );
        assert_eq!(candidates.len(), before);
    }
}
