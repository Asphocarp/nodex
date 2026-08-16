import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { act, useRef, useState } from "react";
import type { DatabaseViewRenderModel } from "@/lib/database-view-render-model";
import {
  commitDatabaseViewOperations,
  DatabaseViewMutationError,
} from "@/lib/database-view-row-mutations";
import { plainTextToPortableRichText } from "../../../shared/block-documents/portable-rich-text";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { upgradeDatabaseViewConfigV2 } from "../../../shared/database-view-presentation";
import { render } from "../../test/dom";
import {
  databaseViewMutationErrorMessage,
  DatabaseViewSurface,
} from "./database-view-surface";
import { DatabaseViewTabSurface } from "./workbench-db-view-panel";
import { handleWorkbenchShortcut } from "@/lib/use-workbench-shortcuts";
import { resetContextualKeyboardActionRegistryForTests } from "@/lib/contextual-keyboard-actions";
import { PageTitleProjectionProvider } from "@/lib/page-title-projection-context";
import {
  createPageTitleProjectionStore,
  makePageTitleResourceKey,
} from "@/lib/page-title-projection-store";

const optionRuntime = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/database-property-options-runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/database-property-options-runtime")>(),
  readPropertyOptionWindow: optionRuntime.read,
}));

const timestamp = "2026-07-12T00:00:00.000Z";
const dataSourceId = parseDataSourceId("source-1");
const databaseId = parseDatabaseId("database-1");
const viewId = parseDatabaseViewId("view-focused");
const tagsPropertyId = parseDataSourcePropertyId("tags");
const statusPropertyId = parseDataSourcePropertyId("status");
const priorityPropertyId = parseDataSourcePropertyId("priority");

