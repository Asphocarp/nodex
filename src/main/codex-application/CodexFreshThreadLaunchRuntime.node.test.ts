import { assert, it } from "@effect/vitest";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { makeCodexConversationAggregateRegistry } from "./CodexConversationAggregate";
import {
  CodexFreshThreadLaunchError,
  make,
  type CodexFreshThreadLaunch,
  type CodexFreshThreadLaunchIdentity,
} from "./CodexFreshThreadLaunchRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { makeCodexRendererConversationRegistryState } from "./CodexRendererConversationRegistry";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

const launch = (): CodexFreshThreadLaunch =>
  ({
    launchId: "launch-1",
    rendererClientId: "renderer-1",
    projectId: "project-1",
    sessionId: "session-1",
    threadId: "thread-1",
    runInTarget: "localProject",
    startedAt: 1,
    clientUserMessageId: "message-1",
    canonicalParams: {},
    turnStartParams: { threadId: "thread-1", input: [], attachments: [] },
    verifiedBuiltinFullAccess: false,
    goalObjective: "",
    rawGoalDraft: null,
    heartbeatAutomation: null,
  }) as unknown as CodexFreshThreadLaunch;

const identity: CodexFreshThreadLaunchIdentity = {
  launchId: "launch-1",
  ownerClientId: "renderer-1",
  threadId: "thread-1",
};

const turnStart = (): TurnStartResponse =>
  ({ turn: { id: "turn-1", status: "inProgress", items: [] } }) as unknown as TurnStartResponse;

interface HarnessOptions {
  readonly beforeAdopt?: Effect.Effect<void>;
  readonly start?: Effect.Effect<TurnStartResponse>;
  readonly finish?: (
    response: TurnStartResponse,
  ) => Effect.Effect<TurnStartResponse, CodexFreshThreadLaunchError>;
  readonly rollback?: () => void;
}

const makeHarness = (options: HarnessOptions = {}) => {
  const aggregates = makeCodexConversationAggregateRegistry();
  const registry = makeCodexRendererConversationRegistryState();
  const snapshot = {
    threadId: identity.threadId,
    resumeState: "resumed",
    requests: [],
  } as unknown as CodexConversationSnapshot;
  aggregates
    .acquire(identity.threadId)
    .acceptReplica({ conversation: snapshot, revision: 1, ownerEpoch: 0 });
  let adoptionCalls = 0;
  const coordinator = CodexRendererConversationCoordinator.of({
    readRendererState: (threadId) => {
      const state = aggregates.current(threadId)?.read();
      return {
        acceptedConversation: state?.acceptedReplica?.conversation ?? null,
        checkpoint: state?.acceptedReplica?.checkpoint ?? null,
        ownerClientId: registry.getOwnerClientId(threadId),
        resumeState: state?.acceptedReplica?.conversation.resumeState ?? null,
        revision: state?.revision ?? 0,
      };
    },
    adoptRendererOwner: (input) =>
      (options.beforeAdopt ?? Effect.void).pipe(
        Effect.map(() => {
          adoptionCalls += 1;
          registry.setOwner(input.conversationId, input.ownerClientId);
          const state = aggregates.acquire(input.conversationId).read();
          return {
            checkpoint: state.acceptedReplica?.checkpoint ?? null,
            ownerClientId: registry.getOwnerClientId(input.conversationId),
            revision: state.revision,
          };
        }),
      ),
  } as CodexRendererConversationCoordinator["Service"]);
  const gateway = CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
    events: Stream.empty,
    requestForThread: (() =>
      options.start ?? Effect.succeed(turnStart())) as CodexGateway["Service"]["requestForThread"],
  } as unknown as CodexGateway["Service"]);
  const conversations = ConversationRuntimeMap.of({
    conversation: aggregates.acquire,
    currentConversation: aggregates.current,
    requests: Stream.empty,
    runtime: () => Effect.die("unused"),
    runExclusive: (_threadId, operation) => operation,
    close: () => Effect.void,
  });
  const projectLifecycle = ProjectRuntimeLifecycleRuntime.of({
    runExclusive: (_projectId, operation) => operation,
  });
  const runtime = make({
    prepareStart: (entry) =>
      Effect.sync(() => {
        return {
          launchId: entry.launchId,
          ownerClientId: entry.rendererClientId,
          projectId: entry.projectId,
          threadId: entry.threadId,
          request: entry.turnStartParams,
          state: {},
        };
      }),
    beginStart: () => Effect.void,
    commitStart: (_prepared, response) => Effect.succeed(response),
    finishStart: (_prepared, response) => options.finish?.(response) ?? Effect.succeed(response),
    rollbackStart: () =>
      Effect.sync(() => {
        options.rollback?.();
      }),
    abandon: () => undefined,
  }).pipe(
    Effect.provideService(CodexGateway, gateway),
    Effect.provideService(CodexRendererConversationCoordinator, coordinator),
    Effect.provideService(ConversationRuntimeMap, conversations),
    Effect.provideService(ProjectRuntimeLifecycleRuntime, projectLifecycle),
  );
  return { adoptionCalls: () => adoptionCalls, runtime };
};

