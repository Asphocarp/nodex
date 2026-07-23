use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use thiserror::Error;

use super::block_tree::{
    BLOCK_ID_ATTRIBUTE, BlockNode, BlockTree, PortableValue, TextDelta, XmlElementNode, XmlNode,
    validate_block_tree,
};

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
    #[error("materialized Block tree is not canonical: {0}")]
    InvalidTree(String),
}

pub fn materialize_block_tree(
    tree: &BlockTree,
) -> Result<Vec<MaterializedBlockNode>, BlockMaterializationError> {
    tree.blocks.iter().map(materialize_block).collect()
}

/// Convert the transport-safe BlockNote projection back into the canonical,
/// engine-neutral XML model. This is the only inverse used by semantic writes;
/// callers never need to construct Yrs XML vocabulary themselves.
pub fn dematerialize_block_tree(
    blocks: &[MaterializedBlockNode],
) -> Result<BlockTree, BlockMaterializationError> {
    let tree = BlockTree {
        root_attributes: BTreeMap::new(),
        blocks: blocks
            .iter()
            .map(dematerialize_block)
            .collect::<Result<_, _>>()?,
    };
    let issues = validate_block_tree(&tree);
    if issues.is_empty() {
        return Ok(tree);
    }
    Err(BlockMaterializationError::InvalidTree(format!(
        "{issues:?}"
    )))
}

fn dematerialize_block(
    block: &MaterializedBlockNode,
) -> Result<BlockNode, BlockMaterializationError> {
    let attributes = block
        .props
        .iter()
        .map(|(key, value)| json_to_portable_value(value).map(|value| (key.clone(), value)))
        .collect::<Result<_, _>>()?;
    let children = match block.block_type.as_str() {
        block_type if INLINE_BLOCK_TYPES.contains(&block_type) => {
            dematerialize_inline_content(require_content_array(block)?, &block.id)?
        }
        "table" => dematerialize_table(block)?,
        block_type if NONE_BLOCK_TYPES.contains(&block_type) => {
            if block.content.is_some() {
                return Err(invalid_materialized_content(
                    block,
                    "content",
                    "childless Block content must be absent",
                ));
            }
            Vec::new()
        }
        _ => {
            return Err(BlockMaterializationError::UnsupportedBlockType {
                block_id: block.id.clone(),
                block_type: block.block_type.clone(),
            });
        }
    };
    let nested = block
        .children
        .iter()
        .map(dematerialize_block)
        .collect::<Result<_, _>>()?;

    Ok(BlockNode {
        id: block.id.clone(),
        container_attributes: [(
            BLOCK_ID_ATTRIBUTE.to_owned(),
            PortableValue::String(block.id.clone()),
        )]
        .into_iter()
        .collect(),
        content: XmlElementNode {
            name: block.block_type.clone(),
            attributes,
            children,
        },
        children: nested,
    })
}

fn require_content_array(
    block: &MaterializedBlockNode,
) -> Result<&[Value], BlockMaterializationError> {
    match block.content.as_ref() {
        Some(Value::Array(content)) => Ok(content),
        _ => Err(invalid_materialized_content(
            block,
            "content",
            "inline content must be an array",
        )),
    }
}

fn dematerialize_inline_content(
    content: &[Value],
    block_id: &str,
) -> Result<Vec<XmlNode>, BlockMaterializationError> {
    let mut output = Vec::new();
    for (index, value) in content.iter().enumerate() {
        let object = value.as_object().ok_or_else(|| {
            invalid_materialized_field(
                block_id,
                format!("content[{index}]"),
                "inline item must be an object",
            )
        })?;
        let item_type = object.get("type").and_then(Value::as_str).ok_or_else(|| {
            invalid_materialized_field(
                block_id,
                format!("content[{index}].type"),
                "inline item type must be a string",
            )
        })?;
        match item_type {
            "text" => output.push(XmlNode::Text {
                delta: vec![dematerialize_text_item(object, block_id, index, None)?],
            }),
            "link" => {
                let href = object.get("href").and_then(Value::as_str).ok_or_else(|| {
                    invalid_materialized_field(
                        block_id,
                        format!("content[{index}].href"),
                        "link href must be a string",
                    )
                })?;
                let linked = object
                    .get("content")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        invalid_materialized_field(
                            block_id,
                            format!("content[{index}].content"),
                            "link content must be an array",
                        )
                    })?;
                let mut delta = Vec::with_capacity(linked.len());
                for (linked_index, linked_item) in linked.iter().enumerate() {
                    let linked_object = linked_item.as_object().ok_or_else(|| {
                        invalid_materialized_field(
                            block_id,
                            format!("content[{index}].content[{linked_index}]"),
                            "linked text must be an object",
                        )
                    })?;
                    if linked_object.get("type").and_then(Value::as_str) != Some("text") {
                        return Err(invalid_materialized_field(
                            block_id,
                            format!("content[{index}].content[{linked_index}].type"),
                            "link content may only contain text",
                        ));
                    }
                    delta.push(dematerialize_text_item(
                        linked_object,
                        block_id,
                        linked_index,
                        Some(href),
                    )?);
                }
                output.push(XmlNode::Text { delta });
            }
            atom_type => {
                let props = object
                    .get("props")
                    .and_then(Value::as_object)
                    .ok_or_else(|| {
                        invalid_materialized_field(
                            block_id,
                            format!("content[{index}].props"),
                            "inline atom props must be an object",
                        )
                    })?;
                output.push(XmlNode::Element(XmlElementNode {
                    name: atom_type.to_owned(),
                    attributes: json_object_to_portable(props)?,
                    children: Vec::new(),
                }));
            }
        }
    }
    Ok(output)
}

