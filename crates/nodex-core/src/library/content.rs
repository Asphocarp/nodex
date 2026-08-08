use std::collections::{HashMap, HashSet};

use nodex_core_contracts::library::{
    LibraryContentAssetReference, LibraryContentReference, LibraryPageAccessContext,
    LibraryPageContent, LibraryPageWorkflowStatus, LibraryProjectPageSearchHit, LibraryReadValue,
    LibrarySearchHit, LibrarySearchSourceKind,
};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value as SqlValue};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::database::{current_page_key_for_page, resolve_page_key_matches_in_library};
use crate::domain::page_key::is_explicit_page_key_search;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::cursor;

const PAGE_CONTENT_VERSION: u32 = 1;
const MAX_IDENTITY_BYTES: usize = 512;
const MAX_CONTENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_DERIVED_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_DERIVED_RECORDS: usize = 10_000;
const MAX_SEARCH_QUERY_BYTES: usize = 32 * 1024;
const MAX_SEARCH_TERMS: usize = 32;
const MAX_SEARCH_FILTERS: usize = 64;
const DEFAULT_SEARCH_LIMIT: usize = 20;
const MAX_SEARCH_LIMIT: usize = 100;
const MAX_PROJECT_SEARCH_PROJECTS: usize = 256;
const MAX_PROJECT_SEARCH_CANDIDATES: usize = 400;
const DEFAULT_PROJECT_SEARCH_LIMIT: usize = 50;

struct RawPageContent {
    page_id: String,
    metadata_revision: i64,
    document_id: String,
    document_generation: i64,
    document_head_seq: i64,
    schema_key: String,
    schema_version: i64,
    readiness: String,
    materialization_generation: Option<i64>,
    projected_seq: Option<i64>,
    materialization_schema_version: Option<i64>,
    title: Option<String>,
    rich_title_json: Option<String>,
    nfm: Option<String>,
    plain_text: Option<String>,
    preview: Option<String>,
    references_json: Option<String>,
    asset_refs_json: Option<String>,
}

#[derive(Clone)]
struct ProjectSearchScope {
    project_id: String,
    primary_database_id: Option<String>,
    grants: Vec<ProjectSearchGrant>,
}

#[derive(Clone)]
struct ProjectSearchGrant {
    root_kind: String,
    root_id: String,
}

struct ProjectSearchCoordinates {
    page_ancestor_ids: HashSet<String>,
    database_id: Option<String>,
}

struct ProjectSearchCandidate {
    page_id: String,
    title: String,
    excerpt: String,
    rank: f64,
}

struct AuthorizedProjectSearchCandidate {
    project_id: String,
    page_id: String,
    page_key: Option<String>,
    title: String,
    status: LibraryPageWorkflowStatus,
    excerpt: String,
    rank: f64,
}

