import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

export type CodexThreadSettingsUpdateSupport = "unknown" | "supported" | "unsupported";

/**
 * Owns the concurrency contract for next-turn settings.
 *
 * Mutations are FIFO per Thread but independent across Threads. A turn admission
 * can join the same lane with `awaitCurrent`, and remote capability negotiation
 * has one Main-scoped owner instead of leaking into CodexService fields.
 */
export class CodexThreadSettingsRuntime extends Context.Service<
  CodexThreadSettingsRuntime,
  {
    readonly runMutation: <A, E, R>(
      threadId: string,
      mutation: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly awaitCurrent: (threadId: string) => Effect.Effect<void>;
    readonly remoteUpdateSupport: () => CodexThreadSettingsUpdateSupport;
    readonly recordRemoteUpdateSupported: () => void;
    readonly recordRemoteUpdateUnsupported: () => void;
  }
>()("nodex/main/codex-application/CodexThreadSettingsRuntime") {}

export const make: Effect.Effect<CodexThreadSettingsRuntime["Service"], never, Scope.Scope> =
  Effect.gen(function* () {
    const ownerScope = yield* Scope.Scope;
    const lanes = yield* RcMap.make({
      lookup: (_threadId: string) => Semaphore.make(1),
    });
    let remoteUpdateSupport: CodexThreadSettingsUpdateSupport = "unknown";

    const runOwned = <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );

    const runMutation = <A, E, R>(
      threadId: string,
      mutation: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> =>
      runOwned(
        Effect.scoped(
          Effect.gen(function* () {
            const lane = yield* RcMap.get(lanes, threadId);
            return yield* lane.withPermit(mutation);
          }),
        ),
      );

    return CodexThreadSettingsRuntime.of({
      runMutation,
      awaitCurrent: (threadId) => runMutation(threadId, Effect.void),
      remoteUpdateSupport: () => remoteUpdateSupport,
      recordRemoteUpdateSupported: () => {
        if (remoteUpdateSupport === "unsupported") return;
        remoteUpdateSupport = "supported";
      },
      recordRemoteUpdateUnsupported: () => {
        remoteUpdateSupport = "unsupported";
      },
    });
  });
