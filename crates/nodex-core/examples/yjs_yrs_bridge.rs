use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use yrs::sync::{Awareness, AwarenessUpdate};
use yrs::types::text::YChange;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Any, GetString, Out, ReadTxn, Text, Transact, Update, Xml, XmlFragment, XmlOut};

use nodex_core::document::{
    BlockDocumentSchema, create_compatible_document, decode_block_document, encode_block_document,
    has_pending_dependencies,
};

#[derive(Serialize)]
struct DocumentSummary {
    title: String,
    body_xml: String,
    body_semantic: Vec<XmlSemantic>,
    state_vector: Vec<u8>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum XmlSemantic {
    Element {
        name: String,
        attributes: BTreeMap<String, serde_json::Value>,
        children: Vec<XmlSemantic>,
    },
    Text {
        delta: Vec<TextDeltaSemantic>,
    },
}

#[derive(Serialize)]
struct TextDeltaSemantic {
    insert: serde_json::Value,
    attributes: BTreeMap<String, serde_json::Value>,
}

fn any_json(value: Any) -> serde_json::Value {
    match value {
        Any::Null => serde_json::Value::Null,
        Any::Undefined => serde_json::json!({ "$yrs": "undefined" }),
        Any::Bool(value) => serde_json::Value::Bool(value),
        Any::Number(value) => serde_json::json!(value),
        Any::BigInt(value) => serde_json::json!({ "$yrs": "bigint", "value": value.to_string() }),
        Any::String(value) => serde_json::Value::String(value.to_string()),
        Any::Buffer(value) => serde_json::json!({ "$yrs": "bytes", "value": value }),
        Any::Array(values) => {
            serde_json::Value::Array(values.iter().cloned().map(any_json).collect())
        }
        Any::Map(values) => serde_json::Value::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), any_json(value.clone())))
                .collect(),
        ),
    }
}

fn out_json<T: ReadTxn>(value: Out, transaction: &T) -> serde_json::Value {
    match value {
        Out::Any(any) => any_json(any),
        other => serde_json::Value::String(other.to_string(transaction)),
    }
}

