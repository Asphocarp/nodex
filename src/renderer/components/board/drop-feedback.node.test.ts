import { describe, expect, test } from "vitest";
import type { BoardSummary } from "@/lib/types";
import { plainTextToPortableRichText } from "../../../shared/block-documents";
import { resolveBoardDropFeedback } from "./drop-feedback";

const EMPTY_BOARD: BoardSummary = {
  columns: [
    {
      id: "plan",
      name: "Plan",
      cards: [],
    },
  ],
};

const FILLED_BOARD: BoardSummary = {
  columns: [
    {
      id: "plan",
      name: "Plan",
      cards: [
        {
          id: "card-1",
          status: "plan",
          archived: false,
          title: "Task",
          richTitle: plainTextToPortableRichText("Task"),
          descriptionPreview: "",
          descriptionLength: 0,
          hasDescription: false,
          tags: [],
          created: new Date("2026-03-19T00:00:00.000Z"),
          order: 0,
        },
      ],
    },
  ],
};

describe("resolveBoardDropFeedback", () => {
  test("uses whole-column feedback for empty target columns", () => {
    const feedback = resolveBoardDropFeedback({
      visibleBoard: EMPTY_BOARD,
      columnId: "plan",
      visibleIndex: 0,
      showSlotIndicator: true,
    });

    expect(feedback.dropIndicator).toBe(null);
    expect(feedback.activeDropColumnId).toBe("plan");
  });

  test("uses an insertion indicator for non-empty columns when slot feedback is truthful", () => {
    const feedback = resolveBoardDropFeedback({
      visibleBoard: FILLED_BOARD,
      columnId: "plan",
      visibleIndex: 1,
      showSlotIndicator: true,
      label: "P1",
    });

    expect(feedback.activeDropColumnId).toBe(null);
    expect(feedback.dropIndicator?.columnId).toBe("plan");
    expect(feedback.dropIndicator?.index).toBe(1);
    expect(feedback.dropIndicator?.label).toBe("P1");
  });

  test("uses whole-column feedback when slot indicators are intentionally disabled", () => {
    const feedback = resolveBoardDropFeedback({
      visibleBoard: FILLED_BOARD,
      columnId: "plan",
      visibleIndex: 0,
      showSlotIndicator: false,
    });

    expect(feedback.dropIndicator).toBe(null);
    expect(feedback.activeDropColumnId).toBe("plan");
  });
});
