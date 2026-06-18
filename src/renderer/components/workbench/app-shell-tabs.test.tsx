import { describe, expect, test } from "bun:test";
import { fireEvent, within } from "@testing-library/react";
import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { NodexTooltipProvider } from "@/components/ui/tooltip";
import {
  AppShellTabs,
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
  onMoveTab?: ComponentProps<typeof AppShellTabs>["onMoveTab"];
  onSplitTab?: ComponentProps<typeof AppShellTabs>["onSplitTab"];
  panelTabDnd?: ComponentProps<typeof AppShellTabs>["panelTabDnd"];
  beforeList?: ReactNode;
  afterTabsInline?: ReactNode;
  afterListSticky?: ReactNode;
  afterList?: ReactNode;
  bodyOverlay?: ReactNode;
  tabScrollEndPaddingPx?: number;
  headerEndInsetPx?: number;
}) {
  return render(
    <NodexTooltipProvider>
      <AppShellTabs
        tabs={props.tabs ?? makeTabs()}
        activeTabId={props.activeTabId ?? "one"}
        onSelect={props.onSelect ?? (() => undefined)}
        onCloseTab={props.onCloseTab}
        onMoveTab={props.onMoveTab}
        onSplitTab={props.onSplitTab}
        panelTabDnd={props.panelTabDnd}
        beforeList={props.beforeList}
        afterTabsInline={props.afterTabsInline}
        afterListSticky={props.afterListSticky}
        afterList={props.afterList}
        bodyOverlay={props.bodyOverlay}
        tabScrollEndPaddingPx={props.tabScrollEndPaddingPx}
        headerEndInsetPx={props.headerEndInsetPx}
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

  test("renders body overlays inside the tabpanel instead of the tab header", () => {
    const view = renderAppShellTabs({
      bodyOverlay: <div data-testid="body-overlay">Drop zones</div>,
      headerEndInsetPx: 48,
    });

    const header = view.getByRole("tablist").parentElement?.parentElement;
    const tabpanel = view.getByRole("tabpanel");
    const headerInsetSpacer = header?.lastElementChild;

    expect(tabpanel.contains(view.getByTestId("body-overlay"))).toBeTrue();
    expect(header?.contains(view.getByTestId("body-overlay"))).toBeFalse();
    expect(header?.className.includes("draggable")).toBeFalse();
    expect(headerInsetSpacer?.className.includes("no-drag")).toBeTrue();
    expect(headerInsetSpacer?.getAttribute("style")?.includes("width: 48px")).toBeTrue();
  });

  test("renders tab header slots in before, sticky, after order", () => {
    const view = renderAppShellTabs({
      beforeList: <span data-testid="before-list">Before</span>,
      afterTabsInline: <span data-testid="after-tabs-inline">Inline</span>,
      afterListSticky: <span data-testid="after-list-sticky">Sticky</span>,
      afterList: <span data-testid="after-list">After</span>,
      tabScrollEndPaddingPx: 28,
    });
    const header = view.getByRole("tablist").parentElement?.parentElement;
    if (!header) throw new Error("Expected tab header");
    const tabRow = view.getByRole("tablist").parentElement;
    if (!(tabRow instanceof HTMLElement)) throw new Error("Expected tab row");

    const text = textContent(header);
    expect(header.className.includes("draggable")).toBeFalse();
    expect(text.indexOf("Before") < text.indexOf("One")).toBeTrue();
    expect(text.indexOf("Inline") > text.indexOf("History")).toBeTrue();
    expect(text.indexOf("Inline") < text.indexOf("Sticky")).toBeTrue();
    expect(text.indexOf("Sticky") > text.indexOf("History")).toBeTrue();
    expect(text.indexOf("Sticky") < text.indexOf("After")).toBeTrue();
    expect(tabRow.style.scrollPaddingInlineEnd).toBe("28px");
    expect(view.getByTestId("before-list").parentElement?.getAttribute("role")).toBe("presentation");
    expect(view.getByTestId("before-list").parentElement?.className.includes("no-drag")).toBeTrue();
    expect(view.getByTestId("after-tabs-inline").parentElement?.className.includes("sticky")).toBeTrue();
    expect(view.getByTestId("after-tabs-inline").parentElement?.className.includes("no-drag")).toBeTrue();
    expect(view.getByTestId("after-tabs-inline").parentElement?.className.includes("right-0")).toBeTrue();
    expect(view.getByTestId("after-list-sticky").parentElement?.getAttribute("role")).toBe("presentation");
    expect(view.getByTestId("after-list-sticky").parentElement?.className.includes("no-drag")).toBeTrue();
    expect(view.getByTestId("after-list").parentElement?.getAttribute("role")).toBe("presentation");
    expect(view.getByTestId("after-list").parentElement?.className.includes("no-drag")).toBeTrue();
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

  test("close button suppresses selection on mouse down", () => {
    const selected: string[] = [];
    const closed: string[] = [];
    const view = renderAppShellTabs({
      activeTabId: "one",
      onSelect: (tabId) => selected.push(tabId),
      onCloseTab: (tabId) => closed.push(tabId),
    });

    const closeButton = view.getByLabelText("Close Two tab");
    const closeIcon = closeButton.querySelector("svg");
    expect(closeButton.tagName).toBe("BUTTON");
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

  test("scrolls the tab row horizontally from wheel input", async () => {
    const view = renderAppShellTabs({});
    await settleAsyncRender();
    const tabRow = getTabRowElement(view.getByRole("tablist"));
    makeScrollable(tabRow, { clientWidth: 200, scrollWidth: 600 });

    const verticalWheel = dispatchWheel(tabRow, { deltaY: 120 });
    expect(tabRow.scrollLeft).toBe(120);
    expect(verticalWheel.defaultPrevented).toBeTrue();

    const horizontalWheel = dispatchWheel(tabRow, { deltaX: -40 });
    expect(tabRow.scrollLeft).toBe(80);
    expect(horizontalWheel.defaultPrevented).toBeTrue();

    const lineWheel = dispatchWheel(tabRow, { deltaY: 2, deltaMode: 1 });
    expect(tabRow.scrollLeft).toBe(112);
    expect(lineWheel.defaultPrevented).toBeTrue();

    tabRow.scrollLeft = 0;
    const edgeWheel = dispatchWheel(tabRow, { deltaY: -20 });
    expect(tabRow.scrollLeft).toBe(0);
    expect(edgeWheel.defaultPrevented).toBeFalse();
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
    fireEvent.click(view.getByText("Close"));

    expect(closed.join(",")).toBe("two");
    expect(view.queryByLabelText("Close History tab")).toBe(null);
  });

  test("context menu appends Codex close actions after feature actions", async () => {
    const tabs = makeTabs();
    tabs[1] = {
      ...tabs[1],
      splittable: true,
      contextMenuItems: [
        {
          id: "browser-new-tab-right",
          label: "New tab to the right",
          onSelect: () => undefined,
        },
        {
          id: "browser-reload",
          label: "Reload",
          onSelect: () => undefined,
        },
        {
          id: "browser-duplicate",
          label: "Duplicate",
          onSelect: () => undefined,
        },
      ],
    };
    const closed: string[] = [];
    const view = renderAppShellTabs({
      tabs,
      activeTabId: "two",
      onCloseTab: (tabId) => closed.push(tabId),
      onMoveTab: () => undefined,
      onSplitTab: () => undefined,
    });

    const tabChrome = view.container.querySelector('[data-app-shell-tab-controller][data-tab-id="two"]');
    if (!tabChrome) throw new Error("Expected tab chrome");
    fireEvent.contextMenu(tabChrome);
    await settleAsyncRender();

    const menu = view.getByRole("menu");
    const menuText = textContent(menu);
    expect(menuText.indexOf("New tab to the right") < menuText.indexOf("Close")).toBeTrue();
    expect(menuText.indexOf("Reload") < menuText.indexOf("Close")).toBeTrue();
    expect(menuText.indexOf("Duplicate") < menuText.indexOf("Close")).toBeTrue();
    expect(within(menu).getByText("Close other tabs") !== null).toBeTrue();
    expect(within(menu).getByText("Close tabs to the right") !== null).toBeTrue();
    expect(within(menu).getByText("Move to bottom panel") !== null).toBeTrue();
    expect(within(menu).getByText("Split tab right") !== null).toBeTrue();

    const closeTabsToRightItem = within(menu).getByText("Close tabs to the right").closest('[role="menuitem"]');
    expect(closeTabsToRightItem?.getAttribute("data-disabled")).toBe("");

    fireEvent.click(within(menu).getByText("Close other tabs"));
    expect(closed.join(",")).toBe("one");
  });

  test("context menu disables close-tabs-to-right when only non-closable tabs follow", async () => {
    const view = renderAppShellTabs({
      activeTabId: "two",
      onCloseTab: () => undefined,
    });

    const tabChrome = view.container.querySelector('[data-app-shell-tab-controller][data-tab-id="two"]');
    if (!tabChrome) throw new Error("Expected tab chrome");
    fireEvent.contextMenu(tabChrome);
    await settleAsyncRender();

    const closeTabsToRightItem = view.getByText("Close tabs to the right").closest('[role="menuitem"]');
    expect(closeTabsToRightItem?.getAttribute("data-disabled")).toBe("");
  });

  test("context menu closes closable tabs to the right only", async () => {
    const closed: string[] = [];
    const tabs: AppShellTabItem[] = [
      ...makeTabs(),
      {
        id: "three",
        title: "Three",
        closable: true,
        renderPanel: () => <div>Panel three</div>,
      },
    ];
    const view = renderAppShellTabs({
      tabs,
      activeTabId: "one",
      onCloseTab: (tabId) => closed.push(tabId),
    });

    const tabChrome = view.container.querySelector('[data-app-shell-tab-controller][data-tab-id="one"]');
    if (!tabChrome) throw new Error("Expected tab chrome");
    fireEvent.contextMenu(tabChrome);
    await settleAsyncRender();
    fireEvent.click(view.getByText("Close tabs to the right"));

    expect(closed.join(",")).toBe("two,three");
  });

  test("places tab ids on the wrapper and leaves native DnD opt-in", () => {
    const view = renderAppShellTabs({ activeTabId: "one" });

    const wrapper = view.container.querySelector('[data-app-shell-tab-controller][data-tab-id="two"]');
    expect(wrapper?.className.includes("no-drag")).toBeTrue();
    expect(wrapper?.getAttribute("data-panel-tab-id")).toBe("two");
    expect(wrapper?.getAttribute("aria-roledescription")).toBe(null);
  });

  test("renders a panel tab insertion marker from the preview intent", () => {
    const view = renderAppShellTabs({
      panelTabDnd: {
        sessionId: "session-1",
        panelId: "right",
        leafId: "leaf-a",
        activeDragId: "one",
        previewIntent: {
          kind: "tab-row",
          panelId: "right",
          leafId: "leaf-a",
          targetIndex: 2,
          markerLeft: 48,
        },
      },
    });

    const marker = view.container.querySelector('[data-panel-tab-insertion-marker="right:leaf-a:2"]');
    expect(marker instanceof HTMLElement).toBeTrue();
    expect((marker as HTMLElement).style.left).toBe("48px");
  });

  test("does not render a panel tab insertion marker for another leaf", () => {
    const view = renderAppShellTabs({
      panelTabDnd: {
        sessionId: "session-1",
        panelId: "right",
        leafId: "leaf-a",
        activeDragId: "one",
        previewIntent: {
          kind: "tab-row",
          panelId: "right",
          leafId: "leaf-b",
          targetIndex: 0,
          markerLeft: 4,
        },
      },
    });

    expect(view.container.querySelector("[data-panel-tab-insertion-marker]") === null).toBeTrue();
  });

  test("shows separators for projected drag positions", () => {
    expect(shouldShowAppShellTabSeparator({
      index: 0,
      tabCount: 3,
      activeIndex: 2,
      draggingIndex: 2,
      isActive: false,
      isDragging: false,
    })).toBeTrue();
    expect(shouldShowAppShellTabSeparator({
      index: 1,
      tabCount: 3,
      activeIndex: 2,
      draggingIndex: 2,
      isActive: false,
      isDragging: false,
    })).toBeFalse();
  });
});

function getTabRowElement(tablist: HTMLElement): HTMLElement {
  const tabRow = tablist.parentElement;
  if (!(tabRow instanceof HTMLElement)) throw new Error("Expected tab row element");
  return tabRow;
}

function makeScrollable(
  element: HTMLElement,
  {
    clientWidth,
    scrollWidth,
  }: {
    clientWidth: number;
    scrollWidth: number;
  },
) {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: clientWidth,
  });
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    value: scrollWidth,
  });
  element.scrollLeft = 0;
}

function dispatchWheel(
  target: HTMLElement,
  {
    deltaX = 0,
    deltaY = 0,
    deltaMode = 0,
    ctrlKey = false,
    metaKey = false,
  }: {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
): Event {
  const event = new Event("wheel", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    ctrlKey: { value: ctrlKey },
    deltaMode: { value: deltaMode },
    deltaX: { value: deltaX },
    deltaY: { value: deltaY },
    metaKey: { value: metaKey },
  });
  target.dispatchEvent(event);
  return event;
}
