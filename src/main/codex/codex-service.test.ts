import { afterAll, describe, expect, test, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CodexBackgroundProcessRecord,
  CodexBackgroundProcessRow,
  CodexBackgroundProcessRunActionInput,
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexSubagentPanelHydrateInput,
  CodexAgentMode,
  CodexApprovalResponse,
  CodexApprovalKind,
  CodexConversationSnapshot,
  CodexCanonicalConversationState,
  CodexEvent,
  CodexGitSettings,
  CodexHostMessage,
  CodexItemView,
  CodexMcpServerElicitationResponse,
  CodexConversationThreadSettings,
  CodexPermissionMode,
  CodexPermissionState,
  CodexPlanImplementationServerRequest,
  CodexPromptInput,
  CodexScheduledAutomation,
  CodexSteerTurnInput,
  CodexThreadActionResult,
  CodexThreadDetail,
  CodexThreadStartForSessionInput,
  CodexThreadStartForSessionResult,
  CodexThreadOwnerStreamStatePublishInput,
  CodexThreadOwnerStreamStatePublishResult,
  CodexThreadStreamCheckpoint,
  CodexThreadSummary,
  CodexTurnSummary,
  CommandPaletteThreadSearchResult,
  CommandPaletteThreadSummary,
  ManagedWorktreeRecord,
  ManagedWorktreeSettings,
  Project,
  ProjectSession,
  ProjectSessionForkResult,
} from "../../shared/types";
import type {
  CodexUserInputAutoResolutionChange,
  CodexUserInputAutoResolutionEntry,
} from "../../shared/codex-user-input-auto-resolution";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import { TestCodexThreadSettingsRuntime } from "./codex-thread-settings-runtime.test-support";
import type {
  CodexPreparedThreadSettingsUpdate,
  CodexThreadSettingsUpdateCommand,
} from "../codex-application/CodexThreadSettingsRuntime";
import { TestCodexThreadTitlePersistence } from "./codex-thread-title-persistence.test-support";
import { TestCodexPostResumeGoalRuntime } from "./codex-post-resume-goal-runtime.test-support";
import { TestCodexConversationHistoryRuntime } from "./codex-conversation-history-runtime.test-support";
import { TestCodexBackgroundSubagentMetadataRepair } from "./codex-background-subagent-metadata-repair.test-support";
import { TestCodexQueuedFollowUpDispatchRuntime } from "./codex-queued-follow-up-dispatch-runtime.test-support";
import { TestCodexConversationDeltaBufferRuntime } from "./codex-conversation-delta-buffer-runtime.test-support";
import { TestCodexConversationResumeRuntime } from "./codex-conversation-resume-runtime.test-support";
import { TestCodexConversationEventBufferRuntime } from "./codex-conversation-event-buffer-runtime.test-support";
import { TestCodexFreshThreadLaunchRuntime } from "./codex-fresh-thread-launch-runtime.test-support";
import { TestCodexPendingServerRequestRuntime } from "./codex-pending-server-request-runtime.test-support";
import type { CodexThreadNotificationEvent } from "../../shared/codex-thread-notification";
import type {
  Thread,
  ThreadBackgroundTerminal,
  ThreadItem,
  ThreadGoal,
  ThreadGoalSetParams,
  ThreadForkResponse,
  ThreadResumeResponse,
  ThreadRollbackResponse,
  Turn,
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
  CodexPendingStartConversationRequest,
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeRequest,
} from "../../shared/codex-pending-worktree";
import {
  applyCodexConversationStateUpdates,
  buildCodexConversationStateUpdates,
} from "../../shared/codex-conversation-patches";
import { buildCodexThreadStreamCheckpoint } from "../../shared/codex-owner-follower-replication";
import type { CodexFrameTextDeltaUpdate } from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";
import type { CodexCommandOutputUpdate } from "../../shared/codex-conversation-state/codex-command-output-queue";
import type {
  CodexFileChangePatchUpdate,
  CodexMcpToolCallProgressUpdate,
} from "../../shared/codex-conversation-state/codex-file-change-stream";
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
import {
  TestCodexUserInputAutoResolutionController,
  USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS,
} from "./codex-user-input-auto-resolution.test-support";
import { TestCodexActiveGoalContinuation } from "./codex-active-goal-continuation.test-support";
import { DEFAULT_CODEX_OWNER_NOTIFICATION_DRAIN_TIMEOUT } from "../codex-application/CodexOwnerNotificationDrainRuntime";
import { makeCodexRendererConversationState } from "../codex-application/CodexRendererConversationRuntime";
import type {
  CodexApplicationEvent,
  CodexApplicationEventPublisher,
} from "../codex-application/CodexApplicationEventHub";
import { TestCodexOwnerNotificationDrainRuntime } from "./codex-owner-notification-drain-runtime.test-support";
import { TestCodexRendererOwnerRetention } from "./codex-renderer-owner-retention.test-support";
import {
  TestCodexSidebarSyncRuntime,
  TestDatabaseInvalidationSource,
} from "./codex-sidebar-sync-runtime.test-support";
import type { CodexForkSidePanelTransferRuntimePromiseAdapter } from "../codex-application/CodexForkSidePanelTransferRuntimePromiseAdapter";
import { removeManagedWorktree } from "./git-worktree-service";
import { runCodexGitCommand } from "./codex-git-command";
import type {
  CodexWorktreeWorkerCreateInput,
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerPort,
  CodexWorktreeWorkerRemoveInput,
} from "./codex-worktree-worker-port";
import { createInProcessCodexWorktreeWorkerPort } from "./codex-worktree-worker-port.test-support";
import type { CodexThreadHandoffJournalEntry } from "./codex-thread-handoff-journal";
import {
  PastedTextAttachmentManager,
  ThreadGoalAttachmentDirectoryManager,
} from "../thread-goal-attachments";
import type { NodexAgentAuthorityPort } from "../nodex-agent-authority-port";
import type { DesktopAutomationModulePort } from "../core-client/desktop-automation-module-bridge";
import type {
  DesktopProjectWorkspacePort,
  DesktopProjectWorkspaceSidebar,
  DesktopProjectWorkspaceThread,
  DesktopProjectWorkspaceThreadMoveInput,
} from "../core-client/project-workspace-adapter";
import { PersistedAtomStore } from "../local-store/persisted-atoms";
import { CodexApplicationRequestPending } from "../codex-application/ApprovalCoordinator";
import { makeLocalExecutionHostRegistry } from "../codex-application/ExecutionHostRuntime";
import { makeManagedWorktreeRuntimeTestHarness } from "../codex-application/ManagedWorktreeRuntime.test-support";
import { normalizeCodexThreadGoalSetAction } from "../codex-application/CodexThreadGoalRuntime";
import type { CodexThreadGoalRuntimePromiseAdapter } from "../codex-application/CodexThreadGoalRuntimePromiseAdapter";
import type { CodexSidebarSweepRuntimePromiseAdapter } from "../codex-application/CodexSidebarSweepRuntimePromiseAdapter";
import { makeProjectRuntimeLifecycleTestHarness } from "../host-runtime/ProjectRuntimeLifecycleRuntime.test-support";
import { CodexPendingWorktreeRuntime } from "./codex-pending-worktree-runtime.test-support";

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
  resolveThreadSummary: (
    threadId: string,
  ) => Promise<import("../../shared/types").CodexThreadSummary | null>;
  sidebarSync: import("../codex-application/CodexSidebarSyncRuntimePromiseAdapter").CodexSidebarSyncRuntimePromiseAdapter;
  threadCatalog: import("../codex-application/CodexThreadCatalogPromiseAdapter").CodexThreadCatalogPromiseAdapter;
  threadReadState: import("../codex-application/CodexThreadReadStatePromiseAdapter").CodexThreadReadStatePromiseAdapter;
  searchCommandPaletteThreads: (input: {
    query: string;
    limit?: number;
  }) => Promise<CommandPaletteThreadSearchResult[]>;
  requestConversationSnapshot: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  requestConversationResume: (
    threadId: string,
    options?: { syncDormantConversationSnapshots?: boolean; replayBufferedNotifications?: boolean },
  ) => Promise<CodexConversationSnapshot | null>;
  requestRendererConversationResume: (
    threadId: string,
    ownerClientId: string,
  ) => Promise<import("../../shared/types").CodexRendererConversationResumeResult | null>;
  freshThreadLaunch: import("../codex-application/CodexFreshThreadLaunchRuntimePromiseAdapter").CodexFreshThreadLaunchRuntimePromiseAdapter;
  releaseConversationResumeBuffer: (threadId: string) => Promise<boolean>;
  replayRendererOwnerPendingRequests: (threadId: string, ownerClientId: string) => number;
  ackRendererThreadOwnerNotification: (
    sourceClientId: string,
    input: { conversationId: string; sequence: number },
  ) => boolean;
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
  startSideChat: (input: {
    parentThreadId: string;
    parentNavigationPath?: string | null;
    prompt?: string;
    permissionMode?: CodexPermissionMode;
    model?: string;
    serviceTier?: null | "fast";
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    collaborationMode?: "default" | "plan";
    promptInput?: CodexPromptInput;
  }) => Promise<{
    parentThreadId: string;
    threadId: string;
    conversation: CodexConversationSnapshot;
  }>;
  discardSideChat: (threadId: string) => Promise<boolean>;
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
  enqueueQueuedFollowUpPrompt: (
    threadId: string,
    prompt: string,
    opts?: {
      model?: string;
      serviceTier?: null | "fast";
      reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
      permissionMode?: CodexPermissionMode;
      collaborationMode?: "default" | "plan";
      promptInput?: CodexPromptInput;
    },
  ) => Promise<void>;
  sendQueuedFollowUpNow: (threadId: string, followUpId: string) => Promise<void>;
  respondToMcpServerElicitation: (
    requestId: string | number,
    response: "accept" | "decline" | "cancel" | CodexMcpServerElicitationResponse,
    conversationId?: string,
  ) => Promise<boolean>;
  startThreadForSession: (
    input: CodexThreadStartForSessionInput,
  ) => Promise<CodexThreadStartForSessionResult>;
  interruptTurn: (threadId: string, turnId?: string) => Promise<boolean>;
  cleanBackgroundTerminals: (threadId: string) => Promise<boolean>;
  cleanBackgroundTerminalsSilently: (threadId: string) => Promise<boolean>;
  listBackgroundProcessRows: (input: {
    threadId: string;
    observedTerminals?: ThreadBackgroundTerminal[];
  }) => Promise<CodexBackgroundProcessRow[]>;
  registerBackgroundProcessRunAction: (
    input: CodexBackgroundProcessRunActionInput,
  ) => Promise<CodexBackgroundProcessRow[]>;
  setProjectWorkspacePort: (port: DesktopProjectWorkspacePort) => void;
  setAutomationModule: (port: DesktopAutomationModulePort) => void;
  setNodexAgentAuthorityPort: (port: NodexAgentAuthorityPort) => void;
  markSubagentThreadOpened: (threadId: string) => boolean;
  hydrateBackgroundSubagentThreads: (
    input: CodexBackgroundSubagentThreadsHydrateInput,
  ) => Promise<CodexThreadSummary[]>;
  hydrateSubagentPanel: (input: CodexSubagentPanelHydrateInput) => Promise<CodexThreadSummary[]>;
  respondToUserInput: (
    requestId: string | number,
    answers: Record<string, string[]>,
  ) => Promise<boolean>;
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
  listManagedWorktrees: () => Promise<ManagedWorktreeRecord[]>;
  deleteManagedWorktree: (hostId: string, worktreePath: string) => Promise<boolean>;
  inspectThreadManagedWorktree: (
    threadId: string,
  ) => Promise<import("../../shared/types").ManagedWorktreeAvailability>;
  restoreThreadManagedWorktree: (
    threadId: string,
  ) => Promise<import("../../shared/types").ManagedWorktreeRestoreResult>;
  reconcileArchivedThreadManagedWorktree: (
    thread: DesktopProjectWorkspaceThread,
    reason: "archive" | "automation-archive",
  ) => Promise<void>;
  runManagedWorktreeRetentionSweep: CodexService["runManagedWorktreeRetentionSweep"];
  prepareThreadSettingsUpdate: (
    input: CodexThreadSettingsUpdateCommand,
    signal: AbortSignal,
  ) => Promise<CodexPreparedThreadSettingsUpdate>;
  removePlanImplementationRequest: (threadId: string, turnId: string) => Promise<boolean>;
  setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
  setRendererConversationViewActive: (
    threadId: string,
    clientId: string | null | undefined,
    active: boolean,
  ) => void;
  getRendererConversationOwner: (threadId: string) => string | null;
  handleRendererOwnerAppServerRequest: (
    sourceClientId: string | null,
    input: import("../../shared/types").CodexOwnerAppServerRequestInput,
  ) => Promise<unknown>;
  handleRendererClientDisposed: (clientId: string) => void;
  publishRendererThreadStreamStateChange: (
    sourceClientId: string,
    input: CodexThreadOwnerStreamStatePublishInput,
  ) => CodexThreadOwnerStreamStatePublishResult;
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
  const record = (
    service as unknown as {
      getMaybeConversationRecord: (id: string) => {
        canonicalState: CodexCanonicalConversationState | null;
      } | null;
    }
  ).getMaybeConversationRecord(threadId);
  return record?.canonicalState ?? null;
}

function makeConversationSnapshot(input: {
  threadId: string;
  text?: string;
  revision?: number;
}): CodexConversationSnapshot {
  return {
    ...makeThreadDetail(input.threadId),
    resumeState: "resumed",
    turns: [
      {
        threadId: input.threadId,
        turnId: "turn-1",
        status: "inProgress",
        itemIds: ["assistant-1"],
        items: [
          {
            threadId: input.threadId,
            turnId: "turn-1",
            itemId: "assistant-1",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            status: "inProgress",
            markdownText: input.text ?? "",
            createdAt: input.revision ?? 1,
            updatedAt: input.revision ?? 1,
          },
        ],
      },
    ],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: false,
      canForkFromTurn: false,
      canSearch: false,
      canCollapseTurns: false,
    },
  };
}

function buildTestStreamCheckpoint(
  conversation: CodexConversationSnapshot,
  revision: number,
  ownerEpoch = 1,
): CodexThreadStreamCheckpoint {
  return buildCodexThreadStreamCheckpoint({
    ownerEpoch,
    revision,
    conversation,
  });
}

function buildTestSnapshotPublication(input: {
  conversation: CodexConversationSnapshot;
  revision: number;
  baseCheckpoint?: CodexThreadStreamCheckpoint | null;
  ownerEpoch?: number;
  ownerNotificationSequence?: number;
}): CodexThreadOwnerStreamStatePublishInput {
  const checkpoint = buildTestStreamCheckpoint(
    input.conversation,
    input.revision,
    input.ownerEpoch ?? 1,
  );
  return {
    conversationId: input.conversation.threadId,
    change: {
      type: "snapshot",
      revision: input.revision,
      conversationState: input.conversation,
    },
    baseCheckpoint: input.baseCheckpoint ?? null,
    checkpoint,
    ownerNotificationSequence: input.ownerNotificationSequence,
  };
}

function buildTestPatchPublication(input: {
  before: CodexConversationSnapshot;
  after: CodexConversationSnapshot;
  baseCheckpoint: CodexThreadStreamCheckpoint;
  revision?: number;
  patches?: ReturnType<typeof buildCodexConversationStateUpdates>;
  ownerNotificationSequence?: number;
}): CodexThreadOwnerStreamStatePublishInput {
  const revision = input.revision ?? input.baseCheckpoint.revision + 1;
  return {
    conversationId: input.before.threadId,
    change: {
      type: "patches",
      baseRevision: input.baseCheckpoint.revision,
      revision,
      patches: input.patches ?? buildCodexConversationStateUpdates(input.before, input.after),
    },
    baseCheckpoint: input.baseCheckpoint,
    checkpoint: buildTestStreamCheckpoint(input.after, revision, input.baseCheckpoint.ownerEpoch),
    ownerNotificationSequence: input.ownerNotificationSequence,
  };
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
const MANAGED_WORKTREE_TEST_HARNESS_RELEASES: Array<() => Promise<void>> = [];
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
  peekRunAutomationId: () => null,
  peekActiveHeartbeatAutomationId: () => null,
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
  await Promise.all([
    ...MANAGED_WORKTREE_TEST_HARNESS_RELEASES.map((close) => close()),
    ...PROJECT_RUNTIME_TEST_HARNESS_RELEASES.map((close) => close()),
  ]);
  if (PREVIOUS_TEST_NODEX_HOME === undefined) delete process.env.NODEX_HOME;
  else process.env.NODEX_HOME = PREVIOUS_TEST_NODEX_HOME;
  fs.rmSync(DEFAULT_TEST_LOCAL_STORE_ROOT, { recursive: true, force: true });
  fs.rmSync(DEFAULT_TEST_THREAD_GOAL_ATTACHMENTS_ROOT, { recursive: true, force: true });
});

function createUserInputAutoResolutionTestClock() {
  let now = 1_000;
  let nextId = 0;
  const timers = new Map<
    number,
    {
      callback: () => void;
      deadline: number;
    }
  >();

  return {
    now: () => now,
    setTimeout: (callback: () => void, timeoutMs: number) => {
      const id = ++nextId;
      timers.set(id, {
        callback,
        deadline: now + timeoutMs,
      });
      return id;
    },
    clearTimeout: (timer: unknown) => {
      timers.delete(timer as number);
    },
    advanceBy: (durationMs: number) => {
      const target = now + durationMs;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.deadline <= target)
          .sort((left, right) => left[1].deadline - right[1].deadline)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].deadline;
        due[1].callback();
      }
      now = target;
    },
  };
}

const permissionStateByTestService = new WeakMap<
  object,
  Map<string | null, CodexPermissionState>
>();

