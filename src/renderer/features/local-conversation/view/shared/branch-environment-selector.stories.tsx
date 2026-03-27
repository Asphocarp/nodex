import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { BranchSelectorPopover } from "./branch-selector-popover";
import { EnvironmentSelectorPopover } from "./environment-selector-popover";

function BranchEnvironmentSelectorStory() {
  const [selectedBranch, setSelectedBranch] = useState<string | null>("main");
  const [selectedEnvironmentPath, setSelectedEnvironmentPath] = useState<string | null>(null);

  return (
    <NodexTooltipProvider>
      <div className="flex min-h-60 items-start gap-4 p-8">
        <BranchSelectorPopover
          cwd="/Users/asc/repo/nodex"
          busy={false}
          state={{
            currentBranch: "main",
            defaultBranch: "main",
            branches: ["main", "refactor/settings-pages", "codex/dropdown"],
          }}
          selectedBranch={selectedBranch}
          onRefresh={async () => { }}
          onCheckout={async (branch) => {
            setSelectedBranch(branch);
            return true;
          }}
          onCreate={async (branch) => {
            setSelectedBranch(branch);
            return true;
          }}
        />

        <EnvironmentSelectorPopover
          busy={false}
          options={[
            {
              path: ".codex/environments/environment.toml",
              name: "Default",
              hasSetupScript: true,
              hasCleanupScript: false,
              actionCount: 2,
            },
            {
              path: ".codex/environments/test.toml",
              name: "Tests",
              hasSetupScript: true,
              hasCleanupScript: true,
              actionCount: 1,
            },
          ]}
          selectedPath={selectedEnvironmentPath}
          onRefresh={async () => { }}
          onSelect={async (environmentPath) => {
            setSelectedEnvironmentPath(environmentPath);
            return true;
          }}
          onOpenSettings={async () => { }}
        />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Workbench/Threads/Selectors",
  component: BranchEnvironmentSelectorStory,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof BranchEnvironmentSelectorStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
