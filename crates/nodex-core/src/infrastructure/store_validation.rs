use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, Utc};
use nodex_core_contracts::database::DatabaseViewFilter;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::database::property_semantics::{
    PRIORITY_OPTIONS, is_priority_option_id, option_config_from_storage,
};
use crate::document::CURRENT_DOCUMENT_MATERIALIZATION_DERIVATION_VERSION;

use super::schema::{CURRENT_STORE_REVISION, validate_schema_identity};
use super::sqlite::{StoreError, StoreErrorCode, validate_store};

const CORE_SCHEMA_OWNER: &str = "rust_core";

/// Validates the complete current Store contract through one deep interface.
pub(crate) fn validate_current_store(connection: &Connection) -> Result<(), StoreError> {
    let started_at = Instant::now();
    validate_store(connection)?;
    validate_schema_identity(connection, CURRENT_STORE_REVISION)?;
    validate_core_metadata(connection)?;
    validate_store_semantics(connection)?;
    tracing::info!(
        durationMs = duration_millis(started_at.elapsed()),
        "Deep current Store validation completed"
    );
    Ok(())
}

/// Validates revision-independent semantic authority shared by the current
/// Store and an exact migration source.
pub(crate) fn validate_store_semantics(connection: &Connection) -> Result<(), StoreError> {
    let started_at = Instant::now();
    validate_codex_thread_timestamp_invariants(connection)?;
    let canonical_timestamp_started_at = Instant::now();
    validate_canonical_text_timestamp_invariants(connection)?;
    tracing::info!(
        durationMs = duration_millis(canonical_timestamp_started_at.elapsed()),
        "Canonical Store timestamp validation completed"
    );
    validate_thread_execution_hosts(connection)?;
    validate_default_draft_sessions(connection)?;
    validate_thread_recency(connection)?;
    validate_page_key_invariants(connection)?;
    validate_database_relation_invariants(connection)?;
    validate_database_priority_invariants(connection)?;
    validate_library_content_ownership(connection)?;
    validate_canvas_resource_grants(connection)?;
    validate_document_block_tombstones(connection)?;
    validate_document_page_references(connection)?;
    validate_block_transfer_undo(connection)?;
    validate_document_materialization_derivation(connection)?;
    tracing::info!(
        durationMs = duration_millis(started_at.elapsed()),
        "Semantic Store validation completed"
    );
    Ok(())
}

pub(crate) fn validate_core_metadata(connection: &Connection) -> Result<(), StoreError> {
    let metadata = connection
        .query_row(
            "SELECT schema_owner, projection_event_v2_floor, \
                    (SELECT COALESCE(MAX(seq), 0) FROM change_log) \
             FROM core_store_metadata WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((owner, floor, commit_head)) = metadata else {
        return Err(corrupt("Current Store is missing Core metadata"));
    };
    if owner != CORE_SCHEMA_OWNER {
        return Err(corrupt("Current Store has an invalid schema owner"));
    }
    if !(1..=commit_head + 1).contains(&floor) {
        return Err(corrupt("Projection event replay floor is invalid"));
    }
    Ok(())
}

/// Validates the durable Thread clock at startup and Store-copy seams.
pub(crate) fn validate_codex_thread_timestamp_invariants(
    connection: &Connection,
) -> Result<(), StoreError> {
    let invalid = connection
        .query_row(
            "SELECT thread_id FROM codex_threads WHERE updated_at < created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if invalid.is_none() {
        return Ok(());
    }
    Err(corrupt(
        "Codex Thread update time precedes creation in the current Store",
    ))
}

