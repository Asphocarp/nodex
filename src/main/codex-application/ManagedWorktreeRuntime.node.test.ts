import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import type { CodexSshExecutionHostConfig } from "../../shared/types";
import { CodexExecutionHostRegistry } from "../codex/codex-execution-host-registry";
import { snapshotPolicyForManagedWorktreeRemoval } from "../codex/codex-managed-worktree-lifecycle";
import { createInProcessCodexWorktreeWorkerPort } from "../codex/codex-worktree-worker-port.test-support";
import type {
  CodexWorktreeWorkerInspectResult,
  CodexWorktreeWorkerPort,
} from "../codex/codex-worktree-worker-port";
import { ExecutionHostRuntime } from "./ExecutionHostRuntime";
import {
  ManagedWorktreeRuntime,
  live as managedWorktreeRuntimeLive,
} from "./ManagedWorktreeRuntime";

const makeExecutionHosts = (worker: CodexWorktreeWorkerPort) =>
  Effect.gen(function* () {
    const registry = new CodexExecutionHostRegistry();
    registry.register({
      hostId: "local",
      managedRoot: "/managed",
      worktreeWorker: worker,
      capabilities: ["remove", "inspect"],
    });
    const activeSshHosts = yield* SubscriptionRef.make<
      ReadonlyMap<string, CodexSshExecutionHostConfig>
    >(new Map());
    return ExecutionHostRuntime.of({
      registry,
      activeSshHosts,
      settings: Effect.succeed({ sshHosts: [] }),
      reconcile: () => Effect.void,
      updateSettings: () => Effect.succeed({ sshHosts: [] }),
    });
  });

const waitUntil = (label: string, predicate: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`Managed Worktree test did not settle: ${label}`));
  });

it.effect("maps every removal reason to a closed snapshot policy", () =>
  Effect.sync(() => {
    assert.strictEqual(snapshotPolicyForManagedWorktreeRemoval("archive"), "required");
    assert.strictEqual(snapshotPolicyForManagedWorktreeRemoval("automatic-retention"), "required");
    assert.strictEqual(snapshotPolicyForManagedWorktreeRemoval("automation-archive"), "required");
    assert.strictEqual(snapshotPolicyForManagedWorktreeRemoval("settings-delete"), "best-effort");
    assert.strictEqual(snapshotPolicyForManagedWorktreeRemoval("failed-create"), "ephemeral");
    assert.strictEqual(snapshotPolicyForManagedWorktreeRemoval("retry"), "ephemeral");
    assert.strictEqual(snapshotPolicyForManagedWorktreeRemoval("cancel"), "ephemeral");
  }),
);

