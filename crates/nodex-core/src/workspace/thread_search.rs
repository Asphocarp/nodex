use std::collections::{BTreeSet, HashSet};
use std::sync::LazyLock;

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::workspace::{
    ProjectWorkspaceThreadSearchBackfillCandidate, ProjectWorkspaceThreadSearchMatchKind,
    ProjectWorkspaceThreadSearchResult, ProjectWorkspaceThreadSearchRole,
    ProjectWorkspaceThreadSearchSnippetSegment, ProjectWorkspaceThreadSearchUnit,
};
use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::ProjectWorkspaceApplyOutcome;
use super::session_mutation::validate_id;
use super::thread::finish_thread_mutation;

pub(super) const THREAD_SEARCH_INDEX_VERSION: i64 = 2;
const DEFAULT_SEARCH_LIMIT: u32 = 60;
const MAX_SEARCH_LIMIT: u32 = 60;
const DEFAULT_BACKFILL_LIMIT: u32 = 2;
const MAX_BACKFILL_LIMIT: u32 = 60;
const MAX_SEARCH_UNITS: usize = 10_000;
const MAX_SEARCH_UNIT_TEXT_BYTES: usize = 256 * 1024;
const MAX_SEARCH_TEXT_BYTES: usize = 8 * 1024 * 1024;
const FTS_CANDIDATE_MULTIPLIER: u32 = 8;
const FTS_SNIPPET_TOKENS: i64 = 32;
const FAILED_RETRY_MS: i64 = 5 * 60 * 1_000;
const HIGHLIGHT_START: &str = "\u{1}";
const HIGHLIGHT_END: &str = "\u{2}";

static FTS_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{L}\p{N}_]+").expect("valid FTS token regex"));

struct SearchAuthority {
    project_id: Option<String>,
    session_id: Option<String>,
    updated_at: i64,
    archived: bool,
    parent_thread_id: Option<String>,
}

struct SearchRow {
    thread_id: String,
    snippet: String,
    rank: f64,
}

