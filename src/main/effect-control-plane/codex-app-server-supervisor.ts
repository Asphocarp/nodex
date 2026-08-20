import { Data, Effect } from "effect";
import { forkControlPlane, runControlPlanePromise } from "./runtime";

class CodexSupervisorFailure extends Data.TaggedError("CodexSupervisorFailure")<{
  readonly cause: unknown;
}> {}

export interface CodexReconnectSupervisor {
  cancel(): void;
  isScheduled(): boolean;
  schedule(attempt: number, reconnect: () => Promise<void>): number | null;
}

export const codexReconnectDelay = (
  attempt: number,
  jitterMs: number,
  maxDelayMs = 30_000,
): number => Math.min(maxDelayMs, 500 * 2 ** (attempt - 1)) + jitterMs;

export function createCodexReconnectSupervisor(input: {
  readonly jitter: () => number;
  readonly maxDelayMs?: number;
}): CodexReconnectSupervisor {
  const maxDelayMs = input.maxDelayMs ?? 30_000;
  let active: { readonly token: object; interrupt(): void } | null = null;

  return {
    cancel: () => {
      const current = active;
      active = null;
      current?.interrupt();
    },
    isScheduled: () => active !== null,
    schedule: (attempt, reconnect) => {
      if (active !== null) return null;
      const delayMs = codexReconnectDelay(attempt, input.jitter(), maxDelayMs);
      const token = {};
      const fiber = forkControlPlane(
        Effect.sleep(delayMs).pipe(
          Effect.andThen(
            Effect.sync(() => {
              if (active?.token === token) active = null;
            }),
          ),
          Effect.andThen(
            Effect.tryPromise({
              try: reconnect,
              catch: (cause) => new CodexSupervisorFailure({ cause }),
            }),
          ),
          Effect.ignore,
        ),
      );
      active = { token, interrupt: () => fiber.interrupt() };
      void fiber.result.finally(() => {
        if (active?.token === token) active = null;
      });
      return delayMs;
    },
  };
}

export const runCodexPromiseWithTimeout = <A>(
  promise: PromiseLike<A>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<A> =>
  runControlPlanePromise(
    Effect.tryPromise({
      try: () => promise,
      catch: (cause) => new CodexSupervisorFailure({ cause }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.fail(new CodexSupervisorFailure({ cause: timeoutError() })),
      }),
    ),
  ).catch((error: unknown) => {
    throw error instanceof CodexSupervisorFailure ? error.cause : error;
  });

export const waitForCodexPromiseOrTimeout = (
  promise: PromiseLike<unknown>,
  timeoutMs: number,
): Promise<boolean> =>
  runControlPlanePromise(
    Effect.tryPromise({
      try: () => promise,
      catch: (cause) => new CodexSupervisorFailure({ cause }),
    }).pipe(
      Effect.ignore,
      Effect.as(true),
      Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.succeed(false) }),
    ),
  );
