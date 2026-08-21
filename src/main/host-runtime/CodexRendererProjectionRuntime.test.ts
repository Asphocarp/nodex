import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { EventEmitter } from "node:events";
import { assert, it } from "@effect/vitest";
import type { CodexService } from "../codex/codex-service";
import type { RendererClientRouter } from "../codex/renderer-client-router";
import { live } from "./CodexRendererProjectionRuntime";

it.effect("releases Codex projection and renderer-client subscriptions with the Main Scope", () =>
  Effect.gen(function* () {
    const codex = new EventEmitter() as CodexService;
    let clientSubscriptionCount = 0;
    const rendererClients = {
      addClientConnectedListener: () => {
        clientSubscriptionCount += 1;
        return () => {
          clientSubscriptionCount -= 1;
        };
      },
      addClientDisposedListener: () => {
        clientSubscriptionCount += 1;
        return () => {
          clientSubscriptionCount -= 1;
        };
      },
    } as unknown as RendererClientRouter;
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live({
        codex,
        rendererClients,
        windows: { all: () => [] } as never,
      }),
      scope,
    );

    assert.strictEqual(codex.eventNames().length, 9);
    assert.strictEqual(clientSubscriptionCount, 2);
    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(codex.eventNames().length, 0);
    assert.strictEqual(clientSubscriptionCount, 0);
  }),
);
