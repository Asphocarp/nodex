import { describe, expect, test } from "vitest";

import { WorkbenchSessionViewSnapshotSchema } from "./schemas/workbench-session-view";
import {
  activateWorkbenchSessionViewTab,
  cloneWorkbenchLayoutForNewWindow,
  createWorkbenchSessionViewTab,
  materializeInitialWorkbenchSessionView,
  moveWorkbenchSessionViewTab,
  normalizeWorkbenchSessionView,
  removeWorkbenchSessionViewTab,
  reorderWorkbenchSessionViewTabs,
  resizeWorkbenchSessionViewBranch,
  splitWorkbenchSessionViewLeaf,
  type WorkbenchSessionViewIdentityFactory,
  type WorkbenchSessionViewSnapshot,
  type WorkbenchSessionViewTab,
} from "./workbench-session-view";

function identityFactory(prefix: string): WorkbenchSessionViewIdentityFactory {
  let next = 0;
  return {
    createId(kind) {
      next += 1;
      return `${prefix}:${kind}:${next}`;
    },
  };
}

function pageTab(id: string, pageId: string): WorkbenchSessionViewTab {
  return {
    id,
    kind: "page_stage",
    titleSnapshot: `Page ${pageId}`,
    config: {
      projectId: "project-1",
      pageId,
    },
    stateKey: 0,
    state: null,
  };
}

function materializedView(): WorkbenchSessionViewSnapshot {
  return materializeInitialWorkbenchSessionView(
    {
      id: "session-1",
      projectId: "project-1",
      databaseViewId: "view-1",
    },
    {
      identityFactory: identityFactory("initial"),
      touchedAt: "2026-07-23T00:00:00.000Z",
    },
  );
}

