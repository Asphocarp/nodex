import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import { MainShutdown } from "../../app/MainShutdown";
import { StoreAdministration } from "../../core-runtime/StoreAdministration";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class StoreAdministrationIpcError extends Schema.TaggedError<StoreAdministrationIpcError>()(
  "StoreAdministrationIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

export const live: Layer.Layer<
  never,
  never,
  ElectronIpc | MainConfig | MainShutdown | StoreAdministration | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const administration = yield* StoreAdministration;
    const config = yield* MainConfig;
    const ipc = yield* ElectronIpc;
    const shutdown = yield* MainShutdown;
    const windows = yield* WindowRuntime;
    const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
      ipc.handle(channel, handler);
    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, "Store administration", config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error("Store administration requires an active Nodex window");
          }
        },
        catch: (cause) =>
          new StoreAdministrationIpcError({ operation: "authorize-renderer", cause }),
      });
    const run = <A, E>(operation: string, task: Effect.Effect<A, E>) =>
      task.pipe(Effect.mapError((cause) => new StoreAdministrationIpcError({ operation, cause })));

    yield* handle("backup:list", (event) =>
      authorize(event).pipe(
        Effect.andThen(run("list-backups", administration.listBackups)),
        Effect.map((backups) => [...backups]),
      ),
    );
    yield* handle("backup:capacity:get", (event) =>
      authorize(event).pipe(
        Effect.andThen(run("get-backup-capacity", administration.backupCapacity)),
      ),
    );
    yield* handle("backup:storage-optimization:get", (event) =>
      authorize(event).pipe(
        Effect.andThen(
          run("get-snapshot-storage-optimization", administration.snapshotStorageOptimization),
        ),
      ),
    );
    yield* handle("backup:create", (event, input) =>
      authorize(event).pipe(
        Effect.andThen(
          run(
            "create-backup",
            administration.startBackup({ trigger: "manual", label: input?.label }),
          ),
        ),
      ),
    );
    yield* handle("backup:job:get", (event, jobId) =>
      authorize(event).pipe(Effect.andThen(run("get-backup-job", administration.backupJob(jobId)))),
    );
    yield* handle("backup:cancel", (event, jobId) =>
      authorize(event).pipe(
        Effect.andThen(run("cancel-backup", administration.cancelBackup(jobId))),
      ),
    );
    yield* handle("backup:delete", (event, backupId) =>
      authorize(event).pipe(
        Effect.andThen(run("delete-backup", administration.deleteBackup(backupId))),
      ),
    );
    yield* handle("backup:restore", (event, input) =>
      authorize(event).pipe(
        Effect.andThen(run("restore-backup", administration.restoreBackup(input))),
        Effect.flatMap((result) =>
          shutdown
            .request({ _tag: "StoreRestoreRelaunch" })
            .pipe(Effect.as(result), Effect.uninterruptible),
        ),
      ),
    );
  }),
);
