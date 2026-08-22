import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { BrowserSidebarTabSnapshot } from "../../../shared/browser-sidebar";
import { BrowserSidebarService } from "../../browser-sidebar-service";
import { makeBrowserRuntimeRegistry } from "../../browser/browser-runtime-registry";
import { makeBrowserEarlyPageRestoreRuntime } from "../../browser/BrowserEarlyPageRestoreRuntime";
import { makeBrowserWebContentsListenerRuntime } from "../../browser/BrowserWebContentsListenerRuntime";
import { BrowserProfileRuntime } from "../../host-runtime/BrowserProfileRuntime";
import { MainConfig } from "../../app/MainConfig";
import { ElectronDesktop } from "../../platform/electron/ElectronDesktop";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { ElectronWindowHost } from "../../platform/electron/ElectronWindowHost";
import { WindowSessionCatalog } from "../../window-runtime/WindowSessionCatalog";
import { live } from "./BrowserProfileIpc";

type InvokeHandler = (
  event: IpcMainInvokeEvent,
  ...args: readonly unknown[]
) => Effect.Effect<unknown, unknown>;
type EventHandler = (event: IpcMainEvent, ...args: readonly unknown[]) => Effect.Effect<void>;

it.effect("registers and releases Browser Profile ingress with the Main Scope", () =>
  Effect.gen(function* () {
    const handlers = new Map<string, InvokeHandler>();
    const listeners = new Map<string, EventHandler>();
    const ipc = ElectronIpc.of({
      handle: (channel, handler) =>
        Effect.acquireRelease(
          Effect.sync(() => handlers.set(channel, handler as InvokeHandler)),
          () => Effect.sync(() => handlers.delete(channel)),
        ).pipe(Effect.asVoid),
      on: (channel, handler) =>
        Effect.acquireRelease(
          Effect.sync(() => listeners.set(channel, handler as EventHandler)),
          () => Effect.sync(() => listeners.delete(channel)),
        ).pipe(Effect.asVoid),
    });
    const scope = yield* Scope.make();
    const browserSidebar = new BrowserSidebarService({
      earlyPageRestores:
        yield* makeBrowserEarlyPageRestoreRuntime<BrowserSidebarTabSnapshot>().pipe(
          Effect.provideService(Scope.Scope, scope),
        ),
      events: { publish: () => undefined },
      runtimeRegistry: makeBrowserRuntimeRegistry(),
      webContentsListeners: yield* makeBrowserWebContentsListenerRuntime.pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
    });
    yield* Layer.buildWithScope(
      live({
        browserSidebar,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              BrowserProfileRuntime,
              BrowserProfileRuntime.of({
                credentials: {} as never,
                download: {} as never,
                extensions: {} as never,
                localServerPreferences: {} as never,
                policy: {} as never,
                profileImport: {} as never,
                siteInfo: {} as never,
              }),
            ),
            Layer.succeed(
              ElectronDesktop,
              ElectronDesktop.of({
                dialog: null as never,
                menu: null as never,
                nativeTheme: null as never,
                safeStorage: null as never,
                shell: null as never,
                showMessage: () => Effect.die("unused"),
                showNotification: () => Effect.die("unused"),
                onPowerEvent: () => Effect.void,
              }),
            ),
            Layer.succeed(ElectronIpc, ipc),
            Layer.succeed(
              ElectronWindowHost,
              ElectronWindowHost.of({
                all: Effect.succeed([]),
                destroyAll: Effect.void,
                fromWebContents: () => Effect.succeed(null),
                onCreated: () => Effect.void,
              }),
            ),
            Layer.succeed(
              MainConfig,
              MainConfig.of({
                assistantStreamingDebug: false,
                appVersion: "test",
                arch: "arm64",
                argv: [],
                composerAppshotHelperPath: null,
                documentsPath: "/tmp/Documents",
                environment: {},
                environmentPath: null,
                homeDirectory: "/tmp",
                initialProjectsDirectory: null,
                isDefaultApp: false,
                isPackaged: false,
                nodexHome: "/tmp/nodex-test",
                platform: "darwin",
                profileId: "test",
                projectRootPath: "/repo",
                rendererUrl: "http://localhost:5173",
                resourcesPath: "/resources",
                runtimeBinaryPath: "/electron",
              }),
            ),
            Layer.succeed(
              WindowSessionCatalog,
              WindowSessionCatalog.of({ resolveForWebContents: () => Effect.succeed(null) }),
            ),
          ),
        ),
      ),
      scope,
    );

    assert.deepEqual([...handlers.keys()].sort(), [
      "browser-contact-info-fill",
      "browser-contact-info-list",
      "browser-contact-info-remove",
      "browser-contact-info-upsert",
      "browser-credential-candidate-action",
      "browser-credential-fill",
      "browser-credential-generate-fill",
      "browser-credential-remove",
      "browser-credentials-list",
      "browser-credentials-list-all",
      "browser-download-action",
      "browser-download-history-clear",
      "browser-downloads-list",
      "browser-extension-load",
      "browser-extension-remove",
      "browser-extensions-list",
      "browser-local-server-preferences-get",
      "browser-local-server-preferences-update",
      "browser-profile-capabilities",
      "browser-profile-import",
      "browser-profile-import-profiles",
      "browser-site-info",
      "browser-use-policy-get",
      "browser-use-policy-update-modes",
      "browser-use-policy-update-origin-rule",
    ]);
    assert.deepEqual([...listeners.keys()].sort(), [
      "browser-annotation-anchor-update",
      "browser-annotation-selection",
      "browser-credential-save-candidate",
      "browser-image-drag-ended",
      "browser-image-drag-started",
      "browser-navigation-button",
    ]);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(handlers.size, 0);
    assert.strictEqual(listeners.size, 0);
  }),
);
