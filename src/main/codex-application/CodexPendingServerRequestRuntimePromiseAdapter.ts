import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexPendingServerRequestRuntimeService } from "./CodexPendingServerRequestRuntime";

export interface CodexPendingServerRequestRuntimePromiseAdapter extends Omit<
  CodexPendingServerRequestRuntimeService,
  "shutdown"
> {
  readonly shutdown: (reason: unknown) => Promise<void>;
}

export const makeCodexPendingServerRequestRuntimePromiseAdapter = (
  runtime: CodexPendingServerRequestRuntimeService,
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexPendingServerRequestRuntimePromiseAdapter => ({
  ...runtime,
  shutdown: (reason) => callbacks.runPromise(runtime.shutdown(reason)),
});
