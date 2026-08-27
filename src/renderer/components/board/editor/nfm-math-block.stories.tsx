import type { Meta, StoryObj } from "@storybook/react-vite";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { nfmSchema } from "./nfm-schema";
import { ReadonlyNfmBlockNotePreview } from "./readonly-nfm-blocknote-preview";

function MathStory({
  dark = false,
  source = String.raw`\int_0^1 x^2 \, dx = \frac{1}{3}`,
  inline = false,
}: {
  readonly dark?: boolean;
  readonly source?: string;
  readonly inline?: boolean;
}) {
  const editor = useCreateBlockNote({
    schema: nfmSchema,
    initialContent: inline
      ? [
          {
            type: "paragraph",
            content: ["Energy is ", { type: "math", content: source }, " in one line."],
          },
        ]
      : [{ type: "mathBlock", content: source }],
  });

  return (
    <NodexTooltipProvider>
      <div className="min-h-screen bg-[var(--background)] p-12 text-token-foreground">
        <div className="mx-auto w-[680px] max-w-full">
          <div className="nfm-editor">
            <BlockNoteViewRaw
              editor={editor}
              theme={dark ? "dark" : "light"}
              formattingToolbar={false}
              linkToolbar={false}
              slashMenu={false}
              sideMenu={false}
              tableHandles={false}
            />
          </div>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Board/Editor/Equation",
  component: MathStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MathStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BlockEquation: Story = {};
export const Empty: Story = { args: { source: "" } };
export const Long: Story = {
  args: {
    source: String.raw`\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}\qquad \prod_{k=1}^{m}\left(1+\frac{x}{k}\right)`,
  },
};
export const Invalid: Story = { args: { source: String.raw`\frac{broken` } };
export const Inline: Story = { args: { inline: true, source: "E = mc^2" } };
export const Dark: Story = { args: { dark: true }, globals: { theme: "dark" } };
export const ReadOnly: Story = {
  render: () => (
    <div className="min-h-screen bg-[var(--background)] p-12 text-token-foreground">
      <ReadonlyNfmBlockNotePreview
        content={"$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$"}
        projectId="storybook"
        pageId="math-readonly"
      />
    </div>
  ),
};
