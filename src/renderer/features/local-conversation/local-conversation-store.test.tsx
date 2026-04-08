import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act } from "@testing-library/react";
import type {
  CodexConnectionState,
  CodexConversationSnapshot,
  CodexHostMessage,
  CodexThreadSummary,
} from "../../lib/types";
import { buildCodexConversationStateUpdates } from "../../../shared/codex-conversation-patches";
import { render, settleAsyncRender, textContent } from "../../test/dom";

let invokeCalls: string[] = [];
let hostMessageListener: ((message: CodexHostMessage) => void) | null = null;
let threadListByProject: Record<string, CodexThreadSummary[]> = {};

mock.module("./local-conversation-deps", () => ({
  invoke: async (channel: string, threadId?: string) => {
    invokeCalls.push(channel);
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

    if (channel === "codex:threads:list" && typeof threadId === "string") {
      return threadListByProject[threadId] ?? [];
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
    cardId: `card-${threadId}`,
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

describe("local-conversation-store", () => {
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
      const progress = useCodexThreadStartProgress("project-1", "card-1");
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
          objectId: "project-1:card-1",
          value: {
            projectId: "project-1",
            cardId: "card-1",
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
});
