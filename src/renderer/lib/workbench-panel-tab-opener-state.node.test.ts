import { describe, expect, test } from "vite-plus/test";
import {
  createWorkbenchPanelTabOpenerState,
  recordWorkbenchPanelTabActivated,
  recordWorkbenchPanelTabClosed,
  recordWorkbenchPanelTabMoved,
  recordWorkbenchPanelTabOpened,
  resolveWorkbenchPanelTabOpenerCloseReplacement,
} from "./workbench-panel-tab-opener-state";

function openTab(
  state: ReturnType<typeof createWorkbenchPanelTabOpenerState>,
  tabId: string,
  openerTabId: string,
  tabIds: readonly string[],
) {
  const opened = recordWorkbenchPanelTabOpened(state, {
    tabId,
    openerTabId,
    openedInBackground: false,
  });
  return recordWorkbenchPanelTabActivated(opened, tabId, tabIds);
}

describe("workbench panel tab opener state", () => {
  test("prefers the nearest right sibling, then the nearest left sibling, then the opener", () => {
    const firstChild = openTab(createWorkbenchPanelTabOpenerState(), "child-one", "root", [
      "root",
      "child-one",
    ]);
    const secondChild = openTab(firstChild, "child-two", "root", [
      "root",
      "child-two",
      "child-one",
    ]);

    expect(
      resolveWorkbenchPanelTabOpenerCloseReplacement(
        secondChild,
        ["root", "child-two", "child-one"],
        "child-two",
      ),
    ).toBe("child-one");
    expect(
      resolveWorkbenchPanelTabOpenerCloseReplacement(
        secondChild,
        ["root", "child-two", "child-one"],
        "child-one",
      ),
    ).toBe("child-two");
    expect(
      resolveWorkbenchPanelTabOpenerCloseReplacement(
        firstChild,
        ["root", "child-one"],
        "child-one",
      ),
    ).toBe("root");
  });

  test("treats nested descendants as one opener tree", () => {
    const child = openTab(createWorkbenchPanelTabOpenerState(), "child", "root", ["root", "child"]);
    const grandchild = openTab(child, "grandchild", "child", ["root", "child", "grandchild"]);

    expect(
      resolveWorkbenchPanelTabOpenerCloseReplacement(
        grandchild,
        ["root", "child", "grandchild"],
        "grandchild",
      ),
    ).toBe("child");
    expect(
      resolveWorkbenchPanelTabOpenerCloseReplacement(
        grandchild,
        ["root", "child", "grandchild"],
        "child",
      ),
    ).toBe("grandchild");
    expect(Object.keys(recordWorkbenchPanelTabClosed(grandchild, "child").tabsById)).toEqual([]);
  });

  test("invalidates affinity after selection leaves the opener tree", () => {
    const child = openTab(createWorkbenchPanelTabOpenerState(), "child", "root", [
      "root",
      "child",
      "unrelated",
    ]);
    const unrelated = recordWorkbenchPanelTabActivated(child, "unrelated", [
      "root",
      "child",
      "unrelated",
    ]);

    expect(unrelated.active).toBe(false);
    expect(unrelated.generation).toBe(child.generation + 1);
    expect(
      resolveWorkbenchPanelTabOpenerCloseReplacement(
        unrelated,
        ["root", "child", "unrelated"],
        "child",
      ),
    ).toBeNull();
  });

  test("ignores stale generations when a new opener tree starts", () => {
    const firstChild = openTab(createWorkbenchPanelTabOpenerState(), "old-child", "root", [
      "root",
      "old-child",
      "unrelated",
    ]);
    const invalidated = recordWorkbenchPanelTabActivated(firstChild, "unrelated", [
      "root",
      "old-child",
      "unrelated",
    ]);
    const currentChild = openTab(invalidated, "current-child", "root", [
      "root",
      "current-child",
      "old-child",
      "unrelated",
    ]);

    expect(
      resolveWorkbenchPanelTabOpenerCloseReplacement(
        currentChild,
        ["root", "current-child", "old-child", "unrelated"],
        "current-child",
      ),
    ).toBe("root");
  });

  test("keeps affinity while moving between ancestors, descendants, and siblings", () => {
    const child = openTab(createWorkbenchPanelTabOpenerState(), "child-one", "root", [
      "root",
      "child-one",
    ]);
    const sibling = openTab(child, "child-two", "root", ["root", "child-two", "child-one"]);
    const openerSelected = recordWorkbenchPanelTabActivated(sibling, "root", [
      "root",
      "child-two",
      "child-one",
    ]);
    const firstChildSelected = recordWorkbenchPanelTabActivated(openerSelected, "child-one", [
      "root",
      "child-two",
      "child-one",
    ]);

    expect(openerSelected.active).toBe(true);
    expect(firstChildSelected.active).toBe(true);
  });

  test("clears the whole relationship graph when a tracked tab or opener moves", () => {
    const child = openTab(createWorkbenchPanelTabOpenerState(), "child", "root", ["root", "child"]);

    expect(recordWorkbenchPanelTabMoved(child, "unrelated")).toBe(child);
    expect(recordWorkbenchPanelTabMoved(child, "child")).toMatchObject({
      active: false,
      lastSelectedTabId: null,
      tabsById: {},
    });
    expect(recordWorkbenchPanelTabMoved(child, "root")).toMatchObject({
      active: false,
      lastSelectedTabId: null,
      tabsById: {},
    });
  });

  test("background opens do not replace the last selected tab", () => {
    const initial = recordWorkbenchPanelTabActivated(createWorkbenchPanelTabOpenerState(), "root", [
      "root",
    ]);
    const background = recordWorkbenchPanelTabOpened(initial, {
      tabId: "child",
      openerTabId: "root",
      openedInBackground: true,
    });

    expect(background.active).toBe(true);
    expect(background.lastSelectedTabId).toBe("root");
  });
});
