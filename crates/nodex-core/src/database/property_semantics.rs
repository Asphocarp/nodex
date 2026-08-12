use nodex_core_contracts::database::{
    DatabasePropertyCapabilities, DatabasePropertyFilterOperator, DatabasePropertySchema,
    DatabaseRelationCardinality,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub(crate) const PRIORITY_PROPERTY_ID: &str = "priority";
pub(crate) const STATUS_PROPERTY_ID: &str = "status";
pub(crate) const TASK_PARENT_PROPERTY_ID: &str = "task_parent";
pub(crate) const COMPLETED_STATUS_OPTION_ID: &str = "ship";
pub(crate) const PRIORITY_OPTIONS: [(&str, &str); 4] = [
    ("p0-critical", "P0 - Critical"),
    ("p1-high", "P1 - High"),
    ("p2-medium", "P2 - Medium"),
    ("p3-low", "P3 - Low"),
];

pub(crate) fn is_priority_option_id(value: &str) -> bool {
    PRIORITY_OPTIONS.iter().any(|(id, _)| *id == value)
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
