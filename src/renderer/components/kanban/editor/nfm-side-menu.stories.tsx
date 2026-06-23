import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import { NfmMoveToMenuSurface } from "./nfm-move-to-menu";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  moveNfmSideMenuFocus,
  type NfmSideMenuSubmenuKey,
} from "./nfm-side-menu-model";
import { NfmSideMenuSurface } from "./nfm-side-menu";

const STORY_DATE = new Date("2026-01-01T00:00:00.000Z");

function makeProject(id: string, name: string, icon?: string): Project {
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

function makeCard(id: string, title: string, status: CardSummary["status"], order: number): CardSummary {
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

const MOVE_TO_PROJECTS = [
  makeProject("default", "Default", "🔥"),
  makeProject("renderer-parity", "Renderer parity with an intentionally long project label", "🧭"),
];

const MOVE_TO_BOARD_MAP = new Map<string, BoardSummary>([
  [
    "default",
    {
      columns: [
        {
          id: "draft",
          name: "Draft",
          cards: [
            makeCard("source-card", "Source card hidden from append targets", "draft", 0),
            makeCard("nfm-dnd", "test-nfm-editor-dnd", "draft", 1),
            makeCard("queue", "queue", "draft", 2),
            makeCard("editor", "dig into editor", "draft", 3),
          ],
        },
        {
          id: "in_progress",
          name: "In Progress",
          cards: [
            makeCard("rich-selection", "Rich selection send workflow", "in_progress", 0),
            makeCard("card-stage", "Card Stage compact controls", "in_progress", 1),
          ],
        },
      ],
    },
  ],
  [
    "renderer-parity",
    {
      columns: [
        {
          id: "backlog",
          name: "Backlog with a long label",
          cards: [
            makeCard("projection", "Projection pipeline cleanup", "backlog", 0),
            makeCard("request-lanes", "Request lanes and composer cards", "backlog", 1),
          ],
        },
      ],
    },
  ],
]);

interface SideMenuStorySurfaceProps {
  initialQuery?: string;
  initialSubmenu?: NfmSideMenuSubmenuKey | null;
  selectionTitle?: string;
  selectedTopLevelBlockCount?: number;
  canUseColor?: boolean;
  canSendBlocks?: boolean;
  currentBlockType?: string;
  isTableBlock?: boolean;
  canUseTableHeaders?: boolean;
  footerPrimary?: string | null;
  footerSecondary?: string | null;
  narrow?: boolean;
  moveToInitialQuery?: string;
  moveToLoading?: boolean;
  moveToError?: string | null;
}

function SideMenuStorySurface({
  initialQuery = "",
  initialSubmenu = null,
  selectionTitle = "Text",
  selectedTopLevelBlockCount = 1,
  canUseColor = true,
  canSendBlocks = true,
  currentBlockType = "paragraph",
  isTableBlock = false,
  canUseTableHeaders = false,
  footerPrimary = "Last edited locally",
  footerSecondary = "Now",
  narrow = false,
  moveToInitialQuery = "",
  moveToLoading = false,
  moveToError = null,
}: SideMenuStorySurfaceProps) {
  const [query, setQuery] = useState(initialQuery);
  const [focusedIndex, setFocusedIndex] = useState(query ? 0 : -1);
  const [activeSubmenu, setActiveSubmenu] = useState<NfmSideMenuSubmenuKey | null>(initialSubmenu);
  const baseSections = useMemo(() => buildNfmSideMenuSections({
    currentBlockId: "block-1",
    currentBlockType,
    selectionTitle,
    selectedTopLevelBlockCount,
    isEditable: true,
    canUseColor,
    canSendBlocks,
    hasConvertDividerToThreadSection: currentBlockType === "divider",
    isTableBlock,
    canUseTableHeaders,
    showMockActions: true,
  }), [
    canSendBlocks,
    canUseColor,
    canUseTableHeaders,
    currentBlockType,
    isTableBlock,
    selectedTopLevelBlockCount,
    selectionTitle,
  ]);
  const sections = useMemo(() => filterNfmSideMenuSections(baseSections, query), [baseSections, query]);
  const flatRows = useMemo(() => flattenNfmSideMenuRows(sections), [sections]);

  return (
    <div className="min-h-screen bg-token-editor-background p-10 text-token-foreground">
      <div className={narrow ? "w-[300px]" : "w-[520px]"}>
        <NfmSideMenuSurface
          sections={sections}
          query={query}
          focusedIndex={focusedIndex}
          activeSubmenu={activeSubmenu}
          listboxId="storybook-side-menu-listbox"
          comboboxId="storybook-side-menu-combobox"
          activeDescendantId={focusedIndex >= 0 ? `storybook-side-menu-listbox-option-${focusedIndex}` : undefined}
          turnIntoItems={[
            { key: "paragraph", label: "Text", type: "paragraph", enabled: true },
            { key: "heading-1", label: "Heading 1", type: "heading", props: { level: 1, isToggleable: false }, enabled: true },
            { key: "toggle-heading-1", label: "Toggle heading 1", type: "heading", props: { level: 1, isToggleable: true }, enabled: true },
            { key: "toggle-heading-2", label: "Toggle heading 2", type: "heading", props: { level: 2, isToggleable: true }, enabled: true },
            { key: "toggle-heading-3", label: "Toggle heading 3", type: "heading", props: { level: 3, isToggleable: true }, enabled: true },
            { key: "bullet-list", label: "Bulleted list", type: "bulletListItem", enabled: true },
            { key: "code", label: "Code", type: "codeBlock", enabled: true },
            { key: "callout", label: "Callout", type: "callout", enabled: true },
          ]}
          colorOptions={[
            { color: "default", label: "Default" },
            { color: "gray", label: "Gray" },
            { color: "red", label: "Red" },
            { color: "yellow", label: "Yellow" },
            { color: "blue", label: "Blue" },
          ]}
          canUseTextColor={canUseColor}
          canUseBackgroundColor={canUseColor}
          canSendBlocks={canSendBlocks}
          sourceProjectId="default"
          sourceCardId="source-card"
          textColor="blue"
          backgroundColor="yellow"
          footerPrimary={footerPrimary}
          footerSecondary={footerSecondary}
          onQueryChange={(nextQuery) => {
            setQuery(nextQuery);
            setFocusedIndex(nextQuery ? 0 : -1);
          }}
          onFocusIndexChange={setFocusedIndex}
          onMoveFocus={(direction) => {
            setFocusedIndex((currentIndex) => moveNfmSideMenuFocus(currentIndex, direction, flatRows));
          }}
          onActivateFocused={() => undefined}
          onClose={() => undefined}
          onAction={(row) => {
            if (row.submenu) setActiveSubmenu(row.submenu);
          }}
          onSubmenuChange={setActiveSubmenu}
          onTurnInto={() => undefined}
          onColor={() => undefined}
          onMoveBlocksToDestination={() => undefined}
          renderMoveToMenu={(props) => (
            <NfmMoveToMenuSurface
              {...props}
              projects={MOVE_TO_PROJECTS}
              boardMap={MOVE_TO_BOARD_MAP}
              loading={moveToLoading}
              loadError={moveToError}
              initialQuery={moveToInitialQuery}
            />
          )}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Kanban/Editor/Side Menu",
  component: SideMenuStorySurface,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Reference-parity block side menu for NFM editor drag handles and Cmd/Ctrl+/.",
      },
    },
  },
} satisfies Meta<typeof SideMenuStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TextBlock: Story = {
  args: {
    selectionTitle: "Text",
    currentBlockType: "paragraph",
  },
};

