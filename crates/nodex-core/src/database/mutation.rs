use std::collections::{BTreeSet, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use nodex_core_contracts::database::{
    DatabaseCommitValue, DatabaseEvent, DatabaseEventKind, DatabaseIntent, DatabasePageValue,
    DatabaseReceipt,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CommittedModuleValue,
    CoreModuleEventPayload, ModuleApplyRequest, ModuleMutationReceipt, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::document::{read_store_epoch, sha256};
use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::writer::StoreWriter;

use super::DatabaseApplyOutcome;

const MODULE_NAME: &str = "database";
const MAX_OPERATIONS: usize = 64;
const MAX_BULK_VALUES: usize = 4_096;
const MAX_ID_LENGTH: usize = 512;
const MAX_PROPERTY_ID_LENGTH: usize = 128;
const MAX_NAME_LENGTH: usize = 256;
const MAX_OPTIONS: usize = 10_000;

#[derive(Default)]
struct MutationEffects {
    database_ids: BTreeSet<String>,
    data_source_ids: BTreeSet<String>,
    page_ids: BTreeSet<String>,
    view_ids: BTreeSet<String>,
}

#[derive(Debug)]
struct SourceRow {
    id: String,
    database_id: String,
    lifecycle: String,
    revision: i64,
}

#[derive(Debug)]
struct PropertyRow {
    id: String,
    value_type: String,
    config_json: String,
    rank_key: String,
    lifecycle: String,
    revision: i64,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct PropertyOption {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OptionConfig {
    options: Vec<PropertyOption>,
}

pub(super) fn apply(
    writer: &StoreWriter,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: ModuleApplyRequest<Vec<DatabaseIntent>>,
) -> Result<DatabaseApplyOutcome, StoreError> {
    validate_request(&request)?;
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let context = context.clone();
    writer.call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            assert_identity(transaction, &profile_id, &library_id)?;
            let project_id = active_project_id(transaction, &library_id, &context)?;
            let store_epoch = read_store_epoch(transaction)?;
            if request.store_epoch.0 != store_epoch {
                return Err(StoreError::new(
                    StoreErrorCode::Conflict,
                    "Database mutation targets a stale store epoch",
                    true,
                ));
            }
            let fingerprint = serde_json::to_vec(&(
                &context,
                request.version,
                &request.store_epoch,
                &request.intent,
            ))
            .map_err(|_| internal("Database mutation cannot be fingerprinted"))?;
            let request_hash = sha256(&fingerprint);
            if let Some(stored) =
                read_module_receipt(transaction, MODULE_NAME, &request.operation_id)?
            {
                if stored.request_hash != request_hash {
                    return Err(StoreError::new(
                        StoreErrorCode::IdempotencyKeyReused,
                        "operation_id is already bound to another Database intent",
                        false,
                    ));
                }
                let mut committed = serde_json::from_value::<
                    CommittedModuleValue<DatabaseCommitValue, DatabaseReceipt>,
                >(stored.result)
                .map_err(|_| corrupt("Stored Database receipt is invalid"))?;
                committed.receipt.mutation.duplicate = true;
                return Ok(DatabaseApplyOutcome {
                    committed,
                    event: None,
                });
            }

            let now = unix_timestamp_millis();
            let mut effects = MutationEffects::default();
            for intent in &request.intent {
                apply_intent(
                    transaction,
                    &library_id,
                    &project_id,
                    intent,
                    &now,
                    &mut effects,
                )?;
            }
            commit(
                transaction,
                &context,
                &request,
                &store_epoch,
                &request_hash,
                &project_id,
                &now,
                effects,
            )
        })
    })
}

fn validate_request(request: &ModuleApplyRequest<Vec<DatabaseIntent>>) -> Result<(), StoreError> {
    validate_id(&request.operation_id, "operation_id", MAX_ID_LENGTH)?;
    if request.intent.is_empty() || request.intent.len() > MAX_OPERATIONS {
        return Err(invalid(format!(
            "Database apply requires between 1 and {MAX_OPERATIONS} operations"
        )));
    }
    for intent in &request.intent {
        if let DatabaseIntent::SetValues { values } = intent
            && (values.is_empty() || values.len() > MAX_BULK_VALUES)
        {
            return Err(invalid(format!(
                "set_values requires between 1 and {MAX_BULK_VALUES} values"
            )));
        }
    }
    Ok(())
}

