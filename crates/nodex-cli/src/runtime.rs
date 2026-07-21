use std::collections::{BTreeMap, HashSet};
use std::env;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use nodex_core_contracts::administration::{
    BackupTrigger, MaintenanceTask, StoreAdministrationContract, StoreAdministrationIntent,
    StoreAdministrationRead, StoreAdministrationReadValue,
};
use nodex_core_contracts::database::{
    DatabaseRead, DatabaseReadMode, DatabaseReadValue, DatabaseTarget,
};
use nodex_core_contracts::library::{
    LibraryCatalogKind, LibraryLifecycle, LibraryNavigationNode, LibraryNavigationParent,
    LibraryPageFileKind, LibraryPageHistoryCursor, LibraryPageOwnershipPath,
    LibraryPagePrepareKind, LibraryRead, LibraryReadValue, LibraryResourceTarget,
    LibrarySearchSnapshotScope,
};
use nodex_core_contracts::workspace::{
    ProjectLifecycle, ProjectWorkspaceProject, ProjectWorkspaceRead, ProjectWorkspaceReadValue,
};
use nodex_core_contracts::{
    CoreError, CoreErrorCode, ModuleApplyRequest, StoreEpoch, VersionedModuleContract,
};
use nodex_core_protocol::client::{ClientError, CoreClient, connect_or_launch};
use nodex_core_protocol::{
    DatabaseReadResponse, LibraryReadResponse, ProjectWorkspaceReadResponse, ResponseEnvelope,
    StoreAdministrationApplyResponse, StoreAdministrationReadResponse,
};
use serde::Serialize;
use serde_json::{Value, json};

use crate::cli::{
    BackupCommand, BlockArgs, BlockCommand, Cli, Command, HistoryArgs, PageArgs, PageCommand,
    PageTitleArgs, PageTitleCommand, PrepareKind, ReadArgs, RgArgs, SedArgs,
};
use crate::error::{CliError, CliErrorCode};

#[derive(Clone, Debug)]
pub enum CommandOutput {
    Json(Value),
    Text(String),
    Bytes(Vec<u8>),
    Process { stdout: Vec<u8>, exit_status: i32 },
}

impl CommandOutput {
    pub fn exit_status(&self) -> i32 {
        match self {
            Self::Process { exit_status, .. } => *exit_status,
            _ => crate::EXIT_SUCCESS,
        }
    }

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
                Self::Process {
                    stdout,
                    exit_status,
                } => json!({
                    "stdout": String::from_utf8(stdout).map_err(|_| {
                        CliError::new(
                            CliErrorCode::Internal,
                            "command returned non-UTF-8 process output for JSON output",
                        )
                    })?,
                    "exit_status": exit_status,
                }),
            };
            serde_json::to_writer(
                &mut stdout,
                &json!({ "version": 1, "ok": true, "result": result }),
            )
            .map_err(internal)?;
            stdout.write_all(b"\n").map_err(internal)?;
            return Ok(());
        }

        self.write_human(&mut stdout)
    }

    fn write_human(self, writer: &mut impl Write) -> Result<(), CliError> {
        match self {
            Self::Bytes(value) => writer.write_all(&value).map_err(internal),
            Self::Json(value) => write_line_terminated(
                writer,
                serde_json::to_string_pretty(&value)
                    .map_err(internal)?
                    .as_bytes(),
            ),
            Self::Text(value) => write_line_terminated(writer, value.as_bytes()),
            Self::Process { stdout, .. } => writer.write_all(&stdout).map_err(internal),
        }
    }
}

fn write_line_terminated(writer: &mut impl Write, bytes: &[u8]) -> Result<(), CliError> {
    writer.write_all(bytes).map_err(internal)?;
    if bytes.ends_with(b"\n") {
        return Ok(());
    }
    writer.write_all(b"\n").map_err(internal)
}

