use std::collections::HashSet;

use nodex_core_contracts::BoundModuleContext;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::ProjectWorkspaceApplyOutcome;
use super::mutation::{
    WorkspaceMutationEffects, finish_mutation, project_session_scope, workspace_event_anchor,
};
use super::panel_layout::{parse_panels, stringify_panels};
use super::session_mutation::{
    SessionInvalidationKind, finish_session_mutation, require_session, sqlite_now, validate_id,
};

const MAX_SESSION_TITLE_BYTES: usize = 8_000;
const MAX_SESSION_TITLE_UTF16: usize = 2_000;
const MAX_SESSION_ORDER_SIZE: usize = 100_000;

#[allow(clippy::too_many_arguments)]
pub(super) fn create_session(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    project_id: Option<&str>,
    title: &str,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("session_id", session_id)?;
    if let Some(project_id) = project_id {
        validate_id("project_id", project_id)?;
        require_project(connection, library_id, project_id, true)?;
    }
    let title = normalize_session_title(title)?;
    if connection
        .query_row(
            "SELECT 1 FROM project_sessions WHERE id = ?1",
            [session_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Project Session identity already exists",
            false,
        ));
    }
    let count = connection.query_row(
        "SELECT count(*) FROM project_sessions WHERE project_id IS ?1",
        [project_id],
        |row| row.get::<_, i64>(0),
    )?;
    if usize::try_from(count)
        .ok()
        .is_none_or(|count| count >= MAX_SESSION_ORDER_SIZE)
    {
        return Err(invalid("Project has too many Sessions"));
    }
    let now = sqlite_now(connection)?;
    connection.execute(
        "UPDATE project_sessions SET \"order\" = \"order\" + 1, updated_at = ?1 \
         WHERE project_id IS ?2 AND \"order\" >= 0",
        params![now, project_id],
    )?;
    let panels = stringify_panels(parse_panels("{}", &[], &[])?)?;
    connection.execute(
        "INSERT INTO project_sessions(\
           id, project_id, no_thread_fallback_title, \"order\", pinned, pinned_order, \
           archived, archived_at, unread, left_pane_collapsed, panel_state_json, \
           created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 0, 0, NULL, 0, NULL, 0, 0, ?4, ?5, ?5)",
        params![session_id, project_id, title, panels, now],
    )?;
    finish_lifecycle_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "create_session",
        project_id.into_iter().map(str::to_owned).collect(),
        vec![session_id.to_owned()],
        Vec::new(),
        vec![project_session_scope(project_id)],
        project_id,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn delete_session(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("session_id", session_id)?;
    let authority = require_session(connection, library_id, session_id)?;
    let changed = connection.execute("DELETE FROM project_sessions WHERE id = ?1", [session_id])?;
    if changed != 1 {
        return Err(corrupt("Project Session disappeared during deletion"));
    }
    let now = sqlite_now(connection)?;
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "delete_session",
        session_id,
        &authority,
        authority.thread_id.iter().cloned().collect(),
        SessionInvalidationKind::SummaryAndDetail,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn move_session(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    project_id: Option<&str>,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("session_id", session_id)?;
    if let Some(project_id) = project_id {
        validate_id("project_id", project_id)?;
        require_project(connection, library_id, project_id, false)?;
    }
    let authority = require_session(connection, library_id, session_id)?;
    let now = sqlite_now(connection)?;
    if authority.project_id.as_deref() == project_id {
        return finish_session_mutation(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            "move_session",
            session_id,
            &authority,
            authority.thread_id.iter().cloned().collect(),
            SessionInvalidationKind::None,
            now,
        );
    }
    if session_has_project_scoped_tabs(connection, session_id)? {
        return Err(invalid(
            "Only empty Sessions or Sessions with Browser and Terminal tabs can move between Projects",
        ));
    }
    let next_pinned_order = if authority.pinned {
        Some(
            connection
                .query_row(
                    "SELECT MAX(pinned_order) FROM project_sessions \
                     WHERE project_id IS ?1 AND pinned = 1 AND archived = 0",
                    [project_id],
                    |row| row.get::<_, Option<i64>>(0),
                )?
                .map_or(0, |order| order + 1),
        )
    } else {
        None
    };
    connection.execute(
        "UPDATE project_sessions SET \"order\" = \"order\" + 1, updated_at = ?1 \
         WHERE project_id IS ?2 AND \"order\" >= 0",
        params![now, project_id],
    )?;
    let changed = connection.execute(
        "UPDATE project_sessions SET project_id = ?1, \"order\" = 0, pinned_order = ?2, \
           updated_at = ?3 WHERE id = ?4",
        params![project_id, next_pinned_order, now, session_id],
    )?;
    if changed != 1 {
        return Err(corrupt("Project Session disappeared during Project move"));
    }
    rewrite_portable_tab_ownership(connection, session_id, project_id, &now)?;
    connection.execute(
        "UPDATE codex_threads SET project_id = ?1 WHERE thread_id IN (\
           SELECT thread_id FROM project_session_threads WHERE session_id = ?2\
         )",
        params![project_id, session_id],
    )?;

    let mut project_ids = authority.project_id.iter().cloned().collect::<Vec<_>>();
    if let Some(project_id) = project_id
        && !project_ids.iter().any(|candidate| candidate == project_id)
    {
        project_ids.push(project_id.to_owned());
    }
    let mut summary_scopes = vec![project_session_scope(authority.project_id.as_deref())];
    let target_scope = project_session_scope(project_id);
    if !summary_scopes.contains(&target_scope) {
        summary_scopes.push(target_scope);
    }
    finish_lifecycle_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "move_session",
        project_ids,
        vec![session_id.to_owned()],
        authority.thread_id.iter().cloned().collect(),
        summary_scopes,
        project_id.or(authority.project_id.as_deref()),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn reorder_sessions(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    project_id: Option<&str>,
    selected_session_ids: &[String],
    pinned_only: bool,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    if let Some(project_id) = project_id {
        validate_id("project_id", project_id)?;
        require_project(connection, library_id, project_id, false)?;
    }
    if selected_session_ids.len() > MAX_SESSION_ORDER_SIZE {
        return Err(invalid("Project Session order exceeds its bound"));
    }
    for session_id in selected_session_ids {
        validate_id("session_id", session_id)?;
    }
    let existing = read_ordered_session_ids(connection, project_id, pinned_only)?;
    let existing_set = existing.iter().map(String::as_str).collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    let mut final_order = selected_session_ids
        .iter()
        .filter(|session_id| {
            existing_set.contains(session_id.as_str()) && seen.insert((*session_id).clone())
        })
        .cloned()
        .collect::<Vec<_>>();
    final_order.extend(
        existing
            .into_iter()
            .filter(|session_id| seen.insert(session_id.clone())),
    );
    let now = sqlite_now(connection)?;
    if pinned_only {
        for (order, session_id) in final_order.iter().enumerate() {
            let changed = connection.execute(
                "UPDATE project_sessions SET pinned_order = ?1, updated_at = ?2 \
                 WHERE id = ?3 AND project_id IS ?4 AND pinned = 1 AND archived = 0",
                params![to_order(order)?, now, session_id, project_id],
            )?;
            if changed != 1 {
                return Err(corrupt(
                    "Pinned Project Session order changed during mutation",
                ));
            }
        }
    } else {
        let mut pinned_order = 0_i64;
        for (order, session_id) in final_order.iter().enumerate() {
            let changed = connection.execute(
                "UPDATE project_sessions SET \"order\" = ?1, \
                   pinned_order = CASE WHEN pinned = 1 THEN ?2 ELSE pinned_order END, \
                   updated_at = ?3 \
                 WHERE id = ?4 AND project_id IS ?5 AND archived = 0",
                params![to_order(order)?, pinned_order, now, session_id, project_id],
            )?;
            if changed != 1 {
                return Err(corrupt("Project Session order changed during mutation"));
            }
            let pinned = connection.query_row(
                "SELECT pinned FROM project_sessions WHERE id = ?1",
                [session_id],
                |row| row.get::<_, i64>(0),
            )?;
            if pinned == 1 {
                pinned_order += 1;
            }
        }
    }
    finish_lifecycle_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        if pinned_only {
            "reorder_pinned_sessions"
        } else {
            "reorder_sessions"
        },
        project_id.into_iter().map(str::to_owned).collect(),
        final_order,
        Vec::new(),
        vec![project_session_scope(project_id)],
        project_id,
        now,
    )
}

fn read_ordered_session_ids(
    connection: &Connection,
    project_id: Option<&str>,
    pinned_only: bool,
) -> Result<Vec<String>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT id FROM project_sessions WHERE project_id IS ?1 AND archived = 0 \
               AND (?2 = 0 OR pinned = 1) \
             ORDER BY CASE WHEN pinned = 1 THEN 0 ELSE 1 END, \
               CASE WHEN pinned = 1 THEN COALESCE(pinned_order, 9223372036854775807) \
                    ELSE \"order\" END, created_at, id",
        )?
        .query_map(params![project_id, i64::from(pinned_only)], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub(super) fn session_has_project_scoped_tabs(
    connection: &Connection,
    session_id: &str,
) -> Result<bool, StoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM project_session_tabs \
             WHERE session_id = ?1 AND kind NOT IN ('browser', 'terminal') LIMIT 1",
            [session_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub(super) fn rewrite_portable_tab_ownership(
    connection: &Connection,
    session_id: &str,
    project_id: Option<&str>,
    now: &str,
) -> Result<(), StoreError> {
    let rows = connection
        .prepare(
            "SELECT id, kind, config_json FROM project_session_tabs \
             WHERE session_id = ?1 AND kind IN ('browser', 'terminal') ORDER BY id",
        )?
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (tab_id, kind, config_json) in rows {
        let config_json = if kind == "browser" {
            let mut config = serde_json::from_str::<Value>(&config_json)
                .map_err(|_| corrupt("Browser tab config JSON is invalid"))?;
            let config = config
                .as_object_mut()
                .ok_or_else(|| corrupt("Browser tab config must be an object"))?;
            config.insert(
                "projectId".to_owned(),
                project_id.map_or(Value::Null, |project_id| {
                    Value::String(project_id.to_owned())
                }),
            );
            serde_json::to_string(config)
                .map_err(|_| internal("Browser tab config cannot be encoded"))?
        } else {
            config_json
        };
        let changed = connection.execute(
            "UPDATE project_session_tabs SET project_id = ?1, config_json = ?2, \
               updated_at = ?3 WHERE id = ?4 AND session_id = ?5",
            params![project_id, config_json, now, tab_id, session_id],
        )?;
        if changed != 1 {
            return Err(corrupt("Portable tab disappeared during Session move"));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn finish_lifecycle_mutation(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    operation_kind: &'static str,
    project_ids: Vec<String>,
    session_ids: Vec<String>,
    thread_ids: Vec<String>,
    session_summary_scopes: Vec<nodex_core_contracts::workspace::ProjectSessionInvalidationScope>,
    change_project_id: Option<&str>,
    committed_at: String,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let change_project_id = change_project_id
        .map(str::to_owned)
        .map_or_else(|| workspace_event_anchor(connection, library_id), Ok)?;
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        WorkspaceMutationEffects {
            operation_kind,
            project_catalog_change: None,
            change_project_id,
            project_ids,
            session_detail_ids: session_ids.clone(),
            session_ids,
            thread_ids,
            session_summary_scopes,
            block_ids: Vec::new(),
            document_ids: Vec::new(),
            database_ids: Vec::new(),
            committed_at,
        },
    )
}

fn require_project(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    active: bool,
) -> Result<(), StoreError> {
    let lifecycle = connection
        .query_row(
            "SELECT lifecycle FROM projects WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Project is unavailable in this Library"))?;
    if !active || lifecycle == "active" {
        return Ok(());
    }
    Err(invalid("New Sessions require an active Project"))
}

fn normalize_session_title(value: &str) -> Result<String, StoreError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_SESSION_TITLE_BYTES
        || value.encode_utf16().count() > MAX_SESSION_TITLE_UTF16
    {
        return Err(invalid("Project Session title is invalid"));
    }
    Ok(value.to_owned())
}

fn to_order(value: usize) -> Result<i64, StoreError> {
    i64::try_from(value).map_err(|_| internal("Project Session order overflow"))
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

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, true)
}
