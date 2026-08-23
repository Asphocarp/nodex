import type {
  CodexCanonicalConversationState,
  CodexCanonicalTurnState,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexItemView,
} from "../../shared/types";
import { applyCodexLifecycleProjectionDiff } from "../../shared/codex-conversation-state/codex-lifecycle-projection-diff";
import { buildCodexTurnOccurrenceKey } from "../../shared/codex-turn-identity";

const asCurrentView = (item: CodexConversationTurn["items"][number]): CodexItemView => ({
  ...item,
  normalizedKind: item.kind,
});

const projectTurn = (input: {
  readonly threadId: string;
  readonly turnIndex: number;
  readonly beforeTurn: CodexCanonicalTurnState | null;
  readonly afterTurn: CodexCanonicalTurnState;
  readonly current: CodexConversationTurn | null;
  readonly observedAtMs: number;
}): CodexConversationTurn => {
  const turnId = input.afterTurn.protocol.id;
  const projection = applyCodexLifecycleProjectionDiff({
    threadId: input.threadId,
    turnKey: buildCodexTurnOccurrenceKey(turnId, input.turnIndex),
    beforeTurn: input.beforeTurn,
    afterTurn: input.afterTurn,
    currentViews: input.current?.items.map(asCurrentView) ?? [],
    currentTranscript: input.current?.items ?? [],
    observedAtMs: input.observedAtMs,
    isBackgroundSubagentsEnabled: true,
    preserveExistingUpdatedAt: true,
  });

  return {
    ...input.current,
    threadId: input.threadId,
    turnId,
    status: input.afterTurn.protocol.status,
    errorMessage: input.afterTurn.protocol.error?.message ?? undefined,
    ...(input.afterTurn.sidecar.diff === null
      ? { diff: undefined }
      : { diff: input.afterTurn.sidecar.diff }),
    itemIds:
      turnId === null
        ? [...new Set(projection.transcript.map((entry) => entry.itemId))]
        : [...projection.itemIds],
    turnStartedAtMs: input.afterTurn.sidecar.turnStartedAtMs,
    firstTurnWorkItemStartedAtMs: input.afterTurn.sidecar.firstTurnWorkItemStartedAtMs,
    finalAssistantStartedAtMs: input.afterTurn.sidecar.finalAssistantStartedAtMs,
    startedAt: input.afterTurn.sidecar.turnStartedAtMs,
    completedAt: input.afterTurn.sidecar.completedAtMs ?? null,
    durationMs: input.afterTurn.protocol.durationMs,
    commandExecutionStartedAtMsById:
      input.afterTurn.sidecar.commandExecutionStartedAtMsById === undefined
        ? undefined
        : { ...input.afterTurn.sidecar.commandExecutionStartedAtMsById },
    interruptedCommandExecutionItemIds:
      input.afterTurn.sidecar.interruptedCommandExecutionItemIds === undefined
        ? undefined
        : [...input.afterTurn.sidecar.interruptedCommandExecutionItemIds],
    hookRuns:
      input.afterTurn.sidecar.hookRuns === undefined
        ? undefined
        : [...input.afterTurn.sidecar.hookRuns],
    safetyBuffering:
      input.afterTurn.sidecar.safetyBuffering === undefined
        ? undefined
        : {
            ...input.afterTurn.sidecar.safetyBuffering,
            useCases: [...input.afterTurn.sidecar.safetyBuffering.useCases],
            reasons: [...input.afterTurn.sidecar.safetyBuffering.reasons],
          },
    items: projection.transcript.map((entry) => ({ ...entry })),
  };
};

/**
 * Pure canonical-to-application projection. The aggregate owns the resulting snapshot;
 * runtimes never need a mutable CodexService record to apply history or delta changes.
 */
export const projectCodexConversationSnapshot = (input: {
  readonly conversation: CodexConversationSnapshot;
  readonly before: CodexCanonicalConversationState | null;
  readonly after: CodexCanonicalConversationState;
  readonly observedAtMs: number;
}): CodexConversationSnapshot => ({
  ...input.conversation,
  canonicalState: input.after,
  canonicalRequests: [...input.after.requests],
  hasUnreadTurn: input.after.sidecar.hasUnreadTurn,
  turns: input.after.turns.map((afterTurn, turnIndex) => {
    const turnId = afterTurn.protocol.id;
    const beforeAtIndex = input.before?.turns[turnIndex] ?? null;
    const beforeTurn =
      beforeAtIndex?.protocol.id === turnId
        ? beforeAtIndex
        : (input.before?.turns.find((turn) => turn.protocol.id === turnId) ?? null);
    const currentAtIndex = input.conversation.turns[turnIndex] ?? null;
    const current =
      currentAtIndex?.turnId === turnId
        ? currentAtIndex
        : (input.conversation.turns.find((turn) => turn.turnId === turnId) ?? null);
    if (beforeTurn === afterTurn && current) return current;
    return projectTurn({
      threadId: input.conversation.threadId,
      turnIndex,
      beforeTurn,
      afterTurn,
      current,
      observedAtMs: input.observedAtMs,
    });
  }),
});
