import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import type {
  CodexCanonicalConversationState,
  CodexConversationSnapshot,
} from "../../shared/types";
import {
  CodexServerRequestRuntime,
  type CodexServerRequestRuntime as CodexServerRequestRuntimeTag,
} from "../codex-runtime/CodexServerRequestRuntime";
import {
  ApprovalCoordinator,
  CodexApplicationRequestPending,
  CodexGlobalServerRequestRuntime,
  applicationRequestDispatcherLive,
  live as approvalLive,
  serverRequestLayer,
  unhandledGlobal,
} from "./ApprovalCoordinator";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

const applicationLayer: Layer.Layer<
  CodexServerRequestRuntimeTag | ApprovalCoordinator | ConversationRuntimeMap
> = serverRequestLayer.pipe(
  Layer.provideMerge(
    approvalLive.pipe(Layer.provideMerge(Layer.merge(conversationRuntimeMapLive, unhandledGlobal))),
  ),
);

it.effect("serializes application commands across owners in one Thread generation", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(context, ConversationRuntimeMap);
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

it.effect("keeps canonical state and the accepted renderer replica in one generation", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(context, ConversationRuntimeMap);
    yield* conversations.runtime("thread-a");
    const canonical = { requests: [] } as unknown as CodexCanonicalConversationState;
    const conversation = {
      threadId: "thread-a",
      requests: [],
    } as unknown as CodexConversationSnapshot;

    const aggregate = conversations.conversation("thread-a");
    aggregate.acceptCanonicalState(canonical);
    const generation = aggregate.generation;
    aggregate.acceptReplica({
      conversation,
      revision: 4,
      ownerEpoch: 2,
    });

    const accepted = aggregate.read();
    assert.strictEqual(accepted?.generation, generation);
    assert.strictEqual(accepted?.canonicalState, canonical);
    assert.strictEqual(accepted?.acceptedReplica?.conversation, conversation);
    assert.strictEqual(accepted?.revision, 4);
    assert.strictEqual(accepted?.checkpoint?.ownerEpoch, 2);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("evicts a closed generation without recreating it from reads", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(context, ConversationRuntimeMap);
    const aggregate = conversations.conversation("thread-a");
    aggregate.replaceServerRequests([]);
    const firstGeneration = aggregate.generation;

    yield* conversations.close("thread-a");
    assert.isNull(conversations.currentConversation("thread-a"));
    aggregate.acceptCanonicalState({ requests: [] } as unknown as CodexCanonicalConversationState);
    assert.isNull(conversations.currentConversation("thread-a"));

    yield* conversations.runtime("thread-a");
    const secondGeneration = conversations.currentConversation("thread-a")?.generation;
    assert.notStrictEqual(secondGeneration, firstGeneration);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("completes a thread-owned server request exactly once", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(applicationLayer, scope);
    const serverRequests = Context.get(context, CodexServerRequestRuntime);
    const approvals = Context.get(context, ApprovalCoordinator);
    const conversations = Context.get(context, ConversationRuntimeMap);
    const runtime = yield* conversations.runtime("thread-a");
    const eventFiber = yield* Stream.runHead(runtime.events).pipe(Effect.forkScoped);
    yield* Effect.yieldNow;

    const responseFiber = yield* serverRequests
      .handle("local", 7, 42, "item/tool/requestUserInput", {
        isBlocking: true,
        itemId: "item-a",
        questions: [],
        threadId: "thread-a",
        turnId: "turn-a",
      })
      .pipe(Effect.forkScoped);
    const event = yield* Fiber.join(eventFiber);
    assert.isTrue(Option.isSome(event));
    if (Option.isSome(event)) {
      assert.strictEqual(event.value.sequence, 1);
      assert.strictEqual(event.value.event.kind, "server-request");
      if (event.value.event.kind === "server-request") {
        assert.strictEqual(event.value.event.value.requestId, 42);
      }
    }

    assert.isTrue(yield* approvals.respond("thread-a", 7, 42, { answers: {} }));
    assert.deepEqual(yield* Fiber.join(responseFiber), { answers: {} });
    assert.isFalse(yield* approvals.respond("thread-a", 7, 42, { answers: {} }));
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rejects pending requests when a thread runtime is invalidated", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(applicationLayer, scope);
    const serverRequests = Context.get(context, CodexServerRequestRuntime);
    const conversations = Context.get(context, ConversationRuntimeMap);
    const runtime = yield* conversations.runtime("thread-a");
    const request = yield* serverRequests
      .handle("local", 1, "request-a", "item/fileChange/requestApproval", {
        itemId: "item-a",
        startedAtMs: 0,
        threadId: "thread-a",
        turnId: "turn-a",
      })
      .pipe(Effect.result, Effect.forkScoped);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((yield* SubscriptionRef.get(runtime.state)).pendingRequests === 1) break;
      yield* Effect.yieldNow;
    }
    assert.strictEqual((yield* SubscriptionRef.get(runtime.state)).pendingRequests, 1);

    yield* conversations.close("thread-a");
    assert.strictEqual((yield* SubscriptionRef.get(runtime.state)).kind, "closing");
    const result = yield* Fiber.join(request);
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) {
      assert.strictEqual(result.failure._tag, "CodexAppServerInputStreamEndedError");
    }
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("routes private app-server methods through the same thread runtime", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(applicationLayer, scope);
    const serverRequests = Context.get(context, CodexServerRequestRuntime);
    const approvals = Context.get(context, ApprovalCoordinator);
    assert.isFunction(serverRequests.handleUnknown);
    if (serverRequests.handleUnknown === undefined) return;
    const response = yield* serverRequests
      .handleUnknown("local", 2, "private-a", "item/tool/requestOptionPicker", {
        threadId: "thread-private",
        turnId: "turn-private",
      })
      .pipe(Effect.forkScoped);
    const runtime = yield* Context.get(context, ConversationRuntimeMap).runtime("thread-private");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((yield* SubscriptionRef.get(runtime.state)).pendingRequests === 1) break;
      yield* Effect.yieldNow;
    }

    assert.isTrue(
      yield* approvals.respond("thread-private", 2, "private-a", { selected: "choice-a" }),
    );
    assert.deepEqual(yield* Fiber.join(response), { selected: "choice-a" });
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("preserves duplicate JSON-RPC ids and completes them in arrival order", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(applicationLayer, scope);
    const serverRequests = Context.get(context, CodexServerRequestRuntime);
    const approvals = Context.get(context, ApprovalCoordinator);
    const conversations = Context.get(context, ConversationRuntimeMap);
    const runtime = yield* conversations.runtime("thread-a");
    const invoke = () =>
      serverRequests.handle("local", 3, 7, "item/tool/requestUserInput", {
        isBlocking: true,
        itemId: "item-a",
        questions: [],
        threadId: "thread-a",
        turnId: "turn-a",
      });
    const first = yield* invoke().pipe(Effect.forkScoped);
    const second = yield* invoke().pipe(Effect.forkScoped);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((yield* SubscriptionRef.get(runtime.state)).pendingRequests === 2) break;
      yield* Effect.yieldNow;
    }
    assert.strictEqual((yield* SubscriptionRef.get(runtime.state)).pendingRequests, 2);

    assert.isTrue(yield* approvals.respond("thread-a", 3, 7, { order: "first" }));
    assert.isTrue(yield* approvals.respond("thread-a", 3, 7, { order: "second" }));
    assert.isFalse(yield* approvals.respond("thread-a", 3, 7, { order: "third" }));
    assert.deepEqual(yield* Fiber.join(first), { order: "first" });
    assert.deepEqual(yield* Fiber.join(second), { order: "second" });
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("keeps each thread on an independent ordered event worker", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(context, ConversationRuntimeMap);
    const first = yield* conversations.runtime("thread-a");
    const second = yield* conversations.runtime("thread-b");
    yield* first.events.pipe(
      Stream.runForEach(() => Effect.never),
      Effect.forkScoped,
    );
    const secondEvent = yield* Stream.runHead(second.events).pipe(Effect.forkScoped);
    yield* Effect.yieldNow;

    yield* first.publish({ kind: "notification", method: "first", params: null });
    yield* second.publish({ kind: "notification", method: "second", params: null });
    const observed = yield* Fiber.join(secondEvent);
    assert.isTrue(Option.isSome(observed));
    if (Option.isSome(observed)) assert.strictEqual(observed.value.threadId, "thread-b");
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("buffers application ingress and dispatches waiting threads concurrently", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtimeContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(runtimeContext, ConversationRuntimeMap);
    const application = CodexGlobalServerRequestRuntime.of({
      handle: (_hostId, _generation, requestId) =>
        requestId === "blocked" ? Effect.never : Effect.succeed({ answers: {} }),
    });
    const approvalsContext = yield* Layer.buildWithScope(
      approvalLive.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(ConversationRuntimeMap, conversations),
            Layer.succeed(CodexGlobalServerRequestRuntime, application),
          ),
        ),
      ),
      scope,
    );
    const approvals = Context.get(approvalsContext, ApprovalCoordinator);
    const requestContext = yield* Layer.buildWithScope(
      serverRequestLayer.pipe(Layer.provide(Layer.succeed(ApprovalCoordinator, approvals))),
      scope,
    );
    const requests = Context.get(requestContext, CodexServerRequestRuntime);
    const invoke = (threadId: string, requestId: string) =>
      requests.handle("local", 1, requestId, "item/tool/requestUserInput", {
        isBlocking: true,
        itemId: `item-${threadId}`,
        questions: [],
        threadId,
        turnId: `turn-${threadId}`,
      });
    const blocked = yield* invoke("thread-a", "blocked").pipe(Effect.forkScoped);
    const ready = yield* invoke("thread-b", "ready").pipe(Effect.forkScoped);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const first = yield* conversations.runtime("thread-a");
      const second = yield* conversations.runtime("thread-b");
      if (
        (yield* SubscriptionRef.get(first.state)).pendingRequests === 1 &&
        (yield* SubscriptionRef.get(second.state)).pendingRequests === 1
      ) {
        break;
      }
      yield* Effect.yieldNow;
    }

    yield* Layer.buildWithScope(
      applicationRequestDispatcherLive.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(ConversationRuntimeMap, conversations),
            Layer.succeed(CodexGlobalServerRequestRuntime, application),
          ),
        ),
      ),
      scope,
    );
    assert.deepEqual(yield* Fiber.join(ready), { answers: {} });
    yield* Scope.close(scope, Exit.void);
    yield* Fiber.await(blocked);
  }),
);

