import { describe, expect, test } from "vite-plus/test";
import type {
  CodexPendingStableWorktreeRequest,
  CodexPendingStartConversationRequest,
} from "../../shared/codex-pending-worktree";
import {
  CodexPendingWorktreeRuntime,
  type CodexPendingWorktreeCreationResult,
} from "./codex-pending-worktree-runtime";
import type { CodexWorktreeWorkerEvent } from "./codex-worktree-worker-port";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const TEST_RUNTIME_DEFAULTS = {
  cleanupGoalSources: async () => {},
};

function request(id = "local:pending-1"): CodexPendingStartConversationRequest {
  return {
    id,
    hostId: "local",
    label: "Delegated task",
    sourceWorkspaceRoot: "/source",
    startingState: { type: "branch", branchName: "main" },
    localEnvironmentConfigPath: null,
    prompt: "Implement it",
    launchMode: "start-conversation",
    clientThreadId: "client-new-thread:one",
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
  };
}

function goalRequest(id = "local:goal-pending"): CodexPendingStartConversationRequest {
  return {
    ...request(id),
    clientThreadId: "client-new-thread:goal",
    threadGoalDraft: {
      objective: "Ship the goal",
      pastedTextAttachments: [
        {
          file: {
            label: "Pasted text.txt",
            path: "/attachments/source/pasted-text.txt",
            fsPath: "/attachments/source/pasted-text.txt",
          },
          preview: "Goal source",
          characterCount: 11,
        },
      ],
      imageAttachments: [],
    },
  };
}

