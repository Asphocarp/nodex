import { afterEach, describe, expect, test } from "vitest";
import {
  BROWSER_SIDEBAR_VISIBLE_WEBVIEW_Z_INDEX,
  BROWSER_SIDEBAR_WEBVIEW_LAYER_ROOT_Z_INDEX,
  BrowserSidebarRendererWebviewManager,
  type BrowserSidebarWebviewElement,
} from "./browser-sidebar-webview-manager";
import type {
  BrowserSidebarWebviewDestroyed,
  BrowserSidebarWebviewHostCreated,
} from "../../../shared/browser-sidebar";

let activeManagers: BrowserSidebarRendererWebviewManager[] = [];

afterEach(() => {
  for (const manager of activeManagers) manager.disposeAll();
  activeManagers = [];
  document.body.innerHTML = "";
});

function createManager() {
  const manager = new BrowserSidebarRendererWebviewManager();
  activeManagers.push(manager);
  return manager;
}

function installWebContentsId(webview: Element, webContentsId: number) {
  (webview as BrowserSidebarWebviewElement).getWebContentsId = () => webContentsId;
  (webview as BrowserSidebarWebviewElement).getTitle = () => "Example";
  (webview as BrowserSidebarWebviewElement).getURL = () => "https://example.com/";
}

const visibleBounds = { x: 10, y: 20, width: 320, height: 240 };

function getManagerRoot(tabId = "tab-browser") {
  return document.body.querySelector<HTMLElement>(
    `[data-browser-sidebar-webview-manager-root][data-browser-sidebar-browser-tab-id='${tabId}']`,
  );
}

function getManagerLayerRoot() {
  return document.body.querySelector<HTMLElement>(
    "[data-browser-sidebar-webview-manager-layer-root]",
  );
}

