import { describe, expect, test } from "bun:test";
import {
  resolveCommonSelectedTextTarget,
  resolveSelectedTextOverlayLayout,
  type SelectedTextRectLike,
} from "./local-conversation-selected-text-side-chat-overlay";

function rect(input: { left: number; top: number; width: number; height: number }): SelectedTextRectLike {
  return {
    left: input.left,
    top: input.top,
    right: input.left + input.width,
    bottom: input.top + input.height,
    width: input.width,
    height: input.height,
  };
}

describe("selected text side chat overlay helpers", () => {
  test("resolves a shared selected-text target", () => {
    const root = document.createElement("div");
    const target = document.createElement("p");
    target.dataset.threadSelectedTextTarget = "true";
    const first = document.createTextNode("Plan the ");
    const second = document.createTextNode("migration");
    target.append(first, second);
    root.append(target);

    const resolved = resolveCommonSelectedTextTarget({
      rootElement: root,
      anchorNode: first,
      focusNode: second,
    });

    expect(resolved === target).toBeTrue();
  });

  test("rejects selections that cross selected-text targets", () => {
    const root = document.createElement("div");
    const firstTarget = document.createElement("p");
    const secondTarget = document.createElement("p");
    firstTarget.dataset.threadSelectedTextTarget = "true";
    secondTarget.dataset.threadSelectedTextTarget = "true";
    const first = document.createTextNode("First");
    const second = document.createTextNode("Second");
    firstTarget.append(first);
    secondTarget.append(second);
    root.append(firstTarget, secondTarget);

    const resolved = resolveCommonSelectedTextTarget({
      rootElement: root,
      anchorNode: first,
      focusNode: second,
    });

    expect(resolved === null).toBeTrue();
  });

  test("does not place an overlay for empty selected text", () => {
    const layout = resolveSelectedTextOverlayLayout({
      selectedText: "   ",
      rangeRects: [rect({ left: 240, top: 200, width: 80, height: 18 })],
      rangeBoundingRect: rect({ left: 240, top: 200, width: 80, height: 18 }),
      portalRect: rect({ left: 100, top: 100, width: 400, height: 600 }),
      scrollRect: rect({ left: 100, top: 100, width: 400, height: 500 }),
      footerRect: null,
    });

    expect(layout === null).toBeTrue();
  });

  test("places the overlay above a visible selected range", () => {
    const layout = resolveSelectedTextOverlayLayout({
      selectedText: "selected range",
      rangeRects: [
        rect({ left: 240, top: 200, width: 80, height: 18 }),
        rect({ left: 180, top: 224, width: 160, height: 18 }),
      ],
      rangeBoundingRect: rect({ left: 180, top: 200, width: 160, height: 42 }),
      portalRect: rect({ left: 100, top: 100, width: 400, height: 600 }),
      scrollRect: rect({ left: 100, top: 100, width: 400, height: 500 }),
      footerRect: null,
    });

    expect(JSON.stringify(layout)).toBe(JSON.stringify({ leftPx: 180, topPx: 60 }));
  });

  test("places the overlay below when there is no room above", () => {
    const layout = resolveSelectedTextOverlayLayout({
      selectedText: "selected range",
      rangeRects: [rect({ left: 240, top: 110, width: 80, height: 18 })],
      rangeBoundingRect: rect({ left: 240, top: 110, width: 80, height: 18 }),
      portalRect: rect({ left: 100, top: 100, width: 400, height: 600 }),
      scrollRect: rect({ left: 100, top: 100, width: 400, height: 500 }),
      footerRect: null,
    });

    expect(JSON.stringify(layout)).toBe(JSON.stringify({ leftPx: 180, topPx: 36 }));
  });

  test("does not place the overlay when the selected range is hidden behind the footer", () => {
    const layout = resolveSelectedTextOverlayLayout({
      selectedText: "selected range",
      rangeRects: [rect({ left: 240, top: 190, width: 80, height: 18 })],
      rangeBoundingRect: rect({ left: 240, top: 190, width: 80, height: 18 }),
      portalRect: rect({ left: 100, top: 100, width: 400, height: 600 }),
      scrollRect: rect({ left: 100, top: 100, width: 400, height: 500 }),
      footerRect: rect({ left: 100, top: 170, width: 400, height: 80 }),
    });

    expect(layout === null).toBeTrue();
  });
});
