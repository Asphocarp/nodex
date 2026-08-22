import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import { parseDatabaseId, parseDatabaseViewId } from "../../shared/database-identities";
import type { ProjectSessionsChangeEvent } from "../../shared/ipc-api";
import {
  LIBRARY_NAVIGATION_EVENT_VERSION,
  type LibraryNavigationChangedEvent,
} from "../../shared/library-events";
import { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import { recordDevRuntimeMetricCounter } from "../dev-runtime-metrics";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import { WindowRuntime } from "../window-runtime/WindowRuntime";

export type ProjectChangeType =
  | "create"
  | "update"
  | "metadata"
  | "sources"
  | "lifecycle"
  | "delete"
  | "reorder"
  | "pin";

export interface ProjectsChangeEvent {
  readonly projectId?: string;
  readonly changeType: ProjectChangeType;
}

export interface DatabaseNotificationPublisher {
  readonly notifyDatabaseChanged: (event: DatabaseChangeEvent) => void;
  readonly notifyLibraryNavigationChanged: (event: LibraryNavigationChangedEvent) => void;
  readonly notifyProjectsChanged: (changeType: ProjectChangeType, projectId?: string) => void;
  readonly notifyProjectSessionInvalidation: (event: ProjectSessionsChangeEvent) => void;
}

export class DatabaseNotifierRuntime extends Context.Service<
  DatabaseNotifierRuntime,
  DatabaseNotificationPublisher & {
    readonly projectSessionInvalidations: Stream.Stream<ProjectSessionsChangeEvent>;
  }
>()("nodex/main/host-runtime/DatabaseNotifierRuntime") {}

/** Owns Core projection broadcasts and typed in-process observation for one Main Scope. */
export const live: Layer.Layer<
  DatabaseNotifierRuntime,
  never,
  ScopedCallbackRuntime | WindowRuntime
> = Layer.effect(
  DatabaseNotifierRuntime,
  Effect.gen(function* () {
    const callbacks = yield* ScopedCallbackRuntime;
    const windows = yield* WindowRuntime;
    const projectSessionInvalidations = yield* PubSub.unbounded<ProjectSessionsChangeEvent>();
    let accepting = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        accepting = false;
      }).pipe(Effect.andThen(PubSub.shutdown(projectSessionInvalidations))),
    );

    const broadcast = (channel: string, payload: unknown): void => {
      if (!accepting) return;
      safeBroadcastToWindows(windows.all(), channel, [payload]);
    };
    const notifyLibraryNavigationChanged = (event: LibraryNavigationChangedEvent): void => {
      broadcast("library-navigation-changed", event);
    };
    const notifyProjectsChanged = (changeType: ProjectChangeType, projectId?: string): void => {
      broadcast("projects-changed", { projectId, changeType } satisfies ProjectsChangeEvent);
    };
    const notifyProjectSessionInvalidation = (event: ProjectSessionsChangeEvent): void => {
      if (!accepting) return;
      const scopeKey = event.summaryScopes
        .map((scope) => (scope.kind === "project" ? scope.projectId : scope.kind))
        .join(",");
      recordDevRuntimeMetricCounter(
        "project_sessions_changed.burst_window",
        {
          scopeKey,
          changeType: event.changeType,
          detailScope: event.detailInvalidation.kind,
          detailCount:
            event.detailInvalidation.kind === "sessions"
              ? event.detailInvalidation.sessionIds.length
              : 0,
        },
        {
          groupBy: ["scopeKey", "changeType"],
          windowMs: 1_000,
          burstThreshold: 20,
          burstMetric: "project_sessions_changed.burst",
        },
      );
      recordDevRuntimeMetricCounter(
        "db.project_sessions_changed.broadcast",
        {
          summaryScopeCount: event.summaryScopes.length,
          changeType: event.changeType,
          detailScope: event.detailInvalidation.kind,
          detailSessionCount:
            event.detailInvalidation.kind === "sessions"
              ? event.detailInvalidation.sessionIds.length
              : 0,
          windowCount: windows.count(),
        },
        { groupBy: ["changeType", "windowCount"] },
      );
      broadcast("project-sessions-changed", event);
      callbacks.fork(PubSub.publish(projectSessionInvalidations, event));
    };
    const notifyDatabaseChanged = (event: DatabaseChangeEvent): void => {
      broadcast("database-changed", event);
      if (
        !event.libraryId ||
        (event.affectedDatabaseIds.length === 0 &&
          (event.affectedDataSourceIds?.length ?? 0) === 0 &&
          (event.affectedPageIds?.length ?? 0) === 0 &&
          (event.affectedViewIds?.length ?? 0) === 0)
      ) {
        return;
      }
      notifyLibraryNavigationChanged({
        version: LIBRARY_NAVIGATION_EVENT_VERSION,
        libraryId: event.libraryId,
        storeEpoch: event.storeEpoch,
        commitSeq: event.commitSeq,
        changeKind: "database",
        affectedParentKeys: [
          "library",
          "catalog",
          ...event.affectedDatabaseIds.map((id) => `database:${id}`),
        ],
        affectedPageIds: event.affectedPageIds ?? [],
        affectedDatabaseIds: event.affectedDatabaseIds.map(parseDatabaseId),
        affectedViewIds: (event.affectedViewIds ?? []).map(parseDatabaseViewId),
      });
    };

    return DatabaseNotifierRuntime.of({
      notifyDatabaseChanged,
      notifyLibraryNavigationChanged,
      notifyProjectsChanged,
      notifyProjectSessionInvalidation,
      projectSessionInvalidations: Stream.fromPubSub(projectSessionInvalidations),
    });
  }),
);
