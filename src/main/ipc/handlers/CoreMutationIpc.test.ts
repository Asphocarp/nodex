import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { layer as scopedCallbackRuntimeLayer } from "../../app/ScopedCallbackRuntime";
import type {
  DesktopDatabaseModuleBridge,
  DesktopDocumentSessionService,
  DesktopLibraryModuleBridge,
} from "../../core-client";
import type { RendererClientRuntimeService } from "../../codex/renderer-client-runtime-contracts";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { live } from "./CoreMutationIpc";

it.effect("owns Core mutation and history ingress with the Main Scope", () =>
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
        database: {} as DesktopDatabaseModuleBridge,
        documents: {} as DesktopDocumentSessionService,
        library: {} as DesktopLibraryModuleBridge,
        rendererClients: {} as RendererClientRuntimeService,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            scopedCallbackRuntimeLayer,
            Layer.succeed(WindowRuntime, {
              has: () => true,
            } as unknown as WindowRuntime["Service"]),
          ),
        ),
      ),
      scope,
    );

    assert.strictEqual(channels.size, 21);
    assert.isTrue(channels.has("block-properties:mutate"));
    assert.isTrue(channels.has("database-module:apply"));
    assert.isTrue(channels.has("block-documents:history:restore"));
    assert.isTrue(channels.has("pages:history:list"));

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(channels.size, 0);
  }),
);
