import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act, fireEvent } from "@testing-library/react";
import type {
  CommandPaletteCard,
  CommandPaletteCommand,
  CommandPaletteThread,
} from "@/lib/command-palette";
import { getDefaultCommandPaletteCardFilters } from "@/lib/command-palette";
import {
  buildCommandPaletteCommands,
  OPEN_DB_VIEW_TAB_COMMAND_ID,
  type CommandPaletteShellCommandContext,
} from "@/lib/command-palette-commands";
import type { CardSummary } from "@/lib/types";
import { createCommandPaletteCardSearchIndex } from "../../lib/command-palette-card-search";
import { createCommandPaletteThreadSearchIndex } from "../../lib/command-palette-thread-search";
import { render, settleAsyncRender, textContent } from "../../test/dom";
import { createCommandKeymapState } from "../../../shared/command-keybindings";
import {
  RENAME_THREAD_COMMAND_ID,
  TOGGLE_SIDEBAR_COMMAND_ID,
} from "../../../shared/window-navigation";

mock.module("./card-icon", () => ({
  CardIcon: ({ className }: { className?: string }) => createElement("span", { className }, "C"),
}));

mock.module("./threads-icon", () => ({
  ThreadsIcon: ({ className }: { className?: string }) => createElement("span", { className }, "T"),
}));

mock.module("./toggle-list-icon", () => ({
  ToggleListIcon: ({ className }: { className?: string }) => createElement("span", { className }, "L"),
}));

let mockInvokeImplementation: (...args: unknown[]) => Promise<unknown> = async () => [];
const mockInvoke = (...args: unknown[]) => mockInvokeImplementation(...args);
let threadIndexUpdateCallbacks: Array<() => void> = [];

mock.module("../../lib/api", () => ({
  invoke: mockInvoke,
  subscribeCommandPaletteThreadIndexUpdates: (callback: () => void) => {
    threadIndexUpdateCallbacks.push(callback);
    return () => {
      threadIndexUpdateCallbacks = threadIndexUpdateCallbacks.filter((entry) => entry !== callback);
    };
  },
}));

function makeCommandContext(
  overrides: Partial<CommandPaletteShellCommandContext> = {},
): CommandPaletteShellCommandContext {
  return {
    canGoBack: true,
    canGoForward: true,
    canStartNewChat: true,
    showMockCommands: false,
    hasActiveSession: true,
    activeSessionPinned: false,
    hasAttachedThread: true,
    canOpenSessionInNewWindow: true,
    isMac: true,
    ...overrides,
  };
}

