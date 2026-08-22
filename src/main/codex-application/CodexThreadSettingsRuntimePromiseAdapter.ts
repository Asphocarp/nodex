import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type {
  CodexThreadSettingsRuntime,
  CodexThreadSettingsUpdateSupport,
} from "./CodexThreadSettingsRuntime";

class CodexThreadSettingsMutationError extends Data.TaggedError(
  "CodexThreadSettingsMutationError",
)<{
  readonly cause: unknown;
}> {}

export interface CodexThreadSettingsRuntimePromiseAdapter {
  readonly runMutation: <A>(
    threadId: string,
    mutation: (signal: AbortSignal) => Promise<A>,
  ) => Promise<A>;
  readonly awaitCurrent: (threadId: string) => Promise<void>;
  readonly remoteUpdateSupport: () => CodexThreadSettingsUpdateSupport;
  readonly recordRemoteUpdateSupported: () => void;
  readonly recordRemoteUpdateUnsupported: () => void;
}

const unwrapMutationError = (error: unknown): never => {
  if (error instanceof CodexThreadSettingsMutationError) throw error.cause;
  throw error;
};

/** Promise projection for CodexService; all queues, fibers, and capability state stay in Effect. */
export const makeCodexThreadSettingsRuntimePromiseAdapter = (
  runtime: CodexThreadSettingsRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexThreadSettingsRuntimePromiseAdapter => ({
  runMutation: (threadId, mutation) =>
    callbacks
      .runPromise(
        runtime.runMutation(
          threadId,
          Effect.tryPromise({
            try: mutation,
            catch: (cause) => new CodexThreadSettingsMutationError({ cause }),
          }),
        ),
      )
      .catch(unwrapMutationError),
  awaitCurrent: (threadId) => callbacks.runPromise(runtime.awaitCurrent(threadId)),
  remoteUpdateSupport: runtime.remoteUpdateSupport,
  recordRemoteUpdateSupported: runtime.recordRemoteUpdateSupported,
  recordRemoteUpdateUnsupported: runtime.recordRemoteUpdateUnsupported,
});
