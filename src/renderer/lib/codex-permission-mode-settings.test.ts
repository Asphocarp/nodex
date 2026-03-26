import { describe, expect, test } from "bun:test";
import {
  CODEX_PERMISSION_MODE_STORAGE_KEY,
  readCodexPermissionModes,
  writeCodexPermissionModes,
} from "./codex-permission-mode-settings";

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

describe("codex permission mode settings", () => {
  test("drops invalid persisted permission modes", () => {
    const storageGlobal = globalThis as unknown as { localStorage?: typeof mockStorage };
    const previousLocalStorage = storageGlobal.localStorage;
    storageGlobal.localStorage = mockStorage;
    mockStorage.clear();

    try {
      mockStorage.setItem(CODEX_PERMISSION_MODE_STORAGE_KEY, JSON.stringify({
        "project-a": "sandbox",
        "project-b": "invalid",
      }));

      const stored = readCodexPermissionModes();

      expect(stored["project-a"]).toBe("sandbox");
      expect(stored["project-b"]).toBe(undefined);
    } finally {
      if (previousLocalStorage) {
        storageGlobal.localStorage = previousLocalStorage;
      } else {
        delete storageGlobal.localStorage;
      }
    }
  });

  test("round-trips permission mode maps", () => {
    const storageGlobal = globalThis as unknown as { localStorage?: typeof mockStorage };
    const previousLocalStorage = storageGlobal.localStorage;
    storageGlobal.localStorage = mockStorage;
    mockStorage.clear();

    try {
      writeCodexPermissionModes({
        default: "custom",
        ops: "full-access",
      });

      const stored = readCodexPermissionModes();

      expect(stored.default).toBe("custom");
      expect(stored.ops).toBe("full-access");
    } finally {
      if (previousLocalStorage) {
        storageGlobal.localStorage = previousLocalStorage;
      } else {
        delete storageGlobal.localStorage;
      }
    }
  });
});
