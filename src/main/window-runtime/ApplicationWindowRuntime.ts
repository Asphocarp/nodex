import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { BrowserWindow, nativeImage, nativeTheme, screen, shell } from "electron";
import { performance } from "node:perf_hooks";
import type { AppUpdateStatus } from "../../shared/types";
import { BROWSER_SIDEBAR_PARTITION } from "../../shared/browser-sidebar";
import { isAllowedBrowserExternalUrl } from "../../shared/browser-url";
import type { WindowSessionRecord } from "../../shared/window-session";
import type { BrowserGuestHost } from "../browser-application/BrowserApplication";
import type { BrowserAuthorizedAttachment } from "../browser/browser-runtime-registry";
import {
  consumePendingBrowserWebviewAttachment,
  decideBrowserWebviewAttachment,
  parseBrowserWebviewInstanceId,
  registerPendingBrowserWebviewAttachment,
} from "../browser/browser-webview-attachment-policy";
import type { CodexRendererConversationCoordinator } from "../codex-application/CodexRendererConversationCoordinator";
import type {
  RendererClientRegistration,
  RendererClientRuntimeService,
} from "../codex/renderer-client-runtime-contracts";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { MainCleanup } from "../app/MainCleanup";
import { ElectronIpc } from "../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../platform/electron/TrustedRendererSender";
import { ComposerAppshotRuntime } from "../host-runtime/ComposerAppshotRuntime";
import type { DesktopNotificationRuntime } from "../host-runtime/DesktopNotificationRuntime";
import type { McpAppSandboxRuntime } from "../host-runtime/McpAppSandboxRuntime";
import { getLogger } from "../logging/logger";
import { captureMainException, captureMainMessage } from "../observability/sentry-main";
import { resolveCodexTitleBarOptions } from "../window-navigation-chrome";
import { isWindowSessionBoundsVisible } from "../window-session-state";
import type { WindowRuntimeService } from "./WindowRuntime";
import { safeSendToWindow } from "../ipc-safe-send";
import { MAIN_OBSERVATION_EVENT_CAPACITY } from "../runtime-limits";
import { WindowShutdown } from "./WindowShutdown";
import {
  createApplicationWindowCoordinator,
  type ApplicationWindowCoordinator,
} from "./application-window-coordinator";

export interface ApplicationWindowRuntimeOptions {
  readonly appUpdates: {
    readonly currentStatus: Effect.Effect<AppUpdateStatus>;
  };
  readonly browser: BrowserGuestHost;
  readonly rendererConversations: CodexRendererConversationCoordinator["Service"];
  readonly desktopNotifications: DesktopNotificationRuntime["Service"];
  readonly iconPath: string;
  readonly mcpAppSandbox: McpAppSandboxRuntime["Service"];
  readonly platform: NodeJS.Platform;
  readonly preloadPath: string;
  readonly rendererClients: RendererClientRuntimeService;
  readonly rendererUrl: string;
  readonly windows: WindowRuntimeService;
}

export class ApplicationWindowRuntime extends Context.Service<
  ApplicationWindowRuntime,
  ApplicationWindowCoordinator & {
    readonly create: (session: WindowSessionRecord) => BrowserWindow;
    readonly rendererLoaded: Stream.Stream<number>;
    readonly syncTitle: (window: BrowserWindow) => void;
  }
>()("nodex/main/window-runtime/ApplicationWindowRuntime") {}

class WindowCloseHandshakeError extends Data.TaggedError("WindowCloseHandshakeError")<{
  readonly cause: unknown;
}> {}

const syncMacWindowTitle = (platform: NodeJS.Platform, window: BrowserWindow): void => {
  if (platform !== "darwin" || window.isDestroyed()) return;
  window.setTitle("Nodex");
};

export const live = (
  options: ApplicationWindowRuntimeOptions,
): Layer.Layer<
  ApplicationWindowRuntime,
  never,
  ComposerAppshotRuntime | ElectronIpc | MainCleanup | ScopedCallbackRuntime | WindowShutdown
