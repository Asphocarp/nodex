import {
  CalendarIcon,
  CanvasIcon,
  BoardIcon,
  DatabaseIcon,
} from "@/components/shared/icons";
import { describe, expect, test, vi } from "vitest";
import { createRef } from "react";
import { fireEvent } from "@testing-library/react";

import { render, textContent } from "../../test/dom";

type DbViewToolbarItem = {
  id: string;
  label: string;
  icon?: typeof BoardIcon;
  active?: boolean;
  onSelect: () => void;
};

const ITEMS: DbViewToolbarItem[] = [
  {
    id: "kanban",
    label: "Board",
    icon: BoardIcon,
    active: true,
    onSelect: () => undefined,
  },
  {
    id: "list",
    label: "Table",
    icon: DatabaseIcon,
    onSelect: () => undefined,
  },
  {
    id: "toggle-list",
    label: "Table",
    icon: DatabaseIcon,
    onSelect: () => undefined,
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarIcon,
    onSelect: () => undefined,
  },
];

const BASE_PROPS = {
  items: ITEMS,
  searchShortcutLabel: "Ctrl+F",
  taskSearchInputRef: createRef<HTMLInputElement>(),
  rulesView: null,
  dbViewPrefs: null,
  availableTags: [],
  onUpdateDbViewPrefs: null,
  onSearchQueryChange: () => undefined,
  onOpenTaskSearch: () => undefined,
  onCloseTaskSearch: () => undefined,
};

