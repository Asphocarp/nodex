import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { IpcMainInvokeEvent } from "electron";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";
import type { FileWatchHost } from "../../file-watch-host";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./WorkspaceFileIpc";

type Handler = (event: IpcMainInvokeEvent, ...args: readonly unknown[]) => Effect.Effect<unknown>;

it.effect("releases active file watches and renderer listeners with the Main Scope", () =>
  Effect.gen(function* () {
    const handlers = new Map<string, Handler>();
    const ipc = ElectronIpc.of({
      handle: (channel: string, handler: Handler) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            handlers.set(channel, handler);
          }),
          () => Effect.sync(() => handlers.delete(channel)),
        ),
      on: () => Effect.die("unused"),
    } as unknown as ElectronIpc["Service"]);
    let disposeCount = 0;
    const fileWatchHost: FileWatchHost = {
      startFileWatch: async (input) => ({
        coverage: { recursive: input.recursive, typedPathChanges: false },
        path: input.path,
        closed: new Promise(() => undefined),
        dispose: async () => {
          disposeCount += 1;
        },
      }),
    };
    const listeners = new Map<string, () => void>();
    const sender = {
      id: 77,
      isDestroyed: () => false,
      once: (event: string, listener: () => void) => {
        listeners.set(event, listener);
      },
      removeListener: (event: string, listener: () => void) => {
        if (listeners.get(event) === listener) listeners.delete(event);
      },
    };
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        authorizeSender: () => true,
        fileWatchHost,
        makeSubscriptionId: () => "128cc777-30ab-4c91-8857-a2083e8349f1",
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            Layer.succeed(
              ScopedCallbackRuntime,
              ScopedCallbackRuntime.of({
                fork: () => null,
                runPromise: () => Promise.reject(new Error("unused")),
              }),
            ),
            Layer.succeed(WindowRuntime, {
              has: () => true,
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );
    assert.strictEqual(handlers.size, 8);

    const start = handlers.get("workspace-file-watch:start");
    assert.isDefined(start);
    assert.deepStrictEqual(
      yield* start({ sender } as unknown as IpcMainInvokeEvent, { path: "/tmp/nodex-file" }),
      { subscriptionId: "128cc777-30ab-4c91-8857-a2083e8349f1" },
    );
    assert.isTrue(listeners.has("destroyed"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(disposeCount, 1);
    assert.strictEqual(listeners.size, 0);
    assert.strictEqual(handlers.size, 0);
  }),
);
