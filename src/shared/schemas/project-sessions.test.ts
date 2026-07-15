import { describe, expect, test } from "vitest";
import { MAX_CARD_STAGE_ANCESTOR_DEPTH } from "../card-stage-ancestors";
import { parseProjectSessionTabConfig } from "./project-sessions";

describe("project session card stage config", () => {
  test("preserves a bounded nested-card ancestor trail", () => {
    const ancestors = [
      { projectId: "alpha", cardId: "root", titleSnapshot: "Root" },
      { projectId: "alpha", cardId: "child", titleSnapshot: "Child" },
    ];

    expect(parseProjectSessionTabConfig("card_stage", {
      projectId: "alpha",
      cardId: "nested",
      titleSnapshot: "Nested",
      ancestors,
    })).toEqual({
      projectId: "alpha",
      cardId: "nested",
      titleSnapshot: "Nested",
      ancestors,
    });
  });

  test("rejects ancestor trails beyond the navigation depth limit", () => {
    const ancestors = Array.from({
      length: MAX_CARD_STAGE_ANCESTOR_DEPTH + 1,
    }, (_, index) => ({
      projectId: "alpha",
      cardId: `card-${index}`,
      titleSnapshot: `Card ${index}`,
    }));

    expect(() => parseProjectSessionTabConfig("card_stage", {
      projectId: "alpha",
      cardId: "nested",
      ancestors,
    })).toThrow();
  });
});
