import { memo } from "react";
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
  initialUiState?: ThreadBodyUiStateOverrides;
}

function LocalConversationThreadBodyComponent({
  model,
  actions,
  onErrorMessage,
  initialUiState,
}: LocalConversationThreadBodyProps) {
  return (
    <EnsureLocalConversationThreadScrollController>
      <LocalConversationThreadScrollLayout scrollViewClassName="hide-scrollbar">
        <LocalConversationThreadBodyOwner
          body={model.body}
          threadId={model.threadId}
          cwd={model.cwd}
          turns={model.turns}
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
    && left.initialUiState === right.initialUiState
    && left.model.searchOpenTick === right.model.searchOpenTick
    && left.model.projectWorkspacePath === right.model.projectWorkspacePath
    && left.model.threadStartProgress === right.model.threadStartProgress
    && left.model.body === right.model.body
    && left.model.threadId === right.model.threadId
    && left.model.cwd === right.model.cwd
    && left.model.resumeState === right.model.resumeState
    && left.model.statusType === right.model.statusType
    && left.model.parentTurns === right.model.parentTurns
    && left.model.turns === right.model.turns
    && left.model.requests === right.model.requests
    && left.model.capabilityFlags === right.model.capabilityFlags,
);
