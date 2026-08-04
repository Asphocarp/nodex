import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileLinkAnchor } from "./file-link-anchor";
import { FileReferenceRouterProvider } from "@/lib/file-reference-router";

const meta = {
  title: "Workbench/References/File reference",
  component: FileLinkAnchor,
  parameters: {
    layout: "padded",
  },
  args: {
    href: "/workspace/project/src/index.ts#L19C4",
    children: "src/index.ts:19",
    showLocalFileTooltip: true,
  },
  decorators: [
    (Story) => (
      <FileReferenceRouterProvider
        workspaceRoot="/workspace/project"
        openWorkspaceFileTab={async () => true}
      >
        <div className="max-w-xl bg-token-main-surface-primary p-5 text-token-foreground">
          <Story />
        </div>
      </FileReferenceRouterProvider>
    ),
  ],
} satisfies Meta<typeof FileLinkAnchor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PanelFirst: Story = {};

export const WorkspaceRelative: Story = {
  args: {
    href: "src/components/App.tsx#L42",
    children: "App.tsx:42",
    showLocalFileTooltip: false,
  },
};
