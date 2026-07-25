use std::collections::{BTreeMap, BTreeSet};

use nodex_core_contracts::collection::{CollectionWindowAuthority, CollectionWindowRequest};
use nodex_core_contracts::database::{
    DatabaseRowDetail, DatabaseRowSummary, DatabaseRowsById, DatabaseViewWindow,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infrastructure::collection_window::{WindowCandidate, assemble, normalize_request};
use crate::infrastructure::cursor::{
    self, CollectionCursorSubject, CursorDirection, KeysetCoordinate, KeysetValue,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const MAX_FILTER_DEPTH: usize = 8;
const MAX_FILTER_NODES: usize = 1_024;
const MAX_SORT_RULES: usize = 4;
const MAX_DISPLAY_PROPERTIES: usize = 64;
const MAX_ROWS_BY_ID: usize = 100;
const SUMMARY_COLUMN_COUNT: usize = 24;
const COMPATIBILITY_CARD_PROPERTY_IDS: [&str; 8] = [
    "status",
    "priority",
    "estimate",
    "tags",
    "due_date",
    "scheduled_start",
    "scheduled_end",
    "assignee",
];

#[derive(Clone, Debug)]
struct ResolvedView {
    database_id: String,
    data_source_id: String,
    view_id: String,
    config: ViewConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewConfig {
    filter: ViewFilter,
    sort: Vec<ViewSort>,
    group: Option<ViewGroup>,
    display: ViewDisplay,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewDisplay {
    property_ids: Vec<String>,
    #[serde(rename = "showTitle")]
    _show_title: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ViewFilter {
    Group {
        operator: FilterGroupOperator,
        children: Vec<ViewFilter>,
    },
    Clause {
        #[serde(rename = "propertyId")]
        property_id: String,
        operator: FilterOperator,
        value: Option<Value>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum FilterGroupOperator {
    And,
    Or,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum FilterOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    IsEmpty,
    IsNotEmpty,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ViewSort {
    field: ViewSortField,
    direction: SortDirection,
    nulls: NullOrder,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ViewSortField {
    Manual,
    Title,
    Created,
    Property {
        #[serde(rename = "propertyId")]
        property_id: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SortDirection {
    Asc,
    Desc,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum NullOrder {
    First,
    Last,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewGroup {
    property_id: String,
}

#[derive(Clone, Debug)]
struct SortComponent {
    expression: String,
    direction: SortDirection,
}

struct SummaryRow {
    summary: DatabaseRowSummary,
    coordinate_values: Vec<KeysetValue>,
}

pub(super) fn view_window(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    view_id: &str,
    request: &CollectionWindowRequest,
) -> Result<DatabaseViewWindow, StoreError> {
    let view = resolve_view(connection, library_id, view_id)?;
    let normalized = normalize_request(request)?;
    let fingerprint = cursor::query_fingerprint(&(
        "database_view_window_v1",
        &view.view_id,
        &view.data_source_id,
        &view.config,
    ))?;
    let subject = CollectionCursorSubject {
        kind: "database_view_rows",
        library_id,
        query_fingerprint: &fingerprint,
        projection_revision: event_head,
    };
    let (sort_components, mut parameters) = sort_components(&view.config)?;
    let cursor_coordinate = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward {
                return Err(invalid("Database View cursor direction is unsupported"));
            }
            if coordinate.values.len() != sort_components.len() {
                return Err(invalid(
                    "Database View cursor has an incompatible sort coordinate",
                ));
            }
            Ok(coordinate)
        })
        .transpose()?;

    let position_view = bind(&mut parameters, SqlValue::Text(view.view_id.clone()));
    let source = bind(&mut parameters, SqlValue::Text(view.data_source_id.clone()));
    let filter = compile_filter(&view.config.filter, &mut parameters, 1, &mut 0)?;
    let (database_values_projection, property_revisions_projection) =
        compact_value_projections(&view.config, &mut parameters)?;
    let sort_projection = sort_components
        .iter()
        .enumerate()
        .map(|(index, component)| {
            format!(
                "{expression} AS sort_{index}",
                expression = component.expression
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let cursor_predicate = cursor_coordinate
        .as_ref()
        .map(|coordinate| compile_keyset_predicate(&sort_components, coordinate, &mut parameters))
        .transpose()?
        .map(|predicate| format!("WHERE {predicate}"))
        .unwrap_or_default();
    let order = sort_components
        .iter()
        .enumerate()
        .map(|(index, component)| format!("sort_{index} {}", direction_sql(component.direction)))
        .chain(std::iter::once("page_id ASC".to_owned()))
        .collect::<Vec<_>>()
        .join(", ");
    let limit = bind(
        &mut parameters,
        SqlValue::Integer(
            i64::try_from(normalized.first + 1)
                .map_err(|_| invalid("Database View window size is invalid"))?,
        ),
    );
    let sql = format!(
        "WITH candidate_rows AS (\
           SELECT model.page_block_id AS page_id, model.lifecycle, model.title, \
             materialization.title_rich_json, model.description_preview, \
             model.description_length, model.has_description, {database_values_projection}, \
             model.intrinsic_properties_json, {property_revisions_projection}, \
             model.metadata_revision, model.location_revision, model.document_id, \
             model.document_generation, model.document_projected_seq, membership.id, \
             membership.revision, membership.created_at, model.created_at, model.updated_at, \
             position.group_key, position.rank_key, position.revision, \
             NULL AS position_order, {sort_projection} \
           FROM data_source_page_memberships membership \
           JOIN page_read_model model \
             ON model.page_block_id = membership.page_block_id \
             AND model.membership_id = membership.id \
           JOIN documents document \
             ON document.id = model.document_id \
             AND document.generation = model.document_generation \
             AND document.head_seq = model.document_projected_seq \
           JOIN document_materializations materialization \
             ON materialization.document_id = document.id \
             AND materialization.generation = document.generation \
             AND materialization.projected_seq = document.head_seq \
             AND materialization.schema_version = document.schema_version \
           LEFT JOIN database_view_page_positions position \
             ON position.view_id = {position_view} \
             AND position.page_block_id = membership.page_block_id \
           WHERE membership.data_source_id = {source} \
             AND membership.removed_at IS NULL \
             AND model.lifecycle = 'active' \
             AND ({filter})\
         ) \
         SELECT * FROM candidate_rows {cursor_predicate} \
         ORDER BY {order} LIMIT {limit}"
    );
    let group_property_id = view
        .config
        .group
        .as_ref()
        .map(|group| group.property_id.as_str());
    let rows = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), |row| {
            summary_from_row(row, group_property_id, sort_components.len())
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let candidates = rows.into_iter().map(|row| WindowCandidate {
        coordinate: KeysetCoordinate {
            values: row.coordinate_values,
            stable_id: row.summary.page_id.clone(),
        },
        item: row.summary,
    });
    let rows = assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: event_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )?;
    Ok(DatabaseViewWindow {
        database_id: view.database_id,
        data_source_id: view.data_source_id,
        view_id: view.view_id,
        rows,
    })
}

pub(super) fn rows_by_id(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
    page_ids: &[String],
) -> Result<DatabaseRowsById, StoreError> {
    validate_page_ids(page_ids)?;
    let view = resolve_view(connection, library_id, view_id)?;
    let mut rows = Vec::with_capacity(page_ids.len());
    for page_id in page_ids {
        if let Some(summary) = summary_by_id(connection, &view, page_id)? {
            rows.push(summary);
        }
    }
    Ok(DatabaseRowsById { rows })
}

pub(super) fn row_detail(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
    page_id: &str,
) -> Result<DatabaseRowDetail, StoreError> {
    validate_identity(page_id, "Database Page identity")?;
    let view = resolve_view(connection, library_id, view_id)?;
    let summary = summary_by_id(connection, &view, page_id)?
        .ok_or_else(|| not_found("Database row is unavailable"))?;
    let body_nfm = connection
        .query_row(
            "SELECT materialization.nfm FROM pages page \
             JOIN documents document ON document.id = page.document_id \
             JOIN document_materializations materialization \
               ON materialization.document_id = document.id \
               AND materialization.generation = document.generation \
               AND materialization.projected_seq = document.head_seq \
               AND materialization.schema_version = document.schema_version \
             WHERE page.block_id = ?1",
            [page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Database row has no exact-head Document projection"))?;
    Ok(DatabaseRowDetail { summary, body_nfm })
}

fn resolve_view(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
) -> Result<ResolvedView, StoreError> {
    validate_identity(view_id, "Database View identity")?;
    connection
        .query_row(
            "SELECT view.database_block_id, view.data_source_id, view.config_json, \
               view.lifecycle, container.lifecycle, source.lifecycle \
             FROM database_views view \
             JOIN database_containers container \
               ON container.block_id = view.database_block_id \
               AND container.library_id = ?1 \
             JOIN data_sources source \
               ON source.id = view.data_source_id \
               AND source.library_id = container.library_id \
             WHERE view.id = ?2",
            params![library_id, view_id],
            |row| {
                let config_json = row.get::<_, String>(2)?;
                let config = serde_json::from_str::<ViewConfig>(&config_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        config_json.len(),
                        rusqlite::types::Type::Text,
                        error.into(),
                    )
                })?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    config,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                database_id,
                data_source_id,
                config,
                view_lifecycle,
                database_lifecycle,
                source_lifecycle,
            )| {
                if view_lifecycle != "active"
                    || database_lifecycle != "active"
                    || source_lifecycle != "active"
                {
                    return Err(not_found("Database View is not active"));
                }
                validate_filter(&config.filter, 1, &mut 0)?;
                if config.sort.len() > MAX_SORT_RULES {
                    return Err(invalid("Database View has too many sort rules"));
                }
                if let Some(group) = &config.group {
                    validate_property_id(&group.property_id)?;
                }
                Ok(ResolvedView {
                    database_id,
                    data_source_id,
                    view_id: view_id.to_owned(),
                    config,
                })
            },
        )
        .transpose()?
        .ok_or_else(|| not_found("Database View is unavailable"))
}

fn summary_by_id(
    connection: &Connection,
    view: &ResolvedView,
    page_id: &str,
) -> Result<Option<DatabaseRowSummary>, StoreError> {
    let group_property_id = view
        .config
        .group
        .as_ref()
        .map(|group| group.property_id.as_str());
    let mut parameters = Vec::new();
    let view_parameter = bind(&mut parameters, SqlValue::Text(view.view_id.clone()));
    let source_parameter = bind(&mut parameters, SqlValue::Text(view.data_source_id.clone()));
    let page_parameter = bind(&mut parameters, SqlValue::Text(page_id.to_owned()));
    let (database_values_projection, property_revisions_projection) =
        compact_value_projections(&view.config, &mut parameters)?;
    let sql = format!(
        "SELECT model.page_block_id, model.lifecycle, model.title, \
               materialization.title_rich_json, model.description_preview, \
               model.description_length, model.has_description, {database_values_projection}, \
               model.intrinsic_properties_json, {property_revisions_projection}, \
               model.metadata_revision, model.location_revision, model.document_id, \
               model.document_generation, model.document_projected_seq, membership.id, \
               membership.revision, membership.created_at, model.created_at, model.updated_at, \
               position.group_key, position.rank_key, position.revision, \
               (SELECT count(*) FROM database_view_page_positions peer \
                WHERE peer.view_id = position.view_id \
                  AND peer.group_key IS position.group_key \
                  AND (peer.rank_key < position.rank_key \
                    OR (peer.rank_key = position.rank_key \
                      AND peer.page_block_id < position.page_block_id))) \
             FROM data_source_page_memberships membership \
             JOIN page_read_model model \
               ON model.page_block_id = membership.page_block_id \
               AND model.membership_id = membership.id \
             JOIN documents document \
               ON document.id = model.document_id \
               AND document.generation = model.document_generation \
               AND document.head_seq = model.document_projected_seq \
             JOIN document_materializations materialization \
               ON materialization.document_id = document.id \
               AND materialization.generation = document.generation \
               AND materialization.projected_seq = document.head_seq \
               AND materialization.schema_version = document.schema_version \
             LEFT JOIN database_view_page_positions position \
               ON position.view_id = {view_parameter} \
                 AND position.page_block_id = model.page_block_id \
             WHERE membership.data_source_id = {source_parameter} \
               AND membership.removed_at IS NULL \
               AND model.lifecycle <> 'deleted' AND model.page_block_id = {page_parameter}"
    );
    connection
        .query_row(&sql, params_from_iter(parameters.iter()), |row| {
            summary_from_row(row, group_property_id, 0).map(|row| row.summary)
        })
        .optional()
        .map_err(StoreError::from)
}

fn summary_from_row(
    row: &Row<'_>,
    group_property_id: Option<&str>,
    sort_component_count: usize,
) -> rusqlite::Result<SummaryRow> {
    let page_id = row.get::<_, String>(0)?;
    let database_values = parse_json_map(row.get::<_, String>(7)?, "Database values")?;
    let intrinsic_properties = parse_json_map(row.get::<_, String>(8)?, "intrinsic properties")?;
    let property_revisions = parse_json_map(row.get::<_, String>(9)?, "Property revisions")?;
    let database_value_revisions = property_revisions
        .get("database")
        .and_then(Value::as_object)
        .ok_or(rusqlite::Error::InvalidQuery)?
        .iter()
        .map(|(property_id, value)| {
            let revision = value.as_i64().ok_or(rusqlite::Error::InvalidQuery)?;
            Ok((property_id.clone(), revision))
        })
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    let effective_group_key = group_property_id
        .and_then(|property_id| database_values.get(property_id))
        .and_then(group_key_for_value);
    let coordinate_values = (0..sort_component_count)
        .map(|index| row.get::<_, SqlValue>(SUMMARY_COLUMN_COUNT + index))
        .map(|value| value.and_then(keyset_value_from_sql))
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(SummaryRow {
        summary: DatabaseRowSummary {
            page_id,
            lifecycle: row.get(1)?,
            title: row.get(2)?,
            rich_title: parse_json_value(row.get::<_, String>(3)?, "Page rich title")?,
            description_preview: row.get(4)?,
            description_length: row.get(5)?,
            has_description: row.get::<_, i64>(6)? != 0,
            database_values,
            intrinsic_properties,
            database_value_revisions,
            metadata_revision: row.get(10)?,
            parent_revision: row.get(11)?,
            document_id: row.get(12)?,
            document_generation: row.get(13)?,
            document_head_seq: row.get(14)?,
            membership_id: row.get(15)?,
            membership_revision: row.get(16)?,
            membership_created_at: row.get(17)?,
            created_at: row.get(18)?,
            updated_at: row.get(19)?,
            effective_group_key,
            rank_key: row.get(21)?,
            position_revision: row.get(22)?,
            position_order: row.get(23)?,
        },
        coordinate_values,
    })
}

fn compact_value_projections(
    config: &ViewConfig,
    parameters: &mut Vec<SqlValue>,
) -> Result<(String, String), StoreError> {
    let mut property_ids = config
        .display
        .property_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if let Some(group) = &config.group {
        property_ids.insert(group.property_id.clone());
    }
    if property_ids.len() > MAX_DISPLAY_PROPERTIES {
        return Err(invalid("Database View displays too many Properties"));
    }
    property_ids.extend(
        COMPATIBILITY_CARD_PROPERTY_IDS
            .into_iter()
            .map(str::to_owned),
    );
    for property_id in &property_ids {
        validate_property_id(property_id)?;
    }
    if property_ids.is_empty() {
        return Ok(("'{}'".to_owned(), "'{\"database\":{}}'".to_owned()));
    }
    let placeholders = property_ids
        .into_iter()
        .map(|property_id| bind(parameters, SqlValue::Text(property_id)))
        .collect::<Vec<_>>()
        .join(", ");
    let predicate = format!("value.property_id IN ({placeholders})");
    let values = format!(
        "COALESCE((SELECT json_group_object(value.property_id, json(value.value_json)) \
         FROM data_source_property_values value \
         WHERE value.data_source_id = membership.data_source_id \
           AND value.membership_id = membership.id AND {predicate}), '{{}}')"
    );
    let revisions = format!(
        "json_object('database', json(COALESCE(( \
           SELECT json_group_object(value.property_id, value.revision) \
           FROM data_source_property_values value \
           WHERE value.data_source_id = membership.data_source_id \
             AND value.membership_id = membership.id AND {predicate} \
         ), '{{}}')))"
    );
    Ok((values, revisions))
}

fn sort_components(config: &ViewConfig) -> Result<(Vec<SortComponent>, Vec<SqlValue>), StoreError> {
    let mut parameters = Vec::new();
    if config.sort.is_empty() {
        return Ok((
            vec![
                SortComponent {
                    expression: "CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END".to_owned(),
                    direction: SortDirection::Asc,
                },
                SortComponent {
                    expression: "position.group_key".to_owned(),
                    direction: SortDirection::Asc,
                },
                SortComponent {
                    expression: "position.rank_key".to_owned(),
                    direction: SortDirection::Asc,
                },
            ],
            parameters,
        ));
    }
    if config.sort.len() > MAX_SORT_RULES {
        return Err(invalid("Database View has too many sort rules"));
    }
    let mut components = Vec::new();
    if let Some(group) = &config.group {
        validate_property_id(&group.property_id)?;
        let path = bind(
            &mut parameters,
            SqlValue::Text(json_path(&group.property_id)),
        );
        let expression = format!(
            "COALESCE(position.group_key, json_extract(model.database_values_json, {path}))"
        );
        components.push(SortComponent {
            expression: format!("CASE WHEN {expression} IS NULL THEN 1 ELSE 0 END"),
            direction: SortDirection::Asc,
        });
        components.push(SortComponent {
            expression,
            direction: SortDirection::Asc,
        });
    }
    for rule in &config.sort {
        let expression = match &rule.field {
            ViewSortField::Manual => "position.rank_key".to_owned(),
            ViewSortField::Title => "model.title".to_owned(),
            ViewSortField::Created => "model.created_at".to_owned(),
            ViewSortField::Property { property_id } => {
                validate_property_id(property_id)?;
                let path = bind(&mut parameters, SqlValue::Text(json_path(property_id)));
                format!("json_extract(model.database_values_json, {path})")
            }
        };
        let null_rank = match rule.nulls {
            NullOrder::First => {
                format!("CASE WHEN {expression} IS NULL THEN 0 ELSE 1 END")
            }
            NullOrder::Last => {
                format!("CASE WHEN {expression} IS NULL THEN 1 ELSE 0 END")
            }
        };
        components.push(SortComponent {
            expression: null_rank,
            direction: SortDirection::Asc,
        });
        components.push(SortComponent {
            expression,
            direction: rule.direction,
        });
    }
    Ok((components, parameters))
}

fn compile_filter(
    filter: &ViewFilter,
    parameters: &mut Vec<SqlValue>,
    depth: usize,
    nodes: &mut usize,
) -> Result<String, StoreError> {
    if depth > MAX_FILTER_DEPTH {
        return Err(invalid("Database View filter is too deep"));
    }
    *nodes += 1;
    if *nodes > MAX_FILTER_NODES {
        return Err(invalid("Database View filter has too many nodes"));
    }
    match filter {
        ViewFilter::Group { operator, children } => {
            let separator = match operator {
                FilterGroupOperator::And => " AND ",
                FilterGroupOperator::Or => " OR ",
            };
            if children.is_empty() {
                return Ok(match operator {
                    FilterGroupOperator::And => "1".to_owned(),
                    FilterGroupOperator::Or => "0".to_owned(),
                });
            }
            let children = children
                .iter()
                .map(|child| compile_filter(child, parameters, depth + 1, nodes))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("({})", children.join(separator)))
        }
        ViewFilter::Clause {
            property_id,
            operator,
            value,
        } => {
            validate_property_id(property_id)?;
            let path = bind(parameters, SqlValue::Text(json_path(property_id)));
            let current = format!("json_extract(model.database_values_json, {path})");
            let current_type = format!("json_type(model.database_values_json, {path})");
            let empty = format!(
                "({current_type} IS NULL OR {current_type} = 'null' \
                 OR ({current_type} = 'text' AND {current} = '') \
                 OR ({current_type} = 'array' AND json_array_length({current}) = 0))"
            );
            match operator {
                FilterOperator::IsEmpty => Ok(empty),
                FilterOperator::IsNotEmpty => Ok(format!("NOT {empty}")),
                FilterOperator::Equals | FilterOperator::NotEquals => {
                    let expected = bind(
                        parameters,
                        SqlValue::Text(
                            serde_json::to_string(value.as_ref().unwrap_or(&Value::Null))
                                .map_err(|_| invalid("Database filter value is invalid"))?,
                        ),
                    );
                    let equals = format!("({current} IS json_extract({expected}, '$'))");
                    Ok(match operator {
                        FilterOperator::Equals => equals,
                        FilterOperator::NotEquals => format!("NOT {equals}"),
                        _ => unreachable!(),
                    })
                }
                FilterOperator::Contains | FilterOperator::NotContains => {
                    let expected = bind(
                        parameters,
                        SqlValue::Text(
                            serde_json::to_string(value.as_ref().unwrap_or(&Value::Null))
                                .map_err(|_| invalid("Database filter value is invalid"))?,
                        ),
                    );
                    let contains = format!(
                        "(({current_type} = 'text' \
                            AND instr(CAST({current} AS TEXT), \
                              CAST(json_extract({expected}, '$') AS TEXT)) > 0) \
                          OR ({current_type} = 'array' \
                            AND EXISTS (SELECT 1 FROM json_each({current}) item \
                              WHERE item.value IS json_extract({expected}, '$'))))"
                    );
                    Ok(match operator {
                        FilterOperator::Contains => contains,
                        FilterOperator::NotContains => format!("NOT {contains}"),
                        _ => unreachable!(),
                    })
                }
            }
        }
    }
}

fn compile_keyset_predicate(
    components: &[SortComponent],
    coordinate: &KeysetCoordinate,
    parameters: &mut Vec<SqlValue>,
) -> Result<String, StoreError> {
    let mut disjunctions = Vec::new();
    let mut equal_prefix = Vec::new();
    for (index, (component, value)) in components.iter().zip(&coordinate.values).enumerate() {
        let parameter = bind(parameters, sql_value_from_keyset(value)?);
        if !matches!(value, KeysetValue::Null) {
            let comparator = match component.direction {
                SortDirection::Asc => ">",
                SortDirection::Desc => "<",
            };
            disjunctions.push(format!(
                "({prefix}sort_{index} {comparator} {parameter})",
                prefix = equality_prefix(&equal_prefix),
            ));
        }
        equal_prefix.push(format!("sort_{index} IS {parameter}"));
    }
    let stable_id = bind(parameters, SqlValue::Text(coordinate.stable_id.clone()));
    disjunctions.push(format!(
        "({prefix}page_id > {stable_id})",
        prefix = equality_prefix(&equal_prefix),
    ));
    Ok(format!("({})", disjunctions.join(" OR ")))
}

fn equality_prefix(clauses: &[String]) -> String {
    if clauses.is_empty() {
        return String::new();
    }
    format!("{} AND ", clauses.join(" AND "))
}

fn validate_filter(filter: &ViewFilter, depth: usize, nodes: &mut usize) -> Result<(), StoreError> {
    if depth > MAX_FILTER_DEPTH {
        return Err(invalid("Database View filter is too deep"));
    }
    *nodes += 1;
    if *nodes > MAX_FILTER_NODES {
        return Err(invalid("Database View filter has too many nodes"));
    }
    match filter {
        ViewFilter::Group { children, .. } => {
            for child in children {
                validate_filter(child, depth + 1, nodes)?;
            }
        }
        ViewFilter::Clause { property_id, .. } => validate_property_id(property_id)?,
    }
    Ok(())
}

fn validate_page_ids(page_ids: &[String]) -> Result<(), StoreError> {
    if page_ids.is_empty() || page_ids.len() > MAX_ROWS_BY_ID {
        return Err(invalid("Database rows-by-ID request is out of range"));
    }
    let mut unique = BTreeSet::new();
    for page_id in page_ids {
        validate_identity(page_id, "Database Page identity")?;
        if !unique.insert(page_id) {
            return Err(invalid("Database rows-by-ID request repeats an identity"));
        }
    }
    Ok(())
}

fn validate_property_id(property_id: &str) -> Result<(), StoreError> {
    validate_identity(property_id, "Database Property identity")?;
    if property_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b':' | b'.'))
    {
        return Ok(());
    }
    Err(invalid("Database Property identity is not JSON-path safe"))
}

fn validate_identity(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.len() <= 512 && value.trim() == value {
        return Ok(());
    }
    Err(invalid(&format!("{label} is invalid")))
}

fn json_path(property_id: &str) -> String {
    format!("$.{property_id}")
}

fn bind(parameters: &mut Vec<SqlValue>, value: SqlValue) -> String {
    parameters.push(value);
    format!("?{}", parameters.len())
}

fn direction_sql(direction: SortDirection) -> &'static str {
    match direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    }
}

fn keyset_value_from_sql(value: SqlValue) -> rusqlite::Result<KeysetValue> {
    match value {
        SqlValue::Null => Ok(KeysetValue::Null),
        SqlValue::Integer(value) => Ok(KeysetValue::Integer { value }),
        SqlValue::Real(value) if value.is_finite() => Ok(KeysetValue::Real {
            value: value.to_string(),
        }),
        SqlValue::Text(value) if value.len() <= 512 => Ok(KeysetValue::Text { value }),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn sql_value_from_keyset(value: &KeysetValue) -> Result<SqlValue, StoreError> {
    match value {
        KeysetValue::Null => Ok(SqlValue::Null),
        KeysetValue::Integer { value } => Ok(SqlValue::Integer(*value)),
        KeysetValue::Real { value } => value
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .map(SqlValue::Real)
            .ok_or_else(|| invalid("Database View cursor has an invalid numeric coordinate")),
        KeysetValue::Text { value } => Ok(SqlValue::Text(value.clone())),
    }
}

fn parse_json_map(value: String, label: &str) -> rusqlite::Result<BTreeMap<String, Value>> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Database {label} projection is invalid: {error}"),
            )
            .into(),
        )
    })
}

fn parse_json_value(value: String, label: &str) -> rusqlite::Result<Value> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Database {label} projection is invalid: {error}"),
            )
            .into(),
        )
    })
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

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
