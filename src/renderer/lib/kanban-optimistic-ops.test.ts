import { describe, expect, test } from "vitest";
import {
  buildCreateCardTransform,
  buildMoveCardTransform,
  buildMoveCardsTransform,
  buildPatchCardTransform,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import type { BoardSummary, CardSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents";

function createCardSummary(id: string, order: number): CardSummary {
  return {
    id,
    status: "in_progress",
    archived: false,
    title: id,
    richTitle: plainTextToPortableRichText(id),
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

  test("creates a Card before the stable View anchor used by the mutation", () => {
    const board = createBoard();
    const card = createCardSummary("new", 0);

    const nextBoard = buildCreateCardTransform(
      "in_progress",
      card,
      { beforeCardId: "c" },
    )(board);

    expect(nextBoard.columns[2]?.cards.map((item) => item.id)).toEqual([
      "a",
      "b",
      "new",
      "c",
      "d",
    ]);
  });

  test("treats equivalent projected title and structured values as a no-op", () => {
    const board = createBoard();

    expect(buildPatchCardTransform("in_progress", "a", {
      title: "a",
      tags: [],
    })(board)).toBe(board);

    const renamed = buildPatchCardTransform("in_progress", "a", {
      title: "Renamed",
    })(board);
    expect(renamed).not.toBe(board);
    expect(renamed.columns[2]?.cards[0]).toMatchObject({
      title: "Renamed",
      richTitle: [{ type: "text", text: "Renamed", styles: {} }],
    });
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
