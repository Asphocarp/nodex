import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type {
  CodexPendingStableWorktreeRequest,
  CodexPendingStartConversationRequest,
} from "../../shared/codex-pending-worktree";
import type { CodexWorktreeWorkerEvent } from "../codex/codex-worktree-worker-port";
import {
  CodexPendingWorktreeEffectError,
  make,
  type CodexPendingWorktreeCreationResult,
  type CodexPendingWorktreeRuntimeOptions,
} from "./CodexPendingWorktreeRuntime";

const request = (id = "local:pending-1"): CodexPendingStartConversationRequest => ({
  id,
  hostId: "local",
  label: "Delegated task",
  sourceWorkspaceRoot: "/source",
  startingState: { type: "branch", branchName: "main" },
  localEnvironmentConfigPath: null,
  prompt: "Implement it",
  launchMode: "start-conversation",
  clientThreadId: `client-new-thread:${id}`,
  startConversationParamsInput: {
    input: [],
    commentAttachments: [],
    workspaceRoots: ["/source"],
    cwd: "/source",
    fileAttachments: [],
    addedFiles: [],
    agentMode: "auto",
    shouldSendPermissionOverrides: true,
    model: null,
    serviceTier: null,
    reasoningEffort: null,
    collaborationMode: null,
    config: {},
    threadSource: "subagent",
    workspaceKind: "project",
    projectAssignment: {
      projectKind: "local",
      projectId: "project-pending",
      pendingCoreUpdate: false,
    },
  },
  sourceConversationId: null,
  sourceCollaborationMode: null,
});

const operationError = (operation: string, cause: unknown) =>
  new CodexPendingWorktreeEffectError({ operation, cause });

const defaults = (
  overrides: Partial<CodexPendingWorktreeRuntimeOptions> = {},
): CodexPendingWorktreeRuntimeOptions => ({
  createWorktree: () =>
    Effect.succeed({
      worktreeGitRoot: "/worktree",
      worktreeWorkspaceRoot: "/worktree/packages/app",
    }),
  launchConversation: (_entry, _workspaceRoot, context) =>
    Effect.sync(() => {
      context.onThreadCreated("thread-created");
      return { threadId: "thread-created" };
    }),
  removeWorktree: () => Effect.void,
  cleanupGoalSources: () => Effect.void,
  registerStableProject: () => Effect.void,
  ...overrides,
});

const waitUntil = (label: string, predicate: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`Pending worktree test did not settle: ${label}`));
  });

it.effect("owns creation progress and conversation launch through one scoped reducer", () =>
  Effect.gen(function* () {
    const creation = yield* Deferred.make<CodexPendingWorktreeCreationResult>();
    const runtime = yield* make(
      defaults({
        createWorktree: (_entry, onEvent) =>
          Effect.sync(() =>
            onEvent({
              operation: "create",
              type: "output",
              phase: "worktree",
              stream: "stdout",
              data: "cloning\n",
            }),
          ).pipe(Effect.andThen(Deferred.await(creation))),
      }),
    );

    runtime.create(request(), 42);
    yield* waitUntil("creation start", () => runtime.list()[0]?.phase === "creating");
    assert.strictEqual(
      runtime.list()[0]?.worktreeOutputText,
      "[info] Starting worktree creation\ncloning\n",
    );
    assert.strictEqual(
      runtime.resolveThread("client-new-thread:local:pending-1")?.state,
      "waiting",
    );

    yield* Deferred.succeed(creation, {
      worktreeGitRoot: "/worktree",
      worktreeWorkspaceRoot: "/worktree/packages/app",
    });
    yield* waitUntil("conversation completion", () => runtime.list().length === 0);
    assert.isNull(runtime.resolveThread("client-new-thread:local:pending-1"));
  }),
);

it.effect("fences late progress from a superseded creation attempt", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const callbacks: Array<(event: CodexWorktreeWorkerEvent) => void> = [];
    const second = yield* Deferred.make<CodexPendingWorktreeCreationResult>();
    const runtime = yield* make(
      defaults({
        createWorktree: (_entry, onEvent) => {
          attempts += 1;
          callbacks.push(onEvent);
          return attempts === 1
            ? Effect.fail(operationError("create", new Error("first failed")))
            : Deferred.await(second);
        },
      }),
    );

    runtime.create(request(), 42);
    yield* waitUntil("first failure", () => runtime.list()[0]?.phase === "failed");
    runtime.retry("local:pending-1");
    yield* waitUntil("second attempt", () => runtime.list()[0]?.attempt === 2);
    callbacks[0]?.({
      operation: "create",
      type: "output",
      phase: "worktree",
      stream: "stderr",
      data: "stale\n",
    });
    assert.strictEqual(
      runtime.list()[0]?.worktreeOutputText,
      "[info] Starting worktree creation\n",
    );

    yield* Deferred.succeed(second, {
      worktreeGitRoot: "/worktree-2",
      worktreeWorkspaceRoot: "/worktree-2",
    });
    yield* waitUntil("retry completion", () => runtime.list().length === 0);
  }),
);

