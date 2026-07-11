import { describe, expect, vi, test } from "vitest";
import { EventEmitter } from "node:events";
import type { BrowserSidebarCommandResult } from "../shared/browser-sidebar";

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
    tabId: "tab-browser",
    sessionId: "session-1",
    projectId: "alpha",
    initialUrl: "about:blank",
    title: "Browser",
  });
}

function readTab(service: BrowserSidebarServiceInstance) {
  const tab = service.getStateSnapshot().tabs.find((item) => item.tabId === "tab-browser");
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
      tabId: "tab-browser",
      url: "https://www.google.com",
      source: "manual",
      initiator: "address_bar",
    });

    expect(result.ok).toBe(true);
    expect(contents.loadUrls.length).toBe(0);
    expect(readTab(service).url).toBe("https://www.google.com");

    await service.handleWebviewHostCreated({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
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
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      mountGeneration: 4,
      webContentsId: 101,
      initialUrl: "https://example.com",
      title: "Example",
    });
    await service.handleCommand({ type: "set-zoom-percent", tabId: "tab-browser", zoomPercent: 150 });
    await service.handleCommand({
      type: "navigate",
      tabId: "tab-browser",
      url: "https://example.com/live",
      source: "manual",
      initiator: "address_bar",
    });

    await service.handleCommand({
      type: "register-tab",
      tabId: "tab-browser",
      sessionId: "session-1",
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
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
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
      tabId: "tab-browser",
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
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "about:blank",
    });
    contents.rejectLoadWith = new Error("DNS failure");

    const result = await service.handleCommand({ type: "navigate", tabId: "tab-browser", url: "https://example.test" });
    await flushLoadPromise();

    expect(result.ok).toBe(true);
    expect(readTab(service).errorMessage).toBe("DNS failure");
  });

  test("reattaching the same webContents id is listener-idempotent", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);

    const event = {
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
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
    await registerTab(service);
    await service.handleWebviewHostCreated({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      mountGeneration: 2,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });

    await service.handleWebviewDestroyed({
      tabId: "tab-browser",
      mountGeneration: 1,
      reason: "closed",
      teardownId: "stale",
      webContentsId: 101,
    });
    expect(readTab(service).webContentsId).toBe(101);

    await service.handleWebviewDestroyed({
      tabId: "tab-browser",
      mountGeneration: 2,
      reason: "closed",
      teardownId: "current",
      webContentsId: 101,
    });
    expect(readTab(service).webContentsId).toBe(null);
  });

  test("reload commands stay main-owned", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });

    await service.handleCommand({ type: "reload", tabId: "tab-browser" });
    await service.handleCommand({ type: "reload", tabId: "tab-browser", ignoreCache: true });

    expect(contents.reloads).toBe(1);
    expect(contents.hardReloads).toBe(1);
  });

  test("zoom commands use Codex parity names and stay main-owned", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });

    await service.handleCommand({ type: "set-zoom-percent", tabId: "tab-browser", zoomPercent: 125 });
    await service.handleCommand({ type: "step-zoom", tabId: "tab-browser", delta: 25 });
    await service.handleCommand({ type: "reset-zoom", tabId: "tab-browser" });

    expect(contents.zoomFactors.join(",")).toBe("1.25,1.5,1");
    expect(readTab(service).zoomPercent).toBe(100);
  });

  test("interaction mode and find commands update browser snapshot", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    await service.handleWebviewHostCreated({
      sessionId: "session-1",
      projectId: "alpha",
      tabId: "tab-browser",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });

    await service.handleCommand({ type: "set-interaction-mode", tabId: "tab-browser", mode: "comment" });
    await service.handleCommand({ type: "open-find", tabId: "tab-browser" });
    await service.handleCommand({ type: "set-find-query", tabId: "tab-browser", query: "hello", caseSensitive: true });
    await service.handleCommand({ type: "find-next", tabId: "tab-browser" });
    await service.handleCommand({ type: "find-previous", tabId: "tab-browser" });
    contents.emit("found-in-page", {}, { activeMatchOrdinal: 2, matches: 5 });
    await service.handleCommand({ type: "close-find", tabId: "tab-browser" });

    expect(contents.findCalls.length).toBe(3);
    expect(contents.findCalls[0]?.text).toBe("hello");
    expect(contents.findCalls[1]?.options?.forward).toBe(true);
    expect(contents.findCalls[2]?.options?.forward).toBe(false);
    expect(contents.stopFindActions[0]).toBe("clearSelection");
    expect(readTab(service).interactionMode).toBe("comment");
    expect(readTab(service).findState.open).toBe(false);
  });

  test("browser-use commands emit split viewport, cursor, and release events", async () => {
    const service = createService();
    let viewportEvent = "";
    let cursorEvent = "";
    let releasedEvent = "";
    service.on("browserUseViewport", (payload) => {
      viewportEvent = `${payload.tabId}:${payload.viewportSize?.width ?? 0}x${payload.viewportSize?.height ?? 0}`;
    });
    service.on("browserUseCursor", (payload) => {
      cursorEvent = `${payload.tabId}:${payload.x},${payload.y}:${payload.visible}`;
    });
    service.on("pageReleased", (payload) => {
      releasedEvent = payload.tabId;
    });

    await service.handleCommand({
      type: "browser-use-set-viewport",
      event: { tabId: "tab-browser", viewportSize: { width: 390, height: 844 } },
    });
    await service.handleCommand({
      type: "browser-use-set-cursor",
      cursor: { tabId: "tab-browser", x: 12, y: 34, visible: true, updatedAt: 1 },
    });
    await service.handleCommand({
      type: "browser-use-upsert-tab",
      tab: {
        tabId: "tab-browser",
        projectId: "alpha",
        sessionId: "session-1",
        title: "Browser",
        url: "https://example.com",
        webContentsId: 101,
        viewport: { width: 390, height: 844, zoomPercent: 100, presetId: "iphone-15-pro" },
        captureActive: true,
        released: false,
        updatedAt: 1,
      },
    });
    await service.handleCommand({ type: "browser-use-release-tab", tabId: "tab-browser" });

    expect(viewportEvent).toBe("tab-browser:390x844");
    expect(cursorEvent).toBe("tab-browser:12,34:true");
    expect(releasedEvent).toBe("tab-browser");
    expect(service.getBrowserUseStateSnapshot().activeTabId).toBe(null);
  });
});
