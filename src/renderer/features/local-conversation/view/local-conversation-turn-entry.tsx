import { memo, useMemo } from "react";
import type { CodexConversationChildMembership, CodexTurnDiffReviewTarget } from "../../../lib/types";
import { selectTurnRenderModel } from "../projection/build-turn-render-model";
import type { VisibleConversationTurnEntry } from "../selectors";
import type {
  ThreadComposerShellBackgroundAgentRowModel,
  ThreadPlanSidePanelState,
  ThreadStageActions,
} from "../thread-stage-types";
import { ThreadTurn } from "./local-conversation-thread-turn";
import { LocalConversationAboveComposerPortal } from "./local-conversation-above-composer-portal";

interface LocalConversationTurnEntryProps {
  conversationId: string;
  childMemberships?: readonly CodexConversationChildMembership[];
  backgroundAgentRows?: readonly ThreadComposerShellBackgroundAgentRowModel[];
  entry: VisibleConversationTurnEntry;
  cwd: string | null;
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
  onOpenTurnDiffFileInSidePanel?: ThreadStageActions["onOpenTurnDiffFileInSidePanel"];
  onOpenSideChat?: ThreadStageActions["onOpenSideChat"];
  onOpenThread?: ThreadStageActions["onOpenThread"];
  onOpenSummaryScheduledAutomation?: ThreadStageActions["onOpenSummaryScheduledAutomation"];
  onOpenMcpAppSidePanel?: ThreadStageActions["onOpenMcpAppSidePanel"];
  onOpenPlanInSidePanel?: ThreadStageActions["onOpenPlanInSidePanel"];
  onClosePlanSidePanel?: ThreadStageActions["onClosePlanSidePanel"];
  planSidePanelState?: ThreadPlanSidePanelState | null;
  turnDiffHoverPreviewDisabled?: boolean;
  onRendered?: (turnId: string) => void;
  latestTurnFollowContentRef?: (element: HTMLDivElement | null) => void;
}

function LocalConversationTurnEntryComponent({
  conversationId,
  childMemberships,
  backgroundAgentRows,
  entry,
  persistedCollapsed,
  onSetCollapsed,
  canEditTurnUserPrefix,
  canForkTurn,
  projectWorkspacePath,
  threadCwd,
  onEditLastTurnMessage,
  onForkTurnMessage,
  onOpenTurnDiffReview,
  onOpenTurnDiffFileInSidePanel,
  onOpenSideChat,
  onOpenThread,
  onOpenSummaryScheduledAutomation,
  onOpenMcpAppSidePanel,
  onOpenPlanInSidePanel,
  onClosePlanSidePanel,
  planSidePanelState,
  turnDiffHoverPreviewDisabled = false,
  onRendered,
  latestTurnFollowContentRef,
}: LocalConversationTurnEntryProps) {
  const turn = entry.turn;
  onRendered?.(entry.turnKey);
  const turnModel = useMemo(
    () =>
      selectTurnRenderModel({
        entry,
        canEditTurnUserPrefix,
        canForkTurn,
        backgroundAgents: backgroundAgentRows,
      }),
    [
      canEditTurnUserPrefix,
      canForkTurn,
      backgroundAgentRows,
      entry,
    ],
  );

  return (
    <>
      <LocalConversationAboveComposerPortal
        blocks={turnModel.aboveComposerBlocks ?? []}
        conversationId={conversationId}
        isLatestTurn={entry.isMostRecentTurn}
        isStreamingTurn={turn.status === "inProgress"}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
        onOpenTurnDiffFileInSidePanel={onOpenTurnDiffFileInSidePanel}
        onOpenSideChat={onOpenSideChat}
        onOpenThread={onOpenThread}
        onOpenSummaryScheduledAutomation={onOpenSummaryScheduledAutomation}
        onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
        onOpenPlanInSidePanel={onOpenPlanInSidePanel}
        onClosePlanSidePanel={onClosePlanSidePanel}
        planSidePanelState={planSidePanelState}
        turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
      />
      <div
        data-content-search-turn-key={entry.turnSearchKey}
        data-virtualized-turn-content="true"
      >
        <ThreadTurn
          turn={turnModel}
          agentBodyCollapsed={
            persistedCollapsed ?? turnModel.defaultAgentBodyCollapsed
          }
          onAgentBodyCollapsedChange={(turnKey, collapsed) => {
            if (turnKey !== entry.turnKey) return;
            onSetCollapsed?.(collapsed);
          }}
          projectWorkspacePath={projectWorkspacePath}
          childMemberships={childMemberships}
          threadCwd={threadCwd}
          onEditLastUserTurn={onEditLastTurnMessage}
          onForkFromTurn={onForkTurnMessage}
          onOpenTurnDiffReview={onOpenTurnDiffReview}
          onOpenTurnDiffFileInSidePanel={onOpenTurnDiffFileInSidePanel}
          onOpenSideChat={onOpenSideChat}
          onOpenThread={onOpenThread}
          onOpenSummaryScheduledAutomation={onOpenSummaryScheduledAutomation}
          onOpenMcpAppSidePanel={onOpenMcpAppSidePanel}
          onOpenPlanInSidePanel={onOpenPlanInSidePanel}
          onClosePlanSidePanel={onClosePlanSidePanel}
          planSidePanelState={planSidePanelState}
          turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
          latestTurnFollowContentRef={latestTurnFollowContentRef}
        />
      </div>
    </>
  );
}

export const LocalConversationTurnEntry = memo(
  LocalConversationTurnEntryComponent,
  (left, right) =>
    left.conversationId === right.conversationId
    && left.childMemberships === right.childMemberships
    && left.backgroundAgentRows === right.backgroundAgentRows
    && left.entry.turn === right.entry.turn
    && left.entry.requests === right.entry.requests
    && left.entry.turnKey === right.entry.turnKey
    && left.entry.turnSearchKey === right.entry.turnSearchKey
    && left.entry.isMostRecentTurn === right.entry.isMostRecentTurn
    && left.cwd === right.cwd
    && left.persistedCollapsed === right.persistedCollapsed
    && left.onSetCollapsed === right.onSetCollapsed
    && left.canEditTurnUserPrefix === right.canEditTurnUserPrefix
    && left.canForkTurn === right.canForkTurn
    && left.projectWorkspacePath === right.projectWorkspacePath
    && left.threadCwd === right.threadCwd
    && left.onEditLastTurnMessage === right.onEditLastTurnMessage
    && left.onForkTurnMessage === right.onForkTurnMessage
    && left.onOpenTurnDiffReview === right.onOpenTurnDiffReview
    && left.onOpenTurnDiffFileInSidePanel === right.onOpenTurnDiffFileInSidePanel
    && left.onOpenSideChat === right.onOpenSideChat
    && left.onOpenThread === right.onOpenThread
    && left.onOpenMcpAppSidePanel === right.onOpenMcpAppSidePanel
    && left.onOpenPlanInSidePanel === right.onOpenPlanInSidePanel
    && left.onClosePlanSidePanel === right.onClosePlanSidePanel
    && left.planSidePanelState === right.planSidePanelState
    && left.turnDiffHoverPreviewDisabled === right.turnDiffHoverPreviewDisabled
    && left.onRendered === right.onRendered
    && left.latestTurnFollowContentRef === right.latestTurnFollowContentRef,
);
