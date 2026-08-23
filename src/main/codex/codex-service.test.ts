import { afterAll, describe, expect, test, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
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
} from "../../shared/types";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import {
  getCodexThreadOwnerNotificationThreadId,
  isCodexThreadOwnerNotification,
} from "../../shared/types";
import { TestCodexThreadSettingsRuntime } from "./codex-thread-settings-runtime.test-support";
import {
  buildThreadSettingsUpdateParams,
  mergeThreadSettingsPatch,
} from "../codex-application/CodexThreadSettingsProjection";
import { TestCodexThreadTitlePersistence } from "./codex-thread-title-persistence.test-support";
import { TestCodexPostResumeGoalRuntime } from "./codex-post-resume-goal-runtime.test-support";
import { TestCodexBackgroundSubagentMetadataRepair } from "./codex-background-subagent-metadata-repair.test-support";
import { CodexSubagentCatalog } from "../codex-application/CodexSubagentCatalog";
import { CodexConversationDeltaBufferRuntime } from "../codex-application/CodexConversationDeltaBufferRuntime";
import { TestCodexConversationResumeRuntime } from "./codex-conversation-resume-runtime.test-support";
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
import { DEFAULT_PROJECT_APPEARANCE } from "../../shared/project-appearance";

import { getCodexFileChangePaths } from "../../shared/codex-file-change";
import type {
  CodexPendingWorktreeCreateInput,
  CodexPendingWorktreeEntry,
} from "../../shared/codex-pending-worktree";
import {
  createCodexCanonicalHydratedConversationState,
  isCodexCanonicalProtocolItem,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import type {
  BrowserSidebarBrowserUseStateSnapshot,
  BrowserSidebarStateSnapshot,
} from "../../shared/browser-sidebar";
import { CodexService } from "./codex-service";
import { CodexSessionStore } from "./codex-session-store";
import type { ResolvedCodexRuntime } from "./codex-runtime";
import type { CodexGatewayPromiseClient } from "../codex-runtime/CodexGatewayPromiseAdapter";
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
  readThread: (threadId: string, includeTurns?: boolean) => Promise<CodexThreadDetail | null>;
  sidebarSync: import("../codex-application/CodexSidebarSyncRuntimePromiseAdapter").CodexSidebarSyncRuntimePromiseAdapter;
  threadCatalog: import("../codex-application/CodexThreadCatalogPromiseAdapter").CodexThreadCatalogPromiseAdapter;
  requestConversationResume: (
    threadId: string,
    options?: { syncDormantConversationSnapshots?: boolean; replayBufferedNotifications?: boolean },
  ) => Promise<CodexConversationSnapshot | null>;
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
    markAllNeedsResume: conversationAggregates.markAllNeedsResume,
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
    isEligible: () => false,
    continueGoal: async () => undefined,
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
    project: ({ threadId, name }) => {
      if (!service) throw new Error("Codex test service is not constructed");
      conversationAggregateForTest(service, threadId).renameThread({
        name,
        observedAtMs: Date.now(),
        projectReplica: true,
      });
    },
    setRemote: async ({ threadId, name }) => {
      if (!service) throw new Error("Codex test service is not constructed");
      const client = Reflect.get(service, "client") as {
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      await client.request("thread/name/set", { threadId, name });
    },
    persistWorkspace: async ({ threadId, name }) => {
      await projectWorkspace.updateThread(threadId, { threadName: name });
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
      const detail = await service.resumeThread(input.threadId);
      return detail ? service.serializeConversationSnapshot(input.threadId) : null;
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
    releaseBuffer: async () => false,
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
    continueGoal: () =>
      Effect.die("Goal continuation is exercised by the final semantic capability"),
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
        conversationAggregateForTest(service, action.threadId).acceptThreadGoal({
          goal,
          appendTranscriptItem:
            action.appendTranscriptItem !== false && typeof action.objective === "string",
          dismissResumeConfirmation: action.dismissResumeConfirmation === true,
          projectReplica: true,
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
    respond: () => undefined,
    reject: () => undefined,
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
  threadSettingsRuntime.setUpdateOperation(async (input) => {
    const current =
      service.serializeConversationSnapshot(input.threadId)?.latestThreadSettings ?? null;
    const nextSettings = mergeThreadSettingsPatch({
      patch: input.patch,
      current,
      currentCollaborationMode: current?.collaborationMode ?? null,
    });
    if (threadSettingsRuntime.remoteUpdateSupport() === "unsupported") {
      return nextSettings;
    }
    const client = Reflect.get(service as object, "client") as {
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    try {
      await client.request(
        "thread/settings/update",
        buildThreadSettingsUpdateParams({
          threadId: input.threadId,
          patch: input.patch,
          nextSettings,
        }),
      );
      threadSettingsRuntime.recordRemoteUpdateSupported();
    } catch (error) {
      if (error instanceof CodexRpcError) {
        const message = error.message.toLowerCase();
        if (message.includes("thread") && message.includes("not found")) {
          return nextSettings;
        }
        if (
          error.code === -32601 ||
          message.includes("method not found") ||
          message.includes("unknown method") ||
          (message.includes("thread/settings/update") && message.includes("unsupported"))
        ) {
          threadSettingsRuntime.recordRemoteUpdateUnsupported();
          return nextSettings;
        }
      }
      throw error;
    }
    return nextSettings;
  });
  Reflect.set(testService, "getUserInputAutoResolutionSnapshot", () => autoResolution.snapshot());
  testService.shutdown = async () => {
    try {
      activeGoalContinuation.dispose();
      ownerNotificationDrain.dispose();
      sidebarSync.dispose();
      pendingWorktrees.shutdown();
      conversationResume.dispose();
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
  const upsertPlanImplementationRequest =
    internals.upsertPlanImplementationRequest.bind(testService);
  internals.upsertPlanImplementationRequest = (threadId, turnId, planContent, itemCreatedAt) => {
    syncCanonicalFixture(threadId);
    return upsertPlanImplementationRequest(threadId, turnId, planContent, itemCreatedAt);
  };
  return testService;
}

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
});

describe("codex-service edit-last-user-turn and fork-from-turn", () => {
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

describe("codex-service Session Thread launch projections", () => {
  test("persists the exact bounded prompt fallback when generated title metadata is empty", async () => {
    const service = createService();
    const appliedTitles: string[] = [];
    const requests: Array<{ method: string; params: unknown }> = [];
    const serviceInternals = service as unknown as {
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
    const titlePersistence = Reflect.get(
      service as object,
      "threadTitlePersistence",
    ) as TestCodexThreadTitlePersistence;
    const setTitle = titlePersistence.set.bind(titlePersistence);
    serviceInternals.hasThreadTitle = () => false;
    serviceInternals.generateThreadTitleForPrompt = async () => null;
    titlePersistence.set = async (input) => {
      appliedTitles.push(input.name);
      return await setTitle(input);
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
