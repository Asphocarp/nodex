#![forbid(unsafe_code)]

fn main() {
    std::process::exit(nodex_cli::run(std::env::args_os()));
}
