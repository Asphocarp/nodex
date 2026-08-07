import { describe, expect, test } from "vitest";
import type {
  CodexPendingWorktreeEntry,
  CodexPendingWorktreeThreadResolution,
} from "../../../shared/codex-pending-worktree";
import { codexWorktreeInitActivityLabel } from "../../lib/codex-worktree-init-activity";
import {
  resolvePendingWorktreeActivities,
  resolvePendingWorktreeRouteActions,
} from "./pending-worktree-route-model";

type StartConversationEntry = Extract<
  CodexPendingWorktreeEntry,
  { readonly launchMode: "start-conversation" }
>;

function makeEntry(
  overrides: Partial<StartConversationEntry> = {},
): StartConversationEntry {
  return {
    id: "local:pending-1",
    hostId: "local",
    label: "Implement renderer parity",
    sourceWorkspaceRoot: "/repo/nodex",
    startingState: { type: "branch", branchName: "main" },
    localEnvironmentConfigPath: null,
    prompt: "Implement renderer parity",
    launchMode: "start-conversation",
    clientThreadId: "client-new-thread:11111111-1111-4111-8111-111111111111",
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
    ...overrides,
  };
}

function waitingResolution(
  entry: CodexPendingWorktreeEntry,
): CodexPendingWorktreeThreadResolution {
  if (entry.launchMode === "create-stable-worktree") {
    throw new Error("A stable worktree has no client thread id");
  }
  return {
    state: "waiting",
    clientThreadId: entry.clientThreadId,
    pendingWorktreeId: entry.id,
  };
}

describe("pending worktree route model", () => {
  test("maps queued, setup, and conversation-start phases to the exact activity sequence", () => {
    const queued = makeEntry({ phase: "queued" });
    const queuedActivities = resolvePendingWorktreeActivities(queued, waitingResolution(queued));
    expect(queuedActivities.length).toBe(1);
    expect(codexWorktreeInitActivityLabel(queuedActivities[0]!)).toBe("Creating a worktree");
    expect(queuedActivities[0]?.status).toBe("running");

    const settingUp = makeEntry({
      phase: "setting-up",
      localEnvironmentConfigPath: "/repo/nodex/.codex/environments/default.toml",
      worktreeGitRoot: "/repo/worktrees/task",
      worktreeWorkspaceRoot: "/repo/worktrees/task",
      worktreeOutputText: "Preparing worktree\n",
      setupOutputText: "Installing dependencies\n",
    });
    const setupActivities = resolvePendingWorktreeActivities(
      settingUp,
      waitingResolution(settingUp),
    );
    expect(setupActivities.length).toBe(2);
    expect(setupActivities[0]?.status).toBe("completed");
    expect(setupActivities[1]?.status).toBe("running");
    expect(codexWorktreeInitActivityLabel(setupActivities[1]!)).toBe(
      "Setting up the environment",
    );

    const ready = makeEntry({
      phase: "worktree-ready",
      localEnvironmentConfigPath: "/repo/nodex/.codex/environments/default.toml",
      worktreeGitRoot: "/repo/worktrees/task",
      worktreeWorkspaceRoot: "/repo/worktrees/task",
    });
    const readyActivities = resolvePendingWorktreeActivities(ready, waitingResolution(ready));
    expect(readyActivities.map((activity) => activity.status).join(",")).toBe(
      "completed,completed,running",
    );
    expect(codexWorktreeInitActivityLabel(readyActivities[2]!)).toBe(
      "Starting the conversation",
    );
  });

  test("distinguishes creation failure, setup failure, skipped setup, and conversation failure", () => {
    const creationFailure = makeEntry({
      phase: "failed",
      errorMessage: "git worktree add failed",
    });
    const creationActivities = resolvePendingWorktreeActivities(
      creationFailure,
      {
        state: "failed",
        clientThreadId: creationFailure.clientThreadId,
        pendingWorktreeId: creationFailure.id,
        errorMessage: creationFailure.errorMessage,
      },
    );
    expect(creationActivities.map((activity) => activity.status).join(",")).toBe("failed");

    const setupFailure = makeEntry({
      phase: "failed",
      errorMessage: "setup failed",
      localEnvironmentConfigPath: "/repo/nodex/.codex/environments/default.toml",
      worktreeGitRoot: "/repo/worktrees/task",
      worktreeWorkspaceRoot: "/repo/worktrees/task",
    });
    const setupActivities = resolvePendingWorktreeActivities(
      setupFailure,
      {
        state: "failed",
        clientThreadId: setupFailure.clientThreadId,
        pendingWorktreeId: setupFailure.id,
        errorMessage: setupFailure.errorMessage,
      },
    );
    expect(setupActivities.map((activity) => activity.status).join(",")).toBe(
      "completed,failed",
    );

    const skippedSetup = makeEntry({
      phase: "worktree-ready",
      errorMessage: "setup failed",
      localEnvironmentConfigPath: "/repo/nodex/.codex/environments/default.toml",
      worktreeGitRoot: "/repo/worktrees/task",
      worktreeWorkspaceRoot: "/repo/worktrees/task",
    });
    expect(resolvePendingWorktreeActivities(
      skippedSetup,
      waitingResolution(skippedSetup),
    )[1]?.status).toBe("skipped");
  });

  test("exposes only the actions valid for each exact state", () => {
    const creating = makeEntry({ phase: "creating" });
    const creatingActions = resolvePendingWorktreeRouteActions(
      creating,
      waitingResolution(creating),
    );
    expect(`${creatingActions.canCancel},${creatingActions.canRetry},${creatingActions.canContinue},${creatingActions.canWorkLocally}`).toBe(
      "true,false,false,true",
    );

    const failedSetup = makeEntry({
      phase: "failed",
      worktreeGitRoot: "/repo/worktrees/task",
      worktreeWorkspaceRoot: "/repo/worktrees/task",
    });
    const failedActions = resolvePendingWorktreeRouteActions(
      failedSetup,
      {
        state: "failed",
        clientThreadId: failedSetup.clientThreadId,
        pendingWorktreeId: failedSetup.id,
        errorMessage: "setup failed",
      },
    );
    expect(`${failedActions.canCancel},${failedActions.canAutoFix},${failedActions.canRetry},${failedActions.canContinue}`).toBe(
      "false,false,true,true",
    );

    const repairableSetup = makeEntry({
      phase: "failed",
      localEnvironmentConfigPath: ".codex/environments/default.toml",
      worktreeGitRoot: "/repo/worktrees/task",
      worktreeWorkspaceRoot: "/repo/worktrees/task",
    });
    expect(resolvePendingWorktreeRouteActions(
      repairableSetup,
      waitingResolution(repairableSetup),
    ).canAutoFix).toBe(true);

    const ready = makeEntry({
      phase: "worktree-ready",
      worktreeGitRoot: "/repo/worktrees/task",
      worktreeWorkspaceRoot: "/repo/worktrees/task",
    });
    const failedConversationActions = resolvePendingWorktreeRouteActions(
      ready,
      {
        state: "failed",
        clientThreadId: ready.clientThreadId,
        pendingWorktreeId: ready.id,
        errorMessage: null,
      },
    );
    expect(`${failedConversationActions.canCancel},${failedConversationActions.canRetry},${failedConversationActions.canContinue}`).toBe(
      "false,true,false",
    );
  });
});