const model: DatabaseViewRenderModel = {
  libraryId: "library-1",
  accessContext: { kind: "project", projectId: "project-1" },
  databaseViewId: viewId,
  databaseId,
  dataSourceId,
  databaseName: "Tasks",
  dataSourceName: "Pages",
  viewName: "Focused",
  storeEpoch: "epoch-1",
  commitSeq: 2,
  authorization: null,
  readOnlyReason: null,
  query: {
    database: {
      databaseId,
      libraryId: "library-1",
      name: "Tasks",
      lifecycle: "active",
      defaultViewId: parseDatabaseViewId("view-default"),
      accessRevision: 1,
      metadataRevision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    dataSource: {
      dataSourceId,
      libraryId: "library-1",
      homeDatabaseId: databaseId,
      name: "Pages",
      schemaKey: "nodex.pages",
      schemaRevision: 1,
      lifecycle: "active",
      rankKey: "a",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    view: {
      viewId,
      databaseId,
      dataSourceId,
      name: "Focused",
      defaultLayout: "list",
      config: upgradeDatabaseViewConfigV2({
        schemaKey: "nodex.database-view",
        schemaVersion: 2,
        filter: { kind: "group", operator: "and", children: [] },
        sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
        group: null,
        display: { propertyIds: [tagsPropertyId], showTitle: true },
      }),
      isDefault: false,
      revision: 1,
      rankKey: "a",
      lifecycle: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    properties: [{
      propertyId: tagsPropertyId,
      dataSourceId,
      name: "Tags",
      ...testPropertySemantics("multi_select", 2),
      valueType: "multi_select",
      config: {
        options: [
          { id: "o_AAAAAAAA", name: "Selected View" },
          { id: "o_BBBBBBBB", name: "Next" },
        ],
      },
      rankKey: "a",
      lifecycle: "active",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    rows: [{
      pageKey: null,
      membership: {
        membershipId: "membership-focused",
        dataSourceId,
        revision: 1,
        createdAt: timestamp,
      },
      page: {
        pageId: "page-focused",
        libraryId: "library-1",
        parent: { kind: "data_source", dataSourceId },
        lifecycle: "active",
        parentRevision: 1,
        metadataRevision: 1,
        documentId: "document-focused",
        documentGeneration: 1,
        documentHeadSeq: 1,
        title: "Focused Page",
        richTitle: plainTextToPortableRichText("Focused Page"),
        preview: "",
        plainText: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      values: {
        [tagsPropertyId]: {
          propertyId: tagsPropertyId,
          valueType: "multi_select",
          value: ["o_AAAAAAAA"],
          revision: 1,
        },
      },
      taskParent: { parentPageId: null, siblingRank: null, valueRevision: 1 },
      position: { rankKey: "a", revision: 1 },
      effectiveGroupKey: null,
      effectiveSubgroupKey: null,
    }],
  },
  columns: [{
    id: "build",
    groupKey: "build",
    scopeKey: "key:build",
    name: "In Progress",
    rows: [{
      pageId: "page-focused",
      pageKey: null,
      groupKey: "build",
      subgroupKey: null,
      status: "build",
      title: "Focused Page",
      preview: "",
      plainText: "",
      tags: ["selected-view"],
      taskParentValueRevision: 1,
      metadataRevision: 1,
      createdAt: new Date(timestamp),
    }],
  }],
};

const boardModel = (): DatabaseViewRenderModel => {
  const firstAuthority = model.query.rows[0]!;
  const firstRow = model.columns[0]!.rows[0]!;
  const secondAuthority = {
    ...firstAuthority,
    membership: {
      ...firstAuthority.membership,
      membershipId: "membership-next",
    },
    page: {
      ...firstAuthority.page,
      pageId: "page-next",
      documentId: "document-next",
      title: "Next Page",
      richTitle: plainTextToPortableRichText("Next Page"),
    },
    position: { rankKey: "b", revision: 2 },
  };
  return {
    ...model,
    query: {
      ...model.query,
      view: { ...model.query.view, defaultLayout: "board" },
      rows: [firstAuthority, secondAuthority],
    },
    columns: [{
      ...model.columns[0]!,
      rows: [firstRow, {
        ...firstRow,
        pageId: "page-next",
        title: "Next Page",
      }],
    }],
  };
};

const describedBoardModel = (): DatabaseViewRenderModel => {
  const next = boardModel();
  return {
    ...next,
    query: {
      ...next.query,
      rows: next.query.rows.map((row) => ({
        ...row,
        page: {
          ...row.page,
          preview: "A body preview",
          plainText: "A body preview",
        },
      })),
    },
    columns: next.columns.map((column) => ({
      ...column,
      rows: column.rows.map((row) => ({
        ...row,
        preview: "A body preview",
        plainText: "A body preview",
      })),
    })),
  };
};

const keyedBoardModel = (): DatabaseViewRenderModel => {
  const next = boardModel();
  return {
    ...next,
    query: {
      ...next.query,
      view: {
        ...next.query.view,
        config: {
          ...next.query.view.config,
          presentation: {
            ...next.query.view.config.presentation,
            layouts: {
              ...next.query.view.config.presentation.layouts,
              board: {
                ...next.query.view.config.presentation.layouts.board,
                fields: [
                  { kind: "intrinsic", field: "page_key" },
                  ...next.query.view.config.presentation.layouts.board.fields,
                ],
              },
            },
          },
        },
      },
      rows: next.query.rows.map((row, index) => ({
        ...row,
        pageKey: index === 0 ? "LAB-13" : row.pageKey,
      })),
    },
    columns: next.columns.map((column) => ({
      ...column,
      rows: column.rows.map((row, index) => ({
        ...row,
        pageKey: index === 0 ? "LAB-13" : row.pageKey,
      })),
    })),
  };
};

const listModel = (): DatabaseViewRenderModel => {
  const next = boardModel();
  return {
    ...next,
    query: {
      ...next.query,
      view: { ...next.query.view, defaultLayout: "list" },
    },
    columns: [{
      id: "all",
      groupKey: null,
      scopeKey: "all",
      name: "Focused",
      rows: next.columns.flatMap((column) => column.rows),
    }],
  };
};

const nestedListModel = (): DatabaseViewRenderModel => {
  const next = listModel();
  const [parentAuthority, childAuthority] = next.query.rows;
  const [parentRow, childRow] = next.columns[0]?.rows ?? [];
  if (!parentAuthority || !childAuthority || !parentRow || !childRow) return next;
  return {
    ...next,
    query: {
      ...next.query,
      view: {
        ...next.query.view,
        config: {
          ...next.query.view.config,
          presentation: {
            ...next.query.view.config.presentation,
            hierarchy: { showSubPages: true, nestedSubPages: true },
          },
        },
      },
      rows: [
        parentAuthority,
        {
          ...childAuthority,
          taskParent: {
            parentPageId: parentAuthority.page.pageId,
            siblingRank: "a",
            valueRevision: 1,
          },
        },
      ],
    },
    columns: [{
      ...next.columns[0]!,
      rows: [parentRow, {
        ...childRow,
        parentPageId: parentRow.pageId,
      }],
    }],
  };
};

const groupedListModel = (): DatabaseViewRenderModel => {
  const next = boardModel();
  const statusProperty = {
    propertyId: statusPropertyId,
    dataSourceId,
    name: "Status",
    ...testPropertySemantics("select", 1),
    valueType: "select" as const,
    config: { options: [{ id: "build", name: "build" }] },
    rankKey: "0",
    lifecycle: "active" as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...next,
    query: {
      ...next.query,
      view: {
        ...next.query.view,
        defaultLayout: "list",
        config: {
          ...next.query.view.config,
          presentation: {
            ...next.query.view.config.presentation,
            group: { propertyId: statusPropertyId },
          },
        },
      },
      properties: [statusProperty, ...next.query.properties],
      rows: next.query.rows.map((row) => ({
        ...row,
        values: {
          ...row.values,
          [statusPropertyId]: {
            propertyId: statusPropertyId,
            valueType: "select" as const,
            value: "build",
            revision: 1,
          },
        },
        effectiveGroupKey: "build",
      })),
    },
  };
};

const editableSemanticListModel = (): DatabaseViewRenderModel => {
  const next = listModel();
  const statusProperty = {
    propertyId: statusPropertyId,
    dataSourceId,
    name: "Status",
    ...testPropertySemantics("select", 5),
    valueType: "select" as const,
    config: {},
    rankKey: "0",
    lifecycle: "active" as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const priorityProperty = {
    propertyId: priorityPropertyId,
    dataSourceId,
    name: "Priority",
    ...testPropertySemantics("select", 4),
    valueType: "select" as const,
    config: {},
    rankKey: "1",
    lifecycle: "active" as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ...next,
    query: {
      ...next.query,
      view: {
        ...next.query.view,
        config: {
          ...next.query.view.config,
          presentation: {
            ...next.query.view.config.presentation,
            layouts: {
              ...next.query.view.config.presentation.layouts,
              list: {
                ...next.query.view.config.presentation.layouts.list,
                fields: [
                  { kind: "property", propertyId: priorityPropertyId },
                  { kind: "property", propertyId: statusPropertyId },
                ],
              },
            },
          },
        },
      },
      properties: [statusProperty, priorityProperty, ...next.query.properties],
      rows: next.query.rows.map((row) => ({
        ...row,
        values: {
          ...row.values,
          [statusPropertyId]: {
            propertyId: statusPropertyId,
            valueType: "select" as const,
            value: "build",
            revision: 1,
          },
          [priorityPropertyId]: {
            propertyId: priorityPropertyId,
            valueType: "select" as const,
            value: "p1-high",
            revision: 1,
          },
        },
      })),
    },
    columns: next.columns.map((column) => ({
      ...column,
      rows: column.rows.map((row) => ({
        ...row,
        status: "build",
        priority: "p1-high",
      })),
    })),
  };
};

const shortcutEvent = (key: string, input: {
  readonly code?: string;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
} = {}) => ({
  key,
  code: input.code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: input.shiftKey ?? false,
  altKey: input.altKey ?? false,
  target: null,
});

describe("DatabaseViewSurface", () => {
  beforeEach(() => resetContextualKeyboardActionRegistryForTests());

  test("classifies missing page moves separately from missing Properties", () => {
    const error = new DatabaseViewMutationError({
      code: "resource_not_found",
      message: "raw resource detail",
      retryable: false,
    });
    expect(databaseViewMutationErrorMessage(error, true))
      .toBe("This page is no longer available.");
    expect(databaseViewMutationErrorMessage(error, false))
      .toBe("This property is no longer available.");
  });

  test("renders the selected View Pages and opens their stable identity", () => {
    const opened: unknown[][] = [];
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery="focused"
        onOpenPage={(...args) => opened.push(args)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Page Focused Page" }));
    expect(opened[0]).toEqual(["page-focused", "Focused Page"]);
  });

  test("renders an enabled Board Page key above the title and applies the shared key lookup", () => {
    const keyed = keyedBoardModel();
    const screen = render(
      <DatabaseViewSurface
        model={keyed}
        searchQuery="#LAB-13"
        onOpenPage={() => undefined}
      />,
    );

    const pageKey = screen.container.querySelector('[data-page-key="LAB-13"]');
    expect(pageKey?.nextElementSibling?.textContent).toContain("Focused Page");
    expect(screen.getAllByRole("article")).toHaveLength(1);

    screen.rerender(
      <DatabaseViewSurface
        model={keyed}
        searchQuery="lab13"
        onOpenPage={() => undefined}
      />,
    );
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  test("toggles the Page description preview independently of Board fields", () => {
    const described = describedBoardModel();
    const effectivePresentation = {
      layout: "board" as const,
      presentation: {
        ...described.query.view.config.presentation,
        layouts: {
          ...described.query.view.config.presentation.layouts,
          board: {
            ...described.query.view.config.presentation.layouts.board,
            showDescription: false,
          },
        },
      },
    };
    const screen = render(
      <DatabaseViewSurface
        model={described}
        effectivePresentation={effectivePresentation}
        searchQuery=""
        onOpenPage={() => undefined}
      />,
    );

    expect(screen.container.querySelector('[data-board-page-description="true"]'))
      .toBeNull();
    screen.rerender(
      <DatabaseViewSurface
        model={described}
        effectivePresentation={{
          ...effectivePresentation,
          presentation: {
            ...effectivePresentation.presentation,
            layouts: {
              ...effectivePresentation.presentation.layouts,
              board: {
                ...effectivePresentation.presentation.layouts.board,
                showDescription: true,
              },
            },
          },
        }}
        searchQuery=""
        onOpenPage={() => undefined}
      />,
    );
    const description = screen.container.querySelector(
      '[data-board-page-description="true"]',
    );
    expect(description).not.toBeNull();
    expect(description?.textContent).toContain("A body preview");
  });

  test("projects an open Page editor title into the List row immediately", async () => {
    const titleStore = createPageTitleProjectionStore();
    const screen = render(
      <PageTitleProjectionProvider
        currentLibraryId="library-1"
        store={titleStore}
      >
        <DatabaseViewSurface
          model={model}
          searchQuery=""
          onOpenPage={() => undefined}
        />
      </PageTitleProjectionProvider>,
    );

    await act(async () => {
      titleStore.publishLive(
        makePageTitleResourceKey("library-1", "page-focused"),
        "page-stage",
        "Live editor title",
      );
      await Promise.resolve();
    });

    expect(screen.getByRole("button", {
      name: "Open Page Live editor title",
    })).toBeTruthy();
    expect(screen.queryByRole("button", {
      name: "Open Page Focused Page",
    })).toBeNull();
  });

  test("switches one durable View between Board and List without changing identity", () => {
    const boardDefaultModel: DatabaseViewRenderModel = {
      ...model,
      query: {
        ...model.query,
        view: { ...model.query.view, defaultLayout: "board" },
      },
    };
    const defaultScreen = render(
      <DatabaseViewSurface
        model={boardDefaultModel}
        searchQuery=""
        onOpenPage={() => undefined}
      />,
    );
    expect(defaultScreen.getByRole("article")).toBeTruthy();
    defaultScreen.unmount();

    const opened: unknown[][] = [];
    const fallbackScreen = render(
      <DatabaseViewSurface
        model={boardDefaultModel}
        presentationLayout="list"
        searchQuery=""
        onOpenPage={(...args) => opened.push(args)}
      />,
    );

    expect(fallbackScreen.container.querySelector(
      '[data-database-view-id="view-focused"]',
    )).toBeTruthy();
    fireEvent.click(fallbackScreen.getByRole("button", { name: "Open Page Focused Page" }));
    expect(opened[0]).toEqual(["page-focused", "Focused Page"]);
    expect(boardDefaultModel.databaseViewId).toBe(viewId);
    expect(boardDefaultModel.query.view.defaultLayout).toBe("board");
  });

  test("keeps Board navigation and selection active across reactive renders", () => {
    const screen = render(
      <DatabaseViewSurface
        model={boardModel()}
        searchQuery=""
        keyboardSurface={{ surfaceId: "board", presentationId: "tab" }}
        onOpenPage={() => undefined}
      />,
    );
    const actions = { projectOrder: [], switchToProjectIndex: () => undefined };
    const press = (event: ReturnType<typeof shortcutEvent>) => {
      let handled = false;
      act(() => {
        handled = handleWorkbenchShortcut(event, actions, true);
      });
      return handled;
    };

    expect(press(shortcutEvent("j", { code: "KeyJ" }))).toBe(true);
    expect(screen.getAllByRole("article")[0]?.tabIndex).toBe(0);

    expect(press(shortcutEvent("x", { code: "KeyX" }))).toBe(true);
    expect(screen.getAllByRole("article")[0]?.getAttribute("aria-selected"))
      .toBe("true");

    expect(press(shortcutEvent("j", { code: "KeyJ" }))).toBe(true);
    expect(screen.getAllByRole("article")[1]?.tabIndex).toBe(0);
  });

  test("preserves the active selection when the same View switches layout", () => {
    const screen = render(
      <DatabaseViewSurface
        model={boardModel()}
        presentationLayout="board"
        searchQuery=""
        keyboardSurface={{ surfaceId: "layout", presentationId: "same-view" }}
        onOpenPage={() => undefined}
      />,
    );
    const actions = { projectOrder: [], switchToProjectIndex: () => undefined };

    act(() => {
      handleWorkbenchShortcut(
        shortcutEvent("j", { code: "KeyJ" }),
        actions,
        true,
      );
    });
    act(() => {
      handleWorkbenchShortcut(
        shortcutEvent("x", { code: "KeyX" }),
        actions,
        true,
      );
    });
    expect(screen.getAllByRole("article")[0]?.getAttribute("aria-selected"))
      .toBe("true");

    screen.rerender(
      <DatabaseViewSurface
        model={boardModel()}
        presentationLayout="list"
        searchQuery=""
        keyboardSurface={{ surfaceId: "layout", presentationId: "same-view" }}
        onOpenPage={() => undefined}
      />,
    );

    expect(screen.container.querySelectorAll<HTMLElement>("[data-list-row=true]")[0]
      ?.getAttribute("aria-selected"))
      .toBe("true");
    expect(screen.container.querySelectorAll<HTMLElement>("[data-list-row=true]")[0]
      ?.tabIndex).toBe(0);
  });

  test("hydrates a selection handed off by another View presenter", () => {
    const onSelectedPageIdsChange = vi.fn();
    const screen = render(
      <DatabaseViewSurface
        model={boardModel()}
        presentationLayout="list"
        searchQuery=""
        initialSelectedPageIds={new Set(["page-focused"])}
        onSelectedPageIdsChange={onSelectedPageIdsChange}
        onOpenPage={() => undefined}
      />,
    );

    expect(screen.container.querySelectorAll<HTMLElement>("[data-list-row=true]")[0]
      ?.getAttribute("aria-selected"))
      .toBe("true");
    expect(onSelectedPageIdsChange).toHaveBeenCalledWith(
      new Set(["page-focused"]),
    );
  });

  test("keeps Board hover transient until pointer activation", () => {
    const screen = render(
      <DatabaseViewSurface
        model={boardModel()}
        searchQuery=""
        keyboardSurface={{ surfaceId: "board", presentationId: "tab" }}
        onOpenPage={() => undefined}
      />,
    );
    const first = screen.getAllByRole("article")[0]!;

    fireEvent.pointerEnter(first);
    expect(first.tabIndex).toBe(-1);
    expect(first.getAttribute("aria-selected")).toBe("false");

    fireEvent.pointerDown(first);
    expect(first.tabIndex).toBe(0);
    expect(first.getAttribute("aria-selected")).toBe("false");
  });

  test("navigates, selects, and opens dense List rows from the row focus target", async () => {
    const onOpenPage = vi.fn();
    const screen = render(
      <DatabaseViewSurface
        model={listModel()}
        presentationLayout="list"
        searchQuery=""
        onOpenPage={onOpenPage}
      />,
    );
    const [first, second] = screen.container.querySelectorAll<HTMLElement>(
      "[data-list-row=true]",
    );
    if (!first || !second) throw new Error("Expected two List rows");

    await act(async () => {
      fireEvent.focus(first);
      fireEvent.keyDown(first, { key: "ArrowDown" });
      await Promise.resolve();
    });
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(second.tabIndex).toBe(0);

    await act(async () => {
      fireEvent.keyDown(second, { key: " " });
      await Promise.resolve();
    });
    expect(second.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(second, { key: "Home" });
      await Promise.resolve();
    });
    await waitFor(() => expect(document.activeElement).toBe(first));

    await act(async () => {
      fireEvent.keyDown(first, { key: "End" });
      await Promise.resolve();
      fireEvent.keyDown(second, { key: "Enter" });
      await Promise.resolve();
    });
    expect(onOpenPage).toHaveBeenCalledWith("page-next", "Next Page");
  });

  test("keeps the named List grid valid and cells anchored when Page ID is hidden", () => {
    const screen = render(
      <DatabaseViewSurface
        model={listModel()}
        presentationLayout="list"
        searchQuery=""
        onOpenPage={() => undefined}
      />,
    );
    const layoutGrid = screen.container.querySelector<HTMLElement>(
      "[data-list-layout-grid=true]",
    );
    const row = screen.container.querySelector<HTMLElement>(
      "[data-database-view-page-id]",
    );
    if (!layoutGrid || !row) throw new Error("Expected the List layout grid and a Page row");

    expect(layoutGrid.style.gridTemplateColumns)
      .toMatch(/\[identifier (?:status|title)\]/);
    expect(row.querySelector("[data-list-grid-column=identifier]")).toBeNull();
    const cells = row.querySelectorAll<HTMLElement>(
      ":scope > [data-list-grid-column]",
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.style.gridColumn).toBe(cell.dataset.listGridColumn);
    }
  });

  test("keeps external editor focus across List projection refreshes and selection", async () => {
    const renderSurface = (viewModel: DatabaseViewRenderModel) => (
      <>
        <input aria-label="Page editor" />
        <DatabaseViewSurface
          model={viewModel}
          presentationLayout="list"
          searchQuery=""
          onOpenPage={() => undefined}
        />
      </>
    );
    const screen = render(renderSurface(listModel()));
    const row = screen.container.querySelector<HTMLElement>(
      '[data-database-view-page-id="page-focused"]',
    );
    if (!row) throw new Error("Expected the focused List row");
    await act(async () => {
      fireEvent.focus(row);
      await Promise.resolve();
    });

    const editor = screen.getByRole("textbox", { name: "Page editor" });
    editor.focus();
    screen.rerender(renderSurface(listModel()));
    await waitFor(() => expect(document.activeElement).toBe(editor));

    const checkbox = screen.getByRole("checkbox", {
      name: "Select Focused Page",
    });
    checkbox.focus();
    await act(async () => {
      fireEvent.click(checkbox);
      await Promise.resolve();
    });
    await waitFor(() => expect(document.activeElement).toBe(checkbox));
  });

  test("opens a List Page from its title or row surface while selection stays explicit", async () => {
    const onOpenPage = vi.fn();
    const screen = render(
      <DatabaseViewSurface
        model={listModel()}
        presentationLayout="list"
        searchQuery=""
        onOpenPage={onOpenPage}
      />,
    );
    const row = screen.container.querySelector<HTMLElement>(
      '[data-database-view-page-id="page-focused"]',
    );
    if (!row) throw new Error("Expected the focused List row");

    await act(async () => {
      fireEvent.click(row);
      await Promise.resolve();
    });
    expect(onOpenPage).toHaveBeenLastCalledWith("page-focused", "Focused Page");
    expect(row.getAttribute("aria-selected")).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", {
        name: "Open Page Focused Page",
      }));
      await Promise.resolve();
    });
    expect(onOpenPage).toHaveBeenCalledTimes(2);

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", {
        name: "Select Focused Page",
      }));
      await Promise.resolve();
    });
    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(onOpenPage).toHaveBeenCalledTimes(2);
  });

  test("opens the searchable List row action surface from the row context trigger", async () => {
    const screen = render(
      <DatabaseViewSurface
        model={listModel()}
        presentationLayout="list"
        searchQuery=""
        onOpenPage={() => undefined}
      />,
    );
    const row = screen.container.querySelector<HTMLElement>(
      '[data-database-view-page-id="page-focused"]',
    );
    if (!row) throw new Error("Expected a List row context target");

    await act(async () => {
      fireEvent.contextMenu(row, { clientX: 240, clientY: 120 });
      await Promise.resolve();
    });

    expect(await screen.findByRole("textbox", { name: "Search Page actions" }))
      .toBe(document.activeElement);
    expect(screen.getByRole("menuitem", { name: "Open page" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Add to selection" })).toBeTruthy();
  });

  test("keeps admitted List rows visible when a continuation fails and retries it", async () => {
    const onLoadMoreGroup = vi.fn();
    const screen = render(
      <DatabaseViewSurface
        model={listModel()}
        presentationLayout="list"
        searchQuery=""
        groupPagination={new Map([[
          "all",
          {
            scopeKey: "all",
            loadedRows: 2,
            totalRows: 8,
            hasMore: true,
            loadingMore: false,
            error: "Couldn’t load the next List window.",
          },
        ]])}
        onLoadMoreGroup={onLoadMoreGroup}
        onOpenPage={() => undefined}
      />,
    );

    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn’t load the next List window.",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });
    expect(onLoadMoreGroup).toHaveBeenCalledWith("all");
  });

  test("projects Page presence independently from Board selection", () => {
    const screen = render(
      <DatabaseViewSurface
        model={boardModel()}
        searchQuery=""
        presentedPageIds={new Set(["page-focused"])}
        onOpenPage={() => undefined}
      />,
    );
    const presented = screen.container.querySelector<HTMLElement>(
      '[data-database-view-page-presented="true"]',
    );

    expect(presented?.dataset.databaseViewPageId).toBe("page-focused");
    expect(presented?.getAttribute("aria-selected")).toBe("false");
    expect(presented?.querySelector('[data-page-presence-rail="true"]'))
      .not.toBeNull();
  });

  test("commits a Board boundary move through the global shortcut route", async () => {
    const commitOperations = vi.fn<typeof commitDatabaseViewOperations>(
      async () => null,
    );
    render(
      <DatabaseViewSurface
        model={boardModel()}
        searchQuery=""
        keyboardSurface={{ surfaceId: "board", presentationId: "tab" }}
        onOpenPage={() => undefined}
        commitOperations={commitOperations}
      />,
    );
    const actions = { projectOrder: [], switchToProjectIndex: () => undefined };

    await act(async () => {
      expect(handleWorkbenchShortcut(
        shortcutEvent("j", { code: "KeyJ" }),
        actions,
        true,
      )).toBe(true);
      await Promise.resolve();
    });
    await act(async () => {
      expect(handleWorkbenchShortcut(
        shortcutEvent("ArrowDown", {
          code: "ArrowDown",
          altKey: true,
          shiftKey: true,
        }),
        actions,
        true,
      )).toBe(true);
      await Promise.resolve();
    });

    await waitFor(() => expect(commitOperations).toHaveBeenCalledTimes(1));
    expect(commitOperations.mock.calls[0]?.[0].operations[0]).toMatchObject({
      kind: "position_pages",
      pages: [
        { pageId: "page-next" },
        { pageId: "page-focused" },
      ],
    });
  });

  test("writes a displayed custom property through Page and Data Source identity", async () => {
    const operations: unknown[] = [];
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery=""
        onOpenPage={() => undefined}
        commitOperations={async (input) => {
          operations.push(...input.operations);
          return null;
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Next" }));
      await Promise.resolve();
    });
    expect(operations[0]).toEqual({
      kind: "edit_property_values",
      edits: [{
        pageId: "page-focused",
        dataSourceId,
        propertyId: tagsPropertyId,
        edit: {
          kind: "patch_set",
          delta: {
            kind: "multi_select",
            addOptionIds: ["o_BBBBBBBB"],
            removeOptionIds: [],
          },
        },
      }],
    });
  });

  test("edits List priority and status icons when semantic options are not embedded", async () => {
    const opened = vi.fn();
    const commitOperations = vi.fn<typeof commitDatabaseViewOperations>(
      async () => null,
    );
    const screen = render(
      <DatabaseViewSurface
        model={editableSemanticListModel()}
        presentationLayout="list"
        searchQuery=""
        onOpenPage={opened}
        commitOperations={commitOperations}
      />,
    );

    const priorityTrigger = screen.getByRole("button", {
      name: "Change priority for Focused Page",
    }) as HTMLButtonElement;
    const statusTrigger = screen.getByRole("button", {
      name: "Change status for Focused Page",
    }) as HTMLButtonElement;
    expect(priorityTrigger.disabled).toBe(false);
    expect(statusTrigger.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(priorityTrigger);
      await Promise.resolve();
    });
    const prioritySearch = await screen.findByRole("combobox", {
      name: "Search Priority options",
    });
    await act(async () => {
      fireEvent.change(prioritySearch, { target: { value: "medium" } });
      await Promise.resolve();
    });
    const mediumPriority = await screen.findByRole("option", { name: /P2 - Medium/u });
    await act(async () => {
      fireEvent.click(mediumPriority);
      await Promise.resolve();
    });
    await waitFor(() => expect(commitOperations).toHaveBeenCalledTimes(1));
    expect(commitOperations.mock.calls[0]?.[0].operations[0]).toMatchObject({
      kind: "edit_property_values",
      edits: [{
        pageId: "page-focused",
        propertyId: priorityPropertyId,
        edit: {
          kind: "replace",
          value: { kind: "select", optionId: "p2-medium" },
        },
      }],
    });

    await act(async () => {
      fireEvent.click(statusTrigger);
      await Promise.resolve();
    });
    const statusSearch = await screen.findByRole("combobox", {
      name: "Search Status options",
    });
    await act(async () => {
      fireEvent.change(statusSearch, { target: { value: "review" } });
      await Promise.resolve();
    });
    const reviewStatus = await screen.findByRole("option", { name: /Review/u });
    await act(async () => {
      fireEvent.click(reviewStatus);
      await Promise.resolve();
    });
    await waitFor(() => expect(commitOperations).toHaveBeenCalledTimes(2));
    expect(commitOperations.mock.calls[1]?.[0].operations[0]).toMatchObject({
      kind: "edit_property_values",
      edits: [{
        pageId: "page-focused",
        propertyId: statusPropertyId,
        edit: {
          kind: "replace",
          value: { kind: "select", optionId: "review" },
        },
      }],
    });
    expect(opened).not.toHaveBeenCalled();
  });

  test("keeps a successful option registry usable when a sibling registry fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenPropertyId = parseDataSourcePropertyId("p_0123abcd");
    const loadingModel: DatabaseViewRenderModel = {
      ...model,
      query: {
        ...model.query,
        view: {
          ...model.query.view,
          config: {
            ...model.query.view.config,
            presentation: {
              ...model.query.view.config.presentation,
              layouts: {
                ...model.query.view.config.presentation.layouts,
                list: {
                  ...model.query.view.config.presentation.layouts.list,
                  fields: [tagsPropertyId, brokenPropertyId].map(
                    (propertyId) => ({ kind: "property" as const, propertyId }),
                  ),
                },
              },
            },
          },
        },
        properties: [
          { ...model.query.properties[0]!, optionCount: 3 },
          {
            ...model.query.properties[0]!,
            propertyId: brokenPropertyId,
            name: "Broken select",
            ...testPropertySemantics("select", 1),
            valueType: "select",
            config: {},
            optionCount: 1,
            rankKey: "b",
          },
        ],
        rows: model.query.rows.map((row) => ({
          ...row,
          values: {
            ...row.values,
            [tagsPropertyId]: {
              ...row.values[tagsPropertyId]!,
              value: ["o_CCCCCCCC"],
            },
            [brokenPropertyId]: {
              propertyId: brokenPropertyId,
              valueType: "select",
              value: "o_BROKEN00",
              revision: 1,
            },
          },
        })),
      },
    };
    optionRuntime.read.mockImplementation(async (_context, property) => {
      if (property.propertyId === brokenPropertyId) {
        throw new Error("registry unavailable");
      }
      return {
        options: [
          { id: "o_AAAAAAAA", name: "Selected View" },
          { id: "o_BBBBBBBB", name: "Next" },
          { id: "o_CCCCCCCC", name: "Loaded sibling" },
        ],
        nextCursor: null,
        projectionRevision: 1,
      };
    });
    try {
      let screen!: ReturnType<typeof render>;
      await act(async () => {
        screen = render(
          <DatabaseViewSurface
            model={loadingModel}
            searchQuery=""
            onOpenPage={() => undefined}
          />,
        );
        await Promise.resolve();
      });
      await waitFor(() => expect(optionRuntime.read).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByRole("button", {
        name: "Edit Tags",
      }).textContent).toContain("Loaded sibling"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("option", { name: "Loaded sibling" })).toBeTruthy());
      expect(optionRuntime.read).toHaveBeenCalledTimes(2);
      await act(async () => {
        screen.rerender(
          <DatabaseViewSurface
            model={{ ...loadingModel, commitSeq: loadingModel.commitSeq + 1 }}
            searchQuery=""
            onOpenPage={() => undefined}
          />,
        );
        await Promise.resolve();
      });
      expect(optionRuntime.read).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("option", { name: "Loaded sibling" })).toBeTruthy();
      await act(async () => {
        fireEvent.keyDown(screen.getByRole("combobox", { name: "Search Tags options" }), {
          key: "Escape",
        });
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("button", {
        name: "Edit Tags",
      }).getAttribute("aria-expanded")).toBe("false"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Broken select" }));
        await Promise.resolve();
      });
      const retry = await waitFor(() => screen.getByRole("button", {
        name: "Couldn’t load options. Retry",
      }));
      expect(screen.queryByText("registry unavailable")).toBeNull();
      expect(optionRuntime.read).toHaveBeenCalledTimes(3);
      await act(async () => {
        fireEvent.keyDown(retry, { key: "Escape" });
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("button", {
        name: "Edit Broken select",
      }).getAttribute("aria-expanded")).toBe("false"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByRole("option", {
        name: "Loaded sibling",
      })).toBeTruthy());
      expect(optionRuntime.read).toHaveBeenCalledTimes(3);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("keeps a sibling Property interactive while another Property mutation is pending", async () => {
    const flagPropertyId = parseDataSourcePropertyId("p_0123abcd");
    let resolveFirst: (() => void) | undefined;
    const commitOperations = vi.fn()
      .mockImplementationOnce(() => new Promise<null>((resolve) => {
        resolveFirst = () => resolve(null);
      }))
      .mockResolvedValue(null);
    const scopedModel: DatabaseViewRenderModel = {
      ...model,
      query: {
        ...model.query,
        view: {
          ...model.query.view,
          config: {
            ...model.query.view.config,
            presentation: {
              ...model.query.view.config.presentation,
              layouts: {
                ...model.query.view.config.presentation.layouts,
                list: {
                  ...model.query.view.config.presentation.layouts.list,
                  fields: [tagsPropertyId, flagPropertyId].map(
                    (propertyId) => ({ kind: "property" as const, propertyId }),
                  ),
                },
              },
            },
          },
        },
        properties: [
          ...model.query.properties,
          {
            ...model.query.properties[0]!,
            propertyId: flagPropertyId,
            name: "Flag",
            ...testPropertySemantics("checkbox"),
            valueType: "checkbox",
            config: {},
            optionCount: 0,
            rankKey: "b",
          },
        ],
        rows: model.query.rows.map((row) => ({
          ...row,
          values: {
            ...row.values,
            [flagPropertyId]: {
              propertyId: flagPropertyId,
              valueType: "checkbox",
              value: true,
              revision: 1,
            },
          },
        })),
      },
    };
    const screen = render(
      <DatabaseViewSurface
        model={scopedModel}
        searchQuery=""
        onOpenPage={() => undefined}
        commitOperations={commitOperations}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Next" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(commitOperations).toHaveBeenCalledTimes(1));
    const flag = screen.getByRole("checkbox", { name: "Flag value" }) as HTMLButtonElement;
    expect(flag.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(flag);
      await Promise.resolve();
    });
    expect(commitOperations).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
    });
  });

  test("keeps mutation failures with their Property and hides transport details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery=""
        onOpenPage={() => undefined}
        commitOperations={() => Promise.reject(new Error("databaseApplyV2 leaked detail"))}
      />,
    );
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: "Next" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText("Couldn’t save this property. Try again."))
        .toBeTruthy());
      expect(screen.queryByText(/databaseApplyV2/)).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  test("keeps option creation open and local when the atomic commit fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const screen = render(
      <DatabaseViewSurface
        model={model}
        searchQuery=""
        onOpenPage={() => undefined}
        commitOperations={async () => {
          throw new Error("atomic option rejected");
        }}
      />,
    );
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Edit Tags" }));
        await Promise.resolve();
      });
      const search = screen.getByRole("combobox", { name: "Search Tags options" });
      await act(async () => {
        fireEvent.change(search, { target: { value: "Fresh" } });
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Create “Fresh”" }));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByText("Couldn’t create option. Try again."))
        .toBeTruthy());
      expect(screen.queryByText("atomic option rejected")).toBeNull();
      expect(screen.getByRole("combobox", { name: "Search Tags options" })).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });
});

