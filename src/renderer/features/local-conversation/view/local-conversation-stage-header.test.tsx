import { fireEvent } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import type { ThreadStageActions, ThreadStageHeaderModel } from "../thread-stage-types";

function buildModel(overrides?: Partial<ThreadStageHeaderModel>): ThreadStageHeaderModel {
  return {
    projectId: "project_1",
    threadId: "thread_1",
    title: "Thread title",
    ...overrides,
  };
}

function buildActions(): ThreadStageActions {
  return {
    onCollaborationModeChange: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPermissionModeChange: () => {},
    onQueueingEnabledChange: () => {},
    onSendPrompt: async () => {},
    onSteerPrompt: async () => {},
    onInterruptTurn: async () => {},
    onRespondApproval: async () => {},
    onRespondUserInput: async () => {},
    onRespondMcpElicitation: async () => {},
    onResolvePlanImplementationRequest: async () => {},
    onEnqueueQueuedFollowUp: async () => {},
    onRemoveQueuedFollowUp: async () => {},
    onReorderQueuedFollowUps: async () => {},
    onSendQueuedFollowUpNow: async () => {},
    onEditQueuedFollowUp: async () => {},
    onEditLastUserTurn: async () => {},
    onForkFromTurn: async () => {},
    onUnarchiveThread: async () => {},
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
  };
}

describe("ThreadStageHeader", () => {
  test("renders the global thread title", async () => {
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
    expect(header?.className.includes("draggable")).toBe(true);
  });

  test("keeps thread actions left-aligned immediately after the title", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    const actions = {
      ...buildActions(),
      onOpenSideChat: async () => {},
    };
    const { container } = render(
      <ThreadStageHeader
        model={buildModel({ showSideChatAction: true })}
        actions={actions}
        onErrorMessage={() => {}}
      />,
    );

    const title = container.querySelector('[data-testid="thread-stage-title"]');
    const threadActions = container.querySelector('button[aria-label="Thread actions"]');
    const actionGroup = threadActions?.closest(".no-drag");
    expect(Boolean(title)).toBe(true);
    expect(Boolean(actionGroup)).toBe(true);
    expect(actionGroup?.previousElementSibling === title).toBe(true);
  });

  test("renders Rename chat before Open side chat in thread actions", async () => {
    const { ThreadStageHeader } = await import("./local-conversation-stage-header");
    let renameCalls = 0;
    const actions = {
      ...buildActions(),
      onRequestRenameThread: () => {
        renameCalls += 1;
      },
      onOpenSideChat: async () => {},
    };
    const screen = render(
      <ThreadStageHeader
        model={buildModel({ showSideChatAction: true })}
        actions={actions}
        onErrorMessage={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Thread actions" }), {
      button: 0,
      ctrlKey: false,
    });
    await settleAsyncRender();

    const bodyText = textContent(document.body);
    expect(bodyText.indexOf("Rename chat") >= 0).toBe(true);
    expect(bodyText.indexOf("Rename chat") < bodyText.indexOf("Open side chat")).toBe(true);

    fireEvent.click(screen.getByText("Rename chat"));
    expect(renameCalls).toBe(1);
  });
});
