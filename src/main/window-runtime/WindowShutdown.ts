import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

const DEFAULT_CLOSE_DEADLINE = "2 seconds";

export interface ShutdownWindow {
  readonly close: () => void;
  readonly destroy: () => void;
  readonly id?: number;
  readonly isDestroyed: () => boolean;
  readonly off: (event: "closed", listener: () => void) => unknown;
  readonly once: (event: "closed", listener: () => void) => unknown;
}

export interface WindowCleanupFailure {
  readonly phase: "close" | "destroy";
  readonly reason: string;
  readonly windowId?: number;
}

export interface WindowCleanupReport {
  readonly alreadyClosed: number;
  readonly destroyed: number;
  readonly failed: number;
  readonly failures: readonly WindowCleanupFailure[];
  readonly graceful: number;
  readonly total: number;
}

export interface WindowShutdownService {
  readonly closeAll: (windows: readonly ShutdownWindow[]) => Effect.Effect<WindowCleanupReport>;
}

export class WindowShutdown extends Context.Service<WindowShutdown, WindowShutdownService>()(
  "nodex/main/window-runtime/WindowShutdown",
) {}

class GracefulWindowCloseError extends Data.TaggedError("GracefulWindowCloseError")<{
  readonly cause: unknown;
}> {}

type WindowCleanupOutcome =
  | { readonly _tag: "AlreadyClosed" }
  | { readonly _tag: "Destroyed" }
  | { readonly _tag: "Failed"; readonly failure: WindowCleanupFailure }
  | { readonly _tag: "Graceful" };

const safeReason = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const failure = (
  window: ShutdownWindow,
  phase: WindowCleanupFailure["phase"],
  cause: unknown,
): WindowCleanupOutcome => ({
  _tag: "Failed",
  failure: {
    phase,
    reason: safeReason(cause),
    ...(window.id === undefined ? {} : { windowId: window.id }),
  },
});

const destroy = (
  window: ShutdownWindow,
  closeFailure?: unknown,
): Effect.Effect<WindowCleanupOutcome> =>
  Effect.sync(() => {
    if (window.isDestroyed()) {
      return closeFailure === undefined
        ? { _tag: "AlreadyClosed" as const }
        : failure(window, "close", closeFailure);
    }
    try {
      window.destroy();
      return { _tag: "Destroyed" as const };
    } catch (cause) {
      return failure(window, "destroy", cause);
    }
  });

const awaitGracefulClose = (
  window: ShutdownWindow,
): Effect.Effect<void, GracefulWindowCloseError> =>
  Effect.callback<void, GracefulWindowCloseError>((resume) => {
    const onClosed = (): void => resume(Effect.void);
    window.once("closed", onClosed);
    try {
      window.close();
    } catch (cause) {
      window.off("closed", onClosed);
      resume(Effect.fail(new GracefulWindowCloseError({ cause })));
    }
    return Effect.sync(() => window.off("closed", onClosed));
  });

const closeOne = (
  window: ShutdownWindow,
  deadline: Duration.Input,
): Effect.Effect<WindowCleanupOutcome> =>
  Effect.suspend(() => {
    if (window.isDestroyed()) return Effect.succeed({ _tag: "AlreadyClosed" });
    return Effect.interruptible(awaitGracefulClose(window)).pipe(
      Effect.timeoutOption(deadline),
      Effect.matchEffect({
        onFailure: (error) => destroy(window, error.cause),
        onSuccess: (completed) =>
          Option.isSome(completed)
            ? Effect.succeed({ _tag: "Graceful" as const })
            : destroy(window),
      }),
    );
  });

const summarize = (outcomes: readonly WindowCleanupOutcome[]): WindowCleanupReport => {
  let alreadyClosed = 0;
  let destroyed = 0;
  let failed = 0;
  let graceful = 0;
  const failures: WindowCleanupFailure[] = [];
  for (const outcome of outcomes) {
    switch (outcome._tag) {
      case "AlreadyClosed":
        alreadyClosed += 1;
        break;
      case "Destroyed":
        destroyed += 1;
        break;
      case "Failed":
        failed += 1;
        failures.push(outcome.failure);
        break;
      case "Graceful":
        graceful += 1;
        break;
    }
  }
  return {
    alreadyClosed,
    destroyed,
    failed,
    failures,
    graceful,
    total: outcomes.length,
  };
};

export const make = (
  closeDeadline: Duration.Input = DEFAULT_CLOSE_DEADLINE,
): WindowShutdownService => ({
  closeAll: Effect.fn("WindowShutdown.closeAll")((windows: readonly ShutdownWindow[]) =>
    Effect.forEach(windows, (window) => closeOne(window, closeDeadline), {
      concurrency: "unbounded",
    }).pipe(Effect.map(summarize)),
  ),
});

export const live = (
  closeDeadline: Duration.Input = DEFAULT_CLOSE_DEADLINE,
): Layer.Layer<WindowShutdown> =>
  Layer.succeed(WindowShutdown, WindowShutdown.of(make(closeDeadline)));
