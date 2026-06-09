import { describe, expect, test } from "bun:test";
import {
  formatWorkedForTimeLabel,
  resolveWorkedForLabelText,
} from "./thread-worked-for-time";

describe("thread worked-for time helpers", () => {
  test("formats Codex-style compact durations", () => {
    expect(formatWorkedForTimeLabel(900)).toBe("1s");
    expect(formatWorkedForTimeLabel(125_000)).toBe("2m 5s");
    expect(formatWorkedForTimeLabel(3_660_000)).toBe("1h 1m");
  });

  test("renders working, worked-for, and duration fallback labels", () => {
    expect(resolveWorkedForLabelText({
      timing: {
        status: "working",
        startedAtMs: 10_000,
        completedAtMs: null,
      },
      durationMs: null,
      nowMs: 10_500,
    })).toBe("Working");

    expect(resolveWorkedForLabelText({
      timing: {
        status: "working",
        startedAtMs: 10_000,
        completedAtMs: null,
      },
      durationMs: null,
      nowMs: 75_000,
    })).toBe("Working for 1m 5s");

    expect(resolveWorkedForLabelText({
      timing: null,
      durationMs: 125_000,
    })).toBe("Worked for 2m 5s");
  });
});
