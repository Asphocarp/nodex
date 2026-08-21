import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import { safeBroadcastToWindows } from "../../ipc-safe-send";
import type { PersistedAtomStore } from "../../local-store/persisted-atoms";
import { getLogger } from "../../logging/logger";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class ApplicationLocalStateIpcError extends Schema.TaggedError<ApplicationLocalStateIpcError>()(
  "ApplicationLocalStateIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

const diagnostics = getLogger({ subsystem: "renderer", component: "diagnostics" });

export const live = (options: {
  readonly persistedAtoms: PersistedAtomStore;
}): Layer.Layer<never, never, ElectronIpc | MainConfig | WindowRuntime> =>
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
            requireTrustedAppRendererSender(event, "Application local state", config.rendererUrl);
            if (!windows.has(event.sender.id)) {
              throw new Error("Application local state requires an active Nodex window");
            }
          },
          catch: (cause) =>
            new ApplicationLocalStateIpcError({ operation: "authorize-renderer", cause }),
        });

      yield* handle("diagnostics:renderer-log", (event, input) =>
        authorize(event).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (config.assistantStreamingDebug) diagnostics.info(input.message, input.fields);
            }),
          ),
        ),
      );
      yield* handle("persisted-atom:sync-request", (event) =>
        authorize(event).pipe(
          Effect.andThen(Effect.sync(() => options.persistedAtoms.readSnapshot())),
        ),
      );
      yield* handle("persisted-atom:update", (event, mutation) =>
        authorize(event).pipe(
          Effect.andThen(
            Effect.try({
              try: () => {
                const persistedEvent = options.persistedAtoms.commitMutation(
                  mutation,
                  String(event.sender.id),
                );
                safeBroadcastToWindows(windows.all(), "persisted-atom:updated", [persistedEvent]);
                return persistedEvent;
              },
              catch: (cause) =>
                new ApplicationLocalStateIpcError({ operation: "update-persisted-atom", cause }),
            }),
          ),
        ),
      );
    }),
  );
