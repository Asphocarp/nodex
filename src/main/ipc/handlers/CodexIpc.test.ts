import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { layer as scopedCallbackRuntimeLive } from "../../app/ScopedCallbackRuntime";
import { CodexManualCompactionRuntime } from "../../codex-application/CodexManualCompactionRuntime";
import type { CodexService } from "../../codex/codex-service";
import type { RendererClientRuntimeService } from "../../codex/renderer-client-runtime-contracts";
import type { DesktopProjectWorkspacePort } from "../../core-client/project-workspace-adapter";
import { codexIpcLive } from "../../ipc-handlers";
import { live as projectRuntimeLifecycleLive } from "../../host-runtime/ProjectRuntimeLifecycleRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

it.effect("owns the remaining Codex application ingress with the Main Scope", () =>
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
      codexIpcLive({
        codexService: {} as CodexService,
        manualCompaction: CodexManualCompactionRuntime.of({
          start: () => Effect.void,
          consumeSource: () => "automatic",
          clear: () => undefined,
        }),
        projectWorkspace: {} as DesktopProjectWorkspacePort,
        rendererClientRouter: {} as RendererClientRuntimeService,
        terminalRuntime: { runAction: () => Promise.resolve() },
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            projectRuntimeLifecycleLive,
            scopedCallbackRuntimeLive,
            Layer.succeed(WindowRuntime, {
              has: () => true,
              resolveSessionId: () => "window-session",
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.isTrue(channels.has("codex:threads:list"));
    assert.isTrue(channels.has("codex:turn:start"));
    assert.isFalse(channels.has("codex:permission:custom-description:get"));
    assert.isFalse(channels.has("worktrees:execution-hosts:update"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
