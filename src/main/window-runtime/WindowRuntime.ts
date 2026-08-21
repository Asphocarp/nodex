import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { BrowserWindow } from "electron";
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

export interface WindowRuntimeService {
  readonly acquireSessionForNewWindow: (sourceWebContentsId?: number) => AcquiredWindowSession;
  readonly all: () => readonly BrowserWindow[];
  readonly attach: (window: BrowserWindow, sessionId: string) => WindowSessionRecord;
  readonly bootstrap: (webContentsId: number) => WindowSessionRecord;
  readonly cloneSessionForWindow: (
    sourceWebContentsId: number,
    override?: WindowSessionNewWindowRequest,
  ) => WindowSessionRecord;
  readonly count: () => number;
  readonly get: (webContentsId: number) => BrowserWindow | null;
  readonly getLastFocused: () => BrowserWindow | null;
  readonly has: (webContentsId: number) => boolean;
  readonly hasClosedSessionAvailable: () => boolean;
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

export const fromState = (sessions: WindowSessionState): Layer.Layer<WindowRuntime> =>
  Layer.effect(
    WindowRuntime,
    Effect.acquireRelease(
      Effect.sync(() => {
        const windows = new Map<number, BrowserWindow>();
        let lastFocusedWebContentsId: number | null = null;

        const release: WindowRuntimeService["release"] = (webContentsId, input) => {
          try {
            return sessions.detachWindow(webContentsId, input);
          } finally {
            windows.delete(webContentsId);
            if (lastFocusedWebContentsId === webContentsId) {
              lastFocusedWebContentsId = null;
            }
          }
        };

        return WindowRuntime.of({
          acquireSessionForNewWindow: (sourceWebContentsId) =>
            sessions.acquireSessionForNewWindow(sourceWebContentsId),
          all: () => [...windows.values()],
          attach: (window, sessionId) => {
            const webContentsId = window.webContents.id;
            const session = sessions.attachWindow(webContentsId, sessionId);
            windows.set(webContentsId, window);
            lastFocusedWebContentsId = webContentsId;
            return session;
          },
          bootstrap: (webContentsId) => sessions.bootstrap(webContentsId),
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
          markFocused: (webContentsId) => {
            if (!windows.has(webContentsId)) return;
            lastFocusedWebContentsId = webContentsId;
            sessions.markFocused(webContentsId);
          },
          release,
          resolveSessionId: (webContentsId) => sessions.getSessionIdForWindow(webContentsId),
          rollbackReopenSession: (previousRecord) => sessions.rollbackReopenSession(previousRecord),
          saveLayout: (webContentsId, input, bounds) =>
            sessions.saveLayout(webContentsId, input, bounds),
          seedInitialProjectPresentation: (presentation) =>
            sessions.seedInitialProjectPresentation(presentation),
          selectStartupSessions: (policy) => sessions.selectStartupSessions(policy),
          updateBounds: (webContentsId, bounds) => sessions.updateBounds(webContentsId, bounds),
        });
      }),
      (runtime) =>
        Effect.sync(() => {
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
        }),
    ),
  );

export const live = (userDataPath: string): Layer.Layer<WindowRuntime> =>
  Layer.unwrap(Effect.sync(() => fromState(new WindowSessionState(userDataPath))));