describe("Codex pending worktree runtime", () => {
  test("keeps allocated roots private until creation succeeds", async () => {
    const creation = deferred<CodexPendingWorktreeCreationResult>();
    const removed: string[] = [];
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) => {
        context.onEvent({
          operation: "create",
          type: "path-allocated",
          worktreeGitRoot: "/worktrees/a1b2/repo",
          worktreeWorkspaceRoot: "/worktrees/a1b2/repo/packages/app",
        });
        return await creation.promise;
      },
      launchConversation: async () => ({ threadId: "unexpected" }),
      removeWorktree: async (hostId, root) => {
        removed.push(`${hostId}:${root}`);
      },
    });

    try {
      runtime.create(request(), 42);
      expect(runtime.list()[0]?.worktreeGitRoot).toBe(null);
      expect(runtime.list()[0]?.worktreeWorkspaceRoot).toBe(null);

      runtime.cancel("local:pending-1");
      await flushAsyncWork();
      expect(runtime.list()).toHaveLength(0);
      expect(removed).toEqual([]);
    } finally {
      creation.reject(new Error("canceled"));
      runtime.shutdown();
    }
  });

  test("registers a ready stable workspace without creating a conversation", async () => {
    const registrations: string[] = [];
    let launchCount = 0;
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async () => ({
        worktreeGitRoot: "/worktree-stable",
        worktreeWorkspaceRoot: "/worktree-stable/packages/app",
      }),
      launchConversation: async () => {
        launchCount += 1;
        return { threadId: "unexpected" };
      },
      removeWorktree: async () => {},
      registerStableProject: (workspaceRoots, label) => {
        registrations.push(`${label}:${workspaceRoots.join("|")}`);
      },
    });
    const stableRequest: CodexPendingStableWorktreeRequest = {
      id: "local:stable-1",
      hostId: "local",
      label: "Persistent project",
      sourceWorkspaceRoot: "/source",
      sourceWorkspaceRoots: ["/source", "/shared"],
      startingState: { type: "branch", branchName: "HEAD" },
      localEnvironmentConfigPath: null,
      prompt: "Create a persistent project worktree",
      launchMode: "create-stable-worktree",
      startConversationParamsInput: null,
      sourceConversationId: null,
      sourceCollaborationMode: null,
    };

    try {
      runtime.create(stableRequest, 42);
      await flushAsyncWork();

      expect(registrations.join(",")).toBe(
        "Persistent project:/worktree-stable/packages/app|/shared",
      );
      expect(launchCount).toBe(0);
      expect(runtime.list().length).toBe(0);
    } finally {
      runtime.shutdown();
    }
  });

  test("retains a failed stable registration and lets cancel delete its worktree", async () => {
    const removed: string[] = [];
    const errors: string[] = [];
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async () => ({
        worktreeGitRoot: "/worktree-stable-failed",
        worktreeWorkspaceRoot: "/worktree-stable-failed/packages/app",
      }),
      launchConversation: async () => ({ threadId: "unexpected" }),
      removeWorktree: async (_hostId, worktreeGitRoot) => {
        removed.push(worktreeGitRoot);
      },
      registerStableProject: async () => {
        throw new Error("project registration failed");
      },
      onError: (phase, error) => {
        errors.push(`${phase}:${error instanceof Error ? error.message : String(error)}`);
      },
    });
    const stableRequest: CodexPendingStableWorktreeRequest = {
      id: "local:stable-failed",
      hostId: "local",
      label: "Persistent project",
      sourceWorkspaceRoot: "/source",
      sourceWorkspaceRoots: ["/source"],
      startingState: { type: "branch", branchName: "HEAD" },
      localEnvironmentConfigPath: null,
      prompt: "Create a persistent project worktree",
      launchMode: "create-stable-worktree",
      startConversationParamsInput: null,
      sourceConversationId: null,
      sourceCollaborationMode: null,
    };

    try {
      runtime.create(stableRequest, 42);
      await flushAsyncWork();

      const failed = runtime.list()[0];
      expect(failed?.phase).toBe("failed");
      expect(failed?.worktreeGitRoot).toBe("/worktree-stable-failed");
      expect(failed?.needsAttention).toBe(true);
      expect(errors.join(",")).toBe("register-stable-project:project registration failed");

      runtime.cancel(stableRequest.id);
      await flushAsyncWork();
      expect(runtime.list().length).toBe(0);
      expect(removed.join(",")).toBe("/worktree-stable-failed");
    } finally {
      runtime.shutdown();
    }
  });

  test("creates, streams, launches, and resolves a queued client thread", async () => {
    const creation = deferred<CodexPendingWorktreeCreationResult>();
    const launch = deferred<{ threadId: string }>();
    const outputs: string[] = [];
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) => {
        context.onEvent({
          operation: "create",
          type: "output",
          phase: "worktree",
          stream: "stdout",
          data: "cloning\n",
        });
        return await creation.promise;
      },
      launchConversation: async (entry, workspaceRoot) => {
        outputs.push(`${entry.id}:${workspaceRoot}`);
        return await launch.promise;
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      expect(runtime.list()[0]?.phase).toBe("creating");
      expect(runtime.list()[0]?.worktreeOutputText).toBe(
        "[info] Starting worktree creation\ncloning\n",
      );
      expect(runtime.resolveThread("client-new-thread:one")?.state).toBe("waiting");

      creation.resolve({
        worktreeGitRoot: "/worktree-git-root",
        worktreeWorkspaceRoot: "/worktree-git-root/packages/app",
      });
      await flushAsyncWork();
      expect(runtime.list()[0]?.phase).toBe("worktree-ready");
      expect(outputs[0]).toBe("local:pending-1:/worktree-git-root/packages/app");

      launch.resolve({ threadId: "thread-created" });
      await flushAsyncWork();
      expect(runtime.list().length).toBe(0);
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
    } finally {
      runtime.shutdown();
    }
  });

  test("ignores late tagged events from a superseded creation attempt", async () => {
    const secondCreation = deferred<CodexPendingWorktreeCreationResult>();
    const attemptEvents: Array<(event: CodexWorktreeWorkerEvent) => void> = [];
    let creationAttempt = 0;
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) => {
        creationAttempt += 1;
        attemptEvents.push(context.onEvent);
        if (creationAttempt === 1) throw new Error("first creation failed");
        return await secondCreation.promise;
      },
      launchConversation: async () => ({ threadId: "thread-after-retry" }),
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      await flushAsyncWork();
      expect(runtime.list()[0]?.phase).toBe("failed");

      runtime.retry("local:pending-1");
      expect(attemptEvents).toHaveLength(2);
      const beforeLateEvents = runtime.list()[0];
      expect(beforeLateEvents?.attempt).toBe(2);
      expect(beforeLateEvents?.phase).toBe("creating");

      attemptEvents[0]?.({
        operation: "create",
        type: "path-allocated",
        worktreeGitRoot: "/stale/worktree",
        worktreeWorkspaceRoot: "/stale/worktree/packages/app",
      });
      attemptEvents[0]?.({ operation: "create", type: "setup-started" });
      attemptEvents[0]?.({
        operation: "create",
        type: "output",
        phase: "worktree",
        stream: "stderr",
        data: "stale output\n",
      });
      attemptEvents[1]?.({
        operation: "create",
        type: "output",
        phase: "worktree",
        stream: "stdout",
        data: "",
      });

      expect(runtime.list()[0]).toBe(beforeLateEvents);
      attemptEvents[1]?.({
        operation: "create",
        type: "path-allocated",
        worktreeGitRoot: "/current/worktree",
        worktreeWorkspaceRoot: "/current/worktree/packages/app",
      });
      expect(runtime.list()[0]).toMatchObject({
        attempt: 2,
        phase: "creating",
        worktreeGitRoot: null,
        worktreeWorkspaceRoot: null,
        worktreeOutputText: "[info] Starting worktree creation\n",
      });
    } finally {
      secondCreation.resolve({
        worktreeGitRoot: "/current/worktree",
        worktreeWorkspaceRoot: "/current/worktree/packages/app",
      });
      await flushAsyncWork();
      runtime.shutdown();
    }
  });

  test("executes goal-source cleanup from the frozen entry on success and cancel", async () => {
    const cleaned: string[] = [];
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async () => ({
        worktreeGitRoot: "/goal-worktree",
        worktreeWorkspaceRoot: "/goal-worktree/workspace",
      }),
      launchConversation: async () => ({ threadId: "thread-goal" }),
      removeWorktree: async () => {},
      cleanupGoalSources: async (entry) => {
        const source =
          entry.launchMode === "start-conversation"
            ? entry.threadGoalDraft?.pastedTextAttachments?.[0]?.file?.path
            : null;
        if (source) cleaned.push(`${entry.id}:${source}`);
      },
    });

    try {
      runtime.create(goalRequest(), 42);
      await flushAsyncWork();
      await flushAsyncWork();
      expect(cleaned.join(",")).toBe("local:goal-pending:/attachments/source/pasted-text.txt");

      runtime.create(goalRequest("local:goal-cancel"), 43);
      runtime.cancel("local:goal-cancel");
      await flushAsyncWork();
      expect(cleaned.join(",")).toBe(
        "local:goal-pending:/attachments/source/pasted-text.txt,local:goal-cancel:/attachments/source/pasted-text.txt",
      );
    } finally {
      runtime.shutdown();
    }
  });

  test("retries only the failed conversation start when its worktree is ready", async () => {
    let launchAttempt = 0;
    let createAttempt = 0;
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async () => {
        createAttempt += 1;
        return {
          worktreeGitRoot: "/worktree",
          worktreeWorkspaceRoot: "/worktree",
        };
      },
      launchConversation: async () => {
        launchAttempt += 1;
        if (launchAttempt === 1) throw new Error("thread start failed");
        return { threadId: "thread-retried" };
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      await flushAsyncWork();
      expect(runtime.resolveThread("client-new-thread:one")?.state).toBe("failed");

      runtime.retry("local:pending-1");
      await flushAsyncWork();
      expect(createAttempt).toBe(1);
      expect(launchAttempt).toBe(2);
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
    } finally {
      runtime.shutdown();
    }
  });

  test("keeps a mapped thread successful when post-create metadata fails", async () => {
    const events: string[] = [];
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async () => ({
        worktreeGitRoot: "/worktree",
        worktreeWorkspaceRoot: "/worktree",
      }),
      launchConversation: async (_entry, _workspaceRoot, context) => {
        events.push("launch");
        context.onThreadCreated("thread-metadata-warning");
        expect(runtime.resolveThread("client-new-thread:one")?.state).toBe("starting");
        events.push("metadata");
        throw new Error("owner metadata failed");
      },
      onConversationThreadMapped: ({ threadId }) => {
        events.push(`promote:${threadId}`);
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      await flushAsyncWork();

      expect(runtime.list().length).toBe(0);
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
      expect(events.join(",")).toBe("launch,promote:thread-metadata-warning,metadata");
    } finally {
      runtime.shutdown();
    }
  });

  test("waits for asynchronous mapped-thread work before completing the launch", async () => {
    const promotion = deferred<void>();
    const events: string[] = [];
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async () => ({
        worktreeGitRoot: "/worktree",
        worktreeWorkspaceRoot: "/worktree",
      }),
      launchConversation: async (_entry, _workspaceRoot, context) => {
        context.onThreadCreated("thread-async-promotion");
        events.push("launched");
        return { threadId: "thread-async-promotion" };
      },
      onConversationThreadMapped: async () => {
        events.push("promoting");
        await promotion.promise;
        events.push("promoted");
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      await flushAsyncWork();

      expect(events.join(",")).toBe("promoting,launched");
      expect(runtime.resolveThread("client-new-thread:one")?.state).toBe("starting");

      promotion.resolve(undefined);
      await flushAsyncWork();

      expect(events.join(",")).toBe("promoting,launched,promoted");
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
    } finally {
      runtime.shutdown();
    }
  });

  test("keeps a mapped thread successful when snapshot promotion throws", async () => {
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async () => ({
        worktreeGitRoot: "/worktree",
        worktreeWorkspaceRoot: "/worktree",
      }),
      launchConversation: async (_entry, _workspaceRoot, context) => {
        context.onThreadCreated("thread-transfer-warning");
        throw new Error("unreachable after promotion throw");
      },
      onConversationThreadMapped: () => {
        throw new Error("snapshot promotion failed");
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      await flushAsyncWork();

      expect(runtime.list().length).toBe(0);
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
    } finally {
      runtime.shutdown();
    }
  });

  test("continues after a setup failure without recreating the worktree", async () => {
    let launchAttempt = 0;
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) => {
        context.onEvent({ operation: "create", type: "setup-started" });
        context.onEvent({
          operation: "create",
          type: "output",
          phase: "setup",
          stream: "stdout",
          data: "setup output\n",
        });
        return {
          worktreeGitRoot: "/worktree",
          worktreeWorkspaceRoot: "/worktree",
          setupError: "setup failed",
        };
      },
      launchConversation: async () => {
        launchAttempt += 1;
        return { threadId: "thread-without-setup" };
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      await flushAsyncWork();
      expect(runtime.list()[0]?.phase).toBe("failed");
      expect(runtime.list()[0]?.setupOutputText).toBe("setup output\n");
      expect(launchAttempt).toBe(0);

      runtime.continueWithoutSetup("local:pending-1");
      await flushAsyncWork();
      expect(launchAttempt).toBe(1);
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
    } finally {
      runtime.shutdown();
    }
  });

  test("works locally by aborting setup and launching without worktree init", async () => {
    const launches: string[] = [];
    const mappedHooks: string[] = [];
    const launch = deferred<{ threadId: string }>();
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) =>
        await new Promise((_, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
      launchConversation: async (entry, workspaceRoot, context) => {
        launches.push(
          `${entry.clientThreadId}:${workspaceRoot}:${String(context.includeWorktreeInit)}`,
        );
        return await launch.promise;
      },
      onConversationThreadMapped: ({ threadId }) => {
        mappedHooks.push(threadId);
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      let settled = false;
      const localLaunch = runtime.workLocally("local:pending-1").finally(() => {
        settled = true;
      });
      await flushAsyncWork();

      expect(launches.join(",")).toBe("client-new-thread:one:/source:false");
      expect(runtime.list().length).toBe(0);
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
      expect(settled).toBe(false);

      launch.resolve({ threadId: "thread-local" });
      const launched = await localLaunch;
      expect(launched.threadId).toBe("thread-local");
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
      expect(mappedHooks.length).toBe(0);
    } finally {
      runtime.shutdown();
    }
  });

  test("rejects a failed local launch without retaining pending setup state", async () => {
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) =>
        await new Promise((_, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
      launchConversation: async () => {
        throw new Error("source launch failed");
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      let message = "";
      try {
        await runtime.workLocally("local:pending-1");
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toBe("source launch failed");
      expect(runtime.list().length).toBe(0);
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
    } finally {
      runtime.shutdown();
    }
  });

  test("resolves work-locally after mapping even when later metadata throws", async () => {
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) =>
        await new Promise((_, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
      launchConversation: async (_entry, _workspaceRoot, context) => {
        context.onThreadCreated("thread-local-mapped");
        throw new Error("metadata failed");
      },
      removeWorktree: async () => {},
    });

    try {
      runtime.create(request(), 42);
      const result = await runtime.workLocally("local:pending-1");
      expect(result.threadId).toBe("thread-local-mapped");
      expect(runtime.resolveThread("client-new-thread:one")).toBe(null);
    } finally {
      runtime.shutdown();
    }
  });

  test("cancel aborts creation and dismiss cleans a failed allocated worktree", async () => {
    const firstCreation = deferred<CodexPendingWorktreeCreationResult>();
    const removed: string[] = [];
    let creationAttempt = 0;
    const runtime = new CodexPendingWorktreeRuntime({
      ...TEST_RUNTIME_DEFAULTS,
      createWorktree: async (_entry, context) => {
        creationAttempt += 1;
        if (creationAttempt === 1) {
          return await new Promise<CodexPendingWorktreeCreationResult>((_resolve, reject) => {
            context.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
        }
        context.onEvent({ operation: "create", type: "setup-started" });
        return await firstCreation.promise;
      },
      launchConversation: async () => ({ threadId: "unused" }),
      removeWorktree: async (_hostId, root) => {
        removed.push(root);
      },
    });

    try {
      runtime.create(request(), 42);
      runtime.cancel("local:pending-1");
      await flushAsyncWork();
      expect(runtime.list().length).toBe(0);

      runtime.create(request("local:pending-2"), 43);
      firstCreation.resolve({
        worktreeGitRoot: "/failed-worktree",
        worktreeWorkspaceRoot: "/failed-worktree",
        setupError: "setup failed",
      });
      await flushAsyncWork();
      runtime.dismiss("local:pending-2");
      await flushAsyncWork();
      expect(removed[0]).toBe("/failed-worktree");
    } finally {
      runtime.shutdown();
    }
  });
});
