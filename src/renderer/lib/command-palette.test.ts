import { describe, expect, test } from "bun:test";
import {
  areCommandPaletteCardFiltersEqual,
  filterCommandPaletteItems,
  getDefaultCommandPaletteCardFilters,
  readCommandPaletteCardFilters,
  summarizeCommandPaletteCardFilters,
  type CommandPaletteCard,
  type CommandPaletteCommand,
  type CommandPaletteThread,
  writeCommandPaletteCardFilters,
} from "./command-palette";
import { createCommandPaletteCardSearchIndex } from "./command-palette-card-search";
import { createCommandPaletteThreadSearchIndex } from "./command-palette-thread-search";
import type { CardSummary } from "./types";

function makeCard(overrides: Partial<CardSummary> = {}): CardSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Add quick card switching and commands.";
  return {
    id: overrides.id ?? "card-1",
    title: overrides.title ?? "Polish command palette",
    descriptionPreview,
    descriptionLength: overrides.descriptionLength ?? descriptionPreview.length,
    hasDescription: overrides.hasDescription ?? descriptionPreview.length > 0,
    status: overrides.status ?? "in_progress",
    archived: overrides.archived ?? false,
    priority: overrides.priority,
    estimate: overrides.estimate,
    tags: overrides.tags ?? ["search"],
    dueDate: overrides.dueDate,
    scheduledStart: overrides.scheduledStart,
    scheduledEnd: overrides.scheduledEnd,
    isAllDay: overrides.isAllDay ?? false,
    recurrence: overrides.recurrence,
    reminders: overrides.reminders ?? [],
    scheduleTimezone: overrides.scheduleTimezone,
    assignee: overrides.assignee,
    agentStatus: overrides.agentStatus,
    agentBlocked: overrides.agentBlocked ?? false,
    runInTarget: overrides.runInTarget ?? "localProject",
    runInLocalPath: overrides.runInLocalPath,
    runInBaseBranch: overrides.runInBaseBranch,
    runInWorktreePath: overrides.runInWorktreePath,
    runInEnvironmentPath: overrides.runInEnvironmentPath,
    revision: overrides.revision ?? 1,
    created: overrides.created ?? new Date("2026-03-13T00:00:00.000Z"),
    order: overrides.order ?? 0,
  };
}

function makeCommand(overrides: Partial<CommandPaletteCommand> = {}): CommandPaletteCommand {
  return {
    kind: "command",
    id: overrides.id ?? "open-settings",
    group: overrides.group ?? "Configure",
    title: overrides.title ?? "Open settings",
    subtitle: overrides.subtitle ?? "App preferences",
    keywords: overrides.keywords ?? ["settings", "preferences"],
    shortcut: overrides.shortcut,
    active: overrides.active ?? false,
    disabled: overrides.disabled ?? false,
    priority: overrides.priority ?? 100,
  };
}

function makePaletteCard(overrides: Partial<CommandPaletteCard> = {}): CommandPaletteCard {
  const card = overrides.card ?? makeCard();
  return {
    kind: "card",
    id: overrides.id ?? `${overrides.projectId ?? "default"}:${card.id}`,
    projectId: overrides.projectId ?? "default",
    projectName: overrides.projectName ?? "Default",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "In progress",
    card,
    inActiveProject: overrides.inActiveProject ?? true,
    recentIndex: overrides.recentIndex ?? null,
    boardIndex: overrides.boardIndex ?? 0,
  };
}

function makePaletteThread(overrides: Partial<CommandPaletteThread> = {}): CommandPaletteThread {
  return {
    kind: "thread",
    id: overrides.id ?? "thread:thr-1",
    threadId: overrides.threadId ?? "thr-1",
    sessionId: overrides.sessionId === undefined ? "session-1" : overrides.sessionId,
    projectId: overrides.projectId === undefined ? "default" : overrides.projectId,
    projectName: overrides.projectName === undefined ? "Default" : overrides.projectName,
    title: overrides.title ?? "Command palette thread search",
    preview: overrides.preview ?? "Add thread search to the launcher.",
    cwd: overrides.cwd ?? "/tmp/default",
    projectless: overrides.projectless ?? false,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1_781_990_400,
    updatedAt: overrides.updatedAt ?? 1_781_990_400,
    linkedAt: overrides.linkedAt ?? "2026-06-20T00:00:00.000Z",
    inActiveProject: overrides.inActiveProject ?? true,
  };
}

const storageMap = new Map<string, string>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key) ?? null : null;
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, value);
  },
  clear(): void {
    storageMap.clear();
  },
};

function withMockLocalStorage(run: () => void): void {
  const storageGlobal = globalThis as { localStorage?: typeof mockStorage };
  const previousLocalStorage = storageGlobal.localStorage;
  storageGlobal.localStorage = mockStorage;
  try {
    run();
  } finally {
    if (previousLocalStorage) {
      storageGlobal.localStorage = previousLocalStorage;
      return;
    }
    delete storageGlobal.localStorage;
  }
}

