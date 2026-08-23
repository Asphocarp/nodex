import { afterAll, describe, expect, test, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CodexBackgroundProcessRecord,
  CodexConversationSnapshot,
  CodexCanonicalConversationState,
  CodexEvent,
  CodexGitSettings,
  CodexHostMessage,
  CodexItemView,
  CodexConversationThreadSettings,
  CodexPermissionMode,
  CodexPermissionState,
  CodexPlanImplementationServerRequest,
  CodexPromptInput,
  CodexScheduledAutomation,
  CodexSteerTurnInput,
  CodexThreadActionResult,
  CodexThreadDetail,
  CodexThreadOwnerServerRequest,
  CodexThreadSummary,
  CodexTurnSummary,
  CommandPaletteThreadSummary,
  Project,
  ProjectSession,
  ProjectSessionForkResult,
} from "../../shared/types";
import type { CodexUserInputAutoResolutionEntry } from "../../shared/codex-user-input-auto-resolution";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import {
  getCodexThreadOwnerNotificationThreadId,
  isCodexThreadOwnerNotification,
} from "../../shared/types";
import { TestCodexThreadSettingsRuntime } from "./codex-thread-settings-runtime.test-support";
import type {
  CodexPreparedThreadSettingsUpdate,
  CodexThreadSettingsUpdateCommand,
} from "../codex-application/CodexThreadSettingsRuntime";
import { TestCodexThreadTitlePersistence } from "./codex-thread-title-persistence.test-support";
import { TestCodexPostResumeGoalRuntime } from "./codex-post-resume-goal-runtime.test-support";
import { TestCodexBackgroundSubagentMetadataRepair } from "./codex-background-subagent-metadata-repair.test-support";
import { CodexSubagentCatalog } from "../codex-application/CodexSubagentCatalog";
import { CodexConversationDeltaBufferRuntime } from "../codex-application/CodexConversationDeltaBufferRuntime";
import { TestCodexConversationResumeRuntime } from "./codex-conversation-resume-runtime.test-support";
import type { CodexConversationResumeRuntimePromiseAdapter } from "../codex-application/CodexConversationResumeRuntimePromiseAdapter";
import { TestCodexConversationEventBufferRuntime } from "./codex-conversation-event-buffer-runtime.test-support";
import { TestCodexPendingServerRequestRuntime } from "./codex-pending-server-request-runtime.test-support";
import type { CodexThreadNotificationEvent } from "../../shared/codex-thread-notification";
import type {
  Thread,
  ThreadItem,
  ThreadGoal,
  ThreadGoalSetParams,
  ThreadForkResponse,
  ThreadResumeResponse,
  ThreadRollbackResponse,
  Turn,
  TurnStartResponse,
} from "@nodex/codex-app-server-protocol/v2";
import type { ServerNotification as CodexServerNotification } from "@nodex/codex-app-server-protocol";
import type { AgentProviderCatalog } from "../../shared/agent-runtime";
import { DEFAULT_PROJECT_APPEARANCE } from "../../shared/project-appearance";

type CodexTestServerNotification = {
  method: CodexServerNotification["method"];
  params: unknown;
};
import { getCodexFileChangePaths } from "../../shared/codex-file-change";
import type {
  CodexPendingWorktreeCreateInput,
  CodexPendingWorktreeEntry,
} from "../../shared/codex-pending-worktree";
import { applyCodexConversationStateUpdates } from "../../shared/codex-conversation-patches";
import type { CodexCommandOutputUpdate } from "../../shared/codex-conversation-state/codex-command-output-queue";
import type { CodexMcpToolCallProgressUpdate } from "../../shared/codex-conversation-state/codex-file-change-stream";
import {
  appendCodexCanonicalInProgressSyntheticItem,
  createCodexCanonicalHydratedConversationState,
  isCodexCanonicalProtocolItem,
  removeCodexCanonicalLocalSyntheticItem,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import { CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID } from "../../shared/codex-conversation-state/codex-conversation-reducer";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import { CodexService } from "./codex-service";
import { CodexSessionStore } from "./codex-session-store";
import type { ResolvedCodexRuntime } from "./codex-runtime";
import type { CodexGatewayPromiseClient } from "../codex-runtime/CodexGatewayPromiseAdapter";
import {
  CODEX_SERVER_REQUEST_NO_RESPONSE,
  CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN,
} from "../codex-runtime/CodexApplicationProtocol";
import { CodexRpcError } from "../codex-runtime/CodexGatewayPromiseAdapter";
import { TestCodexUserInputAutoResolutionController } from "./codex-user-input-auto-resolution.test-support";
import { TestCodexActiveGoalContinuation } from "./codex-active-goal-continuation.test-support";
import { DEFAULT_CODEX_OWNER_NOTIFICATION_DRAIN_TIMEOUT } from "../codex-application/CodexOwnerNotificationDrainRuntime";
import {
  makeCodexRendererConversationRegistryState,
  type CodexRendererConversationRegistryService,
} from "../codex-application/CodexRendererConversationRegistry";
import type { CodexRendererConversationCoordinatorService } from "../codex-application/CodexRendererConversationCoordinator";
import type {
  CodexApplicationEvent,
  CodexApplicationEventPublisher,
} from "../codex-application/CodexApplicationEventHub";
import { TestCodexOwnerNotificationDrainRuntime } from "./codex-owner-notification-drain-runtime.test-support";
import {
  TestCodexSidebarSyncRuntime,
  TestDatabaseInvalidationSource,
} from "./codex-sidebar-sync-runtime.test-support";
import type { CodexForkSidePanelTransferRuntimePromiseAdapter } from "../codex-application/CodexForkSidePanelTransferRuntimePromiseAdapter";
import { runCodexGitCommand } from "./codex-git-command";
import type { CodexWorktreeWorkerEvent } from "./codex-worktree-worker-protocol";
import {
  PastedTextAttachmentManager,
  ThreadGoalAttachmentDirectoryManager,
} from "../thread-goal-attachments";
import type { NodexAgentAuthorityPort } from "../nodex-agent-authority-port";
import type { NodexAgentResourceAuthorityPort } from "../nodex-agent-resource-authority-port";
import type { DesktopAutomationModulePort } from "../core-client/desktop-automation-module-bridge";
import type {
  DesktopProjectWorkspacePort,
  DesktopProjectWorkspaceSidebar,
  DesktopProjectWorkspaceThread,
  DesktopProjectWorkspaceThreadMoveInput,
} from "../core-client/project-workspace-adapter";
import { PersistedAtomStore } from "../local-store/persisted-atoms";
import { CodexApplicationRequestPending } from "../codex-application/ApprovalCoordinator";
import type { ExecutionHostRuntime } from "../codex-application/ExecutionHostRuntime";
import type { ManagedWorktreeRuntime } from "../codex-application/ManagedWorktreeRuntime";
import type { ManagedWorktreeRetentionRuntime } from "../codex-application/ManagedWorktreeRetentionRuntime";
import type { CodexThreadHandoffRuntime } from "../codex-application/CodexThreadHandoffRuntime";
import { normalizeCodexThreadGoalSetAction } from "../codex-application/CodexThreadGoalRuntime";
import type { CodexThreadGoalRuntimePromiseAdapter } from "../codex-application/CodexThreadGoalRuntimePromiseAdapter";
import type { ConversationCommands } from "../codex-application/ConversationCommands";
import type { CodexQueuedFollowUpDispatcher } from "../codex-application/CodexQueuedFollowUpDispatcher";
import { CodexQueuedFollowUps } from "../codex-application/CodexQueuedFollowUps";
import type { CodexTurnCommandsService } from "../codex-application/CodexTurnCommands";
import type { CodexSidebarSweepRuntimePromiseAdapter } from "../codex-application/CodexSidebarSweepRuntimePromiseAdapter";
import { makeProjectRuntimeLifecycleTestHarness } from "../host-runtime/ProjectRuntimeLifecycleRuntime.test-support";
import { CodexPendingWorktreeRuntime } from "./codex-pending-worktree-runtime.test-support";
import {
  makeCodexConversationAggregateRegistry,
  type CodexConversationAggregate,
} from "../codex-application/CodexConversationAggregate";
import { ConversationRuntimeMap } from "../codex-application/ConversationRuntimeMap";

const conversationAggregatesByTestService = new WeakMap<
  object,
  Pick<ConversationRuntimeMap["Service"], "conversation" | "currentConversation">
>();
const conversationAggregateByTestRecord = new WeakMap<object, CodexConversationAggregate>();

const rendererConversationsForTest = (service: object): CodexRendererConversationRegistryService =>
  Reflect.get(service, "rendererConversations") as CodexRendererConversationRegistryService;

const setTestConversationStreamRole = (
  service: object,
  threadId: string,
  role: "follower" | "owner" | null,
): void => {
  conversationAggregatesByTestService.get(service)?.conversation(threadId).setStreamRole(role);
};

const conversationAggregateForTest = (
  service: object,
  threadId: string,
): CodexConversationAggregate => {
  const aggregate = conversationAggregatesByTestService.get(service)?.conversation(threadId);
  if (!aggregate) throw new Error(`Missing test conversation aggregate for '${threadId}'`);
  return aggregate;
};

interface TestableCodexService {
  manualCompactionProjection: CodexService["manualCompactionProjection"];
  threadGoalProjection: CodexService["threadGoalProjection"];
  on: {
    (event: "event", listener: (event: CodexEvent) => void): unknown;
    (
      event: "hostMessage",
      listener: (message: import("../../shared/types").CodexHostMessage) => void,
    ): unknown;
    (
      event: "rendererOwnerHostMessage",
      listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
    ): unknown;
  };
  addThreadNotificationListener: (
    listener: (event: CodexThreadNotificationEvent) => void,
  ) => () => void;
  shutdown: () => Promise<void>;
  routeAppServerNotification: (notification: CodexServerNotification) => Promise<void>;
  observeConnection: (connection: import("../../shared/types").CodexConnectionState) => void;
  readThread: (threadId: string, includeTurns?: boolean) => Promise<CodexThreadDetail | null>;
  sidebarSync: import("../codex-application/CodexSidebarSyncRuntimePromiseAdapter").CodexSidebarSyncRuntimePromiseAdapter;
  threadCatalog: import("../codex-application/CodexThreadCatalogPromiseAdapter").CodexThreadCatalogPromiseAdapter;
  requestConversationResume: (
    threadId: string,
    options?: { syncDormantConversationSnapshots?: boolean; replayBufferedNotifications?: boolean },
  ) => Promise<CodexConversationSnapshot | null>;
  releaseConversationResumeBufferForModule: CodexService["releaseConversationResumeBufferForModule"];
  serializeThreadDetail: (threadId: string) => CodexThreadDetail | null;
  serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
  listPendingWorktrees: () => readonly import("../../shared/codex-pending-worktree").CodexPendingWorktreeEntry[];
  createPendingWorktree: (input: CodexPendingWorktreeCreateInput) => {
    readonly pendingWorktreeId: string;
    readonly clientThreadId: string | null;
  };
  cancelPendingWorktree: (hostId: string, pendingWorktreeId: string) => void;
  resumeThread: (threadId: string) => Promise<CodexThreadDetail | null>;
  forkConversationFromTurn: (
    threadId: string,
    turnId: string,
    message: string,
  ) => Promise<CodexThreadActionResult>;
  forkProjectSessionThread: (
    sessionId: string,
    input: {
      target: "local" | "newWorktree";
      turnId?: string;
      message?: string;
      collaborationMode?: "default" | "plan";
      localEnvironmentConfigPath?: string | null;
    },
  ) => Promise<ProjectSessionForkResult>;
  startTurn: (
    threadId: string,
    prompt: string,
    opts?: {
      model?: string;
      serviceTier?: null | "fast";
      reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      summary?: "auto" | "concise" | "detailed" | "none" | null;
      permissionMode?: CodexPermissionMode;
      collaborationMode?: "default" | "plan";
      promptInput?: CodexPromptInput;
    },
  ) => Promise<CodexTurnSummary | null>;
  steerTurn: (input: CodexSteerTurnInput) => Promise<{ turnId: string } | null>;
  runScheduledAutomationNow: (
    input: import("../../shared/types").CodexScheduledAutomationRunNowInput,
    rendererClientId?: string | null,
  ) => Promise<void>;
  resolveAutomationArchiveMessages: (threadId: string) => Promise<{
    archivedUserMessage: string | null;
    archivedAssistantMessage: string | null;
  }>;
  runScheduledAutomation: (
    automation: CodexScheduledAutomation,
    context: {
      now?: number;
      reason?: "scheduled" | "run-now";
      heartbeat?: {
        automationsEnabled: boolean;
        rendererState: {
          rendererClientId: string;
          isEligible: boolean;
          reason: string | null;
          updatedAtMs?: number;
        } | null;
        collaborationMode:
          | import("../../shared/types").CodexHeartbeatAutomationCollaborationMode
          | null;
        permissions: import("../../shared/types").CodexHeartbeatAutomationPermissions | null;
      };
    },
  ) => Promise<void>;
  reconcileArchivedThreadManagedWorktree: (
    thread: DesktopProjectWorkspaceThread,
    reason: "archive" | "automation-archive",
  ) => Promise<void>;
  prepareThreadSettingsUpdate: (
    input: CodexThreadSettingsUpdateCommand,
    signal: AbortSignal,
  ) => Promise<CodexPreparedThreadSettingsUpdate>;
}

function makeThreadDetail(threadId: string): CodexThreadDetail {
  return {
    threadId,
    projectId: "project-1",
    source: null,
    threadName: "Thread",
    threadPreview: "",
    modelProvider: "openai",
    cwd: "/tmp",
    statusType: "active",
    statusActiveFlags: [],
    hasUnreadTurn: false,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    linkedAt: new Date().toISOString(),
    turns: [],
    transcript: [],
  };
}

function makeProtocolThread(threadId: string, cwd: string, turns: Turn[] = []): Thread {
  return {
    id: threadId,
    extra: null,
    sessionId: threadId,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1_711_278_000,
    updatedAt: 1_711_278_060,
    recencyAt: 1_711_278_060,
    status: { type: "active", activeFlags: [] },
    path: `${cwd}/rollout.jsonl`,
    cwd,
    cliVersion: "0.0.0-test",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Canonical hydration fixture",
    turns,
  };
}

type ProtocolCommandExecution = Extract<ThreadItem, { type: "commandExecution" }>;
type ProtocolAgentMessage = Extract<ThreadItem, { type: "agentMessage" }>;

function makeProtocolAgentMessage(
  input: Pick<ProtocolAgentMessage, "id" | "text"> &
    Partial<Omit<ProtocolAgentMessage, "type" | "id" | "text">>,
): ProtocolAgentMessage {
  return {
    type: "agentMessage",
    id: input.id,
    text: input.text,
    phase: input.phase ?? null,
    memoryCitation: input.memoryCitation ?? null,
  };
}

function makeProtocolCommandExecution(
  input: Pick<ProtocolCommandExecution, "id" | "command"> &
    Partial<Omit<ProtocolCommandExecution, "type" | "id" | "command">>,
): ProtocolCommandExecution {
  return {
    type: "commandExecution",
    id: input.id,
    pluginId: input.pluginId ?? null,
    scriptPath: input.scriptPath ?? null,
    command: input.command,
    cwd: input.cwd ?? "/workspace/project",
    processId: input.processId ?? null,
    source: input.source ?? "agent",
    status: input.status ?? "inProgress",
    commandActions: input.commandActions ?? [],
    aggregatedOutput: input.aggregatedOutput ?? null,
    exitCode: input.exitCode ?? null,
    durationMs: input.durationMs ?? null,
  };
}

function makeCanonicalHydrationTurn(turnId: string): Turn {
  const sharedItemId = "shared-canonical-slot";
  const items = [
    {
      type: "userMessage",
      id: "canonical-user-message",
      clientId: null,
      content: [
        {
          type: "text",
          text: [
            "# Files mentioned by the user:",
            "",
            "## fixture: /workspace/project/file.ts (line 7)",
            "",
            "## My request for Codex:",
            "Preserve the raw item slots.",
          ].join("\n"),
          text_elements: [],
        },
      ],
    },
    {
      type: "enteredReviewMode",
      id: sharedItemId,
      review: "hidden review payload",
    },
    {
      type: "fileChange",
      id: sharedItemId,
      changes: [],
      status: "inProgress",
    },
    {
      type: "commandExecution",
      id: sharedItemId,
      pluginId: null,
      scriptPath: null,
      command: "pwd",
      cwd: "/workspace/project",
      processId: null,
      source: "agent",
      status: "inProgress",
      commandActions: [],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    },
  ] satisfies ThreadItem[];

  return {
    id: turnId,
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1_711_278_050,
    completedAt: 1_711_278_060,
    durationMs: 10_000,
  };
}

function makeCanonicalResumeResponse(input: {
  threadId: string;
  threadTurns?: Turn[];
  initialTurnsPage: ThreadResumeResponse["initialTurnsPage"];
  activePermissionProfile?: ThreadResumeResponse["activePermissionProfile"];
  model?: string;
  runtimeWorkspaceRoots?: string[];
}): ThreadResumeResponse {
  const cwd = "/workspace/project";
  return {
    thread: makeProtocolThread(input.threadId, cwd, input.threadTurns ?? []),
    model: input.model ?? "gpt-canonical",
    modelProvider: "openai",
    serviceTier: null,
    cwd,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? [cwd],
    instructionSources: [],
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: {
      type: "workspaceWrite",
      writableRoots: [cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    activePermissionProfile: input.activePermissionProfile ?? null,
    reasoningEffort: "high",
    multiAgentMode: "explicitRequestOnly",
    initialTurnsPage: input.initialTurnsPage,
    turnsBackwardsCursor: null,
    itemsBackwardsCursor: null,
  };
}

function buildCanonicalHistoryTimeline(
  service: ReturnType<typeof createService>,
  input: {
    threadId: string;
    turns: readonly Turn[];
    requests?: CodexCanonicalConversationState["requests"];
    transformState?: (state: CodexCanonicalConversationState) => CodexCanonicalConversationState;
  },
): Pick<CodexThreadDetail, "turns" | "transcript"> {
  const cwd = "/workspace/project";
  const state = createCodexCanonicalHydratedConversationState(
    makeProtocolThread(input.threadId, cwd, [...input.turns]),
    {
      model: "gpt-canonical",
      reasoningEffort: "high",
      cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      activePermissionProfile: null,
      runtimeWorkspaceRoots: [cwd],
      pendingRequests: input.requests ?? [],
    },
  );
  const canonicalState = input.transformState?.(state) ?? state;
  const internals = service as unknown as {
    buildThreadTimelineFromCanonicalState: (
      value: CodexCanonicalConversationState,
    ) => Pick<CodexThreadDetail, "turns" | "transcript">;
  };
  return internals.buildThreadTimelineFromCanonicalState(canonicalState);
}

function makeCanonicalStateDetailFixture(
  state: CodexCanonicalConversationState,
  overrides: Partial<CodexThreadDetail> = {},
): CodexThreadDetail {
  return {
    ...makeThreadDetail(state.protocol.id),
    threadName: state.protocol.name,
    cwd: state.sidecar.hydrationContext?.cwd ?? state.protocol.cwd,
    turns: state.turns.flatMap((turn): CodexTurnSummary[] => {
      if (turn.protocol.id === null) return [];
      return [
        {
          threadId: state.protocol.id,
          turnId: turn.protocol.id,
          status: turn.protocol.status,
          itemIds: turn.items.map((item) => item.id),
        },
      ];
    }),
    transcript: [],
    ...overrides,
  };
}

function completeLegacyProtocolTurnFixture(value: unknown): Turn {
  const turn = value as Partial<Turn> & { id?: unknown };
  if (typeof turn.id !== "string") {
    throw new Error("Legacy turn fixture requires an id");
  }

  return {
    id: turn.id,
    items: Array.isArray(turn.items) ? turn.items : [],
    itemsView: "full",
    status:
      turn.status === "completed" ||
      turn.status === "interrupted" ||
      turn.status === "failed" ||
      turn.status === "inProgress"
        ? turn.status
        : "completed",
    error: turn.error ?? null,
    startedAt: typeof turn.startedAt === "number" ? turn.startedAt : null,
    completedAt: typeof turn.completedAt === "number" ? turn.completedAt : null,
    durationMs: typeof turn.durationMs === "number" ? turn.durationMs : null,
  };
}

function makeCanonicalForkResponse(input: {
  threadId: string;
  turns: Turn[];
  cwd: string;
  model?: string;
  reasoningEffort?: ThreadForkResponse["reasoningEffort"];
  activePermissionProfile?: ThreadForkResponse["activePermissionProfile"];
  runtimeWorkspaceRoots?: string[];
}): ThreadForkResponse {
  return {
    thread: makeProtocolThread(input.threadId, input.cwd, input.turns),
    model: input.model ?? "gpt-fork",
    modelProvider: "openai",
    serviceTier: null,
    cwd: input.cwd,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? [input.cwd],
    instructionSources: [],
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: {
      type: "readOnly",
      networkAccess: false,
    },
    activePermissionProfile: input.activePermissionProfile ?? null,
    reasoningEffort: input.reasoningEffort ?? "high",
    multiAgentMode: "explicitRequestOnly",
  };
}

function makeCanonicalForkResumeResponse(response: ThreadForkResponse): ThreadResumeResponse {
  return {
    ...response,
    thread: {
      ...response.thread,
      turns: [],
    },
    initialTurnsPage: {
      data: [...response.thread.turns].reverse(),
      nextCursor: null,
      backwardsCursor: null,
    },
    turnsBackwardsCursor: null,
    itemsBackwardsCursor: null,
  };
}

function getCanonicalConversationState(
  service: TestableCodexService,
  threadId: string,
): CodexCanonicalConversationState | null {
  return (
    conversationAggregatesByTestService
      .get(service)
      ?.currentConversation(threadId)
      ?.readCanonicalState() ?? null
  );
}

function makeDesktopWorkspaceThread(
  overrides: Partial<DesktopProjectWorkspaceThread> = {},
): DesktopProjectWorkspaceThread {
  return {
    threadId: "thread-workspace",
    projectId: "project-workspace",
    sessionId: "session-workspace",
    forkedFromId: null,
    parentThreadId: null,
    threadSource: null,
    serviceName: null,
    agentNickname: null,
    agentRole: null,
    agentPath: null,
    threadName: "Workspace Thread",
    threadPreview: "Workspace Thread",
    modelProvider: "openai",
    executionHostId: "local",
    cwd: "/tmp/nodex",
    managedWorktreePath: null,
    projectlessOutputDirectory: null,
    projectlessWorkspaceBrowserRoot: null,
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    pinnedOrder: null,
    hasUnreadTurn: false,
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 2,
    linkedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}
function makeProject(overrides: Partial<Project> & Pick<Project, "id">): Project {
  const { id, ...rest } = overrides;
  return {
    id,
    libraryId: "library:test",
    databaseId: `database:${id}`,
    defaultDatabaseViewId: null,
    lifecycle: "active",
    bindingRevision: 1,
    name: id,
    description: "",
    appearance: DEFAULT_PROJECT_APPEARANCE,
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: new Date(0),
    updated: new Date(0),
    ...rest,
  };
}

const DEFAULT_TEST_THREAD_GOAL_ATTACHMENTS_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "nodex-codex-service-goal-attachments-"),
);
const PREVIOUS_TEST_NODEX_HOME = process.env.NODEX_HOME;
const DEFAULT_TEST_LOCAL_STORE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "nodex-codex-service-local-store-"),
);
const EMPTY_TEST_BROWSER_TRANSFER_STATE_READER = {
  getStateSnapshot: (): BrowserSidebarStateSnapshot => ({ tabs: [] }),
  getBrowserUseStateSnapshot: (): BrowserSidebarBrowserUseStateSnapshot => ({
    tabs: [],
    activeBrowserTabIdsByConversationScope: {},
    cursors: [],
  }),
};
const PROJECT_RUNTIME_TEST_HARNESS_RELEASES: Array<() => Promise<void>> = [];

const makeCodexSidebarSweepTestAdapter = (): CodexSidebarSweepRuntimePromiseAdapter => {
  let generation = 0;
  let active: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = <State extends { archived: boolean; cursor: string | null; phase: string }>(
    admittedGeneration: number,
    state: State,
    step: (state: State) => Promise<State | null>,
  ): void => {
    timer = setTimeout(() => {
      timer = null;
      if (admittedGeneration !== generation) return;
      const running = step(state)
        .then((nextState) => {
          if (nextState === null || admittedGeneration !== generation) return;
          schedule(admittedGeneration, nextState, step);
        })
        .catch(() => undefined);
      active = running;
      void running.finally(() => {
        if (active === running) active = null;
      });
    }, 0);
  };

  return {
    start: async (initialState, step) => {
      const admittedGeneration = ++generation;
      schedule(admittedGeneration, initialState, step);
    },
    cancel: async () => {
      generation += 1;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await active;
    },
  };
};

const TEST_CODEX_RUNTIME: ResolvedCodexRuntime = {
  source: "staged",
  binaryPath: "/tmp/nodex-test-agent",
  browserRuntime: {
    message: "Browser runtime is unavailable in this fixture",
    reason: "manifest-missing",
    status: "unavailable",
  },
  additionalSearchPaths: [],
  codexCompatibilityVersion: null,
  metadataPath: "/tmp/nodex-test-agent-runtime.json",
  missingBinaryMessage: "Agent runtime is unavailable in this fixture",
  runtimeFamily: "open-interpreter",
  rootPath: "/tmp",
  version: null,
};

class TestCodexGatewayPromiseClient implements CodexGatewayPromiseClient {
  async request<TResult>(method: string, _params?: unknown, _options?: unknown): Promise<TResult> {
    throw new Error(`Unexpected client request: ${method}`);
  }
  async requestOnHost<TResult>(
    _hostId: string,
    method: string,
    params?: unknown,
    _options?: unknown,
  ): Promise<TResult> {
    return await this.request<TResult>(method, params);
  }
  async start(_options?: unknown): Promise<void> {}
}

const createTestAutomationModule = (): DesktopAutomationModulePort => ({
  listDefinitions: async () => [],
  getDefinition: async () => null,
  createDefinition: async () => {
    throw new Error("Automation creation is not configured for this test");
  },
  updateDefinition: async () => null,
  deleteDefinition: async () => {
    throw new Error("Automation deletion is not configured for this test");
  },
  dispatchDefinitionNow: async () => null,
  rescheduleDefinition: async () => null,
  claimDueDefinitions: async () => [],
  completeLease: async () => undefined,
  failLease: async () => undefined,
  settleInterruptedRuns: async () => ({
    archivedPendingCount: 0,
    pendingReviewCount: 0,
  }),
  getRun: async () => null,
  beginRun: async () => false,
  replacePendingRunThread: async () => false,
  setRunThreadTitle: async () => false,
  completeRunForReview: async () => false,
  setRunInboxItem: async () => false,
  acceptRun: async () => false,
  archiveRun: async () => false,
  deleteRun: async () => false,
  unarchiveRun: async () => false,
  readInbox: async () => ({
    items: [],
    unreadRunCounts: { total: 0, automationIds: [], unreadRuns: [] },
  }),
  setRunReadState: async () => null,
  markAllRunsRead: async () => 0,
  listPageOccurrences: async () => ({ items: [], nextCursor: null }),
  completePageOccurrence: async () => ({ success: false }),
  skipPageOccurrence: async () => ({ success: false }),
  updatePageOccurrence: async () => ({ success: false }),
  snoozeReminder: async () => undefined,
  claimDueReminders: async () => [],
  completeReminderLease: async () => undefined,
  failReminderLease: async () => undefined,
});

