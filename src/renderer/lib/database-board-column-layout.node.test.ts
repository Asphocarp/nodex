import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  databaseBoardColumnLayoutScope,
  getDatabaseBoardColumnLayout,
  normalizeDatabaseBoardColumnLayoutPrefs,
  readDatabaseBoardColumnLayoutPrefs,
  updateDatabaseBoardColumnLayoutPrefs,
} from "./database-board-column-layout";

describe("database Board column layout", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  test("scopes arbitrary group paths by View and grouping Property", () => {
    const scope = databaseBoardColumnLayoutScope({
      viewId: "view-1",
      groupPropertyId: "priority",
    });
    const updated = updateDatabaseBoardColumnLayoutPrefs(
      scope,
      {},
      "key:\"p1-high\"",
      { collapsed: true, width: 360 },
    );
    expect(getDatabaseBoardColumnLayout(updated, "key:\"p1-high\""))
      .toEqual({ collapsed: true, width: 360 });
    expect(readDatabaseBoardColumnLayoutPrefs(scope)).toEqual(updated);
    expect(readDatabaseBoardColumnLayoutPrefs(
      databaseBoardColumnLayoutScope({
        viewId: "view-1",
        groupPropertyId: "status",
      }),
    )).toEqual({});
  });

  test("normalizes malformed persisted paths without assuming workflow statuses", () => {
    expect(normalizeDatabaseBoardColumnLayoutPrefs({
      "key:\"custom-option\"": { collapsed: true, width: 9_999 },
      empty: null,
    })).toEqual({
      "key:\"custom-option\"": { collapsed: true, width: 416 },
    });
  });
});
