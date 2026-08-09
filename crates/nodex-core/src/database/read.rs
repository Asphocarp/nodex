use std::collections::{BTreeMap, BTreeSet};

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::agent::{AgentAuthorizationTarget, AgentProjectResourceAction};
use nodex_core_contracts::collection::{
    CollectionWindow, CollectionWindowAuthority, CollectionWindowRequest,
};
use nodex_core_contracts::database::{
    DatabasePropertyDescriptor, DatabaseRead, DatabaseReadMode, DatabaseReadValue, DatabaseTarget,
    DatabaseViewContext,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value, json};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::{
    collection_window::{WindowCandidate, assemble, normalize_request},
    cursor::{self, CollectionCursorSubject, CursorDirection, KeysetCoordinate},
};

use super::authorization::{authorize_database, authorize_required, project_primary_database};
use super::is_trusted_library_database_context;

pub(crate) struct PageDataSourceProjection {
    pub membership_id: String,
    pub data_source_id: String,
    pub membership_revision: i64,
    pub membership_created_at: String,
    pub database: Value,
    pub data_source: Value,
    pub properties: Vec<DatabasePropertyDescriptor>,
    pub property_configs: BTreeMap<String, Value>,
    pub values: BTreeMap<String, Value>,
}

struct PropertyDescriptorRow {
    property_id: String,
    data_source_id: String,
    name: String,
    value_type: String,
    option_count: usize,
    rank_key: String,
    lifecycle: String,
    revision: i64,
    created_at: String,
    updated_at: String,
}

