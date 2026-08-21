import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import type { CodexService } from "../../codex/codex-service";
import {
  registerCodexPendingWorktreeIpcHandlers,
  type CodexPendingWorktreeIpcChannel,
  type CodexPendingWorktreeIpcHandler,
  type CodexPendingWorktreeIpcService,
} from "../../codex/codex-pending-worktree-ipc";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface CodexPendingWorktreeIpcOptions {
  readonly codex: CodexService;
}

export class CodexPendingWorktreeIpcError extends Schema.TaggedError<CodexPendingWorktreeIpcError>()(
  "CodexPendingWorktreeIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type TransferChannel =
  | "codex:pending-worktree:discard-fork-side-panel-transfer"
  | "codex:fork-side-panel-transfer:consume";

export const live = (
  options: CodexPendingWorktreeIpcOptions,
): Layer.Layer<never, never, ElectronIpc | MainConfig | WindowRuntime> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const windows = yield* WindowRuntime;
      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSender(event, "Codex pending worktree", config.rendererUrl);
            if (!windows.has(event.sender.id)) {
              throw new Error("Codex pending worktree access requires an active Nodex window");
            }
          },
          catch: (cause) =>
            new CodexPendingWorktreeIpcError({ operation: "authorize-renderer", cause }),
        });
      const invoke = <A>(operation: string, task: () => A | Promise<A>) =>
        Effect.tryPromise({
          try: () => Promise.resolve(task()),
          catch: (cause) => new CodexPendingWorktreeIpcError({ operation, cause }),
        });
      const install = <Channel extends CodexPendingWorktreeIpcChannel>(
        channel: Channel,
        handler: CodexPendingWorktreeIpcHandler<Channel>,
      ) =>
        ipc.handle(channel, (event, ...args) =>
          authorize(event).pipe(
            Effect.flatMap(() =>
              invoke(channel, () => Reflect.apply(handler, undefined, [event, ...args])),
            ),
          ),
        );
      const registrations: Array<Effect.Effect<void, never, Scope.Scope>> = [];

      registerCodexPendingWorktreeIpcHandlers({
        registerHandle: (channel, handler) => {
          registrations.push(install(channel, handler));
        },
        service: options.codex as unknown as CodexPendingWorktreeIpcService,
      });
      yield* Effect.all(registrations, { discard: true });

      const handle = <Channel extends TransferChannel>(
        channel: Channel,
        handler: (
          event: IpcMainInvokeEvent,
          ...args: IpcApi[Channel]["args"]
        ) => Effect.Effect<IpcApi[Channel]["result"], unknown>,
      ) => ipc.handle(channel, handler);

      yield* handle(
        "codex:pending-worktree:discard-fork-side-panel-transfer",
        (event, pendingWorktreeId) =>
          authorize(event).pipe(
            Effect.flatMap(() => {
              if (!pendingWorktreeId.trim()) {
                return Effect.fail(
                  new CodexPendingWorktreeIpcError({
                    operation: "discard-fork-side-panel-transfer",
                    cause: new Error("Pending worktree id is required"),
                  }),
                );
              }
              return invoke("discard-fork-side-panel-transfer", () =>
                options.codex.discardPendingForkSidePanelTransfer(pendingWorktreeId),
              );
            }),
          ),
      );
      yield* handle("codex:fork-side-panel-transfer:consume", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap(() => {
            if (windows.resolveSessionId(event.sender.id) !== input.targetBrowserViewScopeId) {
              return Effect.fail(
                new CodexPendingWorktreeIpcError({
                  operation: "consume-fork-side-panel-transfer",
                  cause: new Error("Browser view scope does not belong to the requesting window"),
                }),
              );
            }
            return invoke("consume-fork-side-panel-transfer", () =>
              options.codex.consumeForkSidePanelTransfer(input),
            );
          }),
        ),
      );
    }),
  );
