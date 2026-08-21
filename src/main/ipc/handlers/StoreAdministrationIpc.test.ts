import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import type { DesktopStoreAdministrationPort } from "../../core-client/desktop-store-administration-bridge";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./StoreAdministrationIpc";

it.effect("owns Store administration ingress with the Main Scope", () =>
  Effect.gen(function* () {
    const channels = new Set<string>();
    const ipc = ElectronIpc.of({
      handle: (channel: string) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            channels.add(channel);
          }),
          () => Effect.sync(() => channels.delete(channel)),
        ),
      on: () => Effect.die("unused"),
    } as unknown as ElectronIpc["Service"]);
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        administration: {} as DesktopStoreAdministrationPort,
        onStoreRestored: Effect.void,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            Layer.succeed(WindowRuntime, {
              has: () => true,
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.deepStrictEqual([...channels].sort(), [
      "backup:create",
      "backup:delete",
      "backup:list",
      "backup:restore",
    ]);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
