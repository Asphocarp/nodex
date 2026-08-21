import { describe, expect, test } from "vite-plus/test";
import { ReferenceSurfaceActivationBudget } from "./reference-surface-state";

describe("ReferenceSurfaceActivationBudget", () => {
  test("keeps only the most recently eligible referenced documents active", () => {
    const budget = new ReferenceSurfaceActivationBudget(2);
    budget.setEligible("card-a", true);
    budget.setEligible("card-b", true);
    budget.setEligible("card-c", true);

    expect(budget.isActive("card-a")).toBe(false);
    expect(budget.isActive("card-b")).toBe(true);
    expect(budget.isActive("card-c")).toBe(true);

    budget.setEligible("card-c", false);
    expect(budget.isActive("card-a")).toBe(true);
    expect(budget.isActive("card-b")).toBe(true);

    budget.touch("card-a");
    budget.setEligible("card-c", true);
    expect(budget.isActive("card-a")).toBe(true);
    expect(budget.isActive("card-b")).toBe(false);
    expect(budget.isActive("card-c")).toBe(true);
  });

  test("rejects invalid provider limits", () => {
    expect(() => new ReferenceSurfaceActivationBudget(0)).toThrow(
      "Reference surface capacity must be a positive integer",
    );
  });

  test("keeps editing-priority surfaces ahead of visibility-only recency", () => {
    const budget = new ReferenceSurfaceActivationBudget(2);
    budget.setEligible("expanded-a", true);
    budget.setEligible("expanded-b", true);
    budget.setEligible("editing", true, 1);

    expect(budget.getActiveKeys()).toEqual(["editing", "expanded-b"]);

    budget.touch("expanded-a");
    expect(budget.getActiveKeys()).toEqual(["editing", "expanded-a"]);

    budget.setEligible("editing", true, 0);
    expect(budget.getActiveKeys()).toEqual(["expanded-a", "editing"]);
    expect(budget.getActiveKeys()).toHaveLength(2);
  });

  test("prefers actual viewport intersection and stable center distance", () => {
    const budget = new ReferenceSurfaceActivationBudget(2);
    budget.setEligible("prewarm", true, 0, {
      visibility: "prewarm",
      viewportCenterDistance: 10,
      documentOrder: 1,
    });
    budget.setEligible("visible-far", true, 0, {
      visibility: "visible",
      viewportCenterDistance: 300,
      documentOrder: 2,
    });
    budget.setEligible("visible-near", true, 0, {
      visibility: "visible",
      viewportCenterDistance: 20,
      documentOrder: 3,
    });

    expect(budget.getActiveKeys()).toEqual(["visible-near", "visible-far"]);
  });
});