function createService(options?: {
  runtimeStateHome?: string;
  inactiveRendererOwnerRetentionMs?: number;
  inactiveRendererOwnerMaxRetained?: number;
  inactiveRendererOwnerRetryMs?: number;
  supportsChatGptApps?: boolean;
  gitSettingsResolver?: () => CodexGitSettings;
  managedWorktreeSettings?: ManagedWorktreeSettings;
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
  loadWorktreeSetupBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>;
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
  let managedWorktreeSettings: ManagedWorktreeSettings = options?.managedWorktreeSettings ?? {
    worktreeRoot: null,
    autoDeleteEnabled: true,
    autoDeleteLimit: 15,
  };
  const managedWorktreeSettingsPort = {
    read: () => managedWorktreeSettings,
    update: (input: {
      readonly worktreeRoot?: string | null;
      readonly autoDeleteEnabled?: boolean;
      readonly autoDeleteLimit?: number;
    }) => {
      managedWorktreeSettings = {
        worktreeRoot:
          input.worktreeRoot === undefined
            ? managedWorktreeSettings.worktreeRoot
            : input.worktreeRoot,
        autoDeleteEnabled: input.autoDeleteEnabled ?? managedWorktreeSettings.autoDeleteEnabled,
        autoDeleteLimit: input.autoDeleteLimit ?? managedWorktreeSettings.autoDeleteLimit,
      };
      return managedWorktreeSettings;
    },
    listKnownRoots: () => [],
  };
  const runtimeStateHome =
    options?.runtimeStateHome ?? path.join(DEFAULT_TEST_LOCAL_STORE_ROOT, "agent");
  const executionHosts = makeLocalExecutionHostRegistry({
    runtimeStateHome,
    nodexHome: DEFAULT_TEST_LOCAL_STORE_ROOT,
    localWorktreeWorker: createInProcessCodexWorktreeWorkerPort({
      hostId: "local",
      loadBaseEnvironment: options?.loadWorktreeSetupBaseEnvironment,
    }),
    managedWorktrees: managedWorktreeSettingsPort,
  });
  const managedWorktreeHarness = makeManagedWorktreeRuntimeTestHarness(executionHosts);
  MANAGED_WORKTREE_TEST_HARNESS_RELEASES.push(managedWorktreeHarness.close);
  const projectRuntimeLifecycleHarness = makeProjectRuntimeLifecycleTestHarness();
  PROJECT_RUNTIME_TEST_HARNESS_RELEASES.push(projectRuntimeLifecycleHarness.close);
  const threadHandoffRuntimeAdapter = {
    start: async (input, effects) => {
      const signal = new AbortController().signal;
      const source = await effects.resolveSource(input.threadId, signal);
      const createdAt = Date.now();
      await effects.stopActiveTurn(input.threadId, signal);
      const preparation = await effects.prepareDestination(
        {
          schemaVersion: 1,
          operationId: input.operationId,
          threadId: input.threadId,
          phase: "preparing-destination",
          source,
          requestedDestinationHostId: input.destinationHostId,
          destination: null,
          prepared: null,
          runtimeSwitched: false,
          coreCommitted: false,
          followUpPrompt: input.followUpPrompt,
          followUpDispatchStarted: false,
          warnings: [],
          lastError: null,
          failedPhase: null,
          createdAt,
          updatedAt: createdAt,
          completedAt: null,
        },
        () => undefined,
        signal,
      );
      await effects.switchRuntime(input.threadId, preparation.destination, preparation, signal);
      await effects.commitLocation(input.threadId, preparation.destination, signal);
      await effects.projectLocation(input.threadId, preparation.destination, signal);
      await effects.transferOwner(input.threadId, preparation, signal);
      const warnings = await effects.cleanup(preparation, "committed", signal);
      if (input.followUpPrompt) {
        await effects.sendFollowUp(input.threadId, input.followUpPrompt, signal);
      }
      const completedAt = Date.now();
      return {
        schemaVersion: 1,
        operationId: input.operationId,
        threadId: input.threadId,
        phase: warnings.length === 0 ? "completed" : "completed-with-warning",
        source,
        requestedDestinationHostId: input.destinationHostId,
        destination: preparation.destination,
        prepared: preparation.prepared,
        runtimeSwitched: true,
        coreCommitted: true,
        followUpPrompt: input.followUpPrompt,
        followUpDispatchStarted: input.followUpPrompt !== null,
        warnings,
        lastError: null,
        failedPhase: null,
        createdAt,
        updatedAt: completedAt,
        completedAt,
      } satisfies CodexThreadHandoffJournalEntry;
    },
    recover: async () => [],
    launch: async () => {
      throw new Error("The Codex service test fixture does not launch background handoffs");
    },
    get: async () => null,
    waitForRevision: async () => null,
  } satisfies import("../codex-application/CodexThreadHandoffRuntimePromiseAdapter").CodexThreadHandoffRuntimePromiseAdapter;
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
  const autoResolutionResolvers = new Map<
    string,
    { readonly requestId: string | number; readonly resolve: () => Promise<void> }
  >();
  const autoResolution = new TestCodexUserInputAutoResolutionController({
    ...options?.userInputAutoResolutionTimer,
    isConversationPresented: (conversationId) =>
      service?.isRendererConversationPresentedInForeground(conversationId) === true,
    onChange: (change) => applicationEventEmitter.emit("userInputAutoResolutionChanged", change),
    onResolve: async (conversationId, requestId) => {
      const pending = autoResolutionResolvers.get(conversationId);
      if (
        !pending ||
        typeof pending.requestId !== typeof requestId ||
        pending.requestId !== requestId
      ) {
        return;
      }
      await pending.resolve();
    },
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
  const rendererOwnerRetention = new TestCodexRendererOwnerRetention({
    retentionMs: Math.max(0, options?.inactiveRendererOwnerRetentionMs ?? 60 * 60 * 1_000),
    maxRetained: Math.max(0, Math.floor(options?.inactiveRendererOwnerMaxRetained ?? 4)),
    retryMs: Math.max(0, options?.inactiveRendererOwnerRetryMs ?? 15_000),
    isCandidate: (conversationId) =>
      service?.isInactiveRendererOwnerCandidate(conversationId) === true,
    cleanup: async (conversationId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const client = Reflect.get(service as object, "client") as {
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      await client.request("thread/unsubscribe", { threadId: conversationId });
      service.commitInactiveRendererOwnerCleanup(conversationId);
    },
  });
  const projectWorkspace = options?.projectWorkspace ?? createTestProjectWorkspace();
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
  const threadReadState = {
    persistProjected: async (input: { threadId: string; hasUnreadTurn: boolean }) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.persistThreadReadStateProjection(input.threadId, input.hasUnreadTurn);
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
    removeWorktree: async (hostId, worktreeGitRoot) => {
      await managedWorktreeHarness.adapter.remove({
        hostId,
        worktreeGitRoot,
        reason: "cancel",
      });
    },
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
    archive: async (threadId: string) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const client = Reflect.get(service, "client") as {
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      await client.request("thread/archive", { threadId });
      return await service.applyThreadArchiveProjection(threadId);
    },
    unarchive: async (threadId: string) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const client = Reflect.get(service, "client") as {
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      await client.request("thread/unarchive", { threadId });
      return await service.applyThreadUnarchiveProjection(threadId);
    },
  };
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
  const conversationHistory = new TestCodexConversationHistoryRuntime({
    shouldLoadRemaining: (threadId) => service?.shouldLoadRemainingThreadTurns(threadId) === true,
    load: async (input) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.loadConversationHistory(input);
    },
    snapshot: (threadId) => service?.serializeConversationSnapshot(threadId) ?? null,
  });
  const backgroundSubagentMetadataRepair = new TestCodexBackgroundSubagentMetadataRepair({
    isRepairNeeded: (parentThreadId, childThreadId) =>
      service?.isBackgroundSubagentMetadataRepairNeeded(parentThreadId, childThreadId) === true,
    repair: async (parentThreadId, childThreadId) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.repairBackgroundSubagentMetadata(parentThreadId, childThreadId);
    },
  });
  const queuedFollowUpDispatch = new TestCodexQueuedFollowUpDispatchRuntime({
    isEligible: (threadId) => service?.isQueuedFollowUpDispatchEligible(threadId) === true,
    take: (threadId) => service?.takeQueuedFollowUpForDispatch(threadId) ?? null,
    submit: async (threadId, followUp) => {
      if (!service) throw new Error("Codex test service is not constructed");
      await service.submitQueuedFollowUp(threadId, followUp);
    },
    restore: (threadId, followUp, reason) =>
      service?.restoreQueuedFollowUp(threadId, followUp, reason),
  });
  const conversationDeltaBuffer = new TestCodexConversationDeltaBufferRuntime({
    flushFrameText: (updates) => service?.applyFrameTextDeltas(updates),
    flushCommandOutput: (updates) => service?.applyOutputDeltas(updates),
  });
  const conversationResume = new TestCodexConversationResumeRuntime({
    run: async (input) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.runConversationResume(input);
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
  const freshThreadLaunch = new TestCodexFreshThreadLaunchRuntime({
    adopt: async (launch) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.adoptFreshThreadLaunch(launch);
    },
    readAdopted: async (launch) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.readAdoptedFreshThreadLaunch(launch);
    },
    start: async (launch) => {
      if (!service) throw new Error("Codex test service is not constructed");
      return await service.runFreshThreadLaunchFirstTurn(launch);
    },
    abandon: (launch, reason) => service?.abandonFreshThreadLaunch(launch, reason),
  });
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
    scheduleRemainingTurns: (threadId) => service?.scheduleRemainingThreadTurnsLoad(threadId),
  });
  const pendingServerRequests = new TestCodexPendingServerRequestRuntime({
    respond: (threadId, _requestId, occurrenceToken, response) => {
      completeResponse(threadId, occurrenceToken, { kind: "success", value: response });
    },
    reject: (threadId, _requestId, occurrenceToken, reason) => {
      completeResponse(threadId, occurrenceToken, { kind: "failure", reason });
    },
  });
  const testService = new CodexService({
    applicationEvents,
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
    userInputAutoResolution: {
      observeRequest: (conversationId, requestId, resolve) => {
        autoResolutionResolvers.set(conversationId, { requestId, resolve });
        autoResolution.observeRequest(conversationId, requestId);
      },
      observeResponse: (conversationId, requestId) => {
        autoResolution.observeResponse(conversationId, requestId);
        const pending = autoResolutionResolvers.get(conversationId);
        if (
          pending &&
          typeof pending.requestId === typeof requestId &&
          pending.requestId === requestId
        ) {
          autoResolutionResolvers.delete(conversationId);
        }
      },
      observeServerResolution: (conversationId, requestId) => {
        autoResolution.observeServerResolution(conversationId, requestId);
        const pending = autoResolutionResolvers.get(conversationId);
        if (
          pending &&
          typeof pending.requestId === typeof requestId &&
          pending.requestId === requestId
        ) {
          autoResolutionResolvers.delete(conversationId);
        }
      },
      reevaluatePresentation: (conversationId) =>
        autoResolution.reevaluatePresentation(conversationId),
      clearConversation: (conversationId) => {
        autoResolution.clearConversation(conversationId);
        autoResolutionResolvers.delete(conversationId);
      },
      reconcilePendingRequests: (conversationId, requestIds) => {
        autoResolution.reconcilePendingRequests(conversationId, requestIds);
        if (autoResolution.snapshot().some((entry) => entry.conversationId === conversationId)) {
          return;
        }
        autoResolutionResolvers.delete(conversationId);
      },
      handleDisconnect: () => {
        autoResolution.handleDisconnect();
        autoResolutionResolvers.clear();
      },
    },
    activeGoalContinuation,
    ownerNotificationDrain,
    rendererConversations: makeCodexRendererConversationState(),
    rendererOwnerRetention,
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
    threadHandoffRuntime: threadHandoffRuntimeAdapter,
    pendingWorktrees,
    threadSettingsRuntime,
    threadTitlePersistence,
    threadCatalog,
    threadReadState,
    conversationCommands,
    postResumeGoals,
    conversationHistory,
    backgroundSubagentMetadataRepair,
    queuedFollowUpDispatch,
    conversationDeltaBuffer,
    conversationResume,
    conversationEventBuffer,
    freshThreadLaunch,
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
    client: new TestCodexGatewayPromiseClient(),
    runtime: TEST_CODEX_RUNTIME,
    runtimeStateHome,
    nodexAgentDynamicService: null,
    nodexAgentAuthorization: {
      authorize: async () => "unavailable",
      extendTaskAccess: async () => undefined,
      getTaskAccess: async () => undefined,
      revokeRoot: async () => undefined,
    },
    executionHosts,
    managedWorktrees: managedWorktreeHarness.adapter,
    managedWorktreeRetention: {
      // Scheduling semantics have a dedicated Effect TestClock suite; Codex tests exercise policy.
      request: () => undefined,
      run: (sweep) => sweep(),
    },
    projectRuntimeLifecycle: projectRuntimeLifecycleHarness.adapter,
    supportsChatGptApps: options?.supportsChatGptApps,
    projectAwareDeveloperInstructionsResolver: options?.projectAwareDeveloperInstructionsResolver,
    gitSettingsResolver: options?.gitSettingsResolver,
    managedWorktreeSettingsPort,
    threadCodexConfigBuilder: options?.threadCodexConfigBuilder,
    projectlessHomeDirectory:
      options?.projectlessHomeDirectory ?? (() => DEFAULT_TEST_LOCAL_STORE_ROOT),
    loadWorktreeSetupBaseEnvironment: options?.loadWorktreeSetupBaseEnvironment,
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
      rendererOwnerRetention.dispose();
      sidebarSync.dispose();
      pendingWorktrees.shutdown();
      conversationDeltaBuffer.dispose();
      conversationResume.dispose();
      await freshThreadLaunch.shutdown();
      await conversationEventBuffer.shutdown(new Error("Codex test service is shutting down"));
      await sidebarSweep.cancel();
      await pendingServerRequests.shutdown(new Error("Codex test service is shutting down"));
    } finally {
      await managedWorktreeHarness.close();
    }
  };
  permissionStateByTestService.set(testService, permissionStateByScope);
  testService.setAutomationModule(options?.automationModule ?? createTestAutomationModule());
  testService.setProjectWorkspacePort(projectWorkspace);
  testService.setNodexAgentAuthorityPort(TEST_NODEX_AGENT_AUTHORITY);
  const internals = testService as unknown as {
    getMaybeConversationRecord: (threadId: string) => {
      canonicalState: CodexCanonicalConversationState | null;
      detail: CodexThreadDetail | null;
      serverRequests: CodexCanonicalConversationState["requests"];
      hasUnreadTurn: boolean;
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
      record.canonicalState &&
      detailTurnIds.every((turnId) =>
        record.canonicalState?.turns.some((turn) => turn.protocol.id === turnId),
      ) &&
      (!hasNullTurn || record.canonicalState.turns.some((turn) => turn.protocol.id === null)) &&
      detailRawItemIds.every((itemId) =>
        record.canonicalState?.turns.some((turn) => turn.items.some((item) => item.id === itemId)),
      )
    ) {
      return;
    }

    const turns = detail.turns.map((turn, turnIndex): Turn => {
      const nullableTurnId = (turn as { turnId: string | null }).turnId;
      const protocolTurnId = nullableTurnId ?? `fixture-null-turn-${turnIndex}`;
      const existing =
        nullableTurnId === null
          ? record.canonicalState?.turns[turnIndex]
          : record.canonicalState?.turns.find(
              (candidate) => candidate.protocol.id === nullableTurnId,
            );
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
    record.canonicalState = {
      ...canonical,
      requests: [...record.serverRequests],
      sidecar: {
        ...canonical.sidecar,
        hasUnreadTurn: record.hasUnreadTurn,
        latestThreadSettings: record.canonicalState?.sidecar.latestThreadSettings ?? null,
        latestTokenUsageInfo:
          record.latestTokenUsageInfo ??
          record.canonicalState?.sidecar.latestTokenUsageInfo ??
          null,
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
            ? record.canonicalState?.turns[turnIndex]
            : record.canonicalState?.turns.find(
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
    };
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
        const canonical = internals.getMaybeConversationRecord(threadId)?.canonicalState;
        const hasTurn =
          turnId === null
            ? (canonical?.turns.length ?? 0) > 0
            : canonical?.turns.some((turn) => turn.protocol.id === turnId) === true;
        if (requiresFullCanonicalSync || !canonical || (!isThreadMetadata && !hasTurn)) {
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
  const steerService = testService as unknown as {
    steerTurn: (
      input: CodexSteerTurnInput,
      options?: { syncDormantConversationUpdates?: boolean },
    ) => Promise<{ turnId: string } | null>;
  };
  const steerTurn = steerService.steerTurn.bind(testService);
  steerService.steerTurn = async (input, steerOptions) => {
    syncCanonicalFixture(input.threadId);
    return await steerTurn(input, steerOptions);
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

function makeRecordingForkSidePanelTransferLifecycle(
  events: string[],
): CodexForkSidePanelTransferRuntimePromiseAdapter & {
  readonly failCapture: () => void;
} {
  let captureFailure = false;
  return {
    stageDirect: async ({ sourceConversationId, targetConversationId }) => {
      events.push(`direct:${sourceConversationId}:${targetConversationId}`);
    },
    capturePending: async ({ pendingWorktreeId, sourceConversationId, sourceWorkspaceRoot }) => {
      if (captureFailure) {
        events.push("capture-failed");
        throw new Error("snapshot capture failed");
      }
      events.push(`capture:${pendingWorktreeId}:${sourceConversationId}:${sourceWorkspaceRoot}`);
    },
    promotePending: async ({ pendingWorktreeId, targetConversationId, targetWorkspaceRoot }) => {
      events.push(`promote:${pendingWorktreeId}:${targetConversationId}:${targetWorkspaceRoot}`);
      return true;
    },
    discardPending: async (pendingWorktreeId) => {
      events.push(`discard:${pendingWorktreeId}`);
    },
    consumeTarget: async ({ targetConversationId, targetProjectSessionId }) => {
      events.push(`consume:${targetConversationId}:${targetProjectSessionId}`);
      return null;
    },
    failCapture: () => {
      captureFailure = true;
    },
  };
}

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

test("repairs a leaked child sidebar Session before returning it", async () => {
  const baseWorkspace = createTestProjectWorkspace();
  const updateCalls: Array<{
    threadId: string;
    patch: Parameters<DesktopProjectWorkspacePort["updateThread"]>[1];
  }> = [];
  const projectWorkspace = {
    ...baseWorkspace,
    updateThread: async (
      threadId: string,
      patch: Parameters<DesktopProjectWorkspacePort["updateThread"]>[1],
    ) => {
      updateCalls.push({ threadId, patch });
      return await baseWorkspace.updateThread(threadId, patch);
    },
  } as DesktopProjectWorkspacePort;
  await projectWorkspace.upsertThread("thread:child", {
    projectId: null,
    parentThreadId: "thread:root",
    threadName: "Leaked subagent chat",
    threadPreview: "Leaked subagent chat",
  });
  const service = createService({ projectWorkspace });

  try {
    const repaired = await (
      service as unknown as {
        ensureSidebarThreadSession: (threadId: string) => Promise<ProjectSession | null>;
      }
    ).ensureSidebarThreadSession("thread:child");

    expect(repaired).toBeNull();
    expect(updateCalls).toEqual([
      {
        threadId: "thread:child",
        patch: { parentThreadId: "thread:root" },
      },
    ]);
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
      resumeState: string;
      streamRole: string | null;
      isStreaming: boolean;
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
  const record = serviceInternals.getConversationRecord(threadId);
  record.resumeState = "resumed";
  record.streamRole = "owner";
  record.isStreaming = true;
  service.setRendererConversationOwner(threadId, input.ownerClientId ?? "renderer-owner");
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

describe("codex-service renderer owner stream publishing", () => {
  test("forwards migrated live notification rows to renderer owner without source-null stream patches", async () => {
    const service = createService();
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
      if (message.message.type !== "threadOwnerNotification") return;
      service.ackRendererThreadOwnerNotification(message.targetClientId, {
        conversationId: "thread-owner-migrated",
        sequence: message.message.sequence,
      });
    });
    const serviceInternals = service as unknown as {
      handleNotification: (
        notification: CodexTestServerNotification,
        options?: { bypassResumeBuffer?: boolean },
      ) => Promise<void>;
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-owner-migrated",
        ownerClientId: "owner-a",
        turnStatus: "inProgress",
        statusType: "active",
      });

      await serviceInternals.handleNotification({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-owner-migrated",
          tokenUsage: {
            total: {
              totalTokens: 100,
              inputTokens: 60,
              cachedInputTokens: 10,
              outputTokens: 40,
              reasoningOutputTokens: 15,
            },
            last: {
              totalTokens: 20,
              inputTokens: 12,
              cachedInputTokens: 2,
              outputTokens: 8,
              reasoningOutputTokens: 3,
            },
            modelContextWindow: 128000,
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "turn/plan/updated",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          explanation: "Plan",
          plan: [{ step: "Patch owner reducer", status: "completed" }],
        },
      });
      await serviceInternals.handleNotification({
        method: "model/safetyBuffering/updated",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          model: "gpt-5.4-codex",
          useCases: ["latency"],
          reasons: ["warming"],
          showBufferingUi: true,
          fasterModel: "gpt-5.4-mini",
        },
      });
      await serviceInternals.handleNotification({
        method: "model/rerouted",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          fromModel: "gpt-5.4-codex",
          toModel: "gpt-5.4-mini",
          reason: "highRiskCyberActivity",
        },
      });
      await serviceInternals.handleNotification({
        method: "hook/started",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          run: {
            id: "hook-run-1",
            eventName: "preToolUse",
            status: "running",
            statusMessage: "Preparing context",
            entries: [{ kind: "context", text: "Added AGENTS.md" }],
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "hook/completed",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          run: {
            id: "hook-run-1",
            eventName: "preToolUse",
            status: "completed",
            statusMessage: "Preparing context",
            entries: [{ kind: "context", text: "Added AGENTS.md" }],
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "item/autoApprovalReview/started",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          reviewId: "review-1",
          targetItemId: "item-command-1",
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
      await serviceInternals.handleNotification({
        method: "item/autoApprovalReview/completed",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          reviewId: "review-1",
          targetItemId: "item-command-1",
          decisionSource: "agent",
          review: {
            status: "approved",
            riskLevel: "low",
            userAuthorization: "low",
            rationale: "This only runs tests.",
          },
          action: {
            type: "command",
            source: "shell",
            command: "bun test",
            cwd: "/tmp/project",
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "guardianWarning",
        params: {
          threadId: "thread-owner-migrated",
          kind: "tooManyDenials",
          message: "Automatic approval review rejected too many approval requests for this turn.",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/reasoning/summaryPartAdded",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          itemId: "reasoning-1",
          summaryIndex: 1,
        },
      });
      await serviceInternals.handleNotification({
        method: "item/fileChange/outputDelta",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          itemId: "patch-legacy-output",
          delta: "legacy apply_patch output",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/commandExecution/terminalInteraction",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          itemId: "exec-1",
          processId: "proc-1",
          stdin: "bun test\n",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/mcpToolCall/progress",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          itemId: "mcp-call-1",
          message: "Searching docs",
        },
      });
      await serviceInternals.handleNotification({
        method: "error",
        params: {
          threadId: "thread-owner-migrated",
          turnId: "thread-owner-migrated-turn",
          error: {
            message: "Tool failed",
            additionalDetails: "exit 1",
          },
          willRetry: false,
        },
      });
      await serviceInternals.handleNotification({
        method: "serverRequest/resolved",
        params: {
          threadId: "thread-owner-migrated",
          requestId: "request-1",
        },
      });

      const methods = ownerMessages
        .map((message) => message.message)
        .filter(
          (message): message is Extract<CodexHostMessage, { type: "threadOwnerNotification" }> =>
            message.type === "threadOwnerNotification",
        )
        .map((message) => message.notification.method)
        .join(",");

      expect(methods).toBe(
        "thread/tokenUsage/updated,turn/plan/updated,model/safetyBuffering/updated,model/rerouted,hook/started,hook/completed,item/autoApprovalReview/started,item/autoApprovalReview/completed,guardianWarning,item/reasoning/summaryPartAdded,item/fileChange/outputDelta,item/commandExecution/terminalInteraction,item/mcpToolCall/progress,error,serverRequest/resolved",
      );
      expect(ownerMessages.every((message) => message.targetClientId === "owner-a")).toBe(true);
      expect(String(hostMessages.length)).toBe("0");
      const snapshot = await service.requestConversationSnapshot("thread-owner-migrated");
      expect(snapshot?.latestTokenUsageInfo?.total.totalTokens).toBe(100);
      expect((snapshot?.turns[0]?.tokenUsage ?? null) === null).toBe(true);
      expect(snapshot?.turns[0]?.safetyBuffering?.showBufferingUi).toBe(true);
      expect(snapshot?.turns[0]?.safetyBuffering?.fasterModel).toBe("gpt-5.4-mini");
      const rerouteItem = snapshot?.turns[0]?.items.find(
        (item) => item.semanticKind === "modelRerouted",
      );
      const rerouteRaw = rerouteItem?.rawItem as
        | { fromModel?: string; toModel?: string; reason?: string }
        | undefined;
      expect(rerouteItem?.status).toBe("completed");
      expect(rerouteRaw?.fromModel).toBe("gpt-5.4-codex");
      expect(rerouteRaw?.toModel).toBe("gpt-5.4-mini");
      expect(rerouteRaw?.reason).toBe("highRiskCyberActivity");
      const hookItem = snapshot?.turns[0]?.items.find((item) => item.itemId === "hook-run-1");
      expect(hookItem?.semanticKind).toBe("hook");
      expect(hookItem?.status).toBe("completed");
      const reviewItem = snapshot?.turns[0]?.items.find(
        (item) => item.itemId === "automatic-approval-review:review-1",
      );
      const reviewRaw = reviewItem?.rawItem as
        | { status?: string; targetItemId?: string | null }
        | undefined;
      expect(reviewItem?.semanticKind).toBe("automaticApprovalReview");
      expect(reviewItem?.status).toBe("completed");
      expect(reviewRaw?.status).toBe("approved");
      expect(reviewRaw?.targetItemId).toBe("item-command-1");
      const warningItem = snapshot?.turns[0]?.items.find(
        (item) => item.semanticKind === "autoReviewInterruptionWarning",
      );
      expect(warningItem?.status).toBe("completed");
      expect(warningItem?.markdownText).toBe(
        "Automatic approval review rejected too many approval requests for this turn",
      );
    } finally {
      await service.shutdown();
    }
  });

  test("routes thread-started owner notifications without requiring a top-level thread id", async () => {
    const service = createService();
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
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
    const serviceInternals = service as unknown as {
      forwardNotificationToRendererOwnerForConversation: (
        conversationId: string,
        notification: CodexTestServerNotification,
      ) => boolean;
    };

    try {
      service.setRendererConversationOwner("thread-started-owner", "owner-a");

      const accepted = serviceInternals.forwardNotificationToRendererOwnerForConversation(
        "thread-started-owner",
        {
          method: "thread/started",
          params: {
            thread: {
              id: "thread-started-owner",
              preview: "Started from owner route",
            },
          },
        },
      );
      const ownerNotification = ownerMessages[0]?.message;

      expect(accepted).toBe(true);
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerNotification?.type).toBe("threadOwnerNotification");
      if (ownerNotification?.type === "threadOwnerNotification") {
        expect(ownerNotification.notification.method).toBe("thread/started");
        const params = ownerNotification.notification.params as { thread?: { id?: string } };
        expect(params.thread?.id).toBe("thread-started-owner");
      }
    } finally {
      await service.shutdown();
    }
  });

  test("forwards prose deltas to the renderer owner instead of broadcasting main patches", async () => {
    const service = createService();
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
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      service.setRendererConversationOwner("thread-owner", "owner-a");
      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-owner",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "hello",
        },
      });

      expect(String(ownerMessages.length)).toBe("1");
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.notification.method).toBe("item/agentMessage/delta");
        expect(ownerMessages[0].message.sequence).toBe(1);
      }
      expect(String(hostMessages.length)).toBe("0");
    } finally {
      await service.shutdown();
    }
  });

  test("projects token usage notifications onto conversation state without requiring a turn id", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-token-usage"),
        turns: [],
        transcript: [],
      });

      await serviceInternals.handleNotification({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-token-usage",
          tokenUsage: {
            total: {
              totalTokens: 120,
              inputTokens: 80,
              cachedInputTokens: 10,
              outputTokens: 40,
              reasoningOutputTokens: 15,
            },
            last: {
              totalTokens: 30,
              inputTokens: 20,
              cachedInputTokens: 5,
              outputTokens: 10,
              reasoningOutputTokens: 4,
            },
            modelContextWindow: 128000,
          },
        },
      });

      const snapshot = await service.requestConversationSnapshot("thread-token-usage");
      expect(snapshot?.latestTokenUsageInfo?.last.totalTokens).toBe(30);
      expect(hostMessages).toHaveLength(0);
      expect((snapshot?.turns[0]?.tokenUsage ?? null) === null).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("routes post-resume goal hydration through the renderer owner", async () => {
    const service = createService();
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    const hostMessages: CodexHostMessage[] = [];
    service.on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") hostMessages.push(message);
    });
    const serviceInternals = service as unknown as {
      applyThreadGoalHydratedAfterResume: (threadId: string, goal: ThreadGoal) => void;
      publishPostResumeGoalSnapshot: (threadId: string) => void;
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-owner-resume-goal",
        ownerClientId: "owner-a",
      });
      serviceInternals.applyThreadGoalHydratedAfterResume("thread-owner-resume-goal", {
        threadId: "thread-owner-resume-goal",
        objective: "Finish the owner migration",
        status: "paused",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 2,
      });
      serviceInternals.publishPostResumeGoalSnapshot("thread-owner-resume-goal");

      expect(ownerMessages).toHaveLength(1);
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.notification.method).toBe("thread/goal/updated");
      }
      expect(hostMessages).toHaveLength(0);
    } finally {
      await service.shutdown();
    }
  });

  test("forwards live fileChange patch updates to owner while silently updating canonical cache", async () => {
    const service = createService();
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
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-owner-file-change",
        ownerClientId: "owner-a",
        turnStatus: "inProgress",
        statusType: "active",
      });

      await serviceInternals.handleNotification({
        method: "item/fileChange/patchUpdated",
        params: {
          threadId: "thread-owner-file-change",
          turnId: "thread-owner-file-change-turn",
          itemId: "patch-live",
          changes: [
            {
              path: "src/app.ts",
              kind: { type: "update", move_path: null },
              diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
            },
          ],
        },
      });

      expect(String(ownerMessages.length)).toBe("1");
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.notification.method).toBe("item/fileChange/patchUpdated");
      }
      expect(String(hostMessages.length)).toBe("0");

      const snapshot = await service.requestConversationSnapshot("thread-owner-file-change");
      const item = snapshot?.turns[0]?.items[0] ?? null;
      expect(item?.itemId ?? "").toBe("patch-live");
      expect(item?.status ?? "").toBe("inProgress");
      expect(`${item?.kind}:${item?.semanticKind}`).toBe("fileChange:patch");
      expect(getCodexFileChangePaths(item?.fileChange?.changes).join(",")).toBe("src/app.ts");
    } finally {
      await service.shutdown();
    }
  });

  test("advances canonical file patches when the derived detail projection is unavailable", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      applyFileChangePatchUpdate: (
        update: CodexFileChangePatchUpdate,
        suppressConversationSync: boolean,
      ) => void;
      getMaybeConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
        detail: CodexThreadDetail | null;
      } | null;
    };
    const threadId = "thread-patch-without-detail";
    const turnId = "turn-patch-without-detail";

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
            id: "assistant-before-patch",
            text: "",
          }),
        },
      });

      const record = serviceInternals.getMaybeConversationRecord(threadId);
      if (record) record.detail = null;
      serviceInternals.applyFileChangePatchUpdate(
        {
          conversationId: threadId,
          turnId,
          itemId: "patch-without-detail",
          changes: [],
        },
        true,
      );

      const canonicalPatch = record?.canonicalState?.turns[0]?.items[1];
      expect(canonicalPatch?.type).toBe("fileChange");
      if (canonicalPatch?.type === "fileChange") {
        expect(canonicalPatch.id).toBe("patch-without-detail");
        expect(canonicalPatch.changes.length).toBe(0);
      }
    } finally {
      await service.shutdown();
    }
  });

  test("forwards thread goal updates to owner without source-null patches", async () => {
    const service = createService();
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
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-owner-goal",
        ownerClientId: "owner-a",
        turnStatus: "completed",
        statusType: "idle",
      });

      await serviceInternals.handleNotification({
        method: "thread/goal/updated",
        params: {
          threadId: "thread-owner-goal",
          turnId: null,
          goal: {
            threadId: "thread-owner-goal",
            objective: "Finish owner parity",
            status: "active",
            tokenBudget: 40000,
            tokensUsed: 12,
            timeUsedSeconds: 4,
            createdAt: 100,
            updatedAt: 101,
          },
        },
      });

      await serviceInternals.handleNotification({
        method: "thread/goal/cleared",
        params: {
          threadId: "thread-owner-goal",
        },
      });

      const methods = ownerMessages
        .map((message) => message.message)
        .filter(
          (message): message is Extract<CodexHostMessage, { type: "threadOwnerNotification" }> =>
            message.type === "threadOwnerNotification",
        )
        .map((message) => message.notification.method)
        .join(",");
      expect(methods).toBe("thread/goal/updated,thread/goal/cleared");
      expect(ownerMessages.every((message) => message.targetClientId === "owner-a")).toBe(true);
      expect(String(hostMessages.length)).toBe("0");

      const snapshot = await service.requestConversationSnapshot("thread-owner-goal");
      expect(snapshot?.threadGoal ?? null).toBe(null);
    } finally {
      await service.shutdown();
    }
  });

  test("clears newly completed thread goals in no-owner fallback once per update", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        threadGoal: ThreadGoal | null;
        completedThreadGoal: ThreadGoal | null;
      };
      getThreadLinkSafely: (threadId: string) => unknown;
      scheduleSidebarThreadListRepair: (notificationMethod: string, threadId: string) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const threadId = "thread-no-owner-goal-complete";
    const activeGoal: ThreadGoal = {
      threadId,
      objective: "Finish runtime parity",
      status: "active",
      tokenBudget: 40000,
      tokensUsed: 12,
      timeUsedSeconds: 4,
      createdAt: 100,
      updatedAt: 101,
    };
    const completedGoal: ThreadGoal = {
      ...activeGoal,
      status: "complete",
      tokensUsed: 40000,
      timeUsedSeconds: 300,
      updatedAt: 102,
    };

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      turns: [],
      transcript: [],
    });
    const record = serviceInternals.getConversationRecord(threadId);
    record.threadGoal = activeGoal;
    serviceInternals.getThreadLinkSafely = () => null;
    serviceInternals.scheduleSidebarThreadListRepair = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    };

    try {
      await serviceInternals.handleNotification({
        method: "thread/goal/updated",
        params: {
          threadId,
          turnId: null,
          goal: completedGoal,
        },
      });
      await waitForCondition(
        () => requests.filter((request) => request.method === "thread/goal/clear").length === 1,
        1_000,
      );

      expect(record.threadGoal?.status).toBe("complete");
      expect(record.completedThreadGoal?.updatedAt).toBe(102);
      expect((requests[0]?.params as { threadId?: string })?.threadId).toBe(threadId);

      await serviceInternals.handleNotification({
        method: "thread/goal/updated",
        params: {
          threadId,
          turnId: null,
          goal: completedGoal,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(requests.filter((request) => request.method === "thread/goal/clear").length).toBe(1);

      await serviceInternals.handleNotification({
        method: "thread/goal/updated",
        params: {
          threadId,
          turnId: null,
          goal: {
            ...completedGoal,
            updatedAt: 103,
          },
        },
      });
      await waitForCondition(
        () => requests.filter((request) => request.method === "thread/goal/clear").length === 2,
        1_000,
      );
      expect(record.completedThreadGoal?.updatedAt).toBe(103);
    } finally {
      await service.shutdown();
    }
  });

  test("projects an accepted thread goal into canonical and transcript state", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      hydrateCanonicalConversationState: (
        input: ThreadResumeResponse,
      ) => CodexCanonicalConversationState;
    };
    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-goal-objective"),
        turns: [],
        transcript: [],
      });
      serviceInternals.hydrateCanonicalConversationState(
        makeCanonicalResumeResponse({
          threadId: "thread-goal-objective",
          threadTurns: [],
          initialTurnsPage: null,
        }),
      );
      service.threadGoalProjection.applySet({
        threadId: "thread-goal-objective",
        goal: {
          threadId: "thread-goal-objective",
          objective: "Ship parity",
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        appendTranscriptItem: true,
        dismissResumeConfirmation: false,
        objective: "Ship parity",
      });
      const snapshot = await service.requestConversationSnapshot("thread-goal-objective");
      const turn = snapshot?.turns[0];
      const item = turn?.items[0];

      expect(snapshot?.threadGoal?.objective).toBe("Ship parity");
      expect(snapshot?.turns.length ?? 0).toBe(1);
      expect((turn as { turnId?: string | null } | undefined)?.turnId ?? null).toBe(null);
      expect(turn?.status ?? "").toBe("completed");
      expect(turn?.turnStartedAtMs ?? 0).toBe(1_000);
      expect(item?.kind ?? "").toBe("userMessage");
      expect(item?.markdownText ?? "").toBe("Ship parity");
      expect(item?.goal ?? false).toBe(true);
      expect(item?.rawItem ?? null).toBe(null);
      expect(String(snapshot?.canonicalState?.turns[0]?.items.length ?? -1)).toBe("0");
      const rawInput = snapshot?.canonicalState?.turns[0]?.sidecar.params.input[0];
      expect(rawInput?.type).toBe("text");
      expect(rawInput?.type === "text" ? rawInput.text : "").toBe("/goal Ship parity");
    } finally {
      await service.shutdown();
    }
  });

  test("publishes owner stream patches with source client id and updates the broadcast cache", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner" });
      const nextConversation = makeConversationSnapshot({
        threadId: "thread-owner",
        text: "hello",
      });
      service.setRendererConversationOwner("thread-owner", "owner-a");
      const baseCheckpoint = buildTestStreamCheckpoint(baseConversation, 1);

      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: baseConversation, revision: 1 }),
        ),
      ).toEqual({ accepted: true, checkpoint: baseCheckpoint });
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestPatchPublication({
            before: baseConversation,
            after: nextConversation,
            baseCheckpoint,
          }),
        ).accepted,
      ).toBe(true);

      const latest = projectConversationFromHostMessages(hostMessages);
      const lastMessage = hostMessages[hostMessages.length - 1];
      expect(String(hostMessages.length)).toBe("2");
      expect(lastMessage?.type).toBe("threadStreamStateChanged");
      if (lastMessage?.type === "threadStreamStateChanged") {
        expect(lastMessage.sourceClientId).toBe("owner-a");
        expect(lastMessage.version).toBe(2);
      }
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("hello");
    } finally {
      await service.shutdown();
    }
  });

  test("accepts renderer owner repair snapshot and acks the carried notification sequence", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    const serviceInternals = service as unknown as {
      getNextOwnerNotificationSequence: (conversationId: string) => number;
      waitForRendererOwnerNotificationDrain: (conversationId: string) => Promise<void>;
    };

    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner" });
      const repairedConversation = makeConversationSnapshot({
        threadId: "thread-owner",
        text: "live text",
      });
      service.setRendererConversationOwner("thread-owner", "owner-a");
      const baseCheckpoint = buildTestStreamCheckpoint(baseConversation, 1);
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: baseConversation, revision: 1 }),
        ).accepted,
      ).toBe(true);

      for (let index = 0; index < 5; index += 1) {
        serviceInternals.getNextOwnerNotificationSequence("thread-owner");
      }
      let drained = false;
      const drain = serviceInternals
        .waitForRendererOwnerNotificationDrain("thread-owner")
        .then(() => {
          drained = true;
        });

      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({
            conversation: repairedConversation,
            revision: 2,
            baseCheckpoint,
            ownerNotificationSequence: 5,
          }),
        ).accepted,
      ).toBe(true);
      await drain;

      const latest = projectConversationFromHostMessages(hostMessages);
      const lastMessage = hostMessages[hostMessages.length - 1];
      expect(drained).toBe(true);
      expect(String(hostMessages.length)).toBe("2");
      expect(lastMessage?.type).toBe("threadStreamStateChanged");
      if (lastMessage?.type === "threadStreamStateChanged") {
        expect(lastMessage.sourceClientId).toBe("owner-a");
        expect(lastMessage.change.type).toBe("snapshot");
        expect(lastMessage.change.revision).toBe(2);
      }
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("live text");
    } finally {
      await service.shutdown();
    }
  });

  test("suppresses no-owner fallback snapshots without replacing the renderer-owner patch base", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      syncDormantConversationFromRecord: (
        threadId: string,
        reason: "owner-unavailable" | "explicit-resync",
      ) => void;
      mutateAcceptedConversationDocumentSilently: (
        threadId: string,
        recipe: (draft: CodexConversationSnapshot) => void,
      ) => void;
      syncAcceptedConversationDocumentSilently: (threadId: string) => number;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-source-null-guard"),
        turns: [],
        transcript: [],
      });
      service.setRendererConversationOwner("thread-source-null-guard", "owner-a");
      const ownerBase = makeConversationSnapshot({ threadId: "thread-source-null-guard" });
      const ownerNext = makeConversationSnapshot({
        threadId: "thread-source-null-guard",
        text: "owner remains authoritative",
      });
      const ownerBaseCheckpoint = buildTestStreamCheckpoint(ownerBase, 1);
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: ownerBase, revision: 1 }),
        ).accepted,
      ).toBe(true);

      serviceInternals.syncDormantConversationFromRecord(
        "thread-source-null-guard",
        "owner-unavailable",
      );
      serviceInternals.syncAcceptedConversationDocumentSilently("thread-source-null-guard");
      serviceInternals.mutateAcceptedConversationDocumentSilently(
        "thread-source-null-guard",
        (draft) => {
          draft.turns = [];
        },
      );
      expect(String(hostMessages.length)).toBe("1");
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestPatchPublication({
            before: ownerBase,
            after: ownerNext,
            baseCheckpoint: ownerBaseCheckpoint,
          }),
        ).accepted,
      ).toBe(true);
      expect(hostMessages).toHaveLength(2);
      expect(
        projectConversationFromHostMessages(hostMessages)?.turns[0]?.items[0]?.markdownText,
      ).toBe("owner remains authoritative");

      hostMessages.length = 0;
      const snapshot = await service.requestConversationSnapshot("thread-source-null-guard");
      expect(snapshot).not.toBeNull();
      expect(hostMessages).toHaveLength(0);
    } finally {
      await service.shutdown();
    }
  });

  test("clears renderer-owned conversations and broadcasts owner unavailable when a renderer client is disposed", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      hostMessages.push(message);
    });

    try {
      installRendererOwnerConversation(service, { threadId: "thread-a", ownerClientId: "owner-a" });
      service.setRendererConversationOwner("thread-b", "owner-b");
      installRendererOwnerConversation(service, { threadId: "thread-c", ownerClientId: "owner-a" });

      service.handleRendererClientDisposed("owner-a");

      expect(service.getRendererConversationOwner("thread-a")).toBe(null);
      expect(service.getRendererConversationOwner("thread-b")).toBe("owner-b");
      expect(service.getRendererConversationOwner("thread-c")).toBe(null);
      expect(service.serializeConversationSnapshot("thread-a")?.resumeState).toBe("needs_resume");
      expect(service.serializeConversationSnapshot("thread-c")?.resumeState).toBe("needs_resume");
      const unavailableMessage = hostMessages.find(
        (message) => message.type === "threadOwnerUnavailable",
      );
      expect(unavailableMessage?.type).toBe("threadOwnerUnavailable");
      if (unavailableMessage?.type === "threadOwnerUnavailable") {
        expect(unavailableMessage.ownerClientId).toBe("owner-a");
        expect(unavailableMessage.conversationIds.join(",")).toBe("thread-a,thread-c");
      }
    } finally {
      await service.shutdown();
    }
  });

  test("routes Nodex authorization presentation through a visible renderer without adopting state ownership", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      resolveNodexAgentAuthorizationPresentation: (
        threadId: string,
        turnId: string,
        rootThreadId: string,
      ) => {
        clientId: string;
        threadId: string;
        turnId: string;
      } | null;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
    };

    try {
      service.setRendererConversationViewActive("thread-main-owned", "renderer-viewer", true);

      expect(service.getRendererConversationOwner("thread-main-owned")).toBeNull();
      expect(
        serviceInternals.resolveNodexAgentAuthorizationPresentation(
          "thread-main-owned",
          "turn-1",
          "thread-main-owned",
        ),
      ).toEqual({
        clientId: "renderer-viewer",
        threadId: "thread-main-owned",
        turnId: "turn-1",
      });

      service.setRendererConversationOwner("thread-main-owned", "renderer-state-owner");
      expect(
        serviceInternals.resolveNodexAgentAuthorizationPresentation(
          "thread-main-owned",
          "turn-1",
          "thread-main-owned",
        )?.clientId,
      ).toBe("renderer-viewer");

      service.setRendererConversationViewActive("thread-main-owned", "renderer-viewer", false);
      expect(
        serviceInternals.resolveNodexAgentAuthorizationPresentation(
          "thread-main-owned",
          "turn-1",
          "thread-main-owned",
        ),
      ).toBeNull();

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-root"),
        turns: [
          {
            threadId: "thread-root",
            turnId: "turn-root",
            status: "inProgress",
            itemIds: [],
          },
        ],
      });
      service.setRendererConversationViewActive("thread-root", "renderer-root-viewer", true);
      expect(
        serviceInternals.resolveNodexAgentAuthorizationPresentation(
          "thread-child",
          "turn-child",
          "thread-root",
        ),
      ).toEqual({
        clientId: "renderer-root-viewer",
        threadId: "thread-root",
        turnId: "turn-root",
      });
    } finally {
      await service.shutdown();
    }
  });

  test("disposed owner state cannot bypass the next renderer resume kernel", async () => {
    const service = createService();
    const threadId = "thread-owner-loss-resume-kernel";
    const ownerClientId = "owner-loss-resume-kernel";
    installRendererOwnerConversation(service, { threadId, ownerClientId });
    const serviceInternals = service as unknown as {
      resumeThreadWithSeed: (
        targetThreadId: string,
        seed: unknown,
        force: boolean,
      ) => Promise<CodexThreadDetail | null>;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (targetThreadId: string) => {
        resumeState: string;
        streamRole: string | null;
        isStreaming: boolean;
      };
    };
    let resumeCalls = 0;
    serviceInternals.resumeThreadWithSeed = async (targetThreadId, _seed, force) => {
      resumeCalls += 1;
      expect(targetThreadId).toBe(threadId);
      expect(force).toBe(true);
      const detail = {
        ...makeThreadDetail(threadId),
        turns: [
          {
            threadId,
            turnId: "turn-reacquired",
            status: "completed" as const,
            itemIds: [],
          },
        ],
        transcript: [],
      };
      serviceInternals.setConversationRecordDetail(detail);
      const record = serviceInternals.getConversationRecord(threadId);
      record.streamRole = "owner";
      record.isStreaming = true;
      return detail;
    };

    try {
      service.handleRendererClientDisposed(ownerClientId);
      const invalidated = serviceInternals.getConversationRecord(threadId);
      expect(invalidated.resumeState).toBe("needs_resume");
      expect(invalidated.streamRole).toBe(null);
      expect(invalidated.isStreaming).toBe(false);

      const reacquired = await service.requestRendererConversationResume(
        threadId,
        "owner-after-loss-resume-kernel",
      );
      expect(resumeCalls).toBe(1);
      expect(reacquired?.conversation.turns[0]?.turnId).toBe("turn-reacquired");
    } finally {
      await service.shutdown();
    }
  });

  test("retains stored specialized dynamic waiters across renderer owner replacement", async () => {
    const service = createService();
    const threadId = "thread-stored-request-owner-replacement";
    const requestId = "stored-onboarding-owner-replacement";
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      respondToUserInput: (
        requestId: string | number,
        answers: Record<string, string[]>,
        conversationId: string,
      ) => Promise<boolean>;
      getConversationRecord: (targetThreadId: string) => {
        serverRequests: Array<{ id: string | number }>;
      };
    };
    service.setRendererConversationOwner(threadId, "owner-before-disconnect");

    try {
      const requestPromise = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/tool/call",
        params: {
          threadId,
          turnId: "turn-owner-replacement",
          callId: "call-owner-replacement",
          namespace: "codex_app",
          tool: "request_onboarding_input",
          arguments: {
            questions: [
              {
                id: "first_task",
                header: "Start",
                question: "What should Codex do?",
                options: [
                  { label: "Audit", description: "Inspect first" },
                  { label: "Build", description: "Implement first" },
                ],
              },
            ],
          },
        },
      });
      let settled = false;
      let rejected = false;
      void requestPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
          rejected = true;
        },
      );
      await Promise.resolve();

      service.handleRendererClientDisposed("owner-before-disconnect");
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(rejected).toBe(false);
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(1);

      service.setRendererConversationOwner(threadId, "owner-after-disconnect");
      expect(
        await serviceInternals.respondToUserInput(requestId, { first_task: ["Audit"] }, threadId),
      ).toBe(true);
      expect(JSON.stringify(await requestPromise)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                answers: { first_task: { answers: ["Audit"] } },
              }),
            },
          ],
          success: true,
        }),
      );
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("unsubscribes a resumed renderer owner after its active view becomes inactive", async () => {
    const service = createService({
      inactiveRendererOwnerRetentionMs: 5,
      inactiveRendererOwnerRetryMs: 5,
    });
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (
        message.type === "threadOwnerUnavailable" ||
        message.type === "threadStreamStateChanged"
      ) {
        hostMessages.push(message);
      }
    });
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/unsubscribe") return { status: "unsubscribed" };
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-inactive-owner",
        ownerClientId: "owner-a",
      });
      service.setRendererConversationViewActive("thread-inactive-owner", "owner-a", true);
      service.setRendererConversationViewActive("thread-inactive-owner", "owner-a", false);

      await waitForCondition(
        () =>
          requests.length > 0 &&
          service.getRendererConversationOwner("thread-inactive-owner") === null,
        120,
      );

      expect(requests[0]?.method).toBe("thread/unsubscribe");
      expect((requests[0]?.params as { threadId?: string } | undefined)?.threadId).toBe(
        "thread-inactive-owner",
      );
      expect(service.getRendererConversationOwner("thread-inactive-owner")).toBe(null);
      expect(service.serializeConversationSnapshot("thread-inactive-owner")?.resumeState).toBe(
        "needs_resume",
      );
      expect(hostMessages[0]?.type).toBe("threadOwnerUnavailable");
      expect(hostMessages).toHaveLength(1);
    } finally {
      await service.shutdown();
    }
  });

  test("keeps inactive renderer owners loaded while a turn is still in progress", async () => {
    const service = createService({
      inactiveRendererOwnerRetentionMs: 5,
      inactiveRendererOwnerRetryMs: 5,
    });
    const serviceInternals = service as unknown as {
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/unsubscribe") return { status: "unsubscribed" };
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-inactive-in-progress",
        ownerClientId: "owner-a",
        turnStatus: "inProgress",
      });
      service.setRendererConversationViewActive("thread-inactive-in-progress", "owner-a", false);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(String(requests.length)).toBe("0");
      expect(service.getRendererConversationOwner("thread-inactive-in-progress")).toBe("owner-a");

      await serviceInternals.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-inactive-in-progress",
          turn: completeLegacyProtocolTurnFixture({
            id: "thread-inactive-in-progress-turn",
            status: "completed",
          }),
        },
      });
      await waitForCondition(
        () =>
          requests.length > 0 &&
          service.getRendererConversationOwner("thread-inactive-in-progress") === null,
        120,
      );

      expect(requests[0]?.method).toBe("thread/unsubscribe");
      expect(service.getRendererConversationOwner("thread-inactive-in-progress")).toBe(null);
    } finally {
      await service.shutdown();
    }
  });

  test("retries inactive renderer owner unsubscribe failures", async () => {
    const service = createService({
      inactiveRendererOwnerRetentionMs: 5,
      inactiveRendererOwnerRetryMs: 5,
    });
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    let requestCount = 0;
    client.request = async (method: string) => {
      if (method !== "thread/unsubscribe") {
        throw new Error(`Unexpected client request: ${method}`);
      }
      requestCount += 1;
      if (requestCount === 1) {
        throw new Error("temporary unsubscribe failure");
      }
      return { status: "unsubscribed" };
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-inactive-retry",
        ownerClientId: "owner-a",
      });
      service.setRendererConversationViewActive("thread-inactive-retry", "owner-a", false);

      await waitForCondition(() => requestCount >= 2, 160);

      expect(String(requestCount)).toBe("2");
      expect(service.getRendererConversationOwner("thread-inactive-retry")).toBe(null);
      expect(service.serializeConversationSnapshot("thread-inactive-retry")?.resumeState).toBe(
        "needs_resume",
      );
    } finally {
      await service.shutdown();
    }
  });

  test("unsubscribes the oldest inactive renderer owner when retention limit is exceeded", async () => {
    const service = createService({
      inactiveRendererOwnerRetentionMs: 60_000,
      inactiveRendererOwnerMaxRetained: 1,
      inactiveRendererOwnerRetryMs: 5,
    });
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/unsubscribe") return { status: "unsubscribed" };
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-inactive-limit-a",
        ownerClientId: "owner-a",
      });
      installRendererOwnerConversation(service, {
        threadId: "thread-inactive-limit-b",
        ownerClientId: "owner-b",
      });

      await waitForCondition(
        () =>
          requests.length > 0 &&
          service.getRendererConversationOwner("thread-inactive-limit-a") === null,
        120,
      );

      expect(requests[0]?.method).toBe("thread/unsubscribe");
      expect((requests[0]?.params as { threadId?: string } | undefined)?.threadId).toBe(
        "thread-inactive-limit-a",
      );
      expect(service.getRendererConversationOwner("thread-inactive-limit-a")).toBe(null);
      expect(service.getRendererConversationOwner("thread-inactive-limit-b")).toBe("owner-b");
    } finally {
      await service.shutdown();
    }
  });

  test("routes item lifecycle and prose deltas to renderer owner without main source-null patches", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      getMaybeConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
      } | null;
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    const hostMessages: CodexHostMessage[] = [];
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
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
      ...makeThreadDetail("thread-owner-drain"),
      turns: [
        {
          threadId: "thread-owner-drain",
          turnId: "turn-owner-drain",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      service.setRendererConversationOwner("thread-owner-drain", "owner-a");
      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thread-owner-drain",
          turnId: "turn-owner-drain",
          item: makeProtocolAgentMessage({
            id: "assistant-owner-drain",
            text: "",
          }),
        },
      });
      await serviceInternals.handleNotification({
        method: "item/agentMessage/delta",
        params: {
          threadId: "thread-owner-drain",
          turnId: "turn-owner-drain",
          itemId: "assistant-owner-drain",
          delta: "hello",
        },
      });
      const canonicalAssistant =
        serviceInternals.getMaybeConversationRecord("thread-owner-drain")?.canonicalState?.turns[0]
          ?.items[0];
      expect(canonicalAssistant?.type).toBe("agentMessage");
      if (canonicalAssistant?.type === "agentMessage") {
        expect(canonicalAssistant.text).toBe("hello");
      }
      expect(String(hostMessages.length)).toBe("0");
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thread-owner-drain",
          turnId: "turn-owner-drain",
          item: makeProtocolAgentMessage({
            id: "assistant-owner-drain",
            text: "hello",
          }),
        },
      });

      expect(String(hostMessages.length)).toBe("0");
      expect(String(ownerMessages.length)).toBe("3");
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[1]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[2]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      expect(ownerMessages[1]?.message.type).toBe("threadOwnerNotification");
      expect(ownerMessages[2]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.notification.method).toBe("item/started");
        expect(ownerMessages[0].message.sequence).toBe(1);
      }
      if (ownerMessages[1]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[1].message.notification.method).toBe("item/agentMessage/delta");
        expect(ownerMessages[1].message.sequence).toBe(2);
      }
      if (ownerMessages[2]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[2].message.notification.method).toBe("item/completed");
        expect(ownerMessages[2].message.sequence).toBe(3);
      }

      const snapshot = await service.requestConversationSnapshot("thread-owner-drain");
      expect(snapshot?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(snapshot?.turns[0]?.items[0]?.status).toBe("completed");
    } finally {
      await service.shutdown();
    }
  });

  test("advances canonical frame text when the derived detail projection is unavailable", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      applyFrameTextDeltas: (updates: readonly CodexFrameTextDeltaUpdate[]) => void;
      getMaybeConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
        detail: CodexThreadDetail | null;
      } | null;
    };
    const threadId = "thread-frame-without-detail";
    const turnId = "turn-frame-without-detail";
    const itemId = "assistant-frame-without-detail";

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
            id: itemId,
            text: "",
          }),
        },
      });

      const record = serviceInternals.getMaybeConversationRecord(threadId);
      if (record) record.detail = null;
      serviceInternals.applyFrameTextDeltas([
        {
          conversationId: threadId,
          turnId,
          itemId,
          target: { type: "agentMessage" },
          delta: "canonical only",
        },
      ]);

      const canonicalAssistant = record?.canonicalState?.turns[0]?.items[0];
      expect(canonicalAssistant?.type).toBe("agentMessage");
      if (canonicalAssistant?.type === "agentMessage") {
        expect(canonicalAssistant.text).toBe("canonical only");
      }
    } finally {
      await service.shutdown();
    }
  });

  test("routes turn lifecycle to renderer owner without main source-null snapshots", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    const hostMessages: CodexHostMessage[] = [];
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    const notificationEvents: CodexThreadNotificationEvent[] = [];
    service.addThreadNotificationListener((event) => {
      notificationEvents.push(event);
    });
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
      ...makeThreadDetail("thread-owner-turn"),
      turns: [],
      transcript: [],
    });
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thread-owner-turn-child"),
      source: {
        parentThreadId: "thread-owner-turn",
      },
      turns: [
        {
          threadId: "thread-owner-turn-child",
          turnId: "turn-owner-child",
          status: "inProgress",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      service.setRendererConversationOwner("thread-owner-turn", "owner-a");
      await serviceInternals.handleNotification({
        method: "turn/started",
        params: {
          threadId: "thread-owner-turn",
          turn: {
            id: "turn-owner",
            status: "inProgress",
          },
        },
      });
      await serviceInternals.handleNotification({
        method: "turn/completed",
        params: {
          threadId: "thread-owner-turn",
          turn: {
            id: "turn-owner",
            status: "completed",
            durationMs: 42,
            items: [
              {
                type: "agentMessage",
                id: "agent-owner",
                text: "Owner turn finished",
              },
            ],
          },
        },
      });

      expect(String(hostMessages.length)).toBe("0");
      expect(String(ownerMessages.length)).toBe("2");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      expect(ownerMessages[1]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.notification.method).toBe("turn/started");
        expect(ownerMessages[0].message.sequence).toBe(1);
      }
      if (ownerMessages[1]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[1].message.notification.method).toBe("turn/completed");
        expect(ownerMessages[1].message.sequence).toBe(2);
      }

      const snapshot = await service.requestConversationSnapshot("thread-owner-turn");
      expect(snapshot?.turns[0]?.status).toBe("completed");
      expect(snapshot?.turns[0]?.durationMs).toBe(42);
      expect(notificationEvents).toHaveLength(1);
      expect(notificationEvents[0]).toMatchObject({
        type: "turn-completed",
        hostId: DEFAULT_CODEX_HOST_ID,
        turnId: "turn-owner",
        status: "completed",
        lastAgentMessage: "Owner turn finished",
        hasPendingContinuation: true,
      });
    } finally {
      await service.shutdown();
    }
  });

  test("rejects renderer stream patches from a non-owner client", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner" });
      const nextConversation = makeConversationSnapshot({
        threadId: "thread-owner",
        text: "wrong",
      });
      service.setRendererConversationOwner("thread-owner", "owner-a");
      const baseCheckpoint = buildTestStreamCheckpoint(baseConversation, 1);

      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: baseConversation, revision: 1 }),
        ).accepted,
      ).toBe(true);
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-b",
          buildTestPatchPublication({
            before: baseConversation,
            after: nextConversation,
            baseCheckpoint,
          }),
        ),
      ).toMatchObject({ accepted: false, reason: "not-owner" });

      const latest = projectConversationFromHostMessages(hostMessages);
      expect(String(hostMessages.length)).toBe("1");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("");
    } finally {
      await service.shutdown();
    }
  });

  test("rejects renderer stream patches with a mismatched local cache revision", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner" });
      const nextConversation = makeConversationSnapshot({
        threadId: "thread-owner",
        text: "stale",
      });
      service.setRendererConversationOwner("thread-owner", "owner-a");
      const baseCheckpoint = buildTestStreamCheckpoint(baseConversation, 3);

      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: baseConversation, revision: 3 }),
        ).accepted,
      ).toBe(true);
      const staleBase = { ...baseCheckpoint, revision: 2 };
      expect(
        service.publishRendererThreadStreamStateChange("owner-a", {
          ...buildTestPatchPublication({
            before: baseConversation,
            after: nextConversation,
            baseCheckpoint,
          }),
          baseCheckpoint: staleBase,
          change: {
            type: "patches",
            baseRevision: 2,
            revision: 4,
            patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
          },
        }),
      ).toMatchObject({ accepted: false, reason: "base-checkpoint-mismatch" });

      const latest = projectConversationFromHostMessages(hostMessages);
      expect(String(hostMessages.length)).toBe("1");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("");
    } finally {
      await service.shutdown();
    }
  });

  test("rejects unapplicable owner patches and accepts a rebased next-revision snapshot", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    const serviceInternals = service as unknown as {
      getNextOwnerNotificationSequence: (conversationId: string) => number;
      waitForRendererOwnerNotificationDrain: (conversationId: string) => Promise<void>;
    };

    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner-repair" });
      const repairedConversation = makeConversationSnapshot({
        threadId: "thread-owner-repair",
        text: "repaired",
      });
      service.setRendererConversationOwner("thread-owner-repair", "owner-a");
      const baseCheckpoint = buildTestStreamCheckpoint(baseConversation, 1);

      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: baseConversation, revision: 1 }),
        ).accepted,
      ).toBe(true);
      expect(serviceInternals.getNextOwnerNotificationSequence("thread-owner-repair")).toBe(1);
      let notificationDrained = false;
      const drain = serviceInternals
        .waitForRendererOwnerNotificationDrain("thread-owner-repair")
        .then(() => {
          notificationDrained = true;
        });
      const invalidPublication = buildTestPatchPublication({
        before: baseConversation,
        after: repairedConversation,
        baseCheckpoint,
        ownerNotificationSequence: 1,
        patches: [
          {
            op: "replace",
            path: ["canonicalState", "turns", 0, "items", 0],
            value: { id: "missing-parent" },
          },
        ],
      });
      const rejected = service.publishRendererThreadStreamStateChange(
        "owner-a",
        invalidPublication,
      );
      expect(rejected).toMatchObject({
        accepted: false,
        reason: "patch-apply-failed",
        recovery: { checkpoint: baseCheckpoint },
      });
      expect(notificationDrained).toBe(false);
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({
            conversation: repairedConversation,
            revision: 2,
            baseCheckpoint,
            ownerNotificationSequence: 1,
          }),
        ).accepted,
      ).toBe(true);

      await drain;
      expect(notificationDrained).toBe(true);
      expect(hostMessages).toHaveLength(2);
      expect(
        hostMessages[1]?.type === "threadStreamStateChanged" ? hostMessages[1].change.type : null,
      ).toBe("snapshot");
      expect(
        projectConversationFromHostMessages(hostMessages)?.turns[0]?.items[0]?.markdownText,
      ).toBe("repaired");
    } finally {
      await service.shutdown();
    }
  });

  test("rejects renderer publication until ownership is explicitly established", async () => {
    const service = createService();
    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner-claim" });
      const nextConversation = makeConversationSnapshot({
        threadId: "thread-owner-claim",
        text: "owner",
      });

      expect(
        service.publishRendererThreadStreamStateChange(
          "client-stale",
          buildTestPatchPublication({
            before: baseConversation,
            after: nextConversation,
            baseCheckpoint: buildTestStreamCheckpoint(baseConversation, 7),
          }),
        ),
      ).toMatchObject({ accepted: false, reason: "not-owner" });

      service.setRendererConversationOwner("thread-owner-claim", "client-owner");
      const baseCheckpoint = buildTestStreamCheckpoint(baseConversation, 1);
      expect(
        service.publishRendererThreadStreamStateChange(
          "client-owner",
          buildTestSnapshotPublication({ conversation: baseConversation, revision: 1 }),
        ).accepted,
      ).toBe(true);

      expect(
        service.publishRendererThreadStreamStateChange(
          "client-stale",
          buildTestSnapshotPublication({
            conversation: nextConversation,
            revision: 2,
            baseCheckpoint,
          }),
        ),
      ).toMatchObject({ accepted: false, reason: "not-owner" });
    } finally {
      await service.shutdown();
    }
  });

  test("renderer resume adoption never replaces an established owner", async () => {
    const service = createService();
    try {
      const baseline = makeConversationSnapshot({ threadId: "thread-owner-adoption-race" });
      service.setRendererConversationOwner("thread-owner-adoption-race", "owner-a");
      const checkpoint = buildTestStreamCheckpoint(baseline, 7);
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: baseline, revision: 7 }),
        ).accepted,
      ).toBe(true);

      const result = await service.requestRendererConversationResume(
        "thread-owner-adoption-race",
        "owner-b",
      );
      expect(result).toEqual({
        role: "follower",
        conversation: baseline,
        revision: 7,
        ownerClientId: "owner-a",
        checkpoint,
      });
      expect(service.getRendererConversationOwner("thread-owner-adoption-race")).toBe("owner-a");
    } finally {
      await service.shutdown();
    }
  });

  test("fresh-thread ownership is reserved for its initiating renderer without thread/resume", async () => {
    const service = createService();
    const threadId = "thread-fresh-owner-reservation";
    const launchId = "launch-fresh-owner-reservation";
    const ownerClientId = "renderer-fresh-owner";
    const requests: string[] = [];
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.request = async (method) => {
      requests.push(method);
      throw new Error(`Unexpected app-server request: ${method}`);
    };
    const serviceInternals = service as unknown as {
      getConversationRecord: (id: string) => {
        resumeState: string;
        streamRole: string | null;
        isStreaming: boolean;
      };
      registerFreshThreadLaunch: (launch: {
        launchId: string;
        rendererClientId: string;
        threadId: string;
      }) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      syncDormantConversationFromRecord: (id: string, reason: "owner-unavailable") => void;
    };
    serviceInternals.setConversationRecordDetail(makeThreadDetail(threadId));
    const record = serviceInternals.getConversationRecord(threadId);
    record.resumeState = "resumed";
    record.streamRole = "owner";
    record.isStreaming = true;
    serviceInternals.syncDormantConversationFromRecord(threadId, "owner-unavailable");
    serviceInternals.registerFreshThreadLaunch({
      launchId,
      rendererClientId: ownerClientId,
      threadId,
    });

    try {
      await expect(
        service.requestRendererConversationResume(threadId, ownerClientId),
      ).resolves.toBeNull();
      await expect(
        service.requestRendererConversationResume(threadId, "renderer-other"),
      ).resolves.toMatchObject({
        role: "follower",
        ownerClientId,
      });

      const adopted = await service.freshThreadLaunch.adopt({
        threadId,
        launchId,
        ownerClientId,
      });
      expect(adopted.role).toBe("owner");
      expect(adopted.conversation.threadId).toBe(threadId);
      expect(service.getRendererConversationOwner(threadId)).toBe(ownerClientId);
      expect(requests).toEqual([]);
      await service.releaseConversationResumeBuffer(threadId);
    } finally {
      await service.shutdown();
    }
  });

  test("renderer owner Resume sends an inherited turn/start with an empty input array", async () => {
    const service = createService();
    const threadId = "thread-owner-resume-interrupted";
    const ownerClientId = "renderer-owner-resume-interrupted";
    const requests: Array<{ method: string; params: unknown }> = [];
    const serviceInternals = service as unknown as {
      parseThreadRef: (id: string) => null;
      markThreadAsActive: (id: string) => void;
      persistThreadSnapshot: (id: string) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => undefined;
    serviceInternals.persistThreadSnapshot = () => undefined;
    serviceInternals.setConversationRecordDetail(makeThreadDetail(threadId));
    service.setRendererConversationOwner(threadId, ownerClientId);
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method !== "turn/start") return {};
      return {
        turn: {
          id: "turn-resumed",
          status: "in_progress",
          transcript: [],
        },
      };
    };

    try {
      await service.handleRendererOwnerAppServerRequest(ownerClientId, {
        conversationId: threadId,
        request: {
          method: "turn/resume-interrupted",
          params: {
            threadId,
            clientUserMessageId: "client-resume-interrupted",
            opts: { permissionMode: "auto" },
          },
        },
      });

      const turnStart = requests.find((request) => request.method === "turn/start");
      expect(turnStart?.params).toMatchObject({
        threadId,
        clientUserMessageId: "client-resume-interrupted",
        input: [],
        summary: "detailed",
      });
    } finally {
      await service.shutdown();
    }
  });

  test("a fresh owner consumes its exact first-turn launch only once", async () => {
    const service = createService();
    const threadId = "thread-fresh-owner-first-turn";
    const launchId = "launch-fresh-owner-first-turn";
    const ownerClientId = "renderer-fresh-owner-first-turn";
    const turnStartParams = {
      threadId,
      clientUserMessageId: "client-user-message-fresh-owner",
      input: [{ type: "text", text: "First visible prompt" }],
      cwd: "/workspace/project",
      attachments: [],
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method !== "turn/start") {
        throw new Error(`Unexpected app-server request: ${method}`);
      }
      return {
        turn: {
          id: "turn-fresh-owner-first-turn",
          status: "in_progress",
          transcript: [],
        },
      };
    };
    const serviceInternals = service as unknown as {
      registerFreshThreadLaunch: (launch: {
        launchId: string;
        rendererClientId: string;
        projectId: string | null;
        sessionId: string;
        threadId: string;
        runInTarget: "localProject";
        startedAt: number;
        clientUserMessageId: string;
        canonicalParams: Record<string, unknown>;
        turnStartParams: typeof turnStartParams;
        verifiedBuiltinFullAccess: boolean;
        goalObjective: string;
        rawGoalDraft: null;
        heartbeatAutomation: null;
      }) => void;
      getFreshThreadLaunchReservation: (id: string) => { state: string } | null;
      getConversationRecord: (id: string) => {
        resumeState: string;
        streamRole: string | null;
        isStreaming: boolean;
      };
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      syncDormantConversationFromRecord: (id: string, reason: "owner-unavailable") => void;
      startRendererOwnedSessionFirstTurn: (
        clientId: string,
        id: string,
        launch: string,
      ) => Promise<{ turn: { id: string } }>;
      markAutomationRunAcceptedForUserContinuation: (id: string) => Promise<void>;
      markThreadAsActive: (id: string) => Promise<void>;
      applyStartedSessionThreadGoal: (input: unknown) => Promise<void>;
    };
    serviceInternals.markAutomationRunAcceptedForUserContinuation = async () => undefined;
    serviceInternals.markThreadAsActive = async () => undefined;
    serviceInternals.applyStartedSessionThreadGoal = async () => undefined;
    serviceInternals.setConversationRecordDetail(makeThreadDetail(threadId));
    const record = serviceInternals.getConversationRecord(threadId);
    record.resumeState = "resumed";
    record.streamRole = "owner";
    record.isStreaming = true;
    serviceInternals.syncDormantConversationFromRecord(threadId, "owner-unavailable");
    serviceInternals.registerFreshThreadLaunch({
      launchId,
      rendererClientId: ownerClientId,
      projectId: "project-1",
      sessionId: "session-fresh-owner-first-turn",
      threadId,
      runInTarget: "localProject",
      startedAt: Date.now(),
      clientUserMessageId: turnStartParams.clientUserMessageId,
      canonicalParams: {},
      turnStartParams,
      verifiedBuiltinFullAccess: false,
      goalObjective: "",
      rawGoalDraft: null,
      heartbeatAutomation: null,
    });

    try {
      await service.freshThreadLaunch.adopt({ threadId, launchId, ownerClientId });
      const response = await serviceInternals.startRendererOwnedSessionFirstTurn(
        ownerClientId,
        threadId,
        launchId,
      );
      expect(response.turn.id).toBe("turn-fresh-owner-first-turn");
      expect(requests).toEqual([
        {
          method: "turn/start",
          params: turnStartParams,
        },
      ]);
      expect(serviceInternals.getFreshThreadLaunchReservation(threadId)).toBeNull();
      await expect(
        serviceInternals.startRendererOwnedSessionFirstTurn(ownerClientId, threadId, launchId),
      ).rejects.toThrow(`Fresh thread launch '${launchId}' is unavailable`);
      expect(requests).toHaveLength(1);
    } finally {
      await service.shutdown();
    }
  });

  test("a renderer that loses a concurrent resume race attaches to the accepted owner", async () => {
    const service = createService();
    const baseline = makeConversationSnapshot({ threadId: "thread-owner-concurrent-race" });
    let releaseResume: () => void = () => {};
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    const serviceInternals = service as unknown as {
      requestConversationResume: () => Promise<CodexConversationSnapshot>;
    };
    serviceInternals.requestConversationResume = async () => {
      await resumeGate;
      return baseline;
    };

    try {
      const competingResume = service.requestRendererConversationResume(
        "thread-owner-concurrent-race",
        "owner-b",
      );
      await Promise.resolve();
      service.setRendererConversationOwner("thread-owner-concurrent-race", "owner-a");
      const checkpoint = buildTestStreamCheckpoint(baseline, 7);
      expect(
        service.publishRendererThreadStreamStateChange(
          "owner-a",
          buildTestSnapshotPublication({ conversation: baseline, revision: 7 }),
        ).accepted,
      ).toBe(true);
      releaseResume();

      await expect(competingResume).resolves.toEqual({
        role: "follower",
        conversation: baseline,
        revision: 7,
        ownerClientId: "owner-a",
        checkpoint,
      });
      expect(service.getRendererConversationOwner("thread-owner-concurrent-race")).toBe("owner-a");
    } finally {
      releaseResume();
      await service.shutdown();
    }
  });
});

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

