import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type {
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  ProjectSessionSummaryWindow,
} from "../../shared/types";
import type { DesktopProjectWorkspaceSidebar } from "../core-client/project-workspace-adapter";
import { CodexSidebarSyncRuntime } from "./CodexSidebarSyncRuntime";
import { make } from "./CodexThreadCatalog";

const snapshot = (pinnedThreadIds: readonly string[] = []): CodexSidebarSnapshot => ({
  items: [],
  pinnedThreadIds: [...pinnedThreadIds],
  projectAssignments: {},
  projectlessThreadIds: [],
  generatedAt: 1,
});

const syncResult = (value: CodexSidebarSnapshot): CodexSidebarSyncResult => ({
  snapshot: value,
  source: "core",
  refreshed: false,
  refreshedAt: 1,
  changedProjectIds: [],
  projectlessChanged: false,
  materializedSessionIds: [],
  failedThreadIds: [],
});

it.effect("owns paginated pin reads and complete mutation publication", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const sidebar = CodexSidebarSyncRuntime.of({
      sync: () => Effect.sync(() => (calls.push("sync"), syncResult(snapshot()))),
      publish: (input) =>
        Effect.sync(() => {
          calls.push(`publish:${input.metadata.changedProjectIds.join(",")}:${input.forceEmit}`);
          return syncResult(snapshot(["thread-a"]));
        }),
      invalidate: () => void calls.push("invalidate"),
      scheduleNotification: () => undefined,
    });
    const scope = yield* Scope.make();
    const catalog = yield* make({
      readSidebarOverview: ({ after }) =>
        Effect.sync(
          () =>
            ({
              items: [
                {
                  thread: { threadId: after === null ? "thread-a" : "thread-b" },
                },
              ],
              nextCursor: after === null ? "page-2" : null,
              hasMore: after === null,
              projectionRevision: 1,
            }) as ProjectSessionSummaryWindow,
        ),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.succeed([]),
      readThreadProjection: () => null,
      setThreadPinned: (threadId, pinned) =>
        Effect.sync(() => {
          calls.push(`set:${threadId}:${pinned}`);
          return {
            threads: [{ threadId, projectId: "project-a" }],
          } as unknown as DesktopProjectWorkspaceSidebar;
        }),
      reorderPinnedThreads: (threadIds) =>
        Effect.sync(() => void calls.push(`reorder:${threadIds.join(",")}`)),
      move: (input) =>
        Effect.sync(() => {
          calls.push(`move:${input.threadId}`);
          return {
            status: "moved" as const,
            threadId: input.threadId,
            source: { projectId: null },
            destination: { projectId: null },
            operationId: "move-1",
            projectionRevision: 2,
          };
        }),
    }).pipe(
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(Scope.Scope, scope),
    );

    assert.deepEqual(yield* catalog.listPinned, ["thread-a", "thread-b"]);
    assert.deepEqual((yield* catalog.setPinned(" ", true)).pinnedThreadIds, []);
    assert.deepEqual((yield* catalog.setPinned(" thread-a ", true)).pinnedThreadIds, ["thread-a"]);
    assert.deepEqual((yield* catalog.reorderPinned(["thread-a"])).pinnedThreadIds, ["thread-a"]);
    assert.strictEqual(
      (yield* catalog.move({
        hostId: "local",
        threadId: "thread-a",
        sourceContainerId: "chats",
        targetContainerId: "pinned",
        beforeThreadId: null,
        useDefaultOrder: true,
      })).status,
      "moved",
    );
    assert.deepEqual(calls, [
      "invalidate",
      "sync",
      "set:thread-a:true",
      "invalidate",
      "publish:project-a:false",
      "reorder:thread-a",
      "invalidate",
      "publish::true",
      "move:thread-a",
    ]);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts active and queued pin mutations with its owning Scope", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let reordered = false;
    const sidebar = CodexSidebarSyncRuntime.of({
      sync: () => Effect.succeed(syncResult(snapshot())),
      publish: () => Effect.succeed(syncResult(snapshot())),
      invalidate: () => undefined,
      scheduleNotification: () => undefined,
    });
    const scope = yield* Scope.make();
    const catalog = yield* make({
      readSidebarOverview: () => Effect.die("unused"),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.die("unused"),
      readThreadProjection: () => null,
      setThreadPinned: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      reorderPinnedThreads: () =>
        Effect.sync(() => {
          reordered = true;
        }),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(Scope.Scope, scope),
    );
    const active = yield* Effect.forkChild(catalog.setPinned("thread-a", true));
    yield* Deferred.await(started);
    const queued = yield* Effect.forkChild(catalog.reorderPinned(["thread-a"]));
    yield* Effect.yieldNow;

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    const [activeExit, queuedExit] = yield* Effect.all([Fiber.await(active), Fiber.await(queued)]);
    assert.isFalse(reordered);
    assert.isTrue(Exit.isFailure(activeExit));
    assert.isTrue(Exit.isFailure(queuedExit));
    if (Exit.isFailure(activeExit)) assert.isTrue(Cause.hasInterruptsOnly(activeExit.cause));
    if (Exit.isFailure(queuedExit)) assert.isTrue(Cause.hasInterruptsOnly(queuedExit.cause));
  }),
);

