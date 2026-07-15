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
  SHIPPED_SCHEMA_VERSION,
  getReleaseSchemaVersions,
  getSchemaMigrationTargets,
  migrateSchema58To59,
  migrateSchema59To60,
  migrateSchema60To61,
  migrateSchema61To62,
  migrateSchema62To63,
} from "./schema";
import {
  createProjectSession,
  createProjectSessionTab,
  upsertProjectSessionThreadLink,
} from "./project-sessions";
import { createProject } from "./projects";
import { createCard } from "./cards";

const tempDirectories: string[] = [];

const useTempStore = (): string => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v63-"));
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

describe("schema v63 release boundary", () => {
  test("derives supported versions and targets from one ordered release chain", () => {
    const releaseVersions = getReleaseSchemaVersions();
    expect(releaseVersions).toEqual([58, 59, 60, 61, 62, 63]);
    for (const [index, version] of releaseVersions.entries()) {
      expect(getSchemaMigrationTargets(version)).toEqual(
        releaseVersions.slice(index + 1),
      );
    }
    expect(getSchemaMigrationTargets(26)).toEqual(releaseVersions);
    expect(getSchemaMigrationTargets(57)).toEqual(releaseVersions);
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

  test.each([58, 59, 60, 61, 62])(
    "runs the ordered release chain from schema v%i",
    async (sourceVersion) => {
      useTempStore();
      await initializeDatabase();
      getDb().pragma(`user_version = ${sourceVersion}`);
      closeDatabase();

      await initializeDatabase();

      expect(getDb().pragma("user_version", { simple: true })).toBe(
        CURRENT_SCHEMA_VERSION,
      );
    },
  );

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

    expect(database.pragma("user_version", { simple: true })).toBe(59);
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
    database.pragma("user_version = 59");

    migrateSchema59To60(database);

    expect(database.pragma("user_version", { simple: true })).toBe(60);
  });

  test("publishes a clean v60 store as v61", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    database.pragma("user_version = 60");

    migrateSchema60To61(database);

    expect(database.pragma("user_version", { simple: true })).toBe(61);
  });

  test("repairs duplicate thread owners before enforcing one session owner per thread", async () => {
    useTempStore();
    await initializeDatabase();

    const database = getDb();
    const project = database
      .prepare("SELECT id FROM projects ORDER BY created ASC, id ASC LIMIT 1")
      .get() as { id: string };
    const canonicalSession = createProjectSession({
      projectId: project.id,
      noThreadFallbackTitle: "Original session",
    });
    upsertProjectSessionThreadLink({
      sessionId: canonicalSession.id,
      projectId: project.id,
      threadId: "thread:duplicate-owner",
      threadName: "Duplicate owner thread",
    });
    createProjectSessionTab({
      sessionId: canonicalSession.id,
      projectId: project.id,
      panelId: "right",
      kind: "terminal",
      title: "Terminal",
      config: {
        projectId: project.id,
        terminalSessionId: "terminal:canonical-owner",
      },
    });
    const redundantSession = createProjectSession({
      projectId: project.id,
      noThreadFallbackTitle: "Materialized shell",
    });

    database.exec("DROP INDEX idx_project_session_threads_thread");
    database.prepare(`
      INSERT INTO project_session_threads (session_id, thread_id, linked_at)
      VALUES (?, 'thread:duplicate-owner', '2026-01-01T00:00:00.000Z')
    `).run(redundantSession.id);
    database.pragma("user_version = 61");

    migrateSchema61To62(database);

    expect(database.pragma("user_version", { simple: true })).toBe(62);
    expect(
      database.prepare(`
        SELECT session_id AS sessionId
        FROM project_session_threads
        WHERE thread_id = 'thread:duplicate-owner'
      `).all(),
    ).toEqual([{ sessionId: canonicalSession.id }]);
    expect(
      database.prepare(`
        SELECT archived, unread, pinned
        FROM project_sessions
        WHERE id = ?
      `).get(redundantSession.id),
    ).toEqual({ archived: 1, unread: 0, pinned: 0 });
    const threadIndex = (
      database.pragma("index_list(project_session_threads)") as Array<{
        name: string;
        unique: number;
      }>
    ).find((index) => index.name === "idx_project_session_threads_thread");
    expect(threadIndex?.unique).toBe(1);
    expect(() => database.prepare(`
      INSERT INTO project_session_threads (session_id, thread_id, linked_at)
      VALUES (?, 'thread:duplicate-owner', '2026-01-02T00:00:00.000Z')
    `).run(redundantSession.id)).toThrow(/UNIQUE constraint failed/u);
  });

  test("retires Card Agent properties atomically while preserving Card revisions and immutable evidence", async () => {
    useTempStore();
    await initializeDatabase();
    const project = createProject({ name: "Retired Agent properties" });
    const card = await createCard(project.id, "draft", { title: "Legacy Card" });
    const database = getDb();
    const metadataBefore = (
      database
        .prepare("SELECT metadata_revision FROM blocks WHERE id = ?")
        .get(card.id) as { readonly metadata_revision: number }
    ).metadata_revision;
    const evidenceBefore = {
      mutations: (
        database.prepare("SELECT COUNT(*) AS count FROM block_mutations").get() as {
          readonly count: number;
        }
      ).count,
      changes: (
        database.prepare("SELECT COUNT(*) AS count FROM change_log").get() as {
          readonly count: number;
        }
      ).count,
    };
    database.prepare(`
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type, value_json,
        revision, updated_at
      ) VALUES
        (?, ?, 'agent.blocked', 'boolean', 'true', 7, ?),
        (?, ?, 'agent.status', 'string', '"waiting"', 8, ?)
    `).run(
      card.id,
      project.id,
      "2026-07-15T00:00:00.000Z",
      card.id,
      project.id,
      "2026-07-15T00:00:00.000Z",
    );
    const projection = database.prepare(`
      SELECT intrinsic_properties_json, property_revisions_json
      FROM card_read_model
      WHERE card_block_id = ?
    `).get(card.id) as {
      readonly intrinsic_properties_json: string;
      readonly property_revisions_json: string;
    };
    const intrinsicValues = JSON.parse(
      projection.intrinsic_properties_json,
    ) as Record<string, unknown>;
    intrinsicValues["agent.blocked"] = true;
    intrinsicValues["agent.status"] = "waiting";
    const propertyRevisions = JSON.parse(
      projection.property_revisions_json,
    ) as { intrinsic: Record<string, number> };
    propertyRevisions.intrinsic["agent.blocked"] = 7;
    propertyRevisions.intrinsic["agent.status"] = 8;
    database.prepare(`
      UPDATE card_read_model
      SET intrinsic_properties_json = ?, property_revisions_json = ?
      WHERE card_block_id = ?
    `).run(
      JSON.stringify(intrinsicValues),
      JSON.stringify(propertyRevisions),
      card.id,
    );
    database.pragma("user_version = 62");

    expect(() =>
      migrateSchema62To63(database, {
        faultInjector: (point) => {
          if (point === "after_projection_rebuild") {
            throw new Error("fault:v63-finalizer");
          }
        },
      }),
    ).toThrow("fault:v63-finalizer");
    expect(database.pragma("user_version", { simple: true })).toBe(62);
    expect(
      database
        .prepare(
          `SELECT property_key FROM block_properties
           WHERE block_id = ? AND property_key LIKE 'agent.%'
           ORDER BY property_key`,
        )
        .all(card.id),
    ).toEqual([
      { property_key: "agent.blocked" },
      { property_key: "agent.status" },
    ]);

    migrateSchema62To63(database);

    expect(database.pragma("user_version", { simple: true })).toBe(63);
    expect(
      database
        .prepare(
          `SELECT property_key FROM block_properties
           WHERE property_key IN ('agent.blocked', 'agent.status')`,
        )
        .all(),
    ).toEqual([]);
    const rebuiltProjection = database.prepare(`
      SELECT intrinsic_properties_json, property_revisions_json
      FROM card_read_model
      WHERE card_block_id = ?
    `).get(card.id) as {
      readonly intrinsic_properties_json: string;
      readonly property_revisions_json: string;
    };
    const rebuiltIntrinsicKeys = Object.keys(
      JSON.parse(rebuiltProjection.intrinsic_properties_json),
    );
    const rebuiltIntrinsicRevisionKeys = Object.keys(
      (JSON.parse(rebuiltProjection.property_revisions_json) as {
        intrinsic: Record<string, number>;
      }).intrinsic,
    );
    for (const retiredKey of ["agent.blocked", "agent.status"]) {
      expect(rebuiltIntrinsicKeys).not.toContain(retiredKey);
      expect(rebuiltIntrinsicRevisionKeys).not.toContain(retiredKey);
    }
    expect(
      (
        database
          .prepare("SELECT metadata_revision FROM blocks WHERE id = ?")
          .get(card.id) as { readonly metadata_revision: number }
      ).metadata_revision,
    ).toBe(metadataBefore);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM block_mutations").get(),
    ).toEqual({ count: evidenceBefore.mutations });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM change_log").get(),
    ).toEqual({ count: evidenceBefore.changes });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("replaces the v62 Card projection trigger before rebuilding UTF-16 summaries", async () => {
    useTempStore();
    await initializeDatabase();
    const project = createProject({ name: "UTF-16 Card projection" });
    const card = await createCard(project.id, "draft", {
      title: "Emoji Card",
    });
    const database = getDb();
    const documentId = (
      database
        .prepare("SELECT document_id FROM block_documents WHERE block_id = ?")
        .get(card.id) as { readonly document_id: string }
    ).document_id;

    database.prepare(`
      UPDATE document_materializations
      SET nfm = '😀', preview = '😀'
      WHERE document_id = ?
    `).run(documentId);
    database.exec(`
      DROP TRIGGER card_read_model_validate_update;
      CREATE TRIGGER card_read_model_validate_update
        BEFORE UPDATE ON card_read_model
        WHEN NEW.description_length <> (
          SELECT length(materialization.nfm)
          FROM document_materializations materialization
          WHERE materialization.document_id = NEW.document_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'Card read model source coordinates are invalid or stale');
        END;
    `);
    database.pragma("user_version = 62");

    expect(() =>
      migrateSchema62To63(database, {
        faultInjector: (point) => {
          if (point === "after_projection_rebuild") {
            throw new Error("fault:utf16-projection-rebuild");
          }
        },
      }),
    ).toThrow("fault:utf16-projection-rebuild");
    expect(database.pragma("user_version", { simple: true })).toBe(62);
    expect(() =>
      database.prepare(`
        UPDATE card_read_model
        SET description_length = description_length
        WHERE card_block_id = ?
      `).run(card.id),
    ).toThrow("Card read model source coordinates are invalid or stale");

    migrateSchema62To63(database);

    expect(database.pragma("user_version", { simple: true })).toBe(63);
    expect(
      database.prepare(`
        SELECT description_preview, description_length, has_description
        FROM card_read_model
        WHERE card_block_id = ?
      `).get(card.id),
    ).toEqual({
      description_preview: "😀",
      description_length: "😀".length,
      has_description: 1,
    });
    expect(() =>
      database.prepare(`
        UPDATE card_read_model
        SET metadata_revision = metadata_revision + 1
        WHERE card_block_id = ?
      `).run(card.id),
    ).toThrow("Card read model source coordinates are invalid or stale");
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
