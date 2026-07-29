import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FileBrowserHistoryStore } from "./browser-history-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createStore(now = () => 100) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-history-"));
  roots.push(root);
  return new FileBrowserHistoryStore({
    filePath: path.join(root, "browser-history.json"),
    now,
  });
}

describe("FileBrowserHistoryStore", () => {
  test("persists searchable visit history and coalesces identical URLs", async () => {
    const store = createStore();
    await store.record({
      url: "https://example.com/path?q=one",
      title: "Example",
      visitedAt: 10,
    });
    await store.record({
      url: "https://example.com/path?q=one",
      title: "Updated title",
      visitedAt: 20,
    });
    await store.record({
      url: "https://other.example/",
      title: "Other",
      visitedAt: 15,
    });

    expect((await store.list()).entries).toMatchObject([
      { title: "Updated title", visitCount: 2, lastVisitedAt: 20 },
      { title: "Other", visitCount: 1, lastVisitedAt: 15 },
    ]);
    expect((await store.list({ query: "other" })).entries).toHaveLength(1);
  });

  test("rejects credential-bearing and non-web URLs", async () => {
    const store = createStore();
    await store.record({ url: "javascript:alert(1)", title: "unsafe" });
    await store.record({
      url: "https://user:secret@example.com/",
      title: "credential",
    });
    expect((await store.list()).entries).toEqual([]);
  });

  test("deletes individual entries and clears durable history", async () => {
    const store = createStore();
    await store.record({ url: "https://example.com/", title: "Example" });
    const [entry] = (await store.list()).entries;
    await store.delete(entry!.id);
    expect((await store.list()).entries).toEqual([]);
    await store.record({ url: "https://example.com/", title: "Example" });
    await store.clear();
    expect((await store.list()).entries).toEqual([]);
  });

  test("quarantines malformed history instead of trusting it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-browser-history-"));
    roots.push(root);
    const filePath = path.join(root, "browser-history.json");
    fs.writeFileSync(filePath, "{broken");
    const store = new FileBrowserHistoryStore({ filePath, now: () => 123 });
    expect((await store.list()).entries).toEqual([]);
    expect(fs.existsSync(`${filePath}.corrupt-123`)).toBe(true);
  });
});
