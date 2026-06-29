import { describe, expect, test } from "bun:test";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions } from "../../thread-stage-types";
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

function installComposerShellWindowApi(): void {
  installWindowApi({
    invoke: async (channel: string) => {
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
        default:
          return null;
      }
    },
    on: () => () => { },
  });
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
    expect(Boolean(renderedText.includes("Worker 1"))).toBeFalse();

    const lowerStatusRow = view.container.querySelector('[data-composer-lower-status-row="true"]');
    expect(lowerStatusRow === null).toBeTrue();
    expect(view.queryByLabelText("Add files and more") === null).toBeTrue();
    expect(view.queryByLabelText("Permission mode") === null).toBeTrue();
    expect(view.queryByLabelText("Select Codex model and reasoning") === null).toBeTrue();
    expect(view.queryByLabelText(/Context window/) === null).toBeTrue();
    expect(view.queryByLabelText("Send prompt") === null).toBeTrue();
    expect(view.queryByLabelText("Stop generating") === null).toBeTrue();
  });
});
