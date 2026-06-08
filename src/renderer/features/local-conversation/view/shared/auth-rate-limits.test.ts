import { describe, expect, test } from "bun:test";
import {
  buildRateLimitRingViewModel,
  formatRateLimitSummary,
  formatRateLimitWindowCompactLabel,
  formatRateLimitWindowLabel,
  getRemainingRateLimitPercent,
} from "./auth-rate-limits";

describe("auth rate limits", () => {
  test("formats long window labels for the tooltip", () => {
    expect(formatRateLimitWindowLabel(300)).toBe("5h");
    expect(formatRateLimitWindowLabel(7 * 24 * 60)).toBe("Weekly");
  });

  test("formats compact window labels for the header chip", () => {
    expect(formatRateLimitWindowCompactLabel(300)).toBe("5h");
    expect(formatRateLimitWindowCompactLabel(7 * 24 * 60)).toBe("wk");
  });

  test("formats a concise quota summary for the connected chip", () => {
    expect(formatRateLimitSummary({
      primary: {
        usedPercent: 18,
        windowDurationMins: 300,
      },
      secondary: {
        usedPercent: 39,
        windowDurationMins: 7 * 24 * 60,
      },
    })).toBe("82% · 61%");
  });

  test("clamps remaining percentages for quota rings", () => {
    expect(getRemainingRateLimitPercent(-20)).toBe(100);
    expect(getRemainingRateLimitPercent(18.4)).toBe(82);
    expect(getRemainingRateLimitPercent(140)).toBe(0);
  });

  test("orders quota rings by window duration", () => {
    const model = buildRateLimitRingViewModel({
      primary: {
        usedPercent: 39,
        windowDurationMins: 7 * 24 * 60,
      },
      secondary: {
        usedPercent: 18,
        windowDurationMins: 300,
      },
    });

    expect(model.outer?.compactLabel).toBe("5h");
    expect(model.outer?.remainingPercent).toBe(82);
    expect(model.inner?.compactLabel).toBe("wk");
    expect(model.inner?.remainingPercent).toBe(61);
    expect(model.ariaLabel).toBe("Usage remaining: 5h 82%, weekly 61%");
  });

  test("falls back when quota ring windows are missing", () => {
    const model = buildRateLimitRingViewModel({
      primary: undefined,
      secondary: {
        usedPercent: 25,
      },
    });

    expect(model.hasLimits).toBeFalse();
    expect(model.outer === null).toBeTrue();
    expect(model.inner === null).toBeTrue();
    expect(model.ariaLabel).toBe("Usage remaining unavailable");
  });
});
