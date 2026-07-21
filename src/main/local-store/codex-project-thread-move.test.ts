import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodexProjectThreadMoveError,
  getCodexProjectThreadOrder,
  moveCodexProjectThread,
  setCodexProjectThreadOrder,
} from "./codex-project-thread-move";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  createProjectSession,
  createProjectSessionTab,
  listProjectSessions,
  reorderProjectSessions,
  upsertProjectSessionThreadLink,
} from "./project-sessions";
import { createProject } from "./projects";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void> | void): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-project-thread-move-"));
  process.env.NODEX_HOME = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (!isUnsupportedSqliteError(error)) throw error;
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_HOME;
    return false;
  }

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_HOME;
  }
}

function createThreadSession(projectId: string | null, threadId: string, title: string): string {
  const session = createProjectSession({
    projectId,
    noThreadFallbackTitle: title,
  });
  upsertProjectSessionThreadLink({
    sessionId: session.id,
    projectId,
    threadId,
    threadName: title,
    threadPreview: `${title} preview`,
    modelProvider: "openai",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return session.id;
}

function databaseViewSessionId(projectId: string): string {
  const databaseView = listProjectSessions(projectId).find((session) => session.thread === null);
  if (!databaseView) throw new Error(`Missing Database View for ${projectId}`);
  return databaseView.id;
}

function listRawSessionIds(projectId: string | null): string[] {
  return getDb().prepare(`
    SELECT id
    FROM project_sessions
    WHERE project_id IS ?
    ORDER BY "order" ASC, created_at ASC, id ASC
  `).all(projectId).map((row) => (row as { id: string }).id);
}

function readScalar<T>(sql: string, ...params: unknown[]): T | null {
  const row = getDb().prepare(sql).get(...params) as { value: T | null } | undefined;
  return row?.value ?? null;
}

function seedCustomOrder(projectId: string, threadIds: readonly string[]): void {
  getDb().prepare(`
    INSERT INTO codex_project_thread_orders (
      project_id, ordered_thread_ids_json, updated_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      ordered_thread_ids_json = excluded.ordered_thread_ids_json,
      updated_at = excluded.updated_at
  `).run(projectId, JSON.stringify(threadIds), new Date().toISOString());
}

function errorCode(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof CodexProjectThreadMoveError ? error.code : String(error);
  }
}

function snapshotMoveState(threadId: string): string {
  const database = getDb();
  return JSON.stringify({
    thread: database.prepare(`
      SELECT thread_id, project_id, updated_at
      FROM codex_threads
      WHERE thread_id = ?
    `).get(threadId),
    sessions: database.prepare(`
      SELECT id, project_id, "order", pinned_order, updated_at
      FROM project_sessions
      ORDER BY project_id, "order", id
    `).all(),
    tabs: database.prepare(`
      SELECT id, session_id, project_id, config_json, updated_at
      FROM project_session_tabs
      ORDER BY id
    `).all(),
    customOrders: database.prepare(`
      SELECT project_id, ordered_thread_ids_json, updated_at
      FROM codex_project_thread_orders
      ORDER BY project_id
    `).all(),
  });
}

describe("Codex project thread move storage", () => {
  test("moves one real thread atomically while keeping sidebar placement out of session layout", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Source", sources: ["/tmp/source"] });
      const target = createProject({ name: "Target", sources: ["/tmp/target"] });
      const third = createProject({ name: "Third", sources: ["/tmp/third"] });
      const unrelated = createProject({ name: "Unrelated", sources: ["/tmp/unrelated"] });
      const sourceDatabaseView = databaseViewSessionId(source.id);
      const targetDatabaseView = databaseViewSessionId(target.id);
      const movedSession = createThreadSession(source.id, "thread-moved", "Moved");
      const sourceHiddenSession = createThreadSession(source.id, "thread-source-hidden", "Source hidden");
      const targetHiddenSession = createThreadSession(target.id, "thread-target-hidden", "Target hidden");
      const targetSessionOnly = createProjectSession({
        projectId: target.id,
        noThreadFallbackTitle: "Session only",
      });
      const targetAnchorSession = createThreadSession(target.id, "thread-target-anchor", "Target anchor");
      createThreadSession(unrelated.id, "thread-unrelated", "Unrelated");

      reorderProjectSessions(source.id, [sourceDatabaseView, movedSession, sourceHiddenSession]);
      reorderProjectSessions(target.id, [
        targetDatabaseView,
        targetHiddenSession,
        targetSessionOnly.id,
        targetAnchorSession,
      ]);
      const movedTab = createProjectSessionTab({
        sessionId: movedSession,
        projectId: source.id,
        panelId: "right",
        kind: "terminal",
        title: "Terminal",
        config: {
          projectId: source.id,
          terminalSessionId: "terminal:moved",
        },
      });
      const originalTabConfig = JSON.stringify(movedTab.config);
      getDb().prepare(`
        UPDATE codex_threads
        SET
          cwd = ?,
          managed_worktree_path = ?,
          projectless_output_directory = ?,
          projectless_workspace_browser_root = ?
        WHERE thread_id = ?
      `).run(
        "/tmp/source",
        "/tmp/source/worktree",
        "/tmp/source/output",
        "/tmp/source/browser",
        "thread-moved",
      );

      setCodexProjectThreadOrder(source.id, ["thread-moved", "thread-source-hidden"]);
      seedCustomOrder(target.id, ["thread-target-hidden"]);
      seedCustomOrder(third.id, ["thread-moved", "thread-third-hidden"]);
      seedCustomOrder(unrelated.id, ["thread-unrelated"]);
      getDb().prepare(`
        UPDATE codex_project_thread_orders
        SET updated_at = 'unrelated-sentinel'
        WHERE project_id = ?
      `).run(unrelated.id);

      const result = moveCodexProjectThread({
        threadId: "thread-moved",
        sourceProjectId: source.id,
        targetProjectId: target.id,
        beforeThreadId: "thread-target-anchor",
        threadMetadataPatch: {
          cwd: "/tmp/target",
          managedWorktreePath: null,
          projectlessOutputDirectory: null,
        },
      });

      expect(result.threadId).toBe("thread-moved");
      expect(result.sessionId).toBe(movedSession);
      expect(JSON.stringify(listRawSessionIds(source.id))).toBe(JSON.stringify([
        sourceDatabaseView,
        sourceHiddenSession,
      ]));
      expect(JSON.stringify(listRawSessionIds(target.id))).toBe(JSON.stringify([
        movedSession,
        targetDatabaseView,
        targetHiddenSession,
        targetSessionOnly.id,
        targetAnchorSession,
      ]));
      expect(JSON.stringify(getCodexProjectThreadOrder(source.id))).toBe(
        JSON.stringify(["thread-source-hidden"]),
      );
      expect(JSON.stringify(getCodexProjectThreadOrder(target.id))).toBe(
        JSON.stringify(["thread-target-hidden", "thread-moved", "thread-target-anchor"]),
      );
      expect(JSON.stringify(getCodexProjectThreadOrder(third.id))).toBe(
        JSON.stringify(["thread-third-hidden"]),
      );
      expect(JSON.stringify(getCodexProjectThreadOrder(unrelated.id))).toBe(
        JSON.stringify(["thread-unrelated"]),
      );
      expect(readScalar<string>(
        "SELECT updated_at AS value FROM codex_project_thread_orders WHERE project_id = ?",
        unrelated.id,
      )).toBe("unrelated-sentinel");

      expect(readScalar<string>(
        "SELECT project_id AS value FROM codex_threads WHERE thread_id = ?",
        "thread-moved",
      )).toBe(target.id);
      expect(readScalar<string>(
        "SELECT project_id AS value FROM project_sessions WHERE id = ?",
        movedSession,
      )).toBe(target.id);
      expect(readScalar<string>(
        "SELECT project_id AS value FROM project_session_tabs WHERE id = ?",
        movedTab.id,
      )).toBe(target.id);
      expect(readScalar<string>(
        "SELECT config_json AS value FROM project_session_tabs WHERE id = ?",
        movedTab.id,
      )).toBe(originalTabConfig);
      const movedMetadata = getDb().prepare(`
        SELECT
          cwd,
          managed_worktree_path AS managedWorktreePath,
          projectless_output_directory AS projectlessOutputDirectory,
          projectless_workspace_browser_root AS projectlessWorkspaceBrowserRoot
        FROM codex_threads
        WHERE thread_id = ?
      `).get("thread-moved") as {
        cwd: string | null;
        managedWorktreePath: string | null;
        projectlessOutputDirectory: string | null;
        projectlessWorkspaceBrowserRoot: string | null;
      };
      expect(movedMetadata.cwd).toBe("/tmp/target");
      expect(movedMetadata.managedWorktreePath).toBe(null);
      expect(movedMetadata.projectlessOutputDirectory).toBe(null);
      expect(movedMetadata.projectlessWorkspaceBrowserRoot).toBe("/tmp/source/browser");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("uses destination default order without adding the moved thread to any custom order", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Source default", sources: ["/tmp/source-default"] });
      const target = createProject({ name: "Target default", sources: ["/tmp/target-default"] });
      const third = createProject({ name: "Third default", sources: ["/tmp/third-default"] });
      const movedSession = createThreadSession(source.id, "thread-default-move", "Default move");
      const targetThreadSession = createThreadSession(target.id, "thread-default-target", "Default target");
      const targetFixedSession = databaseViewSessionId(target.id);
      reorderProjectSessions(target.id, [targetThreadSession, targetFixedSession]);
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(200, "thread-default-move");
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(100, "thread-default-target");

      setCodexProjectThreadOrder(source.id, ["thread-default-move"]);
      seedCustomOrder(target.id, ["thread-default-target", "thread-default-move"]);
      seedCustomOrder(third.id, ["thread-default-move"]);

      moveCodexProjectThread({
        threadId: "thread-default-move",
        sourceProjectId: source.id,
        targetProjectId: target.id,
        useDefaultOrder: true,
      });

      expect(JSON.stringify(listRawSessionIds(target.id))).toBe(JSON.stringify([
        movedSession,
        targetThreadSession,
        targetFixedSession,
      ]));
      expect(JSON.stringify(getCodexProjectThreadOrder(source.id))).toBe("[]");
      expect(JSON.stringify(getCodexProjectThreadOrder(target.id))).toBe(
        JSON.stringify(["thread-default-target"]),
      );
      expect(JSON.stringify(getCodexProjectThreadOrder(third.id))).toBe("[]");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps the destination custom slots around a default-order cross-project drop", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Source default slots", sources: ["/tmp/source-default-slots"] });
      const target = createProject({ name: "Target default slots", sources: ["/tmp/target-default-slots"] });
      const movedSession = createThreadSession(source.id, "thread-default-new", "Default new");
      const targetASession = createThreadSession(target.id, "thread-default-a", "Default A");
      const targetBSession = createThreadSession(target.id, "thread-default-b", "Default B");
      const fixedSession = databaseViewSessionId(target.id);
      reorderProjectSessions(target.id, [targetASession, fixedSession, targetBSession]);
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(300, "thread-default-new");
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(200, "thread-default-a");
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(100, "thread-default-b");
      setCodexProjectThreadOrder(target.id, ["thread-default-b", "thread-default-a"]);

      moveCodexProjectThread({
        threadId: "thread-default-new",
        sourceProjectId: source.id,
        targetProjectId: target.id,
        useDefaultOrder: true,
      });

      expect(JSON.stringify(listRawSessionIds(target.id))).toBe(JSON.stringify([
        movedSession,
        targetASession,
        fixedSession,
        targetBSession,
      ]));
      expect(JSON.stringify(getCodexProjectThreadOrder(target.id))).toBe(JSON.stringify([
        "thread-default-b",
        "thread-default-a",
      ]));
    });

    if (!ran) expect(true).toBe(true);
  });

  test("supports explicit tail placement and distinguishes absent from empty custom order", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Source tail", sources: ["/tmp/source-tail"] });
      const target = createProject({ name: "Target tail", sources: ["/tmp/target-tail"] });
      const empty = createProject({ name: "Empty order", sources: ["/tmp/empty-order"] });
      const movedSession = createThreadSession(source.id, "thread-tail-move", "Tail move");
      const targetThreadSession = createThreadSession(target.id, "thread-tail-target", "Tail target");

      expect(getCodexProjectThreadOrder(target.id) === null).toBe(true);
      setCodexProjectThreadOrder(empty.id, []);
      expect(JSON.stringify(getCodexProjectThreadOrder(empty.id))).toBe("[]");

      moveCodexProjectThread({
        threadId: "thread-tail-move",
        sourceProjectId: source.id,
        targetProjectId: target.id,
        insertAtEnd: true,
      });

      expect(JSON.stringify(listRawSessionIds(target.id))).toBe(JSON.stringify([
        movedSession,
        targetThreadSession,
        databaseViewSessionId(target.id),
      ]));
      expect(JSON.stringify(getCodexProjectThreadOrder(target.id))).toBe(
        JSON.stringify(["thread-tail-target", "thread-tail-move"]),
      );
      setCodexProjectThreadOrder(target.id, null);
      expect(getCodexProjectThreadOrder(target.id) === null).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("persists sidebar order independently from project-session layout order", async () => {
    const ran = await withTempDatabase(() => {
      const project = createProject({ name: "Custom slots", sources: ["/tmp/custom-slots"] });
      const fixedDatabaseView = databaseViewSessionId(project.id);
      const threadA = createThreadSession(project.id, "thread-slot-a", "Slot A");
      const threadB = createThreadSession(project.id, "thread-slot-b", "Slot B");
      const sessionOnly = createProjectSession({
        projectId: project.id,
        noThreadFallbackTitle: "Fixed local session",
      });
      const threadC = createThreadSession(project.id, "thread-slot-c", "Slot C");
      reorderProjectSessions(project.id, [
        threadA,
        fixedDatabaseView,
        threadB,
        sessionOnly.id,
        threadC,
      ]);

      const sessionLayoutBefore = listRawSessionIds(project.id);
      setCodexProjectThreadOrder(project.id, [
        "thread-slot-c",
        "thread-slot-b",
        "thread-slot-a",
      ]);

      expect(JSON.stringify(listRawSessionIds(project.id))).toBe(
        JSON.stringify(sessionLayoutBefore),
      );
      expect(JSON.stringify(getCodexProjectThreadOrder(project.id))).toBe(
        JSON.stringify(["thread-slot-c", "thread-slot-b", "thread-slot-a"]),
      );

      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(300, "thread-slot-b");
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(200, "thread-slot-a");
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(100, "thread-slot-c");
      setCodexProjectThreadOrder(project.id, null);

      expect(JSON.stringify(listRawSessionIds(project.id))).toBe(
        JSON.stringify(sessionLayoutBefore),
      );
      expect(getCodexProjectThreadOrder(project.id) === null).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("reprojects a same-home default drop and removes only the moved thread from custom order", async () => {
    const ran = await withTempDatabase(() => {
      const project = createProject({ name: "Same home", sources: ["/tmp/same-home"] });
      const fixedDatabaseView = databaseViewSessionId(project.id);
      const movedSession = createThreadSession(project.id, "thread-same-move", "Same move");
      const otherSession = createThreadSession(project.id, "thread-same-other", "Same other");
      reorderProjectSessions(project.id, [movedSession, fixedDatabaseView, otherSession]);
      setCodexProjectThreadOrder(project.id, ["thread-same-move", "thread-same-other"]);
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(100, "thread-same-move");
      getDb().prepare("UPDATE codex_threads SET updated_at = ? WHERE thread_id = ?")
        .run(200, "thread-same-other");

      const sessionLayoutBefore = listRawSessionIds(project.id);
      moveCodexProjectThread({
        threadId: "thread-same-move",
        sourceProjectId: project.id,
        targetProjectId: project.id,
        useDefaultOrder: true,
      });

      expect(JSON.stringify(listRawSessionIds(project.id))).toBe(
        JSON.stringify(sessionLayoutBefore),
      );
      expect(JSON.stringify(getCodexProjectThreadOrder(project.id))).toBe(
        JSON.stringify(["thread-same-other"]),
      );
      expect(readScalar<string>(
        "SELECT project_id AS value FROM codex_threads WHERE thread_id = ?",
        "thread-same-move",
      )).toBe(project.id);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("moves project threads through Chats while retaining tab owner until a project target exists", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Chats source", sources: ["/tmp/chats-source"] });
      const target = createProject({ name: "Chats target", sources: ["/tmp/chats-target"] });
      const movedSession = createThreadSession(source.id, "thread-chats-move", "Chats move");
      const projectlessThreadSession = createThreadSession(null, "thread-projectless", "Projectless");
      const targetAnchorSession = createThreadSession(target.id, "thread-chats-anchor", "Chats anchor");
      const movedTab = createProjectSessionTab({
        sessionId: movedSession,
        projectId: source.id,
        panelId: "right",
        kind: "terminal",
        title: "Terminal",
        config: {
          projectId: source.id,
          terminalSessionId: "terminal:chats-move",
        },
      });
      setCodexProjectThreadOrder(source.id, ["thread-chats-move"]);

      moveCodexProjectThread({
        threadId: "thread-chats-move",
        sourceProjectId: source.id,
        targetProjectId: null,
        useDefaultOrder: true,
      });

      expect(JSON.stringify(listRawSessionIds(null))).toBe(JSON.stringify([
        movedSession,
        projectlessThreadSession,
      ]));
      expect(readScalar<string>(
        "SELECT project_id AS value FROM codex_threads WHERE thread_id = ?",
        "thread-chats-move",
      )).toBe(null);
      expect(readScalar<string>(
        "SELECT project_id AS value FROM project_sessions WHERE id = ?",
        movedSession,
      )).toBe(null);
      expect(readScalar<string>(
        "SELECT project_id AS value FROM project_session_tabs WHERE id = ?",
        movedTab.id,
      )).toBe(source.id);
      expect(JSON.stringify(getCodexProjectThreadOrder(source.id))).toBe("[]");

      moveCodexProjectThread({
        threadId: "thread-chats-move",
        sourceProjectId: null,
        targetProjectId: target.id,
        beforeThreadId: "thread-chats-anchor",
      });

      expect(JSON.stringify(listRawSessionIds(target.id))).toBe(JSON.stringify([
        movedSession,
        targetAnchorSession,
        databaseViewSessionId(target.id),
      ]));
      expect(JSON.stringify(getCodexProjectThreadOrder(target.id))).toBe(JSON.stringify([
        "thread-chats-move",
        "thread-chats-anchor",
      ]));
      expect(readScalar<string>(
        "SELECT project_id AS value FROM codex_threads WHERE thread_id = ?",
        "thread-chats-move",
      )).toBe(target.id);
      expect(readScalar<string>(
        "SELECT project_id AS value FROM project_session_tabs WHERE id = ?",
        movedTab.id,
      )).toBe(target.id);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("falls a missing sidebar anchor back to the tail but rejects a stale membership source", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Source failure", sources: ["/tmp/source-failure"] });
      const target = createProject({ name: "Target failure", sources: ["/tmp/target-failure"] });
      createThreadSession(source.id, "thread-failure-move", "Failure move");
      setCodexProjectThreadOrder(source.id, ["thread-failure-move"]);
      seedCustomOrder(target.id, ["thread-target-hidden"]);
      moveCodexProjectThread({
        threadId: "thread-failure-move",
        sourceProjectId: source.id,
        targetProjectId: target.id,
        beforeThreadId: "thread-missing-anchor",
      });
      expect(readScalar<string>(
        "SELECT project_id AS value FROM codex_threads WHERE thread_id = ?",
        "thread-failure-move",
      )).toBe(target.id);
      expect(JSON.stringify(getCodexProjectThreadOrder(source.id))).toBe(
        JSON.stringify([]),
      );
      expect(JSON.stringify(getCodexProjectThreadOrder(target.id))).toBe(
        JSON.stringify(["thread-target-hidden", "thread-failure-move"]),
      );

      const beforeStaleSource = snapshotMoveState("thread-failure-move");
      expect(errorCode(() => moveCodexProjectThread({
        threadId: "thread-failure-move",
        sourceProjectId: source.id,
        targetProjectId: source.id,
        insertAtEnd: true,
      }))).toBe("stale_source");
      expect(snapshotMoveState("thread-failure-move")).toBe(beforeStaleSource);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rolls membership and manual order back together when sidebar persistence fails", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Source atomic", sources: ["/tmp/source-atomic"] });
      const target = createProject({ name: "Target atomic", sources: ["/tmp/target-atomic"] });
      createThreadSession(source.id, "thread-atomic", "Atomic move");
      createThreadSession(target.id, "thread-atomic-target", "Atomic target");
      setCodexProjectThreadOrder(source.id, ["thread-atomic"]);
      const before = snapshotMoveState("thread-atomic");
      getDb().exec(`
        CREATE TRIGGER reject_project_thread_order_write
        BEFORE INSERT ON codex_project_thread_orders
        BEGIN
          SELECT RAISE(ABORT, 'reject project thread order write');
        END
      `);

      expect(() => moveCodexProjectThread({
        threadId: "thread-atomic",
        sourceProjectId: source.id,
        targetProjectId: target.id,
        insertAtEnd: true,
      })).toThrow("reject project thread order write");
      expect(snapshotMoveState("thread-atomic")).toBe(before);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("tolerates corrupt project order state without blocking membership or sidebar repair", async () => {
    const ran = await withTempDatabase(() => {
      const source = createProject({ name: "Source corrupt order", sources: ["/tmp/source-corrupt"] });
      const target = createProject({ name: "Target corrupt order", sources: ["/tmp/target-corrupt"] });
      const movedSession = createThreadSession(source.id, "thread-corrupt-order", "Corrupt order");
      const corruptOrder = '["thread-duplicate", "thread-duplicate"]';
      getDb().prepare(`
        INSERT INTO codex_project_thread_orders (
          project_id,
          ordered_thread_ids_json,
          updated_at
        ) VALUES (?, ?, ?)
      `).run(target.id, corruptOrder, new Date().toISOString());

      moveCodexProjectThread({
        threadId: "thread-corrupt-order",
        sourceProjectId: source.id,
        targetProjectId: target.id,
        insertAtEnd: true,
      });
      expect(readScalar<string>(
        "SELECT project_id AS value FROM codex_threads WHERE thread_id = ?",
        "thread-corrupt-order",
      )).toBe(target.id);
      expect(readScalar<string>(
        "SELECT project_id AS value FROM project_sessions WHERE id = ?",
        movedSession,
      )).toBe(target.id);
      expect(listRawSessionIds(target.id).includes(movedSession)).toBe(true);
      expect(readScalar<string>(
        "SELECT ordered_thread_ids_json AS value FROM codex_project_thread_orders WHERE project_id = ?",
        target.id,
      )).toBe(JSON.stringify(["thread-corrupt-order"]));
    });

    if (!ran) expect(true).toBe(true);
  });

});
