import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import { CodexPermissions } from "../../codex-application/CodexPermissions";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

type PermissionChannel =
  | "codex:permission:mode:set"
  | "codex:permission:mode:get"
  | "codex:permission:state:get"
  | "codex:permission:config-value:set";

export class CodexPermissionsIpcError extends Schema.TaggedError<CodexPermissionsIpcError>()(
  "CodexPermissionsIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export const live: Layer.Layer<
  never,
  never,
  CodexPermissions | ElectronIpc | MainConfig | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const ipc = yield* ElectronIpc;
    const permissions = yield* CodexPermissions;
    const windows = yield* WindowRuntime;
    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, "Codex permissions", config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error("Codex permission access requires an active Nodex window");
          }
        },
        catch: (cause) => new CodexPermissionsIpcError({ operation: "authorize-renderer", cause }),
      });
    const handle = <Channel extends PermissionChannel>(
      channel: Channel,
      handler: (
        event: IpcMainInvokeEvent,
        ...args: IpcApi[Channel]["args"]
      ) => Effect.Effect<IpcApi[Channel]["result"], unknown>,
    ) =>
      ipc.handle(channel, (event, ...args: IpcApi[Channel]["args"]) =>
        authorize(event).pipe(Effect.andThen(handler(event, ...args))),
      );

    yield* handle("codex:permission:mode:set", (_, projectId, mode) =>
      permissions.setMode(projectId, mode),
    );
    yield* handle("codex:permission:mode:get", (_, projectId) =>
      permissions.snapshot(projectId).pipe(Effect.map((state) => state.mode)),
    );
    yield* handle("codex:permission:state:get", (_, projectId) => permissions.snapshot(projectId));
    yield* handle("codex:permission:config-value:set", (_, projectId, keyPath, value) =>
      permissions.setConfigValue(projectId, keyPath, value),
    );
  }),
);
