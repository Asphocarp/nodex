import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import type {
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  Project,
  ProjectSession,
  ProjectSessionSummaryWindow,
} from "../../shared/types";
import type { DesktopProjectWorkspaceSidebar } from "../core-client/project-workspace-adapter";
import type { DesktopProjectWorkspaceThread } from "../core-client/project-workspace-adapter";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CodexSidebarSyncRuntime } from "./CodexSidebarSyncRuntime";
import { CodexThreadCatalogError, make } from "./CodexThreadCatalog";
import { CodexThreadDirectory, type CodexThreadDirectoryEntry } from "./CodexThreadDirectory";
import {
  buildWorkspaceThreadSummary,
  resolveSidebarProjectIdForCwd,
} from "./CodexThreadCatalogProjection";

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

type RequestLocal = CodexGateway["Service"]["requestLocal"];

const makeGateway = (requestLocal: RequestLocal): CodexGateway["Service"] => {
  const unsupported = () => Effect.die(new Error("Unsupported test operation"));
  return CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
    requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
    events: Stream.empty,
    requestLocal,
    requestOnHost: (_hostId, method, params) => requestLocal(method, params),
    requestForThread: (_threadId, method, params) => requestLocal(method, params),
    notifyLocal: unsupported,
    connection: () => unsupported(),
    connectionChanges: () => Stream.empty,
    awaitReady: () => Effect.void,
    reconcileHost: unsupported,
    removeHost: unsupported,
    restartHost: unsupported,
  });
};

const unusedGateway = makeGateway((() =>
  Effect.die(new Error("Unexpected Codex request"))) as RequestLocal);

const emptyWindow = (): ProjectSessionSummaryWindow =>
  ({
    items: [],
    nextCursor: null,
    hasMore: false,
    projectionRevision: 1,
  }) as ProjectSessionSummaryWindow;

const workspaceThread = (
  overrides: Partial<DesktopProjectWorkspaceThread> = {},
): DesktopProjectWorkspaceThread =>
  ({
    threadId: "thread-cached",
    projectId: "project-a",
    sessionId: null,
    forkedFromId: null,
    parentThreadId: null,
    threadSource: null,
    serviceName: null,
    agentNickname: null,
    agentRole: null,
    agentPath: null,
    threadName: "Cached Thread",
    threadPreview: "Cached preview",
    modelProvider: "openai",
    executionProfile: null,
    executionHostId: "local",
    cwd: "/workspace/a",
    managedWorktreePath: null,
    projectlessOutputDirectory: null,
    projectlessWorkspaceBrowserRoot: null,
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    pinnedOrder: null,
    hasUnreadTurn: false,
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 3,
    linkedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  }) as unknown as DesktopProjectWorkspaceThread;

const directoryEntry = (durable: DesktopProjectWorkspaceThread): CodexThreadDirectoryEntry => ({
  fidelity: "durable",
  durable,
  summary: buildWorkspaceThreadSummary(durable),
  canonical: null,
  snapshot: null,
});

const directoryFor = (
  read: (threadId: string) => DesktopProjectWorkspaceThread | null = () => null,
): CodexThreadDirectory["Service"] =>
  CodexThreadDirectory.of({
    resolve: ({ threadId }) =>
      Effect.sync(() => {
        const durable = read(threadId);
        return durable ? directoryEntry(durable) : null;
      }),
    descendants: () => Effect.die("unused"),
    acceptRollbackResult: () => Effect.die("unused"),
  });

const unusedDirectory = directoryFor();

const projectSession = (threadId: string | null = null): ProjectSession =>
  ({
    id: "session-created",
    projectId: "project-a",
    displayTitle: "Session",
    pinned: false,
    pinnedOrder: null,
    archived: false,
    unread: false,
    thread: threadId === null ? null : { threadId },
  }) as unknown as ProjectSession;

const unusedSessionOperations = {
  getSession: () => Effect.die("unused"),
  createSession: () => Effect.die("unused"),
  deleteSession: () => Effect.die("unused"),
  readWritableRoots: () => Effect.die("unused"),
  linkSession: () => Effect.die("unused"),
  setSessionPinned: () => Effect.die("unused"),
  repairChild: () => Effect.die("unused"),
  shouldHideThread: () => false,
  hideThread: () => Effect.die("unused"),
};

const searchSidebar = CodexSidebarSyncRuntime.of({
  sync: () => Effect.die("unused"),
  publish: () => Effect.die("unused"),
  invalidate: () => undefined,
  scheduleNotification: () => undefined,
});

