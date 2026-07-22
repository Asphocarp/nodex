use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashSet};

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::workspace::{
    ProjectWorkspaceSidebar, ProjectWorkspaceThread, ProjectWorkspaceThreadMoveMetadataPatch,
    ProjectWorkspaceThreadPlacement,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::ProjectWorkspaceApplyOutcome;
use super::session_lifecycle::{rewrite_portable_tab_ownership, session_has_project_scoped_tabs};
use super::session_mutation::{sqlite_now, validate_id};
use super::thread::{finish_thread_mutation, read_threads};

const MAX_THREAD_ORDER_SIZE: usize = 100_000;
const MAX_PATH_BYTES: usize = 16 * 1024;

#[derive(Clone)]
struct ThreadOwner {
    project_id: Option<String>,
    session_id: String,
    session_project_id: Option<String>,
    session_pinned: bool,
}

pub(super) fn read_sidebar(
    connection: &Connection,
    library_id: &str,
    include_archived: bool,
) -> Result<ProjectWorkspaceSidebar, StoreError> {
    let mut threads = read_threads(connection, library_id, None, None, include_archived)?;
    if !include_archived {
        let archived_session_threads = connection
            .prepare(
                "SELECT link.thread_id
                 FROM project_session_threads link
                 JOIN project_sessions session ON session.id = link.session_id
                 WHERE session.archived = 1",
            )?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<HashSet<_>>>()?;
        threads.retain(|thread| !archived_session_threads.contains(&thread.thread_id));
    }
    threads.sort_by(compare_sidebar_threads);
    Ok(ProjectWorkspaceSidebar {
        threads,
        project_thread_orders: read_project_thread_orders(connection, library_id)?,
        projectless_thread_order: read_projectless_thread_order(connection)?,
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn set_project_thread_order(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_id: &str,
    ordered_thread_ids: Option<&[String]>,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("project_id", project_id)?;
    require_project(connection, library_id, project_id)?;
    if ordered_thread_ids.is_none() {
        connection.execute(
            "DELETE FROM codex_project_thread_orders WHERE project_id = ?1",
            [project_id],
        )?;
        return finish_thread_mutation(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            "set_project_thread_order",
            Vec::new(),
            vec![project_id.to_owned()],
            Vec::new(),
            Vec::new(),
        );
    }

    let requested = validate_thread_order(
        ordered_thread_ids.expect("checked Project Thread order"),
        "ordered_thread_ids",
    )?;
    let current = list_project_thread_ids(connection, project_id)?;
    let current_set = current.iter().map(String::as_str).collect::<HashSet<_>>();
    for thread_id in &requested {
        if current_set.contains(thread_id.as_str()) {
            continue;
        }
        return Err(invalid(format!(
            "Thread {thread_id} is not in Project {project_id}"
        )));
    }

    let existing = read_project_thread_orders(connection, library_id)?
        .remove(project_id)
        .unwrap_or_else(|| current.clone());
    let complete = append_untracked(existing, &current);
    let next = project_requested_order(&complete, &requested);
    write_project_thread_order(connection, project_id, &next, &sqlite_now(connection)?)?;
    finish_thread_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "set_project_thread_order",
        Vec::new(),
        vec![project_id.to_owned()],
        Vec::new(),
        next,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn set_projectless_thread_order(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    thread_ids_in_display_order: &[String],
    visible_thread_ids: &[String],
    next_visible_thread_ids: &[String],
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let task_ids =
        validate_thread_order(thread_ids_in_display_order, "thread_ids_in_display_order")?;
    let visible_ids = validate_thread_order(visible_thread_ids, "visible_thread_ids")?;
    let next_visible_ids =
        validate_thread_order(next_visible_thread_ids, "next_visible_thread_ids")?;
    if visible_ids.len() != next_visible_ids.len()
        || visible_ids.iter().collect::<BTreeSet<_>>()
            != next_visible_ids.iter().collect::<BTreeSet<_>>()
    {
        return Err(invalid(
            "Current and next visible Projectless Thread orders must contain the same Threads",
        ));
    }
    require_current_projectless_unpinned_threads(connection, library_id, &task_ids)?;

    let task_set = task_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    let stored = read_projectless_thread_order(connection)?.unwrap_or_else(|| task_ids.clone());
    let retained = stored
        .into_iter()
        .filter(|thread_id| task_set.contains(thread_id.as_str()))
        .collect::<Vec<_>>();
    let complete = append_untracked(retained, &task_ids);
    let visible_set = visible_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut replacements = next_visible_ids.iter();
    let next = complete
        .into_iter()
        .map(|thread_id| {
            if !visible_set.contains(thread_id.as_str()) {
                return thread_id;
            }
            replacements.next().cloned().unwrap_or(thread_id)
        })
        .collect::<Vec<_>>();
    let now = sqlite_now(connection)?;
    connection.execute(
        "INSERT INTO codex_sidebar_chat_order(
           singleton, ordered_thread_ids_json, updated_at
         ) VALUES (1, ?1, ?2)
         ON CONFLICT(singleton) DO UPDATE SET
           ordered_thread_ids_json = excluded.ordered_thread_ids_json,
           updated_at = excluded.updated_at",
        params![encode_thread_order(&next)?, now],
    )?;
    finish_thread_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "set_projectless_thread_order",
        Vec::new(),
        Vec::new(),
        Vec::new(),
        next,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn move_thread(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    thread_id: &str,
    source_project_id: Option<&str>,
    target_project_id: Option<&str>,
    placement: &ProjectWorkspaceThreadPlacement,
    metadata: &ProjectWorkspaceThreadMoveMetadataPatch,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("thread_id", thread_id)?;
    if let Some(project_id) = source_project_id {
        validate_id("source_project_id", project_id)?;
    }
    if let Some(project_id) = target_project_id {
        validate_id("target_project_id", project_id)?;
        require_project(connection, library_id, project_id)?;
    }
    if let ProjectWorkspaceThreadPlacement::Before { thread_id } = placement {
        validate_id("placement.thread_id", thread_id)?;
    }
    validate_move_metadata(metadata)?;

    let owner = require_thread_owner(connection, library_id, thread_id)?;
    if owner.project_id.as_deref() != source_project_id
        || owner.session_project_id.as_deref() != source_project_id
    {
        return Err(conflict(format!(
            "Thread {thread_id} is no longer in the expected Project"
        )));
    }

    if source_project_id != target_project_id {
        move_thread_membership(
            connection,
            thread_id,
            source_project_id,
            target_project_id,
            &owner,
            metadata,
        )?;
    }
    rewrite_project_thread_orders(
        connection,
        library_id,
        thread_id,
        target_project_id,
        placement,
    )?;

    let project_ids = [source_project_id, target_project_id]
        .into_iter()
        .flatten()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut session_summary_scopes =
        vec![super::mutation::project_session_scope(source_project_id)];
    let target_scope = super::mutation::project_session_scope(target_project_id);
    if !session_summary_scopes.contains(&target_scope) {
        session_summary_scopes.push(target_scope);
    }
    finish_thread_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "move_thread",
        session_summary_scopes,
        project_ids,
        vec![owner.session_id],
        vec![thread_id.to_owned()],
    )
}

fn compare_sidebar_threads(
    left: &ProjectWorkspaceThread,
    right: &ProjectWorkspaceThread,
) -> Ordering {
    match (left.pinned_order, right.pinned_order) {
        (Some(left_order), Some(right_order)) => left_order
            .cmp(&right_order)
            .then_with(|| left.thread_id.cmp(&right.thread_id)),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.thread_id.cmp(&right.thread_id)),
    }
}

fn read_project_thread_orders(
    connection: &Connection,
    library_id: &str,
) -> Result<BTreeMap<String, Vec<String>>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT ordering.project_id, ordering.ordered_thread_ids_json
             FROM codex_project_thread_orders ordering
             JOIN projects project ON project.id = ordering.project_id
             WHERE project.library_id = ?1
             ORDER BY ordering.project_id",
        )?
        .query_map([library_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(project_id, raw)| decode_thread_order(&raw).map(|order| (project_id, order)))
        .collect())
}

fn read_projectless_thread_order(
    connection: &Connection,
) -> Result<Option<Vec<String>>, StoreError> {
    let raw = connection
        .query_row(
            "SELECT ordered_thread_ids_json FROM codex_sidebar_chat_order WHERE singleton = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    raw.map(|value| {
        decode_thread_order(&value).ok_or_else(|| corrupt("Projectless Thread order is invalid"))
    })
    .transpose()
}

