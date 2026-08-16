use nodex_core_contracts::database::{
    DatabasePropertyCapabilities, DatabasePropertyFilterOperator, DatabasePropertySchema,
    DatabaseRelationCardinality,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub(crate) const PRIORITY_PROPERTY_ID: &str = "priority";
pub(crate) const STATUS_PROPERTY_ID: &str = "status";
pub(crate) const TASK_PARENT_PROPERTY_ID: &str = "task_parent";
pub(crate) const COMPLETED_STATUS_OPTION_ID: &str = "ship";
const BUILT_IN_PROPERTY_IDS: [&str; 9] = [
    STATUS_PROPERTY_ID,
    PRIORITY_PROPERTY_ID,
    "estimate",
    "tags",
    "due_date",
    "scheduled_start",
    "scheduled_end",
    "assignee",
    TASK_PARENT_PROPERTY_ID,
];
const STATUS_OPTION_IDS: [&str; 5] = ["triage", "plan", "build", "review", "ship"];
const ESTIMATE_OPTION_IDS: [&str; 5] = ["xs", "s", "m", "l", "xl"];
const MAX_OPTION_NAME_LENGTH: usize = 256;
const MAX_OPTION_COLOR_LENGTH: usize = 128;
pub(crate) const PRIORITY_OPTIONS: [(&str, &str); 4] = [
    ("p0-critical", "P0 - Critical"),
    ("p1-high", "P1 - High"),
    ("p2-medium", "P2 - Medium"),
    ("p3-low", "P3 - Low"),
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PropertyOption {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) color: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PropertyOptionConfig {
    pub(crate) options: Vec<PropertyOption>,
}

pub(crate) fn is_priority_option_id(value: &str) -> bool {
    PRIORITY_OPTIONS.iter().any(|(id, _)| *id == value)
}

pub(crate) fn priority_option_id(priority: u8) -> Option<&'static str> {
    PRIORITY_OPTIONS
        .get(usize::from(priority))
        .map(|(id, _)| *id)
}

pub(crate) fn is_estimate_option_id(value: &str) -> bool {
    ESTIMATE_OPTION_IDS.contains(&value)
}

fn is_compact_scoped_id(value: &str, prefix: &str) -> bool {
    value.len() == 10
        && value.starts_with(prefix)
        && value[2..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

pub(crate) fn is_custom_property_id(value: &str) -> bool {
    is_compact_scoped_id(value, "p_")
}

pub(crate) fn is_custom_option_id(value: &str) -> bool {
    is_compact_scoped_id(value, "o_")
}

pub(crate) fn is_canonical_property_id(value: &str) -> bool {
    BUILT_IN_PROPERTY_IDS.contains(&value) || is_custom_property_id(value)
}

pub(crate) fn is_canonical_option_id(property_id: &str, option_id: &str) -> bool {
    match property_id {
        STATUS_PROPERTY_ID => STATUS_OPTION_IDS.contains(&option_id),
        PRIORITY_PROPERTY_ID => is_priority_option_id(option_id),
        "estimate" => ESTIMATE_OPTION_IDS.contains(&option_id),
        "tags" => is_custom_option_id(option_id),
        _ if is_custom_property_id(property_id) => is_custom_option_id(option_id),
        _ => false,
    }
}

pub(crate) fn is_canonical_option_name(property_id: &str, name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_OPTION_NAME_LENGTH
        && name == name.trim()
        && (property_id != "tags" || name.nfc().eq(name.chars()))
}

pub(crate) fn is_canonical_option_color(color: &str) -> bool {
    !color.is_empty() && color.len() <= MAX_OPTION_COLOR_LENGTH && color == color.trim()
}

pub(crate) fn schema_matches_canonical_property(
    property_id: &str,
    data_source_id: &str,
    schema: &DatabasePropertySchema,
) -> bool {
    match property_id {
        STATUS_PROPERTY_ID | PRIORITY_PROPERTY_ID | "estimate" => {
            matches!(schema, DatabasePropertySchema::Select)
        }
        "tags" => matches!(schema, DatabasePropertySchema::MultiSelect),
        "due_date" => matches!(schema, DatabasePropertySchema::Date),
        "scheduled_start" | "scheduled_end" => {
            matches!(schema, DatabasePropertySchema::Datetime)
        }
        "assignee" => matches!(schema, DatabasePropertySchema::Text),
        TASK_PARENT_PROPERTY_ID => matches!(
            schema,
            DatabasePropertySchema::Relation {
                target_data_source_id,
                cardinality: DatabaseRelationCardinality::One,
            } if target_data_source_id == data_source_id
        ),
        _ => is_custom_property_id(property_id),
    }
}

fn is_option_backed_property_type(property_id: &str, value_type: &str) -> bool {
    match property_id {
        STATUS_PROPERTY_ID | PRIORITY_PROPERTY_ID | "estimate" => value_type == "select",
        "tags" => value_type == "multi_select",
        _ if is_custom_property_id(property_id) => {
            matches!(value_type, "select" | "multi_select")
        }
        _ => false,
    }
}

pub(crate) fn option_config_from_storage(
    property_id: &str,
    value_type: &str,
    config_json: &str,
) -> Result<PropertyOptionConfig, StoreError> {
    if !is_option_backed_property_type(property_id, value_type) {
        return Err(corrupt("Property is not canonically option-backed"));
    }
    let config = serde_json::from_str::<PropertyOptionConfig>(config_json)
        .map_err(|_| corrupt("Property option registry is invalid"))?;
    if config.options.len() > super::MAX_PROPERTY_OPTIONS {
        return Err(corrupt("Property option registry exceeds its bound"));
    }
    let mut ids = HashSet::new();
    let mut tag_names = HashSet::new();
    for option in &config.options {
        if !is_canonical_option_id(property_id, &option.id) {
            return Err(corrupt(
                "Stored Property option registry contains a noncanonical ID",
            ));
        }
        if !is_canonical_option_name(property_id, &option.name) {
            return Err(corrupt("Stored Property option name is not canonical"));
        }
        if property_id == "tags" && !tag_names.insert(option.name.as_str()) {
            return Err(corrupt(
                "Stored tags option registry repeats or misencodes a canonical name",
            ));
        }
        if option
            .color
            .as_deref()
            .is_some_and(|color| !is_canonical_option_color(color))
        {
            return Err(corrupt("Stored Property option color is not canonical"));
        }
        if !ids.insert(option.id.as_str()) {
            return Err(corrupt("Property option registry repeats an ID"));
        }
    }
    Ok(config)
}

pub(crate) fn value_type(schema: &DatabasePropertySchema) -> &'static str {
    match schema {
        DatabasePropertySchema::Text => "text",
        DatabasePropertySchema::Number => "number",
        DatabasePropertySchema::Checkbox => "checkbox",
        DatabasePropertySchema::Select => "select",
        DatabasePropertySchema::MultiSelect => "multi_select",
        DatabasePropertySchema::Date => "date",
        DatabasePropertySchema::Datetime => "datetime",
        DatabasePropertySchema::Relation { .. } => "relation",
    }
}

pub(crate) fn capabilities(schema: &DatabasePropertySchema) -> DatabasePropertyCapabilities {
    use DatabasePropertyFilterOperator::{
        Contains, Equals, IsEmpty, IsNotEmpty, NotContains, NotEquals,
    };

    let equality = vec![Equals, NotEquals, IsEmpty, IsNotEmpty];
    match schema {
        DatabasePropertySchema::Text => DatabasePropertyCapabilities {
            filter_operators: vec![
                Equals,
                NotEquals,
                Contains,
                NotContains,
                IsEmpty,
                IsNotEmpty,
            ],
            sortable: true,
            groupable: true,
        },
        DatabasePropertySchema::MultiSelect => DatabasePropertyCapabilities {
            filter_operators: vec![
                Equals,
                NotEquals,
                Contains,
                NotContains,
                IsEmpty,
                IsNotEmpty,
            ],
            sortable: true,
            groupable: true,
        },
        DatabasePropertySchema::Relation { .. } => DatabasePropertyCapabilities {
            filter_operators: vec![Contains, NotContains, IsEmpty, IsNotEmpty],
            sortable: false,
            groupable: false,
        },
        DatabasePropertySchema::Number
        | DatabasePropertySchema::Checkbox
        | DatabasePropertySchema::Select
        | DatabasePropertySchema::Date
        | DatabasePropertySchema::Datetime => DatabasePropertyCapabilities {
            filter_operators: equality,
            sortable: true,
            groupable: true,
        },
    }
}

pub(crate) fn schema_from_storage(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
    stored_value_type: &str,
) -> Result<DatabasePropertySchema, StoreError> {
    let schema = match stored_value_type {
        "text" => DatabasePropertySchema::Text,
        "number" => DatabasePropertySchema::Number,
        "checkbox" => DatabasePropertySchema::Checkbox,
        "select" => DatabasePropertySchema::Select,
        "multi_select" => DatabasePropertySchema::MultiSelect,
        "date" => DatabasePropertySchema::Date,
        "datetime" => DatabasePropertySchema::Datetime,
        "relation" => {
            let (target_data_source_id, cardinality) = connection
                .query_row(
                    "SELECT target_data_source_id, cardinality FROM data_source_relation_properties \
                     WHERE data_source_id = ?1 AND property_id = ?2",
                    params![data_source_id, property_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
                .ok_or_else(|| corrupt("Relation Property has no target Data Source"))?;
            let cardinality = match cardinality.as_str() {
                "one" => DatabaseRelationCardinality::One,
                "many" => DatabaseRelationCardinality::Many,
                _ => return Err(corrupt("Relation Property has invalid cardinality")),
            };
            DatabasePropertySchema::Relation {
                target_data_source_id,
                cardinality,
            }
        }
        _ => return Err(corrupt("Stored Property has an unsupported schema")),
    };
    Ok(schema)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
