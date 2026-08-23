import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexQueuedFollowUpRuntimeError,
  type CodexQueuedFollowUpEnqueueInput,
  type CodexQueuedFollowUpRuntime,
} from "./CodexQueuedFollowUpRuntime";

export interface CodexQueuedFollowUpRuntimePromiseAdapter {
  readonly list: CodexQueuedFollowUpRuntime["Service"]["list"];
  readonly enqueue: (input: CodexQueuedFollowUpEnqueueInput) => Promise<string>;
  readonly request: CodexQueuedFollowUpRuntime["Service"]["request"];
  readonly clearPaused: CodexQueuedFollowUpRuntime["Service"]["clearPaused"];
  readonly reset: CodexQueuedFollowUpRuntime["Service"]["reset"];
  readonly clear: CodexQueuedFollowUpRuntime["Service"]["clear"];
}

const unwrapError = (error: unknown): never => {
  if (error instanceof CodexQueuedFollowUpRuntimeError) throw error.cause;
  throw error;
};

/** Promise projection for remaining canonical reducer call sites. */
export const makeCodexQueuedFollowUpRuntimePromiseAdapter = (
  runtime: CodexQueuedFollowUpRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexQueuedFollowUpRuntimePromiseAdapter => ({
  list: runtime.list,
  enqueue: (input) => callbacks.runPromise(runtime.enqueue(input)).catch(unwrapError),
  request: runtime.request,
  clearPaused: runtime.clearPaused,
  reset: runtime.reset,
  clear: runtime.clear,
});
