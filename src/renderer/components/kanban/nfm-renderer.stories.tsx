import type { Meta, StoryObj } from "@storybook/react-vite";
import { NfmRenderer } from "./nfm-renderer";

const meta = {
  title: "Kanban/NFM Inline Code",
  component: NfmRenderer,
  parameters: {
    layout: "padded",
  },
  args: {
    content: "Paragraph with `inline code`, **bold text**, and a [link](https://example.com).",
  },
  render: (args) => (
    <div className="max-w-2xl rounded-2xl bg-token-main-surface-primary px-5 py-4 text-token-foreground">
      <NfmRenderer {...args} />
    </div>
  ),
} satisfies Meta<typeof NfmRenderer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ParagraphInlineCode: Story = {};

export const HeadingInlineCode: Story = {
  args: {
    content: "## Heading with `inline code`\n\nParagraph with `another value`.",
  },
};

export const MixedFormatting: Story = {
  args: {
    content: "List item with `inline code`, *emphasis*, and ~~strikethrough~~.\n- Another `code sample` here.",
  },
};

export const RelativeFileLink: Story = {
  args: {
    content: "Relative file link: [spec](folder/abc/file)",
    projectWorkspacePath: "/Users/asc/repo/nodex2",
  },
};
