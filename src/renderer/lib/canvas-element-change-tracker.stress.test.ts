import { describe, expect, test } from "vite-plus/test";
import { createCanvasElementChangeTracker } from "./canvas-element-change-tracker";
import {
  canvasElement,
  representativeCanvasElements,
} from "./canvas-element-change-tracker.test-fixtures";

describe("createCanvasElementChangeTracker stress", () => {
  test("emits one candidate for one changed element in a 10,000 element scene", () => {
    const initial = representativeCanvasElements(10_000);
    const tracker = createCanvasElementChangeTracker(initial);
    const next = [...initial];
    next[7_777] = canvasElement("element-7777", 2, { x: 900 });

    const delta = tracker.observeLocal(next);

    expect(delta.elementCandidates).toHaveLength(1);
    expect(delta.elementCandidates[0]).toMatchObject({
      id: "element-7777",
      version: 2,
      x: 900,
    });
  });
});
