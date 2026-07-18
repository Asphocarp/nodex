use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use thiserror::Error;

use super::block_tree::{BlockNode, BlockTree, PortableValue, TextDelta, XmlElementNode, XmlNode};

const INLINE_BLOCK_TYPES: &[&str] = &[
    "paragraph",
    "heading",
    "bulletListItem",
    "numberedListItem",
    "checkListItem",
    "toggleListItem",
    "codeBlock",
    "quote",
    "callout",
    "cardToggle",
];
const NONE_BLOCK_TYPES: &[&str] = &[
    "divider",
    "image",
    "threadSection",
    "toggleListInlineView",
    "page",
    "database",
    "pageRef",
    "databaseViewRef",
    "syncedBlockRef",
    "templateRef",
];
const INLINE_STYLE_NAMES: &[&str] = &[
    "bold",
    "italic",
    "strike",
    "underline",
    "code",
    "textColor",
    "backgroundColor",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MaterializedBlockNode {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub props: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    pub children: Vec<MaterializedBlockNode>,
}

#[derive(Debug, Error, PartialEq)]
pub enum BlockMaterializationError {
    #[error("Block {block_id} uses unsupported content model {block_type}")]
    UnsupportedBlockType {
        block_id: String,
        block_type: String,
    },
    #[error("Block {block_id} has invalid {field}: {message}")]
    InvalidContent {
        block_id: String,
        field: String,
        message: String,
    },
    #[error("portable binary values cannot enter JSON materialization")]
    BinaryValue,
    #[error("portable number cannot enter JSON materialization")]
    InvalidNumber,
}

pub fn materialize_block_tree(
    tree: &BlockTree,
) -> Result<Vec<MaterializedBlockNode>, BlockMaterializationError> {
    tree.blocks.iter().map(materialize_block).collect()
}

fn materialize_block(
    block: &BlockNode,
) -> Result<MaterializedBlockNode, BlockMaterializationError> {
    let block_type = block.content.name.clone();
    let props = materialize_attributes(&block.content.attributes)?;
    let content = if INLINE_BLOCK_TYPES.contains(&block_type.as_str()) {
        Some(Value::Array(materialize_inline_content(
            &block.content.children,
            &block.id,
        )?))
    } else if block_type == "table" {
        Some(materialize_table(&block.content, &block.id)?)
    } else if NONE_BLOCK_TYPES.contains(&block_type.as_str()) {
        if !block.content.children.is_empty() {
            return Err(invalid_content(
                block,
                "content",
                "childless content element contains XML children",
            ));
        }
        None
    } else {
        return Err(BlockMaterializationError::UnsupportedBlockType {
            block_id: block.id.clone(),
            block_type,
        });
    };
    let children = block
        .children
        .iter()
        .map(materialize_block)
        .collect::<Result<_, _>>()?;

    Ok(MaterializedBlockNode {
        id: block.id.clone(),
        block_type: block.content.name.clone(),
        props,
        content,
        children,
    })
}

fn materialize_inline_content(
    nodes: &[XmlNode],
    block_id: &str,
) -> Result<Vec<Value>, BlockMaterializationError> {
    let mut content = Vec::new();
    for node in nodes {
        match node {
            XmlNode::Text { delta } => {
                for chunk in delta {
                    content.push(materialize_text_chunk(chunk, block_id)?);
                }
            }
            XmlNode::Element(element) => {
                if !element.children.is_empty() {
                    return Err(BlockMaterializationError::InvalidContent {
                        block_id: block_id.to_owned(),
                        field: element.name.clone(),
                        message: "inline atom contains XML children".to_owned(),
                    });
                }
                let mut atom = Map::new();
                atom.insert("type".to_owned(), Value::String(element.name.clone()));
                atom.insert(
                    "props".to_owned(),
                    Value::Object(
                        materialize_attributes(&element.attributes)?
                            .into_iter()
                            .collect(),
                    ),
                );
                content.push(Value::Object(atom));
            }
        }
    }
    Ok(content)
}

fn materialize_text_chunk(
    chunk: &TextDelta,
    block_id: &str,
) -> Result<Value, BlockMaterializationError> {
    let mut styles = Map::new();
    let mut link = None;
    for (key, value) in &chunk.attributes {
        if key == "link" {
            let PortableValue::Object(link_attributes) = value else {
                return Err(BlockMaterializationError::InvalidContent {
                    block_id: block_id.to_owned(),
                    field: "link".to_owned(),
                    message: "link mark must be an object".to_owned(),
                });
            };
            let Some(PortableValue::String(href)) = link_attributes.get("href") else {
                return Err(BlockMaterializationError::InvalidContent {
                    block_id: block_id.to_owned(),
                    field: "link.href".to_owned(),
                    message: "link mark must contain a string href".to_owned(),
                });
            };
            link = Some(href.clone());
            continue;
        }
        if !INLINE_STYLE_NAMES.contains(&key.as_str()) {
            return Err(BlockMaterializationError::InvalidContent {
                block_id: block_id.to_owned(),
                field: key.clone(),
                message: "unsupported inline mark".to_owned(),
            });
        }
        let style = match value {
            PortableValue::Object(value) if value.is_empty() => Value::Bool(true),
            value => portable_value_to_json(value, false)?.unwrap_or(Value::Null),
        };
        styles.insert(key.clone(), style);
    }

    let text = Value::Object(Map::from_iter([
        ("type".to_owned(), Value::String("text".to_owned())),
        ("text".to_owned(), Value::String(chunk.insert.clone())),
        ("styles".to_owned(), Value::Object(styles)),
    ]));
    let Some(href) = link else {
        return Ok(text);
    };
    Ok(Value::Object(Map::from_iter([
        ("type".to_owned(), Value::String("link".to_owned())),
        ("href".to_owned(), Value::String(href)),
        ("content".to_owned(), Value::Array(vec![text])),
    ])))
}

fn materialize_table(
    table: &XmlElementNode,
    block_id: &str,
) -> Result<Value, BlockMaterializationError> {
    let mut rows = Vec::new();
    let mut column_widths = Vec::new();
    for (row_index, row_node) in table.children.iter().enumerate() {
        let XmlNode::Element(row) = row_node else {
            return Err(table_error(
                block_id,
                "table must contain tableRow elements",
            ));
        };
        if row.name != "tableRow" {
            return Err(table_error(
                block_id,
                format!("expected tableRow, found {}", row.name),
            ));
        }
        let mut cells = Vec::new();
        for cell_node in &row.children {
            let XmlNode::Element(cell) = cell_node else {
                return Err(table_error(
                    block_id,
                    "tableRow must contain tableCell elements",
                ));
            };
            if cell.name != "tableCell" {
                return Err(table_error(
                    block_id,
                    format!("expected tableCell, found {}", cell.name),
                ));
            }
            if row_index == 0 {
                append_column_widths(&mut column_widths, cell)?;
            }
            let paragraphs = cell
                .children
                .iter()
                .map(|node| {
                    let XmlNode::Element(paragraph) = node else {
                        return Err(table_error(
                            block_id,
                            "tableCell must contain tableParagraph elements",
                        ));
                    };
                    if paragraph.name != "tableParagraph" {
                        return Err(table_error(
                            block_id,
                            format!("expected tableParagraph, found {}", paragraph.name),
                        ));
                    }
                    materialize_inline_content(&paragraph.children, block_id)
                })
                .collect::<Result<Vec<_>, _>>()?;
            let content = paragraphs.into_iter().flatten().collect();
            let mut props = materialize_attributes(&cell.attributes)?;
            props.remove("colwidth");
            cells.push(Value::Object(Map::from_iter([
                ("type".to_owned(), Value::String("tableCell".to_owned())),
                ("content".to_owned(), Value::Array(content)),
                (
                    "props".to_owned(),
                    Value::Object(props.into_iter().collect()),
                ),
            ])));
        }
        rows.push(Value::Object(Map::from_iter([(
            "cells".to_owned(),
            Value::Array(cells),
        )])));
    }
    Ok(Value::Object(Map::from_iter([
        ("type".to_owned(), Value::String("tableContent".to_owned())),
        ("columnWidths".to_owned(), Value::Array(column_widths)),
        ("rows".to_owned(), Value::Array(rows)),
    ])))
}

fn append_column_widths(
    output: &mut Vec<Value>,
    cell: &XmlElementNode,
) -> Result<(), BlockMaterializationError> {
    let colspan = match cell.attributes.get("colspan") {
        Some(PortableValue::Number(value)) if value.fract() == 0.0 && *value > 0.0 => {
            *value as usize
        }
        None | Some(PortableValue::Undefined) => 1,
        _ => {
            return Err(table_error(
                "unknown",
                "tableCell colspan must be a positive integer",
            ));
        }
    };
    let widths = match cell.attributes.get("colwidth") {
        Some(PortableValue::Array(values)) => values
            .iter()
            .map(|value| {
                portable_value_to_json(value, true).map(|value| value.unwrap_or(Value::Null))
            })
            .collect::<Result<Vec<_>, _>>()?,
        None | Some(PortableValue::Undefined) => Vec::new(),
        _ => {
            return Err(table_error(
                "unknown",
                "tableCell colwidth must be an array",
            ));
        }
    };
    for index in 0..colspan {
        output.push(widths.get(index).cloned().unwrap_or(Value::Null));
    }
    Ok(())
}

fn materialize_attributes(
    attributes: &BTreeMap<String, PortableValue>,
) -> Result<BTreeMap<String, Value>, BlockMaterializationError> {
    attributes
        .iter()
        .filter_map(|(key, value)| match portable_value_to_json(value, false) {
            Ok(Some(value)) => Some(Ok((key.clone(), value))),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

fn portable_value_to_json(
    value: &PortableValue,
    array_entry: bool,
) -> Result<Option<Value>, BlockMaterializationError> {
    match value {
        PortableValue::Undefined if array_entry => Ok(Some(Value::Null)),
        PortableValue::Undefined => Ok(None),
        PortableValue::Null => Ok(Some(Value::Null)),
        PortableValue::Boolean(value) => Ok(Some(Value::Bool(*value))),
        PortableValue::Number(value)
            if value.fract() == 0.0 && *value >= i64::MIN as f64 && *value <= i64::MAX as f64 =>
        {
            Ok(Some(Value::Number(Number::from(*value as i64))))
        }
        PortableValue::Number(value) => Number::from_f64(*value)
            .map(Value::Number)
            .map(Some)
            .ok_or(BlockMaterializationError::InvalidNumber),
        PortableValue::String(value) => Ok(Some(Value::String(value.clone()))),
        PortableValue::Binary(_) => Err(BlockMaterializationError::BinaryValue),
        PortableValue::Array(values) => values
            .iter()
            .map(|value| {
                portable_value_to_json(value, true).map(|value| value.unwrap_or(Value::Null))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array)
            .map(Some),
        PortableValue::Object(values) => values
            .iter()
            .filter_map(|(key, value)| match portable_value_to_json(value, false) {
                Ok(Some(value)) => Some(Ok((key.clone(), value))),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            })
            .collect::<Result<Map<_, _>, _>>()
            .map(Value::Object)
            .map(Some),
    }
}

fn invalid_content(
    block: &BlockNode,
    field: &str,
    message: impl Into<String>,
) -> BlockMaterializationError {
    BlockMaterializationError::InvalidContent {
        block_id: block.id.clone(),
        field: field.to_owned(),
        message: message.into(),
    }
}

fn table_error(
    block_id: impl Into<String>,
    message: impl Into<String>,
) -> BlockMaterializationError {
    BlockMaterializationError::InvalidContent {
        block_id: block_id.into(),
        field: "table".to_owned(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use yrs::updates::decoder::Decode;
    use yrs::{ReadTxn, Transact, Update};

    use crate::document::create_compatible_document;
    use crate::domain::block_tree::decode_block_tree;

    use super::*;

    #[test]
    fn matches_the_typescript_blocknote_schema_matrix() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/yjs-yrs");
        let document = create_compatible_document("materialization-matrix");
        let update = std::fs::read(root.join("matrix-base.bin")).expect("matrix fixture");
        document
            .transact_mut()
            .apply_update(Update::decode_v1(&update).expect("valid fixture"))
            .expect("fixture applies");
        let transaction = document.transact();
        let body = transaction.get_xml_fragment("body").expect("body root");
        let tree = decode_block_tree(&body, &transaction).expect("BlockTree");
        let actual = serde_json::to_value(materialize_block_tree(&tree).expect("materialization"))
            .expect("serialize materialization");
        let expected: Value = serde_json::from_slice(
            &std::fs::read(root.join("matrix-materialization.json")).expect("oracle fixture"),
        )
        .expect("valid oracle fixture");

        assert_eq!(actual, expected["blockTree"]);
    }
}
