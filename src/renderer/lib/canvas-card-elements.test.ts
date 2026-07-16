import { describe, expect, test } from "vitest";
import type { BoardSummary, DatabasePageSummary } from "./types";
import {
  collectPlacedPageIds,
  createPageElement,
  getPageIdFromElement,
  getPageTitleHintFromElement,
  haveSamePageIds,
  syncPlacedPageIds,
  updatePageElements,
} from "./canvas-card-elements";

function cardElement(pageId: string) {
  return {
    type: "rectangle",
    customData: {
      type: "nodex-card",
      pageId,
      columnId: "draft",
    },
  };
}

function sortedJson(ids: ReadonlySet<string>) {
  return JSON.stringify([...ids].sort());
}

describe("canvas-card-elements placed card helpers", () => {
  test("collectPlacedPageIds keeps only Nodex card elements", () => {
    const ids = collectPlacedPageIds([
      cardElement("card-1"),
      { type: "ellipse" },
      { type: "rectangle", customData: { type: "other", pageId: "foreign-card" } },
      cardElement("card-2"),
    ]);

    expect(sortedJson(ids)).toBe(JSON.stringify(["card-1", "card-2"]));
  });

  test("collectPlacedPageIds ignores invalid customData", () => {
    const ids = collectPlacedPageIds([
      null,
      undefined,
      { customData: { type: "nodex-card" } },
      { customData: { type: "nodex-card", pageId: 42 } },
      { customData: { type: "nodex-card", pageId: "" } },
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

    expect(getPageIdFromElement(element)).toBe("standalone-card");
    expect(getPageTitleHintFromElement(element)).toBe("Standalone");
  });

  test("haveSamePageIds compares set membership regardless of insertion order", () => {
    const left = new Set(["card-1", "card-2"]);
    const right = new Set(["card-2", "card-1"]);
    const different = new Set(["card-1", "card-3"]);

    expect(haveSamePageIds(left, right)).toBe(true);
    expect(haveSamePageIds(left, different)).toBe(false);
  });

  test("syncPlacedPageIds returns previous state when card IDs are unchanged", () => {
    const previous = new Set(["card-1", "card-2"]);

    const same = syncPlacedPageIds(previous, [
      cardElement("card-2"),
      { type: "rectangle" },
      cardElement("card-1"),
    ]);
    const changed = syncPlacedPageIds(previous, [cardElement("card-1")]);

    expect(same === previous).toBe(true);
    expect(changed === previous).toBe(false);
    expect(sortedJson(changed)).toBe(JSON.stringify(["card-1"]));
  });

  test("Card references do not persist Database column ownership", () => {
    const card = {
      id: "card-1",
      title: "One",
      priority: undefined,
    } as DatabasePageSummary;

    const element = createPageElement(card, { x: 1, y: 2 });

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
    const updated = updatePageElements(
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
              } as DatabasePageSummary,
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
    expect(getPageIdFromElement(updated?.[0])).toBe("card-1");
  });
});
