import { useCallback, useMemo } from "react";
import {
  useCodexAppServerManagerForConversationId,
  useCodexConversationValue,
} from "../local-conversation-store";
import { ReviewDiffPanel } from "@/components/workbench/review-diff-panel";
import type {
  CodexConversationSnapshot,
  CodexTurnDiffReviewTarget,
  GitReviewSource,
} from "@/lib/types";
import {
  areReviewConversationProjectionsEqual,
  createReviewConversationProjectionSelector,
} from "@/features/review/model/review-conversation-projection";
import { recordReviewRuntimeEvent } from "@/features/review/testing/review-runtime-probe";

interface ConnectedReviewDiffPanelProps {
  threadId: string | null;
  projectWorkspacePath?: string | null;
  searchOpenTick: number;
  initialGitSource?: GitReviewSource | null;
  initialGitSourceRequestKey?: number | null;
  selectedTurnDiff?: CodexTurnDiffReviewTarget | null;
}

function refreshSelectedTurnDiffTarget(
  selectedTurnDiff: CodexTurnDiffReviewTarget | null,
  conversation: CodexConversationSnapshot | null,
  projectWorkspacePath: string | null,
): CodexTurnDiffReviewTarget | null {
  if (!selectedTurnDiff || !conversation) return selectedTurnDiff;

  const turn = conversation.turns.find(
    (candidate) => candidate.turnId === selectedTurnDiff.turnId,
  );
  const item = turn?.items.find(
    (candidate) =>
      (candidate.entryId ?? candidate.itemId) === selectedTurnDiff.entryId,
  );
  if (!item || item.rawItem === null || typeof item.rawItem !== "object") return selectedTurnDiff;

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
    return selectedTurnDiff;
  }

  const cwd = typeof rawItem.cwd === "string" && rawItem.cwd.trim().length > 0
    ? rawItem.cwd
    : selectedTurnDiff.cwd ?? conversation.cwd ?? projectWorkspacePath;

  return {
    ...selectedTurnDiff,
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
      : selectedTurnDiff.patchBatches,
  };
}

function areSelectedTurnDiffTargetsEqual(
  left: CodexTurnDiffReviewTarget | null,
  right: CodexTurnDiffReviewTarget | null,
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
    left.type === right.type &&
    left.threadId === right.threadId &&
    left.turnId === right.turnId &&
    left.entryId === right.entryId &&
    left.patch === right.patch &&
    left.cwd === right.cwd &&
    left.path === right.path &&
    left.source === right.source &&
    left.showRevertButton === right.showRevertButton &&
    patchBatchesEqual
  );
}

export function ConnectedReviewDiffPanel({
  threadId,
  projectWorkspacePath,
  searchOpenTick,
  initialGitSource = null,
  initialGitSourceRequestKey = null,
  selectedTurnDiff = null,
}: ConnectedReviewDiffPanelProps) {
  recordReviewRuntimeEvent({ type: "connected-render" });
  const reviewProjectionSelector = useMemo(
    createReviewConversationProjectionSelector,
    [],
  );
  const conversationProjection = useCodexConversationValue(
    threadId,
    reviewProjectionSelector,
    areReviewConversationProjectionsEqual,
  );
  const refreshedSelectedTurnDiff = useCodexConversationValue(
    threadId,
    (conversation) =>
      refreshSelectedTurnDiffTarget(
        selectedTurnDiff,
        conversation,
        projectWorkspacePath ?? null,
      ),
    areSelectedTurnDiffTargetsEqual,
  );
  const manager = useCodexAppServerManagerForConversationId(threadId);
  const startThreadPrompt = useCallback(
    (targetThreadId: string, prompt: string) =>
      manager.startTurn(targetThreadId, prompt),
    [manager],
  );

  return (
    <ReviewDiffPanel
      conversationProjection={conversationProjection}
      onStartThreadPrompt={startThreadPrompt}
      threadId={threadId}
      projectWorkspacePath={projectWorkspacePath ?? null}
      initialSource={initialGitSource ?? undefined}
      initialSourceRequestKey={initialGitSourceRequestKey}
      selectedTurnDiff={refreshedSelectedTurnDiff}
      searchOpenTick={searchOpenTick}
    />
  );
}

export const connectedReviewDiffPanelTestHelpers = {
  refreshSelectedTurnDiffTarget,
};
