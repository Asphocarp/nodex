import { describe, expect, test } from "vitest";
import { resolvePanelTabCloseReplacement } from "./panel-tab-close-routing";

const tabs = [
  { id: "one" },
  { id: "two" },
  { id: "three" },
  { id: "four" },
];

describe("resolvePanelTabCloseReplacement", () => {
  test("active close prefers the most recently active tab in the same leaf", () => {
    const next = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "three",
      closingTabId: "three",
      mruTabIds: ["three", "one", "two"],
    });

    expect(next).toBe("one");
  });

  test("direct-style close uses the same MRU order", () => {
    const next = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "two",
      closingTabId: "two",
      mruTabIds: ["two", "one"],
    });

    expect(next).toBe("one");
  });

  test("inactive close keeps the current active tab", () => {
    const next = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "four",
      closingTabId: "two",
      mruTabIds: ["two", "one"],
    });

    expect(next).toBe("four");
  });

  test("missing MRU falls back to the right neighbor then the left neighbor", () => {
    const rightNeighbor = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "two",
      closingTabId: "two",
      mruTabIds: ["missing"],
    });
    const leftNeighbor = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "four",
      closingTabId: "four",
      mruTabIds: ["missing"],
    });

    expect(rightNeighbor).toBe("three");
    expect(leftNeighbor).toBe("three");
  });

  test("skips labels and disabled tabs as replacements", () => {
    const next = resolvePanelTabCloseReplacement({
      tabs: [
        { id: "one" },
        { id: "two" },
        { id: "label", isLabel: true },
        { id: "disabled", disabled: true },
        { id: "three" },
      ],
      activeTabId: "two",
      closingTabId: "two",
      mruTabIds: ["label", "disabled", "one"],
    });

    expect(next).toBe("one");
  });

  test("returns null when no selectable replacement remains", () => {
    expect(resolvePanelTabCloseReplacement({
      tabs: [{ id: "one" }],
      activeTabId: "one",
      closingTabId: "one",
      mruTabIds: ["one"],
    })).toBeNull();
    expect(resolvePanelTabCloseReplacement({
      tabs: [
        { id: "one" },
        { id: "label", isLabel: true },
        { id: "disabled", disabled: true },
      ],
      activeTabId: "one",
      closingTabId: "one",
      mruTabIds: ["label", "disabled"],
    })).toBeNull();
  });

  test("ignores duplicate, missing, and closing MRU entries", () => {
    expect(resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "two",
      closingTabId: "two",
      mruTabIds: ["two", "missing", "two", "four", "four"],
    })).toBe("four");
  });

  test("keeps the active tab when the closing identity is absent", () => {
    expect(resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "three",
      closingTabId: "missing",
      mruTabIds: ["one"],
    })).toBe("three");
  });
});