describe("BrowserSidebarRendererWebviewManager", () => {
  test("creates one managed webview host and reports a mount generation once", () => {
    const manager = createManager();
    const created: BrowserSidebarWebviewHostCreated[] = [];

    const mountGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration,
      onHostCreated: (event) => created.push(event),
    });

    const root = getManagerRoot();
    const webview = root?.querySelector("webview");
    expect(root !== null).toBe(true);
    expect(webview !== null).toBe(true);
    installWebContentsId(webview as Element, 101);
    webview?.dispatchEvent(new Event("did-attach"));
    webview?.dispatchEvent(new Event("dom-ready"));

    expect(root?.querySelectorAll("webview").length).toBe(1);
    expect(root?.style.left).toBe("10px");
    expect(root?.style.top).toBe("20px");
    expect(root?.style.width).toBe("320px");
    expect(root?.style.height).toBe("240px");
    expect(root?.style.zIndex).toBe("");
    expect(root?.parentElement === getManagerLayerRoot()).toBe(true);
    expect(getManagerLayerRoot()?.style.pointerEvents).toBe("none");
    expect(getManagerLayerRoot()?.style.zIndex).toBe(String(BROWSER_SIDEBAR_WEBVIEW_LAYER_ROOT_Z_INDEX));
    expect(created.length).toBe(1);
    expect(created[0]?.webContentsId).toBe(101);
    expect(created[0]?.mountGeneration).toBe(1);
  });

  test("keeps retained visible hosts on the retained webview layer", () => {
    const manager = createManager();

    const mountGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-retained" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-retained",
      hostKind: "retained",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration,
      isVisible: true,
      shouldPaint: true,
      onHostCreated: () => undefined,
    });

    const root = getManagerRoot("tab-retained");
    expect(root?.style.zIndex).toBe(String(BROWSER_SIDEBAR_VISIBLE_WEBVIEW_Z_INDEX));
    expect(root?.parentElement === document.body).toBe(true);
  });

  test("does not destroy the current visible host for a stale non-close generation request", () => {
    const manager = createManager();
    const destroyed: BrowserSidebarWebviewDestroyed[] = [];

    const firstGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration: firstGeneration,
      onHostCreated: () => undefined,
    });
    const secondGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration: secondGeneration,
      onHostCreated: () => undefined,
    });

    manager.destroyWebviewAtHostRequest({
      tabId: "tab-browser",
      mountGeneration: firstGeneration,
      reason: "unmounted",
      teardownId: "stale",
    }, (event) => destroyed.push(event));

    expect(getManagerRoot()?.querySelector("webview") !== null).toBe(true);
    expect(destroyed.length).toBe(1);
    expect(destroyed[0]?.mountGeneration).toBe(firstGeneration);
  });

  test("backgrounds a detached visible host without reparenting the guest webview", async () => {
    const manager = createManager();

    const mountGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration,
      isVisible: true,
      shouldPaint: true,
      onHostCreated: () => undefined,
    });
    const root = getManagerRoot();
    const webview = root?.querySelector("webview");
    const originalParent = webview?.parentElement;
    expect(webview !== null).toBe(true);

    manager.detachWebview({ sessionId: "session-1", tabId: "tab-browser" }, mountGeneration);
    await Promise.resolve();

    expect(getManagerRoot() === root).toBe(true);
    expect(webview?.parentElement === originalParent).toBe(true);
    expect(root?.style.left).toBe("-10000px");
    expect(root?.style.visibility).toBe("hidden");
    expect((webview as HTMLElement).isConnected).toBe(true);
  });

  test("reuses the same guest across panel and background sync without resetting src or parent", () => {
    const manager = createManager();

    const firstGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com/first",
      bounds: visibleBounds,
      mountGeneration: firstGeneration,
      isVisible: true,
      shouldPaint: true,
      onHostCreated: () => undefined,
    });
    const root = getManagerRoot();
    const webview = root?.querySelector("webview");
    const originalParent = webview?.parentElement;
    expect(webview !== null).toBe(true);

    const secondGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "background",
      initialUrl: "https://example.com/second",
      bounds: null,
      mountGeneration: secondGeneration,
      isVisible: false,
      shouldPaint: false,
      onHostCreated: () => undefined,
    });

    expect(getManagerRoot() === root).toBe(true);
    expect(webview?.parentElement === originalParent).toBe(true);
    expect(webview?.getAttribute("src")).toBe("https://example.com/first");
  });

  test("does not call through readiness-sensitive webview methods before attach is available", () => {
    const manager = createManager();
    const created: BrowserSidebarWebviewHostCreated[] = [];

    const mountGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration,
      onHostCreated: (event) => created.push(event),
    });
    const webview = getManagerRoot()?.querySelector("webview") as BrowserSidebarWebviewElement | null;
    if (!webview) throw new Error("Expected managed webview");
    webview.getWebContentsId = () => {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.");
    };

    webview.dispatchEvent(new Event("did-attach"));
    webview.dispatchEvent(new Event("dom-ready"));

    expect(created.length).toBe(0);
  });

  test("removes listeners and host after an accepted destroy request", () => {
    const manager = createManager();
    const created: BrowserSidebarWebviewHostCreated[] = [];
    const destroyed: BrowserSidebarWebviewDestroyed[] = [];

    const mountGeneration = manager.claimMountGeneration({ sessionId: "session-1", tabId: "tab-browser" });
    manager.syncWebview({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration,
      onHostCreated: (event) => created.push(event),
    });
    const root = getManagerRoot();
    const webview = root?.querySelector("webview");
    installWebContentsId(webview as Element, 101);
    webview?.dispatchEvent(new Event("did-attach"));

    manager.destroyWebviewAtHostRequest({
      tabId: "tab-browser",
      mountGeneration,
      reason: "closed",
      teardownId: "current",
    }, (event) => destroyed.push(event));
    webview?.dispatchEvent(new Event("did-attach"));

    expect(root?.isConnected).toBe(false);
    expect(created.length).toBe(1);
    expect(destroyed.length).toBe(1);
    expect(destroyed[0]?.webContentsId).toBe(101);
  });
});
