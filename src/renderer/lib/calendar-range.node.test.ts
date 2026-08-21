import { describe, expect, test } from "vite-plus/test";
import {
  clampCalendarMultiDayCount,
  clampCalendarMultiWeekCount,
  formatCalendarRangeLabel,
  formatCalendarRangeStaticValue,
  migrateCalendarRangePrefs,
  normalizeCalendarRangeState,
  resolveCalendarRangeAnchorOffset,
  resolveCalendarVisibleDayCount,
} from "./calendar-range";

describe("calendar range", () => {
  test("migrates legacy dayCount preferences", () => {
    const multiDay = migrateCalendarRangePrefs({ dayCount: 4 });
    expect(multiDay.mode).toBe("multi-day");
    expect(multiDay.multiDayCount).toBe(4);

    const week = migrateCalendarRangePrefs({ dayCount: 7 });
    expect(week.mode).toBe("week");
    expect(week.multiDayCount).toBe(4);
  });

  test("normalizes invalid range state with clamps", () => {
    const normalized = normalizeCalendarRangeState({
      mode: "multi-week",
      multiDayCount: 99,
      multiWeekCount: -1,
    });

    expect(normalized.mode).toBe("multi-week");
    expect(normalized.multiDayCount).toBe(14);
    expect(normalized.multiWeekCount).toBe(2);
  });

  test("clamps custom range counts", () => {
    expect(clampCalendarMultiDayCount(1)).toBe(2);
    expect(clampCalendarMultiDayCount(15)).toBe(14);
    expect(clampCalendarMultiWeekCount(1)).toBe(2);
    expect(clampCalendarMultiWeekCount(5)).toBe(4);
  });

  test("resolves visible day count", () => {
    expect(
      resolveCalendarVisibleDayCount({ mode: "day", multiDayCount: 4, multiWeekCount: 2 }),
    ).toBe(1);
    expect(
      resolveCalendarVisibleDayCount({ mode: "week", multiDayCount: 4, multiWeekCount: 2 }),
    ).toBe(7);
    expect(
      resolveCalendarVisibleDayCount({ mode: "multi-day", multiDayCount: 6, multiWeekCount: 2 }),
    ).toBe(6);
    expect(
      resolveCalendarVisibleDayCount({ mode: "multi-week", multiDayCount: 4, multiWeekCount: 3 }),
    ).toBe(21);
  });

  test("formats trigger and row labels", () => {
    const range = { mode: "multi-day" as const, multiDayCount: 4, multiWeekCount: 2 };
    expect(formatCalendarRangeLabel(range)).toBe("4 Days");
    expect(formatCalendarRangeStaticValue("multi-day", range)).toBe("4 Days");
    expect(formatCalendarRangeStaticValue("multi-week", range)).toBe("2 Weeks");
  });

  test("preserves the old four-day centered offset", () => {
    expect(
      resolveCalendarRangeAnchorOffset({ mode: "multi-day", multiDayCount: 4, multiWeekCount: 2 }),
    ).toBe(-1);
    expect(
      resolveCalendarRangeAnchorOffset({ mode: "week", multiDayCount: 4, multiWeekCount: 2 }),
    ).toBe(0);
  });
});
