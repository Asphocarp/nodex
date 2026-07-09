import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodexSidebarChatOrderError,
  getCodexSidebarChatOrder,
  setCodexSidebarChatOrder,
} from "./codex-sidebar-chat-order";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { createProject } from "./projects";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void> | void): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-sidebar-chat-order-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    if (!isUnsupportedSqliteError(error)) throw error;
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
    return false;
  }

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function insertThread(input: {
  threadId: string;
  projectId?: string | null;
  archived?: boolean;
  updatedAt?: number;
}): void {
  const updatedAt = input.updatedAt ?? 1;
  getDb().prepare(`
    INSERT INTO codex_threads (
      thread_id,
      project_id,
      thread_name,
      thread_preview,
      model_provider,
      status_type,
      status_active_flags_json,
      archived,
      created_at,
      updated_at,
      linked_at
    ) VALUES (?, ?, ?, '', 'openai', 'idle', '[]', ?, ?, ?, ?)
  `).run(
    input.threadId,
    input.projectId ?? null,
    input.threadId,
    input.archived ? 1 : 0,
    updatedAt,
    updatedAt,
    new Date(updatedAt).toISOString(),
  );
}

function pinThread(threadId: string): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO codex_pinned_threads (
      thread_id,
      pinned_order,
      created_at,
      updated_at
    ) VALUES (?, 0, ?, ?)
  `).run(threadId, now, now);
}

function seedChatOrder(orderedThreadIds: readonly string[]): void {
  getDb().prepare(`
    INSERT INTO codex_sidebar_chat_order (
      singleton,
      ordered_thread_ids_json,
      updated_at
    ) VALUES (1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      ordered_thread_ids_json = excluded.ordered_thread_ids_json,
      updated_at = excluded.updated_at
  `).run(JSON.stringify(orderedThreadIds), new Date().toISOString());
}

function readRawOrder(): string | null {
  const row = getDb().prepare(`
    SELECT ordered_thread_ids_json AS value
    FROM codex_sidebar_chat_order
    WHERE singleton = 1
  `).get() as { value: string } | undefined;
  return row?.value ?? null;
}

function errorCode(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof CodexSidebarChatOrderError ? error.code : String(error);
  }
}

describe("Codex sidebar Chats order storage", () => {
  test("replaces only visible projectless slots in the global manual order", async () => {
    const ran = await withTempDatabase(() => {
      const project = createProject({ name: "Project", sources: ["/tmp/project"] });
      insertThread({ threadId: "chat-a" });
      insertThread({ threadId: "project-task", projectId: project.id });
      insertThread({ threadId: "chat-hidden" });
      insertThread({ threadId: "chat-b" });
      insertThread({ threadId: "chat-new" });
      seedChatOrder([
        "chat-a",
        "project-task",
        "stale-task",
        "chat-hidden",
        "chat-b",
      ]);

      const result = setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: [
          "chat-a",
          "project-task",
          "chat-hidden",
          "chat-b",
          "chat-new",
        ],
        visibleThreadIds: ["chat-a", "chat-b"],
        nextVisibleThreadIds: ["chat-b", "chat-a"],
      });

      const expected = [
        "chat-b",
        "project-task",
        "stale-task",
        "chat-hidden",
        "chat-a",
        "chat-new",
      ];
      expect(JSON.stringify(result.orderedThreadIds)).toBe(JSON.stringify(expected));
      expect(JSON.stringify(getCodexSidebarChatOrder())).toBe(JSON.stringify(expected));
      expect(readRawOrder()).toBe(JSON.stringify(expected));
    });
    if (!ran) expect(true).toBe(true);
  });

  test("starts the first manual order from the complete displayed task order", async () => {
    const ran = await withTempDatabase(() => {
      const project = createProject({ name: "Project", sources: ["/tmp/project"] });
      insertThread({ threadId: "chat-a" });
      insertThread({ threadId: "project-task", projectId: project.id });
      insertThread({ threadId: "chat-b" });

      const result = setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["project-task", "chat-a", "chat-b"],
        visibleThreadIds: ["chat-a", "chat-b"],
        nextVisibleThreadIds: ["chat-b", "chat-a"],
      });

      expect(JSON.stringify(result.orderedThreadIds)).toBe(
        JSON.stringify(["project-task", "chat-b", "chat-a"]),
      );
    });
    if (!ran) expect(true).toBe(true);
  });

  test("reconciles a newly discovered task from its canonical visible slot", async () => {
    const ran = await withTempDatabase(() => {
      insertThread({ threadId: "chat-a" });
      insertThread({ threadId: "chat-new" });
      insertThread({ threadId: "chat-b" });
      seedChatOrder(["chat-a", "chat-b"]);

      const result = setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["chat-a", "chat-new", "chat-b"],
        visibleThreadIds: ["chat-a", "chat-new", "chat-b"],
        nextVisibleThreadIds: ["chat-a", "chat-b", "chat-new"],
      });

      expect(JSON.stringify(result.orderedThreadIds)).toBe(
        JSON.stringify(["chat-a", "chat-b", "chat-new"]),
      );
    });
    if (!ran) expect(true).toBe(true);
  });

  test("accepts canonical visible order while rejecting mismatched and non-reorderable inputs atomically", async () => {
    const ran = await withTempDatabase(() => {
      const project = createProject({ name: "Project", sources: ["/tmp/project"] });
      insertThread({ threadId: "chat-a" });
      insertThread({ threadId: "chat-b" });
      insertThread({ threadId: "project-task", projectId: project.id });
      insertThread({ threadId: "pinned-task" });
      insertThread({ threadId: "archived-task", archived: true });
      pinThread("pinned-task");
      seedChatOrder(["chat-a", "project-task", "chat-b", "dormant-task"]);

      const reconciled = setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["chat-a", "project-task", "chat-b"],
        visibleThreadIds: ["chat-b", "chat-a"],
        nextVisibleThreadIds: ["chat-a", "chat-b"],
      });
      expect(JSON.stringify(reconciled.orderedThreadIds)).toBe(JSON.stringify([
        "chat-a",
        "project-task",
        "chat-b",
        "dormant-task",
      ]));
      const afterReconcile = readRawOrder();
      expect(errorCode(() => setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["chat-a", "project-task", "chat-b"],
        visibleThreadIds: ["chat-a", "chat-b"],
        nextVisibleThreadIds: ["chat-a"],
      }))).toBe("invalid_visible_order");
      expect(errorCode(() => setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["chat-a", "project-task", "chat-b"],
        visibleThreadIds: ["project-task"],
        nextVisibleThreadIds: ["project-task"],
      }))).toBe("thread_not_reorderable");
      expect(errorCode(() => setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["chat-a", "pinned-task", "chat-b"],
        visibleThreadIds: ["chat-a", "chat-b"],
        nextVisibleThreadIds: ["chat-b", "chat-a"],
      }))).toBe("thread_not_reorderable");
      expect(errorCode(() => setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["chat-a", "archived-task", "chat-b"],
        visibleThreadIds: ["chat-a", "chat-b"],
        nextVisibleThreadIds: ["chat-b", "chat-a"],
      }))).toBe("thread_not_reorderable");
      expect(readRawOrder()).toBe(afterReconcile);
    });
    if (!ran) expect(true).toBe(true);
  });

  test("rejects corrupt persisted order without rewriting it", async () => {
    const ran = await withTempDatabase(() => {
      insertThread({ threadId: "chat-a" });
      insertThread({ threadId: "chat-b" });
      getDb().prepare(`
        INSERT INTO codex_sidebar_chat_order (
          singleton,
          ordered_thread_ids_json,
          updated_at
        ) VALUES (1, '["chat-a", "chat-a"]', ?)
      `).run(new Date().toISOString());

      expect(errorCode(() => setCodexSidebarChatOrder({
        threadIdsInDisplayOrder: ["chat-a", "chat-b"],
        visibleThreadIds: ["chat-a", "chat-b"],
        nextVisibleThreadIds: ["chat-b", "chat-a"],
      }))).toBe("invalid_custom_order");
      expect(readRawOrder()).toBe('["chat-a", "chat-a"]');
    });
    if (!ran) expect(true).toBe(true);
  });
});
