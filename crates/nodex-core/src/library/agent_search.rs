use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::agent::{
    AgentAuthorizationTarget, AgentExecutionAuthorization, AgentProjectResourceAction,
};
use nodex_core_contracts::library::{
    LibraryAgentPageLocation, LibraryAgentPageSearchMatch, LibraryAgentSearchMatchQuality,
    LibraryAgentSearchResult, LibraryAgentSearchScope, LibraryAgentSearchTarget, LibraryReadValue,
    LibrarySearchSourceKind,
};
use rusqlite::{Connection, params_from_iter, types::Value as SqlValue};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::{agent_authorization, cursor};

const MAX_QUERY_BYTES: usize = 512;
const MAX_TERMS: usize = 32;
const MAX_FILTERS: usize = 64;
const MAX_METADATA_PAGES: usize = 5_000;
const MAX_PROPERTY_VALUES_PER_PAGE: usize = 64;
const MAX_PROPERTY_TEXT_BYTES_PER_PAGE: usize = 32 * 1024;
const MAX_PROPERTY_DISPLAY_CHARS: usize = 4_096;
const MAX_FTS_HITS_PER_TERM: usize = 200;
const SQLITE_ID_BATCH: usize = 400;
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 100;

#[derive(Clone)]
struct PageCandidate {
    id: String,
    title: String,
    parent_kind: String,
    parent_id: String,
}

struct PropertyValue {
    property_id: String,
    property_name: String,
    text: String,
}

#[derive(Clone)]
enum EvidenceKind {
    Identity,
    Title,
    Property {
        property_id: String,
        property_name: String,
    },
    Body {
        block_id: String,
        block_type: String,
    },
}

#[derive(Clone)]
struct Evidence {
    term: String,
    kind: EvidenceKind,
    quality: LibraryAgentSearchMatchQuality,
    excerpt: String,
}

struct PageAggregate {
    page: PageCandidate,
    matched_terms: HashSet<String>,
    evidence: Vec<Evidence>,
    rank: f64,
}

