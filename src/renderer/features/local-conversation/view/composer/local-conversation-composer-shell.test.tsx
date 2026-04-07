import { describe, expect, test } from "bun:test";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions } from "../../thread-stage-types";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import {
  buildThreadStageStoryModel,
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
  permissionMode: "sandbox",
  authenticatedAccount: true,
  isQueueingEnabled: false,
  collapseAgentBody: false,
};

function buildComposerShellModel() {
  const scenario = buildThreadStageStoryScenario(STORY_CONTROLS);
  return buildThreadStageStoryModel(scenario, STORY_CONTROLS, scenario.runtime);
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
    ...overrides,
  };
}

describe("LocalConversationComposerShell", () => {
  test("renders queue rows, background terminals, and request cards in one shell", async () => {
    const model = buildComposerShellModel();
    render(
      <TooltipProvider>
        <div className="px-panel z-10 mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col pb-2">
          <LocalConversationAboveComposerPortalHost />
          <LocalConversationAboveComposerQueuePortalHost />
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
    expect(Boolean(renderedText.includes("Keep the stage stories on the real projection path."))).toBeTrue();
    expect(Boolean(renderedText.includes("Run final validation once the stories are in place."))).toBeTrue();
    expect(Boolean(renderedText.includes("Running 1 terminal"))).toBeTrue();
    expect(Boolean(renderedText.includes("1 active requests"))).toBeFalse();
    expect(Boolean(renderedText.includes("Worker 1"))).toBeFalse();
  });
});
