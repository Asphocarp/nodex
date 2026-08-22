import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import {
  CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN,
  type CodexServerNotification,
  type CodexServerRequest,
} from "../codex-runtime/CodexApplicationProtocol";
import {
  CodexConversationEventBufferError,
  type CodexConversationEventBufferRuntimeService,
  make,
} from "./CodexConversationEventBufferRuntime";

const notification = (
  method: CodexServerNotification["method"],
  threadId = "thread-1",
  itemId = "item-1",
): CodexServerNotification =>
  ({ method, params: { threadId, turnId: "turn-1", itemId } }) as CodexServerNotification;

const threadStarted = (threadId = "thread-1"): CodexServerNotification =>
  ({
    method: "thread/started",
    params: {
      thread: {
        id: threadId,
        parentThreadId: null,
        preview: "",
        ephemeral: false,
        cwd: "/workspace/project",
      },
    },
  }) as CodexServerNotification;

const request = (threadId = "thread-1"): CodexServerRequest =>
  ({
    id: "request-1",
    method: "item/tool/requestUserInput",
    params: { threadId, turnId: "turn-1", itemId: "item-1", questions: [] },
    [CODEX_SERVER_REQUEST_OCCURRENCE_TOKEN]: 1,
  }) as unknown as CodexServerRequest;

const identity = <T>(_: string, events: readonly T[]): readonly T[] => events;

it.effect("detaches the resume lane before ordered replay so reentrant events stay live", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    let runtime!: CodexConversationEventBufferRuntimeService;
    runtime = yield* make({
      compact: identity,
      replayNotification: ({ notification: current, threadId }) =>
        Effect.sync(() => {
          order.push(`${current.method}:${(current.params as { itemId?: string }).itemId ?? ""}`);
          if (current.method !== "item/reasoning/summaryPartAdded") return;
          const nested = notification("item/mcpToolCall/progress", threadId, "nested-live");
          const buffered = runtime.offerNotification({ threadId, notification: nested });
          assert.isFalse(buffered);
          order.push(`${nested.method}:nested-live`);
        }),
      replayRequest: () => Effect.void,
    });
    assert.isTrue(runtime.beginResume("thread-1"));
    runtime.offerNotification({
      threadId: "thread-1",
      notification: notification("item/reasoning/summaryPartAdded"),
    });
    runtime.offerNotification({
      threadId: "thread-1",
      notification: notification("item/mcpToolCall/progress", "thread-1", "old-tail"),
    });

    yield* runtime.releaseResume("thread-1");

    assert.deepEqual(order, [
      "item/reasoning/summaryPartAdded:item-1",
      "item/mcpToolCall/progress:nested-live",
      "item/mcpToolCall/progress:old-tail",
    ]);
    assert.isFalse(runtime.hasResume("thread-1"));
  }),
);

it.effect("moves a nested resume batch into the outer thread-start fence", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    let resolved = false;
    let runtime!: CodexConversationEventBufferRuntimeService;
    runtime = yield* make({
      compact: identity,
      replayNotification: ({ notification: current, threadId }) =>
        Effect.sync(() => {
          const buffered = runtime.offerNotification({
            threadId,
            notification: current,
            startsThread: current.method === "thread/started",
          });
          if (!buffered) order.push(`notification:${current.method}`);
        }),
      replayRequest: ({ event }) =>
        Effect.sync(() => {
          order.push(`request:${event.request.method}`);
          event.resolve({ handled: true });
        }),
    });
    runtime.beginThreadStartDeferral();
    assert.isTrue(
      runtime.offerNotification({
        threadId: "thread-1",
        notification: threadStarted(),
        startsThread: true,
      }),
    );
    runtime.beginResume("thread-1");
    runtime.offerNotification({
      threadId: "thread-1",
      notification: notification("item/reasoning/summaryPartAdded"),
    });
    runtime.offerRequest({
      threadId: "thread-1",
      request: request(),
      completion: () => ({
        resolve: () => {
          resolved = true;
        },
        reject: (reason) => assert.fail(String(reason)),
      }),
    });

    yield* runtime.releaseResume("thread-1");
    assert.deepEqual(order, []);
    assert.isFalse(resolved);

    yield* runtime.completeThreadStartDeferral("thread-1");
    assert.deepEqual(order, [
      "notification:thread/started",
      "notification:item/reasoning/summaryPartAdded",
      "request:item/tool/requestUserInput",
    ]);
    assert.isTrue(resolved);
    yield* runtime.endThreadStartDeferral;
  }),
);

