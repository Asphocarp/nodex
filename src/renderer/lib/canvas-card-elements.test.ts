import { describe, expect, test } from "bun:test";
import type { BoardSummary, CardSummary } from "./types";
import {
  collectPlacedCardIds,
  createCardElement,
  getCardIdFromElement,
  getCardTitleHintFromElement,
  haveSameCardIds,
  syncPlacedCardIds,
  updateCardElements,
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

  test("reads a standalone Card title hint without Database placement metadata", () => {
    const element = {
      customData: {
        type: "nodex-card-reference",
        targetBlockId: "standalone-card",
        titleHint: "Standalone",
      },
      label: { text: "Stale label" },
    };

    expect(getCardIdFromElement(element)).toBe("standalone-card");
    expect(getCardTitleHintFromElement(element)).toBe("Standalone");
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

  test("Card references do not persist Database column ownership", () => {
    const card = {
      id: "card-1",
      title: "One",
      priority: undefined,
    } as CardSummary;

    const element = createCardElement(card, { x: 1, y: 2 });

    expect(JSON.stringify(element.customData)).toBe(
      JSON.stringify({
        type: "nodex-card-reference",
        targetBlockId: "card-1",
        titleHint: "One",
      }),
    );
  });

  test("metadata refresh delegates to a version-bumping Excalidraw update", () => {
    const element = {
      ...cardElement("card-1"),
      id: "element-card-1",
      version: 4,
      versionNonce: 9,
      backgroundColor: "#000000",
      label: { text: "Old title" },
    };
    let calls = 0;
    const updated = updateCardElements(
      [element],
      {
        columns: [
          {
            id: "draft",
            name: "Draft",
            cards: [
              {
                id: "card-1",
                title: "Fresh title",
                priority: "p1-high",
              } as CardSummary,
            ],
          },
        ],
      } as BoardSummary,
      (current, changes) => {
        calls += 1;
        return {
          ...current,
          ...changes,
          version: Number(current.version) + 1,
          versionNonce: 3,
        };
      },
    );

    expect(calls).toBe(1);
    expect(updated?.[0]?.version).toBe(5);
    expect(updated?.[0]?.versionNonce).toBe(3);
    expect(getCardIdFromElement(updated?.[0])).toBe("card-1");
  });
});
