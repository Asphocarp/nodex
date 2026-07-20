use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

use super::block_materialization::MaterializedBlockNode;
use super::rich_text::{
    RichTextItem, RichTextMaterialization, RichTextStyles, canonicalize_rich_text,
};

const PROMOTABLE_TYPES: &[&str] = &[
    "paragraph",
    "heading",
    "bulletListItem",
    "numberedListItem",
    "toggleListItem",
    "quote",
];
const WRAPPED_TYPES: &[&str] = &[
    "checkListItem",
    "codeBlock",
    "table",
    "divider",
    "image",
    "callout",
    "threadSection",
    "database",
    "pageRef",
    "databaseViewRef",
    "syncedBlockRef",
    "templateRef",
];
const UNSUPPORTED_LEGACY_TYPES: &[&str] = &["cardToggle", "toggleListInlineView"];
const PRESENTATION_PROPERTIES: &[&str] = &[
    "backgroundColor",
    "textColor",
    "textAlignment",
    "level",
    "isToggleable",
    "start",
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PageWrapperReason {
    TypeRequiresWrapper,
    UnsupportedPrimaryContent,
    UnmappedTypeState,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BlockToPageTransformation {
    Promote {
        page_id: String,
        rich_title: Vec<RichTextItem>,
        body_roots: Vec<MaterializedBlockNode>,
        consumed_type: String,
        consumed_props: BTreeMap<String, Value>,
        placeholder_block_id: Option<String>,
    },
    Wrap {
        page_id: String,
        wrapped_root: MaterializedBlockNode,
        rich_title: Vec<RichTextItem>,
        reason: PageWrapperReason,
    },
    AlreadyPage {
        page_id: String,
    },
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BlockToPageError {
    #[error("Block type {0} has no Page transformation capability")]
    UnknownBlockType(String),
    #[error(
        "Legacy projection Block {block_id} ({block_type}) must migrate before Page transformation"
    )]
    UnsupportedLegacyBlock {
        block_id: String,
        block_type: String,
    },
    #[error("Block primary content is not title-safe")]
    UnsupportedPrimaryContent,
}

pub fn plan_block_to_page_transformation(
    root: &MaterializedBlockNode,
    result_root_id: &str,
    wrapper_page_id: &str,
    empty_body_block_id: &str,
) -> Result<BlockToPageTransformation, BlockToPageError> {
    if root.block_type == "page" {
        return Ok(BlockToPageTransformation::AlreadyPage {
            page_id: result_root_id.to_owned(),
        });
    }
    if UNSUPPORTED_LEGACY_TYPES.contains(&root.block_type.as_str()) {
        return Err(BlockToPageError::UnsupportedLegacyBlock {
            block_id: root.id.clone(),
            block_type: root.block_type.clone(),
        });
    }
    if WRAPPED_TYPES.contains(&root.block_type.as_str()) {
        return Ok(wrap(
            root,
            wrapper_page_id,
            PageWrapperReason::TypeRequiresWrapper,
        ));
    }
    if !PROMOTABLE_TYPES.contains(&root.block_type.as_str()) {
        return Err(BlockToPageError::UnknownBlockType(root.block_type.clone()));
    }
    if root
        .props
        .keys()
        .any(|key| !PRESENTATION_PROPERTIES.contains(&key.as_str()))
    {
        return Ok(wrap(
            root,
            wrapper_page_id,
            PageWrapperReason::UnmappedTypeState,
        ));
    }
    let rich_title = match primary_rich_text(root) {
        Ok(value) => value.rich_text,
        Err(BlockToPageError::UnsupportedPrimaryContent) => {
            return Ok(wrap(
                root,
                wrapper_page_id,
                PageWrapperReason::UnsupportedPrimaryContent,
            ));
        }
        Err(error) => return Err(error),
    };
    let (body_roots, placeholder_block_id) = if root.children.is_empty() {
        (
            vec![empty_paragraph(empty_body_block_id)],
            Some(empty_body_block_id.to_owned()),
        )
    } else {
        (root.children.clone(), None)
    };
    Ok(BlockToPageTransformation::Promote {
        page_id: result_root_id.to_owned(),
        rich_title,
        body_roots,
        consumed_type: root.block_type.clone(),
        consumed_props: root.props.clone(),
        placeholder_block_id,
    })
}

fn wrap(
    root: &MaterializedBlockNode,
    wrapper_page_id: &str,
    reason: PageWrapperReason,
) -> BlockToPageTransformation {
    let fallback = vec![RichTextItem::Text {
        text: root.block_type.clone(),
        styles: RichTextStyles::default(),
    }];
    let rich_title = primary_rich_text(root)
        .ok()
        .filter(|value| !value.plain_text.trim().is_empty())
        .map_or(fallback, |value| value.rich_text);
    BlockToPageTransformation::Wrap {
        page_id: wrapper_page_id.to_owned(),
        wrapped_root: root.clone(),
        rich_title,
        reason,
    }
}

fn primary_rich_text(
    root: &MaterializedBlockNode,
) -> Result<RichTextMaterialization, BlockToPageError> {
    let content = root
        .content
        .as_ref()
        .and_then(Value::as_array)
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?;
    let items = content
        .iter()
        .map(read_inline_item)
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    canonicalize_rich_text(&items).map_err(|_| BlockToPageError::UnsupportedPrimaryContent)
}

fn read_inline_item(value: &Value) -> Result<Vec<RichTextItem>, BlockToPageError> {
    let object = value
        .as_object()
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?;
    match object.get("type").and_then(Value::as_str) {
        Some("text") => read_text_item(object, None),
        Some("link") => read_link_item(object),
        Some("threadMention") => {
            let uuid = read_nonempty_prop(object, "uuid")?;
            Ok(vec![RichTextItem::ThreadMention { uuid }])
        }
        Some("dateMention") => read_date_mention(object),
        _ => Err(BlockToPageError::UnsupportedPrimaryContent),
    }
}

fn read_link_item(object: &Map<String, Value>) -> Result<Vec<RichTextItem>, BlockToPageError> {
    let href = object
        .get("href")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?;
    let content = object
        .get("content")
        .and_then(Value::as_array)
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?;
    let text = content
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<String>();
    let styles = content
        .first()
        .and_then(|item| item.get("styles"))
        .map(read_styles)
        .transpose()?
        .unwrap_or_default();
    split_lines(text, |text| RichTextItem::Link {
        text,
        href: href.to_owned(),
        styles: styles.clone(),
    })
}

fn read_text_item(
    object: &Map<String, Value>,
    href: Option<&str>,
) -> Result<Vec<RichTextItem>, BlockToPageError> {
    let text = object
        .get("text")
        .and_then(Value::as_str)
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?
        .to_owned();
    let styles = object
        .get("styles")
        .map(read_styles)
        .transpose()?
        .unwrap_or_default();
    split_lines(text, |text| match href {
        Some(href) => RichTextItem::Link {
            text,
            href: href.to_owned(),
            styles: styles.clone(),
        },
        None => RichTextItem::Text {
            text,
            styles: styles.clone(),
        },
    })
}

fn split_lines(
    text: String,
    make: impl Fn(String) -> RichTextItem,
) -> Result<Vec<RichTextItem>, BlockToPageError> {
    let mut output = Vec::new();
    let pieces = text.split('\n').collect::<Vec<_>>();
    for (index, piece) in pieces.iter().enumerate() {
        if !piece.is_empty() {
            output.push(make((*piece).to_owned()));
        }
        if index + 1 < pieces.len() {
            output.push(RichTextItem::LineBreak);
        }
    }
    Ok(output)
}

fn read_styles(value: &Value) -> Result<RichTextStyles, BlockToPageError> {
    let object = value
        .as_object()
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?;
    let flag = |name: &str| object.get(name).and_then(Value::as_bool).unwrap_or(false);
    let foreground = object
        .get("textColor")
        .and_then(Value::as_str)
        .filter(|value| *value != "default");
    let background = object
        .get("backgroundColor")
        .and_then(Value::as_str)
        .filter(|value| *value != "default")
        .map(|value| format!("{value}_bg"));
    Ok(RichTextStyles {
        bold: flag("bold"),
        italic: flag("italic"),
        underline: flag("underline"),
        strikethrough: flag("strike"),
        code: flag("code"),
        color: background.or_else(|| foreground.map(str::to_owned)),
    })
}

fn read_nonempty_prop(object: &Map<String, Value>, key: &str) -> Result<String, BlockToPageError> {
    object
        .get("props")
        .and_then(Value::as_object)
        .and_then(|props| props.get(key))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)
}

