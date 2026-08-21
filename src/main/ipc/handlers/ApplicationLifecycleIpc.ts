import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { AppInitializationStep } from "../../../shared/app-startup";
import { MainConfig } from "../../app/MainConfig";
import { safeSendToWebContents } from "../../ipc-safe-send";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface ApplicationLifecycleIpcPort {
  readonly acknowledgeWindowClose: (webContentsId: number) => void;
  readonly awaitInitialization: () => Promise<void>;
  readonly currentInitializationStep: () => AppInitializationStep;
  readonly reportRendererInitialization: (
    webContentsId: number,
    report: { readonly durationMs: number; readonly outcome: "ready" | "failed" },
  ) => void;
  readonly requestMicrophonePermission: () => Promise<void>;
}

export class ApplicationLifecycleIpcError extends Schema.TaggedError<ApplicationLifecycleIpcError>()(
  "ApplicationLifecycleIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const RendererInitializationReport = z
  .object({
    durationMs: z
      .number()
      .finite()
      .min(0)
      .max(10 * 60_000),
    outcome: z.enum(["ready", "failed"]),
  })
  .strict();

export const live = (
  port: ApplicationLifecycleIpcPort,
): Layer.Layer<never, never, ElectronIpc | MainConfig | WindowRuntime> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
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

      yield* ipc.handle("app:await-initialization", (event) =>
        authorize(event, "Application initialization").pipe(
          Effect.andThen(
            Effect.sync(() => {
              safeSendToWebContents(event.sender, "app:init-step", [
                port.currentInitializationStep(),
              ]);
            }),
          ),
          Effect.andThen(
            Effect.tryPromise({
              try: port.awaitInitialization,
              catch: (cause) =>
                new ApplicationLifecycleIpcError({ operation: "await-initialization", cause }),
            }),
          ),
        ),
      );
      yield* ipc.on("app:renderer-initialization-finished", (event, input: unknown) =>
        authorize(event, "Renderer initialization report").pipe(
          Effect.andThen(
            Effect.try({
              try: () => RendererInitializationReport.parse(input),
              catch: (cause) =>
                new ApplicationLifecycleIpcError({
                  operation: "parse-renderer-initialization",
                  cause,
                }),
            }),
          ),
          Effect.flatMap((report) =>
            Effect.sync(() => port.reportRendererInitialization(event.sender.id, report)),
          ),
          Effect.catch(() => Effect.void),
        ),
      );
      yield* ipc.handle("app:flush-before-close:done", (event, claimedWebContentsId: unknown) =>
        authorize(event, "Window close flush").pipe(
          Effect.andThen(
            Effect.try({
              try: () => {
                if (claimedWebContentsId !== event.sender.id) {
                  throw new Error("Window close flush sender does not own the claimed window");
                }
                port.acknowledgeWindowClose(event.sender.id);
              },
              catch: (cause) =>
                new ApplicationLifecycleIpcError({ operation: "acknowledge-window-close", cause }),
            }),
          ),
        ),
      );
      yield* ipc.on("electron-request-microphone-permission", (event) =>
        authorize(event, "Microphone permission").pipe(
          Effect.andThen(
            Effect.tryPromise({
              try: port.requestMicrophonePermission,
              catch: (cause) =>
                new ApplicationLifecycleIpcError({ operation: "microphone-permission", cause }),
            }),
          ),
          Effect.catch(() => Effect.void),
        ),
      );
    }),
  );
