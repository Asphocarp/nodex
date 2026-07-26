#[cfg(test)]
use std::collections::BTreeMap;
use std::collections::{BTreeSet, HashSet};

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::workspace::{
    ProjectWorkspaceThreadMoveMetadataPatch, ProjectWorkspaceThreadPlacement,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::ProjectWorkspaceApplyOutcome;
use super::session_mutation::{sqlite_now, validate_id};
use super::thread::finish_thread_mutation;

const MAX_THREAD_ORDER_SIZE: usize = 10_000;
const SIDEBAR_RANK_GAP: i64 = 1_000_000;
const MAX_PATH_BYTES: usize = 16 * 1024;

#[derive(Clone)]
struct ThreadOwner {
    project_id: Option<String>,
    session_id: String,
    session_project_id: Option<String>,
    session_pinned: bool,
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
            "DELETE FROM workspace_sidebar_lanes WHERE scope_key = ?1",
            [project_lane_scope(project_id)],
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

    let existing =
        read_project_thread_order(connection, project_id)?.unwrap_or_else(|| current.clone());
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
    write_lane_order(connection, "projectless", "projectless", None, &next, &now)?;
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
    update_thread_lane_rank(connection, thread_id, target_project_id, placement)?;

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

#[cfg(test)]
fn read_project_thread_orders(
    connection: &Connection,
    library_id: &str,
) -> Result<BTreeMap<String, Vec<String>>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT lane.project_id, position.thread_id, thread.project_id,
                    pinned.thread_id IS NOT NULL
             FROM workspace_sidebar_lanes lane
             JOIN projects project ON project.id = lane.project_id
             LEFT JOIN workspace_sidebar_positions position
               ON position.scope_key = lane.scope_key
             LEFT JOIN codex_threads thread ON thread.thread_id = position.thread_id
             LEFT JOIN codex_pinned_threads pinned ON pinned.thread_id = position.thread_id
             WHERE project.library_id = ?1
               AND lane.lane_kind = 'project'
               AND lane.order_mode = 'manual'
             ORDER BY lane.project_id, position.rank_key, position.thread_id",
        )?
        .query_map([library_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut result = BTreeMap::<String, Vec<String>>::new();
    for (project_id, thread_id, owner_project_id, pinned) in rows {
        let order = result.entry(project_id.clone()).or_default();
        let Some(thread_id) = thread_id else {
            continue;
        };
        if owner_project_id.as_deref() != Some(project_id.as_str()) || pinned != 0 {
            return Err(corrupt(
                "Workspace Project lane contains a Thread outside its lane",
            ));
        }
        order.push(thread_id);
    }
    Ok(result)
}

fn read_project_thread_order(
    connection: &Connection,
    project_id: &str,
) -> Result<Option<Vec<String>>, StoreError> {
    let lane_exists = connection
        .query_row(
            "SELECT 1 FROM workspace_sidebar_lanes
             WHERE scope_key = ?1
               AND lane_kind = 'project'
               AND project_id = ?2
               AND order_mode = 'manual'",
            params![project_lane_scope(project_id), project_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !lane_exists {
        return Ok(None);
    }
    let rows = connection
        .prepare(
            "SELECT position.thread_id, thread.project_id,
                    pinned.thread_id IS NOT NULL
             FROM workspace_sidebar_positions position
             JOIN codex_threads thread ON thread.thread_id = position.thread_id
             LEFT JOIN codex_pinned_threads pinned ON pinned.thread_id = position.thread_id
             WHERE position.scope_key = ?1
             ORDER BY position.rank_key, position.thread_id",
        )?
        .query_map([project_lane_scope(project_id)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut order = Vec::with_capacity(rows.len());
    for (thread_id, owner_project_id, pinned) in rows {
        if owner_project_id.as_deref() != Some(project_id) || pinned != 0 {
            return Err(corrupt(
                "Workspace Project lane contains a Thread outside its lane",
            ));
        }
        order.push(thread_id);
    }
    Ok(Some(order))
}

fn read_projectless_thread_order(
    connection: &Connection,
) -> Result<Option<Vec<String>>, StoreError> {
    let lane_exists = connection
        .query_row(
            "SELECT 1 FROM workspace_sidebar_lanes
             WHERE scope_key = 'projectless'
               AND lane_kind = 'projectless'
               AND order_mode = 'manual'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !lane_exists {
        return Ok(None);
    }
    let rows = connection
        .prepare(
            "SELECT position.thread_id, thread.project_id,
                    pinned.thread_id IS NOT NULL
             FROM workspace_sidebar_positions position
             JOIN codex_threads thread ON thread.thread_id = position.thread_id
             LEFT JOIN codex_pinned_threads pinned ON pinned.thread_id = position.thread_id
             WHERE position.scope_key = 'projectless'
             ORDER BY position.rank_key, position.thread_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut order = Vec::with_capacity(rows.len());
    for (thread_id, project_id, pinned) in rows {
        if project_id.is_some() || pinned != 0 {
            return Err(corrupt(
                "Workspace Projectless lane contains a Thread outside its lane",
            ));
        }
        order.push(thread_id);
    }
    Ok(Some(order))
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
            "SELECT 1 FROM projects \
             WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
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
    write_lane_order(
        connection,
        &project_lane_scope(project_id),
        "project",
        Some(project_id),
        order,
        now,
    )
}

fn project_lane_scope(project_id: &str) -> String {
    format!("project:{project_id}")
}

fn write_lane_order(
    connection: &Connection,
    scope_key: &str,
    lane_kind: &str,
    project_id: Option<&str>,
    order: &[String],
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO workspace_sidebar_lanes(
           scope_key, lane_kind, project_id, order_mode, revision, updated_at
         ) VALUES (?1, ?2, ?3, 'manual', 1, ?4)
         ON CONFLICT(scope_key) DO UPDATE SET
           order_mode = 'manual',
           revision = workspace_sidebar_lanes.revision + 1,
           updated_at = excluded.updated_at",
        params![scope_key, lane_kind, project_id, now],
    )?;
    connection.execute(
        "DELETE FROM workspace_sidebar_positions WHERE scope_key = ?1",
        [scope_key],
    )?;
    let revision = connection.query_row(
        "SELECT revision FROM workspace_sidebar_lanes WHERE scope_key = ?1",
        [scope_key],
        |row| row.get::<_, i64>(0),
    )?;
    let mut insert = connection.prepare(
        "INSERT INTO workspace_sidebar_positions(
           scope_key, thread_id, rank_key, revision, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (index, thread_id) in order.iter().enumerate() {
        let rank = i64::try_from(index + 1)
            .ok()
            .and_then(|value| value.checked_mul(SIDEBAR_RANK_GAP))
            .ok_or_else(|| invalid("Workspace Thread order rank overflowed"))?;
        insert.execute(params![scope_key, thread_id, rank, revision, now])?;
    }
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

fn update_thread_lane_rank(
    connection: &Connection,
    moved_thread_id: &str,
    target_project_id: Option<&str>,
    placement: &ProjectWorkspaceThreadPlacement,
) -> Result<(), StoreError> {
    let now = sqlite_now(connection)?;
    let target_scope =
        target_project_id.map_or_else(|| "projectless".to_owned(), project_lane_scope);
    let removed_scopes = connection
        .prepare(
            "SELECT scope_key
             FROM workspace_sidebar_positions
             WHERE thread_id = ?1",
        )?
        .query_map([moved_thread_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    connection.execute(
        "DELETE FROM workspace_sidebar_positions WHERE thread_id = ?1",
        [moved_thread_id],
    )?;

    if matches!(placement, ProjectWorkspaceThreadPlacement::Default) {
        let mut changed_scopes = removed_scopes.into_iter().collect::<BTreeSet<_>>();
        if lane_is_manual(connection, &target_scope)? {
            changed_scopes.insert(target_scope);
        }
        for scope_key in changed_scopes {
            bump_lane_revision(connection, &scope_key, &now)?;
        }
        return Ok(());
    }

    for scope_key in removed_scopes
        .iter()
        .filter(|scope_key| scope_key.as_str() != target_scope)
    {
        bump_lane_revision(connection, scope_key, &now)?;
    }

    if !lane_is_manual(connection, &target_scope)?
        || lane_has_unpositioned_threads(
            connection,
            target_project_id,
            &target_scope,
            moved_thread_id,
        )?
    {
        let current =
            list_lane_thread_ids_in_display_order(connection, target_project_id, &target_scope)?
                .into_iter()
                .filter(|thread_id| thread_id != moved_thread_id)
                .collect::<Vec<_>>();
        let next = apply_thread_placement(current, moved_thread_id, placement)?;
        write_lane_order(
            connection,
            &target_scope,
            if target_project_id.is_some() {
                "project"
            } else {
                "projectless"
            },
            target_project_id,
            &next,
            &now,
        )?;
        return Ok(());
    }

    let rank = rank_for_placement(connection, &target_scope, placement)?;
    let revision = bump_lane_revision(connection, &target_scope, &now)?;
    connection.execute(
        "INSERT INTO workspace_sidebar_positions(
           scope_key, thread_id, rank_key, revision, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![target_scope, moved_thread_id, rank, revision, now],
    )?;
    Ok(())
}

fn lane_is_manual(connection: &Connection, scope_key: &str) -> Result<bool, StoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM workspace_sidebar_lanes
             WHERE scope_key = ?1 AND order_mode = 'manual'",
            [scope_key],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn lane_has_unpositioned_threads(
    connection: &Connection,
    project_id: Option<&str>,
    scope_key: &str,
    moved_thread_id: &str,
) -> Result<bool, StoreError> {
    let exists = connection.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM project_sessions session
           JOIN project_session_threads link ON link.session_id = session.id
           JOIN codex_threads thread ON thread.thread_id = link.thread_id
           WHERE session.project_id IS ?1
             AND thread.thread_id <> ?2
             AND NOT EXISTS (
               SELECT 1 FROM workspace_sidebar_positions position
               WHERE position.scope_key = ?3
                 AND position.thread_id = thread.thread_id
             )
         )",
        params![project_id, moved_thread_id, scope_key],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(exists != 0)
}

fn list_lane_thread_ids_in_display_order(
    connection: &Connection,
    project_id: Option<&str>,
    scope_key: &str,
) -> Result<Vec<String>, StoreError> {
    connection
        .prepare(
            "SELECT thread.thread_id
             FROM project_sessions session
             JOIN project_session_threads link ON link.session_id = session.id
             JOIN codex_threads thread ON thread.thread_id = link.thread_id
             LEFT JOIN workspace_sidebar_positions position
               ON position.scope_key = ?2
               AND position.thread_id = thread.thread_id
             WHERE session.project_id IS ?1
             ORDER BY COALESCE(
               position.rank_key,
               -COALESCE(thread.updated_at, session.\"order\")
             ), session.id",
        )?
        .query_map(params![project_id, scope_key], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

fn apply_thread_placement(
    mut current: Vec<String>,
    moved_thread_id: &str,
    placement: &ProjectWorkspaceThreadPlacement,
) -> Result<Vec<String>, StoreError> {
    match placement {
        ProjectWorkspaceThreadPlacement::Start => {
            current.insert(0, moved_thread_id.to_owned());
        }
        ProjectWorkspaceThreadPlacement::End => {
            current.push(moved_thread_id.to_owned());
        }
        ProjectWorkspaceThreadPlacement::Before { thread_id } => {
            let index = current
                .iter()
                .position(|candidate| candidate == thread_id)
                .ok_or_else(|| conflict("Thread placement anchor is no longer in its lane"))?;
            current.insert(index, moved_thread_id.to_owned());
        }
        ProjectWorkspaceThreadPlacement::Default => {
            return Err(invalid("Default placement does not define a manual rank"));
        }
    }
    Ok(current)
}

fn rank_for_placement(
    connection: &Connection,
    scope_key: &str,
    placement: &ProjectWorkspaceThreadPlacement,
) -> Result<i64, StoreError> {
    let rank = match placement {
        ProjectWorkspaceThreadPlacement::Start => {
            let first = connection.query_row(
                "SELECT min(rank_key) FROM workspace_sidebar_positions WHERE scope_key = ?1",
                [scope_key],
                |row| row.get::<_, Option<i64>>(0),
            )?;
            first
                .unwrap_or(SIDEBAR_RANK_GAP)
                .checked_sub(SIDEBAR_RANK_GAP)
        }
        ProjectWorkspaceThreadPlacement::End => {
            let last = connection.query_row(
                "SELECT max(rank_key) FROM workspace_sidebar_positions WHERE scope_key = ?1",
                [scope_key],
                |row| row.get::<_, Option<i64>>(0),
            )?;
            last.unwrap_or(0).checked_add(SIDEBAR_RANK_GAP)
        }
        ProjectWorkspaceThreadPlacement::Before { thread_id } => {
            let anchor = connection
                .query_row(
                    "SELECT rank_key FROM workspace_sidebar_positions
                     WHERE scope_key = ?1 AND thread_id = ?2",
                    params![scope_key, thread_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .ok_or_else(|| conflict("Thread placement anchor is no longer in its lane"))?;
            let previous = connection.query_row(
                "SELECT max(rank_key) FROM workspace_sidebar_positions
                 WHERE scope_key = ?1 AND rank_key < ?2",
                params![scope_key, anchor],
                |row| row.get::<_, Option<i64>>(0),
            )?;
            match previous {
                Some(previous) if anchor - previous > 1 => {
                    Some(previous + ((anchor - previous) / 2))
                }
                Some(_) => None,
                None => anchor.checked_sub(SIDEBAR_RANK_GAP),
            }
        }
        ProjectWorkspaceThreadPlacement::Default => None,
    };
    if let Some(rank) = rank.filter(|rank| *rank >= 0) {
        return Ok(rank);
    }

    rebalance_lane(connection, scope_key)?;
    let retry = match placement {
        ProjectWorkspaceThreadPlacement::Start => 0,
        ProjectWorkspaceThreadPlacement::End => connection.query_row(
            "SELECT COALESCE(max(rank_key), 0) + ?2
             FROM workspace_sidebar_positions WHERE scope_key = ?1",
            params![scope_key, SIDEBAR_RANK_GAP],
            |row| row.get::<_, i64>(0),
        )?,
        ProjectWorkspaceThreadPlacement::Before { thread_id } => {
            let (anchor, previous) = connection.query_row(
                "SELECT anchor.rank_key, max(previous.rank_key)
                 FROM workspace_sidebar_positions anchor
                 LEFT JOIN workspace_sidebar_positions previous
                   ON previous.scope_key = anchor.scope_key
                  AND previous.rank_key < anchor.rank_key
                 WHERE anchor.scope_key = ?1 AND anchor.thread_id = ?2
                 GROUP BY anchor.rank_key",
                params![scope_key, thread_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
            )?;
            previous.map_or(0, |previous| previous + ((anchor - previous) / 2))
        }
        ProjectWorkspaceThreadPlacement::Default => {
            return Err(invalid("Default placement does not define a manual rank"));
        }
    };
    Ok(retry)
}

fn rebalance_lane(connection: &Connection, scope_key: &str) -> Result<(), StoreError> {
    let positions = connection
        .prepare(
            "SELECT thread_id, revision, updated_at FROM workspace_sidebar_positions
             WHERE scope_key = ?1 ORDER BY rank_key, thread_id",
        )?
        .query_map([scope_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    connection.execute(
        "DELETE FROM workspace_sidebar_positions WHERE scope_key = ?1",
        [scope_key],
    )?;
    let mut insert = connection.prepare(
        "INSERT INTO workspace_sidebar_positions(
           scope_key, thread_id, rank_key, revision, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (index, (thread_id, revision, updated_at)) in positions.iter().enumerate() {
        let rank = i64::try_from(index + 1)
            .ok()
            .and_then(|value| value.checked_mul(SIDEBAR_RANK_GAP))
            .ok_or_else(|| invalid("Workspace Thread order rank overflowed"))?;
        insert.execute(params![scope_key, thread_id, rank, revision, updated_at])?;
    }
    Ok(())
}

fn bump_lane_revision(
    connection: &Connection,
    scope_key: &str,
    now: &str,
) -> Result<i64, StoreError> {
    let updated = connection.execute(
        "UPDATE workspace_sidebar_lanes
         SET revision = revision + 1, updated_at = ?2
         WHERE scope_key = ?1 AND order_mode = 'manual'",
        params![scope_key, now],
    )?;
    if updated == 0 {
        return Err(conflict("Workspace sidebar lane is no longer manual"));
    }
    connection
        .query_row(
            "SELECT revision FROM workspace_sidebar_lanes WHERE scope_key = ?1",
            [scope_key],
            |row| row.get::<_, i64>(0),
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

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use crate::infrastructure::sqlite::with_immediate_transaction;
    use nodex_core_contracts::workspace::{
        ProjectWorkspaceIntent, ProjectWorkspaceThreadLane,
        ProjectWorkspaceThreadMoveMetadataPatch, ProjectWorkspaceThreadPlacement,
    };

    use super::super::test_support::{
        apply, create_project, create_session_thread, seeded_workspace,
    };
    use super::{read_project_thread_orders, read_projectless_thread_order};

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

        let (projectless_order, project_orders) = workspace
            .kernel
            .writer()
            .call(|connection| {
                Ok((
                    read_projectless_thread_order(connection)?,
                    read_project_thread_orders(connection, "library-1")?,
                ))
            })
            .expect("manual lane projections");
        assert_eq!(
            projectless_order.as_deref(),
            Some(
                [
                    "thread:chat-b".to_owned(),
                    "thread:chat-hidden".to_owned(),
                    "thread:chat-a".to_owned(),
                ]
                .as_slice()
            )
        );
        assert_eq!(project_orders["project:default"], ["thread:project"]);
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
        let project_orders = workspace
            .kernel
            .writer()
            .call(|connection| read_project_thread_orders(connection, "library-1"))
            .expect("empty manual order");
        assert_eq!(
            project_orders.get("project:default"),
            Some(&Vec::<String>::new())
        );

        apply(
            &workspace.module,
            "clear-project-order",
            ProjectWorkspaceIntent::ClearProjectThreadOrder {
                project_id: "project:default".to_owned(),
            },
        );
        let project_orders = workspace
            .kernel
            .writer()
            .call(|connection| read_project_thread_orders(connection, "library-1"))
            .expect("cleared manual order");
        assert!(!project_orders.contains_key("project:default"));
    }

    #[test]
    fn moving_inside_a_materialized_lane_only_rewrites_the_moved_rank() {
        let workspace = seeded_workspace();
        for (index, thread_id) in ["thread:a", "thread:b", "thread:c"].iter().enumerate() {
            create_session_thread(
                &workspace.module,
                &format!("rank-{index}"),
                &format!("session:{index}"),
                thread_id,
                Some("project:default"),
                300 - i64::try_from(index).expect("small index"),
            );
        }
        apply(
            &workspace.module,
            "materialize-ranks",
            ProjectWorkspaceIntent::SetProjectThreadOrder {
                project_id: "project:default".to_owned(),
                ordered_thread_ids: vec![
                    "thread:a".to_owned(),
                    "thread:b".to_owned(),
                    "thread:c".to_owned(),
                ],
            },
        );
        let before = workspace
            .kernel
            .writer()
            .call(|connection| {
                connection
                    .prepare(
                        "SELECT thread_id, rank_key, revision
                         FROM workspace_sidebar_positions
                         WHERE scope_key = 'project:project:default'
                         ORDER BY thread_id",
                    )?
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(crate::infrastructure::sqlite::StoreError::from)
            })
            .expect("initial ranks");

        apply(
            &workspace.module,
            "move-one-rank",
            ProjectWorkspaceIntent::MoveThread {
                thread_id: "thread:a".to_owned(),
                source: ProjectWorkspaceThreadLane::Project {
                    project_id: "project:default".to_owned(),
                },
                target: ProjectWorkspaceThreadLane::Project {
                    project_id: "project:default".to_owned(),
                },
                placement: ProjectWorkspaceThreadPlacement::Before {
                    thread_id: "thread:c".to_owned(),
                },
                metadata: ProjectWorkspaceThreadMoveMetadataPatch::default(),
            },
        );

        let (after, order) = workspace
            .kernel
            .writer()
            .call(|connection| {
                let positions = connection
                    .prepare(
                        "SELECT thread_id, rank_key, revision
                         FROM workspace_sidebar_positions
                         WHERE scope_key = 'project:project:default'
                         ORDER BY thread_id",
                    )?
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok((
                    positions,
                    super::read_project_thread_order(connection, "project:default")?,
                ))
            })
            .expect("updated ranks");
        assert_eq!(
            order,
            Some(vec![
                "thread:b".to_owned(),
                "thread:a".to_owned(),
                "thread:c".to_owned(),
            ])
        );
        assert_eq!(after[1], before[1], "thread:b rank must remain stable");
        assert_eq!(after[2], before[2], "thread:c rank must remain stable");
        assert_ne!(after[0], before[0], "only the moved rank is rewritten");
    }

    #[test]
    fn rejects_a_relational_position_that_points_outside_its_lane() {
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
                        "INSERT INTO workspace_sidebar_lanes(
                           scope_key, lane_kind, project_id, order_mode, revision, updated_at
                         ) VALUES (
                           'project:project:target', 'project', 'project:target',
                           'manual', 1, ?1
                         )",
                        [super::super::test_support::NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO workspace_sidebar_positions(
                           scope_key, thread_id, rank_key, revision, updated_at
                         ) VALUES (
                           'project:project:target', 'thread:corrupt', 1000000, 1, ?1
                         )",
                        [super::super::test_support::NOW],
                    )?;
                    Ok(())
                })
            })
            .expect("cross-lane position");

        let sidebar_error = workspace
            .kernel
            .writer()
            .call(|connection| read_project_thread_orders(connection, "library-1"))
            .expect_err("cross-lane position must fail closed");
        assert_eq!(
            sidebar_error.code,
            crate::infrastructure::sqlite::StoreErrorCode::StoreCorrupt
        );
    }
}