const makeSearchCatalog = (
  scope: Scope.Scope,
  requestLocal: RequestLocal,
  projects: readonly Project[] = [],
) =>
  make({
    foldPathCase: false,
    readSidebarOverview: () => Effect.succeed(emptyWindow()),
    listProjectWindow: () => Effect.succeed(emptyWindow()),
    listProjects: Effect.succeed(projects),
    readThreadProjection: () => null,
    ...unusedSessionOperations,
    setThreadPinned: () => Effect.die("unused"),
    reorderPinnedThreads: () => Effect.die("unused"),
    move: () => Effect.die("unused"),
  }).pipe(
    Effect.provideService(CodexGateway, makeGateway(requestLocal)),
    Effect.provideService(CodexSidebarSyncRuntime, searchSidebar),
    Effect.provideService(CodexThreadDirectory, unusedDirectory),
    Effect.provideService(Scope.Scope, scope),
  );

it.effect("uses the injected path case policy for project inference", () =>
  Effect.sync(() => {
    const projects = [
      {
        id: "project-a",
        sources: [{ root: "/Workspace/Repository" }],
      },
    ] as unknown as readonly Project[];

    assert.strictEqual(
      resolveSidebarProjectIdForCwd("/workspace/repository/src", projects, true),
      "project-a",
    );
    assert.strictEqual(
      resolveSidebarProjectIdForCwd("/workspace/repository/src", projects, false),
      null,
    );
  }),
);

