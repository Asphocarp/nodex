import type { IpcApi } from "../../shared/ipc-api";
import type {
  CodexPendingWorktreeCreateInput,
  CodexPendingWorktreeCreateResult,
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeThreadResolution,
  CodexPendingWorktreesChangedEvent,
} from "../../shared/codex-pending-worktree";
import type { CodexAgentMode } from "../../shared/types";
import { requireCodexWorktreeEnvironmentConfigPath } from "../../shared/codex-worktree-environment-path";
import { executionWorkspacePathKey } from "./codex-execution-workspace-roots";

export type CodexPendingWorktreeIpcChannel =
  | "codex:pending-worktrees:list"
  | "codex:pending-worktree:create"
  | "codex:pending-worktree:auto-fix"
  | "codex:pending-worktree:retry"
  | "codex:pending-worktree:work-locally"
  | "codex:pending-worktree:continue"
  | "codex:pending-worktree:cancel"
  | "codex:pending-worktree:dismiss"
  | "codex:pending-worktree:rename"
  | "codex:pending-worktree:set-pinned"
  | "codex:pending-worktree:set-pinned-before-thread"
  | "codex:pending-worktree:clear-attention"
  | "codex:pending-worktree:resolve-thread";

export type CodexPendingWorktreeIpcHandler<
  Channel extends CodexPendingWorktreeIpcChannel,
