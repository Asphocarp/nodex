import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";

import { CoreModuleResponseError } from "../core-client/core-client";
import type {
  ProjectWorkspaceApplyInput,
  ProjectWorkspaceApplyResult,
  ProjectWorkspaceReadSnapshot,
} from "../core-client/types";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { make } from "./ProjectWorkspace";

type CoreProject = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "project" }
>["project"];
type CoreSession = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "session" }
>["session"];
type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "thread" }
>["thread"];

const project = (id: string, overrides: Partial<CoreProject> = {}): CoreProject => ({
  id,
  library_id: "library:test",
  database_id: `database:${id}`,
  default_database_view_id: null,
  lifecycle: "active",
  binding_revision: 4,
  name: `Project ${id}`,
  description: "Mapped from Core",
  appearance: { color: "blue", marker: { kind: "emoji", emoji: "📘" } },
  sources: [{ root: `/workspace/${id}`, order: 0 }],
  primary_workspace_root: `/workspace/${id}`,
  pinned: false,
  pinned_order: null,
  created_at: "2026-08-20T08:00:00.000Z",
  updated_at: "2026-08-20T09:00:00.000Z",
  ...overrides,
});

const session = (overrides: Partial<CoreSession> = {}): CoreSession => ({
  id: "session:one",
  project_id: "project:one",
  no_thread_fallback_title: "New chat",
  display_title: "Mapped session",
  order: 2,
  pinned: true,
  pinned_order: 1,
  archived: false,
  archived_at: null,
  unread: true,
  thread_id: "thread:one",
  created_at: "2026-08-20T08:00:00.000Z",
  updated_at: "2026-08-20T09:00:00.000Z",
  ...overrides,
});

const thread = (overrides: Partial<CoreThread> = {}): CoreThread =>
  ({
    thread_id: "thread:one",
    project_id: "project:one",
    session_id: "session:one",
    forked_from_id: null,
    parent_thread_id: null,
    thread_source: null,
    service_name: null,
    agent_nickname: null,
    agent_role: null,
    agent_path: null,
    thread_name: "Mapped thread",
    thread_preview: "Preview",
    model_provider: "openai",
    model_id: "gpt-test",
    harness_id: null,
    reasoning_effort: "high",
    service_tier: null,
    execution_host_id: "local",
    cwd: "/workspace/project:one",
    writable_roots: ["/workspace/project:one"],
    managed_worktree_path: null,
    projectless_output_directory: null,
    projectless_workspace_browser_root: null,
    status: { status_type: "idle", active_flags: [] },
    archived: false,
    pinned_order: null,
    has_unread_turn: true,
    dynamic_tool_catalogs: [],
    created_at: 100,
    updated_at: 200,
    recency_at: 200,
    linked_at: "2026-08-20T08:00:00.000Z",
    ...overrides,
  }) as CoreThread;

const notFound = (id: string) =>
  new CoreRuntimeError({
    message: `Missing ${id}`,
    operation: "workspace.read",
    reason: "operation",
    retryable: false,
    cause: new CoreModuleResponseError({
      code: "not_found",
      message: `Missing ${id}`,
      retryable: false,
      recovery: { kind: "none" },
    }),
  });

const committed = (commitSeq = 7): ProjectWorkspaceApplyResult =>
  ({
    status: "committed",
    outcome: {
      affected_project_ids: [],
      affected_session_ids: [],
      affected_thread_ids: [],
    },
    receipt: {
      operation_id: "operation:test",
      duplicate: false,
      affected_project_ids: [],
      affected_session_ids: [],
    },
    commit: {
      store_epoch: "epoch:test",
      commit_seq: commitSeq,
      manifest_hash: "f".repeat(64),
    },
  }) as ProjectWorkspaceApplyResult;

