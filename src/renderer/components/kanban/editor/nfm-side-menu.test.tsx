import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { useMemo, useState } from "react";
import { render } from "@/test/dom";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  type NfmSideMenuSubmenuKey,
  type SendBlocksMode,
} from "./nfm-side-menu-model";
import { NfmSideMenuSurface } from "./nfm-side-menu";

function renderSideMenuSurface({
  initialQuery = "",
  initialFocusedIndex = -1,
}: {
  initialQuery?: string;
  initialFocusedIndex?: number;
} = {}) {
  const calls = {
    rows: [] as string[],
    queries: [] as string[],
    close: 0,
  };
  let query = initialQuery;
  let focusedIndex = initialFocusedIndex;
  let activeSubmenu: NfmSideMenuSubmenuKey | null = null;
  const baseSections = buildNfmSideMenuSections({
    currentBlockId: "block-1",
    currentBlockType: "paragraph",
    isEditable: true,
    canUseColor: true,
    canSendBlocks: true,
    hasConvertDividerToThreadSection: false,
    isTableBlock: false,
    canUseTableHeaders: false,
  });

  const renderSurface = () => {
    const sections = filterNfmSideMenuSections(baseSections, query);
    const flatRows = flattenNfmSideMenuRows(sections);
    return (
      <NfmSideMenuSurface
        sections={sections}
        query={query}
        focusedIndex={focusedIndex}
        activeSubmenu={activeSubmenu}
        listboxId="side-menu-listbox"
        comboboxId="side-menu-combobox"
        activeDescendantId={focusedIndex >= 0 ? `side-menu-listbox-option-${focusedIndex}` : undefined}
        turnIntoItems={[
          { key: "paragraph", label: "Text", type: "paragraph", enabled: true },
        ]}
        colorOptions={[
          { color: "default", label: "Default" },
          { color: "blue", label: "Blue" },
        ]}
        canUseTextColor={true}
        canUseBackgroundColor={true}
        canSendBlocks={true}
        textColor="default"
        backgroundColor="default"
        footerPrimary="Last edited locally"
        footerSecondary="Now"
        onQueryChange={(nextQuery) => {
          calls.queries.push(nextQuery);
          query = nextQuery;
          focusedIndex = nextQuery ? 0 : -1;
        }}
        onFocusIndexChange={(nextFocusedIndex) => {
          focusedIndex = nextFocusedIndex;
        }}
        onMoveFocus={(direction) => {
          focusedIndex = direction > 0 ? 0 : flatRows.length - 1;
        }}
        onActivateFocused={() => {
          const row = flatRows[focusedIndex]?.row;
          if (!row || !row.enabled) return;
          calls.rows.push(row.key);
        }}
        onClose={() => {
          calls.close += 1;
        }}
        onAction={(row) => {
          calls.rows.push(row.key);
        }}
        onSubmenuChange={(submenu) => {
          activeSubmenu = submenu;
        }}
        onTurnInto={() => undefined}
        onColor={() => undefined}
        onSendBlocks={() => undefined}
      />
    );
  };

  const view = render(renderSurface());
  return { calls, view };
}

function StatefulSideMenuSurface({
  onSendBlocks = () => undefined,
}: {
  onSendBlocks?: (mode: SendBlocksMode) => void;
} = {}) {
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [activeSubmenu, setActiveSubmenu] = useState<NfmSideMenuSubmenuKey | null>(null);
  const baseSections = useMemo(() => buildNfmSideMenuSections({
    currentBlockId: "block-1",
    currentBlockType: "paragraph",
    isEditable: true,
    canUseColor: true,
    canSendBlocks: true,
    hasConvertDividerToThreadSection: false,
    isTableBlock: false,
    canUseTableHeaders: false,
  }), []);
  const sections = useMemo(() => filterNfmSideMenuSections(baseSections, query), [baseSections, query]);
  const flatRows = useMemo(() => flattenNfmSideMenuRows(sections), [sections]);

  return (
    <NfmSideMenuSurface
      sections={sections}
      query={query}
      focusedIndex={focusedIndex}
      activeSubmenu={activeSubmenu}
      listboxId="stateful-side-menu-listbox"
      comboboxId="stateful-side-menu-combobox"
      activeDescendantId={focusedIndex >= 0 ? `stateful-side-menu-listbox-option-${focusedIndex}` : undefined}
      turnIntoItems={[
        { key: "paragraph", label: "Text", type: "paragraph", enabled: true },
      ]}
      colorOptions={[
        { color: "default", label: "Default" },
        { color: "blue", label: "Blue" },
      ]}
      canUseTextColor={true}
      canUseBackgroundColor={true}
      canSendBlocks={true}
      textColor="default"
      backgroundColor="default"
      footerPrimary="Last edited locally"
      footerSecondary="Now"
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        setFocusedIndex(nextQuery ? 0 : -1);
      }}
      onFocusIndexChange={setFocusedIndex}
      onMoveFocus={(direction) => {
        setFocusedIndex((currentIndex) => {
          if (direction > 0) return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, flatRows.length - 1);
          return currentIndex <= 0 ? flatRows.length - 1 : currentIndex - 1;
        });
      }}
      onActivateFocused={() => {
        const row = flatRows[focusedIndex]?.row;
        if (row?.submenu) setActiveSubmenu(row.submenu);
      }}
      onClose={() => undefined}
      onAction={(row) => {
        if (row.submenu) setActiveSubmenu(row.submenu);
      }}
      onSubmenuChange={setActiveSubmenu}
      onTurnInto={() => undefined}
      onColor={() => undefined}
      onSendBlocks={onSendBlocks}
    />
  );
}

