import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import type { CodexService } from "../../codex/codex-service";
import { HostWorkerRuntime } from "../../host-runtime/HostWorkerRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./GitApplicationIpc";

it.effect("owns Git and GitHub ingress with the Main Scope", () =>
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
      live({ codex: {} as CodexService }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            Layer.succeed(HostWorkerRuntime, {
              git: {},
            } as unknown as HostWorkerRuntime["Service"]),
            Layer.succeed(WindowRuntime, {
              has: () => true,
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.strictEqual(channels.size, 15);
    assert.isTrue(channels.has("git:action:commit"));
    assert.isTrue(channels.has("gh-pr-diff"));
    assert.isTrue(channels.has("gh-pr-create"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
