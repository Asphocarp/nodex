import { describe, expect, test } from "vitest";
import { MAX_CARD_STAGE_ANCESTOR_DEPTH } from "../card-stage-ancestors";
import { parseProjectSessionTabConfig } from "./project-sessions";

describe("project session card stage config", () => {
  test("persists only stable Card identities in a bounded ancestor trail", () => {
    const ancestors = [
      { cardId: "root" },
      { cardId: "child" },
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

  test("discards legacy ancestor title and Project snapshots", () => {
    expect(parseProjectSessionTabConfig("card_stage", {
      projectId: "alpha",
      cardId: "nested",
      ancestors: [{
        projectId: "stale-project",
        cardId: "root",
        titleSnapshot: "Stale title",
      }],
    })).toEqual({
      projectId: "alpha",
      cardId: "nested",
      ancestors: [{ cardId: "root" }],
    });
  });

  test("rejects ancestor trails beyond the navigation depth limit", () => {
    const ancestors = Array.from({
      length: MAX_CARD_STAGE_ANCESTOR_DEPTH + 1,
    }, (_, index) => ({
      cardId: `card-${index}`,
    }));

    expect(() => parseProjectSessionTabConfig("card_stage", {
      projectId: "alpha",
      cardId: "nested",
      ancestors,
    })).toThrow();
  });
});
