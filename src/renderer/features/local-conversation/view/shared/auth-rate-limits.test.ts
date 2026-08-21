import { describe, expect, test } from "vite-plus/test";
import {
  buildRateLimitRingViewModel,
  findAvailableQuotaResetCredit,
  formatQuotaResetAvailability,
  formatQuotaResetCreditExpiration,
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
    expect(
      formatRateLimitSummary({
        primary: {
          usedPercent: 18,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 39,
          windowDurationMins: 7 * 24 * 60,
        },
      }),
    ).toBe("82% · 61%");
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

    expect(model.hasLimits).toBe(false);
    expect(model.outer === null).toBe(true);
    expect(model.inner === null).toBe(true);
    expect(model.ariaLabel).toBe("Usage remaining unavailable");
  });

  test("formats quota-reset expiry from the protocol's Unix-second timestamp", () => {
    const localNoon = new Date(2027, 4, 12, 12).getTime() / 1_000;
    expect(formatQuotaResetCreditExpiration(localNoon, "en-US")).toBe("May 12, 2027");
    expect(formatQuotaResetCreditExpiration(null, "en-US")).toBe("Doesn’t expire");
  });

  test("selects only an available reset-credit detail", () => {
    const available = findAvailableQuotaResetCredit({
      availableCount: 2,
      credits: [
        {
          id: "redeemed-credit",
          resetType: "codexRateLimits",
          status: "redeemed",
          grantedAt: 1,
          expiresAt: null,
          title: null,
          description: null,
        },
        {
          id: "available-credit",
          resetType: "codexRateLimits",
          status: "available",
          grantedAt: 2,
          expiresAt: 3,
          title: null,
          description: null,
        },
      ],
    });

    expect(available?.id).toBe("available-credit");
  });

  test("formats the reset disclosure count with correct plurality", () => {
    expect(formatQuotaResetAvailability(0)).toBe("0 available resets");
    expect(formatQuotaResetAvailability(1)).toBe("1 available reset");
    expect(formatQuotaResetAvailability(2)).toBe("2 available resets");
  });
});
