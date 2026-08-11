use rusqlite::{Connection, params};
use serde_json::{Value, json};

use super::property_semantics::PRIORITY_OPTIONS;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_database_authority_records(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
    data_source_id: &str,
    view_id: &str,
    name: &str,
    now: &str,
) -> Result<(), StoreError> {
    create_database_authority_records_for_contract(
        connection,
        library_id,
        database_id,
        data_source_id,
        view_id,
        name,
        now,
        GenesisViewContract::Current,
    )
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn create_legacy_v2_database_authority_records(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
    data_source_id: &str,
    view_id: &str,
    name: &str,
    now: &str,
) -> Result<(), StoreError> {
    create_database_authority_records_for_contract(
        connection,
        library_id,
        database_id,
        data_source_id,
        view_id,
        name,
        now,
        GenesisViewContract::LegacyV2,
    )
}

enum GenesisViewContract {
    Current,
    #[cfg(test)]
    LegacyV2,
}

#[allow(clippy::too_many_arguments)]
fn create_database_authority_records_for_contract(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
    data_source_id: &str,
    view_id: &str,
    name: &str,
    now: &str,
    contract: GenesisViewContract,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO database_containers(\
           block_id, library_id, name, lifecycle, default_view_id, access_revision, \
           metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 'active', NULL, 1, 1, ?4, ?4)",
        params![database_id, library_id, name, now],
    )?;
    connection.execute(
        "INSERT INTO data_sources(\
           id, library_id, home_database_block_id, name, schema_key, schema_revision, \
           lifecycle, rank_key, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, 'nodex.database', 1, 'active', ?5, ?6, ?6)",
        params![
            data_source_id,
            library_id,
            database_id,
            name,
            fractional_rank(1, 1),
            now
        ],
    )?;
    for (index, (id, property_name, value_type, config)) in
        initial_property_definitions().into_iter().enumerate()
    {
        connection.execute(
            "INSERT INTO data_source_properties(\
               data_source_id, id, name, value_type, config_json, rank_key, lifecycle, \
               schema_revision, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 1, ?7, ?7)",
            params![
                data_source_id,
                id,
                property_name,
                value_type,
                serde_json::to_string(&config).map_err(|_| internal("Initial Property config"))?,
                fractional_rank(index + 1, 8),
                now,
            ],
        )?;
    }
    let current_view_config = json!({
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
                "board": {
                    "fields": [
                        { "kind": "property", "propertyId": "status" },
                        { "kind": "property", "propertyId": "priority" },
                        { "kind": "property", "propertyId": "estimate" },
                        { "kind": "property", "propertyId": "tags" }
                    ],
                    "showEmptyGroups": false
                },
                "list": {
                    "fields": [
                        { "kind": "property", "propertyId": "status" },
                        { "kind": "property", "propertyId": "priority" },
                        { "kind": "property", "propertyId": "estimate" },
                        { "kind": "property", "propertyId": "tags" }
                    ],
                    "showEmptyGroups": false
                }
            }
        }
    });
    #[cfg(test)]
    let legacy_view_config = json!({
        "schemaKey": "nodex.database-view",
        "schemaVersion": 2,
        "filter": { "kind": "group", "operator": "and", "children": [] },
        "sort": [{
            "field": { "kind": "manual" },
            "direction": "asc",
            "nulls": "last"
        }],
        "group": { "propertyId": "status" },
        "display": {
            "propertyIds": ["status", "priority", "estimate", "tags"],
            "showTitle": true
        }
    });
    let (column, layout, title, view_config) = match contract {
        GenesisViewContract::Current => ("default_layout", "board", "Board", current_view_config),
        #[cfg(test)]
        GenesisViewContract::LegacyV2 => ("kind", "kanban", "Kanban", legacy_view_config),
    };
    connection.execute(
        &format!(
            "INSERT INTO database_views(\
               id, database_block_id, data_source_id, name, {column}, config_json, revision, \
               rank_key, lifecycle, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, 'active', ?8, ?8)"
        ),
        params![
            view_id,
            database_id,
            data_source_id,
            title,
            layout,
            serde_json::to_string(&view_config).map_err(|_| internal("Initial View config"))?,
            fractional_rank(1, 1),
            now,
        ],
    )?;
    let changed = connection.execute(
        "UPDATE database_containers SET default_view_id = ?1 WHERE block_id = ?2",
        params![view_id, database_id],
    )?;
    if changed == 1 {
        return Ok(());
    }
    Err(corrupt("Created Database Container disappeared"))
}

fn initial_property_definitions() -> Vec<(&'static str, &'static str, &'static str, Value)> {
    vec![
        (
            "status",
            "Status",
            "select",
            json!({
                "options": [
                    { "id": "triage", "name": "Triage" },
                    { "id": "plan", "name": "Plan" },
                    { "id": "build", "name": "Build" },
                    { "id": "review", "name": "Review" },
                    { "id": "ship", "name": "Ship" }
                ]
            }),
        ),
        (
            "priority",
            "Priority",
            "select",
            json!({
                "options": PRIORITY_OPTIONS.map(|(id, name)| json!({
                    "id": id,
                    "name": name,
                }))
            }),
        ),
        (
            "estimate",
            "Estimate",
            "select",
            json!({
                "options": [
                    { "id": "xs", "name": "XS" },
                    { "id": "s", "name": "S" },
                    { "id": "m", "name": "M" },
                    { "id": "l", "name": "L" },
                    { "id": "xl", "name": "XL" }
                ]
            }),
        ),
        ("tags", "Tags", "multi_select", json!({ "options": [] })),
        ("due_date", "Due date", "date", json!({})),
        ("scheduled_start", "Scheduled start", "datetime", json!({})),
        ("scheduled_end", "Scheduled end", "datetime", json!({})),
        ("assignee", "Assignee", "text", json!({})),
    ]
}

fn fractional_rank(ordinal: usize, total: usize) -> String {
    let divisor = (total + 1) as u128;
    let ordinal = ordinal as u128;
    let value = (u128::MAX / divisor) * ordinal + ((u128::MAX % divisor) * ordinal) / divisor;
    format!("{value:032x}")
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
