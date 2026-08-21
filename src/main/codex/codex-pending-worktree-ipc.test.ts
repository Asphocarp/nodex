import { beforeEach, describe, expect, test } from "vitest";
import type { IpcApi } from "../../shared/ipc-api";
import type {
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeThreadResolution,
  CodexPendingWorktreesChangedEvent,
} from "../../shared/codex-pending-worktree";
import {
  registerCodexPendingWorktreeIpcHandlers,
  type CodexPendingWorktreeIpcChannel,
  type CodexPendingWorktreeIpcHandler,
} from "./codex-pending-worktree-ipc";

type RegisteredHandler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, RegisteredHandler>();
const actions: string[] = [];
const entries: CodexPendingWorktreeEntry[] = [
  {
    id: "pending-1",
    hostId: "local",
    label: "Delegated task",
    initialThreadTitle: "Delegated task",
    sourceWorkspaceRoot: "/repo",
    startingState: { type: "working-tree" },
    localEnvironmentConfigPath: null,
    prompt: "Do the work",
    launchMode: "start-conversation",
    clientThreadId: "client-1",
    startConversationParamsInput: {
      input: [],
      commentAttachments: [],
      workspaceRoots: ["/repo"],
      cwd: "/repo",
      fileAttachments: [],
      addedFiles: [],
      agentMode: "auto",
      permissionProfileId: undefined,
      shouldSendPermissionOverrides: true,
      model: null,
      serviceTier: null,
      reasoningEffort: null,
      collaborationMode: null,
      config: {},
      threadSource: "subagent",
      workspaceKind: "project",
      serviceName: undefined,
      projectAssignment: {
        projectKind: "local",
        projectId: "project-pending",
        pendingCoreUpdate: false,
      },
    },
    sourceConversationId: null,
    sourceCollaborationMode: null,
    createdAt: 1,
    attempt: 1,
    phase: "queued",
    labelEdited: false,
    worktreeOutputText: "",
    setupOutputText: "",
    errorMessage: null,
    worktreeWorkspaceRoot: null,
    worktreeGitRoot: null,
    needsAttention: false,
    isPinned: false,
    pinnedBeforeThreadId: null,
  },
];

let changedListener: ((event: CodexPendingWorktreesChangedEvent) => void) | null = null;
let broadcastEvent: CodexPendingWorktreesChangedEvent | null = null;
let workLocallyResult: Promise<{ readonly threadId: string }>;

async function invoke<Channel extends CodexPendingWorktreeIpcChannel>(
  channel: Channel,
  ...args: IpcApi[Channel]["args"]
): Promise<IpcApi[Channel]["result"]> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return (await handler(null, ...args)) as IpcApi[Channel]["result"];
}

beforeEach(() => {
  handlers.clear();
  actions.length = 0;
  changedListener = null;
  broadcastEvent = null;
  workLocallyResult = Promise.resolve({ threadId: "thread-local" });
  registerCodexPendingWorktreeIpcHandlers({
    registerHandle: <Channel extends CodexPendingWorktreeIpcChannel>(
      channel: Channel,
      handler: CodexPendingWorktreeIpcHandler<Channel>,
    ) => {
      handlers.set(channel, handler as RegisteredHandler);
    },
    service: {
      listPendingWorktrees: () => entries,
      createPendingWorktree: (input) => {
        actions.push(`create:${input.hostId}:${input.launchMode}:${input.label}`);
        return {
          pendingWorktreeId: `${input.hostId}:created`,
          clientThreadId: input.launchMode === "create-stable-worktree" ? null : "client-created",
        };
      },
      createPendingWorktreeSetupRepair: (hostId, id, agentMode) => {
        actions.push(`auto-fix:${hostId}:${id}:${agentMode}`);
        return {
          pendingWorktreeId: `${hostId}:repair`,
          clientThreadId: "client-repair",
        };
      },
      retryPendingWorktree: (hostId, id) => {
        actions.push(`retry:${hostId}:${id}`);
      },
      workLocallyFromPendingWorktree: (hostId, id) => {
        actions.push(`work-locally:${hostId}:${id}`);
        return workLocallyResult;
      },
      continuePendingWorktree: (hostId, id) => {
        actions.push(`continue:${hostId}:${id}`);
      },
      cancelPendingWorktree: (hostId, id) => {
        actions.push(`cancel:${hostId}:${id}`);
      },
      dismissPendingWorktree: (hostId, id) => {
        actions.push(`dismiss:${hostId}:${id}`);
      },
      renamePendingWorktree: (hostId, id, label) => {
        actions.push(`rename:${hostId}:${id}:${label}`);
      },
      setPendingWorktreePinned: (hostId, id, isPinned) => {
        actions.push(`pin:${hostId}:${id}:${String(isPinned)}`);
      },
      setPendingWorktreePinnedBeforeThreadId: (hostId, id, beforeThreadId) => {
        actions.push(`pin-before:${hostId}:${id}:${beforeThreadId ?? "end"}`);
      },
      clearPendingWorktreeAttention: (hostId, id) => {
        actions.push(`clear-attention:${hostId}:${id}`);
      },
      resolvePendingWorktreeThread: (clientThreadId) =>
        clientThreadId === "client-1"
          ? { state: "succeeded", clientThreadId, threadId: "thread-1" }
          : null,
    },
    subscribePendingWorktreesChanged: (listener) => {
      changedListener = listener;
    },
    broadcastPendingWorktreesChanged: (event) => {
      broadcastEvent = event;
    },
  });
});

