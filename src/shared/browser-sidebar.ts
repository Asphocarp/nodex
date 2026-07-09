export const BROWSER_SIDEBAR_PARTITION = "persist:codex-browser-app";
export const BROWSER_SIDEBAR_ROUTE_PARTITION_PREFIX =
  "persist:codex-browser-app-route:";

export const BROWSER_SIDEBAR_ZOOM_OPTIONS = [50, 75, 100, 125, 150, 200] as const;

export interface BrowserSidebarViewport {
  width: number;
  height: number;
  zoomPercent: number;
  presetId: string;
}

export interface BrowserSidebarSize {
  width: number;
  height: number;
}

export interface BrowserSidebarTabIdentity {
  browserConversationId: string;
  browserTabId: string;
}

export function makeBrowserSidebarTabKey(
  identity: BrowserSidebarTabIdentity,
): string {
  return `${identity.browserConversationId}\0${identity.browserTabId}`;
}

export function makeDefaultBrowserSidebarTabId(
  browserConversationId: string,
): string {
  return `${browserConversationId}:legacy`;
}

export function requireProjectSessionBrowserTabId(tab: {
  readonly browserTabId: string | null;
  readonly kind: string;
}): string {
  const browserTabId = tab.browserTabId?.trim();
  if (tab.kind !== "browser" || !browserTabId) {
    throw new Error("Expected a browser tab with a logical browser identity");
  }
  return browserTabId;
}

export function makeBrowserSidebarRoutePartition(
  identity: BrowserSidebarTabIdentity,
): string {
  return `${BROWSER_SIDEBAR_ROUTE_PARTITION_PREFIX}${encodeURIComponent(
    makeBrowserSidebarTabKey(identity),
  )}`;
}

