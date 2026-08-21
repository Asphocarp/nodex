import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type KeyboardEvent } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  NfmCompactLinkToolbar,
  NfmCreateLinkDialogSurface,
  NfmLinkEditToolbarSurface,
} from "./nfm-link-toolbar-surface";

interface NfmLinkToolbarStoryProps {
  href: string;
  canOpen: boolean;
  openTooltip: string;
  disabledReason?: string;
  defaultEditing?: boolean;
}

function NfmLinkToolbarStory({
  href,
  canOpen,
  openTooltip,
  disabledReason,
  defaultEditing = false,
}: NfmLinkToolbarStoryProps) {
  const [currentHref, setCurrentHref] = useState(href);
  const [editing, setEditing] = useState(defaultEditing);

  const handleFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    }
  };

  return (
    <NodexTooltipProvider>
      <div className="min-h-screen bg-(--background) p-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-[24px] border border-(--border) bg-(--background) p-6 shadow-[0_18px_48px_rgba(0,0,0,0.14)]">
          <p className="max-w-xl text-sm text-(--foreground-secondary)">
            Story-only harness for the compact NFM link toolbar and its URL-only edit state.
          </p>

          <div className="rounded-[18px] border border-(--border) bg-(--background-secondary) p-6">
            {editing ? (
              <NfmLinkEditToolbarSurface
                urlPlaceholder="Type or paste a link"
                urlValue={currentHref}
                onUrlChange={setCurrentHref}
                onUrlKeyDown={handleFieldKeyDown}
                onApply={() => {
                  setEditing(false);
                }}
              />
            ) : (
              <NfmCompactLinkToolbar
                href={currentHref}
                canOpen={canOpen}
                openTooltip={openTooltip}
                openLabel="Open"
                clearTooltip="Clear"
                clearLabel="Clear"
                copyLabel="Copy"
                copyTooltip="Copy link"
                copiedLabel="Copied"
                copiedTooltip="Copied"
                editTooltip="Edit"
                editLabel="Edit"
                disabledReason={disabledReason}
                onOpenLink={() => {}}
                onClearLink={() => {
                  setCurrentHref("");
                  setEditing(false);
                }}
                onCopyLink={() => {}}
                onEditLink={() => {
                  setEditing(true);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Board/Editor/Link Hover Toolbar",
  component: NfmLinkToolbarStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Compact NFM link toolbar with ChatGPT-style actions and a same-size URL-only edit toolbar.",
      },
    },
  },
  args: {
    href: "https://community.openai.com/t/chinese-gambling-characters-in-codex-cli-message-and-code-output/1372678/9",
    canOpen: true,
    openTooltip: "Open in new tab",
    disabledReason: undefined,
    defaultEditing: false,
  },
} satisfies Meta<typeof NfmLinkToolbarStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WebUrl: Story = {};

export const LongWorkspacePath: Story = {
  args: {
    href: "../docs/product-specs/nfm-editor-link-behavior.md#L35",
    openTooltip: "Open in new tab",
  },
};

export const BlockedRelativeLink: Story = {
  args: {
    href: "folder/abc/file",
    canOpen: false,
    openTooltip: "Cannot resolve relative file link without project workspace.",
    disabledReason: "Cannot resolve relative file link without project workspace.",
  },
};

export const EditDialogOpen: Story = {
  args: {
    defaultEditing: true,
  },
};

export const CreateLinkDialogOpen: Story = {
  render: () => (
    <NodexTooltipProvider>
      <div className="min-h-screen bg-(--background) p-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-[24px] border border-(--border) bg-(--background) p-6 shadow-[0_18px_48px_rgba(0,0,0,0.14)]">
          <p className="max-w-xl text-sm text-(--foreground-secondary)">
            Compact formatting-toolbar create-link popover using the same Nodex tokenized surface
            language as the hover-link editor.
          </p>
          <div className="rounded-[18px] border border-(--border) bg-(--background-secondary) p-6">
            <NfmCreateLinkDialogSurface
              urlLabel="Page or URL"
              urlPlaceholder="Paste or type a link"
              urlValue="https://community.openai.com/t/example"
              submitLabel="Add link"
              onUrlChange={() => {}}
              onUrlKeyDown={() => {}}
              onSubmit={() => {}}
            />
          </div>
        </div>
      </div>
    </NodexTooltipProvider>
  ),
};
