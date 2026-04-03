import { describe, expect, test } from "bun:test";
import {
  formatRateLimitSummary,
  formatRateLimitWindowCompactLabel,
  formatRateLimitWindowLabel,
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
});
