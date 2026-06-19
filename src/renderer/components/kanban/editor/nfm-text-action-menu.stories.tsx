import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextActionLinkIcon } from "@/components/shared/icons";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import { writeTextActionRecentColors } from "@/lib/text-action-color-recents";
import { NfmMoveToMenuSurface } from "./nfm-move-to-menu";
import { NfmTextActionMenuSurface, type NfmTextActionMenuSurfaceProps } from "./nfm-text-action-menu";

const STORY_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeStoryProject(id: string, name: string, icon?: string): Project {
  return {
    id,
    name,
    description: "",
    icon,
    sources: [],
    primaryWorkspaceRoot: null,
    pinned: false,
    pinnedOrder: null,
    created: STORY_DATE,
    updated: STORY_DATE,
  };
}

function makeStoryCard(id: string, title: string, status: CardSummary["status"], order: number): CardSummary {
  return {
    id,
    status,
    archived: false,
    title,
    tags: [],
    agentBlocked: false,
    created: STORY_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

const STORY_MOVE_TO_PROJECTS = [
  makeStoryProject("default", "Default", "🔥"),
  makeStoryProject("renderer", "Renderer parity", "🧭"),
];

const STORY_MOVE_TO_BOARD_MAP = new Map<string, BoardSummary>([
  [
    "default",
    {
      columns: [
        {
          id: "draft",
          name: "Draft",
          cards: [
            makeStoryCard("source-card", "Source card", "draft", 0),
            makeStoryCard("target-card", "Target card", "draft", 1),
          ],
        },
      ],
    },
  ],
  [
    "renderer",
    {
      columns: [
        {
          id: "backlog",
          name: "Backlog",
          cards: [makeStoryCard("runtime", "Runtime polish", "backlog", 0)],
        },
      ],
    },
  ],
]);

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
          sourceProjectId={null}
          sourceCardId={null}
          canConvertDividerToThreadSection={false}
          onSelectBlockType={() => undefined}
          onToggleStyle={() => undefined}
          onSetTextColor={() => undefined}
          onSetBackgroundColor={() => undefined}
          onClearFormat={() => undefined}
          onNodexRow={() => undefined}
          onMoveBlocksToDestination={() => undefined}
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
        key: "move-to",
        label: "Move to",
        enabled: true,
      },
    ],
    sourceProjectId: "default",
    sourceCardId: "source-card",
    renderMoveToMenu: (props) => (
      <NfmMoveToMenuSurface
        {...props}
        projects={STORY_MOVE_TO_PROJECTS}
        boardMap={STORY_MOVE_TO_BOARD_MAP}
        loading={false}
        loadError={null}
      />
    ),
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
