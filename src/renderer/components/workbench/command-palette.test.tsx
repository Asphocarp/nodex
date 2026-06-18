import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import type { CommandPaletteCard, CommandPaletteCommand } from "@/lib/command-palette";
import { getDefaultCommandPaletteCardFilters } from "@/lib/command-palette";
import type { Card } from "@/lib/types";
import { createCommandPaletteCardSearchIndex } from "../../lib/command-palette-card-search";
import { render, settleAsyncRender, textContent } from "../../test/dom";
import { TOGGLE_SIDEBAR_COMMAND_ID } from "../../../shared/window-navigation";

mock.module("./card-icon", () => ({
  CardIcon: ({ className }: { className?: string }) => createElement("span", { className }, "C"),
}));

mock.module("./threads-icon", () => ({
  ThreadsIcon: ({ className }: { className?: string }) => createElement("span", { className }, "T"),
}));

mock.module("./toggle-list-icon", () => ({
  ToggleListIcon: ({ className }: { className?: string }) => createElement("span", { className }, "L"),
}));

describe("buildCommands", () => {
  test("includes the Codex toggleSidebar command with Cmd+B shortcut", async () => {
    const { buildCommands } = await import("./command-palette");
    const commands = buildCommands({
      activeProjectName: "Alpha",
      activeView: "kanban",
      focusedStage: "db",
      canGoBack: false,
      canGoForward: false,
      canOpenNewWindow: false,
      isMac: true,
    });
    const sidebarCommand = commands.find((command) => command.id === TOGGLE_SIDEBAR_COMMAND_ID);

    expect(sidebarCommand?.title).toBe("Toggle sidebar");
    expect(sidebarCommand?.shortcut).toBe("⌘B");
  });
});

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: overrides.id ?? "card-1",
    title: overrides.title ?? "Misc task",
    description: overrides.description ?? "Rebuild the fuzzy search indxer for the palette.",
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
          description: "Rebuild the fuzzy search indxer for the palette.",
        }),
      }),
    ];
    const { container } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={1}
        initialQuery="search indexer"
        commands={[]}
        cards={cards}
        cardSearchIndex={createCommandPaletteCardSearchIndex(cards)}
        loading={false}
        onRequestClose={() => {
          closeCalls.push(1);
        }}
        onExecute={(item: CommandPaletteCard | CommandPaletteCommand) => {
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

  test("seeds command mode when an initial > query is provided", async () => {
    const { CommandPaletteSurface } = await import("./command-palette-surface");
    const { container, getByLabelText } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={2}
        initialQuery=">"
        commands={[
          {
            kind: "command",
            id: "open-settings",
            title: "Open settings",
            subtitle: "App preferences",
            keywords: ["settings", "preferences"],
            priority: 100,
          },
        ]}
        cards={[
          makePaletteCard({
            card: makeCard({
              id: "card-2",
              title: "Misc task",
              description: "Should not appear while command mode is active.",
            }),
          }),
        ]}
        cardSearchIndex={createCommandPaletteCardSearchIndex([])}
        loading={false}
        onRequestClose={() => undefined}
        onExecute={() => undefined}
      />,
    );

    await settleAsyncRender();

    const input = getByLabelText("Command palette search") as HTMLInputElement;
    const resultButtons = Array.from(container.querySelectorAll('button[cmdk-item]'));
    expect(input.value).toBe(">");
    expect(container.querySelectorAll("kbd").length).toBe(0);
    expect(resultButtons.length).toBe(1);
    expect(textContent(container).includes("Misc task")).toBeFalse();
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
          description: "Executor queue polish.",
          assignee: "Alex",
        }),
      }),
      makePaletteCard({
        projectId: "design",
        projectName: "Design",
        card: makeCard({
          id: "design-card",
          title: "Queue cleanup",
          description: "Executor queue polish.",
          assignee: "Alex",
        }),
      }),
    ];

    const { container, getByLabelText } = render(
      <CommandPaletteSurface
        open
        openTriggerTick={3}
        initialQuery="queue"
        commands={[]}
        cards={cards}
        cardSearchIndex={createCommandPaletteCardSearchIndex(cards)}
        loading={false}
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

describe("buildCommands", () => {
  test("builds Codex navigation commands with exact ids, labels, shortcuts, and disabled states", async () => {
    const { buildCommands } = await import("./command-palette");
    const commands = buildCommands({
      activeProjectName: "Alpha",
      activeView: "kanban",
      focusedStage: "db",
      canGoBack: false,
      canGoForward: true,
      canOpenNewWindow: false,
      isMac: true,
    });

    const backCommand = commands[0];
    const forwardCommand = commands[1];

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
    const { buildCommands } = await import("./command-palette");
    const commands = buildCommands({
      activeProjectName: "Alpha",
      activeView: "kanban",
      focusedStage: "db",
      canGoBack: true,
      canGoForward: true,
      canOpenNewWindow: false,
      isMac: false,
    });

    expect(commands[0]?.shortcut).toBe("Ctrl+[");
    expect(commands[1]?.shortcut).toBe("Ctrl+]");
  });
});
