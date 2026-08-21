import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { BrowserWindow, nativeImage, nativeTheme, screen, shell } from "electron";
import { performance } from "node:perf_hooks";
import type { AppUpdateStatus } from "../../shared/types";
import { BROWSER_SIDEBAR_PARTITION } from "../../shared/browser-sidebar";
import { isAllowedBrowserExternalUrl } from "../../shared/browser-url";
import type { WindowSessionRecord } from "../../shared/window-session";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import type { BrowserAuthorizedAttachment } from "../browser/browser-runtime-registry";
import {
  consumePendingBrowserWebviewAttachment,
  decideBrowserWebviewAttachment,
  parseBrowserWebviewInstanceId,
  registerPendingBrowserWebviewAttachment,
} from "../browser/browser-webview-attachment-policy";
import type { CodexService } from "../codex/codex-service";
import type {
  RendererClientRegistration,
  RendererClientRouter,
} from "../codex/renderer-client-router";
import { composerAppshotService } from "../composer-appshot-service";
import type { DesktopNotificationManager } from "../desktop-notification-manager";
import type { McpAppSandboxRuntime } from "../host-runtime/McpAppSandboxRuntime";
import { getLogger } from "../logging/logger";
import { captureMainMessage } from "../observability/sentry-main";
import { resolveCodexTitleBarOptions } from "../window-navigation-chrome";
import { isWindowSessionBoundsVisible } from "../window-session-state";
import type { WindowRuntimeService } from "./WindowRuntime";
import { safeSendToWindow } from "../ipc-safe-send";

export interface ApplicationWindowRuntimeOptions {
  readonly appUpdates: {
    readonly currentStatus: () => AppUpdateStatus;
  };
  readonly browserSidebar: BrowserSidebarService;
  readonly codex: CodexService;
  readonly desktopNotifications: DesktopNotificationManager;
  readonly iconPath: string;
  readonly mcpAppSandbox: McpAppSandboxRuntime["Service"];
  readonly onRendererLoaded: () => void;
  readonly preloadPath: string;
  readonly rendererClients: RendererClientRouter;
  readonly rendererUrl: string;
  readonly windows: WindowRuntimeService;
}

export class ApplicationWindowRuntime extends Context.Service<
  ApplicationWindowRuntime,
  {
    readonly create: (session: WindowSessionRecord) => BrowserWindow;
    readonly syncTitle: (window: BrowserWindow) => void;
  }
>()("nodex/main/window-runtime/ApplicationWindowRuntime") {}

const syncMacWindowTitle = (window: BrowserWindow): void => {
  if (process.platform !== "darwin" || window.isDestroyed()) return;
  window.setTitle("Nodex");
};

export const live = (
  options: ApplicationWindowRuntimeOptions,
): Layer.Layer<ApplicationWindowRuntime> =>
  Layer.sync(ApplicationWindowRuntime, () => {
    const logger = getLogger({ component: "application-window-runtime" });
    const icon = nativeImage.createFromPath(options.iconPath);

    const create = (session: WindowSessionRecord): BrowserWindow => {
      const windowCreatedAt = performance.now();
      const savedBounds = isWindowSessionBoundsVisible(session.bounds, screen.getAllDisplays())
        ? session.bounds
        : undefined;
      const titleBarOptions = resolveCodexTitleBarOptions({
        platform: process.platform,
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
        ...(process.platform === "darwin" ? { title: "Nodex" } : { icon }),
        ...titleBarOptions,
        ...(process.platform === "darwin"
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
      composerAppshotService.observeWindow(window);
      const mcpAppSandboxHost = options.mcpAppSandbox.createHost(window.webContents);
      mcpAppSandboxHost.installForOwner();
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
            options.browserSidebar.authorizeWebviewAttachment(window.webContents.id, route),
          isRegisteredBrowserStorage: (identity, browserStorageId) =>
            options.browserSidebar.isRegisteredBrowserStorage(identity, browserStorageId),
          ownerBrowserViewScopeId:
            options.windows.resolveSessionId(window.webContents.id) ?? session.id,
          partition: params.partition,
          revokeAuthorizedAttachment: (attachToken) =>
            options.browserSidebar.revokeAuthorizedWebviewAttachment(attachToken),
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
          options.browserSidebar.revokeAuthorizedWebviewAttachment(
            decision.authorization.attachToken,
          );
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
        const ownership = options.browserSidebar.consumeAuthorizedWebviewAttachment(
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
        options.browserSidebar.registerAttachedWebviewOwnership(
          window.webContents.id,
          guest.id,
          ownership,
          ownership.browserStorageId,
        );
        options.browserSidebar.prepareAttachedWebviewHistoryRestore(ownership, guest.id);
      });

      const webContentsId = window.webContents.id;
      let rendererRegistration: RendererClientRegistration | null =
        options.rendererClients.register(window.webContents);
      options.codex.setRendererClientForegrounded(
        rendererRegistration.clientId,
        window.isFocused(),
      );
      syncMacWindowTitle(window);
      if (savedBounds?.mode === "maximized") window.maximize();
      else if (savedBounds?.mode === "fullscreen") window.setFullScreen(true);

      window.on("focus", () =>
        options.codex.setRendererClientForegrounded(rendererRegistration?.clientId, true),
      );
      window.on("blur", () =>
        options.codex.setRendererClientForegrounded(rendererRegistration?.clientId, false),
      );
      window.webContents.on("did-finish-load", () => {
        logger.info("Renderer document finished loading", {
          durationMs: Math.round(performance.now() - windowCreatedAt),
          webContentsId,
        });
        syncMacWindowTitle(window);
        safeSendToWindow(window, "app:update-status", [options.appUpdates.currentStatus()]);
        options.onRendererLoaded();
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
        options.browserSidebar.releaseRendererOwner(webContentsId);
        options.desktopNotifications.dismissByOriginWebContentsId(webContentsId);
        options.codex.setRendererClientForegrounded(rendererRegistration?.clientId, false);
        rendererRegistration?.dispose();
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

    return ApplicationWindowRuntime.of({ create, syncTitle: syncMacWindowTitle });
  });
