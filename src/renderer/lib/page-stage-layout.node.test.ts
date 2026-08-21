import { describe, expect, test } from "vite-plus/test";
import {
  readPageStageContentWidthPreference,
  readPageStageShowRawContentPreference,
  writePageStageContentWidthPreference,
  writePageStageShowRawContentPreference,
} from "./page-stage-layout";

describe("page-stage layout", () => {
  function withMockLocalStorage(run: () => void): void {
    const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    const storage = new Map<string, string>();
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
      if (originalLocalStorageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
        return;
      }

      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }

  test("defaults to limiting the main content width", () => {
    withMockLocalStorage(() => {
      expect(readPageStageContentWidthPreference()).toBe(true);
    });
  });

  test("persists the width preference", () => {
    withMockLocalStorage(() => {
      writePageStageContentWidthPreference(false);

      expect(readPageStageContentWidthPreference()).toBe(false);
    });
  });

  test("defaults to hiding raw content mode", () => {
    withMockLocalStorage(() => {
      expect(readPageStageShowRawContentPreference()).toBe(false);
    });
  });

  test("persists the raw content preference without clobbering width", () => {
    withMockLocalStorage(() => {
      writePageStageContentWidthPreference(false);
      writePageStageShowRawContentPreference(true);

      expect(readPageStageContentWidthPreference()).toBe(false);
      expect(readPageStageShowRawContentPreference()).toBe(true);
    });
  });
});
