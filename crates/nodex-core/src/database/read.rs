use std::cmp::Ordering;

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::database::{
    DatabaseRead, DatabaseReadMode, DatabaseReadValue, DatabaseTarget,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value, json};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub(super) fn read(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    request: DatabaseRead,
) -> Result<DatabaseReadValue, StoreError> {
    let project_id = context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| unauthorized("Database reads require a bound Project"))?;
    let primary_database_id = project_primary_database(connection, library_id, project_id)?;
    match (&request.target, request.mode) {
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::Catalog) => {
            let database_ids = connection
                .prepare(
                    "SELECT block_id FROM database_containers \
                     WHERE library_id = ?1 AND lifecycle <> 'deleted' ORDER BY block_id",
                )?
                .query_map([library_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let databases = database_ids
                .into_iter()
                .filter(|database_id| {
                    authorize_database(
                        connection,
                        project_id,
                        primary_database_id.as_deref(),
                        database_id,
                    )
                    .unwrap_or(false)
                })
                .map(|database_id| database_descriptor(connection, library_id, &database_id))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(DatabaseReadValue::Catalog { databases })
        }
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::Database) => {
            let database_id =
                primary_database_id.ok_or_else(|| not_found("Project has no primary Database"))?;
            authorize_required(connection, project_id, Some(&database_id), &database_id)?;
            Ok(DatabaseReadValue::Database {
                value: database_descriptor(connection, library_id, &database_id)?,
            })
        }
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::Query) => {
            let database_id =
                primary_database_id.ok_or_else(|| not_found("Project has no primary Database"))?;
            authorize_required(connection, project_id, Some(&database_id), &database_id)?;
            let view_id = connection
                .query_row(
                    "SELECT default_view_id FROM database_containers WHERE block_id = ?1",
                    [&database_id],
                    |row| row.get::<_, Option<String>>(0),
                )?
                .ok_or_else(|| not_found("Primary Database has no default View"))?;
            Ok(DatabaseReadValue::Query {
                value: query_view(connection, library_id, &view_id, None, None)?,
            })
        }
        (DatabaseTarget::Database { database_id }, DatabaseReadMode::Database) => {
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                database_id,
            )?;
            Ok(DatabaseReadValue::Database {
                value: database_descriptor(connection, library_id, database_id)?,
            })
        }
        (DatabaseTarget::DataSource { data_source_id }, DatabaseReadMode::DataSource) => {
            let database_id = database_for_source(connection, library_id, data_source_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::DataSource {
                value: data_source_descriptor(connection, library_id, data_source_id)?,
            })
        }
        (DatabaseTarget::DataSource { data_source_id }, DatabaseReadMode::Query) => {
            let database_id = database_for_source(connection, library_id, data_source_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::DataSourceQuery {
                value: query_source(
                    connection,
                    library_id,
                    data_source_id,
                    request.filter.as_ref(),
                    request.sort.as_deref(),
                )?,
            })
        }
        (DatabaseTarget::View { view_id }, DatabaseReadMode::View) => {
            let database_id = database_for_view(connection, library_id, view_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::View {
                value: view_record(connection, view_id)?,
            })
        }
        (DatabaseTarget::View { view_id }, DatabaseReadMode::Query) => {
            let database_id = database_for_view(connection, library_id, view_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::Query {
                value: query_view(
                    connection,
                    library_id,
                    view_id,
                    request.filter.as_ref(),
                    request.sort.as_deref(),
                )?,
            })
        }
        _ => Err(invalid("Database target and read mode are incompatible")),
    }
}

