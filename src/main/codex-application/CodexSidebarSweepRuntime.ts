import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as DurationValue from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Random from "effect/Random";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";

export const DEFAULT_CODEX_SIDEBAR_SWEEP_RETRY_INITIAL_DELAY = "2 seconds";
export const DEFAULT_CODEX_SIDEBAR_SWEEP_RETRY_MAX_DELAY = "1 minute";

export interface CodexSidebarSweepStateDescription {
  readonly archived: boolean;
  readonly cursorPresent: boolean;
  readonly phase: string;
}

export class CodexSidebarSweepStepError extends Data.TaggedError("CodexSidebarSweepStepError")<{
  readonly cause: unknown;
  readonly state: CodexSidebarSweepStateDescription;
}> {}

export interface CodexSidebarSweepRuntimeOptions {
  readonly retryInitialDelay?: Duration.Input;
  readonly retryMaxDelay?: Duration.Input;
  readonly retryDelay?: (baseDelayMs: number, attempt: number) => Effect.Effect<number>;
}

export class CodexSidebarSweepRuntime extends Context.Service<
  CodexSidebarSweepRuntime,
  {
    readonly start: <State>(
      initialState: State,
      step: (state: State) => Effect.Effect<State | null, CodexSidebarSweepStepError>,
    ) => Effect.Effect<void>;
    readonly cancel: Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexSidebarSweepRuntime") {}

const defaultRetryDelay = (baseDelayMs: number): Effect.Effect<number> =>
  Random.nextBetween(0.8, 1.2).pipe(Effect.map((jitter) => Math.round(baseDelayMs * jitter)));

export const make = (
  options: CodexSidebarSweepRuntimeOptions = {},
): Effect.Effect<CodexSidebarSweepRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const activeSweep = yield* FiberHandle.make<void, never>();
    const admission = yield* Semaphore.make(1);
    let current:
      | {
          readonly cancel: Deferred.Deferred<void>;
          readonly done: Deferred.Deferred<void>;
        }
      | undefined;
    const retryInitialDelayMs = DurationValue.toMillis(
      options.retryInitialDelay ?? DEFAULT_CODEX_SIDEBAR_SWEEP_RETRY_INITIAL_DELAY,
    );
    const retryMaxDelayMs = DurationValue.toMillis(
      options.retryMaxDelay ?? DEFAULT_CODEX_SIDEBAR_SWEEP_RETRY_MAX_DELAY,
    );
    const retryDelay = options.retryDelay ?? defaultRetryDelay;

    const run = <State>(
      state: State,
      step: (state: State) => Effect.Effect<State | null, CodexSidebarSweepStepError>,
      retryAttempt: number,
      cancelled: Deferred.Deferred<void>,
    ): Effect.Effect<void> =>
      Effect.suspend(() =>
        Effect.gen(function* () {
          if (yield* Deferred.isDone(cancelled)) return;
          yield* Effect.yieldNow;
          if (yield* Deferred.isDone(cancelled)) return;

          const outcome = yield* step(state).pipe(Effect.result);
          if (yield* Deferred.isDone(cancelled)) return;
          if (outcome._tag === "Success") {
            if (outcome.success === null) return;
            return yield* run(outcome.success, step, 0, cancelled);
          }

          const error = outcome.failure;
          const exponentialDelay = retryInitialDelayMs * 2 ** Math.min(retryAttempt, 30);
          const baseDelayMs = Math.min(exponentialDelay, retryMaxDelayMs);
          const delayMs = yield* retryDelay(baseDelayMs, retryAttempt);
          yield* Effect.logWarning("Could not continue background sidebar reconciliation").pipe(
            Effect.annotateLogs({
              archived: error.state.archived,
              cause: String(error.cause),
              cursorPresent: error.state.cursorPresent,
              phase: error.state.phase,
              retryAttempt,
              retryDelayMs: delayMs,
            }),
          );
          const shouldRetry = yield* Effect.raceFirst(
            Effect.sleep(DurationValue.millis(Math.max(0, delayMs))).pipe(Effect.as(true)),
            Deferred.await(cancelled).pipe(Effect.as(false)),
          );
          if (!shouldRetry) return;
          return yield* run(state, step, retryAttempt + 1, cancelled);
        }),
      );

    const cancelCurrent = admission.withPermits(1)(
      Effect.suspend(() => {
        const session = current;
        if (!session) return Effect.void;
        return Deferred.succeed(session.cancel, undefined).pipe(
          Effect.andThen(Deferred.await(session.done)),
        );
      }),
    );

    return CodexSidebarSweepRuntime.of({
      start: (initialState, step) =>
        admission.withPermits(1)(
          Effect.gen(function* () {
            const previous = current;
            if (previous) {
              yield* Deferred.succeed(previous.cancel, undefined);
              yield* Deferred.await(previous.done);
            }

            const cancel = yield* Deferred.make<void>();
            const done = yield* Deferred.make<void>();
            const session = { cancel, done };
            current = session;
            const sweep = run(initialState, step, 0, cancel).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  if (current === session) current = undefined;
                }).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
              ),
            );
            yield* FiberHandle.run(activeSweep, sweep, {
              startImmediately: true,
            });
          }),
        ),
      cancel: cancelCurrent,
    });
  });
