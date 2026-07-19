import { useCallback, useMemo } from "react";
import {
  useCodexAppServerManagerForConversationId,
  useCodexConversationValue,
} from "../local-conversation-store";
import { ReviewDiffPanel } from "@/components/workbench/review-diff-panel";
import type {
  CodexConversationSnapshot,
} from "@/lib/types";
import { useScopedAtomValue } from "@/lib/maitai";
import {
  reviewRouteStateAtom,
  type ResolvedTurnDiffReview,
  type ReviewSelectedTurnIdentity,
} from "@/features/review/model/review-view-state";
import {
  areReviewConversationProjectionsEqual,
  createReviewConversationProjectionSelector,
} from "@/features/review/model/review-conversation-projection";
import { recordReviewRuntimeEvent } from "@/features/review/testing/review-runtime-probe";

interface ConnectedReviewDiffPanelProps {
  threadId: string | null;
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
}

function refreshSelectedTurnDiffTarget(
  selectedTurn: ReviewSelectedTurnIdentity | null,
  conversation: CodexConversationSnapshot | null,
  projectWorkspacePath: string | null,
): ResolvedTurnDiffReview | null {
  if (!selectedTurn || !conversation) return null;

  const turn = conversation.turns.find(
    (candidate) => candidate.turnId === selectedTurn.turnId,
  );
  const item = turn?.items.find(
    (candidate) =>
      (candidate.entryId ?? candidate.itemId) === selectedTurn.entryId,
  );
  if (!item || item.rawItem === null || typeof item.rawItem !== "object") return null;

  const rawItem = item.rawItem as {
    unifiedDiff?: unknown;
    cwd?: unknown;
    showRevertButton?: unknown;
    patchBatches?: unknown;
  };
  if (
    typeof rawItem.unifiedDiff !== "string" ||
    rawItem.unifiedDiff.trim().length === 0
  ) {
    return null;
  }

  const cwd = typeof rawItem.cwd === "string" && rawItem.cwd.trim().length > 0
    ? rawItem.cwd
    : conversation.cwd ?? projectWorkspacePath;

  return {
    threadId: selectedTurn.threadId,
    turnId: selectedTurn.turnId,
    entryId: selectedTurn.entryId,
    patch: rawItem.unifiedDiff,
    cwd: cwd ?? null,
    showRevertButton: rawItem.showRevertButton === true,
    patchBatches: Array.isArray(rawItem.patchBatches)
      ? rawItem.patchBatches.flatMap((batch) => {
          if (typeof batch !== "object" || batch === null) return [];
          const batchCwd = (batch as { cwd?: unknown }).cwd;
          const changes = (batch as { changes?: unknown }).changes;
          return [
            {
              cwd:
                typeof batchCwd === "string" && batchCwd.trim().length > 0
                  ? batchCwd
                  : null,
              changes: Array.isArray(changes) ? changes : [],
            },
          ];
        })
      : undefined,
  };
}

function areSelectedTurnDiffTargetsEqual(
  left: ResolvedTurnDiffReview | null,
  right: ResolvedTurnDiffReview | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftPatchBatches = left.patchBatches ?? [];
  const rightPatchBatches = right.patchBatches ?? [];
  const patchBatchesEqual =
    left.patchBatches === right.patchBatches ||
    (leftPatchBatches.length === rightPatchBatches.length &&
      leftPatchBatches.every(
        (batch, index) =>
          batch.cwd === rightPatchBatches[index]?.cwd &&
          batch.changes === rightPatchBatches[index]?.changes,
      ));
  return (
    left.threadId === right.threadId &&
    left.turnId === right.turnId &&
    left.entryId === right.entryId &&
    left.patch === right.patch &&
    left.cwd === right.cwd &&
    left.showRevertButton === right.showRevertButton &&
    patchBatchesEqual
  );
}

export function ConnectedReviewDiffPanel({
  threadId,
  projectWorkspacePath,
  searchOpenTick,
}: ConnectedReviewDiffPanelProps) {
  recordReviewRuntimeEvent({ type: "connected-render" });
  const reviewRouteState = useScopedAtomValue(reviewRouteStateAtom);
  const transcriptThreadId = reviewRouteState.transcriptThreadId ?? threadId;
  const reviewProjectionSelector = useMemo(
    createReviewConversationProjectionSelector,
    [],
  );
  const conversationProjection = useCodexConversationValue(
    transcriptThreadId,
    reviewProjectionSelector,
    areReviewConversationProjectionsEqual,
  );
  const refreshedSelectedTurnDiff = useCodexConversationValue(
    reviewRouteState.source === "selected-turn" ? transcriptThreadId : null,
    (conversation) =>
      refreshSelectedTurnDiffTarget(
        reviewRouteState.selectedTurn,
        conversation,
        projectWorkspacePath ?? null,
      ),
    areSelectedTurnDiffTargetsEqual,
  );
  const manager = useCodexAppServerManagerForConversationId(transcriptThreadId);
  const startThreadPrompt = useCallback(
    (targetThreadId: string, prompt: string) =>
      manager.startTurn(targetThreadId, prompt),
    [manager],
  );

  return (
    <ReviewDiffPanel
      conversationProjection={conversationProjection}
      onStartThreadPrompt={startThreadPrompt}
      threadId={transcriptThreadId}
      projectWorkspacePath={projectWorkspacePath ?? null}
      selectedTurnDiff={refreshedSelectedTurnDiff}
      searchOpenTick={searchOpenTick}
    />
  );
}

export const connectedReviewDiffPanelTestHelpers = {
  refreshSelectedTurnDiffTarget,
};