it.effect("leaves pending application requests open and resolves exact occurrences", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtimeContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(runtimeContext, ConversationRuntimeMap);
    const tokens: number[] = [];
    const application = CodexGlobalServerRequestRuntime.of({
      handle: (_hostId, _generation, _requestId, _method, _params, occurrenceToken) =>
        Effect.sync(() => {
          if (occurrenceToken === undefined) throw new Error("Missing occurrence token");
          tokens.push(occurrenceToken);
          return CodexApplicationRequestPending;
        }),
    });
    const approvalsContext = yield* Layer.buildWithScope(
      approvalLive.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(ConversationRuntimeMap, conversations),
            Layer.succeed(CodexGlobalServerRequestRuntime, application),
          ),
        ),
      ),
      scope,
    );
    const approvals = Context.get(approvalsContext, ApprovalCoordinator);
    const requestContext = yield* Layer.buildWithScope(
      serverRequestLayer.pipe(Layer.provide(Layer.succeed(ApprovalCoordinator, approvals))),
      scope,
    );
    yield* Layer.buildWithScope(
      applicationRequestDispatcherLive.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(ConversationRuntimeMap, conversations),
            Layer.succeed(CodexGlobalServerRequestRuntime, application),
          ),
        ),
      ),
      scope,
    );
    const requests = Context.get(requestContext, CodexServerRequestRuntime);
    const invoke = () =>
      requests.handle("local", 8, 19, "item/tool/requestUserInput", {
        isBlocking: true,
        itemId: "item-a",
        questions: [],
        threadId: "thread-a",
        turnId: "turn-a",
      });
    const first = yield* invoke().pipe(Effect.forkScoped);
    for (let attempt = 0; attempt < 100 && tokens.length < 1; attempt += 1) {
      yield* Effect.yieldNow;
    }
    assert.strictEqual(tokens.length, 1);
    const second = yield* invoke().pipe(Effect.forkScoped);
    for (let attempt = 0; attempt < 100 && tokens.length < 2; attempt += 1) {
      yield* Effect.yieldNow;
    }
    assert.strictEqual(tokens.length, 2);

    assert.isTrue(yield* approvals.respondToken("thread-a", tokens[1]!, { order: "second" }));
    assert.isTrue(yield* approvals.respondToken("thread-a", tokens[0]!, { order: "first" }));
    assert.deepEqual(yield* Fiber.join(first), { order: "first" });
    assert.deepEqual(yield* Fiber.join(second), { order: "second" });
    yield* Scope.close(scope, Exit.void);
  }),
);
