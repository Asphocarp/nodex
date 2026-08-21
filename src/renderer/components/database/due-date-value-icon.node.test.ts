import { describe, expect, test } from "vitest";

import {
  DATABASE_DUE_DATE_FUTURE_ICON_COLOR,
  DATABASE_DUE_DATE_MUTED_ICON_COLOR,
  DATABASE_DUE_DATE_NOW_ICON_COLOR,
  databaseDueDateIconColor,
  databaseDueDateIconState,
} from "./due-date-value-icon";

describe("Due date value icon", () => {
  test("distinguishes due-now and future calendar visuals by local date", () => {
    const today = new Date(2026, 7, 12, 12);
    expect(databaseDueDateIconColor("2026-08-11", today)).toBe(DATABASE_DUE_DATE_NOW_ICON_COLOR);
    expect(databaseDueDateIconColor("2026-08-12", today)).toBe(DATABASE_DUE_DATE_NOW_ICON_COLOR);
    expect(databaseDueDateIconColor("2026-08-13", today)).toBe(DATABASE_DUE_DATE_FUTURE_ICON_COLOR);
    expect(databaseDueDateIconColor("not-a-date", today)).toBe(DATABASE_DUE_DATE_MUTED_ICON_COLOR);
  });

  test("adds an overdue mark only before the current local date", () => {
    const today = new Date(2026, 7, 12, 12);
    expect(databaseDueDateIconState("2026-08-11", today)).toBe("overdue");
    expect(databaseDueDateIconState("2026-08-12", today)).toBe("calendar");
    expect(databaseDueDateIconState("2026-08-13", today)).toBe("calendar");
    expect(databaseDueDateIconState("not-a-date", today)).toBe("calendar");
  });
});