fn project_primary_database(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
) -> Result<Option<String>, StoreError> {
    let project = connection
        .query_row(
            "SELECT database_block_id, lifecycle FROM projects \
             WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((database_id, lifecycle)) = project else {
        return Err(not_found("Bound Project is unavailable in this Library"));
    };
    if lifecycle != "active" {
        return Err(unauthorized("Bound Project is not active"));
    }
    if database_id.is_some() {
        return Ok(database_id);
    }
    connection
        .query_row(
            "SELECT database_block_id FROM project_database_bindings \
             WHERE project_id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![project_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(StoreError::from)
}

fn authorize_required(
    connection: &Connection,
    project_id: &str,
    primary_database_id: Option<&str>,
    database_id: &str,
) -> Result<(), StoreError> {
    if authorize_database(connection, project_id, primary_database_id, database_id)? {
        return Ok(());
    }
    Err(unauthorized("Project is not authorized for this Database"))
}

fn authorize_database(
    connection: &Connection,
    project_id: &str,
    primary_database_id: Option<&str>,
    database_id: &str,
) -> Result<bool, StoreError> {
    if primary_database_id == Some(database_id) {
        return Ok(true);
    }
    let direct = connection
        .query_row(
            "SELECT 1 FROM project_resource_grants WHERE project_id = ?1 \
             AND root_kind = 'database' AND root_id = ?2 AND lifecycle = 'active'",
            params![project_id, database_id],
            |_| Ok(()),
        )
        .optional()?;
    if direct.is_some() {
        return Ok(true);
    }
    let containing_document_id = connection
        .query_row(
            "SELECT containing_document_id FROM blocks WHERE id = ?1 AND type = 'database'",
            [database_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(containing_document_id) = containing_document_id else {
        return Ok(false);
    };
    let owner_page_id = connection
        .query_row(
            "SELECT page.block_id FROM block_documents ownership \
             JOIN pages page ON page.block_id = ownership.block_id \
             WHERE ownership.document_id = ?1",
            [&containing_document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(owner_page_id) = owner_page_id else {
        return Err(corrupt("Embedded Database has no owning Page"));
    };
    let inherited = connection
        .query_row(
            "WITH RECURSIVE ancestors(page_id) AS (\
               SELECT ?2 \
               UNION ALL \
               SELECT page.parent_id FROM pages page JOIN ancestors current \
                 ON page.block_id = current.page_id WHERE page.parent_kind = 'page'\
             ) SELECT 1 FROM project_resource_grants grant_row JOIN ancestors \
               ON grant_row.root_id = ancestors.page_id \
             WHERE grant_row.project_id = ?1 AND grant_row.root_kind = 'page' \
               AND grant_row.lifecycle = 'active' LIMIT 1",
            params![project_id, owner_page_id],
            |_| Ok(()),
        )
        .optional()?;
    Ok(inherited.is_some())
}

fn database_for_source(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT home_database_block_id FROM data_sources \
             WHERE id = ?1 AND library_id = ?2",
            params![data_source_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Data Source is unavailable"))
}

fn database_for_view(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT view.database_block_id FROM database_views view \
             JOIN database_containers container ON container.block_id = view.database_block_id \
             WHERE view.id = ?1 AND container.library_id = ?2",
            params![view_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Database View is unavailable"))
}

fn database_descriptor(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
) -> Result<Value, StoreError> {
    let database = container_record(connection, library_id, database_id)?;
    let data_source_ids = connection
        .prepare(
            "SELECT id FROM data_sources WHERE home_database_block_id = ?1 \
             ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id",
        )?
        .query_map([database_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let data_sources = data_source_ids
        .into_iter()
        .map(|data_source_id| source_record(connection, library_id, &data_source_id))
        .collect::<Result<Vec<_>, _>>()?;
    let view_ids = connection
        .prepare(
            "SELECT id FROM database_views WHERE database_block_id = ?1 \
             ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id",
        )?
        .query_map([database_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let views = view_ids
        .into_iter()
        .map(|view_id| view_record(connection, &view_id))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "database": database,
        "dataSources": data_sources,
        "views": views,
    }))
}

fn data_source_descriptor(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<Value, StoreError> {
    Ok(json!({
        "dataSource": source_record(connection, library_id, data_source_id)?,
        "properties": property_records(connection, data_source_id, false)?,
    }))
}

fn container_record(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
) -> Result<Value, StoreError> {
    connection
        .query_row(
            "SELECT block_id, library_id, name, lifecycle, default_view_id, access_revision, \
               metadata_revision, created_at, updated_at FROM database_containers \
             WHERE block_id = ?1 AND library_id = ?2",
            params![database_id, library_id],
            |row| {
                Ok(json!({
                    "databaseId": row.get::<_, String>(0)?,
                    "libraryId": row.get::<_, String>(1)?,
                    "name": row.get::<_, String>(2)?,
                    "lifecycle": row.get::<_, String>(3)?,
                    "defaultViewId": row.get::<_, Option<String>>(4)?,
                    "accessRevision": row.get::<_, i64>(5)?,
                    "metadataRevision": row.get::<_, i64>(6)?,
                    "createdAt": row.get::<_, String>(7)?,
                    "updatedAt": row.get::<_, String>(8)?,
                }))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Database is unavailable in this Library"))
}

fn source_record(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<Value, StoreError> {
    connection
        .query_row(
            "SELECT id, library_id, home_database_block_id, name, schema_key, schema_revision, \
               lifecycle, rank_key, created_at, updated_at FROM data_sources \
             WHERE id = ?1 AND library_id = ?2",
            params![data_source_id, library_id],
            |row| {
                Ok(json!({
                    "dataSourceId": row.get::<_, String>(0)?,
                    "libraryId": row.get::<_, String>(1)?,
                    "homeDatabaseId": row.get::<_, String>(2)?,
                    "name": row.get::<_, String>(3)?,
                    "schemaKey": row.get::<_, String>(4)?,
                    "schemaRevision": row.get::<_, i64>(5)?,
                    "lifecycle": row.get::<_, String>(6)?,
                    "rankKey": row.get::<_, String>(7)?,
                    "createdAt": row.get::<_, String>(8)?,
                    "updatedAt": row.get::<_, String>(9)?,
                }))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Data Source is unavailable in this Library"))
}

fn property_records(
    connection: &Connection,
    data_source_id: &str,
    active_only: bool,
) -> Result<Vec<Value>, StoreError> {
    let lifecycle = if active_only {
        "AND lifecycle = 'active'"
    } else {
        ""
    };
    let sql = format!(
        "SELECT id, data_source_id, name, value_type, config_json, rank_key, lifecycle, \
           schema_revision, created_at, updated_at FROM data_source_properties \
         WHERE data_source_id = ?1 {lifecycle} \
         ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id"
    );
    connection
        .prepare(&sql)?
        .query_map([data_source_id], |row| {
            let config = parse_json(row.get::<_, String>(4)?, "Property config")?;
            Ok(json!({
                "propertyId": row.get::<_, String>(0)?,
                "dataSourceId": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "valueType": row.get::<_, String>(3)?,
                "config": config,
                "rankKey": row.get::<_, String>(5)?,
                "lifecycle": row.get::<_, String>(6)?,
                "revision": row.get::<_, i64>(7)?,
                "createdAt": row.get::<_, String>(8)?,
                "updatedAt": row.get::<_, String>(9)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

fn view_record(connection: &Connection, view_id: &str) -> Result<Value, StoreError> {
    connection
        .query_row(
            "SELECT view.id, view.database_block_id, view.data_source_id, view.name, view.kind, \
               view.config_json, view.revision, view.rank_key, view.lifecycle, view.created_at, \
               view.updated_at, container.default_view_id \
             FROM database_views view JOIN database_containers container \
               ON container.block_id = view.database_block_id WHERE view.id = ?1",
            [view_id],
            |row| {
                let config = parse_json(row.get::<_, String>(5)?, "View config")?;
                let id = row.get::<_, String>(0)?;
                let default_view_id = row.get::<_, Option<String>>(11)?;
                Ok(json!({
                    "viewId": id,
                    "databaseId": row.get::<_, String>(1)?,
                    "dataSourceId": row.get::<_, String>(2)?,
                    "name": row.get::<_, String>(3)?,
                    "kind": row.get::<_, String>(4)?,
                    "config": config,
                    "isDefault": default_view_id.as_deref() == Some(id.as_str()),
                    "revision": row.get::<_, i64>(6)?,
                    "rankKey": row.get::<_, String>(7)?,
                    "lifecycle": row.get::<_, String>(8)?,
                    "createdAt": row.get::<_, String>(9)?,
                    "updatedAt": row.get::<_, String>(10)?,
                }))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Database View is unavailable"))
}

fn query_view(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
    filter_override: Option<&Value>,
    sort_override: Option<&[Value]>,
) -> Result<Value, StoreError> {
    let view = view_record(connection, view_id)?;
    if view.get("lifecycle").and_then(Value::as_str) != Some("active") {
        return Err(not_found("Database View is not active"));
    }
    let database_id = required_str(&view, "databaseId")?;
    let data_source_id = required_str(&view, "dataSourceId")?;
    let config = view
        .get("config")
        .and_then(Value::as_object)
        .ok_or_else(|| corrupt("Database View config is not an object"))?;
    let filter = filter_override
        .or_else(|| config.get("filter"))
        .cloned()
        .unwrap_or_else(empty_filter);
    let sort = sort_override
        .map(<[Value]>::to_vec)
        .or_else(|| config.get("sort").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let group_property_id = config
        .get("group")
        .and_then(Value::as_object)
        .and_then(|group| group.get("propertyId"))
        .and_then(Value::as_str);
    Ok(json!({
        "database": container_record(connection, library_id, database_id)?,
        "dataSource": source_record(connection, library_id, data_source_id)?,
        "view": view,
        "properties": property_records(connection, data_source_id, true)?,
        "rows": query_rows(
            connection,
            data_source_id,
            Some(view_id),
            group_property_id,
            &filter,
            &sort,
        )?,
    }))
}

fn query_source(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
    filter: Option<&Value>,
    sort: Option<&[Value]>,
) -> Result<Value, StoreError> {
    let database_id = database_for_source(connection, library_id, data_source_id)?;
    let default_filter = empty_filter();
    Ok(json!({
        "database": container_record(connection, library_id, &database_id)?,
        "dataSource": source_record(connection, library_id, data_source_id)?,
        "properties": property_records(connection, data_source_id, true)?,
        "rows": query_rows(
            connection,
            data_source_id,
            None,
            None,
            filter.unwrap_or(&default_filter),
            sort.unwrap_or_default(),
        )?,
    }))
}

fn query_rows(
    connection: &Connection,
    data_source_id: &str,
    view_id: Option<&str>,
    group_property_id: Option<&str>,
    filter: &Value,
    sort: &[Value],
) -> Result<Vec<Value>, StoreError> {
    let memberships = connection
        .prepare(
            "SELECT membership.id, membership.page_block_id, membership.revision, \
               membership.created_at, position.group_key, position.rank_key, position.revision \
             FROM data_source_page_memberships membership JOIN pages page \
               ON page.block_id = membership.page_block_id \
               AND page.parent_kind = 'data_source' AND page.parent_id = membership.data_source_id \
               AND page.lifecycle = 'active' \
             LEFT JOIN database_view_page_positions position \
               ON position.view_id = ?1 AND position.page_block_id = membership.page_block_id \
             WHERE membership.data_source_id = ?2 AND membership.removed_at IS NULL \
             ORDER BY CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END, \
               position.group_key, position.rank_key, membership.page_block_id",
        )?
        .query_map(params![view_id, data_source_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i64>>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut rows = Vec::with_capacity(memberships.len());
    for (membership_id, page_id, revision, created_at, group_key, rank_key, position_revision) in
        memberships
    {
        let values = read_values(connection, data_source_id, &membership_id)?;
        if !evaluate_filter(filter, &values)? {
            continue;
        }
        let effective_group_key = group_property_id
            .and_then(|property_id| values.get(property_id))
            .and_then(|value| value.get("value"))
            .and_then(group_key_for_value);
        let position = rank_key.zip(position_revision).map(|(rank_key, revision)| {
            json!({ "groupKey": group_key, "rankKey": rank_key, "revision": revision })
        });
        rows.push(json!({
            "page": page_record(connection, &page_id)?,
            "membership": {
                "membershipId": membership_id,
                "dataSourceId": data_source_id,
                "revision": revision,
                "createdAt": created_at,
            },
            "values": values,
            "position": position,
            "effectiveGroupKey": effective_group_key,
        }));
    }
    sort_rows(&mut rows, sort)?;
    Ok(rows)
}

fn read_values(
    connection: &Connection,
    data_source_id: &str,
    membership_id: &str,
) -> Result<Map<String, Value>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT value.property_id, value.value_type, value.value_json, value.revision \
             FROM data_source_property_values value JOIN data_source_properties property \
               ON property.data_source_id = value.data_source_id \
               AND property.id = value.property_id AND property.lifecycle = 'active' \
             WHERE value.data_source_id = ?1 AND value.membership_id = ?2 \
             ORDER BY value.property_id",
        )?
        .query_map(params![data_source_id, membership_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(property_id, value_type, value_json, revision)| {
            Ok((
                property_id.clone(),
                json!({
                    "propertyId": property_id,
                    "valueType": value_type,
                    "value": parse_json(value_json, "Property value")?,
                    "revision": revision,
                }),
            ))
        })
        .collect()
}

fn page_record(connection: &Connection, page_id: &str) -> Result<Value, StoreError> {
    connection
        .query_row(
            "SELECT page.block_id, page.library_id, page.parent_kind, page.parent_id, \
               page.lifecycle, page.parent_revision, page.metadata_revision, page.document_id, \
               document.generation, document.head_seq, materialization.title, \
               materialization.title_rich_json, materialization.preview, materialization.plain_text, \
               page.created_at, page.updated_at \
             FROM pages page JOIN documents document ON document.id = page.document_id \
             JOIN document_materializations materialization ON materialization.document_id = document.id \
               AND materialization.generation = document.generation \
               AND materialization.projected_seq = document.head_seq \
               AND materialization.schema_version = document.schema_version \
             WHERE page.block_id = ?1",
            [page_id],
            |row| {
                let parent_kind = row.get::<_, String>(2)?;
                let parent_id = row.get::<_, String>(3)?;
                let parent = match parent_kind.as_str() {
                    "library" => json!({ "kind": "library", "libraryId": parent_id }),
                    "page" => json!({ "kind": "page", "pageId": parent_id }),
                    "data_source" => {
                        json!({ "kind": "data_source", "dataSourceId": parent_id })
                    }
                    _ => return Err(rusqlite::Error::InvalidQuery),
                };
                let rich_title = parse_json(row.get::<_, String>(11)?, "Page rich title")?;
                Ok(json!({
                    "pageId": row.get::<_, String>(0)?,
                    "libraryId": row.get::<_, String>(1)?,
                    "parent": parent,
                    "lifecycle": row.get::<_, String>(4)?,
                    "parentRevision": row.get::<_, i64>(5)?,
                    "metadataRevision": row.get::<_, i64>(6)?,
                    "documentId": row.get::<_, String>(7)?,
                    "documentGeneration": row.get::<_, i64>(8)?,
                    "documentHeadSeq": row.get::<_, i64>(9)?,
                    "title": row.get::<_, String>(10)?,
                    "richTitle": rich_title,
                    "preview": row.get::<_, String>(12)?,
                    "plainText": row.get::<_, String>(13)?,
                    "createdAt": row.get::<_, String>(14)?,
                    "updatedAt": row.get::<_, String>(15)?,
                }))
            },
        )
        .optional()?
        .ok_or_else(|| corrupt("Database membership has no exact-head Page projection"))
}

fn evaluate_filter(filter: &Value, values: &Map<String, Value>) -> Result<bool, StoreError> {
    let object = filter
        .as_object()
        .ok_or_else(|| invalid("Database filter must be an object"))?;
    match object.get("kind").and_then(Value::as_str) {
        Some("group") => {
            let children = object
                .get("children")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid("Database filter group requires children"))?;
            let operator = object
                .get("operator")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("Database filter group requires an operator"))?;
            if operator == "and" {
                for child in children {
                    if !evaluate_filter(child, values)? {
                        return Ok(false);
                    }
                }
                return Ok(true);
            }
            if operator == "or" {
                for child in children {
                    if evaluate_filter(child, values)? {
                        return Ok(true);
                    }
                }
                return Ok(false);
            }
            Err(invalid("Database filter group operator is unsupported"))
        }
        Some("clause") => evaluate_clause(object, values),
        _ => Err(invalid("Database filter kind is unsupported")),
    }
}

fn evaluate_clause(
    clause: &Map<String, Value>,
    values: &Map<String, Value>,
) -> Result<bool, StoreError> {
    let property_id = clause
        .get("propertyId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Database filter clause requires propertyId"))?;
    let operator = clause
        .get("operator")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Database filter clause requires an operator"))?;
    let current = values
        .get(property_id)
        .and_then(|record| record.get("value"));
    let empty = current.is_none_or(|value| {
        value.is_null() || value.as_str() == Some("") || value.as_array().is_some_and(Vec::is_empty)
    });
    if operator == "is_empty" {
        return Ok(empty);
    }
    if operator == "is_not_empty" {
        return Ok(!empty);
    }
    let expected = clause.get("value").unwrap_or(&Value::Null);
    let current = current.unwrap_or(&Value::Null);
    let equals = current == expected;
    if operator == "equals" {
        return Ok(equals);
    }
    if operator == "not_equals" {
        return Ok(!equals);
    }
    let contains = if let (Some(current), Some(expected)) = (current.as_str(), expected.as_str()) {
        current.contains(expected)
    } else if let Some(current) = current.as_array() {
        current.contains(expected)
    } else {
        false
    };
    match operator {
        "contains" => Ok(contains),
        "not_contains" => Ok(!contains),
        _ => Err(invalid("Database filter clause operator is unsupported")),
    }
}

fn sort_rows(rows: &mut [Value], sort: &[Value]) -> Result<(), StoreError> {
    rows.sort_by(|left, right| {
        for rule in sort {
            let Some(rule) = rule.as_object() else {
                continue;
            };
            let direction = rule
                .get("direction")
                .and_then(Value::as_str)
                .unwrap_or("asc");
            let field = rule.get("field").and_then(Value::as_object);
            let ordering = match field
                .and_then(|field| field.get("kind"))
                .and_then(Value::as_str)
            {
                Some("title") => {
                    compare_json(left.pointer("/page/title"), right.pointer("/page/title"))
                }
                Some("created") => compare_json(
                    left.pointer("/page/createdAt"),
                    right.pointer("/page/createdAt"),
                ),
                Some("property") => field
                    .and_then(|field| field.get("propertyId"))
                    .and_then(Value::as_str)
                    .map(|property_id| {
                        compare_json(
                            left.get("values")
                                .and_then(|values| values.get(property_id))
                                .and_then(|record| record.get("value")),
                            right
                                .get("values")
                                .and_then(|values| values.get(property_id))
                                .and_then(|record| record.get("value")),
                        )
                    })
                    .unwrap_or(Ordering::Equal),
                _ => compare_json(
                    left.pointer("/position/rankKey"),
                    right.pointer("/position/rankKey"),
                ),
            };
            let ordering = if direction == "desc" {
                ordering.reverse()
            } else {
                ordering
            };
            if ordering != Ordering::Equal {
                return ordering;
            }
        }
        compare_json(left.pointer("/page/pageId"), right.pointer("/page/pageId"))
    });
    Ok(())
}

fn compare_json(left: Option<&Value>, right: Option<&Value>) -> Ordering {
    match (left, right) {
        (None | Some(Value::Null), None | Some(Value::Null)) => Ordering::Equal,
        (None | Some(Value::Null), _) => Ordering::Greater,
        (_, None | Some(Value::Null)) => Ordering::Less,
        (Some(Value::String(left)), Some(Value::String(right))) => left.cmp(right),
        (Some(Value::Number(left)), Some(Value::Number(right))) => left
            .as_f64()
            .partial_cmp(&right.as_f64())
            .unwrap_or(Ordering::Equal),
        (Some(Value::Bool(left)), Some(Value::Bool(right))) => left.cmp(right),
        (Some(left), Some(right)) => left.to_string().cmp(&right.to_string()),
    }
}

fn group_key_for_value(value: &Value) -> Option<String> {
    if value.is_null() || value.as_str() == Some("") || value.as_array().is_some_and(Vec::is_empty)
    {
        return None;
    }
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| Some(value.to_string()))
}

fn empty_filter() -> Value {
    json!({ "kind": "group", "operator": "and", "children": [] })
}

fn required_str<'value>(value: &'value Value, key: &str) -> Result<&'value str, StoreError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| corrupt("Database read projection is missing a required identity"))
}

fn parse_json(value: String, label: &str) -> rusqlite::Result<Value> {
    serde_json::from_str(&value).map_err(|_| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{label} is invalid JSON"),
            )
            .into(),
        )
    })
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn unauthorized(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
