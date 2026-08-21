import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadonlyNfmBlockNotePreview } from "@/components/board/editor/readonly-nfm-blocknote-preview";
import { MarkdownRenderer } from "./markdown-renderer";

const TYPESCRIPT_CODE_BLOCK = [
  "```ts",
  "type CodeBlockState = { language: string; copied: boolean };",
  "",
  "export function describeState(state: CodeBlockState) {",
  '  return `${state.language}:${state.copied ? "copied" : "idle"}`;',
  "}",
  "```",
].join("\n");

const LONG_LINE_CODE_BLOCK = [
  "```ts",
  'const command = "bun run typecheck && bun run lint && bun test src/renderer/features/local-conversation/view/shared/markdown/markdown-renderer.test.tsx src/renderer/components/board/nfm-renderer.test.tsx";',
  "console.log(command);",
  "```",
].join("\n");

const UNKNOWN_LANGUAGE_CODE_BLOCK = [
  "```madeuplang",
  "pipeline -> parse -> render -> copy",
  "```",
].join("\n");

function CodeBlockParityFrame(args: { content: string }) {
  return (
    <div className="grid max-w-5xl gap-6 bg-token-main-surface-primary px-5 py-4 text-token-foreground md:grid-cols-2">
      <section className="min-w-0">
        <h3 className="mb-3 text-xs font-medium tracking-normal text-token-description-foreground">
          Thread Streamdown
        </h3>
        <MarkdownRenderer {...args} />
      </section>
      <section className="min-w-0">
        <h3 className="mb-3 text-xs font-medium tracking-normal text-token-description-foreground">
          NFM BlockNote
        </h3>
        <ReadonlyNfmBlockNotePreview
          content={args.content}
          projectId="storybook-code-block-project"
          pageId="storybook-code-block-card"
          historyId="code-block-parity"
        />
      </section>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Markdown Parity",
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
    content:
      "- Check `README.md`.\n- Then run `bun test`, `bun run lint`, and `bun run typecheck`.",
  },
};

export const OrderedListGrouping: Story = {
  args: {
    content: "99. Ninety-nine\n100. One hundred\n101. One hundred one",
  },
};

export const BlockquoteTableAndDetails: Story = {
  args: {
    content: [
      "> Quote block",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| Foo | Bar |",
      "",
      "<details><summary>More</summary>Body</details>",
    ].join("\n"),
  },
};

export const CodeBlockParity: Story = {
  args: {
    content: TYPESCRIPT_CODE_BLOCK,
  },
  render: CodeBlockParityFrame,
};

export const LongLineCodeBlockParity: Story = {
  args: {
    content: LONG_LINE_CODE_BLOCK,
  },
  render: CodeBlockParityFrame,
};

export const UnknownLanguageCodeBlockParity: Story = {
  args: {
    content: UNKNOWN_LANGUAGE_CODE_BLOCK,
  },
  render: CodeBlockParityFrame,
};
