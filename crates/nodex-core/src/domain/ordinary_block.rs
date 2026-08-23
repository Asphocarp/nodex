use std::collections::BTreeMap;

use nodex_core_contracts::library::{LibraryHeadingLevel, LibraryStructuralTurnIntoTarget};
use serde_json::Value;

pub fn canonical_ordinary_block_shape(
    target: &LibraryStructuralTurnIntoTarget,
) -> (&'static str, BTreeMap<String, Value>) {
    match target {
        LibraryStructuralTurnIntoTarget::Paragraph => ("paragraph", default_props()),
        LibraryStructuralTurnIntoTarget::Heading { level, toggleable } => {
            let mut props = default_props();
            props.insert(
                "level".to_owned(),
                Value::Number(heading_level(*level).into()),
            );
            props.insert("isToggleable".to_owned(), Value::Bool(*toggleable));
            ("heading", props)
        }
        LibraryStructuralTurnIntoTarget::BulletedList => ("bulletListItem", default_props()),
        LibraryStructuralTurnIntoTarget::NumberedList => ("numberedListItem", default_props()),
        LibraryStructuralTurnIntoTarget::TodoList => {
            let mut props = default_props();
            props.insert("checked".to_owned(), Value::Bool(false));
            ("checkListItem", props)
        }
        LibraryStructuralTurnIntoTarget::ToggleList => ("toggleListItem", default_props()),
        LibraryStructuralTurnIntoTarget::Quote => ("quote", quote_props()),
        LibraryStructuralTurnIntoTarget::Callout => {
            let mut props = default_props();
            props.insert("icon".to_owned(), Value::String("💡".to_owned()));
            ("callout", props)
        }
        LibraryStructuralTurnIntoTarget::Code => {
            let mut props = default_props();
            props.insert("language".to_owned(), Value::String("text".to_owned()));
            ("codeBlock", props)
        }
    }
}

pub fn default_props() -> BTreeMap<String, Value> {
    BTreeMap::from([
        (
            "backgroundColor".to_owned(),
            Value::String("default".to_owned()),
        ),
        ("textColor".to_owned(), Value::String("default".to_owned())),
        ("textAlignment".to_owned(), Value::String("left".to_owned())),
    ])
}

pub fn quote_props() -> BTreeMap<String, Value> {
    BTreeMap::from([
        (
            "backgroundColor".to_owned(),
            Value::String("default".to_owned()),
        ),
        ("textColor".to_owned(), Value::String("default".to_owned())),
    ])
}

fn heading_level(level: LibraryHeadingLevel) -> u8 {
    match level {
        LibraryHeadingLevel::One => 1,
        LibraryHeadingLevel::Two => 2,
        LibraryHeadingLevel::Three => 3,
    }
}
