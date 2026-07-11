import { describe, expect, test } from "bun:test";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
} from "./reference-surface-state";

describe("ReferenceSurfaceActivationBudget", () => {
  test("keeps only the most recently eligible referenced documents active", () => {
    const budget = new ReferenceSurfaceActivationBudget(2);
    budget.setEligible("card-a", true);
    budget.setEligible("card-b", true);
    budget.setEligible("card-c", true);

    expect(budget.isActive("card-a")).toBeFalse();
    expect(budget.isActive("card-b")).toBeTrue();
    expect(budget.isActive("card-c")).toBeTrue();

    budget.setEligible("card-c", false);
    expect(budget.isActive("card-a")).toBeTrue();
    expect(budget.isActive("card-b")).toBeTrue();

    budget.touch("card-a");
    budget.setEligible("card-c", true);
    expect(budget.isActive("card-a")).toBeTrue();
    expect(budget.isActive("card-b")).toBeFalse();
    expect(budget.isActive("card-c")).toBeTrue();
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

describe("ReferenceExpansionStore", () => {
  test("keeps expansion window-local and notifies only the affected row", () => {
    const store = new ReferenceExpansionStore();
    let firstNotifications = 0;
    let secondNotifications = 0;
    store.subscribe("first", () => {
      firstNotifications += 1;
    });
    store.subscribe("second", () => {
      secondNotifications += 1;
    });

    store.setExpanded("first", true);
    store.setExpanded("first", true);
    expect(store.isExpanded("first")).toBeTrue();
    expect(firstNotifications).toBe(1);
    expect(secondNotifications).toBe(0);

    store.clear();
    expect(store.isExpanded("first")).toBeFalse();
    expect(firstNotifications).toBe(2);
  });
});
