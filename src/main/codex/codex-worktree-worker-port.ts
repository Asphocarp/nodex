import type { CodexStoredShellEnvironment } from "./codex-thread-launch-context";
import type { CodexPendingWorktreeStartingState } from "../../shared/codex-pending-worktree";

export interface CodexWorktreeWorkerCreateInput {
  readonly requestId: string;
  readonly hostId: string;
  readonly repositoryPath: string;
  readonly nodexHome: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly threadTitle: string;
  readonly startingState: CodexPendingWorktreeStartingState | null;
  readonly localEnvironmentConfigPath: string | null;
  readonly setUpSyncedBranch: boolean;
  readonly propagateLocalWorkspaceFiles: boolean;
}

export type CodexWorktreeWorkerEvent =
  | {
      readonly type: "output";
      readonly phase: "worktree" | "setup";
      readonly stream: "stdout" | "stderr" | "info";
      readonly data: string;
    }
  | {
      readonly type: "path-allocated";
      readonly worktreeGitRoot: string;
      readonly worktreeWorkspaceRoot: string;
    }
  | { readonly type: "setup-started" };

export interface CodexWorktreeWorkerCreateResult {
  readonly worktreeGitRoot: string;
  readonly worktreeWorkspaceRoot: string;
  readonly setupError: string | null;
  readonly shellEnvironment: CodexStoredShellEnvironment | null;
}

/**
 * Main-owned seam for all prompt-created worktree filesystem mutation.
 * Renderer IPC never exposes this interface.
 */
export interface CodexWorktreeWorkerPort {
  create(
    input: CodexWorktreeWorkerCreateInput,
    options: {
      readonly signal: AbortSignal;
      readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
    },
  ): Promise<CodexWorktreeWorkerCreateResult>;
  remove(worktreeGitRoot: string): Promise<void>;
  shutdown?(): Promise<void>;
}