it.effect("owns one physical removal per host/path and clears newborn protection", () =>
  Effect.gen(function* () {
    let removeCalls = 0;
    let resolveRemoval!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveRemoval = resolve;
    });
    const base = createInProcessCodexWorktreeWorkerPort({ hostId: "local" });
    const worker = {
      ...base,
      remove: (input: Parameters<CodexWorktreeWorkerPort["remove"]>[0]) => {
        removeCalls += 1;
        return gate.then(() => ({
          removed: true,
          alreadyMissing: false,
          snapshot: null,
          warnings: [],
          input,
        }));
      },
    } as CodexWorktreeWorkerPort;
    const executionHosts = yield* makeExecutionHosts(worker);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      managedWorktreeRuntimeLive.pipe(
        Layer.provide(Layer.succeed(ExecutionHostRuntime, executionHosts)),
      ),
      scope,
    );
    const managed = Context.get(context, ManagedWorktreeRuntime);
    managed.legacyNewborns.register("local", "/managed/abcd/repo");

    const first = yield* Effect.forkChild(
      managed.remove({
        hostId: "local",
        worktreeGitRoot: "/managed/abcd/repo",
        reason: "archive",
      }),
      { startImmediately: true },
    );
    const second = yield* Effect.forkChild(
      managed.remove({
        hostId: "local",
        worktreeGitRoot: "/managed/abcd/./repo",
        reason: "archive",
      }),
      { startImmediately: true },
    );
    yield* waitUntil("physical removal start", () => removeCalls === 1);
    assert.strictEqual(removeCalls, 1);
    resolveRemoval();
    const [firstResult, secondResult] = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
    assert.isTrue(firstResult.removed);
    assert.deepEqual(secondResult, firstResult);
    assert.isFalse(managed.legacyNewborns.has("local", "/managed/abcd/repo"));

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("keeps coalesced inspection alive after caller cancellation and evicts completion", () =>
  Effect.gen(function* () {
    let inspectCalls = 0;
    let resolveInspection!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveInspection = resolve;
    });
    const result = {
      availability: {
        state: "restorable",
        repositoryPath: "/repositories/repository",
        snapshotRef: "refs/nodex/snapshots/one",
      },
    } satisfies CodexWorktreeWorkerInspectResult;
    const base = createInProcessCodexWorktreeWorkerPort({ hostId: "local" });
    const worker = {
      ...base,
      inspect: async () => {
        inspectCalls += 1;
        if (inspectCalls === 1) await gate;
        return result;
      },
    } as CodexWorktreeWorkerPort;
    const executionHosts = yield* makeExecutionHosts(worker);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      managedWorktreeRuntimeLive.pipe(
        Layer.provide(Layer.succeed(ExecutionHostRuntime, executionHosts)),
      ),
      scope,
    );
    const managed = Context.get(context, ManagedWorktreeRuntime);
    const first = yield* Effect.forkChild(
      managed.inspect({
        hostId: "local",
        worktreeGitRoot: "/managed/abcd/repository",
        cwd: "/managed/abcd/repository/packages/app",
        candidateRepositoryPaths: ["/repositories/secondary", "/repositories/repository"],
      }),
      { startImmediately: true },
    );
    const second = yield* Effect.forkChild(
      managed.inspect({
        hostId: "local",
        worktreeGitRoot: "/managed/abcd/./repository",
        cwd: "/managed/abcd/repository/packages/./app",
        candidateRepositoryPaths: ["/repositories/repository", "/repositories/secondary"],
      }),
      { startImmediately: true },
    );
    yield* waitUntil("physical inspection start", () => inspectCalls === 1);
    assert.strictEqual(inspectCalls, 1);
    yield* Fiber.interrupt(first);
    assert.strictEqual(inspectCalls, 1);
    resolveInspection();
    assert.deepEqual(yield* Fiber.join(second), result);

    assert.deepEqual(
      yield* managed.inspect({
        hostId: "local",
        worktreeGitRoot: "/managed/abcd/repository",
        cwd: "/managed/abcd/repository/packages/app",
        candidateRepositoryPaths: ["/repositories/repository", "/repositories/secondary"],
      }),
      result,
    );
    assert.strictEqual(inspectCalls, 2);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts an in-flight worker removal when its owning Scope closes", () =>
  Effect.gen(function* () {
    let aborted = false;
    const base = createInProcessCodexWorktreeWorkerPort({ hostId: "local" });
    const worker = {
      ...base,
      remove: (
        _input: Parameters<CodexWorktreeWorkerPort["remove"]>[0],
        options?: Partial<Parameters<CodexWorktreeWorkerPort["remove"]>[1]>,
      ) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    } as CodexWorktreeWorkerPort;
    const executionHosts = yield* makeExecutionHosts(worker);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      managedWorktreeRuntimeLive.pipe(
        Layer.provide(Layer.succeed(ExecutionHostRuntime, executionHosts)),
      ),
      scope,
    );
    const managed = Context.get(context, ManagedWorktreeRuntime);
    const removal = yield* Effect.forkChild(
      managed.remove({
        hostId: "local",
        worktreeGitRoot: "/managed/abcd/repo",
        reason: "archive",
      }),
      { startImmediately: true },
    );
    yield* Effect.yieldNow;

    yield* Scope.close(scope, Exit.void);
    const result = yield* Fiber.await(removal);
    assert.strictEqual(result._tag, "Failure");
    assert.isTrue(aborted);
  }),
);
