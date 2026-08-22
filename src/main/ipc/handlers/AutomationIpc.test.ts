import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import type { CodexService } from "../../codex/codex-service";
import type { RendererClientRuntimeService } from "../../codex/renderer-client-runtime-contracts";
import type { DesktopAutomationModulePort } from "../../core-client/desktop-automation-module-bridge";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./AutomationIpc";

it.effect("owns calendar and scheduled automation ingress with the Main Scope", () =>
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
        automation: {} as DesktopAutomationModulePort,
        codex: {} as CodexService,
        conversationCommands: {
          unarchive: () => Promise.reject(new Error("unused")),
        },
        rendererClients: {} as RendererClientRuntimeService,
        onHeartbeatAutomationsEnabledChanged: () => undefined,
        onHeartbeatAutomationThreadStateChanged: () => undefined,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            Layer.succeed(WindowRuntime, {
              has: () => true,
              all: () => [],
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.strictEqual(channels.size, 17);
    assert.isTrue(channels.has("calendar:occurrences"));
    assert.isTrue(channels.has("codex:scheduled-automations:run-now"));
    assert.isTrue(channels.has("codex:automation-runs:mark-all-read"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
