import { describe, expect, test } from "bun:test";
import { act, fireEvent, within } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadFooterModel, ThreadStageActions } from "../../thread-stage-types";
import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { installWindowApi } from "@/test/browser-globals";
import {
  buildThreadStageStorySurfaceModels,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "../thread-stage-story-fixtures";
import {
  LocalConversationAboveComposerPortalHost,
  LocalConversationAboveComposerQueuePortalHost,
} from "../local-conversation-above-composer-portal";
import { LocalConversationComposerShell } from "./local-conversation-composer-shell";

const STORY_CONTROLS: ThreadStageStoryControls = {
  preset: "background-activity",
  permissionMode: "auto",
  authenticatedAccount: true,
  isQueueingEnabled: false,
  collapseAgentBody: false,
};

function buildComposerShellModel() {
  const scenario = buildThreadStageStoryScenario(STORY_CONTROLS);
  return buildThreadStageStorySurfaceModels(scenario, STORY_CONTROLS, scenario.runtime).footerModel;
}

function buildThreadGoal(
  threadId: string,
  status: ThreadGoal["status"],
  overrides: Partial<ThreadGoal> = {},
): ThreadGoal {
  return {
    threadId,
    objective: "Finish goal parity with the Codex Electron resume prompt and keep the thread moving while idle.",
    status,
    tokenBudget: null,
    tokensUsed: 42,
    timeUsedSeconds: 120,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function buildComposerShellModelWithThreadGoal(
  status: ThreadGoal["status"],
  overrides: Partial<ThreadGoal> = {},
) {
  const model = buildComposerShellModel();
  if (!model.threadId || !model.conversation) {
    throw new Error("Expected story composer shell model to include a thread conversation");
  }

  const goal = buildThreadGoal(model.threadId, status, overrides);

  return {
    ...model,
    conversation: {
      ...model.conversation,
      threadGoal: goal,
      threadGoalResumeConfirmation: null,
    },
  };
}

function buildComposerShellModelWithGoalResumeConfirmation(status: ThreadGoal["status"]) {
  const model = buildComposerShellModelWithThreadGoal(status);
  const goal = model.conversation?.threadGoal ?? null;
  if (!goal || !model.conversation) {
    throw new Error("Expected story composer shell model to include a thread goal");
  }

  return {
    ...model,
    conversation: {
      ...model.conversation,
      threadGoalResumeConfirmation: goal,
    },
  };
}

function buildActions(overrides?: Partial<ThreadStageActions>): ThreadStageActions {
  return {
    onCollaborationModeChange: () => { },
    onModelChange: () => { },
    onReasoningEffortChange: () => { },
    onPermissionModeChange: () => { },
    onQueueingEnabledChange: () => { },
    onRefreshAccount: async () => {
      throw new Error("not implemented");
    },
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => { },
    onLogout: async () => { },
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
    ...overrides,
  };
}

function installComposerShellWindowApi(testInvoke?: (channel: string, ...args: unknown[]) => Promise<unknown>): void {
  installWindowApi({
    invoke: async (channel: string, ...args: unknown[]) => {
      if (testInvoke) {
        const result = await testInvoke(channel, ...args);
        if (result !== undefined) return result;
      }
      switch (channel) {
        case "git:branch:state":
          return {
            currentBranch: "main",
            defaultBranch: "main",
            branches: ["main"],
          };
        case "git:branch:watch:start":
        case "git:branch:watch:stop":
          return true;
        case "codex:thread:goal:materialize-draft": {
          const draft = args[0] as { objective?: string };
          return {
            objective: draft.objective?.trim() ?? "",
            attachmentDirectory: null,
          };
        }
        case "codex:thread:goal:materialized-cleanup":
          return undefined;
        case "codex:thread:goal:editable-objective:read":
          return args[0];
        default:
          return null;
      }
    },
    on: () => () => { },
  });
}

function renderComposerShell(
  model: ReturnType<typeof buildComposerShellModel>,
  actions: ThreadStageActions = buildActions(),
) {
  return render(
    <TooltipProvider>
      <div className="z-10 mx-auto flex w-full max-w-(--thread-content-max-width) flex-col px-toolbar pb-4">
        <LocalConversationAboveComposerPortalHost conversationId={model.threadId} />
        <LocalConversationAboveComposerQueuePortalHost conversationId={model.threadId} />
        <LocalConversationComposerShell
          model={model}
          actions={actions}
          errorMessage={null}
          onErrorMessage={() => { }}
        />
      </div>
    </TooltipProvider>,
  );
}

describe("LocalConversationComposerShell", () => {
  test("renders Codex-compatible above-composer portal targets", () => {
    const { container } = render(
      <div>
        <LocalConversationAboveComposerPortalHost conversationId="thread-portal" />
        <LocalConversationAboveComposerQueuePortalHost conversationId="thread-portal" />
      </div>,
    );

    const primary = container.querySelector<HTMLElement>("[data-above-composer-portal]");
    const queue = container.querySelector<HTMLElement>("[data-above-composer-queue-portal]");

    expect(primary?.id ?? "").toBe("above-composer-portal");
    expect(primary?.getAttribute("data-above-composer-conversation-id") ?? "").toBe("thread-portal");
    expect(queue?.id ?? "").toBe("above-composer-queue-portal");
    expect(queue?.getAttribute("data-above-composer-conversation-id") ?? "").toBe("thread-portal");
  });

  test("renders queue rows, background terminals, and request cards in one shell", async () => {
    installComposerShellWindowApi();
    const model = buildComposerShellModel();
    const view = render(
      <TooltipProvider>
        <div className="z-10 mx-auto flex w-full max-w-(--thread-content-max-width) flex-col px-toolbar pb-4">
          <LocalConversationAboveComposerPortalHost conversationId={model.threadId} />
          <LocalConversationAboveComposerQueuePortalHost conversationId={model.threadId} />
          <LocalConversationComposerShell
            model={model}
            actions={buildActions()}
            errorMessage={null}
            onErrorMessage={() => { }}
          />
        </div>
      </TooltipProvider>,
    );
    await settleAsyncRender();

    const renderedText = textContent(document.body);
    expect(Boolean(renderedText.includes("Keep the stage stories on the real projection path."))).toBeFalse();
    expect(Boolean(renderedText.includes("Run final validation once the stories are in place."))).toBeTrue();
    expect(Boolean(renderedText.includes("Running 1 terminal"))).toBeTrue();
    expect(Boolean(renderedText.includes("1 active requests"))).toBeFalse();
    expect(Boolean(renderedText.includes("Worker 1"))).toBeTrue();

    const lowerStatusRow = view.container.querySelector('[data-composer-lower-status-row="true"]');
    expect(lowerStatusRow === null).toBeTrue();
    expect(view.queryByLabelText("Add files and more") === null).toBeTrue();
    expect(view.queryByLabelText("Permission mode") === null).toBeTrue();
    expect(view.queryByLabelText("Select Codex model and reasoning") === null).toBeTrue();
    expect(view.queryByLabelText(/Context window/) === null).toBeTrue();
    expect(view.queryByLabelText("Send prompt") === null).toBeTrue();
    expect(view.queryByLabelText("Stop generating") === null).toBeTrue();
  });

  test("opens composer background agents with subagent context", async () => {
    installComposerShellWindowApi();
    const baseModel = buildComposerShellModel();
    const model: ThreadFooterModel = {
      ...baseModel,
      composerShell: {
        ...baseModel.composerShell,
        backgroundAgentRows: [
          {
            conversationId: "thread_child",
            parentTurnKey: "turn_parent",
            displayName: "Scout",
            actorName: "Scout",
            agentRole: "explorer",
            spawnModel: "gpt-5.3-codex",
            status: "active",
            statusSummary: "checking files",
            showInlineActivity: false,
            diffStats: {
              linesAdded: 2,
              linesRemoved: 1,
            },
            role: "backgroundChild",
          },
          {
            conversationId: "thread_waiting",
            parentTurnKey: "turn_parent",
            displayName: "Planner",
            actorName: "Planner",
            agentRole: null,
            spawnModel: null,
            status: "waiting",
            statusSummary: null,
            showInlineActivity: false,
            diffStats: {
              linesAdded: 0,
              linesRemoved: 0,
            },
            role: "backgroundChild",
          },
          {
            conversationId: "thread_done",
            parentTurnKey: "turn_parent",
            displayName: "Closer",
            actorName: "Closer",
            agentRole: null,
            spawnModel: null,
            status: "done",
            statusSummary: null,
            showInlineActivity: false,
            diffStats: null,
            role: "backgroundChild",
          },
        ],
        showApprovalMode: false,
        showComposer: true,
        showRequestCards: false,
      },
    };
    const openCalls: unknown[] = [];
    const stopCalls: unknown[] = [];
    const view = renderComposerShell(
      model,
      buildActions({
        onOpenThread: (threadId, context) => {
          openCalls.push({ threadId, context });
        },
        onStopBackgroundAgents: async (threadIds) => {
          stopCalls.push([...threadIds]);
        },
      }),
    );
    await settleAsyncRender();

    expect(Boolean(textContent(document.body).includes("3 background agents"))).toBeTrue();
    expect(Boolean(textContent(document.body).includes("(@ to tag agents)"))).toBeFalse();
    expect(view.container.querySelector('[data-subagent-avatar-seed="thread_child"]') !== null).toBeTrue();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Expand background agent details" }));
      await Promise.resolve();
    });
    const renderedText = textContent(document.body);
    expect(Boolean(renderedText.includes("(@ to tag agents)"))).toBeTrue();
    expect(Boolean(renderedText.includes("Scout"))).toBeTrue();
    expect(Boolean(renderedText.includes("is working"))).toBeTrue();
    expect(Boolean(renderedText.includes("Planner"))).toBeTrue();
    expect(Boolean(renderedText.includes("is awaiting instruction"))).toBeTrue();
    expect(Boolean(renderedText.includes("Closer"))).toBeTrue();
    expect(Boolean(renderedText.includes("is done"))).toBeTrue();
    expect(Boolean(renderedText.includes("+2"))).toBeTrue();
    expect(Boolean(renderedText.includes("-1"))).toBeTrue();
    expect(Boolean(renderedText.includes("+0"))).toBeFalse();
    expect(Boolean(renderedText.includes("-0"))).toBeFalse();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Stop all" }));
      await Promise.resolve();
    });
    expect(JSON.stringify(stopCalls)).toBe(JSON.stringify([["thread_child", "thread_waiting"]]));

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Scout/ }));
      await Promise.resolve();
    });

    const call = openCalls[0] as {
      threadId?: string;
      context?: {
        subagent?: {
          conversationId?: string;
          displayName?: string;
          agentRole?: string | null;
          spawnModel?: string | null;
          statusSummary?: string | null;
          diffStats?: { linesAdded?: number; linesRemoved?: number } | null;
        };
      };
    } | undefined;
    expect(openCalls.length).toBe(1);
    expect(call?.threadId).toBe("thread_child");
    expect(call?.context?.subagent?.conversationId).toBe("thread_child");
    expect(call?.context?.subagent?.displayName).toBe("Scout");
    expect(call?.context?.subagent?.agentRole).toBe("explorer");
    expect(call?.context?.subagent?.spawnModel).toBe("gpt-5.3-codex");
    expect(call?.context?.subagent?.statusSummary).toBe("checking files");
    expect(`${call?.context?.subagent?.diffStats?.linesAdded ?? -1}:${call?.context?.subagent?.diffStats?.linesRemoved ?? -1}`).toBe("2:1");
  });

  test("renders paused goal resume confirmation and dismisses it", async () => {
    installComposerShellWindowApi();
    const model = buildComposerShellModelWithGoalResumeConfirmation("paused");
    const dismissCalls: string[] = [];
    const view = render(
      <TooltipProvider>
        <div className="z-10 mx-auto flex w-full max-w-(--thread-content-max-width) flex-col px-toolbar pb-4">
          <LocalConversationAboveComposerPortalHost conversationId={model.threadId} />
          <LocalConversationAboveComposerQueuePortalHost conversationId={model.threadId} />
          <LocalConversationComposerShell
            model={model}
            actions={buildActions({
              onDismissThreadGoalResumeConfirmation: async (threadId) => {
                dismissCalls.push(threadId);
              },
            })}
            errorMessage={null}
            onErrorMessage={() => { }}
          />
        </div>
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(Boolean(textContent(document.body).includes("Resume paused goal?"))).toBeTrue();
    expect(Boolean(textContent(document.body).includes("Codex will keep working toward this goal when the thread is idle"))).toBeTrue();
    expect(Boolean(textContent(document.body).includes("Finish goal parity with the Codex Electron resume prompt"))).toBeTrue();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Keep paused" }));
      await Promise.resolve();
    });

    expect(dismissCalls.length).toBe(1);
    expect(dismissCalls[0]).toBe(model.threadId);
  });

  test("resumes non-paused goal confirmation with status-only update", async () => {
    installComposerShellWindowApi();
    const model = buildComposerShellModelWithGoalResumeConfirmation("blocked");
    const setGoalCalls: unknown[] = [];
    const view = render(
      <TooltipProvider>
        <div className="z-10 mx-auto flex w-full max-w-(--thread-content-max-width) flex-col px-toolbar pb-4">
          <LocalConversationAboveComposerPortalHost conversationId={model.threadId} />
          <LocalConversationAboveComposerQueuePortalHost conversationId={model.threadId} />
          <LocalConversationComposerShell
            model={model}
            actions={buildActions({
              onDismissThreadGoalResumeConfirmation: async () => { },
              onSetThreadGoal: async (input) => {
                setGoalCalls.push(input);
                return null;
              },
            })}
            errorMessage={null}
            onErrorMessage={() => { }}
          />
        </div>
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(Boolean(textContent(document.body).includes("Resume goal?"))).toBeTrue();
    expect(view.getByRole("button", { name: "Not now" }) !== null).toBeTrue();

    const resumeButtons = view.getAllByRole("button", { name: "Resume goal" });
    const resumeDialogSubmitButton = resumeButtons[resumeButtons.length - 1];
    if (!resumeDialogSubmitButton) {
      throw new Error("Expected the resume confirmation dialog to include a submit button");
    }
    await act(async () => {
      fireEvent.click(resumeDialogSubmitButton);
      await Promise.resolve();
    });

    const call = setGoalCalls[0] as { threadId?: string; status?: string; objective?: unknown } | undefined;
    expect(setGoalCalls.length).toBe(1);
    expect(call?.threadId).toBe(model.threadId);
    expect(call?.status).toBe("active");
    expect(Object.prototype.hasOwnProperty.call(call ?? {}, "objective")).toBeFalse();
  });

  test("renders active thread goal status row in the above-composer queue portal", async () => {
    installComposerShellWindowApi();
    const objective = "Keep the status row aligned with the reference app.";
    const model = buildComposerShellModelWithThreadGoal("active", {
      objective,
      tokenBudget: 2000,
      tokensUsed: 1500,
    });
    const view = renderComposerShell(
      model,
      buildActions({
        onSetThreadGoal: async () => null,
        onClearThreadGoal: async () => { },
      }),
    );
    await settleAsyncRender();

    const row = view.container.querySelector<HTMLElement>("[data-thread-goal-status-row=\"true\"]");
    if (!row) {
      throw new Error("Expected saved goal status row to render");
    }
    expect(row.closest("[data-above-composer-queue-portal]") !== null).toBeTrue();
    expect(row.closest("[data-above-composer-portal]") === null).toBeTrue();
    const rowView = within(row);
    expect(rowView.getByText("Pursuing goal") !== null).toBeTrue();
    expect(rowView.getAllByText(objective).length > 0).toBeTrue();
    expect(rowView.getByText(/1\.5K \/ 2K/) !== null).toBeTrue();
    expect(rowView.getByRole("button", { name: "Edit goal" }) !== null).toBeTrue();
    expect(rowView.getByRole("button", { name: "Pause goal" }) !== null).toBeTrue();
    expect(rowView.getByRole("button", { name: "Clear goal" }) !== null).toBeTrue();
  });

  test("renders Codex-style elapsed goal time when no token budget is present", async () => {
    installComposerShellWindowApi();
    const model = buildComposerShellModelWithThreadGoal("paused", {
      tokenBudget: null,
      timeUsedSeconds: 120,
    });
    const view = renderComposerShell(model);
    await settleAsyncRender();

    const row = view.container.querySelector<HTMLElement>("[data-thread-goal-status-row=\"true\"]");
    if (!row) {
      throw new Error("Expected saved goal status row to render");
    }
    const rowView = within(row);
    expect(rowView.getByText("Paused goal") !== null).toBeTrue();
    expect(rowView.getByText(/2m/) !== null).toBeTrue();
  });

  test("updates and clears thread goal from the status row", async () => {
    installComposerShellWindowApi();
    const setGoalCalls: Parameters<NonNullable<ThreadStageActions["onSetThreadGoal"]>>[0][] = [];
    const clearCalls: string[] = [];
    const activeModel = buildComposerShellModelWithThreadGoal("active");
    const activeView = renderComposerShell(
      activeModel,
      buildActions({
        onSetThreadGoal: async (input) => {
          setGoalCalls.push(input);
          return null;
        },
        onClearThreadGoal: async (threadId) => {
          clearCalls.push(threadId);
        },
      }),
    );
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(activeView.getByRole("button", { name: "Pause goal" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(activeView.getByRole("button", { name: "Clear goal" }));
      await Promise.resolve();
    });

    expect(setGoalCalls.length).toBe(1);
    expect(setGoalCalls[0]?.threadId).toBe(activeModel.threadId);
    expect(setGoalCalls[0]?.status).toBe("paused");
    expect(Object.prototype.hasOwnProperty.call(setGoalCalls[0] ?? {}, "objective")).toBeFalse();
    expect(clearCalls.length).toBe(1);
    expect(clearCalls[0]).toBe(activeModel.threadId);
    activeView.unmount();

    const pausedModel = buildComposerShellModelWithThreadGoal("paused");
    const pausedView = renderComposerShell(
      pausedModel,
      buildActions({
        onSetThreadGoal: async (input) => {
          setGoalCalls.push(input);
          return null;
        },
      }),
    );
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(pausedView.getByRole("button", { name: "Resume goal" }));
      await Promise.resolve();
    });

    expect(setGoalCalls.length).toBe(2);
    expect(setGoalCalls[1]?.threadId).toBe(pausedModel.threadId);
    expect(setGoalCalls[1]?.status).toBe("active");
    expect(Object.prototype.hasOwnProperty.call(setGoalCalls[1] ?? {}, "objective")).toBeFalse();
  });

  test("opens thread goal edit dialog and saves the changed objective", async () => {
    installComposerShellWindowApi();
    const model = buildComposerShellModelWithThreadGoal("active");
    const setGoalCalls: Parameters<NonNullable<ThreadStageActions["onSetThreadGoal"]>>[0][] = [];
    const view = renderComposerShell(
      model,
      buildActions({
        onSetThreadGoal: async (input) => {
          setGoalCalls.push(input);
          return null;
        },
      }),
    );
    await settleAsyncRender();

    await act(async () => {
      fireEvent.click(within(view.container).getByRole("button", { name: "Edit goal" }));
      await Promise.resolve();
    });

    const textbox = view.getByRole("textbox", { name: "Goal" });
    const nextObjective = "Keep the saved goal row editable and restart the active goal.";
    await act(async () => {
      fireEvent.input(textbox, {
        target: {
          value: nextObjective,
        },
      });
      await Promise.resolve();
    });
    expect((textbox as HTMLTextAreaElement).value).toBe(nextObjective);
    const saveButton = view.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBeFalse();
    await act(async () => {
      fireEvent.submit(textbox.closest("form") as HTMLFormElement);
      await Promise.resolve();
    });

    expect(setGoalCalls.length).toBe(1);
    expect(setGoalCalls[0]?.threadId).toBe(model.threadId);
    expect(setGoalCalls[0]?.objective).toBe(nextObjective);
    expect(setGoalCalls[0]?.status).toBe("active");
    expect(setGoalCalls[0]?.appendTranscriptItem).toBeFalse();
  });

  test("does not render complete thread goal status row", async () => {
    installComposerShellWindowApi();
    const model = buildComposerShellModelWithThreadGoal("complete");
    const view = renderComposerShell(model);
    await settleAsyncRender();

    expect(view.container.querySelector("[data-thread-goal-status-row=\"true\"]") === null).toBeTrue();
    expect(view.queryByText("Goal achieved") === null).toBeTrue();
  });
});
