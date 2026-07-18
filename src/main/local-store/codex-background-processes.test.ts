import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listCodexBackgroundProcesses,
  makeCodexBackgroundProcessRecordId,
  upsertCodexBackgroundProcess,
} from "./codex-background-processes";
import { closeDatabase, initializeDatabase } from "./database";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void> | void): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-background-processes-"));
  process.env.NODEX_HOME = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_HOME;
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
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

describe("codex background process store", () => {
  test("persists process records in updated order and keeps original start time", async () => {
    const ran = await withTempDatabase(() => {
      upsertCodexBackgroundProcess({
        id: makeCodexBackgroundProcessRecordId({
          threadId: "thread-1",
          itemId: "item-old",
          processId: "process-old",
        }),
        threadId: "thread-1",
        threadTitle: "Thread 1",
        itemId: "item-old",
        turnId: "turn-old",
        command: "bun test",
        cwd: "/repo",
        processId: "process-old",
        osPid: 1200,
        terminalSessionId: null,
        source: "app-server",
        startedAtMs: 10,
        updatedAtMs: 10,
      });
      const updated = upsertCodexBackgroundProcess({
        id: makeCodexBackgroundProcessRecordId({
          threadId: "thread-1",
          itemId: "item-old",
          processId: "process-new",
        }),
        threadId: "thread-1",
        threadTitle: "Thread 1 renamed",
        itemId: "item-old",
        turnId: "turn-old",
        command: "bun test --watch",
        cwd: "/repo",
        processId: "process-new",
        osPid: null,
        terminalSessionId: "terminal-1",
        source: "terminal-action",
        startedAtMs: 99,
        updatedAtMs: 30,
      });
      upsertCodexBackgroundProcess({
        id: makeCodexBackgroundProcessRecordId({
          threadId: "thread-1",
          itemId: "item-new",
        }),
        threadId: "thread-1",
        threadTitle: "Thread 1",
        itemId: "item-new",
        turnId: null,
        command: "bun dev",
        cwd: "/repo",
        processId: null,
        osPid: null,
        terminalSessionId: null,
        source: "app-server",
        startedAtMs: 20,
        updatedAtMs: 20,
      });

      const records = listCodexBackgroundProcesses("thread-1");
      expect(records.length).toBe(2);
      expect(records[0]?.itemId).toBe("item-old");
      expect(records[1]?.itemId).toBe("item-new");
      expect(updated.startedAtMs).toBe(10);
      expect(updated.updatedAtMs).toBe(30);
      expect(updated.threadTitle).toBe("Thread 1 renamed");
      expect(updated.command).toBe("bun test --watch");
      expect(updated.processId).toBe("process-new");
      expect(updated.terminalSessionId).toBe("terminal-1");
    });

    if (!ran) expect(true).toBe(true);
  });

  test("lists records by thread scope", async () => {
    const ran = await withTempDatabase(() => {
      upsertCodexBackgroundProcess({
        id: makeCodexBackgroundProcessRecordId({ threadId: "thread-a", itemId: "item-a" }),
        threadId: "thread-a",
        threadTitle: null,
        itemId: "item-a",
        turnId: null,
        command: "npm run dev",
        cwd: null,
        processId: null,
        osPid: null,
        terminalSessionId: null,
        source: "app-server",
        startedAtMs: 10,
        updatedAtMs: 10,
      });
      upsertCodexBackgroundProcess({
        id: makeCodexBackgroundProcessRecordId({ threadId: "thread-b", itemId: "item-b" }),
        threadId: "thread-b",
        threadTitle: null,
        itemId: "item-b",
        turnId: null,
        command: "npm test",
        cwd: null,
        processId: null,
        osPid: null,
        terminalSessionId: null,
        source: "app-server",
        startedAtMs: 20,
        updatedAtMs: 20,
      });

      expect(listCodexBackgroundProcesses("thread-a").map((record) => record.threadId).join(",")).toBe("thread-a");
      expect(listCodexBackgroundProcesses().length).toBe(2);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("can refresh start time for terminal action restarts", async () => {
    const ran = await withTempDatabase(() => {
      const id = makeCodexBackgroundProcessRecordId({ threadId: "thread-run", itemId: "item-run" });
      upsertCodexBackgroundProcess({
        id,
        threadId: "thread-run",
        threadTitle: null,
        itemId: "item-run",
        turnId: null,
        command: "npm run dev",
        cwd: "/repo",
        processId: null,
        osPid: null,
        terminalSessionId: "terminal-old",
        source: "terminal-action",
        startedAtMs: 10,
        updatedAtMs: 10,
      });
      const restarted = upsertCodexBackgroundProcess({
        id,
        threadId: "thread-run",
        threadTitle: null,
        itemId: "item-run",
        turnId: null,
        command: "npm run dev",
        cwd: "/repo",
        processId: null,
        osPid: null,
        terminalSessionId: "terminal-new",
        source: "terminal-action",
        startedAtMs: 30,
        updatedAtMs: 30,
      }, { preserveStartedAt: false });

      expect(restarted.startedAtMs).toBe(30);
      expect(restarted.terminalSessionId).toBe("terminal-new");
    });

    if (!ran) expect(true).toBe(true);
  });
});
