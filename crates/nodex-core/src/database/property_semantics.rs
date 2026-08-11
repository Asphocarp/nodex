use nodex_core_contracts::database::{
    DatabasePropertyCapabilities, DatabasePropertyFilterOperator, DatabasePropertySchema,
    DatabasePropertySetMemberKind,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub(crate) const PRIORITY_PROPERTY_ID: &str = "priority";
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
            replace: true,
            patch_set_member: None,
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
            replace: true,
            patch_set_member: Some(DatabasePropertySetMemberKind::Option),
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
            replace: true,
            patch_set_member: Some(DatabasePropertySetMemberKind::Page),
            filter_operators: vec![Contains, NotContains, IsEmpty, IsNotEmpty],
            sortable: false,
            groupable: false,
        },
        DatabasePropertySchema::Number
        | DatabasePropertySchema::Checkbox
        | DatabasePropertySchema::Select
        | DatabasePropertySchema::Date
        | DatabasePropertySchema::Datetime => DatabasePropertyCapabilities {
            replace: true,
            patch_set_member: None,
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
            let target_data_source_id = connection
                .query_row(
                    "SELECT target_data_source_id FROM data_source_relation_properties \
                     WHERE data_source_id = ?1 AND property_id = ?2",
                    params![data_source_id, property_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| corrupt("Relation Property has no target Data Source"))?;
            DatabasePropertySchema::Relation {
                target_data_source_id,
            }
        }
        _ => return Err(corrupt("Stored Property has an unsupported schema")),
    };
    Ok(schema)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
