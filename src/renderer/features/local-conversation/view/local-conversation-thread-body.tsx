import { memo, type ReactNode } from "react";
import type {
  ThreadBodySurfaceModel,
  ThreadBodyUiStateOverrides,
  ThreadStageActions,
} from "../thread-stage-types";
import { LocalConversationThreadBodyOwner } from "./local-conversation-thread-body-owner";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";

interface LocalConversationThreadBodyProps {
  model: ThreadBodySurfaceModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
  contentShiftX?: number;
  footer?: ReactNode;
  initialUiState?: ThreadBodyUiStateOverrides;
  turnDiffHoverPreviewDisabled?: boolean;
}

function LocalConversationThreadBodyComponent({
  model,
  actions,
  onErrorMessage,
  contentShiftX = 0,
  footer,
  initialUiState,
  turnDiffHoverPreviewDisabled = false,
}: LocalConversationThreadBodyProps) {
  return (
    <EnsureLocalConversationThreadScrollController>
      <LocalConversationThreadScrollLayout
        contentX={contentShiftX}
        footer={footer}
      >
        <LocalConversationThreadBodyOwner
          body={model.body}
          projectId={model.projectId}
          threadId={model.threadId}
          cwd={model.cwd}
          turns={model.turns}
          turnPagination={model.turnPagination ?? null}
          requests={model.requests}
          resumeState={model.resumeState}
          capabilityFlags={model.capabilityFlags}
          statusType={model.statusType}
          parentTurns={model.parentTurns}
          projectWorkspacePath={model.projectWorkspacePath}
          searchOpenTick={model.searchOpenTick}
          threadStartProgress={model.threadStartProgress}
          actions={actions}
          onErrorMessage={onErrorMessage}
          initialUiState={initialUiState}
          turnDiffHoverPreviewDisabled={turnDiffHoverPreviewDisabled}
        />
      </LocalConversationThreadScrollLayout>
    </EnsureLocalConversationThreadScrollController>
  );
}

export const LocalConversationThreadBody = memo(
  LocalConversationThreadBodyComponent,
  (left, right) =>
    left.actions === right.actions
    && left.onErrorMessage === right.onErrorMessage
    && left.contentShiftX === right.contentShiftX
    && left.footer === right.footer
    && left.initialUiState === right.initialUiState
    && left.turnDiffHoverPreviewDisabled === right.turnDiffHoverPreviewDisabled
    && left.model.searchOpenTick === right.model.searchOpenTick
    && left.model.projectWorkspacePath === right.model.projectWorkspacePath
    && left.model.threadStartProgress === right.model.threadStartProgress
    && left.model.body === right.model.body
    && left.model.projectId === right.model.projectId
    && left.model.threadId === right.model.threadId
    && left.model.cwd === right.model.cwd
    && left.model.resumeState === right.model.resumeState
    && left.model.statusType === right.model.statusType
    && left.model.parentTurns === right.model.parentTurns
    && left.model.turns === right.model.turns
    && left.model.turnPagination === right.model.turnPagination
    && left.model.requests === right.model.requests
    && left.model.capabilityFlags === right.model.capabilityFlags,
);
