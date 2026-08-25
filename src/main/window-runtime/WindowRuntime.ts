import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import { nativeTheme, screen, type BrowserWindow } from "electron";
import type { InitialProjectPresentation } from "../../shared/initial-project-welcome";
import type {
  WindowRestorePolicy,
  WindowSessionBounds,
  WindowSessionNewWindowRequest,
  WindowSessionRecord,
  WindowSessionSaveLayoutInput,
} from "../../shared/window-session";
import {
  WindowSessionState,
  type AcquiredWindowSession,
  type ReopenedWindowSession,
  type WindowSessionCloseDisposition,
} from "../window-session-state";
import { safeSendToWindow } from "../ipc-safe-send";
import { getLogger } from "../logging/logger";
import { resolveElectronWindowBackdrop } from "../electron-window-backdrop";

const WINDOW_CLOSE_FLUSH_TIMEOUT = "1500 millis";
const logger = getLogger({ component: "window-runtime" });

interface ManagedWindowClose {
  acknowledge: () => void;
  allowImmediate: boolean;
  blurHandler: () => void;
  closeHandler: (event: Electron.Event) => void;
  closedHandler: () => void;
  disposition: WindowSessionCloseDisposition;
  finalBounds: WindowSessionBounds | undefined;
  finish: () => void;
  focusHandler: () => void;
  moveHandler: () => void;
  resizeHandler: () => void;
  timeoutPending: boolean;
  window: BrowserWindow;
}

export function captureWindowSessionBounds(window: BrowserWindow): WindowSessionBounds {
  const bounds = window.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    mode: window.isFullScreen() ? "fullscreen" : window.isMaximized() ? "maximized" : "normal",
  };
}

function applyElectronWindowBackdrop(
  platform: NodeJS.Platform,
  window: BrowserWindow,
  opaqueSurfaceModes: Map<number, boolean>,
  force = false,
): void {
  if (platform !== "darwin" && platform !== "win32") return;
  if (window.isDestroyed()) return;
  const bounds = window.getBounds();
  const backdrop = resolveElectronWindowBackdrop({
    bounds,
    // A hidden canonical shell has not had a chance to focus yet; preserving
    // native material avoids an opaque first paint followed by a focus flash.
    isFocused: !window.isVisible() || window.isFocused(),
    platform,
    prefersDarkColors: nativeTheme.shouldUseDarkColors,
    prefersReducedTransparency: nativeTheme.prefersReducedTransparency,
    scaleFactor: screen.getDisplayMatching(bounds).scaleFactor,
  });
  const { opaqueWindowSurfaceEnabled } = backdrop;
  if (!force && opaqueSurfaceModes.get(window.id) === opaqueWindowSurfaceEnabled) return;
  try {
    window.setBackgroundColor(backdrop.backgroundColor);
    if (platform === "darwin") {
      window.setVibrancy(backdrop.vibrancy as Parameters<BrowserWindow["setVibrancy"]>[0]);
    }
    if (platform === "win32") {
      window.setBackgroundMaterial(
        backdrop.backgroundMaterial as Parameters<BrowserWindow["setBackgroundMaterial"]>[0],
      );
    }
    opaqueSurfaceModes.set(window.id, opaqueWindowSurfaceEnabled);
    safeSendToWindow(window, "electron-window-opaque-surface-changed", [
      { opaqueWindowSurfaceEnabled },
    ]);
  } catch (error) {
    logger.warn("Failed to apply Electron window backdrop", {
      error: error instanceof Error ? error.message : String(error),
      windowId: window.id,
    });
  }
}

interface WindowAppearancePort {
  readonly apply: (window: BrowserWindow, force?: boolean) => void;
  readonly forget: (window: BrowserWindow) => void;
  readonly subscribeToTheme: (listener: () => void) => () => void;
}

const noWindowAppearance: WindowAppearancePort = {
  apply: () => undefined,
  forget: () => undefined,
  subscribeToTheme: () => () => undefined,
};

function createElectronWindowAppearance(platform: NodeJS.Platform): WindowAppearancePort {
  const opaqueSurfaceModes = new Map<number, boolean>();
  return {
    apply: (window, force) =>
      applyElectronWindowBackdrop(platform, window, opaqueSurfaceModes, force ?? false),
    forget: (window) => opaqueSurfaceModes.delete(window.id),
    subscribeToTheme: (listener) => {
      nativeTheme.on("updated", listener);
      return () => nativeTheme.off("updated", listener);
    },
  };
}

