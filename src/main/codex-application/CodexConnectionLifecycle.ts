import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { CodexConnectionState } from "../../shared/types";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import { CodexConnection } from "./CodexConnection";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexPendingServerRequestRuntime } from "./CodexPendingServerRequestRuntime";
import { CodexProtocolNotificationEffects } from "./CodexProtocolNotificationEffects";
import { CodexSidebarSyncRuntime } from "./CodexSidebarSyncRuntime";
import { CodexUserInputAutoResolution } from "./CodexUserInputAutoResolution";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export class CodexConnectionLifecycle extends Context.Service<
  CodexConnectionLifecycle,
  { readonly observe: (connection: CodexConnectionState) => Effect.Effect<void> }
>()("nodex/main/codex-application/CodexConnectionLifecycle") {}

/**
 * Owns the application consequences of local app-server connection generations. Transport state
 * stays in `CodexConnection`; this capability atomically retires ephemeral request state and marks
 * loaded conversations for resume before the reconnected catalog is refreshed.
 */
export const make: Effect.Effect<
  CodexConnectionLifecycle["Service"],
  never,
  | CodexApplicationEventHub
  | CodexConnection
  | CodexPendingServerRequestRuntime
  | CodexProtocolNotificationEffects
  | CodexSidebarSyncRuntime
  | CodexUserInputAutoResolution
  | ConversationRuntimeMap
  | Scope.Scope
> = Effect.gen(function* () {
  const connectionState = yield* CodexConnection;
  const events = yield* CodexApplicationEventHub;
  const pending = yield* CodexPendingServerRequestRuntime;
  const protocol = yield* CodexProtocolNotificationEffects;
  const sidebar = yield* CodexSidebarSyncRuntime;
  const autoResolution = yield* CodexUserInputAutoResolution;
  const conversations = yield* ConversationRuntimeMap;
  let previousStatus: CodexConnectionState["status"] = "disconnected";

  const settleDisconnectedRequests = Effect.fn(
    "CodexConnectionLifecycle.settleDisconnectedRequests",
  )(function* () {
    yield* Effect.forEach(
      pending.disconnectIdentities(),
      ({ threadId, requestId }) =>
        conversations.runExclusive(
          threadId,
          protocol
            .apply({
              hostId: DEFAULT_CODEX_HOST_ID,
              generation: 0,
              notification: {
                method: "serverRequest/resolved",
                params: { threadId, requestId },
              },
              occurrenceId: `synthetic:connection:${threadId}:${String(requestId)}`,
              occurrenceToken: 0,
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("Failed to reconcile a disconnected Codex request").pipe(
                  Effect.annotateLogs({ threadId, requestId: String(requestId), error }),
                ),
              ),
            ),
        ),
      { concurrency: "unbounded", discard: true },
    );
  });

  const observe = Effect.fn("CodexConnectionLifecycle.observe")(function* (
    connection: CodexConnectionState,
  ) {
    const wasConnected = previousStatus === "connected";
    previousStatus = connection.status;

    if (wasConnected && connection.status !== "connected") {
      yield* autoResolution.handleDisconnect;
      yield* settleDisconnectedRequests();
    }

    events.publish({ kind: "codex", value: { type: "connection", connection } });
    events.publish({
      kind: "hostMessage",
      value: {
        type: "sharedObjectUpdated",
        hostId: DEFAULT_CODEX_HOST_ID,
        object: {
          objectType: "connection",
          objectId: "connection",
          value: connection,
        },
      },
    });

    if (connection.status !== "connected" || connection.retries <= 0 || wasConnected) return;
    conversations.markAllNeedsResume();
    yield* sidebar
      .sync({ policy: "stale", reason: "app-server-reconnect" })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to refresh the task catalog after Codex reconnected").pipe(
            Effect.annotateLogs({ cause }),
          ),
        ),
      );
  });

  const service = CodexConnectionLifecycle.of({ observe });
  yield* connectionState.changes.pipe(
    Stream.runForEach(service.observe),
    Effect.forkScoped({ startImmediately: true }),
  );
  return service;
});
