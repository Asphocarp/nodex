import { describe, expect, test } from "vitest";
import type { BoardSummary, WorkflowStatus, DatabasePageSummary } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { resolveFilteredDropOrder } from "./filtered-drag-order";

function createPage(id: string, status: WorkflowStatus, order: number): DatabasePageSummary {
  return {
    id,
    status,
    archived: false,
    title: id,
    richTitle: plainTextToPortableRichText(id),
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
    tags: [],
    created: new Date("2026-03-14T00:00:00.000Z"),
    order,
  };
}

function createBoard(columns: Record<WorkflowStatus, string[]>): BoardSummary {
  const orderedStatuses: WorkflowStatus[] = ["triage", "plan", "build", "review", "ship"];
  return {
    columns: orderedStatuses.map((status) => ({
      id: status,
      name: status,
      cards: (columns[status] ?? []).map((id, index) => createPage(id, status, index)),
    })),
  };
}

describe("resolveFilteredDropOrder", () => {
  test("inserts before the next visible anchor while preserving hidden cards", () => {
    const board = createBoard({
      triage: [],
      plan: [],
      build: ["hidden-a", "visible-b", "hidden-c", "visible-d", "hidden-e"],
      review: ["moved"],
      ship: [],
    });
    const visibleBoard = createBoard({
      triage: [],
      plan: [],
      build: ["visible-b", "visible-d"],
      review: ["moved"],
      ship: [],
    });

    const order = resolveFilteredDropOrder({
      board,
      visibleBoard,
      draggedPageIds: ["moved"],
      targetColumnId: "build",
      targetVisibleIndex: 1,
    });

    expect(order).toBe(3);
  });

  test("drops after the last visible card instead of after trailing hidden cards", () => {
    const board = createBoard({
      triage: [],
      plan: [],
      build: ["hidden-a", "visible-b", "hidden-c", "visible-d", "hidden-e"],
      review: ["moved"],
      ship: [],
    });
    const visibleBoard = createBoard({
      triage: [],
      plan: [],
      build: ["visible-b", "visible-d"],
      review: ["moved"],
      ship: [],
    });

    const order = resolveFilteredDropOrder({
      board,
      visibleBoard,
      draggedPageIds: ["moved"],
      targetColumnId: "build",
      targetVisibleIndex: 2,
    });

    expect(order).toBe(4);
  });

  test("keeps same-column drops stable when the dragged card is the only visible match", () => {
    const board = createBoard({
      triage: [],
      plan: [],
      build: ["visible-a", "hidden-b"],
      review: [],
      ship: [],
    });
    const visibleBoard = createBoard({
      triage: [],
      plan: [],
      build: ["visible-a"],
      review: [],
      ship: [],
    });

    const order = resolveFilteredDropOrder({
      board,
      visibleBoard,
      draggedPageIds: ["visible-a"],
      targetColumnId: "build",
      targetVisibleIndex: 1,
    });

    expect(order).toBe(0);
  });

  test("maps same-column filtered drops from the remaining visible slot space", () => {
    const board = createBoard({
      triage: [],
      plan: [],
      build: ["hidden-a", "visible-b", "hidden-c", "visible-d", "hidden-e"],
      review: [],
      ship: [],
    });
    const visibleBoard = createBoard({
      triage: [],
      plan: [],
      build: ["visible-b", "visible-d"],
      review: [],
      ship: [],
    });

    const order = resolveFilteredDropOrder({
      board,
      visibleBoard,
      draggedPageIds: ["visible-b"],
      targetColumnId: "build",
      targetVisibleIndex: 1,
    });

    expect(order).toBe(3);
  });

  test("maps same-column unfiltered drops from the remaining visible slot space", () => {
    const board = createBoard({
      triage: [],
      plan: [],
      build: ["a", "b", "c"],
      review: [],
      ship: [],
    });

    const order = resolveFilteredDropOrder({
      board,
      visibleBoard: board,
      draggedPageIds: ["a"],
      targetColumnId: "build",
      targetVisibleIndex: 1,
    });

    expect(order).toBe(1);
  });
});
