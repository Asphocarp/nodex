import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./input";
import { NodexSettingsPageSurface, NodexSettingsRow, NodexSettingsSection } from "./settings";

const meta = {
  title: "Shared UI/Input",
  component: Input,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen bg-token-side-bar-background p-6">
      <div className="mx-auto h-full max-w-5xl overflow-hidden rounded-[28px]">
        <NodexSettingsPageSurface
          title="Inputs"
          subtitle="Thin Codex-style form inputs without the old shadcn shadow/ring contract."
        >
          <NodexSettingsSection title="Examples">{children}</NodexSettingsSection>
        </NodexSettingsPageSurface>
      </div>
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <SettingsShell>
      <NodexSettingsRow label="Project name" description="Plain form input in a settings row.">
        <div className="w-72">
          <Input defaultValue="Nodex" />
        </div>
      </NodexSettingsRow>
    </SettingsShell>
  ),
};

export const Disabled: Story = {
  render: () => (
    <SettingsShell>
      <NodexSettingsRow
        label="Install path"
        description="Disabled inputs should keep the same base shell."
      >
        <div className="w-80">
          <Input value="/Users/asc/repo/nodex" disabled readOnly />
        </div>
      </NodexSettingsRow>
    </SettingsShell>
  ),
};

export const Numeric: Story = {
  render: () => (
    <SettingsShell>
      <NodexSettingsRow
        label="Interval"
        description="Number inputs only override alignment and width."
      >
        <div className="flex items-center gap-2">
          <Input type="number" defaultValue="24" className="w-16 text-right" />
          <span className="text-sm text-token-text-secondary">hours</span>
        </div>
      </NodexSettingsRow>
    </SettingsShell>
  ),
};

export const InlineOverride: Story = {
  render: () => (
    <div className="flex min-h-screen items-start justify-center bg-token-main-surface-primary p-10">
      <div className="flex w-full max-w-3xl items-center gap-2 rounded-2xl border-[0.5px] border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)] p-2">
        <Input
          className="max-w-sm border-none bg-transparent px-0 focus:border-transparent"
          placeholder="Search stories, controls, or tokens"
        />
      </div>
    </div>
  ),
};
