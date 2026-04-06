import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act, fireEvent } from "@testing-library/react";
import type { CodexPlanImplementationRequest } from "@/lib/types";
import { render, settleAsyncRender } from "@/test/dom";
import type {
  ThreadComposerShellPendingRequestModel,
  ThreadStageActions,
} from "../../../thread-stage-types";

mock.module("./codex-implement-plan-request-card", () => ({
  CodexImplementPlanRequestCard: ({ onRespond }: {
    onRespond: (response: { type: "dismiss" } | { type: "implement" } | { type: "followUp"; prompt: string }) => Promise<void>;
  }) => createElement(
    "div",
    null,
    createElement("button", {
      type: "button",
      onClick: () => {
        void onRespond({ type: "implement" });
      },
    }, "implement"),
    createElement("button", {
      type: "button",
      onClick: () => {
        void onRespond({ type: "followUp", prompt: "Revise step 2 and retry." });
      },
    }, "follow-up"),
  ),
}));

const PLAN_REQUEST: CodexPlanImplementationRequest = {
  type: "implementPlan",
  requestId: "implement-plan:turn_plan",
  projectId: "project_1",
  cardId: "card_1",
  threadId: "thread_1",
  turnId: "turn_plan",
  itemId: "plan_item",
  planContent: "1. Review\n2. Ship",
  createdAt: Date.now(),
};

function createActions(log: string[]): ThreadStageActions {
  return {
    onCollaborationModeChange: (mode) => {
      log.push(`mode:${mode}`);
    },
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPermissionModeChange: () => {},
    onQueueingEnabledChange: () => {},
    onRefreshAccount: async () => {
      throw new Error("not implemented");
    },
    onStartChatGptLogin: async () => {
      throw new Error("not implemented");
    },
    onStartApiKeyLogin: async () => {
      throw new Error("not implemented");
    },
    onCancelLogin: async () => {},
    onLogout: async () => {},
    onStartThreadForCard: async () => {},
    onSendPrompt: async (prompt, opts) => {
      log.push(`send:${prompt}:${opts?.collaborationMode ?? "none"}`);
    },
    onSteerPrompt: async () => {},
    onInterruptTurn: async () => {},
    onRespondApproval: async () => {},
    onRespondUserInput: async () => {},
    onRespondMcpElicitation: async () => {},
    onResolvePlanImplementationRequest: (threadId, turnId) => {
      log.push(`resolve:${threadId}:${turnId}`);
    },
    onEnqueueQueuedFollowUp: async () => {},
    onRemoveQueuedFollowUp: async () => {},
    onReorderQueuedFollowUps: async () => {},
    onSendQueuedFollowUpNow: async () => {},
    onEditQueuedFollowUp: async () => {},
    onEditLastUserTurn: async () => {},
    onForkFromTurn: async () => {},
    onOpenTurnDiffReview: () => {},
    onConsumeComposerIntent: () => {},
    onOpenThread: () => {},
    onCleanBackgroundTerminals: async () => {},
    onOpenCard: () => {},
  };
}

describe("CodexPendingRequestCard", () => {
  test("implementing a plan resets collaboration mode before sending the follow-up", async () => {
    const { CodexPendingRequestCard } = await import("./codex-pending-request-card");
    const log: string[] = [];
    const entry: ThreadComposerShellPendingRequestModel = {
      request: PLAN_REQUEST,
      conversationId: "thread_1",
      surface: "activeThread",
    };

    const { getByText } = render(
      <CodexPendingRequestCard
        entry={entry}
        actions={createActions(log)}
      />,
    );

    await act(async () => {
      fireEvent.click(getByText("implement"));
      await settleAsyncRender();
    });

    expect(log[0]).toBe("resolve:thread_1:turn_plan");
    expect(log[1]).toBe("mode:default");
    expect(log[2]).toBe("send:PLEASE IMPLEMENT THIS PLAN:\n1. Review\n2. Ship:default");
  });

  test("freeform implement-plan follow-ups do not force default mode", async () => {
    const { CodexPendingRequestCard } = await import("./codex-pending-request-card");
    const log: string[] = [];
    const entry: ThreadComposerShellPendingRequestModel = {
      request: PLAN_REQUEST,
      conversationId: "thread_1",
      surface: "activeThread",
    };

    const { getByText } = render(
      <CodexPendingRequestCard
        entry={entry}
        actions={createActions(log)}
      />,
    );

    await act(async () => {
      fireEvent.click(getByText("follow-up"));
      await settleAsyncRender();
    });

    expect(log[0]).toBe("resolve:thread_1:turn_plan");
    expect(log[1]).toBe("send:Revise step 2 and retry.:none");
  });
});
