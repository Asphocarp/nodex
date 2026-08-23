import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexApplicationProtocol } from "./CodexApplicationProtocol";
import { CodexConversationHistoryRuntime } from "./CodexConversationHistoryRuntime";
import { CodexFreshThreadLaunchRuntime } from "./CodexFreshThreadLaunchRuntime";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexPostResumeGoalRuntime } from "./CodexPostResumeGoalRuntime";
import { make } from "./CodexConversationResumeRuntime";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import {
  CodexRendererConversationRegistry,
  makeCodexRendererConversationRegistryState,
} from "./CodexRendererConversationRegistry";
import {
  CodexThreadDirectory,
  type CodexThreadDirectoryEntry,
  type CodexThreadDirectoryFidelity,
} from "./CodexThreadDirectory";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

const threadId = "thread-resume";
const conversation = (): CodexConversationSnapshot =>
  ({
    threadId,
    resumeState: "resumed",
    requests: [],
    queuedFollowUps: [],
  }) as unknown as CodexConversationSnapshot;

const entry = (
  snapshot: CodexConversationSnapshot | null,
  fidelity: CodexThreadDirectoryFidelity,
): CodexThreadDirectoryEntry =>
  ({
    fidelity,
    durable: { threadId, archived: false } as CodexThreadDirectoryEntry["durable"],
    summary: { threadId } as CodexThreadDirectoryEntry["summary"],
    canonical: null,
    snapshot,
  }) as CodexThreadDirectoryEntry;

const build = Effect.fn("CodexConversationResumeRuntimeTest.build")(function* (
  scope: Scope.Scope,
  resolve: CodexThreadDirectory["Service"]["resolve"],
) {
  const context = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
  const conversations = Context.get(context, ConversationRuntimeMap);
  const registry = makeCodexRendererConversationRegistryState();
  const buffers = new Set<string>();
  const directory = CodexThreadDirectory.of({ resolve } as CodexThreadDirectory["Service"]);
  const protocol = CodexApplicationProtocol.of({
    interpret: () => Effect.void,
    observe: () => Effect.void,
    beginResume: (id) => {
      if (buffers.has(id)) return false;
      buffers.add(id);
      return true;
    },
    hasResume: (id) => buffers.has(id),
    releaseResume: (id) => Effect.sync(() => void buffers.delete(id)),
    discardResume: (id) => Effect.sync(() => void buffers.delete(id)),
    beginThreadStartDeferral: () => undefined,
    completeThreadStartDeferral: () => Effect.void,
    endThreadStartDeferral: Effect.void,
    clearConversationBuffer: () => Effect.void,
  });
  const coordinator = CodexRendererConversationCoordinator.of({
    readRendererState: (id: string) => {
      const state = conversations.currentConversation(id)?.read();
      return {
        acceptedConversation: state?.acceptedReplica?.conversation ?? null,
        checkpoint: state?.acceptedReplica?.checkpoint ?? null,
        ownerClientId: registry.getOwnerClientId(id),
        resumeState: state?.acceptedReplica?.conversation.resumeState ?? null,
        revision: state?.revision ?? 0,
      };
    },
    adoptRendererOwner: (
      input: Parameters<CodexRendererConversationCoordinator["Service"]["adoptRendererOwner"]>[0],
    ) =>
      Effect.sync(() => {
        const owner = registry.setOwner(input.conversationId, input.ownerClientId);
        if (!owner) return { checkpoint: null, ownerClientId: null, revision: 0 };
        const aggregate = conversations.conversation(input.conversationId);
        aggregate.setStreamRole("owner");
        if (!aggregate.read().acceptedReplica) {
          aggregate.acceptReplica({
            conversation: input.conversation,
            revision: aggregate.read().revision,
            ownerEpoch: owner.ownerEpoch,
          });
        }
        const state = aggregate.read();
        return {
          checkpoint: state.acceptedReplica?.checkpoint ?? null,
          ownerClientId: registry.getOwnerClientId(input.conversationId),
          revision: state.revision,
        };
      }),
    reconcileOwnership: () => undefined,
  } as unknown as CodexRendererConversationCoordinator["Service"]);
  const runtime = yield* make.pipe(
    Effect.provideService(CodexApplicationProtocol, protocol),
    Effect.provideService(
      CodexConversationHistoryRuntime,
      CodexConversationHistoryRuntime.of({
        loadPage: () => Effect.succeed(null),
        loadComplete: () => Effect.succeed(null),
        requestRemaining: () => undefined,
        clear: () => undefined,
      }),
    ),
    Effect.provideService(
      CodexFreshThreadLaunchRuntime,
      CodexFreshThreadLaunchRuntime.of({
        register: () => undefined,
        reservation: () => null,
        adopt: () => Effect.die("unused"),
        start: () => Effect.die("unused"),
        releaseRenderer: () => undefined,
        clear: () => undefined,
      }),
    ),
    Effect.provideService(
      CodexOwnerNotificationDrainRuntime,
      CodexOwnerNotificationDrainRuntime.of({
        next: () => 1,
        ack: () => undefined,
        awaitCurrent: () => Effect.void,
        resetOwner: () => undefined,
        release: () => undefined,
        clear: () => undefined,
      }),
    ),
    Effect.provideService(
      CodexPostResumeGoalRuntime,
      CodexPostResumeGoalRuntime.of({
        hydrate: () => Effect.void,
        request: () => undefined,
        defer: () => undefined,
        release: () => false,
        clear: () => undefined,
      }),
    ),
    Effect.provideService(CodexRendererConversationCoordinator, coordinator),
    Effect.provideService(CodexRendererConversationRegistry, registry),
    Effect.provideService(CodexThreadDirectory, directory),
    Effect.provideService(ConversationRuntimeMap, conversations),
    Effect.provideService(Scope.Scope, scope),
  );
  return { conversations, runtime };
});

it.effect("coalesces identical canonical resume demand", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const release = yield* Deferred.make<void>();
    let physicalRuns = 0;
    const harness = yield* build(scope, ({ fidelity }) => {
      if (fidelity === "durable") return Effect.succeed(null);
      physicalRuns += 1;
      return Deferred.await(release).pipe(Effect.as(null));
    });
    const first = yield* harness.runtime.resume({ threadId }).pipe(Effect.forkChild);
    const second = yield* harness.runtime.resume({ threadId }).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    assert.strictEqual(physicalRuns, 1);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("serializes renderer adoption so a racing client becomes a follower", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const snapshot = conversation();
    const harness = yield* build(scope, ({ fidelity }) =>
      Effect.succeed(entry(snapshot, fidelity)),
    );
    harness.conversations
      .conversation(threadId)
      .acceptReplica({ conversation: snapshot, revision: 1, ownerEpoch: 0 });
    const first = yield* harness.runtime
      .resumeForRenderer(threadId, "owner-a")
      .pipe(Effect.forkChild);
    const second = yield* harness.runtime
      .resumeForRenderer(threadId, "owner-b")
      .pipe(Effect.forkChild);
    const owner = yield* Fiber.join(first);
    const follower = yield* Fiber.join(second);
    assert.strictEqual(owner?.role, "owner");
    assert.strictEqual(follower?.role, "follower");
    if (follower?.role === "follower") assert.strictEqual(follower.ownerClientId, "owner-a");
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts physical resume work when the owning Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const harness = yield* build(scope, ({ fidelity }) =>
      fidelity === "durable"
        ? Effect.succeed(null)
        : Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    );
    const fiber = yield* harness.runtime.resume({ threadId }).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    assert.strictEqual((yield* Fiber.await(fiber))._tag, "Failure");
  }),
);
