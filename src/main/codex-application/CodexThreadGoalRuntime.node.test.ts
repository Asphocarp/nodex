import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2/ThreadGoal";
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
  CodexThreadGoalRuntime,
  live,
  type CodexThreadGoalProjectionPort,
  type CodexThreadGoalRuntimeOptions,
} from "./CodexThreadGoalRuntime";

const threadId = "thread-goal-runtime";

const goal = (overrides: Partial<ThreadGoal> = {}): ThreadGoal => ({
  threadId,
  objective: "Ship the application kernel",
  status: "active",
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

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

const build = Effect.fn("CodexThreadGoalRuntimeTest.build")(function* (
  options: CodexThreadGoalRuntimeOptions,
  request: CodexGateway["Service"]["requestForThread"],
  scope: Scope.Scope,
) {
  const context = yield* Layer.buildWithScope(
    live(options).pipe(Layer.provide(Layer.succeed(CodexGateway, gateway(request)))),
    scope,
  );
  return Context.get(context, CodexThreadGoalRuntime);
});

it.effect(
  "normalizes goal commands and projects accepted goals without leaking local metadata",
  () =>
    Effect.gen(function* () {
      const requests: Array<Record<string, unknown>> = [];
      const projections: Parameters<CodexThreadGoalProjectionPort["applySet"]>[0][] = [];
      const scope = yield* Scope.make();
      const runtime = yield* build(
        {
          projection: { applySet: (input) => projections.push(input) },
          updateSettings: () => Effect.void,
        },
        ((_threadId, method, params) => {
          assert.strictEqual(method, "thread/goal/set");
          requests.push(params as Record<string, unknown>);
          return Effect.succeed({
            goal: goal({
              objective:
                typeof (params as { objective?: unknown }).objective === "string"
                  ? (params as { objective: string }).objective
                  : "Existing objective",
              status: (params as { status?: ThreadGoal["status"] }).status ?? ("active" as const),
            }),
          });
        }) as CodexGateway["Service"]["requestForThread"],
        scope,
      );

      yield* runtime.set({
        threadId,
        status: "paused",
        dismissResumeConfirmation: true,
      });
      yield* runtime.set({
        threadId,
        objective: "Ship parity",
        appendTranscriptItem: false,
      });

      assert.deepEqual(requests, [
        { threadId, status: "paused" },
        { threadId, objective: "Ship parity", status: "active" },
      ]);
      assert.deepEqual(
        projections.map(({ appendTranscriptItem, dismissResumeConfirmation, objective }) => ({
          appendTranscriptItem,
          dismissResumeConfirmation,
          objective,
        })),
        [
          { appendTranscriptItem: true, dismissResumeConfirmation: true, objective: null },
          {
            appendTranscriptItem: false,
            dismissResumeConfirmation: false,
            objective: "Ship parity",
          },
        ],
      );

      yield* Scope.close(scope, Exit.void);
    }),
);

it.effect("orders next-turn settings before the goal command and propagates interruption", () =>
  Effect.gen(function* () {
    const settingsStarted = yield* Deferred.make<void>();
    const releaseSettings = yield* Deferred.make<void>();
    let settingsInterrupted = false;
    let goalRequested = false;
    const scope = yield* Scope.make();
    const runtime = yield* build(
      {
        projection: { applySet: () => undefined },
        updateSettings: () =>
          Deferred.succeed(settingsStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseSettings)),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                settingsInterrupted = true;
              }),
            ),
          ),
      },
      (() => {
        goalRequested = true;
        return Effect.succeed({ goal: goal() });
      }) as CodexGateway["Service"]["requestForThread"],
      scope,
    );
    const fiber = yield* Effect.forkChild(
      runtime.set({
        threadId,
        objective: "Wait for settings",
        threadSettings: { model: "gpt-5.6", reasoningEffort: "high" },
      }),
    );
    yield* Deferred.await(settingsStarted);
    assert.isFalse(goalRequested);
    yield* Fiber.interrupt(fiber);
    assert.isTrue(settingsInterrupted);
    assert.isFalse(goalRequested);

    const completed = yield* Effect.forkChild(
      runtime.set({
        threadId,
        objective: "Apply settings first",
        threadSettings: { model: "gpt-5.6" },
      }),
    );
    yield* Deferred.await(settingsStarted);
    yield* Deferred.succeed(releaseSettings, undefined);
    yield* Fiber.join(completed);
    assert.isTrue(goalRequested);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("shares typed get/load/clear routing and contains resume hydration failure", () =>
  Effect.gen(function* () {
    const requests: string[] = [];
    let failRead = false;
    const failure = codexRuntimeError({
      operation: "thread-goal-test",
      reason: "request",
      retryable: false,
    });
    const scope = yield* Scope.make();
    const runtime = yield* build(
      {
        projection: { applySet: () => undefined },
        updateSettings: () => Effect.void,
      },
      ((_threadId, method) => {
        requests.push(method);
        if (method === "thread/goal/get") {
          return failRead ? Effect.fail(failure) : Effect.succeed({ goal: goal() });
        }
        if (method === "thread/goal/clear") return Effect.succeed({});
        return Effect.die(new Error(`Unexpected request: ${method}`));
      }) as CodexGateway["Service"]["requestForThread"],
      scope,
    );

    assert.strictEqual((yield* runtime.get(threadId))?.objective, "Ship the application kernel");
    yield* runtime.clear(threadId);
    failRead = true;
    assert.deepEqual(yield* runtime.load(threadId), { ok: false, goal: null });
    assert.deepEqual(requests, ["thread/goal/get", "thread/goal/clear", "thread/goal/get"]);

    yield* Scope.close(scope, Exit.void);
  }),
);
