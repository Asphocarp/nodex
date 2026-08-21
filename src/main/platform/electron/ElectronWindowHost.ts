import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { app, BrowserWindow, type Event, type WebContents } from "electron";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";

export class ElectronWindowHost extends Context.Service<
  ElectronWindowHost,
  {
    readonly all: Effect.Effect<readonly BrowserWindow[]>;
    readonly destroyAll: Effect.Effect<void>;
    readonly fromWebContents: (webContents: WebContents) => Effect.Effect<BrowserWindow | null>;
    readonly onCreated: (
      handler: (window: BrowserWindow) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("nodex/main/platform/electron/ElectronWindowHost") {}

export const live: Layer.Layer<ElectronWindowHost, never, ScopedCallbackRuntime> = Layer.effect(
  ElectronWindowHost,
  Effect.gen(function* () {
    const callbacks = yield* ScopedCallbackRuntime;
    return ElectronWindowHost.of({
      all: Effect.sync(() => BrowserWindow.getAllWindows()),
      destroyAll: Effect.sync(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.destroy();
        }
      }),
      fromWebContents: (webContents) =>
        Effect.sync(() => BrowserWindow.fromWebContents(webContents)),
      onCreated: (handler) => {
        const listener = (_event: Event, window: BrowserWindow) => {
          callbacks.fork(handler(window));
        };
        return Effect.acquireRelease(
          Effect.sync(() => app.on("browser-window-created", listener)),
          () => Effect.sync(() => app.removeListener("browser-window-created", listener)),
        );
      },
    });
  }),
);
