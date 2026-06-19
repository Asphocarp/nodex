import { describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { render } from "@/test/dom";
import type { BoardSummary, CardSummary, Project } from "@/lib/types";
import { NfmMoveToMenuSurface } from "./nfm-move-to-menu";
import type { NfmMoveToDestination } from "./nfm-move-to-menu-model";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  type NfmSideMenuSubmenuKey,
} from "./nfm-side-menu-model";
import { NfmSideMenuSurface } from "./nfm-side-menu";

const TEST_DATE = new Date("2026-01-01T00:00:00.000Z");

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
    created: TEST_DATE,
    updated: TEST_DATE,
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
    created: TEST_DATE,
    order,
    revision: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

const MOVE_TO_PROJECTS = [
  makeProject("default", "Default", "🔥"),
  makeProject("renderer", "Renderer parity", "🧭"),
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
            makeCard("source-card", "Source card", "draft", 0),
            makeCard("target-card", "Target card", "draft", 1),
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
          cards: [makeCard("runtime", "Runtime polish", "backlog", 0)],
        },
      ],
    },
  ],
]);

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
        sourceProjectId="default"
        sourceCardId="source-card"
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
        onMoveBlocksToDestination={() => undefined}
      />
    );
  };

  const view = render(renderSurface());
  return { calls, view };
}

