import { describe, expect, vi, test } from "vite-plus/test";
import { EventEmitter } from "node:events";
import type { MenuItemConstructorOptions } from "electron";
import type {
  BrowserSidebarCommandResult,
  BrowserSidebarContextMenuActionEvent,
  BrowserSidebarTabIdentity,
  BrowserUsePresentationRequest,
} from "../shared/browser-sidebar";
import type { BrowserPageSnapshotStore, BrowserSerializedPage } from "./browser/browser-page-store";
import type {
  BrowserSidebarEvent,
  BrowserSidebarEventPublisher,
} from "./browser/BrowserSidebarEventHub";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeImage: () => undefined },
  Notification: class Notification {
    static isSupported() {
      return true;
    }
  },
  session: {
    fromPartition: () => ({ clearCache: async () => undefined, clearData: async () => undefined }),
  },
  shell: { openExternal: async () => undefined },
  webContents: { fromId: () => undefined },
}));

const { BrowserSidebarService } = await import("./browser-sidebar-service");
type BrowserSidebarServiceInstance = InstanceType<typeof BrowserSidebarService>;

class TestBrowserSidebarEvents implements BrowserSidebarEventPublisher {
  private readonly listeners = new Map<BrowserSidebarEvent["kind"], Set<(value: never) => void>>();

  publish(event: BrowserSidebarEvent): void {
    for (const listener of [...(this.listeners.get(event.kind) ?? [])]) {
      listener(event.value as never);
    }
  }

  subscribe<Kind extends BrowserSidebarEvent["kind"]>(
    kind: Kind,
    listener: (value: Extract<BrowserSidebarEvent, { readonly kind: Kind }>["value"]) => void,
  ): () => void {
    const listeners = this.listeners.get(kind) ?? new Set<(value: never) => void>();
    listeners.add(listener as (value: never) => void);
    this.listeners.set(kind, listeners);
    return () => listeners.delete(listener as (value: never) => void);
  }

  onceContextMenuAction(listener: (value: BrowserSidebarContextMenuActionEvent) => void): void {
    let release: () => void = () => undefined;
    release = this.subscribe("contextMenuAction", (value) => {
      release();
      listener(value);
    });
  }
}

const browserIdentity = {
  browserConversationId: "session-1",
  browserViewScopeId: "window-session-1",
  browserTabId: "tab-browser",
} as const;

