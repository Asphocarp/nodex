import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BROWSER_SIDEBAR_PARTITION } from "../../shared/browser-sidebar";
import { isAllowedBrowserNavigationUrl } from "../../shared/browser-url";
import { MainConfig } from "../app/MainConfig";
import { shouldGrantBrowserPermission } from "../browser/browser-session-permissions";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";
import { shouldGrantAppRendererPermission } from "../renderer-permissions";

export class SessionPolicyRuntime extends Context.Service<
  SessionPolicyRuntime,
  { readonly installed: true }
>()("nodex/main/host-runtime/SessionPolicyRuntime") {}

/** Installs the application and Browser partition policies before any user window exists. */
export const live: Layer.Layer<SessionPolicyRuntime, never, ElectronSessionHost | MainConfig> =
  Layer.effect(
    SessionPolicyRuntime,
    Effect.gen(function* () {
      const host = yield* ElectronSessionHost;
      const config = yield* MainConfig;
      const appSession = yield* host.defaultSession;
      const browserSession = yield* host.fromPartition(BROWSER_SIDEBAR_PARTITION);

      yield* host.scopedRegistration(
        () => {
          appSession.setPermissionCheckHandler((webContents, permission, origin, details) =>
            shouldGrantAppRendererPermission({
              developmentOrigin: config.rendererUrl,
              hasOwnerWindow: host.hasOwnerWindow(webContents),
              permission,
              webContentsType: webContents?.getType() ?? null,
              isMainFrame: details.isMainFrame,
              requestingOrigin: origin,
              requestedMediaTypes: details.mediaType ? [details.mediaType] : undefined,
            }),
          );
          appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
            callback(
              shouldGrantAppRendererPermission({
                developmentOrigin: config.rendererUrl,
                hasOwnerWindow: host.hasOwnerWindow(webContents),
                permission,
                webContentsType: webContents.getType(),
                isMainFrame: details.isMainFrame,
                requestingOrigin: details.requestingUrl,
                requestedMediaTypes: "mediaTypes" in details ? details.mediaTypes : undefined,
              }),
            );
          });
        },
        () => {
          appSession.setPermissionCheckHandler(null);
          appSession.setPermissionRequestHandler(null);
        },
      );
      yield* host.scopedRegistration(
        () => {
          browserSession.setPermissionCheckHandler((_webContents, permission, _origin, details) =>
            shouldGrantBrowserPermission({
              permission,
              isMainFrame: details.isMainFrame,
            }),
          );
          browserSession.setPermissionRequestHandler(
            (_webContents, permission, callback, details) => {
              callback(
                shouldGrantBrowserPermission({
                  permission,
                  isMainFrame: details.isMainFrame,
                }),
              );
            },
          );
          browserSession.webRequest.onBeforeRequest((details, callback) => {
            const shouldBlockTopFrame =
              details.resourceType === "mainFrame" && !isAllowedBrowserNavigationUrl(details.url);
            callback({ cancel: shouldBlockTopFrame });
          });
        },
        () => {
          browserSession.setPermissionCheckHandler(null);
          browserSession.setPermissionRequestHandler(null);
          browserSession.webRequest.onBeforeRequest(null);
        },
      );

      return SessionPolicyRuntime.of({ installed: true });
    }),
  );
