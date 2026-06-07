import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { getDatabasePath } from "./config";
import type { DatabaseMigrationProgress } from "../../shared/app-startup";
import { CARD_STATUS_COLUMNS } from "../../shared/card-status";

export const COLUMNS = CARD_STATUS_COLUMNS;

export const CURRENT_SCHEMA_VERSION = 30;
const PROJECT_SESSION_TAB_KIND_CHECK_VALUES =
  "'db_view', 'card_stage', 'terminal', 'browser_placeholder', 'review', 'files_placeholder', 'side_chat_placeholder'";
const PROJECT_SESSION_PANEL_ID_CHECK_VALUES = "'right', 'bottom'";

const RESETTABLE_TABLES = [
  "project_session_threads",
  "project_session_tabs",
  "project_sessions",
  "canvas",
  "reminder_snoozes",
  "reminder_receipts",
  "recurrence_exceptions",
  "history",
  "codex_thread_card_links",
  "codex_threads",
  "codex_card_threads",
  "description_revisions",
  "description_blocks",
  "cards",
  "projects",
  // Kept here so a versionless local file can still be reset safely.
  "recurrence_occurrence_log",
];

export interface EnsureDatabaseOptions {
  onMigrationProgress?: (progress: DatabaseMigrationProgress) => void;
}

export function getSchemaMigrationTargets(currentVersion: number): number[] | null {
  if (currentVersion === CURRENT_SCHEMA_VERSION) return [];
  if (currentVersion === 26) return [27, 28, 29, 30];
  if (currentVersion === 27) return [28, 29, 30];
  if (currentVersion === 28) return [29, 30];
  if (currentVersion === 29) return [30];
  return null;
}

function getUserVersion(db: Database.Database): number {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  return row?.user_version ?? 0;
}

function setUserVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

function createLatestSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      workspace_path TEXT,
      created TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      description_revision_id INTEGER,
      priority TEXT,
      estimate TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      due_date TEXT,
      assignee TEXT,
      agent_blocked INTEGER NOT NULL DEFAULT 0,
      agent_status TEXT,
      run_in_target TEXT NOT NULL DEFAULT 'local_project',
      run_in_local_path TEXT,
      run_in_base_branch TEXT,
      run_in_worktree_path TEXT,
      run_in_environment_path TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      scheduled_start TEXT,
      scheduled_end TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      recurrence_json TEXT,
      reminders_json TEXT NOT NULL DEFAULT '[]',
      schedule_timezone TEXT,
      created TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done')),
      CHECK (priority IS NULL OR priority IN ('p0-critical', 'p1-high', 'p2-medium', 'p3-low', 'p4-later')),
      CHECK (estimate IS NULL OR estimate IN ('xs', 's', 'm', 'l', 'xl'))
    );

    CREATE INDEX IF NOT EXISTS idx_cards_project_archived_status ON cards(project_id, archived, status);
    CREATE INDEX IF NOT EXISTS idx_cards_project_archived_status_order ON cards(project_id, archived, status, "order");
    CREATE INDEX IF NOT EXISTS idx_cards_schedule ON cards(project_id, scheduled_start, scheduled_end);

    CREATE TABLE IF NOT EXISTS description_blocks (
      hash TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS description_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      parent_revision_id INTEGER,
      kind TEXT NOT NULL,
      block_hashes_json TEXT,
      ops_json TEXT,
      created_at TEXT NOT NULL,
      CHECK (kind IN ('snapshot', 'delta'))
    );

    CREATE INDEX IF NOT EXISTS idx_description_revisions_card_created
      ON description_revisions(card_id, created_at, id);

    CREATE TABLE IF NOT EXISTS codex_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      thread_name TEXT,
      thread_preview TEXT NOT NULL DEFAULT '',
      model_provider TEXT NOT NULL DEFAULT '',
      cwd TEXT,
      status_type TEXT NOT NULL DEFAULT 'notLoaded',
      status_active_flags_json TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_threads_project_updated
      ON codex_threads(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_codex_threads_card_updated
      ON codex_threads(card_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS codex_thread_card_links (
      thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_thread_card_links_project_card
      ON codex_thread_card_links(project_id, card_id);
    CREATE INDEX IF NOT EXISTS idx_codex_thread_card_links_project
      ON codex_thread_card_links(project_id);

    CREATE TABLE IF NOT EXISTS project_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_overview INTEGER NOT NULL DEFAULT 0,
      "order" INTEGER NOT NULL,
      left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
      right_pane_collapsed INTEGER NOT NULL DEFAULT 0,
      right_pane_layout_json TEXT NOT NULL,
      panel_state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (is_overview IN (0, 1)),
      CHECK (left_pane_collapsed IN (0, 1)),
      CHECK (right_pane_collapsed IN (0, 1))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_sessions_overview
      ON project_sessions(project_id)
      WHERE is_overview = 1;
    CREATE INDEX IF NOT EXISTS idx_project_sessions_project_order
      ON project_sessions(project_id, "order", created_at);

    CREATE TABLE IF NOT EXISTS project_session_tabs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      panel_id TEXT NOT NULL DEFAULT 'right',
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL,
      state_key INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL DEFAULT '{}',
      "order" INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kind IN (${PROJECT_SESSION_TAB_KIND_CHECK_VALUES})),
      CHECK (panel_id IN (${PROJECT_SESSION_PANEL_ID_CHECK_VALUES}))
    );

    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_session_order
      ON project_session_tabs(session_id, panel_id, "order", created_at);
    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_project
      ON project_session_tabs(project_id);

    CREATE TABLE IF NOT EXISTS project_session_threads (
      session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_project_session_threads_thread
      ON project_session_threads(thread_id);

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      operation TEXT NOT NULL,
      card_id TEXT NOT NULL,
      status TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL,
      previous_values TEXT,
      new_values TEXT,
      from_status TEXT,
      to_status TEXT,
      from_archived INTEGER,
      to_archived INTEGER,
      from_order INTEGER,
      to_order INTEGER,
      card_snapshot TEXT,
      previous_description_revision_id INTEGER,
      new_description_revision_id INTEGER,
      snapshot_description_revision_id INTEGER,
      session_id TEXT,
      group_id TEXT,
      is_undone INTEGER NOT NULL DEFAULT 0,
      undo_of INTEGER,
      CHECK (operation IN ('create', 'update', 'delete', 'move')),
      CHECK (status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done')),
      CHECK (from_status IS NULL OR from_status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done')),
      CHECK (to_status IS NULL OR to_status IN ('draft', 'backlog', 'in_progress', 'in_review', 'done'))
    );

    CREATE INDEX IF NOT EXISTS idx_history_project ON history(project_id);
    CREATE INDEX IF NOT EXISTS idx_history_card ON history(card_id);
    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_history_session ON history(session_id);
    CREATE INDEX IF NOT EXISTS idx_history_group ON history(project_id, group_id);

    CREATE TABLE IF NOT EXISTS recurrence_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      occurrence_start TEXT NOT NULL,
      exception_type TEXT NOT NULL,
      override_start TEXT,
      override_end TEXT,
      override_reminders_json TEXT,
      created TEXT NOT NULL,
      CHECK (exception_type IN ('skip', 'override_time'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_recurrence_exceptions_unique
      ON recurrence_exceptions(project_id, card_id, occurrence_start);
    CREATE INDEX IF NOT EXISTS idx_recurrence_exceptions_lookup
      ON recurrence_exceptions(project_id, card_id, occurrence_start);

    CREATE TABLE IF NOT EXISTS reminder_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      occurrence_start TEXT NOT NULL,
      reminder_offset_minutes INTEGER NOT NULL,
      delivered_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_receipts_unique
      ON reminder_receipts(project_id, card_id, occurrence_start, reminder_offset_minutes);
    CREATE INDEX IF NOT EXISTS idx_reminder_receipts_lookup
      ON reminder_receipts(project_id, delivered_at DESC);

    CREATE TABLE IF NOT EXISTS reminder_snoozes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      occurrence_start TEXT NOT NULL,
      due_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reminder_snoozes_lookup
      ON reminder_snoozes(project_id, due_at, consumed_at);

    CREATE TABLE IF NOT EXISTS canvas (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      elements TEXT NOT NULL DEFAULT '[]',
      app_state TEXT NOT NULL DEFAULT '{}',
      files TEXT NOT NULL DEFAULT '{}',
      updated TEXT NOT NULL
    );
  `);
}

function makeOverviewSessionId(projectId: string): string {
  return `overview:${projectId}`;
}

function makeOverviewDbTabId(projectId: string): string {
  return `overview:${projectId}:db`;
}

function makeOverviewRightPaneLayout(tabId: string): string {
  return JSON.stringify({
    version: 1,
    root: {
      type: "leaf",
      id: "main",
      tabIds: [tabId],
      activeTabId: tabId,
    },
  });
}

function makePanelLayout(tabIds: string[], activeTabId: string | null): {
  version: 1;
  root: { type: "leaf"; id: string; tabIds: string[]; activeTabId: string | null };
} {
  return {
    version: 1,
    root: {
      type: "leaf",
      id: "main",
      tabIds,
      activeTabId,
    },
  };
}

function parseLayoutJson(value: string): ReturnType<typeof makePanelLayout> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === "object"
      && parsed !== null
      && "version" in parsed
      && parsed.version === 1
      && "root" in parsed
      && typeof parsed.root === "object"
      && parsed.root !== null
      && "type" in parsed.root
      && parsed.root.type === "leaf"
      && "tabIds" in parsed.root
      && Array.isArray(parsed.root.tabIds)
    ) {
      const root = parsed.root as { id?: unknown; tabIds: unknown[]; activeTabId?: unknown };
      return makePanelLayout(
        root.tabIds.filter((item): item is string => typeof item === "string"),
        typeof root.activeTabId === "string" ? root.activeTabId : null,
      );
    }
  } catch {
    return null;
  }
  return null;
}

function normalizePanelLayoutFromJson(value: string, tabIds: string[]): ReturnType<typeof makePanelLayout> {
  const parsed = parseLayoutJson(value);
  if (!parsed) return makePanelLayout(tabIds, tabIds[0] ?? null);

  const knownTabIds = new Set(tabIds);
  const layoutTabIds = parsed.root.tabIds.filter((tabId) => knownTabIds.has(tabId));
  for (const tabId of tabIds) {
    if (!layoutTabIds.includes(tabId)) layoutTabIds.push(tabId);
  }

  const activeTabId = parsed.root.activeTabId && knownTabIds.has(parsed.root.activeTabId)
    ? parsed.root.activeTabId
    : layoutTabIds[0] ?? null;

  return makePanelLayout(layoutTabIds, activeTabId);
}

function makePanelStateJson(input: {
  rightCollapsed: boolean;
  rightLayoutJson: string;
  rightTabIds: string[];
  bottomTabIds: string[];
  overview: boolean;
}): string {
  return JSON.stringify({
    right: {
      collapsed: input.rightCollapsed,
      layout: normalizePanelLayoutFromJson(input.rightLayoutJson, input.rightTabIds),
      size: {
        widthPx: 600,
        fullWidth: input.overview,
      },
    },
    bottom: {
      collapsed: input.bottomTabIds.length === 0,
      layout: makePanelLayout(input.bottomTabIds, input.bottomTabIds[0] ?? null),
      size: {
        heightPx: 280,
      },
    },
  });
}

function seedOverviewSessionsForAllProjects(db: Database.Database): void {
  const projects = db.prepare("SELECT id FROM projects ORDER BY created ASC").all() as Array<{ id: string }>;
  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO project_sessions (
      id, project_id, title, is_overview, "order", left_pane_collapsed, right_pane_collapsed,
      right_pane_layout_json, panel_state_json, created_at, updated_at
    ) VALUES (?, ?, ?, 1, 0, 1, 0, ?, ?, ?, ?)
  `);
  const insertTab = db.prepare(`
    INSERT OR IGNORE INTO project_session_tabs (
      id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json, "order", created_at, updated_at
    ) VALUES (?, ?, ?, 'right', 'db_view', 'DB View', ?, 0, '{}', 0, ?, ?)
  `);

  const seed = db.transaction(() => {
    const now = new Date().toISOString();
    for (const project of projects) {
      const sessionId = makeOverviewSessionId(project.id);
      const tabId = makeOverviewDbTabId(project.id);
      const rightLayoutJson = makeOverviewRightPaneLayout(tabId);
      insertSession.run(
        sessionId,
        project.id,
        "Overview",
        rightLayoutJson,
        makePanelStateJson({
          rightCollapsed: false,
          rightLayoutJson,
          rightTabIds: [tabId],
          bottomTabIds: [],
          overview: true,
        }),
        now,
        now,
      );
      insertTab.run(
        tabId,
        sessionId,
        project.id,
        JSON.stringify({ projectId: project.id, view: "kanban" }),
        now,
        now,
      );
    }
  });
  seed();
}

function migrateToSchema27(db: Database.Database): void {
  createLatestSchema(db);
  seedOverviewSessionsForAllProjects(db);
  setUserVersion(db, 27);
}

function migrateToSchema28(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS codex_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      thread_name TEXT,
      thread_preview TEXT NOT NULL DEFAULT '',
      model_provider TEXT NOT NULL DEFAULT '',
      cwd TEXT,
      status_type TEXT NOT NULL DEFAULT 'notLoaded',
      status_active_flags_json TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_threads_project_updated
      ON codex_threads(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_codex_threads_card_updated
      ON codex_threads(card_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS codex_thread_card_links (
      thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      linked_at TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_codex_thread_card_links_project_card
      ON codex_thread_card_links(project_id, card_id);
    CREATE INDEX IF NOT EXISTS idx_codex_thread_card_links_project
      ON codex_thread_card_links(project_id);
  `);

  const hasLegacyCardThreads = Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'codex_card_threads'
  `).get());
  const hasLegacySessionThreads = Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'project_session_threads'
  `).get());
  const legacySessionThreadColumns = hasLegacySessionThreads
    ? new Set((db.prepare("PRAGMA table_info(project_session_threads)").all() as Array<{ name: string }>)
      .map((column) => column.name))
    : new Set<string>();
  const hasSessionThreadMetadata =
    legacySessionThreadColumns.has("project_id") && legacySessionThreadColumns.has("parent_thread_id");

  if (hasLegacyCardThreads) {
    db.exec(`
      INSERT OR IGNORE INTO codex_threads (
        thread_id, project_id, card_id, parent_thread_id, thread_name, thread_preview,
        model_provider, cwd, status_type, status_active_flags_json, archived,
        created_at, updated_at, linked_at
      )
      SELECT
        thread_id, project_id, card_id, parent_thread_id, thread_name, thread_preview,
        model_provider, cwd, status_type, status_active_flags_json, archived,
        created_at, updated_at, linked_at
      FROM codex_card_threads;

      INSERT OR REPLACE INTO codex_thread_card_links (thread_id, project_id, card_id, linked_at)
      SELECT thread_id, project_id, card_id, linked_at
      FROM codex_card_threads;
    `);
  }

  if (hasLegacySessionThreads && hasSessionThreadMetadata) {
    db.exec(`
      INSERT OR IGNORE INTO codex_threads (
        thread_id, project_id, card_id, parent_thread_id, thread_name, thread_preview,
        model_provider, cwd, status_type, status_active_flags_json, archived,
        created_at, updated_at, linked_at
      )
      SELECT
        thread_id, project_id, NULL, parent_thread_id, thread_name, thread_preview,
        model_provider, cwd, status_type, status_active_flags_json, archived,
        created_at, updated_at, linked_at
      FROM project_session_threads;

      CREATE TABLE IF NOT EXISTS project_session_threads_next (
        session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
        linked_at TEXT NOT NULL
      ) WITHOUT ROWID;

      INSERT OR REPLACE INTO project_session_threads_next (session_id, thread_id, linked_at)
      SELECT session_id, thread_id, linked_at
      FROM project_session_threads;

      DROP TABLE project_session_threads;
      ALTER TABLE project_session_threads_next RENAME TO project_session_threads;
    `);
  } else if (!hasLegacySessionThreads) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_session_threads (
        session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
        linked_at TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_session_threads_thread
      ON project_session_threads(thread_id);
    DROP TABLE IF EXISTS codex_card_threads;
  `);
  setUserVersion(db, 28);
}

function migrateToSchema29(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS project_session_tabs_next;

    CREATE TABLE project_session_tabs_next (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kind IN (${PROJECT_SESSION_TAB_KIND_CHECK_VALUES}))
    );

    INSERT INTO project_session_tabs_next (
      id, session_id, project_id, kind, title, config_json, "order", created_at, updated_at
    )
    SELECT
      id, session_id, project_id, kind, title, config_json, "order", created_at, updated_at
    FROM project_session_tabs;

    DROP TABLE project_session_tabs;
    ALTER TABLE project_session_tabs_next RENAME TO project_session_tabs;

    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_session_order
      ON project_session_tabs(session_id, "order", created_at);
    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_project
      ON project_session_tabs(project_id);
  `);
  setUserVersion(db, 29);
}

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .some((column) => column.name === columnName);
}

function normalizeMigratedTerminalTabConfig(input: {
  id: string;
  sessionId: string;
  projectId: string;
  configJson: string;
}): string {
  try {
    const parsed = JSON.parse(input.configJson) as Record<string, unknown>;
    const projectId = typeof parsed.projectId === "string" && parsed.projectId.length > 0
      ? parsed.projectId
      : input.projectId;
    const legacyMode = typeof parsed.mode === "string" ? parsed.mode : "";
    const parsedTerminalSessionId = typeof parsed.terminalSessionId === "string" && parsed.terminalSessionId.length > 0
      ? parsed.terminalSessionId
      : "";
    const terminalSessionId = legacyMode === "card" || parsedTerminalSessionId.startsWith("card:")
      ? `session:${input.sessionId}:terminal:${input.id}`
      : parsedTerminalSessionId || `session:${input.sessionId}:terminal:${input.id}`;
    return JSON.stringify({ projectId, terminalSessionId });
  } catch {
    return JSON.stringify({
      projectId: input.projectId,
      terminalSessionId: `session:${input.sessionId}:terminal:${input.id}`,
    });
  }
}

function migrateToSchema30(db: Database.Database): void {
  db.exec(`
    DROP TABLE IF EXISTS project_session_tabs_next;

    CREATE TABLE project_session_tabs_next (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      panel_id TEXT NOT NULL DEFAULT 'right',
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL,
      state_key INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL DEFAULT '{}',
      "order" INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kind IN (${PROJECT_SESSION_TAB_KIND_CHECK_VALUES})),
      CHECK (panel_id IN (${PROJECT_SESSION_PANEL_ID_CHECK_VALUES}))
    );
  `);

  const tabRows = db.prepare(`
    SELECT id, session_id, project_id, kind, title, config_json, "order", created_at, updated_at
    FROM project_session_tabs
    ORDER BY session_id ASC, "order" ASC, created_at ASC
  `).all() as Array<{
    id: string;
    session_id: string;
    project_id: string;
    kind: string;
    title: string;
    config_json: string;
    order: number;
    created_at: string;
    updated_at: string;
  }>;
  const insertTab = db.prepare(`
    INSERT INTO project_session_tabs_next (
      id, session_id, project_id, panel_id, kind, title, config_json, state_key, state_json, "order", created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '{}', ?, ?, ?)
  `);
  const panelOrderBySession = new Map<string, number>();
  const insertTabs = db.transaction(() => {
    for (const row of tabRows) {
      const panelId = row.kind === "terminal" ? "bottom" : "right";
      const orderKey = `${row.session_id}:${panelId}`;
      const order = panelOrderBySession.get(orderKey) ?? 0;
      panelOrderBySession.set(orderKey, order + 1);
      insertTab.run(
        row.id,
        row.session_id,
        row.project_id,
        panelId,
        row.kind,
        row.title,
        row.kind === "terminal"
          ? normalizeMigratedTerminalTabConfig({
              id: row.id,
              sessionId: row.session_id,
              projectId: row.project_id,
              configJson: row.config_json,
            })
          : row.config_json,
        order,
        row.created_at,
        row.updated_at,
      );
    }
  });
  insertTabs();

  db.exec(`
    DROP TABLE project_session_tabs;
    ALTER TABLE project_session_tabs_next RENAME TO project_session_tabs;

    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_session_order
      ON project_session_tabs(session_id, panel_id, "order", created_at);
    CREATE INDEX IF NOT EXISTS idx_project_session_tabs_project
      ON project_session_tabs(project_id);
  `);

  if (!tableHasColumn(db, "project_sessions", "panel_state_json")) {
    db.exec("ALTER TABLE project_sessions ADD COLUMN panel_state_json TEXT NOT NULL DEFAULT '{}'");
  }

  const sessions = db.prepare(`
    SELECT id, is_overview, right_pane_collapsed, right_pane_layout_json
    FROM project_sessions
  `).all() as Array<{
    id: string;
    is_overview: number;
    right_pane_collapsed: number;
    right_pane_layout_json: string;
  }>;
  const tabsBySession = db.prepare(`
    SELECT id, panel_id
    FROM project_session_tabs
    WHERE session_id = ?
    ORDER BY panel_id ASC, "order" ASC, created_at ASC
  `);
  const updateSession = db.prepare(`
    UPDATE project_sessions
    SET panel_state_json = ?, updated_at = COALESCE(updated_at, ?)
    WHERE id = ?
  `);
  const updatePanelStates = db.transaction(() => {
    const now = new Date().toISOString();
    for (const session of sessions) {
      const tabs = tabsBySession.all(session.id) as Array<{ id: string; panel_id: string }>;
      const rightTabIds = tabs.filter((tab) => tab.panel_id === "right").map((tab) => tab.id);
      const bottomTabIds = tabs.filter((tab) => tab.panel_id === "bottom").map((tab) => tab.id);
      updateSession.run(
        makePanelStateJson({
          rightCollapsed: session.right_pane_collapsed === 1,
          rightLayoutJson: session.right_pane_layout_json,
          rightTabIds,
          bottomTabIds,
          overview: session.is_overview === 1,
        }),
        now,
        session.id,
      );
    }
  });
  updatePanelStates();

  setUserVersion(db, 30);
}

function runMigrations(
  db: Database.Database,
  currentVersion: number,
  targets: number[],
  options: EnsureDatabaseOptions,
): void {
  void currentVersion;
  for (const target of targets) {
    options.onMigrationProgress?.({
      type: "InProgress",
      value: targets.indexOf(target) / targets.length,
    });
    if (target === 27) {
      migrateToSchema27(db);
      continue;
    }
    if (target === 28) {
      migrateToSchema28(db);
      continue;
    }
    if (target === 29) {
      migrateToSchema29(db);
      continue;
    }
    if (target === 30) {
      migrateToSchema30(db);
      continue;
    }
    throw new Error(`Unsupported Nodex database migration target ${target}`);
  }
  options.onMigrationProgress?.({ type: "Done" });
}

function resetDatabaseToLatestSchema(db: Database.Database): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const tableName of RESETTABLE_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    }
    db.pragma("auto_vacuum = INCREMENTAL");
    createLatestSchema(db);
    setUserVersion(db, CURRENT_SCHEMA_VERSION);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function seedDefaultProjectIfMissing(db: Database.Database): void {
  const projectCount = db.prepare("SELECT COUNT(*) as count FROM projects").get() as {
    count: number;
  };
  if (projectCount.count > 0) return;

  db.prepare(
    "INSERT INTO projects (id, name, description, icon, created) VALUES (?, ?, ?, ?, ?)",
  ).run("default", "Default", "", "", new Date().toISOString());
}

export function ensureDatabase(options: EnsureDatabaseOptions = {}): void {
  const dbPath = getDatabasePath();
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const currentVersion = getUserVersion(db);
    if (currentVersion === 0) {
      resetDatabaseToLatestSchema(db);
    } else {
      const targets = getSchemaMigrationTargets(currentVersion);
      if (targets === null) {
        throw new Error(
          `Unsupported Nodex database schema version ${currentVersion}. Expected ${CURRENT_SCHEMA_VERSION}. Delete or recreate the local database if you want a fresh start.`,
        );
      }
      runMigrations(db, currentVersion, targets, options);
    }

    db.exec("DROP TABLE IF EXISTS codex_thread_snapshots");
    seedDefaultProjectIfMissing(db);
    seedOverviewSessionsForAllProjects(db);
  } finally {
    db.close();
  }
}
