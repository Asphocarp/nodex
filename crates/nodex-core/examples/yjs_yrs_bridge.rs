use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{GetString, ReadTxn, Text, Transact, Update};

use nodex_core::document::{create_compatible_document, has_pending_dependencies};

#[derive(Serialize)]
struct DocumentSummary {
    title: String,
    body_xml: String,
    state_vector: Vec<u8>,
}

fn read_update(path: &Path) -> Result<Update, Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    Ok(Update::decode_v1(bytes.as_slice())?)
}

fn apply_update(document: &yrs::Doc, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let update = read_update(path)?;
    let mut transaction = document.transact_mut();
    transaction.apply_update(update)?;
    if has_pending_dependencies(&transaction) {
        return Err(format!("{} left unresolved dependencies", path.display()).into());
    }
    Ok(())
}

fn fixture_path(root: &Path, name: &str) -> PathBuf {
    root.join(name)
}

fn summarize(document: &yrs::Doc) -> DocumentSummary {
    let title = document.get_or_insert_text("title");
    let body = document.get_or_insert_xml_fragment("body");
    let transaction = document.transact();
    DocumentSummary {
        title: title.get_string(&transaction),
        body_xml: body.get_string(&transaction),
        state_vector: transaction.state_vector().encode_v1(),
    }
}

fn load_fixture(root: &Path) -> Result<yrs::Doc, Box<dyn std::error::Error>> {
    let document = create_compatible_document("nodex-yjs-yrs-conformance");
    for name in ["base.bin", "first.bin", "second.bin"] {
        apply_update(&document, &fixture_path(root, name))?;
    }
    Ok(document)
}

fn generate(
    fixture_root: &Path,
    output_update: &Path,
) -> Result<DocumentSummary, Box<dyn std::error::Error>> {
    let document = load_fixture(fixture_root)?;
    let before = document.transact().state_vector();
    let title = document.get_or_insert_text("title");
    let mut transaction = document.transact_mut();
    let end = title.len(&transaction);
    title.insert(&mut transaction, end, " · Rust");
    drop(transaction);
    let update = document.transact().encode_state_as_update_v1(&before);
    fs::write(output_update, update)?;
    Ok(summarize(&document))
}

fn inspect(
    fixture_root: &Path,
    rust_update: &Path,
    third_update: &Path,
) -> Result<DocumentSummary, Box<dyn std::error::Error>> {
    let document = load_fixture(fixture_root)?;
    apply_update(&document, rust_update)?;
    apply_update(&document, third_update)?;
    Ok(summarize(&document))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let summary = match args.as_slice() {
        [_, mode, fixture_root, output_update] if mode == "generate" => {
            generate(Path::new(fixture_root), Path::new(output_update))?
        }
        [_, mode, fixture_root, rust_update, third_update] if mode == "inspect" => inspect(
            Path::new(fixture_root),
            Path::new(rust_update),
            Path::new(third_update),
        )?,
        _ => {
            return Err(
                "usage: yjs_yrs_bridge generate <fixture-root> <output-update> | inspect <fixture-root> <rust-update> <third-update>"
                    .into(),
            );
        }
    };

    println!("{}", serde_json::to_string(&summary)?);
    Ok(())
}