pub(super) fn page_content(
    connection: &Connection,
    library_id: &str,
    store_epoch: &str,
    commit_head: i64,
    page_id: &str,
) -> Result<LibraryPageContent, StoreError> {
    validate_identity(page_id, "Page content identity")?;
    let row = connection
        .query_row(
            "SELECT page.block_id, owner.metadata_revision, page.document_id, \
               document.generation, document.head_seq, document.schema_key, \
               document.schema_version, document.readiness, materialization.generation, \
               materialization.projected_seq, materialization.schema_version, \
               materialization.title, materialization.title_rich_json, materialization.nfm, \
               materialization.plain_text, materialization.preview, \
               materialization.references_json, materialization.asset_refs_json \
             FROM pages page JOIN blocks owner \
               ON owner.id = page.block_id AND owner.library_id = page.library_id \
             JOIN documents document \
               ON document.id = page.document_id AND document.library_id = page.library_id \
             LEFT JOIN document_materializations materialization \
               ON materialization.document_id = document.id \
             WHERE page.block_id = ?1 AND page.library_id = ?2 \
               AND owner.lifecycle <> 'deleted'",
            params![page_id, library_id],
            |row| {
                Ok(RawPageContent {
                    page_id: row.get(0)?,
                    metadata_revision: row.get(1)?,
                    document_id: row.get(2)?,
                    document_generation: row.get(3)?,
                    document_head_seq: row.get(4)?,
                    schema_key: row.get(5)?,
                    schema_version: row.get(6)?,
                    readiness: row.get(7)?,
                    materialization_generation: row.get(8)?,
                    projected_seq: row.get(9)?,
                    materialization_schema_version: row.get(10)?,
                    title: row.get(11)?,
                    rich_title_json: row.get(12)?,
                    nfm: row.get(13)?,
                    plain_text: row.get(14)?,
                    preview: row.get(15)?,
                    references_json: row.get(16)?,
                    asset_refs_json: row.get(17)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Library Page content is unavailable"))?;
    let exact = row.readiness == "ready"
        && row.document_generation >= 1
        && row.document_head_seq >= 0
        && row.schema_version >= 1
        && row.materialization_generation == Some(row.document_generation)
        && row.projected_seq == Some(row.document_head_seq)
        && row.materialization_schema_version == Some(row.schema_version);
    if !exact {
        return Err(revision_conflict(
            "Library Page does not have an exact current materialization",
        ));
    }
    let title = require_content(row.title, "Page title")?;
    let rich_title = parse_json_value_array(
        row.rich_title_json,
        "Page rich title",
        MAX_DERIVED_JSON_BYTES,
        MAX_DERIVED_RECORDS,
    )?;
    let body_nfm = require_content(row.nfm, "Page Nested Markdown")?;
    let plain_text = require_content(row.plain_text, "Page plain text")?;
    let preview = require_content(row.preview, "Page preview")?;
    let references = parse_json_array::<LibraryContentReference>(
        row.references_json,
        "Page references",
        MAX_DERIVED_JSON_BYTES,
        MAX_DERIVED_RECORDS,
    )?;
    let asset_refs = parse_json_array::<LibraryContentAssetReference>(
        row.asset_refs_json,
        "Page asset references",
        MAX_DERIVED_JSON_BYTES,
        MAX_DERIVED_RECORDS,
    )?;

    Ok(LibraryPageContent {
        version: PAGE_CONTENT_VERSION,
        library_id: library_id.to_owned(),
        store_epoch: store_epoch.to_owned(),
        commit_seq: commit_head,
        page_id: row.page_id,
        metadata_revision: row.metadata_revision,
        document_id: row.document_id,
        document_generation: row.document_generation,
        document_head_seq: row.document_head_seq,
        schema_key: row.schema_key,
        schema_version: row.schema_version,
        title,
        rich_title,
        body_nfm,
        plain_text,
        preview,
        references,
        asset_refs,
        access_context: LibraryPageAccessContext::Library,
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn search(
    connection: &Connection,
    library_id: &str,
    query: &str,
    include_archived: bool,
    source_kinds: Option<Vec<LibrarySearchSourceKind>>,
    block_types: Option<Vec<String>>,
    requested_cursor: Option<String>,
    limit: Option<u32>,
) -> Result<LibraryReadValue, StoreError> {
    if query.len() > MAX_SEARCH_QUERY_BYTES {
        return Err(invalid("Library search query exceeds its bound"));
    }
    let source_kinds = normalize_source_kinds(source_kinds)?;
    let block_types = normalize_block_types(block_types)?;
    let subject = search_subject(query, include_archived, &source_kinds, &block_types)?;
    let after = search_cursor_coordinate(
        connection,
        requested_cursor.as_deref(),
        library_id,
        &subject,
    )?;
    let limit = search_limit(limit)?;
    let Some(match_query) = build_fts_match_query(query)? else {
        return Ok(LibraryReadValue::Search {
            items: Vec::new(),
            next_cursor: None,
            has_more: false,
        });
    };
    if source_kinds.is_empty() || block_types.as_ref().is_some_and(Vec::is_empty) {
        return Ok(LibraryReadValue::Search {
            items: Vec::new(),
            next_cursor: None,
            has_more: false,
        });
    }

    let mut conditions = vec![
        "block_search_units_fts MATCH ?".to_owned(),
        "unit.document_id IS NOT NULL".to_owned(),
        "document.readiness = 'ready'".to_owned(),
        "document.generation = unit.document_generation".to_owned(),
        "document.head_seq = unit.projected_seq".to_owned(),
        "source.lifecycle <> 'deleted'".to_owned(),
        "owner.lifecycle <> 'deleted'".to_owned(),
        "owner.type = 'page'".to_owned(),
        "owner_page.library_id = ?".to_owned(),
    ];
    let mut parameters = vec![
        SqlValue::Text(match_query),
        SqlValue::Text(library_id.to_owned()),
    ];
    if !include_archived {
        conditions.push("owner.lifecycle = 'active'".to_owned());
    }
    conditions.push(format!(
        "unit.source_kind IN ({})",
        placeholders(source_kinds.len())
    ));
    parameters.extend(
        source_kinds
            .iter()
            .map(|kind| SqlValue::Text(search_source_kind_name(*kind).to_owned())),
    );
    if let Some(block_types) = &block_types {
        conditions.push(format!(
            "source.type IN ({})",
            placeholders(block_types.len())
        ));
        parameters.extend(block_types.iter().cloned().map(SqlValue::Text));
    }
    parameters.extend([
        SqlValue::Integer(i64::from(after.is_some())),
        after
            .as_ref()
            .map_or(SqlValue::Real(0.0), |value| SqlValue::Real(value.0)),
        after.as_ref().map_or_else(
            || SqlValue::Text(String::new()),
            |value| SqlValue::Text(value.1.clone()),
        ),
        after.as_ref().map_or_else(
            || SqlValue::Text(String::new()),
            |value| SqlValue::Text(value.2.clone()),
        ),
        SqlValue::Integer(after.as_ref().map_or(0, |value| value.3)),
        SqlValue::Integer(
            i64::try_from(limit + 1).map_err(|_| invalid("Library search limit is invalid"))?,
        ),
    ]);

    let sql = format!(
        "WITH ranked AS (\
           SELECT unit.library_id, unit.owner_block_id, unit.document_id, unit.block_id, \
             source.type AS block_type, unit.document_generation, unit.projected_seq, \
             unit.source_kind, unit.field_key, \
             snippet(block_search_units_fts, 0, char(2), char(3), '…', 32) AS excerpt, \
             bm25(block_search_units_fts) AS rank, unit.rowid AS search_rowid \
           FROM block_search_units_fts \
           JOIN block_search_units unit ON unit.rowid = block_search_units_fts.rowid \
           JOIN documents document ON document.id = unit.document_id \
             AND document.library_id = unit.library_id \
           JOIN blocks source ON source.id = unit.block_id \
             AND source.library_id = unit.library_id \
           JOIN blocks owner ON owner.id = unit.owner_block_id \
             AND owner.library_id = unit.library_id \
           JOIN pages owner_page ON owner_page.block_id = owner.id \
           WHERE {}\
         ) \
         SELECT library_id, owner_block_id, document_id, block_id, block_type, \
           document_generation, projected_seq, source_kind, field_key, excerpt, rank, search_rowid \
         FROM ranked \
         WHERE ? = 0 OR (rank, owner_block_id, block_id, search_rowid) > (?, ?, ?, ?) \
         ORDER BY rank, owner_block_id, block_id, search_rowid LIMIT ?",
        conditions.join(" AND ")
    );
    let raw = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, f64>(10)?,
                row.get::<_, i64>(11)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut results = raw
        .into_iter()
        .map(|row| -> Result<_, StoreError> {
            let coordinate = (row.10, row.1.clone(), row.3.clone(), row.11);
            Ok((search_hit(row)?, coordinate))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = results.len() > limit;
    results.truncate(limit);
    let next_cursor = if has_more {
        let (_, (rank, owner_page_id, block_id, row_id)) = results
            .last()
            .ok_or_else(|| corrupt("Library search continuation has no row"))?;
        Some(cursor::mint(
            connection,
            library_id,
            &subject,
            cursor::KeysetCoordinate {
                values: vec![
                    cursor::KeysetValue::Real {
                        value: rank.to_string(),
                    },
                    cursor::KeysetValue::Text {
                        value: owner_page_id.clone(),
                    },
                    cursor::KeysetValue::Text {
                        value: block_id.clone(),
                    },
                ],
                stable_id: row_id.to_string(),
            },
        )?)
    } else {
        None
    };
    let items = results.into_iter().map(|(item, _)| item).collect();
    Ok(LibraryReadValue::Search {
        items,
        next_cursor,
        has_more,
    })
}

pub(super) fn project_page_search(
    connection: &Connection,
    library_id: &str,
    project_ids: Vec<String>,
    query: &str,
    limit: Option<u32>,
) -> Result<LibraryReadValue, StoreError> {
    if project_ids.len() > MAX_PROJECT_SEARCH_PROJECTS {
        return Err(invalid("Project Page search scope exceeds its bound"));
    }
    let mut seen = HashSet::new();
    let mut canonical_project_ids = Vec::new();
    for project_id in project_ids {
        validate_identity(&project_id, "Project Page search Project")?;
        if seen.insert(project_id.clone()) {
            canonical_project_ids.push(project_id);
        }
    }
    if canonical_project_ids.is_empty() || query.trim().is_empty() {
        return Ok(LibraryReadValue::ProjectPageSearch { items: Vec::new() });
    }
    if query.len() > MAX_SEARCH_QUERY_BYTES {
        return Err(invalid("Project Page search query exceeds its bound"));
    }
    let limit = usize::try_from(limit.unwrap_or(DEFAULT_PROJECT_SEARCH_LIMIT as u32))
        .map_err(|_| invalid("Project Page search limit is invalid"))?
        .clamp(1, MAX_SEARCH_LIMIT);
    let scopes = project_search_scopes(connection, library_id, &canonical_project_ids)?;
    if scopes.is_empty() {
        return Ok(LibraryReadValue::ProjectPageSearch { items: Vec::new() });
    }
    let mut page_key_items = Vec::new();
    for resolution in resolve_page_key_matches_in_library(connection, library_id, query)? {
        let Some(coordinates) =
            project_search_coordinates(connection, library_id, &resolution.page_block_id)?
        else {
            continue;
        };
        let Some(scope) = scopes
            .iter()
            .find(|scope| project_search_scope_authorizes(scope, &coordinates))
        else {
            continue;
        };
        let Some(status) = project_search_status(connection, &resolution.page_block_id)? else {
            continue;
        };
        let Some(title) = project_search_title(connection, &resolution.page_block_id)? else {
            continue;
        };
        let score =
            2_000_000_i64.saturating_sub(i64::try_from(page_key_items.len()).unwrap_or(i64::MAX));
        page_key_items.push(LibraryProjectPageSearchHit {
            project_id: scope.project_id.clone(),
            page_id: resolution.page_block_id,
            page_key: resolution.current_page_key,
            matched_page_key: Some(resolution.matched_page_key),
            matched_page_key_is_current: Some(resolution.is_current),
            title: title.clone(),
            status,
            score,
            excerpt: title,
        });
    }
    if !page_key_items.is_empty() {
        page_key_items.truncate(limit);
        return Ok(LibraryReadValue::ProjectPageSearch {
            items: page_key_items,
        });
    }
    if is_explicit_page_key_search(query) {
        return Ok(LibraryReadValue::ProjectPageSearch { items: Vec::new() });
    }
    let Some(match_query) = build_fts_match_query(query)? else {
        return Ok(LibraryReadValue::ProjectPageSearch { items: Vec::new() });
    };
    let raw = connection
        .prepare(
            "SELECT unit.owner_block_id, owner_materialization.title, \
               snippet(block_search_units_fts, 0, char(2), char(3), '…', 32), \
               bm25(block_search_units_fts) AS rank \
             FROM block_search_units_fts \
             JOIN block_search_units unit ON unit.rowid = block_search_units_fts.rowid \
             JOIN documents document ON document.id = unit.document_id \
               AND document.library_id = unit.library_id \
             JOIN blocks source ON source.id = unit.block_id \
               AND source.library_id = unit.library_id \
             JOIN blocks owner ON owner.id = unit.owner_block_id \
               AND owner.library_id = unit.library_id \
             JOIN pages owner_page ON owner_page.block_id = owner.id \
             JOIN document_materializations owner_materialization \
               ON owner_materialization.document_id = owner_page.document_id \
             WHERE block_search_units_fts MATCH ?1 \
               AND unit.document_id IS NOT NULL \
               AND document.readiness = 'ready' \
               AND document.generation = unit.document_generation \
               AND document.head_seq = unit.projected_seq \
               AND source.lifecycle <> 'deleted' \
               AND owner.lifecycle = 'active' \
               AND owner.type = 'page' \
               AND owner_page.library_id = ?2 \
               AND unit.source_kind IN ('document_title', 'document_block', 'document_marker') \
             ORDER BY rank, unit.owner_block_id, unit.block_id LIMIT ?3",
        )?
        .query_map(
            params![
                match_query,
                library_id,
                i64::try_from(MAX_PROJECT_SEARCH_CANDIDATES)
                    .map_err(|_| invalid("Project Page search candidate bound is invalid"))?,
            ],
            |row| {
                Ok(ProjectSearchCandidate {
                    page_id: row.get(0)?,
                    title: row.get(1)?,
                    excerpt: normalize_excerpt(&row.get::<_, String>(2)?),
                    rank: row.get(3)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut best_by_page = HashMap::<String, ProjectSearchCandidate>::new();
    for candidate in raw {
        if !candidate.rank.is_finite() {
            return Err(corrupt("Project Page search returned an invalid rank"));
        }
        if best_by_page
            .get(&candidate.page_id)
            .is_some_and(|existing| existing.rank <= candidate.rank)
        {
            continue;
        }
        best_by_page.insert(candidate.page_id.clone(), candidate);
    }
    let mut authorized = Vec::new();
    for candidate in best_by_page.into_values() {
        let Some(coordinates) =
            project_search_coordinates(connection, library_id, &candidate.page_id)?
        else {
            continue;
        };
        let Some(scope) = scopes
            .iter()
            .find(|scope| project_search_scope_authorizes(scope, &coordinates))
        else {
            continue;
        };
        let Some(status) = project_search_status(connection, &candidate.page_id)? else {
            continue;
        };
        let page_key = current_page_key_for_page(connection, library_id, &candidate.page_id)?;
        authorized.push(AuthorizedProjectSearchCandidate {
            project_id: scope.project_id.clone(),
            page_id: candidate.page_id,
            page_key,
            title: candidate.title,
            status,
            excerpt: candidate.excerpt,
            rank: candidate.rank,
        });
    }
    authorized.sort_by(|left, right| {
        left.rank
            .total_cmp(&right.rank)
            .then_with(|| left.project_id.cmp(&right.project_id))
            .then_with(|| left.page_id.cmp(&right.page_id))
    });
    let items = authorized
        .into_iter()
        .take(limit)
        .enumerate()
        .map(|(index, candidate)| LibraryProjectPageSearchHit {
            project_id: candidate.project_id,
            page_id: candidate.page_id,
            page_key: candidate.page_key,
            matched_page_key: None,
            matched_page_key_is_current: None,
            title: candidate.title,
            status: candidate.status,
            score: (1_000_000_i64 - i64::try_from(index).unwrap_or(999_999)).max(1),
            excerpt: candidate.excerpt,
        })
        .collect();
    Ok(LibraryReadValue::ProjectPageSearch { items })
}

fn project_search_scopes(
    connection: &Connection,
    library_id: &str,
    project_ids: &[String],
) -> Result<Vec<ProjectSearchScope>, StoreError> {
    let mut scopes = Vec::new();
    for project_id in project_ids {
        let project = connection
            .query_row(
                "SELECT database_block_id FROM projects WHERE id = ?1 AND library_id = ?2",
                params![project_id, library_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?;
        let Some(primary_database_id) = project else {
            continue;
        };
        let grants = connection
            .prepare(
                "SELECT root_kind, root_id FROM project_resource_grants \
                 WHERE project_id = ?1 AND lifecycle = 'active' \
                 ORDER BY created_at, id",
            )?
            .query_map([project_id], |row| {
                Ok(ProjectSearchGrant {
                    root_kind: row.get(0)?,
                    root_id: row.get(1)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        scopes.push(ProjectSearchScope {
            project_id: project_id.clone(),
            primary_database_id,
            grants,
        });
    }
    Ok(scopes)
}

fn project_search_coordinates(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<Option<ProjectSearchCoordinates>, StoreError> {
    let rows = connection
        .prepare(
            "WITH RECURSIVE ancestors(page_id, parent_kind, parent_id, path) AS ( \
               SELECT block_id, parent_kind, parent_id, '|' || block_id || '|' FROM pages \
                 WHERE block_id = ?1 AND library_id = ?2 \
               UNION ALL \
               SELECT parent.block_id, parent.parent_kind, parent.parent_id, \
                 ancestors.path || parent.block_id || '|' \
               FROM pages parent JOIN ancestors \
                 ON ancestors.parent_kind = 'page' AND parent.block_id = ancestors.parent_id \
               WHERE parent.library_id = ?2 \
                 AND instr(ancestors.path, '|' || parent.block_id || '|') = 0 \
             ) SELECT page_id, parent_kind, parent_id FROM ancestors",
        )?
        .query_map(params![page_id, library_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.is_empty() {
        return Ok(None);
    }
    let page_ancestor_ids = rows.iter().map(|row| row.0.clone()).collect::<HashSet<_>>();
    let Some(terminal) = rows.iter().find(|row| row.1 != "page") else {
        return Ok(None);
    };
    let database_id = match terminal.1.as_str() {
        "library" if terminal.2 == library_id => None,
        "data_source" => {
            let database_id = connection
                .query_row(
                    "SELECT home_database_block_id FROM data_sources \
                     WHERE id = ?1 AND library_id = ?2",
                    params![terminal.2, library_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(database_id) = database_id else {
                return Ok(None);
            };
            Some(database_id)
        }
        _ => return Ok(None),
    };
    Ok(Some(ProjectSearchCoordinates {
        page_ancestor_ids,
        database_id,
    }))
}

fn project_search_scope_authorizes(
    scope: &ProjectSearchScope,
    coordinates: &ProjectSearchCoordinates,
) -> bool {
    if coordinates.database_id.as_deref() == scope.primary_database_id.as_deref()
        && coordinates.database_id.is_some()
    {
        return true;
    }
    scope
        .grants
        .iter()
        .any(|grant| match grant.root_kind.as_str() {
            "page" => coordinates.page_ancestor_ids.contains(&grant.root_id),
            "database" => coordinates.database_id.as_deref() == Some(grant.root_id.as_str()),
            _ => false,
        })
}

fn project_search_status(
    connection: &Connection,
    page_id: &str,
) -> Result<Option<LibraryPageWorkflowStatus>, StoreError> {
    let value = connection
        .query_row(
            "SELECT value.value_json FROM data_source_page_memberships membership \
             JOIN pages page ON page.block_id = membership.page_block_id \
             JOIN blocks page_block ON page_block.id = page.block_id \
               AND page_block.type = 'page' AND page_block.lifecycle = 'active' \
             JOIN data_source_properties property \
               ON property.data_source_id = membership.data_source_id \
               AND property.id = 'status' AND property.lifecycle = 'active' \
             JOIN data_source_property_values value \
               ON value.membership_id = membership.id \
               AND value.property_id = property.id \
               AND value.data_source_id = membership.data_source_id \
             WHERE membership.removed_at IS NULL \
               AND page.parent_kind = 'data_source' \
               AND page.parent_id = membership.data_source_id \
               AND membership.page_block_id = ?1 LIMIT 1",
            [page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(value) = value else {
        return Ok(None);
    };
    let value = serde_json::from_str::<String>(&value).ok();
    Ok(match value.as_deref() {
        Some("triage") => Some(LibraryPageWorkflowStatus::Triage),
        Some("plan") => Some(LibraryPageWorkflowStatus::Plan),
        Some("build") => Some(LibraryPageWorkflowStatus::Build),
        Some("review") => Some(LibraryPageWorkflowStatus::Review),
        Some("ship") => Some(LibraryPageWorkflowStatus::Ship),
        _ => None,
    })
}

fn project_search_title(
    connection: &Connection,
    page_id: &str,
) -> Result<Option<String>, StoreError> {
    connection
        .query_row(
            "SELECT title FROM page_read_model \
             WHERE page_block_id = ?1 AND lifecycle = 'active'",
            [page_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

#[allow(clippy::type_complexity)]
fn search_hit(
    row: (
        String,
        String,
        String,
        String,
        String,
        i64,
        i64,
        String,
        String,
        String,
        f64,
        i64,
    ),
) -> Result<LibrarySearchHit, StoreError> {
    let source_kind = match row.7.as_str() {
        "document_title" => LibrarySearchSourceKind::DocumentTitle,
        "document_block" => LibrarySearchSourceKind::DocumentBlock,
        _ => {
            return Err(corrupt(
                "Library search returned an unsupported source kind",
            ));
        }
    };
    let expected_field = match source_kind {
        LibrarySearchSourceKind::DocumentTitle => "title",
        LibrarySearchSourceKind::DocumentBlock => "text",
    };
    if row.8 != expected_field || row.5 < 1 || row.6 < 0 || !row.10.is_finite() {
        return Err(corrupt(
            "Library search returned invalid projection evidence",
        ));
    }
    Ok(LibrarySearchHit {
        library_id: row.0,
        owner_page_id: row.1,
        document_id: row.2,
        block_id: row.3,
        block_type: row.4,
        document_generation: row.5,
        projected_seq: row.6,
        source_kind,
        field_key: row.8,
        excerpt: normalize_excerpt(&row.9),
        rank: row.10,
    })
}

fn build_fts_match_query(query: &str) -> Result<Option<String>, StoreError> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for character in query
        .trim()
        .to_lowercase()
        .chars()
        .chain(std::iter::once(' '))
    {
        if character.is_alphabetic()
            || character.is_numeric()
            || matches!(character, '_' | '-' | '/' | '@' | '.' | ':' | '#')
        {
            current.push(character);
            continue;
        }
        if current.is_empty() {
            continue;
        }
        if !tokens.contains(&current) {
            tokens.push(std::mem::take(&mut current));
            if tokens.len() > MAX_SEARCH_TERMS {
                return Err(invalid("Library search query has too many terms"));
            }
        } else {
            current.clear();
        }
    }
    if tokens.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        tokens
            .into_iter()
            .map(|token| format!("\"{token}\"*"))
            .collect::<Vec<_>>()
            .join(" "),
    ))
}

fn normalize_source_kinds(
    source_kinds: Option<Vec<LibrarySearchSourceKind>>,
) -> Result<Vec<LibrarySearchSourceKind>, StoreError> {
    let source_kinds = source_kinds.unwrap_or_else(|| {
        vec![
            LibrarySearchSourceKind::DocumentTitle,
            LibrarySearchSourceKind::DocumentBlock,
        ]
    });
    if source_kinds.len() > MAX_SEARCH_FILTERS {
        return Err(invalid("Library search source filter exceeds its bound"));
    }
    let mut unique = Vec::new();
    for kind in source_kinds {
        if !unique.contains(&kind) {
            unique.push(kind);
        }
    }
    unique.sort_by_key(|kind| search_source_kind_name(*kind));
    Ok(unique)
}

fn normalize_block_types(
    block_types: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, StoreError> {
    let Some(block_types) = block_types else {
        return Ok(None);
    };
    if block_types.len() > MAX_SEARCH_FILTERS {
        return Err(invalid(
            "Library search Block type filter exceeds its bound",
        ));
    }
    let mut unique = HashSet::new();
    for block_type in block_types {
        validate_identity(&block_type, "Library search Block type")?;
        unique.insert(block_type);
    }
    let mut block_types = unique.into_iter().collect::<Vec<_>>();
    block_types.sort();
    Ok(Some(block_types))
}

fn search_source_kind_name(kind: LibrarySearchSourceKind) -> &'static str {
    match kind {
        LibrarySearchSourceKind::DocumentTitle => "document_title",
        LibrarySearchSourceKind::DocumentBlock => "document_block",
    }
}

fn search_subject(
    query: &str,
    include_archived: bool,
    source_kinds: &[LibrarySearchSourceKind],
    block_types: &Option<Vec<String>>,
) -> Result<Vec<String>, StoreError> {
    let source_kinds = source_kinds
        .iter()
        .map(|kind| search_source_kind_name(*kind))
        .collect::<Vec<_>>();
    let canonical = serde_json::to_vec(&(query, include_archived, source_kinds, block_types))
        .map_err(|_| invalid("Library search cannot fingerprint its query"))?;
    let fingerprint = Sha256::digest(canonical)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(vec!["search".to_owned(), fingerprint])
}

fn search_cursor_coordinate(
    connection: &Connection,
    requested_cursor: Option<&str>,
    library_id: &str,
    subject: &[String],
) -> Result<Option<(f64, String, String, i64)>, StoreError> {
    let Some(requested_cursor) = requested_cursor else {
        return Ok(None);
    };
    let decoded = cursor::decode(connection, requested_cursor, library_id, subject)?;
    let [
        cursor::KeysetValue::Real { value: rank },
        cursor::KeysetValue::Text {
            value: owner_page_id,
        },
        cursor::KeysetValue::Text { value: block_id },
    ] = decoded.values.as_slice()
    else {
        return Err(invalid("Library search cursor coordinate is invalid"));
    };
    let rank = rank
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or_else(|| invalid("Library search cursor rank is invalid"))?;
    let row_id = decoded
        .stable_id
        .parse::<i64>()
        .map_err(|_| invalid("Library search cursor identity is invalid"))?;
    Ok(Some((
        rank,
        owner_page_id.clone(),
        block_id.clone(),
        row_id,
    )))
}

fn search_limit(limit: Option<u32>) -> Result<usize, StoreError> {
    let limit = usize::try_from(limit.unwrap_or(DEFAULT_SEARCH_LIMIT as u32))
        .map_err(|_| invalid("Library search limit is invalid"))?;
    if (1..=MAX_SEARCH_LIMIT).contains(&limit) {
        return Ok(limit);
    }
    Err(invalid("Library search limit is out of range"))
}

fn placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn normalize_excerpt(value: &str) -> String {
    value
        .replace(['\u{2}', '\u{3}'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn validate_identity(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.len() <= MAX_IDENTITY_BYTES && value.trim() == value {
        return Ok(());
    }
    Err(invalid(&format!("{label} must be canonical and bounded")))
}

fn require_content(value: Option<String>, label: &str) -> Result<String, StoreError> {
    let value =
        value.ok_or_else(|| revision_conflict("Library Page materialization is incomplete"))?;
    if value.len() <= MAX_CONTENT_BYTES {
        return Ok(value);
    }
    Err(corrupt(&format!("{label} exceeds its storage bound")))
}

fn parse_json_value_array(
    value: Option<String>,
    label: &str,
    maximum_bytes: usize,
    maximum_items: usize,
) -> Result<Value, StoreError> {
    let value =
        value.ok_or_else(|| revision_conflict("Library Page materialization is incomplete"))?;
    if value.len() > maximum_bytes {
        return Err(corrupt(&format!("{label} exceeds its storage bound")));
    }
    let parsed = serde_json::from_str::<Value>(&value)
        .map_err(|_| corrupt(&format!("{label} contains invalid JSON")))?;
    let Value::Array(items) = &parsed else {
        return Err(corrupt(&format!("{label} must be a JSON array")));
    };
    if items.len() > maximum_items {
        return Err(corrupt(&format!("{label} exceeds its item bound")));
    }
    Ok(parsed)
}

fn parse_json_array<T: serde::de::DeserializeOwned>(
    value: Option<String>,
    label: &str,
    maximum_bytes: usize,
    maximum_items: usize,
) -> Result<Vec<T>, StoreError> {
    let value =
        value.ok_or_else(|| revision_conflict("Library Page materialization is incomplete"))?;
    if value.len() > maximum_bytes {
        return Err(corrupt(&format!("{label} exceeds its storage bound")));
    }
    let parsed = serde_json::from_str::<Vec<T>>(&value)
        .map_err(|_| corrupt(&format!("{label} contains invalid JSON")))?;
    if parsed.len() > maximum_items {
        return Err(corrupt(&format!("{label} exceeds its item bound")));
    }
    Ok(parsed)
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn revision_conflict(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::RevisionConflict, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::library::{LibraryContentAssetReference, LibraryContentReference};
    use serde_json::json;

    use super::{build_fts_match_query, normalize_excerpt, parse_json_array};

    #[test]
    fn builds_bounded_prefix_queries_and_normalizes_snippets() {
        assert_eq!(
            build_fts_match_query(" Runtime, 核心 runtime ").expect("query"),
            Some("\"runtime\"* \"核心\"*".to_owned())
        );
        assert_eq!(
            normalize_excerpt("A\u{2} match\u{3}\n here"),
            "A match here"
        );
    }

    #[test]
    fn preserves_typed_reference_and_asset_wire_shapes() {
        let references = parse_json_array::<LibraryContentReference>(
            Some(
                r#"[{"kind":"block","sourceBlockId":"source","targetBlockId":"target"}]"#
                    .to_owned(),
            ),
            "references",
            1_024,
            10,
        )
        .expect("references");
        let assets = parse_json_array::<LibraryContentAssetReference>(
            Some(
                r#"[{"sourceBlockId":"source","kind":"image","source":"nodex://assets/file.png","managedFileName":"file.png"}]"#
                    .to_owned(),
            ),
            "assets",
            1_024,
            10,
        )
        .expect("assets");

        assert_eq!(
            serde_json::to_value(references).expect("reference JSON"),
            json!([{
                "kind": "block",
                "sourceBlockId": "source",
                "targetBlockId": "target",
            }])
        );
        assert_eq!(
            serde_json::to_value(assets).expect("asset JSON"),
            json!([{
                "sourceBlockId": "source",
                "kind": "image",
                "source": "nodex://assets/file.png",
                "managedFileName": "file.png",
            }])
        );
    }
}
