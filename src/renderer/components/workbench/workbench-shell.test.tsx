import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Fragment, createElement, createRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import type { Project, ProjectSession, ProjectSessionPanelNode, ProjectSessionTab } from "@/lib/types";
import {
  CODEX_SIDEBAR_FLOATING_ASIDE_CLASS,
  CODEX_SIDEBAR_FLOATING_HEADER_CLASS,
  CODEX_SIDEBAR_FLOATING_OUTER_CLASS,
} from "@/lib/codex-sidebar-auto-reveal";
import {
  APP_SHELL_GLOBAL_HEADER_LAYER_CLASS,
  APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
} from "@/lib/app-shell-layers";
import {
  getDefaultDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import { render, settleAsyncRender, textContent } from "../../test/dom";
import { useThreadHeaderPortalTarget } from "@/lib/thread-header-portal";
import type {
  WorkbenchNavigationCommandRequest,
  WorkbenchNavigationCommandState,
  WorkbenchNavigationCommandSource,
  WorkbenchNavigationDirection,
} from "../../../shared/window-navigation";
import {
  makeProjectSessionPanelLayout,
  splitProjectSessionPanelLeaf,
} from "../../../shared/project-session-panel-layout";

let invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;
let startThreadForSessionCalls: unknown[] = [];
let requestThreadStreamSnapshotCalls: string[] = [];
let removeQueuedFollowUpCalls: unknown[][] = [];
let reorderQueuedFollowUpsCalls: unknown[][] = [];
let sendQueuedFollowUpNowCalls: unknown[][] = [];
let editLastUserTurnCalls: unknown[][] = [];
let setComposerIntentCalls: unknown[][] = [];
let removePlanImplementationRequestCalls: unknown[][] = [];
let cleanBackgroundTerminalsCalls: string[] = [];
let startSideChatCalls: unknown[] = [];
let discardSideChatCalls: string[] = [];
let sideChatConversations: Record<string, Record<string, unknown>> = {};
const CODEX_PANEL_VISIBLE_ICON_PREFIX = "M16.835 8.66301";
const CODEX_BOTTOM_PANEL_HIDDEN_ICON_PREFIX = "M13.334 12.2529";
const CODEX_EXPAND_PANEL_ICON_PREFIX = "M16.0299 3.0293";
const CODEX_RESTORE_PANEL_ICON_PREFIX = "M4.33496 11";
const CODEX_NEW_CHAT_ICON_PREFIX = "M2.6687 11.333";
const CODEX_TITLEBAR_NEW_CHAT_ICON_PREFIX = "M6.33325 1.88379";
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
  startSideChat: async (input: unknown) => {
    startSideChatCalls.push(input);
    const threadId = `side-thread-${startSideChatCalls.length}`;
    const conversation = {
      threadId,
      projectId: "alpha",
      cardId: null,
      source: {
        parentThreadId: "thread-alpha",
        sideConversation: true,
        sideConversationParentNavigationPath: "project:alpha/session:overview:alpha/thread:thread-alpha",
      },
      threadName: null,
      threadPreview: "",
      modelProvider: "openai",
      cwd: "/Users/asc/repo/nodex",
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      linkedAt: "",
      resumeState: "resumed",
      turns: [],
      requests: [],
      pendingSteers: [],
      queuedFollowUps: [],
      backgroundTerminalRows: [],
      childMemberships: [],
      capabilityFlags: {
        canEditLastUserTurn: false,
        canForkFromTurn: false,
        canSearch: true,
        canCollapseTurns: true,
      },
      ephemeral: true,
    };
    sideChatConversations[threadId] = conversation;
    return {
      parentThreadId: "thread-alpha",
      threadId,
      conversation,
    };
  },
  discardSideChat: async (threadId: string) => {
    discardSideChatCalls.push(threadId);
    delete sideChatConversations[threadId];
    return true;
  },
  startTurn: async () => undefined,
  steerTurn: async () => undefined,
  interruptTurn: async () => undefined,
  respondApproval: async () => undefined,
  respondUserInput: async () => undefined,
  respondMcpElicitation: async () => undefined,
  enqueueQueuedFollowUp: async () => undefined,
  requestThreadStreamSnapshot: async (threadId: string) => {
    requestThreadStreamSnapshotCalls.push(threadId);
    return null;
  },
  removeQueuedFollowUp: async (threadId: string, followUpId: string) => {
    removeQueuedFollowUpCalls.push([threadId, followUpId]);
  },
  reorderQueuedFollowUps: async (threadId: string, orderedFollowUpIds: string[]) => {
    reorderQueuedFollowUpsCalls.push([threadId, orderedFollowUpIds]);
  },
  sendQueuedFollowUpNow: async (threadId: string, followUpId: string) => {
    sendQueuedFollowUpNowCalls.push([threadId, followUpId]);
  },
  editLastUserTurn: async (threadId: string, turnId: string, message: string) => {
    editLastUserTurnCalls.push([threadId, turnId, message]);
    return {
      threadId,
      composerIntent: {
        prompt: message,
        focusNonce: 1,
      },
    };
  },
  forkConversationFromTurn: async (threadId: string, turnId: string, message: string) => ({
    threadId: `${threadId}:forked:${turnId}`,
    composerIntent: {
      prompt: message,
      focusNonce: 1,
    },
  }),
  compactThread: async () => undefined,
  getThreadGoal: async () => null,
  setThreadGoal: async () => null,
  clearThreadGoal: async () => undefined,
  setThreadMemoryMode: async () => undefined,
  uploadFeedback: async () => undefined,
  cleanBackgroundTerminals: async (threadId: string) => {
    cleanBackgroundTerminalsCalls.push(threadId);
    return true;
  },
  setComposerIntent: (threadId: string, composerIntent: unknown) => {
    setComposerIntentCalls.push([threadId, composerIntent]);
  },
  consumeComposerIntent: () => undefined,
  setConversationCollaborationMode: async () => ({
    mode: "default",
    settings: {
      model: null,
      reasoning_effort: null,
      developer_instructions: null,
    },
  }),
  removePlanImplementationRequest: async (threadId: string, turnId: string) => {
    removePlanImplementationRequestCalls.push([threadId, turnId]);
    return true;
  },
};

mock.module("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
  subscribeGitBranchChanges: () => () => undefined,
  subscribeProjectSessionChanges: () => () => undefined,
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
    return createElement(
      "div",
      { "data-card-stage": "true" },
      `Card:${String(card?.id ?? "missing")}`,
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "History",
          onClick: () => {
            const current = (globalThis as { __mockCardStageHistoryClicks?: number }).__mockCardStageHistoryClicks ?? 0;
            (globalThis as { __mockCardStageHistoryClicks?: number }).__mockCardStageHistoryClicks = current + 1;
          },
        },
        "History",
      ),
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "Delete",
          onClick: () => {
            const current = (globalThis as { __mockCardStageDeleteClicks?: number }).__mockCardStageDeleteClicks ?? 0;
            (globalThis as { __mockCardStageDeleteClicks?: number }).__mockCardStageDeleteClicks = current + 1;
            void (props.onDelete as ((nextColumnId: string, cardId: string) => Promise<void>) | undefined)?.(
              "in_progress",
              card?.id ?? "card-1",
            );
          },
        },
        "Delete",
      ),
    );
  },
}));