fn decode_thread_order(raw: &str) -> Option<Vec<String>> {
    let values = serde_json::from_str::<Vec<String>>(raw).ok()?;
    if values.len() > MAX_THREAD_ORDER_SIZE {
        return None;
    }
    let mut seen = HashSet::new();
    if values.iter().any(|value| {
        value.is_empty()
            || value.trim() != value
            || value.len() > 512
            || !seen.insert(value.as_str())
    }) {
        return None;
    }
    Some(values)
}

fn encode_thread_order(values: &[String]) -> Result<String, StoreError> {
    serde_json::to_string(values).map_err(|_| corrupt("Could not encode Thread order"))
}

fn validate_thread_order(values: &[String], name: &str) -> Result<Vec<String>, StoreError> {
    if values.len() > MAX_THREAD_ORDER_SIZE {
        return Err(invalid(format!("{name} exceeds its Core bound")));
    }
    let mut seen = HashSet::new();
    for value in values {
        validate_id(name, value)?;
        if !seen.insert(value.as_str()) {
            return Err(invalid(format!("{name} contains duplicate Thread {value}")));
        }
    }
    Ok(values.to_vec())
}

fn require_current_projectless_unpinned_threads(
    connection: &Connection,
    library_id: &str,
    thread_ids: &[String],
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(
        "SELECT thread.project_id, thread.archived, pinned.thread_id IS NOT NULL,
           project.library_id
         FROM codex_threads thread
         LEFT JOIN codex_pinned_threads pinned ON pinned.thread_id = thread.thread_id
         LEFT JOIN projects project ON project.id = thread.project_id
         WHERE thread.thread_id = ?1",
    )?;
    for thread_id in thread_ids {
        let row = statement
            .query_row([thread_id], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .optional()?;
        let Some((project_id, archived, pinned, project_library_id)) = row else {
            return Err(invalid(format!("Thread {thread_id} is not reorderable")));
        };
        if project_id.is_none()
            && archived == 0
            && pinned == 0
            && project_library_id
                .as_deref()
                .is_none_or(|id| id == library_id)
        {
            continue;
        }
        return Err(invalid(format!(
            "Thread {thread_id} is not a current unpinned Projectless Thread"
        )));
    }
    Ok(())
}

fn require_project(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
) -> Result<(), StoreError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |_| Ok(()),
        )
        .optional()?;
    exists.ok_or_else(|| not_found("Target Project is unavailable in this Library"))
}

