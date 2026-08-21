import { describe, expect, test } from "vite-plus/test";
import { createGeneratedImageViewTransitionPlan } from "./generated-image-view-transition";

const before = { height: 300, left: 240, top: 180, width: 400 };
const after = { height: 150, left: 40, top: 60, width: 200 };

describe("generated image view transition", () => {
  test("keeps scale independent from Canvas zoom", () => {
    const at100 = createGeneratedImageViewTransitionPlan({
      after,
      before,
      canvasZoomPercent: 100,
      enteringCanvas: true,
      windowZoom: 1,
    });
    const at150 = createGeneratedImageViewTransitionPlan({
      after,
      before,
      canvasZoomPercent: 150,
      enteringCanvas: true,
      windowZoom: 1,
    });

    expect(at100.keyframes[0]?.transform).toBe("translate(200px, 120px) scale(2, 2)");
    expect(at150.keyframes[0]?.transform).toBe("translate(133.3333px, 80px) scale(2, 2)");
  });

  test("removes Electron root zoom from both physical rect deltas", () => {
    const plan = createGeneratedImageViewTransitionPlan({
      after,
      before,
      canvasZoomPercent: 100,
      enteringCanvas: false,
      windowZoom: 2,
    });

    expect(plan.keyframes[0]?.transform).toBe("translate(100px, 60px) scale(2, 2)");
    expect(plan.options).toEqual({
      duration: 450,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both",
    });
  });
});
