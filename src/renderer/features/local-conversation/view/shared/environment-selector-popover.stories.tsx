import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { WorktreeEnvironmentConfigRecord } from "@/lib/types";
import { EnvironmentSelectorPopover } from "./environment-selector-popover";

const DEFAULT_PATH = ".codex/environments/environment.toml";
const BROKEN_PATH = ".codex/environments/broken.toml";

function config(input: {
  path: string;
  name: string;
  state?: WorktreeEnvironmentConfigRecord["state"];
}): WorktreeEnvironmentConfigRecord {
  const state = input.state ?? "success";
  return {
    configPath: input.path,
    fileName: input.path.split("/").at(-1) ?? input.name,
    state,
    exists: true,
    name: input.name,
    hasSetupScript: state === "success",
    hasCleanupScript: false,
    actionCount: 0,
    parseErrorMessage: state === "parseError" ? "Invalid TOML on line 4" : null,
    readErrorMessage: null,
    tooLargeMessage: null,
    environment: null,
  };
}

const CONFIGS = [
  config({ path: DEFAULT_PATH, name: "Default" }),
  config({ path: ".codex/environments/test.toml", name: "Tests" }),
];

type EnvironmentStoryState =
  | "default"
  | "selected"
  | "without"
  | "loading"
  | "query-error"
  | "empty"
  | "needs-attention"
  | "multi-root";

function EnvironmentSelectorStory({ state }: { state: EnvironmentStoryState }) {
  const initialSelectedPath = state === "selected"
    ? ".codex/environments/test.toml"
    : state === "default" || state === "multi-root"
      ? DEFAULT_PATH
      : null;
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath);
  const needsAttention = state === "needs-attention";
  const configs = needsAttention
    ? [config({ path: BROKEN_PATH, name: "Broken", state: "parseError" })]
    : state === "empty"
      ? []
      : CONFIGS;

  return (
    <NodexTooltipProvider>
      <div className="flex min-h-[360px] items-start bg-token-main-surface-primary p-8">
        <EnvironmentSelectorPopover
          defaultOpen
          busy={state === "loading"}
          error={state === "query-error"}
          configs={configs}
          selectedPath={selectedPath}
          defaultPath={DEFAULT_PATH}
          needsAttention={needsAttention}
          repairConfigPath={needsAttention ? BROKEN_PATH : null}
          repositoryName={state === "multi-root" ? "nodex" : null}
          showRepositoryName={state === "multi-root"}
          onRefresh={async () => {}}
          onSelect={async (environmentPath) => {
            setSelectedPath(environmentPath);
            return true;
          }}
          onOpenSettings={async () => {}}
        />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Workbench/Threads/Selectors/Environment",
  component: EnvironmentSelectorStory,
  parameters: { layout: "fullscreen" },
  args: { state: "default" },
  argTypes: {
    state: {
      control: "radio",
      options: [
        "default",
        "selected",
        "without",
        "loading",
        "query-error",
        "empty",
        "needs-attention",
        "multi-root",
      ],
    },
  },
} satisfies Meta<typeof EnvironmentSelectorStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { state: "selected" } };
export const WorkWithoutEnvironment: Story = { args: { state: "without" } };
export const Loading: Story = { args: { state: "loading" } };
export const QueryError: Story = { args: { state: "query-error" } };
export const Empty: Story = { args: { state: "empty" } };
export const NeedsAttention: Story = { args: { state: "needs-attention" } };
export const MultiRoot: Story = { args: { state: "multi-root" } };
