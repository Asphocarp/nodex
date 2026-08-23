import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexConversationProjection,
  type CodexConversationProjectionService,
} from "./CodexConversationProjection";
import {
  CodexManualCompactionClosedError,
  CodexManualCompactionRuntime,
  live,
} from "./CodexManualCompactionRuntime";

const threadId = "thread-manual-compaction";
const turnId = "turn-manual-compaction";

const gateway = (request: CodexGateway["Service"]["requestForThread"]): CodexGateway["Service"] => {
  const unsupported = () => Effect.die(new Error("Unsupported test operation"));
  return CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
    requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
    events: Stream.empty,
    requestLocal: unsupported as CodexGateway["Service"]["requestLocal"],
    requestOnHost: unsupported as CodexGateway["Service"]["requestOnHost"],
    requestForThread: request,
    notifyLocal: unsupported,
    connection: unsupported,
    connectionChanges: () => Stream.empty,
    awaitReady: unsupported,
    reconcileHost: unsupported,
    removeHost: unsupported,
    restartHost: unsupported,
  });
};

const projection = () => {
  let pending = false;
  let admissions = 0;
  let rollbacks = 0;
  const service = CodexConversationProjection.of({
    admitManualCompaction: () =>
      Effect.sync(() => {
        pending = true;
        admissions += 1;
        return { turnId };
      }),
    rollbackManualCompaction: () =>
      Effect.sync(() => {
        pending = false;
        rollbacks += 1;
      }),
  } as unknown as CodexConversationProjectionService);
  return {
    service,
    read: () => ({ pending, admissions, rollbacks }),
  };
};

const build = Effect.fn("CodexManualCompactionRuntimeTest.build")(function* (
  currentProjection: CodexConversationProjectionService,
  request: CodexGateway["Service"]["requestForThread"],
  scope: Scope.Scope,
) {
  const context = yield* Layer.buildWithScope(
    live.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(CodexConversationProjection, currentProjection),
          Layer.succeed(CodexGateway, gateway(request)),
        ),
      ),
    ),
    scope,
  );
  return Context.get(context, CodexManualCompactionRuntime);
});

it.effect("admits compaction before the remote request and correlates its source once", () =>
  Effect.gen(function* () {
    const currentProjection = projection();
    const scope = yield* Scope.make();
    const runtime = yield* build(
      currentProjection.service,
      ((_threadId, method) => {
        assert.strictEqual(method, "thread/compact/start");
        assert.isTrue(currentProjection.read().pending);
        return Effect.succeed({});
      }) as CodexGateway["Service"]["requestForThread"],
      scope,
    );

    yield* runtime.start(threadId);
    assert.deepEqual(currentProjection.read(), { pending: true, admissions: 1, rollbacks: 0 });
    assert.strictEqual(runtime.consumeSource(threadId), "manual");
    assert.strictEqual(runtime.consumeSource(threadId), "automatic");

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("keeps the optimistic projection while another admitted request remains", () =>
  Effect.gen(function* () {
    const currentProjection = projection();
    const firstStarted = yield* Deferred.make<void>();
    const secondStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const releaseSecond = yield* Deferred.make<void>();
    const failure = codexRuntimeError({
      operation: "manual-compaction-test",
      reason: "request",
      retryable: false,
    });
    let requestCount = 0;
    const scope = yield* Scope.make();
    const runtime = yield* build(
      currentProjection.service,
      (() => {
        requestCount += 1;
        return requestCount === 1
          ? Deferred.succeed(firstStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseFirst)),
              Effect.andThen(Effect.fail(failure)),
            )
          : Deferred.succeed(secondStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseSecond)),
              Effect.as({}),
            );
      }) as CodexGateway["Service"]["requestForThread"],
      scope,
    );

    const first = yield* Effect.forkChild(runtime.start(threadId));
    yield* Deferred.await(firstStarted);
    const second = yield* Effect.forkChild(runtime.start(threadId));
    yield* Deferred.await(secondStarted);
    yield* Deferred.succeed(releaseFirst, undefined);
    assert.strictEqual(yield* Fiber.join(first).pipe(Effect.flip), failure);
    assert.deepEqual(currentProjection.read(), { pending: true, admissions: 2, rollbacks: 0 });

    yield* Deferred.succeed(releaseSecond, undefined);
    yield* Fiber.join(second);
    assert.strictEqual(runtime.consumeSource(threadId), "manual");
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("compensates an interrupted request and rejects admission after Scope close", () =>
  Effect.gen(function* () {
    const currentProjection = projection();
    const started = yield* Deferred.make<void>();
    let interrupted = false;
    const scope = yield* Scope.make();
    const runtime = yield* build(
      currentProjection.service,
      (() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))),
        )) as CodexGateway["Service"]["requestForThread"],
      scope,
    );
    const fiber = yield* runtime.start(threadId).pipe(Effect.forkIn(scope));
    yield* Deferred.await(started);

    yield* Scope.close(scope, Exit.void);
    yield* Fiber.await(fiber);
    assert.isTrue(interrupted);
    assert.deepEqual(currentProjection.read(), { pending: false, admissions: 1, rollbacks: 1 });
    assert.instanceOf(
      yield* runtime.start(threadId).pipe(Effect.flip),
      CodexManualCompactionClosedError,
    );
  }),
);
