import { describe, expect, test } from "bun:test";
import { applyThreadSearchDomMarks } from "./local-conversation-thread-search-dom-marks";

describe("applyThreadSearchDomMarks", () => {
  test("adds and removes search match classes on visible search units and turn rows", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-content-search-turn-key="turn_1">
        <div data-content-search-unit-key="turn_1:user:0"></div>
        <div data-content-search-unit-key="turn_1:assistant"></div>
      </div>
      <div data-content-search-turn-key="turn_2">
        <div data-content-search-unit-key="turn_2:user:0"></div>
      </div>
    `;

    applyThreadSearchDomMarks({
      root,
      matchedSearchUnitKeys: new Set(["turn_1:assistant"]),
      matchedTurnKeys: new Set(["turn_1"]),
      activeSearchUnitKey: "turn_1:assistant",
    });

    const matchedUnit = root.querySelector(
      '[data-content-search-unit-key="turn_1:assistant"]',
    ) as HTMLDivElement | null;
    const unmatchedUnit = root.querySelector(
      '[data-content-search-unit-key="turn_2:user:0"]',
    ) as HTMLDivElement | null;
    const matchedTurn = root.querySelector(
      '[data-content-search-turn-key="turn_1"]',
    ) as HTMLDivElement | null;

    expect(Boolean(matchedUnit?.className.includes("bg-token-foreground/4"))).toBeTrue();
    expect(Boolean(matchedUnit?.className.includes("bg-token-foreground/7"))).toBeTrue();
    expect(Boolean(matchedTurn?.className.includes("bg-token-foreground/3"))).toBeTrue();
    expect(Boolean(unmatchedUnit?.className.includes("bg-token-foreground/4"))).toBeFalse();

    applyThreadSearchDomMarks({
      root,
      matchedSearchUnitKeys: new Set(),
      matchedTurnKeys: new Set(),
      activeSearchUnitKey: null,
    });

    expect(Boolean(matchedUnit?.className.includes("bg-token-foreground/4"))).toBeFalse();
    expect(Boolean(matchedUnit?.className.includes("bg-token-foreground/7"))).toBeFalse();
    expect(Boolean(matchedTurn?.className.includes("bg-token-foreground/3"))).toBeFalse();
  });
});
