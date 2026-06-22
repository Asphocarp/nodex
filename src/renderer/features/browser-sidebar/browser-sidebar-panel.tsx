import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
  type ReactNode,
} from "react";
import type { MotionValue } from "motion/react";
import {
  Check,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  RotateCcw,
  Smartphone,
  X,
} from "lucide-react";
import {
  BROWSER_SIDEBAR_DEVICE_PRESETS,
  DEFAULT_BROWSER_SIDEBAR_FIND_STATE,
  type BrowserBrowsingDataKind,
  type BrowserSidebarBrowserUseViewportEvent,
  type BrowserSidebarBrowserUseStateSnapshot,
  type BrowserSidebarCommand,
  type BrowserSidebarCommandResult,
  type BrowserSidebarLocalServer,
  type BrowserSidebarLocalServersSnapshot,
  type BrowserSidebarTabSnapshot,
  type BrowserSidebarViewport,
  type BrowserSidebarWebviewHostCreated,
  type BrowserUseCursorState,
} from "../../../shared/browser-sidebar";
import { isBlankBrowserUrl, normalizeBrowserNavigationUrl } from "../../../shared/browser-url";
import {
  BROWSER_SIDEBAR_VISIBLE_WEBVIEW_Z_INDEX,
  browserSidebarRendererWebviewManager,
} from "./browser-sidebar-webview-manager";
import {
  readBrowserConfigDeviceToolbarVisible,
  readBrowserConfigFavicon,
  readBrowserConfigTitle,
  readBrowserConfigUrl,
} from "./browser-sidebar-tab-config";
import {
  readBrowserAddressValue,
  resolveBrowserLocalServerSettings,
  resolveBrowserZoomOptions,
  resolveVisibleLocalServers,
  rotateBrowserViewport,
  shouldCommitBrowserAddressEdit,
  shouldSkipBrowserAddressCommit,
  updateBrowserViewportDimension,
  writeBrowserLocalServerExpandedProjects,
  writeBrowserLocalServerShowMode,
  writeBrowserLocalServerSortMode,
  type BrowserLocalServerSettings,
  type BrowserLocalServerShowMode,
  type BrowserLocalServerSortMode,
} from "./browser-sidebar-ui-model";
import type { ProjectSession, ProjectSessionTab } from "@/lib/types";
import { invoke } from "@/lib/api";
import { useRegisterContentSearchBrowserTarget } from "@/features/content-search/content-search-context";
import {
  RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE,
  RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
} from "@/lib/right-panel-composer-overlay-reserve";
import { cn } from "@/lib/utils";
import {
  CodexBrowserAnnotateIcon,
  CodexBrowserBackIcon,
  CodexBrowserExternalIcon,
  CodexBrowserHideIcon,
  CodexBrowserLocalServerFilterIcon,
  CodexBrowserMoreIcon,
  CodexBrowserReloadIcon,
  CodexBrowserScreenshotIcon,
  StopIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownItem,
  NodexDropdownMenu,
  NodexDropdownSeparator,
} from "@/components/ui/dropdown";

type BrowserTab = ProjectSessionTab & { preview?: true };

const BROWSER_CHROME_CLASS =
  "relative z-10 h-toolbar-pane min-w-0 shrink-0 border-b border-token-border bg-token-main-surface-primary";
const BROWSER_CHROME_ROW_CLASS =
  "draggable flex h-full min-w-0 items-center gap-1 px-2 text-token-description-foreground";
const BROWSER_TOOL_BUTTON_CLASS =
  "border-token-border no-drag cursor-interaction flex shrink-0 items-center gap-1 border whitespace-nowrap select-none focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-text-tertiary enabled:hover:bg-token-list-hover-background enabled:hover:text-token-text-primary data-[state=open]:bg-token-list-hover-background border-transparent h-token-button-composer px-2 py-0 text-base leading-[18px] aspect-square justify-center !px-0";
const BROWSER_ADDRESS_BAR_CLASS =
  "group/address-bar flex h-[28px] min-w-0 w-full max-w-[770px] items-center overflow-hidden rounded-[10px] transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-colors cursor-text bg-transparent hover:bg-token-list-hover-background focus-within:bg-transparent focus-within:ring-1 focus-within:ring-inset focus-within:ring-token-border";
const BROWSER_COLLAPSIBLE_ACTION_CLASS =
  "grid min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-150 ease-out";
const BROWSER_DROPDOWN_CONTENT_STYLE: CSSProperties = {
  zIndex: BROWSER_SIDEBAR_VISIBLE_WEBVIEW_Z_INDEX,
};
const LOCAL_SERVER_THUMBNAIL_DATA_URI =
  "data:image/svg+xml,%3Csvg width='84' height='52' viewBox='0 0 84 52' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='84' height='52' rx='10' fill='%231B1D21'/%3E%3Crect x='10' y='10' width='64' height='7' rx='3.5' fill='%2330363D'/%3E%3Crect x='10' y='23' width='42' height='6' rx='3' fill='%23282D34'/%3E%3Crect x='10' y='34' width='55' height='6' rx='3' fill='%23282D34'/%3E%3Ccircle cx='69' cy='38' r='4' fill='%2316A34A'/%3E%3C/svg%3E";
const DEFAULT_BROWSER_SNAPSHOT: Omit<BrowserSidebarTabSnapshot, "tabId" | "sessionId" | "projectId" | "updatedAt"> = {
  webContentsId: null,
  mountGeneration: 0,
  url: "about:blank",
  title: "New tab",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  zoomPercent: 100,
  deviceToolbarVisible: false,
  viewport: {
    width: 0,
    height: 0,
    zoomPercent: 100,
    presetId: "responsive",
  },
  interactionMode: "browse",
  findState: DEFAULT_BROWSER_SIDEBAR_FIND_STATE,
  hasBrowserPage: false,
  pageActionsDisabled: true,
};