fn dematerialize_text_item(
    object: &Map<String, Value>,
    block_id: &str,
    index: usize,
    href: Option<&str>,
) -> Result<TextDelta, BlockMaterializationError> {
    let text = object.get("text").and_then(Value::as_str).ok_or_else(|| {
        invalid_materialized_field(
            block_id,
            format!("content[{index}].text"),
            "text must be a string",
        )
    })?;
    let styles = object
        .get("styles")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            invalid_materialized_field(
                block_id,
                format!("content[{index}].styles"),
                "text styles must be an object",
            )
        })?;
    let mut attributes = BTreeMap::new();
    for (key, value) in styles {
        if !INLINE_STYLE_NAMES.contains(&key.as_str()) {
            return Err(invalid_materialized_field(
                block_id,
                format!("content[{index}].styles.{key}"),
                "unsupported inline style",
            ));
        }
        attributes.insert(
            key.clone(),
            if value == &Value::Bool(true) {
                PortableValue::Object(BTreeMap::new())
            } else {
                json_to_portable_value(value)?
            },
        );
    }
    if let Some(href) = href {
        attributes.insert(
            "link".to_owned(),
            PortableValue::Object(
                [("href".to_owned(), PortableValue::String(href.to_owned()))]
                    .into_iter()
                    .collect(),
            ),
        );
    }
    Ok(TextDelta {
        insert: text.to_owned(),
        attributes,
    })
}

fn dematerialize_table(
    block: &MaterializedBlockNode,
) -> Result<Vec<XmlNode>, BlockMaterializationError> {
    let content = block
        .content
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| {
            invalid_materialized_content(block, "content", "table content must be an object")
        })?;
    if content.get("type").and_then(Value::as_str) != Some("tableContent") {
        return Err(invalid_materialized_content(
            block,
            "content.type",
            "table content type must be tableContent",
        ));
    }
    let widths = content
        .get("columnWidths")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            invalid_materialized_content(
                block,
                "content.columnWidths",
                "table column widths must be an array",
            )
        })?;
    let rows = content
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            invalid_materialized_content(block, "content.rows", "table rows must be an array")
        })?;
    let header_rows = materialized_table_header_count(block, content, "headerRows", rows.len())?;
    let first_row_cell_count = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|row| row.get("cells"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let header_columns =
        materialized_table_header_count(block, content, "headerCols", first_row_cell_count)?;
    let mut width_offset = 0usize;
    rows.iter()
        .enumerate()
        .map(|(row_index, row)| {
            let cells = row
                .as_object()
                .and_then(|row| row.get("cells"))
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    invalid_materialized_field(
                        &block.id,
                        format!("content.rows[{row_index}].cells"),
                        "table row cells must be an array",
                    )
                })?;
            let cells = cells
                .iter()
                .enumerate()
                .map(|(cell_index, cell)| {
                    let cell = cell.as_object().ok_or_else(|| {
                        invalid_materialized_field(
                            &block.id,
                            format!("content.rows[{row_index}].cells[{cell_index}]"),
                            "table cell must be an object",
                        )
                    })?;
                    if cell.get("type").and_then(Value::as_str) != Some("tableCell") {
                        return Err(invalid_materialized_field(
                            &block.id,
                            format!("content.rows[{row_index}].cells[{cell_index}].type"),
                            "table cell type must be tableCell",
                        ));
                    }
                    let props = cell
                        .get("props")
                        .and_then(Value::as_object)
                        .ok_or_else(|| {
                            invalid_materialized_field(
                                &block.id,
                                format!("content.rows[{row_index}].cells[{cell_index}].props"),
                                "table cell props must be an object",
                            )
                        })?;
                    let mut attributes = json_object_to_portable(props)?;
                    let colspan = props
                        .get("colspan")
                        .and_then(Value::as_u64)
                        .map(|value| value as usize)
                        .unwrap_or(1);
                    if colspan == 0 {
                        return Err(invalid_materialized_field(
                            &block.id,
                            format!("content.rows[{row_index}].cells[{cell_index}].props.colspan"),
                            "table cell colspan must be positive",
                        ));
                    }
                    if row_index == 0 {
                        let end = width_offset.saturating_add(colspan);
                        if end > widths.len() {
                            return Err(invalid_materialized_content(
                                block,
                                "content.columnWidths",
                                "column widths do not cover the first row",
                            ));
                        }
                        let selected = &widths[width_offset..end];
                        width_offset = end;
                        if selected.iter().any(|width| !width.is_null()) {
                            attributes.insert(
                                "colwidth".to_owned(),
                                PortableValue::Array(
                                    selected
                                        .iter()
                                        .map(json_to_portable_value)
                                        .collect::<Result<_, _>>()?,
                                ),
                            );
                        }
                    }
                    let inline =
                        cell.get("content")
                            .and_then(Value::as_array)
                            .ok_or_else(|| {
                                invalid_materialized_field(
                                    &block.id,
                                    format!(
                                        "content.rows[{row_index}].cells[{cell_index}].content"
                                    ),
                                    "table cell content must be an array",
                                )
                            })?;
                    Ok(XmlNode::Element(XmlElementNode {
                        name: if row_index < header_rows || cell_index < header_columns {
                            "tableHeader".to_owned()
                        } else {
                            "tableCell".to_owned()
                        },
                        attributes,
                        children: vec![XmlNode::Element(XmlElementNode {
                            name: "tableParagraph".to_owned(),
                            attributes: BTreeMap::new(),
                            children: dematerialize_inline_content(inline, &block.id)?,
                        })],
                    }))
                })
                .collect::<Result<Vec<_>, BlockMaterializationError>>()?;
            Ok(XmlNode::Element(XmlElementNode {
                name: "tableRow".to_owned(),
                attributes: BTreeMap::new(),
                children: cells,
            }))
        })
        .collect()
}

