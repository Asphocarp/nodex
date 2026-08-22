import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import {
  CodexRendererOwnerRetention,
  CodexRendererOwnerRetentionError,
  make,
} from "./CodexRendererOwnerRetention";
import { makeCodexRendererOwnerRetentionCallbackAdapter } from "./CodexRendererOwnerRetentionCallbackAdapter";

it.effect("serializes synchronous callbacks with admission-time eligibility", () =>
  Effect.gen(function* () {
    let candidate = true;
    const calls: string[] = [];
    const drained = yield* Deferred.make<void>();
    const runtime = CodexRendererOwnerRetention.of({
      trackedConversationIds: Effect.succeed([]),
      reconcile: (conversationId, eligible) =>
        Effect.sync(() => calls.push(`reconcile:${conversationId}:${eligible}`)),
      recheckAfter: (conversationId, delay) =>
        Effect.sync(() => calls.push(`recheck:${conversationId}:${String(delay)}`)).pipe(
          Effect.andThen(Deferred.succeed(drained, undefined)),
        ),
      clear: (conversationId) => Effect.sync(() => calls.push(`clear:${conversationId}`)),
    });
    const adapter = yield* makeCodexRendererOwnerRetentionCallbackAdapter(runtime, {
      isCandidate: () => candidate,
    });

    adapter.reconcile("thread-1");
    adapter.clear("thread-1");
    candidate = false;
    adapter.reconcile("thread-1");
    adapter.recheckAfter("thread-1", 2_001);
    yield* Deferred.await(drained);

    assert.deepEqual(calls, [
      "reconcile:thread-1:true",
      "clear:thread-1",
      "reconcile:thread-1:false",
      "recheck:thread-1:2001",
    ]);
  }),
);

it.effect("retains an inactive owner until its scoped deadline", () =>
  Effect.gen(function* () {
    const committed: string[] = [];
    const runtime = yield* make({
      isCandidate: () => true,
      retention: "1 minute",
      unsubscribe: () => Effect.void,
      commitCleanup: (conversationId, reason) =>
        Effect.sync(() => committed.push(`${conversationId}:${reason}`)),
    });
    yield* runtime.reconcile("thread-1", true);
    yield* TestClock.adjust("59 seconds");
    assert.isEmpty(committed);
    yield* TestClock.adjust("1 second");
    assert.deepEqual(committed, ["thread-1:inactive-owner-retention"]);
    assert.isEmpty(yield* runtime.trackedConversationIds);
  }),
);

it.effect("cancels retention when renderer ownership becomes active again", () =>
  Effect.gen(function* () {
    let candidate = true;
    let committed = 0;
    const runtime = yield* make({
      isCandidate: () => candidate,
      retention: "1 minute",
      unsubscribe: () => Effect.void,
      commitCleanup: () => Effect.sync(() => void (committed += 1)),
    });
    yield* runtime.reconcile("thread-1", true);
    candidate = false;
    yield* runtime.reconcile("thread-1", false);
    yield* TestClock.adjust("10 minutes");
    assert.strictEqual(committed, 0);
    assert.isEmpty(yield* runtime.trackedConversationIds);
  }),
);

it.effect("retries a failed unsubscribe without creating a second cleanup", () =>
  Effect.gen(function* () {
    let attempts = 0;
    let committed = 0;
    const runtime = yield* make({
      isCandidate: () => true,
      retention: "1 minute",
      retry: "5 seconds",
      unsubscribe: () => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(new CodexRendererOwnerRetentionError({ cause: new Error("offline") }))
          : Effect.void;
      },
      commitCleanup: () => Effect.sync(() => void (committed += 1)),
    });
    yield* runtime.reconcile("thread-1", true);
    yield* TestClock.adjust("1 minute");
    assert.strictEqual(attempts, 1);
    assert.strictEqual(committed, 0);
    yield* TestClock.adjust("5 seconds");
    assert.strictEqual(attempts, 2);
    assert.strictEqual(committed, 1);
  }),
);

it.effect("evicts the oldest eligible owner when the retention bound overflows", () =>
  Effect.gen(function* () {
    const candidates = new Set(["thread-a", "thread-b"]);
    const committed: string[] = [];
    const runtime = yield* make({
      isCandidate: (conversationId) => candidates.has(conversationId),
      retention: "1 hour",
      maxRetained: 1,
      unsubscribe: () => Effect.void,
      commitCleanup: (conversationId, reason) =>
        Effect.sync(() => {
          committed.push(`${conversationId}:${reason}`);
          candidates.delete(conversationId);
        }),
    });
    yield* runtime.reconcile("thread-a", true);
    yield* TestClock.adjust(1);
    yield* runtime.reconcile("thread-b", true);
    yield* Effect.yieldNow;
    assert.deepEqual(committed, ["thread-a:inactive-owner-retained-limit"]);
    assert.deepEqual(yield* runtime.trackedConversationIds, ["thread-b"]);
  }),
);

it.effect("fences a completed unsubscribe from a replacement owner generation", () =>
  Effect.gen(function* () {
    let candidate = true;
    let attempts = 0;
    const committed: string[] = [];
    const firstUnsubscribe = yield* Deferred.make<void>();
    const runtime = yield* make({
      isCandidate: () => candidate,
      retention: "1 second",
      unsubscribe: () => {
        attempts += 1;
        return attempts === 1 ? Deferred.await(firstUnsubscribe) : Effect.void;
      },
      commitCleanup: (_conversationId, reason) => Effect.sync(() => committed.push(reason)),
    });
    yield* runtime.reconcile("thread-1", true);
    yield* TestClock.adjust("1 second");
    assert.strictEqual(attempts, 1);

    candidate = false;
    yield* runtime.reconcile("thread-1", false);
    candidate = true;
    yield* runtime.reconcile("thread-1", true);
    yield* Deferred.succeed(firstUnsubscribe, undefined);
    yield* Effect.yieldNow;
    assert.isEmpty(committed);

    yield* TestClock.adjust("1 second");
    assert.strictEqual(attempts, 2);
    assert.deepEqual(committed, ["inactive-owner-retention"]);
  }),
);

it.effect("interrupts delayed rechecks and retention when the Main Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let committed = 0;
    const runtime = yield* make({
      isCandidate: () => true,
      retention: "1 minute",
      unsubscribe: () => Effect.void,
      commitCleanup: () => Effect.sync(() => void (committed += 1)),
    }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.recheckAfter("thread-1", "5 seconds");
    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust("10 minutes");
    assert.strictEqual(committed, 0);
  }),
);
