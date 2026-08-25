import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  BrowserWindow,
  nativeImage,
  nativeTheme,
  screen,
  type BrowserWindowConstructorOptions,
  type Display,
} from "electron";
import { performance } from "node:perf_hooks";
import { APP_RENDERER_URL } from "../../shared/app-renderer-policy";
import type { WindowRestorePolicy, WindowSessionRecord } from "../../shared/window-session";
import { MainConfig } from "../app/MainConfig";
import { resolveElectronWindowBackdrop } from "../electron-window-backdrop";
import type { ElectronWindowBackdrop } from "../electron-window-backdrop";
import { AppProtocolRuntime } from "../host-runtime/AppProtocolRuntime";
import { getLogger } from "../logging/logger";
import { resolveCodexTitleBarOptions } from "../window-navigation-chrome";
import { isWindowSessionBoundsVisible } from "../window-session-state";
import { WindowRuntime, type WindowRuntimeService } from "./WindowRuntime";

const SHOW_WATCHDOG_MS = 1_200;
const ACTIVATION_WATCHDOG_MS = 5_000;

export type ApplicationWindowShellPhase =
  | "loading"
  | "bootstrapping"
  | "activating"
  | "active"
  | "failed"
  | "closed";

export class ApplicationWindowShellError extends Data.TaggedError("ApplicationWindowShellError")<{
  readonly operation: string;
  readonly cause: unknown;
  readonly webContentsId?: number;
}> {}

export interface ApplicationWindowActivationLease {
  readonly session: WindowSessionRecord;
  readonly window: BrowserWindow;
}

export interface ApplicationWindowShellRuntimeService {
  readonly awaitActivation: (
    webContentsId: number,
  ) => Effect.Effect<void, ApplicationWindowShellError>;
  readonly claimPendingActivation: () => readonly ApplicationWindowActivationLease[];
  readonly completeActivation: (webContentsId: number) => void;
  readonly create: (
    session: WindowSessionRecord,
    presentation?: "background" | "foreground",
  ) => BrowserWindow;
  readonly failAll: (cause: unknown) => void;
  readonly failActivation: (webContentsId: number, cause: unknown) => void;
  readonly openInitial: (policy: WindowRestorePolicy) => readonly BrowserWindow[];
  readonly reportRenderer: (webContentsId: number) => void;
}

export class ApplicationWindowShellRuntime extends Context.Service<
  ApplicationWindowShellRuntime,
  ApplicationWindowShellRuntimeService
>()("nodex/main/window-runtime/ApplicationWindowShellRuntime") {}

export interface ApplicationWindowShellRuntimeOptions {
  readonly createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  readonly displays?: {
    readonly getAllDisplays: () => Display[];
    readonly getDisplayMatching: (bounds: Electron.Rectangle) => Display;
    readonly getPrimaryDisplay: () => Display;
  };
  readonly iconPath: string;
  readonly platform: NodeJS.Platform;
  readonly preloadPath: string;
  readonly rendererUrl: string;
  readonly theme?: {
    readonly prefersReducedTransparency: boolean;
    readonly shouldUseDarkColors: boolean;
  };
  readonly windows: WindowRuntimeService;
}

interface ShellRecord {
  activationWatchdog: ReturnType<typeof setTimeout> | null;
  readonly gate: Deferred.Deferred<void, ApplicationWindowShellError>;
  phase: ApplicationWindowShellPhase;
  readonly presentation: "background" | "foreground";
  readyToShow: boolean;
  revealed: boolean;
  readonly session: WindowSessionRecord;
  showWatchdog: ReturnType<typeof setTimeout> | null;
  readonly window: BrowserWindow;
}

function withApplicationShellParameters(
  rendererUrl: string,
  input: { readonly opaqueWindowSurfaceEnabled: boolean; readonly platform: NodeJS.Platform },
): string {
  const url = new URL(rendererUrl);
  url.searchParams.set("opaqueWindowSurface", String(input.opaqueWindowSurfaceEnabled));
  url.searchParams.set("platform", input.platform);
  return url.toString();
}

