import type { Meta, StoryObj } from "@storybook/react-vite";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions } from "../thread-stage-types";
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
    onOpenCard: () => {},
  };
}

function AboveComposerQueueLaneStory() {
  const scenario = buildThreadStageStoryScenario(STORY_CONTROLS);
  const model = buildThreadStageStoryModel(scenario, STORY_CONTROLS, scenario.runtime);

  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">Above-Composer Queue Lane</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          The queue lane above the composer now follows the Codex Electron split: queued steers and queued follow-ups in one card, background activity in a separate stacked card.
        </div>
      </div>
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost />
        <LocalConversationAboveComposerQueuePortal model={model} actions={buildActions()} />
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
          "Focused parity story for the Codex-style above-composer queue lane. The scene is built from the real thread-stage projection model and uses the actual portal host split.",
      },
    },
  },
} satisfies Meta<typeof AboveComposerQueueLaneStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const QueueLane: Story = {
  render: () => <AboveComposerQueueLaneStory />,
};
