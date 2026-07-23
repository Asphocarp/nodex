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
import { makeBrowserSidebarRoutePartition } from "../../../shared/browser-sidebar";

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

function getManagerRoot(
  browserTabId = "tab-browser",
  browserConversationId?: string,
  browserViewScopeId?: string,
) {
  const conversationSelector = browserConversationId === undefined
    ? ""
    : `[data-browser-sidebar-conversation-id='${browserConversationId}']`;
  const scopeSelector = browserViewScopeId === undefined
    ? ""
    : `[data-browser-sidebar-view-scope-id='${browserViewScopeId}']`;
  return document.body.querySelector<HTMLElement>(
    `[data-browser-sidebar-webview-manager-root]${conversationSelector}${scopeSelector}[data-browser-sidebar-browser-tab-id='${browserTabId}']`,
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

    const mountGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
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
    expect(webview?.getAttribute("partition")).toBe(
      makeBrowserSidebarRoutePartition({
        browserConversationId: "session-1",
        browserViewScopeId: "window-session-1",
        browserTabId: "tab-browser",
      }),
    );
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

  test("partitions equal browser tab ids by window view scope", () => {
    const manager = createManager();
    const browserTabId = "browser:shared";
    const firstIdentity = {
      browserConversationId: "conversation/one",
      browserViewScopeId: "window-session-1",
      browserTabId,
    } as const;
    const secondIdentity = {
      browserConversationId: "conversation/one",
      browserViewScopeId: "window-session-2",
      browserTabId,
    } as const;

    const firstGeneration = manager.claimMountGeneration(firstIdentity);
    const secondGeneration = manager.claimMountGeneration(secondIdentity);
    manager.syncWebview({
      ...firstIdentity,
      projectId: "alpha",
      hostKind: "background",
      initialUrl: "https://one.example",
      bounds: null,
      mountGeneration: firstGeneration,
      onHostCreated: () => undefined,
    });
    manager.syncWebview({
      ...secondIdentity,
      projectId: null,
      hostKind: "background",
      initialUrl: "https://two.example",
      bounds: null,
      mountGeneration: secondGeneration,
      onHostCreated: () => undefined,
    });

    const firstRoot = getManagerRoot(
      browserTabId,
      firstIdentity.browserConversationId,
      firstIdentity.browserViewScopeId,
    );
    const secondRoot = getManagerRoot(
      browserTabId,
      secondIdentity.browserConversationId,
      secondIdentity.browserViewScopeId,
    );
    expect(firstGeneration).toBe(1);
    expect(secondGeneration).toBe(1);
    expect(firstRoot === secondRoot).toBe(false);
    expect(firstRoot?.querySelector("webview")?.getAttribute("partition")).toBe(
      makeBrowserSidebarRoutePartition(firstIdentity),
    );
    expect(secondRoot?.querySelector("webview")?.getAttribute("partition")).toBe(
      makeBrowserSidebarRoutePartition(secondIdentity),
    );
  });

  test("keeps retained visible hosts on the retained webview layer", () => {
    const manager = createManager();

    const mountGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-retained" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-retained",
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

    const firstGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration: firstGeneration,
      onHostCreated: () => undefined,
    });
    const secondGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration: secondGeneration,
      onHostCreated: () => undefined,
    });

    manager.destroyWebviewAtHostRequest({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      browserTabId: "tab-browser",
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

    const mountGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
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

    manager.detachWebview({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" }, mountGeneration);
    await Promise.resolve();

    expect(getManagerRoot() === root).toBe(true);
    expect(webview?.parentElement === originalParent).toBe(true);
    expect(root?.style.left).toBe("-10000px");
    expect(root?.style.visibility).toBe("hidden");
    expect((webview as HTMLElement).isConnected).toBe(true);
  });

  test("preserves one navigated guest across visible A to hidden B to visible A claims", () => {
    const manager = createManager();

    const firstGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
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
    (webview as BrowserSidebarWebviewElement).getURL = () => "https://example.com/navigated";

    const secondGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
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

    const thirdGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
      hostKind: "panel",
      initialUrl: "https://example.com/stale-durable-url",
      bounds: visibleBounds,
      mountGeneration: thirdGeneration,
      isVisible: true,
      shouldPaint: true,
      onHostCreated: () => undefined,
    });

    expect(getManagerRoot() === root).toBe(true);
    expect(root?.querySelector("webview") === webview).toBe(true);
    expect((webview as BrowserSidebarWebviewElement).getURL?.()).toBe("https://example.com/navigated");
    expect(webview?.getAttribute("src")).toBe("https://example.com/first");
  });

  test("does not call through readiness-sensitive webview methods before attach is available", () => {
    const manager = createManager();
    const created: BrowserSidebarWebviewHostCreated[] = [];

    const mountGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
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

    const mountGeneration = manager.claimMountGeneration({ browserConversationId: "session-1",
      browserViewScopeId: "window-session-1", browserTabId: "tab-browser" });
    manager.syncWebview({
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      projectId: "alpha",
      browserTabId: "tab-browser",
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
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      browserTabId: "tab-browser",
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

  test("destroys an explicitly closed runtime host at most once", () => {
    const manager = createManager();
    const identity = {
      browserConversationId: "session-1",
      browserViewScopeId: "window-session-1",
      browserTabId: "tab-browser",
    } as const;
    const mountGeneration = manager.claimMountGeneration(identity);
    manager.syncWebview({
      ...identity,
      projectId: "alpha",
      hostKind: "panel",
      initialUrl: "https://example.com",
      bounds: visibleBounds,
      mountGeneration,
      onHostCreated: () => undefined,
    });
    const root = getManagerRoot();
    if (!root) throw new Error("Expected managed Browser host");
    const remove = root.remove.bind(root);
    let removeCount = 0;
    root.remove = () => {
      removeCount += 1;
      remove();
    };
    const request = {
      ...identity,
      mountGeneration,
      reason: "closed",
      teardownId: "explicit-close",
    } as const;

    manager.destroyWebviewAtHostRequest(request, () => undefined);
    manager.destroyWebviewAtHostRequest(request, () => undefined);

    expect(removeCount).toBe(1);
    expect(root.isConnected).toBe(false);
  });
});
