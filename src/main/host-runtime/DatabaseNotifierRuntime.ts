import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type { ProjectSessionsChangeEvent } from "../../shared/ipc-api";
import type { LibraryNavigationChangedEvent } from "../../shared/library-events";
import type { PageOwnershipPathsChangedEvent } from "../../shared/page-ownership-path-events";
import { recordDevRuntimeMetricCounter } from "../dev-runtime-metrics";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import {
  DatabaseNotifier,
  dbNotifier,
  type BoardChangeEvent,
  type ProjectsChangeEvent,
} from "../local-store/notifier";
import { WindowRuntime } from "../window-runtime/WindowRuntime";

export class DatabaseNotifierRuntime extends Context.Service<
  DatabaseNotifierRuntime,
  { readonly notifier: DatabaseNotifier }
>()("nodex/main/host-runtime/DatabaseNotifierRuntime") {}

export const fromNotifier = (
  notifier: DatabaseNotifier,
): Layer.Layer<DatabaseNotifierRuntime, never, WindowRuntime> =>
  Layer.effect(
    DatabaseNotifierRuntime,
    Effect.gen(function* () {
      const windows = yield* WindowRuntime;
      const broadcast = (channel: string, payload: unknown): void => {
        safeBroadcastToWindows(windows.all(), channel, [payload]);
      };
      const boardChanged = (event: BoardChangeEvent) => broadcast("board-changed", event);
      const ownershipPathsChanged = (event: PageOwnershipPathsChangedEvent) =>
        broadcast("page-ownership-paths-changed", event);
      const databaseChanged = (event: DatabaseChangeEvent) => broadcast("database-changed", event);
      const libraryNavigationChanged = (event: LibraryNavigationChangedEvent) =>
        broadcast("library-navigation-changed", event);
      const projectSessionsChanged = (event: ProjectSessionsChangeEvent) => {
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
      };
      const projectsChanged = (event: ProjectsChangeEvent) => broadcast("projects-changed", event);

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          notifier.on("board-changed", boardChanged);
          notifier.on("page-ownership-paths-changed", ownershipPathsChanged);
          notifier.on("database-changed", databaseChanged);
          notifier.on("library-navigation-changed", libraryNavigationChanged);
          notifier.on("project-sessions-changed", projectSessionsChanged);
          notifier.on("projects-changed", projectsChanged);
        }),
        () =>
          Effect.sync(() => {
            notifier.removeListener("board-changed", boardChanged);
            notifier.removeListener("page-ownership-paths-changed", ownershipPathsChanged);
            notifier.removeListener("database-changed", databaseChanged);
            notifier.removeListener("library-navigation-changed", libraryNavigationChanged);
            notifier.removeListener("project-sessions-changed", projectSessionsChanged);
            notifier.removeListener("projects-changed", projectsChanged);
          }),
      );
      return DatabaseNotifierRuntime.of({ notifier });
    }),
  );

export const live: Layer.Layer<DatabaseNotifierRuntime, never, WindowRuntime> =
  fromNotifier(dbNotifier);
