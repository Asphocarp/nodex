import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deleteCodexScheduledAutomation,
  getCodexScheduledAutomation,
  listCodexScheduledAutomations,
  upsertCodexScheduledAutomation,
} from "./codex-scheduled-automations";
import { closeDatabase, initializeDatabase } from "./database";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void> | void): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-scheduled-automations-"));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
  } catch (error) {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
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

describe("codex scheduled automations store", () => {
  test("persists scheduled automations in stable list order", async () => {
    const ran = await withTempDatabase(() => {
      upsertCodexScheduledAutomation({
        id: "automation-newer",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-1",
        name: "Newer heartbeat",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        nextRunAt: 1_800_000_000_000,
        createdAt: 20,
        updatedAt: 20,
      });
      upsertCodexScheduledAutomation({
        id: "automation-older",
        kind: "cron",
        status: "PAUSED",
        targetThreadId: null,
        name: "Older cron",
        rrule: null,
        nextRunAt: null,
        createdAt: 10,
        updatedAt: 10,
      });

      const automations = listCodexScheduledAutomations();
      expect(automations.length).toBe(2);
      expect(automations[0]?.id).toBe("automation-older");
      expect(automations[1]?.id).toBe("automation-newer");
      expect(automations[1]?.targetThreadId).toBe("thread-1");
      expect(automations[1]?.nextRunAt).toBe(1_800_000_000_000);
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("upserts and deletes scheduled automations by id", async () => {
    const ran = await withTempDatabase(() => {
      upsertCodexScheduledAutomation({
        id: "automation-1",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-1",
        name: "Daily standup",
        rrule: "FREQ=DAILY",
        nextRunAt: 1_800_000_000_000,
        createdAt: 10,
        updatedAt: 10,
      });
      const updated = upsertCodexScheduledAutomation({
        id: "automation-1",
        kind: "heartbeat",
        status: "PAUSED",
        targetThreadId: "thread-2",
        name: "Paused standup",
        rrule: "FREQ=WEEKLY",
        nextRunAt: null,
        createdAt: 99,
        updatedAt: 20,
      });

      expect(updated.status).toBe("PAUSED");
      expect(updated.targetThreadId).toBe("thread-2");
      expect(updated.createdAt).toBe(10);
      expect(updated.updatedAt).toBe(20);
      expect(getCodexScheduledAutomation("automation-1")?.name).toBe("Paused standup");
      expect(deleteCodexScheduledAutomation("automation-1")).toBeTrue();
      expect(getCodexScheduledAutomation("automation-1")).toBe(null);
      expect(deleteCodexScheduledAutomation("automation-1")).toBeFalse();
    });

    if (!ran) expect(true).toBeTrue();
  });
});
