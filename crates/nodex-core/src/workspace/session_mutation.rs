use std::collections::BTreeSet;

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::workspace::{
    ProjectSessionIntent, ProjectSessionPanelId, ProjectSessionTabKind,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value, json};

use crate::domain::identity::stable_uuid_v7;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::ProjectWorkspaceApplyOutcome;
use super::mutation::{WorkspaceMutationEffects, finish_mutation, workspace_event_anchor};
use super::panel_layout::{
    PanelStates, panel_id_sql, parse_panel_id, parse_panels, stringify_panels,
};

const MAX_ID_LENGTH: usize = 512;
const MAX_SESSION_TITLE_BYTES: usize = 8_000;
const MAX_MANUAL_TITLE_UTF16: usize = 60;
const MAX_TAB_ID_LENGTH: usize = 160;
const MAX_TAB_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_TAB_TITLE_CHARS: usize = 2_000;

struct SessionAuthority {
    project_id: Option<String>,
    pinned: bool,
    pinned_order: Option<i64>,
    thread_id: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn mutate_session(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    intent: &ProjectSessionIntent,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("session_id", session_id)?;
    let authority = require_session(connection, library_id, session_id)?;
    match intent {
        ProjectSessionIntent::Rename { title } => rename_session(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            title,
        ),
        ProjectSessionIntent::SetPinned { pinned } => set_session_pinned(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            *pinned,
        ),
        ProjectSessionIntent::SetUnread { unread } => set_session_unread(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            *unread,
        ),
        ProjectSessionIntent::LinkThread {
            thread_id,
            expected_project_id,
        } => link_thread(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            thread_id,
            expected_project_id.as_deref(),
        ),
        ProjectSessionIntent::UnlinkThread { thread_id } => unlink_thread(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            thread_id,
        ),
        ProjectSessionIntent::ReplacePanelLayout { panel_id, layout } => replace_panel_layout(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            *panel_id,
            layout,
        ),
        ProjectSessionIntent::CreateTab {
            tab_id,
            panel_id,
            target_leaf_id,
            browser_tab_id,
            tab_kind,
            title,
            config,
        } => create_tab(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            tab_id,
            *panel_id,
            target_leaf_id.as_deref(),
            browser_tab_id.as_deref(),
            *tab_kind,
            title,
            config,
        ),
        ProjectSessionIntent::DeleteTab { tab_id } => delete_tab(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            tab_id,
        ),
        ProjectSessionIntent::MoveTab {
            tab_id,
            panel_id,
            target_leaf_id,
            before_tab_id,
        } => move_tab(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            session_id,
            &authority,
            tab_id,
            *panel_id,
            target_leaf_id.as_deref(),
            before_tab_id.as_deref(),
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn replace_panel_layout(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    panel_id: ProjectSessionPanelId,
    layout: &Value,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let tab_ids = read_tab_ids(connection, session_id)?;
    let mut panels = read_panels(connection, session_id, &tab_ids)?;
    panels.replace_layout(panel_id, layout, tab_ids.for_panel(panel_id))?;
    let now = sqlite_now(connection)?;
    persist_panels_and_orders(connection, session_id, panels, &now)?;
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "replace_session_panel_layout",
        session_id,
        authority,
        Vec::new(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_tab(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    tab_id: &str,
    panel_id: ProjectSessionPanelId,
    target_leaf_id: Option<&str>,
    browser_tab_id: Option<&str>,
    tab_kind: ProjectSessionTabKind,
    title: &str,
    config: &Value,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_tab_id(tab_id)?;
    if let Some(target_leaf_id) = target_leaf_id {
        validate_id("target_leaf_id", target_leaf_id)?;
    }
    if let Some(browser_tab_id) = browser_tab_id {
        validate_id("browser_tab_id", browser_tab_id)?;
    }
    let title = normalize_tab_title(title)?;
    let config = normalize_tab_config(
        connection,
        library_id,
        authority.project_id.as_deref(),
        tab_kind,
        config,
    )?;

    if let Some(existing) = find_equivalent_tab(connection, session_id, tab_kind, &config)? {
        focus_existing_tab(connection, session_id, existing.0, existing.1)?;
        let now = sqlite_now(connection)?;
        return finish_session_mutation(
            connection,
            library_id,
            context,
            store_epoch,
            operation_id,
            request_hash,
            "focus_existing_session_tab",
            session_id,
            authority,
            Vec::new(),
            now,
        );
    }

    if connection
        .query_row(
            "SELECT 1 FROM project_session_tabs WHERE id = ?1",
            [tab_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Project Session tab identity already exists",
            false,
        ));
    }
    if !matches!(tab_kind, ProjectSessionTabKind::Browser) && browser_tab_id.is_some() {
        return Err(invalid("Only browser tabs can have a browser identity"));
    }
    let browser_tab_id = if matches!(tab_kind, ProjectSessionTabKind::Browser) {
        Some(
            browser_tab_id
                .map(str::to_owned)
                .unwrap_or_else(|| stable_uuid_v7(operation_id, "browser_tab", tab_id)),
        )
    } else {
        None
    };
    if let Some(browser_tab_id) = browser_tab_id.as_deref()
        && connection
            .query_row(
                "SELECT 1 FROM project_session_tabs \
                 WHERE session_id = ?1 AND browser_tab_id = ?2",
                params![session_id, browser_tab_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Browser tab identity already exists in this Session",
            false,
        ));
    }
    let now = sqlite_now(connection)?;
    let order = connection
        .query_row(
            "SELECT MAX(\"order\") FROM project_session_tabs \
             WHERE session_id = ?1 AND panel_id = ?2",
            params![session_id, panel_id_sql(panel_id)],
            |row| row.get::<_, Option<i64>>(0),
        )?
        .map_or(0, |order| order + 1);
    let config_json = serde_json::to_string(&config)
        .map_err(|_| internal("Project Session tab config cannot be encoded"))?;
    connection.execute(
        "INSERT INTO project_session_tabs(\
           id, session_id, project_id, browser_tab_id, panel_id, kind, title, config_json, \
           state_key, state_json, \"order\", created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, '{}', ?9, ?10, ?10)",
        params![
            tab_id,
            session_id,
            authority.project_id,
            browser_tab_id,
            panel_id_sql(panel_id),
            tab_kind_sql(tab_kind),
            title,
            config_json,
            order,
            now,
        ],
    )?;
    let tab_ids = read_tab_ids(connection, session_id)?;
    let mut panels = read_panels(connection, session_id, &tab_ids)?;
    panels.add_tab(
        panel_id,
        tab_id,
        tab_ids.for_panel(panel_id),
        target_leaf_id,
        None,
    )?;
    persist_panels_and_orders(connection, session_id, panels, &now)?;
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "create_session_tab",
        session_id,
        authority,
        Vec::new(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn delete_tab(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    tab_id: &str,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_tab_id(tab_id)?;
    let panel_id = require_tab_panel(connection, session_id, tab_id)?;
    let changed = connection.execute(
        "DELETE FROM project_session_tabs WHERE id = ?1 AND session_id = ?2",
        params![tab_id, session_id],
    )?;
    if changed != 1 {
        return Err(corrupt("Project Session tab disappeared during deletion"));
    }
    let tab_ids = read_tab_ids(connection, session_id)?;
    let mut panels = read_panels(connection, session_id, &tab_ids)?;
    panels.remove_tab(panel_id, tab_ids.for_panel(panel_id))?;
    let now = sqlite_now(connection)?;
    persist_panels_and_orders(connection, session_id, panels, &now)?;
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "delete_session_tab",
        session_id,
        authority,
        Vec::new(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn move_tab(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    tab_id: &str,
    target_panel_id: ProjectSessionPanelId,
    target_leaf_id: Option<&str>,
    before_tab_id: Option<&str>,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_tab_id(tab_id)?;
    if let Some(target_leaf_id) = target_leaf_id {
        validate_id("target_leaf_id", target_leaf_id)?;
    }
    if let Some(before_tab_id) = before_tab_id {
        validate_tab_id(before_tab_id)?;
        if before_tab_id == tab_id {
            return Err(invalid("before_tab_id must identify another tab"));
        }
    }
    let source_panel_id = require_tab_panel(connection, session_id, tab_id)?;
    if let Some(before_tab_id) = before_tab_id
        && require_tab_panel(connection, session_id, before_tab_id)? != target_panel_id
    {
        return Err(invalid("before_tab_id is not in the target panel"));
    }
    let tab_ids = read_tab_ids(connection, session_id)?;
    let mut panels = read_panels(connection, session_id, &tab_ids)?;
    if source_panel_id == target_panel_id {
        panels.add_tab(
            target_panel_id,
            tab_id,
            tab_ids.for_panel(target_panel_id),
            target_leaf_id,
            before_tab_id,
        )?;
    } else {
        let source_tab_ids = tab_ids
            .for_panel(source_panel_id)
            .iter()
            .filter(|candidate| candidate.as_str() != tab_id)
            .cloned()
            .collect::<Vec<_>>();
        let mut target_tab_ids = tab_ids.for_panel(target_panel_id).to_vec();
        target_tab_ids.push(tab_id.to_owned());
        panels.remove_tab(source_panel_id, &source_tab_ids)?;
        panels.add_tab(
            target_panel_id,
            tab_id,
            &target_tab_ids,
            target_leaf_id,
            before_tab_id,
        )?;
    }
    let now = sqlite_now(connection)?;
    persist_panels_and_orders(connection, session_id, panels, &now)?;
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "move_session_tab",
        session_id,
        authority,
        Vec::new(),
        now,
    )
}

struct TabIds {
    right: Vec<String>,
    bottom: Vec<String>,
}

impl TabIds {
    fn for_panel(&self, panel_id: ProjectSessionPanelId) -> &[String] {
        match panel_id {
            ProjectSessionPanelId::Right => &self.right,
            ProjectSessionPanelId::Bottom => &self.bottom,
        }
    }
}

fn read_tab_ids(connection: &Connection, session_id: &str) -> Result<TabIds, StoreError> {
    let rows = connection
        .prepare(
            "SELECT id, panel_id FROM project_session_tabs WHERE session_id = ?1 \
             ORDER BY CASE panel_id WHEN 'right' THEN 0 ELSE 1 END, \
               \"order\", created_at, id",
        )?
        .query_map([session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut tab_ids = TabIds {
        right: Vec::new(),
        bottom: Vec::new(),
    };
    for (tab_id, panel_id) in rows {
        match parse_panel_id(&panel_id)? {
            ProjectSessionPanelId::Right => tab_ids.right.push(tab_id),
            ProjectSessionPanelId::Bottom => tab_ids.bottom.push(tab_id),
        }
    }
    Ok(tab_ids)
}

fn read_panels(
    connection: &Connection,
    session_id: &str,
    tab_ids: &TabIds,
) -> Result<PanelStates, StoreError> {
    let panel_state_json = connection
        .query_row(
            "SELECT panel_state_json FROM project_sessions WHERE id = ?1",
            [session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Project Session disappeared during panel mutation"))?;
    parse_panels(&panel_state_json, &tab_ids.right, &tab_ids.bottom)
}

fn persist_panels_and_orders(
    connection: &Connection,
    session_id: &str,
    panels: PanelStates,
    now: &str,
) -> Result<(), StoreError> {
    let right = panels.ordered_tab_ids(ProjectSessionPanelId::Right);
    let bottom = panels.ordered_tab_ids(ProjectSessionPanelId::Bottom);
    let expected_count = connection.query_row(
        "SELECT count(*) FROM project_session_tabs WHERE session_id = ?1",
        [session_id],
        |row| row.get::<_, i64>(0),
    )?;
    let actual_count = right.len() + bottom.len();
    if usize::try_from(expected_count).ok() != Some(actual_count) {
        return Err(corrupt(
            "Project Session panel layout does not own every durable tab exactly once",
        ));
    }
    for (panel_id, tab_ids) in [
        (ProjectSessionPanelId::Right, right),
        (ProjectSessionPanelId::Bottom, bottom),
    ] {
        for (order, tab_id) in tab_ids.iter().enumerate() {
            let changed = connection.execute(
                "UPDATE project_session_tabs SET panel_id = ?1, \"order\" = ?2, updated_at = ?3 \
                 WHERE id = ?4 AND session_id = ?5",
                params![
                    panel_id_sql(panel_id),
                    i64::try_from(order)
                        .map_err(|_| internal("Project Session tab order overflow"))?,
                    now,
                    tab_id,
                    session_id,
                ],
            )?;
            if changed != 1 {
                return Err(corrupt(
                    "Project Session tab disappeared while deriving panel order",
                ));
            }
        }
    }
    let panel_state_json = stringify_panels(panels)?;
    let changed = connection.execute(
        "UPDATE project_sessions SET panel_state_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![panel_state_json, now, session_id],
    )?;
    if changed != 1 {
        return Err(corrupt("Project Session disappeared during panel mutation"));
    }
    Ok(())
}

fn require_tab_panel(
    connection: &Connection,
    session_id: &str,
    tab_id: &str,
) -> Result<ProjectSessionPanelId, StoreError> {
    let panel_id = connection
        .query_row(
            "SELECT panel_id FROM project_session_tabs WHERE id = ?1 AND session_id = ?2",
            params![tab_id, session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Project Session tab is unavailable"))?;
    parse_panel_id(&panel_id)
}

fn focus_existing_tab(
    connection: &Connection,
    session_id: &str,
    tab_id: String,
    panel_id: ProjectSessionPanelId,
) -> Result<(), StoreError> {
    let tab_ids = read_tab_ids(connection, session_id)?;
    let mut panels = read_panels(connection, session_id, &tab_ids)?;
    panels.activate_tab(panel_id, &tab_id, tab_ids.for_panel(panel_id))?;
    let now = sqlite_now(connection)?;
    persist_panels_and_orders(connection, session_id, panels, &now)
}

fn find_equivalent_tab(
    connection: &Connection,
    session_id: &str,
    tab_kind: ProjectSessionTabKind,
    config: &Value,
) -> Result<Option<(String, ProjectSessionPanelId)>, StoreError> {
    let row = match tab_kind {
        ProjectSessionTabKind::Review => connection
            .query_row(
                "SELECT id, panel_id FROM project_session_tabs \
                 WHERE session_id = ?1 AND kind = 'review' \
                 ORDER BY CASE panel_id WHEN 'right' THEN 0 ELSE 1 END, \
                   \"order\", created_at, id LIMIT 1",
                [session_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?,
        ProjectSessionTabKind::DbView => {
            let view_id = config
                .get("databaseViewId")
                .and_then(Value::as_str)
                .ok_or_else(|| internal("Normalized Database View tab has no View identity"))?;
            connection
                .query_row(
                    "SELECT id, panel_id FROM project_session_tabs \
                     WHERE session_id = ?1 AND kind = 'db_view' \
                       AND json_extract(config_json, '$.databaseViewId') = ?2 \
                     ORDER BY CASE panel_id WHEN 'right' THEN 0 ELSE 1 END, \
                       \"order\", created_at, id LIMIT 1",
                    params![session_id, view_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
        }
        _ => None,
    };
    row.map(|(tab_id, panel_id)| Ok((tab_id, parse_panel_id(&panel_id)?)))
        .transpose()
}

fn normalize_tab_config(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    tab_kind: ProjectSessionTabKind,
    config: &Value,
) -> Result<Value, StoreError> {
    let encoded = serde_json::to_vec(config)
        .map_err(|_| invalid("Project Session tab config cannot be encoded"))?;
    if encoded.len() > MAX_TAB_JSON_BYTES {
        return Err(invalid("Project Session tab config exceeds its bound"));
    }
    let config = config
        .as_object()
        .ok_or_else(|| invalid("Project Session tab config must be an object"))?;
    validate_config_project(config, project_id)?;
    if project_id.is_none() && !matches!(tab_kind, ProjectSessionTabKind::Browser) {
        return Err(invalid("Projectless Sessions can only own browser tabs"));
    }
    match tab_kind {
        ProjectSessionTabKind::DbView => {
            let project_id =
                project_id.ok_or_else(|| invalid("Database View tabs require a Project"))?;
            let view = required_enum(
                config,
                "view",
                &["kanban", "list", "toggle-list", "canvas", "calendar"],
            )?;
            let database_view_id = match optional_string(config, "databaseViewId", false)? {
                Some(view_id) => view_id,
                None => resolve_default_view(connection, project_id)?,
            };
            authorize_active_view(connection, library_id, project_id, &database_view_id)?;
            Ok(json!({
                "projectId": project_id,
                "databaseViewId": database_view_id,
                "view": view,
            }))
        }
        ProjectSessionTabKind::PageStage => {
            let project_id = project_id.ok_or_else(|| invalid("Page tabs require a Project"))?;
            let page_id = required_string(config, "pageId", true)?;
            let mut normalized = Map::from_iter([
                ("projectId".to_owned(), json!(project_id)),
                ("pageId".to_owned(), json!(page_id)),
            ]);
            if let Some(title) = optional_string(config, "titleSnapshot", true)? {
                normalized.insert("titleSnapshot".to_owned(), json!(title));
            }
            Ok(Value::Object(normalized))
        }
        ProjectSessionTabKind::Terminal => {
            let project_id =
                project_id.ok_or_else(|| invalid("Terminal tabs require a Project"))?;
            let terminal_session_id = required_string(config, "terminalSessionId", true)?;
            Ok(json!({
                "projectId": project_id,
                "terminalSessionId": terminal_session_id,
            }))
        }
        ProjectSessionTabKind::Browser => {
            let mut normalized = Map::new();
            normalized.insert(
                "projectId".to_owned(),
                project_id.map_or(Value::Null, |id| json!(id)),
            );
            for key in ["url", "title", "faviconUrl"] {
                if let Some(value) = optional_string(config, key, true)? {
                    normalized.insert(key.to_owned(), json!(value));
                }
            }
            if let Some(value) = config.get("deviceToolbarVisible") {
                let value = value
                    .as_bool()
                    .ok_or_else(|| invalid("Browser tab deviceToolbarVisible must be a boolean"))?;
                normalized.insert("deviceToolbarVisible".to_owned(), Value::Bool(value));
            }
            Ok(Value::Object(normalized))
        }
        ProjectSessionTabKind::Review => {
            let project_id = project_id.ok_or_else(|| invalid("Review tabs require a Project"))?;
            Ok(json!({ "projectId": project_id }))
        }
        ProjectSessionTabKind::Files => {
            let project_id = project_id.ok_or_else(|| invalid("Files tabs require a Project"))?;
            let host_id = config
                .get("hostId")
                .map(|value| {
                    value
                        .as_str()
                        .filter(|host| *host == "local")
                        .ok_or_else(|| invalid("Files tab hostId must be local"))
                })
                .transpose()?
                .unwrap_or("local");
            let workspace_root = optional_string(config, "workspaceRoot", true)?
                .unwrap_or_default()
                .trim()
                .to_owned();
            let mut normalized = Map::from_iter([
                ("projectId".to_owned(), json!(project_id)),
                ("hostId".to_owned(), json!(host_id)),
                ("workspaceRoot".to_owned(), json!(workspace_root)),
            ]);
            if let Some(path) = optional_string(config, "path", false)? {
                normalized.insert("path".to_owned(), json!(path.trim()));
            }
            Ok(Value::Object(normalized))
        }
    }
}

fn validate_config_project(
    config: &Map<String, Value>,
    project_id: Option<&str>,
) -> Result<(), StoreError> {
    let configured = config
        .get("projectId")
        .ok_or_else(|| invalid("Project Session tab config requires projectId"))?;
    let matches = match (project_id, configured) {
        (Some(expected), Value::String(actual)) => actual == expected,
        (None, Value::Null) => true,
        _ => false,
    };
    if matches {
        return Ok(());
    }
    Err(invalid(
        "Project Session tab config Project must match the owning Session",
    ))
}

fn resolve_default_view(connection: &Connection, project_id: &str) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT container.default_view_id FROM projects project \
             JOIN database_containers container \
               ON container.block_id = project.database_block_id \
             WHERE project.id = ?1 AND container.lifecycle = 'active'",
            [project_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten()
        .ok_or_else(|| not_found("Project has no active default Database View"))
}

fn authorize_active_view(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    view_id: &str,
) -> Result<(), StoreError> {
    validate_id("database_view_id", view_id)?;
    let database_id = connection
        .query_row(
            "SELECT view.database_block_id FROM database_views view \
             JOIN database_containers container ON container.block_id = view.database_block_id \
             WHERE view.id = ?1 AND view.lifecycle = 'active' \
               AND container.library_id = ?2 AND container.lifecycle = 'active'",
            params![view_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Active Database View is unavailable"))?;
    let primary_database_id = connection
        .query_row(
            "SELECT database_block_id FROM projects WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |row| row.get::<_, Option<String>>(0),
        )?
        .ok_or_else(|| corrupt("Project has no primary Database binding"))?;
    if primary_database_id == database_id {
        return Ok(());
    }
    let granted = connection
        .query_row(
            "SELECT 1 FROM project_resource_grants WHERE project_id = ?1 \
             AND root_kind = 'database' AND root_id = ?2 AND lifecycle = 'active'",
            params![project_id, database_id],
            |_| Ok(()),
        )
        .optional()?;
    if granted.is_some() {
        return Ok(());
    }
    let containing_document_id = connection
        .query_row(
            "SELECT containing_document_id FROM blocks \
             WHERE id = ?1 AND type = 'database'",
            [&database_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(containing_document_id) = containing_document_id else {
        return Err(StoreError::new(
            StoreErrorCode::Unauthorized,
            "Project cannot open the requested Database View",
            false,
        ));
    };
    let owner_page_id = connection
        .query_row(
            "SELECT page.block_id FROM block_documents ownership \
             JOIN pages page ON page.block_id = ownership.block_id \
             WHERE ownership.document_id = ?1",
            [&containing_document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Embedded Database has no owning Page"))?;
    let inherited = connection
        .query_row(
            "WITH RECURSIVE ancestors(page_id) AS (\
               SELECT ?2 \
               UNION ALL \
               SELECT page.parent_id FROM pages page JOIN ancestors current \
                 ON page.block_id = current.page_id WHERE page.parent_kind = 'page'\
             ) SELECT 1 FROM project_resource_grants grant_row JOIN ancestors \
               ON grant_row.root_id = ancestors.page_id \
             WHERE grant_row.project_id = ?1 AND grant_row.root_kind = 'page' \
               AND grant_row.lifecycle = 'active' LIMIT 1",
            params![project_id, owner_page_id],
            |_| Ok(()),
        )
        .optional()?;
    if inherited.is_some() {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::Unauthorized,
        "Project cannot open the requested Database View",
        false,
    ))
}

fn required_enum(
    config: &Map<String, Value>,
    key: &str,
    accepted: &[&str],
) -> Result<String, StoreError> {
    let value = required_string(config, key, false)?;
    if accepted.contains(&value.as_str()) {
        return Ok(value);
    }
    Err(invalid(&format!("Project Session tab {key} is invalid")))
}

fn required_string(
    config: &Map<String, Value>,
    key: &str,
    allow_empty_after_trim: bool,
) -> Result<String, StoreError> {
    let value = config
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(&format!("Project Session tab config requires {key}")))?;
    validate_config_string(key, value, allow_empty_after_trim)?;
    Ok(value.to_owned())
}

fn optional_string(
    config: &Map<String, Value>,
    key: &str,
    allow_empty_after_trim: bool,
) -> Result<Option<String>, StoreError> {
    let Some(value) = config.get(key) else {
        return Ok(None);
    };
    let value = value
        .as_str()
        .ok_or_else(|| invalid(&format!("Project Session tab {key} must be a string")))?;
    validate_config_string(key, value, allow_empty_after_trim)?;
    Ok(Some(value.to_owned()))
}

fn validate_config_string(
    key: &str,
    value: &str,
    allow_empty_after_trim: bool,
) -> Result<(), StoreError> {
    if value.len() > MAX_TAB_JSON_BYTES
        || value.chars().any(char::is_control)
        || (!allow_empty_after_trim && value.trim().is_empty())
    {
        return Err(invalid(&format!("Project Session tab {key} is invalid")));
    }
    Ok(())
}

fn normalize_tab_title(value: &str) -> Result<String, StoreError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > MAX_TAB_TITLE_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(invalid("Project Session tab title is invalid"));
    }
    Ok(value.to_owned())
}

fn validate_tab_id(value: &str) -> Result<(), StoreError> {
    if !value.is_empty()
        && value.len() <= MAX_TAB_ID_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-'))
    {
        return Ok(());
    }
    Err(invalid(
        "tab_id must contain 1 to 160 ASCII letters, digits, colons, underscores, or dashes",
    ))
}

fn tab_kind_sql(kind: ProjectSessionTabKind) -> &'static str {
    match kind {
        ProjectSessionTabKind::DbView => "db_view",
        ProjectSessionTabKind::PageStage => "page_stage",
        ProjectSessionTabKind::Terminal => "terminal",
        ProjectSessionTabKind::Browser => "browser",
        ProjectSessionTabKind::Review => "review",
        ProjectSessionTabKind::Files => "files",
    }
}

#[allow(clippy::too_many_arguments)]
fn rename_session(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    title: &str,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let normalized = normalize_manual_title(title)?;
    let now = sqlite_now(connection)?;
    if let Some(normalized) = normalized {
        if let Some(thread_id) = &authority.thread_id {
            let changed = connection.execute(
                "UPDATE codex_threads SET thread_name = ?1 WHERE thread_id = ?2",
                params![normalized, thread_id],
            )?;
            if changed != 1 {
                return Err(corrupt("Linked Codex Thread disappeared during rename"));
            }
        } else {
            let changed = connection.execute(
                "UPDATE project_sessions SET no_thread_fallback_title = ?1 \
                 WHERE id = ?2",
                params![normalized, session_id],
            )?;
            if changed != 1 {
                return Err(corrupt("Project Session disappeared during rename"));
            }
        }
        touch_session(connection, session_id, &now)?;
    }
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "rename_session",
        session_id,
        authority,
        authority.thread_id.iter().cloned().collect(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn set_session_pinned(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    pinned: bool,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let now = sqlite_now(connection)?;
    let pinned_order = if pinned {
        authority
            .pinned
            .then_some(authority.pinned_order)
            .flatten()
            .or(connection
                .query_row(
                    "SELECT MAX(pinned_order) FROM project_sessions \
                     WHERE project_id IS ?1 AND pinned = 1 AND archived = 0",
                    params![authority.project_id],
                    |row| row.get::<_, Option<i64>>(0),
                )?
                .map(|order| order + 1)
                .or(Some(0)))
    } else {
        None
    };
    let changed = connection.execute(
        "UPDATE project_sessions SET pinned = ?1, pinned_order = ?2, updated_at = ?3 \
         WHERE id = ?4",
        params![i64::from(pinned), pinned_order, now, session_id],
    )?;
    if changed != 1 {
        return Err(corrupt("Project Session disappeared during pin update"));
    }
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "set_session_pinned",
        session_id,
        authority,
        Vec::new(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn set_session_unread(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    unread: bool,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let now = sqlite_now(connection)?;
    let changed = connection.execute(
        "UPDATE project_sessions SET unread = ?1, updated_at = ?2 WHERE id = ?3",
        params![i64::from(unread), now, session_id],
    )?;
    if changed != 1 {
        return Err(corrupt("Project Session disappeared during unread update"));
    }
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "set_session_unread",
        session_id,
        authority,
        authority.thread_id.iter().cloned().collect(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn link_thread(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    thread_id: &str,
    expected_project_id: Option<&str>,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("thread_id", thread_id)?;
    if let Some(project_id) = expected_project_id {
        validate_id("expected_project_id", project_id)?;
    }
    if authority.project_id.as_deref() != expected_project_id {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Thread Project does not match the owning Session",
            false,
        ));
    }
    let thread_project_id = connection
        .query_row(
            "SELECT project_id FROM codex_threads WHERE thread_id = ?1",
            [thread_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Codex Thread is unavailable"))?;
    if thread_project_id.as_deref() != expected_project_id {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Persisted Codex Thread Project changed",
            true,
        ));
    }
    let conflicting_owner = connection
        .query_row(
            "SELECT session_id FROM project_session_threads \
             WHERE thread_id = ?1 AND session_id <> ?2 ORDER BY linked_at, session_id LIMIT 1",
            params![thread_id, session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if conflicting_owner.is_some() {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Codex Thread is already linked to another Project Session",
            false,
        ));
    }
    let now = sqlite_now(connection)?;
    connection.execute(
        "INSERT INTO project_session_threads(session_id, thread_id, linked_at) \
         VALUES (?1, ?2, ?3) ON CONFLICT(session_id) DO UPDATE SET \
           thread_id = excluded.thread_id, linked_at = excluded.linked_at",
        params![session_id, thread_id, now],
    )?;
    let unread = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM codex_unread_threads WHERE thread_id = ?1)",
        [thread_id],
        |row| row.get::<_, i64>(0),
    )?;
    connection.execute(
        "UPDATE project_sessions SET unread = ?1, updated_at = ?2 WHERE id = ?3",
        params![unread, now, session_id],
    )?;
    let mut thread_ids = authority.thread_id.iter().cloned().collect::<BTreeSet<_>>();
    thread_ids.insert(thread_id.to_owned());
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "link_session_thread",
        session_id,
        authority,
        thread_ids.into_iter().collect(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn unlink_thread(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    session_id: &str,
    authority: &SessionAuthority,
    thread_id: &str,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    validate_id("thread_id", thread_id)?;
    let Some(linked_thread_id) = authority.thread_id.as_deref() else {
        return Err(not_found("Project Session has no linked Codex Thread"));
    };
    if linked_thread_id != thread_id {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Project Session is linked to a different Codex Thread",
            true,
        ));
    }
    let changed = connection.execute(
        "DELETE FROM project_session_threads WHERE session_id = ?1 AND thread_id = ?2",
        params![session_id, thread_id],
    )?;
    if changed != 1 {
        return Err(corrupt("Project Session Thread link disappeared"));
    }
    let now = sqlite_now(connection)?;
    touch_session(connection, session_id, &now)?;
    finish_session_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        "unlink_session_thread",
        session_id,
        authority,
        vec![thread_id.to_owned()],
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_session_mutation(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    operation_kind: &'static str,
    session_id: &str,
    authority: &SessionAuthority,
    thread_ids: Vec<String>,
    committed_at: String,
) -> Result<ProjectWorkspaceApplyOutcome, StoreError> {
    let project_ids = authority.project_id.iter().cloned().collect::<Vec<_>>();
    let change_project_id = authority
        .project_id
        .clone()
        .map_or_else(|| workspace_event_anchor(connection, library_id), Ok)?;
    finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        request_hash,
        WorkspaceMutationEffects {
            operation_kind,
            change_project_id,
            project_ids,
            session_ids: vec![session_id.to_owned()],
            thread_ids,
            block_ids: Vec::new(),
            document_ids: Vec::new(),
            database_ids: Vec::new(),
            committed_at,
        },
    )
}

fn require_session(
    connection: &Connection,
    library_id: &str,
    session_id: &str,
) -> Result<SessionAuthority, StoreError> {
    connection
        .query_row(
            "SELECT session.project_id, session.pinned, session.pinned_order, link.thread_id \
             FROM project_sessions session \
             LEFT JOIN project_session_threads link ON link.session_id = session.id \
             WHERE session.id = ?1 AND (session.project_id IS NULL OR EXISTS(\
               SELECT 1 FROM projects project \
               WHERE project.id = session.project_id AND project.library_id = ?2\
             ))",
            params![session_id, library_id],
            |row| {
                Ok(SessionAuthority {
                    project_id: row.get(0)?,
                    pinned: row.get::<_, i64>(1)? == 1,
                    pinned_order: row.get(2)?,
                    thread_id: row.get(3)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Project Session is unavailable in this Library"))
}

fn normalize_manual_title(value: &str) -> Result<Option<String>, StoreError> {
    if value.len() > MAX_SESSION_TITLE_BYTES {
        return Err(invalid("Project Session title exceeds its bound"));
    }
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Ok(None);
    }
    let utf16 = normalized.encode_utf16().collect::<Vec<_>>();
    if utf16.len() <= MAX_MANUAL_TITLE_UTF16 {
        return Ok(Some(normalized));
    }
    let prefix = String::from_utf16_lossy(&utf16[..MAX_MANUAL_TITLE_UTF16 - 1]);
    Ok(Some(format!("{}…", prefix.trim_end())))
}

fn touch_session(connection: &Connection, session_id: &str, now: &str) -> Result<(), StoreError> {
    let changed = connection.execute(
        "UPDATE project_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )?;
    if changed == 1 {
        return Ok(());
    }
    Err(corrupt("Project Session disappeared during mutation"))
}

fn validate_id(name: &str, value: &str) -> Result<(), StoreError> {
    if !value.is_empty()
        && value == value.trim()
        && value.len() <= MAX_ID_LENGTH
        && !value.chars().any(char::is_control)
    {
        return Ok(());
    }
    Err(invalid(&format!(
        "{name} must be a canonical identity of at most {MAX_ID_LENGTH} bytes"
    )))
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(Into::into)
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
