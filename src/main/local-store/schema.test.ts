import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { closeDatabase, getDb, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { resetAssetPathCacheForTests } from "./assets";
import { LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER } from "./block-first-legacy-schema";
import { makeDefaultBrowserSidebarTabId } from "../../shared/browser-sidebar";
import {
  CURRENT_SCHEMA_VERSION,
  PREVIOUS_SCHEMA_VERSION,
  SHIPPED_SCHEMA_VERSION,
  getSchemaMigrationTargets,
  migrateSchema58To59,
  migrateSchema59To60,
} from "./schema";

const tempDirectories: string[] = [];

const useTempStore = (): string => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v59-"));
  tempDirectories.push(directory);
  process.env.NODEX_DIR = directory;
  return directory;
};

const tableNames = (database: Database.Database): ReadonlySet<string> =>
  new Set(
    (
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        )
        .all() as readonly { readonly name: string }[]
    ).map((row) => row.name),
  );

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createSchema58MigrationFixture = (
  database: Database.Database,
  options: { readonly orphanedBrowserTab?: boolean } = {},
): void => {
  database.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE codex_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      thread_name TEXT,
      thread_source TEXT
    ) WITHOUT ROWID;
    CREATE TABLE project_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE
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
      CHECK (kind IN ('db_view', 'card_stage', 'terminal', 'browser', 'review', 'files')),
      CHECK (panel_id IN ('right', 'bottom'))
    );
    CREATE INDEX idx_project_session_tabs_session_order
      ON project_session_tabs(session_id, panel_id, "order", created_at);
    CREATE INDEX idx_project_session_tabs_project
      ON project_session_tabs(project_id);

    INSERT INTO projects (id) VALUES ('project-1');
    INSERT INTO codex_threads (thread_id, project_id, thread_name)
      VALUES ('thread-1', 'project-1', 'Thread');
    INSERT INTO project_sessions (id, project_id)
      VALUES ('session-1', 'project-1');
  `);
  database
    .prepare(
      `INSERT INTO project_session_tabs (
         id, session_id, project_id, panel_id, kind, title, config_json,
         state_key, state_json, "order", created_at, updated_at
       ) VALUES (?, ?, 'project-1', 'right', ?, ?, '{}', 0, '{}', ?, ?, ?)`,
    )
    .run(
      "browser-a",
      options.orphanedBrowserTab ? "missing-session" : "session-1",
      "browser",
      "Browser A",
      0,
      "2026-07-14T00:00:00.000Z",
      "2026-07-14T00:00:00.000Z",
    );
  if (!options.orphanedBrowserTab) {
    const insertTab = database.prepare(
      `INSERT INTO project_session_tabs (
         id, session_id, project_id, panel_id, kind, title, config_json,
         state_key, state_json, "order", created_at, updated_at
       ) VALUES (?, 'session-1', 'project-1', 'right', ?, ?, '{}', 0, '{}', ?, ?, ?)`,
    );
    insertTab.run(
      "browser-b",
      "browser",
      "Browser B",
      1,
      "2026-07-14T00:00:01.000Z",
      "2026-07-14T00:00:01.000Z",
    );
    insertTab.run(
      "files-a",
      "files",
      "Files",
      2,
      "2026-07-14T00:00:02.000Z",
      "2026-07-14T00:00:02.000Z",
    );
  }
  database.pragma(`user_version = ${SHIPPED_SCHEMA_VERSION}`);
};

describe("schema v60 release boundary", () => {
  test("routes shipped inputs through the explicit staged boundaries", () => {
    expect(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION)).toEqual([]);
    expect(getSchemaMigrationTargets(SHIPPED_SCHEMA_VERSION)).toEqual([
      PREVIOUS_SCHEMA_VERSION,
      CURRENT_SCHEMA_VERSION,
    ]);
    expect(getSchemaMigrationTargets(26)).toEqual([
      SHIPPED_SCHEMA_VERSION,
      PREVIOUS_SCHEMA_VERSION,
      CURRENT_SCHEMA_VERSION,
    ]);
    expect(getSchemaMigrationTargets(57)).toEqual([
      SHIPPED_SCHEMA_VERSION,
      PREVIOUS_SCHEMA_VERSION,
      CURRENT_SCHEMA_VERSION,
    ]);
    expect(getSchemaMigrationTargets(PREVIOUS_SCHEMA_VERSION)).toEqual([
      CURRENT_SCHEMA_VERSION,
    ]);
    expect(getSchemaMigrationTargets(0)).toBe(null);
    expect(getSchemaMigrationTargets(999)).toBe(null);
  });

  test("creates the current store without compatibility tables", async () => {
    useTempStore();
    await initializeDatabase();
    await initializeDatabase();

    const database = getDb();
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
    const names = tableNames(database);
    for (const tableName of [
      "blocks",
      "documents",
      "block_documents",
      "document_updates",
      "canvas_scenes",
      "canvas_scene_elements",
      "canvas_scene_files",
      "canvas_scene_mutation_receipts",
      "database_capabilities",
      "database_memberships",
      "database_views",
      "card_read_model",
      "retired_block_identities",
      "codex_unread_threads",
      "codex_project_thread_orders",
      "codex_sidebar_chat_order",
    ]) {
      expect(names.has(tableName)).toBe(true);
    }
    for (const tableName of LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER) {
      expect(names.has(tableName)).toBe(false);
    }
    const tabColumns = database.pragma(
      "table_info(project_session_tabs)",
    ) as Array<{ name: string; notnull: number }>;
    expect(tabColumns.some((column) => column.name === "browser_tab_id")).toBe(
      true,
    );
    expect(
      tabColumns.find((column) => column.name === "project_id")?.notnull,
    ).toBe(0);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(database.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
  });

  test("rejects an unreleased development schema without mutating it", async () => {
    useTempStore();
    const database = new Database(getDatabasePath());
    database.pragma("user_version = 999");
    database.close();

    await expect(initializeDatabase()).rejects.toThrow(
      "Unsupported Nodex database schema version 999",
    );
    const unchanged = new Database(getDatabasePath(), { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(999);
    unchanged.close();
  });

  test("migrates v58 state to v59 without losing thread or panel identity", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    createSchema58MigrationFixture(database);

    migrateSchema58To59(database);

    expect(database.pragma("user_version", { simple: true })).toBe(
      PREVIOUS_SCHEMA_VERSION,
    );
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    const names = tableNames(database);
    expect(names.has("codex_unread_threads")).toBe(true);
    expect(names.has("codex_project_thread_orders")).toBe(true);
    expect(names.has("codex_sidebar_chat_order")).toBe(true);
    const threadColumns = database.pragma("table_info(codex_threads)") as Array<{
      name: string;
    }>;
    expect(threadColumns.some((column) => column.name === "forked_from_id")).toBe(
      true,
    );
    expect(threadColumns.some((column) => column.name === "service_name")).toBe(
      true,
    );
    expect(
      database
        .prepare(
          `SELECT id, project_id, browser_tab_id
           FROM project_session_tabs ORDER BY "order", id`,
        )
        .all(),
    ).toEqual([
      {
        id: "browser-a",
        project_id: "project-1",
        browser_tab_id: makeDefaultBrowserSidebarTabId("session-1"),
      },
      {
        id: "browser-b",
        project_id: "project-1",
        browser_tab_id: "browser-b",
      },
      { id: "files-a", project_id: "project-1", browser_tab_id: null },
    ]);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    database.close();
  });

  test("publishes a clean v59 store as v60", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    database.pragma(`user_version = ${PREVIOUS_SCHEMA_VERSION}`);

    migrateSchema59To60(database);

    expect(database.pragma("user_version", { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
  });

  test("rolls back every v59 schema change when source integrity fails", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = OFF");
    createSchema58MigrationFixture(database, { orphanedBrowserTab: true });

    expect(() => migrateSchema58To59(database)).toThrow(
      "Schema v59 migration produced 1 foreign-key violation(s)",
    );

    expect(database.pragma("user_version", { simple: true })).toBe(
      SHIPPED_SCHEMA_VERSION,
    );
    expect(tableNames(database).has("codex_unread_threads")).toBe(false);
    const threadColumns = database.pragma("table_info(codex_threads)") as Array<{
      name: string;
    }>;
    expect(threadColumns.some((column) => column.name === "forked_from_id")).toBe(
      false,
    );
    const tabColumns = database.pragma(
      "table_info(project_session_tabs)",
    ) as Array<{ name: string }>;
    expect(tabColumns.some((column) => column.name === "browser_tab_id")).toBe(
      false,
    );
    database.close();
  });
});