pub(crate) fn validate_database_priority_invariants(
    connection: &Connection,
) -> Result<(), StoreError> {
    let properties = connection
        .prepare(
            "SELECT data_source_id, value_type, config_json \
             FROM data_source_properties WHERE id = 'priority' ORDER BY data_source_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut registries = BTreeMap::<String, BTreeSet<String>>::new();
    for (data_source_id, value_type, config_json) in properties {
        if value_type != "select" {
            return Err(corrupt(format!(
                "Priority Property for Data Source {data_source_id} is not a select"
            )));
        }
        let config = option_config_from_storage("priority", &value_type, &config_json)?;
        let option_ids = config
            .options
            .into_iter()
            .map(|option| option.id)
            .collect::<BTreeSet<_>>();
        let known = PRIORITY_OPTIONS
            .iter()
            .map(|(id, _)| (*id).to_owned())
            .collect::<BTreeSet<_>>();
        if !option_ids.is_subset(&known) {
            return Err(corrupt(format!(
                "Priority registry for Data Source {data_source_id} is noncanonical"
            )));
        }
        registries.insert(data_source_id, option_ids);
    }

    let mut values_statement = connection.prepare(
        "SELECT data_source_id, membership_id, value_json \
         FROM data_source_property_values WHERE property_id = 'priority'",
    )?;
    let values = values_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for value in values {
        let (data_source_id, membership_id, raw) = value?;
        let registry = registries.get(&data_source_id).ok_or_else(|| {
            corrupt(format!(
                "Priority value {data_source_id}/{membership_id} has no registry"
            ))
        })?;
        let value = serde_json::from_str::<Value>(&raw).map_err(|_| {
            corrupt(format!(
                "Priority value {data_source_id}/{membership_id} is invalid"
            ))
        })?;
        if value.is_null() {
            continue;
        }
        if value
            .as_str()
            .is_some_and(|option| is_priority_option_id(option) && registry.contains(option))
        {
            continue;
        }
        return Err(corrupt(format!(
            "Priority value {data_source_id}/{membership_id} is noncanonical"
        )));
    }

    let mut projections_statement =
        connection.prepare("SELECT page_block_id, database_values_json FROM page_read_model")?;
    let projections = projections_statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for projection in projections {
        let (page_id, raw) = projection?;
        let values = serde_json::from_str::<Map<String, Value>>(&raw)
            .map_err(|_| corrupt(format!("Page {page_id} Database values are invalid")))?;
        if let Some(value) = values.get("priority")
            && !value.is_null()
            && !value.as_str().is_some_and(is_priority_option_id)
        {
            return Err(corrupt(format!(
                "Page {page_id} Priority projection is noncanonical"
            )));
        }
    }

    let views = connection
        .prepare("SELECT id, config_json FROM database_views ORDER BY id")?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (view_id, raw) in views {
        let definition = crate::database::view_contract::decode_definition_json(&raw)
            .map_err(|_| corrupt(format!("Database View {view_id} config is invalid")))?;
        validate_priority_filter(&view_id, &definition.filter)?;
        let groups_by_priority = definition
            .presentation
            .group
            .as_ref()
            .is_some_and(|group| group.property_id == "priority");
        if !groups_by_priority {
            continue;
        }
        let invalid_position = connection
            .query_row(
                "SELECT group_key FROM database_view_page_positions \
                 WHERE view_id = ?1 AND group_key IS NOT NULL \
                   AND group_key NOT IN ('p0-critical', 'p1-high', 'p2-medium', 'p3-low') \
                 ORDER BY page_block_id LIMIT 1",
                [view_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(group_key) = invalid_position {
            return Err(corrupt(format!(
                "Priority-grouped View {view_id} has noncanonical group key {group_key}"
            )));
        }
        let invalid_projection = connection
            .query_row(
                "SELECT view_group_key FROM page_read_model \
                 WHERE view_id = ?1 AND view_group_key IS NOT NULL \
                   AND view_group_key NOT IN \
                     ('p0-critical', 'p1-high', 'p2-medium', 'p3-low') \
                 ORDER BY page_block_id LIMIT 1",
                [view_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(group_key) = invalid_projection {
            return Err(corrupt(format!(
                "Priority-grouped View {view_id} projects noncanonical group key {group_key}"
            )));
        }
    }
    Ok(())
}

fn validate_priority_filter(view_id: &str, filter: &DatabaseViewFilter) -> Result<(), StoreError> {
    match filter {
        DatabaseViewFilter::Group { children, .. } => {
            for child in children {
                validate_priority_filter(view_id, child)?;
            }
        }
        DatabaseViewFilter::Clause {
            property_id,
            operator,
            value,
        } if property_id == "priority"
            && matches!(
                operator,
                nodex_core_contracts::database::DatabaseViewFilterOperator::Equals
                    | nodex_core_contracts::database::DatabaseViewFilterOperator::NotEquals
            )
            && !value
                .as_ref()
                .and_then(Value::as_str)
                .is_some_and(is_priority_option_id) =>
        {
            return Err(corrupt(format!(
                "Database View {view_id} Priority filter is noncanonical"
            )));
        }
        DatabaseViewFilter::Clause { .. } => {}
    }
    Ok(())
}

fn validate_thread_execution_hosts(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM codex_threads \
         WHERE execution_host_id <> trim(execution_host_id) \
            OR length(execution_host_id) NOT BETWEEN 1 AND 512",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "invalid Thread execution host identities")
}

fn validate_default_draft_sessions(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM project_sessions session \
         WHERE session.is_default_draft NOT IN (0, 1) \
            OR (session.is_default_draft = 1 AND session.archived <> 0) \
            OR (session.is_default_draft = 1 AND EXISTS (\
              SELECT 1 FROM project_session_threads link WHERE link.session_id = session.id\
            ))",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "invalid default-draft Project Sessions")
}

fn validate_thread_recency(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM codex_threads WHERE recency_at < created_at OR recency_at < 0",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "invalid Thread recency timestamps")
}

fn validate_page_key_invariants(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT \
           (SELECT count(*) FROM project_database_bindings binding \
            LEFT JOIN page_key_namespaces namespace \
              ON namespace.database_block_id = binding.database_block_id \
             AND namespace.library_id = binding.library_id \
            WHERE namespace.database_block_id IS NULL) + \
           (SELECT count(*) FROM (\
             SELECT namespace.database_block_id \
             FROM page_key_namespaces namespace \
             LEFT JOIN page_key_prefixes prefix \
               ON prefix.database_block_id = namespace.database_block_id \
              AND prefix.library_id = namespace.library_id \
              AND prefix.retired_at IS NULL \
             GROUP BY namespace.database_block_id \
             HAVING count(prefix.normalized_prefix) <> 1\
           )) + \
           (SELECT count(*) FROM (\
             SELECT namespace.database_block_id \
             FROM page_key_namespaces namespace \
             LEFT JOIN page_key_assignments assignment \
               ON assignment.database_block_id = namespace.database_block_id \
             GROUP BY namespace.database_block_id, namespace.next_number \
             HAVING namespace.next_number <= COALESCE(MAX(assignment.number), 0)\
           ))",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "invalid Page-key authority records")
}

fn validate_database_relation_invariants(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT \
          (SELECT count(*) FROM data_source_relation_properties relation \
           LEFT JOIN data_source_properties property \
             ON property.data_source_id = relation.data_source_id \
            AND property.id = relation.property_id \
           LEFT JOIN data_sources source ON source.id = relation.data_source_id \
           LEFT JOIN data_sources target ON target.id = relation.target_data_source_id \
           WHERE property.value_type IS NOT 'relation' \
              OR property.config_json <> '{}' \
              OR relation.cardinality NOT IN ('one', 'many') \
              OR source.library_id IS NULL OR target.library_id IS NULL \
              OR source.library_id <> target.library_id) + \
          (SELECT count(*) FROM data_source_properties property \
           WHERE property.value_type = 'relation' AND NOT EXISTS (\
             SELECT 1 FROM data_source_relation_properties relation \
             WHERE relation.data_source_id = property.data_source_id \
               AND relation.property_id = property.id\
           )) + \
          (SELECT count(*) FROM data_source_property_values value \
           WHERE value.value_type = 'relation' \
             AND json_type(value.value_json) IS NOT 'null') + \
          (SELECT count(*) FROM (\
             SELECT edge.source_data_source_id, edge.source_membership_id, edge.property_id \
             FROM data_source_relation_edges edge \
             JOIN data_source_relation_properties relation \
               ON relation.data_source_id = edge.source_data_source_id \
              AND relation.property_id = edge.property_id \
             WHERE relation.cardinality = 'one' \
             GROUP BY edge.source_data_source_id, edge.source_membership_id, edge.property_id \
             HAVING count(*) > 1\
           )) + \
          (SELECT count(*) FROM data_source_relation_edges \
           WHERE property_id <> 'task_parent' AND sibling_rank IS NOT NULL)",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "inconsistent Relation Property authority records")?;

    let parents = connection
        .prepare(
            "SELECT child.page_block_id, edge.target_page_block_id \
             FROM data_source_relation_edges edge \
             JOIN data_source_page_memberships child \
               ON child.data_source_id = edge.source_data_source_id \
              AND child.id = edge.source_membership_id \
             WHERE edge.property_id = 'task_parent' ORDER BY child.page_block_id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    for page_id in parents.keys() {
        let mut cursor = Some(page_id.as_str());
        let mut visited = BTreeSet::new();
        let mut depth = 0usize;
        while let Some(current) = cursor {
            if !visited.insert(current) {
                return Err(corrupt("Task Parent Relation contains a cycle"));
            }
            cursor = parents.get(current).map(String::as_str);
            if cursor.is_none() {
                continue;
            }
            depth += 1;
            if depth > 10 {
                return Err(corrupt("Task Parent Relation exceeds depth 10"));
            }
        }
    }
    Ok(())
}

fn validate_library_content_ownership(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT \
          (SELECT count(*) FROM block_documents ownership \
           JOIN blocks block ON block.id = ownership.block_id \
           JOIN documents document ON document.id = ownership.document_id \
           WHERE ownership.library_id <> block.library_id \
              OR ownership.library_id <> document.library_id) + \
          (SELECT count(*) FROM pages page \
           JOIN blocks block ON block.id = page.block_id \
           JOIN block_documents ownership ON ownership.block_id = page.block_id \
           WHERE page.library_id <> block.library_id OR block.type <> 'page' \
              OR ownership.library_id <> page.library_id \
              OR ownership.document_id <> page.document_id) + \
          (SELECT count(*) FROM library_block_placements placement \
           LEFT JOIN blocks block ON block.id = placement.block_id \
           WHERE block.id IS NULL OR block.library_id <> placement.library_id \
              OR block.lifecycle = 'deleted')",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "Library content ownership mismatches")
}

fn validate_canvas_resource_grants(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM project_resource_grants grant_row \
         LEFT JOIN projects project ON project.id = grant_row.project_id \
         LEFT JOIN blocks block ON block.id = grant_row.root_id \
         WHERE grant_row.lifecycle = 'active' AND ( \
           project.id IS NULL OR project.library_id <> grant_row.library_id \
           OR block.id IS NULL OR block.library_id <> grant_row.library_id \
           OR block.type <> grant_row.root_kind \
         )",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "invalid active Project resource grants")
}

fn validate_document_block_tombstones(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM document_block_tombstones tombstone \
         LEFT JOIN blocks block ON block.id = tombstone.block_id \
         LEFT JOIN documents document ON document.id = tombstone.document_id \
         WHERE block.id IS NULL OR document.id IS NULL \
            OR block.library_id <> tombstone.library_id \
            OR document.library_id <> tombstone.library_id \
            OR block.lifecycle <> 'deleted' \
            OR block.placement_revision <> tombstone.placement_revision \
            OR document.generation <> tombstone.document_generation \
            OR tombstone.deletion_head_seq > document.head_seq \
            OR EXISTS (SELECT 1 FROM document_block_index entry \
                       WHERE entry.block_id = tombstone.block_id) \
            OR EXISTS (SELECT 1 FROM library_block_placements placement \
                       WHERE placement.block_id = tombstone.block_id)",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "Document Block tombstone mismatches")?;
    let unresolved: i64 = connection.query_row(
        "SELECT count(*) FROM local_commit_relocation_obligations",
        [],
        |row| row.get(0),
    )?;
    expect_zero(unresolved, "unresolved LocalCommit relocation obligations")
}

fn validate_document_page_references(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM document_page_references reference \
         LEFT JOIN block_documents ownership \
           ON ownership.document_id = reference.document_id \
          AND ownership.block_id = reference.source_owner_block_id \
         LEFT JOIN blocks target ON target.id = reference.target_page_id \
         WHERE ownership.block_id IS NULL \
            OR (target.id IS NOT NULL AND target.type <> 'page')",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "invalid normalized Page references")
}

fn validate_block_transfer_undo(connection: &Connection) -> Result<(), StoreError> {
    let invalid: i64 = connection.query_row(
        "SELECT count(*) FROM block_transfer_undo_recipes recipe \
         WHERE (recipe.consumed_at IS NOT NULL AND length(recipe.consumed_at) = 0) \
            OR NOT EXISTS (\
              SELECT 1 FROM block_mutations mutation \
              WHERE mutation.mutation_id = recipe.transfer_operation_id \
                AND mutation.mutation_kind = 'block_transfer' \
                AND mutation.project_id = recipe.project_id \
                AND mutation.store_epoch = recipe.store_epoch\
            )",
        [],
        |row| row.get(0),
    )?;
    expect_zero(invalid, "invalid Block transfer Undo recipes")
}

fn validate_document_materialization_derivation(connection: &Connection) -> Result<(), StoreError> {
    let stale: i64 = connection.query_row(
        "SELECT count(*) FROM document_materializations \
         WHERE materialization_derivation_version <> ?1",
        [CURRENT_DOCUMENT_MATERIALIZATION_DERIVATION_VERSION],
        |row| row.get(0),
    )?;
    expect_zero(stale, "Document materializations from an older derivation")
}

fn validate_canonical_text_timestamp_invariants(connection: &Connection) -> Result<(), StoreError> {
    let columns = connection
        .prepare(
            "SELECT schema.name, column.name \
             FROM sqlite_schema AS schema \
             JOIN pragma_table_info(schema.name) AS column \
             WHERE schema.type = 'table' \
               AND schema.name NOT LIKE 'sqlite_%' \
               AND lower(column.type) = 'text' \
               AND column.name GLOB '*_at' \
             ORDER BY schema.name, column.cid",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (table, column) in columns {
        let query = format!(
            "SELECT {} FROM {} WHERE {} IS NOT NULL",
            quote_identifier(&column),
            quote_identifier(&table),
            quote_identifier(&column),
        );
        let mut statement = connection.prepare(&query)?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let value = row.get::<_, String>(0)?;
            if canonical_utc_timestamp(&value).is_some_and(|canonical| canonical == value) {
                continue;
            }
            return Err(corrupt(format!(
                "Store protocol timestamp invariant failed for {table}.{column}"
            )));
        }
    }
    Ok(())
}

fn canonical_utc_timestamp(value: &str) -> Option<String> {
    if let Ok(timestamp) = DateTime::parse_from_rfc3339(value) {
        return Some(
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true),
        );
    }
    for format in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(timestamp) = NaiveDateTime::parse_from_str(value, format) {
            return Some(
                timestamp
                    .and_utc()
                    .to_rfc3339_opts(SecondsFormat::Millis, true),
            );
        }
    }
    Some(
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .ok()?
            .and_hms_opt(0, 0, 0)?
            .and_utc()
            .to_rfc3339_opts(SecondsFormat::Millis, true),
    )
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn expect_zero(count: i64, label: &str) -> Result<(), StoreError> {
    if count == 0 {
        return Ok(());
    }
    Err(corrupt(format!("Current Store contains {count} {label}")))
}

fn duration_millis(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::infrastructure::store::SqliteStoreKernel;

    use super::*;

    #[test]
    fn fresh_store_satisfies_current_invariants() {
        let home = tempdir().expect("Profile");
        let kernel = SqliteStoreKernel::open_test(home.path()).expect("fresh Store");
        kernel
            .readers()
            .read_default(validate_current_store)
            .expect("current Store invariants");
    }
}
