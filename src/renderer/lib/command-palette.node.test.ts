import { describe, expect, test } from "vitest";
import {
  COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY,
  LEGACY_COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY,
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
import { createCommandPaletteThreadSearchIndex } from "./command-palette-thread-search";
import type { DatabasePageSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents/portable-rich-text";
import { DEFAULT_PROJECT_APPEARANCE } from "../../shared/project-appearance";

function makePage(overrides: Partial<DatabasePageSummary> = {}): DatabasePageSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Add quick page switching and commands.";
  const title = overrides.title ?? "Polish command palette";
  return {
    id: overrides.id ?? "page-1",
    pageKey: overrides.pageKey ?? null,
    title,
    richTitle: overrides.richTitle ?? plainTextToPortableRichText(title),
    descriptionPreview,
    descriptionLength: overrides.descriptionLength ?? descriptionPreview.length,
    hasDescription: overrides.hasDescription ?? descriptionPreview.length > 0,
    status: overrides.status ?? "build",
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
    projectAppearance: overrides.projectAppearance ?? DEFAULT_PROJECT_APPEARANCE,
    columnName: overrides.columnName ?? "In progress",
    page,
    tagLabels: overrides.tagLabels ?? page.tags,
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
    gitBranch: overrides.gitBranch ?? null,
    projectless: overrides.projectless ?? false,
    pinned: overrides.pinned ?? false,
    pinnedOrder: overrides.pinnedOrder ?? null,
    statusType: overrides.statusType ?? "notLoaded",
    statusActiveFlags: overrides.statusActiveFlags ?? [],
    createdAt: overrides.createdAt ?? 1_781_990_400,
    updatedAt: overrides.updatedAt ?? 1_781_990_400,
    inActiveProject: overrides.inActiveProject ?? true,
  };
}

const storageMap = new Map<string, string>();
let failCurrentStorageWrite = false;

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key) ?? null : null;
  },
  setItem(key: string, value: string): void {
    if (failCurrentStorageWrite && key === COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY) {
      throw new Error("storage full");
    }
    storageMap.set(key, value);
  },
  removeItem(key: string): void {
    storageMap.delete(key);
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

  test("matches and decorates a bounded fuzzy command subsequence", () => {
    const result = filterCommandPaletteItems({
      query: "opnset",
      mode: "root",
      commands: [makeCommand()],
      pages: [],
    });

    expect(result.commands).toHaveLength(1);
    expect(
      result.commands[0]?.searchTitleSegments
        ?.filter((segment) => segment.highlight)
        .map((segment) => segment.text)
        .join("")
        .toLocaleLowerCase(),
    ).toBe("opnset");
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

  test("summarizes active palette filters in the same compact language as the view toolbar", () => {
    const summaries = summarizeCommandPalettePageFilters(
      {
        ...getDefaultCommandPalettePageFilters(),
        statuses: ["plan", "build"],
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
    expect(summaries[0]?.value).toBe("Plan, Build");
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

  test("imports v1 P4 filters into the v2 storage contract as P3", () => {
    withMockLocalStorage(() => {
      mockStorage.clear();
      mockStorage.setItem(
        LEGACY_COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY,
        JSON.stringify({
          ...getDefaultCommandPalettePageFilters(),
          priorities: ["p4-later", "p3-low", "p4-later"],
          includeEmptyPriority: false,
        }),
      );

      const migrated = readCommandPalettePageFilters();

      expect(migrated.priorities).toEqual(["p3-low"]);
      expect(migrated.includeEmptyPriority).toBe(false);
      expect(mockStorage.getItem(COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY))
        .not.toBeNull();
      expect(mockStorage.getItem(LEGACY_COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY))
        .toBeNull();
    });
  });

  test("retains v1 palette filters when the v2 write fails", () => {
    withMockLocalStorage(() => {
      mockStorage.clear();
      mockStorage.setItem(
        LEGACY_COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY,
        JSON.stringify({
          ...getDefaultCommandPalettePageFilters(),
          priorities: ["p4-later"],
        }),
      );
      failCurrentStorageWrite = true;
      try {
        expect(readCommandPalettePageFilters().priorities).toEqual(["p3-low"]);
      } finally {
        failCurrentStorageWrite = false;
      }
      expect(mockStorage.getItem(COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY))
        .toBeNull();
      expect(mockStorage.getItem(LEGACY_COMMAND_PALETTE_PAGE_FILTERS_STORAGE_KEY))
        .not.toBeNull();
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
