import { afterEach, beforeAll, beforeEach, describe, expect, vi, test } from "vitest";
import {
  Fragment,
  createElement,
  createRef,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import type {
  CodexAutomationInboxItem,
  CodexAutomationRunsInboxResponse,
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexHostMessage,
  CodexModelOption,
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationUpdateInput,
  CodexSidebarSyncResult,
  CodexSidebarThreadItem,
  GitReviewSource,
  Project,
  ProjectSession,
  ProjectSessionPanelNode,
  ProjectSessionTab,
  WorktreeEnvironmentOption,
} from "@/lib/types";
import { resetCardDetailStoreForTests } from "@/lib/card-detail-store";
import { getKanbanProjectStore } from "@/lib/kanban-store";
import { terminalSessionStore } from "@/lib/terminal-session-store";
import {
  APP_SHELL_FLOATING_LEFT_PANEL_LAYER_CLASS,
  APP_SHELL_GLOBAL_HEADER_LAYER_CLASS,
  APP_SHELL_RIGHT_PANEL_LAYER_CLASS,
} from "@/lib/app-shell-layers";
import {
  getDefaultDbViewPrefs,
  type DbViewPrefs,
  type SupportedDbView,
} from "@/lib/db-view-prefs";
import { useRetainedScrollPosition } from "@/lib/retained-scroll-position";
import type {
  SidebarCollapsibleSectionId,
  SidebarCollapsibleSectionsState,
  SidebarPinnedOrganizationMode,
} from "@/lib/use-workbench-state";
import { render, settleAsyncRender, textContent } from "../../test/dom";
import { TestQueryProvider } from "../../test/query";
import { COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY } from "@/lib/composer-enter-behavior";
import { THREAD_QUEUE_FOLLOW_UPS_STORAGE_KEY } from "@/lib/thread-composer-follow-up-mode";
import { useThreadHeaderPortalTarget } from "@/lib/thread-header-portal";
import {
  __getNodexToastSnapshotForTests,
  __resetNodexToastStoreForTests,
} from "@/components/ui/toast";
import {
  buildCommandPaletteCommands,
  executeCommandPaletteShellCommand,
  isCommandPaletteShellCommandId,
  type CommandPaletteShellCommandContext,
  type CommandPaletteShellCommandHandlers,
} from "@/lib/command-palette-commands";
import { normalizeCodexManualThreadTitle } from "../../../shared/codex-thread-title";
import type {
  WorkbenchNavigationCommandRequest,
  WorkbenchNavigationCommandState,
  WorkbenchNavigationCommandSource,
  WorkbenchNavigationDirection,
  WorkbenchPanelTabCloseCommandRequest,
  WorkbenchPanelTabCycleCommandRequest,
  WorkbenchPanelTabCycleDirection,
  WorkbenchSidebarToggleCommandSource,
} from "../../../shared/window-navigation";
import type { DatabaseViewSnapshotCommandResult } from "../../../shared/database-query";
import {
  findNearestProjectSessionPanelLeafToRight,
  insertProjectSessionPanelLeaf,
  makeProjectSessionPanelLayout,
  removeProjectSessionPanelTab,
  splitProjectSessionPanelLeaf,
} from "../../../shared/project-session-panel-layout";
import {
  WORKBENCH_AUTOMATION_CREATE_WITH_CHAT_PROMPT,
  WORKBENCH_AUTOMATION_FIRST_RUN_SUGGESTIONS,
} from "./workbench-automation-templates";

let invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;
let startThreadForSessionCalls: unknown[] = [];
let requestThreadStreamSnapshotCalls: string[] = [];
let requestThreadStreamSnapshotImpl: ((threadId: string) => Promise<unknown>) | null = null;
let hydrateBackgroundSubagentThreadsCalls: CodexBackgroundSubagentThreadsHydrateInput[] = [];
let removeQueuedFollowUpCalls: unknown[][] = [];
let reorderQueuedFollowUpsCalls: unknown[][] = [];
let sendQueuedFollowUpNowCalls: unknown[][] = [];
let editLastUserTurnCalls: unknown[][] = [];
let setComposerIntentCalls: unknown[][] = [];
let removePlanImplementationRequestCalls: unknown[][] = [];
let cleanBackgroundTerminalsCalls: string[] = [];
let listBackgroundTerminalsCalls: string[] = [];
let listBackgroundProcessesCalls: string[] = [];
let terminateBackgroundTerminalCalls: unknown[] = [];
let startSideChatCalls: unknown[] = [];
let discardSideChatCalls: string[] = [];
let sideChatConversations: Record<string, Record<string, unknown>> = {};
let mockThreadStartProgress: unknown = null;
let codexHostMessageListener: ((message: CodexHostMessage) => void) | null = null;
const CODEX_PANEL_VISIBLE_ICON_PREFIX = "M16.835 8.66301";
const CODEX_BOTTOM_PANEL_HIDDEN_ICON_PREFIX = "M13.334 12.2529";
const CODEX_EXPAND_PANEL_ICON_PREFIX = "M16.0299 3.0293";
const CODEX_RESTORE_PANEL_ICON_PREFIX = "M4.33496 11";
const CODEX_NEW_CHAT_ICON_PREFIX = "M2.6687 11.333";
const CODEX_TITLEBAR_NEW_CHAT_ICON_PREFIX = "M6.33325 1.88379";

type TerminalEventListenerMap = Record<string, (payload: unknown) => void>;

const DEFAULT_SIDEBAR_COLLAPSIBLE_SECTIONS: SidebarCollapsibleSectionsState = {
  pinned: false,
  projects: false,
  chats: false,
};

const DEFAULT_TEST_CODEX_MODELS: CodexModelOption[] = [
  {
    id: "gpt-5.5",
    model: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Default coding model",
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Balanced" },
      { reasoningEffort: "high", description: "Deep" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
  {
    id: "gpt-5.5-high",
    model: "gpt-5.5-high",
    displayName: "GPT-5.5 High",
    description: "High-only scheduled-task test model",
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Deep" }],
    defaultReasoningEffort: "high",
    isDefault: false,
  },
];

const mockCodexControl = {
  availableModels: DEFAULT_TEST_CODEX_MODELS,
  threadSettings: { model: "gpt-5.5", reasoningEffort: "medium" },
  reasoningEffortOptions: [{ reasoningEffort: "medium", description: "Balanced" }],
  permissionMode: "auto",
  loadModels: async () => undefined,
  loadThreads: async () => undefined,
  listCollaborationModes: async () => [{ name: "Plan", mode: "plan", model: null }],
  setThreadModel: () => undefined,
  setThreadReasoningEffort: () => undefined,
  setPermissionMode: async () => undefined,
  startThreadForSession: async (input: unknown) => {
    startThreadForSessionCalls.push(input);
    return { threadId: "thread-started" };
  },
  startSideChat: async (input: unknown) => {
    startSideChatCalls.push(input);
    const threadId = `side-thread-${startSideChatCalls.length}`;
    const conversation = {
      threadId,
      projectId: "alpha",
      source: {
        parentThreadId: "thread-alpha",
        sideConversation: true,
        sideConversationParentNavigationPath: "project:alpha/session:session:alpha:database-view/thread:thread-alpha",
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
    if (requestThreadStreamSnapshotImpl) {
      await requestThreadStreamSnapshotImpl(threadId);
    }
    return null;
  },
  markSubagentThreadOpened: async () => true,
  hydrateBackgroundSubagentThreads: async (input: CodexBackgroundSubagentThreadsHydrateInput) => {
    hydrateBackgroundSubagentThreadsCalls.push(input);
    return [];
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
  listBackgroundTerminals: async (threadId: string) => {
    listBackgroundTerminalsCalls.push(threadId);
    if (threadId !== "thread-alpha") return [];
    return [{
      itemId: "item-process",
      processId: "process-alpha",
      command: "bun run dev",
      cwd: "/Users/asc/repo/nodex",
      osPid: 4312,
      cpuPercent: 12.5,
      rssKb: 1536n,
    }];
  },
  listBackgroundProcesses: async (threadId: string) => {
    listBackgroundProcessesCalls.push(threadId);
    if (threadId !== "thread-alpha") return [];
    const terminal = {
      itemId: "item-process",
      processId: "process-alpha",
      command: "bun run dev",
      cwd: "/Users/asc/repo/nodex",
      osPid: 4312,
      cpuPercent: 12.5,
      rssKb: 1536n,
    };
    return [{
      id: "thread-alpha:item-process",
      threadId,
      threadTitle: "Thread alpha",
      itemId: terminal.itemId,
      turnId: "turn-process",
      command: terminal.command,
      cwd: terminal.cwd,
      processId: terminal.processId,
      osPid: terminal.osPid,
      terminalSessionId: null,
      source: "app-server",
      startedAtMs: 1,
      updatedAtMs: 2,
      status: "running",
      terminal,
      terminalSession: null,
    }];
  },
  runBackgroundProcess: async () => [],
  stopBackgroundProcess: async (input: { threadId: string; processId: string | null; terminalSessionId: string | null }) => {
    terminateBackgroundTerminalCalls.push(input);
    return true;
  },
  terminateBackgroundTerminal: async (input: unknown) => {
    terminateBackgroundTerminalCalls.push(input);
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

vi.mock("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
  subscribeBoardChanges: () => () => undefined,
  subscribeDatabaseChanges: () => () => undefined,
  subscribeCommandKeymapChanges: () => () => undefined,
  subscribeGitBranchChanges: () => () => undefined,
  subscribeProjectChanges: () => () => undefined,
  subscribeProjectSessionChanges: () => () => undefined,
  subscribeCodexHostMessages: (listener: (message: CodexHostMessage) => void) => {
    codexHostMessageListener = listener;
    return () => {
      if (codexHostMessageListener === listener) {
        codexHostMessageListener = null;
      }
    };
  },
  subscribeDesktopNotificationActions: () => () => undefined,
  subscribeCodexScheduledAutomationChanges: () => () => undefined,
  subscribeCodexAutomationRunsUpdates: () => () => undefined,
  subscribeAppUpdateStatus: () => () => undefined,
  getWindowFocusState: async () => true,
  subscribeWindowFocusChanges: () => () => undefined,
  readDatabaseManagement: async () => ({
    ok: false,
    error: { code: "not_found", message: "Not configured in this test." },
  }),
  mutateDatabase: async () => ({
    ok: false,
    error: { code: "not_found", message: "Not configured in this test." },
  }),
  readPrimaryDatabaseDescriptor: async (projectId: string) => {
    invokeCalls.push(["databases:primary:get", projectId]);
    const projectName = projectId === "beta" ? "Beta" : "Alpha";
    const databaseBlockId = `database:${projectId}:primary`;
    const databaseViewId = `database-view:${projectId}:primary-kanban`;
    return {
      ok: true,
      value: {
        version: 1,
        projectId,
        storeEpoch: "workbench-test-store",
        changeLogSeq: 1,
        value: {
          database: {
            blockId: databaseBlockId,
            projectId,
            name: "Tasks",
            isPrimary: true,
            schemaKey: "nodex.database",
            schemaRevision: 1,
            metadataRevision: 1,
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
          },
          properties: [],
          views: [{
            id: databaseViewId,
            databaseBlockId,
            projectId,
            name: projectName,
            kind: "kanban",
            config: {
              schemaKey: "nodex.database-view",
              schemaVersion: 1,
              filter: { kind: "group", operator: "and", children: [] },
              sort: [],
              group: null,
              display: { propertyIds: [], showTitle: true },
            },
            isPrimary: true,
            revision: 1,
            rankKey: "a",
            lifecycle: "active",
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
          }],
        },
      },
    };
  },
}));

vi.mock("./main-view-host", () => ({
  MainViewHost: (props: Record<string, unknown>) => {
    (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps = props;
    const [localSearch, setLocalSearch] = useState("");
    const projectId = String(props.projectId);
    const retainedScroll = useRetainedScrollPosition<HTMLDivElement>(
      typeof props.scrollStateKey === "string" ? props.scrollStateKey : null,
    );
    return createElement(
      "div",
      {
        "data-main-view-host": "true",
        "data-database-view-id": String(props.databaseViewId ?? ""),
      },
      `DB:${projectId}:${String(props.view)}`,
      createElement("input", {
        "aria-label": `Mock DB search ${projectId}`,
        value: localSearch,
        onInput: (event: { currentTarget: { value: string } }) => setLocalSearch(event.currentTarget.value),
      }),
      createElement(
        "div",
        {
          "data-testid": `mock-db-scroll-${projectId}`,
          ref: retainedScroll.ref,
          onScroll: retainedScroll.onScroll,
          style: { height: 40, width: 40, overflow: "auto" },
        },
        createElement("div", { style: { height: 400, width: 400 } }),
      ),
    );
  },
}));

const MockOwnedBlockDocumentBoundary = ({
  projectId,
  ownerBlockId,
  dependencies,
  children,
}: {
  projectId: string;
  ownerBlockId: string;
  dependencies?: {
    fetchDescriptor?: (
      projectId: string,
      ownerBlockId: string,
    ) => Promise<Record<string, unknown>>;
  };
  children: (
    model: Record<string, unknown>,
    controls: { reload: () => Promise<void> },
  ) => ReactNode;
}) => {
  const fetchDescriptor = dependencies?.fetchDescriptor;
  const [model, setModel] = useState<Record<string, unknown>>(() => {
    if (fetchDescriptor) {
      return { status: "legacy_shadow", projectId, ownerBlockId };
    }
    return {
      status: "ydoc_primary",
      projectId,
      ownerBlockId,
      descriptor: {
        projectId,
        ownerBlockId,
        ownerType: "card",
        ownerLifecycle: "active",
        documentId: `document:${ownerBlockId}`,
        storeEpoch: "workbench-test-store",
        generation: 1,
        headSeq: 1,
        schemaKey: "nodex.card",
        schemaVersion: 1,
        readiness: "ready",
        authority: "ydoc_primary",
        stateVector: new Uint8Array([0]),
      },
    };
  });
  const reload = async (): Promise<void> => {
    if (!fetchDescriptor) return;
    const descriptor = await fetchDescriptor(projectId, ownerBlockId);
    setModel({
      ...descriptor,
      status: descriptor.authority,
      projectId,
      ownerBlockId,
    });
  };
  useEffect(() => {
    void reload();
  }, [fetchDescriptor, ownerBlockId, projectId]);
  return children(model, { reload });
};

vi.mock("@/components/block-documents/owned-block-document-boundary", () => ({
  OwnedBlockDocumentBoundary: MockOwnedBlockDocumentBoundary,
  RegisteredOwnedBlockDocumentBoundary: MockOwnedBlockDocumentBoundary,
}));

vi.mock("./workbench-card-stage", () => ({
  CardStage: (props: Record<string, unknown>) => {
    (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps = props;
    const card = props.card as { id?: string } | null | undefined;
    const cardId = card?.id ?? "missing";
    const propsByCardId = ((globalThis as {
      __mockCardStagePropsByCardId?: Record<string, Record<string, unknown>>;
    }).__mockCardStagePropsByCardId ??= {});
    propsByCardId[cardId] = props;
    useEffect(() => {
      const state = globalThis as {
        __mockCardStageMounts?: number;
        __mockCardStageUnmounts?: number;
        __mockCardStageMountsByCardId?: Record<string, number>;
        __mockCardStageUnmountsByCardId?: Record<string, number>;
      };
      state.__mockCardStageMounts = (state.__mockCardStageMounts ?? 0) + 1;
      state.__mockCardStageMountsByCardId = {
        ...(state.__mockCardStageMountsByCardId ?? {}),
        [cardId]: (state.__mockCardStageMountsByCardId?.[cardId] ?? 0) + 1,
      };
      return () => {
        state.__mockCardStageUnmounts = (state.__mockCardStageUnmounts ?? 0) + 1;
        state.__mockCardStageUnmountsByCardId = {
          ...(state.__mockCardStageUnmountsByCardId ?? {}),
          [cardId]: (state.__mockCardStageUnmountsByCardId?.[cardId] ?? 0) + 1,
        };
      };
    }, [cardId]);
    return createElement(
      "div",
      { "data-card-stage": "true" },
      `Card:${String(cardId)}`,
      createElement(
        "div",
        { className: "nfm-editor" },
        createElement(
          "div",
          {
            "aria-label": `Mock editor ${String(cardId)}`,
            className: "ProseMirror",
            contentEditable: true,
            tabIndex: 0,
          },
        ),
      ),
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "Close",
          "data-app-shell-preview-pin-suppressed": "true",
          onClick: () => (props.onClose as (() => void) | undefined)?.(),
        },
        "Close",
      ),
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "History",
          "aria-pressed": Boolean(props.historyPanelActive),
          onClick: () => {
            const current = (globalThis as { __mockCardStageHistoryClicks?: number }).__mockCardStageHistoryClicks ?? 0;
            (globalThis as { __mockCardStageHistoryClicks?: number }).__mockCardStageHistoryClicks = current + 1;
            (props.onToggleHistoryPanel as (() => void) | undefined)?.();
          },
        },
        "History",
      ),
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "Terminal",
          onClick: () => {
            (props.onOpenTerminalPanel as (() => void) | undefined)?.();
          },
        },
        "Terminal",
      ),
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "Delete",
          "data-app-shell-preview-pin-suppressed": "true",
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

vi.mock("./plan-side-panel-tab", () => ({
  PlanSidePanelTab: (props: { content: string }) =>
    createElement("div", { "data-plan-side-panel-tab": "true" }, props.content),
}));

vi.mock("./workbench-history-panel", () => ({
  HistoryPanel: (props: Record<string, unknown>) => {
    (globalThis as { __lastHistoryPanelProps?: Record<string, unknown> }).__lastHistoryPanelProps = props;
    if (!props.open) return null;
    return createElement(
      "div",
      {
        "data-testid": "card-history-panel",
        "data-project-id": String(props.projectId),
        "data-card-id": String(props.cardId),
      },
      "History panel",
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "Close history panel",
          onClick: () => (props.onClose as (() => void) | undefined)?.(),
        },
        "Close",
      ),
      createElement(
        "button",
        {
          type: "button",
          "aria-label": "Mutate card from history",
          onClick: () => (props.onCardMutated as (() => void) | undefined)?.(),
        },
        "Mutate",
      ),
    );
  },
}));

vi.mock("./workbench-terminal-panel", () => ({
  TerminalPanel: (props: Record<string, unknown>) => {
    (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps = props;
    return createElement("div", { "data-terminal-panel": "true" }, `Terminal:${String(props.terminalId)}`);
  },
}));

vi.mock("@/features/local-conversation", () => ({
  useDefaultCodexAppServerManager: () => ({
    readProjectThreadSummaries: () => [],
    loadThreads: async () => [],
  }),
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
    const propsByThreadId = ((globalThis as {
      __mockConnectedThreadStagePropsByThreadId?: Record<string, Record<string, unknown>>;
    }).__mockConnectedThreadStagePropsByThreadId ??= {});
    const activeThreadId = typeof props.activeThreadId === "string" ? props.activeThreadId : null;
    if (activeThreadId) {
      propsByThreadId[activeThreadId] = props;
    }
    const headerPortalTarget = useThreadHeaderPortalTarget();
    const summary = props.activeThreadSummary as { threadName?: string | null; threadPreview?: string | null } | null | undefined;
    const threadTitle = summary?.threadName ?? summary?.threadPreview ?? (props.isNewThreadTab ? "New thread" : "No thread");
    const [mockPrompt, setMockPrompt] = useState("");
    const headerPortal = headerPortalTarget
      ? createPortal(
          createElement(
            "div",
            {
              className: "draggable grid w-full min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-4 electron:h-toolbar extension:py-row-y",
            },
            createElement(
              "div",
              { className: "flex min-w-0 items-center gap-2 truncate text-base electron:font-medium" },
              createElement(
                "span",
                { "data-testid": "thread-stage-title", className: "inline-flex max-w-[320px] min-w-[2ch] items-center overflow-hidden text-token-foreground" },
                createElement("span", { className: "min-w-0 truncate" }, threadTitle),
              ),
            ),
          ),
          headerPortalTarget,
        )
      : null;
    const actions = props.actions as {
      onOpenSummaryGitReview?: (input: { source: GitReviewSource }) => void | Promise<void>;
      onStartThreadForSession?: (input: {
        projectId: string;
        sessionId: string;
        prompt: string;
        runInTarget?: string;
        runInEnvironmentPath?: string | null;
        worktreeStartMode?: string;
        worktreeBranchPrefix?: string | null;
      }) => Promise<void>;
      onConsumeNewThreadComposerIntent?: (sessionId: string, focusNonce: number) => void;
    } | undefined;
    const target = props.newThreadTarget as {
      projectId?: string;
      sessionId?: string;
      runInTarget?: string;
      runInEnvironmentPath?: string | null;
      worktreeStartMode?: string;
      worktreeBranchPrefix?: string | null;
    } | null | undefined;
    const composerIntent = props.newThreadComposerIntent as {
      prompt?: string;
      focusNonce?: number;
    } | null | undefined;
    useEffect(() => {
      if (!props.isNewThreadTab || !target?.sessionId || !composerIntent?.prompt) return;
      setMockPrompt(composerIntent.prompt);
      if (typeof composerIntent.focusNonce === "number") {
        actions?.onConsumeNewThreadComposerIntent?.(target.sessionId, composerIntent.focusNonce);
      }
    }, [actions, composerIntent?.focusNonce, composerIntent?.prompt, props.isNewThreadTab, target?.sessionId]);
    return createElement(
      Fragment,
      null,
      headerPortal,
      createElement(
        "div",
        { "data-thread-stage": "true" },
        createElement("span", null, `Thread:${String(props.activeThreadId)}`),
        props.isNewThreadTab
          ? createElement("textarea", {
              "aria-label": "Prompt",
              placeholder: "Write the first prompt for this new thread...",
              readOnly: true,
              value: mockPrompt,
            })
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
        props.isNewThreadTab
          ? null
          : createElement("button", {
              type: "button",
              onClick: () => {
                void actions?.onOpenSummaryGitReview?.({ source: "staged" });
              },
            }, "Open staged changes"),
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
  useConversationSubset: (threadIds: readonly string[]) => Object.fromEntries(
    threadIds.flatMap((threadId) =>
      sideChatConversations[threadId] ? [[threadId, sideChatConversations[threadId]]] : []
    ),
  ),
  useCodexThreadStartProgress: () => mockThreadStartProgress,
  useLocalConversationAccount: () => null,
  useLocalConversationConnection: () => ({ status: "connected", retries: 0 }),
}));

vi.mock("@/lib/calendar-view-state", () => ({
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

vi.mock("@/lib/use-kanban", () => ({
  useKanban: (options?: { projectId?: string }) => {
    const projectId = options?.projectId ?? "alpha";
    const cards = projectId === "beta"
      ? {
          id: "card-beta",
          projectId: "beta",
          status: "in_progress",
          title: "Beta Card",
          description: "",
          tags: [],
          archived: false,
        }
      : [
          {
            id: "card-1",
            projectId: "alpha",
            status: "in_progress",
            title: "Card One",
            description: "",
            tags: [],
            archived: false,
          },
          {
            id: "card-2",
            projectId: "alpha",
            status: "in_progress",
            title: "Card Two",
            description: "",
            tags: [],
            archived: false,
          },
        ];
    const visibleCards = Array.isArray(cards) ? cards : [cards];
    return {
      board: {
        columns: [
          {
            id: "in_progress",
            name: "In Progress",
            cards: visibleCards,
          },
        ],
      },
      cardIndex: new Map(visibleCards.map((card) => [card.id, card])),
      loading: false,
      refresh: async () => undefined,
      patchCard: () => undefined,
      updateCard: async () => ({ didMutate: true }),
      deleteCard: async () => true,
      moveCard: async () => undefined,
      completeOccurrence: async () => undefined,
      skipOccurrence: async () => undefined,
    };
  },
}));

type MockCommandPaletteProps = {
  open: boolean;
  initialMode?: string;
  initialQuery?: string;
  commandContext: Omit<CommandPaletteShellCommandContext, "isMac" | "showMockCommands">;
  commandHandlers: CommandPaletteShellCommandHandlers;
  onOpenChange: (open: boolean) => void;
};

vi.mock("./workbench-shell-deps", () => ({
  CommandPalette: (props: MockCommandPaletteProps) => {
    if (!props.open) return null;
    const rawQuery = props.initialQuery ?? "";
    const commandMode = props.initialMode === "root";
    const commandQuery = commandMode ? rawQuery.trim().toLowerCase() : "";
    const commands = commandMode
      ? buildCommandPaletteCommands({ ...props.commandContext, isMac: true, showMockCommands: false })
        .filter((command) => {
          if (commandQuery.length === 0) return true;
          const haystack = [
            command.title,
            command.subtitle,
            ...command.keywords,
          ].join(" ").toLowerCase();
          return haystack.includes(commandQuery);
        })
        .slice(0, 100)
      : [];

    return createElement(
      "div",
      null,
      createElement("input", {
        "aria-label": "Command palette search",
        readOnly: true,
        value: props.initialMode ?? "root",
      }),
      ...commands.map((command) => createElement("button", {
        key: command.id,
        type: "button",
        disabled: command.disabled,
        onClick: () => {
          if (command.disabled) return;
          if (!isCommandPaletteShellCommandId(command.id)) return;
          executeCommandPaletteShellCommand(command.id, props.commandHandlers);
          props.onOpenChange(false);
        },
      }, command.title)),
      createElement("button", {
        type: "button",
        onClick: () => props.onOpenChange(false),
      }, "Close palette"),
    );
  },
}));

let WorkbenchShell: (typeof import("./workbench-shell"))["WorkbenchShell"];
let resolveCardStageSessionTabOrder: (typeof import("./workbench-shell"))["resolveCardStageSessionTabOrder"];
let shouldSynchronouslyRevealSession: (typeof import("./workbench-shell"))["shouldSynchronouslyRevealSession"];

beforeAll(async () => {
  const workbenchShellModule = await import("./workbench-shell");
  WorkbenchShell = workbenchShellModule.WorkbenchShell;
  resolveCardStageSessionTabOrder = workbenchShellModule.resolveCardStageSessionTabOrder;
  shouldSynchronouslyRevealSession = workbenchShellModule.shouldSynchronouslyRevealSession;
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

function makePrimaryDatabaseViewSnapshot(
  projectId: string,
  databaseViewId: string,
): DatabaseViewSnapshotCommandResult {
  const databaseBlockId = `database:${projectId}:primary`;
  const statusPropertyId = `database-property:${projectId}:status`;
  const timestamp = "2026-06-07T00:00:00.000Z";
  const database = {
    blockId: databaseBlockId,
    projectId,
    name: "Tasks",
    isPrimary: true,
    schemaKey: "nodex.database",
    schemaRevision: 1,
    metadataRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const statusProperty = {
    id: statusPropertyId,
    databaseBlockId,
    key: "status",
    name: "Status",
    valueType: "select" as const,
    config: {},
    rankKey: "a",
    lifecycle: "active" as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const view = {
    id: databaseViewId,
    databaseBlockId,
    projectId,
    name: "Primary board",
    kind: "kanban" as const,
    config: {
      schemaKey: "nodex.database-view" as const,
      schemaVersion: 1 as const,
      filter: { kind: "group" as const, operator: "and" as const, children: [] },
      sort: [{
        field: { kind: "manual" as const },
        direction: "asc" as const,
        nulls: "last" as const,
      }],
      group: { propertyId: statusPropertyId },
      display: { propertyIds: [statusPropertyId], showTitle: true },
    },
    isPrimary: true,
    revision: 1,
    rankKey: "a",
    lifecycle: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const wrap = <T,>(value: T) => ({
    version: 1 as const,
    projectId,
    storeEpoch: "workbench-test-store",
    changeLogSeq: 1,
    value,
  });

  return {
    ok: true,
    value: {
      descriptor: wrap({
        database,
        properties: [statusProperty],
        views: [view],
      }),
      query: wrap({
        database,
        properties: [statusProperty],
        view,
        rows: [],
      }),
    },
  };
}

function makeScheduledAutomation(
  overrides: Partial<CodexScheduledAutomation> = {},
): CodexScheduledAutomation {
  return {
    id: "automation-alpha",
    kind: "heartbeat",
    status: "ACTIVE",
    targetThreadId: "thread-alpha",
    name: "Alpha standup",
    prompt: "Check the alpha standup thread.",
    rrule: "FREQ=DAILY",
    model: null,
    reasoningEffort: null,
    cwds: [],
    executionEnvironment: "worktree",
    localEnvironmentConfigPath: null,
    nextRunAt: new Date("2026-06-08T09:00:00.000Z").getTime(),
    lastRunAt: null,
    createdAt: new Date("2026-06-07T00:00:00.000Z").getTime(),
    updatedAt: new Date("2026-06-07T00:00:00.000Z").getTime(),
    ...overrides,
  };
}

function makeAutomationInboxItem(
  overrides: Partial<CodexAutomationInboxItem> = {},
): CodexAutomationInboxItem {
  return {
    id: "run-alpha",
    automationId: "automation-alpha",
    automationName: "Alpha standup",
    title: "Alpha standup run",
    description: "Review the run.",
    archivedAssistantMessage: null,
    archivedUserMessage: null,
    archivedReason: null,
    sourceCwd: "/Users/asc/repo/nodex",
    threadId: "thread-run-alpha",
    readAt: null,
    createdAt: 10,
    status: "PENDING_REVIEW",
    ...overrides,
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
      mruTabIds: tabId && node.tabIds.includes(tabId)
        ? [tabId, ...node.mruTabIds.filter((id) => id !== tabId)]
        : node.mruTabIds,
    };
  }
  return {
    ...node,
    first: updatePanelLeafActiveTab(node.first, leafId, tabId),
    second: updatePanelLeafActiveTab(node.second, leafId, tabId),
  };
}

function appendTestPanelLeafTab(
  node: ProjectSessionPanelNode,
  leafId: string,
  tabId: string,
): ProjectSessionPanelNode {
  if (node.type === "leaf") {
    if (node.id !== leafId) return node;
    return {
      ...node,
      tabIds: [...node.tabIds.filter((id) => id !== tabId), tabId],
      activeTabId: tabId,
      mruTabIds: [tabId, ...node.mruTabIds.filter((id) => id !== tabId)],
    };
  }
  return {
    ...node,
    first: appendTestPanelLeafTab(node.first, leafId, tabId),
    second: appendTestPanelLeafTab(node.second, leafId, tabId),
  };
}

function appendTestPanelLayoutTab(
  layout: ProjectSession["panels"]["right"]["layout"],
  leafId: string,
  tabId: string,
): ProjectSession["panels"]["right"]["layout"] {
  return {
    ...layout,
    root: appendTestPanelLeafTab(layout.root, leafId, tabId),
    activeLeafId: leafId,
    mruLeafIds: [leafId, ...layout.mruLeafIds.filter((id) => id !== leafId)],
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

function getPanelTabById(container: HTMLElement, tabId: string): HTMLElement {
  const tabShell = Array.from(container.querySelectorAll<HTMLElement>("[data-panel-tab-id]"))
    .find((element) => element.dataset.panelTabId === tabId);
  const tab = tabShell?.querySelector<HTMLElement>('[role="tab"]') ?? null;
  if (!tab) throw new Error(`Expected panel tab ${tabId}`);
  return tab;
}

function getPanelTabChromeById(container: HTMLElement, tabId: string): HTMLElement {
  const tabShell = Array.from(container.querySelectorAll<HTMLElement>("[data-panel-tab-id]"))
    .find((element) => element.dataset.panelTabId === tabId);
  const tabChrome = tabShell?.querySelector<HTMLElement>("[data-tab-id]") ?? null;
  if (!tabChrome) throw new Error(`Expected panel tab chrome ${tabId}`);
  return tabChrome;
}

function getProjectSessionPanelActivateCalls(): {
  sessionId?: string;
  panelId?: ProjectSessionTab["panelId"];
  leafId?: string;
  tabId?: string | null;
}[] {
  return invokeCalls.flatMap((call) => {
    if (call[0] !== "project-session-panels:activate") return [];
    return [call[1] as {
      sessionId?: string;
      panelId?: ProjectSessionTab["panelId"];
      leafId?: string;
      tabId?: string | null;
    }];
  });
}

function getProjectSessionTabDeleteTabIds(): string[] {
  return invokeCalls.flatMap((call) => {
    if (call[0] !== "project-session-tabs:delete") return [];
    const input = call[1] as string | { tabId?: string };
    if (typeof input === "string") return [input];
    return input.tabId ? [input.tabId] : [];
  });
}

function getProjectSessionTabDeleteInputs(): Array<string | {
  tabId?: string;
  preferredActiveLeafId?: string | null;
  preferredActiveTabId?: string | null;
}> {
  return invokeCalls.flatMap((call) => {
    if (call[0] !== "project-session-tabs:delete") return [];
    return [call[1] as string | {
      tabId?: string;
      preferredActiveLeafId?: string | null;
      preferredActiveTabId?: string | null;
    }];
  });
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
  title?: string;
  threadId?: string;
  tabs?: SessionTabFixture[];
  rightCollapsed?: boolean;
  rightFullWidth?: boolean;
  rightLayout?: ProjectSession["panels"]["right"]["layout"];
};

function makeSessionTab(overrides: SessionTabFixture): ProjectSessionTab {
  const tab: ProjectSessionTab = {
    sessionId: "session:alpha:database-view",
    projectId: "alpha",
    panelId: "right",
    order: 0,
    stateKey: 0,
    state: {},
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
  if (
    tab.kind !== "db_view"
    || !("projectId" in tab.config)
    || ("databaseViewId" in tab.config && tab.config.databaseViewId)
  ) {
    return tab;
  }
  return {
    ...tab,
    config: {
      ...tab.config,
      databaseViewId: `database-view:${tab.config.projectId}:primary-kanban`,
    },
  };
}

function makeSession(overrides: SessionFixtureOverrides = {}): ProjectSession {
  const {
    rightCollapsed,
    rightFullWidth,
    rightLayout,
    tabs: rawTabs,
    title,
    ...sessionOverrides
  } = overrides;
  const projectId = overrides.projectId === undefined ? "alpha" : overrides.projectId;
  const sessionId = overrides.id ?? "session:alpha:database-view";
  const thread = sessionOverrides.thread ?? null;
  const noThreadFallbackTitle = sessionOverrides.noThreadFallbackTitle ?? title ?? "Database View";
  const displayTitle = sessionOverrides.displayTitle
    ?? title
    ?? thread?.threadName
    ?? thread?.threadPreview
    ?? noThreadFallbackTitle;
  const databaseViewStarter = thread === null && noThreadFallbackTitle === "Database View";
  const tabId = `${sessionId}:db`;
  const defaultTabs: SessionTabFixture[] = projectId === null ? [] : [
    makeSessionTab({
      id: tabId,
      sessionId,
      projectId,
      kind: "db_view",
      title: "DB View",
      config: { projectId, view: "kanban" },
    }),
  ];
  const tabs = (rawTabs ?? defaultTabs).map((tab, index) => makeSessionTab({
    sessionId,
    projectId: tab.projectId ?? projectId ?? "alpha",
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
    rightFullWidth: rightFullWidth ?? sessionOverrides.pinned ?? databaseViewStarter,
    bottomTabIds,
    bottomActiveTabId: bottomTabIds[0] ?? null,
    bottomCollapsed: bottomTabIds.length === 0,
  });
  return {
    id: sessionId,
    projectId,
    noThreadFallbackTitle,
    displayTitle,
    order: 0,
    leftPaneCollapsed: true,
    panels,
    thread,
    tabs,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...sessionOverrides,
    pinned: sessionOverrides.pinned ?? databaseViewStarter,
    pinnedOrder: sessionOverrides.pinnedOrder ?? (databaseViewStarter ? 0 : null),
    archived: sessionOverrides.archived ?? false,
    archivedAt: sessionOverrides.archivedAt ?? null,
    unread: sessionOverrides.unread ?? false,
  };
}

function makeAttachedSession(overrides: SessionFixtureOverrides = {}): ProjectSession {
  const { threadId = "thread-alpha", ...sessionOverrides } = overrides;
  return makeSession({
    leftPaneCollapsed: true,
    thread: {
      sessionId: overrides.id ?? "session:alpha:database-view",
      projectId: overrides.projectId === undefined ? "alpha" : overrides.projectId,
      threadId,
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
    ...sessionOverrides,
  });
}

function makeSidebarSnapshotItemForSession(session: ProjectSession): CodexSidebarThreadItem {
  if (!session.thread) throw new Error("Expected attached session");
  return {
    key: `local:${session.thread.threadId}`,
    kind: "local",
    hostId: "local",
    threadId: session.thread.threadId,
    sessionId: session.id,
    projectId: session.projectId,
    title: session.displayTitle,
    preview: session.thread.threadPreview,
    cwd: session.thread.cwd ?? null,
    updatedAt: session.thread.updatedAt,
    createdAt: session.thread.createdAt,
    pinned: session.pinned,
    pinnedOrder: session.pinnedOrder,
    unread: session.unread,
    archived: session.archived || session.thread.archived,
    statusType: "notLoaded",
    statusActiveFlags: [],
    projectless: session.projectId === null,
    disabled: false,
  };
}

function makeBlankSession(overrides: SessionFixtureOverrides = {}): ProjectSession {
  return makeSession({
    id: "session:alpha:blank",
    title: "New thread",
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
    const rank = (session: ProjectSession) => session.pinned ? 0 : 1;
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

function getSidebarSection(container: HTMLElement, heading: string): HTMLElement {
  const section = container.querySelector(`[data-app-action-sidebar-section-heading="${heading}"]`);
  if (!(section instanceof HTMLElement)) {
    throw new Error(`Expected sidebar section ${heading}`);
  }
  return section;
}

function getSidebarProjectGroup(section: HTMLElement, projectId: string): HTMLElement {
  const row = section.querySelector(`[data-app-action-sidebar-project-id="${projectId}"]`);
  const group = row?.closest('[role="listitem"]');
  if (!(group instanceof HTMLElement)) {
    throw new Error(`Expected sidebar project group ${projectId}`);
  }
  return group;
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

function appendMockNfmEditor(container: HTMLElement): { root: HTMLElement; content: HTMLElement } {
  const root = document.createElement("div");
  root.className = "nfm-editor";
  const content = document.createElement("div");
  content.contentEditable = "true";
  content.className = "ProseMirror";
  root.appendChild(content);
  container.appendChild(root);
  return { root, content };
}

function installReducedMotionMatchMediaForTest() {
  const originalMatchMedia = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  return () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  };
}

function renderWorkbench({
  projects = [makeProject()],
  sessionsByProject = { alpha: [makeSession()] },
  projectlessSessions = [],
  sidebarSnapshotItems = [],
  sidebarSyncChangedProjectIds = [],
  sidebarSyncProjectlessChanged = false,
  searchByProject = {},
  dbViewPrefsByProject = {},
  sidebar,
  initialActiveProjectSessionId = null,
  navigationCommandRequest = null,
  panelTabCycleRequest = null,
  panelTabCloseRequest = null,
  onNavigationStateChange,
  cardGetOverride = null,
  scheduledAutomations = [],
  automationInboxItems = [],
  worktreeEnvironmentOptionsByProject = {},
  codexModels = DEFAULT_TEST_CODEX_MODELS,
}: {
  projects?: Project[];
  sessionsByProject?: Record<string, ProjectSession[]>;
  projectlessSessions?: ProjectSession[];
  sidebarSnapshotItems?: CodexSidebarThreadItem[];
  sidebarSyncChangedProjectIds?: string[];
  sidebarSyncProjectlessChanged?: boolean;
  searchByProject?: Record<string, string>;
  dbViewPrefsByProject?: Record<string, Partial<Record<SupportedDbView, DbViewPrefs>>>;
  sidebar?: {
    collapsed: boolean;
    width: number;
    pinnedOrganizationMode?: SidebarPinnedOrganizationMode;
    collapsibleSections?: SidebarCollapsibleSectionsState;
  };
  initialActiveProjectSessionId?: string | null;
  navigationCommandRequest?: WorkbenchNavigationCommandRequest | null;
  panelTabCycleRequest?: WorkbenchPanelTabCycleCommandRequest | null;
  panelTabCloseRequest?: WorkbenchPanelTabCloseCommandRequest | null;
  onNavigationStateChange?: ComponentProps<typeof WorkbenchShell>["onNavigationStateChange"];
  cardGetOverride?: ((projectId: string, cardId: string) => Promise<unknown> | unknown) | null;
  scheduledAutomations?: CodexScheduledAutomation[];
  automationInboxItems?: CodexAutomationInboxItem[];
  worktreeEnvironmentOptionsByProject?: Record<string, WorktreeEnvironmentOption[]>;
  codexModels?: CodexModelOption[];
} = {}) {
  const projectlessSessionStateKey = "__projectless__";
  let sessionState = projectlessSessions.length > 0
    ? { ...sessionsByProject, [projectlessSessionStateKey]: projectlessSessions }
    : sessionsByProject;
  const runNowAutomationIds: string[] = [];
  const buildSidebarSnapshot = () => ({
    items: sidebarSnapshotItems,
    pinnedThreadIds: sidebarSnapshotItems.filter((item) => item.pinned).map((item) => item.threadId),
    projectAssignments: Object.fromEntries(
      sidebarSnapshotItems
        .filter((item): item is CodexSidebarThreadItem & { projectId: string } => typeof item.projectId === "string")
        .map((item) => [item.threadId, item.projectId]),
    ),
    projectlessThreadIds: sidebarSnapshotItems.filter((item) => item.projectless).map((item) => item.threadId),
    generatedAt: 1,
  });
  mockInvokeImpl = async (channel, ...args) => {
    if (channel === "project-sessions:list") {
      const projectId = args[0] === null ? projectlessSessionStateKey : String(args[0]);
      return (sessionState[projectId] ?? []).filter((session) => !session.archived);
    }
    if (channel === "project-sessions:list-summaries") {
      const projectId = args[0] === null ? projectlessSessionStateKey : String(args[0]);
      return (sessionState[projectId] ?? [])
        .filter((session) => !session.archived)
        .map((session) => ({
          id: session.id,
          projectId: session.projectId,
          noThreadFallbackTitle: session.noThreadFallbackTitle,
          displayTitle: session.displayTitle,
          order: session.order,
          pinned: session.pinned,
          pinnedOrder: session.pinnedOrder,
          archived: session.archived,
          archivedAt: session.archivedAt,
          unread: session.unread,
          leftPaneCollapsed: session.leftPaneCollapsed,
          thread: session.thread,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        }));
    }
    if (channel === "project-sessions:get") {
      const sessionId = String(args[0]);
      return Object.values(sessionState)
        .flat()
        .find((session) => session.id === sessionId) ?? null;
    }
    if (channel === "codex:sidebar:snapshot") {
      return buildSidebarSnapshot();
    }
    if (channel === "codex:sidebar:sync") {
      return {
        snapshot: buildSidebarSnapshot(),
        source: "app-server",
        refreshed: true,
        refreshedAt: 1,
        changedProjectIds: sidebarSyncChangedProjectIds,
        projectlessChanged: sidebarSyncProjectlessChanged,
        materializedSessionIds: [],
        failedThreadIds: [],
      } satisfies CodexSidebarSyncResult;
    }
    if (channel === "codex:scheduled-automations:list") {
      return { items: scheduledAutomations };
    }
    if (channel === "codex:automation-runs:inbox-items") {
      const unreadItems = automationInboxItems.filter((item) => item.readAt === null);
      return {
        items: automationInboxItems,
        unreadRunCounts: {
          total: unreadItems.length,
          automationIds: [...new Set(unreadItems.map((item) => item.automationId))],
          unreadRuns: unreadItems.map((item) => ({
            automationId: item.automationId,
            threadId: item.threadId,
          })),
        },
      } satisfies CodexAutomationRunsInboxResponse;
    }
    if (channel === "codex:model:list") {
      return codexModels;
    }
    if (channel === "codex:automation-runs:archive") {
      const threadId = String((args[0] as { threadId?: string } | undefined)?.threadId ?? "");
      let success = false;
      automationInboxItems = automationInboxItems.map((item) => {
        if (item.threadId !== threadId) return item;
        success = true;
        return {
          ...item,
          status: "ARCHIVED",
          readAt: item.readAt ?? 1_000,
          archivedReason: "manual",
        };
      });
      return { success };
    }
    if (channel === "codex:automation-runs:unarchive") {
      const threadId = String((args[0] as { threadId?: string } | undefined)?.threadId ?? "");
      let success = false;
      automationInboxItems = automationInboxItems.map((item) => {
        if (item.threadId !== threadId || item.status !== "ARCHIVED") return item;
        success = true;
        return {
          ...item,
          status: "ACCEPTED",
          readAt: item.readAt ?? 1_000,
          archivedReason: null,
        };
      });
      return { success };
    }
    if (channel === "codex:automation-runs:delete") {
      const threadId = String((args[0] as { threadId?: string } | undefined)?.threadId ?? "");
      const previousLength = automationInboxItems.length;
      automationInboxItems = automationInboxItems.filter((item) => item.threadId !== threadId);
      return { success: automationInboxItems.length !== previousLength };
    }
    if (channel === "codex:automation-runs:set-read-state") {
      const input = args[0] as { threadId?: string; readAt?: number | null };
      let updated: CodexAutomationInboxItem | null = null;
      automationInboxItems = automationInboxItems.map((item) => {
        if (item.threadId !== input.threadId) return item;
        updated = {
          ...item,
          readAt: input.readAt ?? null,
        };
        return updated;
      });
      return updated;
    }
    if (channel === "codex:scheduled-automations:run-now") {
      runNowAutomationIds.push(String((args[0] as { id?: string } | undefined)?.id ?? ""));
      return { success: true };
    }
    if (channel === "codex:scheduled-automations:create") {
      const input = args[0] as CodexScheduledAutomationCreateInput;
      const saved: CodexScheduledAutomation = {
        id: `automation-${scheduledAutomations.length + 1}`,
        kind: input.kind,
        status: "ACTIVE",
        targetThreadId: input.targetThreadId ?? null,
        name: input.name,
        prompt: input.prompt ?? "",
        rrule: input.rrule ?? null,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        cwds: input.cwds ?? [],
        executionEnvironment: input.executionEnvironment ?? "worktree",
        localEnvironmentConfigPath: input.localEnvironmentConfigPath ?? null,
        nextRunAt: null,
        lastRunAt: null,
        createdAt: 300,
        updatedAt: 400,
      };
      scheduledAutomations = [...scheduledAutomations, saved];
      return { item: saved };
    }
    if (channel === "codex:scheduled-automations:update") {
      const input = args[0] as CodexScheduledAutomationUpdateInput;
      const existing = scheduledAutomations.find((automation) => automation.id === input.id);
      const saved: CodexScheduledAutomation = {
        id: input.id,
        kind: input.kind,
        status: input.status,
        targetThreadId: input.targetThreadId ?? null,
        name: input.name,
        prompt: input.prompt ?? "",
        rrule: input.rrule ?? null,
        model: input.model ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        cwds: input.cwds ?? [],
        executionEnvironment: input.executionEnvironment ?? "worktree",
        localEnvironmentConfigPath: input.localEnvironmentConfigPath ?? null,
        nextRunAt: existing?.nextRunAt ?? null,
        lastRunAt: existing?.lastRunAt ?? null,
        createdAt: existing?.createdAt ?? 300,
        updatedAt: 400,
      };
      scheduledAutomations = scheduledAutomations.some((automation) => automation.id === saved.id)
        ? scheduledAutomations.map((automation) => (automation.id === saved.id ? saved : automation))
        : [...scheduledAutomations, saved];
      return { item: saved };
    }
    if (channel === "codex:scheduled-automations:delete") {
      const automationId = String((args[0] as { id?: string } | undefined)?.id ?? "");
      const item = scheduledAutomations.find((automation) => automation.id === automationId) ?? null;
      const previousLength = scheduledAutomations.length;
      scheduledAutomations = scheduledAutomations.filter((automation) => automation.id !== automationId);
      return {
        item,
        success: scheduledAutomations.length !== previousLength || item === null,
        status: item ? "deleted" : "not_found",
      };
    }
    if (channel === "codex:threads:pinned:list") {
      return Object.values(sessionState)
        .flat()
        .filter((session) => session.thread && session.pinned)
        .map((session) => session.thread?.threadId);
    }
    if (channel === "codex:thread:ensure-session") {
      const threadId = String(args[0]);
      const existing = Object.values(sessionState)
        .flat()
        .find((session) => session.thread?.threadId === threadId);
      if (existing) return existing;

      const projectId = "alpha";
      const projectSessions = sessionState[projectId] ?? [];
      const session = makeAttachedSession({
        id: `session:${projectId}:${threadId}`,
        projectId,
        threadId,
        title: "Mention target",
        order: projectSessions.length,
        rightCollapsed: true,
        tabs: [],
      });
      sessionState = {
        ...sessionState,
        [projectId]: sortProjectSessionsForTest([...projectSessions, session]),
      };
      return session;
    }
    if (channel === "codex:threads:pinned:set") {
      const threadId = String(args[0]);
      const input = (args[1] ?? {}) as { pinned?: boolean };
      const nextPinned = input.pinned === true;
      const projectSessions = Object.values(sessionState).flat();
      const nextPinnedOrder = nextPinned
        ? Math.max(-1, ...projectSessions.map((session) => session.pinnedOrder ?? -1)) + 1
        : null;
      sessionState = Object.fromEntries(
        Object.entries(sessionState).map(([projectId, sessions]) => [
          projectId,
          sortProjectSessionsForTest(sessions.map((session) =>
            session.thread?.threadId === threadId
              ? { ...session, pinned: nextPinned, pinnedOrder: nextPinnedOrder }
              : session
          )),
        ]),
      );
      return {
        items: [],
        pinnedThreadIds: Object.values(sessionState)
          .flat()
          .filter((session) => session.thread && session.pinned)
          .map((session) => session.thread?.threadId),
        projectAssignments: {},
        projectlessThreadIds: [],
        generatedAt: 1,
      };
    }
    if (channel === "database-views:snapshot") {
      return makePrimaryDatabaseViewSnapshot(
        String(args[0] ?? "alpha"),
        String(args[1] ?? "database-view:alpha:primary-kanban"),
      );
    }
    if (channel === "board:summary:get") {
      const projectId = String(args[0] ?? "alpha");
      if (projectId === "beta") {
        return {
          columns: [
            {
              id: "in_progress",
              name: "In Progress",
              cards: [
                {
                  id: "card-beta",
                  projectId: "beta",
                  status: "in_progress",
                  title: "Beta Card",
                  tags: [],
                  archived: false,
                  agentBlocked: false,
                  created: new Date("2026-06-07T00:00:00.000Z"),
                  order: 0,
                  revision: 1,
                  descriptionPreview: "",
                  descriptionLength: 0,
                  hasDescription: false,
                },
              ],
            },
          ],
        };
      }
      return {
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
                tags: [],
                archived: false,
                agentBlocked: false,
                created: new Date("2026-06-07T00:00:00.000Z"),
                order: 0,
                revision: 1,
                descriptionPreview: "",
                descriptionLength: 0,
                hasDescription: false,
              },
              {
                id: "card-2",
                projectId: "alpha",
                status: "in_progress",
                title: "Card Two",
                tags: [],
                archived: false,
                agentBlocked: false,
                created: new Date("2026-06-07T00:00:00.000Z"),
                order: 1,
                revision: 1,
                descriptionPreview: "",
                descriptionLength: 0,
                hasDescription: false,
              },
            ],
          },
        ],
      };
    }
    if (channel === "card:get") {
      const projectId = String(args[0] ?? "");
      const cardId = String(args[1] ?? "");
      if (cardGetOverride) {
        const overridden = cardGetOverride(projectId, cardId);
        if (overridden !== undefined) return overridden;
      }
      if (cardId === "card-beta") {
        return {
          id: "card-beta",
          projectId: "beta",
          status: "in_progress",
          title: "Beta Card",
          description: "",
          tags: [],
          archived: false,
          agentBlocked: false,
          created: new Date("2026-06-07T00:00:00.000Z"),
          order: 0,
          revision: 1,
        };
      }
      if (cardId === "card-2") {
        return {
          id: "card-2",
          projectId: "alpha",
          status: "in_progress",
          title: "Card Two",
          description: "",
          tags: [],
          archived: false,
          agentBlocked: false,
          created: new Date("2026-06-07T00:00:00.000Z"),
          order: 1,
          revision: 1,
        };
      }
      if (cardId !== "card-1") return null;
      return {
        id: "card-1",
        projectId: "alpha",
        status: "in_progress",
        title: "Card One",
        description: "",
        tags: [],
        archived: false,
        agentBlocked: false,
        created: new Date("2026-06-07T00:00:00.000Z"),
        order: 0,
        revision: 1,
      };
    }
    if (channel === "cards:details:get") {
      const input = (args[1] ?? {}) as { cardIds?: string[] };
      return (input.cardIds ?? []).flatMap((cardId) => (
        cardId === "card-beta"
          ? [{
              id: "card-beta",
              projectId: "beta",
              status: "in_progress",
              title: "Beta Card",
              description: "",
              tags: [],
              archived: false,
              agentBlocked: false,
              created: new Date("2026-06-07T00:00:00.000Z"),
              order: 0,
              revision: 1,
            }]
          : cardId === "card-2"
            ? [{
                id: "card-2",
                projectId: "alpha",
                status: "in_progress",
                title: "Card Two",
                description: "",
                tags: [],
                archived: false,
                agentBlocked: false,
                created: new Date("2026-06-07T00:00:00.000Z"),
                order: 1,
                revision: 1,
              }]
          : cardId === "card-1"
            ? [{
                id: "card-1",
                projectId: "alpha",
                status: "in_progress",
                title: "Card One",
              description: "",
              tags: [],
              archived: false,
              agentBlocked: false,
              created: new Date("2026-06-07T00:00:00.000Z"),
              order: 0,
              revision: 1,
            }]
          : []
      ));
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
    if (channel === "project-sessions:rename") {
      const sessionId = String(args[0]);
      const input = (args[1] ?? {}) as { title?: string };
      const session = Object.values(sessionState).flat().find((item) => item.id === sessionId);
      if (!session) return null;
      const nextTitle = normalizeCodexManualThreadTitle(input.title ?? "");
      if (!nextTitle) return session;
      const updated = session.thread
        ? {
            ...session,
            displayTitle: nextTitle,
            thread: {
              ...session.thread,
              threadName: nextTitle,
            },
          }
        : {
            ...session,
            noThreadFallbackTitle: nextTitle,
            displayTitle: nextTitle,
          };
      sessionState = replaceSession(sessionState, updated);
      return updated;
    }
    if (channel === "project-sessions:set-pinned") {
      const sessionId = String(args[0]);
      const input = (args[1] ?? {}) as { pinned?: boolean };
      const session = Object.values(sessionState).flat().find((item) => item.id === sessionId);
      if (!session) return null;
      if (session.projectId === null) return null;
      const projectId = session.projectId;
      const projectSessions = sessionState[projectId] ?? [];
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
        [projectId]: sortProjectSessionsForTest(
          projectSessions.map((item) => item.id === updated.id ? updated : item),
        ),
      };
      return updated;
    }
    if (channel === "project-sessions:archive") {
      const sessionId = String(args[0]);
      const session = Object.values(sessionState).flat().find((item) => item.id === sessionId);
      if (!session) return null;
      const updated = {
        ...session,
        archived: true,
        archivedAt: "2026-06-07T00:00:00.000Z",
        pinned: false,
        pinnedOrder: null,
        unread: false,
        thread: session.thread
          ? { ...session.thread, archived: true }
          : session.thread,
      };
      sessionState = replaceSession(sessionState, updated);
      return updated;
    }
    if (channel === "codex:thread:archive") {
      const threadId = String(args[0]);
      sessionState = Object.fromEntries(
        Object.entries(sessionState).map(([projectId, sessions]) => [
          projectId,
          sessions.map((session) => (
            session.thread?.threadId === threadId
              ? {
                  ...session,
                  archived: true,
                  archivedAt: "2026-06-07T00:00:00.000Z",
                  pinned: false,
                  pinnedOrder: null,
                  unread: false,
                  thread: { ...session.thread, archived: true },
                }
              : session
          )),
        ]),
      );
      return true;
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
    if (channel === "project-session-panels:ensure-right-leaf") {
      const input = (args[0] ?? {}) as {
        sessionId: string;
        panelId: ProjectSessionTab["panelId"];
        sourceLeafId: string;
      };
      const session = Object.values(sessionState).flat().find((item) => item.id === input.sessionId);
      if (!session) return null;
      const panel = session.panels[input.panelId];
      const existingLeafId = findNearestProjectSessionPanelLeafToRight(panel.layout, input.sourceLeafId);
      if (existingLeafId) {
        return { session, leafId: existingLeafId, created: false };
      }

      const leafId = `leaf:auto-right:${invokeCalls.length}`;
      const layout = insertProjectSessionPanelLeaf(panel.layout, {
        leafId: input.sourceLeafId,
        side: "right",
        newLeafId: leafId,
        newBranchId: `branch:auto-right:${invokeCalls.length}`,
      });
      const updated = {
        ...session,
        panels: {
          ...session.panels,
          [input.panelId]: {
            ...panel,
            collapsed: false,
            layout,
          },
        },
      };
      sessionState = replaceSession(sessionState, updated);
      return { session: updated, leafId, created: true };
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
      const input = (args[0] ?? {}) as { projectId: string; noThreadFallbackTitle?: string };
      const existingSessions = sessionState[input.projectId] ?? [];
      const insertOrder = 0;
      const shiftedSessions = existingSessions.map((session) => (
        session.order >= insertOrder
          ? { ...session, order: session.order + 1 }
          : session
      ));
      const session = makeSession({
        id: `session:${input.projectId}:created`,
        projectId: input.projectId,
        noThreadFallbackTitle: input.noThreadFallbackTitle ?? "New thread",
        displayTitle: input.noThreadFallbackTitle ?? "New thread",
        order: insertOrder,
        thread: null,
        tabs: [],
        panels: makePanels({ rightCollapsed: true }),
      });
      sessionState = {
        ...sessionState,
        [input.projectId]: sortProjectSessionsForTest([...shiftedSessions, session]),
      };
      return session;
    }
    if (channel === "project-session-tabs:create") {
      const input = (args[0] ?? {}) as {
        sessionId: string;
        projectId: string;
        panelId?: ProjectSessionTab["panelId"];
        targetLeafId?: string;
        clientTabId?: string;
        kind: ProjectSession["tabs"][number]["kind"];
        title: string;
        config: ProjectSession["tabs"][number]["config"];
      };
      const session = Object.values(sessionState).flat().find((item) => item.id === input.sessionId);
      if (!session) return null;
      if (input.kind === "review") {
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
      if (input.kind === "db_view" && "projectId" in input.config) {
        const existing = session.tabs.find((tab) =>
          tab.kind === "db_view"
          && "projectId" in tab.config
          && tab.config.projectId === input.config.projectId
        );
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
      if (input.clientTabId && session.tabs.some((tab) => tab.id === input.clientTabId)) {
        throw new Error(`Project session tab id already exists: ${input.clientTabId}`);
      }
      const tab = {
        id: input.clientTabId ?? `created-tab-${session.tabs.length + 1}`,
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
      const targetLeafId = input.targetLeafId ?? session.panels[panelId].layout.activeLeafId ?? firstPanelLeafId(session.panels[panelId].layout.root);
      sessionState = replaceSession(sessionState, {
        ...session,
        tabs,
        panels: {
          ...session.panels,
          [panelId]: {
            ...session.panels[panelId],
            collapsed: false,
            layout: appendTestPanelLayoutTab(session.panels[panelId].layout, targetLeafId, tab.id),
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
    if (channel === "project-session-tabs:delete") {
      const rawInput = args[0] as string | {
        tabId?: string;
        preferredActiveLeafId?: string | null;
        preferredActiveTabId?: string | null;
      };
      const tabId = typeof rawInput === "string" ? rawInput : rawInput.tabId ?? "";
      const session = Object.values(sessionState)
        .flat()
        .find((item) => item.tabs.some((tab) => tab.id === tabId));
      if (!session) return null;

      const deletedTab = session.tabs.find((tab) => tab.id === tabId);
      const updatedTabs = session.tabs.filter((tab) => tab.id !== tabId);
      const preferredActiveLeafId = typeof rawInput === "string" ? undefined : rawInput.preferredActiveLeafId;
      const preferredActiveTabId = typeof rawInput === "string" ? undefined : rawInput.preferredActiveTabId;
      sessionState = replaceSession(sessionState, {
        ...session,
        tabs: updatedTabs,
        panels: {
          right: {
            ...session.panels.right,
            layout: deletedTab?.panelId === "right"
              ? removeProjectSessionPanelTab(session.panels.right.layout, tabId, {
                preferredActiveLeafId,
                preferredActiveTabId,
              })
              : session.panels.right.layout,
          },
          bottom: {
            ...session.panels.bottom,
            layout: deletedTab?.panelId === "bottom"
              ? removeProjectSessionPanelTab(session.panels.bottom.layout, tabId, {
                preferredActiveLeafId,
                preferredActiveTabId,
              })
              : session.panels.bottom.layout,
          },
        },
      });
      return true;
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
      const projectId = String(args[0] ?? "");
      return worktreeEnvironmentOptionsByProject[projectId] ?? [];
    }
    if (channel === "workspace:pick-directory") {
      return "/repo/selected";
    }
    if (channel === "workspace-directory-entries") {
      const input = (args[0] ?? {}) as { hostId?: string; workspaceRoot?: string; path?: string };
      return {
        hostId: input.hostId ?? "local",
        workspaceRoot: input.workspaceRoot ?? "",
        path: input.path ?? input.workspaceRoot ?? "",
        entries: [],
      };
    }
    if (channel === "read-file-metadata") {
      const input = (args[0] ?? {}) as { path?: string };
      return {
        path: input.path ?? "",
        kind: "file",
        isDirectory: false,
        isFile: true,
        isSymlink: false,
        size: 12,
        createdAtMs: 1,
        modifiedAtMs: 1,
        binary: false,
        mimeType: "text/markdown",
      };
    }
    if (channel === "read-file") {
      const input = (args[0] ?? {}) as { path?: string };
      return {
        path: input.path ?? "",
        content: "# Preview\n",
        encoding: "utf8",
        size: 10,
        truncated: false,
        binary: false,
      };
    }
    if (channel === "shell:open-file-link") {
      return true;
    }
    return null;
  };

  const setDbProjectCalls: string[] = [];
  const pinnedOrganizationModeChanges: SidebarPinnedOrganizationMode[] = [];
  const navigationStateChanges: WorkbenchNavigationCommandState[] = [];
  let requestWorkbenchNavigation: (
    direction: WorkbenchNavigationDirection,
    source?: WorkbenchNavigationCommandSource,
  ) => void = () => undefined;
  let requestPanelTabCycle: (
    direction: WorkbenchPanelTabCycleDirection,
  ) => void = () => undefined;
  let requestPanelTabClose: () => void = () => undefined;
  let requestSidebarToggle: (source: WorkbenchSidebarToggleCommandSource) => void = () => undefined;
  let openCommandPalette: (mode?: "root" | "chats" | "cards" | "files", initialQuery?: string) => void = () => undefined;
  type TestSidebarState = NonNullable<ComponentProps<typeof WorkbenchShell>["sidebar"]>;

  function WorkbenchShellTestHarness() {
    const [dbProjectId, setDbProjectId] = useState(projects[0]?.id ?? "alpha");
    const [sidebarState, setSidebarState] = useState<TestSidebarState>(() => ({
      collapsed: false,
      width: 300,
      ...sidebar,
      collapsibleSections: {
        ...DEFAULT_SIDEBAR_COLLAPSIBLE_SECTIONS,
        ...sidebar?.collapsibleSections,
      },
    }));
    const sidebarToggleHandlerRef = useRef<((source: WorkbenchSidebarToggleCommandSource) => void) | null>(null);
    const [currentNavigationCommandRequest, setCurrentNavigationCommandRequest] =
      useState<WorkbenchNavigationCommandRequest | null>(navigationCommandRequest);
    const [currentPanelTabCycleRequest, setCurrentPanelTabCycleRequest] =
      useState<WorkbenchPanelTabCycleCommandRequest | null>(panelTabCycleRequest);
    const [currentPanelTabCloseRequest, setCurrentPanelTabCloseRequest] =
      useState<WorkbenchPanelTabCloseCommandRequest | null>(panelTabCloseRequest);
    const [commandPaletteRequest, setCommandPaletteRequest] = useState({
      tick: 0,
      mode: "root" as "root" | "chats" | "cards" | "files",
      initialQuery: "",
    });
    requestWorkbenchNavigation = (direction, source = direction === "back" ? "sidebar_back" : "sidebar_forward") => {
      setCurrentNavigationCommandRequest((current) => ({
        tick: (current?.tick ?? 0) + 1,
        direction,
        source,
      }));
    };
    requestPanelTabCycle = (direction) => {
      setCurrentPanelTabCycleRequest((current) => ({
        tick: (current?.tick ?? 0) + 1,
        direction,
        source: "menu",
      }));
    };
    requestPanelTabClose = () => {
      setCurrentPanelTabCloseRequest((current) => ({
        tick: (current?.tick ?? 0) + 1,
        source: "menu",
      }));
    };
    requestSidebarToggle = (source) => {
      sidebarToggleHandlerRef.current?.(source);
    };
    openCommandPalette = (mode = "root", initialQuery = "") => {
      setCommandPaletteRequest((current) => ({
        tick: current.tick + 1,
        mode,
        initialQuery,
      }));
    };
    return (
      <WorkbenchShell
        projects={projects}
        dbProjectId={dbProjectId}
        initialActiveProjectSessionId={initialActiveProjectSessionId}
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
        commandPaletteOpenTick={commandPaletteRequest.tick}
        commandPaletteInitialMode={commandPaletteRequest.mode}
        commandPaletteInitialQuery={commandPaletteRequest.initialQuery}
        setSidebarCollapsed={(collapsed) => {
          setSidebarState((current) => ({ ...current, collapsed }));
        }}
        setSidebarWidth={(width) => {
          setSidebarState((current) => ({ ...current, width }));
        }}
        setSidebarPinnedOrganizationMode={(mode) => {
          pinnedOrganizationModeChanges.push(mode);
          setSidebarState((current) => ({ ...current, pinnedOrganizationMode: mode }));
        }}
        setSidebarCollapsibleSectionCollapsed={(sectionId: SidebarCollapsibleSectionId, collapsed: boolean) => {
          setSidebarState((current) => ({
            ...current,
            collapsibleSections: {
              ...DEFAULT_SIDEBAR_COLLAPSIBLE_SECTIONS,
              ...current.collapsibleSections,
              [sectionId]: collapsed,
            },
          }));
        }}
        onRegisterSidebarToggleHandler={(handler) => {
          sidebarToggleHandlerRef.current = handler;
          return () => {
            if (sidebarToggleHandlerRef.current !== handler) return;
            sidebarToggleHandlerRef.current = null;
          };
        }}
        navigationCommandRequest={currentNavigationCommandRequest}
        panelTabCycleRequest={currentPanelTabCycleRequest}
        panelTabCloseRequest={currentPanelTabCloseRequest}
        onNavigationStateChange={(state) => {
          navigationStateChanges.push(state);
          onNavigationStateChange?.(state);
        }}
      />
    );
  }

  const result = render(
    <TestQueryProvider>
      <WorkbenchShellTestHarness />
    </TestQueryProvider>,
  );
  return {
    ...result,
    setDbProjectCalls,
    pinnedOrganizationModeChanges,
    navigationStateChanges,
    openCommandPalette: (mode?: "root" | "chats" | "cards" | "files", initialQuery?: string) => {
      openCommandPalette(mode, initialQuery);
    },
    requestWorkbenchNavigation: (
      direction: WorkbenchNavigationDirection,
      source?: WorkbenchNavigationCommandSource,
    ) => {
      requestWorkbenchNavigation(direction, source);
    },
    requestPanelTabCycle: (direction: WorkbenchPanelTabCycleDirection) => {
      requestPanelTabCycle(direction);
    },
    requestPanelTabClose: () => {
      requestPanelTabClose();
    },
    requestSidebarToggle: (source: WorkbenchSidebarToggleCommandSource) => {
      requestSidebarToggle(source);
    },
    getScheduledAutomations: () => scheduledAutomations,
    getRunNowAutomationIds: () => runNowAutomationIds,
    getAutomationInboxItems: () => automationInboxItems,
  };
}

function installTerminalEventApiMock(): TerminalEventListenerMap {
  const listeners: TerminalEventListenerMap = {};
  window.api = {
    invoke: async () => undefined,
    on: (event: string, callback: (...args: unknown[]) => void) => {
      listeners[event] = (payload: unknown) => callback(payload);
      return () => {
        delete listeners[event];
      };
    },
  } as typeof window.api;
  return listeners;
}

beforeEach(() => {
  terminalSessionStore.disposeEventSubscriptions();
  resetCardDetailStoreForTests();
  __resetNodexToastStoreForTests();
  document.body.removeAttribute("style");
  delete (window as { api?: typeof window.api }).api;
  invokeCalls = [];
  startThreadForSessionCalls = [];
  requestThreadStreamSnapshotCalls = [];
  requestThreadStreamSnapshotImpl = null;
  hydrateBackgroundSubagentThreadsCalls = [];
  removeQueuedFollowUpCalls = [];
  reorderQueuedFollowUpsCalls = [];
  sendQueuedFollowUpNowCalls = [];
  editLastUserTurnCalls = [];
  setComposerIntentCalls = [];
  removePlanImplementationRequestCalls = [];
  cleanBackgroundTerminalsCalls = [];
  listBackgroundTerminalsCalls = [];
  listBackgroundProcessesCalls = [];
  terminateBackgroundTerminalCalls = [];
  startSideChatCalls = [];
  discardSideChatCalls = [];
  sideChatConversations = {};
  mockThreadStartProgress = null;
  codexHostMessageListener = null;
  mockInvokeImpl = null;
  setWindowInnerWidthForTest(1024);
  localStorage.clear();
  sessionStorage.clear();
  delete (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
  delete (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
  delete (globalThis as {
    __mockConnectedThreadStagePropsByThreadId?: Record<string, Record<string, unknown>>;
  }).__mockConnectedThreadStagePropsByThreadId;
  delete (globalThis as { __lastTerminalPanelProps?: Record<string, unknown> }).__lastTerminalPanelProps;
  delete (globalThis as { __lastHistoryPanelProps?: Record<string, unknown> }).__lastHistoryPanelProps;
  delete (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
  delete (globalThis as { __mockCardStagePropsByCardId?: Record<string, Record<string, unknown>> }).__mockCardStagePropsByCardId;
  delete (globalThis as { __mockCardStageHistoryClicks?: number }).__mockCardStageHistoryClicks;
  delete (globalThis as { __mockCardStageDeleteClicks?: number }).__mockCardStageDeleteClicks;
  delete (globalThis as { __mockCardStageMounts?: number }).__mockCardStageMounts;
  delete (globalThis as { __mockCardStageUnmounts?: number }).__mockCardStageUnmounts;
  delete (globalThis as { __mockCardStageMountsByCardId?: Record<string, number> }).__mockCardStageMountsByCardId;
  delete (globalThis as { __mockCardStageUnmountsByCardId?: Record<string, number> }).__mockCardStageUnmountsByCardId;
});

afterEach(() => {
  terminalSessionStore.disposeEventSubscriptions();
});

async function openBottomPanel(screen: ReturnType<typeof renderWorkbench>): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Toggle bottom panel" }));
    await Promise.resolve();
  });
  await settleAsyncRender();
}

async function executeCommandPaletteCommand(
  screen: ReturnType<typeof renderWorkbench>,
  query: string,
  label: string,
): Promise<void> {
  await act(async () => {
    screen.openCommandPalette("root", query);
    await Promise.resolve();
  });
  await settleAsyncRender();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
    await Promise.resolve();
  });
  await settleAsyncRender();
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

async function releasePointerDrag(pointerId = 1): Promise<void> {
  await act(async () => {
    fireEvent.pointerUp(window, { pointerId });
    await Promise.resolve();
  });
  await settleAsyncRender();
}

async function openPanelMenu(
  screen: ReturnType<typeof renderWorkbench>,
  label: "Open side panel tab" | "Open bottom panel tab",
): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole("button", { name: label }), { button: 0 });
    await Promise.resolve();
  });
  await settleAsyncRender();
  await waitFor(() => {
    expect(screen.queryByRole("menu") !== null).toBe(true);
  });
  return screen.getByRole("menu");
}

async function clickMenuItem(menu: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(menu).getByText(label));
    await Promise.resolve();
  });
  await settleAsyncRender();
}

async function pointerDownAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(element, { button: 0 });
    await Promise.resolve();
  });
  await settleAsyncRender();
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
    expect(textContent(menu).includes(description)).toBe(false);
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

function installSessionContentMeasurementForTest({
  width,
  height,
}: {
  width: number;
  height: number;
}): {
  flushResizeObservers: () => void;
  restore: () => void;
} {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const originalResizeObserver = globalThis.ResizeObserver;
  const observers = new Set<{
    callback: ResizeObserverCallback;
    instance: ResizeObserver;
    targets: Set<Element>;
  }>();
  const makeRect = (targetWidth: number, targetHeight: number): DOMRect => ({
    x: 0,
    y: 0,
    width: targetWidth,
    height: targetHeight,
    top: 0,
    right: targetWidth,
    bottom: targetHeight,
    left: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  const isMeasuredSessionContent = (element: Element): boolean =>
    element instanceof HTMLElement
    && element.querySelector('[data-testid="session-thread-page"]') !== null
    && element.querySelector('[data-testid="session-right-panel"]') !== null;

  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (!isMeasuredSessionContent(this)) {
        return originalGetBoundingClientRect.call(this);
      }
      return this.isConnected ? makeRect(width, height) : makeRect(0, 0);
    },
  });

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class ResizeObserver {
      private readonly observerRecord: {
        callback: ResizeObserverCallback;
        instance: ResizeObserver;
        targets: Set<Element>;
      };

      constructor(callback: ResizeObserverCallback) {
        this.observerRecord = {
          callback,
          instance: this as ResizeObserver,
          targets: new Set(),
        };
        observers.add(this.observerRecord);
      }

      observe(target: Element) {
        this.observerRecord.targets.add(target);
      }

      unobserve(target: Element) {
        this.observerRecord.targets.delete(target);
      }

      disconnect() {
        this.observerRecord.targets.clear();
        observers.delete(this.observerRecord);
      }
    } as typeof ResizeObserver,
  });

  return {
    flushResizeObservers: () => {
      for (const observer of observers) {
        const entries = [...observer.targets].map((target) => ({
          target,
          contentRect: target.getBoundingClientRect(),
        }) as ResizeObserverEntry);
        if (entries.length === 0) continue;
        observer.callback(entries, observer.instance);
      }
    },
    restore: () => {
      observers.clear();
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        writable: true,
        value: originalGetBoundingClientRect,
      });
      if (typeof originalResizeObserver === "undefined") {
        Reflect.deleteProperty(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }, "ResizeObserver");
        return;
      }
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        writable: true,
        value: originalResizeObserver,
      });
    },
  };
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

function getRetainedSessionIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-retained-session-id]"))
    .map((element) => element.getAttribute("data-retained-session-id") ?? "");
}

function getActiveRetainedSessionRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-retained-session-active="true"]');
  if (!root) throw new Error("Expected an active retained session root");
  return root;
}

async function selectSidebarSession(container: HTMLElement, title: string): Promise<void> {
  await act(async () => {
    fireEvent.click(getThreadRow(container, title));
    await Promise.resolve();
  });
  await settleAsyncRender();
  await settleAsyncRender();
}

function getConnectedThreadStagePropsByThreadId(threadId: string): Record<string, unknown> | undefined {
  return (globalThis as {
    __mockConnectedThreadStagePropsByThreadId?: Record<string, Record<string, unknown>>;
  }).__mockConnectedThreadStagePropsByThreadId?.[threadId];
}

export type WorkbenchShellTestScope =
  | "sidebar-core"
  | "sidebar-projects"
  | "routes-threads"
  | "automations-conversation"
  | "layout-panel-actions"
  | "panel-commands"
  | "cards-shell-navigation";

/**
 * Registers one contiguous, mutually exclusive workflow shard. Keep new tests
 * inside the nearest domain guard so no assertion falls outside collection.
 * The shared module preserves one mock/harness authority while Vitest isolates
 * each thin shard entry in its own fork.
 */
export function registerWorkbenchShellTests(scope: WorkbenchShellTestScope): void {
describe(`workbench session shell / ${scope}`, () => {
  if (scope === "sidebar-core") {
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

  test("only reveals retained cached sessions synchronously", () => {
    const cachedSession = makeSession({ id: "session:alpha:warm" });
    const retainedEntries = [
      { sessionId: "session:alpha:warm", lastActiveAtMs: 2 },
      { sessionId: "session:alpha:other", lastActiveAtMs: 1 },
    ];

    expect(shouldSynchronouslyRevealSession({
      sessionId: cachedSession.id,
      cachedSession,
      retainedEntries,
    })).toBe(true);
    expect(shouldSynchronouslyRevealSession({
      sessionId: cachedSession.id,
      cachedSession: null,
      retainedEntries,
    })).toBe(false);
    expect(shouldSynchronouslyRevealSession({
      sessionId: "session:alpha:cold-prefetch",
      cachedSession,
      retainedEntries,
    })).toBe(false);
  });

  test("loads project sessions and renders the Database View DB tab", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const text = textContent(screen.container);
    expect(text.includes("Alpha")).toBe(true);
    expect(text.includes("Database View")).toBe(true);
    expect(text.includes("DB:alpha:kanban")).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list" && call[1] === "alpha")).toBe(false);
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list-summaries" && call[1] === "alpha")).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-sessions:get" && call[1] === "session:alpha:database-view")).toBe(true);
  });

  test("switches warm recent DB sessions across projects without cold list fetches or DB remount", async () => {
    const alphaHome = makeSession({
      id: "session:alpha:home",
      title: "Alpha Home",
      order: 0,
      rightFullWidth: true,
    });
    const alphaWork = makeSession({
      id: "session:alpha:work",
      title: "Alpha Work",
      order: 1,
      rightFullWidth: true,
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
    const betaWork = makeSession({
      id: "session:beta:work",
      projectId: "beta",
      title: "Beta Work",
      order: 0,
      rightFullWidth: true,
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha"), makeProject("beta", "Beta")],
      sessionsByProject: {
        alpha: [alphaHome, alphaWork],
        beta: [betaWork],
      },
      initialActiveProjectSessionId: alphaHome.id,
      sidebar: { collapsed: false, width: 300 },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await waitFor(() => {
      expect(getRetainedSessionIds(screen.container).includes(alphaHome.id)).toBe(true);
    });
    await waitFor(() => {
      expect(
        getKanbanProjectStore(
          "alpha",
          "database-view:alpha:primary-kanban",
        ).getSnapshot().databaseView?.databaseViewId,
      ).toBe("database-view:alpha:primary-kanban");
    });

    const alphaSearch = within(getActiveRetainedSessionRoot(screen.container))
      .getByLabelText("Mock DB search alpha") as HTMLInputElement;
    const alphaScroll = within(getActiveRetainedSessionRoot(screen.container))
      .getByTestId("mock-db-scroll-alpha");
    await act(async () => {
      fireEvent.input(alphaSearch, { target: { value: "status:hot" } });
      alphaScroll.scrollTop = 136;
      alphaScroll.scrollLeft = 28;
      fireEvent.scroll(alphaScroll);
      await Promise.resolve();
    });
    expect(alphaSearch.value).toBe("status:hot");
    expect(alphaScroll.scrollTop).toBe(136);
    expect(alphaScroll.scrollLeft).toBe(28);

    invokeCalls = [];
    await selectSidebarSession(screen.container, "Alpha Work");
    await act(async () => {
      fireEvent.click(screen.getByText("Beta"));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await selectSidebarSession(screen.container, "Beta Work");
    await selectSidebarSession(screen.container, "Alpha Home");

    const detailGets = invokeCalls
      .filter((call) => call[0] === "project-sessions:get")
      .map((call) => String(call[1]));
    expect(JSON.stringify(detailGets)).toBe(JSON.stringify([
      "session:alpha:work",
      "session:beta:work",
    ]));
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list")).toBe(false);
    expect(invokeCalls.some((call) => call[0] === "board:summary:get" && call[1] === "alpha")).toBe(false);

    const restoredAlphaSearch = within(getActiveRetainedSessionRoot(screen.container))
      .getByLabelText("Mock DB search alpha") as HTMLInputElement;
    const restoredAlphaScroll = within(getActiveRetainedSessionRoot(screen.container))
      .getByTestId("mock-db-scroll-alpha");
    expect(restoredAlphaSearch.value).toBe("status:hot");
    expect(restoredAlphaScroll.scrollTop).toBe(136);
    expect(restoredAlphaScroll.scrollLeft).toBe(28);
  });

  test("caps retained session Activity entries at the active session plus three recent warm sessions", async () => {
    const sessions = [1, 2, 3, 4, 5].map((index) =>
      makeSession({
        id: `session:alpha:retained-${index}`,
        title: `Retained ${index}`,
        order: index - 1,
        rightFullWidth: true,
      })
    );
    const screen = renderWorkbench({
      sessionsByProject: { alpha: sessions },
      initialActiveProjectSessionId: "session:alpha:retained-1",
      sidebar: { collapsed: false, width: 300 },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const firstSearch = within(getActiveRetainedSessionRoot(screen.container))
      .getByLabelText("Mock DB search alpha") as HTMLInputElement;
    await act(async () => {
      fireEvent.input(firstSearch, { target: { value: "evict me" } });
      await Promise.resolve();
    });
    expect(firstSearch.value).toBe("evict me");

    await selectSidebarSession(screen.container, "Retained 2");
    await selectSidebarSession(screen.container, "Retained 3");
    await selectSidebarSession(screen.container, "Retained 4");
    await selectSidebarSession(screen.container, "Retained 5");

    expect(JSON.stringify(getRetainedSessionIds(screen.container))).toBe(JSON.stringify([
      "session:alpha:retained-5",
      "session:alpha:retained-4",
      "session:alpha:retained-3",
      "session:alpha:retained-2",
    ]));

    await selectSidebarSession(screen.container, "Retained 1");
    const remountedSearch = within(getActiveRetainedSessionRoot(screen.container))
      .getByLabelText("Mock DB search alpha") as HTMLInputElement;
    expect(remountedSearch.value).toBe("");
  });

  test("passes inactive thread viewport state to full-width retained sessions", async () => {
    const first = makeAttachedSession({
      id: "session:alpha:thread-a",
      threadId: "thread-a",
      title: "Thread A",
      order: 0,
      rightFullWidth: true,
    });
    const second = makeAttachedSession({
      id: "session:alpha:thread-b",
      threadId: "thread-b",
      title: "Thread B",
      order: 1,
      rightFullWidth: true,
    });
    const namedFirst = {
      ...first,
      thread: first.thread ? { ...first.thread, threadName: "Thread A" } : null,
    };
    const namedSecond = {
      ...second,
      thread: second.thread ? { ...second.thread, threadName: "Thread B" } : null,
    };
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [namedFirst, namedSecond] },
      initialActiveProjectSessionId: first.id,
      sidebar: { collapsed: false, width: 300 },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(getConnectedThreadStagePropsByThreadId("thread-a")?.threadViewportActive).toBe(false);

    await selectSidebarSession(screen.container, "Thread B");

    expect(screen.getByTestId("thread-stage-title").textContent).toBe("Thread B");
    expect(getConnectedThreadStagePropsByThreadId("thread-a")?.threadViewportActive).toBe(false);
    expect(getConnectedThreadStagePropsByThreadId("thread-b")?.threadViewportActive).toBe(false);
    expect(JSON.stringify(getRetainedSessionIds(screen.container))).toBe(JSON.stringify([
      "session:alpha:thread-b",
      "session:alpha:thread-a",
    ]));
  });

  test("renders the Codex-style top new-chat row", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const newChatButton = screen.getByRole("button", { name: "New chat" });
    const iconPath = newChatButton.querySelector("path")?.getAttribute("d") ?? "";
    expect(iconPath.startsWith(CODEX_TITLEBAR_NEW_CHAT_ICON_PREFIX)).toBe(true);
    expect(textContent(newChatButton).includes("⌘N") || textContent(newChatButton).includes("Ctrl+N")).toBe(true);
  });

  test("renders Codex sidebar route rows inside the scroll area in captured order", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const nav = screen.getByRole("navigation", { name: "Automation folders" });
    const fixedHeader = nav.children.item(0);
    if (!(fixedHeader instanceof HTMLElement)) {
      throw new Error("Expected fixed sidebar header");
    }

    const fixedHeaderText = textContent(fixedHeader);
    expect(fixedHeaderText.includes("Nodex")).toBe(true);
    expect(fixedHeaderText.includes("New chat")).toBe(true);
    expect(within(fixedHeader).getByRole("button", { name: "Search" }) !== null).toBe(true);
    expect(fixedHeaderText.includes("Scheduled")).toBe(false);
    expect(fixedHeaderText.includes("Plugins")).toBe(false);
    expect(fixedHeader.getAttribute("data-scrolled-content-under-header")).toBe("false");

    const scrollArea = nav.querySelector("[data-app-action-sidebar-scroll]");
    if (!(scrollArea instanceof HTMLElement)) {
      throw new Error("Expected sidebar scroll area");
    }

    const routeActions = scrollArea.querySelector("[data-app-action-sidebar-scroll-top-actions]");
    if (!(routeActions instanceof HTMLElement)) {
      throw new Error("Expected scroll-owned route actions");
    }

    expect(scrollArea.firstElementChild === routeActions).toBe(true);
    expect(within(routeActions).getByRole("button", { name: "Scheduled" }) !== null).toBe(true);
    expect(within(routeActions).getByRole("button", { name: "Plugins" }) !== null).toBe(true);

    const routeActionsText = textContent(routeActions);
    expect(routeActionsText.indexOf("Scheduled") < routeActionsText.indexOf("Plugins")).toBe(true);

    await act(async () => {
      scrollArea.scrollTop = 12;
      fireEvent.scroll(scrollArea);
      await Promise.resolve();
    });
    expect(fixedHeader.getAttribute("data-scrolled-content-under-header")).toBe("true");
  });

  test("renders the Codex sidebar navigation landmark", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const nav = screen.getByRole("navigation", { name: "Automation folders" });
    expect(nav.closest('[data-testid="project-session-sidebar"]') !== null).toBe(true);
  });

  test("sidebar Search opens the command palette in cards mode", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      screen.openCommandPalette("cards");
      await Promise.resolve();
    });
    await settleAsyncRender();

    const commandModeInput = screen.getByLabelText("Command palette search") as HTMLInputElement;
    expect(commandModeInput.value).toBe("cards");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close palette" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const sidebar = screen.container.querySelector('[data-testid="project-session-sidebar"]');
    if (!(sidebar instanceof HTMLElement)) {
      throw new Error("Expected project session sidebar");
    }

    const searchButton = within(sidebar).getByRole("button", { name: "Search" });

    await act(async () => {
      fireEvent.click(searchButton);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const defaultSearchInput = screen.getByLabelText("Command palette search") as HTMLInputElement;
    expect(defaultSearchInput.value).toBe("cards");
  });

  test("sidebar pin button toggles a session without selecting it", async () => {
    const target = makeAttachedSession({
      id: "session:alpha:pin-target",
      threadId: "thread-pin-target",
      title: "Pin target",
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
      call[0] === "codex:threads:pinned:set"
      && call[1] === "thread-pin-target"
      && (call[2] as { pinned?: boolean } | undefined)?.pinned === true
    )).toBe(true);
    const updatedRow = getThreadRow(screen.container, "Pin target");
    expect(updatedRow.getAttribute("data-app-action-sidebar-thread-pinned")).toBe("true");
    const updatedButton = updatedRow.querySelector("[data-app-action-sidebar-thread-pin-session]");
    expect(updatedButton?.getAttribute("aria-label")).toBe("Unpin chat");
    expect(updatedButton?.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  test("sidebar archive hover action archives a session-backed chat optimistically", async () => {
    const target = makeAttachedSession({
      id: "session:alpha:archive-target",
      threadId: "thread-archive-target",
      title: "Archive target",
      order: 1,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), target] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await selectSidebarSession(screen.container, "Archive target");
    await selectSidebarSession(screen.container, "Database View");
    expect(getRetainedSessionIds(screen.container).includes("session:alpha:archive-target")).toBe(true);

    const row = getThreadRow(screen.container, "Archive target");
    const archiveButton = within(row).getByRole("button", { name: "Archive chat" });
    expect(archiveButton.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 20");

    await act(async () => {
      fireEvent.click(archiveButton);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Archive target"]')).toBe(null);
    expect(getRetainedSessionIds(screen.container).includes("session:alpha:archive-target")).toBe(false);
    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:archive"
      && call[1] === "session:alpha:archive-target"
    )).toBe(true);
  });

  test("sidebar archive hover action uses codex thread archive for snapshot-only chats", async () => {
    const snapshotOnlyItem: CodexSidebarThreadItem = {
      key: "local:thread-snapshot-only",
      kind: "local",
      hostId: "local",
      threadId: "thread-snapshot-only",
      sessionId: null,
      projectId: null,
      title: "Snapshot only",
      preview: "",
      cwd: null,
      updatedAt: 10,
      createdAt: 1,
      pinned: false,
      pinnedOrder: null,
      unread: false,
      archived: false,
      statusType: "idle",
      statusActiveFlags: [],
      projectless: true,
      disabled: false,
    };
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession()] },
      sidebarSnapshotItems: [snapshotOnlyItem],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const row = getThreadRow(screen.container, "Snapshot only");
    const archiveButton = within(row).getByRole("button", { name: "Archive chat" });

    await act(async () => {
      fireEvent.click(archiveButton);
      await Promise.resolve();
    });

    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Snapshot only"]')).toBe(null);
    expect(invokeCalls.some((call) =>
      call[0] === "codex:thread:archive"
      && call[1] === "thread-snapshot-only"
    )).toBe(true);
  });

  test("sidebar pin button promotes pinned sessions above unpinned siblings", async () => {
    const first = makeAttachedSession({
      id: "session:alpha:first",
      threadId: "thread-first-unpinned",
      title: "First unpinned",
      order: 1,
      rightCollapsed: true,
      tabs: [],
    });
    const second = makeAttachedSession({
      id: "session:alpha:second",
      threadId: "thread-second-target",
      title: "Second target",
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
      JSON.stringify(["Database View", "Second target", "First unpinned"]),
    );
  });

  test("sidebar unpin button clears pinned state after refresh", async () => {
    const pinned = makeAttachedSession({
      id: "session:alpha:pinned",
      threadId: "thread-pinned-target",
      title: "Pinned target",
      order: 1,
      pinned: true,
      pinnedOrder: 1,
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
      call[0] === "codex:threads:pinned:set"
      && call[1] === "thread-pinned-target"
      && (call[2] as { pinned?: boolean } | undefined)?.pinned === false
    )).toBe(true);
    const row = getThreadRow(screen.container, "Pinned target");
    expect(row.getAttribute("data-app-action-sidebar-thread-pinned")).toBe("false");
    const pinButton = row.querySelector("[data-app-action-sidebar-thread-pin-session]");
    expect(pinButton?.getAttribute("aria-label")).toBe("Pin chat");
    expect(pinButton?.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 20");
  });

  test("sidebar pin slot treats Database View as ordinary, reserves unread rows, and protects long titles", async () => {
    const unread = makeAttachedSession({
      id: "session:alpha:unread",
      title: "Unread target",
      order: 1,
      unread: true,
      rightCollapsed: true,
      tabs: [],
    });
    const long = makeAttachedSession({
      id: "session:alpha:long",
      title: "Very long session title that should truncate before colliding with row actions",
      order: 2,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), unread, long] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const databaseViewRow = getThreadRow(screen.container, "Database View");
    expect(databaseViewRow.querySelector("[data-app-action-sidebar-thread-pin-slot]") !== null).toBe(true);
    expect(databaseViewRow.querySelector("[data-app-action-sidebar-thread-pin-session]") !== null).toBe(true);
    expect(databaseViewRow.querySelector("[data-app-action-sidebar-thread-pin-session]")?.getAttribute("aria-label")).toBe("Unpin chat");

    const unreadRow = getThreadRow(screen.container, "Unread target");
    expect(unreadRow.querySelector("[data-app-action-sidebar-thread-pin-slot]") !== null).toBe(true);
    expect(unreadRow.querySelector("[data-app-action-sidebar-thread-pin-session]") === null).toBe(true);

    const longRow = getThreadRow(screen.container, "Very long session title that should truncate before colliding with row actions");
    expect(longRow.querySelector("[data-app-action-sidebar-thread-pin-slot]") !== null).toBe(true);
    expect(longRow.querySelector("[data-app-action-sidebar-thread-actions-menu]") === null).toBe(true);
    expect(longRow.querySelector("[data-app-action-sidebar-thread-archive]") !== null).toBe(true);
    expect(longRow.querySelector("[data-thread-title]")?.textContent).toBe("Very long session title that should truncate before colliding with row actions");
  });

  test("sidebar title double-click ignores inactive rows and non-title targets", async () => {
    const target = makeAttachedSession({
      id: "session:alpha:rename-target",
      title: "Rename target",
      order: 1,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), target] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const inactiveRow = getThreadRow(screen.container, "Rename target");
    const inactiveTitle = inactiveRow.querySelector("[data-thread-title]");
    if (!(inactiveTitle instanceof HTMLElement)) {
      throw new Error("Expected Rename target title");
    }

    await act(async () => {
      fireEvent.doubleClick(inactiveTitle);
      await Promise.resolve();
    });
    await settleAsyncRender();
    expect(screen.queryByLabelText("Chat title") === null).toBe(true);

    await act(async () => {
      fireEvent.click(inactiveRow);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const activeRow = getThreadRow(screen.container, "Rename target");
    await act(async () => {
      fireEvent.doubleClick(activeRow);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.queryByLabelText("Chat title") === null).toBe(true);
  });

  test("active sidebar title double-click opens Rename chat and saves raw title", async () => {
    const target = makeAttachedSession({
      id: "session:alpha:rename-target",
      title: "Rename target",
      order: 1,
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession(), target] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const row = getThreadRow(screen.container, "Rename target");
    await act(async () => {
      fireEvent.click(row);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const title = getThreadRow(screen.container, "Rename target").querySelector("[data-thread-title]");
    if (!(title instanceof HTMLElement)) {
      throw new Error("Expected Rename target title");
    }
    await act(async () => {
      fireEvent.doubleClick(title);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const input = screen.getByLabelText("Chat title") as HTMLInputElement;
    expect(screen.getByText("Rename chat").textContent).toBe("Rename chat");
    expect(textContent(document.body).includes("Keep it short and recognizable")).toBe(true);
    expect(input.value).toBe("Rename target");

    await act(async () => {
      fireEvent.input(input, { target: { value: "  hello   world  " } });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const renameCall = invokeCalls.find((call) => call[0] === "project-sessions:rename");
    expect(renameCall?.[1]).toBe("session:alpha:rename-target");
    expect((renameCall?.[2] as { title?: string } | undefined)?.title).toBe("  hello   world  ");
    expect(getThreadRow(screen.container, "hello world").getAttribute("data-app-action-sidebar-thread-title")).toBe("hello world");
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
    expect(leftSlot.getAttribute("style")?.includes("width: 312px")).toBe(true);
    expect(leftSlot.getAttribute("style")?.includes("min-width: 312px")).toBe(false);
    expect(within(leftSlot).queryByRole("button", { name: "New chat" })).toBe(null);
    expect(topNewChatButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_TITLEBAR_NEW_CHAT_ICON_PREFIX)).toBe(true);
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
    expect(Boolean(section.querySelector("[data-app-action-sidebar-section-body-motion]"))).toBe(true);

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(section.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");
    const exitingSectionBody = section.querySelector("[data-app-action-sidebar-section-body-motion]");
    expect(Boolean(exitingSectionBody)).toBe(true);
    expect(section.querySelectorAll("[data-app-action-sidebar-project-row]").length).toBe(1);
    expect(Boolean(section.querySelector("[data-app-action-sidebar-project-row]")?.closest("[data-app-action-sidebar-section-body-motion]"))).toBe(true);

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    expect(section.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("false");
    expect(Boolean(section.querySelector("[data-app-action-sidebar-section-body-motion]"))).toBe(true);
    expect(section.querySelectorAll("[data-app-action-sidebar-project-row]").length).toBe(1);
  });

  test("sidebar organizer section collapse state survives sidebar hide and show", async () => {
    const restoreMatchMedia = installReducedMotionMatchMediaForTest();
    try {
      const projectlessSession = makeSession({
        id: "session:projectless:loose-chat",
        projectId: null,
        title: "Loose chat",
      });
      const screen = renderWorkbench({
        projectlessSessions: [projectlessSession],
        sidebar: { collapsed: false, width: 300 },
      });
      await settleAsyncRender();
      await settleAsyncRender();

      const projectsSection = getSidebarSection(screen.container, "Projects");
      const chatsSection = getSidebarSection(screen.container, "Chats");
      const projectsToggle = projectsSection.querySelector("[data-app-action-sidebar-section-toggle]");
      const chatsToggle = chatsSection.querySelector("[data-app-action-sidebar-section-toggle]");
      if (!(projectsToggle instanceof HTMLElement) || !(chatsToggle instanceof HTMLElement)) {
        throw new Error("Expected sidebar section toggles");
      }

      await act(async () => {
        fireEvent.click(projectsToggle);
        fireEvent.click(chatsToggle);
        await Promise.resolve();
      });
      await settleAsyncRender();

      expect(projectsSection.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");
      expect(chatsSection.getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
        await Promise.resolve();
      });
      await waitFor(() => {
        if (screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null) {
          throw new Error("Expected project session sidebar to unmount after hide");
        }
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
        await Promise.resolve();
      });
      await settleAsyncRender();

      expect(getSidebarSection(screen.container, "Projects").getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");
      expect(getSidebarSection(screen.container, "Chats").getAttribute("data-app-action-sidebar-section-collapsed")).toBe("true");
    } finally {
      restoreMatchMedia();
    }
  });

  }

  if (scope === "sidebar-projects") {
  test("Projects header actions mirror Codex controls and reopen previous project folders", async () => {
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [makeSession({
          id: "session:beta:database-view",
          projectId: "beta",
          title: "Beta Database",
        })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const section = getSidebarSection(screen.container, "Projects");
    const options = within(section).getByRole("button", { name: "Project sidebar options" });
    const addNewProject = within(section).getByRole("button", { name: "Add new project" });
    const alphaRow = section.querySelector('[data-app-action-sidebar-project-id="alpha"]');
    const betaRow = section.querySelector('[data-app-action-sidebar-project-id="beta"]');

    if (!(alphaRow instanceof HTMLElement) || !(betaRow instanceof HTMLElement)) {
      throw new Error("Expected Alpha and Beta project rows");
    }

    expect(options.getAttribute("aria-disabled")).toBe(null);
    expect(addNewProject.getAttribute("aria-label")).toBe("Add new project");
    expect(alphaRow.getAttribute("aria-expanded")).toBe("true");
    expect(betaRow.getAttribute("aria-expanded")).toBe("false");
    expect(within(section).queryByRole("button", { name: "Collapse all" }) === null).toBe(true);

    await act(async () => {
      fireEvent.click(betaRow);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(betaRow.getAttribute("aria-expanded")).toBe("true");
    const collapseAll = within(section).getByRole("button", { name: "Collapse all" });

    await act(async () => {
      fireEvent.click(collapseAll);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(alphaRow.getAttribute("aria-expanded")).toBe("false");
    expect(betaRow.getAttribute("aria-expanded")).toBe("false");
    const reopenPrevious = within(section).getByRole("button", { name: "Reopen previous" });
    expect(reopenPrevious.getAttribute("data-app-action-sidebar-projects-collapse-action")).toBe("reopen-previous");

    await act(async () => {
      fireEvent.click(reopenPrevious);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(alphaRow.getAttribute("aria-expanded")).toBe("true");
    expect(betaRow.getAttribute("aria-expanded")).toBe("true");
    expect(within(section).getByRole("button", { name: "Collapse all" }).getAttribute("data-app-action-sidebar-projects-collapse-action")).toBe("collapse-all");
  });

  test("clicking an active project row while focused on its child session keeps the folder collapsed", async () => {
    const activeThread = makeAttachedSession({
      id: "session:alpha:thread",
      title: "Active thread",
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
    expect(projectRow.getAttribute("data-active")).toBe(null);
    expect(getThreadRow(screen.container, "Active thread").getAttribute("data-app-action-sidebar-thread-active")).toBe("true");
    const projectSelectionCallCountBeforeProjectClick = screen.setDbProjectCalls.length;

    await act(async () => {
      fireEvent.click(projectRow);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(projectRow.getAttribute("data-app-action-sidebar-project-collapsed")).toBe("true");
    const exitingThreadRow = screen.container.querySelector('[data-app-action-sidebar-thread-title="Active thread"]');
    expect(Boolean(exitingThreadRow?.closest("[data-app-action-sidebar-project-list-motion]"))).toBe(true);
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
      && JSON.stringify(call[1]) === JSON.stringify({ projectId: "alpha", noThreadFallbackTitle: "New thread" })
    )).toBe(true);
    expect(props?.isNewThreadTab).toBe(true);
    expect(JSON.stringify(props?.newThreadTarget).includes('"sessionId":"session:alpha:created"')).toBe(true);
    expect(screen.getByLabelText("Prompt").getAttribute("placeholder")).toBe("Write the first prompt for this new thread...");
    expect(screen.queryByTestId("session-right-panel")).toBe(null);
  });

  test("new project chats render above older project chats", async () => {
    const olderThread = makeAttachedSession({
      id: "session:alpha:older",
      title: "Older chat",
      order: 1,
      rightCollapsed: true,
      rightLayout: makePanelLayout([], null),
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeSession(), olderThread],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const rowTitles = Array.from(
      screen.container.querySelectorAll<HTMLElement>("[data-app-action-sidebar-thread-title]"),
    ).map((row) => row.getAttribute("data-app-action-sidebar-thread-title") ?? "");
    const overviewIndex = rowTitles.indexOf("Database View");
    const newThreadIndex = rowTitles.indexOf("New thread");
    const olderThreadIndex = rowTitles.indexOf("Older chat");

    expect(overviewIndex >= 0).toBe(true);
    expect(newThreadIndex >= 0).toBe(true);
    expect(olderThreadIndex >= 0).toBe(true);
    expect(overviewIndex < newThreadIndex).toBe(true);
    expect(newThreadIndex < olderThreadIndex).toBe(true);
  });

  test("new blank project chats render above snapshot-backed older chats", async () => {
    const olderThreadBase = makeAttachedSession({
      id: "session:alpha:snapshot-older",
      threadId: "thread-snapshot-older",
      title: "Older snapshot chat",
      order: 1,
      rightCollapsed: true,
      rightLayout: makePanelLayout([], null),
      tabs: [],
    });
    if (!olderThreadBase.thread) throw new Error("Expected older thread");
    const olderThread = {
      ...olderThreadBase,
      thread: {
        ...olderThreadBase.thread,
        threadName: "Older snapshot chat",
        threadPreview: "Older snapshot chat",
        createdAt: 100,
        updatedAt: 100,
      },
    };
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeSession(), olderThread],
      },
      sidebarSnapshotItems: [makeSidebarSnapshotItemForSession(olderThread)],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const rowTitles = getThreadRowTitles(screen.container);
    const databaseViewIndex = rowTitles.indexOf("Database View");
    const newThreadIndex = rowTitles.indexOf("New thread");
    const olderThreadIndex = rowTitles.indexOf("Older snapshot chat");

    expect(databaseViewIndex >= 0).toBe(true);
    expect(newThreadIndex >= 0).toBe(true);
    expect(olderThreadIndex >= 0).toBe(true);
    expect(databaseViewIndex < newThreadIndex).toBe(true);
    expect(newThreadIndex < olderThreadIndex).toBe(true);
  });

  test("project chat list follows Codex Show more and Show less paging", async () => {
    const projectChats = Array.from({ length: 16 }, (_, index) => makeAttachedSession({
      id: `session:alpha:paged-${index + 1}`,
      threadId: `thread-paged-${index + 1}`,
      title: `Paged chat ${index + 1}`,
      order: index + 1,
      pinned: false,
      pinnedOrder: null,
      rightCollapsed: true,
      rightLayout: makePanelLayout([], null),
      tabs: [],
    }));
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeSession(), ...projectChats],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Paged chat 4"]') !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Paged chat 5"]')).toBe(null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Paged chat 14"]') !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Paged chat 15"]')).toBe(null);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show less" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Paged chat 4"]') !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-action-sidebar-thread-title="Paged chat 5"]')).toBe(null);
  });

  test("projectless Chats starts at fifty rows and expands through the pager", async () => {
    const projectlessChats = Array.from({ length: 52 }, (_, index) => makeAttachedSession({
      id: `session:projectless:paged-${index + 1}`,
      projectId: null,
      threadId: `thread-projectless-paged-${index + 1}`,
      title: `Projectless chat ${index + 1}`,
      order: index + 1,
      pinned: false,
      pinnedOrder: null,
      rightCollapsed: true,
      rightLayout: makePanelLayout([], null),
      tabs: [],
    }));
    const screen = renderWorkbench({ projectlessSessions: projectlessChats });
    await settleAsyncRender();
    await settleAsyncRender();

    const chatsSection = getSidebarSection(screen.container, "Chats");
    expect(chatsSection.querySelectorAll("[data-app-action-sidebar-thread-row]").length).toBe(50);
    expect(chatsSection.querySelector('[data-app-action-sidebar-thread-title="Projectless chat 50"]') !== null).toBe(true);
    expect(chatsSection.querySelector('[data-app-action-sidebar-thread-title="Projectless chat 51"]')).toBe(null);

    await act(async () => {
      fireEvent.click(within(chatsSection).getByRole("button", { name: "Show more" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(chatsSection.querySelectorAll("[data-app-action-sidebar-thread-row]").length).toBe(52);
    expect(chatsSection.querySelector('[data-app-action-sidebar-thread-title="Projectless chat 51"]') !== null).toBe(true);
    expect(within(chatsSection).queryByRole("button", { name: "Show more" })).toBe(null);
    expect(within(chatsSection).queryByRole("button", { name: "Show less" }) !== null).toBe(true);
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
      && JSON.stringify(call[1]) === JSON.stringify({ projectId: "alpha", noThreadFallbackTitle: "New thread" })
    )).toBe(true);
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
              id: "session:beta:database-view",
              projectId: "beta",
              title: "Database View",
            }),
          ],
        },
      });
      await settleAsyncRender();
      await settleAsyncRender();

      const betaAction = screen.getByLabelText("Start new chat in Beta");
      const iconPath = betaAction.querySelector("path")?.getAttribute("d") ?? "";
      expect(iconPath.startsWith(CODEX_NEW_CHAT_ICON_PREFIX)).toBe(true);

      await act(async () => {
        fireEvent.click(betaAction);
        await Promise.resolve();
      });
      await settleAsyncRender();

      expect(promptCalls.length).toBe(0);
      await waitFor(() => {
        expect(invokeCalls.some((call) =>
          call[0] === "project-sessions:create"
          && JSON.stringify(call[1]) === JSON.stringify({ projectId: "beta", noThreadFallbackTitle: "New thread" })
        )).toBe(true);
      });
      await waitFor(() => {
        const latestProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
        expect(JSON.stringify(latestProps?.newThreadTarget).includes('"projectId":"beta"')).toBe(true);
        expect(JSON.stringify(latestProps?.newThreadTarget).includes('"sessionId":"session:beta:created"')).toBe(true);
      });
    } finally {
      window.prompt = originalPrompt;
    }
  });

  test("sidebar sync refreshes inactive project session cache", async () => {
    const sidebarSyncResult: CodexSidebarSyncResult = {
      snapshot: {
        items: [],
        pinnedThreadIds: [],
        projectAssignments: {},
        projectlessThreadIds: [],
        generatedAt: 2,
      },
      source: "app-server",
      refreshed: true,
      refreshedAt: 2,
      changedProjectIds: ["beta"],
      projectlessChanged: false,
      materializedSessionIds: [],
      failedThreadIds: [],
    };
    renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [
          makeSession({
            id: "session:beta:database-view",
            projectId: "beta",
            title: "Beta Database View",
          }),
        ],
      },
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "codex:sidebar:sync"
      && JSON.stringify(call[1]) === JSON.stringify({ policy: "force", reason: "mount" })
    )).toBe(false);

    await waitFor(() => {
      if (codexHostMessageListener === null) {
        throw new Error("missing host message listener");
      }
    });
    const betaFullRefreshCountBefore = invokeCalls.filter((call) =>
      call[0] === "project-sessions:list" && call[1] === "beta"
    ).length;
    const betaSummaryRefreshCountBefore = invokeCalls.filter((call) =>
      call[0] === "project-sessions:list-summaries" && call[1] === "beta"
    ).length;
    await act(async () => {
      codexHostMessageListener?.({
        type: "sidebarSyncUpdated",
        hostId: "local",
        result: sidebarSyncResult,
        reason: "host-message",
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      const betaSummaryRefreshCount = invokeCalls.filter((call) =>
        call[0] === "project-sessions:list-summaries" && call[1] === "beta"
      ).length;
      expect(betaSummaryRefreshCount > betaSummaryRefreshCountBefore).toBe(true);
      const betaFullRefreshCountAfter = invokeCalls.filter((call) =>
        call[0] === "project-sessions:list" && call[1] === "beta"
      ).length;
      expect(betaFullRefreshCountAfter).toBe(betaFullRefreshCountBefore);
    });
  });

  test("project action menu opens without selecting the project row", async () => {
    const beta = makeProject("beta", "Beta");
    const screen = renderWorkbench({
      projects: [makeProject(), beta],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [
          makeSession({
            id: "session:beta:database-view",
            projectId: "beta",
            title: "Beta Database View",
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

    expect(screen.setDbProjectCalls.includes("beta")).toBe(false);
    expect(textContent(document.body).includes("Add source folder")).toBe(true);
    expect(textContent(document.body).includes("Edit sources")).toBe(true);
  });

  test("project rows expose the Codex sortable header DOM contract", async () => {
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [makeSession({
          id: "session:beta:database-view",
          projectId: "beta",
          title: "Beta Database View",
        })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const betaRow = screen.container.querySelector('[data-app-action-sidebar-project-id="beta"]');
    expect(betaRow?.getAttribute("role")).toBe("button");
    expect(betaRow?.getAttribute("tabindex")).toBe("0");
    expect(betaRow?.getAttribute("aria-roledescription")).toBe("sortable");
    expect(betaRow?.getAttribute("aria-describedby")?.startsWith("DndDescribedBy-")).toBe(true);
    expect(Boolean(betaRow?.querySelector('[data-app-action-sidebar-select-project]'))).toBe(true);
    expect(Boolean(document.getElementById(betaRow?.getAttribute("aria-describedby") ?? ""))).toBe(true);
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
          id: "session:beta:database-view",
          projectId: "beta",
          title: "Beta Database View",
        })],
        gamma: [makeSession({
          id: "session:gamma:database-view",
          projectId: "gamma",
          title: "Gamma Database View",
        })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const pinnedSections = Array.from(screen.container.querySelectorAll('[data-app-action-sidebar-section-heading="Pinned"]'));
    const projectsSection = screen.container.querySelector('[data-app-action-sidebar-section-heading="Projects"]');
    expect(pinnedSections.length).toBe(1);
    expect(pinnedSections[0]?.querySelector('[data-app-action-sidebar-project-id="beta"]') !== null).toBe(true);
    expect(projectsSection?.querySelector('[data-app-action-sidebar-project-id="beta"]') === null).toBe(true);
    expect(projectsSection?.querySelector('[data-app-action-sidebar-project-id="alpha"]') !== null).toBe(true);
    expect(projectsSection?.querySelector('[data-app-action-sidebar-project-id="gamma"]') !== null).toBe(true);
  });

  test("default pinned organization places project pinned chats inside their project subtree", async () => {
    const pinnedAlpha = makeAttachedSession({
      id: "session:alpha:pinned",
      threadId: "thread-alpha-pinned",
      title: "Pinned Alpha",
      pinned: true,
      pinnedOrder: 0,
      order: 1,
    });
    const normalAlpha = makeAttachedSession({
      id: "session:alpha:normal",
      threadId: "thread-alpha-normal",
      title: "Normal Alpha",
      pinned: false,
      pinnedOrder: null,
      order: 2,
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [pinnedAlpha, normalAlpha] },
      sidebarSnapshotItems: [
        makeSidebarSnapshotItemForSession(pinnedAlpha),
        makeSidebarSnapshotItemForSession(normalAlpha),
      ],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const projectsSection = getSidebarSection(screen.container, "Projects");
    const alphaGroup = getSidebarProjectGroup(projectsSection, "alpha");

    expect(screen.container.querySelector('[data-app-action-sidebar-section-heading="Pinned"]')).toBe(null);
    expect(JSON.stringify(getThreadRowTitles(alphaGroup))).toBe(JSON.stringify(["Pinned Alpha", "Normal Alpha"]));
  });

  test("manual pinned organization keeps pinned chats as standalone Pinned rows", async () => {
    const pinnedAlpha = makeAttachedSession({
      id: "session:alpha:pinned",
      threadId: "thread-alpha-pinned",
      title: "Pinned Alpha",
      pinned: true,
      pinnedOrder: 0,
      order: 1,
    });
    const normalAlpha = makeAttachedSession({
      id: "session:alpha:normal",
      threadId: "thread-alpha-normal",
      title: "Normal Alpha",
      pinned: false,
      pinnedOrder: null,
      order: 2,
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [pinnedAlpha, normalAlpha] },
      sidebarSnapshotItems: [
        makeSidebarSnapshotItemForSession(pinnedAlpha),
        makeSidebarSnapshotItemForSession(normalAlpha),
      ],
      sidebar: { collapsed: false, width: 300, pinnedOrganizationMode: "manualOrder" },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const pinnedSection = getSidebarSection(screen.container, "Pinned");
    const projectsSection = getSidebarSection(screen.container, "Projects");
    const alphaGroup = getSidebarProjectGroup(projectsSection, "alpha");

    expect(pinnedSection.querySelector('[data-app-action-sidebar-thread-title="Pinned Alpha"]') !== null).toBe(true);
    expect(JSON.stringify(getThreadRowTitles(alphaGroup))).toBe(JSON.stringify(["Normal Alpha"]));
  });

  test("by-project organization keeps projectless pinned chats in the Pinned section", async () => {
    const projectlessPinnedItem: CodexSidebarThreadItem = {
      key: "local:thread-projectless-pinned",
      kind: "local",
      hostId: "local",
      threadId: "thread-projectless-pinned",
      sessionId: null,
      projectId: null,
      title: "Pinned Projectless",
      preview: "",
      cwd: null,
      updatedAt: 10,
      createdAt: 1,
      pinned: true,
      pinnedOrder: 0,
      unread: false,
      archived: false,
      statusType: "idle",
      statusActiveFlags: [],
      projectless: true,
      disabled: false,
    };
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession()] },
      sidebarSnapshotItems: [projectlessPinnedItem],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const pinnedSection = getSidebarSection(screen.container, "Pinned");
    expect(pinnedSection.querySelector('[data-app-action-sidebar-thread-title="Pinned Projectless"]') !== null).toBe(true);
  });

  test("by-project organization keeps pinned project chats inside the pinned project subtree", async () => {
    const beta = {
      ...makeProject("beta", "Beta"),
      pinned: true,
      pinnedOrder: 0,
    };
    const pinnedBeta = makeAttachedSession({
      id: "session:beta:pinned",
      projectId: "beta",
      threadId: "thread-beta-pinned",
      title: "Pinned Beta",
      pinned: true,
      pinnedOrder: 0,
      order: 1,
    });
    const normalBeta = makeAttachedSession({
      id: "session:beta:normal",
      projectId: "beta",
      threadId: "thread-beta-normal",
      title: "Normal Beta",
      pinned: false,
      pinnedOrder: null,
      order: 2,
    });
    const screen = renderWorkbench({
      projects: [beta, makeProject()],
      sessionsByProject: {
        beta: [pinnedBeta, normalBeta],
        alpha: [makeSession()],
      },
      sidebarSnapshotItems: [
        makeSidebarSnapshotItemForSession(pinnedBeta),
        makeSidebarSnapshotItemForSession(normalBeta),
      ],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const pinnedSection = getSidebarSection(screen.container, "Pinned");
    const betaGroup = getSidebarProjectGroup(pinnedSection, "beta");

    expect(JSON.stringify(getThreadRowTitles(betaGroup))).toBe(JSON.stringify(["Pinned Beta", "Normal Beta"]));
  });

  test("projects options menu switches pinned organization to manual order", async () => {
    const pinnedAlpha = makeAttachedSession({
      id: "session:alpha:pinned",
      threadId: "thread-alpha-pinned",
      title: "Pinned Alpha",
      pinned: true,
      pinnedOrder: 0,
      order: 1,
    });
    const normalAlpha = makeAttachedSession({
      id: "session:alpha:normal",
      threadId: "thread-alpha-normal",
      title: "Normal Alpha",
      pinned: false,
      pinnedOrder: null,
      order: 2,
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [pinnedAlpha, normalAlpha] },
      sidebarSnapshotItems: [
        makeSidebarSnapshotItemForSession(pinnedAlpha),
        makeSidebarSnapshotItemForSession(normalAlpha),
      ],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.queryByLabelText("Pinned section actions")).toBe(null);

    const projectsSection = getSidebarSection(screen.container, "Projects");

    await act(async () => {
      fireEvent.pointerDown(within(projectsSection).getByLabelText("Project sidebar options"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(textContent(document.body).includes("Organize pins")).toBe(true);
    });

    const organizeText = within(document.body).getByText("Organize pins");
    const organizeItem = organizeText.closest('[role="menuitem"]');
    if (!(organizeItem instanceof HTMLElement)) {
      throw new Error("Expected Organize pins menu item");
    }

    await act(async () => {
      fireEvent.pointerMove(organizeItem, { pointerType: "mouse" });
      fireEvent.keyDown(organizeItem, { key: "ArrowRight" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(Boolean(within(document.body).getByRole("menuitemradio", { name: "By project" }))).toBe(true);
    });

    const byProjectItem = within(document.body).getByRole("menuitemradio", { name: "By project" });
    const manualOrderItem = within(document.body).getByRole("menuitemradio", { name: "Manual order" });
    expect(byProjectItem.getAttribute("data-state")).toBe("checked");

    await act(async () => {
      fireEvent.click(manualOrderItem);
      await Promise.resolve();
    });
    await settleAsyncRender();

    const pinnedSection = getSidebarSection(screen.container, "Pinned");
    expect(screen.pinnedOrganizationModeChanges.at(-1)).toBe("manualOrder");
    expect(pinnedSection.querySelector('[data-app-action-sidebar-thread-title="Pinned Alpha"]') !== null).toBe(true);
  });

  test("project row new-chat button reuses an existing blank session", async () => {
    const betaBlank = makeSession({
      id: "session:beta:blank",
      projectId: "beta",
      title: "New thread",
      thread: null,
      tabs: [],
    });
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: {
        alpha: [makeSession()],
        beta: [
          makeSession({
            id: "session:beta:database-view",
            projectId: "beta",
            title: "Database View",
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

    expect(invokeCalls.some((call) => call[0] === "project-sessions:create" && JSON.stringify(call[1]).includes('"projectId":"beta"'))).toBe(false);
    await waitFor(() => {
      const latestProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
      expect(JSON.stringify(latestProps?.newThreadTarget).includes('"sessionId":"session:beta:blank"')).toBe(true);
    });
  });

  }

  if (scope === "routes-threads") {
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
    expect(routeShell !== null).toBe(true);
    expect(screen.container.querySelector('[data-thread-stage="true"]')).toBe(null);

    const settingsSidebar = screen.container.querySelector(".app-shell-left-panel");
    expect(settingsSidebar !== null).toBe(true);
    expect(screen.container.querySelector('[data-testid="settings-route-shell"] .main-surface') !== null).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Back to app"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="settings-route-shell"]')).toBe(null);
    expect(screen.container.querySelector('[data-thread-stage="true"]') !== null).toBe(true);
  });

  test("opens scheduled task management as a full-window route shell from the sidebar", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const routeShell = screen.getByTestId("automations-route-shell");
    const globalHeader = screen.getByTestId("workbench-global-header");
    const headerContextSurface = screen.getByTestId("app-shell-header-context-menu-surface");
    const leftSlot = getHeaderShellSlot(screen, "left");
    const rightSlot = getHeaderShellSlot(screen, "right");
    const leftLabels = Array.from(leftSlot.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label"))
      .join(",");

    await waitFor(() => {
      expect(within(headerContextSurface).queryByRole("button", { name: "Tasks" }) !== null).toBe(true);
    });

    expect(routeShell !== null).toBe(true);
    expect(screen.container.querySelector('[data-thread-stage="true"]')).toBe(null);
    expect(globalHeader.contains(headerContextSurface)).toBe(true);
    expect(headerContextSurface.getAttribute("aria-hidden")).toBe(null);
    expect(headerContextSurface.className.includes("invisible")).toBe(false);
    expect(leftLabels).toBe("Hide sidebar,Back,Forward");
    expect(rightSlot.getAttribute("style")?.includes("width: 0px")).toBe(true);
    expect(rightSlot.getAttribute("style")?.includes("min-width: 0")).toBe(true);
    expect(within(globalHeader).queryByRole("button", { name: "Toggle bottom panel" })).toBe(null);
    expect(within(globalHeader).queryByRole("button", { name: "Toggle side panel" })).toBe(null);
    expect(within(headerContextSurface).queryByRole("button", { name: "Templates" }) !== null).toBe(true);
    expect(within(headerContextSurface).queryByRole("button", { name: "Create via chat" }) !== null).toBe(true);
    expect(routeShell.contains(headerContextSurface)).toBe(false);
    expect(routeShell.querySelector("main > header") === null).toBe(true);
    expect(
      within(screen.getByRole("navigation", { name: "Automation folders" }))
        .getByRole("button", { name: "Scheduled" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(textContent(screen.container).includes("Ask ChatGPT to schedule tasks, set reminders, or monitor for updates.")).toBe(true);
    expect(textContent(screen.container).includes("Create your first scheduled task")).toBe(true);
    const firstRunSuggestionNames = WORKBENCH_AUTOMATION_FIRST_RUN_SUGGESTIONS
      .map((suggestion) => suggestion.name)
      .join(",");
    const visibleFirstRunSuggestionNames = WORKBENCH_AUTOMATION_FIRST_RUN_SUGGESTIONS
      .map((suggestion) => screen.getByRole("button", { name: suggestion.name }).textContent?.trim() ?? "")
      .join(",");
    expect(visibleFirstRunSuggestionNames).toBe(firstRunSuggestionNames);
    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBe(true);
  });

  test("scheduled route keeps titlebar chrome aligned when the sidebar collapses", async () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    try {
      const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
      await settleAsyncRender();
      await settleAsyncRender();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
        await Promise.resolve();
      });
      await settleAsyncRender();

      const expandedLeftSlot = getHeaderShellSlot(screen, "left");
      await act(async () => {
        fireEvent.click(within(expandedLeftSlot).getByRole("button", { name: "Hide sidebar" }));
        await Promise.resolve();
      });
      await settleAsyncRender();
      await settleAsyncRender();

      const collapsedLeftSlot = getHeaderShellSlot(screen, "left");
      const headerContextSurface = screen.getByTestId("app-shell-header-context-menu-surface");
      const collapsedLabels = Array.from(collapsedLeftSlot.querySelectorAll("button"))
        .map((button) => button.getAttribute("aria-label"))
        .join(",");

      await waitFor(() => {
        expect(within(headerContextSurface).queryByRole("button", { name: "Tasks" }) !== null).toBe(true);
      });

      expect(collapsedLabels).toBe("Show sidebar,Back,Forward,New chat");
      expect(within(collapsedLeftSlot).queryByRole("button", { name: "Show sidebar" }) !== null).toBe(true);
      expect(headerContextSurface.getAttribute("aria-hidden")).toBe(null);
      expect(headerContextSurface.className.includes("invisible")).toBe(false);
      expect(within(screen.getByTestId("workbench-global-header")).queryByRole("button", { name: "Toggle bottom panel" })).toBe(null);
      expect(within(screen.getByTestId("workbench-global-header")).queryByRole("button", { name: "Toggle side panel" })).toBe(null);
      expect(within(headerContextSurface).queryByRole("button", { name: "Templates" }) !== null).toBe(true);
      expect(within(headerContextSurface).queryByRole("button", { name: "Create via chat" }) !== null).toBe(true);
    } finally {
      Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform });
    }
  });

  test("restores full-width right-panel geometry after returning from settings", async () => {
    const measurement = installSessionContentMeasurementForTest({ width: 850, height: 640 });
    try {
      const screen = renderWorkbench();
      await settleAsyncRender();
      await settleAsyncRender();

      const rightPanel = screen.getByTestId("session-right-panel");
      expect(rightPanel.getAttribute("data-right-panel-width-mode")).toBe("full");
      await waitFor(() => {
        expect(rightPanel.getAttribute("style")?.includes("width: 850px")).toBe(true);
      });

      const settingsButton = screen.container.querySelector('button[title="Settings"]');
      if (!(settingsButton instanceof HTMLElement)) {
        throw new Error("Expected a sidebar settings button");
      }
      await act(async () => {
        fireEvent.click(settingsButton);
        await Promise.resolve();
      });
      await settleAsyncRender();

      await act(async () => {
        measurement.flushResizeObservers();
        await Promise.resolve();
      });
      await settleAsyncRender();

      await act(async () => {
        fireEvent.click(screen.getByText("Back to app"));
        await Promise.resolve();
      });
      await settleAsyncRender();
      await settleAsyncRender();

      const restoredRightPanel = screen.getByTestId("session-right-panel");
      const restoredThreadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
      const restoreButton = screen.getByRole("button", { name: "Restore panel width" });
      expect(restoredRightPanel.getAttribute("data-right-panel-width-mode")).toBe("full");
      expect(restoredRightPanel.getAttribute("style")?.includes("width: 850px")).toBe(true);
      expect(restoredThreadPage?.getAttribute("data-session-thread-page-hidden")).toBe("true");
      expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
    } finally {
      measurement.restore();
    }
  });

  test("restores the DB toolbar controls inside session DB tabs", async () => {
    const prefs = getDefaultDbViewPrefs("list");
    const listTab = makeSessionTab({
      id: "session:alpha:database-view:list",
      sessionId: "session:alpha:database-view",
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
    expect(props?.dbViewPrefs === prefs).toBe(true);
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
      && call[1] === "session:alpha:database-view:db"
      && JSON.stringify(call[2]) === JSON.stringify({
        config: {
          projectId: "alpha",
          databaseViewId: "database-view:alpha:primary-kanban",
          view: "list",
        },
        title: "Table",
      })
    )).toBe(true);
  });

  test("keeps two same-Project Database tabs bound to their own durable View identity", async () => {
    const primaryTab = makeSessionTab({
      id: "session:alpha:database-view:primary",
      kind: "db_view",
      title: "Primary",
      config: {
        projectId: "alpha",
        databaseViewId: "view-alpha-primary",
        view: "kanban",
      },
    });
    const focusedTab = makeSessionTab({
      id: "session:alpha:database-view:focused",
      kind: "db_view",
      title: "Focused",
      config: {
        projectId: "alpha",
        databaseViewId: "view-alpha-focused",
        view: "list",
      },
    });
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeSession({
          tabs: [primaryTab, focusedTab],
          rightLayout: makePanelLayout(
            [primaryTab.id, focusedTab.id],
            focusedTab.id,
          ),
        })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(
      screen.container.querySelector(
        '[data-main-view-host="true"][data-database-view-id="view-alpha-focused"]',
      ) !== null,
    ).toBe(true);

    await act(async () => {
      fireEvent.mouseDown(getPanelTabById(screen.container, primaryTab.id), {
        button: 0,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(
      screen.container.querySelector(
        '[data-main-view-host="true"][data-database-view-id="view-alpha-primary"]',
      ) !== null,
    ).toBe(true);
  });

  test("renders an attached session thread as the main session page", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:thread", title: "Thread" })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("false");
    expect(textContent(screen.container).includes("Thread:thread-alpha")).toBe(true);
    expect(screen.container.querySelector('[data-thread-stage="true"]') !== null).toBe(true);
    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(props?.activeThreadSummary).includes('"projectId":"alpha"')).toBe(true);
  });

  test("passes composer follow-up and enter preferences into attached session threads", async () => {
    localStorage.setItem(THREAD_QUEUE_FOLLOW_UPS_STORAGE_KEY, "false");
    localStorage.setItem(COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY, "cmdIfMultiline");
    renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:thread", title: "Thread" })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(props?.isQueueingEnabled).toBe(false);
    expect(props?.composerEnterBehavior).toBe("cmdIfMultiline");
  });

  test("passes session start progress to an attached empty thread stage", async () => {
    mockThreadStartProgress = {
      projectId: "alpha",
      sessionId: "session:alpha:thread",
      runInTarget: "localProject",
      threadId: "thread-alpha",
      phase: "startingThread",
      message: "Sending message…",
      outputText: "",
      updatedAt: 10,
    };
    renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:thread", title: "Thread" })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(props?.threadStartProgress)).toBe(JSON.stringify(mockThreadStartProgress));
  });

  test("uses the global app header as the only top title row", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:thread", title: "Thread" })],
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
    expect(textContent(globalHeader).includes("Database View")).toBe(false);
    expect(textContent(globalHeader).includes("Alpha thread")).toBe(true);
    expect(textContent(threadStage).includes("Alpha thread")).toBe(false);
    expect(headerContextSurface !== null).toBe(true);
    expect((threadFrame.getAttribute("style") ?? "").includes("--app-shell-main-content-frame-top-offset")).toBe(false);
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBe(true);
    const topFade = screen.container.querySelector(".app-shell-main-content-top-fade");
    expect(topFade?.getAttribute("data-app-shell-main-content-top-fade")).toBe("full-bleed");
  });

  test("keeps the frame border shell-owned while reserving right header actions", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
            rightCollapsed: false,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const visibleProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const visibleFrame = screen.container.querySelector(".app-shell-main-content-frame");
    expect(Boolean(visibleProps && "showHeaderSeparator" in visibleProps)).toBe(false);
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBe(true);
    expect((visibleFrame?.getAttribute("style") ?? "").includes("--app-shell-main-content-frame-top-offset")).toBe(false);
    expect((visibleFrame?.getAttribute("style") ?? "").includes("--thread-stage-header-right-reserve")).toBe(false);
    screen.unmount();

    const collapsedScreen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread-collapsed",
            title: "Thread",
            rightCollapsed: true,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const collapsedProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const collapsedFrame = collapsedScreen.container.querySelector(".app-shell-main-content-frame");
    expect(Boolean(collapsedProps && "showHeaderSeparator" in collapsedProps)).toBe(false);
    expect(collapsedScreen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBe(true);
    expect((collapsedFrame?.getAttribute("style") ?? "").includes("--app-shell-main-content-frame-top-offset")).toBe(false);
    expect((collapsedFrame?.getAttribute("style") ?? "").includes("--thread-stage-header-right-reserve")).toBe(false);
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
    expect(textContent(screen.container).includes("Attach an existing Codex thread to use this session page.")).toBe(false);
    expect(props?.isNewThreadTab).toBe(true);
    expect(props?.activeThreadId === null).toBe(true);
    expect(JSON.stringify(props?.newThreadTarget).includes('"sessionId":"session:alpha:blank"')).toBe(true);
  });

  test("passes the start-in selector to attached thread summary panels", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    const selector = props?.newThreadStartInSelector as {
      target?: { runInTarget?: string; worktreeStartMode?: string; worktreeBranchPrefix?: string };
      disabled?: boolean;
    } | null | undefined;
    expect(props?.isNewThreadTab).toBe(false);
    expect(props?.newThreadTarget === null).toBe(true);
    expect(selector?.target?.runInTarget).toBe("localProject");
    expect(selector?.target?.worktreeStartMode).toBe("detachedHead");
    expect(selector?.target?.worktreeBranchPrefix).toBe("nodex/");
    expect(selector?.disabled).toBe(false);
  });

  test("summary scheduled automation action opens the selected automation route", async () => {
    installTerminalEventApiMock();
    const automation = makeScheduledAutomation({
      id: "automation-summary",
      name: "Summary cadence",
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
      scheduledAutomations: [automation],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    const openScheduledAutomation = actions.onOpenSummaryScheduledAutomation as ((input: {
      automationId: string;
      title: string;
    }) => void) | undefined;
    expect(typeof openScheduledAutomation).toBe("function");

    await act(async () => {
      openScheduledAutomation?.({
        automationId: automation.id,
        title: automation.name,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="automations-route-shell"]') !== null).toBe(true);
    await waitFor(() => {
      expect(textContent(screen.container).includes("Summary cadence")).toBe(true);
    });
    expect(screen.container.querySelector('[data-testid="automation-detail-rail"]') !== null).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse details" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    expect(screen.container.querySelector('[data-testid="automation-detail-rail"]')).toBe(null);
    expect(screen.container.querySelector('[data-thread-stage="true"]')).toBe(null);
  });

  test("summary scheduled automation proposal opens and saves from the side panel", async () => {
    installTerminalEventApiMock();
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/tmp/project")],
      sessionsByProject: { alpha: [makeAttachedSession({ id: "session:alpha:automation-proposal" })] },
      scheduledAutomations: [],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    const openScheduledAutomation = actions.onOpenSummaryScheduledAutomation as ((input: {
      createInput: CodexScheduledAutomationCreateInput;
      mode: "suggested-create";
      title: string;
    }) => void) | undefined;
    expect(typeof openScheduledAutomation).toBe("function");

    await act(async () => {
      openScheduledAutomation?.({
        mode: "suggested-create",
        title: "Review release notes",
        createInput: {
          kind: "cron",
          name: "Review release notes",
          prompt: "Review release notes and summarize risks.",
          rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
          cwds: ["/tmp/project"],
          executionEnvironment: "worktree",
          localEnvironmentConfigPath: null,
          model: "gpt-5.5",
          reasoningEffort: "medium",
        },
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const sidePanel = screen.container.querySelector('[data-automation-side-panel-tab="true"]') as HTMLElement | null;
    expect(sidePanel !== null).toBe(true);
    if (!sidePanel) throw new Error("Expected automation side panel");
    expect(screen.container.querySelector('[data-testid="automations-route-shell"]')).toBe(null);
    expect(textContent(sidePanel).includes("Review release notes")).toBe(true);

    await act(async () => {
      fireEvent.click(within(sidePanel).getByRole("button", { name: "Create scheduled task" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getScheduledAutomations().length).toBe(1);
    });
    expect(screen.getScheduledAutomations()[0]?.name).toBe("Review release notes");
    await waitFor(() => {
      const currentSidePanel = screen.container.querySelector('[data-automation-side-panel-tab="true"]') as HTMLElement | null;
      expect(currentSidePanel !== null).toBe(true);
      expect(within(currentSidePanel as HTMLElement).getByRole("button", { name: "Open in Scheduled" }) !== null).toBe(true);
    });
  });

  test("summary scheduled automation proposal reports create failures with the scheduled task toast title", async () => {
    installTerminalEventApiMock();
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/tmp/project")],
      sessionsByProject: { alpha: [makeAttachedSession({ id: "session:alpha:automation-proposal-failure" })] },
      scheduledAutomations: [],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    const openScheduledAutomation = actions.onOpenSummaryScheduledAutomation as ((input: {
      createInput: CodexScheduledAutomationCreateInput;
      mode: "suggested-create";
      title: string;
    }) => void) | undefined;
    expect(typeof openScheduledAutomation).toBe("function");

    await act(async () => {
      openScheduledAutomation?.({
        mode: "suggested-create",
        title: "Broken proposal",
        createInput: {
          kind: "cron",
          name: "Broken proposal",
          prompt: "Try to create and fail.",
          rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
          cwds: ["/tmp/project"],
          executionEnvironment: "worktree",
          localEnvironmentConfigPath: null,
          model: "gpt-5.5",
          reasoningEffort: "medium",
        },
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const sidePanel = screen.container.querySelector('[data-automation-side-panel-tab="true"]') as HTMLElement | null;
    expect(sidePanel !== null).toBe(true);
    if (!sidePanel) throw new Error("Expected automation side panel");
    const baseMockInvokeImpl = mockInvokeImpl;
    mockInvokeImpl = async (channel, ...args) => {
      if (channel === "codex:scheduled-automations:create") {
        throw new Error("Create bridge failed");
      }
      return baseMockInvokeImpl?.(channel, ...args) ?? null;
    };

    await act(async () => {
      fireEvent.click(within(sidePanel).getByRole("button", { name: "Create scheduled task" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(__getNodexToastSnapshotForTests().some((record) => (
        record.kind === "plain"
        && record.level === "danger"
        && record.title === "Could not create scheduled task"
        && record.description === "Create bridge failed"
      ))).toBe(true);
    });
    expect(screen.getScheduledAutomations().length).toBe(0);
    expect(textContent(sidePanel).includes("Create bridge failed")).toBe(true);
  });

  }

  if (scope === "automations-conversation") {
  test("automations route creates updates and deletes scheduled tasks", async () => {
    const originalInnerWidth = window.innerWidth;
    setWindowInnerWidthForTest(1600);
    try {
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/tmp/project")],
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-crud" })],
      },
      scheduledAutomations: [],
      worktreeEnvironmentOptionsByProject: {
        alpha: [
          {
            path: ".codex/environments/environment.toml",
            name: "CI setup",
            hasSetupScript: true,
            hasCleanupScript: false,
            actionCount: 0,
          },
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.container.querySelector('[data-testid="automations-route-shell"]') !== null).toBe(true);
    });

    expect(screen.getByRole("button", { name: "Create via chat" }) !== null).toBe(true);
    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText("New scheduled task options"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const createViaChatItem = await screen.findByRole("menuitem", { name: "Create via chat" });
    expect(createViaChatItem.getAttribute("aria-disabled")).toBe(null);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Create manually" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
      nameInput.value = "Weekly triage";
      fireEvent.input(nameInput);
      promptInput.value = "Triage the weekly project queue.";
      fireEvent.input(promptInput);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText("Project"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const projectItem = await screen.findByRole("menuitem", { name: /Alpha/u });
    await act(async () => {
      fireEvent.click(projectItem);
      await Promise.resolve();
    });
    await settleAsyncRender();
    const environmentTrigger = await screen.findByLabelText("Environment");
    await act(async () => {
      fireEvent.pointerDown(environmentTrigger, { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const environmentItem = await screen.findByRole("menuitem", { name: /CI setup/u });
    await act(async () => {
      fireEvent.click(environmentItem);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Environment").textContent?.includes("CI setup") ?? false).toBe(true);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Schedule"));
      await Promise.resolve();
    });
    const scheduleTypeTrigger = await screen.findByLabelText("Schedule type");
    await act(async () => {
      fireEvent.pointerDown(scheduleTypeTrigger, { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const weeklyItem = await screen.findByRole("menuitem", { name: "Weekly" });
    await act(async () => {
      fireEvent.click(weeklyItem);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await act(async () => {
      const timeInput = screen.getByLabelText("Time") as HTMLInputElement;
      timeInput.value = "10:30";
      fireEvent.input(timeInput);
      await Promise.resolve();
    });
    await settleAsyncRender();
    const modelTrigger = await screen.findByLabelText("Model and reasoning");
    await waitFor(() => {
      expect((modelTrigger as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.pointerDown(modelTrigger, { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const highModelItem = await screen.findByRole("menuitem", { name: "GPT-5.5 High" });
    await act(async () => {
      fireEvent.click(highModelItem);
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create scheduled task" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getScheduledAutomations().length).toBe(1);
    });
    expect(screen.getScheduledAutomations()[0]?.name).toBe("Weekly triage");
    expect(screen.getScheduledAutomations()[0]?.prompt).toBe("Triage the weekly project queue.");
    expect(JSON.stringify(screen.getScheduledAutomations()[0]?.cwds)).toBe(JSON.stringify(["/tmp/project"]));
    expect(screen.getScheduledAutomations()[0]?.localEnvironmentConfigPath).toBe(".codex/environments/environment.toml");
    expect(screen.getScheduledAutomations()[0]?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU;BYHOUR=10;BYMINUTE=30");
    expect(screen.getScheduledAutomations()[0]?.model).toBe("gpt-5.5-high");
    expect(screen.getScheduledAutomations()[0]?.reasoningEffort).toBe("high");

    await act(async () => {
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      nameInput.value = "Updated triage";
      fireEvent.input(nameInput);
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      expect(screen.getScheduledAutomations()[0]?.name).toBe("Updated triage");
    });

    const detailRail = screen.getByTestId("automation-detail-rail");
    const headerContextSurface = screen.getByTestId("app-shell-header-context-menu-surface");
    const resizeSeparator = within(detailRail).getByRole("separator", { name: "Resize scheduled task details" });
    let capturedPointerId: number | null = null;
    resizeSeparator.setPointerCapture = (pointerId: number) => {
      capturedPointerId = pointerId;
    };
    await waitFor(() => {
      expect(detailRail.getAttribute("style")?.includes("width: 820px")).toBe(true);
      expect(headerContextSurface.getAttribute("style")?.includes("margin-right: 820px")).toBe(true);
    });
    await act(async () => {
      fireEvent.pointerDown(resizeSeparator, { button: 0, pointerId: 11, clientX: 380 });
      fireEvent.pointerMove(window, { pointerId: 11, clientX: 650 });
      fireEvent.pointerUp(window, { pointerId: 11 });
      await Promise.resolve();
    });
    expect(capturedPointerId).toBe(11);
    await waitFor(() => {
      expect(detailRail.getAttribute("style")?.includes("width: 550px")).toBe(true);
      expect(headerContextSurface.getAttribute("style")?.includes("margin-right: 550px")).toBe(true);
    });

    await act(async () => {
      fireEvent.click(within(detailRail).getByRole("button", { name: "Delete scheduled task" }));
      await Promise.resolve();
    });
    const deleteDialog = await screen.findByRole("dialog");
    expect(textContent(deleteDialog).includes("Delete Updated triage?")).toBe(true);
    expect(textContent(deleteDialog).includes("This will permanently delete the scheduled task and stop future runs.")).toBe(true);

    await act(async () => {
      fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete scheduled task" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getScheduledAutomations().length).toBe(0);
    });
    expect(textContent(screen.container).includes("Create your first scheduled task")).toBe(true);
    } finally {
      setWindowInnerWidthForTest(originalInnerWidth);
    }
  });

  test("automations route shows task and template search empty states", async () => {
    installTerminalEventApiMock();
    const screen = renderWorkbench({
      scheduledAutomations: [
        makeScheduledAutomation({
          id: "automation-search-alpha",
          name: "Alpha standup",
          prompt: "Check the alpha thread.",
        }),
      ],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.getByTestId("project-session-sidebar");
    await act(async () => {
      fireEvent.click(within(sidebar).getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    const routeShell = await screen.findByTestId("automations-route-shell");
    const headerContextSurface = screen.getByTestId("app-shell-header-context-menu-surface");
    await waitFor(() => {
      expect(within(headerContextSurface).queryByRole("button", { name: "Templates" }) !== null).toBe(true);
    });

    const taskSearch = await within(routeShell).findByLabelText("Search scheduled tasks") as HTMLInputElement;
    await act(async () => {
      taskSearch.value = "no matching automation";
      fireEvent.input(taskSearch);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(textContent(screen.container).includes("No scheduled tasks found")).toBe(true);
      expect(textContent(screen.container).includes("Try another search")).toBe(true);
    });

    await act(async () => {
      fireEvent.click(within(headerContextSurface).getByRole("button", { name: "Templates" }));
      await Promise.resolve();
    });
    const templateSearch = await within(routeShell).findByLabelText("Search templates") as HTMLInputElement;
    await act(async () => {
      templateSearch.value = "no matching template";
      fireEvent.input(templateSearch);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(textContent(screen.container).includes("No templates found")).toBe(true);
      expect(textContent(screen.container).includes("Try another search")).toBe(true);
    });
  });

  test("automations edit autosave waits for a valid changed draft", async () => {
    installTerminalEventApiMock();
    const automation = makeScheduledAutomation({
      id: "automation-autosave",
      kind: "cron",
      targetThreadId: null,
      name: "Autosave report",
      prompt: "Summarize the project.",
      rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      cwds: ["/tmp/project"],
      executionEnvironment: "local",
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/tmp/project")],
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-autosave" })],
      },
      scheduledAutomations: [automation],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.getByTestId("project-session-sidebar");
    await act(async () => {
      fireEvent.click(within(sidebar).getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    const routeShell = await screen.findByTestId("automations-route-shell");
    const row = await within(routeShell).findByTestId("automation-list-row-automation-autosave");
    await act(async () => {
      fireEvent.click(row);
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      nameInput.value = "";
      fireEvent.input(nameInput);
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    });
    await settleAsyncRender();

    const updateCallCountAfterInvalid = invokeCalls.filter((call) =>
      call[0] === "codex:scheduled-automations:update"
    ).length;
    expect(updateCallCountAfterInvalid).toBe(0);
    expect(screen.getScheduledAutomations()[0]?.name).toBe("Autosave report");

    await act(async () => {
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      nameInput.value = "Autosaved report";
      fireEvent.input(nameInput);
      await Promise.resolve();
    });

    await waitFor(() => {
      const updateCallCount = invokeCalls.filter((call) =>
        call[0] === "codex:scheduled-automations:update"
      ).length;
      expect(updateCallCount).toBe(1);
      expect(screen.getScheduledAutomations()[0]?.name).toBe("Autosaved report");
    }, { timeout: 2_000 });
  });

  test("automations route saves a valid edited model before switching route state", async () => {
    installTerminalEventApiMock();
    const automation = makeScheduledAutomation({
      id: "automation-model-flush",
      kind: "cron",
      targetThreadId: null,
      name: "Model flush report",
      prompt: "Summarize the project model choice.",
      rrule: "DTSTART;TZID=Asia/Shanghai:20260710T090000\nRRULE:FREQ=DAILY",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      cwds: ["/tmp/project"],
      executionEnvironment: "local",
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/tmp/project")],
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-model-flush" })],
      },
      scheduledAutomations: [automation],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    const routeShell = await screen.findByTestId("automations-route-shell");
    await act(async () => {
      fireEvent.click(within(routeShell).getByTestId("automation-list-row-automation-model-flush"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const modelTrigger = await screen.findByLabelText("Model and reasoning");
    await waitFor(() => {
      expect((modelTrigger as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.pointerDown(modelTrigger, { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const highModelItem = await screen.findByRole("menuitem", { name: "GPT-5.5 High" });
    await act(async () => {
      fireEvent.click(highModelItem);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Templates" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      const saved = screen.getScheduledAutomations().find((item) => item.id === "automation-model-flush");
      expect(saved?.model).toBe("gpt-5.5-high");
      expect(saved?.reasoningEffort).toBe("high");
      expect(screen.getByRole("button", { name: "Templates" }).getAttribute("aria-pressed")).toBe("true");
    });
    const updateCall = invokeCalls.find((call) =>
      call[0] === "codex:scheduled-automations:update"
    );
    expect((updateCall?.[1] as { rrule?: string } | undefined)?.rrule).toBe(
      "DTSTART;TZID=Asia/Shanghai:20260710T090000\nRRULE:FREQ=DAILY",
    );
  });

  test("automations previous run click saves pending edits and opens the run chat", async () => {
    installTerminalEventApiMock();
    const automation = makeScheduledAutomation({
      id: "automation-history-open",
      kind: "cron",
      targetThreadId: null,
      name: "History open task",
      prompt: "Summarize the run before opening.",
      rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      cwds: ["/tmp/project"],
      executionEnvironment: "local",
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/tmp/project")],
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-history-open" })],
      },
      scheduledAutomations: [automation],
      automationInboxItems: [
        makeAutomationInboxItem({
          id: "thread-run-open",
          threadId: "thread-run-open",
          automationId: "automation-history-open",
          automationName: "History open task",
          title: "Openable history run",
          description: "Ready for review.",
          sourceCwd: "/tmp/project",
          createdAt: 300,
          readAt: null,
          status: "PENDING_REVIEW",
        }),
      ],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    const routeShell = await screen.findByTestId("automations-route-shell");
    await act(async () => {
      fireEvent.click(within(routeShell).getByTestId("automation-list-row-automation-history-open"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(textContent(screen.container).includes("Openable history run")).toBe(true);
    });

    const modelTrigger = await screen.findByLabelText("Model and reasoning");
    await waitFor(() => {
      expect((modelTrigger as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.pointerDown(modelTrigger, { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const highModelItem = await screen.findByRole("menuitem", { name: "GPT-5.5 High" });
    await act(async () => {
      fireEvent.click(highModelItem);
      await Promise.resolve();
    });

    const runButton = within(screen.getByTestId("automation-previous-run-thread-run-open"))
      .getByRole("button", { name: "Openable history run" });
    await act(async () => {
      fireEvent.click(runButton);
      await Promise.resolve();
    });

    await waitFor(() => {
      const saved = screen.getScheduledAutomations().find((item) => item.id === "automation-history-open");
      expect(saved?.model).toBe("gpt-5.5-high");
      expect(saved?.reasoningEffort).toBe("high");
      expect(screen.container.querySelector('[data-testid="automations-route-shell"]')).toBe(null);
      expect(textContent(screen.container).includes("Thread:thread-run-open")).toBe(true);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    const returnedRouteShell = await screen.findByTestId("automations-route-shell");
    const returnedHeaderSurface = screen.getByTestId("app-shell-header-context-menu-surface");
    const returnedRightSlot = getHeaderShellSlot(screen, "right");
    await waitFor(() => {
      expect(returnedRightSlot.getAttribute("style")?.includes("width: 0px")).toBe(true);
      expect(returnedRightSlot.getAttribute("style")?.includes("min-width: 0")).toBe(true);
      expect(within(returnedHeaderSurface).queryByRole("button", { name: "Create via chat" }) !== null).toBe(true);
      expect(within(returnedHeaderSurface).queryByRole("button", { name: "Tasks" }) !== null).toBe(true);
    });
    expect(returnedRouteShell.contains(returnedHeaderSurface)).toBe(false);
    expect(within(screen.getByTestId("workbench-global-header")).queryByRole("button", { name: "Toggle side panel" })).toBe(null);
  });

  test("automations route create via chat pre-fills a blank session composer", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-chat-create" })],
      },
      scheduledAutomations: [],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText("New scheduled task options"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const createViaChatItem = await screen.findByRole("menuitem", { name: "Create via chat" });
    await act(async () => {
      fireEvent.click(createViaChatItem);
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      expect(screen.container.querySelector('[data-testid="automations-route-shell"]')).toBe(null);
    });
    const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(promptInput.value).toBe(WORKBENCH_AUTOMATION_CREATE_WITH_CHAT_PROMPT);
    });
    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:create"
      && JSON.stringify(call[1]) === JSON.stringify({ projectId: "alpha", noThreadFallbackTitle: "New thread" })
    )).toBe(true);
    expect(startThreadForSessionCalls.length).toBe(0);
  });

  test("automations first-run suggestions pre-fill scheduled task chat prompts", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-first-run-suggestion" })],
      },
      scheduledAutomations: [],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const firstSuggestion = WORKBENCH_AUTOMATION_FIRST_RUN_SUGGESTIONS[0];
    if (!firstSuggestion) throw new Error("Expected first-run suggestion fixture");
    const suggestionNames = WORKBENCH_AUTOMATION_FIRST_RUN_SUGGESTIONS
      .map((suggestion) => suggestion.name)
      .join(",");
    const visibleSuggestionNames = WORKBENCH_AUTOMATION_FIRST_RUN_SUGGESTIONS
      .map((suggestion) => screen.getByRole("button", { name: suggestion.name }).textContent?.trim() ?? "")
      .join(",");
    expect(visibleSuggestionNames).toBe(suggestionNames);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: firstSuggestion.name }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      expect(screen.container.querySelector('[data-testid="automations-route-shell"]')).toBe(null);
    });
    const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(promptInput.value).toBe(firstSuggestion.prompt);
    });
    expect(startThreadForSessionCalls.length).toBe(0);
  });

  test("automations route confirms before discarding a changed create draft", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-discard" })],
      },
      scheduledAutomations: [],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText("New scheduled task options"), {
        button: 0,
        ctrlKey: false,
      });
      await Promise.resolve();
    });
    const createManuallyItem = await screen.findByRole("menuitem", { name: "Create manually" });
    await act(async () => {
      fireEvent.click(createManuallyItem);
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      nameInput.value = "Draft only";
      fireEvent.input(nameInput);
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse details" }));
      await Promise.resolve();
    });
    const discardDialog = await screen.findByRole("dialog");
    expect(textContent(discardDialog).includes("Discard scheduled task draft?")).toBe(true);
    expect(textContent(discardDialog).includes("Your changes to this scheduled task will be lost")).toBe(true);

    await act(async () => {
      fireEvent.click(within(discardDialog).getByRole("button", { name: "Keep editing" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBe(null);
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Draft only");
    expect(screen.container.querySelector('[data-testid="automation-detail-rail"]') !== null).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse details" }));
      await Promise.resolve();
    });
    const secondDiscardDialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(secondDiscardDialog).getByRole("button", { name: "Discard" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.container.querySelector('[data-testid="automation-detail-rail"]')).toBe(null);
    });
    expect(textContent(screen.container).includes("Create your first scheduled task")).toBe(true);
  });

  test("automations route opens system templates as create drafts", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-template" })],
      },
      scheduledAutomations: [],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Templates" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(textContent(screen.container).includes("Daily bug scan")).toBe(true);
      expect(textContent(screen.container).includes("System")).toBe(true);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("automation-template-daily-bug-scan"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="automation-detail-rail"]') !== null).toBe(true);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Daily bug scan");
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value.includes("Scan recent commits")).toBe(true);
    expect(textContent(screen.getByLabelText("Schedule")).includes("Daily at 9:00 AM")).toBe(true);
    expect(screen.getByRole("button", { name: "Personalize with Codex" }) !== null).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Personalize with Codex" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      expect(startThreadForSessionCalls.length).toBe(1);
    });
    const startInput = startThreadForSessionCalls[0] as {
      projectId?: string;
      sessionId?: string;
      prompt?: string;
      runInTarget?: string;
      collaborationMode?: string;
    } | undefined;
    expect(startInput?.projectId).toBe("alpha");
    expect(startInput?.sessionId).toBe("session:alpha:created");
    expect(startInput?.runInTarget).toBe("localProject");
    expect(startInput?.collaborationMode).toBe("default");
    expect(startInput?.prompt?.includes("mode: \"suggested_create\"")).toBe(true);
    expect(startInput?.prompt?.includes("Template: \"Daily bug scan\"")).toBe(true);
    expect(JSON.stringify(requestThreadStreamSnapshotCalls)).toBe(JSON.stringify(["thread-started"]));
    expect(screen.container.querySelector('[data-testid="automations-route-shell"]')).toBe(null);
  });

  test("automations route guards dirty template drafts but not unchanged template seeds", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-template-discard" })],
      },
      scheduledAutomations: [],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Templates" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("automation-template-daily-bug-scan") !== null).toBe(true);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("automation-template-daily-bug-scan"));
      await Promise.resolve();
    });
    await settleAsyncRender();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Daily bug scan");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBe(null);
      expect(screen.container.querySelector('[data-testid="automation-detail-rail"]')).toBe(null);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Templates" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("automation-template-daily-bug-scan"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
      promptInput.value = `${promptInput.value}\nAlso include CI failures.`;
      fireEvent.input(promptInput);
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
      await Promise.resolve();
    });
    const discardDialog = await screen.findByRole("dialog");
    expect(textContent(discardDialog).includes("Discard scheduled task draft?")).toBe(true);

    await act(async () => {
      fireEvent.click(within(discardDialog).getByRole("button", { name: "Keep editing" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBe(null);
      expect(screen.container.querySelector('[data-testid="automation-detail-rail"]') !== null).toBe(true);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
      await Promise.resolve();
    });
    const secondDiscardDialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(secondDiscardDialog).getByRole("button", { name: "Discard" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBe(null);
      expect(screen.container.querySelector('[data-testid="automation-detail-rail"]')).toBe(null);
      expect(textContent(screen.container).includes("Create your first scheduled task")).toBe(true);
    });
  });

  test("automations route exposes task row status and actions", async () => {
    installTerminalEventApiMock();
    const running = makeScheduledAutomation({
      id: "automation-running",
      name: "Running report",
      prompt: "Summarize the current report.",
      targetThreadId: "thread-running",
    });
    const active = makeScheduledAutomation({
      id: "automation-active",
      name: "Runnable task",
      prompt: "Run this on demand.",
      targetThreadId: "thread-active",
    });
    const paused = makeScheduledAutomation({
      id: "automation-paused",
      name: "Paused task",
      prompt: "Resume this later.",
      status: "PAUSED",
      targetThreadId: "thread-paused",
      nextRunAt: null,
    });
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-row-actions" })],
      },
      scheduledAutomations: [running, active, paused],
      automationInboxItems: [
        makeAutomationInboxItem({
          id: "run-running",
          automationId: "automation-running",
          automationName: "Running report",
          status: "IN_PROGRESS",
          readAt: null,
          threadId: "thread-run-running",
        }),
      ],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      expect(screen.container.querySelector('[data-testid="automations-route-shell"]') !== null).toBe(true);
      expect(textContent(screen.container).includes("Running report")).toBe(true);
    });
    await waitFor(() => {
      expect(textContent(screen.getByTestId("automation-list-row-automation-running")).includes("In progress")).toBe(true);
    });
    const runningRowText = textContent(screen.getByTestId("automation-list-row-automation-running"));
    expect(runningRowText.includes("Chat")).toBe(true);
    expect(runningRowText.includes("Daily")).toBe(true);

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("automation-list-row-automation-active")).getByRole("button", { name: "Run now" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getRunNowAutomationIds().length).toBe(1);
    });
    expect(screen.getRunNowAutomationIds()[0]).toBe("automation-active");
    expect(__getNodexToastSnapshotForTests().some((record) => (
      record.kind === "plain"
      && record.level === "info"
      && record.title === "Scheduled task started"
    ))).toBe(true);

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("automation-list-row-automation-active")).getByRole("button", { name: "Pause" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      const saved = screen.getScheduledAutomations().find((automation) => automation.id === "automation-active");
      expect(saved?.status).toBe("PAUSED");
    });

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("automation-list-row-automation-paused")).getByRole("button", { name: "Resume" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      const saved = screen.getScheduledAutomations().find((automation) => automation.id === "automation-paused");
      expect(saved?.status).toBe("ACTIVE");
    });

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("automation-list-row-automation-active")).getByRole("button", { name: "Delete" }));
      await Promise.resolve();
    });
    const deleteDialog = await screen.findByRole("dialog");
    expect(textContent(deleteDialog).includes("Delete Runnable task?")).toBe(true);
    await act(async () => {
      fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete scheduled task" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      const deleted = screen.getScheduledAutomations().find((automation) => automation.id === "automation-active") ?? null;
      expect(deleted).toBe(null);
    });
  });

  test("automations route rolls back optimistic status updates when update fails", async () => {
    installTerminalEventApiMock();
    const active = makeScheduledAutomation({
      id: "automation-optimistic",
      name: "Optimistic task",
      prompt: "Pause this optimistically.",
      targetThreadId: "thread-optimistic",
    });
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-optimistic" })],
      },
      scheduledAutomations: [active],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await waitFor(() => {
      expect(screen.container.querySelector('[data-testid="automations-route-shell"]') !== null).toBe(true);
      expect(screen.container.querySelector('[data-testid="automation-list-row-automation-optimistic"]') !== null).toBe(true);
    });

    let rejectUpdate: ((error: Error) => void) | null = null;
    const updatePromise = new Promise<never>((_resolve, reject) => {
      rejectUpdate = reject;
    });
    const baseMockInvokeImpl = mockInvokeImpl;
    mockInvokeImpl = async (channel, ...args) => {
      if (channel === "codex:scheduled-automations:update") {
        return await updatePromise;
      }
      return baseMockInvokeImpl?.(channel, ...args) ?? null;
    };

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("automation-list-row-automation-optimistic")).getByRole("button", { name: "Pause" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(within(screen.getByTestId("automation-list-row-automation-optimistic")).getByRole("button", { name: "Resume" }) !== null).toBe(true);
    });
    const backendAutomation = screen.getScheduledAutomations().find((automation) => automation.id === "automation-optimistic");
    expect(backendAutomation?.status).toBe("ACTIVE");

    await act(async () => {
      rejectUpdate?.(new Error("Host update failed"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(within(screen.getByTestId("automation-list-row-automation-optimistic")).getByRole("button", { name: "Pause" }) !== null).toBe(true);
    });
    expect(__getNodexToastSnapshotForTests().some((record) => (
      record.kind === "plain"
      && record.level === "danger"
      && record.title === "Could not update scheduled task"
      && record.description === "Host update failed"
    ))).toBe(true);
  });

  test("automations route reports run-now host failures with the scheduled task toast title", async () => {
    installTerminalEventApiMock();
    const active = makeScheduledAutomation({
      id: "automation-active",
      name: "Runnable task",
      rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      cwds: ["/Users/asc/repo/nodex"],
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/Users/asc/repo/nodex")],
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-row-actions" })],
      },
      scheduledAutomations: [active],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    const baseMockInvokeImpl = mockInvokeImpl;
    mockInvokeImpl = async (channel, ...args) => {
      if (channel === "codex:scheduled-automations:run-now") {
        throw new Error("Automation is missing");
      }
      return baseMockInvokeImpl?.(channel, ...args) ?? null;
    };

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("automation-list-row-automation-active")).getByRole("button", { name: "Run now" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(__getNodexToastSnapshotForTests().some((record) => (
        record.kind === "plain"
        && record.level === "danger"
        && record.title === "Could not start scheduled task"
        && record.description === "Automation is missing"
      ))).toBe(true);
    });
  });

  test("automations route reports delete failures with the scheduled task toast title", async () => {
    installTerminalEventApiMock();
    const active = makeScheduledAutomation({
      id: "automation-delete-failure",
      name: "Delete failure task",
      rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      cwds: ["/Users/asc/repo/nodex"],
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/Users/asc/repo/nodex")],
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-delete-failure" })],
      },
      scheduledAutomations: [active],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    const baseMockInvokeImpl = mockInvokeImpl;
    mockInvokeImpl = async (channel, ...args) => {
      if (channel === "codex:scheduled-automations:delete") {
        return {
          item: active,
          success: false,
          status: "remove_failed",
        };
      }
      return baseMockInvokeImpl?.(channel, ...args) ?? null;
    };

    await act(async () => {
      fireEvent.click(within(screen.getByTestId("automation-list-row-automation-delete-failure")).getByRole("button", { name: "Delete" }));
      await Promise.resolve();
    });
    const deleteDialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete scheduled task" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(__getNodexToastSnapshotForTests().some((record) => (
        record.kind === "plain"
        && record.level === "danger"
        && record.title === "Could not delete scheduled task"
        && record.description === "Try again."
      ))).toBe(true);
    });
    expect(screen.getScheduledAutomations().length).toBe(1);
  });

  test("automations route renders previous runs with read, archive, unarchive, and delete actions", async () => {
    installTerminalEventApiMock();
    const automation = makeScheduledAutomation({
      id: "automation-history",
      kind: "cron",
      name: "History task",
      prompt: "Summarize the previous run history.",
      targetThreadId: null,
      model: "gpt-5",
      reasoningEffort: "low",
      cwds: ["/tmp/project-alpha"],
    });
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-history" })],
      },
      scheduledAutomations: [automation],
      automationInboxItems: [
        makeAutomationInboxItem({
          id: "thread-run-latest",
          threadId: "thread-run-latest",
          automationId: "automation-history",
          automationName: "History task",
          title: "Latest history run",
          description: "Ready for review.",
          sourceCwd: "/tmp/project-alpha",
          createdAt: 300,
          readAt: null,
          status: "PENDING_REVIEW",
        }),
        makeAutomationInboxItem({
          id: "thread-run-archived",
          threadId: "thread-run-archived",
          automationId: "automation-history",
          automationName: "History task",
          title: "Archived history run",
          description: "Already archived.",
          sourceCwd: "/tmp/project-alpha",
          createdAt: 200,
          readAt: 50,
          status: "ARCHIVED",
        }),
        makeAutomationInboxItem({
          id: "thread-run-other",
          threadId: "thread-run-other",
          automationId: "automation-other",
          automationName: "Other task",
          title: "Other task run",
          createdAt: 400,
        }),
      ],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scheduled" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByTestId("automation-list-row-automation-history"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(textContent(screen.container).includes("Previous runs")).toBe(true);
      expect(textContent(screen.container).includes("Latest history run")).toBe(true);
      expect(textContent(screen.container).includes("Archived history run")).toBe(true);
      expect(textContent(screen.container).includes("project-alpha")).toBe(true);
      expect(textContent(screen.container).includes("Other task run")).toBe(false);
    });

    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText("Previous runs actions"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const markAllRead = await screen.findByRole("menuitem", { name: "Mark all as read" });
    await act(async () => {
      fireEvent.click(markAllRead);
      await Promise.resolve();
    });
    await waitFor(() => {
      const latest = screen.getAutomationInboxItems().find((item) => item.threadId === "thread-run-latest");
      expect(latest?.readAt !== null).toBe(true);
    });

    await act(async () => {
      const latestRun = within(screen.getByTestId("automation-previous-run-thread-run-latest")).getByRole("button", { name: "Latest history run" });
      fireEvent.contextMenu(latestRun);
      await Promise.resolve();
    });
    const archiveItem = await screen.findByRole("menuitem", { name: "Archive" });
    await act(async () => {
      fireEvent.click(archiveItem);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Archive 1 run?" }) !== null).toBe(true);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      const latest = screen.getAutomationInboxItems().find((item) => item.threadId === "thread-run-latest");
      expect(latest?.status).toBe("ARCHIVED");
    });

    await act(async () => {
      const archivedRun = within(screen.getByTestId("automation-previous-run-thread-run-archived")).getByRole("button", { name: "Archived history run" });
      fireEvent.contextMenu(archivedRun);
      await Promise.resolve();
    });
    const unarchiveItem = await screen.findByRole("menuitem", { name: "Unarchive" });
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBe(null);
    await act(async () => {
      fireEvent.click(unarchiveItem);
      await Promise.resolve();
    });
    await waitFor(() => {
      const archived = screen.getAutomationInboxItems().find((item) => item.threadId === "thread-run-archived");
      expect(archived?.status).toBe("ACCEPTED");
    });

    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText("Previous runs actions"), { button: 0, ctrlKey: false });
      await Promise.resolve();
    });
    const archiveAllItem = await screen.findByRole("menuitem", { name: "Archive all" });
    await act(async () => {
      fireEvent.click(archiveAllItem);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Archive 1 run?" }) !== null).toBe(true);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      const archived = screen.getAutomationInboxItems().find((item) => item.threadId === "thread-run-archived");
      expect(archived?.status).toBe("ARCHIVED");
      expect(__getNodexToastSnapshotForTests().some((record) => (
        record.kind === "plain"
        && record.level === "success"
        && record.title === "Archived 1 run"
      ))).toBe(true);
    });
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
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list" && call[1] === "alpha")).toBe(true);
  });

  test("inline message edit calls rollback edit without refreshing source-null snapshot or seeding composer intent", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
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
    expect(JSON.stringify(requestThreadStreamSnapshotCalls)).toBe(JSON.stringify([]));
    expect(setComposerIntentCalls.length).toBe(0);
  });

  test("session thread actions wire queued follow-up, plan, and background terminal commands", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
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
            id: "session:beta:database-view",
            projectId: "beta",
            title: "Database View",
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
    expect(JSON.stringify(propsAfter?.newThreadTarget).includes('"projectId":"beta"')).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-sessions:create"
      && JSON.stringify(call[1]) === JSON.stringify({ projectId: "beta", noThreadFallbackTitle: "New thread" })
    )).toBe(true);
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
    expect(invokeCalls.some((call) => call[0] === "project-sessions:list" && call[1] === "beta")).toBe(true);
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
    expect(JSON.stringify(propsAfter?.newThreadTarget).includes('"runInTarget":"newWorktree"')).toBe(true);

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

  }

  if (scope === "layout-panel-actions") {
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
    expect(globalHeader?.contains(toggleButton)).toBe(true);
    expect(toggleButton.getAttribute("aria-pressed")).toBe("false");
    expect(toggleButton.className.includes("no-drag")).toBe(true);
    expect(toggleIconPath.startsWith(CODEX_PANEL_VISIBLE_ICON_PREFIX)).toBe(true);
    expect(screen.queryByRole("button", { name: "Attach thread" })).toBe(null);
    expect(screen.queryByRole("button", { name: "Detach thread" })).toBe(null);

    await act(async () => {
      fireEvent.click(toggleButton);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:database-view"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
    )).toBe(true);
    expect(screen.queryAllByRole("tablist").length > 0).toBe(true);
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
    expect(globalHeader?.contains(bottomPanelToggle)).toBe(true);
    expect((bottomPanelToggle.compareDocumentPosition(sidePanelToggle) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect(bottomPanelToggle.getAttribute("aria-pressed")).toBe("false");
    expect(bottomPanelToggle.className.includes("no-drag")).toBe(true);
    expect(toggleIconPath.startsWith(CODEX_BOTTOM_PANEL_HIDDEN_ICON_PREFIX)).toBe(true);
    expect(screen.queryByTestId("session-bottom-panel")).toBe(null);

    await act(async () => {
      fireEvent.click(bottomPanelToggle);
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:database-view"
      && call[2] === "bottom"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
    )).toBe(true);
    expect(screen.queryByTestId("session-bottom-panel") !== null).toBe(true);
  });

  test("thread summary toggle defaults to pinned open and persists collapsed state", async () => {
    setWindowInnerWidthForTest(1400);
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeAttachedSession({
            id: "session:alpha:thread",
            title: "Thread",
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
    expect(within(globalHeader).queryByRole("button", { name: "Toggle pinned summary" }) !== null).toBe(true);
    expect(globalHeader.contains(summaryRail)).toBe(true);
    expect(summaryRail.querySelector('[data-workbench-header-action-rail="visible"]') !== null).toBe(true);
    expect(within(summaryRail).queryByRole("button", { name: "Toggle pinned summary" }) !== null).toBe(true);
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
    expect(threadFrame !== null).toBe(true);
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBe(true);
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
    expect(threadFrame !== null).toBe(true);
    expect(screen.container.querySelector("[data-app-shell-main-content-header-divider]") === null).toBe(true);
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
    })).toBe(true);

    setWindowInnerWidthForTest(719);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    await waitFor(() => {
      expect(screen.queryByTestId("project-session-sidebar") === null).toBe(true);
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
    expect(within(globalHeader).queryByRole("button", { name: "Toggle summary" }) !== null).toBe(true);
    expect(globalHeader.contains(summaryRail)).toBe(true);
    expect(within(summaryRail).queryByRole("button", { name: "Toggle summary" }) !== null).toBe(true);
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
    expect(globalHeader.className.includes(APP_SHELL_GLOBAL_HEADER_LAYER_CLASS)).toBe(true);
    expect(headerCenterSurface.getAttribute("aria-hidden")).toBe("true");
    expect(headerCenterSurface.className.includes("invisible")).toBe(true);
    expect(rightPanel.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(rightPanel.getAttribute("data-app-shell-focus-area")).toBe("right-panel");
    expect(rightPanel.className.includes(APP_SHELL_RIGHT_PANEL_LAYER_CLASS)).toBe(true);
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

      expect(leftSlot.getAttribute("style")?.includes("width: 0px")).toBe(true);
      expect(leftSlot.getAttribute("style")?.includes("min-width: 208px")).toBe(true);
      expect(leftSlot.className.includes("no-drag")).toBe(true);
      expect(tabHeader.className.includes("draggable")).toBe(false);
      expect(within(leftSlot).getByRole("button", { name: "New chat" }) !== null).toBe(true);
      expect(rightSlot.getAttribute("style")?.includes("width: 0px")).toBe(true);
      expect(rightSlot.getAttribute("style")?.includes("min-width: 70px")).toBe(true);
      expect(rightSlot.className.includes("no-drag")).toBe(true);
      expect(leadingSpacer?.getAttribute("style")?.includes("width: 208px")).toBe(true);
      expect(leadingSpacer?.className.includes("pointer-events-none")).toBe(true);
      expect(leadingSpacer?.className.includes("no-drag")).toBe(true);
      expect(tabRow?.querySelector('[role="tablist"]') !== null).toBe(true);
      expect(tabHeader.contains(restoreButton)).toBe(true);
      expect(trailingSpacer?.getAttribute("style")?.includes("width: calc(70px)")).toBe(true);
      expect(trailingSpacer?.className.includes("no-drag")).toBe(true);
      expect(screen.container.querySelector('[data-testid="right-panel-global-header-actions"]') === null).toBe(true);

      await moveSidebarPointer(900);
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]')).toBe(null);

      await act(async () => {
        restoreButton.focus();
        await Promise.resolve();
      });
      await settleAsyncRender();
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]')).toBe(null);

      await moveSidebarPointer(12);
      const floatingShell = screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') as HTMLElement | null;
      expect(floatingShell !== null).toBe(true);
      expect(floatingShell?.className.includes(APP_SHELL_FLOATING_LEFT_PANEL_LAYER_CLASS)).toBe(true);

      await moveSidebarPointer(301);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
      await settleAsyncRender();
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]')).toBe(null);

      await act(async () => {
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
    const attachedSession = makeAttachedSession({
      rightFullWidth: true,
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [attachedSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    const rightPanel = screen.getByTestId("session-right-panel");
    const host = rightPanel.querySelector('[data-right-panel-composer-overlay-host="true"]');
    const props = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(host !== null).toBe(true);
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
    )).toBe(true);
    expect(screen.queryByTestId("session-bottom-panel") !== null).toBe(true);
  });

  test("full-width overlay state keeps the side-panel toggle clickable after pointerdown", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:overlay-side-toggle",
      rightFullWidth: true,
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
    )).toBe(true);
  });

  test("full-width overlay state keeps restore-panel-width clickable after pointerdown", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:overlay-restore",
      rightFullWidth: true,
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
    })).toBe(true);
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

  test("toggles the active card-stage history overlay from the toolbar", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:history-toggle",
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
      }),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.queryByTestId("card-history-panel")).toBe(null);
    let cardStageProps = (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
    expect(cardStageProps?.historyPanelActive).toBe(false);

    await pointerActivate(screen.getByRole("button", { name: "History" }));
    await settleAsyncRender();

    const openedPanel = screen.getByTestId("card-history-panel");
    expect(openedPanel.getAttribute("data-project-id")).toBe("alpha");
    expect(openedPanel.getAttribute("data-card-id")).toBe("card-1");
    cardStageProps = (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
    expect(cardStageProps?.historyPanelActive).toBe(true);
    const historyPanelProps = (globalThis as { __lastHistoryPanelProps?: Record<string, unknown> }).__lastHistoryPanelProps;
    expect(typeof historyPanelProps?.onCardMutated).toBe("function");

    await pointerActivate(screen.getByRole("button", { name: "History" }));
    await settleAsyncRender();

    expect(screen.queryByTestId("card-history-panel")).toBe(null);
    cardStageProps = (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
    expect(cardStageProps?.historyPanelActive).toBe(false);

    await pointerActivate(screen.getByRole("button", { name: "History" }));
    await settleAsyncRender();
    await pointerActivate(screen.getByRole("button", { name: "Close history panel" }));
    await settleAsyncRender();

    expect(screen.queryByTestId("card-history-panel")).toBe(null);
    cardStageProps = (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
    expect(cardStageProps?.historyPanelActive).toBe(false);
  });

  test("closes the card-stage history modal when the owning tab closes", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:history-close-owner",
      tabs: [
        {
          id: "db-tab",
          kind: "db_view",
          title: "DB View",
          config: { projectId: "alpha", view: "kanban" },
        },
        {
          id: "card-stage-tab",
          kind: "card_stage",
          title: "Card One",
          config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
        },
      ],
      panels: makePanels({
        rightTabIds: ["db-tab", "card-stage-tab"],
        rightActiveTabId: "card-stage-tab",
      }),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await settleAsyncRender();

    await pointerActivate(screen.getByRole("button", { name: "History" }));
    await settleAsyncRender();
    expect(screen.queryByTestId("card-history-panel") !== null).toBe(true);

    await pointerActivate(screen.getByRole("button", { name: "Close Card One tab" }));
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.queryByTestId("card-history-panel")).toBe(null);
    const historyPanelProps = (globalThis as { __lastHistoryPanelProps?: Record<string, unknown> }).__lastHistoryPanelProps;
    expect(historyPanelProps?.open).toBe(false);
  });

  test("regular width and terminal right-panel tabs do not enable the root composer overlay", async () => {
    const regularSession = makeAttachedSession({
      id: "session:alpha:regular",
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
      rightFullWidth: true,
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

  test("open session right panel keeps side toggle global and expands from the tab header", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            id: "session:alpha:build",
            title: "Build",
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
    expect(globalHeader?.contains(sidePanelToggle)).toBe(true);
    expect(headerShellSlot?.contains(sidePanelToggle)).toBe(true);
    expect(visibleGlobalHeaderButtons.map((button) => button.getAttribute("aria-label")).join(",")).toBe("Toggle bottom panel,Toggle side panel");
    expect(rightPanel?.className.includes(APP_SHELL_RIGHT_PANEL_LAYER_CLASS)).toBe(true);
    expect(globalHeader?.className.includes(APP_SHELL_GLOBAL_HEADER_LAYER_CLASS)).toBe(true);
    expect(headerCenterSurface.getAttribute("aria-hidden")).toBe(null);
    expect(headerCenterSurface.className.includes("invisible")).toBe(false);
    expect(headerShellSlot?.className.includes("no-drag")).toBe(true);
    await waitFor(() => {
      expect(headerShellSlot?.getAttribute("style")?.includes("width: 372px")).toBe(true);
    });
    expect(headerShellSlot?.getAttribute("style")?.includes("min-width: 70px")).toBe(true);
    expect(sidePanelToggle.getAttribute("aria-pressed")).toBe("true");
    expect(globalHeader?.contains(expandButton)).toBe(false);
    expect(tabHeader.contains(expandButton)).toBe(true);
    expect(tabHeader.className.includes("draggable")).toBe(false);
    expect(expandButton.parentElement?.className.includes("pointer-events-auto")).toBe(true);
    expect(rightPanelHeaderSpacer?.className.includes("pointer-events-none")).toBe(true);
    expect(rightPanelHeaderSpacer?.className.includes("no-drag")).toBe(true);
    expect(rightPanelHeaderSpacer?.parentElement?.className.includes("pointer-events-auto")).toBe(false);
    expect(rightPanelHeaderSpacer?.parentElement?.className.includes("no-drag")).toBe(true);
    expect(rightPanelHeaderSpacer?.parentElement?.getAttribute("role")).toBe("presentation");
    expect(expandButton.className.includes("no-drag")).toBe(true);
    expect(expandIconPath.startsWith(CODEX_EXPAND_PANEL_ICON_PREFIX)).toBe(true);
    expect(rightPanelHeaderSpacer?.getAttribute("style")?.includes("width: calc(70px)")).toBe(true);
    expect(screen.container.querySelector('[data-testid="right-panel-global-header-actions"]') === null).toBe(true);

    await act(async () => {
      fireEvent.click(expandButton);
      await Promise.resolve();
    });

    const threadPage = screen.container.querySelector('[data-testid="session-thread-page"]');
    expect(rightPanel?.getAttribute("data-right-panel-width-mode")).toBe("full");
    expect(rightPanel?.getAttribute("data-app-shell-focus-area")).toBe("right-panel");
    expect(rightPanel?.className.includes(APP_SHELL_RIGHT_PANEL_LAYER_CLASS)).toBe(true);
    expect(globalHeader?.className.includes(APP_SHELL_GLOBAL_HEADER_LAYER_CLASS)).toBe(true);
    expect(headerCenterSurface.getAttribute("aria-hidden")).toBe("true");
    expect(headerCenterSurface.className.includes("invisible")).toBe(true);
    expect(rightPanel?.className.includes("shadow-xl")).toBe(false);
    expect(threadPage?.getAttribute("data-session-thread-page-hidden")).toBe("true");
    expect(threadPage?.className.includes("w-0")).toBe(true);
    expect(threadPage?.className.includes("flex-none")).toBe(true);
    expect(headerShellSlot?.getAttribute("style")?.includes("width: 0px")).toBe(true);
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).toBe(null);
    const fullWidthTabHeader = rightPanel?.querySelector('[role="tablist"]')?.parentElement?.parentElement;
    expect(fullWidthTabHeader?.firstElementChild?.querySelector('[role="tablist"]') !== null).toBe(true);
    const restoreButton = screen.getByRole("button", { name: "Restore panel width" });
    expect(globalHeader?.contains(restoreButton)).toBe(false);
    expect(fullWidthTabHeader?.contains(restoreButton)).toBe(true);
    expect(restoreButton.getAttribute("aria-pressed")).toBe("true");
    expect(restoreButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_RESTORE_PANEL_ICON_PREFIX)).toBe(true);
  });

  test("right panel resize previews the dragged width before persistence", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            id: "session:alpha:build",
            title: "Build",
            rightCollapsed: false,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const rightPanel = screen.getByTestId("session-right-panel");
    const separator = screen.getByRole("separator", { name: "Resize right panel" });
    let capturedPointerId: number | null = null;
    separator.setPointerCapture = (pointerId: number) => {
      capturedPointerId = pointerId;
    };
    await waitFor(() => {
      expect(rightPanel.getAttribute("style")?.includes("width: 372px")).toBe(true);
    });

    try {
      await act(async () => {
        fireEvent.pointerDown(separator, { button: 0, pointerId: 7, clientX: 700 });
        fireEvent.pointerMove(window, { pointerId: 7, clientX: 750 });
        await Promise.resolve();
      });

      expect(capturedPointerId).toBe(7);
      await waitFor(() => {
        expect(rightPanel.getAttribute("style")?.includes("width: 322px")).toBe(true);
      });
      expect(invokeCalls.some((call) =>
        call[0] === "project-session-panels:update"
        && call[1] === "session:alpha:build"
        && call[2] === "right"
        && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 322
      )).toBe(false);
    } finally {
      await releasePointerDrag(7);
    }

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 322
    )).toBe(true);
  });

  test("right panel resize can grow well beyond the default width on wide shells", async () => {
    setWindowInnerWidthForTest(1800);
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            id: "session:alpha:build",
            title: "Build",
            rightCollapsed: false,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const rightPanel = screen.getByTestId("session-right-panel");
    const separator = screen.getByRole("separator", { name: "Resize right panel" });

    try {
      await act(async () => {
        fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 1_200 });
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 400 });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(rightPanel.getAttribute("style")?.includes("width: 1148px")).toBe(true);
      });
    } finally {
      await releasePointerDrag();
    }

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 1148
    )).toBe(true);
  });

  test("right panel resize closes the side panel when dragged below Codex minimum width", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            id: "session:alpha:build",
            title: "Build",
            rightCollapsed: false,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const separator = screen.getByRole("separator", { name: "Resize right panel" });
    await act(async () => {
      fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 700 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 1_020 });
      await Promise.resolve();
    });
    await releasePointerDrag();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: true })
    )).toBe(true);
    expect(screen.queryByRole("separator", { name: "Resize right panel" })).toBe(null);
  });

  test("right panel resize normalizes drag deltas by the Codex window zoom", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            id: "session:alpha:build",
            title: "Build",
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

    try {
      await act(async () => {
        fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 1_400 });
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 1_500 });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(rightPanel.getAttribute("style")?.includes("width: 322px")).toBe(true);
      });
    } finally {
      await releasePointerDrag();
    }

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:build"
      && call[2] === "right"
      && ((call[3] as { size?: { widthPx?: number } })?.size?.widthPx ?? null) === 322
    )).toBe(true);
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
    expect(bottomPanelSizer.getAttribute("style")?.includes("height: 280px")).toBe(true);

    try {
      await act(async () => {
        fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientY: 700 });
        fireEvent.pointerMove(window, { pointerId: 1, clientY: 740 });
        await Promise.resolve();
      });

      expect(bottomPanelSizer.getAttribute("style")?.includes("height: 240px")).toBe(true);
      expect(invokeCalls.some((call) =>
        call[0] === "project-session-panels:update"
        && call[1] === "session:alpha:terminal"
        && call[2] === "bottom"
        && ((call[3] as { size?: { heightPx?: number } })?.size?.heightPx ?? null) === 240
      )).toBe(false);
    } finally {
      await releasePointerDrag();
    }

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:terminal"
      && call[2] === "bottom"
      && ((call[3] as { size?: { heightPx?: number } })?.size?.heightPx ?? null) === 240
    )).toBe(true);
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
      fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientY: 700 });
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 900 });
      await Promise.resolve();
    });
    await releasePointerDrag();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-panels:update"
      && call[1] === "session:alpha:terminal"
      && call[2] === "bottom"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: true })
    )).toBe(true);
    expect(screen.queryByRole("separator", { name: "Resize bottom panel" })).toBe(null);
  });

  test("terminal backend exit closes the owning terminal tab", async () => {
    const terminalEventListeners = installTerminalEventApiMock();
    const terminalSession = makeBottomPanelTerminalSession();
    renderWorkbench({
      sessionsByProject: { alpha: [terminalSession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(typeof terminalEventListeners["terminal-exit"]).toBe("function");

    await act(async () => {
      terminalEventListeners["terminal-exit"]?.({
        sessionId: "terminal",
        exitCode: 0,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(JSON.stringify(getProjectSessionTabDeleteTabIds())).toBe(JSON.stringify(["terminal-tab"]));
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
    expect(regularThreadPage?.className.split(/\s+/).includes("w-0")).toBe(false);
    expect(expandButton.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle side panel" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.queryByRole("button", { name: "Restore panel width" })).toBe(null);
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
    expect(restoredThreadPage?.className.split(/\s+/).includes("w-0")).toBe(false);
    expect(restoredExpandButton.getAttribute("aria-pressed")).toBe("false");
  });

  test("previewable right-panel add actions pin only after panel interaction", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const globalHeader = screen.container.querySelector('[data-testid="workbench-global-header"]');
    const addTabButton = screen.getByRole("button", { name: "Open side panel tab" });
    expect(globalHeader?.contains(addTabButton)).toBe(false);
    expect(screen.queryByRole("button", { name: "Add DB view" })).toBe(null);

    const menu = await openPanelMenu(screen, "Open side panel tab");
    await clickMenuItem(menu, "Files");

    expect(screen.getByRole("tab", { name: "Files" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);

    await pointerDownAndSettle(getFilesPreviewInteractionTarget(screen));
    await waitFor(() => {
      expect(invokeCalls.some((call) =>
        call[0] === "project-session-tabs:create"
        && JSON.stringify(call[1]).includes('"kind":"files"')
      )).toBe(true);
    });

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"files"')
    )).toBe(true);
  });

  test("proposed-plan side panel opens as a renderer-local singleton tab", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ rightCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    let stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(stageProps?.planSidePanelState)).toBe(JSON.stringify({
      rightPanelEnabled: true,
      activePlanKey: null,
      activeRightPanelTabId: null,
    }));

    const actions = getLastThreadStageActions();
    const openPlan = actions.onOpenPlanInSidePanel as ((input: {
      planKey: string;
      threadId: string;
      turnId: string;
      itemId: string;
      content: string;
      cwd: string | null;
    }) => Promise<void>) | undefined;
    expect(typeof openPlan).toBe("function");
    const closePlan = actions.onClosePlanSidePanel as ((input: { planKey: string }) => Promise<void>) | undefined;
    expect(typeof closePlan).toBe("function");

    await act(async () => {
      await openPlan?.({
        planKey: "turn-plan-1",
        threadId: "thread-alpha",
        turnId: "turn-plan-1",
        itemId: "plan-item-1",
        content: "# First plan\n\nUse the side panel.",
        cwd: "/Users/asc/repo/nodex",
      });
    });
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "Plan" }) !== null).toBe(true);
    expect(textContent(screen.container).includes("First plan")).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);

    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(stageProps?.planSidePanelState)).toBe(JSON.stringify({
      rightPanelEnabled: true,
      activePlanKey: "turn-plan-1",
      activeRightPanelTabId: "plan",
    }));

    await act(async () => {
      await openPlan?.({
        planKey: "turn-plan-2",
        threadId: "thread-alpha",
        turnId: "turn-plan-2",
        itemId: "plan-item-2",
        content: "# Second plan\n\nReplace the singleton content.",
        cwd: "/Users/asc/repo/nodex",
      });
    });
    await settleAsyncRender();

    const planTabs = screen.getAllByRole("tab").filter((tab) => textContent(tab).includes("Plan"));
    expect(planTabs.length).toBe(1);
    expect(textContent(screen.container).includes("First plan")).toBe(false);
    expect(textContent(screen.container).includes("Second plan")).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);

    stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(stageProps?.planSidePanelState)).toBe(JSON.stringify({
      rightPanelEnabled: true,
      activePlanKey: "turn-plan-2",
      activeRightPanelTabId: "plan",
    }));
  });

  test("summary output side-panel opener creates a renderer-local Files preview tab", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ rightCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    const openOutput = actions.onOpenSummaryOutputInSidePanel as ((input: {
      path: string;
      title: string;
    }) => Promise<boolean>) | undefined;
    expect(typeof openOutput).toBe("function");

    let opened = false;
    await act(async () => {
      opened = await openOutput?.({
        path: "/Users/asc/repo/nodex/reports/summary.txt",
        title: "summary.txt",
      }) ?? false;
    });
    await settleAsyncRender();

    expect(opened).toBe(true);
    expect(screen.getByRole("tab", { name: "summary.txt" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
  });

  test("summary output side-panel opener supports projectless file previews", async () => {
    const projectlessSession = makeAttachedSession({
      id: "session:projectless:summary-output",
      projectId: null,
      title: "Projectless output",
      threadId: "thread-projectless-output",
      rightCollapsed: true,
      tabs: [],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [] },
      projectlessSessions: [projectlessSession],
      initialActiveProjectSessionId: projectlessSession.id,
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await waitFor(() => {
      expect(getThreadRow(screen.container, "Projectless output") !== null).toBe(true);
    });
    await act(async () => {
      fireEvent.click(getThreadRow(screen.container, "Projectless output"));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await waitFor(() => {
      expect(Boolean((globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps?.actions)).toBe(true);
    });

    const actions = getLastThreadStageActions();
    const openOutput = actions.onOpenSummaryOutputInSidePanel as ((input: {
      path: string;
      title: string;
    }) => Promise<boolean>) | undefined;
    expect(typeof openOutput).toBe("function");

    let opened = false;
    await act(async () => {
      opened = await openOutput?.({
        path: "/Users/asc/Downloads/nodex-output/report.md",
        title: "report.md",
      }) ?? false;
    });
    await settleAsyncRender();

    expect(opened).toBe(true);
    expect(screen.getByRole("tab", { name: "report.md" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-workspace-files-session-id="session:projectless:summary-output"]') !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
  });

  test("right-panel add menu keeps custom action icons compact", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const menu = await openPanelMenu(screen, "Open side panel tab");
    expectPanelMenuDescriptionsHidden(menu);

    for (const label of ["Review", "Terminal", "Browser", "Files", "Side chat"]) {
      const className = getMenuItemIconClassName(menu, label);
      expect(className.includes("icon-sm")).toBe(true);
      expect(className.includes("icon-md")).toBe(false);
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

    const filesMenu = await openPanelMenu(screen, "Open side panel tab");
    await clickMenuItem(filesMenu, "Files");

    expect(screen.getByRole("tab", { name: "Files" }) !== null).toBe(true);

    const browserMenu = await openPanelMenu(screen, "Open side panel tab");
    await clickMenuItem(browserMenu, "Browser");

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "Files" })).toBe(null);
    });
    expect(screen.getByRole("tab", { name: "Browser" }) !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
  });

  test("empty right panel renders Codex-style new-tab actions", async () => {
    const emptySession = makeSession({
      id: "session:alpha:empty",
      tabs: [],
      rightLayout: makePanelLayout([], null),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [emptySession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actionGrid = screen.container.querySelector('[data-thread-side-panel-new-tab-action-grid="true"]');
    expect(actionGrid !== null).toBe(true);
    if (!actionGrid) throw new Error("Expected right-panel action grid");
    const actionText = textContent(actionGrid);
    expect(actionText.indexOf("Review") < actionText.indexOf("Terminal")).toBe(true);
    expect(actionText.indexOf("Terminal") < actionText.indexOf("Browser")).toBe(true);
    expect(actionText.indexOf("Browser") < actionText.indexOf("Files")).toBe(true);
    expect(actionText.indexOf("Files") < actionText.indexOf("Side chat")).toBe(true);
    expect(screen.getByRole("button", { name: /Review/ }) !== null).toBe(true);
    expect(screen.getByRole("button", { name: /Terminal/ }) !== null).toBe(true);
    expect(screen.getByRole("button", { name: /Browser/ }) !== null).toBe(true);
    expect(screen.getByRole("button", { name: /Files/ }) !== null).toBe(true);
    expect(screen.getByRole("button", { name: /Side chat/ }) !== null).toBe(true);
    expect(screen.getByRole("button", { name: /DB View/ }) !== null).toBe(true);
    expect(screen.getByRole("button", { name: /Card Stage/ }) !== null).toBe(true);
    expect(actionText.indexOf("Side chat") < actionText.indexOf("DB View")).toBe(true);
    expect(actionText.indexOf("DB View") < actionText.indexOf("Card Stage")).toBe(true);
    expect(textContent(actionGrid).includes("⌃⇧G")).toBe(true);
    expect(textContent(actionGrid).includes("⌃`")).toBe(true);
    expect(textContent(actionGrid).includes("Ctrl+T")).toBe(true);
    expect(textContent(actionGrid).includes("Ctrl+Shift+E")).toBe(true);
    expect(textContent(actionGrid).includes("Alt+Ctrl+S")).toBe(true);
  });

  test("bottom panel add menu shows Codex-eligible non-default actions", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    expect(within(menu).getByText("Files") !== null).toBe(true);
    expect(within(menu).getByText("Side chat") !== null).toBe(true);
    expect(within(menu).getByText("Browser") !== null).toBe(true);
    expect(within(menu).queryByText("Review")).toBe(null);
    expect(within(menu).getByText("Terminal") !== null).toBe(true);
    expect(within(menu).queryByText("DB View")).toBe(null);
    expect(within(menu).queryByText("Card Stage")).toBe(null);
    expect(textContent(menu).includes("⌃`")).toBe(true);
  });

  test("right panel keeps Nodex-only actions after Codex actions", async () => {
    const emptySession = makeSession({
      id: "session:alpha:nodex-actions",
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
    expect(menuText.indexOf("Review") < menuText.indexOf("Terminal")).toBe(true);
    expect(menuText.indexOf("Side chat") < menuText.indexOf("DB View")).toBe(true);
    expect(menuText.indexOf("DB View") < menuText.indexOf("Card Stage")).toBe(true);
  });

  test("empty right panel DB View action creates the current project tab directly", async () => {
    const emptySession = makeSession({
      id: "session:alpha:db-direct",
      tabs: [],
      rightLayout: makePanelLayout([], null),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [emptySession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await pointerActivate(screen.getByRole("button", { name: /DB View/ }));
    await settleAsyncRender();

    expect(screen.queryByRole("dialog", { name: "Open DB view" })).toBe(null);
    const createCall = invokeCalls.find((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"db_view"')
    );
    expect(createCall !== undefined).toBe(true);
    expect(JSON.stringify(createCall?.[1]).includes('"targetLeafId"')).toBe(true);
    expect(JSON.stringify((createCall?.[1] as { config?: unknown } | undefined)?.config)).toBe(
      JSON.stringify({ projectId: "alpha", view: "kanban" }),
    );
  });

  test("right panel DB View action opens the picker after the current project DB exists", async () => {
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: { alpha: [makeSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const menu = await openPanelMenu(screen, "Open side panel tab");
    const dbViewText = within(menu).getByText("DB View");
    const dbViewItem = dbViewText.closest('[role="menuitem"]');
    if (!(dbViewItem instanceof HTMLElement)) {
      throw new Error("Expected DB View menu item");
    }
    await act(async () => {
      fireEvent.pointerMove(dbViewItem, { pointerType: "mouse" });
      fireEvent.keyDown(dbViewItem, { key: "ArrowRight" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Open DB view" }) !== null).toBe(true);
    });
    expect(screen.getByRole("option", { name: /Alpha/ }) !== null).toBe(true);
    expect(screen.getByRole("option", { name: /Beta/ }) !== null).toBe(true);

    invokeCalls = [];
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Alpha/ }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);

    const betaMenu = await openPanelMenu(screen, "Open side panel tab");
    const betaDbViewText = within(betaMenu).getByText("DB View");
    const betaDbViewItem = betaDbViewText.closest('[role="menuitem"]');
    if (!(betaDbViewItem instanceof HTMLElement)) {
      throw new Error("Expected DB View menu item");
    }
    await act(async () => {
      fireEvent.pointerMove(betaDbViewItem, { pointerType: "mouse" });
      fireEvent.keyDown(betaDbViewItem, { key: "ArrowRight" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Open DB view" }) !== null).toBe(true);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"db_view"')
      && JSON.stringify(call[1]).includes('"projectId":"beta"')
    )).toBe(true);
    expect(screen.getByRole("tab", { name: /Beta project, DB View/ }) !== null).toBe(true);
  });

  test("empty right panel Card Stage action groups current-project cards before other projects", async () => {
    const emptySession = makeSession({
      id: "session:alpha:card-picker",
      tabs: [],
      rightLayout: makePanelLayout([], null),
    });
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
      sessionsByProject: { alpha: [emptySession] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await pointerActivate(screen.getByRole("button", { name: /Card Stage/ }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Open card stage" }) !== null).toBe(true);
    });
    expect(screen.getByRole("combobox", { name: "Open card stage" }) !== null).toBe(true);
    expect(screen.getByText("Current project") !== null).toBe(true);
    expect(screen.getByText("Other projects") !== null).toBe(true);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Card One/ }) !== null).toBe(true);
      expect(screen.getByRole("option", { name: /Beta Card/ }) !== null).toBe(true);
    });
    const dialogText = textContent(screen.getByRole("dialog", { name: "Open card stage" }));
    expect(dialogText.indexOf("Current project") < dialogText.indexOf("Other projects")).toBe(true);
    expect(dialogText.indexOf("Card One") < dialogText.indexOf("Beta Card")).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /Beta Card/ }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"card_stage"')
      && JSON.stringify(call[1]).includes('"projectId":"beta"')
      && JSON.stringify(call[1]).includes('"cardId":"card-beta"')
    )).toBe(true);
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
      await clickMenuItem(menu, previewCase.label);

      expect(screen.getByRole("tab", { name: previewCase.label }) !== null).toBe(true);
      expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBe(true);
      expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);

      const pinTarget = previewCase.kind === "files"
        ? getFilesPreviewInteractionTarget(screen)
        : screen.getByText(previewCase.pinText);
      await pointerDownAndSettle(pinTarget);
      await waitFor(() => {
        expect(invokeCalls.some((call) =>
          call[0] === "project-session-tabs:create"
          && JSON.stringify(call[1]).includes('"panelId":"bottom"')
          && JSON.stringify(call[1]).includes(`"kind":"${previewCase.kind}"`)
        )).toBe(true);
      });

      expect(invokeCalls.some((call) =>
        call[0] === "project-session-tabs:create"
        && JSON.stringify(call[1]).includes('"panelId":"bottom"')
        && JSON.stringify(call[1]).includes(`"kind":"${previewCase.kind}"`)
      )).toBe(true);
    });
  }

  test("bottom Side chat action starts an ephemeral side tab instead of a durable preview", async () => {
    localStorage.setItem(THREAD_QUEUE_FOLLOW_UPS_STORAGE_KEY, "false");
    localStorage.setItem(COMPOSER_ENTER_BEHAVIOR_STORAGE_KEY, "cmdIfMultiline");
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

    await waitFor(() => {
      expect(screen.queryAllByRole("tab", { name: "Side chat" }).length).toBe(1);
    });
    expect(screen.getByRole("tab", { name: "Side chat" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]')).toBe(null);
    expect(String(startSideChatCalls.length)).toBe("1");
    expect(JSON.stringify(startSideChatCalls[0]).includes('"parentThreadId":"thread-alpha"')).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
    expect(textContent(screen.container).includes("Thread:side-thread-1")).toBe(true);
    const stageProps = (globalThis as { __lastConnectedThreadStageProps?: Record<string, unknown> }).__lastConnectedThreadStageProps;
    expect(JSON.stringify(stageProps?.sideChatContext ?? null)).toBe(
      "{\"parentThreadId\":\"thread-alpha\",\"tabTitle\":\"Side chat\"}",
    );
    expect(stageProps?.isQueueingEnabled).toBe(false);
    expect(stageProps?.composerEnterBehavior).toBe("cmdIfMultiline");
    expect(Boolean(stageProps?.summaryPanelMounted)).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close Side chat tab" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(String(discardSideChatCalls.length)).toBe("1");
    expect(discardSideChatCalls[0] ?? "").toBe("side-thread-1");
  });

  test("selected-text side chat drafts prefill the side composer without submitting a prompt", async () => {
    renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    const openSideChat = actions.onOpenSideChat as ((input?: {
      kind: "draft";
      draftPrompt: string;
    }) => Promise<void>) | undefined;
    expect(typeof openSideChat).toBe("function");

    await act(async () => {
      await openSideChat?.({
        kind: "draft",
        draftPrompt: "Use this selected paragraph",
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const startInput = startSideChatCalls[0] as { prompt?: unknown; promptInput?: unknown } | undefined;
    expect(String(startSideChatCalls.length)).toBe("1");
    expect(Boolean(startInput && "prompt" in startInput)).toBe(false);
    expect(Boolean(startInput && "promptInput" in startInput)).toBe(false);
    expect(String(setComposerIntentCalls.length)).toBe("1");
    expect(setComposerIntentCalls[0]?.[0]).toBe("side-thread-1");
    expect((setComposerIntentCalls[0]?.[1] as { prompt?: string } | undefined)?.prompt).toBe("Use this selected paragraph");
    expect(typeof (setComposerIntentCalls[0]?.[1] as { focusNonce?: number } | undefined)?.focusNonce).toBe("number");
  });

  test("opens subagent contexts in background-agent right-panel tabs", async () => {
    sideChatConversations["thread-child"] = {
      threadId: "thread-child",
      projectId: "alpha",
      source: {
        parentThreadId: "thread-alpha",
        agentNickname: "Scout",
      },
      threadName: "Scout",
      threadPreview: "Checking the repo",
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

    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession({ rightCollapsed: true })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const actions = getLastThreadStageActions();
    const openThread = actions.onOpenThread as ((threadId: string, context?: {
      subagent?: {
        conversationId: string;
        displayName: string;
        agentRole: string | null;
        spawnModel: string | null;
        status: "active" | "waiting" | "done";
        statusSummary: string | null;
        showInlineActivity?: boolean;
        diffStats: { linesAdded: number; linesRemoved: number } | null;
      };
    }) => Promise<void>) | undefined;
    expect(typeof openThread).toBe("function");
    if (!openThread) return;

    let resolveSnapshot: () => void = () => undefined;
    requestThreadStreamSnapshotImpl = async () => {
      await new Promise<void>((resolve) => {
        resolveSnapshot = resolve;
      });
    };

    invokeCalls = [];
    try {
      await act(async () => {
        const openPromise = openThread("thread-child", {
          subagent: {
            conversationId: "thread-child",
            displayName: "Scout",
            agentRole: "explorer",
            spawnModel: "gpt-5.5",
            status: "active",
            statusSummary: "checking files",
            showInlineActivity: true,
            diffStats: { linesAdded: 2, linesRemoved: 1 },
          },
        });
        const openResult = await Promise.race([
          openPromise.then(() => "resolved"),
          new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0)),
        ]);
        expect(openResult).toBe("resolved");
        await Promise.resolve();
      });
      await settleAsyncRender();
      await settleAsyncRender();
    } finally {
      resolveSnapshot();
      requestThreadStreamSnapshotImpl = null;
    }

    const tab = getPanelTabById(screen.container, "background-agent:thread-child");
    expect(tab.textContent?.includes("Scout")).toBe(true);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.querySelector('[data-subagent-avatar-seed="thread-child"]') !== null).toBe(true);
    expect(screen.container.querySelector('[data-background-agent-side-panel-tab="background-agent:thread-child"]') !== null).toBe(true);
    expect(textContent(screen.container).includes("Thread:thread-child")).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "codex:thread:ensure-session")).toBe(false);
    expect(JSON.stringify(hydrateBackgroundSubagentThreadsCalls)).toBe(JSON.stringify([{ threadIds: ["thread-child"] }]));
    expect(requestThreadStreamSnapshotCalls.filter((threadId) => threadId === "thread-child").length >= 1).toBe(true);
  });

  }

  if (scope === "panel-commands") {
  test("plus menu keeps DB and Browser available while hiding singleton Review", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const reviewTab = makeSessionTab({
      id: "session:alpha:database-view:review",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id, reviewTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Open side panel tab" }), { button: 0 });
    await settleAsyncRender();

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("DB View") !== null).toBe(true);
    expect(within(menu).getByText("Card Stage") !== null).toBe(true);
    expect(within(menu).getByText("Browser") !== null).toBe(true);
    expect(within(menu).queryByText("Review")).toBe(null);
    expect(within(menu).getByText("Files") !== null).toBe(true);
    expect(within(menu).getByText("Terminal") !== null).toBe(true);
  });

  test("bottom plus menu keeps Browser multi-tab and hides singleton Review tabs from either panel", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const reviewTab = makeSessionTab({
      id: "session:alpha:database-view:review",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id, reviewTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    expect(within(menu).getByText("Browser") !== null).toBe(true);
    expect(within(menu).queryByText("Review")).toBe(null);
    expect(within(menu).getByText("Files") !== null).toBe(true);
    expect(within(menu).getByText("Side chat") !== null).toBe(true);
    expect(within(menu).getByText("Terminal") !== null).toBe(true);
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
    )).toBe(true);
    expect(screen.container.querySelector("[data-review-diff-panel]") !== null).toBe(true);
  });

  test("summary Changes action opens Review with the requested git source", async () => {
    (globalThis as { __lastConnectedReviewDiffPanelProps?: Record<string, unknown> }).__lastConnectedReviewDiffPanelProps = undefined;
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open staged changes" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"review"')
    )).toBe(true);
    const props = (globalThis as { __lastConnectedReviewDiffPanelProps?: Record<string, unknown> }).__lastConnectedReviewDiffPanelProps;
    expect(props?.initialGitSource).toBe("staged");
    expect(props?.initialGitSourceRequestKey).toBe(1);
    expect(props?.selectedTurnDiff).toBe(null);
  });

  test("bottom panel add menu does not expose Review", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();
    await openBottomPanel(screen);

    const menu = await openPanelMenu(screen, "Open bottom panel tab");
    expect(within(menu).queryByText("Review")).toBe(null);
  });

  test("command palette open tick renders the command palette with the initial query", async () => {
    const project = makeProject("palette-command", "Palette Command");
    const screen = renderWorkbench({
      projects: [project],
      sessionsByProject: {
        [project.id]: [
          makeAttachedSession({
            id: "session:palette-command",
            projectId: project.id,
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      screen.openCommandPalette("root");
      await Promise.resolve();
    });
    await settleAsyncRender();

    const input = screen.getByLabelText("Command palette search") as HTMLInputElement;
    expect(input.value).toBe("root");
  });

  test("command palette shell commands open Files Browser Review Terminal and DB View tabs", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:commands" })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await executeCommandPaletteCommand(screen, "files", "Toggle file tree");
    expect(screen.getByRole("tab", { name: "Files" }) !== null).toBe(true);

    await executeCommandPaletteCommand(screen, "browser", "Open browser tab");
    expect(screen.getByRole("tab", { name: "Browser" }) !== null).toBe(true);

    invokeCalls = [];
    await executeCommandPaletteCommand(screen, "review", "Open review tab");
    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"review"')
      && JSON.stringify(call[1]).includes('"panelId":"right"')
    )).toBe(true);

    invokeCalls = [];
    await executeCommandPaletteCommand(screen, "terminal", "Open terminal");
    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"terminal"')
      && JSON.stringify(call[1]).includes('"panelId":"bottom"')
    )).toBe(true);

    invokeCalls = [];
    await executeCommandPaletteCommand(screen, "db", "Open DB View tab");
    expect(invokeCalls.some((call) =>
      call[0] === "project-session-tabs:create"
      && JSON.stringify(call[1]).includes('"kind":"db_view"')
      && JSON.stringify(call[1]).includes('"panelId":"right"')
    )).toBe(true);
  });

  test("command palette opens keyboard shortcuts settings", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:keyboard" })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await executeCommandPaletteCommand(screen, "keyboard", "Keyboard shortcuts");

    const routeShell = screen.container.querySelector('[data-testid="settings-route-shell"]');
    expect(routeShell !== null).toBe(true);
    expect(textContent(screen.container).includes("Keyboard shortcuts")).toBe(true);
  });

  test("command palette opens scheduled task management", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:automation-command" })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await executeCommandPaletteCommand(screen, "automation", "Manage automations");

    expect(screen.container.querySelector('[data-testid="automations-route-shell"]') !== null).toBe(true);
    expect(screen.container.querySelector('[data-thread-stage="true"]')).toBe(null);
  });

  test("command palette opens the process manager dialog", async () => {
    sideChatConversations["thread-alpha"] = {
      threadId: "thread-alpha",
      projectId: "alpha",
      source: null,
      threadName: "Alpha thread",
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
      turns: [{
        turnId: "turn-process",
        status: "completed",
        userMessages: [],
        assistantText: "",
        createdAt: 1,
        updatedAt: 1,
        items: [{
          threadId: "thread-alpha",
          turnId: "turn-process",
          itemId: "item-process",
          type: "commandExecution",
          kind: "commandExecution",
          status: "inProgress",
          command: "bun run dev",
          cwd: "/Users/asc/repo/nodex",
          aggregatedOutput: "ready in 421ms\n",
          createdAt: 1,
          updatedAt: 1,
        }],
      }],
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
    };
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [makeAttachedSession({ id: "session:alpha:process-manager" })],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await executeCommandPaletteCommand(screen, "process", "Process Manager");

    await waitFor(() => {
      expect(textContent(document.body).includes("Process Manager")).toBe(true);
      expect(textContent(document.body).includes("bun run dev")).toBe(true);
    });
    expect(listBackgroundProcessesCalls.includes("thread-alpha")).toBe(true);
    expect(textContent(document.body).includes("12.5%")).toBe(true);
    expect(textContent(document.body).includes("1.5 MB")).toBe(true);

    fireEvent.click(screen.getByText("bun run dev"));
    await waitFor(() => {
      expect(screen.container.querySelector("[data-process-output-panel-tab]") !== null).toBe(true);
      expect(textContent(screen.container).includes("ready in 421ms")).toBe(true);
    });
  });

  test("Files shortcut uses Ctrl+Shift+E and leaves Ctrl+P for the command palette", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeAttachedSession()] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(document, { key: "p", ctrlKey: true });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.queryByRole("tab", { name: "Files" })).toBe(null);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);

    const input = document.createElement("input");
    document.body.appendChild(input);
    await act(async () => {
      fireEvent.keyDown(input, { key: "E", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    input.remove();
    await settleAsyncRender();

    expect(screen.queryByRole("tab", { name: "Files" })).toBe(null);

    await act(async () => {
      fireEvent.keyDown(document, { key: "E", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "Files" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
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
    )).toBe(true);

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
    )).toBe(true);

    invokeCalls = [];
    startSideChatCalls = [];
    await act(async () => {
      fireEvent.keyDown(document, { key: "s", altKey: true, ctrlKey: true });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(String(startSideChatCalls.length)).toBe("1");
    await waitFor(() => {
      expect(screen.queryAllByRole("tab", { name: "Side chat" }).length).toBe(1);
    });
    expect(screen.getByRole("tab", { name: "Side chat" }) !== null).toBe(true);

    invokeCalls = [];
    const input = document.createElement("input");
    document.body.appendChild(input);
    await act(async () => {
      fireEvent.keyDown(input, { key: "`", code: "Backquote", ctrlKey: true });
      await Promise.resolve();
    });
    input.remove();
    await settleAsyncRender();

    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
  });

  test("Ctrl+Shift+] selects the next right-panel tab in the focused tab group", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const reviewTab = makeSessionTab({
      id: "session:alpha:database-view:review",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id, reviewTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, "session:alpha:database-view:db"), {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === browserTab.id
    )).toBe(true);
  });

  test("Ctrl+Shift+[ wraps from the first right-panel tab to the last tab in the focused tab group", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const reviewTab = makeSessionTab({
      id: "session:alpha:database-view:review",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id, reviewTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, "session:alpha:database-view:db"), {
        key: "[",
        code: "BracketLeft",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === reviewTab.id
    )).toBe(true);
  });

  test("panel tab cycling stays inside the focused split tab group", async () => {
    const rightLayout = splitProjectSessionPanelLeaf(
      makePanelLayout(["db-tab", "browser-tab", "review-tab"], "browser-tab"),
      {
        leafId: "main",
        side: "right",
        tabId: "review-tab",
        newLeafId: "leaf:review",
        newBranchId: "branch:root",
      },
    );
    const panels = makePanels({
      rightTabIds: ["db-tab", "browser-tab", "review-tab"],
      rightActiveTabId: "browser-tab",
      rightFullWidth: false,
    });
    const session = makeSession({
      id: "session:alpha:split-cycle",
      title: "Split cycle",
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
          sessionId: "session:alpha:split-cycle",
          projectId: "alpha",
          kind: "db_view",
          title: "DB View",
          panelId: "right",
          config: { projectId: "alpha", view: "kanban" },
        },
        {
          id: "browser-tab",
          sessionId: "session:alpha:split-cycle",
          projectId: "alpha",
          kind: "browser",
          title: "Browser",
          panelId: "right",
          config: { projectId: "alpha" },
        },
        {
          id: "review-tab",
          sessionId: "session:alpha:split-cycle",
          projectId: "alpha",
          kind: "review",
          title: "Review",
          panelId: "right",
          config: { projectId: "alpha" },
        },
      ],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.mouseDown(getPanelTabById(screen.container, "browser-tab"), { button: 0 });
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, "browser-tab"), {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const activateCalls = getProjectSessionPanelActivateCalls();
    expect(activateCalls.some((input) =>
      input.sessionId === "session:alpha:split-cycle"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === "db-tab"
    )).toBe(true);
    expect(activateCalls.some((input) => input.tabId === "review-tab")).toBe(false);
  });

  test("panel tab cycling uses the last focused leaf when native routing has no leaf target", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const reviewTab = makeSessionTab({
      id: "session:alpha:database-view:review",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id, reviewTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await pointerDownAndSettle(getPanelTabById(screen.container, "session:alpha:database-view:db"));

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(document.body, {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === browserTab.id
    )).toBe(true);
  });

  test("native panel tab cycle requests reuse the focused panel tab group", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const reviewTab = makeSessionTab({
      id: "session:alpha:database-view:review",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Review",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab, reviewTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id, reviewTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await pointerDownAndSettle(getPanelTabById(screen.container, "session:alpha:database-view:db"));

    invokeCalls = [];
    await act(async () => {
      screen.requestPanelTabCycle("next");
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === browserTab.id
    )).toBe(true);
  });

  test("native panel tab cycle requests are ignored while an editable target is focused", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await pointerDownAndSettle(getPanelTabById(screen.container, "session:alpha:database-view:db"));

    const input = document.createElement("input");
    screen.getByTestId("session-right-panel").appendChild(input);
    invokeCalls = [];
    await act(async () => {
      input.focus();
      screen.requestPanelTabCycle("next");
      await Promise.resolve();
    });
    input.remove();
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().length).toBe(0);
  });

  test("panel tab cycling works from focused NFM editor content", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const leaf = screen.container.querySelector('[data-panel-group-leaf-id="main"]');
    if (!(leaf instanceof HTMLElement)) {
      throw new Error("Expected main panel leaf");
    }
    const { root: editor, content: editorContent } = appendMockNfmEditor(leaf);

    invokeCalls = [];
    await act(async () => {
      editorContent.focus();
      fireEvent.keyDown(editorContent, {
        key: "{",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    editor.remove();
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === browserTab.id
    )).toBe(true);
  });

  test("panel tab cycling between durable card stages keeps editors mounted and active-scoped", async () => {
    const firstCardTab = makeSessionTab({
      id: "session:alpha:database-view:card-1",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "card_stage",
      title: "Card One",
      order: 0,
      config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
    });
    const secondCardTab = makeSessionTab({
      id: "session:alpha:database-view:card-2",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "card_stage",
      title: "Card Two",
      order: 1,
      config: { projectId: "alpha", cardId: "card-2", titleSnapshot: "Card Two" },
    });
    const session = makeSession({
      tabs: [firstCardTab, secondCardTab],
      rightLayout: makePanelLayout([firstCardTab.id, secondCardTab.id], firstCardTab.id),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const state = globalThis as {
      __mockCardStageMountsByCardId?: Record<string, number>;
      __mockCardStageUnmountsByCardId?: Record<string, number>;
      __mockCardStagePropsByCardId?: Record<string, Record<string, unknown>>;
    };
    expect(state.__mockCardStageMountsByCardId?.["card-1"]).toBe(1);
    expect(state.__mockCardStageMountsByCardId?.["card-2"]).toBe(1);
    expect(state.__mockCardStageUnmountsByCardId?.["card-1"] ?? 0).toBe(0);
    expect(state.__mockCardStagePropsByCardId?.["card-1"]?.isActivePanelTab).toBe(true);
    expect(state.__mockCardStagePropsByCardId?.["card-2"]?.isActivePanelTab).toBe(false);

    const firstEditor = screen.container.querySelector('[aria-label="Mock editor card-1"]');
    if (!(firstEditor instanceof HTMLElement)) {
      throw new Error("Expected first card stage editor");
    }

    invokeCalls = [];
    await act(async () => {
      firstEditor.focus();
      fireEvent.keyDown(firstEditor, {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === secondCardTab.id
    )).toBe(true);
    expect(state.__mockCardStageMountsByCardId?.["card-1"]).toBe(1);
    expect(state.__mockCardStageMountsByCardId?.["card-2"]).toBe(1);
    expect(state.__mockCardStageUnmountsByCardId?.["card-1"] ?? 0).toBe(0);
    expect(state.__mockCardStageUnmountsByCardId?.["card-2"] ?? 0).toBe(0);
    expect(state.__mockCardStagePropsByCardId?.["card-1"]?.isActivePanelTab).toBe(false);
    expect(state.__mockCardStagePropsByCardId?.["card-2"]?.isActivePanelTab).toBe(true);

    const secondEditor = screen.container.querySelector('[aria-label="Mock editor card-2"]');
    if (!(secondEditor instanceof HTMLElement)) {
      throw new Error("Expected second card stage editor");
    }

    invokeCalls = [];
    await act(async () => {
      secondEditor.focus();
      fireEvent.keyDown(secondEditor, {
        key: "[",
        code: "BracketLeft",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === firstCardTab.id
    )).toBe(true);
    expect(state.__mockCardStageMountsByCardId?.["card-1"]).toBe(1);
    expect(state.__mockCardStageMountsByCardId?.["card-2"]).toBe(1);
    expect(state.__mockCardStageUnmountsByCardId?.["card-1"] ?? 0).toBe(0);
    expect(state.__mockCardStageUnmountsByCardId?.["card-2"] ?? 0).toBe(0);
    expect(state.__mockCardStagePropsByCardId?.["card-1"]?.isActivePanelTab).toBe(true);
    expect(state.__mockCardStagePropsByCardId?.["card-2"]?.isActivePanelTab).toBe(false);
  });

  test("native panel tab cycle requests work while NFM editor content is focused", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const leaf = screen.container.querySelector('[data-panel-group-leaf-id="main"]');
    if (!(leaf instanceof HTMLElement)) {
      throw new Error("Expected main panel leaf");
    }
    const { root: editor, content: editorContent } = appendMockNfmEditor(leaf);

    await act(async () => {
      editorContent.focus();
      fireEvent.focus(editorContent);
      await Promise.resolve();
    });
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      screen.requestPanelTabCycle("next");
      await Promise.resolve();
    });
    editor.remove();
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:database-view"
      && input.panelId === "right"
      && input.leafId === "main"
      && input.tabId === browserTab.id
    )).toBe(true);
  });

  test("panel tab cycling works in the focused bottom-panel tab group", async () => {
    const panels = makePanels({
      rightCollapsed: true,
      bottomTabIds: ["terminal-tab", "bottom-browser-tab"],
      bottomActiveTabId: "terminal-tab",
      bottomCollapsed: false,
    });
    const session = makeSession({
      id: "session:alpha:bottom-cycle",
      title: "Bottom cycle",
      panels,
      tabs: [
        {
          id: "terminal-tab",
          sessionId: "session:alpha:bottom-cycle",
          projectId: "alpha",
          kind: "terminal",
          title: "Terminal",
          panelId: "bottom",
          config: { projectId: "alpha", terminalSessionId: "terminal-cycle" },
        },
        {
          id: "bottom-browser-tab",
          sessionId: "session:alpha:bottom-cycle",
          projectId: "alpha",
          kind: "browser",
          title: "Browser",
          panelId: "bottom",
          config: { projectId: "alpha" },
        },
      ],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, "terminal-tab"), {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().some((input) =>
      input.sessionId === "session:alpha:bottom-cycle"
      && input.panelId === "bottom"
      && input.leafId === "main"
      && input.tabId === "bottom-browser-tab"
    )).toBe(true);
  });

  test("panel tab cycling ignores input and dialog targets inside a focused panel", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const rightPanel = screen.getByTestId("session-right-panel");
    const input = document.createElement("input");
    rightPanel.appendChild(input);
    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(input, {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    input.remove();
    await settleAsyncRender();
    expect(getProjectSessionPanelActivateCalls().length).toBe(0);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogButton = document.createElement("button");
    dialog.appendChild(dialogButton);
    rightPanel.appendChild(dialog);
    await act(async () => {
      fireEvent.keyDown(dialogButton, {
        key: "]",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
      });
      await Promise.resolve();
    });
    dialog.remove();
    await settleAsyncRender();
    expect(getProjectSessionPanelActivateCalls().length).toBe(0);
  });

  test("plain Ctrl+Bracket shortcuts bypass focused panel tab cycling", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, "session:alpha:database-view:db"), {
        key: "[",
        code: "BracketLeft",
        ctrlKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionPanelActivateCalls().length).toBe(0);
  });

  test("Ctrl+W closes the active right-panel tab in the focused tab group", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], browserTab.id),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, browserTab.id), {
        key: "w",
        code: "KeyW",
        ctrlKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(JSON.stringify(getProjectSessionTabDeleteTabIds())).toBe(JSON.stringify([browserTab.id]));
  });

  test("Ctrl+W routes close focus to the same-leaf most recently active tab", async () => {
    const firstTab = makeSessionTab({
      id: "session:alpha:database-view:first",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "db_view",
      title: "First",
      order: 0,
      config: { projectId: "alpha", view: "kanban" },
    });
    const secondTab = makeSessionTab({
      id: "session:alpha:database-view:second",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Second",
      order: 1,
      config: { projectId: "alpha" },
    });
    const thirdTab = makeSessionTab({
      id: "session:alpha:database-view:third",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Third",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [firstTab, secondTab, thirdTab],
      rightLayout: makePanelLayout([firstTab.id, secondTab.id, thirdTab.id], firstTab.id),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.mouseDown(getPanelTabById(screen.container, secondTab.id), { button: 0 });
      await Promise.resolve();
    });
    await settleAsyncRender();
    await act(async () => {
      fireEvent.mouseDown(getPanelTabById(screen.container, thirdTab.id), { button: 0 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, thirdTab.id), {
        key: "w",
        code: "KeyW",
        ctrlKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const deleteInput = getProjectSessionTabDeleteInputs()[0];
    if (typeof deleteInput === "string" || !deleteInput) {
      throw new Error("Expected structured tab delete input");
    }
    expect(deleteInput.tabId).toBe(thirdTab.id);
    expect(deleteInput.preferredActiveLeafId).toBe("main");
    expect(deleteInput.preferredActiveTabId).toBe(secondTab.id);
    await waitFor(() => {
      expect(getPanelTabById(screen.container, secondTab.id).getAttribute("aria-selected")).toBe("true");
    });
  });

  test("Ctrl+W close routing stays inside the focused split leaf", async () => {
    const firstTab = makeSessionTab({
      id: "session:alpha:database-view:first-split-close",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "db_view",
      title: "First",
      order: 0,
      config: { projectId: "alpha", view: "kanban" },
    });
    const secondTab = makeSessionTab({
      id: "session:alpha:database-view:second-split-close",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Second",
      order: 1,
      config: { projectId: "alpha" },
    });
    const thirdTab = makeSessionTab({
      id: "session:alpha:database-view:third-split-close",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Third",
      order: 2,
      config: { projectId: "alpha" },
    });
    const rightLayout = splitProjectSessionPanelLeaf(
      makePanelLayout([firstTab.id, secondTab.id, thirdTab.id], firstTab.id),
      {
        leafId: "main",
        side: "right",
        tabId: thirdTab.id,
        newLeafId: "leaf:review-close",
        newBranchId: "branch:review-close",
      },
    );
    const session = makeSession({
      tabs: [firstTab, secondTab, thirdTab],
      rightLayout,
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.mouseDown(getPanelTabById(screen.container, secondTab.id), { button: 0 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, secondTab.id), {
        key: "w",
        code: "KeyW",
        ctrlKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const deleteInput = getProjectSessionTabDeleteInputs()[0];
    if (typeof deleteInput === "string" || !deleteInput) {
      throw new Error("Expected structured tab delete input");
    }
    expect(deleteInput.tabId).toBe(secondTab.id);
    expect(deleteInput.preferredActiveLeafId).toBe("main");
    expect(deleteInput.preferredActiveTabId).toBe(firstTab.id);
    await waitFor(() => {
      expect(getPanelTabById(screen.container, firstTab.id).getAttribute("aria-selected")).toBe("true");
    });
  });

  test("direct panel tab close routes focus to the same-leaf most recently active tab", async () => {
    const firstTab = makeSessionTab({
      id: "session:alpha:database-view:first-direct",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "db_view",
      title: "First",
      order: 0,
      config: { projectId: "alpha", view: "kanban" },
    });
    const secondTab = makeSessionTab({
      id: "session:alpha:database-view:second-direct",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Second",
      order: 1,
      config: { projectId: "alpha" },
    });
    const thirdTab = makeSessionTab({
      id: "session:alpha:database-view:third-direct",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Third",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [firstTab, secondTab, thirdTab],
      rightLayout: makePanelLayout([firstTab.id, secondTab.id, thirdTab.id], firstTab.id),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.mouseDown(getPanelTabById(screen.container, secondTab.id), { button: 0 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Close Second tab"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    const deleteInput = getProjectSessionTabDeleteInputs()[0];
    if (typeof deleteInput === "string" || !deleteInput) {
      throw new Error("Expected structured tab delete input");
    }
    expect(deleteInput.tabId).toBe(secondTab.id);
    expect(deleteInput.preferredActiveLeafId).toBe("main");
    expect(deleteInput.preferredActiveTabId).toBe(firstTab.id);
    await waitFor(() => {
      expect(getPanelTabById(screen.container, firstTab.id).getAttribute("aria-selected")).toBe("true");
    });
  });

  test("middle-click panel tab close uses same-leaf MRU routing", async () => {
    const firstTab = makeSessionTab({
      id: "session:alpha:database-view:first-middle",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "db_view",
      title: "First",
      order: 0,
      config: { projectId: "alpha", view: "kanban" },
    });
    const secondTab = makeSessionTab({
      id: "session:alpha:database-view:second-middle",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Second",
      order: 1,
      config: { projectId: "alpha" },
    });
    const thirdTab = makeSessionTab({
      id: "session:alpha:database-view:third-middle",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "review",
      title: "Third",
      order: 2,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [firstTab, secondTab, thirdTab],
      rightLayout: makePanelLayout([firstTab.id, secondTab.id, thirdTab.id], firstTab.id),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.mouseDown(getPanelTabById(screen.container, secondTab.id), { button: 0 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.mouseDown(getPanelTabChromeById(screen.container, secondTab.id), { button: 1 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const deleteInput = getProjectSessionTabDeleteInputs()[0];
    if (typeof deleteInput === "string" || !deleteInput) {
      throw new Error("Expected structured tab delete input");
    }
    expect(deleteInput.tabId).toBe(secondTab.id);
    expect(deleteInput.preferredActiveLeafId).toBe("main");
    expect(deleteInput.preferredActiveTabId).toBe(firstTab.id);
    await waitFor(() => {
      expect(getPanelTabById(screen.container, firstTab.id).getAttribute("aria-selected")).toBe("true");
    });
  });

  test("Ctrl+W consumes but does not close a non-closable active panel tab", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, "session:alpha:database-view:db"), {
        key: "w",
        code: "KeyW",
        ctrlKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(getProjectSessionTabDeleteTabIds().length).toBe(0);
  });

  test("native close-panel-tab requests close the active focused panel tab", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], browserTab.id),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await pointerDownAndSettle(getPanelTabById(screen.container, browserTab.id));

    invokeCalls = [];
    await act(async () => {
      screen.requestPanelTabClose();
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(JSON.stringify(getProjectSessionTabDeleteTabIds())).toBe(JSON.stringify([browserTab.id]));
  });

  test("Ctrl+W closes the active bottom-panel tab in the focused tab group", async () => {
    const panels = makePanels({
      rightCollapsed: true,
      bottomTabIds: ["terminal-tab", "bottom-browser-tab"],
      bottomActiveTabId: "bottom-browser-tab",
      bottomCollapsed: false,
    });
    const session = makeSession({
      id: "session:alpha:bottom-close",
      title: "Bottom close",
      panels,
      tabs: [
        {
          id: "terminal-tab",
          sessionId: "session:alpha:bottom-close",
          projectId: "alpha",
          kind: "terminal",
          title: "Terminal",
          panelId: "bottom",
          config: { projectId: "alpha", terminalSessionId: "terminal-close" },
        },
        {
          id: "bottom-browser-tab",
          sessionId: "session:alpha:bottom-close",
          projectId: "alpha",
          kind: "browser",
          title: "Browser",
          panelId: "bottom",
          config: { projectId: "alpha" },
        },
      ],
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    invokeCalls = [];
    await act(async () => {
      fireEvent.keyDown(getPanelTabById(screen.container, "bottom-browser-tab"), {
        key: "w",
        code: "KeyW",
        ctrlKey: true,
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(JSON.stringify(getProjectSessionTabDeleteTabIds())).toBe(JSON.stringify(["bottom-browser-tab"]));
  });

  test("Ctrl+W closes the active panel tab from focused NFM editor content", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], browserTab.id),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const leaf = screen.container.querySelector('[data-panel-group-leaf-id="main"]');
    if (!(leaf instanceof HTMLElement)) {
      throw new Error("Expected main panel leaf");
    }
    const { root: editor, content: editorContent } = appendMockNfmEditor(leaf);

    invokeCalls = [];
    await act(async () => {
      editorContent.focus();
      fireEvent.keyDown(editorContent, {
        key: "w",
        code: "KeyW",
        ctrlKey: true,
      });
      await Promise.resolve();
    });
    editor.remove();
    await settleAsyncRender();

    expect(JSON.stringify(getProjectSessionTabDeleteTabIds())).toBe(JSON.stringify([browserTab.id]));
  });

  test("terminal tab default cwd prefers the attached thread cwd", async () => {
    const terminalSession = makeAttachedSession({
      id: "session:alpha:terminal-thread",
      title: "Terminal thread",
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

  }

  if (scope === "cards-shell-navigation") {
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
      && call[1] === "session:alpha:database-view"
      && call[2] === "right"
      && JSON.stringify(call[3]) === JSON.stringify({ collapsed: false })
    )).toBe(true);
    expect(screen.queryAllByRole("tablist").length > 0).toBe(true);
  });

  test("opens full-width single-group DB cards as renderer-local previews in a new right group", async () => {
    const screen = renderWorkbench();
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
    await settleAsyncRender();

    const tab = screen.getByRole("tab", { name: "Card One" });
    expect(tab.closest('[data-app-shell-tab-preview="true"]') !== null).toBe(true);
    expect(Boolean(tab.closest("[data-panel-tab-row]")?.getAttribute("data-panel-tab-row")?.startsWith("right:leaf:auto-right:"))).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
    expect(invokeCalls.some((call) => call[0] === "project-session-panels:ensure-right-leaf")).toBe(true);
    expect(invokeCalls.some((call) => {
      const input = call[3] as { size?: { fullWidth?: boolean } } | undefined;
      return call[0] === "project-session-panels:update"
        && call[1] === "session:alpha:database-view"
        && call[2] === "right"
        && input?.size?.fullWidth === false;
    })).toBe(false);
  });

  test("opens durable DB card-stage tabs in the active group when the right panel is not full-width", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({ rightFullWidth: false }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    expect(typeof props?.openCardStage).toBe("function");
    await act(async () => {
      await (props?.openCardStage as (
        projectId: string,
        cardId: string,
        title?: string,
        options?: { openMode?: "preview" | "durable" },
      ) => Promise<void> | void)(
        "alpha",
        "card-1",
        "Card One",
        { openMode: "durable" },
      );
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const createCall = invokeCalls.find((call) => call[0] === "project-session-tabs:create");
    expect(createCall !== undefined).toBe(true);
    const input = createCall?.[1] as Record<string, unknown> | undefined;
    expect(input?.sessionId).toBe("session:alpha:database-view");
    expect(input?.projectId).toBe("alpha");
    expect(input?.panelId).toBe("right");
    expect("targetLeafId" in (input ?? {})).toBe(false);
    expect("clientTabId" in (input ?? {})).toBe(false);
    expect(input?.kind).toBe("card_stage");
    expect(JSON.stringify(input?.config)).toBe(JSON.stringify({
      projectId: "alpha",
      cardId: "card-1",
      titleSnapshot: "Card One",
    }));

    const tab = screen.getByRole("tab", { name: "Card One" });
    expect(tab.closest('[data-app-shell-tab-preview="true"]')).toBe(null);
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]')).toBe(null);
    expect(invokeCalls.some((call) => call[0] === "project-session-panels:ensure-right-leaf")).toBe(false);
  });

  test("creates a right group before opening durable DB card-stage tabs from full-width single-group DB tabs", async () => {
    const screen = renderWorkbench();
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    expect(typeof props?.openCardStage).toBe("function");
    await act(async () => {
      await (props?.openCardStage as (
        projectId: string,
        cardId: string,
        title?: string,
        options?: { openMode?: "preview" | "durable" },
      ) => Promise<void> | void)(
        "alpha",
        "card-1",
        "Card One",
        { openMode: "durable" },
      );
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const ensureCall = invokeCalls.find((call) => call[0] === "project-session-panels:ensure-right-leaf");
    expect(ensureCall !== undefined).toBe(true);
    const createCall = invokeCalls.find((call) => call[0] === "project-session-tabs:create");
    expect(createCall !== undefined).toBe(true);
    const input = createCall?.[1] as { targetLeafId?: string } | undefined;
    expect(Boolean(input?.targetLeafId?.startsWith("leaf:auto-right:"))).toBe(true);

    const tab = screen.getByRole("tab", { name: "Card One" });
    expect(tab.closest('[data-app-shell-tab-preview="true"]')).toBe(null);
    expect(tab.closest("[data-panel-tab-row]")?.getAttribute("data-panel-tab-row")).toBe(`right:${input?.targetLeafId ?? ""}`);
  });

  test("pins card-stage previews after panel interaction", async () => {
    const screen = renderWorkbench();
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
    await settleAsyncRender();

    const previewTab = screen.getByRole("tab", { name: "Card One" });
    const previewTabId = previewTab
      .closest("[data-panel-tab-id]")
      ?.getAttribute("data-panel-tab-id");
    const previewLeafId = previewTab
      .closest("[data-panel-tab-row]")
      ?.getAttribute("data-panel-tab-row")
      ?.replace("right:", "");
    expect(typeof previewTabId).toBe("string");
    expect(typeof previewLeafId).toBe("string");

    invokeCalls = [];
    const editor = screen.container.querySelector(".nfm-editor .ProseMirror");
    if (!(editor instanceof HTMLElement)) throw new Error("Expected card stage editor preview");
    editor.focus();
    expect(document.activeElement).toBe(editor);
    expect((globalThis as { __mockCardStageMounts?: number }).__mockCardStageMounts).toBe(1);
    expect((globalThis as { __mockCardStageUnmounts?: number }).__mockCardStageUnmounts ?? 0).toBe(0);
    await pointerDownAndSettle(editor);

    await waitFor(() => {
      const createCall = invokeCalls.find((call) => call[0] === "project-session-tabs:create");
      expect(createCall !== undefined).toBe(true);
      const input = createCall?.[1] as Record<string, unknown> | undefined;
      expect(input?.sessionId).toBe("session:alpha:database-view");
      expect(input?.projectId).toBe("alpha");
      expect(input?.panelId).toBe("right");
      expect(input?.targetLeafId).toBe(previewLeafId);
      expect(input?.clientTabId).toBe(previewTabId);
      expect(input?.kind).toBe("card_stage");
      expect(input?.title).toBe("Card One");
      expect(JSON.stringify(input?.config)).toBe(JSON.stringify({
        projectId: "alpha",
        cardId: "card-1",
        titleSnapshot: "Card One",
      }));
    });
    expect(screen.container.querySelector(".nfm-editor .ProseMirror")).toBe(editor);
    expect(document.activeElement).toBe(editor);
    expect((globalThis as { __mockCardStageMounts?: number }).__mockCardStageMounts).toBe(1);
    expect((globalThis as { __mockCardStageUnmounts?: number }).__mockCardStageUnmounts ?? 0).toBe(0);
  });

  test("double-clicking a card-stage preview tab label pins it without remounting", async () => {
    const screen = renderWorkbench();
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
    await settleAsyncRender();

    const previewTab = screen.getByRole("tab", { name: "Card One" });
    const previewTabId = previewTab.closest("[data-panel-tab-id]")?.getAttribute("data-panel-tab-id");
    expect(typeof previewTabId).toBe("string");
    expect((globalThis as { __mockCardStageMounts?: number }).__mockCardStageMounts).toBe(1);
    expect((globalThis as { __mockCardStageUnmounts?: number }).__mockCardStageUnmounts ?? 0).toBe(0);

    invokeCalls = [];
    await act(async () => {
      fireEvent.doubleClick(previewTab);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await waitFor(() => {
      const createCall = invokeCalls.find((call) => call[0] === "project-session-tabs:create");
      expect(createCall !== undefined).toBe(true);
      const input = createCall?.[1] as Record<string, unknown> | undefined;
      expect(input?.clientTabId).toBe(previewTabId);
      expect(input?.kind).toBe("card_stage");
    });

    const durableTab = screen.getByRole("tab", { name: "Card One" });
    expect(durableTab.closest("[data-panel-tab-id]")?.getAttribute("data-panel-tab-id")).toBe(previewTabId);
    expect(durableTab.closest('[data-app-shell-tab-preview="true"]')).toBe(null);
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]')).toBe(null);
    expect((globalThis as { __mockCardStageMounts?: number }).__mockCardStageMounts).toBe(1);
    expect((globalThis as { __mockCardStageUnmounts?: number }).__mockCardStageUnmounts ?? 0).toBe(0);
  });

  test("card-stage preview close control does not pin before closing", async () => {
    const screen = renderWorkbench();
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
    await settleAsyncRender();
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBe(true);

    invokeCalls = [];
    await pointerActivate(screen.getByRole("button", { name: "Close" }));
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
  });

  test("card-stage preview delete control does not pin before deleting", async () => {
    const screen = renderWorkbench();
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
    await settleAsyncRender();
    expect(screen.container.querySelector('[data-app-shell-tabpanel-preview="true"]') !== null).toBe(true);

    invokeCalls = [];
    await pointerActivate(screen.getByRole("button", { name: "Delete" }));
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
    expect((globalThis as { __mockCardStageDeleteClicks?: number }).__mockCardStageDeleteClicks).toBe(1);
  });

  test("replaces the current card-stage preview when another DB card opens", async () => {
    const screen = renderWorkbench();
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

    await act(async () => {
      await (props?.openCardStage as (projectId: string, cardId: string, title?: string) => Promise<void> | void)(
        "alpha",
        "card-2",
        "Card Two",
      );
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "Card One" })).toBe(null);
    });
    const tab = screen.getByRole("tab", { name: "Card Two" });
    expect(tab.closest('[data-app-shell-tab-preview="true"]') !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
  });

  test("opens cross-project DB cards as previews owned by the active session project", async () => {
    const screen = renderWorkbench({
      projects: [makeProject(), makeProject("beta", "Beta")],
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    expect(typeof props?.openCardStage).toBe("function");
    await act(async () => {
      await (props?.openCardStage as (projectId: string, cardId: string, title?: string) => Promise<void> | void)(
        "beta",
        "card-beta",
        "Beta Card",
      );
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const tab = screen.getByRole("tab", { name: "Beta project, Beta Card" });
    expect(tab.closest('[data-app-shell-tab-preview="true"]') !== null).toBe(true);
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
  });

  test("renders cross-project card-stage tabs from their target project", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "db-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "db_view",
          title: "DB View",
          panelId: "right",
          config: { projectId: "alpha", view: "kanban" },
        },
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Beta Card",
          panelId: "right",
          config: { projectId: "beta", cardId: "card-beta", titleSnapshot: "Beta Card" },
        },
      ],
    });

    renderWorkbench({
      projects: [
        makeProject("alpha", "Alpha", "/Users/asc/repo/alpha"),
        makeProject("beta", "Beta", "/Users/asc/repo/beta"),
      ],
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const cardStageProps = (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
    const card = cardStageProps?.card as { id?: string; projectId?: string } | undefined;
    const documentAuthority = cardStageProps?.documentAuthority as {
      kind?: string;
      descriptor?: { projectId?: string; ownerBlockId?: string };
    } | undefined;
    expect(cardStageProps?.projectId).toBe("beta");
    expect(card?.id).toBe("card-beta");
    expect(card?.projectId).toBe("beta");
    expect(documentAuthority?.kind).toBe("ydoc_primary");
    expect(documentAuthority?.descriptor?.projectId).toBe("beta");
    expect(documentAuthority?.descriptor?.ownerBlockId).toBe("card-beta");
  });

  test("card-stage editor can start a new thread in the current blank session", async () => {
    const session = makeBlankSession({
      id: "session:alpha:card-empty",
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:card-empty",
          projectId: "alpha",
          kind: "card_stage",
          title: "Card One",
          panelId: "right",
          config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
        },
      ],
      panels: makePanels({
        rightTabIds: ["card-tab"],
        rightActiveTabId: "card-tab",
      }),
    });

    renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const cardStageProps = (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
    expect(cardStageProps?.sessionId).toBe("session:alpha:card-empty");
    expect(cardStageProps?.canStartThreadInSession).toBe(true);
    const startThread = cardStageProps?.onStartNewSessionThreadFromEditor as ((input: {
      projectId: string;
      targetSessionId?: string;
      prompt: string;
    }) => Promise<{ threadId: string; sessionId?: string }>) | undefined;
    if (!startThread) {
      throw new Error("missing card-stage start-thread callback");
    }

    let result: { threadId: string; sessionId?: string } | null = null;
    await act(async () => {
      result = await startThread({
        projectId: "alpha",
        targetSessionId: "session:alpha:card-empty",
        prompt: "Send selected blocks",
      });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(JSON.stringify(result)).toBe(JSON.stringify({
      threadId: "thread-started",
      sessionId: "session:alpha:card-empty",
    }));
    expect(startThreadForSessionCalls.length).toBe(1);
    expect(JSON.stringify(startThreadForSessionCalls[0])).toBe(JSON.stringify({
      projectId: "alpha",
      sessionId: "session:alpha:card-empty",
      prompt: "Send selected blocks",
      promptInput: undefined,
      threadName: undefined,
      skipAutoTitleGeneration: false,
      runInTarget: "localProject",
    }));
    expect(invokeCalls.some((call) => call[0] === "project-sessions:create")).toBe(false);
  });

  test("card-stage editor can open a mentioned thread session", async () => {
    const session = makeAttachedSession({
      id: "session:alpha:card-open-source",
      threadId: "thread-source",
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:card-open-source",
          projectId: "alpha",
          kind: "card_stage",
          title: "Card One",
          panelId: "right",
          config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
        },
      ],
      panels: makePanels({
        rightTabIds: ["card-tab"],
        rightActiveTabId: "card-tab",
      }),
    });

    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const cardStageProps = (globalThis as { __lastCardStageProps?: Record<string, unknown> }).__lastCardStageProps;
    const openThread = cardStageProps?.onOpenCodexThread as ((threadId: string) => Promise<void>) | undefined;
    expect(typeof openThread).toBe("function");
    if (!openThread) return;

    await act(async () => {
      await openThread("thread-mentioned");
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(invokeCalls.some((call) =>
      call[0] === "codex:thread:ensure-session"
      && call[1] === "thread-mentioned"
    )).toBe(true);
    expect(getThreadRow(screen.container, "Mention target").getAttribute("data-app-action-sidebar-thread-active")).toBe("true");
  });

  test("labels cross-project card-stage tabs with their target project", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "db-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "db_view",
          title: "DB View",
          panelId: "right",
          config: { projectId: "alpha", view: "kanban" },
        },
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Beta Card",
          panelId: "right",
          config: { projectId: "beta", cardId: "card-beta", titleSnapshot: "Beta Card" },
        },
      ],
      rightLayout: makePanelLayout(["db-tab", "card-tab"], "card-tab"),
    });

    const screen = renderWorkbench({
      projects: [
        makeProject("alpha", "Alpha", "/Users/asc/repo/alpha"),
        makeProject("beta", "Beta", "/Users/asc/repo/beta"),
      ],
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "Beta project, Beta Card" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tab-context-label="card-tab"]')?.textContent).toBe("Beta");
    expect(screen.getByLabelText("Close Beta project, Beta Card tab") !== null).toBe(true);
  });

  test("keeps same-project card-stage tabs unprefixed while preserving default title tooltips", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Card One",
          panelId: "right",
          config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
        },
      ],
    });

    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha", "/Users/asc/repo/alpha")],
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "Card One" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tab-context-label="card-tab"]') === null).toBe(true);

    const tabTitle = screen.container.querySelector('[data-app-shell-tab-title="card-tab"]');
    if (!(tabTitle instanceof HTMLElement)) throw new Error("Expected card tab title");
    fireEvent.pointerMove(tabTitle);
    fireEvent.mouseEnter(tabTitle);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const tooltip = screen.container.ownerDocument.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toBe("Card One");
  });

  test("opens terminals from cross-project card tabs in the card target project", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Beta Card",
          panelId: "right",
          config: { projectId: "beta", cardId: "card-beta", titleSnapshot: "Beta Card" },
        },
      ],
    });
    const screen = renderWorkbench({
      projects: [
        makeProject("alpha", "Alpha", "/Users/asc/repo/alpha"),
        makeProject("beta", "Beta", "/Users/asc/repo/beta"),
      ],
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(invokeCalls.some((call) => {
      const input = call[1] as {
        sessionId?: string;
        projectId?: string;
        panelId?: string;
        kind?: string;
        config?: { projectId?: string; terminalSessionId?: string };
      } | undefined;
      return call[0] === "project-session-tabs:create"
        && input?.sessionId === "session:alpha:database-view"
        && input.projectId === "alpha"
        && input.panelId === "bottom"
        && input.kind === "terminal"
        && input.config?.projectId === "beta"
        && typeof input.config.terminalSessionId === "string"
        && input.config.terminalSessionId.startsWith("session:session:alpha:database-view:terminal:");
    })).toBe(true);
  });

  test("shows a card-stage skeleton while card detail hydration is pending", async () => {
    let resolveCardDetail!: (value: unknown) => void;
    const pendingCardDetail = new Promise<unknown>((resolve) => {
      resolveCardDetail = resolve;
    });
    const session = makeSession({
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Card One",
          panelId: "right",
          config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
        },
      ],
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha")],
      sessionsByProject: { alpha: [session] },
      cardGetOverride: (_projectId, cardId) => cardId === "card-1"
        ? pendingCardDetail
        : undefined,
    });
    await settleAsyncRender();

    const loadingShell = screen.getByRole("status", { name: "Loading Card One" });
    expect(loadingShell !== null).toBe(true);
    expect(within(loadingShell).getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);
    expect(within(loadingShell).getByRole("button", { name: "History" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Card not found") === null).toBe(true);
    expect(screen.queryByText("Card:card-1") === null).toBe(true);

    await act(async () => {
      resolveCardDetail({
        id: "card-1",
        projectId: "alpha",
        status: "in_progress",
        title: "Card One",
        description: "",
        tags: [],
        archived: false,
        agentBlocked: false,
        created: new Date("2026-06-07T00:00:00.000Z"),
        order: 0,
        revision: 1,
      });
      await pendingCardDetail;
    });
    await settleAsyncRender();

    expect(screen.getByText("Card:card-1") !== null).toBe(true);
    expect(screen.queryByRole("status", { name: "Loading Card One" }) === null).toBe(true);
    expect(screen.queryByText("Card not found") === null).toBe(true);
  });

  test("renders card detail load failures as load errors instead of missing cards", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Card One",
          panelId: "right",
          config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
        },
      ],
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha")],
      sessionsByProject: { alpha: [session] },
      cardGetOverride: (_projectId, cardId) => {
        if (cardId !== "card-1") return undefined;
        throw new Error("Database is unavailable");
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.getByText("Could not load card") !== null).toBe(true);
    expect(screen.getByText(/Database is unavailable/) !== null).toBe(true);
    expect(screen.queryByText("Card not found") === null).toBe(true);
    expect(screen.queryByRole("button", { name: "Close tab" }) === null).toBe(true);
  });

  test("renders a missing card-stage state instead of a blank tab", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Missing Beta Card",
          panelId: "right",
          config: { projectId: "beta", cardId: "missing-card", titleSnapshot: "Missing Beta Card" },
        },
      ],
    });
    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha"), makeProject("beta", "Beta")],
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.getByText("Card not found") !== null).toBe(true);
    expect(screen.getByRole("button", { name: "Close tab" }) !== null).toBe(true);
    expect(screen.queryByText("Card:missing") === null).toBe(true);
  });

  test("falls back to the content project id when a cross-project card tab project is missing", async () => {
    const session = makeSession({
      tabs: [
        {
          id: "card-tab",
          sessionId: "session:alpha:database-view",
          projectId: "alpha",
          kind: "card_stage",
          title: "Beta Card",
          panelId: "right",
          config: { projectId: "beta", cardId: "card-beta", titleSnapshot: "Beta Card" },
        },
      ],
    });

    const screen = renderWorkbench({
      projects: [makeProject("alpha", "Alpha")],
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.getByRole("tab", { name: "beta project, Beta Card" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-app-shell-tab-context-label="card-tab"]')?.textContent).toBe("beta");
  });

  test("marks cards active in the DB view when selected card-stage tabs are visible", async () => {
    const rightLayout = splitProjectSessionPanelLeaf(
      makePanelLayout(["db-tab", "card-tab"], "db-tab"),
      {
        leafId: "main",
        side: "right",
        tabId: "card-tab",
        newLeafId: "leaf:card",
        newBranchId: "branch:root",
      },
    );
    const panels = makePanels({
      rightTabIds: ["db-tab", "card-tab"],
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
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "db_view",
                title: "DB View",
                panelId: "right",
                config: { projectId: "alpha", view: "kanban" },
              },
              {
                id: "card-tab",
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "card_stage",
                title: "Card One",
                panelId: "right",
                config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
              },
            ],
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    const activeCardIds = props?.activePanelCardStageCardIds as ReadonlySet<string> | undefined;
    expect(activeCardIds?.has("card-1") ?? false).toBe(true);
  });

  test("marks cards active in the DB view when a card-stage preview is visible", async () => {
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
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "db_view",
                title: "DB View",
                panelId: "right",
                config: { projectId: "alpha", view: "kanban" },
              },
              {
                id: "browser-tab",
                sessionId: "session:alpha:database-view",
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
    await settleAsyncRender();
    await settleAsyncRender();

    const nextProps = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    const activeCardIds = nextProps?.activePanelCardStageCardIds as ReadonlySet<string> | undefined;
    expect(activeCardIds?.has("card-1") ?? false).toBe(true);
  });

  test("does not mark cards active from selected card-stage tabs in collapsed panels", async () => {
    const panels = makePanels({
      rightTabIds: ["db-tab"],
      rightActiveTabId: "db-tab",
      bottomTabIds: ["card-tab"],
      bottomActiveTabId: "card-tab",
      bottomCollapsed: true,
    });

    renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            panels,
            tabs: [
              {
                id: "db-tab",
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "db_view",
                title: "DB View",
                panelId: "right",
                config: { projectId: "alpha", view: "kanban" },
              },
              {
                id: "card-tab",
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "card_stage",
                title: "Card One",
                panelId: "bottom",
                config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
              },
            ],
          }),
        ],
      },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const props = (globalThis as { __lastMainViewHostProps?: Record<string, unknown> }).__lastMainViewHostProps;
    const activeCardIds = props?.activePanelCardStageCardIds as ReadonlySet<string> | undefined;
    expect(activeCardIds?.has("card-1") ?? false).toBe(false);
  });

  test("focusing an existing card tab from the DB tab preserves full-width right panel mode", async () => {
    const screen = renderWorkbench({
      sessionsByProject: {
        alpha: [
          makeSession({
            tabs: [
              {
                id: "session:alpha:database-view:db",
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "db_view",
                title: "DB View",
                panelId: "right",
                config: { projectId: "alpha", view: "kanban" },
              },
              {
                id: "card-tab",
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "card_stage",
                title: "Card One",
                panelId: "right",
                config: { projectId: "alpha", cardId: "card-1", titleSnapshot: "Card One" },
              },
            ],
            rightLayout: makePanelLayout(["session:alpha:database-view:db", "card-tab"], "session:alpha:database-view:db"),
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

    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
    expect(invokeCalls.some((call) => call[0] === "project-session-panels:ensure-right-leaf")).toBe(false);
    expect(invokeCalls.some((call) => {
      const input = call[3] as { size?: { fullWidth?: boolean } } | undefined;
      return call[0] === "project-session-panels:update"
        && call[1] === "session:alpha:database-view"
        && call[2] === "right"
        && input?.size?.fullWidth === false;
    })).toBe(false);
    expect(screen.queryByRole("button", { name: "Restore panel width" }) !== null).toBe(true);
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
    const screen = renderWorkbench({
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
                sessionId: "session:alpha:database-view",
                projectId: "alpha",
                kind: "db_view",
                title: "DB View",
                panelId: "right",
                config: { projectId: "alpha", view: "kanban" },
              },
              {
                id: "browser-tab",
                sessionId: "session:alpha:database-view",
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
    await settleAsyncRender();
    await settleAsyncRender();

    const tab = screen.getByRole("tab", { name: "Card One" });
    expect(tab.closest('[data-app-shell-tab-preview="true"]') !== null).toBe(true);
    expect(tab.closest("[data-panel-tab-row]")?.getAttribute("data-panel-tab-row")).toBe("right:leaf:browser");
    expect(invokeCalls.some((call) => call[0] === "project-session-tabs:create")).toBe(false);
    expect(invokeCalls.some((call) => call[0] === "project-session-panels:ensure-right-leaf")).toBe(false);
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
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Terminal 1" }), { button: 0 });
      await Promise.resolve();
    });

    expect(invokeCalls.some((call) => {
      if (call[0] !== "project-session-panels:activate") return false;
      const input = call[1] as { sessionId?: string; panelId?: string; tabId?: string };
      return input.sessionId === "session-1"
        && input.panelId === "bottom"
        && input.tabId === "terminal-tab";
    })).toBe(true);
  });

  test("renders the project session tree on a native-vibrant sidebar beside the rounded main surface", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 312 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.container.querySelector('[data-testid="project-session-sidebar"]');
    expect(sidebar !== null).toBe(true);
    const mainSurface = screen.container.querySelector("main");
    expect(mainSurface !== null).toBe(true);
    const dragStrip = screen.container.querySelector('[data-testid="sidebar-drag-strip"]');
    expect(dragStrip).toBe(null);
    const resizeStrip = screen.getByTestId("sidebar-resize-strip");
    expect(resizeStrip.getAttribute("role")).toBe("separator");
    expect(resizeStrip.getAttribute("aria-orientation")).toBe("vertical");
    expect(textContent(screen.container).includes("Database View")).toBe(true);
    const threadRow = screen.container.querySelector("[data-app-action-sidebar-thread-row]");
    expect(threadRow !== null).toBe(true);
    const threadTitle = threadRow?.querySelector('[data-thread-title="true"]');
    expect(threadTitle?.textContent).toBe("Database View");
    expect(threadTitle?.getAttribute("draggable")).toBe("false");
    const titleTrigger = threadTitle?.closest('[data-thread-title-trigger="true"]');
    expect(String(titleTrigger?.className).includes("self-stretch")).toBe(true);
    const titleIndent = titleTrigger?.parentElement;
    expect(String(titleIndent?.className).includes("pl-0.5")).toBe(true);
    expect(String(titleIndent?.className).includes("ml-1.5")).toBe(true);
    const leadingSlot = titleIndent?.previousElementSibling;
    expect(String(leadingSlot?.className).includes("w-4")).toBe(true);
  });

  test("clicking another project group header expands without switching session", async () => {
    const beta = makeProject("beta", "Beta");
    const betaSession = makeSession({
      id: "session:beta:database-view",
      projectId: "beta",
      title: "Beta Database View",
      tabs: [
        {
          id: "session:beta:database-view:db",
          sessionId: "session:beta:database-view",
          projectId: "beta",
          kind: "db_view",
          title: "DB View",
          order: 0,
          config: { projectId: "beta", view: "kanban" },
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        },
      ],
      rightLayout: makePanelLayout(["session:beta:database-view:db"], "session:beta:database-view:db"),
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

    expect(screen.setDbProjectCalls.includes("beta")).toBe(false);
    expect(textContent(screen.container).includes("Beta Database View")).toBe(true);
    expect(textContent(screen.container).includes("DB:beta:kanban")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByText("Beta Database View"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.setDbProjectCalls.includes("beta")).toBe(true);
    await waitFor(() => {
      expect(textContent(screen.container).includes("DB:beta:kanban")).toBe(true);
    });
  });

  test("clicking Hide sidebar suppresses immediate edge auto-reveal", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBe(true);
    await moveSidebarPointer(12);

    expect(screen.getByRole("button", { name: "Show sidebar" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-sidebar-hover-trigger="true"]')).toBe(null);
    expect(screen.container.querySelector('[data-testid="app-shell-floating-left-panel"]')).toBe(null);
  });

  test("clicking Show sidebar mounts the real sidebar in the first settled render", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: true, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]')).toBe(null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBe(true);
    expect(screen.getByRole("button", { name: "Hide sidebar" }) !== null).toBe(true);
  });

  test("registered menu and command palette sidebar toggles use the same sidebar motion action", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();

    await act(async () => {
      screen.requestSidebarToggle("menu");
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.getByRole("button", { name: "Show sidebar" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBe(true);
    expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]')).toBe(null);

    await executeCommandPaletteCommand(screen, "toggle sidebar", "Toggle sidebar");

    expect(screen.getByRole("button", { name: "Hide sidebar" }) !== null).toBe(true);
    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBe(true);
  });

  test("left sidebar resize clamps at Codex minimum before the collapse threshold", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();

    const sidebar = screen.getByTestId("project-session-sidebar");
    const resizeStrip = screen.getByTestId("sidebar-resize-strip");
    await act(async () => {
      fireEvent.pointerDown(resizeStrip, { button: 0, pointerId: 1, clientX: 300 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 200 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null).toBe(true);
    expect(sidebar.getAttribute("style")?.includes("width: 240px")).toBe(true);
    expect(screen.queryAllByRole("button", { name: "Hide sidebar" }).length > 0).toBe(true);

    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 200 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(sidebar.getAttribute("style")?.includes("width: 240px")).toBe(true);
  });

  test("left sidebar resize closes only past the Codex half-minimum threshold", async () => {
    const restoreMatchMedia = installReducedMotionMatchMediaForTest();
    try {
      const screen = renderWorkbench({ sidebar: { collapsed: false, width: 300 } });
      await settleAsyncRender();
      await settleAsyncRender();

      const resizeStrip = screen.getByTestId("sidebar-resize-strip");
      await act(async () => {
        fireEvent.pointerDown(resizeStrip, { button: 0, pointerId: 2, clientX: 300 });
        fireEvent.pointerMove(window, { pointerId: 2, clientX: 100 });
        await Promise.resolve();
      });
      await settleAsyncRender();

      expect(screen.queryAllByRole("button", { name: "Show sidebar" }).length > 0).toBe(true);

      await act(async () => {
        fireEvent.pointerUp(window, { pointerId: 2, clientX: 100 });
        await Promise.resolve();
      });
      await waitFor(() => {
        if (screen.container.querySelector('[data-testid="project-session-sidebar"]') !== null) {
          throw new Error("Expected project session sidebar to unmount after collapse");
        }
      });
    } finally {
      restoreMatchMedia();
    }
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

    expect(sidebar.getAttribute("style")?.includes("width: 360px")).toBe(true);

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

    expect(sidebar.getAttribute("style")?.includes("width: 300px")).toBe(true);
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

      expect(globalHeader.contains(leftSlot)).toBe(true);
      expect(globalHeader.contains(collapseButton)).toBe(true);
      expect(visibleLeftLabels).toBe("Show sidebar,Back,Forward,New chat");
      expect(leftSlot.className.includes("ps-[max(var(--spacing-token-safe-header-left),0.5rem)]")).toBe(true);
      expect(leftSlot.getAttribute("style")?.includes("width: 0px")).toBe(true);
      expect(leftSlot.getAttribute("style")?.includes("min-width: 208px")).toBe(true);
      expect(collapseButton.parentElement?.className.includes("fixed")).toBe(false);
      expect(collapseButton.getAttribute("title")).toBe("Toggle sidebar");
      expect(backButton.hasAttribute("disabled")).toBe(true);
      expect(forwardButton.hasAttribute("disabled")).toBe(true);
      expect(compactNewChatButton.querySelector("path")?.getAttribute("d")?.startsWith(CODEX_TITLEBAR_NEW_CHAT_ICON_PREFIX)).toBe(true);
      expect(collapseButton.className.includes("no-drag")).toBe(true);

      await moveSidebarPointer(12);

      const floatingShell = screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') as HTMLElement | null;
      const floatingAside = screen.container.querySelector('[data-testid="app-shell-floating-left-panel"]') as HTMLElement | null;
      const floatingHeader = floatingAside?.querySelector(".app-header-tint") as HTMLElement | null;
      expect(floatingShell !== null).toBe(true);
      expect(floatingShell?.getAttribute("data-sidebar-floating-focus-area")).toBe("true");
      expect(floatingShell?.getAttribute("style")?.includes("width: 300px")).toBe(true);
      expect(floatingAside !== null).toBe(true);
      expect(floatingHeader !== null).toBe(true);
      expect(screen.getByTestId("sidebar-resize-strip").parentElement).toBe(floatingShell);

      const floatingFocusButton = Array.from(floatingShell?.querySelectorAll("button") ?? [])
        .find((button) => !button.disabled) as HTMLButtonElement | undefined;
      if (!floatingFocusButton) throw new Error("Expected a focusable floating sidebar button");
      await act(async () => {
        floatingFocusButton.focus();
        await Promise.resolve();
      });
      await settleAsyncRender();

      await moveSidebarPointer(301);
      expect(screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') !== null).toBe(true);

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
        && JSON.stringify(call[1]) === JSON.stringify({ projectId: "alpha", noThreadFallbackTitle: "New thread" })
      )).toBe(true);
      expect(screen.getByRole("button", { name: "Show sidebar" }) !== null).toBe(true);
    } finally {
      Object.defineProperty(navigator, "platform", { configurable: true, value: originalPlatform });
    }
  });

  test("floating sidebar resize uses the Codex clamp-only sash behavior", async () => {
    const screen = renderWorkbench({ sidebar: { collapsed: true, width: 300 } });
    await settleAsyncRender();
    await settleAsyncRender();
    await moveSidebarPointer(12);

    const expandStrip = screen.getByTestId("sidebar-resize-strip");

    await act(async () => {
      fireEvent.pointerDown(expandStrip, { button: 0, pointerId: 8, clientX: 300 });
      fireEvent.pointerMove(window, { pointerId: 8, clientX: 360 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const expandedFloatingShell = screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') as HTMLElement | null;
    expect(expandedFloatingShell !== null).toBe(true);
    expect(expandedFloatingShell?.getAttribute("style")?.includes("width: 360px")).toBe(true);

    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 8, clientX: 360 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const resizeStrip = screen.getByTestId("sidebar-resize-strip");
    let capturedPointerId: number | null = null;
    resizeStrip.setPointerCapture = (pointerId: number) => {
      capturedPointerId = pointerId;
    };

    await act(async () => {
      fireEvent.pointerDown(resizeStrip, { button: 0, pointerId: 9, clientX: 360 });
      fireEvent.pointerMove(window, { pointerId: 9, clientX: 100 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const floatingShell = screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') as HTMLElement | null;
    expect(capturedPointerId).toBe(9);
    expect(floatingShell !== null).toBe(true);
    expect(floatingShell?.getAttribute("style")?.includes("width: 240px")).toBe(true);
    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]')).toBe(null);
    expect(screen.queryAllByRole("button", { name: "Show sidebar" }).length > 0).toBe(true);

    await act(async () => {
      fireEvent.pointerUp(window, { pointerId: 9, clientX: 100 });
      await Promise.resolve();
    });
    await settleAsyncRender();

    const persistedFloatingShell = screen.container.querySelector('[data-testid="floating-project-session-sidebar-shell"]') as HTMLElement | null;
    expect(persistedFloatingShell?.getAttribute("style")?.includes("width: 240px")).toBe(true);
    expect(screen.container.querySelector('[data-testid="project-session-sidebar"]')).toBe(null);
  });

  test("window navigation chrome restores prior and next active sessions", async () => {
    const overviewSession = makeSession();
    const workSession = makeSession({
      id: "session:alpha:work",
      title: "Work",
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

    expect(backButton.hasAttribute("disabled")).toBe(true);
    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Work"));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(backButton.hasAttribute("disabled")).toBe(false);
    expect(forwardButton.hasAttribute("disabled")).toBe(true);
    await waitFor(() => {
      expect(textContent(screen.container).includes("DB:alpha:list")).toBe(true);
    });

    await act(async () => {
      fireEvent.click(backButton);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBe(true);
    expect(backButton.hasAttribute("disabled")).toBe(true);
    expect(forwardButton.hasAttribute("disabled")).toBe(false);

    await act(async () => {
      fireEvent.click(forwardButton);
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await waitFor(() => {
      expect(textContent(screen.container).includes("DB:alpha:list")).toBe(true);
    });
  });

  test("window navigation command requests use the same shell history path", async () => {
    const overviewSession = makeSession();
    const workSession = makeSession({
      id: "session:alpha:work",
      title: "Work",
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

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBe(true);

    await act(async () => {
      screen.requestWorkbenchNavigation("forward", "menu");
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    await waitFor(() => {
      expect(textContent(screen.container).includes("DB:alpha:list")).toBe(true);
    });
  });

  test("window navigation restores right-panel tab selection", async () => {
    const browserTab = makeSessionTab({
      id: "session:alpha:database-view:browser",
      sessionId: "session:alpha:database-view",
      projectId: "alpha",
      kind: "browser",
      title: "Browser",
      order: 1,
      config: { projectId: "alpha" },
    });
    const session = makeSession({
      tabs: [...makeSession().tabs, browserTab],
      rightLayout: makePanelLayout(["session:alpha:database-view:db", browserTab.id], "session:alpha:database-view:db"),
    });
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [session] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Browser" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(screen.getByText("Browser is available in the desktop app") !== null).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await Promise.resolve();
    });
    await settleAsyncRender();
    await settleAsyncRender();

    expect(textContent(screen.container).includes("DB:alpha:kanban")).toBe(true);
  });

  test("window navigation restores right-panel collapsed state", async () => {
    const screen = renderWorkbench({
      sessionsByProject: { alpha: [makeSession({ rightCollapsed: false })] },
    });
    await settleAsyncRender();
    await settleAsyncRender();

    const toggleButton = screen.getByRole("button", { name: "Toggle side panel" });
    expect(screen.queryByTestId("session-right-panel") !== null).toBe(true);
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

    expect(screen.queryByTestId("session-right-panel") !== null).toBe(true);
    expect(toggleButton.getAttribute("aria-pressed")).toBe("true");
  });
  }
});
}
