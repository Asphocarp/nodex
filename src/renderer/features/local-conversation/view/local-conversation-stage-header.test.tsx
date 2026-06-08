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
    showSeparator: false,
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
    onUnarchiveThread: async () => { },
    onOpenTurnDiffReview: () => { },
    onConsumeComposerIntent: () => { },
    onOpenThread: () => { },
    onCleanBackgroundTerminals: async () => { },
    onOpenCard: () => { },
  };
}

describe("ThreadStageHeader auth chrome", () => {
  test("renders the Codex Electron sized single-line thread title", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader
        model={buildModel({ title: "Review shell header parity" })}
        actions={buildActions()}
        onErrorMessage={() => {}}
      />,
    );

    const title = container.querySelector('[data-testid="thread-stage-title"]');
    const header = container.firstElementChild;
    expect(title?.textContent).toBe("Review shell header parity");
    expect(title?.className.includes("max-w-[320px]")).toBeTrue();
    expect(title?.className.includes("text-token-foreground")).toBeTrue();
    expect(title?.parentElement?.className.includes("text-base")).toBeTrue();
    expect(header?.className.includes("pl-3")).toBeFalse();
    expect(header?.className.includes("pl-[var(--thread-stage-header-left-padding,0.75rem)]")).toBeTrue();
  });

  test("renders the title separator only when requested by the shell", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const visible = render(
      <ThreadStageHeader
        model={buildModel({ showSeparator: true })}
        actions={buildActions()}
        onErrorMessage={() => {}}
      />,
    );

    expect(visible.container.firstElementChild?.className.includes("border-b")).toBeTrue();
    expect(visible.container.firstElementChild?.className.includes("border-token-border")).toBeTrue();
    visible.unmount();

    const hidden = render(
      <ThreadStageHeader
        model={buildModel({ showSeparator: false })}
        actions={buildActions()}
        onErrorMessage={() => {}}
      />,
    );

    expect(hidden.container.firstElementChild?.className.includes("border-b")).toBeFalse();
  });

  test("reserves the global side-panel toggle area as no-drag", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader model={buildModel()} actions={buildActions()} onErrorMessage={() => {}} />,
    );

    const header = container.firstElementChild;
    const leftHitbox = container.querySelector('[data-testid="thread-stage-header-left-chrome-hitbox"]');
    const hitbox = container.querySelector('[data-testid="thread-stage-header-toggle-hitbox"]');
    expect(header?.className.includes("draggable")).toBeTrue();
    expect(header?.className.includes("relative")).toBeTrue();
    expect(leftHitbox?.className.includes("no-drag")).toBeTrue();
    expect(leftHitbox?.className.includes("pointer-events-auto")).toBeTrue();
    expect(leftHitbox?.className.includes("left-0")).toBeTrue();
    expect(leftHitbox?.className.includes("z-10")).toBeTrue();
    expect(leftHitbox?.className.includes("w-[var(--thread-stage-header-left-padding,0px)]")).toBeTrue();
    expect(hitbox?.className.includes("no-drag")).toBeTrue();
    expect(hitbox?.className.includes("pointer-events-auto")).toBeTrue();
    expect(hitbox?.className.includes("right-0")).toBeTrue();
    expect(hitbox?.className.includes("z-10")).toBeTrue();
  });

  test("renders the summary action at the right edge of the thread header", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const { container } = render(
      <ThreadStageHeader
        model={buildModel({
          summaryAction: createElement(
            "button",
            { type: "button", "aria-label": "Toggle summary" },
            "Summary",
          ),
        })}
        actions={buildActions()}
        onErrorMessage={() => {}}
      />,
    );

    const summaryButton = container.querySelector('button[aria-label="Toggle summary"]');
    const summaryRail = container.querySelector('[data-testid="thread-stage-header-summary-actions"]');
    const contextSurface = container.querySelector('[data-testid="thread-stage-header-context-menu-surface"]');
    const globalHitbox = container.querySelector('[data-testid="thread-stage-header-toggle-hitbox"]');
    const header = container.firstElementChild;

    expect(Boolean(summaryButton)).toBeTrue();
    expect(header?.className.includes("electron:h-toolbar")).toBeTrue();
    expect(header?.className.includes("electron:py-0")).toBeTrue();
    expect(contextSurface?.className.includes("h-full")).toBeTrue();
    expect(contextSurface?.className.includes("overflow-hidden")).toBeTrue();
    expect(contextSurface?.className.includes("pe-1.5")).toBeTrue();
    expect(contextSurface?.contains(summaryButton ?? null)).toBeTrue();
    expect(summaryRail?.contains(summaryButton ?? null)).toBeTrue();
    expect(summaryRail?.className.includes("ms-auto")).toBeTrue();
    expect(summaryRail?.className.includes("shrink-0")).toBeTrue();
    expect(summaryRail?.className.includes("-translate-y-px")).toBeTrue();
    expect(summaryRail?.className.includes("gap-1.5")).toBeTrue();
    expect(globalHitbox?.contains(summaryButton ?? null)).toBeFalse();
  });

  test("does not render the authenticated connection badge", async () => {
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

    expect(String(connectionBadgeRenderCount)).toBe("0");
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

  test("moves quota remaining out of the header when the account snapshot is authenticated", async () => {
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
    expect(content.includes("82% · 61%")).toBeFalse();
  });
});
