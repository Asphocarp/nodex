import { describe, expect, test } from "bun:test";
import {
  collectPlacedCardIds,
  haveSameCardIds,
  syncPlacedCardIds,
} from "./canvas-card-elements";

function cardElement(cardId: string) {
  return {
    type: "rectangle",
    customData: {
      type: "nodex-card",
      cardId,
      columnId: "draft",
    },
  };
}

function sortedJson(ids: ReadonlySet<string>) {
  return JSON.stringify([...ids].sort());
}

describe("canvas-card-elements placed card helpers", () => {
  test("collectPlacedCardIds keeps only Nodex card elements", () => {
    const ids = collectPlacedCardIds([
      cardElement("card-1"),
      { type: "ellipse" },
      { type: "rectangle", customData: { type: "other", cardId: "foreign-card" } },
      cardElement("card-2"),
    ]);

    expect(sortedJson(ids)).toBe(JSON.stringify(["card-1", "card-2"]));
  });

  test("collectPlacedCardIds ignores invalid customData", () => {
    const ids = collectPlacedCardIds([
      null,
      undefined,
      { customData: { type: "nodex-card" } },
      { customData: { type: "nodex-card", cardId: 42 } },
      { customData: { type: "nodex-card", cardId: "" } },
      cardElement("card-1"),
    ]);

    expect(sortedJson(ids)).toBe(JSON.stringify(["card-1"]));
  });

  test("haveSameCardIds compares set membership regardless of insertion order", () => {
    const left = new Set(["card-1", "card-2"]);
    const right = new Set(["card-2", "card-1"]);
    const different = new Set(["card-1", "card-3"]);

    expect(haveSameCardIds(left, right)).toBeTrue();
    expect(haveSameCardIds(left, different)).toBeFalse();
  });

  test("syncPlacedCardIds returns previous state when card IDs are unchanged", () => {
    const previous = new Set(["card-1", "card-2"]);

    const same = syncPlacedCardIds(previous, [
      cardElement("card-2"),
      { type: "rectangle" },
      cardElement("card-1"),
    ]);
    const changed = syncPlacedCardIds(previous, [cardElement("card-1")]);

    expect(same === previous).toBeTrue();
    expect(changed === previous).toBeFalse();
    expect(sortedJson(changed)).toBe(JSON.stringify(["card-1"]));
  });
});
