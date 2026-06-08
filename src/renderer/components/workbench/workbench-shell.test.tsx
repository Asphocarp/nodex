import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import { act, fireEvent, within } from "@testing-library/react";
import type { Project, ProjectSession, ProjectSessionTab } from "@/lib/types";
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
const CODEX_BOTTOM_PANEL_HIDDEN_ICON_PREFIX = "M13.334 12.2529";
const CODEX_EXPAND_PANEL_ICON_PREFIX = "M4.33496 11";
const CODEX_RESTORE_PANEL_ICON_PREFIX = "M16.0299 3.0293";
const CODEX_NEW_CHAT_ICON_PREFIX = "M2.6687 11.333";
const CODEX_TOP_NEW_CHAT_CLASS = "focus-visible:outline-token-border relative h-token-nav-row px-row-x py-row-y cursor-interaction shrink-0 items-center overflow-hidden rounded-lg text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 gap-2 flex w-full hover:bg-token-list-hover-background group";
const CODEX_PROJECT_NEW_CHAT_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full electron:rounded-md text-token-muted-foreground enabled:hover:bg-transparent data-[state=open]:bg-transparent hover:text-token-foreground border-transparent electron:p-1 electron:[&>svg]:icon-sm flex items-center justify-center p-0.5 h-6 w-6 rounded-md !p-1";
const CODEX_COLLAPSED_CHROME_BUTTON_CLASS = "border-token-border no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square justify-center !px-0 text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent";

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
    return createElement("div", { "data-terminal-panel": "true" }, `Terminal:${String(props.terminalId)}`);
  },
}));