describe("buildCommandPaletteCommands", () => {
  test("includes the Codex toggleSidebar command with Cmd+B shortcut", async () => {
    const commands = buildCommandPaletteCommands(makeCommandContext());
    const sidebarCommand = commands.find((command) => command.id === TOGGLE_SIDEBAR_COMMAND_ID);

    expect(sidebarCommand?.title).toBe("Toggle sidebar");
    expect(sidebarCommand?.shortcut).toBe("⌘B");
  });

  test("includes find as a real shell command", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext());
    const findCommand = commands.find((command) => command.id === "findInThread");

    expect(findCommand?.title).toBe("Find");
    expect(Boolean(findCommand?.disabled)).toBeFalse();
    expect(Boolean(findCommand?.mockReason)).toBeFalse();
  });

  test("includes Manage automations as a real shell command", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext());
    const manageTasksCommand = commands.find((command) => command.id === "manageTasks");

    expect(manageTasksCommand?.title).toBe("Manage automations");
    expect(Boolean(manageTasksCommand?.disabled)).toBeFalse();
    expect(Boolean(manageTasksCommand?.mockReason)).toBeFalse();
  });

  test("includes Process Manager as a real shell command", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext());
    const processManagerCommand = commands.find((command) => command.id === "openProcessManager");

    expect(processManagerCommand?.title).toBe("Process Manager");
    expect(processManagerCommand?.shortcut).toBe("⌃⌥M");
    expect(Boolean(processManagerCommand?.disabled)).toBeFalse();
    expect(Boolean(processManagerCommand?.mockReason)).toBeFalse();
  });

  test("omits legacy stage and DB view-switch commands", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext());
    const ids = commands.map((command) => command.id).join(",");

    expect(ids.includes("focus-views-stage")).toBeFalse();
    expect(ids.includes("focus-cards-stage")).toBeFalse();
    expect(ids.includes("focus-threads-stage")).toBeFalse();
    expect(ids.includes("focus-diff-stage")).toBeFalse();
    expect(ids.includes("view-kanban")).toBeFalse();
    expect(ids.includes("view-list")).toBeFalse();
    expect(ids.includes("view-toggle-list")).toBeFalse();
    expect(ids.includes("view-canvas")).toBeFalse();
    expect(ids.includes("view-calendar")).toBeFalse();
    expect(ids.includes("open-project-picker")).toBeFalse();
    expect(ids.includes("search-current-project")).toBeFalse();
  });

  test("omits dev-only mock commands and removed redundant commands in production contexts", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext({
      showMockCommands: false,
    }));
    const ids = commands.map((command) => command.id).join(",");

    expect(commands.some((command) => command.mockReason !== undefined)).toBeFalse();
    expect(ids.includes("searchFiles")).toBeFalse();
    expect(ids.includes("git.commit")).toBeFalse();
    expect(ids.includes("toggleBrowserPanel")).toBeFalse();
    expect(ids.includes("openCardStage")).toBeFalse();
  });

  test("keeps unsupported parity commands as disabled mock rows in dev contexts", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext({
      showMockCommands: true,
    }));
    const searchFiles = commands.find((command) => command.id === "searchFiles");
    const gitCommit = commands.find((command) => command.id === "git.commit");
    const ids = commands.map((command) => command.id).join(",");

    expect(searchFiles?.disabled).toBeTrue();
    expect(Boolean(searchFiles?.mockReason)).toBeTrue();
    expect(gitCommit?.disabled).toBeTrue();
    expect(Boolean(gitCommit?.mockReason)).toBeTrue();
    expect(ids.includes("toggleBrowserPanel")).toBeFalse();
    expect(ids.includes("openCardStage")).toBeFalse();
  });

  test("uses custom command-keymap labels for shell commands", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext({
      commandKeymapState: createCommandKeymapState({
        toggleSidebar: ["CmdOrCtrl+Alt+B"],
      }, "macOS"),
    }));
    const sidebarCommand = commands.find((command) => command.id === TOGGLE_SIDEBAR_COMMAND_ID);

    expect(sidebarCommand?.shortcut).toBe("⌘⌥B");
  });

  test("disables unavailable session and side-chat commands", () => {
    const commands = buildCommandPaletteCommands(makeCommandContext({
      hasActiveSession: false,
      hasAttachedThread: false,
    }));
    const renameCommand = commands.find((command) => command.id === RENAME_THREAD_COMMAND_ID);
    const archiveCommand = commands.find((command) => command.id === "archiveThread");
    const sideChatCommand = commands.find((command) => command.id === "openSideChat");
    const dbViewCommand = commands.find((command) => command.id === OPEN_DB_VIEW_TAB_COMMAND_ID);

    expect(renameCommand?.disabled).toBeTrue();
    expect(archiveCommand?.disabled).toBeTrue();
    expect(sideChatCommand?.disabled).toBeTrue();
    expect(dbViewCommand?.disabled).toBeTrue();
  });
});

function makeCard(overrides: Partial<CardSummary> = {}): CardSummary {
  const descriptionPreview = overrides.descriptionPreview ?? "Rebuild the fuzzy search indxer for the palette.";
  return {
    id: overrides.id ?? "card-1",
    title: overrides.title ?? "Misc task",
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
    created: overrides.created ?? new Date("2026-03-14T00:00:00.000Z"),
    order: overrides.order ?? 0,
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
    id: overrides.id ?? "thread:thr-palette",
    threadId: overrides.threadId ?? "thr-palette",
    sessionId: overrides.sessionId === undefined ? "session-palette" : overrides.sessionId,
    projectId: overrides.projectId === undefined ? "default" : overrides.projectId,
    projectName: overrides.projectName === undefined ? "Default" : overrides.projectName,
    title: overrides.title ?? "Thread transcript search",
    preview: overrides.preview ?? "Search previous assistant messages from the command palette.",
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
    searchPreview: overrides.searchPreview,
    searchDecorations: overrides.searchDecorations,
  };
}

