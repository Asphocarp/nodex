import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexPostResumeGoalRuntime } from "./CodexPostResumeGoalRuntime";

export interface CodexPostResumeGoalRuntimePromiseAdapter {
  readonly hydrate: (threadId: string, expectedRevision: number) => Promise<void>;
  readonly request: (threadId: string, expectedRevision: number) => void;
  readonly defer: (threadId: string) => void;
  readonly release: (threadId: string, expectedRevision: number) => boolean;
  readonly clear: (threadId: string) => void;
}

/** Promise projection for the one legacy awaited hydration call; background work stays scoped. */
export const makeCodexPostResumeGoalRuntimePromiseAdapter = (
  runtime: CodexPostResumeGoalRuntime["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexPostResumeGoalRuntimePromiseAdapter => ({
  hydrate: (threadId, expectedRevision) =>
    callbacks.runPromise(runtime.hydrate(threadId, expectedRevision)),
  request: runtime.request,
  defer: runtime.defer,
  release: runtime.release,
  clear: runtime.clear,
});
