import { beforeEach, describe, expect, test } from "vitest";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { CommandPalettePage, CommandPaletteThread } from "@/lib/command-palette";
import type { CommandPalettePageSearchIndex } from "@/lib/command-palette-page-search";
import type { NfmMentionGetItemsLoaders } from "./nfm-slash-menu";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import { DEFAULT_PROJECT_APPEARANCE } from "../../../../shared/project-appearance";
import { useNfmMentionGetItems } from "./nfm-slash-menu";

type GetItems = (query: string) => Promise<DefaultReactSuggestionItem[]>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

let pageDescriptionSearchCalls = 0;
let threadListCalls = 0;

const fakeEditor = {
  insertInlineContent: () => undefined,
};

function makePalettePage(): CommandPalettePage {
  const descriptionPreview = "Mention search page.";
  return {
    kind: "page",
    id: "project-1:page-1",
    projectId: "project-1",
    projectName: "Project",
    projectAppearance: DEFAULT_PROJECT_APPEARANCE,
    columnName: "Doing",
    page: {
      id: "page-1",
      title: "Mention page",
      richTitle: plainTextToPortableRichText("Mention page"),
      descriptionPreview,
      descriptionLength: descriptionPreview.length,
      hasDescription: true,
      status: "build",
      archived: false,
      tags: [],
      reminders: [],
      isAllDay: false,
      runInTarget: "localProject",
      revision: 1,
      created: new Date("2026-06-24T00:00:00.000Z"),
      order: 0,
    },
    inActiveProject: true,
    recentIndex: null,
    boardIndex: 0,
  };
}

function makeThread(): CommandPaletteThread {
  return {
    kind: "thread",
    id: "thread:thr-1",
    threadId: "thr-1",
    sessionId: "session-1",
    projectId: "project-1",
    projectName: "Project",
    title: "Mention thread",
    preview: "Mention thread preview.",
    cwd: "/tmp/project",
    gitBranch: null,
    projectless: false,
    pinned: false,
    pinnedOrder: null,
    statusType: "notLoaded",
    statusActiveFlags: [],
    createdAt: 1,
    updatedAt: 2,
    inActiveProject: true,
  };
}