mock.module("./workbench-terminal-panel", () => ({
  TerminalPanel: (props: Record<string, unknown>) => {
    (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps = props;
    return createElement("div", { "data-terminal-panel": "true" }, `Terminal:${String(props.terminalId)}`);
  },
}));

mock.module("@/features/local-conversation", () => ({
  ThreadSummaryPanelHeaderAction: (props: {
    mode: "hidden" | "pinned" | "popover";
    onPopoverOpenChange?: (open: boolean) => void;
    pinnedOpen: boolean;
    onPinnedOpenToggle?: () => void;
    popoverOpen?: boolean;
  }) => {
    if (props.mode === "hidden") return null;
    return createElement(
      "button",
      {
        type: "button",
        "aria-label": props.mode === "popover" ? "Toggle summary" : "Toggle pinned summary",
        "aria-pressed": props.mode === "pinned" ? props.pinnedOpen : String(Boolean(props.popoverOpen)),
        "data-testid": "mock-summary-action",
        onClick: props.mode === "pinned"
          ? props.onPinnedOpenToggle
          : () => props.onPopoverOpenChange?.(!props.popoverOpen),
      },
      "Summary",
    );
  },
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
    const headerPortalTarget = useThreadHeaderPortalTarget();
    const summary = props.activeThreadSummary as { threadName?: string | null; threadPreview?: string | null } | null | undefined;
    const threadTitle = summary?.threadName ?? summary?.threadPreview ?? (props.isNewThreadTab ? "New thread" : "No thread");
    const headerPortal = headerPortalTarget
      ? createPortal(
          createElement(
            "div",
            {
              className: "draggable grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 electron:h-toolbar extension:py-row-y",
            },
            createElement(
              "div",
              { className: "flex min-w-0 items-center gap-2 truncate text-base electron:font-medium" },
              createElement(
                "div",
                { className: "pointer-events-none w-full min-w-0 flex-1" },
                createElement(
                  "div",
                  { "data-testid": "thread-stage-title", className: "max-w-[320px] min-w-0 truncate text-token-foreground" },
                  threadTitle,
                ),
              ),
            ),
          ),
          headerPortalTarget,
        )
      : null;
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
      Fragment,
      null,
      headerPortal,
      createElement(
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
        createElement("span", {
          "data-summary-panel-hide-immediately": String(props.summaryPanelHideImmediately),
          "data-summary-panel-mounted": String(props.summaryPanelMounted),
          "data-summary-panel-open": String(props.summaryPanelOpen),
        }, String(props.summaryPanelMounted)),
      ),
    );
  },
  ConnectedReviewDiffPanel: (props: Record<string, unknown>) => {
    (globalThis as { __lastConnectedReviewDiffPanelProps?: Record<string, unknown> }).__lastConnectedReviewDiffPanelProps = props;
    return createElement("div", { "data-review-diff-panel": "true" }, `Review:${String(props.threadId)}`);
  },
  useCodexAppServerControl: () => mockCodexControl,
  useConversation: (threadId: string | null) => threadId ? sideChatConversations[threadId] ?? null : null,
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

function makeProject(id = "alpha", name = "Alpha", primarySourceRoot?: string): Project {
  const normalizedPrimarySourceRoot = primarySourceRoot?.trim() || null;
  return {
    id,
    name,
    description: "",
    icon: "",
    sources: normalizedPrimarySourceRoot ? [{ root: normalizedPrimarySourceRoot, order: 0 }] : [],
    primaryWorkspaceRoot: normalizedPrimarySourceRoot,
    pinned: false,
    pinnedOrder: null,
    created: new Date("2026-06-07T00:00:00.000Z"),
    updated: new Date("2026-06-07T00:00:00.000Z"),
  };
}

function makePanelLayout(tabIds: string[], activeTabId: string | null) {
  return makeProjectSessionPanelLayout(tabIds, activeTabId);
}

function firstPanelLeafId(node: ProjectSessionPanelNode): string {
  if (node.type === "leaf") return node.id;
  return firstPanelLeafId(node.first);
}

function updatePanelLeafActiveTab(
  node: ProjectSessionPanelNode,
  leafId: string,
  tabId: string | null | undefined,
): ProjectSessionPanelNode {
  if (node.type === "leaf") {
    if (node.id !== leafId) return node;
    return {
      ...node,
      activeTabId: tabId ?? node.activeTabId,
    };
  }
  return {
    ...node,
    first: updatePanelLeafActiveTab(node.first, leafId, tabId),
    second: updatePanelLeafActiveTab(node.second, leafId, tabId),
  };
}

function activateTestPanelLayout(
  layout: ProjectSession["panels"]["right"]["layout"],
  leafId: string | undefined,
  tabId: string | null | undefined,
): ProjectSession["panels"]["right"]["layout"] {
  const activeLeafId = leafId ?? firstPanelLeafId(layout.root);
  const root = updatePanelLeafActiveTab(layout.root, activeLeafId, tabId);
  return {
    ...layout,
    root,
    activeLeafId,
    mruLeafIds: [activeLeafId, ...layout.mruLeafIds.filter((id) => id !== activeLeafId)],
  };
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
    pinned: sessionOverrides.pinned ?? false,
    pinnedOrder: sessionOverrides.pinnedOrder ?? null,
    archived: sessionOverrides.archived ?? false,
    archivedAt: sessionOverrides.archivedAt ?? null,
    unread: sessionOverrides.unread ?? false,
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

function makeBottomPanelTerminalSession(overrides: SessionFixtureOverrides = {}): ProjectSession {
  return makeSession({
    id: "session:alpha:terminal",
    title: "Terminal",
    isOverview: false,
    rightCollapsed: true,
    tabs: [
      {
        id: "terminal-tab",
        kind: "terminal",
        title: "Terminal",
        panelId: "bottom",
        config: { projectId: "alpha", terminalSessionId: "terminal" },
      },
    ],
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

function sortProjectSessionsForTest(sessions: ProjectSession[]): ProjectSession[] {
  return [...sessions].sort((a, b) => {
    const rank = (session: ProjectSession) => session.isOverview ? 0 : session.pinned ? 1 : 2;
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    if (a.pinned || b.pinned) {
      return (a.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinnedOrder ?? Number.MAX_SAFE_INTEGER);
    }
    return a.order - b.order;
  });
}

function getThreadRow(container: HTMLElement, title: string): HTMLElement {
  const row = container.querySelector(`[data-app-action-sidebar-thread-title="${title}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Expected thread row ${title}`);
  }
  return row;
}

function getThreadRowTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-app-action-sidebar-thread-row]"))
    .map((row) => row.getAttribute("data-app-action-sidebar-thread-title") ?? "");
}

function getBottomPanelContentSizer(container: HTMLElement): HTMLElement {
  const sizer = Array.from(container.querySelectorAll<HTMLElement>('[style*="min-height"]'))
    .find((element) => element.getAttribute("style")?.includes("height:"));
  if (!sizer) throw new Error("Expected bottom panel content sizer");
  return sizer;
}

function renderWorkbench({
  projects = [makeProject()],
  sessionsByProject = { alpha: [makeSession()] },
  searchByProject = {},
  dbViewPrefsByProject = {},
  sidebar,
  navigationCommandRequest = null,
  onNavigationStateChange,
}: {
  projects?: Project[];
  sessionsByProject?: Record<string, ProjectSession[]>;
  searchByProject?: Record<string, string>;
  dbViewPrefsByProject?: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  sidebar?: { collapsed: boolean; width: number };
  navigationCommandRequest?: WorkbenchNavigationCommandRequest | null;
  onNavigationStateChange?: ComponentProps<typeof WorkbenchShell>["onNavigationStateChange"];
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
    if (channel === "project-sessions:set-pinned") {
      const sessionId = String(args[0]);
      const input = (args[1] ?? {}) as { pinned?: boolean };
      const session = Object.values(sessionState).flat().find((item) => item.id === sessionId);
      if (!session) return null;
      const projectSessions = sessionState[session.projectId] ?? [];
      const nextPinned = input.pinned === true;
      const nextPinnedOrder = nextPinned
        ? session.pinnedOrder ?? Math.max(-1, ...projectSessions.map((item) => item.pinnedOrder ?? -1)) + 1
        : null;
      const updated = {
        ...session,
        pinned: nextPinned,
        pinnedOrder: nextPinnedOrder,
      };
      sessionState = {
        ...sessionState,
        [session.projectId]: sortProjectSessionsForTest(
          projectSessions.map((item) => item.id === updated.id ? updated : item),
        ),
      };
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
    if (channel === "project-session-panels:activate") {
      const input = (args[0] ?? {}) as {
        sessionId: string;
        panelId: ProjectSessionTab["panelId"];
        leafId?: string;
        tabId?: string | null;
      };
      const session = Object.values(sessionState).flat().find((item) => item.id === input.sessionId);
      if (!session) return null;
      const panel = session.panels[input.panelId];
      const updated = {
        ...session,
        panels: {
          ...session.panels,
          [input.panelId]: {
            ...panel,
            layout: activateTestPanelLayout(panel.layout, input.leafId, input.tabId),
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
      if (["db_view", "review", "browser"].includes(input.kind)) {
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
  const navigationStateChanges: WorkbenchNavigationCommandState[] = [];
  let requestWorkbenchNavigation: (
    direction: WorkbenchNavigationDirection,
    source?: WorkbenchNavigationCommandSource,
  ) => void = () => undefined;

  function WorkbenchShellTestHarness() {
    const [dbProjectId, setDbProjectId] = useState(projects[0]?.id ?? "alpha");
    const [sidebarState, setSidebarState] = useState(sidebar ?? { collapsed: false, width: 300 });
    const [currentNavigationCommandRequest, setCurrentNavigationCommandRequest] =
      useState<WorkbenchNavigationCommandRequest | null>(navigationCommandRequest);
    requestWorkbenchNavigation = (direction, source = direction === "back" ? "sidebar_back" : "sidebar_forward") => {
      setCurrentNavigationCommandRequest((current) => ({
        tick: (current?.tick ?? 0) + 1,
        direction,
        source,
      }));
    };
    return (
      <WorkbenchShell
        projects={projects}
        dbProjectId={dbProjectId}
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
        sidebar={sidebarState}
        cardStageCloseRef={createRef()}
        setDbProject={(projectId) => {
          setDbProjectCalls.push(projectId);
          setDbProjectId(projectId);
        }}
        setSearchQuery={() => undefined}
        setDbViewPrefs={() => undefined}
        openCardStage={() => undefined}
        onLeaveCardStageCard={() => undefined}
        onCreateProject={async () => null}
        onUpdateProject={async () => null}
        onDeleteProject={async () => false}
        onReorderProjects={async () => projects}
        onSetProjectPinned={async () => null}
        onSetPinnedProjectOrder={async () => projects}
        onRequestProjectPickerOpen={() => undefined}
        threadSearchOpenTick={0}
        setSidebarCollapsed={(collapsed) => {
          setSidebarState((current) => ({ ...current, collapsed }));
        }}
        setSidebarWidth={(width) => {
          setSidebarState((current) => ({ ...current, width }));
        }}
        navigationCommandRequest={currentNavigationCommandRequest}
        onNavigationStateChange={(state) => {
          navigationStateChanges.push(state);
          onNavigationStateChange?.(state);
        }}
      />
    );
  }

  const result = render(
    <WorkbenchShellTestHarness />,
  );
  return {
    ...result,
    setDbProjectCalls,
    navigationStateChanges,
    requestWorkbenchNavigation: (
      direction: WorkbenchNavigationDirection,
      source?: WorkbenchNavigationCommandSource,
    ) => {
      requestWorkbenchNavigation(direction, source);
    },
  };
}

beforeEach(() => {
  invokeCalls = [];
  startThreadForSessionCalls = [];
  requestThreadStreamSnapshotCalls = [];
  removeQueuedFollowUpCalls = [];
  reorderQueuedFollowUpsCalls = [];
  sendQueuedFollowUpNowCalls = [];
  editLastUserTurnCalls = [];
  setComposerIntentCalls = [];
  removePlanImplementationRequestCalls = [];
  cleanBackgroundTerminalsCalls = [];
  startSideChatCalls = [];
  discardSideChatCalls = [];
  sideChatConversations = {};
  mockInvokeImpl = null;
  setWindowInnerWidthForTest(1024);
  localStorage.clear();
  sessionStorage.clear();
  delete (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
  delete (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
  delete (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps;
  delete (globalThis as { __mockCardStageHistoryClicks?: number }).__mockCardStageHistoryClicks;
  delete (globalThis as { __mockCardStageDeleteClicks?: number }).__mockCardStageDeleteClicks;
});

async function openBottomPanel(screen: ReturnType<typeof renderWorkbench>): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Toggle bottom panel" }));
    await Promise.resolve();
  });
  await settleAsyncRender();
}

async function pointerActivate(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(element, { button: 0 });
    fireEvent.click(element);
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

function getMenuItemIconClassName(menu: HTMLElement, label: string): string {
  const item = within(menu).getByText(label).closest('[role="menuitem"]');
  if (!(item instanceof HTMLElement)) {
    throw new Error(`Expected ${label} menu item`);
  }

  const icon = item.querySelector("svg");
  if (!(icon instanceof SVGElement)) {
    throw new Error(`Expected ${label} menu item icon`);
  }

  return icon.getAttribute("class") ?? "";
}

function expectPanelMenuDescriptionsHidden(menu: HTMLElement): void {
  for (const description of [
    "Browse project files",
    "Start a side conversation",
    "Open a website",
    "View code changes",
    "Start an interactive shell",
    "Open the project database",
    "Open a project card",
  ]) {
    expect(textContent(menu).includes(description)).toBeFalse();
  }
}

function getFilesPreviewInteractionTarget(screen: ReturnType<typeof renderWorkbench>): HTMLElement {
  return screen.queryByPlaceholderText("Filter files...")
    ?? screen.getByText("This project does not have a workspace folder.");
}

function getLastTerminalPanelProps(): Record<string, unknown> {
  const props = (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps;
  if (!props) throw new Error("Expected terminal panel props");
  return props;
}

function getLastThreadStageActions(): Record<string, unknown> {
  const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
  const actions = props?.actions;
  if (!actions || typeof actions !== "object") {
    throw new Error("Expected ConnectedThreadStage actions");
  }
  return actions as Record<string, unknown>;
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

function setWindowInnerWidthForTest(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function moveSidebarPointer(clientX: number, clientY = 80): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new MouseEvent("pointermove", {
      clientX,
      clientY,
    }));
    await Promise.resolve();
  });
  await settleAsyncRender();
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

  test("sidebar pin button toggles a session without selecting it", async () => {
    const target = makeAttachedSession({
      id: "session:alpha:pin-target",
      title: "Pin target",
      isOverview: false,
      order: 1,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), target] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const row = getThreadRow(screen.container, "Pin target");
    const pinButton = row.querySelector("[data-app-action-sidebar-thread-pin-session]");
    if (!(pinButton instanceof HTMLButtonElement)) {
      throw new Error("Expected Pin target pin button");
    }
    expect(pinButton.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 20");
    const setDbProjectCallCount = screen.setDbProjectCalls.length;

    await act(async () => {
      fireEvent.click(pinButton);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.setDbProjectCalls.length).toBe(setDbProjectCallCount);
    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:set-pinned"
      && call[1] === "session:alpha:pin-target"
      && (call[2] as { pinned?: boolean } | undefined)?.pinned === true
    )).toBeTrue();
    const updatedRow = getThreadRow(screen.container, "Pin target");
    expect(updatedRow.getAttribute("data-app-action-sidebar-thread-pinned")).toBe("true");
    const updatedButton = updatedRow.querySelector("[data-app-action-sidebar-thread-pin-session]");
    expect(updatedButton?.getAttribute("aria-label")).toBe("Unpin chat");
    expect(updatedButton?.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  test("sidebar pin button promotes pinned sessions above unpinned siblings", async () => {
    const first = makeAttachedSession({
      id: "session:alpha:first",
      title: "First unpinned",
      isOverview: false,
      order: 1,
      rightCollapsed: true,
      tabs: [],
    });
    const second = makeAttachedSession({
      id: "session:alpha:second",
      title: "Second target",
      isOverview: false,
      order: 2,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), first, second] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const pinButton = getThreadRow(screen.container, "Second target")
      .querySelector("[data-app-action-sidebar-thread-pin-session]");
    if (!(pinButton instanceof HTMLButtonElement)) {
      throw new Error("Expected Second target pin button");
    }

    await act(async () => {
      fireEvent.click(pinButton);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(JSON.stringify(getThreadRowTitles(screen.container).slice(0, 3))).toBe(
      JSON.stringify(["Overview", "Second target", "First unpinned"]),
    );
  });

  test("sidebar unpin button clears pinned state after refresh", async () => {
    const pinned = makeAttachedSession({
      id: "session:alpha:pinned",
      title: "Pinned target",
      isOverview: false,
      order: 1,
      pinned: true,
      pinnedOrder: 0,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), pinned] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const unpinButton = getThreadRow(screen.container, "Pinned target")
      .querySelector("[data-app-action-sidebar-thread-pin-session]");
    if (!(unpinButton instanceof HTMLButtonElement)) {
      throw new Error("Expected Pinned target unpin button");
    }
    expect(unpinButton.getAttribute("aria-label")).toBe("Unpin chat");
    expect(unpinButton.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");

    await act(async () => {
      fireEvent.click(unpinButton);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:set-pinned"
      && call[1] === "session:alpha:pinned"
      && (call[2] as { pinned?: boolean } | undefined)?.pinned === false
    )).toBeTrue();
    const row = getThreadRow(screen.container, "Pinned target");
    expect(row.getAttribute("data-app-action-sidebar-thread-pinned")).toBe("false");
    const pinButton = row.querySelector("[data-app-action-sidebar-thread-pin-session]");
    expect(pinButton?.getAttribute("aria-label")).toBe("Pin chat");
    expect(pinButton?.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 20");
  });

  test("sidebar pin slot excludes overview, reserves unread rows, and protects long titles", async () => {
    const unread = makeAttachedSession({
      id: "session:alpha:unread",
      title: "Unread target",
      isOverview: false,
      order: 1,
      unread: true,
      rightCollapsed: true,
      tabs: [],
    });
    const long = makeAttachedSession({
      id: "session:alpha:long",
      title: "Very long session title that should truncate before colliding with row actions",
      isOverview: false,
      order: 2,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), unread, long] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const overviewRow = getThreadRow(screen.container, "Overview");
    expect(overviewRow.querySelector("[data-app-action-sidebar-thread-pin-slot]") === null).toBeTrue();
    expect(overviewRow.querySelector("[data-app-action-sidebar-thread-pin-session]") === null).toBeTrue();

    const unreadRow = getThreadRow(screen.container, "Unread target");
    expect(unreadRow.querySelector("[data-app-action-sidebar-thread-pin-slot]") !== null).toBeTrue();
    expect(unreadRow.querySelector("[data-app-action-sidebar-thread-pin-session]") === null).toBeTrue();

    const longRow = getThreadRow(screen.container, "Very long session title that should truncate before colliding with row actions");
    expect(longRow.querySelector("[data-app-action-sidebar-thread-pin-slot]") !== null).toBeTrue();
    expect(longRow.querySelector("[data-app-action-sidebar-thread-actions-menu]") !== null).toBeTrue();
    expect(longRow.querySelector("[data-thread-title]")?.className.includes("truncate")).toBeTrue();
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

    expect(labels).toBe("Hide sidebar,Back,Forward");
    expect(leftSlot.getAttribute("style")?.includes("width: 312px")).toBeTrue();
    expect(leftSlot.getAttribute("style")?.includes("min-width: 312px")).toBeFalse();
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
    expect(Boolean(section.querySelector("[data-app-action-sidebar-section-body-motion]"))).toBeTrue();

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(section.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");
    const exitingSectionBody = section.querySelector("[data-app-action-sidebar-section-body-motion]");
    expect(Boolean(exitingSectionBody)).toBeTrue();
    expect(section.querySelectorAll("[data-app-action-sidebar-project-row]").length).toBe(1);
    expect(Boolean(section.querySelector("[data-app-action-sidebar-project-row]")?.closest("[data-app-action-sidebar-section-body-motion]"))).toBeTrue();

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(section.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("false");
    expect(Boolean(section.querySelector("[data-app-action-sidebar-section-body-motion]"))).toBeTrue();
    expect(section.querySelectorAll("[data-app-action-sidebar-project-row]").length).toBe(1);
  });

  test("clicking an active project row while focused on its child session keeps the folder collapsed", async () => {
    const activeThread = makeAttachedSession({
      id: "session:alpha:thread",
      title: "Active thread",
      isOverview: false,
      order: 1,
      rightCollapsed: true,
      rightLayout: makePanelLayout([], null),
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
    const exitingThreadRow = screen.container.querySelector('[data-app-action-sidebar-thread-title="Active thread"]');
    expect(Boolean(exitingThreadRow?.closest("[data-app-action-sidebar-project-list-motion]"))).toBeTrue();
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
    expect(textContent(document.body).includes("Add source folder")).toBeTrue();
    expect(textContent(document.body).includes("Edit sources")).toBeTrue();
  });

  test("project rows expose the Codex sortable header DOM contract", async () => {
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [makeSession({
          id: "overview:beta",
          projectId: "beta",
          title: "Beta Overview",
          isOverview: true,
        })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const betaRow = screen.container.querySelector('[data-app-action-sidebar-project-id="beta"]');
    expect(betaRow?.getAttribute("role")).toBe("button");
    expect(betaRow?.getAttribute("tabindex")).toBe("0");
    expect(betaRow?.getAttribute("aria-roledescription")).toBe("sortable");
    expect(betaRow?.getAttribute("aria-describedby")?.startsWith("DndDescribedBy-")).toBeTrue();
    expect(Boolean(betaRow?.querySelector('[data-app-action-sidebar-select-project]'))).toBeTrue();
    expect(Boolean(document.getElementById(betaRow?.getAttribute("aria-describedby") ?? ""))).toBeTrue();
  });

  test("pinned project groups render above normal projects and are excluded from Projects", async () => {
    const beta = {
      ...makeProject("beta", "Beta"),
      pinned: true,
      pinnedOrder: 0,
    };
    const screen = renderWorkbench({
      projects: [makeProject(), beta, makeProject("gamma", "Gamma")],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [makeSession({
          id: "overview:beta",
          projectId: "beta",
          title: "Beta Overview",
          isOverview: true,
        })],
        gamma: [makeSession({
          id: "overview:gamma",
          projectId: "gamma",
          title: "Gamma Overview",
          isOverview: true,
        })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const pinnedSection = screen.container.querySelector('[data-app-action-sidebar-section-heading="Pinned"]');
    const projectsSection = screen.container.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
    expect(Boolean(pinnedSection)).toBeTrue();
    expect(pinnedSection?.querySelector('[data-app-action-sidebar-project-id="beta"]') !== null).toBeTrue();
    expect(projectsSection?.querySelector('[data-app-action-sidebar-project-id="beta"]') === null).toBeTrue();
    expect(projectsSection?.querySelector('[data-app-action-sidebar-project-id="alpha"]') !== null).toBeTrue();
    expect(projectsSection?.querySelector('[data-app-action-sidebar-project-id="gamma"]') !== null).toBeTrue();
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
            rightLayout: makePanelLayout([listTab.id], listTab.id),
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

  test("uses the global app header as the only top title row", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:thread", title: "Thread", isOverview: false })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const headerContextSurface = screen.container.querySelector('[data-testid="app-shell-header-context-menu-surface"]');
    const threadStage = screen.container.querySelector('[data-thread-stage="true"]');
    const threadFrame = screen.container.querySelector(".app-shell-main-content-frame");
    if (!globalHeader || !threadFrame || !threadStage) {
      throw new Error("Expected workbench global header, thread frame, and thread stage");
    }
    expect(textContent(globalHeader).includes("Overview")).toBeFalse();
    expect(textContent(globalHeader).includes("Alpha thread")).toBeTrue();
    expect(textContent(threadStage).includes("Alpha thread")).toBeFalse();
    expect(headerContextSurface?.className.includes("ms-4")).toBeTrue();
    expect(headerContextSurface?.className.includes("[contain:layout_paint]")).toBeTrue();
    expect(threadFrame.className.includes("mt-(--app-shell-main-content-frame-top-offset)")).toBeTrue();
    expect(threadFrame.className.includes("border-t")).toBeTrue();
    expect(threadFrame.className.includes("border-token-border-default")).toBeTrue();
    expect((threadFrame.getAttribute("style") ?? "").includes("--app-shell-main-content-frame-top-offset")).toBeFalse();
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBeTrue();
    const topFade = screen.container.querySelector(".app-shell-main-content-top-fade");
    expect(topFade?.getAttribute("data-app-shell-main-content-top-fade")).toBe("full-bleed");
    expect(topFade?.className.includes("h-4")).toBeTrue();
    expect(topFade?.className.includes("bg-gradient-to-b")).toBeTrue();
  });

  test("keeps the frame border shell-owned while reserving right header actions", async () => {
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
    expect(Boolean(visibleProps && "showHeaderSeparator" in visibleProps)).toBeFalse();
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBeTrue();
    expect(visibleFrame?.className.includes("border-t")).toBeTrue();
    expect(visibleFrame?.className.includes("border-token-border-default")).toBeTrue();
    expect((visibleFrame?.getAttribute("style") ?? "").includes("--app-shell-main-content-frame-top-offset")).toBeFalse();
    expect((visibleFrame?.getAttribute("style") ?? "").includes("--thread-stage-header-right-reserve")).toBeFalse();
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
    expect(Boolean(collapsedProps && "showHeaderSeparator" in collapsedProps)).toBeFalse();
    expect(collapsedScreen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBeTrue();
    expect((collapsedFrame?.getAttribute("style") ?? "").includes("--app-shell-main-content-frame-top-offset")).toBeFalse();
    expect((collapsedFrame?.getAttribute("style") ?? "").includes("--thread-stage-header-right-reserve")).toBeFalse();
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

  test("inline message edit calls rollback edit and refreshes the active snapshot without seeding composer intent", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ isOverview: false })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    const onEditLastUserTurn = actions.onEditLastUserTurn as ((input: {
      threadId: string;
      turnId: string;
      message: string;
    }) => Promise<void>) | undefined;
    expect(typeof onEditLastUserTurn).toBe("function");

    await act(async () => {
      await onEditLastUserTurn?.({
        threadId: "thread-alpha",
        turnId: "turn-latest",
        message: "Rewrite the latest prompt",
      });
    });
    await settleAsyncRender();

    expect(JSON.stringify(editLastUserTurnCalls)).toBe(JSON.stringify([
      ["thread-alpha", "turn-latest", "Rewrite the latest prompt"],
    ]));
    expect(JSON.stringify(requestThreadStreamSnapshotCalls)).toBe(JSON.stringify(["thread-alpha"]));
    expect(setComposerIntentCalls.length).toBe(0);
  });

  test("session thread actions wire queued follow-up, plan, and background terminal commands", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ isOverview: false })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    for (const actionName of [
      "onRemoveQueuedFollowUp",
      "onReorderQueuedFollowUps",
      "onSendQueuedFollowUpNow",
      "onEditQueuedFollowUp",
      "onResolvePlanImplementationRequest",
      "onCleanBackgroundTerminals",
    ]) {
      expect(typeof actions[actionName]).toBe("function");
    }

    await act(async () => {
      await (actions.onRemoveQueuedFollowUp as (threadId: string, followUpId: string) => Promise<void>)(
        "thread-alpha",
        "follow-1",
      );
      await (actions.onReorderQueuedFollowUps as (threadId: string, orderedFollowUpIds: string[]) => Promise<void>)(
        "thread-alpha",
        ["follow-2", "follow-1"],
      );
      await (actions.onSendQueuedFollowUpNow as (threadId: string, followUpId: string) => Promise<void>)(
        "thread-alpha",
        "follow-2",
      );
      await (actions.onEditQueuedFollowUp as (input: {
        threadId: string;
        followUpId: string;
        prompt: string;
        promptInput?: unknown;
      }) => Promise<void>)({
        threadId: "thread-alpha",
        followUpId: "follow-3",
        prompt: "Edit queued message",
        promptInput: {
          text: "Edit queued message",
          mentions: [{ name: "README.md", path: "/repo/README.md" }],
        },
      });
      await (actions.onResolvePlanImplementationRequest as (threadId: string, turnId: string) => Promise<void>)(
        "thread-alpha",
        "turn-plan",
      );
      await (actions.onCleanBackgroundTerminals as (threadId: string) => Promise<void>)("thread-alpha");
    });
    await settleAsyncRender();

    expect(JSON.stringify(removeQueuedFollowUpCalls)).toBe(JSON.stringify([
      ["thread-alpha", "follow-1"],
      ["thread-alpha", "follow-3"],
    ]));
    expect(JSON.stringify(reorderQueuedFollowUpsCalls)).toBe(JSON.stringify([
      ["thread-alpha", ["follow-2", "follow-1"]],
    ]));
    expect(JSON.stringify(sendQueuedFollowUpNowCalls)).toBe(JSON.stringify([
      ["thread-alpha", "follow-2"],
    ]));
    expect(JSON.stringify(setComposerIntentCalls)).toBe(JSON.stringify([
      [
        "thread-alpha",
        {
          prompt: "Edit queued message",
          promptInput: {
            text: "Edit queued message",
            mentions: [{ name: "README.md", path: "/repo/README.md" }],
          },
          focusNonce: (setComposerIntentCalls[0]?.[1] as { focusNonce?: number } | undefined)?.focusNonce,
        },
      ],
    ]));
    expect(JSON.stringify(removePlanImplementationRequestCalls)).toBe(JSON.stringify([
      ["thread-alpha", "turn-plan"],
    ]));
    expect(JSON.stringify(cleanBackgroundTerminalsCalls)).toBe(JSON.stringify(["thread-alpha"]));
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
    setWindowInnerWidthForTest(1400);
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
    const globalHeader = screen.getByTestId("workbench-global-header");
    const summaryRail = screen.getByTestId("thread-stage-header-summary-actions");
    let stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(within(globalHeader).queryByRole("button", { name: "Toggle pinned summary" }) !== null).toBeTrue();
    expect(globalHeader.contains(summaryRail)).toBeTrue();
    expect(within(summaryRail).queryByRole("button", { name: "Toggle pinned summary" }) !== null).toBeTrue();
    expect(summaryToggle.getAttribute("aria-pressed")).toBe("true");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(true);
    expect(stageProps?.summaryPanelContentShift).toBe(-158);

    await act(async () => {
      fireEvent.click(summaryToggle);
      await Promise.resolve();
    });
    await settleAsyncRender();

    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(summaryToggle.getAttribute("aria-pressed")).toBe("false");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(stageProps?.summaryPanelContentShift).toBe(0);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("false");
  });

  test("large thread widths use edge-scroll header and gutter summary mode", async () => {
    setWindowInnerWidthForTest(1902);
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            isOverview: false,
            rightCollapsed: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.getByTestId("workbench-global-header");
    const threadFrame = screen.container.querySelector(".app-shell-main-content-frame");
    const stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(globalHeader.getAttribute("data-app-shell-header-edge-scroll")).toBe("true");
    expect(threadFrame?.className.includes("border-transparent")).toBeTrue();
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBeTrue();
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(true);
    expect(stageProps?.summaryPanelContentShift).toBe(0);
  });

  test("medium thread widths keep guarded header chrome and shift pinned summary", async () => {
    setWindowInnerWidthForTest(1801);
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            isOverview: false,
            rightCollapsed: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.getByTestId("workbench-global-header");
    const threadFrame = screen.container.querySelector(".app-shell-main-content-frame");
    const stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(globalHeader.getAttribute("data-app-shell-header-edge-scroll")).toBe("false");
    expect(threadFrame?.className.includes("border-token-border-default")).toBeTrue();
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBeTrue();
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(true);
    expect(stageProps?.summaryPanelContentShift).toBe(-158);
  });

  test("narrow effective thread widths switch summary to overlay popover", async () => {
    setWindowInnerWidthForTest(1350);
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            isOverview: false,
            rightCollapsed: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const summaryToggle = screen.getByRole("button", { name: "Toggle summary" });
    expect(summaryToggle.getAttribute("aria-pressed")).toBe("false");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(stageProps?.summaryPanelHideImmediately).toBe(false);
    expect(stageProps?.summaryPanelContentShift).toBe(0);
  });

  test("resize-driven overlay mode keeps the summary mounted so it can animate out", async () => {
    setWindowInnerWidthForTest(1801);
    localStorage.setItem("nodex:thread-summary-panel:pinned-open", "true");
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            isOverview: false,
            rightCollapsed: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    let stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(true);
    expect(stageProps?.summaryPanelContentShift).toBe(-158);

    setWindowInnerWidthForTest(1350);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(screen.getByRole("button", { name: "Toggle summary" }).getAttribute("aria-pressed")).toBe("false");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(stageProps?.summaryPanelHideImmediately).toBe(false);
    expect(stageProps?.summaryPanelContentShift).toBe(0);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("true");
  });

  test("responsive shell guards close competing right panel and sidebar at Codex thresholds", async () => {
    setWindowInnerWidthForTest(1000);
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

    setWindowInnerWidthForTest(959);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) => {
      const input = call[3] as { collapsed?: boolean; size?: { fullWidth?: boolean } } | undefined;
      return call[0] === "project-session-panels:update"
        && call[1] === "session:alpha:thread"
        && call[2] === "right"
        && input?.collapsed === true
        && input.size?.fullWidth === false;
    })).toBeTrue();

    setWindowInnerWidthForTest(719);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      expect(screen.queryByTestId("project-session-sidebar") === null).toBeTrue();
    });
  });

  test("thread summary toggle stays visible while the right panel is open and keeps the pinned overlay hidden", async () => {
    setWindowInnerWidthForTest(1400);
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
    const summaryRail = screen.getByTestId("thread-stage-header-summary-actions");
    expect(rightOpenSummaryToggle.getAttribute("aria-pressed")).toBe("false");
    expect(within(globalHeader).queryByRole("button", { name: "Toggle summary" }) !== null).toBeTrue();
    expect(globalHeader.contains(summaryRail)).toBeTrue();
    expect(within(summaryRail).queryByRole("button", { name: "Toggle summary" }) !== null).toBeTrue();
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(stageProps?.summaryPanelHideImmediately).toBe(false);
    expect(stageProps?.summaryPanelContentShift).toBe(0);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("true");

    await act(async () => {
      fireEvent.click(rightOpenSummaryToggle);
      await Promise.resolve();
    });
    await settleAsyncRender();

    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(screen.getByRole("button", { name: "Toggle summary" }).getAttribute("aria-pressed")).toBe("true");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(false);
    expect(stageProps?.summaryPanelHideImmediately).toBe(true);
    expect(stageProps?.summaryPanelContentShift).toBe(0);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const summaryToggle = screen.getByRole("button", { name: "Toggle pinned summary" });
    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(summaryToggle.getAttribute("aria-pressed")).toBe("true");
    expect(stageProps?.summaryPanelMounted).toBe(true);
    expect(stageProps?.summaryPanelOpen).toBe(true);
    expect(stageProps?.summaryPanelHideImmediately).toBe(false);
    expect(stageProps?.summaryPanelContentShift).toBe(-158);
    expect(localStorage.getItem("nodex:thread-summary-panel:pinned-open")).toBe("true");
  });

  test("overview sessions default to open full-width right panels", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const rightPanel = screen.getByTestId("session-right-panel");
    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    const globalHeader = screen.getByTestId("workbench-global-header");
    const headerCenterSurface = screen.getByTestId("app-shell-header-context-menu-surface");
    const restoreButton = screen.getByRole("button", { name: "Restore panel width" });
    expect(globalHeader.className.includes(APP_SHELL_GLOBAL_HEADER_LAYER_CLASS)).toBeTrue();
    expect(headerCenterSurface.getAttribute("aria-hidden")).toBe("true");
    expect(headerCenterSurface.className.includes("invisible")).toBeTrue();
    expect(rightPanel.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(rightPanel.getAttribute("data-app-shell-focus-area")).toBe("right-panel");
    expect(rightPanel.className.includes(APP_SHELL_RIGHT_PANEL_LAYER_CLASS)).toBeTrue();
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("true");
    expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
  });

  test("collapsed sidebar full-width right panel reserves the left titlebar width before tabs", async () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    try {
      const screen = renderWorkbench({ sidebar: { collapsed: true, width: 300 } });
      await settleAsyncRender();
      await settleAsyncRender();

      const leftSlot = getHeaderShellSlot(screen, "left");
      const rightSlot = getHeaderShellSlot(screen, "right");
      const rightPanel = screen.getByTestId("session-right-panel");
      const tabHeader = rightPanel.querySelector('[role="tablist"]')?.parentElement?.parentElement;
      if (!tabHeader) throw new Error("Expected right-panel tab header");
      const leadingSpacer = tabHeader.firstElementChild?.firstElementChild;
      const tabRow = tabHeader.children.item(1);
      const trailingSpacer = screen.container.querySelector('[data-testid="right-panel-tab-bar-header-spacer"]');
      const restoreButton = screen.getByRole("button", { name: "Restore panel width" });

      expect(leftSlot.getAttribute("style")?.includes("width: 0px")).toBeTrue();
      expect(leftSlot.getAttribute("style")?.includes("min-width: 208px")).toBeTrue();
      expect(leftSlot.className.includes("no-drag")).toBeTrue();
      expect(tabHeader.className.includes("draggable")).toBeFalse();
      expect(within(leftSlot).getByRole("button", { name: "New chat" }) !== null).toBeTrue();
      expect(rightSlot.getAttribute("style")?.includes("width: 0px")).toBeTrue();
      expect(rightSlot.getAttribute("style")?.includes("min-width: 70px")).toBeTrue();
      expect(rightSlot.className.includes("no-drag")).toBeTrue();
      expect(leadingSpacer?.getAttribute("style")?.includes("width: 208px")).toBeTrue();
      expect(leadingSpacer?.className.includes("pointer-events-none")).toBeTrue();
      expect(leadingSpacer?.className.includes("no-drag")).toBeTrue();
      expect(tabRow?.querySelector('[role="tablist"]') !== null).toBeTrue();
      expect(tabHeader.contains(restoreButton)).toBeTrue();
      expect(trailingSpacer?.getAttribute("style")?.includes("width: calc(70px)")).toBeTrue();
      expect(trailingSpacer?.className.includes("no-drag")).toBeTrue();
      expect(screen.container.querySelector('[data-testid="right-panel-global-header-actions"]') === null).toBeTrue();

      await moveSidebarPointer(900);
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]')).toBe(null);

      await act(async () => {
        restoreButton.focus();
        fireEvent.click(restoreButton);
        await Promise.resolve();
      });
      await settleAsyncRender();

      expect(screen.getByRole("button", { name: "Expand panel" }).getAttribute("aria-pressed")).toBe("false");
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]')).toBe(null);
    } finally {
      Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform });
    }
  });

  test("full-width eligible attached right-panel tabs pass the composer overlay host to the root thread", async () => {
    const attachedSession = makeAttachedSession();
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [attachedSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    const rightPanel = screen.getByTestId("session-right-panel");
    const host = rightPanel.querySelector('[data-right-panel-composer-overlay-host="true"]');
    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(host !== null).toBeTrue();
    expect(props?.rightPanelComposerOverlayEnabled).toBe(true);
    expect(props?.rightPanelComposerOverlayTarget).toBe(host);
  });

  test("full-width overlay state keeps the bottom-panel toggle clickable after pointerdown", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:overlay-bottom-toggle",
      tabs: [
        {
          id: "db-tab",
          kind: "db_view",
          title: "DB View",
          config: { projectId: "alpha", view: "kanban" },
        },
        {
          id: "terminal-tab",
          kind: "terminal",
          title: "Terminal",
          panelId: "bottom",
          config: { projectId: "alpha", terminalSessionId: "terminal" },
        },
      ],
      panels: makePanels({
        rightTabIds: ["db-tab"],
        rightActiveTabId: "db-tab",
        rightFullWidth: true,
        bottomTabIds: ["terminal-tab"],
        bottomActiveTabId: "terminal-tab",
        bottomCollapsed: true,
      }),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(props?.rightPanelComposerOverlayEnabled).toBe(true);
    expect(screen.queryByTestId("session-bottom-panel")).toBe(null);

    await pointerActivate(screen.getByRole("button", { name: "Toggle bottom panel" }));

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:overlay-bottom-toggle"
      && call[2] === "bottom"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
    )).toBeTrue();
    expect(screen.queryByTestId("session-bottom-panel") !== null).toBeTrue();
  });

  test("full-width overlay state keeps the side-panel toggle clickable after pointerdown", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:overlay-side-toggle",
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(props?.rightPanelComposerOverlayEnabled).toBe(true);

    await pointerActivate(screen.getByRole("button", { name: "Toggle side panel" }));

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:overlay-side-toggle"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: true })
    )).toBeTrue();
  });

  test("full-width overlay state keeps restore-panel-width clickable after pointerdown", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:overlay-restore",
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(props?.rightPanelComposerOverlayEnabled).toBe(true);

    await pointerActivate(screen.getByRole("button", { name: "Restore panel width" }));

    expect(invokeCalls.some((call) => {
      const input = call[3] as { size?: { fullWidth?: boolean } } | undefined;
      return call[0] === "project-session-panels:update"
        && call[1] === "session:alpha:overlay-restore"
        && call[2] === "right"
        && input?.size?.fullWidth === false;
    })).toBeTrue();
  });

  test("full-width card-stage overlay state keeps card toolbar actions clickable after pointerdown", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:overlay-card-stage",
      tabs: [
        {
          id: "card-stage-tab",
          kind: "card_stage",
          title: "Card One",
          config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
        },
      ],
      panels: makePanels({
        rightTabIds: ["card-stage-tab"],
        rightActiveTabId: "card-stage-tab",
        rightFullWidth: true,
      }),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(props?.rightPanelComposerOverlayEnabled).toBe(true);
    expect(screen.getByTestId("session-right-panel").getAttribute("data-right-panel-width-mode")).toBe("full");

    await pointerActivate(screen.getByRole("button", { name: "History" }));
    await pointerActivate(screen.getByRole("button", { name: "Delete" }));

    expect((globalThis as { __mockCardStageHistoryClicks?: number }).__mockCardStageHistoryClicks).toBe(1);
    expect((globalThis as { __mockCardStageDeleteClicks?: number }).__mockCardStageDeleteClicks).toBe(1);
  });

  test("regular width and terminal right-panel tabs do not enable the root composer overlay", async () => {
    const regularSession = makeAttachedSession({
      id: "session:alpha:regular",
      isOverview: false,
      rightCollapsed: false,
    });
    const regularScreen = renderWorkbench({
      sessionsByProject: { alpha: [regularSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    let props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(props?.rightPanelComposerOverlayEnabled).toBe(false);
    regularScreen.unmount();

    const terminalSession = makeAttachedSession({
      id: "session:alpha:terminal-right",
      tabs: [
        {
          id: "terminal-tab",
          kind: "terminal",
          title: "Terminal",
          panelId: "right",
          config: { projectId: "alpha", terminalSessionId: "terminal" },
        },
      ],
      rightLayout: makePanelLayout(["terminal-tab"], "terminal-tab"),
    });
    const terminalScreen = renderWorkbench({
      sessionsByProject: { alpha: [terminalSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(terminalScreen.getByTestId("session-right-panel").getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(props?.rightPanelComposerOverlayEnabled).toBe(false);
  });

  test("open non-overview right panel keeps side toggle global and expands from the tab header", async () => {
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
    const headerCenterSurface = screen.getByTestId("app-shell-header-context-menu-surface");
    const tabHeader = rightPanel?.querySelector('[role="tablist"]')?.parentElement?.parentElement;
    const headerShellSlot = getHeaderShellSlot(screen, "right");
    if (!tabHeader) throw new Error("Expected right-panel tab header");

    const sidePanelToggle = screen.getByRole("button", { name: "Toggle side panel" });
    const expandButton = screen.getByRole("button", { name: "Expand panel" });
    const rightPanelHeaderSpacer = screen.container.querySelector('[data-testid="right-panel-tab-bar-header-spacer"]');
    const expandIconPath = expandButton.querySelector("path")?.getAttribute("d") ?? "";
    const visibleGlobalHeaderButtons = Array.from(headerShellSlot?.querySelectorAll("button") ?? []);
    expect(globalHeader?.contains(sidePanelToggle)).toBeTrue();
    expect(headerShellSlot?.contains(sidePanelToggle)).toBeTrue();
    expect(visibleGlobalHeaderButtons.map((button) => button.getAttribute("aria-label")).join(",")).toBe("Toggle bottom panel,Toggle side panel");
    expect(rightPanel?.className.includes(APP_SHELL_RIGHT_PANEL_LAYER_CLASS)).toBeTrue();
    expect(globalHeader?.className.includes(APP_SHELL_GLOBAL_HEADER_LAYER_CLASS)).toBeTrue();
    expect(headerCenterSurface.getAttribute("aria-hidden")).toBe(null);
    expect(headerCenterSurface.className.includes("invisible")).toBeFalse();
    expect(headerShellSlot?.className.includes("pe-2")).toBeTrue();
    expect(headerShellSlot?.className.includes("ml-auto")).toBeFalse();
    expect(headerShellSlot?.className.includes("no-drag")).toBeTrue();
    expect(headerShellSlot?.getAttribute("style")?.includes("width: 372px")).toBeTrue();
    expect(headerShellSlot?.getAttribute("style")?.includes("min-width: 70px")).toBeTrue();
    expect(sidePanelToggle.getAttribute("aria-pressed")).toBe("true");
    expect(sidePanelToggle.className.includes("bg-token-foreground/5")).toBeTrue();
    expect(globalHeader?.contains(expandButton)).toBeFalse();
    expect(tabHeader.contains(expandButton)).toBeTrue();
    expect(tabHeader.className.includes("draggable")).toBeFalse();
    expect(expandButton.parentElement?.className.includes("pointer-events-auto")).toBeTrue();
    expect(expandButton.querySelector("svg")?.getAttribute("class")?.includes("icon-xs")).toBeTrue();
    expect(rightPanelHeaderSpacer?.className.includes("pointer-events-none")).toBeTrue();
    expect(rightPanelHeaderSpacer?.className.includes("no-drag")).toBeTrue();
    expect(rightPanelHeaderSpacer?.parentElement?.className.includes("pointer-events-auto")).toBeFalse();
    expect(rightPanelHeaderSpacer?.parentElement?.className.includes("no-drag")).toBeTrue();
    expect(rightPanelHeaderSpacer?.parentElement?.getAttribute("role")).toBe("presentation");
    expect(expandButton.className.includes("no-drag")).toBeTrue();
    expect(expandButton.className.includes("rounded-lg")).toBeTrue();
    expect(expandButton.className.includes("h-token-button-composer")).toBeTrue();
    expect(expandButton.className.includes("text-token-text-tertiary")).toBeTrue();
    expect(expandIconPath.startsWith(CODEX_EXPAND_PANEL_ICON_PREFIX)).toBeTrue();
    expect(rightPanelHeaderSpacer?.getAttribute("style")?.includes("width: calc(70px)")).toBeTrue();
    expect(screen.container.querySelector('[data-testid="right-panel-global-header-actions"]') === null).toBeTrue();

    await act(async () => {
      fireEvent.click(expandButton);
      await Promise.resolve();
    });

    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    expect(rightPanel?.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(rightPanel?.getAttribute("data-app-shell-focus-area")).toBe("right-panel");
    expect(rightPanel?.className.includes(APP_SHELL_RIGHT_PANEL_LAYER_CLASS)).toBeTrue();
    expect(globalHeader?.className.includes(APP_SHELL_GLOBAL_HEADER_LAYER_CLASS)).toBeTrue();
    expect(headerCenterSurface.getAttribute("aria-hidden")).toBe("true");
    expect(headerCenterSurface.className.includes("invisible")).toBeTrue();
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
    expect(fullWidthTabHeader?.contains(restoreButton)).toBeTrue();
    expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
    expect(restoreButton.className.includes("bg-token-foreground/5")).toBeTrue();
    expect(restoreButton.querySelector("svg")?.getAttribute("class")?.includes("icon-xs")).toBeTrue();
    expect(restoreButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_RESTORE_PANEL_ICON_PREFIX)).toBeTrue();
  });

  test("right panel resize previews the dragged width before persistence", async () => {
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

    const rightPanel = screen.getByTestId("session-right-panel");
    const separator = screen.getByRole("separator", { name: "Resize right panel" });
    expect(rightPanel.getAttribute("style")?.includes("width: 372px")).toBeTrue();

    await act(async () => {
      fireEvent.mouseDown(separator, { clientX: 700 });
      fireEvent.mouseMove(window, { clientX: 750 });
      await Promise.resolve();
    });

    expect(rightPanel.getAttribute("style")?.includes("width: 322px")).toBeTrue();
    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 322
    )).toBeFalse();

    await act(async () => {
      fireEvent.mouseUp(window);
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 322
    )).toBeTrue();
  });

  test("right panel resize can grow well beyond the default width on wide shells", async () => {
    setWindowInnerWidthForTest(1800);
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

    const rightPanel = screen.getByTestId("session-right-panel");
    const separator = screen.getByRole("separator", { name: "Resize right panel" });

    await act(async () => {
      fireEvent.mouseDown(separator, { clientX: 1_200 });
      fireEvent.mouseMove(window, { clientX: 400 });
      await Promise.resolve();
    });

    expect(rightPanel.getAttribute("style")?.includes("width: 1148px")).toBeTrue();

    await act(async () => {
      fireEvent.mouseUp(window);
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 1148
    )).toBeTrue();
  });

  test("right panel resize closes the side panel when dragged below Codex minimum width", async () => {
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

    const separator = screen.getByRole("separator", { name: "Resize right panel" });
    await act(async () => {
      fireEvent.mouseDown(separator, { clientX: 700 });
      fireEvent.mouseMove(window, { clientX: 1_020 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: true })
    )).toBeTrue();
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).toBe(null);
    expect(screen.queryByTestId("session-right-panel") !== null).toBeTrue();

    await act(async () => {
      fireEvent.mouseUp(window);
      await Promise.resolve();
    });
  });

  test("right panel resize normalizes drag deltas by the Codex window zoom", async () => {
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

    const workbenchRoot = screen.getByTestId("workbench-global-header").parentElement as HTMLElement | null;
    workbenchRoot?.style.setProperty("--codex-window-zoom", "2");
    const rightPanel = screen.getByTestId("session-right-panel");
    const separator = screen.getByRole("separator", { name: "Resize right panel" });

    await act(async () => {
      fireEvent.mouseDown(separator, { clientX: 1_400 });
      fireEvent.mouseMove(window, { clientX: 1_500 });
      await Promise.resolve();
    });

    expect(rightPanel.getAttribute("style")?.includes("width: 322px")).toBeTrue();

    await act(async () => {
      fireEvent.mouseUp(window);
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 322
    )).toBeTrue();
  });

  test("bottom panel resize previews the dragged height before persistence", async () => {
    const terminalSession = makeBottomPanelTerminalSession();
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [terminalSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const bottomPanel = screen.getByTestId("session-bottom-panel");
    const bottomPanelSizer = getBottomPanelContentSizer(bottomPanel);
    const separator = screen.getByRole("separator", { name: "Resize bottom panel" });
    expect(bottomPanelSizer.getAttribute("style")?.includes("height: 280px")).toBeTrue();

    await act(async () => {
      fireEvent.mouseDown(separator, { clientY: 700 });
      fireEvent.mouseMove(window, { clientY: 740 });
      await Promise.resolve();
    });

    expect(bottomPanelSizer.getAttribute("style")?.includes("height: 240px")).toBeTrue();
    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:terminal"
      && call[2] === "bottom"
      && ((call[3] as { size?: { heightPx?: number } })?.size?.heightPx ?? null) === 240
    )).toBeFalse();

    await act(async () => {
      fireEvent.mouseUp(window);
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:terminal"
      && call[2] === "bottom"
      && ((call[3] as { size?: { heightPx?: number } })?.size?.heightPx ?? null) === 240
    )).toBeTrue();
  });

  test("bottom panel resize closes the bottom panel when dragged below Codex minimum height", async () => {
    const terminalSession = makeBottomPanelTerminalSession();
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [terminalSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const separator = screen.getByRole("separator", { name: "Resize bottom panel" });
    await act(async () => {
      fireEvent.mouseDown(separator, { clientY: 700 });
      fireEvent.mouseMove(window, { clientY: 900 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:terminal"
      && call[2] === "bottom"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: true })
    )).toBeTrue();
    expect(screen.queryByRole("separator", { name: "Resize bottom panel" })).toBe(null);
    expect(screen.queryByTestId("session-bottom-panel") !== null).toBeTrue();

    await act(async () => {
      fireEvent.mouseUp(window);
      await Promise.resolve();
    });
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
    expect(screen.queryByTestId("session-right-panel") !== null).toBeTrue();
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).toBe(null);

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

    fireEvent.pointerDown(getFilesPreviewInteractionTarget(screen));
    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"files"')
    )).toBeTrue();
  });

  test("right-panel add menu keeps custom action icons compact", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const menu = await openPanelMenu(screen, "Open side panel tab");
    expectPanelMenuDescriptionsHidden(menu);

    for (const label of ["Review", "Terminal", "Browser", "Files", "Side chat"]) {
      const className = getMenuItemIconClassName(menu, label);
      expect(className.includes("icon-sm")).toBeTrue();
      expect(className.includes("icon-md")).toBeFalse();
    }
  });

  test("bottom-panel add menu hides action descriptions", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    expectPanelMenuDescriptionsHidden(menu);
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
      rightLayout: makePanelLayout([], null),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [emptySession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actionGrid = screen.container.querySelector('[data-thread-side-panel-new-tab-action-grid="true"]');
    expect(actionGrid !== null).toBeTrue();
    if (!actionGrid) throw new Error("Expected right-panel action grid");
    const actionText = textContent(actionGrid);
    expect(actionText.indexOf("Review") < actionText.indexOf("Terminal")).toBeTrue();
    expect(actionText.indexOf("Terminal") < actionText.indexOf("Browser")).toBeTrue();
    expect(actionText.indexOf("Browser") < actionText.indexOf("Files")).toBeTrue();
    expect(actionText.indexOf("Files") < actionText.indexOf("Side chat")).toBeTrue();
    expect(screen.getByRole("button", { name: /Review/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Terminal/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Browser/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Files/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Side chat/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /DB View/ }) !== null).toBeTrue();
    expect(screen.getByRole("button", { name: /Card Stage/ }) !== null).toBeTrue();
    expect(actionText.indexOf("Side chat") < actionText.indexOf("DB View")).toBeTrue();
    expect(actionText.indexOf("DB View") < actionText.indexOf("Card Stage")).toBeTrue();
    expect(actionGrid.className.includes("gap-1")).toBeTrue();
    expect(screen.getByRole("button", { name: /Review/ }).className.includes("min-h-10")).toBeTrue();
    expect(textContent(actionGrid).includes("⌃⇧G")).toBeTrue();
    expect(textContent(actionGrid).includes("⌃`")).toBeTrue();
    expect(textContent(actionGrid).includes("Ctrl+T")).toBeTrue();
    expect(textContent(actionGrid).includes("Ctrl+P")).toBeTrue();
    expect(textContent(actionGrid).includes("Alt+Ctrl+S")).toBeTrue();
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

  test("right panel keeps Nodex-only actions after Codex actions", async () => {
    const emptySession = makeSession({
      id: "session:alpha:nodex-actions",
      isOverview: false,
      tabs: [],
      rightLayout: makePanelLayout([], null),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [emptySession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const menu = await openPanelMenu(screen, "Open side panel tab");
    const menuText = textContent(menu);
    expect(menuText.indexOf("Review") < menuText.indexOf("Terminal")).toBeTrue();
    expect(menuText.indexOf("Side chat") < menuText.indexOf("DB View")).toBeTrue();
    expect(menuText.indexOf("DB View") < menuText.indexOf("Card Stage")).toBeTrue();

    fireEvent.click(within(menu).getByText("DB View"));
    await settleAsyncRender();
    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"db_view"')
    )).toBeTrue();
  });

  for (const previewCase of [
    { label: "Files", kind: "files", pinText: "Filter files..." },
    { label: "Browser", kind: "browser", pinText: "Browser is available in the desktop app" },
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

      const pinTarget = previewCase.kind === "files"
        ? getFilesPreviewInteractionTarget(screen)
        : screen.getByText(previewCase.pinText);
      fireEvent.pointerDown(pinTarget);
      await settleAsyncRender();
      await settleAsyncRender();

      expect(invokeCalls.some((call) =>
        call[0] === "project-session-tabs:create"
        && JSON.stringify(call[1]).includes('"panelId":"bottom"')
        && JSON.stringify(call[1]).includes(`"kind":"${previewCase.kind}"`)
      )).toBeTrue();
    });
  }

  test("bottom Side chat action starts an ephemeral side tab instead of a durable preview", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    await act(async () => {
      fireEvent.click(within(menu).getByText("Side chat"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "Side chat" }) !== null).toBeTrue();
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]')).toBe(null);
    expect(String(startSideChatCalls.length)).toBe("1");
    expect(JSON.stringify(startSideChatCalls[0]).includes('"parentThreadId":"thread-alpha"')).toBeTrue();
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeFalse();
    expect(textContent(screen.container).includes("Thread:side-thread-1")).toBeTrue();
    const stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(stageProps?.sideChatContext ?? null)).toBe(
      "{\"parentThreadId\":\"thread-alpha\",\"tabTitle\":\"Side chat\"}",
    );
    expect(Boolean(stageProps?.summaryPanelMounted)).toBeFalse();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close Side chat tab" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(String(discardSideChatCalls.length)).toBe("1");
    expect(discardSideChatCalls[0] ?? "").toBe("side-thread-1");
  });

  test("plus menu hides singleton actions that already exist while keeping Browser multi-tab", async () => {
    const browserTab = makeSessionTab({
      id: "overview:alpha:browser",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
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
      rightLayout: makePanelLayout(["overview:alpha:db", browserTab.id, reviewTab.id], "overview:alpha:db"),
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
    expect(within(menu).getByText("Card Stage") !== null).toBeTrue();
    expect(within(menu).getByText("Browser") !== null).toBeTrue();
    expect(within(menu).queryByText("Review")).toBe(null);
    expect(within(menu).getByText("Files") !== null).toBeTrue();
    expect(within(menu).getByText("Terminal") !== null).toBeTrue();
  });

  test("bottom plus menu keeps Browser multi-tab and hides singleton Review tabs from either panel", async () => {
    const browserTab = makeSessionTab({
      id: "overview:alpha:browser",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
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
      rightLayout: makePanelLayout(["overview:alpha:db", browserTab.id, reviewTab.id], "overview:alpha:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    expect(within(menu).getByText("Browser") !== null).toBeTrue();
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

  test("right-panel shortcuts create tabs and ignore editable targets", async () => {
    const screen = renderWorkbench({
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
    startSideChatCalls = [];
    await act(async () => {
      fireEvent.keyDown(document, { key: "s", altKey: true, ctrlKey: true });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(String(startSideChatCalls.length)).toBe("1");
    expect(screen.getByRole("tab", { name: "Side chat" }) !== null).toBeTrue();

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
      fireEvent.click(screen.getByText("Review"));
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

  test("focusing an existing card tab from the DB tab preserves full-width right panel mode", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            tabs: [
              {
                id: "overview:alpha:db",
                sessionId: "overview:alpha",
                projectId: "alpha",
                kind: "db_view",
                title: "DB View",
                panelId: "right",
                config: { projectId: "alpha", view: "kanban" },
              },
              {
                id: "card-tab",
                sessionId: "overview:alpha",
                projectId: "alpha",
                kind: "card_stage",
                title: "Card One",
                panelId: "right",
                config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
              },
            ],
            rightLayout: makePanelLayout(["overview:alpha:db", "card-tab"], "overview:alpha:db"),
          }),
        ],
      },
    });
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
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBeFalse();
    expect(invokeCalls.some((call) => {
      const input = call[3] as { size?: { fullWidth?: boolean } } | undefined;
      return call[0] === "project-session-panels:update"
        && call[1] === "overview:alpha"
        && call[2] === "right"
        && input?.size?.fullWidth === false;
    })).toBeFalse();
    expect(screen.queryByRole("button", { name: "Restore panel width" }) !== null).toBeTrue();
  });

  test("opens cards from a split DB tab in the nearest right tab group", async () => {
    const rightLayout = splitProjectSessionPanelLeaf(
      makePanelLayout(["db-tab", "browser-tab"], "db-tab"),
      {
        leafId: "main",
        side: "right",
        tabId: "browser-tab",
        newLeafId: "leaf:browser",
        newBranchId: "branch:root",
      },
    );
    const panels = makePanels({
      rightTabIds: ["db-tab", "browser-tab"],
      rightActiveTabId: "db-tab",
      rightFullWidth: false,
    });
    renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            panels: {
              ...panels,
              right: {
                ...panels.right,
                layout: rightLayout,
              },
            },
            tabs: [
              {
                id: "db-tab",
                sessionId: "overview:alpha",
                projectId: "alpha",
                kind: "db_view",
                title: "DB View",
                panelId: "right",
                config: { projectId: "alpha", view: "kanban" },
              },
              {
                id: "browser-tab",
                sessionId: "overview:alpha",
                projectId: "alpha",
                kind: "browser",
                title: "Browser",
                panelId: "right",
                config: { projectId: "alpha" },
              },
            ],
          }),
        ],
      },
    });
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
        targetLeafId: "leaf:browser",
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
      rightLayout: makePanelLayout(["db-tab", "terminal-tab"], "db-tab"),
    });
    const screen = renderWorkbench({ sessionsByProject: { alpha: [session] } });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Terminal" }), { button: 0 });
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) => {
      if (call[0] !== "project-session-panels:activate") return false;
      const input = call[1] as { sessionId?: string; panelId?: string; tabId?: string };
      return input.sessionId === "session-1"
        && input.panelId === "bottom"
        && input.tabId === "terminal-tab";
    })).toBeTrue();
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
    const resizeStrip = screen.getByTestId("sidebar-resize-strip");
    expect(resizeStrip.getAttribute("role")).toBe("separator");
    expect(resizeStrip.getAttribute("aria-orientation")).toBe("vertical");
    expect(resizeStrip.className).toBe(
      "group absolute flex touch-none select-none z-20 -top-toolbar right-0 bottom-0 w-4 translate-x-2 cursor-col-resize active:cursor-col-resize",
    );
    expect(resizeStrip.firstElementChild?.className).toBe(
      "sidebar-resize-handle-line pointer-events-none m-auto opacity-0 h-full w-px bg-gradient-to-b from-transparent via-token-foreground/25 to-transparent group-hover:opacity-100 group-active:opacity-100",
    );
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

  test("clicking another project group header expands without switching session", async () => {
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
      rightLayout: makePanelLayout(["overview:beta:db"], "overview:beta:db"),
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

    expect(screen.setDbProjectCalls.includes("beta")).toBeFalse();
    expect(textContent(screen.container).includes("Beta Overview")).toBeTrue();
    expect(textContent(screen.container).includes("DB:beta:kanban")).toBeFalse();

    await act(async () => {
      fireEvent.click(screen.getByText("Beta Overview"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.setDbProjectCalls.includes("beta")).toBeTrue();
    expect(textContent(screen.container).includes("DB:beta:kanban")).toBeTrue();
  });

  test("clicking Hide sidebar suppresses immediate edge auto-reveal", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBeTrue();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await moveSidebarPointer(12);

    expect(screen.getByRole("button", { name: "Show sidebar" }) !== null).toBeTrue();
    expect(screen.container.querySelector('[data-sidebar-hover-trigger="true"]')).toBe(null);
    expect(screen.container.querySelector('[data-testid="app-shell-floating-left-panel"]')).toBe(null);
  });

  test("left sidebar resize closes through the Codex minimum-width threshold", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const resizeStrip = screen.getByTestId("sidebar-resize-strip");
    await act(async () => {
      fireEvent.pointerDown(resizeStrip, { button: 0, pointerId: 1, clientX: 300 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 200 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.getByRole("button", { name: "Show sidebar" }) !== null).toBeTrue();

    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 200 });
      await Promise.resolve();
    });
  });

  test("left sidebar resize normalizes pointer drag deltas by the Codex window zoom", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const workbenchRoot = screen.getByTestId("workbench-global-header").parentElement as HTMLElement | null;
    workbenchRoot?.style.setProperty("--codex-window-zoom", "2");
    const sidebar = screen.getByTestId("project-session-sidebar");
    const resizeStrip = screen.getByTestId("sidebar-resize-strip");

    await act(async () => {
      fireEvent.pointerDown(resizeStrip, { button: 0, pointerId: 1, clientX: 600 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 720 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(sidebar.getAttribute("style")?.includes("width: 360px")).toBeTrue();

    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 720 });
      await Promise.resolve();
    });
  });

  test("left sidebar resize double-click resets to the Codex default width", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 420 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.getByTestId("project-session-sidebar");
    const resizeStrip = screen.getByTestId("sidebar-resize-strip");

    await act(async () => {
      fireEvent.click(resizeStrip, { detail: 2 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(sidebar.getAttribute("style")?.includes("width: 300px")).toBeTrue();
  });

  test("collapsed sidebar renders Codex-parity left titlebar chrome on macOS", async () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    try {
      const screen = renderWorkbench({ sidebar: { collapsed: true, width: 300 } });
      await settleAsyncRender();
      await settleAsyncRender();

      expect(screen.container.querySelector('[data-testid="project-session-sidebar"]')).toBe(null);
      expect(screen.container.querySelector('[data-sidebar-hover-trigger="true"]')).toBe(null);
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]')).toBe(null);

      const globalHeader = screen.getByTestId("workbench-global-header");
      const leftSlot = getHeaderShellSlot(screen, "left");
      const collapseButton = within(leftSlot).getByRole("button", { name: "Show sidebar" });
      const backButton = within(leftSlot).getByRole("button", { name: "Back" });
      const forwardButton = within(leftSlot).getByRole("button", { name: "Forward" });
      const compactNewChatButton = within(leftSlot).getByRole("button", { name: "New chat" });
      const visibleLeftLabels = Array.from(leftSlot.querySelectorAll("button"))
        .map((button) => button.getAttribute("aria-label"))
        .join(",");

      expect(globalHeader.contains(leftSlot)).toBeTrue();
      expect(globalHeader.contains(collapseButton)).toBeTrue();
      expect(visibleLeftLabels).toBe("Show sidebar,Back,Forward,New chat");
      expect(leftSlot.className.includes("ps-[max(var(--spacing-token-safe-header-left),0.5rem)]")).toBeTrue();
      expect(leftSlot.getAttribute("style")?.includes("width: 0px")).toBeTrue();
      expect(leftSlot.getAttribute("style")?.includes("min-width: 208px")).toBeTrue();
      expect(collapseButton.parentElement?.className.includes("fixed")).toBeFalse();
      expect(collapseButton.getAttribute("title")).toBe("Toggle sidebar");
      expect(collapseButton.className).toBe(CODEX_COLLAPSED_CHROME_BUTTON_CLASS);
      expect(backButton.className).toBe(CODEX_COLLAPSED_CHROME_BUTTON_CLASS);
      expect(forwardButton.className).toBe(CODEX_COLLAPSED_CHROME_BUTTON_CLASS);
      expect(compactNewChatButton.className).toBe(CODEX_COLLAPSED_CHROME_BUTTON_CLASS);
      expect(backButton.hasAttribute("disabled")).toBeTrue();
      expect(forwardButton.hasAttribute("disabled")).toBeTrue();
      expect(backButton.querySelector("svg")?.getAttribute("class")?.includes("icon-xs")).toBeTrue();
      expect(forwardButton.querySelector("svg")?.getAttribute("class")?.includes("icon-xs -scale-x-100")).toBeTrue();
      expect(collapseButton.className.includes("h-token-button-composer")).toBeTrue();
      expect(backButton.className.includes("h-token-button-composer")).toBeTrue();
      expect(forwardButton.className.includes("h-token-button-composer")).toBeTrue();
      expect(compactNewChatButton.className.includes("h-token-button-composer")).toBeTrue();
      expect(collapseButton.className.includes("text-token-text-tertiary")).toBeTrue();
      expect(backButton.className.includes("text-token-text-tertiary")).toBeTrue();
      expect(forwardButton.className.includes("text-token-text-tertiary")).toBeTrue();
      expect(compactNewChatButton.className.includes("text-token-text-tertiary")).toBeTrue();
      expect(collapseButton.className.includes("enabled:hover:bg-token-list-hover-background")).toBeTrue();
      expect(backButton.className.includes("enabled:hover:bg-token-list-hover-background")).toBeTrue();
      expect(forwardButton.className.includes("enabled:hover:bg-token-list-hover-background")).toBeTrue();
      expect(compactNewChatButton.className.includes("enabled:hover:bg-token-list-hover-background")).toBeTrue();
      expect(collapseButton.className.includes("enabled:hover:bg-transparent")).toBeFalse();
      expect(backButton.className.includes("enabled:hover:bg-transparent")).toBeFalse();
      expect(forwardButton.className.includes("enabled:hover:bg-transparent")).toBeFalse();
      expect(compactNewChatButton.className.includes("enabled:hover:bg-transparent")).toBeFalse();
      expect(compactNewChatButton.querySelector("svg")?.getAttribute("class")?.includes("icon-sm")).toBeTrue();
      expect(compactNewChatButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_TITLEBAR_NEW_CHAT_ICON_PREFIX)).toBeTrue();
      expect(collapseButton.className.includes("no-drag")).toBeTrue();

      await moveSidebarPointer(12);

      const floatingShell = screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') as HTMLElement | null;
      const floatingAside = screen.container.querySelector('[data-testid="app-shell-floating-left-panel"]') as HTMLElement | null;
      const floatingHeader = floatingAside?.querySelector(".app-header-tint") as HTMLElement | null;
      expect(floatingShell !== null).toBeTrue();
      expect(floatingShell?.getAttribute("data-sidebar-floating-focus-area")).toBe("true");
      expect(floatingShell?.className).toBe(CODEX_SIDEBAR_FLOATING_OUTER_CLASS);
      expect(floatingShell?.getAttribute("style")?.includes("width: 300px")).toBeTrue();
      expect(floatingAside !== null).toBeTrue();
      expect(floatingAside?.className).toBe(`${CODEX_SIDEBAR_FLOATING_ASIDE_CLASS} font-sans text-sm`);
      expect(floatingHeader?.className).toBe(CODEX_SIDEBAR_FLOATING_HEADER_CLASS);
      expect(floatingAside?.className.includes("rounded-lg")).toBeTrue();
      expect(floatingAside?.className.includes("bg-token-main-surface-primary")).toBeTrue();
      expect(floatingAside?.className.includes("shadow-[1px_0_0_0_var(--color-token-border-default)")).toBeTrue();

      const floatingFocusButton = Array.from(floatingShell?.querySelectorAll("button") ?? [])
        .find((button) => !button.disabled) as HTMLButtonElement | undefined;
      if (!floatingFocusButton) throw new Error("Expected a focusable floating sidebar button");
      await act(async () => {
        floatingFocusButton.focus();
        await Promise.resolve();
      });
      await settleAsyncRender();

      await moveSidebarPointer(301);
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') !== null).toBeTrue();

      await act(async () => {
        floatingFocusButton.blur();
        await Promise.resolve();
      });
      await settleAsyncRender();
      await moveSidebarPointer(301);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
      await settleAsyncRender();

      expect(screen.container.querySelector('[data-testid="app-shell-floating-left-panel"]')).toBe(null);

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

  test("window navigation chrome restores prior and next active sessions", async () => {
    const overviewSession = makeSession();
    const workSession = makeSession({
      id: "session:alpha:work",
      title: "Work",
      isOverview: false,
      order: 1,
      tabs: [
        {
          id: "session:alpha:work:db",
          sessionId: "session:alpha:work",
          projectId: "alpha",
          kind: "db_view",
          title: "DB View",
          config: { projectId: "alpha", view: "list" },
        },
      ],
      rightLayout: makePanelLayout(["session:alpha:work:db"], "session:alpha:work:db"),
    });
    const screen = renderWorkbench({
      sidebar: { collapsed: false, width: 300 },
      sessionsByProject: { alpha: [overviewSession, workSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const leftSlot = getHeaderShellSlot(screen, "left");
    const backButton = within(leftSlot).getByRole("button", { name: "Back" });
    const forwardButton = within(leftSlot).getByRole("button", { name: "Forward" });

    expect(backButton.hasAttribute("disabled")).toBeTrue();
    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBeTrue();

    await act(async () => {
      fireEvent.click(screen.getByText("Work"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(backButton.hasAttribute("disabled")).toBeFalse();
    expect(forwardButton.hasAttribute("disabled")).toBeTrue();
    expect(textContent(screen.container).includes("DB:alpha:list")).toBeTrue();

    await act(async () => {
      fireEvent.click(backButton);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBeTrue();
    expect(backButton.hasAttribute("disabled")).toBeTrue();
    expect(forwardButton.hasAttribute("disabled")).toBeFalse();

    await act(async () => {
      fireEvent.click(forwardButton);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:list")).toBeTrue();
  });

  test("window navigation command requests use the same shell history path", async () => {
    const overviewSession = makeSession();
    const workSession = makeSession({
      id: "session:alpha:work",
      title: "Work",
      isOverview: false,
      order: 1,
      tabs: [
        {
          id: "session:alpha:work:db",
          sessionId: "session:alpha:work",
          projectId: "alpha",
          kind: "db_view",
          title: "DB View",
          config: { projectId: "alpha", view: "list" },
        },
      ],
      rightLayout: makePanelLayout(["session:alpha:work:db"], "session:alpha:work:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [overviewSession, workSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByText("Work"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      screen.requestWorkbenchNavigation("back", "command_palette");
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBeTrue();

    await act(async () => {
      screen.requestWorkbenchNavigation("forward", "menu");
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:list")).toBeTrue();
  });

  test("window navigation restores right-panel tab selection", async () => {
    const browserTab = makeSessionTab({
      id: "overview:alpha:browser",
      sessionId: "overview:alpha",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["overview:alpha:db", browserTab.id], "overview:alpha:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBeTrue();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.getByText("Browser is available in the desktop app") !== null).toBeTrue();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBeTrue();
  });

  test("window navigation restores right-panel collapsed state", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightCollapsed: false })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const toggleButton = screen.getByRole("button", { name: "Toggle side panel" });
    expect(screen.queryByTestId("session-right-panel") !== null).toBeTrue();
    expect(toggleButton.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fireEvent.click(toggleButton);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(toggleButton.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.queryByTestId("session-right-panel") !== null).toBeTrue();
    expect(toggleButton.getAttribute("aria-pressed")).toBe("true");
  });
});