it.effect("single-flights renderer adoption and the first Turn start", () =>
  Effect.gen(function* () {
    const releaseAdoption = yield* Deferred.make<void>();
    const releaseStart = yield* Deferred.make<void>();
    let starts = 0;
    const harness = makeHarness({
      beforeAdopt: Deferred.await(releaseAdoption),
      start: Effect.sync(() => {
        starts += 1;
      }).pipe(Effect.andThen(Deferred.await(releaseStart)), Effect.as(turnStart())),
    });
    const service = yield* harness.runtime;
    service.register(launch());
    const firstAdoption = yield* Effect.forkChild(service.adopt(identity), {
      startImmediately: true,
    });
    const secondAdoption = yield* Effect.forkChild(service.adopt(identity), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    yield* Deferred.succeed(releaseAdoption, undefined);
    yield* Fiber.join(firstAdoption);
    yield* Fiber.join(secondAdoption);
    assert.strictEqual(harness.adoptionCalls(), 1);

    const firstStart = yield* Effect.forkChild(service.start(identity), { startImmediately: true });
    const secondStart = yield* Effect.forkChild(service.start(identity), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.strictEqual(starts, 1);
    yield* Deferred.succeed(releaseStart, undefined);
    yield* Fiber.join(firstStart);
    yield* Fiber.join(secondStart);
    assert.isNull(service.reservation(identity.threadId));
  }),
);

it.effect("does not roll back an accepted Turn when downstream completion fails", () =>
  Effect.gen(function* () {
    let rollbacks = 0;
    const harness = makeHarness({
      finish: () =>
        Effect.fail(
          new CodexFreshThreadLaunchError("operation-failed", identity, {
            cause: new Error("projection failed"),
          }),
        ),
      rollback: () => {
        rollbacks += 1;
      },
    });
    const service = yield* harness.runtime;
    service.register(launch());
    yield* service.adopt(identity);
    assert.strictEqual((yield* service.start(identity).pipe(Effect.result))._tag, "Failure");
    assert.strictEqual(rollbacks, 0);
  }),
);

it.effect("interrupts an active first Turn when the owning Scope closes", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    let rollbacks = 0;
    const harness = makeHarness({
      start: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      rollback: () => {
        rollbacks += 1;
      },
    });
    const service = yield* harness.runtime.pipe(Effect.provideService(Scope.Scope, ownerScope));
    service.register(launch());
    yield* service.adopt(identity);
    const fiber = yield* Effect.forkChild(service.start(identity), { startImmediately: true });
    yield* Deferred.await(started);
    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual((yield* Fiber.await(fiber))._tag, "Failure");
    assert.strictEqual(rollbacks, 1);
  }),
);