describe("filterCommandPaletteItems", () => {
  test("prefers active-project cards when text relevance is tied", () => {
    const currentProjectCard = makePaletteCard({
      card: makeCard({ id: "card-a", title: "Command palette" }),
      inActiveProject: true,
      boardIndex: 5,
    });
    const otherProjectCard = makePaletteCard({
      card: makeCard({ id: "card-b", title: "Command palette" }),
      projectId: "ops",
      projectName: "Ops",
      inActiveProject: false,
      boardIndex: 0,
    });

    const result = filterCommandPaletteItems({
      query: "command pal",
      mode: "cards",
      commands: [],
      cards: [otherProjectCard, currentProjectCard],
      cardSearchIndex: createCommandPaletteCardSearchIndex([otherProjectCard, currentProjectCard]),
    });

    expect(result.cards[0]?.card.id).toBe("card-a");
  });

  test("supports command-only root mode without a > prefix", () => {
    const result = filterCommandPaletteItems({
      query: "sett",
      mode: "root",
      commands: [
        makeCommand(),
        makeCommand({ id: "search", title: "Search tasks", subtitle: "Current project", keywords: ["find"] }),
      ],
      cards: [makePaletteCard()],
      threads: [makePaletteThread()],
    });

    expect(result.mode).toBe("root");
    expect(result.commands.length).toBe(1);
    expect(result.commands[0]?.id).toBe("open-settings");
    expect(result.cards.length).toBe(0);
    expect(result.threads.length).toBe(0);
  });

  test("boosts recent cards when the query is otherwise tied", () => {
    const recentCard = makePaletteCard({
      card: makeCard({ id: "recent", title: "Search flow" }),
      recentIndex: 0,
      boardIndex: 10,
    });
    const staleCard = makePaletteCard({
      card: makeCard({ id: "stale", title: "Search flow" }),
      recentIndex: null,
      boardIndex: 0,
    });

    const result = filterCommandPaletteItems({
      query: "search flow",
      mode: "cards",
      commands: [],
      cards: [staleCard, recentCard],
      cardSearchIndex: createCommandPaletteCardSearchIndex([staleCard, recentCard]),
    });

    expect(result.cards[0]?.card.id).toBe("recent");
  });

  test("returns fuzzy description matches in card results", () => {
    const descriptionCard = makePaletteCard({
      card: makeCard({
        id: "description-hit",
        title: "Misc task",
        descriptionPreview: "Rebuild the search indxer for the command palette.",
      }),
    });

    const result = filterCommandPaletteItems({
      query: "search indexer",
      mode: "cards",
      commands: [],
      cards: [descriptionCard],
      cardSearchIndex: createCommandPaletteCardSearchIndex([descriptionCard]),
    });

    expect(result.cards.length).toBe(1);
    expect(result.cards[0]?.card.id).toBe("description-hit");
  });

  test("returns useful defaults for an empty query", () => {
    const result = filterCommandPaletteItems({
      query: "",
      mode: "cards",
      commands: [
        makeCommand({ id: "terminal", title: "Toggle terminal", priority: 300 }),
        makeCommand({ id: "board", title: "Switch to board", priority: 200 }),
      ],
      cards: [
        makePaletteCard({ card: makeCard({ id: "alpha", title: "Alpha" }), boardIndex: 3 }),
        makePaletteCard({ card: makeCard({ id: "beta", title: "Beta" }), boardIndex: 0 }),
      ],
      threads: [
        makePaletteThread({ threadId: "older", id: "thread:older", updatedAt: 100 }),
        makePaletteThread({ threadId: "newer", id: "thread:newer", updatedAt: 200 }),
      ],
    });

    expect(result.cards[0]?.card.id).toBe("beta");
    expect(result.commands.length).toBe(0);
    expect(result.threads.length).toBe(0);
  });

  test("returns chat metadata matches in chats mode", () => {
    const targetThread = makePaletteThread({
      threadId: "thr-search",
      id: "thread:thr-search",
      title: "Search thread transcripts",
      preview: "Find historical thread content.",
    });
    const otherThread = makePaletteThread({
      threadId: "thr-other",
      id: "thread:thr-other",
      title: "Terminal polish",
      preview: "Adjust panel layout.",
    });

    const result = filterCommandPaletteItems({
      query: "thread transcript",
      mode: "chats",
      commands: [],
      cards: [],
      threads: [otherThread, targetThread],
      threadSearchIndex: createCommandPaletteThreadSearchIndex([otherThread, targetThread]),
    });

    expect(result.cards.length).toBe(0);
    expect(result.threads.length).toBe(1);
    expect(result.threads[0]?.threadId).toBe("thr-search");
    expect(result.threads[0]?.searchDecorations?.titleSegments?.some((segment) => segment.highlight)).toBeTrue();
  });

  test("filters cards by explicit tag and status filters", () => {
    const doneSearchCard = makePaletteCard({
      card: makeCard({
        id: "done-search",
        title: "Search polish",
        status: "done",
        tags: ["search", "palette"],
      }),
      columnName: "Done",
    });
    const backlogSearchCard = makePaletteCard({
      card: makeCard({
        id: "backlog-search",
        title: "Search polish",
        status: "backlog",
        tags: ["search"],
      }),
      columnName: "Backlog",
    });
    const doneOtherTagCard = makePaletteCard({
      card: makeCard({
        id: "done-other",
        title: "Other task",
        status: "done",
        tags: ["infra"],
      }),
      columnName: "Done",
    });

    const result = filterCommandPaletteItems({
      query: "",
      mode: "cards",
      commands: [],
      cards: [backlogSearchCard, doneOtherTagCard, doneSearchCard],
      cardFilters: {
        ...getDefaultCommandPaletteCardFilters(),
        statuses: ["done"],
        tags: ["search"],
      },
      cardSearchIndex: createCommandPaletteCardSearchIndex([
        backlogSearchCard,
        doneOtherTagCard,
        doneSearchCard,
      ]),
    });

    expect(result.cards.length).toBe(1);
    expect(result.cards[0]?.card.id).toBe("done-search");
  });

  test("combines project and assignee filters with free-text search", () => {
    const targetCard = makePaletteCard({
      projectId: "ops",
      projectName: "Ops Console",
      card: makeCard({
        id: "ops-card",
        title: "Executor queue",
        assignee: "Alex",
        descriptionPreview: "Refresh palette results after queue updates.",
      }),
    });
    const wrongProjectCard = makePaletteCard({
      projectId: "design",
      projectName: "Design System",
      card: makeCard({
        id: "design-card",
        title: "Executor queue",
        assignee: "Alex",
        descriptionPreview: "Refresh palette results after queue updates.",
      }),
    });
    const wrongAssigneeCard = makePaletteCard({
      projectId: "ops",
      projectName: "Ops Console",
      card: makeCard({
        id: "other-assignee",
        title: "Executor queue",
        assignee: "Sam",
        descriptionPreview: "Refresh palette results after queue updates.",
      }),
    });

    const result = filterCommandPaletteItems({
      query: "queue",
      mode: "cards",
      commands: [],
      cards: [wrongProjectCard, wrongAssigneeCard, targetCard],
      cardFilters: {
        ...getDefaultCommandPaletteCardFilters(),
        assignees: ["Alex"],
        projectIds: ["ops"],
      },
      cardSearchIndex: createCommandPaletteCardSearchIndex([
        wrongProjectCard,
        wrongAssigneeCard,
        targetCard,
      ]),
    });

    expect(result.cards.length).toBe(1);
    expect(result.cards[0]?.card.id).toBe("ops-card");
  });

  test("summarizes active palette filters in the same compact language as the view toolbar", () => {
    const summaries = summarizeCommandPaletteCardFilters(
      {
        ...getDefaultCommandPaletteCardFilters(),
        statuses: ["backlog", "in_progress"],
        priorities: ["p0-critical"],
        includeEmptyPriority: true,
        tags: ["search"],
        assignees: ["Alex"],
        projectIds: ["ops"],
      },
      new Map([["ops", "Ops Console"]]),
    );

    expect(summaries.length).toBe(5);
    expect(summaries[0]?.label).toBe("Status");
    expect(summaries[0]?.value).toBe("Backlog, In Progress");
    expect(summaries[1]?.value).toBe("P0, -");
    expect(summaries[2]?.label).toBe("Tags (any)");
    expect(summaries[4]?.value).toBe("Ops Console");
  });

  test("reads and writes persisted palette filters through localStorage", () => {
    withMockLocalStorage(() => {
      mockStorage.clear();

      const written = writeCommandPaletteCardFilters({
        ...getDefaultCommandPaletteCardFilters(),
        projectIds: ["ops"],
        assignees: ["Alex"],
      });
      const read = readCommandPaletteCardFilters();

      expect(areCommandPaletteCardFiltersEqual(read, written)).toBeTrue();
      expect(read.projectIds[0]).toBe("ops");
      expect(read.assignees[0]).toBe("Alex");
    });
  });

  test("root mode searches commands directly", () => {
    const result = filterCommandPaletteItems({
      query: "go",
      mode: "root",
      commands: [
        makeCommand({ id: "navigateBack", title: "Back", keywords: ["back"], disabled: true, priority: 500 }),
        makeCommand({ id: "navigateForward", title: "Forward", keywords: ["forward"], disabled: false, priority: 490 }),
      ],
      cards: [],
    });

    expect(result.mode).toBe("root");
    expect(result.commands.length).toBe(0);
  });

  test("preserves disabled back and forward commands in root mode", () => {
    const result = filterCommandPaletteItems({
      query: "",
      mode: "root",
      commands: [
        makeCommand({ id: "navigateBack", title: "Back", keywords: ["back"], disabled: true, priority: 500 }),
        makeCommand({ id: "navigateForward", title: "Forward", keywords: ["forward"], disabled: false, priority: 490 }),
      ],
      cards: [],
    });

    expect(result.commands.length).toBe(2);
    expect(result.commands[0]?.id).toBe("navigateBack");
    expect(result.commands[0]?.disabled).toBeTrue();
    expect(result.commands[1]?.id).toBe("navigateForward");
  });
});