class FakeWebContents extends EventEmitter {
  id = 101;
  debuggerAttached = false;
  debuggerAttachCalls: Array<string | undefined> = [];
  debuggerDetachCalls = 0;
  debuggerCommands: Array<{
    method: string;
    params?: Record<string, unknown>;
  }> = [];
  debugger = {
    attach: (protocolVersion?: string) => {
      this.debuggerAttachCalls.push(protocolVersion);
      this.debuggerAttached = true;
    },
    detach: () => {
      this.debuggerDetachCalls += 1;
      this.debuggerAttached = false;
    },
    isAttached: () => this.debuggerAttached,
    sendCommand: async (method: string, params?: Record<string, unknown>) => {
      this.debuggerCommands.push({ method, params });
    },
  };
  loadUrls: string[] = [];
  reloads = 0;
  hardReloads = 0;
  windowOpenHandlerCalls = 0;
  windowOpenHandler:
    | ((details: { disposition: string; url: string }) => { action: string })
    | null = null;
  url = "about:blank";
  title = "New tab";
  loading = false;
  destroyed = false;
  loadPromise: Promise<void> | null = null;
  rejectLoadWith: unknown = null;
  zoomFactors: number[] = [];
  findCalls: Array<{
    text: string;
    options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean };
  }> = [];
  inspectedPoints: Array<{ x: number; y: number }> = [];
  sentMessages: Array<{ channel: string; payload: unknown }> = [];
  stopFindActions: string[] = [];
  historyEntries: BrowserSerializedPage["navigation"]["entries"] = [
    {
      title: "New tab",
      url: "about:blank",
    },
  ];
  historyActiveIndex = 0;
  restoredHistory: BrowserSerializedPage["navigation"] | null = null;
  navigationHistory = {
    getActiveIndex: () => this.historyActiveIndex,
    getAllEntries: () => this.historyEntries,
    restore: async (options: {
      entries: BrowserSerializedPage["navigation"]["entries"];
      index?: number;
    }) => {
      const currentIndex = options.index ?? options.entries.length - 1;
      this.restoredHistory = {
        currentIndex,
        entries: options.entries,
      };
      this.historyEntries = options.entries;
      this.historyActiveIndex = currentIndex;
      const active = options.entries[currentIndex];
      if (!active) return;
      this.url = active.url;
      this.title = active.title;
    },
  };
  session = {
    fetch: async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "image/png" },
      }),
  };

  canGoBack() {
    return false;
  }
  canGoForward() {
    return false;
  }
  capturePage() {
    return Promise.resolve({ toDataURL: () => "data:image/png;base64,test" });
  }
  getTitle() {
    return this.title;
  }
  getURL() {
    return this.url;
  }
  goBack() {}
  goForward() {}
  isDestroyed() {
    return this.destroyed;
  }
  isLoading() {
    return this.loading;
  }
  inspectElement(x: number, y: number) {
    this.inspectedPoints.push({ x, y });
  }
  loadURL(url: string) {
    this.loadUrls.push(url);
    this.url = url;
    if (this.rejectLoadWith) return Promise.reject(this.rejectLoadWith);
    if (this.loadPromise) return this.loadPromise;
    return Promise.resolve();
  }
  reload() {
    this.reloads += 1;
  }
  reloadIgnoringCache() {
    this.hardReloads += 1;
  }
  send(channel: string, payload: unknown) {
    this.sentMessages.push({ channel, payload });
  }
  setWindowOpenHandler(
    handler: (details: { disposition: string; url: string }) => {
      action: string;
    },
  ) {
    this.windowOpenHandlerCalls += 1;
    this.windowOpenHandler = handler;
  }
  setZoomFactor(factor: number) {
    this.zoomFactors.push(factor);
  }
  findInPage(
    text: string,
    options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
  ) {
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

class MemoryPageStore implements BrowserPageSnapshotStore {
  readonly pages = new Map<string, BrowserSerializedPage>();

  async get(browserStorageId: string) {
    return this.pages.get(browserStorageId) ?? null;
  }

  async set(page: BrowserSerializedPage) {
    this.pages.set(page.browserStorageId, page);
  }

  async delete(browserStorageId: string) {
    this.pages.delete(browserStorageId);
  }

  async clear() {
    this.pages.clear();
  }

  async reassociate(sourceStorageId: string, targetStorageId: string) {
    const page = this.pages.get(sourceStorageId);
    if (!page) return;
    this.pages.delete(sourceStorageId);
    this.pages.set(targetStorageId, {
      ...page,
      browserStorageId: targetStorageId,
    });
  }
}

function createService(
  contentsById = new Map<number, FakeWebContents>(),
  pageStore?: BrowserPageSnapshotStore,
  siteStatusPolicy?: {
    cachedCommentModeBlocked(url: string): boolean | null;
    isCommentModeBlocked(url: string): Promise<boolean>;
  },
  contextMenuPresenter?: (
    template: MenuItemConstructorOptions[],
    ownerWebContentsId: number,
  ) => void,
  saveBrowserImage?: NonNullable<
    ConstructorParameters<typeof BrowserSidebarService>[0]
  >["saveBrowserImage"],
) {
  const testEvents = new TestBrowserSidebarEvents();
  const service = new BrowserSidebarService({
    contextMenuPresenter,
    electron: {
      clipboard: {
        writeImage: () => undefined,
        writeText: () => undefined,
      },
      session: {
        fromPartition: (() => ({
          clearCache: async () => undefined,
          clearData: async () => undefined,
        })) as never,
      },
      shell: {
        openExternal: async () => undefined,
      },
      webContents: {
        fromId: (id) => (contentsById.get(id) as never) ?? null,
      },
    },
    events: testEvents,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    pageStore,
    saveBrowserImage,
    siteStatusPolicy,
  });
  return Object.assign(service, { testEvents });
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
  const tab = service
    .getStateSnapshot()
    .tabs.find(
      (item) =>
        item.browserConversationId === identity.browserConversationId &&
        item.browserViewScopeId === identity.browserViewScopeId &&
        item.browserTabId === identity.browserTabId,
    );
  if (!tab) throw new Error("Missing browser tab snapshot");
  return tab;
}

async function flushLoadPromise() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushPageEmulation() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BrowserSidebarService webview lifecycle", () => {
  test("attaches a dragged Browser image only for the exact owner and tab", async () => {
    const contents = new FakeWebContents();
    const saveBrowserImage = vi.fn(() => ({
      fileName: "managed-image.png",
      source: "nodex://assets/managed-image.png",
    }));
    const service = createService(
      new Map([[101, contents]]),
      undefined,
      undefined,
      undefined,
      saveBrowserImage,
    );
    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:image-drag",
      projectId: "alpha",
      initialUrl: "https://example.com/page",
    });
    service.registerAttachedWebviewOwnership(501, 101, browserIdentity, "browser:image-drag");
    await service.handleWebviewHostCreated(
      {
        ...browserIdentity,
        browserStorageId: "browser:image-drag",
        projectId: "alpha",
        hostKind: "panel",
        mountGeneration: 1,
        webContentsId: 101,
        initialUrl: "https://example.com/page",
      },
      501,
    );
    const dragStates: unknown[] = [];
    const attachmentEvents: unknown[] = [];
    service.testEvents.subscribe("imageDragState", (event) => dragStates.push(event));
    service.testEvents.subscribe("contextMenuAction", (event) => attachmentEvents.push(event));

    expect(service.startBrowserImageDrag(101, "https://example.com/image.png")).toBe(true);
    await expect(
      service.handleCommand(
        {
          type: "attach-dragged-image",
          ...browserIdentity,
        },
        { ownerWebContentsId: 999 },
      ),
    ).resolves.toEqual({
      ok: false,
      message: "No matching Browser image drag is active",
    });

    await expect(
      service.handleCommand(
        {
          type: "attach-dragged-image",
          ...browserIdentity,
        },
        { ownerWebContentsId: 501 },
      ),
    ).resolves.toEqual({ ok: true });
    expect(saveBrowserImage).toHaveBeenCalledWith({
      name: "image.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1]),
    });
    expect(dragStates).toEqual([
      { ...browserIdentity, isActive: true },
      { ...browserIdentity, isActive: false },
    ]);
    expect(attachmentEvents).toEqual([
      {
        ...browserIdentity,
        action: "image-attached",
        attachment: {
          id: "managed-image.png",
          fileName: "image.png",
          source: "nodex://assets/managed-image.png",
        },
      },
    ]);
  });

  test("owns Browser context-menu actions and routes quick annotation to the guest", async () => {
    const contents = new FakeWebContents();
    const presentedMenus: MenuItemConstructorOptions[][] = [];
    const service = createService(
      new Map([[101, contents]]),
      undefined,
      undefined,
      (template, ownerWebContentsId) => {
        expect(ownerWebContentsId).toBe(501);
        presentedMenus.push(template);
      },
    );
    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:context-menu",
      projectId: "alpha",
      initialUrl: "https://example.com",
    });
    service.registerAttachedWebviewOwnership(501, 101, browserIdentity, "browser:context-menu");
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      browserStorageId: "browser:context-menu",
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });
    await service.handleCommand({
      type: "set-zoom-percent",
      ...browserIdentity,
      zoomPercent: 200,
    });

    const actionPromise = new Promise<BrowserSidebarContextMenuActionEvent>((resolve) => {
      service.testEvents.onceContextMenuAction((event) => resolve(event));
    });
    contents.emit(
      "context-menu",
      {},
      {
        x: 40,
        y: 80,
        linkURL: "",
        srcURL: "",
        mediaType: "none",
        hasImageContents: false,
        isEditable: false,
        selectionText: "",
        formControlType: "none",
        editFlags: {
          canCopy: false,
          canCut: false,
          canPaste: false,
        },
      },
    );

    expect(presentedMenus).toHaveLength(1);
    const quickAnnotate = presentedMenus[0]?.find((item) => item.label === "Quick annotate");
    quickAnnotate?.click?.({} as never, undefined, {} as never);
    await expect(actionPromise).resolves.toMatchObject({
      ...browserIdentity,
      action: "quick-annotate",
      point: { x: 20, y: 40 },
    });

    const result = await service.handleCommand({
      type: "quick-annotate",
      ...browserIdentity,
      sessionId: "annotation-session",
      point: { x: 20, y: 40 },
    });
    expect(result.ok).toBe(true);
    expect(contents.sentMessages).toEqual([
      {
        channel: "browser-annotation-mode",
        payload: {
          enabled: true,
          selectionMode: "inspect",
          sessionId: "annotation-session",
        },
      },
      {
        channel: "browser-annotation-quick-select",
        payload: {
          sessionId: "annotation-session",
          x: 20,
          y: 40,
        },
      },
    ]);
    expect(readTab(service).interactionMode).toBe("comment");
  });

  test("restores durable navigation history by browser storage identity", async () => {
    const contents = new FakeWebContents();
    const pageStore = new MemoryPageStore();
    pageStore.pages.set("browser:durable", {
      schemaVersion: 1,
      runtime: "electron-webview",
      browserStorageId: "browser:durable",
      identity: browserIdentity,
      title: "Second",
      url: "https://example.com/second",
      updatedAt: 1,
      navigation: {
        currentIndex: 1,
        entries: [
          { title: "First", url: "https://example.com/first", pageState: "first-state" },
          { title: "Second", url: "https://example.com/second", pageState: "second-state" },
        ],
      },
    });
    const service = createService(new Map([[101, contents]]), pageStore);
    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      initialUrl: "about:blank",
    });
    service.prepareAttachedWebviewHistoryRestore(
      {
        ...browserIdentity,
        browserStorageId: "browser:durable",
        rendererInstanceId: "renderer-1",
        hostGeneration: 1,
        mountGeneration: 1,
      },
      101,
    );
    expect(contents.restoredHistory?.currentIndex).toBe(1);

    const result = await service.handleWebviewHostCreated({
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com/second",
    });

    expect(result.ok).toBe(true);
    expect(contents.restoredHistory?.currentIndex).toBe(1);
    expect(contents.restoredHistory?.entries).toHaveLength(2);
    expect(readTab(service)).toMatchObject({
      url: "https://example.com/second",
      title: "Second",
      lifecycleState: "live-attached",
      restoreResult: "snapshot-ready",
    });
  });

  test("persists committed navigation and deletes it on explicit close", async () => {
    const contents = new FakeWebContents();
    const pageStore = new MemoryPageStore();
    const service = createService(new Map([[101, contents]]), pageStore);
    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      initialUrl: "https://example.com/first",
    });
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com/first",
    });
    contents.historyEntries = [
      { title: "First", url: "https://example.com/first" },
      { title: "Second", url: "https://example.com/second", pageState: "state" },
    ];
    contents.historyActiveIndex = 1;
    contents.url = "https://example.com/second";
    contents.title = "Second";
    contents.emit("did-stop-loading");
    await flushLoadPromise();

    expect(pageStore.pages.get("browser:durable")).toMatchObject({
      browserStorageId: "browser:durable",
      navigation: {
        currentIndex: 1,
      },
    });

    await service.handleCommand({ type: "close-tab", ...browserIdentity });
    await flushLoadPromise();
    expect(pageStore.pages.has("browser:durable")).toBe(false);
  });

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

  test("adopts a durable storage identity before a provisional tab attaches", async () => {
    const service = createService();
    await registerTab(service);

    const result = await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      initialUrl: "https://www.google.com",
      title: "Browser",
    });

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        browserStorageId: "browser:durable",
      },
    });
    expect(readTab(service).browserStorageId).toBe("browser:durable");
  });

  test("binds host registration to the tab's Main-owned storage identity", async () => {
    const service = createService();
    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      initialUrl: "https://www.google.com",
      title: "Browser",
    });
    await service.handleCommand(
      {
        type: "register-renderer-session",
        browserViewScopeId: browserIdentity.browserViewScopeId,
        rendererInstanceId: "renderer-1",
      },
      {
        ownerWebContentsId: 7,
      },
    );

    const host = {
      type: "register-host" as const,
      ...browserIdentity,
      rendererInstanceId: "renderer-1",
      hostGeneration: 1,
      mountGeneration: 1,
      hostKind: "panel" as const,
      pagePersistence: "durable" as const,
      themeVariant: "light" as const,
    };
    expect(
      await service.handleCommand(
        {
          ...host,
          browserStorageId: "browser:forged",
        },
        {
          ownerWebContentsId: 7,
        },
      ),
    ).toEqual({
      ok: false,
      message: "Browser host registration failed: storage-identity-mismatch",
    });
    expect(
      await service.handleCommand(
        {
          ...host,
          browserStorageId: "browser:durable",
        },
        {
          ownerWebContentsId: 7,
        },
      ),
    ).toEqual({ ok: true });
  });

  test("emulates the current app color scheme on the attached page and ignores stale hosts", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      initialUrl: "https://www.google.com",
      title: "Browser",
    });
    await service.handleCommand(
      {
        type: "register-renderer-session",
        browserViewScopeId: browserIdentity.browserViewScopeId,
        rendererInstanceId: "renderer-1",
      },
      {
        ownerWebContentsId: 7,
      },
    );
    const hostRoute = {
      ...browserIdentity,
      browserStorageId: "browser:durable",
      rendererInstanceId: "renderer-1",
      hostGeneration: 1,
      mountGeneration: 1,
    };
    await expect(
      service.handleCommand(
        {
          type: "register-host",
          ...hostRoute,
          hostKind: "panel",
          pagePersistence: "durable",
          themeVariant: "dark",
        },
        {
          ownerWebContentsId: 7,
        },
      ),
    ).resolves.toEqual({ ok: true });
    service.registerAttachedWebviewOwnership(7, 101, hostRoute, hostRoute.browserStorageId);
    const cursorStates: Array<{ animateMovement?: boolean; moveSequence: number }> = [];
    service.testEvents.subscribe("browserUseCursor", (cursor) => {
      cursorStates.push(cursor);
    });
    expect(
      service.setBrowserUseCursor({
        ...browserIdentity,
        moveSequence: 1,
        visible: true,
        updatedAt: 1,
        x: 10,
        y: 20,
      }),
    ).toBe(false);
    expect(cursorStates.at(-1)).toMatchObject({
      animateMovement: false,
      moveSequence: 1,
    });

    await service.handleWebviewHostCreated(
      {
        ...hostRoute,
        projectId: "alpha",
        hostKind: "panel",
        webContentsId: 101,
        initialUrl: "https://www.google.com",
      },
      7,
    );
    await flushPageEmulation();

    expect(contents.debuggerCommands).toContainEqual({
      method: "Emulation.setEmulatedMedia",
      params: {
        features: [
          {
            name: "prefers-color-scheme",
            value: "dark",
          },
        ],
      },
    });
    expect(contents.debuggerAttached).toBe(true);
    expect(contents.debuggerDetachCalls).toBe(0);
    service.releaseBrowserUseDebugger(contents as never);
    expect(contents.debuggerAttached).toBe(true);
    expect(contents.debuggerDetachCalls).toBe(0);

    contents.debuggerCommands = [];
    await service.handleCommand(
      {
        type: "sync-host",
        ...browserIdentity,
        rendererInstanceId: "renderer-1",
        hostGeneration: 1,
        mountGeneration: 1,
        hostKind: "panel",
        presented: true,
        themeVariant: "light",
        visible: true,
      },
      {
        ownerWebContentsId: 7,
      },
    );
    await flushPageEmulation();
    expect(
      service.setBrowserUseCursor({
        ...browserIdentity,
        moveSequence: 2,
        visible: true,
        updatedAt: 2,
        x: 30,
        y: 40,
      }),
    ).toBe(true);
    expect(cursorStates.at(-1)).toMatchObject({
      animateMovement: true,
      moveSequence: 2,
    });
    expect(contents.debuggerCommands).toEqual([
      {
        method: "Emulation.setEmulatedMedia",
        params: {
          features: [
            {
              name: "prefers-color-scheme",
              value: "light",
            },
          ],
        },
      },
    ]);

    contents.debuggerCommands = [];
    await service.handleCommand(
      {
        type: "sync-theme",
        themeVariant: "dark",
      },
      {
        browserViewScopeId: browserIdentity.browserViewScopeId,
        ownerWebContentsId: 7,
      },
    );
    await flushPageEmulation();
    expect(contents.debuggerCommands).toEqual([
      {
        method: "Emulation.setEmulatedMedia",
        params: {
          features: [
            {
              name: "prefers-color-scheme",
              value: "dark",
            },
          ],
        },
      },
    ]);

    contents.debuggerCommands = [];
    await service.handleCommand(
      {
        type: "sync-host",
        ...browserIdentity,
        rendererInstanceId: "renderer-1",
        hostGeneration: 1,
        mountGeneration: 2,
        hostKind: "background",
        presented: false,
        themeVariant: "light",
        visible: false,
      },
      {
        ownerWebContentsId: 7,
      },
    );
    expect(contents.debuggerCommands).toEqual([]);
    expect(readTab(service)).toMatchObject({
      presented: true,
      visible: true,
    });
  });

  test("does not change storage identity after the Browser guest attaches", async () => {
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

    const result = await service.handleCommand({
      type: "register-tab",
      ...browserIdentity,
      browserStorageId: "browser:durable",
      projectId: "alpha",
      initialUrl: "https://www.google.com",
      title: "Browser",
    });

    expect(result).toEqual({
      ok: false,
      message: "Browser storage identity does not match the registered tab",
    });
    expect(readTab(service).browserStorageId).toBe("browser:legacy:tab-browser");
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
    contents.rejectLoadWith = Object.assign(
      new Error("ERR_ABORTED (-3) loading 'https://www.google.com/'"),
      {
        code: "ERR_ABORTED",
        errno: -3,
      },
    );

    const result = (await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://www.google.com",
      source: "manual",
      initiator: "address_bar",
    })) as BrowserSidebarCommandResult;
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

    const result = await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://example.test",
    });
    await flushLoadPromise();

    expect(result.ok).toBe(true);
    expect(readTab(service).errorMessage).toBe("DNS failure");
  });

  test("rejects unsafe navigation schemes before they reach Electron", async () => {
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

    const result = await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "javascript:alert(document.cookie)",
    });

    expect(result).toEqual({
      ok: false,
      message: "This URL is not allowed in the built-in Browser",
    });
    expect(contents.loadUrls).toEqual([]);
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

  test("publishes waiting, loading, and settled navigation phases in order", async () => {
    const contents = new FakeWebContents();
    let resolveLoad: (() => void) | undefined;
    contents.loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
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

    const result = await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://example.com",
      source: "manual",
      initiator: "address_bar",
    });
    expect(result.ok).toBe(true);
    expect(readTab(service)).toMatchObject({
      isLoading: true,
      isWaitingForResponse: true,
    });

    contents.loading = true;
    contents.emit("did-start-loading");
    expect(readTab(service)).toMatchObject({
      isLoading: true,
      isWaitingForResponse: true,
    });

    contents.url = "https://example.com/";
    contents.emit("did-navigate", {}, contents.url);
    expect(readTab(service)).toMatchObject({
      isLoading: true,
      isWaitingForResponse: false,
    });

    contents.loading = false;
    contents.emit("did-stop-loading");
    expect(readTab(service)).toMatchObject({
      isLoading: false,
      isWaitingForResponse: false,
    });

    resolveLoad?.();
    await flushLoadPromise();
  });

  test("rejects a guest that was not attached by the requesting window", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    service.registerAttachedWebviewOwnership(7, 101, browserIdentity);

    const rejected = await service.handleWebviewHostCreated(
      {
        ...browserIdentity,
        projectId: "alpha",
        hostKind: "panel",
        mountGeneration: 1,
        webContentsId: 101,
        initialUrl: "about:blank",
      },
      8,
    );
    expect(rejected).toEqual({
      ok: false,
      message: "Browser webview does not belong to the requesting window",
    });
    expect(readTab(service).webContentsId).toBe(null);

    const accepted = await service.handleWebviewHostCreated(
      {
        ...browserIdentity,
        projectId: "alpha",
        hostKind: "panel",
        mountGeneration: 1,
        webContentsId: 101,
        initialUrl: "about:blank",
      },
      7,
    );
    expect(accepted.ok).toBe(true);
    expect(readTab(service).webContentsId).toBe(101);
  });

  test("keeps one attached guest authorized across host mount transfers", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    const browserStorageId = readTab(service).browserStorageId;
    if (!browserStorageId) throw new Error("Expected Browser storage identity");
    const attachedRoute = {
      ...browserIdentity,
      browserStorageId,
      rendererInstanceId: "renderer-1",
      hostGeneration: 1,
      mountGeneration: 1,
    };
    service.registerAttachedWebviewOwnership(7, 101, attachedRoute, browserStorageId);

    const transferred = await service.handleWebviewHostCreated(
      {
        ...attachedRoute,
        mountGeneration: 2,
        projectId: "alpha",
        hostKind: "panel",
        webContentsId: 101,
        initialUrl: "about:blank",
      },
      7,
    );

    expect(transferred.ok).toBe(true);
    expect(readTab(service)).toMatchObject({
      mountGeneration: 2,
      webContentsId: 101,
    });
  });

  test("destroy acks are generation-safe", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    const pendingDestroys: import("../shared/browser-sidebar").BrowserSidebarDestroyWebviewRequest[] =
      [];
    service.testEvents.subscribe("destroyWebview", (request) => {
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
      disposition: "destroyed",
      webContentsId: 101,
    });
    expect(readTab(service).webContentsId).toBe(101);

    const pendingDestroy = pendingDestroys.at(-1);
    if (!pendingDestroy) throw new Error("Missing pending teardown request");
    await service.handleWebviewDestroyed({
      ...pendingDestroy,
      disposition: "destroyed",
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

    await service.handleCommand({
      type: "set-interaction-mode",
      ...browserIdentity,
      mode: "comment",
    });
    await service.handleCommand({ type: "open-find", ...browserIdentity });
    await service.handleCommand({
      type: "set-find-query",
      ...browserIdentity,
      query: "hello",
      caseSensitive: true,
    });
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

  test("turns safe popups into adjacent Browser tab requests", async () => {
    const contents = new FakeWebContents();
    const service = createService(new Map([[101, contents]]));
    await registerTab(service);
    service.registerAttachedWebviewOwnership(7, 101, browserIdentity);
    await service.handleWebviewHostCreated({
      ...browserIdentity,
      projectId: "alpha",
      hostKind: "panel",
      mountGeneration: 1,
      webContentsId: 101,
      initialUrl: "https://example.com",
    });
    const requests: unknown[] = [];
    service.testEvents.subscribe("openNewTab", (request) => requests.push(request));

    expect(
      contents.windowOpenHandler?.({
        disposition: "background-tab",
        url: "https://example.com/child",
      }),
    ).toEqual({ action: "deny" });
    expect(requests).toEqual([
      {
        ...browserIdentity,
        url: "https://example.com/child",
        background: true,
      },
    ]);

    contents.windowOpenHandler?.({
      disposition: "foreground-tab",
      url: "javascript:alert(1)",
    });
    expect(requests).toHaveLength(1);
  });

  test("consults the site-status policy before entering comment mode", async () => {
    const isCommentModeBlocked = vi.fn(async (url: string) => url === "https://blocked.example/");
    const service = createService(new Map(), undefined, {
      cachedCommentModeBlocked: () => null,
      isCommentModeBlocked,
    });
    await registerTab(service);
    await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://blocked.example/",
    });

    const blocked = await service.handleCommand({
      type: "set-interaction-mode",
      ...browserIdentity,
      mode: "comment",
    });
    expect(blocked).toEqual({
      ok: false,
      message: "Comment mode is unavailable for this site.",
    });
    expect(readTab(service).interactionMode).toBe("browse");

    await service.handleCommand({
      type: "navigate",
      ...browserIdentity,
      url: "https://allowed.example/",
    });
    const allowed = await service.handleCommand({
      type: "set-interaction-mode",
      ...browserIdentity,
      mode: "comment",
    });
    expect(allowed.ok).toBe(true);
    expect(readTab(service).interactionMode).toBe("comment");
    expect(isCommentModeBlocked).toHaveBeenNthCalledWith(1, "https://blocked.example/");
    expect(isCommentModeBlocked).toHaveBeenNthCalledWith(2, "https://allowed.example/");
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
    expect(
      JSON.stringify(
        service.getConversationBrowserTabIds("session-1", browserIdentity.browserViewScopeId),
      ),
    ).toBe(JSON.stringify([]));

    await service.handleCommand({ type: "close-tab", ...browserIdentity });

    expect(service.getStateSnapshot().tabs.length).toBe(1);
    expect(readTab(service, otherIdentity).url).toBe("https://two.example");
  });

  test("browser-use commands emit split viewport, cursor, and release events", async () => {
    const service = createService();
    let viewportEvent = "";
    const cursorEvents: string[] = [];
    let releasedEvent = "";
    const closedEvents: string[] = [];
    service.testEvents.subscribe("browserUseViewport", (payload) => {
      viewportEvent = `${payload.browserConversationId}/${payload.browserTabId}:${payload.viewportSize?.width ?? 0}x${payload.viewportSize?.height ?? 0}`;
    });
    service.testEvents.subscribe("browserUseCursor", (payload) => {
      cursorEvents.push(
        `${payload.browserConversationId}/${payload.browserTabId}:${payload.x},${payload.y}:${payload.visible}`,
      );
    });
    service.testEvents.subscribe("pageReleased", (payload) => {
      releasedEvent = `${payload.browserConversationId}/${payload.browserTabId}`;
    });
    service.testEvents.subscribe("pageClosed", (payload) => {
      closedEvents.push(
        `${payload.browserConversationId}/${payload.browserTabId}:${payload.reason}`,
      );
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
      cursor: {
        ...browserIdentity,
        moveSequence: 1,
        x: 12,
        y: 34,
        visible: true,
        updatedAt: 1,
      },
    });
    await service.handleCommand({
      type: "browser-use-set-cursor",
      cursor: {
        browserConversationId: "session-2",
        browserViewScopeId: "window-session-2",
        browserTabId: browserIdentity.browserTabId,
        moveSequence: 2,
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
        codexSessionId: "thread-1",
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
    expect(JSON.stringify(cursorEvents)).toBe(
      JSON.stringify([
        "session-1/tab-browser:12,34:true",
        "session-2/tab-browser:98,76:false",
        "session-1/tab-browser:12,34:false",
      ]),
    );
    expect(releasedEvent).toBe("session-1/tab-browser");
    expect(closedEvents).toEqual([]);
    expect(
      service.getBrowserUseStateSnapshot().activeBrowserTabIdsByConversationScope[
        `session-1\0${browserIdentity.browserViewScopeId}`
      ] === undefined,
    ).toBe(true);
    expect(JSON.stringify(service.getBrowserUseStateSnapshot().cursors)).toBe(
      JSON.stringify([
        {
          browserConversationId: "session-2",
          browserViewScopeId: "window-session-2",
          browserTabId: "tab-browser",
          moveSequence: 2,
          x: 98,
          y: 76,
          visible: false,
          updatedAt: 2,
        },
      ]),
    );
    expect(readTab(service).url).toBe("https://ordinary.example");
    expect(readTab(service).deviceToolbarVisible).toBe(true);
    expect(readTab(service).deviceToolbarState.toolbarState.isEnabled).toBe(true);
    expect(service.getDeviceToolbarTabState(browserIdentity).toolbarState.isEnabled).toBe(false);

    await service.handleCommand({ type: "close-tab", ...browserIdentity });
    expect(closedEvents).toEqual(["session-1/tab-browser:user"]);
  });

  test("tracks Browser Use presentation separately from active control", async () => {
    const service = createService();
    const route = {
      browserConversationId: browserIdentity.browserConversationId,
      browserViewScopeId: browserIdentity.browserViewScopeId,
      codexSessionId: "thread-1",
      ownerWebContentsId: 7,
      projectId: "alpha",
    };
    const requests: BrowserUsePresentationRequest[] = [];
    service.testEvents.subscribe("browserUsePresentationRequest", (request) => {
      requests.push(request);
    });

    await service.handleCommand(
      {
        type: "capture-browser-use-route",
        browserConversationId: route.browserConversationId,
        browserViewScopeId: route.browserViewScopeId,
        codexSessionId: route.codexSessionId,
        projectId: route.projectId,
      },
      {
        ownerWebContentsId: route.ownerWebContentsId,
      },
    );
    await service.handleCommand({
      type: "browser-use-upsert-tab",
      tab: {
        ...browserIdentity,
        codexSessionId: route.codexSessionId,
        projectId: "alpha",
        title: "Browser",
        url: "https://example.com",
        webContentsId: null,
        viewport: {
          width: 1_280,
          height: 720,
          zoomPercent: 100,
          presetId: "browser-use",
        },
        captureActive: true,
        released: false,
        updatedAt: 1,
      },
    });

    service.setBrowserVisibleForBrowserUse(route, browserIdentity.browserTabId, true);
    expect(requests.at(-1)).toMatchObject({
      transition: "default",
      visible: true,
    });
    expect(service.isBrowserVisibleForBrowserUse(route, browserIdentity.browserTabId)).toBe(true);

    service.setBrowserVisibleForBrowserUse(route, browserIdentity.browserTabId, false);
    expect(requests.at(-1)).toMatchObject({ visible: false });
    expect(service.isBrowserVisibleForBrowserUse(route, browserIdentity.browserTabId)).toBe(false);
    expect(
      service.getBrowserUseStateSnapshot().activeBrowserTabIdsByConversationScope[
        `session-1\0${browserIdentity.browserViewScopeId}`
      ],
    ).toBe(browserIdentity.browserTabId);

    const staleRequest = requests.find((request) => request.visible);
    expect(staleRequest).toBeDefined();
    service.setBrowserVisibleForBrowserUse(route, browserIdentity.browserTabId, true);
    const currentRequest = requests.at(-1);
    expect(currentRequest?.requestId).not.toBe(staleRequest?.requestId);
    service.resolveBrowserUsePresentation({
      ...browserIdentity,
      requestId: staleRequest?.requestId ?? "missing",
      outcome: "unavailable",
    });
    expect(service.listPendingBrowserUsePresentationRequests(route.browserViewScopeId)).toEqual([
      currentRequest,
    ]);
  });

  test("awaits explicit route capture and never binds Browser Use while registering tabs", async () => {
    const service = createService();
    let releaseCapture: () => void = () => undefined;
    const captureHandler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCapture = resolve;
        }),
    );
    service.setBrowserUseRouteCaptureHandler(captureHandler);

    let settled = false;
    const capture = service
      .handleCommand(
        {
          type: "capture-browser-use-route",
          browserConversationId: "project:alpha",
          browserViewScopeId: "window-session-1",
          codexSessionId: "project-session-1",
          projectId: "alpha",
        },
        { ownerWebContentsId: 7 },
      )
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(captureHandler).toHaveBeenCalledWith({
      browserConversationId: "project:alpha",
      browserViewScopeId: "window-session-1",
      codexSessionId: "project-session-1",
      ownerWebContentsId: 7,
      projectId: "alpha",
    });

    releaseCapture();
    await expect(capture).resolves.toEqual({ ok: true });
    await service.handleCommand({
      type: "register-tab",
      browserConversationId: "project:alpha",
      browserViewScopeId: "window-session-1",
      browserTabId: "manual-tab",
      projectId: "alpha",
      initialUrl: "https://example.com",
    });
    expect(captureHandler).toHaveBeenCalledTimes(1);

    const promoteHandler = vi.fn(async () => undefined);
    service.setBrowserUseRouteCaptureHandler(promoteHandler);
    await service.promoteBrowserUseRoute({
      browserConversationId: "project:alpha",
      browserViewScopeId: "window-session-1",
      codexSessionId: "thread-real",
      projectId: "alpha",
    });
    expect(promoteHandler).toHaveBeenCalledWith({
      browserConversationId: "project:alpha",
      browserViewScopeId: "window-session-1",
      codexSessionId: "thread-real",
      ownerWebContentsId: 7,
      projectId: "alpha",
    });

    service.setBrowserUseRouteCaptureHandler(async () => {
      throw new Error("route is busy");
    });
    await expect(
      service.handleCommand(
        {
          type: "capture-browser-use-route",
          browserConversationId: "project:beta",
          browserViewScopeId: "window-session-1",
          codexSessionId: "project-session-2",
          projectId: "beta",
        },
        { ownerWebContentsId: 7 },
      ),
    ).resolves.toEqual({
      ok: false,
      message: "route is busy",
    });
  });

  test("requests a no-transition presentation when another conversation is active", async () => {
    const service = createService();
    const route = {
      browserConversationId: browserIdentity.browserConversationId,
      browserViewScopeId: browserIdentity.browserViewScopeId,
      codexSessionId: "thread-1",
      ownerWebContentsId: 7,
      projectId: "alpha",
    };
    let transition: string | null = null;
    service.testEvents.subscribe("browserUsePresentationRequest", (request) => {
      transition = request.transition;
    });
    await service.handleCommand(
      {
        type: "capture-browser-use-route",
        browserConversationId: "another-session",
        browserViewScopeId: route.browserViewScopeId,
        codexSessionId: "another-thread",
        projectId: "alpha",
      },
      {
        ownerWebContentsId: route.ownerWebContentsId,
      },
    );
    await service.handleCommand({
      type: "browser-use-upsert-tab",
      tab: {
        ...browserIdentity,
        codexSessionId: route.codexSessionId,
        projectId: "alpha",
        title: "Browser",
        url: "https://example.com",
        webContentsId: null,
        viewport: {
          width: 1_280,
          height: 720,
          zoomPercent: 100,
          presetId: "browser-use",
        },
        captureActive: true,
        released: false,
        updatedAt: 1,
      },
    });

    service.setBrowserVisibleForBrowserUse(route, browserIdentity.browserTabId, true);
    expect(transition).toBe("none");
    expect(service.isBrowserVisibleForBrowserUse(route, browserIdentity.browserTabId)).toBe(false);
  });

  test("conversation teardown removes only that composite browser namespace", async () => {
    const service = createService();
    const secondIdentity = {
      browserConversationId: "session-2",
      browserViewScopeId: "window-session-2",
      browserTabId: browserIdentity.browserTabId,
    } as const;
    let pageReleasedCount = 0;
    service.testEvents.subscribe("pageReleased", () => {
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
          codexSessionId: identity.browserConversationId,
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
        cursor: {
          ...identity,
          moveSequence: 1,
          x: 1,
          y: 2,
          visible: true,
          updatedAt: 1,
        },
      });
    }

    service.closeBrowserConversation(browserIdentity.browserConversationId);

    expect(service.getStateSnapshot().tabs.length).toBe(1);
    expect(readTab(service, secondIdentity).url).toBe("https://session-2.example");
    expect(service.getBrowserUseStateSnapshot().tabs.length).toBe(1);
    expect(service.getBrowserUseStateSnapshot().tabs[0]?.browserConversationId).toBe("session-2");
    expect(service.getBrowserUseStateSnapshot().cursors.length).toBe(1);
    expect(service.getBrowserUseStateSnapshot().cursors[0]?.browserConversationId).toBe(
      "session-2",
    );
    expect(pageReleasedCount).toBe(0);
  });
});
