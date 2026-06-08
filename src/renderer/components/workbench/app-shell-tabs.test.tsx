import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type { ReactNode } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  AppShellTabs,
  resolveAppShellTabDrop,
  shouldShowAppShellTabSeparator,
  type AppShellTabItem,
} from "./app-shell-tabs";
import { render, settleAsyncRender, textContent } from "@/test/dom";

function makeTabs(): AppShellTabItem[] {
  return [
    {
      id: "one",
      title: "One",
      closable: true,
      reorderable: true,
      renderPanel: () => <div>Panel one</div>,
    },
    {
      id: "two",
      title: "Two",
      closable: true,
      reorderable: true,
      tooltip: (
        <div>
          <span>Project Alpha</span>
          <span>card-two</span>
        </div>
      ),
      renderPanel: () => <div>Panel two</div>,
    },
    {
      id: "history",
      title: "History",
      closable: false,
      reorderable: false,
      isLabel: true,
      renderPanel: () => <div>History panel</div>,
    },
  ];
}

function renderAppShellTabs(props: {
  tabs?: AppShellTabItem[];
  activeTabId?: string;
  onSelect?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onReorderTab?: (activeId: string, overId: string) => void;
  beforeList?: ReactNode;
  afterListSticky?: ReactNode;
  afterList?: ReactNode;
}) {
  return render(
    <NodexTooltipProvider>
      <AppShellTabs
        tabs={props.tabs ?? makeTabs()}
        activeTabId={props.activeTabId ?? "one"}
        onSelect={props.onSelect ?? (() => undefined)}
        onCloseTab={props.onCloseTab}
        onReorderTab={props.onReorderTab}
        beforeList={props.beforeList}
        afterListSticky={props.afterListSticky}
        afterList={props.afterList}
      />
    </NodexTooltipProvider>,
  );
}

