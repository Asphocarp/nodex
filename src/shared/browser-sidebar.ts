export const BROWSER_SIDEBAR_PARTITION = "persist:codex-browser-app";

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

export interface BrowserSidebarDevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const BROWSER_SIDEBAR_DEVICE_PRESETS: readonly BrowserSidebarDevicePreset[] = [
  { id: "responsive", label: "Responsive", width: 0, height: 0 },
  { id: "4k", label: "4K", width: 3840, height: 2160 },
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

export interface BrowserSidebarTabSnapshot {
  tabId: string;
  sessionId: string;
  projectId: string;
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
  tabId: string | null;
  x: number;
  y: number;
  visible: boolean;
  updatedAt: number;
}

export interface BrowserUseTabState {
  tabId: string;
  projectId: string;
  sessionId?: string;
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
  activeTabId: string | null;
  cursor: BrowserUseCursorState;
}

export interface BrowserSidebarBrowserUseViewportEvent {
  tabId: string | null;
  viewportSize: BrowserSidebarSize | null;
}

export interface BrowserSidebarBrowserUseCaptureSurfaceEvent {
  tabId: string | null;
  surfaceSize: BrowserSidebarSize | null;
}

export type BrowserBrowsingDataKind = "cookies" | "cache";

export type BrowserSidebarWebviewHostKind = "panel" | "background" | "retained";
export type BrowserSidebarWebviewDestroyReason = "closed" | "reset" | "replaced" | "stale" | "unmounted";

export interface BrowserSidebarWebviewHostCreated {
  sessionId: string;
  projectId: string;
  tabId: string;
  hostKind: BrowserSidebarWebviewHostKind;
  mountGeneration: number;
  webContentsId: number;
  initialUrl: string;
  title?: string;
}

export interface BrowserSidebarWebviewAttached {
  tabId: string;
  mountGeneration: number;
  webContentsId: number;
}

export interface BrowserSidebarDestroyWebviewRequest {
  tabId: string;
  mountGeneration: number;
  reason: BrowserSidebarWebviewDestroyReason;
  teardownId: string;
}

export interface BrowserSidebarWebviewDestroyed {
  tabId: string;
  mountGeneration: number;
  reason: BrowserSidebarWebviewDestroyReason;
  teardownId: string;
  webContentsId?: number;
}

export type BrowserSidebarCommand =
  | {
    type: "register-tab";
    tabId: string;
    sessionId: string;
    projectId: string;
    initialUrl?: string;
    title?: string;
    faviconUrl?: string;
    deviceToolbarVisible?: boolean;
  }
  | { type: "navigate"; tabId: string; url: string; hostId?: string; source?: "manual" | "local-server" | "browser-use"; initiator?: string; originalUrl?: string }
  | { type: "go-back"; tabId: string }
  | { type: "go-forward"; tabId: string }
  | { type: "reload"; tabId: string; ignoreCache?: boolean }
  | { type: "stop"; tabId: string }
  | { type: "open-external"; tabId?: string; url?: string }
  | { type: "close-tab"; tabId: string }
  | { type: "set-title"; tabId: string; title: string }
  | { type: "set-favicon"; tabId: string; faviconUrl?: string }
  | { type: "step-zoom"; tabId: string; delta: number; showBanner?: boolean }
  | { type: "set-zoom-percent"; tabId: string; zoomPercent: number; showBanner?: boolean }
  | { type: "reset-zoom"; tabId: string; showBanner?: boolean }
  | { type: "set-device-toolbar-visible"; tabId: string; visible: boolean }
  | { type: "set-viewport"; tabId: string; viewport: BrowserSidebarViewport }
  | { type: "set-interaction-mode"; tabId: string; mode: BrowserSidebarInteractionMode }
  | { type: "open-find"; tabId: string }
  | { type: "close-find"; tabId: string }
  | { type: "set-find-query"; tabId: string; query: string; caseSensitive?: boolean }
  | { type: "find-next"; tabId: string }
  | { type: "find-previous"; tabId: string }
  | { type: "capture-screenshot"; tabId: string }
  | { type: "local-servers-refresh"; projectId: string }
  | { type: "hide-local-server"; projectId: string; server: BrowserSidebarLocalServer }
  | { type: "unhide-local-server"; projectId: string; url: string }
  | { type: "remove-local-server-route"; projectId: string; serverUrl: string; routeUrl: string }
  | { type: "browser-use-upsert-tab"; tab: BrowserUseTabState }
  | { type: "browser-use-release-tab"; tabId: string }
  | { type: "browser-use-set-active-tab"; tabId: string | null }
  | { type: "browser-use-set-cursor"; cursor: BrowserUseCursorState }
  | { type: "browser-use-set-viewport"; event: BrowserSidebarBrowserUseViewportEvent }
  | { type: "browser-use-set-capture-surface"; event: BrowserSidebarBrowserUseCaptureSurfaceEvent };

export type BrowserSidebarCommandResult =
  | { ok: true; dataUrl?: string; snapshot?: BrowserSidebarTabSnapshot }
  | { ok: false; message: string };

export type BrowserBrowsingDataClearResult =
  | { ok: true }
  | { ok: false; message: string };
