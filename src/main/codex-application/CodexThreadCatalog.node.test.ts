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
      readSidebarOverview: (after) =>
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
      setThreadPinned: (threadId, pinned) =>
        Effect.sync(() => {
          calls.push(`set:${threadId}:${pinned}`);
          return {
            threads: [{ threadId, projectId: "project-a" }],
          } as unknown as DesktopProjectWorkspaceSidebar;
        }),
      reorderPinnedThreads: (threadIds) =>
        Effect.sync(() => void calls.push(`reorder:${threadIds.join(",")}`)),
    }).pipe(
      Effect.provideService(CodexSidebarSyncRuntime, sidebar),
      Effect.provideService(Scope.Scope, scope),
    );

    assert.deepEqual(yield* catalog.listPinned, ["thread-a", "thread-b"]);
    assert.deepEqual((yield* catalog.setPinned(" ", true)).pinnedThreadIds, []);
    assert.deepEqual((yield* catalog.setPinned(" thread-a ", true)).pinnedThreadIds, ["thread-a"]);
    assert.deepEqual((yield* catalog.reorderPinned(["thread-a"])).pinnedThreadIds, ["thread-a"]);
    assert.deepEqual(calls, [
      "invalidate",
      "sync",
      "set:thread-a:true",
      "invalidate",
      "publish:project-a:false",
      "reorder:thread-a",
      "invalidate",
      "publish::true",
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
      setThreadPinned: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
      reorderPinnedThreads: () =>
        Effect.sync(() => {
          reordered = true;
        }),
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
