import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { NewChatStartInTarget } from "@/lib/new-chat-start-in-selector";
import type { NewChatStartInSelectorModel, ThreadStageActions } from "../../thread-stage-types";
import {
  ComposerContextRail,
  ComposerContextRailSlot,
} from "../composer-context-rail";
import { NewChatStartInSelector } from "./new-chat-start-in-selector";

interface StoryArgs {
  target: "localProject" | "newWorktree";
  state: "default" | "disabled" | "nonGit";
}

function buildActions(onSelect: (target: NewChatStartInTarget) => void): ThreadStageActions {
  const noopAsync = async () => undefined;
  return {
    onCollaborationModeChange: () => undefined,
    onModelChange: () => undefined,
    onReasoningEffortChange: () => undefined,
    onPermissionModeChange: () => undefined,
    onQueueingEnabledChange: () => undefined,
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
    onNewThreadStartInTargetChange: onSelect,
  };
}

function buildModel(target: NewChatStartInTarget, state: StoryArgs["state"]): NewChatStartInSelectorModel {
  return {
    target,
    disabled: state === "disabled",
    worktreeAvailable: state !== "nonGit",
    environments: [
      {
        path: ".codex/environments/ui-polish.toml",
        name: "UI polish",
        hasSetupScript: true,
        hasCleanupScript: false,
        actionCount: 1,
      },
    ],
    environmentsLoading: false,
    selectedEnvironmentPath: target.runInEnvironmentPath ?? null,
    worktreeStartMode: target.worktreeStartMode ?? "detachedHead",
    worktreeBranchPrefix: target.worktreeBranchPrefix ?? "nodex/",
  };
}

function NewChatStartInSelectorStory(args: StoryArgs) {
  const [target, setTarget] = useState<NewChatStartInTarget>({
    runInTarget: args.target,
    runInEnvironmentPath: args.target === "newWorktree" ? ".codex/environments/ui-polish.toml" : null,
    worktreeStartMode: "detachedHead",
    worktreeBranchPrefix: "nodex/",
  });

  return (
    <TooltipProvider>
      <div className="min-h-[360px] bg-token-main-surface-primary p-8" data-codex-window-type="electron">
        <div className="max-w-3xl">
          <ComposerContextRailSlot visible>
            <ComposerContextRail>
              <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
                <span className="inline-flex h-7 max-w-40 items-center rounded-full px-1.5 text-sm text-token-text-tertiary">
                  nodex
                </span>
                <NewChatStartInSelector
                  model={buildModel(target, args.state)}
                  actions={buildActions((nextTarget) => setTarget(nextTarget))}
                  disabled={args.state === "disabled"}
                  worktreeAvailable={args.state !== "nonGit"}
                />
                <span className="inline-flex h-7 max-w-40 items-center rounded-full px-1.5 text-sm text-token-text-tertiary">
                  main
                </span>
              </div>
            </ComposerContextRail>
          </ComposerContextRailSlot>
          <div className="composer-surface-chrome relative z-10 flex flex-col bg-token-input-background/90 backdrop-blur-lg electron:dark:bg-token-dropdown-background _multilineSurface_1u8sk_2">
            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
              <div className="mb-1 min-h-16 px-3 pt-3 text-sm text-token-input-placeholder-foreground">Do anything</div>
              <div className="mb-2 flex items-center gap-1 px-2">
                <span className="inline-flex size-7 rounded-full bg-token-foreground/5" />
                <span className="inline-flex h-7 w-28 rounded-full bg-token-foreground/5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

const meta = {
  title: "Workbench/Threads/New Chat Start In Selector",
  component: NewChatStartInSelectorStory,
  args: {
    target: "localProject",
    state: "default",
  },
  argTypes: {
    target: {
      control: "radio",
      options: ["localProject", "newWorktree"],
    },
    state: {
      control: "radio",
      options: ["default", "disabled", "nonGit"],
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Focused Codex Electron parity story for the new-chat Start in selector rendered between project and branch controls.",
      },
    },
  },
} satisfies Meta<typeof NewChatStartInSelectorStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WorkLocally: Story = {};

export const NewWorktree: Story = {
  args: {
    target: "newWorktree",
    state: "default",
  },
};

export const NonGitProject: Story = {
  args: {
    target: "localProject",
    state: "nonGit",
  },
};

export const DisabledWhileSubmitting: Story = {
  args: {
    target: "localProject",
    state: "disabled",
  },
};
