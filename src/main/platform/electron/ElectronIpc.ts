import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";

export class ElectronIpc extends Context.Service<
  ElectronIpc,
  {
    readonly handle: <A, Args extends readonly unknown[]>(
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: Args) => Effect.Effect<A, unknown>,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly on: <Args extends readonly unknown[]>(
      channel: string,
      handler: (event: IpcMainEvent, ...args: Args) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("nodex/main/platform/electron/ElectronIpc") {}

export const live: Layer.Layer<ElectronIpc, never, ScopedCallbackRuntime> = Layer.effect(
  ElectronIpc,
  Effect.gen(function* () {
    const callbacks = yield* ScopedCallbackRuntime;
    return ElectronIpc.of({
      handle: (channel, handler) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            ipcMain.handle(channel, (event, ...args) => {
              const task = Reflect.apply(handler, undefined, [event, ...args]) as Effect.Effect<
                unknown,
                unknown
              >;
              return callbacks.runPromise(task);
            });
          }),
          () => Effect.sync(() => ipcMain.removeHandler(channel)),
        ),
      on: (channel, handler) => {
        const listener = (event: IpcMainEvent, ...args: unknown[]) => {
          const task = Reflect.apply(handler, undefined, [event, ...args]) as Effect.Effect<void>;
          callbacks.fork(task);
        };
        return Effect.acquireRelease(
          Effect.sync(() => ipcMain.on(channel, listener)),
          () => Effect.sync(() => ipcMain.removeListener(channel, listener)),
        );
      },
    });
  }),
);
