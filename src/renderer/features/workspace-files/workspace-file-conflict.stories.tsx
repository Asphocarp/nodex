import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceFileConflict } from "./workspace-file-conflict";

const meta = {
  title: "Workspace Files/External Change Conflict",
  component: WorkspaceFileConflict,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[560px] bg-token-main-surface-primary">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkspaceFileConflict>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conflict: Story = {
  args: {
    filename: "project.ts",
    diskValue: "export const project = \"disk\";\n",
    localValue: "export const project = \"local\";\n",
    onUseDisk: () => undefined,
    onKeepLocal: () => undefined,
  },
};
