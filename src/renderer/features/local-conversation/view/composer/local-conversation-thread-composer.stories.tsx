import type { Meta, StoryObj } from "@storybook/react-vite";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadStageActions, ThreadStageModel } from "../../thread-stage-types";
import {
  buildThreadStageStoryModel,
  buildThreadStageStoryScenario,
  type ThreadStageStoryControls,
} from "../thread-stage-story-fixtures";
import { ThreadComposer } from "./local-conversation-thread-composer";

interface ComposerSendButtonStoryProps {
  isQueueingEnabled: boolean;
  composerEnterBehavior: "enter" | "cmdIfMultiline";
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
  return {
    ...buildThreadStageStoryModel(scenario, controls, runtime),
    composerEnterBehavior: args.composerEnterBehavior,
  };
}

function buildActions(): ThreadStageActions {
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
    onResolvePlanImplementationRequest: () => { },
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
  };
}

function ComposerSendButtonStory(args: ComposerSendButtonStoryProps) {
  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">Composer Send Button</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">
          Running-thread composer states reconstructed from the Codex Electron send-button state machine. Hover the primary action to inspect the exact running-thread queue-versus-steer tooltip and platform keycaps.
        </div>
      </div>
      <TooltipProvider>
        <ThreadComposer
          model={buildModel(args)}
          actions={buildActions()}
          errorMessage={null}
          onErrorMessage={() => { }}
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
    composerEnterBehavior: "enter",
    draftPrompt: "",
  },
  argTypes: {
    isQueueingEnabled: {
      control: "boolean",
    },
    composerEnterBehavior: {
      control: "radio",
      options: ["enter", "cmdIfMultiline"],
    },
    draftPrompt: {
      control: "text",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Focused Codex-style parity story for the running-thread composer button. Empty draft keeps Stop; any draft switches to submit, which becomes Steer or Queue based on the queue-follow-ups preference and shows the exact platform keycap tooltip rows.",
      },
    },
  },
} satisfies Meta<typeof ComposerSendButtonStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RunningStop: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "",
  },
};

export const RunningSteer: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "enter",
    draftPrompt: "Steer the current run toward the MCP transcript cleanup.",
  },
};

export const RunningQueue: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "enter",
    draftPrompt: "Queue this after the current tool-call batch finishes.",
  },
};

export const RunningQueueMultilineCmdEnter: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "cmdIfMultiline",
    draftPrompt: "Queue this after the current tool-call batch finishes.\nInclude a compact reasoning summary.",
  },
};

export const RunningQueueSingleLineCmdIfMultiline: Story = {
  args: {
    isQueueingEnabled: true,
    composerEnterBehavior: "cmdIfMultiline",
    draftPrompt: "Queue this after the current tool-call batch finishes.",
  },
};

export const RunningSteerMultilineCmdEnter: Story = {
  args: {
    isQueueingEnabled: false,
    composerEnterBehavior: "cmdIfMultiline",
    draftPrompt: "Steer the current run toward the MCP transcript cleanup.\nPrefer deduping the approval rows.",
  },
};
