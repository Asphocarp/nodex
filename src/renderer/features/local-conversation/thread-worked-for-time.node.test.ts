import { describe, expect, test } from "vitest";
import {
  formatWorkedForTimeLabel,
  resolveWorkedForLabelText,
} from "./thread-worked-for-time";

describe("thread worked-for time helpers", () => {
  test("formats Codex-style compact durations", () => {
    expect(formatWorkedForTimeLabel(-500)).toBe("0s");
    expect(formatWorkedForTimeLabel(999)).toBe("0s");
    expect(formatWorkedForTimeLabel(1_000)).toBe("1s");
    expect(formatWorkedForTimeLabel(120_000)).toBe("2m");
    expect(formatWorkedForTimeLabel(125_999)).toBe("2m 5s");
    expect(formatWorkedForTimeLabel(3_660_999)).toBe("1h 1m");
    expect(formatWorkedForTimeLabel(3_665_000)).toBe("1h 1m 5s");
    expect(formatWorkedForTimeLabel(86_400_000)).toBe("1d");
    expect(formatWorkedForTimeLabel(90_061_000)).toBe("1d 1h 1m 1s");
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

    expect(resolveWorkedForLabelText({
      timing: {
        status: "worked",
        startedAtMs: 10_000,
        completedAtMs: 15_000,
      },
      durationMs: null,
      nowMs: 20_000,
    })).toBe("Worked for 5s");

    expect(resolveWorkedForLabelText({
      timing: {
        status: "worked",
        startedAtMs: 10_000,
        completedAtMs: 10_500,
      },
      durationMs: null,
      nowMs: 20_000,
    })).toBe("Worked for 0s");
  });
});
