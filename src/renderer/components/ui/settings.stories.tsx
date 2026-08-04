import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  NodexSettingsPageSurface,
  NodexSettingsRow,
  NodexSettingsSection,
} from "./settings";

const meta = {
  title: "UI/Settings",
  component: NodexSettingsPageSurface,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Shared Codex-style settings page, section, and row primitives used by every Nodex settings route.",
      },
    },
  },
} satisfies Meta<typeof NodexSettingsPageSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DenseRows: Story = {
  args: {
    title: "General",
    children: null,
  },
  render: () => (
    <div className="h-screen w-full overflow-hidden bg-token-main-surface-primary">
      <NodexSettingsPageSurface
        title="General"
        subtitle="App-wide shell behavior and notifications."
      >
        <NodexSettingsSection title="App">
          <NodexSettingsRow
            label="Desktop notifications"
            description="Configure turn-complete, approval, and request-user-input notifications."
          >
            <button type="button" className="rounded-lg px-2 py-1 text-sm hover:bg-token-list-hover-background">
              Configure
            </button>
          </NodexSettingsRow>
          <NodexSettingsRow
            label="Long explanatory copy"
            description="This row intentionally contains enough explanatory text to demonstrate that settings descriptions wrap within the centered content column instead of being truncated."
          >
            <button type="button" className="rounded-lg px-2 py-1 text-sm hover:bg-token-list-hover-background">
              Enabled
            </button>
          </NodexSettingsRow>
        </NodexSettingsSection>
        <NodexSettingsSection title="Diagnostics">
          <NodexSettingsRow
            label="Send diagnostics"
            description="Optional masked diagnostics remain visually subordinate to the primary setting label."
          >
            <button type="button" className="rounded-lg px-2 py-1 text-sm hover:bg-token-list-hover-background">
              Off
            </button>
          </NodexSettingsRow>
        </NodexSettingsSection>
      </NodexSettingsPageSurface>
    </div>
  ),
};
