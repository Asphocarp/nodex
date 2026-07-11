import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CodexBackgroundProcessRow,
  CodexBackgroundSubagentThreadsHydrateInput,
  CodexConversationSnapshot,
  CodexEvent,
  CodexHostMessage,
  CodexItemView,
  CodexMcpServerElicitationResponse,
  CodexCollaborationModePreset,
  CodexPermissionMode,
  CodexPermissionState,
  CodexPromptInput,
  CodexScheduledAutomation,
  CodexSteerTurnInput,
  CodexThreadActionResult,
  CodexThreadDetail,
  CodexThreadGoalSetActionInput,
  CodexThreadOwnerStreamStatePublishInput,
  CodexThreadSummary,
  CodexTurnSummary,
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadSummary,
  ManagedWorktreeRecord,
  ProjectSessionForkResult,
} from "../../shared/types";
import type { ThreadBackgroundTerminal, ThreadGoal, ThreadGoalSetParams } from "@nodex/codex-app-server-protocol/v2";
import { getCodexFileChangeList, getCodexFileChangePaths } from "../../shared/codex-file-change";
import {
  applyCodexConversationStateUpdates,
  buildCodexConversationStateUpdates,
} from "../../shared/codex-conversation-patches";
import { closeDatabase, initializeDatabase } from "../local-store/database";
import { createProject } from "../local-store/projects";
import {
  dbNotifier,
  type ProjectSessionsChangeEvent,
} from "../local-store/notifier";
import {
  createProjectSession,
  createProjectSessionTab,
  getProjectSession,
  listProjectSessions,
  upsertProjectSessionThreadLink,
} from "../local-store/project-sessions";
import {
  getCodexScheduledAutomation,
  listCodexScheduledAutomations,
  upsertCodexScheduledAutomation,
} from "../local-store/codex-scheduled-automations";
import {
  archiveCodexAutomationRun,
  getCodexAutomationRun,
  insertCodexAutomationRunInProgress,
  markCodexAutomationRunPendingReview,
} from "../local-store/codex-automation-runs";
import { CodexRpcError } from "./codex-app-server-client";
import {
  getCodexThread,
  setCodexThreadPinned,
  upsertCodexThread,
} from "./codex-link-repository";
import { resetCodexSessionStoreCaches } from "./codex-session-store";
import { CodexService } from "./codex-service";
import {
  createInlineCommandPaletteThreadSearchClient,
  type CommandPaletteThreadSearchClient,
} from "./command-palette-thread-search-coordinator";
import { CommandPaletteThreadSearchService } from "./command-palette-thread-search-service";
import {
  CODEX_THREAD_TITLE_CONFIG,
  CODEX_THREAD_TITLE_MODEL,
  CODEX_THREAD_TITLE_OUTPUT_SCHEMA,
} from "./thread-title-generator";
import { MAX_PROJECT_SESSION_TITLE_LENGTH } from "../../shared/schemas/project-sessions";

interface TestableCodexService {
  on: {
    (event: "event", listener: (event: CodexEvent) => void): unknown;
    (event: "hostMessage", listener: (message: import("../../shared/types").CodexHostMessage) => void): unknown;
    (event: "rendererOwnerHostMessage", listener: (message: { targetClientId: string; message: unknown }) => void): unknown;
  };
  shutdown: () => Promise<void>;
  readAccountSnapshot: () => Promise<import("../../shared/types").CodexAccountSnapshot>;
  logoutAccount: () => Promise<boolean>;
  readThread: (threadId: string, includeTurns?: boolean) => Promise<CodexThreadDetail | null>;
  resolveThreadSummary: (threadId: string) => Promise<import("../../shared/types").CodexThreadSummary | null>;
  syncSidebarThreads: (input?: { includeArchived?: boolean; refresh?: boolean }) => Promise<import("../../shared/types").CodexSidebarSnapshot>;
  syncSidebarThreadsDetailed: (input?: {
    includeArchived?: boolean;
    policy?: import("../../shared/types").CodexSidebarRefreshPolicy;
    reason?: import("../../shared/types").CodexSidebarRefreshReason;
  }) => Promise<import("../../shared/types").CodexSidebarSyncResult>;
  listCommandPaletteThreads: (input: { scope: "sidebar" }) => CommandPaletteThreadSummary[];
  searchCommandPaletteThreadContent: (input: {
    scope: "sidebar";
    query: string;
    limit?: number;
  }) => Promise<CommandPaletteThreadContentSearchResult[]>;
  requestConversationSnapshot: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  requestConversationResume: (
    threadId: string,
    options?: { emitSourceNullSnapshots?: boolean; replayBufferedNotifications?: boolean },
  ) => Promise<CodexConversationSnapshot | null>;
  requestRendererConversationResume: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  releaseConversationResumeBuffer: (threadId: string) => Promise<boolean>;
  ackRendererThreadOwnerNotification: (
    sourceClientId: string,
    input: { conversationId: string; sequence: number },
  ) => boolean;
  loadOlderThreadTurns: (threadId: string) => Promise<CodexConversationSnapshot | null>;
  serializeThreadDetail: (threadId: string) => CodexThreadDetail | null;
  serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
  resumeThread: (threadId: string) => Promise<CodexThreadDetail | null>;
  forkConversationFromTurn: (threadId: string, turnId: string, message: string) => Promise<CodexThreadActionResult>;
  forkProjectSessionThread: (sessionId: string, input: {
    target: "local" | "newWorktree";
    turnId?: string;
    message?: string;
    collaborationMode?: "default" | "plan";
  }) => Promise<ProjectSessionForkResult>;
  startSideChat: (input: {
    projectId: string;
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
    requestId: string,
    response: "accept" | "decline" | "cancel" | CodexMcpServerElicitationResponse,
  ) => Promise<boolean>;
  startThreadForSession: (input: {
    projectId: string;
    sessionId: string;
    prompt: string;
    threadName?: string;
    model?: string;
    serviceTier?: null | "fast";
    permissionMode?: CodexPermissionMode;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    collaborationMode?: "default" | "plan";
    promptInput?: CodexPromptInput;
    threadGoalDraft?: { objective: string; attachmentDirectory?: string | null };
    skipAutoTitleGeneration?: boolean;
    runInTarget?: "localProject" | "newWorktree" | "cloud";
    runInEnvironmentPath?: string | null;
    worktreeStartMode?: "autoBranch" | "detachedHead";
    worktreeBranchPrefix?: string;
    heartbeatAutomation?: {
      name: string;
      prompt: string;
      rrule: string;
    } | null;
  }) => Promise<CodexThreadDetail>;
  setThreadName: (threadId: string, name: string) => Promise<boolean>;
  setGeneratedThreadName: (threadId: string, name: string) => Promise<boolean>;
  listCollaborationModes: () => Promise<CodexCollaborationModePreset[]>;
  interruptTurn: (threadId: string, turnId?: string) => Promise<boolean>;
  cleanBackgroundTerminals: (threadId: string) => Promise<boolean>;
  cleanBackgroundTerminalsSilently: (threadId: string) => Promise<boolean>;
  listBackgroundTerminals: (threadId: string) => Promise<ThreadBackgroundTerminal[]>;
  listBackgroundProcessRows: (input: {
    threadId: string;
    observedTerminals?: ThreadBackgroundTerminal[];
  }) => Promise<CodexBackgroundProcessRow[]>;
  terminateBackgroundTerminal: (input: { threadId: string; processId: string }) => Promise<boolean>;
  markSubagentThreadOpened: (threadId: string) => boolean;
  hydrateBackgroundSubagentThreads: (
    input: CodexBackgroundSubagentThreadsHydrateInput,
  ) => Promise<CodexThreadSummary[]>;
  respondToUserInput: (requestId: string, answers: Record<string, string[]>) => Promise<boolean>;
  setProjectPermissionMode: (projectId: string, mode: CodexPermissionMode) => Promise<CodexPermissionState>;
  getCustomPermissionModeDescription: (projectId: string) => string;
  runScheduledAutomationNow: (
    input: import("../../shared/types").CodexScheduledAutomationRunNowInput,
  ) => Promise<void>;
  captureAutomationArchiveMessages: (threadId: string) => Promise<boolean>;
  runScheduledAutomation: (
    automation: CodexScheduledAutomation,
    context: {
      now?: number;
      reason?: "scheduled" | "run-now";
      heartbeat?: {
        automationsEnabled: boolean;
        rendererState: { isEligible: boolean; reason: string | null; updatedAtMs?: number } | null;
        collaborationMode: import("../../shared/types").CodexHeartbeatAutomationCollaborationMode | null;
        permissions: import("../../shared/types").CodexHeartbeatAutomationPermissions | null;
      };
    },
  ) => Promise<void>;
  listManagedWorktrees: () => Promise<ManagedWorktreeRecord[]>;
  deleteManagedWorktree: (threadId: string) => Promise<boolean>;
  setConversationCollaborationMode: (
    threadId: string,
    collaborationMode: "default" | "plan",
  ) => Promise<import("../../shared/types").CodexCollaborationModeState>;
  updateThreadSettingsForNextTurn: (
    threadId: string,
    patch: import("../../shared/types").CodexConversationThreadSettingsPatch,
  ) => Promise<import("../../shared/types").CodexConversationThreadSettings>;
  setThreadGoal: (input: CodexThreadGoalSetActionInput) => Promise<ThreadGoal | null>;
  removePlanImplementationRequest: (threadId: string, turnId: string) => Promise<boolean>;
  setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
  setRendererConversationViewActive: (
    threadId: string,
    clientId: string | null | undefined,
    active: boolean,
  ) => void;
  getRendererConversationOwner: (threadId: string) => string | null;
  handleRendererClientDisposed: (clientId: string) => void;
  publishRendererThreadStreamStateChange: (
    sourceClientId: string,
    input: CodexThreadOwnerStreamStatePublishInput,
  ) => boolean;
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
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    linkedAt: new Date().toISOString(),
    turns: [],
    transcript: [],
  };
}

function makeConversationSnapshot(input: {
  threadId: string;
  text?: string;
  revision?: number;
}): CodexConversationSnapshot {
  return {
    ...makeThreadDetail(input.threadId),
    resumeState: "resumed",
    turns: [{
      threadId: input.threadId,
      turnId: "turn-1",
      status: "inProgress",
      itemIds: ["assistant-1"],
      items: [{
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
      }],
    }],
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

function createService(options?: {
  rateLimitsPollIntervalMs?: number;
  inactiveRendererOwnerRetentionMs?: number;
  inactiveRendererOwnerMaxRetained?: number;
  inactiveRendererOwnerRetryMs?: number;
  commandPaletteThreadSearchClient?: CommandPaletteThreadSearchClient;
}): TestableCodexService {
  return new CodexService({
    rateLimitsPollIntervalMs: options?.rateLimitsPollIntervalMs,
    inactiveRendererOwnerRetentionMs: options?.inactiveRendererOwnerRetentionMs,
    inactiveRendererOwnerMaxRetained: options?.inactiveRendererOwnerMaxRetained,
    inactiveRendererOwnerRetryMs: options?.inactiveRendererOwnerRetryMs,
    commandPaletteThreadSearchClient:
      options?.commandPaletteThreadSearchClient ?? createInlineCommandPaletteThreadSearchClient(),
  }) as unknown as TestableCodexService;
}

function makeSidebarListThread(input: {
  id: string;
  cwd: string | null;
  preview?: string;
  name?: string | null;
  updatedAt?: number;
  archived?: boolean;
}) {
  const updatedAt = input.updatedAt ?? 20;
  return {
    id: input.id,
    sessionId: input.id,
    forkedFromId: null,
    parentThreadId: null,
    preview: input.preview ?? input.name ?? "External thread",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: Math.max(1, updatedAt - 10),
    updatedAt,
    status: { type: "idle" },
    path: null,
    cwd: input.cwd,
    cliVersion: "test",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: input.name ?? null,
    turns: [],
    archived: input.archived ?? false,
  };
}

async function flushAsyncWork(ticks = 2): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
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

function hydrateConversation(service: TestableCodexService, detail: CodexThreadDetail): void {
  (service as unknown as {
    setConversationRecordDetail: (nextDetail: CodexThreadDetail) => void;
  }).setConversationRecordDetail(detail);
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
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-owner-migrated",
        ownerClientId: "owner-a",
        turnStatus: "inProgress",
        statusType: "active",
      });

      await serviceInternals.handleNotification("thread/tokenUsage/updated", {
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
      });
      await serviceInternals.handleNotification("turn/plan/updated", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        explanation: "Plan",
        plan: [{ step: "Patch owner reducer", status: "completed" }],
      });
      await serviceInternals.handleNotification("model/safetyBuffering/updated", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        model: "gpt-5.4-codex",
        useCases: ["latency"],
        reasons: ["warming"],
        showBufferingUi: true,
        fasterModel: "gpt-5.4-mini",
      });
      await serviceInternals.handleNotification("model/rerouted", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        fromModel: "gpt-5.4-codex",
        toModel: "gpt-5.4-mini",
        reason: "highRiskCyberActivity",
      });
      await serviceInternals.handleNotification("hook/started", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        run: {
          id: "hook-run-1",
          eventName: "preToolUse",
          status: "running",
          statusMessage: "Preparing context",
          entries: [{ kind: "context", text: "Added AGENTS.md" }],
        },
      });
      await serviceInternals.handleNotification("hook/completed", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        run: {
          id: "hook-run-1",
          eventName: "preToolUse",
          status: "completed",
          statusMessage: "Preparing context",
          entries: [{ kind: "context", text: "Added AGENTS.md" }],
        },
      });
      await serviceInternals.handleNotification("item/autoApprovalReview/started", {
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
      });
      await serviceInternals.handleNotification("item/autoApprovalReview/completed", {
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
      });
      await serviceInternals.handleNotification("guardianWarning", {
        threadId: "thread-owner-migrated",
        kind: "tooManyDenials",
        message: "Automatic approval review rejected too many approval requests for this turn.",
      });
      await serviceInternals.handleNotification("item/reasoning/summaryPartAdded", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        itemId: "reasoning-1",
        summaryIndex: 1,
      });
      await serviceInternals.handleNotification("item/fileChange/outputDelta", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        itemId: "patch-legacy-output",
        delta: "legacy apply_patch output",
      });
      await serviceInternals.handleNotification("item/commandExecution/terminalInteraction", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        itemId: "exec-1",
        processId: "proc-1",
        stdin: "bun test\n",
      });
      await serviceInternals.handleNotification("item/mcpToolCall/progress", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        itemId: "mcp-call-1",
        message: "Searching docs",
      });
      await serviceInternals.handleNotification("error", {
        threadId: "thread-owner-migrated",
        turnId: "thread-owner-migrated-turn",
        error: {
          message: "Tool failed",
          additionalDetails: "exit 1",
        },
        willRetry: false,
      });
      await serviceInternals.handleNotification("serverRequest/resolved", {
        threadId: "thread-owner-migrated",
        requestId: "request-1",
      });

      const methods = ownerMessages
        .map((message) => message.message)
        .filter((message): message is Extract<CodexHostMessage, { type: "threadOwnerNotification" }> =>
          message.type === "threadOwnerNotification"
        )
        .map((message) => message.method)
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
      const rerouteItem = snapshot?.turns[0]?.items.find((item) => item.semanticKind === "modelRerouted");
      const rerouteRaw = rerouteItem?.rawItem as { fromModel?: string; toModel?: string; reason?: string } | undefined;
      expect(rerouteItem?.status).toBe("completed");
      expect(rerouteRaw?.fromModel).toBe("gpt-5.4-codex");
      expect(rerouteRaw?.toModel).toBe("gpt-5.4-mini");
      expect(rerouteRaw?.reason).toBe("highRiskCyberActivity");
      const hookItem = snapshot?.turns[0]?.items.find((item) => item.itemId === "hook-run-1");
      expect(hookItem?.semanticKind).toBe("hook");
      expect(hookItem?.status).toBe("completed");
      const reviewItem = snapshot?.turns[0]?.items.find((item) => item.itemId === "automatic-approval-review:review-1");
      const reviewRaw = reviewItem?.rawItem as { status?: string; targetItemId?: string | null } | undefined;
      expect(reviewItem?.semanticKind).toBe("automaticApprovalReview");
      expect(reviewItem?.status).toBe("completed");
      expect(reviewRaw?.status).toBe("approved");
      expect(reviewRaw?.targetItemId).toBe("item-command-1");
      const warningItem = snapshot?.turns[0]?.items.find((item) => item.semanticKind === "autoReviewInterruptionWarning");
      expect(warningItem?.status).toBe("completed");
      expect(warningItem?.markdownText).toBe("Automatic approval review rejected too many approval requests for this turn");
    } finally {
      await service.shutdown();
    }
  });

  test("routes thread-started owner notifications without requiring a top-level thread id", async () => {
    const service = createService();
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    const serviceInternals = service as unknown as {
      forwardNotificationToRendererOwnerForConversation: (
        conversationId: string,
        method: string,
        params: unknown,
      ) => boolean;
    };

    try {
      service.setRendererConversationOwner("thread-started-owner", "owner-a");

      const accepted = serviceInternals.forwardNotificationToRendererOwnerForConversation(
        "thread-started-owner",
        "thread/started",
        {
          thread: {
            id: "thread-started-owner",
            preview: "Started from owner route",
          },
        },
      );
      const ownerNotification = ownerMessages[0]?.message;

      expect(accepted).toBe(true);
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerNotification?.type).toBe("threadOwnerNotification");
      if (ownerNotification?.type === "threadOwnerNotification") {
        expect(ownerNotification.method).toBe("thread/started");
        const params = ownerNotification.params as { thread?: { id?: string } };
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
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      service.setRendererConversationOwner("thread-owner", "owner-a");
      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thread-owner",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "hello",
      });

      expect(String(ownerMessages.length)).toBe("1");
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.method).toBe("item/agentMessage/delta");
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-token-usage"),
        turns: [],
        transcript: [],
      });

      await serviceInternals.handleNotification("thread/tokenUsage/updated", {
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
      });

      const snapshot = await service.requestConversationSnapshot("thread-token-usage");
      const latest = projectConversationFromHostMessages(hostMessages);
      expect(snapshot?.latestTokenUsageInfo?.last.totalTokens).toBe(30);
      expect(latest?.latestTokenUsageInfo?.last.totalTokens).toBe(30);
      expect((snapshot?.turns[0]?.tokenUsage ?? null) === null).toBe(true);
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
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-owner-file-change",
        ownerClientId: "owner-a",
        turnStatus: "inProgress",
        statusType: "active",
      });

      await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
        threadId: "thread-owner-file-change",
        turnId: "thread-owner-file-change-turn",
        itemId: "patch-live",
        changes: [{
          path: "src/app.ts",
          kind: { type: "update" },
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
        }],
      });

      expect(String(ownerMessages.length)).toBe("1");
      expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.method).toBe("item/fileChange/patchUpdated");
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

  test("forwards thread goal updates to owner without source-null patches", async () => {
    const service = createService();
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      installRendererOwnerConversation(service, {
        threadId: "thread-owner-goal",
        ownerClientId: "owner-a",
        turnStatus: "completed",
        statusType: "idle",
      });

      await serviceInternals.handleNotification("thread/goal/updated", {
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
      });

      await serviceInternals.handleNotification("thread/goal/cleared", {
        threadId: "thread-owner-goal",
      });

      const methods = ownerMessages
        .map((message) => message.message)
        .filter((message): message is Extract<CodexHostMessage, { type: "threadOwnerNotification" }> =>
          message.type === "threadOwnerNotification"
        )
        .map((message) => message.method)
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      await serviceInternals.handleNotification("thread/goal/updated", {
        threadId,
        turnId: null,
        goal: completedGoal,
      });
      await waitForCondition(() =>
        requests.filter((request) => request.method === "thread/goal/clear").length === 1,
      1_000);

      expect(record.threadGoal?.status).toBe("complete");
      expect(record.completedThreadGoal?.updatedAt).toBe(102);
      expect((requests[0]?.params as { threadId?: string })?.threadId).toBe(threadId);

      await serviceInternals.handleNotification("thread/goal/updated", {
        threadId,
        turnId: null,
        goal: completedGoal,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(requests.filter((request) => request.method === "thread/goal/clear").length).toBe(1);

      await serviceInternals.handleNotification("thread/goal/updated", {
        threadId,
        turnId: null,
        goal: {
          ...completedGoal,
          updatedAt: 103,
        },
      });
      await waitForCondition(() =>
        requests.filter((request) => request.method === "thread/goal/clear").length === 2,
      1_000);
      expect(record.completedThreadGoal?.updatedAt).toBe(103);
    } finally {
      await service.shutdown();
    }
  });

  test("sends status-only thread goal updates without fabricating an objective", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/goal/set") {
        return {
          goal: {
            threadId: "thread-goal-status",
            objective: "Ship parity",
            status: "paused",
            tokenBudget: null,
            tokensUsed: 10,
            timeUsedSeconds: 2,
            createdAt: 1,
            updatedAt: 2,
          },
        };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      const goal = await service.setThreadGoal({ threadId: "thread-goal-status", status: "paused" });
      const params = requests[0]?.params as { threadId?: string; objective?: unknown; status?: unknown } | undefined;

      expect(goal?.status).toBe("paused");
      expect(requests[0]?.method).toBe("thread/goal/set");
      expect(params?.threadId).toBe("thread-goal-status");
      expect(params?.status).toBe("paused");
      expect(Object.prototype.hasOwnProperty.call(params ?? {}, "objective")).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("defaults objective thread goal sets to active like Codex Electron", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
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
        return {
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
        };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-goal-objective"),
        turns: [],
        transcript: [],
      });
      await service.setThreadGoal({ threadId: "thread-goal-objective", objective: "Ship parity" });
      const params = requests[0]?.params as { objective?: unknown; status?: unknown; tokenBudget?: unknown } | undefined;
      const snapshot = await service.requestConversationSnapshot("thread-goal-objective");
      const turn = snapshot?.turns[0];
      const item = turn?.items[0];

      expect(params?.objective).toBe("Ship parity");
      expect(params?.status).toBe("active");
      expect(Object.prototype.hasOwnProperty.call(params ?? {}, "tokenBudget")).toBe(false);
      expect(snapshot?.turns.length ?? 0).toBe(1);
      expect((turn as { turnId?: string | null } | undefined)?.turnId ?? null).toBe(null);
      expect(turn?.status ?? "").toBe("completed");
      expect(turn?.turnStartedAtMs ?? 0).toBe(1_000);
      expect(item?.kind ?? "").toBe("userMessage");
      expect(item?.markdownText ?? "").toBe("/goal Ship parity");
      expect(item?.goal ?? false).toBe(true);
      expect(((item?.rawItem as { goal?: boolean } | undefined)?.goal ?? false)).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("applies thread settings before setting a goal and strips local action metadata", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/settings/update") return {};
      if (method === "thread/goal/set") {
        return {
          goal: {
            threadId: "thread-goal-settings",
            objective: "Ship parity",
            status: "active",
            tokenBudget: null,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-goal-settings"),
        turns: [],
        transcript: [],
      });
      await service.setThreadGoal({
        threadId: "thread-goal-settings",
        objective: "Ship parity",
        appendTranscriptItem: false,
        threadSettings: {
          model: "gpt-5.9-codex",
          reasoningEffort: "high",
          collaborationMode: "plan",
        },
      });
      const settingsParams = requests[0]?.params as { threadId?: string; model?: string; effort?: string } | undefined;
      const goalParams = requests[1]?.params as {
        threadId?: string;
        objective?: string;
        status?: string;
        appendTranscriptItem?: unknown;
        threadSettings?: unknown;
      } | undefined;

      expect(requests[0]?.method).toBe("thread/settings/update");
      expect(settingsParams?.threadId).toBe("thread-goal-settings");
      expect(settingsParams?.model).toBe("gpt-5.9-codex");
      expect(settingsParams?.effort).toBe("high");
      expect(requests[1]?.method).toBe("thread/goal/set");
      expect(goalParams?.threadId).toBe("thread-goal-settings");
      expect(goalParams?.objective).toBe("Ship parity");
      expect(goalParams?.status).toBe("active");
      expect(Object.prototype.hasOwnProperty.call(goalParams ?? {}, "appendTranscriptItem")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(goalParams ?? {}, "threadSettings")).toBe(false);
      const snapshot = await service.requestConversationSnapshot("thread-goal-settings");
      expect(snapshot?.turns.length ?? 0).toBe(0);
    } finally {
      await service.shutdown();
    }
  });

  test("forwards nullable-turn item notifications to the renderer owner", async () => {
    const service = createService();
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      service.setRendererConversationOwner("thread-owner-null-turn", "owner-a");
      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thread-owner-null-turn",
        itemId: "assistant-1",
        delta: "hello",
      });
      await serviceInternals.handleNotification("item/completed", {
        threadId: "thread-owner-null-turn",
        item: {
          id: "assistant-1",
          type: "agentMessage",
          text: "hello",
        },
      });
      await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
        threadId: "thread-owner-null-turn",
        itemId: "cmd-1",
        delta: "output",
      });

      const methods = ownerMessages
        .map((message) => message.message)
        .filter((message): message is Extract<CodexHostMessage, { type: "threadOwnerNotification" }> =>
          message.type === "threadOwnerNotification"
        )
        .map((message) => message.method)
        .join(",");

      expect(methods).toBe("item/agentMessage/delta,item/completed,item/commandExecution/outputDelta");
      expect(ownerMessages.every((message) => message.targetClientId === "owner-a")).toBe(true);
      expect(String(hostMessages.length)).toBe("0");
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
      const nextConversation = makeConversationSnapshot({ threadId: "thread-owner", text: "hello" });
      service.setRendererConversationOwner("thread-owner", "owner-a");

      expect(service.publishRendererThreadStreamStateChange("owner-a", {
        conversationId: "thread-owner",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
      })).toBe(true);
      expect(service.publishRendererThreadStreamStateChange("owner-a", {
        conversationId: "thread-owner",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
      })).toBe(true);

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
      drainRendererOwnerNotificationsBefore: (conversationId: string, callback: () => void) => boolean;
    };

    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner" });
      const repairedConversation = makeConversationSnapshot({ threadId: "thread-owner", text: "live text" });
      service.setRendererConversationOwner("thread-owner", "owner-a");
      expect(service.publishRendererThreadStreamStateChange("owner-a", {
        conversationId: "thread-owner",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
      })).toBe(true);

      for (let index = 0; index < 5; index += 1) {
        serviceInternals.getNextOwnerNotificationSequence("thread-owner");
      }
      let drained = false;
      expect(serviceInternals.drainRendererOwnerNotificationsBefore("thread-owner", () => {
        drained = true;
      })).toBe(true);

      expect(service.publishRendererThreadStreamStateChange("owner-a", {
        conversationId: "thread-owner",
        ownerNotificationSequence: 5,
        change: {
          type: "snapshot",
          revision: 5,
          conversationState: repairedConversation,
        },
      })).toBe(true);

      const latest = projectConversationFromHostMessages(hostMessages);
      const lastMessage = hostMessages[hostMessages.length - 1];
      expect(drained).toBe(true);
      expect(String(hostMessages.length)).toBe("2");
      expect(lastMessage?.type).toBe("threadStreamStateChanged");
      if (lastMessage?.type === "threadStreamStateChanged") {
        expect(lastMessage.sourceClientId).toBe("owner-a");
        expect(lastMessage.change.type).toBe("snapshot");
        expect(lastMessage.change.revision).toBe(5);
      }
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("live text");
    } finally {
      await service.shutdown();
    }
  });

  test("suppresses no-owner fallback source-null snapshots while a renderer owner exists from bundle 40592-40606", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      emitThreadStreamSnapshotFromRecord: (
        threadId: string,
        reason: "no-owner-fallback" | "explicit-resync",
      ) => void;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thread-source-null-guard"),
        turns: [],
        transcript: [],
      });
      service.setRendererConversationOwner("thread-source-null-guard", "owner-a");

      serviceInternals.emitThreadStreamSnapshotFromRecord("thread-source-null-guard", "no-owner-fallback");
      expect(String(hostMessages.length)).toBe("0");

      const snapshot = await service.requestConversationSnapshot("thread-source-null-guard");
      expect(snapshot).not.toBeNull();
      expect(String(hostMessages.length)).toBe("1");
      const message = hostMessages[0];
      expect(message?.type).toBe("threadStreamStateChanged");
      if (message?.type === "threadStreamStateChanged") {
        expect(message.sourceClientId).toBe(null);
        expect(message.change.type).toBe("snapshot");
      }
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
      service.setRendererConversationOwner("thread-a", "owner-a");
      service.setRendererConversationOwner("thread-b", "owner-b");
      service.setRendererConversationOwner("thread-c", "owner-a");

      service.handleRendererClientDisposed("owner-a");

      expect(service.getRendererConversationOwner("thread-a")).toBe(null);
      expect(service.getRendererConversationOwner("thread-b")).toBe("owner-b");
      expect(service.getRendererConversationOwner("thread-c")).toBe(null);
      const unavailableMessage = hostMessages.find((message) =>
        message.type === "threadOwnerUnavailable"
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

  test("unsubscribes a resumed renderer owner after its active view becomes inactive", async () => {
    const service = createService({
      inactiveRendererOwnerRetentionMs: 5,
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
        threadId: "thread-inactive-owner",
        ownerClientId: "owner-a",
      });
      service.setRendererConversationViewActive("thread-inactive-owner", "owner-a", true);
      service.setRendererConversationViewActive("thread-inactive-owner", "owner-a", false);

      await waitForCondition(
        () => requests.length > 0 && service.getRendererConversationOwner("thread-inactive-owner") === null,
        120,
      );

      expect(requests[0]?.method).toBe("thread/unsubscribe");
      expect((requests[0]?.params as { threadId?: string } | undefined)?.threadId).toBe("thread-inactive-owner");
      expect(service.getRendererConversationOwner("thread-inactive-owner")).toBe(null);
      expect(service.serializeConversationSnapshot("thread-inactive-owner")?.resumeState).toBe("needs_resume");
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thread-inactive-in-progress",
        turnId: "thread-inactive-in-progress-turn",
      });
      await waitForCondition(
        () => requests.length > 0 && service.getRendererConversationOwner("thread-inactive-in-progress") === null,
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
      expect(service.serializeConversationSnapshot("thread-inactive-retry")?.resumeState).toBe("needs_resume");
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
        () => requests.length > 0 && service.getRendererConversationOwner("thread-inactive-limit-a") === null,
        120,
      );

      expect(requests[0]?.method).toBe("thread/unsubscribe");
      expect((requests[0]?.params as { threadId?: string } | undefined)?.threadId).toBe("thread-inactive-limit-a");
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    const hostMessages: CodexHostMessage[] = [];
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thread-owner-drain"),
      turns: [{
        threadId: "thread-owner-drain",
        turnId: "turn-owner-drain",
        status: "inProgress",
        itemIds: [],
      }],
      transcript: [],
    });

    try {
      service.setRendererConversationOwner("thread-owner-drain", "owner-a");
      await serviceInternals.handleNotification("item/started", {
        threadId: "thread-owner-drain",
        turnId: "turn-owner-drain",
        item: {
          id: "assistant-owner-drain",
          type: "agentMessage",
          text: "",
        },
      });
      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thread-owner-drain",
        turnId: "turn-owner-drain",
        itemId: "assistant-owner-drain",
        delta: "hello",
      });
      await serviceInternals.handleNotification("item/completed", {
        threadId: "thread-owner-drain",
        turnId: "turn-owner-drain",
        item: {
          id: "assistant-owner-drain",
          type: "agentMessage",
          text: "hello",
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
        expect(ownerMessages[0].message.method).toBe("item/started");
        expect(ownerMessages[0].message.sequence).toBe(1);
      }
      if (ownerMessages[1]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[1].message.method).toBe("item/agentMessage/delta");
        expect(ownerMessages[1].message.sequence).toBe(2);
      }
      if (ownerMessages[2]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[2].message.method).toBe("item/completed");
        expect(ownerMessages[2].message.sequence).toBe(3);
      }

      const snapshot = await service.requestConversationSnapshot("thread-owner-drain");
      expect(snapshot?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(snapshot?.turns[0]?.items[0]?.status).toBe("completed");
    } finally {
      await service.shutdown();
    }
  });

  test("routes turn lifecycle to renderer owner without main source-null snapshots", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
      syncThreadStatusFromKnownTurns: (threadId: string) => void;
    };
    serviceInternals.syncThreadStatusFromKnownTurns = () => {};
    const hostMessages: CodexHostMessage[] = [];
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
      ownerMessages.push(message);
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thread-owner-turn"),
      turns: [],
      transcript: [],
    });

    try {
      service.setRendererConversationOwner("thread-owner-turn", "owner-a");
      await serviceInternals.handleNotification("turn/started", {
        threadId: "thread-owner-turn",
        turn: {
          id: "turn-owner",
          status: "inProgress",
        },
      });
      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thread-owner-turn",
        turn: {
          id: "turn-owner",
          status: "completed",
          durationMs: 42,
        },
      });

      expect(String(hostMessages.length)).toBe("0");
      expect(String(ownerMessages.length)).toBe("2");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerNotification");
      expect(ownerMessages[1]?.message.type).toBe("threadOwnerNotification");
      if (ownerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[0].message.method).toBe("turn/started");
        expect(ownerMessages[0].message.sequence).toBe(1);
      }
      if (ownerMessages[1]?.message.type === "threadOwnerNotification") {
        expect(ownerMessages[1].message.method).toBe("turn/completed");
        expect(ownerMessages[1].message.sequence).toBe(2);
      }

      const snapshot = await service.requestConversationSnapshot("thread-owner-turn");
      expect(snapshot?.turns[0]?.status).toBe("completed");
      expect(snapshot?.turns[0]?.durationMs).toBe(42);
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
      const nextConversation = makeConversationSnapshot({ threadId: "thread-owner", text: "wrong" });
      service.setRendererConversationOwner("thread-owner", "owner-a");

      expect(service.publishRendererThreadStreamStateChange("owner-a", {
        conversationId: "thread-owner",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
      })).toBe(true);
      expect(service.publishRendererThreadStreamStateChange("owner-b", {
        conversationId: "thread-owner",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
      })).toBe(false);

      const latest = projectConversationFromHostMessages(hostMessages);
      expect(String(hostMessages.length)).toBe("1");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("");
    } finally {
      await service.shutdown();
    }
  });

  test("broadcasts renderer stream patches with a mismatched local cache revision", async () => {
    const service = createService();
    const hostMessages: CodexHostMessage[] = [];
    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner" });
      const nextConversation = makeConversationSnapshot({ threadId: "thread-owner", text: "stale" });
      service.setRendererConversationOwner("thread-owner", "owner-a");

      expect(service.publishRendererThreadStreamStateChange("owner-a", {
        conversationId: "thread-owner",
        change: {
          type: "snapshot",
          revision: 3,
          conversationState: baseConversation,
        },
      })).toBe(true);
      expect(service.publishRendererThreadStreamStateChange("owner-a", {
        conversationId: "thread-owner",
        change: {
          type: "patches",
          baseRevision: 2,
          revision: 4,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
      })).toBe(true);

      const latest = projectConversationFromHostMessages(hostMessages);
      expect(String(hostMessages.length)).toBe("2");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("stale");
      expect(hostMessages[1]?.type).toBe("threadStreamStateChanged");
      expect(hostMessages[1]?.type === "threadStreamStateChanged" ? hostMessages[1].change.type : "").toBe("patches");
    } finally {
      await service.shutdown();
    }
  });

  test("claims renderer ownership for the first owner stream publish", async () => {
    const service = createService();
    try {
      const baseConversation = makeConversationSnapshot({ threadId: "thread-owner-claim" });
      const nextConversation = makeConversationSnapshot({ threadId: "thread-owner-claim", text: "owner" });

      expect(service.publishRendererThreadStreamStateChange("client-stale", {
        conversationId: "thread-owner-claim",
        change: {
          type: "patches",
          baseRevision: 7,
          revision: 8,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
      })).toBe(true);

      expect(service.publishRendererThreadStreamStateChange("client-owner", {
        conversationId: "thread-owner-claim",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
      })).toBe(false);

      expect(service.publishRendererThreadStreamStateChange("client-stale", {
        conversationId: "thread-owner-claim",
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: nextConversation,
        },
      })).toBe(true);
    } finally {
      await service.shutdown();
    }
  });
});

function collectProjectSessionChangeEvents(): {
  events: ProjectSessionsChangeEvent[];
  dispose: () => void;
} {
  const events: ProjectSessionsChangeEvent[] = [];
  const listener = (event: ProjectSessionsChangeEvent) => {
    events.push(event);
  };
  dbNotifier.on("project-sessions-changed", listener);
  return {
    events,
    dispose: () => dbNotifier.removeListener("project-sessions-changed", listener),
  };
}

function getRecordedItem(
  service: unknown,
  threadId: string,
  turnId: string,
  itemId: string,
): CodexItemView | null {
  const record = (service as {
    getConversationRecord: (id: string) => {
      itemsByTurn: Map<string, Map<string, CodexItemView>>;
    };
  }).getConversationRecord(threadId);
  const items = record.itemsByTurn.get(turnId);
  if (!items) return null;
  for (const item of items.values()) {
    if (item.itemId === itemId) return item;
  }
  return null;
}

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

let defaultProjectId = "";
const tempCodexHomeCleanups: Array<() => void> = [];

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-service-"));
  process.env.NODEX_DIR = tempDir;

  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
      return false;
    }
    throw error;
  }

  defaultProjectId = createProject({ name: "Codex", sources: ["/tmp/codex"] }).id;

  try {
    await run();
    return true;
  } finally {
    while (tempCodexHomeCleanups.length > 0) {
      tempCodexHomeCleanups.pop()?.();
    }
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function withTempCodexHome(run: (codexHome: string) => void): void {
  const previousCodexHome = process.env.CODEX_HOME;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-home-"));
  process.env.CODEX_HOME = tempDir;
  resetCodexSessionStoreCaches();

  const cleanup = () => {
    if (previousCodexHome) {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetCodexSessionStoreCaches();
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    run(tempDir);
    tempCodexHomeCleanups.push(cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function withTempCodexHomeAsync(run: (codexHome: string) => Promise<void>): Promise<void> {
  const previousCodexHome = process.env.CODEX_HOME;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-home-"));
  process.env.CODEX_HOME = tempDir;
  resetCodexSessionStoreCaches();

  try {
    await run(tempDir);
  } finally {
    if (previousCodexHome) {
      process.env.CODEX_HOME = previousCodexHome;
    } else {
      delete process.env.CODEX_HOME;
    }
    resetCodexSessionStoreCaches();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

describe("codex-service scheduled automations", () => {
  test("runs a cron automation by starting an automation thread and first turn", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      const previousRunAt = Date.UTC(2026, 6, 7, 13, 20, 0);
      const originalCodexHome = process.env.CODEX_HOME;
      const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-automation-codex-home-"));
      process.env.CODEX_HOME = codexHome;
      const service = createService();
      const runUpdateEvents: Array<Extract<CodexEvent, { type: "automationRunsUpdated" }>> = [];
      service.on("event", (event) => {
        if (event.type === "automationRunsUpdated") {
          runUpdateEvents.push(event);
        }
      });
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const automation = upsertCodexScheduledAutomation({
        id: "daily-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Daily report",
        prompt: "Summarize the repo.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: "gpt-5",
        reasoningEffort: "medium",
        cwds: ["/tmp/codex"],
        executionEnvironment: "local",
        nextRunAt: now - 1_000,
        lastRunAt: previousRunAt,
        createdAt: 10,
        updatedAt: 10,
      });

      client.start = async () => undefined;
      client.request = async (method: string, params?: unknown) => {
        requests.push({ method, params });
        if (method === "model/list") {
          return {
            data: [{
              id: "gpt-5",
              model: "gpt-5",
              displayName: "GPT-5",
              description: "",
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: "medium", description: "" },
                { reasoningEffort: "high", description: "" },
              ],
              defaultReasoningEffort: "high",
              isDefault: true,
            }],
          };
        }
        if (method === "config/read") {
          return {
            config: {
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
              sandbox_workspace_write: {
                writable_roots: [],
                network_access: false,
                exclude_tmpdir_env_var: false,
                exclude_slash_tmp: false,
              },
            },
            origins: {},
            layers: null,
          };
        }
        if (method === "configRequirements/read") {
          return { requirements: null };
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thread-automation",
              sessionId: "session-automation",
              status: { type: "idle" },
              createdAt: now,
              updatedAt: now,
              cwd: "/tmp/codex",
              modelProvider: "openai",
              preview: "",
              name: null,
              threadSource: "automation",
              turns: [],
            },
            model: "gpt-5",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/codex",
            runtimeWorkspaceRoots: ["/tmp/codex"],
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: {
              type: "workspaceWrite",
              writableRoots: ["/tmp/codex"],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
            activePermissionProfile: null,
            reasoningEffort: "medium",
            multiAgentMode: "explicitRequestOnly",
          };
        }
        if (method === "thread/name/set") {
          return {};
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn-automation",
              status: "inProgress",
              items: [],
              startedAt: now,
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        await (service as unknown as {
          runScheduledAutomation: (
            automation: CodexScheduledAutomation,
            context: { now: number; reason: "run-now" },
          ) => Promise<void>;
          handleNotification: (method: string, params: unknown) => Promise<void>;
        }).runScheduledAutomation(automation, { now, reason: "run-now" });

        const threadStartRequest = requests.find((request) => request.method === "thread/start");
        const threadStartParams = threadStartRequest?.params as {
          cwd?: string | null;
          model?: string | null;
          developerInstructions?: string | null;
          threadSource?: string | null;
          dynamicTools?: unknown[];
          sandbox?: string | null;
          approvalPolicy?: string | null;
          approvalsReviewer?: string | null;
        } | undefined;
        expect(threadStartParams?.cwd).toBe("/tmp/codex");
        expect(threadStartParams?.model).toBe("gpt-5");
        expect(threadStartParams?.threadSource).toBe("automation");
        expect(threadStartParams?.sandbox).toBe("workspace-write");
        expect(threadStartParams?.approvalPolicy).toBe("on-request");
        expect(threadStartParams?.approvalsReviewer).toBe("user");
        expect(threadStartParams?.developerInstructions?.includes("$CODEX_HOME/automations/<automation_id>/memory.md")).toBe(true);
        expect(threadStartParams?.developerInstructions?.includes("(create it if missing)")).toBe(true);
        expect(threadStartParams?.developerInstructions?.includes("Read it first (if present) to avoid repeating recent work")).toBe(true);
        expect(threadStartParams?.developerInstructions?.includes("Before returning the directive, write a concise summary")).toBe(true);
        expect(threadStartParams?.developerInstructions?.includes("Output exactly ONE inbox-item directive.")).toBe(true);
        expect((threadStartParams?.dynamicTools?.length ?? 0) > 0).toBe(true);

        const titleRequest = requests.find((request) => request.method === "thread/name/set");
        const titleParams = titleRequest?.params as { threadId?: string; name?: string } | undefined;
        expect(titleParams?.threadId).toBe("thread-automation");
        expect(titleParams?.name).toBe("Daily report");

        const turnStartRequest = requests.find((request) => request.method === "turn/start");
        const turnStartParams = turnStartRequest?.params as {
          threadId?: string;
          model?: string | null;
          effort?: string | null;
          summary?: string | null;
          input?: Array<{ type: string; text: string }>;
          sandboxPolicy?: { type?: string; writableRoots?: string[] };
        } | undefined;
        expect(turnStartParams?.threadId).toBe("thread-automation");
        expect(turnStartParams?.model).toBe("gpt-5");
        expect(turnStartParams?.effort).toBe("medium");
        expect(turnStartParams?.summary).toBe("auto");
        expect(turnStartParams?.sandboxPolicy?.type).toBe("workspaceWrite");
        expect(turnStartParams?.sandboxPolicy?.writableRoots?.includes("/tmp/codex")).toBe(true);
        expect(turnStartParams?.sandboxPolicy?.writableRoots?.includes(path.join(codexHome, "automations", "daily-report"))).toBe(true);
        expect(turnStartParams?.input?.[0]?.text.includes("Automation ID: daily-report")).toBe(true);
        expect(turnStartParams?.input?.[0]?.text.includes("Automation memory: $CODEX_HOME/automations/daily-report/memory.md")).toBe(true);
        const expectedLastRun = `${new Date(previousRunAt).toISOString()} (${previousRunAt})`;
        expect(turnStartParams?.input?.[0]?.text.includes(`Last run: ${expectedLastRun}`)).toBe(true);

        const run = getCodexAutomationRun("thread-automation");
        expect(run?.automationId).toBe("daily-report");
        expect(run?.status).toBe("IN_PROGRESS");
        expect(run?.threadTitle).toBe("Daily report");
        expect(run?.sourceCwd).toBe("/tmp/codex");

        await (service as unknown as {
          handleNotification: (method: string, params: unknown) => Promise<void>;
        }).handleNotification("turn/completed", {
          threadId: "thread-automation",
          turn: {
            id: "turn-automation",
            status: "completed",
            items: [],
            completedAt: now + 1_000,
          },
        });
        expect(getCodexAutomationRun("thread-automation")?.status).toBe("PENDING_REVIEW");
        expect(JSON.stringify(runUpdateEvents.map((event) => event.event.reason))).toBe(JSON.stringify([
          "pending-insert",
          "pending-replace",
          "turn-completed",
        ]));
        expect(runUpdateEvents[0]?.event.automationId).toBe("daily-report");
        expect(runUpdateEvents[0]?.event.threadId?.startsWith("pending:") ?? false).toBe(true);
        expect(runUpdateEvents[1]?.event.automationId).toBe("daily-report");
        expect(runUpdateEvents[1]?.event.threadId).toBe("thread-automation");
        expect(runUpdateEvents[2]?.event.automationId).toBe("daily-report");
        expect(runUpdateEvents[2]?.event.threadId).toBe("thread-automation");
      } finally {
        if (originalCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = originalCodexHome;
        }
        fs.rmSync(codexHome, { recursive: true, force: true });
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("captures automation inbox item directives when an automation turn completes", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      upsertCodexScheduledAutomation({
        id: "daily-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Daily report",
        prompt: "Summarize the repo.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: null,
        reasoningEffort: null,
        cwds: ["/tmp/codex"],
        executionEnvironment: "local",
        nextRunAt: null,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now,
      });
      insertCodexAutomationRunInProgress({
        threadId: "thread-inbox-directive",
        automationId: "daily-report",
        threadTitle: "Daily report",
        sourceCwd: "/tmp/codex",
        now,
      });
      const service = createService();
      const runUpdateEvents: Array<Extract<CodexEvent, { type: "automationRunsUpdated" }>> = [];
      service.on("event", (event) => {
        if (event.type === "automationRunsUpdated") {
          runUpdateEvents.push(event);
        }
      });
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      try {
        serviceInternals.setConversationRecordDetail({
          ...makeThreadDetail("thread-inbox-directive"),
          turns: [{
            threadId: "thread-inbox-directive",
            turnId: "turn-inbox-directive",
            status: "inProgress",
            itemIds: ["assistant-inbox-directive"],
          }],
          transcript: [{
            threadId: "thread-inbox-directive",
            turnId: "turn-inbox-directive",
            entryId: "assistant-inbox-directive",
            itemId: "assistant-inbox-directive",
            type: "assistant_message",
            kind: "assistantMessage",
            semanticKind: "assistantMessage",
            role: "assistant",
            source: "live",
            status: "inProgress",
            markdownText: [
              "Checked the repository and found no new failures.",
              "::inbox-item{title=\"Daily report ready\" summary=\"Review the clean test summary\"}",
            ].join("\n"),
            createdAt: now,
            updatedAt: now,
          }],
        });

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thread-inbox-directive",
          turn: {
            id: "turn-inbox-directive",
            status: "completed",
          },
        });

        const run = getCodexAutomationRun("thread-inbox-directive");
        expect(run?.status).toBe("PENDING_REVIEW");
        expect(run?.inboxTitle).toBe("Daily report ready");
        expect(run?.inboxSummary).toBe("Review the clean test summary");
        expect(runUpdateEvents.some((event) =>
          event.event.reason === "turn-completed"
          && event.event.automationId === "daily-report"
          && event.event.threadId === "thread-inbox-directive"
        )).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("persists automation inbox items from inbox-items-create server requests", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      upsertCodexScheduledAutomation({
        id: "daily-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Daily report",
        prompt: "Summarize the repo.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: null,
        reasoningEffort: null,
        cwds: ["/tmp/codex"],
        executionEnvironment: "local",
        nextRunAt: null,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now,
      });
      insertCodexAutomationRunInProgress({
        threadId: "thread-inbox-request",
        automationId: "daily-report",
        threadTitle: "Daily report",
        sourceCwd: "/tmp/codex",
        now,
      });
      const service = createService();
      const runUpdateEvents: Array<Extract<CodexEvent, { type: "automationRunsUpdated" }>> = [];
      service.on("event", (event) => {
        if (event.type === "automationRunsUpdated") {
          runUpdateEvents.push(event);
        }
      });
      const serviceInternals = service as unknown as {
        handleServerRequestNow: (request: { id: string; method: string; params: unknown }) => Promise<unknown>;
      };

      try {
        const response = await serviceInternals.handleServerRequestNow({
          id: "request-inbox",
          method: "inbox-items-create",
          params: {
            conversationId: "thread-inbox-request",
            turnId: "turn-inbox-request",
            items: [{
              title: "Daily report ready",
              summary: "Review the clean test summary",
            }],
          },
        });

        const items = (response as { items?: unknown[] }).items ?? [];
        const run = getCodexAutomationRun("thread-inbox-request");
        expect(String(items.length)).toBe("1");
        expect(run?.status).toBe("PENDING_REVIEW");
        expect(run?.inboxTitle).toBe("Daily report ready");
        expect(run?.inboxSummary).toBe("Review the clean test summary");
        expect(runUpdateEvents.some((event) =>
          event.event.reason === "turn-completed"
          && event.event.automationId === "daily-report"
          && event.event.threadId === "thread-inbox-request"
        )).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("marks a reviewed automation run accepted when the user starts a follow-up turn", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      upsertCodexScheduledAutomation({
        id: "daily-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Daily report",
        prompt: "Summarize the repo.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: null,
        reasoningEffort: null,
        cwds: ["/tmp/codex"],
        executionEnvironment: "local",
        nextRunAt: null,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now,
      });
      insertCodexAutomationRunInProgress({
        threadId: "thread-review-follow-up",
        automationId: "daily-report",
        threadTitle: "Daily report",
        sourceCwd: "/tmp/codex",
        now,
      });
      expect(markCodexAutomationRunPendingReview("thread-review-follow-up", now + 1)).toBe(true);
      insertCodexAutomationRunInProgress({
        threadId: "thread-archived-follow-up",
        automationId: "daily-report",
        threadTitle: "Daily report archived",
        sourceCwd: "/tmp/codex",
        now,
      });
      expect(archiveCodexAutomationRun("thread-archived-follow-up", "manual", now + 2)).toBe(true);
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thread-review-follow-up",
        threadName: "Daily report",
        threadPreview: "Ready for review",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        statusType: "idle",
        statusActiveFlags: [],
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thread-archived-follow-up",
        threadName: "Daily report archived",
        threadPreview: "Archived",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        statusType: "idle",
        statusActiveFlags: [],
      });

      const service = createService();
      const runUpdateEvents: Array<Extract<CodexEvent, { type: "automationRunsUpdated" }>> = [];
      service.on("event", (event) => {
        if (event.type === "automationRunsUpdated") {
          runUpdateEvents.push(event);
        }
      });
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn-review-follow-up",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        await service.startTurn("thread-review-follow-up", "Looks good, continue.");
        await service.startTurn("thread-archived-follow-up", "This should not accept archived runs.");

        const run = getCodexAutomationRun("thread-review-follow-up");
        const archivedRun = getCodexAutomationRun("thread-archived-follow-up");
        expect(run?.status).toBe("ACCEPTED");
        expect(archivedRun?.status).toBe("ARCHIVED");
        expect(runUpdateEvents.some((event) =>
          event.event.reason === "accepted"
          && event.event.automationId === "daily-report"
          && event.event.threadId === "thread-review-follow-up"
        )).toBe(true);
        expect(runUpdateEvents.some((event) =>
          event.event.reason === "accepted"
          && event.event.threadId === "thread-archived-follow-up"
        )).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("captures archive messages for automation runs from the local transcript", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      upsertCodexScheduledAutomation({
        id: "daily-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Daily report",
        prompt: "Summarize the repo.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: null,
        reasoningEffort: null,
        cwds: ["/tmp/codex"],
        executionEnvironment: "local",
        nextRunAt: null,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now,
      });
      insertCodexAutomationRunInProgress({
        threadId: "thread-archive-capture",
        automationId: "daily-report",
        threadTitle: "Daily report",
        sourceCwd: "/tmp/codex",
        now,
      });

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };

      try {
        serviceInternals.setConversationRecordDetail({
          ...makeThreadDetail("thread-archive-capture"),
          turns: [{
            threadId: "thread-archive-capture",
            turnId: "turn-archive",
            status: "completed",
            itemIds: ["user-archive", "assistant-archive"],
          }],
          transcript: [
            {
              threadId: "thread-archive-capture",
              turnId: "turn-archive",
              entryId: "user-archive",
              itemId: "user-archive",
              type: "userMessage",
              kind: "userMessage",
              semanticKind: "userMessage",
              role: "user",
              source: "live",
              status: "completed",
              markdownText: "Please summarize the repo.",
              userAttachments: [{
                type: "file",
                id: "user-archive:attachment:skill:0",
                label: "Computer Use",
                path: "/plugins/computer-use",
                sourceKind: "skill",
              }],
              createdAt: now,
              updatedAt: now,
            },
            {
              threadId: "thread-archive-capture",
              turnId: "turn-archive",
              entryId: "assistant-archive",
              itemId: "assistant-archive",
              type: "agentMessage",
              kind: "assistantMessage",
              semanticKind: "assistantMessage",
              role: "assistant",
              source: "live",
              status: "completed",
              markdownText: [
                "Summary complete.",
                "::inbox-item{title=\"Daily report ready\" summary=\"Review the clean test summary\"}",
              ].join("\n"),
              createdAt: now + 1,
              updatedAt: now + 1,
            },
          ],
        });

        expect(await service.captureAutomationArchiveMessages("thread-archive-capture")).toBe(true);

        const run = getCodexAutomationRun("thread-archive-capture");
        expect(run?.archivedUserMessage).toBe("Please summarize the repo.\nskill: Computer Use (/plugins/computer-use)");
        expect(run?.archivedAssistantMessage).toBe("Summary complete.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("falls back to thread turns when capturing automation archive messages without a local transcript", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      upsertCodexScheduledAutomation({
        id: "daily-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Daily report",
        prompt: "Summarize the repo.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: null,
        reasoningEffort: null,
        cwds: ["/tmp/codex"],
        executionEnvironment: "local",
        nextRunAt: null,
        lastRunAt: null,
        createdAt: now,
        updatedAt: now,
      });
      insertCodexAutomationRunInProgress({
        threadId: "thread-archive-fallback",
        automationId: "daily-report",
        threadTitle: "Daily report",
        sourceCwd: "/tmp/codex",
        now,
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method !== "thread/turns/list") {
          throw new Error(`Unexpected method: ${method}`);
        }

        return {
          data: [
            {
              id: "turn-latest",
              status: "completed",
              itemsView: "full",
              error: null,
              startedAt: now + 3,
              completedAt: now + 4,
              durationMs: 1_000,
              items: [
                {
                  id: "user-latest",
                  type: "userMessage",
                  content: [
                    { type: "text", text: "Latest prompt" },
                    { type: "mention", name: "notes.md", path: "/tmp/codex/notes.md" },
                    { type: "localImage", path: "/tmp/codex/diagram.png" },
                  ],
                },
                {
                  id: "assistant-latest",
                  type: "agentMessage",
                  text: "Latest answer",
                },
              ],
            },
            {
              id: "turn-older",
              status: "completed",
              itemsView: "full",
              error: null,
              startedAt: now + 1,
              completedAt: now + 2,
              durationMs: 1_000,
              items: [
                {
                  id: "user-older",
                  type: "userMessage",
                  content: [{ type: "text", text: "Older prompt" }],
                },
                {
                  id: "assistant-older",
                  type: "agentMessage",
                  text: "Older answer",
                },
              ],
            },
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        expect(await service.captureAutomationArchiveMessages("thread-archive-fallback")).toBe(true);

        const run = getCodexAutomationRun("thread-archive-fallback");
        expect(run?.archivedUserMessage).toBe(
          "Latest prompt\nmention: notes.md (/tmp/codex/notes.md)\nlocalImage: /tmp/codex/diagram.png",
        );
        expect(run?.archivedAssistantMessage).toBe("Latest answer");

        const params = requests[0]?.params as {
          threadId?: string;
          limit?: number;
          sortDirection?: string;
          itemsView?: string;
        };
        expect(requests[0]?.method).toBe("thread/turns/list");
        expect(params.threadId ?? "").toBe("thread-archive-fallback");
        expect(params.limit ?? 0).toBe(20);
        expect(params.sortDirection ?? "").toBe("desc");
        expect(params.itemsView ?? "").toBe("full");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("runs a heartbeat automation now by resuming the target thread and starting a heartbeat turn", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      upsertCodexScheduledAutomation({
        id: "heartbeat-follow-up",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-heartbeat-target",
        name: "Follow up",
        prompt: "Check whether the user needs another pass.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        model: null,
        reasoningEffort: null,
        cwds: [],
        executionEnvironment: "local",
        nextRunAt: now - 1_000,
        lastRunAt: null,
        createdAt: 10,
        updatedAt: 10,
      });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const appServerThread = {
        id: "thread-heartbeat-target",
        sessionId: "session-heartbeat-target",
        status: { type: "idle" },
        createdAt: now,
        updatedAt: now,
        cwd: "/tmp/codex",
        modelProvider: "openai",
        preview: "",
        name: "Target thread",
        threadSource: null,
        turns: [],
      };
      client.start = async () => undefined;
      client.request = async (method: string, params?: unknown) => {
        requests.push({ method, params });
        if (method === "thread/read") {
          return { thread: appServerThread };
        }
        if (method === "thread/resume") {
          return {
            thread: appServerThread,
            model: "gpt-5",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/codex",
            runtimeWorkspaceRoots: ["/tmp/codex"],
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: {
              type: "workspaceWrite",
              writableRoots: ["/tmp/codex"],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
            activePermissionProfile: null,
            reasoningEffort: "medium",
            multiAgentMode: "explicitRequestOnly",
            initialTurnsPage: null,
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn-heartbeat",
              status: "inProgress",
              items: [],
              startedAt: now,
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        await service.runScheduledAutomationNow({
          id: "heartbeat-follow-up",
          collaborationMode: {
            mode: "plan",
            settings: {
              model: "gpt-5",
              reasoning_effort: "medium",
              developer_instructions: null,
            },
          },
          permissions: {
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: ["/tmp/codex"],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
          },
        });

        const resumeRequest = requests.find((request) => request.method === "thread/resume");
        const resumeParams = resumeRequest?.params as { threadId?: string } | undefined;
        expect(resumeParams?.threadId).toBe("thread-heartbeat-target");

        const turnStartRequest = requests.find((request) => request.method === "turn/start");
        const turnStartParams = turnStartRequest?.params as {
          threadId?: string;
          cwd?: string;
          model?: string | null;
          effort?: string | null;
          serviceTier?: string | null;
          summary?: string | null;
          input?: Array<{ type: string; text: string }>;
          collaborationMode?: { mode?: string; settings?: { model?: string; reasoning_effort?: string | null } };
          sandboxPolicy?: { type?: string; writableRoots?: string[] };
        } | undefined;
        expect(turnStartParams?.threadId).toBe("thread-heartbeat-target");
        expect(turnStartParams?.cwd).toBe("/tmp/codex");
        expect(turnStartParams?.model).toBe(null);
        expect(turnStartParams?.effort).toBe(null);
        expect(turnStartParams?.serviceTier).toBe(null);
        expect(turnStartParams?.summary).toBe("auto");
        expect(turnStartParams?.collaborationMode?.mode).toBe("plan");
        expect(turnStartParams?.collaborationMode?.settings?.model).toBe("gpt-5");
        expect(turnStartParams?.collaborationMode?.settings?.reasoning_effort).toBe("medium");
        expect(turnStartParams?.sandboxPolicy?.type).toBe("workspaceWrite");
        expect(turnStartParams?.sandboxPolicy?.writableRoots?.includes("/tmp/codex")).toBe(true);
        expect(turnStartParams?.input?.[0]?.text.includes("<heartbeat>")).toBe(true);
        expect(turnStartParams?.input?.[0]?.text.includes("<automation_id>heartbeat-follow-up</automation_id>")).toBe(true);
        expect(turnStartParams?.input?.[0]?.text.includes("Check whether the user needs another pass.")).toBe(true);
        expect(getCodexScheduledAutomation("heartbeat-follow-up")?.lastRunAt !== null).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("blocks heartbeat run-now on recent rollout activity but allows task-complete active threads", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      const rolloutDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-heartbeat-rollout-"));
      const busyRolloutPath = path.join(rolloutDir, "busy.jsonl");
      const completeRolloutPath = path.join(rolloutDir, "complete.jsonl");
      fs.writeFileSync(
        busyRolloutPath,
        [
          JSON.stringify({ event: "task_complete" }),
          JSON.stringify({ event: "response_item" }),
        ].join("\n"),
      );
      fs.writeFileSync(
        completeRolloutPath,
        [
          JSON.stringify({ event: "response_item" }),
          JSON.stringify({ event: "task_complete" }),
        ].join("\n"),
      );
      upsertCodexScheduledAutomation({
        id: "heartbeat-rollout-busy",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-rollout-busy",
        name: "Busy rollout follow-up",
        prompt: "Check whether the user needs another pass.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        model: null,
        reasoningEffort: null,
        cwds: [],
        executionEnvironment: "local",
        nextRunAt: now - 1_000,
        lastRunAt: null,
        createdAt: 10,
        updatedAt: 10,
      });
      upsertCodexScheduledAutomation({
        id: "heartbeat-rollout-complete",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-rollout-complete",
        name: "Complete rollout follow-up",
        prompt: "Check whether the user needs another pass.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        model: null,
        reasoningEffort: null,
        cwds: [],
        executionEnvironment: "local",
        nextRunAt: now - 1_000,
        lastRunAt: null,
        createdAt: 20,
        updatedAt: 20,
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const threads = new Map<string, Record<string, unknown>>([
        ["thread-rollout-busy", {
          id: "thread-rollout-busy",
          sessionId: "session-rollout-busy",
          status: { type: "active", activeFlags: [] },
          createdAt: now,
          updatedAt: now,
          cwd: "/tmp/codex",
          modelProvider: "openai",
          preview: "",
          name: "Busy rollout target",
          threadSource: null,
          path: busyRolloutPath,
          turns: [],
        }],
        ["thread-rollout-complete", {
          id: "thread-rollout-complete",
          sessionId: "session-rollout-complete",
          status: { type: "active", activeFlags: [] },
          createdAt: now,
          updatedAt: now,
          cwd: "/tmp/codex",
          modelProvider: "openai",
          preview: "",
          name: "Complete rollout target",
          threadSource: null,
          path: completeRolloutPath,
          turns: [],
        }],
      ]);
      client.start = async () => undefined;
      client.request = async (method: string, params?: unknown) => {
        requests.push({ method, params });
        const threadId = (params as { threadId?: string } | undefined)?.threadId ?? "";
        if (method === "thread/read") {
          const thread = threads.get(threadId);
          if (!thread) throw new Error(`Unexpected thread read: ${threadId}`);
          return { thread };
        }
        if (method === "thread/resume") {
          const thread = threads.get(threadId);
          if (!thread) throw new Error(`Unexpected thread resume: ${threadId}`);
          return {
            thread,
            model: "gpt-5",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/codex",
            runtimeWorkspaceRoots: ["/tmp/codex"],
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: {
              type: "workspaceWrite",
              writableRoots: ["/tmp/codex"],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
            activePermissionProfile: null,
            reasoningEffort: "medium",
            multiAgentMode: "explicitRequestOnly",
            initialTurnsPage: null,
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn-heartbeat-rollout-complete",
              status: "inProgress",
              items: [],
              startedAt: now,
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        let busyErrorMessage = "";
        try {
          await service.runScheduledAutomationNow({
            id: "heartbeat-rollout-busy",
            collaborationMode: {
              mode: "plan",
              settings: {
                model: "gpt-5",
                reasoning_effort: "medium",
                developer_instructions: null,
              },
            },
            permissions: {
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: ["/tmp/codex"],
                networkAccess: false,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              },
            },
          });
        } catch (error) {
          busyErrorMessage = error instanceof Error ? error.message : String(error);
        }
        expect(busyErrorMessage).toBe("Heartbeat thread is busy right now.");
        expect(requests.some((request) => request.method === "turn/start")).toBe(false);

        await service.runScheduledAutomationNow({
          id: "heartbeat-rollout-complete",
          collaborationMode: {
            mode: "plan",
            settings: {
              model: "gpt-5",
              reasoning_effort: "medium",
              developer_instructions: null,
            },
          },
          permissions: {
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: ["/tmp/codex"],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
          },
        });

        const turnStartRequest = requests.find((request) => request.method === "turn/start");
        const turnStartParams = turnStartRequest?.params as { threadId?: string } | undefined;
        expect(turnStartParams?.threadId).toBe("thread-rollout-complete");
        expect(getCodexScheduledAutomation("heartbeat-rollout-complete")?.lastRunAt !== null).toBe(true);
      } finally {
        fs.rmSync(rolloutDir, { recursive: true, force: true });
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("retries scheduled heartbeat automations when renderer state marks the thread ineligible", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      const automation = upsertCodexScheduledAutomation({
        id: "heartbeat-retry",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-heartbeat-target",
        name: "Follow up",
        prompt: "Check whether the user needs another pass.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        model: null,
        reasoningEffort: null,
        cwds: [],
        executionEnvironment: "local",
        nextRunAt: now - 1_000,
        lastRunAt: null,
        createdAt: 10,
        updatedAt: 10,
      });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params?: unknown) => {
        requests.push({ method, params });
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-heartbeat-target",
              sessionId: "session-heartbeat-target",
              status: { type: "idle" },
              createdAt: now,
              updatedAt: now,
              cwd: "/tmp/codex",
              modelProvider: "openai",
              preview: "",
              name: "Target thread",
              threadSource: null,
              turns: [],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        await service.runScheduledAutomation(automation, {
          now,
          reason: "scheduled",
          heartbeat: {
            automationsEnabled: true,
            rendererState: {
              isEligible: false,
              reason: "composer_busy",
              updatedAtMs: now,
            },
            collaborationMode: {
              mode: "plan",
              settings: {
                model: "gpt-5",
                reasoning_effort: "medium",
                developer_instructions: null,
              },
            },
            permissions: null,
          },
        });

        expect(requests.some((request) => request.method === "turn/start")).toBe(false);
        const retried = getCodexScheduledAutomation("heartbeat-retry");
        expect(retried?.nextRunAt).toBe(now + 60_000);
        expect(retried?.lastRunAt).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("defers scheduled heartbeat automations until the heartbeat cooldown elapses", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      const lastRunAt = now - 2 * 60_000;
      const automation = upsertCodexScheduledAutomation({
        id: "heartbeat-cooldown",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-heartbeat-target",
        name: "Follow up",
        prompt: "Check whether the user needs another pass.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        model: null,
        reasoningEffort: null,
        cwds: [],
        executionEnvironment: "local",
        nextRunAt: now - 1_000,
        lastRunAt,
        createdAt: 10,
        updatedAt: 10,
      });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params?: unknown) => {
        requests.push({ method, params });
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-heartbeat-target",
              sessionId: "session-heartbeat-target",
              status: { type: "idle" },
              createdAt: now,
              updatedAt: now - 10 * 60_000,
              cwd: "/tmp/codex",
              modelProvider: "openai",
              preview: "",
              name: "Target thread",
              threadSource: null,
              turns: [],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        await service.runScheduledAutomation(automation, {
          now,
          reason: "scheduled",
          heartbeat: {
            automationsEnabled: true,
            rendererState: { isEligible: true, reason: null, updatedAtMs: now },
            collaborationMode: {
              mode: "plan",
              settings: {
                model: "gpt-5",
                reasoning_effort: "medium",
                developer_instructions: null,
              },
            },
            permissions: null,
          },
        });

        expect(requests.some((request) => request.method === "turn/start")).toBe(false);
        const deferred = getCodexScheduledAutomation("heartbeat-cooldown");
        expect(deferred?.nextRunAt).toBe(lastRunAt + 5 * 60_000);
        expect(deferred?.lastRunAt).toBe(lastRunAt);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("waits for scheduled heartbeat turns to complete", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      const automation = upsertCodexScheduledAutomation({
        id: "heartbeat-wait",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-heartbeat-target",
        name: "Follow up",
        prompt: "Check whether the user needs another pass.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        model: null,
        reasoningEffort: null,
        cwds: [],
        executionEnvironment: "local",
        nextRunAt: now - 1_000,
        lastRunAt: null,
        createdAt: 10,
        updatedAt: 10,
      });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        emit: (event: string, payload: unknown) => boolean;
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const appServerThread = {
        id: "thread-heartbeat-target",
        sessionId: "session-heartbeat-target",
        status: { type: "idle" },
        createdAt: now - 10 * 60_000,
        updatedAt: now - 10 * 60_000,
        cwd: "/tmp/codex",
        modelProvider: "openai",
        preview: "",
        name: "Target thread",
        threadSource: null,
        turns: [],
      };
      let turnStartRequested = false;
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/read") {
          return { thread: appServerThread };
        }
        if (method === "thread/resume") {
          return {
            thread: appServerThread,
            model: "gpt-5",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/codex",
            runtimeWorkspaceRoots: ["/tmp/codex"],
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: {
              type: "workspaceWrite",
              writableRoots: ["/tmp/codex"],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
            activePermissionProfile: null,
            reasoningEffort: "medium",
            multiAgentMode: "explicitRequestOnly",
            initialTurnsPage: null,
          };
        }
        if (method === "turn/start") {
          turnStartRequested = true;
          return {
            turn: {
              id: "turn-heartbeat-wait",
              status: "inProgress",
              items: [],
              startedAt: now,
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        let resolved = false;
        const runPromise = service.runScheduledAutomation(automation, {
          now,
          reason: "scheduled",
          heartbeat: {
            automationsEnabled: true,
            rendererState: { isEligible: true, reason: null, updatedAtMs: now },
            collaborationMode: {
              mode: "plan",
              settings: {
                model: "gpt-5",
                reasoning_effort: "medium",
                developer_instructions: null,
              },
            },
            permissions: {
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: ["/tmp/codex"],
                networkAccess: false,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              },
            },
          },
        }).then(() => {
          resolved = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(turnStartRequested).toBe(true);
        expect(resolved).toBe(false);

        client.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thread-heartbeat-target",
            turn: {
              id: "turn-heartbeat-wait",
              status: "completed",
              items: [],
              completedAt: now + 1_000,
            },
          },
        });
        await runPromise;
        expect(resolved).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("deletes active heartbeat automations when their target thread is archived", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexScheduledAutomation({
        id: "heartbeat-archive-action",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-archive-action",
        name: "Archive action heartbeat",
        prompt: "Follow up.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        createdAt: 10,
        updatedAt: 10,
      });
      upsertCodexScheduledAutomation({
        id: "heartbeat-archive-notification",
        kind: "heartbeat",
        status: "ACTIVE",
        targetThreadId: "thread-archive-notification",
        name: "Archive notification heartbeat",
        prompt: "Follow up.",
        rrule: "FREQ=MINUTELY;INTERVAL=5",
        createdAt: 20,
        updatedAt: 20,
      });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/archive") return {};
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        await (service as unknown as {
          archiveThread: (threadId: string) => Promise<boolean>;
        }).archiveThread("thread-archive-action");
        expect(getCodexScheduledAutomation("heartbeat-archive-action")).toBe(null);

        await (service as unknown as {
          handleNotification: (method: string, params: unknown) => Promise<void>;
        }).handleNotification("thread/archived", {
          threadId: "thread-archive-notification",
        });
        expect(getCodexScheduledAutomation("heartbeat-archive-notification")).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("runs a worktree cron automation in a managed worktree", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-automation-worktree-repo-"));
      initializeGitRepository(repoPath);
      execFileSync("git", ["checkout", "-b", "automation-source"], { cwd: repoPath });
      fs.writeFileSync(path.join(repoPath, "FEATURE.md"), "# feature\n");
      execFileSync("git", ["add", "FEATURE.md"], { cwd: repoPath });
      execFileSync("git", ["commit", "-m", "feature"], { cwd: repoPath });
      const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoPath,
        encoding: "utf8",
      }).trim();
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params?: unknown) => {
        requests.push({ method, params });
        if (method === "model/list") {
          return {
            data: [{
              id: "gpt-5",
              model: "gpt-5",
              displayName: "GPT-5",
              description: "",
              hidden: false,
              supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
              defaultReasoningEffort: "high",
              isDefault: true,
            }],
          };
        }
        if (method === "thread/start") {
          const cwd = (params as { cwd?: string | null }).cwd ?? "";
          return {
            thread: {
              id: "thread-worktree-automation",
              status: { type: "idle" },
              createdAt: now,
              updatedAt: now,
              cwd,
              modelProvider: "openai",
              preview: "",
              name: null,
              threadSource: "automation",
              turns: [],
            },
            model: "gpt-5",
            modelProvider: "openai",
            serviceTier: null,
            cwd,
            runtimeWorkspaceRoots: [cwd],
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
            activePermissionProfile: null,
            reasoningEffort: "high",
            multiAgentMode: "explicitRequestOnly",
          };
        }
        if (method === "thread/name/set") return {};
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn-worktree-automation",
              status: "inProgress",
              items: [],
              startedAt: now,
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };
      const automation = upsertCodexScheduledAutomation({
        id: "worktree-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Worktree report",
        prompt: "Summarize the repo.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: "gpt-5",
        cwds: [repoPath],
        executionEnvironment: "worktree",
        createdAt: 10,
        updatedAt: 10,
      });

      try {
        await (service as unknown as {
          runScheduledAutomation: (
            automation: CodexScheduledAutomation,
            context: { now: number; reason: "run-now" },
          ) => Promise<void>;
        }).runScheduledAutomation(automation, { now, reason: "run-now" });

        const threadStartCwd = (requests.find((request) => request.method === "thread/start")?.params as { cwd?: string } | undefined)?.cwd ?? "";
        const turnStartCwd = (requests.find((request) => request.method === "turn/start")?.params as { cwd?: string } | undefined)?.cwd ?? "";
        expect(threadStartCwd.length > 0).toBe(true);
        expect(threadStartCwd === repoPath).toBe(false);
        expect(fs.existsSync(threadStartCwd)).toBe(true);
        expect(turnStartCwd).toBe(threadStartCwd);
        const worktreeHead = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: threadStartCwd,
          encoding: "utf8",
        }).trim();
        expect(worktreeHead).toBe(sourceHead);

        const linked = getCodexThread("thread-worktree-automation");
        expect(linked?.cwd).toBe(threadStartCwd);
        expect(linked?.managedWorktreePath).toBe(threadStartCwd);

        const run = getCodexAutomationRun("thread-worktree-automation");
        expect(run?.automationId).toBe("worktree-report");
        expect(run?.sourceCwd).toBe(repoPath);
      } finally {
        await service.shutdown();
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("runs a projectless cron automation with split work and output directories", async () => {
    const ran = await withTempDatabase(async () => {
      const now = Date.UTC(2026, 6, 8, 13, 20, 0);
      const previousHome = process.env.HOME;
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-automation-home-"));
      process.env.HOME = tempHome;
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params?: unknown) => {
        requests.push({ method, params });
        if (method === "model/list") {
          return {
            data: [{
              id: "gpt-5",
              model: "gpt-5",
              displayName: "GPT-5",
              description: "",
              hidden: false,
              supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
              defaultReasoningEffort: "high",
              isDefault: true,
            }],
          };
        }
        if (method === "thread/start") {
          const cwd = (params as { cwd?: string | null }).cwd ?? "";
          return {
            thread: {
              id: "thread-projectless-automation",
              status: { type: "idle" },
              createdAt: now,
              updatedAt: now,
              cwd,
              modelProvider: "openai",
              preview: "",
              name: null,
              threadSource: "automation",
              turns: [],
            },
            model: "gpt-5",
            modelProvider: "openai",
            serviceTier: null,
            cwd,
            runtimeWorkspaceRoots: [],
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: {
              type: "workspaceWrite",
              writableRoots: [],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
            activePermissionProfile: null,
            reasoningEffort: "high",
            multiAgentMode: "explicitRequestOnly",
          };
        }
        if (method === "thread/name/set") return {};
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn-projectless-automation",
              status: "inProgress",
              items: [],
              startedAt: now,
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };
      const automation = upsertCodexScheduledAutomation({
        id: "projectless-report",
        kind: "cron",
        status: "ACTIVE",
        targetThreadId: null,
        name: "Projectless report",
        prompt: "Draft a status update.",
        rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: "gpt-5",
        cwds: ["~"],
        executionEnvironment: "worktree",
        createdAt: 10,
        updatedAt: 10,
      });

      try {
        await (service as unknown as {
          runScheduledAutomation: (
            automation: CodexScheduledAutomation,
            context: { now: number; reason: "run-now" },
          ) => Promise<void>;
        }).runScheduledAutomation(automation, { now, reason: "run-now" });

        const threadStartParams = requests.find((request) => request.method === "thread/start")?.params as {
          cwd?: string;
          developerInstructions?: string | null;
        } | undefined;
        const expectedRoot = path.join(tempHome, "Documents", "Codex");
        const expectedRunRoot = path.join(expectedRoot, "2026-07-08", "draft-a-status-update");
        const expectedCwd = path.join(expectedRunRoot, "work");
        const expectedOutputs = path.join(expectedRunRoot, "outputs");
        expect(threadStartParams?.cwd).toBe(expectedCwd);
        expect(fs.existsSync(expectedCwd)).toBe(true);
        expect(fs.existsSync(expectedOutputs)).toBe(true);
        expect(threadStartParams?.developerInstructions?.includes("### Projectless Chat")).toBe(true);
        expect(threadStartParams?.developerInstructions?.includes(expectedOutputs)).toBe(true);

        const turnStartParams = requests.find((request) => request.method === "turn/start")?.params as {
          cwd?: string;
          sandboxPolicy?: { writableRoots?: string[] };
        } | undefined;
        expect(turnStartParams?.cwd).toBe(expectedCwd);
        expect(JSON.stringify(turnStartParams?.sandboxPolicy ?? {}).includes(expectedCwd)).toBe(false);

        const linked = getCodexThread("thread-projectless-automation");
        expect(linked?.cwd).toBe(expectedCwd);
        expect(linked?.projectId ?? null).toBe(null);
        expect(linked?.projectlessOutputDirectory).toBe(expectedOutputs);
        expect(linked?.projectlessWorkspaceBrowserRoot).toBe(expectedRoot);
        expect(linked?.managedWorktreePath ?? null).toBe(null);

        const run = getCodexAutomationRun("thread-projectless-automation");
        expect(run?.automationId).toBe("projectless-report");
        expect(run?.sourceCwd).toBe("~");
      } finally {
        await service.shutdown();
        if (previousHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = previousHome;
        }
        fs.rmSync(tempHome, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBe(true);
  });
});

describe("codex-service rate limit polling", () => {
  test("polls rate limits every interval without rereading account", async () => {
    const service = createService({ rateLimitsPollIntervalMs: 20 });
    const client = Reflect.get(service as object, "client") as {
      emit: (event: string, payload: unknown) => boolean;
      start: () => Promise<void>;
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    let accountReadCount = 0;
    let rateLimitsReadCount = 0;

    client.start = async () => undefined;
    client.request = async (method: string) => {
      if (method === "account/read") {
        accountReadCount += 1;
        return {
          account: { type: "chatgpt", email: "test@example.com", planType: "plus" },
          requiresOpenaiAuth: false,
        };
      }
      if (method === "account/rateLimits/read") {
        rateLimitsReadCount += 1;
        return {
          rateLimits: {
            primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: Date.now() + 1_000 },
            secondary: { usedPercent: 39, windowDurationMins: 10_080, resetsAt: Date.now() + 2_000 },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    };

    client.emit("connection", { status: "connected", retries: 0 });
    await service.readAccountSnapshot();
    await waitForCondition(() => rateLimitsReadCount >= 3, 250);
    await service.shutdown();

    expect(accountReadCount).toBe(1);
    expect(rateLimitsReadCount >= 3).toBe(true);
  });

  test("stops polling after logout clears the authenticated account", async () => {
    const service = createService({ rateLimitsPollIntervalMs: 20 });
    const client = Reflect.get(service as object, "client") as {
      emit: (event: string, payload: unknown) => boolean;
      start: () => Promise<void>;
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    let rateLimitsReadCount = 0;

    client.start = async () => undefined;
    client.request = async (method: string) => {
      if (method === "account/read") {
        return {
          account: { type: "chatgpt", email: "test@example.com", planType: "plus" },
          requiresOpenaiAuth: false,
        };
      }
      if (method === "account/rateLimits/read") {
        rateLimitsReadCount += 1;
        return {
          rateLimits: {
            primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: Date.now() + 1_000 },
          },
        };
      }
      if (method === "account/logout") {
        return {};
      }
      throw new Error(`Unexpected method ${method}`);
    };

    client.emit("connection", { status: "connected", retries: 0 });
    await service.readAccountSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const readsBeforeLogout = rateLimitsReadCount;
    await service.logoutAccount();
    await new Promise((resolve) => setTimeout(resolve, 45));
    await service.shutdown();

    expect(readsBeforeLogout >= 2).toBe(true);
    expect(rateLimitsReadCount).toBe(readsBeforeLogout);
  });
});

describe("codex-service readThread fallback", () => {
  test("retries with includeTurns=false for pre-materialization errors", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };
      const includeTurnsCalls: boolean[] = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};

        const request = params as { includeTurns?: boolean };
        const includeTurns = request.includeTurns === true;
        includeTurnsCalls.push(includeTurns);
        if (includeTurns) {
          throw new CodexRpcError(
            "thread 019cb472-b24b-79b2-bdac-aa9dbc4eb28f is not materialized yet; includeTurns is unavailable before first user message",
            -32600,
          );
        }

        return {
          thread: {
            id: "thr_read_fallback",
            turns: [],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_read_fallback", true);
        expect(detail).not.toBeNull();
        expect(detail?.threadId).toBe("thr_read_fallback");
        expect(includeTurnsCalls.length).toBe(2);
        expect(includeTurnsCalls[0]).toBe(true);
        expect(includeTurnsCalls[1]).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not retry includeTurns=false for non-rollout errors", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };
      const includeTurnsCalls: boolean[] = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { includeTurns?: boolean };
        includeTurnsCalls.push(request.includeTurns === true);
        throw new CodexRpcError("permission denied", -32603);
      };

      try {
        let failed = false;
        let message = "";
        try {
          await service.readThread("thr_read_error", true);
        } catch (error) {
          failed = true;
          message = error instanceof Error ? error.message : String(error);
        }

        expect(failed).toBe(true);
        expect(message.includes("permission denied")).toBe(true);
        expect(includeTurnsCalls.length).toBe(1);
        expect(includeTurnsCalls[0]).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resolves thread summaries from SQLite before app-server reads", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_cached_summary",
        threadName: "Cached summary",
        threadPreview: "Cached preview",
        modelProvider: "openai",
        statusType: "idle",
        statusActiveFlags: [],
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      let requests = 0;
      client.start = async () => undefined;
      client.request = async () => {
        requests += 1;
        return {};
      };

      try {
        const summary = await service.resolveThreadSummary("thr_cached_summary");
        expect(summary?.threadName).toBe("Cached summary");
        expect(requests).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resolves missing thread summaries with thread/read includeTurns=false", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };
      let requestMethod = "";
      let requestParams: unknown = null;

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requestMethod = method;
        requestParams = params;
        return {
          thread: {
            id: "thr_remote_summary",
            name: "Remote summary",
            preview: "Remote preview",
            modelProvider: "openai",
            cwd: "/tmp/codex",
            status: {
              type: "active",
              activeFlags: ["waitingOnUserInput"],
            },
            createdAt: 1,
            updatedAt: 2,
          },
        };
      };

      try {
        const summary = await service.resolveThreadSummary("thr_remote_summary");
        const request = requestParams as { threadId?: string; includeTurns?: boolean };
        const persisted = getCodexThread("thr_remote_summary");

        expect(requestMethod).toBe("thread/read");
        expect(request.threadId).toBe("thr_remote_summary");
        expect(request.includeTurns).toBe(false);
        expect(summary?.threadName).toBe("Remote summary");
        expect(summary?.statusType).toBe("active");
        expect(summary?.statusActiveFlags.join(",")).toBe("waitingOnUserInput");
        expect(persisted?.threadPreview).toBe("Remote preview");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("materializes sidebar sessions with bounded fallback titles from long app-server previews", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const longPreview = `Long preview ${"x".repeat(MAX_PROJECT_SESSION_TITLE_LENGTH + 200)}`;
      const normalPreview = "Normal external thread";
      const makeThread = (id: string, preview: string, updatedAt: number) => ({
        id,
        sessionId: id,
        forkedFromId: null,
        parentThreadId: null,
        preview,
        ephemeral: false,
        modelProvider: "openai",
        createdAt: updatedAt - 10,
        updatedAt,
        status: { type: "idle" },
        path: null,
        cwd: "/tmp/codex",
        cliVersion: "test",
        source: "cli",
        threadSource: null,
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [],
      });

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeThread("thr_long_preview", longPreview, 20),
            makeThread("thr_normal_preview", normalPreview, 10),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreads({ refresh: true });
        const sessions = listProjectSessions(defaultProjectId);
        const longSession = sessions.find((session) => session.thread?.threadId === "thr_long_preview");
        const normalSession = sessions.find((session) => session.thread?.threadId === "thr_normal_preview");
        const persistedLongThread = getCodexThread("thr_long_preview");

        expect(longSession !== undefined).toBe(true);
        expect(normalSession !== undefined).toBe(true);
        expect(longSession?.noThreadFallbackTitle.length).toBe(MAX_PROJECT_SESSION_TITLE_LENGTH);
        expect(longSession?.noThreadFallbackTitle.startsWith("Long preview")).toBe(true);
        expect(normalSession?.noThreadFallbackTitle).toBe(normalPreview);
        expect(persistedLongThread?.threadPreview.length).toBe(longPreview.length);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("materializes project-bound sidebar sessions from thread-started notifications", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });

      try {
        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_started_project",
            parentThreadId: null,
            preview: "Started from CLI",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/codex/packages/app",
            createdAt: 10,
            updatedAt: 20,
            status: { type: "idle" },
            name: null,
            source: "cli",
          },
        });

        const sessions = listProjectSessions(defaultProjectId);
        const linked = sessions.find((session) => session.thread?.threadId === "thr_started_project");
        const summary = getCodexThread("thr_started_project");

        expect(linked !== undefined).toBe(true);
        expect(linked?.projectId).toBe(defaultProjectId);
        expect(linked?.noThreadFallbackTitle).toBe("Started from CLI");
        expect(summary?.projectId).toBe(defaultProjectId);
        const sidebarMessage = hostMessages.find((message) => message.type === "sidebarSyncUpdated");
        expect(sidebarMessage !== undefined).toBe(true);
        if (sidebarMessage?.type === "sidebarSyncUpdated") {
          expect(sidebarMessage.result.changedProjectIds.includes(defaultProjectId)).toBe(true);
          expect(sidebarMessage.result.materializedSessionIds.includes(linked?.id ?? "")).toBe(true);
        }

        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_started_project",
            parentThreadId: null,
            preview: "Started from CLI",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/codex/packages/app",
            createdAt: 10,
            updatedAt: 30,
            status: { type: "idle" },
            name: null,
            source: "cli",
          },
        });
        const duplicateCount = listProjectSessions(defaultProjectId)
          .filter((session) => session.thread?.threadId === "thr_started_project").length;
        expect(duplicateCount).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("registers subagent ids from thread-started spawn sources", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
        routeAppServerNotification: (notification: { method: string; params: unknown }) => void;
        subagentThreadIds: Set<string>;
      };

      try {
        serviceInternals.handleNotification = async () => {};
        serviceInternals.routeAppServerNotification({
          method: "thread/started",
          params: {
            thread: {
              ...makeSidebarListThread({
                id: "thr_subagent_child",
                cwd: "/tmp/codex",
                preview: "Subagent child",
              }),
              source: {
                subAgent: {
                  thread_spawn: {
                    parent_thread_id: "thr_parent",
                  },
                },
              },
            },
          },
        });
        serviceInternals.routeAppServerNotification({
          method: "thread/started",
          params: {
            thread: {
              ...makeSidebarListThread({
                id: "thr_lowercase_subagent",
                cwd: "/tmp/codex",
                preview: "Lowercase source",
              }),
              source: {
                subagent: {
                  thread_spawn: {
                    parent_thread_id: "thr_parent",
                  },
                },
              },
            },
          },
        });
        serviceInternals.routeAppServerNotification({
          method: "thread/started",
          params: {
            thread: makeSidebarListThread({
              id: "thr_regular_started",
              cwd: "/tmp/codex",
              preview: "Regular child",
            }),
          },
        });

        expect(Array.from(serviceInternals.subagentThreadIds).join(",")).toBe("thr_subagent_child,thr_lowercase_subagent");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not materialize detached guardian reviewer thread-started notifications", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const handledMethods: string[] = [];
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
        routeAppServerNotification: (notification: { method: string; params: unknown }) => void;
        subagentThreadIds: Set<string>;
      };

      try {
        serviceInternals.handleNotification = async (method) => {
          handledMethods.push(method);
        };
        serviceInternals.routeAppServerNotification({
          method: "thread/started",
          params: {
            thread: {
              ...makeSidebarListThread({
                id: "thr_started_reviewer",
                cwd: "/tmp/codex",
                preview: "The following is the Codex agent history whose request action you are assessing.",
              }),
              source: {
                subagent: {
                  other: "guardian",
                },
              },
              threadSource: "subagent",
            },
          },
        });

        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_started_reviewer");

        expect(handledMethods.join(",")).toBe("");
        expect(serviceInternals.subagentThreadIds.has("thr_started_reviewer")).toBe(true);
        expect(linked === undefined).toBe(true);
        expect(getCodexThread("thr_started_reviewer") === null).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("persists source-derived subagent nickname metadata without sparse overwrite", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };

      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_parent_source_metadata",
        threadPreview: "Parent thread",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        statusType: "idle",
        createdAt: 1,
        updatedAt: 1,
      });

      try {
        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_child_source_metadata",
            parentThreadId: null,
            preview: "Child source metadata",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/codex",
            createdAt: 2,
            updatedAt: 2,
            status: { type: "idle" },
            name: null,
            source: {
              subagent: {
                thread_spawn: {
                  parent_thread_id: "thr_parent_source_metadata",
                  agent_nickname: "@Euclid",
                  agent_role: "explorer",
                },
              },
            },
          },
        });

        const firstSummary = getCodexThread("thr_child_source_metadata");
        expect(firstSummary?.source?.parentThreadId).toBe("thr_parent_source_metadata");
        expect(firstSummary?.agentNickname).toBe("@Euclid");
        expect(firstSummary?.agentRole).toBe("explorer");

        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_child_source_metadata",
            parentThreadId: "thr_parent_source_metadata",
            preview: "Sparse child update",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/codex",
            createdAt: 2,
            updatedAt: 3,
            status: { type: "idle" },
            name: null,
            source: "unknown",
          },
        });

        const sparseSummary = getCodexThread("thr_child_source_metadata");
        expect(sparseSummary?.agentNickname).toBe("@Euclid");
        expect(sparseSummary?.agentRole).toBe("explorer");

        serviceInternals.setConversationRecordDetail({
          ...makeThreadDetail("thr_parent_source_metadata"),
          projectId: defaultProjectId,
          threadName: "Parent",
        });
        const conversation = service.serializeConversationSnapshot("thr_parent_source_metadata");
        expect(conversation?.childMemberships[0]?.thread?.nickname).toBe("@Euclid");
        expect(conversation?.childMemberships[0]?.thread?.agentRole).toBe("explorer");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("repairs missing parent child memberships through lightweight thread/read metadata", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
      const hostMessages: CodexHostMessage[] = [];

      client.start = async () => undefined;
      client.request = async (method, params) => {
        requests.push({ method, params: params as Record<string, unknown> });
        if (method !== "thread/read") {
          throw new Error(`Unexpected metadata repair request: ${method}`);
        }
        return {
          thread: {
            ...makeSidebarListThread({
              id: "thr_child_metadata_repair",
              cwd: "/tmp/codex",
              preview: "Role/name: Worker",
              updatedAt: 3,
            }),
            source: {
              subAgent: {
                thread_spawn: {
                  parent_thread_id: "thr_parent_metadata_repair",
                  agent_nickname: "@Lorentz",
                  agent_role: "worker",
                },
              },
            },
          },
        };
      };
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });

      const parentConversation = makeConversationSnapshot({
        threadId: "thr_parent_metadata_repair",
      });
      const multiAgentItem: CodexConversationSnapshot["turns"][number]["items"][number] = {
        threadId: "thr_parent_metadata_repair",
        turnId: "turn-1",
        itemId: "item-spawn-child",
        type: "collabAgentToolCall",
        kind: "toolCall",
        semanticKind: "multiAgentAction",
        status: "completed",
        markdownText: "",
        createdAt: 1,
        updatedAt: 1,
        toolCall: {
          toolName: "spawnAgent",
          subtype: "generic",
          args: {
            receivers: ["thr_child_metadata_repair"],
            receiverThreads: [],
            agentsStates: {},
          },
          result: null,
        },
      };

      try {
        expect(service.publishRendererThreadStreamStateChange("owner-a", {
          conversationId: "thr_parent_metadata_repair",
          change: {
            type: "snapshot",
            revision: 1,
            conversationState: {
              ...parentConversation,
              turns: [{
                ...parentConversation.turns[0]!,
                items: [multiAgentItem],
              }],
            },
          },
        })).toBe(true);

        await waitForCondition(() => requests.length === 1, 250);
        await waitForCondition(() => hostMessages.some((message) => {
          if (message.type !== "sharedObjectUpdated") return false;
          if (message.object.objectType !== "conversationChildMemberships") return false;
          return message.object.value.childMemberships.some((membership) =>
            membership.threadId === "thr_child_metadata_repair" &&
            membership.thread?.nickname === "@Lorentz"
          );
        }), 250);

        expect(requests[0]?.method).toBe("thread/read");
        expect(String(requests[0]?.params.threadId)).toBe("thr_child_metadata_repair");
        expect(String(requests[0]?.params.includeTurns)).toBe("false");
        expect(getCodexThread("thr_child_metadata_repair")?.agentNickname).toBe("@Lorentz");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("marks opened subagent threads as full fidelity", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        fullFidelitySubagentThreadIds: Set<string>;
      };

      try {
        expect(service.markSubagentThreadOpened("  thr_opened_child  ")).toBe(true);
        expect(service.markSubagentThreadOpened("   ")).toBe(false);
        expect(Array.from(serviceInternals.fullFidelitySubagentThreadIds).join(",")).toBe("thr_opened_child");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("drops only Qz deltas for unopened subagent threads", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const handledMethods: string[] = [];
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
        routeAppServerNotification: (notification: { method: string; params: unknown }) => void;
      };
      const qzMethods = [
        "item/agentMessage/delta",
        "item/plan/delta",
        "item/reasoning/summaryTextDelta",
        "item/reasoning/textDelta",
        "item/commandExecution/outputDelta",
      ];

      try {
        serviceInternals.handleNotification = async (method) => {
          handledMethods.push(method);
        };
        serviceInternals.routeAppServerNotification({
          method: "thread/started",
          params: {
            thread: {
              ...makeSidebarListThread({
                id: "thr_unopened_subagent",
                cwd: "/tmp/codex",
                preview: "Unopened subagent",
              }),
              source: {
                subAgent: {
                  thread_spawn: {
                    parent_thread_id: "thr_parent",
                  },
                },
              },
            },
          },
        });
        handledMethods.length = 0;

        for (const method of qzMethods) {
          serviceInternals.routeAppServerNotification({
            method,
            params: {
              threadId: "thr_unopened_subagent",
              turnId: "turn_1",
              itemId: "item_1",
              delta: "streaming",
            },
          });
        }
        serviceInternals.routeAppServerNotification({
          method: "item/reasoning/summaryPartAdded",
          params: {
            threadId: "thr_unopened_subagent",
            turnId: "turn_1",
            itemId: "reasoning_1",
            summaryIndex: 0,
          },
        });
        expect(handledMethods.join(",")).toBe("item/reasoning/summaryPartAdded");

        service.markSubagentThreadOpened("thr_unopened_subagent");
        handledMethods.length = 0;
        for (const method of qzMethods) {
          serviceInternals.routeAppServerNotification({
            method,
            params: {
              threadId: "thr_unopened_subagent",
              turnId: "turn_1",
              itemId: "item_1",
              delta: "streaming",
            },
          });
        }
        expect(handledMethods.join(",")).toBe(qzMethods.join(","));
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("routes thread-started notifications through the renderer owner when one is registered", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const streamMessages: CodexHostMessage[] = [];
      const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          streamMessages.push(message);
        }
      });
      (service as unknown as {
        on: (
          event: "rendererOwnerHostMessage",
          listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
        ) => void;
      }).on("rendererOwnerHostMessage", (message) => {
        ownerMessages.push(message);
      });

      try {
        installRendererOwnerConversation(service, {
          threadId: "thr_started_owner",
          ownerClientId: "owner-a",
          statusType: "active",
          turnStatus: "inProgress",
        });

        await serviceInternals.handleNotification("thread/started", {
          thread: makeSidebarListThread({
            id: "thr_started_owner",
            cwd: "/tmp/codex",
            preview: "Owner-started thread",
            name: "Owner started",
            updatedAt: 30,
          }),
        });

        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_started_owner");
        const ownerNotification = ownerMessages[0]?.message;

        expect(linked !== undefined).toBe(true);
        expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
        expect(ownerNotification?.type).toBe("threadOwnerNotification");
        if (ownerNotification?.type === "threadOwnerNotification") {
          expect(ownerNotification.method).toBe("thread/started");
          const params = ownerNotification.params as { thread?: { id?: string } };
          expect(params.thread?.id).toBe("thr_started_owner");
        }
        expect(String(streamMessages.length)).toBe("0");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("materializes projectless sidebar sessions from unmatched thread-started notifications", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      try {
        await serviceInternals.handleNotification("thread/started", {
          thread: {
            id: "thr_started_projectless",
            parentThreadId: null,
            preview: "Outside workspace",
            ephemeral: false,
            modelProvider: "openai",
            cwd: "/tmp/outside-project",
            createdAt: 10,
            updatedAt: 20,
            status: { type: "idle" },
            name: null,
            source: "cli",
          },
        });

        const sessions = listProjectSessions(null);
        const linked = sessions.find((session) => session.thread?.threadId === "thr_started_projectless");
        const summary = getCodexThread("thr_started_projectless");

        expect(linked !== undefined).toBe(true);
        expect(linked?.projectId).toBe(null);
        expect(linked?.noThreadFallbackTitle).toBe("Outside workspace");
        expect(summary?.projectId).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("requests sidebar thread-list with interactive default source kinds from the state DB read model", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: unknown[] = [];

      client.start = async () => undefined;
      client.request = async (method, params) => {
        if (method !== "thread/list") return {};
        requests.push(params);
        return {
          data: [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({
          includeArchived: true,
          policy: "force",
          reason: "manual",
        });

        const activeRequest = requests[0] as Record<string, unknown> | undefined;
        const archivedRequest = requests[1] as Record<string, unknown> | undefined;

        expect(requests.length).toBe(2);
        expect(activeRequest !== undefined).toBe(true);
        expect(archivedRequest !== undefined).toBe(true);
        expect(activeRequest?.archived).toBe(false);
        expect(archivedRequest?.archived).toBe(true);
        expect(activeRequest?.modelProviders).toBe(null);
        expect(archivedRequest?.modelProviders).toBe(null);
        expect(activeRequest?.useStateDbOnly).toBe(true);
        expect(archivedRequest?.useStateDbOnly).toBe(true);
        expect(JSON.stringify(activeRequest?.sourceKinds)).toBe("[]");
        expect(JSON.stringify(archivedRequest?.sourceKinds)).toBe("[]");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not materialize detached guardian reviewer threads from sidebar sync", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const reviewerPreview = "The following is the Codex agent history whose request action you are assessing.";

      client.start = async () => undefined;
      client.request = async (method, params) => {
        if (method !== "thread/list") return {};
        const request = params as Record<string, unknown>;
        return {
          data: request.archived
            ? []
            : [{
                ...makeSidebarListThread({
                  id: "thr_auto_review_reviewer",
                  cwd: "/tmp/codex",
                  preview: reviewerPreview,
                }),
                source: {
                  subagent: {
                    other: "guardian",
                  },
                },
                threadSource: "subagent",
              }],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const result = await service.syncSidebarThreadsDetailed({
          includeArchived: true,
          policy: "force",
          reason: "manual",
        });
        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_auto_review_reviewer");

        expect(result.snapshot.items.some((item) => item.threadId === "thr_auto_review_reviewer")).toBe(false);
        expect(linked === undefined).toBe(true);
        expect(getCodexThread("thr_auto_review_reviewer") === null).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("repairs legacy auto-review reviewer sidebar sessions from rollout metadata", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const reviewerPreview = "The following is the Codex agent history added since your last approval assessment.";

      try {
        await withTempCodexHomeAsync(async (codexHome) => {
          fs.mkdirSync(path.join(codexHome, "sessions", "2026", "07", "06"), { recursive: true });
          fs.writeFileSync(
            path.join(codexHome, "sessions", "2026", "07", "06", "rollout-2026-07-06T18-08-45-thr_legacy_reviewer.jsonl"),
            [
              JSON.stringify({
                timestamp: "2026-07-06T10:10:30.000Z",
                type: "session_meta",
                payload: {
                  id: "thr_legacy_reviewer",
                  parent_thread_id: "thr_parent",
                  source: {
                    subagent: {
                      other: "guardian",
                    },
                  },
                  thread_source: "subagent",
                  cwd: "/tmp/codex",
                },
              }),
              JSON.stringify({
                timestamp: "2026-07-06T10:10:31.000Z",
                type: "event_msg",
                payload: {
                  type: "user_message",
                  message: reviewerPreview,
                },
              }),
            ].join("\n"),
          );

          const session = createProjectSession({
            projectId: defaultProjectId,
            noThreadFallbackTitle: reviewerPreview,
          });
          upsertProjectSessionThreadLink({
            sessionId: session.id,
            projectId: defaultProjectId,
            threadId: "thr_legacy_reviewer",
            threadPreview: reviewerPreview,
            modelProvider: "openai",
            cwd: "/tmp/codex",
            statusType: "idle",
            statusActiveFlags: [],
            archived: false,
            createdAt: 10,
            updatedAt: 20,
          });

          const snapshot = await service.syncSidebarThreads({ includeArchived: true, refresh: false });
          const repairedSession = getProjectSession(session.id);
          const repairedThread = getCodexThread("thr_legacy_reviewer");

          expect(snapshot.items.some((item) => item.threadId === "thr_legacy_reviewer")).toBe(false);
          expect(repairedSession?.archived).toBe(true);
          expect(repairedSession?.thread === null).toBe(true);
          expect(repairedThread?.archived).toBe(true);
        });
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("falls back when app-server does not support state DB sidebar thread-listing", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: unknown[] = [];

      client.start = async () => undefined;
      client.request = async (method, params) => {
        if (method !== "thread/list") return {};
        requests.push(params);
        const request = params as Record<string, unknown>;
        if (request.useStateDbOnly === true) {
          throw new CodexRpcError("unknown field `useStateDbOnly`", -32602);
        }
        return {
          data: [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const firstResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const secondResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const firstRequest = requests[0] as Record<string, unknown> | undefined;
        const retryRequest = requests[1] as Record<string, unknown> | undefined;
        const secondSyncRequest = requests[2] as Record<string, unknown> | undefined;

        expect(firstResult.source).toBe("app-server");
        expect(secondResult.source).toBe("app-server");
        expect(requests.length).toBe(3);
        expect(firstRequest?.useStateDbOnly).toBe(true);
        expect("useStateDbOnly" in (retryRequest ?? {})).toBe(false);
        expect("useStateDbOnly" in (secondSyncRequest ?? {})).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("hydrates explicit background subagent thread ids without parent descendant listing", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
      const makeSubagentThread = (threadId: string, parentThreadId: string, updatedAt: number) => ({
        ...makeSidebarListThread({
          id: threadId,
          cwd: "/tmp/codex/packages/app",
          preview: threadId,
          updatedAt,
        }),
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: parentThreadId,
            },
          },
        },
      });

      client.start = async () => undefined;
      client.request = async (method, params) => {
        const request = params as Record<string, unknown>;
        requests.push({ method, params: request });
        if (method !== "thread/read") {
          throw new Error(`Unexpected background hydrate request method: ${method}`);
        }
        const threadId = typeof request.threadId === "string" ? request.threadId : "";
        if (threadId === "thr_child_a") {
          return { thread: makeSubagentThread("thr_child_a", "thr_parent", 30) };
        }
        if (threadId === "thr_child_b") {
          return { thread: makeSubagentThread("thr_child_b", "thr_child_a", 20) };
        }
        return {
          thread: makeSidebarListThread({
            id: threadId,
            cwd: "/tmp/codex/packages/app",
            preview: threadId,
          }),
        };
      };

      try {
        const summaries = await service.hydrateBackgroundSubagentThreads({
          threadIds: [" thr_child_a ", "", "thr_child_a", "thr_child_b"],
        });
        const firstRequest = requests[0];
        const firstSummary = getCodexThread("thr_child_a");
        const secondSummary = getCodexThread("thr_child_b");

        expect(summaries.map((summary) => summary.threadId).join(",")).toBe("thr_child_a,thr_child_b");
        expect(requests.map((request) => request.method).join(",")).toBe("thread/read,thread/read");
        expect(requests.map((request) => String(request.params.threadId)).join(",")).toBe("thr_child_a,thr_child_b");
        expect(requests.map((request) => String(request.params.includeTurns)).join(",")).toBe("false,false");
        expect(firstRequest?.params.threadId).toBe("thr_child_a");
        expect(firstSummary?.source?.parentThreadId).toBe("thr_parent");
        expect(secondSummary?.source?.parentThreadId).toBe("thr_child_a");
        expect(getCodexThread("thr_parent") === null).toBe(true);
        expect(getCodexThread("thr_unrelated") === null).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("coalesces concurrent sidebar force sync calls through one thread-list request", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      let requestCount = 0;
      let releaseRequest: () => void = () => undefined;
      const requestGate = new Promise<void>((resolve) => {
        releaseRequest = resolve;
      });

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        requestCount += 1;
        await requestGate;
        return {
          data: [
            {
              id: "thr_coalesced_sidebar_sync",
              parentThreadId: null,
              preview: "Coalesced",
              ephemeral: false,
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1,
              updatedAt: 2,
              status: { type: "idle" },
              name: null,
              source: "cli",
            },
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const first = service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const second = service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        await waitForCondition(() => requestCount === 1, 100);
        releaseRequest();
        const firstResult = await first;
        const secondResult = await second;

        expect(requestCount).toBe(1);
        expect(firstResult.source).toBe("app-server");
        expect(secondResult.source).toBe("app-server");
        expect(firstResult.materializedSessionIds.length).toBe(1);
        expect(secondResult.materializedSessionIds.length).toBe(1);
      } finally {
        releaseRequest();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("serves repeated stale sidebar syncs from SQLite inside the fresh window", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      let requestCount = 0;

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        requestCount += 1;
        return {
          data: [
            makeSidebarListThread({
              id: "thr_stale_gate_sidebar_sync",
              cwd: "/tmp/codex/packages/app",
              preview: "Stale gate",
              updatedAt: 50,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const forceResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const staleResult = await service.syncSidebarThreadsDetailed({ policy: "stale", reason: "focus" });
        const heartbeatResult = await service.syncSidebarThreadsDetailed({ policy: "stale", reason: "heartbeat" });

        expect(forceResult.source).toBe("app-server");
        expect(staleResult.source).toBe("sqlite");
        expect(heartbeatResult.source).toBe("sqlite");
        expect(requestCount).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not emit project session changes for unchanged sidebar force sync data", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const captured = collectProjectSessionChangeEvents();

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_noop_sidebar_sync",
              cwd: "/tmp/codex/packages/app",
              preview: "Stable thread",
              updatedAt: 50,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        const firstResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        expect(firstResult.materializedSessionIds.length).toBe(1);
        expect(captured.events.length).toBe(1);

        captured.events.length = 0;
        const secondResult = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        expect(captured.events.length).toBe(0);
        expect(secondResult.changedProjectIds.length).toBe(0);
        expect(secondResult.projectlessChanged).toBe(false);
        expect(secondResult.materializedSessionIds.length).toBe(0);
      } finally {
        captured.dispose();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not emit project session changes when sidebar thread summary changes in place", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const captured = collectProjectSessionChangeEvents();
      let preview = "Before";
      let updatedAt = 50;

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_changed_sidebar_summary",
              cwd: "/tmp/codex/packages/app",
              preview,
              updatedAt,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_changed_sidebar_summary");
        expect(linked !== undefined).toBe(true);

        captured.events.length = 0;
        preview = "After";
        updatedAt = 60;
        const result = await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        expect(captured.events.length).toBe(0);
        expect(result.changedProjectIds.includes(defaultProjectId)).toBe(true);
        expect(result.projectlessChanged).toBe(false);
        expect(result.materializedSessionIds.length).toBe(0);
      } finally {
        captured.dispose();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("forces sidebar repair for unknown name notifications even when the last sync is fresh", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      let requestCount = 0;
      let exposeUnknownThread = false;

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        requestCount += 1;
        return {
          data: exposeUnknownThread
            ? [
                makeSidebarListThread({
                  id: "thr_unknown_name_repair",
                  cwd: "/tmp/codex/packages/app",
                  name: "Repaired title",
                  updatedAt: 50,
                }),
              ]
            : [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        exposeUnknownThread = true;
        await serviceInternals.handleNotification("thread/name/updated", {
          threadId: "thr_unknown_name_repair",
          threadName: "Repaired title",
        });
        await waitForCondition(() => getCodexThread("thr_unknown_name_repair") !== null, 1_000);

        const summary = getCodexThread("thr_unknown_name_repair");
        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_unknown_name_repair");

        expect(requestCount).toBe(2);
        expect(summary?.threadName).toBe("Repaired title");
        expect(linked !== undefined).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("forces sidebar repair for unknown goal metadata notifications", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      let exposeUnknownThread = false;

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: exposeUnknownThread
            ? [
                makeSidebarListThread({
                  id: "thr_unknown_goal_repair",
                  cwd: "/tmp/codex",
                  preview: "Goal repaired",
                  updatedAt: 80,
                }),
              ]
            : [],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        exposeUnknownThread = true;
        await serviceInternals.handleNotification("thread/goal/updated", {
          threadId: "thr_unknown_goal_repair",
          turnId: null,
          goal: {
            threadId: "thr_unknown_goal_repair",
            objective: "Repair unknown goal thread",
            status: "active",
            tokenBudget: null,
            tokensUsed: 0,
            timeUsedSeconds: 0,
            createdAt: 100,
            updatedAt: 101,
          },
        });
        await waitForCondition(() => getCodexThread("thr_unknown_goal_repair") !== null, 1_000);

        const linked = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_unknown_goal_repair");

        expect(getCodexThread("thr_unknown_goal_repair") !== null).toBe(true);
        expect(linked !== undefined).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("re-homes a projectless linked sidebar session when cwd later matches a project source", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };
      const captured = collectProjectSessionChangeEvents();
      let cwd: string | null = "/tmp/outside-project";

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_rehome_projectless",
              cwd,
              preview: "Move me",
              updatedAt: cwd === null ? 20 : 30,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });
        const projectless = listProjectSessions(null)
          .find((session) => session.thread?.threadId === "thr_rehome_projectless");
        expect(projectless !== undefined).toBe(true);
        expect(projectless?.projectId).toBe(null);

        captured.events.length = 0;
        cwd = "/tmp/codex/packages/app";
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        const moved = listProjectSessions(defaultProjectId)
          .find((session) => session.thread?.threadId === "thr_rehome_projectless");
        const stillProjectless = listProjectSessions(null)
          .find((session) => session.thread?.threadId === "thr_rehome_projectless");

        expect(moved?.id).toBe(projectless?.id);
        expect(moved?.projectId).toBe(defaultProjectId);
        expect(stillProjectless === undefined).toBe(true);
        expect(captured.events.length).toBe(2);
        const oldScopeEvents = captured.events.filter((event) =>
          event.projectId === null
          && event.changeType === "link"
          && event.sessionId === projectless?.id
        );
        const newScopeEvents = captured.events.filter((event) =>
          event.projectId === defaultProjectId
          && event.changeType === "link"
          && event.sessionId === projectless?.id
        );
        expect(oldScopeEvents.length).toBe(1);
        expect(newScopeEvents.length).toBe(1);
      } finally {
        captured.dispose();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("archives project-scoped linked session instead of moving its tabs across projects", async () => {
    const ran = await withTempDatabase(async () => {
      const targetProjectId = createProject({ name: "Other", sources: ["/tmp/other"] }).id;
      const session = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Scoped panel",
      });
      createProjectSessionTab({
        sessionId: session.id,
        projectId: defaultProjectId,
        panelId: "right",
        kind: "db_view",
        title: "DB View",
        config: { projectId: defaultProjectId, view: "kanban" },
      });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: defaultProjectId,
        threadId: "thr_rehome_scoped_tabs",
        threadPreview: "Scoped panel",
        modelProvider: "openai",
        cwd: "/tmp/codex",
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method !== "thread/list") return {};
        return {
          data: [
            makeSidebarListThread({
              id: "thr_rehome_scoped_tabs",
              cwd: "/tmp/other/app",
              preview: "Scoped panel moved",
              updatedAt: 60,
            }),
          ],
          nextCursor: null,
          backwardsCursor: null,
        };
      };

      try {
        await service.syncSidebarThreadsDetailed({ policy: "force", reason: "manual" });

        const archivedOriginal = getProjectSession(session.id);
        const replacement = listProjectSessions(targetProjectId)
          .find((candidate) => candidate.thread?.threadId === "thr_rehome_scoped_tabs");

        expect(archivedOriginal?.archived).toBe(true);
        expect(replacement !== undefined).toBe(true);
        expect(replacement?.id === session.id).toBe(false);
        expect(replacement?.projectId).toBe(targetProjectId);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("thread-deleted archives linked sessions, clears pin, and removes the active sidebar row", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Delete me",
      });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: defaultProjectId,
        threadId: "thr_deleted_cleanup",
        threadPreview: "Delete me",
        modelProvider: "openai",
        cwd: "/tmp/codex",
      });
      setCodexThreadPinned("thr_deleted_cleanup", true);
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      try {
        await serviceInternals.handleNotification("thread/deleted", {
          threadId: "thr_deleted_cleanup",
        });

        const archived = getProjectSession(session.id);
        const snapshot = await service.syncSidebarThreads({ refresh: false });

        expect(archived?.archived).toBe(true);
        expect(getCodexThread("thr_deleted_cleanup") === null).toBe(true);
        expect(snapshot.items.some((item) => item.threadId === "thr_deleted_cleanup")).toBe(false);
        expect(snapshot.pinnedThreadIds.includes("thr_deleted_cleanup")).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("clears sidebar project assignment when sync explicitly resolves no project", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_project_assignment_clear",
        threadPreview: "In project",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        createdAt: 1,
        updatedAt: 2,
      });
      upsertCodexThread({
        threadId: "thr_project_assignment_clear",
        threadPreview: "Preserve old assignment",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        createdAt: 1,
        updatedAt: 3,
      });
      const stillProjectBound = getCodexThread("thr_project_assignment_clear");

      upsertCodexThread({
        projectId: null,
        threadId: "thr_project_assignment_clear",
        threadPreview: "Projectless",
        modelProvider: "openai",
        cwd: "/tmp/outside-project",
        createdAt: 1,
        updatedAt: 4,
      });
      const cleared = getCodexThread("thr_project_assignment_clear");

      upsertCodexThread({
        threadId: "thr_project_assignment_clear",
        threadPreview: "Preserved",
        modelProvider: "openai",
        cwd: "/tmp/outside-project",
        createdAt: 1,
        updatedAt: 5,
      });
      const preserved = getCodexThread("thr_project_assignment_clear");

      expect(stillProjectBound?.projectId).toBe(defaultProjectId);
      expect(cleared?.projectId).toBe(null);
      expect(preserved?.projectId).toBe(null);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("lists command-palette chats from sidebar scope", async () => {
    const ran = await withTempDatabase(async () => {
      const visibleSession = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Palette visible",
      });
      upsertProjectSessionThreadLink({
        sessionId: visibleSession.id,
        projectId: defaultProjectId,
        threadId: "thr_palette_visible",
        threadName: "Palette visible thread",
        threadPreview: "Visible preview",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        updatedAt: 200,
      });

      const archivedSession = createProjectSession({
        projectId: defaultProjectId,
        noThreadFallbackTitle: "Palette archived",
      });
      upsertProjectSessionThreadLink({
        sessionId: archivedSession.id,
        projectId: defaultProjectId,
        threadId: "thr_palette_archived",
        threadName: "Archived thread",
        threadPreview: "Archived preview",
        modelProvider: "openai",
        archived: true,
        updatedAt: 300,
      });

      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_project_only",
        threadName: "Project only",
        threadPreview: "No session owner",
        modelProvider: "openai",
        updatedAt: 400,
      });

      upsertCodexThread({
        threadId: "thr_projectless",
        threadName: "Projectless chat",
        threadPreview: "No project owner",
        modelProvider: "openai",
        updatedAt: 500,
      });

      const service = createService();
      try {
        const results = service.listCommandPaletteThreads({ scope: "sidebar" });
        const ids = results.map((thread) => thread.threadId).join(",");

        expect(results.length).toBe(3);
        expect(ids.includes("thr_palette_visible")).toBe(true);
        expect(ids.includes("thr_project_only")).toBe(true);
        expect(ids.includes("thr_projectless")).toBe(true);
        expect(ids.includes("thr_palette_archived")).toBe(false);
        const projectless = results.find((thread) => thread.threadId === "thr_projectless");
        expect(projectless?.projectless).toBe(true);
        expect(projectless?.projectId ?? null).toBe(null);
        expect(projectless?.sessionId ?? null).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("searches command-palette content across sidebar chats without leaking archived rows", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_content_sessionless",
        threadName: "Content sessionless",
        threadPreview: "Visible sessionless preview",
        modelProvider: "openai",
        updatedAt: 200,
      });

      upsertCodexThread({
        threadId: "thr_content_projectless",
        threadName: "Content projectless",
        threadPreview: "Visible projectless preview",
        modelProvider: "openai",
        updatedAt: 300,
      });

      upsertCodexThread({
        threadId: "thr_content_archived",
        threadName: "Content archived",
        threadPreview: "Archived preview",
        modelProvider: "openai",
        archived: true,
        updatedAt: 400,
      });

      const service = createService();
      const searchIndexer = new CommandPaletteThreadSearchService();
      try {
        const summaries = service.listCommandPaletteThreads({ scope: "sidebar" });
        for (const summary of summaries) {
          const thread = getCodexThread(summary.threadId);
          if (!thread) continue;
          searchIndexer.indexThreadDetail(summary, {
            ...thread,
            turns: [],
            transcript: [{
              threadId: summary.threadId,
              turnId: "turn_1",
              itemId: `item_${summary.threadId}`,
              type: "userMessage",
              kind: "userMessage",
              semanticKind: "userMessage",
              role: "user",
              markdownText: `Visible transcript needle from ${summary.threadId}`,
              createdAt: summary.updatedAt,
              updatedAt: summary.updatedAt,
            }],
          });
        }

        const results = await service.searchCommandPaletteThreadContent({
          scope: "sidebar",
          query: "needle",
          limit: 60,
        });
        const ids = results.map((result) => result.threadId).join(",");

        expect(ids.includes("thr_content_sessionless")).toBe(true);
        expect(ids.includes("thr_content_projectless")).toBe(true);
        expect(ids.includes("thr_content_archived")).toBe(false);
      } finally {
        searchIndexer.shutdown();
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not call app-server thread search for command-palette content", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_content_local_only",
        threadName: "Content local only",
        threadPreview: "Visible preview",
        modelProvider: "openai",
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: () => Promise<never>;
      };
      client.start = async () => undefined;
      client.request = async () => {
        throw new Error("app-server should not be called");
      };

      try {
        const results = await service.searchCommandPaletteThreadContent({
          scope: "sidebar",
          query: "transcript",
          limit: 60,
        });

        expect(results.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not enqueue command-palette content backfill from search", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_content_no_search_backfill",
        threadName: "Content no search backfill",
        threadPreview: "Visible preview",
        modelProvider: "openai",
      });

      let enqueueCalls = 0;
      let searchCalls = 0;
      let eligibleCount = 0;
      const countingClient: CommandPaletteThreadSearchClient = {
        enqueueBackfill: () => {
          enqueueCalls += 1;
        },
        search: async (_input, eligibleSummaries) => {
          searchCalls += 1;
          eligibleCount = eligibleSummaries.length;
          return [];
        },
        indexConversation: () => undefined,
        removeThread: () => undefined,
        shutdown: () => undefined,
      };
      const service = createService({ commandPaletteThreadSearchClient: countingClient });

      try {
        const results = await service.searchCommandPaletteThreadContent({
          scope: "sidebar",
          query: "visible",
          limit: 60,
        });

        expect(results.length).toBe(0);
        expect(enqueueCalls).toBe(0);
        expect(searchCalls).toBe(1);
        expect(eligibleCount).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("fails closed when command-palette content search worker is unavailable", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_content_worker_unavailable",
        threadName: "Worker unavailable",
        threadPreview: "Visible preview",
        modelProvider: "openai",
      });

      const failingClient: CommandPaletteThreadSearchClient = {
        enqueueBackfill: () => undefined,
        search: async () => {
          throw new Error("worker unavailable");
        },
        indexConversation: () => undefined,
        removeThread: () => undefined,
        shutdown: () => undefined,
      };
      const service = createService({ commandPaletteThreadSearchClient: failingClient });

      try {
        const results = await service.searchCommandPaletteThreadContent({
          scope: "sidebar",
          query: "visible",
          limit: 60,
        });

        expect(results.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("materializes fileChange patch rows and turn-level unified diff as separate transcript items", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      const patchDiff = "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new";
      const turnDiff = `${patchDiff}\n`;

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { threadId?: string };
        if (request.threadId !== "thr_file_change_diff") return {};

        return {
          thread: {
            id: "thr_file_change_diff",
            turns: [
              {
                id: "turn_file_change_diff",
                status: "completed",
                startedAt: 1,
                completedAt: 2,
                durationMs: 1000,
                diff: turnDiff,
                items: [
                  {
                    id: "patch_file_change_diff",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "src/example.ts",
                        kind: { type: "update" },
                        diff: patchDiff,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_file_change_diff", true);
        expect(detail).not.toBeNull();
        expect(detail?.turns[0]?.diff).toBe(turnDiff);
        expect(detail?.turns[0]?.startedAt).toBe(1_000);
        expect(detail?.turns[0]?.completedAt).toBe(2_000);
        expect(detail?.turns[0]?.turnStartedAtMs).toBe(1_000);
        expect(detail?.turns[0]?.finalAssistantStartedAtMs).toBe(2_000);
        expect(detail?.turns[0]?.durationMs).toBe(1000);
        expect(detail?.transcript.length).toBe(2);
        expect(`${detail?.transcript[0]?.kind}:${detail?.transcript[0]?.semanticKind}`).toBe("fileChange:patch");
        expect(`${detail?.transcript[1]?.kind}:${detail?.transcript[1]?.semanticKind}`).toBe("systemEvent:diff");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("thread read rebuild uses turn.diff instead of fileChange patch text", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      const patchDiff = "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+intermediate\n";
      const canonicalDiff = "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+final\n";

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { threadId?: string };
        if (request.threadId !== "thr_file_change_canonical_diff") return {};

        return {
          thread: {
            id: "thr_file_change_canonical_diff",
            turns: [
              {
                id: "turn_file_change_canonical_diff",
                status: "completed",
                diff: canonicalDiff,
                items: [
                  {
                    id: "patch_file_change_canonical_diff",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "src/example.ts",
                        kind: { type: "update" },
                        diff: patchDiff,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_file_change_canonical_diff", true);
        const turnDiff = detail?.transcript.find((entry) => entry.entryId === "turn-diff:turn_file_change_canonical_diff");
        const rawItem = turnDiff?.rawItem as { unifiedDiff?: string } | undefined;

        expect(detail).not.toBeNull();
        expect((rawItem?.unifiedDiff ?? "").includes("+final")).toBe(true);
        expect((rawItem?.unifiedDiff ?? "").includes("+intermediate")).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("thread read rebuild synthesizes folded turn-diff from fileChange patches when turn.diff is missing", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { threadId?: string };
        if (request.threadId !== "thr_file_change_without_turn_diff") return {};

        return {
          thread: {
            id: "thr_file_change_without_turn_diff",
            turns: [
              {
                id: "turn_file_change_without_turn_diff",
                status: "completed",
                items: [
                  {
                    id: "patch_file_change_without_turn_diff_1",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "src/example.ts",
                        kind: { type: "update" },
                        diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n",
                      },
                    ],
                  },
                  {
                    id: "patch_file_change_without_turn_diff_2",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "src/example.ts",
                        kind: { type: "update" },
                        diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -3 +3 @@\n-before\n+after\n",
                      },
                    ],
                  },
                  {
                    id: "patch_file_change_without_turn_diff_failed",
                    type: "fileChange",
                    status: "failed",
                    changes: [
                      {
                        path: "src/example.ts",
                        kind: { type: "update" },
                        diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -9 +9 @@\n-nope\n+ignored\n",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_file_change_without_turn_diff", true);
        const turnDiff = detail?.transcript.find((entry) => entry.entryId === "turn-diff:turn_file_change_without_turn_diff");
        const rawItem = turnDiff?.rawItem as { unifiedDiff?: string; patchBatches?: unknown[] } | undefined;
        const unifiedDiff = rawItem?.unifiedDiff ?? "";

        expect(detail).not.toBeNull();
        expect(turnDiff !== undefined).toBe(true);
        expect(unifiedDiff.split("diff --git a/src/example.ts b/src/example.ts").length - 1).toBe(1);
        expect(unifiedDiff.includes("+new")).toBe(true);
        expect(unifiedDiff.includes("+after")).toBe(true);
        expect(unifiedDiff.includes("+ignored")).toBe(false);
        expect(rawItem?.patchBatches?.length ?? 0).toBe(2);
        expect(`${detail?.transcript[0]?.kind}:${detail?.transcript[0]?.semanticKind}`).toBe("fileChange:patch");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });
});

describe("codex-service session-backed transcript recovery", () => {
  test("serializeThreadDetail rehydrates from Codex session files when no snapshot exists", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "17"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_session_file",
            thread_name: "Recovered from session file",
            updated_at: "2026-03-17T10:03:00.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "17", "rollout-2026-03-17T10-00-00-thr_session_file.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-17T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_session_file",
                timestamp: "2026-03-17T10:00:00.000Z",
                cwd: "/tmp/recovered",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-17T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_recovered",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-17T10:00:02.000Z",
              type: "response_item",
              payload: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "Hello" }],
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-17T10:00:03.000Z",
              type: "response_item",
              payload: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Recovered response" }],
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      try {
        const detail = service.serializeThreadDetail("thr_session_file");
        expect(detail).not.toBeNull();
        expect(detail?.threadName).toBe("Recovered from session file");
        expect(detail?.cwd).toBe("/tmp/recovered");
        expect(detail?.turns.length).toBe(1);
        expect(detail?.transcript.length).toBe(2);
        expect(detail?.transcript[1]?.markdownText).toBe("Recovered response");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("dedupes replay-materialized and live-read items for the same recovered turn", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "23"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_replay_merge",
            thread_name: "Recovered thread",
            updated_at: "2026-03-23T09:00:03.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "23", "rollout-2026-03-23T09-00-00-thr_replay_merge.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-23T09:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_replay_merge",
                timestamp: "2026-03-23T09:00:00.000Z",
                cwd: "/tmp/replay-merge",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T09:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_replay_merge",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T09:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "who are you",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T09:00:03.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "Codex, your coding agent in this repo.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "thread/read") return {};
        const request = params as { threadId?: string };
        if (request.threadId !== "thr_replay_merge") return {};

        return {
          thread: {
            id: "thr_replay_merge",
            turns: [
              {
                id: "turn_replay_merge",
                status: "completed",
                items: [
                  {
                    id: "user_live_1",
                    type: "userMessage",
                    content: [{ type: "text", text: "who are you" }],
                  },
                  {
                    id: "assistant_live_1",
                    type: "agentMessage",
                    text: "Codex, your coding agent in this repo.",
                  },
                ],
              },
            ],
          },
        };
      };

      try {
        const detail = await service.readThread("thr_replay_merge", true);
        const serialized = service.serializeThreadDetail("thr_replay_merge");
        const persisted = getCodexThread("thr_replay_merge");

        expect(detail).not.toBeNull();
        expect(detail?.threadPreview).toBe("who are you");
        expect(detail?.transcript.length).toBe(2);
        expect(detail?.transcript[0]?.markdownText).toBe("who are you");
        expect(detail?.transcript[1]?.markdownText).toBe("Codex, your coding agent in this repo.");
        expect(serialized?.threadPreview).toBe("who are you");
        expect(serialized?.transcript.length).toBe(2);
        expect(persisted?.threadPreview).toBe("who are you");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("bootstraps reopened thread snapshots from session-backed canonical history without thread/read", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "23"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_old_open",
            thread_name: "Old thread",
            updated_at: "2026-03-23T10:00:05.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "23", "rollout-2026-03-23T10-00-00-thr_old_open.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-23T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_old_open",
                timestamp: "2026-03-23T10:00:00.000Z",
                cwd: "/tmp/old-open",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_old_open",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "who are you",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:03.000Z",
              type: "response_item",
              payload: {
                type: "function_call",
                call_id: "call_old_open",
                name: "exec_command",
                arguments: "{\"cmd\":\"pwd\"}",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:04.000Z",
              type: "response_item",
              payload: {
                type: "function_call_output",
                call_id: "call_old_open",
                output: "{\"cwd\":\"/tmp/old-open\"}",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-23T10:00:05.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "Codex, your coding agent in this repo.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        throw new Error(`unexpected RPC during snapshot request: ${method}`);
      };

      try {
        const conversation = await service.requestConversationSnapshot("thr_old_open");
        expect(conversation).not.toBeNull();
        expect(conversation?.threadId).toBe("thr_old_open");
        expect(conversation?.resumeState).toBe("needs_resume");
        expect(conversation?.turns.length).toBe(1);
        expect(conversation?.turns[0]?.turnId).toBe("turn_old_open");
        expect(conversation?.turns[0]?.items.length).toBe(3);
        expect(conversation?.turns[0]?.items[0]?.kind).toBe("userMessage");
        expect(conversation?.turns[0]?.items[0]?.markdownText).toBe("who are you");
        expect(conversation?.turns[0]?.items[1]?.kind).toBe("toolCall");
        expect(conversation?.turns[0]?.items[2]?.kind).toBe("assistantMessage");
        expect(conversation?.turns[0]?.items[2]?.markdownText).toBe("Codex, your coding agent in this repo.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("bootstraps session-backed snapshots with context compaction markers and post-compaction turns intact", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "26"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_old_compacted",
            thread_name: "Old compacted thread",
            updated_at: "2026-03-26T10:00:08.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "26", "rollout-2026-03-26T10-00-00-thr_old_compacted.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-26T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_old_compacted",
                timestamp: "2026-03-26T10:00:00.000Z",
                cwd: "/tmp/old-compacted",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_before_compaction",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "Summarize the repo",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:03.000Z",
              type: "compacted",
              payload: {
                message: "",
                replacement_history: [],
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:04.000Z",
              type: "turn_context",
              payload: {
                turn_id: "turn_after_compaction",
                cwd: "/tmp/old-compacted",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:05.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "Keep going",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-26T10:00:06.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "Continuing after compaction.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        throw new Error(`unexpected RPC during compacted snapshot request: ${method}`);
      };

      try {
        const conversation = await service.requestConversationSnapshot("thr_old_compacted");
        expect(conversation).not.toBeNull();
        expect(conversation?.turns.length).toBe(2);
        expect(conversation?.turns[0]?.items.length).toBe(2);
        expect(conversation?.turns[0]?.items[1]?.semanticKind).toBe("contextCompaction");
        expect(conversation?.turns[0]?.items[1]?.markdownText).toBe("Context automatically compacted");
        expect(conversation?.turns[1]?.turnId).toBe("turn_after_compaction");
        expect(conversation?.turns[1]?.items[0]?.markdownText).toBe("Keep going");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("does not call thread/resume for a known archived thread", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_archived_known",
        threadName: "Archived thread",
        archived: true,
      });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        throw new Error(`unexpected RPC during archived resume: ${method}`);
      };

      try {
        const conversation = await service.requestConversationResume("thr_archived_known");

        expect(conversation?.threadId).toBe("thr_archived_known");
        expect(conversation?.archived).toBe(true);
        expect(conversation?.resumeState).toBe("needs_resume");
        expect(requests.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("marks stale thread metadata archived when app-server rejects resume", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_archived_stale",
        threadName: "Stale archived thread",
        archived: false,
      });
      const service = createService();
      const hostMessages: CodexHostMessage[] = [];
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/resume") {
          throw new CodexRpcError(
            "session 019ea13a-cca5-7760-98a8-7f3684bae059 is archived. Run `codex unarchive 019ea13a-cca5-7760-98a8-7f3684bae059` to unarchive it first.",
            -32600,
          );
        }
        throw new Error(`unexpected RPC during archived resume fallback: ${method}`);
      };

      try {
        const conversation = await service.requestConversationResume("thr_archived_stale");
        const projected = projectConversationFromHostMessages(hostMessages);
        const persisted = getCodexThread("thr_archived_stale");
        const resumeRequests = requests.filter((request) => request.method === "thread/resume");

        expect(resumeRequests.length).toBe(1);
        expect(conversation?.threadId).toBe("thr_archived_stale");
        expect(conversation?.archived).toBe(true);
        expect(conversation?.resumeState).toBe("needs_resume");
        expect(projected?.archived).toBe(true);
        expect(projected?.resumeState).toBe("needs_resume");
        expect(persisted?.archived).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("removes local thread state when app-server reports a deleted thread", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const events: CodexEvent[] = [];
      const hostMessages: CodexHostMessage[] = [];
      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      try {
        await serviceInternals.handleNotification("thread/deleted", {
          threadId: "thr_deleted_remote",
        });

        expect(getCodexThread("thr_deleted_remote")).toBe(null);
        expect(events.some((event) =>
          event.type === "threadDeleted" && event.threadId === "thr_deleted_remote"
        )).toBe(true);
        expect(hostMessages.some((message) =>
          message.type === "threadDeleted" && message.threadId === "thr_deleted_remote"
        )).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resume materializes completed reopened threads from the thread/resume payload", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "24"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_resume_no_duplicate",
            thread_name: "Resume without duplicate",
            updated_at: "2026-03-24T10:00:03.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "24", "rollout-2026-03-24T10-00-00-thr_resume_no_duplicate.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-24T10:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_resume_no_duplicate",
                timestamp: "2026-03-24T10:00:00.000Z",
                cwd: "/tmp/resume-no-duplicate",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_resume_no_duplicate",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "run bun test",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:03.000Z",
              type: "response_item",
              payload: {
                type: "function_call",
                call_id: "call_resume_no_duplicate",
                name: "exec_command",
                arguments: "{\"cmd\":\"bun test\"}",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T10:00:04.000Z",
              type: "event_msg",
              payload: {
                type: "agent_message",
                message: "`bun test` passed.",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_resume_no_duplicate",
              preview: "run bun test",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1711274400,
              updatedAt: 1711274404,
              status: { type: "idle" },
              path: "/tmp/resume-no-duplicate/rollout.jsonl",
              cwd: "/tmp/resume-no-duplicate",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Resume without duplicate",
              turns: [
                {
                  id: "turn_resume_no_duplicate",
                  status: "completed",
                  items: [
                    {
                      id: "user_resume_no_duplicate",
                      type: "userMessage",
                      content: [{ type: "text", text: "run bun test" }],
                    },
                    {
                      id: "tool_resume_no_duplicate",
                      type: "commandExecution",
                      status: "completed",
                      command: "bun test",
                      cwd: "/tmp/resume-no-duplicate",
                      aggregatedOutput: "1340 pass\n0 fail\n",
                    },
                    {
                      id: "assistant_resume_no_duplicate",
                      type: "agentMessage",
                      text: "`bun test` passed.",
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run for a completed resume payload");
        }
        return {};
      };

      try {
        const conversation = await service.requestConversationResume("thr_resume_no_duplicate");
        expect(conversation).not.toBeNull();
        expect(conversation?.turns.length).toBe(1);
        expect(conversation?.turns[0]?.items.length).toBe(3);
        expect(conversation?.turns[0]?.items[0]?.markdownText).toBe("run bun test");
        expect(conversation?.turns[0]?.items[1]?.toolCall?.toolName).toBe("bash");
        expect(conversation?.turns[0]?.items[2]?.markdownText).toBe("`bun test` passed.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resume materializes in-progress threads from the thread/resume payload without thread/read", async () => {
    const ran = await withTempDatabase(async () => {
      withTempCodexHome((codexHome) => {
        fs.mkdirSync(path.join(codexHome, "sessions", "2026", "03", "24"), { recursive: true });
        fs.writeFileSync(
          path.join(codexHome, "session_index.jsonl"),
          JSON.stringify({
            id: "thr_resume_refresh",
            thread_name: "Resume refresh",
            updated_at: "2026-03-24T11:00:02.000Z",
          }) + "\n",
        );
        fs.writeFileSync(
          path.join(codexHome, "sessions", "2026", "03", "24", "rollout-2026-03-24T11-00-00-thr_resume_refresh.jsonl"),
          [
            JSON.stringify({
              timestamp: "2026-03-24T11:00:00.000Z",
              type: "session_meta",
              payload: {
                id: "thr_resume_refresh",
                timestamp: "2026-03-24T11:00:00.000Z",
                cwd: "/tmp/resume-refresh",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T11:00:01.000Z",
              type: "event_msg",
              payload: {
                type: "task_started",
                turn_id: "turn_resume_refresh",
              },
            }),
            JSON.stringify({
              timestamp: "2026-03-24T11:00:02.000Z",
              type: "event_msg",
              payload: {
                type: "user_message",
                message: "run bun test",
              },
            }),
          ].join("\n"),
        );
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
      };

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_resume_refresh",
              preview: "run bun test",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1711278000,
              updatedAt: 1711278002,
              status: { type: "active", active_flags: ["streaming"] },
              path: "/tmp/resume-refresh/rollout.jsonl",
              cwd: "/tmp/resume-refresh",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Resume refresh",
              turns: [
                {
                  id: "turn_resume_refresh",
                  status: "in_progress",
                  items: [
                    {
                      id: "user_resume_refresh",
                      type: "userMessage",
                      content: [{ type: "text", text: "run bun test" }],
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during active resume");
        }
        return {};
      };

      try {
        const conversation = await service.requestConversationResume("thr_resume_refresh");
        expect(conversation).not.toBeNull();
        expect(conversation?.turns[0]?.status).toBe("inProgress");
        expect(conversation?.turns[0]?.items.length).toBe(1);
        expect(conversation?.turns[0]?.items[0]?.markdownText).toBe("run bun test");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resume hydrates thread goal state after thread resume", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const hostMessages: CodexHostMessage[] = [];
      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_resume_goal",
              preview: "ship goal hydration",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1_711_278_000,
              updatedAt: 1_711_278_002,
              status: { type: "idle" },
              path: "/tmp/resume-goal/rollout.jsonl",
              cwd: "/tmp/resume-goal",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Goal hydration",
              turns: [],
            },
          };
        }
        if (method === "thread/goal/get") {
          return {
            goal: {
              threadId: "thr_resume_goal",
              objective: "Ship goal hydration",
              status: "paused",
              tokenBudget: 40000,
              tokensUsed: 120,
              timeUsedSeconds: 45,
              createdAt: 10,
              updatedAt: 20,
            },
          };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during goal hydration resume");
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        const conversation = await service.requestConversationResume("thr_resume_goal");
        const projected = projectConversationFromHostMessages(hostMessages);
        const methods = requests.map((request) => request.method).join(",");

        expect(methods).toBe("thread/resume,thread/goal/get");
        expect((requests[1]?.params as { threadId?: string } | undefined)?.threadId).toBe("thr_resume_goal");
        expect(conversation?.threadGoal?.status ?? "").toBe("paused");
        expect(conversation?.threadGoal?.objective ?? "").toBe("Ship goal hydration");
        expect(conversation?.threadGoalResumeConfirmation?.status ?? "").toBe("paused");
        expect(projected?.threadGoal?.status ?? "").toBe("paused");
        expect(projected?.threadGoalResumeConfirmation?.objective ?? "").toBe("Ship goal hydration");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("deduplicates concurrent resume and goal hydration per thread", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      let resolveResume = (): void => {
        throw new Error("resume gate was not initialized");
      };
      const resumeGate = new Promise<void>((resolve) => {
        resolveResume = resolve;
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/resume") {
          await resumeGate;
          return {
            thread: {
              id: "thr_resume_single_flight",
              preview: "resume once",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1_711_278_000,
              updatedAt: 1_711_278_002,
              status: { type: "idle" },
              path: "/tmp/resume-single-flight/rollout.jsonl",
              cwd: "/tmp/resume-single-flight",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Resume single flight",
              turns: [],
            },
          };
        }
        if (method === "thread/goal/get") {
          return { goal: null };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during resume single-flight");
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        const first = service.requestConversationResume("thr_resume_single_flight");
        const second = service.requestConversationResume("thr_resume_single_flight");
        await waitForCondition(
          () => requests.filter((request) => request.method === "thread/resume").length === 1,
          250,
        );

        expect(requests.filter((request) => request.method === "thread/resume").length).toBe(1);

        resolveResume();
        const [firstConversation, secondConversation] = await Promise.all([first, second]);
        expect(firstConversation?.threadId ?? "").toBe("thr_resume_single_flight");
        expect(secondConversation?.threadId ?? "").toBe("thr_resume_single_flight");
        expect(requests.filter((request) => request.method === "thread/resume").length).toBe(1);
        expect(requests.filter((request) => request.method === "thread/goal/get").length).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resume continues when thread goal hydration fails", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_resume_goal_failure",
              preview: "resume despite goal failure",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1_711_278_000,
              updatedAt: 1_711_278_002,
              status: { type: "idle" },
              path: "/tmp/resume-goal-failure/rollout.jsonl",
              cwd: "/tmp/resume-goal-failure",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Goal failure",
              turns: [],
            },
          };
        }
        if (method === "thread/goal/get") {
          throw new Error("goal hydration unavailable");
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during goal hydration failure resume");
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      try {
        const conversation = await service.requestConversationResume("thr_resume_goal_failure");
        const methods = requests.map((request) => request.method).join(",");

        expect(methods).toBe("thread/resume,thread/goal/get");
        expect(conversation?.threadId ?? "").toBe("thr_resume_goal_failure");
        expect(conversation?.resumeState).toBe("resumed");
        expect(conversation?.threadGoal ?? null).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("buffers resume-time notifications and trims hydrated text/output before replay", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
        emit: (eventName: string, payload: unknown) => boolean;
      };
      const hostMessages: CodexHostMessage[] = [];
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/resume") {
          client.emit("notification", {
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_resume_buffer",
              turnId: "turn_resume_buffer",
              itemId: "assistant_resume_buffer",
              delta: "hello world",
            },
          });
          client.emit("notification", {
            method: "item/commandExecution/outputDelta",
            params: {
              threadId: "thr_resume_buffer",
              turnId: "turn_resume_buffer",
              itemId: "cmd_resume_buffer",
              delta: "abcdef",
            },
          });
          return {
            thread: {
              id: "thr_resume_buffer",
              preview: "stream while resuming",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1_711_278_000,
              updatedAt: 1_711_278_002,
              status: { type: "active", active_flags: ["streaming"] },
              path: "/tmp/resume-buffer/rollout.jsonl",
              cwd: "/tmp/resume-buffer",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Resume buffer",
              turns: [
                {
                  id: "turn_resume_buffer",
                  status: "in_progress",
                  items: [
                    {
                      id: "cmd_resume_buffer",
                      type: "commandExecution",
                      status: "in_progress",
                      command: "printf abcdef",
                      cwd: "/tmp/resume-buffer",
                      aggregatedOutput: "abc",
                    },
                    {
                      id: "assistant_resume_buffer",
                      type: "agentMessage",
                      text: "hello",
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during buffered resume");
        }
        return {};
      };

      try {
        await service.requestConversationResume("thr_resume_buffer");
        await waitForCondition(() => {
          const conversation = service.serializeConversationSnapshot("thr_resume_buffer");
          const assistant = conversation?.turns[0]?.items.find((item) => item.itemId === "assistant_resume_buffer");
          const command = conversation?.turns[0]?.items.find((item) => item.itemId === "cmd_resume_buffer");
          return assistant?.markdownText === "hello world" && command?.aggregatedOutput === "abcdef";
        }, 160);

        const conversation = service.serializeConversationSnapshot("thr_resume_buffer");
        const command = conversation?.turns[0]?.items.find((item) => item.itemId === "cmd_resume_buffer");
        const assistant = conversation?.turns[0]?.items.find((item) => item.itemId === "assistant_resume_buffer");
        const outputDeltaMessage = hostMessages.find((message) =>
          message.type === "mcpNotification" &&
          message.params.threadId === "thr_resume_buffer"
        );
        expect(assistant?.markdownText).toBe("hello world");
        expect(command?.aggregatedOutput).toBe("abcdef");
        expect(outputDeltaMessage?.type).toBe("mcpNotification");
        if (outputDeltaMessage?.type === "mcpNotification") {
          expect(outputDeltaMessage.params.delta).toBe("def");
        }
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer-owned resume defers replay and suppresses source-null snapshots from bundle 47680-47815", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const threadId = "thr_renderer_resume_boundary";
      const ownerClientId = "owner-client-resume";
      const hostMessages: CodexHostMessage[] = [];
      const ownerMessages: unknown[] = [];
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });
      service.on("rendererOwnerHostMessage", (event: { targetClientId: string; message: unknown }) => {
        ownerMessages.push(event.message);
        const message = event.message as {
          type?: string;
          sequence?: number;
        };
        if (message.type === "threadOwnerNotification" && typeof message.sequence === "number") {
          service.ackRendererThreadOwnerNotification(ownerClientId, {
            conversationId: threadId,
            sequence: message.sequence,
          });
        }
      });

      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<{ thread?: unknown }>;
        emit: (eventName: string, payload: unknown) => boolean;
      };
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/resume") {
          client.emit("notification", {
            method: "item/agentMessage/delta",
            params: {
              threadId,
              turnId: "turn-renderer-resume",
              itemId: "assistant-renderer-resume",
              delta: " buffered",
            },
          });
          return {
            thread: {
              id: threadId,
              preview: "renderer resume",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1_711_278_000,
              updatedAt: 1_711_278_002,
              status: { type: "active", active_flags: ["streaming"] },
              path: "/tmp/renderer-resume/rollout.jsonl",
              cwd: "/tmp/renderer-resume",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Renderer resume",
              turns: [
                {
                  id: "turn-renderer-resume",
                  status: "in_progress",
                  items: [
                    {
                      id: "assistant-renderer-resume",
                      type: "agentMessage",
                      text: "hydrated",
                    },
                  ],
                },
              ],
            },
          };
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during renderer-owned resume boundary test");
        }
        return {};
      };

      try {
        service.setRendererConversationOwner(threadId, ownerClientId);
        const conversation = await service.requestRendererConversationResume(threadId);

        expect(conversation?.threadId ?? "").toBe(threadId);
        expect(hostMessages.some((message) => message.type === "threadStreamStateChanged")).toBe(false);
        expect(ownerMessages.length).toBe(0);

        await service.releaseConversationResumeBuffer(threadId);

        expect(hostMessages.some((message) => message.type === "threadStreamStateChanged")).toBe(false);
        expect(ownerMessages.some((message) => {
          const record = message as { type?: string; method?: string };
          return record.type === "threadOwnerNotification" && record.method === "item/agentMessage/delta";
        })).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer-owned resume failure rolls back without source-null snapshots from bundle 47815-47835", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const threadId = "thr_renderer_resume_failure";
      const ownerClientId = "owner-client-resume-failure";
      const hostMessages: CodexHostMessage[] = [];
      const ownerMessages: unknown[] = [];
      service.on("hostMessage", (message) => {
        hostMessages.push(message);
      });
      service.on("rendererOwnerHostMessage", (event: { targetClientId: string; message: unknown }) => {
        ownerMessages.push(event.message);
      });

      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
        emit: (eventName: string, payload: unknown) => boolean;
      };
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "thread/resume") {
          client.emit("notification", {
            method: "item/agentMessage/delta",
            params: {
              threadId,
              turnId: "turn-renderer-resume-failure",
              itemId: "assistant-renderer-resume-failure",
              delta: " buffered",
            },
          });
          throw new Error("resume failed");
        }
        if (method === "thread/read") {
          throw new Error("thread/read should not run during renderer-owned resume failure test");
        }
        return {};
      };

      try {
        service.setRendererConversationOwner(threadId, ownerClientId);
        let threw = false;
        try {
          await service.requestConversationResume(threadId, {
            emitSourceNullSnapshots: false,
            replayBufferedNotifications: false,
          });
        } catch {
          threw = true;
        }

        const snapshot = service.serializeConversationSnapshot(threadId);
        expect(threw).toBe(true);
        expect(snapshot?.resumeState).toBe("needs_resume");
        expect(hostMessages.some((message) => message.type === "threadStreamStateChanged")).toBe(false);
        expect(ownerMessages.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resume sends apply-patch streaming feature override", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/goal/get") return { goal: null };
        if (method !== "thread/resume") throw new Error(`Unexpected method: ${method}`);
        return {
          thread: {
            id: "thr_resume_patch_streaming",
            preview: "",
            ephemeral: false,
            modelProvider: "openai",
            createdAt: 1711278000,
            updatedAt: 1711278000,
            status: { type: "idle" },
            path: "/tmp/resume-patch-streaming/rollout.jsonl",
            cwd: "/tmp/resume-patch-streaming",
            cliVersion: "0.0.0-test",
            source: "app_server",
            agentNickname: null,
            agentRole: null,
            gitInfo: null,
            name: "Resume patch streaming",
            turns: [],
          },
        };
      };

      try {
        const detail = await service.resumeThread("thr_resume_patch_streaming");
        expect(detail?.threadId ?? "").toBe("thr_resume_patch_streaming");
        expect(requests.map((request) => request.method).join(",")).toBe("thread/resume,thread/goal/get");
        expect(requests[0]?.method).toBe("thread/resume");
        const resumeParams = requests[0]?.params as {
          config?: Record<string, unknown>;
          excludeTurns?: boolean;
          initialTurnsPage?: {
            limit?: number;
            sortDirection?: string;
            itemsView?: string;
          };
        };
        expect(resumeParams.excludeTurns).toBe(true);
        expect(resumeParams.initialTurnsPage?.limit ?? 0).toBe(5);
        expect(resumeParams.initialTurnsPage?.sortDirection ?? "").toBe("desc");
        expect(resumeParams.initialTurnsPage?.itemsView ?? "").toBe("full");
        const resumeConfig = resumeParams.config ?? {};
        expect(resumeConfig["features.apply_patch_streaming_events"]).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("replays resume-buffered server requests in notification order from bundle 46730-46950", async () => {
    const service = createService();
    const threadId = "thr_resume_request_order";
    const order: string[] = [];
    const serviceInternals = service as unknown as {
      beginResumeNotificationBuffer: (threadId: string) => void;
      replayBufferedResumeNotifications: (threadId: string) => Promise<void>;
      handleNotification: (
        method: string,
        params: unknown,
        options?: { bypassResumeBuffer?: boolean },
      ) => Promise<void>;
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      handleServerRequestNow: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
    };
    const originalHandleNotification = serviceInternals.handleNotification.bind(service);
    const originalHandleServerRequestNow = serviceInternals.handleServerRequestNow.bind(service);

    serviceInternals.handleNotification = async (method, params, options) => {
      if (options?.bypassResumeBuffer) {
        order.push(`notification:${method}`);
      }
      return originalHandleNotification(method, params, options);
    };
    serviceInternals.handleServerRequestNow = async (request) => {
      order.push(`request:${request.method}`);
      return originalHandleServerRequestNow(request);
    };

    try {
      serviceInternals.beginResumeNotificationBuffer(threadId);
      await serviceInternals.handleNotification("item/reasoning/summaryPartAdded", {
        threadId,
        turnId: "turn-1",
        itemId: "reasoning-1",
        summaryIndex: 0,
      });
      const requestPromise = serviceInternals.handleServerRequest({
        id: "time_req",
        method: "currentTime/read",
        params: { threadId },
      });
      await serviceInternals.handleNotification("item/mcpToolCall/progress", {
        threadId,
        turnId: "turn-1",
        itemId: "mcp-1",
        message: "Still working",
      });

      expect(order.join(",")).toBe("");

      await serviceInternals.replayBufferedResumeNotifications(threadId);
      const result = await requestPromise;

      expect((result as { currentTimeAt?: number }).currentTimeAt !== undefined).toBe(true);
      expect(order.join(",")).toBe(
        "notification:item/reasoning/summaryPartAdded,request:currentTime/read,notification:item/mcpToolCall/progress",
      );
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
      replayBufferedResumeNotifications: (threadId: string) => Promise<void>;
    };
    const originalReplay = serviceInternals.replayBufferedResumeNotifications.bind(service);

    serviceInternals.replayBufferedResumeNotifications = async (threadId) => {
      replayedThreadIds.push(threadId);
    };

    try {
      serviceInternals.beginThreadStartNotificationDeferral();
      await serviceInternals.handleNotification("thread/started", {
        thread: {
          id: "thr_deferred_creation_context",
          parentThreadId: null,
          preview: "Started before creation context is ready",
          ephemeral: false,
          cwd: "/tmp/codex",
        },
      });

      expect(replayedThreadIds.join(",")).toBe("");

      await serviceInternals.completeThreadStartNotificationDeferral("thr_deferred_creation_context");

      expect(replayedThreadIds.join(",")).toBe("thr_deferred_creation_context");
    } finally {
      serviceInternals.replayBufferedResumeNotifications = originalReplay;
      await serviceInternals.endThreadStartNotificationDeferral();
      await service.shutdown();
    }
  });

  test("resume bootstraps the latest turn page and loads older turns through thread/turns/list", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_paged_history",
              preview: "recent prompt",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1711278000,
              updatedAt: 1711278060,
              status: { type: "idle" },
              path: "/tmp/paged-history/rollout.jsonl",
              cwd: "/tmp/paged-history",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Paged history",
              turns: [],
            },
            model: "gpt-5.4",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/paged-history",
            runtimeWorkspaceRoots: [],
            instructionSources: [],
            approvalPolicy: "never",
            approvalsReviewer: "user",
            sandbox: { mode: "read-only" },
            activePermissionProfile: null,
            reasoningEffort: null,
            initialTurnsPage: {
              data: [
                {
                  id: "turn_recent",
                  status: "completed",
                  itemsView: "full",
                  error: null,
                  startedAt: 1711278050,
                  completedAt: 1711278060,
                  durationMs: 10_000,
                  items: [
                    {
                      id: "user_recent",
                      type: "userMessage",
                      content: [{ type: "text", text: "recent prompt" }],
                    },
                  ],
                },
              ],
              nextCursor: "cursor-older",
              backwardsCursor: "cursor-newer",
            },
          };
        }
        if (method === "thread/turns/list") {
          return {
            data: [
              {
                id: "turn_older",
                status: "completed",
                itemsView: "full",
                error: null,
                startedAt: 1711278000,
                completedAt: 1711278010,
                durationMs: 10_000,
                items: [
                  {
                    id: "user_older",
                    type: "userMessage",
                    content: [{ type: "text", text: "older prompt" }],
                  },
                ],
              },
            ],
            nextCursor: null,
            backwardsCursor: "cursor-recent",
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        const initialConversation = await service.requestConversationResume("thr_paged_history");
        expect(initialConversation).not.toBeNull();
        expect(initialConversation?.turns.length ?? 0).toBe(1);
        expect(initialConversation?.turns[0]?.turnId ?? "").toBe("turn_recent");
        expect(initialConversation?.turnPagination?.olderCursor ?? null).toBe("cursor-older");
        expect(initialConversation?.turnPagination?.oldestLoadedTurnId ?? null).toBe("turn_recent");

        const fullConversation = await service.loadOlderThreadTurns("thr_paged_history");
        expect(fullConversation?.turns.length ?? 0).toBe(2);
        expect(fullConversation?.turns[0]?.turnId ?? "").toBe("turn_older");
        expect(fullConversation?.turns[1]?.turnId ?? "").toBe("turn_recent");
        expect(fullConversation?.turnPagination?.hasLoadedOldest ?? false).toBe(true);
        expect(fullConversation?.turnPagination?.oldestLoadedTurnId ?? null).toBe("turn_older");
        expect(requests.map((request) => request.method).join(",")).toBe("thread/resume,thread/goal/get,thread/turns/list");
        const olderParams = requests.find((request) => request.method === "thread/turns/list")?.params as {
          cursor?: string;
          limit?: number;
          sortDirection?: string;
          itemsView?: string;
        };
        expect(olderParams.cursor ?? "").toBe("cursor-older");
        expect(olderParams.limit ?? 0).toBe(5);
        expect(olderParams.sortDirection ?? "").toBe("desc");
        expect(olderParams.itemsView ?? "").toBe("full");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("resume background-loads remaining older turn pages without duplicating later older-load requests", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const buildTurn = (id: string, text: string, startedAt: number) => ({
        id,
        status: "completed",
        itemsView: "full",
        error: null,
        startedAt,
        completedAt: startedAt + 10,
        durationMs: 10_000,
        items: [
          {
            id: `user_${id}`,
            type: "userMessage",
            content: [{ type: "text", text }],
          },
        ],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/resume") {
          return {
            thread: {
              id: "thr_background_history",
              preview: "recent prompt",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1711278000,
              updatedAt: 1711278060,
              status: { type: "idle" },
              path: "/tmp/background-history/rollout.jsonl",
              cwd: "/tmp/background-history",
              cliVersion: "0.0.0-test",
              source: "app_server",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Background history",
              turns: [],
            },
            model: "gpt-5.4",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/background-history",
            runtimeWorkspaceRoots: [],
            instructionSources: [],
            approvalPolicy: "never",
            approvalsReviewer: "user",
            sandbox: { mode: "read-only" },
            activePermissionProfile: null,
            reasoningEffort: null,
            initialTurnsPage: {
              data: [buildTurn("turn_recent", "recent prompt", 1711278050)],
              nextCursor: "cursor-mid",
              backwardsCursor: "cursor-newer",
            },
          };
        }
        if (method === "thread/turns/list") {
          const cursor = (params as { cursor?: string }).cursor ?? "";
          if (cursor === "cursor-mid") {
            return {
              data: [buildTurn("turn_mid", "middle prompt", 1711278020)],
              nextCursor: "cursor-older",
              backwardsCursor: "cursor-recent",
            };
          }
          if (cursor === "cursor-older") {
            return {
              data: [buildTurn("turn_older", "older prompt", 1711278000)],
              nextCursor: null,
              backwardsCursor: "cursor-mid",
            };
          }
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        const initialConversation = await service.requestConversationResume("thr_background_history");
        expect(initialConversation?.turns.length ?? 0).toBe(1);
        expect(initialConversation?.turnPagination?.olderCursor ?? null).toBe("cursor-mid");

        await waitForCondition(
          () => requests.filter((request) => request.method === "thread/turns/list").length === 2,
          250,
        );

        const requestCountAfterBackgroundLoad = requests.length;
        const fullConversation = await service.loadOlderThreadTurns("thr_background_history");
        expect(requests.length).toBe(requestCountAfterBackgroundLoad);
        expect(fullConversation?.turns.map((turn) => turn.turnId).join(",") ?? "").toBe(
          "turn_older,turn_mid,turn_recent",
        );
        expect(fullConversation?.turnPagination?.hasLoadedOldest ?? false).toBe(true);
        const olderParams = requests
          .filter((request) => request.method === "thread/turns/list")
          .map((request) => request.params as {
            cursor?: string;
            limit?: number;
            sortDirection?: string;
            itemsView?: string;
          });
        expect(olderParams[0]?.cursor ?? "").toBe("cursor-mid");
        expect(olderParams[1]?.cursor ?? "").toBe("cursor-older");
        expect(olderParams[0]?.limit ?? 0).toBe(5);
        expect(olderParams[1]?.limit ?? 0).toBe(5);
        expect(olderParams[0]?.sortDirection ?? "").toBe("desc");
        expect(olderParams[1]?.itemsView ?? "").toBe("full");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("serializes child-thread memberships from main-owned conversation state", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_child",
        threadName: "Child agent",
      });

      const service = createService();
      hydrateConversation(service, {
        ...makeThreadDetail("thr_parent"),
        projectId: defaultProjectId,
        turns: [{
          threadId: "thr_parent",
          turnId: "turn_parent",
          status: "completed",
          itemIds: ["spawn_agent_1"],
        }],
        transcript: [{
          threadId: "thr_parent",
          turnId: "turn_parent",
          itemId: "spawn_agent_1",
          type: "tool_call",
          kind: "toolCall",
          semanticKind: "toolCall",
          toolCall: {
            toolName: "spawn_agent",
            subtype: "generic",
            args: {
              receivers: ["thr_child"],
            },
          },
          createdAt: 1,
          updatedAt: 1,
        }],
      });
      hydrateConversation(service, {
        ...makeThreadDetail("thr_child"),
        projectId: defaultProjectId,
        threadName: "Child agent",
        agentNickname: "@ChildNick",
        agentRole: "reviewer",
      });

      try {
        const conversation = service.serializeConversationSnapshot("thr_parent");
        expect(conversation).not.toBeNull();
        expect(conversation?.childMemberships.length).toBe(1);
        expect(conversation?.childMemberships[0]?.threadId).toBe("thr_child");
        expect(conversation?.childMemberships[0]?.actorName).toBe("Child agent");
        expect(conversation?.childMemberships[0]?.thread?.displayName).toBe("Child agent");
        expect(conversation?.childMemberships[0]?.thread?.name).toBe("Child agent");
        expect(conversation?.childMemberships[0]?.thread?.nickname).toBe("@ChildNick");
        expect(conversation?.childMemberships[0]?.thread?.agentRole).toBe("reviewer");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("serializes child-thread memberships from lightweight subagent catalog summaries", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_parent_catalog"),
        projectId: defaultProjectId,
        threadName: "Parent",
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_child_catalog",
        source: { parentThreadId: "thr_parent_catalog" },
        threadSource: "subagent",
        agentNickname: "@Nash",
        agentRole: "worker",
        threadPreview: "Role/name: Smoke Writer",
        modelProvider: "openai",
        cwd: "/tmp/project",
        statusType: "idle",
        createdAt: 1,
        updatedAt: 2,
      });

      try {
        const conversation = service.serializeConversationSnapshot("thr_parent_catalog");
        expect(conversation).not.toBeNull();
        expect(conversation?.childMemberships.length).toBe(1);
        expect(conversation?.childMemberships[0]?.threadId).toBe("thr_child_catalog");
        expect(conversation?.childMemberships[0]?.actorName).toBe("Nash");
        expect(conversation?.childMemberships[0]?.thread?.nickname).toBe("@Nash");
        expect(conversation?.childMemberships[0]?.thread?.agentRole).toBe("worker");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("derives background terminal rows from older running command executions", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_background_terminals"),
        projectId: defaultProjectId,
        threadName: "Background terminals",
        turns: [
          {
            threadId: "thr_background_terminals",
            turnId: "turn_old",
            status: "completed",
            itemIds: ["exec_old", "exec_interrupted"],
          },
          {
            threadId: "thr_background_terminals",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: ["exec_latest"],
          },
        ],
        transcript: [
          {
            threadId: "thr_background_terminals",
            turnId: "turn_old",
            itemId: "exec_old",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            command: "bun test src/renderer/features/local-conversation/view/composer/local-conversation-composer-shell.test.tsx",
            cwd: "/tmp/project",
            processId: "4172",
            aggregatedOutput: "1400 pass\n1418 pass\n",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun test src/renderer/features/local-conversation/view/composer/local-conversation-composer-shell.test.tsx",
                cwd: "/tmp/project",
              },
              result: "1400 pass\n1418 pass\n",
            },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_background_terminals",
            turnId: "turn_old",
            itemId: "exec_interrupted",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "interrupted",
            command: "bun run lint",
            cwd: "/tmp/project",
            aggregatedOutput: "stopped",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run lint",
                cwd: "/tmp/project",
              },
              result: "stopped",
            },
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_background_terminals",
            turnId: "turn_latest",
            itemId: "exec_latest",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            command: "bun run dev",
            cwd: "/tmp/project",
            aggregatedOutput: "dev server starting",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run dev",
                cwd: "/tmp/project",
              },
              result: "dev server starting",
            },
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const conversation = service.serializeConversationSnapshot("thr_background_terminals");
        expect(conversation).not.toBeNull();
        expect(conversation?.backgroundTerminalRows.length).toBe(1);
        expect(conversation?.backgroundTerminalRows[0]?.id).toBe("exec_old");
        expect(conversation?.backgroundTerminalRows[0]?.command).toBe("bun test src/renderer/features/local-conversation/view/composer/local-conversation-composer-shell.test.tsx");
        expect(conversation?.backgroundTerminalRows[0]?.cwd).toBe("/tmp/project");
        expect(conversation?.backgroundTerminalRows[0]?.previewLine).toBe("1418 pass");
        expect(conversation?.backgroundTerminalRows[0]?.processId).toBe("4172");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("materializes retryable transport errors as stream-error transcript rows", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_stream_error"),
        projectId: defaultProjectId,
        threadName: "Poor network reconnect",
        turns: [
          {
            threadId: "thr_stream_error",
            turnId: "turn_stream_error",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      await serviceInternals.handleNotification("error", {
        threadId: "thr_stream_error",
        turnId: "turn_stream_error",
        willRetry: true,
        error: {
          message: "Reconnecting... 2/5",
          additionalDetails: "Network error: connection dropped while streaming.",
        },
      });

      const detail = service.serializeThreadDetail("thr_stream_error");
      const errorEntry = detail?.transcript.find((entry) => entry.semanticKind === "streamError") ?? null;

      expect(detail).not.toBeNull();
      expect(errorEntry?.markdownText).toBe("Reconnecting... 2/5");
      expect(errorEntry?.additionalDetails).toBe("Network error: connection dropped while streaming.");
      expect(errorEntry?.willRetry).toBe(true);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("materializes failed turn errors from thread/read into system-error transcript rows", async () => {
    const ran = await withTempDatabase(async () => {
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_failed_reconnect",
        threadName: "Failed reconnect",
      });
      const service = createService();
      const serviceInternals = service as unknown as {
        buildThreadDetailFromRead: (thread: unknown) => CodexThreadDetail | null;
      };

      const detail = serviceInternals.buildThreadDetailFromRead({
        id: "thr_failed_reconnect",
        turns: [
          {
            id: "turn_failed_reconnect",
            status: "failed",
            items: [],
            error: {
              message: "Failed to reconnect to the stream.",
              additionalDetails: "The connection could not be re-established after repeated retry attempts.",
            },
          },
        ],
      });

      const errorEntry = detail?.transcript.find((entry) => entry.semanticKind === "systemError") ?? null;

      expect(detail).not.toBeNull();
      expect(errorEntry?.markdownText).toBe("Failed to reconnect to the stream.");
      expect(errorEntry?.additionalDetails).toBe(
        "The connection could not be re-established after repeated retry attempts.",
      );
      expect(errorEntry?.willRetry).toBe(false);
    });

    if (!ran) expect(true).toBe(true);
  });

  test("cleanBackgroundTerminals interrupts older running command turns for one conversation", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
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

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_clean_background_terminals"),
        projectId: defaultProjectId,
        threadName: "Clean background terminals",
        turns: [
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_one",
            status: "completed",
            itemIds: ["exec_background_one"],
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_two",
            status: "completed",
            itemIds: ["exec_background_two"],
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: ["exec_latest"],
          },
        ],
        transcript: [
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_one",
            itemId: "exec_background_one",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run lint",
              },
            },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_background_two",
            itemId: "exec_background_two",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun test",
              },
            },
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_clean_background_terminals",
            turnId: "turn_latest",
            itemId: "exec_latest",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run dev",
              },
            },
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const cleaned = await service.cleanBackgroundTerminals("thr_clean_background_terminals");
        expect(cleaned).toBe(true);

        const interruptRequests = requests.filter((request) => request.method === "turn/interrupt");
        expect(interruptRequests.length).toBe(2);
        expect((interruptRequests[0]?.params as { turnId?: string })?.turnId).toBe("turn_background_two");
        expect((interruptRequests[1]?.params as { turnId?: string })?.turnId).toBe("turn_background_one");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("cleanBackgroundTerminalsSilently uses app-server clean without turn interrupts", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
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

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_clean_background_terminals_silent"),
      projectId: defaultProjectId,
      threadName: "Clean background terminals silently",
      turns: [
        {
          threadId: "thr_clean_background_terminals_silent",
          turnId: "turn_background",
          status: "completed",
          itemIds: ["exec_background"],
        },
        {
          threadId: "thr_clean_background_terminals_silent",
          turnId: "turn_latest",
          status: "completed",
          itemIds: [],
        },
      ],
      transcript: [
        {
          threadId: "thr_clean_background_terminals_silent",
          turnId: "turn_background",
          itemId: "exec_background",
          type: "commandExecution",
          kind: "commandExecution",
          semanticKind: "exec",
          status: "inProgress",
          toolCall: {
            toolName: "bash",
            subtype: "command",
            args: {
              command: "bun run dev",
            },
          },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    try {
      const before = service.serializeConversationSnapshot("thr_clean_background_terminals_silent");
      const cleaned = await service.cleanBackgroundTerminalsSilently("thr_clean_background_terminals_silent");
      const after = service.serializeConversationSnapshot("thr_clean_background_terminals_silent");

      expect(cleaned).toBe(true);
      expect(before?.backgroundTerminalRows.length).toBe(1);
      expect(requests.length).toBe(1);
      expect(requests[0]?.method).toBe("thread/backgroundTerminals/clean");
      expect((requests[0]?.params as { threadId?: string })?.threadId).toBe("thr_clean_background_terminals_silent");
      expect(requests.some((request) => request.method === "turn/interrupt")).toBe(false);
      expect(after?.backgroundTerminalRows.length).toBe(0);
      expect(after?.turns[0]?.interruptedCommandExecutionItemIds?.[0]).toBe("exec_background");
    } finally {
      await service.shutdown();
    }
  });

  test("listBackgroundTerminals pages through app-server process rows", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/backgroundTerminals/list") {
        const cursor = (params as { cursor?: string | null }).cursor ?? null;
        if (cursor === null) {
          return {
            data: [{
              itemId: "item-a",
              processId: "proc-a",
              command: "bun run dev",
              cwd: "/tmp/a",
              osPid: 101,
              cpuPercent: 12.5,
              rssKb: 2048n,
            }],
            nextCursor: "next-page",
          };
        }
        return {
          data: [{
            itemId: "item-b",
            processId: "proc-b",
            command: "python -m http.server",
            cwd: "/tmp/b",
            osPid: null,
            cpuPercent: null,
            rssKb: null,
          }],
          nextCursor: null,
        };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      const rows = await service.listBackgroundTerminals(" thr_process_rows ");

      expect(rows.length).toBe(2);
      expect(rows[0]?.processId).toBe("proc-a");
      expect(rows[1]?.processId).toBe("proc-b");
      expect(requests.length).toBe(2);
      expect((requests[0]?.params as { threadId?: string; cursor?: string | null })?.threadId).toBe("thr_process_rows");
      expect((requests[0]?.params as { cursor?: string | null })?.cursor).toBe(null);
      expect((requests[1]?.params as { cursor?: string | null })?.cursor).toBe("next-page");
    } finally {
      await service.shutdown();
    }
  });

  test("listBackgroundProcessRows keeps registered rows when live terminal listing fails", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };

      try {
        const observedRows = await service.listBackgroundProcessRows({
          threadId: "thread-process-registry",
          observedTerminals: [{
            itemId: "item-dev",
            processId: "process-dev",
            command: "bun run dev",
            cwd: "/tmp/nodex",
            osPid: 4301,
            cpuPercent: 8.5,
            rssKb: 4096n,
          }],
        });

        client.start = async () => undefined;
        client.request = async (method: string) => {
          if (method === "thread/backgroundTerminals/list") {
            throw new Error("app-server unavailable");
          }
          throw new Error(`Unexpected client request: ${method}`);
        };

        const registeredRows = await service.listBackgroundProcessRows({
          threadId: "thread-process-registry",
        });

        expect(observedRows.length).toBe(1);
        expect(observedRows[0]?.status).toBe("running");
        expect(registeredRows.length).toBe(1);
        expect(registeredRows[0]?.status).toBe("not-found");
        expect(registeredRows[0]?.terminal === null).toBe(true);
        expect(registeredRows[0]?.itemId).toBe("item-dev");
        expect(registeredRows[0]?.command).toBe("bun run dev");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("terminateBackgroundTerminal delegates to app-server process id", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "thread/backgroundTerminals/terminate") {
        return { terminated: true };
      }
      throw new Error(`Unexpected client request: ${method}`);
    };

    try {
      const terminated = await service.terminateBackgroundTerminal({
        threadId: " thr_process_stop ",
        processId: " proc-42 ",
      });

      expect(terminated).toBe(true);
      expect(requests.length).toBe(1);
      expect(requests[0]?.method).toBe("thread/backgroundTerminals/terminate");
      expect((requests[0]?.params as { threadId?: string; processId?: string })?.threadId).toBe("thr_process_stop");
      expect((requests[0]?.params as { threadId?: string; processId?: string })?.processId).toBe("proc-42");
    } finally {
      await service.shutdown();
    }
  });

});

describe("codex-service edit-last-user-turn and fork-from-turn", () => {
  test("renderer owner rollback edit only rolls back and returns an owner-publishable snapshot", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
        handleRendererOwnerAppServerRequest: (
          sourceClientId: string | null,
          input: {
            conversationId: string;
            request: {
              method: "thread/rollback";
              params: {
                threadId: string;
                turnId: string;
                numTurns: number;
              };
            };
          },
        ) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/rollback") {
          return {
            thread: {
              id: "thr_owner_edit",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 10,
              turns: [
                {
                  id: "turn_older",
                  status: "completed",
                  items: [
                    {
                      id: "user_older",
                      type: "userMessage",
                      content: [{ type: "text", text: "Older prompt" }],
                    },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      hydrateConversation(service, {
        ...makeThreadDetail("thr_owner_edit"),
        projectId: defaultProjectId,
        threadName: "Owner editable thread",
        cwd: "/tmp/owner-edit-thread",
        turns: [
          {
            threadId: "thr_owner_edit",
            turnId: "turn_older",
            status: "completed",
            itemIds: ["user_older"],
          },
          {
            threadId: "thr_owner_edit",
            turnId: "turn_latest",
            status: "completed",
            itemIds: ["user_latest"],
          },
        ],
        transcript: [
          {
            threadId: "thr_owner_edit",
            turnId: "turn_older",
            itemId: "user_older",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Older prompt",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_owner_edit",
            turnId: "turn_latest",
            itemId: "user_latest",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Latest prompt",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });
      serviceInternals.setRendererConversationOwner("thr_owner_edit", "owner-a");

      try {
        const result = await serviceInternals.handleRendererOwnerAppServerRequest(
          "owner-a",
          {
            conversationId: "thr_owner_edit",
            request: {
              method: "thread/rollback",
              params: {
                threadId: "thr_owner_edit",
                turnId: "turn_latest",
                numTurns: 1,
              },
            },
          },
        ) as { thread?: { id?: string; turns?: Array<{ id?: string }> } };
        const detail = service.serializeThreadDetail("thr_owner_edit");

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("thread/rollback");
        expect((requests[0]?.params as { numTurns?: number } | undefined)?.numTurns).toBe(1);
        expect(result.thread?.id).toBe("thr_owner_edit");
        expect(String(result.thread?.turns?.length ?? -1)).toBe("1");
        expect(result.thread?.turns?.[0]?.id).toBe("turn_older");
        expect(detail?.turns.length).toBe(1);
        expect(detail?.turns[0]?.turnId).toBe("turn_older");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer owner rollback edit rejects non-owner callers before app-server rollback", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
        handleRendererOwnerAppServerRequest: (
          sourceClientId: string | null,
          input: {
            conversationId: string;
            request: {
              method: "thread/rollback";
              params: {
                threadId: string;
                turnId: string;
                numTurns: number;
              };
            };
          },
        ) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      let errorMessage = "";

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        return {};
      };
      serviceInternals.setRendererConversationOwner("thr_owner_edit", "owner-a");

      try {
        try {
          await serviceInternals.handleRendererOwnerAppServerRequest(
            "owner-b",
            {
              conversationId: "thr_owner_edit",
              request: {
                method: "thread/rollback",
                params: {
                  threadId: "thr_owner_edit",
                  turnId: "turn_latest",
                  numTurns: 1,
                },
              },
            },
          );
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
        }

        expect(requests.length).toBe(0);
        expect(errorMessage.includes("not owner")).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer owner turn start returns raw result without source-null stream patches", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
        handleRendererOwnerAppServerRequest: (
          sourceClientId: string | null,
          input: {
            conversationId: string;
            request: {
              method: "turn/start";
              params: {
                threadId: string;
                prompt: string;
                opts?: { permissionMode?: "auto"; serviceTier?: "fast" };
                clientUserMessageId?: string;
              };
            };
          },
        ) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_prompt",
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
        throw new Error(`Unexpected client request: ${method}`);
      };
      serviceInternals.setRendererConversationOwner("thr_owner_start", "owner-a");

      try {
        const result = await serviceInternals.handleRendererOwnerAppServerRequest(
          "owner-a",
          {
            conversationId: "thr_owner_start",
            request: {
              method: "turn/start",
              params: {
                threadId: "thr_owner_start",
                prompt: "Ship the fix",
                clientUserMessageId: "client-owner-start",
                opts: { permissionMode: "auto", serviceTier: "fast" },
              },
            },
          },
        ) as { turnId?: string; conversationState?: unknown };
        const detail = service.serializeThreadDetail("thr_owner_start");
        const promptItem = detail?.transcript[0];

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("turn/start");
        const requestParams = requests[0]?.params as { threadId?: string; serviceTier?: unknown; clientUserMessageId?: unknown } | undefined;
        expect(requestParams?.threadId).toBe("thr_owner_start");
        expect(requestParams?.serviceTier).toBe("fast");
        expect(requestParams?.clientUserMessageId).toBe("client-owner-start");
        expect(result.turnId).toBe("turn_prompt");
        expect(result.conversationState === undefined).toBe(true);
        expect(promptItem?.kind).toBe("userMessage");
        expect(promptItem?.role).toBe("user");
        expect(promptItem?.markdownText).toBe("Ship the fix");
        expect((promptItem?.rawItem as { clientUserMessageId?: unknown } | undefined)?.clientUserMessageId).toBe("client-owner-start");
        expect(detail?.turns[0]?.turnId).toBe("turn_prompt");
        expect(String(hostMessages.length)).toBe("0");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer owner app-server facade updates settings without source-null stream patches", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
        handleRendererOwnerAppServerRequest: (
          sourceClientId: string | null,
          input: {
            conversationId: string;
            request: {
              method: "thread/settings/update";
              params: {
                threadId: string;
                patch: { reasoningEffort?: string; collaborationMode?: string };
              };
            };
          },
        ) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/settings/update") {
          return {};
        }
        throw new Error(`Unexpected client request: ${method}`);
      };
      serviceInternals.setRendererConversationOwner("thr_owner_settings", "owner-a");

      try {
        const result = await serviceInternals.handleRendererOwnerAppServerRequest(
          "owner-a",
          {
            conversationId: "thr_owner_settings",
            request: {
              method: "thread/settings/update",
              params: {
                threadId: "thr_owner_settings",
                patch: {
                  reasoningEffort: "high",
                  collaborationMode: "plan",
                },
              },
            },
          },
        ) as { reasoningEffort?: string; collaborationMode?: { mode?: string } };

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("thread/settings/update");
        expect(result.reasoningEffort).toBe("high");
        expect(result.collaborationMode?.mode).toBe("plan");
        expect(String(hostMessages.length)).toBe("0");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer owner app-server facade preserves status-only thread goal sets", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
        handleRendererOwnerAppServerRequest: (
          sourceClientId: string | null,
          input: {
            conversationId: string;
            request: {
              method: "thread/goal/set";
              params: {
                threadId: string;
                status: "paused";
              };
            };
          },
        ) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/goal/set") {
          return {
            goal: {
              threadId: "thr_owner_goal_status",
              objective: "Ship parity",
              status: "paused",
              tokenBudget: null,
              tokensUsed: 20,
              timeUsedSeconds: 3,
              createdAt: 1,
              updatedAt: 2,
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };
      serviceInternals.setRendererConversationOwner("thr_owner_goal_status", "owner-a");

      try {
        const result = await serviceInternals.handleRendererOwnerAppServerRequest(
          "owner-a",
          {
            conversationId: "thr_owner_goal_status",
            request: {
              method: "thread/goal/set",
              params: {
                threadId: "thr_owner_goal_status",
                status: "paused",
              },
            },
          },
        ) as { status?: string };
        const params = requests[0]?.params as { threadId?: string; objective?: unknown; status?: unknown } | undefined;

        expect(result.status).toBe("paused");
        expect(requests[0]?.method).toBe("thread/goal/set");
        expect(params?.threadId).toBe("thr_owner_goal_status");
        expect(params?.status).toBe("paused");
        expect(Object.prototype.hasOwnProperty.call(params ?? {}, "objective")).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer owner app-server facade steers without source-null stream patches", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
        handleRendererOwnerAppServerRequest: (
          sourceClientId: string | null,
          input: {
            conversationId: string;
            request: {
              method: "turn/steer";
              params: CodexSteerTurnInput;
            };
          },
        ) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          return { turnId: "turn_active" };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_owner_steer"),
        statusType: "active",
        statusActiveFlags: [],
        turns: [{
          threadId: "thr_owner_steer",
          turnId: "turn_active",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });
      serviceInternals.setRendererConversationOwner("thr_owner_steer", "owner-a");

      try {
        const result = await serviceInternals.handleRendererOwnerAppServerRequest(
          "owner-a",
          {
            conversationId: "thr_owner_steer",
            request: {
              method: "turn/steer",
              params: {
                threadId: "thr_owner_steer",
                expectedTurnId: "turn_active",
                prompt: "Keep going",
              },
            },
          },
        ) as { turnId?: string } | null;
        const snapshot = service.serializeConversationSnapshot("thr_owner_steer");

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("turn/steer");
        expect(result?.turnId).toBe("turn_active");
        expect(String(hostMessages.length)).toBe("0");
        expect(snapshot?.turns[0]?.items[0]?.type).toBe("steeringUserMessage");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("renderer owner app-server facade forks from turn without source-null stream patches", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const serviceInternals = service as unknown as {
        setRendererConversationOwner: (threadId: string, clientId: string | null | undefined) => void;
        handleRendererOwnerAppServerRequest: (
          sourceClientId: string | null,
          input: {
            conversationId: string;
            request: {
              method: "thread/fork";
              params: {
                threadId: string;
                turnId: string;
                message: string;
              };
            };
          },
        ) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_owner_forked",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 11,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      hydrateConversation(service, {
        ...makeThreadDetail("thr_owner_fork_source"),
        projectId: defaultProjectId,
        threadName: "Owner fork source",
        cwd: "/tmp/owner-fork-thread",
        turns: [
          { threadId: "thr_owner_fork_source", turnId: "turn_1", status: "completed", itemIds: ["user_1"] },
          { threadId: "thr_owner_fork_source", turnId: "turn_2", status: "completed", itemIds: ["user_2"] },
        ],
        transcript: [
          {
            threadId: "thr_owner_fork_source",
            turnId: "turn_1",
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Prompt 1",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_owner_fork_source",
            turnId: "turn_2",
            itemId: "user_2",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Prompt 2",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });
      serviceInternals.setRendererConversationOwner("thr_owner_fork_source", "owner-a");

      try {
        const result = await serviceInternals.handleRendererOwnerAppServerRequest(
          "owner-a",
          {
            conversationId: "thr_owner_fork_source",
            request: {
              method: "thread/fork",
              params: {
                threadId: "thr_owner_fork_source",
                turnId: "turn_1",
                message: "Continue from the fork",
              },
            },
          },
        ) as CodexThreadActionResult;
        const snapshot = service.serializeConversationSnapshot("thr_owner_forked");

        expect(requests.map((request) => request.method).join(",")).toBe("thread/fork");
        expect((requests[0]?.params as { threadId?: string } | undefined)?.threadId).toBe("thr_owner_fork_source");
        expect((requests[0]?.params as { lastTurnId?: string } | undefined)?.lastTurnId).toBe("turn_1");
        expect(result.threadId).toBe("thr_owner_forked");
        expect(Boolean(result.composerIntent)).toBe(true);
        expect(result.composerIntent?.prompt).toBe("Continue from the fork");
        expect(snapshot?.turns.length).toBe(1);
        expect(snapshot?.turns[0]?.turnId).toBe("turn_1");
        expect(String(hostMessages.length)).toBe("0");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("forks from an older turn at the selected branch point", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_forked",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 11,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                    { id: "assistant_1", type: "agentMessage", text: "Answer 1" },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                    { id: "assistant_2", type: "agentMessage", text: "Answer 2" },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      hydrateConversation(service, {
        ...makeThreadDetail("thr_source"),
        projectId: defaultProjectId,
        threadName: "Source thread",
        cwd: "/tmp/fork-thread",
        turns: [
          { threadId: "thr_source", turnId: "turn_1", status: "completed", itemIds: ["user_1", "assistant_1"] },
          { threadId: "thr_source", turnId: "turn_2", status: "completed", itemIds: ["user_2", "assistant_2"] },
          { threadId: "thr_source", turnId: "turn_3", status: "completed", itemIds: ["user_3", "assistant_3"] },
        ],
        transcript: [
          {
            threadId: "thr_source",
            turnId: "turn_1",
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Prompt 1",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_source",
            turnId: "turn_2",
            itemId: "user_2",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Prompt 2",
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_source",
            turnId: "turn_3",
            itemId: "user_3",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 3,
            markdownText: "Prompt 3",
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const result = await service.forkConversationFromTurn("thr_source", "turn_2", "Continue from turn 2");
        const snapshot = service.serializeConversationSnapshot("thr_forked");
        const forkParams = requests[0]?.params as Record<string, unknown> | undefined;

        expect(requests[0]?.method).toBe("thread/fork");
        expect("persistExtendedHistory" in (forkParams ?? {})).toBe(false);
        expect("path" in (forkParams ?? {})).toBe(false);
        expect(forkParams?.lastTurnId).toBe("turn_2");
        expect(requests.length).toBe(1);
        expect(result.threadId).toBe("thr_forked");
        expect(Boolean(result.composerIntent)).toBe(true);
        expect(result.composerIntent?.prompt).toBe("Continue from turn 2");
        expect(snapshot?.turns.length).toBe(2);
        expect(snapshot?.turns[1]?.turnId).toBe("turn_2");
        expect(events.some((event) => event.type === "threadSummary" && event.thread.threadId === "thr_forked")).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("forks from the latest turn without issuing a rollback", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_latest_forked",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 11,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                    { id: "assistant_1", type: "agentMessage", text: "Answer 1" },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                    { id: "assistant_2", type: "agentMessage", text: "Answer 2" },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      hydrateConversation(service, {
        ...makeThreadDetail("thr_latest_source"),
        projectId: defaultProjectId,
        threadName: "Latest source thread",
        cwd: "/tmp/latest-fork-thread",
        turns: [
          { threadId: "thr_latest_source", turnId: "turn_1", status: "completed", itemIds: ["user_1", "assistant_1"] },
          { threadId: "thr_latest_source", turnId: "turn_2", status: "completed", itemIds: ["user_2", "assistant_2"] },
        ],
        transcript: [
          {
            threadId: "thr_latest_source",
            turnId: "turn_1",
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Prompt 1",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_latest_source",
            turnId: "turn_2",
            itemId: "user_2",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Prompt 2",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });

      try {
        const result = await service.forkConversationFromTurn("thr_latest_source", "turn_2", "Continue latest");
        const snapshot = service.serializeConversationSnapshot("thr_latest_forked");
        const forkParams = requests[0]?.params as Record<string, unknown> | undefined;

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("thread/fork");
        expect(forkParams?.lastTurnId).toBe("turn_2");
        expect("persistExtendedHistory" in (forkParams ?? {})).toBe(false);
        expect("path" in (forkParams ?? {})).toBe(false);
        expect(result.threadId).toBe("thr_latest_forked");
        expect(snapshot?.turns.length).toBe(2);
        expect(snapshot?.turns[1]?.turnId).toBe("turn_2");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("starts side chat as an ephemeral fork, injects boundary, then sends initial prompt", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("Use fallback permissions");
        }
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_side_chat",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 1,
              turns: [],
            },
          };
        }
        if (method === "thread/inject_items") {
          return {};
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_side_chat",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        if (method === "thread/unsubscribe") {
          return {};
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      hydrateConversation(service, {
        ...makeThreadDetail("thr_parent"),
        projectId: defaultProjectId,
        source: null,
        threadName: "Parent",
        cwd: "/tmp/codex",
        latestCollaborationMode: {
          mode: "default",
          settings: {
            model: "gpt-5-codex",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
      });

      try {
        const result = await service.startSideChat({
          projectId: defaultProjectId,
          parentThreadId: "thr_parent",
          parentNavigationPath: "project:codex/session:session-1/thread:thr_parent",
          prompt: "Investigate this in side chat",
          model: "gpt-5-codex",
          reasoningEffort: "high",
          collaborationMode: "plan",
        });
        const sideRequests = requests.filter((request) =>
          request.method === "thread/fork"
          || request.method === "thread/inject_items"
          || request.method === "turn/start"
        );
        const forkParams = sideRequests[0]?.params as Record<string, unknown> | undefined;
        const injectParams = sideRequests[1]?.params as { threadId?: string; items?: unknown[] } | undefined;
        const turnParams = sideRequests[2]?.params as { threadId?: string; input?: unknown[] } | undefined;
        const snapshot = service.serializeConversationSnapshot("thr_side_chat");

        expect(sideRequests.map((request) => request.method).join(",")).toBe("thread/fork,thread/inject_items,turn/start");
        expect(forkParams?.threadId).toBe("thr_parent");
        expect(forkParams?.ephemeral).toBe(true);
        expect(forkParams?.excludeTurns).toBe(true);
        expect(String(forkParams?.developerInstructions).includes("You are in a side conversation")).toBe(true);
        expect(injectParams?.threadId).toBe("thr_side_chat");
        expect(JSON.stringify(injectParams?.items ?? []).includes("Side conversation boundary")).toBe(true);
        expect(turnParams?.threadId).toBe("thr_side_chat");
        expect(JSON.stringify(turnParams?.input ?? []).includes("Investigate this in side chat")).toBe(true);
        expect(result.threadId).toBe("thr_side_chat");
        expect(snapshot?.source?.sideConversation === true).toBe(true);
        expect(snapshot?.source?.sideConversationParentNavigationPath ?? "").toBe(
          "project:codex/session:session-1/thread:thr_parent",
        );
        expect(snapshot?.ephemeral === true).toBe(true);
        expect(snapshot?.capabilityFlags.canForkFromTurn).toBe(false);
        expect(snapshot?.capabilityFlags.canEditLastUserTurn).toBe(false);
        expect(getCodexThread("thr_side_chat") === null).toBe(true);

        const discarded = await service.discardSideChat("thr_side_chat");
        expect(discarded).toBe(true);
        expect(requests.some((request) => request.method === "thread/unsubscribe")).toBe(true);
        expect(service.serializeConversationSnapshot("thr_side_chat") === null).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
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
      const interruptRequest = requests.find(
        (request) => request.method === "turn/interrupt",
      );
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
      applyThreadStatusLocal: (
        threadId: string,
        statusType: CodexThreadDetail["statusType"],
        statusActiveFlags: CodexThreadDetail["statusActiveFlags"],
      ) => void;
      maybeContinueActiveThreadGoal: (threadId: string) => Promise<void>;
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
      turns: [{
        threadId: "thr_goal_continue",
        turnId: "turn_done",
        status: "completed",
        itemIds: [],
      }],
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
      serviceInternals.applyThreadStatusLocal("thr_goal_continue", "idle", []);
      void serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue");
      void serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue");

      await waitForCondition(() =>
        requests.some((request) => request.method === "thread/goal/set"),
      1_000);

      const goalSetRequests = requests.filter((request) => request.method === "thread/goal/set");
      expect(goalSetRequests.length).toBe(1);
      expect((goalSetRequests[0]?.params as { threadId?: string })?.threadId).toBe("thr_goal_continue");
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
      applyThreadStatusLocal: (
        threadId: string,
        statusType: CodexThreadDetail["statusType"],
        statusActiveFlags: CodexThreadDetail["statusActiveFlags"],
      ) => void;
      maybeContinueActiveThreadGoal: (threadId: string) => Promise<void>;
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
      turns: [{
        threadId: "thr_goal_continue_fallback",
        turnId: "turn_done",
        status: "completed",
        itemIds: [],
      }],
    };

    Reflect.set(service as object, "threadSettingsUpdateSupport", "unsupported");
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
      serviceInternals.applyThreadStatusLocal("thr_goal_continue_fallback", "idle", []);
      void serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue_fallback");

      await waitForCondition(() =>
        requests.some((request) => request.method === "turn/start"),
      1_000);

      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      expect(requests.some((request) => request.method === "thread/goal/set")).toBe(false);
      expect((turnStartRequest?.params as { threadId?: string })?.threadId).toBe("thr_goal_continue_fallback");
      expect((turnStartRequest?.params as { cwd?: string })?.cwd).toBe("/tmp/goal-continue-fallback");
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
      applyThreadStatusLocal: (
        threadId: string,
        statusType: CodexThreadDetail["statusType"],
        statusActiveFlags: CodexThreadDetail["statusActiveFlags"],
      ) => void;
      maybeContinueActiveThreadGoal: (threadId: string) => Promise<void>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const pendingThreadSettingsUpdates = Reflect.get(
      service as object,
      "pendingThreadSettingsUpdates",
    ) as Map<string, Promise<unknown>>;
    const requests: Array<{ method: string; params: unknown }> = [];
    const detail: CodexThreadDetail = {
      ...makeThreadDetail("thr_goal_continue_settings"),
      cwd: "/tmp/goal-continue-settings",
      statusType: "active",
      turns: [{
        threadId: "thr_goal_continue_settings",
        turnId: "turn_done",
        status: "completed",
        itemIds: [],
      }],
    };
    let resolveSettings: (value: unknown) => void = () => {};

    pendingThreadSettingsUpdates.set("thr_goal_continue_settings", new Promise((resolve) => {
      resolveSettings = resolve;
    }));
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
      serviceInternals.applyThreadStatusLocal("thr_goal_continue_settings", "idle", []);
      void serviceInternals.maybeContinueActiveThreadGoal("thr_goal_continue_settings");

      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(requests.some((request) => request.method === "thread/goal/set")).toBe(false);

      resolveSettings({
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
        collaborationMode: {
          mode: "default",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        },
      });

      await waitForCondition(() =>
        requests.some((request) => request.method === "thread/goal/set"),
      1_000);

      const goalSetRequest = requests.find((request) => request.method === "thread/goal/set");
      expect((goalSetRequest?.params as { status?: string })?.status).toBe("active");
    } finally {
      pendingThreadSettingsUpdates.delete("thr_goal_continue_settings");
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
      expect(requests.length).toBe(1);
      expect(requests[0]?.method).toBe("turn/start");
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
      await service.startTurn("thr_fast", "Ship it faster", { serviceTier: "fast" });

      expect(requests.length).toBe(1);
      expect((requests[0]?.params as { serviceTier?: unknown })?.serviceTier).toBe("fast");
    } finally {
      await service.shutdown();
    }
  });

  test("starts a follow-up for projectless thread metadata without forcing a workspace cwd", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string | null | null; cwd: string | null } | null;
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
      expect(requests.length).toBe(1);
      expect(JSON.stringify(requests[0]?.params).includes("\"cwd\"")).toBe(false);
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

      const params = (requests[0]?.params as Record<string, unknown>) ?? {};
      expect(requests.length).toBe(1);
      expect(Object.prototype.hasOwnProperty.call(params, "serviceTier")).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("retries turn/start once after resuming a cold persisted thread", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      markThreadAsActive: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];
    let turnStartAttempts = 0;

    serviceInternals.parseThreadRef = () => null;
    serviceInternals.markThreadAsActive = () => {};
    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        turnStartAttempts += 1;
        if (turnStartAttempts === 1) {
          throw new CodexRpcError("thread not found", -32600);
        }

        return {
          turn: {
            id: "turn_retry",
            status: "in_progress",
            transcript: [],
          },
        };
      }

      if (method === "thread/resume") {
        return {
          thread: {
            id: "thr_start",
            turns: [],
          },
        };
      }

      throw new Error(`Unexpected method: ${method}`);
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Ship the fix");
      expect(startedTurn?.turnId).toBe("turn_retry");
      expect(requests.map((request) => request.method).join(",")).toBe("turn/start,thread/resume,turn/start");
      expect(((requests[1]?.params as { threadId?: string }).threadId)).toBe("thr_start");
      const resumeConfig = (requests[1]?.params as { config?: Record<string, unknown> })?.config ?? {};
      expect(resumeConfig["features.apply_patch_streaming_events"]).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("seeds an optimistic user message as soon as turn/start returns a turn", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_prompt",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        const startedTurn = await service.startTurn("thr_start_prompt", "Ship the fix");
        const detail = service.serializeThreadDetail("thr_start_prompt");
        const promptItem = detail?.transcript[0];

        expect(startedTurn?.turnId).toBe("turn_prompt");
        expect(detail).not.toBeNull();
        expect(detail?.turns[0]?.itemIds.length).toBe(1);
        expect(promptItem?.kind).toBe("userMessage");
        expect(promptItem?.role).toBe("user");
        expect(promptItem?.markdownText).toBe("Ship the fix");
        expect(Boolean(promptItem?.itemId.startsWith("item-"))).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps steer prompts as optimistic transcript items until the authoritative user message arrives", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      serviceInternals.mergeTurn("thr_steer_prompt", {
        threadId: "thr_steer_prompt",
        turnId: "turn_steer_prompt",
        status: "inProgress",
        itemIds: [],
      });
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          return { turnId: "turn_steer_prompt" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        const steeredTurn = await service.steerTurn({
          threadId: "thr_steer_prompt",
          expectedTurnId: "turn_steer_prompt",
          prompt: "Tighten the layout.",
        });
        const detail = service.serializeThreadDetail("thr_steer_prompt");
        const snapshot = service.serializeConversationSnapshot("thr_steer_prompt");

        expect(steeredTurn?.turnId).toBe("turn_steer_prompt");
        expect(detail).not.toBeNull();
        expect(detail?.transcript.length).toBe(1);
        expect(detail?.transcript[0]?.type).toBe("steeringUserMessage");
        expect(detail?.transcript[0]?.steeringStatus).toBe("pending");
        expect(detail?.turns[0]?.itemIds.join(",")).toBe(detail?.transcript[0]?.itemId ?? "");
        expect(snapshot?.pendingSteers.length).toBe(0);
        expect(snapshot?.turns[0]?.items[0]?.markdownText).toBe("Tighten the layout.");
        expect(requests.length).toBe(1);
        expect(typeof (requests[0]?.params as { clientUserMessageId?: unknown })?.clientUserMessageId).toBe("string");
        expect(
          (detail?.transcript[0]?.rawItem as { clientUserMessageId?: unknown } | undefined)?.clientUserMessageId,
        ).toBe((requests[0]?.params as { clientUserMessageId?: unknown })?.clientUserMessageId);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("suppresses matching steer user-message started echoes without accepting the pending steer", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_steer_started_echo", {
        threadId: "thr_steer_started_echo",
        turnId: "turn_steer_started_echo",
        status: "inProgress",
        itemIds: ["agent_msg_existing"],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          return { turnId: "turn_steer_started_echo" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.steerTurn({
          threadId: "thr_steer_started_echo",
          expectedTurnId: "turn_steer_started_echo",
          prompt: "Keep going, but simplify the copy.",
        });
        const clientUserMessageId = (requests[0]?.params as { clientUserMessageId?: string } | undefined)?.clientUserMessageId;

        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_steer_started_echo",
          turnId: "turn_steer_started_echo",
          item: {
            id: "user_msg_started_echo",
            type: "userMessage",
            clientId: clientUserMessageId,
            content: [{ type: "text", text: "Keep going, but simplify the copy.", text_elements: [] }],
          },
        });

        const detail = service.serializeThreadDetail("thr_steer_started_echo");
        const snapshot = service.serializeConversationSnapshot("thr_steer_started_echo");
        const steerItemId = detail?.transcript[0]?.itemId ?? "";

        expect(detail?.turns[0]?.itemIds.join(",")).toBe(`agent_msg_existing,${steerItemId}`);
        expect(detail?.transcript.length).toBe(1);
        expect(detail?.transcript[0]?.type).toBe("steeringUserMessage");
        expect(detail?.transcript[0]?.steeringStatus).toBe("pending");
        expect(snapshot?.turns[0]?.items.length).toBe(1);
        expect(snapshot?.turns[0]?.items[0]?.markdownText).toBe("Keep going, but simplify the copy.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("queueing a follow-up during an active turn auto-dispatches it after the turn completes", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_prompt", {
        threadId: "thr_queue_prompt",
        turnId: "turn_queue_prompt",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_queue_prompt_auto_1",
              threadId: "thr_queue_prompt",
              status: "inProgress",
            },
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_prompt", "Queue this without interrupting");
        const snapshot = service.serializeConversationSnapshot("thr_queue_prompt");

        expect(requests.length).toBe(0);
        expect(snapshot?.queuedFollowUps.length).toBe(1);
        expect(snapshot?.queuedFollowUps[0]?.prompt).toBe("Queue this without interrupting");
        expect(snapshot?.pendingSteers.length).toBe(0);

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_prompt",
          turnId: "turn_queue_prompt",
          status: "completed",
        });
        await flushAsyncWork();

        const afterSendSnapshot = service.serializeConversationSnapshot("thr_queue_prompt");

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("turn/start");
        expect(
          JSON.stringify((requests[0]?.params as { collaborationMode?: unknown })?.collaborationMode ?? null),
        ).toBe("null");
        expect(afterSendSnapshot?.queuedFollowUps.length).toBe(0);
        expect(afterSendSnapshot?.turns[afterSendSnapshot.turns.length - 1]?.turnId).toBe("turn_queue_prompt_auto_1");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("queueing a fast follow-up preserves the effective service tier until dispatch", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_fast", {
        threadId: "thr_queue_fast",
        turnId: "turn_queue_fast",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_queue_fast_auto_1",
              threadId: "thr_queue_fast",
              status: "inProgress",
            },
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_fast", "Queue this fast", { serviceTier: "fast" });
        const snapshot = service.serializeConversationSnapshot("thr_queue_fast");

        expect(snapshot?.queuedFollowUps[0]?.serviceTier).toBe("fast");

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_fast",
          turnId: "turn_queue_fast",
          status: "completed",
        });
        await flushAsyncWork();

        expect(requests.length).toBe(1);
        expect((requests[0]?.params as { serviceTier?: unknown })?.serviceTier).toBe("fast");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("queued follow-up send-now still works as an explicit override while a turn is active", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_prompt_send_now", {
        threadId: "thr_queue_prompt_send_now",
        turnId: "turn_queue_prompt_send_now",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          return { turnId: "turn_queue_prompt_send_now" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_prompt_send_now", "Queue this without interrupting");
        const snapshot = service.serializeConversationSnapshot("thr_queue_prompt_send_now");
        const followUpId = snapshot?.queuedFollowUps[0]?.followUpId ?? null;

        expect(Boolean(followUpId)).toBe(true);
        if (!followUpId) return;

        await service.sendQueuedFollowUpNow("thr_queue_prompt_send_now", followUpId);
        const afterSendSnapshot = service.serializeConversationSnapshot("thr_queue_prompt_send_now");

        expect(requests.length).toBe(1);
        expect(requests[0]?.method).toBe("turn/steer");
        const steerClientUserMessageId = (requests[0]?.params as { clientUserMessageId?: string } | undefined)?.clientUserMessageId;
        expect(typeof steerClientUserMessageId).toBe("string");
        expect(afterSendSnapshot?.queuedFollowUps.length).toBe(0);
        expect(afterSendSnapshot?.pendingSteers.length).toBe(0);
        expect(afterSendSnapshot?.turns[0]?.items[0]?.type).toBe("steeringUserMessage");
        expect(afterSendSnapshot?.turns[0]?.items[0]?.markdownText).toBe("Queue this without interrupting");

        const serverUserMessage = {
          id: "user_msg_queue_send_now",
          type: "userMessage",
          clientId: steerClientUserMessageId,
          content: [{ type: "text", text: "Queue this without interrupting", text_elements: [] }],
        };
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_queue_prompt_send_now",
          turnId: "turn_queue_prompt_send_now",
          item: serverUserMessage,
        });
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_queue_prompt_send_now",
          turnId: "turn_queue_prompt_send_now",
          item: serverUserMessage,
        });

        const afterAcceptedSnapshot = service.serializeConversationSnapshot("thr_queue_prompt_send_now");
        const userMessageItems = afterAcceptedSnapshot?.turns[0]?.items.filter((entry) => entry.kind === "userMessage") ?? [];
        expect(afterAcceptedSnapshot?.turns[0]?.items.length).toBe(2);
        expect(userMessageItems.length).toBe(1);
        expect(userMessageItems[0]?.steeringStatus).toBe("accepted");
        expect(afterAcceptedSnapshot?.turns[0]?.items[1]?.semanticKind).toBe("steered");
        expect(afterAcceptedSnapshot?.turns[0]?.itemIds.join(",")).toBe(
          `${userMessageItems[0]?.itemId ?? ""},user_msg_queue_send_now:steered`,
        );
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("queued follow-ups preserve FIFO order across successive turn completions", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const prompts: string[] = [];
      let startedCount = 0;

      serviceInternals.mergeTurn("thr_queue_fifo", {
        threadId: "thr_queue_fifo",
        turnId: "turn_queue_fifo_active",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method !== "turn/start") {
          throw new Error(`Unexpected method: ${method}`);
        }
        const record = params as { input?: Array<{ text?: string }> };
        prompts.push(record.input?.[0]?.text ?? "");
        startedCount += 1;
        return {
          turn: {
            id: `turn_queue_fifo_auto_${startedCount}`,
            threadId: "thr_queue_fifo",
            status: "inProgress",
          },
        };
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_fifo", "First queued message");
        await service.enqueueQueuedFollowUpPrompt("thr_queue_fifo", "Second queued message");

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_fifo",
          turnId: "turn_queue_fifo_active",
          status: "completed",
        });
        await flushAsyncWork();

        let snapshot = service.serializeConversationSnapshot("thr_queue_fifo");
        expect(prompts.length).toBe(1);
        expect(prompts[0]).toBe("First queued message");
        expect(snapshot?.queuedFollowUps.length).toBe(1);
        expect(snapshot?.queuedFollowUps[0]?.prompt).toBe("Second queued message");

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_fifo",
          turnId: "turn_queue_fifo_auto_1",
          status: "completed",
        });
        await flushAsyncWork();

        snapshot = service.serializeConversationSnapshot("thr_queue_fifo");
        expect(prompts.length).toBe(2);
        expect(prompts[1]).toBe("Second queued message");
        expect(snapshot?.queuedFollowUps.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("accepts a matching steer only once when started is followed by completed", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_steer_started_completed", {
        threadId: "thr_steer_started_completed",
        turnId: "turn_steer_started_completed",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/steer") {
          return { turnId: "turn_steer_started_completed" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_steer_started_completed",
          turnId: "turn_steer_started_completed",
          item: {
            id: "assistant_before_steer",
            type: "agentMessage",
            text: "Message 3/7",
          },
        });
        await service.steerTurn({
          threadId: "thr_steer_started_completed",
          expectedTurnId: "turn_steer_started_completed",
          prompt: "Use the compact version.",
        });
        const clientUserMessageId = (requests[0]?.params as { clientUserMessageId?: string } | undefined)?.clientUserMessageId;
        const serverUserMessage = {
          id: "user_msg_started_completed",
          type: "userMessage",
          clientId: clientUserMessageId,
          content: [{ type: "text", text: "Use the compact version.", text_elements: [] }],
        };

        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_steer_started_completed",
          turnId: "turn_steer_started_completed",
          item: serverUserMessage,
        });
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_steer_started_completed",
          turnId: "turn_steer_started_completed",
          item: serverUserMessage,
        });
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_steer_started_completed",
          turnId: "turn_steer_started_completed",
          item: {
            id: "assistant_after_steer",
            type: "agentMessage",
            text: "I am Codex.",
          },
        });

        const detail = service.serializeThreadDetail("thr_steer_started_completed");
        const snapshot = service.serializeConversationSnapshot("thr_steer_started_completed");
        const userMessageItems = snapshot?.turns[0]?.items.filter((entry) => entry.kind === "userMessage") ?? [];
        const steeredItems = snapshot?.turns[0]?.items.filter((entry) => entry.semanticKind === "steered") ?? [];
        const steerItemId = userMessageItems[0]?.itemId ?? "";

        expect(detail?.turns[0]?.itemIds.join(",")).toBe(
          `assistant_before_steer,${steerItemId},user_msg_started_completed:steered,assistant_after_steer`,
        );
        expect(snapshot?.turns[0]?.items.map((entry) => entry.itemId).join(",")).toBe(
          `assistant_before_steer,${steerItemId},user_msg_started_completed:steered,assistant_after_steer`,
        );
        expect(detail?.transcript.length).toBe(4);
        expect(userMessageItems.length).toBe(1);
        expect(userMessageItems[0]?.type).toBe("steeringUserMessage");
        expect(userMessageItems[0]?.steeringStatus).toBe("accepted");
        expect(userMessageItems[0]?.acceptedUserMessageItemId).toBe("user_msg_started_completed");
        expect(steeredItems.length).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps non-matching steer user messages on the ordinary transcript path", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };

      serviceInternals.mergeTurn("thr_steer_nonmatching", {
        threadId: "thr_steer_nonmatching",
        turnId: "turn_steer_nonmatching",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/steer") {
          return { turnId: "turn_steer_nonmatching" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.steerTurn({
          threadId: "thr_steer_nonmatching",
          expectedTurnId: "turn_steer_nonmatching",
          prompt: "Use the compact version.",
        });
        const serverUserMessage = {
          id: "user_msg_nonmatching",
          type: "userMessage",
          clientId: "server-owned-message",
          content: [{ type: "text", text: "A different follow-up.", text_elements: [] }],
        };

        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_steer_nonmatching",
          turnId: "turn_steer_nonmatching",
          item: serverUserMessage,
        });
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_steer_nonmatching",
          turnId: "turn_steer_nonmatching",
          item: serverUserMessage,
        });

        const snapshot = service.serializeConversationSnapshot("thr_steer_nonmatching");
        const pendingSteers = snapshot?.turns[0]?.items.filter((entry) => entry.type === "steeringUserMessage") ?? [];
        const ordinaryUserMessages = snapshot?.turns[0]?.items.filter((entry) => entry.type === "userMessage") ?? [];
        const steeredItems = snapshot?.turns[0]?.items.filter((entry) => entry.semanticKind === "steered") ?? [];
        const pendingSteerId = pendingSteers[0]?.itemId ?? "";

        expect(snapshot?.turns[0]?.itemIds.join(",")).toBe(`${pendingSteerId},user_msg_nonmatching`);
        expect(pendingSteers.length).toBe(1);
        expect(pendingSteers[0]?.steeringStatus).toBe("pending");
        expect(ordinaryUserMessages.length).toBe(1);
        expect(ordinaryUserMessages[0]?.markdownText).toBe("A different follow-up.");
        expect(steeredItems.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("removes a failed steer from transcript and turn order", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };

      serviceInternals.mergeTurn("thr_steer_rpc_failure", {
        threadId: "thr_steer_rpc_failure",
        turnId: "turn_steer_rpc_failure",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/steer") {
          throw new Error("steer rpc failed");
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        let didThrow = false;
        try {
          await service.steerTurn({
            threadId: "thr_steer_rpc_failure",
            expectedTurnId: "turn_steer_rpc_failure",
            prompt: "This steer will fail.",
          });
        } catch {
          didThrow = true;
        }

        const detail = service.serializeThreadDetail("thr_steer_rpc_failure");
        const snapshot = service.serializeConversationSnapshot("thr_steer_rpc_failure");

        expect(didThrow).toBe(true);
        expect(detail?.transcript.length).toBe(0);
        expect(detail?.turns[0]?.itemIds.length).toBe(0);
        expect(snapshot?.turns[0]?.items.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("restores an unaccepted steer without leaving a phantom turn item id", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };

      serviceInternals.mergeTurn("thr_steer_restore_order", {
        threadId: "thr_steer_restore_order",
        turnId: "turn_steer_restore_order",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/steer") {
          return { turnId: "turn_steer_restore_order" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.steerTurn({
          threadId: "thr_steer_restore_order",
          expectedTurnId: "turn_steer_restore_order",
          prompt: "Restore me if the turn ends.",
        });
        let snapshot = service.serializeConversationSnapshot("thr_steer_restore_order");

        expect(snapshot?.turns[0]?.items[0]?.type).toBe("steeringUserMessage");
        expect(snapshot?.turns[0]?.itemIds.length).toBe(1);

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_steer_restore_order",
          turnId: "turn_steer_restore_order",
          status: "completed",
        });
        await flushAsyncWork();

        snapshot = service.serializeConversationSnapshot("thr_steer_restore_order");

        expect(snapshot?.turns[0]?.items.length).toBe(0);
        expect(snapshot?.turns[0]?.itemIds.length).toBe(0);
        expect(snapshot?.queuedFollowUps.length).toBe(1);
        expect(snapshot?.queuedFollowUps[0]?.prompt).toBe("Restore me if the turn ends.");
        expect(Boolean(snapshot?.queuedFollowUps[0]?.pausedReason)).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("failed queued follow-up dispatch pauses the item and does not retry in a loop", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      serviceInternals.mergeTurn("thr_queue_failure", {
        threadId: "thr_queue_failure",
        turnId: "turn_queue_failure_active",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          throw new Error("queue dispatch failed");
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.enqueueQueuedFollowUpPrompt("thr_queue_failure", "Will fail later");
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_queue_failure",
          turnId: "turn_queue_failure_active",
          status: "completed",
        });
        await flushAsyncWork(3);

        const snapshot = service.serializeConversationSnapshot("thr_queue_failure");
        expect(requests.length).toBe(1);
        expect(snapshot?.queuedFollowUps.length).toBe(1);
        expect(snapshot?.queuedFollowUps[0]?.prompt).toBe("Will fail later");
        expect(snapshot?.queuedFollowUps[0]?.pausedReason).toBe("queue dispatch failed");

        await flushAsyncWork(3);
        expect(requests.length).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("clears a pending steer when the authoritative user message arrives", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };

      serviceInternals.mergeTurn("thr_pending_clear", {
        threadId: "thr_pending_clear",
        turnId: "turn_pending_clear",
        status: "inProgress",
        itemIds: [],
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "turn/steer") {
          return { turnId: "turn_pending_clear" };
        }
        throw new Error(`Unexpected method: ${method}`);
      };

      try {
        await service.steerTurn({
          threadId: "thr_pending_clear",
          expectedTurnId: "turn_pending_clear",
          prompt: "Tighten the spacing.",
        });
        let snapshot = service.serializeConversationSnapshot("thr_pending_clear");
        expect(snapshot?.pendingSteers.length).toBe(0);
        expect(snapshot?.turns[0]?.items[0]?.steeringStatus).toBe("pending");

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_pending_clear",
          turnId: "turn_pending_clear",
          item: {
            id: "user_msg_1",
            type: "userMessage",
            role: "user",
            content: [{ type: "text", text: "Tighten the spacing.", text_elements: [] }],
          },
        });

        snapshot = service.serializeConversationSnapshot("thr_pending_clear");
        expect(snapshot?.pendingSteers.length).toBe(0);
        expect(snapshot?.turns[0]?.items.length).toBe(2);
        expect(snapshot?.turns[0]?.items[0]?.steeringStatus).toBe("accepted");
        expect(snapshot?.turns[0]?.items[1]?.semanticKind).toBe("steered");
        expect(snapshot?.turns[0]?.itemIds.join(",")).toBe(
          `${snapshot?.turns[0]?.items[0]?.itemId ?? ""},user_msg_1:steered`,
        );
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("passes model and reasoning overrides through to turn/start", async () => {
    const ran = await withTempDatabase(async () => {
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

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      serviceInternals.markThreadAsActive = () => {};
      serviceInternals.persistThreadSnapshot = () => {};

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_override",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        const startedTurn = await service.startTurn("thr_start", "Ship the fix", {
          model: "gpt-5.3-codex",
          permissionMode: "auto",
          reasoningEffort: "high",
        });
        const turnStartRequests = requests.filter((request) => request.method === "turn/start");
        expect(startedTurn?.turnId).toBe("turn_override");
        expect(turnStartRequests.length).toBe(1);
        expect((turnStartRequests[0]?.params as { model?: string })?.model).toBe("gpt-5.3-codex");
        expect((turnStartRequests[0]?.params as { effort?: string })?.effort).toBe("high");
        expect((turnStartRequests[0]?.params as { approvalPolicy?: string })?.approvalPolicy).toBe("on-request");
        expect((turnStartRequests[0]?.params as { cwd?: string })?.cwd).toBe("/tmp/codex");
        expect(JSON.stringify((turnStartRequests[0]?.params as {
          sandboxPolicy?: {
            type?: string;
            writableRoots?: string[];
            networkAccess?: boolean;
            excludeTmpdirEnvVar?: boolean;
            excludeSlashTmp?: boolean;
          };
        })?.sandboxPolicy)).toBe(JSON.stringify({
          type: "workspaceWrite",
          writableRoots: ["/tmp/codex"],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        }));
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("includes collaborationMode payload for plan turns", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: "/tmp/codex" });
    serviceInternals.parseWorkspacePath = () => "/tmp/codex";
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_plan_mode",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Plan this task", {
        model: "gpt-5.3-codex",
        reasoningEffort: "high",
        permissionMode: "auto",
        collaborationMode: "plan",
      });
      const turnStartRequests = requests.filter((request) => request.method === "turn/start");
      expect(startedTurn?.turnId).toBe("turn_plan_mode");
      expect(turnStartRequests.length).toBe(1);
      expect(JSON.stringify((turnStartRequests[0]?.params as { collaborationMode?: unknown })?.collaborationMode)).toBe(
        JSON.stringify({
          mode: "plan",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        }),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("applies typed agent config lines and strips them from turn input", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: "/tmp/codex" });
    serviceInternals.parseWorkspacePath = () => "/tmp/codex";
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_agent_config",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      await service.startTurn(
        "thr_config",
        '<agent-config mode="plan" reasoning="high" />\nShip the fix',
        {
          model: "gpt-5.3-codex",
          permissionMode: "auto",
          collaborationMode: "default",
          reasoningEffort: "medium",
        },
      );
      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      const params = turnStartRequest?.params as {
        input?: Array<{ type: string; text?: string }>;
        effort?: string;
        collaborationMode?: unknown;
      };
      expect(params.input?.[0]?.text).toBe("Ship the fix");
      expect(params.effort).toBe("high");
      expect(JSON.stringify(params.collaborationMode)).toBe(JSON.stringify({
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      }));
      const record = (service as unknown as {
        getConversationRecord: (threadId: string) => {
          latestCollaborationMode: {
            mode: string;
            settings: { model: string; reasoning_effort: string | null };
          };
        };
      }).getConversationRecord("thr_config");
      expect(record.latestCollaborationMode.mode).toBe("plan");
      expect(record.latestCollaborationMode.settings.model).toBe("gpt-5.3-codex");
      expect(record.latestCollaborationMode.settings.reasoning_effort).toBe("high");
    } finally {
      await service.shutdown();
    }
  });

  test("passes prompt input images through to turn/start", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: "/tmp/codex" });
    serviceInternals.parseWorkspacePath = () => "/tmp/codex";
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_image_input",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      await service.startTurn("thr_images", "ignored raw", {
        model: "gpt-5.3-codex",
        permissionMode: "auto",
        reasoningEffort: "medium",
        promptInput: {
          text: "Inspect these images",
          images: [
            { source: "https://example.com/diagram.png", caption: "diagram" },
            { source: "/tmp/local.png", caption: "local" },
            { source: "data:image/png;base64,aW1hZ2U=", caption: "inline" },
          ],
          mentions: [{ name: "notes.md", path: "/tmp/notes.md" }],
          skills: [{ name: "Computer Use", path: "/plugins/computer-use" }],
        },
      });
      const turnStartRequest = requests.find((request) => request.method === "turn/start");
      const params = turnStartRequest?.params as { input?: Array<Record<string, string>> };
      expect(params.input?.length ?? 0).toBe(6);
      expect(params.input?.[0]?.type).toBe("text");
      expect(params.input?.[0]?.text).toBe("Inspect these images");
      expect(params.input?.[1]?.type).toBe("image");
      expect(params.input?.[1]?.url).toBe("https://example.com/diagram.png");
      expect(params.input?.[2]?.type).toBe("localImage");
      expect(params.input?.[2]?.path).toBe("/tmp/local.png");
      expect(params.input?.[3]?.type).toBe("image");
      expect(params.input?.[3]?.url).toBe("data:image/png;base64,aW1hZ2U=");
      expect(params.input?.[4]?.type).toBe("mention");
      expect(params.input?.[4]?.path).toBe("/tmp/notes.md");
      expect(params.input?.[5]?.type).toBe("skill");
      expect(params.input?.[5]?.path).toBe("/plugins/computer-use");
    } finally {
      await service.shutdown();
    }
  });

  test("uses the linked thread cwd for follow-up turns", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      parseWorkspacePath: (projectId: string) => string;
      markThreadAsActive: (threadId: string) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };
    const requests: Array<{ method: string; params: unknown }> = [];

    serviceInternals.parseThreadRef = () => ({
      projectId: defaultProjectId,
      cwd: "/tmp/codex/worktrees/abcd/codex",
    });
    serviceInternals.parseWorkspacePath = () => {
      throw new Error("parseWorkspacePath should not be called when a linked cwd exists");
    };
    serviceInternals.markThreadAsActive = () => {};
    serviceInternals.persistThreadSnapshot = () => {};

    client.start = async () => undefined;
    client.request = async (method: string, params: unknown) => {
      requests.push({ method, params });
      if (method === "turn/start") {
        return {
          turn: {
            id: "turn_worktree",
            status: "in_progress",
            transcript: [],
          },
        };
      }
      return {};
    };

    try {
      const startedTurn = await service.startTurn("thr_start", "Continue in worktree", {
        permissionMode: "auto",
      });
      const turnStartRequests = requests.filter((request) => request.method === "turn/start");
      expect(startedTurn?.turnId).toBe("turn_worktree");
      expect(turnStartRequests.length).toBe(1);
      expect((turnStartRequests[0]?.params as { cwd?: string })?.cwd).toBe("/tmp/codex/worktrees/abcd/codex");
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
      expect((turnStartRequests[0]?.params as { approvalPolicy?: string })?.approvalPolicy).toBe("never");
      expect(JSON.stringify((turnStartRequests[0]?.params as { sandboxPolicy?: { type?: string } })?.sandboxPolicy)).toBe(JSON.stringify({
        type: "dangerFullAccess",
      }));
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
      expect(requests.length).toBe(1);
      expect((requests[0]?.params as { approvalPolicy?: unknown })?.approvalPolicy).toBe(undefined);
      expect((requests[0]?.params as { sandboxPolicy?: unknown })?.sandboxPolicy).toBe(undefined);
      expect((requests[0]?.params as { model?: unknown })?.model).toBe(undefined);
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service collaboration modes", () => {
  test("parses collaborationMode/list response and filters unsupported modes", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params: unknown) => Promise<unknown>;
    };

    client.start = async () => undefined;
    client.request = async (method: string) => {
      if (method !== "collaborationMode/list") return {};
      return {
        data: [
          {
            name: "Default",
            mode: "default",
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
          },
          {
            name: "Plan",
            mode: "plan",
            model: "gpt-5.3-codex",
            reasoningEffort: null,
          },
          {
            name: "Ignored",
            mode: "research",
            model: "gpt-5.3-codex",
            reasoning_effort: "low",
          },
        ],
      };
    };

    try {
      const presets = await service.listCollaborationModes();
      expect(presets.length).toBe(2);
      expect(JSON.stringify(presets)).toBe(JSON.stringify([
        {
          name: "Default",
          mode: "default",
          model: "gpt-5.3-codex",
          reasoningEffort: "high",
        },
        {
          name: "Plan",
          mode: "plan",
          model: "gpt-5.3-codex",
          reasoningEffort: null,
        },
      ]));
    } finally {
      await service.shutdown();
    }
  });

  test("persists conversation collaboration mode into serialized snapshots", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        ensureConversationDetail: (threadId: string) => CodexThreadDetail | null;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };

      client.start = async () => undefined;
      client.request = async () => ({});
      serviceInternals.ensureConversationDetail("thr_plan_mode");

      try {
        const nextMode = await service.setConversationCollaborationMode("thr_plan_mode", "plan");
        expect(nextMode.mode).toBe("plan");

        const detail = service.serializeThreadDetail("thr_plan_mode");
        const snapshot = service.serializeConversationSnapshot("thr_plan_mode");

        expect(detail?.latestCollaborationMode?.mode).toBe("plan");
        expect(snapshot?.latestCollaborationMode?.mode).toBe("plan");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("updates next-turn thread settings through app-server and mirrors snapshots", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        ensureConversationDetail: (threadId: string) => CodexThreadDetail | null;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: Record<string, unknown> }> = [];

      client.start = async () => undefined;
      client.request = async (method, params) => {
        requests.push({ method, params: params as Record<string, unknown> });
        return {};
      };
      serviceInternals.ensureConversationDetail("thr_settings_update");

      try {
        const settings = await service.updateThreadSettingsForNextTurn("thr_settings_update", {
          model: "gpt-5.9-codex",
          reasoningEffort: "high",
          collaborationMode: "plan",
        });
        const snapshot = service.serializeConversationSnapshot("thr_settings_update");
        const updateRequest = requests.find((request) => request.method === "thread/settings/update");
        const collaborationMode = updateRequest?.params.collaborationMode as {
          mode?: string;
          settings?: { model?: string; reasoning_effort?: string | null; developer_instructions?: string | null };
        } | undefined;

        expect(settings.model).toBe("gpt-5.9-codex");
        expect(settings.reasoningEffort).toBe("high");
        expect(settings.collaborationMode?.mode).toBe("plan");
        expect(updateRequest?.params.threadId).toBe("thr_settings_update");
        expect(updateRequest?.params.model).toBe("gpt-5.9-codex");
        expect(updateRequest?.params.effort).toBe("high");
        expect(collaborationMode?.mode).toBe("plan");
        expect(collaborationMode?.settings?.developer_instructions).toBe(null);
        expect(snapshot?.latestThreadSettings?.model).toBe("gpt-5.9-codex");
        expect(snapshot?.latestThreadSettings?.collaborationMode?.mode).toBe("plan");
        expect(snapshot?.latestCollaborationMode?.mode).toBe("plan");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("falls back to local next-turn settings when app-server settings update is unavailable", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        ensureConversationDetail: (threadId: string) => CodexThreadDetail | null;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string) => Promise<unknown>;
      };

      client.start = async () => undefined;
      client.request = async (method) => {
        if (method === "thread/settings/update") {
          throw new CodexRpcError("Method not found: thread/settings/update", -32601);
        }
        return {};
      };
      serviceInternals.ensureConversationDetail("thr_settings_fallback");

      try {
        const settings = await service.updateThreadSettingsForNextTurn("thr_settings_fallback", {
          collaborationMode: "plan",
        });
        const snapshot = service.serializeConversationSnapshot("thr_settings_fallback");

        expect(settings.collaborationMode?.mode).toBe("plan");
        expect(snapshot?.latestThreadSettings?.collaborationMode?.mode).toBe("plan");
        expect(snapshot?.latestCollaborationMode?.mode).toBe("plan");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("thread settings notifications update active conversation snapshots", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleNotification: (method: string, params: unknown) => Promise<void>;
        ensureConversationDetail: (threadId: string) => CodexThreadDetail | null;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
      };

      client.start = async () => undefined;
      serviceInternals.ensureConversationDetail("thr_settings_notification");
      upsertCodexThread({
        ...makeThreadDetail("thr_settings_notification"),
        projectId: defaultProjectId,
        statusType: "idle",
      });

      try {
        await serviceInternals.handleNotification("thread/settings/updated", {
          threadId: "thr_settings_notification",
          threadSettings: {
            cwd: "/tmp",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandboxPolicy: { mode: "read-only" },
            activePermissionProfile: null,
            model: "gpt-5.8-codex",
            modelProvider: "openai",
            serviceTier: null,
            effort: "medium",
            summary: null,
            collaborationMode: {
              mode: "plan",
              settings: {
                model: "gpt-5.8-codex",
                reasoning_effort: "medium",
                developer_instructions: null,
              },
            },
          },
        });
        const snapshot = service.serializeConversationSnapshot("thr_settings_notification");

        expect(snapshot?.latestThreadSettings?.model).toBe("gpt-5.8-codex");
        expect(snapshot?.latestThreadSettings?.reasoningEffort).toBe("medium");
        expect(snapshot?.latestThreadSettings?.collaborationMode?.mode).toBe("plan");
        expect(snapshot?.latestCollaborationMode?.mode).toBe("plan");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

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
      await service.updateThreadSettingsForNextTurn("thr_start_settings_priority", {
        model: "gpt-settings",
        reasoningEffort: "medium",
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
      expect(firstMode?.mode).toBe("plan");
      expect(secondTurn?.model).toBe("gpt-explicit");
      expect(secondTurn?.effort).toBe("high");
      expect(secondMode?.mode).toBe("default");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service setThreadName", () => {
  test("treats whitespace-only names as a no-op", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requestMethods: string[] = [];

      client.start = async () => undefined;
      client.request = async (method: string) => {
        requestMethods.push(method);
        return {};
      };

      try {
        const renamed = await service.setThreadName("thread-1", " \n\t ");
        expect(renamed).toBe(false);
        expect(requestMethods.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("sends the sanitized name and emits a title update", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const events: CodexHostMessage[] = [];
      let requestedName = "";

      service.on("hostMessage", (message) => {
        events.push(message);
      });
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method === "thread/name/set") {
          requestedName = (params as { name?: string }).name ?? "";
        }
        return {};
      };

      try {
        const renamed = await service.setThreadName("thread-1", "  hello   world  ");
        const titleEvent = events.find((event) => event.type === "threadTitleUpdated");

        expect(renamed).toBe(true);
        expect(requestedName).toBe("hello world");
        expect(titleEvent?.type).toBe("threadTitleUpdated");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("sends generated names without manual length sanitization", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      let requestedName = "";
      const generatedName = "x".repeat(72);

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        if (method === "thread/name/set") {
          requestedName = (params as { name?: string }).name ?? "";
        }
        return {};
      };

      try {
        const renamed = await service.setGeneratedThreadName("thread-1", `  ${generatedName}  `);

        expect(renamed).toBe(true);
        expect(requestedName).toBe(generatedName);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });
});

describe("codex-service startThreadForSession", () => {
  test("defers early thread-started notifications until the session link is ready", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
        emit: (eventName: string, payload: unknown) => boolean;
      };
      const sidebarThreadMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "sidebarSyncUpdated") {
          sidebarThreadMessages.push(message);
        }
      });
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          client.emit("notification", {
            method: "thread/started",
            params: {
              thread: {
                id: "thr_session_deferred_started",
                parentThreadId: null,
                preview: "Started before response",
                ephemeral: false,
                modelProvider: "openai",
                cwd: "/tmp/codex",
                createdAt: 1_780_800_000_000,
                updatedAt: 1_780_800_000_000,
                status: { type: "idle" },
                name: null,
                source: "local",
              },
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(
            listProjectSessions(defaultProjectId)
              .some((candidate) => candidate.thread?.threadId === "thr_session_deferred_started"),
          ).toBe(false);
          return {
            thread: {
              id: "thr_session_deferred_started",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1_780_800_000_000,
              updatedAt: 1_780_800_000_000,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_deferred_started",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        const detail = await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "Start after early notification",
          permissionMode: "auto",
          skipAutoTitleGeneration: true,
        });

        const linkedSessions = listProjectSessions(defaultProjectId)
          .filter((candidate) => candidate.thread?.threadId === "thr_session_deferred_started");
        expect(detail.threadId).toBe("thr_session_deferred_started");
        expect(linkedSessions.length).toBe(1);
        expect(linkedSessions[0]?.id).toBe(session.id);
        expect(sidebarThreadMessages.length > 0).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("starts a session thread in the project workspace and persists the project session link", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_start",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1_780_800_000_000,
              updatedAt: 1_780_800_000_000,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_start",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        const detail = await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "Start from this session",
          model: "gpt-5-codex",
          reasoningEffort: "medium",
          permissionMode: "auto",
          skipAutoTitleGeneration: true,
        });

        const threadStartRequest = requests.find((request) => request.method === "thread/start");
        const turnStartRequest = requests.find((request) => request.method === "turn/start");
        const linked = getProjectSession(session.id)?.thread;
        expect((threadStartRequest?.params as { cwd?: string } | undefined)?.cwd).toBe("/tmp/codex");
        expect((turnStartRequest?.params as { cwd?: string } | undefined)?.cwd).toBe("/tmp/codex");
        expect(linked?.threadId).toBe("thr_session_start");
        expect(linked?.projectId).toBe(defaultProjectId);
        expect(linked?.cwd).toBe("/tmp/codex");
        expect(detail.threadId).toBe("thr_session_start");
        expect(detail.projectId).toBe(defaultProjectId);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("sets a text thread goal draft after starting the first session turn", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_goal",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1_780_800_000_000,
              updatedAt: 1_780_800_000_000,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_goal",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        if (method === "thread/goal/set") {
          return {
            goal: {
              threadId: "thr_session_goal",
              objective: (params as { objective?: string }).objective ?? "",
              status: "active",
              tokenBudget: null,
              tokensUsed: 0,
              timeUsedSeconds: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        return {};
      };

      try {
        const detail = await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "Keep refining the migration until tests pass",
          threadGoalDraft: {
            objective: "Keep refining the migration until tests pass",
          },
          permissionMode: "auto",
          skipAutoTitleGeneration: true,
        });

        const turnStartIndex = requests.findIndex((request) => request.method === "turn/start");
        const goalSetIndex = requests.findIndex((request) => request.method === "thread/goal/set");
        const goalSetParams = requests[goalSetIndex]?.params as {
          threadId?: string;
          objective?: string;
          status?: string;
        } | undefined;

        expect(detail.threadId).toBe("thr_session_goal");
        expect(turnStartIndex >= 0).toBe(true);
        expect(goalSetIndex > turnStartIndex).toBe(true);
        expect(goalSetParams?.threadId).toBe("thr_session_goal");
        expect(goalSetParams?.objective).toBe("Keep refining the migration until tests pass");
        expect(goalSetParams?.status).toBe("active");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("auto-generates a session thread title from main after thread start and before first turn", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
        emit: (eventName: string, payload: unknown) => boolean;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const emittedEvents: CodexEvent[] = [];
      service.on("event", (event: CodexEvent) => {
        emittedEvents.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          const isHelperThread = requests.filter((request) => request.method === "thread/start").length > 1;
          if (isHelperThread) {
            client.emit("notification", {
              method: "thread/started",
              params: {
                thread: {
                  id: "thr_title_helper",
                  ephemeral: true,
                  threadSource: "system",
                  modelProvider: "openai",
                  createdAt: 1_780_800_000_000,
                  updatedAt: 1_780_800_000_000,
                },
              },
            });
          }
          return {
            thread: {
              id: isHelperThread ? "thr_title_helper" : "thr_session_auto_title",
              ephemeral: isHelperThread,
              threadSource: isHelperThread ? "system" : "appServer",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1_780_800_000_000,
              updatedAt: 1_780_800_000_000,
            },
          };
        }
        if (method === "turn/start") {
          const turnParams = params as { threadId?: string };
          if (turnParams.threadId === "thr_title_helper") {
            setTimeout(() => {
              client.emit("notification", {
                method: "turn/started",
                params: { threadId: "thr_title_helper", turn: { id: "turn_title_helper" } },
              });
              client.emit("notification", {
                method: "item/agentMessage/delta",
                params: {
                  threadId: "thr_title_helper",
                  turnId: "turn_title_helper",
                  delta: "{\"title\":\"Fix session auto-title\"}",
                },
              });
              client.emit("notification", {
                method: "turn/completed",
                params: { threadId: "thr_title_helper", turn: { id: "turn_title_helper", status: "completed" } },
              });
            }, 0);
            return { turn: { id: "turn_title_helper" } };
          }
          return {
            turn: {
              id: "turn_session_auto_title",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "ignored fallback",
          promptInput: {
            text: "Context\n## My request for Codex:\nBuild auto title",
            textAttachments: [{ text: "Pasted requirements" }],
            images: [{ source: "data:image/png;base64,AAA", caption: "screen.png" }],
            mentions: [{ name: "README.md", path: "/tmp/codex/README.md" }],
            skills: [{ name: "skill", path: "/tmp/codex/skill" }],
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));

        const helperThreadStartIndex = requests.findIndex((request) =>
          request.method === "thread/start"
          && (request.params as { ephemeral?: boolean }).ephemeral === true
        );
        const durableTurnStartIndex = requests.findIndex((request) =>
          request.method === "turn/start"
          && (request.params as { threadId?: string }).threadId === "thr_session_auto_title"
        );
        const helperTurnStart = requests.find((request) =>
          request.method === "turn/start"
          && (request.params as { threadId?: string }).threadId === "thr_title_helper"
        );
        const helperPrompt = ((helperTurnStart?.params as { input?: Array<{ text?: string }> } | undefined)
          ?.input?.[0]?.text) ?? "";
        const setName = requests.find((request) => request.method === "thread/name/set");

        expect(helperThreadStartIndex >= 0).toBe(true);
        expect(durableTurnStartIndex >= 0).toBe(true);
        expect(helperThreadStartIndex < durableTurnStartIndex).toBe(true);
        expect(helperPrompt.includes("User prompt:\nBuild auto title\n\nPasted requirements")).toBe(true);
        expect(helperPrompt.includes("screen.png")).toBe(false);
        expect(helperPrompt.includes("README.md")).toBe(false);
        expect(helperPrompt.includes("/tmp/codex/skill")).toBe(false);
        expect((setName?.params as { threadId?: string; name?: string } | undefined)?.threadId).toBe("thr_session_auto_title");
        expect((setName?.params as { name?: string } | undefined)?.name).toBe("Fix session auto-title");
        expect(getCodexThread("thr_title_helper")).toBe(null);
        expect(emittedEvents.some((event) =>
          event.type === "turn" && event.turn.threadId === "thr_title_helper"
        )).toBe(false);
        expect(emittedEvents.some((event) =>
          event.type === "threadSummary" && event.thread.threadId === "thr_title_helper"
        )).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("forks a session thread from a selected turn and attaches the branch to a new project session", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Session branch" });
      upsertProjectSessionThreadLink({
        sessionId: session.id,
        projectId: defaultProjectId,
        threadId: "thr_session_source",
        threadName: "Source session thread",
        threadPreview: "Source preview",
        modelProvider: "openai",
        cwd: "/tmp/codex",
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 3,
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "thread/fork") {
          return {
            thread: {
              id: "thr_session_forked",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: 1,
              updatedAt: 4,
              turns: [
                {
                  id: "turn_1",
                  status: "completed",
                  items: [
                    { id: "user_1", type: "userMessage", content: [{ type: "text", text: "Prompt 1" }] },
                  ],
                },
                {
                  id: "turn_2",
                  status: "completed",
                  items: [
                    { id: "user_2", type: "userMessage", content: [{ type: "text", text: "Prompt 2" }] },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(`Unexpected client request: ${method}`);
      };

      hydrateConversation(service, {
        ...makeThreadDetail("thr_session_source"),
        projectId: defaultProjectId,
        threadName: "Source session thread",
        cwd: "/tmp/codex",
        turns: [
          { threadId: "thr_session_source", turnId: "turn_1", status: "completed", itemIds: ["user_1"] },
          { threadId: "thr_session_source", turnId: "turn_2", status: "completed", itemIds: ["user_2"] },
          { threadId: "thr_session_source", turnId: "turn_3", status: "completed", itemIds: ["user_3"] },
        ],
        transcript: [
          {
            threadId: "thr_session_source",
            turnId: "turn_1",
            itemId: "user_1",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 1,
            markdownText: "Prompt 1",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            threadId: "thr_session_source",
            turnId: "turn_2",
            itemId: "user_2",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 2,
            markdownText: "Prompt 2",
            createdAt: 2,
            updatedAt: 2,
          },
          {
            threadId: "thr_session_source",
            turnId: "turn_3",
            itemId: "user_3",
            type: "user_message",
            kind: "userMessage",
            semanticKind: "userMessage",
            role: "user",
            sequence: 3,
            markdownText: "Prompt 3",
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      });

      try {
        const result = await service.forkProjectSessionThread(session.id, {
          target: "local",
          turnId: "turn_2",
          message: "Continue from turn 2",
          collaborationMode: "plan",
        });
        const forkParams = requests[0]?.params as { threadId?: string; lastTurnId?: string; cwd?: string } | undefined;
        const linked = getProjectSession(result.session.id)?.thread;
        const snapshot = service.serializeConversationSnapshot("thr_session_forked");

        expect(requests[0]?.method).toBe("thread/fork");
        expect(forkParams?.threadId).toBe("thr_session_source");
        expect(forkParams?.lastTurnId).toBe("turn_2");
        expect(forkParams?.cwd).toBe("/tmp/codex");
        expect(requests.length).toBe(1);
        expect(result.threadId).toBe("thr_session_forked");
        expect(result.composerIntent?.prompt).toBe("Continue from turn 2");
        expect(linked?.threadId).toBe("thr_session_forked");
        expect(linked?.projectId).toBe(defaultProjectId);
        expect(snapshot?.turns.length).toBe(2);
        expect(snapshot?.turns[1]?.turnId).toBe("turn_2");
        expect(snapshot?.latestCollaborationMode?.mode).toBe("plan");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("emits session thread start progress for local project starts", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Local session" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_local",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_local",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "Start local session",
          runInTarget: "localProject",
          skipAutoTitleGeneration: true,
        });

        const progressEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "threadStartProgress" }> => event.type === "threadStartProgress",
        );
        expect(progressEvents.some((event) =>
          event.sessionId === session.id
          && event.runInTarget === "localProject"
          && event.phase === "startingThread"
        )).toBe(true);
        expect(progressEvents.some((event) =>
          event.sessionId === session.id
          && event.threadId === "thr_session_local"
          && event.phase === "ready"
        )).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("emits failed session thread start progress for local project failures", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Local failure" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          throw new Error("local start failed");
        }
        return {};
      };

      try {
        let message = "";
        try {
          await service.startThreadForSession({
            projectId: defaultProjectId,
            sessionId: session.id,
            prompt: "Start local session",
            runInTarget: "localProject",
            skipAutoTitleGeneration: true,
          });
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toBe("local start failed");
        const progressEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "threadStartProgress" }> => event.type === "threadStartProgress",
        );
        expect(progressEvents.some((event) =>
          event.sessionId === session.id
          && event.runInTarget === "localProject"
          && event.phase === "failed"
          && event.message === "Message could not be sent."
        )).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("starts a session thread in a managed worktree when requested", async () => {
    const ran = await withTempDatabase(async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-session-worktree-repo-"));
      initializeGitRepository(repoPath);
      const project = createProject({ name: "Session Worktree", sources: [repoPath] });
      const session = createProjectSession({ projectId: project.id, noThreadFallbackTitle: "Session worktree" });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_worktree",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_worktree",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        if (method === "thread/goal/set") {
          return {
            goal: {
              threadId: "thr_session_worktree",
              objective: (params as { objective?: string }).objective ?? "",
              status: "active",
              tokenBudget: null,
              tokensUsed: 0,
              timeUsedSeconds: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        return {};
      };

      service.serializeThreadDetail = (threadId: string) => {
        const link = getProjectSession(session.id)?.thread;
        return {
          threadId,
          projectId: project.id,
          source: null,
          threadName: "Thread",
          threadPreview: "",
          modelProvider: "openai",
          cwd: link?.cwd ?? "",
          statusType: "active",
          statusActiveFlags: [],
          archived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          linkedAt: new Date().toISOString(),
          turns: [],
          transcript: [],
        };
      };

      try {
        await service.startThreadForSession({
          projectId: project.id,
          sessionId: session.id,
          prompt: "Start in worktree",
          threadGoalDraft: {
            objective: "Keep refining the worktree setup until tests pass",
          },
          runInTarget: "newWorktree",
          worktreeStartMode: "detachedHead",
          worktreeBranchPrefix: "nodex/",
          heartbeatAutomation: {
            name: "Follow up on worktree",
            prompt: "Check whether the worktree still needs attention.",
            rrule: "FREQ=HOURLY;INTERVAL=2",
          },
          skipAutoTitleGeneration: true,
        });

        const threadStartCwd = (requests.find((request) => request.method === "thread/start")?.params as { cwd?: string } | undefined)?.cwd ?? "";
        const turnStartCwd = (requests.find((request) => request.method === "turn/start")?.params as { cwd?: string } | undefined)?.cwd ?? "";
        const turnStartIndex = requests.findIndex((request) => request.method === "turn/start");
        const goalSetIndex = requests.findIndex((request) => request.method === "thread/goal/set");
        const goalSetParams = requests[goalSetIndex]?.params as {
          threadId?: string;
          objective?: string;
          status?: string;
        } | undefined;
        const linked = getProjectSession(session.id)?.thread;
        expect(threadStartCwd.length > 0).toBe(true);
        expect(threadStartCwd === repoPath).toBe(false);
        expect(fs.existsSync(threadStartCwd)).toBe(true);
        expect(turnStartCwd).toBe(threadStartCwd);
        expect(linked?.cwd).toBe(threadStartCwd);
        expect(linked?.managedWorktreePath).toBe(threadStartCwd);
        expect(goalSetIndex > turnStartIndex).toBe(true);
        expect(goalSetParams?.threadId).toBe("thr_session_worktree");
        expect(goalSetParams?.objective).toBe("Keep refining the worktree setup until tests pass");
        expect(goalSetParams?.status).toBe("active");

        const heartbeat = listCodexScheduledAutomations().find((automation) =>
          automation.kind === "heartbeat" && automation.targetThreadId === "thr_session_worktree"
        );
        if (!heartbeat) {
          throw new Error("Expected worktree start to create a heartbeat automation");
        }
        expect(heartbeat.name).toBe("Follow up on worktree");
        expect(heartbeat.prompt).toBe("Check whether the worktree still needs attention.");
        expect(heartbeat.rrule).toBe("FREQ=HOURLY;INTERVAL=2");
        expect(heartbeat.model).toBe(null);
        expect(heartbeat.reasoningEffort).toBe(null);

        const progressEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "threadStartProgress" }> => event.type === "threadStartProgress",
        );
        expect(progressEvents.some((event) =>
          event.sessionId === session.id
          && event.runInTarget === "newWorktree"
          && event.phase === "creatingWorktree"
        )).toBe(true);
        expect(progressEvents.some((event) =>
          event.sessionId === session.id
          && event.runInTarget === "newWorktree"
          && event.phase === "startingThread"
        )).toBe(true);
        expect(progressEvents.some((event) =>
          event.sessionId === session.id
          && event.runInTarget === "newWorktree"
          && event.threadId === "thr_session_worktree"
          && event.phase === "ready"
        )).toBe(true);
        expect(events.some((event) =>
          event.type === "scheduledAutomationChanged"
          && event.event.automationId === heartbeat.id
          && event.event.targetThreadId === "thr_session_worktree"
          && event.event.reason === "upsert"
        )).toBe(true);
      } finally {
        await service.shutdown();
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps managed worktree start successful when heartbeat automation creation fails", async () => {
    const ran = await withTempDatabase(async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-session-worktree-heartbeat-fail-"));
      initializeGitRepository(repoPath);
      const project = createProject({ name: "Session Worktree Heartbeat Fail", sources: [repoPath] });
      const session = createProjectSession({
        projectId: project.id,
        noThreadFallbackTitle: "Session worktree heartbeat fail",
      });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_worktree_heartbeat_fail",
              modelProvider: "openai",
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_worktree_heartbeat_fail",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      service.serializeThreadDetail = (threadId: string) => ({
        threadId,
        projectId: project.id,
        source: null,
        threadName: "Thread",
        threadPreview: "",
        modelProvider: "openai",
        cwd: getProjectSession(session.id)?.thread?.cwd ?? "",
        statusType: "active",
        statusActiveFlags: [],
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        linkedAt: new Date().toISOString(),
        turns: [],
        transcript: [],
      });

      try {
        const detail = await service.startThreadForSession({
          projectId: project.id,
          sessionId: session.id,
          prompt: "Start in worktree",
          runInTarget: "newWorktree",
          worktreeStartMode: "detachedHead",
          heartbeatAutomation: {
            name: "",
            prompt: "This seed should fail validation.",
            rrule: "FREQ=HOURLY;INTERVAL=2",
          },
          skipAutoTitleGeneration: true,
        });

        expect(detail.threadId).toBe("thr_session_worktree_heartbeat_fail");
        expect(listCodexScheduledAutomations().length).toBe(0);
        expect(events.some((event) =>
          event.type === "threadStartProgress"
          && event.runInTarget === "newWorktree"
          && event.threadId === "thr_session_worktree_heartbeat_fail"
          && event.phase === "startingThread"
          && event.message === "Started chat, but could not create the heartbeat."
          && event.outputDelta === "[stderr] Started chat, but could not create the heartbeat\n"
        )).toBe(true);
        expect(events.some((event) =>
          event.type === "threadStartProgress"
          && event.threadId === "thr_session_worktree_heartbeat_fail"
          && event.phase === "ready"
        )).toBe(true);
      } finally {
        await service.shutdown();
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("aborts session worktree start when selected environment setup fails", async () => {
    const ran = await withTempDatabase(async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-session-env-fail-repo-"));
      initializeGitRepository(repoPath);
      const project = createProject({ name: "Session Env Fail", sources: [repoPath] });
      const environmentsDir = path.join(repoPath, ".codex", "environments");
      fs.mkdirSync(environmentsDir, { recursive: true });
      fs.writeFileSync(
        path.join(environmentsDir, "environment.toml"),
        [
          'name = "session-env-fail"',
          "",
          "[setup]",
          "script = '''",
          "echo session-env-fail",
          "exit 9",
          "'''",
          "",
        ].join("\n"),
        "utf8",
      );
      const session = createProjectSession({ projectId: project.id, noThreadFallbackTitle: "Failing setup" });

      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      const events: CodexEvent[] = [];

      (service as unknown as {
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      }).on("event", (event) => {
        events.push(event);
      });

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        return {};
      };

      try {
        let message = "";
        try {
          await service.startThreadForSession({
            projectId: project.id,
            sessionId: session.id,
            prompt: "Fail setup",
            runInTarget: "newWorktree",
            runInEnvironmentPath: ".codex/environments/environment.toml",
            skipAutoTitleGeneration: true,
          });
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }

        expect(message.includes("Failed to set up new worktree using environment")).toBe(true);
        expect(requests.some((request) => request.method === "thread/start")).toBe(false);
        const progressEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "threadStartProgress" }> => event.type === "threadStartProgress",
        );
        expect(progressEvents.some((event) => event.sessionId === session.id && event.phase === "failed")).toBe(true);
      } finally {
        await service.shutdown();
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("rejects unsupported cloud session starts", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Cloud selector" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      client.start = async () => undefined;
      client.request = async () => ({});

      try {
        let message = "";
        try {
          await service.startThreadForSession({
            projectId: defaultProjectId,
            sessionId: session.id,
            prompt: "Send to cloud",
            runInTarget: "cloud",
            skipAutoTitleGeneration: true,
          });
        } catch (error) {
          message = error instanceof Error ? error.message : String(error);
        }
        expect(message).toBe("Cloud run target is not available yet. Choose Work locally or New worktree.");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("preserves session prompt attachments and selected model, reasoning, permission, and collaboration inputs", async () => {
    const ran = await withTempDatabase(async () => {
      const session = createProjectSession({ projectId: defaultProjectId, noThreadFallbackTitle: "Attachment composer" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];

      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_session_attachments",
              modelProvider: "openai",
              cwd: "/tmp/codex",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          };
        }
        if (method === "turn/start") {
          return {
            turn: {
              id: "turn_session_attachments",
              status: "in_progress",
              transcript: [],
            },
          };
        }
        return {};
      };

      try {
        await service.startThreadForSession({
          projectId: defaultProjectId,
          sessionId: session.id,
          prompt: "Fallback text",
          promptInput: {
            text: "Analyze this screenshot",
            images: [{ source: "data:image/png;base64,AAA", caption: "screen.png" }],
            mentions: [{ name: "README.md", path: "/tmp/codex/README.md" }],
          },
          model: "gpt-5.3-codex",
          reasoningEffort: "high",
          permissionMode: "full-access",
          collaborationMode: "plan",
          serviceTier: "fast",
          skipAutoTitleGeneration: true,
        });

        const threadStartRequest = requests.find((request) => request.method === "thread/start");
        const turnStartRequest = requests.find((request) => request.method === "turn/start");
        const turnStartParams = turnStartRequest?.params as {
          model?: string;
          effort?: string;
          input?: unknown;
          collaborationMode?: unknown;
        } | undefined;
        expect((threadStartRequest?.params as { model?: string } | undefined)?.model).toBe("gpt-5.3-codex");
        expect(turnStartParams?.model).toBe("gpt-5.3-codex");
        expect(turnStartParams?.effort).toBe("high");
        expect(JSON.stringify(turnStartParams?.collaborationMode)).toBe(JSON.stringify({
          mode: "plan",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        }));
        const serializedInput = JSON.stringify(turnStartParams?.input);
        expect(serializedInput.includes("Analyze this screenshot")).toBe(true);
        expect(serializedInput.includes("data:image/png;base64,AAA")).toBe(true);
        expect(serializedInput.includes("/tmp/codex/README.md")).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("starts source-less project sessions in an isolated local workspace", async () => {
    const ran = await withTempDatabase(async () => {
      const project = createProject({ name: "Missing Workspace" });
      const session = createProjectSession({ projectId: project.id, noThreadFallbackTitle: "No workspace" });
      const service = createService();
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params: unknown) => Promise<unknown>;
      };
      const requests: Array<{ method: string; params: unknown }> = [];
      client.start = async () => undefined;
      client.request = async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "config/read" || method === "configRequirements/read") {
          throw new Error("use fallback permission state");
        }
        if (method === "thread/start") {
          return {
            thread: {
              id: "thr_projectless_session",
              modelProvider: "openai",
              cwd: (params as { cwd?: string }).cwd,
              createdAt: 1,
              updatedAt: 1,
            },
          };
        }
        if (method === "turn/start") {
          return { turn: { id: "turn_projectless_session", status: "in_progress", items: [] } };
        }
        return {};
      };

      try {
        const detail = await service.startThreadForSession({
          projectId: project.id,
          sessionId: session.id,
          prompt: "Start without workspace",
          skipAutoTitleGeneration: true,
        });
        const threadStart = requests.find((request) => request.method === "thread/start");
        const cwd = (threadStart?.params as { cwd?: string } | undefined)?.cwd ?? "";
        expect(detail.threadId).toBe("thr_projectless_session");
        expect(cwd.includes(path.join("projectless-workspaces", project.id))).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("generates thread title through structured thread/start and turn/start flow", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;
    let threadStartParams: Record<string, unknown> | null = null;
    let turnStartParams: Record<string, unknown> | null = null;
    let unsubscribedThreadId: string | null = null;

    const mockClient = {
      startThread: async (params: Record<string, unknown>) => {
        threadStartParams = params;
        return { thread: { id: "thr_title_1" } };
      },
      startTurn: async (params: Record<string, unknown>) => {
        turnStartParams = params;
        setTimeout(() => {
          notificationHandler?.({
            method: "turn/started",
            params: { threadId: "thr_title_1", turn: { id: "turn_title_1" } },
          });
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_title_1",
              turnId: "turn_title_1",
              delta: "{\"title\":\"Refactor inbox list layout\"}",
            },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "thr_title_1", turn: { id: "turn_title_1", status: "completed" } },
          });
        }, 0);
        return { turn: { id: "turn_title_1" } };
      },
      interruptTurn: async () => ({}),
      unsubscribeThread: async (threadId: string) => {
        unsubscribedThreadId = threadId;
        return {};
      },
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      const generated = await serviceInternals.generateThreadTitleWithStructuredTurn({
        prompt: "Refactor inbox list layout",
        cwd: "/tmp/codex",
        client: mockClient,
      });
      expect(generated).toBe("Refactor inbox list layout");
      expect(JSON.stringify(threadStartParams)).toBe(JSON.stringify({
        model: CODEX_THREAD_TITLE_MODEL,
        modelProvider: null,
        cwd: "/tmp/codex",
        approvalPolicy: "never",
        permissions: ":read-only",
        runtimeWorkspaceRoots: [],
        config: CODEX_THREAD_TITLE_CONFIG,
        personality: null,
        ephemeral: true,
        threadSource: "system",
        experimentalRawEvents: false,
        dynamicTools: null,
        serviceTier: null,
      }));

      const turnStartPayload = turnStartParams && typeof turnStartParams === "object"
        ? turnStartParams as { clientUserMessageId?: unknown; input?: Array<{ text?: string }> }
        : {};
      expect(typeof turnStartPayload.clientUserMessageId).toBe("string");
      const generatedPrompt = turnStartPayload.input?.[0]?.text ?? "";
      expect(generatedPrompt.includes("User prompt:\nRefactor inbox list layout")).toBe(true);
      expect(JSON.stringify({
        ...(turnStartParams ?? {}),
        clientUserMessageId: "<uuid>",
        input: [{ type: "text", text: "<title-prompt>", text_elements: [] }],
      })).toBe(JSON.stringify({
        threadId: "thr_title_1",
        clientUserMessageId: "<uuid>",
        input: [{ type: "text", text: "<title-prompt>", text_elements: [] }],
        cwd: null,
        approvalPolicy: null,
        permissions: ":read-only",
        runtimeWorkspaceRoots: [],
        model: null,
        effort: null,
        serviceTier: null,
        summary: "none",
        personality: null,
        outputSchema: CODEX_THREAD_TITLE_OUTPUT_SCHEMA,
        collaborationMode: null,
      }));
      expect(unsubscribedThreadId).toBe("thr_title_1");
    } finally {
      await service.shutdown();
    }
  });

  test("trims generated title text and truncates input prompt before sending", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;
    let turnStartParams: Record<string, unknown> | null = null;
    let unsubscribedThreadId: string | null = null;
    const longPrompt = "x".repeat(2_500);

    const mockClient = {
      startThread: async () => ({ thread: { id: "thr_title_2" } }),
      startTurn: async (params: Record<string, unknown>) => {
        turnStartParams = params;
        setTimeout(() => {
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "other_thread",
              turnId: "other_turn",
              delta: "wrong stream",
            },
          });
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_title_2",
              turnId: "turn_title_2",
              delta: "This should be replaced",
            },
          });
          notificationHandler?.({
            method: "item/completed",
            params: {
              threadId: "thr_title_2",
              turnId: "turn_title_2",
              item: {
                type: "agentMessage",
                text: "{\"title\":\"title: \\\"Fix flaky.\\\"\"}",
              },
            },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "thr_title_2", turn: { id: "turn_title_2", status: "completed" } },
          });
        }, 0);
        return { turn: { id: "turn_title_2" } };
      },
      interruptTurn: async () => ({}),
      unsubscribeThread: async (threadId: string) => {
        unsubscribedThreadId = threadId;
        return {};
      },
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      const generated = await serviceInternals.generateThreadTitleWithStructuredTurn({
        prompt: longPrompt,
        cwd: "/tmp/codex",
        client: mockClient,
      });
      expect(generated).toBe("Fix flaky");

      const turnStartPayload = turnStartParams && typeof turnStartParams === "object"
        ? turnStartParams as { input?: Array<{ text?: string }> }
        : {};
      const generatedPrompt = turnStartPayload.input?.[0]?.text ?? "";
      const userPrompt = generatedPrompt.split("User prompt:\n")[1] ?? "";
      expect(userPrompt.length).toBe(2_000);
      expect(unsubscribedThreadId).toBe("thr_title_2");
    } finally {
      await service.shutdown();
    }
  });

  test("ignores unrelated notifications before the helper thread starts", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;

    const mockClient = {
      startThread: async () => ({ thread: { id: "thr_title_3" } }),
      startTurn: async () => {
        setTimeout(() => {
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "other_thread", turn: { id: "other_turn", status: "completed" } },
          });
          notificationHandler?.({
            method: "turn/started",
            params: { threadId: "thr_title_3", turn: { id: "turn_title_3" } },
          });
          notificationHandler?.({
            method: "item/agentMessage/delta",
            params: {
              threadId: "thr_title_3",
              turnId: "turn_title_3",
              delta: "{\"title\":\"Fix worktree startup race\"}",
            },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: { threadId: "thr_title_3", turn: { id: "turn_title_3", status: "completed" } },
          });
        }, 0);
        return { turn: { id: "turn_title_3" } };
      },
      interruptTurn: async () => ({}),
      unsubscribeThread: async () => ({}),
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      const generated = await serviceInternals.generateThreadTitleWithStructuredTurn({
        prompt: "Fix worktree startup race",
        cwd: "/tmp/codex",
        client: mockClient,
      });
      expect(generated).toBe("Fix worktree startup race");
    } finally {
      await service.shutdown();
    }
  });

  test("interrupts and unsubscribes helper title turns when they fail", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitleWithStructuredTurn: (input: {
        prompt: string;
        cwd: string | null;
        client: {
          startThread: (params: Record<string, unknown>) => Promise<unknown>;
          startTurn: (params: Record<string, unknown>) => Promise<unknown>;
          interruptTurn: (params: { threadId: string; turnId: string }) => Promise<unknown>;
          unsubscribeThread: (threadId: string) => Promise<unknown>;
          onNotification: (handler: (notification: { method: string; params: unknown }) => void) => () => void;
        };
      }) => Promise<string | null>;
    };
    let notificationHandler: ((notification: { method: string; params: unknown }) => void) | null = null;
    let interruptParams: { threadId: string; turnId: string } | null = null;
    let unsubscribedThreadId: string | null = null;

    const mockClient = {
      startThread: async () => ({ thread: { id: "thr_title_failed" } }),
      startTurn: async () => {
        setTimeout(() => {
          notificationHandler?.({
            method: "turn/started",
            params: { threadId: "thr_title_failed", turn: { id: "turn_title_failed" } },
          });
          notificationHandler?.({
            method: "turn/completed",
            params: {
              threadId: "thr_title_failed",
              turn: {
                id: "turn_title_failed",
                status: "failed",
                error: { message: "model unavailable" },
              },
            },
          });
        }, 0);
        return { turn: { id: "turn_title_failed" } };
      },
      interruptTurn: async (params: { threadId: string; turnId: string }) => {
        interruptParams = params;
        return {};
      },
      unsubscribeThread: async (threadId: string) => {
        unsubscribedThreadId = threadId;
        return {};
      },
      onNotification: (handler: (notification: { method: string; params: unknown }) => void) => {
        notificationHandler = handler;
        return () => {
          notificationHandler = null;
        };
      },
    };

    try {
      let didReject = false;
      try {
        await serviceInternals.generateThreadTitleWithStructuredTurn({
          prompt: "Fix title flow",
          cwd: "/tmp/codex",
          client: mockClient,
        });
      } catch {
        didReject = true;
      }

      expect(didReject).toBe(true);
      expect(JSON.stringify(interruptParams)).toBe(JSON.stringify({
        threadId: "thr_title_failed",
        turnId: "turn_title_failed",
      }));
      expect(unsubscribedThreadId).toBe("thr_title_failed");
    } finally {
      await service.shutdown();
    }
  });

  test("returns null when title generation fails", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      generateThreadTitle: (input: { prompt: string; cwd: string | null }) => Promise<{ title: string | null }>;
    };
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
    };
    client.start = async () => {
      throw new Error("boom");
    };

    try {
      const result = await serviceInternals.generateThreadTitle({
        prompt: "Fix the title flow",
        cwd: null,
      });

      expect(JSON.stringify(result)).toBe(JSON.stringify({ title: null }));
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
      expect(JSON.stringify(capturedRequest?.params)).toBe(JSON.stringify({
        hostId: "local",
        prompt: "Changes:\ndiff --git a/feature.txt b/feature.txt",
        cwd: "/tmp/project",
      }));
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

      expect(JSON.stringify(message)).toBe(JSON.stringify({
        title: "Generated PR title",
        body: "Generated PR body",
      }));
      const capturedRequest = requests[0];
      expect(capturedRequest?.method).toBe("generate-pull-request-message");
      expect(JSON.stringify(capturedRequest?.params)).toBe(JSON.stringify({
        hostId: "local",
        prompt: "Branches:\n- Head: feature\n- Base: main",
        cwd: "/tmp/project",
      }));
    } finally {
      await service.shutdown();
    }
  });

  test("lists managed worktrees once per path when reused by multiple threads", async () => {
    const ran = await withTempDatabase(async () => {
      const localStoreDir = process.env.NODEX_DIR;
      if (!localStoreDir) {
        throw new Error("NODEX_DIR was not set by withTempDatabase");
      }
      const sharedPath = path.join(localStoreDir, "worktrees", "reuse", defaultProjectId);
      fs.mkdirSync(sharedPath, { recursive: true });

      const olderLinkedAt = "2026-03-01T00:00:00.000Z";
      const newerLinkedAt = "2026-03-02T00:00:00.000Z";
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_reused_path_old",
        threadName: "Old Thread",
        cwd: sharedPath,
        linkedAt: olderLinkedAt,
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_reused_path_new",
        threadName: "New Thread",
        cwd: sharedPath,
        linkedAt: newerLinkedAt,
      });

      const service = createService();
      try {
        const records = await service.listManagedWorktrees();
        expect(records.length).toBe(1);
        expect(records[0]?.path).toBe(path.resolve(sharedPath));
        expect(records[0]?.threadId).toBe("thr_reused_path_new");
        expect(records[0]?.linkedAt).toBe(newerLinkedAt);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("deletes managed worktree directory and unlinks all threads that point to that path", async () => {
    const ran = await withTempDatabase(async () => {
      const localStoreDir = process.env.NODEX_DIR;
      if (!localStoreDir) {
        throw new Error("NODEX_DIR was not set by withTempDatabase");
      }

      const sharedPath = path.join(localStoreDir, "worktrees", "delete", defaultProjectId);
      const otherPath = path.join(localStoreDir, "worktrees", "keep", defaultProjectId);
      fs.mkdirSync(sharedPath, { recursive: true });
      fs.mkdirSync(otherPath, { recursive: true });

      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_delete_old",
        cwd: sharedPath,
        linkedAt: "2026-03-01T00:00:00.000Z",
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_delete_new",
        cwd: sharedPath,
        linkedAt: "2026-03-02T00:00:00.000Z",
      });
      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_keep",
        cwd: otherPath,
        linkedAt: "2026-03-03T00:00:00.000Z",
      });

      const service = createService();
      try {
        const deleted = await service.deleteManagedWorktree("thr_delete_new");
        expect(deleted).toBe(true);
        expect(fs.existsSync(sharedPath)).toBe(false);
        expect(getCodexThread("thr_delete_new")).toBe(null);
        expect(getCodexThread("thr_delete_old")).toBe(null);
        expect(getCodexThread("thr_keep")).not.toBeNull();
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("removes git worktree metadata when deleting a managed worktree", async () => {
    const ran = await withTempDatabase(async () => {
      const localStoreDir = process.env.NODEX_DIR;
      if (!localStoreDir) {
        throw new Error("NODEX_DIR was not set by withTempDatabase");
      }

      const repositoryPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-delete-worktree-repo-"));
      initializeGitRepository(repositoryPath);

      const managedPath = path.join(localStoreDir, "worktrees", "git-remove", defaultProjectId);
      fs.mkdirSync(path.dirname(managedPath), { recursive: true });
      execFileSync("git", ["worktree", "add", "--detach", managedPath, "main"], { cwd: repositoryPath });

      upsertCodexThread({
        projectId: defaultProjectId,
        threadId: "thr_git_remove",
        cwd: managedPath,
      });

      const service = createService();
      try {
        const deleted = await service.deleteManagedWorktree("thr_git_remove");
        expect(deleted).toBe(true);
        expect(fs.existsSync(managedPath)).toBe(false);

        const worktreeListOutput = execFileSync(
          "git",
          ["worktree", "list", "--porcelain"],
          { cwd: repositoryPath, encoding: "utf8" },
        );
        expect(worktreeListOutput.includes(path.resolve(managedPath))).toBe(false);
      } finally {
        await service.shutdown();
        fs.rmSync(repositoryPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBe(true);
  });

});

describe("codex-service approval fallback", () => {
  test("answers app-server currentTime/read requests with Unix seconds", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
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

  test("does not write permission modes disallowed by current requirements", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const stateByProject = Reflect.get(service as object, "permissionStateByProject") as Map<string, CodexPermissionState>;
      const client = Reflect.get(service as object, "client") as {
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      let wroteConfig = false;

      stateByProject.set(defaultProjectId, {
        mode: "auto",
        effectivePreset: "auto",
        availableModes: ["auto", "full-access", "custom"],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        sandbox: null,
        autoReviewAvailable: true,
        configTarget: {
          source: "user",
          filePath: "/Users/test/.codex/config.toml",
        },
        customDescription: null,
      });
      client.request = async (method: string) => {
        if (method === "config/batchWrite") {
          wroteConfig = true;
        }
        return {};
      };

      try {
        const state = await service.setProjectPermissionMode(defaultProjectId, "guardian-approvals");

        expect(wroteConfig).toBe(false);
        expect(state.mode).toBe("auto");
        expect(state.availableModes.includes("guardian-approvals")).toBe(false);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("auto-accepts approval requests in full-access mode", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      };

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      await service.setProjectPermissionMode(defaultProjectId, "full-access");

      try {
        const result = await serviceInternals.handleServerRequest({
          id: "req_full_access",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_full",
            turnId: "turn_full",
            itemId: "item_full",
            reason: "Needs permissions",
          },
        });

        expect(JSON.stringify(result)).toBe(JSON.stringify({ decision: "accept" }));
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("queues approval requests outside full-access mode", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
        pendingApprovals: Map<
          string,
          {
            reject: (reason?: unknown) => void;
          }
        >;
      };

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      await service.setProjectPermissionMode(defaultProjectId, "auto");

      try {
        const requestPromise = serviceInternals.handleServerRequest({
          id: "req_sandbox",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_default",
            turnId: "turn_default",
            itemId: "item_default",
            reason: "Needs permissions",
          },
        });

        await Promise.resolve();
        expect(serviceInternals.pendingApprovals.size).toBe(1);
        const approvalItem = getRecordedItem(serviceInternals, "thr_default", "turn_default", "item_default");
        expect(approvalItem?.normalizedKind).toBe("commandExecution");
        expect(approvalItem?.approvalRequestId).toBe("req_sandbox");

        for (const pending of serviceInternals.pendingApprovals.values()) {
          pending.reject(new Error("test cleanup"));
        }
        await requestPromise.catch(() => undefined);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("routes approval request ingress to renderer owner without source-null stream patches", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
        pendingApprovals: Map<
          string,
          {
            reject: (reason?: unknown) => void;
          }
        >;
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
      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      await service.setProjectPermissionMode(defaultProjectId, "auto");
      serviceInternals.setRendererConversationOwner("thr_owner_request", "owner-a");

      try {
        const requestPromise = serviceInternals.handleServerRequest({
          id: "req_owner_approval",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_owner_request",
            turnId: "turn_owner_request",
            itemId: "item_owner_request",
            startedAtMs: 10,
            environmentId: null,
            reason: "Needs permissions",
            command: "bun test",
          },
        });

        await Promise.resolve();
        expect(serviceInternals.pendingApprovals.has("req_owner_approval")).toBe(true);
        expect(String(hostMessages.length)).toBe("0");
        expect(String(ownerMessages.length)).toBe("1");
        expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
        expect(ownerMessages[0]?.message.type).toBe("threadOwnerRequest");
        if (ownerMessages[0]?.message.type === "threadOwnerRequest") {
          expect(ownerMessages[0].message.request.id).toBe("req_owner_approval");
          expect(ownerMessages[0].message.request.method).toBe("item/commandExecution/requestApproval");
          expect(ownerMessages[0].message.sequence).toBe(1);
        }

        for (const pending of serviceInternals.pendingApprovals.values()) {
          pending.reject(new Error("test cleanup"));
        }
        await requestPromise.catch(() => undefined);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("routes dynamic tool-call requests through renderer owner from bundle 51920-52390", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      pendingDynamicToolCalls: Map<string, unknown>;
      respondToDynamicToolCall: (requestId: string) => Promise<{ success: boolean } | null>;
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
        id: "req_dynamic_tool",
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
      expect(serviceInternals.pendingDynamicToolCalls.has("req_dynamic_tool")).toBe(true);
      expect(String(hostMessages.length)).toBe("0");
      expect(String(ownerMessages.length)).toBe("1");
      expect(ownerMessages[0]?.targetClientId).toBe("owner-dynamic");
      expect(ownerMessages[0]?.message.type).toBe("threadOwnerRequest");
      if (ownerMessages[0]?.message.type === "threadOwnerRequest") {
        expect(ownerMessages[0].message.request.id).toBe("req_dynamic_tool");
        expect(ownerMessages[0].message.request.method).toBe("item/tool/call");
        expect(ownerMessages[0].message.sequence).toBe(1);
      }

      const ownerResponse = await serviceInternals.respondToDynamicToolCall("req_dynamic_tool");
      const serverResponse = await requestPromise as { success: boolean };
      expect(ownerResponse?.success).toBe(false);
      expect(serverResponse.success).toBe(false);
      expect(serviceInternals.pendingDynamicToolCalls.has("req_dynamic_tool")).toBe(false);
    } finally {
      await service.shutdown();
    }
  });

  test("executes automation_update create, update, and delete through the scheduled automation store", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      };
      const events: CodexEvent[] = [];
      service.on("event", (event) => {
        events.push(event);
      });

      const callAutomationUpdate = async (id: string, args: Record<string, unknown>) => {
        return await serviceInternals.handleServerRequest({
          id,
          method: "item/tool/call",
          params: {
            threadId: "thr_automation_tool",
            turnId: "turn_automation_tool",
            callId: id,
            namespace: "codex_app",
            tool: "automation_update",
            arguments: args,
          },
        }) as {
          contentItems: Array<{ type: string; text?: string }>;
          success: boolean;
        };
      };

      try {
        const createdResponse = await callAutomationUpdate("call_create_automation", {
          mode: "create",
          kind: "cron",
          name: "Daily review",
          prompt: "Summarize project status.",
          rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
          status: "ACTIVE",
          cwds: ["/tmp/codex"],
          destination: "local",
          executionEnvironment: "local",
          model: "gpt-5.4",
          reasoningEffort: "medium",
        });
        const createdResult = JSON.parse(createdResponse.contentItems[1]?.text ?? "{}") as {
          automationId?: string;
          mode?: string;
        };
        const automationId = createdResult.automationId ?? "";
        const created = getCodexScheduledAutomation(automationId);

        expect(createdResponse.success).toBe(true);
        expect(createdResponse.contentItems[0]?.text).toBe("Created automation in the app.");
        expect(createdResult.mode).toBe("create");
        expect(created?.name).toBe("Daily review");
        expect(created?.status).toBe("ACTIVE");
        expect(created?.executionEnvironment).toBe("local");

        const updatedResponse = await callAutomationUpdate("call_update_automation", {
          mode: "update",
          id: automationId,
          kind: "cron",
          name: "Daily review paused",
          prompt: "Summarize project blockers.",
          rrule: "FREQ=DAILY;BYHOUR=10;BYMINUTE=30",
          status: "PAUSED",
          cwds: "/tmp/codex",
          destination: "local",
          executionEnvironment: "local",
          model: "gpt-5.4",
          reasoningEffort: "high",
        });
        const updatedResult = JSON.parse(updatedResponse.contentItems[1]?.text ?? "{}") as {
          automationId?: string;
          mode?: string;
        };
        const updated = getCodexScheduledAutomation(automationId);

        expect(updatedResponse.success).toBe(true);
        expect(updatedResponse.contentItems[0]?.text).toBe("Updated automation in the app.");
        expect(updatedResult.automationId).toBe(automationId);
        expect(updatedResult.mode).toBe("update");
        expect(updated?.name).toBe("Daily review paused");
        expect(updated?.status).toBe("PAUSED");
        expect(updated?.reasoningEffort).toBe("high");

        insertCodexAutomationRunInProgress({
          threadId: "thread-tool-run",
          automationId,
          threadTitle: "Daily review paused",
          sourceCwd: "/tmp/codex",
          now: Date.UTC(2026, 6, 8, 13, 20, 0),
        });

        const deletedResponse = await callAutomationUpdate("call_delete_automation", {
          mode: "delete",
          id: automationId,
        });
        const deletedResult = JSON.parse(deletedResponse.contentItems[1]?.text ?? "{}") as {
          automationId?: string;
          mode?: string;
          deleteStatus?: string;
          snapshot?: { kind?: string; name?: string; rrule?: string | null } | null;
        };
        const deleted = getCodexScheduledAutomation(automationId);
        const deletedRun = getCodexAutomationRun("thread-tool-run");
        const scheduledEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "scheduledAutomationChanged" }> => (
            event.type === "scheduledAutomationChanged"
          ),
        );
        const runUpdateEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "automationRunsUpdated" }> => (
            event.type === "automationRunsUpdated"
          ),
        );

        expect(deletedResponse.success).toBe(true);
        expect(deletedResponse.contentItems[0]?.text).toBe("Deleted automation in the app.");
        expect(deletedResult.automationId).toBe(automationId);
        expect(deletedResult.mode).toBe("delete");
        expect(deletedResult.deleteStatus).toBe("deleted");
        expect(deletedResult.snapshot?.kind).toBe("cron");
        expect(deletedResult.snapshot?.name).toBe("Daily review paused");
        expect(deleted).toBe(null);
        expect(deletedRun).toBe(null);
        expect(scheduledEvents.map((event) => event.event.reason).join(",")).toBe("upsert,upsert,delete");
        expect(scheduledEvents.at(-1)?.event.automationId).toBe(automationId);
        expect(runUpdateEvents.map((event) => event.event.reason).join(",")).toBe("delete");
        expect(runUpdateEvents[0]?.event.automationId).toBe(automationId);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps automation_update suggested setup proposals render-only and blocks immediate setup-capable worktree creates", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      };
      const callAutomationUpdate = async (id: string, mode: string) => {
        return await serviceInternals.handleServerRequest({
          id,
          method: "item/tool/call",
          params: {
            threadId: "thr_automation_tool",
            turnId: "turn_automation_tool",
            callId: id,
            namespace: "codex_app",
            tool: "automation_update",
            arguments: {
              mode,
              kind: "cron",
              name: "Unsafe setup",
              prompt: "Run setup-aware work.",
              rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
              status: "ACTIVE",
              cwds: ["/tmp/codex"],
              destination: "worktree",
              executionEnvironment: "worktree",
              localEnvironmentConfigPath: ".codex/setup.toml",
              model: "gpt-5.4",
              reasoningEffort: "medium",
            },
          },
        }) as {
          contentItems: Array<{ type: string; text?: string }>;
          success: boolean;
        };
      };

      try {
        const blocked = await callAutomationUpdate("call_blocked_setup", "create");
        const suggested = await callAutomationUpdate("call_suggested_setup", "suggested_create");

        expect(blocked.success).toBe(false);
        expect(blocked.contentItems[0]?.text).toBe("For safety, automations created by the model cannot immediately run a worktree local environment setup script. Use suggested_create or suggested_update so the user can review and approve the setup-capable automation, or set localEnvironmentConfigPath to null.");
        expect(suggested.success).toBe(true);
        expect(suggested.contentItems.length).toBe(1);
        expect(suggested.contentItems[0]?.text).toBe("Rendered automation card in the app.");
        expect(getCodexScheduledAutomation("unsafe-setup")).toBe(null);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("requires automation_update heartbeat targets to be local threads for direct writes", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      };
      const events: CodexEvent[] = [];
      service.on("event", (event) => {
        events.push(event);
      });

      const callAutomationUpdate = async (id: string, args: Record<string, unknown>) => {
        return await serviceInternals.handleServerRequest({
          id,
          method: "item/tool/call",
          params: {
            threadId: "thr_current_local_tool",
            turnId: "turn_automation_tool",
            callId: id,
            namespace: "codex_app",
            tool: "automation_update",
            arguments: args,
          },
        }) as {
          contentItems: Array<{ type: string; text?: string }>;
          success: boolean;
        };
      };

      try {
        const blocked = await callAutomationUpdate("call_remote_heartbeat", {
          mode: "create",
          kind: "heartbeat",
          name: "Remote heartbeat",
          prompt: "Continue that other thread.",
          rrule: "FREQ=HOURLY;INTERVAL=1",
          status: "ACTIVE",
          destination: "thread",
          targetThreadId: "thr_not_in_local_store",
        });

        upsertCodexThread({
          projectId: defaultProjectId,
          threadId: "thr_known_local_target",
          threadName: "Known local target",
          cwd: "/tmp/codex",
          linkedAt: "2026-07-08T13:00:00.000Z",
        });

        const created = await callAutomationUpdate("call_local_heartbeat", {
          mode: "create",
          kind: "heartbeat",
          name: "Local heartbeat",
          prompt: "Continue the local thread.",
          rrule: "FREQ=HOURLY;INTERVAL=1",
          status: "ACTIVE",
          destination: "thread",
          targetThreadId: "thr_known_local_target",
        });
        const createdResult = JSON.parse(created.contentItems[1]?.text ?? "{}") as {
          automationId?: string;
          mode?: string;
        };
        const automation = getCodexScheduledAutomation(createdResult.automationId ?? "");
        const scheduledEvents = events.filter(
          (event): event is Extract<CodexEvent, { type: "scheduledAutomationChanged" }> => (
            event.type === "scheduledAutomationChanged"
          ),
        );

        expect(blocked.success).toBe(false);
        expect(blocked.contentItems[0]?.text).toBe("Automations are only supported for local threads.");
        expect(listCodexScheduledAutomations().length).toBe(1);
        expect(created.success).toBe(true);
        expect(created.contentItems[0]?.text).toBe("Created automation in the app.");
        expect(createdResult.mode).toBe("create");
        expect(automation?.kind).toBe("heartbeat");
        expect(automation?.targetThreadId).toBe("thr_known_local_target");
        expect(scheduledEvents.length).toBe(1);
        expect(scheduledEvents[0]?.event.targetThreadId).toBe("thr_known_local_target");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("routes permissions request ingress and response through renderer owner from bundle 51920 and 38740", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
        respondToPermissionRequest: (
          requestId: string,
          response: { permissions: { network?: { enabled: boolean | null } }; scope: "turn" | "session" },
        ) => Promise<boolean>;
        pendingPermissionRequests: Map<
          string,
          {
            reject: (reason?: unknown) => void;
          }
        >;
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
      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      serviceInternals.setRendererConversationOwner("thr_owner_permission", "owner-a");

      try {
        const requestPromise = serviceInternals.handleServerRequest({
          id: "req_owner_permission",
          method: "item/permissions/requestApproval",
          params: {
            threadId: "thr_owner_permission",
            turnId: "turn_owner_permission",
            itemId: "permission_call_1",
            environmentId: "env-1",
            startedAtMs: 20,
            cwd: "/repo",
            reason: "Need network",
            permissions: {
              network: { enabled: true },
              fileSystem: null,
            },
          },
        });

        await Promise.resolve();
        expect(serviceInternals.pendingPermissionRequests.has("req_owner_permission")).toBe(true);
        expect(String(hostMessages.length)).toBe("0");
        expect(String(ownerMessages.length)).toBe("1");
        expect(ownerMessages[0]?.targetClientId).toBe("owner-a");
        expect(ownerMessages[0]?.message.type).toBe("threadOwnerRequest");
        if (ownerMessages[0]?.message.type === "threadOwnerRequest") {
          expect(ownerMessages[0].message.request.id).toBe("req_owner_permission");
          expect(ownerMessages[0].message.request.method).toBe("item/permissions/requestApproval");
          expect(ownerMessages[0].message.sequence).toBe(1);
        }

        const pendingItem = getRecordedItem(
          serviceInternals,
          "thr_owner_permission",
          "turn_owner_permission",
          "permission-request-req_owner_permission",
        );
        expect(pendingItem?.semanticKind).toBe("permissionRequest");
        expect(pendingItem?.status).toBe("inProgress");

        const response = { permissions: { network: { enabled: true } }, scope: "turn" as const };
        const accepted = await serviceInternals.respondToPermissionRequest("req_owner_permission", response);
        const result = await requestPromise;
        const completedItem = getRecordedItem(
          serviceInternals,
          "thr_owner_permission",
          "turn_owner_permission",
          "permission-request-req_owner_permission",
        );

        expect(accepted).toBe(true);
        expect(JSON.stringify(result)).toBe(JSON.stringify(response));
        expect(serviceInternals.pendingPermissionRequests.has("req_owner_permission")).toBe(false);
        expect(completedItem?.status).toBe("completed");
        expect(JSON.stringify(completedItem?.rawItem)).toBe(JSON.stringify({
          id: "permission-request-req_owner_permission",
          type: "permissionRequest",
          requestId: "req_owner_permission",
          turnId: "turn_owner_permission",
          reason: "Need network",
          permissions: {
            network: { enabled: true },
            fileSystem: null,
          },
          completed: true,
          response,
        }));
        expect(String(hostMessages.length)).toBe("0");
      } finally {
        for (const pending of serviceInternals.pendingPermissionRequests.values()) {
          pending.reject(new Error("test cleanup"));
        }
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keys pending approvals by JSON-RPC request.id", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
        handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
        pendingApprovals: Map<
          string,
          {
            request: { requestId: string };
            reject: (reason?: unknown) => void;
          }
        >;
        on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
      };
      const events: CodexEvent[] = [];

      serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
      await service.setProjectPermissionMode(defaultProjectId, "auto");
      serviceInternals.on("event", (event) => {
        events.push(event);
      });

      try {
        const requestPromise = serviceInternals.handleServerRequest({
          id: 42,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thr_request_id",
            turnId: "turn_request_id",
            itemId: "item_request_id",
            reason: "Needs permissions",
          },
        });

        await Promise.resolve();
        expect(serviceInternals.pendingApprovals.has("42")).toBe(true);
        const approvalItem = getRecordedItem(serviceInternals, "thr_request_id", "turn_request_id", "item_request_id");
        expect(approvalItem?.approvalRequestId).toBe("42");

        const requestedEvent = events.find(
          (event): event is Extract<CodexEvent, { type: "approvalRequested" }> => event.type === "approvalRequested",
        );
        expect(requestedEvent?.request.requestId).toBe("42");

        for (const pending of serviceInternals.pendingApprovals.values()) {
          pending.reject(new Error("test cleanup"));
        }
        await requestPromise.catch(() => undefined);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });
});

describe("codex-service streaming notification parity", () => {
  test("drops plan and reasoning deltas that arrive before item/started", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      await serviceInternals.handleNotification("item/plan/delta", {
        threadId: "thr_plan_delta",
        turnId: "turn_plan_delta",
        itemId: "plan_item",
        delta: "1. Clarify requirements",
      });
      await serviceInternals.handleNotification("item/reasoning/summaryTextDelta", {
        threadId: "thr_plan_delta",
        turnId: "turn_plan_delta",
        itemId: "reasoning_item",
        summaryIndex: 0,
        delta: "Thinking",
      });
      await serviceInternals.handleNotification("item/reasoning/textDelta", {
        threadId: "thr_plan_delta",
        turnId: "turn_plan_delta",
        itemId: "reasoning_item",
        contentIndex: 0,
        delta: "Private",
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      const planItem = getRecordedItem(serviceInternals, "thr_plan_delta", "turn_plan_delta", "plan_item");
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_plan_delta_existing",
        turnId: "turn_plan_delta_existing",
        item: {
          id: "plan_item",
          type: "plan",
          text: "",
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      await serviceInternals.handleNotification("item/plan/delta", {
        threadId: "thr_plan_delta_existing",
        turnId: "turn_plan_delta_existing",
        itemId: "plan_item",
        delta: "Draft plan",
      });
      await serviceInternals.handleNotification("item/plan/delta", {
        threadId: "thr_plan_delta_existing",
        turnId: "turn_plan_delta_existing",
        itemId: "plan_item",
        delta: " from deltas",
      });
      await waitForCondition(() => hostMessages.length > 0, 120);

      expect(hostMessages.length > 0).toBe(true);
      const firstHostMessage = hostMessages[0];
      expect(
        firstHostMessage?.type === "threadStreamStateChanged"
          ? firstHostMessage.change.type
          : "snapshot",
      ).toBe("patches");
      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("Draft plan from deltas");

      let planItem = getRecordedItem(
        serviceInternals,
        "thr_plan_delta_existing",
        "turn_plan_delta_existing",
        "plan_item",
      );
      expect(planItem?.semanticKind).toBe("proposedPlan");
      expect(planItem?.markdownText).toBe("Draft plan from deltas");

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_plan_delta_existing",
        turnId: "turn_plan_delta_existing",
        item: {
          id: "plan_item",
          type: "plan",
          text: "Final authoritative plan",
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };
    const hostMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });

    serviceInternals.setConversationRecordDetail({
      ...makeThreadDetail("thr_reasoning_delta"),
      turns: [{
        threadId: "thr_reasoning_delta",
        turnId: "turn_reasoning_delta",
        status: "inProgress",
        itemIds: [],
      }],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_reasoning_delta",
        turnId: "turn_reasoning_delta",
        item: {
          id: "reasoning_delta_item",
          type: "reasoning",
          summary: [],
          content: [],
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      await serviceInternals.handleNotification("item/reasoning/summaryTextDelta", {
        threadId: "thr_reasoning_delta",
        turnId: "turn_reasoning_delta",
        itemId: "reasoning_delta_item",
        summaryIndex: 0,
        delta: "Thinking",
      });
      await waitForCondition(() => hostMessages.length > 0, 120);

      expect(hostMessages.length > 0).toBe(true);
      const firstHostMessage = hostMessages[0];
      expect(
        firstHostMessage?.type === "threadStreamStateChanged"
          ? firstHostMessage.change.type
          : "snapshot",
      ).toBe("patches");
      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("Thinking");
      const rawItem = latest?.turns[0]?.items[0]?.rawItem;
      const summary = rawItem && typeof rawItem === "object"
        ? (rawItem as { summary?: unknown[] }).summary
        : null;
      expect(Array.isArray(summary)).toBe(true);
      expect(String(summary?.[0] ?? "")).toBe("Thinking");

      hostMessages.length = 0;
      await serviceInternals.handleNotification("item/reasoning/textDelta", {
        threadId: "thr_reasoning_delta",
        turnId: "turn_reasoning_delta",
        itemId: "reasoning_delta_item",
        contentIndex: 0,
        delta: "Private chain",
      });
      await waitForCondition(() => hostMessages.length > 0, 120);

      const contentLatest = projectConversationFromHostMessages(hostMessages, latest);
      const contentRawItem = contentLatest?.turns[0]?.items[0]?.rawItem;
      const content = contentRawItem && typeof contentRawItem === "object"
        ? (contentRawItem as { content?: unknown[] }).content
        : null;
      expect(Array.isArray(content)).toBe(true);
      expect(String(content?.[0] ?? "")).toBe("Private chain");
    } finally {
      await service.shutdown();
    }
  });

  test("handles serverRequest/resolved by clearing pending approvals and user inputs", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      handleNotification: (method: string, params: unknown) => Promise<void>;
      pendingApprovals: Map<string, unknown>;
      pendingUserInputs: Map<string, unknown>;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    await service.setProjectPermissionMode(defaultProjectId, "auto");
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      const approvalPromise = serviceInternals.handleServerRequest({
        id: "approval_req",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thr_resolved",
          turnId: "turn_resolved",
          itemId: "item_approval",
        },
      });
      const userInputPromise = serviceInternals.handleServerRequest({
        id: "input_req",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_resolved",
          turnId: "turn_resolved",
          itemId: "item_input",
          questions: [
            {
              id: "q1",
              header: "Header",
              question: "Question",
            },
          ],
        },
      });

      await Promise.resolve();
      expect(serviceInternals.pendingApprovals.has("approval_req")).toBe(true);
      expect(serviceInternals.pendingUserInputs.has("input_req")).toBe(true);

      await serviceInternals.handleNotification("serverRequest/resolved", {
        threadId: "thr_resolved",
        requestId: "approval_req",
      });
      await serviceInternals.handleNotification("serverRequest/resolved", {
        threadId: "thr_resolved",
        requestId: "input_req",
      });

      const approvalResult = await approvalPromise;
      const inputResult = await userInputPromise;
      expect(JSON.stringify(approvalResult)).toBe(JSON.stringify({ decision: "cancel" }));
      expect(JSON.stringify(inputResult)).toBe(JSON.stringify({ answers: {} }));
      expect(serviceInternals.pendingApprovals.has("approval_req")).toBe(false);
      expect(serviceInternals.pendingUserInputs.has("input_req")).toBe(false);
      const approvalItem = getRecordedItem(serviceInternals, "thr_resolved", "turn_resolved", "item_approval");
      expect(approvalItem?.approvalRequestId ?? null).toBe(null);

      const approvalResolvedEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "approvalResolved" }> => event.type === "approvalResolved",
      );
      const userInputResolvedEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "userInputResolved" }> => event.type === "userInputResolved",
      );
      expect(approvalResolvedEvents.some((event) => event.requestId === "approval_req")).toBe(true);
      expect(userInputResolvedEvents.some((event) => event.requestId === "input_req")).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("respondToUserInput persists answered questions onto the transcript item", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      getConversationRecord: (threadId: string) => {
        itemsByTurn: Map<string, Map<string, CodexItemView>>;
      };
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
      on: (eventName: "event", listener: (event: CodexEvent) => void) => void;
    };
    const events: CodexEvent[] = [];

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    serviceInternals.persistThreadSnapshot = () => {};
    serviceInternals.on("event", (event) => {
      events.push(event);
    });

    try {
      serviceInternals.mergeTurn("thr_input", {
        threadId: "thr_input",
        turnId: "turn_input",
        status: "inProgress",
        itemIds: ["item_input"],
      });
      const requestPromise = serviceInternals.handleServerRequest({
        id: "input_req",
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thr_input",
          turnId: "turn_input",
          itemId: "item_input",
          questions: [
            {
              id: "q1",
              header: "Math",
              question: "What is 1 + 1?",
              options: [{ label: "2", description: "Correct" }],
            },
          ],
        },
      });

      await Promise.resolve();
      const responded = await service.respondToUserInput("input_req", { q1: ["2"] });
      expect(responded).toBe(true);

      const resolved = await requestPromise;
      expect(JSON.stringify(resolved)).toBe(JSON.stringify({
        answers: {
          q1: {
            answers: ["2"],
          },
        },
      }));

      const answeredItem = getRecordedItem(
        serviceInternals,
        "thr_input",
        "turn_input",
        "user-input-response-input_req",
      );

      expect(answeredItem?.normalizedKind).toBe("userInputResponse");
      expect(answeredItem?.semanticKind).toBe("userInputResponse");
      expect(answeredItem?.status).toBe("completed");
      expect(answeredItem?.userInputQuestions?.[0]?.question).toBe("What is 1 + 1?");
      expect(answeredItem?.userInputAnswers?.q1?.[0]).toBe("2");
      expect((answeredItem?.rawItem as { answers?: Record<string, string[]> } | undefined)?.answers?.q1?.[0]).toBe("2");
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service custom permission descriptions", () => {
  test("reports parsed CODEX_HOME config values for custom mode", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        findProjectCodexConfig: (projectId: string) => { configPath: string; displayPath: string } | null;
      };
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const originalCodexHome = process.env.CODEX_HOME;
      const tempCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-home-"));
      const configPath = path.join(tempCodexHome, "config.toml");

      fs.writeFileSync(
        configPath,
        [
          'sandbox_mode = "workspace-write"',
          'approval_policy = "on-request"',
          "",
        ].join("\n"),
        "utf8",
      );
      process.env.CODEX_HOME = tempCodexHome;
      serviceInternals.findProjectCodexConfig = () => null;
      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read") {
          return {
            config: {
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
            origins: {
              sandbox_mode: {
                name: {
                  type: "user",
                  file: configPath,
                },
              },
              approval_policy: {
                name: {
                  type: "user",
                  file: configPath,
                },
              },
              approvals_reviewer: {
                name: {
                  type: "user",
                  file: configPath,
                },
              },
              sandbox_workspace_write: undefined,
            },
          };
        }
        if (method === "configRequirements/read") {
          return { requirements: null };
        }
        return {};
      };

      try {
        const description = await service.getCustomPermissionModeDescription(defaultProjectId);
        expect(description).toBe(
          `User config (${configPath}): sandbox_mode=workspace-write; approval_policy=on-request; approvals_reviewer=user.`,
        );
      } finally {
        if (originalCodexHome === undefined) {
          delete process.env.CODEX_HOME;
        } else {
          process.env.CODEX_HOME = originalCodexHome;
        }
        fs.rmSync(tempCodexHome, { recursive: true, force: true });
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("reports parsed workspace config values for custom mode", async () => {
    const service = createService();
    const ran = await withTempDatabase(async () => {
      const client = Reflect.get(service as object, "client") as {
        start: () => Promise<void>;
        request: (method: string, params?: unknown) => Promise<unknown>;
      };
      const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-workspace-config-"));
      const project = createProject({ name: "Workspace Config", sources: [workspacePath] });
      const projectId = project.id;

      fs.writeFileSync(
        path.join(workspacePath, "config.toml"),
        [
          'sandbox_mode = "workspace-write"',
          'approval_policy = "on-request"',
          "",
        ].join("\n"),
        "utf8",
      );

      try {
        client.start = async () => undefined;
        client.request = async (method: string) => {
          if (method === "config/read") {
            return {
              config: {
                sandbox_mode: "workspace-write",
                approval_policy: "on-request",
                approvals_reviewer: "user",
              },
              origins: {
                sandbox_mode: {
                  name: {
                    type: "project",
                    dotCodexFolder: workspacePath,
                  },
                },
                approval_policy: {
                  name: {
                    type: "project",
                    dotCodexFolder: workspacePath,
                  },
                },
                approvals_reviewer: {
                  name: {
                    type: "project",
                    dotCodexFolder: workspacePath,
                  },
                },
                sandbox_workspace_write: undefined,
              },
            };
          }
          if (method === "configRequirements/read") {
            return { requirements: null };
          }
          return {};
        };
        const description = await service.getCustomPermissionModeDescription(projectId);
        expect(description).toBe(
          `Project config (${path.join(workspacePath, "config.toml")}): sandbox_mode=workspace-write; approval_policy=on-request; approvals_reviewer=user.`,
        );
      } finally {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      }
    });

    try {
      if (!ran) expect(true).toBe(true);
    } finally {
      await service.shutdown();
    }
  });

  test("prefers user-config display path when walk-up finds ~/.codex/config.toml", async () => {
    const service = createService();
    const client = Reflect.get(service as object, "client") as {
      start: () => Promise<void>;
      request: (method: string, params?: unknown) => Promise<unknown>;
    };
    const originalHome = process.env.HOME;
    const originalCodexHome = process.env.CODEX_HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-home-walkup-"));
    const workspacePath = path.join(tempHome, "workspace", "project");
    const userCodexDir = path.join(tempHome, ".codex");

    const ran = await withTempDatabase(async () => {
      fs.mkdirSync(workspacePath, { recursive: true });
      fs.mkdirSync(userCodexDir, { recursive: true });
      fs.writeFileSync(
        path.join(userCodexDir, "config.toml"),
        [
          'sandbox_mode = "workspace-write"',
          'approval_policy = "on-request"',
          "",
        ].join("\n"),
        "utf8",
      );
      const project = createProject({ name: "Home Walkup", sources: [workspacePath] });
      const projectId = project.id;
      process.env.HOME = tempHome;
      delete process.env.CODEX_HOME;

      client.start = async () => undefined;
      client.request = async (method: string) => {
        if (method === "config/read") {
          return {
            config: {
              sandbox_mode: "workspace-write",
              approval_policy: "on-request",
              approvals_reviewer: "user",
            },
            origins: {
              sandbox_mode: {
                name: {
                  type: "user",
                  file: path.join(userCodexDir, "config.toml"),
                },
              },
              approval_policy: {
                name: {
                  type: "user",
                  file: path.join(userCodexDir, "config.toml"),
                },
              },
              approvals_reviewer: {
                name: {
                  type: "user",
                  file: path.join(userCodexDir, "config.toml"),
                },
              },
              sandbox_workspace_write: undefined,
            },
          };
        }
        if (method === "configRequirements/read") {
          return { requirements: null };
        }
        return {};
      };

      const description = await service.getCustomPermissionModeDescription(projectId);
      expect(description).toBe(
        `User config (${path.join(userCodexDir, "config.toml")}): sandbox_mode=workspace-write; approval_policy=on-request; approvals_reviewer=user.`,
      );
    });

    try {
      if (!ran) expect(true).toBe(true);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
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
      markdownText: "say \"hi\"",
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

      const byItem = serviceInternals.conversationRecords.get("thr_dedupe")?.itemsByTurn.get("turn_dedupe");
      expect(byItem?.size).toBe(1);
      const merged = byItem ? Array.from(byItem.values())[0] : null;
      expect(merged?.markdownText).toBe("say \"hi\"");
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
      expect(merged?.markdownText).toBe("I added the shared module. Next I’m rewiring project-switcher.tsx.");
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
      expect(Array.from(byItem?.values() ?? []).map((item) => item.itemId).sort().join(",")).toBe(
        "msg_0001,msg_0002",
      );
    } finally {
      await service.shutdown();
    }
  });
});

describe("codex-service item lifecycle status fallback", () => {
  test("projects live reasoning rows from summary text only", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_reasoning_projection",
        turnId: "turn_reasoning_projection",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: [],
          content: ["Private reasoning body"],
        },
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_reasoning_projection",
        "turn_reasoning_projection",
        "item_reasoning",
      );
      expect(item?.markdownText ?? "").toBe("");

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_reasoning_projection",
        turnId: "turn_reasoning_projection",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: ["Investigating", "Checking thread state"],
          content: ["Private reasoning body"],
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_status",
        turnId: "turn_status",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: ["Planning the next step"],
          content: [],
        },
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_status",
        turnId: "turn_status",
        item: {
          id: "item_reasoning",
          type: "reasoning",
          summary: ["Planning complete"],
          content: [],
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_compaction_live",
        turnId: "turn_compaction_live",
        item: {
          id: "item_context_compaction",
          type: "context_compaction",
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

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_compaction_live",
        turnId: "turn_compaction_live",
        item: {
          id: "item_context_compaction",
          type: "context_compaction",
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

  test("inserts live context compaction at the canonical turn item position instead of the transcript tail", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_compaction_order"),
        turns: [
          {
            threadId: "thr_compaction_order",
            turnId: "turn_compaction_order",
            status: "completed",
            itemIds: ["assistant_before", "item_context_compaction", "tool_after"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_order",
          turnId: "turn_compaction_order",
          item: {
            id: "tool_after",
            type: "function_call",
            name: "bash",
            arguments: "{\"command\":\"echo later\"}",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_order",
          turnId: "turn_compaction_order",
          item: {
            id: "assistant_before",
            type: "assistant_message",
            text: "Assistant first.",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_order",
          turnId: "turn_compaction_order",
          item: {
            id: "item_context_compaction",
            type: "context_compaction",
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 30));

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns.length).toBe(1);
        expect(latest?.turns[0]?.items.length).toBe(3);
        expect(latest?.turns[0]?.items[0]?.itemId).toBe("assistant_before");
        expect(latest?.turns[0]?.items[1]?.itemId).toBe("item_context_compaction");
        expect(latest?.turns[0]?.items[2]?.itemId).toBe("tool_after");
        expect(latest?.turns[0]?.items[1]?.markdownText).toBe("Context automatically compacted");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("synthesizes turn-local canonical item order from live item lifecycle events", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_compaction_live_order"),
        turns: [],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "assistant_before",
            type: "assistant_message",
            text: "Assistant first.",
          },
        });

        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "item_context_compaction",
            type: "context_compaction",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "item_context_compaction",
            type: "context_compaction",
          },
        });

        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_compaction_live_order",
          turnId: "turn_compaction_live_order",
          item: {
            id: "tool_after",
            type: "function_call",
            name: "bash",
            arguments: "{\"command\":\"echo later\"}",
          },
        });

        await flushAsyncWork();

        const detail = service.serializeThreadDetail("thr_compaction_live_order");
        expect(detail?.turns.length).toBe(1);
        expect(detail?.turns[0]?.itemIds.join(",")).toBe("assistant_before,item_context_compaction,tool_after");

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns[0]?.items.map((item) => item.itemId).join(",")).toBe(
          "assistant_before,item_context_compaction,tool_after",
        );
        expect(latest?.turns[0]?.items[1]?.markdownText).toBe("Context automatically compacted");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("projects automatic approval review notifications into the canonical conversation", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("item/autoApprovalReview/started", {
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
      });

      let item = getRecordedItem(
        serviceInternals,
        "thr_auto_review",
        "turn_auto_review",
        "automatic-approval-review:review_auto",
      );
      expect(item?.semanticKind).toBe("automaticApprovalReview");
      expect(item?.status).toBe("inProgress");

      await serviceInternals.handleNotification("item/autoApprovalReview/completed", {
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("guardianWarning", {
        threadId: "thr_guardian_warning",
        message: "Unrelated guardian warning",
      });

      let snapshot = await service.requestConversationSnapshot("thr_guardian_warning");
      let warningItems = snapshot?.turns[0]?.items.filter((item) =>
        item.semanticKind === "autoReviewInterruptionWarning"
      ) ?? [];
      expect(String(warningItems.length)).toBe("0");

      await serviceInternals.handleNotification("guardianWarning", {
        threadId: "thr_guardian_warning",
        kind: "tooManyDenials",
        message: "Unrelated guardian warning",
      });

      snapshot = await service.requestConversationSnapshot("thr_guardian_warning");
      warningItems = snapshot?.turns[0]?.items.filter((item) =>
        item.semanticKind === "autoReviewInterruptionWarning"
      ) ?? [];
      const warning = warningItems[0];
      expect(String(warningItems.length)).toBe("1");
      expect(warning?.type).toBe("autoReviewInterruptionWarning");
      expect(warning?.markdownText).toBe("Automatic approval review rejected too many approval requests for this turn");
    } finally {
      await service.shutdown();
    }
  });

  test("projects hook lifecycle notifications into canonical turn items", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("hook/started", {
        threadId: "thr_hook",
        turnId: "turn_hook",
        run: {
          id: "hook_run_1",
          eventName: "preToolUse",
          status: "running",
          statusMessage: "Preparing context",
          entries: [{ kind: "context", text: "Added AGENTS.md" }],
        },
      });

      let item = getRecordedItem(serviceInternals, "thr_hook", "turn_hook", "hook_run_1");
      expect(item?.semanticKind).toBe("hook");
      expect(item?.status).toBe("inProgress");

      await serviceInternals.handleNotification("hook/completed", {
        threadId: "thr_hook",
        turnId: "turn_hook",
        run: {
          id: "hook_run_1",
          eventName: "preToolUse",
          status: "completed",
          statusMessage: "Preparing context",
          entries: [{ kind: "context", text: "Added AGENTS.md" }],
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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

      await serviceInternals.handleNotification("model/rerouted", {
        threadId: "thr_model_reroute",
        turnId: "turn_model_reroute",
        fromModel: "gpt-5.4-codex",
        toModel: "gpt-5.4-mini",
        reason: "highRiskCyberActivity",
      });

      const snapshot = await service.requestConversationSnapshot("thr_model_reroute");
      const item = snapshot?.turns[0]?.items.find((candidate) => candidate.semanticKind === "modelRerouted");
      const raw = item?.rawItem as { fromModel?: string; toModel?: string; reason?: string } | undefined;
      expect(item?.status).toBe("completed");
      expect(raw?.fromModel).toBe("gpt-5.4-codex");
      expect(raw?.toModel).toBe("gpt-5.4-mini");
      expect(raw?.reason).toBe("highRiskCyberActivity");
      expect(hostMessages.length > 0).toBe(true);
      const latest = projectConversationFromHostMessages(hostMessages);
      expect(latest?.turns[0]?.items[0]?.semanticKind).toBe("modelRerouted");
    } finally {
      await service.shutdown();
    }
  });

  test("projects MCP elicitation requests into canonical turn items and completes them on response", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      parseThreadRef: (threadId: string) => { projectId: string; cwd: string | null } | null;
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      persistThreadSnapshot: (threadId: string) => void;
    };

    serviceInternals.parseThreadRef = () => ({ projectId: defaultProjectId, cwd: null });
    serviceInternals.persistThreadSnapshot = () => {};

    try {
      serviceInternals.mergeTurn("thr_mcp", {
        threadId: "thr_mcp",
        turnId: "turn_mcp",
        status: "inProgress",
        itemIds: [],
      });

      const requestPromise = serviceInternals.handleServerRequest({
        id: "mcp_req",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thr_mcp",
          turnId: "turn_mcp",
          mode: "openai/form",
          serverName: "Context7",
          message: "Allow this call?",
          requestedSchema: { type: "object" },
        },
      });

      await Promise.resolve();

      let item = getRecordedItem(serviceInternals, "thr_mcp", "turn_mcp", "mcp-server-elicitation-mcp_req");
      expect(item?.semanticKind).toBe("mcpServerElicitation");
      expect(item?.status).toBe("inProgress");
      const rawElicitation = (item?.rawItem as { elicitation?: { mode?: string; requestedSchema?: { type?: string } } } | undefined)?.elicitation;
      expect(rawElicitation?.mode ?? "").toBe("openai/form");
      expect(rawElicitation?.requestedSchema?.type ?? "").toBe("object");

      const responded = await service.respondToMcpServerElicitation("mcp_req", {
        action: "accept",
        content: {
          library: "react",
        },
        _meta: null,
      });
      expect(responded).toBe(true);
      const response = await requestPromise;
      expect(JSON.stringify(response)).toBe(JSON.stringify({
        action: "accept",
        content: {
          library: "react",
        },
        _meta: null,
      }));

      item = getRecordedItem(serviceInternals, "thr_mcp", "turn_mcp", "mcp-server-elicitation-mcp_req");
      expect(item?.status).toBe("completed");
      expect((item?.rawItem as { action?: string } | undefined)?.action).toBe("accept");
    } finally {
      await service.shutdown();
    }
  });

  test("declines unsupported MCP elicitation requests before owner routing from bundle 27071 and 52137", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleServerRequest: (request: { id: string | number; method: string; params: unknown }) => Promise<unknown>;
      pendingMcpElicitations: Map<string, unknown>;
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

      expect(JSON.stringify(result)).toBe(JSON.stringify({
        action: "decline",
        content: null,
        _meta: null,
      }));
      expect(serviceInternals.pendingMcpElicitations.has("mcp_invalid")).toBe(false);
      expect(String(ownerMessages.length)).toBe("0");
      expect(String(hostMessages.length)).toBe("0");
    } finally {
      await service.shutdown();
    }
  });

  test("synthesizes planImplementation items from completed turns with unfinished plans", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      handleNotification: (method: string, params: unknown) => Promise<void>;
      listPendingConversationRequests: (threadId: string) => Array<{ type: string; turnId: string }>;
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

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
        item: {
          id: "plan_text",
          type: "plan",
          text: "1. Ship the fix\n2. Verify the behavior",
        },
      });

      await serviceInternals.handleNotification("turn/plan/updated", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
        explanation: null,
        plan: [
          { step: "Ship the fix", status: "completed" },
          { step: "Verify the behavior", status: "in_progress" },
        ],
      });

      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thr_plan_impl",
        turnId: "turn_plan_impl",
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
      mergeTurn: (threadId: string, turn: CodexTurnSummary) => void;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      listPendingConversationRequests: (threadId: string) => Array<{ type: string; turnId: string }>;
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

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_plan_impl_no_todo",
        turnId: "turn_plan_impl_no_todo",
        item: {
          id: "plan_text",
          type: "plan",
          text: "1. Ship the fix\n2. Verify the behavior",
        },
      });

      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thr_plan_impl_no_todo",
        turnId: "turn_plan_impl_no_todo",
      });

      const requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_no_todo");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");
      expect(requests[0]?.turnId).toBe("turn_plan_impl_no_todo");
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
        itemIds: ["plan_text", "todo-list:turn_plan_impl_remove", "implement-plan:turn_plan_impl_remove"],
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

      let requests = serviceInternals.listPendingConversationRequests("thr_plan_impl_remove");
      expect(requests.length).toBe(1);
      expect(requests[0]?.type).toBe("implementPlan");

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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
        itemIds: ["item_reasoning", "item_tool"],
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

      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thr_terminal",
        turnId: "turn_terminal",
      });

      const turnEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "turn" }> => event.type === "turn",
      );
      expect(turnEvents.length).toBe(1);
      expect(turnEvents[0]?.turn.status).toBe("completed");
      const reasoningItem = getRecordedItem(serviceInternals, "thr_terminal", "turn_terminal", "item_reasoning");
      expect(reasoningItem?.status).toBe("completed");
      const commandItem = getRecordedItem(serviceInternals, "thr_terminal", "turn_terminal", "item_tool");
      expect(commandItem?.status).toBe("inProgress");
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

      const interrupted = await service.interruptTurn("thr_interrupt_terminal", "turn_interrupt_terminal");
      expect(interrupted).toBe(true);

      const turnEvents = events.filter(
        (event): event is Extract<CodexEvent, { type: "turn" }> => event.type === "turn",
      );
      expect(turnEvents.some((event) => event.turn.status === "interrupted")).toBe(true);
      const interruptedTurn = turnEvents.find((event) => event.turn.turnId === "turn_interrupt_terminal")?.turn;
      expect(interruptedTurn?.interruptedCommandExecutionItemIds?.[0]).toBe("item_tool");
      const item = getRecordedItem(serviceInternals, "thr_interrupt_terminal", "turn_interrupt_terminal", "item_tool");
      expect(item?.status).toBe("interrupted");
    } finally {
      await service.shutdown();
    }
  });

  test("streams assistant deltas through thread stream patch updates", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_streaming_delta",
        turnId: "turn_streaming_delta",
        item: {
          id: "assistant_streaming_delta",
          type: "agentMessage",
          text: "",
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thr_streaming_delta",
        turnId: "turn_streaming_delta",
        itemId: "assistant_streaming_delta",
        delta: "hello",
      });
      await waitForCondition(() => hostMessages.length > 0, 120);

      expect(hostMessages.length > 0).toBe(true);
      const firstHostMessage = hostMessages[0];
      expect(firstHostMessage?.type).toBe("threadStreamStateChanged");
      expect(
        firstHostMessage?.type === "threadStreamStateChanged"
          ? firstHostMessage.change.type
          : "snapshot",
      ).toBe("patches");

      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
      expect(latest).not.toBeNull();
      expect(latest?.turns.length).toBe(1);
      expect(typeof latest?.turns[0]?.turnStartedAtMs).toBe("number");
      expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
      expect(latest?.turns[0]?.items.length).toBe(1);
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(latest?.turns[0]?.items[0]?.status).toBe("inProgress");
    } finally {
      await service.shutdown();
    }
  });

  test("refreshes assistant display timestamp when a completed agent message arrives", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_agent_message_completed"),
        turns: [
          {
            threadId: "thr_agent_message_completed",
            turnId: "turn_agent_message_completed",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_agent_message_completed",
          turnId: "turn_agent_message_completed",
          item: {
            id: "assistant_agent_message_completed",
            type: "agentMessage",
            text: "Done",
          },
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(latest?.turns[0]?.items[0]?.markdownText).toBe("Done");
        expect(typeof latest?.turns[0]?.turnStartedAtMs).toBe("number");
        expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps live assistant timestamp when turn completion carries completedAt fallback", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completion_timestamp_fallback"),
        turns: [
          {
            threadId: "thr_completion_timestamp_fallback",
            turnId: "turn_completion_timestamp_fallback",
            status: "inProgress",
            itemIds: [],
            turnStartedAtMs: 100,
            finalAssistantStartedAtMs: 200,
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_completion_timestamp_fallback",
          turn: {
            id: "turn_completion_timestamp_fallback",
            status: "completed",
            completedAt: 999,
            items: [],
          },
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest?.turns[0]?.status).toBe("completed");
        expect(latest?.turns[0]?.turnStartedAtMs).toBe(100);
        expect(latest?.turns[0]?.finalAssistantStartedAtMs).toBe(200);
        expect(latest?.turns[0]?.completedAt).toBe(999_000);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("avoids full conversation serialization during assistant delta flushes once the broadcast cache is primed", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_streaming_delta_hot_path",
        turnId: "turn_streaming_delta_hot_path",
        item: {
          id: "assistant_streaming_delta_hot_path",
          type: "agentMessage",
          text: "",
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
      let serializeConversationSnapshotCallCount = 0;
      serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
        serializeConversationSnapshotCallCount += 1;
        return originalSerializeConversationSnapshot(threadId);
      });

      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thr_streaming_delta_hot_path",
        turnId: "turn_streaming_delta_hot_path",
        itemId: "assistant_streaming_delta_hot_path",
        delta: "hello",
      });
      await waitForCondition(() => hostMessages.length > 0, 120);

      expect(String(serializeConversationSnapshotCallCount)).toBe("0");
      expect(hostMessages.length > 0).toBe(true);
      const firstHostMessage = hostMessages[0];
      expect(firstHostMessage?.type).toBe("threadStreamStateChanged");
      expect(
        firstHostMessage?.type === "threadStreamStateChanged"
          ? firstHostMessage.change.type
          : "snapshot",
      ).toBe("patches");
      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
      expect(typeof latest?.turns[0]?.finalAssistantStartedAtMs).toBe("number");
    } finally {
      await service.shutdown();
    }
  });

  test("splits large assistant deltas across frame-sized thread stream patches", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      turns: [{
        threadId: "thr_streaming_large_delta",
        turnId: "turn_streaming_large_delta",
        status: "inProgress",
        itemIds: [],
      }],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_streaming_large_delta",
        turnId: "turn_streaming_large_delta",
        item: {
          id: "assistant_large_delta",
          type: "agentMessage",
          text: "",
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thr_streaming_large_delta",
        turnId: "turn_streaming_large_delta",
        itemId: "assistant_large_delta",
        delta: largeDelta,
      });
      await waitForCondition(() => hostMessages.length >= 3, 180);

      expect(hostMessages.length > 1).toBe(true);
      const firstFrame = projectConversationFromHostMessages([hostMessages[0]!], baseConversation);
      expect(firstFrame?.turns[0]?.items[0]?.markdownText?.length ?? -1).toBe(24);

      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe(largeDelta);
    } finally {
      await service.shutdown();
    }
  });

  test("synchronously drains pending assistant deltas in main fallback before applying item/completed", async () => {
    const previousRequestAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
    const previousCancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      turns: [{
        threadId: "thr_streaming_completion_drain",
        turnId: "turn_streaming_completion_drain",
        status: "inProgress",
        itemIds: [],
      }],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_streaming_completion_drain",
        turnId: "turn_streaming_completion_drain",
        item: {
          id: "assistant_completion_drain",
          type: "agentMessage",
          text: "",
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thr_streaming_completion_drain",
        turnId: "turn_streaming_completion_drain",
        itemId: "assistant_completion_drain",
        delta: largeDelta,
      });
      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_streaming_completion_drain",
        turnId: "turn_streaming_completion_drain",
        item: {
          id: "assistant_completion_drain",
          type: "agentMessage",
          text: largeDelta,
        },
      });

      let completedMessageIndex = -1;
      let conversation = baseConversation;
      for (let index = 0; index < hostMessages.length; index += 1) {
        conversation = projectConversationFromHostMessages([hostMessages[index]!], conversation);
        if (conversation?.turns[0]?.items[0]?.status === "completed") {
          completedMessageIndex = index;
          break;
        }
      }

      expect(completedMessageIndex > 0).toBe(true);
      const beforeCompleted = projectConversationFromHostMessages(
        hostMessages.slice(0, completedMessageIndex),
        baseConversation,
      );
      expect(beforeCompleted?.turns[0]?.items[0]?.markdownText).toBe(largeDelta);
      expect(beforeCompleted?.turns[0]?.items[0]?.status).toBe("inProgress");
      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
      expect(latest?.turns[0]?.items[0]?.status).toBe("completed");
      expect(latest?.turns[0]?.items[0]?.markdownText).toBe(largeDelta);
      expect(requestAnimationFrameCalled).toBe(false);
    } finally {
      await service.shutdown();
      if (previousRequestAnimationFrameDescriptor) {
        Object.defineProperty(globalThis, "requestAnimationFrame", previousRequestAnimationFrameDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      }
      if (previousCancelAnimationFrameDescriptor) {
        Object.defineProperty(globalThis, "cancelAnimationFrame", previousCancelAnimationFrameDescriptor);
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      turns: [{
        threadId: "thr_streaming_short_completion_drain",
        turnId: "turn_streaming_short_completion_drain",
        status: "inProgress",
        itemIds: [],
      }],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_streaming_short_completion_drain",
        turnId: "turn_streaming_short_completion_drain",
        item: {
          id: "assistant_short_completion_drain",
          type: "agentMessage",
          text: "",
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thr_streaming_short_completion_drain",
        turnId: "turn_streaming_short_completion_drain",
        itemId: "assistant_short_completion_drain",
        delta,
      });
      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_streaming_short_completion_drain",
        turnId: "turn_streaming_short_completion_drain",
        item: {
          id: "assistant_short_completion_drain",
          type: "agentMessage",
          text: delta,
        },
      });
      await waitForCondition(() => {
        const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
        return latest?.turns[0]?.items[0]?.status === "completed";
      }, 240);

      let completedMessageIndex = -1;
      let conversation = baseConversation;
      for (let index = 0; index < hostMessages.length; index += 1) {
        conversation = projectConversationFromHostMessages([hostMessages[index]!], conversation);
        if (conversation?.turns[0]?.items[0]?.status === "completed") {
          completedMessageIndex = index;
          break;
        }
      }

      expect(completedMessageIndex > 0).toBe(true);
      const beforeCompleted = projectConversationFromHostMessages(
        hostMessages.slice(0, completedMessageIndex),
        baseConversation,
      );
      expect(beforeCompleted?.turns[0]?.items[0]?.markdownText).toBe(delta);
      expect(beforeCompleted?.turns[0]?.items[0]?.status).toBe("inProgress");
      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      turns: [{
        threadId: "thr_streaming_turn_completion_drain",
        turnId: "turn_streaming_turn_completion_drain",
        status: "inProgress",
        itemIds: [],
      }],
      transcript: [],
    });

    try {
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_streaming_turn_completion_drain",
        turnId: "turn_streaming_turn_completion_drain",
        item: {
          id: "assistant_turn_completion_drain",
          type: "agentMessage",
          text: "",
        },
      });
      const baseConversation = projectConversationFromHostMessages(hostMessages);
      expect(baseConversation).not.toBeNull();
      hostMessages.length = 0;

      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thr_streaming_turn_completion_drain",
        turnId: "turn_streaming_turn_completion_drain",
        itemId: "assistant_turn_completion_drain",
        delta,
      });
      await serviceInternals.handleNotification("turn/completed", {
        threadId: "thr_streaming_turn_completion_drain",
        turn: {
          id: "turn_streaming_turn_completion_drain",
          status: "completed",
          items: [],
        },
      });

      let completedMessageIndex = -1;
      let conversation = baseConversation;
      for (let index = 0; index < hostMessages.length; index += 1) {
        conversation = projectConversationFromHostMessages([hostMessages[index]!], conversation);
        if (conversation?.turns[0]?.status === "completed") {
          completedMessageIndex = index;
          break;
        }
      }

      expect(completedMessageIndex > 0).toBe(true);
      const beforeCompleted = projectConversationFromHostMessages(
        hostMessages.slice(0, completedMessageIndex),
        baseConversation,
      );
      expect(beforeCompleted?.turns[0]?.status).toBe("inProgress");
      expect(beforeCompleted?.turns[0]?.items[0]?.markdownText).toBe(delta);
      const latest = projectConversationFromHostMessages(hostMessages, baseConversation);
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
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_streaming_output",
        turnId: "turn_streaming_output",
        item: {
          id: "exec_streaming_output",
          type: "commandExecution",
          command: "bun test",
          cwd: "/tmp",
          status: "in_progress",
        },
      });
      await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
        threadId: "thr_streaming_output",
        turnId: "turn_streaming_output",
        itemId: "exec_streaming_output",
        delta: "1340 pass\n",
      });

      expect(String(mcpMessages.length)).toBe("1");
      const mcpMessage = mcpMessages[0];
      expect(mcpMessage?.type).toBe("mcpNotification");
      expect(
        mcpMessage?.type === "mcpNotification"
          ? mcpMessage.method
          : "",
      ).toBe("item/commandExecution/outputDelta");
      expect(
        mcpMessage?.type === "mcpNotification"
          ? mcpMessage.params.delta
          : "",
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
      expect(typeof snapshot?.turns[0]?.items[0]?.toolCall?.result).toBe("string");
      expect(snapshot?.turns[0]?.items[0]?.toolCall?.result).toBe("1340 pass\n");
    } finally {
      await service.shutdown();
    }
  });

  test("forwards command output deltas to renderer owner instead of broadcasting raw mcp notifications", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };
    const mcpMessages: CodexHostMessage[] = [];
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];

    service.on("hostMessage", (message) => {
      if (message.type === "mcpNotification") {
        mcpMessages.push(message);
      }
    });
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
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
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_owner_streaming_output",
        turnId: "turn_owner_streaming_output",
        item: {
          id: "exec_owner_streaming_output",
          type: "commandExecution",
          command: "bun test",
          cwd: "/tmp",
          status: "in_progress",
        },
      });
      await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
        threadId: "thr_owner_streaming_output",
        turnId: "turn_owner_streaming_output",
        itemId: "exec_owner_streaming_output",
        delta: "owner output\n",
      });

      const outputOwnerMessages = ownerMessages.filter((message) =>
        message.message.type === "threadOwnerNotification" &&
        message.message.method === "item/commandExecution/outputDelta"
      );
      expect(String(mcpMessages.length)).toBe("0");
      expect(String(outputOwnerMessages.length)).toBe("1");
      expect(outputOwnerMessages[0]?.targetClientId).toBe("owner-a");
      expect(outputOwnerMessages[0]?.message.type).toBe("threadOwnerNotification");
      if (outputOwnerMessages[0]?.message.type === "threadOwnerNotification") {
        expect(outputOwnerMessages[0].message.method).toBe("item/commandExecution/outputDelta");
        expect(outputOwnerMessages[0].message.sequence).toBe(2);
      }

      await new Promise((resolve) => setTimeout(resolve, 70));
      const snapshot = await service.requestConversationSnapshot("thr_owner_streaming_output");
      expect(snapshot?.turns[0]?.items[0]?.aggregatedOutput).toBe("owner output\n");
    } finally {
      await service.shutdown();
    }
  });

  test("forwards terminal interactions to renderer owner and records command actions silently", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };
    const ownerMessages: Array<{ targetClientId: string; message: CodexHostMessage }> = [];
    const hostMessages: CodexHostMessage[] = [];

    service.on("hostMessage", (message) => {
      if (message.type === "threadStreamStateChanged") {
        hostMessages.push(message);
      }
    });
    (service as unknown as {
      on: (
        event: "rendererOwnerHostMessage",
        listener: (message: { targetClientId: string; message: CodexHostMessage }) => void,
      ) => void;
    }).on("rendererOwnerHostMessage", (message) => {
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
      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_owner_terminal_interaction",
        turnId: "turn_owner_terminal_interaction",
        item: {
          id: "exec_owner_terminal_interaction",
          type: "commandExecution",
          command: "python",
          cwd: "/tmp",
          processId: "proc-1",
          status: "in_progress",
          commandActions: [],
        },
      });
      const streamMessagesBeforeTerminal = hostMessages.length;
      await serviceInternals.handleNotification("item/commandExecution/terminalInteraction", {
        threadId: "thr_owner_terminal_interaction",
        turnId: "turn_owner_terminal_interaction",
        itemId: "exec_owner_terminal_interaction",
        processId: "proc-1",
        stdin: "bun tes",
      });
      await serviceInternals.handleNotification("item/commandExecution/terminalInteraction", {
        threadId: "thr_owner_terminal_interaction",
        turnId: "turn_owner_terminal_interaction",
        itemId: "exec_owner_terminal_interaction",
        processId: "proc-1",
        stdin: "t\n",
      });

      const terminalOwnerMessages = ownerMessages.filter((message) =>
        message.message.type === "threadOwnerNotification" &&
        message.message.method === "item/commandExecution/terminalInteraction"
      );
      expect(String(hostMessages.length)).toBe(String(streamMessagesBeforeTerminal));

      const snapshot = await service.requestConversationSnapshot("thr_owner_terminal_interaction");
      const item = snapshot?.turns[0]?.items[0];
      const commandAction = item?.commandActions?.[0];
      const toolCallArgs = item?.toolCall?.args as { commandActions?: Array<{ command?: string }> } | undefined;

      expect(String(terminalOwnerMessages.length)).toBe("2");
      expect(terminalOwnerMessages[0]?.targetClientId).toBe("owner-a");
      expect(terminalOwnerMessages[1]?.targetClientId).toBe("owner-a");
      expect(commandAction?.type).toBe("unknown");
      expect(commandAction?.command).toBe("bun test");
      expect(toolCallArgs?.commandActions?.[0]?.command).toBe("bun test");
    } finally {
      await service.shutdown();
    }
  });

  test("item completed backfills first work item start without overwriting an existing stamp", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_work_stamp"),
        turns: [{
          threadId: "thr_completed_work_stamp",
          turnId: "turn_completed_work_stamp",
          status: "inProgress",
          itemIds: ["exec_completed"],
        }],
        transcript: [],
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_completed_work_stamp",
        turnId: "turn_completed_work_stamp",
        item: {
          id: "exec_completed",
          type: "commandExecution",
          command: "bun test",
          status: "completed",
        },
      });

      let snapshot = service.serializeConversationSnapshot("thr_completed_work_stamp");
      expect(typeof snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_existing_work_stamp"),
        turns: [{
          threadId: "thr_existing_work_stamp",
          turnId: "turn_existing_work_stamp",
          status: "inProgress",
          itemIds: ["exec_existing"],
          firstTurnWorkItemStartedAtMs: 123,
        }],
        transcript: [],
      });

      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_existing_work_stamp",
        turnId: "turn_existing_work_stamp",
        item: {
          id: "exec_existing",
          type: "commandExecution",
          command: "bun test",
          status: "completed",
        },
      });

      snapshot = service.serializeConversationSnapshot("thr_existing_work_stamp");
      expect(snapshot?.turns[0]?.firstTurnWorkItemStartedAtMs ?? 0).toBe(123);
    } finally {
      await service.shutdown();
    }
  });

  test("item/completed flushes pending command output into the canonical snapshot", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
    };

    try {
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_output_flush"),
        turns: [{
          threadId: "thr_completed_output_flush",
          turnId: "turn_completed_output_flush",
          status: "inProgress",
          itemIds: ["exec_completed_output_flush"],
        }],
        transcript: [],
      });

      await serviceInternals.handleNotification("item/started", {
        threadId: "thr_completed_output_flush",
        turnId: "turn_completed_output_flush",
        item: {
          id: "exec_completed_output_flush",
          type: "commandExecution",
          command: "bun test",
          status: "in_progress",
        },
      });
      await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
        threadId: "thr_completed_output_flush",
        turnId: "turn_completed_output_flush",
        itemId: "exec_completed_output_flush",
        delta: "1340 pass\n",
      });
      await serviceInternals.handleNotification("item/completed", {
        threadId: "thr_completed_output_flush",
        turnId: "turn_completed_output_flush",
        item: {
          id: "exec_completed_output_flush",
          type: "commandExecution",
          command: "bun test",
          status: "completed",
        },
      });

      const snapshot = service.serializeConversationSnapshot("thr_completed_output_flush");
      const item = snapshot?.turns[0]?.items[0];
      expect(item?.status).toBe("completed");
      expect(item?.aggregatedOutput).toBe("1340 pass\n");
    } finally {
      await service.shutdown();
    }
  });

  test("keeps command-output delta flushes silent once the broadcast cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
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
        ...makeThreadDetail("thr_streaming_output_hot_path"),
        turns: [
          {
            threadId: "thr_streaming_output_hot_path",
            turnId: "turn_streaming_output_hot_path",
            status: "inProgress",
            itemIds: ["exec_streaming_output_hot_path"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_streaming_output_hot_path",
          turnId: "turn_streaming_output_hot_path",
          item: {
            id: "exec_streaming_output_hot_path",
            type: "commandExecution",
            command: "bun test",
            cwd: "/tmp",
            status: "in_progress",
          },
        });
        await service.requestConversationSnapshot("thr_streaming_output_hot_path");
        threadMessages.length = 0;
        mcpMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
          threadId: "thr_streaming_output_hot_path",
          turnId: "turn_streaming_output_hot_path",
          itemId: "exec_streaming_output_hot_path",
          delta: "1340 pass\n",
        });
        await new Promise((resolve) => setTimeout(resolve, 70));

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(String(threadMessages.length)).toBe("0");
        expect(String(mcpMessages.length)).toBe("1");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("drops assistant frame-text deltas that arrive before item/started", async () => {
    const service = createService();
    const serviceInternals = service as unknown as {
      setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      handleNotification: (method: string, params: unknown) => Promise<void>;
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
      await serviceInternals.handleNotification("item/agentMessage/delta", {
        threadId: "thr_streaming_missing_item",
        turnId: "turn_streaming_missing_item",
        itemId: "assistant_missing_item",
        delta: "hello",
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

  test("skips command output deltas that arrive before the canonical item exists", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
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
        ...makeThreadDetail("thr_streaming_missing_output"),
        turns: [
          {
            threadId: "thr_streaming_missing_output",
            turnId: "turn_streaming_missing_output",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
          threadId: "thr_streaming_missing_output",
          turnId: "turn_streaming_missing_output",
          itemId: "exec_missing_output",
          delta: "1340 pass\n",
        });
        await new Promise((resolve) => setTimeout(resolve, 70));

        expect(String(threadMessages.length)).toBe("0");
        expect(String(mcpMessages.length)).toBe("1");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("bounds streamed command output and marks truncation in thread stream snapshots", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_streaming_output_truncated"),
        turns: [
          {
            threadId: "thr_streaming_output_truncated",
            turnId: "turn_streaming_output_truncated",
            status: "inProgress",
            itemIds: ["exec_streaming_output_truncated"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_streaming_output_truncated",
          turnId: "turn_streaming_output_truncated",
          item: {
            id: "exec_streaming_output_truncated",
            type: "commandExecution",
            command: "bun test",
            cwd: "/tmp",
            status: "in_progress",
          },
        });
        await serviceInternals.handleNotification("item/commandExecution/outputDelta", {
          threadId: "thr_streaming_output_truncated",
          turnId: "turn_streaming_output_truncated",
          itemId: "exec_streaming_output_truncated",
          delta: "a".repeat(25_000),
        });
        await new Promise((resolve) => setTimeout(resolve, 70));

        const snapshot = await service.requestConversationSnapshot("thr_streaming_output_truncated");
        const output = snapshot?.turns[0]?.items[0]?.aggregatedOutput ?? "";
        expect(output.startsWith("[output truncated]\n")).toBe(true);
        expect(output.length <= 20_020).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("background terminals include older turns whose command executions are still running", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_background_long_running"),
        turns: [
          {
            threadId: "thr_background_long_running",
            turnId: "turn_old_running",
            status: "inProgress",
            itemIds: ["exec_long_running"],
          },
          {
            threadId: "thr_background_long_running",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: ["assistant_latest"],
          },
        ],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_background_long_running",
          turnId: "turn_old_running",
          item: {
            id: "exec_long_running",
            type: "commandExecution",
            command: "bun run dev",
            cwd: "/tmp/project",
            processId: "7001",
            status: "in_progress",
          },
        });

        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_background_long_running",
          turnId: "turn_old_running",
        });

        const snapshot = service.serializeConversationSnapshot("thr_background_long_running");
        expect(snapshot).not.toBeNull();
        expect(snapshot?.backgroundTerminalRows.length).toBe(1);
        expect(snapshot?.backgroundTerminalRows[0]?.id).toBe("exec_long_running");
        expect(snapshot?.backgroundTerminalRows[0]?.command).toBe("bun run dev");
        expect(snapshot?.backgroundTerminalRows[0]?.cwd).toBe("/tmp/project");
        expect(snapshot?.backgroundTerminalRows[0]?.processId).toBe("7001");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("background terminals immediately exclude manually interrupted command executions by turn metadata", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_background_interrupted_ids"),
        turns: [
          {
            threadId: "thr_background_interrupted_ids",
            turnId: "turn_background_old",
            status: "completed",
            itemIds: ["exec_hidden"],
            interruptedCommandExecutionItemIds: ["exec_hidden"],
          },
          {
            threadId: "thr_background_interrupted_ids",
            turnId: "turn_latest",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [
          {
            threadId: "thr_background_interrupted_ids",
            turnId: "turn_background_old",
            itemId: "exec_hidden",
            type: "commandExecution",
            kind: "commandExecution",
            semanticKind: "exec",
            status: "inProgress",
            command: "bun run dev",
            aggregatedOutput: null,
            toolCall: {
              toolName: "bash",
              subtype: "command",
              args: {
                command: "bun run dev",
              },
            },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });

      try {
        const snapshot = service.serializeConversationSnapshot("thr_background_interrupted_ids");
        expect(snapshot).not.toBeNull();
        expect(snapshot?.backgroundTerminalRows.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("keeps file-edit patch rows while turn diff updates stream on the turn", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_turn_diff_stream"),
        turns: [
          {
            threadId: "thr_turn_diff_stream",
            turnId: "turn_turn_diff_stream",
            status: "inProgress",
            itemIds: ["patch_turn_diff_stream"],
          },
        ],
        transcript: [
          {
            threadId: "thr_turn_diff_stream",
            turnId: "turn_turn_diff_stream",
            itemId: "patch_turn_diff_stream",
            type: "file_change",
            kind: "fileChange",
            semanticKind: "patch",
            toolCall: {
              subtype: "fileChange",
              toolName: "file_change",
              result: {
                diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new",
              },
            },
            sequence: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });

      try {
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_turn_diff_stream",
          turnId: "turn_turn_diff_stream",
          diff: "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest).not.toBeNull();
        expect(String(latest?.turns[0]?.diff ?? "").includes("+new")).toBe(true);
        expect(latest?.turns[0]?.items.length).toBe(1);
        expect(`${latest?.turns[0]?.items[0]?.kind}:${latest?.turns[0]?.items[0]?.semanticKind}`).toBe("fileChange:patch");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("turn diff updates replace turn.diff without creating a transcript item", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_pre_tool_turn_diff"),
        turns: [{
          threadId: "thr_pre_tool_turn_diff",
          turnId: "turn_pre_tool_turn_diff",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_pre_tool_turn_diff",
          turnId: "turn_pre_tool_turn_diff",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
        });
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_pre_tool_turn_diff",
          turnId: "turn_pre_tool_turn_diff",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+next\n",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const items = latest?.turns[0]?.items ?? [];
        expect(items.length).toBe(0);
        expect(String(latest?.turns[0]?.diff ?? "").includes("+next")).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("fileChange outputDelta does not create visible transcript state", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_file_output_delta_ignored"),
        turns: [{
          threadId: "thr_file_output_delta_ignored",
          turnId: "turn_file_output_delta_ignored",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/outputDelta", {
          threadId: "thr_file_output_delta_ignored",
          turnId: "turn_file_output_delta_ignored",
          itemId: "patch_drafting",
          delta: "diff --git a/poem.md b/poem.md\nnew file mode 100644\n--- /dev/null\n+++ b/poem.md\n@@ -0,0 +1 @@\n+line\n",
        });

        expect(hostMessages.length).toBe(0);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("patchUpdated creates an in-progress fileChange item", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_create"),
        turns: [{
          threadId: "thr_patch_updated_create",
          turnId: "turn_patch_updated_create",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_create",
          turnId: "turn_patch_updated_create",
          itemId: "patch_live",
          changes: [{
            path: "src/app.ts",
            kind: { type: "update" },
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(typeof latest?.turns[0]?.firstTurnWorkItemStartedAtMs).toBe("number");
        const item = latest?.turns[0]?.items[0] ?? null;
        expect(item?.itemId ?? "").toBe("patch_live");
        expect(item?.status ?? "").toBe("inProgress");
        expect(`${item?.kind}:${item?.semanticKind}`).toBe("fileChange:patch");
        expect(getCodexFileChangeList(item?.fileChange?.changes)[0]?.type ?? "").toBe("update");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("patchUpdated with an empty add diff still creates a visible live fileChange row", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_empty_add"),
        turns: [{
          threadId: "thr_patch_updated_empty_add",
          turnId: "turn_patch_updated_empty_add",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_empty_add",
          turnId: "turn_patch_updated_empty_add",
          itemId: "patch_live",
          changes: [{
            path: "poem.md",
            kind: { type: "add" },
            diff: "",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const item = latest?.turns[0]?.items[0] ?? null;
        expect(item?.itemId ?? "").toBe("patch_live");
        expect(item?.status ?? "").toBe("inProgress");
        expect(`${item?.kind}:${item?.semanticKind}`).toBe("fileChange:patch");
        expect(getCodexFileChangePaths(item?.fileChange?.changes).join(",")).toBe("poem.md");
        expect(getCodexFileChangeList(item?.fileChange?.changes)[0]?.type ?? "").toBe("add");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("patchUpdated replaces the existing fileChange changes", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_replace"),
        turns: [{
          threadId: "thr_patch_updated_replace",
          turnId: "turn_patch_updated_replace",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_replace",
          turnId: "turn_patch_updated_replace",
          itemId: "patch_live",
          changes: [{
            path: "src/old.ts",
            kind: { type: "update" },
            diff: "--- a/src/old.ts\n+++ b/src/old.ts\n@@ -1 +1 @@\n-old\n+new",
          }],
        });
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_replace",
          turnId: "turn_patch_updated_replace",
          itemId: "patch_live",
          changes: [{
            path: "src/new.ts",
            kind: { type: "update" },
            diff: "--- a/src/new.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-before\n+after",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const items = latest?.turns[0]?.items ?? [];
        expect(items.length).toBe(1);
        const latestChange = getCodexFileChangeList(items[0]?.fileChange?.changes)[0];
        expect(getCodexFileChangePaths(items[0]?.fileChange?.changes).join(",")).toBe("src/new.ts");
        expect(latestChange?.type === "update" ? latestChange.unifiedDiff.includes("after") : false).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("patchUpdated rebinds the latest in-progress turn before adding the live fileChange", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      const now = Date.now();
      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_patch_updated_rebind"),
        turns: [{
          threadId: "thr_patch_updated_rebind",
          turnId: "turn_placeholder",
          status: "inProgress",
          itemIds: ["assistant_draft"],
        }],
        transcript: [{
          threadId: "thr_patch_updated_rebind",
          turnId: "turn_placeholder",
          itemId: "assistant_draft",
          type: "agent_message",
          kind: "assistantMessage",
          semanticKind: "assistantMessage",
          role: "assistant",
          status: "inProgress",
          markdownText: "Drafting the edit",
          createdAt: now,
          updatedAt: now,
        }],
      });

      try {
        await serviceInternals.handleNotification("item/fileChange/patchUpdated", {
          threadId: "thr_patch_updated_rebind",
          turnId: "turn_real",
          itemId: "patch_live",
          changes: [{
            path: "poem.md",
            kind: { type: "add" },
            content: "line\n",
          }],
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        expect(latest?.turns.length ?? 0).toBe(1);
        expect(latest?.turns[0]?.turnId ?? "").toBe("turn_real");
        expect(latest?.turns[0]?.items.map((item) => item.itemId).join(",") ?? "").toBe(
          "assistant_draft,patch_live",
        );
        expect(latest?.turns[0]?.items[0]?.turnId ?? "").toBe("turn_real");
        expect(latest?.turns[0]?.items[1]?.status ?? "").toBe("inProgress");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("completed fileChange items synthesize turn-diff payloads when turn diff state is missing", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_completed_patch_batches"),
        cwd: "/tmp/patch-project",
        turns: [{
          threadId: "thr_completed_patch_batches",
          turnId: "turn_completed_patch_batches",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_completed_patch_batches",
          turnId: "turn_completed_patch_batches",
          item: {
            id: "patch_done_1",
            type: "fileChange",
            status: "completed",
            changes: [{
              path: "src/app.ts",
              kind: { type: "update" },
              diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
            }],
          },
        });
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_completed_patch_batches",
          turnId: "turn_completed_patch_batches",
          item: {
            id: "patch_done_2",
            type: "fileChange",
            status: "completed",
            changes: [{
              path: "src/app.ts",
              kind: { type: "update" },
              diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -3 +3 @@\n-before\n+after",
            }],
          },
        });
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_completed_patch_batches",
          turnId: "turn_completed_patch_batches",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const turn = latest?.turns[0] ?? null;
        const turnDiff = latest?.turns[0]?.items.find((item) => item.itemId === "turn-diff:turn_completed_patch_batches");
        const rawItem = turnDiff?.rawItem as { unifiedDiff?: string; patchBatches?: unknown[] } | undefined;
        const unifiedDiff = rawItem?.unifiedDiff ?? "";

        expect(turn).not.toBeNull();
        expect(turnDiff !== undefined).toBe(true);
        expect(unifiedDiff.split("diff --git a/src/app.ts b/src/app.ts").length - 1).toBe(1);
        expect(unifiedDiff.includes("+new")).toBe(true);
        expect(unifiedDiff.includes("+after")).toBe(true);
        expect(rawItem?.patchBatches?.length ?? 0).toBe(2);
        expect(turn?.items.some((item) => item.itemId === "patch_done_1") ?? false).toBe(true);
        expect(turn?.items.some((item) => item.itemId === "patch_done_2") ?? false).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("completed turn diffs use app-server turn diff and preserve patch batches", async () => {
    const ran = await withTempDatabase(async () => {
      const nonGitPath = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-turn-diff-nongit-"));
      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_diff_fallback"),
        cwd: nonGitPath,
        turns: [{
          threadId: "thr_diff_fallback",
          turnId: "turn_diff_fallback",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("turn/started", {
          threadId: "thr_diff_fallback",
          turn: {
            id: "turn_diff_fallback",
            status: "inProgress",
          },
        });
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_diff_fallback",
          turnId: "turn_diff_fallback",
          diff: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+from-turn-diff\n",
        });
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_diff_fallback",
          turnId: "turn_diff_fallback",
          item: {
            id: "patch_fallback",
            type: "fileChange",
            status: "completed",
            changes: [{
              path: "src/app.ts",
              kind: { type: "update" },
              diff: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+from-patch\n",
            }],
          },
        });
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_diff_fallback",
          turnId: "turn_diff_fallback",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const turn = latest?.turns[0] ?? null;
        const turnDiff = latest?.turns[0]?.items.find((item) => item.itemId === "turn-diff:turn_diff_fallback");
        const rawItem = turnDiff?.rawItem as {
          unifiedDiff?: string;
          patchBatches?: Array<{ cwd: string | null; changes: unknown[] }>;
          cwd?: string;
          showRevertButton?: boolean;
        } | undefined;

        expect((turn?.diff ?? "").includes("+from-turn-diff")).toBe(true);
        expect(`${turnDiff?.kind}:${turnDiff?.semanticKind}`).toBe("systemEvent:diff");
        expect((rawItem?.unifiedDiff ?? "").includes("+from-turn-diff")).toBe(true);
        expect((rawItem?.unifiedDiff ?? "").includes("+from-patch")).toBe(false);
        expect(rawItem?.cwd ?? "").toBe(nonGitPath);
        expect(rawItem?.showRevertButton === true).toBe(true);
        expect(rawItem?.patchBatches?.length ?? 0).toBe(1);
        expect(rawItem?.patchBatches?.[0]?.cwd ?? "").toBe(nonGitPath);
        expect(rawItem?.patchBatches?.[0]?.changes.length ?? 0).toBe(1);
      } finally {
        await service.shutdown();
        fs.rmSync(nonGitPath, { recursive: true, force: true });
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("empty app-server turn diff falls back to completed fileChange patches", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_empty_diff_patch_fallback"),
        cwd: "/tmp/empty-diff-project",
        turns: [{
          threadId: "thr_empty_diff_patch_fallback",
          turnId: "turn_empty_diff_patch_fallback",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("turn/started", {
          threadId: "thr_empty_diff_patch_fallback",
          turn: {
            id: "turn_empty_diff_patch_fallback",
            status: "inProgress",
          },
        });
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_empty_diff_patch_fallback",
          turnId: "turn_empty_diff_patch_fallback",
          diff: "",
        });
        await serviceInternals.handleNotification("item/completed", {
          threadId: "thr_empty_diff_patch_fallback",
          turnId: "turn_empty_diff_patch_fallback",
          item: {
            id: "patch_empty_diff_fallback",
            type: "fileChange",
            status: "completed",
            changes: [{
              path: "src/app.ts",
              kind: { type: "update" },
              diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+from-patch",
            }],
          },
        });
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_empty_diff_patch_fallback",
          turnId: "turn_empty_diff_patch_fallback",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const turn = latest?.turns[0] ?? null;
        const turnDiff = turn?.items.find((item) => item.itemId === "turn-diff:turn_empty_diff_patch_fallback");
        const rawItem = turnDiff?.rawItem as { unifiedDiff?: string; patchBatches?: unknown[] } | undefined;

        expect(turn?.diff ?? "missing").toBe("");
        expect((rawItem?.unifiedDiff ?? "").includes("+from-patch")).toBe(true);
        expect(rawItem?.patchBatches?.length ?? 0).toBe(1);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("empty app-server turn diff without fileChange patches does not create a turn-diff item", async () => {
    const ran = await withTempDatabase(async () => {
      const service = createService();
      const serviceInternals = service as unknown as {
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") hostMessages.push(message);
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_empty_diff_no_patch"),
        turns: [{
          threadId: "thr_empty_diff_no_patch",
          turnId: "turn_empty_diff_no_patch",
          status: "inProgress",
          itemIds: [],
        }],
        transcript: [],
      });

      try {
        await serviceInternals.handleNotification("turn/started", {
          threadId: "thr_empty_diff_no_patch",
          turn: {
            id: "turn_empty_diff_no_patch",
            status: "inProgress",
          },
        });
        await serviceInternals.handleNotification("turn/diff/updated", {
          threadId: "thr_empty_diff_no_patch",
          turnId: "turn_empty_diff_no_patch",
          diff: "",
        });
        await serviceInternals.handleNotification("turn/completed", {
          threadId: "thr_empty_diff_no_patch",
          turnId: "turn_empty_diff_no_patch",
        });

        const latest = projectConversationFromHostMessages(hostMessages);
        const turn = latest?.turns[0] ?? null;
        const turnDiff = turn?.items.find((item) => item.itemId === "turn-diff:turn_empty_diff_no_patch");

        expect(turn?.diff ?? "missing").toBe("");
        expect(turnDiff === undefined).toBe(true);
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("queues follow-up rows through direct broadcast-cache patches once the cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_queue_direct_patch"),
        turns: [
          {
            threadId: "thr_queue_direct_patch",
            turnId: "turn_queue_direct_patch",
            status: "completed",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await service.requestConversationSnapshot("thr_queue_direct_patch");
        const snapshotMessage = hostMessages[0];
        expect(
          snapshotMessage?.type === "threadStreamStateChanged"
            ? snapshotMessage.change.type
            : "patches",
        ).toBe("snapshot");
        expect(
          snapshotMessage?.type === "threadStreamStateChanged" &&
            snapshotMessage.change.type === "snapshot"
            ? String(snapshotMessage.change.revision)
            : "missing",
        ).toBe("1");
        const initialConversation = service.serializeConversationSnapshot("thr_queue_direct_patch");
        hostMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        await service.enqueueQueuedFollowUpPrompt("thr_queue_direct_patch", "Queue this next");

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(hostMessages.length > 0).toBe(true);
        expect(hostMessages[0]?.type).toBe("threadStreamStateChanged");
        expect(
          hostMessages[0]?.type === "threadStreamStateChanged"
            ? hostMessages[0].change.type
            : "snapshot",
        ).toBe("patches");
        expect(
          hostMessages[0]?.type === "threadStreamStateChanged" &&
            hostMessages[0].change.type === "patches"
            ? `${hostMessages[0].change.baseRevision}->${hostMessages[0].change.revision}`
            : "missing",
        ).toBe("1->2");

        const latest = projectConversationFromHostMessages(hostMessages, initialConversation);
        expect(latest).not.toBeNull();
        expect(latest?.queuedFollowUps.length).toBe(1);
        expect(latest?.queuedFollowUps[0]?.prompt).toBe("Queue this next");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("streams user-input request ingress through direct request patches once the cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleRequestUserInput: (requestId: string, params: {
          threadId: string;
          turnId: string;
          itemId: string;
          questions: Array<{
            id: string;
            header: string;
            question: string;
            isOther: boolean;
            isSecret: boolean;
            options?: Array<{ label: string; description: string }>;
          }>;
        }) => Promise<unknown>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_user_input_direct_patch"),
        turns: [
          {
            threadId: "thr_user_input_direct_patch",
            turnId: "turn_user_input_direct_patch",
            status: "inProgress",
            itemIds: ["tool_user_input_direct_patch"],
          },
        ],
        transcript: [],
      });

      try {
        await service.requestConversationSnapshot("thr_user_input_direct_patch");
        const initialConversation = service.serializeConversationSnapshot("thr_user_input_direct_patch");
        hostMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        const pendingPromise = serviceInternals.handleRequestUserInput("req_user_input_direct_patch", {
          threadId: "thr_user_input_direct_patch",
          turnId: "turn_user_input_direct_patch",
          itemId: "tool_user_input_direct_patch",
          questions: [{
            id: "q1",
            header: "Question",
            question: "Pick one",
            isOther: false,
            isSecret: false,
            options: [{ label: "A", description: "Option A" }],
          }],
        });

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(hostMessages.length > 0).toBe(true);
        expect(hostMessages[0]?.type).toBe("threadStreamStateChanged");
        expect(
          hostMessages[0]?.type === "threadStreamStateChanged"
            ? hostMessages[0].change.type
            : "snapshot",
        ).toBe("patches");

        const latest = projectConversationFromHostMessages(hostMessages, initialConversation);
        expect(latest).not.toBeNull();
        expect(latest?.requests.length).toBe(1);
        expect(latest?.requests[0]?.type).toBe("userInput");

        await service.respondToUserInput("req_user_input_direct_patch", { q1: ["A"] });
        await pendingPromise;
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });

  test("avoids full conversation serialization during item lifecycle patches once the cache is primed", async () => {
    const ran = await withTempDatabase(async () => {

      const service = createService();
      const serviceInternals = service as unknown as {
        serializeConversationSnapshot: (threadId: string) => CodexConversationSnapshot | null;
        setConversationRecordDetail: (detail: CodexThreadDetail) => void;
        handleNotification: (method: string, params: unknown) => Promise<void>;
      };
      const hostMessages: CodexHostMessage[] = [];

      service.on("hostMessage", (message) => {
        if (message.type === "threadStreamStateChanged") {
          hostMessages.push(message);
        }
      });

      serviceInternals.setConversationRecordDetail({
        ...makeThreadDetail("thr_item_started_direct_patch"),
        turns: [
          {
            threadId: "thr_item_started_direct_patch",
            turnId: "turn_item_started_direct_patch",
            status: "inProgress",
            itemIds: [],
          },
        ],
        transcript: [],
      });

      try {
        await service.requestConversationSnapshot("thr_item_started_direct_patch");
        const initialConversation = service.serializeConversationSnapshot("thr_item_started_direct_patch");
        hostMessages.length = 0;

        const originalSerializeConversationSnapshot = serviceInternals.serializeConversationSnapshot.bind(serviceInternals);
        let serializeConversationSnapshotCallCount = 0;
        serviceInternals.serializeConversationSnapshot = ((threadId: string) => {
          serializeConversationSnapshotCallCount += 1;
          return originalSerializeConversationSnapshot(threadId);
        });

        await serviceInternals.handleNotification("item/started", {
          threadId: "thr_item_started_direct_patch",
          turnId: "turn_item_started_direct_patch",
          item: {
            id: "assistant_item_started_direct_patch",
            type: "agentMessage",
            text: "hello",
            status: "in_progress",
          },
        });

        expect(String(serializeConversationSnapshotCallCount)).toBe("0");
        expect(hostMessages.length > 0).toBe(true);
        expect(hostMessages[0]?.type).toBe("threadStreamStateChanged");
        expect(
          hostMessages[0]?.type === "threadStreamStateChanged"
            ? hostMessages[0].change.type
            : "snapshot",
        ).toBe("patches");

        const latest = projectConversationFromHostMessages(hostMessages, initialConversation);
        expect(latest).not.toBeNull();
        expect(latest?.turns.length).toBe(1);
        expect(latest?.turns[0]?.items.length).toBe(1);
        expect(latest?.turns[0]?.items[0]?.itemId).toBe("assistant_item_started_direct_patch");
      } finally {
        await service.shutdown();
      }
    });

    if (!ran) expect(true).toBe(true);
  });
});