export const CodeBlock: Story = {
  args: {
    selectionTitle: "Code",
    currentBlockType: "codeBlock",
  },
};

export const HeadingBlock: Story = {
  args: {
    selectionTitle: "Heading 2",
    currentBlockType: "heading",
  },
};

export const ThreeBlocks: Story = {
  args: {
    selectionTitle: "3 blocks",
    selectedTopLevelBlockCount: 3,
  },
};

export const CardReferenceBlock: Story = {
  args: {
    selectionTitle: "Card reference",
    currentBlockType: "cardRef",
  },
};

export const ReferenceMocks: Story = {};

export const NoFooterMetadata: Story = {
  args: {
    footerPrimary: null,
    footerSecondary: null,
  },
};

export const SearchNoResults: Story = {
  args: {
    initialQuery: "zzzz",
  },
};

export const DisabledReferenceMocks: Story = {
  args: {
    canUseColor: false,
    canSendBlocks: false,
  },
};

export const TurnIntoSubmenu: Story = {
  args: {
    initialSubmenu: "turn-into",
  },
};

export const CardInSubmenu: Story = {
  args: {
    initialSubmenu: "turn-into",
    moveToInitialQuery: "renderer",
  },
};

export const ColorSubmenu: Story = {
  args: {
    initialSubmenu: "color",
  },
};

export const MoveToSubmenu: Story = {
  args: {
    initialSubmenu: "move-to",
  },
};

export const MoveToSubmenuSearch: Story = {
  args: {
    initialSubmenu: "move-to",
    moveToInitialQuery: "renderer",
  },
};

export const MoveToSubmenuFuzzySearch: Story = {
  args: {
    initialSubmenu: "move-to",
    moveToInitialQuery: "projction pipline",
  },
};

export const MoveToSubmenuLoading: Story = {
  args: {
    initialSubmenu: "move-to",
    moveToLoading: true,
  },
};

export const MoveToSubmenuNoResults: Story = {
  args: {
    initialSubmenu: "move-to",
    moveToInitialQuery: "zzzz",
  },
};

export const MoveToSubmenuError: Story = {
  args: {
    initialSubmenu: "move-to",
    moveToError: "Something went wrong",
  },
};

export const TableBlock: Story = {
  args: {
    currentBlockType: "table",
    isTableBlock: true,
    canUseTableHeaders: true,
  },
};

export const NarrowViewport: Story = {
  args: {
    narrow: true,
  },
};
