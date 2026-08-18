import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NodexHoverCardProvider } from "./components/ui/hover-card";
import { NodexTooltipProvider } from "./components/ui/tooltip";
import { BrowserSidebarThemeSynchronizer } from "./features/browser-sidebar/browser-sidebar-theme-synchronizer";
import { BrowserSidebarRuntimeSynchronizer } from "./features/browser-sidebar/browser-sidebar-runtime-synchronizer";
import { CodeFontSizeProvider } from "./lib/use-code-font-size";
import { FileLinkOpenerProvider } from "./lib/use-file-link-opener";
import { SansFontSizeProvider } from "./lib/use-sans-font-size";
import { ReducedMotionProvider } from "./lib/use-reduced-motion";
import { CodexServiceTierSettingsProvider } from "./lib/use-codex-service-tier-settings";
import { CodexThreadSettingsProvider } from "./lib/use-codex-thread-settings";
import { NodexQueryProvider } from "./lib/query-client";
import { ThemeProvider } from "./lib/use-theme";
import { invoke, subscribeAppUpdateStatus } from "./lib/api";
import type { AppUpdateStatus } from "./lib/types";
import {
  createMaitaiStore,
  MaitaiProvider,
  preloadEagerPersistedAtoms,
} from "./lib/maitai";
import {
  isCodexCompactWindowUrl,
  resolveCodexRendererOs,
  resolveCodexRendererWindowChrome,
} from "./lib/codex-window-runtime";
import "./globals.css";

interface RendererDocumentOptions {
  storybook?: boolean;
}

interface AppProvidersProps {
  children: ReactNode;
}

declare global {
  interface Window {
    __NODEX_STORYBOOK__?: boolean;
  }
}

let unsubscribeElectronOpaqueSurfaceChange: (() => void) | null = null;

const AppUpdateStatusContext = createContext<AppUpdateStatus | null>(null);
const INITIAL_APP_UPDATE_STATUS: AppUpdateStatus = {
  availableVersion: null,
  checkedAt: null,
  currentVersion: "dev",
  message: "App update status is loading.",
  progressPercent: null,
  releaseDate: null,
  releaseName: null,
  releaseNotes: null,
  status: "unsupported",
  supported: false,
  totalBytes: null,
  transferredBytes: null,
  channel: "stable",
  buildDefaultChannel: "stable",
  channelChangeAllowed: false,
};

function isAppUpdateStatus(value: unknown): value is AppUpdateStatus {
  return typeof value === "object"
    && value !== null
    && typeof (value as AppUpdateStatus).status === "string"
    && typeof (value as AppUpdateStatus).supported === "boolean"
    && typeof (value as AppUpdateStatus).currentVersion === "string";
}

export function AppUpdateStatusProvider({ children }: AppProvidersProps) {
  const [status, setStatus] = useState<AppUpdateStatus>(INITIAL_APP_UPDATE_STATUS);

  useEffect(() => {
    if (window.__NODEX_STORYBOOK__ === true) return;
    let cancelled = false;
    let observedPush = false;
    const unsubscribe = subscribeAppUpdateStatus((nextStatus) => {
      if (cancelled) return;
      observedPush = true;
      setStatus(nextStatus);
    });
    void invoke("app:update:status").then((snapshot) => {
      if (!cancelled && !observedPush && isAppUpdateStatus(snapshot)) setStatus(snapshot);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <AppUpdateStatusContext.Provider value={status}>
      {children}
    </AppUpdateStatusContext.Provider>
  );
}

export function useAppUpdateStatus(): AppUpdateStatus | null {
  return useContext(AppUpdateStatusContext);
}

function applyElectronOpaqueSurface(root: HTMLElement, enabled: boolean): void {
  if (root.classList.contains("compact-window")) {
    root.classList.remove("electron-opaque");
    return;
  }

  root.classList.toggle("electron-opaque", enabled);
}

function subscribeElectronOpaqueSurfaceChanges(root: HTMLElement): void {
  unsubscribeElectronOpaqueSurfaceChange?.();
  unsubscribeElectronOpaqueSurfaceChange = null;

  if (!window.api) return;

  unsubscribeElectronOpaqueSurfaceChange = window.api.on(
    "electron-window-opaque-surface-changed",
    (payload) => {
      const opaqueWindowSurfaceEnabled =
        typeof payload === "object"
        && payload !== null
        && "opaqueWindowSurfaceEnabled" in payload
        && payload.opaqueWindowSurfaceEnabled === true;
      applyElectronOpaqueSurface(root, opaqueWindowSurfaceEnabled);
    },
  );
}

function clearElectronRuntimeDocumentState(root: HTMLElement): void {
  unsubscribeElectronOpaqueSurfaceChange?.();
  unsubscribeElectronOpaqueSurfaceChange = null;
  root.classList.remove("compact-window", "electron-dark", "electron-light", "electron-opaque");
  delete root.dataset.windowType;
  delete root.dataset.codexOs;
  delete root.dataset.codexWindowChrome;
}

export function initializeRendererDocument(options?: RendererDocumentOptions): void {
  const root = document.documentElement;
  const isElectronWindow = Boolean(window.api);
  const shouldEmulateElectronWindow = isElectronWindow || options?.storybook === true;
  const shouldEmulateOpaqueElectronWindow =
    options?.storybook === true || root.classList.contains("electron-opaque");

  root.dataset.codexWindowType = shouldEmulateElectronWindow ? "electron" : "browser";
  window.__NODEX_STORYBOOK__ = options?.storybook === true;

  if (!shouldEmulateElectronWindow) {
    clearElectronRuntimeDocumentState(root);
    return;
  }

  const os = resolveCodexRendererOs();
  const isCompactWindow = isCodexCompactWindowUrl(window.location.href);
  root.dataset.windowType = "electron";
  root.dataset.codexOs = os;
  root.dataset.codexWindowChrome = resolveCodexRendererWindowChrome("electron", os);
  root.classList.toggle("compact-window", isCompactWindow);
  applyElectronOpaqueSurface(root, shouldEmulateOpaqueElectronWindow);
  subscribeElectronOpaqueSurfaceChanges(root);

  const isDark = root.classList.contains("dark");
  root.classList.toggle("electron-dark", isDark);
  root.classList.toggle("electron-light", !isDark);
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <NodexQueryProvider>
      <RendererStateProvider>
        <ThemeProvider>
          <ReducedMotionProvider>
            <AppUpdateStatusProvider>
              <BrowserSidebarRuntimeSynchronizer />
              <BrowserSidebarThemeSynchronizer />
              <SansFontSizeProvider>
                <CodeFontSizeProvider>
                  <FileLinkOpenerProvider>
                    <CodexServiceTierSettingsProvider>
                      <CodexThreadSettingsProvider>
                        <NodexHoverCardProvider>
                          <NodexTooltipProvider>
                            {children}
                          </NodexTooltipProvider>
                        </NodexHoverCardProvider>
                      </CodexThreadSettingsProvider>
                    </CodexServiceTierSettingsProvider>
                  </FileLinkOpenerProvider>
                </CodeFontSizeProvider>
              </SansFontSizeProvider>
            </AppUpdateStatusProvider>
          </ReducedMotionProvider>
        </ThemeProvider>
      </RendererStateProvider>
    </NodexQueryProvider>
  );
}

export function RendererStateProvider({ children }: AppProvidersProps) {
  const queryClient = useQueryClient();
  const [store] = useState(() => {
    const nextStore = createMaitaiStore({ queryClient });
    void preloadEagerPersistedAtoms(nextStore);
    return nextStore;
  });
  return <MaitaiProvider store={store}>{children}</MaitaiProvider>;
}
