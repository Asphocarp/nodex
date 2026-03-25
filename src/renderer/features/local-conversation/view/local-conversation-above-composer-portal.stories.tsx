import type { Meta, StoryObj } from "@storybook/react-vite";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions } from "../thread-stage-types";
import { LocalConversationComposerShell } from "./composer/local-conversation-composer-shell";
import { LocalConversationAboveComposerPortalHost } from "./local-conversation-above-composer-portal";
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
};

function buildActions(): ThreadStageActions {
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
    onOpenThread: () => {},
    onStopBackgroundTerminals: async () => {},
    onOpenCard: () => {},
  };
}

function AboveComposerQueueLaneStory() {
  const scenario = buildThreadStageStoryScenario(STORY_CONTROLS);
  const model = buildThreadStageStoryModel(scenario, STORY_CONTROLS, scenario.runtime);

  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">Composer Shell</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          Focused parity story for the unified Codex-style composer shell: queued steers, queued follow-ups, background terminals, background agents, and request cards are rendered by one shell instead of split footer surfaces.
        </div>
      </div>
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost />
        <LocalConversationComposerShell
          model={model}
          actions={buildActions()}
          errorMessage={null}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Above Composer",
  component: AboveComposerQueueLaneStory,
  parameters: {
    docs: {
      description: {
        component:
          "Focused parity story for the Codex-style composer shell. The scene is built from the real thread-stage projection model and uses the same shell that renders queue rows, background activity, and live request cards in production.",
      },
    },
  },
} satisfies Meta<typeof AboveComposerQueueLaneStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const QueueLane: Story = {
  render: () => <AboveComposerQueueLaneStory />,
};
