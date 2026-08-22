import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexThreadSettingsOperationError,
  make,
  type CodexPreparedThreadSettingsUpdate,
  type CodexThreadSettingsRuntimeOptions,
  type CodexThreadSettingsUpdateCommand,
} from "./CodexThreadSettingsRuntime";

const settings = (model: string) => ({
  model,
  modelProvider: null,
  serviceTier: null,
  reasoningEffort: null,
  summary: null,
  collaborationMode: {
    mode: "default" as const,
    settings: {
      model,
      reasoning_effort: null,
      developer_instructions: null,
    },
  },
  personality: null,
});

const prepared = (input: CodexThreadSettingsUpdateCommand): CodexPreparedThreadSettingsUpdate => {
  const model = input.patch.model ?? "default";
  return {
    nextSettings: settings(model),
    params: { threadId: input.threadId, model },
  };
};

const gateway = (request: CodexGateway["Service"]["requestForThread"]): CodexGateway["Service"] => {
  const unsupported = () => Effect.die(new Error("Unsupported test operation"));
  return CodexGateway.of({
    localHostId: "local",
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

const runtime = (
  options: CodexThreadSettingsRuntimeOptions,
  request: CodexGateway["Service"]["requestForThread"] = (() =>
    Effect.succeed({})) as CodexGateway["Service"]["requestForThread"],
) => make(options).pipe(Effect.provideService(CodexGateway, gateway(request)));

it.effect(
  "serializes complete settings transactions per Thread and exposes an admission barrier",
  () =>
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const order: string[] = [];
      const service = yield* runtime(
        {
          prepare: (input) =>
            input.patch.model === "first"
              ? Deferred.succeed(firstStarted, undefined).pipe(
                  Effect.andThen(Effect.sync(() => order.push("first:prepare"))),
                  Effect.andThen(Deferred.await(releaseFirst)),
                  Effect.as(prepared(input)),
                )
              : Effect.sync(() => {
                  order.push("second:prepare");
                  return prepared(input);
                }),
        },
        ((_threadId, method, params) => {
          assert.strictEqual(method, "thread/settings/update");
          order.push(`${String((params as { model?: unknown }).model)}:remote`);
          return Effect.succeed({});
        }) as CodexGateway["Service"]["requestForThread"],
      );
      const first = yield* Effect.forkChild(
        service.update({ threadId: "thread-1", patch: { model: "first" } }),
      );
      yield* Deferred.await(firstStarted);
      const second = yield* Effect.forkChild(
        service.update({ threadId: "thread-1", patch: { model: "second" } }),
      );
      let admitted = false;
      const admission = yield* Effect.forkChild(
        service.awaitCurrent("thread-1").pipe(
          Effect.andThen(
            Effect.sync(() => {
              admitted = true;
            }),
          ),
        ),
      );

      yield* Effect.yieldNow;
      assert.deepEqual(order, ["first:prepare"]);
      assert.isFalse(admitted);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      yield* Fiber.join(admission);
      assert.deepEqual(order, ["first:prepare", "first:remote", "second:prepare", "second:remote"]);
      assert.isTrue(admitted);
    }),
);

it.effect("keeps different Thread settings transactions independent", () =>
  Effect.gen(function* () {
    const releaseFirst = yield* Deferred.make<void>();
    const service = yield* runtime({
      prepare: (input) =>
        input.threadId === "thread-1"
          ? Deferred.await(releaseFirst).pipe(Effect.as(prepared(input)))
          : Effect.succeed(prepared(input)),
    });
    const first = yield* Effect.forkChild(
      service.update({ threadId: "thread-1", patch: { model: "first" } }),
    );
    assert.strictEqual(
      (yield* service.update({ threadId: "thread-2", patch: { model: "independent" } })).model,
      "independent",
    );
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
  }),
);

it.effect("releases a Thread lane after preparation failure and propagates interruption", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    let interrupted = false;
    let attempts = 0;
    const service = yield* runtime({
      prepare: (input) => {
        attempts += 1;
        if (attempts === 1) {
          return Effect.fail(
            new CodexThreadSettingsOperationError({
              operation: "prepare-update",
              threadId: input.threadId,
              cause: new Error("invalid settings"),
            }),
          );
        }
        return Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        );
      },
    });
    const failure = yield* service
      .update({ threadId: "thread-1", patch: { model: "invalid" } })
      .pipe(Effect.flip);
    assert.instanceOf(failure, CodexThreadSettingsOperationError);

    const pending = yield* Effect.forkChild(
      service.update({ threadId: "thread-1", patch: { model: "pending" } }),
    );
    yield* Deferred.await(started);
    yield* Fiber.interrupt(pending);
    assert.isTrue(interrupted);
  }),
);

it.effect(
  "contains unloaded and unsupported remote updates while keeping capability monotonic",
  () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const service = yield* runtime({ prepare: (input) => Effect.succeed(prepared(input)) }, ((
        _threadId,
        _method,
        params,
      ) => {
        const model = String((params as { model?: unknown }).model);
        requests.push(model);
        if (model === "missing") {
          return Effect.fail(
            codexRuntimeError({
              operation: "settings-test",
              reason: "request",
              retryable: false,
              cause: new CodexAppServerRequestError({
                code: -32603,
                errorMessage: "Thread not found",
              }),
            }),
          );
        }
        return Effect.fail(
          codexRuntimeError({
            operation: "settings-test",
            reason: "request",
            retryable: false,
            cause: CodexAppServerRequestError.methodNotFound("thread/settings/update"),
          }),
        );
      }) as CodexGateway["Service"]["requestForThread"]);

      assert.strictEqual(
        (yield* service.update({ threadId: "thread-1", patch: { model: "missing" } })).model,
        "missing",
      );
      assert.strictEqual(service.remoteUpdateSupport(), "unknown");
      assert.strictEqual(
        (yield* service.update({ threadId: "thread-1", patch: { model: "unsupported" } })).model,
        "unsupported",
      );
      assert.strictEqual(service.remoteUpdateSupport(), "unsupported");
      assert.strictEqual(
        (yield* service.update({ threadId: "thread-1", patch: { model: "local-only" } })).model,
        "local-only",
      );
      assert.deepEqual(requests, ["missing", "unsupported"]);
      service.recordRemoteUpdateSupported();
      assert.strictEqual(service.remoteUpdateSupport(), "unsupported");
    }),
);
