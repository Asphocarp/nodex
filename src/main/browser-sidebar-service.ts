import { BrowserWindow, session, shell, webContents, type WebContents } from "electron";
import { EventEmitter } from "node:events";
import {
  BROWSER_SIDEBAR_PARTITION,
  DEFAULT_BROWSER_SIDEBAR_FIND_STATE,
  makeDefaultBrowserSidebarTabId,
  makeBrowserSidebarTabKey,
  type BrowserBrowsingDataClearResult,
  type BrowserBrowsingDataKind,
  type BrowserSidebarBrowserUseCaptureSurfaceEvent,
  type BrowserSidebarBrowserUseStateSnapshot,
  type BrowserSidebarBrowserUseViewportEvent,
  type BrowserSidebarCommand,
  type BrowserSidebarCommandResult,
  type BrowserSidebarClonedTabInput,
  type BrowserSidebarDestroyWebviewRequest,
  type BrowserSidebarLocalServer,
  type BrowserSidebarLocalServerRoute,
  type BrowserSidebarLocalServersSnapshot,
  type BrowserSidebarStateSnapshot,
  type BrowserSidebarTabSnapshot,
  type BrowserSidebarTabIdentity,
  type BrowserSidebarViewport,
  type BrowserSidebarWebviewAttached,
  type BrowserSidebarWebviewDestroyed,
  type BrowserSidebarWebviewHostCreated,
  type BrowserUseCursorState,
  type BrowserUseTabState,
} from "../shared/browser-sidebar";
import { isBlankBrowserUrl, normalizeBrowserNavigationUrl } from "../shared/browser-url";
import { getLogger, type BackendLogger } from "./logging/logger";
import * as projectSessionService from "./local-store/project-sessions";
import { safeBroadcastToWindows } from "./ipc-safe-send";

type BrowserUseCommand = Extract<BrowserSidebarCommand, {
  type:
    | "browser-use-upsert-tab"
    | "browser-use-release-tab"
    | "browser-use-set-active-tab"
    | "browser-use-set-cursor"
    | "browser-use-set-viewport"
    | "browser-use-set-capture-surface";
}>;

type BrowserWebContentsLike = Pick<WebContents,
  | "canGoBack"
  | "canGoForward"
  | "capturePage"
  | "getTitle"
  | "getURL"
  | "goBack"
  | "goForward"
  | "isDestroyed"
  | "isLoading"
  | "loadURL"
  | "reload"
  | "reloadIgnoringCache"
  | "setWindowOpenHandler"
  | "setZoomFactor"
  | "stop"
> & {
  findInPage?: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => number;
  on(eventName: string, listener: (...args: unknown[]) => void): BrowserWebContentsLike;
  removeListener(eventName: string, listener: (...args: unknown[]) => void): BrowserWebContentsLike;
  stopFindInPage?: (action: "clearSelection" | "keepSelection" | "activateSelection") => void;
};

interface BrowserSidebarElectronDeps {
  session: Pick<typeof session, "fromPartition">;
  shell: Pick<typeof shell, "openExternal">;
  webContents: {
    fromId(id: number): BrowserWebContentsLike | null;
  };
}

interface BrowserSidebarServiceDeps {
  electron?: BrowserSidebarElectronDeps;
  logger?: Pick<BackendLogger, "debug" | "info" | "warn">;
}

const DEFAULT_VIEWPORT: BrowserSidebarViewport = {
  width: 390,
  height: 844,
  zoomPercent: 100,
  presetId: "responsive",
};

function browserIdentity(
  input: BrowserSidebarTabIdentity,
): BrowserSidebarTabIdentity {
  return {
    browserConversationId: input.browserConversationId,
    browserTabId: input.browserTabId,
  };
}

function browserTabKey(input: BrowserSidebarTabIdentity): string {
  return makeBrowserSidebarTabKey(browserIdentity(input));
}

function makeDefaultDeviceToolbarState(
  isEnabled: boolean,
): BrowserSidebarTabSnapshot["deviceToolbarState"] {
  return {
    responsiveViewportSize: null,
    toolbarState: {
      isEnabled,
      presetId: DEFAULT_VIEWPORT.presetId,
      width: DEFAULT_VIEWPORT.width,
      height: DEFAULT_VIEWPORT.height,
    },
  };
}

function updateDeviceToolbarState(
  current: BrowserSidebarTabSnapshot["deviceToolbarState"],
  input: {
    readonly isEnabled?: boolean;
    readonly viewport?: BrowserSidebarViewport;
  },
): BrowserSidebarTabSnapshot["deviceToolbarState"] {
  const viewport = input.viewport;
  return {
    responsiveViewportSize: viewport?.presetId === "responsive"
      ? { width: viewport.width, height: viewport.height }
      : current.responsiveViewportSize,
    toolbarState: {
      ...current.toolbarState,
      ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
      ...(viewport === undefined
        ? {}
        : {
            presetId: viewport.presetId,
            width: viewport.width,
            height: viewport.height,
          }),
    },
  };
}

function viewportFromDeviceToolbarState(
  deviceToolbarState: BrowserSidebarTabSnapshot["deviceToolbarState"],
  zoomPercent: number,
): BrowserSidebarViewport {
  const toolbar = deviceToolbarState.toolbarState;
  const responsive = deviceToolbarState.responsiveViewportSize;
  return {
    width: toolbar.presetId === "responsive"
      ? responsive?.width ?? toolbar.width
      : toolbar.width,
    height: toolbar.presetId === "responsive"
      ? responsive?.height ?? toolbar.height
      : toolbar.height,
    presetId: toolbar.presetId,
    zoomPercent,
  };
}

