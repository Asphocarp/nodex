import { describe, expect, test } from "vitest";
import {
  appendCardStageAncestor,
  MAX_CARD_STAGE_ANCESTOR_DEPTH,
} from "./card-stage-ancestors";

describe("card stage ancestors", () => {
  test("appends the current card while collapsing repeated ancestry", () => {
    expect(appendCardStageAncestor([
      { cardId: "root" },
      { cardId: "child" },
    ], {
      cardId: "root",
    })).toEqual([
      { cardId: "root" },
    ]);
  });

  test("keeps the nearest bounded ancestor trail", () => {
    const ancestors = Array.from({ length: MAX_CARD_STAGE_ANCESTOR_DEPTH }, (_, index) => ({
      cardId: `card-${index}`,
    }));

    const result = appendCardStageAncestor(ancestors, {
      cardId: "current",
    });

    expect(result).toHaveLength(MAX_CARD_STAGE_ANCESTOR_DEPTH);
    expect(result[0]?.cardId).toBe("card-1");
    expect(result.at(-1)?.cardId).toBe("current");
  });
});
