import { describe, expect, test } from "vitest";
import {
  areCommandPalettePageFiltersEqual,
  filterCommandPaletteItems,
  getDefaultCommandPalettePageFilters,
  readCommandPalettePageFilters,
  summarizeCommandPalettePageFilters,
  type CommandPalettePage,
  type CommandPaletteCommand,
  type CommandPaletteThread,
  writeCommandPalettePageFilters,
} from "./command-palette";
import { createCommandPalettePageSearchIndex } from "./command-palette-page-search";
import { createCommandPaletteThreadSearchIndex } from "./command-palette-thread-search";
import type { DatabasePageSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents";

function makePage(overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Add quick page switching and commands.";
  const title = overrides.title ?? "Polish command palette";
  return {
    id: overrides.id ?? "page-1",
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
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

function makePalettePage(overrides: Partial<CommandPalettePage> = {}): CommandPalettePage {
  const page = overrides.page ?? makePage();
  return {
    kind: "page",
    id: overrides.id ?? `${overrides.projectId ?? "default"}:${page.id}`,
    projectId: overrides.projectId ?? "default",
    projectName: overrides.projectName ?? "Default",
    projectIcon: overrides.projectIcon ?? "",
    columnName: overrides.columnName ?? "In progress",
    page,
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
  test("prefers active-project pages when text relevance is tied", () => {
    const currentProjectPage = makePalettePage({
      page: makePage({ id: "page-a", title: "Command palette" }),
      inActiveProject: true,
      boardIndex: 5,
    });
    const otherProjectPage = makePalettePage({
      page: makePage({ id: "page-b", title: "Command palette" }),
      projectId: "ops",
      projectName: "Ops",
      inActiveProject: false,
      boardIndex: 0,
    });

    const result = filterCommandPaletteItems({
      query: "command pal",
      mode: "pages",
      commands: [],
      pages: [otherProjectPage, currentProjectPage],
      pageSearchIndex: createCommandPalettePageSearchIndex([otherProjectPage, currentProjectPage]),
    });

    expect(result.pages[0]?.page.id).toBe("page-a");
  });

  test("supports command-only root mode without a > prefix", () => {
    const result = filterCommandPaletteItems({
      query: "sett",
      mode: "root",
      commands: [
        makeCommand(),
        makeCommand({ id: "search", title: "Search tasks", subtitle: "Current project", keywords: ["find"] }),
      ],
      pages: [makePalettePage()],
      threads: [makePaletteThread()],
    });

    expect(result.mode).toBe("root");
    expect(result.commands.length).toBe(1);
    expect(result.commands[0]?.id).toBe("open-settings");
    expect(result.pages.length).toBe(0);
    expect(result.threads.length).toBe(0);
  });

  test("boosts recent pages when the query is otherwise tied", () => {
    const recentPage = makePalettePage({
      page: makePage({ id: "recent", title: "Search flow" }),
      recentIndex: 0,
      boardIndex: 10,
    });
    const stalePage = makePalettePage({
      page: makePage({ id: "stale", title: "Search flow" }),
      recentIndex: null,
      boardIndex: 0,
    });

    const result = filterCommandPaletteItems({
      query: "search flow",
      mode: "pages",
      commands: [],
      pages: [stalePage, recentPage],
      pageSearchIndex: createCommandPalettePageSearchIndex([stalePage, recentPage]),
    });

    expect(result.pages[0]?.page.id).toBe("recent");
  });

  test("returns fuzzy description matches in page results", () => {
    const descriptionPage = makePalettePage({
      page: makePage({
        id: "description-hit",
        title: "Misc task",
        descriptionPreview: "Rebuild the search indxer for the command palette.",
      }),
    });

    const result = filterCommandPaletteItems({
      query: "search indexer",
      mode: "pages",
      commands: [],
      pages: [descriptionPage],
      pageSearchIndex: createCommandPalettePageSearchIndex([descriptionPage]),
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]?.page.id).toBe("description-hit");
  });

  test("returns useful defaults for an empty query", () => {
    const result = filterCommandPaletteItems({
      query: "",
      mode: "pages",
      commands: [
        makeCommand({ id: "terminal", title: "Toggle terminal", priority: 300 }),
        makeCommand({ id: "board", title: "Switch to board", priority: 200 }),
      ],
      pages: [
        makePalettePage({ page: makePage({ id: "alpha", title: "Alpha" }), boardIndex: 3 }),
        makePalettePage({ page: makePage({ id: "beta", title: "Beta" }), boardIndex: 0 }),
      ],
      threads: [
        makePaletteThread({ threadId: "older", id: "thread:older", updatedAt: 100 }),
        makePaletteThread({ threadId: "newer", id: "thread:newer", updatedAt: 200 }),
      ],
    });

    expect(result.pages[0]?.page.id).toBe("beta");
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
      pages: [],
      threads: [otherThread, targetThread],
      threadSearchIndex: createCommandPaletteThreadSearchIndex([otherThread, targetThread]),
    });

    expect(result.pages.length).toBe(0);
    expect(result.threads.length).toBe(1);
    expect(result.threads[0]?.threadId).toBe("thr-search");
    expect(result.threads[0]?.searchDecorations?.titleSegments?.some((segment) => segment.highlight)).toBe(true);
  });

  test("filters pages by explicit tag and status filters", () => {
    const doneSearchPage = makePalettePage({
      page: makePage({
        id: "done-search",
        title: "Search polish",
        status: "done",
        tags: ["search", "palette"],
      }),
      columnName: "Done",
    });
    const backlogSearchPage = makePalettePage({
      page: makePage({
        id: "backlog-search",
        title: "Search polish",
        status: "backlog",
        tags: ["search"],
      }),
      columnName: "Backlog",
    });
    const doneOtherTagPage = makePalettePage({
      page: makePage({
        id: "done-other",
        title: "Other task",
        status: "done",
        tags: ["infra"],
      }),
      columnName: "Done",
    });

    const result = filterCommandPaletteItems({
      query: "",
      mode: "pages",
      commands: [],
      pages: [backlogSearchPage, doneOtherTagPage, doneSearchPage],
      pageFilters: {
        ...getDefaultCommandPalettePageFilters(),
        statuses: ["done"],
        tags: ["search"],
      },
      pageSearchIndex: createCommandPalettePageSearchIndex([
        backlogSearchPage,
        doneOtherTagPage,
        doneSearchPage,
      ]),
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]?.page.id).toBe("done-search");
  });

  test("combines project and assignee filters with free-text search", () => {
    const targetPage = makePalettePage({
      projectId: "ops",
      projectName: "Ops Console",
      page: makePage({
        id: "ops-page",
        title: "Executor queue",
        assignee: "Alex",
        descriptionPreview: "Refresh palette results after queue updates.",
      }),
    });
    const wrongProjectPage = makePalettePage({
      projectId: "design",
      projectName: "Design System",
      page: makePage({
        id: "design-page",
        title: "Executor queue",
        assignee: "Alex",
        descriptionPreview: "Refresh palette results after queue updates.",
      }),
    });
    const wrongAssigneePage = makePalettePage({
      projectId: "ops",
      projectName: "Ops Console",
      page: makePage({
        id: "other-assignee",
        title: "Executor queue",
        assignee: "Sam",
        descriptionPreview: "Refresh palette results after queue updates.",
      }),
    });

    const result = filterCommandPaletteItems({
      query: "queue",
      mode: "pages",
      commands: [],
      pages: [wrongProjectPage, wrongAssigneePage, targetPage],
      pageFilters: {
        ...getDefaultCommandPalettePageFilters(),
        assignees: ["Alex"],
        projectIds: ["ops"],
      },
      pageSearchIndex: createCommandPalettePageSearchIndex([
        wrongProjectPage,
        wrongAssigneePage,
        targetPage,
      ]),
    });

    expect(result.pages.length).toBe(1);
    expect(result.pages[0]?.page.id).toBe("ops-page");
  });

  test("summarizes active palette filters in the same compact language as the view toolbar", () => {
    const summaries = summarizeCommandPalettePageFilters(
      {
        ...getDefaultCommandPalettePageFilters(),
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

      const written = writeCommandPalettePageFilters({
        ...getDefaultCommandPalettePageFilters(),
        projectIds: ["ops"],
        assignees: ["Alex"],
      });
      const read = readCommandPalettePageFilters();

      expect(areCommandPalettePageFiltersEqual(read, written)).toBe(true);
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
      pages: [],
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
      pages: [],
    });

    expect(result.commands.length).toBe(2);
    expect(result.commands[0]?.id).toBe("navigateBack");
    expect(result.commands[0]?.disabled).toBe(true);
    expect(result.commands[1]?.id).toBe("navigateForward");
  });
});