function installTestPermissionState(
  service: unknown,
  projectId: string | null,
  state: CodexPermissionState,
): void {
  const stateByProject = permissionStateByTestService.get(service as object);
  if (!stateByProject) throw new Error("Codex permission fixture was not installed");
  stateByProject.set(projectId, state);
}

function installManualApprovalState(service: unknown, projectId: string): void {
  installTestPermissionState(service, projectId, {
    mode: "auto",
    effectivePreset: "auto",
    availableModes: ["auto", "full-access", "custom"],
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxMode: "workspace-write",
    sandbox: null,
    autoReviewAvailable: true,
    configTarget: { source: "none", filePath: null },
    customDescription: null,
  });
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

describe("codex-service readThread fallback", () => {
  test("searches app-server tasks and paginates past filtered results", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method !== "thread/search") throw new Error(`Unexpected method: ${method}`);

      const cursor = (params as { cursor?: string | null }).cursor;
      if (cursor === null) {
        return {
          data: [
            {
              thread: {
                ...makeProtocolThread("thr_search_child", "/tmp/codex"),
                parentThreadId: "thr_parent",
              },
              snippet: "Filtered child task",
            },
          ],
          nextCursor: "page-2",
          backwardsCursor: null,
        };
      }

      return {
        data: [
          {
            thread: {
              ...makeProtocolThread("thr_search_server_only", "/workspace/server-only"),
              name: "Server-only task",
              preview: "Not materialized in Nodex",
              gitInfo: { sha: "abc", branch: "feature/search", originUrl: null },
              status: { type: "idle" },
            },
            snippet: "Matched server-only transcript",
          },
        ],
        nextCursor: null,
        backwardsCursor: "backwards",
      };
    };

    try {
      const results = await service.searchCommandPaletteThreads({
        query: "transcript",
        limit: 1,
      });

      expect(results).toEqual([
        {
          thread: {
            threadId: "thr_search_server_only",
            sessionId: null,
            projectId: null,
            projectName: null,
            title: "Server-only task",
            preview: "Not materialized in Nodex",
            cwd: "/workspace/server-only",
            gitBranch: "feature/search",
            projectless: true,
            pinned: false,
            pinnedOrder: null,
            statusType: "idle",
            statusActiveFlags: [],
            createdAt: 1_711_278_000_000,
            updatedAt: 1_711_278_060_000,
          },
          snippet: "Matched server-only transcript",
        },
      ]);
      expect(requests).toEqual([
        {
          method: "thread/search",
          params: {
            cursor: null,
            limit: 1,
            sortKey: "updated_at",
            sortDirection: "desc",
            sourceKinds: [],
            archived: false,
            searchTerm: "transcript",
          },
        },
        {
          method: "thread/search",
          params: {
            cursor: "page-2",
            limit: 1,
            sortKey: "updated_at",
            sortDirection: "desc",
            sourceKinds: [],
            archived: false,
            searchTerm: "transcript",
          },
        },
      ]);
    } finally {
      await service.shutdown();
    }
  });

  test("bounds app-server task search when pagination repeats a cursor", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const cursors: Array<string | null | undefined> = [];
    client.start = async () => undefined;
    client.request = async (_method, params) => {
      cursors.push((params as { cursor?: string | null }).cursor);
      return {
        data: [
          {
            thread: {
              ...makeProtocolThread(`thr_internal_${cursors.length}`, "/tmp/codex"),
              threadSource: "system",
            },
            snippet: "Filtered internal task",
          },
        ],
        nextCursor: "repeated-cursor",
        backwardsCursor: null,
      };
    };

    try {
      await expect(
        service.searchCommandPaletteThreads({ query: "internal", limit: 5 }),
      ).resolves.toEqual([]);
      expect(cursors).toEqual([null, "repeated-cursor"]);
    } finally {
      await service.shutdown();
    }
  });

  test("skips app-server task search for blank queries and surfaces request failures", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: () => Promise<never>;
    };
    let requestCalls = 0;
    client.start = async () => undefined;
    client.request = async () => {
      requestCalls += 1;
      throw new Error("search unavailable");
    };

    try {
      await expect(service.searchCommandPaletteThreads({ query: "   " })).resolves.toEqual([]);
      await expect(service.searchCommandPaletteThreads({ query: "needle" })).rejects.toThrow(
        "search unavailable",
      );
      expect(requestCalls).toBe(1);
    } finally {
      await service.shutdown();
    }
  });
});

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
    let tailLoads = 0;
    const serviceInternals = service as unknown as {
      hasResumeNotificationBuffer: (id: string) => boolean;
      startPostResumeGoalFlow: (id: string, revision: number) => Promise<void>;
      scheduleRemainingThreadTurnsLoad: (id: string) => void;
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
    serviceInternals.scheduleRemainingThreadTurnsLoad = () => {
      tailLoads += 1;
    };
    service.on("hostMessage", (message) => hostMessages.push(message));

    try {
      const detail = await service.resumeThread(threadId);

      expect(detail?.threadId ?? "").toBe(threadId);
      expect(requests.length).toBe(0);
      expect(serviceInternals.hasResumeNotificationBuffer(threadId)).toBe(false);
      expect(goalFlows).toBe(0);
      expect(tailLoads).toBe(0);
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

  test("post-resume tail hydration does not wait for active-goal continuation", async () => {
    const service = createService();
    const threadId = "thr_goal_tail_independent";
    let releaseContinuation: () => void = () => {};
    const continuationGate = new Promise<void>((resolve) => {
      releaseContinuation = resolve;
    });
    let continuationSettled = false;
    let tailStarted = false;
    const serviceInternals = service as unknown as {
      hydrateCanonicalConversationState: (
        input: ThreadResumeResponse,
      ) => CodexCanonicalConversationState;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      startPostResumeGoalFlow: (id: string, expectedRevision: number) => void;
      maybeContinueActiveThreadGoal: (id: string) => Promise<void>;
      scheduleRemainingThreadTurnsLoad: (id: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };

    client.start = async () => undefined;
    client.request = async (method) => {
      if (method === "thread/goal/get") {
        return {
          goal: {
            threadId,
            objective: "Continue without blocking history",
            status: "active",
            tokenBudget: null,
            tokensUsed: 1,
            timeUsedSeconds: 1,
            createdAt: 10,
            updatedAt: 20,
          },
        };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };
    serviceInternals.setConversationRecordDetail(makeThreadDetail(threadId));
    serviceInternals.hydrateCanonicalConversationState(
      makeCanonicalResumeResponse({
        threadId,
        initialTurnsPage: {
          data: [],
          nextCursor: "older-page",
          backwardsCursor: null,
        },
      }),
    );
    serviceInternals.maybeContinueActiveThreadGoal = async () => {
      await continuationGate;
      continuationSettled = true;
    };
    serviceInternals.scheduleRemainingThreadTurnsLoad = () => {
      tailStarted = true;
    };

    try {
      serviceInternals.startPostResumeGoalFlow(threadId, 0);
      await waitForCondition(() => tailStarted, 250);

      expect(tailStarted).toBe(true);
      expect(continuationSettled).toBe(false);

      releaseContinuation();
      await waitForCondition(() => continuationSettled, 250);
      expect(continuationSettled).toBe(true);
    } finally {
      releaseContinuation();
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

  test("side chat resolves project-aware instructions and thread config before an exact fork", async () => {
    const resolverInputs: Array<{
      baseInstructions?: string | null;
      cwd: string;
      model?: string | null;
      threadId: string | null;
      threadToolsEnabled?: boolean;
    }> = [];
    const configCwds: Array<string | null> = [];
    const service = createService({
      projectAwareDeveloperInstructionsResolver: async (input) => {
        resolverInputs.push(input);
        return "  Resolved desktop instructions  ";
      },
      threadCodexConfigBuilder: async (cwd) => {
        configCwds.push(cwd);
        return { "mcp.test_enabled": true };
      },
    });
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const forkResponse = makeCanonicalForkResponse({
      threadId: "thr_side_exact_child",
      cwd: "/workspace/side-exact",
      turns: [],
    });
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/fork") return forkResponse;
      if (method === "thread/inject_items") return {};
      throw new Error(`Unexpected client request: ${method}`);
    };
    service.readThread = async () => ({
      ...makeThreadDetail("thr_side_exact_parent"),
      projectId: "project-side-exact",
      source: null,
      cwd: "/workspace/side-exact",
    });

    try {
      const result = await service.startSideChat({
        parentThreadId: "thr_side_exact_parent",
        reasoningEffort: "xhigh",
      });
      const forkParams = requests[0]?.params as Record<string, unknown>;
      const config = forkParams.config as Record<string, unknown>;

      expect(requests.map((request) => request.method).join(",")).toBe(
        "thread/fork,thread/inject_items",
      );
      expect(JSON.stringify(resolverInputs)).toBe(
        JSON.stringify([
          {
            cwd: "/workspace/side-exact",
            model: null,
            threadId: "thr_side_exact_parent",
          },
        ]),
      );
      expect(JSON.stringify(configCwds)).toBe(JSON.stringify(["/workspace/side-exact"]));
      expect(forkParams.path).toBe(null);
      expect(forkParams.ephemeral).toBe(true);
      expect(forkParams.excludeTurns).toBe(true);
      expect(config["mcp.test_enabled"]).toBe(true);
      expect(config.model_reasoning_effort).toBe("xhigh");
      expect(
        String(forkParams.developerInstructions).startsWith(
          "  Resolved desktop instructions  \n\nYou are in a side conversation",
        ),
      ).toBe(true);
      expect(result.threadId).toBe("thr_side_exact_child");
      expect(getCanonicalConversationState(service, result.threadId)?.turns.length ?? -1).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test.each([
    { label: "missing", hasStaleCwd: false },
    { label: "non-empty but unavailable", hasStaleCwd: true },
  ])(
    "side chat repairs and persists a $label projectless parent workspace before forking",
    async ({ hasStaleCwd }) => {
      const projectlessHome = fs.mkdtempSync(
        path.join(os.tmpdir(), "nodex-side-chat-projectless-"),
      );
      const staleCwd = hasStaleCwd ? path.join(projectlessHome, "deleted-parent-workspace") : null;
      const projectWorkspace = createTestProjectWorkspace();
      await projectWorkspace.upsertThread("thr_side_projectless_parent", {
        projectId: null,
        cwd: staleCwd,
        projectlessOutputDirectory: null,
        projectlessWorkspaceBrowserRoot: null,
        threadName: "Repair side chat workspace",
        threadPreview: "Repair side chat workspace",
      });
      const service = createService({
        projectWorkspace,
        projectlessHomeDirectory: () => projectlessHome,
      });
      await (
        service as unknown as {
          readWorkspaceThread: (threadId: string) => Promise<DesktopProjectWorkspaceThread | null>;
        }
      ).readWorkspaceThread("thr_side_projectless_parent");
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method, params) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          const cwd = (params as { cwd: string }).cwd;
          return makeCanonicalForkResponse({
            threadId: "thr_side_projectless_child",
            cwd,
            turns: [],
          });
        }
        if (method === "thread/inject_items") return {};
        throw new Error(`Unexpected client request: ${method}`);
      };
      service.readThread = async () => ({
        ...makeThreadDetail("thr_side_projectless_parent"),
        projectId: null,
        source: null,
        cwd: staleCwd,
        projectlessOutputDirectory: null,
        projectlessWorkspaceBrowserRoot: null,
        threadName: "Repair side chat workspace",
        threadPreview: "Repair side chat workspace",
        sandbox: {
          type: "workspaceWrite",
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      });

      try {
        const result = await service.startSideChat({
          parentThreadId: "thr_side_projectless_parent",
          parentNavigationPath: "session:session-projectless/thread:thr_side_projectless_parent",
        });
        const forkParams = requests[0]?.params as { cwd?: string };
        const persistedParent = await projectWorkspace.getThread("thr_side_projectless_parent");

        expect(requests.map((request) => request.method).join(",")).toBe(
          "thread/fork,thread/inject_items",
        );
        expect(forkParams.cwd?.startsWith(path.join(projectlessHome, "Documents", "Nodex"))).toBe(
          true,
        );
        expect(forkParams.cwd).not.toBe(staleCwd);
        expect(fs.statSync(forkParams.cwd ?? "").isDirectory()).toBe(true);
        expect(persistedParent?.cwd).toBe(forkParams.cwd);
        expect(persistedParent?.projectlessOutputDirectory).toBe(forkParams.cwd);
        expect(persistedParent?.projectlessWorkspaceBrowserRoot).toBe(
          path.join(projectlessHome, "Documents", "Nodex"),
        );
        expect(result.conversation.projectId).toBeNull();
        expect(result.conversation.cwd).toBe(forkParams.cwd);
        expect(result.conversation.projectlessOutputDirectory).toBe(forkParams.cwd);
        expect(result.conversation.projectlessWorkspaceBrowserRoot).toBe(
          path.join(projectlessHome, "Documents", "Nodex"),
        );
        expect(await projectWorkspace.getThread(result.threadId)).toBeNull();
      } finally {
        await service.shutdown();
        fs.rmSync(projectlessHome, { recursive: true, force: true });
      }
    },
  );

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

  test("side chat rejects a projectless parent whose workspace cannot be persisted", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: string[] = [];
    client.start = async () => undefined;
    client.request = async (method) => {
      requests.push(method);
      throw new Error(`Unexpected client request: ${method}`);
    };
    service.readThread = async () => ({
      ...makeThreadDetail("thr_side_unpersisted_parent"),
      projectId: null,
      source: null,
      cwd: null,
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
    });

    try {
      await expect(
        service.startSideChat({
          parentThreadId: "thr_side_unpersisted_parent",
        }),
      ).rejects.toThrow(
        "Projectless side chat requires a workspace, but its parent workspace could not be repaired",
      );
      expect(requests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("side chat aborts before fork when project-aware instruction resolution fails", async () => {
    let configBuildStarted = false;
    const service = createService({
      projectAwareDeveloperInstructionsResolver: async () => {
        throw new Error("developer instruction host failed");
      },
      threadCodexConfigBuilder: async () => {
        configBuildStarted = true;
        return {};
      },
    });
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: string[] = [];
    client.start = async () => undefined;
    client.request = async (method) => {
      requests.push(method);
      throw new Error(`Unexpected client request: ${method}`);
    };
    service.readThread = async () => ({
      ...makeThreadDetail("thr_side_failure_parent"),
      projectId: "project-side-failure",
      source: null,
      cwd: "/workspace/side-failure",
    });

    try {
      let message = "";
      try {
        await service.startSideChat({
          parentThreadId: "thr_side_failure_parent",
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe("developer instruction host failed");
      expect(configBuildStarted).toBe(false);
      expect(requests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service interrupt target resolution", () => {
  test("interrupts the latest in-progress turn when turnId is omitted", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    serviceInternals.mergeTurn("thr_interrupt", {
      threadId: "thr_interrupt",
      turnId: "turn_completed",
      status: "completed",
      itemIds: [],
    });
    serviceInternals.mergeTurn("thr_interrupt", {
      threadId: "thr_interrupt",
      turnId: "turn_in_progress",
      status: "inProgress",
      itemIds: [],
    });

    try {
      const result = await service.interruptTurn("thr_interrupt");
      const interruptRequest = requests.find((request) => request.method === "turn/interrupt");
      expect(result).toBe(true);
      expect(requests.length >= 1).toBe(true);
      expect(Boolean(interruptRequest)).toBe(true);
      expect((interruptRequest?.params as { threadId?: string })?.threadId).toBe("thr_interrupt");
      expect((interruptRequest?.params as { turnId?: string })?.turnId).toBe("turn_in_progress");
    } finally {
      await service.shutdown();
    }
  });

  test("pauses an active thread goal before interrupting the no-owner fallback turn", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      getConversationRecord: (threadId: string) => {
        threadGoal: ThreadGoal | null;
        completedThreadGoal: ThreadGoal | null;
        threadGoalResumeConfirmation: ThreadGoal | null;
      };
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/goal/set") {
        const goalParams = params as ThreadGoalSetParams;
        return {
          goal: {
            threadId: goalParams.threadId,
            objective: "finish the migration",
            status: goalParams.status ?? "active",
            tokenBudget: goalParams.tokenBudget ?? null,
            tokensUsed: 12,
            timeUsedSeconds: 34,
            createdAt: 1,
            updatedAt: 2,
          } satisfies ThreadGoal,
        };
      }
      return {};
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    serviceInternals.mergeTurn("thr_goal_interrupt", {
      threadId: "thr_goal_interrupt",
      turnId: "turn_in_progress",
      status: "inProgress",
      itemIds: [],
    });
    const record = serviceInternals.getConversationRecord("thr_goal_interrupt");
    record.threadGoal = {
      threadId: "thr_goal_interrupt",
      objective: "finish the migration",
      status: "active",
      tokenBudget: null,
      tokensUsed: 12,
      timeUsedSeconds: 34,
      createdAt: 1,
      updatedAt: 1,
    };
    record.threadGoalResumeConfirmation = {
      threadId: "thr_goal_interrupt",
      objective: "stale prompt",
      status: "paused",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    };

    try {
      const result = await service.interruptTurn("thr_goal_interrupt");
      const snapshot = service.serializeConversationSnapshot("thr_goal_interrupt");

      expect(result).toBe(true);
      expect(requests[0]?.method).toBe("thread/goal/set");
      expect((requests[0]?.params as { threadId?: string })?.threadId).toBe("thr_goal_interrupt");
      expect((requests[0]?.params as { status?: string })?.status).toBe("paused");
      expect(requests[1]?.method).toBe("turn/interrupt");
      expect((requests[1]?.params as { turnId?: string })?.turnId).toBe("turn_in_progress");
      expect(snapshot?.threadGoal?.status).toBe("paused");
      expect(snapshot?.threadGoalResumeConfirmation ?? null).toBe(null);
    } finally {
      await service.shutdown();
    }
  });

  test("continues active thread goal after idle status in no-owner fallback", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        resumeState: string;
        streamRole: string | null;
        isStreaming: boolean;
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
    record.resumeState = "resumed";
    record.streamRole = "owner";
    record.isStreaming = true;
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
        resumeState: string;
        streamRole: string | null;
        isStreaming: boolean;
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
    record.resumeState = "resumed";
    record.streamRole = "owner";
    record.isStreaming = true;
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
        resumeState: string;
        streamRole: string | null;
        isStreaming: boolean;
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
    record.resumeState = "resumed";
    record.streamRole = "owner";
    record.isStreaming = true;
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

  test("prefers explicit turnId over inferred turn cache", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    serviceInternals.mergeTurn("thr_explicit", {
      threadId: "thr_explicit",
      turnId: "turn_cached",
      status: "inProgress",
      itemIds: [],
    });

    try {
      const result = await service.interruptTurn("thr_explicit", "turn_explicit");
      expect(result).toBe(true);
      expect(requests.length >= 1).toBe(true);
      expect(requests[0]?.method).toBe("turn/interrupt");
      expect((requests[0]?.params as { threadId?: string })?.threadId).toBe("thr_explicit");
      expect((requests[0]?.params as { turnId?: string })?.turnId).toBe("turn_explicit");
    } finally {
      await service.shutdown();
    }
  });

  test("throws when no interrupt target can be resolved", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };

    client.start = async () => undefined;
    client.request = async () => ({});
    service.readThread = async () => null;

    try {
      let failed = false;
      let message = "";
      try {
        await service.interruptTurn("thr_missing");
      } catch (error) {
        failed = true;
        message = error instanceof Error ? error.message : String(error);
      }

      expect(failed).toBe(true);
      expect(message).toBe("Could not determine which turn to interrupt");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service startTurn", () => {
  test("returns the immediate started turn payload without waiting for thread/read", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const markedActive: string[] = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = (threadId: string) => {
      markedActive.push(threadId);
    };
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_new",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      if (method === "thread/read") {
        throw new Error("thread/read should not be called when turn/start returns a turn");
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix");
      expect(startedTurn?.turnId).toBe("turn_new");
      expect(startedTurn?.status).toBe("inProgress");
      expect(typeof startedTurn?.turnStartedAtMs).toBe("number");
      expect((startedTurn?.turnStartedAtMs ?? 0) > 0).toBe(true);
      const turnStartRequests = requests.filter((request) => request.method === "turn/start");
      expect(turnStartRequests.length).toBe(1);
      expect(turnStartRequests[0]?.method).toBe("turn/start");
      expect((turnStartRequests[0]?.params as { summary?: unknown })?.summary).toBe("detailed");
      expect(markedActive.length).toBe(1);
      expect(markedActive[0]).toBe("thr_start");
    } finally {
      await service.shutdown();
    }
  });

  test("forwards an explicit fast service tier to turn/start", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_fast",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      await service.startTurn("thr_fast", "Ship it faster", {
        serviceTier: "fast",
        summary: "none",
      });

      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      expect(turnStartRequest).toBeDefined();
      expect((turnStartRequest?.params as { serviceTier?: unknown })?.serviceTier).toBe("fast");
      expect((turnStartRequest?.params as { summary?: unknown })?.summary).toBe("none");
    } finally {
      await service.shutdown();
    }
  });

  test("starts a follow-up for projectless thread metadata without forcing a workspace cwd", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (
        threadId: string,
      ) => { projectId: string | null | null; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: null, cwd: null });
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_projectless",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      const turn = await service.startTurn("thr_projectless", "Continue without project");
      expect(turn?.turnId).toBe("turn_projectless");
      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      expect(turnStartRequest).toBeDefined();
      expect(JSON.stringify(turnStartRequest?.params).includes('"cwd"')).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("applies the selected projectless permission scope to the next turn", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string | null; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    installTestPermissionState(service, null, {
      mode: "full-access",
      effectivePreset: "full-access",
      availableModes: ["auto", "full-access", "custom"],
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxMode: "danger-full-access",
      sandbox: { type: "dangerFullAccess" },
      autoReviewAvailable: true,
      configTarget: { source: "none", filePath: null },
      customDescription: null,
    });

    serviceInternals.parseThreadRef = () => ({
      projectId: null,
      cwd: "/workspace/projectless",
    });
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_projectless_full_access",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      throw new Error(`Unexpected app-server request: ${method}`);
    };

    try {
      const startedTurn = await service.startTurn("thread-projectless", "Use the selected mode");
      expect(startedTurn?.turnId).toBe("turn_projectless_full_access");
      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      expect(turnStartRequest?.params).toMatchObject({
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      });
    } finally {
      await service.shutdown();
    }
  });

  test("omits serviceTier from turn/start when standard is requested explicitly", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_standard",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      await service.startTurn("thr_standard", "Use the default tier", { serviceTier: null });

      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      const params = (turnStartRequest?.params as Record<string, unknown>) ?? {};
      expect(turnStartRequest).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(params, "serviceTier")).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("restores the params-owned turn when turn/start recovery rehydrates the thread", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      upsertLinkFromThread: () => null;
      buildThreadDetailFromCanonicalState: () => CodexThreadDetail;
      persistThreadDetailSummary: (detail: CodexThreadDetail) => void;
      handleNotification: (
        notification: CodexTestServerNotification,
        options?: { bypassResumeBuffer?: boolean },
      ) => Promise<void>;
      hasResumeNotificationBuffer: (id: string) => boolean;
      hydrateCanonicalConversationState: (
        input: ThreadResumeResponse,
      ) => CodexCanonicalConversationState;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
      emit: (eventName: string, payload: unknown) => boolean;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    const resumeOrder: string[] = [];
    let turnStartAttempts = 0;

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.upsertLinkFromThread = () => null;
    serviceInternals.buildThreadDetailFromCanonicalState = () => ({
      ...makeThreadDetail("thr_start"),
      cwd: "/workspace/project",
    });
    serviceInternals.persistThreadDetailSummary = () => {};
    serviceInternals.hydrateCanonicalConversationState(
      makeCanonicalResumeResponse({
        threadId: "thr_start",
        initialTurnsPage: {
          data: [],
          nextCursor: null,
          backwardsCursor: null,
        },
      }),
    );
    const originalHandleNotification = serviceInternals.handleNotification.bind(service);
    serviceInternals.handleNotification = async (notification, options) => {
      if (
        notification.method === "item/agentMessage/delta" &&
        !serviceInternals.hasResumeNotificationBuffer("thr_start")
      ) {
        const canonical = getCanonicalConversationState(service, "thr_start");
        resumeOrder.push(canonical ? "replay-after-hydration" : "replay-before-hydration");
      }
      await originalHandleNotification(notification, options);
    };
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        turnStartAttempts += 1;
        if (turnStartAttempts === 1) {
          throw new CodexRpcError("thread not found", -32600);
        }

        resumeOrder.push("turn-retry");
        return {
          turn: {
            id: "turn_retry",
            items: [],
            itemsView: "full",
            status: "inProgress",
            error: null,
            startedAt: 1,
            completedAt: null,
            durationMs: null,
          },
        };
      }

      if (method === "thread/resume") {
        await service.routeAppServerNotification({
          method: "item/agentMessage/delta",
          params: {
            threadId: "thr_start",
            turnId: "turn_hydrated",
            itemId: "item_hydrated",
            delta: " buffered",
          },
        });
        return makeCanonicalResumeResponse({
          threadId: "thr_start",
          initialTurnsPage: {
            data: [],
            nextCursor: null,
            backwardsCursor: null,
          },
        });
      }

      if (method === "thread/read") {
        return {
          thread: makeProtocolThread("thr_start", "/workspace/project", []),
        };
      }

      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix");
      expect(startedTurn?.turnId).toBe("turn_retry");
      expect(requests.map((request) => request.method).join(",")).toBe(
        "turn/start,thread/read,thread/resume,thread/goal/get,turn/start",
      );
      expect(resumeOrder.join(",")).toBe("replay-after-hydration,turn-retry");
      const resumeRequest = requests.find((request) => request.method === "thread/resume");
      expect(resumeRequest).toBeDefined();
      expect((resumeRequest?.params as { threadId?: string }).threadId).toBe("thr_start");
      const resumeConfig =
        (resumeRequest?.params as { config?: Record<string, unknown> })?.config ?? {};
      expect(resumeConfig["features.apply_patch_streaming_events"]).toBe(true);
      const snapshot = service.serializeConversationSnapshot("thr_start");
      const userItems =
        snapshot?.turns.flatMap((turn) => turn.items.filter((item) => item.role === "user")) ?? [];
      expect(userItems).toHaveLength(1);
      expect(userItems[0]?.markdownText).toBe("Ship the fix");
      expect(snapshot?.canonicalState?.turns).toHaveLength(1);
      expect(snapshot?.canonicalState?.turns[0]?.sidecar.params.input[0]).toMatchObject({
        type: "text",
        text: "Ship the fix",
      });
    } finally {
      await service.shutdown();
    }
  });

  test("passes full-access permission overrides through to turn/start", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_full_access",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix", {
        permissionMode: "full-access",
      });
      const turnStartRequests = requests.filter((request) => request.method === "turn/start");
      expect(startedTurn?.turnId).toBe("turn_full_access");
      expect(turnStartRequests.length).toBe(1);
      expect((turnStartRequests[0]?.params as { approvalPolicy?: string })?.approvalPolicy).toBe(
        "never",
      );
      expect(
        JSON.stringify(
          (turnStartRequests[0]?.params as { sandboxPolicy?: { type?: string } })?.sandboxPolicy,
        ),
      ).toBe(
        JSON.stringify({
          type: "dangerFullAccess",
        }),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("omits explicit permission overrides for custom mode", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_custom",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix", {
        permissionMode: "custom",
      });
      expect(startedTurn?.turnId).toBe("turn_custom");
      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      expect(turnStartRequest).toBeDefined();
      expect((turnStartRequest?.params as { approvalPolicy?: unknown })?.approvalPolicy).toBe(
        undefined,
      );
      expect((turnStartRequest?.params as { sandboxPolicy?: unknown })?.sandboxPolicy).toBe(
        undefined,
      );
      expect((turnStartRequest?.params as { model?: unknown })?.model).toBe(undefined);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service collaboration modes", () => {
  test("startTurn prefers explicit overrides over latest thread settings and legacy mode", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      ensureConversationDetail: (threadId: string) => CodexThreadDetail | null;
      parseThreadRef: (threadId: string) => { projectId: string | null; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params: params as Record<string, unknown> });
      if (method === "thread/settings/update") return {};
      if (method === "turn/start") {
        return {
          turn: {
            id: `turn_${requests.length}`,
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };
    serviceInternals.ensureConversationDetail("thr_start_settings_priority");

    try {
      await updateThreadSettingsForTest(service, "thr_start_settings_priority", {
        model: "gpt-settings",
        reasoningEffort: "medium",
        serviceTier: "fast",
        collaborationMode: "plan",
      });
      await service.startTurn("thr_start_settings_priority", "Use settings");
      await service.startTurn("thr_start_settings_priority", "Use explicit", {
        model: "gpt-explicit",
        reasoningEffort: "high",
        collaborationMode: "default",
      });

      const turnRequests = requests.filter((request) => request.method === "turn/start");
      const firstTurn = turnRequests[0]?.params;
      const secondTurn = turnRequests[1]?.params;
      const firstMode = firstTurn?.collaborationMode as { mode?: string } | undefined;
      const secondMode = secondTurn?.collaborationMode as { mode?: string } | undefined;

      expect(firstTurn?.model).toBe("gpt-settings");
      expect(firstTurn?.effort).toBe("medium");
      expect(firstTurn?.serviceTier).toBe("fast");
      expect(firstMode?.mode).toBe("plan");
      expect(firstTurn?.summary).toBe("detailed");
      expect(secondTurn?.model).toBe("gpt-explicit");
      expect(secondTurn?.effort).toBe("high");
      expect(secondMode?.mode).toBe("default");

      await service.startTurn("thr_start_settings_priority", "Suppress summaries", {
        summary: "none",
      });
      const thirdTurn = requests.filter((request) => request.method === "turn/start")[2]?.params;
      expect(thirdTurn?.summary).toBe("none");
    } finally {
      await service.shutdown();
    }
  });

  test("keeps next-turn settings when app-server has unloaded the task", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      ensureConversationDetail: (threadId: string) => CodexThreadDetail | null;
      parseThreadRef: (threadId: string) => { projectId: string | null; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const turnStarts: Array<Record<string, unknown>> = [];

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    client.start = async () => undefined;
    client.request = async (method, params) => {
      if (method === "thread/settings/update") {
        throw new CodexRpcError("thread not found: thr_unloaded_settings", -32600);
      }
      if (method === "turn/start") {
        turnStarts.push(params as Record<string, unknown>);
        return {
          turn: {
            id: "turn_unloaded_settings",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };
    serviceInternals.ensureConversationDetail("thr_unloaded_settings");

    try {
      const settings = await updateThreadSettingsForTest(service, "thr_unloaded_settings", {
        model: "gpt-settings",
        reasoningEffort: "high",
      });
      await service.startTurn("thr_unloaded_settings", "Use persisted settings");

      expect(settings.model).toBe("gpt-settings");
      expect(turnStarts).toEqual([
        expect.objectContaining({
          threadId: "thr_unloaded_settings",
          model: "gpt-settings",
          effort: "high",
        }),
      ]);
    } finally {
      await service.shutdown();
    }
  });

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

describe("codex-service startThreadForSession", () => {
  test("rejects a second Thread start for an already linked Session", async () => {
    const sessionId = "session-already-linked";
    const threadId = "thread-already-linked";
    const projectWorkspace = {
      ...createTestProjectWorkspace(),
      getProjectSession: async (candidateSessionId: string): Promise<ProjectSession | null> =>
        candidateSessionId === sessionId
          ? {
              id: sessionId,
              projectId: "alpha",
              noThreadFallbackTitle: "Existing chat",
              displayTitle: "Existing chat",
              order: 0,
              pinned: false,
              pinnedOrder: null,
              archived: false,
              archivedAt: null,
              unread: false,
              thread: {
                sessionId,
                projectId: "alpha",
                threadId,
                threadPreview: "Existing chat",
                modelProvider: "openai",
                executionHostId: "local",
                statusType: "idle",
                statusActiveFlags: [],
                archived: false,
                createdAt: 1,
                updatedAt: 1,
                linkedAt: "2026-08-15T00:00:00.000Z",
              },
              createdAt: "2026-08-15T00:00:00.000Z",
              updatedAt: "2026-08-15T00:00:00.000Z",
            }
          : null,
    } as DesktopProjectWorkspacePort;
    const service = createService({ projectWorkspace });
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: string[] = [];
    client.start = async () => undefined;
    client.request = async (method) => {
      requests.push(method);
      throw new Error(`Unexpected request: ${method}`);
    };

    try {
      await expect(
        service.startThreadForSession({
          projectId: "alpha",
          sessionId,
          prompt: "Do not create another Thread",
          runInTarget: "localProject",
        }),
      ).rejects.toThrow(`Project session is already linked to Codex thread: ${threadId}`);
      expect(requests).toEqual([]);
    } finally {
      await service.shutdown();
    }
  });

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

  test("generates commit messages through the app-server commit-message method", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateCommitMessage: (input: {
        hostId?: string | null;
        prompt: string;
        cwd: string;
      }) => Promise<string | null>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return { message: "  feat: generated commit message\n" };
    };

    try {
      const message = await serviceInternals.generateCommitMessage({
        hostId: "local",
        prompt: "Changes:\ndiff --git a/feature.txt b/feature.txt",
        cwd: "/tmp/project",
      });

      expect(message).toBe("feat: generated commit message");
      const capturedRequest = requests[0];
      expect(capturedRequest?.method).toBe("generate-commit-message");
      expect(JSON.stringify(capturedRequest?.params)).toBe(
        JSON.stringify({
          hostId: "local",
          prompt: "Changes:\ndiff --git a/feature.txt b/feature.txt",
          cwd: "/tmp/project",
        }),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("generates pull request messages through the app-server pull-request-message method", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generatePullRequestMessage: (input: {
        hostId?: string | null;
        prompt: string;
        cwd: string;
      }) => Promise<{ title: string | null; body: string | null }>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {
        title: "  Generated PR title\n",
        body: "  Generated PR body\n",
      };
    };

    try {
      const message = await serviceInternals.generatePullRequestMessage({
        hostId: "local",
        prompt: "Branches:\n- Head: feature\n- Base: main",
        cwd: "/tmp/project",
      });

      expect(JSON.stringify(message)).toBe(
        JSON.stringify({
          title: "Generated PR title",
          body: "Generated PR body",
        }),
      );
      const capturedRequest = requests[0];
      expect(capturedRequest?.method).toBe("generate-pull-request-message");
      expect(JSON.stringify(capturedRequest?.params)).toBe(
        JSON.stringify({
          hostId: "local",
          prompt: "Branches:\n- Head: feature\n- Base: main",
          cwd: "/tmp/project",
        }),
      );
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service pending managed worktree setup", () => {
  type PendingWorktreeCreator = {
    createPendingManagedWorktree: (
      entry: CodexPendingWorktreeEntry,
      context: {
        signal: AbortSignal;
        onEvent: (event: CodexWorktreeWorkerEvent) => void;
      },
    ) => Promise<{
      worktreeGitRoot: string;
      worktreeWorkspaceRoot: string;
      setupError: string | null;
    }>;
  };

  function makePendingManagedWorktreeEntry(input: {
    id: string;
    sourceWorkspaceRoot: string;
    localEnvironmentConfigPath: string | null;
    hostId?: string;
    startingState?: CodexPendingWorktreeEntry["startingState"];
  }): CodexPendingWorktreeEntry {
    return {
      id: input.id,
      hostId: input.hostId ?? "local",
      label: "Pending setup task",
      sourceWorkspaceRoot: input.sourceWorkspaceRoot,
      startingState:
        input.startingState === undefined
          ? { type: "branch", branchName: "main" }
          : input.startingState,
      localEnvironmentConfigPath: input.localEnvironmentConfigPath,
      prompt: "Run pending setup",
      launchMode: "start-conversation",
      clientThreadId: `client-new-thread:${input.id}`,
      startConversationParamsInput: {
        input: [],
        commentAttachments: [],
        workspaceRoots: [input.sourceWorkspaceRoot],
        cwd: input.sourceWorkspaceRoot,
        fileAttachments: [],
        addedFiles: [],
        agentMode: "auto",
        permissionProfileId: undefined,
        shouldSendPermissionOverrides: true,
        model: null,
        serviceTier: null,
        reasoningEffort: null,
        collaborationMode: null,
        config: {},
        threadSource: "subagent",
        workspaceKind: "project",
        projectAssignment: {
          projectKind: "local",
          projectId: `project-${input.id}`,
          pendingCoreUpdate: false,
        },
        serviceName: undefined,
      },
      sourceConversationId: null,
      sourceCollaborationMode: null,
      createdAt: 1,
      attempt: 1,
      phase: "creating",
      labelEdited: false,
      worktreeOutputText: "",
      setupOutputText: "",
      errorMessage: null,
      worktreeWorkspaceRoot: null,
      worktreeGitRoot: null,
      needsAttention: false,
      isPinned: false,
      pinnedBeforeThreadId: null,
    };
  }

  function pendingWorktreeCreator(service: TestableCodexService): PendingWorktreeCreator {
    return service as unknown as PendingWorktreeCreator;
  }

  async function withPendingWorktreeStore(run: () => Promise<void>): Promise<void> {
    const previousNodexHome = process.env.NODEX_HOME;
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-pending-worktree-store-"));
    process.env.NODEX_HOME = storeDir;
    try {
      await run();
    } finally {
      if (previousNodexHome === undefined) delete process.env.NODEX_HOME;
      else process.env.NODEX_HOME = previousNodexHome;
      fs.rmSync(storeDir, { recursive: true, force: true });
    }
  }

  test("keeps tagged allocated paths private before creation completes", async () => {
    const service = createService();
    const workerState: {
      finishCreation: () => void;
      resultSettled: boolean;
      signal: AbortSignal | null;
    } = {
      finishCreation: () => undefined,
      resultSettled: false,
      signal: null,
    };
    let pendingWorktreeId: string | null = null;
    const localWorker: CodexWorktreeWorkerPort = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      create: async (_input, options) => {
        const signal = options.signal;
        if (!signal) throw new Error("Expected request cancellation signal");
        workerState.signal = signal;
        const creationGate = new Promise<void>((resolve, reject) => {
          workerState.finishCreation = resolve;
          signal.addEventListener("abort", () => reject(new Error("Request canceled")), {
            once: true,
          });
        });
        options.onEvent({
          operation: "create",
          type: "path-allocated",
          worktreeGitRoot: "/local/worktrees/abcd/repo",
          worktreeWorkspaceRoot: "/local/worktrees/abcd/repo/packages/app",
        });
        options.onEvent({
          operation: "create",
          type: "output",
          phase: "worktree",
          stream: "info",
          data: "[info] Worktree path allocated\n",
        });
        await creationGate;
        workerState.resultSettled = true;
        return {
          worktreeGitRoot: "/local/worktrees/abcd/repo",
          worktreeWorkspaceRoot: "/local/worktrees/abcd/repo/packages/app",
          setupError: null,
          shellEnvironment: null,
        };
      },
      remove: async () => ({
        removed: true,
        alreadyMissing: false,
        snapshot: null,
        warnings: [],
      }),
    };
    (service as unknown as CodexService).setWorktreeWorkerPort("local", localWorker);

    try {
      const created = service.createPendingWorktree({
        hostId: "local",
        label: "Tagged path event",
        sourceWorkspaceRoot: "/local/repo",
        startingState: { type: "branch", branchName: "main" },
        localEnvironmentConfigPath: null,
        launchMode: "start-conversation",
        prompt: "Create an isolated worktree",
        startConversationParamsInput: {
          input: [],
          commentAttachments: [],
          workspaceRoots: ["/local/repo"],
          cwd: "/local/repo",
          fileAttachments: [],
          addedFiles: [],
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
            projectId: "project-tagged-path-event",
            pendingCoreUpdate: false,
          },
        },
        sourceConversationId: null,
        sourceCollaborationMode: null,
      });
      pendingWorktreeId = created.pendingWorktreeId;
      await flushAsyncWork();

      const entry = service
        .listPendingWorktrees()
        .find((candidate) => candidate.id === created.pendingWorktreeId);
      expect(entry).toMatchObject({
        phase: "creating",
        errorMessage: null,
        worktreeGitRoot: null,
        worktreeWorkspaceRoot: null,
        worktreeOutputText: [
          "[info] Starting worktree creation",
          "[info] Worktree path allocated",
          "",
        ].join("\n"),
      });
      expect(workerState.resultSettled).toBe(false);
      expect(workerState.signal?.aborted).toBe(false);
    } finally {
      if (pendingWorktreeId !== null) {
        service.cancelPendingWorktree("local", pendingWorktreeId);
      }
      workerState.finishCreation();
      await flushAsyncWork();
      await service.shutdown();
    }
  });

  test("releases newborn protection when creation fails after path allocation", async () => {
    const service = createService();
    const allocatedRoot = "/local/worktrees/abcd/repo";
    const localWorker: CodexWorktreeWorkerPort = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      create: async (_input, options) => {
        options.onEvent({
          operation: "create",
          type: "path-allocated",
          worktreeGitRoot: allocatedRoot,
          worktreeWorkspaceRoot: `${allocatedRoot}/packages/app`,
        });
        throw new Error("git worktree add failed");
      },
      remove: async () => ({
        removed: true,
        alreadyMissing: false,
        snapshot: null,
        warnings: [],
      }),
    };
    (service as unknown as CodexService).setWorktreeWorkerPort(
      "local",
      localWorker,
      "/local/worktrees",
    );

    try {
      await expect(
        pendingWorktreeCreator(service).createPendingManagedWorktree(
          makePendingManagedWorktreeEntry({
            id: "failed-after-allocation",
            sourceWorkspaceRoot: "/local/repo",
            localEnvironmentConfigPath: null,
          }),
          {
            signal: new AbortController().signal,
            onEvent: () => undefined,
          },
        ),
      ).rejects.toThrow("git worktree add failed");

      const lifecycle = (
        service as unknown as {
          managedWorktreeLifecycle: {
            listNewborns: () => readonly { readonly worktreeGitRoot: string }[];
          };
        }
      ).managedWorktreeLifecycle;
      expect(lifecycle.listNewborns().some((item) => item.worktreeGitRoot === allocatedRoot)).toBe(
        false,
      );
    } finally {
      await service.shutdown();
    }
  });

  test("removes a created worktree when cancellation wins after the worker result", async () => {
    const service = createService();
    const abortController = new AbortController();
    const removed: CodexWorktreeWorkerRemoveInput[] = [];
    const allocatedRoot = "/local/worktrees/abcd/repo";
    const localWorker: CodexWorktreeWorkerPort = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      create: async (_input, options) => {
        options.onEvent({
          operation: "create",
          type: "path-allocated",
          worktreeGitRoot: allocatedRoot,
          worktreeWorkspaceRoot: `${allocatedRoot}/packages/app`,
        });
        abortController.abort();
        return {
          worktreeGitRoot: allocatedRoot,
          worktreeWorkspaceRoot: `${allocatedRoot}/packages/app`,
          setupError: null,
          shellEnvironment: null,
        };
      },
      remove: async (input) => {
        removed.push(input);
        return {
          removed: true,
          alreadyMissing: false,
          snapshot: null,
          warnings: [],
        };
      },
    };
    (service as unknown as CodexService).setWorktreeWorkerPort(
      "local",
      localWorker,
      "/local/worktrees",
    );

    try {
      await expect(
        pendingWorktreeCreator(service).createPendingManagedWorktree(
          makePendingManagedWorktreeEntry({
            id: "canceled-after-worker-result",
            sourceWorkspaceRoot: "/local/repo",
            localEnvironmentConfigPath: null,
          }),
          { signal: abortController.signal, onEvent: () => undefined },
        ),
      ).rejects.toThrow("Request canceled");
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({
        hostId: "local",
        worktreeGitRoot: allocatedRoot,
        reason: "cancel",
      });
    } finally {
      await service.shutdown();
    }
  });

  test("routes remote creation to its registered host without reading local source state", async () => {
    const service = createService();
    const inputs: CodexWorktreeWorkerCreateInput[] = [];
    const remoteWorker: CodexWorktreeWorkerPort = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "remote-1" }),
      create: async (input, options) => {
        inputs.push(input);
        options.onEvent({
          operation: "create",
          type: "path-allocated",
          worktreeGitRoot: "/remote/worktrees/abcd/repo",
          worktreeWorkspaceRoot: "/remote/worktrees/abcd/repo/packages/app",
        });
        return {
          worktreeGitRoot: "/remote/worktrees/abcd/repo",
          worktreeWorkspaceRoot: "/remote/worktrees/abcd/repo/packages/app",
          setupError: null,
          shellEnvironment: null,
        };
      },
      remove: async () => ({
        removed: true,
        alreadyMissing: false,
        snapshot: null,
        warnings: [],
      }),
    };
    (service as unknown as CodexService).setWorktreeWorkerPort(
      "remote-1",
      remoteWorker,
      "/remote/worktrees",
    );

    try {
      const result = await pendingWorktreeCreator(service).createPendingManagedWorktree(
        makePendingManagedWorktreeEntry({
          id: "remote-default-state",
          hostId: "remote-1",
          sourceWorkspaceRoot: "/remote/repo",
          startingState: null,
          localEnvironmentConfigPath: null,
        }),
        {
          signal: new AbortController().signal,
          onEvent: () => undefined,
        },
      );

      expect(result.worktreeGitRoot).toBe("/remote/worktrees/abcd/repo");
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({
        hostId: "remote-1",
        repositoryPath: "/remote/repo",
        startingState: null,
        propagateLocalWorkspaceFiles: false,
      });
    } finally {
      await service.shutdown();
    }
  });

  test("streams selected setup output after setup start and persists its shell environment", async () => {
    await withPendingWorktreeStore(async () => {
      const repositoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-pending-setup-success-"));
      initializeGitRepository(repositoryPath);
      const environmentsDir = path.join(repositoryPath, ".codex", "environments");
      fs.mkdirSync(environmentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(environmentsDir, "environment.toml"),
        [
          'name = "pending-setup-success"',
          "",
          "[setup]",
          "script = '''",
          "echo pending-setup-output",
          "export NODEX_PENDING_SETUP_CAPTURED=ready",
          "'''",
          "",
        ].join("\n"),
        "utf8",
      );
      const service = createService({
        loadWorktreeSetupBaseEnvironment: async () => ({ ...process.env }),
      });
      const serviceInternals = pendingWorktreeCreator(service);
      const events: string[] = [];
      let worktreeGitRoot = "";

      try {
        const result = await serviceInternals.createPendingManagedWorktree(
          makePendingManagedWorktreeEntry({
            id: "pending-setup-success",
            sourceWorkspaceRoot: repositoryPath,
            localEnvironmentConfigPath: ".codex/environments/environment.toml",
          }),
          {
            signal: new AbortController().signal,
            onEvent: (event) => {
              if (event.type === "output") {
                events.push(`${event.phase}-output:${event.data}`);
                return;
              }
              if (event.type === "path-allocated") {
                events.push(`allocated:${event.worktreeGitRoot}`);
                return;
              }
              events.push("setup-started");
            },
          },
        );
        worktreeGitRoot = result.worktreeGitRoot;

        expect(result.setupError).toBe(null);
        const setupStartedIndex = events.indexOf("setup-started");
        const setupOutputIndex = events.findIndex((event) =>
          event.includes("pending-setup-output"),
        );
        expect(setupStartedIndex >= 0).toBe(true);
        expect(setupOutputIndex > setupStartedIndex).toBe(true);

        const rawGitPath = execFileSync(
          "git",
          ["rev-parse", "--git-path", "codex-shell-environment.json"],
          { cwd: result.worktreeWorkspaceRoot, encoding: "utf8" },
        ).trim();
        const persistedPath = path.isAbsolute(rawGitPath)
          ? rawGitPath
          : path.resolve(result.worktreeWorkspaceRoot, rawGitPath);
        const persisted = JSON.parse(fs.readFileSync(persistedPath, "utf8")) as {
          set?: Record<string, string>;
        };
        expect(persisted.set?.NODEX_PENDING_SETUP_CAPTURED).toBe("ready");
      } finally {
        if (worktreeGitRoot) await removeManagedWorktree(worktreeGitRoot);
        await service.shutdown();
        fs.rmSync(repositoryPath, { recursive: true, force: true });
      }
    });
  });

  test("retains allocated worktrees when selected environment parsing or setup fails", async () => {
    await withPendingWorktreeStore(async () => {
      const repositoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-pending-setup-fail-"));
      initializeGitRepository(repositoryPath);
      const environmentsDir = path.join(repositoryPath, ".codex", "environments");
      fs.mkdirSync(environmentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(environmentsDir, "invalid.toml"),
        "[setup\nscript = 'invalid'\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(environmentsDir, "failing.toml"),
        [
          'name = "pending-setup-fail"',
          "",
          "[setup]",
          "script = '''",
          "echo pending-setup-failed",
          "exit 9",
          "'''",
          "",
        ].join("\n"),
        "utf8",
      );
      const service = createService({
        loadWorktreeSetupBaseEnvironment: async () => ({ ...process.env }),
      });
      const serviceInternals = pendingWorktreeCreator(service);
      const allocatedRoots: string[] = [];

      try {
        for (const scenario of [
          {
            id: "pending-parse-failure",
            configPath: ".codex/environments/invalid.toml",
            expectedError: "Could not parse environment file",
          },
          {
            id: "pending-script-failure",
            configPath: ".codex/environments/failing.toml",
            expectedError: "Worktree environment setup script failed",
          },
        ]) {
          let setupStarted = 0;
          let output = "";
          const result = await serviceInternals.createPendingManagedWorktree(
            makePendingManagedWorktreeEntry({
              id: scenario.id,
              sourceWorkspaceRoot: repositoryPath,
              localEnvironmentConfigPath: scenario.configPath,
            }),
            {
              signal: new AbortController().signal,
              onEvent: (event) => {
                if (event.type === "output") {
                  output += event.data;
                  return;
                }
                if (event.type === "setup-started") setupStarted += 1;
              },
            },
          );
          allocatedRoots.push(result.worktreeGitRoot);

          expect(setupStarted).toBe(1);
          expect(result.setupError?.includes(scenario.expectedError) ?? false).toBe(true);
          expect(fs.existsSync(result.worktreeGitRoot)).toBe(true);
          const worktreeList = execFileSync("git", ["worktree", "list", "--porcelain"], {
            cwd: repositoryPath,
            encoding: "utf8",
          });
          expect(worktreeList.includes(path.resolve(result.worktreeGitRoot))).toBe(true);
          if (scenario.id === "pending-script-failure") {
            expect(output.includes("pending-setup-failed")).toBe(true);
          }
        }
      } finally {
        for (const root of allocatedRoots) {
          await removeManagedWorktree(root);
        }
        await service.shutdown();
        fs.rmSync(repositoryPath, { recursive: true, force: true });
      }
    });
  });

  test("rolls back canceled setup and treats shell-environment persistence as nonfatal", async () => {
    await withPendingWorktreeStore(async () => {
      const repositoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-pending-setup-cancel-"));
      initializeGitRepository(repositoryPath);
      const environmentsDir = path.join(repositoryPath, ".codex", "environments");
      fs.mkdirSync(environmentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(environmentsDir, "environment.toml"),
        [
          'name = "pending-setup-cancel"',
          "",
          "[setup]",
          "script = 'export NODEX_PENDING_PERSIST_CAPTURED=ready'",
          "",
        ].join("\n"),
        "utf8",
      );
      const service = createService();
      const serviceInternals = pendingWorktreeCreator(service);
      const abortController = new AbortController();

      try {
        let message = "";
        try {
          await serviceInternals.createPendingManagedWorktree(
            makePendingManagedWorktreeEntry({
              id: "pending-setup-cancel",
              sourceWorkspaceRoot: repositoryPath,
              localEnvironmentConfigPath: ".codex/environments/environment.toml",
            }),
            {
              signal: abortController.signal,
              onEvent: (event) => {
                if (event.type === "setup-started") abortController.abort();
              },
            },
          );
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toBe("Request canceled");

        const persistOwner = service as unknown as {
          persistWorktreeShellEnvironment: () => Promise<void>;
        };
        persistOwner.persistWorktreeShellEnvironment = async () => {
          const error = new Error("persist aborted");
          error.name = "AbortError";
          throw error;
        };
        let persistenceOutput = "";
        const persistenceResult = await serviceInternals.createPendingManagedWorktree(
          makePendingManagedWorktreeEntry({
            id: "pending-setup-persist-error",
            sourceWorkspaceRoot: repositoryPath,
            localEnvironmentConfigPath: ".codex/environments/environment.toml",
          }),
          {
            signal: new AbortController().signal,
            onEvent: (event) => {
              if (event.type === "output") persistenceOutput += event.data;
            },
          },
        );
        expect(persistenceResult.setupError).toBe(null);
        expect(fs.existsSync(persistenceResult.worktreeGitRoot)).toBe(true);
        expect(persistenceOutput).toContain(
          "Failed to store worktree shell environment: persist aborted",
        );

        const worktreeList = execFileSync("git", ["worktree", "list", "--porcelain"], {
          cwd: repositoryPath,
          encoding: "utf8",
        });
        expect(worktreeList.includes(persistenceResult.worktreeGitRoot)).toBe(true);
        await removeManagedWorktree(persistenceResult.worktreeGitRoot);
      } finally {
        await service.shutdown();
        fs.rmSync(repositoryPath, { recursive: true, force: true });
      }
    });
  });

  test("creates setup Auto-fix as a separate system task and preserves the original failure", async () => {
    const service = createService();
    const base = makePendingManagedWorktreeEntry({
      id: "pending-repair-source",
      sourceWorkspaceRoot: "/repo/source",
      localEnvironmentConfigPath: ".codex/environments/dev.toml",
    }) as Extract<CodexPendingWorktreeEntry, { launchMode: "start-conversation" }>;
    const original = {
      ...base,
      phase: "failed" as const,
      worktreeOutputText: "created\n",
      setupOutputText: "install failed\n",
      errorMessage: "setup exited 1",
      worktreeWorkspaceRoot: "/repo/worktrees/failed",
      worktreeGitRoot: "/repo/worktrees/failed",
      needsAttention: true,
      startConversationParamsInput: {
        ...base.startConversationParamsInput,
        input: [{ type: "text" as const, text: "Original request", text_elements: [] }],
        commentAttachments: [
          {
            id: "comment",
            type: "comment" as const,
            content: [{ content_type: "text" as const, text: "Review this line" }],
            position: { side: "right" as const, path: "src/index.ts", line: 1 },
            createdAt: 1,
          },
        ],
        fileAttachments: [
          {
            label: "before.txt",
            path: "before.txt",
            fsPath: "before.txt",
          },
        ],
        addedFiles: [
          {
            label: "added.txt",
            path: "added.txt",
            fsPath: "added.txt",
          },
        ],
        serviceTier: "standard",
      },
    } satisfies CodexPendingWorktreeEntry;
    const captured: CodexPendingWorktreeRequest[] = [];
    const pendingRuntime = Reflect.get(service as object, "pendingWorktreeRuntime") as {
      list: () => readonly CodexPendingWorktreeEntry[];
      create: (request: CodexPendingWorktreeRequest) => void;
    };
    pendingRuntime.list = () => [original];
    pendingRuntime.create = (request) => {
      captured.push(request);
    };
    const serviceInternals = service as unknown as {
      resolveDynamicCreateServiceTier: () => Promise<string | null>;
    };
    serviceInternals.resolveDynamicCreateServiceTier = async () => "fast";
    const repairService = service as unknown as {
      createPendingWorktreeSetupRepair: (
        hostId: string,
        pendingWorktreeId: string,
        agentMode: CodexAgentMode,
      ) => Promise<{ pendingWorktreeId: string; clientThreadId: string | null }>;
    };

    try {
      const result = await repairService.createPendingWorktreeSetupRepair(
        "local",
        original.id,
        "read-only",
      );
      const repair = captured[0];

      expect(result.pendingWorktreeId.startsWith("local:")).toBe(true);
      expect(result.clientThreadId?.startsWith("client-new-thread:") ?? false).toBe(true);
      expect(captured.length).toBe(1);
      expect(pendingRuntime.list()[0] === original).toBe(true);
      expect(repair?.launchMode).toBe("start-conversation");
      if (repair?.launchMode !== "start-conversation") {
        throw new Error("Expected a repair start request");
      }
      expect(repair.label).toBe("Fix worktree setup");
      expect(repair.initialThreadTitle).toBe("Fix worktree setup");
      expect(repair.localEnvironmentConfigPath).toBe(null);
      expect(repair.startConversationParamsInput.threadSource).toBe("system");
      expect(repair.startConversationParamsInput.agentMode).toBe(
        original.startConversationParamsInput.agentMode,
      );
      expect(repair.startConversationParamsInput.agentMode === "read-only").toBe(false);
      expect(repair.startConversationParamsInput.serviceTier).toBe("fast");
      expect(repair.startConversationParamsInput.commentAttachments.length).toBe(0);
      expect(repair.startConversationParamsInput.fileAttachments.length).toBe(0);
      expect(repair.startConversationParamsInput.addedFiles.length).toBe(0);
      const repairInput = repair.startConversationParamsInput.input[0];
      expect(repairInput?.type).toBe("text");
      expect(
        repairInput?.type === "text" &&
          repairInput.text.includes("Do not continue the original user request") &&
          repairInput.text.includes(".codex/environments/dev.toml") &&
          repairInput.text.includes("install failed"),
      ).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("builds non-start Auto-fix from explicit host permissions without invented fields", async () => {
    const service = createService();
    const original = {
      id: "local:pending-fork-repair-source",
      hostId: "local",
      label: "Fork with failed setup",
      sourceWorkspaceRoot: "/repo/source",
      sourceWorkspaceRoots: ["/repo/source"],
      localEnvironmentConfigPath: ".codex/environments/dev.toml",
      prompt: "Continue in a worktree",
      launchMode: "fork-conversation" as const,
      clientThreadId: "client-new-thread:fork-repair-source",
      startConversationParamsInput: null,
      projectAssignment: {
        projectKind: "local" as const,
        projectId: "project-fork-repair-source",
        path: "/repo/source",
        pendingCoreUpdate: false as const,
      },
      sourceConversationId: "thread-fork-repair-source",
      sourceCollaborationMode: {
        mode: "plan" as const,
        settings: {
          model: "gpt-frozen-plan",
          reasoning_effort: "high" as const,
          developer_instructions: null,
        },
      },
      targetTurnId: "turn-fork-repair-source",
      threadSource: "user" as const,
      createdAt: 1,
      attempt: 1,
      phase: "failed" as const,
      labelEdited: false,
      worktreeOutputText: "created\n",
      setupOutputText: "install failed\n",
      errorMessage: "setup exited 1",
      worktreeWorkspaceRoot: "/repo/worktrees/failed",
      worktreeGitRoot: "/repo/worktrees/failed",
      needsAttention: true,
      isPinned: false,
      pinnedBeforeThreadId: null,
    } satisfies CodexPendingWorktreeEntry;
    const captured: CodexPendingWorktreeRequest[] = [];
    const pendingRuntime = Reflect.get(service as object, "pendingWorktreeRuntime") as {
      list: () => readonly CodexPendingWorktreeEntry[];
      create: (request: CodexPendingWorktreeRequest) => void;
    };
    pendingRuntime.list = () => [original];
    pendingRuntime.create = (request) => {
      captured.push(request);
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method) => {
      if (method === "config/read") return { config: { model: "gpt-config" } };
      throw new Error(`Unexpected request: ${method}`);
    };
    const serviceInternals = service as unknown as {
      resolveDynamicCreateServiceTier: () => Promise<string | null>;
    };
    serviceInternals.resolveDynamicCreateServiceTier = async () => "fast";

    try {
      await (
        service as unknown as {
          createPendingWorktreeSetupRepair: (
            hostId: string,
            pendingWorktreeId: string,
            agentMode: CodexAgentMode,
          ) => Promise<unknown>;
        }
      ).createPendingWorktreeSetupRepair("local", original.id, "full-access");
      const repair = captured[0];
      if (repair?.launchMode !== "start-conversation") {
        throw new Error("Expected a repair start request");
      }

      expect(repair.startingState).toBe(undefined);
      expect(repair.startConversationParamsInput.agentMode).toBe("full-access");
      expect(repair.startConversationParamsInput.collaborationMode?.mode).toBe("plan");
      expect(repair.startConversationParamsInput.collaborationMode?.settings.model).toBe(
        "gpt-frozen-plan",
      );
      for (const key of ["permissionProfileId", "projectAssignment", "serviceName"]) {
        expect(Object.prototype.hasOwnProperty.call(repair.startConversationParamsInput, key)).toBe(
          false,
        );
      }
      expect(pendingRuntime.list()[0] === original).toBe(true);
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

  test("readiness failure removes materialized goal files but retains raw sources", async () => {
    const attachmentsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-goal-readiness-fail-"));
    const service = createService({ resolveThreadGoalAttachmentsRoot: () => attachmentsRoot });
    const internals = pendingGoalInternals(service);
    const manager = await internals.getPastedTextAttachmentManager();
    const source = await manager.createRawSource({ text: "retry after app-server readiness" });
    const goalManager = await internals.getThreadGoalDirectoryManager();
    const materialized = await goalManager.materializeDraft({
      objective: "Retry the eager-local goal",
      pastedTextAttachments: [source],
      imageAttachments: [],
    });
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
    };
    client.start = async () => {
      throw new Error("app-server unavailable");
    };

    try {
      let errorMessage = "";
      try {
        await service.startThreadForSession({
          projectId: "missing-project",
          sessionId: "missing-session",
          prompt: materialized.objective,
          threadGoalDraft: {
            objective: "Retry the eager-local goal",
            pastedTextAttachments: [source],
            imageAttachments: [],
          },
          threadGoalMaterializedDraft: materialized,
          runInTarget: "localProject",
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toBe("app-server unavailable");
      expect(fs.existsSync(materialized.attachmentDirectory ?? "")).toBe(false);
      expect(fs.existsSync(source.file.fsPath)).toBe(true);
    } finally {
      await manager.remove(source.file.path).catch(() => undefined);
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
      respondToUserInput: (
        requestId: string | number,
        answers: Record<string, string[]>,
        conversationId: string,
      ) => Promise<boolean>;
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
      expect(await serviceInternals.respondToUserInput(requestId, {}, threadId)).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("routes timeout through the canonical empty-response lifecycle before notifying the owner", async () => {
    const clock = createUserInputAutoResolutionTestClock();
    const service = createService({
      userInputAutoResolutionTimer: clock,
    });
    const changes: CodexUserInputAutoResolutionChange[] = [];
    const ownerMessages: Array<{
      targetClientId: string;
      message: CodexHostMessage;
    }> = [];
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getUserInputAutoResolutionSnapshot: () => CodexUserInputAutoResolutionEntry[];
      getConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState;
      };
      on: (
        event: "userInputAutoResolutionChanged",
        listener: (change: CodexUserInputAutoResolutionChange) => void,
      ) => void;
    };
    const threadId = "thread-auto-resolution-timeout";
    const requestId = "request-auto-resolution-timeout";

    serviceInternals.on("userInputAutoResolutionChanged", (change) => {
      changes.push(change);
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
    service.setRendererConversationOwner(threadId, "owner-auto-resolution");

    try {
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
      expect(serviceInternals.getUserInputAutoResolutionSnapshot()[0]?.phase.type).toBe(
        "scheduled",
      );

      clock.advanceBy(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS);
      expect(serviceInternals.getUserInputAutoResolutionSnapshot()).toEqual([]);
      expect(changes.at(-1)).toEqual({
        type: "timedOut",
        conversationId: threadId,
        requestId,
      });
      expect(await request).toEqual({ answers: {} });
      await Promise.resolve();

      expect(
        serviceInternals
          .getConversationRecord(threadId)
          .canonicalState.requests.some(
            (candidate) =>
              candidate.method === "item/tool/requestUserInput" && candidate.id === requestId,
          ),
      ).toBe(false);
      expect(ownerMessages).toContainEqual({
        targetClientId: "owner-auto-resolution",
        message: expect.objectContaining({
          type: "threadOwnerNotification",
          notification: {
            method: "serverRequest/resolved",
            params: {
              threadId,
              requestId,
            },
          },
        }),
      });
    } finally {
      await service.shutdown();
    }
  });

  test("keeps blocking user-input requests pending until the user responds", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getUserInputAutoResolutionSnapshot: () => CodexUserInputAutoResolutionEntry[];
      respondToUserInput: (
        requestId: string | number,
        answers: Record<string, string[]>,
        conversationId: string,
      ) => Promise<boolean>;
    };
    const threadId = "thread-blocking-user-input";
    const requestId = "request-blocking-user-input";

    try {
      const request = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/tool/requestUserInput",
        params: {
          threadId,
          turnId: "turn-1",
          itemId: "item-1",
          isBlocking: true,
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

      expect(serviceInternals.getUserInputAutoResolutionSnapshot()).toEqual([]);
      expect(
        await serviceInternals.respondToUserInput(requestId, { scope: ["yes"] }, threadId),
      ).toBe(true);
      expect(await request).toEqual({
        answers: {
          scope: { answers: ["yes"] },
        },
      });
    } finally {
      await service.shutdown();
    }
  });

  test("tracks only the latest typed user-input request per conversation", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getUserInputAutoResolutionSnapshot: () => CodexUserInputAutoResolutionEntry[];
      respondToUserInput: (
        requestId: string | number,
        answers: Record<string, string[]>,
        conversationId: string,
      ) => Promise<boolean>;
    };
    const threadId = "thread-auto-resolution-replacement";
    const request = (id: string | number, itemId: string) =>
      serviceInternals.handleServerRequest({
        id,
        method: "item/tool/requestUserInput",
        params: {
          threadId,
          turnId: "turn-1",
          itemId,
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

    try {
      const numeric = request(73, "item-numeric");
      const textual = request("73", "item-textual");
      await Promise.resolve();

      expect(serviceInternals.getUserInputAutoResolutionSnapshot()).toEqual([
        expect.objectContaining({
          conversationId: threadId,
          requestId: "73",
        }),
      ]);

      expect(await serviceInternals.respondToUserInput("73", {}, threadId)).toBe(true);
      expect(await serviceInternals.respondToUserInput(73, {}, threadId)).toBe(true);
      await textual;
      await numeric;
    } finally {
      await service.shutdown();
    }
  });

  test("ignores unknown future server-request methods without a JSON-RPC response", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
    };

    try {
      const result = await serviceInternals.handleServerRequest({
        id: "future-server-request",
        method: "future/request",
        params: { threadId: "thr_future_request" },
      });
      expect(result).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(service.serializeConversationSnapshot("thr_future_request")).toBe(null);
    } finally {
      await service.shutdown();
    }
  });

  test("ignores missing and empty thread ids for exact direct interactive request families", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      conversationRecords: Map<string, unknown>;
    };
    installManualApprovalState(service, "project-invalid-thread-id");
    const directRequests = [
      {
        method: "item/commandExecution/requestApproval",
        params: {
          turnId: "turn-command",
          itemId: "command-1",
          reason: "Command route",
          command: "bun test",
          cwd: "/repo",
        },
      },
      {
        method: "item/fileChange/requestApproval",
        params: {
          turnId: "turn-file",
          itemId: "file-1",
          reason: "File route",
          grantRoot: "/repo",
        },
      },
      {
        method: "item/tool/requestUserInput",
        params: {
          turnId: "turn-user-input",
          itemId: "user-input-1",
          isBlocking: true,
          questions: [],
        },
      },
      {
        method: "item/tool/requestOptionPicker",
        params: {
          turnId: "turn-option",
          question: "Choose",
          options: [{ label: "A", description: "Option A" }],
          allowMultiple: false,
          submitLabel: "Continue",
          skipLabel: null,
        },
      },
      {
        method: "item/tool/requestSetupCodexContextPicker",
        params: {
          turnId: "turn-setup",
        },
      },
    ] as const;

    try {
      for (const [index, request] of directRequests.entries()) {
        const missingResult = await serviceInternals.handleServerRequest({
          id: `missing-thread-${index}`,
          method: request.method,
          params: request.params,
        });
        const emptyResult = await serviceInternals.handleServerRequest({
          id: `empty-thread-${index}`,
          method: request.method,
          params: { ...request.params, threadId: "" },
        });
        expect(missingResult).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
        expect(emptyResult).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      }

      expect(serviceInternals.conversationRecords.size).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("lists and filters Core-owned automations through the dynamic tool", async () => {
    const automationModule = createTestAutomationModule();
    automationModule.listDefinitions = async () => [
      {
        id: "release-watch",
        definitionRevision: 3,
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Release watch",
        prompt: "Check release readiness.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: "gpt-5",
        modelProvider: null,
        harnessId: null,
        reasoningEffort: "medium",
        serviceTier: null,
        cwds: ["/workspace/release"],
        executionEnvironment: "local",
        localEnvironmentConfigPath: null,
        nextRunAt: 200,
        lastRunAt: 100,
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: "unrelated",
        definitionRevision: 1,
        kind: "heartbeat",
        status: "PAUSED",
        targetThreadId: "thread-other",
        name: "Unrelated follow-up",
        prompt: "Follow up later.",
        rrule: "FREQ=DAILY",
        model: null,
        modelProvider: null,
        harnessId: null,
        reasoningEffort: null,
        serviceTier: null,
        cwds: [],
        executionEnvironment: "worktree",
        localEnvironmentConfigPath: null,
        nextRunAt: null,
        lastRunAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const service = createService({ automationModule });
    const serviceInternals = service as unknown as {
      handleDynamicToolCall: (params: {
        threadId: string;
        turnId: string;
        callId: string;
        namespace: string;
        tool: string;
        arguments: Record<string, unknown>;
      }) => Promise<{ contentItems: Array<{ text?: string }>; success: boolean }>;
    };

    try {
      const response = await serviceInternals.handleDynamicToolCall({
        threadId: "thread-automation-list",
        turnId: "turn-automation-list",
        callId: "call-automation-list",
        namespace: "codex_app",
        tool: "automation_update",
        arguments: { mode: "list", query: "release", limit: 5 },
      });
      const output = JSON.parse(response.contentItems[0]?.text ?? "null") as {
        query?: string;
        automations?: Array<Record<string, unknown>>;
      };

      expect(response.success).toBe(true);
      expect(output.query).toBe("release");
      expect(output.automations).toEqual([
        {
          id: "release-watch",
          kind: "cron",
          status: "ACTIVE",
          name: "Release watch",
          prompt: "Check release readiness.",
          rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
          targetThreadId: null,
          nextRunAt: 200,
        },
      ]);
    } finally {
      await service.shutdown();
    }
  });

  test("fails closed when an older persisted handoff call reaches an unavailable transaction", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      evaluateLocalThreadHandoffCapability: () => {
        status: "unavailable";
        reasons: readonly ["host-transaction-unavailable"];
      };
      handleDynamicToolCall: (params: {
        threadId: string;
        turnId: string;
        callId: string;
        namespace: string;
        tool: string;
        arguments: Record<string, unknown>;
      }) => Promise<{ contentItems: Array<{ text?: string }>; success: boolean }>;
    };
    serviceInternals.evaluateLocalThreadHandoffCapability = () => ({
      status: "unavailable",
      reasons: ["host-transaction-unavailable"],
    });

    try {
      const response = await serviceInternals.handleDynamicToolCall({
        threadId: "thread-handoff-caller",
        turnId: "turn-handoff-caller",
        callId: "call-handoff-persisted",
        namespace: "codex_app",
        tool: "handoff_thread",
        arguments: { threadId: "thread-handoff-target" },
      });

      expect(response.success).toBe(false);
      expect(response.contentItems[0]?.text).toContain(
        "Task handoff is unavailable because its transactional runtime is not ready",
      );
    } finally {
      await service.shutdown();
    }
  });

  test("moves one durable task between its checkout and managed worktree", async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-thread-handoff-vertical-"));
    const repositoryPath = path.join(fixtureRoot, "repository");
    const managedRoot = path.join(fixtureRoot, "managed");
    const runtimeStateHome = path.join(fixtureRoot, "agent");
    initializeGitRepository(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, "README.md"), "# changed during handoff\n");
    fs.writeFileSync(path.join(repositoryPath, "untracked.txt"), "preserve me\n");
    const project = makeProject({
      id: "project:handoff",
      sources: [{ root: repositoryPath, order: 0 }],
      primaryWorkspaceRoot: repositoryPath,
    });
    const baseWorkspace = createTestProjectWorkspace();
    const projectWorkspace = {
      ...baseWorkspace,
      getProject: async (projectId: string) => (projectId === project.id ? project : null),
    } as DesktopProjectWorkspacePort;
    const threadId = "thread:handoff-vertical";
    await projectWorkspace.upsertThread(threadId, {
      projectId: project.id,
      threadName: "Move this task",
      threadPreview: "Move this task",
      executionHostId: "local",
      cwd: repositoryPath,
      managedWorktreePath: null,
      status: { statusType: "idle", activeFlags: [] },
    });
    await projectWorkspace.replaceThreadWritableRoots(threadId, [repositoryPath]);
    const service = createService({ projectWorkspace, runtimeStateHome });
    (service as unknown as CodexService).setWorktreeWorkerPort(
      "local",
      createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      managedRoot,
    );
    const rolloutPath = path.join(runtimeStateHome, "sessions", "rollout.jsonl");
    let runtimeCwd = repositoryPath;
    let runtimeRoots = [repositoryPath];
    const resumeRequests: Array<Record<string, unknown>> = [];
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      if (method === "thread/read") {
        return {
          thread: {
            ...makeProtocolThread(threadId, runtimeCwd),
            path: rolloutPath,
            status: { type: "notLoaded" as const },
          },
        };
      }
      if (method === "thread/resume") {
        const request = params as Record<string, unknown>;
        resumeRequests.push(request);
        runtimeCwd = String(request.cwd);
        runtimeRoots = [...(request.runtimeWorkspaceRoots as string[])];
        const response = makeCanonicalForkResumeResponse(
          makeCanonicalForkResponse({
            threadId,
            cwd: runtimeCwd,
            turns: [],
            runtimeWorkspaceRoots: runtimeRoots,
          }),
        );
        return {
          ...response,
          thread: { ...response.thread, path: rolloutPath },
        };
      }
      throw new Error(`Unexpected app-server request: ${method}`);
    };
    const internals = service as unknown as {
      buildMcpCodexConfig: () => Promise<null>;
      buildThreadExecutionLocationEffects: () => import("../codex-application/CodexThreadHandoffRuntimePromiseAdapter").CodexThreadHandoffPromiseEffects;
      threadHandoffRuntime: {
        start(
          input: {
            operationId: string;
            threadId: string;
            destinationHostId: string | null;
            followUpPrompt: string | null;
          },
          effects: import("../codex-application/CodexThreadHandoffRuntimePromiseAdapter").CodexThreadHandoffPromiseEffects,
        ): Promise<CodexThreadHandoffJournalEntry>;
      };
    };
    internals.buildMcpCodexConfig = async () => null;

    try {
      const movedToWorktree = await internals.threadHandoffRuntime.start(
        {
          operationId: "handoff-to-worktree",
          threadId,
          destinationHostId: null,
          followUpPrompt: null,
        },
        internals.buildThreadExecutionLocationEffects(),
      );
      const worktreeThread = await projectWorkspace.getThread(threadId);
      const worktreePath = worktreeThread?.managedWorktreePath;
      expect(movedToWorktree.phase).toBe("completed");
      expect(worktreePath).toBeTruthy();
      expect(worktreeThread?.threadId).toBe(threadId);
      expect(worktreeThread?.cwd).toBe(runtimeCwd);
      expect(runtimeRoots).toEqual([worktreeThread?.cwd]);
      expect(fs.readFileSync(path.join(runtimeCwd, "README.md"), "utf8")).toBe(
        "# changed during handoff\n",
      );
      expect(fs.readFileSync(path.join(runtimeCwd, "untracked.txt"), "utf8")).toBe("preserve me\n");
      expect(
        execFileSync("git", ["status", "--porcelain"], { cwd: repositoryPath, encoding: "utf8" }),
      ).toBe("");

      const movedToCheckout = await internals.threadHandoffRuntime.start(
        {
          operationId: "handoff-to-checkout",
          threadId,
          destinationHostId: null,
          followUpPrompt: null,
        },
        internals.buildThreadExecutionLocationEffects(),
      );
      const checkoutThread = await projectWorkspace.getThread(threadId);
      expect(movedToCheckout.phase).toBe("completed");
      expect(checkoutThread).toMatchObject({
        threadId,
        cwd: repositoryPath,
        managedWorktreePath: null,
      });
      expect(runtimeCwd).toBe(repositoryPath);
      expect(fs.readFileSync(path.join(repositoryPath, "README.md"), "utf8")).toBe(
        "# changed during handoff\n",
      );
      expect(fs.readFileSync(path.join(repositoryPath, "untracked.txt"), "utf8")).toBe(
        "preserve me\n",
      );
      expect(resumeRequests).toHaveLength(2);
      expect(resumeRequests.every((request) => request.threadId === threadId)).toBe(true);
    } finally {
      await service.shutdown();
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("dynamic same-directory fork returns the exact environment, source, child, and continuation payload", async () => {
    const sourceThreadId = "thr_dynamic_fork_source";
    const childThreadId = "thr_dynamic_fork_child";
    const cwd = "/workspace/dynamic-fork";
    const transferEvents: string[] = [];
    const service = createService({
      forkSidePanelTransferLifecycle: makeRecordingForkSidePanelTransferLifecycle(transferEvents),
    });
    const sourceDetail = {
      ...makeThreadDetail(sourceThreadId),
      projectId: null,
      cwd,
      threadName: "Dynamic fork source",
    };
    const childDetail = {
      ...makeThreadDetail(childThreadId),
      projectId: null,
      cwd,
      threadName: "Dynamic fork source",
    };
    const forkResponse = makeCanonicalForkResponse({
      threadId: childThreadId,
      cwd,
      turns: [makeCanonicalHydrationTurn("turn_dynamic_fork")],
    });
    const requests: Array<{ method: string; params: unknown }> = [];
    const serviceInternals = service as unknown as {
      handleDynamicToolCall: (params: {
        threadId: string;
        turnId: string;
        callId: string;
        namespace: string;
        tool: string;
        arguments: Record<string, unknown>;
      }) => Promise<{ contentItems: Array<{ type: string; text?: string }>; success: boolean }>;
      resolveDynamicThreadDetail: () => Promise<CodexThreadDetail>;
      parseThreadRef: () => Record<string, unknown>;
      upsertLinkFromThread: () => null;
      materializeThreadDetailFromThreadPayload: () => {
        detail: CodexThreadDetail;
        summary: null;
      };
      buildThreadDetailFromRead: () => CodexThreadDetail;
      buildThreadDetailFromCanonicalState: (
        state: CodexCanonicalConversationState,
      ) => CodexThreadDetail;
      persistThreadDetailSummary: () => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/fork") return forkResponse;
      if (method === "thread/read") return { thread: { ...forkResponse.thread, turns: [] } };
      if (method === "thread/resume") return makeCanonicalForkResumeResponse(forkResponse);
      if (method === "thread/goal/get") return { goal: null };
      throw new Error(`Unexpected client request: ${method}`);
    };
    serviceInternals.resolveDynamicThreadDetail = async () => sourceDetail;
    serviceInternals.parseThreadRef = () => ({
      projectId: null,
      cwd,
      projectlessWorkspaceBrowserRoot: null,
    });
    serviceInternals.upsertLinkFromThread = () => null;
    serviceInternals.materializeThreadDetailFromThreadPayload = () => ({
      detail: childDetail,
      summary: null,
    });
    serviceInternals.buildThreadDetailFromRead = () => childDetail;
    serviceInternals.buildThreadDetailFromCanonicalState = () => childDetail;
    serviceInternals.persistThreadDetailSummary = () => {};

    try {
      const response = await serviceInternals.handleDynamicToolCall({
        threadId: sourceThreadId,
        turnId: "turn_dynamic_parent",
        callId: "call_dynamic_fork",
        namespace: "codex_app",
        tool: "fork_thread",
        arguments: { environment: { type: "same-directory" } },
      });
      const output = JSON.parse(response.contentItems[0]?.text ?? "null") as Record<
        string,
        unknown
      >;
      const forkParams = requests[0]?.params as Record<string, unknown>;

      expect(response.success).toBe(true);
      expect(JSON.stringify(output.environment)).toBe(JSON.stringify({ type: "same-directory" }));
      expect(output.sourceThreadId).toBe(sourceThreadId);
      expect(output.threadId).toBe(childThreadId);
      expect(String(output.continuation)).toBe(
        "The fork contains completed history only. If the source thread was running, the active turn and unfinished response are not in the child. Send a follow-up message to threadId only if the task requires work to continue there.",
      );
      expect(forkParams.path).toBe(null);
      expect(forkParams.threadSource).toBe("subagent");
      expect(
        getCanonicalConversationState(service, childThreadId)?.turns.at(-1)?.items.at(-1)?.type,
      ).toBe("forkedFromConversation");
      expect(transferEvents.join(",")).toBe(`direct:${sourceThreadId}:${childThreadId}`);
    } finally {
      await service.shutdown();
    }
  });

  test("dynamic worktree fork creates a real pending fork request instead of a title reservation", async () => {
    const sourceThreadId = "thr_dynamic_pending_fork_source";
    const transferEvents: string[] = [];
    const transferLifecycle = makeRecordingForkSidePanelTransferLifecycle(transferEvents);
    const service = createService({
      forkSidePanelTransferLifecycle: transferLifecycle,
    });
    const captured: CodexPendingWorktreeRequest[] = [];
    const pendingRuntime = Reflect.get(service as object, "pendingWorktreeRuntime") as {
      create: (request: CodexPendingWorktreeRequest) => void;
    };
    pendingRuntime.create = (request) => {
      captured.push(request);
      transferEvents.push(`create:${request.id}`);
    };
    const serviceInternals = service as unknown as {
      handleDynamicToolCall: (params: {
        threadId: string;
        turnId: string;
        callId: string;
        namespace: string;
        tool: string;
        arguments: Record<string, unknown>;
      }) => Promise<{ contentItems: Array<{ text?: string }>; success: boolean }>;
      resolveDynamicThreadDetail: () => Promise<CodexThreadDetail>;
      parseThreadRef: () => { projectId: string; cwd: string };
      maybeResolveProjectRuntimeContext: () => Promise<{
        workspaceRoots: string[];
        primaryWorkspaceRoot: string;
      }>;
      readThreadWritableRoots: () => Promise<string[]>;
    };
    serviceInternals.resolveDynamicThreadDetail = async () => ({
      ...makeThreadDetail(sourceThreadId),
      projectId: "project-dynamic-pending-fork",
      cwd: "/workspace/dynamic-pending-fork",
      threadName: "Dynamic pending fork source",
      latestCollaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-pending-fork",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      },
    });
    serviceInternals.parseThreadRef = () => ({
      projectId: "project-dynamic-pending-fork",
      cwd: "/workspace/dynamic-pending-fork",
    });
    serviceInternals.maybeResolveProjectRuntimeContext = async () => ({
      workspaceRoots: ["/workspace/dynamic-pending-fork", "/workspace/shared"],
      primaryWorkspaceRoot: "/workspace/dynamic-pending-fork",
    });
    serviceInternals.readThreadWritableRoots = async () => [
      "/workspace/dynamic-pending-fork",
      "/scratch/custom-root",
    ];

    try {
      const response = await serviceInternals.handleDynamicToolCall({
        threadId: sourceThreadId,
        turnId: "turn_dynamic_pending_fork",
        callId: "call_dynamic_pending_fork",
        namespace: "codex_app",
        tool: "fork_thread",
        arguments: { environment: { type: "worktree" } },
      });
      const output = JSON.parse(response.contentItems[0]?.text ?? "null") as {
        pendingWorktreeId?: string;
      };
      const pending = captured[0];

      expect(response.success).toBe(true);
      expect(output.pendingWorktreeId?.startsWith("local:") ?? false).toBe(true);
      expect(captured.length).toBe(1);
      expect(pending?.id).toBe(output.pendingWorktreeId);
      expect(pending?.launchMode).toBe("fork-conversation");
      if (pending?.launchMode !== "fork-conversation") {
        throw new Error("Expected a pending fork request");
      }
      expect(pending.clientThreadId.startsWith("client-new-thread:")).toBe(true);
      expect(pending.sourceConversationId).toBe(sourceThreadId);
      expect(pending.sourceWorkspaceRoots).toEqual([
        "/workspace/dynamic-pending-fork",
        "/workspace/shared",
        "/scratch/custom-root",
      ]);
      expect(pending.startingState?.type).toBe("working-tree");
      expect(pending.projectAssignment?.projectId).toBe("project-dynamic-pending-fork");
      expect(pending.sourceCollaborationMode?.settings.model).toBe("gpt-pending-fork");
      expect(pending.threadSource).toBe("subagent");
      expect(transferEvents.join(",")).toBe(
        [
          `create:${pending.id}`,
          `capture:${pending.id}:${sourceThreadId}:/workspace/dynamic-pending-fork`,
        ].join(","),
      );

      transferLifecycle.failCapture();
      const failedResponse = await serviceInternals.handleDynamicToolCall({
        threadId: sourceThreadId,
        turnId: "turn_dynamic_pending_fork_failure",
        callId: "call_dynamic_pending_fork_failure",
        namespace: "codex_app",
        tool: "fork_thread",
        arguments: { environment: { type: "worktree" } },
      });
      expect(failedResponse.success).toBe(false);
      expect(captured.length).toBe(2);
      expect(transferEvents.at(-2)).toBe(`create:${captured[1]?.id}`);
      expect(transferEvents.at(-1)).toBe("capture-failed");
    } finally {
      await service.shutdown();
    }
  });

  test("dynamic create snapshots keep raw direct config and profile-expanded pending config", async () => {
    const service = createService();
    const requests: Array<{ method: string; params: unknown }> = [];
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    client.start = async () => undefined;
    client.request = async (method, params) => {
      requests.push({ method, params });
      if (method === "config/read") {
        return {
          config: {
            profile: "delegated",
            approval_policy: "on-request",
            approvals_reviewer: "user",
            sandbox_mode: "workspace-write",
            model: "base-model",
            profiles: {
              delegated: {
                model: "profile-model",
                approval_policy: "never",
              },
            },
          },
          origins: {},
          layers: [],
        };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };
    const serviceInternals = service as unknown as {
      readDynamicCreateDestinationSnapshot: (target: {
        projectId: string;
        cwd: string;
        workspaceRoots: readonly string[];
        workspaceKind: "project";
        projectlessOutputDirectory: null;
        projectlessWorkspaceBrowserRoot: null;
        launchMode: "direct";
      }) => Promise<{
        rawConfig: Record<string, unknown>;
        expandedConfig: Record<string, unknown>;
      }>;
    };

    try {
      const snapshot = await serviceInternals.readDynamicCreateDestinationSnapshot({
        projectId: "project-destination-permissions",
        cwd: "/tmp/destination-permissions",
        workspaceRoots: ["/tmp/destination-permissions"],
        workspaceKind: "project",
        projectlessOutputDirectory: null,
        projectlessWorkspaceBrowserRoot: null,
        launchMode: "direct",
      });

      const configRead = requests.find((request) => request.method === "config/read");
      expect(JSON.stringify(configRead?.params)).toBe(
        JSON.stringify({
          includeLayers: false,
          cwd: "/tmp/destination-permissions",
        }),
      );
      expect(snapshot.rawConfig.model).toBe("base-model");
      expect(snapshot.rawConfig.approval_policy).toBe("on-request");
      expect(snapshot.expandedConfig.model).toBe("profile-model");
      expect(snapshot.expandedConfig.approval_policy).toBe("never");
      expect(requests.some((request) => request.method === "configRequirements/read")).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("dynamic direct permissions use retained source mode or the owner host mode, never config requirements", async () => {
    const service = createService();
    const sourceThreadId = "thread-dynamic-permission-source";
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        detail: { cwd: string | null } | null;
        canonicalState: {
          sidecar: {
            hydrationContext: {
              cwd: string;
              currentPermissions: {
                activePermissionProfile: { id: string; extends: null } | null;
                runtimeWorkspaceRoots: string[];
                approvalPolicy: "on-request" | "never";
                approvalsReviewer: "user";
                sandboxPolicy:
                  | { type: "dangerFullAccess" }
                  | {
                      type: "workspaceWrite";
                      writableRoots: string[];
                      excludeSlashTmp: false;
                      excludeTmpdirEnvVar: false;
                      networkAccess: boolean;
                    };
              };
            };
          };
        } | null;
      };
      resolveDynamicCreatePermissions: (
        sourceThreadId: string,
        target: Record<string, unknown>,
        snapshot: Record<string, unknown>,
        hostMode: "read-only" | "auto" | "full-access" | "custom",
      ) => Promise<{
        mode: string;
        context: {
          activePermissionProfile: { id: string } | null;
          sandboxPolicy: { type: string };
        };
      }>;
    };
    const record = serviceInternals.getConversationRecord(sourceThreadId);
    record.detail = { cwd: "/source" };
    record.canonicalState = {
      sidecar: {
        hydrationContext: {
          cwd: "/source",
          currentPermissions: {
            activePermissionProfile: { id: "source-custom", extends: null },
            runtimeWorkspaceRoots: ["/source"],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: ["/source"],
              excludeSlashTmp: false,
              excludeTmpdirEnvVar: false,
              networkAccess: true,
            },
          },
        },
      },
    };
    const target = {
      projectId: "project-dynamic-permission-target",
      cwd: "/destination",
      workspaceRoots: ["/destination"],
      workspaceKind: "project",
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
      launchMode: "direct",
    };
    const snapshot = {
      rawConfig: {
        sandbox_mode: "danger-full-access",
        approval_policy: "never",
      },
      expandedConfig: {
        sandbox_mode: "workspace-write",
        approval_policy: "on-request",
      },
    };

    try {
      const sourceDiscarded = await serviceInternals.resolveDynamicCreatePermissions(
        sourceThreadId,
        target,
        snapshot,
        "read-only",
      );
      expect(sourceDiscarded.mode).toBe("read-only");
      expect(sourceDiscarded.context.activePermissionProfile?.id ?? null).toBe(":read-only");
      expect(sourceDiscarded.context.sandboxPolicy.type).toBe("readOnly");

      record.detail = { cwd: "/destination" };
      record.canonicalState.sidecar.hydrationContext.cwd = "/destination";
      record.canonicalState.sidecar.hydrationContext.currentPermissions = {
        activePermissionProfile: { id: ":danger-full-access", extends: null },
        runtimeWorkspaceRoots: ["/destination"],
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
      const sourceRetained = await serviceInternals.resolveDynamicCreatePermissions(
        sourceThreadId,
        target,
        snapshot,
        "auto",
      );
      expect(sourceRetained.mode).toBe("full-access");
      expect(sourceRetained.context.activePermissionProfile?.id ?? null).toBe(
        ":danger-full-access",
      );
    } finally {
      await service.shutdown();
    }
  });

  test("admits explicit file and added sidecars with an empty pending prompt placeholder", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      preparePromptForTurn: (
        prompt: string,
        promptInput: CodexPromptInput,
        options: { readonly allowEmptyTextPlaceholder: boolean },
      ) => Promise<{
        inputItems: Array<{ type: string; text?: string }>;
        pendingInputItems: Array<{ type: string; text?: string }>;
        fileAttachments: Array<{ label: string; path: string; fsPath: string }>;
        addedFiles: Array<{ label: string; path: string; fsPath: string }>;
        pastedTextAttachments: Array<{ text: string }>;
      }>;
    };

    try {
      const prepared = await serviceInternals.preparePromptForTurn(
        "",
        {
          text: "",
          fileAttachments: [
            {
              label: "source.ts",
              path: "src/source.ts",
              fsPath: "/repo/src/source.ts",
            },
          ],
          addedFiles: [
            {
              label: "generated.ts",
              path: "src/generated.ts",
              fsPath: "/repo/src/generated.ts",
            },
          ],
          textAttachments: [{ text: "  \n\t  " }],
        },
        { allowEmptyTextPlaceholder: true },
      );

      expect(JSON.stringify(prepared.inputItems)).toBe(
        JSON.stringify([
          { type: "text", text: "", text_elements: [] },
          { type: "mention", name: "source.ts", path: "src/source.ts" },
          { type: "mention", name: "generated.ts", path: "src/generated.ts" },
        ]),
      );
      expect(JSON.stringify(prepared.pendingInputItems)).toBe(
        '[{"type":"text","text":"","text_elements":[]}]',
      );
      expect(JSON.stringify(prepared.fileAttachments)).toBe(
        '[{"label":"source.ts","path":"src/source.ts","fsPath":"/repo/src/source.ts"}]',
      );
      expect(JSON.stringify(prepared.addedFiles)).toBe(
        '[{"label":"generated.ts","path":"src/generated.ts","fsPath":"/repo/src/generated.ts"}]',
      );
      expect(prepared.pastedTextAttachments[0]?.text).toBe("  \n\t  ");
    } finally {
      await service.shutdown();
    }
  });

  test("preserves raw structured prompt bytes before pending context formatting", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      preparePromptForTurn: (
        prompt: string,
        promptInput: CodexPromptInput,
      ) => Promise<{
        promptText: string;
        pendingInputItems: Array<{ type: string; text?: string }>;
      }>;
    };
    const rawPrompt = "  leading\ntrailing  \n";

    try {
      const prepared = await serviceInternals.preparePromptForTurn("ignored", {
        text: rawPrompt,
      });

      expect(prepared.promptText).toBe(rawPrompt);
      expect(prepared.pendingInputItems[0]?.text).toBe(rawPrompt);
    } finally {
      await service.shutdown();
    }
  });

  test("materializes an owned pasted-text source exactly at the main-process turn boundary", async () => {
    const attachmentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-pasted-text-turn-"));
    const service = createService({
      resolveThreadGoalAttachmentsRoot: () => attachmentRoot,
    });
    const serviceInternals = service as unknown as {
      getPastedTextAttachmentManager: () => Promise<PastedTextAttachmentManager>;
      preparePromptForTurn: (
        prompt: string,
        promptInput: CodexPromptInput,
      ) => Promise<{
        inputItems: Array<{ type: string; text?: string }>;
        pastedTextAttachments: CodexPromptInput["textAttachments"];
      }>;
    };
    const pastedText = "  leading\ntrailing  \n";

    try {
      const attachment = await (
        await serviceInternals.getPastedTextAttachmentManager()
      ).createRawSource({ text: pastedText });
      const prepared = await serviceInternals.preparePromptForTurn("Prompt", {
        text: "Prompt",
        textAttachments: [attachment],
      });

      expect(prepared.inputItems.map((item) => item.text)).toEqual(["Prompt", pastedText]);
      expect(prepared.pastedTextAttachments).toEqual([attachment]);
    } finally {
      await service.shutdown();
      fs.rmSync(attachmentRoot, { recursive: true, force: true });
    }
  });

  test("queues the exact dynamic pending-worktree contract and returns only its client id", async () => {
    const service = createService();
    const captured: CodexPendingStartConversationRequest[] = [];
    const pendingRuntime = Reflect.get(service as object, "pendingWorktreeRuntime") as {
      create: (request: CodexPendingStartConversationRequest) => void;
    };
    pendingRuntime.create = (request) => {
      captured.push(request);
    };
    const serviceInternals = service as unknown as {
      enqueueDynamicPendingWorktree: (input: Record<string, unknown>) => {
        clientThreadId: string;
      };
      launchPendingWorktreeConversation: (
        entry: CodexPendingStartConversationRequest & {
          createdAt: number;
          attempt: number;
          phase: "worktree-ready";
          labelEdited: boolean;
          worktreeOutputText: string;
          setupOutputText: string;
          errorMessage: null;
          worktreeWorkspaceRoot: string;
          worktreeGitRoot: string;
          needsAttention: boolean;
          isPinned: boolean;
          pinnedBeforeThreadId: string | null;
        },
        workspaceRoot: string,
        context: {
          readonly includeWorktreeInit: boolean;
          readonly onThreadCreated: (threadId: string) => void;
        },
      ) => Promise<{ threadId: string }>;
      startDynamicCreatedConversation: (
        input: Record<string, unknown>,
        options?: { readonly persistClientThreadIdentity?: boolean },
      ) => Promise<{ threadId: string }>;
      persistClientThreadIdentity: (threadId: string, clientThreadId: string) => void;
      threadCatalog: {
        setPinned: (
          threadId: string,
          pinned: boolean,
          beforeThreadId?: string | null,
        ) => Promise<unknown>;
      };
    };
    let launchedInput: Record<string, unknown> | null = null;
    let pinnedCall: {
      threadId: string;
      pinned: boolean;
      beforeThreadId: string | null | undefined;
    } | null = null;
    let startOptions: { readonly persistClientThreadIdentity?: boolean } | undefined;
    const realizationEvents: string[] = [];
    serviceInternals.startDynamicCreatedConversation = async (input, options) => {
      launchedInput = input;
      startOptions = options;
      realizationEvents.push("launch");
      return { threadId: "thread-pending-contract" };
    };
    serviceInternals.persistClientThreadIdentity = (threadId, clientThreadId) => {
      realizationEvents.push(`map:${threadId}:${clientThreadId}`);
    };
    serviceInternals.threadCatalog.setPinned = async (threadId, pinned, beforeThreadId) => {
      realizationEvents.push("metadata");
      pinnedCall = { threadId, pinned, beforeThreadId };
      return {};
    };
    const prompt = `${"Build delegated work ".repeat(6)}\nwith exact queue state`;

    try {
      const result = serviceInternals.enqueueDynamicPendingWorktree({
        createInput: {
          prompt,
          target: {
            type: "project",
            projectId: "project-pending-contract",
            environment: { type: "worktree" },
          },
        },
        destinationSnapshot: {
          rawConfig: {
            model: "base-model",
            service_tier: null,
          },
          expandedConfig: {
            model: "profile-model",
            service_tier: "fast",
          },
        },
        modelProjection: {
          collaborationMode: {
            mode: "default",
            settings: {
              model: "gpt-pending",
              reasoning_effort: "high",
              developer_instructions: null,
            },
          },
          configOverrides: null,
        },
        permissionSelection: {
          mode: "auto",
          context: {
            activePermissionProfile: { id: ":workspace", extends: null },
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: ["/repo"],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
          },
          launchParams: {},
          turnParams: {},
        },
        serviceName: "source-service",
        serviceTier: "fast",
        sourceThreadId: "thread-source-pending",
        startingState: { type: "branch", branchName: "main" },
        target: {
          launchMode: "worktree",
          projectId: "project-pending-contract",
          cwd: "/repo",
          workspaceRoots: ["/repo", "/shared-one", "/shared-two"],
          workspaceKind: "project",
          projectlessOutputDirectory: null,
          projectlessWorkspaceBrowserRoot: null,
        },
      });
      const request = captured[0];
      const firstInput = request?.startConversationParamsInput.input[0];

      expect(captured.length).toBe(1);
      expect(result.clientThreadId.startsWith("client-new-thread:")).toBe(true);
      expect(request?.clientThreadId).toBe(result.clientThreadId);
      expect(request?.id.startsWith("local:")).toBe(true);
      expect(request?.id === result.clientThreadId).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(request ?? {}, "initialThreadTitle")).toBe(true);
      expect(request?.initialThreadTitle).toBe(undefined);
      for (const key of [
        "browserTransferSourceBrowserTabId",
        "browserTransferSourceBrowserTabIds",
        "browserTransferSourceConversationId",
      ]) {
        expect(Object.prototype.hasOwnProperty.call(request ?? {}, key)).toBe(false);
        expect((request as unknown as Record<string, unknown> | undefined)?.[key]).toBe(undefined);
      }
      expect((request?.label.length ?? 0) <= 80).toBe(true);
      expect(request?.label.endsWith("…")).toBe(true);
      expect(request?.startingState?.type).toBe("branch");
      expect(
        request?.startingState?.type === "branch" ? request.startingState.branchName : null,
      ).toBe("main");
      expect(firstInput?.type).toBe("text");
      expect(
        firstInput?.type === "text"
          ? firstInput.text.includes("<source_thread_id>thread-source-pending</source_thread_id>")
          : false,
      ).toBe(true);
      expect(request?.startConversationParamsInput.serviceName).toBe("source-service");
      expect(request?.startConversationParamsInput.serviceTier).toBe("fast");
      expect(request?.startConversationParamsInput.config.model).toBe("profile-model");
      expect(
        Object.prototype.hasOwnProperty.call(
          request?.startConversationParamsInput ?? {},
          "permissionProfileId",
        ),
      ).toBe(true);
      expect(request?.startConversationParamsInput.permissionProfileId).toBe(undefined);
      expect(
        Object.prototype.hasOwnProperty.call(
          request?.startConversationParamsInput ?? {},
          "serviceName",
        ),
      ).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(
          request?.startConversationParamsInput.projectAssignment ?? {},
          "cwd",
        ),
      ).toBe(false);

      if (!request) throw new Error("Pending request was not captured");
      let mappedThreadId = "";
      const launched = await serviceInternals.launchPendingWorktreeConversation(
        {
          ...request,
          startConversationParamsInput: {
            ...request.startConversationParamsInput,
            permissionProfileId: "team-profile",
            configOverrides: { frozen_override_marker: "override" },
            memoryPreferences: { generateMemories: true, useMemories: false },
            mode: "work",
            threadStartKind: "composer",
            baseInstructions: "Frozen base instructions",
            additionalDeveloperInstructions: "Frozen additional instructions",
          },
          createdAt: 1,
          attempt: 1,
          phase: "worktree-ready",
          labelEdited: false,
          worktreeOutputText: "Worktree created\n",
          setupOutputText: "",
          errorMessage: null,
          worktreeWorkspaceRoot: "/worktree/repo",
          worktreeGitRoot: "/missing/worktree-git-root",
          needsAttention: false,
          isPinned: true,
          pinnedBeforeThreadId: "thread-existing-anchor",
        },
        "/worktree/repo",
        {
          includeWorktreeInit: true,
          onThreadCreated: (threadId) => {
            realizationEvents.push("callback");
            mappedThreadId = threadId;
          },
        },
      );
      const capturedLaunch = launchedInput as Record<string, unknown> | null;
      const launchedTarget = capturedLaunch?.target as Record<string, unknown> | undefined;
      const launchedPermissions = capturedLaunch?.permissionSelection as
        | {
            context?: {
              activePermissionProfile?: { id?: string } | null;
              runtimeWorkspaceRoots?: readonly string[];
              sandboxPolicy?: { type?: string; writableRoots?: readonly string[] };
            };
          }
        | undefined;

      expect(launched.threadId).toBe("thread-pending-contract");
      expect(mappedThreadId).toBe("thread-pending-contract");
      expect(launchedTarget?.cwd).toBe("/worktree/repo");
      expect(launchedTarget?.workspaceRoots).toEqual([
        "/worktree/repo",
        "/shared-one",
        "/shared-two",
      ]);
      expect(capturedLaunch?.managedWorktreePath).toBe("/missing/worktree-git-root");
      expect(capturedLaunch?.clientThreadId).toBe(request.clientThreadId);
      expect(startOptions?.persistClientThreadIdentity).toBe(false);
      expect(realizationEvents.join(",")).toBe(
        `launch,map:thread-pending-contract:${request.clientThreadId},callback,metadata`,
      );
      expect(Object.prototype.hasOwnProperty.call(capturedLaunch ?? {}, "initialTitle")).toBe(
        false,
      );
      expect(capturedLaunch?.serviceName).toBe("source-service");
      expect(
        (capturedLaunch?.memoryPreferences as { generateMemories?: boolean } | undefined)
          ?.generateMemories,
      ).toBe(true);
      expect(
        (capturedLaunch?.memoryPreferences as { useMemories?: boolean } | undefined)?.useMemories,
      ).toBe(false);
      expect(capturedLaunch?.mode).toBe("work");
      expect(capturedLaunch?.threadStartKind).toBe("composer");
      expect(capturedLaunch?.baseInstructions).toBe("Frozen base instructions");
      expect(capturedLaunch?.additionalDeveloperInstructions).toBe(
        "Frozen additional instructions",
      );
      expect(JSON.stringify(capturedLaunch?.firstTurnInput)).toBe(
        JSON.stringify(request.startConversationParamsInput.input),
      );
      expect(launchedPermissions?.context?.runtimeWorkspaceRoots).toEqual([
        "/worktree/repo",
        "/shared-one",
        "/shared-two",
      ]);
      expect(launchedPermissions?.context?.activePermissionProfile?.id ?? null).toBe(
        "team-profile",
      );
      expect(launchedPermissions?.context?.sandboxPolicy?.writableRoots).toEqual([
        "/worktree/repo",
        "/shared-one",
        "/shared-two",
      ]);
      expect((capturedLaunch?.worktreeInit as { id?: string } | undefined)?.id).toBe(
        `${request.id}:1`,
      );
      expect(JSON.stringify(pinnedCall)).toBe(
        JSON.stringify({
          threadId: "thread-pending-contract",
          pinned: true,
          beforeThreadId: "thread-existing-anchor",
        }),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("promotes a Work-locally fork snapshot before durable client mapping", async () => {
    const events: string[] = [];
    const service = createService({
      forkSidePanelTransferLifecycle: makeRecordingForkSidePanelTransferLifecycle(events),
    });
    const entry = {
      id: "local:work-locally-transfer",
      hostId: "local",
      label: "Work locally transfer",
      sourceWorkspaceRoot: "/repo/source",
      sourceWorkspaceRoots: ["/repo/source"],
      startingState: { type: "working-tree" as const },
      localEnvironmentConfigPath: null,
      prompt: "Continue locally",
      launchMode: "fork-conversation" as const,
      clientThreadId: "client-new-thread:work-locally-transfer",
      startConversationParamsInput: null,
      projectAssignment: null,
      sourceConversationId: "thread-source-work-locally-transfer",
      sourceCollaborationMode: null,
      targetTurnId: null,
      threadSource: "user" as const,
      createdAt: 1,
      attempt: 1,
      phase: "worktree-ready" as const,
      labelEdited: false,
      worktreeOutputText: "",
      setupOutputText: "",
      errorMessage: null,
      worktreeWorkspaceRoot: "/repo/worktree",
      worktreeGitRoot: "/repo/worktree",
      needsAttention: false,
      isPinned: false,
      pinnedBeforeThreadId: null,
    } satisfies CodexPendingWorktreeEntry;
    const internals = service as unknown as {
      launchPendingWorktreeConversation: (
        pendingEntry: CodexPendingWorktreeEntry,
        workspaceRoot: string,
        context: {
          readonly includeWorktreeInit: boolean;
          readonly onThreadCreated: (threadId: string) => void;
        },
      ) => Promise<{ readonly threadId: string }>;
      launchPendingWorktreeFork: () => Promise<{ readonly threadId: string }>;
      persistClientThreadIdentity: (threadId: string, clientThreadId: string) => void;
    };
    internals.launchPendingWorktreeFork = async () => {
      events.push("launch");
      return { threadId: "thread-target-work-locally-transfer" };
    };
    internals.persistClientThreadIdentity = (threadId, clientThreadId) => {
      events.push(`map:${threadId}:${clientThreadId}`);
    };

    try {
      const result = await internals.launchPendingWorktreeConversation(
        entry,
        entry.sourceWorkspaceRoot,
        {
          includeWorktreeInit: false,
          onThreadCreated: (threadId) => {
            events.push(`callback:${threadId}`);
          },
        },
      );

      expect(result.threadId).toBe("thread-target-work-locally-transfer");
      expect(events.join(",")).toBe(
        [
          "launch",
          "promote:local:work-locally-transfer:thread-target-work-locally-transfer:/repo/source",
          "map:thread-target-work-locally-transfer:client-new-thread:work-locally-transfer",
          "callback:thread-target-work-locally-transfer",
        ].join(","),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("promotes a normal pending fork after accepted mapping and before metadata", async () => {
    const events: string[] = [];
    const service = createService({
      forkSidePanelTransferLifecycle: makeRecordingForkSidePanelTransferLifecycle(events),
    });
    const runtime = Reflect.get(service as object, "pendingWorktreeRuntime") as {
      readonly dependencies: {
        createWorktree: () => Promise<{
          readonly worktreeGitRoot: string;
          readonly worktreeWorkspaceRoot: string;
        }>;
      };
      resolveThread: (clientThreadId: string) => {
        readonly state: "waiting" | "failed" | "succeeded";
        readonly threadId?: string;
      } | null;
    };
    const internals = service as unknown as {
      createPendingWorktree: (input: CodexPendingWorktreeCreateInput) => {
        readonly pendingWorktreeId: string;
        readonly clientThreadId: string | null;
      };
      launchPendingWorktreeFork: () => Promise<{ readonly threadId: string }>;
      persistClientThreadIdentity: (threadId: string, clientThreadId: string) => void;
      applyPendingWorktreeConversationMetadata: () => Promise<void>;
    };
    runtime.dependencies.createWorktree = async () => ({
      worktreeGitRoot: "/repo/worktree",
      worktreeWorkspaceRoot: "/repo/worktree",
    });
    internals.launchPendingWorktreeFork = async () => {
      events.push("launch");
      return { threadId: "thread-normal-transfer" };
    };
    internals.persistClientThreadIdentity = (threadId, clientThreadId) => {
      events.push(`map:${threadId}:${clientThreadId}`);
    };
    internals.applyPendingWorktreeConversationMetadata = async () => {
      events.push("metadata");
    };

    try {
      const created = internals.createPendingWorktree({
        hostId: "local",
        label: "Normal transfer",
        sourceWorkspaceRoot: "/repo/source",
        sourceWorkspaceRoots: ["/repo/source"],
        startingState: { type: "working-tree" },
        localEnvironmentConfigPath: null,
        launchMode: "fork-conversation",
        projectAssignment: null,
        prompt: "Continue in worktree",
        startConversationParamsInput: null,
        sourceConversationId: "thread-source-normal-transfer",
        sourceCollaborationMode: null,
        targetTurnId: null,
        threadSource: "user",
      });
      const clientThreadId = created.clientThreadId;
      if (!clientThreadId) throw new Error("Expected a pending client thread id");
      await waitForCondition(() => service.listPendingWorktrees().length === 0, 2_000);

      expect(events.join(",")).toBe(
        [
          "launch",
          `map:thread-normal-transfer:${clientThreadId}`,
          `promote:${created.pendingWorktreeId}:thread-normal-transfer:/repo/worktree`,
          "metadata",
        ].join(","),
      );
      expect(runtime.resolveThread(clientThreadId)).toBe(null);
    } finally {
      await service.shutdown();
    }
  });

  test("routes dynamic tool-call requests through renderer owner from bundle 51920-52390", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      respondToDynamicToolCall: (
        requestId: string | number,
      ) => Promise<{ success: boolean } | null>;
      setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
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
    serviceInternals.setRendererConversationOwner("thr_dynamic_tool", "owner-dynamic");

    try {
      const requestPromise = serviceInternals.handleServerRequest({
        id: 74,
        method: "item/tool/call",
        params: {
          threadId: "thr_dynamic_tool",
          turnId: "turn_dynamic_tool",
          callId: "call_dynamic_tool",
          namespace: "codex_app",
          tool: "unsupported_test_tool",
          arguments: {},
        },
      });

      await Promise.resolve();
      expect(String(hostMessages.length)).toBe("0");
      expect(String(ownerMessages.length)).toBe("1");
      expect(ownerMessages[0]?.targetClientId).toBe("owner-dynamic");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerRequest");
      if (ownerMessages[0]?.message.type === "threadOwnerRequest") {
        expect(ownerMessages[0].message.request.id).toBe(74);
        expect(ownerMessages[0].message.request.method).toBe("item/tool/call");
        expect(ownerMessages[0].message.sequence).toBe(1);
      }

      const ownerResponse = await serviceInternals.respondToDynamicToolCall(74);
      const serverResponse = (await requestPromise) as { success: boolean };
      expect(ownerResponse?.success).toBe(false);
      expect(serverResponse.success).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("executes Project-scope Nodex calls in main without detouring through the state owner", async () => {
    const service = createService();
    const handleDynamicToolCall = vi.fn(async () => ({
      success: true,
      contentItems: [],
    }));
    const projectAuthority = {
      threadId: "thread-direct-project",
      turnId: "turn-direct-project",
      rootThreadId: "thread-direct-project",
      actorProjectId: "project-direct",
      libraryId: "library-direct",
      storeEpoch: "store-direct",
      scope: "project" as const,
      source: "project_turn" as const,
    };
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      handleDynamicToolCall: typeof handleDynamicToolCall;
      captureNodexAgentTurnAuthority: () => typeof projectAuthority;
      on: (event: "rendererOwnerHostMessage", listener: (message: unknown) => void) => void;
    };
    const ownerMessages: unknown[] = [];
    serviceInternals.handleDynamicToolCall = handleDynamicToolCall;
    serviceInternals.captureNodexAgentTurnAuthority = () => projectAuthority;
    serviceInternals.on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    service.setRendererConversationOwner("thread-direct-project", "renderer-state-owner");

    try {
      await expect(
        serviceInternals.handleServerRequest({
          id: "request-direct-project",
          method: "item/tool/call",
          params: {
            threadId: "thread-direct-project",
            turnId: "turn-direct-project",
            callId: "call-direct-project",
            namespace: "nodex_app",
            tool: "get_context",
            arguments: {},
          },
        }),
      ).resolves.toMatchObject({ success: true });
      expect(handleDynamicToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-direct-project",
          turnId: "turn-direct-project",
        }),
        {},
        projectAuthority,
      );
      expect(ownerMessages).toEqual([]);
    } finally {
      await service.shutdown();
    }
  });

  test("does not dispatch or answer ordinary dynamic tool calls without a thread id", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getMaybeConversationRecord: (threadId: string) => unknown;
    };

    try {
      const result = await serviceInternals.handleServerRequest({
        id: "dynamic-empty-thread",
        method: "item/tool/call",
        params: {
          threadId: "",
          turnId: "turn-dynamic-empty-thread",
          callId: "call-dynamic-empty-thread",
          namespace: "codex_app",
          tool: "setup_codex_step",
          arguments: { step: "complete" },
        },
      });

      expect(result).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(serviceInternals.getMaybeConversationRecord("")).toBe(null);
    } finally {
      await service.shutdown();
    }
  });

  test("does not dispatch or answer ordinary dynamic tool calls for an archived conversation", async () => {
    const service = createService();
    const threadId = "thr-archived-dynamic-dispatch";
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getMaybeConversationRecord: (targetThreadId: string) => {
        detail: CodexThreadDetail | null;
        serverRequests: Array<{ id: string | number }>;
      } | null;
    };
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      archived: true,
    });

    try {
      const result = await serviceInternals.handleServerRequest({
        id: "archived-dynamic-dispatch",
        method: "item/tool/call",
        params: {
          threadId,
          turnId: "turn-archived-dynamic-dispatch",
          callId: "call-archived-dynamic-dispatch",
          namespace: "codex_app",
          tool: "setup_codex_step",
          arguments: { step: "complete" },
        },
      });

      expect(result).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(serviceInternals.getMaybeConversationRecord(threadId)?.detail?.archived).toBe(true);
      expect(serviceInternals.getMaybeConversationRecord(threadId)?.serverRequests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("keeps specialized dynamic calls with an empty thread id in the stored request lane", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number; method: string }>;
      };
      respondToSetupCodexStep: (
        conversationId: string,
        requestId: string | number,
        response: {
          step: "role";
          action: "submit" | "skip" | "dismiss";
          selectedRoles: readonly string[];
        },
      ) => Promise<boolean>;
    };
    const requestPromise = serviceInternals.handleServerRequest({
      id: "stored-dynamic-empty-thread",
      method: "item/tool/call",
      params: {
        threadId: "",
        turnId: "turn-stored-dynamic-empty-thread",
        callId: "call-stored-dynamic-empty-thread",
        namespace: "codex_app",
        tool: "setup_codex_step",
        arguments: { step: "role" },
      },
    });

    try {
      await Promise.resolve();
      expect(serviceInternals.getConversationRecord("").serverRequests.length).toBe(1);
      expect(
        await serviceInternals.respondToSetupCodexStep("", "stored-dynamic-empty-thread", {
          step: "role",
          action: "submit",
          selectedRoles: ["engineer"],
        }),
      ).toBe(true);
      expect(JSON.stringify(await requestPromise)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({ action: "submit", selectedRoles: ["engineer"] }),
            },
          ],
          success: true,
        }),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("withdraws every same-id specialized request and waiter for an empty thread id", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number; method: string }>;
      };
    };
    const request = (callId: string) =>
      serviceInternals.handleServerRequest({
        id: "withdraw-stored-empty-thread",
        method: "item/tool/call",
        params: {
          threadId: "",
          turnId: "turn-withdraw-stored-empty-thread",
          callId,
          namespace: "codex_app",
          tool: "setup_codex_step",
          arguments: { step: "role" },
        },
      });

    try {
      const firstPromise = request("call-withdraw-stored-empty-thread-1");
      const secondPromise = request("call-withdraw-stored-empty-thread-2");
      await Promise.resolve();
      expect(serviceInternals.getConversationRecord("").serverRequests.length).toBe(2);

      await serviceInternals.handleNotification({
        method: "serverRequest/resolved",
        params: {
          threadId: "",
          requestId: "withdraw-stored-empty-thread",
        },
      });

      expect(await firstPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(await secondPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(serviceInternals.getConversationRecord("").serverRequests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("responds once per dispatched dynamic occurrence without consuming same-id stored requests", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      respondToDynamicToolCall: (
        requestId: string | number,
        conversationId: string,
      ) => Promise<{
        contentItems: Array<{ type: string; text?: string }>;
        success: boolean;
      } | null>;
      respondToUserInput: (
        requestId: string | number,
        answers: Record<string, string[]>,
        conversationId: string,
      ) => Promise<boolean>;
      setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number; method: string }>;
      };
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    };
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    const threadId = "thr_dynamic_occurrence_identity";
    const turnId = "turn_dynamic_occurrence_identity";
    const requestId = 75;
    serviceInternals.on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    serviceInternals.setRendererConversationOwner(threadId, "owner-dynamic-occurrences");

    const request = (callId: string, tool: string, args: Record<string, unknown>) => ({
      id: requestId,
      method: "item/tool/call",
      params: {
        threadId,
        turnId,
        callId,
        namespace: "codex_app",
        tool,
        arguments: args,
      },
    });

    try {
      const onboardingPromise = serviceInternals.handleServerRequest(
        request("call-stored-onboarding", "request_onboarding_input", {
          questions: [
            {
              id: "first_task",
              header: "Start",
              question: "What should Codex do?",
              options: [
                { label: "Audit", description: "Inspect first" },
                { label: "Build", description: "Implement first" },
              ],
            },
          ],
        }),
      );
      const firstDispatchedPromise = serviceInternals.handleServerRequest(
        request("call-dispatched-first", "unsupported_occurrence_first", {}),
      );
      const secondDispatchedPromise = serviceInternals.handleServerRequest(
        request("call-dispatched-second", "unsupported_occurrence_second", {}),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(ownerMessages.length).toBe(3);
      expect(
        JSON.stringify(
          serviceInternals
            .getConversationRecord(threadId)
            .serverRequests.map((entry) => entry.method),
        ),
      ).toBe(JSON.stringify(["item/tool/call"]));

      const firstResponse = await serviceInternals.respondToDynamicToolCall(requestId, threadId);
      expect(firstResponse?.contentItems[0]?.text).toBe(
        "Unsupported dynamic tool: unsupported_occurrence_first",
      );
      expect(JSON.stringify(await firstDispatchedPromise)).toBe(JSON.stringify(firstResponse));

      const secondResponse = await serviceInternals.respondToDynamicToolCall(requestId, threadId);
      expect(secondResponse?.contentItems[0]?.text).toBe(
        "Unsupported dynamic tool: unsupported_occurrence_second",
      );
      expect(JSON.stringify(await secondDispatchedPromise)).toBe(JSON.stringify(secondResponse));
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(1);

      expect(
        await serviceInternals.respondToUserInput(requestId, { first_task: ["Audit"] }, threadId),
      ).toBe(true);
      expect(JSON.stringify(await onboardingPromise)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                answers: { first_task: { answers: ["Audit"] } },
              }),
            },
          ],
          success: true,
        }),
      );
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("appends duplicate request ids without overwriting waiters and keeps scalar id types distinct", async () => {
    {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: {
          id: string | number;
          method: string;
          params: unknown;
        }) => Promise<unknown>;
        getConversationRecord: (threadId: string) => {
          canonicalState: CodexCanonicalConversationState | null;
          serverRequests: Array<{ id: string | number }>;
        };
        respondToApproval: (
          requestId: string | number,
          response: CodexApprovalResponse,
        ) => Promise<boolean>;
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      };
      const events: CodexEvent[] = [];

      const projectId = "project-request-id-regression";
      serviceInternals.parseThreadRef = () => ({ projectId, cwd: null });
      installManualApprovalState(service, projectId);
      serviceInternals.on("event", (event) => {
        events.push(event);
      });

      try {
        const numericPromise = serviceInternals.handleServerRequest({
          id: 42,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_request_id",
            turnId: "turn_request_id",
            itemId: "item_request_id",
            reason: "Needs permissions",
          },
        });
        const duplicateNumericPromise = serviceInternals.handleServerRequest({
          id: 42,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_request_id",
            turnId: "turn_request_id",
            itemId: "item_request_id_duplicate",
            reason: "Needs the same numeric correlation token",
          },
        });
        const textualPromise = serviceInternals.handleServerRequest({
          id: "42",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_request_id",
            turnId: "turn_request_id",
            itemId: "item_request_id_text",
            reason: "Needs textual permissions",
          },
        });

        await Promise.resolve();
        const approvalItem = getRecordedItem(
          serviceInternals,
          "thr_request_id",
          "turn_request_id",
          "item_request_id",
        );
        expect(approvalItem?.approvalRequestId).toBe(undefined);

        const requestedEvent = events.find(
          (event): event is Extract<CodexEvent, { type: "approvalRequested" }> =>
            event.type === "approvalRequested",
        );
        expect(requestedEvent?.request.requestId).toBe(42);
        expect(
          JSON.stringify(
            serviceInternals
              .getConversationRecord("thr_request_id")
              .serverRequests.map((request) => request.id),
          ),
        ).toBe(JSON.stringify([42, 42, "42"]));
        expect(
          JSON.stringify(
            serviceInternals
              .getConversationRecord("thr_request_id")
              .canonicalState?.requests.map((request) => request.id),
          ),
        ).toBe(JSON.stringify([42, 42, "42"]));

        expect(
          await serviceInternals.respondToApproval(42, { kind: "command", decision: "decline" }),
        ).toBe(true);
        expect(JSON.stringify(await numericPromise)).toBe(JSON.stringify({ decision: "decline" }));
        expect(await duplicateNumericPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
        expect(
          JSON.stringify(
            serviceInternals
              .getConversationRecord("thr_request_id")
              .serverRequests.map((request) => request.id),
          ),
        ).toBe(JSON.stringify(["42"]));
        expect(
          JSON.stringify(
            serviceInternals
              .getConversationRecord("thr_request_id")
              .canonicalState?.requests.map((request) => request.id),
          ),
        ).toBe(JSON.stringify(["42"]));

        expect(
          await serviceInternals.respondToApproval("42", {
            kind: "command",
            decision: "decline",
          }),
        ).toBe(true);
        expect(JSON.stringify(await textualPromise)).toBe(JSON.stringify({ decision: "decline" }));
      } finally {
        await service.shutdown();
      }
    }
  });

  test("scopes same-id approval replies to the requested conversation", async () => {
    const service = createService();
    const projectId = "project-request-conversation-scope";
    const requestId = "shared-approval-id";
    const firstThreadId = "thr_request_scope_first";
    const secondThreadId = "thr_request_scope_second";
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number }>;
      };
      respondToApproval: (
        requestId: string | number,
        response: CodexApprovalResponse,
        conversationId?: string,
      ) => Promise<boolean>;
    };
    serviceInternals.parseThreadRef = () => ({ projectId, cwd: null });
    installManualApprovalState(service, projectId);
    for (const [threadId, turnId] of [
      [firstThreadId, "turn_request_scope_first"],
      [secondThreadId, "turn_request_scope_second"],
    ] as const) {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail(threadId),
        turns: [{ threadId, turnId, status: "inProgress", itemIds: [] }],
        transcript: [],
      });
    }

    try {
      const firstPromise = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: firstThreadId,
          turnId: "turn_request_scope_first",
          itemId: "command_request_scope_first",
          reason: "First conversation",
        },
      });
      const secondPromise = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: secondThreadId,
          turnId: "turn_request_scope_second",
          itemId: "command_request_scope_second",
          reason: "Second conversation",
        },
      });
      await Promise.resolve();

      expect(
        await serviceInternals.respondToApproval(
          requestId,
          { kind: "command", decision: "decline" },
          secondThreadId,
        ),
      ).toBe(true);
      expect(JSON.stringify(await secondPromise)).toBe(JSON.stringify({ decision: "decline" }));
      expect(serviceInternals.getConversationRecord(firstThreadId).serverRequests.length).toBe(1);
      expect(serviceInternals.getConversationRecord(secondThreadId).serverRequests.length).toBe(0);

      expect(
        await serviceInternals.respondToApproval(
          requestId,
          { kind: "command", decision: "decline" },
          firstThreadId,
        ),
      ).toBe(true);
      expect(JSON.stringify(await firstPromise)).toBe(JSON.stringify({ decision: "decline" }));
    } finally {
      await service.shutdown();
    }
  });

  test("blocks both approval routes when the first ordinary same-id request has the other kind", async () => {
    const service = createService();
    const projectId = "project-approval-route-collision";
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number; method: string }>;
      };
      requestConversationResume: (threadId: string) => Promise<CodexConversationSnapshot | null>;
      respondToApproval: (
        requestId: string | number,
        response: CodexApprovalResponse,
        conversationId?: string,
      ) => Promise<boolean>;
    };
    serviceInternals.parseThreadRef = () => ({ projectId, cwd: null });
    serviceInternals.requestConversationResume = async () => null;
    installManualApprovalState(service, projectId);

    const runCollision = async (input: {
      threadId: string;
      requestId: string;
      firstKind: CodexApprovalKind;
    }) => {
      const turnId = `turn-${input.requestId}`;
      const commandRequest = {
        id: input.requestId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: input.threadId,
          turnId,
          itemId: `command-${input.requestId}`,
          reason: "Command route",
          command: "bun test",
          cwd: "/repo",
        },
      };
      const fileRequest = {
        id: input.requestId,
        method: "item/fileChange/requestApproval",
        params: {
          threadId: input.threadId,
          turnId,
          itemId: `file-${input.requestId}`,
          reason: "File route",
          grantRoot: "/repo",
        },
      };
      const firstRequest = input.firstKind === "command" ? commandRequest : fileRequest;
      const secondRequest = input.firstKind === "command" ? fileRequest : commandRequest;
      const firstPromise = serviceInternals.handleServerRequest(firstRequest);
      const secondPromise = serviceInternals.handleServerRequest(secondRequest);
      await Promise.resolve();
      await Promise.resolve();

      const wrongKind = input.firstKind === "command" ? "file" : "command";
      expect(
        await serviceInternals.respondToApproval(
          input.requestId,
          { kind: wrongKind, decision: "decline" },
          input.threadId,
        ),
      ).toBe(false);
      expect(
        JSON.stringify(
          serviceInternals
            .getConversationRecord(input.threadId)
            .serverRequests.map((request) => request.method),
        ),
      ).toBe(JSON.stringify([firstRequest.method, secondRequest.method]));

      expect(
        await serviceInternals.respondToApproval(
          input.requestId,
          { kind: input.firstKind, decision: "decline" },
          input.threadId,
        ),
      ).toBe(true);
      expect(JSON.stringify(await firstPromise)).toBe(JSON.stringify({ decision: "decline" }));
      expect(await secondPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(serviceInternals.getConversationRecord(input.threadId).serverRequests.length).toBe(0);
    };

    try {
      await runCollision({
        threadId: "thr-file-first-approval-route",
        requestId: "file-first-approval-route",
        firstKind: "file",
      });
      await runCollision({
        threadId: "thr-command-first-approval-route",
        requestId: "command-first-approval-route",
        firstKind: "command",
      });
    } finally {
      await service.shutdown();
    }
  });

  test("stores synthetic-family requests for empty or missing target turns without inventing items", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number }>;
        hasUnreadTurn: boolean;
      };
      respondToPermissionRequest: (
        requestId: string | number,
        response: { permissions: Record<string, never>; scope: "turn" },
      ) => Promise<boolean>;
    };

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_request_empty_turns"),
      turns: [],
      transcript: [],
    });
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_request_missing_turn"),
      turns: [
        {
          threadId: "thr_request_missing_turn",
          turnId: "turn_existing",
          status: "completed",
          itemIds: [],
        },
      ],
      transcript: [],
    });

    try {
      const emptyPromise = serviceInternals.handleServerRequest({
        id: "empty-turn-user-input",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_request_empty_turns",
          turnId: "turn_absent",
          itemId: "user-input-empty-turn",
          isBlocking: true,
          questions: [
            {
              id: "q-empty",
              header: "Empty",
              question: "Continue?",
              isOther: false,
              isSecret: false,
            },
          ],
        },
      });
      const missingPromise = serviceInternals.handleServerRequest({
        id: "missing-turn-permission",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thr_request_missing_turn",
          turnId: "turn_missing",
          itemId: "permission-missing-turn",
          environmentId: "env-missing",
          startedAtMs: 200,
          cwd: "/tmp",
          reason: "Need access",
          permissions: { network: null, fileSystem: null },
        },
      });

      await Promise.resolve();

      const emptyRecord = serviceInternals.getConversationRecord("thr_request_empty_turns");
      const missingRecord = serviceInternals.getConversationRecord("thr_request_missing_turn");
      expect(JSON.stringify(emptyRecord.serverRequests.map((request) => request.id))).toBe(
        JSON.stringify(["empty-turn-user-input"]),
      );
      expect(emptyRecord.hasUnreadTurn).toBe(true);
      expect(
        service.serializeConversationSnapshot("thr_request_empty_turns")?.turns.length ?? -1,
      ).toBe(0);
      expect(
        getRecordedItem(
          serviceInternals,
          "thr_request_empty_turns",
          "turn_absent",
          "user-input-response-empty-turn-user-input",
        ),
      ).toBe(null);

      expect(JSON.stringify(missingRecord.serverRequests.map((request) => request.id))).toBe(
        JSON.stringify(["missing-turn-permission"]),
      );
      expect(missingRecord.hasUnreadTurn).toBe(true);
      expect(
        service.serializeConversationSnapshot("thr_request_missing_turn")?.turns.length ?? -1,
      ).toBe(1);
      expect(
        getRecordedItem(
          serviceInternals,
          "thr_request_missing_turn",
          "turn_missing",
          "permission-request-missing-turn-permission",
        ),
      ).toBe(null);

      expect(await service.respondToUserInput("empty-turn-user-input", {})).toBe(true);
      expect(
        await serviceInternals.respondToPermissionRequest("missing-turn-permission", {
          permissions: {},
          scope: "turn",
        }),
      ).toBe(true);
      await emptyPromise;
      await missingPromise;
    } finally {
      await service.shutdown();
    }
  });

  test("stores file approval raw state before consuming its asynchronous resume effect", async () => {
    const service = createService();
    const projectId = "project-file-approval-resume";
    const resumeObservations: Array<{
      threadId: string;
      requestIds: Array<string | number>;
      hasUnreadTurn: boolean;
      syncDormantConversationSnapshots: boolean | undefined;
    }> = [];
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      requestConversationResume: (
        threadId: string,
        options?: { syncDormantConversationSnapshots?: boolean },
      ) => Promise<CodexConversationSnapshot | null>;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number }>;
        hasUnreadTurn: boolean;
      };
      respondToApproval: (
        requestId: string | number,
        response: CodexApprovalResponse,
      ) => Promise<boolean>;
    };
    serviceInternals.parseThreadRef = () => ({ projectId, cwd: null });
    installManualApprovalState(service, projectId);
    serviceInternals.requestConversationResume = async (threadId, options) => {
      const record = serviceInternals.getConversationRecord(threadId);
      resumeObservations.push({
        threadId,
        requestIds: record.serverRequests.map((request) => request.id),
        hasUnreadTurn: record.hasUnreadTurn,
        syncDormantConversationSnapshots: options?.syncDormantConversationSnapshots,
      });
      return null;
    };

    try {
      const requestPromise = serviceInternals.handleServerRequest({
        id: "file-approval-resume",
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "thr_file_approval_resume",
          turnId: "turn_file_approval_resume",
          itemId: "patch_file_approval_resume",
          startedAtMs: 300,
          reason: "Need write access",
          grantRoot: "/tmp/shared",
        },
      });

      await Promise.resolve();
      expect(resumeObservations.length).toBe(1);
      expect(JSON.stringify(resumeObservations[0])).toBe(
        JSON.stringify({
          threadId: "thr_file_approval_resume",
          requestIds: ["file-approval-resume"],
          hasUnreadTurn: true,
          syncDormantConversationSnapshots: false,
        }),
      );

      expect(
        await serviceInternals.respondToApproval("file-approval-resume", {
          kind: "file",
          decision: "decline",
        }),
      ).toBe(true);
      expect(JSON.stringify(await requestPromise)).toBe(JSON.stringify({ decision: "decline" }));
    } finally {
      await service.shutdown();
    }
  });

  test("returns typed direct picker payloads and wrapped dynamic payloads while removing raw requests", async () => {
    const service = createService();
    const notificationEvents: CodexThreadNotificationEvent[] = [];
    service.addThreadNotificationListener((event) => {
      notificationEvents.push(event);
    });
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      respondToOptionPicker: (
        conversationId: string,
        requestId: string | number,
        response: {
          action: "submit" | "skip" | "dismiss";
          selectedOptions: readonly string[];
          freeformAnswer: string | null;
        },
      ) => Promise<boolean>;
      respondToSetupContextPicker: (
        conversationId: string,
        requestId: string | number,
        response: {
          action: "continue" | "skip" | "dismiss";
          selectedSources: readonly string[];
        },
      ) => Promise<boolean>;
      getConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
        serverRequests: Array<{ id: string | number }>;
        hasUnreadTurn: boolean;
      };
    };
    const threadId = "thr_picker_response_contract";

    try {
      const directOptionPromise = serviceInternals.handleServerRequest({
        id: 610,
        method: "item/tool/requestOptionPicker",
        params: {
          threadId,
          turnId: "turn_picker_response_contract",
          question: "Pick a direct option",
          options: [{ label: "Direct", description: "Direct response" }],
          allowMultiple: false,
          submitLabel: "Continue",
          skipLabel: null,
        },
      });
      const dynamicOptionPromise = serviceInternals.handleServerRequest({
        id: "dynamic-option-611",
        method: "item/tool/call",
        params: {
          threadId,
          turnId: "turn_picker_response_contract",
          callId: "call-dynamic-option-611",
          namespace: "codex_app",
          tool: "request_option_picker",
          arguments: {
            question: "Pick a dynamic option",
            options: [{ label: "Dynamic", description: "Dynamic response" }],
            allowMultiple: false,
            submitLabel: "Continue",
            skipLabel: "Skip",
          },
        },
      });
      const directSetupPromise = serviceInternals.handleServerRequest({
        id: 612,
        method: "item/tool/requestSetupCodexContextPicker",
        params: { threadId, turnId: "turn_picker_response_contract" },
      });
      const dynamicSetupPromise = serviceInternals.handleServerRequest({
        id: "dynamic-setup-613",
        method: "item/tool/call",
        params: {
          threadId,
          turnId: "turn_picker_response_contract",
          callId: "call-dynamic-setup-613",
          namespace: "codex_app",
          tool: "setup_codex_context_picker",
          arguments: {},
        },
      });

      await Promise.resolve();
      const record = serviceInternals.getConversationRecord(threadId);
      expect(JSON.stringify(record.serverRequests.map((request) => request.id))).toBe(
        JSON.stringify([610, "dynamic-option-611", 612, "dynamic-setup-613"]),
      );
      expect(JSON.stringify(record.canonicalState?.requests.map((request) => request.id))).toBe(
        JSON.stringify([610, "dynamic-option-611", 612, "dynamic-setup-613"]),
      );
      expect(record.hasUnreadTurn).toBe(true);
      expect(
        notificationEvents.filter((event) => event.type === "user-input-requested"),
      ).toMatchObject([
        { requestId: 610, questionCount: 0 },
        { requestId: "dynamic-option-611", questionCount: 0 },
      ]);

      const directOptionResponse = {
        action: "submit" as const,
        selectedOptions: ["Direct"],
        freeformAnswer: null,
      };
      const dynamicOptionResponse = {
        action: "skip" as const,
        selectedOptions: [],
        freeformAnswer: null,
      };
      const directSetupResponse = {
        action: "continue" as const,
        selectedSources: ["workspace"],
      };
      const dynamicSetupResponse = {
        action: "dismiss" as const,
        selectedSources: [],
      };

      expect(
        await serviceInternals.respondToOptionPicker(threadId, 610, directOptionResponse),
      ).toBe(true);
      expect(
        await serviceInternals.respondToOptionPicker(
          threadId,
          "dynamic-option-611",
          dynamicOptionResponse,
        ),
      ).toBe(true);
      expect(
        await serviceInternals.respondToSetupContextPicker(threadId, 612, directSetupResponse),
      ).toBe(true);
      expect(
        await serviceInternals.respondToSetupContextPicker(
          threadId,
          "dynamic-setup-613",
          dynamicSetupResponse,
        ),
      ).toBe(true);

      expect(JSON.stringify(await directOptionPromise)).toBe(JSON.stringify(directOptionResponse));
      expect(JSON.stringify(await dynamicOptionPromise)).toBe(
        JSON.stringify({
          contentItems: [{ type: "inputText", text: JSON.stringify(dynamicOptionResponse) }],
          success: true,
        }),
      );
      expect(JSON.stringify(await directSetupPromise)).toBe(JSON.stringify(directSetupResponse));
      expect(JSON.stringify(await dynamicSetupPromise)).toBe(
        JSON.stringify({
          contentItems: [{ type: "inputText", text: JSON.stringify(dynamicSetupResponse) }],
          success: true,
        }),
      );
      expect(record.serverRequests.length).toBe(0);
      expect(record.canonicalState?.requests.length).toBe(0);
      expect(record.canonicalState?.sidecar.hasUnreadTurn).toBe(true);
      expect(record.hasUnreadTurn).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("routes same-id picker replies by the first raw envelope and settles duplicate waiters once", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      respondToOptionPicker: (
        conversationId: string,
        requestId: string | number,
        response: {
          action: "submit" | "skip" | "dismiss";
          selectedOptions: readonly string[];
          freeformAnswer: string | null;
        },
      ) => Promise<boolean>;
      respondToSetupContextPicker: (
        conversationId: string,
        requestId: string | number,
        response: {
          action: "continue" | "skip" | "dismiss";
          selectedSources: readonly string[];
        },
      ) => Promise<boolean>;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number; method: string }>;
      };
    };
    const threadId = "thr_picker_first_envelope";
    const turnId = "turn_picker_first_envelope";
    const requestId = 620;

    try {
      const setupPromise = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/tool/requestSetupCodexContextPicker",
        params: { threadId, turnId },
      });
      const firstOptionPromise = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/tool/requestOptionPicker",
        params: {
          threadId,
          turnId,
          question: "Choose one",
          options: [{ label: "First", description: "First duplicate" }],
          allowMultiple: false,
          submitLabel: "Continue",
          skipLabel: null,
        },
      });
      const duplicateOptionPromise = serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/tool/requestOptionPicker",
        params: {
          threadId,
          turnId,
          question: "Choose again",
          options: [{ label: "Second", description: "Second duplicate" }],
          allowMultiple: false,
          submitLabel: "Continue",
          skipLabel: null,
        },
      });
      await Promise.resolve();

      expect(
        JSON.stringify(
          serviceInternals
            .getConversationRecord(threadId)
            .serverRequests.map((request) => request.method),
        ),
      ).toBe(
        JSON.stringify([
          "item/tool/requestSetupCodexContextPicker",
          "item/tool/requestOptionPicker",
          "item/tool/requestOptionPicker",
        ]),
      );
      expect(
        await serviceInternals.respondToOptionPicker(threadId, requestId, {
          action: "submit",
          selectedOptions: ["First"],
          freeformAnswer: null,
        }),
      ).toBe(false);
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(3);

      const setupResponse = {
        action: "continue" as const,
        selectedSources: ["workspace"],
      };
      expect(
        await serviceInternals.respondToSetupContextPicker(threadId, requestId, setupResponse),
      ).toBe(true);
      expect(JSON.stringify(await setupPromise)).toBe(JSON.stringify(setupResponse));
      expect(await firstOptionPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(await duplicateOptionPromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("approval attachment and reply preserve canonical raw item and item/thread timestamps", async () => {
    const service = createService();
    const projectId = "project-approval-timestamps";
    const rawItem = {
      id: "exec-approval-timestamps",
      type: "commandExecution",
      command: "bun test",
      cwd: "/tmp/project",
      status: "inProgress",
      aggregatedOutput: "",
    };
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      mergeItem: (item: CodexItemView) => void;
      getConversationRecord: (threadId: string) => {
        detail: CodexThreadDetail | null;
      };
      respondToApproval: (
        requestId: string | number,
        response: CodexApprovalResponse,
      ) => Promise<boolean>;
    };
    const threadId = "thr_approval_timestamps";
    const turnId = "turn_approval_timestamps";
    const itemId = "exec-approval-timestamps";
    serviceInternals.parseThreadRef = () => ({ projectId, cwd: "/tmp/project" });
    installManualApprovalState(service, projectId);
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      createdAt: 700,
      updatedAt: 800,
      turns: [
        {
          threadId,
          turnId,
          status: "inProgress",
          itemIds: [itemId],
          turnStartedAtMs: 710,
          firstTurnWorkItemStartedAtMs: 720,
          finalAssistantStartedAtMs: 730,
        },
      ],
      transcript: [],
    });
    serviceInternals.mergeItem({
      threadId,
      turnId,
      itemId,
      type: "commandExecution",
      normalizedKind: "commandExecution",
      semanticKind: "exec",
      status: "inProgress",
      rawItem,
      createdAt: 740,
      updatedAt: 750,
    });

    const readTimestamps = () => {
      const record = serviceInternals.getConversationRecord(threadId);
      const item = getRecordedItem(serviceInternals, threadId, turnId, itemId);
      const turn = record.detail?.turns.find((candidate) => candidate.turnId === turnId);
      const transcriptEntry = record.detail?.transcript.find((entry) => entry.itemId === itemId);
      return {
        itemCreatedAt: item?.createdAt ?? null,
        itemUpdatedAt: item?.updatedAt ?? null,
        transcriptCreatedAt: transcriptEntry?.createdAt ?? null,
        transcriptUpdatedAt: transcriptEntry?.updatedAt ?? null,
        turnStartedAtMs: turn?.turnStartedAtMs ?? null,
        firstTurnWorkItemStartedAtMs: turn?.firstTurnWorkItemStartedAtMs ?? null,
        finalAssistantStartedAtMs: turn?.finalAssistantStartedAtMs ?? null,
        threadCreatedAt: record.detail?.createdAt ?? null,
        threadUpdatedAt: record.detail?.updatedAt ?? null,
      };
    };
    const baselineTimestamps = readTimestamps();

    try {
      const requestPromise = serviceInternals.handleServerRequest({
        id: 614,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId,
          itemId,
          startedAtMs: 760,
          reason: "Approve timestamp-preserving command",
          command: "bun test",
          cwd: "/tmp/project",
        },
      });
      await Promise.resolve();

      const unchangedRaw = getRecordedItem(serviceInternals, threadId, turnId, itemId);
      const approvalItemId = `command-approval:${itemId}:614`;
      const approvalRow = getRecordedItem(serviceInternals, threadId, turnId, approvalItemId);
      expect(unchangedRaw?.approvalRequestId ?? null).toBe(null);
      expect(unchangedRaw?.rawItem === rawItem).toBe(true);
      expect(approvalRow?.approvalRequestId).toBe(614);
      expect(approvalRow?.callId).toBe(itemId);
      expect(approvalRow?.createdAt).toBe(760);
      expect(JSON.stringify(readTimestamps())).toBe(JSON.stringify(baselineTimestamps));

      expect(
        await serviceInternals.respondToApproval(614, { kind: "command", decision: "decline" }),
      ).toBe(true);
      expect(JSON.stringify(await requestPromise)).toBe(JSON.stringify({ decision: "decline" }));

      const replied = getRecordedItem(serviceInternals, threadId, turnId, itemId);
      expect(replied?.approvalRequestId ?? null).toBe(null);
      expect(replied?.rawItem === rawItem).toBe(true);
      expect(getRecordedItem(serviceInternals, threadId, turnId, approvalItemId) === null).toBe(
        true,
      );
      expect(JSON.stringify(readTimestamps())).toBe(JSON.stringify(baselineTimestamps));
    } finally {
      await service.shutdown();
    }
  });

  test("declines every exact pending request family before sending turn interrupt", async () => {
    const service = createService();
    const projectId = "project-interrupt-request-families";
    const threadId = "thr_interrupt_request_families";
    const turnId = "turn_interrupt_request_families";
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      requestConversationResume: () => Promise<CodexConversationSnapshot | null>;
      persistThreadSnapshot: (threadId: string) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<{ id: string | number }>;
      };
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const interruptCalls: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId, cwd: "/tmp/project" });
    installManualApprovalState(service, projectId);
    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail(threadId),
      turns: [{ threadId, turnId, status: "inProgress", itemIds: [] }],
      transcript: [],
    });
    serviceInternals.requestConversationResume = async () => null;
    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    client.start = async () => undefined;
    client.request = async (method, params) => {
      if (method === "turn/interrupt") {
        expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(0);
        interruptCalls.push({ method, params });
      }
      return {};
    };

    try {
      const commandPromise = serviceInternals.handleServerRequest({
        id: "interrupt-command",
        method: "item/commandExecution/requestApproval",
        params: { threadId, turnId, itemId: "exec-interrupt", reason: "Command" },
      });
      const filePromise = serviceInternals.handleServerRequest({
        id: "interrupt-file",
        method: "item/fileChange/requestApproval",
        params: { threadId, turnId, itemId: "patch-interrupt", startedAtMs: 800, reason: "File" },
      });
      const permissionPromise = serviceInternals.handleServerRequest({
        id: "interrupt-permission",
        method: "item/permissions/requestApproval",
        params: {
          threadId,
          turnId,
          itemId: "permission-interrupt",
          environmentId: "env-interrupt",
          startedAtMs: 801,
          cwd: "/tmp/project",
          reason: "Permission",
          permissions: { network: null, fileSystem: null },
        },
      });
      const userPromise = serviceInternals.handleServerRequest({
        id: "interrupt-user",
        method: "item/tool/requestUserInput",
        params: {
          threadId,
          turnId,
          itemId: "user-interrupt",
          isBlocking: true,
          questions: [
            {
              id: "q-interrupt",
              header: "Interrupt",
              question: "Continue?",
              isOther: false,
              isSecret: false,
            },
          ],
        },
      });
      const optionPromise = serviceInternals.handleServerRequest({
        id: "interrupt-option",
        method: "item/tool/requestOptionPicker",
        params: {
          threadId,
          turnId,
          question: "Choose",
          options: [{ label: "Continue" }],
          allowMultiple: false,
          submitLabel: "Continue",
          skipLabel: null,
        },
      });
      const setupPromise = serviceInternals.handleServerRequest({
        id: "interrupt-setup",
        method: "item/tool/requestSetupCodexContextPicker",
        params: { threadId, turnId },
      });
      const mcpPromise = serviceInternals.handleServerRequest({
        id: "interrupt-mcp",
        method: "mcpServer/elicitation/request",
        params: {
          threadId,
          turnId,
          serverName: "fixture_server",
          mode: "openai/form",
          message: "Provide a value",
          requestedSchema: { type: "object", properties: {} },
          _meta: null,
        },
      });

      await Promise.resolve();
      expect(
        JSON.stringify(
          serviceInternals
            .getConversationRecord(threadId)
            .serverRequests.map((request) => request.id),
        ),
      ).toBe(
        JSON.stringify([
          "interrupt-command",
          "interrupt-file",
          "interrupt-permission",
          "interrupt-user",
          "interrupt-option",
          "interrupt-setup",
          "interrupt-mcp",
        ]),
      );

      expect(await service.interruptTurn(threadId, turnId)).toBe(true);
      expect(JSON.stringify(interruptCalls)).toBe(
        JSON.stringify([
          {
            method: "turn/interrupt",
            params: { threadId, turnId },
          },
        ]),
      );
      expect(JSON.stringify(await commandPromise)).toBe(JSON.stringify({ decision: "decline" }));
      expect(JSON.stringify(await filePromise)).toBe(JSON.stringify({ decision: "decline" }));
      expect(JSON.stringify(await permissionPromise)).toBe(
        JSON.stringify({
          permissions: {},
          scope: "turn",
        }),
      );
      expect(JSON.stringify(await userPromise)).toBe(JSON.stringify({ answers: {} }));
      expect(JSON.stringify(await optionPromise)).toBe(
        JSON.stringify({
          action: "dismiss",
          selectedOptions: [],
          freeformAnswer: null,
        }),
      );
      expect(JSON.stringify(await setupPromise)).toBe(
        JSON.stringify({
          action: "dismiss",
          selectedSources: [],
        }),
      );
      expect(JSON.stringify(await mcpPromise)).toBe(
        JSON.stringify({
          action: "decline",
          content: null,
          _meta: null,
        }),
      );
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(0);
      expect(service.serializeConversationSnapshot(threadId)?.turns[0]?.status).toBe("interrupted");
    } finally {
      await service.shutdown();
    }
  });

  test("returns the exact wrapped onboarding payload once and settles duplicate waiters without responses", async () => {
    const service = createService();
    const threadId = "thr_onboarding_response_contract";
    const turnId = "turn_onboarding_response_contract";
    const requestId = 615;
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      respondToUserInput: (
        requestId: string | number,
        answers: Record<string, string[]>,
        conversationId?: string,
      ) => Promise<boolean>;
      getConversationRecord: (targetThreadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
        serverRequests: Array<{ id: string | number }>;
        hasUnreadTurn: boolean;
      };
    };
    const request = (callId: string) => ({
      id: requestId,
      method: "item/tool/call",
      params: {
        threadId,
        turnId,
        callId,
        namespace: "codex_app",
        tool: "request_onboarding_input",
        arguments: {
          questions: [
            {
              id: "first_task",
              header: "Start",
              question: "What should Codex do first?",
              options: [
                { label: "Audit", description: "Inspect the implementation" },
                { label: "Build", description: "Implement the change" },
              ],
            },
          ],
        },
      },
    });

    try {
      const firstPromise = serviceInternals.handleServerRequest(request("onboarding-call-first"));
      const duplicatePromise = serviceInternals.handleServerRequest(
        request("onboarding-call-duplicate"),
      );
      await Promise.resolve();

      const pendingRecord = serviceInternals.getConversationRecord(threadId);
      expect(JSON.stringify(pendingRecord.serverRequests.map((entry) => entry.id))).toBe(
        JSON.stringify([requestId, requestId]),
      );
      expect(JSON.stringify(pendingRecord.canonicalState?.requests.map((entry) => entry.id))).toBe(
        JSON.stringify([requestId, requestId]),
      );
      expect(pendingRecord.hasUnreadTurn).toBe(true);

      expect(
        await serviceInternals.respondToUserInput(requestId, { first_task: ["Audit"] }, threadId),
      ).toBe(true);
      expect(JSON.stringify(await firstPromise)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                answers: {
                  first_task: { answers: ["Audit"] },
                },
              }),
            },
          ],
          success: true,
        }),
      );
      expect(await duplicatePromise).toBe(CODEX_SERVER_REQUEST_NO_RESPONSE);
      expect(pendingRecord.serverRequests.length).toBe(0);
      expect(pendingRecord.canonicalState?.requests.length).toBe(0);
      expect(pendingRecord.canonicalState?.sidecar.hasUnreadTurn).toBe(true);
      expect(pendingRecord.hasUnreadTurn).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("validates setup-step responses and wraps exact role task and context results", async () => {
    const service = createService();
    const threadId = "thr_setup_step_response_contract";
    const turnId = "turn_setup_step_response_contract";
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: {
        id: string | number;
        method: string;
        params: unknown;
      }) => Promise<unknown>;
      respondToSetupCodexStep: (
        conversationId: string,
        requestId: string | number,
        response:
          | {
              step: "role";
              action: "submit" | "skip" | "dismiss";
              selectedRoles: readonly string[];
            }
          | {
              step: "task";
              action: "submit" | "skip" | "dismiss";
              answers: Readonly<Record<string, { readonly answers: readonly string[] }>>;
            }
          | {
              step: "context";
              action: "continue" | "skip" | "dismiss";
              selectedSources: readonly string[];
            },
      ) => Promise<boolean>;
      getConversationRecord: (targetThreadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
        serverRequests: Array<{ id: string | number }>;
        hasUnreadTurn: boolean;
      };
    };
    const requestFor = (requestId: string, step: "role" | "task" | "context") =>
      serviceInternals.handleServerRequest({
        id: requestId,
        method: "item/tool/call",
        params: {
          threadId,
          turnId,
          callId: `call-${requestId}`,
          namespace: "codex_app",
          tool: "setup_codex_step",
          arguments: { step },
        },
      });

    try {
      const completeResult = await serviceInternals.handleServerRequest({
        id: "setup-complete-615",
        method: "item/tool/call",
        params: {
          threadId,
          turnId,
          callId: "call-setup-complete-615",
          namespace: "codex_app",
          tool: "setup_codex_step",
          arguments: { step: "complete" },
        },
      });
      expect(JSON.stringify(completeResult)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({ completed: true }),
            },
          ],
          success: true,
        }),
      );
      expect(serviceInternals.getConversationRecord(threadId).serverRequests.length).toBe(0);

      let roleResolved = false;
      const rolePromise = requestFor("setup-role-616", "role");
      const taskPromise = requestFor("setup-task-617", "task");
      const contextPromise = requestFor("setup-context-618", "context");
      void rolePromise.then(() => {
        roleResolved = true;
      });
      await Promise.resolve();

      expect(
        await serviceInternals.respondToSetupCodexStep(threadId, "setup-role-616", {
          step: "context",
          action: "dismiss",
          selectedSources: [],
        }),
      ).toBe(false);
      await Promise.resolve();
      expect(roleResolved).toBe(false);
      expect(
        JSON.stringify(
          serviceInternals
            .getConversationRecord(threadId)
            .serverRequests.map((request) => request.id),
        ),
      ).toBe(JSON.stringify(["setup-role-616", "setup-task-617", "setup-context-618"]));

      expect(
        await serviceInternals.respondToSetupCodexStep(threadId, "setup-role-616", {
          step: "role",
          action: "submit",
          selectedRoles: ["engineer", "reviewer"],
        }),
      ).toBe(true);
      expect(
        await serviceInternals.respondToSetupCodexStep(threadId, "setup-task-617", {
          step: "task",
          action: "skip",
          answers: { first_task: { answers: ["Ship parity"] } },
        }),
      ).toBe(true);
      expect(
        await serviceInternals.respondToSetupCodexStep(threadId, "setup-context-618", {
          step: "context",
          action: "continue",
          selectedSources: ["repo", "docs"],
        }),
      ).toBe(true);

      expect(JSON.stringify(await rolePromise)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                action: "submit",
                selectedRoles: ["engineer", "reviewer"],
              }),
            },
          ],
          success: true,
        }),
      );
      expect(JSON.stringify(await taskPromise)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                action: "skip",
                answers: { first_task: { answers: ["Ship parity"] } },
              }),
            },
          ],
          success: true,
        }),
      );
      expect(JSON.stringify(await contextPromise)).toBe(
        JSON.stringify({
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                action: "continue",
                selectedSources: ["repo", "docs"],
              }),
            },
          ],
          success: true,
        }),
      );
      const record = serviceInternals.getConversationRecord(threadId);
      expect(record.serverRequests.length).toBe(0);
      expect(record.canonicalState?.requests.length).toBe(0);
      expect(record.canonicalState?.sidecar.hasUnreadTurn).toBe(true);
      expect(record.hasUnreadTurn).toBe(true);
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

      let planItem = getRecordedItem(
        serviceInternals,
        "thr_plan_delta_existing",
        "turn_plan_delta_existing",
        "plan_item",
      );
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

      planItem = getRecordedItem(
        serviceInternals,
        "thr_plan_delta_existing",
        "turn_plan_delta_existing",
        "plan_item",
      );
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

      let snapshot = await service.requestConversationSnapshot("thr_guardian_warning");
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

      snapshot = await service.requestConversationSnapshot("thr_guardian_warning");
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

      const snapshot = await service.requestConversationSnapshot("thr_model_reroute");
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
      setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
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
    serviceInternals.setRendererConversationOwner("thr_mcp_invalid", "owner-a");

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
      getConversationRecord: (threadId: string) => {
        serverRequests: Array<typeof request>;
      };
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
    record.serverRequests = [request];
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

      expect(record.serverRequests.length).toBe(1);
      expect(record.serverRequests[0] === request).toBe(true);
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
        canonicalState: CodexCanonicalConversationState | null;
        serverRequests: Array<{
          id: string | number;
          method: string;
          params: { threadId?: string; turnId?: string; planContent?: string };
        }>;
        hasUnreadTurn: boolean;
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
      method: "item/tool/requestOptionPicker",
      params: { threadId, turnId: currentTurnId },
    };
    record.serverRequests = [
      planRequest(currentTurnId, "old-current"),
      unrelated,
      planRequest(staleTurnId, "stale-plan"),
      planRequest(currentTurnId, "duplicate-current"),
      planRequest(orphanTurnId, "orphan-plan"),
    ];
    record.hasUnreadTurn = false;
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
      expect(record.hasUnreadTurn).toBe(true);
      expect(JSON.stringify(record.serverRequests.map((request) => request.id))).toBe(
        JSON.stringify(["unrelated-option", "stale-plan", "orphan-plan", fresh.requestId]),
      );
      expect(JSON.stringify(record.canonicalState?.requests.map((request) => request.id))).toBe(
        JSON.stringify(["unrelated-option", "stale-plan", "orphan-plan", fresh.requestId]),
      );

      serviceInternals.completeStalePlanImplementationItems(threadId, currentTurnId);
      expect(JSON.stringify(record.serverRequests.map((request) => request.id))).toBe(
        JSON.stringify(["unrelated-option", fresh.requestId]),
      );
      expect(JSON.stringify(record.canonicalState?.requests.map((request) => request.id))).toBe(
        JSON.stringify(["unrelated-option", fresh.requestId]),
      );
      expect(JSON.stringify([...record.planImplementationRequestsByTurnId.keys()])).toBe(
        JSON.stringify([currentTurnId]),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("removing a planImplementation request completes the item and removes the request-plane entry", async () => {
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
      const pendingItem = getRecordedItem(
        serviceInternals as unknown as {
          getConversationRecord: (threadId: string) => {
            itemsByTurn: Map<string, Map<string, CodexItemView>>;
          };
        },
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
        "implement-plan:turn_plan_impl_remove",
      );

      const removed = await service.removePlanImplementationRequest(
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
      );
      expect(removed).toBe(true);

      requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_remove");
      expect(requests.length).toBe(0);

      const item = getRecordedItem(
        serviceInternals as unknown as {
          getConversationRecord: (threadId: string) => {
            itemsByTurn: Map<string, Map<string, CodexItemView>>;
          };
        },
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
        "implement-plan:turn_plan_impl_remove",
      );
      expect(item?.status).toBe("completed");
      expect(item?.createdAt).toBe(pendingItem?.createdAt);
      expect(item?.updatedAt).toBe(pendingItem?.updatedAt);
      const customItem = getRecordedItem(
        serviceInternals as unknown as {
          getConversationRecord: (threadId: string) => {
            itemsByTurn: Map<string, Map<string, CodexItemView>>;
          };
        },
        "thr_plan_impl_remove",
        "turn_plan_impl_remove",
        "custom-plan-implementation",
      );
      expect(customItem?.status).toBe("completed");
      expect(customItem?.createdAt).toBe(31);
      expect(customItem?.updatedAt).toBe(32);
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

  test("interruptTurn immediately marks known in-progress turn/items as interrupted", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      mergeItem: (entry: CodexItemView) => void;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const events: CodexEvent[] = [];

    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    client.start = async () => undefined;
    client.request = async () => ({});

    try {
      serviceInternals.mergeTurn("thr_interrupt_terminal", {
        threadId: "thr_interrupt_terminal",
        turnId: "turn_interrupt_terminal",
        status: "inProgress",
        itemIds: ["item_tool"],
      });
      serviceInternals.mergeItem({
        threadId: "thr_interrupt_terminal",
        turnId: "turn_interrupt_terminal",
        itemId: "item_tool",
        type: "commandExecution",
        normalizedKind: "commandExecution",
        semanticKind: "exec",
        status: "inProgress",
        toolCall: {
          subtype: "command",
          toolName: "bash",
          args: {
            command: "ls",
          },
        },
        createdAt: 10,
        updatedAt: 10,
      });

      const interrupted = await service.interruptTurn(
        "thr_interrupt_terminal",
        "turn_interrupt_terminal",
      );
      expect(interrupted).toBe(true);

      const turnEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "turn" }> => event.type === "turn",
      );
      expect(turnEvents.some((event) => event.turn.status === "interrupted")).toBe(true);
      const interruptedTurn = turnEvents.find(
        (event) => event.turn.turnId === "turn_interrupt_terminal",
      )?.turn;
      expect(interruptedTurn?.interruptedCommandExecutionItemIds?.[0]).toBe("item_tool");
      const item = getRecordedItem(
        serviceInternals,
        "thr_interrupt_terminal",
        "turn_interrupt_terminal",
        "item_tool",
      );
      expect(item?.status).toBe("interrupted");
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
      const broadcastCache = Reflect.get(
        service as object,
        "acceptedConversationDocumentById",
      ) as Map<string, CodexConversationSnapshot>;

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
        () =>
          broadcastCache.get("thr_streaming_delta_hot_path")?.turns[0]?.items[0]?.markdownText ===
          "hello",
        120,
      );

      expect(String(serializeConversationSnapshotCallCount)).toBe("0");
      expect(hostMessages).toHaveLength(0);
      const latest = broadcastCache.get("thr_streaming_delta_hot_path");
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
      const broadcastCache = Reflect.get(
        service as object,
        "acceptedConversationDocumentById",
      ) as Map<string, CodexConversationSnapshot>;

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
        () =>
          broadcastCache.get("thr_streaming_large_delta")?.turns[0]?.items[0]?.markdownText ===
          largeDelta,
        180,
      );

      expect(hostMessages).toHaveLength(0);
      const latest = broadcastCache.get("thr_streaming_large_delta");
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

      const snapshot = await service.requestConversationSnapshot("thr_streaming_output");
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
      service.setRendererConversationOwner("thr_owner_streaming_output", "owner-a");
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
      const snapshot = await service.requestConversationSnapshot("thr_owner_streaming_output");
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
        canonicalState: CodexCanonicalConversationState | null;
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
      serviceInternals.applyOutputDeltas([
        {
          conversationId: threadId,
          turnId,
          itemId,
          delta: "canonical output\n",
        },
      ]);

      const canonicalCommand = record?.canonicalState?.turns[0]?.items[0];
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
      service.setRendererConversationOwner("thr_owner_terminal_interaction", "owner-a");
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

      const snapshot = await service.requestConversationSnapshot("thr_owner_terminal_interaction");
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
        canonicalState: CodexCanonicalConversationState | null;
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

      const canonicalCommand = record?.canonicalState?.turns[0]?.items[0];
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
      getConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
      };
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
      const canonicalItem = serviceInternals
        .getConversationRecord("thr_hidden_review_lifecycle")
        .canonicalState?.turns[0]?.items.find((item) => item.id === "review-mode-marker");
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
      getConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
      };
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
        serviceInternals.getConversationRecord("thr_hidden_visible_roundtrip").canonicalState
          ?.turns[0]?.items[1]?.type,
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
      getConversationRecord: (threadId: string) => {
        canonicalState: CodexCanonicalConversationState | null;
      };
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
        serviceInternals.getConversationRecord("thr_hidden_patch_replacement").canonicalState
          ?.turns[0]?.items[1]?.type,
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
      expect(
        serviceInternals.conversationRecords.get(recordThreadId)?.itemsByTurn.get(nullTurnId)
          ?.size ?? 0,
      ).toBe(0);
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

  test("item/completed leaves pending command output on its independent timer", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (notification: CodexTestServerNotification) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_output_timer"),
        turns: [
          {
            threadId: "thr_completed_output_timer",
            turnId: "turn_completed_output_timer",
            status: "inProgress",
            itemIds: ["exec_completed_output_timer"],
          },
        ],
        transcript: [],
      });

      await serviceInternals.handleNotification({
        method: "item/started",
        params: {
          threadId: "thr_completed_output_timer",
          turnId: "turn_completed_output_timer",
          item: makeProtocolCommandExecution({
            id: "exec_completed_output_timer",
            command: "bun test",
            aggregatedOutput: null,
          }),
        },
      });
      await serviceInternals.handleNotification({
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thr_completed_output_timer",
          turnId: "turn_completed_output_timer",
          itemId: "exec_completed_output_timer",
          delta: "provisional output\n",
        },
      });
      await serviceInternals.handleNotification({
        method: "item/completed",
        params: {
          threadId: "thr_completed_output_timer",
          turnId: "turn_completed_output_timer",
          item: makeProtocolCommandExecution({
            id: "exec_completed_output_timer",
            command: "bun test",
            status: "completed",
            aggregatedOutput: null,
          }),
        },
      });

      const beforeTimer = service.serializeConversationSnapshot("thr_completed_output_timer");
      expect(beforeTimer?.turns[0]?.items[0]?.status).toBe("completed");
      expect(beforeTimer?.turns[0]?.items[0]?.aggregatedOutput).toBe(null);

      await new Promise((resolve) => setTimeout(resolve, 70));
      const afterTimer = service.serializeConversationSnapshot("thr_completed_output_timer");
      expect(afterTimer?.turns[0]?.items[0]?.status).toBe("completed");
      expect(afterTimer?.turns[0]?.items[0]?.aggregatedOutput).toBe("provisional output\n");
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
        canonicalState: CodexCanonicalConversationState | null;
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
      if (record?.canonicalState) {
        const firstTurn = record.canonicalState.turns[0];
        if (firstTurn) {
          record.canonicalState = {
            ...record.canonicalState,
            turns: [
              {
                ...firstTurn,
                sidecar: {
                  ...firstTurn.sidecar,
                  hookRuns: undefined,
                },
              },
            ],
          };
        }
      }
      expect(record?.canonicalState?.turns[0]?.sidecar.hookRuns).toBeUndefined();
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

      expect(record?.canonicalState?.turns[0]?.sidecar.hookRuns).toEqual([]);
      expect(record?.canonicalState?.turns[0]?.items.length).toBe(1);
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
      const baseConversation = await service.requestConversationSnapshot(threadId);
      expect(baseConversation).not.toBeNull();
      const broadcastCache = Reflect.get(
        service as object,
        "acceptedConversationDocumentById",
      ) as Map<string, CodexConversationSnapshot>;

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
      const pendingConversation = broadcastCache.get(threadId);
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

      const resolvedConversation = broadcastCache.get(threadId);
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

