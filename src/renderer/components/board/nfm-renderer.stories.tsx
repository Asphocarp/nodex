import type { Meta, StoryObj } from "@storybook/react-vite";
import { addIsoDateDays, todayIsoDate } from "@/lib/nfm/date-mention";
import { NfmRenderer } from "./nfm-renderer";

const meta = {
  title: "Board/NFM Inline Code",
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

export const DateMentionInline: Story = {
  args: {
    content: [
      `Relative date: <mention-date start="${todayIsoDate()}" format="relative" />`,
      `Overdue reminder: <mention-date start="${addIsoDateDays(todayIsoDate(), -1)}" format="relative" reminder="day:0@09:00" />`,
    ].join("\n\n"),
  },
};

export const OrderedListNumbering: Story = {
  args: {
    content: "99. Ninety-nine\n100. One hundred\n101. One hundred one",
  },
};

export const GfmTable: Story = {
  args: {
    content: "| Name | Status | Score |\n| :--- | :---: | ---: |\n| Alpha | **Ready** | 10 |\n| Beta | Blocked | 2 |",
  },
};

export const LosslessTable: Story = {
  args: {
    content: `<table header-row="false" header-column="true" fit-page-width="true">
\t<colgroup>
\t\t<col width="180" color="blue_bg" align="right" />
\t\t<col />
\t</colgroup>
\t<tr color="gray_bg">
\t\t<td>Task</td>
\t\t<td color="green_bg">Done</td>
\t</tr>
\t<tr>
\t\t<td>Follow-up</td>
\t\t<td>Pending</td>
\t</tr>
</table>`,
  },
};