function DatabaseViewTabHarness() {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  return (
    <DatabaseViewTabSurface
      model={model}
      activeSearchQuery={query}
      taskSearchOpen={searchOpen}
      searchShortcutLabel="Ctrl+F"
      taskSearchInputRef={searchInputRef}
      onSearchQueryChange={setQuery}
      onOpenTaskSearch={() => setSearchOpen(true)}
      onCloseTaskSearch={() => setSearchOpen(false)}
      onOpenPage={() => undefined}
    />
  );
}

function NestedDatabaseListHarness({
  onSelectedPageIdsChange,
}: {
  readonly onSelectedPageIdsChange: (pageIds: ReadonlySet<string>) => void;
}) {
  const [collapsedKeys, setCollapsedKeys] = useState<readonly string[]>([]);
  return (
    <DatabaseViewTabSurface
      model={nestedListModel()}
      presentationLayout="list"
      activeSearchQuery=""
      taskSearchOpen={false}
      searchShortcutLabel="Ctrl+F"
      taskSearchInputRef={{ current: null }}
      onSearchQueryChange={() => undefined}
      onOpenTaskSearch={() => undefined}
      onCloseTaskSearch={() => undefined}
      onOpenPage={() => undefined}
      collapsedOccurrenceKeys={collapsedKeys}
      onOccurrenceDisclosureChange={(target, collapsed) => {
        setCollapsedKeys((current) => {
          const next = new Set(current);
          if (collapsed) next.add(target.occurrenceKey);
          else next.delete(target.occurrenceKey);
          return [...next];
        });
      }}
      onSelectedPageIdsChange={onSelectedPageIdsChange}
    />
  );
}

