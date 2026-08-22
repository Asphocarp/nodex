import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import {
  CodexThreadTitlePersistenceEffectError,
  make,
  type CodexThreadTitlePersistenceOptions,
} from "./CodexThreadTitlePersistence";

const failure = (message: string) =>
  new CodexThreadTitlePersistenceEffectError({ cause: new Error(message) });

const options = (
  overrides: Partial<CodexThreadTitlePersistenceOptions> = {},
): CodexThreadTitlePersistenceOptions => ({
  setRemote: () => Effect.void,
  persistWorkspace: () => Effect.void,
  ...overrides,
});

it.effect("persists Thread titles FIFO per Thread", () =>
  Effect.gen(function* () {
    const firstRemote = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const calls: string[] = [];
    const persistence = yield* make(
      options({
        setRemote: ({ name }) =>
          Effect.sync(() => void calls.push(`remote:${name}`)).pipe(
            Effect.andThen(
              name === "first" ? Deferred.succeed(firstRemote, undefined) : Effect.void,
            ),
            Effect.andThen(name === "first" ? Deferred.await(releaseFirst) : Effect.void),
          ),
        persistWorkspace: ({ name }) => Effect.sync(() => void calls.push(`workspace:${name}`)),
      }),
    );
    const first = yield* Effect.forkChild(
      persistence.persistRequired({ threadId: "thread-1", name: "first" }),
    );
    yield* Deferred.await(firstRemote);
    const second = yield* Effect.forkChild(
      persistence.persistRequired({ threadId: "thread-1", name: "second" }),
    );
    yield* Effect.yieldNow;
    assert.deepEqual(calls, ["remote:first"]);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    assert.deepEqual(calls, [
      "remote:first",
      "workspace:first",
      "remote:second",
      "workspace:second",
    ]);
  }),
);

it.effect("allows unrelated Thread titles to persist independently", () =>
  Effect.gen(function* () {
    const releaseFirst = yield* Deferred.make<void>();
    const persistence = yield* make(
      options({
        setRemote: ({ threadId }) =>
          threadId === "thread-1" ? Deferred.await(releaseFirst) : Effect.void,
      }),
    );
    const first = yield* Effect.forkChild(
      persistence.persistRequired({ threadId: "thread-1", name: "first" }),
    );
    yield* Effect.yieldNow;
    yield* persistence.persistRequired({ threadId: "thread-2", name: "second" });
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
  }),
);

it.effect("isolates both best-effort failures and still reaches Project Workspace", () =>
  Effect.gen(function* () {
    let workspaceAttempts = 0;
    const persistence = yield* make(
      options({
        setRemote: () => Effect.fail(failure("remote failed")),
        persistWorkspace: () =>
          Effect.sync(() => {
            workspaceAttempts += 1;
          }).pipe(Effect.andThen(Effect.fail(failure("workspace failed")))),
      }),
    );
    yield* persistence.persistBestEffort({ threadId: "thread-1", name: "title" });
    assert.strictEqual(workspaceAttempts, 1);
  }),
);

it.effect("surfaces required persistence failure and releases the Thread lane", () =>
  Effect.gen(function* () {
    let failRemote = true;
    const persistence = yield* make(
      options({
        setRemote: () => (failRemote ? Effect.fail(failure("required failed")) : Effect.void),
      }),
    );
    const error = yield* persistence
      .persistRequired({ threadId: "thread-1", name: "first" })
      .pipe(Effect.flip);
    assert.instanceOf(error.cause, Error);
    failRemote = false;
    yield* persistence.persistRequired({ threadId: "thread-1", name: "second" });
  }),
);

it.effect("interrupts active title persistence when its Main Scope closes", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const persistence = yield* make(
      options({
        setRemote: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
      }),
    ).pipe(Effect.provideService(Scope.Scope, ownerScope));
    const caller = yield* Effect.forkChild(
      persistence.persistRequired({ threadId: "thread-1", name: "title" }),
    );
    yield* Deferred.await(started);
    yield* Scope.close(ownerScope, Exit.void);
    yield* Deferred.await(interrupted);
    const callerExit = yield* Fiber.await(caller);
    assert.isTrue(Exit.isFailure(callerExit));
    if (Exit.isFailure(callerExit)) {
      assert.isTrue(Cause.hasInterruptsOnly(callerExit.cause));
    }
  }),
);
