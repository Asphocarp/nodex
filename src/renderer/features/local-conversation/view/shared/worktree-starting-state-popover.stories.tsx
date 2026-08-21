import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { CodexPendingWorktreeStartingState } from "../../../../../shared/codex-pending-worktree";
import { WorktreeStartingStatePopover } from "./worktree-starting-state-popover";

type StartingStateStoryState = "clean" | "dirty" | "loading" | "error" | "remote";

function StartingStateStory({ state }: { state: StartingStateStoryState }) {
  const [startingState, setStartingState] = useState<CodexPendingWorktreeStartingState>(
    state === "dirty" ? { type: "working-tree" } : { type: "branch", branchName: "main" },
  );
  const remoteBranchRefs =
    state === "remote"
      ? ["refs/remotes/origin/feature/remote-worktree", "refs/remotes/upstream/release/candidate"]
      : [];

  return (
    <NodexTooltipProvider>
      <div className="flex min-h-[360px] items-start bg-token-main-surface-primary p-8">
        <WorktreeStartingStatePopover
          defaultOpen
          cwd="/workspace/nodex"
          state={{
            currentBranch: "main",
            defaultBranch: "main",
            branches: ["main", "feature/activity-parity", "release/next"],
            remoteBranchRefs,
          }}
          startingState={startingState}
          branchLoading={state === "loading"}
          branchError={state === "error"}
          repositoryName="nodex"
          loadLocalChanges={async () => state === "dirty"}
          onRefresh={async () => {}}
          onChange={setStartingState}
        />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Workbench/Threads/Selectors/Worktree Starting State",
  component: StartingStateStory,
  parameters: { layout: "fullscreen" },
  args: { state: "clean" },
  argTypes: {
    state: {
      control: "radio",
      options: ["clean", "dirty", "loading", "error", "remote"],
    },
  },
} satisfies Meta<typeof StartingStateStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Clean: Story = {};
export const DirtyWorkingTree: Story = { args: { state: "dirty" } };
export const Loading: Story = { args: { state: "loading" } };
export const Error: Story = { args: { state: "error" } };
export const RemoteBranches: Story = { args: { state: "remote" } };
