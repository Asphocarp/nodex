import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

const build = Effect.fn("ConversationRuntimeMapTest.build")(function* (scope: Scope.Scope) {
  const context = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
  return Context.get(context, ConversationRuntimeMap);
});

it.effect("serializes commands admitted to the same Thread generation", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const conversations = yield* build(scope);
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const order: string[] = [];
    const first = yield* conversations
      .runExclusive(
        "thread-a",
        Effect.sync(() => order.push("first:start")).pipe(
          Effect.andThen(Deferred.succeed(firstStarted, undefined)),
          Effect.andThen(Deferred.await(releaseFirst)),
          Effect.andThen(Effect.sync(() => order.push("first:end"))),
        ),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(firstStarted);
    const second = yield* conversations
      .runExclusive(
        "thread-a",
        Effect.sync(() => order.push("second")),
      )
      .pipe(Effect.forkChild);
    yield* Effect.yieldNow;

    assert.deepEqual(order, ["first:start"]);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("keeps different Thread generations causally independent", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const conversations = yield* build(scope);
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const secondStarted = yield* Deferred.make<void>();
    const first = yield* conversations
      .runExclusive(
        "thread-a",
        Deferred.succeed(firstStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseFirst)),
        ),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(firstStarted);
    const second = yield* conversations
      .runExclusive("thread-b", Deferred.succeed(secondStarted, undefined))
      .pipe(Effect.forkChild);

    yield* Deferred.await(secondStarted);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("marks every loaded generation non-live after connection loss", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const conversations = yield* build(scope);
    const first = conversations.conversation("thread-a");
    const second = conversations.conversation("thread-b");
    first.setResumeState("resumed");
    first.setStreamRole("owner");
    first.setStreaming(true);
    second.setResumeState("resuming");
    second.setStreamRole("follower");
    second.setStreaming(true);

    conversations.markAllNeedsResume();

    for (const aggregate of [first, second]) {
      assert.strictEqual(aggregate.readResumeState(), "needs_resume");
      assert.isNull(aggregate.readStreamRole());
      assert.isFalse(aggregate.isStreaming());
    }
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("close interrupts the live lane and fences it from the next generation", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const conversations = yield* build(scope);
    const aggregate = conversations.conversation("thread-a");
    const firstGeneration = aggregate.generation;
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let queuedEntered = false;
    const active = yield* conversations
      .runExclusive(
        "thread-a",
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const queued = yield* conversations
      .runExclusive(
        "thread-a",
        Effect.sync(() => {
          queuedEntered = true;
        }),
      )
      .pipe(Effect.forkChild);
    yield* Effect.yieldNow;

    yield* conversations.close("thread-a");
    yield* Deferred.await(interrupted);
    assert.strictEqual((yield* Fiber.await(active))._tag, "Failure");
    assert.strictEqual((yield* Fiber.await(queued))._tag, "Failure");
    assert.isFalse(queuedEntered);
    assert.isNull(conversations.currentConversation("thread-a"));

    yield* conversations.runExclusive("thread-a", Effect.void);
    const secondGeneration = conversations.currentConversation("thread-a")?.generation;
    assert.isDefined(secondGeneration);
    assert.notStrictEqual(secondGeneration, firstGeneration);

    aggregate.reset();
    assert.strictEqual(conversations.currentConversation("thread-a")?.generation, secondGeneration);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("Main Scope close interrupts every lane and releases aggregate generations", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const conversations = yield* build(ownerScope);
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const active = yield* conversations
      .runExclusive(
        "thread-a",
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);

    yield* Scope.close(ownerScope, Exit.void);
    yield* Deferred.await(interrupted);
    assert.strictEqual((yield* Fiber.await(active))._tag, "Failure");
    assert.isNull(conversations.currentConversation("thread-a"));
  }),
);
