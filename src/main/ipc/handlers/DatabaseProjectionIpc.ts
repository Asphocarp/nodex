import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { CoreResult } from "../../../shared/core-result";
import type { IpcApi } from "../../../shared/ipc-api";
import type { DatabasePage } from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import type { DesktopDatabaseModuleBridge } from "../../core-client";
import { coreResultFrom } from "../../core-result-ipc";
import {
  approximateJsonPayloadBytes,
  getDevRuntimeMetricDurationMs,
  getDevRuntimeMetricStart,
  logDevRuntimeMetric,
} from "../../dev-runtime-metrics";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface DatabaseProjectionIpcOptions {
  readonly database: DesktopDatabaseModuleBridge;
}

export class DatabaseProjectionIpcError extends Schema.TaggedError<DatabaseProjectionIpcError>()(
  "DatabaseProjectionIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

type CoreValue<Channel extends keyof IpcApi> =
  IpcApi[Channel]["result"] extends CoreResult<infer Value> ? Value : never;

export const live = (
  options: DatabaseProjectionIpcOptions,
): Layer.Layer<never, never, ElectronIpc | MainConfig | WindowRuntime> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const windows = yield* WindowRuntime;
      const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
        ipc.handle(channel, handler);
      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSender(event, "Database projection", config.rendererUrl);
            if (!windows.has(event.sender.id)) {
              throw new Error("Database projection requires an active Nodex window");
            }
          },
          catch: (cause) =>
            new DatabaseProjectionIpcError({ operation: "authorize-renderer", cause }),
        });
      const run = <A>(operation: string, task: () => Promise<A>) =>
        Effect.tryPromise({
          try: task,
          catch: (cause) => new DatabaseProjectionIpcError({ operation, cause }),
        });
      const core = <Channel extends keyof IpcApi>(
        channel: Channel,
        read: (
          event: IpcMainInvokeEvent,
          ...args: IpcApi[Channel]["args"]
        ) => Promise<CoreValue<Channel>>,
      ) =>
        handle(channel, (event, ...args) =>
          authorize(event).pipe(
            Effect.andThen(
              run(channel, () =>
                coreResultFrom(async () => await read(event, ...args)),
              ) as Effect.Effect<IpcApi[Channel]["result"], DatabaseProjectionIpcError>,
            ),
          ),
        );
      const observeWindow = <
        A extends { readonly rows: readonly unknown[]; readonly nextCursor: unknown },
      >(
        metric: string,
        startedAt: number,
        window: A,
        projectId?: string,
      ): A => {
        logDevRuntimeMetric(metric, {
          ...(projectId ? { projectId } : {}),
          rowCount: window.rows.length,
          hasContinuation: window.nextCursor !== null,
          approxPayloadBytes: approximateJsonPayloadBytes(window),
          durationMs: getDevRuntimeMetricDurationMs(startedAt),
        });
        return window;
      };

      yield* core("database:view-window:get", async (_, projectId, input) => {
        const startedAt = getDevRuntimeMetricStart();
        return observeWindow(
          "ipc.database_view_window_get",
          startedAt,
          await options.database.getDatabaseViewWindow(projectId, input),
          projectId,
        );
      });
      yield* core("database:list-window:get", async (_, projectId, input) => {
        const startedAt = getDevRuntimeMetricStart();
        return observeWindow(
          "ipc.database_list_window_get",
          startedAt,
          await options.database.getDatabaseListWindow(projectId, input),
          projectId,
        );
      });
      yield* core("database:view-groups:get", (_, projectId, input) =>
        options.database.getDatabaseViewGroups(projectId, input),
      );
      yield* core("library-database:view-window:get", async (_, input) => {
        const startedAt = getDevRuntimeMetricStart();
        return observeWindow(
          "ipc.library_database_view_window_get",
          startedAt,
          await options.database.getLibraryDatabaseViewWindow(input),
        );
      });
      yield* core("library-database:list-window:get", async (_, input) => {
        const startedAt = getDevRuntimeMetricStart();
        return observeWindow(
          "ipc.library_database_list_window_get",
          startedAt,
          await options.database.getLibraryDatabaseListWindow(input),
        );
      });
      yield* core("library-database:view-groups:get", (_, input) =>
        options.database.getLibraryDatabaseViewGroups(input),
      );
      yield* handle("database-row:get", (event, projectId, pageId, status, minimumCommitCursor) =>
        authorize(event).pipe(
          Effect.andThen(
            run("database-row:get", () =>
              options.database.getDatabaseRowPage(
                projectId,
                pageId,
                status as DatabasePage["status"] | undefined,
                minimumCommitCursor,
              ),
            ),
          ),
        ),
      );
    }),
  );
