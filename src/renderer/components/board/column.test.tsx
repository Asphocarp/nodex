import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { Column } from "./column";
import { renderWithMaitai as render } from "@/test/dom";
import { plainTextToPortableRichText } from "../../../shared/block-documents/portable-rich-text";
import type { DatabasePageSummary } from "@/lib/types";
import { NodexTooltipProvider } from "@/components/ui/tooltip";

describe("Column", () => {
  test("keeps pointer hover transient and activates a Page on pointer down", () => {
    const highlighted: string[] = [];
    const { container } = render(createElement(Column, {
      projectId: "default",
      projectName: "Default",
      column: {
        id: "build",
        name: "Build",
        cards: [{
          id: "card-1",
          pageKey: null,
          status: "build",
          archived: false,
          title: "Task",
          richTitle: plainTextToPortableRichText("Task"),
          descriptionPreview: "",
          descriptionLength: 0,
          hasDescription: false,
          tags: [],
          created: new Date("2026-03-17T00:00:00.000Z"),
          order: 0,
        }],
      },
      layout: { width: 320, collapsed: false },
      onRequestCreatePage: () => {},
      onEditCard: () => {},
      onUpdatePageProperty: async () => {},
      onCollapsedChange: () => {},
      onWidthChange: () => {},
      onCardHighlight: (pageId) => highlighted.push(pageId),
    }));
    const card = container.querySelector<HTMLElement>(
      "[data-board-uuid-v7='card-1']",
    );
    if (!card) throw new Error("Expected the Board card interaction boundary");

    fireEvent.pointerEnter(card);
    expect(highlighted).toEqual([]);

    fireEvent.pointerDown(card);
    expect(highlighted).toEqual(["card-1"]);
  });

  test("renders the blocked-sort feedback message in the header", () => {
    const { container } = render(createElement(Column, {
      projectId: "default",
      projectName: "Default",
      column: {
        id: "build",
        name: "Build",
        cards: [
          {
            id: "card-1",
            pageKey: null,
            status: "build",
            archived: false,
            title: "Task",
            richTitle: plainTextToPortableRichText("Task"),
            descriptionPreview: "",
            descriptionLength: 0,
            hasDescription: false,
            tags: [],
            created: new Date("2026-03-17T00:00:00.000Z"),
            order: 0,
          },
        ],
      },
      layout: {
        width: 320,
        collapsed: false,
      },
      onRequestCreatePage: () => {},
      onEditCard: () => {},
      onUpdatePageProperty: async () => {},
      onCollapsedChange: () => {},
      onWidthChange: () => {},
      dropBlockedMessage: "Sorted by title; switch to Board Order to manually rank.",
    }));

    expect(container.textContent?.includes("Sorted by title; switch to Board Order to manually rank.")).toBe(true);
  });

  test("keeps an empty column collapsed while it is the active drop target", () => {
    const { container } = render(createElement(Column, {
      projectId: "default",
      projectName: "Default",
      column: {
        id: "plan",
        name: "Plan",
        cards: [],
      },
      layout: {
        width: 320,
        collapsed: false,
      },
      onRequestCreatePage: () => {},
      onEditCard: () => {},
      onUpdatePageProperty: async () => {},
      onCollapsedChange: () => {},
      onWidthChange: () => {},
      isDropTargetActive: true,
    }));

    const columnRoot = container.querySelector("[data-board-column-id='plan']");
    expect(columnRoot?.getAttribute("data-board-column-collapsed")).toBe("true");
    expect(container.textContent?.includes("New task")).toBe(false);
  });

  test("opens a double-clicked card with durable mode", () => {
    let lastMode: string | undefined;
    const { container } = render(createElement(Column, {
      projectId: "default",
      projectName: "Default",
      column: {
        id: "build",
        name: "Build",
        cards: [
          {
            id: "card-1",
            pageKey: null,
            status: "build",
            archived: false,
            title: "Task",
            richTitle: plainTextToPortableRichText("Task"),
            descriptionPreview: "",
            descriptionLength: 0,
            hasDescription: false,
            tags: [],
            created: new Date("2026-03-17T00:00:00.000Z"),
            order: 0,
          },
        ],
      },
      layout: {
        width: 320,
        collapsed: false,
      },
      presentedPageIds: new Set(["card-1"]),
      onRequestCreatePage: () => {},
      onEditCard: (_columnId, _card, _event, openMode) => {
        lastMode = openMode;
      },
      onUpdatePageProperty: async () => {},
      onCollapsedChange: () => {},
      onWidthChange: () => {},
    }));

    const cardSurface = container.querySelector("[data-board-card-presented='true']");
    if (!(cardSurface instanceof HTMLElement)) throw new Error("Expected active card surface");

    fireEvent.doubleClick(cardSurface);

    expect(lastMode).toBe("durable");
  });

  test("pages its own group window and reports the true group total", async () => {
    const loadMoreCalls: string[] = [];
    const { getByRole, getByText } = render(createElement(Column, {
      projectId: "default",
      projectName: "Default",
      column: {
        id: "build",
        name: "Build",
        cards: [
          {
            id: "card-1",
            pageKey: null,
            status: "build",
            archived: false,
            title: "Task",
            richTitle: plainTextToPortableRichText("Task"),
            descriptionPreview: "",
            descriptionLength: 0,
            hasDescription: false,
            tags: [],
            created: new Date("2026-03-17T00:00:00.000Z"),
            order: 0,
          },
        ],
      },
      pagination: {
        scopeKey: "key:build",
        loadedRows: 1,
        totalRows: 26,
        hasMore: true,
        loadingMore: false,
        error: null,
      },
      onLoadMore: (scopeKey) => {
        loadMoreCalls.push(scopeKey);
      },
      layout: {
        width: 320,
        collapsed: false,
      },
      onRequestCreatePage: () => {},
      onEditCard: () => {},
      onUpdatePageProperty: async () => {},
      onCollapsedChange: () => {},
      onWidthChange: () => {},
    }));

    // The count badge shows the group's true total, not the loaded window.
    expect(getByText("26")).toBeTruthy();

    const showMore = getByRole("button", { name: "Show 25 more" });
    fireEvent.click(showMore);

    expect(loadMoreCalls).toEqual(["key:build"]);
  });

  test("routes header, footer, and empty-column launchers through one create intent", () => {
    const requests: Array<[string, string]> = [];
    const createColumn = (cards: DatabasePageSummary[]) =>
      createElement(Column, {
        projectId: "default",
        projectName: "Default",
        column: { id: "build", name: "Build", cards },
        layout: { width: 320, collapsed: false },
        onRequestCreatePage: (columnId, origin) => {
          requests.push([columnId, origin]);
        },
        onEditCard: () => {},
        onUpdatePageProperty: async () => {},
        onCollapsedChange: () => {},
        onWidthChange: () => {},
      });

    const existingCard = {
      id: "card-1",
      pageKey: null,
      status: "build" as const,
      archived: false,
      title: "Task",
      richTitle: plainTextToPortableRichText("Task"),
      descriptionPreview: "",
      descriptionLength: 0,
      hasDescription: false,
      tags: [],
      created: new Date("2026-03-17T00:00:00.000Z"),
      order: 0,
    };
    const populated = render(createColumn([existingCard]));

    fireEvent.click(populated.getByRole("button", { name: "Create Page in Build" }));
    fireEvent.click(populated.getByRole("button", { name: "New page" }));
    populated.unmount();

    const empty = render(createColumn([]));
    const collapsedLauncher = empty.container.querySelector(
      "[data-page-create-trigger='auto-collapsed-column']",
    );
    if (!(collapsedLauncher instanceof HTMLElement)) {
      throw new Error("Expected empty-column create launcher");
    }
    fireEvent.click(collapsedLauncher);

    expect(requests).toEqual([
      ["build", "header"],
      ["build", "footer"],
      ["build", "auto-collapsed-column"],
    ]);
  });

  test("disables Page creation affordances for a read-only View", () => {
    const requests: string[] = [];
    const { container } = render(createElement(
      NodexTooltipProvider,
      null,
      createElement(Column, {
        projectId: "default",
        projectName: "Default",
        column: { id: "build", name: "Build", cards: [] },
        layout: { width: 320, collapsed: false },
        createDisabledReason: "This View is read-only",
        onRequestCreatePage: (_columnId, origin) => requests.push(origin),
        onEditCard: () => {},
        onUpdatePageProperty: async () => {},
        onCollapsedChange: () => {},
        onWidthChange: () => {},
      }),
    ));

    const collapsedLauncher = container.querySelector(
      "[data-page-create-trigger='auto-collapsed-column']",
    );
    if (!(collapsedLauncher instanceof HTMLElement)) {
      throw new Error("Expected empty-column create launcher");
    }
    expect(collapsedLauncher.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(collapsedLauncher);

    expect(requests).toEqual([]);
  });
});
