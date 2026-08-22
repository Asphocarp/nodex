import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import {
  resolveCodexThreadHandoffJournalPath,
  type CodexThreadExecutionLocation,
  type CodexThreadHandoffJournalEntry,
} from "../codex/codex-thread-handoff-journal";
import {
  CodexThreadHandoffJournalStorageError,
  makeCodexThreadHandoffJournalStorage,
  type CodexThreadHandoffJournalStorage,
} from "../platform/CodexThreadHandoffJournalStorage";
import {
  CodexThreadHandoffEffectError,
  make,
  type CodexThreadHandoffEffects,
  type CodexThreadHandoffPreparation,
  type CodexThreadHandoffRuntime,
} from "./CodexThreadHandoffRuntime";

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

const makeEntry = (
  patch: Partial<CodexThreadHandoffJournalEntry> = {},
): CodexThreadHandoffJournalEntry => ({
  schemaVersion: 1,
  operationId: "operation-recover",
  threadId: "thread-1",
  phase: "committing-location",
  source,
  requestedDestinationHostId: null,
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
});

const fail = (message: string) =>
  Effect.fail(new CodexThreadHandoffEffectError({ cause: new Error(message) }));

const makeEffects = (input: {
  readonly calls: string[];
  readonly canonical?: CodexThreadExecutionLocation | null;
  readonly cleanupWarnings?: readonly string[];
  readonly failAt?: string;
  readonly resolveGate?: Deferred.Deferred<void>;
  readonly stopGate?: Deferred.Deferred<void>;
}): CodexThreadHandoffEffects => {
  const record = (name: string) =>
    Effect.sync(() => {
      input.calls.push(name);
    }).pipe(Effect.andThen(input.failAt === name ? fail(`${name} failed`) : Effect.void));
  return {
    resolveSource: () =>
      (input.resolveGate ? Deferred.await(input.resolveGate) : Effect.void).pipe(
        Effect.andThen(Effect.succeed(source)),
      ),
    readCanonicalLocation: () => Effect.succeed(input.canonical ?? source),
    stopActiveTurn: () =>
      record("stop").pipe(
        Effect.andThen(input.stopGate ? Deferred.await(input.stopGate) : Effect.void),
      ),
    prepareDestination: (_entry, onPhase) =>
      onPhase("prepare", "running").pipe(
        Effect.andThen(record("prepare")),
        Effect.andThen(Effect.succeed(preparation)),
      ),
    switchRuntime: (_threadId, location) =>
      record(location === source ? "runtime:source" : "runtime:destination"),
    commitLocation: (_threadId, location) =>
      record(location === source ? "core:source" : "core:destination"),
    projectLocation: (_threadId, location) =>
      record(location === source ? "project:source" : "project:destination"),
    transferOwner: () => record("owner"),
    cleanup: () =>
      record("cleanup").pipe(Effect.andThen(Effect.succeed(input.cleanupWarnings ?? []))),
    rollbackPreparation: () => record("git:rollback").pipe(Effect.as([])),
    sendFollowUp: () => record("follow-up"),
  };
};

const makeHarness = Effect.fn("CodexThreadHandoffRuntimeTest.makeHarness")(function* () {
  const root = yield* Effect.promise(() =>
    mkdtemp(path.join(tmpdir(), "nodex-thread-handoff-runtime-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => rm(root, { force: true, recursive: true })),
  );
  const scope = yield* Scope.Scope;
  const runtime = yield* make({
    scope,
    storage: makeCodexThreadHandoffJournalStorage(resolveCodexThreadHandoffJournalPath(root)),
    resolveHostDisplayName: (hostId) => (hostId === "local" ? "This Mac" : hostId),
  });
  return { root, runtime };
});

const start = (
  runtime: CodexThreadHandoffRuntime["Service"],
  effects: CodexThreadHandoffEffects,
  operationId = "operation-1",
) =>
  runtime.start(
    {
      operationId,
      threadId: "thread-1",
      destinationHostId: null,
      followUpPrompt: "continue",
    },
    effects,
  );

it.effect("commits one ordered handoff and publishes its terminal projection", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeHarness();
    const calls: string[] = [];
    const result = yield* start(runtime, makeEffects({ calls }));

    assert.strictEqual(result.phase, "completed");
    assert.deepEqual(calls, [
      "stop",
      "prepare",
      "runtime:destination",
      "core:destination",
      "project:destination",
      "owner",
      "cleanup",
      "follow-up",
    ]);
    assert.strictEqual((yield* runtime.get(result.operationId))?.status, "success");
  }),
);

it.effect("compensates runtime and Git when durable location commit fails", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeHarness();
    const calls: string[] = [];
    const result = yield* start(runtime, makeEffects({ calls, failAt: "core:destination" }));

    assert.strictEqual(result.phase, "failed");
    assert.deepEqual(calls, [
      "stop",
      "prepare",
      "runtime:destination",
      "core:destination",
      "runtime:source",
      "git:rollback",
      "cleanup",
      "project:source",
    ]);
  }),
);

it.effect("retains a committed destination and reports cleanup warnings", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeHarness();
    const calls: string[] = [];
    const result = yield* start(
      runtime,
      makeEffects({ calls, cleanupWarnings: ["source cleanup deferred"] }),
    );

    assert.strictEqual(result.phase, "completed-with-warning");
    assert.deepEqual(result.warnings, ["source cleanup deferred"]);
    assert.isFalse(calls.includes("runtime:source"));
    assert.strictEqual((yield* runtime.get(result.operationId))?.status, "warning");
  }),
);