describe("codex-service provider-backed scheduled automations", () => {
  test("resumes heartbeat targets with their persisted provider profile", async () => {
    const configCwds: Array<string | null> = [];
    const service = createService({
      threadCodexConfigBuilder: async (cwd) => {
        configCwds.push(cwd);
        return { "mcp.test_enabled": true };
      },
    });
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method !== "thread/resume") throw new Error(`Unexpected request: ${method}`);
      return {
        thread: {
          id: "thread-heartbeat-kimi",
          status: { type: "idle" },
          createdAt: 1,
          updatedAt: 2,
          cwd: "/tmp/kimi",
          modelProvider: "kimi-for-coding",
          preview: "",
          name: "Kimi heartbeat",
          turns: [],
        },
        cwd: "/tmp/kimi",
      };
    };
    const internals = service as unknown as {
      resumeHeartbeatTargetThread: (
        thread: unknown,
        rolloutPath: string | null,
      ) => Promise<{ threadId: string; cwd: string }>;
    };

    try {
      await internals.resumeHeartbeatTargetThread(
        {
          threadId: "thread-heartbeat-kimi",
          cwd: "/tmp/kimi",
          executionProfile: {
            providerId: "kimi-for-coding",
            modelId: "kimi-k3",
            harnessId: "kimi-code",
            reasoningEffort: "Thinking",
            serviceTier: null,
          },
        },
        "/tmp/kimi/rollout.jsonl",
      );

      const params = requests[0]?.params as {
        model?: string | null;
        modelProvider?: string | null;
        serviceTier?: string | null;
        config?: Record<string, unknown>;
      };
      expect(params.model).toBe("kimi-k3");
      expect(params.modelProvider).toBe("kimi-for-coding");
      expect(params.serviceTier).toBeNull();
      expect(params.config?.harness).toBe("kimi-code");
      expect(params.config?.model_reasoning_effort).toBe("Thinking");
      expect(params.config?.["mcp.test_enabled"]).toBe(true);
      expect(configCwds).toEqual(["/tmp/kimi"]);
    } finally {
      await service.shutdown();
    }
  });

  test("keeps the source checkout out of automation worktree permissions", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-automation-roots-"));
    const sourceRoot = path.join(fixtureRoot, "source");
    const worktreeRoot = path.join(fixtureRoot, "worktree");
    initializeGitRepository(sourceRoot);
    execFileSync("git", ["worktree", "add", "--detach", worktreeRoot, "HEAD"], {
      cwd: sourceRoot,
    });
    const service = createService();
    const internals = service as unknown as {
      resolveCronScheduledAutomationWorkspaceRoots: (input: {
        automationId: string;
        sourceCwd: string;
        runLocation: {
          cwd: string;
          workspaceRoots: string[];
          projectlessOutputDirectory: null;
        };
      }) => Promise<string[]>;
    };

    try {
      const roots = await internals.resolveCronScheduledAutomationWorkspaceRoots({
        automationId: "automation-roots",
        sourceCwd: sourceRoot,
        runLocation: {
          cwd: worktreeRoot,
          workspaceRoots: [worktreeRoot],
          projectlessOutputDirectory: null,
        },
      });

      expect(roots).toContain(path.resolve(worktreeRoot));
      expect(roots).toContain(fs.realpathSync(path.join(sourceRoot, ".git")));
      expect(roots).not.toContain(path.resolve(sourceRoot));
      expect(roots.some((root) => root.endsWith("/automations/automation-roots"))).toBe(true);
    } finally {
      await service.shutdown();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

const TEST_NODEX_AGENT_AUTHORITY: NodexAgentAuthorityPort = {
  beginTurn: async () => null,
  bindTurn: async () => null,
  observeTurnStarted: async () => null,
  abortTurn: () => undefined,
  inheritTurn: async () => null,
  capturePersisted: async () => null,
  hasRecordedAuthority: async () => false,
  capture: async () => null,
};

const TEST_NODEX_AGENT_RESOURCE_AUTHORITY: NodexAgentResourceAuthorityPort = {
  plan: async () => {
    throw new Error("Nodex Agent resource authority is unavailable in this fixture");
  },
  persistProjectGrants: async () => undefined,
};

const createTestProjectWorkspace = (): DesktopProjectWorkspacePort => {
  const threads = new Map<string, DesktopProjectWorkspaceThread>();
  const permissionModes = new Map<string, CodexPermissionMode>();
  const writableRootsByThread = new Map<string, string[]>();
  let projectlessPermissionMode: CodexPermissionMode | null = null;
  const backgroundProcesses = new Map<string, CodexBackgroundProcessRecord>();
  const readSidebar = (): DesktopProjectWorkspaceSidebar => ({
    threads: [...threads.values()],
  });
  const updateThread = (
    threadId: string,
    patch: Parameters<DesktopProjectWorkspacePort["updateThread"]>[1],
  ): DesktopProjectWorkspaceThread | null => {
    const current = threads.get(threadId);
    if (!current) return null;
    const updated = makeDesktopWorkspaceThread({ ...current, ...patch, threadId });
    threads.set(threadId, updated);
    return updated;
  };

  const port = {
    listProjects: async () => [],
    listProjectWindow: async () => ({
      items: [],
      nextCursor: null,
      hasMore: false,
      projectionRevision: 0,
    }),
    getProject: async () => null,
    readProjectPermissionMode: async (projectId: string) => permissionModes.get(projectId) ?? null,
    readProjectlessPermissionMode: async () => projectlessPermissionMode,
    setProjectPermissionMode: async (projectId: string, mode: CodexPermissionMode) => {
      permissionModes.set(projectId, mode);
      return mode;
    },
    setProjectlessPermissionMode: async (mode: CodexPermissionMode) => {
      projectlessPermissionMode = mode;
      return mode;
    },
    createProject: async () => {
      throw new Error("Project creation is not configured for this test");
    },
    listProjectSessionSummaries: async () => [],
    listProjectSessionSummaryWindow: async () => ({
      items: [],
      nextCursor: null,
      hasMore: false,
      projectionRevision: 0,
    }),
    readSidebarOverview: async () => ({
      items: [...threads.values()]
        .filter((thread) => thread.pinnedOrder !== null)
        .map((thread) => ({
          id: thread.sessionId ?? `session:${thread.threadId}`,
          projectId: thread.projectId,
          noThreadFallbackTitle: thread.threadName ?? "New thread",
          displayTitle: (thread.threadName ?? thread.threadPreview) || "New thread",
          order: 0,
          pinned: true,
          pinnedOrder: thread.pinnedOrder,
          archived: thread.archived,
          archivedAt: null,
          unread: thread.hasUnreadTurn,
          thread: {
            sessionId: thread.sessionId ?? `session:${thread.threadId}`,
            projectId: thread.projectId,
            threadId: thread.threadId,
            forkedFromId: thread.forkedFromId,
            parentThreadId: thread.parentThreadId ?? undefined,
            threadName: thread.threadName ?? undefined,
            threadPreview: thread.threadPreview,
            modelProvider: thread.modelProvider,
            executionProfile: thread.executionProfile,
            executionHostId: thread.executionHostId,
            cwd: thread.cwd ?? undefined,
            managedWorktreePath: thread.managedWorktreePath,
            projectlessOutputDirectory: thread.projectlessOutputDirectory,
            projectlessWorkspaceBrowserRoot: thread.projectlessWorkspaceBrowserRoot,
            statusType: thread.statusType,
            statusActiveFlags: [...thread.statusActiveFlags],
            archived: thread.archived,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            recencyAt: thread.recencyAt,
            linkedAt: thread.linkedAt,
          },
          createdAt: thread.linkedAt,
          updatedAt: thread.linkedAt,
        })),
      nextCursor: null,
      hasMore: false,
      projectionRevision: 0,
    }),
    getProjectSession: async () => null,
    createProjectSession: async () => {
      throw new Error("Project Session creation is not configured for this test");
    },
    deleteProjectSession: async () => false,
    archiveProjectSession: async () => null,
    setProjectSessionPinned: async () => null,
    createWorkbenchTabProjection: async () => {
      throw new Error("Project Session tab creation is not configured for this test");
    },
    detachProjectSessionThread: async () => false,
    getThread: async (threadId: string) => threads.get(threadId) ?? null,
    upsertThread: async (
      threadId: string,
      patch: Parameters<DesktopProjectWorkspacePort["upsertThread"]>[1],
    ) => {
      const updated = makeDesktopWorkspaceThread({
        ...(threads.get(threadId) ?? { threadId }),
        ...patch,
        threadId,
      });
      threads.set(threadId, updated);
      return updated;
    },
    updateThread: async (
      threadId: string,
      patch: Parameters<DesktopProjectWorkspacePort["updateThread"]>[1],
    ) => updateThread(threadId, patch),
    setThreadExecutionLocation: async (
      threadId: string,
      location: Parameters<DesktopProjectWorkspacePort["setThreadExecutionLocation"]>[1],
    ) => {
      writableRootsByThread.set(threadId, [...location.runtimeWorkspaceRoots]);
      return updateThread(threadId, {
        executionHostId: location.executionHostId,
        cwd: location.cwd,
        managedWorktreePath: location.managedWorktreePath,
        projectlessOutputDirectory: location.projectlessOutputDirectory,
        projectlessWorkspaceBrowserRoot: location.projectlessWorkspaceBrowserRoot,
      });
    },
    moveThread: async (input: Parameters<DesktopProjectWorkspacePort["moveThread"]>[0]) => {
      const thread =
        updateThread(input.threadId, {
          projectId: input.targetProjectId,
          ...input.metadata,
        }) ??
        makeDesktopWorkspaceThread({
          threadId: input.threadId,
          projectId: input.targetProjectId,
          ...input.metadata,
        });
      threads.set(input.threadId, thread);
      return {
        thread,
        operationId: `test-move:${input.threadId}`,
        projectionRevision: 1,
      };
    },
    setThreadUnread: async (threadId: string, unread: boolean) => {
      const current = threads.get(threadId);
      if (!current) return null;
      const updated = makeDesktopWorkspaceThread({
        ...current,
        hasUnreadTurn: unread,
        updatedAt: Date.now(),
      });
      threads.set(threadId, updated);
      return updated;
    },
    setThreadArchived: async (threadId: string, archived: boolean) => {
      updateThread(threadId, { archived });
      return readSidebar();
    },
    deleteThread: async (threadId: string) => {
      writableRootsByThread.delete(threadId);
      return {
        deleted: threads.delete(threadId),
        sidebar: readSidebar(),
      };
    },
    observeAppServerThreadWindow: async () => undefined,
    reconcileAppServerThreadSweep: async () => ({
      threadIds: [],
      projectIds: [],
    }),
    readThreadExecutionContext: async (threadId: string) => {
      const thread = threads.get(threadId);
      if (!thread) return null;
      return {
        threadId,
        projectId: thread.projectId,
        permissionMode: thread.projectId
          ? (permissionModes.get(thread.projectId) ?? null)
          : projectlessPermissionMode,
        dynamicToolCatalogs: [],
        writableRoots: [...(writableRootsByThread.get(threadId) ?? [])],
      };
    },
    replaceThreadDynamicToolCatalogs: async (
      _threadId: string,
      catalogs: Parameters<DesktopProjectWorkspacePort["replaceThreadDynamicToolCatalogs"]>[1],
    ) => catalogs,
    mergeThreadWritableRoots: async (threadId: string, roots: readonly string[]) => {
      const merged = [...new Set([...(writableRootsByThread.get(threadId) ?? []), ...roots])];
      writableRootsByThread.set(threadId, merged);
      return [...merged];
    },
    replaceThreadWritableRoots: async (threadId: string, roots: readonly string[]) => {
      writableRootsByThread.set(threadId, [...roots]);
      return [...roots];
    },
    listBackgroundProcesses: async (threadId?: string | null) =>
      [...backgroundProcesses.values()].filter(
        (process) => threadId === null || threadId === undefined || process.threadId === threadId,
      ),
    listManagedWorktreeWindow: async () => ({
      items: [],
      nextCursor: null,
      projectionRevision: 0,
    }),
    upsertBackgroundProcess: async (input: CodexBackgroundProcessRecord) => {
      backgroundProcesses.set(input.id, input);
      return input;
    },
    upsertProjectSessionThreadLink: async (
      input: Parameters<DesktopProjectWorkspacePort["upsertProjectSessionThreadLink"]>[0],
    ) => {
      const thread = await port.upsertThread(input.threadId, {
        projectId: input.projectId,
        forkedFromId: input.forkedFromId,
        parentThreadId: input.parentThreadId,
        threadSource: input.threadSource,
        serviceName: input.serviceName,
        agentNickname: input.agentNickname,
        agentRole: input.agentRole,
        agentPath: input.agentPath,
        threadName: input.threadName,
        threadPreview: input.threadPreview,
        modelProvider: input.modelProvider,
        executionHostId: input.executionHostId,
        cwd: input.cwd,
        managedWorktreePath: input.managedWorktreePath,
        projectlessOutputDirectory: input.projectlessOutputDirectory,
        projectlessWorkspaceBrowserRoot: input.projectlessWorkspaceBrowserRoot,
        status: input.statusType
          ? { statusType: input.statusType, activeFlags: input.statusActiveFlags ?? [] }
          : undefined,
        archived: input.archived,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        recencyAt: input.recencyAt,
      });
      return {
        sessionId: input.sessionId,
        projectId: thread.projectId,
        threadId: thread.threadId,
        forkedFromId: thread.forkedFromId,
        parentThreadId: thread.parentThreadId ?? undefined,
        threadName: thread.threadName ?? undefined,
        threadPreview: thread.threadPreview,
        modelProvider: thread.modelProvider,
        executionHostId: thread.executionHostId,
        cwd: thread.cwd ?? undefined,
        managedWorktreePath: thread.managedWorktreePath,
        projectlessOutputDirectory: thread.projectlessOutputDirectory,
        projectlessWorkspaceBrowserRoot: thread.projectlessWorkspaceBrowserRoot,
        statusType: thread.statusType,
        statusActiveFlags: [...thread.statusActiveFlags],
        archived: thread.archived,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        recencyAt: thread.recencyAt,
        linkedAt: thread.linkedAt,
      };
    },
    readSidebar: async () => readSidebar(),
    setThreadPinned: async (threadId: string, pinned: boolean) => {
      const current = threads.get(threadId);
      if (current) {
        threads.set(
          threadId,
          makeDesktopWorkspaceThread({
            ...current,
            pinnedOrder: pinned ? 0 : null,
          }),
        );
      }
      return readSidebar();
    },
    reorderPinnedThreads: async () => readSidebar(),
  };

  return port as unknown as DesktopProjectWorkspacePort;
};

afterAll(async () => {
  await Promise.all([...PROJECT_RUNTIME_TEST_HARNESS_RELEASES.map((close) => close())]);
  if (PREVIOUS_TEST_NODEX_HOME === undefined) delete process.env.NODEX_HOME;
  else process.env.NODEX_HOME = PREVIOUS_TEST_NODEX_HOME;
  fs.rmSync(DEFAULT_TEST_LOCAL_STORE_ROOT, { recursive: true, force: true });
  fs.rmSync(DEFAULT_TEST_THREAD_GOAL_ATTACHMENTS_ROOT, { recursive: true, force: true });
});

const permissionStateByTestService = new WeakMap<
  object,
  Map<string | null, CodexPermissionState>
>();

function readTestServerRequests(
  record: object,
): readonly CodexCanonicalConversationState["requests"][number][] {
  const authority = conversationAggregateByTestRecord.get(record);
  if (!authority) throw new Error("Test conversation record has no canonical aggregate authority");
  return authority.readServerRequests();
}

function readTestCanonicalState(record: object): CodexCanonicalConversationState | null {
  const authority = conversationAggregateByTestRecord.get(record);
  if (!authority) return null;
  return authority.readCanonicalState();
}

function acceptTestCanonicalState(record: object, state: CodexCanonicalConversationState): void {
  const authority = conversationAggregateByTestRecord.get(record);
  if (!authority) throw new Error("Test conversation record has no canonical aggregate authority");
  authority.acceptCanonicalState(state);
}

function replaceTestServerRequests(
  record: object,
  requests: CodexCanonicalConversationState["requests"],
): void {
  const authority = conversationAggregateByTestRecord.get(record);
  if (!authority) throw new Error("Test conversation record has no canonical aggregate authority");
  authority.replaceServerRequests(requests);
}

function createService(options?: {
  runtimeStateHome?: string;
  inactiveRendererOwnerRetentionMs?: number;
  inactiveRendererOwnerMaxRetained?: number;
  inactiveRendererOwnerRetryMs?: number;
  supportsChatGptApps?: boolean;
  gitSettingsResolver?: () => CodexGitSettings;
  projectAwareDeveloperInstructionsResolver?: (input: {
    baseInstructions?: string | null;
    cwd: string;
    model?: string | null;
    threadId: string | null;
    threadToolsEnabled?: boolean;
  }) => Promise<string>;
  threadCodexConfigBuilder?: (
    cwd: string | null,
  ) => Promise<Record<string, boolean | string | number | null> | null>;
  projectlessHomeDirectory?: () => string;
  resolveThreadGoalAttachmentsRoot?: () => Promise<string> | string;
  browserTransferStateReader?: {
    getStateSnapshot(): BrowserSidebarStateSnapshot;
    getBrowserUseStateSnapshot(): BrowserSidebarBrowserUseStateSnapshot;
  };
  forkSidePanelTransferLifecycle?: CodexForkSidePanelTransferRuntimePromiseAdapter;
  automationModule?: DesktopAutomationModulePort;
  projectWorkspace?: DesktopProjectWorkspacePort;
  userInputAutoResolutionTimer?: {
    now?: () => number;
    setTimeout?: (callback: () => void, timeoutMs: number) => unknown;
    clearTimeout?: (timer: unknown) => void;
  };
  databaseNotifier?: TestDatabaseInvalidationSource;
}): TestableCodexService {
  const conversationAggregates = makeCodexConversationAggregateRegistry();
  const conversationRuntimes = ConversationRuntimeMap.of({
    conversation: conversationAggregates.acquire,
    currentConversation: conversationAggregates.current,
    requests: Stream.empty,
    runtime: () => Effect.die(new Error("Conversation runtime is unavailable in this fixture")),
    runExclusive: (_threadId, operation) => operation,
    close: () => Effect.void,
  });
  const applicationEventEmitter = new EventEmitter();
  const applicationEvents: CodexApplicationEventPublisher = {
    publish: (event: CodexApplicationEvent) => {
      applicationEventEmitter.emit(event.kind === "codex" ? "event" : event.kind, event.value);
    },
  };
  const permissionStateByScope = new Map<string | null, CodexPermissionState>();
  const defaultPermissionState = (
    workspaceRoots: readonly string[] = [],
  ): CodexPermissionState => ({
    mode: "auto",
    effectivePreset: "auto",
    availableModes: ["auto", "full-access", "custom"],
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
    sandbox:
      workspaceRoots.length === 0
        ? null
        : {
            type: "workspaceWrite",
            writableRoots: [...workspaceRoots],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
    autoReviewAvailable: true,
    configTarget: { source: "none", filePath: null },
    customDescription: null,
  });
  const runtimeStateHome =
    options?.runtimeStateHome ?? path.join(DEFAULT_TEST_LOCAL_STORE_ROOT, "agent");
  const localHost = {
    descriptor: {
      hostId: "local",
      displayName: "This Mac",
      kind: "local" as const,
      nodexHome: DEFAULT_TEST_LOCAL_STORE_ROOT,
      codexHome: runtimeStateHome,
      managedRoot: path.join(DEFAULT_TEST_LOCAL_STORE_ROOT, "worktrees"),
      handoffStagingRoot: path.join(runtimeStateHome, "handoffs"),
      repositoryRoots: [] as readonly string[],
      capabilities: [] as const,
      supportsFileTransfer: false,
    },
    knownManagedRoots: [] as readonly string[],
    transfer: null,
    resolveManagedRoot: () => Effect.die("Managed worktrees are not available in this fixture"),
    request: () => Effect.die("Worktree workers are not available in this fixture"),
  };
  const executionHosts = {
    activeSshHosts: null as never,
    hosts: () => Effect.succeed([localHost.descriptor]),
    get: (hostId: string) => Effect.succeed(hostId === "local" ? localHost : null),
    resolve: () => Effect.succeed(localHost),
    updateLocalManagedRoot: () => Effect.void,
    settings: Effect.die("Execution host settings are not available in this fixture"),
    updateSettings: () => Effect.die("Execution host settings are not available in this fixture"),
    reconcile: () => Effect.void,
  } satisfies ExecutionHostRuntime["Service"];
  const managedWorktrees = {
    remove: () =>
      Effect.succeed({ removed: true, alreadyMissing: false, snapshot: null, warnings: [] }),
    inspect: () => Effect.die("Managed worktree inspection is not available in this fixture"),
    list: () => Effect.succeed({ entries: [] }),
    restore: () => Effect.die("Managed worktree restore is not available in this fixture"),
    setOwner: () => Effect.void,
    registerNewborn: () => Effect.void,
    releaseNewborn: () => Effect.void,
    isNewborn: () => Effect.succeed(false),
    newborns: Effect.succeed([]),
  } satisfies ManagedWorktreeRuntime["Service"];
  const projectRuntimeLifecycleHarness = makeProjectRuntimeLifecycleTestHarness();
  PROJECT_RUNTIME_TEST_HARNESS_RELEASES.push(projectRuntimeLifecycleHarness.close);
  const threadHandoffRuntime = {
    start: () => Effect.die("Task handoff is not available in this fixture"),
    recover: () => Effect.succeed([]),
    launch: () => Effect.die("Task handoff is not available in this fixture"),
    get: () => Effect.succeed(null),
    waitForRevision: () => Effect.succeed(null),
  } satisfies CodexThreadHandoffRuntime["Service"];
  const configuredAttachmentsRoot =
    options?.resolveThreadGoalAttachmentsRoot?.() ?? DEFAULT_TEST_THREAD_GOAL_ATTACHMENTS_ROOT;
  if (typeof configuredAttachmentsRoot !== "string") {
    throw new Error("The Codex service fixture requires a synchronous attachment root");
  }
  const pastedTextAttachments = new PastedTextAttachmentManager({
    attachmentsRoot: configuredAttachmentsRoot,
  });
  const goalAttachments = new ThreadGoalAttachmentDirectoryManager({
    attachmentsRoot: configuredAttachmentsRoot,
  });
  void pastedTextAttachments.cleanupPendingRemovals().catch(() => undefined);
  type PendingTestResponse = {
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason?: unknown) => void;
  };
  type QueuedTestCompletion =
    | { readonly kind: "success"; readonly value: unknown }
    | { readonly kind: "failure"; readonly reason: unknown };
  let nextResponseToken = 1;
  const responseKey = (threadId: string, occurrenceToken: number) =>
    `${threadId}\0${occurrenceToken}`;
  const responseWaiters = new Map<string, PendingTestResponse[]>();
  const queuedCompletions = new Map<string, QueuedTestCompletion[]>();
  const completeResponse = (
    threadId: string,
    occurrenceToken: number,
    completion: QueuedTestCompletion,
  ): boolean => {
    const key = responseKey(threadId, occurrenceToken);
    const waiters = responseWaiters.get(key);
    const waiter = waiters?.shift();
    if (waiters?.length === 0) responseWaiters.delete(key);
    if (!waiter) {
      queuedCompletions.set(key, [...(queuedCompletions.get(key) ?? []), completion]);
      return true;
    }
    if (completion.kind === "success") waiter.resolve(completion.value);
    else waiter.reject(completion.reason);
    return true;
  };
  let service: CodexService | undefined;
  const rendererConversations = makeCodexRendererConversationRegistryState();
  const autoResolution = new TestCodexUserInputAutoResolutionController({
    ...options?.userInputAutoResolutionTimer,
    isConversationPresented: (conversationId) =>
      rendererConversations.isPresentedInForeground(conversationId),
    onChange: (change) => applicationEventEmitter.emit("userInputAutoResolutionChanged", change),
    onResolve: () => undefined,
  });
  const activeGoalContinuation = new TestCodexActiveGoalContinuation({
    delayMs: 250,
    isEligible: (conversationId) =>
      service?.isActiveThreadGoalContinuationCandidate(conversationId) === true,
    continueGoal: async (conversationId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.runActiveThreadGoalContinuation(conversationId);
    },
  });
  const ownerNotificationDrain = new TestCodexOwnerNotificationDrainRuntime(
    DEFAULT_CODEX_OWNER_NOTIFICATION_DRAIN_TIMEOUT,
  );
  const databaseNotifier = options?.databaseNotifier ?? new TestDatabaseInvalidationSource();
  const sidebarSync = new TestCodexSidebarSyncRuntime({
    refresh: async (input) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.refreshSidebarThreadsForSync(input);
    },
    buildSnapshot: async (includeArchived, revision) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.buildBoundedWorkspaceSidebarSnapshot(includeArchived, revision);
    },
    emit: (result, reason) => service?.emitSidebarSyncUpdated(result, reason),
    invalidations: databaseNotifier,
  });
  const sidebarSweep = makeCodexSidebarSweepTestAdapter();
  const projectWorkspace = options?.projectWorkspace ?? createTestProjectWorkspace();
  const emitRendererOwnerMessage = (conversationId: string, message: CodexHostMessage): boolean => {
    const targetClientId = rendererConversations.getOwnerClientId(conversationId);
    if (!targetClientId) return false;
    applicationEvents.publish({
      kind: "rendererOwnerHostMessage",
      value: { targetClientId, message },
    });
    return true;
  };
  const rendererConversationCoordinator = {
    forwardNotification: (notification: CodexServerNotification) => {
      if (!isCodexThreadOwnerNotification(notification)) return false;
      return emitRendererOwnerMessage(getCodexThreadOwnerNotificationThreadId(notification), {
        type: "threadOwnerNotification",
        hostId: DEFAULT_CODEX_HOST_ID,
        sequence: ownerNotificationDrain.next(
          getCodexThreadOwnerNotificationThreadId(notification),
        ),
        notification,
      });
    },
    forwardNotificationForConversation: (
      conversationId: string,
      notification: CodexServerNotification,
    ) =>
      isCodexThreadOwnerNotification(notification) &&
      emitRendererOwnerMessage(conversationId, {
        type: "threadOwnerNotification",
        hostId: DEFAULT_CODEX_HOST_ID,
        sequence: ownerNotificationDrain.next(conversationId),
        notification,
      }),
    forwardServerRequest: (request: CodexThreadOwnerServerRequest) =>
      emitRendererOwnerMessage(request.params.threadId, {
        type: "threadOwnerRequest",
        hostId: DEFAULT_CODEX_HOST_ID,
        sequence: ownerNotificationDrain.next(request.params.threadId),
        request,
      }),
    clearRequestDelivery: (conversationId: string, requestId: string | number) =>
      rendererConversations.clearRequestDelivery(conversationId, requestId),
    reconcileOwnership: () => undefined,
  } as unknown as CodexRendererConversationCoordinatorService;
  const threadCatalog = {
    listPinned: async (): Promise<readonly string[]> => {
      const threadIds: string[] = [];
      let after: string | null = null;
      do {
        const window = await projectWorkspace.readSidebarOverview(false, { after, first: 200 });
        threadIds.push(
          ...window.items.flatMap((session) => (session.thread ? [session.thread.threadId] : [])),
        );
        after = window.nextCursor;
      } while (after !== null);
      return threadIds;
    },
    listProject: async () => ({
      items: [],
      nextCursor: null,
      hasMore: false,
      projectionRevision: 0,
    }),
    listPalette: async (): Promise<readonly CommandPaletteThreadSummary[]> => [],
    setPinned: async (threadId: string, pinned: boolean, beforeThreadId?: string | null) => {
      await projectWorkspace.setThreadPinned(threadId, pinned, beforeThreadId);
      return {
        items: [],
        pinnedThreadIds: [],
        projectAssignments: {},
        projectlessThreadIds: [],
        generatedAt: 1,
      };
    },
    reorderPinned: async (orderedThreadIds: readonly string[]) => {
      await projectWorkspace.reorderPinnedThreads(orderedThreadIds);
      return {
        items: [],
        pinnedThreadIds: [...orderedThreadIds],
        projectAssignments: {},
        projectlessThreadIds: [],
        generatedAt: 1,
      };
    },
    move: async (
      input: import("../../shared/codex-sidebar-thread-move").CodexSidebarThreadMoveInput,
    ) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.applySidebarThreadMove(input);
    },
  };
  const pendingWorktrees = new CodexPendingWorktreeRuntime({
    createWorktree: async (entry, context) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.createPendingManagedWorktree(entry, context);
    },
    launchConversation: async (entry, workspaceRoot, context) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.launchPendingWorktreeConversation(entry, workspaceRoot, context);
    },
    removeWorktree: async () => undefined,
    cleanupGoalSources: async (entry) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.cleanupPendingGoalSources(entry);
    },
    registerStableProject: async (workspaceRoots, label) => {
      await projectWorkspace.createProject({ name: label, sources: [...workspaceRoots] });
    },
    onChanged: (entries) => service?.projectPendingWorktreeSnapshot(entries),
  });
  const threadSettingsRuntime = new TestCodexThreadSettingsRuntime();
  const conversationCommands = {
    archive: (threadId: string) =>
      Effect.tryPromise(async () => {
        if (!service) throw new Error("Codex test service is not constructed");
        const client = Reflect.get(service, "client") as {
          request: (method: string, params: unknown) => Promise<unknown>;
        };
        await client.request("thread/archive", { threadId });
        return await service.applyThreadArchiveProjection(threadId);
      }),
    unarchive: (threadId: string) =>
      Effect.tryPromise(async () => {
        if (!service) throw new Error("Codex test service is not constructed");
        const client = Reflect.get(service, "client") as {
          request: (method: string, params: unknown) => Promise<unknown>;
        };
        await client.request("thread/unarchive", { threadId });
        return await service.applyThreadUnarchiveProjection(threadId);
      }),
    interrupt: () => Effect.die("Interrupt semantics are exercised by ConversationCommands"),
  } as unknown as ConversationCommands["Service"];
  const threadTitlePersistence = new TestCodexThreadTitlePersistence({
    project: ({ threadId, name, syncDormantConversationUpdates }) => {
      if (!service) throw new Error("Codex test service is not constructed");
      service.applyThreadNameLocal(threadId, name, { syncDormantConversationUpdates });
    },
    setRemote: async ({ threadId, name }) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const client = Reflect.get(service, "client") as {
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      await client.request("thread/name/set", { threadId, name });
    },
    persistWorkspace: async ({ threadId, name }) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.persistThreadTitleInProjectWorkspace(threadId, name);
    },
  });
  const backgroundSubagentMetadataRepair = new TestCodexBackgroundSubagentMetadataRepair({
    isRepairNeeded: (parentThreadId, childThreadId) =>
      service?.isBackgroundSubagentMetadataRepairNeeded(parentThreadId, childThreadId) === true,
    repair: async (parentThreadId, childThreadId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.repairBackgroundSubagentMetadata(parentThreadId, childThreadId);
    },
  });
  const knownSubagentThreadIds = new Set<string>();
  const fullFidelitySubagentThreadIds = new Set<string>();
  const subagentCatalog = CodexSubagentCatalog.of({
    hydrateBackground: () => Effect.die("unused"),
    hydratePanel: () => Effect.die("unused"),
    open: (threadId) =>
      Effect.sync(() => {
        const normalized = threadId.trim();
        if (!normalized) return false;
        knownSubagentThreadIds.add(normalized);
        fullFidelitySubagentThreadIds.add(normalized);
        return true;
      }),
    observe: (threadId) => {
      const normalized = threadId.trim();
      if (normalized) knownSubagentThreadIds.add(normalized);
    },
    shouldDropDelta: (method, threadId) => {
      const normalized = threadId?.trim() ?? "";
      return (
        normalized.length > 0 &&
        [
          "item/agentMessage/delta",
          "item/plan/delta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/textDelta",
          "item/commandExecution/outputDelta",
        ].includes(method) &&
        knownSubagentThreadIds.has(normalized) &&
        !fullFidelitySubagentThreadIds.has(normalized)
      );
    },
    clear: (threadId) => {
      knownSubagentThreadIds.delete(threadId);
      fullFidelitySubagentThreadIds.delete(threadId);
    },
  });
  const queuedFollowUps = CodexQueuedFollowUps.of({
    list: () => [],
    enqueue: () => Effect.succeed("test-follow-up"),
    remove: () => Effect.succeed(false),
    reorder: () => Effect.void,
    clearPaused: () => Effect.succeed(false),
    reset: () => Effect.void,
    clear: () => Effect.void,
    requestDispatch: () => Effect.void,
    takeDispatchIntent: Effect.never,
    claim: () => Effect.succeed(null),
    restore: () => Effect.succeed(false),
  });
  const queuedFollowUpDispatcher: CodexQueuedFollowUpDispatcher["Service"] = {
    sendNow: () => Effect.die("unused"),
    cancel: () => Effect.void,
  };
  const conversationDeltaBuffer = CodexConversationDeltaBufferRuntime.of({
    enqueueFrameText: (update) => {
      const aggregate = conversationRuntimes.conversation(update.conversationId);
      aggregate.bufferFrameTextDelta(update);
      aggregate.commitFrameTextDeltas({
        updates: aggregate.takeBufferedFrameTextDeltas(),
        observedAtMs: Date.now(),
        projectReplica: !rendererConversations.hasOwner(update.conversationId),
      });
    },
    enqueueCommandOutput: (update) => {
      const aggregate = conversationRuntimes.conversation(update.conversationId);
      aggregate.bufferCommandOutputDelta(update, 100_000);
      aggregate.commitCommandOutputDeltas({
        updates: aggregate.takeBufferedCommandOutputDeltas(),
        observedAtMs: Date.now(),
        projectReplica: !rendererConversations.hasOwner(update.conversationId),
      });
    },
    drainFrameText: () => undefined,
    clear: (conversationId) => {
      conversationRuntimes.currentConversation(conversationId)?.clearBufferedDeltas();
    },
  });
  const adoptRendererConversation = (input: {
    readonly threadId: string;
    readonly ownerClientId: string;
    readonly conversation: CodexConversationSnapshot;
  }) => {
    const owner = rendererConversations.setOwner(input.threadId, input.ownerClientId);
    if (!owner) throw new Error(`Renderer '${input.ownerClientId}' cannot own '${input.threadId}'`);
    const aggregate = conversationAggregates.acquire(input.threadId);
    aggregate.setStreamRole("owner");
    const before = aggregate.read();
    if (!before.acceptedReplica) {
      aggregate.acceptReplica({
        conversation: input.conversation,
        revision: before.revision,
        ownerEpoch: owner.ownerEpoch,
      });
    }
    const after = aggregate.read();
    return {
      checkpoint: after.acceptedReplica?.checkpoint ?? null,
      ownerClientId: rendererConversations.getOwnerClientId(input.threadId),
      revision: after.revision,
    };
  };
  const conversationResume = new TestCodexConversationResumeRuntime({
    run: async (input) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.runConversationResume(input);
    },
    snapshot: async (threadId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const snapshot = service.serializeConversationSnapshot(threadId);
      if (snapshot) {
        (
          service as unknown as {
            syncDormantConversationFromRecord: (threadId: string, reason: string) => void;
          }
        ).syncDormantConversationFromRecord(threadId, "explicit-resync");
      }
      return snapshot;
    },
    readRendererState: (threadId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const state = conversationAggregates.current(threadId)?.read();
      return {
        acceptedConversation: state?.acceptedReplica?.conversation ?? null,
        checkpoint: state?.acceptedReplica?.checkpoint ?? null,
        freshLaunchOwnerClientId: null,
        ownerClientId: rendererConversations.getOwnerClientId(threadId),
        resumeState: state?.acceptedReplica?.conversation.resumeState ?? null,
        revision: state?.revision ?? 0,
        serializedConversation: service.serializeConversationSnapshot(threadId),
      };
    },
    isRendererClientDisposed: rendererConversations.isClientDisposed,
    adoptRenderer: adoptRendererConversation,
    releaseBuffer: async (threadId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.releaseConversationResumeBufferForModule(threadId);
    },
  });
  const conversationEventBuffer = new TestCodexConversationEventBufferRuntime({
    compact: (threadId, events) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return service.compactBufferedConversationEvents(threadId, events);
    },
    replayNotification: async (input) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.replayBufferedConversationNotification(input);
    },
    replayRequest: async (input) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.replayBufferedConversationRequest(input);
    },
    reportThreadStartReplayFailure: (input) => service?.recordThreadStartReplayFailure(input),
  });
  const turnCommands: CodexTurnCommandsService = {
    start: () => Effect.die("Turn commands are exercised by final semantic service tests"),
    startRendererOwned: () =>
      Effect.die("Renderer-owned Turn commands are unavailable in the CodexService fixture"),
    acceptPreparedRendererTurn: (plan) =>
      Effect.promise(async () => {
        if (!service) throw new Error("Codex test service is not constructed");
        const client = Reflect.get(service as object, "client") as {
          request: (method: string, params: unknown) => Promise<TurnStartResponse>;
        };
        return await client.request("turn/start", plan.request);
      }),
    steer: () => Effect.die("Turn commands are exercised by final semantic service tests"),
    steerRendererOwned: () =>
      Effect.die("Renderer-owned Turn commands are unavailable in the CodexService fixture"),
  };
  const threadGoals: CodexThreadGoalRuntimePromiseAdapter = {
    set: async (input) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const action = normalizeCodexThreadGoalSetAction(input);
      if (action.threadSettings) {
        await threadSettingsRuntime.update({
          threadId: action.threadId,
          patch: action.threadSettings,
        });
      }
      const params: ThreadGoalSetParams = { threadId: action.threadId };
      if (Object.prototype.hasOwnProperty.call(action, "objective")) {
        params.objective = action.objective;
      }
      if (Object.prototype.hasOwnProperty.call(action, "status")) params.status = action.status;
      if (Object.prototype.hasOwnProperty.call(action, "tokenBudget")) {
        params.tokenBudget = action.tokenBudget;
      }
      const client = Reflect.get(service as object, "client") as {
        request: (method: string, params: unknown) => Promise<{ goal?: ThreadGoal | null }>;
      };
      const goal = (await client.request("thread/goal/set", params)).goal ?? null;
      if (goal) {
        service.threadGoalProjection.applySet({
          threadId: action.threadId,
          goal,
          appendTranscriptItem: action.appendTranscriptItem !== false,
          dismissResumeConfirmation: action.dismissResumeConfirmation === true,
          objective: typeof action.objective === "string" ? action.objective : null,
        });
      }
      return goal;
    },
    clear: async (threadId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const client = Reflect.get(service as object, "client") as {
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      await client.request("thread/goal/clear", { threadId });
    },
  };
  const postResumeGoals = new TestCodexPostResumeGoalRuntime({
    load: async (threadId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const client = Reflect.get(service as object, "client") as {
        request: (method: string, params: unknown) => Promise<{ goal?: ThreadGoal | null }>;
      };
      try {
        return {
          ok: true,
          goal: (await client.request("thread/goal/get", { threadId })).goal ?? null,
        };
      } catch {
        return { ok: false, goal: null };
      }
    },
    commit: (threadId, expectedRevision, goal) =>
      service?.commitThreadGoalHydratedAfterResume(threadId, expectedRevision, goal) ?? false,
    requestContinuation: (threadId) => service?.requestActiveGoalContinuationAfterResume(threadId),
  });
  const pendingServerRequests = new TestCodexPendingServerRequestRuntime({
    respond: (threadId, _requestId, occurrenceToken, response) => {
      completeResponse(threadId, occurrenceToken, { kind: "success", value: response });
    },
    reject: (threadId, _requestId, occurrenceToken, reason) => {
      completeResponse(threadId, occurrenceToken, { kind: "failure", reason });
    },
  });
  const testClient = new TestCodexGatewayPromiseClient();
  const testService = new CodexService({
    conversationRuntimes,
    applicationEvents,
    foldSidebarPathCase: false,
    agentProviderRuntime: {
      list: async () => ({ providers: [] }),
      resolveExecutionProfile: async (requested) => requested,
      ensureRuntimeReady: async () => undefined,
    },
    composerCatalog: {
      listModels: async () => [],
      listPlugins: async () => [],
      activatePlugin: async () => undefined,
      listSkills: async () => [],
    },
    desktopTools: {
      ensureReady: async () => ({
        browserPluginReady: false,
        computerUsePluginReady: false,
        plugins: {
          message: "Browser plugin reconciliation is disabled in this fixture",
          reason: "runtime-unavailable",
          status: "unavailable",
        },
        computerUse: {
          message: "Computer Use is unavailable in this fixture",
          reason: "runtime-unavailable",
          status: "unavailable",
        },
      }),
      promoteBrowserUseRoute: async () => undefined,
      releaseBrowserUseSession: async () => undefined,
      threadConfig: async () => null,
      turnEnded: async () => undefined,
      turnStarted: async () => undefined,
    },
    preferences: { current: () => "friendly" },
    permissions: {
      snapshot: async (projectId) =>
        permissionStateByScope.get(projectId) ?? defaultPermissionState(),
      resolve: async (input) => {
        const current =
          permissionStateByScope.get(input.projectId) ??
          defaultPermissionState(input.workspaceRoots);
        const state =
          input.requestedMode === "full-access" && current.availableModes.includes("full-access")
            ? {
                ...current,
                mode: "full-access" as const,
                effectivePreset: "full-access" as const,
                approvalPolicy: "never" as const,
                sandboxMode: "danger-full-access" as const,
                sandbox: { type: "dangerFullAccess" as const },
              }
            : input.requestedMode === "custom" && current.availableModes.includes("custom")
              ? {
                  ...current,
                  mode: "custom" as const,
                  effectivePreset: "custom" as const,
                  approvalPolicy: null,
                  sandboxMode: null,
                  sandbox: null,
                }
              : current;
        return { state, verifiedBuiltinFullAccess: false };
      },
      resolveAutomation: async (workspaceRoots) => defaultPermissionState(workspaceRoots),
    },
    attachments: { pastedText: pastedTextAttachments, goals: goalAttachments },
    pendingServerRequests,
    controlPlane: {
      fork: Effect.runFork,
      runPromise: Effect.runPromise,
    },
    turnCommands,
    userInputAutoResolution: {
      observeRequest: (conversationId, requestId) =>
        autoResolution.observeRequest(conversationId, requestId),
      observeResponse: (conversationId, requestId) =>
        autoResolution.observeResponse(conversationId, requestId),
      observeServerResolution: (conversationId, requestId) =>
        autoResolution.observeServerResolution(conversationId, requestId),
      reevaluatePresentation: (conversationId) =>
        autoResolution.reevaluatePresentation(conversationId),
      clearConversation: (conversationId) => autoResolution.clearConversation(conversationId),
      reconcilePendingRequests: (conversationId, requestIds) =>
        autoResolution.reconcilePendingRequests(conversationId, requestIds),
      handleDisconnect: () => autoResolution.handleDisconnect(),
    },
    activeGoalContinuation,
    ownerNotificationDrain,
    rendererConversations,
    rendererConversationCoordinator,
    sidebarSync,
    sidebarSweep,
    gitProbe: {
      readPath: async (cwd, args) => {
        if (!cwd.trim()) return null;
        try {
          return (
            (
              await runCodexGitCommand(args, cwd.trim(), {
                timeoutMs: 8_000,
                maxOutputBytes: 256 * 1_024,
              })
            ).stdout.trim() || null
          );
        } catch {
          return null;
        }
      },
      isNonGitWorkspace: async (cwd) => {
        if (!cwd.trim()) return false;
        try {
          await runCodexGitCommand(["rev-parse", "--show-toplevel"], cwd.trim(), {
            timeoutMs: 8_000,
            maxOutputBytes: 256 * 1_024,
          });
          return false;
        } catch (error) {
          return String(error).toLowerCase().includes("not a git repository");
        }
      },
    },
    externalAgentImport: {
      run: async () => ({ importId: "test-import", itemTypeResults: [] }),
    },
    heartbeatTurnCompletion: {
      startAndWait: async (params) => {
        if (!service) throw new Error("Codex test service is not constructed");
        const client = Reflect.get(service, "client") as {
          request: <TResult>(method: string, params: unknown) => Promise<TResult>;
        };
        return await client.request("turn/start", params);
      },
    },
    structuredThreadTitle: {
      generate: async () => null,
    },
    dynamicToolsLaunch: {
      load: (operation) => operation(),
    },
    threadHandoffRuntime,
    pendingWorktrees,
    threadSettingsRuntime,
    threadTitlePersistence,
    threadCatalog,
    conversationCommands,
    postResumeGoals,
    backgroundSubagentMetadataRepair,
    subagentCatalog,
    queuedFollowUps,
    queuedFollowUpDispatcher,
    conversationDeltaBuffer,
    conversationResume,
    conversationEventBuffer,
    manualCompaction: {
      start: async () => {
        throw new Error("Manual compaction is unavailable in the legacy CodexService fixture");
      },
      consumeSource: () => "automatic",
      clear: () => undefined,
    },
    threadGoals,
    persistedAtoms: new PersistedAtomStore(
      path.join(runtimeStateHome, "persisted-atoms-test.json"),
    ),
    sessionStore: new CodexSessionStore(),
    client: testClient,
    runtime: TEST_CODEX_RUNTIME,
    runtimeStateHome,
    nodexAgentDynamicTools: {
      execute: () =>
        Effect.succeed({
          contentItems: [{ type: "inputText", text: "Nodex Agent tools are unavailable" }],
          success: false,
        }),
    },
    nodexAgentAuthority: TEST_NODEX_AGENT_AUTHORITY,
    nodexAgentResourceAuthority: TEST_NODEX_AGENT_RESOURCE_AUTHORITY,
    nodexAgentAuthorization: {
      authorize: async () => "unavailable",
      extendTaskAccess: async () => undefined,
      getTaskAccess: async () => undefined,
      revokeRoot: async () => undefined,
    },
    automationModule: options?.automationModule ?? createTestAutomationModule(),
    automationRouting: {
      activeHeartbeatAutomationId: () => null,
      runAutomationId: () => null,
    },
    projectWorkspace,
    executionHosts,
    managedWorktrees,
    managedWorktreeRetention: {
      request: Effect.void,
      run: Effect.die("Managed worktree retention is not available in this fixture"),
    } satisfies ManagedWorktreeRetentionRuntime["Service"],
    supportsChatGptApps: options?.supportsChatGptApps,
    projectAwareDeveloperInstructionsResolver: options?.projectAwareDeveloperInstructionsResolver,
    gitSettingsResolver: options?.gitSettingsResolver,
    threadCodexConfigBuilder: options?.threadCodexConfigBuilder,
    projectlessHomeDirectory:
      options?.projectlessHomeDirectory ?? (() => DEFAULT_TEST_LOCAL_STORE_ROOT),
    browserTransferStateReader:
      options?.browserTransferStateReader ?? EMPTY_TEST_BROWSER_TRANSFER_STATE_READER,
    forkSidePanelTransferLifecycle: options?.forkSidePanelTransferLifecycle,
  }) as unknown as TestableCodexService;
  testService.on = applicationEventEmitter.on.bind(applicationEventEmitter);
  testService.addThreadNotificationListener = (listener) => {
    applicationEventEmitter.on("threadNotification", listener);
    return () => applicationEventEmitter.off("threadNotification", listener);
  };
  service = testService as unknown as CodexService;
  const serviceRecordAccess = testService as unknown as {
    getMaybeConversationRecord: (threadId: string) => object | null;
    ensureConversationRecord: (threadId: string) => object;
    getConversationRecord: (threadId: string) => object;
  };
  const bindRecord = <T extends object | null>(threadId: string, record: T): T => {
    if (record) {
      conversationAggregateByTestRecord.set(record, conversationAggregates.acquire(threadId));
    }
    return record;
  };
  const originalGetMaybeConversationRecord =
    serviceRecordAccess.getMaybeConversationRecord.bind(testService);
  const originalEnsureConversationRecord =
    serviceRecordAccess.ensureConversationRecord.bind(testService);
  const originalGetConversationRecord = serviceRecordAccess.getConversationRecord.bind(testService);
  serviceRecordAccess.getMaybeConversationRecord = (threadId) =>
    bindRecord(threadId, originalGetMaybeConversationRecord(threadId));
  serviceRecordAccess.ensureConversationRecord = (threadId) =>
    bindRecord(threadId, originalEnsureConversationRecord(threadId));
  serviceRecordAccess.getConversationRecord = (threadId) =>
    bindRecord(threadId, originalGetConversationRecord(threadId));
  threadSettingsRuntime.setUpdateOperation(async (input, signal) => {
    const prepared = await testService.prepareThreadSettingsUpdate(input, signal);
    if (threadSettingsRuntime.remoteUpdateSupport() === "unsupported") {
      return prepared.nextSettings;
    }
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    try {
      await client.request("thread/settings/update", prepared.params);
      threadSettingsRuntime.recordRemoteUpdateSupported();
    } catch (error) {
      if (error instanceof CodexRpcError) {
        const message = error.message.toLowerCase();
        if (message.includes("thread") && message.includes("not found")) {
          return prepared.nextSettings;
        }
        if (
          error.code === -32601 ||
          message.includes("method not found") ||
          message.includes("unknown method") ||
          (message.includes("thread/settings/update") && message.includes("unsupported"))
        ) {
          threadSettingsRuntime.recordRemoteUpdateUnsupported();
          return prepared.nextSettings;
        }
      }
      throw error;
    }
    return prepared.nextSettings;
  });
  Reflect.set(testService, "getUserInputAutoResolutionSnapshot", () => autoResolution.snapshot());
  testService.shutdown = async () => {
    try {
      activeGoalContinuation.dispose();
      ownerNotificationDrain.dispose();
      sidebarSync.dispose();
      pendingWorktrees.shutdown();
      conversationResume.dispose();
      await conversationEventBuffer.shutdown(new Error("Codex test service is shutting down"));
      await sidebarSweep.cancel();
      await pendingServerRequests.shutdown(new Error("Codex test service is shutting down"));
    } finally {
      // The final Effect capabilities are process-scoped in production; this legacy test fixture
      // owns no additional worktree runtime to release.
    }
  };
  permissionStateByTestService.set(testService, permissionStateByScope);
  conversationAggregatesByTestService.set(testService, conversationRuntimes);
  const internals = testService as unknown as {
    getMaybeConversationRecord: (threadId: string) => {
      detail: CodexThreadDetail | null;
      latestThreadSettings: CodexConversationThreadSettings | null;
      latestTokenUsageInfo: CodexCanonicalConversationState["sidecar"]["latestTokenUsageInfo"];
      threadGoal: ThreadGoal | null;
      completedThreadGoal: ThreadGoal | null;
      threadGoalResumeConfirmation: ThreadGoal | null;
    } | null;
    setConversationRecordDetail: (detail: CodexThreadDetail) => void;
    handleNotification: (
      notification: CodexTestServerNotification,
      options?: unknown,
    ) => Promise<void>;
    handleServerRequest: (request: { method?: unknown; params?: unknown }) => Promise<unknown>;
    isConversationArchived: (threadId: string) => boolean;
    upsertPlanImplementationRequest: (
      threadId: string,
      turnId: string,
      planContent: string,
      itemCreatedAt: number,
    ) => CodexPlanImplementationServerRequest;
  };
  const syncCanonicalFixture = (threadId: string, force = false) => {
    const record = internals.getMaybeConversationRecord(threadId);
    const detail = record?.detail;
    if (!record || !detail) return;
    const aggregate = conversationAggregates.acquire(threadId);
    const existingCanonical = aggregate.readCanonicalState();
    const detailTurnIds = detail.turns.flatMap((turn) =>
      typeof turn.turnId === "string" ? [turn.turnId] : [],
    );
    const hasNullTurn = detail.turns.some(
      (turn) => (turn as { turnId: string | null }).turnId === null,
    );
    const detailRawItemIds = detail.transcript.flatMap((entry) =>
      isCodexCanonicalProtocolItem(entry.rawItem) ? [entry.rawItem.id] : [],
    );
    if (
      !force &&
      existingCanonical &&
      detailTurnIds.every((turnId) =>
        existingCanonical.turns.some((turn) => turn.protocol.id === turnId),
      ) &&
      (!hasNullTurn || existingCanonical.turns.some((turn) => turn.protocol.id === null)) &&
      detailRawItemIds.every((itemId) =>
        existingCanonical.turns.some((turn) => turn.items.some((item) => item.id === itemId)),
      )
    ) {
      return;
    }

    const turns = detail.turns.map((turn, turnIndex): Turn => {
      const nullableTurnId = (turn as { turnId: string | null }).turnId;
      const protocolTurnId = nullableTurnId ?? `fixture-null-turn-${turnIndex}`;
      const existing =
        nullableTurnId === null
          ? existingCanonical?.turns[turnIndex]
          : existingCanonical?.turns.find((candidate) => candidate.protocol.id === nullableTurnId);
      const transcriptItems = detail.transcript.flatMap((entry): ThreadItem[] => {
        if ((entry as { turnId: string | null }).turnId !== nullableTurnId) return [];
        const rawItem = entry.rawItem;
        return isCodexCanonicalProtocolItem(rawItem) ? [rawItem] : [];
      });
      const existingProtocolItems = existing?.items.filter(isCodexCanonicalProtocolItem) ?? [];
      const itemsById = new Map(
        [...existingProtocolItems, ...transcriptItems].map((item) => [item.id, item]),
      );
      const orderedItemIds = [
        ...turn.itemIds,
        ...existingProtocolItems.map((item) => item.id),
        ...transcriptItems.map((item) => item.id),
      ].filter((itemId, index, itemIds) => itemIds.indexOf(itemId) === index);
      return {
        id: protocolTurnId,
        items: orderedItemIds.flatMap((itemId) => {
          const item = itemsById.get(itemId);
          return item ? [item] : [];
        }),
        itemsView: "full",
        status: turn.status,
        error: turn.errorMessage
          ? { message: turn.errorMessage, codexErrorInfo: null, additionalDetails: null }
          : null,
        startedAt:
          turn.turnStartedAtMs == null ? (turn.startedAt ?? null) : turn.turnStartedAtMs / 1_000,
        completedAt: turn.completedAt == null ? null : turn.completedAt / 1_000,
        durationMs: turn.durationMs ?? null,
      };
    });
    const cwd = detail.cwd ?? "/workspace/project";
    const canonical = createCodexCanonicalHydratedConversationState(
      makeProtocolThread(threadId, cwd, turns),
      {
        model: "gpt-test-fixture",
        reasoningEffort: "high",
        cwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        activePermissionProfile: null,
        runtimeWorkspaceRoots: [cwd],
      },
    );
    aggregate.acceptCanonicalState({
      ...canonical,
      requests: [...aggregate.readServerRequests()],
      sidecar: {
        ...canonical.sidecar,
        hasUnreadTurn: aggregate.readHasUnreadTurn(),
        latestThreadSettings: existingCanonical?.sidecar.latestThreadSettings ?? null,
        latestTokenUsageInfo:
          record.latestTokenUsageInfo ?? existingCanonical?.sidecar.latestTokenUsageInfo ?? null,
        threadGoal: record.threadGoal,
        completedThreadGoal: record.completedThreadGoal,
        threadGoalResumeConfirmation: record.threadGoalResumeConfirmation,
      },
      turns: canonical.turns.map((canonicalTurn, turnIndex) => {
        const detailTurn = detail.turns[turnIndex];
        if (!detailTurn) return canonicalTurn;
        const nullableTurnId = (detailTurn as { turnId: string | null }).turnId;
        const existing =
          nullableTurnId === null
            ? existingCanonical?.turns[turnIndex]
            : existingCanonical?.turns.find(
                (candidate) => candidate.protocol.id === nullableTurnId,
              );
        return {
          ...canonicalTurn,
          protocol: {
            ...canonicalTurn.protocol,
            id: nullableTurnId,
          },
          sidecar: {
            ...canonicalTurn.sidecar,
            params: existing?.sidecar.params ?? canonicalTurn.sidecar.params,
            diff: detailTurn.diff ?? existing?.sidecar.diff ?? null,
            completedAtMs: detailTurn.completedAt ?? existing?.sidecar.completedAtMs ?? null,
            firstTurnWorkItemStartedAtMs: detailTurn.firstTurnWorkItemStartedAtMs ?? null,
            finalAssistantStartedAtMs: detailTurn.finalAssistantStartedAtMs ?? null,
            commandExecutionStartedAtMsById: detailTurn.commandExecutionStartedAtMsById,
            interruptedCommandExecutionItemIds:
              detailTurn.interruptedCommandExecutionItemIds ??
              existing?.sidecar.interruptedCommandExecutionItemIds,
            hookRuns: detailTurn.hookRuns ?? existing?.sidecar.hookRuns,
            safetyBuffering: detailTurn.safetyBuffering ?? existing?.sidecar.safetyBuffering,
          },
        };
      }),
    });
  };
  const handleNotification = internals.handleNotification.bind(service);
  internals.handleNotification = async (notification, handleOptions) => {
    const { method, params } = notification;
    const requiresFullCanonicalSync =
      method === "item/started" ||
      method === "item/completed" ||
      method === "item/agentMessage/delta" ||
      method === "item/plan/delta" ||
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/textDelta" ||
      method === "item/commandExecution/outputDelta" ||
      method === "item/commandExecution/terminalInteraction" ||
      method === "item/fileChange/patchUpdated" ||
      method === "item/mcpToolCall/progress";
    const isTurnMetadata =
      method === "turn/started" ||
      method === "turn/completed" ||
      method === "turn/diff/updated" ||
      method === "turn/plan/updated" ||
      method === "model/safetyBuffering/updated" ||
      method === "hook/started" ||
      method === "hook/completed" ||
      method === "model/rerouted" ||
      method === "item/autoApprovalReview/started" ||
      method === "item/autoApprovalReview/completed" ||
      method === "guardianWarning" ||
      method === "error";
    const isThreadMetadata =
      method === "thread/started" ||
      method === "thread/name/updated" ||
      method === "thread/settings/updated" ||
      method === "thread/status/changed" ||
      method === "thread/goal/updated" ||
      method === "thread/goal/cleared" ||
      method === "thread/tokenUsage/updated";
    if (requiresFullCanonicalSync || isTurnMetadata || isThreadMetadata) {
      const threadId =
        typeof params === "object" && params !== null
          ? (params as { threadId?: unknown }).threadId
          : null;
      if (typeof threadId === "string") {
        const paramsRecord =
          typeof params === "object" && params !== null
            ? (params as { turnId?: unknown; turn?: unknown })
            : null;
        const turnRecord =
          typeof paramsRecord?.turn === "object" && paramsRecord.turn !== null
            ? (paramsRecord.turn as { id?: unknown })
            : null;
        const turnId =
          typeof paramsRecord?.turnId === "string"
            ? paramsRecord.turnId
            : typeof turnRecord?.id === "string"
              ? turnRecord.id
              : null;
        const canonical = conversationAggregates.current(threadId)?.readCanonicalState() ?? null;
        const hasTurn =
          turnId === null
            ? (canonical?.turns.length ?? 0) > 0
            : canonical?.turns.some((turn) => turn.protocol.id === turnId) === true;
        if (!canonical || isThreadMetadata || (!requiresFullCanonicalSync && !hasTurn)) {
          syncCanonicalFixture(threadId, isThreadMetadata);
        }
      }
    }
    await handleNotification(notification, handleOptions);
  };
  const handleServerRequest = internals.handleServerRequest.bind(service);
  internals.handleServerRequest = async (request) => {
    const occurrenceToken = nextResponseToken;
    nextResponseToken += 1;
    Object.assign(request, { [CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN]: occurrenceToken });
    const params =
      typeof request.params === "object" && request.params !== null
        ? (request.params as { threadId?: unknown })
        : null;
    if (typeof params?.threadId === "string" && params.threadId.length > 0) {
      let existingRecord = internals.getMaybeConversationRecord(params.threadId);
      const requestTurnId =
        typeof (request.params as { turnId?: unknown }).turnId === "string"
          ? (request.params as { turnId: string }).turnId
          : null;
      const isConversationRequest =
        typeof request.method === "string" &&
        (request.method === "item/commandExecution/requestApproval" ||
          request.method === "item/fileChange/requestApproval" ||
          request.method === "item/permissions/requestApproval" ||
          request.method === "item/tool/requestUserInput" ||
          request.method === "item/tool/requestOptionPicker" ||
          request.method === "item/tool/requestSetupCodexContextPicker" ||
          request.method === "item/tool/call" ||
          request.method === "mcpServer/elicitation/request");
      if (
        !existingRecord &&
        isConversationRequest &&
        !internals.isConversationArchived(params.threadId)
      ) {
        internals.setConversationRecordDetail({
          ...makeThreadDetail(params.threadId),
          turns: requestTurnId
            ? [
                {
                  threadId: params.threadId,
                  turnId: requestTurnId,
                  status: "inProgress",
                  itemIds: [],
                },
              ]
            : [],
          transcript: [],
        });
        existingRecord = internals.getMaybeConversationRecord(params.threadId);
      }
      if (existingRecord && !existingRecord.detail) {
        internals.setConversationRecordDetail({
          ...makeThreadDetail(params.threadId),
          turns: requestTurnId
            ? [
                {
                  threadId: params.threadId,
                  turnId: requestTurnId,
                  status: "inProgress",
                  itemIds: [],
                },
              ]
            : [],
          transcript: [],
        });
      }
      syncCanonicalFixture(params.threadId);
    }
    const result = await handleServerRequest(request);
    if (result !== CodexApplicationRequestPending) return result;
    const threadId = params?.threadId;
    if (typeof threadId !== "string") {
      throw new Error("Pending Codex test request is missing its correlation identity");
    }
    return await new Promise<unknown>((resolve, reject) => {
      const key = responseKey(threadId, occurrenceToken);
      const completions = queuedCompletions.get(key);
      const completion = completions?.shift();
      if (completions?.length === 0) queuedCompletions.delete(key);
      if (completion) {
        if (completion.kind === "success") resolve(completion.value);
        else reject(completion.reason);
        return;
      }
      responseWaiters.set(key, [...(responseWaiters.get(key) ?? []), { resolve, reject }]);
    });
  };
  const upsertPlanImplementationRequest =
    internals.upsertPlanImplementationRequest.bind(testService);
  internals.upsertPlanImplementationRequest = (threadId, turnId, planContent, itemCreatedAt) => {
    syncCanonicalFixture(threadId);
    return upsertPlanImplementationRequest(threadId, turnId, planContent, itemCreatedAt);
  };
  return testService;
}

