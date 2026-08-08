use std::collections::{BTreeMap, BTreeSet};

use nodex_core_contracts::collection::{
    CollectionWindow, CollectionWindowAuthority, CollectionWindowRequest,
};
use nodex_core_contracts::database::{
    DatabaseGroupScope, DatabaseRowDetail, DatabaseRowSummary, DatabaseRowsById,
    DatabaseViewContextRow, DatabaseViewGroupSummary, DatabaseViewGroups, DatabaseViewWindow,
    MAX_VIEW_GROUP_SUMMARIES,
};
use nodex_core_contracts::events::{LocalProjectionScope, ProjectionSnapshotAuthority};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::authorization::{authorize_required, project_primary_database};
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
    revision: i64,
    exact_primary_board_config: bool,
    config: ViewConfig,
}

pub(super) struct ViewContextProjection {
    pub database_id: String,
    pub data_source_id: String,
    pub property_ids: Vec<String>,
    pub groups: DatabaseViewGroups,
    pub projection: ProjectionSnapshotAuthority,
    pub rows: CollectionWindow<DatabaseViewContextRow>,
}

pub(super) struct ViewWindowRead<'a> {
    pub commit_head: i64,
    pub project_id: Option<&'a str>,
    pub store_epoch: &'a str,
    pub window: &'a CollectionWindowRequest,
    pub group_scope: Option<&'a DatabaseGroupScope>,
}

pub(super) struct ViewGroupsRead<'a> {
    pub commit_head: i64,
    pub project_id: Option<&'a str>,
    pub store_epoch: &'a str,
}

pub(super) struct ViewContextRead<'a> {
    pub commit_head: i64,
    pub project_id: &'a str,
    pub store_epoch: &'a str,
    pub window: &'a CollectionWindowRequest,
    pub group_scope: Option<&'a DatabaseGroupScope>,
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
    view_id: &str,
    read: ViewWindowRead<'_>,
) -> Result<DatabaseViewWindow, StoreError> {
    let view = resolve_view(connection, library_id, view_id)?;
    let projection = projection_snapshot_authority(
        connection,
        library_id,
        read.store_epoch,
        read.commit_head,
        read.project_id,
        &view,
    )?;
    view_window_for(
        connection,
        library_id,
        read.commit_head,
        &view,
        read.window,
        read.group_scope,
        projection,
    )
}

fn view_window_for(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    view: &ResolvedView,
    request: &CollectionWindowRequest,
    group_scope: Option<&DatabaseGroupScope>,
    projection: ProjectionSnapshotAuthority,
) -> Result<DatabaseViewWindow, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint = cursor::query_fingerprint(&(
        "database_view_window_v2",
        &view.view_id,
        &view.data_source_id,
        &view.config,
        group_scope,
    ))?;
    let subject = CollectionCursorSubject {
        kind: "database_view_rows",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let mut parameters = Vec::new();
    let effective_group = effective_group_expression(&view.config, &mut parameters)?;
    let sort_components =
        sort_components(&view.config, effective_group.as_deref(), &mut parameters)?;
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

    let scope_predicate = group_scope
        .map(|scope| group_scope_predicate(scope, effective_group.as_deref(), &mut parameters))
        .transpose()?
        .map(|predicate| format!("AND ({predicate}) "))
        .unwrap_or_default();
    let position_view = bind(&mut parameters, SqlValue::Text(view.view_id.clone()));
    let source = bind(&mut parameters, SqlValue::Text(view.data_source_id.clone()));
    let filter = compile_filter(&view.config.filter, &mut parameters, 1, &mut 0)?;
    let (database_values_projection, property_revisions_projection) =
        compact_value_projections(&view.config, &mut parameters)?;
    let effective_group_select = effective_group.as_deref().unwrap_or("NULL");
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
             {effective_group_select} AS effective_group_key, position.rank_key, \
             position.revision, NULL AS position_order, {sort_projection} \
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
             {scope_predicate}\
             AND ({filter})\
         ) \
         SELECT * FROM candidate_rows {cursor_predicate} \
         ORDER BY {order} LIMIT {limit}"
    );
    let rows = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), |row| {
            summary_from_row(row, sort_components.len())
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
    )?;
    Ok(DatabaseViewWindow {
        database_id: view.database_id.clone(),
        data_source_id: view.data_source_id.clone(),
        view_id: view.view_id.clone(),
        projection,
        rows,
    })
}

