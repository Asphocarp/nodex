#![forbid(unsafe_code)]

use std::{env, fs, path::PathBuf};

fn parse_outputs() -> Result<(PathBuf, PathBuf), String> {
    let args = env::args().collect::<Vec<_>>();
    match args.as_slice() {
        [_, openapi_flag, openapi, requirements_flag, requirements]
            if openapi_flag == "--output" && requirements_flag == "--requirements-output" =>
        {
            Ok((PathBuf::from(openapi), PathBuf::from(requirements)))
        }
        _ => Err("usage: generate-openapi --output <path> --requirements-output <path>".to_owned()),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (output, requirements_output) = parse_outputs().map_err(std::io::Error::other)?;
    let mut bytes = serde_json::to_string_pretty(&nodex_core_protocol::openapi())?.into_bytes();
    bytes.push(b'\n');
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, bytes)?;
    let requirements =
        serde_json::to_string_pretty(&nodex_core_protocol::core_client_requirements())?;
    let source = format!(
        "import type {{ components }} from \"./generated\";\n\nexport const CORE_CLIENT_REQUIREMENTS = {requirements} as const satisfies components[\"schemas\"][\"CoreClientRequirements\"];\n"
    );
    if let Some(parent) = requirements_output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(requirements_output, source)?;
    Ok(())
}
