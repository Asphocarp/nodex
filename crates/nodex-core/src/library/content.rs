use std::collections::HashSet;

use nodex_core_contracts::library::{
    LibraryContentAssetReference, LibraryContentReference, LibraryPageAccessContext,
    LibraryPageContent, LibraryReadValue, LibrarySearchHit, LibrarySearchSourceKind,
};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value as SqlValue};
use serde_json::Value;
use sha2::{Digest, Sha256};

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

pub(super) fn page_content(
    connection: &Connection,
    library_id: &str,
    store_epoch: &str,
    event_head: i64,
    page_id: &str,
) -> Result<LibraryPageContent, StoreError> {
    validate_identity(page_id, "Page content identity")?;
    let row = connection
        .query_row(
            "SELECT page.block_id, page.metadata_revision, page.document_id, \
               document.generation, document.head_seq, document.schema_key, \
               document.schema_version, document.readiness, materialization.generation, \
               materialization.projected_seq, materialization.schema_version, \
               materialization.title, materialization.title_rich_json, materialization.nfm, \
               materialization.plain_text, materialization.preview, \
               materialization.references_json, materialization.asset_refs_json \
             FROM pages page JOIN blocks owner ON owner.id = page.block_id \
             JOIN documents document ON document.id = page.document_id \
             LEFT JOIN document_materializations materialization \
               ON materialization.document_id = document.id \
             WHERE page.block_id = ?1 AND page.library_id = ?2 \
               AND page.lifecycle <> 'deleted' AND owner.lifecycle <> 'deleted'",
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
        return Err(conflict(
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
        change_log_seq: event_head,
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
    event_head: i64,
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
    let offset = cursor_offset(
        connection,
        requested_cursor.as_deref(),
        library_id,
        &subject,
        event_head,
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
        "owner_page.lifecycle <> 'deleted'".to_owned(),
    ];
    let mut parameters = vec![
        SqlValue::Text(match_query),
        SqlValue::Text(library_id.to_owned()),
    ];
    if !include_archived {
        conditions.push("owner.lifecycle = 'active'".to_owned());
        conditions.push("owner_page.lifecycle = 'active'".to_owned());
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
    parameters.push(SqlValue::Integer(
        i64::try_from(limit + 1).map_err(|_| invalid("Library search limit is invalid"))?,
    ));
    parameters.push(SqlValue::Integer(
        i64::try_from(offset).map_err(|_| invalid("Library search cursor is out of range"))?,
    ));

    let sql = format!(
        "SELECT unit.project_id, unit.owner_block_id, unit.document_id, unit.block_id, \
           source.type, unit.document_generation, unit.projected_seq, unit.source_kind, \
           unit.field_key, snippet(block_search_units_fts, 0, char(2), char(3), '…', 32), \
           bm25(block_search_units_fts) AS rank \
         FROM block_search_units_fts \
         JOIN block_search_units unit ON unit.rowid = block_search_units_fts.rowid \
         JOIN documents document ON document.id = unit.document_id \
           AND document.project_id = unit.project_id \
         JOIN blocks source ON source.id = unit.block_id \
           AND source.project_id = unit.project_id \
         JOIN blocks owner ON owner.id = unit.owner_block_id \
           AND owner.project_id = unit.project_id \
         JOIN pages owner_page ON owner_page.block_id = owner.id \
         WHERE {} ORDER BY rank, unit.owner_block_id, unit.block_id LIMIT ? OFFSET ?",
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
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut items = raw
        .into_iter()
        .map(search_hit)
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit;
    items.truncate(limit);
    let next_cursor = if has_more {
        Some(cursor::mint(
            connection,
            library_id,
            &subject,
            offset + items.len(),
            event_head,
        )?)
    } else {
        None
    };
    Ok(LibraryReadValue::Search {
        items,
        next_cursor,
        has_more,
    })
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
        project_id: row.0,
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

fn cursor_offset(
    connection: &Connection,
    requested_cursor: Option<&str>,
    library_id: &str,
    subject: &[String],
    event_head: i64,
) -> Result<usize, StoreError> {
    let Some(requested_cursor) = requested_cursor else {
        return Ok(0);
    };
    let decoded = cursor::decode(connection, requested_cursor, library_id, subject)?;
    if decoded.change_log_seq != event_head {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Library content changed while search results were being paged",
            false,
        ));
    }
    Ok(decoded.offset)
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
    let value = value.ok_or_else(|| conflict("Library Page materialization is incomplete"))?;
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
    let value = value.ok_or_else(|| conflict("Library Page materialization is incomplete"))?;
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
    let value = value.ok_or_else(|| conflict("Library Page materialization is incomplete"))?;
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

fn conflict(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Conflict, message, false)
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
