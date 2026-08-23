import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import { resolveCodexReasoningSummary } from "../../shared/codex-reasoning-summary-policy";
import type { CodexConversationAggregate } from "./CodexConversationAggregate";
import { CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { CodexThreadSettingsRuntime } from "./CodexThreadSettingsRuntime";
import { CodexTurnCommands } from "./CodexTurnCommands";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export const DEFAULT_ACTIVE_GOAL_CONTINUATION_DELAY = "250 millis";

export class CodexActiveGoalContinuation extends Context.Service<
  CodexActiveGoalContinuation,
  {
    readonly request: (conversationId: string) => Effect.Effect<void>;
    readonly clear: (conversationId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexActiveGoalContinuation") {}

export const isCodexActiveGoalContinuationEligible = (
  conversation: CodexConversationAggregate | null,
): boolean => {
  if (!conversation || conversation.readResumeState() !== "resumed") return false;
  const snapshot = conversation.readSnapshot();
  const canonical = conversation.readCanonicalState();
  if (!snapshot || !canonical || snapshot.threadGoal?.status !== "active") return false;
  if (conversation.readServerRequests().length > 0) return false;
  if (snapshot.pendingSteers.length > 0) return false;
  if (conversation.readStreamRole() !== "owner" || !conversation.isStreaming()) return false;
  if (snapshot.statusType === "active" || snapshot.statusActiveFlags.length > 0) return false;
  return !canonical.turns.some(
    (turn) =>
      turn.protocol.status === "inProgress" ||
      turn.items.some(
        (item) => item.type === "collabAgentToolCall" && item.status === "inProgress",
      ),
  );
};

export const make: Effect.Effect<
  CodexActiveGoalContinuation["Service"],
  never,
  | CodexThreadGoalRuntime
  | CodexThreadSettingsRuntime
  | CodexTurnCommands
  | ConversationRuntimeMap
  | Scope.Scope
> = Effect.gen(function* () {
  const conversations = yield* ConversationRuntimeMap;
  const threadGoals = yield* CodexThreadGoalRuntime;
  const threadSettings = yield* CodexThreadSettingsRuntime;
  const turnCommands = yield* CodexTurnCommands;
  const continuations = yield* FiberMap.make<string, void, never>();
  const admission = yield* Semaphore.make(1);

  const isEligible = (conversationId: string): boolean =>
    isCodexActiveGoalContinuationEligible(conversations.currentConversation(conversationId));

  const continueGoal = Effect.fn("CodexActiveGoalContinuation.continueGoal")(function* (
    conversationId: string,
  ) {
    if (!isEligible(conversationId)) return;
    yield* threadSettings.awaitCurrent(conversationId);
    if (!isEligible(conversationId)) return;

    const snapshot = conversations.currentConversation(conversationId)?.readSnapshot();
    const summary = resolveCodexReasoningSummary({
      configuredSummary: snapshot?.latestThreadSettings?.summary,
    });
    if (snapshot?.latestThreadSettings?.summary !== summary) {
      yield* threadSettings.update({ threadId: conversationId, patch: { summary } });
    }
    if (!isEligible(conversationId)) return;
    if (threadSettings.remoteUpdateSupport() === "unsupported") {
      yield* turnCommands.continueGoal(conversationId);
      return;
    }
    yield* threadGoals.set({ threadId: conversationId, status: "active" });
  });

  const runContinuation = (conversationId: string) =>
    Effect.sleep(DEFAULT_ACTIVE_GOAL_CONTINUATION_DELAY).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          isEligible(conversationId) ? continueGoal(conversationId) : Effect.void,
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Failed to continue active Codex thread goal").pipe(
          Effect.annotateLogs({
            cause,
            conversationId,
          }),
        ),
      ),
    );

  const request = (conversationId: string) =>
    admission.withPermits(1)(
      Effect.gen(function* () {
        if (!isEligible(conversationId)) return;
        if (yield* FiberMap.has(continuations, conversationId)) return;
        yield* FiberMap.run(continuations, conversationId, runContinuation(conversationId), {
          startImmediately: true,
        });
      }),
    );

  return CodexActiveGoalContinuation.of({
    request,
    clear: (conversationId) => FiberMap.remove(continuations, conversationId),
  });
});

export interface CodexActiveGoalContinuationLegacyPort {
  readonly request: (conversationId: string) => void;
  readonly clear: (conversationId: string) => void;
}
