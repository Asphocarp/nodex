import { assert, it } from "@effect/vitest";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { CodexApplicationRequestGenerationUnavailable, make } from "./CodexApplicationRequestInbox";

it.effect("keeps exact request occurrences lossless and settles each at most once", () =>
  Effect.gen(function* () {
    const rootScope = yield* Scope.make();
    const generationScope = yield* Scope.make();
    const inbox = yield* make.pipe(Effect.provideService(Scope.Scope, rootScope));
    const generation = yield* inbox
      .openGeneration("local", 1)
      .pipe(Effect.provideService(Scope.Scope, generationScope));

    const first = yield* generation.admit({ requestId: 7, method: "approval", params: { n: 1 } });
    const second = yield* generation.admit({ requestId: 7, method: "approval", params: { n: 2 } });
    const admitted = yield* inbox.requests.pipe(Stream.take(2), Stream.runCollect);

    assert.deepEqual([...admitted], [first, second]);
    assert.notStrictEqual(first.occurrenceToken, second.occurrenceToken);
    assert.isTrue(yield* inbox.settle(second, { kind: "result", value: "second" }));
    assert.isTrue(yield* inbox.settle(first, { kind: "result", value: "first" }));
    assert.isFalse(yield* inbox.settle(first, { kind: "result", value: "duplicate" }));

    const settled = yield* generation.settlements.pipe(Stream.take(2), Stream.runCollect);
    assert.deepEqual(
      [...settled].map(({ occurrence, outcome }) => ({
        token: occurrence.occurrenceToken,
        outcome,
      })),
      [
        { token: second.occurrenceToken, outcome: { kind: "result", value: "second" } },
        { token: first.occurrenceToken, outcome: { kind: "result", value: "first" } },
      ],
    );

    yield* Scope.close(generationScope, Exit.void);
    yield* Scope.close(rootScope, Exit.void);
  }),
);

it.effect("fences stale generation leases and rejects all live occurrences explicitly", () =>
  Effect.gen(function* () {
    const rootScope = yield* Scope.make();
    const firstScope = yield* Scope.make();
    const inbox = yield* make.pipe(Effect.provideService(Scope.Scope, rootScope));
    const first = yield* inbox
      .openGeneration("remote:a", 4)
      .pipe(Effect.provideService(Scope.Scope, firstScope));
    const outstanding = yield* first.admit({ requestId: "same", method: "user-input", params: {} });
    const closing = CodexAppServerRequestError.internalError("Endpoint generation is closing");

    assert.strictEqual(yield* first.rejectOutstanding(closing), 1);
    assert.isFalse(yield* inbox.settle(outstanding, { kind: "abandon" }));
    const rejection = yield* first.settlements.pipe(Stream.runHead);
    assert.strictEqual(rejection._tag, "Some");
    if (rejection._tag === "Some") assert.strictEqual(rejection.value.outcome.kind, "error");

    yield* Scope.close(firstScope, Exit.void);
    const staleExit = yield* first
      .admit({ requestId: "late", method: "approval", params: {} })
      .pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(staleExit));
    if (Exit.isFailure(staleExit)) {
      assert.strictEqual(
        (Cause.squash(staleExit.cause) as CodexApplicationRequestGenerationUnavailable).reason,
        "closed",
      );
    }

    const replacementScope = yield* Scope.make();
    const replacement = yield* inbox
      .openGeneration("remote:a", 4)
      .pipe(Effect.provideService(Scope.Scope, replacementScope));
    const current = yield* replacement.admit({
      requestId: "same",
      method: "user-input",
      params: {},
    });
    assert.isTrue(current.occurrenceToken > outstanding.occurrenceToken);

    yield* Scope.close(replacementScope, Exit.void);
    yield* Scope.close(rootScope, Exit.void);
  }),
);

it.effect("withdraws queued and in-flight interpretation when its Endpoint generation closes", () =>
  Effect.gen(function* () {
    const rootScope = yield* Scope.make();
    const generationScope = yield* Scope.make();
    const inbox = yield* make.pipe(Effect.provideService(Scope.Scope, rootScope));
    const generation = yield* inbox
      .openGeneration("remote:a", 9)
      .pipe(Effect.provideService(Scope.Scope, generationScope));
    const inFlight = yield* generation.admit({
      requestId: "in-flight",
      method: "approval",
      params: {},
    });
    const queued = yield* generation.admit({
      requestId: "queued",
      method: "user-input",
      params: {},
    });
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const interpretationFiber = yield* inbox
      .interpret(
        inFlight,
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(interrupted, undefined)),
        ),
      )
      .pipe(Effect.forkIn(rootScope, { startImmediately: true }));
    yield* Deferred.await(started);

    yield* Scope.close(generationScope, Exit.void);
    assert.deepEqual(yield* Fiber.join(interpretationFiber), { kind: "withdrawn" });
    yield* Deferred.await(interrupted);

    let lateInterpretationRan = false;
    assert.deepEqual(
      yield* inbox.interpret(
        queued,
        Effect.sync(() => {
          lateInterpretationRan = true;
        }),
      ),
      { kind: "withdrawn" },
    );
    assert.isFalse(lateInterpretationRan);
    assert.isFalse(yield* inbox.settle(queued, { kind: "result", value: "stale" }));
    yield* Scope.close(rootScope, Exit.void);
  }),
);
