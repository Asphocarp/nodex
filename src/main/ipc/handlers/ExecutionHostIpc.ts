import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import { ExecutionHostRuntime } from "../../codex-application/ExecutionHostRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

type ExecutionHostChannel = "worktrees:execution-hosts:get" | "worktrees:execution-hosts:update";

export class ExecutionHostIpcError extends Schema.TaggedError<ExecutionHostIpcError>()(
  "ExecutionHostIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export const live: Layer.Layer<
  never,
  never,
  ElectronIpc | ExecutionHostRuntime | MainConfig | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const executionHosts = yield* ExecutionHostRuntime;
    const ipc = yield* ElectronIpc;
    const windows = yield* WindowRuntime;
    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, "Execution hosts", config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error("Execution host access requires an active Nodex window");
          }
        },
        catch: (cause) => new ExecutionHostIpcError({ operation: "authorize-renderer", cause }),
      });
    const handle = <Channel extends ExecutionHostChannel>(
      channel: Channel,
      handler: (
        event: IpcMainInvokeEvent,
        ...args: IpcApi[Channel]["args"]
      ) => Effect.Effect<IpcApi[Channel]["result"], unknown>,
    ) =>
      ipc.handle(channel, (event, ...args: IpcApi[Channel]["args"]) =>
        authorize(event).pipe(Effect.andThen(handler(event, ...args))),
      );

    yield* handle("worktrees:execution-hosts:get", () => executionHosts.settings);
    yield* handle("worktrees:execution-hosts:update", (_, input) =>
      executionHosts.updateSettings(input),
    );
  }),
);
