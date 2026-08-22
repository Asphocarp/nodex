import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import {
  CodexConversationHistoryError,
  make,
  type CodexConversationHistoryRuntimeOptions,
} from "./CodexConversationHistoryRuntime";

const options = (
  overrides: Partial<CodexConversationHistoryRuntimeOptions> = {},
): CodexConversationHistoryRuntimeOptions => ({
  shouldLoadRemaining: () => true,
  load: () => Effect.void,
  ...overrides,
});

it.effect("shares one physical history load for concurrent callers", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let loads = 0;
    const runtime = yield* make(
      options({
        load: () =>
          Effect.sync(() => {
            loads += 1;
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
      }),
    );
    const first = yield* Effect.forkChild(runtime.loadPage("thread-1"));
    yield* Deferred.await(started);
    const second = yield* Effect.forkChild(runtime.loadPage("thread-1"));
    yield* Effect.yieldNow;
    assert.strictEqual(loads, 1);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
  }),
);

it.effect("escalates a joined page load to complete history after the page settles", () =>
  Effect.gen(function* () {
    const pageStarted = yield* Deferred.make<void>();
    const releasePage = yield* Deferred.make<void>();
    const modes: boolean[] = [];
    const runtime = yield* make(
      options({
        load: ({ loadCompleteHistory }) =>
          Effect.sync(() => {
            modes.push(loadCompleteHistory);
          }).pipe(
            Effect.andThen(
              loadCompleteHistory
                ? Effect.void
                : Deferred.succeed(pageStarted, undefined).pipe(
                    Effect.andThen(Deferred.await(releasePage)),
                  ),
            ),
          ),
      }),
    );
    const page = yield* Effect.forkChild(runtime.loadPage("thread-1"));
    yield* Deferred.await(pageStarted);
    const complete = yield* Effect.forkChild(runtime.loadComplete("thread-1", false));
    yield* Effect.yieldNow;
    assert.deepEqual(modes, [false]);
    yield* Deferred.succeed(releasePage, undefined);
    yield* Fiber.join(page);
    yield* Fiber.join(complete);
    assert.deepEqual(modes, [false, true]);
  }),
);

it.effect("caller interruption stops waiting without cancelling the shared physical load", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let physicalInterrupted = false;
    const runtime = yield* make(
      options({
        load: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                physicalInterrupted = true;
              }),
            ),
          ),
      }),
    );
    const caller = yield* Effect.forkChild(runtime.loadPage("thread-1"));
    yield* Deferred.await(started);
    yield* Fiber.interrupt(caller);
    assert.isFalse(physicalInterrupted);
    const joining = yield* Effect.forkChild(runtime.loadPage("thread-1"));
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(joining);
  }),
);

it.effect("background remaining-history requests are supervised and Scope-owned", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let attempts = 0;
    const runtime = yield* make(
      options({
        load: () =>
          Effect.sync(() => {
            attempts += 1;
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
      }),
    ).pipe(Effect.provideService(Scope.Scope, ownerScope));
    runtime.requestRemaining("thread-1");
    yield* Deferred.await(started);
    assert.strictEqual(attempts, 1);
    yield* Scope.close(ownerScope, Exit.void);
    yield* Deferred.await(interrupted);
  }),
);

it.effect("surfaces explicit history failures without poisoning the next load", () =>
  Effect.gen(function* () {
    let shouldFail = true;
    const runtime = yield* make(
      options({
        load: () =>
          shouldFail
            ? Effect.fail(new CodexConversationHistoryError({ cause: new Error("load failed") }))
            : Effect.void,
      }),
    );
    yield* runtime.loadPage("thread-1").pipe(Effect.flip);
    shouldFail = false;
    yield* runtime.loadPage("thread-1");
  }),
);
