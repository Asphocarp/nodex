import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";

export interface CodexPostResumeGoalLoadResult {
  readonly ok: boolean;
  readonly goal: ThreadGoal | null;
}

export class CodexPostResumeGoalError extends Data.TaggedError("CodexPostResumeGoalError")<{
  readonly cause: unknown;
}> {}

export interface CodexPostResumeGoalRuntimeOptions {
  readonly load: (
    threadId: string,
  ) => Effect.Effect<CodexPostResumeGoalLoadResult, CodexPostResumeGoalError>;
  /** Atomically checks the conversation revision and applies a valid hydration. */
  readonly commit: (threadId: string, expectedRevision: number, goal: ThreadGoal | null) => boolean;
  readonly requestContinuation: (threadId: string) => void;
  readonly scheduleRemainingTurns: (threadId: string) => void;
}

export class CodexPostResumeGoalRuntime extends Context.Service<
  CodexPostResumeGoalRuntime,
  {
    readonly hydrate: (threadId: string, expectedRevision: number) => Effect.Effect<void>;
    readonly request: (threadId: string, expectedRevision: number) => void;
    readonly defer: (threadId: string) => void;
    readonly release: (threadId: string, expectedRevision: number) => boolean;
    readonly clear: (threadId: string) => void;
  }
>()("nodex/main/codex-application/CodexPostResumeGoalRuntime") {}

export const make = (
  options: CodexPostResumeGoalRuntimeOptions,
): Effect.Effect<CodexPostResumeGoalRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const loads = yield* FiberMap.make<string, CodexPostResumeGoalLoadResult, never>();
    const requests = yield* FiberMap.make<string, void, never>();
    const runLoad = yield* FiberMap.runtime(loads)();
    const runRequest = yield* FiberMap.runtime(requests)();
    const deferred = new Set<string>();
    const latestRequest = new Map<
      string,
      { readonly generation: number; readonly expectedRevision: number }
    >();

    const load = (threadId: string): Effect.Effect<CodexPostResumeGoalLoadResult> =>
      Effect.suspend(() => {
        const existing = FiberMap.getUnsafe(loads, threadId);
        if (Option.isSome(existing)) return Fiber.join(existing.value);

        const fiber = runLoad(
          threadId,
          options
            .load(threadId)
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("Could not hydrate Thread goal after resume").pipe(
                  Effect.annotateLogs({ threadId, error: String(error.cause) }),
                  Effect.as({ ok: false, goal: null } satisfies CodexPostResumeGoalLoadResult),
                ),
              ),
            ),
        );
        return Fiber.join(fiber);
      });

    const hydrate = (threadId: string, expectedRevision: number): Effect.Effect<void> =>
      load(threadId).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (!result.ok) return;
            if (!options.commit(threadId, expectedRevision, result.goal)) return;
            options.requestContinuation(threadId);
          }),
        ),
        Effect.asVoid,
      );

    const runRequestedFlow = (threadId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const result = yield* load(threadId);
        for (;;) {
          const requested = latestRequest.get(threadId);
          if (!requested) return;
          if (result.ok) {
            if (options.commit(threadId, requested.expectedRevision, result.goal)) {
              options.requestContinuation(threadId);
            }
          }
          options.scheduleRemainingTurns(threadId);
          if (latestRequest.get(threadId)?.generation !== requested.generation) continue;
          latestRequest.delete(threadId);
          return;
        }
      });

    const request = (threadId: string, expectedRevision: number): void => {
      const generation = (latestRequest.get(threadId)?.generation ?? 0) + 1;
      latestRequest.set(threadId, { generation, expectedRevision });
      options.requestContinuation(threadId);
      if (FiberMap.hasUnsafe(requests, threadId)) return;
      runRequest(threadId, runRequestedFlow(threadId));
    };

    const clear = (threadId: string): void => {
      deferred.delete(threadId);
      latestRequest.delete(threadId);
      runRequest(threadId, Effect.void);
      runLoad(threadId, Effect.succeed({ ok: false, goal: null }));
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        deferred.clear();
        latestRequest.clear();
      }),
    );

    return CodexPostResumeGoalRuntime.of({
      hydrate,
      request,
      defer: (threadId) => {
        deferred.add(threadId);
      },
      release: (threadId, expectedRevision) => {
        if (!deferred.delete(threadId)) return false;
        request(threadId, expectedRevision);
        return true;
      },
      clear,
    });
  });
