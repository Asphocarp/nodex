import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { BrowserUseRuntime } from "../host-runtime/BrowserUseRuntime";
import { CodexActiveGoalContinuation } from "./CodexActiveGoalContinuation";
import { CodexConversationDeltaBufferRuntime } from "./CodexConversationDeltaBufferRuntime";
import { CodexManualCompactionRuntime } from "./CodexManualCompactionRuntime";
import { CodexPendingServerRequestRuntime } from "./CodexPendingServerRequestRuntime";
import { CodexQueuedFollowUpDispatcher } from "./CodexQueuedFollowUpDispatcher";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export class CodexConversationLifecycle extends Context.Service<
  CodexConversationLifecycle,
  {
    /** Retires process-local state for the current Thread generation without closing its lane. */
    readonly close: (threadId: string, reason: unknown) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexConversationLifecycle") {}

/**
 * Owns the complete process-local retirement boundary for one Codex conversation.
 *
 * `close` is safe to call while already running in the conversation's exclusive lane. It must not
 * call `ConversationRuntimeMap.runExclusive` or physically close the current runtime: the caller
 * may be that runtime's active fiber. Queue invalidation therefore happens through the canonical
 * aggregate after its dispatcher has stopped, rather than through `CodexQueuedFollowUps.clear`,
 * whose public command intentionally acquires the lane.
 */
export const make: Effect.Effect<
  CodexConversationLifecycle["Service"],
  never,
  | CodexActiveGoalContinuation
  | CodexConversationDeltaBufferRuntime
  | CodexManualCompactionRuntime
  | CodexPendingServerRequestRuntime
  | CodexQueuedFollowUpDispatcher
  | CodexRendererConversationCoordinator
  | ConversationRuntimeMap
  | BrowserUseRuntime
> = Effect.gen(function* () {
  const activeGoalContinuation = yield* CodexActiveGoalContinuation;
  const deltas = yield* CodexConversationDeltaBufferRuntime;
  const manualCompaction = yield* CodexManualCompactionRuntime;
  const pending = yield* CodexPendingServerRequestRuntime;
  const queuedDispatcher = yield* CodexQueuedFollowUpDispatcher;
  const renderer = yield* CodexRendererConversationCoordinator;
  const conversations = yield* ConversationRuntimeMap;
  const browserUse = yield* BrowserUseRuntime;

  const close = Effect.fn("CodexConversationLifecycle.close")(function* (
    threadId: string,
    reason: unknown,
  ) {
    if (!threadId) return;

    // Fence new local consequences before any asynchronous resource cleanup can yield.
    pending.rejectDispatchedDynamicForThread(threadId, reason);
    pending.rejectRemovedTurns(threadId, new Set(), { retainTurnless: false });
    deltas.clear(threadId);
    manualCompaction.clear(threadId);

    // Cancellation must finish before aggregate reset invalidates a claimed queue generation.
    yield* queuedDispatcher.cancel(threadId);
    yield* renderer.clearConversation(threadId);
    yield* activeGoalContinuation.clear(threadId);

    // Preserve the current runtime/lane while retiring all canonical process-local state,
    // including the visible and claimed queued-follow-up generation.
    conversations.currentConversation(threadId)?.reset();

    yield* browserUse.releaseSession(threadId).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          "Could not release Browser Use session for closed Codex conversation",
        ).pipe(
          Effect.annotateLogs({
            cause: String(error.cause),
            threadId,
          }),
        ),
      ),
    );
  });

  return CodexConversationLifecycle.of({ close });
});
