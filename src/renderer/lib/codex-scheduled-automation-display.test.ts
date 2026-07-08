import { describe, expect, test } from "bun:test";
import { formatCodexScheduledAutomationRruleSummary } from "./codex-scheduled-automation-display";

describe("codex scheduled automation display", () => {
  test("formats calendar RRULE strings with DTSTART lines", () => {
    expect(formatCodexScheduledAutomationRruleSummary(
      "DTSTART;TZID=Asia/Shanghai:20260710T090000\nRRULE:FREQ=DAILY",
    )).toBe("Daily");
  });
});
