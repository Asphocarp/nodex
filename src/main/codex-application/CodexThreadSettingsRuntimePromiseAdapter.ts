import type * as Effect from "effect/Effect";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexThreadSettingsOperationError,
  type CodexThreadSettingsRuntime,
  type CodexThreadSettingsUpdateCommand,
  type CodexThreadSettingsUpdateSupport,
} from "./CodexThreadSettingsRuntime";

export interface CodexThreadSettingsRuntimePromiseAdapter {
  readonly update: (
    input: CodexThreadSettingsUpdateCommand,
    options?: Effect.RunOptions,
  ) => Promise<import("../../shared/types").CodexConversationThreadSettings>;
  readonly awaitCurrent: (threadId: string) => Promise<void>;
  readonly remoteUpdateSupport: () => CodexThreadSettingsUpdateSupport;
  readonly recordRemoteUpdateSupported: () => void;
  readonly recordRemoteUpdateUnsupported: () => void;
}

const unwrapOperationError = (error: unknown): never => {
  if (error instanceof CodexThreadSettingsOperationError) throw error.cause;
  throw error;
};

/** Promise projection for remaining CodexService callers; transaction ownership stays in Effect. */
export const makeCodexThreadSettingsRuntimePromiseAdapter = (
  runtime: CodexThreadSettingsRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexThreadSettingsRuntimePromiseAdapter => ({
  update: (input, options) =>
    callbacks.runPromise(runtime.update(input), options).catch(unwrapOperationError),
  awaitCurrent: (threadId) => callbacks.runPromise(runtime.awaitCurrent(threadId)),
  remoteUpdateSupport: runtime.remoteUpdateSupport,
  recordRemoteUpdateSupported: runtime.recordRemoteUpdateSupported,
  recordRemoteUpdateUnsupported: runtime.recordRemoteUpdateUnsupported,
});