pub(super) fn search(
    connection: &Connection,
    library_id: &str,
    query: &str,
    limit: Option<u32>,
) -> Result<Vec<ProjectWorkspaceThreadSearchResult>, StoreError> {
    let query = query.trim();
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let limit = limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT);
    let Some(match_query) = build_match_query(query) else {
        return Ok(Vec::new());
    };
    let candidate_limit = i64::from(limit.saturating_mul(FTS_CANDIDATE_MULTIPLIER));
    let rows = connection
        .prepare(
            "SELECT unit.thread_id,
               snippet(thread_search_units_fts, 0, ?1, ?2, '…', ?3),
               bm25(thread_search_units_fts)
             FROM thread_search_units_fts
             JOIN thread_search_units unit ON unit.rowid = thread_search_units_fts.rowid
             JOIN codex_threads thread ON thread.thread_id = unit.thread_id
             LEFT JOIN projects project ON project.id = thread.project_id
             WHERE thread_search_units_fts MATCH ?4
               AND thread.archived = 0
               AND thread.parent_thread_id IS NULL
               AND (thread.project_id IS NULL OR project.library_id = ?5)
               AND NOT EXISTS (
                 SELECT 1 FROM project_session_threads link
                 JOIN project_sessions session ON session.id = link.session_id
                 WHERE link.thread_id = thread.thread_id AND session.archived = 1
               )
             ORDER BY bm25(thread_search_units_fts), unit.thread_id, unit.rowid
             LIMIT ?6",
        )?
        .query_map(
            params![
                HIGHLIGHT_START,
                HIGHLIGHT_END,
                FTS_SNIPPET_TOKENS,
                match_query,
                library_id,
                candidate_limit,
            ],
            |row| {
                Ok(SearchRow {
                    thread_id: row.get(0)?,
                    snippet: row.get(1)?,
                    rank: row.get(2)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut rows = rows;
    rows.sort_by(|left, right| {
        left.rank
            .total_cmp(&right.rank)
            .then_with(|| left.thread_id.cmp(&right.thread_id))
    });
    let mut seen = HashSet::new();
    let mut results = Vec::with_capacity(limit as usize);
    for row in rows {
        if !seen.insert(row.thread_id.clone()) {
            continue;
        }
        let marked = normalize_snippet(&row.snippet);
        if marked.is_empty() {
            continue;
        }
        let score = 2_000_000_i64
            - i64::try_from(results.len()).expect("bounded Thread search result count");
        results.push(ProjectWorkspaceThreadSearchResult {
            thread_id: row.thread_id,
            snippet: marked
                .replace(HIGHLIGHT_START, "")
                .replace(HIGHLIGHT_END, ""),
            score,
            match_kind: ProjectWorkspaceThreadSearchMatchKind::Fts,
            snippet_segments: parse_snippet_segments(&marked),
        });
        if results.len() >= limit as usize {
            break;
        }
    }
    Ok(results)
}

pub(super) fn backfill_candidates(
    connection: &Connection,
    library_id: &str,
    limit: Option<u32>,
    force: bool,
) -> Result<Vec<ProjectWorkspaceThreadSearchBackfillCandidate>, StoreError> {
    let now_ms = current_time_millis(connection)?;
    let limit = limit
        .unwrap_or(DEFAULT_BACKFILL_LIMIT)
        .clamp(1, MAX_BACKFILL_LIMIT);
    let rows = connection
        .prepare(
            "SELECT thread.thread_id, thread.updated_at, pinned.pinned_order
             FROM codex_threads thread
             LEFT JOIN projects project ON project.id = thread.project_id
             LEFT JOIN codex_pinned_threads pinned ON pinned.thread_id = thread.thread_id
             LEFT JOIN thread_search_thread_state state ON state.thread_id = thread.thread_id
             WHERE thread.archived = 0
               AND thread.parent_thread_id IS NULL
               AND (thread.project_id IS NULL OR project.library_id = ?1)
               AND NOT EXISTS (
                 SELECT 1 FROM project_session_threads link
                 JOIN project_sessions session ON session.id = link.session_id
                 WHERE link.thread_id = thread.thread_id AND session.archived = 1
               )
               AND (?2 = 1 OR (
                 (state.thread_id IS NULL
                   OR state.status <> 'ready'
                   OR state.source_updated_at <> thread.updated_at
                   OR state.index_version <> ?3)
                 AND (state.status IS NULL OR state.status <> 'failed'
                   OR state.retry_after IS NULL OR state.retry_after <= ?4)
               ))
             ORDER BY CASE WHEN pinned.thread_id IS NULL THEN 1 ELSE 0 END,
               pinned.pinned_order, thread.updated_at DESC, thread.thread_id
             LIMIT ?5",
        )?
        .query_map(
            params![
                library_id,
                i64::from(force),
                THREAD_SEARCH_INDEX_VERSION,
                now_ms,
                i64::from(limit),
            ],
            |row| {
                Ok(ProjectWorkspaceThreadSearchBackfillCandidate {
                    thread_id: row.get(0)?,
                    source_updated_at: row.get(1)?,
                    pinned_order: row.get(2)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn replace_projection(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    thread_id: &str,
    expected_thread_updated_at: i64,
    units: &[ProjectWorkspaceThreadSearchUnit],
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let authority = require_search_authority(connection, library_id, thread_id)?;
    require_projection_head(&authority, expected_thread_updated_at)?;
    let units = validate_units(thread_id, units)?;
    let now_ms = current_time_millis(connection)?;

    let current_keys = connection
        .prepare("SELECT unit_key FROM thread_search_units WHERE thread_id = ?1")?
        .query_map([thread_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    let next_keys = units
        .iter()
        .map(|unit| unit.key.clone())
        .collect::<HashSet<_>>();
    let mut delete = connection.prepare("DELETE FROM thread_search_units WHERE unit_key = ?1")?;
    for key in current_keys.difference(&next_keys) {
        delete.execute([key])?;
    }

    let mut upsert = connection.prepare(
        "INSERT INTO thread_search_units(
           unit_key, thread_id, project_id, session_id, turn_id, item_id, role, text,
           text_hash, source_updated_at, indexed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(unit_key) DO UPDATE SET
           project_id = excluded.project_id, session_id = excluded.session_id,
           turn_id = excluded.turn_id, item_id = excluded.item_id, role = excluded.role,
           text = excluded.text, text_hash = excluded.text_hash,
           source_updated_at = excluded.source_updated_at, indexed_at = excluded.indexed_at
         WHERE thread_search_units.project_id IS NOT excluded.project_id
           OR thread_search_units.session_id IS NOT excluded.session_id
           OR thread_search_units.turn_id IS NOT excluded.turn_id
           OR thread_search_units.item_id IS NOT excluded.item_id
           OR thread_search_units.role IS NOT excluded.role
           OR thread_search_units.text_hash IS NOT excluded.text_hash
           OR thread_search_units.source_updated_at IS NOT excluded.source_updated_at",
    )?;
    for unit in &units {
        upsert.execute(params![
            unit.key,
            thread_id,
            authority.project_id,
            authority.session_id,
            unit.turn_id,
            unit.item_id,
            unit.role,
            unit.text,
            unit.text_hash,
            expected_thread_updated_at,
            now_ms,
        ])?;
    }
    connection.execute(
        "INSERT INTO thread_search_thread_state(
           thread_id, source_updated_at, indexed_at, index_version, unit_count, status,
           last_error, failed_at, retry_after
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'ready', NULL, NULL, NULL)
         ON CONFLICT(thread_id) DO UPDATE SET
           source_updated_at = excluded.source_updated_at, indexed_at = excluded.indexed_at,
           index_version = excluded.index_version, unit_count = excluded.unit_count,
           status = excluded.status, last_error = NULL, failed_at = NULL, retry_after = NULL",
        params![
            thread_id,
            expected_thread_updated_at,
            now_ms,
            THREAD_SEARCH_INDEX_VERSION,
            i64::try_from(units.len()).expect("bounded Thread search unit count"),
        ],
    )?;
    finish_search_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "replace_thread_search_projection",
        authority,
        thread_id,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn fail_projection(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    thread_id: &str,
    expected_thread_updated_at: i64,
    error: &str,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let authority = require_search_authority(connection, library_id, thread_id)?;
    require_projection_head(&authority, expected_thread_updated_at)?;
    let error = error.trim();
    if error.is_empty() {
        return Err(invalid(
            "Thread search projection failure requires an error",
        ));
    }
    let error = error.chars().take(500).collect::<String>();
    let now_ms = current_time_millis(connection)?;
    let retry_after = now_ms
        .checked_add(FAILED_RETRY_MS)
        .ok_or_else(|| invalid("Thread search retry timestamp overflowed"))?;
    connection.execute(
        "INSERT INTO thread_search_thread_state(
           thread_id, source_updated_at, indexed_at, index_version, unit_count, status,
           last_error, failed_at, retry_after
         ) VALUES (?1, ?2, ?3, ?4, 0, 'failed', ?5, ?3, ?6)
         ON CONFLICT(thread_id) DO UPDATE SET
           source_updated_at = excluded.source_updated_at, indexed_at = excluded.indexed_at,
           index_version = excluded.index_version, unit_count = 0, status = 'failed',
           last_error = excluded.last_error, failed_at = excluded.failed_at,
           retry_after = excluded.retry_after",
        params![
            thread_id,
            expected_thread_updated_at,
            now_ms,
            THREAD_SEARCH_INDEX_VERSION,
            error,
            retry_after,
        ],
    )?;
    finish_search_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "fail_thread_search_projection",
        authority,
        thread_id,
    )
}

struct ValidatedUnit {
    key: String,
    turn_id: String,
    item_id: String,
    role: &'static str,
    text: String,
    text_hash: String,
}

fn validate_units(
    thread_id: &str,
    units: &[ProjectWorkspaceThreadSearchUnit],
) -> Result<Vec<ValidatedUnit>, StoreError> {
    if units.len() > MAX_SEARCH_UNITS {
        return Err(invalid("Thread search projection exceeds its unit bound"));
    }
    let mut total_bytes = 0_usize;
    let mut keys = HashSet::new();
    units
        .iter()
        .map(|unit| {
            validate_id("turn_id", &unit.turn_id)?;
            validate_id("item_id", &unit.item_id)?;
            if unit.text.is_empty() || unit.text.trim() != unit.text {
                return Err(invalid(
                    "Thread search unit text must be non-empty and trimmed",
                ));
            }
            if unit.text.len() > MAX_SEARCH_UNIT_TEXT_BYTES {
                return Err(invalid("Thread search unit text exceeds its Core bound"));
            }
            total_bytes = total_bytes
                .checked_add(unit.text.len())
                .ok_or_else(|| invalid("Thread search projection size overflowed"))?;
            if total_bytes > MAX_SEARCH_TEXT_BYTES {
                return Err(invalid("Thread search projection exceeds its byte bound"));
            }
            let role = match unit.role {
                ProjectWorkspaceThreadSearchRole::User => "user",
                ProjectWorkspaceThreadSearchRole::Assistant => "assistant",
            };
            let key = format!("{thread_id}:{}:{}:{role}", unit.turn_id, unit.item_id);
            if !keys.insert(key.clone()) {
                return Err(invalid("Thread search projection contains duplicate units"));
            }
            let text_hash = format!("{:x}", Sha256::digest(unit.text.as_bytes()));
            Ok(ValidatedUnit {
                key,
                turn_id: unit.turn_id.clone(),
                item_id: unit.item_id.clone(),
                role,
                text: unit.text.clone(),
                text_hash,
            })
        })
        .collect()
}

fn require_search_authority(
    connection: &Connection,
    library_id: &str,
    thread_id: &str,
) -> Result<SearchAuthority, StoreError> {
    validate_id("thread_id", thread_id)?;
    let row = connection
        .query_row(
            "SELECT thread.project_id, link.session_id, thread.updated_at, thread.archived,
               thread.parent_thread_id, project.library_id
             FROM codex_threads thread
             LEFT JOIN projects project ON project.id = thread.project_id
             LEFT JOIN project_session_threads link ON link.thread_id = thread.thread_id
             WHERE thread.thread_id = ?1",
            [thread_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Codex Thread is unavailable"))?;
    if row.0.is_some() && row.5.as_deref() != Some(library_id) {
        return Err(not_found("Codex Thread is unavailable in this Library"));
    }
    Ok(SearchAuthority {
        project_id: row.0,
        session_id: row.1,
        updated_at: row.2,
        archived: row.3 == 1,
        parent_thread_id: row.4,
    })
}

fn require_projection_head(
    authority: &SearchAuthority,
    expected_thread_updated_at: i64,
) -> Result<(), StoreError> {
    if expected_thread_updated_at < 0 {
        return Err(invalid("expected_thread_updated_at cannot be negative"));
    }
    if authority.archived || authority.parent_thread_id.is_some() {
        return Err(conflict(
            "Thread is no longer eligible for the sidebar search projection",
        ));
    }
    if authority.updated_at != expected_thread_updated_at {
        return Err(conflict(
            "Thread changed while its search projection was built",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn finish_search_mutation(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    operation_kind: &'static str,
    authority: SearchAuthority,
    thread_id: &str,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    finish_thread_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        operation_kind,
        authority
            .project_id
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        authority.session_id.into_iter().collect(),
        vec![thread_id.to_owned()],
    )
}

fn build_match_query(query: &str) -> Option<String> {
    let mut seen = HashSet::new();
    let tokens = query
        .split_whitespace()
        .flat_map(|part| FTS_TOKEN.find_iter(part).map(|token| token.as_str()))
        .map(str::to_lowercase)
        .filter(|token| !token.is_empty() && seen.insert(token.clone()))
        .map(|token| format!("{token}*"))
        .collect::<Vec<_>>();
    (!tokens.is_empty()).then(|| tokens.join(" "))
}

fn normalize_snippet(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_snippet_segments(marked: &str) -> Vec<ProjectWorkspaceThreadSearchSnippetSegment> {
    let mut segments = Vec::new();
    let mut remaining = marked;
    let mut highlighted = false;
    while !remaining.is_empty() {
        let start = remaining.find(HIGHLIGHT_START);
        let end = remaining.find(HIGHLIGHT_END);
        let next = [start, end].into_iter().flatten().min();
        let Some(next) = next else {
            segments.push(ProjectWorkspaceThreadSearchSnippetSegment {
                text: remaining.to_owned(),
                highlight: highlighted,
            });
            break;
        };
        if next > 0 {
            segments.push(ProjectWorkspaceThreadSearchSnippetSegment {
                text: remaining[..next].to_owned(),
                highlight: highlighted,
            });
        }
        if start == Some(next) {
            highlighted = true;
            remaining = &remaining[next + HIGHLIGHT_START.len()..];
        } else {
            highlighted = false;
            remaining = &remaining[next + HIGHLIGHT_END.len()..];
        }
    }
    if segments.is_empty() {
        segments.push(ProjectWorkspaceThreadSearchSnippetSegment {
            text: marked.to_owned(),
            highlight: false,
        });
    }
    segments
}

fn current_time_millis(connection: &Connection) -> Result<i64, StoreError> {
    connection
        .query_row(
            "SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)",
            [],
            |row| row.get(0),
        )
        .map_err(StoreError::from)
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn conflict(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::RevisionConflict, message, true)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::CoreErrorCode;
    use nodex_core_contracts::workspace::{
        ProjectWorkspaceIntent, ProjectWorkspaceRead, ProjectWorkspaceReadValue,
        ProjectWorkspaceThreadPatch, ProjectWorkspaceThreadSearchRole,
        ProjectWorkspaceThreadSearchUnit,
    };

    use super::super::test_support::{
        apply, context, create_session_thread, read, request, seeded_workspace,
    };

    fn unit(text: &str) -> ProjectWorkspaceThreadSearchUnit {
        ProjectWorkspaceThreadSearchUnit {
            turn_id: "turn:1".to_owned(),
            item_id: "item:1".to_owned(),
            role: ProjectWorkspaceThreadSearchRole::User,
            text: text.to_owned(),
        }
    }

    #[test]
    fn owns_stale_work_selection_exact_projection_and_bounded_fts_results() {
        let workspace = seeded_workspace();
        create_session_thread(
            &workspace.module,
            "search-old",
            "session:search-old",
            "thread:search-old",
            None,
            100,
        );
        create_session_thread(
            &workspace.module,
            "search-recent",
            "session:search-recent",
            "thread:search-recent",
            Some("project:default"),
            300,
        );
        create_session_thread(
            &workspace.module,
            "search-pinned",
            "session:search-pinned",
            "thread:search-pinned",
            Some("project:default"),
            200,
        );
        apply(
            &workspace.module,
            "pin-search-thread",
            ProjectWorkspaceIntent::SetThreadPinned {
                thread_id: "thread:search-pinned".to_owned(),
                pinned: true,
                placement: None,
            },
        );

        let ProjectWorkspaceReadValue::ThreadSearchBackfillCandidates { candidates } = read(
            &workspace.module,
            ProjectWorkspaceRead::ThreadSearchBackfillCandidates {
                limit: Some(2),
                force: None,
            },
        ) else {
            panic!("Thread search work");
        };
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.thread_id.as_str())
                .collect::<Vec<_>>(),
            ["thread:search-pinned", "thread:search-recent"]
        );

        let projection = request(
            "replace-search-projection",
            ProjectWorkspaceIntent::ReplaceThreadSearchProjection {
                thread_id: "thread:search-pinned".to_owned(),
                expected_thread_updated_at: 200,
                units: vec![unit("needle phrase in the visible transcript")],
            },
        );
        let committed = workspace
            .module
            .apply(&context(), projection.clone())
            .expect("replace search projection");
        let replay = workspace
            .module
            .apply(&context(), projection)
            .expect("replay search projection");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            replay.committed.event_sequence,
            committed.committed.event_sequence
        );

        let ProjectWorkspaceReadValue::ThreadSearch { results } = read(
            &workspace.module,
            ProjectWorkspaceRead::ThreadSearch {
                query: "needle ph".to_owned(),
                limit: Some(10),
            },
        ) else {
            panic!("Thread search results");
        };
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].thread_id, "thread:search-pinned");
        assert_eq!(results[0].score, 2_000_000);
        assert!(!results[0].snippet.contains('\u{1}'));
        assert!(
            results[0]
                .snippet_segments
                .iter()
                .any(|segment| segment.highlight)
        );

        let ProjectWorkspaceReadValue::ThreadSearchBackfillCandidates { candidates } = read(
            &workspace.module,
            ProjectWorkspaceRead::ThreadSearchBackfillCandidates {
                limit: Some(3),
                force: None,
            },
        ) else {
            panic!("remaining Thread search work");
        };
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.thread_id.as_str())
                .collect::<Vec<_>>(),
            ["thread:search-recent", "thread:search-old"]
        );
    }

    #[test]
    fn fences_stale_search_projection_and_defers_failed_work_until_retry() {
        let workspace = seeded_workspace();
        create_session_thread(
            &workspace.module,
            "search-stale",
            "session:search-stale",
            "thread:search-stale",
            Some("project:default"),
            100,
        );
        apply(
            &workspace.module,
            "advance-search-thread",
            ProjectWorkspaceIntent::UpsertThread {
                thread_id: "thread:search-stale".to_owned(),
                patch: Box::new(ProjectWorkspaceThreadPatch {
                    updated_at: Some(200),
                    ..ProjectWorkspaceThreadPatch::default()
                }),
            },
        );
        let stale = workspace
            .module
            .apply(
                &context(),
                request(
                    "stale-search-projection",
                    ProjectWorkspaceIntent::ReplaceThreadSearchProjection {
                        thread_id: "thread:search-stale".to_owned(),
                        expected_thread_updated_at: 100,
                        units: vec![unit("stale transcript")],
                    },
                ),
            )
            .expect_err("stale search projection must fail");
        assert_eq!(stale.code, CoreErrorCode::RevisionConflict);

        apply(
            &workspace.module,
            "fail-search-projection",
            ProjectWorkspaceIntent::FailThreadSearchProjection {
                thread_id: "thread:search-stale".to_owned(),
                expected_thread_updated_at: 200,
                error: "Session transcript is not materialized".to_owned(),
            },
        );
        let ProjectWorkspaceReadValue::ThreadSearchBackfillCandidates { candidates } = read(
            &workspace.module,
            ProjectWorkspaceRead::ThreadSearchBackfillCandidates {
                limit: Some(10),
                force: None,
            },
        ) else {
            panic!("deferred search work");
        };
        assert!(candidates.is_empty());

        let ProjectWorkspaceReadValue::ThreadSearchBackfillCandidates { candidates } = read(
            &workspace.module,
            ProjectWorkspaceRead::ThreadSearchBackfillCandidates {
                limit: Some(10),
                force: Some(true),
            },
        ) else {
            panic!("retryable search work");
        };
        assert_eq!(candidates[0].thread_id, "thread:search-stale");
    }
}
