import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexThreadReadState, CodexThreadReadStateUpdate } from "./CodexThreadReadState";

export interface CodexThreadReadStatePromiseAdapter {
  readonly persistProjected: (input: CodexThreadReadStateUpdate) => Promise<void>;
}

/** Promise projection for reducers; the owner reprojects after persistence to preserve lane order. */
export const makeCodexThreadReadStatePromiseAdapter = (
  readState: CodexThreadReadState["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexThreadReadStatePromiseAdapter => ({
  persistProjected: (input) => callbacks.runPromise(readState.persistProjected(input)),
});