pub fn execute(cli: Cli) -> Result<CommandOutput, CliError> {
    let cwd = env::current_dir().map_err(core_unavailable)?;
    let home = resolve_home(&cwd)?;
    let client =
        connect_or_launch(&home, env!("CARGO_PKG_VERSION"), None).map_err(map_client_error)?;
    validate_profile_selector(cli.profile.as_deref(), &client)?;

    match cli.command {
        Command::Context => context(&client, cli.project.as_deref(), &cwd),
        Command::Read(arguments) => {
            read_page(&client, cli.project.as_deref(), &cwd, arguments, cli.json)
        }
        Command::Sed(arguments) => {
            sed_page(&client, cli.project.as_deref(), &cwd, arguments, cli.json)
        }
        Command::Rg(arguments) => rg_pages(
            &client,
            cli.project.as_deref(),
            cli.database.as_deref(),
            cli.page.as_deref(),
            &cwd,
            arguments,
        ),
        Command::History(arguments) => history(&client, cli.project.as_deref(), &cwd, arguments),
        Command::Patch(arguments) => crate::page_mutation::patch_page(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Page(PageArgs {
            command: PageCommand::Create(arguments),
        }) => crate::page_lifecycle::create_page(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Page(PageArgs {
            command: PageCommand::Move(arguments),
        }) => crate::page_lifecycle::move_page(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Page(PageArgs {
            command: PageCommand::Duplicate(arguments),
        }) => crate::page_lifecycle::duplicate_page(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Page(PageArgs {
            command: PageCommand::Delete(arguments),
        }) => crate::page_lifecycle::delete_page(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Page(PageArgs {
            command: PageCommand::Insert(arguments),
        }) => crate::page_mutation::insert_page_content(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Page(PageArgs {
            command: PageCommand::Replace(arguments),
        }) => crate::page_mutation::replace_page(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Page(PageArgs {
            command:
                PageCommand::Title(PageTitleArgs {
                    command: PageTitleCommand::Set(arguments),
                }),
        }) => crate::page_mutation::set_page_title(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Block(BlockArgs {
            command: BlockCommand::Insert(arguments),
        }) => crate::page_mutation::insert_block(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Block(BlockArgs {
            command: BlockCommand::Update(arguments),
        }) => crate::page_mutation::update_block(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Block(BlockArgs {
            command: BlockCommand::Move(arguments),
        }) => crate::page_mutation::move_block(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Block(BlockArgs {
            command: BlockCommand::Delete(arguments),
        }) => crate::page_mutation::delete_block(
            &client,
            cli.project.as_deref(),
            &cwd,
            arguments,
            cli.json,
        ),
        Command::Tree { scope } => tree(
            &client,
            cli.project.as_deref(),
            cli.page.as_deref().or(scope.as_deref()),
            &cwd,
            cli.json,
        ),
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

fn rg_pages(
    client: &CoreClient,
    explicit_project: Option<&str>,
    explicit_database: Option<&str>,
    explicit_page: Option<&str>,
    cwd: &Path,
    arguments: RgArgs,
) -> Result<CommandOutput, CliError> {
    let invocation = crate::ripgrep::parse(arguments.arguments)?;
    if invocation.scope.is_some() && (explicit_database.is_some() || explicit_page.is_some()) {
        return Err(CliError::new(
            CliErrorCode::RgArgumentUnsupported,
            "the positional rg scope cannot be combined with --database or --page",
        ));
    }
    if explicit_database.is_some() && explicit_page.is_some() {
        return Err(CliError::new(
            CliErrorCode::ScopeAmbiguous,
            "--database and --page select different rg scope kinds",
        ));
    }
    let project = selected_project(client, explicit_project, cwd)?;
    let scope = if let Some(selector) = invocation.scope.as_deref() {
        resolve_search_scope(client, &project, selector)?
    } else if let Some(selector) = explicit_page {
        LibrarySearchSnapshotScope::Page {
            page_id: resolve_page_selector(client, &project.id, selector)?,
        }
    } else if let Some(selector) = explicit_database {
        LibrarySearchSnapshotScope::Database {
            database_id: stable_scope_id(selector, "--database")?,
        }
    } else {
        LibrarySearchSnapshotScope::Database {
            database_id: project.database_id.clone(),
        }
    };
    let snapshot = unwrap_library(client.library_read(
        Some(&project.id),
        LibraryRead::AcquireSearchSnapshot {
            scope,
            strict_materialization: true,
        },
    ))?;
    let LibraryReadValue::SearchSnapshotLease { value: lease } = snapshot.value else {
        return Err(internal("Core returned the wrong search snapshot lease"));
    };

    let searched = crate::ripgrep::run(&lease, &invocation);
    let released = unwrap_library(client.library_read(
        Some(&project.id),
        LibraryRead::ReleaseSearchSnapshot {
            lease_id: lease.lease_id.clone(),
        },
    ));
    match (searched, released) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Ok(output), Ok(snapshot)) => {
            let LibraryReadValue::SearchSnapshotRelease { value } = snapshot.value else {
                return Err(internal("Core returned the wrong search snapshot release"));
            };
            if !value.released {
                return Err(CliError::new(
                    CliErrorCode::SnapshotExpired,
                    "Core search snapshot lease expired before release",
                ));
            }
            Ok(CommandOutput::Process {
                stdout: output.stdout,
                exit_status: output.exit_status,
            })
        }
    }
}

fn resolve_search_scope(
    client: &CoreClient,
    project: &ProjectWorkspaceProject,
    selector: &str,
) -> Result<LibrarySearchSnapshotScope, CliError> {
    if selector == "database" || selector.strip_prefix('@') == Some(project.database_id.as_str()) {
        return Ok(LibrarySearchSnapshotScope::Database {
            database_id: project.database_id.clone(),
        });
    }
    if let Some(data_source_id) = selector.strip_prefix("data_source:") {
        return Ok(LibrarySearchSnapshotScope::DataSource {
            data_source_id: stable_scope_id(data_source_id, "Data Source scope")?,
        });
    }
    let Some(identity) = selector.strip_prefix('@') else {
        return Ok(LibrarySearchSnapshotScope::Page {
            page_id: resolve_page_selector(client, &project.id, selector)?,
        });
    };
    let page = unwrap_library(client.library_read(
        Some(&project.id),
        LibraryRead::PageLifecyclePreflight {
            page_id: identity.to_owned(),
        },
    ))?;
    let LibraryReadValue::PageLifecyclePreflight { value } = page.value else {
        return Err(internal("Core returned the wrong Page scope preflight"));
    };
    if value.page.is_some_and(|page| page.lifecycle == "active") {
        return Ok(LibrarySearchSnapshotScope::Page {
            page_id: identity.to_owned(),
        });
    }
    let database = client
        .database_read(
            Some(&project.id),
            DatabaseRead {
                target: DatabaseTarget::Database {
                    database_id: identity.to_owned(),
                },
                mode: DatabaseReadMode::Database,
                filter: None,
                sort: None,
            },
        )
        .map_err(map_client_error)?;
    match database.0 {
        ResponseEnvelope::Ok(snapshot) => {
            let DatabaseReadValue::Database { .. } = snapshot.value else {
                return Err(internal("Core returned the wrong Database scope snapshot"));
            };
            return Ok(LibrarySearchSnapshotScope::Database {
                database_id: identity.to_owned(),
            });
        }
        ResponseEnvelope::Error(error) if error.code == CoreErrorCode::NotFound => {}
        ResponseEnvelope::Error(error) => return Err(map_core_error(error)),
    }
    let source = client
        .database_read(
            Some(&project.id),
            DatabaseRead {
                target: DatabaseTarget::DataSource {
                    data_source_id: identity.to_owned(),
                },
                mode: DatabaseReadMode::DataSource,
                filter: None,
                sort: None,
            },
        )
        .map_err(map_client_error)?;
    match source.0 {
        ResponseEnvelope::Ok(snapshot) => {
            let DatabaseReadValue::DataSource { .. } = snapshot.value else {
                return Err(internal(
                    "Core returned the wrong Data Source scope snapshot",
                ));
            };
            Ok(LibrarySearchSnapshotScope::DataSource {
                data_source_id: identity.to_owned(),
            })
        }
        ResponseEnvelope::Error(error) if error.code == CoreErrorCode::NotFound => {
            Err(CliError::new(
                CliErrorCode::ScopeNotFound,
                format!("no authorized Page, Database, or Data Source matches '{selector}'"),
            ))
        }
        ResponseEnvelope::Error(error) => Err(map_core_error(error)),
    }
}

fn stable_scope_id(value: &str, label: &str) -> Result<String, CliError> {
    let value = value.strip_prefix('@').unwrap_or(value);
    if value.is_empty() || value.len() > 512 || value.trim() != value {
        return Err(CliError::new(
            CliErrorCode::InvalidInput,
            format!("{label} must contain one bounded stable identity"),
        ));
    }
    Ok(value.to_owned())
}

fn read_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: ReadArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    let project = selected_project(client, explicit_project, cwd)?;
    let page_id = resolve_page_selector(client, &project.id, &arguments.page)?;
    let file_kind = if arguments.meta {
        LibraryPageFileKind::MetaYaml
    } else {
        LibraryPageFileKind::BodyNestedMarkdown
    };
    let prepare = arguments.prepare.map(|prepare| match prepare {
        PrepareKind::TitleSet => LibraryPagePrepareKind::TitleSet,
        PrepareKind::DocumentReplace => LibraryPagePrepareKind::DocumentReplace,
        PrepareKind::PageDelete => LibraryPagePrepareKind::PageDelete,
    });
    let snapshot = unwrap_library(client.library_read(
        Some(&project.id),
        LibraryRead::PageFile {
            page_id,
            file_kind,
            prepare,
        },
    ))?;
    let LibraryReadValue::PageFile { value } = snapshot.value else {
        return Err(internal("Core returned the wrong Page file snapshot"));
    };
    if json_output {
        return Ok(CommandOutput::Json(
            serde_json::to_value(value).map_err(internal)?,
        ));
    }
    Ok(CommandOutput::Bytes(value.content.into_bytes()))
}

fn sed_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: SedArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    let range = crate::sed::parse_program(&arguments.program)?;
    let project = selected_project(client, explicit_project, cwd)?;
    let page_id = resolve_page_selector(client, &project.id, &arguments.page)?;
    let snapshot = unwrap_library(client.library_read(
        Some(&project.id),
        LibraryRead::PageFile {
            page_id,
            file_kind: LibraryPageFileKind::BodyNestedMarkdown,
            prepare: None,
        },
    ))?;
    let LibraryReadValue::PageFile { value } = snapshot.value else {
        return Err(internal("Core returned the wrong Page file snapshot"));
    };
    let selected = crate::sed::select_lines(&value.content, range);
    if json_output {
        return Ok(CommandOutput::Json(json!({
            "content": selected,
            "range": { "start": range.start, "end": range.end },
            "page_id": value.page_id,
        })));
    }
    Ok(CommandOutput::Bytes(selected.into_bytes()))
}

fn history(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: HistoryArgs,
) -> Result<CommandOutput, CliError> {
    let project = selected_project(client, explicit_project, cwd)?;
    let page_id = resolve_page_selector(client, &project.id, &arguments.page)?;
    let before = arguments
        .before
        .as_deref()
        .map(|value| {
            serde_json::from_str::<LibraryPageHistoryCursor>(value).map_err(|_| {
                CliError::new(
                    CliErrorCode::InvalidInput,
                    "history --before must be the JSON cursor emitted by a prior history result",
                )
            })
        })
        .transpose()?;
    let snapshot = unwrap_library(client.library_read(
        Some(&project.id),
        LibraryRead::PageHistory {
            page_id,
            before,
            limit: arguments.limit,
        },
    ))?;
    let LibraryReadValue::PageHistory { value } = snapshot.value else {
        return Err(internal("Core returned the wrong Page history snapshot"));
    };
    Ok(CommandOutput::Json(
        serde_json::to_value(value).map_err(internal)?,
    ))
}

fn tree(
    client: &CoreClient,
    explicit_project: Option<&str>,
    page_scope: Option<&str>,
    cwd: &Path,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    let project = selected_project(client, explicit_project, cwd)?;
    let mut budget = TreeBudget::default();
    let root = if let Some(selector) = page_scope {
        let page_id = resolve_page_selector(client, &project.id, selector)?;
        let page = read_page_tree_node(client, &project.id, &page_id, 0, &mut budget)?;
        TreeRoot::Page { page }
    } else {
        let (name, pages) = database_tree(client, &project.id, &mut budget)?;
        TreeRoot::Database {
            database_id: project.database_id.clone(),
            name,
            pages,
        }
    };
    if json_output {
        return Ok(CommandOutput::Json(
            serde_json::to_value(root).map_err(internal)?,
        ));
    }
    let mut rendered = String::new();
    render_tree_root(&root, &mut rendered);
    Ok(CommandOutput::Text(rendered))
}

pub(crate) fn selected_project(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
) -> Result<ProjectWorkspaceProject, CliError> {
    let startup = unwrap_workspace(client.workspace_read(None, ProjectWorkspaceRead::Startup))?;
    let ProjectWorkspaceReadValue::Startup { projects, .. } = startup.value else {
        return Err(internal("Core returned the wrong workspace snapshot"));
    };
    resolve_project(client, projects, explicit_project, cwd).map(|resolved| resolved.project)
}

pub(crate) fn resolve_page_selector(
    client: &CoreClient,
    project_id: &str,
    selector: &str,
) -> Result<String, CliError> {
    if let Some(page_id) = selector.strip_prefix('@') {
        if !page_id.is_empty() && page_id.len() <= 512 && page_id.trim() == page_id {
            return Ok(page_id.to_owned());
        }
        return Err(CliError::new(
            CliErrorCode::InvalidInput,
            "a canonical @Page selector must contain one bounded stable ID",
        ));
    }
    let components = selector.split('/').collect::<Vec<_>>();
    if components.is_empty()
        || components.len() > 64
        || components
            .iter()
            .any(|component| component.is_empty() || component.len() > 4_096)
    {
        return Err(CliError::new(
            CliErrorCode::InvalidInput,
            "a Page title path must contain 1 to 64 non-empty bounded components",
        ));
    }
    let query = components.last().expect("non-empty selector");
    let mut cursor = None;
    let mut candidates = Vec::new();
    loop {
        let snapshot = unwrap_library(client.library_read(
            None,
            LibraryRead::Catalog {
                query: Some((*query).to_owned()),
                kinds: Some(vec![LibraryCatalogKind::Page]),
                lifecycle: Some(LibraryLifecycle::Active),
                cursor,
                limit: Some(100),
            },
        ))?;
        let LibraryReadValue::Catalog {
            items,
            next_cursor,
            has_more,
            ..
        } = snapshot.value
        else {
            return Err(internal("Core returned the wrong Page catalog snapshot"));
        };
        for item in items {
            if item.title != *query {
                continue;
            }
            let LibraryResourceTarget::Page { page_id } = item.target else {
                return Err(internal("Core Page catalog contained a non-Page target"));
            };
            candidates.push(page_id);
            if candidates.len() > 10_000 {
                return Err(CliError::new(
                    CliErrorCode::ScopeBudgetExceeded,
                    "Page title resolution exceeds the 10000-candidate limit",
                ));
            }
        }
        if !has_more {
            break;
        }
        cursor = next_cursor;
        if cursor.is_none() {
            return Err(internal("Core Page catalog pagination has no cursor"));
        }
    }
    let mut matches = Vec::new();
    for candidate in candidates {
        let content = match unwrap_library(client.library_read(
            Some(project_id),
            LibraryRead::PageContent {
                page_id: candidate.clone(),
            },
        )) {
            Ok(content) => content,
            Err(error)
                if matches!(
                    error.code,
                    CliErrorCode::ScopeNotFound | CliErrorCode::ScopeUnauthorized
                ) =>
            {
                continue;
            }
            Err(error) => return Err(error),
        };
        let LibraryReadValue::PageContent { value: content } = content.value else {
            return Err(internal("Core returned the wrong Page content snapshot"));
        };
        if content.title != *query {
            continue;
        }
        let ownership = unwrap_library(client.library_read(
            Some(project_id),
            LibraryRead::PageOwnershipPath {
                page_id: candidate.clone(),
            },
        ))?;
        let LibraryReadValue::PageOwnershipPath { value: Some(path) } = ownership.value else {
            continue;
        };
        let LibraryPageOwnershipPath::Available { ancestors, .. } = *path else {
            continue;
        };
        let mut titles = ancestors
            .into_iter()
            .map(|ancestor| ancestor.title)
            .collect::<Vec<_>>();
        titles.push(content.title);
        if titles
            .iter()
            .map(String::as_str)
            .eq(components.iter().copied())
        {
            matches.push(candidate);
        }
    }
    matches.sort();
    matches.dedup();
    match matches.as_slice() {
        [] => Err(CliError::new(
            CliErrorCode::ScopeNotFound,
            format!("no authorized Page matches title path '{selector}'"),
        )),
        [page_id] => Ok(page_id.clone()),
        _ => Err(CliError::new(
            CliErrorCode::ScopeAmbiguous,
            format!(
                "title path '{selector}' matches multiple Pages: {}",
                matches.join(", ")
            ),
        )),
    }
}

const MAX_TREE_DEPTH: usize = 64;
const MAX_TREE_NODES: usize = 10_000;

#[derive(Default)]
struct TreeBudget {
    event_head: Option<i64>,
    nodes: usize,
    seen_pages: HashSet<String>,
}

impl TreeBudget {
    fn observe(&mut self, event_head: i64) -> Result<(), CliError> {
        if self
            .event_head
            .is_some_and(|expected| expected != event_head)
        {
            return Err(CliError::new(
                CliErrorCode::EtagConflict,
                "Nodex changed while the tree was being assembled; retry the command",
            ));
        }
        self.event_head = Some(event_head);
        Ok(())
    }

    fn enter_page(&mut self, page_id: &str, depth: usize) -> Result<(), CliError> {
        if depth > MAX_TREE_DEPTH {
            return Err(CliError::new(
                CliErrorCode::ScopeBudgetExceeded,
                format!("Page tree exceeds the {MAX_TREE_DEPTH}-level depth limit"),
            ));
        }
        if self.nodes == MAX_TREE_NODES {
            return Err(CliError::new(
                CliErrorCode::ScopeBudgetExceeded,
                format!("Page tree exceeds the {MAX_TREE_NODES}-node limit"),
            ));
        }
        if !self.seen_pages.insert(page_id.to_owned()) {
            return Err(CliError::new(
                CliErrorCode::InvalidInput,
                format!("Page tree repeats or cycles through @{page_id}"),
            ));
        }
        self.nodes += 1;
        Ok(())
    }

    fn add_database(&mut self) -> Result<(), CliError> {
        if self.nodes == MAX_TREE_NODES {
            return Err(CliError::new(
                CliErrorCode::ScopeBudgetExceeded,
                format!("Page tree exceeds the {MAX_TREE_NODES}-node limit"),
            ));
        }
        self.nodes += 1;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TreeRoot {
    Database {
        database_id: String,
        name: String,
        pages: Vec<TreeNode>,
    },
    Page {
        page: TreeNode,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TreeNode {
    Page {
        page_id: String,
        title: String,
        children: Vec<TreeNode>,
    },
    Database {
        database_id: String,
        title: String,
    },
}

fn database_tree(
    client: &CoreClient,
    project_id: &str,
    budget: &mut TreeBudget,
) -> Result<(String, Vec<TreeNode>), CliError> {
    let snapshot = unwrap_database(client.database_read(
        Some(project_id),
        DatabaseRead {
            target: DatabaseTarget::ProjectDefault,
            mode: DatabaseReadMode::Query,
            filter: None,
            sort: None,
        },
    ))?;
    budget.observe(snapshot.event_head)?;
    let DatabaseReadValue::Query { value } = snapshot.value else {
        return Err(internal("Core returned the wrong Database tree snapshot"));
    };
    let name = value
        .pointer("/database/name")
        .and_then(Value::as_str)
        .ok_or_else(|| internal("Core Database tree has no name"))?
        .to_owned();
    let rows = value
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| internal("Core Database tree has no Page rows"))?;
    let mut pages = Vec::with_capacity(rows.len());
    for row in rows {
        let page_id = row
            .pointer("/page/pageId")
            .and_then(Value::as_str)
            .ok_or_else(|| internal("Core Database row has no Page ID"))?;
        pages.push(read_page_tree_node(client, project_id, page_id, 0, budget)?);
    }
    Ok((name, pages))
}

fn read_page_tree_node(
    client: &CoreClient,
    project_id: &str,
    page_id: &str,
    depth: usize,
    budget: &mut TreeBudget,
) -> Result<TreeNode, CliError> {
    budget.enter_page(page_id, depth)?;
    let content = unwrap_library(client.library_read(
        Some(project_id),
        LibraryRead::PageContent {
            page_id: page_id.to_owned(),
        },
    ))?;
    budget.observe(content.event_head)?;
    let LibraryReadValue::PageContent { value: content } = content.value else {
        return Err(internal("Core returned the wrong Page tree content"));
    };
    let mut cursor = None;
    let mut children = Vec::new();
    loop {
        let snapshot = unwrap_library(client.library_read(
            Some(project_id),
            LibraryRead::Children {
                parent: LibraryNavigationParent::Page {
                    page_id: page_id.to_owned(),
                },
                cursor,
                limit: Some(100),
                force_include_target: None,
            },
        ))?;
        budget.observe(snapshot.event_head)?;
        let LibraryReadValue::Children {
            items,
            next_cursor,
            has_more,
            ..
        } = snapshot.value
        else {
            return Err(internal("Core returned the wrong Page child snapshot"));
        };
        for child in items {
            match child {
                LibraryNavigationNode::Page { page_id, .. } => children.push(read_page_tree_node(
                    client,
                    project_id,
                    &page_id,
                    depth + 1,
                    budget,
                )?),
                LibraryNavigationNode::Database {
                    database_id, title, ..
                } => {
                    budget.add_database()?;
                    children.push(TreeNode::Database { database_id, title });
                }
                LibraryNavigationNode::View { .. } => {
                    return Err(internal("a Page tree unexpectedly contained a View"));
                }
            }
        }
        if !has_more {
            break;
        }
        cursor = next_cursor;
        if cursor.is_none() {
            return Err(internal("Core Page child pagination has no cursor"));
        }
    }
    Ok(TreeNode::Page {
        page_id: content.page_id,
        title: content.title,
        children,
    })
}

fn render_tree_root(root: &TreeRoot, output: &mut String) {
    match root {
        TreeRoot::Database {
            database_id,
            name,
            pages,
        } => {
            output.push_str(&format!("Database {name} @{database_id}\n"));
            for page in pages {
                render_tree_node(page, 1, output);
            }
        }
        TreeRoot::Page { page } => render_tree_node(page, 0, output),
    }
}

fn render_tree_node(node: &TreeNode, depth: usize, output: &mut String) {
    output.push_str(&"  ".repeat(depth));
    match node {
        TreeNode::Page {
            page_id,
            title,
            children,
        } => {
            output.push_str(&format!("Page {title} @{page_id}\n"));
            for child in children {
                render_tree_node(child, depth + 1, output);
            }
        }
        TreeNode::Database { database_id, title } => {
            output.push_str(&format!("Database {title} @{database_id}\n"));
        }
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

pub(crate) fn operation_id(explicit: Option<&str>, json_output: bool) -> Result<String, CliError> {
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

pub(crate) fn unwrap_library(
    result: Result<LibraryReadResponse, ClientError>,
) -> Result<nodex_core_contracts::ModuleReadSnapshot<LibraryReadValue>, CliError> {
    match result.map_err(map_client_error)?.0 {
        ResponseEnvelope::Ok(snapshot) => Ok(snapshot),
        ResponseEnvelope::Error(error) => Err(map_core_error(error)),
    }
}

pub(crate) fn unwrap_database(
    result: Result<DatabaseReadResponse, ClientError>,
) -> Result<nodex_core_contracts::ModuleReadSnapshot<DatabaseReadValue>, CliError> {
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

pub(crate) fn map_client_error(error: ClientError) -> CliError {
    match error {
        ClientError::ProtocolIncompatible(message) => {
            CliError::new(CliErrorCode::ProtocolIncompatible, message)
        }
        error => CliError::new(CliErrorCode::CoreUnavailable, error.to_string()),
    }
}

pub(crate) fn map_core_error(error: CoreError) -> CliError {
    let code = match error.code {
        CoreErrorCode::NotFound => CliErrorCode::ScopeNotFound,
        CoreErrorCode::Ambiguous => CliErrorCode::ScopeAmbiguous,
        CoreErrorCode::Unauthorized => CliErrorCode::ScopeUnauthorized,
        CoreErrorCode::ResourceExhausted => CliErrorCode::ScopeBudgetExceeded,
        CoreErrorCode::PatchNotFound => CliErrorCode::PatchNotFound,
        CoreErrorCode::PatchAmbiguous => CliErrorCode::PatchAmbiguous,
        CoreErrorCode::PatchOverlap => CliErrorCode::PatchOverlap,
        CoreErrorCode::IdempotencyKeyReused => CliErrorCode::IdempotencyKeyReused,
        CoreErrorCode::ProtectedOwnerDeletion => CliErrorCode::ProtectedOwnerDeletion,
        CoreErrorCode::MaterializationStale => CliErrorCode::MaterializationStale,
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

    #[test]
    fn human_bytes_are_written_exactly_while_structured_output_gets_a_final_lf() {
        let mut bytes = Vec::new();
        CommandOutput::Bytes(Vec::new())
            .write_human(&mut bytes)
            .expect("empty exact output");
        assert!(bytes.is_empty());

        CommandOutput::Bytes(b"body without lf".to_vec())
            .write_human(&mut bytes)
            .expect("nonempty exact output");
        assert_eq!(bytes, b"body without lf");

        let mut text = Vec::new();
        CommandOutput::Text("status".to_owned())
            .write_human(&mut text)
            .expect("line-oriented output");
        assert_eq!(text, b"status\n");
    }
}
