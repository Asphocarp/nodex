import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import type { IpcMainInvokeEvent } from "electron";
import { MainConfig } from "../../app/MainConfig";
import { BrowserSidebarService } from "../../browser-sidebar-service";
import { make as makeBrowserSidebarEventHub } from "../../browser/BrowserSidebarEventHub";
import { BrowserSidebarRuntime } from "../../host-runtime/BrowserSidebarRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { ElectronWindowHost } from "../../platform/electron/ElectronWindowHost";
import { WindowSessionCatalog } from "../../window-runtime/WindowSessionCatalog";
import { live } from "./BrowserSidebarIpc";

type Handler = (
  event: IpcMainInvokeEvent,
  ...args: readonly unknown[]
) => Effect.Effect<unknown, unknown>;

it.effect(
  "registers and releases Browser sidebar ingress and projections with the Main Scope",
  () =>
    Effect.gen(function* () {
      const handlers = new Map<string, Handler>();
      const ipc = ElectronIpc.of({
        handle: (channel, handler) =>
          Effect.acquireRelease(
            Effect.sync(() => handlers.set(channel, handler as Handler)),
            () => Effect.sync(() => handlers.delete(channel)),
          ).pipe(Effect.asVoid),
        on: () => Effect.void,
      });
      const scope = yield* Scope.make();
      const events = yield* makeBrowserSidebarEventHub.pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const browser = new BrowserSidebarService({ events });
      yield* Layer.buildWithScope(
        live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                BrowserSidebarRuntime,
                BrowserSidebarRuntime.of({
                  browser,
                  events,
                  history: {} as never,
                  localServers: { updates: Stream.empty } as never,
                  localServerThumbnail: {} as never,
                  pages: {} as never,
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
        "browser-annotation-capture-evidence",
        "browser-browsing-data-clear",
        "browser-history-delete",
        "browser-history-list",
        "browser-local-server-thumbnail",
        "browser-sidebar-command",
        "browser-sidebar-runtime-snapshot",
        "browser-sidebar-webview-destroyed",
        "browser-sidebar-webview-host-created",
      ]);
      yield* Scope.close(scope, Exit.void);
      assert.strictEqual(handlers.size, 0);
    }),
);
