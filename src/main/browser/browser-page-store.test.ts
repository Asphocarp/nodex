import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FileBrowserPageSnapshotStore, type BrowserSerializedPage } from "./browser-page-store";

const temporaryDirectories: string[] = [];
const identity = {
  browserConversationId: "conversation-1",
  browserViewScopeId: "window-session-1",
  browserTabId: "browser-tab-1",
} as const;

async function makeStore(now = 10) {
  const directory = await mkdtemp(join(tmpdir(), "nodex-browser-pages-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "browser-sidebar-page-states.json");
  return {
    directory,
    filePath,
    store: new FileBrowserPageSnapshotStore({
      filePath,
      now: () => now,
    }),
  };
}

function page(
  browserStorageId: string,
  overrides: Partial<BrowserSerializedPage> = {},
): BrowserSerializedPage {
  return {
    schemaVersion: 1,
    runtime: "electron-webview",
    browserStorageId,
    identity,
    title: "Example",
    url: "https://example.com/",
    updatedAt: 1,
    navigation: {
      currentIndex: 0,
      entries: [
        {
          title: "Example",
          url: "https://example.com/",
          pageState: "state",
        },
      ],
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(
      async (directory) =>
        await rm(directory, {
          recursive: true,
          force: true,
        }),
    ),
  );
});

describe("FileBrowserPageSnapshotStore", () => {
  test("persists and reloads a validated navigation snapshot", async () => {
    const { filePath, store } = await makeStore();
    await store.set(page("browser:one"));

    const reloaded = new FileBrowserPageSnapshotStore({ filePath });
    await expect(reloaded.get("browser:one")).resolves.toEqual(page("browser:one"));
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      pages: {
        "browser:one": {
          browserStorageId: "browser:one",
        },
      },
    });
  });

  test("keeps at most 500 navigation entries and 100 pages", async () => {
    const { store } = await makeStore();
    await store.set(
      page("browser:long", {
        navigation: {
          currentIndex: 549,
          entries: Array.from({ length: 550 }, (_, index) => ({
            title: `Page ${index}`,
            url: `https://example.com/${index}`,
          })),
        },
      }),
    );
    expect((await store.get("browser:long"))?.navigation.entries).toHaveLength(500);
    expect((await store.get("browser:long"))?.navigation.currentIndex).toBe(499);

    for (let index = 0; index < 101; index += 1) {
      await store.set(page(`browser:${index}`, { updatedAt: index + 1 }));
    }
    expect(await store.get("browser:0")).toBeNull();
    expect(await store.get("browser:100")).not.toBeNull();
  });

  test("quarantines corruption without preventing startup", async () => {
    const { directory, filePath } = await makeStore(42);
    await writeFile(filePath, "{not-json", "utf8");
    const store = new FileBrowserPageSnapshotStore({
      filePath,
      now: () => 42,
    });

    await expect(store.get("browser:missing")).resolves.toBeNull();
    await expect(
      readFile(join(directory, "browser-sidebar-page-states.json.corrupt-42"), "utf8"),
    ).resolves.toBe("{not-json");
  });

  test("reassociates a page without retaining the source identity", async () => {
    const { store } = await makeStore();
    await store.set(page("browser:source"));
    await store.reassociate("browser:source", "browser:target");

    expect(await store.get("browser:source")).toBeNull();
    expect(await store.get("browser:target")).toMatchObject({
      browserStorageId: "browser:target",
      updatedAt: 10,
    });
  });

  test("clears durable navigation history without touching the Browser profile", async () => {
    const { store } = await makeStore();
    await store.set(page("browser:one"));
    await store.set(page("browser:two"));
    await store.clear();
    expect(await store.get("browser:one")).toBeNull();
    expect(await store.get("browser:two")).toBeNull();
  });
});
