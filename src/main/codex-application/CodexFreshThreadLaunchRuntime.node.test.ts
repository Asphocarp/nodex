import { assert, it } from "@effect/vitest";
import type { TurnStartResponse } from "@nodex/codex-app-server-protocol/v2/TurnStartResponse";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type { CodexConversationSnapshot } from "../../shared/types";
import { makeCodexConversationAggregateRegistry } from "./CodexConversationAggregate";
import {
  make,
  type CodexFreshThreadLaunch,
  type CodexFreshThreadLaunchIdentity,
} from "./CodexFreshThreadLaunchRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { makeCodexRendererConversationRegistryState } from "./CodexRendererConversationRegistry";
import { CodexThreadLaunchCompletion } from "./CodexThreadLaunchCompletion";
import { CodexTurnCommands } from "./CodexTurnCommands";

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
  readonly rollback?: () => void;
}

const makeHarness = (options: HarnessOptions = {}) => {
  const aggregates = makeCodexConversationAggregateRegistry();
  const registry = makeCodexRendererConversationRegistryState();
  const snapshot = {
    threadId: identity.threadId,
    resumeState: "resumed",
    requests: [],
    queuedFollowUps: [],
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
  const turns = CodexTurnCommands.of({
    acceptPreparedRendererTurn: () =>
      (options.start ?? Effect.succeed(turnStart())).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Effect.sync(() => options.rollback?.()) : Effect.void,
        ),
      ),
  } as unknown as CodexTurnCommands["Service"]);
  const completion = CodexThreadLaunchCompletion.of({
    accepted: () => Effect.void,
    failed: () => undefined,
  });
  const runtime = make.pipe(
    Effect.provideService(CodexRendererConversationCoordinator, coordinator),
    Effect.provideService(CodexThreadLaunchCompletion, completion),
    Effect.provideService(CodexTurnCommands, turns),
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
