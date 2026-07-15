import { describe, expect, vi, test } from "vitest";
import { createElement } from "react";
import { act, fireEvent } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type {
  CodexApprovalRequest,
  CodexMcpServerElicitationRequest,
  CodexOptionPickerRequest,
  CodexPermissionRequest,
  CodexPlanImplementationRequest,
  CodexSetupCodexStepRequest,
} from "@/lib/types";
import { render, settleAsyncRender } from "@/test/dom";
import type {
  ThreadComposerShellPendingRequestModel,
  ThreadStageActions,
} from "../../../thread-stage-types";

vi.mock("./codex-implement-plan-request-card", () => ({
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
    createElement("button", {
      type: "button",
      onClick: () => {
        void onRespond({ type: "dismiss" });
      },
    }, "dismiss"),
  ),
}));

const PLAN_REQUEST: CodexPlanImplementationRequest = {
  type: "implementPlan",
  requestId: "implement-plan:turn_plan",
  projectId: "project_1",
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
    onSendPrompt: async (prompt, opts) => {
      log.push(`send:${prompt}:${opts?.collaborationMode ?? "none"}`);
    },
    onSteerPrompt: async () => {},
    onInterruptTurn: async () => {},
    onRespondApproval: async (requestId, response, context) => {
      log.push(`approval:${requestId}:${response.kind}:${response.decision}:${context?.conversationId ?? "none"}`);
    },
    onRespondUserInput: async (requestId, answers, context) => {
      log.push(`userInput:${requestId}:${answers.q1?.[0] ?? "none"}:${context?.conversationId ?? "none"}`);
    },
    onRespondMcpElicitation: async (requestId, action, context) => {
      log.push(`mcp:${requestId}:${typeof action === "string" ? action : action.action}:${context?.conversationId ?? "none"}`);
    },
    onRespondPermissionRequest: async (requestId, response, context) => {
      log.push(`permission:${requestId}:${response.scope}:${context?.conversationId ?? "none"}`);
    },
    onRespondOptionPicker: async (requestId, response, context) => {
      log.push(`option:${requestId}:${response.action}:${response.selectedOptions.join(",")}:${context?.conversationId ?? "none"}`);
    },
    onRespondSetupCodexStep: async (requestId, response, context) => {
      const value = response.step === "role" ? response.selectedRoles.join(",") : response.action;
      log.push(`setup:${requestId}:${response.step}:${value}:${context?.conversationId ?? "none"}`);
    },
    onResolvePlanImplementationRequest: async (threadId, turnId) => {
      log.push(`resolve:${threadId}:${turnId}`);
    },
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

describe("CodexPendingRequestCard", () => {
  test("passes conversation context to direct request-card response actions", async () => {
    const { CodexPendingRequestCard } = await import("./codex-pending-request-card");
    const log: string[] = [];
    const actions = createActions(log);
    const entries: Array<{
      buttonText: string;
      entry: ThreadComposerShellPendingRequestModel;
    }> = [
      {
        buttonText: "Skip",
        entry: {
          conversationId: "thread_1",
          surface: "activeThread",
          request: {
            type: "approval",
            requestId: "approval_1",
            kind: "file",
            projectId: "project_1",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "file_1",
            createdAt: 2,
          } satisfies CodexApprovalRequest,
        },
      },
      {
        buttonText: "Cancel",
        entry: {
          conversationId: "thread_1",
          surface: "activeThread",
          request: {
            type: "mcpServerElicitation",
            requestId: "mcp_1",
            projectId: "project_1",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "mcp_item_1",
            kind: "toolSuggestion",
            mode: "url",
            serverName: "server",
            message: "Confirm",
            url: "https://example.test/continue",
            elicitationId: "elicitation_1",
            createdAt: 3,
          } satisfies CodexMcpServerElicitationRequest,
        },
      },
      {
        buttonText: "Skip",
        entry: {
          conversationId: "thread_1",
          surface: "activeThread",
          request: {
            type: "permissionRequest",
            requestId: "permission_1",
            projectId: "project_1",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "permission_item_1",
            cwd: "/repo",
            reason: "Need access",
            permissions: {
              network: null,
              fileSystem: null,
            },
            response: null,
            completed: false,
            createdAt: 4,
          } satisfies CodexPermissionRequest,
        },
      },
    ];

    for (const { buttonText, entry } of entries) {
      const { getByText, unmount } = render(
        <TooltipProvider>
          <CodexPendingRequestCard
            entry={entry}
            actions={actions}
          />
        </TooltipProvider>,
      );

      await act(async () => {
        fireEvent.click(getByText(buttonText));
        await settleAsyncRender();
      });

      unmount();
    }

    expect(JSON.stringify(log)).toBe(JSON.stringify([
      "approval:approval_1:file:decline:thread_1",
      "mcp:mcp_1:decline:thread_1",
      "permission:permission_1:turn:thread_1",
    ]));
  });

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

  test("routes canonical option and setup cards through their owning conversation", async () => {
    const { CodexPendingRequestCard } = await import("./codex-pending-request-card");
    const log: string[] = [];
    const actions = createActions(log);
    const optionEntry: ThreadComposerShellPendingRequestModel = {
      conversationId: "thread-option",
      surface: "activeThread",
      request: {
        type: "optionPicker",
        requestId: 73,
        projectId: "project_1",
        threadId: "thread-option",
        turnId: "turn-option",
        itemId: "option-item",
        question: "Choose a slice",
        options: [{ label: "Composer", description: "Wire it" }],
        allowMultiple: false,
        submitLabel: null,
        skipLabel: null,
        createdAt: 1,
      } satisfies CodexOptionPickerRequest,
    };
    const optionView = render(
      <CodexPendingRequestCard entry={optionEntry} actions={actions} />,
    );
    await act(async () => {
      fireEvent.click(optionView.getByRole("radio", { name: "Composer" }));
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.click(optionView.getByText("Submit"));
      await settleAsyncRender();
    });
    optionView.unmount();

    const setupEntry: ThreadComposerShellPendingRequestModel = {
      conversationId: "thread-setup",
      surface: "activeThread",
      request: {
        type: "setupCodexStep",
        requestId: "setup-1",
        projectId: "project_1",
        threadId: "thread-setup",
        turnId: "turn-setup",
        itemId: "setup-item",
        step: "role",
        createdAt: 1,
      } satisfies CodexSetupCodexStepRequest,
    };
    const setupView = render(
      <CodexPendingRequestCard entry={setupEntry} actions={actions} />,
    );
    await act(async () => {
      fireEvent.click(setupView.getByRole("checkbox", { name: "Engineering" }));
      await settleAsyncRender();
    });
    await act(async () => {
      fireEvent.click(setupView.getByText("Continue"));
      await settleAsyncRender();
    });

    expect(JSON.stringify(log)).toBe(JSON.stringify([
      "option:73:submit:Composer:thread-option",
      "setup:setup-1:role:engineering:thread-setup",
    ]));
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

  test("dismissing a plan implementation request resolves without sending a follow-up", async () => {
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
      fireEvent.click(getByText("dismiss"));
      await settleAsyncRender();
    });

    expect(log[0]).toBe("resolve:thread_1:turn_plan");
    expect(log.length).toBe(1);
  });
});
