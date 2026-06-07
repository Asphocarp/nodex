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
let startThreadForSessionCalls: unknown[] = [];
const CODEX_PANEL_VISIBLE_ICON_PREFIX = "M16.835 8.66301";
const CODEX_EXPAND_PANEL_ICON_PREFIX = "M4.33496 11";
const CODEX_RESTORE_PANEL_ICON_PREFIX = "M16.0299 3.0293";
const CODEX_NEW_CHAT_ICON_PREFIX = "M2.6687 11.333";
const CODEX_TOP_NEW_CHAT_CLASS = "focus-visible:outline-token-border relative h-token-nav-row px-row-x py-row-y cursor-interaction shrink-0 items-center overflow-hidden rounded-lg text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 gap-2 flex w-full hover:bg-token-list-hover-background group";
const CODEX_PROJECT_NEW_CHAT_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-muted-foreground enabled:hover:bg-transparent data-[state=open]:bg-transparent hover:text-token-foreground border-transparent electron:p-1 electron:[&>svg]:icon-sm flex items-center justify-center p-0.5 h-6 w-6 rounded-md !p-1";

const mockCodexControl = {
  availableModels: [
    {
      id: "gpt-5-codex",
      model: "gpt-5-codex",
      displayName: "GPT-5 Codex",
      description: "",
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "medium",
      isDefault: true,
    },
  ],
  threadSettings: { model: "gpt-5-codex", reasoningEffort: "medium" },
  reasoningEffortOptions: [{ reasoningEffort: "medium", description: "Balanced" }],
  permissionMode: "auto",
  loadModels: async () => undefined,
  listCollaborationModes: async () => [{ name: "Plan", mode: "plan", model: null }],
  setThreadModel: () => undefined,
  setThreadReasoningEffort: () => undefined,
  setPermissionMode: async () => undefined,
  startThreadForSession: async (input: unknown) => {
    startThreadForSessionCalls.push(input);
  },
  startTurn: async () => undefined,
  steerTurn: async () => undefined,
  interruptTurn: async () => undefined,
  respondApproval: async () => undefined,
  respondUserInput: async () => undefined,
  respondMcpElicitation: async () => undefined,
  enqueueQueuedFollowUp: async () => undefined,
};

