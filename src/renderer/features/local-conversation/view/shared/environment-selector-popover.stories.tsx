import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { WorktreeEnvironmentOption } from "@/lib/types";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { EnvironmentSelectorPopover } from "./environment-selector-popover";

const DEFAULT_OPTIONS: WorktreeEnvironmentOption[] = [
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
];

function StorySurface({ children }: { children: React.ReactNode }) {
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start bg-token-main-surface-primary p-8">
        {children}
      </div>
    </NodexTooltipProvider>
  );
}

function EnvironmentSelectorStoryInner({
  options = DEFAULT_OPTIONS,
  selectedPath: initialSelectedPath = null,
  busy = false,
}: {
  options?: WorktreeEnvironmentOption[];
  selectedPath?: string | null;
  busy?: boolean;
}) {
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath);

  return (
    <EnvironmentSelectorPopover
      busy={busy}
      options={options}
      selectedPath={selectedPath}
      onRefresh={async () => {}}
      onSelect={async (environmentPath) => {
        setSelectedPath(environmentPath);
        return true;
      }}
      onOpenSettings={async () => {}}
    />
  );
}

const meta = {
  title: "Workbench/Threads/Selectors/Environment",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <StorySurface><EnvironmentSelectorStoryInner /></StorySurface>,
};

export const Empty: Story = {
  render: () => <StorySurface><EnvironmentSelectorStoryInner options={[]} /></StorySurface>,
};

export const Busy: Story = {
  render: () => (
    <StorySurface>
      <EnvironmentSelectorStoryInner busy={true} selectedPath=".codex/environments/environment.toml" />
    </StorySurface>
  ),
};

export const LongLabelsAndPaths: Story = {
  render: () => (
    <StorySurface>
      <EnvironmentSelectorStoryInner
        selectedPath=".codex/environments/really-long-environment-name.toml"
        options={[
          {
            path: ".codex/environments/really-long-environment-name.toml",
            name: "Really long environment name for Storybook icon sizing coverage",
            hasSetupScript: true,
            hasCleanupScript: true,
            actionCount: 3,
          },
          {
            path: ".codex/environments/mobile-release-candidate.toml",
            name: "Mobile release candidate",
            hasSetupScript: true,
            hasCleanupScript: false,
            actionCount: 0,
          },
        ]}
      />
    </StorySurface>
  ),
};

export const IconSizingRegression: Story = {
  render: () => (
    <StorySurface>
      <div className="flex items-start gap-6">
        <EnvironmentSelectorStoryInner />
        <EnvironmentSelectorStoryInner
          selectedPath=".codex/environments/test.toml"
          options={DEFAULT_OPTIONS}
        />
      </div>
    </StorySurface>
  ),
};
