import { describe, expect, test } from "vitest";
import type { CodexPendingWorktreeCreateInput } from "../../shared/codex-pending-worktree";
import { BrowserPendingWorktreeFallback } from "./browser-pending-worktree-fallback";
import { browserRendererTransport } from "./browser-renderer-transport";

function startInput(): CodexPendingWorktreeCreateInput {
  return {
    hostId: "local",
    label: "Browser pending",
    sourceWorkspaceRoot: "/repo",
    startingState: { type: "branch", branchName: "main" },
    localEnvironmentConfigPath: null,
    prompt: "Keep this renderer-local",
    launchMode: "start-conversation",
    startConversationParamsInput: {
      input: [],
      commentAttachments: [],
      workspaceRoots: ["/repo"],
      cwd: "/repo",
      fileAttachments: [],
      addedFiles: [],
      agentMode: "auto",
      shouldSendPermissionOverrides: true,
      model: null,
      serviceTier: null,
      reasoningEffort: null,
      collaborationMode: null,
      config: {},
      threadSource: "user",
      workspaceKind: "project",
    },
    sourceConversationId: null,
    sourceCollaborationMode: null,
  };
}

describe("BrowserPendingWorktreeFallback", () => {
  test("allocates a queued row and waiting tracker without realizing work", () => {
    const ids = ["pending-id", "client-id"];
    const snapshots: number[] = [];
    const fallback = new BrowserPendingWorktreeFallback(
      () => ids.shift() ?? "unexpected",
      () => 42,
    );
    fallback.subscribe((entries) => snapshots.push(entries.length));

    const created = fallback.create(startInput());
    const entry = fallback.list()[0];

    expect(created.pendingWorktreeId).toBe("local:pending-id");
    expect(created.clientThreadId).toBe("client-new-thread:client-id");
    expect(entry?.phase).toBe("queued");
    expect(entry?.createdAt).toBe(42);
    expect(entry?.attempt).toBe(1);
    expect(fallback.resolveThread("client-new-thread:client-id")?.state).toBe("waiting");
    expect(JSON.stringify(snapshots)).toBe(JSON.stringify([1]));
  });

  test("applies local metadata and retry transitions, then removes tracker on cancel", () => {
    const ids = ["pending-id", "client-id"];
    const fallback = new BrowserPendingWorktreeFallback(() => ids.shift() ?? "unexpected");
    const created = fallback.create(startInput());

    fallback.rename(created.pendingWorktreeId, "Renamed");
    fallback.setPinned(created.pendingWorktreeId, true);
    fallback.setPinnedBeforeThreadId(created.pendingWorktreeId, "thread-after");
    fallback.retry(created.pendingWorktreeId);

    const retried = fallback.list()[0];
    expect(retried?.label).toBe("Renamed");
    expect(retried?.labelEdited).toBe(true);
    expect(retried?.isPinned).toBe(true);
    expect(retried?.pinnedBeforeThreadId).toBe("thread-after");
    expect(retried?.attempt).toBe(2);
    expect(retried?.phase).toBe("queued");

    fallback.setPinned(created.pendingWorktreeId, false);
    expect(fallback.list()[0]?.pinnedBeforeThreadId).toBe(null);
    fallback.cancel(created.pendingWorktreeId);
    expect(fallback.list().length).toBe(0);
    expect(fallback.resolveThread("client-new-thread:client-id")).toBe(null);
  });

  test("creates stable fallback rows without a client tracker", () => {
    const fallback = new BrowserPendingWorktreeFallback(() => "stable-id", () => 7);
    const created = fallback.create({
      hostId: "local",
      label: "Stable browser row",
      sourceWorkspaceRoot: "/repo",
      startingState: { type: "working-tree" },
      localEnvironmentConfigPath: null,
      prompt: "",
      launchMode: "create-stable-worktree",
      startConversationParamsInput: null,
      sourceConversationId: null,
      sourceCollaborationMode: null,
    });

    expect(created.pendingWorktreeId).toBe("local:stable-id");
    expect(created.clientThreadId).toBe(null);
    expect(fallback.list()[0]?.launchMode).toBe("create-stable-worktree");
    expect(fallback.resolveThread("client-new-thread:missing")).toBe(null);
  });

  test("connects the browser renderer transport to the local facade", async () => {
    let publicationCount = 0;
    const unsubscribe = browserRendererTransport.subscribeCodexPendingWorktreesChanged(() => {
      publicationCount += 1;
    });

    try {
      const created = await browserRendererTransport.invoke(
        "codex:pending-worktree:create",
        startInput(),
      );
      const result = created as { pendingWorktreeId: string; clientThreadId: string };
      const entries = await browserRendererTransport.invoke("codex:pending-worktrees:list") as
        readonly { id: string }[];
      const resolution = await browserRendererTransport.invoke(
        "codex:pending-worktree:resolve-thread",
        result.clientThreadId,
      ) as { state: string } | null;

      expect(entries.some((entry) => entry.id === result.pendingWorktreeId)).toBe(true);
      expect(resolution?.state).toBe("waiting");
      expect(publicationCount).toBe(1);

      await browserRendererTransport.invoke(
        "codex:pending-worktree:cancel",
        "local",
        result.pendingWorktreeId,
      );
      expect(publicationCount).toBe(2);
    } finally {
      unsubscribe();
    }
  });
});
