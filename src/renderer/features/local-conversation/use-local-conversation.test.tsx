import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { render, settleAsyncRender, textContent } from "../../test/dom";

const invokeCalls: string[] = [];
let accountBootstrapCompleted = false;

mock.module("./use-local-conversation-deps", () => ({
  invoke: async (channel: string) => {
    invokeCalls.push(channel);
    if (channel === "codex:connection:status") {
      return {
        status: accountBootstrapCompleted ? "connected" : "starting",
        retries: 0,
      };
    }

    if (channel === "codex:account:read") {
      accountBootstrapCompleted = true;
      return {
        account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
        requiresOpenAiAuth: false,
        pendingLogin: null,
        rateLimits: null,
      };
    }

    return null;
  },
  subscribeCodexHostMessages: () => () => {},
}));

describe("useLocalConversation", () => {
  test("hydrates connection and account state on mount", async () => {
    invokeCalls.length = 0;
    accountBootstrapCompleted = false;
    const { useLocalConversation } = await import("./use-local-conversation");

    function Probe() {
      const { state } = useLocalConversation("project_1");
      const accountEmail = state.account?.account?.type === "chatgpt"
        ? state.account.account.email
        : "none";
      return createElement(
        "div",
        null,
        `${state.connection.status}:${accountEmail}`,
      );
    }

    const { container } = render(createElement(Probe));
    await settleAsyncRender();

    expect(invokeCalls.join(",")).toBe("codex:account:read,codex:connection:status");
    expect(textContent(container)).toBe("connected:dev@example.com");
  });
});
