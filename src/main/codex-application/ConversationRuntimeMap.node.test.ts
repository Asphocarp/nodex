import * as Context from "effect/Context";
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
import {
  CodexServerRequestRuntime,
  type CodexServerRequestRuntime as CodexServerRequestRuntimeTag,
} from "../codex-runtime/CodexServerRequestRuntime";
import {
  ApprovalCoordinator,
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
