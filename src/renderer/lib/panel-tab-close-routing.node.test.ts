import { describe, expect, test } from "vite-plus/test";
import {
  createWorkbenchPanelTabOpenerState,
  recordWorkbenchPanelTabActivated,
  recordWorkbenchPanelTabOpened,
} from "./workbench-panel-tab-opener-state";
import { resolvePanelTabCloseReplacement } from "./panel-tab-close-routing";

const tabs = [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }];

describe("resolvePanelTabCloseReplacement", () => {
  test("active close selects the physical right neighbor instead of visit history", () => {
    const next = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "three",
      closingTabId: "three",
    });

    expect(next).toBe("four");
  });

  test("direct-style close uses the same physical order", () => {
    const next = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "two",
      closingTabId: "two",
    });

    expect(next).toBe("three");
  });

  test("active close prefers a current opener relationship over physical order", () => {
    const opened = recordWorkbenchPanelTabOpened(createWorkbenchPanelTabOpenerState(), {
      tabId: "three",
      openerTabId: "one",
      openedInBackground: false,
    });
    const openerState = recordWorkbenchPanelTabActivated(
      opened,
      "three",
      tabs.map((tab) => tab.id),
    );

    expect(
      resolvePanelTabCloseReplacement({
        tabs,
        activeTabId: "three",
        closingTabId: "three",
        openerState,
      }),
    ).toBe("one");
  });

  test("inactive close preserves selection even when the closing tab has an opener", () => {
    const openerState = recordWorkbenchPanelTabOpened(createWorkbenchPanelTabOpenerState(), {
      tabId: "three",
      openerTabId: "one",
      openedInBackground: true,
    });

    expect(
      resolvePanelTabCloseReplacement({
        tabs,
        activeTabId: "one",
        closingTabId: "three",
        openerState,
      }),
    ).toBe("one");
  });

  test("inactive close keeps the current active tab", () => {
    const next = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "four",
      closingTabId: "two",
    });

    expect(next).toBe("four");
  });

  test("falls back from the right neighbor to the left neighbor at the row edge", () => {
    const rightNeighbor = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "two",
      closingTabId: "two",
    });
    const leftNeighbor = resolvePanelTabCloseReplacement({
      tabs,
      activeTabId: "four",
      closingTabId: "four",
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
    });

    expect(next).toBe("three");
  });

  test("returns null when no selectable replacement remains", () => {
    expect(
      resolvePanelTabCloseReplacement({
        tabs: [{ id: "one" }],
        activeTabId: "one",
        closingTabId: "one",
      }),
    ).toBeNull();
    expect(
      resolvePanelTabCloseReplacement({
        tabs: [{ id: "one" }, { id: "label", isLabel: true }, { id: "disabled", disabled: true }],
        activeTabId: "one",
        closingTabId: "one",
      }),
    ).toBeNull();
  });

  test("keeps the active tab when the closing identity is absent", () => {
    expect(
      resolvePanelTabCloseReplacement({
        tabs,
        activeTabId: "three",
        closingTabId: "missing",
      }),
    ).toBe("three");
  });
});
