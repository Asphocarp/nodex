import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import {
  parseCodexUserInputAutoResolutionActivityInput,
  parseCodexUserInputAutoResolutionTarget,
} from "../../../shared/codex-user-input-auto-resolution";
import { MainConfig } from "../../app/MainConfig";
import { CodexUserInputAutoResolution } from "../../codex-application/CodexUserInputAutoResolution";
import type { CodexService } from "../../codex/codex-service";
import {
  acknowledgeRendererFollowerSnapshotApplied,
  ackRendererThreadOwnerNotification,
  publishRendererThreadOwnerStreamState,
  requestRendererThreadStreamResync,
  runThreadFollowerActionThroughOwner,
} from "../../codex/owner-follower-ipc-bridge";
import type {
  RendererClientRouter,
  RendererClientWebContents,
} from "../../codex/renderer-client-router";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface CodexRendererIpcOptions {
  readonly codex: CodexService;
  readonly rendererClients: RendererClientRouter;
}

export class CodexRendererIpcError extends Schema.TaggedError<CodexRendererIpcError>()(
  "CodexRendererIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

export const live = (
  options: CodexRendererIpcOptions,
): Layer.Layer<
  never,
  never,
  CodexUserInputAutoResolution | ElectronIpc | MainConfig | WindowRuntime
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const userInputAutoResolution = yield* CodexUserInputAutoResolution;
      const windows = yield* WindowRuntime;
      const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
        ipc.handle(channel, handler);
      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSender(
              event,
              "Codex renderer coordination",
              config.rendererUrl,
            );
            if (!windows.has(event.sender.id)) {
              throw new Error("Codex renderer coordination requires an active Nodex window");
            }
            return options.rendererClients.ensureClient(event.sender as RendererClientWebContents)
              .clientId;
          },
          catch: (cause) => new CodexRendererIpcError({ operation: "authorize-renderer", cause }),
        });
      const invoke = <A>(operation: string, task: () => A | Promise<A>) =>
        Effect.tryPromise({
          try: () => Promise.resolve(task()),
          catch: (cause) => new CodexRendererIpcError({ operation, cause }),
        });

      yield* handle("codex:renderer-client:id", (event) => authorize(event));
      yield* handle("codex:renderer-client:response", (event, response) =>
        authorize(event).pipe(
          Effect.map(() =>
            options.rendererClients.handleResponse(
              event.sender as RendererClientWebContents,
              response,
            ),
          ),
        ),
      );
      yield* handle("codex:thread-owner:stream-state:publish", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) =>
            invoke("publish-owner-stream-state", () =>
              publishRendererThreadOwnerStreamState(options.codex, clientId, input),
            ),
          ),
        ),
      );
      yield* handle("codex:thread-follower:snapshot-applied", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) =>
            invoke("acknowledge-follower-snapshot", () =>
              acknowledgeRendererFollowerSnapshotApplied(options.codex, clientId, input),
            ),
          ),
        ),
      );
      yield* handle("codex:thread:stream-resync:request", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) =>
            invoke("request-stream-resync", () =>
              requestRendererThreadStreamResync(options.codex, clientId, input),
            ),
          ),
        ),
      );
      yield* handle("codex:thread-owner:notification:ack", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) =>
            invoke("acknowledge-owner-notification", () =>
              ackRendererThreadOwnerNotification(options.codex, clientId, input),
            ),
          ),
        ),
      );
      yield* handle("codex:thread-owner:pending-requests:replay", (event, threadId) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) =>
            invoke("replay-owner-requests", () =>
              options.codex.replayRendererOwnerPendingRequests(threadId, clientId),
            ),
          ),
        ),
      );
      yield* handle("codex:thread-owner:app-server-request", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) =>
            invoke("handle-owner-server-request", () =>
              options.codex.handleRendererOwnerAppServerRequest(clientId, input),
            ),
          ),
        ),
      );
      yield* handle("codex:thread-follower:action", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) =>
            invoke("run-follower-action", () =>
              runThreadFollowerActionThroughOwner(
                options.codex,
                options.rendererClients,
                clientId,
                input,
              ),
            ),
          ),
        ),
      );
      yield* handle(
        "codex:dynamic-tool-call:respond",
        (event, conversationId, requestId, context) =>
          authorize(event).pipe(
            Effect.flatMap(() =>
              invoke("respond-dynamic-tool", () =>
                options.codex.respondToDynamicToolCall(requestId, conversationId, context),
              ),
            ),
          ),
      );
      yield* handle("codex:user-input:auto-resolution:snapshot", (event) =>
        authorize(event).pipe(Effect.andThen(userInputAutoResolution.snapshot)),
      );
      yield* handle("codex:user-input:auto-resolution:activity", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) => {
            const conversationId = parseCodexUserInputAutoResolutionActivityInput(input);
            if (conversationId === null) return Effect.succeed(false);
            if (!options.codex.isRendererClientPresenting(conversationId, clientId)) {
              return Effect.succeed(false);
            }
            return userInputAutoResolution.recordActivity(conversationId).pipe(Effect.as(true));
          }),
        ),
      );
      yield* handle("codex:user-input:auto-resolution:snooze", (event, input) =>
        authorize(event).pipe(
          Effect.flatMap((clientId) => {
            const target = parseCodexUserInputAutoResolutionTarget(input);
            if (target === null) return Effect.succeed(false);
            if (!options.codex.isRendererClientPresenting(target.conversationId, clientId)) {
              return Effect.succeed(false);
            }
            return userInputAutoResolution.snooze(target.conversationId, target.requestId);
          }),
        ),
      );
    }),
  );
