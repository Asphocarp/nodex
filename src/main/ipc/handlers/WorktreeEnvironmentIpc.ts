import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import type { UpdateWorktreeEnvironmentConfigInput } from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import { WorktreeEnvironmentRuntime } from "../../host-runtime/WorktreeEnvironmentRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class WorktreeEnvironmentIpcError extends Schema.TaggedError<WorktreeEnvironmentIpcError>()(
  "WorktreeEnvironmentIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Channel =
  | "worktrees:environments:list"
  | "worktrees:environments:configs:list"
  | "worktrees:environments:configs:list-for-workspace"
  | "worktrees:environments:config:read"
  | "worktrees:environments:config:save";

type Handler<C extends Channel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[C]["args"]
) => Effect.Effect<IpcApi[C]["result"], unknown>;

function validateSaveInput(input: UpdateWorktreeEnvironmentConfigInput): void {
  if (!input.projectId.trim()) throw new Error("Project id is required");
  const revision = input.expectedRevision;
  if (
    revision === null ||
    (typeof revision === "string" && /^sha256:[a-f0-9]{64}$/.test(revision))
  ) {
    return;
  }
  throw new Error("Invalid local environment revision");
}

export const live: Layer.Layer<
  never,
  never,
  ElectronIpc | MainConfig | WindowRuntime | WorktreeEnvironmentRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const environments = yield* WorktreeEnvironmentRuntime;
    const ipc = yield* ElectronIpc;
    const windows = yield* WindowRuntime;
    const authorize = (event: IpcMainInvokeEvent) =>
      Effect.try({
        try: () => {
          requireTrustedAppRendererSender(event, "Worktree environments", config.rendererUrl);
          if (!windows.has(event.sender.id)) {
            throw new Error("Worktree environment access requires an active Nodex window");
          }
        },
        catch: (cause) =>
          new WorktreeEnvironmentIpcError({ operation: "authorize-renderer", cause }),
      });
    const handle = <C extends Channel>(channel: C, handler: Handler<C>) =>
      ipc.handle(channel, (event, ...args) => {
        const task = Reflect.apply(handler, undefined, [event, ...args]) as Effect.Effect<
          IpcApi[C]["result"],
          unknown
        >;
        return authorize(event).pipe(Effect.andThen(task));
      });

    yield* handle("worktrees:environments:list", (_event, projectId) =>
      environments.listProjectOptions(projectId),
    );
    yield* handle("worktrees:environments:configs:list", (_event, projectId) =>
      environments.listProjectConfigs(projectId),
    );
    yield* handle(
      "worktrees:environments:configs:list-for-workspace",
      (_event, hostId, workspaceRoot) => environments.listWorkspaceConfigs(hostId, workspaceRoot),
    );
    yield* handle("worktrees:environments:config:read", (_event, projectId, configPath) =>
      environments.readProjectConfig(projectId, configPath),
    );
    yield* handle("worktrees:environments:config:save", (_event, input) =>
      Effect.try({
        try: () => validateSaveInput(input),
        catch: (cause) =>
          new WorktreeEnvironmentIpcError({ operation: "validate-save-input", cause }),
      }).pipe(Effect.andThen(environments.saveProjectConfig(input))),
    );
  }),
);
