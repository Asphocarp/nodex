import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  CodexManualCompactionProjectionError,
  type CodexManualCompactionRuntime,
} from "./CodexManualCompactionRuntime";

export interface CodexManualCompactionRuntimePromiseAdapter {
  readonly start: (threadId: string) => Promise<void>;
  readonly consumeSource: CodexManualCompactionRuntime["Service"]["consumeSource"];
  readonly clear: CodexManualCompactionRuntime["Service"]["clear"];
}

const unwrapProjectionError = (error: unknown): never => {
  if (error instanceof CodexManualCompactionProjectionError) throw error.cause;
  throw error;
};

/** Promise projection for the remaining CodexService command switch; state stays in Effect. */
export const makeCodexManualCompactionRuntimePromiseAdapter = (
  runtime: CodexManualCompactionRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexManualCompactionRuntimePromiseAdapter => ({
  start: (threadId) => callbacks.runPromise(runtime.start(threadId)).catch(unwrapProjectionError),
  consumeSource: runtime.consumeSource,
  clear: runtime.clear,
});
