use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::Serialize;

#[derive(Clone, Debug, Parser, PartialEq)]
#[command(
    name = "nodex",
    version,
    about = "Read and change Nodex through the native Core",
    arg_required_else_help = true
)]
pub struct Cli {
    #[arg(long, global = true, value_name = "NAME_OR_ID")]
    pub profile: Option<String>,
    #[arg(long, global = true, value_name = "UUID_OR_UNIQUE_NAME")]
    pub project: Option<String>,
    #[arg(long, global = true, value_name = "UUID_OR_UNIQUE_NAME")]
    pub database: Option<String>,
    #[arg(long, global = true, value_name = "ID_OR_TITLE_PATH")]
    pub page: Option<String>,
    #[arg(long, global = true)]
    pub json: bool,
    #[arg(long, global = true)]
    pub no_color: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Clone, Debug, PartialEq, Subcommand)]
pub enum Command {
    Context,
    Tree {
        #[arg(value_name = "SCOPE_SELECTOR")]
        scope: Option<String>,
    },
    Read(ReadArgs),
    Sed(SedArgs),
    Rg(RgArgs),
    Patch(PatchArgs),
    Page(PageArgs),
    Block(BlockArgs),
    History(HistoryArgs),
    Backup(BackupArgs),
    Doctor(DoctorArgs),
    Draft(DraftArgs),
    Service(ServiceArgs),
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct ReadArgs {
    #[arg(value_name = "PAGE_SELECTOR")]
    pub page: String,
    #[arg(long)]
    pub meta: bool,
    #[arg(long, value_enum)]
    pub prepare: Option<PrepareKind>,
}

#[derive(Clone, Copy, Debug, PartialEq, ValueEnum)]
pub enum PrepareKind {
    #[value(name = "title.set")]
    TitleSet,
    #[value(name = "document.replace")]
    DocumentReplace,
    #[value(name = "page.delete")]
    PageDelete,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct SedArgs {
    #[arg(short = 'n', action = clap::ArgAction::SetTrue, required = true)]
    pub quiet: bool,
    #[arg(value_name = "PROGRAM")]
    pub program: String,
    #[arg(value_name = "PAGE_SELECTOR")]
    pub page: String,
}

#[derive(Clone, Debug, Args, PartialEq)]
#[command(trailing_var_arg = true)]
pub struct RgArgs {
    #[arg(value_name = "RG_ARGUMENT", num_args = 1.., allow_hyphen_values = true)]
    pub arguments: Vec<OsString>,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PatchArgs {
    #[arg(long, value_name = "PATCH_FILE")]
    pub file: Option<PathBuf>,
    #[arg(long)]
    pub idempotency_key: Option<String>,
    #[arg(long, value_delimiter = ',')]
    pub r#return: Vec<String>,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageArgs {
    #[command(subcommand)]
    pub command: PageCommand,
}

#[derive(Clone, Debug, PartialEq, Subcommand)]
pub enum PageCommand {
    Create(PageCreateArgs),
    Insert(PageInsertArgs),
    Replace(PageReplaceArgs),
    Title(PageTitleArgs),
    Move(PageTransferArgs),
    Duplicate(PageTransferArgs),
    Delete(PageDeleteArgs),
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageCreateArgs {
    #[arg(long)]
    pub parent: String,
    #[arg(long)]
    pub title: String,
    #[command(flatten)]
    pub content: BodyInputArgs,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageInsertArgs {
    pub page: String,
    #[arg(long)]
    pub at: String,
    #[arg(long)]
    pub file: Option<PathBuf>,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageReplaceArgs {
    pub page: String,
    #[arg(long = "if-match")]
    pub if_match: String,
    #[arg(long)]
    pub file: Option<PathBuf>,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageTitleArgs {
    #[command(subcommand)]
    pub command: PageTitleCommand,
}

#[derive(Clone, Debug, PartialEq, Subcommand)]
pub enum PageTitleCommand {
    Set(PageTitleSetArgs),
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageTitleSetArgs {
    pub page: String,
    #[arg(long = "if-match")]
    pub if_match: String,
    #[arg(long, required_unless_present = "file", conflicts_with = "file")]
    pub value: Option<String>,
    #[arg(long, required_unless_present = "value", conflicts_with = "value")]
    pub file: Option<PathBuf>,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageTransferArgs {
    pub page: String,
    #[arg(long)]
    pub to: String,
    #[arg(long, conflicts_with_all = ["before", "after"])]
    pub at: Option<BoundaryPlacement>,
    #[arg(long, conflicts_with_all = ["at", "after"])]
    pub before: Option<String>,
    #[arg(long, conflicts_with_all = ["at", "before"])]
    pub after: Option<String>,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Copy, Debug, PartialEq, ValueEnum)]
pub enum BoundaryPlacement {
    Start,
    End,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct PageDeleteArgs {
    pub page: String,
    #[arg(long = "if-match")]
    pub if_match: String,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
#[group(multiple = false)]
pub struct BodyInputArgs {
    #[arg(long)]
    pub file: Option<PathBuf>,
    #[arg(long)]
    pub empty: bool,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct MutationArgs {
    #[arg(long)]
    pub idempotency_key: Option<String>,
    #[arg(long, value_delimiter = ',')]
    pub r#return: Vec<String>,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct BlockArgs {
    #[command(subcommand)]
    pub command: BlockCommand,
}

#[derive(Clone, Debug, PartialEq, Subcommand)]
pub enum BlockCommand {
    Insert(BlockInsertArgs),
    Update(BlockUpdateArgs),
    Move(BlockMoveArgs),
    Delete(BlockDeleteArgs),
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct BlockInsertArgs {
    pub page: String,
    #[arg(long)]
    pub at: String,
    #[arg(long)]
    pub block_json: PathBuf,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct BlockUpdateArgs {
    pub page: String,
    #[arg(long)]
    pub block: String,
    #[arg(long = "if-match")]
    pub if_match: String,
    #[arg(long)]
    pub patch_json: PathBuf,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct BlockMoveArgs {
    pub page: String,
    #[arg(long)]
    pub block: String,
    #[arg(long)]
    pub at: String,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct BlockDeleteArgs {
    pub page: String,
    #[arg(long)]
    pub block: String,
    #[arg(long = "if-match")]
    pub if_match: String,
    #[command(flatten)]
    pub mutation: MutationArgs,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct HistoryArgs {
    pub page: String,
    #[arg(long)]
    pub before: Option<String>,
    #[arg(long)]
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct BackupArgs {
    #[command(subcommand)]
    pub command: BackupCommand,
}

#[derive(Clone, Debug, PartialEq, Subcommand)]
pub enum BackupCommand {
    Create {
        #[arg(long)]
        label: Option<String>,
        #[command(flatten)]
        mutation: MutationArgs,
    },
    List,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct DoctorArgs {
    #[arg(long)]
    pub full: bool,
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct DraftArgs {
    #[command(subcommand)]
    pub command: DraftCommand,
}

#[derive(Clone, Debug, PartialEq, Subcommand)]
pub enum DraftCommand {
    Create {
        page: String,
        #[arg(long)]
        output: PathBuf,
    },
    Diff {
        directory: PathBuf,
    },
    Apply {
        directory: PathBuf,
    },
    Discard {
        directory: PathBuf,
    },
}

#[derive(Clone, Debug, Args, PartialEq)]
pub struct ServiceArgs {
    #[command(subcommand)]
    pub command: ServiceCommand,
}

#[derive(Clone, Copy, Debug, PartialEq, Subcommand)]
pub enum ServiceCommand {
    Status,
    Enable,
    Disable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MachineHelp {
    pub version: u32,
    pub command: String,
    pub effect: &'static str,
    pub validators: Vec<&'static str>,
    pub result: &'static str,
    pub examples: Vec<&'static str>,
}

pub fn machine_help_command_path(arguments: &[OsString]) -> Vec<String> {
    let mut path = Vec::new();
    let mut skip_value = false;
    for argument in arguments.iter().skip(1) {
        let Some(argument) = argument.to_str() else {
            continue;
        };
        if skip_value {
            skip_value = false;
            continue;
        }
        if matches!(
            argument,
            "--profile" | "--project" | "--database" | "--page"
        ) {
            skip_value = true;
            continue;
        }
        if matches!(argument, "--json" | "--no-color" | "--help" | "-h") {
            continue;
        }
        if argument.starts_with('-') {
            continue;
        }
        path.push(argument.to_owned());
        if path.len() == 3 {
            break;
        }
    }
    path
}

pub fn machine_help(path: &[String]) -> MachineHelp {
    let command = if path.is_empty() {
        "nodex".to_owned()
    } else {
        format!("nodex {}", path.join(" "))
    };
    let mutation = path.first().is_some_and(|name| {
        matches!(
            name.as_str(),
            "patch" | "page" | "block" | "draft" | "backup"
        )
    });
    MachineHelp {
        version: 1,
        command,
        effect: if mutation {
            "mutation_or_local_write"
        } else {
            "read"
        },
        validators: if mutation {
            vec![
                "idempotency_key_when_remote",
                "narrow_etag_when_destructive",
            ]
        } else {
            Vec::new()
        },
        result: if mutation {
            "compact_receipt_with_affected_ids_and_etags"
        } else {
            "requested_projection_only"
        },
        examples: vec!["nodex read @<page-id>", "nodex patch --file ./change.patch"],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_global_scope_and_nested_page_command() {
        let cli = Cli::try_parse_from([
            "nodex",
            "--project",
            "Docs",
            "--json",
            "page",
            "title",
            "set",
            "@page_1",
            "--if-match",
            "title-etag",
            "--value",
            "New **title**",
            "--idempotency-key",
            "operation-1",
        ])
        .expect("valid command");

        assert_eq!(cli.project.as_deref(), Some("Docs"));
        assert!(cli.json);
        let Command::Page(PageArgs {
            command:
                PageCommand::Title(PageTitleArgs {
                    command: PageTitleCommand::Set(command),
                }),
        }) = cli.command
        else {
            panic!("expected title set command")
        };
        assert_eq!(command.page, "@page_1");
        assert_eq!(command.value.as_deref(), Some("New **title**"));
        assert_eq!(
            command.mutation.idempotency_key.as_deref(),
            Some("operation-1")
        );
    }

    #[test]
    fn rg_preserves_hyphenated_arguments_for_policy_validation() {
        let cli = Cli::try_parse_from([
            "nodex",
            "rg",
            "--glob",
            "*.nested.md",
            "--fixed-strings",
            "Core starts",
            "@scope",
        ])
        .expect("rg command");
        let Command::Rg(arguments) = cli.command else {
            panic!("expected rg command")
        };
        assert_eq!(
            arguments.arguments,
            [
                "--glob",
                "*.nested.md",
                "--fixed-strings",
                "Core starts",
                "@scope"
            ]
            .map(OsString::from)
        );
    }

    #[test]
    fn destructive_commands_require_narrow_etags() {
        let error = Cli::try_parse_from(["nodex", "page", "delete", "@page_1"])
            .expect_err("delete without ETag must fail");
        assert_eq!(
            error.kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );
    }

    #[test]
    fn machine_help_is_versioned_and_effect_aware() {
        let help = machine_help(&["page".into(), "delete".into()]);
        assert_eq!(help.version, 1);
        assert_eq!(help.command, "nodex page delete");
        assert_eq!(help.effect, "mutation_or_local_write");
        assert!(help.validators.contains(&"narrow_etag_when_destructive"));
    }
}