describe("Codex pending worktree IPC", () => {
  test("registers the query, resolve, and action channels", () => {
    for (const channel of [
      "codex:pending-worktrees:list",
      "codex:pending-worktree:create",
      "codex:pending-worktree:auto-fix",
      "codex:pending-worktree:retry",
      "codex:pending-worktree:work-locally",
      "codex:pending-worktree:continue",
      "codex:pending-worktree:cancel",
      "codex:pending-worktree:dismiss",
      "codex:pending-worktree:rename",
      "codex:pending-worktree:set-pinned",
      "codex:pending-worktree:set-pinned-before-thread",
      "codex:pending-worktree:clear-attention",
      "codex:pending-worktree:resolve-thread",
    ]) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  test("validates and forwards generic creation and setup repair", async () => {
    const created = await invoke("codex:pending-worktree:create", {
      hostId: "local",
      label: "Persistent worktree",
      sourceWorkspaceRoot: "/repo",
      sourceWorkspaceRoots: ["/repo", "/shared"],
      startingState: { type: "branch", branchName: "HEAD" },
      localEnvironmentConfigPath: null,
      prompt: "Create a persistent project worktree",
      launchMode: "create-stable-worktree",
      startConversationParamsInput: null,
      sourceConversationId: null,
      sourceCollaborationMode: null,
    });
    const repair = await invoke(
      "codex:pending-worktree:auto-fix",
      "local",
      "pending-1",
      "full-access",
    );

    expect(created.pendingWorktreeId).toBe("local:created");
    expect(created.clientThreadId).toBe(null);
    expect(repair.clientThreadId).toBe("client-repair");
    expect(actions.join(",")).toBe(
      "create:local:create-stable-worktree:Persistent worktree,auto-fix:local:pending-1:full-access",
    );
  });

  test("returns an isolated pending-worktree snapshot", async () => {
    const result = await invoke("codex:pending-worktrees:list");
    expect(result === entries).toBe(false);
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("pending-1");
    result.pop();
    expect(entries.length).toBe(1);
  });

  test("rejects an invalid Auto-fix agent mode at the IPC boundary", async () => {
    const handler = handlers.get("codex:pending-worktree:auto-fix");
    if (!handler) throw new Error("Missing Auto-fix handler");
    let message = "";
    try {
      await handler(null, "local", "pending-1", "unsafe-mode");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Agent mode is invalid");
    expect(actions.length).toBe(0);
  });

  test("rejects stable and fork requests that omit their primary source root", async () => {
    const handler = handlers.get("codex:pending-worktree:create");
    if (!handler) throw new Error("Missing create handler");
    expect(() =>
      handler(null, {
        hostId: "local",
        label: "Invalid worktree",
        sourceWorkspaceRoot: "/repo",
        sourceWorkspaceRoots: ["/shared"],
        prompt: "Create a worktree",
        launchMode: "create-stable-worktree",
        startConversationParamsInput: null,
        sourceConversationId: null,
        sourceCollaborationMode: null,
      }),
    ).toThrow("Source workspace roots must contain the primary root");
    expect(actions.length).toBe(0);
  });

  test("rejects non-portable environment selections at the IPC boundary", () => {
    const handler = handlers.get("codex:pending-worktree:create");
    if (!handler) throw new Error("Missing create handler");
    expect(() =>
      handler(null, {
        hostId: "local",
        label: "Invalid worktree",
        sourceWorkspaceRoot: "/repo",
        sourceWorkspaceRoots: ["/repo"],
        localEnvironmentConfigPath: "/repo/.codex/environments/environment.toml",
        prompt: "Create a worktree",
        launchMode: "create-stable-worktree",
        startConversationParamsInput: null,
        sourceConversationId: null,
        sourceCollaborationMode: null,
      }),
    ).toThrow("workspace-relative .toml file inside .codex/environments");
    expect(actions.length).toBe(0);
  });

  test("forwards lifecycle and metadata actions in order", async () => {
    await invoke("codex:pending-worktree:retry", "local", "pending-1");
    await invoke("codex:pending-worktree:work-locally", "local", "pending-1");
    await invoke("codex:pending-worktree:continue", "local", "pending-1");
    await invoke("codex:pending-worktree:cancel", "local", "pending-1");
    await invoke("codex:pending-worktree:dismiss", "local", "pending-1");
    await invoke("codex:pending-worktree:rename", "local", "pending-1", "Renamed");
    await invoke("codex:pending-worktree:set-pinned", "local", "pending-1", true);
    await invoke(
      "codex:pending-worktree:set-pinned-before-thread",
      "local",
      "pending-1",
      "thread-next",
    );
    await invoke("codex:pending-worktree:clear-attention", "local", "pending-1");
    expect(actions.join(",")).toBe(
      "retry:local:pending-1,work-locally:local:pending-1,continue:local:pending-1,cancel:local:pending-1,dismiss:local:pending-1,rename:local:pending-1:Renamed,pin:local:pending-1:true,pin-before:local:pending-1:thread-next,clear-attention:local:pending-1",
    );
  });

  test("keeps the work-locally IPC request pending until the mapped launch settles", async () => {
    let resolveLaunch!: (result: { readonly threadId: string }) => void;
    workLocallyResult = new Promise((resolve) => {
      resolveLaunch = resolve;
    });
    let settled = false;
    const invocation = invoke("codex:pending-worktree:work-locally", "local", "pending-1").finally(
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(settled).toBe(false);
    resolveLaunch({ threadId: "thread-local" });
    await expect(invocation).resolves.toEqual({ threadId: "thread-local" });
    expect(settled).toBe(true);
  });

  test("resolves successful and missing client thread ids", async () => {
    const succeeded = await invoke("codex:pending-worktree:resolve-thread", "client-1");
    const missing = await invoke("codex:pending-worktree:resolve-thread", "missing");
    expect(succeeded?.state).toBe("succeeded");
    expect(
      (succeeded as CodexPendingWorktreeThreadResolution & { threadId: string }).threadId,
    ).toBe("thread-1");
    expect(missing).toBe(null);
  });

  test("rejects empty action and resolution identifiers", async () => {
    let actionError = "";
    let resolutionError = "";
    try {
      await invoke("codex:pending-worktree:retry", "local", "");
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    }
    try {
      await invoke("codex:pending-worktree:resolve-thread", "");
    } catch (error) {
      resolutionError = error instanceof Error ? error.message : String(error);
    }
    expect(actionError).toBe("Pending worktree id is required");
    expect(resolutionError).toBe("Client thread id is required");
    expect(actions.length).toBe(0);
  });

  test("forwards changed snapshots as isolated event arrays", () => {
    const listener = changedListener as ((event: CodexPendingWorktreesChangedEvent) => void) | null;
    if (!listener) throw new Error("Missing pending worktree change listener");
    listener(entries);
    expect(broadcastEvent === entries).toBe(false);
    expect(broadcastEvent?.[0]?.id).toBe("pending-1");
  });
});
