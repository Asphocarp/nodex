import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Semaphore from "effect/Semaphore";
import {
  makeCodexConversationAggregateRegistry,
  type CodexConversationAggregate,
  type CodexConversationAggregateRegistry,
} from "./CodexConversationAggregate";

export class ConversationRuntimeMap extends Context.Service<
  ConversationRuntimeMap,
  {
    /** Acquires the canonical semantic capability for one Thread generation. */
    readonly conversation: (threadId: string) => CodexConversationAggregate;
    /** Pure query that never creates or resurrects a Thread generation. */
    readonly currentConversation: (threadId: string) => CodexConversationAggregate | null;
    /** Serializes complete application commands within the current Thread generation. */
    readonly runExclusive: <A, E, R>(
      threadId: string,
      operation: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    /** Marks every loaded Thread non-live after the app-server connection is lost. */
    readonly markAllNeedsResume: () => void;
    /** Closes the exact live generation and interrupts its active or queued commands. */
    readonly close: (threadId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/ConversationRuntimeMap") {}

class ConversationCausalLane extends Context.Service<
  ConversationCausalLane,
  {
    readonly runExclusive: <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  }
>()("nodex/main/codex-application/ConversationCausalLane") {}

const causalLaneLayer = (
  threadId: string,
  aggregates: CodexConversationAggregateRegistry,
): Layer.Layer<ConversationCausalLane> =>
  Layer.effect(
    ConversationCausalLane,
    Effect.gen(function* () {
      const generation = aggregates.acquire(threadId).generation;
      const semaphore = yield* Semaphore.make(1);
      const ownerScope = yield* Effect.scope;

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => aggregates.releaseGeneration(threadId, generation)),
      );

      const runExclusive = <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
          semaphore
            .withPermit(operation)
            .pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
          Fiber.join,
          Fiber.interrupt,
        );

      return ConversationCausalLane.of({ runExclusive });
    }),
  );

/**
 * Profile-scoped owner of canonical Thread generations and their single causal command lanes.
 * A lane is cached until explicit Thread close or Main Scope close; no consumer can observe its
 * semaphore, Scope, or lifecycle bookkeeping.
 */
export const live: Layer.Layer<ConversationRuntimeMap> = Layer.effect(
  ConversationRuntimeMap,
  Effect.gen(function* () {
    const aggregates = makeCodexConversationAggregateRegistry();
    yield* Effect.addFinalizer(() => Effect.sync(aggregates.releaseAll));
    const lanes = yield* LayerMap.make(
      (threadId: string) => causalLaneLayer(threadId, aggregates),
      { idleTimeToLive: Duration.infinity },
    );

    // Release the RcMap borrow before running the command. The cached lane owns the command fiber,
    // so explicit invalidation can close that owner Scope instead of waiting on its own borrower.
    const lane = (threadId: string): Effect.Effect<ConversationCausalLane["Service"]> =>
      Effect.scoped(
        lanes
          .contextEffect(threadId)
          .pipe(Effect.map((context) => Context.get(context, ConversationCausalLane))),
      );

    return ConversationRuntimeMap.of({
      conversation: aggregates.acquire,
      currentConversation: aggregates.current,
      runExclusive: (threadId, operation) =>
        lane(threadId).pipe(Effect.flatMap((current) => current.runExclusive(operation))),
      markAllNeedsResume: aggregates.markAllNeedsResume,
      close: (threadId) => {
        const generation = aggregates.current(threadId)?.generation;
        return lanes
          .invalidate(threadId)
          .pipe(
            Effect.ensuring(
              generation === undefined
                ? Effect.void
                : Effect.sync(() => aggregates.releaseGeneration(threadId, generation)),
            ),
          );
      },
    });
  }),
);
