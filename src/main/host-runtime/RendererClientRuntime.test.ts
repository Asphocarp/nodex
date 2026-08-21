import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { RendererClientRouter } from "../codex/renderer-client-router";
import { fromRouter, RendererClientRuntime } from "./RendererClientRuntime";

it.effect("releases renderer registrations and pending requests with the Main Scope", () =>
  Effect.gen(function* () {
    let destroyedListener: (() => void) | null = null;
    const router = new RendererClientRouter({
      clientIdFactory: () => "renderer:test",
      requestIdFactory: () => "request:test",
      send: () => true,
    });
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(fromRouter(router), scope);
    const runtime = Context.get(context, RendererClientRuntime);
    runtime.router.register({
      id: 42,
      isDestroyed: () => false,
      once: (_event, listener) => {
        destroyedListener = listener;
      },
      off: () => {
        destroyedListener = null;
      },
      send: () => undefined,
    });
    const pending = runtime.router.sendRequest("renderer:test", "snapshot", {});
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(runtime.router.getClientCount(), 0);
    assert.strictEqual(runtime.router.getPendingRequestCount(), 0);
    assert.isNull(destroyedListener);
    const error = yield* Effect.promise(() => outcome);
    assert.match(String(error), /disposed/);
  }),
);
