import { describe, expect, test } from "vitest";
import {
  DEFAULT_KANBAN_COLUMN_WIDTH,
  getKanbanColumnLayout,
  normalizeKanbanColumnLayoutPrefs,
  readKanbanColumnLayoutPrefs,
  updateKanbanColumnLayoutPrefs,
  writeKanbanColumnLayoutPrefs,
} from "./kanban-column-layout";

const storage = new Map<string, string>();
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function withMockedLocalStorage(run: () => void): void {
  storage.clear();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });

  try {
    run();
  } finally {
    storage.clear();

    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
      return;
    }

    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

describe("kanban column layout prefs", () => {
  test("defaults each column to expanded with the standard width", () => {
    expect(JSON.stringify(getKanbanColumnLayout({}, "build"))).toBe(JSON.stringify({
      collapsed: false,
      width: DEFAULT_KANBAN_COLUMN_WIDTH,
    }));
  });

  test("normalizes invalid persisted values and ignores unknown statuses", () => {
    const normalized = normalizeKanbanColumnLayoutPrefs({
      backlog: {
        collapsed: true,
        width: 999,
      },
      done: {
        width: 120,
      },
      archive: {
        collapsed: true,
      },
    });

    expect(JSON.stringify(normalized)).toBe(JSON.stringify({
      plan: {
        collapsed: true,
        width: 416,
      },
      ship: {
        width: 224,
      },
    }));
  });

  test("prefers a canonical column key over its legacy alias", () => {
    expect(normalizeKanbanColumnLayoutPrefs({
      backlog: { collapsed: true, width: 320 },
      plan: { collapsed: false, width: 360 },
    })).toEqual({
      plan: { collapsed: false, width: 360 },
    });
  });

  test("writes and reads project-scoped layout prefs", () => {
    withMockedLocalStorage(() => {
      const written = writeKanbanColumnLayoutPrefs("alpha", {
        plan: { collapsed: true, width: 360 },
      });

      expect(JSON.stringify(written)).toBe(JSON.stringify({
        plan: { collapsed: true, width: 360 },
      }));
      expect(JSON.stringify(readKanbanColumnLayoutPrefs("alpha"))).toBe(JSON.stringify({
        plan: { collapsed: true, width: 360 },
      }));
      expect(JSON.stringify(readKanbanColumnLayoutPrefs("beta"))).toBe(JSON.stringify({}));
    });
  });

  test("updates a single column while preserving the rest of the layout map", () => {
    const next = updateKanbanColumnLayoutPrefs(
      {
        plan: { collapsed: true, width: 360 },
        ship: { width: 240 },
      },
      "ship",
      { collapsed: true, width: 288 },
    );

    expect(JSON.stringify(next)).toBe(JSON.stringify({
      plan: { collapsed: true, width: 360 },
      ship: { collapsed: true, width: 288 },
    }));
  });
});
