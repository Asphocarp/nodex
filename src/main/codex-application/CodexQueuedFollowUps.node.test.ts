import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type {
  CodexCanonicalConversationState,
  CodexConversationSnapshot,
} from "../../shared/types";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { make as makeQueuedFollowUpDispatcher } from "./CodexQueuedFollowUpDispatcher";
import { make as makeQueuedFollowUps, CodexQueuedFollowUps } from "./CodexQueuedFollowUps";
import {
  CodexRendererConversationRegistry,
  makeCodexRendererConversationRegistryState,
} from "./CodexRendererConversationRegistry";
import { CodexTurnCommands } from "./CodexTurnCommands";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

const snapshot = (threadId: string): CodexConversationSnapshot =>
  ({
    threadId,
    queuedFollowUps: [],
    requests: [],
    resumeState: "resumed",
  }) as unknown as CodexConversationSnapshot;

const canonical = (activeTurnId: string | null): CodexCanonicalConversationState =>
  ({
    turns: activeTurnId ? [{ protocol: { id: activeTurnId, status: "inProgress" } }] : [],
  }) as unknown as CodexCanonicalConversationState;

const makeHarness = (input: {
  readonly activeTurnId?: string | null;
  readonly submit: (threadId: string, prompt: string) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const stateScope = yield* Scope.make();
    const dispatcherScope = yield* Scope.make();
    const conversationsContext = yield* Layer.buildWithScope(
      conversationRuntimeMapLive,
      stateScope,
    );
    const conversations = Context.get(conversationsContext, ConversationRuntimeMap);
    conversations.conversation("thread-a").installSnapshot(snapshot("thread-a"));
    const rendererRegistry = makeCodexRendererConversationRegistryState();
    const queued = yield* makeQueuedFollowUps.pipe(
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(CodexRendererConversationRegistry, rendererRegistry),
      Effect.provideService(Scope.Scope, stateScope),
    );
    const projection = CodexConversationProjection.of({
      read: (threadId: string) =>
        Effect.succeed({
          canonical: canonical(input.activeTurnId ?? null),
          snapshot: conversations.currentConversation(threadId)?.readSnapshot() ?? null,
        }),
    } as unknown as CodexConversationProjection["Service"]);
    const turns = CodexTurnCommands.of({
      start: (threadId, prompt) =>
        input.submit(threadId, prompt).pipe(
          Effect.as({
            threadId,
            turnId: "turn-a",
            status: "inProgress" as const,
            itemIds: [],
          }),
        ),
      startRendererOwned: () => Effect.die("unused"),
      steer: ({ threadId, prompt }) =>
        input.submit(threadId, prompt).pipe(Effect.as({ turnId: "turn-a" })),
      steerRendererOwned: () => Effect.die("unused"),
    });
    const dispatcher = yield* makeQueuedFollowUpDispatcher.pipe(
      Effect.provideService(CodexConversationProjection, projection),
      Effect.provideService(CodexQueuedFollowUps, queued),
      Effect.provideService(CodexTurnCommands, turns),
      Effect.provideService(Scope.Scope, dispatcherScope),
    );
    return { conversations, dispatcher, dispatcherScope, queued, stateScope };
  });

const closeHarness = (harness: {
  readonly dispatcherScope: Scope.Closeable;
  readonly stateScope: Scope.Closeable;
}) =>
  Scope.close(harness.dispatcherScope, Exit.void).pipe(
    Effect.andThen(Scope.close(harness.stateScope, Exit.void)),
  );

it.effect("dispatches one terminal queue head and coalesces duplicate intents", () =>
  Effect.gen(function* () {
    let submissions = 0;
    const submitted = yield* Deferred.make<void>();
    const harness = yield* makeHarness({
      submit: () =>
        Effect.sync(() => {
          submissions += 1;
        }).pipe(Effect.andThen(Deferred.succeed(submitted, undefined)), Effect.asVoid),
    });
    yield* harness.queued.enqueue({ threadId: "thread-a", prompt: "ship" });
    yield* Effect.all([
      harness.queued.requestDispatch("thread-a"),
      harness.queued.requestDispatch("thread-a"),
    ]);
    yield* Deferred.await(submitted);
    yield* Effect.yieldNow;

    assert.strictEqual(submissions, 1);
    assert.deepEqual(harness.queued.list("thread-a"), []);
    yield* closeHarness(harness);
  }),
);

it.effect("does not automatically dispatch an active or paused queue head", () =>
  Effect.gen(function* () {
    let submissions = 0;
    const active = yield* makeHarness({
      activeTurnId: "turn-active",
      submit: () => Effect.sync(() => void (submissions += 1)),
    });
    yield* active.queued.enqueue({ threadId: "thread-a", prompt: "later" });
    yield* active.queued.requestDispatch("thread-a");
    yield* Effect.yieldNow;
    assert.strictEqual(submissions, 0);
    assert.strictEqual(active.queued.list("thread-a").length, 1);
    yield* closeHarness(active);

    const paused = yield* makeHarness({
      submit: () => Effect.sync(() => void (submissions += 1)),
    });
    yield* paused.queued.enqueue({
      threadId: "thread-a",
      prompt: "later",
      pausedReason: "needs attention",
    });
    yield* paused.queued.requestDispatch("thread-a");
    yield* Effect.yieldNow;
    assert.strictEqual(submissions, 0);
    assert.strictEqual(paused.queued.list("thread-a").length, 1);
    yield* closeHarness(paused);
  }),
);

it.effect("restores an interrupted claim when the dispatcher Scope closes", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const harness = yield* makeHarness({
      submit: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    });
    yield* harness.queued.enqueue({ threadId: "thread-a", prompt: "retry me" });
    yield* harness.queued.requestDispatch("thread-a");
    yield* Deferred.await(started);
    yield* Scope.close(harness.dispatcherScope, Exit.void);

    const [restored] = harness.queued.list("thread-a");
    assert.strictEqual(restored?.prompt, "retry me");
    assert.strictEqual(restored?.pausedReason, "Queued follow-up submission was interrupted");
    yield* Scope.close(harness.stateScope, Exit.void);
  }),
);

it.effect(
  "release cancels the claim before clearing its generation while reset does not cancel",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let interruptions = 0;
      const harness = yield* makeHarness({
        submit: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.onInterrupt(() => Effect.sync(() => void (interruptions += 1))),
          ),
      });
      yield* harness.queued.enqueue({ threadId: "thread-a", prompt: "in flight" });
      yield* harness.queued.requestDispatch("thread-a");
      yield* Deferred.await(started);
      yield* harness.queued.reset("thread-a");
      assert.strictEqual(interruptions, 0);
      yield* Deferred.succeed(release, undefined);
      yield* Effect.yieldNow;
      yield* closeHarness(harness);

      const startedAgain = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      const releaseHarness = yield* makeHarness({
        submit: () =>
          Deferred.succeed(startedAgain, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid)),
          ),
      });
      yield* releaseHarness.queued.enqueue({
        threadId: "thread-a",
        prompt: "cancel me",
      });
      yield* releaseHarness.queued.requestDispatch("thread-a");
      yield* Deferred.await(startedAgain);
      yield* releaseHarness.dispatcher.cancel("thread-a");
      yield* Deferred.await(interrupted);
      assert.strictEqual(releaseHarness.queued.list("thread-a")[0]?.prompt, "cancel me");
      yield* releaseHarness.queued.clear("thread-a");
      assert.deepEqual(releaseHarness.queued.list("thread-a"), []);
      yield* closeHarness(releaseHarness);
    }),
);
