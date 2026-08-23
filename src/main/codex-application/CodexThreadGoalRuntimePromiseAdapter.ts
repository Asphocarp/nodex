import type { ThreadGoal } from "@nodex/codex-app-server-protocol/v2/ThreadGoal";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexThreadGoalRuntime, CodexThreadGoalSetCommand } from "./CodexThreadGoalRuntime";

export interface CodexThreadGoalRuntimePromiseAdapter {
  readonly set: (input: CodexThreadGoalSetCommand) => Promise<ThreadGoal | null>;
  readonly clear: (threadId: string) => Promise<void>;
}

/** Promise projection for internal CodexService callers until its canonical owner is removed. */
export const makeCodexThreadGoalRuntimePromiseAdapter = (
  runtime: CodexThreadGoalRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexThreadGoalRuntimePromiseAdapter => ({
  set: (input) => callbacks.runPromise(runtime.set(input)),
  clear: (threadId) => callbacks.runPromise(runtime.clear(threadId)),
});
