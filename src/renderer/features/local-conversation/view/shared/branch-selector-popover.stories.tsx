import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { BranchSelectorPopover } from "./branch-selector-popover";

function StorySurface({ children }: { children: React.ReactNode }) {
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start bg-token-main-surface-primary p-8">
        {children}
      </div>
    </NodexTooltipProvider>
  );
}

function BranchSelectorStory({
  cwd = "/Users/asc/repo/nodex",
  busy = false,
  loading = false,
  error = false,
  branches = ["main", "refactor/settings-pages", "codex/dropdown"],
  selectedBranch: initialSelectedBranch = "main",
}: {
  cwd?: string | null;
  busy?: boolean;
  loading?: boolean;
  error?: boolean;
  branches?: string[];
  selectedBranch?: string | null;
}) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(initialSelectedBranch);

  return (
    <StorySurface>
      <BranchSelectorPopover
        cwd={cwd}
        busy={busy}
        loading={loading}
        error={error}
        state={{
          currentBranch: branches[0] ?? null,
          defaultBranch: branches[0] ?? null,
          branches,
        }}
        selectedBranch={selectedBranch}
        onRefresh={async () => {}}
        onCheckout={async (branch) => {
          setSelectedBranch(branch);
          return true;
        }}
        onCreate={async (branch) => {
          setSelectedBranch(branch);
          return true;
        }}
      />
    </StorySurface>
  );
}

const meta = {
  title: "Workbench/Threads/Selectors/Branch",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <BranchSelectorStory />,
};

export const EmptyRepository: Story = {
  render: () => <BranchSelectorStory branches={[]} selectedBranch={null} />,
};

export const Busy: Story = {
  render: () => <BranchSelectorStory busy={true} />,
};

export const Loading: Story = {
  render: () => <BranchSelectorStory loading branches={[]} selectedBranch={null} />,
};

export const Error: Story = {
  render: () => <BranchSelectorStory error branches={[]} selectedBranch={null} />,
};

export const LongBranchNames: Story = {
  render: () => (
    <BranchSelectorStory
      branches={[
        "feature/really-long-branch-name-for-a-multi-step-settings-environment-rewrite",
        "refactor/storybook-coverage-for-shared-ui-dropdowns",
        "main",
      ]}
      selectedBranch="feature/really-long-branch-name-for-a-multi-step-settings-environment-rewrite"
    />
  ),
};

export const MissingWorkingDirectory: Story = {
  render: () => <BranchSelectorStory cwd={null} branches={[]} selectedBranch={null} />,
};
