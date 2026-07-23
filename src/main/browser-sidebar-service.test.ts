import { describe, expect, vi, test } from "vitest";
import { EventEmitter } from "node:events";
import type {
  BrowserSidebarCommandResult,
  BrowserSidebarTabIdentity,
} from "../shared/browser-sidebar";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class Notification {
    static isSupported() {
      return true;
    }
  },
  session: { fromPartition: () => ({ clearCache: async () => undefined, clearStorageData: async () => undefined }) },
  shell: { openExternal: async () => undefined },
  webContents: { fromId: () => undefined },
}));

const { BrowserSidebarService } = await import("./browser-sidebar-service");
type BrowserSidebarServiceInstance = InstanceType<typeof BrowserSidebarService>;

const browserIdentity = {
  browserConversationId: "session-1",
  browserViewScopeId: "window-session-1",
  browserTabId: "tab-browser",
} as const;

class FakeWebContents extends EventEmitter {
  loadUrls: string[] = [];
  reloads = 0;
  hardReloads = 0;
  windowOpenHandlerCalls = 0;
  url = "about:blank";
  title = "New tab";
  loading = false;
  destroyed = false;
  rejectLoadWith: unknown = null;
  zoomFactors: number[] = [];
  findCalls: Array<{ text: string; options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean } }> = [];
  stopFindActions: string[] = [];

  canGoBack() { return false; }
  canGoForward() { return false; }
  capturePage() { return Promise.resolve({ toDataURL: () => "data:image/png;base64,test" }); }
  getTitle() { return this.title; }
  getURL() { return this.url; }
  goBack() { }
  goForward() { }
  isDestroyed() { return this.destroyed; }
  isLoading() { return this.loading; }
  loadURL(url: string) {
    this.loadUrls.push(url);
    this.url = url;
    if (this.rejectLoadWith) return Promise.reject(this.rejectLoadWith);
    return Promise.resolve();
  }
  reload() { this.reloads += 1; }
  reloadIgnoringCache() { this.hardReloads += 1; }
  setWindowOpenHandler() {
    this.windowOpenHandlerCalls += 1;
  }
  setZoomFactor(factor: number) {
    this.zoomFactors.push(factor);
  }
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) {
    this.findCalls.push({ text, options });
    return this.findCalls.length;
  }
  stop() {
    this.loading = false;
  }
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection") {
    this.stopFindActions.push(action);
  }
}