mock.module("@/features/local-conversation", () => ({
  ThreadSummaryPanelToggle: (props: { label?: string; pressed: boolean; onClick: () => void }) => (
    createElement(
      "button",
      {
        type: "button",
        "aria-label": props.label ?? "Toggle pinned summary",
        "aria-pressed": props.pressed,
        onClick: props.onClick,
      },
      "Summary",
    )
  ),
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
    const summaryPanelMode = String(props.summaryPanelMode ?? "hidden");
    const summaryAction = summaryPanelMode === "pinned"
      ? createElement(
          "button",
          {
            type: "button",
            "aria-label": "Toggle pinned summary",
            "aria-pressed": props.summaryPanelPinnedOpen === true,
            "data-testid": "mock-thread-header-summary-action",
            onClick: props.onSummaryPanelPinnedOpenToggle as (() => void) | undefined,
          },
          "Summary",
        )
      : summaryPanelMode === "popover"
        ? createElement(
            "button",
            {
              type: "button",
              "aria-label": "Toggle summary",
              "aria-pressed": "false",
              "data-testid": "mock-thread-header-summary-action",
            },
            "Summary",
          )
        : null;
    return createElement(
      "div",
      { "data-thread-stage": "true" },
      summaryAction,
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
      createElement("span", {
        "data-summary-panel-mounted": String(props.summaryPanelMounted),
        "data-summary-panel-open": String(props.summaryPanelOpen),
      }, String(props.summaryPanelMounted)),
    );
  },
  ConnectedReviewDiffPanel: (props: Record<string, unknown>) => {
    (globalThis as { __lastConnectedReviewDiffPanelProps?: Record<string, unknown> }).__lastConnectedReviewDiffPanelProps = props;
    return createElement("div", { "data-review-diff-panel": "true" }, `Review:${String(props.threadId)}`);
  },
  useCodexAppServerControl: () => mockCodexControl,
  useCodexThreadStartProgress: () => null,
  useLocalConversationAccount: () => null,
  useLocalConversationConnection: () => ({ status: "connected", retries: 0 }),
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
    board: {
      columns: [
        {
          id: "in_progress",
          name: "In Progress",
          cards: [
            {
              id: "card-1",
              projectId: "alpha",
              status: "in_progress",
              title: "Card One",
              description: "",
              tags: [],
              archived: false,
            },
          ],
        },
      ],
    },
    cardIndex: new Map([
      [
        "card-1",
        {
          id: "card-1",
          projectId: "alpha",
          status: "in_progress",
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

function makeProject(id = "alpha", name = "Alpha", workspacePath?: string): Project {
  return {
    id,
    name,
    description: "",
    icon: "",
    workspacePath,
    created: new Date("2026-06-07T00:00:00.000Z"),
  };
}

function makePanelLayout(tabIds: string[], activeTabId: string | null) {
  return {
    version: 1,
    root: {
      type: "leaf",
      id: "main",
      tabIds,
      activeTabId,
    },
  } as const;
}

function makePanels(options: {
  rightTabIds?: string[];
  rightActiveTabId?: string | null;
  rightCollapsed?: boolean;
  rightFullWidth?: boolean;
  bottomTabIds?: string[];
  bottomActiveTabId?: string | null;
  bottomCollapsed?: boolean;
} = {}): ProjectSession["panels"] {
  const rightTabIds = options.rightTabIds ?? [];
  const bottomTabIds = options.bottomTabIds ?? [];
  return {
    right: {
      collapsed: options.rightCollapsed ?? false,
      layout: makePanelLayout(rightTabIds, options.rightActiveTabId ?? rightTabIds[0] ?? null),
      size: { widthPx: 600, fullWidth: options.rightFullWidth ?? false },
    },
    bottom: {
      collapsed: options.bottomCollapsed ?? true,
      layout: makePanelLayout(bottomTabIds, options.bottomActiveTabId ?? bottomTabIds[0] ?? null),
      size: { heightPx: 280 },
    },
  };
}

type SessionTabFixture = Partial<ProjectSessionTab> & Pick<ProjectSessionTab, "id" | "kind" | "title" | "config">;
type SessionFixtureOverrides = Omit<Partial<ProjectSession>, "tabs"> & {
  tabs?: SessionTabFixture[];
  rightCollapsed?: boolean;
  rightLayout?: ProjectSession["panels"]["right"]["layout"];
};

function makeSessionTab(overrides: SessionTabFixture): ProjectSessionTab {
  return {
    sessionId: "overview:alpha",
    projectId: "alpha",
    panelId: "right",
    order: 0,
    stateKey: 0,
    state: {},
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}

function makeSession(overrides: SessionFixtureOverrides = {}): ProjectSession {
  const {
    rightCollapsed,
    rightLayout,
    tabs: rawTabs,
    ...sessionOverrides
  } = overrides;
  const projectId = overrides.projectId ?? "alpha";
  const sessionId = overrides.id ?? "overview:alpha";
  const isOverview = overrides.isOverview ?? true;
  const tabId = `${sessionId}:db`;
  const tabs = (rawTabs ?? [
    makeSessionTab({
      id: tabId,
      sessionId,
      projectId,
      kind: "db_view",
      title: "DB View",
      config: { projectId, view: "kanban" },
    }),
  ]).map((tab, index) => makeSessionTab({
    sessionId,
    projectId,
    panelId: tab.panelId ?? (tab.kind === "terminal" ? "bottom" : "right"),
    order: index,
    ...tab,
  }));
  const rightTabIds = tabs.filter((tab) => tab.panelId === "right").map((tab) => tab.id);
  const bottomTabIds = tabs.filter((tab) => tab.panelId === "bottom").map((tab) => tab.id);
  const panels = overrides.panels ?? makePanels({
    rightTabIds,
    rightActiveTabId: rightLayout?.root.type === "leaf"
      ? rightLayout.root.activeTabId
      : rightTabIds[0] ?? null,
    rightCollapsed: rightCollapsed ?? false,
    rightFullWidth: isOverview,
    bottomTabIds,
    bottomActiveTabId: bottomTabIds[0] ?? null,
    bottomCollapsed: bottomTabIds.length === 0,
  });
  return {
    id: sessionId,
    projectId,
    title: "Overview",
    isOverview,
    order: 0,
    leftPaneCollapsed: true,
    panels,
    thread: null,
    tabs,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...sessionOverrides,
  };
}

function makeAttachedSession(overrides: SessionFixtureOverrides = {}): ProjectSession {
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

function makeBlankSession(overrides: SessionFixtureOverrides = {}): ProjectSession {
  return makeSession({
    id: "session:alpha:blank",
    title: "New thread",
    isOverview: false,
    panels: makePanels({ rightCollapsed: true }),
    thread: null,
    tabs: [],
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
    if (channel === "project-session-panels:update") {
      const sessionId = String(args[0]);
      const panelId = args[1] === "bottom" ? "bottom" : "right";
      const input = (args[2] ?? {}) as Partial<ProjectSession["panels"]["right"]>;
      const session = Object.values(sessionState).flat().find((item) => item.id === sessionId);
      if (!session) return null;
      const updated = {
        ...session,
        panels: {
          ...session.panels,
          [panelId]: {
            ...session.panels[panelId],
            ...input,
            size: {
              ...session.panels[panelId].size,
              ...(input.size ?? {}),
            },
          },
        },
      };
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
        panels: makePanels({ rightCollapsed: true }),
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
        panelId?: ProjectSessionTab["panelId"];
        kind: ProjectSession["tabs"][number]["kind"];
        title: string;
        config: ProjectSession["tabs"][number]["config"];
      };
      const session = Object.values(sessionState).flat().find((item) => item.id === input.sessionId);
      if (!session) return null;
      if (["db_view", "review", "browser_placeholder"].includes(input.kind)) {
        const existing = session.tabs.find((tab) => tab.kind === input.kind);
        if (existing) {
          const panel = session.panels[existing.panelId];
          sessionState = replaceSession(sessionState, {
            ...session,
            panels: {
              ...session.panels,
              [existing.panelId]: {
                ...panel,
                collapsed: false,
                layout: makePanelLayout(
                  session.tabs.filter((tab) => tab.panelId === existing.panelId).map((tab) => tab.id),
                  existing.id,
                ),
              },
            },
          });
          return existing;
        }
      }
      const panelId = input.panelId ?? "right";
      const tab = {
        id: `created-tab-${session.tabs.length + 1}`,
        sessionId: input.sessionId,
        projectId: input.projectId,
        panelId,
        kind: input.kind,
        title: input.title,
        order: session.tabs.filter((item) => item.panelId === panelId).length,
        config: input.config,
        stateKey: 0,
        state: {},
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      } as ProjectSession["tabs"][number];
      const tabs = [...session.tabs, tab];
      const panelTabs = tabs.filter((item) => item.panelId === panelId);
      sessionState = replaceSession(sessionState, {
        ...session,
        tabs,
        panels: {
          ...session.panels,
          [panelId]: {
            ...session.panels[panelId],
            collapsed: false,
            layout: makePanelLayout(panelTabs.map((item) => item.id), tab.id),
          },
        },
      });
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
      const input = (args[0] ?? {}) as { sessionId: string; panelId: ProjectSessionTab["panelId"]; orderedTabIds: string[] };
      const session = Object.values(sessionState).flat().find((item) => item.id === input.sessionId);
      if (!session) return null;
      const panelTabs = session.tabs.filter((tab) => tab.panelId === input.panelId);
      const knownIds = new Set(panelTabs.map((tab) => tab.id));
      const selected = input.orderedTabIds.filter((tabId) => knownIds.has(tabId));
      const remaining = panelTabs.map((tab) => tab.id).filter((tabId) => !selected.includes(tabId));
      const finalOrder = [...selected, ...remaining];
      const updatedTabs = session.tabs.map((tab) =>
        tab.panelId === input.panelId ? { ...tab, order: finalOrder.indexOf(tab.id) } : tab
      );
      const root = session.panels[input.panelId].layout.root;
      const updated = {
        ...session,
        tabs: updatedTabs,
        panels: {
          ...session.panels,
          [input.panelId]: {
            ...session.panels[input.panelId],
            layout: makePanelLayout(finalOrder, root.type === "leaf" ? root.activeTabId : finalOrder[0] ?? null),
          },
        },
      };
      sessionState = replaceSession(sessionState, updated);
      return updated;
    }
    if (channel === "project-session-tabs:move") {
      const input = (args[0] ?? {}) as { tabId: string; targetPanelId: ProjectSessionTab["panelId"] };
      const session = Object.values(sessionState).flat().find((item) => item.tabs.some((tab) => tab.id === input.tabId));
      if (!session) return null;
      const updatedTabs = session.tabs.map((tab) =>
        tab.id === input.tabId ? { ...tab, panelId: input.targetPanelId, order: 0 } : tab
      );
      const rightIds = updatedTabs.filter((tab) => tab.panelId === "right").map((tab) => tab.id);
      const bottomIds = updatedTabs.filter((tab) => tab.panelId === "bottom").map((tab) => tab.id);
      const updated = {
        ...session,
        tabs: updatedTabs,
        panels: {
          right: { ...session.panels.right, layout: makePanelLayout(rightIds, rightIds[0] ?? null) },
          bottom: { ...session.panels.bottom, collapsed: false, layout: makePanelLayout(bottomIds, bottomIds[0] ?? null) },
        },
      };
      sessionState = replaceSession(sessionState, updated);
      return updated;
    }
    if (channel === "worktrees:environments:list") {
      return [];
    }
    if (channel === "pty:pick-cwd") {
      return "/repo/selected";
    }
    if (channel === "shell:open-file-link") {
      return true;
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
      sidebar={sidebar}
      cardStageCloseRef={createRef()}
      setDbProject={(projectId) => {
        setDbProjectCalls.push(projectId);
      }}
      setSearchQuery={() => undefined}
      setDbViewPrefs={() => undefined}
      openCardStage={() => undefined}
      onLeaveCardStageCard={() => undefined}
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
  localStorage.clear();
  delete (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
  delete (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
  delete (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps;
});

async function openBottomPanel(screen: ReturnType<typeof renderWorkbench>): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Toggle bottom panel" }));
    await Promise.resolve();
  });
  await settleAsyncRender();
}

async function openPanelMenu(
  screen: ReturnType<typeof renderWorkbench>,
  label: "Open side panel tab" | "Open bottom panel tab",
): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByRole("button", { name: label }), { button: 0 });
  await settleAsyncRender();
  return screen.getByRole("menu");
}

function getLastTerminalPanelProps(): Record<string, unknown> {
  const props = (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps;
  if (!props) throw new Error("Expected terminal panel props");
  return props;
}

function getHeaderShellSlot(
  screen: ReturnType<typeof renderWorkbench>,
  side: "left" | "right",
): HTMLElement {
  const slot = screen.container.querySelector(`[data-workbench-header-shell-slot="${side}"]`);
  if (!(slot instanceof HTMLElement)) {
    throw new Error(`Expected ${side} header shell slot`);
  }
  return slot;
}

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

  test("renders Codex sidebar top rows in captured order", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.container.querySelector('[data-testid="project-session-sidebar"]');
    if (!(sidebar instanceof HTMLElement)) {
      throw new Error("Expected project session sidebar");
    }

    const sidebarText = textContent(sidebar);
    expect(sidebarText.indexOf("New chat") < sidebarText.indexOf("Search")).toBeTrue();
    expect(sidebarText.indexOf("Search") < sidebarText.indexOf("Plugins")).toBeTrue();
    expect(sidebarText.indexOf("Plugins") < sidebarText.indexOf("Automations")).toBeTrue();
  });

  test("expanded sidebar keeps the sidebar toggle in the left header rail without compact new-chat", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 312 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const leftSlot = getHeaderShellSlot(screen, "left");
    const labels = Array.from(leftSlot.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label"))
      .join(",");
    const topNewChatButton = screen.getByRole("button", { name: "New chat" });

    expect(labels).toBe("Hide sidebar");
    expect(leftSlot.getAttribute("style")?.includes("width: 312px")).toBeTrue();
    expect(leftSlot.getAttribute("style")?.includes("min-width: 312px")).toBeTrue();
    expect(within(leftSlot).queryByRole("button", { name: "New chat" })).toBe(null);
    expect(topNewChatButton.className).toBe(CODEX_TOP_NEW_CHAT_CLASS);
  });

  test("clicking the Projects section header collapses and expands project rows", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const section = screen.container.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
    if (!(section instanceof HTMLElement)) {
      throw new Error("Expected Projects section");
    }

    const toggle = section.querySelector("[data-app-action-sidebar-section-toggle]");
    if (!(toggle instanceof HTMLElement)) {
      throw new Error("Expected Projects section toggle");
    }

    expect(section.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("false");
    expect(section.querySelectorAll("[data-app-action-sidebar-project-row]").length).toBe(1);

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(section.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");
    expect(section.querySelectorAll("[data-app-action-sidebar-project-row]").length).toBe(0);

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(section.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("false");
    expect(section.querySelectorAll("[data-app-action-sidebar-project-row]").length).toBe(1);
  });

  test("clicking an active project row while focused on its child session keeps the folder collapsed", async () => {
    const activeThread = makeAttachedSession({
      id: "session:alpha:thread",
      title: "Active thread",
      isOverview: false,
      order: 1,
      rightCollapsed: true,
      rightLayout: {
        version: 1,
        root: {
          type: "leaf",
          id: "main",
          tabIds: [],
          activeTabId: null,
        },
      },
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeSession(), activeThread],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByText("Active thread"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const projectRow = screen.container.querySelector('[data-app-action-sidebar-project-id="alpha"]');
    if (!(projectRow instanceof HTMLElement)) {
      throw new Error("Expected active project row");
    }
    const projectSelectionCallCountBeforeProjectClick = screen.setDbProjectCalls.length;

    await act(async () => {
      fireEvent.click(projectRow);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(projectRow.getAttribute("data-app-action-sidebar-project-collapsed")).toBe("true");
    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Active thread"]')).toBe(null);
    expect(screen.setDbProjectCalls.length).toBe(projectSelectionCallCountBeforeProjectClick);
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
    expect(screen.queryByTestId("session-right-panel")).toBe(null);
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

  test("project action menu opens without selecting the project row", async () => {
    const beta = makeProject("beta", "Beta");
    const screen = renderWorkbench({
      projects: [makeProject(), beta],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [
          makeSession({
            id: "overview:beta",
            projectId: "beta",
            title: "Beta Overview",
            isOverview: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText("Project actions for Beta"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });

    expect(screen.setDbProjectCalls.includes("beta")).toBeFalse();
    expect(textContent(document.body).includes("Choose project folder...")).toBeTrue();
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

  test("opens settings as a full-window route shell from the sidebar settings button", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const settingsButton = screen.container.querySelector('button[title="Settings"]');
    if (!(settingsButton instanceof HTMLElement)) {
      throw new Error("Expected a sidebar settings button");
    }
    expect(screen.container.querySelector('[aria-label="Manage workspaces"]')).toBe(null);

    await act(async () => {
      fireEvent.click(settingsButton);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.queryByRole("dialog", { name: "Settings" })).toBe(null);
    const routeShell = screen.container.querySelector('[data-testid="settings-route-shell"]');
    expect(routeShell !== null).toBeTrue();
    expect(routeShell?.className.includes("w-full") ?? false).toBeTrue();
    expect(routeShell?.className.includes("flex-1") ?? false).toBeTrue();
    expect(screen.container.querySelector('[data-thread-stage="true"]')).toBe(null);

    const settingsSidebar = screen.container.querySelector(".window-fx-sidebar-surface");
    expect(settingsSidebar?.className.includes("w-token-sidebar") ?? false).toBeTrue();
    expect(screen.container.querySelector('[data-testid="settings-route-shell"] .main-surface') !== null).toBeTrue();

    await act(async () => {
      fireEvent.click(screen.getByText("Back to app"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="settings-route-shell"]')).toBe(null);
    expect(screen.container.querySelector('[data-thread-stage="true"]') !== null).toBeTrue();
  });

  test("restores the DB toolbar controls inside session DB tabs", async () => {
    const prefs = getDefaultDbViewPrefs("list");
    const listTab = makeSessionTab({
      id: "overview:alpha:list",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "db_view",
      title: "Table",
      order: 0,
      config: { projectId: "alpha", view: "list" },
    });
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            tabs: [listTab],
            rightLayout: {
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

  test("renders an attached non-overview session thread as the main session page", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:thread", title: "Thread", isOverview: false })],
      },
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
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:thread", title: "Thread", isOverview: false })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const threadFrame = screen.container.querySelector(".app-shell-main-content-frame");
    if (!globalHeader || !threadFrame) throw new Error("Expected workbench global header and thread frame");
    expect(textContent(globalHeader).includes("Overview")).toBeFalse();
    expect(textContent(globalHeader).includes("Alpha")).toBeFalse();
    expect(threadFrame.className.includes("mt-(--app-shell-main-content-frame-top-offset)")).toBeTrue();
    expect(threadFrame.className.includes("border-t")).toBeTrue();
    expect(threadFrame.className.includes("border-token-border-default")).toBeTrue();
    expect(threadFrame.getAttribute("style")?.includes("--app-shell-main-content-frame-top-offset: 0px")).toBeTrue();
    const topFade = screen.container.querySelector(".app-shell-main-content-top-fade");
    expect(topFade?.getAttribute("data-app-shell-main-content-top-fade")).toBe("full-bleed");
    expect(topFade?.className.includes("h-4")).toBeTrue();
    expect(topFade?.className.includes("bg-gradient-to-b")).toBeTrue();
  });

  test("shows the thread-page separator only while the right panel is enabled", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            isOverview: false,
            rightCollapsed: false,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const visibleProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const visibleFrame = screen.container.querySelector(".app-shell-main-content-frame");
    expect(visibleProps?.showHeaderSeparator).toBeTrue();
    expect(visibleFrame?.className.includes("border-t")).toBeTrue();
    expect(visibleFrame?.getAttribute("style")?.includes("--app-shell-main-content-frame-top-offset: 0px")).toBeTrue();
    expect(visibleFrame?.getAttribute("style")?.includes("--thread-stage-header-right-reserve: 0px")).toBeTrue();
    screen.unmount();

    const collapsedScreen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread-collapsed",
            title: "Thread",
            isOverview: false,
            rightCollapsed: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const collapsedProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const collapsedFrame = collapsedScreen.container.querySelector(".app-shell-main-content-frame");
    expect(collapsedProps?.showHeaderSeparator).toBeFalse();
    expect(collapsedFrame?.getAttribute("style")?.includes("--app-shell-main-content-frame-top-offset: 0px")).toBeTrue();
    expect(collapsedFrame?.getAttribute("style")?.includes("--thread-stage-header-right-reserve: 70px")).toBeTrue();
  });

  test("renders the session new-thread composer instead of the old attach placeholder", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeBlankSession()] },
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
    expect(JSON.stringify(props?.newThreadTarget).includes('"sessionId":"session:alpha:blank"')).toBeTrue();
  });

  test("session composer submit starts a session-owned thread and refreshes sessions", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeBlankSession()] },
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
      sessionId: "session:alpha:blank",
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
        alpha: [makeBlankSession()],
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
      sessionsByProject: { alpha: [makeBlankSession()] },
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
      sessionId: "session:alpha:blank",
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
      sessionsByProject: { alpha: [makeSession({ rightCollapsed: true })] },
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
      call[0] === "project-session-panels:update"
      && call[1] === "overview:alpha"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
    )).toBeTrue();
    expect(screen.queryAllByRole("tablist").length > 0).toBeTrue();
  });

  test("collapsed bottom panel opens from the global bottom-panel toggle", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const bottomPanelToggle = screen.getByRole("button", { name: "Toggle bottom panel" });
    const sidePanelToggle = screen.getByRole("button", { name: "Toggle side panel" });
    const toggleIconPath = bottomPanelToggle.querySelector("path")?.getAttribute("d") ?? "";
    expect(globalHeader?.contains(bottomPanelToggle)).toBeTrue();
    expect((bottomPanelToggle.compareDocumentPosition(sidePanelToggle) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBeTrue();
    expect(bottomPanelToggle.getAttribute("aria-pressed")).toBe("false");
    expect(bottomPanelToggle.className.includes("no-drag")).toBeTrue();
    expect(bottomPanelToggle.className.includes("rounded-lg")).toBeTrue();
    expect(bottomPanelToggle.className.includes("h-token-button-composer")).toBeTrue();
    expect(bottomPanelToggle.className.includes("text-token-text-tertiary")).toBeTrue();
    expect(toggleIconPath.startsWith(CODEX_BOTTOM_PANEL_HIDDEN_ICON_PREFIX)).toBeTrue();
    expect(screen.queryByTestId("session-bottom-panel")).toBe(null);

    await act(async () => {
      fireEvent.click(bottomPanelToggle);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "overview:alpha"
      && call[2] === "bottom"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
    )).toBeTrue();
    expect(screen.queryByTestId("session-bottom-panel") !== null).toBeTrue();
  });

  test("thread summary toggle defaults to pinned open and persists collapsed state", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            isOverview: false,
            rightCollapsed: true,
            tabs: [],
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const summaryToggle = screen.getByRole("button", { name: "Toggle pinned summary" });
    let stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(summaryToggle.getAttribute("aria-pressed")).toBe("true");
    expect(stageProps?.summaryPanelMode).toBe("pinned");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(true);

    await act(async () => {
      fireEvent.click(summaryToggle);
      await Promise.resolve();
    });
    await settleAsyncRender();

    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(summaryToggle.getAttribute("aria-pressed")).toBe("false");
    expect(stageProps?.summaryPanelMode).toBe("pinned");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("false");
  });

  test("thread summary toggle stays visible while the right panel is open and keeps the pinned overlay hidden", async () => {
    localStorage.setItem("nodex:thread-summary-panel:pinned-open", "true");
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            isOverview: false,
            rightCollapsed: false,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    let stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const rightOpenSummaryToggle = screen.getByRole("button", { name: "Toggle summary" });
    const globalHeader = screen.getByTestId("workbench-global-header");
    expect(rightOpenSummaryToggle.getAttribute("aria-pressed")).toBe("false");
    expect(within(globalHeader).queryByRole("button", { name: "Toggle summary" })).toBe(null);
    expect(stageProps?.summaryPanelMode).toBe("popover");
    expect(stageProps?.summaryPanelMounted).toBe(false);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("true");

    await act(async () => {
      fireEvent.click(rightOpenSummaryToggle);
      await Promise.resolve();
    });
    await settleAsyncRender();

    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(screen.getByRole("button", { name: "Toggle summary" }).getAttribute("aria-pressed")).toBe("false");
    expect(stageProps?.summaryPanelMode).toBe("popover");
    expect(stageProps?.summaryPanelMounted).toBe(false);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const summaryToggle = screen.getByRole("button", { name: "Toggle pinned summary" });
    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(summaryToggle.getAttribute("aria-pressed")).toBe("true");
    expect(stageProps?.summaryPanelMode).toBe("pinned");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(true);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("true");
  });

  test("overview sessions default to open full-width right panels", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const rightPanel = screen.getByTestId("session-right-panel");
    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    const restoreButton = screen.getByRole("button", { name: "Restore panel width" });
    expect(rightPanel.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(rightPanel.getAttribute("data-app-shell-focus-area")).toBe("right-panel");
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("true");
    expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
  });

  test("open non-overview right panel keeps side toggle global and expands from the panel header", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            id: "session:alpha:build",
            title: "Build",
            isOverview: false,
            rightCollapsed: false,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const rightPanel = screen.container.querySelector('[data-testid="session-right-panel"]');
    const tabHeader = rightPanel?.querySelector('[role="tablist"]')?.parentElement?.parentElement;
    const headerShellSlot = getHeaderShellSlot(screen, "right");
    if (!tabHeader) throw new Error("Expected right-panel tab header");

    const sidePanelToggle = screen.getByRole("button", { name: "Toggle side panel" });
    const expandButton = screen.getByRole("button", { name: "Expand panel" });
    const expandIconPath = expandButton.querySelector("path")?.getAttribute("d") ?? "";
    const visibleGlobalHeaderButtons = Array.from(headerShellSlot?.querySelectorAll("button") ?? []);
    expect(globalHeader?.contains(sidePanelToggle)).toBeTrue();
    expect(headerShellSlot?.contains(sidePanelToggle)).toBeTrue();
    expect(visibleGlobalHeaderButtons.map((button) => button.getAttribute("aria-label")).join(",")).toBe("Toggle bottom panel,Toggle side panel");
    expect(headerShellSlot?.className.includes("pe-2")).toBeTrue();
    expect(headerShellSlot?.getAttribute("style")?.includes("width: 600px")).toBeTrue();
    expect(headerShellSlot?.getAttribute("style")?.includes("min-width: 70px")).toBeTrue();
    expect(sidePanelToggle.getAttribute("aria-pressed")).toBe("true");
    expect(sidePanelToggle.className.includes("bg-token-foreground/5")).toBeTrue();
    expect(globalHeader?.contains(expandButton)).toBeFalse();
    expect(tabHeader.contains(expandButton)).toBeTrue();
    expect(expandButton.className.includes("no-drag")).toBeTrue();
    expect(expandButton.className.includes("rounded-lg")).toBeTrue();
    expect(expandButton.className.includes("h-token-button-composer")).toBeTrue();
    expect(expandButton.className.includes("text-token-text-tertiary")).toBeTrue();
    expect(expandIconPath.startsWith(CODEX_EXPAND_PANEL_ICON_PREFIX)).toBeTrue();
    expect(screen.container.querySelector('[data-testid="right-panel-tab-bar-header-spacer"]')?.getAttribute("style")?.includes("width: 62px")).toBeTrue();

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
    expect(headerShellSlot?.getAttribute("style")?.includes("width: 0px")).toBeTrue();
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).toBe(null);
    const fullWidthTabHeader = rightPanel?.querySelector('[role="tablist"]')?.parentElement?.parentElement;
    expect(fullWidthTabHeader?.firstElementChild?.querySelector('[role="tablist"]') !== null).toBeTrue();
    const restoreButton = screen.getByRole("button", { name: "Restore panel width" });
    expect(globalHeader?.contains(restoreButton)).toBeFalse();
    expect(tabHeader.contains(restoreButton)).toBeTrue();
    expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
    expect(restoreButton.className.includes("bg-token-foreground/5")).toBeTrue();
    expect(restoreButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_RESTORE_PANEL_ICON_PREFIX)).toBeTrue();
  });

  test("overview regular-width override survives hiding and showing the side panel", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore panel width" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const regularRightPanel = screen.getByTestId("session-right-panel");
    const regularThreadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    const expandButton = screen.getByRole("button", { name: "Expand panel" });
    expect(regularRightPanel.getAttribute("data-right-panel-width-mode")).toBe("regular");
    expect(regularThreadPage?.getAttribute("data-session-thread-page-hidden")).toBe("false");
    expect(regularThreadPage?.className.split(/\s+/).includes("w-0")).toBeFalse();
    expect(expandButton.getAttribute("aria-pressed")).toBe("false");

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
    const restoredExpandButton = screen.getByRole("button", { name: "Expand panel" });
    expect(restoredRightPanel.getAttribute("data-right-panel-width-mode")).toBe("regular");
    expect(restoredThreadPage?.getAttribute("data-session-thread-page-hidden")).toBe("false");
    expect(restoredThreadPage?.className.split(/\s+/).includes("w-0")).toBeFalse();
    expect(restoredExpandButton.getAttribute("aria-pressed")).toBe("false");
  });

  test("previewable right-panel add actions pin only after panel interaction", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const addTabButton = screen.getByRole("button", { name: "Open side panel tab" });
    expect(globalHeader?.contains(addTabButton)).toBeFalse();
    expect(screen.queryByRole("button", { name: "Add DB view" })).toBe(null);

    fireEvent.pointerDown(addTabButton, { button: 0 });
    await settleAsyncRender();
    fireEvent.click(screen.getByText("Files"));
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "Files" }) !== null).toBeTrue();
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBeTrue();
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeFalse();

    fireEvent.pointerDown(screen.getByText("Browse project files"));
    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"files_placeholder"')
    )).toBeTrue();
  });

  test("opening another preview tab replaces the prior same-panel preview", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open side panel tab" }), { button: 0 });
    await settleAsyncRender();
    fireEvent.click(screen.getByText("Files"));
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "Files" }) !== null).toBeTrue();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open side panel tab" }), { button: 0 });
    await settleAsyncRender();
    fireEvent.click(screen.getByText("Browser"));
    await settleAsyncRender();

    expect(screen.queryByRole("tab", { name: "Files" })).toBe(null);
    expect(screen.getByRole("tab", { name: "Browser" }) !== null).toBeTrue();
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeFalse();
  });

  test("empty right panel renders Codex-style new-tab actions", async () => {
    const emptySession = makeSession({
      id: "session:alpha:empty",
      isOverview: false,
      tabs: [],
      rightLayout: {
        version: 1,
        root: {
          type: "leaf",
          id: "main",
          tabIds: [],
          activeTabId: null,
        },
      },
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [emptySession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actionGrid = screen.container.querySelector('[data-thread-side-panel-new-tab-action-grid="true"]');
    expect(actionGrid !== null).toBeTrue();
    if (!actionGrid) throw new Error("Expected right-panel action grid");
    expect(screen.getByRole("button", { name: /Files/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Side chat/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Browser/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Review/ }) !== null).toBeTrue();
    expect(screen.queryByRole("button", { name: /Terminal/ })).toBe(null);
    expect(screen.getByRole("button", { name: /DB View/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Card Stage/ }) !== null).toBeTrue();
    expect(textContent(actionGrid).includes("⌃⇧G")).toBeTrue();
    expect(textContent(actionGrid).includes("⌃`")).toBeFalse();
  });

  test("bottom panel add menu shows Codex-eligible non-default actions", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    expect(within(menu).getByText("Files") !== null).toBeTrue();
    expect(within(menu).getByText("Side chat") !== null).toBeTrue();
    expect(within(menu).getByText("Browser") !== null).toBeTrue();
    expect(within(menu).getByText("Review") !== null).toBeTrue();
    expect(within(menu).getByText("Terminal") !== null).toBeTrue();
    expect(within(menu).queryByText("DB View")).toBe(null);
    expect(within(menu).queryByText("Card Stage")).toBe(null);
    expect(textContent(menu).includes("⌃`")).toBeTrue();
  });

  for (const previewCase of [
    { label: "Files", kind: "files_placeholder", description: "Browse project files" },
    { label: "Side chat", kind: "side_chat_placeholder", description: "Start a side conversation" },
    { label: "Browser", kind: "browser_placeholder", description: "Open a website" },
  ] as const) {
    test(`bottom ${previewCase.label} preview mounts and pins after interaction`, async () => {
      const screen = renderWorkbench();
      await settleAsyncRender();
      await settleAsyncRender();
      await openBottomPanel(screen);

      const menu = await openPanelMenu(screen, "Open bottom panel tab");
      fireEvent.click(within(menu).getByText(previewCase.label));
      await settleAsyncRender();

      expect(screen.getByRole("tab", { name: previewCase.label }) !== null).toBeTrue();
      expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBeTrue();
      expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeFalse();

      fireEvent.pointerDown(screen.getByText(previewCase.description));
      await settleAsyncRender();
      await settleAsyncRender();

      expect(invokeCalls.some((call) =>
        call[0] === "project-session-tabs:create"
        && JSON.stringify(call[1]).includes('"panelId":"bottom"')
        && JSON.stringify(call[1]).includes(`"kind":"${previewCase.kind}"`)
      )).toBeTrue();
    });
  }

  test("plus menu hides singleton actions that already exist", async () => {
    const browserTab = makeSessionTab({
      id: "overview:alpha:browser",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "browser_placeholder",
      title: "Browser",
      order: 1,
      config: {},
    });
    const reviewTab = makeSessionTab({
      id: "overview:alpha:review",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: {
        version: 1,
        root: {
          type: "leaf",
          id: "main",
          tabIds: ["overview:alpha:db", browserTab.id, reviewTab.id],
          activeTabId: "overview:alpha:db",
        },
      },
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open side panel tab" }), { button: 0 });
    await settleAsyncRender();

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByText("DB View")).toBe(null);
    expect(within(menu).queryByText("Browser")).toBe(null);
    expect(within(menu).queryByText("Review")).toBe(null);
    expect(within(menu).getByText("Files") !== null).toBeTrue();
    expect(within(menu).queryByText("Terminal")).toBe(null);
  });

  test("bottom plus menu hides singleton Browser and Review tabs from either panel", async () => {
    const browserTab = makeSessionTab({
      id: "overview:alpha:browser",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "browser_placeholder",
      title: "Browser",
      order: 1,
      config: {},
    });
    const reviewTab = makeSessionTab({
      id: "overview:alpha:review",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: {
        version: 1,
        root: {
          type: "leaf",
          id: "main",
          tabIds: ["overview:alpha:db", browserTab.id, reviewTab.id],
          activeTabId: "overview:alpha:db",
        },
      },
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    expect(within(menu).queryByText("Browser")).toBe(null);
    expect(within(menu).queryByText("Review")).toBe(null);
    expect(within(menu).getByText("Files") !== null).toBeTrue();
    expect(within(menu).getByText("Side chat") !== null).toBeTrue();
    expect(within(menu).getByText("Terminal") !== null).toBeTrue();
  });

  test("review action creates and renders the connected review panel", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open side panel tab" }), { button: 0 });
    await settleAsyncRender();
    fireEvent.click(screen.getByText("Review"));
    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"review"')
    )).toBeTrue();
    expect(screen.container.querySelector("[data-review-diff-panel]") !== null).toBeTrue();
  });

  test("bottom review action creates and renders the connected review panel", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    fireEvent.click(within(menu).getByText("Review"));
    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"panelId":"bottom"')
      && JSON.stringify(call[1]).includes('"kind":"review"')
    )).toBeTrue();
    expect(screen.container.querySelector("[data-review-diff-panel]") !== null).toBeTrue();
  });

  test("card stage chooser opens a real card tab without prompting", async () => {
    const emptySession = makeSession({
      id: "session:alpha:empty",
      isOverview: false,
      tabs: [],
      rightLayout: {
        version: 1,
        root: {
          type: "leaf",
          id: "main",
          tabIds: [],
          activeTabId: null,
        },
      },
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [emptySession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    fireEvent.pointerDown(screen.getByRole("button", { name: /Card Stage/ }), { button: 0 });
    await settleAsyncRender();
    fireEvent.click(screen.getByText("Card One"));
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"card_stage"')
      && JSON.stringify(call[1]).includes('"cardId":"card-1"')
    )).toBeTrue();
  });

  test("right-panel shortcuts create tabs and ignore editable targets", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.keyDown(document, { key: "G", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"review"')
    )).toBeTrue();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(document, { key: "`", code: "Backquote", ctrlKey: true });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"panelId":"bottom"')
      && JSON.stringify(call[1]).includes('"kind":"terminal"')
    )).toBeTrue();

    invokeCalls = [];
    const input = document.createElement("input");
    document.body.appendChild(input);
    await act(async () => {
      fireEvent.keyDown(input, { key: "`", code: "Backquote", ctrlKey: true });
      await Promise.resolve();
    });
    input.remove();
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeFalse();
  });

  test("terminal tab default cwd prefers the attached thread cwd", async () => {
    const terminalSession = makeAttachedSession({
      id: "session:alpha:terminal-thread",
      title: "Terminal thread",
      isOverview: false,
      tabs: [
        {
          id: "terminal-tab",
          kind: "terminal",
          title: "Terminal",
          panelId: "bottom",
          config: { projectId: "alpha", terminalSessionId: "terminal-thread" },
        },
      ],
    });

    renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/Users/asc/repo/project-workspace")],
      sessionsByProject: { alpha: [terminalSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(getLastTerminalPanelProps().cwd).toBe("/Users/asc/repo/nodex");
  });

  test("terminal tab default cwd falls back to the owning project workspace path", async () => {
    const terminalSession = makeSession({
      id: "session:alpha:terminal-project",
      title: "Project terminal",
      isOverview: false,
      tabs: [
        {
          id: "terminal-tab",
          kind: "terminal",
          title: "Terminal",
          panelId: "bottom",
          config: { projectId: "alpha", terminalSessionId: "terminal-project" },
        },
      ],
    });

    renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/Users/asc/repo/project-workspace")],
      sessionsByProject: { alpha: [terminalSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(getLastTerminalPanelProps().cwd).toBe("/Users/asc/repo/project-workspace");
  });

  test("terminal tab default cwd stays unset without thread or project cwd", async () => {
    const terminalSession = makeSession({
      id: "session:alpha:terminal-pty-default",
      title: "Default terminal",
      isOverview: false,
      tabs: [
        {
          id: "terminal-tab",
          kind: "terminal",
          title: "Terminal",
          panelId: "bottom",
          config: { projectId: "alpha", terminalSessionId: "terminal-default" },
        },
      ],
    });

    renderWorkbench({
      projects: [makeProject()],
      sessionsByProject: { alpha: [terminalSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(String(getLastTerminalPanelProps().cwd)).toBe("undefined");
  });

  test("panel tab menu creates tabs after opening a collapsed right panel", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightCollapsed: true })] },
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
      fireEvent.click(screen.getByText("DB View"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "overview:alpha"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
    )).toBeTrue();
    expect(screen.queryAllByRole("tablist").length > 0).toBeTrue();
  });

  test("opening a card from the thread page opens a collapsed right panel", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ rightCollapsed: true })] },
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
      call[0] === "project-session-panels:update"
      && call[1] === "overview:alpha"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
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
        panelId: "right",
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
          config: { projectId: "alpha", terminalSessionId: "terminal-1" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        },
      ],
      id: "session-1",
      rightLayout: {
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

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session-1"
      && call[2] === "bottom"
    )).toBeTrue();
  });

  test("renders the project session tree on a native-vibrant sidebar beside the rounded main surface", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 312 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.container.querySelector('[data-testid="project-session-sidebar"]');
    expect(sidebar?.className.includes("app-shell-left-panel")).toBeTrue();
    expect(sidebar?.className.includes("window-fx-sidebar-surface")).toBeFalse();
    expect(sidebar?.className.includes("bg-token-surface-secondary")).toBeFalse();
    const mainSurface = screen.container.querySelector("main");
    expect(mainSurface?.className.includes("main-surface")).toBeTrue();
    expect(mainSurface?.className.includes("overflow-hidden")).toBeTrue();
    const dragStrip = screen.container.querySelector('[data-testid="sidebar-drag-strip"]');
    expect(dragStrip).toBe(null);
    expect(textContent(screen.container).includes("Overview")).toBeTrue();
    const threadRow = screen.container.querySelector("[data-app-action-sidebar-thread-row]");
    expect(threadRow !== null).toBeTrue();
    const threadTitle = threadRow?.querySelector('[data-thread-title="true"]');
    expect(threadTitle?.textContent).toBe("Overview");
    expect(threadTitle?.getAttribute("draggable")).toBe("false");
    const titleTrigger = threadTitle?.closest('[data-thread-title-trigger="true"]');
    expect(String(titleTrigger?.className).includes("self-stretch")).toBeTrue();
    const titleIndent = titleTrigger?.parentElement;
    expect(String(titleIndent?.className).includes("pl-0.5")).toBeTrue();
    expect(String(titleIndent?.className).includes("ml-1.5")).toBeTrue();
    const leadingSlot = titleIndent?.previousElementSibling;
    expect(String(leadingSlot?.className).includes("w-4")).toBeTrue();
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
      rightLayout: {
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

  test("collapsed sidebar renders Codex-parity left titlebar chrome on macOS", async () => {
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
      expect(floatingShell?.className.includes("rounded-r-2xl")).toBeFalse();
      expect(floatingShell?.className.includes("overflow-visible")).toBeTrue();
      expect(floatingShell?.className.includes("bg-(")).toBeFalse();
      expect(floatingShell?.className.includes("bg-token")).toBeFalse();

      const globalHeader = screen.getByTestId("workbench-global-header");
      const leftSlot = getHeaderShellSlot(screen, "left");
      const collapseButton = within(leftSlot).getByRole("button", { name: "Show sidebar" });
      const compactNewChatButton = within(leftSlot).getByRole("button", { name: "New chat" });
      const visibleLeftLabels = Array.from(leftSlot.querySelectorAll("button"))
        .map((button) => button.getAttribute("aria-label"))
        .join(",");

      expect(globalHeader.contains(leftSlot)).toBeTrue();
      expect(globalHeader.contains(collapseButton)).toBeTrue();
      expect(visibleLeftLabels).toBe("Show sidebar,New chat");
      expect(leftSlot.className.includes("ps-[max(var(--spacing-token-safe-header-left),0.5rem)]")).toBeTrue();
      expect(leftSlot.getAttribute("style")?.includes("width: 152px")).toBeTrue();
      expect(leftSlot.getAttribute("style")?.includes("min-width: 152px")).toBeTrue();
      expect(collapseButton.parentElement?.className.includes("fixed")).toBeFalse();
      expect(collapseButton.getAttribute("title")).toBe("Toggle sidebar");
      expect(collapseButton.className).toBe(CODEX_COLLAPSED_CHROME_BUTTON_CLASS);
      expect(compactNewChatButton.className).toBe(CODEX_COLLAPSED_CHROME_BUTTON_CLASS);
      expect(collapseButton.className.includes("h-token-button-composer")).toBeTrue();
      expect(compactNewChatButton.className.includes("h-token-button-composer")).toBeTrue();
      expect(collapseButton.className.includes("text-token-text-tertiary")).toBeTrue();
      expect(compactNewChatButton.className.includes("text-token-text-tertiary")).toBeTrue();
      expect(collapseButton.className.includes("enabled:hover:bg-token-list-hover-background")).toBeTrue();
      expect(compactNewChatButton.className.includes("enabled:hover:bg-token-list-hover-background")).toBeTrue();
      expect(collapseButton.className.includes("enabled:hover:bg-transparent")).toBeFalse();
      expect(compactNewChatButton.className.includes("enabled:hover:bg-transparent")).toBeFalse();
      expect(compactNewChatButton.querySelector("svg")?.getAttribute("class")?.includes("icon-sm")).toBeTrue();
      expect(compactNewChatButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_NEW_CHAT_ICON_PREFIX)).toBeTrue();
      expect(collapseButton.className.includes("no-drag")).toBeTrue();

      await act(async () => {
        fireEvent.click(compactNewChatButton);
        await Promise.resolve();
      });
      await settleAsyncRender();

      expect(invokeCalls.some((call) =>
        call[0] === "project-sessions:create"
        && JSON.stringify(call[1]) === JSON.stringify({ projectId: "alpha", title: "New thread" })
      )).toBeTrue();
      expect(screen.getByRole("button", { name: "Show sidebar" }) !== null).toBeTrue();
    } finally {
      Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform });
    }
  });
});
