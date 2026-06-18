import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextActionLinkIcon } from "@/components/shared/icons";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import { writeTextActionRecentColors } from "@/lib/text-action-color-recents";
import { NfmTextActionMenuSurface, type NfmTextActionMenuSurfaceProps } from "./nfm-text-action-menu";

function TextActionMenuStorySurface(
  props: Partial<NfmTextActionMenuSurfaceProps>,
) {
  return (
    <NodexTooltipProvider>
      <div className="flex min-h-screen items-start justify-center bg-token-editor-background p-12 text-token-foreground">
        <NfmTextActionMenuSurface
          currentBlockTypeLabel="Normal Text"
          blockTypeItems={[
            {
              key: "paragraph",
              label: "Normal Text",
              type: "paragraph",
              isSelected: true,
            },
            {
              key: "heading-1",
              label: "Heading 1",
              type: "heading",
              props: { level: 1, isToggleable: false },
              isSelected: false,
            },
            {
              key: "heading-2",
              label: "Heading 2",
              type: "heading",
              props: { level: 2, isToggleable: false },
              isSelected: false,
            },
          ]}
          activeStyles={{
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            code: false,
          }}
          textColor="default"
          backgroundColor="default"
          canUseTextColor={true}
          canUseBackgroundColor={true}
          canClearFormat={true}
          linkControl={(
            <button
              type="button"
              aria-label="Link"
              className="flex h-7 w-8 items-center justify-center rounded-[6px] text-token-foreground hover:bg-token-list-hover-background"
            >
              <TextActionLinkIcon />
            </button>
          )}
          nodexRows={[]}
          canConvertDividerToThreadSection={false}
          onSelectBlockType={() => undefined}
          onToggleStyle={() => undefined}
          onSetTextColor={() => undefined}
          onSetBackgroundColor={() => undefined}
          onClearFormat={() => undefined}
          onNodexRow={() => undefined}
          onConvertDividerToThreadSection={() => undefined}
          {...props}
        />
      </div>
    </NodexTooltipProvider>
  );
}

const meta = {
  title: "Kanban/Editor/Text Action Menu",
  component: TextActionMenuStorySurface,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Notion-parity floating text action menu for expanded NFM rich-text selections.",
      },
    },
  },
} satisfies Meta<typeof TextActionMenuStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ActiveMarks: Story = {
  args: {
    activeStyles: {
      bold: true,
      italic: true,
      underline: false,
      strike: true,
      code: false,
    },
    textColor: "blue",
    backgroundColor: "yellow",
  },
};

export const TextColorMenu: Story = {
  args: {
    textColor: "blue",
    backgroundColor: "yellow",
  },
  render: (args) => {
    writeTextActionRecentColors([
      { kind: "text", color: "blue" },
      { kind: "text", color: "pink" },
      { kind: "background", color: "red" },
      { kind: "background", color: "purple" },
      { kind: "background", color: "green" },
    ]);

    return <TextActionMenuStorySurface {...args} />;
  },
  parameters: {
    docs: {
      description: {
        story: "Open the Color button to inspect the 190px Notion-style swatch grid with five persisted recent color slots.",
      },
    },
  },
};

export const WithNodexActions: Story = {
  args: {
    nodexRows: [
      {
        key: "send-section-to-codex",
        label: "Send to chat",
        enabled: true,
      },
      {
        key: "append-blocks-to-card",
        label: "Move to card",
        enabled: true,
        mode: "card",
      },
      {
        key: "turn-blocks-into-cards",
        label: "Turn into cards",
        enabled: true,
        mode: "project",
      },
    ],
  },
};

export const DividerBlockActions: Story = {
  args: {
    currentBlockTypeLabel: "Divider",
    canConvertDividerToThreadSection: true,
    nodexRows: [
      {
        key: "convert-divider-to-thread-section",
        label: "Make thread section",
        enabled: true,
      },
    ],
  },
};

export const DisabledReferenceMocks: Story = {
  args: {
    canUseTextColor: false,
    canUseBackgroundColor: false,
    canClearFormat: false,
  },
};