fn materialized_table_header_count(
    block: &MaterializedBlockNode,
    content: &Map<String, Value>,
    key: &str,
    maximum: usize,
) -> Result<usize, BlockMaterializationError> {
    let Some(value) = content.get(key) else {
        return Ok(0);
    };
    let Some(value) = value.as_u64().and_then(|value| usize::try_from(value).ok()) else {
        return Err(invalid_materialized_content(
            block,
            &format!("content.{key}"),
            "table header count must be a non-negative integer",
        ));
    };
    if value <= maximum {
        return Ok(value);
    }
    Err(invalid_materialized_content(
        block,
        &format!("content.{key}"),
        "table header count exceeds the table dimensions",
    ))
}

fn json_object_to_portable(
    object: &Map<String, Value>,
) -> Result<BTreeMap<String, PortableValue>, BlockMaterializationError> {
    object
        .iter()
        .map(|(key, value)| json_to_portable_value(value).map(|value| (key.clone(), value)))
        .collect()
}

fn json_to_portable_value(value: &Value) -> Result<PortableValue, BlockMaterializationError> {
    match value {
        Value::Null => Ok(PortableValue::Null),
        Value::Bool(value) => Ok(PortableValue::Boolean(*value)),
        Value::Number(value) => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(PortableValue::Number)
            .ok_or(BlockMaterializationError::InvalidNumber),
        Value::String(value) => Ok(PortableValue::String(value.clone())),
        Value::Array(values) => values
            .iter()
            .map(json_to_portable_value)
            .collect::<Result<_, _>>()
            .map(PortableValue::Array),
        Value::Object(values) => json_object_to_portable(values).map(PortableValue::Object),
    }
}

fn invalid_materialized_content(
    block: &MaterializedBlockNode,
    field: impl Into<String>,
    message: impl Into<String>,
) -> BlockMaterializationError {
    invalid_materialized_field(&block.id, field, message)
}

