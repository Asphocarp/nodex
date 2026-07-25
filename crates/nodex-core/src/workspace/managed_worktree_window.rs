use nodex_core_contracts::collection::{
    CollectionWindow, CollectionWindowAuthority, CollectionWindowRequest,
};
use nodex_core_contracts::workspace::ProjectWorkspaceManagedWorktreeSummary;
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};

use crate::infrastructure::collection_window::{WindowCandidate, assemble, normalize_request};
use crate::infrastructure::cursor::{
    self, CollectionCursorSubject, CursorDirection, KeysetCoordinate,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub(super) fn read_managed_worktree_window(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    project_id: Option<&str>,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<ProjectWorkspaceManagedWorktreeSummary>, StoreError> {
    if let Some(project_id) = project_id {
        validate_id(project_id)?;
        let project_exists = connection
            .query_row(
                "SELECT 1 FROM projects WHERE id = ?1 AND library_id = ?2",
                params![project_id, library_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !project_exists {
            return Err(not_found("Project is unavailable in this Library"));
        }
    }
    let normalized = normalize_request(request)?;
    let fingerprint =
        cursor::query_fingerprint(&("workspace_managed_worktree_window_v1", project_id))?;
    let subject = CollectionCursorSubject {
        kind: "workspace_managed_worktrees",
        library_id,
        query_fingerprint: &fingerprint,
        projection_revision: event_head,
    };
    let after = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward || !coordinate.values.is_empty() {
                return Err(invalid("Managed worktree cursor is incompatible"));
            }
            Ok(coordinate.stable_id)
        })
        .transpose()?;
    let mut parameters = vec![
        project_id.map_or(SqlValue::Null, |value| SqlValue::Text(value.to_owned())),
        SqlValue::Text(library_id.to_owned()),
    ];
    let cursor_predicate = after
        .map(|stable_id| {
            parameters.push(SqlValue::Text(stable_id));
            "AND thread.managed_worktree_path > ?3"
        })
        .unwrap_or_default();
    parameters.push(SqlValue::Integer(
        i64::try_from(normalized.first + 1)
            .map_err(|_| invalid("Managed worktree window size is invalid"))?,
    ));
    let limit_parameter = parameters.len();
    let sql = format!(
        "SELECT thread.thread_id, thread.project_id, link.session_id,
                session.no_thread_fallback_title, thread.thread_name,
                thread.managed_worktree_path, thread.linked_at
         FROM codex_threads thread
         JOIN projects project ON project.id = thread.project_id
         LEFT JOIN project_session_threads link ON link.thread_id = thread.thread_id
         LEFT JOIN project_sessions session ON session.id = link.session_id
         WHERE (?1 IS NULL OR thread.project_id = ?1)
           AND project.library_id = ?2
           AND thread.managed_worktree_path IS NOT NULL
           AND length(trim(thread.managed_worktree_path)) > 0
           AND NOT EXISTS (
             SELECT 1 FROM codex_threads newer
             WHERE newer.project_id = thread.project_id
               AND newer.managed_worktree_path = thread.managed_worktree_path
               AND (
                 newer.linked_at > thread.linked_at
                 OR (newer.linked_at = thread.linked_at
                   AND newer.thread_id > thread.thread_id)
               )
           )
           {cursor_predicate}
         ORDER BY thread.managed_worktree_path
         LIMIT ?{limit_parameter}"
    );
    let worktrees = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), |row| {
            Ok(ProjectWorkspaceManagedWorktreeSummary {
                thread_id: row.get(0)?,
                project_id: row.get(1)?,
                session_id: row.get(2)?,
                session_title: row.get(3)?,
                thread_name: row.get(4)?,
                path: row.get(5)?,
                linked_at: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    assemble(
        worktrees.into_iter().map(|item| WindowCandidate {
            coordinate: KeysetCoordinate {
                values: Vec::new(),
                stable_id: item.path.clone(),
            },
            item,
        }),
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
    )
}

fn validate_id(value: &str) -> Result<(), StoreError> {
    if !value.trim().is_empty() && value.len() <= 512 {
        return Ok(());
    }
    Err(invalid("project_id is invalid"))
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}