it.effect("owns Project and command-palette Thread projections", () =>
  Effect.gen(function* () {
    const sidebar = CodexSidebarSyncRuntime.of({
      sync: () => Effect.succeed(syncResult(snapshot())),
      publish: () => Effect.succeed(syncResult(snapshot())),
      invalidate: () => undefined,
      scheduleNotification: () => undefined,
    });
    const scope = yield* Scope.make();
    const window = {
      items: [
        {
          id: "session-a",
          projectId: "project-a",
          displayTitle: "Thread A",
          pinned: true,
          pinnedOrder: 1,
          archived: false,
          unread: true,
          thread: {
            threadId: "thread-a",
            projectId: "project-a",
            sessionId: "session-a",
            forkedFromId: null,
            parentThreadId: null,
            threadSource: null,
            serviceName: null,
            agentNickname: null,
            agentRole: null,
            agentPath: null,
            threadName: "Thread A",
            threadPreview: "Preview A",
            executionHostId: "local",
            cwd: "/workspace/a",
            managedWorktreePath: null,
            statusType: "idle",
            statusActiveFlags: [],
            archived: false,
            createdAt: 1,
            updatedAt: 2,
            recencyAt: 3,
            linkedAt: "2026-08-23T00:00:00.000Z",
          },
        },
      ],
      nextCursor: null,
      hasMore: false,
      projectionRevision: 4,
    } as unknown as ProjectSessionSummaryWindow;
    const emptyWindow = { ...window, items: [] };
    const catalog = yield* make({
      readSidebarOverview: () => Effect.succeed(window),
      listProjectWindow: (projectId) =>
        Effect.succeed(projectId === "project-a" ? window : emptyWindow),
      listProjects: Effect.succeed([
        { id: "project-a", name: "Project A" } as unknown as import("../../shared/types").Project,
      ]),
      readThreadProjection: () =>
        ({
          modelProvider: "anthropic",
          executionProfile: null,
          managedWorktreePath: "/workspace/a",
          projectlessOutputDirectory: null,
          projectlessWorkspaceBrowserRoot: null,
        }) as unknown as import("../core-client/project-workspace-adapter").DesktopProjectWorkspaceThread,
      setThreadPinned: () => Effect.die("unused"),
      reorderPinnedThreads: () => Effect.die("unused"),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(Scope.Scope, scope),
    );

    const projectThreads = yield* catalog.listProject(" project-a ");
    assert.strictEqual(projectThreads.projectionRevision, 4);
    assert.deepEqual(projectThreads.items[0], {
      threadId: "thread-a",
      projectId: "project-a",
      forkedFromId: null,
      source: null,
      ephemeral: false,
      threadSource: null,
      serviceName: null,
      agentNickname: null,
      agentRole: null,
      agentPath: null,
      threadName: "Thread A",
      threadPreview: "Preview A",
      modelProvider: "anthropic",
      executionProfile: null,
      cwd: "/workspace/a",
      managedWorktreePath: "/workspace/a",
      projectlessOutputDirectory: null,
      projectlessWorkspaceBrowserRoot: null,
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      pinned: true,
      hasUnreadTurn: true,
      createdAt: 1,
      updatedAt: 2,
      recencyAt: 3,
      linkedAt: "2026-08-23T00:00:00.000Z",
    });
    assert.deepEqual(yield* catalog.listPalette({ scope: "sidebar" }), [
      {
        threadId: "thread-a",
        sessionId: "session-a",
        projectId: "project-a",
        projectName: "Project A",
        title: "Thread A",
        preview: "Preview A",
        cwd: "/workspace/a",
        gitBranch: null,
        projectless: false,
        pinned: true,
        pinnedOrder: 1,
        statusType: "idle",
        statusActiveFlags: [],
        createdAt: 1,
        updatedAt: 3,
      },
    ]);

    yield* Scope.close(scope, Exit.void);
  }),
);
