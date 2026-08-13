import {
  createManagedWorktree,
  removeManagedWorktree,
  resolveManagedWorktreeDefaultStartingState,
} from "./git-worktree-service";
import { readWorktreeEnvironmentDefinition } from "./worktree-environment-service";
import { runCodexWorktreeSetupScript } from "./codex-worktree-shell-environment";
import type {
  CodexWorktreeWorkerCreateInput,
  CodexWorktreeWorkerCreateResult,
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerPort,
} from "./codex-worktree-worker-port";

function canceled(signal: AbortSignal): never {
  void signal;
  throw new Error("Request canceled");
}

function isCanceled(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted
    || (error instanceof Error
      && (error.name === "AbortError" || error.message.includes("canceled")));
}

export async function executeCodexWorktreeWorkerCreate(
  input: CodexWorktreeWorkerCreateInput,
  options: {
    readonly signal: AbortSignal;
    readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
    readonly loadBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>;
  },
): Promise<CodexWorktreeWorkerCreateResult> {
  const { signal } = options;
  if (signal.aborted) return canceled(signal);
  const startingState = input.startingState
    ?? await resolveManagedWorktreeDefaultStartingState(input.repositoryPath, signal);
  const created = await createManagedWorktree({
    repositoryPath: input.repositoryPath,
    nodexHome: input.nodexHome,
    projectId: input.projectId,
    targetId: input.targetId,
    threadTitle: input.threadTitle,
    branchPrefix: null,
    preferredBaseBranch: null,
    mode: "detachedHead",
    startingState,
    localEnvironmentConfigPath: input.localEnvironmentConfigPath,
    setUpSyncedBranch: input.setUpSyncedBranch,
    propagateLocalWorkspaceFiles: input.propagateLocalWorkspaceFiles,
    signal,
    onPathAllocated: (paths) => {
      options.onEvent({
        type: "path-allocated",
        worktreeGitRoot: paths.worktreeGitRoot,
        worktreeWorkspaceRoot: paths.worktreeWorkspaceRoot,
      });
    },
    onLog: (output) => {
      if (!output.data) return;
      options.onEvent({
        type: "output",
        phase: "worktree",
        stream: output.stream,
        data: output.data,
      });
    },
  });
  const paths = {
    worktreeGitRoot: created.worktreeGitRoot,
    worktreeWorkspaceRoot: created.worktreeWorkspaceRoot,
  };
  if (signal.aborted) {
    await removeManagedWorktree(created.worktreeGitRoot).catch(() => undefined);
    return canceled(signal);
  }
  if (input.localEnvironmentConfigPath === null) {
    return {
      ...paths,
      setupError: null,
      shellEnvironment: null,
    };
  }

  options.onEvent({ type: "setup-started" });
  try {
    const environment = await readWorktreeEnvironmentDefinition({
      workspacePath: input.repositoryPath,
      environmentPath: input.localEnvironmentConfigPath,
    });
    signal.throwIfAborted();
    const shellEnvironment = environment.setupScript === null
      ? null
      : await runCodexWorktreeSetupScript({
          script: environment.setupScript,
          cwd: created.worktreeGitRoot,
          loadBaseEnvironment: options.loadBaseEnvironment,
          signal,
          environment: {
            CODEX_SOURCE_TREE_PATH: input.repositoryPath,
            CODEX_WORKTREE_PATH: created.worktreeWorkspaceRoot,
          },
          onOutput: (output) => {
            if (!output.data) return;
            options.onEvent({
              type: "output",
              phase: "setup",
              stream: output.stream,
              data: output.data,
            });
          },
        });
    signal.throwIfAborted();
    return {
      ...paths,
      setupError: null,
      shellEnvironment,
    };
  } catch (error) {
    if (isCanceled(signal, error)) {
      await removeManagedWorktree(created.worktreeGitRoot).catch(() => undefined);
      return canceled(signal);
    }
    return {
      ...paths,
      setupError: error instanceof Error ? error.message : String(error),
      shellEnvironment: null,
    };
  }
}

export function createInProcessCodexWorktreeWorkerPort(options: {
  readonly loadBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>;
} = {}): CodexWorktreeWorkerPort {
  return {
    create: async (input, createOptions) =>
      await executeCodexWorktreeWorkerCreate(input, {
        ...createOptions,
        loadBaseEnvironment: options.loadBaseEnvironment,
      }),
    remove: async (worktreeGitRoot) => {
      await removeManagedWorktree(worktreeGitRoot);
    },
  };
}
