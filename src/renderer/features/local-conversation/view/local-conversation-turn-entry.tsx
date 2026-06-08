import { memo, useMemo } from "react";
import type { CodexConversationTurn, CodexTurnDiffReviewTarget } from "../../../lib/types";
import type { CodexTurnScopedConversationRequest } from "../conversation-request-helpers";
import { buildTurnRenderModel } from "../projection/build-turn-render-model";
import type { ThreadStageActions } from "../thread-stage-types";
import { ThreadTurn } from "./local-conversation-thread-turn";

interface LocalConversationTurnEntryProps {
  conversationId: string;
  turnSearchKey: string;
  turn: CodexConversationTurn;
  requests: CodexTurnScopedConversationRequest[];
  cwd: string | null;
  isMostRecentTurn: boolean;
  persistedCollapsed?: boolean;
  onSetCollapsed?: (collapsed: boolean) => void;
  canEditTurnUserPrefix: boolean;
  canForkTurn: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onEditLastTurnMessage?: (input: {
    threadId: string;
    turnId: string;
    message: string;
  }) => void | Promise<void>;
  onForkTurnMessage?: (input: {
    threadId: string;
    turnId: string;
    message: string;
    isLatestTurn: boolean;
  }) => void | Promise<void>;
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onRendered?: (turnId: string) => void;
}

function LocalConversationTurnEntryComponent({
  turnSearchKey,
  turn,
  requests,
  isMostRecentTurn,
  persistedCollapsed,
  onSetCollapsed,
  canEditTurnUserPrefix,
  canForkTurn,
  projectWorkspacePath,
  threadCwd,
  onEditLastTurnMessage,
  onForkTurnMessage,
  onOpenTurnDiffReview,
  onOpenSideChat,
  onRendered,
}: LocalConversationTurnEntryProps) {
  onRendered?.(turn.turnId);
  const turnModel = useMemo(
    () =>
      buildTurnRenderModel({
        turn,
        requests,
        isLatestTurn: isMostRecentTurn,
        isStreamingTurn: turn.status === "inProgress",
        canEditTurnUserPrefix,
        canForkTurn,
      }),
    [
      canEditTurnUserPrefix,
      canForkTurn,
      isMostRecentTurn,
      requests,
      turn,
    ],
  );

  return (
    <div
      data-content-search-turn-key={turnSearchKey}
      className="flex flex-col gap-0 [contain-intrinsic-size:auto_240px] [content-visibility:auto]"
    >
      <ThreadTurn
        turn={turnModel}
        agentBodyCollapsed={
          persistedCollapsed ?? turnModel.defaultAgentBodyCollapsed
        }
        hasPersistedAgentBodyCollapsedState={persistedCollapsed !== undefined}
        onAgentBodyCollapsedChange={(turnId, collapsed) => {
          if (turnId !== turn.turnId) return;
          onSetCollapsed?.(collapsed);
        }}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onEditLastUserTurn={onEditLastTurnMessage}
        onForkFromTurn={onForkTurnMessage}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
        onOpenSideChat={onOpenSideChat}
      />
    </div>
  );
}

export const LocalConversationTurnEntry = memo(
  LocalConversationTurnEntryComponent,
  (left, right) =>
    left.conversationId === right.conversationId
    && left.turnSearchKey === right.turnSearchKey
    && left.turn === right.turn
    && left.requests === right.requests
    && left.cwd === right.cwd
    && left.isMostRecentTurn === right.isMostRecentTurn
    && left.persistedCollapsed === right.persistedCollapsed
    && left.onSetCollapsed === right.onSetCollapsed
    && left.canEditTurnUserPrefix === right.canEditTurnUserPrefix
    && left.canForkTurn === right.canForkTurn
    && left.projectWorkspacePath === right.projectWorkspacePath
    && left.threadCwd === right.threadCwd
    && left.onEditLastTurnMessage === right.onEditLastTurnMessage
    && left.onForkTurnMessage === right.onForkTurnMessage
    && left.onOpenTurnDiffReview === right.onOpenTurnDiffReview
    && left.onOpenSideChat === right.onOpenSideChat
    && left.onRendered === right.onRendered,
);
