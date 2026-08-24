import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { MainConfig } from "../../app/MainConfig";
import { ApplicationHostRuntime } from "../../host-runtime/ApplicationHostRuntime";
import { ApplicationInitializationRuntime } from "../../host-runtime/ApplicationInitializationRuntime";
import { safeSendToWebContents } from "../../ipc-safe-send";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

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

export const live: Layer.Layer<
  never,
  never,
  | ApplicationHostRuntime
  | ApplicationInitializationRuntime
  | ElectronIpc
  | MainConfig
  | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const host = yield* ApplicationHostRuntime;
    const initialization = yield* ApplicationInitializationRuntime;
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
          initialization.current.pipe(
            Effect.map((step) => {
              safeSendToWebContents(event.sender, "app:init-step", [step]);
            }),
          ),
        ),
        Effect.andThen(initialization.awaitDone),
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
        Effect.flatMap((report) => initialization.reportRenderer(event.sender.id, report)),
        Effect.catch(() => Effect.void),
      ),
    );
    yield* ipc.on("electron-request-microphone-permission", (event) =>
      authorize(event, "Microphone permission").pipe(
        Effect.andThen(host.requestMicrophonePermission),
        Effect.catch(() => Effect.void),
      ),
    );
  }),
);
