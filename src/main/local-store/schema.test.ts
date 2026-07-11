import { describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
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
    const supportedTargets = [
      31,
      32,
      33,
      34,
      35,
      37,
      38,
      39,
      40,
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
      57,
      58,
      59,
      60,
      61,
      62,
      63,
      64,
      65,
      66,
    ];
    const expectedTargetsAfter = (version: number) => JSON.stringify(
      supportedTargets.filter((target) => target > version),
    );

    expect(JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION))).toBe("[]");
    expect(JSON.stringify(getSchemaMigrationTargets(26))).toBe(expectedTargetsAfter(26));
    expect(JSON.stringify(getSchemaMigrationTargets(30))).toBe(expectedTargetsAfter(30));
    expect(JSON.stringify(getSchemaMigrationTargets(31))).toBe(expectedTargetsAfter(31));
    expect(JSON.stringify(getSchemaMigrationTargets(32))).toBe(expectedTargetsAfter(32));
    expect(JSON.stringify(getSchemaMigrationTargets(33))).toBe(expectedTargetsAfter(33));
    expect(JSON.stringify(getSchemaMigrationTargets(34))).toBe(expectedTargetsAfter(34));
    expect(JSON.stringify(getSchemaMigrationTargets(35))).toBe(expectedTargetsAfter(35));
    expect(JSON.stringify(getSchemaMigrationTargets(36))).toBe(expectedTargetsAfter(36));
    expect(JSON.stringify(getSchemaMigrationTargets(37))).toBe(expectedTargetsAfter(37));
    expect(JSON.stringify(getSchemaMigrationTargets(38))).toBe(expectedTargetsAfter(38));
    expect(JSON.stringify(getSchemaMigrationTargets(39))).toBe(expectedTargetsAfter(39));
    expect(JSON.stringify(getSchemaMigrationTargets(40))).toBe(expectedTargetsAfter(40));
    expect(JSON.stringify(getSchemaMigrationTargets(41))).toBe(expectedTargetsAfter(41));
    expect(JSON.stringify(getSchemaMigrationTargets(42))).toBe(expectedTargetsAfter(42));
    expect(JSON.stringify(getSchemaMigrationTargets(43))).toBe(expectedTargetsAfter(43));
    expect(JSON.stringify(getSchemaMigrationTargets(44))).toBe(expectedTargetsAfter(44));
    expect(JSON.stringify(getSchemaMigrationTargets(45))).toBe(expectedTargetsAfter(45));
    expect(JSON.stringify(getSchemaMigrationTargets(46))).toBe(expectedTargetsAfter(46));
    expect(JSON.stringify(getSchemaMigrationTargets(47))).toBe(expectedTargetsAfter(47));
    expect(JSON.stringify(getSchemaMigrationTargets(48))).toBe(expectedTargetsAfter(48));
    expect(JSON.stringify(getSchemaMigrationTargets(49))).toBe(expectedTargetsAfter(49));
    expect(JSON.stringify(getSchemaMigrationTargets(50))).toBe(expectedTargetsAfter(50));
    expect(JSON.stringify(getSchemaMigrationTargets(51))).toBe(expectedTargetsAfter(51));
    expect(JSON.stringify(getSchemaMigrationTargets(52))).toBe(expectedTargetsAfter(52));
    expect(JSON.stringify(getSchemaMigrationTargets(53))).toBe(expectedTargetsAfter(53));
    expect(JSON.stringify(getSchemaMigrationTargets(54))).toBe(expectedTargetsAfter(54));
    expect(JSON.stringify(getSchemaMigrationTargets(55))).toBe(expectedTargetsAfter(55));
    expect(JSON.stringify(getSchemaMigrationTargets(56))).toBe(expectedTargetsAfter(56));
    expect(JSON.stringify(getSchemaMigrationTargets(57))).toBe(expectedTargetsAfter(57));
    expect(JSON.stringify(getSchemaMigrationTargets(58))).toBe(expectedTargetsAfter(58));
    expect(JSON.stringify(getSchemaMigrationTargets(59))).toBe(expectedTargetsAfter(59));
    expect(JSON.stringify(getSchemaMigrationTargets(60))).toBe(expectedTargetsAfter(60));
    expect(JSON.stringify(getSchemaMigrationTargets(61))).toBe(expectedTargetsAfter(61));
    expect(JSON.stringify(getSchemaMigrationTargets(62))).toBe(expectedTargetsAfter(62));
    expect(JSON.stringify(getSchemaMigrationTargets(63))).toBe(expectedTargetsAfter(63));
    expect(JSON.stringify(getSchemaMigrationTargets(64))).toBe(expectedTargetsAfter(64));
    expect(JSON.stringify(getSchemaMigrationTargets(65))).toBe(expectedTargetsAfter(65));
    expect(getSchemaMigrationTargets(29) === null).toBeTrue();
    expect(getSchemaMigrationTargets(20) === null).toBeTrue();
  });

  test("migrates schema 53 databases with Codex background process registry", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-53-"));
    process.env.NODEX_DIR = tempDir;
    try {
      try {
        await initializeDatabase();
        closeDatabase();

        const db = new Database(getDatabasePath(), { readonly: false });
        try {
          db.exec(`
            DROP TABLE IF EXISTS codex_background_processes;
            PRAGMA user_version = 53;
          `);
        } finally {
          db.close();
        }

        await initializeDatabase();

        const migrated = new Database(getDatabasePath(), { readonly: false });
        try {
          const version = migrated.prepare("PRAGMA user_version").get() as
            | { user_version: number }
            | undefined;
          expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

          const backgroundProcessColumnNames = tableColumnNames(migrated, "codex_background_processes");
          expect(backgroundProcessColumnNames.includes("process_record_id")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("thread_id")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("thread_title")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("item_id")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("turn_id")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("command")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("cwd")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("app_server_process_id")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("os_pid")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("terminal_session_id")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("source")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("started_at_ms")).toBeTrue();
          expect(backgroundProcessColumnNames.includes("updated_at_ms")).toBeTrue();

          const backgroundProcessTableSql = migrated.prepare(`
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table' AND name = 'codex_background_processes'
          `).get() as { sql: string } | undefined;
          expect((backgroundProcessTableSql?.sql ?? "").includes("WITHOUT ROWID")).toBeTrue();

          const backgroundProcessIndex = migrated.prepare(`
            SELECT 1
            FROM sqlite_master
            WHERE type = 'index'
              AND name = 'idx_codex_background_processes_thread_updated'
          `).get();
          expect(backgroundProcessIndex !== undefined).toBeTrue();

          migrated.prepare(`
            INSERT INTO codex_background_processes (
              process_record_id, thread_id, thread_title, item_id, turn_id, command, cwd,
              app_server_process_id, os_pid, terminal_session_id, source, started_at_ms, updated_at_ms
            ) VALUES (
              'thread-1:item-1', 'thread-1', 'Thread 1', 'item-1', 'turn-1',
              'bun dev', '/repo', 'process-1', 1234, NULL, 'app-server', 10, 20
            )
          `).run();
          const inserted = migrated.prepare(`
            SELECT thread_id, item_id, command, source
            FROM codex_background_processes
            WHERE process_record_id = 'thread-1:item-1'
          `).get() as { thread_id: string; item_id: string; command: string; source: string } | undefined;
          expect(inserted?.thread_id).toBe("thread-1");
          expect(inserted?.item_id).toBe("item-1");
          expect(inserted?.command).toBe("bun dev");
          expect(inserted?.source).toBe("app-server");
        } finally {
          migrated.close();
        }
      } catch (error) {
        if (isUnsupportedSqliteError(error)) {
          expect(true).toBeTrue();
        } else {
          throw error;
        }
      } finally {
        closeDatabase();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
    }
  });

  test("initializes the latest schema from a fresh database", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-init-"));
    process.env.NODEX_DIR = tempDir;

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
      expect(cardColumnNames.includes("description_preview")).toBeTrue();
      expect(cardColumnNames.includes("description_length")).toBeTrue();
      expect(cardColumnNames.includes("has_description")).toBeTrue();
      expect(cardColumnNames.includes("description_read_model_revision")).toBeTrue();
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
      expect(codexThreadColumnNames.includes("thread_source")).toBeTrue();
      expect(codexThreadColumnNames.includes("agent_nickname")).toBeTrue();
      expect(codexThreadColumnNames.includes("agent_role")).toBeTrue();
      expect(codexThreadColumnNames.includes("managed_worktree_path")).toBeTrue();
      expect(codexThreadColumnNames.includes("projectless_output_directory")).toBeTrue();
      expect(codexThreadColumnNames.includes("card_id")).toBeFalse();

      const codexTableSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_threads'
      `).get() as { sql: string } | undefined;
      expect((codexTableSql?.sql ?? "").includes("WITHOUT ROWID")).toBeTrue();

      const scheduledAutomationColumnNames = tableColumnNames(db, "codex_scheduled_automations");
      expect(scheduledAutomationColumnNames.includes("automation_id")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("kind")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("status")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("target_thread_id")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("prompt")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("rrule")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("model")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("reasoning_effort")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("cwds_json")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("execution_environment")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("local_environment_config_path")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("next_run_at")).toBeTrue();
      expect(scheduledAutomationColumnNames.includes("last_run_at")).toBeTrue();
      const scheduledAutomationTableSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_scheduled_automations'
      `).get() as { sql: string } | undefined;
      expect((scheduledAutomationTableSql?.sql ?? "").includes("WITHOUT ROWID")).toBeTrue();
      const scheduledAutomationIndex = db.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_codex_scheduled_automations_target'
      `).get();
      expect(scheduledAutomationIndex !== undefined).toBeTrue();

      const automationRunColumnNames = tableColumnNames(db, "codex_automation_runs");
      expect(automationRunColumnNames.includes("thread_id")).toBeTrue();
      expect(automationRunColumnNames.includes("automation_id")).toBeTrue();
      expect(automationRunColumnNames.includes("status")).toBeTrue();
      expect(automationRunColumnNames.includes("read_at")).toBeTrue();
      expect(automationRunColumnNames.includes("thread_title")).toBeTrue();
      expect(automationRunColumnNames.includes("source_cwd")).toBeTrue();
      expect(automationRunColumnNames.includes("inbox_title")).toBeTrue();
      expect(automationRunColumnNames.includes("inbox_summary")).toBeTrue();
      expect(automationRunColumnNames.includes("archived_user_message")).toBeTrue();
      expect(automationRunColumnNames.includes("archived_assistant_message")).toBeTrue();
      expect(automationRunColumnNames.includes("archived_reason")).toBeTrue();
      const automationRunIndex = db.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_codex_automation_runs_automation_status_created'
      `).get();
      expect(automationRunIndex !== undefined).toBeTrue();

      const backgroundProcessColumnNames = tableColumnNames(db, "codex_background_processes");
      expect(backgroundProcessColumnNames.includes("process_record_id")).toBeTrue();
      expect(backgroundProcessColumnNames.includes("thread_id")).toBeTrue();
      expect(backgroundProcessColumnNames.includes("item_id")).toBeTrue();
      expect(backgroundProcessColumnNames.includes("turn_id")).toBeTrue();
      expect(backgroundProcessColumnNames.includes("command")).toBeTrue();
      expect(backgroundProcessColumnNames.includes("app_server_process_id")).toBeTrue();
      expect(backgroundProcessColumnNames.includes("terminal_session_id")).toBeTrue();
      const backgroundProcessTableSql = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_background_processes'
      `).get() as { sql: string } | undefined;
      expect((backgroundProcessTableSql?.sql ?? "").includes("WITHOUT ROWID")).toBeTrue();
      const backgroundProcessIndex = db.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_codex_background_processes_thread_updated'
      `).get();
      expect(backgroundProcessIndex !== undefined).toBeTrue();

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
      expect(tableNames.includes("thread_search_units")).toBeTrue();
      expect(tableNames.includes("thread_search_thread_state")).toBeTrue();
      expect(tableNames.includes("thread_search_units_fts")).toBeTrue();
      expect(tableNames.includes("card_search_units")).toBeTrue();
      expect(tableNames.includes("card_search_units_fts")).toBeTrue();
      expect(tableNames.includes("codex_scheduled_automations")).toBeTrue();
      expect(tableNames.includes("codex_background_processes")).toBeTrue();
      expect(tableNames.includes("codex_thread_card_links")).toBeFalse();
      expect(tableNames.includes("card_history_snapshots")).toBeTrue();
      expect(tableColumnNames(db, "codex_threads").includes("card_id")).toBeFalse();
      expect(tableColumnNames(db, "codex_threads").includes("thread_source")).toBeTrue();

      const threadSearchColumns = tableColumnNames(db, "thread_search_units");
      expect(threadSearchColumns.includes("project_id")).toBeTrue();
      expect(threadSearchColumns.includes("session_id")).toBeTrue();
      const threadSearchStateColumns = tableColumnNames(db, "thread_search_thread_state");
      expect(threadSearchStateColumns.includes("index_version")).toBeTrue();
      expect(threadSearchStateColumns.includes("last_error")).toBeTrue();
      expect(threadSearchStateColumns.includes("failed_at")).toBeTrue();
      expect(threadSearchStateColumns.includes("retry_after")).toBeTrue();
      const threadSearchTrigger = db.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name = 'thread_search_units_ai'
      `).get();
      expect(threadSearchTrigger !== undefined).toBeTrue();
      const cardSearchTrigger = db.prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name = 'card_search_units_ai'
      `).get();
      expect(cardSearchTrigger !== undefined).toBeTrue();

      const sessionColumnNames = tableColumnNames(db, "project_sessions");
      expect(sessionColumnNames.includes("title")).toBeFalse();
      expect(sessionColumnNames.includes("no_thread_fallback_title")).toBeTrue();
      expect(sessionColumnNames.includes("panel_state_json")).toBeTrue();
      expect(sessionColumnNames.includes("is_overview")).toBeFalse();
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
        `).run("missing-session", defaultProjectId, JSON.stringify({ projectId: defaultProjectId, view: "kanban" }));
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
        `).run("missing-session", defaultProjectId, JSON.stringify({ projectId: defaultProjectId }));
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
        `).run("missing-session", defaultProjectId, JSON.stringify({ projectId: defaultProjectId }));
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
        `).run("missing-session", defaultProjectId, JSON.stringify({ projectId: defaultProjectId }));
      } catch {
        legacyFilesKindRejected = true;
      }
      expect(legacyFilesKindRejected).toBeTrue();

      const databaseViewSession = db.prepare(`
        SELECT id, project_id, no_thread_fallback_title, "order", pinned, pinned_order, left_pane_collapsed, panel_state_json
        FROM project_sessions
        WHERE project_id = ?
      `).get(defaultProjectId) as
        | {
          id: string;
          project_id: string;
          no_thread_fallback_title: string;
          order: number;
          pinned: number;
          pinned_order: number | null;
          left_pane_collapsed: number;
          panel_state_json: string;
        }
        | undefined;
      expect(databaseViewSession !== undefined).toBeTrue();
      expect(databaseViewSession?.id.startsWith("overview:") ?? true).toBeFalse();
      expect(databaseViewSession?.project_id).toBe(defaultProjectId);
      expect(databaseViewSession?.no_thread_fallback_title).toBe("Database View");
      expect(databaseViewSession?.order).toBe(0);
      expect(databaseViewSession?.pinned).toBe(1);
      expect(databaseViewSession?.pinned_order).toBe(0);
      expect(databaseViewSession?.left_pane_collapsed).toBe(1);

      const databaseViewTab = db.prepare(`
        SELECT id, panel_id, kind, config_json
        FROM project_session_tabs
        WHERE session_id = ?
      `).get(databaseViewSession?.id ?? "") as { id: string; panel_id: string; kind: string; config_json: string } | undefined;
      expect(databaseViewTab !== undefined).toBeTrue();
      expect(databaseViewTab?.id.startsWith("overview:") ?? true).toBeFalse();
      expect(databaseViewTab?.panel_id).toBe("right");
      expect(databaseViewTab?.kind).toBe("db_view");
      expect(databaseViewTab?.config_json).toBe(JSON.stringify({ projectId: defaultProjectId, view: "kanban" }));

      const parsedPanelState = JSON.parse(databaseViewSession?.panel_state_json ?? "{}") as {
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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates v38 by creating card history snapshot storage", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-history-snapshots-"));
    process.env.NODEX_DIR = tempDir;

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates v39 by repairing card-stage target project configs", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-card-stage-target-"));
    process.env.NODEX_DIR = tempDir;

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
            id, project_id, no_thread_fallback_title, is_overview, "order", left_pane_collapsed,
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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("rejects explicit older schema versions", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-old-"));
    process.env.NODEX_DIR = tempDir;
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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates v32 browser tabs from the legacy key to browser", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-browser-migration-"));
    process.env.NODEX_DIR = tempDir;

    let db: Database.Database;
    try {
      db = new Database(getDatabasePath());
    } catch (error) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
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
      delete process.env.NODEX_DIR;
    }
  });

  test("migrates v33 by removing durable side chat placeholder tabs", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-side-chat-migration-"));
    process.env.NODEX_DIR = tempDir;

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates schema 30 by dropping right pane mirror columns", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v30-panels-"));
    process.env.NODEX_DIR = tempDir;

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates files placeholder tabs into files tabs", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v34-files-"));
    process.env.NODEX_DIR = tempDir;

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates schema 35 slug projects into UUID source-backed projects", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v35-project-sources-"));
    process.env.NODEX_DIR = tempDir;

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates schema 36 by dropping aliases while preserving UUID source-backed projects", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v36-project-sources-"));
    process.env.NODEX_DIR = tempDir;

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates main branch schema 26 into project sessions", async () => {
    closeDatabase();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v26-main-"));
    process.env.NODEX_DIR = tempDir;

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
        SELECT s.project_id, s.no_thread_fallback_title, s.is_overview, pst.thread_id, pst.linked_at
        FROM project_session_threads pst
        JOIN project_sessions s ON s.id = pst.session_id
        WHERE pst.thread_id = 'thread-1'
      `).get() as {
        project_id: string;
        no_thread_fallback_title: string;
        is_overview: number;
        thread_id: string;
        linked_at: string;
      } | undefined;
      expect(sessionLink?.project_id).toBe(alphaProjectId);
      expect(sessionLink?.no_thread_fallback_title).toBe("Card thread");
      expect(sessionLink?.is_overview).toBe(0);
      expect(sessionLink?.linked_at).toBe("2026-01-01T00:00:00.000Z");

      const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
      expect(sessionColumnNames.includes("title")).toBeFalse();
      expect(sessionColumnNames.includes("no_thread_fallback_title")).toBeTrue();
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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates legacy card thread links into project session thread ownership", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-link-migrate-"));
    process.env.NODEX_DIR = tempDir;

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
      const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
      expect(sessionColumnNames.includes("title")).toBeFalse();
      expect(sessionColumnNames.includes("no_thread_fallback_title")).toBeTrue();
      expect(tableColumnNames(migrated, "codex_threads").includes("card_id")).toBeFalse();
      const oldLinkTable = migrated.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'codex_thread_card_links'
      `).get();
      expect(oldLinkTable === undefined).toBeTrue();

      const sessionLink = migrated.prepare(`
        SELECT s.project_id, s.no_thread_fallback_title, s.is_overview, pst.thread_id, pst.linked_at
        FROM project_session_threads pst
        JOIN project_sessions s ON s.id = pst.session_id
        WHERE pst.thread_id = 'thread-1'
      `).get() as {
        project_id: string;
        no_thread_fallback_title: string;
        is_overview: number;
        thread_id: string;
        linked_at: string;
      } | undefined;
      expect(sessionLink?.project_id).toBe("alpha");
      expect(sessionLink?.no_thread_fallback_title).toBe("Linked thread");
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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates project session title into no-thread fallback title", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-session-title-migrate-"));
    process.env.NODEX_DIR = tempDir;

    let initializationRan = true;
    try {
      const dbPath = getDatabasePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      const panelStateJson = JSON.stringify({
        right: {
          collapsed: true,
          layout: {
            version: 2,
            root: { type: "leaf", id: "main", tabIds: [], activeTabId: null },
            activeLeafId: "main",
            mruLeafIds: ["main"],
          },
          size: { widthPx: 600, fullWidth: false },
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
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE TABLE codex_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
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
        CREATE UNIQUE INDEX idx_project_sessions_overview
          ON project_sessions(project_id)
          WHERE is_overview = 1;
        CREATE INDEX idx_project_sessions_project_order
          ON project_sessions(project_id, "order", created_at);
        CREATE INDEX idx_project_sessions_project_sidebar
          ON project_sessions(project_id, archived, pinned, pinned_order, "order");
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

        INSERT INTO projects (id, name, description, icon, created, updated)
        VALUES ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
        INSERT INTO project_sessions (
          id, project_id, title, is_overview, "order", pinned, pinned_order, archived,
          archived_at, unread, left_pane_collapsed, panel_state_json, created_at, updated_at
        ) VALUES (
          'session-1', 'alpha', 'New thread', 0, 1, 0, NULL, 0,
          NULL, 0, 0, '${panelStateJson.replace(/'/g, "''")}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO codex_threads (
          thread_id, project_id, parent_thread_id, thread_name, thread_preview,
          model_provider, cwd, status_type, status_active_flags_json, archived,
          created_at, updated_at, linked_at
        ) VALUES (
          'thread-1', 'alpha', NULL, 'Generated title', 'Preview fallback',
          'openai', '/tmp/alpha', 'idle', '[]', 0, 10, 20, '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO project_session_threads (session_id, thread_id, linked_at)
        VALUES ('session-1', 'thread-1', '2026-01-01T00:00:00.000Z');
        PRAGMA user_version = 41;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      const version = migrated.prepare("PRAGMA user_version").get() as
        | { user_version: number }
        | undefined;
      expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

      const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
      expect(sessionColumnNames.includes("title")).toBeFalse();
      expect(sessionColumnNames.includes("no_thread_fallback_title")).toBeTrue();

      const migratedSession = migrated.prepare(`
        SELECT no_thread_fallback_title
        FROM project_sessions
        WHERE id = 'session-1'
      `).get() as { no_thread_fallback_title: string } | undefined;
      expect(migratedSession?.no_thread_fallback_title).toBe("New thread");

      const linkedThread = migrated.prepare(`
        SELECT t.thread_name
        FROM project_session_threads pst
        JOIN codex_threads t ON t.thread_id = pst.thread_id
        WHERE pst.session_id = 'session-1'
      `).get() as { thread_name: string | null } | undefined;
      expect(linkedThread?.thread_name).toBe("Generated title");

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("repairs a supported schema 42 database missing no-thread fallback titles", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v42-title-repair-"));
    process.env.NODEX_DIR = tempDir;

    let initializationRan = true;
    try {
      const dbPath = getDatabasePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      const panelStateJson = JSON.stringify({
        right: {
          collapsed: true,
          layout: {
            version: 2,
            root: { type: "leaf", id: "main", tabIds: [], activeTabId: null },
            activeLeafId: "main",
            mruLeafIds: ["main"],
          },
          size: { widthPx: 600, fullWidth: false },
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

      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          icon TEXT NOT NULL DEFAULT '',
          created TEXT NOT NULL,
          updated TEXT NOT NULL
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
        CREATE INDEX idx_project_sessions_project_order
          ON project_sessions(project_id, "order", created_at);
        CREATE INDEX idx_project_sessions_project_sidebar
          ON project_sessions(project_id, archived, pinned, pinned_order, "order");
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
        CREATE TABLE codex_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
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
          session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL REFERENCES codex_threads(thread_id) ON DELETE CASCADE,
          linked_at TEXT NOT NULL
        ) WITHOUT ROWID;

        INSERT INTO projects (id, name, description, icon, created, updated)
        VALUES ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      `);
      db.prepare(`
        INSERT INTO project_sessions (
          id, project_id, title, is_overview, "order", pinned, pinned_order,
          archived, archived_at, unread, left_pane_collapsed, panel_state_json, created_at, updated_at
        ) VALUES (
          'session-1', 'alpha', 'Recovered fallback', 0, 1, 0, NULL,
          0, NULL, 0, 0, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `).run(panelStateJson);
      db.exec("PRAGMA user_version = 42");
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
        expect(sessionColumnNames.includes("title")).toBeFalse();
        expect(sessionColumnNames.includes("no_thread_fallback_title")).toBeTrue();

        const migratedSession = migrated.prepare(`
          SELECT no_thread_fallback_title
          FROM project_sessions
          WHERE id = 'session-1'
        `).get() as { no_thread_fallback_title: string } | undefined;
        expect(migratedSession?.no_thread_fallback_title).toBe("Recovered fallback");

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("repairs schema 46 project sessions before seeding startup sessions", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v46-session-repair-"));
    process.env.NODEX_DIR = tempDir;

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
        CREATE TABLE project_order (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE TABLE project_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
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
          CHECK (pinned IN (0, 1)),
          CHECK (archived IN (0, 1)),
          CHECK (unread IN (0, 1)),
          CHECK (left_pane_collapsed IN (0, 1))
        );
        CREATE INDEX idx_project_sessions_project_order
          ON project_sessions(project_id, "order", created_at);
        CREATE INDEX idx_project_sessions_project_sidebar
          ON project_sessions(project_id, archived, pinned, pinned_order, "order");
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
        PRAGMA user_version = 46;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
        expect(sessionColumnNames.includes("no_thread_fallback_title")).toBeTrue();

        const defaultSession = migrated.prepare(`
          SELECT ps.no_thread_fallback_title, pst.kind
          FROM project_sessions ps
          LEFT JOIN project_session_tabs pst ON pst.session_id = ps.id
          WHERE ps.no_thread_fallback_title = 'Database View'
        `).get() as { no_thread_fallback_title: string; kind: string | null } | undefined;
        expect(defaultSession?.no_thread_fallback_title).toBe("Database View");
        expect(defaultSession?.kind).toBe("db_view");

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates schema 43 overview sessions into ordinary Database View sessions", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v43-database-view-"));
    process.env.NODEX_DIR = tempDir;

    let initializationRan = true;
    try {
      const dbPath = getDatabasePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      const oldPanelStateJson = JSON.stringify({
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
            root: { type: "leaf", id: "bottom", tabIds: [], activeTabId: null },
            activeLeafId: "bottom",
            mruLeafIds: ["bottom"],
          },
          size: { heightPx: 280 },
        },
      });
      const collapsedPanelStateJson = JSON.stringify({
        right: {
          collapsed: true,
          layout: {
            version: 2,
            root: { type: "leaf", id: "main", tabIds: [], activeTabId: null },
            activeLeafId: "main",
            mruLeafIds: ["main"],
          },
          size: { widthPx: 600, fullWidth: false },
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

      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          icon TEXT NOT NULL DEFAULT '',
          created TEXT NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE TABLE project_order (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          "order" INTEGER NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE TABLE codex_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
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
        CREATE TABLE project_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          no_thread_fallback_title TEXT NOT NULL,
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
        CREATE UNIQUE INDEX idx_project_sessions_overview
          ON project_sessions(project_id)
          WHERE is_overview = 1;
        CREATE INDEX idx_project_sessions_project_order
          ON project_sessions(project_id, "order", created_at);
        CREATE INDEX idx_project_sessions_project_sidebar
          ON project_sessions(project_id, archived, pinned, pinned_order, "order");
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
        CREATE TABLE codex_pinned_threads (
          thread_id TEXT PRIMARY KEY,
          pinned_order INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO projects (id, name, description, icon, created, updated)
        VALUES
          ('alpha', 'Alpha', '', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
          ('beta', 'Beta', '', '', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
        INSERT INTO project_order (project_id, "order", updated)
        VALUES
          ('alpha', 0, '2026-01-01T00:00:00.000Z'),
          ('beta', 1, '2026-01-02T00:00:00.000Z');
      `);
      db.prepare(`
        INSERT INTO project_sessions (
          id, project_id, no_thread_fallback_title, is_overview, "order", pinned, pinned_order,
          archived, archived_at, unread, left_pane_collapsed, panel_state_json, created_at, updated_at
        ) VALUES
          ('overview:alpha', 'alpha', 'Overview', 1, 9, 0, NULL, 1, '2026-01-05T00:00:00.000Z', 1, 0, ?, '2026-01-01T00:00:00.000Z', '2026-01-05T00:00:00.000Z'),
          ('session-alpha-pinned', 'alpha', 'Pinned notes', 0, 5, 1, 7, 0, NULL, 0, 0, ?, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
          ('session-alpha-normal', 'alpha', 'Normal chat', 0, 2, 0, NULL, 0, NULL, 0, 0, ?, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
          ('session-beta-normal', 'beta', 'Beta chat', 0, 0, 0, NULL, 0, NULL, 0, 0, ?, '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z')
      `).run(oldPanelStateJson, collapsedPanelStateJson, collapsedPanelStateJson, collapsedPanelStateJson);
      db.exec(`
        INSERT INTO project_session_tabs (
          id, session_id, project_id, panel_id, kind, title, config_json,
          state_key, state_json, "order", created_at, updated_at
        ) VALUES (
          'overview:alpha:db', 'overview:alpha', 'alpha', 'right', 'db_view', 'Old DB View',
          '{"projectId":"alpha","view":"list"}', 0, '{}', 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO codex_threads (
          thread_id, project_id, parent_thread_id, thread_name, thread_preview,
          model_provider, cwd, status_type, status_active_flags_json, archived,
          created_at, updated_at, linked_at
        ) VALUES (
          'thread-overview', 'alpha', NULL, 'Old overview link', '',
          'openai', '/tmp/alpha', 'idle', '[]', 0, 1, 2, '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO project_session_threads (session_id, thread_id, linked_at)
        VALUES ('overview:alpha', 'thread-overview', '2026-01-01T00:00:00.000Z');
        PRAGMA user_version = 43;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const sessionColumnNames = tableColumnNames(migrated, "project_sessions");
        expect(sessionColumnNames.includes("is_overview")).toBeFalse();
        const overviewIndex = migrated.prepare(`
          SELECT 1
          FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_project_sessions_overview'
        `).get();
        expect(overviewIndex === undefined).toBeTrue();

        const oldOverviewCount = migrated.prepare(`
          SELECT COUNT(*) AS count
          FROM project_sessions
          WHERE id LIKE 'overview:%'
        `).get() as { count: number };
        expect(oldOverviewCount.count).toBe(0);

        const alphaDatabaseView = migrated.prepare(`
          SELECT id, no_thread_fallback_title, "order", pinned, pinned_order, archived, archived_at,
                 unread, left_pane_collapsed, panel_state_json
          FROM project_sessions
          WHERE project_id = 'alpha' AND no_thread_fallback_title = 'Database View'
        `).get() as {
          id: string;
          no_thread_fallback_title: string;
          order: number;
          pinned: number;
          pinned_order: number | null;
          archived: number;
          archived_at: string | null;
          unread: number;
          left_pane_collapsed: number;
          panel_state_json: string;
        } | undefined;
        expect(alphaDatabaseView !== undefined).toBeTrue();
        expect(alphaDatabaseView?.id.startsWith("overview:") ?? true).toBeFalse();
        expect(alphaDatabaseView?.order).toBe(0);
        expect(alphaDatabaseView?.pinned).toBe(1);
        expect(alphaDatabaseView?.pinned_order).toBe(0);
        expect(alphaDatabaseView?.archived).toBe(0);
        expect(alphaDatabaseView?.archived_at ?? null).toBe(null);
        expect(alphaDatabaseView?.unread).toBe(0);
        expect(alphaDatabaseView?.left_pane_collapsed).toBe(1);

        const panelState = JSON.parse(alphaDatabaseView?.panel_state_json ?? "{}") as {
          right?: { collapsed?: boolean; size?: { fullWidth?: boolean } };
          bottom?: { collapsed?: boolean };
        };
        expect(panelState.right?.collapsed).toBeFalse();
        expect(panelState.right?.size?.fullWidth).toBeTrue();
        expect(panelState.bottom?.collapsed).toBeTrue();

        const alphaDatabaseViewTab = migrated.prepare(`
          SELECT session_id, project_id, panel_id, kind, title, config_json
          FROM project_session_tabs
          WHERE session_id = ?
        `).get(alphaDatabaseView?.id ?? "") as {
          session_id: string;
          project_id: string;
          panel_id: string;
          kind: string;
          title: string;
          config_json: string;
        } | undefined;
        expect(alphaDatabaseViewTab?.session_id).toBe(alphaDatabaseView?.id ?? "");
        expect(alphaDatabaseViewTab?.project_id).toBe("alpha");
        expect(alphaDatabaseViewTab?.panel_id).toBe("right");
        expect(alphaDatabaseViewTab?.kind).toBe("db_view");
        expect(alphaDatabaseViewTab?.title).toBe("DB View");
        expect(alphaDatabaseViewTab?.config_json).toBe(JSON.stringify({ projectId: "alpha", view: "kanban" }));

        const oldOverviewLinkCount = migrated.prepare(`
          SELECT COUNT(*) AS count
          FROM project_session_threads
          WHERE thread_id = 'thread-overview'
        `).get() as { count: number };
        expect(oldOverviewLinkCount.count).toBe(0);

        const alphaPinnedRows = migrated.prepare(`
          SELECT id, pinned_order
          FROM project_sessions
          WHERE project_id = 'alpha' AND pinned = 1
          ORDER BY pinned_order ASC
        `).all() as Array<{ id: string; pinned_order: number | null }>;
        expect(JSON.stringify(alphaPinnedRows.map((row) => row.id))).toBe(JSON.stringify([
          alphaDatabaseView?.id ?? "",
          "session-alpha-pinned",
        ]));
        expect(alphaPinnedRows[0]?.pinned_order).toBe(0);
        expect(alphaPinnedRows[1]?.pinned_order).toBe(1);

        const betaDatabaseView = migrated.prepare(`
          SELECT id, no_thread_fallback_title, pinned, pinned_order
          FROM project_sessions
          WHERE project_id = 'beta' AND no_thread_fallback_title = 'Database View'
        `).get() as { id: string; no_thread_fallback_title: string; pinned: number; pinned_order: number | null } | undefined;
        expect(betaDatabaseView !== undefined).toBeTrue();
        expect(betaDatabaseView?.id.startsWith("overview:") ?? true).toBeFalse();
        expect(betaDatabaseView?.pinned).toBe(1);
        expect(betaDatabaseView?.pinned_order).toBe(0);

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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates schema 48 codex threads with nullable thread source", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-thread-source-"));
    process.env.NODEX_DIR = tempDir;
    let initializationRan = true;

    try {
      const dbPath = getDatabasePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE codex_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT,
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
        INSERT INTO codex_threads (
          thread_id, project_id, parent_thread_id, thread_name, thread_preview,
          model_provider, cwd, status_type, status_active_flags_json, archived,
          created_at, updated_at, linked_at
        ) VALUES (
          'thread-1', NULL, NULL, 'Existing thread', '', 'openai', NULL,
          'idle', '[]', 0, 1, 2, '1970-01-01T00:00:00.000Z'
        );
        PRAGMA user_version = 48;
      `);
      db.close();

      await initializeDatabase();

      const migrated = new Database(dbPath, { readonly: true });
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);
        const columnNames = tableColumnNames(migrated, "codex_threads");
        expect(columnNames.includes("thread_source")).toBeTrue();
        expect(columnNames.includes("agent_nickname")).toBeTrue();
        expect(columnNames.includes("agent_role")).toBeTrue();
        expect(columnNames.includes("managed_worktree_path")).toBeTrue();
        expect(columnNames.includes("projectless_output_directory")).toBeTrue();
        expect(columnNames.includes("projectless_workspace_browser_root")).toBeTrue();
        const row = migrated.prepare("SELECT thread_name, thread_source, agent_nickname, agent_role, projectless_output_directory, projectless_workspace_browser_root FROM codex_threads WHERE thread_id = 'thread-1'")
          .get() as {
            thread_name: string;
            thread_source: string | null;
            agent_nickname: string | null;
            agent_role: string | null;
            projectless_output_directory: string | null;
            projectless_workspace_browser_root: string | null;
          } | undefined;
        expect(row?.thread_name).toBe("Existing thread");
        expect(row?.thread_source).toBe(null);
        expect(row?.agent_nickname).toBe(null);
        expect(row?.agent_role).toBe(null);
        expect(row?.projectless_output_directory).toBe(null);
        expect(row?.projectless_workspace_browser_root).toBe(null);
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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });

  test("migrates schema 51 by creating scheduled automation storage", async () => {
    closeDatabase();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-scheduled-automations-"));
    process.env.NODEX_DIR = tempDir;
    let initializationRan = true;

    try {
      await initializeDatabase();
      closeDatabase();

      const db = new Database(getDatabasePath());
      try {
        db.exec(`
          DROP TABLE IF EXISTS codex_scheduled_automations;
          PRAGMA user_version = 51;
        `);
      } finally {
        db.close();
      }

      await initializeDatabase();

      const migrated = new Database(getDatabasePath(), { readonly: false });
      try {
        const version = migrated.prepare("PRAGMA user_version").get() as
          | { user_version: number }
          | undefined;
        expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

        const scheduledAutomationColumnNames = tableColumnNames(migrated, "codex_scheduled_automations");
        expect(scheduledAutomationColumnNames.includes("automation_id")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("kind")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("status")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("target_thread_id")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("name")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("prompt")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("rrule")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("model")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("reasoning_effort")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("cwds_json")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("execution_environment")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("local_environment_config_path")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("next_run_at")).toBeTrue();
        expect(scheduledAutomationColumnNames.includes("last_run_at")).toBeTrue();

        const scheduledAutomationTableSql = migrated.prepare(`
          SELECT sql
          FROM sqlite_master
          WHERE type = 'table' AND name = 'codex_scheduled_automations'
        `).get() as { sql: string } | undefined;
        expect((scheduledAutomationTableSql?.sql ?? "").includes("WITHOUT ROWID")).toBeTrue();

        const scheduledAutomationIndex = migrated.prepare(`
          SELECT 1
          FROM sqlite_master
          WHERE type = 'index'
            AND name = 'idx_codex_scheduled_automations_target'
        `).get();
        expect(scheduledAutomationIndex !== undefined).toBeTrue();

        const automationRunColumnNames = tableColumnNames(migrated, "codex_automation_runs");
        expect(automationRunColumnNames.includes("thread_id")).toBeTrue();
        expect(automationRunColumnNames.includes("automation_id")).toBeTrue();
        expect(automationRunColumnNames.includes("status")).toBeTrue();
        expect(automationRunColumnNames.includes("read_at")).toBeTrue();

        const codexThreadColumnNames = tableColumnNames(migrated, "codex_threads");
        expect(codexThreadColumnNames.includes("thread_source")).toBeTrue();
        expect(codexThreadColumnNames.includes("agent_nickname")).toBeTrue();
        expect(codexThreadColumnNames.includes("agent_role")).toBeTrue();
        expect(codexThreadColumnNames.includes("projectless_output_directory")).toBeTrue();

        migrated.prepare(`
          INSERT INTO codex_scheduled_automations (
            automation_id, kind, status, target_thread_id, name, rrule, next_run_at, created_at, updated_at
          ) VALUES (
            'automation-heartbeat', 'heartbeat', 'ACTIVE', 'thread-1', 'Scheduled check',
            'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 1783503000000, 10, 20
          )
        `).run();
        const inserted = migrated.prepare(`
          SELECT kind, status, target_thread_id, name
          FROM codex_scheduled_automations
          WHERE automation_id = 'automation-heartbeat'
        `).get() as { kind: string; status: string; target_thread_id: string; name: string } | undefined;
        expect(inserted?.kind).toBe("heartbeat");
        expect(inserted?.status).toBe("ACTIVE");
        expect(inserted?.target_thread_id).toBe("thread-1");
        expect(inserted?.name).toBe("Scheduled check");
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
      delete process.env.NODEX_DIR;
    }

    if (!initializationRan) {
      expect(true).toBeTrue();
    }
  });
});