describe("WorkbenchSessionView", () => {
  test("materializes one initial Database view as a local right-panel tab", () => {
    const view = materializedView();
    const tab = Object.values(view.tabsById)[0];

    expect(tab).toMatchObject({
      kind: "db_view",
      config: {
        projectId: "project-1",
        databaseViewId: "view-1",
      },
    });
    expect(view.panels.right.collapsed).toBe(false);
    expect(view.panels.right.size.fullWidth).toBe(true);
    expect(view.panels.bottom.collapsed).toBe(true);
  });

  test("normalization retains the first cross-panel occurrence and repairs unplaced tabs", () => {
    const base = createWorkbenchSessionViewTab(materializedView(), {
      panelId: "bottom",
      tab: pageTab("page-tab", "page-1"),
    });
    const duplicate = {
      ...base,
      panels: {
        ...base.panels,
        bottom: {
          ...base.panels.bottom,
          layout: {
            ...base.panels.bottom.layout,
            root: {
              type: "leaf" as const,
              id: "bottom-leaf",
              tabIds: ["page-tab", Object.keys(base.tabsById)[0]!],
              activeTabId: "page-tab",
              mruTabIds: ["page-tab"],
            },
            activeLeafId: "bottom-leaf",
            mruLeafIds: ["bottom-leaf"],
          },
        },
      },
      tabsById: {
        ...base.tabsById,
        unplaced: pageTab("unplaced", "page-2"),
      },
    };

    const normalized = normalizeWorkbenchSessionView(duplicate);
    const rightIds = JSON.stringify(normalized.panels.right.layout);
    const bottomIds = JSON.stringify(normalized.panels.bottom.layout);

    expect(rightIds).toContain(Object.keys(base.tabsById)[0]!);
    expect(bottomIds).not.toContain(Object.keys(base.tabsById)[0]!);
    expect(rightIds).toContain("unplaced");
  });

  test("supports local create, activate, reorder, split, move, resize, and remove", () => {
    const ids = identityFactory("mutation");
    let view = materializedView();
    const dbTabId = Object.keys(view.tabsById)[0]!;
    view = createWorkbenchSessionViewTab(view, {
      panelId: "right",
      tab: pageTab("page-1", "page-1"),
    });
    view = createWorkbenchSessionViewTab(view, {
      panelId: "right",
      tab: pageTab("page-2", "page-2"),
    });
    const rightLeafId = view.panels.right.layout.activeLeafId;
    view = reorderWorkbenchSessionViewTabs(view, {
      panelId: "right",
      leafId: rightLeafId,
      orderedTabIds: ["page-2", dbTabId, "page-1"],
    });
    view = activateWorkbenchSessionViewTab(view, "right", rightLeafId, "page-2");
    view = splitWorkbenchSessionViewLeaf(view, {
      panelId: "right",
      leafId: rightLeafId,
      side: "right",
      tabId: "page-2",
      identityFactory: ids,
    });
    const branch = view.panels.right.layout.root;
    expect(branch.type).toBe("split");
    if (branch.type !== "split") throw new Error("Expected split");
    view = resizeWorkbenchSessionViewBranch(view, {
      panelId: "right",
      branchId: branch.id,
      ratio: 0.7,
    });
    expect(view.panels.right.layout.root).toMatchObject({ ratio: 0.7 });
    view = moveWorkbenchSessionViewTab(view, {
      tabId: "page-1",
      targetPanelId: "bottom",
    });
    view = removeWorkbenchSessionViewTab(view, dbTabId);

    expect(JSON.stringify(view.panels.bottom.layout)).toContain("page-1");
    expect(view.tabsById[dbTabId]).toBeUndefined();
    expect(WorkbenchSessionViewSnapshotSchema.parse(view)).toEqual(view);
  });

  test("clones local identities while retaining resource targets and Terminal resources", () => {
    let source = materializedView();
    source = createWorkbenchSessionViewTab(source, {
      panelId: "right",
      tab: {
        id: "browser-tab",
        kind: "browser",
        titleSnapshot: "Example",
        config: {
          browserTabId: "browser-runtime",
          url: "https://example.com",
        },
        stateKey: 0,
        state: null,
      },
    });
    source = createWorkbenchSessionViewTab(source, {
      panelId: "bottom",
      tab: {
        id: "terminal-tab",
        kind: "terminal",
        titleSnapshot: "Shell",
        config: { terminalSessionId: "pty-1" },
        stateKey: 0,
        state: null,
      },
    });
    const clone = cloneWorkbenchLayoutForNewWindow(
      { sessionViewsBySessionId: { "session-1": source } },
      identityFactory("clone"),
    ).sessionViewsBySessionId["session-1"]!;
    const clonedTabs = Object.values(clone.tabsById);

    expect(Object.keys(clone.tabsById)).not.toEqual(Object.keys(source.tabsById));
    expect(clonedTabs.find((tab) => tab.kind === "db_view")?.config)
      .toMatchObject({ databaseViewId: "view-1" });
    expect(clonedTabs.find((tab) => tab.kind === "terminal")?.config)
      .toEqual({ terminalSessionId: "pty-1" });
    expect(clonedTabs.find((tab) => tab.kind === "browser")?.config)
      .toMatchObject({ url: "https://example.com" });
    expect(clonedTabs.find((tab) => tab.kind === "browser")?.config)
      .not.toMatchObject({ browserTabId: "browser-runtime" });
  });

  test("two windows over one shared Session diverge without changing the other", () => {
    const source = materializedView();
    const layout = { sessionViewsBySessionId: { "session-1": source } };
    const windowA = cloneWorkbenchLayoutForNewWindow(layout, identityFactory("a"));
    const windowB = cloneWorkbenchLayoutForNewWindow(layout, identityFactory("b"));
    const beforeB = JSON.stringify(windowB);
    const viewA = windowA.sessionViewsBySessionId["session-1"]!;
    const changedA = createWorkbenchSessionViewTab(viewA, {
      panelId: "bottom",
      tab: pageTab("a:page", "shared-page"),
    });

    expect(changedA.sessionId).toBe(windowB.sessionViewsBySessionId["session-1"]?.sessionId);
    expect(JSON.stringify(windowB)).toBe(beforeB);
    expect(Object.values(changedA.tabsById).some((tab) =>
      tab.kind === "page_stage" && tab.config.pageId === "shared-page"
    )).toBe(true);
  });

  test("rejects mismatched discriminated configs", () => {
    const view = materializedView();
    const tabId = Object.keys(view.tabsById)[0]!;
    expect(() => WorkbenchSessionViewSnapshotSchema.parse({
      ...view,
      tabsById: {
        [tabId]: {
          ...view.tabsById[tabId],
          kind: "terminal",
        },
      },
    })).toThrow();
  });
});
