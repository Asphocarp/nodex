import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act } from "@testing-library/react";
import type {
  CodexConnectionState,
  CodexConversationStateUpdate,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexHostMessage,
  CodexThreadStreamStateChange,
  CodexThreadSummary,
} from "../../lib/types";
import type { ThreadRollbackResponse, TurnStartResponse } from "@nodex/codex-app-server-protocol/v2";
import type { CodexAppServerManager as CodexAppServerManagerInstance } from "./local-conversation-store";
import {
  buildCodexConversationStateUpdates,
} from "../../../shared/codex-conversation-patches";
import { render, settleAsyncRender, textContent } from "../../test/dom";

let invokeCalls: string[] = [];
let invokeRecords: Array<{ channel: string; args: unknown[] }> = [];
let hostMessageListener: ((message: CodexHostMessage) => void) | null = null;
let rendererClientRequestListener: ((message: unknown) => void) | null = null;
let threadListByProject: Record<string, CodexThreadSummary[]> = {};
let snapshotByThread: Record<string, CodexConversationSnapshot | null> = {};
let startThreadForSessionResult: unknown = null;
let resumeThreadResult: CodexConversationSnapshot | null = null;
let resumeThreadError: Error | null = null;
let olderThreadTurnsResult: Promise<CodexConversationSnapshot | null> | CodexConversationSnapshot | null = null;
let completeThreadTurnsResult: CodexConversationSnapshot | null = null;
let ownerEditRollbackResult: ThreadRollbackResponse | null = null;
let ownerTurnStartResult: TurnStartResponse | null = null;
let followerActionResult: unknown = null;
let followerActionError: Error | null = null;
let followerActionHandler: ((input: unknown) => unknown | Promise<unknown>) | null = null;
let ownerStreamPublishHandler: ((input: unknown) => boolean | Promise<boolean>) | null = null;
const generatedThreadTitleResult: unknown = { title: null };
const generatedThreadTitleError: Error | null = null;

interface NotificationTestManager {
  addTurnCompletedListener: (listener: (payload: {
    conversationId: string;
    turnId: string;
    lastAgentMessage: string | null;
  }) => void) => () => void;
  addApprovalRequestListener: (listener: (payload: {
    conversationId: string;
    requestId: string;
    kind: "command" | "file";
    reason: string | null;
  }) => void) => () => void;
  addUserInputRequestListener: (listener: (payload: {
    conversationId: string;
    requestId: string;
    turnId: string;
    questionCount: number;
    firstQuestion: string | null;
  }) => void) => () => void;
  interruptTurn: (threadId: string, turnId?: string) => Promise<boolean>;
}

function requireNotificationTestManager(value: NotificationTestManager | null): NotificationTestManager {
  if (!value) {
    throw new Error("Expected manager");
  }
  return value;
}

mock.module("./local-conversation-deps", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push(channel);
    invokeRecords.push({ channel, args });
    const threadId = typeof args[0] === "string" ? args[0] : undefined;
    if (channel === "codex:account:read") {
      return {
        account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
        requiresOpenAiAuth: false,
        pendingLogin: null,
        rateLimits: null,
      };
    }

    if (channel === "codex:connection:status") {
      return {
        status: "connected",
        retries: 0,
      } satisfies CodexConnectionState;
    }

    if (channel === "codex:thread:snapshot:request" && typeof threadId === "string") {
      if (Object.prototype.hasOwnProperty.call(snapshotByThread, threadId)) {
        return snapshotByThread[threadId];
      }
      if (threadId === "thread-child") {
        return buildConversation("thread-child", "project-1");
      }
      return null;
    }

    if (channel === "codex:thread:resume:request") {
      if (resumeThreadError) {
        throw resumeThreadError;
      }
      return resumeThreadResult;
    }

    if (channel === "codex:model:list") {
      return [
        {
          id: "gpt-5.3-codex",
          displayName: "GPT-5.3 Codex",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Balanced" },
            { reasoningEffort: "high", description: "Deep" },
          ],
        },
      ];
    }

    if (channel === "codex:permission:state:get") {
      return {
        mode: "custom",
        effectivePreset: "custom",
        availableModes: ["auto", "guardian-approvals", "full-access", "custom"],
        approvalPolicy: null,
        approvalsReviewer: "user",
        sandboxMode: null,
        sandbox: null,
        guardianApprovalEnabled: false,
        configTarget: { source: "none" },
      };
    }

    if (channel === "codex:threads:list" && typeof threadId === "string") {
      return threadListByProject[threadId] ?? [];
    }

    if (channel === "codex:thread:start-for-session") {
      return startThreadForSessionResult;
    }

    if (channel === "codex:thread:turns:load-older") {
      return olderThreadTurnsResult;
    }

    if (channel === "codex:thread:turns:load-complete") {
      return completeThreadTurnsResult;
    }

    if (channel === "codex:thread-owner:app-server-request") {
      const input = args[0] as {
        request?: {
          method?: string;
          params?: {
            expectedTurnId?: string;
          };
        };
      };
      if (input.request?.method === "thread/rollback") {
        return ownerEditRollbackResult;
      }
      if (input.request?.method === "turn/start") {
        if (ownerTurnStartResult) {
          return ownerTurnStartResult;
        }
        const turnId = "turn-owner-start";
        return {
          turn: {
            id: turnId,
            items: [],
            itemsView: "full",
            status: "inProgress",
            error: null,
            startedAt: 1,
            completedAt: null,
            durationMs: null,
          },
        } satisfies TurnStartResponse;
      }
      if (input.request?.method === "turn/steer") {
        return { turnId: input.request.params?.expectedTurnId ?? "turn-steered" };
      }
      if (input.request?.method === "turn/interrupt") {
        return true;
      }
      if (input.request?.method === "thread/settings/update") {
        return {
          model: "gpt-5.3-codex",
          reasoningEffort: "high",
          collaborationMode: {
            mode: "plan",
            settings: {
              model: "gpt-5.3-codex",
              reasoning_effort: "high",
              developer_instructions: null,
            },
          },
        };
      }
      if (input.request?.method === "thread/goal/set") {
        return {
          id: "goal-1",
          objective: "Ship it",
          status: "in_progress",
          tokenBudget: null,
        };
      }
      if (input.request?.method === "thread/fork") {
        const params = input.request.params as { message?: string } | undefined;
        return {
          threadId: "thread-forked",
          composerIntent: {
            prompt: params?.message ?? "",
            focusNonce: 1,
          },
        };
      }
      return null;
    }

    if (channel === "codex:turn:start") {
      return null;
    }

    if (channel === "codex:thread-owner:stream-state:publish") {
      if (ownerStreamPublishHandler) {
        return await ownerStreamPublishHandler(args[0]);
      }
      return true;
    }

    if (channel === "codex:thread:resume-buffer:release") {
      return true;
    }

    if (channel === "codex:thread-owner:notification:ack") {
      return true;
    }

    if (channel === "codex:dynamic-tool-call:respond") {
      return { success: false, contentItems: [] };
    }

    if (channel === "codex:thread-follower:action") {
      if (followerActionError) {
        throw followerActionError;
      }
      if (followerActionHandler) {
        return await followerActionHandler(args[0]);
      }
      return followerActionResult;
    }

    if (channel === "codex:renderer-client:response") {
      return true;
    }

    if (channel === "codex:thread:title:generate") {
      if (generatedThreadTitleError) {
        throw generatedThreadTitleError;
      }
      return generatedThreadTitleResult;
    }

    if (channel === "codex:thread:name:set-generated" || channel === "codex:thread:name:set") {
      return true;
    }

    if (channel === "codex:thread:plan-implementation:remove") {
      return true;
    }

    if (channel === "codex:turn:interrupt") {
      return true;
    }

    if (channel === "codex:thread:background-terminals:clean-silent") {
      return true;
    }

    if (
      channel === "codex:approval:respond" ||
      channel === "codex:user-input:respond" ||
      channel === "codex:mcp-elicitation:respond" ||
      channel === "codex:permission-request:respond"
    ) {
      return true;
    }

    return null;
  },
  subscribeCodexHostMessages: (listener: (message: CodexHostMessage) => void) => {
    hostMessageListener = listener;
    return () => {
      if (hostMessageListener === listener) {
        hostMessageListener = null;
      }
    };
  },
  subscribeCodexRendererClientRequests: (listener: (message: unknown) => void) => {
    rendererClientRequestListener = listener;
    return () => {
      if (rendererClientRequestListener === listener) {
        rendererClientRequestListener = null;
      }
    };
  },
}));

function buildThreadSummary(threadId: string, projectId: string): CodexThreadSummary {
  return {
    threadId,
    projectId,
    source: null,
    threadName: threadId,
    threadPreview: threadId,
    modelProvider: "openai",
    cwd: `/tmp/${projectId}`,
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    linkedAt: "2026-03-30T00:00:00.000Z",
  };
}

function buildConversation(threadId: string, projectId: string): CodexConversationSnapshot {
  return {
    ...buildThreadSummary(threadId, projectId),
    resumeState: "resumed",
    turns: [],
    requests: [],
    pendingSteers: [],
    queuedFollowUps: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: true,
      canForkFromTurn: true,
      canSearch: true,
      canCollapseTurns: true,
    },
  };
}

function buildRollbackResponseFromConversation(conversation: CodexConversationSnapshot): ThreadRollbackResponse {
  return {
    thread: {
      id: conversation.threadId,
      sessionId: `session-${conversation.threadId}`,
      forkedFromId: null,
      parentThreadId: conversation.source?.parentThreadId ?? null,
      preview: conversation.threadPreview,
      ephemeral: conversation.ephemeral ?? false,
      modelProvider: conversation.modelProvider,
      createdAt: conversation.createdAt / 1000,
      updatedAt: conversation.updatedAt / 1000,
      recencyAt: conversation.updatedAt / 1000,
      status: conversation.statusType === "active"
        ? { type: "active", activeFlags: conversation.statusActiveFlags }
        : conversation.statusType,
      path: null,
      cwd: conversation.cwd ?? "",
      cliVersion: "test",
      source: "codex-app-server",
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: conversation.threadName,
      turns: conversation.turns.map((turn) => ({
        id: turn.turnId,
        items: turn.items.map((item) => {
          if (item.rawItem && typeof item.rawItem === "object") {
            return item.rawItem;
          }
          return {
            id: item.itemId,
            type: item.kind === "userMessage" ? "userMessage" : "agentMessage",
            ...(item.kind === "userMessage"
              ? { content: [{ type: "text", text: item.markdownText ?? "", text_elements: [] }] }
              : { text: item.markdownText ?? "" }),
          };
        }) as never[],
        itemsView: "full",
        status: turn.status,
        error: turn.errorMessage
          ? { message: turn.errorMessage, codexErrorInfo: null, additionalDetails: null }
          : null,
        startedAt: (turn.startedAt ?? turn.turnStartedAtMs ?? conversation.createdAt) / 1000,
        completedAt: turn.completedAt ? turn.completedAt / 1000 : null,
        durationMs: turn.durationMs ?? null,
      })),
    },
  } as unknown as ThreadRollbackResponse;
}

