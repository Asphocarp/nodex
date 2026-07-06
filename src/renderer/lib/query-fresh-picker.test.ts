import { describe, expect, test } from "bun:test";
import {
  areQueryFresh,
  resolvePendingQueryFreshAccept,
  resolveQueryFreshAccept,
  shouldConsumeStalePickerNavigation,
} from "./query-fresh-picker";

interface PickerRow {
  id: string;
  disabled?: boolean;
}

const getRowId = (row: PickerRow) => row.id;
const isRowAcceptable = (row: PickerRow) => row.disabled !== true;

describe("query-fresh picker", () => {
  test("recognizes stale rows when the visible query lags behind the live query", () => {
    expect(areQueryFresh({ liveQuery: "now", rowsQuery: "no" })).toBeFalse();
    expect(shouldConsumeStalePickerNavigation({ liveQuery: "now", rowsQuery: "no" })).toBeTrue();
  });

  test("accepts the focused row when rows are fresh", () => {
    const result = resolveQueryFreshAccept({
      liveQuery: "now",
      rowsQuery: "now",
      rows: [{ id: "no" }, { id: "now" }],
      focusedIndex: 1,
      getRowId,
      isRowAcceptable,
    });

    expect(result.status).toBe("accepted");
    expect(result.status === "accepted" ? result.row.id : null).toBe("now");
  });

  test("recomputes stale enter against the live query before accepting", () => {
    const result = resolveQueryFreshAccept({
      liveQuery: "now",
      rowsQuery: "no",
      rows: [{ id: "no" }],
      focusedIndex: 0,
      buildFreshRows: () => [{ id: "now" }],
      getRowId,
      isRowAcceptable,
    });

    expect(result.status).toBe("accepted");
    expect(result.status === "accepted" ? result.row.id : null).toBe("now");
  });

  test("records stale enter as pending when fresh rows are not ready", () => {
    const result = resolveQueryFreshAccept({
      liveQuery: "now",
      rowsQuery: "no",
      rows: [{ id: "no" }],
      focusedIndex: 0,
      buildFreshRows: () => [],
      canWaitForFreshRows: true,
      getRowId,
      isRowAcceptable,
    });

    expect(result.status).toBe("pending");
    expect(result.query).toBe("now");
  });

  test("auto-accepts the first fresh row when pending rows arrive", () => {
    const result = resolvePendingQueryFreshAccept({
      pendingQuery: "now",
      liveQuery: "now",
      rowsQuery: "now",
      rows: [{ id: "now" }, { id: "today" }],
      getRowId,
      isRowAcceptable,
    });

    expect(result.status).toBe("accepted");
    expect(result.status === "accepted" ? result.row.id : null).toBe("now");
  });

  test("does not auto-accept pending rows for a query the user already changed", () => {
    const result = resolvePendingQueryFreshAccept({
      pendingQuery: "now",
      liveQuery: "today",
      rowsQuery: "today",
      rows: [{ id: "today" }],
      getRowId,
      isRowAcceptable,
    });

    expect(result.status).toBe("ignored");
  });
});
