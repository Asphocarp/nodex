import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import type { CodexRendererConversationResumeResult } from "../../shared/types";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";
import {
  type CodexFreshThreadLaunch,
  CodexFreshThreadLaunchError,
  type CodexFreshThreadLaunchIdentity,
  make,
} from "./CodexFreshThreadLaunchRuntime";

type AdoptionResult = Extract<CodexRendererConversationResumeResult, { readonly role: "owner" }>;

const launch = (threadId = "thread-1"): CodexFreshThreadLaunch =>
  ({
    launchId: `launch-${threadId}`,
    rendererClientId: "renderer-1",
    projectId: "project-1",
    sessionId: "session-1",
    threadId,
    runInTarget: "localProject",
    startedAt: 1,
    clientUserMessageId: "message-1",
    canonicalParams: {},
    turnStartParams: { threadId, input: [], attachments: [] },
    verifiedBuiltinFullAccess: false,
    goalObjective: "",
    rawGoalDraft: null,
    heartbeatAutomation: null,
  }) as unknown as CodexFreshThreadLaunch;

const identity = (threadId = "thread-1"): CodexFreshThreadLaunchIdentity => ({
  launchId: `launch-${threadId}`,
  ownerClientId: "renderer-1",
  threadId,
});

const adoption = (threadId = "thread-1"): AdoptionResult =>
  ({ role: "owner", conversation: { threadId } }) as AdoptionResult;

const turnStart = (turnId = "turn-1"): TurnStartResponse =>
  ({ turn: { id: turnId, status: "inProgress", items: [] } }) as unknown as TurnStartResponse;

interface TestRuntimeOptions {
  readonly adopt: (
    launch: CodexFreshThreadLaunch,
  ) => Effect.Effect<AdoptionResult, CodexFreshThreadLaunchError>;
  readonly readAdopted: (
    launch: CodexFreshThreadLaunch,
  ) => Effect.Effect<AdoptionResult, CodexFreshThreadLaunchError>;
  readonly start: (launch: CodexFreshThreadLaunch) => Effect.Effect<TurnStartResponse>;
  readonly beginStart?: () => Effect.Effect<void, CodexFreshThreadLaunchError>;
  readonly commitStart?: (
    response: TurnStartResponse,
  ) => Effect.Effect<TurnStartResponse, CodexFreshThreadLaunchError>;
  readonly finishStart?: (
    response: TurnStartResponse,
  ) => Effect.Effect<TurnStartResponse, CodexFreshThreadLaunchError>;
  readonly rollbackStart?: (cause: unknown) => Effect.Effect<void>;
  readonly abandon: (launch: CodexFreshThreadLaunch, reason: unknown) => void;
}

const makeTestRuntime = (options: TestRuntimeOptions) => {
  const preparedLaunches = new Map<string, CodexFreshThreadLaunch>();
  const gateway = CodexGateway.of({
    localHostId: "local",
    requestForThread: ((threadId: string) => {
      const preparedLaunch = preparedLaunches.get(threadId);
      if (!preparedLaunch) return Effect.die("fresh launch was not prepared");
      return options.start(preparedLaunch);
    }) as unknown as CodexGateway["Service"]["requestForThread"],
  } as CodexGateway["Service"]);
  const conversations = ConversationRuntimeMap.of({
    runExclusive: (_threadId, operation) => operation,
  } as ConversationRuntimeMap["Service"]);
  const projectLifecycle = ProjectRuntimeLifecycleRuntime.of({
    runExclusive: (_projectId, operation) => operation,
  });

  return make({
    adopt: options.adopt,
    readAdopted: options.readAdopted,
    prepareStart: (entry) =>
      Effect.sync(() => {
        preparedLaunches.set(entry.threadId, entry);
        return {
          launchId: entry.launchId,
          ownerClientId: entry.rendererClientId,
          projectId: entry.projectId,
          threadId: entry.threadId,
          request: entry.turnStartParams,
          state: {},
        };
      }),
    beginStart: () => options.beginStart?.() ?? Effect.void,
    commitStart: (_prepared, response) =>
      options.commitStart?.(response) ?? Effect.succeed(response),
    finishStart: (_prepared, response) =>
      options.finishStart?.(response) ?? Effect.succeed(response),
    rollbackStart: (_prepared, cause) => options.rollbackStart?.(cause) ?? Effect.void,
    abandon: options.abandon,
  }).pipe(
    Effect.provideService(CodexGateway, gateway),
    Effect.provideService(ConversationRuntimeMap, conversations),
    Effect.provideService(ProjectRuntimeLifecycleRuntime, projectLifecycle),
  );
};