mock.module("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
  subscribeGitBranchChanges: () => () => undefined,
  subscribeAppUpdateStatus: () => () => undefined,
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
    const actions = props.actions as {
      onStartThreadForSession?: (input: {
        projectId: string;
        sessionId: string;
        prompt: string;
        runInTarget?: string;
        runInEnvironmentPath?: string | null;
        worktreeStartMode?: string;
        worktreeBranchPrefix?: string | null;
      }) => Promise<void>;
    } | undefined;
    const target = props.newThreadTarget as {
      projectId?: string;
      sessionId?: string;
      runInTarget?: string;
      runInEnvironmentPath?: string | null;
      worktreeStartMode?: string;
      worktreeBranchPrefix?: string | null;
    } | null | undefined;
    return createElement(
      "div",
      { "data-thread-stage": "true" },
      createElement("span", null, `Thread:${String(props.activeThreadId)}`),
      props.isNewThreadTab
        ? createElement("textarea", { "aria-label": "Prompt", placeholder: "Write the first prompt for this new thread..." })
        : null,
      props.isNewThreadTab
        ? createElement("button", {
            type: "button",
            onClick: () => {
              if (!target?.projectId || !target.sessionId) return;
              void actions?.onStartThreadForSession?.({
                projectId: target.projectId,
                sessionId: target.sessionId,
                prompt: "Start from session",
                runInTarget: target.runInTarget,
                runInEnvironmentPath: target.runInEnvironmentPath,
                worktreeStartMode: target.worktreeStartMode,
                worktreeBranchPrefix: target.worktreeBranchPrefix,
              });
            },
          }, "Send")
        : null,
      createElement("span", null, String(props.selectedModel)),
      createElement("span", null, String(props.selectedReasoningEffort)),
    );
  },
  useCodexAppServerControl: () => mockCodexControl,
  useCodexThreadStartProgress: () => null,
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
    if (channel === "project-sessions:create") {
      const input = (args[0] ?? {}) as { projectId: string; title?: string };
      const session = makeSession({
        id: `session:${input.projectId}:created`,
        projectId: input.projectId,
        title: input.title ?? "New thread",
        isOverview: false,
        order: sessionState[input.projectId]?.length ?? 0,
        thread: null,
        tabs: [],
        rightPaneLayout: {
          version: 1,
          root: {
            type: "leaf",
            id: "main",
            tabIds: [],
            activeTabId: null,
          },
        },
      });
      sessionState = {
        ...sessionState,
        [input.projectId]: [...(sessionState[input.projectId] ?? []), session],
      };
      return session;
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
    if (channel === "worktrees:environments:list") {
      return [];
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
  startThreadForSessionCalls = [];
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

  test("renders the Codex-style top new-chat row", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const newChatButton = screen.getByRole("button", { name: "New chat" });
    const iconPath = newChatButton.querySelector("path")?.getAttribute("d") ?? "";
    expect(newChatButton.className).toBe(CODEX_TOP_NEW_CHAT_CLASS);
    expect(iconPath.startsWith(CODEX_NEW_CHAT_ICON_PREFIX)).toBeTrue();
    expect(textContent(newChatButton).includes("⌘N") || textContent(newChatButton).includes("Ctrl+N")).toBeTrue();
  });

  test("top new-chat row opens a blank session composer", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:create"
      && JSON.stringify(call[1]) === JSON.stringify({ projectId: "alpha", title: "New thread" })
    )).toBeTrue();
    expect(props?.isNewThreadTab).toBeTrue();
    expect(JSON.stringify(props?.newThreadTarget).includes('"sessionId":"session:alpha:created"')).toBeTrue();
    expect(screen.getByLabelText("Prompt").getAttribute("placeholder")).toBe("Write the first prompt for this new thread...");
  });

  test("Cmd+N opens the project-scoped new-chat composer from the workbench shell", async () => {
    renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.keyDown(document, { key: "n", metaKey: true, ctrlKey: true });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:create"
      && JSON.stringify(call[1]) === JSON.stringify({ projectId: "alpha", title: "New thread" })
    )).toBeTrue();
  });

  test("project row new-chat button opens a project composer without prompting or toggling", async () => {
    const promptCalls: string[] = [];
    const originalPrompt = window.prompt;
    window.prompt = ((message?: string) => {
      promptCalls.push(String(message ?? ""));
      return "Should not be used";
    }) as typeof window.prompt;

    try {
      const screen = renderWorkbench({
        projects: [makeProject(), makeProject("beta", "Beta")],
        sessionsByProject: {
          alpha: [makeSession()],
          beta: [
            makeSession({
              id: "overview:beta",
              projectId: "beta",
              title: "Overview",
              isOverview: true,
            }),
          ],
        },
      });
      await settleAsyncRender();
      await settleAsyncRender();

      const betaAction = screen.getByLabelText("Start new chat in Beta");
      const iconPath = betaAction.querySelector("path")?.getAttribute("d") ?? "";
      expect(betaAction.className).toBe(CODEX_PROJECT_NEW_CHAT_CLASS);
      expect(iconPath.startsWith(CODEX_NEW_CHAT_ICON_PREFIX)).toBeTrue();

      await act(async () => {
        fireEvent.click(betaAction);
        await Promise.resolve();
      });
      await settleAsyncRender();

      const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
      expect(promptCalls.length).toBe(0);
      expect(invokeCalls.some((call) =>
        call[0] === "project-sessions:create"
        && JSON.stringify(call[1]) === JSON.stringify({ projectId: "beta", title: "New thread" })
      )).toBeTrue();
      expect(JSON.stringify(props?.newThreadTarget).includes('"projectId":"beta"')).toBeTrue();
      expect(JSON.stringify(props?.newThreadTarget).includes('"sessionId":"session:beta:created"')).toBeTrue();
    } finally {
      window.prompt = originalPrompt;
    }
  });

  test("project row new-chat button reuses an existing blank session", async () => {
    const betaBlank = makeSession({
      id: "session:beta:blank",
      projectId: "beta",
      title: "New thread",
      isOverview: false,
      thread: null,
      tabs: [],
    });
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [
          makeSession({
            id: "overview:beta",
            projectId: "beta",
            title: "Overview",
            isOverview: true,
          }),
          betaBlank,
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Start new chat in Beta"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(invokeCalls.some((call) => call[0] === "project-sessions:create" && JSON.stringify(call[1]).includes('"projectId":"beta"'))).toBeFalse();
    expect(JSON.stringify(props?.newThreadTarget).includes('"sessionId":"session:beta:blank"')).toBeTrue();
  });

  test("opens settings from the sidebar settings button", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const settingsButton = screen.container.querySelector('button[title="Settings"]');
    if (!(settingsButton instanceof HTMLElement)) {
      throw new Error("Expected a sidebar settings button");
    }

    await act(async () => {
      fireEvent.click(settingsButton);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.getByRole("dialog", { name: "Settings" }).getAttribute("aria-modal")).toBe("true");
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
    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(props?.activeThreadSummary).includes('"cardId":null')).toBeTrue();
  });

  test("uses the thread header as the only top title row", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const threadFrame = screen.container.querySelector(".app-shell-main-content-frame");
    if (!globalHeader || !threadFrame) throw new Error("Expected workbench global header and thread frame");
    expect(textContent(globalHeader).includes("Overview")).toBeFalse();
    expect(textContent(globalHeader).includes("Alpha")).toBeFalse();
    expect(Boolean(threadFrame?.getAttribute("style")?.includes("--app-shell-main-content-frame-top-offset"))).toBeFalse();
  });

  test("shows the thread-page separator only while the right panel is enabled", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ rightPaneCollapsed: false })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const visibleProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const visibleFrame = screen.container.querySelector(".app-shell-main-content-frame");
    expect(visibleProps?.showHeaderSeparator).toBeTrue();
    expect(visibleFrame?.className.includes("border-t")).toBeFalse();
    expect(visibleFrame?.getAttribute("style")?.includes("--thread-stage-header-right-reserve: 0px")).toBeTrue();
    screen.unmount();

    const collapsedScreen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ rightPaneCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const collapsedProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const collapsedFrame = collapsedScreen.container.querySelector(".app-shell-main-content-frame");
    expect(collapsedProps?.showHeaderSeparator).toBeFalse();
    expect(collapsedFrame?.getAttribute("style")?.includes("--thread-stage-header-right-reserve: 36px")).toBeTrue();
  });

  test("renders the session new-thread composer instead of the old attach placeholder", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("false");
    expect(screen.getByLabelText("Prompt").getAttribute("placeholder")).toBe("Write the first prompt for this new thread...");
    expect(textContent(screen.container).includes("Attach an existing Codex thread to use this session page.")).toBeFalse();
    expect(props?.isNewThreadTab).toBeTrue();
    expect(props?.activeThreadId === null).toBeTrue();
    expect(JSON.stringify(props?.newThreadTarget).includes('"sessionId":"overview:alpha"')).toBeTrue();
  });

  test("session composer submit starts a session-owned thread and refreshes sessions", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(startThreadForSessionCalls.length).toBe(1);
    expect(JSON.stringify(startThreadForSessionCalls[0])).toBe(JSON.stringify({
      projectId: "alpha",
      sessionId: "overview:alpha",
      prompt: "Start from session",
      runInTarget: "localProject",
      runInEnvironmentPath: null,
      worktreeStartMode: "detachedHead",
      worktreeBranchPrefix: "nodex/",
      collaborationMode: "default",
    }));
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list" && call[1] === "alpha")).toBeTrue();
  });

  test("session composer submit creates an owning session when the new-chat project changes", async () => {
    const betaProject = makeProject("beta", "Beta");
    const screen = renderWorkbench({
      projects: [makeProject(), betaProject],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [
          makeAttachedSession({
            id: "overview:beta",
            projectId: "beta",
            title: "Overview",
            isOverview: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const propsBefore = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const actions = propsBefore?.actions as {
      onNewThreadProjectChange?: (projectId: string) => void;
    } | undefined;
    await act(async () => {
      actions?.onNewThreadProjectChange?.("beta");
      await Promise.resolve();
    });
    await settleAsyncRender();

    const propsAfter = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(propsAfter?.newThreadTarget).includes('"projectId":"beta"')).toBeTrue();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:create"
      && JSON.stringify(call[1]) === JSON.stringify({ projectId: "beta", title: "New thread" })
    )).toBeTrue();
    expect(startThreadForSessionCalls.length).toBe(1);
    expect(JSON.stringify(startThreadForSessionCalls[0])).toBe(JSON.stringify({
      projectId: "beta",
      sessionId: "session:beta:created",
      prompt: "Start from session",
      runInTarget: "localProject",
      runInEnvironmentPath: null,
      worktreeStartMode: "detachedHead",
      worktreeBranchPrefix: "nodex/",
      collaborationMode: "default",
    }));
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list" && call[1] === "beta")).toBeTrue();
  });

  test("session composer submit passes the selected new-worktree target", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const propsBefore = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const actions = propsBefore?.actions as {
      onNewThreadStartInTargetChange?: (target: { runInTarget: "newWorktree" }) => void;
    } | undefined;
    await act(async () => {
      actions?.onNewThreadStartInTargetChange?.({ runInTarget: "newWorktree" });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const propsAfter = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(propsAfter?.newThreadTarget).includes('"runInTarget":"newWorktree"')).toBeTrue();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(startThreadForSessionCalls.length).toBe(1);
    expect(JSON.stringify(startThreadForSessionCalls[0])).toBe(JSON.stringify({
      projectId: "alpha",
      sessionId: "overview:alpha",
      prompt: "Start from session",
      runInTarget: "newWorktree",
      runInEnvironmentPath: null,
      worktreeStartMode: "detachedHead",
      worktreeBranchPrefix: "nodex/",
      collaborationMode: "default",
    }));
  });

  test("collapsed right panel opens from the global side-panel toggle", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightPaneCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.queryAllByRole("tablist").length).toBe(0);
    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const toggleButton = screen.getByRole("button", { name: "Toggle side panel" });
    const toggleIconPath = toggleButton.querySelector("path")?.getAttribute("d") ?? "";
    expect(globalHeader?.contains(toggleButton)).toBeTrue();
    expect(toggleButton.getAttribute("aria-pressed")).toBe("false");
    expect(toggleButton.className.includes("no-drag")).toBeTrue();
    expect(toggleButton.className.includes("rounded-lg")).toBeTrue();
    expect(toggleButton.className.includes("h-token-button-composer")).toBeTrue();
    expect(toggleButton.className.includes("text-token-text-tertiary")).toBeTrue();
    expect(toggleIconPath.startsWith(CODEX_PANEL_VISIBLE_ICON_PREFIX)).toBeTrue();
    expect(screen.queryByRole("button", { name: "Attach thread" })).toBe(null);
    expect(screen.queryByRole("button", { name: "Detach thread" })).toBe(null);

    await act(async () => {
      fireEvent.click(toggleButton);
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

  test("open right panel keeps side toggle global and expands from the panel header", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const rightPanel = screen.container.querySelector('[data-testid="session-right-panel"]');
    const tabHeader = rightPanel?.querySelector('[role="tablist"]')?.parentElement?.parentElement;
    const headerShellSlot = screen.container.querySelector('[data-test-id="header-shell-slot"]');
    if (!tabHeader) throw new Error("Expected right-panel tab header");

    const sidePanelToggle = screen.getByRole("button", { name: "Toggle side panel" });
    const expandButton = screen.getByRole("button", { name: "Expand panel" });
    const expandIconPath = expandButton.querySelector("path")?.getAttribute("d") ?? "";
    expect(globalHeader?.contains(sidePanelToggle)).toBeTrue();
    expect(headerShellSlot?.contains(sidePanelToggle)).toBeTrue();
    expect(headerShellSlot?.className.includes("pe-2")).toBeTrue();
    expect(headerShellSlot?.getAttribute("style")?.includes("min-width: 36px")).toBeTrue();
    expect(sidePanelToggle.getAttribute("aria-pressed")).toBe("true");
    expect(sidePanelToggle.className.includes("bg-token-foreground/5")).toBeTrue();
    expect(globalHeader?.contains(expandButton)).toBeFalse();
    expect(tabHeader.contains(expandButton)).toBeTrue();
    expect(expandButton.className.includes("no-drag")).toBeTrue();
    expect(expandButton.className.includes("rounded-lg")).toBeTrue();
    expect(expandButton.className.includes("h-token-button-composer")).toBeTrue();
    expect(expandButton.className.includes("text-token-text-tertiary")).toBeTrue();
    expect(expandIconPath.startsWith(CODEX_EXPAND_PANEL_ICON_PREFIX)).toBeTrue();
    expect(screen.container.querySelector('[data-testid="right-panel-tab-bar-header-spacer"]')?.getAttribute("style")?.includes("width: 36px")).toBeTrue();

    await act(async () => {
      fireEvent.click(expandButton);
      await Promise.resolve();
    });

    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    expect(rightPanel?.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(rightPanel?.getAttribute("data-app-shell-focus-area")).toBe("right-panel");
    expect(rightPanel?.className.includes("shadow-xl")).toBeFalse();
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("true");
    expect(threadPage?.className.includes("w-0")).toBeTrue();
    expect(threadPage?.className.includes("flex-none")).toBeTrue();
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).toBe(null);
    const restoreButton = screen.getByRole("button", { name: "Restore panel width" });
    expect(globalHeader?.contains(restoreButton)).toBeFalse();
    expect(tabHeader.contains(restoreButton)).toBeTrue();
    expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
    expect(restoreButton.className.includes("bg-token-foreground/5")).toBeTrue();
    expect(restoreButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_RESTORE_PANEL_ICON_PREFIX)).toBeTrue();
  });

  test("full-width right panel state survives hiding and showing the side panel", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Expand panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.getByRole("button", { name: "Restore panel width" }).getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.queryByRole("button", { name: "Restore panel width" })).toBe(null);
    expect(screen.queryByTestId("session-right-panel")).toBe(null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const restoredRightPanel = screen.getByTestId("session-right-panel");
    const restoredThreadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    const restoreButton = screen.getByRole("button", { name: "Restore panel width" });
    expect(restoredRightPanel.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(restoredThreadPage?.getAttribute("data-session-thread-page-hidden")).toBe("true");
    expect(restoredThreadPage?.className.includes("w-0")).toBeTrue();
    expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
  });

  test("right-panel add actions are reachable from the panel header plus menu", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const addTabButton = screen.getByRole("button", { name: "Open side panel tab" });
    expect(globalHeader?.contains(addTabButton)).toBeFalse();
    expect(screen.queryByRole("button", { name: "Add DB view" })).toBe(null);

    fireEvent.pointerDown(addTabButton, { button: 0 });
    await settleAsyncRender();
    fireEvent.click(screen.getByText("DB view"));
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeTrue();
  });

  test("panel tab menu creates tabs after opening a collapsed right panel", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightPaneCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Open side panel tab" }), { button: 0 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByText("DB view"));
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