> =>
  Layer.effect(
    ApplicationWindowRuntime,
    Effect.gen(function* () {
      const appshots = yield* ComposerAppshotRuntime;
      const callbacks = yield* ScopedCallbackRuntime;
      const cleanup = yield* MainCleanup;
      const ipc = yield* ElectronIpc;
      const windowShutdown = yield* WindowShutdown;
      const rendererLoaded = yield* PubSub.sliding<number>(MAIN_OBSERVATION_EVENT_CAPACITY);
      yield* Effect.addFinalizer(() => PubSub.shutdown(rendererLoaded));
      const logger = getLogger({ component: "application-window-runtime" });
      const icon = nativeImage.createFromPath(options.iconPath);

      // This acknowledgement belongs to the Window resource, not the broad IPC cluster. Register
      // it before the Window finalizer so it remains live while graceful close flushes renderers.
      yield* ipc.handle("app:flush-before-close:done", (event, claimedWebContentsId: unknown) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSender(event, "Window close flush", options.rendererUrl);
            if (!options.windows.has(event.sender.id)) {
              throw new Error("Window close flush requires an active Nodex window");
            }
            if (claimedWebContentsId !== event.sender.id) {
              throw new Error("Window close flush sender does not own the claimed window");
            }
            options.windows.acknowledgeClose(event.sender.id);
          },
          catch: (cause) => new WindowCloseHandshakeError({ cause }),
        }),
      );

      const create = (session: WindowSessionRecord): BrowserWindow => {
        const windowCreatedAt = performance.now();
        const savedBounds = isWindowSessionBoundsVisible(session.bounds, screen.getAllDisplays())
          ? session.bounds
          : undefined;
        const titleBarOptions = resolveCodexTitleBarOptions({
          platform: options.platform,
          windowZoom: 1,
          isDark: nativeTheme.shouldUseDarkColors,
        });
        const window = new BrowserWindow({
          x: savedBounds?.x,
          y: savedBounds?.y,
          width: savedBounds?.width ?? 1_400,
          height: savedBounds?.height ?? 900,
          minWidth: 800,
          minHeight: 600,
          ...(options.platform === "darwin" ? { title: "Nodex" } : { icon }),
          ...titleBarOptions,
          ...(options.platform === "darwin"
            ? {
                vibrancy: "menu" as const,
                visualEffectState: "followWindow" as const,
                backgroundColor: "#00000000",
              }
            : {}),
          webPreferences: {
            preload: options.preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true,
            backgroundThrottling: false,
          },
        });
        appshots.observeWindow(window);
        const mcpAppSandboxHost = options.mcpAppSandbox.createHost(window.webContents);
        const pendingBrowserAttachments = new Map<number, BrowserAuthorizedAttachment>();
        window.webContents.setWindowOpenHandler(({ url }) => {
          if (isAllowedBrowserExternalUrl(url)) void shell.openExternal(url);
          return { action: "deny" };
        });
        window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
          const webviewParams = params as typeof params & {
            instanceId?: number | string;
            nodeintegration?: string;
            preload?: string;
            webpreferences?: string;
          };
          if (mcpAppSandboxHost.handlesPartition(webviewParams.partition)) {
            mcpAppSandboxHost.handleWillAttach(event, webPreferences, webviewParams);
            return;
          }
          const instanceId = parseBrowserWebviewInstanceId(webviewParams.instanceId);
          if (instanceId === null || pendingBrowserAttachments.has(instanceId)) {
            logger.warn("Rejected Browser webview attachment", {
              reason: instanceId === null ? "invalid-instance-id" : "duplicate-instance-id",
              webContentsId: window.webContents.id,
            });
            event.preventDefault();
            return;
          }
          const decision = decideBrowserWebviewAttachment({
            authorizeAttachment: (route) =>
              options.browser.authorizeAttachment(window.webContents.id, route),
            isRegisteredBrowserStorage: (identity, browserStorageId) =>
              options.browser.isRegisteredStorage(identity, browserStorageId),
            ownerBrowserViewScopeId:
              options.windows.resolveSessionId(window.webContents.id) ?? session.id,
            partition: params.partition,
            revokeAuthorizedAttachment: (attachToken) =>
              options.browser.revokeAttachment(attachToken),
            src: params.src,
          });
          if (!decision.ok) {
            logger.warn("Rejected Browser webview attachment", {
              reason: decision.reason,
              browserConversationId: decision.route?.browserConversationId,
              browserViewScopeId: decision.route?.browserViewScopeId,
              browserTabId: decision.route?.browserTabId,
              webContentsId: window.webContents.id,
            });
            event.preventDefault();
            return;
          }
          const registration = registerPendingBrowserWebviewAttachment(
            pendingBrowserAttachments,
            instanceId,
            decision.authorization,
          );
          if (!registration.ok) {
            options.browser.revokeAttachment(decision.authorization.attachToken);
            logger.warn("Rejected Browser webview attachment", {
              reason: registration.reason,
              browserConversationId: decision.authorization.browserConversationId,
              browserViewScopeId: decision.authorization.browserViewScopeId,
              browserTabId: decision.authorization.browserTabId,
              webContentsId: window.webContents.id,
            });
            event.preventDefault();
            return;
          }
          Object.assign(webPreferences, {
            allowRunningInsecureContent: false,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            nodeIntegrationInWorker: false,
            preload: `${__dirname}/../preload/browser-guest.js`,
            plugins: false,
            partition: BROWSER_SIDEBAR_PARTITION,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
          });
          params.partition = BROWSER_SIDEBAR_PARTITION;
          delete webviewParams.nodeintegration;
          delete webviewParams.preload;
          delete webviewParams.webpreferences;
          delete (webPreferences as typeof webPreferences & { preloadURL?: string }).preloadURL;
        });
        window.webContents.on("did-attach-webview", (_event, guest) => {
          if (mcpAppSandboxHost.handleDidAttach(guest)) return;
          const pending = consumePendingBrowserWebviewAttachment(
            pendingBrowserAttachments,
            (guest as typeof guest & { viewInstanceId?: number | string }).viewInstanceId,
          );
          if (!pending) {
            logger.warn("Rejected unmatched Browser webview attachment", {
              guestWebContentsId: guest.id,
              ownerWebContentsId: window.webContents.id,
            });
            guest.close();
            return;
          }
          const ownership = options.browser.consumeAuthorizedAttachment(
            pending.attachToken,
            window.webContents.id,
            guest.id,
          );
          if (!ownership) {
            logger.warn("Rejected unauthorized Browser webview attachment", {
              browserConversationId: pending.browserConversationId,
              browserViewScopeId: pending.browserViewScopeId,
              browserTabId: pending.browserTabId,
              guestWebContentsId: guest.id,
              ownerWebContentsId: window.webContents.id,
            });
            guest.close();
            return;
          }
          options.browser.registerOwnership(
            window.webContents.id,
            guest.id,
            ownership,
            ownership.browserStorageId,
          );
          options.browser.prepareHistoryRestore(ownership, guest.id);
        });

        const webContentsId = window.webContents.id;
        let rendererRegistration: RendererClientRegistration | null =
          options.rendererClients.register(window.webContents);
        callbacks.fork(
          options.rendererConversations.setClientForegrounded(
            rendererRegistration.clientId,
            window.isFocused(),
          ),
        );
        syncMacWindowTitle(options.platform, window);
        if (savedBounds?.mode === "maximized") window.maximize();
        else if (savedBounds?.mode === "fullscreen") window.setFullScreen(true);

        window.on("focus", () =>
          callbacks.fork(
            options.rendererConversations.setClientForegrounded(
              rendererRegistration?.clientId,
              true,
            ),
          ),
        );
        window.on("blur", () =>
          callbacks.fork(
            options.rendererConversations.setClientForegrounded(
              rendererRegistration?.clientId,
              false,
            ),
          ),
        );
        window.webContents.on("did-finish-load", () => {
          logger.info("Renderer document finished loading", {
            durationMs: Math.round(performance.now() - windowCreatedAt),
            webContentsId,
          });
          syncMacWindowTitle(options.platform, window);
          callbacks.fork(
            options.appUpdates.currentStatus.pipe(
              Effect.tap((status) =>
                Effect.sync(() => safeSendToWindow(window, "app:update-status", [status])),
              ),
              Effect.andThen(PubSub.publish(rendererLoaded, webContentsId)),
              Effect.asVoid,
            ),
          );
        });
        window.webContents.on("render-process-gone", (_event, details) => {
          logger.error("Renderer process gone", {
            webContentsId,
            reason: details.reason,
            exitCode: details.exitCode,
          });
          captureMainMessage("Renderer process gone", {
            tags: { reason: details.reason },
            extra: { webContentsId, exitCode: details.exitCode },
          });
        });
        window.on("closed", () => {
          options.browser.releaseOwner(webContentsId);
          options.desktopNotifications.dismissByOriginWebContentsId(webContentsId);
          callbacks.fork(
            options.rendererConversations.setClientForegrounded(
              rendererRegistration?.clientId,
              false,
            ),
          );
          if (rendererRegistration) callbacks.fork(rendererRegistration.release);
          rendererRegistration = null;
        });
        try {
          options.windows.attach(window, session.id);
        } catch (error) {
          window.destroy();
          throw error;
        }
        void window.loadURL(options.rendererUrl).catch((error: unknown) => {
          logger.error("Could not load the application renderer", {
            error,
            rendererUrl: options.rendererUrl,
          });
        });
        return window;
      };

      const coordinator = createApplicationWindowCoordinator({
        closeAll: windowShutdown.closeAll,
        create,
        focusedWindow: () => BrowserWindow.getFocusedWindow(),
        reportFailure: ({ cause, operation, windowSessionId }) => {
          const phase =
            operation === "rollback"
              ? "window-session-acquisition-rollback"
              : "window-session-acquisition";
          logger.error(
            operation === "rollback"
              ? "Could not roll back failed Window Session acquisition"
              : "Could not open a new window",
            {
              error: cause instanceof Error ? cause.message : String(cause),
              windowSessionId,
            },
          );
          captureMainException(cause, { tags: { phase } });
        },
        syncTitle: (window) => syncMacWindowTitle(options.platform, window),
        windows: options.windows,
      });
      yield* Effect.addFinalizer(() =>
        coordinator.prepareQuit.pipe(
          Effect.tap((report) =>
            report.destroyed > 0 || report.failed > 0
              ? Effect.logWarning("Window shutdown required escalation").pipe(
                  Effect.annotateLogs({
                    destroyed: report.destroyed,
                    failed: report.failed,
                    graceful: report.graceful,
                    total: report.total,
                  }),
                )
              : Effect.void,
          ),
          Effect.tap((report) =>
            cleanup.report(
              report.failures.map((failure) => ({
                subsystem: "window",
                operation: failure.phase,
                reason: failure.reason,
              })),
            ),
          ),
          Effect.asVoid,
        ),
      );

      return ApplicationWindowRuntime.of({
        ...coordinator,
        create,
        rendererLoaded: Stream.fromPubSub(rendererLoaded),
        syncTitle: (window) => syncMacWindowTitle(options.platform, window),
      });
    }),
  );