const updateThreadSettingsForTest = (
  service: TestableCodexService,
  threadId: string,
  patch: import("../../shared/types").CodexConversationThreadSettingsPatch,
) =>
  (
    Reflect.get(service as object, "threadSettingsRuntime") as TestCodexThreadSettingsRuntime
  ).update({ threadId, patch });

const conversationResumeForTest = (
  service: TestableCodexService,
): CodexConversationResumeRuntimePromiseAdapter =>
  Reflect.get(
    service as object,
    "conversationResume",
  ) as CodexConversationResumeRuntimePromiseAdapter;

const requestConversationSnapshotForTest = (
  service: TestableCodexService,
  threadId: string,
): Promise<CodexConversationSnapshot | null> =>
  conversationResumeForTest(service).snapshot(threadId);

describe("codex-service sidebar Thread Project moves", () => {
  test("confirms Project-wide source access, replays the move, and can remove it to Chats", async () => {
    const sourceProject = makeProject({
      id: "project:source",
      name: "Source",
      sources: [{ root: "/workspace/source", order: 0 }],
      primaryWorkspaceRoot: "/workspace/source",
    });
    const targetProject = makeProject({
      id: "project:target",
      name: "Target",
      bindingRevision: 4,
      sources: [{ root: "/workspace/target", order: 0 }],
      primaryWorkspaceRoot: "/workspace/target",
    });
    const projects = new Map([
      [sourceProject.id, sourceProject],
      [targetProject.id, targetProject],
    ]);
    const baseWorkspace = createTestProjectWorkspace();
    await baseWorkspace.upsertThread("thread:move", {
      projectId: sourceProject.id,
      threadName: "Move me",
      threadPreview: "Move me",
      modelProvider: "openai",
      cwd: "/workspace/source/.worktrees/thread",
      managedWorktreePath: "/workspace/source/.worktrees",
      status: { statusType: "idle", activeFlags: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    const moveInputs: Array<Parameters<DesktopProjectWorkspacePort["moveThread"]>[0]> = [];
    const projectWorkspace = {
      ...baseWorkspace,
      getProject: async (projectId: string) => projects.get(projectId) ?? null,
      getProjectSession: async (sessionId: string) => ({
        id: sessionId,
        projectId: sourceProject.id,
        noThreadFallbackTitle: "Move me",
        displayTitle: "Move me",
        order: 0,
        pinned: false,
        pinnedOrder: null,
        archived: false,
        archivedAt: null,
        unread: false,
        thread: null,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
      moveThread: async (input: Parameters<DesktopProjectWorkspacePort["moveThread"]>[0]) => {
        moveInputs.push(input);
        return await baseWorkspace.moveThread(input);
      },
    } as DesktopProjectWorkspacePort;
    const service = createService({ projectWorkspace });
    const moveInput = {
      hostId: "local" as const,
      threadId: "thread:move",
      sourceContainerId: "project:project:source" as const,
      targetContainerId: "project:project:target" as const,
      beforeThreadId: null,
      useDefaultOrder: true as const,
    };

    try {
      const confirmation = await service.threadCatalog.move(moveInput);
      expect(confirmation).toEqual({
        status: "confirmation-required",
        reason: "target-project-needs-source-access",
        threadId: "thread:move",
        targetProjectId: targetProject.id,
        targetBindingRevision: 4,
        missingProjectSources: ["/workspace/source"],
        targetProjectName: "Target",
      });
      expect(moveInputs).toEqual([]);
      if (confirmation.status !== "confirmation-required") {
        throw new Error("Expected Project access confirmation");
      }

      const moved = await service.threadCatalog.move({
        ...moveInput,
        projectAccessGrant: {
          targetProjectId: confirmation.targetProjectId,
          expectedBindingRevision: confirmation.targetBindingRevision,
          missingProjectSources: confirmation.missingProjectSources,
        },
      });
      expect(moved.status).toBe("moved");
      if (moved.status === "moved") {
        expect(moved.operationId).toBe("test-move:thread:move");
        expect(moved.projectionRevision).toBe(1);
      }
      expect(moveInputs[0]).toMatchObject({
        sourceProjectId: sourceProject.id,
        targetProjectId: targetProject.id,
        runtimeWorkspaceRoots: [
          "/workspace/source/.worktrees/thread",
          "/workspace/target",
          "/workspace/source",
        ],
        projectAccessGrant: {
          expectedTargetBindingRevision: 4,
          missingProjectSources: ["/workspace/source"],
        },
      });

      const reordered = await service.threadCatalog.move({
        hostId: "local",
        threadId: "thread:move",
        sourceContainerId: "project:project:target",
        targetContainerId: "project:project:target",
        beforeThreadId: null,
        afterThreadId: "thread:anchor",
      });
      expect(reordered.status).toBe("moved");
      expect(moveInputs[1]).toMatchObject({
        sourceProjectId: targetProject.id,
        targetProjectId: targetProject.id,
        beforeThreadId: null,
        afterThreadId: "thread:anchor",
      });

      const removed = await service.threadCatalog.move({
        hostId: "local",
        threadId: "thread:move",
        sourceContainerId: "project:project:target",
        targetContainerId: "chats",
        beforeThreadId: null,
      });
      expect(removed.status).toBe("moved");
      if (removed.status === "moved") {
        expect(removed.destination.projectId).toBeNull();
      }
      expect(moveInputs[2]).toMatchObject({
        sourceProjectId: targetProject.id,
        targetProjectId: null,
      });
    } finally {
      await service.shutdown();
    }
  });

  test("commits a dormant task move when app-server no longer has the loaded Thread", async () => {
    const sourceProject = makeProject({
      id: "project:source",
      name: "Source",
      sources: [{ root: "/workspace/target/source", order: 0 }],
      primaryWorkspaceRoot: "/workspace/target/source",
    });
    const targetProject = makeProject({
      id: "project:target",
      name: "Target",
      sources: [{ root: "/workspace/target", order: 0 }],
      primaryWorkspaceRoot: "/workspace/target",
    });
    const projects = new Map([
      [sourceProject.id, sourceProject],
      [targetProject.id, targetProject],
    ]);
    const baseWorkspace = createTestProjectWorkspace();
    await baseWorkspace.upsertThread("thread:dormant-move", {
      projectId: sourceProject.id,
      threadName: "Dormant move",
      threadPreview: "Dormant move",
      modelProvider: "openai",
      cwd: "/workspace/target/source",
      status: { statusType: "idle", activeFlags: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    const events: string[] = [];
    const moveInputs: DesktopProjectWorkspaceThreadMoveInput[] = [];
    const projectWorkspace = {
      ...baseWorkspace,
      getProject: async (projectId: string) => projects.get(projectId) ?? null,
      getProjectSession: async (sessionId: string) => ({
        id: sessionId,
        projectId: sourceProject.id,
        noThreadFallbackTitle: "Dormant move",
        displayTitle: "Dormant move",
        order: 0,
        pinned: false,
        pinnedOrder: null,
        archived: false,
        archivedAt: null,
        unread: false,
        thread: null,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
      moveThread: async (input: DesktopProjectWorkspaceThreadMoveInput) => {
        events.push("core-move");
        moveInputs.push(input);
        return await baseWorkspace.moveThread(input);
      },
    } as DesktopProjectWorkspacePort;
    const service = createService({ projectWorkspace });
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method) => {
      expect(method).toBe("thread/settings/update");
      events.push("app-server-sync");
      throw new CodexRpcError("thread not found: thread:dormant-move", -32600);
    };

    try {
      const moved = await service.threadCatalog.move({
        hostId: "local",
        threadId: "thread:dormant-move",
        sourceContainerId: "project:project:source",
        targetContainerId: "project:project:target",
        beforeThreadId: null,
        useDefaultOrder: true,
      });

      expect(moved.status).toBe("moved");
      expect(events).toEqual(["core-move", "app-server-sync"]);
      expect(moveInputs).toEqual([
        expect.objectContaining({
          sourceProjectId: sourceProject.id,
          targetProjectId: targetProject.id,
          runtimeWorkspaceRoots: ["/workspace/target"],
          metadata: expect.objectContaining({ cwd: "/workspace/target" }),
        }),
      ]);
    } finally {
      await service.shutdown();
    }
  });
});

test("keeps parent-linked child threads out of workspace sidebar snapshots", async () => {
  const projectWorkspace = createTestProjectWorkspace();
  await projectWorkspace.upsertThread("thread:root", {
    projectId: null,
    parentThreadId: null,
    threadName: "Root chat",
    threadPreview: "Root chat",
  });
  await projectWorkspace.upsertThread("thread:child", {
    projectId: null,
    parentThreadId: "thread:root",
    threadName: "Subagent chat",
    threadPreview: "Subagent chat",
  });
  await projectWorkspace.setThreadPinned("thread:root", true);
  await projectWorkspace.setThreadPinned("thread:child", true);
  const service = createService({ projectWorkspace });

  try {
    const snapshot = (await service.sidebarSync.sync({ policy: "read", reason: "manual" }))
      .snapshot;

    expect(snapshot.items.map((item) => item.threadId)).toEqual(["thread:root"]);
    expect(snapshot.projectlessThreadIds).toEqual(["thread:root"]);
    expect(snapshot.pinnedThreadIds).toEqual(["thread:root"]);
  } finally {
    await service.shutdown();
  }
});

test("returns the last-known sidebar without repeating a failed Core read", async () => {
  const baseWorkspace = createTestProjectWorkspace();
  await baseWorkspace.upsertThread("thread:cached-sidebar", {
    projectId: null,
    threadName: "Cached sidebar",
    threadPreview: "Cached sidebar",
  });
  await baseWorkspace.setThreadPinned("thread:cached-sidebar", true);
  let reads = 0;
  let coreBusy = false;
  const projectWorkspace = {
    ...baseWorkspace,
    readSidebarOverview: async (includeArchived: boolean) => {
      reads += 1;
      if (coreBusy) throw new Error("Core request deadline was exceeded");
      return await baseWorkspace.readSidebarOverview(includeArchived);
    },
  } as DesktopProjectWorkspacePort;
  const service = createService({ projectWorkspace });
  const client = Reflect.get(service as object, "client") as {
    start: () => Promise<void>;
    request: (method: string) => Promise<unknown>;
  };
  client.start = async () => undefined;
  client.request = async (method) => {
    if (method !== "thread/list") throw new Error(`Unexpected request: ${method}`);
    return { data: [], nextCursor: null };
  };

  try {
    const initial = await service.sidebarSync.sync({ policy: "read" });
    expect(initial.snapshot.items.map((item) => item.threadId)).toEqual(["thread:cached-sidebar"]);
    coreBusy = true;

    const degraded = await service.sidebarSync.sync({
      policy: "force",
      reason: "manual",
    });

    expect(degraded.source).toBe("stale-last-known");
    expect(degraded.snapshot.items.map((item) => item.threadId)).toEqual(["thread:cached-sidebar"]);
    expect(reads).toBe(2);
  } finally {
    await service.shutdown();
  }
});

test("does not mask a sidebar invalidation that lands during a Core read", async () => {
  const baseWorkspace = createTestProjectWorkspace();
  await baseWorkspace.upsertThread("thread:before-invalidation", {
    projectId: null,
    threadName: "Before invalidation",
    threadPreview: "Before invalidation",
  });
  await baseWorkspace.setThreadPinned("thread:before-invalidation", true);
  let reads = 0;
  let releaseFirstRead!: () => void;
  let markFirstReadStarted!: () => void;
  const firstReadStarted = new Promise<void>((resolve) => {
    markFirstReadStarted = resolve;
  });
  const firstReadRelease = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  const projectWorkspace = {
    ...baseWorkspace,
    readSidebarOverview: async (includeArchived: boolean) => {
      reads += 1;
      const overview = await baseWorkspace.readSidebarOverview(includeArchived);
      if (reads === 1) {
        markFirstReadStarted();
        await firstReadRelease;
      }
      return overview;
    },
  } as DesktopProjectWorkspacePort;
  const databaseNotifier = new TestDatabaseInvalidationSource();
  const service = createService({ projectWorkspace, databaseNotifier });
  const client = Reflect.get(service as object, "client") as {
    start: () => Promise<void>;
    request: (method: string) => Promise<unknown>;
  };
  client.start = async () => undefined;
  client.request = async (method) => {
    if (method !== "thread/list") throw new Error(`Unexpected request: ${method}`);
    return { data: [], nextCursor: null };
  };

  try {
    const initialSync = service.sidebarSync.sync({
      policy: "force",
      reason: "manual",
    });
    await firstReadStarted;
    await baseWorkspace.upsertThread("thread:after-invalidation", {
      projectId: null,
      threadName: "After invalidation",
      threadPreview: "After invalidation",
    });
    await baseWorkspace.setThreadPinned("thread:after-invalidation", true);
    databaseNotifier.invalidate();
    releaseFirstRead();

    const initial = await initialSync;
    expect(initial.snapshot.items.map((item) => item.threadId)).toEqual([
      "thread:before-invalidation",
    ]);
    const refreshed = await service.sidebarSync.sync({ policy: "stale" });
    expect(reads).toBe(2);
    expect(refreshed.snapshot.items.map((item) => item.threadId)).toEqual([
      "thread:before-invalidation",
      "thread:after-invalidation",
    ]);
  } finally {
    releaseFirstRead?.();
    await service.shutdown();
  }
});

test("propagates a cold-start Core busy failure instead of fabricating an empty sidebar", async () => {
  let reads = 0;
  const projectWorkspace = {
    ...createTestProjectWorkspace(),
    readSidebarOverview: async () => {
      reads += 1;
      throw new Error("Core request deadline was exceeded");
    },
  } as DesktopProjectWorkspacePort;
  const service = createService({ projectWorkspace });
  const client = Reflect.get(service as object, "client") as {
    start: () => Promise<void>;
    request: (method: string) => Promise<unknown>;
  };
  client.start = async () => undefined;
  client.request = async (method) => {
    if (method !== "thread/list") throw new Error(`Unexpected request: ${method}`);
    return { data: [], nextCursor: null };
  };

  try {
    await expect(
      service.sidebarSync.sync({
        policy: "force",
        reason: "manual",
      }),
    ).rejects.toThrow("Core request deadline was exceeded");
    expect(reads).toBe(1);
  } finally {
    await service.shutdown();
  }
});

test("projects durable local and remote managed worktree identities into the sidebar", async () => {
  const projectWorkspace = createTestProjectWorkspace();
  await projectWorkspace.upsertThread("thread:local-worktree", {
    projectId: null,
    threadName: "Local worktree",
    threadPreview: "Local worktree",
    executionHostId: "local",
    cwd: "/tmp/.nodex/worktrees/91a6/repo",
    managedWorktreePath: "/tmp/.nodex/worktrees/91a6/repo",
  });
  await projectWorkspace.upsertThread("thread:remote-worktree", {
    projectId: null,
    threadName: "Remote worktree",
    threadPreview: "Remote worktree",
    executionHostId: "build-host",
    cwd: "/srv/.nodex/worktrees/91a6/repo",
    managedWorktreePath: "/srv/.nodex/worktrees/91a6/repo",
  });
  await projectWorkspace.setThreadPinned("thread:local-worktree", true);
  await projectWorkspace.setThreadPinned("thread:remote-worktree", true);
  const service = createService({ projectWorkspace });

  try {
    const snapshot = (await service.sidebarSync.sync({ policy: "read", reason: "manual" }))
      .snapshot;
    const local = snapshot.items.find((item) => item.threadId === "thread:local-worktree");
    const remote = snapshot.items.find((item) => item.threadId === "thread:remote-worktree");

    expect(local?.kind).toBe("local");
    expect(local?.runLocation).toEqual({
      kind: "local-worktree",
      path: "/tmp/.nodex/worktrees/91a6/repo",
      phase: "ready",
    });
    expect(remote?.kind).toBe("remote");
    expect(remote?.runLocation).toEqual({
      kind: "remote-worktree",
      hostId: "build-host",
      hostDisplayName: "build-host",
      path: "/srv/.nodex/worktrees/91a6/repo",
      phase: "ready",
    });
  } finally {
    await service.shutdown();
  }
});

test("returns after the first sidebar page and serializes a forced refresh at the window boundary", async () => {
  let reconcileCalls = 0;
  const projectWorkspace = {
    ...createTestProjectWorkspace(),
    reconcileAppServerThreadSweep: async () => {
      reconcileCalls += 1;
      return { threadIds: [], projectIds: [] };
    },
  } as DesktopProjectWorkspacePort;
  const service = createService({ projectWorkspace });
  const client = Reflect.get(service as object, "client") as {
    start: () => Promise<void>;
    request: (method: string, params: unknown) => Promise<unknown>;
  };
  const threadListRequests: Array<{ cursor: string | null; archived: boolean }> = [];
  let releaseSecondWindow!: () => void;
  const secondWindowGate = new Promise<void>((resolve) => {
    releaseSecondWindow = resolve;
  });
  client.start = async () => undefined;
  client.request = async (method, params) => {
    if (method !== "thread/list") throw new Error(`Unexpected request: ${method}`);
    const input = params as { cursor: string | null; archived: boolean };
    threadListRequests.push({ cursor: input.cursor, archived: input.archived });
    if (threadListRequests.length === 1) {
      return { data: [], nextCursor: "active:page-2" };
    }
    if (threadListRequests.length === 2) {
      await secondWindowGate;
      return { data: [], nextCursor: null };
    }
    return { data: [], nextCursor: null };
  };

  try {
    const first = await service.sidebarSync.sync({
      policy: "force",
      reason: "manual",
    });
    expect(first.refreshed).toBe(true);
    await waitForCondition(() => threadListRequests.length === 2, 1_000);

    let secondResolved = false;
    const second = service.sidebarSync
      .sync({
        policy: "force",
        reason: "manual",
      })
      .then((result) => {
        secondResolved = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondResolved).toBe(false);
    expect(threadListRequests.length).toBe(2);

    releaseSecondWindow();
    await second;
    expect(threadListRequests.length).toBe(3);
    await waitForCondition(() => reconcileCalls === 1, 1_000);
    expect(threadListRequests.some((request) => request.archived)).toBe(true);
  } finally {
    releaseSecondWindow();
    await service.shutdown();
  }
});

test("turn completion refreshes app-server recency into the sidebar snapshot", async () => {
  vi.useFakeTimers();
  const threadId = "thread:recency";
  const sessionId = "session:recency";
  const baseWorkspace = createTestProjectWorkspace();
  await baseWorkspace.upsertThread(threadId, {
    projectId: null,
    threadName: "Recency",
    threadPreview: "Recency",
    modelProvider: "openai",
    cwd: "/tmp/recency",
    status: { statusType: "idle", activeFlags: [] },
    createdAt: 1_000,
    updatedAt: 1_000,
    recencyAt: 1_000,
  });
  await baseWorkspace.upsertProjectSessionThreadLink({
    sessionId,
    projectId: null,
    threadId,
    threadName: "Recency",
    threadPreview: "Recency",
    modelProvider: "openai",
    cwd: "/tmp/recency",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    recencyAt: 1_000,
  });
  await baseWorkspace.setThreadPinned(threadId, true);
  const projectWorkspace = {
    ...baseWorkspace,
    getProjectSession: async (candidateSessionId: string) =>
      candidateSessionId === sessionId
        ? ({ id: sessionId, projectId: null } as ProjectSession)
        : null,
  } as DesktopProjectWorkspacePort;
  const service = createService({ projectWorkspace });
  const client = Reflect.get(service as object, "client") as {
    start: () => Promise<void>;
    request: (method: string, params: unknown) => Promise<unknown>;
  };
  const hostMessages: CodexHostMessage[] = [];
  let threadListRequests = 0;
  let markStaleRequestStarted!: () => void;
  const staleRequestStarted = new Promise<void>((resolve) => {
    markStaleRequestStarted = resolve;
  });
  let releaseStaleRequest!: () => void;
  const staleRequestGate = new Promise<void>((resolve) => {
    releaseStaleRequest = resolve;
  });
  let markFreshRequestStarted!: () => void;
  const freshRequestStarted = new Promise<void>((resolve) => {
    markFreshRequestStarted = resolve;
  });
  client.start = async () => undefined;
  client.request = async (method) => {
    if (method !== "thread/list") throw new Error(`Unexpected request: ${method}`);
    threadListRequests += 1;
    const requestNumber = threadListRequests;
    if (requestNumber === 1) {
      markStaleRequestStarted();
      await staleRequestGate;
    }
    if (requestNumber === 2) markFreshRequestStarted();
    const recencyAt = requestNumber === 1 ? 1 : 20;
    return {
      data: [
        {
          ...makeProtocolThread(threadId, "/tmp/recency"),
          createdAt: 1,
          updatedAt: recencyAt,
          recencyAt,
          status: { type: "idle" },
        },
      ],
      nextCursor: null,
    };
  };
  service.on("hostMessage", (message) => {
    hostMessages.push(message);
  });
  const internals = service as unknown as {
    handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
  };

  try {
    const staleSync = service.sidebarSync.sync({
      policy: "force",
      reason: "manual",
    });
    await staleRequestStarted;
    expect(threadListRequests).toBe(1);

    await internals.handleNotification({
      method: "turn/completed",
      params: {
        threadId,
        turn: completeLegacyProtocolTurnFixture({
          id: "turn:recency",
          status: "completed",
        }),
      },
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(threadListRequests).toBe(1);

    releaseStaleRequest();
    await staleSync;
    await freshRequestStarted;
    await service.sidebarSync.sync({ policy: "force", reason: "host-message" });

    expect(threadListRequests).toBe(2);
    expect((await projectWorkspace.getThread(threadId))?.recencyAt).toBe(20_000);
    const syncMessage = hostMessages.findLast(
      (message): message is Extract<CodexHostMessage, { type: "sidebarSyncUpdated" }> =>
        message.type === "sidebarSyncUpdated",
    );
    expect(
      syncMessage?.result.snapshot.items.find((item) => item.threadId === threadId)?.recencyAt,
    ).toBe(20_000);
  } finally {
    releaseStaleRequest();
    await service.shutdown();
    vi.useRealTimers();
  }
});

test("does not reconcile an incomplete sidebar sweep before a fresh replacement", async () => {
  vi.useFakeTimers();
  let reconcileCalls = 0;
  const projectWorkspace = {
    ...createTestProjectWorkspace(),
    reconcileAppServerThreadSweep: async () => {
      reconcileCalls += 1;
      return { threadIds: [], projectIds: [] };
    },
  } as DesktopProjectWorkspacePort;
  const service = createService({ projectWorkspace });
  const client = Reflect.get(service as object, "client") as {
    start: () => Promise<void>;
    request: (method: string, params: unknown) => Promise<unknown>;
  };
  const requests: Array<{ cursor: string | null; archived: boolean }> = [];
  client.start = async () => undefined;
  client.request = async (method, params) => {
    if (method !== "thread/list") throw new Error(`Unexpected request: ${method}`);
    const input = params as { cursor: string | null; archived: boolean };
    requests.push({ cursor: input.cursor, archived: input.archived });
    if (requests.length === 1) return { data: [], nextCursor: "active:page-2" };
    if (requests.length === 2) throw new Error("temporary page failure");
    return { data: [], nextCursor: null };
  };

  try {
    await service.sidebarSync.sync({
      policy: "force",
      reason: "manual",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.map((request) => request.cursor)).toEqual([null, "active:page-2"]);
    expect(reconcileCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests).toHaveLength(2);
    expect(reconcileCalls).toBe(0);

    await service.sidebarSync.sync({
      policy: "force",
      reason: "manual",
    });
    expect(requests[2]).toEqual({ cursor: null, archived: false });
    await vi.runAllTimersAsync();
    expect(requests.some((request) => request.archived)).toBe(true);
    expect(reconcileCalls).toBe(1);
  } finally {
    await service.shutdown();
    vi.useRealTimers();
  }
});

test("reads Git settings live for every project-aware instruction build", async () => {
  let gitSettings: CodexGitSettings = {
    branchPrefix: "team/",
    commitInstructions: "Keep commits focused.",
    pullRequestInstructions: "Include validation notes.",
  };
  const service = createService({ gitSettingsResolver: () => gitSettings });
  const resolveInstructions = Reflect.get(
    service as object,
    "resolveProjectAwareDeveloperInstructions",
  ) as (input: { cwd: string; threadId: string | null }) => Promise<string>;

  try {
    const first = await resolveInstructions.call(service, {
      cwd: process.cwd(),
      threadId: null,
    });
    expect(first.includes("- Branch prefix: `team/`")).toBe(true);
    expect(first.includes("- Commit instructions: Keep commits focused.")).toBe(true);
    expect(first.includes("- Pull request instructions: Include validation notes.")).toBe(true);

    gitSettings = {
      branchPrefix: "release/",
      commitInstructions: "Use imperative subjects.",
      pullRequestInstructions: "Link the issue.",
    };
    const second = await resolveInstructions.call(service, {
      cwd: process.cwd(),
      threadId: null,
    });
    expect(second.includes("- Branch prefix: `release/`")).toBe(true);
    expect(second.includes("- Commit instructions: Use imperative subjects.")).toBe(true);
    expect(second.includes("- Pull request instructions: Link the issue.")).toBe(true);
    expect(second.includes("Keep commits focused.")).toBe(false);
  } finally {
    await service.shutdown();
  }
});

test("canonical history projection retains null occurrences and suppresses each raw echo", async () => {
  const service = createService();
  const threadId = "thr_canonical_history_projection";
  const rawTurn = makeCanonicalHydrationTurn("turn_history_projection");

  try {
    const timeline = buildCanonicalHistoryTimeline(service, {
      threadId,
      turns: [rawTurn],
      transformState: (state) => {
        const boundTurn = state.turns[0];
        if (!boundTurn) return state;
        return {
          ...state,
          turns: [
            {
              ...boundTurn,
              protocol: { ...boundTurn.protocol, id: null },
              items: [],
            },
            boundTurn,
          ],
        };
      },
    });
    const userMessages = timeline.transcript.filter(
      (entry) => entry.semanticKind === "userMessage",
    );

    expect(userMessages.map((entry) => entry.itemId)).toStrictEqual([
      "turn-index-0:input",
      "turn_history_projection:input",
    ]);
    expect(userMessages.every((entry) => entry.source === "bootstrap")).toBe(true);
    expect((userMessages[0]?.userAttachments?.[0] as { path?: string } | undefined)?.path).toBe(
      "/workspace/project/file.ts",
    );
    expect(timeline.turns[0]?.turnStartedAtMs).toBe(1_711_278_050_000);
    expect(timeline.turns[0]?.completedAt).toBe(1_711_278_060_000);
  } finally {
    await service.shutdown();
  }
});

test("history projection splits command actions while retaining the raw command owner", async () => {
  const service = createService();
  const threadId = "thr_split_command_history";
  const rawCommand = {
    type: "commandExecution",
    id: "command-multi",
    pluginId: null,
    scriptPath: null,
    command: "cat a && rg b",
    cwd: "/workspace/project",
    processId: "process-1",
    source: "agent",
    status: "completed",
    commandActions: [
      { type: "read", command: " cat a ", name: "a", path: "/workspace/project/a" },
      { type: "search", command: " rg b ", query: "b", path: null },
    ],
    aggregatedOutput: "done",
    exitCode: 0,
    durationMs: 25,
  } satisfies Extract<ThreadItem, { type: "commandExecution" }>;
  try {
    const timeline = buildCanonicalHistoryTimeline(service, {
      threadId,
      turns: [
        {
          id: "turn-command",
          items: [rawCommand],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: 25,
        },
      ],
      transformState: (state) => ({
        ...state,
        turns: state.turns.map((turn) => ({
          ...turn,
          sidecar: {
            ...turn.sidecar,
            commandExecutionStartedAtMsById: { "command-multi": 1_000 },
          },
        })),
      }),
    });

    expect(timeline.transcript.length).toBe(2);
    expect(timeline.transcript[0]?.callId).toBe("command-multi:0");
    expect(timeline.transcript[1]?.itemId).toBe("command-multi:1");
    expect(timeline.transcript[0]?.commandExecutionItemId).toBe("command-multi");
    expect(timeline.transcript[0]?.startedAtMs).toBe(1_000);
    expect(timeline.transcript[0]?.rawItem === rawCommand).toBe(true);
    expect(timeline.transcript[1]?.rawItem === rawCommand).toBe(true);
    expect(timeline.turns[0]?.itemIds[0]).toBe("command-multi");
  } finally {
    await service.shutdown();
  }
});

test("history projection keeps patch, visualization, and filtered turn diff state together", async () => {
  const service = createService();
  const threadId = "thr_patch_visualization_history";
  const visualizationPath = ".codex/visualizations/2026/07/11/thread/chart.html";
  const ordinaryDiff = "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const visualizationDiff = [
    `diff --git a/${visualizationPath} b/${visualizationPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${visualizationPath}`,
    "@@ -0,0 +1 @@",
    "+<html></html>",
    "",
  ].join("\n");
  try {
    const timeline = buildCanonicalHistoryTimeline(service, {
      threadId,
      turns: [
        {
          id: "turn-patch",
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          items: [
            {
              type: "commandExecution",
              id: "command-cwd",
              pluginId: null,
              scriptPath: null,
              command: "pwd",
              cwd: "/workspace/changed",
              processId: null,
              source: "agent",
              status: "completed",
              commandActions: [],
              aggregatedOutput: null,
              exitCode: 0,
              durationMs: 1,
            },
            {
              type: "fileChange",
              id: "file-mixed",
              status: "inProgress",
              changes: [
                {
                  path: "src/app.ts",
                  kind: { type: "update", move_path: null },
                  diff: "@@ -1 +1 @@\n-old\n+new\n",
                },
                {
                  path: visualizationPath,
                  kind: { type: "add" },
                  diff: "<html></html>",
                },
              ],
            },
          ],
        },
      ],
      transformState: (state) => ({
        ...state,
        turns: state.turns.map((turn) => ({
          ...turn,
          sidecar: {
            ...turn.sidecar,
            diff: `${ordinaryDiff}${visualizationDiff}`,
          },
        })),
      }),
    });
    const patch = timeline.transcript.find((entry) => entry.itemId === "file-mixed");
    const turnDiff = timeline.transcript.find((entry) => entry.semanticKind === "diff");
    const turnDiffRaw = turnDiff?.rawItem as
      | {
          unifiedDiff?: string;
          patchBatches?: Array<{ cwd?: string; changes?: unknown[] }>;
        }
      | undefined;

    expect(getCodexFileChangePaths(patch?.fileChange?.changes).join(",")).toBe("src/app.ts");
    expect(patch?.fileChange?.visualizationActivities?.[0]?.path).toBe(visualizationPath);
    expect(patch?.fileChange?.success ?? null).toBe(null);
    expect(turnDiffRaw?.unifiedDiff).toBe(ordinaryDiff);
    expect(turnDiffRaw?.patchBatches?.[0]?.cwd).toBe("/workspace/changed");
    expect(turnDiffRaw?.patchBatches?.[0]?.changes?.length ?? 0).toBe(1);
  } finally {
    await service.shutdown();
  }
});

test("history projection applies MCP, dynamic, collab, and web special-family rules", async () => {
  const service = createService();
  const threadId = "thr_special_family_history";
  try {
    const timeline = buildCanonicalHistoryTimeline(service, {
      threadId,
      turns: [
        {
          id: "turn-special",
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          items: [
            {
              type: "mcpToolCall",
              id: "mcp-1",
              server: "node_repl",
              tool: "run",
              status: "completed",
              arguments: { code: "fixture()" },
              appContext: null,
              pluginId: null,
              readOnlyHint: false,
              result: { content: [], structuredContent: null, _meta: null },
              error: null,
              durationMs: 5,
            },
            {
              type: "dynamicToolCall",
              id: "dynamic-generic",
              namespace: "fixture",
              tool: "fixture_tool",
              arguments: { value: true },
              status: "completed",
              contentItems: [{ type: "inputText", text: "canonical generic output" }],
              success: true,
              durationMs: 6,
            },
            {
              type: "dynamicToolCall",
              id: "dynamic-hidden",
              namespace: "codex_app",
              tool: "load_workspace_dependencies",
              arguments: {},
              status: "completed",
              contentItems: null,
              success: true,
              durationMs: 1,
            },
            {
              type: "collabAgentToolCall",
              id: "collab-wait",
              tool: "wait",
              status: "completed",
              senderThreadId: "sender",
              receiverThreadIds: [],
              prompt: null,
              model: null,
              reasoningEffort: null,
              agentsStates: {},
            },
            {
              type: "collabAgentToolCall",
              id: "collab-spawn",
              tool: "spawnAgent",
              status: "completed",
              senderThreadId: "sender",
              receiverThreadIds: ["receiver"],
              prompt: "Inspect",
              model: "gpt-fixture",
              reasoningEffort: "medium",
              agentsStates: {},
            },
            {
              type: "webSearch",
              id: "web-active",
              query: "fixture",
              action: { type: "search", query: "fixture", queries: ["fixture"] },
              results: null,
            },
          ],
        },
      ],
    });
    const mcp = timeline.transcript.find((entry) => entry.itemId === "mcp-1");
    const dynamic = timeline.transcript.find((entry) => entry.itemId === "dynamic-generic");
    const spawn = timeline.transcript.find((entry) => entry.itemId === "collab-spawn");
    const web = timeline.transcript.find((entry) => entry.itemId === "web-active");

    expect(timeline.transcript.some((entry) => entry.itemId === "dynamic-hidden")).toBe(false);
    expect(timeline.transcript.some((entry) => entry.itemId === "collab-wait")).toBe(false);
    expect(mcp?.mcpToolCall?.completed).toBe(true);
    expect(mcp?.toolCall === undefined).toBe(true);
    expect(dynamic?.dynamicToolCall?.completed).toBe(true);
    expect(dynamic?.dynamicToolCall?.contentItems).toEqual([
      {
        type: "inputText",
        text: "canonical generic output",
      },
    ]);
    expect(dynamic?.dynamicToolCall?.success).toBe(true);
    expect(dynamic?.dynamicToolCall?.durationMs).toBe(6);
    expect(spawn?.semanticKind).toBe("multiAgentAction");
    expect(spawn?.toolCall === undefined).toBe(true);
    expect(web?.webSearch?.completed).toBe(false);
    expect((web?.webSearch?.action as { type?: string })?.type).toBe("search");
  } finally {
    await service.shutdown();
  }
});

test("history timeline projects turn diff before canonical request rows", async () => {
  const service = createService();
  const threadId = "thr_history_requests";
  try {
    const timeline = buildCanonicalHistoryTimeline(service, {
      threadId,
      turns: [
        {
          id: "turn-requests",
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          items: [],
        },
      ],
      requests: [
        {
          id: 701,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId,
            turnId: "turn-requests",
            itemId: "command-pending",
            startedAtMs: 7_010,
            environmentId: null,
            reason: "Needs approval",
            command: "bun test",
            cwd: "/request/cwd-must-not-win",
            commandActions: [{ type: "unknown", command: "bun test" }],
          },
        },
        {
          id: "input-702",
          method: "item/tool/requestUserInput",
          params: {
            threadId,
            turnId: "turn-requests",
            itemId: "input-pending",
            questions: [
              {
                id: "choice",
                header: "Choice",
                question: "Continue?",
                isOther: true,
                isSecret: false,
                options: [{ label: "Yes", description: "Continue." }],
              },
            ],
            isBlocking: true,
            autoResolutionMs: null,
          },
        },
      ],
      transformState: (state) => ({
        ...state,
        turns: state.turns.map((turn) => ({
          ...turn,
          sidecar: {
            ...turn.sidecar,
            diff: "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
          },
        })),
      }),
    });
    const turnDiff = timeline.transcript.find((entry) => entry.semanticKind === "diff");
    const command = timeline.transcript.find((entry) => entry.callId === "command-pending");
    const userInput = timeline.transcript.find((entry) => entry.requestId === "input-702");

    expect(timeline.transcript.length).toBe(3);
    expect(turnDiff?.sequence).toBe(0);
    expect(command?.sequence).toBe(1);
    expect(userInput?.sequence).toBe(2);
    expect(command?.approvalRequestId).toBe(701);
    expect(command?.cwd).toBe("/workspace/project");
    expect(userInput?.callId).toBe("input-pending");
    expect(userInput?.userInputQuestions?.[0]?.isOther).toBe(true);
  } finally {
    await service.shutdown();
  }
});

test("fork rollback rematerializes through the attached-session owner", async () => {
  const service = createService();
  const threadId = "thr_attached_rollback";
  const serviceInternals = service as unknown as {
    setConversationRecordDetail: (detail: CodexThreadDetail) => void;
    applyForkRollbackResponse: (input: {
      threadId: string;
      response: ThreadRollbackResponse;
      fallbackRef: null;
      fallbackCwd: string;
      materialize: (
        thread: Thread,
        resolvedCwd: string,
      ) => {
        detail: CodexThreadDetail;
        summary: null;
      };
    }) => Promise<{ detail: CodexThreadDetail; summary: null }>;
  };
  serviceInternals.setConversationRecordDetail({
    ...makeThreadDetail(threadId),
    cwd: "/workspace/fork-response",
    threadPreview: "Fork response preview",
  });
  const rollbackThread = {
    ...makeCanonicalForkResponse({
      threadId,
      cwd: "/workspace/rollback-response",
      turns: [makeCanonicalHydrationTurn("turn_after_rollback")],
    }).thread,
    preview: "Rollback response preview",
  };
  let attachedLink = {
    cwd: "/workspace/fork-response",
    preview: "Fork response preview",
  };
  let materializeCalls = 0;

  try {
    const materialized = await serviceInternals.applyForkRollbackResponse({
      threadId,
      response: { thread: rollbackThread },
      fallbackRef: null,
      fallbackCwd: "/workspace/fallback",
      materialize: (thread, resolvedCwd) => {
        materializeCalls += 1;
        attachedLink = {
          cwd: resolvedCwd,
          preview: thread.preview ?? "",
        };
        return {
          detail: {
            ...makeThreadDetail(thread.id),
            cwd: resolvedCwd,
            threadPreview: thread.preview ?? "",
          },
          summary: null,
        };
      },
    });

    expect(materializeCalls).toBe(1);
    expect(attachedLink.cwd).toBe("/workspace/rollback-response");
    expect(attachedLink.preview).toBe("Rollback response preview");
    expect(materialized.detail.cwd).toBe("/workspace/rollback-response");
    expect(materialized.detail.threadPreview).toBe("Rollback response preview");
    expect(getCanonicalConversationState(service, threadId)?.turns.length ?? 0).toBe(1);
  } finally {
    await service.shutdown();
  }
});

async function flushAsyncWork(ticks = 2): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function installRendererOwnerConversation(
  service: TestableCodexService,
  input: {
    threadId: string;
    ownerClientId?: string;
    turnStatus?: CodexTurnSummary["status"];
    statusType?: CodexThreadDetail["statusType"];
  },
): void {
  const threadId = input.threadId;
  const turnStatus = input.turnStatus ?? "completed";
  const serviceInternals = service as unknown as {
    setConversationRecordDetail: (detail: CodexThreadDetail) => void;
    getConversationRecord: (threadId: string) => {
      detail: CodexThreadDetail | null;
    };
  };

  serviceInternals.setConversationRecordDetail({
    ...makeThreadDetail(threadId),
    statusType: input.statusType ?? "idle",
    statusActiveFlags: [],
    turns: [
      {
        threadId,
        turnId: `${threadId}-turn`,
        status: turnStatus,
        itemIds: [],
      },
    ],
    transcript: [],
  });
  serviceInternals.getConversationRecord(threadId);
  const aggregate = conversationAggregateForTest(service, threadId);
  aggregate.setResumeState("resumed");
  aggregate.setStreaming(true);
  setTestConversationStreamRole(service, threadId, "owner");
  rendererConversationsForTest(service).setOwner(threadId, input.ownerClientId ?? "renderer-owner");
}

function projectConversationFromHostMessages(
  messages: readonly CodexHostMessage[],
  initialConversation: CodexConversationSnapshot | null = null,
): CodexConversationSnapshot | null {
  let conversation: CodexConversationSnapshot | null = initialConversation;
  for (const message of messages) {
    if (message.type !== "threadStreamStateChanged") {
      continue;
    }

    if (message.change.type === "snapshot") {
      conversation = message.change.conversationState;
      continue;
    }

    if (!conversation) {
      continue;
    }

    conversation = applyCodexConversationStateUpdates(conversation, message.change.patches);
  }

  return conversation;
}

function getRecordedItem(
  service: unknown,
  threadId: string,
  turnId: string,
  itemId: string,
): CodexItemView | null {
  const record = (
    service as {
      getConversationRecord: (id: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
    }
  ).getConversationRecord(threadId);
  const items = record.itemsByTurn.get(turnId);
  if (!items) return null;
  for (const item of items.values()) {
    if (item.itemId === itemId) return item;
  }
  return null;
}

function initializeGitRepository(repoPath: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Nodex Test"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "nodex@example.com"], { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repoPath });
}

describe("codex-service session-backed transcript recovery", () => {
  test("reconciles historically inverted and stale app-server Thread timestamps", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      buildWorkspaceThreadMaterialization: (input: {
        candidate: Record<string, unknown>;
        existing: CodexThreadSummary | null;
        ref: null;
      }) => {
        patch: {
          createdAt?: number;
          updatedAt?: number;
        };
      };
    };
    const threadId = "019f2321-8ed9-74d0-a2cc-48856e20cf0c";

    try {
      const repaired = serviceInternals.buildWorkspaceThreadMaterialization({
        candidate: {
          id: threadId,
          createdAt: 1_783_029_629,
          updatedAt: 1_783_000_989,
        },
        existing: null,
        ref: null,
      });
      expect(repaired.patch.createdAt).toBe(1_783_000_829_000);
      expect(repaired.patch.updatedAt).toBe(1_783_000_989_000);

      const coldRestartThreadId = "019f8b12-45fe-7e53-a8ba-bd0c0d5b4e88";
      const monotonic = serviceInternals.buildWorkspaceThreadMaterialization({
        candidate: {
          id: coldRestartThreadId,
          createdAt: 1_784_744_658,
          updatedAt: 1_784_744_658,
        },
        existing: {
          threadId: coldRestartThreadId,
          projectId: null,
          source: null,
          threadName: null,
          threadPreview: "",
          modelProvider: "openai",
          cwd: null,
          statusType: "notLoaded",
          statusActiveFlags: [],
          archived: false,
          createdAt: 1_784_744_661_000,
          updatedAt: 1_784_744_712_000,
          linkedAt: "2026-07-22T09:04:18.000Z",
        },
        ref: null,
      });
      expect(monotonic.patch.createdAt).toBeUndefined();
      expect(monotonic.patch.updatedAt).toBe(1_784_744_712_000);
    } finally {
      await service.shutdown();
    }
  });

  test("keeps a durable managed cwd when app-server observes an equivalent path spelling", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      buildWorkspaceThreadMaterialization: (input: {
        candidate: Record<string, unknown>;
        existing: CodexThreadSummary;
        ref: null;
      }) => {
        resolvedCwd: string | null;
        managedWorktreePath: string | null;
        patch: { cwd?: string | null };
      };
    };
    const managedRoot = "/var/folders/nodex/managed/repository";
    const durableCwd = `${managedRoot}/packages/app`;

    try {
      const materialization = serviceInternals.buildWorkspaceThreadMaterialization({
        candidate: {
          id: "thread-managed-path-alias",
          cwd: "/private/var/folders/nodex/managed/repository/packages/app",
          status: { type: "notLoaded" },
        },
        existing: {
          threadId: "thread-managed-path-alias",
          projectId: "project-managed-path-alias",
          source: null,
          threadName: "Managed task",
          threadPreview: "Managed task",
          modelProvider: "openai",
          cwd: durableCwd,
          managedWorktreePath: managedRoot,
          statusType: "idle",
          statusActiveFlags: [],
          archived: false,
          createdAt: 1,
          updatedAt: 2,
          linkedAt: "2026-08-14T00:00:00.000Z",
        },
        ref: null,
      });

      expect(materialization).toMatchObject({
        resolvedCwd: durableCwd,
        managedWorktreePath: managedRoot,
        patch: { cwd: durableCwd },
      });
    } finally {
      await service.shutdown();
    }
  });

  test("cold resume reprojects the durable managed cwd and writable roots", async () => {
    const service = createService();
    const threadId = "thread-managed-cold-resume";
    const managedRoot = "/var/folders/nodex/managed/repository";
    const durableCwd = `${managedRoot}/packages/app`;
    const additionalRoot = "/workspace/shared";
    const observedRoot = "/private/var/folders/nodex/managed/repository";
    const observedCwd = `${observedRoot}/packages/app`;
    const sourceRoot = "/workspace/source-repository";
    const requests: Array<{ method: string; params: unknown }> = [];
    const projectedCwds: Array<string | null> = [];
    const serviceInternals = service as unknown as {
      resumeConversationRecord: (id: string) => Promise<CodexThreadDetail | null>;
      parseThreadRef: (id: string) => Record<string, unknown> | null;
      maybeResolveProjectRuntimeContext: (projectId: string) => {
        workspaceRoots: string[];
        primaryWorkspaceRoot: string;
      };
      readThreadWritableRoots: (id: string) => Promise<string[]>;
      upsertLinkFromThread: (thread: Thread) => null;
      buildThreadDetailFromCanonicalState: () => CodexThreadDetail;
      persistThreadDetailSummary: (detail: CodexThreadDetail) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const observedThread = {
      ...makeProtocolThread(threadId, observedCwd, []),
      path: `${observedRoot}/rollout.jsonl`,
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/read") return { thread: observedThread };
      if (method === "thread/resume") {
        const response = makeCanonicalResumeResponse({
          threadId,
          initialTurnsPage: {
            data: [],
            nextCursor: null,
            backwardsCursor: null,
          },
          runtimeWorkspaceRoots: [observedRoot],
        });
        return {
          ...response,
          cwd: observedCwd,
          thread: observedThread,
          sandbox: {
            ...response.sandbox,
            writableRoots: [observedRoot],
          },
        };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };
    serviceInternals.parseThreadRef = () => ({
      projectId: "project-managed-cold-resume",
      cwd: durableCwd,
      managedWorktreePath: managedRoot,
      projectlessWorkspaceBrowserRoot: null,
    });
    serviceInternals.maybeResolveProjectRuntimeContext = () => ({
      workspaceRoots: [sourceRoot, additionalRoot],
      primaryWorkspaceRoot: sourceRoot,
    });
    serviceInternals.readThreadWritableRoots = async () => [managedRoot, additionalRoot];
    serviceInternals.upsertLinkFromThread = (thread) => {
      projectedCwds.push(thread.cwd);
      return null;
    };
    serviceInternals.buildThreadDetailFromCanonicalState = () => ({
      ...makeThreadDetail(threadId),
      projectId: "project-managed-cold-resume",
      cwd: durableCwd,
      managedWorktreePath: managedRoot,
    });
    serviceInternals.persistThreadDetailSummary = () => {};

    try {
      const detail = await serviceInternals.resumeConversationRecord(threadId);
      const params = requests.find((request) => request.method === "thread/resume")
        ?.params as Record<string, unknown>;

      expect(detail).toMatchObject({
        threadId,
        cwd: durableCwd,
        managedWorktreePath: managedRoot,
      });
      expect(params.cwd).toBe(durableCwd);
      expect(params.runtimeWorkspaceRoots).toEqual([managedRoot, additionalRoot]);
      expect(params.runtimeWorkspaceRoots).not.toContain(sourceRoot);
      expect(projectedCwds).toEqual([durableCwd, durableCwd]);
    } finally {
      await service.shutdown();
    }
  });

  test("normal resume pre-reads metadata, sends exact nullable fields, and gates an existing owner", async () => {
    const service = createService();
    const threadId = "thr_exact_resume_params";
    const requests: Array<{ method: string; params: unknown }> = [];
    const serviceInternals = service as unknown as {
      resumeConversationRecord: (id: string) => Promise<CodexThreadDetail | null>;
      parseThreadRef: (id: string) => Record<string, unknown> | null;
      maybeResolveProjectRuntimeContext: (projectId: string) => {
        workspaceRoots: string[];
        primaryWorkspaceRoot: string;
      };
      upsertLinkFromThread: () => null;
      buildThreadDetailFromCanonicalState: (
        state: CodexCanonicalConversationState,
      ) => CodexThreadDetail;
      persistThreadDetailSummary: (detail: CodexThreadDetail) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const metadataThread = {
      ...makeProtocolThread(threadId, "/workspace/project", []),
      path: "/workspace/project/rollout.jsonl",
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/read") return { thread: metadataThread };
      if (method === "thread/resume") {
        return makeCanonicalResumeResponse({
          threadId,
          initialTurnsPage: {
            data: [],
            nextCursor: null,
            backwardsCursor: null,
          },
        });
      }
      throw new Error(`Unexpected client request: ${method}`);
    };
    serviceInternals.parseThreadRef = () => ({
      projectId: "project-exact-resume",
      cwd: "/workspace/project",
      projectlessWorkspaceBrowserRoot: null,
    });
    serviceInternals.maybeResolveProjectRuntimeContext = () => ({
      workspaceRoots: ["/workspace/project"],
      primaryWorkspaceRoot: "/workspace/project",
    });
    serviceInternals.upsertLinkFromThread = () => null;
    serviceInternals.buildThreadDetailFromCanonicalState = () => ({
      ...makeThreadDetail(threadId),
      projectId: "project-exact-resume",
      cwd: "/workspace/project",
    });
    serviceInternals.persistThreadDetailSummary = () => {};

    try {
      const first = await serviceInternals.resumeConversationRecord(threadId);
      const second = await serviceInternals.resumeConversationRecord(threadId);
      const params = requests[1]?.params as Record<string, unknown>;
      expect(first?.threadId).toBe(threadId);
      expect(second?.threadId).toBe(threadId);
      expect(first?.latestCollaborationMode?.mode ?? "").toBe("default");
      expect(first?.latestCollaborationMode?.settings.model ?? "").toBe("gpt-canonical");
      expect(first?.latestCollaborationMode?.settings.reasoning_effort ?? null).toBe("high");
      expect(requests.map((request) => request.method).join(",")).toBe("thread/read,thread/resume");
      expect(params.cwd).toBe("/workspace/project");
      expect(params.path).toBe("/workspace/project/rollout.jsonl");
      expect(params.history).toBe(null);
      expect(params.model).toBe(null);
      expect(params.modelProvider).toBe(null);
      expect(String(params.developerInstructions).includes("<app-context>")).toBe(true);
      expect(String(params.developerInstructions).includes("### Thread Coordination")).toBe(true);
      expect(
        (params.config as Record<string, unknown>)["features.apply_patch_streaming_events"],
      ).toBe(true);
      expect((params.config as Record<string, unknown>)["features.thread_tools"]).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(params, "permissions")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(params, "sandbox")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(params, "approvalsReviewer")).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("direct resume returns an owned conversation before buffer and post-resume side effects", async () => {
    const service = createService();
    const threadId = "thr_direct_resume_owned";
    installRendererOwnerConversation(service, { threadId });
    const requests: string[] = [];
    const hostMessages: CodexHostMessage[] = [];
    let goalFlows = 0;
    const serviceInternals = service as unknown as {
      hasResumeNotificationBuffer: (id: string) => boolean;
      startPostResumeGoalFlow: (id: string, revision: number) => Promise<void>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method) => {
      requests.push(method);
      throw new Error(`Unexpected client request: ${method}`);
    };
    serviceInternals.startPostResumeGoalFlow = async () => {
      goalFlows += 1;
    };
    service.on("hostMessage", (message) => hostMessages.push(message));

    try {
      const detail = await service.resumeThread(threadId);

      expect(detail?.threadId ?? "").toBe(threadId);
      expect(requests.length).toBe(0);
      expect(serviceInternals.hasResumeNotificationBuffer(threadId)).toBe(false);
      expect(goalFlows).toBe(0);
      expect(hostMessages.length).toBe(0);
      expect(service.serializeConversationSnapshot(threadId)?.resumeState ?? "").toBe("resumed");
    } finally {
      await service.shutdown();
    }
  });

  test("resume reviewer gate treats explicit null candidates as absent", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      resolveCanonicalPreResumePermissionContext: (
        record: unknown,
        runtimeRoots: readonly string[],
        defaultRoots: readonly string[],
        projectless: boolean,
        persistedRoots: readonly string[],
      ) => {
        context: { approvalsReviewer: string };
        shouldSendApprovalsReviewer: boolean;
      };
    };
    const record = {
      canonicalState: {
        sidecar: {
          hydrationContext: {
            latestThreadSettings: { approvalsReviewer: null },
            currentPermissions: null,
          },
        },
        turns: [{ sidecar: { params: { approvalsReviewer: null } } }],
      },
    };

    try {
      const selection = serviceInternals.resolveCanonicalPreResumePermissionContext(
        record,
        [],
        [],
        false,
        [],
      );
      expect(selection.context.approvalsReviewer).toBe("user");
      expect(selection.shouldSendApprovalsReviewer).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("projectless resume clamps cwd to its browser root and sends explicit permissions", async () => {
    const service = createService();
    const threadId = "thr_projectless_resume_clamp";
    const requests: Array<{ method: string; params: unknown }> = [];
    const serviceInternals = service as unknown as {
      resumeConversationRecord: (id: string) => Promise<CodexThreadDetail | null>;
      parseThreadRef: (id: string) => Record<string, unknown> | null;
      getThreadLinkSafely: (id: string) => { cwd: string } | null;
      upsertLinkFromThread: () => null;
      buildThreadDetailFromCanonicalState: () => CodexThreadDetail;
      persistThreadDetailSummary: (detail: CodexThreadDetail) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/read") {
        return { thread: makeProtocolThread(threadId, "/outside/root", []) };
      }
      if (method === "thread/resume") {
        return makeCanonicalResumeResponse({
          threadId,
          initialTurnsPage: {
            data: [],
            nextCursor: null,
            backwardsCursor: null,
          },
        });
      }
      throw new Error(`Unexpected client request: ${method}`);
    };
    serviceInternals.parseThreadRef = () => ({
      projectId: null,
      cwd: "/outside/root",
      projectlessWorkspaceBrowserRoot: "/browser/root",
    });
    serviceInternals.getThreadLinkSafely = () => ({ cwd: "/outside/root" });
    serviceInternals.upsertLinkFromThread = () => null;
    serviceInternals.buildThreadDetailFromCanonicalState = () => ({
      ...makeThreadDetail(threadId),
      projectId: null,
      cwd: "/browser/root",
      projectlessWorkspaceBrowserRoot: "/browser/root",
    });
    serviceInternals.persistThreadDetailSummary = () => {};

    try {
      await serviceInternals.resumeConversationRecord(threadId);
      const params = requests[1]?.params as Record<string, unknown>;
      expect(params.cwd).toBe("/browser/root");
      expect(params.permissions).toBe(":workspace");
      expect(JSON.stringify(params.runtimeWorkspaceRoots)).toBe(JSON.stringify(["/browser/root"]));
    } finally {
      await service.shutdown();
    }
  });

  test("resume returns before goal hydration, then publishes a revision-guarded goal with null confirmation", async () => {
    const service = createService();
    const threadId = "thr_async_goal_resume";
    let resolveGoal: (value: unknown) => void = () => {
      throw new Error("goal gate was not initialized");
    };
    const goalGate = new Promise<unknown>((resolve) => {
      resolveGoal = resolve;
    });
    let goalRequestStarted = false;
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      parseThreadRef: (id: string) => Record<string, unknown> | null;
      getThreadLinkSafely: (id: string) => { cwd: string; archived: boolean } | null;
      maybeResolveProjectRuntimeContext: (projectId: string) => {
        workspaceRoots: string[];
        primaryWorkspaceRoot: string;
      };
      upsertLinkFromThread: () => null;
      buildThreadDetailFromCanonicalState: () => CodexThreadDetail;
      persistThreadDetailSummary: (detail: CodexThreadDetail) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      projectId: "project-async-goal",
      cwd: "/workspace/project",
    });
    serviceInternals.parseThreadRef = () => ({
      projectId: "project-async-goal",
      cwd: "/workspace/project",
      projectlessWorkspaceBrowserRoot: null,
    });
    serviceInternals.getThreadLinkSafely = () => ({
      cwd: "/workspace/project",
      archived: false,
    });
    serviceInternals.maybeResolveProjectRuntimeContext = () => ({
      workspaceRoots: ["/workspace/project"],
      primaryWorkspaceRoot: "/workspace/project",
    });
    serviceInternals.upsertLinkFromThread = () => null;
    serviceInternals.buildThreadDetailFromCanonicalState = () => ({
      ...makeThreadDetail(threadId),
      projectId: "project-async-goal",
      cwd: "/workspace/project",
    });
    serviceInternals.persistThreadDetailSummary = () => {};
    client.start = async () => undefined;
    client.request = async (method) => {
      if (method === "thread/read") {
        return { thread: makeProtocolThread(threadId, "/workspace/project", []) };
      }
      if (method === "thread/resume") {
        return makeCanonicalResumeResponse({
          threadId,
          initialTurnsPage: {
            data: [],
            nextCursor: null,
            backwardsCursor: null,
          },
        });
      }
      if (method === "thread/goal/get") {
        goalRequestStarted = true;
        return await goalGate;
      }
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      const resumed = await service.requestConversationResume(threadId);
      expect(goalRequestStarted).toBe(true);
      expect(resumed?.threadGoal ?? null).toBe(null);

      resolveGoal({
        goal: {
          threadId,
          objective: "Ship async goal hydration",
          status: "paused",
          tokenBudget: 40000,
          tokensUsed: 120,
          timeUsedSeconds: 45,
          createdAt: 10,
          updatedAt: 20,
        },
      });
      await waitForCondition(
        () => service.serializeConversationSnapshot(threadId)?.threadGoal?.status === "paused",
        250,
      );
      const hydrated = service.serializeConversationSnapshot(threadId);
      expect(hydrated?.threadGoal?.objective ?? "").toBe("Ship async goal hydration");
      expect(hydrated?.threadGoalResumeConfirmation ?? null).toBe(null);
      expect(hydrated?.threadGoal?.status ?? "").toBe("paused");
    } finally {
      await service.shutdown();
    }
  });

  test("late goal hydration cannot overwrite a newer conversation revision", async () => {
    const service = createService();
    const threadId = "thr_stale_goal_hydration";
    let resolveGoal: (value: unknown) => void = () => {
      throw new Error("goal gate was not initialized");
    };
    const goalGate = new Promise<unknown>((resolve) => {
      resolveGoal = resolve;
    });
    const serviceInternals = service as unknown as {
      hydrateCanonicalConversationState: (
        input: ThreadResumeResponse,
      ) => CodexCanonicalConversationState;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      hydrateThreadGoalAfterResume: (id: string, expectedRevision: number) => Promise<void>;
      syncDormantConversationFromRecord: (id: string, reason: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method) => {
      if (method === "thread/goal/get") return await goalGate;
      throw new Error(`Unexpected client request: ${method}`);
    };
    serviceInternals.setConversationRecordDetail(makeThreadDetail(threadId));
    serviceInternals.hydrateCanonicalConversationState(
      makeCanonicalResumeResponse({
        threadId,
        initialTurnsPage: null,
      }),
    );

    try {
      const hydration = serviceInternals.hydrateThreadGoalAfterResume(threadId, 0);
      await Promise.resolve();
      serviceInternals.syncDormantConversationFromRecord(threadId, "explicit-resync");
      resolveGoal({
        goal: {
          threadId,
          objective: "Stale goal",
          status: "paused",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 10,
          updatedAt: 20,
        },
      });
      await hydration;
      expect(service.serializeConversationSnapshot(threadId)?.threadGoal ?? null).toBe(null);
    } finally {
      await service.shutdown();
    }
  });

  test("answers currentTime immediately while resume notifications remain buffered", async () => {
    const service = createService();
    const threadId = "thr_resume_request_order";
    const order: string[] = [];
    const serviceInternals = service as unknown as {
      beginResumeNotificationBuffer: (threadId: string) => void;
      replayBufferedResumeNotifications: (threadId: string) => Promise<void>;
      handleNotification: (
        notification: CodexTestServerNotification,
        options?: { bypassResumeBuffer?: boolean },
      ) => Promise<void>;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      handleServerRequestNow: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      hasResumeNotificationBuffer: (id: string) => boolean;
    };
    const originalHandleNotification = serviceInternals.handleNotification.bind(service);
    const originalHandleServerRequestNow = serviceInternals.handleServerRequestNow.bind(service);

    serviceInternals.handleNotification = async (notification, options) => {
      if (!serviceInternals.hasResumeNotificationBuffer(threadId)) {
        order.push(`notification:${notification.method}`);
      }
      return originalHandleNotification(notification, options);
    };
    serviceInternals.handleServerRequestNow = async (request) => {
      order.push(`request:${request.method}`);
      return originalHandleServerRequestNow(request);
    };

    try {
      serviceInternals.beginResumeNotificationBuffer(threadId);
      await serviceInternals.handleNotification({
        method: "item/reasoning/summaryPartAdded",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "reasoning-1",
          summaryIndex: 0,
        },
      });
      const requestPromise = serviceInternals.handleServerRequest({
        id: "time_req",
        method: "currentTime/read",
        params: { threadId },
      });
      await serviceInternals.handleNotification({
        method: "item/mcpToolCall/progress",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "mcp-1",
          message: "Still working",
        },
      });

      const result = await requestPromise;
      expect((result as { currentTimeAt?: number }).currentTimeAt !== undefined).toBe(true);
      expect(order.join(",")).toBe("request:currentTime/read");

      await serviceInternals.replayBufferedResumeNotifications(threadId);

      expect(order.join(",")).toBe(
        "request:currentTime/read,notification:item/reasoning/summaryPartAdded,notification:item/mcpToolCall/progress",
      );
    } finally {
      await service.shutdown();
    }
  });

  test("removes the resume buffer before replay so nested notifications dispatch live", async () => {
    const service = createService();
    const threadId = "thr_resume_live_nested";
    const order: string[] = [];
    const serviceInternals = service as unknown as {
      beginResumeNotificationBuffer: (id: string) => void;
      replayBufferedResumeNotifications: (id: string) => Promise<void>;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      hasResumeNotificationBuffer: (id: string) => boolean;
    };

    try {
      serviceInternals.beginResumeNotificationBuffer(threadId);
      await serviceInternals.handleNotification({
        method: "item/reasoning/summaryPartAdded",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "reasoning-1",
          summaryIndex: 0,
        },
      });
      await serviceInternals.handleNotification({
        method: "item/mcpToolCall/progress",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "mcp-old-tail",
          message: "old tail",
        },
      });

      const originalHandleNotification = serviceInternals.handleNotification.bind(service);
      let didInjectNestedNotification = false;
      serviceInternals.handleNotification = async (notification) => {
        if (!serviceInternals.hasResumeNotificationBuffer(threadId)) {
          order.push(
            `${notification.method}:${(notification.params as { itemId?: string }).itemId ?? ""}`,
          );
        }
        await originalHandleNotification(notification);
        if (
          notification.method !== "item/reasoning/summaryPartAdded" ||
          didInjectNestedNotification
        )
          return;

        didInjectNestedNotification = true;
        await serviceInternals.handleNotification({
          method: "item/mcpToolCall/progress",
          params: {
            threadId,
            turnId: "turn-1",
            itemId: "mcp-live-nested",
            message: "live nested",
          },
        });
      };

      await serviceInternals.replayBufferedResumeNotifications(threadId);

      expect(order.join(",")).toBe(
        "item/reasoning/summaryPartAdded:reasoning-1," +
          "item/mcpToolCall/progress:mcp-live-nested," +
          "item/mcpToolCall/progress:mcp-old-tail",
      );
      expect(serviceInternals.hasResumeNotificationBuffer(threadId)).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("resume replay dedupe aggregates full deltas and reads the first exact canonical raw slot", async () => {
    const service = createService();
    const threadId = "thr_exact_resume_dedupe";
    const turn: Turn = {
      id: "turn-exact-resume-dedupe",
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      items: [
        {
          id: "shared-agent",
          type: "enteredReviewMode",
          review: "same id, different type",
        },
        {
          id: "shared-agent",
          type: "agentMessage",
          text: "a",
          phase: null,
          memoryCitation: null,
        },
        {
          id: "shared-agent",
          type: "agentMessage",
          text: "ends-with-abc",
          phase: null,
          memoryCitation: null,
        },
        {
          id: "command-1",
          type: "commandExecution",
          pluginId: null,
          scriptPath: null,
          command: "printf hello",
          cwd: "/workspace/project",
          processId: null,
          source: "agent",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: "prefix-hello",
          exitCode: null,
          durationMs: null,
        },
      ],
    };
    const response = makeCanonicalResumeResponse({
      threadId,
      threadTurns: [turn],
      initialTurnsPage: null,
    });
    const serviceInternals = service as unknown as {
      hydrateCanonicalConversationState: (
        input: ThreadResumeResponse,
        options?: Record<string, unknown>,
      ) => CodexCanonicalConversationState;
      compactBufferedConversationEvents: (
        id: string,
        events: Array<{ type: "notification"; notification: CodexTestServerNotification }>,
      ) => Array<{ type: "notification"; notification: CodexTestServerNotification }>;
    };
    serviceInternals.hydrateCanonicalConversationState(response);

    const replay = serviceInternals.compactBufferedConversationEvents(threadId, [
      {
        type: "notification",
        notification: {
          method: "item/agentMessage/delta",
          params: {
            threadId,
            turnId: turn.id,
            itemId: "shared-agent",
            delta: "a",
          },
        },
      },
      {
        type: "notification",
        notification: {
          method: "item/agentMessage/delta",
          params: {
            threadId,
            turnId: turn.id,
            itemId: "shared-agent",
            delta: "bc",
          },
        },
      },
      {
        type: "notification",
        notification: {
          method: "item/commandExecution/outputDelta",
          params: {
            threadId,
            turnId: turn.id,
            itemId: "command-1",
            delta: "he",
          },
        },
      },
      {
        type: "notification",
        notification: {
          method: "item/commandExecution/outputDelta",
          params: {
            threadId,
            turnId: turn.id,
            itemId: "command-1",
            delta: "llo",
          },
        },
      },
    ]);
    const replayedDeltas = replay.map(
      (event) => (event.notification.params as { delta?: string }).delta ?? "",
    );
    expect(replayedDeltas.join("|")).toBe("a|bc");

    await service.shutdown();
  });

  test("resume keeps the initial page on pre-resume model context while advancing latest settings", async () => {
    const service = createService();
    const threadId = "thr_resume_model_context_split";
    const response = makeCanonicalResumeResponse({
      threadId,
      threadTurns: [makeCanonicalHydrationTurn("turn-model-context")],
      initialTurnsPage: null,
      model: "gpt-response",
    });
    const serviceInternals = service as unknown as {
      hydrateCanonicalConversationState: (
        input: ThreadResumeResponse,
        options: Record<string, unknown>,
      ) => CodexCanonicalConversationState;
    };

    try {
      const canonical = serviceInternals.hydrateCanonicalConversationState(response, {
        historyModel: "gpt-before-resume",
        historyReasoningEffort: "low",
        latestModel: "gpt-response",
        latestReasoningEffort: "high",
        turns: response.thread.turns,
      });
      expect(canonical.turns[0]?.sidecar.params.model).toBe("gpt-before-resume");
      expect(canonical.turns[0]?.sidecar.params.effort).toBe("low");
      expect(canonical.sidecar.hydrationContext?.latestModel ?? "").toBe("gpt-response");
      expect(canonical.sidecar.hydrationContext?.latestReasoningEffort ?? null).toBe("high");
      expect(canonical.sidecar.hydrationContext?.latestThreadSettings?.model ?? "").toBe(
        "gpt-response",
      );
      expect(canonical.sidecar.hydrationContext?.latestThreadSettings?.serviceTier ?? null).toBe(
        null,
      );
      expect(canonical.sidecar.hydrationContext?.latestThreadSettings?.multiAgentMode ?? null).toBe(
        "explicitRequestOnly",
      );
      expect(canonical.sidecar.latestThreadSettings?.model ?? "").toBe("gpt-response");
      expect(canonical.sidecar.latestThreadSettings?.modelProvider ?? "").toBe("openai");
      expect(canonical.sidecar.latestThreadSettings?.effort ?? null).toBe("high");
    } finally {
      await service.shutdown();
    }
  });

  test("defers early thread-started notifications until creation context is ready from bundle 46730-47020 and 50470-50520", async () => {
    const service = createService();
    const replayedThreadIds: string[] = [];
    const serviceInternals = service as unknown as {
      beginThreadStartNotificationDeferral: () => void;
      completeThreadStartNotificationDeferral: (threadId: string | null) => Promise<void>;
      endThreadStartNotificationDeferral: () => Promise<void>;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      replayBufferedConversationNotification: (input: {
        phase: "resume" | "thread-start";
        threadId: string;
        notification: CodexTestServerNotification;
      }) => Promise<void>;
    };
    const originalReplay = serviceInternals.replayBufferedConversationNotification.bind(service);

    serviceInternals.replayBufferedConversationNotification = async (input) => {
      if (input.phase === "thread-start") replayedThreadIds.push(input.threadId);
    };

    try {
      serviceInternals.beginThreadStartNotificationDeferral();
      await serviceInternals.handleNotification({
        method: "thread/started",
        params: {
          thread: {
            id: "thr_deferred_creation_context",
            parentThreadId: null,
            preview: "Started before creation context is ready",
            ephemeral: false,
            cwd: "/tmp/codex",
          },
        },
      });

      expect(replayedThreadIds.join(",")).toBe("");
      const currentTime = await serviceInternals.handleServerRequest({
        id: "time-during-thread-start-deferral",
        method: "currentTime/read",
        params: { threadId: "thr_deferred_creation_context" },
      });
      expect((currentTime as { currentTimeAt?: number }).currentTimeAt !== undefined).toBe(true);
      expect(replayedThreadIds.join(",")).toBe("");

      await serviceInternals.completeThreadStartNotificationDeferral(
        "thr_deferred_creation_context",
      );

      expect(replayedThreadIds.join(",")).toBe("thr_deferred_creation_context");
    } finally {
      serviceInternals.replayBufferedConversationNotification = originalReplay;
      await serviceInternals.endThreadStartNotificationDeferral();
      await service.shutdown();
    }
  });

  test("nested resume release moves notifications and requests into the outer thread-start deferral", async () => {
    const service = createService();
    const threadId = "thr_nested_resume_deferral";
    const order: string[] = [];
    const serviceInternals = service as unknown as {
      beginThreadStartNotificationDeferral: () => void;
      completeThreadStartNotificationDeferral: (id: string | null) => Promise<void>;
      endThreadStartNotificationDeferral: () => Promise<void>;
      beginResumeNotificationBuffer: (id: string) => void;
      replayBufferedResumeNotifications: (id: string) => Promise<void>;
      handleNotification: (
        notification: CodexTestServerNotification,
        options?: { bypassResumeBuffer?: boolean },
      ) => Promise<void>;
      handleServerRequest: (request: {
        id: string;
        method: string;
        params: { threadId: string };
      }) => Promise<unknown>;
      handleServerRequestNow: (request: {
        id: string;
        method: string;
        params: { threadId: string };
      }) => Promise<unknown>;
      upsertSidebarThreadFromAppServerThread: () => null;
      replayBufferedConversationNotification: (input: {
        phase: "resume" | "thread-start";
        threadId: string;
        notification: CodexTestServerNotification;
      }) => Promise<void>;
    };
    const originalReplayNotification =
      serviceInternals.replayBufferedConversationNotification.bind(service);
    const originalHandleServerRequestNow = serviceInternals.handleServerRequestNow.bind(service);
    serviceInternals.upsertSidebarThreadFromAppServerThread = () => null;
    serviceInternals.replayBufferedConversationNotification = async (input) => {
      await originalReplayNotification(input);
      if (input.phase === "thread-start" && input.notification.method !== "thread/started") {
        order.push(`notification:${input.notification.method}`);
      }
    };
    serviceInternals.handleServerRequestNow = async (request) => {
      if (request.method === "currentTime/read") {
        return originalHandleServerRequestNow(request);
      }
      order.push(`request:${request.method}`);
      return { handled: true };
    };

    try {
      serviceInternals.beginThreadStartNotificationDeferral();
      await serviceInternals.handleNotification({
        method: "thread/started",
        params: {
          thread: {
            ...makeProtocolThread(threadId, "/workspace/project", []),
          },
        },
      });
      serviceInternals.beginResumeNotificationBuffer(threadId);
      await serviceInternals.handleNotification({
        method: "item/reasoning/summaryPartAdded",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "reasoning-1",
          summaryIndex: 0,
        },
      });
      let ordinaryRequestSettled = false;
      const ordinaryRequest = serviceInternals
        .handleServerRequest({
          id: "ordinary-request",
          method: "item/tool/requestUserInput",
          params: { threadId },
        })
        .then((value) => {
          ordinaryRequestSettled = true;
          return value;
        });
      const currentTime = await serviceInternals.handleServerRequest({
        id: "current-time-request",
        method: "currentTime/read",
        params: { threadId },
      });
      expect((currentTime as { currentTimeAt?: number }).currentTimeAt !== undefined).toBe(true);

      await serviceInternals.replayBufferedResumeNotifications(threadId);
      await Promise.resolve();
      expect(ordinaryRequestSettled).toBe(false);
      expect(order.join(",")).toBe("");

      await serviceInternals.completeThreadStartNotificationDeferral(threadId);
      await ordinaryRequest;
      expect(order.join(",")).toBe(
        "notification:item/reasoning/summaryPartAdded,request:item/tool/requestUserInput",
      );
    } finally {
      await serviceInternals.endThreadStartNotificationDeferral();
      await service.shutdown();
    }
  });

  test("publishes normalized host app catalog updates from app-server notifications", async () => {
    const service = createService({ supportsChatGptApps: true });
    const events: CodexEvent[] = [];
    service.on("event", (event) => events.push(event));
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      await serviceInternals.handleNotification({
        method: "app/list/updated",
        params: {
          data: [
            {
              id: "connector_docs",
              name: "Docs",
              description: null,
              logoUrl: null,
              logoUrlDark: null,
              iconAssets: { "256_square": " /assets/docs.png " },
              iconDarkAssets: null,
              distributionChannel: null,
              branding: null,
              appMetadata: null,
              labels: null,
              installUrl: "https://apps.example.test/install",
              isAccessible: true,
              isEnabled: true,
              pluginDisplayNames: [],
            },
          ],
        },
      });

      const update = events.find(
        (event): event is Extract<CodexEvent, { type: "appsUpdated" }> =>
          event.type === "appsUpdated",
      );
      expect(update?.apps[0]?.logoUrl).toBe("https://apps.example.test/assets/docs.png");
      expect(update?.apps[0]?.logoUrlDark).toBe("https://apps.example.test/assets/docs.png");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service edit-last-user-turn and fork-from-turn", () => {
  test("fork-from-turn uses full fork, seeded resume, child rollback, a provenance marker, and caller title", async () => {
    const projectWorkspace = createTestProjectWorkspace();
    const persistedWritableRoots = new Map<string, readonly string[]>();
    const replaceThreadWritableRoots =
      projectWorkspace.replaceThreadWritableRoots.bind(projectWorkspace);
    projectWorkspace.replaceThreadWritableRoots = async (threadId, roots) => {
      persistedWritableRoots.set(threadId, [...roots]);
      return await replaceThreadWritableRoots(threadId, roots);
    };
    const service = createService({ projectWorkspace });
    const sourceThreadId = "thr_exact_fork_source";
    const childThreadId = "thr_exact_fork_child";
    const requests: Array<{ method: string; params: unknown }> = [];
    const order: string[] = [];
    const sourceTurns = [
      makeCanonicalHydrationTurn("turn_1"),
      makeCanonicalHydrationTurn("turn_2"),
      makeCanonicalHydrationTurn("turn_3"),
    ];
    const forkResponse = makeCanonicalForkResponse({
      threadId: childThreadId,
      cwd: "/workspace/project",
      turns: sourceTurns,
    });
    const sourceDetail: CodexThreadDetail = {
      ...makeThreadDetail(sourceThreadId),
      projectId: "project-exact-fork",
      threadName: "Exact fork source",
      cwd: "/workspace/project",
      turns: sourceTurns.map((turn) => ({
        threadId: sourceThreadId,
        turnId: turn.id,
        status: "completed",
        itemIds: turn.items.map((item) => item.id),
      })),
      transcript: [],
    };
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      parseThreadRef: (id: string) => Record<string, unknown> | null;
      maybeResolveProjectRuntimeContext: (projectId: string) => {
        workspaceRoots: string[];
        primaryWorkspaceRoot: string;
      };
      upsertLinkFromThread: () => null;
      buildThreadDetailFromRead: (thread: Thread) => CodexThreadDetail;
      buildThreadDetailFromCanonicalState: (
        state: CodexCanonicalConversationState,
      ) => CodexThreadDetail;
      persistThreadDetailSummary: (detail: CodexThreadDetail) => void;
      applyThreadNameLocal: (id: string, name: string) => void;
      beginThreadStartNotificationDeferral: () => void;
      completeThreadStartNotificationDeferral: (threadId: string | null) => Promise<void>;
      endThreadStartNotificationDeferral: () => Promise<void>;
      appendForkedFromConversationMarker: (
        targetThreadId: string,
        sourceThreadId: string,
        sourceTitle: string | null,
      ) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    serviceInternals.setConversationRecordDetail(sourceDetail);
    serviceInternals.parseThreadRef = () => ({
      projectId: "project-exact-fork",
      cwd: "/workspace/project",
      projectlessWorkspaceBrowserRoot: null,
    });
    serviceInternals.maybeResolveProjectRuntimeContext = () => ({
      workspaceRoots: ["/workspace/project", "/workspace/shared"],
      primaryWorkspaceRoot: "/workspace/project",
    });
    serviceInternals.upsertLinkFromThread = () => null;
    serviceInternals.buildThreadDetailFromRead = (thread) => ({
      ...makeThreadDetail(thread.id),
      projectId: "project-exact-fork",
      threadName: thread.name,
      cwd: thread.cwd,
      turns: thread.turns.map((turn) => ({
        threadId: thread.id,
        turnId: turn.id,
        status: turn.status === "inProgress" ? "inProgress" : "completed",
        itemIds: turn.items.map((item) => item.id),
      })),
      transcript: [],
    });
    serviceInternals.buildThreadDetailFromCanonicalState = (state) =>
      makeCanonicalStateDetailFixture(state, { projectId: "project-exact-fork" });
    serviceInternals.persistThreadDetailSummary = () => {};
    serviceInternals.applyThreadNameLocal = (id, name) => {
      const detail = service.serializeThreadDetail(id);
      if (!detail) return;
      serviceInternals.setConversationRecordDetail({ ...detail, threadName: name });
    };
    const originalAppendForkMarker =
      serviceInternals.appendForkedFromConversationMarker.bind(service);
    serviceInternals.beginThreadStartNotificationDeferral = () => {
      order.push("deferral:begin");
    };
    serviceInternals.completeThreadStartNotificationDeferral = async () => {
      order.push("deferral:complete");
    };
    serviceInternals.endThreadStartNotificationDeferral = async () => {
      order.push("deferral:end");
    };
    serviceInternals.appendForkedFromConversationMarker = (...args) => {
      order.push("provenance:append");
      originalAppendForkMarker(...args);
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      order.push(`request:${method}`);
      if (method === "thread/fork") return forkResponse;
      if (method === "thread/read") {
        return { thread: { ...forkResponse.thread, turns: [] } };
      }
      if (method === "thread/resume") return makeCanonicalForkResumeResponse(forkResponse);
      if (method === "thread/goal/get") return { goal: null };
      if (method === "thread/rollback") {
        return {
          thread: {
            ...forkResponse.thread,
            turns: sourceTurns.slice(0, 2),
          },
        };
      }
      if (method === "thread/name/set") return {};
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      const result = await service.forkConversationFromTurn(
        sourceThreadId,
        "turn_2",
        "This text must not prefill the child composer",
      );
      const forkParams = requests[0]?.params as Record<string, unknown>;
      const rollbackParams = requests.find((request) => request.method === "thread/rollback")
        ?.params as Record<string, unknown>;
      const resumeParams = requests.find((request) => request.method === "thread/resume")
        ?.params as Record<string, unknown>;
      const canonical = getCanonicalConversationState(service, childThreadId);
      const marker = canonical?.turns.at(-1)?.items.at(-1);

      expect(requests.map((request) => request.method).join(",")).toBe(
        "thread/fork,thread/read,thread/resume,thread/goal/get,thread/rollback,thread/name/set",
      );
      expect(forkParams.path).toBe(null);
      expect(forkParams.threadSource).toBe("user");
      expect(Object.prototype.hasOwnProperty.call(forkParams, "lastTurnId")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(forkParams, "runtimeWorkspaceRoots")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(forkParams, "config")).toBe(true);
      expect(resumeParams.runtimeWorkspaceRoots).toEqual([
        "/workspace/project",
        "/workspace/shared",
      ]);
      expect(persistedWritableRoots.get(childThreadId)).toEqual([
        "/workspace/project",
        "/workspace/shared",
      ]);
      expect(forkParams.config).toMatchObject({
        "features.apply_patch_streaming_events": true,
        "features.thread_tools": true,
      });
      expect(rollbackParams.threadId).toBe(childThreadId);
      expect(rollbackParams.numTurns).toBe(1);
      expect(order.indexOf("deferral:begin") < order.indexOf("request:thread/fork")).toBe(true);
      expect(order.indexOf("deferral:complete") < order.indexOf("request:thread/rollback")).toBe(
        true,
      );
      expect(order.indexOf("deferral:end") < order.indexOf("request:thread/rollback")).toBe(true);
      expect(order.indexOf("request:thread/rollback") < order.indexOf("provenance:append")).toBe(
        true,
      );
      expect(result.composerIntent?.prompt ?? "missing").toBe("");
      expect(canonical?.turns.length ?? 0).toBe(2);
      expect(canonical?.turns.at(-1)?.protocol.id).toBe("turn_2");
      expect(marker?.type).toBe("forkedFromConversation");
      expect(marker && "sourceConversationId" in marker ? marker.sourceConversationId : null).toBe(
        sourceThreadId,
      );
      expect(
        marker && "sourceConversationTitle" in marker ? marker.sourceConversationTitle : null,
      ).toBe("Exact fork source");
      expect((requests.at(-1)?.params as { name?: string }).name ?? "").toBe(
        "Exact fork source (2)",
      );
      expect(service.serializeThreadDetail(childThreadId)?.threadName ?? "").toBe(
        "Exact fork source (2)",
      );
    } finally {
      await service.shutdown();
    }
  });

  test.each([
    {
      label: "Project owner when cwd moves outside every source",
      threadId: "thread-durable-project",
      existingProjectId: "project:durable",
      nextCwd: "/outside/every/project",
    },
    {
      label: "explicit Projectless owner when cwd enters a Project source",
      threadId: "thread-durable-projectless",
      existingProjectId: null,
      nextCwd: "/Users/test/Documents/Nodex/My Project/nested",
    },
  ])("sidebar refresh preserves $label", async ({ threadId, existingProjectId, nextCwd }) => {
    const baseWorkspace = createTestProjectWorkspace();
    const existing = await baseWorkspace.upsertThread(threadId, {
      projectId: existingProjectId,
      threadName: threadId,
      threadPreview: threadId,
      modelProvider: "openai",
      cwd: "/previous/cwd",
      status: { statusType: "idle", activeFlags: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    const upsertPatches: Array<Parameters<DesktopProjectWorkspacePort["upsertThread"]>[1]> = [];
    const moveInputs: Array<Parameters<DesktopProjectWorkspacePort["moveThread"]>[0]> = [];
    const projectWorkspace = {
      ...baseWorkspace,
      getProjectSession: async (sessionId: string) => ({
        id: sessionId,
        projectId: existingProjectId,
      }),
      upsertThread: async (
        id: string,
        patch: Parameters<DesktopProjectWorkspacePort["upsertThread"]>[1],
      ) => {
        upsertPatches.push(patch);
        return await baseWorkspace.upsertThread(id, patch);
      },
      moveThread: async (input: Parameters<DesktopProjectWorkspacePort["moveThread"]>[0]) => {
        moveInputs.push(input);
        return await baseWorkspace.moveThread(input);
      },
    } as unknown as DesktopProjectWorkspacePort;
    const service = createService({ projectWorkspace });
    const internals = service as unknown as {
      upsertSidebarThreadFromAppServerThread: (
        thread: unknown,
        input: {
          projects: readonly Project[];
          includeArchived: boolean;
          reason: "manual";
        },
      ) => Promise<{ projectId: string | null; summary: CodexThreadSummary | null }>;
    };

    try {
      const result = await internals.upsertSidebarThreadFromAppServerThread(
        {
          id: threadId,
          name: threadId,
          preview: threadId,
          modelProvider: "openai",
          cwd: nextCwd,
          status: { type: "idle" },
          createdAt: 1,
          updatedAt: 2,
        },
        {
          projects: [
            makeProject({
              id: "project:durable",
              sources: [{ root: "/workspace/durable", order: 0 }],
              primaryWorkspaceRoot: "/workspace/durable",
            }),
            makeProject({
              id: "project:default",
              sources: [
                {
                  root: "/Users/test/Documents/Nodex/My Project",
                  order: 0,
                },
              ],
              primaryWorkspaceRoot: "/Users/test/Documents/Nodex/My Project",
            }),
          ],
          includeArchived: false,
          reason: "manual",
        },
      );

      expect(existing.sessionId).not.toBeNull();
      expect(result.summary?.projectId).toBe(existingProjectId);
      expect(result.projectId).toBe(existingProjectId);
      expect((await baseWorkspace.getThread(threadId))?.projectId).toBe(existingProjectId);
      expect(moveInputs).toEqual([]);
      expect(
        upsertPatches.some((patch) => Object.prototype.hasOwnProperty.call(patch, "projectId")),
      ).toBe(false);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service interrupt target resolution", () => {
  test("continues active thread goal after idle status in no-owner fallback", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        threadGoal: ThreadGoal | null;
        detail: CodexThreadDetail | null;
      };
      maybeContinueActiveThreadGoal: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const detail: CodexThreadDetail = {
      ...makeThreadDetail("thr_goal_continue"),
      cwd: "/tmp/goal-continue",
      statusType: "active",
      turns: [
        {
          threadId: "thr_goal_continue",
          turnId: "turn_done",
          status: "completed",
          itemIds: [],
        },
      ],
    };

    serviceInternals.setConversationRecordDetail(detail);
    const record = serviceInternals.getConversationRecord("thr_goal_continue");
    const aggregate = conversationAggregateForTest(service, "thr_goal_continue");
    aggregate.setResumeState("resumed");
    aggregate.setStreaming(true);
    setTestConversationStreamRole(service, "thr_goal_continue", "owner");
    record.threadGoal = {
      threadId: "thr_goal_continue",
      objective: "finish the migration",
      status: "active",
      tokenBudget: null,
      tokensUsed: 12,
      timeUsedSeconds: 34,
      createdAt: 1,
      updatedAt: 1,
    };

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/goal/set") {
        return {
          goal: {
            ...record.threadGoal,
            status: (params as ThreadGoalSetParams).status ?? "active",
            updatedAt: 2,
          },
        };
      }
      return {};
    };

    try {
      record.detail = record.detail
        ? { ...record.detail, statusType: "idle", statusActiveFlags: [] }
        : null;
      serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue");
      serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue");
      await waitForCondition(
        () => requests.some((request) => request.method === "thread/goal/set"),
        1_000,
      );

      const goalSetRequests = requests.filter((request) => request.method === "thread/goal/set");
      expect(goalSetRequests.length).toBe(1);
      expect((goalSetRequests[0]?.params as { threadId?: string })?.threadId).toBe(
        "thr_goal_continue",
      );
      expect((goalSetRequests[0]?.params as { status?: string })?.status).toBe("active");
      expect(record.detail?.statusType).toBe("idle");
    } finally {
      await service.shutdown();
    }
  });

  test("falls back to an empty turn when active goal continuation cannot use settings update", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        threadGoal: ThreadGoal | null;
        detail: CodexThreadDetail | null;
      };
      maybeContinueActiveThreadGoal: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const detail: CodexThreadDetail = {
      ...makeThreadDetail("thr_goal_continue_fallback"),
      cwd: "/tmp/goal-continue-fallback",
      statusType: "active",
      turns: [
        {
          threadId: "thr_goal_continue_fallback",
          turnId: "turn_done",
          status: "completed",
          itemIds: [],
        },
      ],
    };

    const threadSettingsRuntime = Reflect.get(
      service as object,
      "threadSettingsRuntime",
    ) as TestCodexThreadSettingsRuntime;
    threadSettingsRuntime.recordRemoteUpdateUnsupported();
    serviceInternals.setConversationRecordDetail(detail);
    const record = serviceInternals.getConversationRecord("thr_goal_continue_fallback");
    const aggregate = conversationAggregateForTest(service, "thr_goal_continue_fallback");
    aggregate.setResumeState("resumed");
    aggregate.setStreaming(true);
    setTestConversationStreamRole(service, "thr_goal_continue_fallback", "owner");
    record.threadGoal = {
      threadId: "thr_goal_continue_fallback",
      objective: "finish the migration",
      status: "active",
      tokenBudget: null,
      tokensUsed: 12,
      timeUsedSeconds: 34,
      createdAt: 1,
      updatedAt: 1,
    };

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    };

    try {
      record.detail = record.detail
        ? { ...record.detail, statusType: "idle", statusActiveFlags: [] }
        : null;
      void serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue_fallback");

      await waitForCondition(
        () => requests.some((request) => request.method === "turn/start"),
        1_000,
      );

      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      expect(requests.some((request) => request.method === "thread/goal/set")).toBe(false);
      expect((turnStartRequest?.params as { threadId?: string })?.threadId).toBe(
        "thr_goal_continue_fallback",
      );
      expect((turnStartRequest?.params as { cwd?: string })?.cwd).toBe(
        "/tmp/goal-continue-fallback",
      );
      expect(((turnStartRequest?.params as { input?: unknown[] })?.input ?? []).length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("waits for pending thread settings before active goal continuation", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        threadGoal: ThreadGoal | null;
        detail: CodexThreadDetail | null;
      };
      maybeContinueActiveThreadGoal: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const threadSettingsRuntime = Reflect.get(
      service as object,
      "threadSettingsRuntime",
    ) as TestCodexThreadSettingsRuntime;
    const requests: Array<{ method: string; params: unknown }> = [];
    const detail: CodexThreadDetail = {
      ...makeThreadDetail("thr_goal_continue_settings"),
      cwd: "/tmp/goal-continue-settings",
      statusType: "active",
      turns: [
        {
          threadId: "thr_goal_continue_settings",
          turnId: "turn_done",
          status: "completed",
          itemIds: [],
        },
      ],
    };
    let resolveSettings: () => void = () => {};

    const heldSettingsMutation = threadSettingsRuntime.holdMutation(
      "thr_goal_continue_settings",
      async () =>
        await new Promise<void>((resolve) => {
          resolveSettings = resolve;
        }),
    );
    serviceInternals.setConversationRecordDetail(detail);
    const record = serviceInternals.getConversationRecord("thr_goal_continue_settings");
    const aggregate = conversationAggregateForTest(service, "thr_goal_continue_settings");
    aggregate.setResumeState("resumed");
    aggregate.setStreaming(true);
    setTestConversationStreamRole(service, "thr_goal_continue_settings", "owner");
    record.threadGoal = {
      threadId: "thr_goal_continue_settings",
      objective: "finish the migration",
      status: "active",
      tokenBudget: null,
      tokensUsed: 12,
      timeUsedSeconds: 34,
      createdAt: 1,
      updatedAt: 1,
    };

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {
        goal: {
          ...record.threadGoal,
          status: (params as ThreadGoalSetParams).status ?? "active",
          updatedAt: 2,
        },
      };
    };

    try {
      record.detail = record.detail
        ? { ...record.detail, statusType: "idle", statusActiveFlags: [] }
        : null;
      void serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue_settings");

      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(requests.some((request) => request.method === "thread/goal/set")).toBe(false);

      resolveSettings();

      await waitForCondition(
        () => requests.some((request) => request.method === "thread/goal/set"),
        1_000,
      );

      const goalSetRequest = requests.find((request) => request.method === "thread/goal/set");
      expect((goalSetRequest?.params as { status?: string })?.status).toBe("active");
    } finally {
      resolveSettings();
      await heldSettingsMutation;
      await service.shutdown();
    }
  });
});

describe("codex-service collaboration modes", () => {
  test("validates active-task identity and persists compatible intelligence updates", async () => {
    const service = createService();
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const persistedProfiles: unknown[] = [];
    const currentProfile = {
      providerId: "openai",
      modelId: "gpt-5.5",
      harnessId: null,
      reasoningEffort: "high",
      serviceTier: null,
    };
    let persistedCurrentProfile = currentProfile;
    const serviceInternals = service as unknown as {
      ensureConversationDetail: (threadId: string) => CodexThreadDetail | null;
      readWorkspaceThread: (threadId: string) => Promise<{
        modelProvider: string;
        executionProfile: typeof currentProfile;
      } | null>;
      resolveAgentExecutionProfile: (
        profile: typeof currentProfile,
      ) => Promise<typeof currentProfile | null>;
      listAgentProviderCatalog: () => Promise<AgentProviderCatalog>;
      updateWorkspaceThreadSummary: (
        threadId: string,
        patch: { executionProfile?: typeof currentProfile },
      ) => Promise<CodexThreadSummary | null>;
      emitSidebarCatalogChangedForThread: () => Promise<void>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params: params as Record<string, unknown> });
      return {};
    };
    serviceInternals.ensureConversationDetail("thr_profile_update");
    serviceInternals.readWorkspaceThread = async () => ({
      modelProvider: "openai",
      executionProfile: persistedCurrentProfile,
    });
    serviceInternals.resolveAgentExecutionProfile = async (profile) => profile;
    serviceInternals.listAgentProviderCatalog = async () => ({
      providers: [
        {
          id: "openai",
          displayName: "OpenAI",
          description: null,
          wireApi: "responses",
          credentialStatus: "runtimeManaged",
          supportedByNodex: true,
          isDefault: true,
          credentialEnvKey: null,
          recommendedHarnessId: null,
          models: [
            {
              providerId: "openai",
              modelId: "gpt-5.4",
              displayName: "GPT-5.4",
              description: null,
              hidden: false,
              isDefault: false,
              recommendedHarnessId: null,
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
              supportedServiceTiers: [],
              defaultServiceTier: null,
              inputCapabilities: ["text"],
              switchPolicy: "same-thread",
            },
            {
              providerId: "openai",
              modelId: "gpt-new-thread-only",
              displayName: "New task only",
              description: null,
              hidden: false,
              isDefault: false,
              recommendedHarnessId: null,
              supportedReasoningEfforts: [],
              defaultReasoningEffort: null,
              supportedServiceTiers: [],
              defaultServiceTier: null,
              inputCapabilities: ["text"],
              switchPolicy: "new-thread",
            },
            {
              providerId: "openai",
              modelId: "gpt-5.6",
              displayName: "GPT-5.6",
              description: null,
              hidden: false,
              isDefault: false,
              recommendedHarnessId: null,
              supportedReasoningEfforts: [
                {
                  value: "xhigh",
                  displayName: "Extra high",
                  description: null,
                },
              ],
              defaultReasoningEffort: "xhigh",
              supportedServiceTiers: [
                {
                  value: "fast",
                  displayName: "Fast",
                  description: null,
                },
              ],
              defaultServiceTier: "fast",
              inputCapabilities: ["text"],
              switchPolicy: "same-thread",
            },
          ],
        },
      ],
    });
    serviceInternals.updateWorkspaceThreadSummary = async (_threadId, patch) => {
      persistedProfiles.push(patch.executionProfile);
      if (patch.executionProfile) {
        persistedCurrentProfile = patch.executionProfile;
      }
      return {
        ...makeThreadDetail("thr_profile_update"),
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 1,
        linkedAt: "2026-07-28T00:00:00.000Z",
      };
    };
    serviceInternals.emitSidebarCatalogChangedForThread = async () => undefined;

    const nextProfile = {
      ...currentProfile,
      modelId: "gpt-5.4",
      reasoningEffort: "medium",
      serviceTier: "fast",
    };

    try {
      const settings = await updateThreadSettingsForTest(service, "thr_profile_update", {
        executionProfile: nextProfile,
      });
      const params = requests[0]?.params;
      expect(persistedProfiles).toEqual([nextProfile]);
      expect(params?.model).toBe("gpt-5.4");
      expect(params).not.toHaveProperty("modelProvider");
      expect(params?.effort).toBe("medium");
      expect(params?.serviceTier).toBe("fast");
      expect(settings.model).toBe("gpt-5.4");
      expect(settings.serviceTier).toBe("fast");

      await updateThreadSettingsForTest(service, "thr_profile_update", {
        executionProfile: {
          ...currentProfile,
          reasoningEffort: "xhigh",
        },
        executionProfileChange: "reasoningEffort",
      });
      expect(persistedProfiles[1]).toEqual({
        ...nextProfile,
        reasoningEffort: "xhigh",
      });

      await updateThreadSettingsForTest(service, "thr_profile_update", {
        executionProfile: {
          ...currentProfile,
          modelId: "gpt-5.6",
        },
        executionProfileChange: "model",
      });
      const latestProfile = {
        ...nextProfile,
        modelId: "gpt-5.6",
        reasoningEffort: "xhigh",
      };
      expect(persistedProfiles[2]).toEqual(latestProfile);

      await expect(
        updateThreadSettingsForTest(service, "thr_profile_update", {
          executionProfile: {
            ...nextProfile,
            modelId: "gpt-new-thread-only",
          },
        }),
      ).rejects.toThrow("Start a new thread");
      expect(persistedProfiles).toEqual([
        nextProfile,
        {
          ...nextProfile,
          reasoningEffort: "xhigh",
        },
        latestProfile,
      ]);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service Session Thread launch projections", () => {
  test("persists the exact bounded prompt fallback when generated title metadata is empty", async () => {
    const service = createService();
    const appliedTitles: string[] = [];
    const requests: Array<{ method: string; params: unknown }> = [];
    const serviceInternals = service as unknown as {
      applyThreadNameLocal: (threadId: string, title: string) => void;
      generateAndPersistThreadName: (
        threadId: string,
        titlePrompt: string,
        cwd: string | null,
      ) => Promise<void>;
      generateThreadTitleForPrompt: () => Promise<string | null>;
      hasThreadTitle: () => boolean;
    };
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    serviceInternals.hasThreadTitle = () => false;
    serviceInternals.generateThreadTitleForPrompt = async () => null;
    serviceInternals.applyThreadNameLocal = (_threadId, title) => {
      appliedTitles.push(title);
    };
    client.request = async (method, params) => {
      requests.push({ method, params });
      return {};
    };

    try {
      await serviceInternals.generateAndPersistThreadName(
        "thread-fallback-title",
        `# Build a refined migration plan with ${"careful details ".repeat(8)}`,
        "/workspace",
      );

      expect(appliedTitles[0]).toBe("Build a refined migration plan with careful details careful…");
      expect((requests[0]?.params as { name?: string } | undefined)?.name).toBe(appliedTitles[0]);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service pending worktree conversation ownership", () => {
  test("binds the started Thread to its reserved Project Session before replaying thread/started", async () => {
    const projectId = "project-pending-session-owner";
    const reservedSessionId = "session-pending-session-owner";
    const sourceWorkspaceRoot = "/workspace/pending-session-owner";
    const worktreeWorkspaceRoot = `${sourceWorkspaceRoot}/.nodex/worktrees/abcd/repo`;
    const threadId = "thread-pending-session-owner";
    const project = makeProject({
      id: projectId,
      name: "Pending session owner",
      sources: [{ root: sourceWorkspaceRoot, order: 0 }],
      primaryWorkspaceRoot: sourceWorkspaceRoot,
    });
    const baseWorkspace = createTestProjectWorkspace();
    const sessions = new Map<string, ProjectSession>();
    const ownerByThreadId = new Map<string, string>();
    const automaticallyCreatedSessionIds: string[] = [];
    const now = "2026-08-13T00:00:00.000Z";
    const makeSession = (
      id: string,
      input: { projectId: string | null; noThreadFallbackTitle: string },
    ): ProjectSession => ({
      id,
      projectId: input.projectId,
      noThreadFallbackTitle: input.noThreadFallbackTitle,
      displayTitle: input.noThreadFallbackTitle,
      order: sessions.size,
      pinned: false,
      pinnedOrder: null,
      archived: false,
      archivedAt: null,
      unread: false,
      thread: null,
      createdAt: now,
      updatedAt: now,
    });
    sessions.set(
      reservedSessionId,
      makeSession(reservedSessionId, {
        projectId,
        noThreadFallbackTitle: "New thread",
      }),
    );
    const projectWorkspace = {
      ...baseWorkspace,
      listProjects: async () => [project],
      getProject: async (candidateProjectId: string) =>
        candidateProjectId === projectId ? project : null,
      getProjectSession: async (sessionId: string) => sessions.get(sessionId) ?? null,
      createProjectSession: async (input: {
        projectId: string | null;
        noThreadFallbackTitle: string;
      }) => {
        const sessionId = `session-auto-${automaticallyCreatedSessionIds.length + 1}`;
        const session = makeSession(sessionId, input);
        automaticallyCreatedSessionIds.push(sessionId);
        sessions.set(sessionId, session);
        return session;
      },
      deleteProjectSession: async (sessionId: string) => sessions.delete(sessionId),
      getThread: async (candidateThreadId: string) => {
        const thread = await baseWorkspace.getThread(candidateThreadId);
        if (!thread) return null;
        return {
          ...thread,
          sessionId: ownerByThreadId.get(candidateThreadId) ?? null,
        };
      },
      upsertProjectSessionThreadLink: async (
        input: Parameters<DesktopProjectWorkspacePort["upsertProjectSessionThreadLink"]>[0],
      ) => {
        const existingOwner = ownerByThreadId.get(input.threadId);
        if (existingOwner && existingOwner !== input.sessionId) {
          throw new Error("Codex Thread is already linked to another Project Session");
        }
        const session = sessions.get(input.sessionId);
        if (!session) throw new Error(`Project session not found: ${input.sessionId}`);
        const link = await baseWorkspace.upsertProjectSessionThreadLink(input);
        ownerByThreadId.set(input.threadId, input.sessionId);
        sessions.set(input.sessionId, {
          ...session,
          thread: link,
          displayTitle: (link.threadName ?? link.threadPreview) || session.displayTitle,
          updatedAt: now,
        });
        return link;
      },
    } as DesktopProjectWorkspacePort;
    const service = createService({ projectWorkspace });
    const runtime = Reflect.get(service as object, "pendingWorktreeRuntime") as {
      readonly dependencies: {
        createWorktree: () => Promise<{
          readonly worktreeGitRoot: string;
          readonly worktreeWorkspaceRoot: string;
        }>;
      };
      resolveThread: (
        clientThreadId: string,
      ) => { readonly state: "waiting" | "failed" | "succeeded" } | null;
    };
    runtime.dependencies.createWorktree = async () => ({
      worktreeGitRoot: worktreeWorkspaceRoot,
      worktreeWorkspaceRoot,
    });
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: string[] = [];
    client.start = async () => undefined;
    client.request = async (method) => {
      requests.push(method);
      if (method === "thread/start") {
        const response = makeCanonicalForkResponse({
          threadId,
          cwd: worktreeWorkspaceRoot,
          turns: [],
          runtimeWorkspaceRoots: [worktreeWorkspaceRoot],
        });
        await serviceInternals.handleNotification({
          method: "thread/started",
          params: { thread: response.thread },
        });
        return response;
      }
      if (method === "turn/start") {
        return { turn: makeCanonicalHydrationTurn("turn-pending-session-owner") };
      }
      throw new Error(`Unexpected request: ${method}`);
    };

    try {
      const created = service.createPendingWorktree({
        hostId: "local",
        label: "Pending session owner",
        sourceWorkspaceRoot,
        startingState: { type: "branch", branchName: "main" },
        localEnvironmentConfigPath: null,
        launchMode: "start-conversation",
        prompt: "Start in the reserved session",
        startConversationParamsInput: {
          input: [
            {
              type: "text",
              text: "Start in the reserved session",
              text_elements: [],
            },
          ],
          commentAttachments: [],
          workspaceRoots: [sourceWorkspaceRoot],
          cwd: sourceWorkspaceRoot,
          fileAttachments: [],
          addedFiles: [],
          agentMode: "auto",
          shouldSendPermissionOverrides: false,
          model: null,
          serviceTier: null,
          reasoningEffort: null,
          collaborationMode: null,
          config: {},
          threadSource: "user",
          workspaceKind: "project",
          projectAssignment: {
            projectKind: "local",
            projectId,
            pendingCoreUpdate: false,
          },
        },
        projectSessionId: reservedSessionId,
        skipAutoTitleGeneration: true,
        sourceConversationId: null,
        sourceCollaborationMode: null,
      });
      if (!created.clientThreadId) throw new Error("Expected a pending client Thread id");
      await waitForCondition(
        () =>
          requests.includes("turn/start") ||
          runtime.resolveThread(created.clientThreadId ?? "")?.state === "failed",
        2_000,
      );

      expect(requests.includes("turn/start")).toBe(true);
      expect(ownerByThreadId.get(threadId)).toBe(reservedSessionId);
      expect(automaticallyCreatedSessionIds).toEqual([]);
      expect(sessions.get(reservedSessionId)?.thread?.threadId).toBe(threadId);
      expect(sessions.get(reservedSessionId)?.thread?.executionHostId).toBe("local");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service pending goal draft lifecycle", () => {
  type ManagedGoalSource = Awaited<ReturnType<PastedTextAttachmentManager["createRawSource"]>>;
  type PendingGoalStartCreateInput = Extract<
    CodexPendingWorktreeCreateInput,
    { readonly launchMode: "start-conversation" }
  >;

  interface PendingGoalLaunchInput {
    readonly firstTurnAttachments: readonly { readonly path: string }[];
    readonly firstTurnInput: readonly { readonly type: string; readonly text?: string }[];
    readonly managedWorktreePath: string | null;
    readonly onThreadCreated: (threadId: string) => void;
    readonly target: {
      readonly cwd: string;
      readonly workspaceRoots: readonly string[];
    };
    readonly worktreeInit?: unknown;
  }

  interface PendingGoalServiceInternals {
    getPastedTextAttachmentManager: () => Promise<PastedTextAttachmentManager>;
    getThreadGoalDirectoryManager: () => Promise<ThreadGoalAttachmentDirectoryManager>;
    startDynamicCreatedConversation: (
      input: PendingGoalLaunchInput,
      options?: { readonly persistClientThreadIdentity?: boolean },
    ) => Promise<{ readonly threadId: string }>;
    persistClientThreadIdentity: (threadId: string, clientThreadId: string) => void;
    applyPendingWorktreeConversationMetadata: (input: unknown) => Promise<void>;
    applyStartedSessionThreadGoal: (input: {
      readonly threadId: string;
      readonly objective: string;
      readonly rawDraft: {
        readonly objective: string;
        readonly pastedTextAttachments: readonly ManagedGoalSource[];
        readonly imageAttachments: readonly [];
      } | null;
    }) => Promise<void>;
    createPendingWorktreeHeartbeat: (entry: CodexPendingWorktreeEntry, threadId: string) => void;
    materializePendingWorktreeGoal: (entry: CodexPendingWorktreeEntry) => Promise<unknown>;
  }

  interface PendingGoalRuntime {
    readonly dependencies: {
      createWorktree: (
        entry: CodexPendingWorktreeEntry,
        context: {
          readonly signal: AbortSignal;
          readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
        },
      ) => Promise<{
        readonly worktreeGitRoot: string;
        readonly worktreeWorkspaceRoot: string;
        readonly setupError?: string | null;
      }>;
    };
    resolveThread: (clientThreadId: string) => {
      readonly state: "waiting" | "failed" | "succeeded";
      readonly threadId?: string;
    } | null;
  }

  interface PendingGoalLifecycleService {
    createPendingWorktree: (input: CodexPendingWorktreeCreateInput) => {
      readonly pendingWorktreeId: string;
      readonly clientThreadId: string | null;
    };
    retryPendingWorktree: (hostId: string, pendingWorktreeId: string) => void;
    workLocallyFromPendingWorktree: (
      hostId: string,
      pendingWorktreeId: string,
    ) => Promise<{ readonly threadId: string }>;
  }

  function pendingGoalInternals(service: TestableCodexService): PendingGoalServiceInternals {
    return service as unknown as PendingGoalServiceInternals;
  }

  function pendingGoalRuntime(service: TestableCodexService): PendingGoalRuntime {
    return Reflect.get(service as object, "pendingWorktreeRuntime") as PendingGoalRuntime;
  }

  function pendingGoalLifecycle(service: TestableCodexService): PendingGoalLifecycleService {
    return service as unknown as PendingGoalLifecycleService;
  }

  function pendingGoalCreateInput(
    source: ManagedGoalSource,
    sourceWorkspaceRoot = "/repo/source",
  ): PendingGoalStartCreateInput {
    return {
      hostId: "local",
      label: "Pending goal lifecycle",
      sourceWorkspaceRoot,
      startingState: { type: "branch", branchName: "main" },
      localEnvironmentConfigPath: null,
      prompt: "Original frozen pending prompt",
      launchMode: "start-conversation",
      startConversationParamsInput: {
        input: [
          {
            type: "text",
            text: "Original frozen pending input",
            text_elements: [],
          },
        ],
        commentAttachments: [],
        workspaceRoots: [sourceWorkspaceRoot],
        cwd: sourceWorkspaceRoot,
        fileAttachments: [
          {
            label: "ordinary.txt",
            path: "ordinary.txt",
            fsPath: path.join(sourceWorkspaceRoot, "ordinary.txt"),
          },
          { ...source.file },
        ],
        addedFiles: [
          {
            label: "added.txt",
            path: "added.txt",
            fsPath: path.join(sourceWorkspaceRoot, "added.txt"),
          },
        ],
        agentMode: "auto",
        shouldSendPermissionOverrides: true,
        model: null,
        serviceTier: null,
        reasoningEffort: null,
        collaborationMode: null,
        config: {},
        threadSource: "user",
        workspaceKind: "project",
        projectAssignment: {
          projectKind: "local",
          projectId: "project-pending-goal-lifecycle",
          path: sourceWorkspaceRoot,
          pendingCoreUpdate: false,
        },
      },
      projectSessionId: "session-pending-goal-lifecycle",
      threadStartHostId: "local",
      threadGoalDraft: {
        objective: "Keep pursuing the exact goal",
        pastedTextAttachments: [source],
        imageAttachments: [],
      },
      heartbeatAutomation: {
        name: "Pending goal heartbeat",
        prompt: "Check the goal",
        rrule: "FREQ=HOURLY",
      },
      sourceConversationId: null,
      sourceCollaborationMode: null,
    };
  }

  function directoryContaining(attachmentsRoot: string, filename: string): string | null {
    const entries = fs.existsSync(attachmentsRoot)
      ? fs.readdirSync(attachmentsRoot, { withFileTypes: true })
      : [];
    const match = entries.find(
      (entry) =>
        entry.isDirectory() && fs.existsSync(path.join(attachmentsRoot, entry.name, filename)),
    );
    return match ? path.join(attachmentsRoot, match.name) : null;
  }

  function createGate(): { readonly promise: Promise<void>; readonly release: () => void } {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  test("retries registry-owned pending removals when the service starts", async () => {
    const attachmentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-goal-startup-cleanup-"));
    const ownedDirectory = path.join(attachmentsRoot, "550e8400-e29b-41d4-a716-446655440000");
    const ownedPath = path.join(ownedDirectory, "pasted-text.txt");
    fs.mkdirSync(ownedDirectory, { recursive: true });
    fs.writeFileSync(ownedPath, "remove after restart", "utf8");
    fs.writeFileSync(
      path.join(attachmentsRoot, "pasted-text-attachments.json"),
      JSON.stringify({
        attachmentPaths: [ownedPath],
        pendingRemovalPaths: [ownedPath],
        textExcerptsByPath: { [ownedPath]: "remove after restart" },
      }),
      "utf8",
    );
    const service = createService({ resolveThreadGoalAttachmentsRoot: () => attachmentsRoot });

    try {
      await waitForCondition(() => {
        if (fs.existsSync(ownedPath)) return false;
        try {
          const registry = JSON.parse(
            fs.readFileSync(path.join(attachmentsRoot, "pasted-text-attachments.json"), "utf8"),
          ) as { attachmentPaths?: string[]; pendingRemovalPaths?: string[] };
          return (
            registry.attachmentPaths?.length === 0 && registry.pendingRemovalPaths?.length === 0
          );
        } catch {
          return false;
        }
      }, 2_000);
      const registry = JSON.parse(
        fs.readFileSync(path.join(attachmentsRoot, "pasted-text-attachments.json"), "utf8"),
      ) as {
        attachmentPaths: string[];
        pendingRemovalPaths: string[];
        textExcerptsByPath: Record<string, string>;
      };

      expect(fs.existsSync(ownedPath)).toBe(false);
      expect(fs.statSync(ownedDirectory).isDirectory()).toBe(true);
      expect(JSON.stringify(registry)).toBe(
        JSON.stringify({
          attachmentPaths: [],
          pendingRemovalPaths: [],
          textExcerptsByPath: {},
        }),
      );
    } finally {
      await service.shutdown();
      fs.rmSync(attachmentsRoot, { recursive: true, force: true });
    }
  });

  test("awaits the first raw-goal cleanup before success and performs dismiss cleanup again", async () => {
    const attachmentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-goal-success-"));
    const service = createService({ resolveThreadGoalAttachmentsRoot: () => attachmentsRoot });
    const internals = pendingGoalInternals(service);
    const runtime = pendingGoalRuntime(service);
    const lifecycle = pendingGoalLifecycle(service);
    const manager = await internals.getPastedTextAttachmentManager();
    const source = await manager.createRawSource({ text: "Raw source for normal success" });
    const cleanupGate = createGate();
    const events: string[] = [];
    let cleanupCalls = 0;
    let launchedInput: PendingGoalLaunchInput | null = null;
    const originalCleanup = manager.cleanupGoalSources.bind(manager);
    manager.cleanupGoalSources = async (draft, fallbackHostId) => {
      cleanupCalls += 1;
      const call = cleanupCalls;
      events.push(`cleanup-${call}-start`);
      if (call === 1) await cleanupGate.promise;
      await originalCleanup(draft, fallbackHostId);
      events.push(`cleanup-${call}-end`);
    };
    runtime.dependencies.createWorktree = async () => ({
      worktreeGitRoot: "/worktrees/pending-goal-success",
      worktreeWorkspaceRoot: "/worktrees/pending-goal-success/packages/app",
    });
    internals.startDynamicCreatedConversation = async (input) => {
      events.push("launch");
      launchedInput = input;
      input.onThreadCreated("thread-pending-goal-success");
      return { threadId: "thread-pending-goal-success" };
    };
    internals.persistClientThreadIdentity = () => {
      events.push("map");
    };
    internals.applyPendingWorktreeConversationMetadata = async () => {
      events.push("metadata");
    };
    internals.createPendingWorktreeHeartbeat = () => {
      events.push("heartbeat");
    };

    try {
      const created = lifecycle.createPendingWorktree(pendingGoalCreateInput(source));
      if (!created.clientThreadId) throw new Error("Expected a pending client thread id");
      await waitForCondition(() => events.includes("cleanup-1-start"), 2_000);

      expect(events.includes("metadata")).toBe(true);
      expect(events.includes("heartbeat")).toBe(true);
      expect(events.indexOf("metadata") < events.indexOf("cleanup-1-start")).toBe(true);
      expect(events.indexOf("heartbeat") < events.indexOf("cleanup-1-start")).toBe(true);
      expect(
        service.listPendingWorktrees().some((entry) => entry.id === created.pendingWorktreeId),
      ).toBe(true);
      expect(fs.existsSync(source.file.fsPath)).toBe(true);
      expect(directoryContaining(attachmentsRoot, "pasted-text-1.txt") !== null).toBe(true);

      cleanupGate.release();
      await waitForCondition(
        () => cleanupCalls === 2 && service.listPendingWorktrees().length === 0,
        2_000,
      );
      await flushAsyncWork();

      expect(cleanupCalls).toBe(2);
      expect(events.indexOf("cleanup-1-end") < events.indexOf("cleanup-2-start")).toBe(true);
      expect(fs.existsSync(source.file.fsPath)).toBe(false);
      expect(fs.statSync(path.dirname(source.file.fsPath)).isDirectory()).toBe(true);
      const materializedDirectory = directoryContaining(attachmentsRoot, "pasted-text-1.txt");
      const realizedLaunch = launchedInput as PendingGoalLaunchInput | null;
      expect(materializedDirectory !== null).toBe(true);
      expect(fs.existsSync(path.join(materializedDirectory ?? "", "pasted-text-1.txt"))).toBe(true);
      expect((realizedLaunch?.firstTurnInput[0]?.text ?? "").startsWith("/goal ")).toBe(true);
      expect(runtime.resolveThread(created.clientThreadId)).toBe(null);
    } finally {
      cleanupGate.release();
      manager.cleanupGoalSources = originalCleanup;
      await service.shutdown();
      fs.rmSync(attachmentsRoot, { recursive: true, force: true });
    }
  });

  test("mapped metadata failure dismisses with one raw cleanup and retains materialized goal files", async () => {
    const attachmentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-goal-metadata-fail-"));
    const service = createService({ resolveThreadGoalAttachmentsRoot: () => attachmentsRoot });
    const internals = pendingGoalInternals(service);
    const runtime = pendingGoalRuntime(service);
    const lifecycle = pendingGoalLifecycle(service);
    const manager = await internals.getPastedTextAttachmentManager();
    const source = await manager.createRawSource({ text: "Raw source for metadata failure" });
    const originalCleanup = manager.cleanupGoalSources.bind(manager);
    let cleanupCalls = 0;
    manager.cleanupGoalSources = async (draft, fallbackHostId) => {
      cleanupCalls += 1;
      await originalCleanup(draft, fallbackHostId);
    };
    runtime.dependencies.createWorktree = async () => ({
      worktreeGitRoot: "/worktrees/pending-goal-metadata-fail",
      worktreeWorkspaceRoot: "/worktrees/pending-goal-metadata-fail/packages/app",
    });
    internals.startDynamicCreatedConversation = async (input) => {
      input.onThreadCreated("thread-pending-goal-metadata-fail");
      return { threadId: "thread-pending-goal-metadata-fail" };
    };
    internals.persistClientThreadIdentity = () => {};
    internals.applyPendingWorktreeConversationMetadata = async () => {
      throw new Error("goal metadata failed after mapping");
    };
    internals.createPendingWorktreeHeartbeat = () => {};

    try {
      const created = lifecycle.createPendingWorktree(pendingGoalCreateInput(source));
      const clientThreadId = created.clientThreadId;
      if (!clientThreadId) throw new Error("Expected a pending client thread id");
      await waitForCondition(() => service.listPendingWorktrees().length === 0, 2_000);
      await waitForCondition(() => cleanupCalls === 1 && !fs.existsSync(source.file.fsPath), 2_000);

      expect(cleanupCalls).toBe(1);
      expect(service.listPendingWorktrees().length).toBe(0);
      expect(fs.existsSync(source.file.fsPath)).toBe(false);
      expect(directoryContaining(attachmentsRoot, "pasted-text-1.txt") !== null).toBe(true);
      expect(runtime.resolveThread(clientThreadId)).toBe(null);
    } finally {
      manager.cleanupGoalSources = originalCleanup;
      await service.shutdown();
      fs.rmSync(attachmentsRoot, { recursive: true, force: true });
    }
  });

  test("pre-map start failure retains raw sources, removes materialization, and retries cleanly", async () => {
    const attachmentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-goal-start-retry-"));
    const service = createService({ resolveThreadGoalAttachmentsRoot: () => attachmentsRoot });
    const internals = pendingGoalInternals(service);
    const runtime = pendingGoalRuntime(service);
    const lifecycle = pendingGoalLifecycle(service);
    const manager = await internals.getPastedTextAttachmentManager();
    const source = await manager.createRawSource({ text: "Raw source retained for retry" });
    const originalCleanup = manager.cleanupGoalSources.bind(manager);
    let cleanupCalls = 0;
    let startCalls = 0;
    manager.cleanupGoalSources = async (draft, fallbackHostId) => {
      cleanupCalls += 1;
      await originalCleanup(draft, fallbackHostId);
    };
    runtime.dependencies.createWorktree = async () => ({
      worktreeGitRoot: "/worktrees/pending-goal-start-retry",
      worktreeWorkspaceRoot: "/worktrees/pending-goal-start-retry/packages/app",
    });
    internals.startDynamicCreatedConversation = async (input) => {
      startCalls += 1;
      if (startCalls === 1) throw new Error("start failed before mapping");
      input.onThreadCreated("thread-pending-goal-start-retry");
      return { threadId: "thread-pending-goal-start-retry" };
    };
    internals.persistClientThreadIdentity = () => {};
    internals.applyPendingWorktreeConversationMetadata = async () => {};
    internals.createPendingWorktreeHeartbeat = () => {};

    try {
      const created = lifecycle.createPendingWorktree(pendingGoalCreateInput(source));
      const clientThreadId = created.clientThreadId;
      if (!clientThreadId) throw new Error("Expected a pending client thread id");
      await waitForCondition(
        () => runtime.resolveThread(clientThreadId)?.state === "failed",
        2_000,
      );

      expect(startCalls).toBe(1);
      expect(cleanupCalls).toBe(0);
      expect(fs.existsSync(source.file.fsPath)).toBe(true);
      expect(directoryContaining(attachmentsRoot, "pasted-text-1.txt")).toBe(null);
      expect(service.listPendingWorktrees().length).toBe(1);

      lifecycle.retryPendingWorktree("local", created.pendingWorktreeId);
      await waitForCondition(() => service.listPendingWorktrees().length === 0, 2_000);
      await waitForCondition(() => cleanupCalls === 2, 2_000);
      await flushAsyncWork();

      expect(startCalls).toBe(2);
      expect(cleanupCalls).toBe(2);
      expect(fs.existsSync(source.file.fsPath)).toBe(false);
      expect(directoryContaining(attachmentsRoot, "pasted-text-1.txt") !== null).toBe(true);
      expect(service.listPendingWorktrees().length).toBe(0);
    } finally {
      manager.cleanupGoalSources = originalCleanup;
      await service.shutdown();
      fs.rmSync(attachmentsRoot, { recursive: true, force: true });
    }
  });

  test("Work locally launches frozen input and attachments without waiting for goal cleanup", async () => {
    const attachmentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-goal-work-local-"));
    const service = createService({ resolveThreadGoalAttachmentsRoot: () => attachmentsRoot });
    const internals = pendingGoalInternals(service);
    const runtime = pendingGoalRuntime(service);
    const lifecycle = pendingGoalLifecycle(service);
    const manager = await internals.getPastedTextAttachmentManager();
    const source = await manager.createRawSource({ text: "Raw goal source sent locally" });
    const originalCleanup = manager.cleanupGoalSources.bind(manager);
    const cleanupGate = createGate();
    let cleanupCalls = 0;
    let materializeCalls = 0;
    let metadataCalls = 0;
    let heartbeatCalls = 0;
    let launchedInput: PendingGoalLaunchInput | null = null;
    manager.cleanupGoalSources = async (draft, fallbackHostId) => {
      cleanupCalls += 1;
      await cleanupGate.promise;
      await originalCleanup(draft, fallbackHostId);
    };
    runtime.dependencies.createWorktree = async (_entry, context) =>
      await new Promise<never>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    internals.materializePendingWorktreeGoal = async () => {
      materializeCalls += 1;
      throw new Error("Work locally must not materialize a goal");
    };
    internals.startDynamicCreatedConversation = async (input) => {
      launchedInput = input;
      input.onThreadCreated("thread-pending-goal-work-local");
      return { threadId: "thread-pending-goal-work-local" };
    };
    internals.persistClientThreadIdentity = () => {};
    internals.applyPendingWorktreeConversationMetadata = async () => {
      metadataCalls += 1;
    };
    internals.createPendingWorktreeHeartbeat = () => {
      heartbeatCalls += 1;
    };

    try {
      const createInput = pendingGoalCreateInput(source);
      const created = lifecycle.createPendingWorktree(createInput);
      await flushAsyncWork(1);
      let localResult: { readonly threadId: string } | null = null;
      const localLaunch = lifecycle
        .workLocallyFromPendingWorktree("local", created.pendingWorktreeId)
        .then((result) => {
          localResult = result;
          return result;
        });
      await waitForCondition(() => cleanupCalls === 1, 2_000);
      await flushAsyncWork();

      const realizedLocalResult = localResult as { readonly threadId: string } | null;
      const realizedLaunch = launchedInput as PendingGoalLaunchInput | null;
      expect(realizedLocalResult?.threadId).toBe("thread-pending-goal-work-local");
      expect(cleanupCalls).toBe(1);
      expect(fs.existsSync(source.file.fsPath)).toBe(true);
      expect(materializeCalls).toBe(0);
      expect(metadataCalls).toBe(0);
      expect(heartbeatCalls).toBe(0);
      expect(JSON.stringify(realizedLaunch?.firstTurnInput)).toBe(
        JSON.stringify(createInput.startConversationParamsInput.input),
      );
      const attachmentPaths =
        realizedLaunch?.firstTurnAttachments.map((attachment) => attachment.path) ?? [];
      expect(attachmentPaths.includes("ordinary.txt")).toBe(true);
      expect(attachmentPaths.includes("added.txt")).toBe(true);
      expect(attachmentPaths.includes(source.file.path)).toBe(true);
      expect(realizedLaunch?.managedWorktreePath).toBe(null);
      expect(realizedLaunch?.target.cwd).toBe(createInput.sourceWorkspaceRoot);
      expect(JSON.stringify(realizedLaunch?.target.workspaceRoots)).toBe(
        JSON.stringify([createInput.sourceWorkspaceRoot]),
      );
      expect(Object.prototype.hasOwnProperty.call(realizedLaunch ?? {}, "worktreeInit")).toBe(
        false,
      );

      cleanupGate.release();
      await localLaunch;
      await waitForCondition(() => !fs.existsSync(source.file.fsPath), 2_000);
      expect(fs.existsSync(source.file.fsPath)).toBe(false);
    } finally {
      cleanupGate.release();
      manager.cleanupGoalSources = originalCleanup;
      await service.shutdown();
      fs.rmSync(attachmentsRoot, { recursive: true, force: true });
    }
  });

  test("eager-local cleanup waits for goal metadata and retains raw sources on metadata failure", async () => {
    const attachmentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-goal-local-raw-cleanup-"));
    const service = createService({ resolveThreadGoalAttachmentsRoot: () => attachmentsRoot });
    const internals = pendingGoalInternals(service);
    const manager = await internals.getPastedTextAttachmentManager();
    const successSource = await manager.createRawSource({ text: "remove after metadata" });
    const failedSource = await manager.createRawSource({ text: "retain after metadata failure" });
    const threadGoals = Reflect.get(service as object, "threadGoals") as {
      set: CodexThreadGoalRuntimePromiseAdapter["set"];
    };
    const originalSetThreadGoal = threadGoals.set;
    const originalCleanup = manager.cleanupGoalSources.bind(manager);
    const events: string[] = [];

    try {
      manager.cleanupGoalSources = async (draft, fallbackHostId) => {
        events.push("cleanup");
        await originalCleanup(draft, fallbackHostId);
      };
      threadGoals.set = async () => {
        events.push("metadata");
        return null;
      };
      await internals.applyStartedSessionThreadGoal({
        threadId: "thread-eager-local-success",
        objective: "Finish the eager-local goal",
        rawDraft: {
          objective: "Finish the eager-local goal",
          pastedTextAttachments: [successSource],
          imageAttachments: [],
        },
      });
      events.push("returned");

      expect(events.join(",")).toBe("metadata,cleanup,returned");
      expect(fs.existsSync(successSource.file.fsPath)).toBe(false);

      threadGoals.set = async () => {
        events.push("metadata-failed");
        throw new Error("goal metadata failed");
      };
      let errorMessage = "";
      try {
        await internals.applyStartedSessionThreadGoal({
          threadId: "thread-eager-local-failure",
          objective: "Retain the eager-local source",
          rawDraft: {
            objective: "Retain the eager-local source",
            pastedTextAttachments: [failedSource],
            imageAttachments: [],
          },
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toBe("goal metadata failed");
      expect(fs.existsSync(failedSource.file.fsPath)).toBe(true);
    } finally {
      threadGoals.set = originalSetThreadGoal;
      manager.cleanupGoalSources = originalCleanup;
      await manager.remove(failedSource.file.path).catch(() => undefined);
      await service.shutdown();
      fs.rmSync(attachmentsRoot, { recursive: true, force: true });
    }
  });
});

describe("codex-service approval fallback", () => {
  test("answers app-server currentTime/read requests with Unix seconds", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
    };
    const originalDateNow = Date.now;

    try {
      Date.now = () => 1_700_000_123_999;
      const result = await serviceInternals.handleServerRequest({
        id: "time_req",
        method: "currentTime/read",
        params: { threadId: "thr_time" },
      });

      expect((result as { currentTimeAt?: number }).currentTimeAt ?? 0).toBe(1_700_000_123);
    } finally {
      Date.now = originalDateNow;
      await service.shutdown();
    }
  });

  test("clears the pending user-input generation when app-server disconnects", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getUserInputAutoResolutionSnapshot: () => CodexUserInputAutoResolutionEntry[];
    };
    const threadId = "thread-auto-resolution-disconnect";
    const requestId = "request-auto-resolution-disconnect";

    try {
      service.observeConnection({ status: "connected", retries: 0 });
      const request = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/tool/requestUserInput",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "item-1",
          isBlocking: false,
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Continue?",
              isOther: false,
              isSecret: false,
            },
          ],
        },
      });
      await Promise.resolve();
      expect(serviceInternals.getUserInputAutoResolutionSnapshot()).toHaveLength(1);

      service.observeConnection({ status: "disconnected", retries: 1 });
      expect(serviceInternals.getUserInputAutoResolutionSnapshot()).toEqual([]);

      expect(await request).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service streaming notification parity", () => {
  test("drops plan and reasoning deltas that arrive before item/started", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const hostMessages: CodexHostMessage[] = [];

    serviceInternals.persistThreadSnapshot = () => {};
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    try {
      serviceInternals.mergeTurn("thr_plan_delta", {
        threadId: "thr_plan_delta",
        turnId: "turn_plan_delta",
        status: "inProgress",
        itemIds: [],
      });
      await serviceInternals.handleNotification({
        method: "item/plan/delta",
        params: {
          threadId: "thr_plan_delta",
          turnId: "turn_plan_delta",
          itemId: "plan_item",
          delta: "1. Clarify requirements",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "thr_plan_delta",
          turnId: "turn_plan_delta",
          itemId: "reasoning_item",
          summaryIndex: 0,
          delta: "Thinking",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/reasoning/textDelta",
        params: {
          threadId: "thr_plan_delta",
          turnId: "turn_plan_delta",
          itemId: "reasoning_item",
          contentIndex: 0,
          delta: "Private",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      const planItem = getRecordedItem(
        serviceInternals,
        "thr_plan_delta",
        "turn_plan_delta",
        "plan_item",
      );
      const reasoningItem = getRecordedItem(
        serviceInternals,
        "thr_plan_delta",
        "turn_plan_delta",
        "reasoning_item",
      );

      expect(Boolean(planItem)).toBe(false);
      expect(Boolean(reasoningItem)).toBe(false);
      expect(String(hostMessages.length)).toBe("0");
    } finally {
      await service.shutdown();
    }
  });

  test("streams item/plan/delta into an existing plan item and lets item/completed overwrite final text", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const hostMessages: CodexHostMessage[] = [];

    serviceInternals.persistThreadSnapshot = () => {};
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    try {
      serviceInternals.mergeTurn("thr_plan_delta_existing", {
        threadId: "thr_plan_delta_existing",
        turnId: "turn_plan_delta_existing",
        status: "inProgress",
        itemIds: ["plan_item"],
      });

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_plan_delta_existing",
          turnId: "turn_plan_delta_existing",
          item: {
            id: "plan_item",
            type: "plan",
            text: "",
          },
        },
      });
      const baseConversation = service.serializeConversationSnapshot("thr_plan_delta_existing");
      expect(baseConversation).not.toBeNull();

      await serviceInternals.handleNotification({
        method: "item/plan/delta",
        params: {
          threadId: "thr_plan_delta_existing",
          turnId: "turn_plan_delta_existing",
          itemId: "plan_item",
          delta: "Draft plan",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/plan/delta",
        params: {
          threadId: "thr_plan_delta_existing",
          turnId: "turn_plan_delta_existing",
          itemId: "plan_item",
          delta: " from deltas",
        },
      });
      await waitForCondition(
        () =>
          service.serializeConversationSnapshot("thr_plan_delta_existing")?.turns[0]?.items[0]
            ?.markdownText === "Draft plan from deltas",
        120,
      );

      expect(hostMessages).toHaveLength(0);
      const latest = service.serializeConversationSnapshot("thr_plan_delta_existing");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("Draft plan from deltas");

      let planItem = latest?.turns[0]?.items[0];
      expect(planItem?.semanticKind).toBe("proposedPlan");
      expect(planItem?.markdownText).toBe("Draft plan from deltas");

      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_plan_delta_existing",
          turnId: "turn_plan_delta_existing",
          item: {
            id: "plan_item",
            type: "plan",
            text: "Final authoritative plan",
          },
        },
      });

      planItem =
        service.serializeConversationSnapshot("thr_plan_delta_existing")?.turns[0]?.items[0];
      expect(planItem?.semanticKind).toBe("proposedPlan");
      expect(planItem?.markdownText).toBe("Final authoritative plan");
    } finally {
      await service.shutdown();
    }
  });

  test("streams reasoning summary deltas through thread stream patch updates", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_reasoning_delta"),
      turns: [
        {
          threadId: "thr_reasoning_delta",
          turnId: "turn_reasoning_delta",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_reasoning_delta",
          turnId: "turn_reasoning_delta",
          item: {
            id: "reasoning_delta_item",
            type: "reasoning",
            summary: [],
            content: [],
          },
        },
      });
      const baseConversation = service.serializeConversationSnapshot("thr_reasoning_delta");
      expect(baseConversation).not.toBeNull();

      await serviceInternals.handleNotification({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: "thr_reasoning_delta",
          turnId: "turn_reasoning_delta",
          itemId: "reasoning_delta_item",
          summaryIndex: 0,
          delta: "Thinking",
        },
      });
      await waitForCondition(
        () =>
          service.serializeConversationSnapshot("thr_reasoning_delta")?.turns[0]?.items[0]
            ?.markdownText === "Thinking",
        120,
      );

      expect(hostMessages).toHaveLength(0);
      const latest = service.serializeConversationSnapshot("thr_reasoning_delta");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("Thinking");
      const rawItem = latest?.turns[0]?.items[0]?.rawItem;
      const summary =
        rawItem && typeof rawItem === "object"
          ? (rawItem as { summary?: unknown[] }).summary
          : null;
      expect(Array.isArray(summary)).toBe(true);
      expect(String(summary?.[0] ?? "")).toBe("Thinking");

      await serviceInternals.handleNotification({
        method: "item/reasoning/textDelta",
        params: {
          threadId: "thr_reasoning_delta",
          turnId: "turn_reasoning_delta",
          itemId: "reasoning_delta_item",
          contentIndex: 0,
          delta: "Private chain",
        },
      });
      await waitForCondition(() => {
        const rawItem =
          service.serializeConversationSnapshot("thr_reasoning_delta")?.turns[0]?.items[0]?.rawItem;
        const content =
          rawItem && typeof rawItem === "object"
            ? (rawItem as { content?: unknown[] }).content
            : null;
        return String(content?.[0] ?? "") === "Private chain";
      }, 120);

      const contentLatest = service.serializeConversationSnapshot("thr_reasoning_delta");
      const contentRawItem = contentLatest?.turns[0]?.items[0]?.rawItem;
      const content =
        contentRawItem && typeof contentRawItem === "object"
          ? (contentRawItem as { content?: unknown[] }).content
          : null;
      expect(Array.isArray(content)).toBe(true);
      expect(String(content?.[0] ?? "")).toBe("Private chain");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service item identity dedupe", () => {
  test("treats synthetic and live user-message ids as the same item within a turn", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeItem: (entry: CodexItemView) => void;
      conversationRecords: Map<string, { itemsByTurn: Map<string, Map<string, CodexItemView>> }>;
    };

    const baseItem: Omit<CodexItemView, "itemId" | "createdAt" | "updatedAt"> = {
      threadId: "thr_dedupe",
      turnId: "turn_dedupe",
      type: "userMessage",
      normalizedKind: "userMessage",
      semanticKind: "userMessage",
      role: "user",
      markdownText: 'say "hi"',
    };

    try {
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "item-16",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "878d0f9b-7c9f-468f-b297-9063a9c350ad",
        createdAt: 20,
        updatedAt: 20,
      });

      const byItem = serviceInternals.conversationRecords
        .get("thr_dedupe")
        ?.itemsByTurn.get("turn_dedupe");
      expect(byItem?.size).toBe(1);
      const merged = byItem ? Array.from(byItem.values())[0] : null;
      expect(merged?.markdownText).toBe('say "hi"');
      expect(merged?.itemId).toBe("878d0f9b-7c9f-468f-b297-9063a9c350ad");
    } finally {
      await service.shutdown();
    }
  });

  test("treats synthetic and live assistant-message ids as the same item within a turn", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeItem: (entry: CodexItemView) => void;
      conversationRecords: Map<string, { itemsByTurn: Map<string, Map<string, CodexItemView>> }>;
    };

    const baseItem: Omit<CodexItemView, "itemId" | "createdAt" | "updatedAt"> = {
      threadId: "thr_dedupe_assistant",
      turnId: "turn_dedupe_assistant",
      type: "agentMessage",
      normalizedKind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      markdownText: "I added the shared module. Next I’m rewiring project-switcher.tsx.",
    };

    try {
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "item-15",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "msg_0827a35f777c91c901699cc22e743081918e86cc129ba14c30",
        createdAt: 20,
        updatedAt: 20,
      });

      const byItem = serviceInternals.conversationRecords
        .get("thr_dedupe_assistant")
        ?.itemsByTurn.get("turn_dedupe_assistant");
      expect(byItem?.size).toBe(1);
      const merged = byItem ? Array.from(byItem.values())[0] : null;
      expect(merged?.normalizedKind).toBe("assistantMessage");
      expect(merged?.markdownText).toBe(
        "I added the shared module. Next I’m rewiring project-switcher.tsx.",
      );
      expect(merged?.itemId).toBe("msg_0827a35f777c91c901699cc22e743081918e86cc129ba14c30");
    } finally {
      await service.shutdown();
    }
  });

  test("does not merge two live assistant-message ids that share the same text", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeItem: (entry: CodexItemView) => void;
      conversationRecords: Map<string, { itemsByTurn: Map<string, Map<string, CodexItemView>> }>;
    };

    const baseItem: Omit<CodexItemView, "itemId" | "createdAt" | "updatedAt"> = {
      threadId: "thr_live_dupe_guard",
      turnId: "turn_live_dupe_guard",
      type: "agentMessage",
      normalizedKind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      markdownText: "Working...",
    };

    try {
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "msg_0001",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        ...baseItem,
        itemId: "msg_0002",
        createdAt: 20,
        updatedAt: 20,
      });

      const byItem = serviceInternals.conversationRecords
        .get("thr_live_dupe_guard")
        ?.itemsByTurn.get("turn_live_dupe_guard");
      expect(byItem?.size).toBe(2);
      expect(
        Array.from(byItem?.values() ?? [])
          .map((item) => item.itemId)
          .sort()
          .join(","),
      ).toBe("msg_0001,msg_0002");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service item lifecycle status fallback", () => {
  test("manual compaction projection preserves an earlier local turn through rollback", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      hydrateCanonicalConversationState: (
        input: ThreadResumeResponse,
      ) => CodexCanonicalConversationState;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      appendThreadGoalTranscriptTurn: (threadId: string, goal: ThreadGoal) => void;
      conversationRecords: Map<string, { detail: CodexThreadDetail | null }>;
    };
    const threadId = "thr_manual_compaction_projection";
    serviceInternals.hydrateCanonicalConversationState(
      makeCanonicalResumeResponse({
        threadId,
        threadTurns: [],
        initialTurnsPage: { data: [], nextCursor: null, backwardsCursor: null },
      }),
    );
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      turns: [],
      transcript: [],
    });
    serviceInternals.appendThreadGoalTranscriptTurn(threadId, {
      threadId,
      objective: "Preserve the earlier local turn",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 2,
    });

    try {
      const before = service.manualCompactionProjection.read(threadId);
      if (!before) throw new Error("Expected canonical state");
      const pending = appendCodexCanonicalInProgressSyntheticItem(
        before,
        {
          type: "contextCompaction",
          id: CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID,
          completed: false,
          source: "manual",
        },
        3,
      );
      service.manualCompactionProjection.commit({
        threadId,
        before,
        after: pending,
        observedAtMs: 3,
      });
      service.manualCompactionProjection.publish(threadId, null);
      expect(serviceInternals.conversationRecords.get(threadId)?.detail?.turns).toMatchObject([
        { turnId: null, status: "completed" },
        { turnId: null, status: "inProgress" },
      ]);

      const rolledBack = removeCodexCanonicalLocalSyntheticItem(
        pending,
        CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID,
      );
      service.manualCompactionProjection.commit({
        threadId,
        before: pending,
        after: rolledBack,
        observedAtMs: 4,
      });
      service.manualCompactionProjection.publish(threadId, null);
      expect(serviceInternals.conversationRecords.get(threadId)?.detail?.turns).toMatchObject([
        { turnId: null, status: "completed" },
      ]);
      expect(
        serviceInternals.conversationRecords
          .get(threadId)
          ?.detail?.transcript.map((item) => item.markdownText),
      ).toEqual(["Preserve the earlier local turn"]);
    } finally {
      await service.shutdown();
    }
  });

  test("projects live reasoning rows from summary text only", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_reasoning_projection", {
        threadId: "thr_reasoning_projection",
        turnId: "turn_reasoning_projection",
        status: "inProgress",
        itemIds: ["item_reasoning"],
      });

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_reasoning_projection",
          turnId: "turn_reasoning_projection",
          item: {
            id: "item_reasoning",
            type: "reasoning",
            summary: [],
            content: ["Private reasoning body"],
          },
        },
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_reasoning_projection",
        "turn_reasoning_projection",
        "item_reasoning",
      );
      expect(item?.markdownText ?? "").toBe("");

      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_reasoning_projection",
          turnId: "turn_reasoning_projection",
          item: {
            id: "item_reasoning",
            type: "reasoning",
            summary: ["Investigating", "Checking thread state"],
            content: ["Private reasoning body"],
          },
        },
      });

      item = getRecordedItem(
        serviceInternals,
        "thr_reasoning_projection",
        "turn_reasoning_projection",
        "item_reasoning",
      );
      expect(item?.markdownText).toBe("**Investigating**\n\nChecking thread state");
    } finally {
      await service.shutdown();
    }
  });

  test("derives reasoning item status from item lifecycle notifications", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.persistThreadSnapshot = () => {};

    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      serviceInternals.mergeTurn("thr_status", {
        threadId: "thr_status",
        turnId: "turn_status",
        status: "inProgress",
        itemIds: ["item_reasoning"],
      });
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_status",
          turnId: "turn_status",
          item: {
            id: "item_reasoning",
            type: "reasoning",
            summary: ["Planning the next step"],
            content: [],
          },
        },
      });

      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_status",
          turnId: "turn_status",
          item: {
            id: "item_reasoning",
            type: "reasoning",
            summary: ["Planning complete"],
            content: [],
          },
        },
      });

      const item = getRecordedItem(serviceInternals, "thr_status", "turn_status", "item_reasoning");

      expect(item?.status).toBe("completed");
    } finally {
      await service.shutdown();
    }
  });

  test("projects live context compaction lifecycle rows into the canonical conversation", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_compaction_live", {
        threadId: "thr_compaction_live",
        turnId: "turn_compaction_live",
        status: "inProgress",
        itemIds: ["item_context_compaction"],
      });

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_compaction_live",
          turnId: "turn_compaction_live",
          item: {
            id: "item_context_compaction",
            type: "contextCompaction",
          },
        },
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_compaction_live",
        "turn_compaction_live",
        "item_context_compaction",
      );
      expect(item?.semanticKind).toBe("contextCompaction");
      expect(item?.status).toBe("inProgress");
      expect(item?.markdownText).toBe("Automatically compacting context");

      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_compaction_live",
          turnId: "turn_compaction_live",
          item: {
            id: "item_context_compaction",
            type: "contextCompaction",
          },
        },
      });

      item = getRecordedItem(
        serviceInternals,
        "thr_compaction_live",
        "turn_compaction_live",
        "item_context_compaction",
      );
      expect(item?.status).toBe("completed");
      expect(item?.markdownText).toBe("Context automatically compacted");
    } finally {
      await service.shutdown();
    }
  });

  test("projects automatic approval review notifications into the canonical conversation", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_auto_review", {
        threadId: "thr_auto_review",
        turnId: "turn_auto_review",
        status: "inProgress",
        itemIds: ["item_command"],
      });

      await serviceInternals.handleNotification({
        method: "item/autoApprovalReview/started",
        params: {
          threadId: "thr_auto_review",
          turnId: "turn_auto_review",
          reviewId: "review_auto",
          targetItemId: "item_command",
          review: {
            status: "inProgress",
            riskLevel: "medium",
            userAuthorization: "unknown",
            rationale: null,
          },
          action: {
            type: "command",
            source: "shell",
            command: "bun test",
            cwd: "/tmp/project",
          },
        },
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_auto_review",
        "turn_auto_review",
        "automatic-approval-review:review_auto",
      );
      expect(item?.semanticKind).toBe("automaticApprovalReview");
      expect(item?.status).toBe("inProgress");

      await serviceInternals.handleNotification({
        method: "item/autoApprovalReview/completed",
        params: {
          threadId: "thr_auto_review",
          turnId: "turn_auto_review",
          reviewId: "review_auto",
          targetItemId: "item_command",
          decisionSource: "agent",
          review: {
            status: "approved",
            riskLevel: "low",
            userAuthorization: "low",
            rationale: "This only runs the local test suite.",
          },
          action: {
            type: "command",
            source: "shell",
            command: "bun test",
            cwd: "/tmp/project",
          },
        },
      });

      item = getRecordedItem(
        serviceInternals,
        "thr_auto_review",
        "turn_auto_review",
        "automatic-approval-review:review_auto",
      );
      expect(item?.status).toBe("completed");
      expect((item?.rawItem as { status?: string } | undefined)?.status).toBe("approved");
      expect(item?.markdownText).toBe("This only runs the local test suite.");
    } finally {
      await service.shutdown();
    }
  });

  test("projects guardian too-many-denials warning onto the latest canonical turn", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_guardian_warning", {
        threadId: "thr_guardian_warning",
        turnId: "turn_guardian_warning",
        status: "inProgress",
        itemIds: [],
      });

      await serviceInternals.handleNotification({
        method: "guardianWarning",
        params: {
          threadId: "thr_guardian_warning",
          message: "Unrelated guardian warning",
        },
      });

      let snapshot = await requestConversationSnapshotForTest(service, "thr_guardian_warning");
      let warningItems =
        snapshot?.turns[0]?.items.filter(
          (item) => item.semanticKind === "autoReviewInterruptionWarning",
        ) ?? [];
      expect(String(warningItems.length)).toBe("0");

      await serviceInternals.handleNotification({
        method: "guardianWarning",
        params: {
          threadId: "thr_guardian_warning",
          kind: "tooManyDenials",
          message: "Unrelated guardian warning",
        },
      });

      snapshot = await requestConversationSnapshotForTest(service, "thr_guardian_warning");
      warningItems =
        snapshot?.turns[0]?.items.filter(
          (item) => item.semanticKind === "autoReviewInterruptionWarning",
        ) ?? [];
      const warning = warningItems[0];
      expect(String(warningItems.length)).toBe("1");
      expect(warning?.type).toBe("autoReviewInterruptionWarning");
      expect(warning?.markdownText).toBe(
        "Automatic approval review rejected too many approval requests for this turn",
      );
    } finally {
      await service.shutdown();
    }
  });

  test("projects hook lifecycle notifications into canonical turn items", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_hook", {
        threadId: "thr_hook",
        turnId: "turn_hook",
        status: "inProgress",
        itemIds: [],
      });

      await serviceInternals.handleNotification({
        method: "hook/started",
        params: {
          threadId: "thr_hook",
          turnId: "turn_hook",
          run: {
            id: "hook_run_1",
            eventName: "preToolUse",
            status: "running",
            statusMessage: "Preparing context",
            entries: [{ kind: "context", text: "Added AGENTS.md" }],
          },
        },
      });

      let item = getRecordedItem(serviceInternals, "thr_hook", "turn_hook", "hook_run_1");
      expect(item?.semanticKind).toBe("hook");
      expect(item?.status).toBe("inProgress");

      await serviceInternals.handleNotification({
        method: "hook/completed",
        params: {
          threadId: "thr_hook",
          turnId: "turn_hook",
          run: {
            id: "hook_run_1",
            eventName: "preToolUse",
            status: "completed",
            statusMessage: "Preparing context",
            entries: [{ kind: "context", text: "Added AGENTS.md" }],
          },
        },
      });

      item = getRecordedItem(serviceInternals, "thr_hook", "turn_hook", "hook_run_1");
      expect(item?.status).toBe("completed");
    } finally {
      await service.shutdown();
    }
  });

  test("projects model reroute notifications into canonical turn items without a renderer owner", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_model_reroute", {
        threadId: "thr_model_reroute",
        turnId: "turn_model_reroute",
        status: "inProgress",
        itemIds: [],
      });
      hostMessages.length = 0;

      await serviceInternals.handleNotification({
        method: "model/rerouted",
        params: {
          threadId: "thr_model_reroute",
          turnId: "turn_model_reroute",
          fromModel: "gpt-5.4-codex",
          toModel: "gpt-5.4-mini",
          reason: "highRiskCyberActivity",
        },
      });

      const snapshot = await requestConversationSnapshotForTest(service, "thr_model_reroute");
      const item = snapshot?.turns[0]?.items.find(
        (candidate) => candidate.semanticKind === "modelRerouted",
      );
      const raw = item?.rawItem as
        | { fromModel?: string; toModel?: string; reason?: string }
        | undefined;
      expect(item?.status).toBe("completed");
      expect(raw?.fromModel).toBe("gpt-5.4-codex");
      expect(raw?.toModel).toBe("gpt-5.4-mini");
      expect(raw?.reason).toBe("highRiskCyberActivity");
      expect(hostMessages).toHaveLength(0);
    } finally {
      await service.shutdown();
    }
  });

  test("declines unsupported MCP elicitation requests before owner routing from bundle 27071 and 52137", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    };
    const hostMessages: CodexHostMessage[] = [];
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    serviceInternals.on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    rendererConversationsForTest(service).setOwner("thr_mcp_invalid", "owner-a");

    try {
      const result = await serviceInternals.handleServerRequest({
        id: "mcp_invalid",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_mcp_invalid",
          turnId: "turn_mcp_invalid",
          mode: "url",
          serverName: "browser",
          message: "Open this URL?",
          url: "http://example.test",
          elicitationId: "elicitation-1",
          _meta: null,
        },
      });
      const unknownModeResult = await serviceInternals.handleServerRequest({
        id: "mcp_unknown_mode",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_mcp_invalid",
          turnId: "turn_mcp_invalid",
          mode: "future/form",
          serverName: "browser",
          message: "Unknown form mode",
          requestedSchema: { type: "object", properties: {} },
          _meta: null,
        },
      });

      expect(JSON.stringify(result)).toBe(
        JSON.stringify({
          action: "decline",
          content: null,
          _meta: null,
        }),
      );
      expect(JSON.stringify(unknownModeResult)).toBe(
        JSON.stringify({
          action: "decline",
          content: null,
          _meta: null,
        }),
      );
      expect(String(ownerMessages.length)).toBe("0");
      expect(String(hostMessages.length)).toBe("0");
    } finally {
      await service.shutdown();
    }
  });

  test("synthesizes planImplementation items from completed turns with unfinished plans", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      listPendingConversationRequests: (
        threadId: string,
      ) => Array<{ type: string; turnId: string }>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      persistThreadSnapshot: (threadId: string) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_plan_impl"),
        turns: [],
        transcript: [],
      });

      serviceInternals.mergeTurn("thr_plan_impl", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
        status: "inProgress",
        itemIds: [],
      });

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_plan_impl",
          turnId: "turn_plan_impl",
          item: {
            id: "plan_text",
            type: "plan",
            text: "",
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_plan_impl",
          turnId: "turn_plan_impl",
          item: {
            id: "plan_text",
            type: "plan",
            text: "1. Ship the fix\n2. Verify the behavior",
          },
        },
      });

      await serviceInternals.handleNotification({
        method: "turn/plan/updated",
        params: {
          threadId: "thr_plan_impl",
          turnId: "turn_plan_impl",
          explanation: null,
          plan: [
            { step: "Ship the fix", status: "completed" },
            { step: "Verify the behavior", status: "in_progress" },
          ],
        },
      });

      await serviceInternals.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thr_plan_impl",
          turn: completeLegacyProtocolTurnFixture({
            id: "turn_plan_impl",
            status: "completed",
          }),
        },
      });

      const item = getRecordedItem(
        serviceInternals,
        "thr_plan_impl",
        "turn_plan_impl",
        "implement-plan:turn_plan_impl",
      );
      expect(item?.semanticKind).toBe("planImplementation");
      expect(item?.status).toBe("inProgress");
      expect(item?.markdownText).toBe("1. Ship the fix\n2. Verify the behavior");

      const requests = serviceInternals.listPendingConversationRequests("thr_plan_impl");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");
      expect(requests[0]?.turnId).toBe("turn_plan_impl");
    } finally {
      await service.shutdown();
    }
  });

  test("creates a planImplementation request from a completed proposed plan even without todo-list updates", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      listPendingConversationRequests: (
        threadId: string,
      ) => Array<{ type: string; turnId: string }>;
      persistThreadSnapshot: (threadId: string) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_plan_impl_no_todo"),
        turns: [],
        transcript: [],
      });

      serviceInternals.mergeTurn("thr_plan_impl_no_todo", {
        threadId: "thr_plan_impl_no_todo",
        turnId: "turn_plan_impl_no_todo",
        status: "inProgress",
        itemIds: [],
      });

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_plan_impl_no_todo",
          turnId: "turn_plan_impl_no_todo",
          item: {
            id: "plan_text",
            type: "plan",
            text: "",
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_plan_impl_no_todo",
          turnId: "turn_plan_impl_no_todo",
          item: {
            id: "plan_text",
            type: "plan",
            text: "1. Ship the fix\n2. Verify the behavior",
          },
        },
      });

      await serviceInternals.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thr_plan_impl_no_todo",
          turn: completeLegacyProtocolTurnFixture({
            id: "turn_plan_impl_no_todo",
            status: "completed",
          }),
        },
      });

      const requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_no_todo");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");
      expect(requests[0]?.turnId).toBe("turn_plan_impl_no_todo");
    } finally {
      await service.shutdown();
    }
  });

  test("leaves an existing plan request untouched when the last plan item is whitespace", async () => {
    const service = createService();
    const threadId = "thr_plan_last_whitespace";
    const turnId = "turn_plan_last_whitespace";
    const request = {
      id: `implement-plan:${turnId}`,
      method: "item/plan/requestImplementation" as const,
      params: { threadId, turnId, planContent: "Earlier usable plan" },
    };
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      mergeItem: (entry: CodexItemView) => void;
      syncPlanImplementationForTurn: (threadId: string, turnId: string) => void;
      getConversationRecord: (threadId: string) => {};
    };
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      turns: [],
      transcript: [],
    });
    serviceInternals.mergeTurn(threadId, {
      threadId,
      turnId,
      status: "completed",
      itemIds: ["plan-earlier", `implement-plan:${turnId}`, "plan-whitespace"],
    });
    serviceInternals.mergeItem({
      threadId,
      turnId,
      itemId: "plan-earlier",
      type: "plan",
      normalizedKind: "plan",
      semanticKind: "proposedPlan",
      markdownText: "Earlier usable plan",
      createdAt: 10,
      updatedAt: 10,
    });
    serviceInternals.mergeItem({
      threadId,
      turnId,
      itemId: `implement-plan:${turnId}`,
      type: "planImplementation",
      normalizedKind: "planImplementation",
      semanticKind: "planImplementation",
      status: "inProgress",
      markdownText: "Earlier usable plan",
      rawItem: {
        id: `implement-plan:${turnId}`,
        type: "planImplementation",
        turnId,
        planContent: "Earlier usable plan",
        isCompleted: false,
      },
      createdAt: 20,
      updatedAt: 21,
    });
    serviceInternals.mergeItem({
      threadId,
      turnId,
      itemId: "plan-whitespace",
      type: "plan",
      normalizedKind: "plan",
      semanticKind: "proposedPlan",
      markdownText: "  \n\t ",
      createdAt: 30,
      updatedAt: 30,
    });
    const record = serviceInternals.getConversationRecord(threadId);
    replaceTestServerRequests(record, [request]);
    const existingItem = getRecordedItem(
      serviceInternals as unknown as {
        getConversationRecord: (targetThreadId: string) => {
          itemsByTurn: Map<string, Map<string, CodexItemView>>;
        };
      },
      threadId,
      turnId,
      `implement-plan:${turnId}`,
    );

    try {
      serviceInternals.syncPlanImplementationForTurn(threadId, turnId);

      expect(readTestServerRequests(record).length).toBe(1);
      expect(readTestServerRequests(record)[0] === request).toBe(true);
      const item = getRecordedItem(
        serviceInternals as unknown as {
          getConversationRecord: (targetThreadId: string) => {
            itemsByTurn: Map<string, Map<string, CodexItemView>>;
          };
        },
        threadId,
        turnId,
        `implement-plan:${turnId}`,
      );
      expect(item === existingItem).toBe(true);
      expect(item?.status).toBe("inProgress");
      expect(item?.updatedAt).toBe(21);
    } finally {
      await service.shutdown();
    }
  });

  test("replaces identical plan requests and removes orphan plans globally on turn start", async () => {
    const service = createService();
    const threadId = "thr_plan_exact_replacement";
    const currentTurnId = "turn_plan_current";
    const staleTurnId = "turn_plan_stale";
    const orphanTurnId = "turn_plan_orphan";
    const planRequest = (turnId: string, id: string) => ({
      id,
      method: "item/plan/requestImplementation" as const,
      params: { threadId, turnId, planContent: "same plan" },
    });
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        planImplementationRequestsByTurnId: Map<string, CodexPlanImplementationServerRequest>;
      };
      upsertPlanImplementationRequest: (
        threadId: string,
        turnId: string,
        planContent: string,
        itemCreatedAt: number,
      ) => CodexPlanImplementationServerRequest;
      completeStalePlanImplementationItems: (threadId: string, activeTurnId: string) => void;
    };
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      turns: [
        { threadId, turnId: staleTurnId, status: "completed", itemIds: [] },
        { threadId, turnId: currentTurnId, status: "inProgress", itemIds: [] },
      ],
      transcript: [],
    });
    const record = serviceInternals.getConversationRecord(threadId);
    const unrelated = {
      id: "unrelated-option",
      method: "item/tool/requestOptionPicker" as const,
      params: {
        threadId,
        turnId: currentTurnId,
        question: "Keep the unrelated request",
        options: [{ label: "Keep", description: "Unrelated to plan cleanup" }],
        allowMultiple: false,
        submitLabel: "Continue",
        skipLabel: null,
      },
    };
    replaceTestServerRequests(record, [
      planRequest(currentTurnId, "old-current"),
      unrelated,
      planRequest(staleTurnId, "stale-plan"),
      planRequest(currentTurnId, "duplicate-current"),
      planRequest(orphanTurnId, "orphan-plan"),
    ]);
    const aggregate = conversationAggregateForTest(service, threadId);
    aggregate.setHasUnreadTurn(false, false);
    for (const turnId of [staleTurnId, orphanTurnId]) {
      record.planImplementationRequestsByTurnId.set(turnId, {
        type: "implementPlan",
        requestId: `implement-plan:${turnId}`,
        projectId: "project-1",
        threadId,
        turnId,
        itemId: `implement-plan:${turnId}`,
        planContent: "same plan",
        createdAt: 1,
      });
    }

    try {
      const fresh = serviceInternals.upsertPlanImplementationRequest(
        threadId,
        currentTurnId,
        "same plan",
        2,
      );
      expect(aggregate.readHasUnreadTurn()).toBe(true);
      expect(JSON.stringify(readTestServerRequests(record).map((request) => request.id))).toBe(
        JSON.stringify(["unrelated-option", "stale-plan", "orphan-plan", fresh.requestId]),
      );
      expect(
        JSON.stringify(readTestCanonicalState(record)?.requests.map((request) => request.id)),
      ).toBe(JSON.stringify(["unrelated-option", "stale-plan", "orphan-plan", fresh.requestId]));

      serviceInternals.completeStalePlanImplementationItems(threadId, currentTurnId);
      expect(JSON.stringify(readTestServerRequests(record).map((request) => request.id))).toBe(
        JSON.stringify(["unrelated-option", fresh.requestId]),
      );
      expect(
        JSON.stringify(readTestCanonicalState(record)?.requests.map((request) => request.id)),
      ).toBe(JSON.stringify(["unrelated-option", fresh.requestId]));
      expect(JSON.stringify([...record.planImplementationRequestsByTurnId.keys()])).toBe(
        JSON.stringify([currentTurnId]),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("completes a plan implementation through the conversation aggregate", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      listPendingConversationRequests: (threadId: string) => Array<{ type: string }>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      mergeItem: (entry: CodexItemView) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      syncPlanImplementationForTurn: (threadId: string, turnId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };

    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_plan_impl_remove"),
        turns: [],
        transcript: [],
      });

      serviceInternals.mergeTurn("thr_plan_impl_remove", {
        threadId: "thr_plan_impl_remove",
        turnId: "turn_plan_impl_remove",
        status: "completed",
        itemIds: [
          "plan_text",
          "todo-list:turn_plan_impl_remove",
          "implement-plan:turn_plan_impl_remove",
        ],
      });

      serviceInternals.mergeItem({
        threadId: "thr_plan_impl_remove",
        turnId: "turn_plan_impl_remove",
        itemId: "plan_text",
        type: "plan",
        normalizedKind: "plan",
        semanticKind: "proposedPlan",
        markdownText: "1. Ship the fix\n2. Verify the behavior",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        threadId: "thr_plan_impl_remove",
        turnId: "turn_plan_impl_remove",
        itemId: "todo-list:turn_plan_impl_remove",
        type: "todo-list",
        normalizedKind: "plan",
        semanticKind: "todoList",
        markdownText: "1. [x] Ship the fix\n2. [ ] Verify the behavior",
        rawItem: {
          id: "todo-list:turn_plan_impl_remove",
          type: "todo-list",
          explanation: null,
          plan: [
            { step: "Ship the fix", status: "completed" },
            { step: "Verify the behavior", status: "in_progress" },
          ],
        },
        status: "inProgress",
        createdAt: 20,
        updatedAt: 20,
      });

      serviceInternals.syncPlanImplementationForTurn(
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
      );

      serviceInternals.mergeItem({
        threadId: "thr_plan_impl_remove",
        turnId: "turn_plan_impl_remove",
        itemId: "custom-plan-implementation",
        type: "planImplementation",
        normalizedKind: "planImplementation",
        semanticKind: "planImplementation",
        status: "inProgress",
        markdownText: "Custom plan projection",
        rawItem: {
          id: "custom-plan-implementation",
          type: "planImplementation",
          turnId: "turn_plan_impl_remove",
          planContent: "Custom plan projection",
          isCompleted: false,
        },
        createdAt: 31,
        updatedAt: 32,
      });

      let requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_remove");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");
      const aggregate = conversationAggregatesByTestService
        .get(service)
        ?.conversation("thr_plan_impl_remove");
      expect(aggregate?.completePlanImplementation("turn_plan_impl_remove", false)).toBe(true);

      requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_remove");
      expect(requests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service terminal turn reconciliation", () => {
  test("turn/completed still terminalizes non-command lingering in-progress items", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      mergeItem: (entry: CodexItemView) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      serviceInternals.mergeTurn("thr_terminal", {
        threadId: "thr_terminal",
        turnId: "turn_terminal",
        status: "inProgress",
        itemIds: ["item_reasoning", "item_tool", "item_mcp"],
      });
      serviceInternals.mergeItem({
        threadId: "thr_terminal",
        turnId: "turn_terminal",
        itemId: "item_reasoning",
        type: "reasoning",
        normalizedKind: "reasoning",
        semanticKind: "reasoning",
        status: "inProgress",
        markdownText: "Thinking...",
        createdAt: 10,
        updatedAt: 10,
      });
      serviceInternals.mergeItem({
        threadId: "thr_terminal",
        turnId: "turn_terminal",
        itemId: "item_tool",
        type: "commandExecution",
        normalizedKind: "commandExecution",
        semanticKind: "exec",
        status: "inProgress",
        toolCall: {
          subtype: "command",
          toolName: "bash",
          args: {
            command: "bun test",
          },
        },
        createdAt: 11,
        updatedAt: 11,
      });
      serviceInternals.mergeItem({
        threadId: "thr_terminal",
        turnId: "turn_terminal",
        itemId: "item_mcp",
        type: "mcpToolCall",
        normalizedKind: "toolCall",
        semanticKind: "mcpToolCall",
        status: "inProgress",
        mcpToolCall: {
          callId: "item_mcp",
          functionName: "docs__search",
          pluginId: null,
          readOnlyHint: true,
          mcpAppResourceUri: undefined,
          source: null,
          invocation: {
            server: "docs",
            tool: "search",
            arguments: {},
          },
          result: null,
          durationMs: null,
          completed: false,
        },
        createdAt: 12,
        updatedAt: 12,
      });

      await serviceInternals.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thr_terminal",
          turn: completeLegacyProtocolTurnFixture({
            id: "turn_terminal",
            status: "completed",
          }),
        },
      });

      const turnEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "turn" }> => event.type === "turn",
      );
      expect(turnEvents.length).toBe(1);
      expect(turnEvents[0]?.turn.status).toBe("completed");
      const reasoningItem = getRecordedItem(
        serviceInternals,
        "thr_terminal",
        "turn_terminal",
        "item_reasoning",
      );
      expect(reasoningItem?.status).toBe("completed");
      const commandItem = getRecordedItem(
        serviceInternals,
        "thr_terminal",
        "turn_terminal",
        "item_tool",
      );
      expect(commandItem?.status).toBe("inProgress");
      const mcpItem = getRecordedItem(
        serviceInternals,
        "thr_terminal",
        "turn_terminal",
        "item_mcp",
      );
      expect(mcpItem?.status).toBe("completed");
      expect(mcpItem?.mcpToolCall?.completed).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("streams assistant deltas through thread stream patch updates", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_delta"),
      turns: [
        {
          threadId: "thr_streaming_delta",
          turnId: "turn_streaming_delta",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_streaming_delta",
          turnId: "turn_streaming_delta",
          item: makeProtocolAgentMessage({
            id: "assistant_streaming_delta",
            text: "",
          }),
        },
      });
      const baseConversation = service.serializeConversationSnapshot("thr_streaming_delta");
      expect(baseConversation).not.toBeNull();

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_streaming_delta",
          turnId: "turn_streaming_delta",
          itemId: "assistant_streaming_delta",
          delta: "hello",
        },
      });
      await waitForCondition(
        () =>
          service.serializeConversationSnapshot("thr_streaming_delta")?.turns[0]?.items[0]
            ?.markdownText === "hello",
        120,
      );

      expect(hostMessages).toHaveLength(0);
      const latest = service.serializeConversationSnapshot("thr_streaming_delta");
      expect(latest).not.toBeNull();
      expect(latest?.turns.length).toBe(1);
      expect(latest?.turns[0]?.turnStartedAtMs ?? null).toBe(null);
      expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
      expect(latest?.turns[0]?.items.length).toBe(1);
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(latest?.turns[0]?.items[0]?.status).toBe("inProgress");
    } finally {
      await service.shutdown();
    }
  });

  test("avoids full conversation serialization during assistant delta flushes once the broadcast cache is primed", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_delta_hot_path"),
      turns: [
        {
          threadId: "thr_streaming_delta_hot_path",
          turnId: "turn_streaming_delta_hot_path",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_streaming_delta_hot_path",
          turnId: "turn_streaming_delta_hot_path",
          item: makeProtocolAgentMessage({
            id: "assistant_streaming_delta_hot_path",
            text: "",
          }),
        },
      });
      const baseConversation = service.serializeConversationSnapshot(
        "thr_streaming_delta_hot_path",
      );
      expect(baseConversation).not.toBeNull();
      const readAcceptedConversation = () =>
        conversationAggregatesByTestService
          .get(service)
          ?.currentConversation("thr_streaming_delta_hot_path")
          ?.read().acceptedReplica?.conversation;

      const originalSerializeConversationSnapshot =
        serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
      let serializeConversationSnapshotCallCount = 0;
      serviceInternals.serializeConversationSnapshot = (threadId: string) => {
        serializeConversationSnapshotCallCount += 1;
        return originalSerializeConversationSnapshot(threadId);
      };

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_streaming_delta_hot_path",
          turnId: "turn_streaming_delta_hot_path",
          itemId: "assistant_streaming_delta_hot_path",
          delta: "hello",
        },
      });
      await waitForCondition(
        () => readAcceptedConversation()?.turns[0]?.items[0]?.markdownText === "hello",
        120,
      );

      expect(String(serializeConversationSnapshotCallCount)).toBe("0");
      expect(hostMessages).toHaveLength(0);
      const latest = readAcceptedConversation();
      expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
    } finally {
      await service.shutdown();
    }
  });

  test("flushes the full main-fallback assistant delta in one timeout batch", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];
    const largeDelta = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_large_delta"),
      turns: [
        {
          threadId: "thr_streaming_large_delta",
          turnId: "turn_streaming_large_delta",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_streaming_large_delta",
          turnId: "turn_streaming_large_delta",
          item: makeProtocolAgentMessage({
            id: "assistant_large_delta",
            text: "",
          }),
        },
      });
      const baseConversation = service.serializeConversationSnapshot("thr_streaming_large_delta");
      expect(baseConversation).not.toBeNull();
      const readAcceptedConversation = () =>
        conversationAggregatesByTestService
          .get(service)
          ?.currentConversation("thr_streaming_large_delta")
          ?.read().acceptedReplica?.conversation;

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_streaming_large_delta",
          turnId: "turn_streaming_large_delta",
          itemId: "assistant_large_delta",
          delta: largeDelta,
        },
      });
      await waitForCondition(
        () => readAcceptedConversation()?.turns[0]?.items[0]?.markdownText === largeDelta,
        180,
      );

      expect(hostMessages).toHaveLength(0);
      const latest = readAcceptedConversation();
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe(largeDelta);
    } finally {
      await service.shutdown();
    }
  });

  test("synchronously drains pending assistant deltas in main fallback before applying item/completed", async () => {
    const previousRequestAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "requestAnimationFrame",
    );
    const previousCancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "cancelAnimationFrame",
    );
    const previousDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    let requestAnimationFrameCalled = false;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: () => {
        requestAnimationFrameCalled = true;
        return 1;
      },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        visibilityState: "visible",
      },
    });

    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];
    const largeDelta = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_completion_drain"),
      turns: [
        {
          threadId: "thr_streaming_completion_drain",
          turnId: "turn_streaming_completion_drain",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_streaming_completion_drain",
          turnId: "turn_streaming_completion_drain",
          item: makeProtocolAgentMessage({
            id: "assistant_completion_drain",
            text: "",
          }),
        },
      });
      const baseConversation = service.serializeConversationSnapshot(
        "thr_streaming_completion_drain",
      );
      expect(baseConversation).not.toBeNull();

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_streaming_completion_drain",
          turnId: "turn_streaming_completion_drain",
          itemId: "assistant_completion_drain",
          delta: largeDelta,
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_streaming_completion_drain",
          turnId: "turn_streaming_completion_drain",
          item: makeProtocolAgentMessage({
            id: "assistant_completion_drain",
            text: largeDelta,
          }),
        },
      });

      expect(hostMessages).toHaveLength(0);
      const latest = service.serializeConversationSnapshot("thr_streaming_completion_drain");
      expect(latest?.turns[0]?.items[0]?.status).toBe("completed");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe(largeDelta);
      expect(requestAnimationFrameCalled).toBe(false);
    } finally {
      await service.shutdown();
      if (previousRequestAnimationFrameDescriptor) {
        Object.defineProperty(
          globalThis,
          "requestAnimationFrame",
          previousRequestAnimationFrameDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      }
      if (previousCancelAnimationFrameDescriptor) {
        Object.defineProperty(
          globalThis,
          "cancelAnimationFrame",
          previousCancelAnimationFrameDescriptor,
        );
      } else {
        Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
      }
      if (previousDocumentDescriptor) {
        Object.defineProperty(globalThis, "document", previousDocumentDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
    }
  });

  test("drains short assistant deltas before applying item/completed", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];
    const delta = "short response";

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_short_completion_drain"),
      turns: [
        {
          threadId: "thr_streaming_short_completion_drain",
          turnId: "turn_streaming_short_completion_drain",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_streaming_short_completion_drain",
          turnId: "turn_streaming_short_completion_drain",
          item: makeProtocolAgentMessage({
            id: "assistant_short_completion_drain",
            text: "",
          }),
        },
      });
      const baseConversation = service.serializeConversationSnapshot(
        "thr_streaming_short_completion_drain",
      );
      expect(baseConversation).not.toBeNull();

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_streaming_short_completion_drain",
          turnId: "turn_streaming_short_completion_drain",
          itemId: "assistant_short_completion_drain",
          delta,
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_streaming_short_completion_drain",
          turnId: "turn_streaming_short_completion_drain",
          item: makeProtocolAgentMessage({
            id: "assistant_short_completion_drain",
            text: delta,
          }),
        },
      });
      expect(hostMessages).toHaveLength(0);
      const latest = service.serializeConversationSnapshot("thr_streaming_short_completion_drain");
      expect(latest?.turns[0]?.items[0]?.status).toBe("completed");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe(delta);
    } finally {
      await service.shutdown();
    }
  });

  test("synchronously drains pending assistant deltas in main fallback before applying turn/completed", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };
    const hostMessages: CodexHostMessage[] = [];
    const delta = "turn completion drains this full response first";
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_turn_completion_drain"),
      turns: [
        {
          threadId: "thr_streaming_turn_completion_drain",
          turnId: "turn_streaming_turn_completion_drain",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_streaming_turn_completion_drain",
          turnId: "turn_streaming_turn_completion_drain",
          item: makeProtocolAgentMessage({
            id: "assistant_turn_completion_drain",
            text: "",
          }),
        },
      });
      const baseConversation = service.serializeConversationSnapshot(
        "thr_streaming_turn_completion_drain",
      );
      expect(baseConversation).not.toBeNull();

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_streaming_turn_completion_drain",
          turnId: "turn_streaming_turn_completion_drain",
          itemId: "assistant_turn_completion_drain",
          delta,
        },
      });
      await serviceInternals.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thr_streaming_turn_completion_drain",
          turn: {
            id: "turn_streaming_turn_completion_drain",
            status: "completed",
            items: [],
          },
        },
      });

      expect(hostMessages).toHaveLength(0);
      const latest = service.serializeConversationSnapshot("thr_streaming_turn_completion_drain");
      expect(latest?.turns[0]?.status).toBe("completed");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe(delta);
    } finally {
      await service.shutdown();
    }
  });

  test("streams command output deltas as raw mcp notifications while keeping snapshots canonical", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const threadMessages: CodexHostMessage[] = [];
    const mcpMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        threadMessages.push(message);
      }
      if (message.type === "mcpNotification") {
        mcpMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_output"),
      turns: [
        {
          threadId: "thr_streaming_output",
          turnId: "turn_streaming_output",
          status: "inProgress",
          itemIds: ["exec_streaming_output"],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_streaming_output",
          turnId: "turn_streaming_output",
          item: makeProtocolCommandExecution({
            id: "exec_streaming_output",
            command: "bun test",
            cwd: "/tmp",
          }),
        },
      });
      await serviceInternals.handleNotification({
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thr_streaming_output",
          turnId: "turn_streaming_output",
          itemId: "exec_streaming_output",
          delta: "1340 pass\n",
        },
      });

      expect(String(mcpMessages.length)).toBe("1");
      const mcpMessage = mcpMessages[0];
      expect(mcpMessage?.type).toBe("mcpNotification");
      expect(mcpMessage?.type === "mcpNotification" ? mcpMessage.notification.method : "").toBe(
        "item/commandExecution/outputDelta",
      );
      expect(
        mcpMessage?.type === "mcpNotification" ? mcpMessage.notification.params.delta : "",
      ).toBe("1340 pass\n");

      const threadMessageCountAfterStarted = threadMessages.length;
      await new Promise((resolve) => setTimeout(resolve, 70));
      expect(String(threadMessages.length)).toBe(String(threadMessageCountAfterStarted));

      const snapshot = await requestConversationSnapshotForTest(service, "thr_streaming_output");
      expect(snapshot).not.toBeNull();
      expect(snapshot?.turns.length).toBe(1);
      expect(snapshot?.turns[0]?.items.length).toBe(1);
      expect(typeof snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");
      expect(snapshot?.turns[0]?.items[0]?.aggregatedOutput).toBe("1340 pass\n");
      expect(snapshot?.turns[0]?.items[0]?.toolCall).toBeUndefined();
    } finally {
      await service.shutdown();
    }
  });

  test("forwards command output deltas to renderer owner instead of broadcasting raw mcp notifications", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const mcpMessages: CodexHostMessage[] = [];
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];

    service.on("hostMessage", (message) => {
      if (message.type === "mcpNotification") {
        mcpMessages.push(message);
      }
    });
    (
      service as unknown as {
        on: (
          event: "rendererOwnerHostMessage",
          listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
        ) => void;
      }
    ).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_owner_streaming_output"),
      turns: [
        {
          threadId: "thr_owner_streaming_output",
          turnId: "turn_owner_streaming_output",
          status: "inProgress",
          itemIds: ["exec_owner_streaming_output"],
        },
      ],
      transcript: [],
    });

    try {
      rendererConversationsForTest(service).setOwner("thr_owner_streaming_output", "owner-a");
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_owner_streaming_output",
          turnId: "turn_owner_streaming_output",
          item: makeProtocolCommandExecution({
            id: "exec_owner_streaming_output",
            command: "bun test",
            cwd: "/tmp",
          }),
        },
      });
      await serviceInternals.handleNotification({
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thr_owner_streaming_output",
          turnId: "turn_owner_streaming_output",
          itemId: "exec_owner_streaming_output",
          delta: "owner output\n",
        },
      });

      const outputOwnerMessages = ownerMessages.filter(
        (message) =>
          message.message.type === "threadOwnerNotification" &&
          message.message.notification.method === "item/commandExecution/outputDelta",
      );
      expect(String(mcpMessages.length)).toBe("0");
      expect(String(outputOwnerMessages.length)).toBe("1");
      expect(outputOwnerMessages[0]?.targetClientId).toBe("owner-a");
      expect(outputOwnerMessages[0]?.message.type).toBe("threadOwnerNotification");
      if (outputOwnerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(outputOwnerMessages[0].message.notification.method).toBe(
          "item/commandExecution/outputDelta",
        );
        expect(outputOwnerMessages[0].message.sequence).toBe(2);
      }

      await new Promise((resolve) => setTimeout(resolve, 70));
      const snapshot = await requestConversationSnapshotForTest(
        service,
        "thr_owner_streaming_output",
      );
      expect(snapshot?.turns[0]?.items[0]?.aggregatedOutput).toBe("owner output\n");
    } finally {
      await service.shutdown();
    }
  });

  test("advances canonical command output when the derived detail projection is unavailable", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      applyOutputDeltas: (updates: readonly CodexCommandOutputUpdate[]) => void;
      getMaybeConversationRecord: (threadId: string) => {
        detail: CodexThreadDetail | null;
      } | null;
    };
    const threadId = "thr_output_without_detail";
    const turnId = "turn_output_without_detail";
    const itemId = "exec_output_without_detail";

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail(threadId),
        turns: [
          {
            threadId,
            turnId,
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId,
          turnId,
          item: makeProtocolCommandExecution({
            id: itemId,
            command: "pnpm test",
            cwd: "/tmp",
          }),
        },
      });

      const record = serviceInternals.getMaybeConversationRecord(threadId);
      if (record) record.detail = null;
      await serviceInternals.handleNotification({
        method: "item/commandExecution/outputDelta",
        params: {
          threadId,
          turnId,
          itemId,
          delta: "canonical output\n",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 70));

      const canonicalCommand = (record ? readTestCanonicalState(record) : null)?.turns[0]?.items[0];
      expect(canonicalCommand?.type).toBe("commandExecution");
      if (canonicalCommand?.type === "commandExecution") {
        expect(canonicalCommand.aggregatedOutput).toBe("canonical output\n");
      }
    } finally {
      await service.shutdown();
    }
  });

  test("forwards terminal interactions to renderer owner and records command actions silently", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    const hostMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    (
      service as unknown as {
        on: (
          event: "rendererOwnerHostMessage",
          listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
        ) => void;
      }
    ).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_owner_terminal_interaction"),
      turns: [
        {
          threadId: "thr_owner_terminal_interaction",
          turnId: "turn_owner_terminal_interaction",
          status: "inProgress",
          itemIds: ["exec_owner_terminal_interaction"],
        },
      ],
      transcript: [],
    });

    try {
      rendererConversationsForTest(service).setOwner("thr_owner_terminal_interaction", "owner-a");
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_owner_terminal_interaction",
          turnId: "turn_owner_terminal_interaction",
          item: makeProtocolCommandExecution({
            id: "exec_owner_terminal_interaction",
            command: "python",
            cwd: "/tmp",
            processId: "proc-1",
          }),
        },
      });
      const streamMessagesBeforeTerminal = hostMessages.length;
      await serviceInternals.handleNotification({
        method: "item/commandExecution/terminalInteraction",
        params: {
          threadId: "thr_owner_terminal_interaction",
          turnId: "turn_owner_terminal_interaction",
          itemId: "exec_owner_terminal_interaction",
          processId: "proc-1",
          stdin: "bun tes",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/commandExecution/terminalInteraction",
        params: {
          threadId: "thr_owner_terminal_interaction",
          turnId: "turn_owner_terminal_interaction",
          itemId: "exec_owner_terminal_interaction",
          processId: "proc-1",
          stdin: "t\n",
        },
      });

      const terminalOwnerMessages = ownerMessages.filter(
        (message) =>
          message.message.type === "threadOwnerNotification" &&
          message.message.notification.method === "item/commandExecution/terminalInteraction",
      );
      expect(String(hostMessages.length)).toBe(String(streamMessagesBeforeTerminal));

      const snapshot = await requestConversationSnapshotForTest(
        service,
        "thr_owner_terminal_interaction",
      );
      const item = snapshot?.turns[0]?.items[0];
      const commandAction = item?.commandActions?.[0];

      expect(String(terminalOwnerMessages.length)).toBe("2");
      expect(terminalOwnerMessages[0]?.targetClientId).toBe("owner-a");
      expect(terminalOwnerMessages[1]?.targetClientId).toBe("owner-a");
      expect(commandAction?.type).toBe("unknown");
      expect(commandAction?.command).toBe("bun test");
      expect(item?.toolCall).toBeUndefined();
    } finally {
      await service.shutdown();
    }
  });

  test("advances canonical terminal commands when the derived detail projection is unavailable", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      applyTerminalInteraction: (input: {
        threadId: string;
        turnId: string | null;
        itemId: string;
        stdin: string;
      }) => void;
      getMaybeConversationRecord: (threadId: string) => {
        detail: CodexThreadDetail | null;
      } | null;
    };
    const threadId = "thr_terminal_without_detail";
    const turnId = "turn_terminal_without_detail";
    const itemId = "exec_terminal_without_detail";

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail(threadId),
        turns: [
          {
            threadId,
            turnId,
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId,
          turnId,
          item: makeProtocolCommandExecution({
            id: itemId,
            command: "python",
            cwd: "/tmp",
          }),
        },
      });

      const record = serviceInternals.getMaybeConversationRecord(threadId);
      if (record) record.detail = null;
      serviceInternals.applyTerminalInteraction({
        threadId,
        turnId,
        itemId,
        stdin: "pnpm test\n",
      });

      const canonicalCommand = (record ? readTestCanonicalState(record) : null)?.turns[0]?.items[0];
      expect(canonicalCommand?.type).toBe("commandExecution");
      if (canonicalCommand?.type === "commandExecution") {
        expect(canonicalCommand.commandActions[0]?.type).toBe("unknown");
        expect(canonicalCommand.commandActions[0]?.command).toBe("pnpm test");
      }
    } finally {
      await service.shutdown();
    }
  });

  test("retains incomplete terminal input across per-thread teardown", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      forgetThreadLocalState: (threadId: string) => void;
      terminalInputBuffers: Map<string, string>;
    };

    try {
      await serviceInternals.handleNotification({
        method: "item/commandExecution/terminalInteraction",
        params: {
          threadId: "thr_terminal_buffer_lifetime",
          turnId: "turn_terminal_buffer_lifetime",
          itemId: "exec_terminal_buffer_lifetime",
          processId: "proc-terminal-buffer",
          stdin: "bun tes",
        },
      });

      const key = "thr_terminal_buffer_lifetime:exec_terminal_buffer_lifetime";
      expect(serviceInternals.terminalInputBuffers.get(key)).toBe("bun tes");
      serviceInternals.forgetThreadLocalState("thr_terminal_buffer_lifetime");
      expect(serviceInternals.terminalInputBuffers.get(key)).toBe("bun tes");
    } finally {
      await service.shutdown();
    }
  });

  test("item completed backfills first work item start without overwriting an existing stamp", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_work_stamp"),
        turns: [
          {
            threadId: "thr_completed_work_stamp",
            turnId: "turn_completed_work_stamp",
            status: "inProgress",
            itemIds: ["exec_completed"],
          },
        ],
        transcript: [],
      });

      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_completed_work_stamp",
          turnId: "turn_completed_work_stamp",
          completedAtMs: 1_000,
          item: makeProtocolCommandExecution({
            id: "exec_completed",
            command: "bun test",
            status: "completed",
            durationMs: 50,
          }),
        },
      });

      let snapshot = service.serializeConversationSnapshot("thr_completed_work_stamp");
      expect(typeof snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");
      expect(snapshot?.turns[0]?.items.length).toBe(0);
      expect(snapshot?.turns[0]?.commandExecutionStartedAtMsById?.exec_completed).toBe(950);

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_existing_work_stamp"),
        turns: [
          {
            threadId: "thr_existing_work_stamp",
            turnId: "turn_existing_work_stamp",
            status: "inProgress",
            itemIds: ["exec_existing"],
            firstTurnWorkItemStartedAtMs: 123,
          },
        ],
        transcript: [],
      });

      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_existing_work_stamp",
          turnId: "turn_existing_work_stamp",
          item: makeProtocolCommandExecution({
            id: "exec_existing",
            command: "bun test",
            status: "completed",
          }),
        },
      });

      snapshot = service.serializeConversationSnapshot("thr_existing_work_stamp");
      expect(snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs ?? 0).toBe(123);
    } finally {
      await service.shutdown();
    }
  });

  test("keeps hidden review-mode lifecycle identities without projecting transcript rows", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      getConversationRecord: (threadId: string) => {};
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_hidden_review_lifecycle"),
        turns: [
          {
            threadId: "thr_hidden_review_lifecycle",
            turnId: "turn_hidden_review_lifecycle",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_hidden_review_lifecycle",
          turnId: "turn_hidden_review_lifecycle",
          startedAtMs: 100,
          item: {
            id: "review-mode-marker",
            type: "enteredReviewMode",
            review: "Review the current changes",
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_hidden_review_lifecycle",
          turnId: "turn_hidden_review_lifecycle",
          completedAtMs: 120,
          item: {
            id: "review-mode-marker",
            type: "enteredReviewMode",
            review: "Review the current changes",
          },
        },
      });

      const snapshot = service.serializeConversationSnapshot("thr_hidden_review_lifecycle");
      const canonicalItem = getCanonicalConversationState(
        service,
        "thr_hidden_review_lifecycle",
      )?.turns[0]?.items.find((item) => item.id === "review-mode-marker");
      expect(snapshot?.turns[0]?.items.length ?? -1).toBe(0);
      expect(typeof snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");
      expect(canonicalItem?.type).toBe("enteredReviewMode");
    } finally {
      await service.shutdown();
    }
  });

  test("round-trips a visible item through a hidden same-ID slot without reordering", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      getConversationRecord: (threadId: string) => {};
    };
    const buildCommand = (id: string, status: "inProgress" | "completed" = "inProgress") => ({
      id,
      type: "commandExecution",
      command: `printf ${id}`,
      cwd: "/tmp",
      processId: null,
      source: "agent",
      status,
      commandActions: [],
      aggregatedOutput: status === "completed" ? `${id}\n` : null,
      exitCode: status === "completed" ? 0 : null,
      durationMs: status === "completed" ? 10 : null,
    });

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_hidden_visible_roundtrip"),
        turns: [
          {
            threadId: "thr_hidden_visible_roundtrip",
            turnId: "turn_hidden_visible_roundtrip",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });
      for (const itemId of ["before", "target", "after"]) {
        await serviceInternals.handleNotification({
          method: "item/started",
          params: {
            threadId: "thr_hidden_visible_roundtrip",
            turnId: "turn_hidden_visible_roundtrip",
            startedAtMs: 100,
            item: buildCommand(itemId),
          },
        });
      }

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_hidden_visible_roundtrip",
          turnId: "turn_hidden_visible_roundtrip",
          startedAtMs: 110,
          item: {
            id: "target",
            type: "enteredReviewMode",
            review: "Review target",
          },
        },
      });
      let snapshot = service.serializeConversationSnapshot("thr_hidden_visible_roundtrip");
      expect(JSON.stringify(snapshot?.turns[0]?.itemIds)).toBe(
        JSON.stringify(["before", "target", "after"]),
      );
      expect(JSON.stringify(snapshot?.turns[0]?.items.map((item) => item.itemId))).toBe(
        JSON.stringify(["before", "after"]),
      );

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_hidden_visible_roundtrip",
          turnId: "turn_hidden_visible_roundtrip",
          startedAtMs: 120,
          item: buildCommand("target"),
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_hidden_visible_roundtrip",
          turnId: "turn_hidden_visible_roundtrip",
          completedAtMs: 130,
          item: buildCommand("target", "completed"),
        },
      });

      snapshot = service.serializeConversationSnapshot("thr_hidden_visible_roundtrip");
      expect(JSON.stringify(snapshot?.turns[0]?.items.map((item) => item.itemId))).toBe(
        JSON.stringify(["before", "target", "after"]),
      );
      expect(snapshot?.turns[0]?.items[1]?.status).toBe("completed");
      expect(
        getCanonicalConversationState(service, "thr_hidden_visible_roundtrip")?.turns[0]?.items[1]
          ?.type,
      ).toBe("commandExecution");
    } finally {
      await service.shutdown();
    }
  });

  test("patchUpdated replaces a lifecycle identity and admits file completion", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      getConversationRecord: (threadId: string) => {};
    };
    const buildCommand = (id: string) => ({
      id,
      type: "commandExecution",
      command: `printf ${id}`,
      cwd: "/tmp",
      processId: null,
      source: "agent",
      status: "inProgress",
      commandActions: [],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    });

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_hidden_patch_replacement"),
        turns: [
          {
            threadId: "thr_hidden_patch_replacement",
            turnId: "turn_hidden_patch_replacement",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });
      for (const itemId of ["before", "target", "after"]) {
        await serviceInternals.handleNotification({
          method: "item/started",
          params: {
            threadId: "thr_hidden_patch_replacement",
            turnId: "turn_hidden_patch_replacement",
            startedAtMs: 100,
            item: buildCommand(itemId),
          },
        });
      }
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_hidden_patch_replacement",
          turnId: "turn_hidden_patch_replacement",
          startedAtMs: 110,
          item: {
            id: "target",
            type: "enteredReviewMode",
            review: "Review target",
          },
        },
      });

      const liveChanges: never[] = [];
      await serviceInternals.handleNotification({
        method: "item/fileChange/patchUpdated",
        params: {
          threadId: "thr_hidden_patch_replacement",
          turnId: "turn_hidden_patch_replacement",
          itemId: "target",
          changes: liveChanges,
        },
      });

      let snapshot = service.serializeConversationSnapshot("thr_hidden_patch_replacement");
      let target = snapshot?.turns[0]?.items.find((item) => item.itemId === "target");
      expect(snapshot?.turns[0]?.items.map((item) => item.itemId).join(",")).toBe("before,after");
      expect(target).toBeUndefined();
      expect(
        getCanonicalConversationState(service, "thr_hidden_patch_replacement")?.turns[0]?.items[1]
          ?.type,
      ).toBe("fileChange");

      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_hidden_patch_replacement",
          turnId: "turn_hidden_patch_replacement",
          completedAtMs: 150,
          item: {
            id: "target",
            type: "fileChange",
            status: "completed",
            changes: [
              {
                path: "src/final.ts",
                kind: { type: "add" },
                diff: "",
              },
            ],
          },
        },
      });

      snapshot = service.serializeConversationSnapshot("thr_hidden_patch_replacement");
      target = snapshot?.turns[0]?.items.find((item) => item.itemId === "target");
      expect(snapshot?.turns[0]?.items.map((item) => item.itemId).join(",")).toBe(
        "before,target,after",
      );
      expect(target?.kind).toBe("fileChange");
      expect(target?.status).toBe("completed");
      expect(getCodexFileChangePaths(target?.fileChange?.changes).join(",")).toBe("src/final.ts");
    } finally {
      await service.shutdown();
    }
  });

  test("rejects a hidden mismatched completion without removing the visible same-ID row", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_hidden_completion_mismatch"),
        turns: [
          {
            threadId: "thr_hidden_completion_mismatch",
            turnId: "turn_hidden_completion_mismatch",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_hidden_completion_mismatch",
          turnId: "turn_hidden_completion_mismatch",
          startedAtMs: 100,
          item: {
            id: "shared-id",
            type: "commandExecution",
            command: "pwd",
            cwd: "/tmp",
            processId: null,
            source: "agent",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_hidden_completion_mismatch",
          turnId: "turn_hidden_completion_mismatch",
          completedAtMs: 110,
          item: {
            id: "shared-id",
            type: "exitedReviewMode",
            review: "Mismatched hidden completion",
          },
        },
      });

      const item = service.serializeConversationSnapshot("thr_hidden_completion_mismatch")?.turns[0]
        ?.items[0];
      expect(item?.itemId).toBe("shared-id");
      expect((item?.rawItem as { type?: string } | undefined)?.type).toBe("commandExecution");
    } finally {
      await service.shutdown();
    }
  });

  test("persistently rebinds an actually empty completed null-ID placeholder before dropping a missing-item delta", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const threadId = "thr_empty_null_placeholder_delta";
    const reboundTurnId = "turn_claiming_empty_placeholder";

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail(threadId),
        turns: [
          {
            threadId,
            turnId: null as unknown as string,
            status: "completed",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId,
          turnId: reboundTurnId,
          itemId: "assistant-not-started",
          delta: "missing target still claims the empty placeholder",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      let snapshot = service.serializeConversationSnapshot(threadId);
      expect(snapshot?.turns.length ?? -1).toBe(1);
      expect(snapshot?.turns[0]?.turnId).toBe(reboundTurnId);
      expect(snapshot?.turns[0]?.status).toBe("inProgress");
      expect(snapshot?.turns[0]?.items.length ?? -1).toBe(0);
      expect(getCanonicalConversationState(service, threadId)?.turns[0]?.protocol.id).toBe(
        reboundTurnId,
      );

      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId,
          turnId: "turn_must_not_replace_persistent_rebind",
          itemId: "another-assistant-not-started",
          delta: "still missing",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      snapshot = service.serializeConversationSnapshot(threadId);
      expect(snapshot?.turns.length ?? -1).toBe(1);
      expect(snapshot?.turns[0]?.turnId).toBe(reboundTurnId);
      expect(snapshot?.turns[0]?.status).toBe("inProgress");
    } finally {
      await service.shutdown();
    }
  });

  test("uses canonical raw evidence, not legacy view mirrors, to decide null-ID rebinding", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      conversationRecords: Map<
        string,
        {
          itemsByTurn: Map<string, Map<string, CodexItemView>>;
        }
      >;
    };
    const recordThreadId = "thr_visible_record_null_placeholder";
    const transcriptThreadId = "thr_visible_transcript_null_placeholder";
    const nullTurnId = null as unknown as string;
    const makeVisibleItem = (threadId: string, itemId: string): CodexItemView => ({
      threadId,
      turnId: nullTurnId,
      itemId,
      type: "agentMessage",
      normalizedKind: "assistantMessage",
      semanticKind: "assistantMessage",
      role: "assistant",
      markdownText: "Already present",
      rawItem: {
        id: itemId,
        type: "agentMessage",
        text: "Already present",
        phase: null,
        memoryCitation: null,
      },
      createdAt: 1,
      updatedAt: 1,
    });

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail(recordThreadId),
        turns: [
          {
            threadId: recordThreadId,
            turnId: nullTurnId,
            status: "completed",
            itemIds: [],
          },
        ],
        transcript: [],
      });
      const recordItem = makeVisibleItem(recordThreadId, "assistant-recorded-outside-order");
      serviceInternals.conversationRecords
        .get(recordThreadId)
        ?.itemsByTurn.set(nullTurnId, new Map([[recordItem.itemId, recordItem]]));

      const transcriptItem = makeVisibleItem(
        transcriptThreadId,
        "assistant-transcript-outside-order",
      );
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail(transcriptThreadId),
        turns: [
          {
            threadId: transcriptThreadId,
            turnId: nullTurnId,
            status: "completed",
            itemIds: [],
          },
        ],
        transcript: [
          {
            ...transcriptItem,
            kind: "assistantMessage",
          },
        ],
      });

      for (const threadId of [recordThreadId, transcriptThreadId]) {
        await serviceInternals.handleNotification({
          method: "item/agentMessage/delta",
          params: {
            threadId,
            turnId: `turn_after_${threadId}`,
            itemId: "assistant-not-started",
            delta: "must not claim the placeholder",
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 30));

      const recordSnapshot = service.serializeConversationSnapshot(recordThreadId);
      expect(recordSnapshot?.turns.length ?? -1).toBe(1);
      expect(recordSnapshot?.turns[0]?.turnId).toBe(`turn_after_${recordThreadId}`);
      expect(recordSnapshot?.turns[0]?.status).toBe("inProgress");

      const transcriptSnapshot = service.serializeConversationSnapshot(transcriptThreadId);
      expect(transcriptSnapshot?.turns.length ?? -1).toBe(1);
      expect(
        (transcriptSnapshot?.turns[0] as { turnId: string | null } | undefined)?.turnId ?? null,
      ).toBe(null);
      expect(transcriptSnapshot?.turns[0]?.status).toBe("completed");
      expect(recordSnapshot?.turns[0]?.items.length).toBe(0);
      expect(service.serializeThreadDetail(transcriptThreadId)?.transcript[0]?.itemId).toBe(
        transcriptItem.itemId,
      );
    } finally {
      await service.shutdown();
    }
  });

  test("ignores item starts for unknown conversations without creating records", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      conversationRecords: Map<string, unknown>;
    };

    try {
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_unknown_item_lifecycle",
          turnId: "turn_unknown_item_lifecycle",
          startedAtMs: 100,
          item: {
            id: "unknown-command",
            type: "commandExecution",
            command: "pwd",
            cwd: "/tmp",
            processId: null,
            source: "agent",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          },
        },
      });

      expect(serviceInternals.conversationRecords.has("thr_unknown_item_lifecycle")).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("drops assistant frame-text deltas that arrive before item/started", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const threadMessages: CodexHostMessage[] = [];
    const mcpMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        threadMessages.push(message);
      }
      if (message.type === "mcpNotification") {
        mcpMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_streaming_missing_item"),
      turns: [
        {
          threadId: "thr_streaming_missing_item",
          turnId: "turn_streaming_missing_item",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_streaming_missing_item",
          turnId: "turn_streaming_missing_item",
          itemId: "assistant_missing_item",
          delta: "hello",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(threadMessages.length).toBe(0);
      expect(mcpMessages.length).toBe(0);
      const latest = projectConversationFromHostMessages(threadMessages);
      expect(Boolean(latest)).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("applies MCP progress structural repair when the derived detail projection is unavailable", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      applyMcpToolCallProgressUpdate: (
        update: CodexMcpToolCallProgressUpdate,
        suppressConversationSync: boolean,
      ) => void;
      getMaybeConversationRecord: (threadId: string) => {
        detail: CodexThreadDetail | null;
      } | null;
    };
    const threadId = "thr_mcp_progress_without_detail";
    const turnId = "turn_mcp_progress_without_detail";

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail(threadId),
        turns: [
          {
            threadId,
            turnId,
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId,
          turnId,
          item: makeProtocolAgentMessage({
            id: "assistant-before-mcp-progress",
            text: "",
          }),
        },
      });

      const record = serviceInternals.getMaybeConversationRecord(threadId);
      const canonical = record ? readTestCanonicalState(record) : null;
      if (record && canonical) {
        const firstTurn = canonical.turns[0];
        if (firstTurn) {
          acceptTestCanonicalState(record, {
            ...canonical,
            turns: [
              {
                ...firstTurn,
                sidecar: {
                  ...firstTurn.sidecar,
                  hookRuns: undefined,
                },
              },
            ],
          });
        }
      }
      expect(
        (record ? readTestCanonicalState(record) : null)?.turns[0]?.sidecar.hookRuns,
      ).toBeUndefined();
      if (record) record.detail = null;
      serviceInternals.applyMcpToolCallProgressUpdate(
        {
          conversationId: threadId,
          turnId,
          itemId: "missing-mcp-item",
          message: "working",
        },
        true,
      );

      expect((record ? readTestCanonicalState(record) : null)?.turns[0]?.sidecar.hookRuns).toEqual(
        [],
      );
      expect((record ? readTestCanonicalState(record) : null)?.turns[0]?.items.length).toBe(1);
    } finally {
      await service.shutdown();
    }
  });

  test("hot no-owner request patches preserve raw order and complete user/MCP synthetics on resolution", async () => {
    const service = createService();
    const threadId = "thr_request_lifecycle_hot_path";
    const turnId = "turn_request_lifecycle_hot_path";
    const serviceInternals = service as unknown as {
      serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];
    const notificationEvents: CodexThreadNotificationEvent[] = [];
    service.addThreadNotificationListener((event) => {
      notificationEvents.push(event);
    });
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") hostMessages.push(message);
    });
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      turns: [{ threadId, turnId, status: "inProgress", itemIds: [] }],
      transcript: [],
    });

    try {
      const baseConversation = await requestConversationSnapshotForTest(service, threadId);
      expect(baseConversation).not.toBeNull();
      const readAcceptedConversation = () =>
        conversationAggregatesByTestService.get(service)?.currentConversation(threadId)?.read()
          .acceptedReplica?.conversation;

      const originalSerializeConversationSnapshot =
        serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
      let serializeConversationSnapshotCallCount = 0;
      serviceInternals.serializeConversationSnapshot = (targetThreadId: string) => {
        serializeConversationSnapshotCallCount += 1;
        return originalSerializeConversationSnapshot(targetThreadId);
      };

      const userPromise = serviceInternals.handleServerRequest({
        id: 701,
        method: "item/tool/requestUserInput",
        params: {
          threadId,
          turnId,
          itemId: "user-request-hot-path",
          isBlocking: true,
          questions: [
            {
              id: "q-hot-path",
              header: "Hot path",
              question: "Continue?",
              isOther: false,
              isSecret: false,
            },
          ],
        },
      });
      const mcpPromise = serviceInternals.handleServerRequest({
        id: "702",
        method: "mcpServer/elicitation/request",
        params: {
          threadId,
          turnId,
          serverName: "fixture_server",
          mode: "openai/form",
          message: "Provide a fixture value",
          requestedSchema: { type: "object", properties: {} },
          _meta: null,
        },
      });
      await Promise.resolve();

      expect(serializeConversationSnapshotCallCount).toBe(0);
      expect(hostMessages).toHaveLength(0);
      const pendingConversation = readAcceptedConversation();
      expect(
        JSON.stringify(pendingConversation?.canonicalRequests?.map((request) => request.id) ?? []),
      ).toBe(JSON.stringify([701, "702"]));
      expect(pendingConversation?.hasUnreadTurn).toBe(true);
      expect(
        pendingConversation?.turns[0]?.items.find(
          (item) => item.itemId === "user-input-response-701",
        )?.status,
      ).toBe("inProgress");
      expect(
        pendingConversation?.turns[0]?.items.find(
          (item) => item.itemId === "mcp-server-elicitation-702",
        )?.status,
      ).toBe("inProgress");
      expect(
        notificationEvents.filter((event) => event.type === "user-input-requested"),
      ).toMatchObject([{ requestId: 701, questionCount: 1 }]);

      await serviceInternals.handleNotification({
        method: "serverRequest/resolved",
        params: {
          threadId,
          requestId: 701,
        },
      });
      await serviceInternals.handleNotification({
        method: "serverRequest/resolved",
        params: {
          threadId,
          requestId: "702",
        },
      });
      await serviceInternals.handleNotification({
        method: "serverRequest/resolved",
        params: {
          threadId,
          requestId: 701,
        },
      });

      const resolvedConversation = readAcceptedConversation();
      expect(serializeConversationSnapshotCallCount).toBe(0);
      expect(resolvedConversation?.canonicalRequests?.length ?? -1).toBe(0);
      expect(resolvedConversation?.hasUnreadTurn).toBe(true);
      const resolvedUserItem = resolvedConversation?.turns[0]?.items.find(
        (item) => item.itemId === "user-input-response-701",
      );
      const resolvedMcpItem = resolvedConversation?.turns[0]?.items.find(
        (item) => item.itemId === "mcp-server-elicitation-702",
      );
      expect(resolvedUserItem?.status).toBe("completed");
      expect((resolvedUserItem?.rawItem as { completed?: boolean } | undefined)?.completed).toBe(
        true,
      );
      expect(
        JSON.stringify((resolvedUserItem?.rawItem as { answers?: unknown } | undefined)?.answers),
      ).toBe(JSON.stringify({}));
      expect(resolvedMcpItem?.status).toBe("completed");
      expect((resolvedMcpItem?.rawItem as { completed?: boolean } | undefined)?.completed).toBe(
        true,
      );
      expect((resolvedMcpItem?.rawItem as { action?: unknown } | undefined)?.action).toBe(null);
      expect(notificationEvents.filter((event) => event.type === "request-resolved")).toMatchObject(
        [{ requestId: 701 }, { requestId: "702" }, { requestId: 701 }],
      );
      expect(await userPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(await mcpPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
    } finally {
      await service.shutdown();
    }
  });
});
