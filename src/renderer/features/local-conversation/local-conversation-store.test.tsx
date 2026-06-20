import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act } from "@testing-library/react";
import type {
  CodexConnectionState,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexHostMessage,
  CodexThreadSummary,
} from "../../lib/types";
import { buildCodexConversationStateUpdates } from "../../../shared/codex-conversation-patches";
import { render, settleAsyncRender, textContent } from "../../test/dom";

let invokeCalls: string[] = [];
let invokeRecords: Array<{ channel: string; args: unknown[] }> = [];
let hostMessageListener: ((message: CodexHostMessage) => void) | null = null;
let threadListByProject: Record<string, CodexThreadSummary[]> = {};
let startThreadForSessionResult: unknown = null;
let generatedThreadTitleResult: unknown = { title: null };
let generatedThreadTitleError: Error | null = null;

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

    if (channel === "codex:thread:snapshot:request" && threadId === "thread-child") {
      return buildConversation("thread-child", "project-1");
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

    if (channel === "codex:thread:title:generate") {
      if (generatedThreadTitleError) {
        throw generatedThreadTitleError;
      }
      return generatedThreadTitleResult;
    }

    if (channel === "codex:thread:name:set-generated" || channel === "codex:thread:name:set") {
      return true;
    }

    if (channel === "codex:turn:interrupt") {
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

function dispatchThreadSnapshot(message: CodexHostMessage): void {
  hostMessageListener?.(message);
}

describe("local-conversation-store", () => {
  test("auto-generates and persists a thread title through the generated-title path", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    generatedThreadTitleError = null;
    startThreadForSessionResult = {
      ...buildConversation("thread-auto", "project-1"),
      threadName: null,
      threadPreview: "Fallback preview",
      cwd: "/tmp/project-1",
    };
    generatedThreadTitleResult = { title: `  ${"x".repeat(72)}  ` };
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

    const generateCall = invokeRecords.find((record) => record.channel === "codex:thread:title:generate");
    const generateInput = generateCall?.args[0] as { prompt?: string; cwd?: string | null } | undefined;
    const persistCall = invokeRecords.find((record) => record.channel === "codex:thread:name:set-generated");
    const manualPersistCall = invokeRecords.find((record) => record.channel === "codex:thread:name:set");

    expect(generateInput?.prompt).toBe("Build title parity\n\nPasted requirements");
    expect(generateInput?.cwd).toBe("/tmp/project-1");
    expect(persistCall?.args[0]).toBe("thread-auto");
    expect(persistCall?.args[1]).toBe("x".repeat(72));
    expect(String(manualPersistCall)).toBe("undefined");
  });

  test("skips auto-title generation when requested", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    generatedThreadTitleError = null;
    startThreadForSessionResult = {
      ...buildConversation("thread-skip", "project-1"),
      threadName: null,
      threadPreview: "",
    };
    generatedThreadTitleResult = { title: "Generated title" };
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

    expect(invokeRecords.some((record) => record.channel === "codex:thread:title:generate")).toBeFalse();
  });

  test("keeps a manual title when generation returns after rename", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    generatedThreadTitleError = null;
    startThreadForSessionResult = {
      ...buildConversation("thread-race", "project-1"),
      threadName: null,
      threadPreview: "",
    };
    let resolveGeneratedTitle!: (value: { title: string | null }) => void;
    generatedThreadTitleResult = new Promise<{ title: string | null }>((resolve) => {
      resolveGeneratedTitle = resolve;
    });
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
    });
    await settleAsyncRender();
    await manager.setThreadName("thread-race", "Manual title", "project-1");
    resolveGeneratedTitle({ title: "Generated title" });
    await settleAsyncRender();

    expect(invokeRecords.some((record) => record.channel === "codex:thread:name:set-generated")).toBeFalse();
    const manualCall = invokeRecords.find((record) => record.channel === "codex:thread:name:set");
    expect(manualCall?.args[1]).toBe("Manual title");
  });

  test("does not surface a host error when auto-title generation fails", async () => {
    invokeCalls = [];
    invokeRecords = [];
    hostMessageListener = null;
    threadListByProject = {};
    startThreadForSessionResult = {
      ...buildConversation("thread-title-failure", "project-1"),
      threadName: null,
      threadPreview: "",
    };
    generatedThreadTitleResult = { title: null };
    generatedThreadTitleError = new Error("boom");
    const {
      CodexAppServerManager,
      __resetLocalConversationStoreForTests,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    const manager = new CodexAppServerManager("default");
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      await manager.startThreadForSession({
        projectId: "project-1",
        sessionId: "session-1",
        prompt: "Build title parity",
      });
      await settleAsyncRender();

      expect(manager.readLastHostError()).toBe(null);
      expect(invokeRecords.some((record) => record.channel === "codex:thread:name:set-generated")).toBeFalse();
    } finally {
      console.warn = originalWarn;
      generatedThreadTitleError = null;
    }
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
