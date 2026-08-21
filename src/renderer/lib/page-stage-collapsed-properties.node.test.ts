import { describe, expect, test } from "vitest";
import {
  DEFAULT_PAGE_STAGE_COLLAPSED_PROPERTIES,
  PAGE_STAGE_COLLAPSED_PROPERTIES_STORAGE_KEY,
  formatPageStageCollapsedPropertyCountLabel,
  normalizePageStageCollapsedProperties,
  readPageStageCollapsedProperties,
  togglePageStageCollapsedProperty,
  writePageStageCollapsedProperties,
} from "./page-stage-collapsed-properties";

const storage = new Map<string, string>();
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

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

    // `localStorage` is absent in some test environments.
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

describe("page stage collapsed properties", () => {
  test("defaults to showing all page-stage properties", () => {
    withMockedLocalStorage(() => {
      expect(stringify(readPageStageCollapsedProperties())).toBe(
        stringify(DEFAULT_PAGE_STAGE_COLLAPSED_PROPERTIES),
      );
    });
  });

  test("normalizes persisted values and preserves canonical order", () => {
    expect(
      stringify(
        normalizePageStageCollapsedProperties([
          "agentStatus",
          "tags",
          "agentBlocked",
          "invalid",
          "tags",
        ]),
      ),
    ).toBe(stringify(["tags"]));
  });

  test("writes an empty selection without falling back to defaults", () => {
    withMockedLocalStorage(() => {
      const next = writePageStageCollapsedProperties([]);

      expect(stringify(next)).toBe(stringify([]));
      expect(storage.get(PAGE_STAGE_COLLAPSED_PROPERTIES_STORAGE_KEY)).toBe("");
      expect(stringify(readPageStageCollapsedProperties())).toBe(stringify([]));
    });
  });

  test("toggles individual collapsed properties", () => {
    expect(stringify(togglePageStageCollapsedProperty(["threads"], "tags"))).toBe(
      stringify(["tags", "threads"]),
    );
    expect(stringify(togglePageStageCollapsedProperty(["tags", "threads"], "tags"))).toBe(
      stringify(["threads"]),
    );
  });

  test("formats singular and plural toggle labels", () => {
    expect(formatPageStageCollapsedPropertyCountLabel(1, false)).toBe("1 more property");
    expect(formatPageStageCollapsedPropertyCountLabel(2, true)).toBe("Hide 2 properties");
  });
});
