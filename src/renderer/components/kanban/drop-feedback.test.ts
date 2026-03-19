import { describe, expect, test } from "bun:test";
import type { Board } from "@/lib/types";
import { resolveKanbanDropFeedback } from "./drop-feedback";

const EMPTY_BOARD: Board = {
  columns: [
    {
      id: "backlog",
      name: "Backlog",
      cards: [],
    },
  ],
};

const FILLED_BOARD: Board = {
  columns: [
    {
      id: "backlog",
      name: "Backlog",
      cards: [
        {
          id: "card-1",
          status: "backlog",
          archived: false,
          title: "Task",
          description: "",
          tags: [],
          agentBlocked: false,
          created: new Date("2026-03-19T00:00:00.000Z"),
          order: 0,
        },
      ],
    },
  ],
};

describe("resolveKanbanDropFeedback", () => {
  test("uses whole-column feedback for empty target columns", () => {
    const feedback = resolveKanbanDropFeedback({
      visibleBoard: EMPTY_BOARD,
      columnId: "backlog",
      visibleIndex: 0,
      showSlotIndicator: true,
    });

    expect(feedback.dropIndicator).toBe(null);
    expect(feedback.activeDropColumnId).toBe("backlog");
  });

  test("uses an insertion indicator for non-empty columns when slot feedback is truthful", () => {
    const feedback = resolveKanbanDropFeedback({
      visibleBoard: FILLED_BOARD,
      columnId: "backlog",
      visibleIndex: 1,
      showSlotIndicator: true,
      label: "P1",
    });

    expect(feedback.activeDropColumnId).toBe(null);
    expect(feedback.dropIndicator?.columnId).toBe("backlog");
    expect(feedback.dropIndicator?.index).toBe(1);
    expect(feedback.dropIndicator?.label).toBe("P1");
  });

  test("uses whole-column feedback when slot indicators are intentionally disabled", () => {
    const feedback = resolveKanbanDropFeedback({
      visibleBoard: FILLED_BOARD,
      columnId: "backlog",
      visibleIndex: 0,
      showSlotIndicator: false,
    });

    expect(feedback.dropIndicator).toBe(null);
    expect(feedback.activeDropColumnId).toBe("backlog");
  });
});
