use std::io::{self, BufRead, Write};

use super::target::SkillAgent;
use crate::error::{CliError, CliErrorCode};

pub fn select_agents() -> Result<Vec<SkillAgent>, CliError> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    select_agents_with(&mut reader, &mut writer)
}

pub fn confirm_install(agents: &[SkillAgent]) -> Result<bool, CliError> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let labels = agents
        .iter()
        .map(|agent| match agent {
            SkillAgent::Codex => "Codex",
            SkillAgent::ClaudeCode => "Claude Code",
        })
        .collect::<Vec<_>>()
        .join(" and ");
    confirm_with(
        &mut reader,
        &mut writer,
        &format!("Install the official Nodex Skill globally for {labels}? [y/N] "),
    )
}

pub fn confirm_remove(agents: &[SkillAgent]) -> Result<bool, CliError> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let labels = agents
        .iter()
        .map(|agent| match agent {
            SkillAgent::Codex => "Codex",
            SkillAgent::ClaudeCode => "Claude Code",
        })
        .collect::<Vec<_>>()
        .join(" and ");
    confirm_with(
        &mut reader,
        &mut writer,
        &format!("Remove Nodex-managed global Skill links for {labels}? [y/N] "),
    )
}

fn select_agents_with(
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<Vec<SkillAgent>, CliError> {
    writer
        .write_all(
            b"Set up the official Nodex Skill globally:\n\
              1) Codex + Claude Code\n\
              2) Codex only\n\
              3) Claude Code only\n\
              4) Not now\n\
              Choice [1-4]: ",
        )
        .map_err(internal)?;
    writer.flush().map_err(internal)?;
    let mut response = String::new();
    reader.read_line(&mut response).map_err(internal)?;
    match response.trim() {
        "1" => Ok(SkillAgent::ALL.to_vec()),
        "2" => Ok(vec![SkillAgent::Codex]),
        "3" => Ok(vec![SkillAgent::ClaudeCode]),
        "4" | "" => Ok(Vec::new()),
        _ => Err(CliError::new(
            CliErrorCode::InvalidInput,
            "expected Agent choice 1, 2, 3, or 4",
        )),
    }
}

fn confirm_with(
    reader: &mut impl BufRead,
    writer: &mut impl Write,
    prompt: &str,
) -> Result<bool, CliError> {
    writer.write_all(prompt.as_bytes()).map_err(internal)?;
    writer.flush().map_err(internal)?;
    let mut response = String::new();
    reader.read_line(&mut response).map_err(internal)?;
    Ok(matches!(
        response.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}

fn internal(error: impl std::fmt::Display) -> CliError {
    CliError::new(CliErrorCode::Internal, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_line_prompt_selects_agents_without_terminal_dependencies() {
        let mut output = Vec::new();
        assert_eq!(
            select_agents_with(&mut "1\n".as_bytes(), &mut output).expect("selection"),
            SkillAgent::ALL
        );
        assert!(
            String::from_utf8(output)
                .expect("UTF-8")
                .contains("Codex + Claude Code")
        );
    }

    #[test]
    fn confirmation_defaults_to_no() {
        let mut output = Vec::new();
        assert!(!confirm_with(&mut "\n".as_bytes(), &mut output, "Continue? ").expect("confirm"));
        assert!(confirm_with(&mut "yes\n".as_bytes(), &mut output, "Continue? ").expect("confirm"));
    }
}