describe("nfm side menu surface", () => {
  test("renders dialog, combobox, listbox, and disabled reference mocks", () => {
    const { calls, view } = renderSideMenuSurface();

    expect(view.getByRole("dialog", { name: "Block actions" })).not.toBeNull();
    expect(view.getByRole("combobox")).not.toBeNull();
    expect(view.getByRole("listbox")).not.toBeNull();
    expect(view.container.querySelectorAll("[data-nfm-side-menu-separator='group']").length).toBe(4);
    expect(view.container.querySelectorAll("[data-nfm-side-menu-separator='footer']").length).toBe(1);

    const copyLink = view.getByRole("option", { name: /Copy link to block/ });
    expect(copyLink.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(copyLink);
    expect(calls.rows.length).toBe(0);
  });

  test("filters from the search query", () => {
    const { view } = renderSideMenuSurface({ initialQuery: "duplicate", initialFocusedIndex: 0 });

    expect(view.getAllByRole("option").length).toBe(1);
    expect(view.getByRole("option", { name: /Duplicate/ })).not.toBeNull();
  });

  test("clicking an enabled row activates it", () => {
    const { calls, view } = renderSideMenuSurface();

    fireEvent.click(view.getByRole("option", { name: /Duplicate/ }));

    expect(calls.rows[0]).toBe("duplicate");
  });

  test("renders submenu flyouts outside the clipped main menu surface", async () => {
    const view = render(<StatefulSideMenuSurface />);
    const mainDialog = view.getByRole("dialog", { name: "Block actions" });

    fireEvent.click(view.getByRole("option", { name: /Turn into/ }));

    const submenuDialog = await view.findByRole("dialog", { name: "Turn into" });
    expect(submenuDialog.getAttribute("data-nfm-side-menu-submenu")).toBe("true");
    expect(mainDialog.contains(submenuDialog)).toBeFalse();
  });

  test("uses the Page in-style Card in row for moving blocks to the DB from Turn into", async () => {
    const calls = {
      sendModes: [] as SendBlocksMode[],
    };
    const view = render(<StatefulSideMenuSurface onSendBlocks={(mode) => calls.sendModes.push(mode)} />);

    fireEvent.click(view.getByRole("option", { name: /Turn into/ }));
    await view.findByRole("dialog", { name: "Turn into" });
    fireEvent.click(view.getByRole("menuitem", { name: "Card in" }));

    expect(calls.sendModes[0]).toBe("project");
  });

  test("uses the reference Move to row for the real block move submenu", async () => {
    const calls = {
      sendModes: [] as SendBlocksMode[],
    };
    const view = render(<StatefulSideMenuSurface onSendBlocks={(mode) => calls.sendModes.push(mode)} />);
    const mainDialog = view.getByRole("dialog", { name: "Block actions" });

    fireEvent.click(view.getByRole("option", { name: /Move to/ }));

    const submenuDialog = await view.findByRole("dialog", { name: "Move to" });
    expect(submenuDialog.getAttribute("data-nfm-side-menu-submenu")).toBe("true");
    expect(mainDialog.contains(submenuDialog)).toBeFalse();

    fireEvent.click(view.getByRole("menuitem", { name: "Move to card" }));

    expect(calls.sendModes[0]).toBe("card");
  });
});
