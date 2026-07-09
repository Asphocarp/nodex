import { memo, type ReactNode } from "react";
import type {
  ThreadBodySurfaceModel,
  ThreadBodyUiStateOverrides,
  ThreadPlanSidePanelState,
  ThreadStageActions,
} from "../thread-stage-types";
import {
  LocalConversationThreadBodyOwner,
  type LocalConversationForkIntoWorktreeHandler,
} from "./local-conversation-thread-body-owner";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";
import { HookFeedbackSettingsNavigationProvider } from "./hook-feedback-settings-navigation";
import { ConversationImageAssetProvider } from "./conversation-image-asset-context";

interface LocalConversationThreadBodyProps {
  model: ThreadBodySurfaceModel;
  actions: ThreadStageActions;
  isWorktreeThread?: boolean;
  onForkFromTurnIntoWorktree?: LocalConversationForkIntoWorktreeHandler;
  planSidePanelState?: ThreadPlanSidePanelState | null;
  onErrorMessage: (message: string | null) => void;
  contentShiftX?: number;
  footer?: ReactNode;
  initialUiState?: ThreadBodyUiStateOverrides;
  turnDiffHoverPreviewDisabled?: boolean;
}

function LocalConversationThreadBodyComponent({
  model,
  actions,
  isWorktreeThread = false,
  onForkFromTurnIntoWorktree,
  planSidePanelState,
  onErrorMessage,
  contentShiftX = 0,
  footer,
  initialUiState,
  turnDiffHoverPreviewDisabled = false,
}: LocalConversationThreadBodyProps) {
  return (
    <HookFeedbackSettingsNavigationProvider
      hostId={model.hostId}
      onOpenHooksSettings={actions.onOpenHooksSettings}
    >
      <ConversationImageAssetProvider
        hostId={model.hostId}
        conversationId={model.threadId}
      >
        <EnsureLocalConversationThreadScrollController>
          <LocalConversationThreadScrollLayout
            contentX={contentShiftX}
            footer={footer}
          >
            <LocalConversationThreadBodyOwner
              body={model.body}
              projectId={model.projectId}
              threadId={model.threadId}
              isSideChat={model.isSideChat}
              cwd={model.cwd}
              turns={model.turns}
              turnPagination={model.turnPagination ?? null}
              requests={model.requests}
              canonicalRequests={model.canonicalRequests ?? []}
              resumeState={model.resumeState}
              capabilityFlags={model.capabilityFlags}
              statusType={model.statusType}
              parentTurns={model.parentTurns}
              childMemberships={model.childMemberships}
              backgroundAgentRows={model.backgroundAgentRows ?? []}
              projectWorkspacePath={model.projectWorkspacePath}
              searchOpenTick={model.searchOpenTick}
              threadStartProgress={model.threadStartProgress}
              actions={actions}
              isWorktreeThread={isWorktreeThread}
              onForkFromTurnIntoWorktree={onForkFromTurnIntoWorktree}
              planSidePanelState={planSidePanelState}
              onErrorMessage={onErrorMessage}
              initialUiState={initialUiState}
              turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
            />
          </LocalConversationThreadScrollLayout>
        </EnsureLocalConversationThreadScrollController>
      </ConversationImageAssetProvider>
    </HookFeedbackSettingsNavigationProvider>
  );
}

export const LocalConversationThreadBody = memo(
  LocalConversationThreadBodyComponent,
  (left, right) =>
    left.actions === right.actions
    && left.isWorktreeThread === right.isWorktreeThread
    && left.onForkFromTurnIntoWorktree === right.onForkFromTurnIntoWorktree
    && left.planSidePanelState === right.planSidePanelState
    && left.onErrorMessage === right.onErrorMessage
    && left.contentShiftX === right.contentShiftX
    && left.footer === right.footer
    && left.initialUiState === right.initialUiState
    && left.turnDiffHoverPreviewDisabled === right.turnDiffHoverPreviewDisabled
    && left.model.searchOpenTick === right.model.searchOpenTick
    && left.model.projectWorkspacePath === right.model.projectWorkspacePath
    && left.model.childMemberships === right.model.childMemberships
    && left.model.backgroundAgentRows === right.model.backgroundAgentRows
    && left.model.threadStartProgress === right.model.threadStartProgress
    && left.model.body === right.model.body
    && left.model.projectId === right.model.projectId
    && left.model.hostId === right.model.hostId
    && left.model.threadId === right.model.threadId
    && left.model.isSideChat === right.model.isSideChat
    && left.model.cwd === right.model.cwd
    && left.model.resumeState === right.model.resumeState
    && left.model.statusType === right.model.statusType
    && left.model.parentTurns === right.model.parentTurns
    && left.model.turns === right.model.turns
    && left.model.turnPagination === right.model.turnPagination
    && left.model.requests === right.model.requests
    && left.model.canonicalRequests === right.model.canonicalRequests
    && left.model.capabilityFlags === right.model.capabilityFlags,
);
