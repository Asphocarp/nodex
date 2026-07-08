import { describe, expect, test } from "bun:test";
import type { CodexAutomationInboxItem } from "@/lib/types";
import {
  buildWorkbenchAutomationPreviousRunRowModel,
  buildWorkbenchAutomationPreviousRunRows,
  formatWorkbenchAutomationRunRelativeTime,
  formatWorkbenchAutomationRunSourceLabel,
} from "./workbench-automation-runs";

function inboxItem(overrides: Partial<CodexAutomationInboxItem> = {}): CodexAutomationInboxItem {
  return {
    id: "thread-run-alpha",
    automationId: "automation-alpha",
    automationName: "Daily report",
    title: "Daily report run",
    description: "Review the run.",
    archivedAssistantMessage: null,
    archivedUserMessage: null,
    archivedReason: null,
    sourceCwd: "/Users/asc/repo/nodex",
    threadId: "thread-run-alpha",
    readAt: null,
    createdAt: 100,
    status: "PENDING_REVIEW",
    ...overrides,
  };
}

describe("workbench automation previous runs", () => {
  test("filters by automation and sorts newest first", () => {
    const rows = buildWorkbenchAutomationPreviousRunRows({
      automationId: "automation-alpha",
      items: [
        inboxItem({ id: "old", threadId: "old", createdAt: 100 }),
        inboxItem({ id: "other", threadId: "other", automationId: "automation-other", createdAt: 300 }),
        inboxItem({ id: "new", threadId: "new", createdAt: 200 }),
      ],
      now: 200,
    });

    expect(rows.length).toBe(2);
    expect(rows[0]?.threadId).toBe("new");
    expect(rows[1]?.threadId).toBe("old");
  });

  test("builds action state from run lifecycle fields", () => {
    const active = buildWorkbenchAutomationPreviousRunRowModel({
      item: inboxItem({ status: "PENDING_REVIEW", readAt: null }),
      now: 1_000,
    });
    expect(active.isUnread).toBeTrue();
    expect(active.canArchive).toBeTrue();
    expect(active.canUnarchive).toBeFalse();
    expect(active.canOpen).toBeTrue();

    const running = buildWorkbenchAutomationPreviousRunRowModel({
      item: inboxItem({ status: "IN_PROGRESS" }),
      now: 1_000,
    });
    expect(running.isInProgress).toBeTrue();
    expect(running.canArchive).toBeFalse();

    const archived = buildWorkbenchAutomationPreviousRunRowModel({
      item: inboxItem({ status: "ARCHIVED", readAt: 500 }),
      now: 1_000,
    });
    expect(archived.isArchived).toBeTrue();
    expect(archived.canArchive).toBeFalse();
    expect(archived.canUnarchive).toBeTrue();
    expect(archived.canOpen).toBeFalse();
  });

  test("formats compact labels", () => {
    expect(formatWorkbenchAutomationRunSourceLabel("/Users/asc/repo/nodex/")).toBe("nodex");
    expect(formatWorkbenchAutomationRunRelativeTime(0, 10)).toBe("now");
    expect(formatWorkbenchAutomationRunRelativeTime(0, 5 * 60_000)).toBe("5m");
    expect(formatWorkbenchAutomationRunRelativeTime(0, 3 * 60 * 60_000)).toBe("3h");
    expect(formatWorkbenchAutomationRunRelativeTime(0, 2 * 24 * 60 * 60_000)).toBe("2d");
  });
});
