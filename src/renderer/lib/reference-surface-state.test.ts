import { describe, expect, test } from "vitest";
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
    let message = "";
    try {
      new ReferenceSurfaceActivationBudget(0);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Reference surface capacity must be a positive integer");
  });
});
