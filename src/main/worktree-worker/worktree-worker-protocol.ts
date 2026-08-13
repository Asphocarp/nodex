import type {
  CodexWorktreeWorkerCreateInput,
  CodexWorktreeWorkerCreateResult,
  CodexWorktreeWorkerEvent,
} from "../codex/codex-worktree-worker-port";

export const CODEX_WORKTREE_WORKER_PROTOCOL_VERSION = 1 as const;

export type CodexWorktreeWorkerHostMessage =
  | {
      readonly type: "create";
      readonly id: string;
      readonly input: CodexWorktreeWorkerCreateInput;
    }
  | { readonly type: "remove"; readonly id: string; readonly worktreeGitRoot: string }
  | { readonly type: "cancel"; readonly id: string }
  | { readonly type: "shutdown" };

export type CodexWorktreeWorkerThreadMessage =
  | {
      readonly type: "ready";
      readonly epoch: number;
      readonly protocolVersion: typeof CODEX_WORKTREE_WORKER_PROTOCOL_VERSION;
    }
  | { readonly type: "event"; readonly id: string; readonly event: CodexWorktreeWorkerEvent }
  | {
      readonly type: "result";
      readonly id: string;
      readonly result:
        | { readonly type: "ok"; readonly value: CodexWorktreeWorkerCreateResult | null }
        | { readonly type: "error"; readonly message: string };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength = 8_192): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isStartingState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "working-tree") return true;
  return value.type === "branch"
    && isNonEmptyString(value.branchName, 1_024)
    && (value.remoteRef === undefined || isNonEmptyString(value.remoteRef, 2_048));
}

function isCreateInput(value: unknown): value is CodexWorktreeWorkerCreateInput {
  return isRecord(value)
    && isNonEmptyString(value.requestId, 1_024)
    && isNonEmptyString(value.hostId, 1_024)
    && isNonEmptyString(value.repositoryPath)
    && isNonEmptyString(value.nodexHome)
    && isNonEmptyString(value.projectId, 1_024)
    && isNonEmptyString(value.targetId, 1_024)
    && isNonEmptyString(value.threadTitle, 4_096)
    && (value.startingState === null || isStartingState(value.startingState))
    && (value.localEnvironmentConfigPath === null
      || isNonEmptyString(value.localEnvironmentConfigPath))
    && typeof value.setUpSyncedBranch === "boolean"
    && typeof value.propagateLocalWorkspaceFiles === "boolean";
}

export function isCodexWorktreeWorkerHostMessage(
  value: unknown,
): value is CodexWorktreeWorkerHostMessage {
  if (!isRecord(value)) return false;
  if (value.type === "shutdown") return true;
  if (value.type === "cancel") return isNonEmptyString(value.id, 1_024);
  if (value.type === "remove") {
    return isNonEmptyString(value.id, 1_024)
      && isNonEmptyString(value.worktreeGitRoot);
  }
  return value.type === "create"
    && isNonEmptyString(value.id, 1_024)
    && isCreateInput(value.input);
}

function isWorkerEvent(value: unknown): value is CodexWorktreeWorkerEvent {
  if (!isRecord(value)) return false;
  if (value.type === "setup-started") return true;
  if (value.type === "path-allocated") {
    return isNonEmptyString(value.worktreeGitRoot)
      && isNonEmptyString(value.worktreeWorkspaceRoot);
  }
  return value.type === "output"
    && (value.phase === "worktree" || value.phase === "setup")
    && (value.stream === "stdout" || value.stream === "stderr" || value.stream === "info")
    && typeof value.data === "string";
}

function isCreateResult(value: unknown): value is CodexWorktreeWorkerCreateResult {
  return isRecord(value)
    && isNonEmptyString(value.worktreeGitRoot)
    && isNonEmptyString(value.worktreeWorkspaceRoot)
    && (value.setupError === null || typeof value.setupError === "string")
    && (value.shellEnvironment === null || isRecord(value.shellEnvironment));
}

export function isCodexWorktreeWorkerThreadMessage(
  value: unknown,
): value is CodexWorktreeWorkerThreadMessage {
  if (!isRecord(value)) return false;
  if (value.type === "ready") {
    return Number.isSafeInteger(value.epoch)
      && value.protocolVersion === CODEX_WORKTREE_WORKER_PROTOCOL_VERSION;
  }
  if (value.type === "event") {
    return isNonEmptyString(value.id, 1_024) && isWorkerEvent(value.event);
  }
  if (value.type !== "result" || !isNonEmptyString(value.id, 1_024) || !isRecord(value.result)) {
    return false;
  }
  if (value.result.type === "error") return typeof value.result.message === "string";
  return value.result.type === "ok"
    && (value.result.value === null || isCreateResult(value.result.value));
}
