import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  CodexThreadExecutionLocationService,
  type CodexThreadExecutionLocationEffects,
  type CodexThreadHandoffPreparation,
} from "./codex-thread-execution-location-service";
import {
  CodexThreadHandoffJournalStore,
  type CodexThreadExecutionLocation,
  type CodexThreadHandoffJournalEntry,
} from "./codex-thread-handoff-journal";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
});

async function makeJournal(): Promise<{
  readonly filePath: string;
  readonly store: CodexThreadHandoffJournalStore;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "nodex-thread-handoff-service-"));
  temporaryRoots.push(root);
  const filePath = path.join(root, "recovery", "handoffs.json");
  return { filePath, store: new CodexThreadHandoffJournalStore(filePath) };
}

const source: CodexThreadExecutionLocation = {
  hostId: "local",
  cwd: "/repo/source/packages/app",
  workspaceRoots: ["/repo/source", "/repo/shared"],
  managedWorktreePath: null,
  projectId: "project-1",
  projectlessOutputDirectory: null,
  projectlessWorkspaceBrowserRoot: null,
};

const destination: CodexThreadExecutionLocation = {
  ...source,
  cwd: "/managed/abcd/repo/packages/app",
  workspaceRoots: ["/managed/abcd/repo", "/repo/shared"],
  managedWorktreePath: "/managed/abcd/repo",
};

const preparation: CodexThreadHandoffPreparation = {
  destination,
  prepared: {
    direction: "to-worktree",
    sourceBranch: "main",
    localCheckoutBranch: "main",
    destinationBranch: "codex/task",
    sourceWorkspaceRoot: "/repo/source",
    destinationWorkspaceRoot: "/managed/abcd/repo",
    destinationGitRoot: "/managed/abcd/repo",
    managedWorktreePath: "/managed/abcd/repo",
    createdWorktree: true,
    warnings: [],
  },
};

const crossHostPreparation: CodexThreadHandoffPreparation = {
  destination: {
    ...destination,
    hostId: "ssh:build",
  },
  prepared: {
    direction: "cross-host",
    sourceHostId: "local",
    destinationHostId: "ssh:build",
    transferId: "a".repeat(32),
    sourceBranch: "main",
    sourceWorkspaceRoot: "/repo/source",
    sourceManagedWorktreePath: null,
    destinationWorkspaceRoot: "/remote/worktrees/abcd/repo",
    destinationGitRoot: "/remote/worktrees/abcd/repo",
    managedWorktreePath: "/remote/worktrees/abcd/repo",
    createdWorktree: true,
    sourceRepositoryPath: "/repo/source",
    destinationRepositoryPath: "/remote/source/repo",
    sourceTemporaryRef: "refs/codex/handoff/source/operation-remote",
    destinationTemporaryRef: "refs/codex/handoff/destination/operation-remote",
    sourceStagingRoot: "/state/handoffs",
    destinationStagingRoot: "/remote/.codex/nodex-handoffs",
    relayRoot: "/state/handoffs/operation-remote/relay",
    sourceBundle: { path: "/state/handoffs/source.bundle", sha256: "a".repeat(64), size: 10 },
    destinationBundle: {
      path: "/remote/.codex/nodex-handoffs/source.bundle",
      sha256: "a".repeat(64),
      size: 10,
    },
    sourceRollout: { path: "/state/sessions/thread.jsonl", sha256: "b".repeat(64), size: 20 },
    destinationRollout: {
      path: "/remote/.codex/sessions/thread.jsonl",
      sha256: "b".repeat(64),
      size: 20,
    },
    destinationRolloutCreated: true,
    warnings: [],
  },
};