function makePaletteCommand(overrides: Partial<CommandPaletteCommand> = {}): CommandPaletteCommand {
  return {
    kind: "command",
    id: overrides.id ?? "settings",
    group: overrides.group ?? "Configure",
    title: overrides.title ?? "Settings",
    subtitle: overrides.subtitle ?? "Open settings",
    keywords: overrides.keywords ?? ["settings"],
    shortcut: overrides.shortcut,
    active: overrides.active,
    disabled: overrides.disabled,
    mockReason: overrides.mockReason,
    priority: overrides.priority ?? 100,
  };
}

describe("CommandPaletteSurface", () => {
  test("opens the top fuzzy description match when the selected result is activated", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const executedItems: CommandPaletteCard[] = [];
    const closeCalls: number[] = [];
    const cards = [
      makePaletteCard({
        card: makeCard({
          id: "card-1",
          title: "Misc task",
          descriptionPreview: "Rebuild the fuzzy search indxer for the palette.",
        }),
      }),
    ];
    const { container } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={1}
        mode="cards"
        initialQuery="search indexer"
        commands={[]}
        cards={cards}
        cardSearchIndex={createCommandPaletteCardSearchIndex(cards)}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => {
          closeCalls.push(1);
        }}
        onExecute={(item: CommandPaletteCard | CommandPaletteCommand | CommandPaletteThread) => {
          if (item.kind !== "card") {
            return;
          }
          executedItems.push(item);
        }}
      />,
    );

    await settleAsyncRender();
    const topResult = container.querySelector('button[cmdk-item][data-selected="true"]');

    expect(textContent(container).includes("fuzzy search indxer")).toBeTrue();
    expect(topResult).not.toBeNull();
    fireEvent.click(topResult as HTMLElement);

    expect(closeCalls.length).toBe(1);
    expect(executedItems.length).toBe(1);
    expect(executedItems[0]?.card.id).toBe("card-1");
  });

  test("root mode searches commands without the legacy > prefix", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const { container, getByLabelText } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={2}
        mode="root"
        initialQuery="settings"
        commands={[
          makePaletteCommand({
            id: "settings",
            title: "Settings",
            subtitle: "App preferences",
            keywords: ["settings", "preferences"],
          }),
        ]}
        cards={[
          makePaletteCard({
            card: makeCard({
              id: "card-2",
              title: "Misc task",
              descriptionPreview: "Should not appear while command mode is active.",
            }),
          }),
        ]}
        cardSearchIndex={createCommandPaletteCardSearchIndex([])}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => undefined}
        onExecute={() => undefined}
      />,
    );

    await settleAsyncRender();

    const input = getByLabelText("Command palette search") as HTMLInputElement;
    const resultButtons = Array.from(container.querySelectorAll('button[cmdk-item]'));
    expect(input.value).toBe("settings");
    expect(resultButtons.length).toBe(1);
    expect(textContent(container).includes("Misc task")).toBeFalse();
    expect(textContent(container).includes("Settings")).toBeTrue();
  });

  test("renders and executes chat results from chats mode", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const executedItems: CommandPaletteThread[] = [];
    const closeCalls: number[] = [];
    const threads = [
      makePaletteThread({
        threadId: "thr-thread-search",
        id: "thread:thr-thread-search",
        sessionId: null,
        projectId: null,
        projectName: null,
        projectless: true,
        title: "Thread transcript search",
        preview: "Search previous assistant messages from the command palette.",
      }),
    ];
    const { container } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={5}
        mode="chats"
        initialQuery="thread transcript"
        commands={[]}
        cards={[]}
        threads={threads}
        cardSearchIndex={createCommandPaletteCardSearchIndex([])}
        threadSearchIndex={createCommandPaletteThreadSearchIndex(threads)}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => {
          closeCalls.push(1);
        }}
        onExecute={(item: CommandPaletteCard | CommandPaletteCommand | CommandPaletteThread) => {
          if (item.kind === "thread") executedItems.push(item);
        }}
      />,
    );

    await settleAsyncRender();

    const topResult = container.querySelector('button[cmdk-item][data-selected="true"]');
    expect(textContent(container).includes("Chats")).toBeTrue();
    expect(textContent(container).includes("Thread transcript search")).toBeTrue();
    expect(topResult).not.toBeNull();
    fireEvent.click(topResult as HTMLElement);

    expect(closeCalls.length).toBe(1);
    expect(executedItems.length).toBe(1);
    expect(executedItems[0]?.threadId).toBe("thr-thread-search");
  });

  test("cards mode does not render chat results", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const cards = [
      makePaletteCard({
        card: makeCard({
          id: "card-thread-search",
          title: "Thread transcript card",
          descriptionPreview: "Card notes about thread transcript search.",
        }),
      }),
    ];
    const threads = [
      makePaletteThread({
        threadId: "thr-thread-search",
        id: "thread:thr-thread-search",
        title: "Thread transcript session",
        preview: "Search previous assistant messages from the command palette.",
      }),
    ];
    const { container } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={6}
        mode="cards"
        initialQuery="thread transcript"
        commands={[]}
        cards={cards}
        threads={threads}
        cardSearchIndex={createCommandPaletteCardSearchIndex(cards)}
        threadSearchIndex={createCommandPaletteThreadSearchIndex(threads)}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => undefined}
        onExecute={() => undefined}
      />,
    );

    await settleAsyncRender();

    const resultButtons = Array.from(container.querySelectorAll('button[cmdk-item]'));
    expect(resultButtons.length).toBe(1);
    expect(textContent(container).includes("Thread transcript session")).toBeFalse();
    expect(textContent(container).includes("Thread transcript card")).toBeTrue();
  });

  test("renders backend-provided chat content snippet segments", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const threads = [
      makePaletteThread({
        threadId: "thr-content-hit",
        id: "thread:thr-content-hit",
        title: "Content hit",
        preview: "",
      }),
    ];
    mockInvokeImplementation = async (channel: unknown) => {
      if (channel === "codex:threads:palette:search-content") {
        return [{
          threadId: "thr-content-hit",
          snippet: "backend snippet",
          score: 10,
          matchKind: "fts",
          snippetSegments: [
            { text: "backend ", highlight: false },
            { text: "snippet", highlight: true },
          ],
        }];
      }
      return [];
    };

    const { container } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={7}
        mode="chats"
        initialQuery="snippet"
        commands={[]}
        cards={[]}
        threads={threads}
        cardSearchIndex={createCommandPaletteCardSearchIndex([])}
        threadSearchIndex={createCommandPaletteThreadSearchIndex(threads)}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => undefined}
        onExecute={() => undefined}
      />,
    );

    await settleAsyncRender();

    expect(textContent(container).includes("backend snippet")).toBeTrue();
    mockInvokeImplementation = async () => [];
  });

  test("reruns chat content search when the thread index updates", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const threads = [
      makePaletteThread({
        threadId: "thr-refresh-hit",
        id: "thread:thr-refresh-hit",
        title: "Refresh hit",
        preview: "",
      }),
    ];
    const searchedQueries: string[] = [];
    threadIndexUpdateCallbacks = [];
    mockInvokeImplementation = async (channel: unknown, input: unknown) => {
      if (channel === "codex:threads:palette:search-content") {
        const query = typeof input === "object" && input !== null && "query" in input
          ? String((input as { query?: unknown }).query ?? "")
          : "";
        searchedQueries.push(query);
        return [{
          threadId: "thr-refresh-hit",
          snippet: `snippet ${searchedQueries.length}`,
          score: 10,
          matchKind: "fts",
        }];
      }
      return [];
    };

    render(
      <CommandPaletteSurface
        open
        openTriggerTick={8}
        mode="chats"
        initialQuery="refresh"
        commands={[]}
        cards={[]}
        threads={threads}
        cardSearchIndex={createCommandPaletteCardSearchIndex([])}
        threadSearchIndex={createCommandPaletteThreadSearchIndex(threads)}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => undefined}
        onExecute={() => undefined}
      />,
    );

    await settleAsyncRender();
    await act(async () => {
      for (const callback of threadIndexUpdateCallbacks) callback();
      await new Promise((resolve) => setTimeout(resolve, 280));
    });
    await settleAsyncRender();

    expect(searchedQueries.join(",")).toBe("refresh,refresh");
    mockInvokeImplementation = async () => [];
    threadIndexUpdateCallbacks = [];
  });

  test("skips disabled commands and updates aria-activedescendant during keyboard navigation", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const executedItems: CommandPaletteCommand[] = [];
    const { container, getByLabelText } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={4}
        mode="root"
        initialQuery=""
        commands={[
          makePaletteCommand({
            id: "disabled-command",
            title: "Disabled command",
            subtitle: "Cannot run",
            keywords: ["disabled"],
            disabled: true,
            priority: 300,
          }),
          makePaletteCommand({
            id: "forward-command",
            title: "Forward command",
            subtitle: "Can run",
            keywords: ["forward"],
            priority: 200,
          }),
          makePaletteCommand({
            id: "settings",
            title: "Settings",
            subtitle: "Can run",
            keywords: ["settings"],
            priority: 100,
          }),
        ]}
        cards={[]}
        cardSearchIndex={createCommandPaletteCardSearchIndex([])}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => undefined}
        onExecute={(item: CommandPaletteCard | CommandPaletteCommand | CommandPaletteThread) => {
          if (item.kind === "command") executedItems.push(item);
        }}
      />,
    );

    await settleAsyncRender();

    const input = getByLabelText("Command palette search") as HTMLInputElement;
    const firstActiveId = input.getAttribute("aria-activedescendant");
    const firstActive = firstActiveId ? container.querySelector(`[id="${firstActiveId}"]`) : null;

    expect(firstActiveId !== null).toBeTrue();
    expect(firstActive?.textContent?.includes("Forward command")).toBeTrue();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await settleAsyncRender();

    const nextActiveId = input.getAttribute("aria-activedescendant");
    const nextActive = nextActiveId ? container.querySelector(`[id="${nextActiveId}"]`) : null;

    expect(nextActiveId !== firstActiveId).toBeTrue();
    expect(nextActive?.textContent?.includes("Settings")).toBeTrue();
    expect(textContent(container).includes("Mock")).toBeFalse();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(executedItems.length).toBe(1);
    expect(executedItems[0]?.id).toBe("settings");
  });

  test("marks mock commands with a visible badge and keeps them inert", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const executedItems: CommandPaletteCommand[] = [];
    const closeCalls: number[] = [];
    const { container } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={5}
        mode="root"
        initialQuery=""
        commands={[
          makePaletteCommand({
            id: "searchFiles",
            group: "Suggested",
            title: "Search files",
            subtitle: "Search workspace files",
            keywords: ["files"],
            disabled: true,
            mockReason: "Mock UI only. Not available in Nodex yet.",
            priority: 300,
          }),
          makePaletteCommand({
            id: "settings",
            title: "Settings",
            subtitle: "Can run",
            keywords: ["settings"],
            priority: 100,
          }),
        ]}
        cards={[]}
        cardSearchIndex={createCommandPaletteCardSearchIndex([])}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => {
          closeCalls.push(1);
        }}
        onExecute={(item: CommandPaletteCard | CommandPaletteCommand | CommandPaletteThread) => {
          if (item.kind === "command") executedItems.push(item);
        }}
      />,
    );

    await settleAsyncRender();

    const mockButton = Array.from(container.querySelectorAll('button[cmdk-item]'))
      .find((button) => button.textContent?.includes("Search files"));

    expect(textContent(container).includes("Mock")).toBeTrue();
    expect(mockButton !== undefined).toBeTrue();
    expect(mockButton?.getAttribute("aria-disabled")).toBe("true");
    if (mockButton) {
      fireEvent.click(mockButton);
    }
    expect(closeCalls.length).toBe(0);
    expect(executedItems.length).toBe(0);
  });

  test("renders the filter button on the search-input row", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const cards = [
      makePaletteCard({
        projectId: "ops",
        projectName: "Ops",
        card: makeCard({
          id: "ops-card",
          title: "Queue cleanup",
          descriptionPreview: "Executor queue polish.",
          assignee: "Alex",
        }),
      }),
      makePaletteCard({
        projectId: "design",
        projectName: "Design",
        card: makeCard({
          id: "design-card",
          title: "Queue cleanup",
          descriptionPreview: "Executor queue polish.",
          assignee: "Alex",
        }),
      }),
    ];

    const { container, getByLabelText } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={3}
        mode="cards"
        initialQuery="queue"
        commands={[]}
        cards={cards}
        cardSearchIndex={createCommandPaletteCardSearchIndex(cards)}
        loading={false}
        cardsLoading={false}
        chatsLoading={false}
        onChangeMode={() => undefined}
        onRequestClose={() => undefined}
        onExecute={() => undefined}
      />,
    );

    await settleAsyncRender();

    const filterButton = getByLabelText("Filter cards");
    expect(filterButton.getAttribute("aria-label")).toBe("Filter cards");
    expect(textContent(container).includes("Queue cleanup")).toBeTrue();
  });

  test("renders summary chips for active palette filters", async () => {
    const { CommandPaletteCardFiltersSummaryRow } = await import("./command-palette-filters");
    const filters = {
      ...getDefaultCommandPaletteCardFilters(),
      projectIds: ["ops"],
      assignees: ["Alex"],
    };

    const { container } = render(
      <CommandPaletteCardFiltersSummaryRow
        filters={filters}
        projectNameById={new Map([["ops", "Ops"]])}
        onOpenFilter={() => undefined}
      />,
    );

    expect(textContent(container).includes("Project:")).toBeTrue();
    expect(textContent(container).includes("Ops")).toBeTrue();
    expect(textContent(container).includes("Assignee:")).toBeTrue();
    expect(textContent(container).includes("Alex")).toBeTrue();
  });
});

