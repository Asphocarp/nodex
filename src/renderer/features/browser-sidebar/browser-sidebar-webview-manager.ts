import {
  makeBrowserSidebarRoutePartition,
  makeBrowserSidebarTabKey,
  type BrowserSidebarDestroyWebviewRequest,
  type BrowserSidebarWebviewDestroyed,
  type BrowserSidebarWebviewHostCreated,
  type BrowserSidebarWebviewHostKind,
} from "../../../shared/browser-sidebar";
import { APP_SHELL_BROWSER_WEBVIEW_LAYER_INDEX } from "../../lib/app-shell-layers";
import { isBlankBrowserUrl, normalizeBrowserNavigationUrl } from "../../../shared/browser-url";

export const BROWSER_SIDEBAR_VISIBLE_WEBVIEW_Z_INDEX = 2147483647;
export const BROWSER_SIDEBAR_WEBVIEW_LAYER_ROOT_Z_INDEX = APP_SHELL_BROWSER_WEBVIEW_LAYER_INDEX;
const BROWSER_SIDEBAR_WEBVIEW_LAYER_ROOT_ATTRIBUTE = "data-browser-sidebar-webview-manager-layer-root";

export type BrowserSidebarWebviewElement = HTMLElement & {
  getWebContentsId?: () => number;
  getTitle?: () => string;
  getURL?: () => string;
};

export interface BrowserSidebarWebviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WebviewHostKey {
  browserConversationId: string;
  browserTabId: string;
}

interface ManagedWebviewInput extends WebviewHostKey {
  projectId: string | null;
  hostKind: BrowserSidebarWebviewHostKind;
  initialUrl: string;
}

interface SyncWebviewInput extends ManagedWebviewInput {
  bounds: BrowserSidebarWebviewBounds | null;
  mountGeneration: number;
  isVisible?: boolean;
  shouldPaint?: boolean;
  scale?: number;
  windowZoom?: number;
  onHostCreated: (event: BrowserSidebarWebviewHostCreated) => void;
}

interface ManagedBrowserWebviewHost {
  container: HTMLDivElement;
  cursorOverlayHost: HTMLDivElement;
  disposed: boolean;
  hostKind: BrowserSidebarWebviewHostKind;
  isVisible: boolean;
  mountGeneration: number;
  webview: BrowserSidebarWebviewElement;
  detach(mountGeneration: number): void;
  dispose(): void;
  shouldDestroyForHostRequest(request: BrowserSidebarDestroyWebviewRequest): boolean;
  sync(input: SyncWebviewInput): void;
}

class BrowserSidebarRendererWebviewHost implements ManagedBrowserWebviewHost {
  readonly container = document.createElement("div");
  readonly cursorOverlayHost = document.createElement("div");
  readonly webview: BrowserSidebarWebviewElement;
  disposed = false;
  hostKind: BrowserSidebarWebviewHostKind;
  isVisible = false;
  mountGeneration = 0;
  private bounds: BrowserSidebarWebviewBounds | null = null;
  private readonly disposers: Array<() => void> = [];
  private notifiedMountGeneration: number | null = null;
  private latestInput: SyncWebviewInput | null = null;
  private scale = 1;
  private shouldPaint = true;
  private windowZoom = 1;

  constructor(private readonly input: ManagedWebviewInput) {
    this.hostKind = input.hostKind;
    this.webview = document.createElement("webview") as BrowserSidebarWebviewElement;
    this.container.setAttribute("data-browser-sidebar-webview-manager-root", "");
    this.container.setAttribute("data-browser-sidebar-conversation-id", input.browserConversationId);
    this.container.setAttribute("data-browser-sidebar-browser-tab-id", input.browserTabId);
    this.container.setAttribute("data-browser-sidebar-webview-host-kind", input.hostKind);
    this.webview.className = "h-full w-full";
    this.webview.style.display = "flex";
    this.webview.style.width = "100%";
    this.webview.style.height = "100%";
    this.webview.setAttribute("partition", makeBrowserSidebarRoutePartition(input));
    this.webview.setAttribute("src", normalizeInitialWebviewUrl(input.initialUrl));
    this.webview.setAttribute("data-browser-sidebar-conversation-id", input.browserConversationId);
    this.webview.setAttribute("data-browser-sidebar-browser-tab-id", input.browserTabId);
    this.webview.setAttribute("data-browser-sidebar-webview-host-root", "");
    this.webview.setAttribute("data-browser-sidebar-webview-host-kind", input.hostKind);
    this.webview.setAttribute("allowpopups", "false");

    this.cursorOverlayHost.className = "pointer-events-none absolute inset-0";
    this.cursorOverlayHost.setAttribute("data-browser-sidebar-cursor-overlay-host", "");
    this.container.append(this.webview, this.cursorOverlayHost);
    this.syncContainerStyle();
    ensureBrowserSidebarWebviewHostParent(this.container, input.hostKind);
  }