function makeEffects(input: {
  readonly calls: string[];
  readonly canonical?: CodexThreadExecutionLocation | null;
  readonly fail?: string;
  readonly cleanupWarnings?: readonly string[];
}): CodexThreadExecutionLocationEffects {
  const record = async (name: string): Promise<void> => {
    input.calls.push(name);
    if (input.fail === name) throw new Error(`${name} failed`);
  };
  return {
    resolveSource: async () => source,
    readCanonicalLocation: async () => input.canonical ?? source,
    stopActiveTurn: async () => await record("stop"),
    prepareDestination: async () => {
      await record("prepare");
      return preparation;
    },
    switchRuntime: async (_threadId, location) =>
      await record(location === source ? "runtime:source" : "runtime:destination"),
    commitLocation: async (_threadId, location) =>
      await record(location === source ? "core:source" : "core:destination"),
    projectLocation: async (_threadId, location) =>
      await record(location === source ? "project:source" : "project:destination"),
    transferOwner: async () => await record("owner"),
    cleanup: async () => {
      await record("cleanup");
      return input.cleanupWarnings ?? [];
    },
    rollbackPreparation: async () => {
      await record("git:rollback");
      return [];
    },
    sendFollowUp: async () => await record("follow-up"),
  };
}

function makeEntry(
  patch: Partial<CodexThreadHandoffJournalEntry> = {},
): CodexThreadHandoffJournalEntry {
  return {
    schemaVersion: 1,
    operationId: "operation-1",
    threadId: "thread-1",
    phase: "committing-location",
    source,
    destination,
    prepared: preparation.prepared,
    runtimeSwitched: true,
    coreCommitted: false,
    followUpPrompt: "continue",
    followUpDispatchStarted: false,
    warnings: [],
    lastError: null,
    failedPhase: null,
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
    ...patch,
    requestedDestinationHostId: patch.requestedDestinationHostId ?? null,
  };
}

