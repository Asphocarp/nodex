import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type { CodexConversationSnapshot } from "../../shared/types";
import { makeCodexConversationAggregateRegistry } from "./CodexConversationAggregate";
import {
  CodexConversationResumeError,
  make,
  type CodexConversationResumeRuntimeOptions,
} from "./CodexConversationResumeRuntime";
import { CodexFreshThreadLaunchRuntime } from "./CodexFreshThreadLaunchRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import {
  CodexRendererConversationRegistry,
  makeCodexRendererConversationRegistryState,
} from "./CodexRendererConversationRegistry";

const conversation = (threadId = "thread-1"): CodexConversationSnapshot =>
  ({ threadId, resumeState: "resumed", requests: [] }) as unknown as CodexConversationSnapshot;

const makeRuntime = (options: Partial<CodexConversationResumeRuntimeOptions> = {}) => {
  const aggregates = makeCodexConversationAggregateRegistry();
  const registry = makeCodexRendererConversationRegistryState();
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
      Effect.sync(() => {
        const owner = registry.setOwner(input.conversationId, input.ownerClientId);
        if (!owner) return { checkpoint: null, ownerClientId: null, revision: 0 };
        const aggregate = aggregates.acquire(input.conversationId);
        aggregate.setStreamRole("owner");
        const before = aggregate.read();
        if (!before.acceptedReplica) {
          aggregate.acceptReplica({
            conversation: input.conversation,
            revision: before.revision,
            ownerEpoch: owner.ownerEpoch,
          });
        }
        const after = aggregate.read();
        return {
          checkpoint: after.acceptedReplica?.checkpoint ?? null,
          ownerClientId: registry.getOwnerClientId(input.conversationId),
          revision: after.revision,
        };
      }),
  } as CodexRendererConversationCoordinator["Service"]);
  const fresh = CodexFreshThreadLaunchRuntime.of({
    register: () => undefined,
    reservation: () => null,
    adopt: () => Effect.die("unused"),
    start: () => Effect.die("unused"),
    releaseRenderer: () => undefined,
    clear: () => undefined,
  });
  const runtime = make({
    run: options.run ?? (() => Effect.succeed(null)),
    snapshot: options.snapshot ?? (() => Effect.succeed(null)),
    releaseBuffer: options.releaseBuffer ?? (() => Effect.succeed(true)),
    observe: options.observe,
  }).pipe(
    Effect.provideService(CodexFreshThreadLaunchRuntime, fresh),
    Effect.provideService(CodexRendererConversationCoordinator, coordinator),
    Effect.provideService(CodexRendererConversationRegistry, registry),
  );
  return { aggregates, registry, runtime };
};

it.effect("coalesces identical canonical resume demand", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    let physicalRuns = 0;
    const { runtime } = makeRuntime({
      run: () => {
        physicalRuns += 1;
        return Deferred.await(release).pipe(Effect.as(null));
      },
    });
    const service = yield* runtime;
    const first = yield* Effect.forkChild(service.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(service.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.strictEqual(physicalRuns, 1);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
  }),
);

it.effect("serializes renderer adoption so a racing client becomes a follower", () =>
  Effect.gen(function* () {
    const snapshot = conversation();
    const harness = makeRuntime({
      run: () => Effect.succeed(snapshot),
      snapshot: () => Effect.succeed(snapshot),
    });
    harness.aggregates
      .acquire(snapshot.threadId)
      .acceptReplica({ conversation: snapshot, revision: 1, ownerEpoch: 0 });
    const service = yield* harness.runtime;
    const first = yield* Effect.forkChild(service.resumeForRenderer(snapshot.threadId, "owner-a"), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(
      service.resumeForRenderer(snapshot.threadId, "owner-b"),
      {
        startImmediately: true,
      },
    );
    const owner = yield* Fiber.join(first);
    const follower = yield* Fiber.join(second);
    assert.strictEqual(owner?.role, "owner");
    assert.strictEqual(follower?.role, "follower");
    if (follower?.role === "follower") assert.strictEqual(follower.ownerClientId, "owner-a");
  }),
);

it.effect("interrupts physical resume work when the owning Scope closes", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const { runtime } = makeRuntime({
      run: () => Effect.never as Effect.Effect<never, CodexConversationResumeError>,
    });
    const service = yield* runtime.pipe(Effect.provideService(Scope.Scope, ownerScope));
    const fiber = yield* Effect.forkChild(service.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual((yield* Fiber.await(fiber))._tag, "Failure");
  }),
);
