import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act } from "@testing-library/react";
import type {
  CodexConnectionState,
  CodexConversationSnapshot,
  CodexHostMessage,
  CodexThreadSummary,
} from "../../lib/types";
import { render, settleAsyncRender, textContent } from "../../test/dom";

let invokeCalls: string[] = [];
let hostMessageListener: ((message: CodexHostMessage) => void) | null = null;

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
    const {
      __resetLocalConversationStoreForTests,
      useLocalConversationAccount,
      useLocalConversationConnection,
    } = await import("./local-conversation-store");
    __resetLocalConversationStoreForTests();

    function Probe() {
      const account = useLocalConversationAccount();
      const connection = useLocalConversationConnection();
      const accountEmail = account?.account?.type === "chatgpt"
        ? account.account.email
        : "none";
      return createElement("div", null, `${connection.status}:${accountEmail}`);
    }

    const { container } = render(createElement(Probe));
    await settleAsyncRender();

    expect(invokeCalls.join(",")).toBe("codex:account:read,codex:connection:status");
    expect(textContent(container)).toBe("connected:dev@example.com");
  });

  test("conversation selectors stay isolated to the selected thread", async () => {
    invokeCalls = [];
    hostMessageListener = null;
    const {
      __resetLocalConversationStoreForTests,
      hydrateLocalConversationThreadSummaries,
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

    render(createElement("div", null, createElement(ConversationProbe), createElement(SummaryProbe)));
    await settleAsyncRender();

    conversationRenderCount = 0;
    summaryRenderCount = 0;

    await act(async () => {
      hostMessageListener?.({
        type: "conversationSnapshot",
        conversation: buildConversation("thread-2", "project-1"),
      });
    });

    expect(String(conversationRenderCount)).toBe("0");
    expect(String(summaryRenderCount)).toBe("0");

    await act(async () => {
      hostMessageListener?.({
        type: "conversationSnapshot",
        conversation: buildConversation("thread-1", "project-1"),
      });
    });

    expect(String(conversationRenderCount)).toBe("1");
    expect(String(summaryRenderCount)).toBe("0");
  });
});
