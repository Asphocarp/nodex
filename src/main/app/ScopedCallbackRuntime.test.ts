import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { CallbackRuntimeClosedError, ScopedCallbackRuntime, layer } from "./ScopedCallbackRuntime";

it.effect("interrupts admitted callback fibers before rejecting new admission", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(layer, scope);
    const runtime = context.pipe((services) => Context.get(services, ScopedCallbackRuntime));
    const interrupted = yield* Deferred.make<void>();

    const fiber = runtime.fork(
      Effect.never.pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
    );
    assert.isNotNull(fiber);
    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    assert.isNull(runtime.fork(Effect.void));
    const rejectedAsClosed = yield* Effect.promise(() =>
      runtime.runPromise(Effect.void).then(() => false, Schema.is(CallbackRuntimeClosedError)),
    );
    assert.isTrue(rejectedAsClosed);
  }),
);
