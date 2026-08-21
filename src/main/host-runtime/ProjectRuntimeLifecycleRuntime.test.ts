import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import {
  live as projectRuntimeLifecycleLive,
  ProjectRuntimeLifecycleRuntime,
} from "./ProjectRuntimeLifecycleRuntime";

it.effect("serializes work for one Project without blocking another Project", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(projectRuntimeLifecycleLive, scope);
    const lifecycle = Context.get(context, ProjectRuntimeLifecycleRuntime);
    const firstEntered = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const secondEntered = yield* Deferred.make<void>();
    const otherEntered = yield* Deferred.make<void>();

    const first = yield* lifecycle
      .runExclusive(
        "project-1",
        Deferred.succeed(firstEntered, undefined).pipe(
          Effect.andThen(Deferred.await(releaseFirst)),
        ),
      )
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(firstEntered);
    const second = yield* lifecycle
      .runExclusive("project-1", Deferred.succeed(secondEntered, undefined))
      .pipe(Effect.forkChild({ startImmediately: true }));
    const other = yield* lifecycle
      .runExclusive("project-2", Deferred.succeed(otherEntered, undefined))
      .pipe(Effect.forkChild({ startImmediately: true }));

    yield* Deferred.await(otherEntered);
    assert.isFalse(yield* Deferred.isDone(secondEntered));
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Effect.all([Fiber.join(first), Fiber.join(second), Fiber.join(other)]);
    assert.isTrue(yield* Deferred.isDone(secondEntered));

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts admitted work when the owning Main Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(projectRuntimeLifecycleLive, scope);
    const lifecycle = Context.get(context, ProjectRuntimeLifecycleRuntime);
    const entered = yield* Deferred.make<void>();
    const operation = yield* lifecycle
      .runExclusive(
        "project-1",
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
      )
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(entered);

    yield* Scope.close(scope, Exit.void);
    const result = yield* Fiber.await(operation);
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") assert.isTrue(Cause.hasInterruptsOnly(result.cause));
  }),
);

it.effect("allows only the owning fiber to re-enter one Project transaction", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(projectRuntimeLifecycleLive, scope);
    const lifecycle = Context.get(context, ProjectRuntimeLifecycleRuntime);
    const childEntered = yield* Deferred.make<void>();
    const releaseOuter = yield* Deferred.make<void>();

    const outer = yield* lifecycle
      .runExclusive(
        "project-1",
        lifecycle.runExclusive("project-1", Effect.succeed("nested")).pipe(
          Effect.tap((value) => Effect.sync(() => assert.strictEqual(value, "nested"))),
          Effect.tap(() =>
            lifecycle
              .runExclusive("project-1", Deferred.succeed(childEntered, undefined))
              .pipe(Effect.forkIn(scope, { startImmediately: true })),
          ),
          Effect.andThen(Deferred.await(releaseOuter)),
        ),
      )
      .pipe(Effect.forkChild({ startImmediately: true }));

    yield* Effect.yieldNow;
    assert.isFalse(yield* Deferred.isDone(childEntered));
    yield* Deferred.succeed(releaseOuter, undefined);
    yield* Fiber.join(outer);
    yield* Deferred.await(childEntered);

    yield* Scope.close(scope, Exit.void);
  }),
);
