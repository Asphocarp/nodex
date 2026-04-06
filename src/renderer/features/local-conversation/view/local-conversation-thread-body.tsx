import type {
  ThreadBodyUiStateOverrides,
  ThreadStageActions,
  ThreadStageModel,
} from "../thread-stage-types";
import { LocalConversationThreadBodyOwner } from "./local-conversation-thread-body-owner";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";

interface LocalConversationThreadBodyProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
  onErrorMessage: (message: string | null) => void;
  initialUiState?: ThreadBodyUiStateOverrides;
}

export function LocalConversationThreadBody({
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
          conversation={model.conversation}
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