it.effect("resolves cached Threads without touching the app-server", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const catalog = yield* make({
      foldPathCase: false,
      readSidebarOverview: () => Effect.die("unused"),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.die("unused"),
      readThreadProjection: () => workspaceThread(),
      ...unusedSessionOperations,
      setThreadPinned: () => Effect.die("unused"),
      reorderPinnedThreads: () => Effect.die("unused"),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, searchSidebar),
      Effect.provideService(
        CodexThreadDirectory,
        directoryFor(() => workspaceThread()),
      ),
      Effect.provideService(Scope.Scope, scope),
    );

    assert.deepEqual(
      yield* catalog.resolve(" thread-cached "),
      buildWorkspaceThreadSummary(workspaceThread()),
    );
    assert.isNull(yield* catalog.resolve("   "));
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("publishes the exact sidebar scope for a newly resolved durable Thread", () =>
  Effect.gen(function* () {
    const publications: Array<{ readonly projectIds: readonly string[]; readonly reason: string }> =
      [];
    const sidebar = CodexSidebarSyncRuntime.of({
      sync: () => Effect.die("unused"),
      publish: (input) =>
        Effect.sync(() => {
          publications.push({
            projectIds: input.metadata.changedProjectIds,
            reason: input.reason,
          });
          return syncResult(snapshot());
        }),
      invalidate: () => undefined,
      scheduleNotification: () => undefined,
    });
    const scope = yield* Scope.make();
    const materialized = workspaceThread({
      threadId: "thread-remote",
      projectId: "project-remote",
      threadName: "Remote Thread",
      threadPreview: "Remote preview",
    });
    const catalog = yield* make({
      foldPathCase: false,
      readSidebarOverview: () => Effect.die("unused"),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.die("unused"),
      readThreadProjection: () => null,
      ...unusedSessionOperations,
      setThreadPinned: () => Effect.die("unused"),
      reorderPinnedThreads: () => Effect.die("unused"),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(
        CodexThreadDirectory,
        directoryFor(() => materialized),
      ),
      Effect.provideService(Scope.Scope, scope),
    );

    assert.deepEqual(
      yield* catalog.resolve(" thread-remote "),
      buildWorkspaceThreadSummary(materialized),
    );
    assert.deepEqual(publications, [{ projectIds: ["project-remote"], reason: "host-message" }]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("repairs leaked child Sessions inside the Catalog mutation lane", () =>
  Effect.gen(function* () {
    const repairs: Array<{ readonly threadId: string; readonly parentThreadId: string }> = [];
    let invalidations = 0;
    const sidebar = CodexSidebarSyncRuntime.of({
      sync: () => Effect.die("unused"),
      publish: () => Effect.die("unused"),
      invalidate: () => {
        invalidations += 1;
      },
      scheduleNotification: () => undefined,
    });
    const scope = yield* Scope.make();
    const catalog = yield* make({
      foldPathCase: false,
      readSidebarOverview: () => Effect.die("unused"),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.die("unused"),
      readThreadProjection: () => null,
      ...unusedSessionOperations,
      repairChild: (threadId, parentThreadId) =>
        Effect.sync(() => {
          repairs.push({ threadId, parentThreadId });
          return true;
        }),
      setThreadPinned: () => Effect.die("unused"),
      reorderPinnedThreads: () => Effect.die("unused"),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(
        CodexThreadDirectory,
        directoryFor(() =>
          workspaceThread({
            threadId: "thread-child",
            parentThreadId: "thread-root",
            sessionId: "session-leaked",
          }),
        ),
      ),
      Effect.provideService(Scope.Scope, scope),
    );

    assert.isNull(yield* catalog.ensureSession("thread-child"));
    assert.deepEqual(repairs, [{ threadId: "thread-child", parentThreadId: "thread-root" }]);
    assert.strictEqual(invalidations, 1);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("creates and links one complete sidebar Session", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const scope = yield* Scope.make();
    const thread = workspaceThread({ pinnedOrder: 4 });
    const linked = projectSession(thread.threadId);
    const catalog = yield* make({
      foldPathCase: false,
      readSidebarOverview: () => Effect.die("unused"),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.die("unused"),
      readThreadProjection: () => null,
      ...unusedSessionOperations,
      getSession: () => Effect.sync(() => (calls.push("get"), linked)),
      createSession: (projectId, fallbackTitle) =>
        Effect.sync(() => {
          calls.push(`create:${projectId}:${fallbackTitle}`);
          return projectSession();
        }),
      deleteSession: () => Effect.sync(() => void calls.push("delete")),
      readWritableRoots: () =>
        Effect.sync(() => (calls.push("roots"), ["/workspace/a", "/workspace/shared"])),
      linkSession: (sessionId, linkedThread, roots) =>
        Effect.sync(() => {
          calls.push(`link:${sessionId}:${linkedThread.threadId}:${roots.join(",")}`);
        }),
      setSessionPinned: (sessionId) => Effect.sync(() => void calls.push(`pin:${sessionId}`)),
      setThreadPinned: () => Effect.die("unused"),
      reorderPinnedThreads: () => Effect.die("unused"),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, searchSidebar),
      Effect.provideService(
        CodexThreadDirectory,
        directoryFor(() => thread),
      ),
      Effect.provideService(Scope.Scope, scope),
    );

    assert.strictEqual((yield* catalog.ensureSession("thread-cached"))?.id, "session-created");
    assert.deepEqual(calls, [
      "create:project-a:Cached Thread",
      "roots",
      "link:session-created:thread-cached:/workspace/a,/workspace/shared",
      "pin:session-created",
      "get",
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("compensates a partially created sidebar Session", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const scope = yield* Scope.make();
    const catalog = yield* make({
      foldPathCase: false,
      readSidebarOverview: () => Effect.die("unused"),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.die("unused"),
      readThreadProjection: () => null,
      ...unusedSessionOperations,
      createSession: () => Effect.succeed(projectSession()),
      deleteSession: (sessionId) => Effect.sync(() => void calls.push(`delete:${sessionId}`)),
      readWritableRoots: () => Effect.succeed([]),
      linkSession: () =>
        Effect.fail(
          new CodexThreadCatalogError({
            operation: "ensure-session",
            cause: new Error("link failed"),
          }),
        ),
      setThreadPinned: () => Effect.die("unused"),
      reorderPinnedThreads: () => Effect.die("unused"),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, searchSidebar),
      Effect.provideService(
        CodexThreadDirectory,
        directoryFor(() => workspaceThread()),
      ),
      Effect.provideService(Scope.Scope, scope),
    );

    const error = yield* Effect.flip(catalog.ensureSession("thread-cached"));
    assert.strictEqual(error.operation, "ensure-session");
    assert.deepEqual(calls, ["delete:session-created"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

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
      foldPathCase: false,
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
      ...unusedSessionOperations,
      getSession: () => Effect.succeed(projectSession("thread-a")),
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
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(
        CodexThreadDirectory,
        directoryFor(() =>
          workspaceThread({
            threadId: "thread-a",
            sessionId: "session-a",
          }),
        ),
      ),
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
      foldPathCase: false,
      readSidebarOverview: () => Effect.die("unused"),
      listProjectWindow: () => Effect.die("unused"),
      listProjects: Effect.die("unused"),
      readThreadProjection: () => null,
      ...unusedSessionOperations,
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
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(CodexThreadDirectory, unusedDirectory),
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
      foldPathCase: false,
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
      ...unusedSessionOperations,
      setThreadPinned: () => Effect.die("unused"),
      reorderPinnedThreads: () => Effect.die("unused"),
      move: () => Effect.die("unused"),
    }).pipe(
      Effect.provideService(CodexGateway, unusedGateway),
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(CodexThreadDirectory, unusedDirectory),
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

it.effect("searches app-server Threads and paginates past filtered results", () =>
  Effect.gen(function* () {
    const requests: Array<{ readonly method: string; readonly params: unknown }> = [];
    const requestLocal = ((method: string, params: unknown) => {
      requests.push({ method, params });
      if (method !== "thread/search") return Effect.die(new Error(`Unexpected request: ${method}`));
      const cursor = (params as { readonly cursor?: string | null }).cursor;
      if (cursor === null) {
        return Effect.succeed({
          data: [
            {
              thread: {
                id: "thread-child",
                ephemeral: false,
                parentThreadId: "thread-parent",
                threadSource: null,
                source: "appServer",
              },
              snippet: "Filtered child Thread",
            },
          ],
          nextCursor: "page-2",
          backwardsCursor: null,
        });
      }
      return Effect.succeed({
        data: [
          {
            thread: {
              id: "thread-server-only",
              ephemeral: false,
              parentThreadId: null,
              threadSource: null,
              source: "appServer",
              name: "Server-only Thread",
              preview: "Not materialized in Nodex",
              cwd: "/workspace/project/server-only",
              gitInfo: { sha: "abc", branch: "feature/search", originUrl: null },
              status: { type: "idle" },
              createdAt: 1_711_278_000,
              updatedAt: 1_711_278_060,
              recencyAt: null,
            },
            snippet: "Matched server-only transcript",
          },
        ],
        nextCursor: null,
        backwardsCursor: "backwards",
      });
    }) as RequestLocal;
    const scope = yield* Scope.make();
    const catalog = yield* makeSearchCatalog(scope, requestLocal, [
      {
        id: "project-a",
        name: "Project A",
        sources: [{ root: "/workspace/project" }],
      } as unknown as Project,
    ]);

    assert.deepEqual(yield* catalog.searchPalette({ query: "transcript", limit: 1 }), [
      {
        thread: {
          threadId: "thread-server-only",
          sessionId: null,
          projectId: "project-a",
          projectName: "Project A",
          title: "Server-only Thread",
          preview: "Not materialized in Nodex",
          cwd: "/workspace/project/server-only",
          gitBranch: "feature/search",
          projectless: false,
          pinned: false,
          pinnedOrder: null,
          statusType: "idle",
          statusActiveFlags: [],
          createdAt: 1_711_278_000_000,
          updatedAt: 1_711_278_060_000,
        },
        snippet: "Matched server-only transcript",
      },
    ]);
    assert.deepEqual(requests, [
      {
        method: "thread/search",
        params: {
          cursor: null,
          limit: 1,
          sortKey: "updated_at",
          sortDirection: "desc",
          sourceKinds: [],
          archived: false,
          searchTerm: "transcript",
        },
      },
      {
        method: "thread/search",
        params: {
          cursor: "page-2",
          limit: 1,
          sortKey: "updated_at",
          sortDirection: "desc",
          sourceKinds: [],
          archived: false,
          searchTerm: "transcript",
        },
      },
    ]);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("bounds repeated search cursors and filters internal Threads", () =>
  Effect.gen(function* () {
    const cursors: Array<string | null | undefined> = [];
    const requestLocal = ((_method: string, params: unknown) => {
      cursors.push((params as { readonly cursor?: string | null }).cursor);
      return Effect.succeed({
        data: [
          {
            thread: {
              id: `thread-internal-${cursors.length}`,
              ephemeral: false,
              parentThreadId: null,
              threadSource: "system",
              source: "appServer",
            },
            snippet: "Filtered internal Thread",
          },
        ],
        nextCursor: "repeated-cursor",
        backwardsCursor: null,
      });
    }) as RequestLocal;
    const scope = yield* Scope.make();
    const catalog = yield* makeSearchCatalog(scope, requestLocal);

    assert.deepEqual(yield* catalog.searchPalette({ query: "internal", limit: 5 }), []);
    assert.deepEqual(cursors, [null, "repeated-cursor"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("skips blank search and preserves typed Gateway failures", () =>
  Effect.gen(function* () {
    const failure = codexRuntimeError({
      operation: "gateway.request",
      reason: "request",
      retryable: false,
      cause: new Error("search unavailable"),
    });
    let requestCalls = 0;
    const requestLocal = (() => {
      requestCalls += 1;
      return Effect.fail(failure);
    }) as RequestLocal;
    const scope = yield* Scope.make();
    const catalog = yield* makeSearchCatalog(scope, requestLocal);

    assert.deepEqual(yield* catalog.searchPalette({ query: "   " }), []);
    const error = yield* catalog.searchPalette({ query: "needle" }).pipe(Effect.flip);
    assert.isTrue(error instanceof CodexThreadCatalogError);
    assert.strictEqual(error.operation, "search-palette");
    assert.strictEqual(error.cause, failure);
    assert.strictEqual(requestCalls, 1);
    yield* Scope.close(scope, Exit.void);
  }),
);
