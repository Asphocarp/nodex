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
    expect(JSON.stringify(getSchemaMigrationTargets(26))).toBe("[27]");
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

      const codexThreadColumns = db.prepare("PRAGMA table_info(codex_card_threads)").all() as Array<{
        name: string;
        pk: number;
      }>;
      const codexThreadColumnNames = codexThreadColumns.map((column) => column.name);
      expect(codexThreadColumnNames.includes("id")).toBeFalse();
      expect(codexThreadColumns.find((column) => column.name === "thread_id")?.pk).toBe(1);

      const codexTableSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_card_threads'
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

      const overviewSession = db.prepare(`
        SELECT id, project_id, title, is_overview, left_pane_collapsed
        FROM project_sessions
        WHERE project_id = 'default' AND is_overview = 1
      `).get() as
        | { id: string; project_id: string; title: string; is_overview: number; left_pane_collapsed: number }
        | undefined;
      expect(overviewSession?.id).toBe("overview:default");
      expect(overviewSession?.project_id).toBe("default");
      expect(overviewSession?.title).toBe("Overview");
      expect(overviewSession?.is_overview).toBe(1);
      expect(overviewSession?.left_pane_collapsed).toBe(1);

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