fn read_date_mention(object: &Map<String, Value>) -> Result<Vec<RichTextItem>, BlockToPageError> {
    let props = object
        .get("props")
        .and_then(Value::as_object)
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?;
    let start = props
        .get("start")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(BlockToPageError::UnsupportedPrimaryContent)?;
    let optional = |key: &str| {
        props
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    Ok(vec![RichTextItem::DateMention {
        start: start.to_owned(),
        end: optional("end"),
        tz: optional("tz"),
        format: optional("format"),
        time_format: optional("timeFormat"),
        reminder: optional("reminder"),
    }])
}

fn empty_paragraph(block_id: &str) -> MaterializedBlockNode {
    MaterializedBlockNode {
        id: block_id.to_owned(),
        block_type: "paragraph".to_owned(),
        props: BTreeMap::from([
            (
                "backgroundColor".to_owned(),
                Value::String("default".to_owned()),
            ),
            ("textColor".to_owned(), Value::String("default".to_owned())),
            ("textAlignment".to_owned(), Value::String("left".to_owned())),
        ]),
        content: Some(Value::Array(Vec::new())),
        children: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn paragraph(
        id: &str,
        content: Value,
        children: Vec<MaterializedBlockNode>,
    ) -> MaterializedBlockNode {
        MaterializedBlockNode {
            id: id.to_owned(),
            block_type: "paragraph".to_owned(),
            props: BTreeMap::from([
                ("backgroundColor".to_owned(), json!("default")),
                ("textColor".to_owned(), json!("default")),
                ("textAlignment".to_owned(), json!("left")),
            ]),
            content: Some(content),
            children,
        }
    }

    #[test]
    fn promotes_rich_primary_content_and_lifts_only_children() {
        let child = paragraph(
            "child-a",
            json!([{ "type": "text", "text": "Child", "styles": {} }]),
            Vec::new(),
        );
        let root = paragraph(
            "root-a",
            json!([
                { "type": "text", "text": "Rich ", "styles": { "bold": true } },
                { "type": "link", "href": "https://nodex.local", "content": [
                    { "type": "text", "text": "title", "styles": { "italic": true } }
                ] },
                { "type": "threadMention", "props": { "uuid": "thread-a" } }
            ]),
            vec![child.clone()],
        );
        let plan =
            plan_block_to_page_transformation(&root, "root-a", "wrapper-unused", "empty-unused")
                .expect("promotion");
        let BlockToPageTransformation::Promote {
            page_id,
            rich_title,
            body_roots,
            placeholder_block_id,
            ..
        } = plan
        else {
            panic!("promotion");
        };
        assert_eq!(page_id, "root-a");
        assert_eq!(body_roots, vec![child]);
        assert_eq!(placeholder_block_id, None);
        assert_eq!(
            rich_title,
            vec![
                RichTextItem::Text {
                    text: "Rich ".to_owned(),
                    styles: RichTextStyles {
                        bold: true,
                        ..RichTextStyles::default()
                    },
                },
                RichTextItem::Link {
                    text: "title".to_owned(),
                    href: "https://nodex.local".to_owned(),
                    styles: RichTextStyles {
                        italic: true,
                        ..RichTextStyles::default()
                    },
                },
                RichTextItem::ThreadMention {
                    uuid: "thread-a".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn allocates_one_canonical_empty_body_for_a_promoted_leaf() {
        let root = paragraph(
            "leaf",
            json!([{ "type": "text", "text": "Leaf", "styles": {} }]),
            Vec::new(),
        );
        let BlockToPageTransformation::Promote {
            body_roots,
            placeholder_block_id,
            ..
        } = plan_block_to_page_transformation(&root, "leaf", "unused", "empty-body")
            .expect("promotion")
        else {
            panic!("promotion");
        };
        assert_eq!(placeholder_block_id.as_deref(), Some("empty-body"));
        assert_eq!(body_roots, vec![empty_paragraph("empty-body")]);
    }

    #[test]
    fn wraps_unsupported_atoms_and_stateful_types_without_loss() {
        let attachment = paragraph(
            "attachment-root",
            json!([{ "type": "attachment", "props": {
                "kind": "file", "mode": "materialized", "source": "nodex://assets/demo.txt", "name": "demo.txt"
            } }]),
            Vec::new(),
        );
        let plan = plan_block_to_page_transformation(
            &attachment,
            "attachment-root",
            "wrapper-attachment",
            "unused",
        )
        .expect("wrapper");
        assert!(matches!(
            plan,
            BlockToPageTransformation::Wrap {
                page_id,
                wrapped_root,
                reason: PageWrapperReason::UnsupportedPrimaryContent,
                ..
            } if page_id == "wrapper-attachment" && wrapped_root == attachment
        ));

        let mut checklist = paragraph(
            "check",
            json!([{ "type": "text", "text": "Done", "styles": {} }]),
            Vec::new(),
        );
        checklist.block_type = "checkListItem".to_owned();
        checklist.props = BTreeMap::from([("checked".to_owned(), json!(true))]);
        let BlockToPageTransformation::Wrap {
            rich_title, reason, ..
        } = plan_block_to_page_transformation(&checklist, "check", "wrapper-check", "unused")
            .expect("wrapper")
        else {
            panic!("wrapper");
        };
        assert_eq!(reason, PageWrapperReason::TypeRequiresWrapper);
        assert_eq!(
            rich_title,
            vec![RichTextItem::Text {
                text: "Done".to_owned(),
                styles: RichTextStyles::default(),
            }]
        );
    }
}
