import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";

export const DEFAULT_RENDERER_OWNER_RETENTION = "1 hour";
export const DEFAULT_RENDERER_OWNER_MAX_RETAINED = 4;
export const DEFAULT_RENDERER_OWNER_RETRY = "15 seconds";

export type CodexRendererOwnerCleanupReason =
  | "inactive-owner-retention"
  | "inactive-owner-retained-limit"
  | "inactive-owner-retry";

export class CodexRendererOwnerRetentionError extends Data.TaggedError(
  "CodexRendererOwnerRetentionError",
)<{ readonly cause: unknown }> {}

interface TrackedCandidate {
  readonly candidateSince: number;
  readonly generation: number;
}

export interface CodexRendererOwnerRetentionOptions {
  readonly isCandidate: (conversationId: string) => boolean;
  readonly unsubscribe: (
    conversationId: string,
  ) => Effect.Effect<void, CodexRendererOwnerRetentionError>;
  readonly commitCleanup: (
    conversationId: string,
    reason: CodexRendererOwnerCleanupReason,
  ) => Effect.Effect<void>;
  readonly retention?: Duration.Input;
  readonly maxRetained?: number;
  readonly retry?: Duration.Input;
}

export class CodexRendererOwnerRetention extends Context.Service<
  CodexRendererOwnerRetention,
  {
    readonly trackedConversationIds: Effect.Effect<readonly string[]>;
    readonly reconcile: (conversationId: string, candidate: boolean) => Effect.Effect<void>;
    readonly recheckAfter: (conversationId: string, delay: Duration.Input) => Effect.Effect<void>;
    readonly clear: (conversationId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexRendererOwnerRetention") {}

export const make = (
  options: CodexRendererOwnerRetentionOptions,
): Effect.Effect<CodexRendererOwnerRetention["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const retention = options.retention ?? DEFAULT_RENDERER_OWNER_RETENTION;
    const retry = options.retry ?? DEFAULT_RENDERER_OWNER_RETRY;
    const maxRetained = Math.max(
      0,
      Math.floor(options.maxRetained ?? DEFAULT_RENDERER_OWNER_MAX_RETAINED),
    );
    const candidates = yield* Ref.make(HashMap.empty<string, TrackedCandidate>());
    const nextGeneration = yield* Ref.make(0);
    const timers = yield* FiberMap.make<string, void>();
    const rechecks = yield* FiberMap.make<string, void>();
    const cleanups = yield* FiberMap.make<string, void>();
    const mutations = yield* Semaphore.make(1);

    const current = (conversationId: string) =>
      Ref.get(candidates).pipe(
        Effect.map((state) => Option.getOrUndefined(HashMap.get(state, conversationId))),
      );
    const isCurrent = (conversationId: string, generation: number) =>
      current(conversationId).pipe(
        Effect.map(
          (candidate) =>
            candidate?.generation === generation && options.isCandidate(conversationId),
        ),
      );
    const removeCurrent = (conversationId: string, generation: number) =>
      Ref.update(candidates, (state) => {
        const candidate = Option.getOrUndefined(HashMap.get(state, conversationId));
        return candidate?.generation === generation ? HashMap.remove(state, conversationId) : state;
      });
    const cleanupKey = (conversationId: string, generation: number) =>
      `${conversationId}\0${generation}`;

    const startTimer = (
      conversationId: string,
      generation: number,
      delay: Duration.Input,
      reason: CodexRendererOwnerCleanupReason,
    ): Effect.Effect<void> =>
      FiberMap.run(
        timers,
        conversationId,
        Effect.sleep(delay).pipe(
          Effect.andThen(Effect.suspend(() => startCleanup(conversationId, generation, reason))),
        ),
        { startImmediately: true },
      ).pipe(Effect.asVoid);

    const startCleanup = (
      conversationId: string,
      generation: number,
      reason: CodexRendererOwnerCleanupReason,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!(yield* isCurrent(conversationId, generation))) return;
        const key = cleanupKey(conversationId, generation);
        if (yield* FiberMap.has(cleanups, key)) return;
        yield* FiberMap.run(
          cleanups,
          key,
          options.unsubscribe(conversationId).pipe(
            Effect.flatMap(() =>
              isCurrent(conversationId, generation).pipe(
                Effect.flatMap((stillCurrent) =>
                  stillCurrent
                    ? options
                        .commitCleanup(conversationId, reason)
                        .pipe(Effect.andThen(removeCurrent(conversationId, generation)))
                    : Effect.void,
                ),
              ),
            ),
            Effect.catch((error) =>
              isCurrent(conversationId, generation).pipe(
                Effect.flatMap((stillCurrent) =>
                  stillCurrent
                    ? Effect.logWarning("Failed to unsubscribe inactive renderer owner").pipe(
                        Effect.annotateLogs({
                          cause: String(error.cause),
                          conversationId,
                          reason,
                        }),
                        Effect.andThen(
                          startTimer(conversationId, generation, retry, "inactive-owner-retry"),
                        ),
                      )
                    : Effect.void,
                ),
              ),
            ),
          ),
          { startImmediately: true },
        );
      });

    const reconcile = (conversationId: string, candidateEligible: boolean) =>
      mutations.withPermits(1)(
        Effect.gen(function* () {
          if (!candidateEligible) {
            yield* Ref.update(candidates, (state) => HashMap.remove(state, conversationId));
            yield* FiberMap.remove(timers, conversationId);
            return;
          }

          const now = yield* Clock.currentTimeMillis;
          let candidate = yield* current(conversationId);
          if (!candidate) {
            const generation = yield* Ref.updateAndGet(nextGeneration, (value) => value + 1);
            candidate = { candidateSince: now, generation };
            yield* Ref.update(candidates, (state) =>
              HashMap.set(state, conversationId, candidate as TrackedCandidate),
            );
          }

          const activeCleanup = yield* FiberMap.has(
            cleanups,
            cleanupKey(conversationId, candidate.generation),
          );
          if (!activeCleanup && !(yield* FiberMap.has(timers, conversationId))) {
            const elapsed = Math.max(0, now - candidate.candidateSince);
            yield* startTimer(
              conversationId,
              candidate.generation,
              Math.max(0, Duration.toMillis(retention) - elapsed),
              "inactive-owner-retention",
            );
          }

          const tracked = [...HashMap.entries(yield* Ref.get(candidates))].sort((left, right) => {
            const since = left[1].candidateSince - right[1].candidateSince;
            return since !== 0 ? since : left[0].localeCompare(right[0]);
          });
          const overflow = tracked.length - maxRetained;
          if (overflow <= 0) return;
          for (const [id, overflowCandidate] of tracked.slice(0, overflow)) {
            yield* FiberMap.remove(timers, id);
            yield* startCleanup(id, overflowCandidate.generation, "inactive-owner-retained-limit");
          }
        }),
      );

    return CodexRendererOwnerRetention.of({
      trackedConversationIds: Ref.get(candidates).pipe(
        Effect.map((state) => [...HashMap.keys(state)].sort()),
      ),
      reconcile,
      recheckAfter: (conversationId, delay) =>
        FiberMap.run(
          rechecks,
          conversationId,
          Effect.sleep(delay).pipe(
            Effect.andThen(
              Effect.suspend(() => reconcile(conversationId, options.isCandidate(conversationId))),
            ),
          ),
          { startImmediately: true },
        ).pipe(Effect.asVoid),
      clear: (conversationId) =>
        mutations.withPermits(1)(
          Effect.gen(function* () {
            yield* Ref.update(candidates, (state) => HashMap.remove(state, conversationId));
            yield* FiberMap.remove(timers, conversationId);
            yield* FiberMap.remove(rechecks, conversationId);
          }),
        ),
    });
  });

export interface CodexRendererOwnerRetentionLegacyPort {
  readonly reconcile: (conversationId: string) => void;
  readonly recheckAfter: (conversationId: string, delayMs: number) => void;
  readonly clear: (conversationId: string) => void;
}
