use nodex_core_contracts::collection::{
    CollectionWindow, CollectionWindowAuthority, CollectionWindowRequest,
};
use nodex_core_contracts::workspace::{
    CodexThreadActiveFlag, CodexThreadStatusType, ProjectWorkspaceSessionSummary,
    ProjectWorkspaceTaskSummary, ProjectWorkspaceTaskThreadSummary, ProjectWorkspaceThreadStatus,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, params, params_from_iter};

use crate::infrastructure::collection_window::{WindowCandidate, assemble, normalize_request};
use crate::infrastructure::cursor::{
    self, CollectionCursorSubject, CursorDirection, KeysetCoordinate, KeysetValue,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const MAX_PREVIEW_UTF16: usize = 240;
const MAX_PREVIEW_BYTES: usize = 1_024;

pub(super) fn read_task_window(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    project_id: Option<&str>,
    include_archived: bool,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<ProjectWorkspaceTaskSummary>, StoreError> {
    read_task_window_in_scope(
        connection,
        library_id,
        event_head,
        project_id,
        false,
        include_archived,
        request,
    )
}

pub(super) fn read_pinned_task_window(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    include_archived: bool,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<ProjectWorkspaceTaskSummary>, StoreError> {
    read_task_window_in_scope(
        connection,
        library_id,
        event_head,
        None,
        true,
        include_archived,
        request,
    )
}

#[allow(clippy::too_many_arguments)]
fn read_task_window_in_scope(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    project_id: Option<&str>,
    pinned_only: bool,
    include_archived: bool,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<ProjectWorkspaceTaskSummary>, StoreError> {
    if !pinned_only && let Some(project_id) = project_id {
        validate_id(project_id, "project_id")?;
        let exists = connection.query_row(
            "SELECT count(*) FROM projects \
             WHERE id = ?1 AND library_id = ?2 AND lifecycle <> 'archived'",
            params![project_id, library_id],
            |row| row.get::<_, i64>(0),
        )?;
        if exists != 1 {
            return Err(not_found("Project task lane is unavailable"));
        }
    }
    let normalized = normalize_request(request)?;
    let fingerprint = cursor::query_fingerprint(&(
        "workspace_task_window_v2",
        project_id,
        pinned_only,
        include_archived,
    ))?;
    let subject = CollectionCursorSubject {
        kind: if pinned_only {
            "workspace_pinned_tasks"
        } else {
            "workspace_tasks"
        },
        library_id,
        query_fingerprint: &fingerprint,
    };
    let coordinate = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward || coordinate.values.len() != 2 {
                return Err(invalid("Workspace task cursor is incompatible"));
            }
            let [
                KeysetValue::Integer { value: pin_bucket },
                KeysetValue::Integer { value: lane_order },
            ] = coordinate.values.as_slice()
            else {
                return Err(invalid("Workspace task cursor coordinate is invalid"));
            };
            Ok((*pin_bucket, *lane_order, coordinate.stable_id))
        })
        .transpose()?;
    let mut parameters = vec![
        project_id.map_or(SqlValue::Null, |value| SqlValue::Text(value.to_owned())),
        SqlValue::Text(library_id.to_owned()),
        SqlValue::Integer(i64::from(include_archived)),
        SqlValue::Integer(i64::from(pinned_only)),
    ];
    let cursor_predicate = coordinate
        .map(|(pin_bucket, lane_order, stable_id)| {
            parameters.extend([
                SqlValue::Integer(pin_bucket),
                SqlValue::Integer(lane_order),
                SqlValue::Text(stable_id),
            ]);
            "WHERE pin_bucket > ?5 \
               OR (pin_bucket = ?5 AND lane_order > ?6) \
               OR (pin_bucket = ?5 AND lane_order = ?6 AND session_id > ?7)"
        })
        .unwrap_or_default();
    parameters.push(SqlValue::Integer(
        i64::try_from(normalized.first + 1)
            .map_err(|_| invalid("Workspace task window size is invalid"))?,
    ));
    let limit_parameter = parameters.len();
    let sql = format!(
        "WITH task_rows AS (\
           SELECT session.id AS session_id, session.project_id, \
             session.no_thread_fallback_title, session.\"order\", session.pinned, \
             session.pinned_order, session.archived, session.archived_at, session.unread, \
             session.database_starter, session.created_at, session.updated_at, \
             thread.thread_id, thread.project_id, thread.forked_from_id, \
             thread.parent_thread_id, thread.thread_name, thread.thread_source, \
             thread.service_name, thread.agent_nickname, thread.agent_role, thread.agent_path, \
             substr(thread.thread_preview, 1, 1024), thread.cwd, thread.status_type, \
             thread.status_active_flags_json, thread.archived, thread.created_at, \
             thread.updated_at, thread.linked_at, \
             CASE WHEN session.pinned = 1 THEN 0 ELSE 1 END AS pin_bucket, \
             CASE WHEN session.pinned = 1 \
               THEN COALESCE(session.pinned_order, 9223372036854775807) \
               WHEN lane.order_mode = 'manual' \
                 THEN COALESCE(position.rank_key, -COALESCE(thread.updated_at, session.\"order\")) \
               ELSE -COALESCE(thread.updated_at, session.\"order\") END AS lane_order \
           FROM project_sessions session \
           LEFT JOIN project_session_threads link ON link.session_id = session.id \
           LEFT JOIN codex_threads thread ON thread.thread_id = link.thread_id \
           LEFT JOIN workspace_sidebar_lanes lane ON lane.scope_key = CASE \
             WHEN session.project_id IS NULL THEN 'projectless' \
             ELSE 'project:' || session.project_id END \
           LEFT JOIN workspace_sidebar_positions position \
             ON position.scope_key = lane.scope_key \
             AND position.thread_id = thread.thread_id \
           WHERE ((?4 = 1 AND session.pinned = 1) OR (?4 = 0 AND \
             ((?1 IS NULL AND session.project_id IS NULL) OR session.project_id = ?1))) \
             AND (session.project_id IS NULL OR EXISTS (\
               SELECT 1 FROM projects project \
               WHERE project.id = session.project_id AND project.library_id = ?2 \
                 AND project.lifecycle <> 'archived'\
             )) \
             AND (?3 = 1 OR session.archived = 0)\
         ) \
         SELECT * FROM task_rows {cursor_predicate} \
         ORDER BY pin_bucket, lane_order, session_id LIMIT ?{limit_parameter}"
    );
    let rows = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), task_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let candidates = rows
        .into_iter()
        .map(|(task, pin_bucket, lane_order)| WindowCandidate {
            coordinate: KeysetCoordinate {
                values: vec![
                    KeysetValue::Integer { value: pin_bucket },
                    KeysetValue::Integer { value: lane_order },
                ],
                stable_id: task.session.id.clone(),
            },
            item: task,
        });
    assemble(
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
    )
}

fn task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(ProjectWorkspaceTaskSummary, i64, i64)> {
    let thread_id = row.get::<_, Option<String>>(12)?;
    let thread = thread_id
        .map(
            |thread_id| -> rusqlite::Result<ProjectWorkspaceTaskThreadSummary> {
                let status_type = match row.get::<_, String>(24)?.as_str() {
                    "notLoaded" => Ok(CodexThreadStatusType::NotLoaded),
                    "idle" => Ok(CodexThreadStatusType::Idle),
                    "systemError" => Ok(CodexThreadStatusType::SystemError),
                    "active" => Ok(CodexThreadStatusType::Active),
                    _ => Err(rusqlite::Error::InvalidQuery),
                }?;
                let active_flags =
                    serde_json::from_str::<Vec<CodexThreadActiveFlag>>(&row.get::<_, String>(25)?)
                        .map_err(|_| rusqlite::Error::InvalidQuery)?;
                Ok(ProjectWorkspaceTaskThreadSummary {
                    thread_id,
                    project_id: row.get(13)?,
                    session_id: row.get(0)?,
                    forked_from_id: row.get(14)?,
                    parent_thread_id: row.get(15)?,
                    thread_name: row.get(16)?,
                    thread_source: row.get(17)?,
                    service_name: row.get(18)?,
                    agent_nickname: row.get(19)?,
                    agent_role: row.get(20)?,
                    agent_path: row.get(21)?,
                    thread_preview: bounded_preview(&row.get::<_, String>(22)?),
                    cwd: row.get(23)?,
                    status: ProjectWorkspaceThreadStatus {
                        status_type,
                        active_flags,
                    },
                    archived: row.get::<_, i64>(26)? == 1,
                    created_at: row.get(27)?,
                    updated_at: row.get(28)?,
                    linked_at: row.get(29)?,
                })
            },
        )
        .transpose()?;
    let fallback_title = row.get::<_, String>(2)?;
    let display_title = thread
        .as_ref()
        .and_then(|thread| {
            [
                thread.thread_name.as_deref(),
                Some(thread.thread_preview.as_str()),
            ]
            .into_iter()
            .flatten()
            .map(str::trim)
            .find(|value| !value.is_empty())
        })
        .unwrap_or_else(|| {
            let value = fallback_title.trim();
            if value.is_empty() {
                "New thread"
            } else {
                value
            }
        })
        .to_owned();
    let task = ProjectWorkspaceTaskSummary {
        session: ProjectWorkspaceSessionSummary {
            id: row.get(0)?,
            project_id: row.get(1)?,
            no_thread_fallback_title: fallback_title,
            display_title,
            order: row.get(3)?,
            pinned: row.get::<_, i64>(4)? == 1,
            pinned_order: row.get(5)?,
            archived: row.get::<_, i64>(6)? == 1,
            archived_at: row.get(7)?,
            unread: row.get::<_, i64>(8)? == 1,
            database_starter: row.get::<_, i64>(9)? == 1,
            thread_id: row.get(12)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        },
        thread,
    };
    Ok((task, row.get(30)?, row.get(31)?))
}

pub(crate) fn bounded_preview(value: &str) -> String {
    let mut utf16 = 0;
    let mut bytes = 0;
    value
        .chars()
        .take_while(|character| {
            let next_utf16 = utf16 + character.len_utf16();
            let next_bytes = bytes + character.len_utf8();
            if next_utf16 > MAX_PREVIEW_UTF16 || next_bytes > MAX_PREVIEW_BYTES {
                return false;
            }
            utf16 = next_utf16;
            bytes = next_bytes;
            true
        })
        .collect()
}

fn validate_id(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.trim() == value && value.len() <= 512 {
        return Ok(());
    }
    Err(invalid(&format!("{label} is invalid")))
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::collection::{
        CollectionWindowRequest, MAX_COLLECTION_WINDOW_JSON_BYTES,
    };
    use nodex_core_contracts::workspace::{ProjectWorkspaceRead, ProjectWorkspaceReadValue};

    use super::*;
    use crate::workspace::test_support::{
        create_project, create_session_thread, read, seeded_workspace,
    };

    fn task_window(
        workspace: &crate::workspace::test_support::TestWorkspace,
        project_id: Option<&str>,
        after: Option<String>,
        first: u32,
    ) -> CollectionWindow<ProjectWorkspaceTaskSummary> {
        let ProjectWorkspaceReadValue::TaskWindow { tasks } = read(
            &workspace.module,
            ProjectWorkspaceRead::TaskWindow {
                project_id: project_id.map(str::to_owned),
                include_archived: Some(false),
                window: CollectionWindowRequest {
                    after,
                    first: Some(first),
                },
            },
        ) else {
            panic!("task window read");
        };
        tasks
    }

    #[test]
    fn task_windows_seek_with_an_opaque_cursor_and_exact_projectless_scope() {
        let workspace = seeded_workspace();
        create_project(&workspace.module, "create-project", "project:a");
        for index in 0..5 {
            create_session_thread(
                &workspace.module,
                &format!("project-{index}"),
                &format!("session:project:{index}"),
                &format!("thread:project:{index}"),
                Some("project:a"),
                index,
            );
            create_session_thread(
                &workspace.module,
                &format!("chat-{index}"),
                &format!("session:chat:{index}"),
                &format!("thread:chat:{index}"),
                None,
                index,
            );
        }

        let first = task_window(&workspace, None, None, 2);
        assert_eq!(first.items.len(), 2);
        assert!(
            first
                .items
                .iter()
                .all(|task| task.session.project_id.is_none())
        );
        let next = task_window(&workspace, None, first.next_cursor.clone(), 2);
        assert_eq!(next.items.len(), 2);
        assert!(first.items.iter().all(|left| {
            next.items
                .iter()
                .all(|right| left.session.id != right.session.id)
        }));
        assert!(
            first
                .next_cursor
                .as_deref()
                .is_some_and(|cursor| cursor.starts_with("nxc1."))
        );

        // A workspace write between windows must not invalidate the cursor.
        create_session_thread(
            &workspace.module,
            "chat-live",
            "session:chat:live",
            "thread:chat:live",
            None,
            9,
        );
        let continued = task_window(&workspace, None, first.next_cursor.clone(), 2);
        assert_eq!(continued.items.len(), 2);
        assert!(first.items.iter().all(|left| {
            continued
                .items
                .iter()
                .all(|right| left.session.id != right.session.id)
        }));
    }

    #[test]
    fn task_summary_preview_and_encoded_window_stay_within_semantic_budgets() {
        let workspace = seeded_workspace();
        create_project(&workspace.module, "create-project", "project:a");
        for index in 0..200 {
            create_session_thread(
                &workspace.module,
                &format!("task-{index}"),
                &format!("session:{index:03}"),
                &format!("thread:{index:03}"),
                Some("project:a"),
                index,
            );
        }
        workspace
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE codex_threads SET thread_preview = ?1",
                    ["🧭".repeat(2_000)],
                )?;
                Ok(())
            })
            .expect("seed oversized legacy previews");

        let window = task_window(&workspace, Some("project:a"), None, 200);
        assert_eq!(window.items.len(), 200);
        let mut linked_count = 0;
        for thread in window.items.iter().filter_map(|task| task.thread.as_ref()) {
            linked_count += 1;
            assert!(
                thread.thread_preview.encode_utf16().count() <= MAX_PREVIEW_UTF16
                    && thread.thread_preview.len() <= MAX_PREVIEW_BYTES,
                "{} has {} UTF-16 units and {} UTF-8 bytes",
                thread.thread_id,
                thread.thread_preview.encode_utf16().count(),
                thread.thread_preview.len(),
            );
        }
        assert!(linked_count >= 199);
        assert!(
            serde_json::to_vec(&window)
                .expect("encode task window")
                .len()
                <= MAX_COLLECTION_WINDOW_JSON_BYTES
        );
    }
}