export interface WindowRuntimeService {
  readonly acknowledgeClose: (webContentsId: number) => void;
  readonly acquireSessionForNewWindow: (sourceWebContentsId?: number) => AcquiredWindowSession;
  readonly all: () => readonly BrowserWindow[];
  readonly attach: (window: BrowserWindow, sessionId: string) => WindowSessionRecord;
  readonly bootstrap: (webContentsId: number) => WindowSessionRecord;
  readonly beginApplicationQuit: () => void;
  readonly cloneSessionForWindow: (
    sourceWebContentsId: number,
    override?: WindowSessionNewWindowRequest,
  ) => WindowSessionRecord;
  readonly count: () => number;
  readonly get: (webContentsId: number) => BrowserWindow | null;
  readonly getLastFocused: () => BrowserWindow | null;
  readonly has: (webContentsId: number) => boolean;
  readonly hasClosedSessionAvailable: () => boolean;
  readonly isRendererInitialized: (webContentsId: number) => boolean;
  readonly markRendererInitialized: (webContentsId: number) => boolean;
  readonly markFocused: (webContentsId: number) => void;
  readonly release: (
    webContentsId: number,
    input: {
      readonly disposition: WindowSessionCloseDisposition;
      readonly bounds?: WindowSessionBounds;
    },
  ) => WindowSessionRecord | null;
  readonly resolveSessionId: (webContentsId: number) => string | null;
  readonly rollbackReopenSession: (
    previousRecord: ReopenedWindowSession["previousRecord"],
  ) => WindowSessionRecord | null;
  readonly saveLayout: (
    webContentsId: number,
    input: WindowSessionSaveLayoutInput,
    bounds?: WindowSessionBounds,
  ) => WindowSessionRecord;
  readonly seedInitialProjectPresentation: (
    presentation: InitialProjectPresentation,
  ) => WindowSessionRecord;
  readonly selectStartupSessions: (policy: WindowRestorePolicy) => readonly WindowSessionRecord[];
  readonly updateBounds: (webContentsId: number, bounds: WindowSessionBounds) => void;
}

/** Owns the live Electron windows and their durable Window Session assignments as one resource. */
export class WindowRuntime extends Context.Service<WindowRuntime, WindowRuntimeService>()(
  "nodex/main/window-runtime/WindowRuntime",
) {}

