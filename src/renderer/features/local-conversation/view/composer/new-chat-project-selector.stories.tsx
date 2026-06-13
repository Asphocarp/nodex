import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { NewChatProjectSelectorModel, ThreadStageActions } from "../../thread-stage-types";
import { NewChatProjectSelector } from "./new-chat-project-selector";

function buildActions(input: {
  onSelect: (projectId: string) => void;
}): ThreadStageActions {
  const noopAsync = async () => undefined;
  return {
    onCollaborationModeChange: () => undefined,
    onModelChange: () => undefined,
    onReasoningEffortChange: () => undefined,
    onPermissionModeChange: () => undefined,
    onQueueingEnabledChange: () => undefined,
    onRefreshAccount: async () => ({
      account: null,
      requiresOpenAiAuth: false,
      pendingLogin: null,
      rateLimits: null,
    }),
    onStartChatGptLogin: async () => ({ type: "apiKey" }),
    onStartApiKeyLogin: async () => ({ type: "apiKey" }),
    onCancelLogin: noopAsync,
    onLogout: noopAsync,
    onStartThreadForCard: noopAsync,
    onSendPrompt: noopAsync,
    onSteerPrompt: noopAsync,
    onInterruptTurn: noopAsync,
    onRespondApproval: noopAsync,
    onRespondUserInput: noopAsync,
    onRespondMcpElicitation: noopAsync,
    onResolvePlanImplementationRequest: noopAsync,
    onEnqueueQueuedFollowUp: noopAsync,
    onRemoveQueuedFollowUp: noopAsync,
    onReorderQueuedFollowUps: noopAsync,
    onSendQueuedFollowUpNow: noopAsync,
    onEditQueuedFollowUp: noopAsync,
    onEditLastUserTurn: noopAsync,
    onForkFromTurn: noopAsync,
    onUnarchiveThread: async () => { },
    onOpenTurnDiffReview: () => undefined,
    onConsumeComposerIntent: () => undefined,
    onOpenThread: () => undefined,
    onCleanBackgroundTerminals: noopAsync,
    onOpenCard: () => undefined,
    onNewThreadProjectChange: input.onSelect,
    onRequestNewChatProjectCreate: () => undefined,
  };
}

function buildModel(input: {
  selectedProjectId: string | null;
  state: "default" | "empty" | "disabled";
}): NewChatProjectSelectorModel {
  const projects = input.state === "empty"
    ? []
    : [
        {
          id: "nodex",
          label: "nodex",
          description: "/Users/asc/repo/nodex",
          primaryWorkspaceRoot: "/Users/asc/repo/nodex",
          searchText: "nodex /users/asc/repo/nodex",
        },
        {
          id: "devtools-codex",
          label: "devtools-codex",
          description: "/Users/asc/repo/devtools-codex",
          primaryWorkspaceRoot: "/Users/asc/repo/devtools-codex",
          searchText: "devtools-codex /users/asc/repo/devtools-codex",
        },
        {
          id: "get-job",
          label: "get-job",
          description: "/Users/asc/repo/get-job",
          primaryWorkspaceRoot: "/Users/asc/repo/get-job",
          searchText: "get-job /users/asc/repo/get-job",
        },
        {
          id: "videos",
          label: "videos",
          description: "/Users/asc/repo/videos",
          primaryWorkspaceRoot: "/Users/asc/repo/videos",
          searchText: "videos /users/asc/repo/videos",
        },
        {
          id: "c-kindavim",
          label: "c-kindavim",
          description: "/Users/asc/repo/c-kindavim",
          primaryWorkspaceRoot: "/Users/asc/repo/c-kindavim",
          searchText: "c-kindavim /users/asc/repo/c-kindavim",
        },
      ];

  return {
    projects,
    selectedProjectId: input.selectedProjectId,
    disabled: input.state === "disabled",
    canAddProject: true,
  };
}

interface StoryArgs {
  selectedProjectId: string | null;
  state: "default" | "empty" | "disabled";
}

function NewChatProjectSelectorStory(args: StoryArgs) {
  const [selectedProjectId, setSelectedProjectId] = useState(args.selectedProjectId);
  return (
    <TooltipProvider>
      <div className="min-h-[280px] bg-token-main-surface-primary p-8">
        <div className="max-w-3xl">
          <div className="relative overflow-hidden rounded-3xl bg-token-input-background/90 p-3 shadow-card-md ring ring-black/10 backdrop-blur-lg">
            <div className="min-h-16 text-sm text-token-input-placeholder-foreground">Do anything</div>
            <div className="flex items-center gap-1">
              <span className="inline-flex size-7 rounded-full bg-token-foreground/5" />
              <span className="inline-flex h-7 w-24 rounded-full bg-token-foreground/5" />
            </div>
          </div>
          <div className="-mt-2 rounded-b-2xl bg-token-sidebar-background px-2 pt-5 pb-2">
            <NewChatProjectSelector
              model={buildModel({ selectedProjectId, state: args.state })}
              actions={buildActions({ onSelect: setSelectedProjectId })}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

const meta = {
  title: "Workbench/Threads/New Chat Project Selector",
  component: NewChatProjectSelectorStory,
  args: {
    selectedProjectId: "devtools-codex",
    state: "default",
  },
  argTypes: {
    selectedProjectId: {
      control: "text",
    },
    state: {
      control: "radio",
      options: ["default", "empty", "disabled"],
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Focused Codex Electron parity story for the new-chat project selector rendered in the lower composer status row.",
      },
    },
  },
} satisfies Meta<typeof NewChatProjectSelectorStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SelectedProject: Story = {};

export const EmptyProjects: Story = {
  args: {
    selectedProjectId: null,
    state: "empty",
  },
};

export const DisabledWhileSubmitting: Story = {
  args: {
    selectedProjectId: "nodex",
    state: "disabled",
  },
};
