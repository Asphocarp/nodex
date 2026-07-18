#![forbid(unsafe_code)]

use std::{env, path::PathBuf};

fn parse_home() -> Result<PathBuf, String> {
    let args = env::args().collect::<Vec<_>>();
    match args.as_slice() {
        [_, flag, home] if flag == "--home" => Ok(PathBuf::from(home)),
        _ => Err("usage: nodex-core --home <absolute-home>".to_owned()),
    }
}

#[tokio::main]
async fn main() {
    let home = match parse_home() {
        Ok(home) => home,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };
    if let Err(error) = nodex_core_server::run(home).await {
        eprintln!("nodex-core startup failed: {error}");
        std::process::exit(1);
    }
}