describe("DatabaseViewTabSurface", () => {
  test("uses the effective presentation as the only layout authority", () => {
    const screen = render(
      <DatabaseViewTabSurface
        model={model}
        presentationLayout="board"
        effectivePresentation={{
          layout: "list",
          presentation: model.query.view.config.presentation,
        }}
        activeSearchQuery=""
        taskSearchOpen={false}
        searchShortcutLabel="Ctrl+F"
        taskSearchInputRef={{ current: null }}
        boardSurface={<div>Stale Board presenter</div>}
        onSearchQueryChange={() => undefined}
        onOpenTaskSearch={() => undefined}
        onCloseTaskSearch={() => undefined}
        onOpenPage={() => undefined}
      />,
    );

    expect(screen.queryByText("Stale Board presenter")).toBeNull();
    expect(screen.getByRole("grid", { name: "Database List" })).toBeTruthy();
  });

  test("keeps the established Board presenter for canonical Board layouts", () => {
    const screen = render(
      <DatabaseViewTabSurface
        model={model}
        presentationLayout="board"
        activeSearchQuery=""
        taskSearchOpen={false}
        searchShortcutLabel="Ctrl+F"
        taskSearchInputRef={{ current: null }}
        boardSurface={<div>Established Board presenter</div>}
        onSearchQueryChange={() => undefined}
        onOpenTaskSearch={() => undefined}
        onCloseTaskSearch={() => undefined}
        onOpenPage={() => undefined}
      />,
    );

    expect(screen.getByText("Established Board presenter")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  test("uses the DB View tab toolbar to search the shared Database surface", async () => {
    const screen = render(<DatabaseViewTabHarness />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Search tasks" }), {
        target: { value: "missing page" },
      });
      await Promise.resolve();
    });

    expect(screen.getByText("No matching Pages")).toBeTruthy();
  });

  test("uses the independent List grid for an always-visible hierarchy and keyboard range selection", async () => {
    const selectedSnapshots: ReadonlySet<string>[] = [];
    const screen = render(
      <NestedDatabaseListHarness
        onSelectedPageIdsChange={(pageIds) => selectedSnapshots.push(pageIds)}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Database List" });
    expect(screen.getByRole("button", { name: "Open Page Next Page" })).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
      fireEvent.keyDown(grid, { key: " " });
      fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
      await Promise.resolve();
    });
    await waitFor(() => expect(selectedSnapshots.at(-1)).toEqual(
      new Set(["page-focused", "page-next"]),
    ));

    expect(screen.getByRole("button", { name: "Open Page Next Page" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sub-pages of Focused Page/ })).toBeNull();
    expect(screen.queryByRole("article")).toBeNull();
  });

  test("uses canonical status group labels and routes header creation to that status", () => {
    const onRequestCreatePage = vi.fn();
    const screen = render(
      <DatabaseViewTabSurface
        model={groupedListModel()}
        presentationLayout="list"
        activeSearchQuery=""
        taskSearchOpen={false}
        searchShortcutLabel="Ctrl+F"
        taskSearchInputRef={{ current: null }}
        pageCreateSurfaceId="surface-list"
        onRequestCreatePage={onRequestCreatePage}
        onSearchQueryChange={() => undefined}
        onOpenTaskSearch={() => undefined}
        onCloseTaskSearch={() => undefined}
        onOpenPage={() => undefined}
      />,
    );

    expect(screen.getByText("Build")).toBeTruthy();
    expect(screen.queryByText("build")).toBeNull();
    expect(screen.container.querySelector(
      '[data-page-create-surface-id="surface-list"]',
    )).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create new Page" }));
    expect(onRequestCreatePage).toHaveBeenCalledWith("build");
  });
});
