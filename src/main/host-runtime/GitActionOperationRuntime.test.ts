import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { GitActionOperationRuntime, live } from "./GitActionOperationRuntime";

const buildRuntime = (scope: Scope.Closeable) =>
  Layer.buildWithScope(live, scope).pipe(
    Effect.map((context) => Context.get(context, GitActionOperationRuntime)),
  );

it.effect("cancels a named child while preserving its domain result", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* buildRuntime(scope);
    const started = yield* Deferred.make<void>();
    let interrupted = 0;
    const operation = yield* Effect.forkChild(
      runtime.run(
        "commit-1",
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted += 1;
            }),
          ),
        ),
        () => "canceled" as const,
      ),
    );
    yield* Deferred.await(started);

    assert.deepStrictEqual(yield* runtime.cancel({ operationId: "commit-1" }), {
      canceled: true,
    });
    assert.strictEqual(yield* Fiber.join(operation), "canceled");
    assert.strictEqual(interrupted, 1);
    assert.deepStrictEqual(yield* runtime.cancel({ operationId: "commit-1" }), {
      canceled: false,
    });
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("replaces the exact named operation without coupling unrelated work", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* buildRuntime(scope);
    const firstStarted = yield* Deferred.make<void>();
    const unrelatedStarted = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(
      runtime.run(
        "same",
        Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never)),
        () => "first-canceled" as const,
      ),
    );
    const unrelated = yield* Effect.forkChild(
      runtime.run(
        "other",
        Deferred.succeed(unrelatedStarted, undefined).pipe(Effect.andThen(Effect.never)),
        () => "other-canceled" as const,
      ),
    );
    yield* Effect.all([Deferred.await(firstStarted), Deferred.await(unrelatedStarted)]);

    const replacement = yield* runtime.run(
      "same",
      Effect.succeed("replacement" as const),
      () => "replacement-canceled" as const,
    );
    assert.strictEqual(replacement, "replacement");
    assert.strictEqual(yield* Fiber.join(first), "first-canceled");
    assert.deepStrictEqual(yield* runtime.cancel({ operationId: "other" }), { canceled: true });
    assert.strictEqual(yield* Fiber.join(unrelated), "other-canceled");
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts all children and rejects new admission when its Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* buildRuntime(scope);
    const started = yield* Deferred.make<void>();
    const pending = yield* Effect.forkChild(
      runtime.run(
        undefined,
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        () => "closed" as const,
      ),
    );
    yield* Deferred.await(started);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(yield* Fiber.join(pending), "closed");
    const afterClose = yield* Effect.result(
      runtime.run("late", Effect.succeed("unexpected"), () => "canceled"),
    );
    assert.strictEqual(afterClose._tag, "Failure");
  }),
);
