import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexThreadTitleStateStore } from "./thread-title-state";

describe("CodexThreadTitleStateStore", () => {
  test("persists cached titles and pending backfill entries", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "nodex-thread-title-state-"));
    try {
      const store = new CodexThreadTitleStateStore(rootPath);
      store.setTitle("thread-1", "Refactor thread title flow");

      expect(store.readCachedTitle("thread-1")).toBe("Refactor thread title flow");
      expect(JSON.stringify(store.readPendingBackfill())).toBe(JSON.stringify({
        titles: {
          "thread-1": "Refactor thread title flow",
        },
        order: ["thread-1"],
      }));
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  test("clears only completed pending backfill entries", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "nodex-thread-title-state-"));
    try {
      const store = new CodexThreadTitleStateStore(rootPath);
      store.setTitle("thread-1", "Refactor thread title flow");
      store.setTitle("thread-2", "Backfill cached thread names");
      store.clearPendingBackfill(["thread-1"]);

      expect(JSON.stringify(store.readPendingBackfill())).toBe(JSON.stringify({
        titles: {
          "thread-2": "Backfill cached thread names",
        },
        order: ["thread-2"],
      }));
      expect(store.readCachedTitle("thread-1")).toBe("Refactor thread title flow");
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });
});
