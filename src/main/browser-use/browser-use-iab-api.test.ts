import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type {
  BrowserSidebarTabIdentity,
  BrowserSidebarTabSnapshot,
  BrowserUseTabState,
} from "../../shared/browser-sidebar";
import type {
  BrowserWebContentsLike,
} from "../browser-sidebar-service";
import {
  BrowserUseIabApi,
  type BrowserUseCdpEvent,
} from "./browser-use-iab-api";
import type { BrowserUsePolicyReader } from "./browser-use-policy-store";

class FakeDebugger extends EventEmitter {
  attached = false;
  readonly delays = new Map<string, number>();
  readonly commands: Array<{
    method: string;
    params: Record<string, unknown> | undefined;
    sessionId: string | undefined;
  }> = [];

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
  }

  isAttached(): boolean {
    return this.attached;
  }

  async sendCommand(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    this.commands.push({ method, params, sessionId });
    const delayMs = this.delays.get(method);
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (method === "Target.attachToTarget") return { sessionId: "frame-session-1" };
    if (method === "Target.getTargets") {
      return {
        targetInfos: [{
          attached: false,
          targetId: "frame-target-1",
          title: "Frame",
          type: "iframe",
          url: "https://example.com/frame",
        }],
      };
    }
    if (method === "Page.getLayoutMetrics") {
      return {
        cssVisualViewport: {
          clientHeight: 1_200,
          clientWidth: 900,
        },
      };
    }
    if (method === "Page.getNavigationHistory") {
      return {
        currentIndex: 1,
        entries: [
          { id: 1, title: "Safe", url: "https://example.com/safe" },
          { id: 2, title: "Unsafe", url: "file:///tmp/private" },
        ],
      };
    }
    return { ok: true };
  }
}

class FakeWebContents extends EventEmitter {
  readonly debugger = new FakeDebugger();
  readonly executeJavaScript = vi.fn(async () => ({ ok: true }));

  canGoBack() { return false; }
  canGoForward() { return false; }
  async capturePage() { return {} as never; }
  getTitle() { return "Example"; }
  getURL() { return "https://example.com"; }
  goBack() {}
  goForward() {}
  isDestroyed() { return false; }
  isLoading() { return false; }
  async loadURL() {}
  reload() {}
  reloadIgnoringCache() {}
  setWindowOpenHandler() {}
  setZoomFactor() {}
  stop() {}
}

class FakeBrowserService extends EventEmitter {
  readonly activeTabs: Array<string | null> = [];
  readonly captures: Array<{ surfaceSize: { height: number; width: number } | null }> = [];
  readonly closed: BrowserSidebarTabIdentity[] = [];
  readonly commands: unknown[] = [];
  readonly cursors: unknown[] = [];
  readonly released: BrowserSidebarTabIdentity[] = [];
  debuggerReleases = 0;
  readonly snapshots = new Map<string, BrowserSidebarTabSnapshot>();
  readonly tabs = new Map<string, BrowserUseTabState>();
  readonly viewports: unknown[] = [];
  readonly visibilityChanges: Array<{
    browserTabId: string;
    visible: boolean;
  }> = [];
  visible = false;
  readonly contents = new FakeWebContents();

  private key(identity: BrowserSidebarTabIdentity): string {
    return `${identity.browserConversationId}:${identity.browserViewScopeId}:${identity.browserTabId}`;
  }

  listTabSnapshots(
    browserConversationId: string,
    browserViewScopeId: string,
  ): BrowserSidebarTabSnapshot[] {
    return [...this.snapshots.values()].filter((snapshot) =>
      snapshot.browserConversationId === browserConversationId
      && snapshot.browserViewScopeId === browserViewScopeId
    );
  }

  getTabSnapshot(identity: BrowserSidebarTabIdentity): BrowserSidebarTabSnapshot | null {
    return this.snapshots.get(this.key(identity)) ?? null;
  }

  getWebContentsForTab(): BrowserWebContentsLike {
    return this.contents as unknown as BrowserWebContentsLike;
  }

