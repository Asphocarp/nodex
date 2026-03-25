import type { Meta, StoryObj } from "@storybook/react-vite";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions, ThreadStageModel } from "../../thread-stage-types";
import {
  buildThreadStageStoryModel,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "../thread-stage-story-fixtures";
import { ThreadComposer } from "./local-conversation-thread-composer";

interface ComposerSendButtonStoryProps {
  isQueueingEnabled: boolean;
  draftPrompt: string;
}

function buildModel(args: ComposerSendButtonStoryProps): ThreadStageModel {
  const controls: ThreadStageStoryControls = {
    preset: "streaming",
    permissionMode: "sandbox",
    authenticatedAccount: true,
    isQueueingEnabled: args.isQueueingEnabled,
    collapseAgentBody: false,
  };
  const scenario = buildThreadStageStoryScenario(controls);
  const runtime = {
    ...scenario.runtime,
    composerIntent: args.draftPrompt.trim().length === 0
      ? null
      : {
          prompt: args.draftPrompt,
          focusNonce: 1,
        },
  };
  return buildThreadStageStoryModel(scenario, controls, runtime);
}

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

function ComposerSendButtonStory(args: ComposerSendButtonStoryProps) {
  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">Composer Send Button</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          Running-thread composer states reconstructed from the Codex Electron send-button state machine. Hover the primary action to inspect the live queue-versus-steer tooltip.
        </div>
      </div>
      <TooltipProvider>
        <ThreadComposer
          model={buildModel(args)}
          actions={buildActions()}
          errorMessage={null}
          onErrorMessage={() => {}}
        />
      </TooltipProvider>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Composer Send Button",
  component: ComposerSendButtonStory,
  args: {
    isQueueingEnabled: false,
    draftPrompt: "",
  },
  argTypes: {
    isQueueingEnabled: {
      control: "boolean",
    },
    draftPrompt: {
      control: "text",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Focused Codex-style parity story for the running-thread composer button. Empty draft keeps Stop; any draft switches to submit, which becomes Steer or Queue based on the queue-follow-ups preference.",
      },
    },
  },
} satisfies Meta<typeof ComposerSendButtonStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RunningStop: Story = {
  args: {
    isQueueingEnabled: false,
    draftPrompt: "",
  },
};

export const RunningSteer: Story = {
  args: {
    isQueueingEnabled: false,
    draftPrompt: "Steer the current run toward the MCP transcript cleanup.",
  },
};

export const RunningQueue: Story = {
  args: {
    isQueueingEnabled: true,
    draftPrompt: "Queue this after the current tool-call batch finishes.",
  },
};