  sync(input: SyncWebviewInput): void {
    if (this.disposed) return;
    this.hostKind = input.hostKind;
    this.isVisible = input.isVisible !== false;
    this.mountGeneration = input.mountGeneration;
    this.bounds = input.bounds;
    this.latestInput = input;
    this.scale = input.scale ?? 1;
    this.shouldPaint = input.shouldPaint !== false;
    this.windowZoom = input.windowZoom ?? 1;
    this.container.setAttribute("data-browser-sidebar-conversation-id", input.browserConversationId);
    this.container.setAttribute("data-browser-sidebar-browser-tab-id", input.browserTabId);
    this.container.setAttribute("data-browser-sidebar-webview-host-kind", input.hostKind);
    this.webview.setAttribute("data-browser-sidebar-mount-generation", String(input.mountGeneration));
    if (input.projectId === null) {
      this.webview.removeAttribute("data-browser-sidebar-project-id");
    } else {
      this.webview.setAttribute("data-browser-sidebar-project-id", input.projectId);
    }
    this.webview.setAttribute("data-browser-sidebar-webview-host-kind", input.hostKind);

    ensureBrowserSidebarWebviewHostParent(this.container, input.hostKind);
    this.syncContainerStyle();

    this.ensureLifecycleListeners();
  }

  detach(mountGeneration: number): void {
    queueMicrotask(() => {
      if (this.disposed) return;
      if (this.mountGeneration !== mountGeneration) return;
      this.background();
    });
  }

  shouldDestroyForHostRequest(request: BrowserSidebarDestroyWebviewRequest): boolean {
    return request.reason === "closed"
      || (this.mountGeneration === request.mountGeneration && !this.isVisible);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.container.remove();
    this.disposed = true;
  }

  private background(): void {
    this.isVisible = false;
    this.syncContainerStyle();
  }

  private syncContainerStyle(): void {
    const bounds = this.bounds;
    const shouldPaint = this.isVisible
      && this.shouldPaint
      && bounds !== null
      && bounds.width > 0
      && bounds.height > 0;
    if (shouldPaint && bounds) {
      Object.assign(this.container.style, {
        position: "fixed",
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        visibility: "visible",
        opacity: "1",
        pointerEvents: "auto",
        overflow: "hidden",
        zIndex: resolveBrowserSidebarVisibleWebviewZIndex(this.hostKind),
        contain: "layout style paint",
        transform: this.scale === 1 ? "" : `scale(${this.scale})`,
        transformOrigin: "top left",
      });
    } else {
      Object.assign(this.container.style, {
        position: "fixed",
        left: "-10000px",
        top: "0px",
        width: "1px",
        height: "1px",
        visibility: "hidden",
        opacity: "0",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: "",
        contain: "",
        transform: "",
        transformOrigin: "",
      });
    }
    const size = shouldPaint ? "100%" : "1px";
    this.webview.className = shouldPaint ? "h-full w-full" : "";
    this.webview.style.display = "flex";
    this.webview.style.width = size;
    this.webview.style.height = size;
    this.webview.style.visibility = shouldPaint ? "" : "hidden";
    this.webview.style.opacity = shouldPaint ? "" : "0";
    this.webview.style.pointerEvents = shouldPaint ? "" : "none";
    this.webview.style.backgroundColor = "";
    this.cursorOverlayHost.className = shouldPaint
      ? "pointer-events-none absolute inset-0"
      : "pointer-events-none";
    this.container.setAttribute("data-browser-sidebar-webview-visible", shouldPaint ? "true" : "false");
    this.container.setAttribute("data-browser-sidebar-window-zoom", String(this.windowZoom));
  }

  private ensureLifecycleListeners(): void {
    if (this.disposers.length > 0) return;

    const notify = () => this.notifyHostCreated();
    const disposed = () => {
      this.disposed = true;
      this.container.remove();
    };
    this.webview.addEventListener("did-attach", notify);
    this.webview.addEventListener("dom-ready", notify);
    this.webview.addEventListener("destroyed", disposed);
    this.disposers.push(
      () => this.webview.removeEventListener("did-attach", notify),
      () => this.webview.removeEventListener("dom-ready", notify),
      () => this.webview.removeEventListener("destroyed", disposed),
    );
  }

