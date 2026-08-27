import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { BlockNoteViewRaw, useCreateBlockNote } from "@blocknote/react";
import { useEffect } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { codeBlockViewState } from "@/lib/nfm/code-block-view-state";
import { NfmCodeBlockController } from "./nfm-code-block-controller";
import { nfmSchema } from "./nfm-schema";
import { NfmSideMenuOpenProvider } from "./nfm-side-menu";
import { ReadonlyNfmBlockNotePreview } from "./readonly-nfm-blocknote-preview";

const STORY_BLOCK_ID = "storybook-code-block";
const STORY_CODE = [
  "type Result<T> = { ok: true; value: T } | { ok: false; error: Error };",
  "",
  "export const unwrap = <T>(result: Result<T>): T => {",
  "  if (!result.ok) throw result.error;",
  "  return result.value;",
  "};",
].join("\n");

interface EditableCodeBlockStoryProps {
  readonly dark?: boolean;
  readonly narrow?: boolean;
  readonly wrapped?: boolean;
  readonly language?: "typescript" | "mermaid";
  readonly mermaidMode?: "code" | "preview" | "split";
  readonly code?: string;
}

function EditableCodeBlockStory({
  dark = false,
  narrow = false,
  wrapped = false,
  language = "typescript",
  mermaidMode = "split",
  code = STORY_CODE,
}: EditableCodeBlockStoryProps) {
  const editor = useCreateBlockNote({
    schema: nfmSchema,
    initialContent: [
      {
        id: STORY_BLOCK_ID,
        type: "codeBlock",
        props: { language },
        content: code,
      },
    ],
  });

  useEffect(() => {
    codeBlockViewState.setWrapped(STORY_BLOCK_ID, wrapped);
    codeBlockViewState.setMermaidPreviewMode(STORY_BLOCK_ID, mermaidMode);
    return () => {
      codeBlockViewState.setWrapped(STORY_BLOCK_ID, false);
      codeBlockViewState.setMermaidPreviewMode(STORY_BLOCK_ID, "split");
    };
  }, [mermaidMode, wrapped]);

  return (
    <NodexTooltipProvider>
      <div className="min-h-screen bg-[var(--background)] p-12 text-token-foreground">
        <div className={narrow ? "w-[220px]" : "w-[680px]"}>
          <div className="nfm-editor">
            <BlockNoteViewRaw
              editor={editor}
              theme={dark ? "dark" : "light"}
              formattingToolbar={false}
              linkToolbar={false}
              slashMenu={false}
              sideMenu={false}
              tableHandles={false}
            >
              <NfmSideMenuOpenProvider>
                <NfmCodeBlockController />
              </NfmSideMenuOpenProvider>
            </BlockNoteViewRaw>
          </div>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Board/Editor/Code Block",
  component: EditableCodeBlockStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditableCodeBlockStory>;

export default meta;
type Story = StoryObj<typeof meta>;

async function revealActionBar(canvasElement: HTMLElement) {
  const surface = await waitFor(() => {
    const candidate = canvasElement.querySelector<HTMLElement>("[data-nfm-code-block-surface]");
    if (!candidate) throw new Error("Code block surface did not render");
    return candidate;
  });
  fireEvent.pointerOver(surface);
  await waitFor(() => getByRole(document.body, "toolbar", { name: "Code block action bar" }));
}

export const EditableHover: Story = {
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const Idle: Story = {};

export const LanguagePickerOpen: Story = {
  play: async ({ canvasElement }) => {
    await revealActionBar(canvasElement);
    fireEvent.click(getByRole(document.body, "button", { name: "Open language dropdown" }));
    await waitFor(() => getByRole(document.body, "listbox", { name: "Code language" }));
  },
};

export const MoreMenuOpen: Story = {
  play: async ({ canvasElement }) => {
    await revealActionBar(canvasElement);
    fireEvent.click(getByRole(document.body, "button", { name: "Open block actions menu" }));
    await waitFor(() => getByRole(document.body, "dialog", { name: "Block actions" }));
  },
};

export const Wrapped: Story = {
  args: { wrapped: true },
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const NarrowMoreOnly: Story = {
  args: { narrow: true },
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const Dark: Story = {
  args: { dark: true },
  globals: { theme: "dark" },
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const MermaidSplit: Story = {
  args: {
    language: "mermaid",
    mermaidMode: "split",
    code: "graph TD\n  Source --> Preview\n  Preview --> Fullscreen",
  },
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const MermaidPreview: Story = {
  args: {
    language: "mermaid",
    mermaidMode: "preview",
    code: "sequenceDiagram\n  User->>Nodex: Edit source\n  Nodex-->>User: Render preview",
  },
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const MermaidInvalid: Story = {
  args: {
    language: "mermaid",
    mermaidMode: "split",
    code: "graph TD\n  A -- broken",
  },
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const MermaidDark: Story = {
  args: {
    dark: true,
    language: "mermaid",
    mermaidMode: "split",
    code: "graph LR\n  Dark --> Theme\n  Theme --> Diagram",
  },
  globals: { theme: "dark" },
  play: async ({ canvasElement }) => revealActionBar(canvasElement),
};

export const ReadOnly: Story = {
  render: () => (
    <NodexTooltipProvider>
      <div className="min-h-screen bg-[var(--background)] p-12 text-token-foreground">
        <div className="w-[680px]">
          <ReadonlyNfmBlockNotePreview
            content={`\`\`\`ts\n${STORY_CODE}\n\`\`\``}
            projectId="storybook"
            pageId="code-block-readonly"
          />
        </div>
      </div>
    </NodexTooltipProvider>
  ),
};
