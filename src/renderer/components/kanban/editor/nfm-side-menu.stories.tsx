import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  moveNfmSideMenuFocus,
  type NfmSideMenuSubmenuKey,
} from "./nfm-side-menu-model";
import { NfmSideMenuSurface } from "./nfm-side-menu";

interface SideMenuStorySurfaceProps {
  initialQuery?: string;
  initialSubmenu?: NfmSideMenuSubmenuKey | null;
  canUseColor?: boolean;
  canSendBlocks?: boolean;
  currentBlockType?: string;
  isTableBlock?: boolean;
  canUseTableHeaders?: boolean;
  narrow?: boolean;
}

function SideMenuStorySurface({
  initialQuery = "",
  initialSubmenu = null,
  canUseColor = true,
  canSendBlocks = true,
  currentBlockType = "paragraph",
  isTableBlock = false,
  canUseTableHeaders = false,
  narrow = false,
}: SideMenuStorySurfaceProps) {
  const [query, setQuery] = useState(initialQuery);
  const [focusedIndex, setFocusedIndex] = useState(query ? 0 : -1);
  const [activeSubmenu, setActiveSubmenu] = useState<NfmSideMenuSubmenuKey | null>(initialSubmenu);
  const baseSections = useMemo(() => buildNfmSideMenuSections({
    currentBlockId: "block-1",
    currentBlockType,
    isEditable: true,
    canUseColor,
    canSendBlocks,
    hasConvertDividerToThreadSection: currentBlockType === "divider",
    isTableBlock,
    canUseTableHeaders,
  }), [
    canSendBlocks,
    canUseColor,
    canUseTableHeaders,
    currentBlockType,
    isTableBlock,
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
            { key: "bullet-list", label: "Bulleted list", type: "bulletListItem", enabled: true },
            { key: "code", label: "Code", type: "codeBlock", enabled: true },
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
          textColor="blue"
          backgroundColor="yellow"
          footerPrimary="Last edited locally"
          footerSecondary="Now"
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
          onSendBlocks={() => undefined}
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
