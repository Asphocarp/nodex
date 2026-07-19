import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NodexTooltipProvider } from "./components/ui/tooltip";
import { CodeFontSizeProvider } from "./lib/use-code-font-size";
import { FileLinkOpenerProvider } from "./lib/use-file-link-opener";
import { SansFontSizeProvider } from "./lib/use-sans-font-size";
import { CodexServiceTierSettingsProvider } from "./lib/use-codex-service-tier-settings";
import { CodexThreadSettingsProvider } from "./lib/use-codex-thread-settings";
import { NodexQueryProvider } from "./lib/query-client";
import { ThemeProvider } from "./lib/use-theme";
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
          <SansFontSizeProvider>
            <CodeFontSizeProvider>
              <FileLinkOpenerProvider>
                <CodexServiceTierSettingsProvider>
                  <CodexThreadSettingsProvider>
                    <NodexTooltipProvider>
                      {children}
                    </NodexTooltipProvider>
                  </CodexThreadSettingsProvider>
                </CodexServiceTierSettingsProvider>
              </FileLinkOpenerProvider>
            </CodeFontSizeProvider>
          </SansFontSizeProvider>
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
