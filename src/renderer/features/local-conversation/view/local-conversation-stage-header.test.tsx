import { describe, expect, mock, test } from "bun:test";
import { Fragment, createElement, type ReactNode } from "react";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import type { ThreadStageActions, ThreadStageHeaderModel } from "../thread-stage-types";

let connectionBadgeRenderCount = 0;

mock.module("./local-conversation-stage-header-deps", () => ({
  CardInfoHoverCard: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  invoke: async () => null,
  AuthPopover: ({ account }: { account: ThreadStageHeaderModel["account"] }) => (
    account !== null && account.account === null
      ? createElement("div", null, "Sign in")
      : null
  ),
  ConnectionBadge: ({
    connection,
    rateLimits,
  }: {
    connection: ThreadStageHeaderModel["connection"];
    rateLimits?: NonNullable<ThreadStageHeaderModel["account"]>["rateLimits"];
  }) => {
    connectionBadgeRenderCount += 1;
    return createElement(
      "div",
      null,
      connection.status === "connected"
        ? (rateLimits ? "82% · 61%" : "Connected")
        : connection.status,
    );
  },
  renderConnectionAccountTooltipContent: () => null,
}));

function buildModel(overrides?: Partial<ThreadStageHeaderModel>): ThreadStageHeaderModel {
  return {
    projectId: "project_1",
    threadId: "thread_1",
    cardId: "card_1",
    title: "Thread title",
    openCardTarget: null,
    activeThreadCardColumnId: null,
    connection: { status: "connected", retries: 0 },
    account: null,
    ...overrides,
  };
}

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: () => { },
    onModelChange: () => { },
    onReasoningEffortChange: () => { },
    onPermissionModeChange: () => { },
    onQueueingEnabledChange: () => { },
    onRefreshAccount: async () => ({
      account: null,
      requiresOpenAiAuth: true,
      pendingLogin: null,
      rateLimits: null,
    }),
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => { },
    onLogout: async () => { },
    onStartThreadForCard: async () => { },
    onSendPrompt: async () => { },
    onSteerPrompt: async () => { },
    onInterruptTurn: async () => { },
    onRespondApproval: async () => { },
    onRespondUserInput: async () => { },
    onRespondMcpElicitation: async () => { },
    onResolvePlanImplementationRequest: async () => { },
    onEnqueueQueuedFollowUp: async () => { },
    onRemoveQueuedFollowUp: async () => { },
    onReorderQueuedFollowUps: async () => { },
    onSendQueuedFollowUpNow: async () => { },
    onEditQueuedFollowUp: async () => { },
    onEditLastUserTurn: async () => { },
    onForkFromTurn: async () => { },
    onOpenTurnDiffReview: () => { },
    onConsumeComposerIntent: () => { },
    onOpenThread: () => { },
    onCleanBackgroundTerminals: async () => { },
    onOpenCard: () => { },
  };
}

describe("ThreadStageHeader auth chrome", () => {
  test("does not rerender for body-only turn updates", async () => {
    connectionBadgeRenderCount = 0;
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const actions = buildActions();
    const account = {
      account: { type: "chatgpt" as const, email: "dev@example.com", planType: "Plus" as const },
      requiresOpenAiAuth: false,
      pendingLogin: null,
      rateLimits: null,
    };
    const baseModel = buildModel({ account });
    const onErrorMessage = () => {};
    const { rerender } = render(
      <ThreadStageHeader
        model={baseModel}
        actions={actions}
        onErrorMessage={onErrorMessage}
      />,
    );
    await settleAsyncRender();
    const renderCountAfterMount = connectionBadgeRenderCount;

    rerender(
      <ThreadStageHeader
        model={{
          ...baseModel,
          title: "Thread title",
        }}
        actions={actions}
        onErrorMessage={onErrorMessage}
      />,
    );
    await settleAsyncRender();

    expect(String(connectionBadgeRenderCount)).toBe(String(renderCountAfterMount));
  });

  test("does not show sign-in or connected badge before the account snapshot hydrates", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader model={buildModel({ account: null })} actions={buildActions()} onErrorMessage={() => { }} />,
    );

    const content = textContent(container);
    expect(content.includes("Sign in")).toBeFalse();
    expect(content.includes("Connected")).toBeFalse();
  });

  test("shows sign-in without the connected badge when the account snapshot is logged out", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader
        model={buildModel({
          account: {
            account: null,
            requiresOpenAiAuth: true,
            pendingLogin: null,
            rateLimits: null,
          },
        })}
        actions={buildActions()}
        onErrorMessage={() => { }}
      />,
    );

    const content = textContent(container);
    expect(content.includes("Sign in")).toBeTrue();
    expect(content.includes("Connected")).toBeFalse();
  });

  test("shows quota remaining without sign-in when the account snapshot is authenticated", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader
        model={buildModel({
          account: {
            account: { type: "chatgpt", email: "dev@example.com", planType: "Plus" },
            requiresOpenAiAuth: false,
            pendingLogin: null,
            rateLimits: {
              primary: {
                usedPercent: 18,
                windowDurationMins: 300,
              },
              secondary: {
                usedPercent: 39,
                windowDurationMins: 7 * 24 * 60,
              },
            },
          },
        })}
        actions={buildActions()}
        onErrorMessage={() => { }}
      />,
    );

    const content = textContent(container);
    expect(content.includes("Sign in")).toBeFalse();
    expect(content.includes("Connected")).toBeFalse();
    expect(content.includes("82% · 61%")).toBeTrue();
  });
});