it.effect("keeps a completed Thread ready until the outer creation generation closes", () =>
  Effect.gen(function* () {
    const runtime = yield* make({
      compact: identity,
      replayNotification: () => Effect.void,
      replayRequest: () => Effect.void,
    });
    runtime.beginThreadStartDeferral();
    yield* runtime.completeThreadStartDeferral("thread-1");
    assert.isFalse(
      runtime.offerNotification({
        threadId: "thread-1",
        notification: threadStarted(),
        startsThread: true,
      }),
    );
    yield* runtime.endThreadStartDeferral;

    runtime.beginThreadStartDeferral();
    assert.isTrue(
      runtime.offerNotification({
        threadId: "thread-1",
        notification: threadStarted(),
        startsThread: true,
      }),
    );
    yield* runtime.endThreadStartDeferral;
  }),
);

it.effect("rejects unreplayed requests after a resume failure and permits a clean retry", () =>
  Effect.gen(function* () {
    let rejected: unknown;
    const runtime = yield* make({
      compact: identity,
      replayNotification: ({ threadId }) =>
        Effect.fail(
          new CodexConversationEventBufferError({
            cause: new Error("notification failed"),
            phase: "resume",
            threadId,
          }),
        ),
      replayRequest: () => Effect.void,
    });
    runtime.beginResume("thread-1");
    runtime.offerNotification({
      threadId: "thread-1",
      notification: notification("item/reasoning/summaryPartAdded"),
    });
    runtime.offerRequest({
      threadId: "thread-1",
      request: request(),
      completion: () => ({
        resolve: (value) => assert.fail(String(value)),
        reject: (reason) => (rejected = reason),
      }),
    });

    const result = yield* runtime.releaseResume("thread-1").pipe(Effect.result);
    assert.strictEqual(result._tag, "Failure");
    assert.instanceOf(rejected, CodexConversationEventBufferError);
    assert.isTrue(runtime.beginResume("thread-1"));
  }),
);

it.effect("Main Scope close interrupts active replay and rejects its remaining requests", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const replayStarted = yield* Deferred.make<void>();
    let rejected: unknown;
    const runtime = yield* make({
      compact: identity,
      replayNotification: ({ threadId }) =>
        Deferred.succeed(replayStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.mapError(
            (cause) =>
              new CodexConversationEventBufferError({
                cause,
                phase: "resume",
                threadId,
              }),
          ),
        ),
      replayRequest: () => Effect.void,
    }).pipe(Effect.provideService(Scope.Scope, ownerScope));
    runtime.beginResume("thread-1");
    runtime.offerNotification({
      threadId: "thread-1",
      notification: notification("item/reasoning/summaryPartAdded"),
    });
    runtime.offerRequest({
      threadId: "thread-1",
      request: request(),
      completion: () => ({
        resolve: (value) => assert.fail(String(value)),
        reject: (reason) => (rejected = reason),
      }),
    });
    const replay = yield* Effect.forkChild(runtime.releaseResume("thread-1"), {
      startImmediately: true,
    });
    yield* Deferred.await(replayStarted);

    yield* Scope.close(ownerScope, Exit.void);

    assert.instanceOf(rejected, Error);
    assert.strictEqual((yield* Fiber.await(replay))._tag, "Failure");
  }),
);