export const fromState = (
  sessions: WindowSessionState,
  appearance: WindowAppearancePort = noWindowAppearance,
): Layer.Layer<WindowRuntime> =>
  Layer.effect(
    WindowRuntime,
    Effect.gen(function* () {
      const closeTimeouts = yield* FiberMap.make<number, void>();
      const runCloseTimeout = yield* FiberMap.runtime(closeTimeouts)();
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          const windows = new Map<number, BrowserWindow>();
          const managedCloses = new Map<number, ManagedWindowClose>();
          const initializedRenderers = new Set<number>();
          let lastFocusedWebContentsId: number | null = null;
          let applicationQuitRequested = false;

          const cleanupClose = (webContentsId: number): void => {
            const managed = managedCloses.get(webContentsId);
            if (!managed) return;
            managedCloses.delete(webContentsId);
            if (managed.timeoutPending) {
              managed.timeoutPending = false;
              runCloseTimeout(webContentsId, Effect.void);
            }
            managed.window.removeListener("close", managed.closeHandler);
            managed.window.removeListener("closed", managed.closedHandler);
            managed.window.removeListener("blur", managed.blurHandler);
            managed.window.removeListener("focus", managed.focusHandler);
            managed.window.removeListener("move", managed.moveHandler);
            managed.window.removeListener("resize", managed.resizeHandler);
          };

          const release: WindowRuntimeService["release"] = (webContentsId, input) => {
            try {
              return sessions.detachWindow(webContentsId, input);
            } finally {
              cleanupClose(webContentsId);
              initializedRenderers.delete(webContentsId);
              const releasedWindow = windows.get(webContentsId);
              if (releasedWindow) appearance.forget(releasedWindow);
              windows.delete(webContentsId);
              if (lastFocusedWebContentsId === webContentsId) {
                lastFocusedWebContentsId = null;
              }
            }
          };

          const installCloseLifecycle = (window: BrowserWindow): void => {
            const webContentsId = window.webContents.id;
            const managed = {} as ManagedWindowClose;
            managed.allowImmediate = false;
            managed.disposition = "unexpected";
            managed.finalBounds = undefined;
            managed.timeoutPending = false;
            managed.window = window;
            managed.finish = () => {
              if (window.isDestroyed()) return;
              managed.allowImmediate = true;
              managed.finalBounds = captureWindowSessionBounds(window);
              managed.disposition = applicationQuitRequested ? "app-quit" : "user-close";
              window.close();
            };
            managed.acknowledge = () => {
              if (managed.timeoutPending) {
                managed.timeoutPending = false;
                runCloseTimeout(webContentsId, Effect.void);
              }
              managed.finish();
            };
            managed.closeHandler = (event) => {
              if (managed.allowImmediate) {
                managed.allowImmediate = false;
                return;
              }
              event.preventDefault();
              if (managed.timeoutPending) return;
              managed.timeoutPending = true;
              runCloseTimeout(
                webContentsId,
                Effect.sleep(WINDOW_CLOSE_FLUSH_TIMEOUT).pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      managed.timeoutPending = false;
                      managed.finish();
                    }),
                  ),
                ),
                { onlyIfMissing: true },
              );
              if (!safeSendToWindow(window, "app:flush-before-close", [webContentsId])) {
                managed.acknowledge();
              }
            };
            managed.closedHandler = () => {
              try {
                release(webContentsId, {
                  disposition: managed.disposition,
                  bounds: managed.finalBounds,
                });
              } catch (error) {
                logger.error("Could not finalize Window Session close", {
                  error: error instanceof Error ? error.message : String(error),
                  webContentsId,
                });
                cleanupClose(webContentsId);
                windows.delete(webContentsId);
              }
            };
            managed.focusHandler = () => {
              lastFocusedWebContentsId = webContentsId;
              sessions.markFocused(webContentsId);
              appearance.apply(window);
              safeSendToWindow(window, "electron-window:focus-changed", [{ isFocused: true }]);
            };
            managed.blurHandler = () => {
              appearance.apply(window);
              safeSendToWindow(window, "electron-window:focus-changed", [{ isFocused: false }]);
            };
            const updateBounds = (): void => {
              if (window.isDestroyed()) return;
              sessions.updateBounds(webContentsId, captureWindowSessionBounds(window));
              appearance.apply(window);
            };
            managed.moveHandler = updateBounds;
            managed.resizeHandler = updateBounds;
            managedCloses.set(webContentsId, managed);
            window.on("close", managed.closeHandler);
            window.on("closed", managed.closedHandler);
            window.on("blur", managed.blurHandler);
            window.on("focus", managed.focusHandler);
            window.on("move", managed.moveHandler);
            window.on("resize", managed.resizeHandler);
          };

          const runtime = WindowRuntime.of({
            acknowledgeClose: (webContentsId) => managedCloses.get(webContentsId)?.acknowledge(),
            acquireSessionForNewWindow: (sourceWebContentsId) =>
              sessions.acquireSessionForNewWindow(sourceWebContentsId),
            all: () => [...windows.values()],
            attach: (window, sessionId) => {
              const webContentsId = window.webContents.id;
              const session = sessions.attachWindow(webContentsId, sessionId);
              windows.set(webContentsId, window);
              lastFocusedWebContentsId = webContentsId;
              installCloseLifecycle(window);
              appearance.apply(window, true);
              return session;
            },
            bootstrap: (webContentsId) => sessions.bootstrap(webContentsId),
            beginApplicationQuit: () => {
              applicationQuitRequested = true;
            },
            cloneSessionForWindow: (sourceWebContentsId, override) =>
              sessions.cloneSessionForWindow(sourceWebContentsId, override),
            count: () => windows.size,
            get: (webContentsId) => windows.get(webContentsId) ?? null,
            getLastFocused: () => {
              if (lastFocusedWebContentsId !== null) {
                const remembered = windows.get(lastFocusedWebContentsId);
                if (remembered && !remembered.isDestroyed()) return remembered;
              }
              return [...windows.values()].find((window) => !window.isDestroyed()) ?? null;
            },
            has: (webContentsId) => windows.has(webContentsId),
            hasClosedSessionAvailable: () => sessions.hasClosedSessionAvailable(),
            isRendererInitialized: (webContentsId) => initializedRenderers.has(webContentsId),
            markRendererInitialized: (webContentsId) => {
              if (!windows.has(webContentsId) || initializedRenderers.has(webContentsId))
                return false;
              initializedRenderers.add(webContentsId);
              return true;
            },
            markFocused: (webContentsId) => {
              if (!windows.has(webContentsId)) return;
              lastFocusedWebContentsId = webContentsId;
              sessions.markFocused(webContentsId);
            },
            release,
            resolveSessionId: (webContentsId) => sessions.getSessionIdForWindow(webContentsId),
            rollbackReopenSession: (previousRecord) =>
              sessions.rollbackReopenSession(previousRecord),
            saveLayout: (webContentsId, input, bounds) =>
              sessions.saveLayout(webContentsId, input, bounds),
            seedInitialProjectPresentation: (presentation) =>
              sessions.seedInitialProjectPresentation(presentation),
            selectStartupSessions: (policy) => sessions.selectStartupSessions(policy),
            updateBounds: (webContentsId, bounds) => sessions.updateBounds(webContentsId, bounds),
          });
          const refreshWindowBackdrops = (): void => {
            for (const window of windows.values()) {
              appearance.apply(window, true);
            }
          };
          const releaseThemeSubscription = appearance.subscribeToTheme(refreshWindowBackdrops);
          return {
            runtime,
            dispose: () => {
              releaseThemeSubscription();
              for (const window of runtime.all()) {
                const webContentsId = window.webContents.id;
                if (!window.isDestroyed()) window.destroy();
                if (!runtime.has(webContentsId)) continue;
                try {
                  runtime.release(webContentsId, { disposition: "unexpected" });
                } catch {
                  // Scope release must still forget every remaining native window.
                }
              }
            },
          };
        }),
        ({ dispose }) => Effect.sync(dispose),
      ).pipe(Effect.map(({ runtime }) => runtime));
    }),
  );

export const live = (userDataPath: string, platform: NodeJS.Platform): Layer.Layer<WindowRuntime> =>
  Layer.unwrap(
    Effect.sync(() =>
      fromState(new WindowSessionState(userDataPath), createElectronWindowAppearance(platform)),
    ),
  );