function buildAssistantMessage(
  threadId: string,
  turnId: string,
  itemId: string,
  markdownText: string,
): CodexConversationItem {
  return {
    threadId,
    turnId,
    itemId,
    type: "message",
    kind: "assistantMessage",
    semanticKind: "assistantMessage",
    status: "completed",
    role: "assistant",
    markdownText,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildUserMessage(
  threadId: string,
  turnId: string,
  itemId: string,
  markdownText: string,
): CodexConversationItem {
  return {
    threadId,
    turnId,
    itemId,
    type: "user_message",
    kind: "userMessage",
    semanticKind: "userMessage",
    status: "completed",
    role: "user",
    markdownText,
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildCommandExecutionItem(
  threadId: string,
  turnId: string,
  itemId: string,
  aggregatedOutput = "",
): CodexConversationItem {
  return {
    threadId,
    turnId,
    itemId,
    entryId: itemId,
    type: "command_execution",
    kind: "commandExecution",
    semanticKind: "exec",
    status: "inProgress",
    command: "bun test",
    cwd: null,
    processId: null,
    commandActions: [],
    aggregatedOutput,
    exitCode: null,
    durationMs: null,
    toolCall: {
      subtype: "command",
      toolName: "bash",
      args: {
        command: "bun test",
      },
      result: aggregatedOutput,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildMcpToolCallItem(
  threadId: string,
  turnId: string,
  itemId: string,
): CodexConversationItem {
  return {
    threadId,
    turnId,
    itemId,
    entryId: itemId,
    type: "mcp_tool_call",
    kind: "toolCall",
    semanticKind: "mcpToolCall",
    status: "inProgress",
    mcpToolCall: {
      callId: itemId,
      functionName: "docs__search",
      invocation: {
        server: "docs",
        tool: "search",
        arguments: {
          query: "streaming parity",
        },
      },
      result: null,
      durationMs: null,
      completed: false,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function dispatchThreadSnapshot(message: CodexHostMessage): void {
  hostMessageListener?.(message);
}

async function flushAsyncWork(ticks = 2): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("local-conversation-store", () => {
  test("dedupes older-turn loads and applies the returned paged snapshot", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    let resolveOlderTurns: (conversation: CodexConversationSnapshot | null) => void = () => {};
    olderThreadTurnsResult = new Promise<CodexConversationSnapshot | null>((resolve) => {
      resolveOlderTurns = resolve;
    });
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    const firstLoad = manager.requestThreadOlderTurns("thread-older");
    const secondLoad = manager.requestThreadOlderTurns("thread-older");

    expect(String(invokeCalls.filter((call) => call === "codex:thread:turns:load-older").length)).toBe("1");

    resolveOlderTurns({
      ...buildConversation("thread-older", "project-1"),
      turnPagination: {
        olderCursor: "cursor-older",
        backwardsCursor: "cursor-newer",
        oldestLoadedTurnId: "turn-oldest",
        isLoadingOlder: false,
        hasLoadedOldest: false,
        loadedTurnCount: 50,
        itemsView: "full",
      },
    });
    await firstLoad;
    await secondLoad;

    const conversation = manager.readConversation("thread-older");
    expect(conversation?.turnPagination?.olderCursor ?? null).toBe("cursor-older");
    expect(conversation?.turnPagination?.hasLoadedOldest ?? true).toBeFalse();
    manager.destroy();
    olderThreadTurnsResult = null;
  });

  test("leaves session-start auto-title generation to main", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    startThreadForSessionResult = {
      ...buildConversation("thread-auto", "project-1"),
      threadName: null,
      threadPreview: "Fallback preview",
      cwd: "/tmp/project-1",
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    await manager.startThreadForSession({
      projectId: "project-1",
      sessionId: "session-1",
      prompt: "ignored raw prompt",
      promptInput: {
        text: "Context\n## My request for Codex:\nBuild title parity",
        textAttachments: [{ text: "Pasted requirements" }],
      },
    });
    await settleAsyncRender();

    const startCall = invokeRecords.find((record) => record.channel === "codex:thread:start-for-session");
    const startInput = startCall?.args[0] as { promptInput?: { text?: string; textAttachments?: Array<{ text?: string }> } } | undefined;

    expect(startInput?.promptInput?.text).toBe("Context\n## My request for Codex:\nBuild title parity");
    expect(startInput?.promptInput?.textAttachments?.[0]?.text).toBe("Pasted requirements");
    expect(invokeRecords.some((record) => record.channel === "codex:thread:title:generate")).toBeFalse();
    expect(invokeRecords.some((record) => record.channel === "codex:thread:name:set-generated")).toBeFalse();
  });

  test("forwards skipAutoTitleGeneration without renderer-side generation", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    startThreadForSessionResult = {
      ...buildConversation("thread-skip", "project-1"),
      threadName: null,
      threadPreview: "",
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    await manager.startThreadForSession({
      projectId: "project-1",
      sessionId: "session-1",
      prompt: "Build title parity",
      skipAutoTitleGeneration: true,
    });
    await settleAsyncRender();

    const startCall = invokeRecords.find((record) => record.channel === "codex:thread:start-for-session");
    const startInput = startCall?.args[0] as { skipAutoTitleGeneration?: boolean } | undefined;

    expect(startInput?.skipAutoTitleGeneration).toBeTrue();
    expect(invokeRecords.some((record) => record.channel === "codex:thread:title:generate")).toBeFalse();
  });

  test("requests and applies the started session thread snapshot after success", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    snapshotByThread = {
      "thread-snapshot": {
        ...buildConversation("thread-snapshot", "project-1"),
        threadName: "Snapshot applied",
      },
    };
    startThreadForSessionResult = {
      ...buildThreadSummary("thread-snapshot", "project-1"),
      threadName: "Start detail",
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      await manager.startThreadForSession({
        projectId: "project-1",
        sessionId: "session-1",
        prompt: "Build direct handoff",
        runInTarget: "localProject",
      });
      await settleAsyncRender();

      const startCallIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread:start-for-session"
      );
      const snapshotCallIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-snapshot"
      );
      const startInput = invokeRecords[startCallIndex]?.args[0] as { permissionMode?: string } | undefined;

      expect(startCallIndex >= 0).toBeTrue();
      expect(snapshotCallIndex > startCallIndex).toBeTrue();
      expect(startInput?.permissionMode).toBe("custom");
      expect(manager.readConversation("thread-snapshot")?.threadName).toBe("Snapshot applied");
    } finally {
      snapshotByThread = {};
      manager.destroy();
    }
  });

  test("seeds session thread start progress before invoking main", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    let resolveStart: (value: CodexConversationSnapshot) => void = () => {
      throw new Error("Expected pending start resolver");
    };
    startThreadForSessionResult = new Promise<CodexConversationSnapshot>((resolve) => {
      resolveStart = resolve;
    });
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    const startPromise = manager.startThreadForSession({
      projectId: "project-1",
      sessionId: "session-1",
      prompt: "Start immediately",
      runInTarget: "localProject",
    });

    const seeded = manager.readThreadStartProgress("project-1", "session-1");
    expect(Boolean(seeded)).toBeTrue();
    expect(seeded?.phase).toBe("startingThread");
    expect(seeded?.runInTarget).toBe("localProject");
    expect(seeded?.message).toBe("Sending message…");

    resolveStart(buildConversation("thread-start", "project-1"));
    await startPromise;
  });

  test("shared thread start progress updates keep target metadata across selectors", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      useCodexThreadStartProgress,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    function Probe() {
      const progress = useCodexThreadStartProgress("project-1", "session-1");
      return createElement(
        "div",
        null,
        `${progress?.runInTarget ?? "none"}:${progress?.threadId ?? "none"}:${progress?.phase ?? "none"}`,
      );
    }

    const { container } = render(createElement(LocalConversationProvider, null, createElement(Probe)));
    await settleAsyncRender();
    expect(textContent(container)).toBe("none:none:none");

    await act(async () => {
      hostMessageListener?.({
        type: "sharedObjectUpdated",
        hostId: "default",
        object: {
          objectType: "threadStartProgress",
          objectId: "project-1:session-1",
          value: {
            projectId: "project-1",
            sessionId: "session-1",
            runInTarget: "newWorktree",
            threadId: "thread-1",
            phase: "startingThread",
            message: "Sending message…",
            updatedAt: 10,
          },
        },
      });
    });
    await settleAsyncRender();

    expect(textContent(container)).toBe("newWorktree:thread-1:startingThread");
  });

  test("hydrates account and connection through the external store bootstrap", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      useCodexAvailableModels,
      useLocalConversationAccount,
      useLocalConversationConnection,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    function Probe() {
      const account = useLocalConversationAccount();
      const connection = useLocalConversationConnection();
      const models = useCodexAvailableModels();
      const accountEmail = account?.account?.type === "chatgpt"
        ? account.account.email
        : "none";
      return createElement("div", null, `${connection.status}:${accountEmail}:${models[0]?.id ?? "none"}`);
    }

    const { container } = render(createElement(LocalConversationProvider, null, createElement(Probe)));
    await settleAsyncRender();

    expect([...invokeCalls].sort().join(",")).toBe(
      "codex:account:read,codex:connection:status,codex:dictation:state:read,codex:dictation:state:read,codex:model:list",
    );
    expect(textContent(container)).toBe("connected:dev@example.com:gpt-5.3-codex");
  });

  test("conversation selectors stay isolated to the selected thread", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      __resetLocalConversationStoreForTests,
      hydrateLocalConversationThreadSummaries,
      LocalConversationProvider,
      readLocalConversation,
      useConversation,
      useProjectThreadSummaries,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    hydrateLocalConversationThreadSummaries("project-1", [
      buildThreadSummary("thread-1", "project-1"),
    ]);

    let conversationRenderCount = 0;
    let summaryRenderCount = 0;

    function ConversationProbe() {
      conversationRenderCount += 1;
      const conversation = useConversation("thread-1");
      return createElement("div", { "data-conversation": conversation?.threadId ?? "none" });
    }

    function SummaryProbe() {
      summaryRenderCount += 1;
      const summaries = useProjectThreadSummaries("project-1");
      return createElement("div", { "data-summary-count": String(summaries.length) });
    }

    render(
      createElement(
        LocalConversationProvider,
        null,
        createElement("div", null, createElement(ConversationProbe), createElement(SummaryProbe)),
      ),
    );
    await settleAsyncRender();

    conversationRenderCount = 0;
    summaryRenderCount = 0;

    await act(async () => {
      const snapshot = buildConversation("thread-2", "project-2");
      hostMessageListener?.({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-2",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: snapshot,
        },
        version: 1,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    expect(String(conversationRenderCount)).toBe("0");
    expect(String(summaryRenderCount)).toBe("0");

    await act(async () => {
      const snapshot = buildConversation("thread-1", "project-1");
      hostMessageListener?.({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: snapshot,
        },
        version: 1,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    expect(readLocalConversation("thread-1")?.threadId ?? "none").toBe("thread-1");
    expect(String(summaryRenderCount)).toBe("0");

    conversationRenderCount = 0;
    summaryRenderCount = 0;

    await act(async () => {
      const previousConversation = buildConversation("thread-1", "project-1");
      const nextConversation: CodexConversationSnapshot = {
        ...previousConversation,
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-1",
            status: "inProgress",
            itemIds: [],
            items: [],
          },
        ],
      };
      hostMessageListener?.({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(previousConversation, nextConversation),
        },
        version: 2,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    expect(readLocalConversation("thread-1")?.turns.length ?? 0).toBe(1);
    expect(String(summaryRenderCount)).toBe("0");
  });

  test("applies assistant text patches into renderer conversation state", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      const nextConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [{
          ...baseConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "hello")],
        }],
      };

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
        sourceClientId: null,
      });

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("hello");
    } finally {
      manager.destroy();
    }
  });

  test("commits follower streaming prose patches before same-stack completion patches", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      LocalConversationProvider,
      __resetLocalConversationStoreForTests,
      useConversation,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const renderStates: string[] = [];
    function Probe() {
      const conversation = useConversation("thread-1");
      const item = conversation?.turns[0]?.items[0];
      if (item) {
        renderStates.push(`${item.status ?? "none"}:${item.markdownText ?? ""}`);
      }
      return createElement("div", null, item?.markdownText ?? "");
    }

    const rendered = render(
      createElement(LocalConversationProvider, null, createElement(Probe)),
    );
    try {
      await settleAsyncRender();
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      const streamingConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [{
          ...baseConversation.turns[0]!,
          items: [{
            ...baseConversation.turns[0]!.items[0]!,
            markdownText: "hello",
          }],
        }],
      };
      const completedConversation: CodexConversationSnapshot = {
        ...streamingConversation,
        turns: [{
          ...streamingConversation.turns[0]!,
          status: "completed",
          items: [{
            ...streamingConversation.turns[0]!.items[0]!,
            status: "completed",
          }],
        }],
      };

      await act(async () => {
        dispatchCodexAppServerMessage("thread-stream-state-changed", {
          hostId: "default",
          conversationId: "thread-1",
          version: 1,
          change: {
            type: "snapshot",
            revision: 1,
            conversationState: baseConversation,
          },
          sourceClientId: "owner-window",
        });
      });
      await settleAsyncRender();
      renderStates.length = 0;

      await act(async () => {
        dispatchCodexAppServerMessage("thread-stream-state-changed", {
          hostId: "default",
          conversationId: "thread-1",
          version: 2,
          change: {
            type: "patches",
            baseRevision: 1,
            revision: 2,
            patches: buildCodexConversationStateUpdates(baseConversation, streamingConversation),
          },
          sourceClientId: "owner-window",
        });
        dispatchCodexAppServerMessage("thread-stream-state-changed", {
          hostId: "default",
          conversationId: "thread-1",
          version: 3,
          change: {
            type: "patches",
            baseRevision: 2,
            revision: 3,
            patches: buildCodexConversationStateUpdates(streamingConversation, completedConversation),
          },
          sourceClientId: "owner-window",
        });
      });
      await settleAsyncRender();

      expect(renderStates.includes("inProgress:hello")).toBeTrue();
      expect(renderStates.includes("completed:hello")).toBeTrue();
    } finally {
      rendered.unmount();
    }
  });

  test("two managers share owner stream state and recover owner loss from bundle 40400-40680", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = true;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const followerManager = new CodexAppServerManager("default");
    let ownerManager: InstanceType<typeof CodexAppServerManager> | null = null;
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: "owner-a",
      });

      resumeThreadResult = baseConversation;
      ownerManager = new CodexAppServerManager("default");
      await ownerManager.requestThreadStreamResume("thread-1");

      const ownerSnapshotPublish = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      expect(Boolean(ownerSnapshotPublish)).toBeTrue();
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 10,
        request: {
          id: "input-1",
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "assistant-1",
            autoResolutionMs: null,
            questions: [{
              id: "q1",
              header: "Choice",
              question: "Pick one",
              isOther: false,
              isSecret: false,
              options: [{ label: "A", description: "First" }],
            }],
          },
        },
      });

      const ownerRequestPublish = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish" &&
        (record.args[0] as { change?: { type?: string } } | undefined)?.change?.type === "patches"
      );
      const ownerRequestChange = (ownerRequestPublish?.args[0] as {
        change?: {
          type: "patches";
          baseRevision: number;
          revision: number;
          patches: CodexConversationStateUpdate[];
        };
      } | undefined)?.change;
      expect(Boolean(ownerRequestPublish)).toBeTrue();
      expect(ownerManager.readConversation("thread-1")?.requests[0]?.requestId).toBe("input-1");
      expect(followerManager.readConversation("thread-1")?.requests.length ?? -1).toBe(0);

      if (!ownerRequestChange) {
        throw new Error("Missing owner request patch");
      }

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: ownerRequestChange,
        sourceClientId: "owner-a",
      });

      const followerRequestConversation = followerManager.readConversation("thread-1");
      expect(followerRequestConversation?.requests[0]?.requestId).toBe("input-1");
      expect(followerRequestConversation?.requests[0]?.type).toBe("userInput");
      expect(Boolean(followerRequestConversation?.turns[0]?.items.some((item) =>
        item.itemId === "user-input-response-input-1" && item.status === "inProgress"
      ))).toBeTrue();
      invokeRecords = [];

      const responded = await followerManager.respondUserInput("input-1", { q1: ["A"] });
      const responseAction = invokeRecords.find((record) => record.channel === "codex:thread-follower:action");
      const responsePayload = responseAction?.args[0] as {
        action?: { type?: string; requestId?: string; answers?: Record<string, string[]> };
      } | undefined;
      expect(responded).toBeTrue();
      expect(responsePayload?.action?.type).toBe("respondUserInput");
      expect(responsePayload?.action?.requestId).toBe("input-1");
      expect(responsePayload?.action?.answers?.q1?.[0]).toBe("A");
      expect(invokeRecords.some((record) => record.channel === "codex:user-input:respond")).toBeFalse();
      invokeRecords = [];

      const requestConversation = followerManager.readConversation("thread-1");
      if (!requestConversation) {
        throw new Error("Missing follower request conversation");
      }
      const patchedRequestConversation: CodexConversationSnapshot = {
        ...requestConversation,
        turns: [{
          ...requestConversation.turns[0]!,
          items: requestConversation.turns[0]!.items.map((item) =>
            item.itemId === "assistant-1"
              ? buildAssistantMessage("thread-1", "turn-1", "assistant-1", "live")
              : item
          ),
        }],
      };

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 3,
        change: {
          type: "patches",
          baseRevision: 2,
          revision: 3,
          patches: buildCodexConversationStateUpdates(requestConversation, patchedRequestConversation),
        },
        sourceClientId: "owner-a",
      });

      expect(ownerManager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("");
      expect(followerManager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("live");

      const interrupted = await followerManager.interruptTurn("thread-1", "turn-1");
      const followerAction = invokeRecords.find((record) => record.channel === "codex:thread-follower:action");
      const followerPayload = followerAction?.args[0] as {
        action?: { type?: string; turnId?: string };
      } | undefined;
      expect(interrupted).toBeTrue();
      expect(followerPayload?.action?.type).toBe("interruptTurn");
      expect("turnId" in (followerPayload?.action ?? {})).toBeFalse();

      dispatchCodexAppServerMessage("thread-owner-unavailable", {
        hostId: "default",
        ownerClientId: "owner-a",
        conversationIds: ["thread-1"],
      });

      expect(followerManager.readConversation("thread-1")?.resumeState).toBe("needs_resume");
      expect(ownerManager.readConversation("thread-1")?.resumeState).toBe("resumed");
    } finally {
      resumeThreadResult = null;
      followerActionResult = null;
      ownerManager?.destroy();
      followerManager.destroy();
    }
  });

  test("two managers run owner/follower release-gate flow without source-null visible patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    snapshotByThread = {};
    resumeThreadResult = null;
    completeThreadTurnsResult = null;
    ownerEditRollbackResult = null;
    ownerTurnStartResult = null;
    followerActionResult = null;
    followerActionError = null;
    followerActionHandler = null;
    ownerStreamPublishHandler = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const ownerClientId = "owner-a";
    let hostMessageVersion = 0;
    const streamEvents: Array<{
      conversationId: string;
      change: CodexThreadStreamStateChange;
      sourceClientId: string | null;
    }> = [];
    const dispatchStreamState = (
      conversationId: string,
      change: CodexThreadStreamStateChange,
      sourceClientId: string | null = ownerClientId,
    ) => {
      hostMessageVersion += 1;
      streamEvents.push({
        conversationId,
        change,
        sourceClientId,
      });
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId,
        version: hostMessageVersion,
        change,
        sourceClientId,
      });
    };
    const followerManager = new CodexAppServerManager("default");
    let ownerManager: InstanceType<typeof CodexAppServerManager> | null = null;
    try {
      const planItem: CodexConversationItem = {
        threadId: "thread-1",
        turnId: "turn-plan",
        itemId: "implement-plan:turn-plan",
        type: "planImplementation",
        kind: "planImplementation",
        semanticKind: "planImplementation",
        status: "inProgress",
        markdownText: "1. Ship the parity plan",
        rawItem: {
          id: "implement-plan:turn-plan",
          type: "planImplementation",
          turnId: "turn-plan",
          planContent: "1. Ship the parity plan",
          isCompleted: false,
        },
        createdAt: 1,
        updatedAt: 1,
      };
      const initialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-plan",
            status: "completed",
            itemIds: ["implement-plan:turn-plan"],
            items: [planItem],
          },
          {
            threadId: "thread-1",
            turnId: "turn-user",
            status: "completed",
            itemIds: ["user-original"],
            items: [buildUserMessage("thread-1", "turn-user", "user-original", "Original prompt")],
          },
        ],
        requests: [{
          type: "implementPlan",
          requestId: "implement-plan:turn-plan",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-plan",
          itemId: "implement-plan:turn-plan",
          planContent: "1. Ship the parity plan",
          createdAt: 1,
        }],
      };
      const rollbackConversation: CodexConversationSnapshot = {
        ...initialConversation,
        turns: [initialConversation.turns[0]!],
      };
      completeThreadTurnsResult = initialConversation;
      ownerEditRollbackResult = buildRollbackResponseFromConversation(rollbackConversation);
      ownerTurnStartResult = {
        turn: {
          id: "turn-replacement",
          items: [],
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: 1,
          completedAt: null,
          durationMs: null,
        },
      };
      resumeThreadResult = initialConversation;
      ownerStreamPublishHandler = (input) => {
        const publish = input as {
          conversationId?: string;
          change?: CodexThreadStreamStateChange;
        };
        if (!publish.conversationId || !publish.change) {
          return false;
        }
        dispatchStreamState(publish.conversationId, publish.change);
        return true;
      };

      dispatchStreamState("thread-1", {
        type: "snapshot",
        revision: 1,
        conversationState: initialConversation,
      });
      ownerManager = new CodexAppServerManager("default");
      followerActionHandler = async (input) => {
        const payload = input as {
          action?: Parameters<InstanceType<typeof CodexAppServerManager>["handleThreadOwnerActionRequest"]>[0];
        };
        if (!ownerManager || !payload.action) {
          throw new Error("Missing owner action target");
        }
        return await ownerManager.handleThreadOwnerActionRequest(payload.action);
      };
      await ownerManager.requestThreadStreamResume("thread-1");
      await flushAsyncWork(2);

      const editResult = await followerManager.editLastUserTurn("thread-1", "turn-user", "Rewrite prompt");
      await flushAsyncWork(2);
      expect(editResult.threadId).toBe("thread-1");
      expect(followerManager.readConversation("thread-1")?.turns.at(-1)?.items[0]?.markdownText).toBe("Rewrite prompt");
      expect(ownerManager.readConversation("thread-1")?.turns.at(-1)?.turnId).toBe("turn-replacement");

      const removedPlan = await followerManager.removePlanImplementationRequest("thread-1", "turn-plan");
      await flushAsyncWork(2);
      expect(removedPlan).toBeTrue();
      expect(String(followerManager.readConversation("thread-1")?.requests.length ?? -1)).toBe("0");
      expect(followerManager.readConversation("thread-1")?.turns[0]?.items[0]?.status).toBe("completed");

      await followerManager.enqueueQueuedFollowUp("thread-1", "Queued follow-up");
      await flushAsyncWork(2);
      const queuedFollowUpId = followerManager.readConversation("thread-1")?.queuedFollowUps[0]?.followUpId ?? null;
      expect(Boolean(queuedFollowUpId)).toBeTrue();
      if (!queuedFollowUpId) {
        throw new Error("Missing queued follow-up id");
      }
      await followerManager.removeQueuedFollowUp("thread-1", queuedFollowUpId);
      await flushAsyncWork(2);
      expect(String(followerManager.readConversation("thread-1")?.queuedFollowUps.length ?? -1)).toBe("0");

      animationFrameCallbacks.length = 0;
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/started",
        sequence: 19,
        params: {
          threadId: "thread-1",
          turnId: "turn-replacement",
          item: {
            id: "assistant-replacement",
            type: "agentMessage",
            role: "assistant",
            status: "inProgress",
            text: "",
          },
        },
      });
      await flushAsyncWork(2);
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 20,
        params: {
          threadId: "thread-1",
          turnId: "turn-replacement",
          itemId: "assistant-replacement",
          delta: "partial",
        },
      });
      if (animationFrameCallbacks.length > 0) {
        while (animationFrameCallbacks.length > 0) {
          animationFrameCallbacks.shift()?.(16);
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
      await flushAsyncWork(2);
      expect(ownerManager.readConversation("thread-1")?.turns.at(-1)?.items[1]?.markdownText).toBe("partial");
      expect(followerManager.readConversation("thread-1")?.turns.at(-1)?.items[1]?.markdownText).toBe("partial");

      const steerResult = await followerManager.steerTurn({
        threadId: "thread-1",
        prompt: "Steer this active turn",
      });
      await flushAsyncWork(2);
      expect(steerResult?.turnId).toBe("turn-replacement");
      expect(String(followerManager.readConversation("thread-1")?.pendingSteers.length ?? -1)).toBe("0");

      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 30,
        request: {
          id: "input-1",
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-1",
            turnId: "turn-replacement",
            itemId: "assistant-replacement",
            autoResolutionMs: null,
            questions: [{
              id: "q1",
              header: "Choice",
              question: "Pick one",
              isOther: false,
              isSecret: false,
              options: [{ label: "A", description: "First" }],
            }],
          },
        },
      });
      await flushAsyncWork(2);
      expect(followerManager.readConversation("thread-1")?.requests[0]?.requestId).toBe("input-1");
      const answered = await followerManager.respondUserInput("input-1", { q1: ["A"] }, "thread-1");
      await flushAsyncWork(3);
      expect(answered).toBeTrue();
      expect(String(followerManager.readConversation("thread-1")?.requests.length ?? -1)).toBe("0");

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/completed",
        sequence: 40,
        params: {
          threadId: "thread-1",
          turnId: "turn-replacement",
          item: {
            id: "assistant-replacement",
            type: "agentMessage",
            text: "partial final",
          },
        },
      });
      await flushAsyncWork(2);
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "turn/completed",
        sequence: 41,
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-replacement",
            status: "completed",
          },
        },
      });
      await flushAsyncWork(3);
      const completedTurn = followerManager.readConversation("thread-1")?.turns.at(-1);
      expect(completedTurn?.status).toBe("completed");
      expect(completedTurn?.items[1]?.status).toBe("completed");
      expect(completedTurn?.items[1]?.markdownText).toBe("partial final");

      if (!ownerManager.readConversation("thread-1")) {
        throw new Error("Missing owner conversation before normal start");
      }
      ownerTurnStartResult = {
        turn: {
          id: "turn-normal",
          items: [],
          itemsView: "full",
          status: "inProgress",
          error: null,
          startedAt: 1,
          completedAt: null,
          durationMs: null,
        },
      };
      await followerManager.startTurn("thread-1", "Normal start");
      await flushAsyncWork(2);
      expect(followerManager.readConversation("thread-1")?.turns.at(-1)?.turnId).toBe("turn-normal");
      expect(followerManager.readConversation("thread-1")?.turns.at(-1)?.items[0]?.markdownText).toBe("Normal start");

      dispatchCodexAppServerMessage("thread-owner-unavailable", {
        hostId: "default",
        ownerClientId,
        conversationIds: ["thread-1"],
      });
      expect(followerManager.readConversation("thread-1")?.resumeState).toBe("needs_resume");
      expect(ownerManager.readConversation("thread-1")?.resumeState).toBe("resumed");
      expect(streamEvents.some((event) => event.sourceClientId === null)).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:edit-last-user-turn")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:turn:start")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:turn:steer")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:enqueue")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:remove")).toBeFalse();
    } finally {
      followerActionHandler = null;
      ownerStreamPublishHandler = null;
      followerActionResult = null;
      followerActionError = null;
      resumeThreadResult = null;
      completeThreadTurnsResult = null;
      ownerEditRollbackResult = null;
      ownerTurnStartResult = null;
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      ownerManager?.destroy();
      followerManager.destroy();
    }
  });

  test("drops patches with a mismatched base revision from bundle 40608-40613", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      const nextConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [{
          ...baseConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "stale")],
        }],
      };

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "patches",
          baseRevision: 0,
          revision: 2,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
        sourceClientId: null,
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();
    } finally {
      manager.destroy();
    }
  });

  test("drops patches from a stale owner client from bundle 40608-40613", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      const nextConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [{
          ...baseConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "wrong owner")],
        }],
      };

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: "owner-a",
      });
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
        sourceClientId: "owner-b",
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();
    } finally {
      manager.destroy();
    }
  });

  test("drops patches when no stream snapshot established follower ownership from bundle 40608-40613", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      const nextConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [{
          ...baseConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "should not apply")],
        }],
      };

      olderThreadTurnsResult = baseConversation;
      await manager.requestThreadOlderTurns("thread-1");
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "patches",
          baseRevision: 0,
          revision: 1,
          patches: buildCodexConversationStateUpdates(baseConversation, nextConversation),
        },
        sourceClientId: null,
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();
    } finally {
      olderThreadTurnsResult = null;
      manager.destroy();
    }
  });

  test("drops patch application failures without source-null resync from bundle 40616-40632", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      const invalidPatches: CodexConversationStateUpdate[] = [{
        op: "replace",
        path: ["turns", 99, "status"],
        value: "completed",
      }];

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: "owner-a",
      });
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: invalidPatches,
        },
        sourceClientId: "owner-a",
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.turns[0]?.status).toBe("inProgress");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();
    } finally {
      manager.destroy();
    }
  });

  test("owner ignores source-null stream patches from bundle 40580-40620", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      const staleMainConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [{
          ...baseConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "stale main")],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(baseConversation, staleMainConversation),
        },
        sourceClientId: null,
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "owner",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 70));

      const publishRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishInput = publishRecord?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("owner");
      expect(publishInput?.ownerNotificationSequence).toBe(1);
      expect(publishInput?.change?.type).toBe("patches");
      expect(publishInput?.change?.baseRevision).toBe(2);
      expect(publishInput?.change?.revision).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("renderer resume publishes owner snapshot before releasing buffered events", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-resume-owner", "project-1"),
        turns: [{
          threadId: "thread-resume-owner",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-resume-owner", "turn-1", "assistant-1", "hydrated")],
        }],
      };
      resumeThreadResult = baseConversation;

      const result = await manager.requestThreadStreamResume("thread-resume-owner");
      const releaseIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread:resume-buffer:release"
      );
      const snapshotPublishIndex = invokeRecords.findIndex((record) => {
        if (record.channel !== "codex:thread-owner:stream-state:publish") return false;
        const input = record.args[0] as {
          ownerNotificationSequence?: number;
          change?: { type?: string };
        };
        return input.ownerNotificationSequence === undefined && input.change?.type === "snapshot";
      });
      const snapshotPublish = invokeRecords[snapshotPublishIndex]?.args[0] as {
        change?: {
          revision?: number;
          conversationState?: CodexConversationSnapshot;
        };
      } | undefined;

      expect(result?.threadId ?? "").toBe("thread-resume-owner");
      expect(releaseIndex >= 0).toBeTrue();
      expect(snapshotPublishIndex >= 0).toBeTrue();
      expect(snapshotPublishIndex < releaseIndex).toBeTrue();
      expect(snapshotPublish?.change?.revision).toBe(1);
      expect(snapshotPublish?.change?.conversationState?.resumeState).toBe("resumed");
      expect(snapshotPublish?.change?.conversationState?.turns[0]?.items[0]?.markdownText).toBe("hydrated");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("renderer resume failure releases buffer and rolls back to needs_resume from bundle 47815-47835", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    resumeThreadError = new Error("resume failed");
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-resume-failed", "project-1"),
        resumeState: "needs_resume",
        turns: [],
      };

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-resume-failed",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });

      let threw = false;
      try {
        await manager.requestThreadStreamResume("thread-resume-failed");
      } catch {
        threw = true;
      }

      const releaseIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread:resume-buffer:release"
      );
      const finalSnapshotPublish = invokeRecords.find((record) => {
        if (record.channel !== "codex:thread-owner:stream-state:publish") return false;
        const input = record.args[0] as {
          ownerNotificationSequence?: number;
          change?: { type?: string };
        };
        return input.ownerNotificationSequence === undefined && input.change?.type === "snapshot";
      });

      expect(threw).toBeTrue();
      expect(releaseIndex >= 0).toBeTrue();
      expect(manager.readConversation("thread-resume-failed")?.resumeState).toBe("needs_resume");
      expect(Boolean(finalSnapshotPublish)).toBeFalse();
    } finally {
      resumeThreadResult = null;
      resumeThreadError = null;
      manager.destroy();
    }
  });

  test("owner thread notifications update local text and publish revisioned patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "hello",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 70));

      const publishRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishInput = publishRecord?.args[0] as {
        conversationId?: string;
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(publishInput?.conversationId).toBe("thread-1");
      expect(publishInput?.ownerNotificationSequence).toBe(1);
      expect(publishInput?.change?.type).toBe("patches");
      expect(publishInput?.change?.baseRevision).toBe(2);
      expect(publishInput?.change?.revision).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner plan and reasoning deltas publish prose patches from bundle 51692-51755", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["plan-1", "reasoning-1"],
          items: [
            {
              threadId: "thread-1",
              turnId: "turn-1",
              itemId: "plan-1",
              type: "plan",
              kind: "plan",
              semanticKind: "proposedPlan",
              status: "inProgress",
              markdownText: "",
              createdAt: 1,
              updatedAt: 1,
            },
            {
              threadId: "thread-1",
              turnId: "turn-1",
              itemId: "reasoning-1",
              type: "reasoning",
              kind: "reasoning",
              semanticKind: "reasoning",
              status: "inProgress",
              markdownText: "",
              rawItem: {
                id: "reasoning-1",
                type: "reasoning",
                summary: [],
                content: [],
              },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/plan/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "plan-1",
          delta: "1. Inspect\n",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/reasoning/summaryTextDelta",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "reasoning-1",
          summaryIndex: 0,
          delta: "Thinking",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/reasoning/textDelta",
        sequence: 3,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "reasoning-1",
          contentIndex: 0,
          delta: "private chain",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 90));

      const conversation = manager.readConversation("thread-1");
      const plan = conversation?.turns[0]?.items.find((item) => item.itemId === "plan-1");
      const reasoning = conversation?.turns[0]?.items.find((item) => item.itemId === "reasoning-1");
      const rawReasoning = reasoning?.rawItem as { summary?: string[]; content?: string[] } | undefined;
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishInput = publishRecords[0]?.args[0] as { ownerNotificationSequence?: number } | undefined;

      expect(plan?.markdownText).toBe("1. Inspect\n");
      expect(reasoning?.markdownText).toBe("Thinking");
      expect(rawReasoning?.summary?.[0]).toBe("Thinking");
      expect(rawReasoning?.content?.[0]).toBe("private chain");
      expect(String(publishRecords.length)).toBe("1");
      expect(publishInput?.ownerNotificationSequence).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner goal notifications publish patches and clear newly completed goals", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/goal/updated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          goal: {
            threadId: "thread-1",
            objective: "Finish parity",
            status: "active",
            tokenBudget: 40000,
            tokensUsed: 10,
            timeUsedSeconds: 2,
            createdAt: 100,
            updatedAt: 101,
          },
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/goal/updated",
        sequence: 2,
        params: {
          threadId: "thread-1",
          goal: {
            threadId: "thread-1",
            objective: "Finish parity",
            status: "complete",
            tokenBudget: 40000,
            tokensUsed: 200,
            timeUsedSeconds: 30,
            createdAt: 100,
            updatedAt: 102,
          },
        },
      });
      await flushAsyncWork();

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/goal/cleared",
        sequence: 3,
        params: {
          threadId: "thread-1",
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const clearRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "thread/goal/clear"
      );
      const firstPublish = publishRecords[0]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      const clearNotificationPublish = publishRecords
        .map((record) => record.args[0] as {
          ownerNotificationSequence?: number;
          change?: { type?: string; baseRevision?: number; revision?: number };
        })
        .find((record) => record.ownerNotificationSequence === 3);

      expect(conversation?.threadGoal ?? null).toBe(null);
      expect(conversation?.completedThreadGoal?.status ?? "").toBe("complete");
      expect(String(publishRecords.length)).toBe("4");
      expect(firstPublish?.ownerNotificationSequence).toBe(1);
      expect(firstPublish?.change?.baseRevision).toBe(2);
      expect(firstPublish?.change?.revision).toBe(3);
      expect(clearNotificationPublish?.ownerNotificationSequence).toBe(3);
      expect(clearNotificationPublish?.change?.type).toBe("patches");
      expect(clearRecord !== undefined).toBeTrue();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner item lifecycle notifications publish started and completed patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/started",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: "",
          },
        },
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.status).toBe("inProgress");
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("");

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/completed",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: "done",
          },
        },
      });
      await flushAsyncWork();

      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const firstPublish = publishRecords[0]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      const secondPublish = publishRecords[1]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      expect(String(publishRecords.length)).toBe("2");
      expect(firstPublish?.ownerNotificationSequence).toBe(1);
      expect(firstPublish?.change?.baseRevision).toBe(2);
      expect(firstPublish?.change?.revision).toBe(3);
      expect(secondPublish?.ownerNotificationSequence).toBe(2);
      expect(secondPublish?.change?.baseRevision).toBe(3);
      expect(secondPublish?.change?.revision).toBe(4);
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.status).toBe("completed");
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("done");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner item completion drains pending prose delta patches first", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      const delta = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta,
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/completed",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: delta,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 120));

      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ownerSequences = publishRecords.map((record) => {
        const input = record.args[0] as { ownerNotificationSequence?: number } | undefined;
        return String(input?.ownerNotificationSequence ?? 0);
      });
      const deltaPublishIndex = ownerSequences.indexOf("1");
      const completedPublishIndex = ownerSequences.indexOf("2");
      expect(deltaPublishIndex >= 0).toBeTrue();
      expect(completedPublishIndex > deltaPublishIndex).toBeTrue();
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe(delta);
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.status).toBe("completed");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner turn lifecycle notifications publish snapshots", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "turn/started",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "inProgress",
          },
        },
      });
      await flushAsyncWork();

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "turn/completed",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "completed",
            durationMs: 42,
          },
        },
      });
      await flushAsyncWork();

      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const firstPublish = publishRecords[0]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      const secondPublish = publishRecords[1]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      expect(String(publishRecords.length)).toBe("2");
      expect(firstPublish?.ownerNotificationSequence).toBe(1);
      expect(firstPublish?.change?.type).toBe("patches");
      expect(firstPublish?.change?.baseRevision).toBe(2);
      expect(firstPublish?.change?.revision).toBe(3);
      expect(secondPublish?.ownerNotificationSequence).toBe(2);
      expect(secondPublish?.change?.type).toBe("patches");
      expect(secondPublish?.change?.baseRevision).toBe(3);
      expect(secondPublish?.change?.revision).toBe(4);
      expect(manager.readConversation("thread-1")?.statusType).toBe("idle");
      expect(manager.readConversation("thread-1")?.turns[0]?.status).toBe("completed");
      expect(manager.readConversation("thread-1")?.turns[0]?.durationMs).toBe(42);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner thread status notifications publish patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        statusType: "idle",
        statusActiveFlags: [],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/status/changed",
        sequence: 1,
        params: {
          threadId: "thread-1",
          status: {
            type: "active",
            activeFlags: ["waitingOnApproval"],
          },
        },
      });
      await flushAsyncWork();

      const publishRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishInput = publishRecord?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      expect(manager.readConversation("thread-1")?.statusType).toBe("active");
      expect(manager.readConversation("thread-1")?.statusActiveFlags[0]).toBe("waitingOnApproval");
      expect(publishInput?.ownerNotificationSequence).toBe(1);
      expect(publishInput?.change?.type).toBe("patches");
      expect(publishInput?.change?.baseRevision).toBe(2);
      expect(publishInput?.change?.revision).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner turn diff notifications publish patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "turn/diff/updated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          diff: "diff --git a/file.ts b/file.ts",
        },
      });
      await flushAsyncWork();

      const publishRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishInput = publishRecord?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      expect(manager.readConversation("thread-1")?.turns[0]?.diff).toBe("diff --git a/file.ts b/file.ts");
      expect(publishInput?.ownerNotificationSequence).toBe(1);
      expect(publishInput?.change?.type).toBe("patches");
      expect(publishInput?.change?.baseRevision).toBe(2);
      expect(publishInput?.change?.revision).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner thread metadata notifications publish patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        threadName: "Old name",
        latestThreadSettings: {
          model: "gpt-5.3-codex",
          reasoningEffort: "medium",
          collaborationMode: {
            mode: "default",
            settings: {
              model: "gpt-5.3-codex",
              reasoning_effort: "medium",
              developer_instructions: null,
            },
          },
        },
        latestCollaborationMode: {
          mode: "default",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "medium",
            developer_instructions: null,
          },
        },
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/name/updated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          threadName: "New name",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/settings/updated",
        sequence: 2,
        params: {
          threadId: "thread-1",
          threadSettings: {
            model: "gpt-5.4-codex",
            effort: "high",
            collaborationMode: {
              mode: "plan",
              settings: {
                model: "gpt-5.4-codex",
                reasoning_effort: "high",
              },
            },
          },
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/tokenUsage/updated",
        sequence: 3,
        params: {
          threadId: "thread-1",
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
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const lastPublish = publishRecords[publishRecords.length - 1]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; revision?: number };
      } | undefined;

      expect(conversation?.threadName).toBe("New name");
      expect(conversation?.latestThreadSettings?.model).toBe("gpt-5.4-codex");
      expect(conversation?.latestThreadSettings?.reasoningEffort).toBe("high");
      expect(conversation?.latestThreadSettings?.collaborationMode?.mode).toBe("plan");
      expect(conversation?.latestTokenUsageInfo?.total.totalTokens).toBe(100);
      expect((conversation?.turns[0]?.tokenUsage ?? null) === null).toBeTrue();
      expect(String(publishRecords.length)).toBe("2");
      expect(lastPublish?.ownerNotificationSequence).toBe(3);
      expect(lastPublish?.change?.type).toBe("patches");
      expect(lastPublish?.change?.revision).toBe(4);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner thread started notifications publish thread metadata from bundle 51037-51045", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        threadName: null,
        threadPreview: "Old preview",
        modelProvider: "openai",
        cwd: "/tmp/old",
        resumeState: "resuming",
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/started",
        sequence: 1,
        params: {
          thread: {
            id: "thread-1",
            sessionId: "thread-1",
            forkedFromId: null,
            parentThreadId: null,
            preview: "Started preview",
            ephemeral: false,
            modelProvider: "openai-responses",
            createdAt: 10,
            updatedAt: 20,
            status: { type: "idle" },
            path: null,
            cwd: "/tmp/new",
            cliVersion: "test",
            source: "cli",
            threadSource: null,
            agentNickname: null,
            agentRole: null,
            gitInfo: null,
            name: "Started title",
            turns: [],
          },
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const publishRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishInput = publishRecord?.args[0] as {
        ownerNotificationSequence?: number;
        change?: {
          type?: string;
          baseRevision?: number;
          revision?: number;
        };
      } | undefined;

      expect(conversation?.threadName).toBe("Started title");
      expect(conversation?.threadPreview).toBe("Started preview");
      expect(conversation?.modelProvider).toBe("openai-responses");
      expect(conversation?.cwd).toBe("/tmp/new");
      expect(conversation?.resumeState).toBe("resumed");
      expect(conversation?.statusType).toBe("idle");
      expect(String(conversation?.turns.length ?? -1)).toBe("1");
      expect(publishInput?.ownerNotificationSequence).toBe(1);
      expect(publishInput?.change?.type).toBe("patches");
      expect(publishInput?.change?.baseRevision).toBe(2);
      expect(publishInput?.change?.revision).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner turn plan error and resolved request notifications publish patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const commandItem: CodexConversationItem = {
        ...buildCommandExecutionItem("thread-1", "turn-1", "cmd-1"),
        approvalRequestId: "approval-1",
      };
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        statusActiveFlags: ["waitingOnApproval"],
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["cmd-1"],
          items: [commandItem],
        }],
        requests: [{
          type: "approval",
          requestId: "approval-1",
          kind: "command",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          createdAt: 1,
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "turn/plan/updated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          explanation: "Plan",
          plan: [
            { step: "Inspect bundle", status: "completed" },
            { step: "Patch Nodex", status: "in_progress" },
          ],
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "error",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          error: {
            message: "Tool failed",
            additionalDetails: "exit 1",
          },
          willRetry: false,
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "serverRequest/resolved",
        sequence: 3,
        params: {
          threadId: "thread-1",
          requestId: "approval-1",
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const turn = conversation?.turns[0];
      const todoItem = turn?.items.find((item) => item.itemId === "todo-list:turn-1");
      const errorItem = turn?.items.find((item) => item.itemId === "error:turn-1");
      const command = turn?.items.find((item) => item.itemId === "cmd-1");
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );

      expect(todoItem?.semanticKind).toBe("todoList");
      expect(todoItem?.markdownText).toBe("1. [x] Inspect bundle\n2. [ ] Patch Nodex");
      expect(errorItem?.semanticKind).toBe("systemError");
      expect(errorItem?.additionalDetails).toBe("exit 1");
      expect(String(conversation?.requests.length ?? -1)).toBe("0");
      expect(command?.approvalRequestId ?? null).toBe(null);
      expect(String(conversation?.statusActiveFlags.length ?? -1)).toBe("0");
      expect(String(publishRecords.length)).toBe("2");
      expect(
        (publishRecords[publishRecords.length - 1]?.args[0] as { ownerNotificationSequence?: number } | undefined)
          ?.ownerNotificationSequence,
      ).toBe(3);
      expect(String(ackRecords.length)).toBe("0");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner server requests publish request-plane patches from bundle 51920-52380", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const commandItem = buildCommandExecutionItem("thread-1", "turn-1", "cmd-1");
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["cmd-1"],
          items: [commandItem],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 1,
        request: {
          id: "approval-1",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "cmd-1",
            startedAtMs: 10,
            approvalId: null,
            environmentId: null,
            reason: "Need command access",
            command: "bun test",
            cwd: "/repo",
            commandActions: null,
            additionalPermissions: null,
            proposedExecpolicyAmendment: null,
            proposedNetworkPolicyAmendments: null,
            availableDecisions: null,
          },
        },
      });
      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 2,
        request: {
          id: "input-1",
          method: "item/tool/requestUserInput",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "input-call-1",
            autoResolutionMs: null,
            questions: [{
              id: "q1",
              header: "Question",
              question: "Pick one",
              isOther: false,
              isSecret: false,
              options: [{ label: "A", description: "Option A" }],
            }],
          },
        },
      });
      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 3,
        request: {
          id: "permission-1",
          method: "item/permissions/requestApproval",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "permission-call-1",
            environmentId: "env-1",
            startedAtMs: 12,
            cwd: "/repo",
            reason: "Need network access",
            permissions: {
              network: {
                enabled: true,
              },
              fileSystem: null,
            },
          },
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const command = conversation?.turns[0]?.items.find((item) => item.itemId === "cmd-1");
      const userInputItem = conversation?.turns[0]?.items.find((item) => item.itemId === "user-input-response-input-1");
      const permissionItem = conversation?.turns[0]?.items.find((item) => item.itemId === "permission-request-permission-1");
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );

      expect(String(conversation?.requests.length ?? -1)).toBe("3");
      expect(conversation?.requests[0]?.type).toBe("approval");
      expect(conversation?.requests[1]?.type).toBe("userInput");
      expect(conversation?.requests[2]?.type).toBe("permissionRequest");
      expect(command?.approvalRequestId).toBe("approval-1");
      expect(userInputItem?.kind).toBe("userInputResponse");
      expect(userInputItem?.status).toBe("inProgress");
      expect(String(userInputItem?.userInputQuestions?.length ?? -1)).toBe("1");
      expect(permissionItem?.semanticKind).toBe("permissionRequest");
      expect(permissionItem?.status).toBe("inProgress");
      expect(permissionItem?.markdownText).toBe("Need network access");
      expect(String(publishRecords.length)).toBe("2");
      expect(
        (publishRecords[publishRecords.length - 1]?.args[0] as { ownerNotificationSequence?: number } | undefined)
          ?.ownerNotificationSequence,
      ).toBe(3);

      await manager.respondUserInput("input-1", { q1: ["A"] });
      await manager.respondApproval("approval-1", "decline");
      await manager.respondPermissionRequest("permission-1", { permissions: {}, scope: "turn" });
      await flushAsyncWork();

      const resolvedConversation = manager.readConversation("thread-1");
      const resolvedCommand = resolvedConversation?.turns[0]?.items.find((item) => item.itemId === "cmd-1");
      const resolvedUserInputItem = resolvedConversation?.turns[0]?.items.find((item) =>
        item.itemId === "user-input-response-input-1"
      );
      const resolvedPermissionItem = resolvedConversation?.turns[0]?.items.find((item) =>
        item.itemId === "permission-request-permission-1"
      );
      const resolvedPublishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      expect(String(resolvedConversation?.requests.length ?? -1)).toBe("0");
      expect(resolvedCommand?.approvalRequestId ?? null).toBe(null);
      expect(resolvedUserInputItem?.status).toBe("completed");
      expect(resolvedUserInputItem?.userInputAnswers?.q1?.[0]).toBe("A");
      expect(resolvedPermissionItem?.status).toBe("completed");
      expect(JSON.stringify(resolvedPermissionItem?.rawItem)).toBe(JSON.stringify({
        id: "permission-request-permission-1",
        type: "permissionRequest",
        requestId: "permission-1",
        turnId: "turn-1",
        reason: "Need network access",
        permissions: {
          network: {
            enabled: true,
          },
          fileSystem: null,
        },
        completed: true,
        response: {
          permissions: {},
          scope: "turn",
        },
      }));
      expect(String(resolvedPublishRecords.length)).toBe("5");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner dynamic tool-call request invokes main and acks without stream patches from bundle 51920-52390", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-dynamic", "project-1"),
        turns: [{
          threadId: "thread-dynamic",
          turnId: "turn-dynamic",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-dynamic",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-dynamic");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 1,
        request: {
          id: "dynamic-1",
          method: "item/tool/call",
          params: {
            threadId: "thread-dynamic",
            turnId: "turn-dynamic",
            callId: "call-dynamic",
            namespace: "codex_app",
            tool: "list_projects",
            arguments: {},
          },
        },
      });
      await flushAsyncWork();

      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );
      const dynamicToolRecords = invokeRecords.filter((record) =>
        record.channel === "codex:dynamic-tool-call:respond"
      );
      const conversation = manager.readConversation("thread-dynamic");

      expect(String(dynamicToolRecords.length)).toBe("1");
      expect(dynamicToolRecords[0]?.args[0]).toBe("dynamic-1");
      expect(String(ackRecords.length)).toBe("1");
      expect((ackRecords[0]?.args[0] as { conversationId?: string; sequence?: number } | undefined)?.conversationId)
        .toBe("thread-dynamic");
      expect((ackRecords[0]?.args[0] as { conversationId?: string; sequence?: number } | undefined)?.sequence)
        .toBe(1);
      expect(String(publishRecords.length)).toBe("0");
      expect(String(conversation?.requests.length ?? -1)).toBe("0");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner model safety buffering notification publishes a turn patch from bundle 51037-51920", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "model/safetyBuffering/updated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          model: "gpt-5.4-codex",
          useCases: ["latency"],
          reasons: ["warming"],
          showBufferingUi: true,
          fasterModel: "gpt-5.4-mini",
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publish = publishRecords[0]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;

      expect(conversation?.turns[0]?.safetyBuffering?.showBufferingUi).toBeTrue();
      expect(conversation?.turns[0]?.safetyBuffering?.useCases[0]).toBe("latency");
      expect(conversation?.turns[0]?.safetyBuffering?.reasons[0]).toBe("warming");
      expect(conversation?.turns[0]?.safetyBuffering?.fasterModel).toBe("gpt-5.4-mini");
      expect(String(publishRecords.length)).toBe("1");
      expect(publish?.ownerNotificationSequence).toBe(1);
      expect(publish?.change?.type).toBe("patches");
      expect(publish?.change?.baseRevision).toBe(2);
      expect(publish?.change?.revision).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner hook lifecycle notifications upsert one hook item from bundle 51435-51490", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "hook/started",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          run: {
            id: "hook-run-1",
            eventName: "preToolUse",
            status: "running",
            statusMessage: "Preparing context",
            entries: [{ kind: "context", text: "Added AGENTS.md" }],
          },
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "hook/completed",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          run: {
            id: "hook-run-1",
            eventName: "preToolUse",
            status: "completed",
            statusMessage: "Preparing context",
            entries: [{ kind: "context", text: "Added AGENTS.md" }],
          },
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const hookItems = conversation?.turns[0]?.items.filter((item) => item.itemId === "hook-run-1") ?? [];
      const hookItem = hookItems[0];
      const hookRun = hookItem?.rawItem as { run?: { status?: string; entries?: Array<{ text?: string }> } } | undefined;
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const lastPublish = publishRecords[publishRecords.length - 1]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;

      expect(String(hookItems.length)).toBe("1");
      expect(hookItem?.semanticKind).toBe("hook");
      expect(hookItem?.status).toBe("completed");
      expect(hookRun?.run?.status).toBe("completed");
      expect(hookRun?.run?.entries?.[0]?.text).toBe("Added AGENTS.md");
      expect(String(publishRecords.length)).toBe("2");
      expect(lastPublish?.ownerNotificationSequence).toBe(2);
      expect(lastPublish?.change?.type).toBe("patches");
      expect(lastPublish?.change?.baseRevision).toBe(3);
      expect(lastPublish?.change?.revision).toBe(4);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner automatic approval review notifications upsert one review item from bundle 48279-48302 and 51658-51660", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/autoApprovalReview/started",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
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
      await flushAsyncWork();

      const startedConversation = manager.readConversation("thread-1");
      const startedItem = startedConversation?.turns[0]?.items.find((item) =>
        item.itemId === "automatic-approval-review:review-1"
      );
      const startedRaw = startedItem?.rawItem as { status?: string; startedAtMs?: number } | undefined;

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/autoApprovalReview/completed",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
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
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const reviewItems = conversation?.turns[0]?.items.filter((item) =>
        item.itemId === "automatic-approval-review:review-1"
      ) ?? [];
      const reviewItem = reviewItems[0];
      const reviewRaw = reviewItem?.rawItem as {
        status?: string;
        targetItemId?: string | null;
        startedAtMs?: number;
        completedAtMs?: number | null;
      } | undefined;
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const lastPublish = publishRecords[publishRecords.length - 1]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;

      expect(String(reviewItems.length)).toBe("1");
      expect(startedItem?.status).toBe("inProgress");
      expect(startedRaw?.status).toBe("inProgress");
      expect(reviewItem?.semanticKind).toBe("automaticApprovalReview");
      expect(reviewItem?.status).toBe("completed");
      expect(reviewItem?.markdownText).toBe("This only runs tests.");
      expect(reviewRaw?.status).toBe("approved");
      expect(reviewRaw?.targetItemId).toBe("item-command-1");
      expect(String(reviewRaw?.startedAtMs)).toBe(String(startedRaw?.startedAtMs));
      expect(typeof reviewRaw?.completedAtMs).toBe("number");
      expect(String(publishRecords.length)).toBe("2");
      expect(lastPublish?.ownerNotificationSequence).toBe(2);
      expect(lastPublish?.change?.type).toBe("patches");
      expect(lastPublish?.change?.baseRevision).toBe(3);
      expect(lastPublish?.change?.revision).toBe(4);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner guardian warning appends an auto-review interruption item from bundle 48303-48324 and 51663-51664", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "guardianWarning",
        sequence: 1,
        params: {
          threadId: "thread-1",
          message: "Unrelated guardian warning",
        },
      });
      await flushAsyncWork();

      let conversation = manager.readConversation("thread-1");
      let warningItems = conversation?.turns[0]?.items.filter((item) =>
        item.semanticKind === "autoReviewInterruptionWarning"
      ) ?? [];
      let publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      expect(String(warningItems.length)).toBe("0");
      expect(String(publishRecords.length)).toBe("0");

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "guardianWarning",
        sequence: 2,
        params: {
          threadId: "thread-1",
          kind: "tooManyDenials",
          message: "Automatic approval review rejected too many approval requests for this turn.",
        },
      });
      await flushAsyncWork();

      conversation = manager.readConversation("thread-1");
      warningItems = conversation?.turns[0]?.items.filter((item) =>
        item.semanticKind === "autoReviewInterruptionWarning"
      ) ?? [];
      const warningItem = warningItems[0];
      const warningRaw = warningItem?.rawItem as { type?: string } | undefined;
      publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publish = publishRecords[0]?.args[0] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;

      expect(String(warningItems.length)).toBe("1");
      expect(warningItem?.type).toBe("autoReviewInterruptionWarning");
      expect(warningItem?.markdownText).toBe("Automatic approval review rejected too many approval requests for this turn");
      expect(warningRaw?.type).toBe("autoReviewInterruptionWarning");
      expect(String(publishRecords.length)).toBe("1");
      expect(publish?.ownerNotificationSequence).toBe(2);
      expect(publish?.change?.type).toBe("patches");
      expect(publish?.change?.baseRevision).toBe(2);
      expect(publish?.change?.revision).toBe(3);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner text queue hidden-window fallback flushes the full delta without rAF slicing", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let requestAnimationFrameCalled = false;
    if (browserWindow) {
      browserWindow.requestAnimationFrame = (() => {
        requestAnimationFrameCalled = true;
        return 1;
      }) as Window["requestAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      const delta = "abcdefghijklmnopqrstuvwxyz0123456789";
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(requestAnimationFrameCalled).toBeFalse();
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe(delta);
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      expect(String(publishRecords.length)).toBe("1");
    } finally {
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner assistant text delta publishes first frame on visible rAF", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let requestAnimationFrameCallCount = 0;
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        requestAnimationFrameCallCount += 1;
        animationFrameCallbacks.push(callback);
        return 1;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      const delta = "abcdefghijklmnopqrstuvwxyz0123456789";
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta,
        },
      });

      const item = manager.readConversation("thread-1")?.turns[0]?.items[0];
      expect(item?.markdownText).toBe("");
      expect(item?.status).toBe("inProgress");
      expect(String(requestAnimationFrameCallCount)).toBe("1");

      animationFrameCallbacks.shift()?.(16);

      const nextItem = manager.readConversation("thread-1")?.turns[0]?.items[0];
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      expect(nextItem?.markdownText).toBe("abcdefghijklmnopqrstuvwx");
      expect(nextItem?.status).toBe("inProgress");
      expect(String(publishRecords.length)).toBe("1");
    } finally {
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner stream publish queue serializes prose patch IPC while local state advances", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    ownerStreamPublishHandler = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const manager = new CodexAppServerManager("default");
    const publishResolvers: Array<(accepted: boolean) => void> = [];
    const publishInputs: unknown[] = [];
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      ownerStreamPublishHandler = (input) => {
        publishInputs.push(input);
        if (publishInputs.length === 1) {
          return new Promise<boolean>((resolve) => {
            publishResolvers.push(resolve);
          });
        }
        return true;
      };

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "first ",
        },
      });
      animationFrameCallbacks.shift()?.(16);
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("first ");
      expect(String(publishInputs.length)).toBe("1");

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "second",
        },
      });
      animationFrameCallbacks.shift()?.(32);
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("first second");
      expect(String(publishInputs.length)).toBe("1");

      publishResolvers.shift()?.(true);
      await flushAsyncWork(3);
      const secondPublish = publishInputs[1] as {
        ownerNotificationSequence?: number;
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      expect(String(publishInputs.length)).toBe("2");
      expect(secondPublish?.ownerNotificationSequence).toBe(2);
      expect(secondPublish?.change?.type).toBe("patches");
      expect(secondPublish?.change?.baseRevision).toBe(3);
      expect(secondPublish?.change?.revision).toBe(4);
    } finally {
      ownerStreamPublishHandler = null;
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner snapshot transactions wait for in-flight prose patch revisions from bundle 40424-40555", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    completeThreadTurnsResult = null;
    ownerStreamPublishHandler = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const manager = new CodexAppServerManager("default");
    const publishResolvers: Array<(accepted: boolean) => void> = [];
    const publishInputs: unknown[] = [];
    try {
      const latestTurn = {
        threadId: "thread-1",
        turnId: "turn-1",
        status: "inProgress" as const,
        itemIds: ["assistant-1"],
        items: [{
          ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
          status: "inProgress" as const,
        }],
      };
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [latestTurn],
      };
      const completeConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: [],
            items: [],
          },
          {
            ...latestTurn,
            items: [{
              ...latestTurn.items[0]!,
              markdownText: "hello",
            }],
          },
        ],
      };
      resumeThreadResult = baseConversation;
      completeThreadTurnsResult = completeConversation;
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      ownerStreamPublishHandler = (input) => {
        publishInputs.push(input);
        if (publishInputs.length === 1) {
          return new Promise<boolean>((resolve) => {
            publishResolvers.push(resolve);
          });
        }
        return true;
      };

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "hello",
        },
      });
      animationFrameCallbacks.shift()?.(16);
      expect(String(publishInputs.length)).toBe("1");

      let completeResolved = false;
      const completePromise = manager.handleThreadOwnerActionRequest({
        type: "loadCompleteHistory",
        threadId: "thread-1",
      }).then((result) => {
        completeResolved = true;
        return result as { revision?: number };
      });
      await flushAsyncWork(3);

      expect(completeResolved).toBeFalse();
      expect(String(publishInputs.length)).toBe("1");

      publishResolvers.shift()?.(true);
      const result = await completePromise;
      await flushAsyncWork(2);

      const prosePatch = publishInputs[0] as {
        change?: { type?: string; baseRevision?: number; revision?: number };
      } | undefined;
      const historySnapshot = publishInputs[1] as {
        change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
      } | undefined;
      expect(result.revision).toBe(3);
      expect(prosePatch?.change?.type).toBe("patches");
      expect(prosePatch?.change?.baseRevision).toBe(1);
      expect(prosePatch?.change?.revision).toBe(2);
      expect(historySnapshot?.change?.type).toBe("snapshot");
      expect(historySnapshot?.change?.revision).toBe(3);
      expect(String(historySnapshot?.change?.conversationState?.turns.length ?? -1)).toBe("2");
    } finally {
      ownerStreamPublishHandler = null;
      resumeThreadResult = null;
      completeThreadTurnsResult = null;
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      manager.destroy();
    }
  });

  test("owner patch publish rejection repairs with current snapshot without source-null resync", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    ownerStreamPublishHandler = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    const manager = new CodexAppServerManager("default");
    const publishInputs: unknown[] = [];
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeCalls = [];
      invokeRecords = [];
      ownerStreamPublishHandler = (input) => {
        publishInputs.push(input);
        return publishInputs.length !== 1;
      };

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "hello",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      await flushAsyncWork(3);

      const repairPublish = publishInputs[1] as {
        ownerNotificationSequence?: number;
        change?: {
          type?: string;
          revision?: number;
          conversationState?: CodexConversationSnapshot;
        };
      } | undefined;
      expect(invokeCalls.includes("codex:thread:snapshot:request")).toBeFalse();
      expect(String(publishInputs.length)).toBe("2");
      expect(repairPublish?.ownerNotificationSequence).toBe(1);
      expect(repairPublish?.change?.type).toBe("snapshot");
      expect(repairPublish?.change?.conversationState?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(manager.readConversation("thread-1")?.resumeState).toBe("resumed");
    } finally {
      ownerStreamPublishHandler = null;
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner repair snapshot failure keeps partial text and marks conversation needs resume", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    ownerStreamPublishHandler = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    const manager = new CodexAppServerManager("default");
    const publishInputs: unknown[] = [];
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeCalls = [];
      invokeRecords = [];
      ownerStreamPublishHandler = (input) => {
        publishInputs.push(input);
        return false;
      };

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "hello",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      await flushAsyncWork(3);

      expect(invokeCalls.includes("codex:thread:snapshot:request")).toBeFalse();
      expect(String(publishInputs.length)).toBe("2");
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("hello");
      expect(manager.readConversation("thread-1")?.resumeState).toBe("needs_resume");
    } finally {
      ownerStreamPublishHandler = null;
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner reducer precondition failure preserves partial text without source-null resync", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    snapshotByThread = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", "partial"),
            status: "inProgress",
          }],
        }],
      };
      const staleConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [{
          ...partialConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "stale")],
        }],
      };
      snapshotByThread["thread-1"] = staleConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: partialConversation,
        },
        sourceClientId: "owner-a",
      });
      dispatchCodexAppServerMessage("thread-owner-unavailable", {
        hostId: "default",
        ownerClientId: "owner-a",
        conversationIds: ["thread-1"],
      });
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "thread/name/updated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          name: "Should not apply",
        },
      });
      await flushAsyncWork(2);

      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("partial");
      expect(manager.readConversation("thread-1")?.resumeState).toBe("needs_resume");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      )).toBeTrue();
    } finally {
      snapshotByThread = {};
      manager.destroy();
    }
  });

  test("connected status refresh does not source-null resync active owner conversations", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    snapshotByThread = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", "partial"),
            status: "inProgress",
          }],
        }],
      };
      const staleConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [{
          ...partialConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "stale")],
        }],
      };
      resumeThreadResult = partialConversation;
      snapshotByThread["thread-1"] = staleConversation;

      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("client-status-changed", {
        hostId: "default",
        status: "connected",
      });
      await flushAsyncWork(2);

      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("partial");
      expect(manager.readConversation("thread-1")?.resumeState).toBe("resumed");
    } finally {
      snapshotByThread = {};
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner item completion waits for visible rAF drain before applying completed item", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let requestAnimationFrameCallCount = 0;
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        requestAnimationFrameCallCount += 1;
        animationFrameCallbacks.push(callback);
        return 1;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      const delta = "abcdefghijklmnopqrstuvwxyz0123456789";
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta,
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/completed",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: delta,
          },
        },
      });

      const item = manager.readConversation("thread-1")?.turns[0]?.items[0];
      expect(item?.markdownText).toBe("");
      expect(item?.status).toBe("inProgress");
      expect(String(requestAnimationFrameCallCount)).toBe("1");

      animationFrameCallbacks.shift()?.(16);

      const partialItem = manager.readConversation("thread-1")?.turns[0]?.items[0];
      expect(partialItem?.markdownText).toBe("abcdefghijklmnopqrstuvwx");
      expect(partialItem?.status).toBe("inProgress");
      expect(String(requestAnimationFrameCallCount)).toBe("2");

      animationFrameCallbacks.shift()?.(32);
      await flushAsyncWork(3);

      const completedItem = manager.readConversation("thread-1")?.turns[0]?.items[0];
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ownerSequences = publishRecords.map((record) => {
        const input = record.args[0] as { ownerNotificationSequence?: number } | undefined;
        return String(input?.ownerNotificationSequence ?? 0);
      });
      const deltaPublishIndex = ownerSequences.indexOf("1");
      const completedPublishIndex = ownerSequences.indexOf("2");
      expect(completedItem?.markdownText).toBe(delta);
      expect(completedItem?.status).toBe("completed");
      expect(String(requestAnimationFrameCallCount)).toBe("2");
      expect(deltaPublishIndex >= 0).toBeTrue();
      expect(completedPublishIndex > deltaPublishIndex).toBeTrue();
    } finally {
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner short assistant delta commits an in-progress React frame before item completion", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      LocalConversationProvider,
      __resetLocalConversationStoreForTests,
      useConversation,
      useDefaultCodexAppServerManager,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    let requestAnimationFrameCallCount = 0;
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        requestAnimationFrameCallCount += 1;
        animationFrameCallbacks.push(callback);
        return requestAnimationFrameCallCount;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    let managerRef: CodexAppServerManagerInstance | null = null;
    const renderStates: string[] = [];
    function Probe() {
      managerRef = useDefaultCodexAppServerManager();
      const conversation = useConversation("thread-1");
      const item = conversation?.turns[0]?.items[0];
      if (item) {
        renderStates.push(`${item.status ?? "none"}:${item.markdownText ?? ""}`);
      }
      return createElement("div", null, item?.markdownText ?? "");
    }

    const rendered = render(
      createElement(LocalConversationProvider, null, createElement(Probe)),
    );
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [{
            ...buildAssistantMessage("thread-1", "turn-1", "assistant-1", ""),
            status: "inProgress",
          }],
        }],
      };
      const delta = "short streaming";
      resumeThreadResult = baseConversation;
      await settleAsyncRender();
      const manager = managerRef as unknown as CodexAppServerManagerInstance | null;
      if (!manager) {
        throw new Error("Expected local conversation manager");
      }

      await act(async () => {
        dispatchCodexAppServerMessage("thread-stream-state-changed", {
          hostId: "default",
          conversationId: "thread-1",
          version: 1,
          change: {
            type: "snapshot",
            revision: 1,
            conversationState: baseConversation,
          },
          sourceClientId: null,
        });
      });
      await act(async () => {
        await manager.requestThreadStreamResume("thread-1");
      });
      invokeRecords = [];
      renderStates.length = 0;

      await act(async () => {
        dispatchCodexAppServerMessage("thread-owner-notification", {
          hostId: "default",
          method: "item/agentMessage/delta",
          sequence: 1,
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "assistant-1",
            delta,
          },
        });
        dispatchCodexAppServerMessage("thread-owner-notification", {
          hostId: "default",
          method: "item/completed",
          sequence: 2,
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            item: {
              id: "assistant-1",
              type: "agentMessage",
              text: delta,
            },
          },
        });
      });

      expect(String(requestAnimationFrameCallCount)).toBe("1");
      await act(async () => {
        await flushAsyncWork(3);
      });
      const completedItem = manager.readConversation("thread-1")?.turns[0]?.items[0];
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ownerSequences = publishRecords.map((record) => {
        const input = record.args[0] as { ownerNotificationSequence?: number } | undefined;
        return String(input?.ownerNotificationSequence ?? 0);
      });
      expect(completedItem?.markdownText).toBe(delta);
      expect(completedItem?.status).toBe("completed");
      expect(renderStates.includes(`inProgress:${delta}`)).toBeTrue();
      expect(renderStates.includes(`completed:${delta}`)).toBeTrue();
      expect(ownerSequences.indexOf("2") > ownerSequences.indexOf("1")).toBeTrue();
    } finally {
      await act(async () => {
        rendered.unmount();
      });
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
    }
  });

  test("owner prose and reasoning deltas before item started do not synthesize items", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "assistant-1",
          delta: "hello",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/plan/delta",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "plan-1",
          delta: "plan",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/reasoning/summaryTextDelta",
        sequence: 3,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "reasoning-1",
          summaryIndex: 0,
          delta: "summary",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/reasoning/textDelta",
        sequence: 4,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "reasoning-1",
          contentIndex: 0,
          delta: "content",
        },
      });

      animationFrameCallbacks.shift()?.(16);
      await flushAsyncWork(1);

      const turn = manager.readConversation("thread-1")?.turns[0];
      expect(turn?.itemIds.join(",")).toBe("");
      expect(String(turn?.items.length ?? -1)).toBe("0");
      expect(invokeRecords.some((record) => record.channel === "codex:thread-owner:stream-state:publish")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-owner:notification:ack")).toBeTrue();
    } finally {
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner terminal turn lifecycle waits for visible rAF prose drain", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    ownerStreamPublishHandler = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const scenarios: Array<{
      method: "turn/completed" | "turn/interrupted" | "turn/failed";
      status: "completed" | "interrupted" | "failed";
    }> = [
      { method: "turn/completed", status: "completed" },
      { method: "turn/interrupted", status: "interrupted" },
      { method: "turn/failed", status: "failed" },
    ];

    try {
      for (const scenario of scenarios) {
        const threadId = `thread-${scenario.status}`;
        const manager = new CodexAppServerManager("default");
        try {
          animationFrameCallbacks.length = 0;
          const baseConversation: CodexConversationSnapshot = {
            ...buildConversation(threadId, "project-1"),
            turns: [{
              threadId,
              turnId: "turn-1",
              status: "inProgress",
              itemIds: ["assistant-1"],
              items: [{
                ...buildAssistantMessage(threadId, "turn-1", "assistant-1", ""),
                status: "inProgress",
              }],
            }],
          };
          const delta = "abcdefghijklmnopqrstuvwxyz0123456789";
          resumeThreadResult = baseConversation;

          dispatchCodexAppServerMessage("thread-stream-state-changed", {
            hostId: "default",
            conversationId: threadId,
            version: 1,
            change: {
              type: "snapshot",
              revision: 1,
              conversationState: baseConversation,
            },
            sourceClientId: null,
          });
          await manager.requestThreadStreamResume(threadId);
          invokeRecords = [];

          dispatchCodexAppServerMessage("thread-owner-notification", {
            hostId: "default",
            method: "item/agentMessage/delta",
            sequence: 1,
            params: {
              threadId,
              turnId: "turn-1",
              itemId: "assistant-1",
              delta,
            },
          });
          dispatchCodexAppServerMessage("thread-owner-notification", {
            hostId: "default",
            method: scenario.method,
            sequence: 2,
            params: {
              threadId,
              turn: {
                id: "turn-1",
                status: scenario.status,
              },
            },
          });

          expect(manager.readConversation(threadId)?.turns[0]?.status).toBe("inProgress");
          expect(manager.readConversation(threadId)?.turns[0]?.items[0]?.markdownText).toBe("");

          animationFrameCallbacks.shift()?.(16);
          expect(manager.readConversation(threadId)?.turns[0]?.status).toBe("inProgress");
          expect(manager.readConversation(threadId)?.turns[0]?.items[0]?.markdownText).toBe("abcdefghijklmnopqrstuvwx");

          animationFrameCallbacks.shift()?.(32);
          expect(manager.readConversation(threadId)?.turns[0]?.status).toBe(scenario.status);
          expect(manager.readConversation(threadId)?.turns[0]?.items[0]?.markdownText).toBe(delta);
        } finally {
          manager.destroy();
        }
      }
    } finally {
      ownerStreamPublishHandler = null;
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
    }
  });

  test("owner command output notifications update locally and ack without stream patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["cmd-1"],
          items: [buildCommandExecutionItem("thread-1", "turn-1", "cmd-1")],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/commandExecution/outputDelta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          delta: "owner output\n",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 70));

      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );
      const ackInput = ackRecord?.args[0] as { conversationId?: string; sequence?: number } | undefined;

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.aggregatedOutput).toBe("owner output\n");
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.toolCall?.result).toBe("owner output\n");
      expect(String(publishRecords.length)).toBe("0");
      expect(ackInput?.conversationId).toBe("thread-1");
      expect(ackInput?.sequence).toBe(1);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner terminal interactions append command actions locally and ack without stream patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["cmd-1"],
          items: [buildCommandExecutionItem("thread-1", "turn-1", "cmd-1")],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/commandExecution/terminalInteraction",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          processId: "proc-1",
          stdin: "bun tes",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/commandExecution/terminalInteraction",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          processId: "proc-1",
          stdin: "t\n",
        },
      });
      await flushAsyncWork();

      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );
      const ackSequences = ackRecords
        .map((record) => {
          const input = record.args[0] as { conversationId?: string; sequence?: number };
          return `${input.conversationId}:${input.sequence}`;
        })
        .join(",");
      const item = manager.readConversation("thread-1")?.turns[0]?.items[0];
      const commandAction = item?.commandActions?.[0];
      const toolCallArgs = item?.toolCall?.args as { commandActions?: Array<{ command?: string }> } | undefined;

      expect(String(publishRecords.length)).toBe("0");
      expect(ackSequences).toBe("thread-1:1,thread-1:2");
      expect(commandAction?.type).toBe("unknown");
      expect(commandAction?.command).toBe("bun test");
      expect(toolCallArgs?.commandActions?.[0]?.command).toBe("bun test");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner no-op item notifications ack without visible stream mutation", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["mcp-1"],
          items: [buildMcpToolCallItem("thread-1", "turn-1", "mcp-1")],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/reasoning/summaryPartAdded",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "reasoning-1",
          summaryIndex: 1,
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/fileChange/outputDelta",
        sequence: 2,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "patch-legacy-output",
          delta: "legacy apply_patch output",
        },
      });
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/mcpToolCall/progress",
        sequence: 3,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "mcp-1",
          message: "Searching docs",
        },
      });
      await flushAsyncWork();

      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );
      const ackSequences = ackRecords
        .map((record) => {
          const input = record.args[0] as { conversationId?: string; sequence?: number };
          return `${input.conversationId}:${input.sequence}`;
        })
        .join(",");
      const item = manager.readConversation("thread-1")?.turns[0]?.items[0];

      expect(String(publishRecords.length)).toBe("0");
      expect(ackSequences).toBe("thread-1:1,thread-1:2,thread-1:3");
      expect(item?.itemId).toBe("mcp-1");
      expect(item?.status).toBe("inProgress");
      expect(item?.mcpToolCall?.result).toBe(null);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner nullable turn notifications resolve to latest turn for prose and completion", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "")],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          itemId: "assistant-1",
          delta: "partial",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 70));

      const streamingItem = manager.readConversation("thread-1")?.turns[0]?.items[0];
      expect(streamingItem?.markdownText).toBe("partial");
      expect(streamingItem?.status).toBe("inProgress");

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/completed",
        sequence: 2,
        params: {
          threadId: "thread-1",
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: "final",
          },
        },
      });
      await flushAsyncWork();

      const item = manager.readConversation("thread-1")?.turns[0]?.items[0];
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );

      expect(item?.markdownText).toBe("final");
      expect(item?.status).toBe("completed");
      expect(String(publishRecords.length)).toBe("2");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner item started rebinds single completed empty placeholder turn", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: null,
          status: "completed",
          errorMessage: null,
          itemIds: [],
          items: [],
        } as unknown as CodexConversationSnapshot["turns"][number]],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/started",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: "",
          },
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      expect(String(conversation?.turns.length ?? -1)).toBe("1");
      expect(conversation?.turns[0]?.turnId).toBe("turn-1");
      expect(conversation?.turns[0]?.status).toBe("inProgress");
      expect(conversation?.turns[0]?.items[0]?.itemId).toBe("assistant-1");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner item started synthesizes missing turn when latest in-progress placeholder cannot rebind", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: null,
          status: "inProgress",
          itemIds: [],
          items: [],
        } as unknown as CodexConversationSnapshot["turns"][number]],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/started",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: "",
          },
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      expect(String(conversation?.turns.length ?? -1)).toBe("2");
      expect((conversation?.turns[0] as unknown as { turnId: unknown } | undefined)?.turnId ?? null).toBe(null);
      expect(conversation?.turns[1]?.turnId).toBe("turn-1");
      expect(conversation?.turns[1]?.items[0]?.itemId).toBe("assistant-1");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner context compaction started rebinds latest in-progress placeholder turn", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: null,
          status: "inProgress",
          itemIds: [],
          items: [],
        } as unknown as CodexConversationSnapshot["turns"][number]],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/started",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "context-1",
            type: "contextCompaction",
          },
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      expect(String(conversation?.turns.length ?? -1)).toBe("1");
      expect(conversation?.turns[0]?.turnId).toBe("turn-1");
      expect(conversation?.turns[0]?.items[0]?.semanticKind).toBe("contextCompaction");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner command output with nullable turn id resolves by item id", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-1",
            status: "completed",
            itemIds: ["cmd-1"],
            items: [buildCommandExecutionItem("thread-1", "turn-1", "cmd-1")],
          },
          {
            threadId: "thread-1",
            turnId: "turn-2",
            status: "inProgress",
            itemIds: [],
            items: [],
          },
        ],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/commandExecution/outputDelta",
        sequence: 1,
        params: {
          threadId: "thread-1",
          itemId: "cmd-1",
          delta: "nullable output\n",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 70));

      const item = manager.readConversation("thread-1")?.turns[0]?.items[0];
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );
      const ackInput = ackRecord?.args[0] as { sequence?: number } | undefined;

      expect(item?.aggregatedOutput).toBe("nullable output\n");
      expect(item?.toolCall?.result).toBe("nullable output\n");
      expect(String(publishRecords.length)).toBe("0");
      expect(ackInput?.sequence).toBe(1);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner fileChange patchUpdated updates local state and acks without stream patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/fileChange/patchUpdated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "patch-live",
          changes: [{
            path: "src/app.ts",
            kind: { type: "update" },
            diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
          }],
        },
      });
      await flushAsyncWork();

      const turn = manager.readConversation("thread-1")?.turns[0];
      const item = turn?.items[0] ?? null;
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );
      const ackInput = ackRecord?.args[0] as { sequence?: number } | undefined;

      expect(typeof turn?.firstTurnWorkItemStartedAtMs).toBe("number");
      expect(item?.itemId ?? "").toBe("patch-live");
      expect(item?.status ?? "").toBe("inProgress");
      expect(`${item?.kind}:${item?.semanticKind}`).toBe("fileChange:patch");
      expect(item?.fileChange?.paths.join(",") ?? "").toBe("src/app.ts");
      expect(item?.fileChange?.changes[0]?.type ?? "").toBe("update");
      expect(String(publishRecords.length)).toBe("0");
      expect(ackInput?.sequence).toBe(1);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner fileChange patchUpdated rebinds latest in-progress placeholder without stream patches", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: null,
          status: "inProgress",
          itemIds: [],
          items: [],
        } as unknown as CodexConversationSnapshot["turns"][number]],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/fileChange/patchUpdated",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-real",
          itemId: "patch-live",
          changes: [{
            path: "poem.md",
            kind: { type: "add" },
            diff: "",
          }],
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const ackRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:notification:ack"
      );
      const ackInput = ackRecord?.args[0] as { sequence?: number } | undefined;

      expect(String(conversation?.turns.length ?? -1)).toBe("1");
      expect(conversation?.turns[0]?.turnId).toBe("turn-real");
      expect(conversation?.turns[0]?.items[0]?.itemId).toBe("patch-live");
      expect(conversation?.turns[0]?.items[0]?.fileChange?.paths.join(",") ?? "").toBe("poem.md");
      expect(String(publishRecords.length)).toBe("0");
      expect(ackInput?.sequence).toBe(1);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("follower interrupt routes to owner without follower turn id from bundle 50645-50660", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = true;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "working")],
        }],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: "owner-a",
      });

      const interrupted = await manager.interruptTurn("thread-1", "turn-1");

      expect(interrupted).toBeTrue();
      const followerRecord = invokeRecords.find((record) => record.channel === "codex:thread-follower:action");
      const followerPayload = followerRecord?.args[0] as {
        action?: { type?: string; turnId?: string };
      } | undefined;
      expect(Boolean(followerRecord)).toBeTrue();
      expect(followerPayload?.action?.type).toBe("interruptTurn");
      expect("turnId" in (followerPayload?.action ?? {})).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:turn:interrupt")).toBeFalse();
      expect(manager.readConversation("thread-1")?.turns[0]?.status).toBe("inProgress");
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower interrupt timeout falls back without stale turn id from bundle 50645-50725", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionError = new Error("thread-follower-interrupt-turn-timeout");
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-live",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-live", "assistant-1", "working")],
        }],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: "owner-a",
      });

      const interrupted = await manager.interruptTurn("thread-1", "stale-turn");

      const directInterruptRecord = invokeRecords.find((record) => record.channel === "codex:turn:interrupt");
      expect(interrupted).toBeTrue();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-follower:action")).toBeTrue();
      expect(Boolean(directInterruptRecord)).toBeTrue();
      expect(directInterruptRecord?.args[0]).toBe("thread-1");
      expect(directInterruptRecord?.args.includes("stale-turn")).toBeFalse();
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:resume:request" &&
        record.args[0] === "thread-1"
      )).toBeTrue();
    } finally {
      followerActionError = null;
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower start steer settings and compact actions route through owner from bundle 64240-64280", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    const latestFollowerAction = () =>
      invokeRecords.filter((record) => record.channel === "codex:thread-follower:action").at(-1)?.args[0] as {
        conversationId?: string;
        action?: Record<string, unknown>;
      } | undefined;

    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            turns: [{
              threadId: "thread-1",
              turnId: "turn-1",
              status: "inProgress",
              itemIds: [],
              items: [],
            }],
          },
        },
        sourceClientId: "owner-a",
      });

      followerActionResult = { turnId: "turn-new" };
      const startResult = await manager.startTurn("thread-1", "Continue", { permissionMode: "auto" });
      let routed = latestFollowerAction();
      expect((startResult as { turnId?: string } | null)?.turnId).toBe("turn-new");
      expect(routed?.conversationId).toBe("thread-1");
      expect(routed?.action?.type).toBe("startTurn");
      expect(routed?.action?.prompt).toBe("Continue");

      followerActionResult = { turnId: "turn-1" };
      const steerResult = await manager.steerTurn({
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        prompt: "  keep going  ",
      });
      routed = latestFollowerAction();
      const steerInput = routed?.action?.input as { threadId?: string; expectedTurnId?: string; prompt?: string } | undefined;
      expect(steerResult?.turnId).toBe("turn-1");
      expect(routed?.conversationId).toBe("thread-1");
      expect(routed?.action?.type).toBe("steerTurn");
      expect(steerInput?.threadId).toBe("thread-1");
      expect(steerInput?.expectedTurnId).toBe("turn-1");
      expect(steerInput?.prompt).toBe("keep going");

      followerActionResult = {
        model: "gpt-5.4-codex",
        reasoningEffort: "high",
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.4-codex",
            reasoning_effort: "high",
            developer_instructions: null,
          },
        },
      };
      const settings = await manager.setThreadSettingsForConversation("thread-1", {
        reasoningEffort: "high",
        collaborationMode: "plan",
      });
      routed = latestFollowerAction();
      const settingsPatch = routed?.action?.patch as { reasoningEffort?: string; collaborationMode?: string } | undefined;
      expect(settings.reasoningEffort).toBe("high");
      expect(routed?.conversationId).toBe("thread-1");
      expect(routed?.action?.type).toBe("updateThreadSettings");
      expect(settingsPatch?.reasoningEffort).toBe("high");
      expect(settingsPatch?.collaborationMode).toBe("plan");

      followerActionResult = null;
      await manager.compactThread("thread-1");
      routed = latestFollowerAction();
      expect(routed?.conversationId).toBe("thread-1");
      expect(routed?.action?.type).toBe("compactThread");

      expect(invokeRecords.some((record) => record.channel === "codex:turn:start")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:turn:steer")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:settings:update")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:compact:start")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower queued follow-up actions route through owner from bundle 40902-40918", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      await manager.enqueueQueuedFollowUp("thread-1", "first queued prompt", { serviceTier: "fast" });
      await manager.removeQueuedFollowUp("thread-1", "follow-up-1");
      await manager.reorderQueuedFollowUps("thread-1", ["follow-up-2", "follow-up-1"]);
      await manager.sendQueuedFollowUpNow("thread-1", "follow-up-2");

      const followerActions = invokeRecords
        .filter((record) => record.channel === "codex:thread-follower:action")
        .map((record) => record.args[0] as {
          action?: {
            type?: string;
            threadId?: string;
            prompt?: string;
            followUpId?: string;
            orderedFollowUpIds?: string[];
            opts?: { serviceTier?: string | null };
          };
        });
      expect(String(followerActions.length)).toBe("4");
      expect(followerActions[0]?.action?.type).toBe("enqueueQueuedFollowUp");
      expect(followerActions[0]?.action?.threadId).toBe("thread-1");
      expect(followerActions[0]?.action?.prompt).toBe("first queued prompt");
      expect(followerActions[0]?.action?.opts?.serviceTier).toBe("fast");
      expect(followerActions[1]?.action?.type).toBe("removeQueuedFollowUp");
      expect(followerActions[1]?.action?.followUpId).toBe("follow-up-1");
      expect(followerActions[2]?.action?.type).toBe("reorderQueuedFollowUps");
      expect(followerActions[2]?.action?.orderedFollowUpIds?.join(",")).toBe("follow-up-2,follow-up-1");
      expect(followerActions[3]?.action?.type).toBe("sendQueuedFollowUpNow");
      expect(followerActions[3]?.action?.followUpId).toBe("follow-up-2");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:enqueue")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:remove")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:reorder")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:send-now")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower settings waits for owner-published settings revision before resolving", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = {
      model: "gpt-5.4-codex",
      reasoningEffort: "high",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.4-codex",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      },
      streamRevision: 2,
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    let resolved = false;
    let resolvedReasoningEffort = "";
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      const settingsPromise = manager.setThreadSettingsForConversation("thread-1", {
        reasoningEffort: "high",
        collaborationMode: "plan",
      }).then((settings) => {
        resolved = true;
        resolvedReasoningEffort = settings.reasoningEffort ?? "";
      });
      await flushAsyncWork();
      expect(resolved).toBeFalse();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            latestThreadSettings: {
              model: "gpt-5.4-codex",
              reasoningEffort: "high",
              collaborationMode: {
                mode: "plan",
                settings: {
                  model: "gpt-5.4-codex",
                  reasoning_effort: "high",
                  developer_instructions: null,
                },
              },
            },
            latestCollaborationMode: {
              mode: "plan",
              settings: {
                model: "gpt-5.4-codex",
                reasoning_effort: "high",
                developer_instructions: null,
              },
            },
          },
        },
        sourceClientId: "owner-a",
      });

      await settingsPromise;
      expect(resolved).toBeTrue();
      expect(resolvedReasoningEffort).toBe("high");
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower queued follow-up enqueue waits for owner revision before resolving", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = { streamRevision: 2 };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    let resolved = false;
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      const enqueuePromise = manager.enqueueQueuedFollowUp("thread-1", "Queue this").then(() => {
        resolved = true;
      });
      await flushAsyncWork();
      expect(resolved).toBeFalse();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            queuedFollowUps: [{
              followUpId: "follow-up-1",
              threadId: "thread-1",
              prompt: "Queue this",
              createdAt: 1,
              collaborationMode: null,
              serviceTier: null,
              pausedReason: null,
            }],
          },
        },
        sourceClientId: "owner-a",
      });

      await enqueuePromise;
      expect(resolved).toBeTrue();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("owner queued follow-up enqueue publishes visible state without legacy follow-up IPC", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = buildConversation("thread-1", "project-1");
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      await manager.enqueueQueuedFollowUp("thread-1", "  first queued prompt  ", { serviceTier: "fast" });

      const conversation = manager.readConversation("thread-1");
      const publishInput = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      )?.args[0] as {
        change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
      } | undefined;
      expect(String(conversation?.queuedFollowUps.length ?? -1)).toBe("1");
      expect(conversation?.queuedFollowUps[0]?.prompt).toBe("first queued prompt");
      expect(conversation?.queuedFollowUps[0]?.serviceTier).toBe("fast");
      expect(publishInput?.change?.type).toBe("snapshot");
      expect(String(publishInput?.change?.conversationState?.queuedFollowUps.length ?? -1)).toBe("1");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:enqueue")).toBeFalse();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner start turn publishes optimistic user row snapshot from bundle 49055-49112", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = {
      ...buildConversation("thread-1", "project-1"),
      turns: [],
    };
    ownerTurnStartResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const result = await manager.startTurn("thread-1", "Continue", { permissionMode: "auto" }) as {
        turnId?: string;
        streamRevision?: number;
      } | null;

      const publishInput = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      )?.args[0] as {
        change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
      } | undefined;
      const publishInputs = invokeRecords
        .filter((record) => record.channel === "codex:thread-owner:stream-state:publish")
        .map((record) => record.args[0] as {
          change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
        });
      const userItem = publishInput?.change?.conversationState?.turns[0]?.items[0];
      expect(result?.turnId).toBe("turn-owner-start");
      expect(result?.streamRevision).toBe(3);
      expect(publishInput?.change?.type).toBe("snapshot");
      expect(publishInput?.change?.revision).toBe(2);
      expect(userItem?.kind).toBe("userMessage");
      expect(userItem?.markdownText).toBe("Continue");
      expect(publishInputs[1]?.change?.revision).toBe(3);
      expect(publishInputs[1]?.change?.conversationState?.turns[0]?.turnId).toBe("turn-owner-start");
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("Continue");
      expect(invokeRecords.some((record) => record.channel === "codex:turn:start")).toBeFalse();
    } finally {
      resumeThreadResult = null;
      ownerTurnStartResult = null;
      manager.destroy();
    }
  });

  test("owner action handler returns stream revisions for owner-published mutations", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = {
      ...buildConversation("thread-1", "project-1"),
      threadGoal: {
        threadId: "thread-1",
        objective: "ship parity",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const enqueueResult = await manager.handleThreadOwnerActionRequest({
        type: "enqueueQueuedFollowUp",
        threadId: "thread-1",
        prompt: "Queue this",
      }) as { streamRevision?: number } | null;
      const clearGoalResult = await manager.handleThreadOwnerActionRequest({
        type: "clearThreadGoal",
        threadId: "thread-1",
      }) as { streamRevision?: number } | null;

      expect(enqueueResult?.streamRevision).toBe(2);
      expect(clearGoalResult?.streamRevision).toBe(3);
      expect(String(manager.readConversation("thread-1")?.queuedFollowUps.length ?? -1)).toBe("1");
      expect(manager.readConversation("thread-1")?.threadGoal).toBe(null);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner queued follow-up send-now publishes dequeue before facade turn start", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = {
      ...buildConversation("thread-1", "project-1"),
      queuedFollowUps: [{
        followUpId: "follow-up-1",
        threadId: "thread-1",
        prompt: "send this now",
        createdAt: 1,
        collaborationMode: null,
        serviceTier: null,
        pausedReason: null,
      }],
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      await manager.sendQueuedFollowUpNow("thread-1", "follow-up-1");

      const publishIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const startIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "turn/start"
      );
      const publishInput = invokeRecords[publishIndex]?.args[0] as {
        change?: { type?: string; conversationState?: CodexConversationSnapshot };
      } | undefined;
      expect(String(manager.readConversation("thread-1")?.queuedFollowUps.length ?? -1)).toBe("0");
      expect(publishIndex >= 0).toBeTrue();
      expect(startIndex > publishIndex).toBeTrue();
      expect(String(publishInput?.change?.conversationState?.queuedFollowUps.length ?? -1)).toBe("0");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:follow-up:send-now")).toBeFalse();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner steer publishes pending state around facade turn steer", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = {
      ...buildConversation("thread-1", "project-1"),
      statusType: "active",
      turns: [{
        threadId: "thread-1",
        turnId: "turn-active",
        status: "inProgress",
        itemIds: [],
        items: [],
      }],
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const result = await manager.steerTurn({
        threadId: "thread-1",
        prompt: "adjust the active turn",
      });

      const publishInputs = invokeRecords
        .filter((record) => record.channel === "codex:thread-owner:stream-state:publish")
        .map((record) => record.args[0] as {
          change?: { type?: string; conversationState?: CodexConversationSnapshot };
        });
      const steerIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "turn/steer"
      );
      const firstPublishIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      expect(result?.turnId).toBe("turn-active");
      expect(String(manager.readConversation("thread-1")?.pendingSteers.length ?? -1)).toBe("0");
      expect(String(publishInputs.length)).toBe("2");
      expect(String(publishInputs[0]?.change?.conversationState?.pendingSteers.length ?? -1)).toBe("1");
      expect(String(publishInputs[1]?.change?.conversationState?.pendingSteers.length ?? -1)).toBe("0");
      expect(firstPublishIndex >= 0).toBeTrue();
      expect(steerIndex > firstPublishIndex).toBeTrue();
      expect(invokeRecords.some((record) => record.channel === "codex:turn:steer")).toBeFalse();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("follower request responses route through owner from bundle 38687-38843", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = true;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            requests: [
              {
                type: "approval",
                requestId: "approval-1",
                kind: "command",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "cmd-1",
                createdAt: 1,
              },
              {
                type: "approval",
                requestId: "file-approval-1",
                kind: "file",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "file-1",
                createdAt: 2,
              },
              {
                type: "userInput",
                requestId: "input-1",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "user-input-response-input-1",
                questions: [{
                  id: "q1",
                  header: "Question",
                  question: "Pick one",
                  isOther: false,
                  isSecret: false,
                }],
                createdAt: 3,
              },
              {
                type: "mcpServerElicitation",
                requestId: "mcp-1",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "mcp-server-elicitation-mcp-1",
                kind: "generic",
                mode: "form",
                serverName: "server",
                message: "Confirm",
                createdAt: 4,
              },
              {
                type: "permissionRequest",
                requestId: "permission-1",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "permission-request-permission-1",
                cwd: "/repo",
                reason: "Need access",
                permissions: {
                  network: {
                    enabled: true,
                  },
                  fileSystem: null,
                },
                response: null,
                completed: false,
                createdAt: 5,
              },
            ],
          },
        },
        sourceClientId: "owner-a",
      });

      const approvalAccepted = await manager.respondApproval("approval-1", "decline");
      const fileApprovalAccepted = await manager.respondApproval("file-approval-1", "decline");
      const inputAccepted = await manager.respondUserInput("input-1", { q1: ["A"] });
      const mcpAccepted = await manager.respondMcpElicitation("mcp-1", "decline");
      const permissionAccepted = await manager.respondPermissionRequest("permission-1", {
        permissions: {},
        scope: "turn",
      });

      const followerActions = invokeRecords
        .filter((record) => record.channel === "codex:thread-follower:action")
        .map((record) => record.args[0] as {
          action?: {
            type?: string;
            requestId?: string;
            decision?: string;
            answers?: Record<string, string[]>;
            action?: string;
            response?: { scope?: string };
          };
      });
      expect(approvalAccepted).toBeTrue();
      expect(fileApprovalAccepted).toBeTrue();
      expect(inputAccepted).toBeTrue();
      expect(mcpAccepted).toBeTrue();
      expect(permissionAccepted).toBeTrue();
      expect(String(followerActions.length)).toBe("5");
      expect(followerActions[0]?.action?.type).toBe("respondApproval");
      expect(followerActions[0]?.action?.requestId).toBe("approval-1");
      expect(followerActions[0]?.action?.decision).toBe("decline");
      expect(followerActions[1]?.action?.type).toBe("respondApproval");
      expect(followerActions[1]?.action?.requestId).toBe("file-approval-1");
      expect(followerActions[1]?.action?.decision).toBe("decline");
      expect(followerActions[2]?.action?.type).toBe("respondUserInput");
      expect(followerActions[2]?.action?.requestId).toBe("input-1");
      expect(followerActions[2]?.action?.answers?.q1?.[0]).toBe("A");
      expect(followerActions[3]?.action?.type).toBe("respondMcpElicitation");
      expect(followerActions[3]?.action?.requestId).toBe("mcp-1");
      expect(followerActions[3]?.action?.action).toBe("decline");
      expect(followerActions[4]?.action?.type).toBe("respondPermissionRequest");
      expect(followerActions[4]?.action?.requestId).toBe("permission-1");
      expect(followerActions[4]?.action?.response?.scope).toBe("turn");
      expect(invokeRecords.some((record) => record.channel === "codex:approval:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:user-input:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:mcp-elicitation:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:permission-request:respond")).toBeFalse();
      expect(String(manager.readConversation("thread-1")?.requests.length ?? -1)).toBe("5");
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("stale follower request responses route by explicit conversation id before local request lookup", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = true;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            requests: [],
          },
        },
        sourceClientId: "owner-a",
      });

      const approvalAccepted = await manager.respondApproval("approval-missed", "decline", "thread-1");
      const inputAccepted = await manager.respondUserInput("input-missed", { q1: ["A"] }, "thread-1");
      const mcpAccepted = await manager.respondMcpElicitation("mcp-missed", "decline", "thread-1");
      const permissionAccepted = await manager.respondPermissionRequest("permission-missed", {
        permissions: {},
        scope: "turn",
      }, "thread-1");

      const followerActions = invokeRecords
        .filter((record) => record.channel === "codex:thread-follower:action")
        .map((record) => record.args[0] as {
          conversationId?: string;
          action?: {
            type?: string;
            requestId?: string;
            decision?: string;
            answers?: Record<string, string[]>;
            action?: string;
            response?: { scope?: string };
          };
        });

      expect(approvalAccepted).toBeTrue();
      expect(inputAccepted).toBeTrue();
      expect(mcpAccepted).toBeTrue();
      expect(permissionAccepted).toBeTrue();
      expect(String(followerActions.length)).toBe("4");
      expect(followerActions[0]?.conversationId).toBe("thread-1");
      expect(followerActions[0]?.action?.type).toBe("respondApproval");
      expect(followerActions[0]?.action?.requestId).toBe("approval-missed");
      expect(followerActions[0]?.action?.decision).toBe("decline");
      expect(followerActions[1]?.action?.type).toBe("respondUserInput");
      expect(followerActions[1]?.action?.requestId).toBe("input-missed");
      expect(followerActions[1]?.action?.answers?.q1?.[0]).toBe("A");
      expect(followerActions[2]?.action?.type).toBe("respondMcpElicitation");
      expect(followerActions[2]?.action?.requestId).toBe("mcp-missed");
      expect(followerActions[2]?.action?.action).toBe("decline");
      expect(followerActions[3]?.action?.type).toBe("respondPermissionRequest");
      expect(followerActions[3]?.action?.requestId).toBe("permission-missed");
      expect(followerActions[3]?.action?.response?.scope).toBe("turn");
      expect(invokeRecords.some((record) => record.channel === "codex:approval:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:user-input:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:mcp-elicitation:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:permission-request:respond")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower request response owner-unavailable path does not direct fallback from bundle 38687-38843 and 47201-47228", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    followerActionError = new Error("no-client-found: thread stream owner disconnected");
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            resumeState: "resumed",
            requests: [
              {
                type: "approval",
                requestId: "approval-1",
                kind: "command",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "cmd-1",
                createdAt: 1,
              },
              {
                type: "userInput",
                requestId: "input-1",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "user-input-response-input-1",
                questions: [{
                  id: "q1",
                  header: "Question",
                  question: "Pick one",
                  isOther: false,
                  isSecret: false,
                }],
                createdAt: 2,
              },
              {
                type: "mcpServerElicitation",
                requestId: "mcp-1",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "mcp-server-elicitation-mcp-1",
                kind: "generic",
                mode: "form",
                serverName: "server",
                message: "Confirm",
                createdAt: 3,
              },
              {
                type: "permissionRequest",
                requestId: "permission-1",
                projectId: "project-1",
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "permission-request-permission-1",
                cwd: "/repo",
                reason: "Need access",
                permissions: {
                  network: {
                    enabled: true,
                  },
                  fileSystem: null,
                },
                response: null,
                completed: false,
                createdAt: 4,
              },
            ],
          },
        },
        sourceClientId: "owner-a",
      });

      const approvalAccepted = await manager.respondApproval("approval-1", "decline", "thread-1");
      const inputAccepted = await manager.respondUserInput("input-1", { q1: ["A"] }, "thread-1");
      const mcpAccepted = await manager.respondMcpElicitation("mcp-1", "decline", "thread-1");
      const permissionAccepted = await manager.respondPermissionRequest("permission-1", {
        permissions: {},
        scope: "turn",
      }, "thread-1");

      expect(approvalAccepted).toBeFalse();
      expect(inputAccepted).toBeFalse();
      expect(mcpAccepted).toBeFalse();
      expect(permissionAccepted).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-follower:action")).toBeTrue();
      expect(invokeRecords.some((record) => record.channel === "codex:approval:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:user-input:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:mcp-elicitation:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:permission-request:respond")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:resume:request")).toBeFalse();
      expect(manager.readConversation("thread-1")?.resumeState).toBe("needs_resume");
      expect(String(manager.readConversation("thread-1")?.requests.length ?? -1)).toBe("4");
    } finally {
      followerActionError = null;
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("owner file approval and MCP elicitation requests publish request-plane patches from bundle 51926-52180", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 1,
        request: {
          id: "file-approval-1",
          method: "item/fileChange/requestApproval",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "file-change-1",
            startedAtMs: 11,
            reason: "Need write access",
            grantRoot: "/repo",
          },
        },
      });
      dispatchCodexAppServerMessage("thread-owner-request", {
        hostId: "default",
        sequence: 2,
        request: {
          id: "mcp-1",
          method: "mcpServer/elicitation/request",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            mode: "openai/form",
            serverName: "Context7",
            message: "Allow this call?",
            requestedSchema: { type: "object" },
            _meta: null,
          },
        },
      });
      await flushAsyncWork();

      const conversation = manager.readConversation("thread-1");
      const mcpItem = conversation?.turns[0]?.items.find((item) => item.itemId === "mcp-server-elicitation-mcp-1");
      const publishRecords = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );

      expect(String(conversation?.requests.length ?? -1)).toBe("2");
      expect(conversation?.requests[0]?.type).toBe("approval");
      expect(conversation?.requests[0]?.requestId).toBe("file-approval-1");
      expect(conversation?.requests[1]?.type).toBe("mcpServerElicitation");
      expect(conversation?.requests[1]?.requestId).toBe("mcp-1");
      expect(mcpItem?.semanticKind).toBe("mcpServerElicitation");
      expect(mcpItem?.status).toBe("inProgress");
      expect(mcpItem?.markdownText).toBe("Allow this call?");
      expect(String(publishRecords.length)).toBe("2");
      expect(
        (publishRecords[publishRecords.length - 1]?.args[0] as { ownerNotificationSequence?: number } | undefined)
          ?.ownerNotificationSequence,
      ).toBe(2);
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("follower plan implementation removal routes through owner from bundle 9700-9760", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = true;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            turns: [{
              threadId: "thread-1",
              turnId: "turn-plan",
              status: "completed",
              itemIds: ["implement-plan:turn-plan"],
              items: [{
                threadId: "thread-1",
                turnId: "turn-plan",
                itemId: "implement-plan:turn-plan",
                type: "planImplementation",
                kind: "planImplementation",
                semanticKind: "planImplementation",
                status: "inProgress",
                markdownText: "1. Ship the fix",
                rawItem: {
                  id: "implement-plan:turn-plan",
                  type: "planImplementation",
                  turnId: "turn-plan",
                  planContent: "1. Ship the fix",
                  isCompleted: false,
                },
                createdAt: 1,
                updatedAt: 1,
              }],
            }],
            requests: [{
              type: "implementPlan",
              requestId: "implement-plan:turn-plan",
              projectId: "project-1",
              threadId: "thread-1",
              turnId: "turn-plan",
              itemId: "implement-plan:turn-plan",
              planContent: "1. Ship the fix",
              createdAt: 1,
            }],
          },
        },
        sourceClientId: "owner-a",
      });

      const accepted = await manager.removePlanImplementationRequest("thread-1", "turn-plan");
      const followerAction = invokeRecords.find((record) =>
        record.channel === "codex:thread-follower:action"
      )?.args[0] as {
        conversationId?: string;
        action?: { type?: string; threadId?: string; turnId?: string };
      } | undefined;

      expect(accepted).toBeTrue();
      expect(followerAction?.conversationId).toBe("thread-1");
      expect(followerAction?.action?.type).toBe("removePlanImplementationRequest");
      expect(followerAction?.action?.threadId).toBe("thread-1");
      expect(followerAction?.action?.turnId).toBe("turn-plan");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:plan-implementation:remove"
      )).toBeFalse();
      expect(String(manager.readConversation("thread-1")?.requests.length ?? -1)).toBe("1");
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower plan implementation removal waits for owner revision and returns accepted", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = { accepted: true, streamRevision: 2 };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    let resolved = false;
    let accepted = false;
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      const removePromise = manager.removePlanImplementationRequest("thread-1", "turn-plan")
        .then((result) => {
          resolved = true;
          accepted = result;
        });
      await flushAsyncWork();
      expect(resolved).toBeFalse();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      await removePromise;
      expect(resolved).toBeTrue();
      expect(accepted).toBeTrue();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("owner plan implementation removal completes item before main sync from bundle 45740-45805", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      resumeThreadResult = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-plan",
          status: "completed",
          itemIds: ["implement-plan:turn-plan"],
          items: [{
            threadId: "thread-1",
            turnId: "turn-plan",
            itemId: "implement-plan:turn-plan",
            type: "planImplementation",
            kind: "planImplementation",
            semanticKind: "planImplementation",
            status: "inProgress",
            markdownText: "1. Ship the fix",
            rawItem: {
              id: "implement-plan:turn-plan",
              type: "planImplementation",
              turnId: "turn-plan",
              planContent: "1. Ship the fix",
              isCompleted: false,
            },
            createdAt: 1,
            updatedAt: 1,
          }],
        }],
        requests: [{
          type: "implementPlan",
          requestId: "implement-plan:turn-plan",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-plan",
          itemId: "implement-plan:turn-plan",
          planContent: "1. Ship the fix",
          createdAt: 1,
        }],
      };
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const result = await manager.handleThreadOwnerActionRequest({
        type: "removePlanImplementationRequest",
        threadId: "thread-1",
        turnId: "turn-plan",
      }) as { accepted?: boolean; streamRevision?: number } | null;
      const conversation = manager.readConversation("thread-1");
      const item = conversation?.turns[0]?.items[0];
      const publishIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const mainSyncIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread:plan-implementation:remove"
      );

      expect(result?.accepted).toBeTrue();
      expect(result?.streamRevision).toBe(2);
      expect(String(conversation?.requests.length ?? -1)).toBe("0");
      expect(item?.status).toBe("completed");
      expect(JSON.stringify(item?.rawItem)).toBe(JSON.stringify({
        id: "implement-plan:turn-plan",
        type: "planImplementation",
        turnId: "turn-plan",
        planContent: "1. Ship the fix",
        isCompleted: true,
      }));
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:plan-implementation:remove"
      )).toBeTrue();
      expect(publishIndex >= 0).toBeTrue();
      expect(mainSyncIndex > publishIndex).toBeTrue();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-follower:action")).toBeFalse();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("follower actions fall back to local owner path after no-client-found recovery", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    followerActionError = new Error("no-client-found: thread stream owner disconnected");
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "completed",
          itemIds: [],
          items: [],
        }],
      };
      resumeThreadResult = baseConversation;
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: "owner-a",
      });

      await manager.startTurn("thread-1", "Continue", { permissionMode: "auto" });

      const channels = invokeRecords.map((record) => record.channel).join(",");
      expect(channels.includes("codex:thread-follower:action")).toBeTrue();
      expect(channels.includes("codex:thread:resume:request")).toBeTrue();
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "turn/start"
      )).toBeTrue();
      expect(channels.includes("codex:turn:start")).toBeFalse();
      expect(manager.getThreadRoleForRendererClientRequest("thread-1")).toBe("owner");
    } finally {
      followerActionError = null;
      followerActionResult = null;
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("marks follower conversations needs_resume when the renderer owner is unavailable", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "working")],
        }],
      };
      const staleOwnerConversation: CodexConversationSnapshot = {
        ...baseConversation,
        turns: [{
          ...baseConversation.turns[0]!,
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "stale owner")],
        }],
      };

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: "owner-a",
      });
      dispatchCodexAppServerMessage("thread-owner-unavailable", {
        hostId: "default",
        ownerClientId: "owner-a",
        conversationIds: ["thread-1"],
      });
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(baseConversation, staleOwnerConversation),
        },
        sourceClientId: "owner-a",
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.resumeState).toBe("needs_resume");
      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.markdownText).toBe("working");
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread:snapshot:request" &&
        record.args[0] === "thread-1"
      )).toBeFalse();
    } finally {
      manager.destroy();
    }
  });

  test("owner renderer-client action requests execute direct owner actions", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["assistant-1"],
          items: [buildAssistantMessage("thread-1", "turn-1", "assistant-1", "working")],
        }],
      };
      resumeThreadResult = baseConversation;
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const result = await manager.handleThreadOwnerActionRequest({
        type: "interruptTurn",
        threadId: "thread-1",
        turnId: "turn-1",
      });

      expect(result).toBeTrue();
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "turn/interrupt"
      )).toBeTrue();
      expect(invokeRecords.some((record) => record.channel === "codex:turn:interrupt")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-follower:action")).toBeFalse();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("renderer client request bridge answers thread-role from current stream state", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = {
      ...buildConversation("thread-1", "project-1"),
      turns: [{
        threadId: "thread-1",
        turnId: "turn-1",
        status: "inProgress",
        itemIds: [],
        items: [],
      }],
    };
    const {
      LocalConversationProvider,
      useDefaultCodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    let manager: {
      requestThreadStreamResume: (threadId: string) => Promise<CodexConversationSnapshot | null>;
    } | null = null;
    function Probe() {
      manager = useDefaultCodexAppServerManager();
      return createElement("div");
    }

    render(createElement(LocalConversationProvider, null, createElement(Probe)));
    await settleAsyncRender();
    if (!manager) throw new Error("Expected manager");

    await act(async () => {
      await manager?.requestThreadStreamResume("thread-1");
    });

    await act(async () => {
      rendererClientRequestListener?.({
        requestId: "role-1",
        method: "thread-role",
        params: {
          conversationId: "thread-1",
        },
      });
      await flushAsyncWork();
    });

    const responseRecord = invokeRecords.find((record) =>
      record.channel === "codex:renderer-client:response"
    );
    const response = responseRecord?.args[0] as { type?: string; requestId?: string; result?: unknown } | undefined;
    expect(response?.type).toBe("success");
    expect(response?.requestId).toBe("role-1");
    expect(response?.result).toBe("owner");
    resumeThreadResult = null;
  });

  test("owner complete-history action publishes snapshot revision from bundle 49659-49675", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    completeThreadTurnsResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-latest",
          status: "completed",
          itemIds: [],
          items: [],
        }],
      };
      const completeConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: [],
            items: [],
          },
          partialConversation.turns[0]!,
        ],
      };
      resumeThreadResult = partialConversation;
      completeThreadTurnsResult = completeConversation;
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const result = await manager.handleThreadOwnerActionRequest({
        type: "loadCompleteHistory",
        threadId: "thread-1",
      }) as { revision?: number };
      const publishRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishPayload = publishRecord?.args[0] as {
        conversationId?: string;
        change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
      } | undefined;

      expect(result.revision).toBe(2);
      expect(invokeRecords.some((record) => record.channel === "codex:thread:turns:load-complete")).toBeTrue();
      expect(Boolean(publishRecord)).toBeTrue();
      expect(publishPayload?.conversationId).toBe("thread-1");
      expect(publishPayload?.change?.type).toBe("snapshot");
      expect(publishPayload?.change?.revision).toBe(2);
      expect(publishPayload?.change?.conversationState?.turns[0]?.turnId).toBe("turn-older");
      expect(manager.readConversation("thread-1")?.turns[0]?.turnId).toBe("turn-older");
    } finally {
      resumeThreadResult = null;
      completeThreadTurnsResult = null;
      manager.destroy();
    }
  });

  test("follower older-turn loads wait for owner complete-history revision", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = { revision: 2 };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-latest",
          status: "completed",
          itemIds: [],
          items: [],
        }],
      };
      const completeConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: [],
            items: [],
          },
          partialConversation.turns[0]!,
        ],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: partialConversation,
        },
        sourceClientId: "owner-a",
      });

      const loadPromise = manager.requestThreadOlderTurns("thread-1");
      await flushAsyncWork();
      const followerRecord = invokeRecords.find((record) => record.channel === "codex:thread-follower:action");
      const followerPayload = followerRecord?.args[0] as {
        action?: { type?: string; threadId?: string };
      } | undefined;
      expect(Boolean(followerRecord)).toBeTrue();
      expect(followerPayload?.action?.type).toBe("loadCompleteHistory");
      expect(followerPayload?.action?.threadId).toBe("thread-1");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:turns:load-older")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:turns:load-complete")).toBeFalse();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: completeConversation,
        },
        sourceClientId: "owner-a",
      });

      const loaded = await loadPromise;
      expect(String(loaded?.turns.length ?? -1)).toBe("2");
      expect(loaded?.turns[0]?.turnId).toBe("turn-older");
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower edit waits for owner complete-history before edit action from bundle 47940-47975", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = { revision: 2 };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-latest",
          status: "completed",
          itemIds: [],
          items: [],
        }],
      };
      const completeConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: [],
            items: [],
          },
          partialConversation.turns[0]!,
        ],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: partialConversation,
        },
        sourceClientId: "owner-a",
      });

      const editPromise = manager.editLastUserTurn("thread-1", "turn-older", "Rewrite older prompt");
      await flushAsyncWork();

      let followerRecords = invokeRecords.filter((record) => record.channel === "codex:thread-follower:action");
      const firstPayload = followerRecords[0]?.args[0] as { action?: { type?: string } } | undefined;
      expect(String(followerRecords.length)).toBe("1");
      expect(firstPayload?.action?.type).toBe("loadCompleteHistory");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:edit-last-user-turn")).toBeFalse();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: completeConversation,
        },
        sourceClientId: "owner-a",
      });

      await editPromise;
      followerRecords = invokeRecords.filter((record) => record.channel === "codex:thread-follower:action");
      const editPayload = followerRecords[1]?.args[0] as {
        action?: { type?: string; threadId?: string; turnId?: string; message?: string };
      } | undefined;
      expect(String(followerRecords.length)).toBe("2");
      expect(editPayload?.action?.type).toBe("editLastUserTurn");
      expect(editPayload?.action?.threadId).toBe("thread-1");
      expect(editPayload?.action?.turnId).toBe("turn-older");
      expect(editPayload?.action?.message).toBe("Rewrite older prompt");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:edit-last-user-turn")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower edit waits for owner replacement start revision before resolving", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = {
      revision: 2,
      threadId: "thread-1",
      composerIntent: { prompt: "Rewrite latest prompt", focusNonce: 1 },
      streamRevision: 3,
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    let resolved = false;
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-latest",
          status: "completed",
          itemIds: ["user-latest"],
          items: [buildUserMessage("thread-1", "turn-latest", "user-latest", "Latest prompt")],
        }],
      };
      const rollbackConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [],
      };
      const replacementConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [{
          threadId: "thread-1",
          turnId: "turn-replacement",
          status: "inProgress",
          itemIds: ["user-replacement"],
          items: [buildUserMessage("thread-1", "turn-replacement", "user-replacement", "Rewrite latest prompt")],
        }],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: rollbackConversation,
        },
        sourceClientId: "owner-a",
      });

      const editPromise = manager.editLastUserTurn("thread-1", "turn-latest", "Rewrite latest prompt")
        .then(() => {
          resolved = true;
        });
      await flushAsyncWork();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: partialConversation,
        },
        sourceClientId: "owner-a",
      });
      await flushAsyncWork();
      expect(resolved).toBeFalse();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 3,
        change: {
          type: "snapshot",
          revision: 3,
          conversationState: replacementConversation,
        },
        sourceClientId: "owner-a",
      });
      await editPromise;
      expect(resolved).toBeTrue();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower fork waits for owner complete-history before fork action from bundle 48049-48055", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = { revision: 2 };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-latest",
          status: "completed",
          itemIds: [],
          items: [],
        }],
      };
      const completeConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: [],
            items: [],
          },
          partialConversation.turns[0]!,
        ],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: partialConversation,
        },
        sourceClientId: "owner-a",
      });

      const forkPromise = manager.forkConversationFromTurn("thread-1", "turn-older", "Continue from older turn");
      await flushAsyncWork();

      let followerRecords = invokeRecords.filter((record) => record.channel === "codex:thread-follower:action");
      const firstPayload = followerRecords[0]?.args[0] as { action?: { type?: string } } | undefined;
      expect(String(followerRecords.length)).toBe("1");
      expect(firstPayload?.action?.type).toBe("loadCompleteHistory");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:fork-from-turn")).toBeFalse();

      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: completeConversation,
        },
        sourceClientId: "owner-a",
      });

      await forkPromise;
      followerRecords = invokeRecords.filter((record) => record.channel === "codex:thread-follower:action");
      const forkPayload = followerRecords[1]?.args[0] as {
        action?: { type?: string; threadId?: string; turnId?: string; message?: string };
      } | undefined;
      expect(String(followerRecords.length)).toBe("2");
      expect(forkPayload?.action?.type).toBe("forkConversationFromTurn");
      expect(forkPayload?.action?.threadId).toBe("thread-1");
      expect(forkPayload?.action?.turnId).toBe("turn-older");
      expect(forkPayload?.action?.message).toBe("Continue from older turn");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:fork-from-turn")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("local fork without a stream role resumes owner before using the owner app-server facade", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      resumeThreadResult = {
        ...buildConversation("thread-1", "project-1"),
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: [],
            items: [],
          },
          {
            threadId: "thread-1",
            turnId: "turn-latest",
            status: "completed",
            itemIds: [],
            items: [],
          },
        ],
      };

      const result = await manager.forkConversationFromTurn("thread-1", "turn-older", "Continue from older turn");

      const resumeIndex = invokeRecords.findIndex((record) => record.channel === "codex:thread:resume:request");
      const forkIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "thread/fork"
      );
      const forkInput = invokeRecords[forkIndex]?.args[0] as {
        conversationId?: string;
        request?: {
          params?: {
            threadId?: string;
            turnId?: string;
            message?: string;
          };
        };
      } | undefined;

      expect(resumeIndex >= 0).toBeTrue();
      expect(forkIndex > resumeIndex).toBeTrue();
      expect(forkInput?.conversationId).toBe("thread-1");
      expect(forkInput?.request?.params?.threadId).toBe("thread-1");
      expect(forkInput?.request?.params?.turnId).toBe("turn-older");
      expect(forkInput?.request?.params?.message).toBe("Continue from older turn");
      expect(result.threadId).toBe("thread-forked");
      expect(Boolean(result.composerIntent)).toBeTrue();
      expect(result.composerIntent?.prompt).toBe("Continue from older turn");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:fork-from-turn")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-follower:action")).toBeFalse();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("follower thread goal set routes through owner action from bundle 64259-64271", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = {
      threadId: "thread-1",
      objective: "ship parity",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      const goal = await manager.setThreadGoal({
        threadId: "thread-1",
        objective: "ship parity",
      });
      const followerRecord = invokeRecords.find((record) => record.channel === "codex:thread-follower:action");
      const followerInput = followerRecord?.args[0] as {
        conversationId?: string;
        action?: { type?: string; threadId?: string; objective?: string };
      } | undefined;

      expect(goal?.status ?? "").toBe("active");
      expect(followerInput?.conversationId).toBe("thread-1");
      expect(followerInput?.action?.type).toBe("setThreadGoal");
      expect(followerInput?.action?.objective).toBe("ship parity");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:goal:set")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower thread goal clear routes through owner action from bundle 64259-64271", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      await manager.clearThreadGoal("thread-1");
      const followerRecord = invokeRecords.find((record) => record.channel === "codex:thread-follower:action");
      const followerInput = followerRecord?.args[0] as {
        conversationId?: string;
        action?: { type?: string; threadId?: string };
      } | undefined;

      expect(followerInput?.conversationId).toBe("thread-1");
      expect(followerInput?.action?.type).toBe("clearThreadGoal");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:goal:clear")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower thread memory mode set routes through owner action from bundle 64259-64271", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      await manager.setThreadMemoryMode({
        threadId: "thread-1",
        mode: "enabled",
      });
      const followerRecord = invokeRecords.find((record) => record.channel === "codex:thread-follower:action");
      const followerInput = followerRecord?.args[0] as {
        conversationId?: string;
        action?: { type?: string; threadId?: string; mode?: string };
      } | undefined;

      expect(followerInput?.conversationId).toBe("thread-1");
      expect(followerInput?.action?.type).toBe("setThreadMemoryMode");
      expect(followerInput?.action?.mode).toBe("enabled");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:memory-mode:set")).toBeFalse();
    } finally {
      followerActionResult = null;
      manager.destroy();
    }
  });

  test("follower background-terminal cleanup is rejected from bundle 50754-50825", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    followerActionResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: "owner-a",
      });

      let message = "";
      try {
        await manager.cleanBackgroundTerminals("thread-1");
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toBe("Please continue this conversation on the window where it was started.");
      expect(invokeRecords.some((record) => record.channel === "codex:thread:background-terminals:clean")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-follower:action")).toBeFalse();
    } finally {
      manager.destroy();
    }
  });

  test("owner background-terminal cleanup is owner-local silent from bundle 50754-50825", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = {
      ...buildConversation("thread-1", "project-1"),
      turns: [
        {
          threadId: "thread-1",
          turnId: "turn-background",
          status: "completed",
          itemIds: ["cmd-1"],
          items: [buildCommandExecutionItem("thread-1", "turn-background", "cmd-1")],
        },
        {
          threadId: "thread-1",
          turnId: "turn-latest",
          status: "completed",
          itemIds: [],
          items: [],
        },
      ],
      backgroundTerminalRows: [{
        id: "cmd-1",
        command: "bun test",
        cwd: null,
        processId: null,
        previewLine: null,
      }],
    };
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];
      const publishCountBefore = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      ).length;
      await manager.cleanBackgroundTerminals("thread-1");

      const conversation = manager.readConversation("thread-1");
      const publishCountAfter = invokeRecords.filter((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      ).length;
      expect(invokeRecords.some((record) => record.channel === "codex:thread:background-terminals:clean-silent")).toBeTrue();
      expect(invokeRecords.some((record) => record.channel === "codex:thread:background-terminals:clean")).toBeFalse();
      expect(invokeRecords.some((record) => record.channel === "codex:thread-follower:action")).toBeFalse();
      expect(publishCountAfter).toBe(publishCountBefore);
      expect(conversation?.backgroundTerminalRows.length ?? -1).toBe(0);
      expect(conversation?.turns[0]?.interruptedCommandExecutionItemIds?.[0]).toBe("cmd-1");
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner complete-history action publishes a target revision snapshot", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    completeThreadTurnsResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const partialConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-latest",
          status: "completed",
          itemIds: [],
          items: [],
        }],
      };
      const completeConversation: CodexConversationSnapshot = {
        ...partialConversation,
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: [],
            items: [],
          },
          partialConversation.turns[0]!,
        ],
      };
      resumeThreadResult = partialConversation;
      completeThreadTurnsResult = completeConversation;
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const result = await manager.handleThreadOwnerActionRequest({
        type: "loadCompleteHistory",
        threadId: "thread-1",
      }) as { revision?: number };

      const publishRecord = invokeRecords.find((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const publishInput = publishRecord?.args[0] as {
        change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
      } | undefined;
      expect(result.revision).toBe(2);
      expect(publishInput?.change?.type).toBe("snapshot");
      expect(publishInput?.change?.revision).toBe(2);
      expect(String(publishInput?.change?.conversationState?.turns.length ?? -1)).toBe("2");
    } finally {
      resumeThreadResult = null;
      completeThreadTurnsResult = null;
      manager.destroy();
    }
  });

  test("local edit without a stream role resumes owner before using the owner app-server facade", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    ownerEditRollbackResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const olderUser = buildUserMessage("thread-1", "turn-older", "user-older", "Older prompt");
      const latestUser = buildUserMessage("thread-1", "turn-latest", "user-latest", "Latest prompt");
      const currentConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: ["user-older"],
            items: [olderUser],
          },
          {
            threadId: "thread-1",
            turnId: "turn-latest",
            status: "completed",
            itemIds: ["user-latest"],
            items: [latestUser],
          },
        ],
      };
      const rollbackConversation: CodexConversationSnapshot = {
        ...currentConversation,
        turns: [currentConversation.turns[0]!],
      };
      resumeThreadResult = currentConversation;
      ownerEditRollbackResult = buildRollbackResponseFromConversation(rollbackConversation);

      const result = await manager.editLastUserTurn("thread-1", "turn-latest", "Rewrite latest prompt");

      const resumeIndex = invokeRecords.findIndex((record) => record.channel === "codex:thread:resume:request");
      const rollbackIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "thread/rollback"
      );
      const startIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "turn/start"
      );
      const publishInputs = invokeRecords
        .filter((record) => record.channel === "codex:thread-owner:stream-state:publish")
        .map((record) => record.args[0] as { change?: { type?: string; revision?: number } });

      expect(resumeIndex >= 0).toBeTrue();
      expect(rollbackIndex > resumeIndex).toBeTrue();
      expect(startIndex > rollbackIndex).toBeTrue();
      expect(String(publishInputs.length)).toBe("4");
      expect(publishInputs[0]?.change?.revision).toBe(1);
      expect(publishInputs[1]?.change?.revision).toBe(2);
      expect(publishInputs[2]?.change?.revision).toBe(3);
      expect(publishInputs[3]?.change?.revision).toBe(4);
      expect(result.streamRevision).toBe(4);
      expect(invokeRecords.some((record) => record.channel === "codex:thread:edit-last-user-turn")).toBeFalse();
      expect(manager.readConversation("thread-1")?.turns.at(-1)?.items[0]?.markdownText).toBe("Rewrite latest prompt");
    } finally {
      resumeThreadResult = null;
      ownerEditRollbackResult = null;
      manager.destroy();
    }
  });

  test("owner edit rolls back through owner snapshot before starting replacement turn", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    ownerEditRollbackResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const olderUser = buildUserMessage("thread-1", "turn-older", "user-older", "Older prompt");
      const latestUser = buildUserMessage("thread-1", "turn-latest", "user-latest", "Latest prompt");
      const currentConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-older",
            status: "completed",
            itemIds: ["user-older"],
            items: [olderUser],
          },
          {
            threadId: "thread-1",
            turnId: "turn-latest",
            status: "completed",
            itemIds: ["user-latest"],
            items: [latestUser],
          },
        ],
      };
      const rollbackConversation: CodexConversationSnapshot = {
        ...currentConversation,
        turns: [currentConversation.turns[0]!],
      };
      resumeThreadResult = currentConversation;
      ownerEditRollbackResult = buildRollbackResponseFromConversation(rollbackConversation);

      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const result = await manager.editLastUserTurn("thread-1", "turn-latest", "Rewrite latest prompt");

      const rollbackIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "thread/rollback"
      );
      const publishIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:stream-state:publish"
      );
      const startIndex = invokeRecords.findIndex((record) =>
        record.channel === "codex:thread-owner:app-server-request" &&
        (record.args[0] as { request?: { method?: string } }).request?.method === "turn/start"
      );
      const publishInputs = invokeRecords
        .filter((record) => record.channel === "codex:thread-owner:stream-state:publish")
        .map((record) => record.args[0] as {
          change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
        });
      const publishInput = publishInputs[0];
      const optimisticPublishInput = publishInputs[1];
      const rebindPublishInput = publishInputs[2];
      const replacementTurn = optimisticPublishInput?.change?.conversationState?.turns.at(-1);
      const replacementUser = replacementTurn?.items[0];
      const optimisticPublishRecordIndex = invokeRecords.findIndex((record) =>
        record.args[0] === optimisticPublishInput
      );
      const rebindPublishRecordIndex = invokeRecords.findIndex((record) =>
        record.args[0] === rebindPublishInput
      );
      const firstPublishRecordIndex = invokeRecords.findIndex((record) =>
        record.args[0] === publishInput
      );
      const publishInputForType = publishInput as {
        change?: { type?: string; revision?: number; conversationState?: CodexConversationSnapshot };
      } | undefined;
      expect(rollbackIndex >= 0).toBeTrue();
      expect(publishIndex > rollbackIndex).toBeTrue();
      expect(optimisticPublishRecordIndex > firstPublishRecordIndex).toBeTrue();
      expect(startIndex > optimisticPublishRecordIndex).toBeTrue();
      expect(rebindPublishRecordIndex > startIndex).toBeTrue();
      expect(result.streamRevision).toBe(4);
      expect(publishInputForType?.change?.type).toBe("snapshot");
      expect(publishInputForType?.change?.revision).toBe(2);
      expect(String(publishInputForType?.change?.conversationState?.turns.length ?? -1)).toBe("1");
      expect(optimisticPublishInput?.change?.type).toBe("snapshot");
      expect(optimisticPublishInput?.change?.revision).toBe(3);
      expect(String(optimisticPublishInput?.change?.conversationState?.turns.length ?? -1)).toBe("2");
      expect(rebindPublishInput?.change?.revision).toBe(4);
      expect(rebindPublishInput?.change?.conversationState?.turns.at(-1)?.turnId).toBe("turn-owner-start");
      expect(replacementUser?.markdownText).toBe("Rewrite latest prompt");
      expect(manager.readConversation("thread-1")?.turns.length ?? -1).toBe(2);
      expect(invokeRecords.some((record) => record.channel === "codex:thread:edit-last-user-turn")).toBeFalse();
      expect(invokeRecords.some((record) =>
        record.channel === "codex:thread-owner:edit-last-user-turn:rollback"
      )).toBeFalse();
    } finally {
      resumeThreadResult = null;
      ownerEditRollbackResult = null;
      manager.destroy();
    }
  });

  test("owner plan implementation removal remains in follower stream before subsequent prose patch", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const browserWindow = globalThis.window as (Window & {
      requestAnimationFrame?: Window["requestAnimationFrame"];
      cancelAnimationFrame?: Window["cancelAnimationFrame"];
    }) | undefined;
    const previousRequestAnimationFrame = browserWindow?.requestAnimationFrame;
    const previousCancelAnimationFrame = browserWindow?.cancelAnimationFrame;
    const previousVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const animationFrameCallbacks: FrameRequestCallback[] = [];
    if (browserWindow) {
      browserWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }) as Window["requestAnimationFrame"];
      browserWindow.cancelAnimationFrame = (() => {}) as Window["cancelAnimationFrame"];
    }
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });

    const manager = new CodexAppServerManager("default");
    try {
      resumeThreadResult = {
        ...buildConversation("thread-1", "project-1"),
        turns: [
          {
            threadId: "thread-1",
            turnId: "turn-plan",
            status: "completed",
            itemIds: ["implement-plan:turn-plan"],
            items: [{
              threadId: "thread-1",
              turnId: "turn-plan",
              itemId: "implement-plan:turn-plan",
              type: "planImplementation",
              kind: "planImplementation",
              semanticKind: "planImplementation",
              status: "inProgress",
              markdownText: "1. Ship the fix",
              rawItem: {
                id: "implement-plan:turn-plan",
                type: "planImplementation",
                turnId: "turn-plan",
                planContent: "1. Ship the fix",
                isCompleted: false,
              },
              createdAt: 1,
              updatedAt: 1,
            }],
          },
          {
            threadId: "thread-1",
            turnId: "turn-active",
            status: "inProgress",
            itemIds: ["assistant-active"],
            items: [{
              ...buildAssistantMessage("thread-1", "turn-active", "assistant-active", ""),
              status: "inProgress",
            }],
          },
        ],
        requests: [{
          type: "implementPlan",
          requestId: "implement-plan:turn-plan",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-plan",
          itemId: "implement-plan:turn-plan",
          planContent: "1. Ship the fix",
          createdAt: 1,
        }],
      };
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      const removalResult = await manager.handleThreadOwnerActionRequest({
        type: "removePlanImplementationRequest",
        threadId: "thread-1",
        turnId: "turn-plan",
      }) as { accepted?: boolean; streamRevision?: number } | null;

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/agentMessage/delta",
        sequence: 7,
        params: {
          threadId: "thread-1",
          turnId: "turn-active",
          itemId: "assistant-active",
          delta: "after removal",
        },
      });
      animationFrameCallbacks.shift()?.(16);
      await flushAsyncWork(2);

      const publishInputs = invokeRecords
        .filter((record) => record.channel === "codex:thread-owner:stream-state:publish")
        .map((record) => record.args[0] as {
          ownerNotificationSequence?: number;
          change?: { type?: string; baseRevision?: number; revision?: number };
        });
      const removalPublish = publishInputs[0];
      const prosePublish = publishInputs[1];
      const conversation = manager.readConversation("thread-1");
      const planItem = conversation?.turns[0]?.items[0];
      const assistantItem = conversation?.turns[1]?.items[0];

      expect(removalResult?.accepted).toBeTrue();
      expect(removalResult?.streamRevision).toBe(2);
      expect(removalPublish?.change?.type).toBe("snapshot");
      expect(removalPublish?.change?.revision).toBe(2);
      expect(prosePublish?.ownerNotificationSequence).toBe(7);
      expect(prosePublish?.change?.type).toBe("patches");
      expect(prosePublish?.change?.baseRevision).toBe(2);
      expect(prosePublish?.change?.revision).toBe(3);
      expect(String(conversation?.requests.length ?? -1)).toBe("0");
      expect(planItem?.status).toBe("completed");
      expect(assistantItem?.markdownText).toBe("after removal");
    } finally {
      if (browserWindow) {
        if (previousRequestAnimationFrame) {
          browserWindow.requestAnimationFrame = previousRequestAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "requestAnimationFrame");
        }
        if (previousCancelAnimationFrame) {
          browserWindow.cancelAnimationFrame = previousCancelAnimationFrame;
        } else {
          Reflect.deleteProperty(browserWindow, "cancelAnimationFrame");
        }
      }
      if (previousVisibilityDescriptor) {
        Object.defineProperty(document, "visibilityState", previousVisibilityDescriptor);
      }
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner item lifecycle merges synthetic and live edited user messages", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const syntheticUser = buildUserMessage("thread-1", "turn-new", "item-1", "Changed prompt");
      const currentConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-new",
          status: "inProgress",
          itemIds: ["item-1"],
          items: [syntheticUser],
        }],
      };
      resumeThreadResult = currentConversation;
      await manager.requestThreadStreamResume("thread-1");
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "item/completed",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turnId: "turn-new",
          item: {
            id: "user-real",
            type: "userMessage",
            content: [{ type: "text", text: "Changed prompt" }],
          },
        },
      });
      await flushAsyncWork();

      const turn = manager.readConversation("thread-1")?.turns[0];
      expect(String(turn?.items.length ?? -1)).toBe("1");
      expect(turn?.items[0]?.itemId).toBe("user-real");
      expect(turn?.items[0]?.markdownText).toBe("Changed prompt");
      expect(JSON.stringify(turn?.itemIds ?? [])).toBe(JSON.stringify(["user-real"]));
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("owner turn completion derives latest editable capability from local transcript", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    rendererClientRequestListener = null;
    threadListByProject = {};
    resumeThreadResult = null;
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const user = buildUserMessage("thread-1", "turn-1", "user-1", "Prompt");
      const currentConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        capabilityFlags: {
          canEditLastUserTurn: false,
          canForkFromTurn: true,
          canSearch: true,
          canCollapseTurns: true,
        },
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["user-1"],
          items: [user],
        }],
      };
      resumeThreadResult = currentConversation;
      await manager.requestThreadStreamResume("thread-1");
      expect(manager.readConversation("thread-1")?.capabilityFlags.canEditLastUserTurn).toBeFalse();
      invokeRecords = [];

      dispatchCodexAppServerMessage("thread-owner-notification", {
        hostId: "default",
        method: "turn/completed",
        sequence: 1,
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            status: "completed",
          },
        },
      });
      await flushAsyncWork();

      expect(manager.readConversation("thread-1")?.turns[0]?.status).toBe("completed");
      expect(manager.readConversation("thread-1")?.capabilityFlags.canEditLastUserTurn).toBeTrue();
    } finally {
      resumeThreadResult = null;
      manager.destroy();
    }
  });

  test("coalesces command output mcp notifications into renderer conversation state", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            turns: [{
              threadId: "thread-1",
              turnId: "turn-1",
              status: "inProgress",
              itemIds: ["cmd-1"],
              items: [buildCommandExecutionItem("thread-1", "turn-1", "cmd-1")],
            }],
          },
        },
        sourceClientId: null,
      });

      dispatchCodexAppServerMessage("mcp-notification", {
        hostId: "default",
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          delta: "1340 ",
        },
      });
      dispatchCodexAppServerMessage("mcp-notification", {
        hostId: "default",
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          delta: "pass\n",
        },
      });

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.aggregatedOutput ?? "missing").toBe("");
      await new Promise((resolve) => setTimeout(resolve, 70));

      const item = manager.readConversation("thread-1")?.turns[0]?.items[0];
      expect(item?.aggregatedOutput).toBe("1340 pass\n");
      expect(item?.toolCall?.result).toBe("1340 pass\n");
    } finally {
      manager.destroy();
    }
  });

  test("applies command output deltas only to the addressed conversation turn item", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      for (const threadId of ["thread-1", "thread-2"]) {
        dispatchCodexAppServerMessage("thread-stream-state-changed", {
          hostId: "default",
          conversationId: threadId,
          version: 1,
          change: {
            type: "snapshot",
            revision: 1,
            conversationState: {
              ...buildConversation(threadId, "project-1"),
              turns: [{
                threadId,
                turnId: "turn-1",
                status: "inProgress",
                itemIds: ["cmd-1"],
                items: [buildCommandExecutionItem(threadId, "turn-1", "cmd-1")],
              }],
            },
          },
          sourceClientId: null,
        });
      }

      dispatchCodexAppServerMessage("mcp-notification", {
        hostId: "default",
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thread-2",
          turnId: "turn-1",
          itemId: "cmd-1",
          delta: "target output\n",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.aggregatedOutput ?? "missing").toBe("");
      expect(manager.readConversation("thread-2")?.turns[0]?.items[0]?.aggregatedOutput).toBe("target output\n");
    } finally {
      manager.destroy();
    }
  });

  test("drops command output deltas for missing items", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            turns: [{
              threadId: "thread-1",
              turnId: "turn-1",
              status: "inProgress",
              itemIds: [],
              items: [],
            }],
          },
        },
        sourceClientId: null,
      });

      dispatchCodexAppServerMessage("mcp-notification", {
        hostId: "default",
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-missing",
          delta: "dropped\n",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(String(manager.readConversation("thread-1")?.turns[0]?.items.length ?? -1)).toBe("0");
    } finally {
      manager.destroy();
    }
  });

  test("flushes queued output before applying snapshots so output is not duplicated", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      const baseConversation: CodexConversationSnapshot = {
        ...buildConversation("thread-1", "project-1"),
        turns: [{
          threadId: "thread-1",
          turnId: "turn-1",
          status: "inProgress",
          itemIds: ["cmd-1"],
          items: [buildCommandExecutionItem("thread-1", "turn-1", "cmd-1")],
        }],
      };
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: baseConversation,
        },
        sourceClientId: null,
      });

      dispatchCodexAppServerMessage("mcp-notification", {
        hostId: "default",
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          delta: "single append\n",
        },
      });
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 2,
        change: {
          type: "snapshot",
          revision: 2,
          conversationState: {
            ...baseConversation,
            turns: [{
              ...baseConversation.turns[0]!,
              items: [buildCommandExecutionItem("thread-1", "turn-1", "cmd-1", "single append\n")],
            }],
          },
        },
        sourceClientId: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(manager.readConversation("thread-1")?.turns[0]?.items[0]?.aggregatedOutput).toBe("single append\n");
    } finally {
      manager.destroy();
    }
  });

  test("control-plane selectors update without a separate reducer store", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      useCodexPermissionMode,
      useCodexThreadStartProgress,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    function Probe() {
      const permissionMode = useCodexPermissionMode("project-1");
      const progress = useCodexThreadStartProgress("project-1", "session-1");
      return createElement(
        "div",
        null,
        `${permissionMode}:${progress?.phase ?? "none"}:${progress?.outputText ?? "empty"}`,
      );
    }

    const { container } = render(createElement(LocalConversationProvider, null, createElement(Probe)));
    await settleAsyncRender();
    expect(textContent(container)).toBe("custom:none:empty");

    await act(async () => {
      hostMessageListener?.({
        type: "sharedObjectUpdated",
        hostId: "default",
        object: {
          objectType: "threadStartProgress",
          objectId: "project-1:session-1",
          value: {
            projectId: "project-1",
            sessionId: "session-1",
            runInTarget: "newWorktree",
            threadId: "thread-1",
            phase: "runningSetup",
            message: "Running setup",
            outputDelta: "hello",
            updatedAt: 10,
          },
        },
      });
    });
    await settleAsyncRender();

    expect(textContent(container)).toBe("custom:runningSetup:hello");
  });

  test("project thread summary subscriptions lazily hydrate once per project", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {
      "project-1": [buildThreadSummary("thread-1", "project-1")],
    };
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      useProjectThreadSummaries,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    function Probe() {
      const summaries = useProjectThreadSummaries("project-1");
      return createElement("div", null, String(summaries.length));
    }

    const { container } = render(
      createElement(
        LocalConversationProvider,
        null,
        createElement("div", null, createElement(Probe), createElement(Probe)),
      ),
    );
    await settleAsyncRender();

    expect(textContent(container)).toBe("11");
    expect(String(invokeCalls.filter((call) => call === "codex:threads:list").length)).toBe("1");
  });

  test("normalizes incoming conversation snapshots before storing them", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      readLocalConversation,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    render(createElement(LocalConversationProvider, null, createElement("div")));
    await settleAsyncRender();

    await act(async () => {
      hostMessageListener?.({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("thread-1", "project-1"),
            threadName: undefined as unknown as string,
            threadPreview: undefined as unknown as string,
            pendingSteers: undefined as unknown as [],
            queuedFollowUps: undefined as unknown as [],
            backgroundTerminalRows: undefined as unknown as [],
            childMemberships: undefined as unknown as [],
            statusActiveFlags: undefined as unknown as [],
          },
        },
        version: 1,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    const conversation = readLocalConversation("thread-1");
    expect(conversation?.threadName ?? "missing").toBe("");
    expect(conversation?.threadPreview ?? "missing").toBe("");
    expect(String(conversation?.pendingSteers.length ?? -1)).toBe("0");
    expect(String(conversation?.queuedFollowUps.length ?? -1)).toBe("0");
    expect(String(conversation?.backgroundTerminalRows.length ?? -1)).toBe("0");
    expect(String(conversation?.childMemberships.length ?? -1)).toBe("0");
    expect(String(conversation?.statusActiveFlags.length ?? -1)).toBe("0");
  });

  test("keeps side chat snapshots cached without adding them to project thread summaries", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {
      "project-1": [],
    };
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      readLocalConversation,
      useProjectThreadSummaries,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    function Probe() {
      const summaries = useProjectThreadSummaries("project-1");
      return createElement("div", null, String(summaries.length));
    }

    const { container } = render(createElement(LocalConversationProvider, null, createElement(Probe)));
    await settleAsyncRender();

    await act(async () => {
      hostMessageListener?.({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "side-thread-1",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: {
            ...buildConversation("side-thread-1", "project-1"),
            source: {
              parentThreadId: "thread-parent",
              sideConversation: true,
              sideConversationParentNavigationPath: "project:project-1/session:session-1/thread:thread-parent",
            },
            ephemeral: true,
            capabilityFlags: {
              canEditLastUserTurn: false,
              canForkFromTurn: false,
              canSearch: true,
              canCollapseTurns: true,
            },
          },
        },
        version: 1,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    const conversation = readLocalConversation("side-thread-1");
    expect(conversation?.source?.sideConversation === true).toBeTrue();
    expect(conversation?.source?.sideConversationParentNavigationPath ?? "").toBe(
      "project:project-1/session:session-1/thread:thread-parent",
    );
    expect(conversation?.ephemeral === true).toBeTrue();
    expect(textContent(container)).toBe("0");
  });

  test("empty project thread results still count as hydrated", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {
      "project-empty": [],
    };
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      useProjectThreadSummaries,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    function Probe() {
      const summaries = useProjectThreadSummaries("project-empty");
      return createElement("div", null, String(summaries.length));
    }

    const { rerender } = render(
      createElement(LocalConversationProvider, null, createElement(Probe)),
    );
    await settleAsyncRender();
    rerender(createElement(LocalConversationProvider, null, createElement(Probe)));
    await settleAsyncRender();

    expect(String(invokeCalls.filter((call) => call === "codex:threads:list").length)).toBe("1");
  });

  test("drops cached conversation state when the host reports a deleted thread", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    const {
      dispatchCodexAppServerMessage,
    } = await import("./app-server-message-bus");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    try {
      manager.hydrateThreadSummaries("project-1", [buildThreadSummary("thread-1", "project-1")]);
      dispatchCodexAppServerMessage("thread-stream-state-changed", {
        hostId: "default",
        conversationId: "thread-1",
        version: 1,
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: buildConversation("thread-1", "project-1"),
        },
        sourceClientId: null,
      });

      expect(manager.readThreadSummary("thread-1")?.threadId).toBe("thread-1");
      expect(manager.readConversation("thread-1")?.threadId).toBe("thread-1");

      dispatchCodexAppServerMessage("thread-deleted", {
        hostId: "default",
        threadId: "thread-1",
      });

      expect(manager.readThreadSummary("thread-1")).toBe(null);
      expect(manager.readConversation("thread-1")).toBe(null);
      expect(JSON.stringify(manager.readProjectThreadSummaries("project-1"))).toBe(JSON.stringify([]));
    } finally {
      manager.destroy();
    }
  });

  test("emits notification events only for live updates and suppresses interrupted turns", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    threadListByProject = {};
    const {
      __resetLocalConversationStoreForTests,
      LocalConversationProvider,
      useDefaultCodexAppServerManager,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    let managerRef: NotificationTestManager | null = null;

    function Probe() {
      managerRef = useDefaultCodexAppServerManager();
      return createElement("div");
    }

    render(createElement(LocalConversationProvider, null, createElement(Probe)));
    await settleAsyncRender();

    expect(managerRef === null).toBeFalse();
    const manager = requireNotificationTestManager(managerRef);

    const completedTurns: Array<{ turnId: string; lastAgentMessage: string | null }> = [];
    const approvals: string[] = [];
    const questions: string[] = [];
    const stopTurnCompleted = manager.addTurnCompletedListener((payload: {
      conversationId: string;
      turnId: string;
      lastAgentMessage: string | null;
    }) => {
      completedTurns.push({
        turnId: payload.turnId,
        lastAgentMessage: payload.lastAgentMessage,
      });
    });
    const stopApprovals = manager.addApprovalRequestListener((payload: {
      conversationId: string;
      requestId: string;
      kind: "command" | "file";
      reason: string | null;
    }) => {
      approvals.push(payload.requestId);
    });
    const stopQuestions = manager.addUserInputRequestListener((payload: {
      conversationId: string;
      requestId: string;
      turnId: string;
      questionCount: number;
      firstQuestion: string | null;
    }) => {
      questions.push(payload.requestId);
    });

    const initialConversation: CodexConversationSnapshot = {
      ...buildConversation("thread-1", "project-1"),
      turns: [
        {
          threadId: "thread-1",
          turnId: "turn-1",
          status: "completed",
          itemIds: ["item-1"],
          items: [
            buildAssistantMessage("thread-1", "turn-1", "item-1", "Initial bootstrap response"),
          ],
        },
      ],
      requests: [
        {
          type: "approval",
          requestId: "approval-bootstrap",
          kind: "command",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-approval-bootstrap",
          createdAt: 1,
        },
        {
          type: "userInput",
          requestId: "question-bootstrap",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-question-bootstrap",
          createdAt: 1,
          questions: [
            {
              id: "q-bootstrap",
              header: "Input",
              question: "Need your input",
              isOther: false,
              isSecret: false,
            },
          ],
        },
      ],
    };

    await act(async () => {
      dispatchThreadSnapshot({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "snapshot",
          revision: 1,
          conversationState: initialConversation,
        },
        version: 1,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    expect(String(completedTurns.length)).toBe("0");
    expect(String(approvals.length)).toBe("0");
    expect(String(questions.length)).toBe("0");

    const liveInProgressConversation: CodexConversationSnapshot = {
      ...initialConversation,
      turns: [
        ...initialConversation.turns,
        {
          threadId: "thread-1",
          turnId: "turn-2",
          status: "inProgress",
          itemIds: ["item-2"],
          items: [
            buildAssistantMessage("thread-1", "turn-2", "item-2", "Working"),
          ],
        },
      ],
      requests: [],
    };

    await act(async () => {
      dispatchThreadSnapshot({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "patches",
          baseRevision: 1,
          revision: 2,
          patches: buildCodexConversationStateUpdates(initialConversation, liveInProgressConversation),
        },
        version: 2,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    const completedConversation: CodexConversationSnapshot = {
      ...liveInProgressConversation,
      turns: [
        initialConversation.turns[0]!,
        {
          ...liveInProgressConversation.turns[1]!,
          status: "completed",
          items: [
            buildAssistantMessage(
              "thread-1",
              "turn-2",
              "item-2",
              "::code-comment{title=\"One\" body=\"Issue\" file=\"/tmp/a.ts\"}",
            ),
          ],
        },
      ],
      requests: [
        {
          type: "approval",
          requestId: "approval-live",
          kind: "file",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-2",
          itemId: "item-approval-live",
          reason: "Approve the patch",
          createdAt: 2,
        },
        {
          type: "userInput",
          requestId: "question-live",
          projectId: "project-1",
          threadId: "thread-1",
          turnId: "turn-2",
          itemId: "item-question-live",
          createdAt: 2,
          questions: [
            {
              id: "q-live",
              header: "Confirm",
              question: "What should I do next?",
              isOther: false,
              isSecret: false,
            },
          ],
        },
      ],
    };

    await act(async () => {
      dispatchThreadSnapshot({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "patches",
          baseRevision: 2,
          revision: 3,
          patches: buildCodexConversationStateUpdates(liveInProgressConversation, completedConversation),
        },
        version: 3,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    expect(String(completedTurns.length)).toBe("1");
    expect(completedTurns[0]?.turnId).toBe("turn-2");
    expect(completedTurns[0]?.lastAgentMessage).toBe("::code-comment{title=\"One\" body=\"Issue\" file=\"/tmp/a.ts\"}");
    expect(String(approvals.length)).toBe("1");
    expect(approvals[0]).toBe("approval-live");
    expect(String(questions.length)).toBe("1");
    expect(questions[0]).toBe("question-live");

    await act(async () => {
      dispatchThreadSnapshot({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "snapshot",
          revision: 4,
          conversationState: completedConversation,
        },
        version: 4,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    expect(String(approvals.length)).toBe("1");
    expect(String(questions.length)).toBe("1");

    const interruptedBaseConversation: CodexConversationSnapshot = {
      ...completedConversation,
      turns: [
        ...completedConversation.turns,
        {
          threadId: "thread-1",
          turnId: "turn-3",
          status: "inProgress",
          itemIds: ["item-3"],
          items: [
            buildAssistantMessage("thread-1", "turn-3", "item-3", "Finishing up"),
          ],
        },
      ],
    };

    await act(async () => {
      dispatchThreadSnapshot({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "patches",
          baseRevision: 4,
          revision: 5,
          patches: buildCodexConversationStateUpdates(completedConversation, interruptedBaseConversation),
        },
        version: 5,
        sourceClientId: null,
      });
      await manager.interruptTurn("thread-1", "turn-3");
    });
    await settleAsyncRender();

    const interruptedTerminalConversation: CodexConversationSnapshot = {
      ...interruptedBaseConversation,
      turns: [
        interruptedBaseConversation.turns[0]!,
        interruptedBaseConversation.turns[1]!,
        {
          ...interruptedBaseConversation.turns[2]!,
          status: "failed",
        },
      ],
    };

    await act(async () => {
      dispatchThreadSnapshot({
        type: "threadStreamStateChanged",
        hostId: "default",
        conversationId: "thread-1",
        change: {
          type: "patches",
          baseRevision: 5,
          revision: 6,
          patches: buildCodexConversationStateUpdates(interruptedBaseConversation, interruptedTerminalConversation),
        },
        version: 6,
        sourceClientId: null,
      });
    });
    await settleAsyncRender();

    expect(String(completedTurns.length)).toBe("1");

    stopTurnCompleted();
    stopApprovals();
    stopQuestions();
  });
});