export function BrowserSidebarPanel({
  tab,
  activeSession,
  onRefreshSessions,
  boundsSyncTrigger,
  activeForContentSearch = false,
}: {
  tab: BrowserTab;
  activeSession: ProjectSession;
  onRefreshSessions: (projectId: string) => Promise<ProjectSession[]>;
  boundsSyncTrigger?: MotionValue<number>;
  activeForContentSearch?: boolean;
}) {
  const browserRuntimeAvailable = typeof window !== "undefined" && Boolean(window.api);
  const webviewHostRef = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<BrowserSidebarTabSnapshot>(() =>
    makeInitialSnapshot(tab, activeSession)
  );
  const [addressValue, setAddressValue] = useState(readBrowserAddressValue(snapshot.url));
  const [addressFocused, setAddressFocused] = useState(false);
  const [localServers, setLocalServers] = useState<BrowserSidebarLocalServersSnapshot | null>(null);
  const [browserUseState, setBrowserUseState] = useState<BrowserSidebarBrowserUseStateSnapshot | null>(null);
  const [browserUseCursor, setBrowserUseCursor] = useState<BrowserUseCursorState | null>(null);
  const [browserUseViewport, setBrowserUseViewport] = useState<BrowserSidebarBrowserUseViewportEvent | null>(null);
  const [clearDataStatus, setClearDataStatus] = useState<string | null>(null);
  const isBlank = !snapshot.hasBrowserPage || isBlankBrowserUrl(snapshot.url);
  const commentMode = snapshot.interactionMode === "comment";
  const pageActionsDisabled = snapshot.pageActionsDisabled || isBlank;
  const initialWebviewUrlRef = useRef(snapshot.url);
  if (isBlank) {
    initialWebviewUrlRef.current = "about:blank";
  } else if (isBlankBrowserUrl(initialWebviewUrlRef.current)) {
    initialWebviewUrlRef.current = snapshot.url;
  }

  const command = useCallback(async (input: BrowserSidebarCommand): Promise<BrowserSidebarCommandResult> => {
    return invoke("browser-sidebar-command", input) as Promise<BrowserSidebarCommandResult>;
  }, []);
  const contentSearchBrowserTarget = useMemo(() => {
    if (!activeForContentSearch || pageActionsDisabled) return null;
    return {
      tabId: tab.id,
      available: snapshot.hasBrowserPage && !isBlank,
      findState: snapshot.findState,
      command,
    };
  }, [activeForContentSearch, command, isBlank, pageActionsDisabled, snapshot.findState, snapshot.hasBrowserPage, tab.id]);
  useRegisterContentSearchBrowserTarget(contentSearchBrowserTarget);

  useEffect(() => {
    if (!browserRuntimeAvailable) return undefined;

    void command({
      type: "register-tab",
      tabId: tab.id,
      sessionId: activeSession.id,
      projectId: tab.projectId,
      initialUrl: readBrowserConfigUrl(tab),
      title: tab.title,
      faviconUrl: readBrowserConfigFavicon(tab),
      deviceToolbarVisible: readBrowserConfigDeviceToolbarVisible(tab),
    });
    void command({ type: "local-servers-refresh", projectId: tab.projectId });

    const unsubscribeState = window.api?.on("browser-sidebar-state", (payload) => {
      const state = payload as { tabs?: BrowserSidebarTabSnapshot[] } | undefined;
      const next = state?.tabs?.find((item) => item.tabId === tab.id);
      if (!next) return;
      setSnapshot(next);
    });
    const unsubscribeLocalServers = window.api?.on("browser-sidebar-local-servers", (payload) => {
      const next = payload as BrowserSidebarLocalServersSnapshot | undefined;
      if (next?.projectId !== tab.projectId) return;
      setLocalServers(next);
    });
    const unsubscribeBrowserUse = window.api?.on("browser-sidebar-browser-use-state", (payload) => {
      setBrowserUseState(payload as BrowserSidebarBrowserUseStateSnapshot);
    });
    const unsubscribeBrowserUseViewport = window.api?.on("browser-sidebar-browser-use-viewport", (payload) => {
      setBrowserUseViewport(payload as BrowserSidebarBrowserUseViewportEvent);
    });
    const unsubscribeBrowserUseCursor = window.api?.on("browser-sidebar-browser-use-cursor-state", (payload) => {
      setBrowserUseCursor(payload as BrowserUseCursorState);
    });
    return () => {
      unsubscribeState?.();
      unsubscribeLocalServers?.();
      unsubscribeBrowserUse?.();
      unsubscribeBrowserUseViewport?.();
      unsubscribeBrowserUseCursor?.();
    };
  }, [activeSession.id, browserRuntimeAvailable, command, tab.id, tab.projectId, tab.title]);

  useLayoutEffect(() => {
    if (!browserRuntimeAvailable || isBlank) return undefined;
    const container = webviewHostRef.current;
    if (!container) return undefined;

    const mountGeneration = browserSidebarRendererWebviewManager.claimMountGeneration({
      sessionId: activeSession.id,
      tabId: tab.id,
    });
    const syncCurrentBounds = () => browserSidebarRendererWebviewManager.syncWebview({
      sessionId: activeSession.id,
      projectId: tab.projectId,
      tabId: tab.id,
      hostKind: "panel",
      initialUrl: initialWebviewUrlRef.current,
      bounds: readWebviewHostBounds(container),
      mountGeneration,
      isVisible: true,
      shouldPaint: true,
      onHostCreated: (event: BrowserSidebarWebviewHostCreated) => {
        void invoke("browser-sidebar-webview-host-created", event);
      },
    });
    syncCurrentBounds();

    let animationFrame: number | null = null;
    const syncBounds = () => {
      animationFrame = null;
      syncCurrentBounds();
    };
    const scheduleSyncBounds = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(syncBounds);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleSyncBounds);
    resizeObserver?.observe(container);
    const unsubscribeBoundsSyncTrigger = boundsSyncTrigger?.on("change", scheduleSyncBounds);
    window.addEventListener("resize", scheduleSyncBounds);
    window.addEventListener("scroll", scheduleSyncBounds, true);
    scheduleSyncBounds();

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      unsubscribeBoundsSyncTrigger?.();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleSyncBounds);
      window.removeEventListener("scroll", scheduleSyncBounds, true);
      browserSidebarRendererWebviewManager.detachWebview({
        sessionId: activeSession.id,
        tabId: tab.id,
      }, mountGeneration);
    };
  }, [
    activeSession.id,
    boundsSyncTrigger,
    browserRuntimeAvailable,
    isBlank,
    snapshot.deviceToolbarVisible,
    snapshot.viewport.height,
    snapshot.viewport.presetId,
    snapshot.viewport.width,
    snapshot.viewport.zoomPercent,
    tab.id,
    tab.projectId,
  ]);

  useEffect(() => {
    if (addressFocused) return;
    setAddressValue(readBrowserAddressValue(snapshot.url));
  }, [addressFocused, snapshot.url]);

  useEffect(() => {
    if (tab.preview) return undefined;
    const title = snapshot.title || "Browser";
    const url = isBlankBrowserUrl(snapshot.url) ? undefined : snapshot.url;
    const timeout = window.setTimeout(() => {
      void invoke("project-session-tabs:update", tab.id, {
        title,
        config: {
          projectId: tab.projectId,
          ...(url ? { url } : {}),
          ...(title ? { title } : {}),
          ...(snapshot.faviconUrl ? { faviconUrl: snapshot.faviconUrl } : {}),
          deviceToolbarVisible: snapshot.deviceToolbarVisible,
        },
      }).then(() => onRefreshSessions(tab.projectId));
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [
    onRefreshSessions,
    snapshot.deviceToolbarVisible,
    snapshot.faviconUrl,
    snapshot.title,
    snapshot.url,
    tab.id,
    tab.preview,
    tab.projectId,
  ]);

  const navigateTo = useCallback((rawUrl: string) => {
    const url = normalizeBrowserNavigationUrl(rawUrl);
    const hasBrowserPage = !isBlankBrowserUrl(url);
    setSnapshot((current) => ({
      ...current,
      url,
      pendingUrl: hasBrowserPage ? url : undefined,
      hasBrowserPage,
      pageActionsDisabled: !hasBrowserPage,
      isLoading: hasBrowserPage,
      updatedAt: Date.now(),
    }));
    setAddressValue(readBrowserAddressValue(url));
    void command({
      type: "navigate",
      tabId: tab.id,
      url,
      source: "manual",
      initiator: "address_bar",
      originalUrl: rawUrl,
    });
  }, [command, tab.id]);

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    if (!shouldCommitBrowserAddressEdit(snapshot.url, addressValue)) {
      setAddressValue(readBrowserAddressValue(snapshot.url));
      return;
    }
    navigateTo(addressValue);
  };

  const setZoom = (zoomPercent: number) => {
    setSnapshot((current) => ({
      ...current,
      zoomPercent,
      viewport: { ...current.viewport, zoomPercent },
      updatedAt: Date.now(),
    }));
    void command({ type: "set-zoom-percent", tabId: tab.id, zoomPercent, showBanner: true });
  };

  const stepZoom = (delta: number) => {
    void command({ type: "step-zoom", tabId: tab.id, delta, showBanner: true });
  };

  const resetZoom = () => {
    void command({ type: "reset-zoom", tabId: tab.id, showBanner: true });
  };

  const toggleDeviceToolbar = () => {
    const visible = !snapshot.deviceToolbarVisible;
    setSnapshot((current) => ({ ...current, deviceToolbarVisible: visible, updatedAt: Date.now() }));
    void command({ type: "set-device-toolbar-visible", tabId: tab.id, visible });
  };

  const updateViewport = (viewport: BrowserSidebarViewport) => {
    setSnapshot((current) => ({ ...current, viewport, zoomPercent: viewport.zoomPercent, updatedAt: Date.now() }));
    void command({ type: "set-viewport", tabId: tab.id, viewport });
  };

  const clearBrowsingData = async (kind: BrowserBrowsingDataKind) => {
    setClearDataStatus(null);
    const result = await invoke("browser-browsing-data-clear", kind) as { ok: boolean; message?: string };
    if (result.ok) {
      setClearDataStatus(kind === "cookies" ? "Cookies cleared" : "Cache cleared");
      return;
    }
    setClearDataStatus(result.message ?? `Failed to clear ${kind}`);
  };

  const captureScreenshot = async () => {
    const result = await command({ type: "capture-screenshot", tabId: tab.id });
    if (result.ok && result.dataUrl) {
      await navigator.clipboard?.writeText(result.dataUrl).catch(() => undefined);
      setClearDataStatus("Screenshot copied");
      return;
    }
    if (!result.ok) {
      setClearDataStatus(result.message);
      return;
    }
    setClearDataStatus("Screenshot captured");
  };

  const viewportStyle = resolveViewportStyle(snapshot);
  const cursor = browserUseCursor ?? browserUseState?.cursor;
  const showBrowserUseCursor = cursor?.visible === true && (cursor.tabId === null || cursor.tabId === tab.id);
  const activeBrowserUseTab = browserUseState?.tabs.find((item) => item.tabId === browserUseState.activeTabId) ?? null;

  if (!browserRuntimeAvailable) {
    return <BrowserUnavailableState />;
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-token-main-surface-primary text-token-text-primary">
      <div className={BROWSER_CHROME_CLASS}>
        <div className={BROWSER_CHROME_ROW_CLASS}>
          <BrowserToolbarButton
            label="Back"
            disabled={!snapshot.canGoBack}
            onClick={() => {
              void command({ type: "go-back", tabId: tab.id });
            }}
          >
            <CodexBrowserBackIcon className="icon-sm" />
          </BrowserToolbarButton>
          <BrowserToolbarButton
            label="Forward"
            disabled={!snapshot.canGoForward}
            onClick={() => {
              void command({ type: "go-forward", tabId: tab.id });
            }}
          >
            <CodexBrowserBackIcon className="icon-sm rotate-180" />
          </BrowserToolbarButton>
          <BrowserToolbarButton
            label={snapshot.isLoading ? "Stop" : "Reload"}
            disabled={pageActionsDisabled}
            onClick={() => {
              if (snapshot.isLoading) {
                void command({ type: "stop", tabId: tab.id });
                return;
              }
              void command({ type: "reload", tabId: tab.id });
            }}
          >
            {snapshot.isLoading ? <StopIcon className="icon-sm" /> : <CodexBrowserReloadIcon className="icon-sm" />}
          </BrowserToolbarButton>
          <form
            className="no-drag flex min-w-0 flex-1 items-center justify-center px-1 text-sm text-token-text-primary"
            onSubmit={submitAddress}
          >
            <div className={BROWSER_ADDRESS_BAR_CLASS}>
              <span
                aria-hidden="true"
                className={cn("shrink-0 overflow-hidden transition-[width] duration-150", addressFocused ? "w-0" : "w-7")}
              />
              <input
                data-browser-sidebar-address-input="true"
                className={cn(
                  "h-full min-w-0 flex-1 bg-transparent px-1 text-sm outline-none text-token-input-foreground placeholder:text-token-input-placeholder-foreground focus:pl-2 focus:text-left",
                  !addressFocused && "text-center",
                  addressValue.trim().length > 0 && "pr-3",
                )}
                style={addressValue.trim().length > 0 ? {
                  WebkitMaskImage: "linear-gradient(to right, black calc(100% - 18px), transparent)",
                  maskImage: "linear-gradient(to right, black calc(100% - 18px), transparent)",
                } : undefined}
                value={addressValue}
                placeholder="Enter a URL"
                onFocus={() => setAddressFocused(true)}
                onBlur={(event) => {
                  setAddressFocused(false);
                  if (shouldSkipBrowserAddressCommit(event.relatedTarget)) return;
                  if (!shouldCommitBrowserAddressEdit(snapshot.url, addressValue)) {
                    setAddressValue(readBrowserAddressValue(snapshot.url));
                    return;
                  }
                  navigateTo(addressValue);
                }}
                onChange={(event) => setAddressValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.currentTarget.blur();
                  setAddressValue(readBrowserAddressValue(snapshot.url));
                }}
              />
              <button
                type="button"
                data-browser-sidebar-open-external
                data-browser-sidebar-skip-address-commit
                className={cn(
                  "mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-token-text-tertiary transition-opacity",
                  pageActionsDisabled
                    ? "cursor-default opacity-0"
                    : "cursor-interaction opacity-0 hover:bg-token-foreground/5 hover:text-token-text-primary focus-visible:bg-token-foreground/5 group-hover/address-bar:opacity-100 group-focus-within/address-bar:opacity-100",
                )}
                disabled={pageActionsDisabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void command({ type: "open-external", tabId: tab.id })}
                aria-label="Open externally"
              >
                <CodexBrowserExternalIcon className="icon-xs" />
              </button>
            </div>
          </form>
          <div className={cn(BROWSER_COLLAPSIBLE_ACTION_CLASS, pageActionsDisabled ? "pointer-events-none max-w-0 opacity-0 -translate-y-0.5" : "max-w-7 opacity-100 translate-y-0")}>
            <BrowserToolbarButton label="Capture screenshot" disabled={pageActionsDisabled} onClick={() => void captureScreenshot()}>
              <CodexBrowserScreenshotIcon className="icon-sm" />
            </BrowserToolbarButton>
          </div>
          <div className={cn(BROWSER_COLLAPSIBLE_ACTION_CLASS, pageActionsDisabled ? "pointer-events-none max-w-0 opacity-0 -translate-y-0.5" : commentMode ? "max-w-[112px] opacity-100 translate-y-0" : "max-w-7 opacity-100 translate-y-0")}>
            <BrowserToolbarButton
              label={commentMode ? "Exit comment mode" : "Annotate"}
              disabled={pageActionsDisabled}
              active={commentMode}
              className={cn(commentMode && "aspect-auto !px-2")}
              onClick={() => {
                void command({
                  type: "set-interaction-mode",
                  tabId: tab.id,
                  mode: commentMode ? "browse" : "comment",
                });
              }}
            >
              <CodexBrowserAnnotateIcon className="icon-sm shrink-0" />
              <span className={cn("overflow-hidden whitespace-nowrap text-sm transition-[max-width,opacity] duration-150", commentMode ? "max-w-20 opacity-100" : "max-w-0 opacity-0")}>
                Annotating
              </span>
            </BrowserToolbarButton>
          </div>
          <BrowserOverflowMenu
            snapshot={snapshot}
            disabled={pageActionsDisabled}
            onHardReload={() => {
              void command({ type: "reload", tabId: tab.id, ignoreCache: true });
            }}
            onToggleDeviceToolbar={toggleDeviceToolbar}
            onSetZoom={setZoom}
            onStepZoom={stepZoom}
            onResetZoom={resetZoom}
            onClearBrowsingData={clearBrowsingData}
          />
        </div>
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity",
            snapshot.isLoading ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="h-full w-1/3 animate-[_loading-bar-slide_1g9nv_1_1.15s_ease-in-out_infinite] rounded-full bg-token-text-primary/35" />
        </div>
      </div>

      <div
        className="relative min-h-0 overflow-hidden bg-token-main-surface-primary"
        style={{
          height: `calc(100% - var(--height-toolbar-pane) - ${RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE})`,
          scrollPaddingBottom: RIGHT_PANEL_COMPOSER_OVERLAY_ZERO_RESERVE_VALUE,
        }}
      >
        {isBlank ? (
          <BrowserNewTabState
            projectId={tab.projectId}
            localServers={localServers}
            onRefresh={() => void command({ type: "local-servers-refresh", projectId: tab.projectId })}
            onOpen={navigateTo}
            onHideServer={(server) => void command({ type: "hide-local-server", projectId: tab.projectId, server })}
            onUnhideServer={(url) => void command({ type: "unhide-local-server", projectId: tab.projectId, url })}
            onRemoveRoute={(serverUrl, routeUrl) => void command({ type: "remove-local-server-route", projectId: tab.projectId, serverUrl, routeUrl })}
          />
        ) : (
          <BrowserWebviewStage
            activeSessionId={activeSession.id}
            tabId={tab.id}
            deviceToolbarVisible={snapshot.deviceToolbarVisible}
            viewport={snapshot.viewport}
            viewportStyle={viewportStyle}
            webviewHostRef={webviewHostRef}
            onViewportChange={updateViewport}
            onCloseDeviceToolbar={toggleDeviceToolbar}
          >
            {commentMode ? <BrowserCommentOverlay /> : null}
            {showBrowserUseCursor ? (
              <BrowserUseCursorOverlay
                x={cursor?.x ?? 0}
                y={cursor?.y ?? 0}
                label={activeBrowserUseTab?.title}
                viewportSize={browserUseViewport?.viewportSize ?? null}
              />
            ) : null}
          </BrowserWebviewStage>
        )}
      </div>
      {clearDataStatus ? (
        <div className={cn(
          "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 rounded-full bg-token-dropdown-background/90 px-3 py-1 text-xs text-token-text-secondary shadow-xl-spread ring-[0.5px] ring-token-border backdrop-blur-sm",
          snapshot.deviceToolbarVisible ? "bottom-[46px]" : "bottom-3",
        )}>
          {clearDataStatus}
        </div>
      ) : null}
    </div>
  );
}

