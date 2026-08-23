import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexManualCompactionRuntime } from "./CodexManualCompactionRuntime";

export interface CodexManualCompactionRuntimePromiseAdapter {
  readonly start: (threadId: string) => Promise<void>;
  readonly consumeSource: CodexManualCompactionRuntime["Service"]["consumeSource"];
  readonly clear: CodexManualCompactionRuntime["Service"]["clear"];
}

/** Promise projection for the remaining CodexService command switch; state stays in Effect. */
export const makeCodexManualCompactionRuntimePromiseAdapter = (
  runtime: CodexManualCompactionRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexManualCompactionRuntimePromiseAdapter => ({
  start: (threadId) => callbacks.runPromise(runtime.start(threadId)),
  consumeSource: runtime.consumeSource,
  clear: runtime.clear,
});
