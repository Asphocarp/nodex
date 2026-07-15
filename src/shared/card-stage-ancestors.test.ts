import { describe, expect, test } from "vitest";
import {
  appendCardStageAncestor,
  MAX_CARD_STAGE_ANCESTOR_DEPTH,
} from "./card-stage-ancestors";

describe("card stage ancestors", () => {
  test("appends the current card while collapsing repeated ancestry", () => {
    expect(appendCardStageAncestor([
      { projectId: "alpha", cardId: "root", titleSnapshot: "Root" },
      { projectId: "alpha", cardId: "child", titleSnapshot: "Child" },
    ], {
      projectId: "alpha",
      cardId: "root",
      titleSnapshot: "Root renamed",
    })).toEqual([
      { projectId: "alpha", cardId: "root", titleSnapshot: "Root renamed" },
    ]);
  });

  test("keeps the nearest bounded ancestor trail", () => {
    const ancestors = Array.from({ length: MAX_CARD_STAGE_ANCESTOR_DEPTH }, (_, index) => ({
      projectId: "alpha",
      cardId: `card-${index}`,
      titleSnapshot: `Card ${index}`,
    }));

    const result = appendCardStageAncestor(ancestors, {
      projectId: "alpha",
      cardId: "current",
      titleSnapshot: "Current",
    });

    expect(result).toHaveLength(MAX_CARD_STAGE_ANCESTOR_DEPTH);
    expect(result[0]?.cardId).toBe("card-1");
    expect(result.at(-1)?.cardId).toBe("current");
  });
});