function isSameRendererOrigin(candidateUrl: string, rendererUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const expected = new URL(rendererUrl);
    return candidate.protocol === expected.protocol && candidate.host === expected.host;
  } catch {
    return false;
  }
}

export function resolveApplicationWindowShellAppearance(
  platform: NodeJS.Platform,
  backdrop: ElectronWindowBackdrop,
): BrowserWindowConstructorOptions {
  return {
    backgroundColor: backdrop.backgroundColor,
    ...(platform === "darwin"
      ? {
          transparent: true,
          vibrancy: backdrop.vibrancy ?? undefined,
          visualEffectState: "followWindow" as const,
        }
      : {}),
    ...(platform === "win32" ? { backgroundMaterial: backdrop.backgroundMaterial ?? "none" } : {}),
  };
}

/** Owns the final BrowserWindow identity before feature authorities exist. */
export const live = (
  options: ApplicationWindowShellRuntimeOptions,
): Layer.Layer<ApplicationWindowShellRuntime> =>
  Layer.effect(
    ApplicationWindowShellRuntime,
    Effect.acquireRelease(
      Effect.sync(() => {
        const logger = getLogger({ component: "application-window-shell-runtime" });
        const createWindow = options.createWindow ?? ((input) => new BrowserWindow(input));
        const displays = options.displays ?? screen;
        const theme = options.theme ?? nativeTheme;
        const icon =
          options.platform === "darwin" ? undefined : nativeImage.createFromPath(options.iconPath);
        const records = new Map<number, ShellRecord>();
        const activationOrder: number[] = [];
        let activationGateOwner: number | null = null;
        let initialRestoreComplete = false;

        const clearActivationWatchdog = (record: ShellRecord): void => {
          if (!record.activationWatchdog) return;
          clearTimeout(record.activationWatchdog);
          record.activationWatchdog = null;
        };
        const clearShowWatchdog = (record: ShellRecord): void => {
          if (!record.showWatchdog) return;
          clearTimeout(record.showWatchdog);
          record.showWatchdog = null;
        };
        const reveal = (record: ShellRecord, reason: "activation" | "ready" | "watchdog"): void => {
          if (record.revealed || record.window.isDestroyed()) return;
          record.revealed = true;
          clearShowWatchdog(record);
          if (record.presentation === "background") record.window.showInactive();
          else {
            record.window.show();
            record.window.focus();
          }
          logger.info("Canonical application window revealed", {
            reason,
            sessionId: record.session.id,
            webContentsId: record.window.webContents.id,
          });
        };

        const openNextActivationGate = (): void => {
          if (activationGateOwner !== null) return;
          while (activationOrder.length > 0) {
            const webContentsId = activationOrder[0];
            const record = records.get(webContentsId);
            if (!record || record.phase === "closed" || record.phase === "failed") {
              activationOrder.shift();
              continue;
            }
            if (record.phase !== "active") return;
            activationGateOwner = webContentsId;
            Deferred.doneUnsafe(record.gate, Effect.void);
            if (record.presentation === "background") reveal(record, "activation");
            record.activationWatchdog = setTimeout(() => {
              logger.warn("Renderer activation coordination watchdog fired", { webContentsId });
              if (activationGateOwner !== webContentsId) return;
              activationGateOwner = null;
              activationOrder.shift();
              openNextActivationGate();
            }, ACTIVATION_WATCHDOG_MS);
            return;
          }
          initialRestoreComplete = true;
        };

        const create: ApplicationWindowShellRuntimeService["create"] = (
          session,
          presentation = "foreground",
        ) => {
          const windowCreatedAt = performance.now();
          const savedBounds = isWindowSessionBoundsVisible(
            session.bounds,
            displays.getAllDisplays(),
          )
            ? session.bounds
            : undefined;
          const initialBounds = {
            x: savedBounds?.x ?? 0,
            y: savedBounds?.y ?? 0,
            width: savedBounds?.width ?? 1_400,
            height: savedBounds?.height ?? 900,
          };
          const display = savedBounds
            ? displays.getDisplayMatching(initialBounds)
            : displays.getPrimaryDisplay();
          const backdrop = resolveElectronWindowBackdrop({
            bounds: initialBounds,
            isFocused: true,
            platform: options.platform,
            prefersDarkColors: theme.shouldUseDarkColors,
            prefersReducedTransparency: theme.prefersReducedTransparency,
            scaleFactor: display.scaleFactor,
          });
          const titleBarOptions = resolveCodexTitleBarOptions({
            platform: options.platform,
            windowZoom: 1,
            isDark: theme.shouldUseDarkColors,
          });
          const window = createWindow({
            x: savedBounds?.x,
            y: savedBounds?.y,
            width: initialBounds.width,
            height: initialBounds.height,
            minWidth: 800,
            minHeight: 600,
            show: false,
            ...(options.platform === "darwin" ? { title: "Nodex" } : { icon: icon! }),
            ...titleBarOptions,
            ...resolveApplicationWindowShellAppearance(options.platform, backdrop),
            webPreferences: {
              preload: options.preloadPath,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webviewTag: true,
              backgroundThrottling: false,
            },
          });
          const record: ShellRecord = {
            activationWatchdog: null,
            gate: Deferred.makeUnsafe(),
            phase: "loading",
            presentation,
            readyToShow: false,
            revealed: false,
            session,
            showWatchdog: null,
            window,
          };
          const webContentsId = window.webContents.id;
          records.set(webContentsId, record);
          activationOrder.push(webContentsId);

          window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          window.webContents.on("will-navigate", (event, url) => {
            if (isSameRendererOrigin(url, options.rendererUrl)) return;
            event.preventDefault();
          });
          window.webContents.on("will-attach-webview", (event) => {
            if (record.phase === "active") return;
            event.preventDefault();
          });
          window.once("ready-to-show", () => {
            record.readyToShow = true;
            logger.info("Canonical application window ready to show", {
              durationMs: Math.round(performance.now() - windowCreatedAt),
              webContentsId,
            });
            if (presentation === "foreground") reveal(record, "ready");
          });
          window.webContents.once("did-finish-load", () => {
            if (record.phase === "loading") record.phase = "bootstrapping";
          });
          window.once("closed", () => {
            clearActivationWatchdog(record);
            clearShowWatchdog(record);
            record.phase = "closed";
            records.delete(webContentsId);
            Deferred.doneUnsafe(
              record.gate,
              Effect.fail(
                new ApplicationWindowShellError({
                  operation: "await-closed-window-activation",
                  cause: "window-closed",
                  webContentsId,
                }),
              ),
            );
            if (activationGateOwner !== webContentsId) return;
            activationGateOwner = null;
            if (activationOrder[0] === webContentsId) activationOrder.shift();
            openNextActivationGate();
          });

          try {
            options.windows.attach(window, session.id);
          } catch (cause) {
            records.delete(webContentsId);
            window.destroy();
            throw cause;
          }
          if (savedBounds?.mode === "maximized") window.maximize();
          else if (savedBounds?.mode === "fullscreen") window.setFullScreen(true);

          if (presentation === "foreground") {
            record.showWatchdog = setTimeout(() => reveal(record, "watchdog"), SHOW_WATCHDOG_MS);
          }
          const rendererUrl = withApplicationShellParameters(options.rendererUrl, {
            opaqueWindowSurfaceEnabled: backdrop.opaqueWindowSurfaceEnabled,
            platform: options.platform,
          });
          logger.info("Canonical application window constructed", {
            sessionId: session.id,
            webContentsId,
          });
          void window.loadURL(rendererUrl).catch((cause: unknown) => {
            logger.error("Could not load the application renderer", { cause, webContentsId });
            record.phase = "failed";
          });
          return window;
        };

        const service = ApplicationWindowShellRuntime.of({
          awaitActivation: (webContentsId) => {
            const record = records.get(webContentsId);
            if (record) return Deferred.await(record.gate);
            return Effect.fail(
              new ApplicationWindowShellError({
                operation: "await-unknown-window-activation",
                cause: "unknown-window",
                webContentsId,
              }),
            );
          },
          claimPendingActivation: () => {
            const leases: ApplicationWindowActivationLease[] = [];
            for (const record of records.values()) {
              if (record.phase !== "loading" && record.phase !== "bootstrapping") continue;
              record.phase = "activating";
              leases.push({ session: record.session, window: record.window });
            }
            return leases;
          },
          completeActivation: (webContentsId) => {
            const record = records.get(webContentsId);
            if (!record || record.phase !== "activating") {
              throw new ApplicationWindowShellError({
                operation: "complete-window-activation",
                cause: `invalid-phase:${record?.phase ?? "unknown"}`,
                webContentsId,
              });
            }
            record.phase = "active";
            if (initialRestoreComplete && activationGateOwner === null) {
              Deferred.doneUnsafe(record.gate, Effect.void);
              reveal(record, "activation");
              return;
            }
            openNextActivationGate();
          },
          create,
          failAll: (cause) => {
            for (const [webContentsId, record] of records) {
              if (record.phase === "closed" || record.phase === "failed") continue;
              record.phase = "failed";
              clearActivationWatchdog(record);
              record.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
              Deferred.doneUnsafe(
                record.gate,
                Effect.fail(
                  new ApplicationWindowShellError({
                    operation: "application-startup",
                    cause,
                    webContentsId,
                  }),
                ),
              );
              if (record.presentation === "foreground") reveal(record, "activation");
            }
            activationGateOwner = null;
            activationOrder.length = 0;
          },
          failActivation: (webContentsId, cause) => {
            const record = records.get(webContentsId);
            if (!record || record.phase === "closed" || record.phase === "failed") return;
            record.phase = "failed";
            record.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
            Deferred.doneUnsafe(
              record.gate,
              Effect.fail(
                new ApplicationWindowShellError({
                  operation: "activate-window",
                  cause,
                  webContentsId,
                }),
              ),
            );
            if (activationGateOwner !== webContentsId) return;
            clearActivationWatchdog(record);
            activationGateOwner = null;
            if (activationOrder[0] === webContentsId) activationOrder.shift();
            openNextActivationGate();
          },
          openInitial: (policy) => {
            if (records.size > 0) return [...records.values()].map(({ window }) => window);
            const sessions = options.windows.selectStartupSessions(policy);
            const windows = sessions.map((session, index) =>
              create(session, index === 0 ? "foreground" : "background"),
            );
            const primary = windows[0];
            if (primary) options.windows.markFocused(primary.webContents.id);
            return windows;
          },
          reportRenderer: (webContentsId) => {
            if (activationGateOwner !== webContentsId) return;
            const record = records.get(webContentsId);
            if (record) clearActivationWatchdog(record);
            activationGateOwner = null;
            if (activationOrder[0] === webContentsId) activationOrder.shift();
            openNextActivationGate();
          },
        });
        return { records, service };
      }),
      ({ records }) =>
        Effect.sync(() => {
          for (const record of records.values()) {
            clearTimeout(record.showWatchdog ?? undefined);
            clearTimeout(record.activationWatchdog ?? undefined);
            if (!record.window.isDestroyed()) record.window.destroy();
          }
          records.clear();
        }),
    ).pipe(Effect.map(({ service }) => service)),
  );

export const configuredLive: Layer.Layer<
  ApplicationWindowShellRuntime,
  never,
  AppProtocolRuntime | MainConfig | WindowRuntime
> = Layer.unwrap(
  Effect.gen(function* () {
    yield* AppProtocolRuntime;
    const config = yield* MainConfig;
    const windows = yield* WindowRuntime;
    return live({
      iconPath: config.isPackaged
        ? `${config.resourcesPath}/icon.png`
        : `${config.projectRootPath}/resources/icon.png`,
      platform: config.platform as NodeJS.Platform,
      preloadPath: `${__dirname}/../preload/index.js`,
      rendererUrl: config.rendererUrl ?? APP_RENDERER_URL,
      windows,
    });
  }),
);
