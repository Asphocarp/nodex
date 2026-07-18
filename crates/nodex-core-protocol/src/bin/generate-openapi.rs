#![forbid(unsafe_code)]

use std::{env, fs, path::PathBuf};

fn parse_output() -> Result<PathBuf, String> {
    let args = env::args().collect::<Vec<_>>();
    match args.as_slice() {
        [_, flag, output] if flag == "--output" => Ok(PathBuf::from(output)),
        _ => Err("usage: generate-openapi --output <path>".to_owned()),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = parse_output().map_err(std::io::Error::other)?;
    let mut bytes = serde_json::to_string_pretty(&nodex_core_protocol::openapi())?.into_bytes();
    bytes.push(b'\n');
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, bytes)?;
    Ok(())
}