fn apply_intent(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    intent: &DatabaseIntent,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    match intent {
        DatabaseIntent::PutProperty {
            data_source_id,
            property_id,
            expected_data_source_revision,
            expected_property_revision,
            name,
            value_type,
            before_property_id,
        } => put_property(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            *expected_data_source_revision,
            *expected_property_revision,
            name,
            value_type,
            before_property_id.as_deref(),
            now,
            effects,
        ),
        DatabaseIntent::DeleteProperty {
            data_source_id,
            property_id,
            expected_data_source_revision,
            expected_property_revision,
        } => delete_property(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            *expected_data_source_revision,
            *expected_property_revision,
            now,
            effects,
        ),
        DatabaseIntent::PutOption {
            data_source_id,
            property_id,
            option_id,
            name,
            color,
            expected_property_revision,
        } => put_option(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            option_id,
            name,
            color.as_deref(),
            *expected_property_revision,
            now,
            effects,
        ),
        DatabaseIntent::DeleteOption {
            data_source_id,
            property_id,
            option_id,
            expected_property_revision,
        } => delete_option(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            option_id,
            *expected_property_revision,
            now,
            effects,
        ),
        DatabaseIntent::SetValue {
            page_id,
            data_source_id,
            property_id,
            expected_value_revision,
            value,
        } => set_value(
            connection,
            library_id,
            project_id,
            &DatabasePageValue {
                page_id: page_id.clone(),
                data_source_id: data_source_id.clone(),
                property_id: property_id.clone(),
                expected_value_revision: *expected_value_revision,
                value: value.clone(),
            },
            now,
            effects,
        ),
        DatabaseIntent::SetValues { values } => {
            for value in values {
                set_value(connection, library_id, project_id, value, now, effects)?;
            }
            Ok(())
        }
        DatabaseIntent::AddRemoveValue {
            page_id,
            data_source_id,
            property_id,
            add,
            remove,
        } => add_remove_value(
            connection,
            library_id,
            project_id,
            page_id,
            data_source_id,
            property_id,
            add,
            remove,
            now,
            effects,
        ),
        _ => Err(invalid(
            "Database operation is not implemented by this mutation slice",
        )),
    }
}

#[allow(clippy::too_many_arguments)]
fn put_property(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    expected_source_revision: i64,
    expected_property_revision: i64,
    name: &str,
    value_type: &str,
    before_property_id: Option<&str>,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    validate_id(data_source_id, "data_source_id", MAX_ID_LENGTH)?;
    validate_id(property_id, "property_id", MAX_PROPERTY_ID_LENGTH)?;
    let name = validate_name(name, "Property name")?;
    validate_value_type(value_type)?;
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(connection, project_id, &source.database_id)?;
    require_revision(
        expected_source_revision,
        source.revision,
        "Data Source revision changed",
    )?;
    let existing = property_row(connection, data_source_id, property_id)?;
    require_revision(
        expected_property_revision,
        existing.as_ref().map_or(0, |property| property.revision),
        "Property revision changed",
    )?;
    let config = property_config_for_put(
        connection,
        data_source_id,
        property_id,
        value_type,
        existing.as_ref(),
    )?;
    let preserve_rank = existing
        .as_ref()
        .filter(|property| property.lifecycle == "active" && before_property_id.is_none())
        .map(|property| property.rank_key.clone());
    let rank_key = preserve_rank.clone().unwrap_or_else(|| "0".repeat(32));
    let property_revision = existing
        .as_ref()
        .map_or(1, |property| property.revision + 1);
    let created_at = existing
        .as_ref()
        .map_or(now, |property| property.created_at.as_str());
    connection.execute(
        "INSERT INTO data_source_properties(\
           data_source_id, id, name, value_type, config_json, rank_key, lifecycle, \
           schema_revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9) \
         ON CONFLICT(data_source_id, id) DO UPDATE SET \
           name = excluded.name, value_type = excluded.value_type, \
           config_json = excluded.config_json, rank_key = excluded.rank_key, \
           lifecycle = 'active', schema_revision = excluded.schema_revision, \
           updated_at = excluded.updated_at",
        params![
            data_source_id,
            property_id,
            name,
            value_type,
            serde_json::to_string(&config).map_err(|_| internal("Property config"))?,
            rank_key,
            property_revision,
            created_at,
            now,
        ],
    )?;
    if preserve_rank.is_none() {
        reorder_properties(connection, data_source_id, property_id, before_property_id)?;
    }
    let source_revision = source.revision + 1;
    connection.execute(
        "UPDATE data_sources SET schema_revision = ?1, updated_at = ?2 WHERE id = ?3",
        params![source_revision, now, data_source_id],
    )?;
    touch_source(effects, &source);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn delete_property(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    expected_source_revision: i64,
    expected_property_revision: i64,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(connection, project_id, &source.database_id)?;
    require_revision(
        expected_source_revision,
        source.revision,
        "Data Source revision changed",
    )?;
    let property = property_row(connection, data_source_id, property_id)?
        .ok_or_else(|| not_found("Property is unavailable"))?;
    if property.lifecycle != "active" {
        return Err(not_found("Property is not active"));
    }
    require_revision(
        expected_property_revision,
        property.revision,
        "Property revision changed",
    )?;
    if active_view_references_property(connection, data_source_id, property_id)? {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Property is referenced by an active Database View",
            false,
        ));
    }
    connection.execute(
        "UPDATE data_source_properties SET lifecycle = 'deleted', \
           schema_revision = schema_revision + 1, updated_at = ?1 \
         WHERE data_source_id = ?2 AND id = ?3",
        params![now, data_source_id, property_id],
    )?;
    connection.execute(
        "UPDATE data_sources SET schema_revision = schema_revision + 1, updated_at = ?1 \
         WHERE id = ?2",
        params![now, data_source_id],
    )?;
    touch_source(effects, &source);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn put_option(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    option_id: &str,
    name: &str,
    color: Option<&str>,
    expected_property_revision: i64,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    validate_id(option_id, "option_id", MAX_PROPERTY_ID_LENGTH)?;
    let name = validate_name(name, "Option name")?;
    if color.is_some_and(|value| value.is_empty() || value.len() > 128) {
        return Err(invalid("Option color must contain between 1 and 128 bytes"));
    }
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(connection, project_id, &source.database_id)?;
    let property = active_property(connection, data_source_id, property_id)?;
    require_revision(
        expected_property_revision,
        property.revision,
        "Property revision changed",
    )?;
    let mut config = option_config(&property)?;
    if property_id == "tags"
        && config
            .options
            .iter()
            .any(|option| option.id != option_id && option.name == name)
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Tags options must have unique canonical names",
            false,
        ));
    }
    let next = PropertyOption {
        id: option_id.to_owned(),
        name: name.to_owned(),
        color: color.map(str::to_owned),
    };
    if let Some(existing) = config
        .options
        .iter_mut()
        .find(|option| option.id == option_id)
    {
        if *existing == next {
            return Ok(());
        }
        *existing = next;
    } else {
        if config.options.len() >= MAX_OPTIONS {
            return Err(invalid("Property option registry exceeds its bound"));
        }
        config.options.push(next);
    }
    persist_option_config(connection, &source, &property, &config, now)?;
    if property_id == "tags" {
        refresh_tag_projections(connection, data_source_id, &config, now, effects)?;
    }
    touch_source(effects, &source);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn delete_option(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    option_id: &str,
    expected_property_revision: i64,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(connection, project_id, &source.database_id)?;
    let property = active_property(connection, data_source_id, property_id)?;
    require_revision(
        expected_property_revision,
        property.revision,
        "Property revision changed",
    )?;
    let mut config = option_config(&property)?;
    if !config.options.iter().any(|option| option.id == option_id) {
        return Err(not_found("Property option is unavailable"));
    }
    let mut statement = connection.prepare(
        "SELECT value_json FROM data_source_property_values \
         WHERE data_source_id = ?1 AND property_id = ?2",
    )?;
    let values = statement
        .query_map(params![data_source_id, property_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for value in values {
        let value = parse_json(&value, "Property value")?;
        if value == Value::String(option_id.to_owned())
            || value
                .as_array()
                .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(option_id)))
        {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "Property option is selected by an existing Page",
                false,
            ));
        }
    }
    config.options.retain(|option| option.id != option_id);
    persist_option_config(connection, &source, &property, &config, now)?;
    touch_source(effects, &source);
    Ok(())
}

