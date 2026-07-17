import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { ProjectSessionPanelsSchema } from "../../shared/schemas/project-sessions";
import { makeProjectSessionPanelLayout } from "../../shared/project-session-panel-layout";

export const INITIAL_DATABASE_VIEW_SESSION_TITLE = "Database View";
export const INITIAL_DATABASE_VIEW_TAB_TITLE = "DB View";

export function seededPrimaryDatabaseViewId(projectId: string): string {
  return `database-view:${projectId}:primary-kanban`;
}

const DEFAULT_RIGHT_PANEL_WIDTH = 600;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 280;

export function makeInitialDatabaseViewPanelStateJson(tabId: string): string {
  return JSON.stringify(ProjectSessionPanelsSchema.parse({
    right: {
      collapsed: false,
      layout: makeProjectSessionPanelLayout([tabId], tabId),
      size: {
        widthPx: DEFAULT_RIGHT_PANEL_WIDTH,
        fullWidth: true,
      },
    },
    bottom: {
      collapsed: true,
      layout: makeProjectSessionPanelLayout([], null),
      size: {
        heightPx: DEFAULT_BOTTOM_PANEL_HEIGHT,
      },
    },
  }));
}

export function insertInitialDatabaseViewSession(
  database: Database.Database,
  projectId: string,
  databaseViewId: string,
  now: string,
  options: { shiftExisting?: boolean } = {},
): { sessionId: string; tabId: string } {
  const sessionId = randomUUID();
  const tabId = randomUUID();
  const shiftExisting = options.shiftExisting ?? true;

  if (shiftExisting) {
    database
      .prepare('UPDATE project_sessions SET "order" = "order" + 1, updated_at = ? WHERE project_id = ?')
      .run(now, projectId);
    database
      .prepare(`
        UPDATE project_sessions
        SET pinned_order = pinned_order + 1, updated_at = ?
        WHERE project_id = ? AND pinned = 1 AND pinned_order IS NOT NULL
      `)
      .run(now, projectId);
  }

  database.prepare(`
    INSERT INTO project_sessions (
      id, project_id, no_thread_fallback_title, "order", pinned, pinned_order, archived, archived_at, unread, left_pane_collapsed,
      panel_state_json, created_at, updated_at
    ) VALUES (?, ?, ?, 0, 1, 0, 0, NULL, 0, 1, ?, ?, ?)
  `).run(
    sessionId,
    projectId,
    INITIAL_DATABASE_VIEW_SESSION_TITLE,
    makeInitialDatabaseViewPanelStateJson(tabId),
    now,
    now,
  );

  insertDatabaseViewTab(database, {
    sessionId,
    projectId,
    databaseViewId,
    tabId,
    now,
  });

  return { sessionId, tabId };
}

export function insertDatabaseViewTab(
  database: Database.Database,
  input: {
    sessionId: string;
    projectId: string;
    databaseViewId: string;
    tabId: string;
    now: string;
  },
): void {
  database.prepare(`
    INSERT INTO project_session_tabs (
      id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json, "order", created_at, updated_at
    ) VALUES (?, ?, ?, 'right', 'db_view', ?, ?, 0, '{}', 0, ?, ?)
  `).run(
    input.tabId,
    input.sessionId,
    input.projectId,
    INITIAL_DATABASE_VIEW_TAB_TITLE,
    JSON.stringify({
      projectId: input.projectId,
      databaseViewId: input.databaseViewId,
      view: "kanban",
    }),
    input.now,
    input.now,
  );
}