function createService(contentsById = new Map<number, FakeWebContents>()) {
  return new BrowserSidebarService({
    electron: {
      session: {
        fromPartition: (() => ({
          clearCache: async () => undefined,
          clearStorageData: async () => undefined,
        })) as never,
      },
      shell: {
        openExternal: async () => undefined,
      },
      webContents: {
        fromId: (id) => contentsById.get(id) as never ?? null,
      },
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
  });
}

async function registerTab(service: BrowserSidebarServiceInstance) {
  await service.handleCommand({
    type: "register-tab",
    ...browserIdentity,
    projectId: "alpha",
    initialUrl: "about:blank",
    title: "Browser",
  });
}

function readTab(
  service: BrowserSidebarServiceInstance,
  identity: BrowserSidebarTabIdentity = browserIdentity,
) {
  const tab = service.getStateSnapshot().tabs.find((item) =>
    item.browserConversationId === identity.browserConversationId
    && item.browserViewScopeId === identity.browserViewScopeId
    && item.browserTabId === identity.browserTabId
  );
  if (!tab) throw new Error("Missing browser tab snapshot");
  return tab;
}

async function flushLoadPromise() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("BrowserSidebarService webview lifecycle", () => {
  test("queues first navigation until a managed webview host attaches", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);

    const result = await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://www.google.com",
      source: "manual",
      initiator: "address_bar",
    });

    expect(result.ok).toBe(true);
    expect(contents.loadUrls.length).toBe(0);
    expect(readTab(service).url).toBe("https://www.google.com");

    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://www.google.com/",
    });

    expect(readTab(service).webContentsId).toBe(101);
    expect(contents.loadUrls.length).toBe(0);
  });

  test("repeated register preserves live webview state", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 4,
      webContentsId: 101,
      initialUrl: "https://example.com",
      title: "Example",
    });
    await service.handleCommand({ type: "set-zoom-percent", ...browserIdentity, zoomPercent: 150 });
    await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://example.com/live",
      source: "manual",
      initiator: "address_bar",
    });

    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      projectId: "alpha",
      initialUrl: "about:blank",
      title: "Browser",
      deviceToolbarVisible: false,
    });

    const snapshot = readTab(service);
    expect(snapshot.webContentsId).toBe(101);
    expect(snapshot.mountGeneration).toBe(4);
    expect(snapshot.url).toBe("https://example.com/live");
    expect(snapshot.zoomPercent).toBe(150);
    expect(snapshot.hasBrowserPage).toBe(true);
  });

  test("navigates an attached host once and contains Electron aborts", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "about:blank",
    });
    contents.rejectLoadWith = Object.assign(new Error("ERR_ABORTED (-3) loading 'https://www.google.com/'"), {
      code: "ERR_ABORTED",
      errno: -3,
    });

    const result = await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://www.google.com",
      source: "manual",
      initiator: "address_bar",
    }) as BrowserSidebarCommandResult;
    await flushLoadPromise();

    expect(result.ok).toBe(true);
    expect(contents.loadUrls.length).toBe(1);
    expect(contents.loadUrls[0]).toBe("https://www.google.com");
    expect(readTab(service).errorMessage === undefined).toBe(true);
  });

  test("records real load failures without throwing the command handler", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "about:blank",
    });
    contents.rejectLoadWith = new Error("DNS failure");

    const result = await service.handleCommand({ type: "navigate", ...browserIdentity, url: "https://example.test" });
    await flushLoadPromise();

    expect(result.ok).toBe(true);
    expect(readTab(service).errorMessage).toBe("DNS failure");
  });

  test("reattaching the same webContents id is listener-idempotent", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);

    const event = {
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel" as const,
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "about:blank",
    };
    await service.handleWebviewHostCreated(event);
    await service.handleWebviewHostCreated(event);

    expect(contents.listenerCount("destroyed")).toBe(1);
    expect(contents.listenerCount("did-start-loading")).toBe(1);
    expect(contents.windowOpenHandlerCalls).toBe(1);
  });

  test("destroy acks are generation-safe", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    const pendingDestroys: import("../shared/browser-sidebar").BrowserSidebarDestroyWebviewRequest[] = [];
    service.on("destroyWebview", (request) => {
      pendingDestroys.push(request);
    });
    await registerTab(service);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 2,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });
    await service.handleCommand({ type: "navigate", ...browserIdentity, url: "about:blank" });

    await service.handleWebviewDestroyed({
      ...browserIdentity,
      mountGeneration: 1,
      reason: "closed",
      teardownId: "stale",
      webContentsId: 101,
    });
    expect(readTab(service).webContentsId).toBe(101);

    const pendingDestroy = pendingDestroys.at(-1);
    if (!pendingDestroy) throw new Error("Missing pending teardown request");
    await service.handleWebviewDestroyed({
      ...pendingDestroy,
      webContentsId: 101,
    });
    expect(readTab(service).webContentsId).toBe(null);
  });

  test("reload commands stay main-owned", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });

    await service.handleCommand({ type: "reload", ...browserIdentity });
    await service.handleCommand({ type: "reload", ...browserIdentity, ignoreCache: true });

    expect(contents.reloads).toBe(1);
    expect(contents.hardReloads).toBe(1);
  });

  test("zoom commands use Codex parity names and stay main-owned", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });

    await service.handleCommand({ type: "set-zoom-percent", ...browserIdentity, zoomPercent: 125 });
    await service.handleCommand({ type: "step-zoom", ...browserIdentity, delta: 25 });
    await service.handleCommand({ type: "reset-zoom", ...browserIdentity });

    expect(contents.zoomFactors.join(",")).toBe("1.25,1.5,1");
    expect(readTab(service).zoomPercent).toBe(100);
  });

  test("interaction mode and find commands update browser snapshot", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });

    await service.handleCommand({ type: "set-interaction-mode", ...browserIdentity, mode: "comment" });
    await service.handleCommand({ type: "open-find", ...browserIdentity });
    await service.handleCommand({ type: "set-find-query", ...browserIdentity, query: "hello", caseSensitive: true });
    await service.handleCommand({ type: "find-next", ...browserIdentity });
    await service.handleCommand({ type: "find-previous", ...browserIdentity });
    contents.emit("found-in-page", {}, { activeMatchOrdinal: 2, matches: 5 });
    await service.handleCommand({ type: "close-find", ...browserIdentity });

    expect(contents.findCalls.length).toBe(3);
    expect(contents.findCalls[0]?.text).toBe("hello");
    expect(contents.findCalls[1]?.options?.forward).toBe(true);
    expect(contents.findCalls[2]?.options?.forward).toBe(false);
    expect(contents.stopFindActions[0]).toBe("clearSelection");
    expect(readTab(service).interactionMode).toBe("comment");
    expect(readTab(service).findState.open).toBe(false);
  });

  test("keeps the same browser tab id independent across window scopes", async () => {
    const service = createService();
    const otherIdentity = {
      browserConversationId: browserIdentity.browserConversationId,
      browserViewScopeId: "window-session-2",
      browserTabId: browserIdentity.browserTabId,
    } as const;

    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      projectId: "alpha",
      initialUrl: "https://one.example",
      title: "One",
    });
    await service.handleCommand({
      type: "register-tab",
      ...otherIdentity,
      projectId: null,
      initialUrl: "https://two.example",
      title: "Two",
    });
    await service.handleCommand({
      type: "set-title",
      ...browserIdentity,
      title: "Changed only in one",
    });

    expect(service.getStateSnapshot().tabs.length).toBe(2);
    expect(readTab(service).title).toBe("Changed only in one");
    expect(readTab(service, otherIdentity).title).toBe("Two");
    expect(readTab(service, otherIdentity).projectId).toBe(null);
    expect(JSON.stringify(service.getConversationBrowserTabIds(
      "session-1",
      browserIdentity.browserViewScopeId,
    ))).toBe(
      JSON.stringify([]),
    );

    await service.handleCommand({ type: "close-tab", ...browserIdentity });

    expect(service.getStateSnapshot().tabs.length).toBe(1);
    expect(readTab(service, otherIdentity).url).toBe("https://two.example");
  });

  test("browser-use commands emit split viewport, cursor, and release events", async () => {
    const service = createService();
    let viewportEvent = "";
    const cursorEvents: string[] = [];
    let releasedEvent = "";
    service.on("browserUseViewport", (payload) => {
      viewportEvent = `${payload.browserConversationId}/${payload.browserTabId}:${payload.viewportSize?.width ?? 0}x${payload.viewportSize?.height ?? 0}`;
    });
    service.on("browserUseCursor", (payload) => {
      cursorEvents.push(`${payload.browserConversationId}/${payload.browserTabId}:${payload.x},${payload.y}:${payload.visible}`);
    });
    service.on("pageReleased", (payload) => {
      releasedEvent = `${payload.browserConversationId}/${payload.browserTabId}`;
    });

    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      projectId: "alpha",
      initialUrl: "https://ordinary.example",
    });
    await service.handleCommand({
      type: "set-device-toolbar-visible",
      ...browserIdentity,
      visible: true,
    });

    await service.handleCommand({
      type: "browser-use-set-viewport",
      event: { ...browserIdentity, viewportSize: { width: 390, height: 844 } },
    });
    await service.handleCommand({
      type: "browser-use-set-cursor",
      cursor: { ...browserIdentity, x: 12, y: 34, visible: true, updatedAt: 1 },
    });
    await service.handleCommand({
      type: "browser-use-set-cursor",
      cursor: {
        browserConversationId: "session-2",
        browserViewScopeId: "window-session-2",
        browserTabId: browserIdentity.browserTabId,
        x: 98,
        y: 76,
        visible: false,
        updatedAt: 2,
      },
    });
    await service.handleCommand({
      type: "browser-use-upsert-tab",
      tab: {
        ...browserIdentity,
        projectId: "alpha",
        title: "Browser",
        url: "https://example.com",
        webContentsId: 101,
        viewport: { width: 390, height: 844, zoomPercent: 100, presetId: "iphone-15-pro" },
        captureActive: true,
        released: false,
        updatedAt: 1,
      },
    });
    await service.handleCommand({ type: "browser-use-release-tab", ...browserIdentity });

    expect(viewportEvent).toBe("session-1/tab-browser:390x844");
    expect(JSON.stringify(cursorEvents)).toBe(JSON.stringify([
      "session-1/tab-browser:12,34:true",
      "session-2/tab-browser:98,76:false",
    ]));
    expect(releasedEvent).toBe("session-1/tab-browser");
    expect(
      service.getBrowserUseStateSnapshot().activeBrowserTabIdsByConversationScope[
        `session-1\0${browserIdentity.browserViewScopeId}`
      ] === undefined,
    ).toBe(true);
    expect(JSON.stringify(service.getBrowserUseStateSnapshot().cursors)).toBe(JSON.stringify([
      {
        browserConversationId: "session-2",
        browserViewScopeId: "window-session-2",
        browserTabId: "tab-browser",
        x: 98,
        y: 76,
        visible: false,
        updatedAt: 2,
      },
    ]));
    expect(readTab(service).url).toBe("https://ordinary.example");
    expect(readTab(service).deviceToolbarVisible).toBe(true);
    expect(readTab(service).deviceToolbarState.toolbarState.isEnabled).toBe(true);
    expect(service.getDeviceToolbarTabState(browserIdentity).toolbarState.isEnabled).toBe(false);
  });

  test("conversation teardown removes only that composite browser namespace", async () => {
    const service = createService();
    const secondIdentity = {
      browserConversationId: "session-2",
      browserViewScopeId: "window-session-2",
      browserTabId: browserIdentity.browserTabId,
    } as const;
    let pageReleasedCount = 0;
    service.on("pageReleased", () => {
      pageReleasedCount += 1;
    });

    for (const identity of [browserIdentity, secondIdentity]) {
      await service.handleCommand({
        type: "register-tab",
        ...identity,
        projectId: null,
        initialUrl: `https://${identity.browserConversationId}.example`,
      });
      await service.handleCommand({
        type: "browser-use-upsert-tab",
        tab: {
          ...identity,
          projectId: null,
          title: identity.browserConversationId,
          url: `https://${identity.browserConversationId}.example`,
          webContentsId: null,
          viewport: { width: 390, height: 844, zoomPercent: 100, presetId: "responsive" },
          captureActive: true,
          released: false,
          updatedAt: 1,
        },
      });
      await service.handleCommand({
        type: "browser-use-set-cursor",
        cursor: { ...identity, x: 1, y: 2, visible: true, updatedAt: 1 },
      });
    }

    service.closeBrowserConversation(browserIdentity.browserConversationId);

    expect(service.getStateSnapshot().tabs.length).toBe(1);
    expect(readTab(service, secondIdentity).url).toBe("https://session-2.example");
    expect(service.getBrowserUseStateSnapshot().tabs.length).toBe(1);
    expect(service.getBrowserUseStateSnapshot().tabs[0]?.browserConversationId).toBe("session-2");
    expect(service.getBrowserUseStateSnapshot().cursors.length).toBe(1);
    expect(service.getBrowserUseStateSnapshot().cursors[0]?.browserConversationId).toBe("session-2");
    expect(pageReleasedCount).toBe(0);
  });
});
