import { describe, expect, test } from "bun:test";
import { PanelGroupTree } from "./panel-group-tree";
import { makeProjectSessionPanelLayout, splitProjectSessionPanelLeaf } from "../../../shared/project-session-panel-layout";
import type { AppShellTabItem } from "./app-shell-tabs";
import type { ProjectSessionPanelLayout } from "@/lib/types";
import { render } from "@/test/dom";

function makeTab(id: string, title: string): AppShellTabItem {
  return {
    id,
    title,
    closable: true,
    reorderable: true,
    splittable: true,
    renderPanel: () => <div>{title} content</div>,
  };
}

describe("PanelGroupTree", () => {
  test("applies header start and end slots to the top-left and top-right tab headers", () => {
    const layout = splitProjectSessionPanelLeaf(makeProjectSessionPanelLayout(["one", "two"], "one"), {
      leafId: "main",
      side: "right",
      tabId: "two",
      newLeafId: "leaf:right",
      newBranchId: "branch:root",
    });

    const view = render(
      <PanelGroupTree
        sessionId="session-1"
        panelId="right"
        layout={layout}
        tabItemsByLeafId={{
          main: [makeTab("one", "One")],
          "leaf:right": [makeTab("two", "Two")],
        }}
        activeTabIdsByLeafId={{
          main: "one",
          "leaf:right": "two",
        }}
        renderEmptyLeaf={(leafId) => <div>Empty {leafId}</div>}
        renderAfterList={(leafId) => <span data-testid={`after-list:${leafId}`}>After {leafId}</span>}
        headerStartInsetPx={208}
        headerEndInsetPx={102}
        tabScrollEndPaddingPx={28}
        onSelectTab={() => undefined}
        onCloseTab={() => undefined}
        onReorderTab={() => undefined}
        onMoveTab={() => undefined}
        onSplitGroup={() => undefined}
        onActivateGroup={() => undefined}
        onResizeGroup={() => undefined}
      />,
    );

    const leftLeaf = view.container.querySelector('[data-app-shell-panel-id="right:main"]');
    const rightLeaf = view.container.querySelector('[data-app-shell-panel-id="right:leaf:right"]');
    const leftHeader = leftLeaf?.querySelector('[role="tablist"]')?.parentElement?.parentElement;
    const rightTabRow = rightLeaf?.querySelector('[role="tablist"]')?.parentElement;
    const startSpacer = leftLeaf?.querySelector('[style*="width: 208px"]');
    const endSpacer = rightLeaf?.querySelector('[style*="width: 102px"]');
    const afterList = rightLeaf?.querySelector('[data-testid="after-list:leaf:right"]');

    expect(view.container.querySelectorAll('[style*="width: 208px"]').length).toBe(1);
    expect(view.container.querySelectorAll('[style*="width: 102px"]').length).toBe(1);
    expect(leftHeader?.className.includes("draggable")).toBeFalse();
    expect(leftLeaf?.querySelectorAll('[style*="width: 208px"]').length ?? 0).toBe(1);
    expect(leftLeaf?.querySelectorAll('[style*="width: 102px"]').length ?? 0).toBe(0);
    expect(rightLeaf?.querySelectorAll('[style*="width: 208px"]').length ?? 0).toBe(0);
    expect(rightLeaf?.querySelectorAll('[style*="width: 102px"]').length ?? 0).toBe(1);
    expect(rightTabRow instanceof HTMLElement ? rightTabRow.style.scrollPaddingInlineEnd : "").toBe("28px");
    expect(leftLeaf?.querySelector('[data-testid="after-list:main"]') === null).toBeTrue();
    expect(rightLeaf?.querySelector('[data-testid="after-list:leaf:right"]') !== null).toBeTrue();
    expect(startSpacer?.className.includes("no-drag")).toBeTrue();
    expect(endSpacer?.className.includes("no-drag")).toBeTrue();
    expect(afterList?.parentElement?.className.includes("no-drag")).toBeTrue();
  });

  test("applies header start and after-list slots to empty top-left and top-right headers", () => {
    const layout: ProjectSessionPanelLayout = {
      version: 2,
      activeLeafId: "main",
      mruLeafIds: ["main"],
      maximizedLeafId: null,
      root: {
        type: "split",
        id: "branch:root",
        direction: "horizontal",
        ratio: 0.5,
        first: {
          type: "leaf",
          id: "main",
          tabIds: [] as string[],
          activeTabId: null,
        },
        second: {
          type: "leaf",
          id: "leaf:right",
          tabIds: [] as string[],
          activeTabId: null,
        },
      },
    };

    const view = render(
      <PanelGroupTree
        sessionId="session-1"
        panelId="right"
        layout={layout}
        tabItemsByLeafId={{
          main: [],
          "leaf:right": [],
        }}
        activeTabIdsByLeafId={{
          main: null,
          "leaf:right": null,
        }}
        renderEmptyLeaf={(leafId) => <div>Empty {leafId}</div>}
        renderAfterTabs={(leafId) => <span data-testid={`after-tabs:${leafId}`}>New {leafId}</span>}
        renderAfterList={(leafId) => <span data-testid={`after-list:${leafId}`}>After {leafId}</span>}
        headerStartInsetPx={208}
        onSelectTab={() => undefined}
        onCloseTab={() => undefined}
        onReorderTab={() => undefined}
        onMoveTab={() => undefined}
        onSplitGroup={() => undefined}
        onActivateGroup={() => undefined}
        onResizeGroup={() => undefined}
      />,
    );

    const leftLeaf = view.container.querySelector('[data-panel-group-leaf-id="main"]');
    const rightLeaf = view.container.querySelector('[data-panel-group-leaf-id="leaf:right"]');
    const leftHeader = leftLeaf?.querySelector('[data-panel-tab-row="right:main"]')?.parentElement;
    const startSpacer = leftLeaf?.querySelector('[style*="width: 208px"]');
    const afterTabs = leftLeaf?.querySelector('[data-testid="after-tabs:main"]');
    const afterList = rightLeaf?.querySelector('[data-testid="after-list:leaf:right"]');

    expect(view.container.querySelectorAll('[style*="width: 208px"]').length).toBe(1);
    expect(leftHeader?.className.includes("draggable")).toBeFalse();
    expect(leftLeaf?.querySelectorAll('[style*="width: 208px"]').length ?? 0).toBe(1);
    expect(rightLeaf?.querySelectorAll('[style*="width: 208px"]').length ?? 0).toBe(0);
    expect(leftLeaf?.querySelector('[data-testid="after-list:main"]') === null).toBeTrue();
    expect(rightLeaf?.querySelector('[data-testid="after-list:leaf:right"]') !== null).toBeTrue();
    expect(leftLeaf?.querySelector('[data-testid="after-tabs:main"]') !== null).toBeTrue();
    expect(rightLeaf?.querySelector('[data-testid="after-tabs:leaf:right"]') !== null).toBeTrue();
    expect(startSpacer?.className.includes("no-drag")).toBeTrue();
    expect(afterTabs?.parentElement?.className.includes("no-drag")).toBeTrue();
    expect(afterList?.parentElement?.className.includes("no-drag")).toBeTrue();
  });
});
