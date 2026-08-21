import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { ApplicationInitializationRuntime } from "../../host-runtime/ApplicationInitializationRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./ApplicationLifecycleIpc";

it.effect("owns all application lifecycle handlers with the Main Scope", () =>
  Effect.gen(function* () {
    const channels = new Set<string>();
    const register = (channel: string) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          channels.add(channel);
        }),
        () => Effect.sync(() => channels.delete(channel)),
      );
    const ipc = ElectronIpc.of({
      handle: (channel: string) => register(channel),
      on: (channel: string) => register(channel),
    } as unknown as ElectronIpc["Service"]);
    const windows = { has: () => true } as unknown as WindowRuntime["Service"];
    const initialization = ApplicationInitializationRuntime.of({
      current: Effect.succeed({ phase: "done" }),
      reportRenderer: () => Effect.void,
    } as unknown as ApplicationInitializationRuntime["Service"]);
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        acknowledgeWindowClose: () => undefined,
        awaitInitialization: async () => undefined,
        requestMicrophonePermission: async () => undefined,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ApplicationInitializationRuntime, initialization),
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            Layer.succeed(WindowRuntime, windows),
          ),
        ),
      ),
      scope,
    );
    assert.strictEqual(channels.size, 4);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