describe("codex-service managed worktree inventory", () => {
  test("resolves thread inspection and restoration through the owning host", async () => {
    const worktreePath = "/managed/a1b2/repository";
    const thread = makeDesktopWorkspaceThread({
      threadId: "thread-restore",
      projectId: "project-one",
      executionHostId: "local",
      cwd: `${worktreePath}/packages/app`,
      managedWorktreePath: worktreePath,
    });
    const basePort = createTestProjectWorkspace();
    const projectWorkspace = {
      ...basePort,
      getThread: async (threadId: string) => (threadId === thread.threadId ? thread : null),
      readManagedWorktreeLifecycleSnapshot: async () => ({
        projectionRevision: 1,
        consumers: [],
        projects: [
          {
            projectId: "project-one",
            lifecycle: "active" as const,
            sourceRoots: ["/repositories/repository"],
            primaryWorkspaceRoot: "/repositories/repository",
          },
        ],
      }),
    } satisfies DesktopProjectWorkspacePort;
    let releaseInspection: () => void = () => {};
    const inspectionGate = new Promise<void>((resolve) => {
      releaseInspection = resolve;
    });
    const inspect = vi.fn(async () => {
      await inspectionGate;
      return {
        availability: {
          state: "restorable" as const,
          repositoryPath: "/repositories/repository",
          snapshotRef: "refs/codex/snapshots/one",
        },
      };
    });
    const restore = vi.fn(async () => ({
      worktreeGitRoot: worktreePath,
      cwd: thread.cwd ?? worktreePath,
      repositoryPath: "/repositories/repository",
      snapshotRef: "refs/codex/snapshots/one",
      ownerWarning: null,
    }));
    const worker = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      inspect,
      restore,
    } satisfies CodexWorktreeWorkerPort;
    const service = createService({ projectWorkspace });
    (service as unknown as CodexService).setWorktreeWorkerPort("local", worker, "/managed");

    try {
      const inspection = service.inspectThreadManagedWorktree(thread.threadId);
      await Promise.resolve();
      releaseInspection();
      await expect(inspection).resolves.toEqual(expect.objectContaining({ state: "restorable" }));
      expect(inspect).toHaveBeenCalledOnce();
      expect(inspect).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "local",
          managedRoot: "/managed",
          worktreeGitRoot: worktreePath,
          cwd: `${worktreePath}/packages/app`,
          candidateRepositoryPaths: ["/repositories/repository"],
        }),
        expect.any(Object),
      );

      await expect(service.restoreThreadManagedWorktree(thread.threadId)).resolves.toEqual({
        availability: { state: "available" },
        ownerWarning: null,
      });
      expect(restore).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerThreadId: thread.threadId,
          worktreeGitRoot: worktreePath,
        }),
        expect.any(Object),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("transfers archive ownership before considering physical removal", async () => {
    const worktreePath = "/managed/a1b2/repository";
    const archived = makeDesktopWorkspaceThread({
      threadId: "thread-archived",
      executionHostId: "local",
      cwd: worktreePath,
      managedWorktreePath: worktreePath,
      archived: true,
    });
    const basePort = createTestProjectWorkspace();
    const projectWorkspace = {
      ...basePort,
      readManagedWorktreeLifecycleSnapshot: async () => ({
        projectionRevision: 2,
        consumers: [
          {
            threadId: "thread-replacement",
            projectId: "project-one",
            sessionId: "session-replacement",
            executionHostId: "local",
            cwd: `${worktreePath}/packages/app`,
            managedWorktreePath: worktreePath,
            runtimeWorkspaceRoots: [worktreePath],
            archived: false,
            pinnedOrder: null,
            statusType: "active" as const,
            statusActiveFlags: [],
            createdAt: 1,
            updatedAt: 20,
            linkedAt: "2026-08-14T00:00:00.000Z",
          },
        ],
        projects: [],
      }),
    } satisfies DesktopProjectWorkspacePort;
    const setOwner = vi.fn(async () => ({ ownerThreadId: "thread-replacement" }));
    const remove = vi.fn();
    const worker = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      setOwner,
      remove,
    } satisfies CodexWorktreeWorkerPort;
    const service = createService({ projectWorkspace });
    (service as unknown as CodexService).setWorktreeWorkerPort("local", worker, "/managed");

    try {
      await service.reconcileArchivedThreadManagedWorktree(archived, "archive");
      expect(setOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerThreadId: "thread-replacement",
          worktreeGitRoot: worktreePath,
        }),
        expect.any(Object),
      );
      expect(remove).not.toHaveBeenCalled();
    } finally {
      await service.shutdown();
    }
  });

  test("uses snapshot-required removal for the last archived consumer", async () => {
    const worktreePath = "/managed/a1b2/repository";
    const archived = makeDesktopWorkspaceThread({
      threadId: "thread-last",
      executionHostId: "local",
      cwd: worktreePath,
      managedWorktreePath: worktreePath,
      archived: true,
    });
    const basePort = createTestProjectWorkspace();
    const projectWorkspace = {
      ...basePort,
      readManagedWorktreeLifecycleSnapshot: async () => ({
        projectionRevision: 3,
        consumers: [],
        projects: [],
      }),
    } satisfies DesktopProjectWorkspacePort;
    const remove = vi.fn(async () => ({
      removed: true,
      alreadyMissing: false,
      snapshot: null,
      warnings: [],
    }));
    const worker = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      remove,
    } satisfies CodexWorktreeWorkerPort;
    const service = createService({ projectWorkspace });
    (service as unknown as CodexService).setWorktreeWorkerPort("local", worker, "/managed");

    try {
      await service.reconcileArchivedThreadManagedWorktree(archived, "archive");
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "archive",
          snapshotPolicy: "required",
        }),
        expect.any(Object),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("groups every consumer by physical root and excludes permanent project roots", async () => {
    const sharedPath = "/managed/a1b2/repository";
    const permanentPath = "/managed/c3d4/permanent";
    const basePort = createTestProjectWorkspace();
    const projectWorkspace = {
      ...basePort,
      readManagedWorktreeLifecycleSnapshot: async () => ({
        projectionRevision: 7,
        consumers: [
          {
            threadId: "thread-one",
            projectId: "project-one",
            sessionId: "session-one",
            executionHostId: "local",
            cwd: sharedPath,
            managedWorktreePath: sharedPath,
            runtimeWorkspaceRoots: [sharedPath],
            archived: false,
            pinnedOrder: null,
            statusType: "idle" as const,
            statusActiveFlags: [],
            createdAt: 10,
            updatedAt: 30,
            linkedAt: "2026-08-14T00:00:00.000Z",
          },
          {
            threadId: "thread-two",
            projectId: "project-one",
            sessionId: "session-two",
            executionHostId: "local",
            cwd: `${sharedPath}/nested`,
            managedWorktreePath: sharedPath,
            runtimeWorkspaceRoots: [sharedPath],
            archived: true,
            pinnedOrder: null,
            statusType: "idle" as const,
            statusActiveFlags: [],
            createdAt: 11,
            updatedAt: 20,
            linkedAt: "2026-08-14T00:00:01.000Z",
          },
        ],
        projects: [
          {
            projectId: "project-one",
            lifecycle: "active" as const,
            sourceRoots: [permanentPath],
            primaryWorkspaceRoot: permanentPath,
          },
        ],
      }),
      listProjects: async () => [makeProject({ id: "project-one", name: "Repository" })],
      getThread: async (threadId: string) =>
        makeDesktopWorkspaceThread({
          threadId,
          threadName: threadId === "thread-one" ? "First" : "Second",
        }),
      getProjectSession: async (sessionId: string) =>
        ({
          id: sessionId,
          projectId: "project-one",
          displayTitle: sessionId === "session-one" ? "Newest" : "Older",
        }) as never,
    } satisfies DesktopProjectWorkspacePort;
    const service = createService({ projectWorkspace });
    const worker = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      list: async () => ({
        entries: [
          {
            worktreeGitRoot: sharedPath,
            repositoryPath: "/repositories/repository",
            createdAtMs: 100,
            ownerThreadId: "thread-one",
            ownerReadFailed: false,
          },
          {
            worktreeGitRoot: permanentPath,
            repositoryPath: "/repositories/permanent",
            createdAtMs: 90,
            ownerThreadId: null,
            ownerReadFailed: false,
          },
        ],
      }),
    } satisfies CodexWorktreeWorkerPort;
    (service as unknown as CodexService).setWorktreeWorkerPort("local", worker, "/managed");

    try {
      await expect(service.listManagedWorktrees()).resolves.toEqual([
        {
          hostId: "local",
          path: sharedPath,
          exists: true,
          repositoryPath: "/repositories/repository",
          createdAtMs: 100,
          conversations: [
            {
              threadId: "thread-one",
              projectId: "project-one",
              projectName: "Repository",
              sessionId: "session-one",
              sessionTitle: "Newest",
              threadName: "First",
              archived: false,
              updatedAt: 30,
            },
            {
              threadId: "thread-two",
              projectId: "project-one",
              projectName: "Repository",
              sessionId: "session-two",
              sessionTitle: "Older",
              threadName: "Second",
              archived: true,
              updatedAt: 20,
            },
          ],
        },
      ]);
    } finally {
      await service.shutdown();
    }
  });

  test("plans from one Core snapshot and prunes through lifecycle policy", async () => {
    const basePort = createTestProjectWorkspace();
    const readSnapshot = vi.fn(async () => ({
      projectionRevision: 9,
      consumers: [],
      projects: [],
    }));
    const projectWorkspace = {
      ...basePort,
      readManagedWorktreeLifecycleSnapshot: readSnapshot,
    } satisfies DesktopProjectWorkspacePort;
    const service = createService({ projectWorkspace });
    const limit = (service as unknown as CodexService).getManagedWorktreeSettings().autoDeleteLimit;
    const remove = vi.fn(async () => ({
      removed: true,
      alreadyMissing: false,
      snapshot: null,
      warnings: [],
    }));
    const worker = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      list: async () => ({
        entries: Array.from({ length: limit + 2 }, (_, index) => ({
          worktreeGitRoot: `/managed/${String(index).padStart(4, "0")}/repository`,
          repositoryPath: "/repositories/repository",
          createdAtMs: Date.parse("2026-08-13T00:00:00.000Z") + index,
          ownerThreadId: null,
          ownerReadFailed: false,
        })),
      }),
      remove,
    } satisfies CodexWorktreeWorkerPort;
    (service as unknown as CodexService).setWorktreeWorkerPort("local", worker, "/managed");

    try {
      const plan = await service.runManagedWorktreeRetentionSweep();
      expect(readSnapshot).toHaveBeenCalledOnce();
      expect(plan.status).toBe("planned");
      expect(plan.delete.map((item) => item.worktreeGitRoot)).toEqual([
        "/managed/0000/repository",
        "/managed/0001/repository",
      ]);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "automatic-retention",
          snapshotPolicy: "required",
        }),
        expect.any(Object),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("archives all consumers before one targeted lifecycle deletion and keeps their links", async () => {
    const worktreePath = "/managed/a1b2/repository";
    const calls: string[] = [];
    const basePort = createTestProjectWorkspace();
    const projectWorkspace = {
      ...basePort,
      readManagedWorktreeLifecycleSnapshot: async () => ({
        projectionRevision: 1,
        consumers: ["thread-one", "thread-two"].map((threadId, index) => ({
          threadId,
          projectId: "project-one",
          sessionId: `session-${index}`,
          executionHostId: "local",
          cwd: worktreePath,
          managedWorktreePath: worktreePath,
          runtimeWorkspaceRoots: [worktreePath],
          archived: false,
          pinnedOrder: null,
          statusType: "idle" as const,
          statusActiveFlags: [],
          createdAt: index,
          updatedAt: index,
          linkedAt: "2026-08-14T00:00:00.000Z",
        })),
        projects: [],
      }),
      setThreadArchived: async (threadId: string, archived: boolean) => {
        calls.push(`archive:${threadId}:${archived}`);
        return await basePort.setThreadArchived(threadId, archived);
      },
    } satisfies DesktopProjectWorkspacePort;
    const remove = vi.fn(async () => {
      calls.push("remove");
      return {
        removed: true,
        alreadyMissing: false,
        snapshot: null,
        warnings: [],
      };
    });
    const service = createService({ projectWorkspace });
    const worker = {
      ...createInProcessCodexWorktreeWorkerPort({ hostId: "local" }),
      remove,
    } satisfies CodexWorktreeWorkerPort;
    (service as unknown as CodexService).setWorktreeWorkerPort("local", worker, "/managed");

    try {
      await expect(service.deleteManagedWorktree("local", worktreePath)).resolves.toBe(true);
      expect(calls).toEqual(["archive:thread-one:true", "archive:thread-two:true", "remove"]);
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "local",
          worktreeGitRoot: worktreePath,
          reason: "settings-delete",
          snapshotPolicy: "best-effort",
        }),
        expect.any(Object),
      );
    } finally {
      await service.shutdown();
    }
  });
});