fn projection_snapshot_authority(
    connection: &Connection,
    library_id: &str,
    store_epoch: &str,
    commit_head: i64,
    project_id: Option<&str>,
    view: &ResolvedView,
) -> Result<ProjectionSnapshotAuthority, StoreError> {
    let scope = match project_id {
        Some(project_id) => LocalProjectionScope::DatabaseView {
            project_id: project_id.to_owned(),
            database_id: view.database_id.clone(),
            data_source_id: view.data_source_id.clone(),
            view_id: view.view_id.clone(),
        },
        None => LocalProjectionScope::Library {
            library_id: library_id.to_owned(),
        },
    };
    let scope = crate::infrastructure::projection_scope_head::canonical_scope_key(scope)?;
    let head = crate::infrastructure::projection_scope_head::read(connection, store_epoch, &scope)?;
    Ok(ProjectionSnapshotAuthority {
        scope,
        revision: head.as_ref().map_or(0, |value| value.revision),
        covered_commit_seq: commit_head,
        effect_hash: head.map(|value| value.effect_hash),
    })
}

/// Bounded per-group totals for a View, derived from the same candidate row
/// set (memberships, lifecycle, exact-head joins, View filter) and the same
/// effective-group expression as `view_window`, so counts always agree with
/// what group-scoped windows can reach.
pub(crate) fn view_groups(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
    read: ViewGroupsRead<'_>,
) -> Result<DatabaseViewGroups, StoreError> {
    let view = resolve_view(connection, library_id, view_id)?;
    let projection = projection_snapshot_authority(
        connection,
        library_id,
        read.store_epoch,
        read.commit_head,
        read.project_id,
        &view,
    )?;
    view_groups_for(connection, &view, projection)
}