const LOCAL_SERVER_URL_PATTERN =
  /(?:https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/[^\s"'<>]*)?|(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)(?:\/[^\s"'<>]*)?)/gi;

interface BrowserSidebarServiceEvents {
  state: [BrowserSidebarStateSnapshot];
  localServers: [BrowserSidebarLocalServersSnapshot];
  browserUseState: [BrowserSidebarBrowserUseStateSnapshot];
  browserUseViewport: [BrowserSidebarBrowserUseViewportEvent];
  browserUseCaptureSurface: [BrowserSidebarBrowserUseCaptureSurfaceEvent];
  browserUseCursor: [BrowserUseCursorState];
  pageReleased: [BrowserSidebarTabIdentity];
  webviewAttached: [BrowserSidebarWebviewAttached];
  destroyWebview: [BrowserSidebarDestroyWebviewRequest];
}

type BrowserSidebarEventName = keyof BrowserSidebarServiceEvents;

interface LocalServerProjectState {
  projectId: string;
  isLoading: boolean;
  servers: Map<string, BrowserSidebarLocalServer>;
  hiddenServerIds: Set<string>;
  hiddenRouteIds: Set<string>;
  updatedAt: number;
}

interface PendingWebviewTeardown extends BrowserSidebarTabIdentity {
  mountGeneration: number;
  reason: BrowserSidebarDestroyWebviewRequest["reason"];
  teardownId: string;
}

export class BrowserSidebarService extends EventEmitter {
  private readonly tabs = new Map<string, BrowserSidebarTabSnapshot>();
  private readonly webContentsTabIds = new Map<number, string>();
  private readonly webContentsDisposers = new Map<number, () => void>();
  private readonly pendingTeardowns = new Map<string, PendingWebviewTeardown>();
  private readonly localServersByProject = new Map<string, LocalServerProjectState>();
  private readonly browserUseTabs = new Map<string, BrowserUseTabState>();
  private readonly deviceToolbarStates = new Map<
    string,
    BrowserSidebarTabSnapshot["deviceToolbarState"]
  >();
  private readonly transferredBrowserTabIdsByConversation = new Map<string, string[]>();
  private readonly browserUseViewportSizes = new Map<string, BrowserSidebarBrowserUseViewportEvent>();
  private readonly browserUseCaptureSurfaces = new Map<string, BrowserSidebarBrowserUseCaptureSurfaceEvent>();
  private readonly electron: BrowserSidebarElectronDeps;
  private readonly logger: Pick<BackendLogger, "debug" | "info" | "warn">;
  private readonly browserUseActiveTabIdsByConversation = new Map<string, string>();
  private readonly browserUseCursors = new Map<string, BrowserUseCursorState>();
  private teardownSequence = 0;

  constructor(deps: BrowserSidebarServiceDeps = {}) {
    super();
    this.electron = deps.electron ?? {
      session,
      shell,
      webContents: {
        fromId: (id) => webContents.fromId(id) ?? null,
      },
    };
    this.logger = deps.logger ?? getLogger({ subsystem: "browser-sidebar" });
  }

  override on<EventName extends BrowserSidebarEventName>(
    eventName: EventName,
    listener: (...args: BrowserSidebarServiceEvents[EventName]) => void,
  ): this {
    return super.on(eventName, listener);
  }

  override emit<EventName extends BrowserSidebarEventName>(
    eventName: EventName,
    ...args: BrowserSidebarServiceEvents[EventName]
  ): boolean {
    return super.emit(eventName, ...args);
  }

  getStateSnapshot(): BrowserSidebarStateSnapshot {
    return { tabs: [...this.tabs.values()] };
  }

  getConversationBrowserTabIds(browserConversationId: string): string[] {
    const orderedIds: string[] = [];
    const seenIds = new Set<string>();
    const append = (browserTabId: string) => {
      if (seenIds.has(browserTabId)) return;
      seenIds.add(browserTabId);
      orderedIds.push(browserTabId);
    };
    for (const tab of this.browserUseTabs.values()) {
      if (tab.browserConversationId !== browserConversationId || tab.released) continue;
      append(tab.browserTabId);
    }
    for (const tab of this.tabs.values()) {
      if (tab.browserConversationId !== browserConversationId) continue;
      if (tab.webContentsId === null) continue;
      append(tab.browserTabId);
    }
    return orderedIds;
  }

  closeBrowserTab(identity: BrowserSidebarTabIdentity): void {
    const key = browserTabKey(identity);
    const hadOrdinaryTab = this.tabs.has(key);
    if (hadOrdinaryTab) this.unregisterTab(key);

    this.browserUseTabs.delete(key);
    this.browserUseCursors.delete(key);
    this.browserUseViewportSizes.delete(key);
    this.browserUseCaptureSurfaces.delete(key);
    this.deviceToolbarStates.delete(key);
    if (
      this.browserUseActiveTabIdsByConversation.get(identity.browserConversationId)
      === identity.browserTabId
    ) {
      this.browserUseActiveTabIdsByConversation.delete(identity.browserConversationId);
    }

    const transferredIds = this.transferredBrowserTabIdsByConversation.get(
      identity.browserConversationId,
    );
    if (transferredIds) {
      const remainingIds = transferredIds.filter((browserTabId) =>
        browserTabId !== identity.browserTabId
      );
      if (remainingIds.length > 0) {
        this.transferredBrowserTabIdsByConversation.set(
          identity.browserConversationId,
          remainingIds,
        );
      } else {
        this.transferredBrowserTabIdsByConversation.delete(
          identity.browserConversationId,
        );
      }
    }

    this.emitBrowserUseState();
  }

  closeBrowserConversation(browserConversationId: string): void {
    const browserTabIds = new Set<string>();
    const appendIdentity = (identity: BrowserSidebarTabIdentity) => {
      if (identity.browserConversationId !== browserConversationId) return;
      browserTabIds.add(identity.browserTabId);
    };
    for (const tab of this.tabs.values()) appendIdentity(tab);
    for (const tab of this.browserUseTabs.values()) appendIdentity(tab);
    for (const cursor of this.browserUseCursors.values()) appendIdentity(cursor);
    for (const viewport of this.browserUseViewportSizes.values()) appendIdentity(viewport);
    for (const surface of this.browserUseCaptureSurfaces.values()) appendIdentity(surface);
    for (const teardown of this.pendingTeardowns.values()) appendIdentity(teardown);
    for (const browserTabId of this.transferredBrowserTabIdsByConversation.get(browserConversationId) ?? []) {
      browserTabIds.add(browserTabId);
    }
    const keyPrefix = `${browserConversationId}\0`;
    for (const key of this.deviceToolbarStates.keys()) {
      if (!key.startsWith(keyPrefix)) continue;
      browserTabIds.add(key.slice(keyPrefix.length));
    }

    for (const browserTabId of browserTabIds) {
      this.closeBrowserTab({ browserConversationId, browserTabId });
    }
    this.browserUseActiveTabIdsByConversation.delete(browserConversationId);
    this.transferredBrowserTabIdsByConversation.delete(browserConversationId);
    this.emitBrowserUseState();
  }

  closeBrowserProject(projectId: string): void {
    this.localServersByProject.delete(projectId);
  }

  getDeviceToolbarTabState(
    identity: BrowserSidebarTabIdentity,
  ): BrowserSidebarTabSnapshot["deviceToolbarState"] {
    return this.deviceToolbarStates.get(browserTabKey(identity))
      ?? makeDefaultDeviceToolbarState(false);
  }

  primeTransferredBrowserTabId(
    browserConversationId: string,
    browserTabId: string,
  ): void {
    this.transferredBrowserTabIdsByConversation.set(browserConversationId, [
      ...(this.transferredBrowserTabIdsByConversation.get(browserConversationId) ?? []),
      browserTabId,
    ]);
  }

  openClonedBrowserTab(
    input: Omit<BrowserSidebarClonedTabInput, "deviceToolbarState">,
  ): BrowserSidebarTabSnapshot {
    const transferredIds = this.transferredBrowserTabIdsByConversation.get(
      input.browserConversationId,
    ) ?? [];
    const defaultBrowserTabId = makeDefaultBrowserSidebarTabId(
      input.browserConversationId,
    );
    const browserTabId = input.browserTabId === defaultBrowserTabId
      || transferredIds.includes(input.browserTabId)
      ? input.browserTabId
      : defaultBrowserTabId;
    const identity = {
      browserConversationId: input.browserConversationId,
      browserTabId,
    };
    const key = browserTabKey(identity);
    const existing = this.tabs.get(key);
    const url = normalizeBrowserNavigationUrl(input.initialUrl);
    const deviceToolbarState = this.getDeviceToolbarTabState(identity);
    const viewport = viewportFromDeviceToolbarState(
      deviceToolbarState,
      existing?.zoomPercent ?? 100,
    );
    const snapshot = this.upsertTab({
      ...(existing ?? {
        ...identity,
        webContentsId: null,
        mountGeneration: 0,
        title: "New tab",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        zoomPercent: 100,
        interactionMode: "browse" as const,
        findState: DEFAULT_BROWSER_SIDEBAR_FIND_STATE,
        hasBrowserPage: false,
        pageActionsDisabled: true,
        updatedAt: Date.now(),
      }),
      projectId: input.projectId,
      url,
      pendingUrl: input.initialUrl === undefined ? undefined : url,
      deviceToolbarVisible: deviceToolbarState.toolbarState.isEnabled,
      viewport,
      deviceToolbarState,
      updatedAt: Date.now(),
    });
    this.emitState();
    return snapshot;
  }

  setDeviceToolbarTabState(
    identity: BrowserSidebarTabIdentity,
    deviceToolbarState: BrowserSidebarTabSnapshot["deviceToolbarState"],
  ): void {
    const key = browserTabKey(identity);
    this.deviceToolbarStates.set(key, deviceToolbarState);
    const existing = this.tabs.get(key);
    if (!existing) return;
    this.updateTab(key, {
      deviceToolbarVisible: deviceToolbarState.toolbarState.isEnabled,
      viewport: viewportFromDeviceToolbarState(
        deviceToolbarState,
        existing.zoomPercent,
      ),
      deviceToolbarState,
    });
  }

  primeClonedTab(input: BrowserSidebarClonedTabInput): BrowserSidebarTabSnapshot {
    const snapshot = this.openClonedBrowserTab(input);
    this.setDeviceToolbarTabState(input, input.deviceToolbarState);
    return snapshot;
  }

  getBrowserUseStateSnapshot(): BrowserSidebarBrowserUseStateSnapshot {
    return {
      tabs: [...this.browserUseTabs.values()],
      activeBrowserTabIdsByConversation: Object.fromEntries(
        this.browserUseActiveTabIdsByConversation,
      ),
      cursors: [...this.browserUseCursors.values()],
    };
  }

  getLocalServersSnapshot(projectId: string): BrowserSidebarLocalServersSnapshot {
    return this.toLocalServersSnapshot(this.getLocalServerProjectState(projectId));
  }

  async clearBrowsingData(kind: BrowserBrowsingDataKind): Promise<BrowserBrowsingDataClearResult> {
    try {
      const browserSession = this.electron.session.fromPartition(BROWSER_SIDEBAR_PARTITION);
      if (kind === "cookies") {
        await browserSession.clearStorageData({ storages: ["cookies"] });
        return { ok: true };
      }
      await browserSession.clearCache();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : `Failed to clear ${kind}`,
      };
    }
  }

  async handleWebviewHostCreated(event: BrowserSidebarWebviewHostCreated): Promise<BrowserSidebarCommandResult> {
    const snapshot = this.attachWebview(event);
    if (!snapshot) return { ok: false, message: "Browser tab is not registered" };
    this.emit("webviewAttached", {
      ...browserIdentity(event),
      mountGeneration: event.mountGeneration,
      webContentsId: event.webContentsId,
    });
    return { ok: true, snapshot };
  }

  async handleWebviewDestroyed(event: BrowserSidebarWebviewDestroyed): Promise<BrowserSidebarCommandResult> {
    const key = browserTabKey(event);
    const current = this.tabs.get(key);
    const pending = this.pendingTeardowns.get(key);
    if (
      !pending
      || pending.teardownId !== event.teardownId
      || pending.mountGeneration !== event.mountGeneration
      || pending.reason !== event.reason
    ) {
      this.logger.debug("Ignored stale browser webview destroyed ack", {
        ...browserIdentity(event),
        receivedTeardownId: event.teardownId,
        pendingTeardownId: pending?.teardownId ?? null,
      });
      return { ok: true, snapshot: current };
    }

    if (current && current.mountGeneration !== event.mountGeneration) {
      this.logger.debug("Ignored stale browser webview generation ack", {
        ...browserIdentity(event),
        currentMountGeneration: current.mountGeneration,
        receivedMountGeneration: event.mountGeneration,
      });
      return { ok: true, snapshot: current };
    }

    this.pendingTeardowns.delete(key);
    this.detachWebview(key, event.webContentsId);
    this.logger.info("Browser webview destroyed", {
      ...browserIdentity(event),
      mountGeneration: event.mountGeneration,
      reason: event.reason,
    });
    return { ok: true, snapshot: this.tabs.get(key) };
  }

  async handleCommand(command: BrowserSidebarCommand): Promise<BrowserSidebarCommandResult> {
    if (command.type === "register-tab") {
      const key = browserTabKey(command);
      const existing = this.tabs.get(key);
      if (existing) {
        const snapshot = this.updateTab(key, {
          projectId: command.projectId,
          title: existing.hasBrowserPage ? existing.title : command.title?.trim() || existing.title,
          faviconUrl: command.faviconUrl ?? existing.faviconUrl,
        });
        return { ok: true, snapshot };
      }
      const deviceToolbarVisible = command.deviceToolbarVisible === true;
      const deviceToolbarState = this.deviceToolbarStates.get(key)
        ?? makeDefaultDeviceToolbarState(deviceToolbarVisible);
      this.deviceToolbarStates.set(key, deviceToolbarState);
      const viewport = viewportFromDeviceToolbarState(deviceToolbarState, 100);
      const snapshot = this.upsertTab({
        ...browserIdentity(command),
        projectId: command.projectId,
        webContentsId: null,
        mountGeneration: 0,
        url: normalizeBrowserNavigationUrl(command.initialUrl),
        title: command.title?.trim() || "New tab",
        faviconUrl: command.faviconUrl,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        zoomPercent: 100,
        deviceToolbarVisible,
        viewport,
        deviceToolbarState,
        interactionMode: "browse",
        findState: DEFAULT_BROWSER_SIDEBAR_FIND_STATE,
        hasBrowserPage: !isBlankBrowserUrl(command.initialUrl),
        pageActionsDisabled: isBlankBrowserUrl(command.initialUrl),
        updatedAt: Date.now(),
      });
      this.emitState();
      return { ok: true, snapshot };
    }

    if (command.type === "local-servers-refresh") {
      await this.refreshLocalServers(command.projectId);
      return { ok: true };
    }

    if (command.type === "hide-local-server") {
      const state = this.getLocalServerProjectState(command.projectId);
      state.hiddenServerIds.add(command.server.id);
      this.applyLocalServerHiddenState(state);
      this.emitLocalServers(command.projectId);
      return { ok: true };
    }

    if (command.type === "unhide-local-server") {
      const state = this.getLocalServerProjectState(command.projectId);
      state.hiddenServerIds.delete(makeLocalServerId(readLocalServerOrigin(command.url)));
      this.applyLocalServerHiddenState(state);
      this.emitLocalServers(command.projectId);
      return { ok: true };
    }

    if (command.type === "remove-local-server-route") {
      const state = this.getLocalServerProjectState(command.projectId);
      const serverOrigin = readLocalServerOrigin(command.serverUrl);
      const routeId = makeLocalServerRouteId(serverOrigin, normalizeRoutePath(command.routeUrl));
      state.hiddenRouteIds.add(routeId);
      const server = state.servers.get(makeLocalServerId(serverOrigin));
      if (server) {
        state.servers.set(server.id, {
          ...server,
          routes: server.routes.filter((route) => route.id !== routeId),
        });
      }
      this.applyLocalServerHiddenState(state);
      this.emitLocalServers(command.projectId);
      return { ok: true };
    }

    if (command.type === "open-external") {
      let url = command.url;
      if (
        url === undefined
        && "browserConversationId" in command
        && "browserTabId" in command
      ) {
        url = this.tabs.get(browserTabKey(command))?.url;
      }
      if (isBlankBrowserUrl(url)) return { ok: false, message: "Browser tab has no page URL" };
      await this.electron.shell.openExternal(normalizeBrowserNavigationUrl(url));
      return { ok: true };
    }

    if (isBrowserUseCommand(command)) {
      this.handleBrowserUseCommand(command);
      return { ok: true };
    }

    if (command.type === "close-tab") {
      this.closeBrowserTab(command);
      return { ok: true };
    }

    const key = browserTabKey(command);
    const tab = this.tabs.get(key);
    if (!tab) return { ok: false, message: "Browser tab is not registered" };

    if (command.type === "set-title") {
      const snapshot = this.updateTab(key, { title: command.title.trim() || "New tab" });
      return { ok: true, snapshot };
    }

    if (command.type === "set-favicon") {
      const snapshot = this.updateTab(key, { faviconUrl: command.faviconUrl });
      return { ok: true, snapshot };
    }

    if (command.type === "step-zoom") {
      const zoomPercent = stepZoomPercent(tab.zoomPercent, command.delta);
      const contents = this.getAttachedWebContents(tab);
      if (contents && !contents.isDestroyed()) contents.setZoomFactor(zoomPercent / 100);
      const snapshot = this.updateTab(key, {
        zoomPercent,
        viewport: { ...tab.viewport, zoomPercent },
      });
      return { ok: true, snapshot };
    }

    if (command.type === "set-zoom-percent") {
      const zoomPercent = clampZoomPercent(command.zoomPercent);
      const contents = this.getAttachedWebContents(tab);
      if (contents && !contents.isDestroyed()) contents.setZoomFactor(zoomPercent / 100);
      const snapshot = this.updateTab(key, {
        zoomPercent,
        viewport: { ...tab.viewport, zoomPercent },
      });
      return { ok: true, snapshot };
    }

    if (command.type === "reset-zoom") {
      const contents = this.getAttachedWebContents(tab);
      if (contents && !contents.isDestroyed()) contents.setZoomFactor(1);
      const snapshot = this.updateTab(key, {
        zoomPercent: 100,
        viewport: { ...tab.viewport, zoomPercent: 100 },
      });
      return { ok: true, snapshot };
    }

    if (command.type === "set-device-toolbar-visible") {
      const deviceToolbarState = updateDeviceToolbarState(tab.deviceToolbarState, {
        isEnabled: command.visible,
      });
      this.deviceToolbarStates.set(key, deviceToolbarState);
      const snapshot = this.updateTab(key, {
        deviceToolbarVisible: command.visible,
        deviceToolbarState,
      });
      return { ok: true, snapshot };
    }

    if (command.type === "set-viewport") {
      const deviceToolbarState = updateDeviceToolbarState(tab.deviceToolbarState, {
        viewport: command.viewport,
      });
      this.deviceToolbarStates.set(key, deviceToolbarState);
      const snapshot = this.updateTab(key, {
        viewport: command.viewport,
        deviceToolbarState,
      });
      this.syncBrowserUseViewport(command, command.viewport);
      return { ok: true, snapshot };
    }

    if (command.type === "set-interaction-mode") {
      const snapshot = this.updateTab(key, { interactionMode: command.mode });
      return { ok: true, snapshot };
    }

    if (command.type === "open-find") {
      const snapshot = this.updateTab(key, { findState: { ...tab.findState, open: true } });
      return { ok: true, snapshot };
    }

    if (command.type === "close-find") {
      const contents = this.getAttachedWebContents(tab);
      contents?.stopFindInPage?.("clearSelection");
      const snapshot = this.updateTab(key, { findState: { ...DEFAULT_BROWSER_SIDEBAR_FIND_STATE } });
      return { ok: true, snapshot };
    }

    if (command.type === "set-find-query") {
      const contents = this.getAttachedWebContents(tab);
      const query = command.query;
      if (query.trim().length > 0) {
        contents?.findInPage?.(query, { forward: true, findNext: false, matchCase: command.caseSensitive === true });
      } else {
        contents?.stopFindInPage?.("clearSelection");
      }
      const snapshot = this.updateTab(key, {
        findState: {
          open: true,
          query,
          activeMatchOrdinal: null,
          matchCount: null,
          caseSensitive: command.caseSensitive === true,
        },
      });
      return { ok: true, snapshot };
    }

    if (command.type === "find-next" || command.type === "find-previous") {
      const query = tab.findState.query.trim();
      if (query.length > 0) {
        const forward = command.type === "find-next";
        this.getAttachedWebContents(tab)?.findInPage?.(query, {
          forward,
          findNext: true,
          matchCase: tab.findState.caseSensitive,
        });
      }
      return { ok: true, snapshot: tab };
    }

    if (command.type === "navigate") {
      return this.navigate(tab, command.url);
    }

    const contents = this.getAttachedWebContents(tab);
    if (!contents || contents.isDestroyed()) return { ok: false, message: "Browser webview is not attached" };

    if (command.type === "go-back") {
      if (contents.canGoBack()) contents.goBack();
      return { ok: true };
    }

    if (command.type === "go-forward") {
      if (contents.canGoForward()) contents.goForward();
      return { ok: true };
    }

    if (command.type === "reload") {
      if (command.ignoreCache) contents.reloadIgnoringCache();
      else contents.reload();
      return { ok: true };
    }

    if (command.type === "stop") {
      contents.stop();
      this.refreshSnapshotFromWebContents(key, contents, { isLoading: false });
      return { ok: true };
    }

    if (command.type === "capture-screenshot") {
      const image = await contents.capturePage();
      return { ok: true, dataUrl: image.toDataURL() };
    }

    return { ok: false, message: "Unsupported browser command" };
  }

  observePtyData(terminalSessionId: string, data: string): void {
    const sessionId = parseProjectSessionIdFromTerminalId(terminalSessionId);
    if (!sessionId) return;
    const sessionRecord = projectSessionService.getProjectSession(sessionId);
    if (!sessionRecord) return;
    if (sessionRecord.projectId === null) return;

    const matches = data.match(LOCAL_SERVER_URL_PATTERN);
    if (!matches || matches.length === 0) return;

    const state = this.getLocalServerProjectState(sessionRecord.projectId);
    const now = Date.now();
    for (const match of matches) {
      const url = normalizeBrowserNavigationUrl(match);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (!isLocalServerUrl(parsed)) continue;

      const origin = parsed.origin;
      const serverId = makeLocalServerId(origin);
      const routeId = makeLocalServerRouteId(origin, parsed.pathname || "/");
      const existing = state.servers.get(serverId);
      const routes = existing?.routes ?? [];
      const routeIndex = routes.findIndex((route) => route.id === routeId);
      const route: BrowserSidebarLocalServerRoute = {
        id: routeId,
        path: parsed.pathname || "/",
        title: parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : origin,
        lastSeenAt: now,
        hidden: state.hiddenRouteIds.has(routeId),
      };
      const nextRoutes = routeIndex >= 0
        ? routes.map((item, index) => index === routeIndex ? route : item)
        : [...routes, route];

      state.servers.set(serverId, {
        id: serverId,
        origin,
        host: parsed.hostname,
        port: Number.parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10),
        protocol: parsed.protocol === "https:" ? "https:" : "http:",
        lastSeenAt: now,
        online: true,
        hidden: state.hiddenServerIds.has(serverId),
        routes: nextRoutes.sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      });
    }

    state.isLoading = false;
    state.updatedAt = now;
    this.emitLocalServers(sessionRecord.projectId);
  }

  private navigate(tab: BrowserSidebarTabSnapshot, rawUrl: string): BrowserSidebarCommandResult {
    const key = browserTabKey(tab);
    const url = normalizeBrowserNavigationUrl(rawUrl);
    if (isBlankBrowserUrl(url)) {
      const snapshot = this.updateTab(key, {
        url: "about:blank",
        pendingUrl: undefined,
        title: "New tab",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        errorMessage: undefined,
      });
      this.requestDestroyWebview(key, "reset");
      return { ok: true, snapshot };
    }

    const contents = this.getAttachedWebContents(tab);
    const snapshot = this.updateTab(key, {
      url,
      pendingUrl: url,
      isLoading: Boolean(contents && !contents.isDestroyed()),
      errorMessage: undefined,
    });

    if (!contents || contents.isDestroyed()) {
      this.logger.info("Browser navigate queued until webview host attaches", {
        ...browserIdentity(tab),
        hasUrl: url.length > 0,
      });
      return { ok: true, snapshot };
    }

    this.logger.info("Browser navigate start", { ...browserIdentity(tab), hasUrl: url.length > 0 });
    void Promise.resolve(contents.loadURL(url))
      .then(() => this.refreshSnapshotFromWebContents(key, contents, { pendingUrl: undefined }))
      .catch((error) => {
        if (isNavigationAbortError(error)) {
          this.logger.debug("Browser navigate aborted", { ...browserIdentity(tab), hasUrl: url.length > 0 });
          return;
        }
        this.logger.warn("Browser navigate failed", {
          ...browserIdentity(tab),
          message: error instanceof Error ? error.message : String(error),
        });
        this.updateTab(key, {
          isLoading: false,
          pendingUrl: undefined,
          errorMessage: error instanceof Error ? error.message : "Failed to load page",
        });
      });
    return { ok: true, snapshot };
  }

  private upsertTab(snapshot: BrowserSidebarTabSnapshot): BrowserSidebarTabSnapshot {
    const next = deriveBrowserSnapshot(snapshot);
    this.tabs.set(browserTabKey(next), next);
    return next;
  }

  private updateTab(
    key: string,
    patch: Partial<Omit<
      BrowserSidebarTabSnapshot,
      "browserConversationId" | "browserTabId" | "updatedAt"
    >>,
  ): BrowserSidebarTabSnapshot {
    const current = this.tabs.get(key);
    if (!current) throw new Error("Browser tab is not registered");
    const next = {
      ...current,
      ...stripUndefinedProperties(patch),
      updatedAt: Date.now(),
    } satisfies BrowserSidebarTabSnapshot;
    const derived = deriveBrowserSnapshot(next);
    this.tabs.set(key, derived);
    this.emitState();
    return derived;
  }

  private unregisterTab(tabId: string): void {
    this.requestDestroyWebview(tabId, "closed");
    const tab = this.tabs.get(tabId);
    if (tab && tab.webContentsId !== null) {
      this.webContentsTabIds.delete(tab.webContentsId);
      this.disposeWebContentsListeners(tab.webContentsId);
    }
    this.tabs.delete(tabId);
    this.deviceToolbarStates.delete(tabId);
    this.emitState();
  }

  private attachWebview(event: BrowserSidebarWebviewHostCreated): BrowserSidebarTabSnapshot | null {
    const key = browserTabKey(event);
    const current = this.tabs.get(key);
    if (!current) return null;

    const existingKey = this.webContentsTabIds.get(event.webContentsId);
    if (existingKey && existingKey !== key) {
      this.detachWebview(existingKey, event.webContentsId);
    }
    if (current.webContentsId !== null && current.webContentsId !== event.webContentsId) {
      this.detachWebview(key, current.webContentsId);
    }

    this.webContentsTabIds.set(event.webContentsId, key);
    const contents = this.electron.webContents.fromId(event.webContentsId);
    if (contents) this.ensureWebContentsListeners(key, event.webContentsId, contents);

    this.pendingTeardowns.delete(key);
    const snapshot = this.updateTab(key, {
      webContentsId: event.webContentsId,
      mountGeneration: event.mountGeneration,
      url: isBlankBrowserUrl(current.url) ? normalizeBrowserNavigationUrl(event.initialUrl) : current.url,
      title: event.title?.trim() || current.title,
      errorMessage: undefined,
    });
    this.logger.info("Browser webview attached", {
      ...browserIdentity(event),
      mountGeneration: event.mountGeneration,
      webContentsId: event.webContentsId,
      hostKind: event.hostKind,
    });
    return snapshot;
  }

  private detachWebview(tabId: string, webContentsId?: number): void {
    const current = this.tabs.get(tabId);
    if (!current) return;
    const detachedWebContentsId = typeof webContentsId === "number" ? webContentsId : current.webContentsId;
    if (detachedWebContentsId !== null && detachedWebContentsId !== undefined) {
      this.webContentsTabIds.delete(detachedWebContentsId);
      this.disposeWebContentsListeners(detachedWebContentsId);
    }
    this.updateTab(tabId, { webContentsId: null, isLoading: false, pendingUrl: undefined });
  }

  private ensureWebContentsListeners(tabId: string, webContentsId: number, contents: BrowserWebContentsLike): void {
    if (this.webContentsDisposers.has(webContentsId)) return;

    contents.setWindowOpenHandler(({ url: targetUrl }) => {
      void this.electron.shell.openExternal(targetUrl);
      return { action: "deny" };
    });

    const disposers: Array<() => void> = [];
    const add = (eventName: string, listener: (...args: unknown[]) => void) => {
      contents.on(eventName, listener);
      disposers.push(() => contents.removeListener(eventName, listener));
    };

    add("destroyed", () => {
      const activeTabId = this.webContentsTabIds.get(webContentsId) ?? tabId;
      this.logger.info("Browser webContents destroyed", { tabId: activeTabId, webContentsId });
      this.detachWebview(activeTabId, webContentsId);
    });
    add("did-start-loading", () => {
      this.updateTabForWebContents(webContentsId, contents, { isLoading: true, errorMessage: undefined });
    });
    add("did-stop-loading", () => {
      this.updateTabForWebContents(webContentsId, contents, { isLoading: false, pendingUrl: undefined });
    });
    add("did-navigate", (...args) => {
      this.updateTabForWebContents(webContentsId, contents, {
        url: readUrlFromEventArgs(args, contents.getURL()),
        pendingUrl: undefined,
      });
    });
    add("did-navigate-in-page", (...args) => {
      this.updateTabForWebContents(webContentsId, contents, {
        url: readUrlFromEventArgs(args, contents.getURL()),
        pendingUrl: undefined,
      });
    });
    add("page-title-updated", (...args) => {
      this.updateTabForWebContents(webContentsId, contents, {
        title: readTitleFromEventArgs(args, contents.getTitle()),
      });
    });
    add("page-favicon-updated", (...args) => {
      const faviconUrl = readFaviconFromEventArgs(args);
      this.updateTabForWebContents(webContentsId, contents, { faviconUrl });
    });
    add("found-in-page", (...args) => {
      const result = readFoundInPageResult(args);
      if (!result) return;
      this.updateTabForWebContents(webContentsId, contents, {
        findState: {
          ...(this.tabs.get(this.webContentsTabIds.get(webContentsId) ?? "")?.findState ?? DEFAULT_BROWSER_SIDEBAR_FIND_STATE),
          activeMatchOrdinal: result.activeMatchOrdinal,
          matchCount: result.matches,
        },
      });
    });
    add("did-fail-load", (...args) => this.handleLoadFailure(webContentsId, contents, args));
    add("did-fail-provisional-load", (...args) => this.handleLoadFailure(webContentsId, contents, args));

    this.webContentsDisposers.set(webContentsId, () => {
      for (const dispose of disposers) dispose();
    });
  }

  private disposeWebContentsListeners(webContentsId: number): void {
    const dispose = this.webContentsDisposers.get(webContentsId);
    if (!dispose) return;
    dispose();
    this.webContentsDisposers.delete(webContentsId);
  }

  private updateTabForWebContents(
    webContentsId: number,
    contents: BrowserWebContentsLike,
    patch: Partial<Omit<
      BrowserSidebarTabSnapshot,
      "browserConversationId" | "browserTabId" | "updatedAt"
    >>,
  ): BrowserSidebarTabSnapshot | null {
    const tabId = this.webContentsTabIds.get(webContentsId);
    if (!tabId) return null;
    return this.refreshSnapshotFromWebContents(tabId, contents, patch);
  }

  private refreshSnapshotFromWebContents(
    tabId: string,
    contents: BrowserWebContentsLike,
    patch: Partial<Omit<
      BrowserSidebarTabSnapshot,
      "browserConversationId" | "browserTabId" | "updatedAt"
    >> = {},
  ): BrowserSidebarTabSnapshot | null {
    const current = this.tabs.get(tabId);
    if (!current) return null;
    if (contents.isDestroyed()) return current;

    const url = typeof patch.url === "string"
      ? patch.url
      : contents.getURL() || current.url;
    const title = typeof patch.title === "string"
      ? patch.title
      : contents.getTitle() || current.title || "New tab";

    return this.updateTab(tabId, {
      url: normalizeBrowserNavigationUrl(url),
      title,
      isLoading: contents.isLoading(),
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward(),
      ...patch,
    });
  }

  private handleLoadFailure(webContentsId: number, contents: BrowserWebContentsLike, args: unknown[]): void {
    const errorCode = readErrorCodeFromEventArgs(args);
    const url = readUrlFromEventArgs(args, contents.getURL());
    if (errorCode === -3) {
      this.updateTabForWebContents(webContentsId, contents, {
        isLoading: false,
        pendingUrl: undefined,
      });
      this.logger.debug("Browser load aborted", { webContentsId, hasUrl: url.length > 0 });
      return;
    }

    this.updateTabForWebContents(webContentsId, contents, {
      url,
      isLoading: false,
      pendingUrl: undefined,
      errorMessage: readErrorDescriptionFromEventArgs(args) ?? "Failed to load page",
    });
    this.logger.warn("Browser load failed", { webContentsId, errorCode, hasUrl: url.length > 0 });
  }

  private requestDestroyWebview(tabId: string, reason: BrowserSidebarDestroyWebviewRequest["reason"]): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.webContentsId === null) return;

    const teardownId = `browser-webview-teardown-${++this.teardownSequence}`;
    const request: BrowserSidebarDestroyWebviewRequest = {
      ...browserIdentity(tab),
      mountGeneration: tab.mountGeneration,
      reason,
      teardownId,
    };
    this.pendingTeardowns.set(tabId, request);
    this.logger.info("Browser destroy webview requested", {
      ...browserIdentity(tab),
      mountGeneration: tab.mountGeneration,
      reason,
      teardownId,
    });
    this.emit("destroyWebview", request);
  }

  private getAttachedWebContents(tab: BrowserSidebarTabSnapshot): BrowserWebContentsLike | null {
    if (tab.webContentsId === null) return null;
    return this.electron.webContents.fromId(tab.webContentsId) ?? null;
  }

  private getLocalServerProjectState(projectId: string): LocalServerProjectState {
    const existing = this.localServersByProject.get(projectId);
    if (existing) return existing;
    const state: LocalServerProjectState = {
      projectId,
      isLoading: false,
      servers: new Map(),
      hiddenServerIds: new Set(),
      hiddenRouteIds: new Set(),
      updatedAt: Date.now(),
    };
    this.localServersByProject.set(projectId, state);
    return state;
  }

  private applyLocalServerHiddenState(state: LocalServerProjectState): void {
    for (const server of state.servers.values()) {
      server.hidden = state.hiddenServerIds.has(server.id);
      server.routes = server.routes.map((route) => ({
        ...route,
        hidden: state.hiddenRouteIds.has(route.id),
      }));
    }
    state.updatedAt = Date.now();
  }

  private toLocalServersSnapshot(state: LocalServerProjectState): BrowserSidebarLocalServersSnapshot {
    const servers = [...state.servers.values()]
      .map((server) => ({
        ...server,
        routes: [...server.routes].sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return {
      projectId: state.projectId,
      isLoading: state.isLoading,
      servers,
      hiddenServerIds: [...state.hiddenServerIds],
      hiddenRouteIds: [...state.hiddenRouteIds],
      updatedAt: state.updatedAt,
    };
  }

  private emitState(): void {
    this.emit("state", this.getStateSnapshot());
  }

  private emitLocalServers(projectId: string): void {
    const state = this.localServersByProject.get(projectId);
    if (!state) return;
    this.emit("localServers", this.toLocalServersSnapshot(state));
  }

  private async refreshLocalServers(projectId: string): Promise<void> {
    const state = this.getLocalServerProjectState(projectId);
    const servers = [...state.servers.values()];
    if (servers.length === 0) {
      state.isLoading = false;
      state.updatedAt = Date.now();
      this.emitLocalServers(projectId);
      return;
    }

    state.isLoading = true;
    this.emitLocalServers(projectId);

    const probed = await Promise.all(servers.map(async (server) => ({
      id: server.id,
      online: await probeLocalServer(server.origin),
    })));
    if (this.localServersByProject.get(projectId) !== state) return;
    for (const result of probed) {
      const server = state.servers.get(result.id);
      if (!server) continue;
      state.servers.set(result.id, {
        ...server,
        online: result.online,
        lastSeenAt: result.online ? Date.now() : server.lastSeenAt,
      });
    }
    state.isLoading = false;
    this.applyLocalServerHiddenState(state);
    this.emitLocalServers(projectId);
  }

  private emitBrowserUseState(): void {
    this.emit("browserUseState", this.getBrowserUseStateSnapshot());
  }

  private handleBrowserUseCommand(command: BrowserUseCommand): void {
    if (command.type === "browser-use-upsert-tab") {
      const key = browserTabKey(command.tab);
      this.browserUseTabs.set(key, {
        ...command.tab,
        updatedAt: Date.now(),
      });
      if (!this.browserUseActiveTabIdsByConversation.has(command.tab.browserConversationId)) {
        this.browserUseActiveTabIdsByConversation.set(
          command.tab.browserConversationId,
          command.tab.browserTabId,
        );
      }
      this.emitBrowserUseState();
      return;
    }

    if (command.type === "browser-use-release-tab") {
      const key = browserTabKey(command);
      this.browserUseTabs.delete(key);
      this.browserUseCursors.delete(key);
      this.browserUseViewportSizes.delete(key);
      this.browserUseCaptureSurfaces.delete(key);
      this.deviceToolbarStates.delete(key);
      if (
        this.browserUseActiveTabIdsByConversation.get(command.browserConversationId)
        === command.browserTabId
      ) {
        this.browserUseActiveTabIdsByConversation.delete(command.browserConversationId);
      }
      this.emit("pageReleased", browserIdentity(command));
      this.emitBrowserUseState();
      return;
    }

    if (command.type === "browser-use-set-active-tab") {
      if (command.browserTabId === null) {
        this.browserUseActiveTabIdsByConversation.delete(command.browserConversationId);
      } else {
        this.browserUseActiveTabIdsByConversation.set(
          command.browserConversationId,
          command.browserTabId,
        );
      }
      this.emitBrowserUseState();
      return;
    }

    if (command.type === "browser-use-set-cursor") {
      this.browserUseCursors.set(browserTabKey(command.cursor), command.cursor);
      this.emit("browserUseCursor", command.cursor);
      this.emitBrowserUseState();
      return;
    }

    if (command.type === "browser-use-set-viewport") {
      const key = browserTabKey(command.event);
      this.browserUseViewportSizes.set(key, command.event);
      this.emit("browserUseViewport", command.event);
      return;
    }

    if (command.type === "browser-use-set-capture-surface") {
      const key = browserTabKey(command.event);
      this.browserUseCaptureSurfaces.set(key, command.event);
      this.emit("browserUseCaptureSurface", command.event);
    }
  }

  private syncBrowserUseViewport(
    identity: BrowserSidebarTabIdentity,
    viewport: BrowserSidebarViewport,
  ): void {
    const key = browserTabKey(identity);
    const browserUseTab = this.browserUseTabs.get(key);
    if (!browserUseTab) return;
    this.browserUseTabs.set(key, {
      ...browserUseTab,
      viewport,
      updatedAt: Date.now(),
    });
    const event: BrowserSidebarBrowserUseViewportEvent = {
      ...browserIdentity(identity),
      viewportSize: viewport.width > 0 && viewport.height > 0
        ? { width: viewport.width, height: viewport.height }
        : null,
    };
    this.browserUseViewportSizes.set(key, event);
    this.emit("browserUseViewport", event);
    this.emitBrowserUseState();
  }
}

function clampZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(300, Math.max(25, Math.round(value)));
}

function stepZoomPercent(current: number, delta: number): number {
  const next = current + delta;
  return clampZoomPercent(next);
}

function deriveBrowserSnapshot(snapshot: BrowserSidebarTabSnapshot): BrowserSidebarTabSnapshot {
  const hasBrowserPage = !isBlankBrowserUrl(snapshot.url);
  return {
    ...snapshot,
    hasBrowserPage,
    pageActionsDisabled: !hasBrowserPage || snapshot.url.trim().length === 0,
    interactionMode: snapshot.interactionMode ?? "browse",
    findState: snapshot.findState ?? DEFAULT_BROWSER_SIDEBAR_FIND_STATE,
  };
}

function stripUndefinedProperties<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function parseProjectSessionIdFromTerminalId(terminalSessionId: string): string | null {
  if (!terminalSessionId.startsWith("session:")) return null;
  const suffixIndex = terminalSessionId.lastIndexOf(":terminal:");
  if (suffixIndex <= "session:".length) return null;
  return terminalSessionId.slice("session:".length, suffixIndex);
}

function isLocalServerUrl(url: URL): boolean {
  return url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "::1"
    || url.hostname === "[::1]";
}

function isBrowserUseCommand(command: BrowserSidebarCommand): command is BrowserUseCommand {
  return command.type === "browser-use-upsert-tab"
    || command.type === "browser-use-release-tab"
    || command.type === "browser-use-set-active-tab"
    || command.type === "browser-use-set-cursor"
    || command.type === "browser-use-set-viewport"
    || command.type === "browser-use-set-capture-surface";
}

function readLocalServerOrigin(rawUrl: string): string {
  try {
    return new URL(normalizeBrowserNavigationUrl(rawUrl)).origin;
  } catch {
    return rawUrl;
  }
}

function normalizeRoutePath(rawUrl: string): string {
  try {
    const parsed = new URL(normalizeBrowserNavigationUrl(rawUrl));
    return parsed.pathname || "/";
  } catch {
    if (rawUrl.startsWith("/")) return rawUrl;
    return `/${rawUrl}`;
  }
}

async function probeLocalServer(origin: string): Promise<boolean> {
  if (typeof fetch !== "function") return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(origin, {
      method: "HEAD",
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isNavigationAbortError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; errno?: unknown; message?: unknown };
    if (record.code === "ERR_ABORTED") return true;
    if (record.errno === -3) return true;
    if (typeof record.message === "string" && record.message.includes("ERR_ABORTED")) return true;
  }
  return false;
}

function readUrlFromEventArgs(args: unknown[], fallback: string): string {
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    if (arg.startsWith("http:") || arg.startsWith("https:") || arg.startsWith("file:") || arg.startsWith("about:")) {
      return arg;
    }
  }
  return fallback;
}

