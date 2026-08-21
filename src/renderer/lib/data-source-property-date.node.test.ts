import { describe, expect, test } from "vite-plus/test";
import {
  dataSourceCalendarDateKey,
  datetimeDraftFromIso,
  formatLocalDateAsIso,
  isCanonicalDataSourceDateTime,
  localDateTimeToIso,
  parseIsoDateToLocalDate,
} from "./data-source-property-date";

describe("Data Source Property dates", () => {
  test("round-trips calendar dates through local components without UTC drift", () => {
    const parsed = parseIsoDateToLocalDate("2026-08-04");
    expect(parsed).not.toBeNull();
    expect(formatLocalDateAsIso(parsed!)).toBe("2026-08-04");
  });

  test("rejects normalized-looking but impossible dates", () => {
    expect(parseIsoDateToLocalDate("2026-02-29")).toBeNull();
    expect(parseIsoDateToLocalDate("2026-2-04")).toBeNull();
  });

  test("preserves four-digit years below 100", () => {
    expect(formatLocalDateAsIso(parseIsoDateToLocalDate("0099-08-04")!)).toBe("0099-08-04");
  });

  test("round-trips a local datetime through canonical ISO", () => {
    const iso = localDateTimeToIso("2026-08-04", "13:45");
    expect(iso).not.toBeNull();
    expect(datetimeDraftFromIso(iso!)).toEqual({ date: "2026-08-04", time: "13:45" });
  });

  test("rejects invalid time and DST-normalized local values", () => {
    expect(localDateTimeToIso("2026-08-04", "24:00")).toBeNull();
    expect(localDateTimeToIso("invalid", "09:00")).toBeNull();
    expect(datetimeDraftFromIso("2026-08-04")).toBeNull();
  });

  test("accepts every canonical UTC precision supported by Core", () => {
    for (const value of [
      "2026-08-04T13:45:00Z",
      "2026-08-04T13:45:00.1Z",
      "2026-08-04T13:45:00.123456789Z",
    ]) {
      expect(isCanonicalDataSourceDateTime(value)).toBe(true);
      expect(datetimeDraftFromIso(value)).not.toBeNull();
    }
    for (const value of [
      "2026-08-04",
      "2026-08-04T13:45:00+00:00",
      "2026-02-29T13:45:00Z",
      "2026-08-04T24:00:00Z",
      "2026-08-04T13:45:00.1234567890Z",
    ]) {
      expect(isCanonicalDataSourceDateTime(value)).toBe(false);
      expect(datetimeDraftFromIso(value)).toBeNull();
    }
  });

  test("groups datetimes by the same local date shown in the editor", () => {
    const value = localDateTimeToIso("2026-08-04", "00:30");
    expect(value).not.toBeNull();
    expect(dataSourceCalendarDateKey(value, "datetime")).toBe("2026-08-04");
    expect(dataSourceCalendarDateKey("2026-08-04", "date")).toBe("2026-08-04");
    expect(dataSourceCalendarDateKey("2026-02-29", "date")).toBeNull();
  });
});