export function parseBrowserSidebarRoutePartition(
  partition: string | null | undefined,
): BrowserSidebarTabIdentity | null {
  if (!partition?.startsWith(BROWSER_SIDEBAR_ROUTE_PARTITION_PREFIX)) return null;
  try {
    const decoded = decodeURIComponent(
      partition.slice(BROWSER_SIDEBAR_ROUTE_PARTITION_PREFIX.length),
    );
    const separatorIndex = decoded.indexOf("\0");
    if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) return null;
    return {
      browserConversationId: decoded.slice(0, separatorIndex),
      browserTabId: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export interface BrowserSidebarDeviceToolbarState {
  responsiveViewportSize: BrowserSidebarSize | null;
  toolbarState: {
    isEnabled: boolean;
    presetId: string;
    width: number;
    height: number;
  };
}

export interface BrowserSidebarDevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const BROWSER_SIDEBAR_DEVICE_PRESETS: readonly BrowserSidebarDevicePreset[] = [
  { id: "responsive", label: "Responsive", width: 390, height: 844 },
  { id: "4k", label: "4K", width: 2560, height: 1440 },
  { id: "laptop-l", label: "Laptop L", width: 1440, height: 900 },
  { id: "laptop", label: "Laptop", width: 1024, height: 768 },
  { id: "surface-pro-7", label: "Surface Pro 7", width: 912, height: 1368 },
  { id: "ipad-air", label: "iPad Air", width: 820, height: 1180 },
  { id: "ipad-mini", label: "iPad Mini", width: 768, height: 1024 },
  { id: "surface-duo", label: "Surface Duo", width: 540, height: 720 },
  { id: "iphone-15-pro-max", label: "iPhone 15 Pro Max", width: 430, height: 932 },
  { id: "pixel-8", label: "Pixel 8", width: 412, height: 915 },
  { id: "iphone-15-pro", label: "iPhone 15 Pro", width: 393, height: 852 },
  { id: "samsung-galaxy-s24-ultra", label: "Samsung Galaxy S24 Ultra", width: 384, height: 824 },
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667 },
];

export type BrowserSidebarInteractionMode = "browse" | "comment";

export interface BrowserSidebarFindState {
  open: boolean;
  query: string;
  activeMatchOrdinal: number | null;
  matchCount: number | null;
  caseSensitive: boolean;
}

export const DEFAULT_BROWSER_SIDEBAR_FIND_STATE: BrowserSidebarFindState = {
  open: false,
  query: "",
  activeMatchOrdinal: null,
  matchCount: null,
  caseSensitive: false,
};

export interface BrowserSidebarTabSnapshot extends BrowserSidebarTabIdentity {
  projectId: string | null;
  webContentsId: number | null;
  mountGeneration: number;
  url: string;
  pendingUrl?: string;
  title: string;
  faviconUrl?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomPercent: number;
  deviceToolbarVisible: boolean;
  viewport: BrowserSidebarViewport;
  deviceToolbarState: BrowserSidebarDeviceToolbarState;
  interactionMode: BrowserSidebarInteractionMode;
  findState: BrowserSidebarFindState;
  hasBrowserPage: boolean;
  pageActionsDisabled: boolean;
  errorMessage?: string;
  updatedAt: number;
}

export interface BrowserSidebarStateSnapshot {
  tabs: BrowserSidebarTabSnapshot[];
}

export interface BrowserSidebarClonedTabInput extends BrowserSidebarTabIdentity {
  projectId: string | null;
  initialUrl?: string;
  deviceToolbarState: BrowserSidebarDeviceToolbarState;
}

export interface BrowserSidebarLocalServerRoute {
  id: string;
  path: string;
  title: string;
  lastSeenAt: number;
  hidden: boolean;
}

export interface BrowserSidebarLocalServer {
  id: string;
  origin: string;
  host: string;
  port: number;
  protocol: "http:" | "https:";
  lastSeenAt: number;
  online: boolean;
  hidden: boolean;
  routes: BrowserSidebarLocalServerRoute[];
}

export interface BrowserSidebarLocalServersSnapshot {
  projectId: string;
  isLoading: boolean;
  servers: BrowserSidebarLocalServer[];
  hiddenServerIds: string[];
  hiddenRouteIds: string[];
  updatedAt: number;
}

export interface BrowserUseCursorState {
  browserConversationId: string;
  browserTabId: string;
  x: number;
  y: number;
  visible: boolean;
  updatedAt: number;
}

export interface BrowserUseTabState extends BrowserSidebarTabIdentity {
  projectId: string | null;
  title: string;
  url: string;
  webContentsId: number | null;
  viewport: BrowserSidebarViewport;
  captureActive: boolean;
  released: boolean;
  updatedAt: number;
}

export interface BrowserSidebarBrowserUseStateSnapshot {
  tabs: BrowserUseTabState[];
  activeBrowserTabIdsByConversation: Record<string, string>;
  cursors: BrowserUseCursorState[];
}

export interface BrowserSidebarBrowserUseViewportEvent extends BrowserSidebarTabIdentity {
  viewportSize: BrowserSidebarSize | null;
}

export interface BrowserSidebarBrowserUseCaptureSurfaceEvent extends BrowserSidebarTabIdentity {
  surfaceSize: BrowserSidebarSize | null;
}

export type BrowserBrowsingDataKind = "cookies" | "cache";

export type BrowserSidebarWebviewHostKind = "panel" | "background" | "retained";
export type BrowserSidebarWebviewDestroyReason = "closed" | "reset" | "replaced" | "stale" | "unmounted";

export interface BrowserSidebarWebviewHostCreated extends BrowserSidebarTabIdentity {
  projectId: string | null;
  hostKind: BrowserSidebarWebviewHostKind;
  mountGeneration: number;
  webContentsId: number;
  initialUrl: string;
  title?: string;
}

export interface BrowserSidebarWebviewAttached extends BrowserSidebarTabIdentity {
  mountGeneration: number;
  webContentsId: number;
}

export interface BrowserSidebarDestroyWebviewRequest extends BrowserSidebarTabIdentity {
  mountGeneration: number;
  reason: BrowserSidebarWebviewDestroyReason;
  teardownId: string;
}

export interface BrowserSidebarWebviewDestroyed extends BrowserSidebarTabIdentity {
  mountGeneration: number;
  reason: BrowserSidebarWebviewDestroyReason;
  teardownId: string;
  webContentsId?: number;
}

type BrowserSidebarTargetedCommand<Command> = Command & BrowserSidebarTabIdentity;

export type BrowserSidebarCommand =
  | {
    type: "register-tab";
    browserConversationId: string;
    browserTabId: string;
    projectId: string | null;
    initialUrl?: string;
    title?: string;
    faviconUrl?: string;
    deviceToolbarVisible?: boolean;
  }
  | BrowserSidebarTargetedCommand<{ type: "navigate"; url: string; hostId?: string; source?: "manual" | "local-server" | "browser-use"; initiator?: string; originalUrl?: string }>
  | BrowserSidebarTargetedCommand<{ type: "go-back" }>
  | BrowserSidebarTargetedCommand<{ type: "go-forward" }>
  | BrowserSidebarTargetedCommand<{ type: "reload"; ignoreCache?: boolean }>
  | BrowserSidebarTargetedCommand<{ type: "stop" }>
  | { type: "open-external"; url: string }
  | BrowserSidebarTargetedCommand<{ type: "open-external"; url?: undefined }>
  | BrowserSidebarTargetedCommand<{ type: "close-tab" }>
  | BrowserSidebarTargetedCommand<{ type: "set-title"; title: string }>
  | BrowserSidebarTargetedCommand<{ type: "set-favicon"; faviconUrl?: string }>
  | BrowserSidebarTargetedCommand<{ type: "step-zoom"; delta: number; showBanner?: boolean }>
  | BrowserSidebarTargetedCommand<{ type: "set-zoom-percent"; zoomPercent: number; showBanner?: boolean }>
  | BrowserSidebarTargetedCommand<{ type: "reset-zoom"; showBanner?: boolean }>
  | BrowserSidebarTargetedCommand<{ type: "set-device-toolbar-visible"; visible: boolean }>
  | BrowserSidebarTargetedCommand<{ type: "set-viewport"; viewport: BrowserSidebarViewport }>
  | BrowserSidebarTargetedCommand<{ type: "set-interaction-mode"; mode: BrowserSidebarInteractionMode }>
  | BrowserSidebarTargetedCommand<{ type: "open-find" }>
  | BrowserSidebarTargetedCommand<{ type: "close-find" }>
  | BrowserSidebarTargetedCommand<{ type: "set-find-query"; query: string; caseSensitive?: boolean }>
  | BrowserSidebarTargetedCommand<{ type: "find-next" }>
  | BrowserSidebarTargetedCommand<{ type: "find-previous" }>
  | BrowserSidebarTargetedCommand<{ type: "capture-screenshot" }>
  | { type: "local-servers-refresh"; projectId: string }
  | { type: "hide-local-server"; projectId: string; server: BrowserSidebarLocalServer }
  | { type: "unhide-local-server"; projectId: string; url: string }
  | { type: "remove-local-server-route"; projectId: string; serverUrl: string; routeUrl: string }
  | { type: "browser-use-upsert-tab"; tab: BrowserUseTabState }
  | BrowserSidebarTargetedCommand<{ type: "browser-use-release-tab" }>
  | { type: "browser-use-set-active-tab"; browserConversationId: string; browserTabId: string | null }
  | { type: "browser-use-set-cursor"; cursor: BrowserUseCursorState }
  | { type: "browser-use-set-viewport"; event: BrowserSidebarBrowserUseViewportEvent }
  | { type: "browser-use-set-capture-surface"; event: BrowserSidebarBrowserUseCaptureSurfaceEvent };

export type BrowserSidebarCommandResult =
  | { ok: true; dataUrl?: string; snapshot?: BrowserSidebarTabSnapshot }
  | { ok: false; message: string };

export type BrowserBrowsingDataClearResult =
  | { ok: true }
  | { ok: false; message: string };