fn list_project_thread_ids(
    connection: &Connection,
    project_id: &str,
) -> Result<Vec<String>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT thread.thread_id, thread.project_id
             FROM project_sessions session
             JOIN project_session_threads link ON link.session_id = session.id
             JOIN codex_threads thread ON thread.thread_id = link.thread_id
             WHERE session.project_id = ?1
             ORDER BY thread.updated_at DESC, thread.created_at DESC, thread.thread_id",
        )?
        .query_map([project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|(thread_id, owner)| {
            if owner.as_deref() == Some(project_id) {
                return Ok(thread_id);
            }
            Err(conflict(format!(
                "Project {project_id} has inconsistent Thread ownership"
            )))
        })
        .collect()
}

fn append_untracked(mut tracked: Vec<String>, current: &[String]) -> Vec<String> {
    let mut seen = tracked.iter().cloned().collect::<HashSet<_>>();
    tracked.extend(
        current
            .iter()
            .filter(|thread_id| seen.insert((*thread_id).clone()))
            .cloned(),
    );
    tracked
}

fn project_requested_order(complete: &[String], requested: &[String]) -> Vec<String> {
    let requested_set = requested.iter().map(String::as_str).collect::<HashSet<_>>();
    let mut replacements = requested.iter();
    complete
        .iter()
        .map(|thread_id| {
            if !requested_set.contains(thread_id.as_str()) {
                return thread_id.clone();
            }
            replacements
                .next()
                .cloned()
                .unwrap_or_else(|| thread_id.clone())
        })
        .collect()
}

fn write_project_thread_order(
    connection: &Connection,
    project_id: &str,
    order: &[String],
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO codex_project_thread_orders(
           project_id, ordered_thread_ids_json, updated_at
         ) VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id) DO UPDATE SET
           ordered_thread_ids_json = excluded.ordered_thread_ids_json,
           updated_at = excluded.updated_at",
        params![project_id, encode_thread_order(order)?, now],
    )?;
    Ok(())
}

