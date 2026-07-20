import { describe, expect, test } from "vitest";

import type { PageInput } from "../../shared/types";
import { MAX_PAGE_DESCRIPTION_LENGTH, MAX_PAGE_TITLE_LENGTH } from "../../shared/page-limits";
import { assertValidPageInput } from "../../shared/page-input-validation";

function createValidInput(): PageInput {
  return {
    title: "Ship hardening",
    description: "safe markdown",
    priority: "p2-medium",
    estimate: "m",
    tags: ["security", "nfm"],
    dueDate: new Date("2026-02-12T00:00:00.000Z"),
    assignee: "asc",
    runInTarget: "localProject",
    runInLocalPath: "/tmp/repo",
    runInBaseBranch: "main",
    runInWorktreePath: "/tmp/repo/.worktrees/feature",
    runInEnvironmentPath: ".codex/environments/environment.toml",
  };
}

describe("page input validation", () => {
  test("accepts a valid create payload", () => {
    expect(runValidation(() => assertValidPageInput(createValidInput(), "create"))).toBe(null);
  });

  test("accepts a valid partial update payload", () => {
    expect(
      runValidation(() =>
        assertValidPageInput({ description: "updated", tags: ["safe"] }, "update"),
      ),
    ).toBe(null);
  });

  test("accepts clearing priority with null", () => {
    expect(
      runValidation(() =>
        assertValidPageInput({ priority: null }, "update"),
      ),
    ).toBe(null);
  });

  test("rejects create payload with missing title", () => {
    expect(
      runValidation(() => assertValidPageInput({ description: "x" }, "create")),
    ).toBe("Page title is required");
  });

  test("rejects empty title on update", () => {
    expect(
      runValidation(() => assertValidPageInput({ title: "   " }, "update")),
    ).toBe("Page title cannot be empty");
  });

  test("accepts title at max length", () => {
    expect(
      runValidation(() => assertValidPageInput({ title: "x".repeat(MAX_PAGE_TITLE_LENGTH) }, "update")),
    ).toBe(null);
  });

  test("rejects title above max length", () => {
    expect(
      runValidation(() => assertValidPageInput({ title: "x".repeat(MAX_PAGE_TITLE_LENGTH + 1) }, "update")),
    ).toBe(`title exceeds ${MAX_PAGE_TITLE_LENGTH} characters`);
  });

  test("rejects description above max length", () => {
    const tooLarge = "x".repeat(MAX_PAGE_DESCRIPTION_LENGTH + 1);
    expect(
      runValidation(() => assertValidPageInput({ description: tooLarge }, "update")),
    ).toBe(`description exceeds ${MAX_PAGE_DESCRIPTION_LENGTH} characters`);
  });

  test("rejects invalid dueDate type", () => {
    expect(
      runValidation(() =>
        assertValidPageInput({ dueDate: "2026-02-12" as unknown as Date }, "update"),
      ),
    ).toBe("Invalid dueDate value");
  });

  test("accepts valid scheduled range", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            scheduledStart: new Date("2026-02-18T09:00:00.000Z"),
            scheduledEnd: new Date("2026-02-18T10:00:00.000Z"),
          },
          "update",
        ),
      ),
    ).toBe(null);
  });

  test("accepts all-day schedule with explicit range", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            isAllDay: true,
            scheduledStart: new Date("2026-02-18T00:00:00.000Z"),
            scheduledEnd: new Date("2026-02-19T00:00:00.000Z"),
          },
          "update",
        ),
      ),
    ).toBe(null);
  });

  test("rejects invalid scheduled range", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            scheduledStart: new Date("2026-02-18T10:00:00.000Z"),
            scheduledEnd: new Date("2026-02-18T09:59:00.000Z"),
          },
          "update",
        ),
      ),
    ).toBe("scheduledEnd must be after scheduledStart");
  });

  test("rejects all-day without complete schedule range", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            isAllDay: true,
            scheduledStart: new Date("2026-02-18T00:00:00.000Z"),
          },
          "update",
        ),
      ),
    ).toBe("isAllDay requires scheduledStart and scheduledEnd");
  });

  test("accepts recurrence, reminders, and timezone", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            recurrence: {
              frequency: "weekly",
              interval: 1,
              byWeekdays: [1, 3],
              endCondition: { type: "untilDate", untilDate: "2026-12-31" },
            },
            reminders: [{ offsetMinutes: 10 }, { offsetMinutes: 60 }],
            scheduleTimezone: "America/New_York",
          },
          "update",
        ),
      ),
    ).toBe(null);
  });

  test("rejects weekly recurrence without weekdays", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            recurrence: {
              frequency: "weekly",
              interval: 1,
            },
          },
          "update",
        ),
      ),
    ).toBe("Invalid recurrence value");
  });

  test("rejects duplicate reminder offsets", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            reminders: [{ offsetMinutes: 15 }, { offsetMinutes: 15 }],
          },
          "update",
        ),
      ),
    ).toBe("Duplicate reminder offsets are not allowed");
  });

  test("rejects invalid schedule timezone", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            scheduleTimezone: "Mars/Olympus_Mons",
          },
          "update",
        ),
      ),
    ).toBe('Invalid scheduleTimezone "Mars/Olympus_Mons"');
  });

  test("rejects invalid runInTarget", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            runInTarget: "worktree" as unknown as PageInput["runInTarget"],
          },
          "update",
        ),
      ),
    ).toBe('Invalid runInTarget "worktree"');
  });

  test("accepts empty runInLocalPath", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            runInLocalPath: "",
          },
          "update",
        ),
      ),
    ).toBe(null);
  });

  test("rejects option-like runInBaseBranch", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            runInBaseBranch: "--detach",
          },
          "update",
        ),
      ),
    ).toBe("Invalid runInBaseBranch value");
  });

  test("accepts empty runInWorktreePath", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            runInWorktreePath: "",
          },
          "update",
        ),
      ),
    ).toBe(null);
  });

  test("rejects non-string runInWorktreePath", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            runInWorktreePath: 123 as unknown as string,
          },
          "update",
        ),
      ),
    ).toBe("Invalid runInWorktreePath value");
  });

  test("accepts empty runInEnvironmentPath", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            runInEnvironmentPath: "",
          },
          "update",
        ),
      ),
    ).toBe(null);
  });

  test("rejects non-string runInEnvironmentPath", () => {
    expect(
      runValidation(() =>
        assertValidPageInput(
          {
            runInEnvironmentPath: 123 as unknown as string,
          },
          "update",
        ),
      ),
    ).toBe("Invalid runInEnvironmentPath value");
  });
});

function runValidation(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