fn set_value(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    input: &DatabasePageValue,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let source = require_source(connection, library_id, &input.data_source_id)?;
    authorize_write(connection, project_id, &source.database_id)?;
    let property = active_property(connection, &input.data_source_id, &input.property_id)?;
    let membership = connection
        .query_row(
            "SELECT id FROM data_source_page_memberships \
             WHERE data_source_id = ?1 AND page_block_id = ?2 AND removed_at IS NULL",
            params![input.data_source_id, input.page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Page has no active membership in the Data Source"))?;
    let active_row = connection
        .query_row(
            "SELECT 1 FROM pages WHERE block_id = ?1 AND parent_kind = 'data_source' \
             AND parent_id = ?2 AND lifecycle = 'active'",
            params![input.page_id, input.data_source_id],
            |_| Ok(()),
        )
        .optional()?;
    if active_row.is_none() {
        return Err(not_found("Page is not an active row in the Data Source"));
    }
    let existing_revision = connection
        .query_row(
            "SELECT revision FROM data_source_property_values \
             WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
            params![input.data_source_id, membership, input.property_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    require_revision(
        input.expected_value_revision,
        existing_revision,
        "Property value revision changed",
    )?;
    let value = normalize_value(&property, &input.value)?;
    let revision = existing_revision + 1;
    connection.execute(
        "INSERT INTO data_source_property_values(\
           data_source_id, membership_id, property_id, value_type, value_json, revision, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(data_source_id, membership_id, property_id) DO UPDATE SET \
           value_type = excluded.value_type, value_json = excluded.value_json, \
           revision = excluded.revision, updated_at = excluded.updated_at",
        params![
            input.data_source_id,
            membership,
            input.property_id,
            property.value_type,
            serde_json::to_string(&value).map_err(|_| internal("Property value"))?,
            revision,
            now,
        ],
    )?;
    update_grouped_positions(
        connection,
        &input.data_source_id,
        &input.property_id,
        &input.page_id,
        &value,
        now,
        effects,
    )?;
    let metadata_revision = connection
        .query_row(
            "UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?1 \
             WHERE id = ?2 AND type = 'page' RETURNING metadata_revision",
            params![now, input.page_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Database row Page disappeared during value commit"))?;
    refresh_value_projection(
        connection,
        &input.page_id,
        &input.property_id,
        &value,
        revision,
        metadata_revision,
        &property,
        now,
    )?;
    touch_source(effects, &source);
    effects.page_ids.insert(input.page_id.clone());
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn add_remove_value(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    page_id: &str,
    data_source_id: &str,
    property_id: &str,
    add: &[String],
    remove: &[String],
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let property = active_property(connection, data_source_id, property_id)?;
    if property.value_type != "multi_select" {
        return Err(invalid("add_remove_value requires a multi_select Property"));
    }
    let config = option_config(&property)?;
    let known = config
        .options
        .iter()
        .map(|option| option.id.as_str())
        .collect::<HashSet<_>>();
    if add
        .iter()
        .chain(remove)
        .any(|option_id| !known.contains(option_id.as_str()))
    {
        return Err(invalid("add_remove_value references an unknown option"));
    }
    let membership = connection
        .query_row(
            "SELECT id FROM data_source_page_memberships \
             WHERE data_source_id = ?1 AND page_block_id = ?2 AND removed_at IS NULL",
            params![data_source_id, page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Page has no active membership in the Data Source"))?;
    let existing = connection
        .query_row(
            "SELECT value_json, revision FROM data_source_property_values \
             WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
            params![data_source_id, membership, property_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    let mut selection = match &existing {
        Some((value, _)) => normalize_value(&property, &parse_json(value, "Property value")?)?
            .as_array()
            .cloned()
            .ok_or_else(|| corrupt("Stored multi_select value is not an array"))?
            .into_iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| corrupt("Stored multi_select option is invalid"))
            })
            .collect::<Result<BTreeSet<_>, _>>()?,
        None => BTreeSet::new(),
    };
    let before = selection.clone();
    for option_id in remove {
        selection.remove(option_id);
    }
    selection.extend(add.iter().cloned());
    if selection == before {
        return Ok(());
    }
    set_value(
        connection,
        library_id,
        project_id,
        &DatabasePageValue {
            page_id: page_id.to_owned(),
            data_source_id: data_source_id.to_owned(),
            property_id: property_id.to_owned(),
            expected_value_revision: existing.as_ref().map_or(0, |(_, revision)| *revision),
            value: Value::Array(selection.into_iter().map(Value::String).collect()),
        },
        now,
        effects,
    )
}

fn property_config_for_put(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
    value_type: &str,
    existing: Option<&PropertyRow>,
) -> Result<Value, StoreError> {
    if let Some(existing) = existing {
        if existing.value_type == value_type {
            return parse_json(&existing.config_json, "Property config");
        }
        let count = connection.query_row(
            "SELECT count(*) FROM data_source_property_values \
             WHERE data_source_id = ?1 AND property_id = ?2",
            params![data_source_id, property_id],
            |row| row.get::<_, i64>(0),
        )?;
        if count > 0 {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "Property value type cannot change while values exist",
                false,
            ));
        }
    }
    if matches!(value_type, "select" | "multi_select") {
        return Ok(json!({ "options": [] }));
    }
    Ok(json!({}))
}

fn reorder_properties(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
    before_property_id: Option<&str>,
) -> Result<(), StoreError> {
    let mut ids = connection
        .prepare(
            "SELECT id FROM data_source_properties \
             WHERE data_source_id = ?1 AND lifecycle = 'active' ORDER BY rank_key, id",
        )?
        .query_map([data_source_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.retain(|id| id != property_id);
    let index = match before_property_id {
        Some(before) => ids.iter().position(|id| id == before).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Property placement anchor changed",
                true,
            )
        })?,
        None => ids.len(),
    };
    ids.insert(index, property_id.to_owned());
    let mut update = connection.prepare(
        "UPDATE data_source_properties SET rank_key = ?1 \
         WHERE data_source_id = ?2 AND id = ?3",
    )?;
    let total = ids.len();
    for (index, id) in ids.into_iter().enumerate() {
        update.execute(params![
            fractional_rank(index + 1, total),
            data_source_id,
            id
        ])?;
    }
    Ok(())
}

fn active_view_references_property(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<bool, StoreError> {
    let configs = connection
        .prepare(
            "SELECT config_json FROM database_views \
             WHERE data_source_id = ?1 AND lifecycle = 'active'",
        )?
        .query_map([data_source_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for config in configs {
        if json_contains_string(&parse_json(&config, "Database View config")?, property_id) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn json_contains_string(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(value) => value == needle,
        Value::Array(values) => values
            .iter()
            .any(|value| json_contains_string(value, needle)),
        Value::Object(values) => values
            .values()
            .any(|value| json_contains_string(value, needle)),
        _ => false,
    }
}

fn option_config(property: &PropertyRow) -> Result<OptionConfig, StoreError> {
    if !matches!(property.value_type.as_str(), "select" | "multi_select") {
        return Err(invalid("Property is not option-backed"));
    }
    let config = serde_json::from_str::<OptionConfig>(&property.config_json)
        .map_err(|_| corrupt("Property option registry is invalid"))?;
    if config.options.len() > MAX_OPTIONS {
        return Err(corrupt("Property option registry exceeds its bound"));
    }
    let mut ids = HashSet::new();
    for option in &config.options {
        validate_id(&option.id, "option.id", MAX_PROPERTY_ID_LENGTH)
            .map_err(|_| corrupt("Stored Property option ID is invalid"))?;
        validate_name(&option.name, "option.name")
            .map_err(|_| corrupt("Stored Property option name is invalid"))?;
        if !ids.insert(option.id.as_str()) {
            return Err(corrupt("Property option registry repeats an ID"));
        }
    }
    Ok(config)
}

fn persist_option_config(
    connection: &Connection,
    source: &SourceRow,
    property: &PropertyRow,
    config: &OptionConfig,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "UPDATE data_source_properties SET config_json = ?1, \
           schema_revision = schema_revision + 1, updated_at = ?2 \
         WHERE data_source_id = ?3 AND id = ?4",
        params![
            serde_json::to_string(config).map_err(|_| internal("Property option registry"))?,
            now,
            source.id,
            property.id,
        ],
    )?;
    connection.execute(
        "UPDATE data_sources SET schema_revision = schema_revision + 1, updated_at = ?1 \
         WHERE id = ?2",
        params![now, source.id],
    )?;
    Ok(())
}

fn normalize_value(property: &PropertyRow, value: &Value) -> Result<Value, StoreError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    match property.value_type.as_str() {
        "text" | "person" => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| invalid("Property requires a string or null value")),
        "number" => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|_| value.clone())
            .ok_or_else(|| invalid("number requires a finite number or null value")),
        "checkbox" => value
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| invalid("checkbox requires a boolean or null value")),
        "date" => value
            .as_str()
            .filter(|value| valid_iso_date(value))
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| invalid("date requires a valid YYYY-MM-DD value or null")),
        "datetime" => value
            .as_str()
            .filter(|value| valid_canonical_datetime(value))
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| invalid("datetime requires a canonical UTC RFC 3339 value or null")),
        "select" => {
            let option_id = value
                .as_str()
                .ok_or_else(|| invalid("select requires an option ID or null"))?;
            let config = option_config(property)?;
            if config.options.iter().any(|option| option.id == option_id) {
                return Ok(Value::String(option_id.to_owned()));
            }
            Err(invalid("select references an unknown option"))
        }
        "multi_select" => {
            let values = value
                .as_array()
                .ok_or_else(|| invalid("multi_select requires an option ID array or null"))?;
            let config = option_config(property)?;
            let known = config
                .options
                .iter()
                .map(|option| option.id.as_str())
                .collect::<HashSet<_>>();
            let mut normalized = BTreeSet::new();
            for value in values {
                let option_id = value
                    .as_str()
                    .ok_or_else(|| invalid("multi_select contains a non-string option ID"))?;
                if !known.contains(option_id) {
                    return Err(invalid("multi_select references an unknown option"));
                }
                normalized.insert(option_id.to_owned());
            }
            Ok(Value::Array(
                normalized.into_iter().map(Value::String).collect(),
            ))
        }
        _ => Err(corrupt("Stored Property has an unsupported value type")),
    }
}

#[allow(clippy::too_many_arguments)]
fn update_grouped_positions(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
    page_id: &str,
    value: &Value,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let views = connection
        .prepare(
            "SELECT id, config_json FROM database_views \
             WHERE data_source_id = ?1 AND lifecycle = 'active' ORDER BY id",
        )?
        .query_map([data_source_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (view_id, config) in views {
        let config = parse_json(&config, "Database View config")?;
        if config.pointer("/group/propertyId").and_then(Value::as_str) != Some(property_id) {
            continue;
        }
        let group_key = database_group_key(value)?;
        let changed = connection.execute(
            "UPDATE database_view_page_positions SET group_key = ?1, \
               revision = revision + 1, updated_at = ?2 \
             WHERE view_id = ?3 AND page_block_id = ?4",
            params![group_key, now, view_id, page_id],
        )?;
        if changed == 0 {
            continue;
        }
        connection.execute(
            "UPDATE page_read_model SET view_group_key = ?1, \
               projection_version = projection_version + 1, updated_at = ?2 \
             WHERE page_block_id = ?3 AND view_id = ?4",
            params![group_key, now, page_id, view_id],
        )?;
        effects.view_ids.insert(view_id);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn refresh_value_projection(
    connection: &Connection,
    page_id: &str,
    property_id: &str,
    value: &Value,
    value_revision: i64,
    metadata_revision: i64,
    property: &PropertyRow,
    now: &str,
) -> Result<(), StoreError> {
    let row = connection
        .query_row(
            "SELECT database_values_json, property_revisions_json \
             FROM page_read_model WHERE page_block_id = ?1",
            [page_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((values_json, revisions_json)) = row else {
        return Ok(());
    };
    let mut values = json_object(&values_json, "Page Database values")?;
    let mut revisions = json_object(&revisions_json, "Page Property revisions")?;
    let projected_value = if property.id == "tags" {
        tag_compatibility_value(property, value)?
    } else {
        value.clone()
    };
    values.insert(property_id.to_owned(), projected_value);
    let database = revisions
        .entry("database".to_owned())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| corrupt("Page Database revision projection is not an object"))?;
    database.insert(property_id.to_owned(), Value::from(value_revision));
    connection.execute(
        "UPDATE page_read_model SET metadata_revision = ?1, database_values_json = ?2, \
           property_revisions_json = ?3, projection_version = projection_version + 1, \
           updated_at = ?4 WHERE page_block_id = ?5",
        params![
            metadata_revision,
            serde_json::to_string(&values).map_err(|_| internal("Page Database values"))?,
            serde_json::to_string(&revisions).map_err(|_| internal("Page Property revisions"))?,
            now,
            page_id,
        ],
    )?;
    Ok(())
}

fn refresh_tag_projections(
    connection: &Connection,
    data_source_id: &str,
    config: &OptionConfig,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let rows = connection
        .prepare(
            "SELECT membership.page_block_id, value.value_json \
             FROM data_source_property_values value \
             JOIN data_source_page_memberships membership \
               ON membership.id = value.membership_id \
               AND membership.data_source_id = value.data_source_id \
             WHERE value.data_source_id = ?1 AND value.property_id = 'tags' \
               AND membership.removed_at IS NULL",
        )?
        .query_map([data_source_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let names = config
        .options
        .iter()
        .map(|option| (option.id.as_str(), option.name.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    for (page_id, value_json) in rows {
        let value = parse_json(&value_json, "Tags value")?;
        let Some(option_ids) = value.as_array() else {
            return Err(corrupt("Stored tags value is not an array"));
        };
        let projected = option_ids
            .iter()
            .map(|value| {
                let option_id = value
                    .as_str()
                    .ok_or_else(|| corrupt("Stored tags option is invalid"))?;
                names
                    .get(option_id)
                    .map(|name| Value::String((*name).to_owned()))
                    .ok_or_else(|| corrupt("Stored tags value references an unknown option"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let Some(values_json) = connection
            .query_row(
                "SELECT database_values_json FROM page_read_model WHERE page_block_id = ?1",
                [&page_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        else {
            continue;
        };
        let mut values = json_object(&values_json, "Page Database values")?;
        if values.get("tags") == Some(&Value::Array(projected.clone())) {
            continue;
        }
        values.insert("tags".to_owned(), Value::Array(projected));
        connection.execute(
            "UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?1 \
             WHERE id = ?2 AND type = 'page'",
            params![now, page_id],
        )?;
        connection.execute(
            "UPDATE page_read_model SET metadata_revision = metadata_revision + 1, \
               database_values_json = ?1, projection_version = projection_version + 1, \
               updated_at = ?2 WHERE page_block_id = ?3",
            params![
                serde_json::to_string(&values).map_err(|_| internal("Page Database values"))?,
                now,
                page_id,
            ],
        )?;
        effects.page_ids.insert(page_id);
    }
    Ok(())
}

fn tag_compatibility_value(property: &PropertyRow, value: &Value) -> Result<Value, StoreError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let config = option_config(property)?;
    let names = config
        .options
        .iter()
        .map(|option| (option.id.as_str(), option.name.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    let values = value
        .as_array()
        .ok_or_else(|| corrupt("Canonical tags value is not an array"))?;
    values
        .iter()
        .map(|value| {
            let option_id = value
                .as_str()
                .ok_or_else(|| corrupt("Canonical tags option is invalid"))?;
            names
                .get(option_id)
                .map(|name| Value::String((*name).to_owned()))
                .ok_or_else(|| corrupt("Canonical tags value references an unknown option"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn database_group_key(value: &Value) -> Result<Option<String>, StoreError> {
    if value.is_null() || value.as_str() == Some("") || value.as_array().is_some_and(Vec::is_empty)
    {
        return Ok(None);
    }
    if let Some(value) = value.as_str() {
        return Ok(Some(value.to_owned()));
    }
    serde_json::to_string(value)
        .map(Some)
        .map_err(|_| internal("Database group key"))
}

#[allow(clippy::too_many_arguments)]
fn commit(
    connection: &Connection,
    context: &BoundModuleContext,
    request: &ModuleApplyRequest<Vec<DatabaseIntent>>,
    store_epoch: &str,
    request_hash: &str,
    project_id: &str,
    now: &str,
    effects: MutationEffects,
) -> Result<DatabaseApplyOutcome, StoreError> {
    let database_ids = effects.database_ids.into_iter().collect::<Vec<_>>();
    let data_source_ids = effects.data_source_ids.into_iter().collect::<Vec<_>>();
    let page_ids = effects.page_ids.into_iter().collect::<Vec<_>>();
    let view_ids = effects.view_ids.into_iter().collect::<Vec<_>>();
    let block_ids = page_ids
        .iter()
        .chain(&database_ids)
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let payload = json!({
        "module": MODULE_NAME,
        "kind": "database_changed",
        "operationCount": request.intent.len(),
        "databaseIds": database_ids,
        "dataSourceIds": data_source_ids,
        "pageIds": page_ids,
        "viewIds": view_ids,
    });
    connection.execute(
        "INSERT INTO change_log(\
           project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
           database_block_ids_json, payload_json, committed_at\
         ) VALUES (?1, ?2, 'database.changed', ?3, ?4, '[]', ?5, ?6, ?7)",
        params![
            project_id,
            store_epoch,
            request.operation_id,
            serde_json::to_string(&block_ids).map_err(|_| internal("Database Block IDs"))?,
            serde_json::to_string(&database_ids).map_err(|_| internal("Database affected IDs"))?,
            serde_json::to_string(&payload).map_err(|_| internal("Database event payload"))?,
            now,
        ],
    )?;
    let event_sequence = connection.last_insert_rowid();
    let receipt = DatabaseReceipt {
        mutation: ModuleMutationReceipt {
            operation_id: request.operation_id.clone(),
            duplicate: false,
        },
        affected_database_ids: database_ids.clone(),
        affected_data_source_ids: data_source_ids.clone(),
        affected_page_ids: page_ids.clone(),
        affected_view_ids: view_ids.clone(),
    };
    let committed = CommittedModuleValue {
        value: DatabaseCommitValue {
            operation_count: u32::try_from(request.intent.len())
                .map_err(|_| internal("Database operation count"))?,
        },
        receipt,
        event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
    };
    insert_module_receipt(
        connection,
        NewModuleReceipt {
            module_name: MODULE_NAME,
            operation_id: &request.operation_id,
            context,
            operation_kind: "apply",
            store_epoch,
            request_hash,
            result: &serde_json::to_value(&committed)
                .map_err(|_| internal("Database receipt encoding"))?,
            event_sequence: Some(event_sequence),
            committed_at: now,
        },
    )?;
    let event = CommittedCoreModuleEvent {
        version: CORE_CONTRACT_VERSION,
        sequence: event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
        operation_id: Some(request.operation_id.clone()),
        committed_at: now.to_owned(),
        payload: CoreModuleEventPayload::Database(DatabaseEvent {
            kind: DatabaseEventKind::DatabaseChanged,
            database_ids,
            data_source_ids,
            page_ids,
            view_ids,
        }),
    };
    Ok(DatabaseApplyOutcome {
        committed,
        event: Some(event),
    })
}

fn require_source(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<SourceRow, StoreError> {
    let source = connection
        .query_row(
            "SELECT id, home_database_block_id, lifecycle, schema_revision \
             FROM data_sources WHERE id = ?1 AND library_id = ?2",
            params![data_source_id, library_id],
            |row| {
                Ok(SourceRow {
                    id: row.get(0)?,
                    database_id: row.get(1)?,
                    lifecycle: row.get(2)?,
                    revision: row.get(3)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Data Source is unavailable"))?;
    if source.lifecycle != "active" {
        return Err(not_found("Data Source is not active"));
    }
    Ok(source)
}

fn property_row(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<Option<PropertyRow>, StoreError> {
    connection
        .query_row(
            "SELECT id, value_type, config_json, rank_key, lifecycle, schema_revision, created_at \
             FROM data_source_properties WHERE data_source_id = ?1 AND id = ?2",
            params![data_source_id, property_id],
            |row| {
                Ok(PropertyRow {
                    id: row.get(0)?,
                    value_type: row.get(1)?,
                    config_json: row.get(2)?,
                    rank_key: row.get(3)?,
                    lifecycle: row.get(4)?,
                    revision: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(StoreError::from)
}

fn active_property(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<PropertyRow, StoreError> {
    let property = property_row(connection, data_source_id, property_id)?
        .ok_or_else(|| not_found("Property is unavailable"))?;
    if property.lifecycle != "active" {
        return Err(not_found("Property is not active"));
    }
    Ok(property)
}

fn authorize_write(
    connection: &Connection,
    project_id: &str,
    database_id: &str,
) -> Result<(), StoreError> {
    let primary = connection
        .query_row(
            "SELECT database_block_id FROM projects WHERE id = ?1 AND lifecycle = 'active'",
            [project_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten()
        .or(connection
            .query_row(
                "SELECT database_block_id FROM project_database_bindings \
                 WHERE project_id = ?1 AND lifecycle = 'active'",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?);
    if primary.as_deref() == Some(database_id) {
        return Ok(());
    }
    let direct = connection
        .query_row(
            "SELECT 1 FROM project_resource_grants WHERE project_id = ?1 \
             AND root_kind = 'database' AND root_id = ?2 AND access = 'read_write' \
             AND lifecycle = 'active'",
            params![project_id, database_id],
            |_| Ok(()),
        )
        .optional()?;
    if direct.is_some() {
        return Ok(());
    }
    let document_id = connection
        .query_row(
            "SELECT containing_document_id FROM blocks WHERE id = ?1 AND type = 'database'",
            [database_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(document_id) = document_id else {
        return Err(unauthorized("Project cannot mutate this Database"));
    };
    let owner_page_id = connection
        .query_row(
            "SELECT page.block_id FROM block_documents ownership \
             JOIN pages page ON page.block_id = ownership.block_id \
             WHERE ownership.document_id = ?1",
            [document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Embedded Database has no owning Page"))?;
    let inherited = connection
        .query_row(
            "WITH RECURSIVE ancestors(page_id) AS (\
               SELECT ?2 UNION ALL SELECT page.parent_id FROM pages page JOIN ancestors current \
                 ON page.block_id = current.page_id WHERE page.parent_kind = 'page'\
             ) SELECT 1 FROM project_resource_grants grant_row JOIN ancestors \
               ON grant_row.root_id = ancestors.page_id \
             WHERE grant_row.project_id = ?1 AND grant_row.root_kind = 'page' \
               AND grant_row.access = 'read_write' AND grant_row.lifecycle = 'active' LIMIT 1",
            params![project_id, owner_page_id],
            |_| Ok(()),
        )
        .optional()?;
    if inherited.is_some() {
        return Ok(());
    }
    Err(unauthorized("Project cannot mutate this Database"))
}

fn active_project_id(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
) -> Result<String, StoreError> {
    let project_id = context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| unauthorized("Database mutations require a bound Project"))?;
    connection
        .query_row(
            "SELECT id FROM projects WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![project_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| unauthorized("Bound Project is not active in this Library"))
}

fn assert_identity(
    connection: &Connection,
    profile_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    let valid = connection
        .query_row(
            "SELECT 1 FROM libraries WHERE id = ?1 AND profile_id = ?2",
            params![library_id, profile_id],
            |_| Ok(()),
        )
        .optional()?;
    if valid.is_some() {
        return Ok(());
    }
    Err(unauthorized(
        "bound Database identity is not present in this Profile store",
    ))
}

fn touch_source(effects: &mut MutationEffects, source: &SourceRow) {
    effects.database_ids.insert(source.database_id.clone());
    effects.data_source_ids.insert(source.id.clone());
}

fn validate_id(value: &str, label: &str, maximum: usize) -> Result<(), StoreError> {
    if !value.trim().is_empty() && value.len() <= maximum {
        return Ok(());
    }
    Err(invalid(format!(
        "{label} must contain between 1 and {maximum} bytes"
    )))
}

fn validate_name<'a>(value: &'a str, label: &str) -> Result<&'a str, StoreError> {
    let value = value.trim();
    if !value.is_empty() && value.len() <= MAX_NAME_LENGTH {
        return Ok(value);
    }
    Err(invalid(format!(
        "{label} must contain between 1 and {MAX_NAME_LENGTH} bytes"
    )))
}

fn validate_value_type(value_type: &str) -> Result<(), StoreError> {
    if matches!(
        value_type,
        "text" | "number" | "checkbox" | "select" | "multi_select" | "date" | "datetime" | "person"
    ) {
        return Ok(());
    }
    Err(invalid("Property value_type is unsupported"))
}

fn require_revision(expected: i64, actual: i64, message: &str) -> Result<(), StoreError> {
    if expected == actual {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::RevisionConflict,
        format!("{message}: expected {expected}, current {actual}"),
        true,
    ))
}

fn fractional_rank(ordinal: usize, total: usize) -> String {
    let divisor = (total + 1) as u128;
    let ordinal = ordinal as u128;
    let value = (u128::MAX / divisor) * ordinal + ((u128::MAX % divisor) * ordinal) / divisor;
    format!("{value:032x}")
}

fn valid_iso_date(value: &str) -> bool {
    if value.len() != 10 || &value[4..5] != "-" || &value[7..8] != "-" {
        return false;
    }
    let Ok(year) = value[0..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u32>() else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=maximum).contains(&day)
}

fn valid_canonical_datetime(value: &str) -> bool {
    let Some((date, time)) = value.split_once('T') else {
        return false;
    };
    if !valid_iso_date(date) || !time.ends_with('Z') {
        return false;
    }
    let time = &time[..time.len() - 1];
    let Some((hour, rest)) = time.split_once(':') else {
        return false;
    };
    let Some((minute, second)) = rest.split_once(':') else {
        return false;
    };
    let (second, fraction) = second
        .split_once('.')
        .map_or((second, None), |(second, fraction)| {
            (second, Some(fraction))
        });
    hour.len() == 2
        && minute.len() == 2
        && second.len() == 2
        && hour.parse::<u32>().is_ok_and(|value| value < 24)
        && minute.parse::<u32>().is_ok_and(|value| value < 60)
        && second.parse::<u32>().is_ok_and(|value| value < 60)
        && fraction.is_none_or(|value| {
            !value.is_empty() && value.len() <= 9 && value.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn json_object(value: &str, label: &str) -> Result<Map<String, Value>, StoreError> {
    parse_json(value, label)?
        .as_object()
        .cloned()
        .ok_or_else(|| corrupt(format!("{label} is not an object")))
}

fn parse_json(value: &str, label: &str) -> Result<Value, StoreError> {
    serde_json::from_str(value).map_err(|_| corrupt(format!("{label} is invalid JSON")))
}

fn unix_timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn unauthorized(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
