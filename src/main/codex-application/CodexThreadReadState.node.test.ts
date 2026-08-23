import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import {
  CodexThreadReadStateError,
  type CodexThreadReadStateSnapshot,
  make,
} from "./CodexThreadReadState";

const current = (
  overrides: Partial<CodexThreadReadStateSnapshot> = {},
): CodexThreadReadStateSnapshot => ({
  exists: true,
  archived: false,
  conversationHasUnreadTurn: true,
  workspaceHasUnreadTurn: true,
  ...overrides,
});

it.effect("commits manual read-state changes durable-first", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    let snapshot = current();
    const scope = yield* Scope.make();
    const readState = yield* make({
      inspect: () => Effect.succeed(snapshot),
      persist: (input) =>
        Effect.sync(() => {
          calls.push(`persist:${input.hasUnreadTurn}`);
          snapshot = current({
            conversationHasUnreadTurn: snapshot.conversationHasUnreadTurn,
            workspaceHasUnreadTurn: input.hasUnreadTurn,
          });
          return true;
        }),
      project: (input) =>
        Effect.sync(() => {
          calls.push(`project:${input.hasUnreadTurn}`);
          snapshot = current({
            conversationHasUnreadTurn: input.hasUnreadTurn,
            workspaceHasUnreadTurn: input.hasUnreadTurn,
          });
        }),
    }).pipe(Effect.provideService(Scope.Scope, scope));

    assert.isTrue(yield* readState.set({ threadId: " thread-a ", hasUnreadTurn: false }));
    assert.deepEqual(calls, ["persist:false", "project:false"]);
    assert.isFalse(yield* readState.set({ threadId: "thread-a", hasUnreadTurn: false }));
    snapshot = current({
      conversationHasUnreadTurn: null,
      workspaceHasUnreadTurn: false,
    });
    assert.isFalse(yield* readState.set({ threadId: "thread-a", hasUnreadTurn: false }));
    assert.isFalse(yield* readState.set({ threadId: " ", hasUnreadTurn: true }));
    snapshot = current({ archived: true, conversationHasUnreadTurn: false });
    assert.isFalse(yield* readState.set({ threadId: "thread-a", hasUnreadTurn: true }));
    snapshot = current({ exists: false });
    assert.isFalse(yield* readState.set({ threadId: "thread-a", hasUnreadTurn: false }));

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("serializes reducer persistence and manual transitions per Thread", () =>
  Effect.gen(function* () {
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const calls: string[] = [];
    const scope = yield* Scope.make();
    const readState = yield* make({
      inspect: () => Effect.succeed(current({ conversationHasUnreadTurn: true })),
      persist: (input) =>
        Effect.gen(function* () {
          calls.push(`start:${input.hasUnreadTurn}`);
          if (input.hasUnreadTurn) {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(releaseFirst);
          }
          calls.push(`finish:${input.hasUnreadTurn}`);
          return true;
        }),
      project: (input) => Effect.sync(() => void calls.push(`project:${input.hasUnreadTurn}`)),
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const reducerWrite = yield* Effect.forkChild(
      readState.persistProjected({ threadId: "thread-a", hasUnreadTurn: true }),
    );
    yield* Deferred.await(firstStarted);
    const manualWrite = yield* Effect.forkChild(
      readState.set({ threadId: "thread-a", hasUnreadTurn: false }),
    );
    yield* Effect.yieldNow;
    assert.deepEqual(calls, ["start:true"]);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(reducerWrite);
    assert.isTrue(yield* Fiber.join(manualWrite));
    assert.deepEqual(calls, [
      "start:true",
      "finish:true",
      "project:true",
      "start:false",
      "finish:false",
      "project:false",
    ]);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("reconciles a reducer transition that arrives during a manual physical write", () =>
  Effect.gen(function* () {
    const manualStarted = yield* Deferred.make<void>();
    const releaseManual = yield* Deferred.make<void>();
    const calls: string[] = [];
    const scope = yield* Scope.make();
    const readState = yield* make({
      inspect: () => Effect.succeed(current()),
      persist: (input) =>
        Effect.gen(function* () {
          calls.push(`start:${input.hasUnreadTurn}`);
          if (!input.hasUnreadTurn) {
            yield* Deferred.succeed(manualStarted, undefined);
            yield* Deferred.await(releaseManual);
          }
          calls.push(`finish:${input.hasUnreadTurn}`);
          return true;
        }),
      project: (input) => Effect.sync(() => void calls.push(`project:${input.hasUnreadTurn}`)),
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const manualWrite = yield* Effect.forkChild(
      readState.set({ threadId: "thread-a", hasUnreadTurn: false }),
    );
    yield* Deferred.await(manualStarted);
    const reducerWrite = yield* Effect.forkChild(
      readState.persistProjected({ threadId: "thread-a", hasUnreadTurn: true }),
    );
    yield* Effect.yieldNow;
    assert.deepEqual(calls, ["start:false"]);
    yield* Deferred.succeed(releaseManual, undefined);
    assert.isTrue(yield* Fiber.join(manualWrite));
    yield* Fiber.join(reducerWrite);
    assert.deepEqual(calls, [
      "start:false",
      "finish:false",
      "project:false",
      "start:true",
      "finish:true",
      "project:true",
    ]);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts active and queued persistence with its owning Scope", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let secondStarted = false;
    const scope = yield* Scope.make();
    const readState = yield* make({
      inspect: () => Effect.die("unused"),
      persist: (input) =>
        input.hasUnreadTurn
          ? Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            )
          : Effect.sync(() => {
              secondStarted = true;
              return true;
            }),
      project: () =>
        Effect.fail(new CodexThreadReadStateError({ operation: "project", cause: "unused" })),
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const active = yield* Effect.forkChild(
      readState.persistProjected({ threadId: "thread-a", hasUnreadTurn: true }),
    );
    yield* Deferred.await(started);
    const queued = yield* Effect.forkChild(
      readState.persistProjected({ threadId: "thread-a", hasUnreadTurn: false }),
    );
    yield* Effect.yieldNow;
    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    const [activeExit, queuedExit] = yield* Effect.all([Fiber.await(active), Fiber.await(queued)]);
    assert.isFalse(secondStarted);
    assert.isTrue(Exit.isFailure(activeExit));
    assert.isTrue(Exit.isFailure(queuedExit));
    if (Exit.isFailure(activeExit)) assert.isTrue(Cause.hasInterruptsOnly(activeExit.cause));
    if (Exit.isFailure(queuedExit)) assert.isTrue(Cause.hasInterruptsOnly(queuedExit.cause));
  }),
);
