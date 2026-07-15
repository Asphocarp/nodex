import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { Column } from "./column";
import { render } from "@/test/dom";
import { plainTextToPortableRichText } from "../../../shared/block-documents";

describe("Column", () => {
  test("renders the blocked-sort feedback message in the header", () => {
    const { container } = render(createElement(Column, {
      projectId: "default",
      projectName: "Default",
      column: {
        id: "in_progress",
        name: "In Progress",
        cards: [
          {
            id: "card-1",
            status: "in_progress",
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
      onAddCard: async () => {},
      onEditCard: () => {},
      onUpdateCardProperty: async () => {},
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
        id: "backlog",
        name: "Backlog",
        cards: [],
      },
      layout: {
        width: 320,
        collapsed: false,
      },
      onAddCard: async () => {},
      onEditCard: () => {},
      onUpdateCardProperty: async () => {},
      onCollapsedChange: () => {},
      onWidthChange: () => {},
      isDropTargetActive: true,
    }));

    const columnRoot = container.querySelector("[data-kanban-column-id='backlog']");
    expect(columnRoot?.getAttribute("data-kanban-column-collapsed")).toBe("true");
    expect(container.textContent?.includes("New task")).toBe(false);
  });

  test("opens a double-clicked card with durable mode", () => {
    let lastMode: string | undefined;
    const { container } = render(createElement(Column, {
      projectId: "default",
      projectName: "Default",
      column: {
        id: "in_progress",
        name: "In Progress",
        cards: [
          {
            id: "card-1",
            status: "in_progress",
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
      activePanelCardStageCardIds: new Set(["card-1"]),
      onAddCard: async () => {},
      onEditCard: (_columnId, _card, _event, openMode) => {
        lastMode = openMode;
      },
      onUpdateCardProperty: async () => {},
      onCollapsedChange: () => {},
      onWidthChange: () => {},
    }));

    const cardSurface = container.querySelector("[data-kanban-card-panel-active='true']");
    if (!(cardSurface instanceof HTMLElement)) throw new Error("Expected active card surface");

    fireEvent.doubleClick(cardSurface);

    expect(lastMode).toBe("durable");
  });
});
