import { Data, Effect } from "effect";

export class RuntimeWindowShutdownError extends Data.TaggedError("RuntimeWindowShutdownError")<{
  readonly cause: unknown;
}> {}

export interface FlushableRuntimeWindow {
  close(): void;
  isDestroyed(): boolean;
  off(event: "closed", listener: () => void): unknown;
  once(event: "closed", listener: () => void): unknown;
}

const closeWindowBeforeRuntimeShutdown = (
  window: FlushableRuntimeWindow,
): Effect.Effect<void, RuntimeWindowShutdownError> =>
  Effect.suspend(() => {
    if (window.isDestroyed()) return Effect.void;

    return Effect.callback<void, RuntimeWindowShutdownError>((resume) => {
      const onClosed = (): void => resume(Effect.void);
      window.once("closed", onClosed);
      try {
        window.close();
      } catch (cause) {
        window.off("closed", onClosed);
        resume(Effect.fail(new RuntimeWindowShutdownError({ cause })));
      }
      return Effect.sync(() => window.off("closed", onClosed));
    });
  });

export const closeWindowsBeforeRuntimeShutdown = (
  windows: readonly FlushableRuntimeWindow[],
): Effect.Effect<void, RuntimeWindowShutdownError> =>
  Effect.forEach(windows, closeWindowBeforeRuntimeShutdown, {
    concurrency: "unbounded",
    discard: true,
  });