  upsertBrowserUseTab(tab: BrowserUseTabState): void {
    this.tabs.set(this.key(tab), tab);
    this.snapshots.set(this.key(tab), {
      ...tab,
      browserStorageId: `storage:${tab.browserTabId}`,
      codexSessionId: "thread-1",
      deviceToolbarState: {
        orientation: "portrait",
        presetId: "responsive",
        responsiveHeight: 720,
        responsiveWidth: 1_280,
        zoomPercent: 100,
      },
      deviceToolbarVisible: false,
      failure: undefined,
      faviconUrl: undefined,
      findState: {
        activeMatchOrdinal: 0,
        caseSensitive: false,
        matches: 0,
        open: false,
        query: "",
      },
      hasBrowserPage: true,
      isLoading: false,
      projectId: null,
      webContentsId: 11,
    } as unknown as BrowserSidebarTabSnapshot);
  }

  setActiveBrowserUseTab(
    _route: Omit<BrowserSidebarTabIdentity, "browserTabId">,
    browserTabId: string | null,
  ): void {
    this.activeTabs.push(browserTabId);
  }

  setBrowserVisibleForBrowserUse(
    _route: Omit<BrowserSidebarTabIdentity, "browserTabId">,
    browserTabId: string,
    visible: boolean,
  ): void {
    this.visibilityChanges.push({ browserTabId, visible });
    this.visible = visible;
  }

  isBrowserVisibleForBrowserUse(): boolean {
    return this.visible;
  }

  setBrowserUseCaptureSurface(event: { surfaceSize: { height: number; width: number } | null }): void {
    this.captures.push(event);
  }

  setBrowserUseCursor(cursor: unknown): boolean {
    this.cursors.push(cursor);
    return this.visible;
  }

  setBrowserUseViewport(viewport: unknown): void {
    this.viewports.push(viewport);
  }

  async handleCommand(command?: unknown): Promise<{ ok: true }> {
    this.commands.push(command);
    return { ok: true };
  }

  releaseBrowserUseTab(identity: BrowserSidebarTabIdentity): void {
    this.released.push(identity);
  }

  releaseBrowserUseDebugger(): void {
    this.debuggerReleases += 1;
  }

  closeBrowserTab(identity: BrowserSidebarTabIdentity): void {
    this.closed.push(identity);
  }
}

function makeApi(policyStore?: BrowserUsePolicyReader) {
  const service = new FakeBrowserService();
  const grantDownload = vi.fn();
  const api = new BrowserUseIabApi({
    appSessionId: "app-session-1",
    appVersion: "1.0.0",
    browserService: service as never,
    buildFlavor: "production",
    grantDownload,
    policyStore,
    route: {
      browserConversationId: "conversation-1",
      browserViewScopeId: "scope-1",
      codexSessionId: "thread-1",
      ownerWebContentsId: 7,
      projectId: null,
    },
  });
  return { api, grantDownload, service };
}