const core = (
  read: CoreModuleClients["workspace"]["read"],
  apply: CoreModuleClients["workspace"]["apply"] = () => Effect.succeed(committed()),
): CoreModules["Service"] =>
  CoreModules.of({ workspace: { read, apply } } as unknown as CoreModuleClients);

const open = (modules: CoreModules["Service"]) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const workspace = yield* make.pipe(
      Effect.provideService(CoreModules, modules),
      Effect.provideService(Scope.Scope, scope),
    );
    return { scope, workspace };
  });

it.effect("maps Core products and treats not-found as an optional domain result", () =>
  Effect.gen(function* () {
    const reads: CoreModuleClients["workspace"]["read"] = (input) => {
      if (input.kind !== "project") return Effect.die(new Error("Unexpected Core read"));
      return input.project_id === "project:missing"
        ? Effect.fail(notFound(input.project_id))
        : Effect.succeed({
            value: { kind: "project", project: project(input.project_id) },
          } as ProjectWorkspaceReadSnapshot);
    };
    const { scope, workspace } = yield* open(core(reads));

    const selected = yield* workspace.getProject("project:one");
    assert.deepEqual(selected, {
      id: "project:one",
      libraryId: "library:test",
      databaseId: "database:project:one",
      defaultDatabaseViewId: null,
      lifecycle: "active",
      bindingRevision: 4,
      name: "Project project:one",
      description: "Mapped from Core",
      appearance: { color: "blue", marker: { kind: "emoji", emoji: "📘" } },
      sources: [{ root: "/workspace/project:one", order: 0 }],
      primaryWorkspaceRoot: "/workspace/project:one",
      pinned: false,
      pinnedOrder: null,
      created: new Date("2026-08-20T08:00:00.000Z"),
      updated: new Date("2026-08-20T09:00:00.000Z"),
    });
    assert.isNull(yield* workspace.getProject("project:missing"));
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("moves a Thread as one typed Core intent and returns its commit cursor", () =>
  Effect.gen(function* () {
    const applies: ProjectWorkspaceApplyInput[] = [];
    let persisted = thread();
    const reads: CoreModuleClients["workspace"]["read"] = (input) => {
      if (input.kind !== "thread") return Effect.die(new Error("Unexpected Core read"));
      return Effect.succeed({
        value: { kind: "thread", thread: persisted },
      } as ProjectWorkspaceReadSnapshot);
    };
    const apply: CoreModuleClients["workspace"]["apply"] = (input) =>
      Effect.sync(() => {
        applies.push(input);
        persisted = thread({
          project_id: "project:two",
          cwd: "/workspace/two",
          execution_host_id: "ssh:builder",
        });
        return committed(13);
      });
    const { scope, workspace } = yield* open(core(reads, apply));

    const moved = yield* workspace.moveThread({
      threadId: "thread:one",
      sourceProjectId: "project:one",
      targetProjectId: "project:two",
      afterThreadId: "thread:anchor",
      runtimeWorkspaceRoots: ["/workspace/two"],
      metadata: { executionHostId: "ssh:builder", cwd: "/workspace/two" },
    });

    assert.strictEqual(moved.projectionRevision, 13);
    assert.strictEqual(moved.thread.projectId, "project:two");
    assert.deepEqual(applies[0]?.intent, {
      kind: "move_thread",
      thread_id: "thread:one",
      source: { kind: "project", project_id: "project:one" },
      target: { kind: "project", project_id: "project:two" },
      placement: { kind: "after", thread_id: "thread:anchor" },
      metadata: { execution_host_id: "ssh:builder", cwd: "/workspace/two" },
      runtime_workspace_roots: ["/workspace/two"],
    });
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("hydrates a Session and its linked Thread into one product aggregate", () =>
  Effect.gen(function* () {
    const reads: CoreModuleClients["workspace"]["read"] = (input) => {
      if (input.kind === "session") {
        return Effect.succeed({
          value: { kind: "session", session: session() },
        } as ProjectWorkspaceReadSnapshot);
      }
      if (input.kind === "thread") {
        return Effect.succeed({
          value: { kind: "thread", thread: thread() },
        } as ProjectWorkspaceReadSnapshot);
      }
      return Effect.die(new Error("Unexpected Core read"));
    };
    const { scope, workspace } = yield* open(core(reads));

    const selected = yield* workspace.getProjectSession("session:one");

    assert.strictEqual(selected?.displayTitle, "Mapped session");
    assert.deepEqual(selected?.thread, {
      sessionId: "session:one",
      projectId: "project:one",
      threadId: "thread:one",
      forkedFromId: null,
      parentThreadId: undefined,
      threadSource: null,
      serviceName: null,
      agentNickname: null,
      agentRole: null,
      agentPath: null,
      threadName: "Mapped thread",
      threadPreview: "Preview",
      modelProvider: "openai",
      executionProfile: {
        providerId: "openai",
        modelId: "gpt-test",
        harnessId: null,
        reasoningEffort: "high",
        serviceTier: null,
      },
      executionHostId: "local",
      cwd: "/workspace/project:one",
      managedWorktreePath: null,
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      createdAt: 100,
      updatedAt: 200,
      recencyAt: 200,
      linkedAt: "2026-08-20T08:00:00.000Z",
    });
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("serializes updates per Project while allowing independent Projects to proceed", () =>
  Effect.gen(function* () {
    const starts: string[] = [];
    const firstAStarted = yield* Deferred.make<void>();
    const bStarted = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const reads: CoreModuleClients["workspace"]["read"] = (input) => {
      if (input.kind !== "project") return Effect.die(new Error("Unexpected Core read"));
      return Effect.succeed({
        value: { kind: "project", project: project(input.project_id) },
      } as ProjectWorkspaceReadSnapshot);
    };
    const apply: CoreModuleClients["workspace"]["apply"] = (input) => {
      if (input.intent.kind !== "update_project") {
        return Effect.die(new Error("Unexpected Core apply"));
      }
      const projectId = input.intent.project_id;
      return Effect.sync(() => {
        starts.push(projectId);
      }).pipe(
        Effect.andThen(
          projectId === "project:a"
            ? Deferred.succeed(firstAStarted, undefined)
            : Deferred.succeed(bStarted, undefined),
        ),
        Effect.andThen(Deferred.await(release)),
        Effect.as(committed()),
      );
    };
    const { scope, workspace } = yield* open(core(reads, apply));

    const firstA = yield* workspace
      .updateProject("project:a", { name: "A1" })
      .pipe(Effect.forkChild);
    yield* Deferred.await(firstAStarted);
    const secondA = yield* workspace
      .updateProject("project:a", { name: "A2" })
      .pipe(Effect.forkChild);
    const firstB = yield* workspace
      .updateProject("project:b", { name: "B1" })
      .pipe(Effect.forkChild);
    yield* Deferred.await(bStarted);
    assert.deepEqual(starts, ["project:a", "project:b"]);

    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(firstA);
    yield* Fiber.join(secondA);
    yield* Fiber.join(firstB);
    assert.deepEqual(starts, ["project:a", "project:b", "project:a"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts an in-flight serialized update when its owner Scope closes", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const reads: CoreModuleClients["workspace"]["read"] = (input) => {
      if (input.kind !== "project") return Effect.die(new Error("Unexpected Core read"));
      return Effect.succeed({
        value: { kind: "project", project: project(input.project_id) },
      } as ProjectWorkspaceReadSnapshot);
    };
    const apply: CoreModuleClients["workspace"]["apply"] = () =>
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
      );
    const { scope, workspace } = yield* open(core(reads, apply));
    const update = yield* workspace
      .updateProject("project:a", { name: "A1" })
      .pipe(Effect.forkChild);
    yield* Deferred.await(entered);

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);

    assert.isTrue(Exit.isFailure(yield* Fiber.await(update)));
  }),
);
