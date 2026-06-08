import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./db-service";
import { CURRENT_SCHEMA_VERSION, getSchemaMigrationTargets } from "./schema";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

function tableColumnNames(db: Database.Database, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

describe("schema initialization", () => {
  test("exposes only the supported in-app migration target", () => {
    expect(JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION))).toBe("[]");
    expect(JSON.stringify(getSchemaMigrationTargets(26))).toBe("[31,32]");
    expect(JSON.stringify(getSchemaMigrationTargets(30))).toBe("[31,32]");
    expect(JSON.stringify(getSchemaMigrationTargets(31))).toBe("[32]");
    expect(getSchemaMigrationTargets(29) === null).toBeTrue();
    expect(getSchemaMigrationTargets(20) === null).toBeTrue();
  });

  test("initializes the latest schema from a fresh database", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-init-"));
    process.env.KANBAN_DIR = tempDir;

    let initializationRan = true;
    try {
      await initializeDatabase();

      const db = new Database(getDatabasePath());
      const version = db.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

      const cardColumns = db.prepare("PRAGMA table_info(cards)").all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      const cardColumnNames = cardColumns.map((column) => column.name);
      expect(cardColumnNames.includes("revision")).toBeTrue();
      expect(cardColumnNames.includes("run_in_environment_path")).toBeTrue();
      expect(cardColumnNames.includes("description_revision_id")).toBeTrue();
      const priorityColumn = cardColumns.find((column) => column.name === "priority");
      expect(priorityColumn?.notnull).toBe(0);
      expect(priorityColumn?.dflt_value ?? null).toBe(null);

      const historyColumnNames = tableColumnNames(db, "history");
      expect(historyColumnNames.includes("previous_description_revision_id")).toBeTrue();
      expect(historyColumnNames.includes("snapshot_description_revision_id")).toBeTrue();

      const codexThreadColumns = db.prepare("PRAGMA table_info(codex_threads)").all() as Array<{
        name: string;
        pk: number;
        notnull: number;
      }>;
      const codexThreadColumnNames = codexThreadColumns.map((column) => column.name);
      expect(codexThreadColumnNames.includes("id")).toBeFalse();
      expect(codexThreadColumns.find((column) => column.name === "thread_id")?.pk).toBe(1);
      expect(codexThreadColumns.find((column) => column.name === "project_id")?.notnull).toBe(0);
      expect(codexThreadColumns.find((column) => column.name === "card_id")?.notnull).toBe(0);

      const codexTableSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_threads'
      `).get() as { sql: string } | undefined;
      expect((codexTableSql?.sql ?? "").includes("WITHOUT ROWID")).toBeTrue();

      const autoVacuum = db.prepare("PRAGMA auto_vacuum").get() as
        | { auto_vacuum: number }
        | undefined;
      expect(autoVacuum?.auto_vacuum).toBe(2);

      const projectCount = db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number };
      expect(projectCount.count).toBe(1);

      const tableRows = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
      `).all() as Array<{ name: string }>;
      const tableNames = tableRows.map((row) => row.name);
      expect(tableNames.includes("project_sessions")).toBeTrue();
      expect(tableNames.includes("project_session_tabs")).toBeTrue();
      expect(tableNames.includes("project_session_threads")).toBeTrue();
      expect(tableNames.includes("codex_thread_card_links")).toBeTrue();

      const sessionColumnNames = tableColumnNames(db, "project_sessions");
      expect(sessionColumnNames.includes("panel_state_json")).toBeTrue();
      expect(sessionColumnNames.includes("pinned")).toBeTrue();
      expect(sessionColumnNames.includes("pinned_order")).toBeTrue();
      expect(sessionColumnNames.includes("archived")).toBeTrue();
      expect(sessionColumnNames.includes("archived_at")).toBeTrue();
      expect(sessionColumnNames.includes("unread")).toBeTrue();
      const sessionSidebarIndex = db.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_project_sessions_project_sidebar'
      `).get();
      expect(sessionSidebarIndex !== undefined).toBeTrue();

      const sessionTabColumnNames = tableColumnNames(db, "project_session_tabs");
      expect(sessionTabColumnNames.includes("panel_id")).toBeTrue();
      expect(sessionTabColumnNames.includes("state_key")).toBeTrue();
      expect(sessionTabColumnNames.includes("state_json")).toBeTrue();

      let invalidPanelRejected = false;
      try {
        db.prepare(`
          INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title, config_json,
            state_key, state_json, "order", created_at, updated_at
          ) VALUES (
            'invalid-panel', 'overview:default', 'default', 'left', 'db_view', 'Invalid',
            '{"projectId":"default","view":"kanban"}', 0, '{}', 1,
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `).run();
      } catch {
        invalidPanelRejected = true;
      }
      expect(invalidPanelRejected).toBeTrue();

      const overviewSession = db.prepare(`
        SELECT id, project_id, title, is_overview, left_pane_collapsed, panel_state_json
        FROM project_sessions
        WHERE project_id = 'default' AND is_overview = 1
      `).get() as
        | {
          id: string;
          project_id: string;
          title: string;
          is_overview: number;
          left_pane_collapsed: number;
          panel_state_json: string;
        }
        | undefined;
      expect(overviewSession?.id).toBe("overview:default");
      expect(overviewSession?.project_id).toBe("default");
      expect(overviewSession?.title).toBe("Overview");
      expect(overviewSession?.is_overview).toBe(1);
      expect(overviewSession?.left_pane_collapsed).toBe(1);

      const overviewTab = db.prepare(`
        SELECT id, panel_id, kind, config_json
        FROM project_session_tabs
        WHERE session_id = 'overview:default'
      `).get() as { id: string; panel_id: string; kind: string; config_json: string } | undefined;
      expect(overviewTab?.id).toBe("overview:default:db");
      expect(overviewTab?.panel_id).toBe("right");
      expect(overviewTab?.kind).toBe("db_view");
      expect(overviewTab?.config_json).toBe(JSON.stringify({ projectId: "default", view: "kanban" }));

      const parsedPanelState = JSON.parse(overviewSession?.panel_state_json ?? "{}") as {
        right?: { collapsed?: boolean; size?: { fullWidth?: boolean } };
        bottom?: { collapsed?: boolean };
      };
      expect(parsedPanelState.right?.collapsed).toBeFalse();
      expect(parsedPanelState.right?.size?.fullWidth).toBeTrue();
      expect(parsedPanelState.bottom?.collapsed).toBeTrue();

      db.close();
    } catch (error) {
      if (isUnsupportedSqliteError(error)) {
        initializationRan = false;
      } else {
        throw error;
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("rejects explicit older schema versions", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-old-"));
    process.env.KANBAN_DIR = tempDir;
    const legacyVersion = 29;

    let initializationRan = true;
    try {
      const dbPath = getDatabasePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.exec(`PRAGMA user_version = ${legacyVersion}`);
      db.close();

      let message = "";
      try {
        await initializeDatabase();
      } catch (error) {
        message = (error as Error).message;
      }

      expect(
        message.includes(`Unsupported Nodex database schema version ${legacyVersion}`),
      ).toBeTrue();
    } catch (error) {
      if (isUnsupportedSqliteError(error)) {
        initializationRan = false;
      } else {
        throw error;
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates schema 30 by dropping right pane mirror columns", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v30-panels-"));
    process.env.KANBAN_DIR = tempDir;

    let initializationRan = true;
    try {
      const dbPath = getDatabasePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      const panelStateJson = JSON.stringify({
        right: {
          collapsed: false,
          layout: {
            version: 1,
            root: { type: "leaf", id: "main", tabIds: ["tab-review"], activeTabId: "tab-review" },
          },
          size: { widthPx: 620, fullWidth: false },
        },
        bottom: {
          collapsed: false,
          layout: {
            version: 1,
            root: { type: "leaf", id: "main", tabIds: ["tab-terminal"], activeTabId: "tab-terminal" },
          },
          size: { heightPx: 320 },
        },
      });
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          icon TEXT NOT NULL DEFAULT '',
          workspace_path TEXT,
          created TEXT NOT NULL
        );
        CREATE TABLE project_sessions (
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
        CREATE TABLE project_session_tabs (
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
          CHECK (kind IN ('db_view', 'card_stage', 'terminal', 'browser_placeholder', 'review', 'files_placeholder', 'side_chat_placeholder')),
          CHECK (panel_id IN ('right', 'bottom'))
        );
        CREATE INDEX idx_project_session_tabs_session_order
          ON project_session_tabs(session_id, panel_id, "order", created_at);

        INSERT INTO projects (id, name, description, icon, created)
        VALUES ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z');
      `);
      db.prepare(`
        INSERT INTO project_sessions (
          id, project_id, title, is_overview, "order", left_pane_collapsed,
          right_pane_collapsed, right_pane_layout_json, panel_state_json,
          created_at, updated_at
        ) VALUES (
          'session-1', 'alpha', 'Session', 0, 0, 0, 1,
          '{"version":1,"root":{"type":"leaf","id":"main","tabIds":[],"activeTabId":null}}',
          ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `).run(panelStateJson);
      db.exec(`
        INSERT INTO project_session_tabs (
          id, session_id, project_id, panel_id, kind, title, config_json,
          state_key, state_json, "order", created_at, updated_at
        ) VALUES
          (
            'tab-terminal', 'session-1', 'alpha', 'bottom', 'terminal', 'Terminal',
            '{"projectId":"alpha","terminalSessionId":"term-1"}', 2, '{"cwd":"/tmp/alpha"}', 0,
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          ),
          (
            'tab-review', 'session-1', 'alpha', 'right', 'review', 'Review',
            '{"projectId":"alpha"}', 0, '{}', 0,
            '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z'
          );
        PRAGMA user_version = 30;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      const version = migrated.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

      const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
      expect(sessionColumnNames.includes("panel_state_json")).toBeTrue();
      expect(sessionColumnNames.includes("right_pane_collapsed")).toBeFalse();
      expect(sessionColumnNames.includes("right_pane_layout_json")).toBeFalse();

      const stateRow = migrated.prepare(`
        SELECT left_pane_collapsed, panel_state_json
        FROM project_sessions
        WHERE id = 'session-1'
      `).get() as { left_pane_collapsed: number; panel_state_json: string } | undefined;
      expect(stateRow?.left_pane_collapsed).toBe(0);
      expect(stateRow?.panel_state_json).toBe(panelStateJson);

      const tabs = migrated.prepare(`
        SELECT id, panel_id, config_json, "order", state_key, state_json
        FROM project_session_tabs
        WHERE session_id = 'session-1'
        ORDER BY panel_id ASC, "order" ASC
      `).all() as Array<{
        id: string;
        panel_id: string;
        config_json: string;
        order: number;
        state_key: number;
        state_json: string;
      }>;
      expect(JSON.stringify(tabs)).toBe(JSON.stringify([
        {
          id: "tab-terminal",
          panel_id: "bottom",
          config_json: JSON.stringify({ projectId: "alpha", terminalSessionId: "term-1" }),
          order: 0,
          state_key: 2,
          state_json: JSON.stringify({ cwd: "/tmp/alpha" }),
        },
        {
          id: "tab-review",
          panel_id: "right",
          config_json: JSON.stringify({ projectId: "alpha" }),
          order: 0,
          state_key: 0,
          state_json: "{}",
        },
      ]));

      const foreignKeyProblems = migrated.prepare("PRAGMA foreign_key_check").all();
      expect(JSON.stringify(foreignKeyProblems)).toBe("[]");
      migrated.close();
    } catch (error) {
      if (isUnsupportedSqliteError(error)) {
        initializationRan = false;
      } else {
        throw error;
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates main branch schema 26 into project sessions", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v26-main-"));
    process.env.KANBAN_DIR = tempDir;

    let initializationRan = true;
    try {
      const dbPath = getDatabasePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          icon TEXT NOT NULL DEFAULT '',
          workspace_path TEXT,
          created TEXT NOT NULL
        );
        CREATE TABLE cards (
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
          "order" INTEGER NOT NULL
        );
        CREATE TABLE codex_card_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
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

        INSERT INTO projects (id, name, description, icon, workspace_path, created)
        VALUES ('alpha', 'Alpha', '', '', '/tmp/alpha', '2026-01-01T00:00:00.000Z');
        INSERT INTO cards (
          id, project_id, status, title, description, tags, created, "order"
        ) VALUES (
          'card-1', 'alpha', 'in_progress', 'Card one', '', '[]', '2026-01-01T00:00:00.000Z', 0
        );
        INSERT INTO codex_card_threads (
          thread_id, project_id, card_id, parent_thread_id, thread_name, thread_preview,
          model_provider, cwd, status_type, status_active_flags_json, archived,
          created_at, updated_at, linked_at
        ) VALUES (
          'thread-1', 'alpha', 'card-1', 'thread-parent', 'Card thread', 'preview',
          'openai', '/tmp/alpha', 'idle', '[]', 0, 10, 20, '2026-01-01T00:00:00.000Z'
        );
        PRAGMA user_version = 26;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      const version = migrated.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

      const legacyThreadTable = migrated.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_card_threads'
      `).get();
      expect(legacyThreadTable === undefined).toBeTrue();

      const thread = migrated.prepare(`
        SELECT project_id, card_id, parent_thread_id, thread_name
        FROM codex_threads
        WHERE thread_id = 'thread-1'
      `).get() as {
        project_id: string | null;
        card_id: string | null;
        parent_thread_id: string | null;
        thread_name: string | null;
      } | undefined;
      expect(thread?.project_id).toBe("alpha");
      expect(thread?.card_id).toBe("card-1");
      expect(thread?.parent_thread_id).toBe("thread-parent");
      expect(thread?.thread_name).toBe("Card thread");

      const cardLink = migrated.prepare(`
        SELECT project_id, card_id
        FROM codex_thread_card_links
        WHERE thread_id = 'thread-1'
      `).get() as { project_id: string; card_id: string } | undefined;
      expect(cardLink?.project_id).toBe("alpha");
      expect(cardLink?.card_id).toBe("card-1");

      const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
      expect(sessionColumnNames.includes("panel_state_json")).toBeTrue();
      expect(sessionColumnNames.includes("right_pane_collapsed")).toBeFalse();
      expect(sessionColumnNames.includes("right_pane_layout_json")).toBeFalse();

      const overview = migrated.prepare(`
        SELECT id, left_pane_collapsed, panel_state_json
        FROM project_sessions
        WHERE project_id = 'alpha' AND is_overview = 1
      `).get() as { id: string; left_pane_collapsed: number; panel_state_json: string } | undefined;
      expect(overview?.id).toBe("overview:alpha");
      expect(overview?.left_pane_collapsed).toBe(1);

      const panelState = JSON.parse(overview?.panel_state_json ?? "{}") as {
        right?: { collapsed?: boolean; size?: { fullWidth?: boolean } };
        bottom?: { collapsed?: boolean };
      };
      expect(panelState.right?.collapsed).toBeFalse();
      expect(panelState.right?.size?.fullWidth).toBeTrue();
      expect(panelState.bottom?.collapsed).toBeTrue();

      const overviewTab = migrated.prepare(`
        SELECT panel_id, kind, config_json
        FROM project_session_tabs
        WHERE session_id = 'overview:alpha'
      `).get() as { panel_id: string; kind: string; config_json: string } | undefined;
      expect(overviewTab?.panel_id).toBe("right");
      expect(overviewTab?.kind).toBe("db_view");
      expect(overviewTab?.config_json).toBe(JSON.stringify({ projectId: "alpha", view: "kanban" }));

      const foreignKeyProblems = migrated.prepare("PRAGMA foreign_key_check").all();
      expect(JSON.stringify(foreignKeyProblems)).toBe("[]");
      migrated.close();
    } catch (error) {
      if (isUnsupportedSqliteError(error)) {
        initializationRan = false;
      } else {
        throw error;
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });
});
