import { describe, expect, test } from "vitest";
import {
  formatCalendarToolbarMonthYear,
  resolveCalendarVisibleDays,
} from "./calendar-view-state";

describe("calendar view state", () => {
  test("resolves visible days from range state", () => {
    const days = resolveCalendarVisibleDays({
      anchorDate: new Date(2026, 1, 14),
      range: { mode: "multi-week", multiDayCount: 4, multiWeekCount: 2 },
    });

    expect(days.length).toBe(14);
    expect(days[0]?.getDate()).toBe(14);
    expect(days[13]?.getDate()).toBe(27);
  });

  test("formats a compact month and year label", () => {
    expect(formatCalendarToolbarMonthYear([
      new Date(2026, 1, 14),
      new Date(2026, 1, 15),
    ])).toBe("February 2026");

    expect(formatCalendarToolbarMonthYear([
      new Date(2026, 1, 28),
      new Date(2026, 2, 1),
    ])).toBe("Feb - Mar 2026");
  });
});
