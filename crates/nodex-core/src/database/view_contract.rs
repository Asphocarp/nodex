use nodex_core_contracts::database::{
    DatabaseViewDefinition, DatabaseViewFilter, DatabaseViewFilterGroupOperator, DatabaseViewGroup,
    DatabaseViewNullOrder, DatabaseViewSortDirection, DatabaseViewSortField,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const VIEW_SCHEMA_KEY: &str = "nodex.database-view";
const VIEW_SCHEMA_VERSION: u32 = 4;

/// Storage envelope for the durable typed View definition. Schema markers
/// version the SQLite JSON encoding; they are not part of the domain command.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredViewDefinition {
    schema_key: String,
    schema_version: u32,
    filter: DatabaseViewFilter,
    presentation: nodex_core_contracts::database::DatabaseViewPresentation,
}

impl StoredViewDefinition {
    fn from_definition(definition: &DatabaseViewDefinition) -> Self {
        Self {
            schema_key: VIEW_SCHEMA_KEY.to_owned(),
            schema_version: VIEW_SCHEMA_VERSION,
            filter: definition.filter.clone(),
            presentation: definition.presentation.clone(),
        }
    }

    fn into_definition(self) -> Result<DatabaseViewDefinition, String> {
        if self.schema_key != VIEW_SCHEMA_KEY || self.schema_version != VIEW_SCHEMA_VERSION {
            return Err("Database View storage schema is unsupported".to_owned());
        }
        Ok(DatabaseViewDefinition {
            filter: self.filter,
            presentation: self.presentation,
        })
    }
}

pub(super) fn encode_definition_json(
    definition: &DatabaseViewDefinition,
) -> Result<String, String> {
    serde_json::to_string(&StoredViewDefinition::from_definition(definition))
        .map_err(|_| "Database View definition cannot be encoded".to_owned())
}

pub(super) fn decode_definition_json(value: &str) -> Result<DatabaseViewDefinition, String> {
    serde_json::from_str::<StoredViewDefinition>(value)
        .map_err(|_| "Database View definition is invalid".to_owned())?
        .into_definition()
}

pub(super) fn decode_definition_value(value: Value) -> Result<DatabaseViewDefinition, String> {
    serde_json::from_value::<StoredViewDefinition>(value)
        .map_err(|_| "Database View definition is invalid".to_owned())?
        .into_definition()
}

/// The one View definition whose row order and group semantics can be shared
/// by primary Board writes and exact singleton projection patches.
pub(crate) fn is_exact_primary_board_definition(definition: &DatabaseViewDefinition) -> bool {
    let has_empty_filter = matches!(
        &definition.filter,
        DatabaseViewFilter::Group {
            operator: DatabaseViewFilterGroupOperator::And,
            children,
        } if children.is_empty()
    );
    let has_manual_sort = matches!(
        definition.presentation.sort.as_slice(),
        [rule]
            if rule.field == DatabaseViewSortField::Manual
                && rule.direction == DatabaseViewSortDirection::Asc
                && rule.nulls == DatabaseViewNullOrder::Last
    );
    let has_status_group = definition.presentation.group.as_ref()
        == Some(&DatabaseViewGroup {
            property_id: "status".to_owned(),
        });
    has_empty_filter && has_manual_sort && has_status_group
}

pub(crate) fn is_exact_primary_board_config(config: &Value) -> bool {
    decode_definition_value(config.clone())
        .is_ok_and(|definition| is_exact_primary_board_definition(&definition))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use serde_json::json;

    use super::{decode_definition_json, decode_definition_value, encode_definition_json};

    fn stored_definition() -> Value {
        json!({
            "schemaKey": "nodex.database-view",
            "schemaVersion": 4,
            "filter": { "kind": "group", "operator": "and", "children": [] },
            "presentation": {
                "sort": [{
                    "field": { "kind": "manual" },
                    "direction": "asc",
                    "nulls": "last"
                }],
                "group": { "propertyId": "status" },
                "subgroup": null,
                "groupDirection": "asc",
                "completion": { "range": "all", "orderByRecency": false },
                "hierarchy": { "showSubPages": true, "nestedSubPages": false },
                "layouts": {
                    "board": { "fields": [], "showEmptyGroups": false },
                    "list": { "fields": [], "showEmptyGroups": false }
                }
            }
        })
    }

    #[test]
    fn storage_envelope_round_trips_a_strict_typed_definition() {
        let definition =
            decode_definition_value(stored_definition()).expect("typed View definition");
        let encoded = encode_definition_json(&definition).expect("storage encoding");
        let round_tripped = decode_definition_json(&encoded).expect("round-tripped definition");

        assert_eq!(round_tripped, definition);
    }

    #[test]
    fn storage_envelope_rejects_unknown_fields_and_versions() {
        let mut unsupported = stored_definition();
        unsupported["schemaVersion"] = json!(5);
        assert!(decode_definition_value(unsupported).is_err());

        let mut unknown = stored_definition();
        unknown["filter"]["extra"] = json!(true);
        assert!(decode_definition_value(unknown).is_err());
    }
}
