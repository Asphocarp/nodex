import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FileBrowserDownloadStore } from "./browser-download-store";

const directories: string[] = [];

function record(id: string) {
  return {
    id,
    browserConversationId: "conversation-1",
    browserViewScopeId: "window-session-1",
    browserTabId: "browser-tab-1",
    fileName: `${id}.txt`,
    savePath: `/downloads/${id}.txt`,
    sourceOrigin: "https://example.com",
    status: "completed" as const,
    receivedBytes: 10,
    totalBytes: 10,
    startedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  };
}

async function store(now = 42) {
  const directory = await mkdtemp(join(tmpdir(), "nodex-browser-downloads-"));
  directories.push(directory);
  const filePath = join(directory, "browser-downloads.json");
  return {
    directory,
    filePath,
    store: new FileBrowserDownloadStore(filePath, () => now),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) =>
    await rm(directory, { force: true, recursive: true })
  ));
});

describe("FileBrowserDownloadStore", () => {
  test("persists and reloads download history", async () => {
    const fixture = await store();
    await fixture.store.upsert(record("download-1"));
    const reloaded = new FileBrowserDownloadStore(fixture.filePath);
    await expect(reloaded.list()).resolves.toEqual([record("download-1")]);
  });

  test("removes individual and all history without deleting files", async () => {
    const fixture = await store();
    await fixture.store.upsert(record("download-1"));
    await fixture.store.upsert(record("download-2"));
    await fixture.store.remove("download-1");
    expect((await fixture.store.list()).map((item) => item.id)).toEqual([
      "download-2",
    ]);
    await fixture.store.clear();
    await expect(fixture.store.list()).resolves.toEqual([]);
  });

  test("quarantines malformed history", async () => {
    const fixture = await store();
    await writeFile(fixture.filePath, "{broken", "utf8");
    await expect(fixture.store.list()).resolves.toEqual([]);
    await expect(readFile(
      join(fixture.directory, "browser-downloads.json.corrupt-42"),
      "utf8",
    )).resolves.toBe("{broken");
  });
});