#[derive(Clone)]
struct FtsHit {
    owner_page_id: String,
    block_id: String,
    block_type: String,
    source: LibrarySearchSourceKind,
    excerpt: String,
    rank: f64,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn read(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    authorization: &AgentExecutionAuthorization,
    query: &str,
    target: LibraryAgentSearchTarget,
    scope: LibraryAgentSearchScope,
    block_types: Option<Vec<String>>,
    include_archived: bool,
    requested_cursor: Option<&str>,
    limit: Option<u32>,
) -> Result<LibraryReadValue, StoreError> {
    let query = validate_query(query)?;
    let terms = search_terms(query)?;
    let block_types = normalize_block_types(target, block_types)?;
    authorize_explicit_scope(connection, context, library_id, authorization, &scope)?;
    let subject = search_subject(
        query,
        target,
        &scope,
        &block_types,
        include_archived,
        &authorization.provenance.authority.actor_project_id,
    )?;
    let after = search_cursor_identity(connection, requested_cursor, library_id, &subject)?;
    let limit = search_limit(limit)?;
    if terms.is_empty() || block_types.as_ref().is_some_and(Vec::is_empty) {
        agent_authorization::authorized_page_ids(
            connection,
            context,
            library_id,
            authorization,
            &[],
        )?;
        return empty();
    }

    let candidates = read_page_candidates(connection, library_id, &scope, include_archived)?;
    let candidate_ids = candidates
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect::<Vec<_>>();
    let authorized = agent_authorization::authorized_page_ids(
        connection,
        context,
        library_id,
        authorization,
        &candidate_ids,
    )?;
    let candidates = candidates
        .into_iter()
        .filter(|candidate| authorized.contains(&candidate.id))
        .collect::<Vec<_>>();
    let authorized_ids = candidates
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect::<Vec<_>>();
    let mut items = match target {
        LibraryAgentSearchTarget::Pages => {
            search_pages(connection, &terms, candidates, include_archived)?
        }
        LibraryAgentSearchTarget::Blocks => search_blocks(
            connection,
            &terms,
            &authorized_ids,
            block_types.as_deref(),
            include_archived,
        )?,
    };
    let start = after
        .as_deref()
        .map(|after| {
            items
                .iter()
                .position(|item| search_result_id(item) == after)
                .map(|index| index + 1)
                .ok_or_else(|| conflict("Agent search cursor coordinate is no longer available"))
        })
        .transpose()?
        .unwrap_or(0);
    let end = start.saturating_add(limit).min(items.len());
    let has_more = end < items.len();
    let page = items.drain(start..end).collect::<Vec<_>>();
    let next_cursor = if has_more {
        let stable_id = page
            .last()
            .map(search_result_id)
            .ok_or_else(|| corrupt("Agent search continuation has no result"))?;
        Some(cursor::mint(
            connection,
            library_id,
            &subject,
            cursor::KeysetCoordinate {
                values: Vec::new(),
                stable_id: stable_id.to_owned(),
            },
        )?)
    } else {
        None
    };
    Ok(LibraryReadValue::AgentSearch {
        items: page,
        next_cursor,
        has_more,
    })
}

fn empty() -> Result<LibraryReadValue, StoreError> {
    Ok(LibraryReadValue::AgentSearch {
        items: Vec::new(),
        next_cursor: None,
        has_more: false,
    })
}

fn authorize_explicit_scope(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    authorization: &AgentExecutionAuthorization,
    scope: &LibraryAgentSearchScope,
) -> Result<(), StoreError> {
    let target = match scope {
        LibraryAgentSearchScope::Library => return Ok(()),
        LibraryAgentSearchScope::Database { database_id } => AgentAuthorizationTarget::Database {
            database_id: database_id.clone(),
        },
        LibraryAgentSearchScope::DataSource { data_source_id } => {
            AgentAuthorizationTarget::DataSource {
                data_source_id: data_source_id.clone(),
            }
        }
        LibraryAgentSearchScope::Page { page_id } => AgentAuthorizationTarget::Page {
            page_id: page_id.clone(),
        },
    };
    agent_authorization::authorize_execution(
        connection,
        context,
        library_id,
        authorization,
        &target,
        AgentProjectResourceAction::Read,
    )?;
    Ok(())
}

fn read_page_candidates(
    connection: &Connection,
    library_id: &str,
    scope: &LibraryAgentSearchScope,
    include_archived: bool,
) -> Result<Vec<PageCandidate>, StoreError> {
    let lifecycle = if include_archived {
        "page.lifecycle <> 'deleted' AND page_block.lifecycle <> 'deleted'"
    } else {
        "page.lifecycle = 'active' AND page_block.lifecycle = 'active'"
    };
    let mut conditions = vec![
        "page.library_id = ?".to_owned(),
        lifecycle.to_owned(),
        "document.readiness = 'ready'".to_owned(),
        "materialization.generation = document.generation".to_owned(),
        "materialization.projected_seq = document.head_seq".to_owned(),
        "materialization.schema_version = document.schema_version".to_owned(),
    ];
    let mut parameters = vec![
        SqlValue::Text(library_id.to_owned()),
        SqlValue::Text(library_id.to_owned()),
        SqlValue::Text(library_id.to_owned()),
    ];
    match scope {
        LibraryAgentSearchScope::Library => {}
        LibraryAgentSearchScope::Page { page_id } => {
            conditions.push("page.block_id = ?".to_owned());
            parameters.push(SqlValue::Text(page_id.clone()));
        }
        LibraryAgentSearchScope::DataSource { data_source_id } => {
            conditions.push("terminal.parent_kind = 'data_source'".to_owned());
            conditions.push("terminal.parent_id = ?".to_owned());
            parameters.push(SqlValue::Text(data_source_id.clone()));
        }
        LibraryAgentSearchScope::Database { database_id } => {
            conditions.push("terminal.parent_kind = 'data_source'".to_owned());
            conditions.push("source.home_database_block_id = ?".to_owned());
            parameters.push(SqlValue::Text(database_id.clone()));
        }
    }
    parameters.push(SqlValue::Integer((MAX_METADATA_PAGES + 1) as i64));
    let sql = format!(
        "WITH RECURSIVE hierarchy(root_page_id, page_id, parent_kind, parent_id, path) AS ( \
           SELECT block_id, block_id, parent_kind, parent_id, '|' || block_id || '|' \
           FROM pages WHERE library_id = ? \
           UNION ALL \
           SELECT hierarchy.root_page_id, parent.block_id, parent.parent_kind, parent.parent_id, \
             hierarchy.path || parent.block_id || '|' \
           FROM hierarchy JOIN pages parent \
             ON hierarchy.parent_kind = 'page' AND parent.block_id = hierarchy.parent_id \
           WHERE parent.library_id = ? \
             AND instr(hierarchy.path, '|' || parent.block_id || '|') = 0 \
         ) \
         SELECT page.block_id, materialization.title, page.parent_kind, page.parent_id \
         FROM pages page \
         JOIN blocks page_block ON page_block.id = page.block_id \
         JOIN documents document ON document.id = page.document_id \
           AND document.project_id = page_block.project_id \
         JOIN document_materializations materialization \
           ON materialization.document_id = document.id \
         JOIN hierarchy terminal ON terminal.root_page_id = page.block_id \
           AND terminal.parent_kind <> 'page' \
         LEFT JOIN data_sources source ON terminal.parent_kind = 'data_source' \
           AND source.id = terminal.parent_id AND source.library_id = page.library_id \
         WHERE {} ORDER BY page.block_id LIMIT ?",
        conditions.join(" AND ")
    );
    let candidates = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), |row| {
            Ok(PageCandidate {
                id: row.get(0)?,
                title: row.get(1)?,
                parent_kind: row.get(2)?,
                parent_id: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if candidates.len() > MAX_METADATA_PAGES {
        return Err(StoreError::new(
            StoreErrorCode::ResourceExhausted,
            "Agent Page-search scope exceeds its bounded metadata index",
            false,
        ));
    }
    Ok(candidates)
}

fn search_pages(
    connection: &Connection,
    terms: &[String],
    candidates: Vec<PageCandidate>,
    include_archived: bool,
) -> Result<Vec<LibraryAgentSearchResult>, StoreError> {
    let candidate_ids = candidates
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect::<Vec<_>>();
    let candidate_by_id = candidates
        .iter()
        .map(|candidate| (candidate.id.clone(), candidate))
        .collect::<HashMap<_, _>>();
    let properties = read_property_values(connection, &candidate_ids)?;
    let mut aggregates = HashMap::<String, PageAggregate>::new();
    for page in &candidates {
        for (term_index, term) in terms.iter().enumerate() {
            let mut evidence = metadata_evidence(
                page,
                properties
                    .get(&page.id)
                    .map(Vec::as_slice)
                    .unwrap_or_default(),
                term,
            );
            if evidence.is_empty() {
                continue;
            }
            let aggregate = aggregates
                .entry(page.id.clone())
                .or_insert_with(|| PageAggregate {
                    page: page.clone(),
                    matched_terms: HashSet::new(),
                    evidence: Vec::new(),
                    rank: 0.0,
                });
            aggregate.matched_terms.insert(term.clone());
            aggregate.rank += 1.0 / (60 + term_index) as f64;
            aggregate.evidence.append(&mut evidence);
        }
    }
    for (term_index, term) in terms.iter().enumerate() {
        let mut hits = search_fts(connection, term, &candidate_ids, None, include_archived)?;
        hits.truncate(MAX_FTS_HITS_PER_TERM);
        for (hit_index, hit) in hits.into_iter().enumerate() {
            let Some(page) = candidate_by_id.get(&hit.owner_page_id) else {
                continue;
            };
            let quality = exact_or_prefix(&hit.excerpt, term);
            let kind = match hit.source {
                LibrarySearchSourceKind::DocumentTitle => EvidenceKind::Title,
                LibrarySearchSourceKind::DocumentBlock => EvidenceKind::Body {
                    block_id: hit.block_id,
                    block_type: hit.block_type,
                },
            };
            let aggregate = aggregates
                .entry(page.id.clone())
                .or_insert_with(|| PageAggregate {
                    page: (**page).clone(),
                    matched_terms: HashSet::new(),
                    evidence: Vec::new(),
                    rank: 0.0,
                });
            aggregate.matched_terms.insert(term.clone());
            aggregate.evidence.push(Evidence {
                term: term.clone(),
                kind,
                quality,
                excerpt: hit.excerpt,
            });
            aggregate.rank += 1.0 / (60 + term_index + hit_index) as f64;
        }
    }
    let mut aggregates = aggregates
        .into_values()
        .filter(|aggregate| {
            terms
                .iter()
                .all(|term| aggregate.matched_terms.contains(term))
        })
        .collect::<Vec<_>>();
    aggregates.sort_by(|left, right| {
        evidence_tier(&left.evidence)
            .cmp(&evidence_tier(&right.evidence))
            .then_with(|| {
                right
                    .rank
                    .partial_cmp(&left.rank)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| left.page.id.cmp(&right.page.id))
    });
    aggregates
        .into_iter()
        .map(|aggregate| {
            let location = page_location(&aggregate.page)?;
            Ok(LibraryAgentSearchResult::Page {
                id: aggregate.page.id,
                title: aggregate.page.title,
                location,
                matches: representative_evidence(aggregate.evidence, terms),
            })
        })
        .collect()
}

fn search_blocks(
    connection: &Connection,
    terms: &[String],
    page_ids: &[String],
    block_types: Option<&[String]>,
    include_archived: bool,
) -> Result<Vec<LibraryAgentSearchResult>, StoreError> {
    let query = terms.join(" ");
    let hits = search_fts(connection, &query, page_ids, block_types, include_archived)?;
    let mut seen = HashSet::new();
    Ok(hits
        .into_iter()
        .filter(|hit| seen.insert(hit.block_id.clone()))
        .take(MAX_FTS_HITS_PER_TERM)
        .map(|hit| LibraryAgentSearchResult::Block {
            id: hit.block_id,
            block_type: hit.block_type,
            owner_page_id: hit.owner_page_id,
            source: hit.source,
            quality: if terms.iter().all(|term| {
                exact_or_prefix(&hit.excerpt, term) == LibraryAgentSearchMatchQuality::Exact
            }) {
                LibraryAgentSearchMatchQuality::Exact
            } else {
                LibraryAgentSearchMatchQuality::Prefix
            },
            excerpt: hit.excerpt,
        })
        .collect())
}

fn search_fts(
    connection: &Connection,
    query: &str,
    page_ids: &[String],
    block_types: Option<&[String]>,
    include_archived: bool,
) -> Result<Vec<FtsHit>, StoreError> {
    if page_ids.is_empty() {
        return Ok(Vec::new());
    }
    let Some(match_query) = build_fts_match_query(query)? else {
        return Ok(Vec::new());
    };
    let mut all = Vec::new();
    for page_ids in page_ids.chunks(SQLITE_ID_BATCH) {
        let page_placeholders = placeholders(page_ids.len());
        let mut conditions = vec![
            "block_search_units_fts MATCH ?".to_owned(),
            "unit.owner_block_id IN (".to_owned() + &page_placeholders + ")",
            "unit.document_id IS NOT NULL".to_owned(),
            "unit.source_kind IN ('document_title', 'document_block')".to_owned(),
            "document.readiness = 'ready'".to_owned(),
            "document.generation = unit.document_generation".to_owned(),
            "document.head_seq = unit.projected_seq".to_owned(),
            "source.lifecycle <> 'deleted'".to_owned(),
            "owner.lifecycle <> 'deleted'".to_owned(),
            "owner.type = 'page'".to_owned(),
            "owner_page.lifecycle <> 'deleted'".to_owned(),
        ];
        let mut parameters = vec![SqlValue::Text(match_query.clone())];
        parameters.extend(page_ids.iter().cloned().map(SqlValue::Text));
        if !include_archived {
            conditions.push("owner.lifecycle = 'active'".to_owned());
            conditions.push("owner_page.lifecycle = 'active'".to_owned());
        }
        if let Some(block_types) = block_types {
            conditions.push(format!(
                "source.type IN ({})",
                placeholders(block_types.len())
            ));
            parameters.extend(block_types.iter().cloned().map(SqlValue::Text));
        }
        parameters.push(SqlValue::Integer(MAX_FTS_HITS_PER_TERM as i64));
        let sql = format!(
            "SELECT unit.owner_block_id, unit.block_id, source.type, unit.source_kind, \
               snippet(block_search_units_fts, 0, char(2), char(3), '…', 32), \
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
             WHERE {} ORDER BY rank, unit.owner_block_id, unit.block_id LIMIT ?",
            conditions.join(" AND ")
        );
        let rows = connection
            .prepare(&sql)?
            .query_map(params_from_iter(parameters.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, f64>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (owner_page_id, block_id, block_type, source, excerpt, rank) in rows {
            let source = match source.as_str() {
                "document_title" => LibrarySearchSourceKind::DocumentTitle,
                "document_block" => LibrarySearchSourceKind::DocumentBlock,
                _ => return Err(corrupt("Agent search returned an invalid source")),
            };
            if !rank.is_finite() {
                return Err(corrupt("Agent search returned an invalid rank"));
            }
            all.push(FtsHit {
                owner_page_id,
                block_id,
                block_type,
                source,
                excerpt: normalize_excerpt(&excerpt),
                rank,
            });
        }
    }
    all.sort_by(|left, right| {
        left.rank
            .partial_cmp(&right.rank)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.owner_page_id.cmp(&right.owner_page_id))
            .then_with(|| left.block_id.cmp(&right.block_id))
    });
    Ok(all)
}

fn read_property_values(
    connection: &Connection,
    page_ids: &[String],
) -> Result<HashMap<String, Vec<PropertyValue>>, StoreError> {
    let mut values = HashMap::<String, Vec<PropertyValue>>::new();
    let mut bytes = HashMap::<String, usize>::new();
    for page_ids in page_ids.chunks(SQLITE_ID_BATCH) {
        if page_ids.is_empty() {
            continue;
        }
        let sql = format!(
            "SELECT membership.page_block_id, property.id, property.name, \
               property.value_type, property.config_json, value.value_json \
             FROM data_source_page_memberships membership \
             JOIN data_source_properties property \
               ON property.data_source_id = membership.data_source_id \
               AND property.lifecycle = 'active' \
             JOIN data_source_property_values value ON value.membership_id = membership.id \
               AND value.property_id = property.id \
               AND value.data_source_id = membership.data_source_id \
             WHERE membership.removed_at IS NULL \
               AND membership.page_block_id IN ({}) \
             ORDER BY membership.page_block_id, property.rank_key, property.id",
            placeholders(page_ids.len())
        );
        let rows = connection
            .prepare(&sql)?
            .query_map(params_from_iter(page_ids.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (page_id, property_id, property_name, value_type, config, value) in rows {
            let current = values.entry(page_id.clone()).or_default();
            if current.len() >= MAX_PROPERTY_VALUES_PER_PAGE {
                continue;
            }
            let config = serde_json::from_str::<Value>(&config)
                .map_err(|_| corrupt("Agent search property config is invalid"))?;
            let value = serde_json::from_str::<Value>(&value)
                .map_err(|_| corrupt("Agent search property value is invalid"))?;
            let Some(text) = property_display_value(&value_type, &config, &value) else {
                continue;
            };
            if text.is_empty() {
                continue;
            }
            let next_bytes = bytes.get(&page_id).copied().unwrap_or(0) + text.len();
            if next_bytes > MAX_PROPERTY_TEXT_BYTES_PER_PAGE {
                continue;
            }
            bytes.insert(page_id, next_bytes);
            current.push(PropertyValue {
                property_id,
                property_name,
                text,
            });
        }
    }
    Ok(values)
}

fn property_display_value(value_type: &str, config: &Value, value: &Value) -> Option<String> {
    let truncate = |value: &str| value.chars().take(MAX_PROPERTY_DISPLAY_CHARS).collect();
    let option_names = || {
        config
            .get("options")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|option| {
                Some((
                    option.get("id")?.as_str()?.to_owned(),
                    option.get("name")?.as_str()?.to_owned(),
                ))
            })
            .collect::<HashMap<_, _>>()
    };
    match value_type {
        "select" => value
            .as_str()
            .map(|id| truncate(option_names().get(id).map(String::as_str).unwrap_or(id))),
        "multi_select" => value.as_array().map(|items| {
            let names = option_names();
            truncate(
                &items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|id| names.get(id).map(String::as_str).unwrap_or(id))
                    .collect::<Vec<_>>()
                    .join(" "),
            )
        }),
        "checkbox" => value.as_bool().map(|value| value.to_string()),
        "number" => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|value| {
                if value.fract() == 0.0 {
                    format!("{value:.0}")
                } else {
                    value.to_string()
                }
            }),
        _ => value.as_str().map(truncate),
    }
}

fn metadata_evidence(
    page: &PageCandidate,
    properties: &[PropertyValue],
    term: &str,
) -> Vec<Evidence> {
    let mut evidence = Vec::new();
    if let Some(quality) = field_quality(&page.id, term, false) {
        evidence.push(Evidence {
            term: term.to_owned(),
            kind: EvidenceKind::Identity,
            quality,
            excerpt: page.id.clone(),
        });
    }
    if let Some(quality) = field_quality(&page.title, term, true) {
        evidence.push(Evidence {
            term: term.to_owned(),
            kind: EvidenceKind::Title,
            quality,
            excerpt: page.title.clone(),
        });
    }
    for property in properties {
        let Some(quality) = field_quality(&property.text, term, true) else {
            continue;
        };
        evidence.push(Evidence {
            term: term.to_owned(),
            kind: EvidenceKind::Property {
                property_id: property.property_id.clone(),
                property_name: property.property_name.clone(),
            },
            quality,
            excerpt: property.text.clone(),
        });
    }
    evidence
}

fn field_quality(
    text: &str,
    term: &str,
    allow_fuzzy: bool,
) -> Option<LibraryAgentSearchMatchQuality> {
    let tokens = search_tokens(text);
    if tokens.iter().any(|token| token == term) {
        return Some(LibraryAgentSearchMatchQuality::Exact);
    }
    if term.chars().count() >= 2 && tokens.iter().any(|token| token.starts_with(term)) {
        return Some(LibraryAgentSearchMatchQuality::Prefix);
    }
    if !allow_fuzzy {
        return None;
    }
    let maximum = fuzzy_distance(term);
    (maximum > 0
        && tokens
            .iter()
            .any(|token| levenshtein(token, term) <= maximum))
    .then_some(LibraryAgentSearchMatchQuality::Fuzzy)
}

fn representative_evidence(
    mut evidence: Vec<Evidence>,
    terms: &[String],
) -> Vec<LibraryAgentPageSearchMatch> {
    evidence.sort_by(|left, right| {
        match_tier(left)
            .cmp(&match_tier(right))
            .then_with(|| term_index(terms, &left.term).cmp(&term_index(terms, &right.term)))
            .then_with(|| evidence_key(left).cmp(&evidence_key(right)))
    });
    evidence.dedup_by(|left, right| evidence_key(left) == evidence_key(right));
    let mut selected = Vec::<Evidence>::new();
    for term in terms {
        if let Some(match_index) = evidence.iter().position(|candidate| {
            candidate.term == *term
                && !selected
                    .iter()
                    .any(|item| evidence_key(item) == evidence_key(candidate))
        }) {
            selected.push(evidence[match_index].clone());
        }
        if selected.len() == 3 {
            break;
        }
    }
    for candidate in evidence {
        if selected.len() == 3 {
            break;
        }
        if !selected
            .iter()
            .any(|item| evidence_key(item) == evidence_key(&candidate))
        {
            selected.push(candidate);
        }
    }
    selected.into_iter().map(contract_evidence).collect()
}

fn contract_evidence(evidence: Evidence) -> LibraryAgentPageSearchMatch {
    match evidence.kind {
        EvidenceKind::Identity => LibraryAgentPageSearchMatch::Identity {
            quality: evidence.quality,
            excerpt: evidence.excerpt,
        },
        EvidenceKind::Title => LibraryAgentPageSearchMatch::Title {
            quality: evidence.quality,
            excerpt: evidence.excerpt,
        },
        EvidenceKind::Property {
            property_id,
            property_name,
        } => LibraryAgentPageSearchMatch::Property {
            quality: evidence.quality,
            property_id,
            property_name,
            excerpt: evidence.excerpt,
        },
        EvidenceKind::Body {
            block_id,
            block_type,
        } => LibraryAgentPageSearchMatch::Body {
            quality: evidence.quality,
            block_id,
            block_type,
            excerpt: evidence.excerpt,
        },
    }
}

fn evidence_tier(evidence: &[Evidence]) -> u8 {
    evidence.iter().map(match_tier).min().unwrap_or(u8::MAX)
}

fn match_tier(evidence: &Evidence) -> u8 {
    match &evidence.kind {
        EvidenceKind::Identity => 0,
        EvidenceKind::Title if evidence.quality != LibraryAgentSearchMatchQuality::Fuzzy => 1,
        EvidenceKind::Title => 2,
        EvidenceKind::Property { .. }
            if evidence.quality != LibraryAgentSearchMatchQuality::Fuzzy =>
        {
            3
        }
        EvidenceKind::Body { .. } => 4,
        EvidenceKind::Property { .. } => 5,
    }
}

fn evidence_key(evidence: &Evidence) -> String {
    let source = match &evidence.kind {
        EvidenceKind::Identity => "identity".to_owned(),
        EvidenceKind::Title => "title".to_owned(),
        EvidenceKind::Property { property_id, .. } => format!("property:{property_id}"),
        EvidenceKind::Body { block_id, .. } => format!("body:{block_id}"),
    };
    format!("{}:{source}:{}", evidence.term, evidence.excerpt)
}

fn page_location(page: &PageCandidate) -> Result<LibraryAgentPageLocation, StoreError> {
    match page.parent_kind.as_str() {
        "library" => Ok(LibraryAgentPageLocation::Library {
            library_id: page.parent_id.clone(),
        }),
        "page" => Ok(LibraryAgentPageLocation::Page {
            page_id: page.parent_id.clone(),
        }),
        "data_source" => Ok(LibraryAgentPageLocation::DataSource {
            data_source_id: page.parent_id.clone(),
        }),
        _ => Err(corrupt("Agent search returned an invalid Page location")),
    }
}

fn validate_query(query: &str) -> Result<&str, StoreError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(invalid("Agent search query cannot be empty"));
    }
    if query.len() > MAX_QUERY_BYTES {
        return Err(invalid("Agent search query exceeds its UTF-8 byte bound"));
    }
    Ok(query)
}

fn search_terms(query: &str) -> Result<Vec<String>, StoreError> {
    let mut terms = Vec::new();
    for term in search_tokens(query) {
        if terms.contains(&term) {
            continue;
        }
        terms.push(term);
        if terms.len() > MAX_TERMS {
            return Err(invalid("Agent search query has too many terms"));
        }
    }
    Ok(terms)
}

fn search_tokens(value: &str) -> Vec<String> {
    value
        .trim()
        .to_lowercase()
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect()
}

fn build_fts_match_query(query: &str) -> Result<Option<String>, StoreError> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for character in query.to_lowercase().chars().chain(std::iter::once(' ')) {
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
            if tokens.len() > MAX_TERMS {
                return Err(invalid("Agent search query has too many FTS terms"));
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

fn exact_or_prefix(excerpt: &str, term: &str) -> LibraryAgentSearchMatchQuality {
    if search_tokens(excerpt).iter().any(|token| token == term) {
        LibraryAgentSearchMatchQuality::Exact
    } else {
        LibraryAgentSearchMatchQuality::Prefix
    }
}

fn fuzzy_distance(term: &str) -> usize {
    let length = term.chars().count();
    if length <= 3 {
        return 0;
    }
    let threshold = if length <= 5 { 0.1 } else { 0.2 };
    ((length as f64) * threshold).round() as usize
}

fn levenshtein(left: &str, right: &str) -> usize {
    let right = right.chars().collect::<Vec<_>>();
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    for (left_index, left_character) in left.chars().enumerate() {
        let mut current = vec![left_index + 1];
        for (right_index, right_character) in right.iter().enumerate() {
            current.push(
                (previous[right_index + 1] + 1)
                    .min(current[right_index] + 1)
                    .min(previous[right_index] + usize::from(left_character != *right_character)),
            );
        }
        previous = current;
    }
    previous[right.len()]
}

fn normalize_block_types(
    target: LibraryAgentSearchTarget,
    block_types: Option<Vec<String>>,
) -> Result<Option<Vec<String>>, StoreError> {
    if target == LibraryAgentSearchTarget::Pages && block_types.is_some() {
        return Err(invalid(
            "Agent search Block types require the Blocks target",
        ));
    }
    let Some(block_types) = block_types else {
        return Ok(None);
    };
    if block_types.len() > MAX_FILTERS {
        return Err(invalid("Agent search Block type filter exceeds its bound"));
    }
    let mut unique = HashSet::new();
    for block_type in block_types {
        if block_type.is_empty() || block_type.trim() != block_type || block_type.len() > 256 {
            return Err(invalid("Agent search Block type is invalid"));
        }
        unique.insert(block_type);
    }
    let mut block_types = unique.into_iter().collect::<Vec<_>>();
    block_types.sort();
    Ok(Some(block_types))
}

fn search_subject(
    query: &str,
    target: LibraryAgentSearchTarget,
    scope: &LibraryAgentSearchScope,
    block_types: &Option<Vec<String>>,
    include_archived: bool,
    actor_project_id: &str,
) -> Result<Vec<String>, StoreError> {
    let canonical = serde_json::to_vec(&(
        query,
        target,
        scope,
        block_types,
        include_archived,
        actor_project_id,
    ))
    .map_err(|_| invalid("Agent search query cannot be fingerprinted"))?;
    let fingerprint = Sha256::digest(canonical)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(vec!["agent_search".to_owned(), fingerprint])
}

fn search_cursor_identity(
    connection: &Connection,
    requested_cursor: Option<&str>,
    library_id: &str,
    subject: &[String],
) -> Result<Option<String>, StoreError> {
    let Some(requested_cursor) = requested_cursor else {
        return Ok(None);
    };
    let decoded = cursor::decode(connection, requested_cursor, library_id, subject)?;
    if !decoded.values.is_empty() {
        return Err(invalid("Agent search cursor coordinate is invalid"));
    }
    Ok(Some(decoded.stable_id))
}

fn search_result_id(result: &LibraryAgentSearchResult) -> &str {
    match result {
        LibraryAgentSearchResult::Page { id, .. } | LibraryAgentSearchResult::Block { id, .. } => {
            id
        }
    }
}

fn search_limit(limit: Option<u32>) -> Result<usize, StoreError> {
    let limit = usize::try_from(limit.unwrap_or(DEFAULT_LIMIT as u32))
        .map_err(|_| invalid("Agent search limit is invalid"))?;
    if (1..=MAX_LIMIT).contains(&limit) {
        Ok(limit)
    } else {
        Err(invalid("Agent search limit is out of range"))
    }
}

fn term_index(terms: &[String], term: &str) -> usize {
    terms
        .iter()
        .position(|candidate| candidate == term)
        .unwrap_or(usize::MAX)
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

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn conflict(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::RevisionConflict, message, false)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        EvidenceKind, LibraryAgentSearchMatchQuality, PageCandidate, PropertyValue,
        metadata_evidence, property_display_value,
    };

    #[test]
    fn resolves_select_option_ids_for_searchable_property_display_text() {
        let config = json!({
            "options": [
                { "id": "status:todo", "name": "To do" },
                { "id": "status:progress", "name": "In progress" }
            ]
        });
        assert_eq!(
            property_display_value("select", &config, &json!("status:progress")),
            Some("In progress".to_owned())
        );
        assert_eq!(
            property_display_value(
                "multi_select",
                &config,
                &json!(["status:todo", "status:progress"]),
            ),
            Some("To do In progress".to_owned())
        );
    }

    #[test]
    fn fuzzy_matching_applies_to_human_metadata_but_not_page_identity() {
        let evidence = metadata_evidence(
            &PageCandidate {
                id: "page:integraton".to_owned(),
                title: "Unrelated".to_owned(),
                parent_kind: "library".to_owned(),
                parent_id: "library:test".to_owned(),
            },
            &[PropertyValue {
                property_id: "p_status".to_owned(),
                property_name: "Status".to_owned(),
                text: "Integration".to_owned(),
            }],
            "integraton",
        );
        assert_eq!(evidence.len(), 1);
        assert!(matches!(
            &evidence[0].kind,
            EvidenceKind::Property { property_id, .. } if property_id == "p_status"
        ));
        assert_eq!(evidence[0].quality, LibraryAgentSearchMatchQuality::Fuzzy);
    }
}
