import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import type { DesktopStoreAdministrationPort } from "../../core-client/desktop-store-administration-bridge";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface StoreAdministrationIpcOptions {
  readonly administration: DesktopStoreAdministrationPort;
  readonly onStoreRestored: Effect.Effect<void>;
}

export class StoreAdministrationIpcError extends Schema.TaggedError<StoreAdministrationIpcError>()(
  "StoreAdministrationIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

export const live = (
  options: StoreAdministrationIpcOptions,
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
            requireTrustedAppRendererSender(event, "Store administration", config.rendererUrl);
            if (!windows.has(event.sender.id)) {
              throw new Error("Store administration requires an active Nodex window");
            }
          },
          catch: (cause) =>
            new StoreAdministrationIpcError({ operation: "authorize-renderer", cause }),
        });
      const run = <A>(operation: string, task: () => Promise<A>) =>
        Effect.tryPromise({
          try: task,
          catch: (cause) => new StoreAdministrationIpcError({ operation, cause }),
        });

      yield* handle("backup:list", (event) =>
        authorize(event).pipe(
          Effect.andThen(run("list-backups", options.administration.listBackups)),
        ),
      );
      yield* handle("backup:create", (event, input) =>
        authorize(event).pipe(
          Effect.andThen(
            run("create-backup", () =>
              options.administration.createBackup({ trigger: "manual", label: input?.label }),
            ),
          ),
        ),
      );
      yield* handle("backup:delete", (event, backupId) =>
        authorize(event).pipe(
          Effect.andThen(run("delete-backup", () => options.administration.deleteBackup(backupId))),
        ),
      );
      yield* handle("backup:restore", (event, input) =>
        authorize(event).pipe(
          Effect.andThen(run("restore-backup", () => options.administration.restoreBackup(input))),
          Effect.tap(() => options.onStoreRestored),
        ),
      );
    }),
  );