fn invalid_materialized_field(
    block_id: &str,
    field: impl Into<String>,
    message: impl Into<String>,
) -> BlockMaterializationError {
    BlockMaterializationError::InvalidContent {
        block_id: block_id.to_owned(),
        field: field.into(),
        message: message.into(),
    }
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
    let mut header_matrix = Vec::new();
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
        let mut header_row = Vec::new();
        for cell_node in &row.children {
            let XmlNode::Element(cell) = cell_node else {
                return Err(table_error(
                    block_id,
                    "tableRow must contain tableCell or tableHeader elements",
                ));
            };
            if !matches!(cell.name.as_str(), "tableCell" | "tableHeader") {
                return Err(table_error(
                    block_id,
                    format!("expected tableCell or tableHeader, found {}", cell.name),
                ));
            }
            header_row.push(cell.name == "tableHeader");
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
        header_matrix.push(header_row);
    }
    let header_rows = header_matrix
        .iter()
        .filter(|row| !row.is_empty() && row.iter().all(|is_header| *is_header))
        .count();
    let header_columns = header_matrix.first().map_or(0, |first_row| {
        (0..first_row.len())
            .filter(|column| {
                header_matrix
                    .iter()
                    .all(|row| row.get(*column) == Some(&true))
            })
            .count()
    });
    let mut content = Map::from_iter([
        ("type".to_owned(), Value::String("tableContent".to_owned())),
        ("columnWidths".to_owned(), Value::Array(column_widths)),
        ("rows".to_owned(), Value::Array(rows)),
    ]);
    if header_rows > 0 {
        content.insert("headerRows".to_owned(), Value::from(header_rows));
    }
    if header_columns > 0 {
        content.insert("headerCols".to_owned(), Value::from(header_columns));
    }
    Ok(Value::Object(content))
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

    #[test]
    fn round_trips_every_registered_materialized_block_back_to_canonical_xml() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/yjs-yrs");
        let expected: Value = serde_json::from_slice(
            &std::fs::read(root.join("matrix-materialization.json")).expect("oracle fixture"),
        )
        .expect("valid oracle fixture");
        let blocks: Vec<MaterializedBlockNode> =
            serde_json::from_value(expected["blockTree"].clone()).expect("materialized blocks");

        let canonical = dematerialize_block_tree(&blocks).expect("canonical Block tree");
        let actual = serde_json::to_value(
            materialize_block_tree(&canonical).expect("round-trip materialization"),
        )
        .expect("serialize materialization");

        assert_eq!(actual, expected["blockTree"]);
    }

    #[test]
    fn preserves_blocknote_table_header_rows_and_columns() {
        let cell = |name: &str| {
            XmlNode::Element(XmlElementNode {
                name: name.to_owned(),
                attributes: BTreeMap::new(),
                children: vec![XmlNode::Element(XmlElementNode {
                    name: "tableParagraph".to_owned(),
                    attributes: BTreeMap::new(),
                    children: Vec::new(),
                })],
            })
        };
        let row = |names: &[&str]| {
            XmlNode::Element(XmlElementNode {
                name: "tableRow".to_owned(),
                attributes: BTreeMap::new(),
                children: names.iter().map(|name| cell(name)).collect(),
            })
        };
        let table = XmlElementNode {
            name: "table".to_owned(),
            attributes: BTreeMap::new(),
            children: vec![
                row(&["tableHeader", "tableHeader", "tableHeader"]),
                row(&["tableHeader", "tableCell", "tableCell"]),
                row(&["tableHeader", "tableCell", "tableCell"]),
            ],
        };

        let materialized = materialize_table(&table, "table:block").expect("materialize table");
        assert_eq!(materialized["headerRows"], 1);
        assert_eq!(materialized["headerCols"], 1);

        let block = MaterializedBlockNode {
            id: "table:block".to_owned(),
            block_type: "table".to_owned(),
            props: BTreeMap::new(),
            content: Some(materialized),
            children: Vec::new(),
        };
        let canonical = dematerialize_table(&block).expect("dematerialize table");
        let names = canonical
            .iter()
            .map(|row| {
                let XmlNode::Element(row) = row else {
                    panic!("table row");
                };
                row.children
                    .iter()
                    .map(|cell| {
                        let XmlNode::Element(cell) = cell else {
                            panic!("table cell");
                        };
                        cell.name.as_str()
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                vec!["tableHeader", "tableHeader", "tableHeader"],
                vec!["tableHeader", "tableCell", "tableCell"],
                vec!["tableHeader", "tableCell", "tableCell"],
            ]
        );
    }

    #[test]
    fn rejects_childless_content_and_duplicate_application_identities() {
        let invalid = vec![MaterializedBlockNode {
            id: "duplicate".to_owned(),
            block_type: "divider".to_owned(),
            props: BTreeMap::new(),
            content: Some(Value::Array(Vec::new())),
            children: Vec::new(),
        }];
        assert!(matches!(
            dematerialize_block_tree(&invalid),
            Err(BlockMaterializationError::InvalidContent { .. })
        ));

        let duplicate = MaterializedBlockNode {
            id: "duplicate".to_owned(),
            block_type: "paragraph".to_owned(),
            props: BTreeMap::new(),
            content: Some(Value::Array(Vec::new())),
            children: Vec::new(),
        };
        assert!(matches!(
            dematerialize_block_tree(&[duplicate.clone(), duplicate]),
            Err(BlockMaterializationError::InvalidTree(_))
        ));
    }
}
