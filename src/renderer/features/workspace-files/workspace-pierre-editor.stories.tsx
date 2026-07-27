import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspacePierreEditor } from "./workspace-pierre-editor";

const meta: Meta = {
  title: "Workspace Files/Pierre Editor",
  component: WorkspacePierreEditor,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[520px] bg-token-main-surface-primary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const EditableTypeScript: Story = {
  args: {
    value: [
      "type Project = {",
      "  id: string;",
      "  name: string;",
      "};",
      "",
      "export const project: Project = { id: \"nodex\", name: \"Nodex\" };",
    ].join("\n"),
    filename: "project.ts",
    language: "typescript",
    sourceIdentity: "/workspace/project.ts",
    documentVersion: 0,
    ariaLabel: "Editable TypeScript",
    onChange: () => undefined,
  },
};