function createSearchIndex(): CommandPalettePageSearchIndex {
  return {
    search: () => [],
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function makeLoaders(
  options: {
    listThreadItems?: NfmMentionGetItemsLoaders["listThreadItems"];
    searchPageDescriptions?: NfmMentionGetItemsLoaders["searchPageDescriptions"];
    searchThreads?: NfmMentionGetItemsLoaders["searchThreads"];
    selectPageResults?: NfmMentionGetItemsLoaders["selectPageResults"];
    selectChatResults?: NfmMentionGetItemsLoaders["selectChatResults"];
  } = {},
): NfmMentionGetItemsLoaders {
  return {
    searchPageDescriptions: options.searchPageDescriptions ?? (async () => {
      pageDescriptionSearchCalls += 1;
      return [];
    }),
    listThreadItems: options.listThreadItems ?? (async () => {
      threadListCalls += 1;
      return [makeThread()];
    }),
    searchThreads: options.searchThreads ?? (async () => []),
    selectPageResults: options.selectPageResults ?? (({ pages }) => pages),
    selectChatResults: options.selectChatResults ?? (({ threads }) => threads),
    createThreadSearchIndex: () => ({ search: () => [] }),
  };
}

function MentionGetItemsHarness({
  pages,
  pageSearchIndex,
  getItemsSnapshots,
  loaders,
}: {
  pages: CommandPalettePage[];
  pageSearchIndex: CommandPalettePageSearchIndex;
  getItemsSnapshots: GetItems[];
  loaders: NfmMentionGetItemsLoaders;
}) {
  const getItems = useNfmMentionGetItems({
    editor: fakeEditor,
    activeProjectId: "project-1",
    pageItems: pages,
    pageSearchIndex,
    projectIdsForPageSearch: ["project-1"],
    loaders,
  });
  getItemsSnapshots.push(getItems);

  return <div>ready</div>;
}

beforeEach(() => {
  pageDescriptionSearchCalls = 0;
  threadListCalls = 0;
});

describe("useNfmMentionGetItems", () => {
  test("keeps getItems stable across volatile page arrays until an async refresh lands", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const threadList = createDeferred<CommandPaletteThread[]>();
    const loaders = makeLoaders({
      listThreadItems: async () => {
        threadListCalls += 1;
        return threadList.promise;
      },
    });
    const view = render(
      <MentionGetItemsHarness
        pages={[makePalettePage()]}
        pageSearchIndex={createSearchIndex()}
        getItemsSnapshots={getItemsSnapshots}
        loaders={loaders}
      />,
    );

    const firstGetItems = getItemsSnapshots.at(-1);
    expect(typeof firstGetItems).toBe("function");
    if (!firstGetItems) return;

    view.rerender(
      <MentionGetItemsHarness
        pages={[makePalettePage()]}
        pageSearchIndex={createSearchIndex()}
        getItemsSnapshots={getItemsSnapshots}
        loaders={loaders}
      />,
    );
    await settleAsyncRender();

    const secondGetItems = getItemsSnapshots.at(-1);
    expect(secondGetItems).toBe(firstGetItems);
    if (!secondGetItems) return;

    const firstItems = await secondGetItems("");
    const secondItems = await secondGetItems("");

    expect(firstItems.length).toBe(3);
    expect(secondItems.length).toBe(3);
    expect(firstItems[0]?.group).toBe("Current project");
    expect(firstItems[1]?.title).toBe("Today");
    expect(firstItems[2]?.title).toBe("Now");
    expect(pageDescriptionSearchCalls).toBe(0);
    expect(threadListCalls).toBe(1);

    await act(async () => {
      threadList.resolve([makeThread()]);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const refreshedGetItems = getItemsSnapshots.at(-1);
    expect(typeof refreshedGetItems).toBe("function");
    if (!refreshedGetItems) return;
    const refreshedItems = await refreshedGetItems("");
    expect(refreshedItems.length).toBe(4);
    expect(refreshedItems[0]?.title).toBe("Mention thread");
    expect(refreshedItems[1]?.title).toBe("Mention page");
    expect(refreshedItems[2]?.title).toBe("Today");
    expect(refreshedItems[3]?.title).toBe("Now");
  });

  test("@now returns the date mention before slow full-text searches resolve", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const threadList = createDeferred<CommandPaletteThread[]>();
    const pageDescriptionSearch = createDeferred<[]>();
    const threadSearch = createDeferred<[]>();
    const loaders = makeLoaders({
      listThreadItems: async () => threadList.promise,
      searchPageDescriptions: async () => pageDescriptionSearch.promise,
      searchThreads: async () => threadSearch.promise,
    });

    render(
      <MentionGetItemsHarness
        pages={[makePalettePage()]}
        pageSearchIndex={createSearchIndex()}
        getItemsSnapshots={getItemsSnapshots}
        loaders={loaders}
      />,
    );

    const getItems = getItemsSnapshots.at(-1);
    expect(typeof getItems).toBe("function");
    if (!getItems) return;

    const items = await getItems("now");

    expect(items.length > 0).toBe(true);
    expect(items[0]?.title).toBe("Now");
    expect(items[0]?.group).toBe("Dates");
  });

  test("slow search results only supplement the latest query", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const oldPageSearch = createDeferred<Awaited<ReturnType<NfmMentionGetItemsLoaders["searchPageDescriptions"]>>>();
    const nowPageSearch = createDeferred<Awaited<ReturnType<NfmMentionGetItemsLoaders["searchPageDescriptions"]>>>();
    const loaders = makeLoaders({
      listThreadItems: async () => new Promise<CommandPaletteThread[]>(() => undefined),
      searchPageDescriptions: async ({ query }) => (
        query === "old" ? oldPageSearch.promise : nowPageSearch.promise
      ),
      searchThreads: async () => new Promise<[]>(() => undefined),
      selectPageResults: ({ pageDescriptionSearchBatch }) => (
        (pageDescriptionSearchBatch?.results.length ?? 0) > 0
          ? [{
            ...makePalettePage(),
            page: {
              ...makePalettePage().page,
              title: "Async search page",
            },
          }]
          : []
      ),
    });

    render(
      <MentionGetItemsHarness
        pages={[]}
        pageSearchIndex={createSearchIndex()}
        getItemsSnapshots={getItemsSnapshots}
        loaders={loaders}
      />,
    );

    const getItems = getItemsSnapshots.at(-1);
    expect(typeof getItems).toBe("function");
    if (!getItems) return;

    await getItems("old");
    const nowItemsBeforeSearch = await getItems("now");
    expect(nowItemsBeforeSearch[0]?.title).toBe("Now");
    expect(nowItemsBeforeSearch.length).toBe(1);

    await act(async () => {
      oldPageSearch.resolve([{
        projectId: "project-1",
        pageId: "page-1",
        title: "Old result",
        status: "build",
        score: 1,
        excerpt: "old async result",
      }]);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const afterOldSearch = await getItems("now");
    expect(afterOldSearch[0]?.title).toBe("Now");
    expect(afterOldSearch.length).toBe(1);

    await act(async () => {
      nowPageSearch.resolve([{
        projectId: "project-1",
        pageId: "page-1",
        title: "Now result",
        status: "build",
        score: 1,
        excerpt: "now async result",
      }]);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const refreshedGetItems = getItemsSnapshots.at(-1);
    expect(typeof refreshedGetItems).toBe("function");
    if (!refreshedGetItems) return;
    const afterNowSearch = await refreshedGetItems("now");
    expect(afterNowSearch[0]?.title).toBe("Now");
    expect(afterNowSearch[1]?.title).toBe("Async search page");
  });
});