describe("CodexThreadExecutionLocationService", () => {
  test("commits one ordered handoff without replaying runtime projection", async () => {
    const { store } = await makeJournal();
    const calls: string[] = [];
    const service = new CodexThreadExecutionLocationService({
      effects: makeEffects({ calls }),
      journal: store,
    });

    const result = await service.start({
      operationId: "operation-1",
      threadId: "thread-1",
      destinationHostId: null,
      followUpPrompt: "continue",
    });

    expect(result.phase).toBe("completed");
    expect(calls).toEqual([
      "stop",
      "prepare",
      "runtime:destination",
      "core:destination",
      "project:destination",
      "owner",
      "cleanup",
      "follow-up",
    ]);
  });

  test("compensates runtime and Git when the durable Core commit fails", async () => {
    const { store } = await makeJournal();
    const calls: string[] = [];
    const service = new CodexThreadExecutionLocationService({
      effects: makeEffects({ calls, fail: "core:destination" }),
      journal: store,
    });

    const result = await service.start({
      operationId: "operation-1",
      threadId: "thread-1",
      destinationHostId: null,
      followUpPrompt: null,
    });

    expect(result.phase).toBe("failed");
    expect(calls).toEqual([
      "stop",
      "prepare",
      "runtime:destination",
      "core:destination",
      "runtime:source",
      "git:rollback",
      "cleanup",
      "project:source",
    ]);
  });

  test("keeps a durable destination and reports cleanup failure as a warning", async () => {
    const { store } = await makeJournal();
    const calls: string[] = [];
    const service = new CodexThreadExecutionLocationService({
      effects: makeEffects({ calls, cleanupWarnings: ["source cleanup deferred"] }),
      journal: store,
    });

    const result = await service.start({
      operationId: "operation-1",
      threadId: "thread-1",
      destinationHostId: null,
      followUpPrompt: null,
    });

    expect(result.phase).toBe("completed-with-warning");
    expect(result.warnings).toContain("source cleanup deferred");
    expect(calls).not.toContain("runtime:source");
    expect(calls).not.toContain("git:rollback");
  });

  test("journals the requested host and passes cross-host artifacts to both runtime switches", async () => {
    const { store } = await makeJournal();
    const runtimePreparations: Array<CodexThreadHandoffPreparation | null> = [];
    const effects = makeEffects({ calls: [] });
    effects.prepareDestination = async () => crossHostPreparation;
    effects.switchRuntime = async (_threadId, _location, runtimePreparation) => {
      runtimePreparations.push(runtimePreparation);
    };
    effects.commitLocation = async () => {
      throw new Error("Core destination unavailable");
    };
    const service = new CodexThreadExecutionLocationService({ effects, journal: store });

    const result = await service.start({
      operationId: "operation-remote",
      threadId: "thread-1",
      destinationHostId: "ssh:build",
      followUpPrompt: null,
    });

    expect(result.phase).toBe("failed");
    expect(result.requestedDestinationHostId).toBe("ssh:build");
    expect(runtimePreparations).toEqual([crossHostPreparation, crossHostPreparation]);
    await expect(store.get("operation-remote")).resolves.toMatchObject({
      requestedDestinationHostId: "ssh:build",
      prepared: { direction: "cross-host", destinationHostId: "ssh:build" },
    });
  });

  test("reconciles an ambiguous crash from the Core location and dispatches follow-up at most once", async () => {
    const { filePath, store } = await makeJournal();
    await store.put(makeEntry());
    const calls: string[] = [];
    const service = new CodexThreadExecutionLocationService({
      effects: makeEffects({ calls, canonical: destination }),
      journal: new CodexThreadHandoffJournalStore(filePath),
    });

    const [result] = await service.recover();
    expect(result?.phase).toBe("completed");
    expect(result?.coreCommitted).toBe(true);
    expect(calls).toEqual([
      "runtime:destination",
      "project:destination",
      "owner",
      "cleanup",
      "follow-up",
    ]);

    await service.recover();
    expect(calls.filter((call) => call === "follow-up")).toHaveLength(1);
  });

  test("does not mutate Git when canonical recovery state is unavailable or ambiguous", async () => {
    const { store } = await makeJournal();
    await store.put(makeEntry());
    const calls: string[] = [];
    const effects = makeEffects({ calls });
    effects.readCanonicalLocation = vi.fn(async () => null);
    const service = new CodexThreadExecutionLocationService({ effects, journal: store });

    const [result] = await service.recover();
    expect(result?.phase).toBe("committing-location");
    expect(calls).toEqual([]);
  });

  test("fences concurrent handoffs for the same task", async () => {
    const { store } = await makeJournal();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const effects = makeEffects({ calls: [] });
    effects.stopActiveTurn = async () => await waiting;
    const service = new CodexThreadExecutionLocationService({ effects, journal: store });
    const first = service.start({
      operationId: "operation-1",
      threadId: "thread-1",
      destinationHostId: null,
      followUpPrompt: null,
    });
    await vi.waitFor(async () => {
      expect((await store.get("operation-1"))?.phase).toBe("stopping-turn");
    });

    await expect(
      service.start({
        operationId: "operation-2",
        threadId: "thread-1",
        destinationHostId: null,
        followUpPrompt: null,
      }),
    ).rejects.toThrow("already has a handoff");
    release();
    await first;
  });
});

describe("CodexThreadHandoffJournalStore", () => {
  test("durably reloads entries and quarantines malformed state", async () => {
    const { filePath, store } = await makeJournal();
    await store.put(makeEntry());
    await expect(
      new CodexThreadHandoffJournalStore(filePath).get("operation-1"),
    ).resolves.toMatchObject({ threadId: "thread-1", phase: "committing-location" });

    await writeFile(filePath, "{not-json", "utf8");
    await expect(new CodexThreadHandoffJournalStore(filePath, () => 42).list()).resolves.toEqual(
      [],
    );
    const recoveryDirectory = path.dirname(filePath);
    const names = (await import("node:fs/promises")).readdir(recoveryDirectory);
    await expect(names).resolves.toContain("handoffs.json.corrupt-42");
    await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