fn semantic_node<T: ReadTxn>(node: XmlOut, transaction: &T) -> XmlSemantic {
    match node {
        XmlOut::Element(element) => XmlSemantic::Element {
            name: element.tag().to_string(),
            attributes: element
                .attributes(transaction)
                .map(|(key, value)| (key.to_owned(), out_json(value, transaction)))
                .collect(),
            children: element
                .children(transaction)
                .map(|child| semantic_node(child, transaction))
                .collect(),
        },
        XmlOut::Text(text) => XmlSemantic::Text {
            delta: text
                .diff(transaction, YChange::identity)
                .into_iter()
                .map(|chunk| TextDeltaSemantic {
                    insert: out_json(chunk.insert, transaction),
                    attributes: chunk
                        .attributes
                        .map(|attributes| {
                            attributes
                                .into_iter()
                                .map(|(key, value)| (key.to_string(), any_json(value)))
                                .collect()
                        })
                        .unwrap_or_default(),
                })
                .collect(),
        },
        XmlOut::Fragment(fragment) => XmlSemantic::Element {
            name: "#fragment".to_owned(),
            attributes: BTreeMap::new(),
            children: fragment
                .children(transaction)
                .map(|child| semantic_node(child, transaction))
                .collect(),
        },
    }
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
        body_semantic: body
            .children(&transaction)
            .map(|node| semantic_node(node, &transaction))
            .collect(),
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

fn load_matrix_fixture(root: &Path) -> Result<yrs::Doc, Box<dyn std::error::Error>> {
    let document = create_compatible_document("nodex-yjs-yrs-schema-matrix");
    apply_update(&document, &fixture_path(root, "matrix-base.bin"))?;
    Ok(document)
}

fn generate_for_document(
    document: yrs::Doc,
    output_update: &Path,
) -> Result<DocumentSummary, Box<dyn std::error::Error>> {
    let before = document.transact().state_vector();
    let title = document.get_or_insert_text("title");
    let body = document.get_or_insert_xml_fragment("body");
    let read_transaction = document.transact();
    let first_xml_text = body
        .successors(&read_transaction)
        .find_map(|node| match node {
            XmlOut::Text(text) => Some(text),
            _ => None,
        })
        .ok_or("fixture has no XML text node")?;
    drop(read_transaction);
    let mut transaction = document.transact_mut();
    let end = title.len(&transaction);
    title.insert(&mut transaction, end, " · Rust");
    let xml_end = first_xml_text.len(&transaction);
    first_xml_text.insert(&mut transaction, xml_end, " · Rust XML");
    drop(transaction);
    let update = document.transact().encode_state_as_update_v1(&before);
    fs::write(output_update, update)?;
    Ok(summarize(&document))
}

fn generate(
    fixture_root: &Path,
    output_update: &Path,
) -> Result<DocumentSummary, Box<dyn std::error::Error>> {
    generate_for_document(load_fixture(fixture_root)?, output_update)
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

fn generate_matrix(
    fixture_root: &Path,
    output_update: &Path,
) -> Result<DocumentSummary, Box<dyn std::error::Error>> {
    generate_for_document(load_matrix_fixture(fixture_root)?, output_update)
}

fn inspect_matrix(
    fixture_root: &Path,
    rust_update: &Path,
    third_update: &Path,
) -> Result<DocumentSummary, Box<dyn std::error::Error>> {
    let document = load_matrix_fixture(fixture_root)?;
    apply_update(&document, rust_update)?;
    apply_update(&document, third_update)?;
    Ok(summarize(&document))
}

fn roundtrip_matrix_block_tree(
    fixture_root: &Path,
    output_update: &Path,
) -> Result<DocumentSummary, Box<dyn std::error::Error>> {
    let source = load_matrix_fixture(fixture_root)?;
    let decoded = decode_block_document(&source, BlockDocumentSchema::PageV2)?;
    let target = encode_block_document(
        "nodex-yjs-yrs-matrix-block-tree-roundtrip",
        decoded.schema,
        decoded.title.as_deref(),
        &decoded.block_tree,
    )?;
    let update = target
        .transact()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    fs::write(output_update, update)?;
    Ok(summarize(&target))
}

#[derive(Serialize)]
struct AwarenessSummary {
    client_id: u64,
    state: serde_json::Value,
}

fn generate_awareness(
    input_update: &Path,
    output_update: &Path,
) -> Result<AwarenessSummary, Box<dyn std::error::Error>> {
    let update = AwarenessUpdate::decode_v1(fs::read(input_update)?.as_slice())?;
    let mut awareness = Awareness::new(create_compatible_document("nodex-awareness-rust"));
    awareness.apply_update(update)?;
    let state = serde_json::json!({
        "user": { "id": "rust-core", "name": "Rust Core 😀" },
        "cursor": { "anchor": 8, "head": 8 },
    });
    awareness.set_local_state(&state)?;
    fs::write(output_update, awareness.update()?.encode_v1())?;
    Ok(AwarenessSummary {
        client_id: awareness.client_id().get(),
        state,
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if let [_, mode, input_update, output_update] = args.as_slice()
        && mode == "awareness"
    {
        let summary = generate_awareness(Path::new(input_update), Path::new(output_update))?;
        println!("{}", serde_json::to_string(&summary)?);
        return Ok(());
    }

    let summary = match args.as_slice() {
        [_, mode, fixture_root, output_update] if mode == "generate" => {
            generate(Path::new(fixture_root), Path::new(output_update))?
        }
        [_, mode, fixture_root, output_update] if mode == "matrix-generate" => {
            generate_matrix(Path::new(fixture_root), Path::new(output_update))?
        }
        [_, mode, fixture_root, output_update] if mode == "matrix-block-tree-roundtrip" => {
            roundtrip_matrix_block_tree(Path::new(fixture_root), Path::new(output_update))?
        }
        [_, mode, fixture_root, rust_update, third_update] if mode == "inspect" => inspect(
            Path::new(fixture_root),
            Path::new(rust_update),
            Path::new(third_update),
        )?,
        [_, mode, fixture_root, rust_update, third_update] if mode == "matrix-inspect" => {
            inspect_matrix(
                Path::new(fixture_root),
                Path::new(rust_update),
                Path::new(third_update),
            )?
        }
        _ => {
            return Err(
                "usage: yjs_yrs_bridge generate|matrix-generate|matrix-block-tree-roundtrip <fixture-root> <output-update> | inspect|matrix-inspect <fixture-root> <rust-update> <third-update> | awareness <input-update> <output-update>"
                    .into(),
            );
        }
    };

    println!("{}", serde_json::to_string(&summary)?);
    Ok(())
}
