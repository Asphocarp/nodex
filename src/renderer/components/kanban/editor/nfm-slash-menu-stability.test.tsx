import { beforeEach, describe, expect, test } from "vitest";
import { act } from "react";
import { render, settleAsyncRender } from "@/test/dom";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { CommandPaletteCard, CommandPaletteThread } from "@/lib/command-palette";
import type { CommandPaletteCardSearchIndex } from "@/lib/command-palette-card-search";
import type { NfmMentionGetItemsLoaders } from "./nfm-slash-menu";
import { plainTextToPortableRichText } from "../../../../shared/block-documents";
import { useNfmMentionGetItems } from "./nfm-slash-menu";

type GetItems = (query: string) => Promise<DefaultReactSuggestionItem[]>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

let cardDescriptionSearchCalls = 0;
let threadListCalls = 0;

const fakeEditor = {
  insertInlineContent: () => undefined,
};

function makePaletteCard(): CommandPaletteCard {
  const descriptionPreview = "Mention search card.";
  return {
    kind: "card",
    id: "project-1:card-1",
    projectId: "project-1",
    projectName: "Project",
    projectIcon: "",
    columnName: "Doing",
    card: {
      id: "card-1",
      title: "Mention card",
      richTitle: plainTextToPortableRichText("Mention card"),
      descriptionPreview,
      descriptionLength: descriptionPreview.length,
      hasDescription: true,
      status: "in_progress",
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
    projectless: false,
    pinned: false,
    pinnedOrder: null,
    statusType: "notLoaded",
    statusActiveFlags: [],
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-06-24T00:00:00.000Z",
    inActiveProject: true,
  };
}

function createSearchIndex(): CommandPaletteCardSearchIndex {
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
    searchCardDescriptions?: NfmMentionGetItemsLoaders["searchCardDescriptions"];
    searchThreadContent?: NfmMentionGetItemsLoaders["searchThreadContent"];
    selectCardResults?: NfmMentionGetItemsLoaders["selectCardResults"];
    selectChatResults?: NfmMentionGetItemsLoaders["selectChatResults"];
  } = {},
): NfmMentionGetItemsLoaders {
  return {
    searchCardDescriptions: options.searchCardDescriptions ?? (async () => {
      cardDescriptionSearchCalls += 1;
      return [];
    }),
    listThreadItems: options.listThreadItems ?? (async () => {
      threadListCalls += 1;
      return [makeThread()];
    }),
    searchThreadContent: options.searchThreadContent ?? (async () => []),
    selectCardResults: options.selectCardResults ?? (({ cards }) => cards),
    selectChatResults: options.selectChatResults ?? (({ threads }) => threads),
    createThreadSearchIndex: () => ({ search: () => [] }),
  };
}

function MentionGetItemsHarness({
  cards,
  cardSearchIndex,
  getItemsSnapshots,
  loaders,
}: {
  cards: CommandPaletteCard[];
  cardSearchIndex: CommandPaletteCardSearchIndex;
  getItemsSnapshots: GetItems[];
  loaders: NfmMentionGetItemsLoaders;
}) {
  const getItems = useNfmMentionGetItems({
    editor: fakeEditor,
    projectId: "project-1",
    cardItems: cards,
    cardSearchIndex,
    projectIdsForCardSearch: ["project-1"],
    loaders,
  });
  getItemsSnapshots.push(getItems);

  return <div>ready</div>;
}

beforeEach(() => {
  cardDescriptionSearchCalls = 0;
  threadListCalls = 0;
});

describe("useNfmMentionGetItems", () => {
  test("keeps getItems stable across volatile card arrays until an async refresh lands", async () => {
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
        cards={[makePaletteCard()]}
        cardSearchIndex={createSearchIndex()}
        getItemsSnapshots={getItemsSnapshots}
        loaders={loaders}
      />,
    );

    const firstGetItems = getItemsSnapshots.at(-1);
    expect(typeof firstGetItems).toBe("function");
    if (!firstGetItems) return;

    view.rerender(
      <MentionGetItemsHarness
        cards={[makePaletteCard()]}
        cardSearchIndex={createSearchIndex()}
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
    expect(cardDescriptionSearchCalls).toBe(0);
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
    expect(refreshedItems[1]?.title).toBe("Mention card");
    expect(refreshedItems[2]?.title).toBe("Today");
    expect(refreshedItems[3]?.title).toBe("Now");
  });

  test("@now returns the date mention before slow full-text searches resolve", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const threadList = createDeferred<CommandPaletteThread[]>();
    const cardDescriptionSearch = createDeferred<[]>();
    const threadContentSearch = createDeferred<[]>();
    const loaders = makeLoaders({
      listThreadItems: async () => threadList.promise,
      searchCardDescriptions: async () => cardDescriptionSearch.promise,
      searchThreadContent: async () => threadContentSearch.promise,
    });

    render(
      <MentionGetItemsHarness
        cards={[makePaletteCard()]}
        cardSearchIndex={createSearchIndex()}
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
    const oldCardSearch = createDeferred<Awaited<ReturnType<NfmMentionGetItemsLoaders["searchCardDescriptions"]>>>();
    const nowCardSearch = createDeferred<Awaited<ReturnType<NfmMentionGetItemsLoaders["searchCardDescriptions"]>>>();
    const loaders = makeLoaders({
      listThreadItems: async () => new Promise<CommandPaletteThread[]>(() => undefined),
      searchCardDescriptions: async ({ query }) => (
        query === "old" ? oldCardSearch.promise : nowCardSearch.promise
      ),
      searchThreadContent: async () => new Promise<[]>(() => undefined),
      selectCardResults: ({ cardDescriptionSearchBatch }) => (
        (cardDescriptionSearchBatch?.results.length ?? 0) > 0
          ? [{
            ...makePaletteCard(),
            card: {
              ...makePaletteCard().card,
              title: "Async search card",
            },
          }]
          : []
      ),
    });

    render(
      <MentionGetItemsHarness
        cards={[]}
        cardSearchIndex={createSearchIndex()}
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
      oldCardSearch.resolve([{
        projectId: "project-1",
        cardId: "card-1",
        status: "in_progress",
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
      nowCardSearch.resolve([{
        projectId: "project-1",
        cardId: "card-1",
        status: "in_progress",
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
    expect(afterNowSearch[1]?.title).toBe("Async search card");
  });
});
