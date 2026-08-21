import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import type { CodexService } from "../../codex/codex-service";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./CodexPendingWorktreeIpc";

it.effect("owns pending worktree ingress with the Main Scope", () =>
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
            Layer.succeed(WindowRuntime, {
              has: () => true,
              resolveSessionId: () => "window-session",
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.strictEqual(channels.size, 15);
    assert.isTrue(channels.has("codex:pending-worktrees:list"));
    assert.isTrue(channels.has("codex:pending-worktree:resolve-thread"));
    assert.isTrue(channels.has("codex:fork-side-panel-transfer:consume"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
