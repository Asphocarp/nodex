import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BROWSER_SIDEBAR_PARTITION } from "../../shared/browser-sidebar";
import { isAllowedBrowserNavigationUrl } from "../../shared/browser-url";
import { shouldGrantBrowserPermission } from "../browser/browser-session-permissions";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";
import { shouldGrantAppRendererPermission } from "../renderer-permissions";

export class SessionPolicyRuntime extends Context.Service<
  SessionPolicyRuntime,
  { readonly installed: true }
>()("nodex/main/host-runtime/SessionPolicyRuntime") {}

/** Installs the application and Browser partition policies before any user window exists. */
export const live: Layer.Layer<SessionPolicyRuntime, never, ElectronSessionHost> = Layer.effect(
  SessionPolicyRuntime,
  Effect.gen(function* () {
    const host = yield* ElectronSessionHost;
    const appSession = yield* host.defaultSession;
    const browserSession = yield* host.fromPartition(BROWSER_SIDEBAR_PARTITION);

    yield* host.scopedRegistration(
      () => {
        appSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
          shouldGrantAppRendererPermission({
            permission,
            webContentsType: webContents?.getType() ?? null,
            isMainFrame: details.isMainFrame,
          }),
        );
        appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
          callback(
            shouldGrantAppRendererPermission({
              permission,
              webContentsType: webContents.getType(),
              isMainFrame: details.isMainFrame,
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