describe("DbViewToolbar", () => {
  test("clear action always closes the inline search and clears active queries", async () => {
    const { resolveDbViewToolbarClearAction } = await import("./db-view-toolbar");

    const emptyAction = resolveDbViewToolbarClearAction(false);
    expect(emptyAction.shouldClear).toBe(false);
    expect(emptyAction.shouldClose).toBe(true);

    const activeAction = resolveDbViewToolbarClearAction(true);
    expect(activeAction.shouldClear).toBe(true);
    expect(activeAction.shouldClose).toBe(true);
  });

  test("renders database view tabs and the idle search trigger", async () => {
    const { DB_VIEW_TOOLBAR_TEST_ID, DbViewToolbar } = await import("./db-view-toolbar");
    const { container, getByLabelText, getByText, getByTestId } = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery=""
        taskSearchOpen={false}
      />,
    );

    expect(getByTestId(DB_VIEW_TOOLBAR_TEST_ID).getAttribute("data-testid")).toBe(DB_VIEW_TOOLBAR_TEST_ID);
    expect(getByLabelText("Database views").getAttribute("aria-label")).toBe("Database views");
    expect(getByText("Board").textContent).toBe("Board");
    expect(container.querySelectorAll('[aria-label="Table"]').length).toBe(2);
    expect(getByText("Calendar").textContent).toBe("Calendar");
    expect(container.querySelectorAll('[data-tab-label-visible="true"]').length).toBe(1);
    expect(getByLabelText("Search").getAttribute("aria-label")).toBe("Search");
    expect(getByTestId(DB_VIEW_TOOLBAR_TEST_ID).querySelector('[aria-hidden="true"]') !== null).toBe(true);
  });

  test("renders Canvas as an adjacent destination action, not a Database tab", async () => {
    const onOpenCanvas = vi.fn();
    const { DbViewToolbar } = await import("./db-view-toolbar");
    const { getByLabelText } = render(
      <DbViewToolbar
        {...BASE_PROPS}
        destinationItems={[{
          id: "primary-canvas",
          label: "Canvas",
          icon: CanvasIcon,
          onSelect: onOpenCanvas,
        }]}
        activeSearchQuery=""
        taskSearchOpen={false}
      />,
    );

    const canvas = getByLabelText("Canvas");
    expect(canvas.getAttribute("role")).not.toBe("tab");
    fireEvent.click(canvas);
    expect(onOpenCanvas).toHaveBeenCalledOnce();
  });

  test("renders the inline search field when open or when a query is active", async () => {
    const { DbViewToolbar } = await import("./db-view-toolbar");
    const openRender = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery="bugfix"
        taskSearchOpen
      />,
    );

    expect(openRender.container.querySelector('[aria-hidden="false"]') !== null).toBe(true);
    expect(openRender.getByPlaceholderText("Type to search...").getAttribute("placeholder")).toBe("Type to search...");
    expect(openRender.getByLabelText("Clear search").getAttribute("aria-label")).toBe("Clear search");
    expect(openRender.getByDisplayValue("bugfix").getAttribute("value")).toBe("bugfix");

    openRender.unmount();

    const filteredRender = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery="bugfix"
        taskSearchOpen={false}
      />,
    );

    expect(filteredRender.container.querySelector('[aria-hidden="false"]') !== null).toBe(true);
    expect(filteredRender.getByPlaceholderText("Type to search...").getAttribute("placeholder")).toBe("Type to search...");
    expect(filteredRender.getByDisplayValue("bugfix").getAttribute("value")).toBe("bugfix");
  });

  test("hides search controls when the active view owns the toolbar cluster", async () => {
    const { DbViewToolbar } = await import("./db-view-toolbar");
    const { container } = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery="bugfix"
        taskSearchOpen
        showSearchControls={false}
      />,
    );

    expect(container.querySelector('[aria-label="Search"]') === null).toBe(true);
    expect(container.querySelector('[aria-label="Search tasks"]') === null).toBe(true);
    expect(textContent(container).includes("bugfix")).toBe(false);
  });

  test("renders the active rules summary row for supported views", async () => {
    const { DbViewToolbar } = await import("./db-view-toolbar");
    const { getDefaultDbViewPrefs } = await import("../../lib/db-view-prefs");
    const prefs = getDefaultDbViewPrefs("kanban");
    prefs.rules.filter.any[0]!.all[0] = {
      field: "status",
      op: "in",
      values: ["plan", "build"],
    };

    const { container, getByText } = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery=""
        taskSearchOpen={false}
        rulesView="kanban"
        dbViewPrefs={prefs}
        onUpdateDbViewPrefs={() => undefined}
      />,
    );

    expect(getByText("Board Order").textContent).toBe("Board Order");
    expect(textContent(container).includes("Status")).toBe(true);
    expect(textContent(container).includes("Plan, Build")).toBe(true);
    expect(textContent(container).includes("Ascending")).toBe(false);
  });

  test("collapses multiple active sorts into a single count chip", async () => {
    const { DbViewToolbar } = await import("./db-view-toolbar");
    const { getDefaultDbViewPrefs } = await import("../../lib/db-view-prefs");
    const prefs = getDefaultDbViewPrefs("toggle-list");
    prefs.rules.sort = [
      { field: "priority", direction: "asc" },
      { field: "estimate", direction: "desc" },
    ];
    prefs.rules.filter.any[0]!.all[1] = {
      field: "priority",
      op: "in",
      values: ["p0-critical", "p1-high"],
    };

    const { container, getByText } = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery=""
        taskSearchOpen={false}
        rulesView="toggle-list"
        dbViewPrefs={prefs}
        onUpdateDbViewPrefs={() => undefined}
      />,
    );

    expect(getByText("2 sorts").textContent).toBe("2 sorts");
    expect(textContent(container).includes("Priority")).toBe(true);
    expect(textContent(container).includes("P0, P1")).toBe(true);
    expect(textContent(container).includes("Ascending")).toBe(false);
    expect(textContent(container).includes("Descending")).toBe(false);
  });

  test("shows empty-first sort placement in the single-sort summary label", async () => {
    const { DbViewToolbar } = await import("./db-view-toolbar");
    const { getDefaultDbViewPrefs } = await import("../../lib/db-view-prefs");
    const prefs = getDefaultDbViewPrefs("toggle-list");
    prefs.rules.sort = [{ field: "priority", direction: "asc", emptyPlacement: "first" }];

    const { container } = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery=""
        taskSearchOpen={false}
        rulesView="toggle-list"
        dbViewPrefs={prefs}
        onUpdateDbViewPrefs={() => undefined}
      />,
    );

    expect(textContent(container).includes("Priority · Empty First")).toBe(true);
  });

  test("renders empty priority in the summary row when selected explicitly", async () => {
    const { DbViewToolbar } = await import("./db-view-toolbar");
    const { getDefaultDbViewPrefs } = await import("../../lib/db-view-prefs");
    const prefs = getDefaultDbViewPrefs("toggle-list");
    prefs.rules.filter.any[0]!.all[1] = {
      field: "priority",
      op: "in",
      values: ["p0-critical"],
      includeEmpty: true,
    };

    const { container } = render(
      <DbViewToolbar
        {...BASE_PROPS}
        activeSearchQuery=""
        taskSearchOpen={false}
        rulesView="toggle-list"
        dbViewPrefs={prefs}
        onUpdateDbViewPrefs={() => undefined}
      />,
    );

    expect(textContent(container).includes("Priority")).toBe(true);
    expect(textContent(container).includes("P0, -")).toBe(true);
  });
});