fn view_groups_for(
    connection: &Connection,
    view: &ResolvedView,
    projection: ProjectionSnapshotAuthority,
) -> Result<DatabaseViewGroups, StoreError> {
    let mut parameters = Vec::new();
    let effective_group = effective_group_expression(&view.config, &mut parameters)?;
    let group_select = effective_group.as_deref().unwrap_or("NULL");
    let position_view = bind(&mut parameters, SqlValue::Text(view.view_id.clone()));
    let source = bind(&mut parameters, SqlValue::Text(view.data_source_id.clone()));
    let filter = compile_filter(&view.config.filter, &mut parameters, 1, &mut 0)?;
    let candidate_cte = format!(
        "WITH candidate_rows AS (\
           SELECT {group_select} AS group_key \
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
         )"
    );
    let total_rows = connection.query_row(
        &format!("{candidate_cte} SELECT count(*) FROM candidate_rows"),
        params_from_iter(parameters.iter()),
        |row| row.get::<_, i64>(0),
    )?;
    if effective_group.is_none() {
        return Ok(DatabaseViewGroups {
            database_id: view.database_id.clone(),
            data_source_id: view.data_source_id.clone(),
            view_id: view.view_id.clone(),
            projection,
            grouped: false,
            total_rows,
            truncated: false,
            groups: Vec::new(),
        });
    }
    let limit = bind(
        &mut parameters,
        SqlValue::Integer(
            i64::try_from(MAX_VIEW_GROUP_SUMMARIES + 1)
                .map_err(|_| invalid("Database View group bound is invalid"))?,
        ),
    );
    let sql = format!(
        "{candidate_cte} \
         SELECT group_key, count(*) FROM candidate_rows \
         GROUP BY group_key \
         ORDER BY CASE WHEN group_key IS NULL THEN 1 ELSE 0 END, group_key \
         LIMIT {limit}"
    );
    let mut groups = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), |row| {
            Ok(DatabaseViewGroupSummary {
                group_key: row.get(0)?,
                total_rows: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let truncated = groups.len() > MAX_VIEW_GROUP_SUMMARIES;
    groups.truncate(MAX_VIEW_GROUP_SUMMARIES);
    Ok(DatabaseViewGroups {
        database_id: view.database_id.clone(),
        data_source_id: view.data_source_id.clone(),
        view_id: view.view_id.clone(),
        projection,
        grouped: true,
        total_rows,
        truncated,
        groups,
    })
}

pub(super) fn view_context(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
    read: ViewContextRead<'_>,
) -> Result<ViewContextProjection, StoreError> {
    let view = resolve_view(connection, library_id, view_id)?;
    let projection = projection_snapshot_authority(
        connection,
        library_id,
        read.store_epoch,
        read.commit_head,
        Some(read.project_id),
        &view,
    )?;
    let window = view_window_for(
        connection,
        library_id,
        read.commit_head,
        &view,
        read.window,
        read.group_scope,
        projection.clone(),
    )?;
    let groups = view_groups_for(connection, &view, projection.clone())?;
    let rows = CollectionWindow {
        items: window
            .rows
            .items
            .into_iter()
            .map(|summary| {
                let move_etag = mint_page_move_etag(
                    connection,
                    library_id,
                    read.project_id,
                    read.store_epoch,
                    &summary.page_id,
                    Some(&view.view_id),
                )?;
                Ok(DatabaseViewContextRow { summary, move_etag })
            })
            .collect::<Result<Vec<_>, StoreError>>()?,
        next_cursor: window.rows.next_cursor,
        authority: window.rows.authority,
    };
    Ok(ViewContextProjection {
        database_id: view.database_id.clone(),
        data_source_id: view.data_source_id.clone(),
        property_ids: projected_property_ids(&view.config)?.into_iter().collect(),
        groups,
        projection,
        rows,
    })
}

struct PageMoveAuthority {
    lifecycle: String,
    location_revision: i64,
    parent_kind: String,
    parent_id: String,
    parent_revision: i64,
    metadata_revision: i64,
}

struct PageMoveViewAuthority {
    database_id: String,
    data_source_id: String,
    view_id: String,
    revision: i64,
    grouping_property_id: Option<String>,
}

struct PageMoveMembershipAuthority {
    id: String,
    revision: i64,
    grouping_value_json: Option<String>,
    grouping_value_revision: Option<i64>,
    position_group_key: Option<String>,
    position_rank_key: Option<String>,
    position_revision: Option<i64>,
}

pub(crate) fn default_page_move_view_id(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<Option<String>, StoreError> {
    connection
        .query_row(
            "SELECT container.default_view_id \
             FROM data_source_page_memberships membership \
             JOIN data_sources source \
               ON source.id = membership.data_source_id \
               AND source.library_id = ?1 AND source.lifecycle = 'active' \
             JOIN database_containers container \
               ON container.block_id = source.home_database_block_id \
               AND container.library_id = source.library_id \
               AND container.lifecycle = 'active' \
             WHERE membership.page_block_id = ?2 AND membership.removed_at IS NULL",
            params![library_id, page_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map(Option::flatten)
        .map_err(StoreError::from)
}

pub(crate) fn mint_page_move_etag(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    store_epoch: &str,
    page_id: &str,
    view_id: Option<&str>,
) -> Result<String, StoreError> {
    let page = connection
        .query_row(
            "SELECT page.lifecycle, block.location_revision, page.parent_kind, page.parent_id, \
               page.parent_revision, page.metadata_revision \
             FROM pages page \
             JOIN blocks block ON block.id = page.block_id AND block.type = 'page' \
             WHERE page.block_id = ?1 AND page.library_id = ?2 \
               AND page.lifecycle <> 'deleted' AND block.lifecycle <> 'deleted'",
            params![page_id, library_id],
            |row| {
                Ok(PageMoveAuthority {
                    lifecycle: row.get(0)?,
                    location_revision: row.get(1)?,
                    parent_kind: row.get(2)?,
                    parent_id: row.get(3)?,
                    parent_revision: row.get(4)?,
                    metadata_revision: row.get(5)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| corrupt("Database row move authority is unavailable"))?;
    let view = view_id
        .map(|view_id| {
            let view = resolve_view(connection, library_id, view_id)?;
            let primary_database_id = project_primary_database(connection, library_id, project_id)?;
            authorize_required(
                connection,
                Some(project_id),
                primary_database_id.as_deref(),
                &view.database_id,
            )?;
            Ok::<_, StoreError>(PageMoveViewAuthority {
                database_id: view.database_id,
                data_source_id: view.data_source_id,
                view_id: view.view_id,
                revision: view.revision,
                grouping_property_id: view.config.group.map(|group| group.property_id),
            })
        })
        .transpose()?;
    let membership = view
        .as_ref()
        .map(|view| {
            connection
                .query_row(
                    "SELECT membership.id, membership.revision, value.value_json, value.revision, \
                       position.group_key, position.rank_key, position.revision \
                     FROM data_source_page_memberships membership \
                     LEFT JOIN data_source_property_values value \
                       ON value.data_source_id = membership.data_source_id \
                       AND value.membership_id = membership.id \
                       AND value.property_id = ?3 \
                     LEFT JOIN database_view_page_positions position \
                       ON position.view_id = ?4 \
                       AND position.page_block_id = membership.page_block_id \
                     WHERE membership.data_source_id = ?1 \
                       AND membership.page_block_id = ?2 \
                       AND membership.removed_at IS NULL",
                    params![
                        view.data_source_id,
                        page_id,
                        view.grouping_property_id,
                        view.view_id
                    ],
                    |row| {
                        Ok(PageMoveMembershipAuthority {
                            id: row.get(0)?,
                            revision: row.get(1)?,
                            grouping_value_json: row.get(2)?,
                            grouping_value_revision: row.get(3)?,
                            position_group_key: row.get(4)?,
                            position_rank_key: row.get(5)?,
                            position_revision: row.get(6)?,
                        })
                    },
                )
                .optional()
                .map_err(StoreError::from)
        })
        .transpose()?
        .flatten();
    let effective_group_key = membership.as_ref().and_then(|membership| {
        membership
            .position_group_key
            .as_deref()
            .filter(|key| !key.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                membership
                    .grouping_value_json
                    .as_deref()
                    .and_then(normalize_grouping_value)
            })
    });
    crate::document::mint_etag(
        connection,
        "page_move",
        project_id,
        store_epoch,
        &[library_id, page_id, view_id.unwrap_or("-")],
        json!({
            "libraryId": library_id,
            "page": {
                "lifecycle": page.lifecycle,
                "locationRevision": page.location_revision,
                "parentKind": page.parent_kind,
                "parentId": page.parent_id,
                "parentRevision": page.parent_revision,
                "metadataRevision": page.metadata_revision,
            },
            "membership": {
                "id": membership.as_ref().map(|authority| &authority.id),
                "revision": membership.as_ref().map(|authority| authority.revision),
            },
            "view": {
                "databaseId": view.as_ref().map(|authority| &authority.database_id),
                "dataSourceId": view.as_ref().map(|authority| &authority.data_source_id),
                "id": view.as_ref().map(|authority| &authority.view_id),
                "revision": view.as_ref().map(|authority| authority.revision),
                "groupingPropertyId": view
                    .as_ref()
                    .and_then(|authority| authority.grouping_property_id.as_deref()),
                "groupingValueRevision": membership
                    .as_ref()
                    .and_then(|authority| authority.grouping_value_revision),
            },
            "position": {
                "revision": membership
                    .as_ref()
                    .and_then(|authority| authority.position_revision),
                "effectiveGroupKey": effective_group_key,
                "rankKey": membership
                    .as_ref()
                    .and_then(|authority| authority.position_rank_key.as_deref()),
            },
        }),
    )
    .map_err(|error| {
        StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("Database row move validator authority is unavailable: {error}"),
            false,
        )
    })
}

fn normalize_grouping_value(raw: &str) -> Option<String> {
    match serde_json::from_str::<Value>(raw).ok()? {
        Value::Null => None,
        Value::String(value) => (!value.is_empty()).then_some(value),
        Value::Array(values) if values.is_empty() => None,
        Value::Bool(value) => Some(value.to_string()),
        value => Some(value.to_string()),
    }
}

pub(crate) fn rows_by_id(
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

/// Returns a row patch only when this View has the exact primary Board
/// contract that the singleton patch protocol can represent. Other Views must
/// converge through their canonical bounded read; an identity read is not
/// evidence that a row belongs to a filtered or independently sorted View.
pub(crate) fn exact_primary_board_row_by_id(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
    page_id: &str,
) -> Result<Option<DatabaseRowSummary>, StoreError> {
    validate_identity(page_id, "Database Page identity")?;
    let view = resolve_view(connection, library_id, view_id)?;
    if !has_exact_primary_board_patch_contract(connection, &view)? {
        return Ok(None);
    }
    let Some(mut summary) = summary_by_id(connection, &view, page_id)? else {
        return Ok(None);
    };
    if summary.lifecycle != "active" {
        return Ok(None);
    }
    let Some(rank_key) = summary.rank_key.as_deref() else {
        return Ok(None);
    };
    if !has_exact_active_position(
        connection,
        &view,
        page_id,
        summary.effective_group_key.as_deref(),
        rank_key,
    )? {
        return Ok(None);
    }
    summary.position_order = Some(exact_manual_group_position_order(
        connection,
        &view,
        summary.effective_group_key.as_deref(),
        rank_key,
        page_id,
    )?);
    Ok(Some(summary))
}

fn has_exact_primary_board_patch_contract(
    connection: &Connection,
    view: &ResolvedView,
) -> Result<bool, StoreError> {
    let is_default = connection
        .query_row(
            "SELECT 1 FROM database_containers \
             WHERE block_id = ?1 AND default_view_id = ?2 AND lifecycle = 'active'",
            params![view.database_id, view.view_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    Ok(is_default && view.exact_primary_board_config)
}

fn has_exact_active_position(
    connection: &Connection,
    view: &ResolvedView,
    page_id: &str,
    group_key: Option<&str>,
    rank_key: &str,
) -> Result<bool, StoreError> {
    connection
        .query_row(
            "SELECT 1 FROM database_view_page_positions position \
             JOIN data_source_page_memberships membership \
               ON membership.page_block_id = position.page_block_id \
               AND membership.data_source_id = ?2 AND membership.removed_at IS NULL \
             JOIN page_read_model model \
               ON model.page_block_id = membership.page_block_id \
               AND model.membership_id = membership.id AND model.lifecycle = 'active' \
               AND model.view_id = ?1 AND model.view_group_key IS ?4 \
               AND model.view_rank_key = position.rank_key \
             WHERE position.view_id = ?1 AND position.page_block_id = ?3 \
               AND position.group_key IS ?4 AND position.rank_key = ?5",
            params![
                view.view_id,
                view.data_source_id,
                page_id,
                group_key,
                rank_key
            ],
            |_| Ok(()),
        )
        .optional()
        .map(|value| value.is_some())
        .map_err(StoreError::from)
}

fn exact_manual_group_position_order(
    connection: &Connection,
    view: &ResolvedView,
    group_key: Option<&str>,
    rank_key: &str,
    page_id: &str,
) -> Result<i64, StoreError> {
    connection
        .query_row(
            "SELECT count(*) FROM database_view_page_positions peer \
             JOIN data_source_page_memberships membership \
               ON membership.page_block_id = peer.page_block_id \
               AND membership.data_source_id = ?2 AND membership.removed_at IS NULL \
             JOIN page_read_model model \
               ON model.page_block_id = membership.page_block_id \
               AND model.membership_id = membership.id AND model.lifecycle = 'active' \
               AND model.view_id = ?1 AND model.view_group_key IS peer.group_key \
               AND model.view_rank_key = peer.rank_key \
             WHERE peer.view_id = ?1 AND peer.group_key IS ?3 \
               AND (peer.rank_key < ?4 OR (peer.rank_key = ?4 AND peer.page_block_id < ?5))",
            params![
                view.view_id,
                view.data_source_id,
                group_key,
                rank_key,
                page_id
            ],
            |row| row.get(0),
        )
        .map_err(StoreError::from)
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
            "SELECT view.database_block_id, view.data_source_id, view.config_json, view.revision, \
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
                let config_value =
                    serde_json::from_str::<Value>(&config_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            config_json.len(),
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?;
                let exact_primary_board_config =
                    super::is_exact_primary_board_config(&config_value);
                let config =
                    serde_json::from_value::<ViewConfig>(config_value).map_err(|error| {
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
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    exact_primary_board_config,
                ))
            },
        )
        .optional()?
        .map(
            |(
                database_id,
                data_source_id,
                config,
                revision,
                view_lifecycle,
                database_lifecycle,
                source_lifecycle,
                exact_primary_board_config,
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
                    revision,
                    exact_primary_board_config,
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
    let mut parameters = Vec::new();
    let effective_group = effective_group_expression(&view.config, &mut parameters)?;
    let effective_group_select = effective_group.as_deref().unwrap_or("NULL");
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
               {effective_group_select} AS effective_group_key, position.rank_key, \
               position.revision, \
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
            summary_from_row(row, 0).map(|row| row.summary)
        })
        .optional()
        .map_err(StoreError::from)
}

fn summary_from_row(row: &Row<'_>, sort_component_count: usize) -> rusqlite::Result<SummaryRow> {
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
            effective_group_key: row.get(20)?,
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
    let property_ids = projected_property_ids(config)?;
    if property_ids.is_empty() {
        return Ok(("'{}'".to_owned(), "'{\"database\":{}}'".to_owned()));
    }
    let placeholders = property_ids
        .into_iter()
        .map(|property_id| bind(parameters, SqlValue::Text(property_id)))
        .collect::<Vec<_>>()
        .join(", ");
    let predicate = format!("value.property_id IN ({placeholders})");
    let canonical_values = format!(
        "COALESCE((SELECT json_group_object(value.property_id, json(value.value_json)) \
         FROM data_source_property_values value \
         WHERE value.data_source_id = membership.data_source_id \
           AND value.membership_id = membership.id AND {predicate}), '{{}}')"
    );
    // The normalized Property table stores tag option identities. Page
    // summaries expose their user-facing names from the exact-head read model,
    // without widening this View's configured Property projection. A missing
    // display projection removes tags instead of leaking opaque option IDs.
    let values = format!(
        "json_patch({canonical_values}, CASE \
           WHEN json_type({canonical_values}, '$.tags') IS NOT NULL THEN \
             json_object('tags', CASE \
               WHEN json_type(model.database_values_json, '$.tags') = 'array' THEN \
                 json_extract(model.database_values_json, '$.tags') \
               ELSE NULL \
             END) \
           ELSE '{{}}' \
         END)"
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

fn projected_property_ids(config: &ViewConfig) -> Result<BTreeSet<String>, StoreError> {
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
    Ok(property_ids)
}

/// SQL expression for a row's effective group key, the single source of truth
/// consumed by the summary projection, the sort order, group scoping, and
/// group totals. An explicit board position group wins; otherwise the grouping
/// Property value is normalized so NULL, empty strings, and empty lists all
/// mean "unassigned" (SQL NULL), while numbers, booleans, and composite values
/// group by their canonical JSON text.
fn effective_group_expression(
    config: &ViewConfig,
    parameters: &mut Vec<SqlValue>,
) -> Result<Option<String>, StoreError> {
    let Some(group) = &config.group else {
        return Ok(None);
    };
    validate_property_id(&group.property_id)?;
    let path = bind(parameters, SqlValue::Text(json_path(&group.property_id)));
    let raw = format!("json_extract(model.database_values_json, {path})");
    let raw_type = format!("json_type(model.database_values_json, {path})");
    Ok(Some(format!(
        "COALESCE(NULLIF(position.group_key, ''), \
         CASE {raw_type} \
           WHEN 'true' THEN 'true' \
           WHEN 'false' THEN 'false' \
           WHEN 'text' THEN NULLIF({raw}, '') \
           WHEN 'array' THEN \
             CASE WHEN json_array_length({raw}) = 0 THEN NULL ELSE {raw} END \
           WHEN 'null' THEN NULL \
           ELSE CAST({raw} AS TEXT) \
         END)"
    )))
}

fn group_scope_predicate(
    scope: &DatabaseGroupScope,
    effective_group: Option<&str>,
    parameters: &mut Vec<SqlValue>,
) -> Result<String, StoreError> {
    let Some(expression) = effective_group else {
        return Err(invalid("Database View has no grouping to scope"));
    };
    match scope {
        DatabaseGroupScope::Unassigned => Ok(format!("{expression} IS NULL")),
        DatabaseGroupScope::Key { key } => {
            validate_identity(key, "Database View group key")?;
            let parameter = bind(parameters, SqlValue::Text(key.clone()));
            Ok(format!("{expression} IS {parameter}"))
        }
    }
}

/// One effective-group-major total order shared by flat and group-scoped
/// windows: rows cluster by effective group (unassigned last), then manual
/// rank (positioned rows first) or the configured sort rules, then the stable
/// Page identity appended by the caller.
fn sort_components(
    config: &ViewConfig,
    effective_group: Option<&str>,
    parameters: &mut Vec<SqlValue>,
) -> Result<Vec<SortComponent>, StoreError> {
    if config.sort.len() > MAX_SORT_RULES {
        return Err(invalid("Database View has too many sort rules"));
    }
    let mut components = Vec::new();
    if let Some(expression) = effective_group {
        components.push(SortComponent {
            expression: format!("CASE WHEN {expression} IS NULL THEN 1 ELSE 0 END"),
            direction: SortDirection::Asc,
        });
        components.push(SortComponent {
            expression: expression.to_owned(),
            direction: SortDirection::Asc,
        });
    }
    if config.sort.is_empty() {
        components.push(SortComponent {
            expression: "CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END".to_owned(),
            direction: SortDirection::Asc,
        });
        components.push(SortComponent {
            expression: "position.rank_key".to_owned(),
            direction: SortDirection::Asc,
        });
        return Ok(components);
    }
    for rule in &config.sort {
        let expression = match &rule.field {
            ViewSortField::Manual => "position.rank_key".to_owned(),
            ViewSortField::Title => "model.title".to_owned(),
            ViewSortField::Created => "model.created_at".to_owned(),
            ViewSortField::Property { property_id } => {
                validate_property_id(property_id)?;
                let path = bind(parameters, SqlValue::Text(json_path(property_id)));
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
    Ok(components)
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
            let edge_property = bind(parameters, SqlValue::Text(property_id.clone()));
            let current = format!("json_extract(model.database_values_json, {path})");
            let current_type = format!("json_type(model.database_values_json, {path})");
            let scalar_empty = format!(
                "({current_type} IS NULL OR {current_type} = 'null' \
                 OR ({current_type} = 'text' AND {current} = '') \
                 OR ({current_type} = 'array' AND json_array_length({current}) = 0))"
            );
            let edge_exists = format!(
                "EXISTS(SELECT 1 FROM data_source_relation_edges relation_edge \
                  WHERE relation_edge.source_data_source_id = membership.data_source_id \
                    AND relation_edge.source_membership_id = membership.id \
                    AND relation_edge.property_id = {edge_property})"
            );
            let empty = format!("({scalar_empty} AND NOT {edge_exists})");
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
                              WHERE item.value IS json_extract({expected}, '$'))) \
                          OR EXISTS(SELECT 1 FROM data_source_relation_edges relation_edge \
                            WHERE relation_edge.source_data_source_id = membership.data_source_id \
                              AND relation_edge.source_membership_id = membership.id \
                              AND relation_edge.property_id = {edge_property} \
                              AND relation_edge.target_page_block_id \
                                IS json_extract({expected}, '$')))"
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

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