describe("AppShellTabs", () => {
  test("reveals tab title tooltips on hover", async () => {
    const view = renderAppShellTabs({});

    expect(view.container.ownerDocument.body.querySelector('[role="tooltip"]') === null).toBeTrue();

    fireEvent.pointerMove(view.getByText("Two"));
    fireEvent.mouseEnter(view.getByText("Two"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const tooltip = view.container.ownerDocument.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent?.includes("Project Alpha")).toBeTrue();
    expect(tooltip?.textContent?.includes("card-two")).toBeTrue();
  });

  test("renders one tablist, one selected tab, and one tabpanel", () => {
    const view = renderAppShellTabs({ activeTabId: "two" });

    expect(view.container.querySelectorAll('[role="tablist"]').length).toBe(1);
    expect(view.container.querySelectorAll('[role="tab"][aria-selected="true"]').length).toBe(1);
    expect(view.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Two");
    expect(textContent(view.getByRole("tabpanel"))).toBe("Panel two");
  });

  test("renders tab header slots in before, sticky, after order", () => {
    const view = renderAppShellTabs({
      beforeList: <span data-testid="before-list">Before</span>,
      afterListSticky: <span data-testid="after-list-sticky">Sticky</span>,
      afterList: <span data-testid="after-list">After</span>,
    });
    const header = view.getByRole("tablist").parentElement?.parentElement;
    if (!header) throw new Error("Expected tab header");

    const text = textContent(header);
    expect(text.indexOf("Before") < text.indexOf("One")).toBeTrue();
    expect(text.indexOf("Sticky") > text.indexOf("History")).toBeTrue();
    expect(text.indexOf("Sticky") < text.indexOf("After")).toBeTrue();
    expect(view.getByTestId("after-list-sticky").parentElement?.className.includes("gap-1.5")).toBeTrue();
    expect(view.getByTestId("after-list").parentElement?.className.includes("gap-1.5")).toBeTrue();
  });

  test("does not render the title fade when the tab title fits", () => {
    const view = renderAppShellTabs({ activeTabId: "two" });

    expect(view.container.querySelector('[data-app-shell-tab-title-fade="two"]') === null).toBeTrue();
  });

  test("renders the title fade only when the tab title overflows", async () => {
    const view = renderAppShellTabs({ activeTabId: "two" });
    const title = view.container.querySelector('[data-app-shell-tab-title="two"]');
    if (!(title instanceof HTMLElement)) throw new Error("Expected title element");

    Object.defineProperty(title, "clientWidth", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(title, "scrollWidth", {
      configurable: true,
      value: 180,
    });

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(view.container.querySelector('[data-app-shell-tab-title-fade="two"]') === null).toBeFalse();
  });

  test("close button uses Codex hover classes and suppresses selection on mouse down", () => {
    const selected: string[] = [];
    const closed: string[] = [];
    const view = renderAppShellTabs({
      activeTabId: "one",
      onSelect: (tabId) => selected.push(tabId),
      onCloseTab: (tabId) => closed.push(tabId),
    });

    const closeButton = view.getByLabelText("Close Two tab");
    const closeIcon = closeButton.querySelector("svg");
    expect(closeButton.className.includes("hidden")).toBeTrue();
    expect(closeButton.className.includes("group-hover/tab:flex")).toBeTrue();
    expect(closeIcon?.getAttribute("viewBox")).toBe("0 0 21 21");
    expect(closeIcon?.querySelector("path")?.getAttribute("d")?.startsWith("M10.7997 2.48486")).toBeTrue();

    fireEvent.mouseDown(closeButton, { button: 0 });
    fireEvent.click(closeButton);

    expect(closed.join(",")).toBe("two");
    expect(selected.length).toBe(0);
  });

  test("middle-click closes a closable tab", () => {
    const closed: string[] = [];
    const view = renderAppShellTabs({
      activeTabId: "one",
      onCloseTab: (tabId) => closed.push(tabId),
    });

    const tabChrome = view.container.querySelector('[data-app-shell-tab-controller][data-tab-id="two"] [data-tab-id="two"]');
    if (!tabChrome) throw new Error("Expected tab chrome");
    fireEvent.mouseDown(tabChrome, { button: 1 });

    expect(closed.join(",")).toBe("two");
  });

  test("selects tabs on primary mouse down", () => {
    const selected: string[] = [];
    const view = renderAppShellTabs({
      activeTabId: "one",
      onSelect: (tabId) => selected.push(tabId),
    });

    fireEvent.mouseDown(view.getByRole("tab", { name: "Two" }), { button: 0 });

    expect(selected.join(",")).toBe("two");
  });

  test("context menu close is available only for closable tabs", async () => {
    const closed: string[] = [];
    const view = renderAppShellTabs({
      activeTabId: "one",
      onCloseTab: (tabId) => closed.push(tabId),
    });

    const closableChrome = view.container.querySelector('[data-app-shell-tab-controller][data-tab-id="two"]');
    if (!closableChrome) throw new Error("Expected closable tab chrome");
    fireEvent.contextMenu(closableChrome);
    await settleAsyncRender();
    fireEvent.click(view.getByText("Close tab"));

    expect(closed.join(",")).toBe("two");
    expect(view.queryByLabelText("Close History tab")).toBe(null);
  });

  test("places sortable attributes on chrome and wrapper data on the sortable node", () => {
    const view = renderAppShellTabs({ activeTabId: "one" });

    const wrapper = view.container.querySelector('[data-app-shell-tab-controller][data-tab-id="two"]');
    const chrome = wrapper?.querySelector(':scope > [data-tab-id="two"]');

    expect(wrapper?.className.includes("max-w-40")).toBeTrue();
    expect(chrome?.className.includes("max-w-39")).toBeTrue();
    expect(chrome?.getAttribute("aria-roledescription")).toBe("sortable");
    expect(wrapper?.getAttribute("aria-roledescription")).toBe(null);
  });

  test("resolveAppShellTabDrop validates ids without rejecting label drop targets", () => {
    const tabs = makeTabs();

    const next = resolveAppShellTabDrop(tabs, "one", "history");
    expect(next?.activeId).toBe("one");
    expect(next?.overId).toBe("history");

    expect(resolveAppShellTabDrop(tabs, "one", "one")).toBe(null);
    expect(resolveAppShellTabDrop(tabs, "history", "one")).toBe(null);
    expect(resolveAppShellTabDrop(tabs, "missing", "one")).toBe(null);
  });

  test("shows separators for projected drag positions", () => {
    expect(shouldShowAppShellTabSeparator({
      projectedIndex: 0,
      projectedLength: 3,
      activeProjectedIndex: 2,
      dragProjectedIndex: 2,
      isActive: false,
      isDragging: false,
    })).toBeTrue();
    expect(shouldShowAppShellTabSeparator({
      projectedIndex: 1,
      projectedLength: 3,
      activeProjectedIndex: 2,
      dragProjectedIndex: 2,
      isActive: false,
      isDragging: false,
    })).toBeFalse();
  });
});