  private notifyHostCreated(input?: SyncWebviewInput): void {
    const latestInput = this.latestInput ?? input;
    if (!latestInput) return;
    let webContentsId: number | undefined;
    try {
      webContentsId = this.webview.getWebContentsId?.();
    } catch {
      return;
    }
    if (typeof webContentsId !== "number") return;
    if (this.notifiedMountGeneration === latestInput.mountGeneration) return;
    this.notifiedMountGeneration = latestInput.mountGeneration;
    let title: string | undefined;
    try {
      title = this.webview.getTitle?.();
    } catch {
      title = undefined;
    }
    latestInput.onHostCreated({
      browserConversationId: latestInput.browserConversationId,
      browserTabId: latestInput.browserTabId,
      projectId: latestInput.projectId,
      hostKind: latestInput.hostKind,
      mountGeneration: latestInput.mountGeneration,
      webContentsId,
      initialUrl: normalizeInitialWebviewUrl(latestInput.initialUrl),
      title,
    });
  }
}

export class BrowserSidebarRendererWebviewManager {
  private readonly hosts = new Map<string, ManagedBrowserWebviewHost>();
  private readonly mountGenerations = new Map<string, number>();

  claimMountGeneration(input: WebviewHostKey): number {
    const key = makeHostKey(input);
    const next = (this.mountGenerations.get(key) ?? 0) + 1;
    this.mountGenerations.set(key, next);
    return next;
  }

  releaseMountGeneration(input: WebviewHostKey): number {
    return this.mountGenerations.get(makeHostKey(input)) ?? 0;
  }

  getWebview(input: ManagedWebviewInput): ManagedBrowserWebviewHost {
    const key = makeHostKey(input);
    const existing = this.hosts.get(key);
    if (existing && !existing.disposed) return existing;
    existing?.dispose();
    const host = new BrowserSidebarRendererWebviewHost(input);
    this.hosts.set(key, host);
    return host;
  }

  syncWebview(input: SyncWebviewInput): ManagedBrowserWebviewHost {
    const host = this.getWebview(input);
    host.sync(input);
    return host;
  }

  detachWebview(input: WebviewHostKey, mountGeneration: number): void {
    this.hosts.get(makeHostKey(input))?.detach(mountGeneration);
  }

  destroyWebviewAtHostRequest(
    request: BrowserSidebarDestroyWebviewRequest,
    onDestroyed: (event: BrowserSidebarWebviewDestroyed) => void,
  ): void {
    const key = makeHostKey(request);
    const managedHost = this.hosts.get(key);
    const shouldDestroy = managedHost?.shouldDestroyForHostRequest(request) ?? false;
    let webContentsId: number | undefined;
    try {
      webContentsId = managedHost?.webview.getWebContentsId?.();
    } catch {
      webContentsId = undefined;
    }
    if (shouldDestroy && managedHost) {
      managedHost.dispose();
      this.hosts.delete(key);
    }
    onDestroyed({
      browserConversationId: request.browserConversationId,
      browserTabId: request.browserTabId,
      mountGeneration: request.mountGeneration,
      reason: request.reason,
      teardownId: request.teardownId,
      webContentsId,
    });
    if (shouldDestroy) {
      this.mountGenerations.delete(key);
    }
  }

  getCursorOverlayHost(input: WebviewHostKey): HTMLElement | null {
    return this.hosts.get(makeHostKey(input))?.cursorOverlayHost ?? null;
  }

  disposeAll(): void {
    for (const host of this.hosts.values()) host.dispose();
    this.hosts.clear();
    this.mountGenerations.clear();
  }
}

function normalizeInitialWebviewUrl(url: string): string {
  return isBlankBrowserUrl(url) ? "about:blank" : normalizeBrowserNavigationUrl(url);
}

function makeHostKey(input: WebviewHostKey): string {
  return makeBrowserSidebarTabKey(input);
}

function getBrowserSidebarWebviewLayerRoot(): HTMLDivElement {
  const existing = document.body.querySelector<HTMLDivElement>(
    `[${BROWSER_SIDEBAR_WEBVIEW_LAYER_ROOT_ATTRIBUTE}]`,
  );
  if (existing) return existing;

  const root = document.createElement("div");
  root.setAttribute(BROWSER_SIDEBAR_WEBVIEW_LAYER_ROOT_ATTRIBUTE, "");
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: String(BROWSER_SIDEBAR_WEBVIEW_LAYER_ROOT_Z_INDEX),
  });
  document.body.append(root);
  return root;
}

function ensureBrowserSidebarWebviewHostParent(
  container: HTMLDivElement,
  hostKind: BrowserSidebarWebviewHostKind,
): void {
  const parent = hostKind === "retained" ? document.body : getBrowserSidebarWebviewLayerRoot();
  if (container.parentElement === parent) return;
  parent.append(container);
}

function resolveBrowserSidebarVisibleWebviewZIndex(hostKind: BrowserSidebarWebviewHostKind): string {
  if (hostKind !== "retained") return "";
  return String(BROWSER_SIDEBAR_VISIBLE_WEBVIEW_Z_INDEX);
}

export const browserSidebarRendererWebviewManager = new BrowserSidebarRendererWebviewManager();
