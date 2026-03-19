import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions } from "../thread-stage-types";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import { LocalConversationAboveComposerPortalHost } from "./local-conversation-above-composer-portal";
import { LocalConversationAboveComposerQueuePortal } from "./local-conversation-above-composer-queue-portal";
import {
  buildThreadStageStoryModel,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "./thread-stage-story-fixtures";

const STORY_CONTROLS: ThreadStageStoryControls = {
  preset: "background-activity",
  permissionMode: "sandbox",
  authenticatedAccount: true,
  isQueueingEnabled: false,
  collapseAgentBody: false,
  collapseToolCalls: false,
};

function buildQueuePortalModel() {
  const scenario = buildThreadStageStoryScenario(STORY_CONTROLS);
  return buildThreadStageStoryModel(scenario, STORY_CONTROLS, scenario.runtime);
}

function buildActions(overrides?: Partial<ThreadStageActions>): ThreadStageActions {
  return {
    onCollaborationModeChange: () => {},
    onModelChange: () => {},
    onReasoningEffortChange: () => {},
    onPermissionModeChange: () => {},
    onQueueingEnabledChange: () => {},
    onRefreshAccount: async () => {
      throw new Error("not implemented");
    },
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: async () => {},
    onLogout: async () => {},
    onStartThreadForCard: async () => {},
    onSendPrompt: async () => {},
    onSteerPrompt: async () => {},
    onInterruptTurn: async () => {},
    onRespondApproval: async () => {},
    onRespondUserInput: async () => {},
    onRespondMcpElicitation: async () => {},
    onResolvePlanImplementationRequest: () => {},
    onEnqueueQueuedFollowUp: async () => {},
    onRemoveQueuedFollowUp: async () => {},
    onReorderQueuedFollowUps: async () => {},
    onSendQueuedFollowUpNow: async () => {},
    onEditQueuedFollowUp: async () => {},
    onEditLastUserTurn: async () => {},
    onForkFromTurn: async () => {},
    onConsumeComposerIntent: () => {},
    onOpenCard: () => {},
    ...overrides,
  };
}

describe("LocalConversationAboveComposerQueuePortal", () => {
  test("renders queued follow-ups without the legacy background working card", async () => {
    const model = buildQueuePortalModel();
    render(
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost />
        <LocalConversationAboveComposerQueuePortal model={model} actions={buildActions()} />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    const renderedText = textContent(document.body);
    expect(Boolean(renderedText.includes("Keep the stage stories on the real projection path."))).toBeTrue();
    expect(Boolean(renderedText.includes("Run final validation once the stories are in place."))).toBeTrue();
    expect(Boolean(renderedText.includes("Running 1 terminal"))).toBeFalse();
    expect(Boolean(renderedText.includes("worker is still comparing leaf-story density"))).toBeFalse();
  });

  test("keeps edit out of the inline action bar and shows the Codex-style overflow trigger", async () => {
    const model = buildQueuePortalModel();
    const { getByRole, queryByRole } = render(
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost />
        <LocalConversationAboveComposerQueuePortal
          model={model}
          actions={buildActions()}
        />
      </TooltipProvider>,
    );
    await settleAsyncRender();

    expect(getByRole("button", { name: "Steer" })).not.toBeNull();
    expect(getByRole("button", { name: "Delete queued message" })).not.toBeNull();
    expect(getByRole("button", { name: "Queued message actions" })).not.toBeNull();
    expect(queryByRole("button", { name: "Edit queued message" })).toBe(null);
  });
});