function readTitleFromEventArgs(args: unknown[], fallback: string): string {
  for (const arg of args) {
    if (typeof arg === "string" && arg.trim().length > 0) return arg.trim();
  }
  return fallback;
}

function readFaviconFromEventArgs(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (!Array.isArray(arg)) continue;
    const favicon = arg.find((item): item is string => typeof item === "string" && item.length > 0);
    if (favicon) return favicon;
  }
  return undefined;
}

function readErrorCodeFromEventArgs(args: unknown[]): number | null {
  for (const arg of args) {
    if (typeof arg === "number" && Number.isFinite(arg)) return arg;
  }
  return null;
}

function readErrorDescriptionFromEventArgs(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    if (arg.startsWith("http:") || arg.startsWith("https:") || arg.startsWith("file:") || arg.startsWith("about:")) continue;
    if (arg.trim().length > 0) return arg.trim();
  }
  return undefined;
}

function readFoundInPageResult(args: unknown[]): { activeMatchOrdinal: number | null; matches: number | null } | null {
  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;
    const record = arg as { activeMatchOrdinal?: unknown; matches?: unknown };
    return {
      activeMatchOrdinal: typeof record.activeMatchOrdinal === "number" ? record.activeMatchOrdinal : null,
      matches: typeof record.matches === "number" ? record.matches : null,
    };
  }
  return null;
}

