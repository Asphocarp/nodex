import { describe, expect, test } from "bun:test";
import {
  buildMoveCardTransform,
  buildMoveCardsTransform,
  buildCardEditorDropTransform,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import type { BoardSummary, CardSummary } from "./types";

function createCardSummary(id: string, order: number): CardSummary {
  return {
    id,
    status: "in_progress",
    archived: false,
    title: id,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
    tags: [],
    agentBlocked: false,
    created: new Date("2026-03-17T00:00:00.000Z"),
    order,
  };
}

function createBoard(): BoardSummary {
  return {
    columns: [
      {
        id: "draft",
        name: "Draft",
        cards: [],
      },
      {
        id: "backlog",
        name: "Backlog",
        cards: [],
      },
      {
        id: "in_progress",
        name: "In Progress",
        cards: ["a", "b", "c", "d"].map((id, order) => createCardSummary(id, order)),
      },
      {
        id: "in_review",
        name: "In Review",
        cards: [],
      },
      {
        id: "done",
        name: "Done",
        cards: [],
      },
    ],
  };
}

describe("kanban optimistic ops", () => {
  test("creates optimistic cards without a default priority", () => {
    const card = createOptimisticCard({
      title: "Optimistic card",
    });

    expect(card.priority ?? null).toBe(null);
  });

  test("card editor copy patches targets without removing source cards", () => {
    const board = createBoard();
    const nextBoard = buildCardEditorDropTransform({
      operation: "copy",
      sourceCards: [{ cardId: "a", status: "in_progress" }],
      targetUpdates: [{
        projectId: "default",
        status: "in_progress",
        cardId: "b",
        updates: { title: "Copied into editor" },
      }],
    }, "default")(board);

    expect(nextBoard.columns[2]?.cards.map((card) => card.id).join(",")).toBe("a,b,c,d");
    expect(nextBoard.columns[2]?.cards[1]?.title).toBe("Copied into editor");
  });

  test("cross-project move does not optimistically delete same-id target cards", () => {
    const board = createBoard();
    const nextBoard = buildCardEditorDropTransform({
      operation: "move",
      sourceProjectId: "other",
      sourceCards: [{ cardId: "a", status: "in_progress" }],
      targetUpdates: [{
        projectId: "default",
        status: "in_progress",
        cardId: "b",
        updates: { title: "Moved into editor" },
      }],
    }, "default")(board);

    expect(nextBoard.columns[2]?.cards.map((card) => card.id).join(",")).toBe("a,b,c,d");
  });

  test("move-card uses post-removal insertion indices for same-column reorders", () => {
    const board = createBoard();

    const nextBoard = buildMoveCardTransform({
      cardId: "a",
      fromStatus: "in_progress",
      toStatus: "in_progress",
      newOrder: 1,
    })(board);

    expect(nextBoard.columns[2]?.cards.map((card) => card.id).join(",")).toBe("b,a,c,d");
  });

  test("move-many uses post-removal insertion indices for same-column reorders", () => {
    const board = createBoard();

    const nextBoard = buildMoveCardsTransform({
      cardIds: ["a", "c"],
      fromStatus: "in_progress",
      toStatus: "in_progress",
      newOrder: 1,
    })(board);

    expect(nextBoard.columns[2]?.cards.map((card) => card.id).join(",")).toBe("b,a,c,d");
  });

  test("move-card applies the drag field patch before reinserting", () => {
    const board = createBoard();

    const nextBoard = buildMoveCardTransform({
      cardId: "a",
      fromStatus: "in_progress",
      toStatus: "in_progress",
      newOrder: 1,
      fieldPatch: { priority: "p1-high" },
    })(board);

    expect(nextBoard.columns[2]?.cards[1]?.priority).toBe("p1-high");
  });

  test("move-many applies the drag field patch to every dragged card", () => {
    const board = createBoard();

    const nextBoard = buildMoveCardsTransform({
      cardIds: ["a", "c"],
      fromStatus: "in_progress",
      toStatus: "in_progress",
      newOrder: 1,
      fieldPatch: { estimate: "m" },
    })(board);

    expect(nextBoard.columns[2]?.cards[1]?.estimate).toBe("m");
    expect(nextBoard.columns[2]?.cards[2]?.estimate).toBe("m");
  });
});