function StatefulSideMenuSurface({
  onMoveBlocksToDestination = () => undefined,
  moveToLoading = false,
  moveToError = null,
}: {
  onMoveBlocksToDestination?: (destination: NfmMoveToDestination) => Promise<void> | void;
  moveToLoading?: boolean;
  moveToError?: string | null;
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
      sourceProjectId="default"
      sourceCardId="source-card"
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
      onMoveBlocksToDestination={onMoveBlocksToDestination}
      renderMoveToMenu={(props) => (
        <NfmMoveToMenuSurface
          {...props}
          projects={MOVE_TO_PROJECTS}
          boardMap={MOVE_TO_BOARD_MAP}
          loading={moveToLoading}
          loadError={moveToError}
        />
      )}
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

  test("opens a DB-only Card in picker from Turn into", async () => {
    const calls = {
      destinations: [] as NfmMoveToDestination[],
    };
    const originalConsoleError = console.error;
    const consoleErrors: string[] = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    };
    try {
      const view = render(
        <StatefulSideMenuSurface
          onMoveBlocksToDestination={(destination) => {
            calls.destinations.push(destination);
          }}
        />,
      );

      fireEvent.click(view.getByRole("option", { name: /Turn into/ }));
      await view.findByRole("dialog", { name: "Turn into" });
      fireEvent.pointerEnter(view.getByRole("menuitem", { name: "Card in" }));

      const cardInDialog = await view.findByRole("dialog", { name: "Card in" });
      expect(cardInDialog.getAttribute("data-nfm-side-menu-submenu")).toBe("true");
      expect(view.getByRole("combobox", { name: "Card in destination" })).not.toBeNull();
      expect(view.getByPlaceholderText("Card in…")).not.toBeNull();
      expect(view.getByText("DB")).not.toBeNull();
      expect(view.queryByText("Card")).toBe(null);
      expect(view.queryByText("Target card")).toBe(null);

      const rendererDbRow = view
        .getAllByRole("option", { name: /Renderer parity/ })
        .find((row) => row.getAttribute("data-nfm-move-to-row-kind") === "db");
      if (!rendererDbRow) throw new Error("Renderer DB row not found.");

      fireEvent.click(rendererDbRow);
      expect(calls.destinations.length).toBe(0);

      const backlogColumnRow = view
        .getAllByRole("option", { name: /Backlog/ })
        .find((row) => row.getAttribute("data-nfm-move-to-row-kind") === "db-column");
      if (!backlogColumnRow) throw new Error("Backlog column row not found.");

      fireEvent.click(backlogColumnRow);

      await waitFor(() => {
        expect(calls.destinations[0]?.kind).toBe("db-column");
        expect(calls.destinations[0]?.projectId).toBe("renderer");
        expect(calls.destinations[0]?.columnId).toBe("backlog");
      });
      expect(consoleErrors.length).toBe(0);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("opens the reference Move to popover with grouped DB and Card results", async () => {
    const calls = {
      destinations: [] as NfmMoveToDestination[],
    };
    const view = render(
      <StatefulSideMenuSurface
        onMoveBlocksToDestination={(destination) => {
          calls.destinations.push(destination);
        }}
      />,
    );
    const mainDialog = view.getByRole("dialog", { name: "Block actions" });

    fireEvent.click(view.getByRole("option", { name: /Move to/ }));

    const submenuDialog = await view.findByRole("dialog", { name: "Move to" });
    expect(submenuDialog.getAttribute("data-nfm-side-menu-submenu")).toBe("true");
    expect(mainDialog.contains(submenuDialog)).toBeFalse();
    expect(view.getByRole("combobox", { name: "Move blocks to" })).not.toBeNull();
    expect(view.getByText("DB")).not.toBeNull();
    expect(view.getByText("Card")).not.toBeNull();
    expect(view.queryByText("Move to card")).toBe(null);
    expect(view.queryByText("Move to DB")).toBe(null);

    const rendererDbRow = view
      .getAllByRole("option", { name: /Renderer parity/ })
      .find((row) => row.getAttribute("data-nfm-move-to-row-kind") === "db");
    if (!rendererDbRow) throw new Error("Renderer DB row not found.");

    fireEvent.click(rendererDbRow);
    expect(calls.destinations.length).toBe(0);

    const backlogColumnRow = view
      .getAllByRole("option", { name: /Backlog/ })
      .find((row) => row.getAttribute("data-nfm-move-to-row-kind") === "db-column");
    if (!backlogColumnRow) throw new Error("Backlog column row not found.");

    fireEvent.click(backlogColumnRow);

    await waitFor(() => {
      expect(calls.destinations[0]?.kind).toBe("db-column");
      expect(calls.destinations[0]?.projectId).toBe("renderer");
      expect(calls.destinations[0]?.columnId).toBe("backlog");
    });
  });

  test("accepts card search results from the Move to popover", async () => {
    const calls = {
      destinations: [] as NfmMoveToDestination[],
    };
    const view = render(
      <StatefulSideMenuSurface
        onMoveBlocksToDestination={(destination) => {
          calls.destinations.push(destination);
        }}
      />,
    );

    fireEvent.click(view.getByRole("option", { name: /Move to/ }));
    await view.findByRole("dialog", { name: "Move to" });
    fireEvent.change(view.getByRole("combobox", { name: "Move blocks to" }), {
      target: { value: "targt car" },
    });

    const targetCard = await waitFor(() => view.getByRole("option", { name: /Target card/ }));
    fireEvent.click(targetCard);

    await waitFor(() => {
      const destination = calls.destinations[0];
      if (!destination || destination.kind !== "card") {
        throw new Error("Card destination was not accepted.");
      }
      expect(destination.projectId).toBe("default");
      expect(destination.columnId).toBe("draft");
      expect(destination.cardId).toBe("target-card");
    });
  });

  test("renders Move to loading, empty, and error states", async () => {
    const loadingView = render(
      <NfmMoveToMenuSurface
        projects={MOVE_TO_PROJECTS}
        boardMap={MOVE_TO_BOARD_MAP}
        sourceProjectId="default"
        sourceCardId="source-card"
        loading={true}
        loadError={null}
        onAccept={() => undefined}
        onClose={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(loadingView.getByText("Loading…")).not.toBeNull();
    }, { timeout: 650 });
    loadingView.unmount();

    const emptyView = render(
      <NfmMoveToMenuSurface
        projects={MOVE_TO_PROJECTS}
        boardMap={MOVE_TO_BOARD_MAP}
        sourceProjectId="default"
        sourceCardId="source-card"
        loading={false}
        loadError={null}
        initialQuery="zzzz"
        onAccept={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(emptyView.getByText("No results")).not.toBeNull();
    emptyView.unmount();

    const errorView = render(
      <NfmMoveToMenuSurface
        projects={MOVE_TO_PROJECTS}
        boardMap={MOVE_TO_BOARD_MAP}
        sourceProjectId="default"
        sourceCardId="source-card"
        loading={false}
        loadError="Something went wrong"
        onAccept={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(errorView.getByText("Something went wrong")).not.toBeNull();
  });
});