function makeLocalServerId(origin: string): string {
  return origin;
}

function makeLocalServerRouteId(origin: string, pathname: string): string {
  return `${origin}${pathname || "/"}`;
}

export function broadcastBrowserSidebarEvent<EventName extends keyof BrowserSidebarServiceEvents>(
  eventName: EventName,
  payload: BrowserSidebarServiceEvents[EventName][0],
): void {
  safeBroadcastToWindows(BrowserWindow.getAllWindows(), resolveBrowserSidebarIpcEventName(eventName), [payload]);
}

function resolveBrowserSidebarIpcEventName(eventName: keyof BrowserSidebarServiceEvents): string {
  if (eventName === "localServers") return "browser-sidebar-local-servers";
  if (eventName === "browserUseState") return "browser-sidebar-browser-use-state";
  if (eventName === "browserUseViewport") return "browser-sidebar-browser-use-viewport";
  if (eventName === "browserUseCaptureSurface") return "browser-sidebar-browser-use-capture-surface";
  if (eventName === "browserUseCursor") return "browser-sidebar-browser-use-cursor-state";
  if (eventName === "pageReleased") return "browser-sidebar-browser-use-page-released";
  if (eventName === "webviewAttached") return "browser-sidebar-webview-attached";
  if (eventName === "destroyWebview") return "browser-sidebar-destroy-webview";
  return "browser-sidebar-state";
}

export const browserSidebarService = new BrowserSidebarService();