describe("buildCommandPaletteCommands navigation", () => {
  test("builds Codex navigation commands with exact ids, labels, shortcuts, and disabled states", async () => {
    const commands = buildCommandPaletteCommands(makeCommandContext({
      canGoBack: false,
      canGoForward: true,
      isMac: true,
    }));

    const backCommand = commands.find((command) => command.id === "navigateBack");
    const forwardCommand = commands.find((command) => command.id === "navigateForward");

    expect(backCommand?.id).toBe("navigateBack");
    expect(backCommand?.title).toBe("Back");
    expect(backCommand?.shortcut).toBe("⌘[");
    expect(backCommand?.disabled).toBeTrue();
    expect(forwardCommand?.id).toBe("navigateForward");
    expect(forwardCommand?.title).toBe("Forward");
    expect(forwardCommand?.shortcut).toBe("⌘]");
    expect(forwardCommand?.disabled).toBeFalse();
  });

  test("builds non-mac navigation shortcut labels", async () => {
    const commands = buildCommandPaletteCommands(makeCommandContext({
      canGoBack: true,
      canGoForward: true,
      isMac: false,
    }));

    expect(commands.find((command) => command.id === "navigateBack")?.shortcut).toBe("Ctrl+[");
    expect(commands.find((command) => command.id === "navigateForward")?.shortcut).toBe("Ctrl+]");
  });

  test("builds the Codex renameThread command with shortcut and disabled state", async () => {
    const enabledCommands = buildCommandPaletteCommands(makeCommandContext({
      canGoBack: true,
      canGoForward: true,
      isMac: true,
    }));
    const disabledCommands = buildCommandPaletteCommands(makeCommandContext({
      canGoBack: true,
      canGoForward: true,
      hasActiveSession: false,
      isMac: false,
    }));
    const enabled = enabledCommands.find((command) => command.id === RENAME_THREAD_COMMAND_ID);
    const disabled = disabledCommands.find((command) => command.id === RENAME_THREAD_COMMAND_ID);

    expect(enabled?.title).toBe("Rename chat");
    expect(enabled?.shortcut).toBe("⌘⌥R");
    expect(enabled?.disabled).toBeFalse();
    expect(disabled?.shortcut).toBe("Ctrl+Alt+R");
    expect(disabled?.disabled).toBeTrue();
  });
});