it.effect("reconciles committed crash state and dispatches follow-up at most once", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    let entries: readonly CodexThreadHandoffJournalEntry[] = [makeEntry()];
    const storage: CodexThreadHandoffJournalStorage = {
      load: Effect.sync(() => entries),
      persist: (next) =>
        Effect.sync(() => {
          entries = next;
        }),
    };
    const runtime = yield* make({
      scope,
      storage,
      resolveHostDisplayName: (hostId) => hostId,
    });
    const calls: string[] = [];
    const effects = makeEffects({ calls, canonical: destination });

    const [result] = yield* runtime.recover(effects);
    assert.strictEqual(result?.phase, "completed");
    assert.isTrue(result?.coreCommitted ?? false);
    assert.deepEqual(calls, [
      "runtime:destination",
      "project:destination",
      "owner",
      "cleanup",
      "follow-up",
    ]);

    assert.deepEqual(yield* runtime.recover(effects), []);
    assert.strictEqual(calls.filter((call) => call === "follow-up").length, 1);
  }),
);

it.effect("keeps a reserved transaction alive when its first waiter is interrupted", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeHarness();
    const calls: string[] = [];
    const stopGate = yield* Deferred.make<void>();
    const stopStarted = yield* Deferred.make<void>();
    const baseEffects = makeEffects({ calls });
    const effects: CodexThreadHandoffEffects = {
      ...baseEffects,
      stopActiveTurn: () =>
        Effect.sync(() => {
          calls.push("stop");
        }).pipe(
          Effect.andThen(Deferred.succeed(stopStarted, undefined)),
          Effect.andThen(Deferred.await(stopGate)),
        ),
    };
    const first = yield* Effect.forkChild(start(runtime, effects), { startImmediately: true });
    yield* Deferred.await(stopStarted);

    const conflict = yield* Effect.flip(start(runtime, effects, "operation-2"));
    assert.include(conflict.message, "already has a handoff");
    yield* Fiber.interrupt(first);
    yield* Deferred.succeed(stopGate, undefined);
    const completed = yield* start(runtime, effects);
    assert.strictEqual(completed.phase, "completed");
    assert.strictEqual((yield* runtime.get("operation-1"))?.status, "success");
  }),
);

it.effect("wakes revision waits on progress and returns the latest value on deadline", () =>
  Effect.gen(function* () {
    const { runtime } = yield* makeHarness();
    const resolveGate = yield* Deferred.make<void>();
    const stopGate = yield* Deferred.make<void>();
    const operation = yield* runtime.launch(
      {
        operationId: "operation-wait",
        threadId: "thread-wait",
        destinationHostId: null,
        destinationHostDisplayName: "This Mac",
        followUpPrompt: null,
      },
      makeEffects({ calls: [], resolveGate, stopGate }),
    );
    const changed = yield* Effect.forkChild(
      runtime.waitForRevision(operation.operationId, operation.revision, 10_000),
      { startImmediately: true },
    );
    yield* Effect.yieldNow;
    yield* Deferred.succeed(resolveGate, undefined);
    const progressed = yield* Fiber.join(changed);
    assert.isNotNull(progressed);
    assert.isAbove(progressed?.revision ?? -1, operation.revision);

    const current = yield* runtime.get(operation.operationId);
    const timed = yield* Effect.forkChild(
      runtime.waitForRevision(operation.operationId, current?.revision ?? 0, 5_000),
      { startImmediately: true },
    );
    yield* TestClock.adjust(5_000);
    assert.strictEqual((yield* Fiber.join(timed))?.revision, current?.revision);
    yield* Deferred.succeed(stopGate, undefined);
  }),
);

it.effect("commits journal memory only after durable publication succeeds", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    let persistCalls = 0;
    const persisted: CodexThreadHandoffJournalEntry[][] = [];
    const storage: CodexThreadHandoffJournalStorage = {
      load: Effect.succeed([]),
      persist: (entries) =>
        Effect.suspend(() => {
          persistCalls += 1;
          if (persistCalls === 1) {
            return Effect.fail(
              new CodexThreadHandoffJournalStorageError({
                operation: "persist",
                cause: new Error("disk unavailable"),
              }),
            );
          }
          return Effect.sync(() => {
            persisted.push([...entries]);
          });
        }),
    };
    const runtime = yield* make({
      scope,
      storage,
      resolveHostDisplayName: (hostId) => hostId,
    });
    const calls: string[] = [];
    const first = yield* Effect.flip(start(runtime, makeEffects({ calls })));
    assert.include(first.message, "disk unavailable");
    assert.deepEqual(calls, []);

    const second = yield* start(runtime, makeEffects({ calls }));
    assert.strictEqual(second.phase, "completed");
    assert.isAbove(persisted.length, 0);
  }),
);

it.effect("quarantines malformed journal state", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() =>
      mkdtemp(path.join(tmpdir(), "nodex-thread-handoff-storage-")),
    );
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => rm(root, { force: true, recursive: true })),
    );
    const filePath = path.join(root, "handoffs.json");
    yield* Effect.promise(() => writeFile(filePath, "{not-json", { encoding: "utf8", flag: "wx" }));
    const storage = makeCodexThreadHandoffJournalStorage(filePath, () => 42);
    assert.deepEqual(yield* storage.load, []);
    assert.include(
      yield* Effect.promise(() => readdir(path.dirname(filePath))),
      "handoffs.json.corrupt-42",
    );
  }),
);
