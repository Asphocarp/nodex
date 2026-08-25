import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { MainConfig } from "../../app/MainConfig";
import { ApplicationHostRuntime } from "../../host-runtime/ApplicationHostRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class ApplicationLifecycleIpcError extends Schema.TaggedError<ApplicationLifecycleIpcError>()(
  "ApplicationLifecycleIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export const live: Layer.Layer<
  never,
  never,
  ApplicationHostRuntime | ElectronIpc | MainConfig | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const host = yield* ApplicationHostRuntime;
    const ipc = yield* ElectronIpc;
    const windows = yield* WindowRuntime;
    const authorize = (event: IpcMainEvent | IpcMainInvokeEvent, capabilityName: string) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, capabilityName, config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error(`${capabilityName} requires an active Nodex window`);
          }
        },
        catch: (cause) =>
          new ApplicationLifecycleIpcError({ operation: "authorize-renderer", cause }),
      });

    yield* ipc.on("electron-request-microphone-permission", (event) =>
      authorize(event, "Microphone permission").pipe(
        Effect.andThen(host.requestMicrophonePermission),
        Effect.catch(() => Effect.void),
      ),
    );
  }),
);
