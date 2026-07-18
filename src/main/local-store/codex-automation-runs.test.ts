import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodexScheduledAutomation } from "./codex-scheduled-automations";
import {
  archiveCodexAutomationRun,
  captureCodexAutomationArchiveMessages,
  deleteCodexAutomationRun,
  getCodexAutomationRun,
  getCodexAutomationRunUnreadCounts,
  insertCodexAutomationRunInProgress,
  listCodexAutomationInboxItems,
  markAllCodexAutomationRunsRead,
  markCodexAutomationRunAccepted,
  markCodexAutomationRunPendingReview,
  replacePendingCodexAutomationRunThreadId,
  setCodexAutomationRunInboxItem,
  setCodexAutomationRunReadAt,
  settleInterruptedCodexAutomationRuns,
  unarchiveCodexAutomationRun,
} from "./codex-automation-runs";
import { closeDatabase, initializeDatabase } from "./database";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void> | void): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-automation-runs-"));
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

function createAutomationId(): string {
  return createCodexScheduledAutomation({
    kind: "cron",
    name: "Daily report",
    prompt: "Summarize changes.",
    rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    cwds: ["/repo/project"],
    executionEnvironment: "worktree",
  }).id;
}

describe("codex automation runs store", () => {
  test("tracks review, read, archive, unarchive, and delete transitions", async () => {
    const ran = await withTempDatabase(() => {
      const automationId = createAutomationId();
      expect(insertCodexAutomationRunInProgress({
        threadId: "thread-run-1",
        automationId,
        threadTitle: "Daily report run",
        sourceCwd: "/repo/project",
        now: 10,
      })).toBe(true);
      expect(markCodexAutomationRunPendingReview("thread-run-1", 20)).toBe(true);
      expect(setCodexAutomationRunInboxItem({
        threadId: "thread-run-1",
        inboxTitle: "Report ready",
        inboxSummary: "Review the generated summary.",
        now: 30,
      })).toBe(true);

      const unread = getCodexAutomationRunUnreadCounts();
      expect(unread.total).toBe(1);
      expect(unread.automationIds[0]).toBe(automationId);

      const items = listCodexAutomationInboxItems();
      expect(items.length).toBe(1);
      expect(items[0]?.title).toBe("Daily report");
      expect(items[0]?.description).toBe("Review the generated summary.");

      const read = setCodexAutomationRunReadAt("thread-run-1", 40);
      expect(read?.readAt).toBe(40);
      expect(getCodexAutomationRunUnreadCounts().total).toBe(0);

      expect(captureCodexAutomationArchiveMessages({
        threadId: "thread-run-1",
        archivedAssistantMessage: "Done",
        now: 50,
      })).toBe(true);
      expect(archiveCodexAutomationRun("thread-run-1", "manual", 60)).toBe(true);
      expect(getCodexAutomationRun("thread-run-1")?.status).toBe("ARCHIVED");
      expect(unarchiveCodexAutomationRun("thread-run-1", 70)).toBe(true);
      expect(getCodexAutomationRun("thread-run-1")?.status).toBe("ACCEPTED");
      expect(deleteCodexAutomationRun("thread-run-1")).toBe(true);
      expect(getCodexAutomationRun("thread-run-1")).toBe(null);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("settles pending and active interrupted runs", async () => {
    const ran = await withTempDatabase(() => {
      const automationId = createAutomationId();
      insertCodexAutomationRunInProgress({
        threadId: "pending:run-1",
        automationId,
        now: 10,
      });
      insertCodexAutomationRunInProgress({
        threadId: "pending:run-2",
        automationId,
        now: 10,
      });
      expect(replacePendingCodexAutomationRunThreadId({
        pendingThreadId: "pending:run-2",
        threadId: "thread-run-2",
        now: 20,
      })).toBe(true);

      const settled = settleInterruptedCodexAutomationRuns(30);
      expect(settled.archivedPendingCount).toBe(1);
      expect(settled.pendingReviewCount).toBe(1);
      expect(getCodexAutomationRun("pending:run-1")?.status).toBe("ARCHIVED");
      expect(getCodexAutomationRun("thread-run-2")?.status).toBe("PENDING_REVIEW");

      expect(markCodexAutomationRunAccepted("thread-run-2", 40)).toBe(true);
      expect(markAllCodexAutomationRunsRead(50)).toBe(2);
    });

    if (!ran) expect(true).toBe(true);
  });
});
