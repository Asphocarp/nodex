import { act } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import type { DefaultReactSuggestionItem } from "@blocknote/react";

import type { CommandPaletteThread } from "@/lib/command-palette";
import { render, settleAsyncRender } from "@/test/dom";
import { type NfmMentionGetItemsLoaders, useNfmMentionGetItems } from "./nfm-slash-menu";

type GetItems = (query: string) => Promise<DefaultReactSuggestionItem[]>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};
type ThreadSearchResults = Awaited<ReturnType<NfmMentionGetItemsLoaders["searchThreads"]>>;

let threadListCalls = 0;

const fakeEditor = {
  insertInlineContent: () => undefined,
};

function makeThread(overrides: Partial<CommandPaletteThread> = {}): CommandPaletteThread {
  return {
    kind: "thread",
    id: overrides.id ?? "thread:thr-1",
    threadId: overrides.threadId ?? "thr-1",
    sessionId: overrides.sessionId === undefined ? "session-1" : overrides.sessionId,
    projectId: overrides.projectId === undefined ? "project-1" : overrides.projectId,
    projectName: overrides.projectName === undefined ? "Project" : overrides.projectName,
    title: overrides.title ?? "Mention thread",
    preview: overrides.preview ?? "Mention thread preview.",
    cwd: overrides.cwd ?? "/tmp/project",
    gitBranch: overrides.gitBranch ?? null,
    projectless: overrides.projectless ?? false,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
    inActiveProject: overrides.inActiveProject ?? true,
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function makeLoaders(options: Partial<NfmMentionGetItemsLoaders> = {}): NfmMentionGetItemsLoaders {
  return {
    listThreadItems:
      options.listThreadItems ??
      (async () => {
        threadListCalls += 1;
        return [makeThread()];
      }),
    searchThreads: options.searchThreads ?? (async () => []),
    selectChatResults: options.selectChatResults ?? (({ threads }) => threads),
    createThreadSearchIndex: options.createThreadSearchIndex ?? (() => ({ search: () => [] })),
  };
}

function MentionGetItemsHarness({
  getItemsSnapshots,
  loaders,
}: {
  getItemsSnapshots: GetItems[];
  loaders: NfmMentionGetItemsLoaders;
}) {
  const getItems = useNfmMentionGetItems({
    editor: fakeEditor,
    activeProjectId: "project-1",
    loaders,
  });
  getItemsSnapshots.push(getItems);

  return <div>ready</div>;
}

beforeEach(() => {
  threadListCalls = 0;
});

describe("useNfmMentionGetItems", () => {
  test("keeps getItems stable until the async chat refresh lands", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const threadList = createDeferred<CommandPaletteThread[]>();
    const loaders = makeLoaders({
      listThreadItems: async () => {
        threadListCalls += 1;
        return threadList.promise;
      },
    });
    const view = render(
      <MentionGetItemsHarness getItemsSnapshots={getItemsSnapshots} loaders={loaders} />,
    );

    const firstGetItems = getItemsSnapshots.at(-1);
    expect(typeof firstGetItems).toBe("function");
    if (!firstGetItems) return;

    view.rerender(
      <MentionGetItemsHarness getItemsSnapshots={getItemsSnapshots} loaders={loaders} />,
    );
    await settleAsyncRender();

    const secondGetItems = getItemsSnapshots.at(-1);
    expect(secondGetItems).toBe(firstGetItems);
    if (!secondGetItems) return;

    const firstItems = await secondGetItems("");
    const secondItems = await secondGetItems("");

    expect(firstItems.map((item) => item.title)).toEqual(["Today", "Now"]);
    expect(secondItems.map((item) => item.title)).toEqual(["Today", "Now"]);
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
    expect(refreshedItems.map((item) => item.title)).toEqual(["Mention thread", "Today", "Now"]);
  });

  test("@now returns the date affordance before a slow chat search resolves", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const threadList = createDeferred<CommandPaletteThread[]>();
    const threadSearch = createDeferred<ThreadSearchResults>();
    const loaders = makeLoaders({
      listThreadItems: async () => threadList.promise,
      searchThreads: async () => threadSearch.promise,
    });

    render(<MentionGetItemsHarness getItemsSnapshots={getItemsSnapshots} loaders={loaders} />);

    const getItems = getItemsSnapshots.at(-1);
    expect(typeof getItems).toBe("function");
    if (!getItems) return;

    const items = await getItems("now");

    expect(items.map((item) => item.title)).toEqual(["Now"]);
    expect(items[0]?.group).toBe("Date");
  });

  test("slow chat search results only supplement the latest query", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const oldThreadSearch = createDeferred<ThreadSearchResults>();
    const nowThreadSearch = createDeferred<ThreadSearchResults>();
    const loaders = makeLoaders({
      listThreadItems: async () => new Promise<CommandPaletteThread[]>(() => undefined),
      searchThreads: async ({ query }) =>
        query === "old" ? oldThreadSearch.promise : nowThreadSearch.promise,
      selectChatResults: ({ threadSearchBatch }) =>
        threadSearchBatch ? [makeThread({ title: "Async search thread" })] : [],
    });

    render(<MentionGetItemsHarness getItemsSnapshots={getItemsSnapshots} loaders={loaders} />);

    const getItems = getItemsSnapshots.at(-1);
    expect(typeof getItems).toBe("function");
    if (!getItems) return;

    await getItems("old");
    expect((await getItems("now")).map((item) => item.title)).toEqual(["Now"]);

    await act(async () => {
      oldThreadSearch.resolve([]);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect((await getItems("now")).map((item) => item.title)).toEqual(["Now"]);

    await act(async () => {
      nowThreadSearch.resolve([]);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const refreshedGetItems = getItemsSnapshots.at(-1);
    expect(typeof refreshedGetItems).toBe("function");
    if (!refreshedGetItems) return;
    expect((await refreshedGetItems("now")).map((item) => item.title)).toEqual([
      "Async search thread",
      "Now",
    ]);
  });
});