fn require_thread_owner(
    connection: &Connection,
    library_id: &str,
    thread_id: &str,
) -> Result<ThreadOwner, StoreError> {
    let row = connection
        .query_row(
            "SELECT thread.project_id, link.session_id, session.project_id, session.pinned,
               project.library_id
             FROM codex_threads thread
             LEFT JOIN project_session_threads link ON link.thread_id = thread.thread_id
             LEFT JOIN project_sessions session ON session.id = link.session_id
             LEFT JOIN projects project ON project.id = thread.project_id
             WHERE thread.thread_id = ?1",
            [thread_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Codex Thread is unavailable"))?;
    if row.0.is_some() && row.4.as_deref() != Some(library_id) {
        return Err(not_found("Codex Thread is unavailable in this Library"));
    }
    let session_id = row
        .1
        .ok_or_else(|| not_found("Codex Thread has no Project Session"))?;
    Ok(ThreadOwner {
        project_id: row.0,
        session_id,
        session_project_id: row.2,
        session_pinned: row.3 == Some(1),
    })
}

fn validate_move_metadata(
    metadata: &ProjectWorkspaceThreadMoveMetadataPatch,
) -> Result<(), StoreError> {
    for (name, value) in [
        ("cwd", &metadata.cwd),
        ("managed_worktree_path", &metadata.managed_worktree_path),
        (
            "projectless_output_directory",
            &metadata.projectless_output_directory,
        ),
        (
            "projectless_workspace_browser_root",
            &metadata.projectless_workspace_browser_root,
        ),
    ] {
        let Some(Some(value)) = value else {
            continue;
        };
        if value.len() > MAX_PATH_BYTES {
            return Err(invalid(format!("{name} exceeds its Core bound")));
        }
    }
    Ok(())
}

fn move_thread_membership(
    connection: &Connection,
    thread_id: &str,
    source_project_id: Option<&str>,
    target_project_id: Option<&str>,
    owner: &ThreadOwner,
    metadata: &ProjectWorkspaceThreadMoveMetadataPatch,
) -> Result<(), StoreError> {
    if session_has_project_scoped_tabs(connection, &owner.session_id)? {
        return Err(invalid(
            "Only empty Sessions or Sessions with Browser and Terminal tabs can move between Projects",
        ));
    }
    let now = sqlite_now(connection)?;
    let next_pinned_order = if owner.session_pinned {
        Some(connection.query_row(
            "SELECT COALESCE(max(pinned_order), -1) + 1
             FROM project_sessions
             WHERE project_id IS ?1 AND pinned = 1 AND archived = 0",
            [target_project_id],
            |row| row.get::<_, i64>(0),
        )?)
    } else {
        None
    };
    connection.execute(
        "UPDATE project_sessions
         SET \"order\" = \"order\" + 1, updated_at = ?1
         WHERE project_id IS ?2",
        params![now, target_project_id],
    )?;
    let moved = connection.execute(
        "UPDATE project_sessions
         SET project_id = ?1, \"order\" = 0, pinned_order = ?2, updated_at = ?3
         WHERE id = ?4 AND project_id IS ?5",
        params![
            target_project_id,
            next_pinned_order,
            now,
            owner.session_id,
            source_project_id
        ],
    )?;
    if moved != 1 {
        return Err(conflict("Project Session changed during Thread move"));
    }
    rewrite_portable_tab_ownership(connection, &owner.session_id, target_project_id, &now)?;

    let updated = connection.execute(
        "UPDATE codex_threads SET
           project_id = ?1,
           cwd = CASE WHEN ?2 = 1 THEN ?3 ELSE cwd END,
           managed_worktree_path = CASE WHEN ?4 = 1 THEN ?5 ELSE managed_worktree_path END,
           projectless_output_directory = CASE WHEN ?6 = 1 THEN ?7
             ELSE projectless_output_directory END,
           projectless_workspace_browser_root = CASE WHEN ?8 = 1 THEN ?9
             ELSE projectless_workspace_browser_root END
         WHERE thread_id = ?10 AND project_id IS ?11",
        params![
            target_project_id,
            i64::from(metadata.cwd.is_some()),
            metadata.cwd.as_ref().and_then(Clone::clone),
            i64::from(metadata.managed_worktree_path.is_some()),
            metadata
                .managed_worktree_path
                .as_ref()
                .and_then(Clone::clone),
            i64::from(metadata.projectless_output_directory.is_some()),
            metadata
                .projectless_output_directory
                .as_ref()
                .and_then(Clone::clone),
            i64::from(metadata.projectless_workspace_browser_root.is_some()),
            metadata
                .projectless_workspace_browser_root
                .as_ref()
                .and_then(Clone::clone),
            thread_id,
            source_project_id,
        ],
    )?;
    if updated != 1 {
        return Err(conflict("Codex Thread changed during Thread move"));
    }
    Ok(())
}

fn rewrite_project_thread_orders(
    connection: &Connection,
    library_id: &str,
    moved_thread_id: &str,
    target_project_id: Option<&str>,
    placement: &ProjectWorkspaceThreadPlacement,
) -> Result<(), StoreError> {
    let current = read_project_thread_orders(connection, library_id)?;
    let mut changed = BTreeMap::new();
    for (project_id, order) in &current {
        let filtered = order
            .iter()
            .filter(|thread_id| thread_id.as_str() != moved_thread_id)
            .cloned()
            .collect::<Vec<_>>();
        if filtered.len() != order.len() {
            changed.insert(project_id.clone(), filtered);
        }
    }

    if !matches!(placement, ProjectWorkspaceThreadPlacement::Default)
        && let Some(target_project_id) = target_project_id
    {
        let known = list_project_thread_ids(connection, target_project_id)?
            .into_iter()
            .filter(|thread_id| thread_id != moved_thread_id)
            .collect::<Vec<_>>();
        let existing = changed
            .get(target_project_id)
            .or_else(|| current.get(target_project_id))
            .cloned()
            .unwrap_or_default();
        let complete = append_untracked(existing, &known);
        let target_order = match placement {
            ProjectWorkspaceThreadPlacement::Start => {
                let mut result = vec![moved_thread_id.to_owned()];
                result.extend(complete);
                result
            }
            ProjectWorkspaceThreadPlacement::End => {
                let mut result = complete;
                result.push(moved_thread_id.to_owned());
                result
            }
            ProjectWorkspaceThreadPlacement::Before { thread_id } => {
                let index = complete
                    .iter()
                    .position(|candidate| candidate == thread_id)
                    .unwrap_or(complete.len());
                let mut result = complete;
                result.insert(index, moved_thread_id.to_owned());
                result
            }
            ProjectWorkspaceThreadPlacement::Default => unreachable!("guarded placement"),
        };
        changed.insert(target_project_id.to_owned(), target_order);
    }

    let now = sqlite_now(connection)?;
    for (project_id, order) in changed {
        if current.get(&project_id) == Some(&order) {
            continue;
        }
        write_project_thread_order(connection, &project_id, &order, &now)?;
    }
    Ok(())
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

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::CORE_CONTRACT_VERSION;
    use nodex_core_contracts::workspace::{
        ProjectSessionIntent, ProjectSessionPanelId, ProjectSessionTabKind, ProjectWorkspaceIntent,
        ProjectWorkspaceRead, ProjectWorkspaceReadValue, ProjectWorkspaceThreadMoveMetadataPatch,
        ProjectWorkspaceThreadPlacement,
    };
    use serde_json::json;

    use crate::infrastructure::sqlite::with_immediate_transaction;

    use super::super::test_support::{
        apply, context, create_project, create_session_thread, read, request, seeded_workspace,
    };

    #[test]
    fn owns_same_snapshot_sidebar_and_manual_lane_orders() {
        let workspace = seeded_workspace();
        create_session_thread(
            &workspace.module,
            "chat-a",
            "session:chat-a",
            "thread:chat-a",
            None,
            300,
        );
        create_session_thread(
            &workspace.module,
            "chat-hidden",
            "session:chat-hidden",
            "thread:chat-hidden",
            None,
            200,
        );
        create_session_thread(
            &workspace.module,
            "chat-b",
            "session:chat-b",
            "thread:chat-b",
            None,
            100,
        );
        create_session_thread(
            &workspace.module,
            "project-thread",
            "session:project-thread",
            "thread:project",
            Some("project:default"),
            400,
        );

        apply(
            &workspace.module,
            "project-thread-order",
            ProjectWorkspaceIntent::SetProjectThreadOrder {
                project_id: "project:default".to_owned(),
                ordered_thread_ids: vec!["thread:project".to_owned()],
            },
        );
        apply(
            &workspace.module,
            "projectless-thread-order",
            ProjectWorkspaceIntent::SetProjectlessThreadOrder {
                thread_ids_in_display_order: vec![
                    "thread:chat-a".to_owned(),
                    "thread:chat-hidden".to_owned(),
                    "thread:chat-b".to_owned(),
                ],
                visible_thread_ids: vec!["thread:chat-a".to_owned(), "thread:chat-b".to_owned()],
                next_visible_thread_ids: vec![
                    "thread:chat-b".to_owned(),
                    "thread:chat-a".to_owned(),
                ],
            },
        );

        let ProjectWorkspaceReadValue::Sidebar { sidebar } = read(
            &workspace.module,
            ProjectWorkspaceRead::Sidebar {
                include_archived: Some(false),
            },
        ) else {
            panic!("Sidebar snapshot");
        };
        assert_eq!(
            sidebar.projectless_thread_order.as_deref(),
            Some(
                [
                    "thread:chat-b".to_owned(),
                    "thread:chat-hidden".to_owned(),
                    "thread:chat-a".to_owned(),
                ]
                .as_slice()
            )
        );
        assert_eq!(
            sidebar.project_thread_orders["project:default"],
            ["thread:project"]
        );
        assert_eq!(
            sidebar
                .threads
                .iter()
                .map(|thread| thread.thread_id.as_str())
                .collect::<Vec<_>>(),
            [
                "thread:project",
                "thread:chat-a",
                "thread:chat-hidden",
                "thread:chat-b",
            ]
        );
    }

    #[test]
    fn distinguishes_an_empty_project_order_from_no_custom_order() {
        let workspace = seeded_workspace();
        apply(
            &workspace.module,
            "empty-project-order",
            ProjectWorkspaceIntent::SetProjectThreadOrder {
                project_id: "project:default".to_owned(),
                ordered_thread_ids: Vec::new(),
            },
        );
        let ProjectWorkspaceReadValue::Sidebar { sidebar } = read(
            &workspace.module,
            ProjectWorkspaceRead::Sidebar {
                include_archived: None,
            },
        ) else {
            panic!("Sidebar with empty custom order");
        };
        assert_eq!(
            sidebar.project_thread_orders.get("project:default"),
            Some(&Vec::<String>::new())
        );

        apply(
            &workspace.module,
            "clear-project-order",
            ProjectWorkspaceIntent::ClearProjectThreadOrder {
                project_id: "project:default".to_owned(),
            },
        );
        let ProjectWorkspaceReadValue::Sidebar { sidebar } = read(
            &workspace.module,
            ProjectWorkspaceRead::Sidebar {
                include_archived: None,
            },
        ) else {
            panic!("Sidebar without custom order");
        };
        assert!(
            !sidebar
                .project_thread_orders
                .contains_key("project:default")
        );
    }

    #[test]
    fn moves_thread_session_tabs_search_projection_and_manual_order_atomically() {
        let workspace = seeded_workspace();
        create_project(&workspace.module, "create-target-project", "project:target");
        create_session_thread(
            &workspace.module,
            "move-source",
            "session:move",
            "thread:move",
            Some("project:default"),
            100,
        );
        create_session_thread(
            &workspace.module,
            "move-anchor",
            "session:anchor",
            "thread:anchor",
            Some("project:target"),
            90,
        );
        apply(
            &workspace.module,
            "move-tab",
            ProjectWorkspaceIntent::MutateSession {
                session_id: "session:move".to_owned(),
                intent: ProjectSessionIntent::CreateTab {
                    tab_id: "tab:move".to_owned(),
                    panel_id: ProjectSessionPanelId::Right,
                    target_leaf_id: None,
                    browser_tab_id: None,
                    tab_kind: ProjectSessionTabKind::Terminal,
                    title: "Move terminal".to_owned(),
                    config: json!({
                        "terminalSessionId": "terminal:move"
                    }),
                },
            },
        );
        apply(
            &workspace.module,
            "move-browser-tab",
            ProjectWorkspaceIntent::MutateSession {
                session_id: "session:move".to_owned(),
                intent: ProjectSessionIntent::CreateTab {
                    tab_id: "tab:move-browser".to_owned(),
                    panel_id: ProjectSessionPanelId::Right,
                    target_leaf_id: None,
                    browser_tab_id: None,
                    tab_kind: ProjectSessionTabKind::Browser,
                    title: "Move browser".to_owned(),
                    config: json!({
                        "projectId": "project:default",
                        "url": "https://example.test/move"
                    }),
                },
            },
        );
        apply(
            &workspace.module,
            "source-order",
            ProjectWorkspaceIntent::SetProjectThreadOrder {
                project_id: "project:default".to_owned(),
                ordered_thread_ids: vec!["thread:move".to_owned()],
            },
        );
        apply(
            &workspace.module,
            "target-order",
            ProjectWorkspaceIntent::SetProjectThreadOrder {
                project_id: "project:target".to_owned(),
                ordered_thread_ids: vec!["thread:anchor".to_owned()],
            },
        );

        let move_request = request(
            "move-thread",
            ProjectWorkspaceIntent::MoveThread {
                thread_id: "thread:move".to_owned(),
                source: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                    project_id: "project:default".to_owned(),
                },
                target: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                    project_id: "project:target".to_owned(),
                },
                placement: ProjectWorkspaceThreadPlacement::Before {
                    thread_id: "thread:anchor".to_owned(),
                },
                metadata: ProjectWorkspaceThreadMoveMetadataPatch {
                    cwd: Some(Some("/workspace/project:target".to_owned())),
                    managed_worktree_path: Some(None),
                    ..ProjectWorkspaceThreadMoveMetadataPatch::default()
                },
            },
        );
        let committed = workspace
            .module
            .apply(&context(), move_request.clone())
            .expect("move Thread");
        let replay = workspace
            .module
            .apply(&context(), move_request)
            .expect("replay move Thread");
        assert!(replay.committed.receipt.mutation.duplicate);
        assert_eq!(
            replay.committed.event_sequence,
            committed.committed.event_sequence
        );

        let ProjectWorkspaceReadValue::Sidebar { sidebar } = read(
            &workspace.module,
            ProjectWorkspaceRead::Sidebar {
                include_archived: None,
            },
        ) else {
            panic!("Sidebar snapshot");
        };
        assert_eq!(
            sidebar.project_thread_orders["project:default"],
            Vec::<String>::new()
        );
        assert_eq!(
            sidebar.project_thread_orders["project:target"],
            ["thread:move", "thread:anchor"]
        );
        let moved = sidebar
            .threads
            .iter()
            .find(|thread| thread.thread_id == "thread:move")
            .expect("moved Thread");
        assert_eq!(moved.project_id.as_deref(), Some("project:target"));
        assert_eq!(moved.cwd.as_deref(), Some("/workspace/project:target"));
        assert_eq!(moved.managed_worktree_path, None);

        let ProjectWorkspaceReadValue::Session { tabs, .. } = read(
            &workspace.module,
            ProjectWorkspaceRead::Session {
                session_id: "session:move".to_owned(),
            },
        ) else {
            panic!("moved Session");
        };
        assert!(
            tabs.iter()
                .all(|tab| { tab.project_id.as_deref() == Some("project:target") })
        );
        let browser = tabs
            .iter()
            .find(|tab| tab.id == "tab:move-browser")
            .expect("moved browser tab");
        assert_eq!(
            browser
                .config
                .get("projectId")
                .and_then(|value| value.as_str()),
            Some("project:target")
        );
        let terminal = tabs
            .iter()
            .find(|tab| tab.id == "tab:move")
            .expect("moved Terminal tab");
        assert_eq!(
            terminal.config,
            json!({ "terminalSessionId": "terminal:move" })
        );

        apply(
            &workspace.module,
            "move-thread-to-projectless",
            ProjectWorkspaceIntent::MoveThread {
                thread_id: "thread:move".to_owned(),
                source: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                    project_id: "project:target".to_owned(),
                },
                target: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Projectless,
                placement: ProjectWorkspaceThreadPlacement::End,
                metadata: ProjectWorkspaceThreadMoveMetadataPatch::default(),
            },
        );
        let ProjectWorkspaceReadValue::Session { tabs, .. } = read(
            &workspace.module,
            ProjectWorkspaceRead::Session {
                session_id: "session:move".to_owned(),
            },
        ) else {
            panic!("projectless moved Session");
        };
        assert!(tabs.iter().all(|tab| tab.project_id.is_none()));
        let browser = tabs
            .iter()
            .find(|tab| tab.id == "tab:move-browser")
            .expect("projectless browser tab");
        assert_eq!(browser.config["projectId"], serde_json::Value::Null);

        apply(
            &workspace.module,
            "move-projectless-thread-back",
            ProjectWorkspaceIntent::MoveThread {
                thread_id: "thread:move".to_owned(),
                source: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Projectless,
                target: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                    project_id: "project:target".to_owned(),
                },
                placement: ProjectWorkspaceThreadPlacement::End,
                metadata: ProjectWorkspaceThreadMoveMetadataPatch::default(),
            },
        );
        apply(
            &workspace.module,
            "create-move-review-tab",
            ProjectWorkspaceIntent::MutateSession {
                session_id: "session:move".to_owned(),
                intent: ProjectSessionIntent::CreateTab {
                    tab_id: "tab:move-review".to_owned(),
                    panel_id: ProjectSessionPanelId::Right,
                    target_leaf_id: None,
                    browser_tab_id: None,
                    tab_kind: ProjectSessionTabKind::Review,
                    title: "Review".to_owned(),
                    config: json!({ "projectId": "project:target" }),
                },
            },
        );
        let rejected = workspace
            .module
            .apply(
                &context(),
                request(
                    "reject-project-scoped-thread-move",
                    ProjectWorkspaceIntent::MoveThread {
                        thread_id: "thread:move".to_owned(),
                        source:
                            nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                                project_id: "project:target".to_owned(),
                            },
                        target:
                            nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Projectless,
                        placement: ProjectWorkspaceThreadPlacement::End,
                        metadata: ProjectWorkspaceThreadMoveMetadataPatch::default(),
                    },
                ),
            )
            .expect_err("reject Thread move with a Project-scoped tab");
        assert_eq!(
            rejected.code,
            nodex_core_contracts::CoreErrorCode::InvalidInput
        );
        let ProjectWorkspaceReadValue::Session { session, tabs, .. } = read(
            &workspace.module,
            ProjectWorkspaceRead::Session {
                session_id: "session:move".to_owned(),
            },
        ) else {
            panic!("rejected Session move snapshot");
        };
        assert_eq!(session.project_id.as_deref(), Some("project:target"));
        assert!(
            tabs.iter()
                .all(|tab| tab.project_id.as_deref() == Some("project:target"))
        );
    }

    #[test]
    fn rejects_corrupt_projectless_order_but_repairs_corrupt_project_order_on_move() {
        let workspace = seeded_workspace();
        create_project(
            &workspace.module,
            "corrupt-target-project",
            "project:target",
        );
        create_session_thread(
            &workspace.module,
            "corrupt-move",
            "session:corrupt",
            "thread:corrupt",
            Some("project:default"),
            100,
        );
        workspace
            .kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO codex_project_thread_orders(
                           project_id, ordered_thread_ids_json, updated_at
                         ) VALUES ('project:target', '[\"duplicate\",\"duplicate\"]', ?1)",
                        [super::super::test_support::NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO codex_sidebar_chat_order(
                           singleton, ordered_thread_ids_json, updated_at
                         ) VALUES (1, '[\"duplicate\",\"duplicate\"]', ?1)",
                        [super::super::test_support::NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("corrupt manual orders");

        let sidebar_error = workspace
            .module
            .read(
                &context(),
                nodex_core_contracts::ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Sidebar {
                        include_archived: None,
                    },
                },
            )
            .expect_err("corrupt Projectless order must fail closed");
        assert_eq!(
            sidebar_error.code,
            nodex_core_contracts::CoreErrorCode::StoreCorrupt
        );

        workspace
            .kernel
            .writer()
            .call(|connection| {
                connection
                    .execute("DELETE FROM codex_sidebar_chat_order", [])
                    .map(|_| ())
                    .map_err(Into::into)
            })
            .expect("clear corrupt Projectless order");
        apply(
            &workspace.module,
            "repair-corrupt-target-order",
            ProjectWorkspaceIntent::MoveThread {
                thread_id: "thread:corrupt".to_owned(),
                source: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                    project_id: "project:default".to_owned(),
                },
                target: nodex_core_contracts::workspace::ProjectWorkspaceThreadLane::Project {
                    project_id: "project:target".to_owned(),
                },
                placement: ProjectWorkspaceThreadPlacement::End,
                metadata: ProjectWorkspaceThreadMoveMetadataPatch::default(),
            },
        );
        let ProjectWorkspaceReadValue::Sidebar { sidebar } = read(
            &workspace.module,
            ProjectWorkspaceRead::Sidebar {
                include_archived: None,
            },
        ) else {
            panic!("repaired Sidebar");
        };
        assert_eq!(
            sidebar.project_thread_orders["project:target"],
            ["thread:corrupt"]
        );
    }
}
