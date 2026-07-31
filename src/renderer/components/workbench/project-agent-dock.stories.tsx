import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type {
  ProjectAgentDockModel,
  ProjectAgentDockPendingWorktreeModel,
} from "@/lib/project-agent-dock-model";
import { ProjectAgentDockLeadingRow } from "./project-agent-dock";

const model: ProjectAgentDockModel = {
  trigger: {
    id: "session:worktree",
    kind: "session",
    sessionId: "session:worktree",
    label: "Refine the project board",
    statusLabel: "Draft",
    preview: null,
    selected: true,
    attention: "none",
  },
  rows: [
    {
      id: "new",
      kind: "new",
      sessionId: null,
      label: "New task",
      statusLabel: "Draft",
      preview: null,
      selected: false,
      attention: "none",
    },
  ],
  canSend: true,
  collectionMessage: null,
  hasMore: false,
};

function AgentDockLeadingRowStory({
  failed = false,
}: {
  readonly failed?: boolean;
}) {
  const [query, setQuery] = useState("");
  const pendingWorktree: ProjectAgentDockPendingWorktreeModel = failed
    ? {
        clientThreadId: "client-1",
        statusLabel: "Setup failed",
        composerBlockedReason:
          "Resolve the failed worktree setup before starting this task again",
        attention: "request",
      }
    : {
        clientThreadId: "client-1",
        statusLabel: "Running setup…",
        composerBlockedReason: "Worktree setup is already in progress",
        attention: "activity",
      };

  return (
    <div className="flex min-h-48 items-end bg-token-main-surface-primary p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-token-border/60 bg-token-input-background/90 p-2">
        <ProjectAgentDockLeadingRow
          model={model}
          query={query}
          onQueryChange={setQuery}
          onSelect={() => undefined}
          onLoadMore={() => undefined}
          onRetry={() => undefined}
          onOpenTask={() => undefined}
          pendingWorktree={pendingWorktree}
          onOpenPendingWorktreeDetails={() => undefined}
        />
        <div className="min-h-11 px-2 text-sm text-token-input-placeholder-foreground">
          {pendingWorktree.composerBlockedReason}
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Workbench/Project Agent Dock/Pending Worktree",
  component: AgentDockLeadingRowStory,
} satisfies Meta<typeof AgentDockLeadingRowStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RunningSetup: Story = {};

export const FailedSetup: Story = {
  args: { failed: true },
};
