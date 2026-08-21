import { describe, expect, test } from "vitest";
import {
  COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY,
  DEFAULT_COMPOSER_ENTER_BEHAVIOR,
  normalizeComposerEnterBehavior,
  readComposerEnterBehavior,
  writeComposerEnterBehavior,
} from "./composer-enter-behavior";

const storageMap = new Map<string, string>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? (storageMap.get(key) ?? null) : null;
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, value);
  },
  removeItem(key: string): void {
    storageMap.delete(key);
  },
  clear(): void {
    storageMap.clear();
  },
};

function withMockLocalStorage(run: () => void): void {
  const storageGlobal = globalThis as { localStorage?: typeof mockStorage };
  const previousLocalStorage = storageGlobal.localStorage;
  storageGlobal.localStorage = mockStorage;
  try {
    run();
  } finally {
    if (previousLocalStorage) {
      storageGlobal.localStorage = previousLocalStorage;
      return;
    }
    delete storageGlobal.localStorage;
  }
}

describe("composer enter behavior", () => {
  test("defaults to enter and normalizes known values", () => {
    withMockLocalStorage(() => {
      mockStorage.clear();
      expect(normalizeComposerEnterBehavior(undefined)).toBe(DEFAULT_COMPOSER_ENTER_BEHAVIOR);
      expect(normalizeComposerEnterBehavior("enter")).toBe("enter");
      expect(normalizeComposerEnterBehavior("cmdIfMultiline")).toBe("cmdIfMultiline");
      expect(normalizeComposerEnterBehavior("cmd-if-multiline")).toBe("cmdIfMultiline");
      expect(normalizeComposerEnterBehavior("unexpected")).toBe(DEFAULT_COMPOSER_ENTER_BEHAVIOR);
    });
  });

  test("reads and writes persisted values", () => {
    withMockLocalStorage(() => {
      mockStorage.clear();
      expect(readComposerEnterBehavior()).toBe(DEFAULT_COMPOSER_ENTER_BEHAVIOR);

      const persisted = writeComposerEnterBehavior("cmdIfMultiline");
      expect(persisted).toBe("cmdIfMultiline");
      expect(mockStorage.getItem(COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY)).toBe("cmdIfMultiline");
      expect(readComposerEnterBehavior()).toBe("cmdIfMultiline");
    });
  });
});
