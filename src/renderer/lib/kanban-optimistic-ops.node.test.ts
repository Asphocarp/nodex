import { describe, expect, test } from "vitest";
import {
  buildCreateCardTransform,
  buildMovePageTransform,
  buildMovePagesTransform,
  buildPatchPageTransform,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import type { BoardSummary, DatabasePageSummary } from "./types";
import { plainTextToPortableRichText } from "../../shared/block-documents";

function createPageSummary(id: string, order: number): DatabasePageSummary {
  return {
    id,
    status: "build",
    archived: false,
    title: id,
    richTitle: plainTextToPortableRichText(id),
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
    tags: [],
    created: new Date("2026-03-17T00:00:00.000Z"),
    order,
  };
}

function createBoard(): BoardSummary {
  return {
    columns: [
      {
        id: "triage",
        name: "Triage",
        cards: [],
      },
      {
        id: "plan",
        name: "Plan",
        cards: [],
      },
      {
        id: "build",
        name: "Build",
        cards: ["a", "b", "c", "d"].map((id, order) => createPageSummary(id, order)),
      },
      {
        id: "review",
        name: "Review",
        cards: [],
      },
      {
        id: "ship",
        name: "Ship",
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
    const card = createPageSummary("new", 0);

    const nextBoard = buildCreateCardTransform(
      "build",
      card,
      { beforePageId: "c" },
    )(board);

    expect(nextBoard.columns[2]?.cards.map((item) => item.id)).toEqual([
      "a",
      "b",
      "new",
      "c",
      "d",
    ]);
  });

  test("treats an existing Page identity as a converged create", () => {
    const board = createBoard();
    const optimisticCard = {
      ...createPageSummary("new", 0),
      title: "Optimistic title",
      richTitle: plainTextToPortableRichText("Optimistic title"),
    };
    const transform = buildCreateCardTransform(
      "build",
      optimisticCard,
      "top",
    );

    const created = transform(board);
    const reapplied = transform(created);

    expect(reapplied).toBe(created);
    expect(
      reapplied.columns.flatMap((column) => column.cards)
        .filter((card) => card.id === optimisticCard.id),
    ).toHaveLength(1);
  });

  test("preserves canonical placement and fields when create authority arrives", () => {
    const baseBoard = createBoard();
    const canonicalCard = {
      ...createPageSummary("canonical", 0),
      status: "ship" as const,
      title: "Canonical title",
      richTitle: plainTextToPortableRichText("Canonical title"),
      revision: 1,
    };
    const board: BoardSummary = {
      ...baseBoard,
      columns: baseBoard.columns.map((column) =>
        column.id === "ship"
          ? { ...column, cards: [canonicalCard] }
          : column
      ),
    };
    const optimisticCard = {
      ...canonicalCard,
      status: "build" as const,
      title: "Optimistic title",
      richTitle: plainTextToPortableRichText("Optimistic title"),
      revision: undefined,
    };

    const projected = buildCreateCardTransform(
      "build",
      optimisticCard,
      "top",
    )(board);

    expect(projected).toBe(board);
    expect(projected.columns[4]?.cards).toEqual([canonicalCard]);
    expect(
      projected.columns[2]?.cards.some((card) => card.id === canonicalCard.id),
    ).toBe(false);
  });

  test("treats equivalent projected title and structured values as a no-op", () => {
    const board = createBoard();

    expect(buildPatchPageTransform("build", "a", {
      title: "a",
      tags: [],
    })(board)).toBe(board);

    const renamed = buildPatchPageTransform("build", "a", {
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

    const nextBoard = buildMovePageTransform({
      pageId: "a",
      fromStatus: "build",
      toStatus: "build",
      newOrder: 1,
    })(board);

    expect(nextBoard.columns[2]?.cards.map((card) => card.id).join(",")).toBe("b,a,c,d");
  });

  test("move-many uses post-removal insertion indices for same-column reorders", () => {
    const board = createBoard();

    const nextBoard = buildMovePagesTransform({
      pageIds: ["a", "c"],
      fromStatus: "build",
      toStatus: "build",
      newOrder: 1,
    })(board);

    expect(nextBoard.columns[2]?.cards.map((card) => card.id).join(",")).toBe("b,a,c,d");
  });

  test("move-card applies the drag field patch before reinserting", () => {
    const board = createBoard();

    const nextBoard = buildMovePageTransform({
      pageId: "a",
      fromStatus: "build",
      toStatus: "build",
      newOrder: 1,
      fieldPatch: { priority: "p1-high" },
    })(board);

    expect(nextBoard.columns[2]?.cards[1]?.priority).toBe("p1-high");
  });

  test("move-many applies the drag field patch to every dragged card", () => {
    const board = createBoard();

    const nextBoard = buildMovePagesTransform({
      pageIds: ["a", "c"],
      fromStatus: "build",
      toStatus: "build",
      newOrder: 1,
      fieldPatch: { estimate: "m" },
    })(board);

    expect(nextBoard.columns[2]?.cards[1]?.estimate).toBe("m");
    expect(nextBoard.columns[2]?.cards[2]?.estimate).toBe("m");
  });
});
