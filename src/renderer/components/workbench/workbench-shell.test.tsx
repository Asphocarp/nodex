import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import { act, fireEvent, within } from "@testing-library/react";
import type { Project, ProjectSession, WorkspaceRecord } from "@/lib/types";
import {
  getDefaultDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import { render, settleAsyncRender, textContent } from "../../test/dom";

let invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;

mock.module("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
}));

mock.module("./main-view-host", () => ({
  MainViewHost: (props: Record<string, unknown>) => {
    (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps = props;
    return createElement("div", { "data-main-view-host": "true" }, `DB:${String(props.projectId)}:${String(props.view)}`);
  },
}));

mock.module("./workbench-card-stage", () => ({
  CardStage: (props: Record<string, unknown>) => {
    (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps = props;
    const card = props.card as { id?: string } | null | undefined;
    return createElement("div", { "data-card-stage": "true" }, `Card:${String(card?.id ?? "missing")}`);
  },
}));

mock.module("./workbench-terminal-panel", () => ({
  TerminalPanel: (props: Record<string, unknown>) => {
    (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps = props;
    return createElement("div", { "data-terminal-panel": "true" }, `Terminal:${String(props.sessionId)}`);
  },
}));

mock.module("@/features/local-conversation", () => ({
  ConnectedThreadStage: (props: Record<string, unknown>) => {
    (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps = props;
    return createElement("div", { "data-thread-stage": "true" }, `Thread:${String(props.activeThreadId)}`);
  },
}));

mock.module("@/lib/calendar-view-state", () => ({
  loadCalendarViewState: () => ({
    anchorDate: new Date("2026-06-07T00:00:00.000Z"),
    range: { mode: "week", multiDayCount: 4, multiWeekCount: 2 },
  }),
  normalizeCalendarAnchorDate: (value: Date) => value,
  shiftCalendarAnchorDateByDays: (value: Date, days: number) => {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  },
  resolveCalendarVisibleDays: () => [new Date("2026-06-07T00:00:00.000Z")],
  saveCalendarViewState: () => undefined,
  formatCalendarToolbarMonthYear: () => "June 2026",
}));

mock.module("@/lib/use-kanban", () => ({
  useKanban: () => ({
    board: { columns: [] },
    cardIndex: new Map([
      [
        "card-1",
        {
          id: "card-1",
          projectId: "alpha",
          status: "todo",
          title: "Card One",
          description: "",
          tags: [],
          archived: false,
        },
      ],
    ]),
    refresh: async () => undefined,
    patchCard: () => undefined,
    updateCard: async () => ({ didMutate: true }),
    deleteCard: async () => true,
    moveCard: async () => undefined,
    completeOccurrence: async () => undefined,
    skipOccurrence: async () => undefined,
  }),
}));

let WorkbenchShell: (typeof import("./workbench-shell"))["WorkbenchShell"];
let resolveCardStageSessionTabOrder: (typeof import("./workbench-shell"))["resolveCardStageSessionTabOrder"];

beforeAll(async () => {
  const workbenchShellModule = await import("./workbench-shell");
  WorkbenchShell = workbenchShellModule.WorkbenchShell;
  resolveCardStageSessionTabOrder = workbenchShellModule.resolveCardStageSessionTabOrder;
});

function makeProject(id = "alpha", name = "Alpha"): Project {
  return {
    id,
    name,
    description: "",
    icon: "",
    created: new Date("2026-06-07T00:00:00.000Z"),
  };
}

function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  const projectId = overrides.projectId ?? "alpha";
  const tabId = `${overrides.id ?? "overview:alpha"}:db`;
  return {
    id: "overview:alpha",
    projectId,
    title: "Overview",
    isOverview: true,
    order: 0,
    leftPaneCollapsed: true,
    rightPaneCollapsed: false,
    rightPaneLayout: {
      version: 1,
      root: {
        type: "leaf",
        id: "main",
        tabIds: [tabId],
        activeTabId: tabId,
      },
    },
    thread: null,
    tabs: [
      {
        id: tabId,
        sessionId: "overview:alpha",
        projectId,
        kind: "db_view",
        title: "DB View",
        order: 0,
        config: { projectId, view: "kanban" },
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      },
    ],
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}

function makeAttachedSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return makeSession({
    leftPaneCollapsed: true,
    thread: {
      sessionId: overrides.id ?? "overview:alpha",
      projectId: overrides.projectId ?? "alpha",
      threadId: "thread-alpha",
      parentThreadId: undefined,
      threadName: "Alpha thread",
      threadPreview: "Working on the active session",
      modelProvider: "openai",
      cwd: "/Users/asc/repo/nodex",
      statusType: "notLoaded",
      statusActiveFlags: [],
      archived: false,
      createdAt: 1_780_800_000_000,
      updatedAt: 1_780_800_000_000,
      linkedAt: "2026-06-07T00:00:00.000Z",
    },
    ...overrides,
  });
}

function replaceSession(
  current: Record<string, ProjectSession[]>,
  nextSession: ProjectSession,
): Record<string, ProjectSession[]> {
  return Object.fromEntries(
    Object.entries(current).map(([projectId, sessions]) => [
      projectId,
      sessions.map((session) => (session.id === nextSession.id ? nextSession : session)),
    ]),
  );
}

function renderWorkbench({
  projects = [makeProject()],
  sessionsByProject = { alpha: [makeSession()] },
  searchByProject = {},
  dbViewPrefsByProject = {},
  sidebar,
}: {
  projects?: Project[];
  sessionsByProject?: Record<string, ProjectSession[]>;
  searchByProject?: Record<string, string>;
  dbViewPrefsByProject?: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  sidebar?: { collapsed: boolean; width: number };
} = {}) {
  let sessionState = sessionsByProject;
  const workspace: WorkspaceRecord = {
    id: "main",
    name: "Main",
    icon: "",
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    layout: {} as WorkspaceRecord["layout"],
  };

  mockInvokeImpl = async (channel, ...args) => {
    if (channel === "project-sessions:list") {
      const projectId = String(args[0]);
      return sessionState[projectId] ?? [];
    }
    if (channel === "project-sessions:update") {
      const sessionId = String(args[0]);
      const input = (args[1] ?? {}) as Partial<ProjectSession>;
      const session = Object.values(sessionState).flat().find((item) => item.id === sessionId);
      if (!session) return null;
      const updated = { ...session, ...input };
      sessionState = replaceSession(sessionState, updated);
      return updated;
    }
    if (channel === "project-session-tabs:create") {
      const input = (args[0] ?? {}) as {
        sessionId: string;
        projectId: string;
        kind: ProjectSession["tabs"][number]["kind"];
        title: string;
        config: ProjectSession["tabs"][number]["config"];
      };
      const session = Object.values(sessionState).flat().find((item) => item.id === input.sessionId);
      if (!session) return null;
      const tab = {
        id: `created-tab-${session.tabs.length + 1}`,
        sessionId: input.sessionId,
        projectId: input.projectId,
        kind: input.kind,
        title: input.title,
        order: session.tabs.length,
        config: input.config,
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      } as ProjectSession["tabs"][number];
      sessionState = replaceSession(sessionState, { ...session, tabs: [...session.tabs, tab] });
      return tab;
    }
    if (channel === "project-session-tabs:update") {
      const tabId = String(args[0]);
      const input = (args[1] ?? {}) as Partial<ProjectSession["tabs"][number]>;
      const session = Object.values(sessionState)
        .flat()
        .find((item) => item.tabs.some((tab) => tab.id === tabId));
      if (!session) return null;

      const updatedTabs = session.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, ...input, updatedAt: "2026-06-07T00:00:00.000Z" }
          : tab,
      );
      const updatedSession = { ...session, tabs: updatedTabs };
      sessionState = replaceSession(sessionState, updatedSession);
      return updatedTabs.find((tab) => tab.id === tabId) ?? null;
    }
    if (channel === "project-session-tabs:reorder") {
      const sessionId = String(args[0]);
      return Object.values(sessionState).flat().find((item) => item.id === sessionId) ?? null;
    }
    return null;
  };

  const setDbProjectCalls: string[] = [];
  const result = render(
    <WorkbenchShell
      projects={projects}
      dbProjectId={projects[0]?.id ?? "alpha"}
      activeView="kanban"
      activeSearchQuery=""
      activeDbViewPrefs={null}
      searchByProject={searchByProject}
      dbViewPrefsByProject={dbViewPrefsByProject}
      spaces={projects.map((project) => ({
        projectId: project.id,
        colorToken: "var(--accent-blue)",
        initial: project.name.slice(0, 1).toUpperCase(),
      }))}
      workspaces={[workspace]}
      activeWorkspaceId={workspace.id}
      sidebar={sidebar}
      cardStageCloseRef={createRef()}
      setDbProject={(projectId) => {
        setDbProjectCalls.push(projectId);
      }}
      setSearchQuery={() => undefined}
      setDbViewPrefs={() => undefined}
      openCardStage={() => undefined}
      onLeaveCardStageCard={() => undefined}
      onSelectWorkspace={() => undefined}
      onCreateProject={async () => null}
      onRenameProject={async () => null}
      onDeleteProject={async () => false}
      onRequestProjectPickerOpen={() => undefined}
      threadSearchOpenTick={0}
    />,
  );
  return { ...result, setDbProjectCalls };
}

beforeEach(() => {
  invokeCalls = [];
  mockInvokeImpl = null;
  delete (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
  delete (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
});

describe("workbench session shell", () => {
  test("keeps card-stage session tab ordering scoped to session ids", () => {
    const order = resolveCardStageSessionTabOrder(
      [
        { id: "session:first", sessionId: "first" },
        { id: "history" },
        { id: "session:second", sessionId: "second" },
      ],
      "session:second",
      "session:first",
    );

    expect(JSON.stringify(order)).toBe(JSON.stringify(["second", "first"]));
  });

  test("loads project sessions and renders the overview DB tab", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const text = textContent(screen.container);
    expect(text.includes("Alpha")).toBeTrue();
    expect(text.includes("Overview")).toBeTrue();
    expect(text.includes("DB:alpha:kanban")).toBeTrue();
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list" && call[1] === "alpha")).toBeTrue();
  });

  test("restores the DB toolbar controls inside session DB tabs", async () => {
    const prefs = getDefaultDbViewPrefs("list");
    const listTab = {
      id: "overview:alpha:list",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "db_view",
      title: "Table",
      order: 0,
      config: { projectId: "alpha", view: "list" },
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    } satisfies ProjectSession["tabs"][number];
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            tabs: [listTab],
            rightPaneLayout: {
              version: 1,
              root: {
                type: "leaf",
                id: "main",
                tabIds: [listTab.id],
                activeTabId: listTab.id,
              },
            },
          }),
        ],
      },
      searchByProject: { alpha: "urgent" },
      dbViewPrefsByProject: { alpha: { list: prefs } },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const dbToolbarTabList = screen.getByRole("tablist", { name: "Database views" });
    expect(dbToolbarTabList.getAttribute("aria-label")).toBe("Database views");
    expect(within(dbToolbarTabList).getByRole("tab", { name: "Table" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Filter" }).getAttribute("aria-label")).toBe("Filter");
    expect(screen.getByRole("button", { name: "Sort" }).getAttribute("aria-label")).toBe("Sort");
    expect(screen.getByRole("button", { name: "Display" }).getAttribute("aria-label")).toBe("Display");
    expect(screen.getByDisplayValue("urgent").getAttribute("value")).toBe("urgent");

    const props = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    expect(props?.searchQuery).toBe("urgent");
    expect(props?.dbViewPrefs === prefs).toBeTrue();
    expect(typeof props?.onUpdateDbViewPrefs).toBe("function");
  });

  test("persists DB toolbar view selection through the session tab API", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      const dbToolbarTabList = screen.getByRole("tablist", { name: "Database views" });
      fireEvent.mouseDown(within(dbToolbarTabList).getByRole("tab", { name: "Table" }), { button: 0 });
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:update"
      && call[1] === "overview:alpha:db"
      && JSON.stringify(call[2]) === JSON.stringify({
        config: { projectId: "alpha", view: "list" },
        title: "Table",
      })
    )).toBeTrue();
  });

  test("renders an attached session thread as the main session page", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("false");
    expect(textContent(screen.container).includes("Thread:thread-alpha")).toBeTrue();
    expect(screen.container.querySelector('[data-thread-stage="true"]') !== null).toBeTrue();
  });

  test("collapsed right panel opens from the thread page control", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightPaneCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.queryAllByRole("tablist").length).toBe(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:update"
      && call[1] === "overview:alpha"
      && JSON.stringify(call[2]) === JSON.stringify({ rightPaneCollapsed: false })
    )).toBeTrue();
    expect(screen.queryAllByRole("tablist").length > 0).toBeTrue();
  });

  test("open right panel can expand to full session width", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Expand panel" }));
      await Promise.resolve();
    });

    const rightPanel = screen.container.querySelector('[data-testid="session-right-panel"]');
    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    expect(rightPanel?.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "Restore panel width" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("manual tab creation opens a collapsed right panel", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightPaneCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add DB view" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:update"
      && call[1] === "overview:alpha"
      && JSON.stringify(call[2]) === JSON.stringify({ rightPaneCollapsed: false })
    )).toBeTrue();
    expect(screen.queryAllByRole("tablist").length > 0).toBeTrue();
  });

  test("opening a card from the thread page opens a collapsed right panel", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ rightPaneCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const actions = props?.actions as { onOpenCard?: (cardId: string) => void } | undefined;
    await act(async () => {
      actions?.onOpenCard?.("card-1");
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeTrue();
    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:update"
      && call[1] === "overview:alpha"
      && JSON.stringify(call[2]) === JSON.stringify({ rightPaneCollapsed: false })
    )).toBeTrue();
  });

  test("opens cards from the DB tab as session-attached card-stage tabs", async () => {
    renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    expect(typeof props?.openCardStage).toBe("function");
    await act(async () => {
      await (props?.openCardStage as (projectId: string, cardId: string, title?: string) => Promise<void> | void)(
        "alpha",
        "card-1",
        "Card One",
      );
    });

    const createCall = invokeCalls.find((call) => call[0] === "project-session-tabs:create");
    expect(createCall !== undefined).toBeTrue();
    expect(JSON.stringify(createCall?.[1])).toBe(
      JSON.stringify({
        sessionId: "overview:alpha",
        projectId: "alpha",
        kind: "card_stage",
        title: "Card One",
        config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
      }),
    );
  });

  test("persists active tab changes through the session API", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "db-tab",
          sessionId: "session-1",
          projectId: "alpha",
          kind: "db_view",
          title: "DB View",
          order: 0,
          config: { projectId: "alpha", view: "kanban" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        },
        {
          id: "terminal-tab",
          sessionId: "session-1",
          projectId: "alpha",
          kind: "terminal",
          title: "Terminal",
          order: 1,
          config: { projectId: "alpha", terminalSessionId: "terminal-1", mode: "project" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        },
      ],
      id: "session-1",
      rightPaneLayout: {
        version: 1,
        root: {
          type: "leaf",
          id: "main",
          tabIds: ["db-tab", "terminal-tab"],
          activeTabId: "db-tab",
        },
      },
    });
    const screen = renderWorkbench({ sessionsByProject: { alpha: [session] } });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Terminal" }), { button: 0 });
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) => call[0] === "project-sessions:update" && call[1] === "session-1")).toBeTrue();
  });

  test("renders the project session tree on a native-vibrant sidebar beside the rounded main surface", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 312 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.container.querySelector('[data-testid="project-session-sidebar"]');
    expect(sidebar?.className.includes("window-fx-sidebar-surface")).toBeFalse();
    expect(sidebar?.className.includes("bg-token-surface-secondary")).toBeFalse();
    const mainSurface = screen.container.querySelector("main");
    expect(mainSurface?.className.includes("main-surface")).toBeTrue();
    expect(mainSurface?.className.includes("overflow-hidden")).toBeTrue();
    const dragStrip = screen.container.querySelector('[data-testid="sidebar-drag-strip"]');
    expect(dragStrip?.className.includes("draggable")).toBeTrue();
    expect(textContent(screen.container).includes("Overview")).toBeTrue();
    expect(screen.container.querySelector('[data-session-row="true"]') !== null).toBeTrue();
  });

  test("selecting another project expands it and falls back to its overview session", async () => {
    const beta = makeProject("beta", "Beta");
    const betaSession = makeSession({
      id: "overview:beta",
      projectId: "beta",
      title: "Beta Overview",
      tabs: [
        {
          id: "overview:beta:db",
          sessionId: "overview:beta",
          projectId: "beta",
          kind: "db_view",
          title: "DB View",
          order: 0,
          config: { projectId: "beta", view: "kanban" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        },
      ],
      rightPaneLayout: {
        version: 1,
        root: {
          type: "leaf",
          id: "main",
          tabIds: ["overview:beta:db"],
          activeTabId: "overview:beta:db",
        },
      },
    });
    const screen = renderWorkbench({
      projects: [makeProject(), beta],
      sessionsByProject: { alpha: [makeSession()], beta: [betaSession] },
      sidebar: { collapsed: false, width: 300 },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByText("Beta"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.setDbProjectCalls.includes("beta")).toBeTrue();
    expect(textContent(screen.container).includes("Beta Overview")).toBeTrue();
    expect(textContent(screen.container).includes("DB:beta:kanban")).toBeTrue();
  });

  test("collapsed sidebar keeps the titlebar collapse control out of the traffic light zone on macOS", async () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    try {
      const screen = renderWorkbench({ sidebar: { collapsed: true, width: 300 } });
      await settleAsyncRender();
      await settleAsyncRender();

      const sidebar = screen.container.querySelector('[data-testid="project-session-sidebar"]') as HTMLElement | null;
      expect(sidebar !== null).toBeTrue();
      expect(sidebar?.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
      const floatingShell = screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]');
      expect(floatingShell?.className.includes("rounded-r-2xl")).toBeTrue();
      expect(floatingShell?.className.includes("overflow-hidden")).toBeTrue();
      expect(floatingShell?.className.includes("bg-(")).toBeFalse();
      expect(floatingShell?.className.includes("bg-token")).toBeFalse();
      const collapseButton = screen.getByRole("button", { name: "Expand sidebar" });
      const fixedContainer = collapseButton.parentElement as HTMLElement;
      expect(fixedContainer.style.left).toBe("90px");
      expect(fixedContainer.style.top).toBe("12px");
      expect(collapseButton.className.includes("no-drag")).toBeTrue();
    } finally {
      Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform });
    }
  });
});