it.effect("coalesces exact adoption and serves later idempotent reads", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    let physicalAdoptions = 0;
    let reads = 0;
    const runtime = yield* makeTestRuntime({
      adopt: (entry) => {
        physicalAdoptions += 1;
        return Deferred.await(release).pipe(Effect.as(adoption(entry.threadId)));
      },
      readAdopted: (entry) => {
        reads += 1;
        return Effect.succeed(adoption(entry.threadId));
      },
      start: () => Effect.succeed(turnStart()),
      abandon: () => {},
    });
    runtime.register(launch());
    const first = yield* Effect.forkChild(runtime.adopt(identity()), { startImmediately: true });
    const second = yield* Effect.forkChild(runtime.adopt(identity()), { startImmediately: true });
    yield* Effect.yieldNow;
    assert.strictEqual(physicalAdoptions, 1);
    assert.strictEqual(runtime.reservation("thread-1")?.state, "adopting");
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    assert.strictEqual(runtime.reservation("thread-1")?.state, "adopted");

    yield* runtime.adopt(identity());
    assert.strictEqual(reads, 1);
  }),
);

it.effect("coalesces the exact first-turn start and consumes the launch after completion", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    let physicalStarts = 0;
    const runtime = yield* makeTestRuntime({
      adopt: (entry) => Effect.succeed(adoption(entry.threadId)),
      readAdopted: (entry) => Effect.succeed(adoption(entry.threadId)),
      start: () => {
        physicalStarts += 1;
        return Deferred.await(release).pipe(Effect.as(turnStart()));
      },
      abandon: () => {},
    });
    runtime.register(launch());
    yield* runtime.adopt(identity());
    const first = yield* Effect.forkChild(runtime.start(identity()), { startImmediately: true });
    const second = yield* Effect.forkChild(runtime.start(identity()), { startImmediately: true });
    yield* Effect.yieldNow;
    assert.strictEqual(physicalStarts, 1);
    assert.strictEqual(runtime.reservation("thread-1")?.state, "starting");
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    assert.isNull(runtime.reservation("thread-1"));
    assert.strictEqual((yield* runtime.start(identity()).pipe(Effect.result))._tag, "Failure");
  }),
);

it.effect("does not roll back a protocol commit when downstream completion fails", () =>
  Effect.gen(function* () {
    let rollbacks = 0;
    const runtime = yield* makeTestRuntime({
      adopt: (entry) => Effect.succeed(adoption(entry.threadId)),
      readAdopted: (entry) => Effect.succeed(adoption(entry.threadId)),
      start: () => Effect.succeed(turnStart()),
      finishStart: () =>
        Effect.fail(
          new CodexFreshThreadLaunchError("operation-failed", identity(), {
            cause: new Error("downstream projection failed"),
          }),
        ),
      rollbackStart: () =>
        Effect.sync(() => {
          rollbacks += 1;
        }),
      abandon: () => {},
    });
    runtime.register(launch());
    yield* runtime.adopt(identity());

    const result = yield* runtime.start(identity()).pipe(Effect.result);

    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(rollbacks, 0);
    assert.isNull(runtime.reservation("thread-1"));
  }),
);

