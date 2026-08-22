import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { CodexUserInputAutoResolution } from "../../codex-application/CodexUserInputAutoResolution";
import type { CodexService } from "../../codex/codex-service";
import type { RendererClientRouter } from "../../codex/renderer-client-router";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./CodexRendererIpc";

it.effect("owns renderer coordination ingress with the Main Scope", () =>
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
        codex: {} as CodexService,
        rendererClients: {} as RendererClientRouter,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            Layer.succeed(CodexUserInputAutoResolution, {
              changes: Stream.empty,
              snapshot: Effect.succeed([]),
            } as unknown as CodexUserInputAutoResolution["Service"]),
            mainConfigLayer(),
            Layer.succeed(WindowRuntime, {
              has: () => true,
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.strictEqual(channels.size, 13);
    assert.isTrue(channels.has("codex:renderer-client:id"));
    assert.isTrue(channels.has("codex:thread-owner:app-server-request"));
    assert.isTrue(channels.has("codex:dynamic-tool-call:respond"));
    assert.isTrue(channels.has("codex:user-input:auto-resolution:snapshot"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
