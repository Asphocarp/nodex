import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type {
  ProjectAgentDockModel,
  ProjectAgentDockPendingWorktreeModel,
} from "@/lib/project-agent-dock-model";
import {
  ComposerContextRail,
  ComposerContextRailSlot,
} from "@/features/local-conversation/view/composer-context-rail";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { ProjectAgentDockLeadingRow } from "./project-agent-dock";

const model: ProjectAgentDockModel = {
  trigger: {
    id: "session:worktree",
    kind: "session",
    sessionId: "session:worktree",
    label: "Refine the project board",
    preview: null,
    selected: true,
    attention: "none",
    indicator: "idle",
  },
  rows: [
    {
      id: "new",
      kind: "new",
      sessionId: null,
      label: "New chat",
      preview: null,
      selected: false,
      attention: "none",
      indicator: "idle",
    },
  ],
  canSend: true,
  collectionMessage: null,
  hasMore: false,
};

function pendingWorktreeFor(
  setupState: "running" | "failed" | null,
): ProjectAgentDockPendingWorktreeModel | null {
  if (setupState === "failed") {
    return {
      clientThreadId: "client-1",
      statusLabel: "Setup failed",
      composerBlockedReason:
        "Resolve the failed worktree setup before starting this chat again",
      attention: "request",
    };
  }
  if (setupState === "running") {
    return {
      clientThreadId: "client-1",
      statusLabel: "Running setup…",
      composerBlockedReason: "Worktree setup is already in progress",
      attention: "activity",
    };
  }
  return null;
}

function AgentDockLeadingRowStory({
  setupState = null,
}: {
  readonly setupState?: "running" | "failed" | null;
}) {
  const [query, setQuery] = useState("");
  const pendingWorktree = pendingWorktreeFor(setupState);

  return (
    <NodexTooltipProvider>
      <div className="flex min-h-48 items-end bg-token-main-surface-primary p-8">
        <div className="w-full max-w-2xl">
          <ComposerContextRailSlot visible>
            <ComposerContextRail>
              <ProjectAgentDockLeadingRow
                model={model}
                query={query}
                onQueryChange={setQuery}
                onSelect={() => undefined}
                onLoadMore={() => undefined}
                onRetry={() => undefined}
                onOpenChat={() => undefined}
                pendingWorktree={pendingWorktree}
                onOpenPendingWorktreeDetails={() => undefined}
              />
              <span aria-hidden="true" className="order-2 min-w-0 flex-1" />
            </ComposerContextRail>
          </ComposerContextRailSlot>
          <div className="composer-surface-chrome relative z-10 flex min-h-11 items-center bg-token-input-background/90 px-3 text-sm text-token-input-placeholder-foreground backdrop-blur-lg electron:dark:bg-token-dropdown-background">
            {pendingWorktree?.composerBlockedReason ?? "Do anything"}
          </div>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Workbench/Project Agent Dock/Leading Row",
  component: AgentDockLeadingRowStory,
} satisfies Meta<typeof AgentDockLeadingRowStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ConnectedChat: Story = {};

export const RunningSetup: Story = {
  args: { setupState: "running" },
};

export const FailedSetup: Story = {
  args: { setupState: "failed" },
};