> = (
  event: unknown,
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

export interface CodexPendingWorktreeIpcService {
  listPendingWorktrees: () =>
    | readonly CodexPendingWorktreeEntry[]
    | Promise<readonly CodexPendingWorktreeEntry[]>;
  createPendingWorktree: (
    input: CodexPendingWorktreeCreateInput,
  ) => CodexPendingWorktreeCreateResult | Promise<CodexPendingWorktreeCreateResult>;
  createPendingWorktreeSetupRepair: (
    hostId: string,
    pendingWorktreeId: string,
    agentMode: CodexAgentMode,
  ) => CodexPendingWorktreeCreateResult | Promise<CodexPendingWorktreeCreateResult>;
  retryPendingWorktree: (hostId: string, pendingWorktreeId: string) => void | Promise<void>;
  workLocallyFromPendingWorktree: (
    hostId: string,
    pendingWorktreeId: string,
  ) =>
    | { readonly threadId: string }
    | Promise<{ readonly threadId: string }>;
  continuePendingWorktree: (hostId: string, pendingWorktreeId: string) => void | Promise<void>;
  cancelPendingWorktree: (hostId: string, pendingWorktreeId: string) => void | Promise<void>;
  dismissPendingWorktree: (hostId: string, pendingWorktreeId: string) => void | Promise<void>;
  renamePendingWorktree: (
    hostId: string,
    pendingWorktreeId: string,
    label: string,
  ) => void | Promise<void>;
  setPendingWorktreePinned: (
    hostId: string,
    pendingWorktreeId: string,
    isPinned: boolean,
  ) => void | Promise<void>;
  setPendingWorktreePinnedBeforeThreadId: (
    hostId: string,
    pendingWorktreeId: string,
    beforeThreadId: string | null,
  ) => void | Promise<void>;
  clearPendingWorktreeAttention: (
    hostId: string,
    pendingWorktreeId: string,
  ) => void | Promise<void>;
  resolvePendingWorktreeThread: (
    clientThreadId: string,
  ) =>
    | CodexPendingWorktreeThreadResolution
    | null
    | Promise<CodexPendingWorktreeThreadResolution | null>;
}

export interface CodexPendingWorktreeIpcRegistration {
  registerHandle: <Channel extends CodexPendingWorktreeIpcChannel>(
    channel: Channel,
    listener: CodexPendingWorktreeIpcHandler<Channel>,
  ) => void;
  service: CodexPendingWorktreeIpcService;
  subscribePendingWorktreesChanged?: (
    listener: (entries: CodexPendingWorktreesChangedEvent) => void,
  ) => void;
  broadcastPendingWorktreesChanged?: (
    entries: CodexPendingWorktreesChangedEvent,
  ) => void;
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requireLabel(value: string): string {
  const label = requireIdentifier(value, "Pending worktree label").trim();
  if (!label) throw new Error("Pending worktree label is required");
  return label;
}

function requireAgentMode(value: CodexAgentMode): CodexAgentMode {
  if (
    value !== "read-only"
    && value !== "auto"
    && value !== "granular"
    && value !== "guardian-approvals"
    && value !== "full-access"
    && value !== "custom"
  ) {
    throw new Error("Agent mode is invalid");
  }
  return value;
}

function requireSourceWorkspaceRoots(
  value: readonly string[],
  sourceWorkspaceRoot: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Source workspace roots are required");
  }
  for (const root of value) requireIdentifier(root, "Source workspace root");
  const primaryKey = executionWorkspacePathKey(sourceWorkspaceRoot);
  if (!value.some((root) => executionWorkspacePathKey(root) === primaryKey)) {
    throw new Error("Source workspace roots must contain the primary root");
  }
  return value;
}

function requireCreateInput(value: CodexPendingWorktreeCreateInput): CodexPendingWorktreeCreateInput {
  if (!value || typeof value !== "object") {
    throw new Error("Pending worktree create input is required");
  }
  requireIdentifier(value.hostId, "Host id");
  requireLabel(value.label);
  requireIdentifier(value.sourceWorkspaceRoot, "Source workspace root");
  requireIdentifier(value.prompt, "Pending worktree prompt");
  if (value.localEnvironmentConfigPath != null) {
    requireCodexWorktreeEnvironmentConfigPath(value.localEnvironmentConfigPath);
  }
  if (
    value.launchMode !== "create-stable-worktree"
    && value.launchMode !== "fork-conversation"
    && value.launchMode !== "start-conversation"
  ) {
    throw new Error("Pending worktree launch mode is invalid");
  }
  if (value.launchMode === "fork-conversation") {
    requireIdentifier(value.sourceConversationId, "Source conversation id");
    requireSourceWorkspaceRoots(value.sourceWorkspaceRoots, value.sourceWorkspaceRoot);
  }
  if (value.launchMode === "create-stable-worktree") {
    requireSourceWorkspaceRoots(value.sourceWorkspaceRoots, value.sourceWorkspaceRoot);
  }
  if (value.launchMode === "start-conversation" && !value.startConversationParamsInput) {
    throw new Error("Pending worktree start parameters are required");
  }
  return value;
}

export function registerCodexPendingWorktreeIpcHandlers(
  options: CodexPendingWorktreeIpcRegistration,
): void {
  options.registerHandle("codex:pending-worktrees:list", async () => {
    const entries = await options.service.listPendingWorktrees();
    return [...entries];
  });

  options.registerHandle("codex:pending-worktree:create", (_, input) =>
    options.service.createPendingWorktree(requireCreateInput(input)));

  options.registerHandle(
    "codex:pending-worktree:auto-fix",
    (_, hostId, pendingWorktreeId, agentMode) =>
      options.service.createPendingWorktreeSetupRepair(
        requireIdentifier(hostId, "Host id"),
        requireIdentifier(pendingWorktreeId, "Pending worktree id"),
        requireAgentMode(agentMode),
      ),
  );

  options.registerHandle("codex:pending-worktree:retry", async (_, hostId, pendingWorktreeId) => {
    await options.service.retryPendingWorktree(
      requireIdentifier(hostId, "Host id"),
      requireIdentifier(pendingWorktreeId, "Pending worktree id"),
    );
  });

  options.registerHandle(
    "codex:pending-worktree:work-locally",
    async (_, hostId, pendingWorktreeId) => {
      return await options.service.workLocallyFromPendingWorktree(
        requireIdentifier(hostId, "Host id"),
        requireIdentifier(pendingWorktreeId, "Pending worktree id"),
      );
    },
  );

  options.registerHandle("codex:pending-worktree:continue", async (_, hostId, pendingWorktreeId) => {
    await options.service.continuePendingWorktree(
      requireIdentifier(hostId, "Host id"),
      requireIdentifier(pendingWorktreeId, "Pending worktree id"),
    );
  });

  options.registerHandle("codex:pending-worktree:cancel", async (_, hostId, pendingWorktreeId) => {
    await options.service.cancelPendingWorktree(
      requireIdentifier(hostId, "Host id"),
      requireIdentifier(pendingWorktreeId, "Pending worktree id"),
    );
  });

  options.registerHandle("codex:pending-worktree:dismiss", async (_, hostId, pendingWorktreeId) => {
    await options.service.dismissPendingWorktree(
      requireIdentifier(hostId, "Host id"),
      requireIdentifier(pendingWorktreeId, "Pending worktree id"),
    );
  });

  options.registerHandle(
    "codex:pending-worktree:rename",
    async (_, hostId, pendingWorktreeId, label) => {
      await options.service.renamePendingWorktree(
        requireIdentifier(hostId, "Host id"),
        requireIdentifier(pendingWorktreeId, "Pending worktree id"),
        requireLabel(label),
      );
    },
  );

  options.registerHandle(
    "codex:pending-worktree:set-pinned",
    async (_, hostId, pendingWorktreeId, isPinned) => {
      await options.service.setPendingWorktreePinned(
        requireIdentifier(hostId, "Host id"),
        requireIdentifier(pendingWorktreeId, "Pending worktree id"),
        isPinned,
      );
    },
  );

  options.registerHandle(
    "codex:pending-worktree:set-pinned-before-thread",
    async (_, hostId, pendingWorktreeId, beforeThreadId) => {
      await options.service.setPendingWorktreePinnedBeforeThreadId(
        requireIdentifier(hostId, "Host id"),
        requireIdentifier(pendingWorktreeId, "Pending worktree id"),
        beforeThreadId === null ? null : requireIdentifier(beforeThreadId, "Before thread id"),
      );
    },
  );

  options.registerHandle(
    "codex:pending-worktree:clear-attention",
    async (_, hostId, pendingWorktreeId) => {
      await options.service.clearPendingWorktreeAttention(
        requireIdentifier(hostId, "Host id"),
        requireIdentifier(pendingWorktreeId, "Pending worktree id"),
      );
    },
  );

  options.registerHandle(
    "codex:pending-worktree:resolve-thread",
    (_, clientThreadId) =>
      options.service.resolvePendingWorktreeThread(
        requireIdentifier(clientThreadId, "Client thread id"),
      ),
  );

  if (!options.subscribePendingWorktreesChanged || !options.broadcastPendingWorktreesChanged) {
    return;
  }
  options.subscribePendingWorktreesChanged((entries) => {
    options.broadcastPendingWorktreesChanged?.([...entries]);
  });
}
