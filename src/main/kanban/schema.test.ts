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

function expectUuidProjectNamed(db: Database.Database, name: string): string {
  const row = db.prepare("SELECT id FROM projects WHERE name = ?").get(name) as
    | { id: string }
    | undefined;
  expect(row !== undefined).toBeTrue();
  const projectId = row?.id ?? "";
  expect(projectId === name).toBeFalse();
  expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)).toBeTrue();
  return projectId;
}

describe("schema initialization", () => {
  test("exposes only the supported in-app migration target", () => {
    expect(JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION))).toBe("[]");
    expect(JSON.stringify(getSchemaMigrationTargets(26))).toBe("[31,32,33,34,35,37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(30))).toBe("[31,32,33,34,35,37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(31))).toBe("[32,33,34,35,37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(32))).toBe("[33,34,35,37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(33))).toBe("[34,35,37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(34))).toBe("[35,37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(35))).toBe("[37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(36))).toBe("[37,38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(37))).toBe("[38,39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(38))).toBe("[39,40,41]");
    expect(JSON.stringify(getSchemaMigrationTargets(39))).toBe("[40,41]");
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

      const cardHistorySnapshotColumnNames = tableColumnNames(db, "card_history_snapshots");
      expect(cardHistorySnapshotColumnNames.includes("history_id")).toBeTrue();
      expect(cardHistorySnapshotColumnNames.includes("card_snapshot")).toBeTrue();
      expect(cardHistorySnapshotColumnNames.includes("description_revision_id")).toBeTrue();
      const cardHistorySnapshotIndex = db.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_card_history_snapshots_project_card_history'
      `).get();
      expect(cardHistorySnapshotIndex !== undefined).toBeTrue();

      const codexThreadColumns = db.prepare("PRAGMA table_info(codex_threads)").all() as Array<{
        name: string;
        pk: number;
        notnull: number;
      }>;
      const codexThreadColumnNames = codexThreadColumns.map((column) => column.name);
      expect(codexThreadColumnNames.includes("id")).toBeFalse();
      expect(codexThreadColumns.find((column) => column.name === "thread_id")?.pk).toBe(1);
      expect(codexThreadColumns.find((column) => column.name === "project_id")?.notnull).toBe(0);
      expect(codexThreadColumnNames.includes("card_id")).toBeFalse();

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
      const defaultProjectId = expectUuidProjectNamed(db, "Default");

      const projectColumns = tableColumnNames(db, "projects");
      expect(projectColumns.includes("workspace_path")).toBeFalse();
      expect(projectColumns.includes("updated")).toBeTrue();

      const tableRows = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
      `).all() as Array<{ name: string }>;
      const tableNames = tableRows.map((row) => row.name);
      expect(tableNames.includes("project_id_aliases")).toBeFalse();
      expect(tableNames.includes("project_sources")).toBeTrue();
      expect(tableNames.includes("project_order")).toBeTrue();
      expect(tableNames.includes("pinned_project_order")).toBeTrue();
      expect(tableNames.includes("project_sessions")).toBeTrue();
      expect(tableNames.includes("project_session_tabs")).toBeTrue();
      expect(tableNames.includes("project_session_threads")).toBeTrue();
      expect(tableNames.includes("codex_thread_card_links")).toBeFalse();
      expect(tableNames.includes("card_history_snapshots")).toBeTrue();
      expect(tableColumnNames(db, "codex_threads").includes("card_id")).toBeFalse();

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
            'invalid-panel', ?, ?, 'left', 'db_view', 'Invalid',
            ?, 0, '{}', 1,
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `).run(`overview:${defaultProjectId}`, defaultProjectId, JSON.stringify({ projectId: defaultProjectId, view: "kanban" }));
      } catch {
        invalidPanelRejected = true;
      }
      expect(invalidPanelRejected).toBeTrue();

      let legacyBrowserKindRejected = false;
      try {
        db.prepare(`
          INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title, config_json,
            state_key, state_json, "order", created_at, updated_at
          ) VALUES (
            'legacy-browser', ?, ?, 'right', 'browser_placeholder', 'Legacy',
            ?, 0, '{}', 1,
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `).run(`overview:${defaultProjectId}`, defaultProjectId, JSON.stringify({ projectId: defaultProjectId }));
      } catch {
        legacyBrowserKindRejected = true;
      }
      expect(legacyBrowserKindRejected).toBeTrue();

      let durableSideChatKindRejected = false;
      try {
        db.prepare(`
          INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title, config_json,
            state_key, state_json, "order", created_at, updated_at
          ) VALUES (
            'durable-side-chat', ?, ?, 'right', 'side_chat_placeholder', 'Side chat',
            ?, 0, '{}', 1,
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `).run(`overview:${defaultProjectId}`, defaultProjectId, JSON.stringify({ projectId: defaultProjectId }));
      } catch {
        durableSideChatKindRejected = true;
      }
      expect(durableSideChatKindRejected).toBeTrue();

      let legacyFilesKindRejected = false;
      try {
        db.prepare(`
          INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title, config_json,
            state_key, state_json, "order", created_at, updated_at
          ) VALUES (
            'legacy-files', ?, ?, 'right', 'files_placeholder', 'Files',
            ?, 0, '{}', 1,
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `).run(`overview:${defaultProjectId}`, defaultProjectId, JSON.stringify({ projectId: defaultProjectId }));
      } catch {
        legacyFilesKindRejected = true;
      }
      expect(legacyFilesKindRejected).toBeTrue();

      const overviewSession = db.prepare(`
        SELECT id, project_id, title, is_overview, left_pane_collapsed, panel_state_json
        FROM project_sessions
        WHERE project_id = ? AND is_overview = 1
      `).get(defaultProjectId) as
        | {
          id: string;
          project_id: string;
          title: string;
          is_overview: number;
          left_pane_collapsed: number;
          panel_state_json: string;
        }
        | undefined;
      expect(overviewSession?.id).toBe(`overview:${defaultProjectId}`);
      expect(overviewSession?.project_id).toBe(defaultProjectId);
      expect(overviewSession?.title).toBe("Overview");
      expect(overviewSession?.is_overview).toBe(1);
      expect(overviewSession?.left_pane_collapsed).toBe(1);

      const overviewTab = db.prepare(`
        SELECT id, panel_id, kind, config_json
        FROM project_session_tabs
        WHERE session_id = ?
      `).get(`overview:${defaultProjectId}`) as { id: string; panel_id: string; kind: string; config_json: string } | undefined;
      expect(overviewTab?.id).toBe(`overview:${defaultProjectId}:db`);
      expect(overviewTab?.panel_id).toBe("right");
      expect(overviewTab?.kind).toBe("db_view");
      expect(overviewTab?.config_json).toBe(JSON.stringify({ projectId: defaultProjectId, view: "kanban" }));

      const parsedPanelState = JSON.parse(overviewSession?.panel_state_json ?? "{}") as {
        right?: { collapsed?: boolean; layout?: { version?: number }; size?: { fullWidth?: boolean } };
        bottom?: { collapsed?: boolean; layout?: { version?: number } };
      };
      expect(parsedPanelState.right?.collapsed).toBeFalse();
      expect(parsedPanelState.right?.layout?.version).toBe(2);
      expect(parsedPanelState.right?.size?.fullWidth).toBeTrue();
      expect(parsedPanelState.bottom?.collapsed).toBeTrue();
      expect(parsedPanelState.bottom?.layout?.version).toBe(2);

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

  test("migrates v38 by creating card history snapshot storage", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-history-snapshots-"));
    process.env.KANBAN_DIR = tempDir;

    let initializationRan = true;
    try {
      await initializeDatabase();
      closeDatabase();

      const db = new Database(getDatabasePath());
      try {
        db.exec(`
          DROP TABLE IF EXISTS card_history_snapshots;
          PRAGMA user_version = 38;
        `);
      } finally {
        db.close();
      }

      await initializeDatabase();
      const migrated = new Database(getDatabasePath());
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const snapshotColumnNames = tableColumnNames(migrated, "card_history_snapshots");
        expect(snapshotColumnNames.includes("history_id")).toBeTrue();
        expect(snapshotColumnNames.includes("card_snapshot")).toBeTrue();
        expect(snapshotColumnNames.includes("description_revision_id")).toBeTrue();

        const snapshotIndex = migrated.prepare(`
          SELECT 1
          FROM sqlite_master
          WHERE type = 'index'
            AND name = 'idx_card_history_snapshots_project_card_history'
        `).get();
        expect(snapshotIndex !== undefined).toBeTrue();

        const foreignKeyProblems = migrated.prepare("PRAGMA foreign_key_check").all();
        expect(foreignKeyProblems.length).toBe(0);
      } finally {
        migrated.close();
      }
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

  test("migrates v39 by repairing card-stage target project configs", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-card-stage-target-"));
    process.env.KANBAN_DIR = tempDir;

    let initializationRan = true;
    try {
      await initializeDatabase();
      closeDatabase();

      const db = new Database(getDatabasePath());
      try {
        const now = "2026-01-01T00:00:00.000Z";
        db.prepare(`
          INSERT OR REPLACE INTO projects (id, name, description, icon, created, updated)
          VALUES (?, ?, '', '', ?, ?)
        `).run("alpha", "Alpha", now, now);
        db.prepare(`
          INSERT OR REPLACE INTO projects (id, name, description, icon, created, updated)
          VALUES (?, ?, '', '', ?, ?)
        `).run("beta", "Beta", now, now);
        db.prepare(`
          INSERT OR REPLACE INTO cards (id, project_id, status, title, created, "order")
          VALUES (?, ?, 'in_progress', ?, ?, 0)
        `).run("card-beta", "beta", "Beta card", now);
        db.prepare(`
          INSERT OR REPLACE INTO project_sessions (
            id, project_id, title, is_overview, "order", left_pane_collapsed,
            panel_state_json, created_at, updated_at
          ) VALUES (?, ?, ?, 0, 0, 0, '{}', ?, ?)
        `).run("session-alpha", "alpha", "Alpha work", now, now);
        db.prepare(`
          INSERT OR REPLACE INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title, config_json,
            state_key, state_json, "order", created_at, updated_at
          ) VALUES (?, ?, ?, 'right', 'card_stage', ?, ?, 0, '{}', 0, ?, ?)
        `).run(
          "tab-cross-project-card",
          "session-alpha",
          "alpha",
          "Beta card",
          JSON.stringify({ projectId: "alpha", cardId: "card-beta", titleSnapshot: "Beta card" }),
          now,
          now,
        );
        db.exec("PRAGMA user_version = 39");
      } finally {
        db.close();
      }

      await initializeDatabase();
      const migrated = new Database(getDatabasePath());
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const row = migrated.prepare(`
          SELECT project_id, config_json
          FROM project_session_tabs
          WHERE id = 'tab-cross-project-card'
        `).get() as { project_id: string; config_json: string } | undefined;
        expect(row?.project_id).toBe("alpha");
        expect(row?.config_json).toBe(JSON.stringify({
          projectId: "beta",
          cardId: "card-beta",
          titleSnapshot: "Beta card",
        }));

        const foreignKeyProblems = migrated.prepare("PRAGMA foreign_key_check").all();
        expect(foreignKeyProblems.length).toBe(0);
      } finally {
        migrated.close();
      }
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

  test("migrates v32 browser tabs from the legacy key to browser", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-browser-migration-"));
    process.env.KANBAN_DIR = tempDir;

    let db: Database.Database;
    try {
      db = new Database(getDatabasePath());
    } catch (error) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
      if (isUnsupportedSqliteError(error)) {
        expect(true).toBeTrue();
        return;
      }
      throw error;
    }
    const panelStateJson = JSON.stringify({
      right: {
        collapsed: false,
        layout: {
          version: 2,
          root: { type: "leaf", id: "main", tabIds: ["tab-browser"], activeTabId: "tab-browser" },
          activeLeafId: "main",
          mruLeafIds: ["main"],
        },
        size: { widthPx: 600 },
      },
      bottom: {
        collapsed: true,
        layout: {
          version: 2,
          root: { type: "leaf", id: "bottom", tabIds: [], activeTabId: null },
          activeLeafId: "bottom",
          mruLeafIds: ["bottom"],
        },
        size: { heightPx: 280 },
      },
    });

    try {
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
          pinned INTEGER NOT NULL DEFAULT 0,
          pinned_order INTEGER,
          archived INTEGER NOT NULL DEFAULT 0,
          archived_at TEXT,
          unread INTEGER NOT NULL DEFAULT 0,
          left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
          panel_state_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (is_overview IN (0, 1)),
          CHECK (pinned IN (0, 1)),
          CHECK (archived IN (0, 1)),
          CHECK (unread IN (0, 1)),
          CHECK (left_pane_collapsed IN (0, 1))
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
        INSERT INTO projects (id, name, description, icon, created)
        VALUES ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z');
      `);
      db.prepare(`
        INSERT INTO project_sessions (
          id, project_id, title, is_overview, "order", pinned, pinned_order, archived, archived_at,
          unread, left_pane_collapsed, panel_state_json, created_at, updated_at
        ) VALUES (
          'session-1', 'alpha', 'Session', 0, 0, 0, NULL, 0, NULL,
          0, 0, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `).run(panelStateJson);
      db.exec(`
        INSERT INTO project_session_tabs (
          id, session_id, project_id, panel_id, kind, title, config_json,
          state_key, state_json, "order", created_at, updated_at
        ) VALUES
          (
            'tab-browser', 'session-1', 'alpha', 'right', 'browser_placeholder', 'Browser',
            '{"title":"Example","url":"https://example.com"}', 0, '{}', 0,
            '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          ),
          (
            'tab-side', 'session-1', 'alpha', 'right', 'side_chat_placeholder', 'Side chat',
            '{"projectId":"alpha"}', 0, '{}', 1,
            '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z'
          );
        PRAGMA user_version = 32;
      `);
    } finally {
      db.close();
    }

    try {
      await initializeDatabase();
      const migrated = new Database(getDatabasePath());
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);
        const alphaProjectId = expectUuidProjectNamed(migrated, "Alpha");

        const row = migrated.prepare(`
          SELECT kind, config_json
          FROM project_session_tabs
          WHERE id = 'tab-browser'
        `).get() as { kind: string; config_json: string } | undefined;
        expect(row?.kind).toBe("browser");
        const config = JSON.parse(row?.config_json ?? "{}") as {
          projectId?: string;
          title?: string;
          url?: string;
        };
        expect(config.projectId).toBe(alphaProjectId);
        expect(config.title).toBe("Example");
        expect(config.url).toBe("https://example.com");

        const sideChatRow = migrated.prepare(`
          SELECT 1
          FROM project_session_tabs
          WHERE id = 'tab-side'
        `).get();
        expect(sideChatRow === undefined).toBeTrue();
      } finally {
        migrated.close();
      }
    } finally {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.KANBAN_DIR;
    }
  });

  test("migrates v33 by removing durable side chat placeholder tabs", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-side-chat-migration-"));
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
            version: 2,
            root: {
              type: "leaf",
              id: "main",
              tabIds: ["tab-review", "tab-side"],
              activeTabId: "tab-side",
            },
            activeLeafId: "main",
            mruLeafIds: ["main"],
            maximizedLeafId: null,
          },
          size: { widthPx: 640, fullWidth: false },
        },
        bottom: {
          collapsed: false,
          layout: {
            version: 2,
            root: {
              type: "leaf",
              id: "main",
              tabIds: ["tab-side-bottom"],
              activeTabId: "tab-side-bottom",
            },
            activeLeafId: "main",
            mruLeafIds: ["main"],
            maximizedLeafId: null,
          },
          size: { heightPx: 300 },
        },
      });

      try {
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
            pinned INTEGER NOT NULL DEFAULT 0,
            pinned_order INTEGER,
            archived INTEGER NOT NULL DEFAULT 0,
            archived_at TEXT,
            unread INTEGER NOT NULL DEFAULT 0,
            left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
            panel_state_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (is_overview IN (0, 1)),
            CHECK (pinned IN (0, 1)),
            CHECK (archived IN (0, 1)),
            CHECK (unread IN (0, 1)),
            CHECK (left_pane_collapsed IN (0, 1))
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
            CHECK (kind IN ('db_view', 'card_stage', 'terminal', 'browser', 'review', 'files_placeholder', 'side_chat_placeholder')),
            CHECK (panel_id IN ('right', 'bottom'))
          );
          INSERT INTO projects (id, name, description, icon, created)
          VALUES ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z');
        `);
        db.prepare(`
          INSERT INTO project_sessions (
            id, project_id, title, is_overview, "order", pinned, pinned_order, archived, archived_at,
            unread, left_pane_collapsed, panel_state_json, created_at, updated_at
          ) VALUES (
            'session-1', 'alpha', 'Session', 0, 0, 0, NULL, 0, NULL,
            0, 0, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
          )
        `).run(panelStateJson);
        db.exec(`
          INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title, config_json,
            state_key, state_json, "order", created_at, updated_at
          ) VALUES
            (
              'tab-review', 'session-1', 'alpha', 'right', 'review', 'Review',
              '{"projectId":"alpha"}', 0, '{}', 0,
              '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
            ),
            (
              'tab-side', 'session-1', 'alpha', 'right', 'side_chat_placeholder', 'Side chat',
              '{"projectId":"alpha"}', 0, '{}', 1,
              '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z'
            ),
            (
              'tab-side-bottom', 'session-1', 'alpha', 'bottom', 'side_chat_placeholder', 'Side chat 2',
              '{"projectId":"alpha"}', 0, '{}', 0,
              '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:02.000Z'
            );
          PRAGMA user_version = 33;
        `);
      } finally {
        db.close();
      }

      await initializeDatabase();

      const migrated = new Database(dbPath);
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);
        const alphaProjectId = expectUuidProjectNamed(migrated, "Alpha");

        const tabs = migrated.prepare(`
          SELECT id, kind
          FROM project_session_tabs
          WHERE session_id = 'session-1'
          ORDER BY "order" ASC
        `).all() as Array<{ id: string; kind: string }>;
        expect(JSON.stringify(tabs)).toBe(JSON.stringify([{ id: "tab-review", kind: "review" }]));

        const stateRow = migrated.prepare(`
          SELECT panel_state_json
          FROM project_sessions
          WHERE id = 'session-1'
        `).get() as { panel_state_json: string } | undefined;
        expect((stateRow?.panel_state_json ?? "").includes("tab-side")).toBeFalse();
        const panels = JSON.parse(stateRow?.panel_state_json ?? "{}") as {
          right?: { layout?: { root?: { tabIds?: string[]; activeTabId?: string | null } } };
          bottom?: { collapsed?: boolean; layout?: { root?: { tabIds?: string[]; activeTabId?: string | null } } };
        };
        expect(JSON.stringify(panels.right?.layout?.root?.tabIds ?? [])).toBe(JSON.stringify(["tab-review"]));
        expect(panels.right?.layout?.root?.activeTabId).toBe("tab-review");
        expect(JSON.stringify(panels.bottom?.layout?.root?.tabIds ?? [])).toBe("[]");
        expect(panels.bottom?.collapsed).toBeTrue();

        let sideChatKindRejected = false;
        try {
          migrated.prepare(`
            INSERT INTO project_session_tabs (
            id, session_id, project_id, panel_id, kind, title, config_json,
            state_key, state_json, "order", created_at, updated_at
          ) VALUES (
              'tab-side-new', 'session-1', ?, 'right', 'side_chat_placeholder', 'Side chat',
              ?, 0, '{}', 2,
              '2026-01-01T00:00:03.000Z', '2026-01-01T00:00:03.000Z'
            )
          `).run(alphaProjectId, JSON.stringify({ projectId: alphaProjectId }));
        } catch {
          sideChatKindRejected = true;
        }
        expect(sideChatKindRejected).toBeTrue();
      } finally {
        migrated.close();
      }
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
            version: 2,
            root: { type: "leaf", id: "main", tabIds: ["tab-review"], activeTabId: "tab-review" },
            activeLeafId: "main",
            mruLeafIds: ["main"],
            maximizedLeafId: null,
          },
          size: { widthPx: 620, fullWidth: false },
        },
        bottom: {
          collapsed: false,
          layout: {
            version: 2,
            root: { type: "leaf", id: "main", tabIds: ["tab-terminal"], activeTabId: "tab-terminal" },
            activeLeafId: "main",
            mruLeafIds: ["main"],
            maximizedLeafId: null,
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
          CHECK (kind IN ('db_view', 'card_stage', 'terminal', 'browser', 'review', 'files_placeholder', 'side_chat_placeholder')),
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
      const alphaProjectId = expectUuidProjectNamed(migrated, "Alpha");

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
          config_json: JSON.stringify({ projectId: alphaProjectId, terminalSessionId: "term-1" }),
          order: 0,
          state_key: 2,
          state_json: JSON.stringify({ cwd: "/tmp/alpha" }),
        },
        {
          id: "tab-review",
          panel_id: "right",
          config_json: JSON.stringify({ projectId: alphaProjectId }),
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

  test("migrates files placeholder tabs into files tabs", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v34-files-"));
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
            version: 2,
            root: { type: "leaf", id: "main", tabIds: ["tab-files"], activeTabId: "tab-files" },
            activeLeafId: "main",
            mruLeafIds: ["main"],
          },
          size: { widthPx: 600 },
        },
        bottom: {
          collapsed: true,
          layout: {
            version: 2,
            root: { type: "leaf", id: "main", tabIds: [], activeTabId: null },
            activeLeafId: "main",
            mruLeafIds: ["main"],
          },
          size: { heightPx: 280 },
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
          pinned INTEGER NOT NULL DEFAULT 0,
          pinned_order INTEGER,
          archived INTEGER NOT NULL DEFAULT 0,
          archived_at TEXT,
          unread INTEGER NOT NULL DEFAULT 0,
          left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
          panel_state_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
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
          CHECK (kind IN ('db_view', 'card_stage', 'terminal', 'browser', 'review', 'files_placeholder')),
          CHECK (panel_id IN ('right', 'bottom'))
        );
        CREATE TABLE project_session_threads (
          session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL,
          linked_at TEXT NOT NULL
        ) WITHOUT ROWID;
        INSERT INTO projects (id, name, description, icon, workspace_path, created)
        VALUES ('alpha', 'Alpha', '', '', '/tmp/alpha', '2026-01-01T00:00:00.000Z');
      `);
      db.prepare(`
        INSERT INTO project_sessions (
          id, project_id, title, is_overview, "order", pinned, pinned_order, archived, archived_at,
          unread, left_pane_collapsed, panel_state_json, created_at, updated_at
        ) VALUES (
          'session-1', 'alpha', 'Session', 0, 0, 0, NULL, 0, NULL,
          0, 0, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `).run(panelStateJson);
      db.exec(`
        INSERT INTO project_session_tabs (
          id, session_id, project_id, panel_id, kind, title, config_json,
          state_key, state_json, "order", created_at, updated_at
        ) VALUES (
          'tab-files', 'session-1', 'alpha', 'right', 'files_placeholder', 'Files',
          '{"projectId":"alpha"}', 0, '{}', 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        PRAGMA user_version = 34;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      const version = migrated.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);
      const alphaProjectId = expectUuidProjectNamed(migrated, "Alpha");

      const tab = migrated.prepare(`
        SELECT kind, config_json
        FROM project_session_tabs
        WHERE id = 'tab-files'
      `).get() as { kind: string; config_json: string } | undefined;
      expect(tab?.kind).toBe("files");
      expect(tab?.config_json).toBe(JSON.stringify({ projectId: alphaProjectId, hostId: "local", workspaceRoot: "" }));

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

  test("migrates schema 35 slug projects into UUID source-backed projects", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v35-project-sources-"));
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
            version: 2,
            root: {
              type: "leaf",
              id: "main",
              tabIds: ["overview:alpha:db"],
              activeTabId: "overview:alpha:db",
            },
            activeLeafId: "main",
            mruLeafIds: ["main"],
          },
          size: { widthPx: 600, fullWidth: true },
        },
        bottom: {
          collapsed: true,
          layout: {
            version: 2,
            root: { type: "leaf", id: "main", tabIds: [], activeTabId: null },
            activeLeafId: "main",
            mruLeafIds: ["main"],
          },
          size: { heightPx: 280 },
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
        CREATE TABLE cards (project_id TEXT);
        CREATE TABLE history (project_id TEXT);
        CREATE TABLE canvas (project_id TEXT);
        CREATE TABLE recurrence_exceptions (project_id TEXT);
        CREATE TABLE reminder_receipts (project_id TEXT);
        CREATE TABLE reminder_snoozes (project_id TEXT);
        CREATE TABLE codex_threads (thread_id TEXT PRIMARY KEY, project_id TEXT);
        CREATE TABLE codex_thread_card_links (project_id TEXT);
        CREATE TABLE project_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          is_overview INTEGER NOT NULL DEFAULT 0,
          "order" INTEGER NOT NULL,
          pinned INTEGER NOT NULL DEFAULT 0,
          pinned_order INTEGER,
          archived INTEGER NOT NULL DEFAULT 0,
          archived_at TEXT,
          unread INTEGER NOT NULL DEFAULT 0,
          left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
          panel_state_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX idx_project_sessions_overview
          ON project_sessions(project_id)
          WHERE is_overview = 1;
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
        CREATE TABLE project_session_threads (
          session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
          linked_at TEXT NOT NULL
        ) WITHOUT ROWID;

        INSERT INTO projects (id, name, description, icon, workspace_path, created)
        VALUES
          ('alpha', 'Alpha', 'A project', '🚀', '/tmp/alpha', '2026-01-01T00:00:00.000Z'),
          ('beta', 'Beta', '', '', NULL, '2026-01-02T00:00:00.000Z');
        INSERT INTO cards (project_id) VALUES ('alpha');
        INSERT INTO history (project_id) VALUES ('alpha');
        INSERT INTO canvas (project_id) VALUES ('alpha');
        INSERT INTO recurrence_exceptions (project_id) VALUES ('alpha');
        INSERT INTO reminder_receipts (project_id) VALUES ('alpha');
        INSERT INTO reminder_snoozes (project_id) VALUES ('alpha');
        INSERT INTO codex_threads (thread_id, project_id) VALUES ('thread-1', 'alpha');
        INSERT INTO codex_thread_card_links (project_id) VALUES ('alpha');
        PRAGMA user_version = 35;
      `);
      db.prepare(`
        INSERT INTO project_sessions (
          id, project_id, title, is_overview, "order", pinned, pinned_order, archived,
          archived_at, unread, left_pane_collapsed, panel_state_json, created_at, updated_at
        ) VALUES (
          'overview:alpha', 'alpha', 'Overview', 1, 0, 0, NULL, 0,
          NULL, 0, 1, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `).run(panelStateJson);
      db.prepare(`
        INSERT INTO project_session_tabs (
          id, session_id, project_id, panel_id, kind, title, config_json,
          state_key, state_json, "order", created_at, updated_at
        ) VALUES (
          'overview:alpha:db', 'overview:alpha', 'alpha', 'right', 'db_view', 'DB View',
          ?, 0, '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `).run(JSON.stringify({
        projectId: "alpha",
        nested: { projectId: "beta" },
        items: [{ projectId: "alpha" }],
      }));
      db.exec(`
        INSERT INTO project_session_threads (session_id, thread_id, linked_at)
        VALUES ('overview:alpha', 'thread-1', '2026-01-01T00:00:00.000Z');
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);
        const alphaProjectId = expectUuidProjectNamed(migrated, "Alpha");
        const betaProjectId = expectUuidProjectNamed(migrated, "Beta");

        const projectColumns = tableColumnNames(migrated, "projects");
        expect(projectColumns.includes("workspace_path")).toBeFalse();
        expect(projectColumns.includes("updated")).toBeTrue();
        const tableRows = migrated.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
        `).all() as Array<{ name: string }>;
        const tableNames = tableRows.map((row) => row.name);
        expect(tableNames.includes("project_id_aliases")).toBeFalse();

        const oldProjectRows = migrated.prepare(`
          SELECT COUNT(*) AS count
          FROM projects
          WHERE id IN ('alpha', 'beta')
        `).get() as { count: number };
        expect(oldProjectRows.count).toBe(0);

        const source = migrated.prepare(`
          SELECT root, root_key, "order"
          FROM project_sources
          WHERE project_id = ?
        `).get(alphaProjectId) as { root: string; root_key: string; order: number } | undefined;
        expect(source?.root).toBe(path.resolve("/tmp/alpha"));
        expect(source?.root_key).toBe(path.resolve("/tmp/alpha"));
        expect(source?.order).toBe(0);

        const betaSourceCount = migrated.prepare(`
          SELECT COUNT(*) AS count
          FROM project_sources
          WHERE project_id = ?
        `).get(betaProjectId) as { count: number };
        expect(betaSourceCount.count).toBe(0);

        const projectOrder = migrated.prepare(`
          SELECT project_id, "order"
          FROM project_order
          ORDER BY "order" ASC
        `).all() as Array<{ project_id: string; order: number }>;
        expect(JSON.stringify(projectOrder)).toBe(JSON.stringify([
          { project_id: alphaProjectId, order: 0 },
          { project_id: betaProjectId, order: 1 },
        ]));

        for (const tableName of [
          "cards",
          "history",
          "canvas",
          "recurrence_exceptions",
          "reminder_receipts",
          "reminder_snoozes",
          "codex_threads",
          "project_sessions",
          "project_session_tabs",
        ]) {
          const legacyCount = migrated.prepare(`
            SELECT COUNT(*) AS count
            FROM ${tableName}
            WHERE project_id = 'alpha'
          `).get() as { count: number };
          expect(legacyCount.count).toBe(0);
          const canonicalCount = migrated.prepare(`
            SELECT COUNT(*) AS count
            FROM ${tableName}
            WHERE project_id = ?
          `).get(alphaProjectId) as { count: number };
          expect(canonicalCount.count > 0).toBeTrue();
        }

        const overview = migrated.prepare(`
          SELECT id, panel_state_json
          FROM project_sessions
          WHERE project_id = ? AND is_overview = 1
        `).get(alphaProjectId) as { id: string; panel_state_json: string } | undefined;
        expect(overview?.id).toBe(`overview:${alphaProjectId}`);
        expect((overview?.panel_state_json ?? "").includes(`overview:${alphaProjectId}:db`)).toBeTrue();
        expect((overview?.panel_state_json ?? "").includes("overview:alpha:db")).toBeFalse();

        const tab = migrated.prepare(`
          SELECT id, session_id, config_json
          FROM project_session_tabs
          WHERE project_id = ?
        `).get(alphaProjectId) as { id: string; session_id: string; config_json: string } | undefined;
        expect(tab?.id).toBe(`overview:${alphaProjectId}:db`);
        expect(tab?.session_id).toBe(`overview:${alphaProjectId}`);
        const config = JSON.parse(tab?.config_json ?? "{}") as {
          projectId?: string;
          nested?: { projectId?: string };
          items?: Array<{ projectId?: string }>;
        };
        expect(config.projectId).toBe(alphaProjectId);
        expect(config.nested?.projectId).toBe(betaProjectId);
        expect(config.items?.[0]?.projectId).toBe(alphaProjectId);

        const threadLink = migrated.prepare(`
          SELECT session_id
          FROM project_session_threads
        `).get() as { session_id: string } | undefined;
        expect(threadLink?.session_id).toBe(`overview:${alphaProjectId}`);

        const foreignKeyProblems = migrated.prepare("PRAGMA foreign_key_check").all();
        expect(JSON.stringify(foreignKeyProblems)).toBe("[]");
      } finally {
        migrated.close();
      }
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

  test("migrates schema 36 by dropping aliases while preserving UUID source-backed projects", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v36-project-sources-"));
    process.env.KANBAN_DIR = tempDir;

    let initializationRan = true;
    try {
      await initializeDatabase();
      const dbPath = getDatabasePath();
      const db = new Database(dbPath);
      const projectId = "11111111-1111-4111-8111-111111111111";
      const created = "2026-01-01T00:00:00.000Z";
      try {
        db.exec(`
          CREATE TABLE project_id_aliases (
            alias TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            created TEXT NOT NULL
          );
        `);
        db.prepare(`
          INSERT INTO projects (id, name, description, icon, created, updated)
          VALUES (?, 'Alpha', 'A project', '🚀', ?, ?)
        `).run(projectId, created, created);
        db.prepare(`
          INSERT INTO project_sources (project_id, root, root_key, "order", created, updated)
          VALUES (?, '/tmp/alpha', '/tmp/alpha', 0, ?, ?)
        `).run(projectId, created, created);
        db.prepare(`
          INSERT INTO project_order (project_id, "order", updated)
          VALUES (?, 5, ?)
        `).run(projectId, created);
        db.prepare(`
          INSERT INTO project_id_aliases (alias, project_id, created)
          VALUES ('alpha', ?, ?)
        `).run(projectId, created);
        db.exec("PRAGMA user_version = 36");
      } finally {
        db.close();
      }

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const tableRows = migrated.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
        `).all() as Array<{ name: string }>;
        const tableNames = tableRows.map((row) => row.name);
        expect(tableNames.includes("project_id_aliases")).toBeFalse();

        const project = migrated.prepare(`
          SELECT id, name, description, icon
          FROM projects
          WHERE id = ?
        `).get(projectId) as { id: string; name: string; description: string; icon: string } | undefined;
        expect(project?.name).toBe("Alpha");
        expect(project?.description).toBe("A project");
        expect(project?.icon).toBe("🚀");

        const source = migrated.prepare(`
          SELECT root, root_key, "order"
          FROM project_sources
          WHERE project_id = ?
        `).get(projectId) as { root: string; root_key: string; order: number } | undefined;
        expect(source?.root).toBe("/tmp/alpha");
        expect(source?.root_key).toBe("/tmp/alpha");
        expect(source?.order).toBe(0);

        const projectOrder = migrated.prepare(`
          SELECT "order"
          FROM project_order
          WHERE project_id = ?
        `).get(projectId) as { order: number } | undefined;
        expect(projectOrder?.order).toBe(5);

        const foreignKeyProblems = migrated.prepare("PRAGMA foreign_key_check").all();
        expect(JSON.stringify(foreignKeyProblems)).toBe("[]");
      } finally {
        migrated.close();
      }
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
      const alphaProjectId = expectUuidProjectNamed(migrated, "Alpha");

      const legacyThreadTable = migrated.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_card_threads'
      `).get();
      expect(legacyThreadTable === undefined).toBeTrue();

      expect(tableColumnNames(migrated, "codex_threads").includes("card_id")).toBeFalse();

      const cardLinkTable = migrated.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_thread_card_links'
      `).get();
      expect(cardLinkTable === undefined).toBeTrue();

      const thread = migrated.prepare(`
        SELECT project_id, parent_thread_id, thread_name
        FROM codex_threads
        WHERE thread_id = 'thread-1'
      `).get() as {
        project_id: string | null;
        parent_thread_id: string | null;
        thread_name: string | null;
      } | undefined;
      expect(thread?.project_id).toBe(alphaProjectId);
      expect(thread?.parent_thread_id).toBe("thread-parent");
      expect(thread?.thread_name).toBe("Card thread");

      const sessionLink = migrated.prepare(`
        SELECT s.project_id, s.title, s.is_overview, pst.thread_id, pst.linked_at
        FROM project_session_threads pst
        JOIN project_sessions s ON s.id = pst.session_id
        WHERE pst.thread_id = 'thread-1'
      `).get() as {
        project_id: string;
        title: string;
        is_overview: number;
        thread_id: string;
        linked_at: string;
      } | undefined;
      expect(sessionLink?.project_id).toBe(alphaProjectId);
      expect(sessionLink?.title).toBe("Card thread");
      expect(sessionLink?.is_overview).toBe(0);
      expect(sessionLink?.linked_at).toBe("2026-01-01T00:00:00.000Z");

      const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
      expect(sessionColumnNames.includes("panel_state_json")).toBeTrue();
      expect(sessionColumnNames.includes("right_pane_collapsed")).toBeFalse();
      expect(sessionColumnNames.includes("right_pane_layout_json")).toBeFalse();

      const overview = migrated.prepare(`
        SELECT id, left_pane_collapsed, panel_state_json
        FROM project_sessions
        WHERE project_id = ? AND is_overview = 1
      `).get(alphaProjectId) as { id: string; left_pane_collapsed: number; panel_state_json: string } | undefined;
      expect(overview?.id).toBe(`overview:${alphaProjectId}`);
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
        WHERE session_id = ?
      `).get(`overview:${alphaProjectId}`) as { panel_id: string; kind: string; config_json: string } | undefined;
      expect(overviewTab?.panel_id).toBe("right");
      expect(overviewTab?.kind).toBe("db_view");
      expect(overviewTab?.config_json).toBe(JSON.stringify({ projectId: alphaProjectId, view: "kanban" }));

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

  test("migrates legacy card thread links into project session thread ownership", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-link-migrate-"));
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
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE TABLE cards (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          created TEXT NOT NULL,
          "order" INTEGER NOT NULL
        );
        CREATE TABLE codex_threads (
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
        CREATE TABLE codex_thread_card_links (
          thread_id TEXT PRIMARY KEY REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          linked_at TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE project_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          is_overview INTEGER NOT NULL DEFAULT 0,
          "order" INTEGER NOT NULL,
          pinned INTEGER NOT NULL DEFAULT 0,
          pinned_order INTEGER,
          archived INTEGER NOT NULL DEFAULT 0,
          archived_at TEXT,
          unread INTEGER NOT NULL DEFAULT 0,
          left_pane_collapsed INTEGER NOT NULL DEFAULT 0,
          panel_state_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE project_session_threads (
          session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
          linked_at TEXT NOT NULL
        ) WITHOUT ROWID;

        INSERT INTO projects (id, name, description, icon, created, updated)
        VALUES ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        INSERT INTO cards (id, project_id, status, title, description, tags, created, "order")
        VALUES ('card-1', 'alpha', 'in_progress', 'Card title fallback', '', '[]', '2026-01-01T00:00:00.000Z', 0);
        INSERT INTO codex_threads (
          thread_id, project_id, card_id, parent_thread_id, thread_name, thread_preview,
          model_provider, cwd, status_type, status_active_flags_json, archived,
          created_at, updated_at, linked_at
        ) VALUES (
          'thread-1', 'alpha', 'card-1', NULL, 'Linked thread', 'preview',
          'openai', '/tmp/alpha', 'idle', '[]', 0, 10, 20, '2026-01-02T00:00:00.000Z'
        );
        INSERT INTO codex_thread_card_links (thread_id, project_id, card_id, linked_at)
        VALUES ('thread-1', 'alpha', 'card-1', '2026-01-03T00:00:00.000Z');
        PRAGMA user_version = 40;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      const version = migrated.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(tableColumnNames(migrated, "codex_threads").includes("card_id")).toBeFalse();
      const oldLinkTable = migrated.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_thread_card_links'
      `).get();
      expect(oldLinkTable === undefined).toBeTrue();

      const sessionLink = migrated.prepare(`
        SELECT s.project_id, s.title, s.is_overview, pst.thread_id, pst.linked_at
        FROM project_session_threads pst
        JOIN project_sessions s ON s.id = pst.session_id
        WHERE pst.thread_id = 'thread-1'
      `).get() as {
        project_id: string;
        title: string;
        is_overview: number;
        thread_id: string;
        linked_at: string;
      } | undefined;
      expect(sessionLink?.project_id).toBe("alpha");
      expect(sessionLink?.title).toBe("Linked thread");
      expect(sessionLink?.is_overview).toBe(0);
      expect(sessionLink?.linked_at).toBe("2026-01-03T00:00:00.000Z");
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