describe("BrowserUseIabApi", () => {
  test("filters backend discovery by exact Codex session and keeps history unavailable", async () => {
    const { api } = makeApi();
    expect(api.getInfo({ session_id: "thread-1" })).toMatchObject({
      type: "iab",
      metadata: { codexSessionId: "thread-1" },
    });
    expect(() => api.getInfo({ session_id: "other" })).toThrow("does not own");
    await expect(api.dispatch("getUserHistory", {
      session_id: "thread-1",
      limit: 10,
    })).rejects.toThrow("unavailable");
  });

  test("publishes the exact Codex owner on every runtime tab", async () => {
    const { api, service } = makeApi();
    await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    });

    expect([...service.tabs.values()]).toEqual([
      expect.objectContaining({ codexSessionId: "thread-1" }),
    ]);
  });

  test("checks session ownership before reporting cached-expression state", async () => {
    const { api } = makeApi();
    await expect(api.dispatch("executeCdpWithCachedExpression", {
      expressionCacheKey: "missing-expression",
      method: "Runtime.evaluate",
      session_id: "other",
      target: { tabId: 1 },
    })).rejects.toThrow("does not own");

    await expect(api.dispatch("executeCdpWithCachedExpression", {
      expressionCacheKey: "missing-expression",
      method: "Runtime.evaluate",
      session_id: "thread-1",
      target: { tabId: 1 },
    })).resolves.toEqual({ kind: "cache-miss" });
  });

  test("projects full CDP capability and enforces explicit origin denials", async () => {
    const denied = new Set(["https://denied.example"]);
    const policyStore: BrowserUsePolicyReader = {
      snapshot: () => ({
        approvalMode: "alwaysAsk",
        historyApprovalMode: "alwaysAsk",
        downloadApprovalMode: "alwaysAsk",
        uploadApprovalMode: "alwaysAsk",
        fullCdpAccessEnabled: true,
        allowedOrigins: [],
        deniedOrigins: [...denied],
        allowedDownloadOrigins: [],
        deniedDownloadOrigins: [],
        allowedUploadOrigins: [],
        deniedUploadOrigins: [],
        allowedFullCdpOrigins: [],
        deniedFullCdpOrigins: [],
      }),
      isExplicitlyDenied: (_resource, urlOrOrigin) =>
        denied.has(new URL(urlOrOrigin).origin),
    };
    const { api, service } = makeApi(policyStore);
    expect(api.getInfo({ session_id: "thread-1" })).toMatchObject({
      apiSupportOverrides: { "Tab.cdpCall": true },
      capabilities: {
        tab: expect.arrayContaining([
          expect.objectContaining({ id: "cdp" }),
        ]),
      },
    });

    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    await expect(api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id },
      method: "Page.navigate",
      commandParams: { url: "https://denied.example/path" },
    })).rejects.toThrow("denied by Browser policy");
    expect(service.contents.debugger.commands).not.toContainEqual(
      expect.objectContaining({ method: "Page.navigate" }),
    );

    service.contents.getURL = () => "https://denied.example/current";
    await expect(api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id },
      method: "DOM.setFileInputFiles",
      commandParams: { files: ["/tmp/file.txt"] },
    })).rejects.toThrow("denied by Browser policy");
    await expect(api.dispatch("allowDownload", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      url: "https://denied.example/file.zip",
    })).rejects.toThrow("denied by Browser policy");
  });

  test("maps top-level and frame CDP targets and restores capture surface", async () => {
    const { api, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    await api.dispatch("attachTarget", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      targetId: "frame-target-1",
    });
    await api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id, targetId: "frame-target-1" },
      method: "Runtime.evaluate",
      commandParams: { expression: "1 + 1" },
    });
    expect(service.contents.debugger.commands.at(-1)).toMatchObject({
      method: "Runtime.evaluate",
      sessionId: "frame-session-1",
    });

    const targets = await api.dispatch("executeCdp", {
      session_id: "thread-1",
      target: { tabId: tab.id },
      method: "Target.getTargets",
    }) as { targetInfos: Array<{ targetId: string }> };
    expect(targets.targetInfos.map((target) => target.targetId)).toEqual([
      "browser-use-iab-tab:1",
      "frame-target-1",
    ]);

    await api.dispatch("executeCdp", {
      session_id: "thread-1",
      target: { tabId: tab.id },
      method: "Page.captureScreenshot",
      commandParams: {
        captureBeyondViewport: true,
        clip: {
          height: 1_199.1,
          scale: 1,
          width: 899.1,
          x: 0,
          y: 0,
        },
      },
    });
    expect(service.captures).toEqual([
      expect.objectContaining({ surfaceSize: { height: 1_200, width: 900 } }),
      expect.objectContaining({ surfaceSize: null }),
    ]);
    expect(
      service.contents.debugger.commands.slice(-2).map(({ method }) => method),
    ).toEqual([
      "Page.getLayoutMetrics",
      "Page.captureScreenshot",
    ]);
  });

  test("delegates Browser visibility to host presentation without releasing active control", async () => {
    const { api, service } = makeApi();
    await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    });

    expect(await api.dispatch("executeUnhandledCommand", {
      session_id: "thread-1",
      type: "browser_visibility_get",
    })).toEqual({ visible: false });

    await api.dispatch("executeUnhandledCommand", {
      session_id: "thread-1",
      type: "browser_visibility_set",
      visible: true,
    });
    const browserTabId = service.visibilityChanges.at(-1)?.browserTabId;
    expect(browserTabId).toMatch(/^browser-use:/u);
    expect(service.visibilityChanges.at(-1)).toEqual({
      browserTabId,
      visible: true,
    });
    expect(await api.dispatch("executeUnhandledCommand", {
      session_id: "thread-1",
      type: "browser_visibility_get",
    })).toEqual({ visible: true });

    await api.dispatch("executeUnhandledCommand", {
      session_id: "thread-1",
      type: "browser_visibility_set",
      visible: false,
    });
    expect(service.visibilityChanges.at(-1)).toEqual({
      browserTabId,
      visible: false,
    });
    expect(service.activeTabs.at(-1)).not.toBe(null);
  });

  test("applies visibility and viewport intents issued before the first tab exists", async () => {
    const { api, service } = makeApi();

    await api.dispatch("executeUnhandledCommand", {
      session_id: "thread-1",
      type: "browser_visibility_set",
      visible: true,
    });
    await api.dispatch("executeUnhandledCommand", {
      session_id: "thread-1",
      type: "browser_viewport_set",
      width: 100,
      height: 5_000,
    });
    expect(service.visibilityChanges).toEqual([]);
    expect(service.viewports).toEqual([]);

    await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    });

    const browserTabId = service.visibilityChanges.at(-1)?.browserTabId;
    expect(browserTabId).toMatch(/^browser-use:/u);
    expect(service.visibilityChanges).toEqual([{
      browserTabId,
      visible: true,
    }]);
    expect(service.viewports).toEqual([expect.objectContaining({
      browserTabId,
      viewportSize: { height: 4_096, width: 240 },
    })]);
    expect(service.commands).toEqual([expect.objectContaining({
      browserTabId,
      type: "set-viewport",
      viewport: expect.objectContaining({
        height: 4_096,
        width: 240,
      }),
    })]);
  });

  test("returns a deliverable page to the user-tab inventory after releasing control", async () => {
    const { api } = makeApi();
    const controlled = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };

    await api.dispatch("finalizeTabs", {
      session_id: "thread-1",
      turn_id: "turn-1",
      keep: [{ status: "deliverable", tabId: controlled.id }],
    });

    expect(await api.dispatch("getTabs", {
      session_id: "thread-1",
    })).toEqual([]);
    expect(await api.dispatch("getUserTabs", {
      session_id: "thread-1",
    })).toEqual([
      expect.objectContaining({
        providerTabId: expect.stringMatching(/^browser-use:/u),
      }),
    ]);
  });

  test("uses the host CDP deadline instead of caller timing hints", async () => {
    const { api, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    service.contents.debugger.delays.set("Runtime.evaluate", 10);

    await expect(api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id },
      method: "Runtime.evaluate",
      commandParams: { expression: "document.title" },
      preserveDebuggerOnTimeout: true,
      timeoutMs: 1,
    })).resolves.toEqual({ ok: true });
  });

  test("releases Browser Use control without detaching the page emulation baseline", async () => {
    const { api, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    await api.dispatch("attach", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
    });

    await api.dispatch("detach", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
    });

    expect(service.debuggerReleases).toBe(1);
    expect(service.contents.debugger.isAttached()).toBe(true);
  });

  test("translates top-level input in the guest world while frame input uses CDP", async () => {
    const { api, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    await api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id },
      method: "Input.insertText",
      commandParams: { text: "hello" },
    });
    expect(service.contents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("Input.insertText"),
      false,
    );
    expect(service.contents.debugger.commands).not.toContainEqual(
      expect.objectContaining({ method: "Input.insertText" }),
    );

    await api.dispatch("attachTarget", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      targetId: "frame-target-1",
    });
    await api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id, targetId: "frame-target-1" },
      method: "Input.insertText",
      commandParams: { text: "frame" },
    });
    expect(service.contents.debugger.commands).toContainEqual(
      expect.objectContaining({
        method: "Input.insertText",
        sessionId: "frame-session-1",
      }),
    );
  });

  test("fails closed for unsafe direct and history CDP navigation", async () => {
    const { api, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };

    for (const url of [
      "file:///tmp/private",
      "javascript:alert(1)",
      "https://user:password@example.com/private",
      "chrome://settings",
    ]) {
      await expect(api.dispatch("executeCdp", {
        session_id: "thread-1",
        turn_id: "turn-1",
        target: { tabId: tab.id },
        method: "Page.navigate",
        commandParams: { url },
      })).rejects.toThrow("not allowed");
    }
    expect(service.contents.debugger.commands).not.toContainEqual(
      expect.objectContaining({ method: "Page.navigate" }),
    );

    await api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id },
      method: "Page.navigate",
      commandParams: { url: "https://example.com/safe" },
    });
    expect(service.contents.debugger.commands.at(-1)).toMatchObject({
      method: "Page.navigate",
      params: { url: "https://example.com/safe" },
    });

    await api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id },
      method: "Page.navigateToHistoryEntry",
      commandParams: { entryId: 1 },
    });
    expect(service.contents.debugger.commands.at(-1)).toMatchObject({
      method: "Page.navigateToHistoryEntry",
      params: { entryId: 1 },
    });

    await expect(api.dispatch("executeCdp", {
      session_id: "thread-1",
      turn_id: "turn-1",
      target: { tabId: tab.id },
      method: "Page.navigateToHistoryEntry",
      commandParams: { entryId: 2 },
    })).rejects.toThrow("not allowed");
  });

  test("forwards one-route download grants and deterministic turn finalization", async () => {
    const { api, grantDownload, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    await api.dispatch("allowDownload", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      url: "https://example.com/report.pdf",
    });
    expect(grantDownload).toHaveBeenCalledWith(
      expect.objectContaining({ browserTabId: expect.stringContaining("browser-use:") }),
      "https://example.com/report.pdf",
      10_000,
    );

    await api.dispatch("markTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      status: "deliverable",
    });
    await api.turnEnded({
      session_id: "thread-1",
      turn_id: "turn-1",
    });
    expect(service.released).toHaveLength(1);
    expect(service.closed).toHaveLength(0);
  });

  test("waits for the renderer cursor arrival acknowledgement", async () => {
    const { api, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    service.visible = true;
    let settled = false;
    const moving = api.dispatch("moveMouse", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      waitForArrival: true,
      x: 10,
      y: 20,
    }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const cursor = service.cursors[0] as { moveSequence: number };
    api.notifyCursorArrived(cursor.moveSequence);
    await moving;
    expect(settled).toBe(true);
  });

  test("does not wait for cursor animation while the Browser page is not presented", async () => {
    const { api, service } = makeApi();
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };

    await expect(api.dispatch("moveMouse", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      waitForArrival: true,
      x: 10,
      y: 20,
    })).resolves.toBeUndefined();
    expect(service.cursors).toHaveLength(1);
  });

  test("maps debugger event sessions back to target ids", async () => {
    const { api, service } = makeApi();
    const events: BrowserUseCdpEvent[] = [];
    api.addCdpEventListener((event) => events.push(event));
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    await api.dispatch("attachTarget", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
      targetId: "frame-target-1",
    });
    service.contents.debugger.emit(
      "message",
      {},
      "Runtime.consoleAPICalled",
      { type: "log" },
      "frame-session-1",
    );
    expect(events[0]).toMatchObject({
      source: {
        sessionId: "frame-session-1",
        tabId: 1,
        targetId: "frame-target-1",
      },
    });
  });

  test("normalizes Electron's empty top-level debugger session id", async () => {
    const { api, service } = makeApi();
    const events: BrowserUseCdpEvent[] = [];
    api.addCdpEventListener((event) => events.push(event));
    const tab = await api.dispatch("createTab", {
      session_id: "thread-1",
      turn_id: "turn-1",
    }) as { id: number };
    await api.dispatch("attach", {
      session_id: "thread-1",
      turn_id: "turn-1",
      tabId: tab.id,
    });

    service.contents.debugger.emit(
      "message",
      {},
      "Page.loadEventFired",
      { timestamp: 1 },
      "",
    );

    expect(events).toEqual([{
      method: "Page.loadEventFired",
      params: { timestamp: 1 },
      source: { tabId: 1 },
    }]);
  });
});