fn property_descriptor(
    connection: &Connection,
    row: PropertyDescriptorRow,
) -> Result<DatabasePropertyDescriptor, StoreError> {
    let schema = super::property_semantics::schema_from_storage(
        connection,
        &row.data_source_id,
        &row.property_id,
        &row.value_type,
    )?;
    Ok(DatabasePropertyDescriptor {
        property_id: row.property_id,
        data_source_id: row.data_source_id,
        name: row.name,
        capabilities: super::property_semantics::capabilities(&schema),
        schema,
        option_count: u32::try_from(row.option_count)
            .map_err(|_| corrupt("Property option count overflowed"))?,
        rank_key: row.rank_key,
        lifecycle: row.lifecycle,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

pub(crate) fn page_data_source_projection(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
    data_source_id: &str,
    project_id: Option<&str>,
) -> Result<PageDataSourceProjection, StoreError> {
    let memberships = connection
        .prepare(
            "SELECT id, data_source_id, revision, created_at \
             FROM data_source_page_memberships \
             WHERE page_block_id = ?1 AND removed_at IS NULL ORDER BY id",
        )?
        .query_map([page_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let [(membership_id, membership_source_id, revision, created_at)] = memberships.as_slice()
    else {
        return Err(corrupt(
            "Data Source Page must have exactly one active membership",
        ));
    };
    if membership_source_id != data_source_id {
        return Err(corrupt(
            "Data Source Page membership and parent coordinates diverge",
        ));
    }
    let database_id = database_for_source(connection, library_id, data_source_id)?;
    let data_source = source_record(connection, library_id, data_source_id)?;
    if data_source.get("lifecycle").and_then(Value::as_str) == Some("deleted") {
        return Err(corrupt("Data Source Page belongs to a deleted Data Source"));
    }
    let database = container_record(connection, library_id, &database_id)?;
    if database.get("lifecycle").and_then(Value::as_str) == Some("deleted") {
        return Err(corrupt("Data Source Page belongs to a deleted Database"));
    }
    let mut values = read_values(connection, data_source_id, membership_id)?
        .into_iter()
        .collect();
    super::relation_projection::hydrate_projection_values(
        connection,
        library_id,
        project_id,
        data_source_id,
        membership_id,
        &mut values,
    )?;
    Ok(PageDataSourceProjection {
        membership_id: membership_id.clone(),
        data_source_id: membership_source_id.clone(),
        membership_revision: *revision,
        membership_created_at: created_at.clone(),
        database,
        data_source,
        properties: property_records(connection, data_source_id, true)?,
        property_configs: read_property_configs(connection, data_source_id)?,
        values,
    })
}

pub(crate) fn read(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    request: DatabaseRead,
) -> Result<DatabaseReadValue, StoreError> {
    let commit_head = crate::infrastructure::local_commit::head(connection)?;
    read_at_commit_head(connection, library_id, commit_head, context, request)
}

pub(crate) fn read_at_commit_head(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    context: &BoundModuleContext,
    request: DatabaseRead,
) -> Result<DatabaseReadValue, StoreError> {
    let project_id = context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str());
    if project_id.is_none() && !is_trusted_library_database_context(context) {
        return Err(unauthorized(
            "Database reads require a Project or trusted Library scope",
        ));
    }
    if request.group_scope.is_some()
        && !matches!(
            request.mode,
            DatabaseReadMode::ViewWindow | DatabaseReadMode::ViewContext
        )
    {
        return Err(invalid(
            "Database group scope requires the view_window or view_context mode",
        ));
    }
    let primary_database_id = project_id
        .map(|project_id| project_primary_database(connection, library_id, project_id))
        .transpose()?
        .flatten();
    let store_epoch = crate::document::read_store_epoch(connection)?;
    let mut value = match (&request.target, request.mode) {
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::ViewWindow) => {
            let database_id =
                primary_database_id.ok_or_else(|| not_found("Project has no primary Database"))?;
            let project_id = project_id
                .ok_or_else(|| invalid("Library Database reads require a concrete target"))?;
            authorize_required(
                connection,
                Some(project_id),
                Some(&database_id),
                &database_id,
            )?;
            let view_id = default_view_for_database(connection, &database_id)?;
            validate_view_filter_access_by_id(connection, library_id, Some(project_id), &view_id)?;
            Ok(DatabaseReadValue::ViewWindow {
                value: super::window::view_window(
                    connection,
                    library_id,
                    &view_id,
                    super::window::ViewWindowRead {
                        commit_head,
                        project_id: Some(project_id),
                        store_epoch: &store_epoch,
                        window: request
                            .window
                            .as_ref()
                            .unwrap_or(&CollectionWindowRequest::default()),
                        group_scope: request.group_scope.as_ref(),
                    },
                )?,
            })
        }
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::RowsById) => {
            let database_id =
                primary_database_id.ok_or_else(|| not_found("Project has no primary Database"))?;
            let project_id = project_id
                .ok_or_else(|| invalid("Library Database reads require a concrete target"))?;
            authorize_required(
                connection,
                Some(project_id),
                Some(&database_id),
                &database_id,
            )?;
            let view_id = default_view_for_database(connection, &database_id)?;
            Ok(DatabaseReadValue::RowsById {
                value: super::window::rows_by_id(
                    connection,
                    library_id,
                    &view_id,
                    request
                        .page_ids
                        .as_deref()
                        .ok_or_else(|| invalid("Database rows-by-ID requires Page identities"))?,
                )?,
            })
        }
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::CatalogWindow) => {
            let project_id = project_id
                .ok_or_else(|| invalid("Library Database reads require a concrete target"))?;
            Ok(DatabaseReadValue::CatalogWindow {
                databases: catalog_window(
                    connection,
                    library_id,
                    commit_head,
                    project_id,
                    primary_database_id.as_deref(),
                    request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
                )?,
            })
        }
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::Database) => {
            let database_id =
                primary_database_id.ok_or_else(|| not_found("Project has no primary Database"))?;
            let project_id = project_id
                .ok_or_else(|| invalid("Library Database reads require a concrete target"))?;
            authorize_required(
                connection,
                Some(project_id),
                Some(&database_id),
                &database_id,
            )?;
            Ok(DatabaseReadValue::Database {
                value: database_descriptor(connection, library_id, &database_id)?,
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
        (DatabaseTarget::Database { database_id }, DatabaseReadMode::ViewWindow) => {
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                database_id,
            )?;
            let view_id = default_view_for_database(connection, database_id)?;
            validate_view_filter_access_by_id(connection, library_id, project_id, &view_id)?;
            Ok(DatabaseReadValue::ViewWindow {
                value: super::window::view_window(
                    connection,
                    library_id,
                    &view_id,
                    super::window::ViewWindowRead {
                        commit_head,
                        project_id,
                        store_epoch: &store_epoch,
                        window: request
                            .window
                            .as_ref()
                            .unwrap_or(&CollectionWindowRequest::default()),
                        group_scope: request.group_scope.as_ref(),
                    },
                )?,
            })
        }
        (DatabaseTarget::Database { database_id }, DatabaseReadMode::DataSourceWindow) => {
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                database_id,
            )?;
            Ok(DatabaseReadValue::DataSourceWindow {
                data_sources: data_source_window(
                    connection,
                    library_id,
                    commit_head,
                    database_id,
                    request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
                )?,
            })
        }
        (DatabaseTarget::Database { database_id }, DatabaseReadMode::ViewDescriptorWindow) => {
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                database_id,
            )?;
            Ok(DatabaseReadValue::ViewDescriptorWindow {
                views: view_descriptor_window(
                    connection,
                    library_id,
                    commit_head,
                    project_id,
                    database_id,
                    request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
                )?,
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
        (DatabaseTarget::DataSource { data_source_id }, DatabaseReadMode::PropertyWindow) => {
            let database_id = database_for_source(connection, library_id, data_source_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::PropertyWindow {
                properties: property_window(
                    connection,
                    library_id,
                    commit_head,
                    data_source_id,
                    request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
                )?,
            })
        }
        (
            DatabaseTarget::DataSource { data_source_id },
            DatabaseReadMode::RelationCandidateWindow,
        ) => {
            let database_id = database_for_source(connection, library_id, data_source_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::RelationCandidateWindow {
                candidates: super::relation::candidate_window(
                    connection,
                    library_id,
                    commit_head,
                    data_source_id,
                    request.filter.as_ref(),
                    request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
                )?,
            })
        }
        (
            DatabaseTarget::Property {
                data_source_id,
                property_id,
            },
            DatabaseReadMode::OptionWindow,
        ) => {
            let database_id = database_for_source(connection, library_id, data_source_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::OptionWindow {
                options: option_window(
                    connection,
                    library_id,
                    commit_head,
                    data_source_id,
                    property_id,
                    request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
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
                value: view_record(connection, library_id, project_id, view_id)?,
            })
        }
        (DatabaseTarget::View { view_id }, DatabaseReadMode::ViewWindow) => {
            let database_id = database_for_view(connection, library_id, view_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            validate_view_filter_access_by_id(connection, library_id, project_id, view_id)?;
            Ok(DatabaseReadValue::ViewWindow {
                value: super::window::view_window(
                    connection,
                    library_id,
                    view_id,
                    super::window::ViewWindowRead {
                        commit_head,
                        project_id,
                        store_epoch: &store_epoch,
                        window: request
                            .window
                            .as_ref()
                            .unwrap_or(&CollectionWindowRequest::default()),
                        group_scope: request.group_scope.as_ref(),
                    },
                )?,
            })
        }
        (DatabaseTarget::View { view_id }, DatabaseReadMode::ViewContext) => {
            let project_id = project_id
                .ok_or_else(|| invalid("Database View context requires a Project scope"))?;
            let database_id = database_for_view(connection, library_id, view_id)?;
            authorize_required(
                connection,
                Some(project_id),
                primary_database_id.as_deref(),
                &database_id,
            )?;
            let projection = super::window::view_context(
                connection,
                library_id,
                view_id,
                super::window::ViewContextRead {
                    commit_head,
                    project_id,
                    store_epoch: &store_epoch,
                    window: request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
                    group_scope: request.group_scope.as_ref(),
                },
            )?;
            let property_ids = projection
                .property_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            let properties = property_records(connection, &projection.data_source_id, true)?
                .into_iter()
                .filter(|property| property_ids.contains(property.property_id.as_str()))
                .collect();
            Ok(DatabaseReadValue::ViewContext {
                value: Box::new(DatabaseViewContext {
                    database: container_record(connection, library_id, &projection.database_id)?,
                    data_source: source_record(connection, library_id, &projection.data_source_id)?,
                    view: view_record(connection, library_id, Some(project_id), view_id)?,
                    properties,
                    groups: projection.groups,
                    projection: projection.projection,
                    rows: projection.rows,
                }),
            })
        }
        (DatabaseTarget::View { view_id }, DatabaseReadMode::RowsById) => {
            let database_id = database_for_view(connection, library_id, view_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::RowsById {
                value: super::window::rows_by_id(
                    connection,
                    library_id,
                    view_id,
                    request
                        .page_ids
                        .as_deref()
                        .ok_or_else(|| invalid("Database rows-by-ID requires Page identities"))?,
                )?,
            })
        }
        (DatabaseTarget::Page { page_id }, DatabaseReadMode::RowDetail) => {
            let data_source_id = data_source_for_page(connection, library_id, page_id)?;
            let database_id = database_for_source(connection, library_id, &data_source_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            let view_id = default_view_for_database(connection, &database_id)?;
            Ok(DatabaseReadValue::RowDetail {
                value: Box::new(super::window::row_detail(
                    connection, library_id, &view_id, page_id,
                )?),
            })
        }
        (
            DatabaseTarget::AgentDataSource {
                data_source_id,
                query,
            },
            DatabaseReadMode::AgentQuery,
        ) => {
            crate::library::agent_authorization::authorize_execution(
                connection,
                context,
                library_id,
                &query.authorization,
                &AgentAuthorizationTarget::DataSource {
                    data_source_id: data_source_id.clone(),
                },
                AgentProjectResourceAction::Read,
            )?;
            let view_id = default_view_for_source(connection, library_id, data_source_id)?;
            Ok(DatabaseReadValue::AgentQuery {
                value: super::window::view_window(
                    connection,
                    library_id,
                    &view_id,
                    super::window::ViewWindowRead {
                        commit_head,
                        project_id,
                        store_epoch: &store_epoch,
                        window: &CollectionWindowRequest {
                            after: query.cursor.clone(),
                            first: query.limit,
                        },
                        group_scope: None,
                    },
                )?,
            })
        }
        (DatabaseTarget::AgentView { view_id, query }, DatabaseReadMode::AgentQuery) => {
            crate::library::agent_authorization::authorize_execution(
                connection,
                context,
                library_id,
                &query.authorization,
                &AgentAuthorizationTarget::View {
                    view_id: view_id.clone(),
                },
                AgentProjectResourceAction::Read,
            )?;
            Ok(DatabaseReadValue::AgentQuery {
                value: super::window::view_window(
                    connection,
                    library_id,
                    view_id,
                    super::window::ViewWindowRead {
                        commit_head,
                        project_id,
                        store_epoch: &store_epoch,
                        window: &CollectionWindowRequest {
                            after: query.cursor.clone(),
                            first: query.limit,
                        },
                        group_scope: None,
                    },
                )?,
            })
        }
        (DatabaseTarget::ProjectDefault, DatabaseReadMode::ViewGroups) => {
            let database_id =
                primary_database_id.ok_or_else(|| not_found("Project has no primary Database"))?;
            let project_id = project_id
                .ok_or_else(|| invalid("Library Database reads require a concrete target"))?;
            authorize_required(
                connection,
                Some(project_id),
                Some(&database_id),
                &database_id,
            )?;
            let view_id = default_view_for_database(connection, &database_id)?;
            validate_view_filter_access_by_id(connection, library_id, Some(project_id), &view_id)?;
            Ok(DatabaseReadValue::ViewGroups {
                value: super::window::view_groups(
                    connection,
                    library_id,
                    &view_id,
                    super::window::ViewGroupsRead {
                        commit_head,
                        project_id: Some(project_id),
                        store_epoch: &store_epoch,
                    },
                )?,
            })
        }
        (DatabaseTarget::Database { database_id }, DatabaseReadMode::ViewGroups) => {
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                database_id,
            )?;
            let view_id = default_view_for_database(connection, database_id)?;
            validate_view_filter_access_by_id(connection, library_id, project_id, &view_id)?;
            Ok(DatabaseReadValue::ViewGroups {
                value: super::window::view_groups(
                    connection,
                    library_id,
                    &view_id,
                    super::window::ViewGroupsRead {
                        commit_head,
                        project_id,
                        store_epoch: &store_epoch,
                    },
                )?,
            })
        }
        (DatabaseTarget::View { view_id }, DatabaseReadMode::ViewGroups) => {
            let database_id = database_for_view(connection, library_id, view_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            validate_view_filter_access_by_id(connection, library_id, project_id, view_id)?;
            Ok(DatabaseReadValue::ViewGroups {
                value: super::window::view_groups(
                    connection,
                    library_id,
                    view_id,
                    super::window::ViewGroupsRead {
                        commit_head,
                        project_id,
                        store_epoch: &store_epoch,
                    },
                )?,
            })
        }
        (
            DatabaseTarget::PageProperty {
                page_id,
                data_source_id,
                property_id,
            },
            DatabaseReadMode::RelationTargetWindow,
        ) => {
            let database_id = database_for_source(connection, library_id, data_source_id)?;
            authorize_required(
                connection,
                project_id,
                primary_database_id.as_deref(),
                &database_id,
            )?;
            Ok(DatabaseReadValue::RelationTargetWindow {
                value: super::relation::target_window(
                    connection,
                    library_id,
                    commit_head,
                    project_id,
                    &nodex_core_contracts::database::DatabasePagePropertyAddress {
                        page_id: page_id.clone(),
                        data_source_id: data_source_id.clone(),
                        property_id: property_id.clone(),
                    },
                    request
                        .window
                        .as_ref()
                        .unwrap_or(&CollectionWindowRequest::default()),
                )?,
            })
        }
        _ => Err(invalid("Database target and read mode are incompatible")),
    }?;
    hydrate_relation_previews(connection, library_id, project_id, &mut value)?;
    Ok(value)
}

fn hydrate_relation_previews(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    value: &mut DatabaseReadValue,
) -> Result<(), StoreError> {
    match value {
        DatabaseReadValue::ViewWindow { value } | DatabaseReadValue::AgentQuery { value } => {
            super::relation_projection::hydrate_row_previews(
                connection,
                library_id,
                project_id,
                &value.data_source_id,
                &mut value.rows.items,
            )
        }
        DatabaseReadValue::ViewContext { value } => {
            let data_source_id = value
                .data_source
                .get("dataSourceId")
                .and_then(Value::as_str)
                .ok_or_else(|| corrupt("Database View context has no Data Source identity"))?;
            let mut summaries = value
                .rows
                .items
                .iter_mut()
                .map(|row| &mut row.summary)
                .collect::<Vec<_>>();
            hydrate_summary_refs(
                connection,
                library_id,
                project_id,
                data_source_id,
                &mut summaries,
            )
        }
        DatabaseReadValue::RowsById { value } => {
            hydrate_summary_rows(connection, library_id, project_id, &mut value.rows)
        }
        DatabaseReadValue::RowDetail { value } => hydrate_summary_rows(
            connection,
            library_id,
            project_id,
            std::slice::from_mut(&mut value.summary),
        ),
        _ => Ok(()),
    }
}

fn hydrate_summary_rows(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    rows: &mut [nodex_core_contracts::database::DatabaseRowSummary],
) -> Result<(), StoreError> {
    let Some(first) = rows.first() else {
        return Ok(());
    };
    let data_source_id = connection
        .query_row(
            "SELECT data_source_id FROM data_source_page_memberships WHERE id = ?1",
            [&first.membership_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Database row membership is unavailable"))?;
    super::relation_projection::hydrate_row_previews(
        connection,
        library_id,
        project_id,
        &data_source_id,
        rows,
    )
}

fn hydrate_summary_refs(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    data_source_id: &str,
    rows: &mut [&mut nodex_core_contracts::database::DatabaseRowSummary],
) -> Result<(), StoreError> {
    let mut owned = rows.iter().map(|row| (*row).clone()).collect::<Vec<_>>();
    super::relation_projection::hydrate_row_previews(
        connection,
        library_id,
        project_id,
        data_source_id,
        &mut owned,
    )?;
    for (target, hydrated) in rows.iter_mut().zip(owned) {
        target.database_values = hydrated.database_values;
    }
    Ok(())
}

fn catalog_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    project_id: &str,
    primary_database_id: Option<&str>,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<Value>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint =
        cursor::query_fingerprint(&("database_catalog_v1", project_id, primary_database_id))?;
    let subject = CollectionCursorSubject {
        kind: "database_catalog",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let after = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward || !coordinate.values.is_empty() {
                return Err(invalid("Database catalog cursor is incompatible"));
            }
            Ok(coordinate.stable_id)
        })
        .transpose()?;
    let mut statement = connection.prepare(
        "SELECT block_id FROM database_containers \
         WHERE library_id = ?1 AND lifecycle <> 'deleted' \
           AND (?2 IS NULL OR block_id > ?2) \
         ORDER BY block_id",
    )?;
    let mut rows = statement.query(params![library_id, after.as_deref()])?;
    let mut candidates = Vec::with_capacity(normalized.first + 1);
    while candidates.len() <= normalized.first {
        let Some(row) = rows.next()? else {
            break;
        };
        let database_id = row.get::<_, String>(0)?;
        if !authorize_database(connection, project_id, primary_database_id, &database_id)? {
            continue;
        }
        candidates.push(WindowCandidate {
            item: database_descriptor(connection, library_id, &database_id)?,
            coordinate: KeysetCoordinate {
                values: Vec::new(),
                stable_id: database_id,
            },
        });
    }
    assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: commit_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )
}

fn data_source_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    database_id: &str,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<Value>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint = cursor::query_fingerprint(&("database_data_sources_v1", database_id))?;
    let subject = CollectionCursorSubject {
        kind: "database_data_sources",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let RankCursor {
        bucket: after_bucket,
        rank: after_rank,
        stable_id: after_id,
    } = decode_rank_cursor(connection, subject, normalized.after)?;
    let query_limit = i64::try_from(normalized.first.saturating_add(1))
        .map_err(|_| invalid("Data Source window limit overflowed"))?;
    let ids = connection
        .prepare(
            "SELECT id, 0, rank_key \
             FROM data_sources WHERE home_database_block_id = ?1 AND lifecycle = 'active' \
               AND (?2 IS NULL \
                 OR CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END > ?2 \
                 OR (CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END = ?2 AND rank_key > ?3) \
                 OR (CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END = ?2 \
                   AND rank_key = ?3 AND id > ?4)) \
             ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id \
             LIMIT ?5",
        )?
        .query_map(
            params![database_id, after_bucket, after_rank, after_id, query_limit],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let candidates = ids
        .into_iter()
        .map(|(id, bucket, rank)| {
            Ok(WindowCandidate {
                item: source_record(connection, library_id, &id)?,
                coordinate: KeysetCoordinate {
                    values: vec![
                        cursor::KeysetValue::Integer { value: bucket },
                        cursor::KeysetValue::Text { value: rank },
                    ],
                    stable_id: id,
                },
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    assemble_database_window(
        connection,
        subject,
        commit_head,
        normalized.first,
        candidates,
    )
}

fn view_descriptor_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    project_id: Option<&str>,
    database_id: &str,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<Value>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint = cursor::query_fingerprint(&("database_views_v1", database_id))?;
    let subject = CollectionCursorSubject {
        kind: "database_views",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let RankCursor {
        bucket: after_bucket,
        rank: after_rank,
        stable_id: after_id,
    } = decode_rank_cursor(connection, subject, normalized.after)?;
    let query_limit = i64::try_from(normalized.first.saturating_add(1))
        .map_err(|_| invalid("Database View window limit overflowed"))?;
    let ids = connection
        .prepare(
            "SELECT id, 0, rank_key \
             FROM database_views WHERE database_block_id = ?1 AND lifecycle = 'active' \
               AND (?2 IS NULL \
                 OR CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END > ?2 \
                 OR (CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END = ?2 AND rank_key > ?3) \
                 OR (CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END = ?2 \
                   AND rank_key = ?3 AND id > ?4)) \
             ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id \
             LIMIT ?5",
        )?
        .query_map(
            params![database_id, after_bucket, after_rank, after_id, query_limit],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let candidates = ids
        .into_iter()
        .map(|(id, bucket, rank)| {
            Ok(WindowCandidate {
                item: view_record(connection, library_id, project_id, &id)?,
                coordinate: KeysetCoordinate {
                    values: vec![
                        cursor::KeysetValue::Integer { value: bucket },
                        cursor::KeysetValue::Text { value: rank },
                    ],
                    stable_id: id,
                },
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    assemble_database_window(
        connection,
        subject,
        commit_head,
        normalized.first,
        candidates,
    )
}

fn property_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    data_source_id: &str,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<DatabasePropertyDescriptor>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint = cursor::query_fingerprint(&("database_properties_v1", data_source_id))?;
    let subject = CollectionCursorSubject {
        kind: "database_properties",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let RankCursor {
        bucket: after_bucket,
        rank: after_rank,
        stable_id: after_id,
    } = decode_rank_cursor(connection, subject, normalized.after)?;
    let query_limit = i64::try_from(normalized.first.saturating_add(1))
        .map_err(|_| invalid("Property window limit overflowed"))?;
    let candidate_rows = connection
        .prepare(
            "SELECT id, data_source_id, name, value_type, config_json, rank_key, lifecycle, \
               schema_revision, created_at, updated_at, \
               CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END \
             FROM data_source_properties WHERE data_source_id = ?1 AND lifecycle = 'active' \
               AND (?2 IS NULL \
                 OR CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END > ?2 \
                 OR (CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END = ?2 AND rank_key > ?3) \
                 OR (CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END = ?2 \
                   AND rank_key = ?3 AND id > ?4)) \
             ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, rank_key, id \
             LIMIT ?5",
        )?
        .query_map(
            params![
                data_source_id,
                after_bucket,
                after_rank,
                after_id,
                query_limit
            ],
            |row| {
                let id = row.get::<_, String>(0)?;
                let value_type = row.get::<_, String>(3)?;
                let config = parse_json(row.get::<_, String>(4)?, "Property config")?;
                let (_, option_count) = compact_property_config(config, &value_type)?;
                let rank = row.get::<_, String>(5)?;
                let bucket = row.get::<_, i64>(10)?;
                Ok((
                    PropertyDescriptorRow {
                        property_id: id.clone(),
                        data_source_id: row.get::<_, String>(1)?,
                        name: row.get::<_, String>(2)?,
                        value_type,
                        option_count,
                        rank_key: rank.clone(),
                        lifecycle: row.get::<_, String>(6)?,
                        revision: row.get::<_, i64>(7)?,
                        created_at: row.get::<_, String>(8)?,
                        updated_at: row.get::<_, String>(9)?,
                    },
                    KeysetCoordinate {
                        values: vec![
                            cursor::KeysetValue::Integer { value: bucket },
                            cursor::KeysetValue::Text { value: rank },
                        ],
                        stable_id: id,
                    },
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let candidates = candidate_rows
        .into_iter()
        .map(|(row, coordinate)| {
            Ok(WindowCandidate {
                item: property_descriptor(connection, row)?,
                coordinate,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    assemble_database_window(
        connection,
        subject,
        commit_head,
        normalized.first,
        candidates,
    )
}

fn option_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    data_source_id: &str,
    property_id: &str,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<Value>, StoreError> {
    let normalized = normalize_request(request)?;
    let (value_type, config_json, property_revision) = connection
        .query_row(
            "SELECT value_type, config_json, schema_revision FROM data_source_properties \
             WHERE data_source_id = ?1 AND id = ?2 AND lifecycle = 'active'",
            params![data_source_id, property_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Property is unavailable"))?;
    if !matches!(value_type.as_str(), "select" | "multi_select") {
        return Err(invalid("Property is not option-backed"));
    }
    let fingerprint = cursor::query_fingerprint(&(
        "database_property_options_v2",
        data_source_id,
        property_id,
        property_revision,
    ))?;
    let subject = CollectionCursorSubject {
        kind: "database_property_options",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let after = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            let [cursor::KeysetValue::Integer { value: ordinal }] = coordinate.values.as_slice()
            else {
                return Err(invalid("Property option cursor is incompatible"));
            };
            if direction != CursorDirection::Forward || *ordinal < 0 {
                return Err(invalid("Property option cursor is incompatible"));
            }
            usize::try_from(*ordinal).map_err(|_| invalid("Property option cursor is incompatible"))
        })
        .transpose()?;
    let options = parse_json(config_json, "Property config")?
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| corrupt("Property option registry is invalid"))?;
    if options.len() > super::MAX_PROPERTY_OPTIONS {
        return Err(corrupt("Property option registry exceeds its bound"));
    }
    let candidates = options
        .into_iter()
        .enumerate()
        .filter(|(ordinal, _)| after.is_none_or(|after| *ordinal > after))
        .take(normalized.first.saturating_add(1))
        .map(|(ordinal, option)| {
            let id = option_id(&option).to_owned();
            WindowCandidate {
                item: option,
                coordinate: KeysetCoordinate {
                    values: vec![cursor::KeysetValue::Integer {
                        value: i64::try_from(ordinal)
                            .expect("Property option ordinals stay within their fixed bound"),
                    }],
                    stable_id: id,
                },
            }
        })
        .collect();
    assemble_database_window(
        connection,
        subject,
        commit_head,
        normalized.first,
        candidates,
    )
}

fn assemble_database_window<T: serde::Serialize>(
    connection: &Connection,
    subject: CollectionCursorSubject<'_>,
    commit_head: i64,
    first: usize,
    candidates: Vec<WindowCandidate<T>>,
) -> Result<CollectionWindow<T>, StoreError> {
    assemble(
        candidates,
        first,
        CollectionWindowAuthority {
            projection_revision: commit_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )
}

struct RankCursor {
    bucket: Option<i64>,
    rank: Option<String>,
    stable_id: Option<String>,
}

fn decode_rank_cursor(
    connection: &Connection,
    subject: CollectionCursorSubject<'_>,
    encoded: Option<&str>,
) -> Result<RankCursor, StoreError> {
    let Some(encoded) = encoded else {
        return Ok(RankCursor {
            bucket: None,
            rank: None,
            stable_id: None,
        });
    };
    let (direction, coordinate) = cursor::decode(connection, encoded, subject)?;
    let [
        cursor::KeysetValue::Integer { value: bucket },
        cursor::KeysetValue::Text { value: rank },
    ] = coordinate.values.as_slice()
    else {
        return Err(invalid("Database descriptor cursor is incompatible"));
    };
    if direction != CursorDirection::Forward {
        return Err(invalid(
            "Database descriptor cursor direction is incompatible",
        ));
    }
    Ok(RankCursor {
        bucket: Some(*bucket),
        rank: Some(rank.clone()),
        stable_id: Some(coordinate.stable_id),
    })
}

fn compact_property_config(
    mut config: Value,
    value_type: &str,
) -> rusqlite::Result<(Value, usize)> {
    if !matches!(value_type, "select" | "multi_select") {
        return Ok((config, 0));
    }
    let options = config
        .get_mut("options")
        .and_then(Value::as_array_mut)
        .ok_or(rusqlite::Error::InvalidQuery)?;
    let option_count = options.len();
    options.clear();
    Ok((config, option_count))
}

fn option_id(option: &Value) -> &str {
    option.get("id").and_then(Value::as_str).unwrap_or("")
}

fn default_view_for_database(
    connection: &Connection,
    database_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT default_view_id FROM database_containers WHERE block_id = ?1",
            [database_id],
            |row| row.get::<_, Option<String>>(0),
        )?
        .ok_or_else(|| not_found("Database has no default View"))
}

fn default_view_for_source(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT view.id \
             FROM database_views view \
             JOIN database_containers database \
               ON database.block_id = view.database_block_id \
               AND database.library_id = ?1 \
             WHERE view.data_source_id = ?2 \
               AND view.lifecycle = 'active' \
               AND database.lifecycle = 'active' \
             ORDER BY CASE WHEN view.id = database.default_view_id THEN 0 ELSE 1 END, \
               view.rank_key, view.id \
             LIMIT 1",
            params![library_id, data_source_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Data Source has no active View"))
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

fn data_source_for_page(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT parent_id FROM pages \
             WHERE block_id = ?1 AND library_id = ?2 AND parent_kind = 'data_source' \
               AND lifecycle <> 'deleted'",
            params![page_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Database Page is unavailable"))
}

fn database_descriptor(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
) -> Result<Value, StoreError> {
    Ok(json!({
        "database": container_record(connection, library_id, database_id)?,
    }))
}

fn data_source_descriptor(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<Value, StoreError> {
    Ok(json!({
        "dataSource": source_record(connection, library_id, data_source_id)?,
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
) -> Result<Vec<DatabasePropertyDescriptor>, StoreError> {
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
    let rows = connection
        .prepare(&sql)?
        .query_map([data_source_id], |row| {
            let property_id = row.get::<_, String>(0)?;
            let value_type = row.get::<_, String>(3)?;
            let config = parse_json(row.get::<_, String>(4)?, "Property config")?;
            let (_, option_count) = compact_property_config(config, &value_type)?;
            Ok(PropertyDescriptorRow {
                property_id,
                data_source_id: row.get::<_, String>(1)?,
                name: row.get::<_, String>(2)?,
                value_type,
                option_count,
                rank_key: row.get::<_, String>(5)?,
                lifecycle: row.get::<_, String>(6)?,
                revision: row.get::<_, i64>(7)?,
                created_at: row.get::<_, String>(8)?,
                updated_at: row.get::<_, String>(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| property_descriptor(connection, row))
        .collect()
}

fn read_property_configs(
    connection: &Connection,
    data_source_id: &str,
) -> Result<BTreeMap<String, Value>, StoreError> {
    connection
        .prepare(
            "SELECT id, config_json FROM data_source_properties \
             WHERE data_source_id = ?1 AND lifecycle = 'active' ORDER BY id",
        )?
        .query_map([data_source_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                parse_json(row.get::<_, String>(1)?, "Property config")?,
            ))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()
        .map_err(StoreError::from)
}

fn property_record(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<DatabasePropertyDescriptor, StoreError> {
    let row = connection
        .query_row(
            "SELECT id, data_source_id, name, value_type, config_json, rank_key, lifecycle, \
               schema_revision, created_at, updated_at FROM data_source_properties \
             WHERE data_source_id = ?1 AND id = ?2",
            params![data_source_id, property_id],
            |row| {
                let property_id = row.get::<_, String>(0)?;
                let value_type = row.get::<_, String>(3)?;
                let config = parse_json(row.get::<_, String>(4)?, "Property config")?;
                let (_, option_count) = compact_property_config(config, &value_type)?;
                Ok(PropertyDescriptorRow {
                    property_id,
                    data_source_id: row.get::<_, String>(1)?,
                    name: row.get::<_, String>(2)?,
                    value_type,
                    option_count,
                    rank_key: row.get::<_, String>(5)?,
                    lifecycle: row.get::<_, String>(6)?,
                    revision: row.get::<_, i64>(7)?,
                    created_at: row.get::<_, String>(8)?,
                    updated_at: row.get::<_, String>(9)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Property is unavailable"))?;
    property_descriptor(connection, row)
}

fn view_record(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    view_id: &str,
) -> Result<Value, StoreError> {
    let view = connection
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
        .ok_or_else(|| not_found("Database View is unavailable"))?;
    let data_source_id = required_str(&view, "dataSourceId")?;
    let config = view
        .get("config")
        .ok_or_else(|| corrupt("Database View config is missing"))?;
    super::relation::validate_view_filter_read_access(
        connection,
        library_id,
        project_id,
        data_source_id,
        config,
    )?;
    Ok(view)
}

fn validate_view_filter_access_by_id(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    view_id: &str,
) -> Result<(), StoreError> {
    let (data_source_id, config_json) = connection
        .query_row(
            "SELECT data_source_id, config_json FROM database_views WHERE id = ?1",
            [view_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .ok_or_else(|| not_found("Database View is unavailable"))?;
    let config = parse_json(config_json, "View config")?;
    super::relation::validate_view_filter_read_access(
        connection,
        library_id,
        project_id,
        &data_source_id,
        &config,
    )
}

pub(crate) fn view_descriptor_query(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    view_id: &str,
) -> Result<Value, StoreError> {
    let view = view_record(connection, library_id, project_id, view_id)?;
    if view.get("lifecycle").and_then(Value::as_str) != Some("active") {
        return Err(not_found("Database View is not active"));
    }
    let database_id = required_str(&view, "databaseId")?;
    let data_source_id = required_str(&view, "dataSourceId")?;
    let tags_property = property_record(connection, data_source_id, "tags")?;
    if tags_property.lifecycle != "active" {
        return Err(not_found(
            "Default Data Source tags Property is unavailable",
        ));
    }
    Ok(json!({
        "database": container_record(connection, library_id, database_id)?,
        "dataSource": source_record(connection, library_id, data_source_id)?,
        "view": view,
        "properties": [serde_json::to_value(tags_property)
            .map_err(|_| corrupt("Property descriptor cannot encode"))?],
        "rows": [],
    }))
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

pub(crate) fn page_record(connection: &Connection, page_id: &str) -> Result<Value, StoreError> {
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
