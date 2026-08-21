import { describe, expect, test } from "vitest";
import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationSelectionEvent,
} from "../../../shared/browser-annotation";
import {
  applyBrowserAnnotationAnchorUpdate,
  applyBrowserAnnotationSelection,
  createBrowserAnnotationDraftState,
  navigateBrowserAnnotationDraft,
  removeBrowserAnnotationAnchor,
  updateBrowserAnnotationDesignChange,
} from "./browser-annotation-state";

function elementAnchor(id: string, selector = "#target"): BrowserAnnotationAnchor {
  return {
    id,
    kind: "element",
    pageUrl: "https://example.test/page",
    selector,
    elementPath: "main > button",
    framePath: [],
    rect: { x: 10, y: 20, width: 30, height: 40 },
    computedStyle: {
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "16px",
      borderRadius: "4px",
      opacity: "1",
    },
  };
}

function select(
  anchor: BrowserAnnotationAnchor,
  multiSelect = false,
): BrowserAnnotationSelectionEvent {
  return { sessionId: "annotation-session", multiSelect, anchor };
}

describe("Browser annotation draft state", () => {
  test("toggles equivalent Shift selections instead of accumulating duplicate anchors", () => {
    const initial = createBrowserAnnotationDraftState("https://example.test/page");
    const selected = applyBrowserAnnotationSelection(initial, select(elementAnchor("one")));
    const added = applyBrowserAnnotationSelection(
      selected,
      select(elementAnchor("two", "#second"), true),
    );
    expect(added.anchors.map((anchor) => anchor.id)).toEqual(["one", "two"]);

    const removed = applyBrowserAnnotationSelection(
      added,
      select(elementAnchor("new-id", "#second"), true),
    );
    expect(removed.anchors.map((anchor) => anchor.id)).toEqual(["one"]);
  });

  test("updates live anchor geometry by stable id and ignores stale pages", () => {
    const selected = applyBrowserAnnotationSelection(
      createBrowserAnnotationDraftState("https://example.test/page"),
      select(elementAnchor("one")),
    );
    const updated = applyBrowserAnnotationAnchorUpdate(selected, {
      ...elementAnchor("one"),
      rect: { x: 40, y: 50, width: 60, height: 70 },
    });
    expect(updated.anchors[0]?.rect).toEqual({
      x: 40,
      y: 50,
      width: 60,
      height: 70,
    });
    expect(
      applyBrowserAnnotationAnchorUpdate(updated, {
        ...elementAnchor("one"),
        pageUrl: "https://other.test/",
      }),
    ).toBe(updated);
  });

  test("invalidates all anchors and design state on navigation", () => {
    const selected = applyBrowserAnnotationSelection(
      createBrowserAnnotationDraftState("https://example.test/page"),
      select(elementAnchor("one")),
    );
    const designed = updateBrowserAnnotationDesignChange(selected, {
      anchorId: "one",
      property: "fontSize",
      after: "20px",
    });
    const navigated = navigateBrowserAnnotationDraft(designed, "https://example.test/next");
    expect(navigated.anchors).toEqual([]);
    expect(navigated.designChange).toBeNull();
    expect(navigated.pageUrl).toBe("https://example.test/next");
  });

  test("records bounded before/after design values and clears them with the target", () => {
    const selected = applyBrowserAnnotationSelection(
      createBrowserAnnotationDraftState("https://example.test/page"),
      select(elementAnchor("one")),
    );
    const designed = updateBrowserAnnotationDesignChange(selected, {
      anchorId: "one",
      property: "borderRadius",
      after: "12px",
    });
    expect(designed.designChange).toEqual({
      anchorId: "one",
      property: "borderRadius",
      before: "4px",
      after: "12px",
    });
    expect(removeBrowserAnnotationAnchor(designed, "one").designChange).toBeNull();
  });
});
