import { executeCodexWorktreeWorkerOperation } from "./codex-worktree-worker-operation";
import type {
  CodexWorktreeWorkerPort,
  CodexWorktreeWorkerRequest,
  CodexWorktreeWorkerRequestOptions,
  CodexWorktreeWorkerSuccess,
} from "./codex-worktree-worker-port";

/** In-process worker seam for tests that do not exercise transport or Scope ownership. */
export function createInProcessCodexWorktreeWorkerPort(
  options: {
    readonly hostId?: string;
    readonly loadBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>;
  } = {},
): CodexWorktreeWorkerPort {
  const hostId = options.hostId?.trim() || "local";
  const execute = async (
    request: CodexWorktreeWorkerRequest,
    requestOptions?: Partial<CodexWorktreeWorkerRequestOptions>,
  ): Promise<CodexWorktreeWorkerSuccess> =>
    await executeCodexWorktreeWorkerOperation(request, {
      signal: requestOptions?.signal ?? new AbortController().signal,
      onEvent: requestOptions?.onEvent ?? (() => undefined),
      loadBaseEnvironment: options.loadBaseEnvironment,
    });
  return {
    hostId,
    create: async (input, requestOptions) => {
      const success = await execute({ operation: "create", input }, requestOptions);
      if (success.operation !== "create") throw new Error("Worktree worker result mismatch");
      return success.value;
    },
    list: async (input, requestOptions) => {
      const success = await execute({ operation: "list", input }, requestOptions);
      if (success.operation !== "list") throw new Error("Worktree worker result mismatch");
      return success.value;
    },
    inspect: async (input, requestOptions) => {
      const success = await execute({ operation: "inspect", input }, requestOptions);
      if (success.operation !== "inspect") throw new Error("Worktree worker result mismatch");
      return success.value;
    },
    snapshot: async (input, requestOptions) => {
      const success = await execute({ operation: "snapshot", input }, requestOptions);
      if (success.operation !== "snapshot") throw new Error("Worktree worker result mismatch");
      return success.value;
    },
    remove: async (input, requestOptions) => {
      const success = await execute({ operation: "remove", input }, requestOptions);
      if (success.operation !== "remove") throw new Error("Worktree worker result mismatch");
      return success.value;
    },
    restore: async (input, requestOptions) => {
      const success = await execute({ operation: "restore", input }, requestOptions);
      if (success.operation !== "restore") throw new Error("Worktree worker result mismatch");
      return success.value;
    },
    setOwner: async (input, requestOptions) => {
      const success = await execute({ operation: "set-owner", input }, requestOptions);
      if (success.operation !== "set-owner") throw new Error("Worktree worker result mismatch");
      return success.value;
    },
    prepareHandoff: async (input, requestOptions) => {
      const success = await execute({ operation: "prepare-handoff", input }, requestOptions);
      if (success.operation !== "prepare-handoff") {
        throw new Error("Worktree worker result mismatch");
      }
      return success.value;
    },
    rollbackHandoff: async (input, requestOptions) => {
      const success = await execute({ operation: "rollback-handoff", input }, requestOptions);
      if (success.operation !== "rollback-handoff") {
        throw new Error("Worktree worker result mismatch");
      }
      return success.value;
    },
    cleanupHandoff: async (input, requestOptions) => {
      const success = await execute({ operation: "cleanup-handoff", input }, requestOptions);
      if (success.operation !== "cleanup-handoff") {
        throw new Error("Worktree worker result mismatch");
      }
      return success.value;
    },
    exportHandoff: async (input, requestOptions) => {
      const success = await execute({ operation: "export-handoff", input }, requestOptions);
      if (success.operation !== "export-handoff") {
        throw new Error("Worktree worker result mismatch");
      }
      return success.value;
    },
    importHandoff: async (input, requestOptions) => {
      const success = await execute({ operation: "import-handoff", input }, requestOptions);
      if (success.operation !== "import-handoff") {
        throw new Error("Worktree worker result mismatch");
      }
      return success.value;
    },
    cleanupTransferHandoff: async (input, requestOptions) => {
      const success = await execute(
        { operation: "cleanup-transfer-handoff", input },
        requestOptions,
      );
      if (success.operation !== "cleanup-transfer-handoff") {
        throw new Error("Worktree worker result mismatch");
      }
      return success.value;
    },
  };
}
