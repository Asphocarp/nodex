import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import type { CodexGitProbe } from "./CodexGitProbe";

export interface CodexGitProbePromiseAdapter {
  readonly readPath: (cwd: string, args: readonly string[]) => Promise<string | null>;
  readonly isNonGitWorkspace: (cwd: string) => Promise<boolean>;
}

/** Stateless Promise projection for the remaining CodexService policy methods. */
export const makeCodexGitProbePromiseAdapter = (
  probe: CodexGitProbe["Service"],
  callbacks: Pick<ScopedCallbackRuntime["Service"], "runPromise">,
): CodexGitProbePromiseAdapter => ({
  readPath: (cwd, args) => callbacks.runPromise(probe.readPath(cwd, args)),
  isNonGitWorkspace: (cwd) => callbacks.runPromise(probe.isNonGitWorkspace(cwd)),
});
