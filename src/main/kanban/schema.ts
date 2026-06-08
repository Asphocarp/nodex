import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { getDatabasePath } from "./config";
import type { DatabaseMigrationProgress } from "../../shared/app-startup";
import { CARD_STATUS_COLUMNS } from "../../shared/card-status";

export const COLUMNS = CARD_STATUS_COLUMNS;

export const CURRENT_SCHEMA_VERSION = 31;
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
  if (currentVersion === 26) return [31];
  if (currentVersion === 30) return [31];
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
      panel_state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (is_overview IN (0, 1)),
      CHECK (left_pane_collapsed IN (0, 1))
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

function makePanelStateJson(input: {
  rightTabIds: string[];
  bottomTabIds: string[];
  overview: boolean;
}): string {
  return JSON.stringify({
    right: {
      collapsed: false,
      layout: makePanelLayout(input.rightTabIds, input.rightTabIds[0] ?? null),
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
      id, project_id, title, is_overview, "order", left_pane_collapsed,
      panel_state_json, created_at, updated_at
    ) VALUES (?, ?, ?, 1, 0, 1, ?, ?, ?)
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
      insertSession.run(
        sessionId,
        project.id,
        "Overview",
        makePanelStateJson({
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

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .some((column) => column.name === columnName);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function migrateMainSchema26To31(db: Database.Database): void {
  createLatestSchema(db);

  if (tableExists(db, "codex_card_threads")) {
    if (!tableHasColumn(db, "codex_card_threads", "parent_thread_id")) {
      db.exec("ALTER TABLE codex_card_threads ADD COLUMN parent_thread_id TEXT");
    }

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

      DROP TABLE codex_card_threads;
    `);
  }

  setUserVersion(db, 31);
}

function migrateSchema30To31(db: Database.Database): void {
  if (!tableHasColumn(db, "project_sessions", "right_pane_collapsed")) {
    setUserVersion(db, 31);
    return;
  }

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      DROP TABLE IF EXISTS project_sessions_next;

      CREATE TABLE project_sessions_next (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        is_overview INTEGER NOT NULL DEFAULT 0,
        "order" INTEGER NOT NULL,
        left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
        panel_state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (is_overview IN (0, 1)),
        CHECK (left_pane_collapsed IN (0, 1))
      );

      INSERT INTO project_sessions_next (
        id, project_id, title, is_overview, "order", left_pane_collapsed,
        panel_state_json, created_at, updated_at
      )
      SELECT
        id, project_id, title, is_overview, "order", left_pane_collapsed,
        panel_state_json, created_at, updated_at
      FROM project_sessions;

      DROP TABLE project_sessions;
      ALTER TABLE project_sessions_next RENAME TO project_sessions;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_sessions_overview
        ON project_sessions(project_id)
        WHERE is_overview = 1;
      CREATE INDEX IF NOT EXISTS idx_project_sessions_project_order
        ON project_sessions(project_id, "order", created_at);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  setUserVersion(db, 31);
}

function migrateToSchema31(db: Database.Database, currentVersion: number): void {
  if (currentVersion === 26) {
    migrateMainSchema26To31(db);
    return;
  }

  if (currentVersion === 30) {
    migrateSchema30To31(db);
    return;
  }

  throw new Error(`Unsupported Nodex database migration target 31 from ${currentVersion}`);
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
    if (target === 31) {
      migrateToSchema31(db, currentVersion);
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
