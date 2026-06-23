import { beforeEach, describe, expect, test } from "bun:test";
import { render, settleAsyncRender } from "@/test/dom";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { CommandPaletteCard, CommandPaletteThread } from "@/lib/command-palette";
import type { CommandPaletteCardSearchIndex } from "@/lib/command-palette-card-search";
import type { NfmMentionGetItemsLoaders } from "./nfm-slash-menu";
import { useNfmMentionGetItems } from "./nfm-slash-menu";

type GetItems = (query: string) => Promise<DefaultReactSuggestionItem[]>;

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
      descriptionPreview,
      descriptionLength: descriptionPreview.length,
      hasDescription: true,
      status: "in_progress",
      archived: false,
      tags: [],
      reminders: [],
      isAllDay: false,
      agentBlocked: false,
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

function makeLoaders(): NfmMentionGetItemsLoaders {
  return {
    searchCardDescriptions: async () => {
      cardDescriptionSearchCalls += 1;
      return [];
    },
    listThreadItems: async () => {
      threadListCalls += 1;
      return [makeThread()];
    },
    searchThreadContent: async () => [],
    selectCardResults: ({ cards }) => cards,
    selectChatResults: ({ threads }) => threads,
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
  test("keeps getItems stable across volatile card arrays and indexes", async () => {
    const getItemsSnapshots: GetItems[] = [];
    const loaders = makeLoaders();
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

    expect(firstItems.length).toBe(2);
    expect(secondItems.length).toBe(2);
    expect(firstItems[0]?.group).toBe("Current project");
    expect(firstItems[1]?.group).toBe("Current project");
    expect(cardDescriptionSearchCalls).toBe(2);
    expect(threadListCalls).toBe(1);
  });
});
