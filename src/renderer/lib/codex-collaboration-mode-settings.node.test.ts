import { describe, expect, test } from "vite-plus/test";
import {
  DEFAULT_CODEX_COLLABORATION_MODE,
  readGlobalCollaborationMode,
  writeGlobalCollaborationMode,
} from "./codex-collaboration-mode-settings";

const mockStorage = {
  store: new Map<string, string>(),
  getItem(key: string) {
    return this.store.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    this.store.set(key, value);
  },
  removeItem(key: string) {
    this.store.delete(key);
  },
  clear() {
    this.store.clear();
  },
};

describe("codex collaboration mode settings", () => {
  test("falls back to default mode when storage is missing or invalid", () => {
    const storageGlobal = globalThis as unknown as { localStorage?: typeof mockStorage };
    const previousLocalStorage = storageGlobal.localStorage;
    storageGlobal.localStorage = mockStorage;
    mockStorage.clear();

    try {
      expect(readGlobalCollaborationMode()).toBe(DEFAULT_CODEX_COLLABORATION_MODE);

      mockStorage.setItem("nodex-codex-collaboration-mode-v2", "invalid");
      expect(readGlobalCollaborationMode()).toBe(DEFAULT_CODEX_COLLABORATION_MODE);
    } finally {
      if (previousLocalStorage) {
        storageGlobal.localStorage = previousLocalStorage;
      } else {
        delete storageGlobal.localStorage;
      }
    }
  });

  test("round-trips the global collaboration mode", () => {
    const storageGlobal = globalThis as unknown as { localStorage?: typeof mockStorage };
    const previousLocalStorage = storageGlobal.localStorage;
    storageGlobal.localStorage = mockStorage;
    mockStorage.clear();

    try {
      writeGlobalCollaborationMode("plan");
      expect(readGlobalCollaborationMode()).toBe("plan");
      writeGlobalCollaborationMode("default");
      expect(readGlobalCollaborationMode()).toBe("default");
    } finally {
      if (previousLocalStorage) {
        storageGlobal.localStorage = previousLocalStorage;
      } else {
        delete storageGlobal.localStorage;
      }
    }
  });
});
