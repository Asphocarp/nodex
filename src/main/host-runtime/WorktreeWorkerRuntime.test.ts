import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { afterAll, beforeAll } from "vite-plus/test";
import type { CodexWorktreeWorkerCreateInput } from "../codex/codex-worktree-worker-port";
import { localLive, WorktreeWorkerRuntime } from "./WorktreeWorkerRuntime";

let fixtureRoot = "";
let fixturePath = "";

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "nodex-worktree-worker-runtime-test-"));
  fixturePath = path.join(fixtureRoot, "fixture.mjs");
  await writeFile(
    fixturePath,
    `
import { parentPort, workerData } from "node:worker_threads";
const port = parentPort;
if (!port) throw new Error("missing parent port");
port.on("message", (message) => {
  if (message.type === "shutdown") {
    port.close();
    return;
  }
  if (message.type === "cancel") return;
  const request = message.request;
  if (request.operation !== "create") throw new Error("unexpected fixture operation");
  if (request.input.threadTitle === "crash") process.exit(23);
  const roots = {
    worktreeGitRoot: "/worktrees/abcd/repo",
    worktreeWorkspaceRoot: "/worktrees/abcd/repo/packages/app",
  };
  port.postMessage({
    type: "event",
    id: message.id,
    operation: "create",
    event: { operation: "create", type: "path-allocated", ...roots },
  });
  if (request.input.threadTitle === "hang") return;
  port.postMessage({
    type: "result",
    id: message.id,
    operation: "create",
    result: {
      type: "ok",
      success: {
        operation: "create",
        value: { ...roots, setupError: null, shellEnvironment: null },
      },
    },
  });
});
port.postMessage({
  type: "ready",
  epoch: workerData.epoch,
  hostId: workerData.hostId,
  protocolVersion: 4,
});
`,
    "utf8",
  );
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

const createInput = (threadTitle: string): CodexWorktreeWorkerCreateInput => ({
  requestId: `request:${threadTitle}`,
  hostId: "local",
  repositoryPath: "/repo",
  nodexHome: "/nodex",
  managedRoot: "/nodex/worktrees",
  projectId: "project-1",
  targetId: "pending-1",
  threadTitle,
  startingState: { type: "branch", branchName: "main" },
  localEnvironmentConfigPath: null,
  setUpSyncedBranch: true,
  propagateLocalWorkspaceFiles: true,
});

const acquire = (onInfrastructureError?: (error: Error) => void) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      localLive({ hostId: "local", workerPath: fixturePath, onInfrastructureError }),
      scope,
    );
    return { runtime: Context.get(context, WorktreeWorkerRuntime), scope };
  });

it.effect("streams events and replaces a crashed worker generation", () =>
  Effect.gen(function* () {
    const infrastructureErrors: string[] = [];
    const { runtime, scope } = yield* acquire((error) => infrastructureErrors.push(error.message));
    const crashed = yield* Effect.result(
      runtime.request({ operation: "create", input: createInput("crash") }),
    );
    assert.isTrue(Result.isFailure(crashed));
    if (Result.isFailure(crashed)) {
      assert.strictEqual(crashed.failure.message, "Worktree worker is temporarily unavailable");
    }
    assert.strictEqual(infrastructureErrors.length, 1);

    const events: string[] = [];
    const result = yield* runtime.request(
      { operation: "create", input: createInput("success") },
      { onEvent: (event) => events.push(event.type) },
    );
    assert.deepEqual(events, ["path-allocated"]);
    assert.strictEqual(result.worktreeWorkspaceRoot, "/worktrees/abcd/repo/packages/app");
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("maps Effect interruption to one worker cancellation without poisoning the session", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* acquire();
    let markAllocated!: () => void;
    const allocated = new Promise<void>((resolve) => {
      markAllocated = resolve;
    });
    const pending = yield* Effect.forkChild(
      runtime.request(
        { operation: "create", input: createInput("hang") },
        {
          onEvent: (event) => {
            if (event.type === "path-allocated") markAllocated();
          },
        },
      ),
    );
    yield* Effect.promise(() => allocated);
    yield* Fiber.interrupt(pending);

    const result = yield* runtime.request({
      operation: "create",
      input: createInput("success"),
    });
    assert.isNull(result.setupError);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("cancels only the request whose event consumer fails", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* acquire();
    const failed = yield* Effect.result(
      runtime.request(
        { operation: "create", input: createInput("hang") },
        {
          onEvent: () => {
            throw new Error("event consumer failed");
          },
        },
      ),
    );
    assert.isTrue(Result.isFailure(failed));
    if (Result.isFailure(failed))
      assert.strictEqual(failed.failure.message, "event consumer failed");

    const result = yield* runtime.request({
      operation: "create",
      input: createInput("success"),
    });
    assert.isNull(result.setupError);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rejects protocol drift before spawning a worker", () =>
  Effect.gen(function* () {
    let infrastructureErrors = 0;
    const { runtime, scope } = yield* acquire(() => {
      infrastructureErrors += 1;
    });
    const invalid = yield* Effect.result(
      runtime.request({
        operation: "create",
        input: {
          ...createInput("invalid"),
          localEnvironmentConfigPath: "/repo/.codex/environments/environment.toml",
        },
      }),
    );
    assert.isTrue(Result.isFailure(invalid));
    if (Result.isFailure(invalid)) assert.match(invalid.failure.message, /protocol version/u);
    assert.strictEqual(infrastructureErrors, 0);

    const result = yield* runtime.request({
      operation: "create",
      input: {
        ...createInput("success"),
        localEnvironmentConfigPath: ".codex/environments/environment.toml",
      },
    });
    assert.isNull(result.setupError);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("closes Promise projection admission and active work with its Scope", () =>
  Effect.gen(function* () {
    const { runtime, scope } = yield* acquire();
    let markAllocated!: () => void;
    const allocated = new Promise<void>((resolve) => {
      markAllocated = resolve;
    });
    const pending = runtime.port.create(createInput("hang"), {
      signal: new AbortController().signal,
      onEvent: (event) => {
        if (event.type === "path-allocated") markAllocated();
      },
    });
    const settled = pending.then(
      () => ({ kind: "success" as const }),
      (error: unknown) => ({ kind: "failure" as const, error }),
    );
    yield* Effect.promise(() => allocated);
    yield* Scope.close(scope, Exit.void);
    const closed = yield* Effect.promise(() => settled);
    assert.strictEqual(closed.kind, "failure");
    if (closed.kind === "failure") assert.match(String(closed.error), /shutting down/u);
    yield* Effect.promise(() =>
      runtime.port
        .create(createInput("late"), {
          signal: new AbortController().signal,
          onEvent: () => undefined,
        })
        .then(
          () => assert.fail("Expected closed worker projection to reject"),
          (error: unknown) => assert.match(String(error), /closed|interrupt|shutting down/iu),
        ),
    );
  }),
);