it.effect("coalesces local launch callers while interrupting the worktree attempt", () =>
  Effect.gen(function* () {
    let creationInterrupted = false;
    let launches = 0;
    const launched = yield* Deferred.make<{ readonly threadId: string }>();
    const runtime = yield* make(
      defaults({
        createWorktree: () =>
          Effect.never.pipe(
            Effect.onInterrupt(() => Effect.sync(() => void (creationInterrupted = true))),
          ),
        launchConversation: (_entry, _workspaceRoot, context) => {
          launches += 1;
          return Deferred.await(launched).pipe(
            Effect.tap((result) => Effect.sync(() => context.onThreadCreated(result.threadId))),
          );
        },
      }),
    );
    runtime.create(request(), 42);
    yield* waitUntil("creation running", () => runtime.list()[0]?.phase === "creating");

    const first = yield* Effect.forkChild(runtime.workLocally("local:pending-1"), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(runtime.workLocally("local:pending-1"), {
      startImmediately: true,
    });
    yield* waitUntil("local launch start", () => launches === 1 && creationInterrupted);
    assert.strictEqual(launches, 1);
    assert.isEmpty(runtime.list());
    yield* Deferred.succeed(launched, { threadId: "thread-local" });
    assert.deepEqual(yield* Fiber.join(first), { threadId: "thread-local" });
    assert.deepEqual(yield* Fiber.join(second), { threadId: "thread-local" });
  }),
);

it.effect("commits a mapped thread even when later launch metadata fails", () =>
  Effect.gen(function* () {
    const runtime = yield* make(
      defaults({
        launchConversation: (_entry, _workspaceRoot, context) =>
          Effect.sync(() => context.onThreadCreated("thread-mapped")).pipe(
            Effect.andThen(
              Effect.fail(operationError("launch", new Error("metadata failed after mapping"))),
            ),
          ),
      }),
    );
    runtime.create(request(), 42);
    yield* waitUntil("mapped launch completion", () => runtime.list().length === 0);
    assert.isNull(runtime.resolveThread("client-new-thread:local:pending-1"));
  }),
);

it.effect("cancels an admitted local launch and rejects every waiter", () =>
  Effect.gen(function* () {
    let launchStarted = false;
    let launchInterrupted = false;
    const runtime = yield* make(
      defaults({
        createWorktree: () => Effect.never,
        launchConversation: () =>
          Effect.sync(() => void (launchStarted = true)).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Effect.sync(() => void (launchInterrupted = true))),
          ),
      }),
    );
    runtime.create(request(), 42);
    yield* waitUntil("creation before local cancel", () => runtime.list()[0]?.phase === "creating");
    const first = yield* Effect.forkChild(runtime.workLocally("local:pending-1"), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(runtime.workLocally("local:pending-1"), {
      startImmediately: true,
    });
    yield* waitUntil("local launch before cancel", () => launchStarted);
    runtime.cancel("local:pending-1");
    yield* waitUntil("local launch interruption", () => launchInterrupted);
    assert.strictEqual((yield* Fiber.await(first))._tag, "Failure");
    assert.strictEqual((yield* Fiber.await(second))._tag, "Failure");
  }),
);

it.effect("retains a failed stable Project registration and removes it on cancel", () =>
  Effect.gen(function* () {
    const removed: string[] = [];
    const stable: CodexPendingStableWorktreeRequest = {
      id: "local:stable",
      hostId: "local",
      label: "Stable Project",
      sourceWorkspaceRoot: "/source",
      sourceWorkspaceRoots: ["/source"],
      startingState: { type: "branch", branchName: "main" },
      localEnvironmentConfigPath: null,
      prompt: "Create the Project worktree",
      launchMode: "create-stable-worktree",
      startConversationParamsInput: null,
      sourceConversationId: null,
      sourceCollaborationMode: null,
    };
    const runtime = yield* make(
      defaults({
        registerStableProject: () =>
          Effect.fail(operationError("register-stable-project", new Error("registration failed"))),
        removeWorktree: (_hostId, root) => Effect.sync(() => removed.push(root)),
      }),
    );
    runtime.create(stable, 42);
    yield* waitUntil("registration failure", () => runtime.list()[0]?.phase === "failed");
    assert.strictEqual(runtime.list()[0]?.worktreeGitRoot, "/worktree");
    runtime.cancel(stable.id);
    yield* waitUntil("failed worktree removal", () => removed.length === 1);
    assert.deepEqual(removed, ["/worktree"]);
  }),
);

it.effect("interrupts active creation and rejects local waiters when its Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let interrupted = false;
    const runtime = yield* make(
      defaults({
        createWorktree: () =>
          Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true)))),
        launchConversation: () => Effect.never,
      }),
    ).pipe(Effect.provideService(Scope.Scope, scope));
    runtime.create(request(), 42);
    yield* waitUntil("creation start before close", () => runtime.list()[0]?.phase === "creating");
    const waiter = yield* Effect.forkChild(runtime.workLocally("local:pending-1"), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;

    yield* Scope.close(scope, Exit.void);
    assert.isTrue(interrupted);
    assert.strictEqual((yield* Fiber.await(waiter))._tag, "Failure");
  }),
);
