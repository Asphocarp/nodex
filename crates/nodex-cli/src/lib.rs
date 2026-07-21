#![forbid(unsafe_code)]

use std::ffi::OsString;

use clap::Parser;

pub mod cli;
pub mod error;
pub mod meta_yaml;
mod page_lifecycle;
mod page_mutation;
pub mod patch;
mod ripgrep;
pub mod runtime;
pub mod sed;

use cli::Cli;
use error::{CliError, CliErrorCode};

pub const EXIT_SUCCESS: i32 = 0;
pub const EXIT_NO_MATCHES: i32 = 1;
pub const EXIT_REJECTED: i32 = 2;
pub const EXIT_INTERRUPTED: i32 = 130;

pub fn run(arguments: impl IntoIterator<Item = OsString>) -> i32 {
    let arguments = arguments.into_iter().collect::<Vec<_>>();
    let json_requested = arguments.iter().any(|argument| argument == "--json");
    let help_requested = arguments
        .iter()
        .any(|argument| argument == "--help" || argument == "-h");

    if json_requested && help_requested {
        return print_machine_help(&arguments);
    }

    let cli = match Cli::try_parse_from(arguments) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return EXIT_REJECTED;
        }
    };

    let json = cli.json;
    match runtime::execute(cli) {
        Ok(output) => {
            let exit_status = output.exit_status();
            match output.write(json) {
                Ok(()) => exit_status,
                Err(error) => {
                    render_error(&error, json);
                    EXIT_REJECTED
                }
            }
        }
        Err(error) => {
            render_error(&error, json);
            EXIT_REJECTED
        }
    }
}

fn print_machine_help(arguments: &[OsString]) -> i32 {
    let command_path = cli::machine_help_command_path(arguments);
    let document = cli::machine_help(&command_path);
    match serde_json::to_string_pretty(&document) {
        Ok(json) => {
            println!("{json}");
            EXIT_SUCCESS
        }
        Err(error) => {
            render_error(
                &CliError::new(
                    CliErrorCode::Internal,
                    format!("machine-readable help could not be encoded: {error}"),
                ),
                true,
            );
            EXIT_REJECTED
        }
    }
}

pub fn render_error(error: &CliError, json: bool) {
    if json {
        let envelope = error::ErrorEnvelope::new(error);
        match serde_json::to_string(&envelope) {
            Ok(encoded) => eprintln!("{encoded}"),
            Err(_) => eprintln!("CLI_INTERNAL: failed to encode error"),
        }
        return;
    }

    eprintln!("{}: {}", error.code.as_str(), error.message);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_exit_statuses_match_the_shell_contract() {
        assert_eq!(EXIT_SUCCESS, 0);
        assert_eq!(EXIT_NO_MATCHES, 1);
        assert_eq!(EXIT_REJECTED, 2);
        assert_eq!(EXIT_INTERRUPTED, 130);
    }
}
