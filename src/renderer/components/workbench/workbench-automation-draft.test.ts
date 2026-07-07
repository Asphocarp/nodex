import { describe, expect, test } from "bun:test";
import type { CodexScheduledAutomation } from "@/lib/types";
import {
  buildCodexScheduledAutomationUpsertInput,
  createCodexScheduledAutomationId,
  createWorkbenchAutomationDraft,
  formatTimestampForDateTimeLocal,
  isWorkbenchAutomationDraftDirty,
  parseDateTimeLocalTimestamp,
  validateWorkbenchAutomationDraft,
} from "./workbench-automation-draft";

function makeAutomation(overrides: Partial<CodexScheduledAutomation> = {}): CodexScheduledAutomation {
  return {
    id: "automation-1",
    kind: "heartbeat",
    status: "ACTIVE",
    targetThreadId: "thread-1",
    name: "Daily standup",
    rrule: "FREQ=DAILY",
    nextRunAt: new Date(2026, 6, 9, 9, 30).getTime(),
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

describe("workbench automation draft", () => {
  test("builds create payloads with normalized fields", () => {
    const draft = createWorkbenchAutomationDraft({ id: "automation-new" });
    draft.name = "  Weekly triage  ";
    draft.targetThreadId = " thread-alpha ";
    draft.rrule = " FREQ=WEEKLY ";
    draft.nextRunAtLocal = "2026-07-09T09:30";

    const payload = buildCodexScheduledAutomationUpsertInput({
      draft,
      now: 500,
    });

    expect(payload?.id).toBe("automation-new");
    expect(payload?.name).toBe("Weekly triage");
    expect(payload?.targetThreadId).toBe("thread-alpha");
    expect(payload?.rrule).toBe("FREQ=WEEKLY");
    expect(payload?.createdAt).toBe(500);
    expect(payload?.updatedAt).toBe(500);
    expect(payload?.nextRunAt).toBe(parseDateTimeLocalTimestamp("2026-07-09T09:30"));
  });

  test("preserves existing creation time and detects dirty edits", () => {
    const automation = makeAutomation();
    const draft = createWorkbenchAutomationDraft({ automation });
    expect(isWorkbenchAutomationDraftDirty({ draft, existing: automation })).toBeFalse();

    draft.status = "PAUSED";
    draft.nextRunAtLocal = "";
    expect(isWorkbenchAutomationDraftDirty({ draft, existing: automation })).toBeTrue();

    const payload = buildCodexScheduledAutomationUpsertInput({
      draft,
      existing: automation,
      now: 900,
    });
    expect(payload?.createdAt).toBe(100);
    expect(payload?.updatedAt).toBe(900);
    expect(payload?.status).toBe("PAUSED");
    expect(payload?.nextRunAt).toBe(null);
  });

  test("validates required name, RRULE frequency, and local next-run time", () => {
    const draft = createWorkbenchAutomationDraft({ id: "automation-new" });
    draft.name = " ";
    expect(validateWorkbenchAutomationDraft(draft).canSave).toBeFalse();

    draft.name = "Valid name";
    draft.rrule = "INTERVAL=2";
    expect(validateWorkbenchAutomationDraft(draft).canSave).toBeFalse();

    draft.rrule = "FREQ=DAILY";
    draft.nextRunAtLocal = "not-a-date";
    expect(validateWorkbenchAutomationDraft(draft).canSave).toBeFalse();

    draft.nextRunAtLocal = "";
    expect(validateWorkbenchAutomationDraft(draft).canSave).toBeTrue();
  });

  test("formats local datetime inputs and prefixes generated ids", () => {
    const timestamp = new Date(2026, 6, 9, 9, 30).getTime();
    expect(formatTimestampForDateTimeLocal(timestamp)).toBe("2026-07-09T09:30");
    expect(createCodexScheduledAutomationId(() => "abc").startsWith("automation-")).toBeTrue();
  });
});
