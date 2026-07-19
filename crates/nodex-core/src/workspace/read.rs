use nodex_core_contracts::workspace::{
    ProjectLifecycle, ProjectSessionPanelId, ProjectSessionTabKind, ProjectSource,
    ProjectWorkspaceProject, ProjectWorkspaceRead, ProjectWorkspaceReadValue,
    ProjectWorkspaceSessionSummary, ProjectWorkspaceSessionTab,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::panel_layout::{parse_panel_id, parse_panels};
use super::session_mutation::parse_tab_kind;

const MAX_ID_LENGTH: usize = 512;
const MAX_TAB_JSON_BYTES: usize = 2 * 1024 * 1024;

struct ProjectRow {
    id: String,
    library_id: String,
    database_id: Option<String>,
    lifecycle: String,
    binding_revision: i64,
    name: String,
    description: String,
    icon: String,
    pinned_order: Option<i64>,
    created_at: String,
    updated_at: String,
}

struct SessionRow {
    id: String,
    project_id: Option<String>,
    fallback_title: String,
    order: i64,
    pinned: i64,
    pinned_order: Option<i64>,
    archived: i64,
    archived_at: Option<String>,
    unread: i64,
    left_pane_collapsed: i64,
    panel_state_json: String,
    thread_id: Option<String>,
    thread_name: Option<String>,
    thread_preview: Option<String>,
    created_at: String,
    updated_at: String,
}

pub(super) fn read(
    connection: &Connection,
    library_id: &str,
    request: ProjectWorkspaceRead,
) -> Result<ProjectWorkspaceReadValue, StoreError> {
    match request {
        ProjectWorkspaceRead::Startup => Ok(ProjectWorkspaceReadValue::Startup {
            projects: read_projects(connection, library_id, false)?,
            sessions: read_sessions(connection, library_id, None, false, true)?,
        }),
        ProjectWorkspaceRead::Project { project_id } => {
            validate_id("project_id", &project_id)?;
            Ok(ProjectWorkspaceReadValue::Project {
                project: read_project(connection, library_id, &project_id)?
                    .ok_or_else(|| not_found("Project is unavailable in this Library"))?,
            })
        }
        ProjectWorkspaceRead::Sessions {
            project_id,
            include_archived,
        } => {
            if let Some(project_id) = project_id.as_deref() {
                validate_id("project_id", project_id)?;
                require_project(connection, library_id, project_id)?;
            }
            Ok(ProjectWorkspaceReadValue::Sessions {
                sessions: read_sessions(
                    connection,
                    library_id,
                    project_id.as_deref(),
                    include_archived.unwrap_or(false),
                    false,
                )?,
            })
        }
        ProjectWorkspaceRead::Session { session_id } => {
            validate_id("session_id", &session_id)?;
            let row = read_session(connection, library_id, &session_id)?
                .ok_or_else(|| not_found("Project Session is unavailable"))?;
            let tabs = read_session_tabs(connection, &session_id, row.project_id.as_deref())?;
            let right_tab_ids = tabs
                .iter()
                .filter(|tab| tab.panel_id == ProjectSessionPanelId::Right)
                .map(|tab| tab.id.clone())
                .collect::<Vec<_>>();
            let bottom_tab_ids = tabs
                .iter()
                .filter(|tab| tab.panel_id == ProjectSessionPanelId::Bottom)
                .map(|tab| tab.id.clone())
                .collect::<Vec<_>>();
            let panels = parse_panels(&row.panel_state_json, &right_tab_ids, &bottom_tab_ids)?
                .into_value()?;
            Ok(ProjectWorkspaceReadValue::Session {
                session: session_summary(row),
                panels,
                tabs,
            })
        }
        ProjectWorkspaceRead::Thread { thread_id } => {
            validate_id("thread_id", &thread_id)?;
            let owner = connection
                .query_row(
                    "SELECT link.session_id, session.project_id \
                     FROM project_session_threads link \
                     JOIN project_sessions session ON session.id = link.session_id \
                     JOIN codex_threads thread ON thread.thread_id = link.thread_id \
                     WHERE link.thread_id = ?1 \
                       AND (session.project_id IS NULL OR EXISTS (\
                         SELECT 1 FROM projects owner \
                         WHERE owner.id = session.project_id AND owner.library_id = ?2\
                       )) \
                     ORDER BY link.linked_at, link.session_id LIMIT 1",
                    params![thread_id, library_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()?;
            Ok(ProjectWorkspaceReadValue::Thread {
                thread_id,
                session_id: owner.as_ref().map(|owner| owner.0.clone()),
                project_id: owner.and_then(|owner| owner.1),
            })
        }
        ProjectWorkspaceRead::ManagedWorktrees { project_id } => {
            validate_id("project_id", &project_id)?;
            require_project(connection, library_id, &project_id)?;
            let roots = connection
                .prepare(
                    "SELECT DISTINCT managed_worktree_path FROM codex_threads \
                     WHERE project_id = ?1 AND managed_worktree_path IS NOT NULL \
                       AND length(trim(managed_worktree_path)) > 0 \
                     ORDER BY managed_worktree_path",
                )?
                .query_map([project_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(ProjectWorkspaceReadValue::ManagedWorktrees { roots })
        }
    }
}

fn read_projects(
    connection: &Connection,
    library_id: &str,
    include_archived: bool,
) -> Result<Vec<ProjectWorkspaceProject>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT project.id, project.library_id, project.database_block_id, \
               project.lifecycle, project.binding_revision, project.name, project.description, \
               project.icon, pinned.\"order\", project.created, project.updated \
             FROM projects project \
             LEFT JOIN project_order ordering ON ordering.project_id = project.id \
             LEFT JOIN pinned_project_order pinned ON pinned.project_id = project.id \
             WHERE project.library_id = ?1 AND (?2 = 1 OR project.lifecycle <> 'archived') \
             ORDER BY COALESCE(ordering.\"order\", 9223372036854775807), \
               project.created, project.id",
        )?
        .query_map(
            params![library_id, i64::from(include_archived)],
            project_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| project(connection, row))
        .collect()
}

fn read_project(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
) -> Result<Option<ProjectWorkspaceProject>, StoreError> {
    connection
        .query_row(
            "SELECT project.id, project.library_id, project.database_block_id, \
               project.lifecycle, project.binding_revision, project.name, project.description, \
               project.icon, pinned.\"order\", project.created, project.updated \
             FROM projects project \
             LEFT JOIN pinned_project_order pinned ON pinned.project_id = project.id \
             WHERE project.id = ?1 AND project.library_id = ?2",
            params![project_id, library_id],
            project_row,
        )
        .optional()?
        .map(|row| project(connection, row))
        .transpose()
}

fn project_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: row.get(0)?,
        library_id: row.get(1)?,
        database_id: row.get(2)?,
        lifecycle: row.get(3)?,
        binding_revision: row.get(4)?,
        name: row.get(5)?,
        description: row.get(6)?,
        icon: row.get(7)?,
        pinned_order: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn project(
    connection: &Connection,
    row: ProjectRow,
) -> Result<ProjectWorkspaceProject, StoreError> {
    let database_id = row
        .database_id
        .ok_or_else(|| corrupt("Project has no primary Database binding"))?;
    let lifecycle = match row.lifecycle.as_str() {
        "active" => ProjectLifecycle::Active,
        "inactive" => ProjectLifecycle::Inactive,
        "archived" => ProjectLifecycle::Archived,
        _ => return Err(corrupt("Project lifecycle is invalid")),
    };
    let sources = connection
        .prepare(
            "SELECT root, \"order\" FROM project_sources \
             WHERE project_id = ?1 ORDER BY \"order\", created, root_key",
        )?
        .query_map([&row.id], |source| {
            Ok(ProjectSource {
                root: source.get(0)?,
                order: source.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ProjectWorkspaceProject {
        id: row.id,
        library_id: row.library_id,
        database_id,
        lifecycle,
        binding_revision: row.binding_revision,
        name: row.name,
        description: row.description,
        icon: (!row.icon.trim().is_empty()).then_some(row.icon),
        primary_workspace_root: sources.first().map(|source| source.root.clone()),
        sources,
        pinned: row.pinned_order.is_some(),
        pinned_order: row.pinned_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn read_sessions(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    include_archived: bool,
    all_projects: bool,
) -> Result<Vec<ProjectWorkspaceSessionSummary>, StoreError> {
    let sql = "SELECT session.id, session.project_id, session.no_thread_fallback_title, \
           session.\"order\", session.pinned, session.pinned_order, session.archived, \
           session.archived_at, session.unread, session.left_pane_collapsed, \
           session.panel_state_json, thread.thread_id, thread.thread_name, \
           thread.thread_preview, session.created_at, session.updated_at \
         FROM project_sessions session \
         LEFT JOIN project_session_threads link ON link.session_id = session.id \
         LEFT JOIN codex_threads thread ON thread.thread_id = link.thread_id \
         WHERE (\
           (?1 = 1 AND (\
             session.project_id IS NULL OR EXISTS (\
               SELECT 1 FROM projects owner \
               WHERE owner.id = session.project_id \
                 AND owner.library_id = ?2 AND owner.lifecycle <> 'archived'\
             )\
           )) OR \
           (?1 = 0 AND (\
             (?3 IS NULL AND session.project_id IS NULL) OR session.project_id = ?3\
           ))\
         ) AND (?4 = 1 OR session.archived = 0) \
         ORDER BY CASE WHEN session.project_id IS NULL THEN 0 ELSE 1 END, session.project_id, \
           CASE WHEN session.pinned = 1 THEN 0 ELSE 1 END, \
           CASE WHEN session.pinned = 1 \
             THEN COALESCE(session.pinned_order, 9223372036854775807) \
             ELSE session.\"order\" END, session.created_at, session.id";
    let mut statement = connection.prepare(sql)?;
    let mut rows = statement.query(params![
        i64::from(all_projects),
        library_id,
        project_id,
        i64::from(include_archived)
    ])?;
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        result.push(session_summary(session_row(row)?));
    }
    Ok(result)
}

fn read_session(
    connection: &Connection,
    library_id: &str,
    session_id: &str,
) -> Result<Option<SessionRow>, StoreError> {
    connection
        .query_row(
            "SELECT session.id, session.project_id, session.no_thread_fallback_title, \
               session.\"order\", session.pinned, session.pinned_order, session.archived, \
               session.archived_at, session.unread, session.left_pane_collapsed, \
               session.panel_state_json, thread.thread_id, thread.thread_name, \
               thread.thread_preview, session.created_at, session.updated_at \
             FROM project_sessions session \
             LEFT JOIN project_session_threads link ON link.session_id = session.id \
             LEFT JOIN codex_threads thread ON thread.thread_id = link.thread_id \
             WHERE session.id = ?1 \
               AND (session.project_id IS NULL OR EXISTS (\
                 SELECT 1 FROM projects owner \
                 WHERE owner.id = session.project_id AND owner.library_id = ?2\
               ))",
            params![session_id, library_id],
            session_row,
        )
        .optional()
        .map_err(Into::into)
}

fn session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        fallback_title: row.get(2)?,
        order: row.get(3)?,
        pinned: row.get(4)?,
        pinned_order: row.get(5)?,
        archived: row.get(6)?,
        archived_at: row.get(7)?,
        unread: row.get(8)?,
        left_pane_collapsed: row.get(9)?,
        panel_state_json: row.get(10)?,
        thread_id: row.get(11)?,
        thread_name: row.get(12)?,
        thread_preview: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn session_summary(row: SessionRow) -> ProjectWorkspaceSessionSummary {
    let display_title = [
        row.thread_name.as_deref(),
        row.thread_preview.as_deref(),
        Some(row.fallback_title.as_str()),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .find(|title| !title.is_empty())
    .unwrap_or("New thread")
    .to_owned();
    ProjectWorkspaceSessionSummary {
        id: row.id,
        project_id: row.project_id,
        no_thread_fallback_title: row.fallback_title,
        display_title,
        order: row.order,
        pinned: row.pinned == 1,
        pinned_order: row.pinned_order,
        archived: row.archived == 1,
        archived_at: row.archived_at,
        unread: row.unread == 1,
        left_pane_collapsed: row.left_pane_collapsed == 1,
        thread_id: row.thread_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn read_session_tabs(
    connection: &Connection,
    session_id: &str,
    session_project_id: Option<&str>,
) -> Result<Vec<ProjectWorkspaceSessionTab>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT id, session_id, project_id, browser_tab_id, panel_id, kind, title, \
               \"order\", config_json, state_key, state_json, created_at, updated_at \
             FROM project_session_tabs WHERE session_id = ?1 \
             ORDER BY CASE panel_id WHEN 'right' THEN 0 ELSE 1 END, \
               \"order\", created_at, id",
        )?
        .query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(
            |(
                id,
                session_id,
                project_id,
                browser_tab_id,
                panel_id,
                kind,
                title,
                order,
                config_json,
                state_key,
                state_json,
                created_at,
                updated_at,
            )| {
                if config_json.len() > MAX_TAB_JSON_BYTES || state_json.len() > MAX_TAB_JSON_BYTES {
                    return Err(corrupt("Project Session tab JSON exceeds its bound"));
                }
                let config = serde_json::from_str::<serde_json::Value>(&config_json)
                    .map_err(|_| corrupt("Project Session tab config JSON is invalid"))?;
                if !config.is_object() {
                    return Err(corrupt("Project Session tab config must be an object"));
                }
                let state = serde_json::from_str::<serde_json::Value>(&state_json)
                    .map_err(|_| corrupt("Project Session tab state JSON is invalid"))?;
                if state_key < 0 {
                    return Err(corrupt("Project Session tab state key is invalid"));
                }
                if project_id.as_deref() != session_project_id {
                    return Err(corrupt(
                        "Project Session tab Project differs from its owning Session",
                    ));
                }
                let panel_id = parse_panel_id(&panel_id)?;
                let kind = parse_tab_kind(&kind)?;
                if matches!(kind, ProjectSessionTabKind::Browser)
                    != browser_tab_id
                        .as_deref()
                        .is_some_and(|identity| !identity.trim().is_empty())
                {
                    return Err(corrupt("Project Session browser identity is invalid"));
                }
                Ok(ProjectWorkspaceSessionTab {
                    id,
                    session_id,
                    project_id,
                    browser_tab_id,
                    panel_id,
                    kind,
                    title,
                    order,
                    config,
                    state_key,
                    state,
                    created_at,
                    updated_at,
                })
            },
        )
        .collect()
}

fn require_project(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
) -> Result<(), StoreError> {
    if connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Ok(());
    }
    Err(not_found("Project is unavailable in this Library"))
}

fn validate_id(name: &str, value: &str) -> Result<(), StoreError> {
    if !value.trim().is_empty() && value.len() <= MAX_ID_LENGTH {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::InvalidInput,
        format!("{name} must contain 1 to {MAX_ID_LENGTH} bytes"),
        false,
    ))
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::workspace::{ProjectWorkspaceRead, ProjectWorkspaceReadValue};
    use nodex_core_contracts::{
        AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, CoreErrorCode, LibraryId,
        ModuleReadRequest, ProfileId, ProjectId,
    };
    use tempfile::{TempDir, tempdir};

    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::infrastructure::store::SqliteStoreKernel;
    use crate::workspace::ProjectWorkspaceModule;

    const NOW: &str = "2026-07-19T03:30:00.000Z";

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: "connection:workspace-read".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn seeded_module() -> (TempDir, SqliteStoreKernel, ProjectWorkspaceModule) {
        let directory = tempdir().expect("Profile");
        let home = directory.path().canonicalize().expect("absolute Profile");
        let kernel = SqliteStoreKernel::open(&home).expect("fresh store");
        kernel
            .writer()
            .call(|connection| {
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) VALUES ('profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-1', 'profile-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO profiles(id, created_at, updated_at) \
                         VALUES ('profile-foreign', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                         VALUES ('library-foreign', 'profile-foreign', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute(
                        "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                         VALUES (1, 'epoch-1', ?1, ?1)",
                        [NOW],
                    )?;
                    transaction.execute_batch(
                        "INSERT INTO projects( \
                           id, library_id, database_block_id, lifecycle, binding_revision, \
                           name, description, icon, created, updated \
                         ) VALUES \
                           ('project-1', 'library-1', 'database-1', 'active', 3, \
                            'Workspace', 'Primary project', '🚀', \
                            '2026-07-19T03:30:00.000Z', '2026-07-19T03:31:00.000Z'), \
                           ('project-2', 'library-1', 'database-2', 'archived', 2, \
                            'Archived', '', '', \
                            '2026-07-19T03:32:00.000Z', '2026-07-19T03:32:00.000Z'), \
                           ('project-foreign', 'library-foreign', 'database-foreign', 'active', 1, \
                            'Foreign', '', '', \
                            '2026-07-19T03:33:00.000Z', '2026-07-19T03:33:00.000Z'); \
                         INSERT INTO project_order(project_id, \"order\", updated) VALUES \
                           ('project-1', 0, '2026-07-19T03:31:00.000Z'), \
                           ('project-2', 1, '2026-07-19T03:32:00.000Z'); \
                         INSERT INTO pinned_project_order(project_id, \"order\", updated) \
                           VALUES ('project-1', 4, '2026-07-19T03:31:00.000Z'); \
                         INSERT INTO project_sources( \
                           project_id, root, root_key, \"order\", created, updated \
                         ) VALUES \
                           ('project-1', '/workspace/one', '/workspace/one', 0, \
                            '2026-07-19T03:30:00.000Z', '2026-07-19T03:30:00.000Z'), \
                           ('project-1', '/workspace/two', '/workspace/two', 1, \
                            '2026-07-19T03:30:00.000Z', '2026-07-19T03:30:00.000Z'); \
                         INSERT INTO project_sessions( \
                           id, project_id, no_thread_fallback_title, \"order\", pinned, \
                           pinned_order, archived, archived_at, unread, left_pane_collapsed, \
                           panel_state_json, created_at, updated_at \
                         ) VALUES \
                           ('session-project', 'project-1', 'Fallback', 2, 1, 0, 0, NULL, 1, 0, \
                            '{\"right\":{\"layout\":{\"kind\":\"leaf\",\"id\":\"right\"}}}', \
                            '2026-07-19T03:31:00.000Z', '2026-07-19T03:34:00.000Z'), \
                           ('session-archived', 'project-1', 'Archived session', 3, 0, NULL, 1, \
                            '2026-07-19T03:35:00.000Z', 0, 0, '{}', \
                            '2026-07-19T03:32:00.000Z', '2026-07-19T03:35:00.000Z'), \
                           ('session-archived-project', 'project-2', 'Archived project', 0, 0, \
                            NULL, 0, NULL, 0, 0, '{}', \
                            '2026-07-19T03:32:00.000Z', '2026-07-19T03:35:00.000Z'), \
                           ('session-foreign', 'project-foreign', 'Foreign session', 0, 0, NULL, \
                            0, NULL, 0, 0, '{}', \
                            '2026-07-19T03:33:00.000Z', '2026-07-19T03:33:00.000Z'), \
                           ('session-projectless', NULL, 'Projectless', 0, 0, NULL, 0, NULL, 0, 0, \
                            '{}', '2026-07-19T03:30:00.000Z', '2026-07-19T03:30:00.000Z'); \
                         INSERT INTO codex_threads( \
                           thread_id, project_id, thread_name, thread_preview, model_provider, \
                           managed_worktree_path, status_type, status_active_flags_json, archived, \
                           created_at, updated_at, linked_at \
                         ) VALUES \
                           ('thread-1', 'project-1', '', 'Thread preview', 'openai', \
                            '/worktrees/shared', 'idle', '[]', 0, 1, 2, \
                            '2026-07-19T03:33:00.000Z'), \
                           ('thread-2', 'project-1', 'Other', '', 'openai', \
                            '/worktrees/shared', 'idle', '[]', 0, 1, 2, \
                            '2026-07-19T03:33:00.000Z'), \
                           ('thread-3', 'project-1', 'Third', '', 'openai', \
                            '/worktrees/zeta', 'idle', '[]', 0, 1, 2, \
                            '2026-07-19T03:33:00.000Z'), \
                           ('thread-foreign', 'project-foreign', 'Foreign', '', 'openai', \
                            '/worktrees/foreign', 'idle', '[]', 0, 1, 2, \
                            '2026-07-19T03:33:00.000Z'); \
                         INSERT INTO project_session_threads(session_id, thread_id, linked_at) \
                           VALUES ('session-project', 'thread-1', \
                            '2026-07-19T03:33:00.000Z'), \
                           ('session-foreign', 'thread-foreign', \
                            '2026-07-19T03:33:00.000Z');",
                    )?;
                    Ok(())
                })
            })
            .expect("seed Workspace");
        let module = ProjectWorkspaceModule::new("profile-1", "library-1", &kernel)
            .expect("Workspace module");
        (directory, kernel, module)
    }

    fn read(
        module: &ProjectWorkspaceModule,
        read: ProjectWorkspaceRead,
    ) -> ProjectWorkspaceReadValue {
        module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read,
                },
            )
            .expect("Workspace read")
            .value
    }

    #[test]
    fn reads_coherent_startup_project_session_thread_and_worktree_snapshots() {
        let (_directory, _kernel, module) = seeded_module();
        let ProjectWorkspaceReadValue::Startup { projects, sessions } =
            read(&module, ProjectWorkspaceRead::Startup)
        else {
            panic!("startup snapshot");
        };
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].id, "project-1");
        assert_eq!(projects[0].database_id, "database-1");
        assert_eq!(projects[0].binding_revision, 3);
        assert_eq!(projects[0].icon.as_deref(), Some("🚀"));
        assert_eq!(
            projects[0].primary_workspace_root.as_deref(),
            Some("/workspace/one")
        );
        assert_eq!(projects[0].sources.len(), 2);
        assert!(projects[0].pinned);
        assert_eq!(projects[0].pinned_order, Some(4));
        assert_eq!(
            sessions
                .iter()
                .map(|session| session.id.as_str())
                .collect::<Vec<_>>(),
            vec!["session-projectless", "session-project"]
        );
        assert_eq!(sessions[1].display_title, "Thread preview");
        assert!(sessions[1].unread);
        assert_eq!(sessions[1].thread_id.as_deref(), Some("thread-1"));

        let ProjectWorkspaceReadValue::Project { project } = read(
            &module,
            ProjectWorkspaceRead::Project {
                project_id: "project-2".to_owned(),
            },
        ) else {
            panic!("project snapshot");
        };
        assert_eq!(
            project.lifecycle,
            nodex_core_contracts::workspace::ProjectLifecycle::Archived
        );

        let ProjectWorkspaceReadValue::Sessions { sessions } = read(
            &module,
            ProjectWorkspaceRead::Sessions {
                project_id: Some("project-1".to_owned()),
                include_archived: Some(true),
            },
        ) else {
            panic!("sessions snapshot");
        };
        assert_eq!(sessions.len(), 2);
        assert!(sessions.iter().any(|session| session.archived));

        let ProjectWorkspaceReadValue::Sessions { sessions } = read(
            &module,
            ProjectWorkspaceRead::Sessions {
                project_id: None,
                include_archived: None,
            },
        ) else {
            panic!("projectless sessions snapshot");
        };
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "session-projectless");

        let ProjectWorkspaceReadValue::Session {
            session,
            panels,
            tabs,
        } = read(
            &module,
            ProjectWorkspaceRead::Session {
                session_id: "session-project".to_owned(),
            },
        )
        else {
            panic!("session snapshot");
        };
        assert_eq!(session.display_title, "Thread preview");
        assert_eq!(panels["right"]["layout"]["version"], 2);
        assert_eq!(panels["right"]["layout"]["root"]["id"], "main");
        assert!(tabs.is_empty());

        let ProjectWorkspaceReadValue::Thread {
            session_id,
            project_id,
            ..
        } = read(
            &module,
            ProjectWorkspaceRead::Thread {
                thread_id: "thread-1".to_owned(),
            },
        )
        else {
            panic!("thread snapshot");
        };
        assert_eq!(session_id.as_deref(), Some("session-project"));
        assert_eq!(project_id.as_deref(), Some("project-1"));

        let ProjectWorkspaceReadValue::ManagedWorktrees { roots } = read(
            &module,
            ProjectWorkspaceRead::ManagedWorktrees {
                project_id: "project-1".to_owned(),
            },
        ) else {
            panic!("managed worktrees snapshot");
        };
        assert_eq!(roots, vec!["/worktrees/shared", "/worktrees/zeta"]);

        let foreign_session = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Session {
                        session_id: "session-foreign".to_owned(),
                    },
                },
            )
            .expect_err("foreign Library Session must remain hidden");
        assert_eq!(foreign_session.code, CoreErrorCode::NotFound);

        let ProjectWorkspaceReadValue::Thread {
            session_id,
            project_id,
            ..
        } = read(
            &module,
            ProjectWorkspaceRead::Thread {
                thread_id: "thread-foreign".to_owned(),
            },
        )
        else {
            panic!("foreign thread snapshot");
        };
        assert_eq!(session_id, None);
        assert_eq!(project_id, None);
    }

    #[test]
    fn fails_closed_for_invalid_panel_state_and_adapter_identity() {
        let (_directory, kernel, module) = seeded_module();
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE project_sessions SET panel_state_json = '[]' \
                     WHERE id = 'session-project'",
                    [],
                )?;
                Ok(())
            })
            .expect("corrupt panel state");
        let corrupt = module
            .read(
                &context(),
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Session {
                        session_id: "session-project".to_owned(),
                    },
                },
            )
            .expect_err("reject corrupt panel state");
        assert_eq!(corrupt.code, CoreErrorCode::StoreCorrupt);

        let mut foreign = context();
        foreign.library_id = LibraryId("library-foreign".to_owned());
        let unauthorized = module
            .read(
                &foreign,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: ProjectWorkspaceRead::Startup,
                },
            )
            .expect_err("reject foreign Adapter identity");
        assert_eq!(unauthorized.code, CoreErrorCode::Unauthorized);
    }
}
