import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { ProjectSession, ProjectSessionTab } from "@/lib/types";
import { render, settleAsyncRender } from "../../test/dom";
import { browserSidebarRendererWebviewManager } from "./browser-sidebar-webview-manager";

let BrowserSidebarPanel: typeof import("./browser-sidebar-panel")["BrowserSidebarPanel"];
let invokeCalls: unknown[][] = [];

mock.module("@/lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return { ok: true };
  },
}));

beforeAll(async () => {
  const module = await import("./browser-sidebar-panel");
  BrowserSidebarPanel = module.BrowserSidebarPanel;
});

beforeEach(() => {
  invokeCalls = [];
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      on: () => () => undefined,
    },
  });
});

afterEach(() => {
  browserSidebarRendererWebviewManager.disposeAll();
});

describe("BrowserSidebarPanel chrome", () => {
  test("renders address input inside a no-drag island within the draggable toolbar", () => {
    const view = render(
      <BrowserSidebarPanel
        tab={browserTab}
        activeSession={activeSession}
        onRefreshSessions={async () => [activeSession]}
      />,
    );

    const input = view.container.querySelector<HTMLInputElement>("[data-browser-sidebar-address-input='true']");
    expect(input === null).toBeFalse();

    const toolbarRow = input?.closest(".draggable");
    expect(toolbarRow === null).toBeFalse();

    const noDragIsland = input?.closest(".no-drag");
    expect(noDragIsland === null).toBeFalse();
    expect(noDragIsland?.className.includes("items-center justify-center px-1")).toBeTrue();

    const addressShell = input?.closest(".group\\/address-bar");
    expect(addressShell === null).toBeFalse();
  });

  test("does not close the browser guest when the React panel unmounts", async () => {
    const view = render(
      <BrowserSidebarPanel
        tab={loadedBrowserTab}
        activeSession={{ ...activeSession, tabs: [loadedBrowserTab] }}
        onRefreshSessions={async () => [{ ...activeSession, tabs: [loadedBrowserTab] }]}
      />,
    );

    await settleAsyncRender();
    view.unmount();
    await settleAsyncRender();

    const commandTypes = invokeCalls
      .filter((call) => call[0] === "browser-sidebar-command")
      .map((call) => (call[1] as { type?: string } | undefined)?.type)
      .join(",");
    expect(commandTypes.includes("unregister-tab")).toBeFalse();
    expect(commandTypes.includes("close-tab")).toBeFalse();
  });

  test("remounts the visible panel without recreating or reparenting the webview", async () => {
    const first = render(
      <BrowserSidebarPanel
        tab={loadedBrowserTab}
        activeSession={{ ...activeSession, tabs: [loadedBrowserTab] }}
        onRefreshSessions={async () => [{ ...activeSession, tabs: [loadedBrowserTab] }]}
      />,
    );
    await settleAsyncRender();
    const firstRoot = document.body.querySelector("[data-browser-sidebar-webview-manager-root]");
    const firstWebview = firstRoot?.querySelector("webview");
    const firstParent = firstWebview?.parentElement;

    first.unmount();
    await settleAsyncRender();

    const second = render(
      <BrowserSidebarPanel
        tab={loadedBrowserTab}
        activeSession={{ ...activeSession, tabs: [loadedBrowserTab] }}
        onRefreshSessions={async () => [{ ...activeSession, tabs: [loadedBrowserTab] }]}
      />,
    );
    await settleAsyncRender();
    const secondRoot = document.body.querySelector("[data-browser-sidebar-webview-manager-root]");
    const secondWebview = secondRoot?.querySelector("webview");

    expect(secondRoot === firstRoot).toBeTrue();
    expect(secondWebview === firstWebview).toBeTrue();
    expect(secondWebview?.parentElement === firstParent).toBeTrue();
    expect(secondWebview?.getAttribute("src")).toBe("https://www.google.com/");
    second.unmount();
  });

  test("renders browser options above the body-attached webview layer", async () => {
    const view = render(
      <BrowserSidebarPanel
        tab={loadedBrowserTab}
        activeSession={{ ...activeSession, tabs: [loadedBrowserTab] }}
        onRefreshSessions={async () => [{ ...activeSession, tabs: [loadedBrowserTab] }]}
      />,
    );
    await settleAsyncRender();

    const trigger = view.getByLabelText("Browser options");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await settleAsyncRender();

    const menu = document.body.querySelector<HTMLElement>("[role='menu']");
    expect(menu === null).toBeFalse();
    expect(menu?.style.zIndex).toBe("2147483647");
  });
});

const browserTab: ProjectSessionTab & { preview: true } = {
  id: "tab-browser",
  sessionId: "session-1",
  projectId: "alpha",
  panelId: "right",
  kind: "browser",
  title: "Browser",
  order: 0,
  config: {
    projectId: "alpha",
    url: "about:blank",
  },
  stateKey: 0,
  state: null,
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  preview: true,
};

const activeSession: ProjectSession = {
  id: "session-1",
  projectId: "alpha",
  title: "Session",
  isOverview: false,
  order: 0,
  pinned: false,
  pinnedOrder: null,
  archived: false,
  archivedAt: null,
  unread: false,
  leftPaneCollapsed: false,
  panels: {
    right: {
      collapsed: false,
      layout: {
        version: 2,
        root: { type: "leaf", id: "right-root", tabIds: ["tab-browser"], activeTabId: "tab-browser" },
        activeLeafId: "right-root",
        mruLeafIds: ["right-root"],
      },
      size: {},
    },
    bottom: {
      collapsed: true,
      layout: {
        version: 2,
        root: { type: "leaf", id: "bottom-root", tabIds: [], activeTabId: null },
        activeLeafId: "bottom-root",
        mruLeafIds: ["bottom-root"],
      },
      size: {},
    },
  },
  thread: null,
  tabs: [browserTab],
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
};

const loadedBrowserTab: ProjectSessionTab = {
  id: browserTab.id,
  sessionId: browserTab.sessionId,
  projectId: browserTab.projectId,
  panelId: browserTab.panelId,
  kind: browserTab.kind,
  title: browserTab.title,
  order: browserTab.order,
  config: {
    projectId: "alpha",
    url: "https://www.google.com/",
    title: "Google",
  },
  stateKey: browserTab.stateKey,
  state: browserTab.state,
  createdAt: browserTab.createdAt,
  updatedAt: browserTab.updatedAt,
};
