import { describe, expect, test } from "bun:test";
import { PanelGroupTree } from "./panel-group-tree";
import { makeProjectSessionPanelLayout, splitProjectSessionPanelLeaf } from "../../../shared/project-session-panel-layout";
import type { AppShellTabItem } from "./app-shell-tabs";
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
  test("applies the global header inset only to the top-right leaf", () => {
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
        headerEndInsetPx={102}
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

    expect(view.container.querySelectorAll('[style*="width: 102px"]').length).toBe(1);
    expect(leftLeaf?.querySelectorAll('[style*="width: 102px"]').length ?? 0).toBe(0);
    expect(rightLeaf?.querySelectorAll('[style*="width: 102px"]').length ?? 0).toBe(1);
  });
});