function BrowserToolbarButton({
  label,
  disabled,
  active,
  className,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        BROWSER_TOOL_BUTTON_CLASS,
        active && "bg-token-list-hover-background text-token-text-primary",
        className,
      )}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function BrowserOverflowMenu({
  snapshot,
  disabled,
  onHardReload,
  onToggleDeviceToolbar,
  onSetZoom,
  onStepZoom,
  onResetZoom,
  onClearBrowsingData,
}: {
  snapshot: BrowserSidebarTabSnapshot;
  disabled: boolean;
  onHardReload: () => void;
  onToggleDeviceToolbar: () => void;
  onSetZoom: (zoomPercent: number) => void;
  onStepZoom: (delta: number) => void;
  onResetZoom: () => void;
  onClearBrowsingData: (kind: BrowserBrowsingDataKind) => void;
}) {
  const zoomOptions = resolveBrowserZoomOptions(snapshot.zoomPercent);
  return (
    <NodexDropdownMenu
      align="end"
      contentWidth="menuWide"
      contentStyle={BROWSER_DROPDOWN_CONTENT_STYLE}
      triggerButton={(
        <button
          type="button"
          data-browser-sidebar-skip-address-commit
          className={cn(BROWSER_TOOL_BUTTON_CLASS, disabled && "cursor-default opacity-40")}
          aria-label="Browser options"
          disabled={disabled}
        >
          <CodexBrowserMoreIcon className="icon-sm" />
        </button>
      )}
    >
      <NodexDropdownItem disabled={disabled} leftSlot={<CodexBrowserReloadIcon className="icon-xs" />} onSelect={onHardReload}>
        Force reload
      </NodexDropdownItem>
      <NodexDropdownItem disabled={disabled} leftSlot={<Smartphone className="icon-xs" />} onSelect={onToggleDeviceToolbar}>
        {snapshot.deviceToolbarVisible ? "Hide device toolbar" : "Show device toolbar"}
      </NodexDropdownItem>
      <NodexDropdownSeparator />
      <div
        data-browser-sidebar-skip-address-commit
        className={cn(
          "flex items-center gap-1 rounded-lg px-[var(--padding-row-x)] py-1 text-sm text-token-foreground",
          disabled && "cursor-default opacity-50",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-token-description-foreground">Zoom</span>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-token-list-hover-background disabled:cursor-default disabled:opacity-40"
          onClick={() => onStepZoom(-25)}
          aria-label="Zoom out"
        >
          <Minus className="icon-xs" />
        </button>
        <select
          aria-label="Zoom percent"
          disabled={disabled}
          className="h-6 min-w-16 rounded-md border border-token-border bg-token-foreground/5 px-1 text-center text-xs tabular-nums outline-none hover:bg-token-list-hover-background disabled:cursor-default disabled:opacity-40"
          value={snapshot.zoomPercent}
          onChange={(event) => onSetZoom(Number.parseInt(event.target.value, 10))}
        >
          {zoomOptions.map((zoom) => (
            <option key={zoom} value={zoom}>{zoom}%</option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-token-list-hover-background disabled:cursor-default disabled:opacity-40"
          onClick={() => onStepZoom(25)}
          aria-label="Zoom in"
        >
          <Plus className="icon-xs" />
        </button>
        <button
          type="button"
          disabled={disabled || snapshot.zoomPercent === 100}
          className="inline-flex size-6 items-center justify-center rounded-md hover:bg-token-list-hover-background disabled:cursor-default disabled:opacity-40"
          onClick={onResetZoom}
          aria-label="Reset zoom"
        >
          <RotateCcw className="icon-xs" />
        </button>
      </div>
      <NodexDropdownSeparator />
      <NodexDropdownItem disabled={disabled} onSelect={() => onClearBrowsingData("cookies")}>Clear cookies</NodexDropdownItem>
      <NodexDropdownItem disabled={disabled} onSelect={() => onClearBrowsingData("cache")}>Clear cache</NodexDropdownItem>
    </NodexDropdownMenu>
  );
}

export function BrowserDeviceToolbar({
  viewport,
  onViewportChange,
  onClose,
}: {
  viewport: BrowserSidebarViewport;
  onViewportChange: (viewport: BrowserSidebarViewport) => void;
  onClose: () => void;
}) {
  const selectedPreset = BROWSER_SIDEBAR_DEVICE_PRESETS.find((preset) => preset.id === viewport.presetId)
    ?? BROWSER_SIDEBAR_DEVICE_PRESETS[0];
  const zoomOptions = resolveBrowserZoomOptions(viewport.zoomPercent);

  return (
    <div className="absolute inset-x-0 top-0 z-30 flex h-[34px] items-center gap-2 border-b border-token-border bg-token-bg-secondary px-2.5 text-sm text-token-foreground">
      <NodexDropdownMenu
        align="start"
        contentWidth="menuWide"
        contentStyle={BROWSER_DROPDOWN_CONTENT_STYLE}
        triggerButton={(
          <NodexDropdownButtonTrigger size="xs" chrome="transparent" className="h-6 min-w-[138px] justify-between rounded-lg text-token-foreground">
            {selectedPreset.label}
          </NodexDropdownButtonTrigger>
        )}
      >
        {BROWSER_SIDEBAR_DEVICE_PRESETS.map((preset) => (
          <NodexDropdownItem
            key={preset.id}
            rightSlot={preset.id === selectedPreset.id ? <Check className="icon-xs" /> : null}
            onSelect={() => onViewportChange({
              width: preset.width,
              height: preset.height,
              zoomPercent: viewport.zoomPercent,
              presetId: preset.id,
            })}
          >
            {preset.label}
          </NodexDropdownItem>
        ))}
      </NodexDropdownMenu>
      <DimensionInput
        label="Width"
        value={viewport.width}
        placeholder="auto"
        onChange={(width) => onViewportChange(updateBrowserViewportDimension(viewport, "width", width))}
      />
      <span className="text-token-description-foreground">x</span>
      <DimensionInput
        label="Height"
        value={viewport.height}
        placeholder="auto"
        onChange={(height) => onViewportChange(updateBrowserViewportDimension(viewport, "height", height))}
      />
      <button
        type="button"
        className="inline-flex size-6 items-center justify-center rounded-lg hover:bg-token-list-hover-background"
        aria-label="Rotate"
        onClick={() => onViewportChange(rotateBrowserViewport(viewport))}
      >
        <RotateCcw className="icon-xs" />
      </button>
      <button
        type="button"
        className="inline-flex size-6 items-center justify-center rounded-lg hover:bg-token-list-hover-background"
        aria-label="Responsive"
        onClick={() => onViewportChange({ width: 0, height: 0, zoomPercent: 100, presetId: "responsive" })}
      >
        <Maximize2 className="icon-xs" />
      </button>
      <select
        aria-label="Viewport zoom"
        className="ml-auto h-6 rounded-lg border border-transparent bg-token-foreground/5 px-2 text-center text-xs font-semibold text-token-foreground tabular-nums outline-none hover:bg-token-list-hover-background focus:border-token-focus-border focus:bg-token-bg-primary"
        value={viewport.zoomPercent}
        onChange={(event) => onViewportChange({ ...viewport, zoomPercent: Number.parseInt(event.target.value, 10) })}
      >
        {zoomOptions.map((zoom) => (
          <option key={zoom} value={zoom}>{zoom}%</option>
        ))}
      </select>
      <button
        type="button"
        className="inline-flex size-6 items-center justify-center rounded-lg hover:bg-token-list-hover-background"
        aria-label="Close device toolbar"
        onClick={onClose}
      >
        <X className="icon-xs" />
      </button>
    </div>
  );
}

function DimensionInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: number;
  placeholder?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="sr-only">{label}</span>
      <input
        className="h-6 w-[72px] rounded-lg border border-transparent bg-token-foreground/5 px-2 text-center text-xs font-semibold text-token-foreground tabular-nums outline-none hover:bg-token-list-hover-background focus:border-token-focus-border focus:bg-token-bg-primary"
        value={value || ""}
        placeholder={placeholder}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          if (!Number.isFinite(next)) return;
          onChange(next);
        }}
      />
    </label>
  );
}

export function BrowserWebviewStage({
  activeSessionId,
  tabId,
  deviceToolbarVisible,
  viewport,
  viewportStyle,
  webviewHostRef,
  onViewportChange,
  onCloseDeviceToolbar,
  children,
}: {
  activeSessionId: string;
  tabId: string;
  deviceToolbarVisible: boolean;
  viewport: BrowserSidebarViewport;
  viewportStyle: CSSProperties;
  webviewHostRef: RefObject<HTMLDivElement | null>;
  onViewportChange: (viewport: BrowserSidebarViewport) => void;
  onCloseDeviceToolbar: () => void;
  children: ReactNode;
}) {
  const fixedViewport = deviceToolbarVisible && viewport.presetId !== "responsive";

  return (
    <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden bg-token-main-surface-primary">
      {deviceToolbarVisible ? (
        <BrowserDeviceToolbar
          viewport={viewport}
          onViewportChange={onViewportChange}
          onClose={onCloseDeviceToolbar}
        />
      ) : null}
      <div
        className={cn(
          "relative h-full min-h-0 min-w-0 overflow-hidden",
          deviceToolbarVisible && "pt-[34px]",
          fixedViewport && "bg-token-bg-secondary/40",
        )}
      >
        <div
          className={cn(
            "relative h-full w-full overflow-hidden",
            fixedViewport && "flex items-center justify-center overflow-auto p-6",
          )}
          style={fixedViewport ? RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE : undefined}
        >
          <div
            className={cn(
              "relative overflow-hidden bg-token-main-surface-primary",
              fixedViewport ? "shadow-sm ring-[0.5px] ring-token-border" : "h-full w-full",
            )}
            style={viewportStyle}
          >
            <div
              ref={webviewHostRef}
              className="absolute inset-0 overflow-hidden"
              data-browser-sidebar-webview-host-root
              data-browser-sidebar-conversation-id={activeSessionId}
              data-browser-sidebar-browser-tab-id={tabId}
            />
            {children}
            {deviceToolbarVisible && viewport.presetId === "responsive" ? (
              <BrowserViewportResizeHandles viewport={viewport} onViewportChange={onViewportChange} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function BrowserViewportResizeHandles({
  viewport,
  onViewportChange,
}: {
  viewport: BrowserSidebarViewport;
  onViewportChange: (viewport: BrowserSidebarViewport) => void;
}) {
  const bump = (dimension: "width" | "height", delta: number) => {
    const current = dimension === "width" ? viewport.width || 1024 : viewport.height || 768;
    onViewportChange(updateBrowserViewportDimension(viewport, dimension, current + delta));
  };

  return (
    <>
      <button
        type="button"
        className="absolute inset-y-8 left-0 z-20 w-1 cursor-ew-resize opacity-0 focus-visible:opacity-100"
        aria-label="Narrow viewport"
        onClick={() => bump("width", -80)}
      />
      <button
        type="button"
        className="absolute inset-y-8 right-0 z-20 w-1 cursor-ew-resize opacity-0 focus-visible:opacity-100"
        aria-label="Widen viewport"
        onClick={() => bump("width", 80)}
      />
      <button
        type="button"
        className="absolute inset-x-8 bottom-0 z-20 h-1 cursor-ns-resize opacity-0 focus-visible:opacity-100"
        aria-label="Taller viewport"
        onClick={() => bump("height", 80)}
      />
    </>
  );
}

export function BrowserNewTabState({
  projectId,
  localServers,
  onRefresh,
  onOpen,
  onHideServer,
  onUnhideServer,
  onRemoveRoute,
}: {
  projectId: string;
  localServers: BrowserSidebarLocalServersSnapshot | null;
  onRefresh: () => void;
  onOpen: (url: string) => void;
  onHideServer: (server: BrowserSidebarLocalServer) => void;
  onUnhideServer: (url: string) => void;
  onRemoveRoute: (serverUrl: string, routeUrl: string) => void;
}) {
  const [settings, setSettings] = useState<BrowserLocalServerSettings>(() =>
    resolveBrowserLocalServerSettings(typeof window === "undefined" ? null : window.localStorage)
  );
  const visible = useMemo(
    () => resolveVisibleLocalServers(localServers, settings),
    [localServers, settings],
  );
  const servers = settings.showMode === "hidden" ? visible.hiddenServers : visible.servers;
  const showModeLabel = settings.showMode === "online"
    ? "Online"
    : settings.showMode === "hidden"
      ? "Hidden"
      : "All";
  const setShowMode = (showMode: BrowserLocalServerShowMode) => {
    writeBrowserLocalServerShowMode(typeof window === "undefined" ? null : window.localStorage, showMode);
    setSettings((current) => ({ ...current, showMode }));
  };
  const setSortMode = (sortMode: BrowserLocalServerSortMode) => {
    writeBrowserLocalServerSortMode(typeof window === "undefined" ? null : window.localStorage, sortMode);
    setSettings((current) => ({ ...current, sortMode }));
  };
  const expandProject = () => {
    setSettings((current) => {
      const expandedProjectIds = new Set([...current.expandedProjectIds, projectId]);
      writeBrowserLocalServerExpandedProjects(
        typeof window === "undefined" ? null : window.localStorage,
        expandedProjectIds,
      );
      return { ...current, expandedProjectIds };
    });
  };

  return (
    <div className="absolute inset-0 z-10 flex h-full w-full overflow-y-auto bg-token-main-surface-primary px-4 py-8 select-none">
      <div className="m-auto flex w-full max-w-[420px] flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-token-text-primary">Local</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-lg text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-text-primary"
              onClick={onRefresh}
              aria-label="Refresh local servers"
              title="Refresh local servers"
            >
              <CodexBrowserReloadIcon className="icon-xs" />
            </button>
            <NodexDropdownMenu
              align="end"
              contentWidth="menuWide"
              triggerButton={(
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded-lg text-token-text-tertiary hover:bg-token-list-hover-background hover:text-token-text-primary"
                  aria-label="Local server options"
                  title="Local server options"
                >
                  <CodexBrowserLocalServerFilterIcon className="icon-xs" />
                </button>
              )}
            >
              <NodexDropdownItem
                rightSlot={settings.showMode === "online" ? <Check className="icon-xs" /> : null}
                onSelect={() => setShowMode("online")}
              >
                Online
              </NodexDropdownItem>
              <NodexDropdownItem
                rightSlot={settings.showMode === "all" ? <Check className="icon-xs" /> : null}
                onSelect={() => setShowMode("all")}
              >
                All
              </NodexDropdownItem>
              <NodexDropdownItem
                rightSlot={settings.showMode === "hidden" ? <Check className="icon-xs" /> : null}
                onSelect={() => setShowMode("hidden")}
              >
                Hidden
              </NodexDropdownItem>
              <NodexDropdownSeparator />
              <NodexDropdownItem
                rightSlot={settings.sortMode === "recently-used" ? <Check className="icon-xs" /> : null}
                onSelect={() => setSortMode("recently-used")}
              >
                Recently used
              </NodexDropdownItem>
              <NodexDropdownItem
                rightSlot={settings.sortMode === "origin" ? <Check className="icon-xs" /> : null}
                onSelect={() => setSortMode("origin")}
              >
                Origin
              </NodexDropdownItem>
            </NodexDropdownMenu>
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          {localServers?.isLoading ? (
            <div className="rounded-lg border border-token-border bg-token-main-surface-primary px-3 py-3 text-sm text-token-text-secondary">
              Finding local servers...
            </div>
          ) : servers.length === 0 ? (
            <div className="rounded-lg border border-token-border bg-token-main-surface-primary px-3 py-3 text-sm text-token-text-secondary">
              {settings.showMode === "hidden" ? "No hidden local servers." : `No ${showModeLabel.toLowerCase()} local servers.`}
            </div>
          ) : servers.map((server) => (
            <LocalServerCard
              key={server.id}
              server={server}
              hiddenMode={settings.showMode === "hidden"}
              onOpen={onOpen}
              onHide={() => onHideServer(server)}
              onUnhide={() => onUnhideServer(server.origin)}
              onRemoveRoute={(routePath) => onRemoveRoute(server.origin, routePath)}
            />
          ))}
          {visible.hasMore ? (
            <button
              type="button"
              className="h-8 rounded-lg text-sm text-token-text-secondary hover:bg-token-list-hover-background hover:text-token-text-primary"
              onClick={expandProject}
            >
              Show more
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LocalServerCard({
  server,
  hiddenMode,
  onOpen,
  onHide,
  onUnhide,
  onRemoveRoute,
}: {
  server: BrowserSidebarLocalServer;
  hiddenMode: boolean;
  onOpen: (url: string) => void;
  onHide: () => void;
  onUnhide: () => void;
  onRemoveRoute: (routePath: string) => void;
}) {
  const visibleRoutes = server.routes.filter((route) => !route.hidden).slice(0, 5);
  return (
    <div className="group/local-server overflow-hidden rounded-lg border border-token-border bg-token-main-surface-primary text-token-text-primary transition-colors hover:bg-token-list-hover-background">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left"
        onClick={() => onOpen(server.origin)}
      >
        <img
          alt=""
          draggable={false}
          src={LOCAL_SERVER_THUMBNAIL_DATA_URI}
          className="h-[52px] w-[84px] shrink-0 rounded-[10px] border border-token-border object-cover"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", server.online ? "bg-emerald-500" : "bg-token-text-tertiary")} />
            <span className="truncate text-sm font-medium text-token-text-primary">{formatLocalServerTitle(server.origin)}</span>
          </span>
          <span className="mt-1 block truncate text-xs text-token-text-secondary">{server.origin}</span>
        </span>
      </button>
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <div className="min-w-0 flex-1">
          {visibleRoutes.length > 0 ? visibleRoutes.map((route) => (
            <div key={route.id} className="flex min-w-0 items-center gap-1 text-xs text-token-text-secondary">
              <button
                type="button"
                className="min-w-0 truncate text-left hover:text-token-text-primary"
                onClick={() => onOpen(`${server.origin}${route.path}`)}
              >
                {route.path}
              </button>
              <button
                type="button"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-md opacity-0 hover:bg-token-foreground/5 group-hover/local-server:opacity-100"
                aria-label={`Remove route ${route.path}`}
                onClick={() => onRemoveRoute(route.path)}
              >
                <X className="icon-2xs" />
              </button>
            </div>
          )) : (
            <div className="truncate text-xs text-token-text-secondary">/</div>
          )}
        </div>
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-token-text-tertiary opacity-0 transition-opacity hover:bg-token-foreground/5 hover:text-token-text-primary group-hover/local-server:opacity-100 focus-visible:opacity-100"
          aria-label={hiddenMode ? `Unhide ${server.origin}` : `Hide ${server.origin}`}
          onClick={hiddenMode ? onUnhide : onHide}
        >
          {hiddenMode ? <Check className="icon-xs" /> : <CodexBrowserHideIcon className="icon-xs" />}
        </button>
      </div>
    </div>
  );
}

function formatLocalServerTitle(origin: string): string {
  try {
    const parsed = new URL(origin);
    return `${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return origin.replace(/^https?:\/\//, "");
  }
}

export function BrowserCommentOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 cursor-crosshair bg-token-foreground/5">
      <div id="browser-sidebar-comment-popup-root" className="pointer-events-auto absolute inset-0" />
    </div>
  );
}

export function BrowserUseCursorOverlay({
  x,
  y,
  label,
  viewportSize,
}: {
  x: number;
  y: number;
  label?: string;
  viewportSize: { width: number; height: number } | null;
}) {
  return (
    <div
      data-testid="browser-agent-cursor-overlay"
      className="pointer-events-none absolute z-30 -translate-x-1 -translate-y-1 text-token-text-primary drop-shadow"
      style={{ left: x, top: y }}
    >
      <MousePointer2 className="icon-sm" />
      {label || viewportSize ? (
        <span className="ml-2 inline-flex rounded-md bg-token-dropdown-background/90 px-1.5 py-0.5 text-[11px] text-token-text-secondary shadow-xl-spread ring-[0.5px] ring-token-border">
          {label ?? `${viewportSize?.width ?? 0}x${viewportSize?.height ?? 0}`}
        </span>
      ) : null}
    </div>
  );
}

export function BrowserUnavailableState() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-token-main-surface-primary p-6 text-center">
      <div className="text-base font-medium text-token-text-primary">Browser is available in the desktop app</div>
      <div className="mt-1 max-w-sm text-sm text-token-text-secondary">
        The browser tab uses Electron webview isolation and cannot run in this renderer.
      </div>
    </div>
  );
}

function makeInitialSnapshot(tab: BrowserTab, activeSession: ProjectSession): BrowserSidebarTabSnapshot {
  const url = normalizeBrowserNavigationUrl(readBrowserConfigUrl(tab));
  return {
    ...DEFAULT_BROWSER_SNAPSHOT,
    tabId: tab.id,
    sessionId: activeSession.id,
    projectId: tab.projectId,
    url,
    title: readBrowserConfigTitle(tab) || tab.title || "New tab",
    faviconUrl: readBrowserConfigFavicon(tab),
    deviceToolbarVisible: readBrowserConfigDeviceToolbarVisible(tab),
    hasBrowserPage: !isBlankBrowserUrl(url),
    pageActionsDisabled: isBlankBrowserUrl(url),
    updatedAt: Date.now(),
  };
}

function readWebviewHostBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function resolveViewportStyle(snapshot: BrowserSidebarTabSnapshot): CSSProperties {
  if (!snapshot.deviceToolbarVisible || snapshot.viewport.presetId === "responsive") {
    return { width: "100%", height: "100%" };
  }

  const width = Math.max(240, snapshot.viewport.width);
  const height = Math.max(160, snapshot.viewport.height);
  const scale = Math.max(0.25, Math.min(1, snapshot.viewport.zoomPercent / 100));
  return {
    width,
    height,
    transform: `scale(${scale})`,
    transformOrigin: "center center",
  };
}
