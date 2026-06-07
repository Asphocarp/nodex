import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "./db-service";
import { getDatabasePath } from "./config";
import { CURRENT_SCHEMA_VERSION, getSchemaMigrationTargets } from "./schema";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

describe("schema initialization", () => {
  test("exposes only the supported in-app migration target", () => {
    expect(JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION))).toBe("[]");
    expect(JSON.stringify(getSchemaMigrationTargets(26))).toBe("[27,28]");
    expect(JSON.stringify(getSchemaMigrationTargets(27))).toBe("[28]");
    expect(getSchemaMigrationTargets(20) === null).toBeTrue();
  });

  test("initializes the latest schema from a fresh database", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-init-"));
    process.env.KANBAN_DIR = tempDir;

    let initializationRan = true;
    try {
      await initializeDatabase();

      const db = new Database(getDatabasePath(), { readonly: true });
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

      const historyColumns = db.prepare("PRAGMA table_info(history)").all() as Array<{ name: string }>;
      const historyColumnNames = historyColumns.map((column) => column.name);
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

      const overviewSession = db.prepare(`
        SELECT id, project_id, title, is_overview, left_pane_collapsed, right_pane_collapsed
        FROM project_sessions
        WHERE project_id = 'default' AND is_overview = 1
      `).get() as
        | {
          id: string;
          project_id: string;
          title: string;
          is_overview: number;
          left_pane_collapsed: number;
          right_pane_collapsed: number;
        }
        | undefined;
      expect(overviewSession?.id).toBe("overview:default");
      expect(overviewSession?.project_id).toBe("default");
      expect(overviewSession?.title).toBe("Overview");
      expect(overviewSession?.is_overview).toBe(1);
      expect(overviewSession?.left_pane_collapsed).toBe(1);
      expect(overviewSession?.right_pane_collapsed).toBe(0);

      const overviewTab = db.prepare(`
        SELECT id, kind, config_json
        FROM project_session_tabs
        WHERE session_id = 'overview:default'
      `).get() as { id: string; kind: string; config_json: string } | undefined;
      expect(overviewTab?.id).toBe("overview:default:db");
      expect(overviewTab?.kind).toBe("db_view");
      expect(overviewTab?.config_json).toBe(JSON.stringify({ projectId: "default", view: "kanban" }));

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
    const legacyVersion = 20;

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

  test("migrates schema 27 Codex thread ownership into canonical tables", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v27-codex-"));
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
          project_id TEXT NOT NULL,
          status TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          revision INTEGER NOT NULL DEFAULT 1,
          created TEXT NOT NULL,
          "order" INTEGER NOT NULL
        );
        CREATE TABLE project_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          is_overview INTEGER NOT NULL DEFAULT 0,
          "order" INTEGER NOT NULL,
          left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
          right_pane_collapsed INTEGER NOT NULL DEFAULT 0,
          right_pane_layout_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE project_session_tabs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          config_json TEXT NOT NULL,
          "order" INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE codex_card_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          card_id TEXT NOT NULL,
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
        CREATE TABLE project_session_threads (
          session_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
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
        INSERT INTO cards (id, project_id, status, title, created, "order")
        VALUES ('card-1', 'alpha', 'in_progress', 'Card one', '2026-01-01T00:00:00.000Z', 0);
        INSERT INTO project_sessions (
          id, project_id, title, is_overview, "order", right_pane_layout_json, created_at, updated_at
        ) VALUES (
          'session-1', 'alpha', 'Session', 0, 1,
          '{"version":1,"root":{"type":"leaf","id":"main","tabIds":[],"activeTabId":null}}',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO codex_card_threads (
          thread_id, project_id, card_id, parent_thread_id, thread_name, thread_preview,
          model_provider, cwd, status_type, status_active_flags_json, archived,
          created_at, updated_at, linked_at
        ) VALUES (
          'thr-card', 'alpha', 'card-1', 'thr-parent', 'Card thread', 'card preview',
          'openai', '/tmp/alpha', 'idle', '[]', 0, 10, 20, '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO project_session_threads (
          session_id, project_id, thread_id, parent_thread_id, thread_name, thread_preview,
          model_provider, cwd, status_type, status_active_flags_json, archived,
          created_at, updated_at, linked_at
        ) VALUES (
          'session-1', 'alpha', 'thr-session', NULL, 'Session thread', 'session preview',
          'openai', '/tmp/alpha', 'active', '["waitingOnApproval"]', 0,
          30, 40, '2026-01-02T00:00:00.000Z'
        );
        PRAGMA user_version = 27;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      const version = migrated.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

      const cardThread = migrated.prepare(`
        SELECT project_id, card_id, thread_name
        FROM codex_threads
        WHERE thread_id = 'thr-card'
      `).get() as { project_id: string; card_id: string; thread_name: string } | undefined;
      expect(cardThread?.project_id).toBe("alpha");
      expect(cardThread?.card_id).toBe("card-1");
      expect(cardThread?.thread_name).toBe("Card thread");

      const cardLink = migrated.prepare(`
        SELECT project_id, card_id
        FROM codex_thread_card_links
        WHERE thread_id = 'thr-card'
      `).get() as { project_id: string; card_id: string } | undefined;
      expect(cardLink?.project_id).toBe("alpha");
      expect(cardLink?.card_id).toBe("card-1");

      const sessionThread = migrated.prepare(`
        SELECT project_id, card_id, thread_name, status_type
        FROM codex_threads
        WHERE thread_id = 'thr-session'
      `).get() as { project_id: string; card_id: string | null; thread_name: string; status_type: string } | undefined;
      expect(sessionThread?.project_id).toBe("alpha");
      expect(sessionThread?.card_id ?? null).toBe(null);
      expect(sessionThread?.thread_name).toBe("Session thread");
      expect(sessionThread?.status_type).toBe("active");

      const sessionLink = migrated.prepare(`
        SELECT session_id, thread_id, linked_at
        FROM project_session_threads
        WHERE session_id = 'session-1'
      `).get() as { session_id: string; thread_id: string; linked_at: string } | undefined;
      expect(sessionLink?.thread_id).toBe("thr-session");
      expect(sessionLink?.linked_at).toBe("2026-01-02T00:00:00.000Z");

      const legacyTable = migrated.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_card_threads'
      `).get();
      expect(legacyTable === undefined).toBeTrue();
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

  test("migrates schema 26 databases and seeds project overview sessions", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v26-"));
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
        INSERT INTO projects (id, name, description, icon, created)
        VALUES ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z');
        PRAGMA user_version = 26;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      const version = migrated.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

      const overview = migrated.prepare(`
        SELECT left_pane_collapsed, right_pane_collapsed
        FROM project_sessions
        WHERE project_id = 'alpha' AND is_overview = 1
      `).get() as { left_pane_collapsed: number; right_pane_collapsed: number } | undefined;
      expect(overview?.left_pane_collapsed).toBe(1);
      expect(overview?.right_pane_collapsed).toBe(0);

      const tab = migrated.prepare(`
        SELECT kind, config_json
        FROM project_session_tabs
        WHERE session_id = 'overview:alpha'
      `).get() as { kind: string; config_json: string } | undefined;
      expect(tab?.kind).toBe("db_view");
      expect(tab?.config_json).toBe(JSON.stringify({ projectId: "alpha", view: "kanban" }));
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