it.effect("a first-turn request waits for an active adoption before starting", () =>
  Effect.gen(function* () {
    const releaseAdoption = yield* Deferred.make<void>();
    const order: string[] = [];
    const runtime = yield* makeTestRuntime({
      adopt: (entry) =>
        Deferred.await(releaseAdoption).pipe(
          Effect.tap(() => Effect.sync(() => order.push("adopt"))),
          Effect.as(adoption(entry.threadId)),
        ),
      readAdopted: (entry) => Effect.succeed(adoption(entry.threadId)),
      start: () => Effect.sync(() => order.push("start")).pipe(Effect.as(turnStart())),
      abandon: () => {},
    });
    runtime.register(launch());
    const adopting = yield* Effect.forkChild(runtime.adopt(identity()), { startImmediately: true });
    const starting = yield* Effect.forkChild(runtime.start(identity()), { startImmediately: true });
    yield* Effect.yieldNow;
    assert.deepEqual(order, []);
    yield* Deferred.succeed(releaseAdoption, undefined);
    yield* Fiber.join(adopting);
    yield* Fiber.join(starting);
    assert.deepEqual(order, ["adopt", "start"]);
  }),
);

it.effect("renderer release abandons only launches that have not started", () =>
  Effect.gen(function* () {
    const releaseStart = yield* Deferred.make<void>();
    const abandoned: string[] = [];
    const runtime = yield* makeTestRuntime({
      adopt: (entry) => Effect.succeed(adoption(entry.threadId)),
      readAdopted: (entry) => Effect.succeed(adoption(entry.threadId)),
      start: () => Deferred.await(releaseStart).pipe(Effect.as(turnStart())),
      abandon: (entry) => abandoned.push(entry.threadId),
    });
    runtime.register(launch("prepared"));
    runtime.register(launch("starting"));
    yield* runtime.adopt(identity("starting"));
    const start = yield* Effect.forkChild(runtime.start(identity("starting")), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;

    runtime.releaseRenderer("renderer-1", new Error("renderer closed"));

    assert.deepEqual(abandoned, ["prepared"]);
    assert.isNull(runtime.reservation("prepared"));
    assert.strictEqual(runtime.reservation("starting")?.state, "starting");
    yield* Deferred.succeed(releaseStart, undefined);
    yield* Fiber.join(start);
  }),
);

it.effect("Main Scope close interrupts an active first-turn launch", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    let rollbacks = 0;
    const runtime = yield* makeTestRuntime({
      adopt: (entry) => Effect.succeed(adoption(entry.threadId)),
      readAdopted: (entry) => Effect.succeed(adoption(entry.threadId)),
      start: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      rollbackStart: () =>
        Effect.sync(() => {
          rollbacks += 1;
        }),
      abandon: () => {},
    }).pipe(Effect.provideService(Scope.Scope, ownerScope));
    runtime.register(launch());
    yield* runtime.adopt(identity());
    const fiber = yield* Effect.forkChild(runtime.start(identity()), { startImmediately: true });
    yield* Deferred.await(started);

    yield* Scope.close(ownerScope, Exit.void);

    assert.isNull(runtime.reservation("thread-1"));
    assert.strictEqual((yield* Fiber.await(fiber))._tag, "Failure");
    assert.strictEqual(rollbacks, 1);
  }),
);

it.effect("rejects an exact start before adoption", () =>
  Effect.gen(function* () {
    const runtime = yield* makeTestRuntime({
      adopt: (entry) => Effect.succeed(adoption(entry.threadId)),
      readAdopted: (entry) => Effect.succeed(adoption(entry.threadId)),
      start: () => Effect.succeed(turnStart()),
      abandon: () => {},
    });
    runtime.register(launch());
    const result = yield* runtime.start(identity()).pipe(Effect.result);
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.instanceOf(result.failure, CodexFreshThreadLaunchError);
      assert.strictEqual(result.failure.reason, "not-adopted");
    }
  }),
);
