import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownRenderer } from "./markdown-renderer";

const meta = {
  title: "Workbench/Threads/Markdown Inline Code",
  component: MarkdownRenderer,
  parameters: {
    layout: "padded",
  },
  args: {
    content: "Run `bun test` before shipping.",
  },
  render: (args) => (
    <div className="max-w-2xl rounded-2xl bg-token-main-surface-primary px-5 py-4 text-token-foreground">
      <MarkdownRenderer {...args} />
    </div>
  ),
} satisfies Meta<typeof MarkdownRenderer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ParagraphInlineCode: Story = {};

export const HeadingInlineCode: Story = {
  args: {
    content: "## Use `bun test`\n\nThen run `bun run lint`.",
  },
};

export const ListAndPunctuation: Story = {
  args: {
    content: "- Check `README.md`.\n- Then run `bun test`, `bun run lint`, and `bun run typecheck`.",
  },
};
